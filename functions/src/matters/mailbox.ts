/**
 * A4 part 2: the owner's Microsoft mailbox (docs/v2/A4-THREAT-MODEL.md T9). The assistant SENDS
 * from it and never reads it: replies come to the matter address through Reply-To (T1).
 *
 * - matterMailbox (callable): status, connect (a sign-in link with PKCE and a single-use state
 *   tied to the uid, valid MATTERS_TUNING.mailboxStateTtlMs), disconnect (always allowed; deletes
 *   the stored access at once) and sendFrom (a draft sends from the mailbox or not; part of the
 *   confirmed hash, so confirming covers it).
 * - matterMailboxCallback (HTTP POST, form_post): Microsoft sends the browser here, with the code
 *   in the body (never in a URL). The server takes the state (single use), exchanges the code with
 *   the client secret and the PKCE verifier, reads the owner's own address (User.Read), encrypts
 *   the refresh token (mailboxCrypto.ts) and stores it in matterMailboxes/{uid}. It answers with a
 *   short page that sends the browser back to the app (callbackPage).
 * - createMailboxSender: per send, a fresh access token from the stored refresh token, then
 *   Graph sendMail. Microsoft refusing the access (invalid_grant, or 401/403 on sending) deletes
 *   the stored access and fails the send; nothing ever falls back to another address.
 *
 * Server-only collections (no client rule: unmatched paths are denied): matterMailboxes/{uid} and
 * matterMailboxStates/{stateId}, both with the uid for deleteAccount. Tokens, the verifier and
 * the code are never logged, returned to the app or written in clear.
 */
import { randomBytes } from 'node:crypto';

import * as logger from 'firebase-functions/logger';
import type { Firestore } from 'firebase-admin/firestore';
import { z } from 'zod';

import {
  MATTER_MAILBOX_RETURN_URL,
  emailSchema,
  isoDateTimeSchema,
  matterMailboxRequestSchema,
  type MatterMailboxResponse,
} from '../shared/aiContract';
import { EmailSendError, MailboxSendError, type EmailSender } from './email';
import { MailboxAuthError, authorizeUrl, exchangeCode, readOwnAddress, refreshAccess, sendMailboxEmail, type GraphConfig } from './graph';
import { MailboxCryptoError, mailboxAad, openSecret, sealSecret, sealedKeyId, stateAad, type MailboxKey } from './mailboxCrypto';
import { MATTER_MAILBOXES_COLLECTION, MATTER_MAILBOX_STATES_COLLECTION, matterDocSchema, type MatterDoc } from './model';
import { draftView, event, matterError, readable, requireCaller, requireSignedIn, type MatterCaller, type MatterDeps } from './handlers';
import { readBack } from './text';

// ---------------------------------------------------------------------------------------------
// Records and their store
// ---------------------------------------------------------------------------------------------

export const mailboxRecordSchema = z
  .object({
    uid: z.string().min(1).max(128),
    provider: z.literal('microsoft'),
    address: emailSchema,
    name: z.string().max(100).nullable(),
    /** The refresh token, encrypted (mailboxCrypto.ts sealSecret, associated data uid + address). */
    sealedRefresh: z.string().min(1).max(16_000),
    keyId: z.string().max(16),
    connectedAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .strict();
export type MailboxRecord = z.infer<typeof mailboxRecordSchema>;

export const mailboxStateSchema = z
  .object({
    uid: z.string().min(1).max(128),
    /** The PKCE verifier, encrypted (associated data: the state id). */
    sealedVerifier: z.string().min(1).max(2_000),
    language: z.enum(['en', 'es']),
    createdAt: isoDateTimeSchema,
    expiresAt: isoDateTimeSchema,
  })
  .strict();
export type MailboxState = z.infer<typeof mailboxStateSchema>;

export interface MailboxStore {
  get(uid: string): Promise<MailboxRecord | null>;
  put(uid: string, record: MailboxRecord): Promise<void>;
  /** Stores a rotated refresh token only while the record is still this mailbox (a disconnect in between wins). */
  rotate(uid: string, address: string, sealedRefresh: string, keyId: string, nowIso: string): Promise<boolean>;
  /** true when there was a record. */
  remove(uid: string): Promise<boolean>;
  createState(stateId: string, state: MailboxState): Promise<void>;
  /** Reads AND deletes a state in one transaction: each one is used at most once. */
  takeState(stateId: string): Promise<MailboxState | null>;
}

export function firestoreMailboxStore(db: Firestore): MailboxStore {
  const mailboxes = db.collection(MATTER_MAILBOXES_COLLECTION);
  const states = db.collection(MATTER_MAILBOX_STATES_COLLECTION);
  const parse = (data: unknown): MailboxRecord | null => {
    const parsed = mailboxRecordSchema.safeParse(data);
    return parsed.success ? parsed.data : null;
  };
  return {
    async get(uid) {
      const snapshot = await mailboxes.doc(uid).get();
      return snapshot.exists ? parse(snapshot.data()) : null;
    },
    async put(uid, record) {
      await mailboxes.doc(uid).set(mailboxRecordSchema.parse(record));
    },
    async rotate(uid, address, sealedRefresh, keyId, nowIso) {
      return db.runTransaction(async (tx) => {
        const ref = mailboxes.doc(uid);
        const current = parse((await tx.get(ref)).data());
        if (!current || current.address !== address) return false;
        tx.update(ref, { sealedRefresh, keyId, updatedAt: nowIso });
        return true;
      });
    },
    async remove(uid) {
      const ref = mailboxes.doc(uid);
      const existed = (await ref.get()).exists;
      await ref.delete();
      return existed;
    },
    async createState(stateId, state) {
      await states.doc(stateId).create(mailboxStateSchema.parse(state));
    },
    async takeState(stateId) {
      return db.runTransaction(async (tx) => {
        const ref = states.doc(stateId);
        const snapshot = await tx.get(ref);
        if (!snapshot.exists) return null;
        tx.delete(ref);
        const parsed = mailboxStateSchema.safeParse(snapshot.data());
        return parsed.success ? parsed.data : null;
      });
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------------------------

export interface MailboxDeps {
  store: MailboxStore;
  /** False when the mailbox is not set up (no client id): the app hides "Connect your mailbox". */
  available: boolean;
  /** The Graph settings with the client secret (read when needed: it throws when the secret is missing). */
  graph: () => GraphConfig;
  /** MATTERS_MAILBOX_KEY, parsed (throws MailboxCryptoError when missing or not a 32-byte key). */
  keys: () => MailboxKey[];
  stateTtlMs: number;
  random?: (size: number) => Buffer;
}

const STATE_ID = /^[0-9a-f]{32}$/;

function bytes(mb: MailboxDeps, size: number): Buffer {
  return (mb.random ?? randomBytes)(size);
}

/** Whether the mailbox can be used at all: set up, and its key readable. */
function usable(mb: MailboxDeps | undefined): mb is MailboxDeps {
  if (!mb?.available) return false;
  try {
    mb.keys();
    return true;
  } catch (error) {
    logger.error('matters.mailbox_key_invalid', { kind: error instanceof MailboxCryptoError ? error.kind : 'unknown' });
    return false;
  }
}

// ---------------------------------------------------------------------------------------------
// matterMailbox
// ---------------------------------------------------------------------------------------------

async function statusOf(uid: string, mb: MailboxDeps | undefined): Promise<MatterMailboxResponse> {
  const available = usable(mb);
  const record = mb ? await mb.store.get(uid) : null;
  return { available, connected: record !== null, address: record?.address ?? null };
}

export function handleMatterMailbox(callerIn: MatterCaller | null, data: unknown, deps: MatterDeps): Promise<MatterMailboxResponse> {
  return readable(() => mailboxAction(callerIn, data, deps));
}

async function mailboxAction(callerIn: MatterCaller | null, data: unknown, deps: MatterDeps): Promise<MatterMailboxResponse> {
  const parsed = matterMailboxRequestSchema.safeParse(data);
  if (!parsed.success) {
    requireSignedIn(callerIn);
    throw matterError('invalid_request');
  }
  const request = parsed.data;
  const mb = deps.mailbox;
  if (request.action === 'status') {
    const caller = requireSignedIn(callerIn);
    return statusOf(caller.uid, mb);
  }
  if (request.action === 'disconnect') {
    // the owner can always remove the access: not tied to the switch or the tester list
    const caller = requireSignedIn(callerIn);
    const removed = mb ? await mb.store.remove(caller.uid) : false;
    logger.info('matters.mailbox_disconnected', { uid: caller.uid, removed });
    return { available: usable(mb), connected: false, address: null };
  }
  const caller = requireCaller(callerIn, deps);
  if (request.action === 'connect') {
    if (!usable(mb)) throw matterError('not_configured');
    let graph: GraphConfig;
    try {
      graph = mb.graph();
    } catch {
      throw matterError('not_configured');
    }
    const now = deps.now();
    const stateId = bytes(mb, 16).toString('hex');
    const verifier = bytes(mb, 32).toString('base64url');
    await mb.store.createState(stateId, {
      uid: caller.uid,
      sealedVerifier: sealSecret(verifier, stateAad(stateId), mb.keys(), (size) => bytes(mb, size)),
      language: request.language ?? 'en',
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + mb.stateTtlMs).toISOString(),
    });
    logger.info('matters.mailbox_connect_started', { uid: caller.uid });
    return { ...(await statusOf(caller.uid, mb)), authUrl: authorizeUrl({ clientId: graph.clientId, redirectUri: graph.redirectUri, state: stateId, verifier }) };
  }
  // sendFrom: a draft sends from the mailbox, or from the assistant's address
  const record = request.mailbox && mb ? await mb.store.get(caller.uid) : null;
  if (request.mailbox && !record) throw matterError('not_allowed', 'Connect your mailbox first.');
  const nowIso = deps.now().toISOString();
  const updated = await deps.store.updateMatter<MatterDoc | 'not_found' | 'not_draft'>(caller.uid, request.matterId, (doc) => {
    if (!doc) return { result: 'not_found' };
    if (doc.status !== 'draft') return { result: 'not_draft' };
    const mailbox = record?.address ?? null;
    const next: MatterDoc = matterDocSchema.parse({
      ...doc,
      sendFrom: mailbox ? 'mailbox' : 'assistant',
      mailboxAddress: mailbox,
      readBack: doc.mandate ? readBack(doc.mandate, doc.ownerEmail, doc.language, doc.scheduling, mailbox) : doc.readBack,
      mandateVersion: doc.mandateVersion + 1,
      updatedAt: nowIso,
    });
    return {
      result: next,
      patch: { sendFrom: next.sendFrom, mailboxAddress: next.mailboxAddress, readBack: next.readBack, mandateVersion: next.mandateVersion, updatedAt: nowIso },
      events: [event('mandate_drafted', nowIso, mailbox ? 'mailbox' : 'assistant')],
    };
  });
  if (updated === 'not_found') throw matterError('not_found');
  if (updated === 'not_draft') throw matterError('invalid_request', 'Only a draft can be changed.');
  return { ...(await statusOf(caller.uid, mb)), draft: draftView(request.matterId, updated, deps) };
}

// ---------------------------------------------------------------------------------------------
// matterMailboxCallback
// ---------------------------------------------------------------------------------------------

export type CallbackResult = 'connected' | 'denied' | 'expired' | 'failed' | 'not_allowed';

/**
 * What Microsoft posts back (response_mode form_post: the code travels in the request body, so it
 * is never in a URL or a request log).
 */
export interface CallbackInput {
  code?: unknown;
  state?: unknown;
  error?: unknown;
}

/** Where the browser goes back to after the sign-in (the app closes the browser on it). */
export function returnUrl(result: CallbackResult): string {
  return `${MATTER_MAILBOX_RETURN_URL}?result=${result}`;
}

export async function handleMailboxCallback(input: CallbackInput, deps: MatterDeps): Promise<{ result: CallbackResult; language: 'en' | 'es' }> {
  const mb = deps.mailbox;
  if (!usable(mb)) return { result: 'failed', language: 'en' };
  const stateId = typeof input.state === 'string' ? input.state : '';
  if (!STATE_ID.test(stateId)) return { result: 'expired', language: 'en' };
  const state = await mb.store.takeState(stateId);
  const now = deps.now();
  if (!state || Date.parse(state.expiresAt) <= now.getTime()) return { result: 'expired', language: state?.language ?? 'en' };
  const { uid, language } = state;
  const done = (result: CallbackResult) => ({ result, language });
  if (!deps.enabled || !deps.allowed(uid)) return done('not_allowed');
  if (typeof input.error === 'string' && input.error) {
    logger.info('matters.mailbox_connect_denied', { uid, error: input.error.slice(0, 40) });
    return done('denied');
  }
  const code = typeof input.code === 'string' ? input.code : '';
  if (!code || code.length > 4096) return done('failed');
  try {
    const keys = mb.keys();
    const graph = mb.graph();
    const verifier = openSecret(state.sealedVerifier, stateAad(stateId), keys);
    const tokens = await exchangeCode(graph, code, verifier);
    const me = await readOwnAddress(graph, tokens.accessToken);
    const sealedRefresh = sealSecret(tokens.refreshToken, mailboxAad(uid, me.address), keys, (size) => bytes(mb, size));
    const nowIso = now.toISOString();
    await mb.store.put(uid, {
      uid,
      provider: 'microsoft',
      address: me.address,
      name: me.name,
      sealedRefresh,
      keyId: sealedKeyId(sealedRefresh) ?? '',
      connectedAt: nowIso,
      updatedAt: nowIso,
    });
    logger.info('matters.mailbox_connected', { uid });
    return done('connected');
  } catch (error) {
    if (error instanceof MailboxAuthError) {
      (error.kind === 'client' ? logger.error : logger.warn)('matters.mailbox_connect_failed', { uid, kind: error.kind, code: error.code });
    } else if (error instanceof MailboxCryptoError) {
      logger.error('matters.mailbox_connect_failed', { uid, kind: `crypto_${error.kind}` });
    } else {
      logger.error('matters.mailbox_connect_failed', { uid, kind: 'unexpected', errorName: error instanceof Error ? error.name : 'unknown' });
    }
    return done('failed');
  }
}

const PAGE_TEXT: Readonly<Record<'en' | 'es', Record<CallbackResult, [string, string]> & { button: string }>> = {
  en: {
    connected: ['Your mailbox is connected.', 'You can go back to the app.'],
    denied: ['Your mailbox was not connected.', 'You can try again from the app.'],
    expired: ['This sign-in link has expired.', 'Please start again from the app.'],
    failed: ['Your mailbox could not be connected.', 'Please try again from the app.'],
    not_allowed: ['The assistant is not available for your account.', 'Nothing was connected.'],
    button: 'Back to Meeting Guard AI',
  },
  es: {
    connected: ['Tu buzón está conectado.', 'Ya puedes volver a la app.'],
    denied: ['Tu buzón no se ha conectado.', 'Puedes intentarlo de nuevo desde la app.'],
    expired: ['Este enlace de inicio de sesión ha caducado.', 'Empieza de nuevo desde la app.'],
    failed: ['No se ha podido conectar tu buzón.', 'Inténtalo de nuevo desde la app.'],
    not_allowed: ['El asistente no está disponible para tu cuenta.', 'No se ha conectado nada.'],
    button: 'Volver a Meeting Guard AI',
  },
};

/**
 * The page the browser shows after the sign-in: it sends the browser back to the app at once,
 * with a button in case the browser blocks that. No user data on it.
 */
export function callbackPage(result: CallbackResult, language: 'en' | 'es'): string {
  const text = PAGE_TEXT[language];
  const [title, body] = text[result];
  const url = returnUrl(result);
  return `<!doctype html>
<html lang="${language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Meeting Guard AI</title>
<style>body{font-family:system-ui,sans-serif;background:#0f1424;color:#f2f4fa;margin:0;padding:48px 24px;text-align:center}h1{font-size:22px;margin:0 0 12px}p{color:#b9c0d4;margin:0 0 28px}a{display:inline-block;background:#c9c3ff;color:#1a1640;text-decoration:none;font-weight:600;padding:14px 24px;border-radius:24px}</style>
</head><body><h1>${title}</h1><p>${body}</p><a href="${url}">${text.button}</a>
<script>window.location.replace(${JSON.stringify(url)});</script></body></html>`;
}

// ---------------------------------------------------------------------------------------------
// Sending from the mailbox
// ---------------------------------------------------------------------------------------------

/**
 * The sender of a mailbox matter: the stored access must still be this owner's mailbox
 * (`address`, fixed in the confirmed hash); a fresh access token per send; Graph sendMail.
 */
export function createMailboxSender(mb: MailboxDeps, uid: string, address: string, now: () => Date): EmailSender {
  return {
    async send(email) {
      if (!usable(mb)) throw new MailboxSendError('not_configured');
      const record = await mb.store.get(uid);
      if (!record) throw new MailboxSendError('not_connected');
      if (record.address !== address.trim().toLowerCase()) throw new MailboxSendError('changed');
      let graph: GraphConfig;
      let refreshToken: string;
      const keys = mb.keys();
      try {
        graph = mb.graph();
        refreshToken = openSecret(record.sealedRefresh, mailboxAad(uid, record.address), keys);
      } catch (error) {
        logger.error('matters.mailbox_unusable', { uid, kind: error instanceof MailboxCryptoError ? error.kind : 'configuration' });
        throw new MailboxSendError('not_configured', { cause: error });
      }
      let accessToken: string;
      try {
        const tokens = await refreshAccess(graph, refreshToken);
        accessToken = tokens.accessToken;
        if (tokens.refreshToken && tokens.refreshToken !== refreshToken) {
          const sealed = sealSecret(tokens.refreshToken, mailboxAad(uid, record.address), keys, (size) => bytes(mb, size));
          await mb.store.rotate(uid, record.address, sealed, sealedKeyId(sealed) ?? '', now().toISOString()).catch((error: unknown) => {
            logger.warn('matters.mailbox_rotate_failed', { uid, errorName: error instanceof Error ? error.name : 'unknown' });
          });
        }
      } catch (error) {
        if (error instanceof MailboxAuthError && error.kind === 'revoked') {
          await revoke(mb, uid, error.code ?? 'invalid_grant');
          throw new MailboxSendError('revoked', { cause: error });
        }
        const kind = error instanceof MailboxAuthError ? error.kind : 'unknown';
        (kind === 'client' ? logger.error : logger.warn)('matters.mailbox_token_failed', { uid, kind });
        // nothing was sent yet: a clear refusal the owner may try again
        throw new MailboxSendError(kind === 'client' ? 'client' : 'unavailable', { cause: error });
      }
      try {
        await sendMailboxEmail(graph, accessToken, email);
      } catch (error) {
        if (error instanceof MailboxSendError && error.reason === 'revoked') await revoke(mb, uid, 'send_refused');
        throw error;
      }
      return { providerId: `graph-${bytes(mb, 8).toString('hex')}` };
    },
  };
}

/** Microsoft refused the access: it is deleted at once (T9), the owner connects again. */
async function revoke(mb: MailboxDeps, uid: string, why: string): Promise<void> {
  logger.warn('matters.mailbox_revoked', { uid, why: why.slice(0, 40) });
  await mb.store.remove(uid).catch((error: unknown) => {
    logger.error('matters.mailbox_remove_failed', { uid, errorName: error instanceof Error ? error.name : 'unknown' });
  });
}

/** True for a send error that means the mailbox cannot send (the timeline says so). */
export function isMailboxFailure(error: unknown): boolean {
  return error instanceof EmailSendError && error.kind === 'mailbox';
}

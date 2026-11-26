/**
 * A4 part 2, "Watch this thread" (docs/v2/A4-THREAT-MODEL.md T9). The assistant never reads the
 * owner's mailbox; instead the owner FORWARDS the thread they want watched, from their connected
 * mailbox, to the assistant's address (<fromLocalPart>@<mail domain>).
 *
 * receiveForward (the inbound webhook, for mail to that address that matched no matter):
 * - the From must be the address of exactly one connected mailbox (matterMailboxes), and our own
 *   sender check must find a DKIM signature aligned with it (mailCheck.ts verdict 'trusted');
 *   anything else (someone else, an unsigned or failing forward, an automatic reply, the assistant
 *   off for that owner, too many waiting) starts nothing and keeps nothing but the dedupe marker;
 * - a verified forward is parsed by code (parseForward): the owner's words above it, the sender
 *   and subject its wrapper names, and the newest forwarded message only (older quoted messages
 *   are left out). The forwarded text is not verified and is DATA only;
 * - it waits as a card (matterWatches/{watchId}, server only, deleted after
 *   MATTER_LIMITS.watchWaitDays). No model call and no email.
 * matterWatch (callable): list the cards, dismiss one, or draft one: only then does the model
 * draft a matter that answers it (draft.ts with ctx.thread), and the owner reads it back and
 * confirms it like any matter; nothing is sent before that. A card makes one draft: it stays
 * ("draft ready") so the owner can come back to that draft, and goes once the draft is confirmed
 * or cancelled.
 * Logs: uid and categories only, never addresses, subjects or text.
 */
import { createHash } from 'node:crypto';

import * as logger from 'firebase-functions/logger';
import type { Firestore } from 'firebase-admin/firestore';
import { z } from 'zod';

import { emailSchema, isoDateTimeSchema, matterWatchRequestSchema, type Language, type MatterWatchItem, type MatterWatchResponse } from '../shared/aiContract';
import { isValidTimeZone } from '../assistant/time';
import {
  consumeDaily,
  defaultMailbox,
  draftFields,
  draftView,
  event,
  matterError,
  readable,
  requireCaller,
  requireRoomForMatter,
  requireSignedIn,
  runDraft,
  schedulingFor,
  verifiedEmail,
  type InboundOutcome,
  type MatterCaller,
  type MatterDeps,
  type Tokens,
} from './handlers';
import { hasHiddenHtml, htmlToText, type InboundEmail } from './inbound';
import type { SenderCheck } from './mailCheck';
import {
  EMPTY_USAGE,
  MATTER_LIMITS,
  MATTER_WATCHES_COLLECTION,
  forwardedEmailSchema,
  isOwnDomain,
  matterDocSchema,
  newReplyToken,
  withModelCall,
  type ForwardedEmail,
  type MatterDoc,
  type MatterMessage,
} from './model';
import { prefsOf, requireConsent } from './settings';
import type { InboundMarker, MatterStore } from './store';
import { ownerDisplayName } from './text';

// ---------------------------------------------------------------------------------------------
// Parsing a forward
// ---------------------------------------------------------------------------------------------

/** A forward's own wrapper line: Outlook's rule, Gmail's and Outlook's markers, Apple Mail's (EN and ES). */
const SEPARATOR =
  /^(?:_{8,}|-{2,}\s*(?:forwarded message|original message|mensaje reenviado|mensaje original)\s*-{2,}|begin forwarded message:?|inicio del mensaje reenviado:?)$/i;
/** A wrapper header line ("From: ...", "*De:* ...", "Enviado el: ..."). */
const FIELD = /^\*?\s*(from|de|sent|enviado(?: el)?|date|fecha|to|para|cc|subject|asunto)\s*:\s*\*?\s*(.*)$/i;
/** The line that starts an older quoted reply inside the forwarded message. */
const QUOTE_START = /^(?:On .{1,300} wrote:|El .{1,300} escribi[oó]:)$/i;
/** Re:, Fwd:, RV: and their kin at the start of a subject. */
const SUBJECT_PREFIX = /^(?:\s*(?:re|fw|fwd|rv|reenv|tr)\s*:\s*)+/i;

type FieldName = 'from' | 'sent' | 'to' | 'cc' | 'subject';

function fieldOf(line: string): { name: FieldName; value: string } | null {
  const match = FIELD.exec(line.trim());
  if (!match) return null;
  const label = match[1]!.toLowerCase();
  const name: FieldName =
    label === 'from' || label === 'de'
      ? 'from'
      : label === 'to' || label === 'para'
        ? 'to'
        : label === 'cc'
          ? 'cc'
          : label === 'subject' || label === 'asunto'
            ? 'subject'
            : 'sent';
  return { name, value: match[2]!.trim() };
}

/** The next line at or after `index` that is not blank (Outlook's HTML puts blank lines between header fields). */
function nextFilled(lines: readonly string[], index: number, maxSkip = 2): number {
  let j = index;
  while (j < lines.length && j - index < maxSkip && (lines[j] ?? '').trim() === '') j += 1;
  return j;
}

/** A From line followed (within a few header lines) by a Subject line: a wrapper header without a separator. */
function headerStartsAt(lines: readonly string[], index: number): boolean {
  if (fieldOf(lines[index] ?? '')?.name !== 'from') return false;
  let j = index;
  for (let seen = 0; seen < 6; seen += 1) {
    j = nextFilled(lines, j + 1);
    const field = fieldOf(lines[j] ?? '');
    if (!field) return false;
    if (field.name === 'subject') return true;
  }
  return false;
}

/** "Name <a@b.c>", "Name [mailto:a@b.c]", "a@b.c" or a name alone. */
export function parseSender(value: string): { name: string | null; email: string | null } {
  const angle = /<\s*([^<>\s]+@[^<>\s]+)\s*>/.exec(value) ?? /\[mailto:([^\]\s]+)\]/i.exec(value);
  const bare = angle ? null : /[^\s<>()[\]"',;]+@[^\s<>()[\]"',;]+/.exec(value);
  const candidate = (angle?.[1] ?? bare?.[0] ?? '').replace(/^mailto:/i, '').toLowerCase();
  const email = emailSchema.safeParse(candidate).success ? candidate : null;
  const rest = (angle ? value.replace(angle[0], '') : bare ? value.replace(bare[0], '') : value).replace(/["*]/g, '').trim();
  const name = rest && rest.toLowerCase() !== email ? rest.slice(0, MATTER_LIMITS.nameChars) : null;
  return { name, email };
}

export interface ParsedForward {
  /** The owner's own words above the forwarded message (may be empty). */
  note: string;
  from: { name: string | null; email: string | null };
  subject: string;
  /** The newest forwarded message only. */
  text: string;
}

/**
 * The forward inside a plain text: the first wrapper (a separator line followed by a From line,
 * or a From line followed by a Subject line), its header fields, and the message under it up to
 * the next wrapper or quoted reply. null when the text holds no forward.
 */
export function parseForwardText(input: string, outerSubject: string): ParsedForward | null {
  const lines = input.replace(/\r\n?/g, '\n').split('\n');
  let cut = -1;
  let start = -1;
  for (let i = 0; i < lines.length && start < 0; i += 1) {
    const trimmed = (lines[i] ?? '').trim();
    if (SEPARATOR.test(trimmed)) {
      let j = i + 1;
      while (j < lines.length && j <= i + 3 && (lines[j] ?? '').trim() === '') j += 1;
      if (fieldOf(lines[j] ?? '')?.name === 'from') {
        cut = i;
        start = j;
      }
    } else if (headerStartsAt(lines, i)) {
      cut = i;
      start = i;
    }
  }
  if (start < 0) return null;
  // the header block: field lines, possibly with blank lines between them; it ends at the first
  // line that is not a field (blank lines before it are skipped)
  const fields: Partial<Record<FieldName, string>> = {};
  let k = start;
  while (k < lines.length) {
    const field = fieldOf(lines[k] ?? '');
    if (!field) break;
    if (fields[field.name] === undefined) fields[field.name] = field.value;
    const next = nextFilled(lines, k + 1);
    if (!fieldOf(lines[next] ?? '')) {
      k += 1;
      break;
    }
    k = next;
  }
  const body: string[] = [];
  for (; k < lines.length; k += 1) {
    const line = lines[k] ?? '';
    const trimmed = line.trim();
    if (SEPARATOR.test(trimmed) || QUOTE_START.test(trimmed) || headerStartsAt(lines, k)) break;
    if (trimmed.startsWith('>')) continue;
    body.push(line);
  }
  const subject = (fields.subject ?? outerSubject.replace(SUBJECT_PREFIX, '')).trim().slice(0, MATTER_LIMITS.subjectChars);
  return {
    note: lines.slice(0, cut).join('\n').trim().slice(0, MATTER_LIMITS.forwardNoteChars),
    from: parseSender(fields.from ?? ''),
    subject,
    text: body.join('\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, MATTER_LIMITS.forwardedChars),
  };
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * The forward in Postmark's inbound JSON. The quoted content IS the forward, so it is kept (unlike a
 * reply, inbound.ts replyText); an HTML body that hides text is read from its visible text.
 */
export function parseForward(payload: unknown, outerSubject: string): ParsedForward | null {
  const root = typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {};
  const html = str(root.HtmlBody);
  const textBody = str(root.TextBody);
  // in HTML a line break in the source is only a space (Outlook writes one after every <br>)
  const text = html && (hasHiddenHtml(html) || !textBody.trim()) ? htmlToText(html.replace(/\s+/g, ' '), { keepQuotes: true }) : textBody;
  return parseForwardText(text.slice(0, 200_000), outerSubject);
}

// ---------------------------------------------------------------------------------------------
// The waiting cards and their store
// ---------------------------------------------------------------------------------------------

export const watchRecordSchema = z
  .object({
    uid: z.string().min(1).max(128),
    forwarded: forwardedEmailSchema,
    note: z.string().max(MATTER_LIMITS.forwardNoteChars),
    createdAt: isoDateTimeSchema,
    expiresAt: isoDateTimeSchema,
    /** A draft being made from it (matterWatch draft); a claim older than WATCH_CLAIM_MS is stale. */
    claimedAt: isoDateTimeSchema.nullable(),
    /** The draft made from it (one per card); the card goes once that matter is no longer a draft. */
    matterId: z.string().min(1).max(128).nullable().default(null),
  })
  .strict();
export type WatchRecord = z.infer<typeof watchRecordSchema>;

/** A draft from a card normally takes seconds; a claim older than this was left by a call that died. */
export const WATCH_CLAIM_MS = 120_000;

/** A card with its draft waits this long for the owner to confirm or cancel it. */
export const WATCH_DRAFT_WAIT_DAYS = 30;

/** The card id: from the provider's id, so a retried webhook finds the card it made (create()). */
export function watchIdFor(providerId: string): string {
  return createHash('sha256').update(`watch:${providerId}`).digest('hex').slice(0, 40);
}

export interface WatchStore {
  /** false when the card exists already (a retried webhook). */
  create(watchId: string, record: WatchRecord): Promise<boolean>;
  /** The owner's cards (at most MATTER_LIMITS.maxWatchesWaiting * 2; a card that does not parse is left out). */
  list(uid: string): Promise<{ id: string; record: WatchRecord }[]>;
  /** Claims a card of this owner for a draft, in a transaction. */
  claim(uid: string, watchId: string, nowIso: string, staleBeforeIso: string): Promise<WatchRecord | 'missing' | 'busy'>;
  release(watchId: string): Promise<void>;
  /** Records the draft made from a card (and releases its claim); the card then waits longer. */
  setDraft(watchId: string, matterId: string, expiresAt: string): Promise<void>;
  /** Deletes a card of this owner; false when there was none. */
  remove(uid: string, watchId: string): Promise<boolean>;
  /** Deletes cards past their expiresAt; resolves how many. */
  purgeExpired(nowIso: string, limit: number): Promise<number>;
}

export function firestoreWatchStore(db: Firestore): WatchStore {
  const cards = db.collection(MATTER_WATCHES_COLLECTION);
  const parse = (data: unknown): WatchRecord | null => {
    const parsed = watchRecordSchema.safeParse(data);
    return parsed.success ? parsed.data : null;
  };
  return {
    async create(watchId, record) {
      try {
        await cards.doc(watchId).create(watchRecordSchema.parse(record));
        return true;
      } catch (error) {
        // ALREADY_EXISTS: the same forward was received before
        if ((error as { code?: unknown }).code === 6) return false;
        throw error;
      }
    },
    async list(uid) {
      const snapshot = await cards.where('uid', '==', uid).limit(MATTER_LIMITS.maxWatchesWaiting * 2).get();
      return snapshot.docs.flatMap((doc) => {
        const record = parse(doc.data());
        return record ? [{ id: doc.id, record }] : [];
      });
    },
    async claim(uid, watchId, nowIso, staleBeforeIso) {
      return db.runTransaction(async (tx) => {
        const ref = cards.doc(watchId);
        const record = parse((await tx.get(ref)).data());
        if (!record || record.uid !== uid) return 'missing' as const;
        if (record.claimedAt !== null && record.claimedAt > staleBeforeIso) return 'busy' as const;
        tx.update(ref, { claimedAt: nowIso });
        return record;
      });
    },
    async release(watchId) {
      await cards
        .doc(watchId)
        .update({ claimedAt: null })
        .catch(() => undefined);
    },
    async setDraft(watchId, matterId, expiresAt) {
      await cards.doc(watchId).update({ matterId, expiresAt, claimedAt: null });
    },
    async remove(uid, watchId) {
      return db.runTransaction(async (tx) => {
        const ref = cards.doc(watchId);
        const snapshot = await tx.get(ref);
        if (!snapshot.exists || snapshot.get('uid') !== uid) return false;
        tx.delete(ref);
        return true;
      });
    },
    async purgeExpired(nowIso, limit) {
      const snapshot = await cards.where('expiresAt', '<=', nowIso).limit(limit).get();
      if (snapshot.empty) return 0;
      const batch = db.batch();
      for (const doc of snapshot.docs) batch.delete(doc.ref);
      await batch.commit();
      return snapshot.size;
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Receiving a forward (the inbound webhook)
// ---------------------------------------------------------------------------------------------

export interface WatchInboundDeps {
  store: WatchStore;
  matters: Pick<MatterStore, 'markInbound'>;
  /** The uids whose connected Microsoft mailbox is this address (matterMailboxes). */
  mailboxOwners: (address: string) => Promise<string[]>;
  /** MATTERS_ENABLED and the runtime switch, now. */
  enabled: () => Promise<boolean>;
  allowed: (uid: string) => boolean;
  /** Our sender check (mailCheck.ts); without it no forward is ever accepted. */
  checkSender?: SenderCheck;
  domain: string;
  now: () => Date;
}

/** Why a forward started nothing (logged as a category). */
export type WatchRefusal = 'not_a_mailbox' | 'ambiguous' | 'not_allowed' | 'automatic' | 'not_verified' | 'not_a_forward' | 'too_many';

export async function receiveForward(email: InboundEmail, payload: unknown, marker: InboundMarker, deps: WatchInboundDeps): Promise<InboundOutcome> {
  const refuse = async (reason: WatchRefusal, extra: Record<string, unknown> = {}): Promise<InboundOutcome> => {
    // marked, so Postmark's retries of the same email are recognised; nothing else is kept
    if (!(await deps.matters.markInbound(marker))) return 'duplicate';
    logger.info('matters.watch_refused', { providerId: email.providerId, reason, ...extra });
    return 'unmatched';
  };
  const from = email.from.email.trim().toLowerCase();
  const owners = await deps.mailboxOwners(from);
  if (owners.length !== 1) return refuse(owners.length === 0 ? 'not_a_mailbox' : 'ambiguous');
  const uid = owners[0]!;
  if (!(await deps.enabled()) || !deps.allowed(uid)) return refuse('not_allowed', { uid });
  if (email.autoReply) return refuse('automatic', { uid });
  const now = deps.now();
  // only a forward that really comes from the owner's mailbox: DKIM aligned with its domain
  const auth = deps.checkSender ? await deps.checkSender({ raw: email.raw, from: email.from.email, spf: email.spf, priority: true, now }) : null;
  if (auth?.verdict !== 'trusted') return refuse('not_verified', { uid, verdict: auth?.verdict ?? null, why: auth?.reason ?? 'no_check' });
  const parsed = parseForward(payload, email.subject);
  if (!parsed) return refuse('not_a_forward', { uid });
  const nowIso = now.toISOString();
  const waiting = (await deps.store.list(uid)).filter((card) => card.record.expiresAt > nowIso);
  if (waiting.length >= MATTER_LIMITS.maxWatchesWaiting) return refuse('too_many', { uid });
  // the sender the wrapper names becomes the contact only when it is someone else: never the
  // owner's own mailbox, never our domain
  const sender = parsed.from.email && parsed.from.email !== from && !isOwnDomain(parsed.from.email, deps.domain) ? parsed.from.email : null;
  const record: WatchRecord = {
    uid,
    forwarded: {
      from: sender ? { name: parsed.from.name, email: sender } : null,
      subject: parsed.subject,
      text: parsed.text,
      receivedAt: nowIso,
    },
    note: parsed.note,
    createdAt: nowIso,
    expiresAt: new Date(now.getTime() + MATTER_LIMITS.watchWaitDays * 86_400_000).toISOString(),
    claimedAt: null,
    matterId: null,
  };
  if (!(await deps.store.create(watchIdFor(email.providerId), record))) return 'duplicate';
  logger.info('matters.watch_received', { uid, sender: sender !== null, note: parsed.note.length > 0 });
  return 'watch';
}

/**
 * A5, "Add an email to this matter": the owner forwards an email of the conversation to the
 * matter's own address from the connected mailbox. The same checks as a forward to watch (the
 * owner's mailbox, DKIM aligned); then the newest forwarded message joins the matter as an email
 * from the sender its wrapper names, marked as forwarded and NOT verified (auth 'unverified'), so
 * the usual read makes a card and nothing is ever sent automatically because of it. null: not a
 * verified forward from the owner's mailbox; the webhook stores the email as usual.
 */
export async function receiveIntoMatter(
  email: InboundEmail,
  payload: unknown,
  marker: InboundMarker,
  match: { uid: string; matterId: string },
  matter: MatterDoc,
  deps: WatchInboundDeps & { addInbound: MatterStore['addInboundMessage'] },
): Promise<InboundOutcome | null> {
  const from = email.from.email.trim().toLowerCase();
  const owners = await deps.mailboxOwners(from);
  if (owners.length !== 1 || owners[0] !== match.uid || email.autoReply) return null;
  const now = deps.now();
  const auth = deps.checkSender ? await deps.checkSender({ raw: email.raw, from: email.from.email, spf: email.spf, priority: true, now }) : null;
  if (auth?.verdict !== 'trusted') return null;
  const parsed = parseForward(payload, email.subject);
  const sender = parsed?.from.email && parsed.from.email !== from && !isOwnDomain(parsed.from.email, deps.domain) ? parsed.from.email : null;
  if (!parsed || !sender || !parsed.text) return null;
  const nowIso = now.toISOString();
  const role = matter.mandate?.contacts.some((c) => c.email.toLowerCase() === sender) ? 'contact' : 'other';
  const message: MatterMessage = {
    direction: 'inbound',
    status: 'received',
    rfcMessageId: `<forwarded.${email.providerId}@postmark>`,
    inReplyTo: null,
    references: [],
    from: { name: parsed.from.name, email: sender },
    to: [],
    cc: [],
    subject: parsed.subject.slice(0, MATTER_LIMITS.subjectChars),
    text: parsed.text,
    at: nowIso,
    providerId: email.providerId,
    // the forward is the owner's; what it quotes is not verified: read, never answered automatically
    auth: { verdict: 'unverified', fromAligned: false, spf: email.spf, arcTrusted: false, reason: 'forwarded_by_owner' },
    senderRole: role,
    autoReply: false,
    attachments: [],
    readState: matter.status === 'active' ? 'none' : 'skipped',
    readAttempts: 0,
    readClaimedAt: null,
    readOutcome: null,
  };
  const label = parsed.from.name ? `${parsed.from.name} <${sender}>` : sender;
  const outcome = await deps.addInbound(match.uid, match.matterId, message, event('email_received', nowIso, `${label} (forwarded by you)`), marker);
  if (outcome === 'duplicate') return 'duplicate';
  logger.info('matters.forward_added', { uid: match.uid, matterId: match.matterId, role });
  return 'stored';
}

// ---------------------------------------------------------------------------------------------
// matterWatch
// ---------------------------------------------------------------------------------------------

/** What the matter's request says when the owner wrote nothing above the forward. */
const DEFAULT_REQUEST: Readonly<Record<'en' | 'es', string>> = {
  en: 'Reply to this email for me and follow the conversation.',
  es: 'Responde a este correo por mí y sigue la conversación.',
};

/** Where the owner forwards a thread to: the assistant's own address. */
export function watchAddress(deps: Pick<MatterDeps, 'fromLocalPart' | 'domain'>): string {
  return `${deps.fromLocalPart}@${deps.domain}`.toLowerCase();
}

const PREVIEW_CHARS = 160;

function itemOf(id: string, record: WatchRecord): MatterWatchItem {
  const preview = record.forwarded.text.replace(/\s+/g, ' ').trim();
  return {
    watchId: id,
    fromName: record.forwarded.from?.name ?? null,
    fromEmail: record.forwarded.from?.email ?? null,
    subject: record.forwarded.subject,
    preview: preview.length > PREVIEW_CHARS ? `${preview.slice(0, PREVIEW_CHARS - 3).trimEnd()}...` : preview,
    receivedAt: record.createdAt,
    drafted: record.matterId !== null,
  };
}

/** The draft a card made, while it is still a draft (null: none yet, or confirmed, cancelled or deleted). */
async function draftOf(uid: string, record: WatchRecord, deps: MatterDeps): Promise<MatterDoc | null> {
  if (record.matterId === null) return null;
  const doc = await deps.store.getMatter(uid, record.matterId).catch(() => null);
  return doc?.status === 'draft' ? doc : null;
}

/**
 * The owner's waiting cards, newest first. Deleted on the way: expired ones, and those whose draft
 * was confirmed, cancelled or deleted (their work is done).
 */
async function waitingCards(uid: string, store: WatchStore, deps: MatterDeps): Promise<MatterWatchItem[]> {
  const nowIso = deps.now().toISOString();
  const cards = await store.list(uid);
  const live: MatterWatchItem[] = [];
  for (const { id, record } of cards) {
    if (record.expiresAt <= nowIso || (record.matterId !== null && !(await draftOf(uid, record, deps)))) {
      await store.remove(uid, id).catch(() => false);
      continue;
    }
    live.push(itemOf(id, record));
  }
  return live.sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : a.receivedAt > b.receivedAt ? -1 : 0));
}

/** Watching needs the assistant on for the owner and a connected mailbox (forwards come only from one). */
async function watchAvailable(uid: string, deps: MatterDeps): Promise<boolean> {
  if (!deps.enabled || !deps.allowed(uid) || !deps.watches) return false;
  return (await defaultMailbox(uid, deps)) !== null;
}

async function response(uid: string, deps: MatterDeps, extra: Partial<MatterWatchResponse> = {}): Promise<MatterWatchResponse> {
  const available = await watchAvailable(uid, deps);
  const items = deps.watches ? await waitingCards(uid, deps.watches, deps) : [];
  return { available, address: available ? watchAddress(deps) : null, items, ...extra };
}

export function handleMatterWatch(callerIn: MatterCaller | null, data: unknown, deps: MatterDeps): Promise<MatterWatchResponse> {
  return readable(() => watchAction(callerIn, data, deps));
}

async function watchAction(callerIn: MatterCaller | null, data: unknown, deps: MatterDeps): Promise<MatterWatchResponse> {
  const parsed = matterWatchRequestSchema.safeParse(data);
  if (!parsed.success) {
    requireSignedIn(callerIn);
    throw matterError('invalid_request');
  }
  const request = parsed.data;
  if (request.action === 'list') {
    const caller = requireSignedIn(callerIn);
    return response(caller.uid, deps);
  }
  if (request.action === 'dismiss') {
    // the owner can always remove their own card: not tied to the switch or the tester list
    const caller = requireSignedIn(callerIn);
    const removed = deps.watches ? await deps.watches.remove(caller.uid, request.watchId) : false;
    logger.info('matters.watch_dismissed', { uid: caller.uid, removed });
    return response(caller.uid, deps);
  }
  const caller = requireCaller(callerIn, deps);
  if (!isValidTimeZone(request.timeZone)) throw matterError('invalid_request');
  await requireConsent(caller.uid, deps);
  const store = deps.watches;
  if (!store) throw matterError('not_configured');
  const now = deps.now();
  const nowIso = now.toISOString();
  const claimed = await store.claim(caller.uid, request.watchId, nowIso, new Date(now.getTime() - WATCH_CLAIM_MS).toISOString());
  if (claimed === 'missing') throw matterError('not_found', 'This email is no longer waiting.');
  if (claimed === 'busy') throw matterError('invalid_request', 'This email is being prepared. Try again in a moment.');
  if (claimed.expiresAt <= nowIso) {
    await store.remove(caller.uid, request.watchId);
    throw matterError('not_found', 'This email is no longer waiting.');
  }
  try {
    // the card's draft already exists: open it again (no model call)
    if (claimed.matterId !== null) {
      const existing = await draftOf(caller.uid, claimed, deps);
      if (!existing) {
        await store.remove(caller.uid, request.watchId);
        throw matterError('not_found', 'This email is no longer waiting.');
      }
      await store.release(request.watchId);
      return response(caller.uid, deps, { draft: draftView(claimed.matterId, existing, deps) });
    }
    const { matterId, doc } = await draftFromCard(caller, claimed, request.language, request.timeZone, deps);
    // one draft per card: the card stays ("draft ready") until that draft is confirmed or cancelled
    await store.setDraft(request.watchId, matterId, new Date(now.getTime() + WATCH_DRAFT_WAIT_DAYS * 86_400_000).toISOString());
    return response(caller.uid, deps, { draft: draftView(matterId, doc, deps) });
  } catch (error) {
    await store.release(request.watchId);
    throw error;
  }
}

/** The matter draft that answers a card: the usual limits, one model call, the forward as data. */
async function draftFromCard(caller: MatterCaller, card: WatchRecord, language: Language, timeZone: string, deps: MatterDeps): Promise<{ matterId: string; doc: MatterDoc }> {
  await requireRoomForMatter(caller.uid, deps);
  await consumeDaily(caller.uid, deps);
  const ownerEmail = verifiedEmail(caller);
  const ownerName = ownerDisplayName(caller.name, deps.domain);
  const mailbox = await defaultMailbox(caller.uid, deps);
  const prefs = await prefsOf(caller.uid, deps);
  const thread: ForwardedEmail = card.forwarded;
  const requestText = card.note.trim() || DEFAULT_REQUEST[language === 'es' ? 'es' : 'en'];
  const now = deps.now();
  let tokens: Tokens = null;
  const result = await runDraft(
    deps,
    caller.uid,
    { request: requestText, language, timeZone, ownerName, ownerEmail, now, domain: deps.domain, thread, defaults: prefs },
    (t) => {
      tokens = t;
    },
  );
  const nowIso = now.toISOString();
  const doc: MatterDoc = matterDocSchema.parse({
    status: 'draft',
    language,
    timeZone,
    request: requestText,
    source: 'text',
    ownerName,
    ownerEmail,
    ...draftFields(result, ownerEmail, language, schedulingFor(result.mandate, deps), mailbox, prefs.signature),
    usage: withModelCall(EMPTY_USAGE, tokens),
    mandateVersion: 1,
    confirmedHash: null,
    confirmedAt: null,
    firstSentAt: null,
    replyToken: (deps.newToken ?? newReplyToken)(),
    createdAt: nowIso,
    updatedAt: nowIso,
    endedAt: null,
    watch: thread,
  });
  const matterId = deps.store.newMatterId();
  if (!(await deps.store.createMatter(caller.uid, matterId, doc, event('created', nowIso, 'watch')))) {
    logger.warn('matters.draft_after_deletion', { uid: caller.uid });
    throw matterError('unauthenticated');
  }
  logger.info('matters.watch_drafted', { uid: caller.uid, matterId, complete: doc.mandate !== null, questions: doc.questions.length });
  return { matterId, doc };
}

/**
 * Connect Fathom storage (docs/v2/FATHOM-CONNECT.md section 4). Server only: firestore.rules
 * gives clients nothing on these collections.
 *
 * - fathomOAuthStates/{stateHash} = {uid, createdAt, expiresAt}: one pending authorization,
 *   single use, 10 minutes. stateHash = sha256 hex of `mg-fathom-state:v1:` + state.
 * - fathomHooks/{hookHash} = {uid, createdAt}: the webhook URL token -> uid. hookHash = sha256 hex
 *   of `mg-fathom-hook:v1:` + token. Fathom's payload never says whose webhook it is, so every
 *   user gets their own URL.
 * - fathomConnections/{uid}: {schemaVersion, hookHash, webhookId, sealedSecrets, connectedAt,
 *   updatedAt, lastEventAt, refreshLeaseUntil}. sealedSecrets is ONE AES-256-GCM blob (the
 *   summaries keyring, purpose fathomConnection:secrets, AAD `fathomConnection:` + uid) holding the
 *   access token, its expiry, the refresh token and the webhook's signing secret.
 *
 * Nothing here logs; callers log codes only.
 */
import { createHash, randomBytes } from 'node:crypto';

import type { Firestore } from 'firebase-admin/firestore';
import { z } from 'zod';

import { open, seal, type Keyring } from '../../shared/sealed';
import { FathomApiError, refreshTokens, type FathomClientConfig, type FathomTokens } from './api';

export const FATHOM_STATES_COLLECTION = 'fathomOAuthStates';
export const FATHOM_HOOKS_COLLECTION = 'fathomHooks';
export const FATHOM_CONNECTIONS_COLLECTION = 'fathomConnections';
export const FATHOM_SEAL_PURPOSE = 'fathomConnection:secrets';
export const FATHOM_STATE_TTL_MS = 10 * 60 * 1000;
/** A refresh holds the lease this long; a second caller waits instead of spending the refresh token twice. */
export const FATHOM_REFRESH_LEASE_MS = 20 * 1000;
/** An access token this close to expiry is refreshed first. */
const ACCESS_SKEW_MS = 60 * 1000;

const UID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const RANDOM_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const HEX64 = /^[0-9a-f]{64}$/;

export type FathomRandom = (size: number) => Uint8Array;
const defaultRandom: FathomRandom = (size) => randomBytes(size);

/** 32 random bytes, base64url (43 characters): a state or a hook token. */
export function newRandomToken(random: FathomRandom = defaultRandom): string {
  return Buffer.from(random(32)).toString('base64url');
}

export function isRandomToken(value: unknown): value is string {
  return typeof value === 'string' && RANDOM_TOKEN_PATTERN.test(value);
}

function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function stateHashOf(state: string): string {
  return sha256Hex(`mg-fathom-state:v1:${state}`);
}

export function hookHashOf(token: string): string {
  return sha256Hex(`mg-fathom-hook:v1:${token}`);
}

/** First 8 hex of a hook hash: the only hook-derived value logs may carry. */
export function hook8(hash: string): string {
  return HEX64.test(hash) ? hash.slice(0, 8) : 'invalid';
}

function assertUid(uid: string): void {
  if (typeof uid !== 'string' || !UID_PATTERN.test(uid)) throw new Error('summaries.fathom: invalid uid');
}

function aadOf(uid: string): string {
  return `fathomConnection:${uid}`;
}

// ---------------------------------------------------------------------------------------------
// Secrets blob
// ---------------------------------------------------------------------------------------------

const secretsSchema = z.object({
  accessToken: z.string().min(1),
  accessExpiresAtMs: z.number().int(),
  refreshToken: z.string().min(1),
  webhookSecret: z.string().nullable(),
});
export type FathomSecrets = z.infer<typeof secretsSchema>;

export function sealSecrets(keyring: Keyring, uid: string, secrets: FathomSecrets): string {
  assertUid(uid);
  return seal(keyring, FATHOM_SEAL_PURPOSE, JSON.stringify(secrets), aadOf(uid));
}

/** Opens the blob; throws SealedError (bad key) or a plain Error (bad shape). */
export function openSecrets(keyring: Keyring, uid: string, blob: string): FathomSecrets {
  assertUid(uid);
  const parsed = secretsSchema.safeParse(JSON.parse(open(keyring, FATHOM_SEAL_PURPOSE, blob, aadOf(uid))));
  if (!parsed.success) throw new Error('summaries.fathom: the sealed secrets do not parse');
  return parsed.data;
}

// ---------------------------------------------------------------------------------------------
// Connection document
// ---------------------------------------------------------------------------------------------

export const FATHOM_CONNECTION_SCHEMA_VERSION = 1;

const connectionSchema = z.looseObject({
  schemaVersion: z.number().int(),
  hookHash: z.string().regex(HEX64),
  webhookId: z.string().min(1).max(200).nullable(),
  sealedSecrets: z.string().min(1),
  connectedAt: z.string(),
  updatedAt: z.string(),
  lastEventAt: z.string().nullable(),
  refreshLeaseUntil: z.string().nullable(),
});
export type FathomConnectionDoc = z.infer<typeof connectionSchema>;

export function parseConnection(raw: unknown): FathomConnectionDoc | null {
  const parsed = connectionSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function connectionRef(db: Firestore, uid: string) {
  assertUid(uid);
  return db.doc(`${FATHOM_CONNECTIONS_COLLECTION}/${uid}`);
}

export function hookRef(db: Firestore, hash: string) {
  if (!HEX64.test(hash)) throw new Error('summaries.fathom: invalid hook hash');
  return db.doc(`${FATHOM_HOOKS_COLLECTION}/${hash}`);
}

export function stateRef(db: Firestore, hash: string) {
  if (!HEX64.test(hash)) throw new Error('summaries.fathom: invalid state hash');
  return db.doc(`${FATHOM_STATES_COLLECTION}/${hash}`);
}

export async function readConnection(db: Firestore, uid: string): Promise<FathomConnectionDoc | null> {
  const snapshot = await connectionRef(db, uid).get();
  return snapshot.exists ? parseConnection(snapshot.data()) : null;
}

/** The uid a hook hash maps to, or null. */
export async function resolveHook(db: Firestore, hash: string): Promise<string | null> {
  const snapshot = await hookRef(db, hash).get();
  if (!snapshot.exists) return null;
  const uid = (snapshot.data() ?? {}).uid;
  return typeof uid === 'string' && UID_PATTERN.test(uid) ? uid : null;
}

// ---------------------------------------------------------------------------------------------
// OAuth state
// ---------------------------------------------------------------------------------------------

/** Writes a pending authorization and returns its state (goes into the authorize URL). */
export async function createState(db: Firestore, uid: string, now: Date, random?: FathomRandom): Promise<string> {
  assertUid(uid);
  const state = newRandomToken(random);
  await stateRef(db, stateHashOf(state)).set({
    uid,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + FATHOM_STATE_TTL_MS).toISOString(),
  });
  return state;
}

export type ConsumeStateResult = { ok: true; uid: string } | { ok: false; reason: 'bad_state' | 'unknown_state' | 'expired_state' };

/** Reads and deletes a state in one transaction (single use, whatever the outcome). */
export async function consumeState(db: Firestore, state: unknown, now: Date): Promise<ConsumeStateResult> {
  if (!isRandomToken(state)) return { ok: false, reason: 'bad_state' };
  const ref = stateRef(db, stateHashOf(state));
  return db.runTransaction(async (tx): Promise<ConsumeStateResult> => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) return { ok: false, reason: 'unknown_state' };
    tx.delete(ref);
    const data = snapshot.data() ?? {};
    const uid = data.uid;
    const expiresMs = typeof data.expiresAt === 'string' ? Date.parse(data.expiresAt) : Number.NaN;
    if (typeof uid !== 'string' || !UID_PATTERN.test(uid)) return { ok: false, reason: 'unknown_state' };
    if (!Number.isFinite(expiresMs) || expiresMs <= now.getTime()) return { ok: false, reason: 'expired_state' };
    return { ok: true, uid };
  });
}

// ---------------------------------------------------------------------------------------------
// Connect, disconnect
// ---------------------------------------------------------------------------------------------

export interface SaveConnectionInput {
  uid: string;
  hookHash: string;
  webhookId: string;
  tokens: FathomTokens;
  webhookSecret: string;
  keyring: Keyring;
  now: Date;
}

/**
 * Writes the new connection and its hook in one transaction, and deletes the previous connection's
 * hook (a reconnect gets a new URL; the old one then maps to nobody).
 */
export async function saveConnection(db: Firestore, input: SaveConnectionInput, previous: FathomConnectionDoc | null): Promise<void> {
  const nowIso = input.now.toISOString();
  const doc: FathomConnectionDoc = {
    schemaVersion: FATHOM_CONNECTION_SCHEMA_VERSION,
    hookHash: input.hookHash,
    webhookId: input.webhookId,
    sealedSecrets: sealSecrets(input.keyring, input.uid, {
      accessToken: input.tokens.accessToken,
      accessExpiresAtMs: input.tokens.accessExpiresAtMs,
      refreshToken: input.tokens.refreshToken,
      webhookSecret: input.webhookSecret,
    }),
    connectedAt: nowIso,
    updatedAt: nowIso,
    lastEventAt: null,
    refreshLeaseUntil: null,
  };
  await db.runTransaction(async (tx) => {
    if (previous !== null && previous.hookHash !== input.hookHash) tx.delete(hookRef(db, previous.hookHash));
    tx.set(hookRef(db, input.hookHash), { uid: input.uid, createdAt: nowIso });
    tx.set(connectionRef(db, input.uid), doc);
  });
}

/** Deletes the connection and its hook (no Fathom call; see disconnectFathom for the full flow). */
export async function deleteConnectionDocs(db: Firestore, uid: string): Promise<boolean> {
  const ref = connectionRef(db, uid);
  return db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) return false;
    const connection = parseConnection(snapshot.data());
    if (connection !== null) tx.delete(hookRef(db, connection.hookHash));
    tx.delete(ref);
    return true;
  });
}

/** Moves lastEventAt forward (best effort; the caller ignores a failure). */
export async function touchLastEvent(db: Firestore, uid: string, now: Date): Promise<void> {
  await connectionRef(db, uid).update({ lastEventAt: now.toISOString() });
}

// ---------------------------------------------------------------------------------------------
// Access token (refresh under a lease)
// ---------------------------------------------------------------------------------------------

export interface AccessTokenDeps {
  db: Firestore;
  keyring: Keyring;
  client: FathomClientConfig;
  now: () => Date;
  /** Test seam: waits between lease checks (setTimeout by default). */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A working access token for the connection: the stored one while it is valid, else a refresh.
 * The refresh token is single use, so only one caller refreshes at a time (a lease on the
 * connection document); another caller waits and reads the result. Throws FathomApiError when
 * Fathom refuses the refresh (the user revoked access), and a plain Error when there is no
 * connection or the lease never frees.
 */
export async function accessTokenFor(uid: string, deps: AccessTokenDeps): Promise<string> {
  const ref = connectionRef(deps.db, uid);
  const sleep = deps.sleep ?? defaultSleep;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const now = deps.now();
    const claim = await deps.db.runTransaction(async (tx) => {
      const snapshot = await tx.get(ref);
      const connection = snapshot.exists ? parseConnection(snapshot.data()) : null;
      if (connection === null) return { kind: 'missing' as const };
      const secrets = openSecrets(deps.keyring, uid, connection.sealedSecrets);
      if (secrets.accessExpiresAtMs - ACCESS_SKEW_MS > now.getTime()) return { kind: 'valid' as const, token: secrets.accessToken };
      const leaseMs = connection.refreshLeaseUntil === null ? Number.NaN : Date.parse(connection.refreshLeaseUntil);
      if (Number.isFinite(leaseMs) && leaseMs > now.getTime()) return { kind: 'busy' as const };
      tx.update(ref, { refreshLeaseUntil: new Date(now.getTime() + FATHOM_REFRESH_LEASE_MS).toISOString() });
      return { kind: 'refresh' as const, secrets };
    });
    if (claim.kind === 'missing') throw new Error('summaries.fathom: no connection');
    if (claim.kind === 'valid') return claim.token;
    if (claim.kind === 'busy') {
      await sleep(1500);
      continue;
    }
    let tokens: FathomTokens;
    try {
      tokens = await refreshTokens(deps.client, claim.secrets.refreshToken, deps.now().getTime());
    } catch (error) {
      // Free the lease so the next attempt (or a reconnect) is not blocked; the stored refresh
      // token may still be good after a network failure.
      try {
        await ref.update({ refreshLeaseUntil: null });
      } catch {
        // Best effort.
      }
      throw error instanceof FathomApiError ? error : new FathomApiError('network', null);
    }
    await ref.update({
      sealedSecrets: sealSecrets(deps.keyring, uid, {
        ...claim.secrets,
        accessToken: tokens.accessToken,
        accessExpiresAtMs: tokens.accessExpiresAtMs,
        refreshToken: tokens.refreshToken,
      }),
      refreshLeaseUntil: null,
      updatedAt: deps.now().toISOString(),
    });
    return tokens.accessToken;
  }
  throw new Error('summaries.fathom: the refresh lease did not free');
}

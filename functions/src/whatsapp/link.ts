/**
 * Account linking (docs/ARCHITECTURE.md §27): the app mints a 6-digit code (whatsappLinkStart),
 * the user sends it to the bot number, the webhook redeems it (session.ts). This module holds
 * the callable logic on injected ports plus the deleteAccount / unlink cleanup.
 *
 * - The code is crypto random, zero-padded, valid codeTtlMinutes, and stored ONLY as sha256
 *   (whatsappLinkCodes/{hash} = { uid, expiresAt }) for an O(1) webhook match. One active code
 *   per uid; minting again replaces it. At most codesPerUidPerDay codes per uid per UTC day.
 * - whatsappUsers/{uid} = { phoneE164|null, linkedAt|null, codeHash|null, codeExpiresAt|null,
 *   codeIssuesToday, lastCodeAt } is the reverse index + rate-limit state.
 * - Logs: uid and counts only; never codes, hashes or phone numbers (phoneLogId if ever needed).
 */
import { randomInt } from 'node:crypto';

import * as logger from 'firebase-functions/logger';
import { HttpsError } from 'firebase-functions/https';
import type { Firestore } from 'firebase-admin/firestore';

import { WHATSAPP_TUNING } from '../config';
import {
  WHATSAPP_ERROR_HTTPS_CODES,
  usageDayKey,
  type WhatsappErrorCode,
  type WhatsappLinkStartResponse,
  type WhatsappLinkStatusResponse,
  type WhatsappUnlinkResponse,
} from '../shared/aiContract';
import { hashLinkCode } from './signature';
import {
  WHATSAPP_LINKS_COLLECTION,
  WHATSAPP_LINK_CODES_COLLECTION,
  WHATSAPP_SESSIONS_COLLECTION,
  WHATSAPP_USERS_COLLECTION,
} from './session';

/** Every whatsapp* error carries details.reason (the app maps it to its own copy). */
export function whatsappError(reason: WhatsappErrorCode, message: string): HttpsError {
  return new HttpsError(WHATSAPP_ERROR_HTTPS_CODES[reason], message, { reason });
}

/** The whatsappUsers/{uid} document, leniently read. */
export interface WhatsappUserDoc {
  phoneE164: string | null;
  linkedAt: string | null;
  codeHash: string | null;
  codeExpiresAt: string | null;
  codeIssuesToday: number;
  lastCodeAt: string | null;
}

export function parseWhatsappUser(raw: unknown): WhatsappUserDoc {
  const data = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
  const count = data.codeIssuesToday;
  return {
    phoneE164: str(data.phoneE164),
    linkedAt: str(data.linkedAt),
    codeHash: str(data.codeHash),
    codeExpiresAt: str(data.codeExpiresAt),
    codeIssuesToday: typeof count === 'number' && Number.isInteger(count) && count > 0 ? count : 0,
    lastCodeAt: str(data.lastCodeAt),
  };
}

export interface LinkStore {
  /** Raw whatsappUsers/{uid} data, or undefined when missing. */
  getUser(uid: string): Promise<unknown>;
  /** Merge-writes whatsappUsers/{uid}. */
  mergeUser(uid: string, fields: Record<string, unknown>): Promise<void>;
  putLinkCode(codeHash: string, entry: { uid: string; expiresAt: string }): Promise<void>;
  deleteLinkCode(codeHash: string): Promise<void>;
  deleteLink(phoneE164: string): Promise<void>;
  deleteSession(phoneE164: string): Promise<void>;
  deleteUser(uid: string): Promise<void>;
}

export interface LinkDeps {
  store: LinkStore;
  now: () => Date;
  /** Test seam; crypto randomInt by default. */
  newCode?: () => string;
}

export function randomLinkCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

/** True when `lastCodeAt` falls on the same UTC day as `now`. */
function sameUtcDay(lastCodeAt: string | null, now: Date): boolean {
  if (lastCodeAt === null) return false;
  const parsed = Date.parse(lastCodeAt);
  return Number.isFinite(parsed) && usageDayKey(new Date(parsed)) === usageDayKey(now);
}

/**
 * whatsappLinkStart: mints a fresh code for the caller (replacing any active one) and returns
 * it in plain text exactly once. Throws rate_limited after codesPerUidPerDay codes in a UTC day.
 */
export async function handleLinkStart(uid: string, deps: LinkDeps): Promise<WhatsappLinkStartResponse> {
  const now = deps.now();
  const user = parseWhatsappUser(await deps.store.getUser(uid));
  const issuedToday = sameUtcDay(user.lastCodeAt, now) ? user.codeIssuesToday : 0;
  if (issuedToday >= WHATSAPP_TUNING.codesPerUidPerDay) {
    logger.info('whatsapp.link_code_rate_limited', { uid, issuedToday });
    throw whatsappError('rate_limited', 'Too many link codes today. Try again tomorrow.');
  }
  if (user.codeHash !== null) {
    // One active code per uid: the old one stops working the moment a new one is minted.
    await deps.store.deleteLinkCode(user.codeHash);
  }
  const code = (deps.newCode ?? randomLinkCode)();
  const codeHash = hashLinkCode(code);
  const expiresAtIso = new Date(now.getTime() + WHATSAPP_TUNING.codeTtlMinutes * 60_000).toISOString();
  await deps.store.putLinkCode(codeHash, { uid, expiresAt: expiresAtIso });
  await deps.store.mergeUser(uid, {
    codeHash,
    codeExpiresAt: expiresAtIso,
    codeIssuesToday: issuedToday + 1,
    lastCodeAt: now.toISOString(),
  });
  logger.info('whatsapp.link_code_minted', { uid, issuedToday: issuedToday + 1 });
  return { code, expiresAtIso };
}

/**
 * whatsappLinkStatus: answers from the params and Firestore only (no secrets, always deployed).
 * The param values are passed in so this stays pure.
 */
export async function handleLinkStatus(
  uid: string,
  config: { enabled: boolean; displayNumber: string },
  deps: LinkDeps,
): Promise<WhatsappLinkStatusResponse> {
  const user = parseWhatsappUser(await deps.store.getUser(uid));
  const digits = config.displayNumber.replace(/[^0-9]/g, '');
  const configured = config.enabled && digits.length >= 6;
  return {
    enabled: config.enabled,
    linked: user.phoneE164 !== null,
    displayNumber: configured ? digits : null,
    deepLink: configured ? `https://wa.me/${digits}` : null,
  };
}

/**
 * Removes every WhatsApp document of one uid: the link, the session, any active code and the
 * whatsappUsers doc itself. Idempotent (tolerates missing docs). Shared by the unlink callable
 * and the deleteAccount port. Returns whether a linked phone existed.
 */
export async function deleteWhatsAppDataForUid(uid: string, store: LinkStore): Promise<boolean> {
  const user = parseWhatsappUser(await store.getUser(uid));
  if (user.codeHash !== null) await store.deleteLinkCode(user.codeHash);
  if (user.phoneE164 !== null) {
    await store.deleteLink(user.phoneE164);
    await store.deleteSession(user.phoneE164);
  }
  await store.deleteUser(uid);
  return user.phoneE164 !== null;
}

/** whatsappUnlink: the trio delete above. */
export async function handleUnlink(uid: string, deps: LinkDeps): Promise<WhatsappUnlinkResponse> {
  const unlinked = await deleteWhatsAppDataForUid(uid, deps.store);
  logger.info('whatsapp.unlinked', { uid, hadLink: unlinked });
  return { unlinked };
}

// ---------------------------------------------------------------------------------------------
// Firestore adapter
// ---------------------------------------------------------------------------------------------

export function firestoreLinkStore(db: Firestore): LinkStore {
  return {
    async getUser(uid) {
      const snapshot = await db.doc(`${WHATSAPP_USERS_COLLECTION}/${uid}`).get();
      return snapshot.exists ? snapshot.data() : undefined;
    },
    async mergeUser(uid, fields) {
      await db.doc(`${WHATSAPP_USERS_COLLECTION}/${uid}`).set(fields, { merge: true });
    },
    async putLinkCode(codeHash, entry) {
      await db.doc(`${WHATSAPP_LINK_CODES_COLLECTION}/${codeHash}`).set(entry);
    },
    async deleteLinkCode(codeHash) {
      await db.doc(`${WHATSAPP_LINK_CODES_COLLECTION}/${codeHash}`).delete();
    },
    async deleteLink(phoneE164) {
      await db.doc(`${WHATSAPP_LINKS_COLLECTION}/${phoneE164}`).delete();
    },
    async deleteSession(phoneE164) {
      await db.doc(`${WHATSAPP_SESSIONS_COLLECTION}/${phoneE164}`).delete();
    },
    async deleteUser(uid) {
      await db.doc(`${WHATSAPP_USERS_COLLECTION}/${uid}`).delete();
    },
  };
}

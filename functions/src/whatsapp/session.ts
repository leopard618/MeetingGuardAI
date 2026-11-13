/**
 * WhatsApp bot Firestore state (docs/v1/ARCHITECTURE.md §27). ALL collections are server-only
 * (explicit deny blocks in firestore.rules, like zoomMeetings):
 *
 *   whatsappLinks/{phoneE164}     { uid, linkedAt, profileName|null }  phone -> uid
 *   whatsappUsers/{uid}           reverse index + code rate limit (see link.ts)
 *   whatsappLinkCodes/{sha256}    { uid, expiresAt }  one-time link codes (never stored plain)
 *   whatsappSessions/{phoneE164}  conversation state + per-phone daily counters
 *                                 + summaryOffer (M11, ids only; ../summaries/whatsappProtocol.ts)
 *   whatsappEvents/{sha256(wamid)} { receivedAt, expiresAt }  webhook dedupe markers
 *
 * phoneE164 is the digits-only wa_id from the Cloud API (Firestore-safe doc id). Phone numbers
 * never appear in logs (phoneLogId in ./signature.ts). The ports here are injected into the
 * webhook logic so unit tests run on in-memory fakes.
 */
import type { DocumentReference, Firestore } from 'firebase-admin/firestore';

import { WHATSAPP_TUNING } from '../config';
import { aiActionSchema, usageDayKey, type AiAction, type Language } from '../shared/aiContract';
// M11 (docs/v2/M11-DESIGN.md section 4.1 step 4): the summary offer's shape, ids only.
import { parseSummaryOffer, type SummaryOffer } from '../summaries/whatsappProtocol';

export const WHATSAPP_LINKS_COLLECTION = 'whatsappLinks';
export const WHATSAPP_USERS_COLLECTION = 'whatsappUsers';
export const WHATSAPP_LINK_CODES_COLLECTION = 'whatsappLinkCodes';
export const WHATSAPP_SESSIONS_COLLECTION = 'whatsappSessions';
export const WHATSAPP_EVENTS_COLLECTION = 'whatsappEvents';

export interface SessionTurn {
  role: 'user' | 'assistant';
  text: string;
  atIso: string;
}

export interface SessionCounts {
  /** UTC "YYYY-MM-DD" the counters belong to; a new day resets them. */
  day: string;
  /** Inbound messages processed today (the WHATSAPP_USER_DAILY_LIMIT counter). */
  inbound: number;
  /** "Link your account" replies sent to this (unlinked) phone today. */
  unlinkedReplies: number;
  /** Failed link-code redemptions today (codeFailuresPerPhonePerDay brute-force ceiling). */
  codeFailures: number;
}

export interface WhatsappSession {
  /** Linked uid, or null while the phone is not linked (counters still apply). */
  uid: string | null;
  /** Last turns, oldest first (at most WHATSAPP_TUNING.maxTurns). */
  turns: SessionTurn[];
  /** Proposed, not yet confirmed actions (contract-validated on read AND before execution). */
  pendingActions: AiAction[] | null;
  /** Random nonce inside the Confirm/Cancel button ids of the current proposal. */
  pendingNonce: string | null;
  /** wamid of the inbound message that produced the proposal (execution idempotency key). */
  promptMsgId: string | null;
  actionsExpireAt: string | null;
  /**
   * M11: the live suggested-tasks offer (ids only, its own expiresAt; never cleared by the idle
   * context reset). At most one of summaryOffer and pendingActions is armed: each arming write
   * clears the other in the same merge write.
   */
  summaryOffer: SummaryOffer | null;
  counts: SessionCounts;
  updatedAt: string;
}

export function emptySession(now: Date): WhatsappSession {
  return {
    uid: null,
    turns: [],
    pendingActions: null,
    pendingNonce: null,
    promptMsgId: null,
    actionsExpireAt: null,
    summaryOffer: null,
    counts: { day: usageDayKey(now), inbound: 0, unlinkedReplies: 0, codeFailures: 0 },
    updatedAt: now.toISOString(),
  };
}

/** Rolls the daily counters when the UTC day changed. Pure. */
export function rolledCounts(counts: SessionCounts, now: Date): SessionCounts {
  const day = usageDayKey(now);
  return counts.day === day ? counts : { day, inbound: 0, unlinkedReplies: 0, codeFailures: 0 };
}

/** Drops stale conversation context (idle longer than sessionTtlMinutes); counters survive. */
export function withFreshContext(session: WhatsappSession, now: Date): WhatsappSession {
  const updatedMs = Date.parse(session.updatedAt);
  const ttlMs = WHATSAPP_TUNING.sessionTtlMinutes * 60_000;
  const stale = !Number.isFinite(updatedMs) || now.getTime() - updatedMs > ttlMs;
  return {
    ...session,
    turns: stale ? [] : session.turns,
    pendingActions: stale ? null : session.pendingActions,
    pendingNonce: stale ? null : session.pendingNonce,
    promptMsgId: stale ? null : session.promptMsgId,
    actionsExpireAt: stale ? null : session.actionsExpireAt,
    counts: rolledCounts(session.counts, now),
  };
}

/** Appends a turn, keeping the last maxTurns. Pure. */
export function pushTurn(turns: readonly SessionTurn[], turn: SessionTurn): SessionTurn[] {
  return [...turns, turn].slice(-WHATSAPP_TUNING.maxTurns);
}

export type RedeemResult = { status: 'linked'; uid: string } | { status: 'expired' } | { status: 'invalid' };

export type ClaimResult =
  | { status: 'claimed'; uid: string; actions: AiAction[]; promptMsgId: string | null }
  | { status: 'none' }
  | { status: 'expired' };

/**
 * The session fields a normal conversation turn may write. The pending* fields are DELIBERATELY
 * absent: the webhook runs with real concurrency, and a full-document write from a stale
 * snapshot would resurrect a proposal that claimPendingActions already took (double execution)
 * or clear one a concurrent invocation just armed. Only three paths ever touch pending*:
 * savePendingProposal (arm), clearStalePending (conditional disarm) and claimPendingActions
 * (atomic take). Counters have their own atomic record* methods for the same reason.
 */
export interface SessionPatch {
  uid: string | null;
  turns: SessionTurn[];
  updatedAt: string;
}

/** The pending proposal savePendingProposal arms (claimed later by claimPendingActions). */
export interface PendingProposal {
  pendingActions: AiAction[];
  pendingNonce: string;
  promptMsgId: string | null;
  actionsExpireAt: string;
}

/** Builds the writable sub-view of a session snapshot. Pure. */
export function sessionPatch(session: WhatsappSession): SessionPatch {
  return { uid: session.uid, turns: session.turns, updatedAt: session.updatedAt };
}

export interface WhatsappStore {
  /** Marks the event processed; false when the marker already existed (Meta redelivery). */
  claimEvent(eventId: string, now: Date): Promise<boolean>;
  /** whatsappLinks/{phone}.uid, or null when the phone is not linked. */
  getLinkUid(phoneE164: string): Promise<string | null>;
  /**
   * Redeems a link code in ONE transaction: validates the code doc, writes the link + reverse
   * index, cleans up any previous link of the same uid or phone, stamps the session's uid
   * (dropping any proposal armed under a previous uid), deletes the code doc.
   */
  redeemLinkCode(codeHash: string, phoneE164: string, profileName: string | null, now: Date): Promise<RedeemResult>;
  getSession(phoneE164: string): Promise<WhatsappSession | null>;
  /** Atomically rolls the UTC day and increments counts.inbound; returns the NEW counters. */
  recordInbound(phoneE164: string, now: Date): Promise<SessionCounts>;
  /** Atomically increments counts.unlinkedReplies (same day roll); returns the new value. */
  recordUnlinkedReply(phoneE164: string, now: Date): Promise<number>;
  /** Atomically increments counts.codeFailures (same day roll); returns the new value. */
  recordCodeFailure(phoneE164: string, now: Date): Promise<number>;
  /** Merge-writes uid/turns/updatedAt. NEVER touches pending* or counts (see SessionPatch). */
  saveTurns(phoneE164: string, patch: SessionPatch): Promise<void>;
  /** Merge-writes the patch plus a complete new proposal (the only arming path). */
  savePendingProposal(phoneE164: string, patch: SessionPatch, proposal: PendingProposal): Promise<void>;
  /**
   * Merge-writes the patch and clears the pending* fields ONLY while the stored pendingNonce
   * still equals `expectedNonce` (the nonce this invocation's snapshot carried), inside a
   * transaction: a proposal armed by a CONCURRENT invocation survives a no-action turn.
   */
  clearStalePending(phoneE164: string, patch: SessionPatch, expectedNonce: string | null): Promise<void>;
  /**
   * Atomically takes the pending actions of a session (a confirm tap): clears the pending
   * fields inside a transaction so a double tap or a redelivered tap finds nothing to execute.
   * `nonce` null accepts whatever proposal is pending (the 1/2 text fallback).
   */
  claimPendingActions(phoneE164: string, nonce: string | null, now: Date): Promise<ClaimResult>;
  /** App language + time zone from users/{uid}/settings/preferences (defaults en/UTC). */
  getPreferences(uid: string): Promise<{ language: Language; timezone: string }>;
}

// ---------------------------------------------------------------------------------------------
// Lenient parsing of stored session docs (server-written, but tolerate drift)
// ---------------------------------------------------------------------------------------------

function parseTurns(raw: unknown): SessionTurn[] {
  if (!Array.isArray(raw)) return [];
  const turns: SessionTurn[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const turn = item as Record<string, unknown>;
    if ((turn.role === 'user' || turn.role === 'assistant') && typeof turn.text === 'string' && typeof turn.atIso === 'string') {
      turns.push({ role: turn.role, text: turn.text, atIso: turn.atIso });
    }
  }
  return turns.slice(-WHATSAPP_TUNING.maxTurns);
}

function parseActions(raw: unknown): AiAction[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const actions: AiAction[] = [];
  for (const item of raw) {
    const parsed = aiActionSchema.safeParse(item);
    if (parsed.success) actions.push(parsed.data);
  }
  return actions.length > 0 ? actions : null;
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function nonNegativeInt(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : 0;
}

export function parseSession(raw: unknown, now: Date): WhatsappSession {
  if (typeof raw !== 'object' || raw === null) return emptySession(now);
  const data = raw as Record<string, unknown>;
  const counts = (typeof data.counts === 'object' && data.counts !== null ? data.counts : {}) as Record<string, unknown>;
  return {
    uid: nullableString(data.uid),
    turns: parseTurns(data.turns),
    pendingActions: parseActions(data.pendingActions),
    pendingNonce: nullableString(data.pendingNonce),
    promptMsgId: nullableString(data.promptMsgId),
    actionsExpireAt: nullableString(data.actionsExpireAt),
    summaryOffer: parseSummaryOffer(data.summaryOffer),
    counts: {
      day: typeof counts.day === 'string' ? counts.day : usageDayKey(now),
      inbound: nonNegativeInt(counts.inbound),
      unlinkedReplies: nonNegativeInt(counts.unlinkedReplies),
      codeFailures: nonNegativeInt(counts.codeFailures),
    },
    updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : now.toISOString(),
  };
}

// ---------------------------------------------------------------------------------------------
// Firestore adapter
// ---------------------------------------------------------------------------------------------

const DAY_MS = 86_400_000;

/**
 * One transactional counter bump with the UTC day roll: concurrent webhook invocations can
 * never lose an increment (the caps are enforced on the value this returns). Deliberately does
 * NOT touch updatedAt: the conversation writes own the idle-staleness clock.
 */
async function bumpCounter(
  db: Firestore,
  ref: DocumentReference,
  field: 'inbound' | 'unlinkedReplies' | 'codeFailures',
  now: Date,
): Promise<SessionCounts> {
  return db.runTransaction(async (tx): Promise<SessionCounts> => {
    const snapshot = await tx.get(ref);
    const current = parseSession(snapshot.exists ? snapshot.data() : null, now);
    const counts = rolledCounts(current.counts, now);
    const next: SessionCounts = { ...counts, [field]: counts[field] + 1 };
    // A phone that only ever counts (unlinked, flood-capped) still gets a first updatedAt, or the
    // retention purge (which filters on that field) would never find its document.
    tx.set(ref, snapshot.exists ? { counts: next } : { counts: next, updatedAt: now.toISOString() }, { merge: true });
    return next;
  });
}

export function firestoreWhatsappStore(db: Firestore): WhatsappStore {
  const linkRef = (phone: string) => db.doc(`${WHATSAPP_LINKS_COLLECTION}/${phone}`);
  const userRef = (uid: string) => db.doc(`${WHATSAPP_USERS_COLLECTION}/${uid}`);
  const codeRef = (hash: string) => db.doc(`${WHATSAPP_LINK_CODES_COLLECTION}/${hash}`);
  const sessionRef = (phone: string) => db.doc(`${WHATSAPP_SESSIONS_COLLECTION}/${phone}`);
  const eventRef = (id: string) => db.doc(`${WHATSAPP_EVENTS_COLLECTION}/${id}`);

  return {
    async claimEvent(eventId, now) {
      try {
        await eventRef(eventId).create({
          receivedAt: now.toISOString(),
          expiresAt: new Date(now.getTime() + WHATSAPP_TUNING.eventTtlDays * DAY_MS).toISOString(),
        });
        return true;
      } catch (error) {
        // ALREADY_EXISTS (gRPC code 6 / string form): this wamid was processed before.
        const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : null;
        if (code === 6 || code === 'already-exists') return false;
        throw error;
      }
    },

    async getLinkUid(phoneE164) {
      const snapshot = await linkRef(phoneE164).get();
      if (!snapshot.exists) return null;
      const uid = (snapshot.data() as Record<string, unknown> | undefined)?.uid;
      return typeof uid === 'string' && uid.length > 0 ? uid : null;
    },

    redeemLinkCode(codeHash, phoneE164, profileName, now) {
      return db.runTransaction(async (tx): Promise<RedeemResult> => {
        const codeSnap = await tx.get(codeRef(codeHash));
        if (!codeSnap.exists) return { status: 'invalid' };
        const code = codeSnap.data() as Record<string, unknown> | undefined;
        const uid = typeof code?.uid === 'string' ? code.uid : null;
        const expiresAt = typeof code?.expiresAt === 'string' ? Date.parse(code.expiresAt) : NaN;
        if (uid === null) {
          tx.delete(codeRef(codeHash));
          return { status: 'invalid' };
        }
        if (!Number.isFinite(expiresAt) || expiresAt < now.getTime()) {
          tx.delete(codeRef(codeHash));
          return { status: 'expired' };
        }
        const [userSnap, linkSnap] = await Promise.all([tx.get(userRef(uid)), tx.get(linkRef(phoneE164))]);
        const nowIso = now.toISOString();
        // A previous phone of this uid: the new link replaces it.
        const previousPhone = (userSnap.data() as Record<string, unknown> | undefined)?.phoneE164;
        if (typeof previousPhone === 'string' && previousPhone.length > 0 && previousPhone !== phoneE164) {
          tx.delete(linkRef(previousPhone));
          tx.delete(sessionRef(previousPhone));
        }
        // A previous uid of this phone: clear its reverse index (the new link wins).
        const previousUid = (linkSnap.data() as Record<string, unknown> | undefined)?.uid;
        if (typeof previousUid === 'string' && previousUid.length > 0 && previousUid !== uid) {
          tx.set(userRef(previousUid), { phoneE164: null, linkedAt: null }, { merge: true });
        }
        tx.set(linkRef(phoneE164), { uid, linkedAt: nowIso, profileName: profileName ?? null });
        tx.set(userRef(uid), { phoneE164, linkedAt: nowIso, codeHash: null, codeExpiresAt: null }, { merge: true });
        // Stamp the session's uid in the SAME transaction and disarm any proposal that was
        // pending under a previous uid (it must never execute against the new account).
        tx.set(
          sessionRef(phoneE164),
          { uid, pendingActions: null, pendingNonce: null, promptMsgId: null, actionsExpireAt: null, summaryOffer: null, updatedAt: nowIso },
          { merge: true },
        );
        tx.delete(codeRef(codeHash));
        return { status: 'linked', uid };
      });
    },

    async getSession(phoneE164) {
      const snapshot = await sessionRef(phoneE164).get();
      return snapshot.exists ? parseSession(snapshot.data(), new Date()) : null;
    },

    recordInbound(phoneE164, now) {
      return bumpCounter(db, sessionRef(phoneE164), 'inbound', now);
    },

    async recordUnlinkedReply(phoneE164, now) {
      return (await bumpCounter(db, sessionRef(phoneE164), 'unlinkedReplies', now)).unlinkedReplies;
    },

    async recordCodeFailure(phoneE164, now) {
      return (await bumpCounter(db, sessionRef(phoneE164), 'codeFailures', now)).codeFailures;
    },

    async saveTurns(phoneE164, patch) {
      await sessionRef(phoneE164).set({ ...patch }, { merge: true });
    },

    async savePendingProposal(phoneE164, patch, proposal) {
      // M11: arming a proposal disarms the summary offer in the same write (one armed at a time).
      await sessionRef(phoneE164).set({ ...patch, ...proposal, summaryOffer: null }, { merge: true });
    },

    clearStalePending(phoneE164, patch, expectedNonce) {
      return db.runTransaction(async (tx): Promise<void> => {
        const snapshot = await tx.get(sessionRef(phoneE164));
        const current = parseSession(snapshot.exists ? snapshot.data() : null, new Date());
        const write: Record<string, unknown> = { ...patch };
        if (current.pendingNonce === expectedNonce) {
          write.pendingActions = null;
          write.pendingNonce = null;
          write.promptMsgId = null;
          write.actionsExpireAt = null;
        }
        tx.set(sessionRef(phoneE164), write, { merge: true });
      });
    },

    claimPendingActions(phoneE164, nonce, now) {
      return db.runTransaction(async (tx): Promise<ClaimResult> => {
        const snapshot = await tx.get(sessionRef(phoneE164));
        if (!snapshot.exists) return { status: 'none' };
        const session = parseSession(snapshot.data(), now);
        if (session.pendingActions === null || session.uid === null) return { status: 'none' };
        if (nonce !== null && session.pendingNonce !== nonce) return { status: 'none' };
        // Field-targeted clear: counters or turns written since this snapshot stay intact.
        tx.set(
          sessionRef(phoneE164),
          { pendingActions: null, pendingNonce: null, promptMsgId: null, actionsExpireAt: null, updatedAt: now.toISOString() },
          { merge: true },
        );
        const expiresMs = session.actionsExpireAt !== null ? Date.parse(session.actionsExpireAt) : NaN;
        if (!Number.isFinite(expiresMs) || expiresMs < now.getTime()) return { status: 'expired' };
        return { status: 'claimed', uid: session.uid, actions: session.pendingActions, promptMsgId: session.promptMsgId };
      });
    },

    async getPreferences(uid) {
      const snapshot = await db.doc(`users/${uid}/settings/preferences`).get();
      const data = (snapshot.exists ? snapshot.data() : {}) as Record<string, unknown>;
      const language: Language = data.language === 'es' ? 'es' : 'en';
      const timezone = typeof data.timezone === 'string' && data.timezone.length > 0 ? data.timezone : 'UTC';
      return { language, timezone };
    },
  };
}

// ---------------------------------------------------------------------------------------------
// M11: the suggested-tasks offer (docs/v2/M11-DESIGN.md section 4.1 steps 4 and 5)
// ---------------------------------------------------------------------------------------------

/**
 * The writes of session.summaryOffer. Ids only (../summaries/whatsappProtocol.ts). None of them
 * touches turns, updatedAt or the counters: nothing of the commitments exchange enters the
 * conversation (section 15 finding 9).
 */
export interface SummaryOfferStore {
  /**
   * Arms a new offer and disarms any pending proposal in the SAME merge write, as
   * savePendingProposal disarms the offer: concurrent invocations always leave exactly one armed.
   */
  armSummaryOffer(phoneE164: string, offer: SummaryOffer): Promise<void>;
  /** Replaces the stored offer only while it is still this offerId (a transaction); false otherwise. */
  refreshSummaryOffer(phoneE164: string, offer: SummaryOffer): Promise<boolean>;
  /** Clears the stored offer only while it is still `offerId` (a transaction); false otherwise. */
  clearSummaryOffer(phoneE164: string, offerId: string): Promise<boolean>;
}

export function firestoreSummaryOfferStore(db: Firestore): SummaryOfferStore {
  const sessionRef = (phone: string) => db.doc(`${WHATSAPP_SESSIONS_COLLECTION}/${phone}`);

  function conditional(phoneE164: string, offerId: string, next: SummaryOffer | null): Promise<boolean> {
    return db.runTransaction(async (tx): Promise<boolean> => {
      const snapshot = await tx.get(sessionRef(phoneE164));
      if (!snapshot.exists) return false;
      const current = parseSummaryOffer((snapshot.data() as Record<string, unknown> | undefined)?.summaryOffer);
      if (current === null || current.offerId !== offerId) return false;
      tx.set(sessionRef(phoneE164), { summaryOffer: next }, { merge: true });
      return true;
    });
  }

  return {
    async armSummaryOffer(phoneE164, offer) {
      await sessionRef(phoneE164).set(
        { summaryOffer: offer, pendingActions: null, pendingNonce: null, promptMsgId: null, actionsExpireAt: null },
        { merge: true },
      );
    },
    refreshSummaryOffer(phoneE164, offer) {
      return conditional(phoneE164, offer.offerId, offer);
    },
    clearSummaryOffer(phoneE164, offerId) {
      return conditional(phoneE164, offerId, null);
    },
  };
}

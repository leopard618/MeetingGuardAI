/**
 * M14: the guest link callables (./core.ts has the rules). No secrets, always deployed.
 * - guestLinkCreate / guestLinkRevoke: the signed-in owner, for their own meetings.
 * - guestView / guestRespond: the guest page, no sign-in (App Check cannot apply to a browser
 *   without the app), limited per IP and per link. CORS open: the page may be served from the
 *   Firebase Hosting site or from meetingguard.ai, and the token is the only key.
 *
 * Firestore (server only, firestore.rules): guestLinks/{hash}, guestMeetings/{uid}__{meetingId},
 * guestCounters/{key} (per-day counters with expiresAt); the answers live in
 * users/{uid}/guestResponses/{id} (owner read, the owner may only mark them seen or decided).
 */
import * as logger from 'firebase-functions/logger';
import { HttpsError, onCall } from 'firebase-functions/https';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, type Firestore } from 'firebase-admin/firestore';

import { FUNCTIONS_REGION } from '../config';
import { adminDb } from '../firebase';
import {
  guestLinkCreateRequestSchema,
  guestLinkRevokeRequestSchema,
  guestRespondRequestSchema,
  guestResponseDocSchema,
  guestViewRequestSchema,
  type GuestLinkCreateResponse,
  type GuestLinkRevokeResponse,
  type GuestRespondResponse,
  type GuestViewResponse,
} from '../shared/aiContract';
import { GuestError, handleLinkCreate, handleLinkRevoke, handleRespond, handleView, linkHashOf, type GuestDeps, type GuestLinkRecord, type GuestStore } from './core';

export const GUEST_LINKS_COLLECTION = 'guestLinks';
export const GUEST_MEETINGS_COLLECTION = 'guestMeetings';
export const GUEST_COUNTERS_COLLECTION = 'guestCounters';
export const GUEST_RESPONSES_SUBCOLLECTION = 'guestResponses';

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function firestoreGuestStore(db: Firestore): GuestStore {
  const linkRef = (hash: string) => db.doc(`${GUEST_LINKS_COLLECTION}/${hash}`);
  const meetingRef = (uid: string, meetingId: string) => db.doc(`${GUEST_MEETINGS_COLLECTION}/${uid}__${meetingId}`);
  return {
    async getMeetingToken(uid, meetingId) {
      const snapshot = await meetingRef(uid, meetingId).get();
      if (!snapshot.exists) return null;
      const data = snapshot.data() as Record<string, unknown>;
      const token = str(data.token);
      const expiresAt = str(data.expiresAt);
      return token !== null && expiresAt !== null ? { token, expiresAt } : null;
    },
    async saveLink(token, record) {
      const batch = db.batch();
      batch.set(linkRef(linkHashOf(token)), { v: 1, ...record });
      batch.set(meetingRef(record.uid, record.meetingId), { v: 1, uid: record.uid, meetingId: record.meetingId, token, linkHash: linkHashOf(token), createdAt: record.createdAt, expiresAt: record.expiresAt });
      await batch.commit();
    },
    revoke(uid, meetingId, now) {
      return db.runTransaction(async (tx) => {
        const snapshot = await tx.get(meetingRef(uid, meetingId));
        if (!snapshot.exists) return false;
        const hash = str((snapshot.data() as Record<string, unknown>).linkHash);
        if (hash !== null) tx.set(linkRef(hash), { revokedAt: now.toISOString() }, { merge: true });
        tx.delete(meetingRef(uid, meetingId));
        return true;
      });
    },
    async getLink(hash) {
      const snapshot = await linkRef(hash).get();
      if (!snapshot.exists) return null;
      const d = snapshot.data() as Record<string, unknown>;
      const uid = str(d.uid);
      const meetingId = str(d.meetingId);
      const expiresAt = str(d.expiresAt);
      if (uid === null || meetingId === null || expiresAt === null) return null;
      return { uid, meetingId, createdAt: str(d.createdAt) ?? '', expiresAt, revokedAt: str(d.revokedAt) } satisfies GuestLinkRecord;
    },
    async bump(key, now) {
      const id = key.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 200);
      const ref = db.doc(`${GUEST_COUNTERS_COLLECTION}/${id}`);
      await ref.set({ count: FieldValue.increment(1), expiresAt: new Date(now.getTime() + 2 * 86_400_000).toISOString() }, { merge: true });
      const snapshot = await ref.get();
      const count = (snapshot.data() as Record<string, unknown> | undefined)?.count;
      return typeof count === 'number' ? count : 1;
    },
    async getMeeting(uid, meetingId) {
      const snapshot = await db.doc(`users/${uid}/meetings/${meetingId}`).get();
      return snapshot.exists ? (snapshot.data() as Record<string, unknown>) : undefined;
    },
    async getOwner(uid) {
      const [user, prefs] = await Promise.all([
        getAuth()
          .getUser(uid)
          .catch(() => null),
        db.doc(`users/${uid}/settings/preferences`).get(),
      ]);
      const language = prefs.exists ? str((prefs.data() as Record<string, unknown>).language) : null;
      const name = user?.displayName?.trim() ? user.displayName.trim().slice(0, 120) : null;
      return { name, language };
    },
    async getResponse(uid, responseId) {
      const snapshot = await db.doc(`users/${uid}/${GUEST_RESPONSES_SUBCOLLECTION}/${responseId}`).get();
      if (!snapshot.exists) return null;
      const parsed = guestResponseDocSchema.safeParse(snapshot.data());
      return parsed.success ? parsed.data : null;
    },
    async saveResponse(uid, responseId, doc) {
      await db.doc(`users/${uid}/${GUEST_RESPONSES_SUBCOLLECTION}/${responseId}`).set(doc);
    },
  };
}

function deps(): GuestDeps {
  return { store: firestoreGuestStore(adminDb()), now: () => new Date(), log: (event, fields) => logger.info(event, fields) };
}

function guestHttpsError(error: unknown): never {
  if (error instanceof GuestError) {
    throw new HttpsError(error.reason === 'rate_limited' ? 'resource-exhausted' : 'invalid-argument', error.reason, { reason: error.reason });
  }
  throw error;
}

const OWNER_OPTIONS = { region: FUNCTIONS_REGION, enforceAppCheck: false, timeoutSeconds: 15, memory: '256MiB', maxInstances: 10 } as const;
const GUEST_OPTIONS = { region: FUNCTIONS_REGION, enforceAppCheck: false, cors: true, timeoutSeconds: 10, memory: '256MiB', maxInstances: 10 } as const;

/**
 * The address the limits count. Google's front end APPENDS the caller's address to
 * X-Forwarded-For (anything before it is what the caller sent), followed by its own hop, so the
 * entry before the last one is the real client; a single entry is that client. Anything
 * unreadable shares one bucket, never "no limit".
 */
export function clientIpOf(rawRequest: { ip?: string; headers?: Record<string, unknown> } | undefined): string {
  const forwarded = rawRequest?.headers?.['x-forwarded-for'];
  const entries = typeof forwarded === 'string' ? forwarded.split(',').map((entry) => entry.trim()).filter(Boolean) : [];
  const candidate = entries.length >= 2 ? entries[entries.length - 2] : entries[0] ?? rawRequest?.ip ?? '';
  return candidate && /^[0-9A-Fa-f:.]{2,45}$/.test(candidate) ? candidate : 'unknown';
}

export const guestLinkCreate = onCall(OWNER_OPTIONS, async (request): Promise<GuestLinkCreateResponse> => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  const parsed = guestLinkCreateRequestSchema.safeParse(request.data ?? {});
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid guestLinkCreate request.');
  return handleLinkCreate(request.auth.uid, parsed.data.meetingId, deps());
});

export const guestLinkRevoke = onCall(OWNER_OPTIONS, async (request): Promise<GuestLinkRevokeResponse> => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  const parsed = guestLinkRevokeRequestSchema.safeParse(request.data ?? {});
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid guestLinkRevoke request.');
  return handleLinkRevoke(request.auth.uid, parsed.data.meetingId, deps());
});

export const guestView = onCall(GUEST_OPTIONS, async (request): Promise<GuestViewResponse> => {
  const parsed = guestViewRequestSchema.safeParse(request.data ?? {});
  if (!parsed.success) throw new HttpsError('invalid-argument', 'invalid_request', { reason: 'invalid_request' });
  try {
    return await handleView(parsed.data, clientIpOf(request.rawRequest as never), deps());
  } catch (error) {
    guestHttpsError(error);
  }
});

export const guestRespond = onCall(GUEST_OPTIONS, async (request): Promise<GuestRespondResponse> => {
  const parsed = guestRespondRequestSchema.safeParse(request.data ?? {});
  if (!parsed.success) throw new HttpsError('invalid-argument', 'invalid_request', { reason: 'invalid_request' });
  try {
    return await handleRespond(parsed.data, clientIpOf(request.rawRequest as never), deps());
  } catch (error) {
    guestHttpsError(error);
  }
});

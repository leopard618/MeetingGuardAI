/**
 * `deleteAccount` callable: permanently deletes the caller's data and Firebase Auth user.
 *
 * Order:
 *   0. record the deletion (accountDeletions/{uid} = { deletedAt }): the anonymous user id and the
 *      time, so a restore from a backup can re-apply the deletion (maintenance/core.ts); the
 *      record is purged after DELETION_LOG_RETENTION_DAYS;
 *   1. revoke the user's refresh tokens: no device can mint a new ID token any more, so offline
 *      devices with queued writes can only write while their current ID token lives (<= 1 h);
 *   2. users/{uid} (recursively: profile, meetings, notes, settings, assistant matters with their
 *      timelines and emails) -> entitlements/{uid} -> usage/{uid} (recursively) -> the server-only
 *      state that carries the uid (WhatsApp, Zoom, Microsoft, the matters' lookup documents);
 *   3. the Auth user;
 *   4. a second recursive pass over users/{uid}: writes that raced in while steps 2-3 ran (an
 *      outbox flush of this or another device, rules still accept the old ID token) are removed.
 * Idempotent: every step tolerates data or users that are already gone, so the app can retry
 * after a partial failure (the caller's ID token stays valid for up to an hour).
 *
 * Requires a RECENT sign-in (auth_time within RECENT_LOGIN_MAX_AGE_SECONDS), like Firebase's own
 * deleteUser: a stolen or long-lived session alone cannot destroy the account. The app
 * re-authenticates the user (Google account picker / password) right before calling it; otherwise
 * the call fails with failed-precondition and details.reason "requires_recent_login".
 *
 * App Check: see the note in assistant/index.ts (`enforceAppCheck` is off until the app ships
 * an attestation provider).
 */
import * as logger from 'firebase-functions/logger';
import { HttpsError, onCall } from 'firebase-functions/https';

import { FUNCTIONS_REGION } from './config';
import { adminAuth, adminDb } from './firebase';
import { ACCOUNT_DELETIONS_COLLECTION } from './maintenance/core';
import { MATTER_ADDRESSES_COLLECTION, MATTER_MESSAGE_IDS_COLLECTION } from './matters/model';
import { MICROSOFT_IDENTITIES_COLLECTION } from './microsoftSignIn';
import { deleteAccountRequestSchema, type DeleteAccountResponse } from './shared/aiContract';
import { deleteWhatsAppDataForUid, firestoreLinkStore } from './whatsapp/link';
import { ZOOM_OWNERS_COLLECTION } from './zoom/handler';

export interface AccountDeletionPorts {
  /** Writes (or overwrites) the deletion record of the user. */
  recordDeletion(uid: string, deletedAtIso: string): Promise<void>;
  /** Deletes a document and all of its subcollections (no-op when nothing exists). */
  recursiveDelete(path: string): Promise<void>;
  /** Deletes one document (no-op when missing). */
  deleteDocument(path: string): Promise<void>;
  /** Deletes the Auth user; resolves `false` when the user no longer exists. */
  deleteAuthUser(uid: string): Promise<boolean>;
  /** Revokes every refresh token of the user; resolves `false` when the user no longer exists. */
  revokeRefreshTokens(uid: string): Promise<boolean>;
  /**
   * Removes the user's WhatsApp link state (whatsappLinks/{phone}, whatsappSessions/{phone},
   * whatsappUsers/{uid}, any active link code; docs/v1/ARCHITECTURE.md §27). Idempotent.
   */
  deleteWhatsAppData(uid: string): Promise<void>;
  /**
   * Removes the user's zoomMeetings/{id} ownership entries and records their ids on the deletion
   * record (this function holds no Zoom secrets; an owner script deletes the host-side meetings).
   */
  deleteZoomRegistry(uid: string): Promise<void>;
  /**
   * Removes the user's Sign in with Microsoft identities (microsoftIdentities/{oid} with this
   * uid; docs/v1/ARCHITECTURE.md §31), so the Microsoft account can sign up afresh. Idempotent.
   */
  deleteMicrosoftIdentities(uid: string): Promise<void>;
  /**
   * Removes the lookup documents of the user's assistant matters (matterAddresses/{token} and
   * matterMessageIds/{key} with this uid; docs/v1/ARCHITECTURE.md §36). The matters themselves
   * live under users/{uid} and go with the recursive delete. Idempotent.
   */
  deleteMatterLookups(uid: string): Promise<void>;
}

export async function deleteAccountData(uid: string, ports: AccountDeletionPorts, now: Date = new Date()): Promise<DeleteAccountResponse> {
  // First, so a restore can always re-apply this deletion (even after a partial failure).
  await ports.recordDeletion(uid, now.toISOString());
  await ports.revokeRefreshTokens(uid);
  await ports.recursiveDelete(`users/${uid}`);
  await ports.deleteDocument(`entitlements/${uid}`);
  await ports.recursiveDelete(`usage/${uid}`);
  await ports.deleteWhatsAppData(uid);
  await ports.deleteZoomRegistry(uid);
  await ports.deleteMicrosoftIdentities(uid);
  await ports.deleteMatterLookups(uid);
  await ports.deleteAuthUser(uid);
  // Late writes accepted between the first pass and the Auth deletion (see the header).
  await ports.recursiveDelete(`users/${uid}`);
  return { deleted: true };
}

export function isUserNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'auth/user-not-found';
}

export function firebaseAccountDeletionPorts(): AccountDeletionPorts {
  const db = adminDb();
  const auth = adminAuth();
  return {
    async recordDeletion(uid, deletedAtIso) {
      await db.collection(ACCOUNT_DELETIONS_COLLECTION).doc(uid).set({ deletedAt: deletedAtIso });
    },
    async recursiveDelete(path) {
      await db.recursiveDelete(db.doc(path));
    },
    async deleteDocument(path) {
      await db.doc(path).delete();
    },
    async deleteAuthUser(uid) {
      try {
        await auth.deleteUser(uid);
        return true;
      } catch (error) {
        if (isUserNotFound(error)) return false;
        throw error;
      }
    },
    async revokeRefreshTokens(uid) {
      try {
        await auth.revokeRefreshTokens(uid);
        return true;
      } catch (error) {
        if (isUserNotFound(error)) return false;
        throw error;
      }
    },
    async deleteWhatsAppData(uid) {
      await deleteWhatsAppDataForUid(uid, firestoreLinkStore(db));
    },
    async deleteZoomRegistry(uid) {
      const snapshot = await db.collection(ZOOM_OWNERS_COLLECTION).where('uid', '==', uid).select().get();
      if (snapshot.empty) return;
      const ids = snapshot.docs.map((document) => document.id);
      for (let start = 0; start < snapshot.docs.length; start += 400) {
        const batch = db.batch();
        for (const document of snapshot.docs.slice(start, start + 400)) batch.delete(document.ref);
        await batch.commit();
      }
      await db.collection(ACCOUNT_DELETIONS_COLLECTION).doc(uid).set({ zoomMeetingIds: ids }, { merge: true });
    },
    async deleteMicrosoftIdentities(uid) {
      const snapshot = await db.collection(MICROSOFT_IDENTITIES_COLLECTION).where('uid', '==', uid).select().get();
      if (snapshot.empty) return;
      for (let start = 0; start < snapshot.docs.length; start += 400) {
        const batch = db.batch();
        for (const document of snapshot.docs.slice(start, start + 400)) batch.delete(document.ref);
        await batch.commit();
      }
    },
    async deleteMatterLookups(uid) {
      for (const name of [MATTER_ADDRESSES_COLLECTION, MATTER_MESSAGE_IDS_COLLECTION]) {
        const snapshot = await db.collection(name).where('uid', '==', uid).select().get();
        for (let start = 0; start < snapshot.docs.length; start += 400) {
          const batch = db.batch();
          for (const document of snapshot.docs.slice(start, start + 400)) batch.delete(document.ref);
          await batch.commit();
        }
      }
    },
  };
}

/** How old the caller's sign-in may be (seconds). */
export const RECENT_LOGIN_MAX_AGE_SECONDS = 5 * 60;

export interface DeletionCaller {
  uid: string;
  /** request.auth.token.auth_time (seconds since epoch): when the user last signed in. */
  authTimeSeconds: number | null;
}

export function isRecentLogin(caller: DeletionCaller, nowMs: number): boolean {
  if (caller.authTimeSeconds === null || !Number.isFinite(caller.authTimeSeconds)) return false;
  const ageSeconds = nowMs / 1000 - caller.authTimeSeconds;
  // A little clock skew into the future is tolerated.
  return ageSeconds <= RECENT_LOGIN_MAX_AGE_SECONDS && ageSeconds >= -60;
}

export async function handleDeleteAccount(
  caller: DeletionCaller | null,
  data: unknown,
  ports: () => AccountDeletionPorts,
  now: () => number = () => Date.now(),
): Promise<DeleteAccountResponse> {
  if (!caller) throw new HttpsError('unauthenticated', 'Sign in to delete your account.');
  const uid = caller.uid;
  if (!deleteAccountRequestSchema.safeParse(data).success) {
    throw new HttpsError('invalid-argument', 'Account deletion must be confirmed.');
  }
  if (!isRecentLogin(caller, now())) {
    logger.info('deleteAccount.requires_recent_login', { uid });
    throw new HttpsError('failed-precondition', 'Sign in again to delete your account.', {
      reason: 'requires_recent_login',
    });
  }
  try {
    const result = await deleteAccountData(uid, ports(), new Date(now()));
    logger.info('deleteAccount.completed', { uid });
    return result;
  } catch (error) {
    logger.error('deleteAccount.failed', {
      uid,
      errorName: error instanceof Error ? error.name : typeof error,
      errorMessage: error instanceof Error ? error.message.slice(0, 300) : '',
    });
    throw new HttpsError('internal', 'Account deletion failed. Please try again.');
  }
}

export const deleteAccount = onCall(
  {
    region: FUNCTIONS_REGION,
    enforceAppCheck: false,
    timeoutSeconds: 300,
    memory: '256MiB',
    maxInstances: 10,
  },
  (request): Promise<DeleteAccountResponse> =>
    handleDeleteAccount(
      request.auth
        ? {
            uid: request.auth.uid,
            authTimeSeconds: typeof request.auth.token.auth_time === 'number' ? request.auth.token.auth_time : null,
          }
        : null,
      request.data,
      firebaseAccountDeletionPorts,
    ),
);

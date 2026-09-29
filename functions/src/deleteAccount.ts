/**
 * `deleteAccount` callable: permanently deletes the caller's data and Firebase Auth user.
 *
 * Order:
 *   1. revoke the user's refresh tokens: no device can mint a new ID token any more, so offline
 *      devices with queued writes can only write while their current ID token lives (<= 1 h);
 *   2. users/{uid} (recursively: profile, meetings, notes, settings) -> entitlements/{uid} ->
 *      usage/{uid} (recursively);
 *   3. the Auth user;
 *   4. a second recursive pass over users/{uid}: writes that raced in while steps 2-3 ran (an
 *      outbox flush of this or another device, rules still accept the old ID token) are removed.
 * Idempotent: every step tolerates data or users that are already gone, so the app can retry
 * after a partial failure (the caller's ID token stays valid for up to an hour).
 *
 * App Check: see the note in assistant/index.ts (`enforceAppCheck` is off until the app ships
 * an attestation provider).
 */
import * as logger from 'firebase-functions/logger';
import { HttpsError, onCall } from 'firebase-functions/https';

import { FUNCTIONS_REGION } from './config';
import { adminAuth, adminDb } from './firebase';
import { deleteAccountRequestSchema, type DeleteAccountResponse } from './shared/aiContract';

export interface AccountDeletionPorts {
  /** Deletes a document and all of its subcollections (no-op when nothing exists). */
  recursiveDelete(path: string): Promise<void>;
  /** Deletes one document (no-op when missing). */
  deleteDocument(path: string): Promise<void>;
  /** Deletes the Auth user; resolves `false` when the user no longer exists. */
  deleteAuthUser(uid: string): Promise<boolean>;
  /** Revokes every refresh token of the user; resolves `false` when the user no longer exists. */
  revokeRefreshTokens(uid: string): Promise<boolean>;
}

export async function deleteAccountData(uid: string, ports: AccountDeletionPorts): Promise<DeleteAccountResponse> {
  await ports.revokeRefreshTokens(uid);
  await ports.recursiveDelete(`users/${uid}`);
  await ports.deleteDocument(`entitlements/${uid}`);
  await ports.recursiveDelete(`usage/${uid}`);
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
  };
}

export async function handleDeleteAccount(
  uid: string | null,
  data: unknown,
  ports: () => AccountDeletionPorts,
): Promise<DeleteAccountResponse> {
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in to delete your account.');
  if (!deleteAccountRequestSchema.safeParse(data).success) {
    throw new HttpsError('invalid-argument', 'Account deletion must be confirmed.');
  }
  try {
    const result = await deleteAccountData(uid, ports());
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
    handleDeleteAccount(request.auth?.uid ?? null, request.data, firebaseAccountDeletionPorts),
);

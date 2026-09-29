/**
 * Lazily initialized Admin SDK (so pure modules and unit tests never touch Firebase).
 * In Cloud Functions and the emulator, `initializeApp()` picks up the project config automatically.
 */
import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

function ensureApp(): void {
  if (getApps().length === 0) initializeApp();
}

export function adminDb(): Firestore {
  ensureApp();
  return getFirestore();
}

export function adminAuth(): Auth {
  ensureApp();
  return getAuth();
}

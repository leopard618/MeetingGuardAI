/**
 * Lazily initialized Admin SDK (so pure modules and unit tests never touch Firebase).
 * In Cloud Functions and the emulator, `initializeApp()` picks up the project config automatically.
 */
import { getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

let defaultApp: App | undefined;

/**
 * The firebase-functions runtime registers its own NAMED admin app for callable token
 * verification, so `getApps().length` alone is a broken guard: it can be non-zero while the
 * DEFAULT app still does not exist (seen in production as app/no-app from getFirestore()).
 * Look for the default app explicitly and always hand the resolved app to the services.
 */
function ensureApp(): App {
  if (!defaultApp) {
    defaultApp = getApps().find((a) => a.name === '[DEFAULT]') ?? initializeApp();
  }
  return defaultApp;
}

export function adminDb(): Firestore {
  return getFirestore(ensureApp());
}

export function adminAuth(): Auth {
  return getAuth(ensureApp());
}

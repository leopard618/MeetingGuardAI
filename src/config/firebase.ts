/**
 * Firebase (JS SDK v12) for React Native.
 *
 * - Config comes only from the public EXPO_PUBLIC_FIREBASE_* values (src/config/env.ts).
 * - Never crashes at import: when the config is incomplete every export is null and
 *   `isFirebaseConfigured` is false (App.js then shows the "App not configured" screen).
 * - Auth uses AsyncStorage persistence (getReactNativePersistence) so sessions survive restarts.
 * - Firestore: memory cache (IndexedDB persistence does not exist in React Native) and
 *   `ignoreUndefinedProperties` so optional fields left `undefined` no longer make writes fail.
 *
 * Always import from 'firebase/auth' - never from '@firebase/auth' (tsconfig maps that name to
 * the React Native typings only).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import {
  connectAuthEmulator,
  getAuth,
  getReactNativePersistence,
  initializeAuth,
  type Auth,
} from 'firebase/auth';
import {
  connectFirestoreEmulator,
  getFirestore,
  initializeFirestore,
  memoryLocalCache,
  type Firestore,
} from 'firebase/firestore';
import { connectFunctionsEmulator, getFunctions, type Functions } from 'firebase/functions';

import { createLogger } from '../core/logger';
import { env } from './env';

const log = createLogger('firebase');

export const isFirebaseConfigured: boolean = env.isFirebaseConfigured;

function createAuth(firebaseApp: FirebaseApp): Auth {
  try {
    return initializeAuth(firebaseApp, {
      persistence: getReactNativePersistence(AsyncStorage),
    });
  } catch {
    // Already initialized (e.g. module re-evaluated by Fast Refresh).
    return getAuth(firebaseApp);
  }
}

function createFirestore(firebaseApp: FirebaseApp): Firestore {
  try {
    return initializeFirestore(firebaseApp, {
      ignoreUndefinedProperties: true,
      localCache: memoryLocalCache(),
    });
  } catch {
    return getFirestore(firebaseApp);
  }
}

interface FirebaseServices {
  app: FirebaseApp;
  auth: Auth;
  db: Firestore;
  functions: Functions;
}

let emulatorsConnected = false;

function connectEmulators(services: FirebaseServices): void {
  if (!__DEV__ || !env.useEmulators || emulatorsConnected) return;
  const host = env.emulatorHost;
  try {
    connectAuthEmulator(services.auth, `http://${host}:9099`, { disableWarnings: true });
    connectFirestoreEmulator(services.db, host, 8080);
    connectFunctionsEmulator(services.functions, host, 5001);
    emulatorsConnected = true;
    log.warn(`Using local emulators on ${host}`);
  } catch (error) {
    log.error('Could not connect to the emulators', error);
  }
}

function initFirebase(): FirebaseServices | null {
  if (!env.firebase) return null;
  try {
    const firebaseApp = getApps().length > 0 ? getApp() : initializeApp(env.firebase);
    const services: FirebaseServices = {
      app: firebaseApp,
      auth: createAuth(firebaseApp),
      db: createFirestore(firebaseApp),
      functions: getFunctions(firebaseApp, env.functionsRegion),
    };
    connectEmulators(services);
    return services;
  } catch (error) {
    log.error('Initialization failed', error);
    return null;
  }
}

const services = initFirebase();

/** True when Firebase was initialized successfully (config present and init did not fail). */
export const isFirebaseReady: boolean = services !== null;

export const app: FirebaseApp | null = services?.app ?? null;
export const auth: Auth | null = services?.auth ?? null;
export const db: Firestore | null = services?.db ?? null;
export const functions: Functions | null = services?.functions ?? null;

export default app;

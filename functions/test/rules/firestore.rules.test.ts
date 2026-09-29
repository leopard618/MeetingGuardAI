/**
 * Firestore security rules tests (emulator only):
 *   npm run test:rules      (from functions/; needs Java 21+ and firebase-tools)
 * `firebase emulators:exec` sets FIRESTORE_EMULATOR_HOST, which the test environment picks up.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, getDocs, collection, setDoc, updateDoc, type Firestore } from 'firebase/firestore';

const PROJECT_ID = 'demo-meetingguard';
const ISO = '2026-10-05T14:00:00.000Z';

let env: RulesTestEnvironment;

function meeting(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    userId: 'alice',
    title: 'Standup',
    description: '',
    startAt: ISO,
    durationMinutes: 15,
    timezone: 'Europe/Madrid',
    allDay: false,
    date: '2026-10-05',
    time: '16:00',
    location: { type: 'physical', address: 'Room 1', virtualUrl: null },
    conference: { provider: 'google_meet', url: null, password: null },
    participants: [{ email: 'ana@example.com', name: null, status: null }],
    source: 'manual',
    confidence: null,
    language: 'en',
    preparationTips: [],
    customAlertTimes: null,
    alertIntensity: null,
    notes: null,
    status: 'scheduled',
    external: {
      googleEventId: null,
      googleCalendarId: null,
      googleEtag: null,
      googleUpdatedAt: null,
      deviceEventId: null,
      deviceCalendarId: null,
    },
    createdAt: ISO,
    updatedAt: ISO,
    deletedAt: null,
    ...overrides,
  };
}

function preferences(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    language: 'es',
    timezone: 'America/Bogota',
    alertEnabled: true,
    alertIntensity: 'max',
    alertSoundType: 'voice_and_sound',
    alertVolume: 0.8,
    vibrationEnabled: true,
    defaultAlertTimes: [15, 5, 0],
    snoozeMinutes: 5,
    followUpEnabled: true,
    use24HourClock: null,
    onboardingCompleted: false,
    googleCalendarSyncEnabled: false,
    deviceCalendarImportIds: [],
    deviceCalendarExportId: null,
    updatedAt: null,
    ...overrides,
  };
}

function note(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    userId: 'alice',
    title: 'Ideas',
    content: 'Remember the budget',
    category: 'work',
    meetingId: null,
    pinned: false,
    createdAt: ISO,
    updatedAt: ISO,
    ...overrides,
  };
}

function profile(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    uid: 'alice',
    email: 'alice@example.com',
    displayName: 'Alice',
    photoURL: null,
    createdAt: ISO,
    updatedAt: ISO,
    lastLoginAt: ISO,
    legacyMigratedAt: null,
    ...overrides,
  };
}

// The test contexts return the compat Firestore type; modular functions unwrap it at runtime.
const asModular = (firestore: unknown): Firestore => firestore as Firestore;
const alice = (): Firestore => asModular(env.authenticatedContext('alice').firestore());
const bob = (): Firestore => asModular(env.authenticatedContext('bob').firestore());
const anonymous = (): Firestore => asModular(env.unauthenticatedContext().firestore());

async function seed(path: string, data: Record<string, unknown>): Promise<void> {
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(asModular(context.firestore()), path), data);
  });
}

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync(join(__dirname, '..', '..', '..', 'firestore.rules'), 'utf8') },
  });
});

afterAll(async () => {
  await env?.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
});

describe('meetings', () => {
  it('lets the owner create, read, list, update and delete valid meetings', async () => {
    await assertSucceeds(setDoc(doc(alice(), 'users/alice/meetings/m1'), meeting()));
    await assertSucceeds(getDoc(doc(alice(), 'users/alice/meetings/m1')));
    await assertSucceeds(getDocs(collection(alice(), 'users/alice/meetings')));
    await assertSucceeds(updateDoc(doc(alice(), 'users/alice/meetings/m1'), { deletedAt: ISO, updatedAt: ISO }));
    await assertSucceeds(deleteDoc(doc(alice(), 'users/alice/meetings/m1')));
  });

  it('denies other users and signed-out clients', async () => {
    await seed('users/alice/meetings/m1', meeting());
    await assertFails(getDoc(doc(bob(), 'users/alice/meetings/m1')));
    await assertFails(getDocs(collection(bob(), 'users/alice/meetings')));
    await assertFails(getDoc(doc(anonymous(), 'users/alice/meetings/m1')));
    await assertFails(setDoc(doc(bob(), 'users/alice/meetings/m2'), meeting()));
    await assertFails(setDoc(doc(anonymous(), 'users/alice/meetings/m2'), meeting()));
  });

  it.each([
    ['another userId', { userId: 'bob' }],
    ['an empty title', { title: '' }],
    ['a title over 200 characters', { title: 'x'.repeat(201) }],
    ['a non-UTC start', { startAt: '2026-10-05T16:00:00+02:00' }],
    ['a zero duration', { durationMinutes: 0 }],
    ['an unknown source', { source: 'chatgpt' }],
    ['an unknown status', { status: 'done' }],
    ['a stored Google token', { googleAccessToken: 'ya29.token' }],
    ['a bad conference provider', { conference: { provider: 'skype', url: null, password: null } }],
    ['too many alert times', { customAlertTimes: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] }],
    ['an unknown language', { language: 'fr' }],
  ])('rejects a meeting with %s', async (_label, overrides) => {
    await assertFails(setDoc(doc(alice(), 'users/alice/meetings/m1'), meeting(overrides)));
  });

  it('rejects missing required fields and invalid ids', async () => {
    const { startAt: _startAt, ...withoutStart } = meeting();
    await assertFails(setDoc(doc(alice(), 'users/alice/meetings/m1'), withoutStart));
    await assertFails(setDoc(doc(alice(), 'users/alice/meetings/bad.id'), meeting()));
  });

  it('keeps userId, createdAt and source immutable', async () => {
    await seed('users/alice/meetings/m1', meeting());
    const ref = doc(alice(), 'users/alice/meetings/m1');
    await assertFails(updateDoc(ref, { createdAt: '2026-10-06T00:00:00.000Z' }));
    await assertFails(updateDoc(ref, { source: 'google' }));
    await assertSucceeds(updateDoc(ref, { title: 'Daily standup', updatedAt: '2026-10-06T00:00:00.000Z' }));
  });
});

describe('profile', () => {
  it('lets the owner write profile fields', async () => {
    await assertSucceeds(setDoc(doc(alice(), 'users/alice'), profile()));
    await assertSucceeds(getDoc(doc(alice(), 'users/alice')));
    await assertFails(getDoc(doc(bob(), 'users/alice')));
  });

  it.each([
    ['plan', { plan: 'premium' }],
    ['subscriptionStatus', { subscriptionStatus: 'active' }],
    ['subscriptionTier', { subscriptionTier: 'pro' }],
    ['role', { role: 'admin' }],
    ['enabled', { enabled: true }],
    ['entitlement', { entitlement: { plan: 'pro' } }],
    ['another uid', { uid: 'bob' }],
  ])('rejects %s on the profile', async (_label, overrides) => {
    await assertFails(setDoc(doc(alice(), 'users/alice'), profile(overrides)));
  });

  it('rejects server-owned fields in merges and profile deletion', async () => {
    await seed('users/alice', profile());
    await assertFails(setDoc(doc(alice(), 'users/alice'), { plan: 'pro' }, { merge: true }));
    await assertFails(deleteDoc(doc(alice(), 'users/alice')));
  });
});

describe('preferences', () => {
  it('accepts valid preferences and partial merges', async () => {
    await assertSucceeds(setDoc(doc(alice(), 'users/alice/settings/preferences'), preferences()));
    await assertSucceeds(setDoc(doc(alice(), 'users/alice/settings/preferences'), { language: 'en', updatedAt: ISO }, { merge: true }));
    await assertSucceeds(getDoc(doc(alice(), 'users/alice/settings/preferences')));
    await assertFails(getDoc(doc(bob(), 'users/alice/settings/preferences')));
  });

  it.each([
    ['a volume above 1', { alertVolume: 1.5 }],
    ['an unknown intensity', { alertIntensity: 'maximum' }],
    ['a Google access token', { google_access_token: 'ya29.token' }],
    ['a Google refresh token', { google_refresh_token: '1//token' }],
    ['a bad snooze', { snoozeMinutes: 0 }],
  ])('rejects %s', async (_label, overrides) => {
    await assertFails(setDoc(doc(alice(), 'users/alice/settings/preferences'), preferences(overrides)));
  });

  it('only allows the preferences document', async () => {
    await assertFails(setDoc(doc(alice(), 'users/alice/settings/other'), preferences()));
  });
});

describe('notes', () => {
  it('validates notes', async () => {
    await assertSucceeds(setDoc(doc(alice(), 'users/alice/notes/n1'), note()));
    await assertSucceeds(deleteDoc(doc(alice(), 'users/alice/notes/n1')));
    await assertFails(setDoc(doc(alice(), 'users/alice/notes/n2'), note({ category: 'secret' })));
    await assertFails(setDoc(doc(alice(), 'users/alice/notes/n3'), note({ content: 'x'.repeat(20_001) })));
    await assertFails(setDoc(doc(bob(), 'users/alice/notes/n4'), note()));
  });
});

describe('server-owned collections', () => {
  it('lets the owner read the entitlement but nobody write it', async () => {
    await seed('entitlements/alice', { plan: 'pro', status: 'active', expiresAt: null, source: 'manual', updatedAt: null });
    await assertSucceeds(getDoc(doc(alice(), 'entitlements/alice')));
    await assertFails(getDoc(doc(bob(), 'entitlements/alice')));
    await assertFails(setDoc(doc(alice(), 'entitlements/alice'), { plan: 'premium', status: 'active' }));
    await assertFails(setDoc(doc(alice(), 'entitlements/new'), { plan: 'premium', status: 'active' }));
  });

  it('lets the owner read usage counters but never write them', async () => {
    await seed('usage/alice/days/2026-10-05', { count: 3, updatedAt: ISO });
    await assertSucceeds(getDoc(doc(alice(), 'usage/alice/days/2026-10-05')));
    await assertFails(getDoc(doc(bob(), 'usage/alice/days/2026-10-05')));
    await assertFails(setDoc(doc(alice(), 'usage/alice/days/2026-10-05'), { count: 0, updatedAt: ISO }));
    await assertFails(deleteDoc(doc(alice(), 'usage/alice/days/2026-10-05')));
  });

  it('denies unknown paths', async () => {
    await assertFails(setDoc(doc(alice(), 'admin/config'), { open: true }));
    await assertFails(getDoc(doc(alice(), 'users/alice/tokens/google')));
    await assertFails(setDoc(doc(alice(), 'users/alice/tokens/google'), { accessToken: 'x' }));
  });
});

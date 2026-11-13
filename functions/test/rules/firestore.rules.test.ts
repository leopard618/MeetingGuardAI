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
import {
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  type Firestore,
} from 'firebase/firestore';

import { commitmentTaskId } from '../../src/commitments/ids';
import { buildCommitmentTaskDoc, type CommitmentTaskInput } from '../../src/commitments/taskDoc';

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
    importedAlertIntensity: null,
    todoListId: null,
    todoListName: null,
    gtasksListId: null,
    gtasksListName: null,
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
    ['a non-integer alert time', { customAlertTimes: [15, 'x'] }],
    ['a huge alert time', { customAlertTimes: [5, 20000] }],
    ['a negative alert time', { customAlertTimes: [-5] }],
    ['a string list element that is not a string', { preparationTips: ['ok', { big: 'x'.repeat(10) }] }],
    ['oversized preparation tips', { preparationTips: ['x'.repeat(4000), 'y'.repeat(4000)] }],
    ['an unknown language', { language: 'fr' }],
    ['a non-boolean pushPending flag', { pushPending: 'yes' }],
  ])('rejects a meeting with %s', async (_label, overrides) => {
    await assertFails(setDoc(doc(alice(), 'users/alice/meetings/m1'), meeting(overrides)));
  });

  it('accepts the website push flag (section 32) on create and on update', async () => {
    await assertSucceeds(setDoc(doc(alice(), 'users/alice/meetings/m1'), meeting({ pushPending: true })));
    await assertSucceeds(updateDoc(doc(alice(), 'users/alice/meetings/m1'), { pushPending: false, updatedAt: ISO }));
  });

  it('accepts valid alert times and tips', async () => {
    await assertSucceeds(
      setDoc(doc(alice(), 'users/alice/meetings/m1'), meeting({ customAlertTimes: [10080, 60, 15, 5, 0], preparationTips: ['Agenda', 'Numbers'] })),
    );
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

describe('meetings: recurrence and outlook (phase 1)', () => {
  const RULE = { freq: 'daily', interval: 1, byWeekday: null, byMonthDay: null, until: null, count: 10 };

  it('accepts a sparse pre-phase-1 document unchanged (no new keys)', async () => {
    await assertSucceeds(setDoc(doc(alice(), 'users/alice/meetings/m1'), meeting()));
  });

  it('accepts a recurring master with overrides, seriesId and outlook refs', async () => {
    await assertSucceeds(
      setDoc(
        doc(alice(), 'users/alice/meetings/m1'),
        meeting({
          recurrence: { freq: 'weekly', interval: 2, byWeekday: ['MO', 'WE'], byMonthDay: null, until: null, count: null },
          recurrenceOverrides: {
            '2026-10-12': { status: 'cancelled', startAt: null, durationMinutes: null, title: null },
            '2026-10-14': { status: 'modified', startAt: '2026-10-14T15:00:00.000Z', durationMinutes: 30, title: 'Moved' },
          },
          seriesId: 'm1',
          source: 'outlook',
          external: {
            ...(meeting().external as Record<string, unknown>),
            outlookEventId: 'AAMkAD=',
            outlookCalendarId: 'calendar-1',
            outlookChangeKey: 'CQAAABYA',
            outlookUpdatedAt: ISO,
          },
        }),
      ),
    );
  });

  it.each([
    ['an unknown freq', { recurrence: { ...RULE, freq: 'yearly' } }],
    ['a zero interval', { recurrence: { ...RULE, interval: 0 } }],
    ['an interval over 99', { recurrence: { ...RULE, interval: 100 } }],
    ['a missing interval', { recurrence: { freq: 'daily', byWeekday: null, byMonthDay: null, until: null, count: 10 } }],
    ['an extra rule key', { recurrence: { ...RULE, extra: true } }],
    ['a bad weekday code', { recurrence: { ...RULE, byWeekday: ['XX'] } }],
    ['a non-string weekday', { recurrence: { ...RULE, byWeekday: [1] } }],
    ['an empty weekday list', { recurrence: { ...RULE, byWeekday: [] } }],
    ['a byMonthDay of 0', { recurrence: { ...RULE, byMonthDay: 0 } }],
    ['a byMonthDay over 31', { recurrence: { ...RULE, byMonthDay: 32 } }],
    ['a count over 730', { recurrence: { ...RULE, count: 731 } }],
    ['both until and count', { recurrence: { ...RULE, until: ISO, count: 5 } }],
    ['a non-UTC until', { recurrence: { ...RULE, until: '2026-10-05T16:00:00+02:00', count: null } }],
    ['a non-map recurrence', { recurrence: 'daily' }],
    ['non-map overrides', { recurrence: RULE, recurrenceOverrides: 'x' }],
    ['a non-id seriesId', { seriesId: 'bad:id' }],
    ['an oversized outlook event id', { external: { ...(meeting().external as Record<string, unknown>), outlookEventId: 'x'.repeat(513) } }],
    ['a non-ISO outlook update time', { external: { ...(meeting().external as Record<string, unknown>), outlookUpdatedAt: 'yesterday' } }],
    ['an unknown external key', { external: { ...(meeting().external as Record<string, unknown>), icalUid: 'x' } }],
  ])('rejects a meeting with %s', async (_label, overrides) => {
    await assertFails(setDoc(doc(alice(), 'users/alice/meetings/m1'), meeting(overrides)));
  });

  it('bounds the overrides map at 200 entries', async () => {
    const overrides: Record<string, unknown> = {};
    for (let i = 0; i < 201; i += 1) {
      const day = new Date(Date.UTC(2026, 0, 1) + i * 86_400_000).toISOString().slice(0, 10);
      overrides[day] = { status: 'cancelled', startAt: null, durationMinutes: null, title: null };
    }
    await assertFails(
      setDoc(doc(alice(), 'users/alice/meetings/m1'), meeting({ recurrence: RULE, recurrenceOverrides: overrides })),
    );
    const smaller = Object.fromEntries(Object.entries(overrides).slice(0, 200));
    await assertSucceeds(
      setDoc(doc(alice(), 'users/alice/meetings/m1'), meeting({ recurrence: RULE, recurrenceOverrides: smaller })),
    );
  });

  it('rejects recurrenceOverrides on a document without a recurrence rule', async () => {
    const overrides = { '2026-10-12': { status: 'cancelled', startAt: null, durationMinutes: null, title: null } };
    // Legitimate clients null the overrides whenever the rule is null (buildMeeting /
    // applyMeetingPatch), so overrides without a rule can only be a hand-rolled payload.
    await assertFails(setDoc(doc(alice(), 'users/alice/meetings/m1'), meeting({ recurrenceOverrides: overrides })));
    await assertSucceeds(
      setDoc(doc(alice(), 'users/alice/meetings/m1'), meeting({ recurrence: RULE, recurrenceOverrides: overrides })),
    );
  });

  it('lets an update add a rule to an existing one-off (seriesId becomes the meeting id)', async () => {
    await seed('users/alice/meetings/m1', meeting());
    await assertSucceeds(
      updateDoc(doc(alice(), 'users/alice/meetings/m1'), {
        recurrence: RULE,
        seriesId: 'm1',
        updatedAt: '2026-10-06T00:00:00.000Z',
      }),
    );
  });
});

describe('meetings: zoom external ref (phase 2, docs/v1/ARCHITECTURE.md 24)', () => {
  // external.zoomMeetingId is first written by the zoomCreateMeeting callable (Admin SDK), but
  // it must stay CLIENT-writable like the outlook refs: every later client edit rewrites the
  // whole document, external refs included.
  const zoomConference = { provider: 'zoom', url: 'https://zoom.us/j/987654321', password: 'abc123' };

  it('accepts a meeting whose external carries a zoomMeetingId (string <= 64)', async () => {
    await assertSucceeds(
      setDoc(
        doc(alice(), 'users/alice/meetings/m1'),
        meeting({
          conference: zoomConference,
          external: { ...(meeting().external as Record<string, unknown>), zoomMeetingId: '987654321' },
        }),
      ),
    );
  });

  it('accepts an explicit null zoomMeetingId', async () => {
    await assertSucceeds(
      setDoc(
        doc(alice(), 'users/alice/meetings/m1'),
        meeting({ external: { ...(meeting().external as Record<string, unknown>), zoomMeetingId: null } }),
      ),
    );
  });

  it('lets a client edit rewrite a document that already carries the server-written id', async () => {
    await seed(
      'users/alice/meetings/m1',
      meeting({
        conference: zoomConference,
        external: { ...(meeting().external as Record<string, unknown>), zoomMeetingId: '987654321' },
      }),
    );
    await assertSucceeds(
      setDoc(
        doc(alice(), 'users/alice/meetings/m1'),
        meeting({
          title: 'Weekly sync (moved)',
          conference: zoomConference,
          external: { ...(meeting().external as Record<string, unknown>), zoomMeetingId: '987654321' },
          updatedAt: '2026-10-06T00:00:00.000Z',
        }),
      ),
    );
  });

  it.each([
    ['an oversized zoomMeetingId', 'x'.repeat(65)],
    ['a numeric zoomMeetingId', 987654321],
    ['a map zoomMeetingId', { id: '987654321' }],
  ])('rejects %s', async (_label, value) => {
    await assertFails(
      setDoc(
        doc(alice(), 'users/alice/meetings/m1'),
        meeting({ external: { ...(meeting().external as Record<string, unknown>), zoomMeetingId: value } }),
      ),
    );
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
    ['an unknown imported intensity', { importedAlertIntensity: 'loud' }],
    ['a Google access token', { google_access_token: 'ya29.token' }],
    ['a Google refresh token', { google_refresh_token: '1//token' }],
    ['a bad snooze', { snoozeMinutes: 0 }],
    ['a non-integer default alert time', { defaultAlertTimes: [15, '5'] }],
    ['a non-string import id', { deviceCalendarImportIds: ['dabcdefghijk1.3', 42] }],
    ['oversized import ids', { deviceCalendarImportIds: Array.from({ length: 50 }, () => 'x'.repeat(600)) }],
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

describe('tasks', () => {
  function task(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      userId: 'alice',
      title: 'Send the contract',
      description: '',
      dueDate: null,
      dueTime: null,
      timezone: 'Europe/Madrid',
      reminderMinutesBefore: null,
      status: 'open',
      meetingId: null,
      people: [],
      completedAt: null,
      source: 'manual',
      external: { todoListId: null, todoTaskId: null, todoUpdatedAt: null, gtasksListId: null, gtasksTaskId: null, gtasksUpdatedAt: null },
      createdAt: ISO,
      updatedAt: ISO,
      ...overrides,
    };
  }

  it('validates tasks', async () => {
    await assertSucceeds(setDoc(doc(alice(), 'users/alice/tasks/t1'), task()));
    await assertSucceeds(deleteDoc(doc(alice(), 'users/alice/tasks/t1')));
    await assertFails(setDoc(doc(alice(), 'users/alice/tasks/t2'), task({ status: 'archived' })));
    await assertFails(setDoc(doc(alice(), 'users/alice/tasks/t3'), task({ secret: true })));
    await assertFails(setDoc(doc(bob(), 'users/alice/tasks/t4'), task()));
  });

  it('accepts the website push flag (section 32) on create and on update, booleans only', async () => {
    await assertSucceeds(setDoc(doc(alice(), 'users/alice/tasks/t1'), task({ pushPending: true })));
    await assertSucceeds(updateDoc(doc(alice(), 'users/alice/tasks/t1'), { pushPending: true, title: 'Send the signed contract', updatedAt: ISO }));
    await assertFails(setDoc(doc(alice(), 'users/alice/tasks/t2'), task({ pushPending: 'yes' })));
  });
});

describe('tasks from summary commitments (M11, docs/v2/M11-DESIGN.md sections 3.4 and 6)', () => {
  // The exact document the server writes for an accepted suggestion, written here as the owner:
  // a later full set write of it by the app must pass the same rules.
  function commitmentTask(overrides: Partial<CommitmentTaskInput> = {}): Record<string, unknown> {
    const built = buildCommitmentTaskDoc({
      uid: 'alice',
      title: 'Bish: Provide APK access/files to Urpayroll',
      description: "From your notetaker's summary of Urpayroll weekly sync (Oct 16, 2026). Suggested by Meeting Guard AI, added by you.",
      dueDate: '2026-10-16',
      dueTime: '09:00',
      timezone: 'America/Mexico_City',
      reminderMinutesBefore: 0,
      meetingId: 'mtgUrpayrollSync01',
      owner: { name: 'Bish', isUser: false },
      now: new Date(ISO),
      ...overrides,
    });
    if (!built.ok) throw new Error(`fixture task is invalid: ${built.reason}`);
    return { ...built.doc };
  }
  const TASK_ID = commitmentTaskId('ab'.repeat(32), '0123456789abcdef01234567', 0);

  it('the server task document passes isValidTask as the owner, with and without a date or a person', async () => {
    await assertSucceeds(setDoc(doc(alice(), `users/alice/tasks/${TASK_ID}`), commitmentTask()));
    await assertSucceeds(setDoc(doc(alice(), 'users/alice/tasks/sm2'), commitmentTask({ dueDate: null, dueTime: null, reminderMinutesBefore: null, owner: null, meetingId: null })));
    await assertFails(setDoc(doc(bob(), `users/alice/tasks/${TASK_ID}`), commitmentTask()));
  });

  it('the app can write it back with its external refs, and the push flag cleared', async () => {
    await assertSucceeds(setDoc(doc(alice(), `users/alice/tasks/${TASK_ID}`), commitmentTask()));
    await assertSucceeds(
      setDoc(doc(alice(), `users/alice/tasks/${TASK_ID}`), {
        ...commitmentTask(),
        pushPending: false,
        external: { todoListId: 'L1', todoTaskId: 'T1', todoUpdatedAt: ISO, gtasksListId: null, gtasksTaskId: null, gtasksUpdatedAt: null },
      }),
    );
  });

  // M11 day 2-3 (decide): the server writes the task with the Admin SDK; the app's later edit is a
  // full set write of the whole document (engine.ts), so that shape must pass the rules too.
  it('a later app edit (full replacement: renamed, rescheduled, done) passes, and the document carries no new key', async () => {
    const written = commitmentTask({ meetingId: 'mtgUrpayrollSync01' });
    expect(Object.keys(written).sort()).toEqual(
      ['completedAt', 'createdAt', 'description', 'dueDate', 'dueTime', 'meetingId', 'people', 'pushPending', 'reminderMinutesBefore', 'source', 'status', 'timezone', 'title', 'updatedAt', 'userId'].sort(),
    );
    await seed(`users/alice/tasks/${TASK_ID}`, written);
    const later = '2026-10-06T09:00:00.000Z';
    await assertSucceeds(
      setDoc(doc(alice(), `users/alice/tasks/${TASK_ID}`), {
        ...written,
        title: 'Follow up with Bish on the APK',
        dueDate: '2026-10-07',
        dueTime: '10:30',
        reminderMinutesBefore: 15,
        status: 'done',
        completedAt: later,
        pushPending: false,
        updatedAt: later,
      }),
    );
    // A key outside the hasOnly list is refused, so a server document with one could never be edited.
    await assertFails(setDoc(doc(alice(), `users/alice/tasks/${TASK_ID}`), { ...written, summaryId: 'ab'.repeat(32), updatedAt: later }));
    // The server's createdAt and userId stay as written.
    await assertFails(setDoc(doc(alice(), `users/alice/tasks/${TASK_ID}`), { ...written, createdAt: later, updatedAt: later }));
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

  it('keeps the account deletion log server-only', async () => {
    await seed('accountDeletions/alice', { deletedAt: ISO });
    await assertFails(getDoc(doc(alice(), 'accountDeletions/alice')));
    await assertFails(setDoc(doc(alice(), 'accountDeletions/alice'), { deletedAt: ISO }));
    await assertFails(deleteDoc(doc(alice(), 'accountDeletions/alice')));
  });

  it('keeps the zoom ownership registry server-only (docs/v1/ARCHITECTURE.md 24)', async () => {
    await seed('zoomMeetings/987654321', { uid: 'alice', meetingId: 'm1', createdAt: ISO });
    await assertFails(getDoc(doc(alice(), 'zoomMeetings/987654321')));
    await assertFails(setDoc(doc(alice(), 'zoomMeetings/987654321'), { uid: 'alice', meetingId: 'm1', createdAt: ISO }));
    await assertFails(setDoc(doc(alice(), 'zoomMeetings/111'), { uid: 'alice', meetingId: 'm1', createdAt: ISO }));
    await assertFails(deleteDoc(doc(alice(), 'zoomMeetings/987654321')));
  });

  it('denies unknown paths', async () => {
    await assertFails(setDoc(doc(alice(), 'admin/config'), { open: true }));
    await assertFails(getDoc(doc(alice(), 'users/alice/tokens/google')));
    await assertFails(setDoc(doc(alice(), 'users/alice/tokens/google'), { accessToken: 'x' }));
  });
});

// ------------------------------------------------------------------ server-only paths, every client

/** A client identity: alice owns the uid named in the paths and documents below. */
type Actor = [label: string, db: () => Firestore];
const ACTORS: Actor[] = [
  ['the owner', alice],
  ['another signed-in user', bob],
  ['a signed-out client', anonymous],
];

/** A server-only document: its name, its path and synthetic data seeded there. */
type ServerOnlyCase = [name: string, path: string, data: Record<string, unknown>];

/**
 * Seeds `path` with rules disabled, then checks that `db` can neither read nor write there: get,
 * list of the parent collection, create of a sibling, full replacement, field update and delete.
 */
async function expectNoClientAccess(db: Firestore, path: string, data: Record<string, unknown>): Promise<void> {
  await seed(path, data);
  const ref = doc(db, path);
  await assertFails(getDoc(ref));
  await assertFails(getDocs(ref.parent));
  await assertFails(setDoc(doc(ref.parent, 'created-by-client'), data));
  await assertFails(setDoc(ref, data));
  await assertFails(updateDoc(ref, { updatedAt: ISO }));
  await assertFails(deleteDoc(ref));
}

describe('meeting summaries (M10, docs/v2/M10-DESIGN.md section 7)', () => {
  // Written by the summaryInbound pipeline and the summary callables (Admin SDK) and read by the
  // app only through callables, which open the sealed content field on the server. Synthetic
  // plaintext structure only; the sealed blob is a placeholder.
  const SUMMARY: Record<string, unknown> = {
    schemaVersion: 1,
    parserVersion: 1,
    status: 'inbox',
    inboxReason: 'no_candidate',
    senderDomain: 'example.com',
    receivedAt: ISO,
    language: 'en',
    sealed: 'sealed-placeholder',
    createdAt: ISO,
    updatedAt: ISO,
    expiresAt: '2026-12-04T14:00:00.000Z',
  };
  const PATHS: ServerOnlyCase[] = [
    ['a summary row', 'users/alice/meetingSummaries/s1', SUMMARY],
    ['a document nested below a summary', 'users/alice/meetingSummaries/s1/parts/p1', { index: 0, createdAt: ISO, updatedAt: ISO }],
  ];

  describe.each(ACTORS)('%s', (_label, db) => {
    it.each(PATHS)('cannot read or write %s', async (_name, path, data) => {
      await expectNoClientAccess(db(), path, data);
    });
  });

  it('denies collection group queries on meetingSummaries to every client', async () => {
    await seed('users/alice/meetingSummaries/s1', SUMMARY);
    for (const [, db] of ACTORS) {
      await assertFails(getDocs(collectionGroup(db(), 'meetingSummaries')));
    }
  });

  it('leaves the owner the rest of users/{uid} (the deny is scoped to meetingSummaries)', async () => {
    await seed('users/alice/meetingSummaries/s1', SUMMARY);
    await assertSucceeds(setDoc(doc(alice(), 'users/alice/meetings/m1'), meeting()));
    await assertSucceeds(getDoc(doc(alice(), 'users/alice/meetings/m1')));
    await assertFails(getDoc(doc(alice(), 'users/alice/meetingSummaries/s1')));
  });
});

describe('summary forwarding state (M10, docs/v2/M10-DESIGN.md sections 3 and 7)', () => {
  // Synthetic sha256-shaped hex ids; the plain address token is never part of a document id.
  const TOKEN_HASH = 'ab'.repeat(32);
  const CASES: ServerOnlyCase[] = [
    ['summaryAddresses', `summaryAddresses/${TOKEN_HASH}`, { uid: 'alice', createdAt: ISO }],
    ['summaryUsers', 'summaryUsers/alice', { tokenHash: TOKEN_HASH, mailboxes: [], createdAt: ISO, updatedAt: ISO }],
    ['summaryEvents', `summaryEvents/${'cd'.repeat(32)}`, { expiresAt: ISO }],
  ];

  describe.each(ACTORS)('%s', (_label, db) => {
    it.each(CASES)('cannot read or write %s', async (_name, path, data) => {
      await expectNoClientAccess(db(), path, data);
    });
  });
});

describe('WhatsApp bot and Microsoft sign-in state (docs/v1/ARCHITECTURE.md 27 and 31)', () => {
  // 555-01xx numbers are reserved for fiction; ids below are synthetic.
  const PHONE = '+15550100001';
  const CASES: ServerOnlyCase[] = [
    ['whatsappLinks', `whatsappLinks/${PHONE}`, { uid: 'alice', linkedAt: ISO, profileName: null }],
    ['whatsappUsers', 'whatsappUsers/alice', { phoneE164: PHONE, linkedAt: ISO, codeHash: null, codeExpiresAt: null }],
    ['whatsappLinkCodes', `whatsappLinkCodes/${'ef'.repeat(32)}`, { uid: 'alice', expiresAt: ISO }],
    ['whatsappSessions', `whatsappSessions/${PHONE}`, { updatedAt: ISO }],
    ['whatsappEvents', `whatsappEvents/${'01'.repeat(32)}`, { receivedAt: ISO, expiresAt: ISO }],
    ['microsoftIdentities', 'microsoftIdentities/00000000-0000-0000-0000-000000000001', { uid: 'alice', createdAt: ISO }],
  ];

  describe.each(ACTORS)('%s', (_label, db) => {
    it.each(CASES)('cannot read or write %s', async (_name, path, data) => {
      await expectNoClientAccess(db(), path, data);
    });
  });
});

describe('admin dashboard state (server only, read through admin callables)', () => {
  const CASES: ServerOnlyCase[] = [
    ['an adminStats day', 'adminStats/ai/days/2026-10-05', { requests: 3, updatedAt: ISO }],
    ['an adminStats write shard', 'adminStats/ai/days/2026-10-05/shards/0', { requests: 1, updatedAt: ISO }],
    ['an adminAudit entry', 'adminAudit/entry1', { action: 'set_plan', outcome: 'ok', createdAt: ISO }],
  ];

  describe.each(ACTORS)('%s', (_label, db) => {
    it.each(CASES)('cannot read or write %s', async (_name, path, data) => {
      await expectNoClientAccess(db(), path, data);
    });
  });
});

describe('executive assistant matters (docs/v1/ARCHITECTURE.md 36)', () => {
  const MATTER = 'users/alice/matters/m1';
  const matter = { status: 'draft', title: 'Proposal from Carlos', confirmedHash: null, updatedAt: ISO };

  it('lets the owner read a matter, its timeline and its emails, and nobody else', async () => {
    await seed(MATTER, matter);
    await seed(`${MATTER}/events/e1`, { type: 'created', at: ISO, messageId: null, detail: '' });
    await seed(`${MATTER}/messages/x1`, { direction: 'outbound', status: 'sent', subject: 'Proposal' });
    await assertSucceeds(getDoc(doc(alice(), MATTER)));
    await assertSucceeds(getDocs(collection(alice(), 'users/alice/matters')));
    await assertSucceeds(getDocs(collection(alice(), `${MATTER}/events`)));
    await assertSucceeds(getDoc(doc(alice(), `${MATTER}/messages/x1`)));
    await assertFails(getDoc(doc(bob(), MATTER)));
    await assertFails(getDocs(collection(bob(), 'users/alice/matters')));
    await assertFails(getDoc(doc(bob(), `${MATTER}/events/e1`)));
    await assertFails(getDoc(doc(bob(), `${MATTER}/messages/x1`)));
    await assertFails(getDoc(doc(anonymous(), MATTER)));
  });

  it('never lets a client write a matter: no confirming a mandate, no fake emails or events', async () => {
    await seed(MATTER, matter);
    await assertFails(setDoc(doc(alice(), 'users/alice/matters/m2'), matter));
    await assertFails(updateDoc(doc(alice(), MATTER), { status: 'active', confirmedHash: 'a'.repeat(64) }));
    await assertFails(deleteDoc(doc(alice(), MATTER)));
    await assertFails(setDoc(doc(alice(), `${MATTER}/events/e2`), { type: 'mandate_confirmed', at: ISO, messageId: null, detail: '' }));
    await assertFails(setDoc(doc(alice(), `${MATTER}/messages/x2`), { direction: 'inbound', status: 'received' }));
    await assertFails(getDoc(doc(alice(), `${MATTER}/other/z1`)));
  });

  it('keeps the reply addresses, the Message-ID index and the inbound markers server-only', async () => {
    await seed('matterAddresses/0123456789abcdef01234567', { uid: 'alice', matterId: 'm1', createdAt: ISO });
    await seed('matterMessageIds/' + 'b'.repeat(64), { uid: 'alice', matterId: 'm1', createdAt: ISO });
    await seed('inboundEmails/pm-1', { receivedAt: ISO, expiresAt: ISO });
    for (const path of ['matterAddresses/0123456789abcdef01234567', 'matterMessageIds/' + 'b'.repeat(64), 'inboundEmails/pm-1']) {
      await assertFails(getDoc(doc(alice(), path)));
      await assertFails(setDoc(doc(alice(), path), { uid: 'alice' }));
      await assertFails(deleteDoc(doc(alice(), path)));
    }
    await assertFails(getDocs(collection(alice(), 'matterAddresses')));
  });
});

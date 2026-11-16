/**
 * M10 account deletion and retention (docs/v2/M10-DESIGN.md section 7 Deletion and Retention,
 * section 12 Updates): functions/src/summaries/accountDeletion.ts, the deleteAccount and deletion
 * replay wiring over the real summary port, and the dailyMaintenance Firestore ports for
 * users/{uid}/meetingSummaries and summaryEvents. Firestore is the in-memory fake in
 * summariesFakeFirestore.ts (plus a WriteBatch). All data is synthetic.
 */
jest.mock('firebase-functions/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

// The Firebase ports read the Admin SDK through ../firebase: hand them the fake instead.
let mockDb: unknown = null;
jest.mock('../../src/firebase', () => ({
  adminDb: () => mockDb,
  adminAuth: () => ({}),
}));

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import * as functionsLogger from 'firebase-functions/logger';
import type { Firestore } from 'firebase-admin/firestore';

import { deleteAccountData, firebaseAccountDeletionPorts, type AccountDeletionPorts } from '../../src/deleteAccount';
import { firestoreMaintenancePorts } from '../../src/maintenance';
import { replayAccountDeletions, runDailyMaintenance } from '../../src/maintenance/core';
import { parseKeyring, type Keyring } from '../../src/shared/sealed';
import {
  STRAY_INDEX_MAX_PAGES,
  STRAY_INDEX_PAGE_SIZE,
  deleteSummaryDataForUid,
} from '../../src/summaries/accountDeletion';
import { createAddress, deleteAddressDocs, parseSummaryUser, resolveToken } from '../../src/summaries/address';
import { decide } from '../../src/summaries/match';
import {
  SUMMARY_RETENTION_DAYS,
  buildSummaryDoc,
  digestMarkerKey,
  firstSeenExpiresAt,
  markerExpiresAt,
  messageKeyFor,
  messageMarkerKey,
  refusedRowExpiresAt,
  summaryExpiresAt,
  summaryIdFor,
  type BuildSummaryDocInput,
} from '../../src/summaries/model';
import { extractSummaryMeta, parseSections } from '../../src/summaries/sections';
import { commitSummary, recordRefusal, storeGmailRequest, type CommitSummaryInput } from '../../src/summaries/store';
import { FakeFirestore, FakeQuery, type FakeDocumentReference } from './summariesFakeFirestore';

// ---------------------------------------------------------------------------------------------
// Fake with a WriteBatch (deleteSummaryDataForUid and the maintenance ports use db.batch())
// ---------------------------------------------------------------------------------------------

class BatchFakeFirestore extends FakeFirestore {
  /** Deletes per committed batch, in order. */
  readonly batchSizes: number[] = [];

  batch(): { delete(ref: FakeDocumentReference): unknown; commit(): Promise<void> } {
    const writes: { kind: 'delete'; path: string }[] = [];
    return {
      delete: (ref: FakeDocumentReference) => {
        writes.push({ kind: 'delete', path: ref.path });
      },
      commit: async () => {
        this.batchSizes.push(writes.length);
        this.commitWrites(writes);
      },
    };
  }

  /** db.recursiveDelete(db.doc(path)) as deleteAccount's port does it: the doc and everything under it. */
  recursiveDeletePath(path: string): void {
    for (const descendant of this.paths(`${path}/`)) this.docs.delete(descendant);
    this.docs.delete(path);
  }
}

// ---------------------------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------------------------

const UID = 'uid-test-dana';
const OTHER_UID = 'uid-test-lee';
const TEMPLATE = '{token}@summaries.meetingguard.example';
const USER_MAILBOX = 'dana@company.example';
const OTHER_MAILBOX = 'lee@company.example';
const CREATED = new Date('2026-10-01T00:00:00.000Z');
const NOW = new Date('2026-11-12T10:00:00.000Z');
const KEYRING: Keyring = parseKeyring(`k1:${Buffer.alloc(32, 7).toString('base64')}`);
const VENDOR_DOMAIN = 'notetaker.example';
const RECAP_TEXT = ['Atlas launch sync', 'Nov 12, 2026', '', 'Action items', '- Dana ships the release notes (owner: Dana)'].join('\n');
const SUBJECT = 'Your notes: Atlas launch sync';

interface Harness {
  fake: BatchFakeFirestore;
  db: Firestore;
}

function harness(): Harness {
  const fake = new BatchFakeFirestore();
  const db = fake as unknown as Firestore;
  mockDb = db;
  return { fake, db };
}

/** A connected user (users/{uid} plus a private address); returns the address tokenHash. */
async function connect(h: Harness, uid: string, mailbox: string): Promise<string> {
  h.fake.seed(`users/${uid}`, { createdAt: '2026-09-01T00:00:00.000Z' });
  await createAddress(uid, mailbox, { db: h.db, now: () => CREATED, template: TEMPLATE });
  const hash = parseSummaryUser(h.fake.data(`summaryUsers/${uid}`)).tokenHash;
  if (hash === null) throw new Error('fixture: no tokenHash');
  return hash;
}

/** A fake index hash (64 hex) that no real token produces in these tests. */
function fakeHash(index: number): string {
  return index.toString(16).padStart(64, '0');
}

/** Every summaryAddresses doc that names `uid`. */
function indexDocsOf(h: Harness, uid: string): string[] {
  return h.fake.paths('summaryAddresses/').filter((path) => h.fake.data(path)?.uid === uid);
}

/** Every string any logger call received, for the no-content checks. */
function loggedText(): string {
  const calls = [
    ...(functionsLogger.info as jest.Mock).mock.calls,
    ...(functionsLogger.warn as jest.Mock).mock.calls,
    ...(functionsLogger.error as jest.Mock).mock.calls,
  ];
  return JSON.stringify(calls);
}

/** A vendor_verified row 7 summary for `uid`, sealed for its id (the store test's builder, trimmed). */
function commitInputFor(uid: string, hash: string): CommitSummaryInput {
  const classification: BuildSummaryDocInput['classification'] = {
    row: 7,
    tier: 'vendor_verified',
    recipientBound: true,
    fresh: true,
    senderDomain: VENDOR_DOMAIN,
    anchorAt: new Date('2026-11-12T09:30:00.000Z'),
    anchorSource: 'signed_date',
  };
  const meta = extractSummaryMeta(RECAP_TEXT, SUBJECT);
  const match = decide({
    tier: 'vendor_verified',
    recipientBound: true,
    fresh: true,
    titleLine: meta.titleLine,
    subjectClean: meta.subjectClean,
    summaryDate: meta.summaryDate,
    anchor: { at: '2026-11-12T09:30:00.000Z', signed: true },
    text: RECAP_TEXT,
    preferencesTimeZone: 'UTC',
    rejectedMeetingIds: [],
    candidates: [],
    now: NOW,
  });
  const messageKey = messageKeyFor({ messageIdHeader: '<recap-1@notetaker.example>', decidingSignatureValue: null, raw: Buffer.from(RECAP_TEXT) });
  const summaryId = summaryIdFor(uid, messageKey);
  const built = buildSummaryDoc({
    keyring: KEYRING,
    uid,
    summaryId,
    classification,
    match,
    sections: parseSections(RECAP_TEXT),
    meta,
    text: RECAP_TEXT,
    textTruncated: false,
    subject: SUBJECT,
    fromAddress: 'recaps@notetaker.example',
    fromName: 'Notetaker Recaps',
    auth: {
      dkim: [{ domain: VENDOR_DOMAIN, result: 'pass', aligned: true, signsTo: true, signsDate: true }],
      arc: { result: 'none', sealer: null },
      verifier: 'mailauth@8.0.4',
    },
    sentAt: new Date('2026-11-12T09:30:00.000Z'),
    forwardAnchorAt: null,
    receivedAt: NOW,
    now: NOW,
  });
  return {
    uid,
    tokenHash: hash,
    summaryId,
    doc: built.doc,
    reseal: built.reseal,
    claimMarkers: built.claimMarkers,
    messageIdMarkerKey: messageMarkerKey(uid, messageKey),
    digestMarkerKey: digestMarkerKey(uid, built.doc.contentDigest),
    rank: built.rank,
    now: NOW,
  };
}

afterEach(() => {
  mockDb = null;
});

// ---------------------------------------------------------------------------------------------
// deleteSummaryDataForUid
// ---------------------------------------------------------------------------------------------

describe('deleteSummaryDataForUid', () => {
  it('deletes summaryUsers and the address it points at, leaving the summaries to the recursive passes and other users alone', async () => {
    const h = harness();
    const hash = await connect(h, UID, USER_MAILBOX);
    const otherHash = await connect(h, OTHER_UID, OTHER_MAILBOX);
    h.fake.seed(`users/${UID}/meetingSummaries/${'b'.repeat(64)}`, { status: 'inbox', expiresAt: '2027-01-01T00:00:00.000Z' });
    h.fake.seed(`summaryEvents/${'c'.repeat(64)}`, { expiresAt: '2026-12-01T00:00:00.000Z' });

    await expect(deleteSummaryDataForUid(UID, { db: h.db, now: () => NOW })).resolves.toEqual({ addressDeleted: true, strayIndexDocsDeleted: 0 });

    expect(h.fake.has(`summaryUsers/${UID}`)).toBe(false);
    expect(h.fake.has(`summaryAddresses/${hash}`)).toBe(false);
    expect(indexDocsOf(h, UID)).toEqual([]);
    expect(await resolveToken(hash, { db: h.db })).toBeNull();
    // Not this module's job: the recursive passes over users/{uid}, and the markers expire on their own.
    expect(h.fake.has(`users/${UID}/meetingSummaries/${'b'.repeat(64)}`)).toBe(true);
    expect(h.fake.has(`summaryEvents/${'c'.repeat(64)}`)).toBe(true);
    // The other user is untouched and still routes.
    expect(h.fake.has(`summaryUsers/${OTHER_UID}`)).toBe(true);
    expect(await resolveToken(otherHash, { db: h.db })).toBe(OTHER_UID);
  });

  it('removes a disconnect tombstone too: nothing of summaryUsers survives an account deletion', async () => {
    const h = harness();
    await connect(h, UID, USER_MAILBOX);
    await deleteAddressDocs(UID, { db: h.db, now: () => NOW }, { mode: 'disconnect' });
    expect(h.fake.data(`summaryUsers/${UID}`)).toEqual({ rotationDay: null, rotationsToday: 0, updatedAt: NOW.toISOString() });

    await expect(deleteSummaryDataForUid(UID, { db: h.db, now: () => NOW })).resolves.toEqual({ addressDeleted: false, strayIndexDocsDeleted: 0 });
    expect(h.fake.has(`summaryUsers/${UID}`)).toBe(false);
  });

  it('also deletes every summaryAddresses doc that still names the uid (an import without summaryUsers), and warns with the count', async () => {
    const h = harness();
    h.fake.seed(`summaryAddresses/${fakeHash(1)}`, { uid: UID, createdAt: CREATED.toISOString() });
    h.fake.seed(`summaryAddresses/${fakeHash(2)}`, { uid: UID, createdAt: CREATED.toISOString() });
    h.fake.seed(`summaryAddresses/${fakeHash(3)}`, { uid: OTHER_UID, createdAt: CREATED.toISOString() });

    await expect(deleteSummaryDataForUid(UID, { db: h.db })).resolves.toEqual({ addressDeleted: false, strayIndexDocsDeleted: 2 });
    expect(indexDocsOf(h, UID)).toEqual([]);
    expect(h.fake.has(`summaryAddresses/${fakeHash(3)}`)).toBe(true);
    expect(functionsLogger.warn).toHaveBeenCalledWith('summaries.account_deletion.stray_index_docs', { uid: UID, count: 2 });
  });

  it('sweeps in pages, and past the page cap fails loudly instead of leaving any behind; a retry finishes', async () => {
    const h = harness();
    const total = STRAY_INDEX_PAGE_SIZE * STRAY_INDEX_MAX_PAGES + 1;
    for (let index = 0; index < total; index += 1) h.fake.seed(`summaryAddresses/${fakeHash(index)}`, { uid: UID });

    await expect(deleteSummaryDataForUid(UID, { db: h.db })).rejects.toThrow('summaryAddresses documents remain');
    expect(h.fake.batchSizes).toEqual(Array.from({ length: STRAY_INDEX_MAX_PAGES }, () => STRAY_INDEX_PAGE_SIZE));
    expect(indexDocsOf(h, UID)).toHaveLength(1);
    expect(functionsLogger.warn).toHaveBeenCalledWith('summaries.account_deletion.incomplete', {
      uid: UID,
      strayIndexDocsDeleted: STRAY_INDEX_PAGE_SIZE * STRAY_INDEX_MAX_PAGES,
    });

    await expect(deleteSummaryDataForUid(UID, { db: h.db })).resolves.toEqual({ addressDeleted: false, strayIndexDocsDeleted: 1 });
    expect(indexDocsOf(h, UID)).toEqual([]);
  });

  it('stops after a full last page once the next page is empty', async () => {
    const h = harness();
    for (let index = 0; index < STRAY_INDEX_PAGE_SIZE * 2; index += 1) h.fake.seed(`summaryAddresses/${fakeHash(index)}`, { uid: UID });
    await expect(deleteSummaryDataForUid(UID, { db: h.db })).resolves.toEqual({ addressDeleted: false, strayIndexDocsDeleted: STRAY_INDEX_PAGE_SIZE * 2 });
    expect(h.fake.batchSizes).toEqual([STRAY_INDEX_PAGE_SIZE, STRAY_INDEX_PAGE_SIZE]);
  });

  it('is idempotent: a repeat call (a retried account deletion) writes nothing', async () => {
    const h = harness();
    await connect(h, UID, USER_MAILBOX);
    await deleteSummaryDataForUid(UID, { db: h.db });
    const writes = h.fake.writeLog().length;
    await expect(deleteSummaryDataForUid(UID, { db: h.db })).resolves.toEqual({ addressDeleted: false, strayIndexDocsDeleted: 0 });
    expect(h.fake.writeLog()).toHaveLength(writes);
    expect(h.fake.batchSizes).toEqual([]);
  });

  it('closes the race: mail that resolved before the deletion drops at commit and recreates nothing', async () => {
    const h = harness();
    const hash = await connect(h, UID, USER_MAILBOX);
    // The delivery looked the address up (resolveToken) before the deletion ran...
    expect(await resolveToken(hash, { db: h.db })).toBe(UID);
    const input = commitInputFor(UID, hash);
    await deleteSummaryDataForUid(UID, { db: h.db, now: () => NOW });

    // ...and reaches its write transactions after it: each re-reads the address and drops.
    await expect(commitSummary(h.db, input)).resolves.toMatchObject({ outcome: 'dropped', reason: 'address_changed' });
    await expect(
      recordRefusal(h.db, { uid: UID, reason: 'not_from_your_notetaker', senderDomain: null, providerEventId: 'pm-1', now: NOW, tokenHash: hash }),
    ).resolves.toBe('dropped');
    await expect(
      storeGmailRequest(h.db, {
        uid: UID,
        gmailAddress: 'dana@gmail.example',
        code: 'ABC123',
        accountEmail: null,
        receivedAt: NOW,
        now: NOW,
        tokenHash: hash,
      }),
    ).resolves.toBe('dropped');

    expect(h.fake.paths(`users/${UID}/meetingSummaries/`)).toEqual([]);
    expect(h.fake.paths('summaryUsers/')).toEqual([]);
    expect(h.fake.paths('summaryAddresses/')).toEqual([]);
    expect(h.fake.paths('summaryEvents/')).toEqual([]);
  });

  it('rejects a malformed uid before reading anything', async () => {
    const h = harness();
    await expect(deleteSummaryDataForUid('users/x', { db: h.db })).rejects.toThrow('invalid uid');
    expect(h.fake.log).toEqual([]);
  });

  it('propagates a Firestore failure with nothing half-deleted, and a retry completes', async () => {
    const h = harness();
    const hash = await connect(h, UID, USER_MAILBOX);
    h.fake.failNextCommit = new Error('UNAVAILABLE');
    await expect(deleteSummaryDataForUid(UID, { db: h.db })).rejects.toThrow('UNAVAILABLE');
    expect(h.fake.has(`summaryUsers/${UID}`)).toBe(true);
    expect(h.fake.has(`summaryAddresses/${hash}`)).toBe(true);

    await expect(deleteSummaryDataForUid(UID, { db: h.db })).resolves.toEqual({ addressDeleted: true, strayIndexDocsDeleted: 0 });
    expect(h.fake.has(`summaryUsers/${UID}`)).toBe(false);
  });

  it('logs the uid, tok8 and counts only: never the token, the hash, the address or a mailbox', async () => {
    const h = harness();
    const hash = await connect(h, UID, USER_MAILBOX);
    const token = parseSummaryUser(h.fake.data(`summaryUsers/${UID}`)).token ?? '';
    const address = parseSummaryUser(h.fake.data(`summaryUsers/${UID}`)).address ?? '';
    h.fake.seed(`summaryAddresses/${fakeHash(9)}`, { uid: UID });
    (functionsLogger.info as jest.Mock).mockClear();
    await deleteSummaryDataForUid(UID, { db: h.db, now: () => NOW });

    expect(functionsLogger.info).toHaveBeenCalledWith('summaries.address.deleted', { uid: UID, tok8: hash.slice(0, 8), mode: 'account_deletion' });
    const text = loggedText();
    expect(token).toHaveLength(26);
    for (const secret of [token, hash, fakeHash(9), address, USER_MAILBOX]) expect(text).not.toContain(secret);
  });
});

// ---------------------------------------------------------------------------------------------
// deleteAccount and the replay, over the real summary port
// ---------------------------------------------------------------------------------------------

describe('account deletion wiring', () => {
  /** The real Firebase summary port with the other ports on the same fake. */
  function wiredPorts(h: Harness, hooks: { onAuthDelete?: () => Promise<void>; onFirstPass?: () => Promise<void> } = {}): AccountDeletionPorts {
    const real = firebaseAccountDeletionPorts();
    let passes = 0;
    return {
      recordDeletion: async (uid, deletedAtIso) => {
        await h.db.doc(`accountDeletions/${uid}`).set({ deletedAt: deletedAtIso });
      },
      revokeRefreshTokens: async () => true,
      deleteSummaryData: (uid) => real.deleteSummaryData(uid),
      recursiveDelete: async (path) => {
        if (path.startsWith('users/')) {
          passes += 1;
          if (passes === 1 && hooks.onFirstPass) await hooks.onFirstPass();
        }
        h.fake.recursiveDeletePath(path);
      },
      deleteDocument: async (path) => {
        h.fake.docs.delete(path);
      },
      deleteWhatsAppData: async () => undefined,
      deleteZoomRegistry: async () => undefined,
      deleteMicrosoftIdentities: async () => undefined,
      // Assistant A1 (PR #7): its lookups live in other collections, untouched by this fake.
      deleteMatterLookups: async () => undefined,
      deleteAuthUser: async () => {
        if (hooks.onAuthDelete) await hooks.onAuthDelete();
        return true;
      },
    };
  }

  /** Every path that still holds data of `uid` (the summaryEvents markers carry no uid). */
  function leftovers(h: Harness, uid: string): string[] {
    return [...h.fake.paths(`users/${uid}`), ...h.fake.paths(`summaryUsers/${uid}`), ...indexDocsOf(h, uid)];
  }

  it('the Firebase port removes the address with no tombstone, and the whole deletion leaves no summary data', async () => {
    const h = harness();
    const hash = await connect(h, UID, USER_MAILBOX);
    await connect(h, OTHER_UID, OTHER_MAILBOX);
    h.fake.seed(`users/${UID}/meetingSummaries/${'d'.repeat(64)}`, { status: 'matched', expiresAt: '2027-11-12T10:00:00.000Z' });
    h.fake.seed(`users/${UID}/meetingSummaries/refused-2026-11-12`, { status: 'refused', expiresAt: '2026-12-12T10:00:00.000Z' });
    h.fake.seed(`summaryAddresses/${fakeHash(4)}`, { uid: UID });

    await expect(deleteAccountData(UID, wiredPorts(h), NOW)).resolves.toEqual({ deleted: true });

    expect(leftovers(h, UID)).toEqual([]);
    expect(await resolveToken(hash, { db: h.db })).toBeNull();
    expect(h.fake.has(`accountDeletions/${UID}`)).toBe(true);
    expect(h.fake.has(`summaryUsers/${OTHER_UID}`)).toBe(true);
    expect(h.fake.has(`users/${OTHER_UID}`)).toBe(true);
  });

  it('a delivery committing during the first recursive pass drops (the address is already gone)', async () => {
    const h = harness();
    const hash = await connect(h, UID, USER_MAILBOX);
    const input = commitInputFor(UID, hash);
    let outcome: unknown = null;
    const ports = wiredPorts(h, {
      onFirstPass: async () => {
        outcome = await commitSummary(h.db, input);
      },
    });
    await deleteAccountData(UID, ports, NOW);
    expect(outcome).toMatchObject({ outcome: 'dropped', reason: 'address_changed' });
    expect(leftovers(h, UID)).toEqual([]);
  });

  it('an address created by a summaryAction call that raced the deletion is removed by the late sweep', async () => {
    const h = harness();
    await connect(h, UID, USER_MAILBOX);
    const ports = wiredPorts(h, {
      onAuthDelete: async () => {
        // The app still holds a valid ID token: create_address runs after the first sweep.
        await createAddress(UID, USER_MAILBOX, { db: h.db, now: () => NOW, template: TEMPLATE });
      },
    });
    await deleteAccountData(UID, ports, NOW);
    expect(leftovers(h, UID)).toEqual([]);
  });

  it('a create_address AFTER the deletion finished writes nothing: the deletion record refuses it (review S5)', async () => {
    const h = harness();
    await connect(h, UID, USER_MAILBOX);
    await deleteAccountData(UID, wiredPorts(h), NOW);
    expect(leftovers(h, UID)).toEqual([]);
    // A second device still holds an ID token that onCall accepts for up to an hour.
    const late = await createAddress(UID, USER_MAILBOX, { db: h.db, now: () => NOW, template: TEMPLATE });
    expect(late).toEqual({ status: 'account_deleted' });
    expect(leftovers(h, UID)).toEqual([]);
    expect(h.fake.paths('summaryUsers/')).not.toContain(`summaryUsers/${UID}`);
    // The refusal is logged by uid and reason only.
    expect(functionsLogger.info).toHaveBeenCalledWith('summaries.address.refused', { uid: UID, reason: 'account_deleted' });
  });

  it('the deletion replay removes a restored address and the restored summaries', async () => {
    const h = harness();
    const hash = await connect(h, UID, USER_MAILBOX);
    h.fake.seed(`users/${UID}/meetingSummaries/${'e'.repeat(64)}`, { status: 'inbox', expiresAt: '2027-01-11T10:00:00.000Z' });
    h.fake.seed(`summaryAddresses/${fakeHash(5)}`, { uid: UID });

    const uids = await replayAccountDeletions('2026-11-01T00:00:00Z', {
      listDeletionsSince: async () => [UID],
      recursiveDelete: async (path) => h.fake.recursiveDeletePath(path),
      deleteDocument: async (path) => {
        h.fake.docs.delete(path);
      },
      // What scripts/replay-account-deletions.mjs passes.
      deleteSummaryData: async (uid) => {
        await deleteSummaryDataForUid(uid, { db: h.db });
      },
    });
    expect(uids).toEqual([UID]);
    expect(leftovers(h, UID)).toEqual([]);
    expect(await resolveToken(hash, { db: h.db })).toBeNull();
  });

  it('the replay script wires the same summary deletion', () => {
    const script = readFileSync(join(__dirname, '..', '..', 'scripts', 'replay-account-deletions.mjs'), 'utf8');
    expect(script).toContain("require('../lib/summaries/accountDeletion.js')");
    expect(script).toMatch(/async deleteSummaryData\(uid\) \{\s+await deleteSummaryDataForUid\(uid, \{ db \}\);/);
  });
});

// ---------------------------------------------------------------------------------------------
// dailyMaintenance: the Firestore ports for meetingSummaries and summaryEvents
// ---------------------------------------------------------------------------------------------

describe('dailyMaintenance summary purges (Firestore ports)', () => {
  const RECEIVED = new Date('2026-09-01T12:00:00.000Z');
  const RUN = new Date('2026-11-12T03:30:00.000Z');

  function seedRetention(h: Harness): void {
    // Expiry values exactly as the writers compute them (model.ts).
    h.fake.seed(`users/a/meetingSummaries/${'1'.repeat(64)}`, { status: 'matched', expiresAt: summaryExpiresAt('matched', RECEIVED) });
    h.fake.seed(`users/a/meetingSummaries/${'2'.repeat(64)}`, { status: 'inbox', expiresAt: summaryExpiresAt('inbox', RECEIVED) });
    h.fake.seed(`users/b/meetingSummaries/${'3'.repeat(64)}`, { status: 'kept', expiresAt: summaryExpiresAt('kept', RECEIVED) });
    h.fake.seed('users/b/meetingSummaries/refused-2026-09-01', { status: 'refused', expiresAt: refusedRowExpiresAt(RECEIVED) });
    h.fake.seed(`summaryEvents/${'4'.repeat(64)}`, { expiresAt: markerExpiresAt(RECEIVED) });
    h.fake.seed(`summaryEvents/${'5'.repeat(64)}`, { firstSeenAt: RECEIVED.toISOString(), expiresAt: firstSeenExpiresAt(RECEIVED) });
    h.fake.seed(`summaryEvents/${'6'.repeat(64)}`, { expiresAt: markerExpiresAt(new Date('2026-11-01T00:00:00.000Z')) });
    // Same field name elsewhere: never touched by these purges.
    h.fake.seed('users/a/meetings/m1', { deletedAt: null, expiresAt: '2026-01-01T00:00:00.000Z' });
    h.fake.seed('summaryUsers/a', { tokenHash: null, expiresAt: '2026-01-01T00:00:00.000Z' });
  }

  it('purges summaries, refused rows, markers and first-seen records past their own expiresAt, nothing else', async () => {
    const h = harness();
    seedRetention(h);
    const result = await runDailyMaintenance(firestoreMaintenancePorts(h.db), RUN);

    expect(result).toEqual({
      tombstonesPurged: 0,
      deletionRecordsPurged: 0,
      whatsappEventsPurged: 0,
      whatsappCodesPurged: 0,
      whatsappSessionsPurged: 0,
      meetingSummariesPurged: 2,
      summaryEventsPurged: 2,
      complete: true,
    });
    expect(h.fake.paths()).toEqual(
      [
        `summaryEvents/${'6'.repeat(64)}`,
        'summaryUsers/a',
        `users/a/meetingSummaries/${'1'.repeat(64)}`,
        'users/a/meetings/m1',
        `users/b/meetingSummaries/${'3'.repeat(64)}`,
      ].sort(),
    );

    // A year after receipt the filed and kept summaries go too.
    const later = await runDailyMaintenance(firestoreMaintenancePorts(h.db), new Date('2027-09-02T03:30:00.000Z'));
    expect(later.meetingSummariesPurged).toBe(2);
    expect(later.summaryEventsPurged).toBe(1);
    expect(h.fake.paths()).toEqual(['summaryUsers/a', 'users/a/meetings/m1']);
  });

  it('reads refs only (an empty field mask) and queries the meetingSummaries collection group', async () => {
    const h = harness();
    seedRetention(h);
    const select = jest.spyOn(FakeQuery.prototype, 'select');
    const ports = firestoreMaintenancePorts(h.db);
    await ports.listExpiredMeetingSummaries(RUN.toISOString(), 10);
    await ports.listExpiredSummaryEvents(RUN.toISOString(), 10);
    expect(select).toHaveBeenCalledTimes(2);
    for (const call of select.mock.calls) expect(call).toEqual([]);
    expect(h.fake.log).toEqual(['query:group:meetingSummaries', 'query:summaryEvents']);
  });

  it('honours the page limit it is given (the core pages through the rest)', async () => {
    const h = harness();
    for (let index = 0; index < 5; index += 1) {
      h.fake.seed(`users/u${index}/meetingSummaries/${String(index).repeat(64)}`, { expiresAt: `2026-10-0${index + 1}T00:00:00.000Z` });
    }
    const paths = await firestoreMaintenancePorts(h.db).listExpiredMeetingSummaries(RUN.toISOString(), 3);
    expect(paths).toEqual(['users/u0/meetingSummaries/' + '0'.repeat(64), 'users/u1/meetingSummaries/' + '1'.repeat(64), 'users/u2/meetingSummaries/' + '2'.repeat(64)]);
  });

  it('relies on the meetingSummaries.expiresAt collection-group index in firestore.indexes.json, and on no exemption elsewhere', () => {
    const indexes = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'firestore.indexes.json'), 'utf8')) as {
      fieldOverrides: { collectionGroup: string; fieldPath: string; indexes: { order?: string; queryScope: string }[] }[];
    };
    const override = indexes.fieldOverrides.find((entry) => entry.collectionGroup === 'meetingSummaries' && entry.fieldPath === 'expiresAt');
    expect(override?.indexes).toContainEqual({ order: 'ASCENDING', queryScope: 'COLLECTION' });
    expect(override?.indexes).toContainEqual({ order: 'ASCENDING', queryScope: 'COLLECTION_GROUP' });
    // The summaryEvents purge and the account deletion's summaryAddresses sweep (where uid ==) use
    // the automatic single-field indexes: an exemption on either field would break them.
    const exempted = indexes.fieldOverrides.filter(
      (entry) =>
        (entry.collectionGroup === 'summaryEvents' && entry.fieldPath === 'expiresAt') ||
        (entry.collectionGroup === 'summaryAddresses' && entry.fieldPath === 'uid'),
    );
    expect(exempted).toEqual([]);
  });

  it('uses the design retention (section 7): filed or kept 12 months, inbox 60 days, refused 30, markers 35, Gmail requests 2', () => {
    expect(SUMMARY_RETENTION_DAYS).toMatchObject({ filedOrKept: 365, inbox: 60, refused: 30, markers: 35, gmailRequests: 2 });
    expect(summaryExpiresAt('matched', RECEIVED)).toBe('2027-09-01T12:00:00.000Z');
    expect(summaryExpiresAt('kept', RECEIVED)).toBe('2027-09-01T12:00:00.000Z');
    expect(summaryExpiresAt('inbox', RECEIVED)).toBe('2026-10-31T12:00:00.000Z');
    expect(refusedRowExpiresAt(RECEIVED)).toBe('2026-10-01T12:00:00.000Z');
    expect(markerExpiresAt(RECEIVED)).toBe('2026-10-06T12:00:00.000Z');
  });

  it('never deletes a summary filed or kept, or a marker claimed again, after the purge listed it (review S6)', async () => {
    const h = harness();
    const inboxPath = `users/a/meetingSummaries/${'2'.repeat(64)}`;
    const markerPath = `summaryEvents/${'4'.repeat(64)}`;
    const gonePath = 'users/b/meetingSummaries/refused-2026-09-01';
    h.fake.seed(inboxPath, { status: 'inbox', expiresAt: summaryExpiresAt('inbox', RECEIVED) });
    h.fake.seed(markerPath, { expiresAt: markerExpiresAt(RECEIVED) });
    h.fake.seed(gonePath, { status: 'refused', expiresAt: refusedRowExpiresAt(RECEIVED) });
    const ports = firestoreMaintenancePorts(h.db);
    const listSummaries = ports.listExpiredMeetingSummaries.bind(ports);
    const listEvents = ports.listExpiredSummaryEvents.bind(ports);
    let raced = false;
    // Between the listing and the delete: the user keeps the inbox item (365 days from receipt) and
    // a redelivery claims the expired marker again (35 days from now).
    ports.listExpiredMeetingSummaries = async (nowIso, limit) => {
      const paths = await listSummaries(nowIso, limit);
      if (!raced) {
        raced = true;
        h.fake.seed(inboxPath, { status: 'kept', expiresAt: summaryExpiresAt('kept', RECEIVED) });
      }
      return paths;
    };
    ports.listExpiredSummaryEvents = async (nowIso, limit) => {
      const paths = await listEvents(nowIso, limit);
      if (paths.includes(markerPath)) h.fake.seed(markerPath, { expiresAt: markerExpiresAt(RUN) });
      return paths;
    };
    const result = await runDailyMaintenance(ports, RUN);
    expect(result).toMatchObject({ meetingSummariesPurged: 1, summaryEventsPurged: 0, complete: true });
    expect(h.fake.has(inboxPath)).toBe(true);
    expect(h.fake.data(inboxPath)).toMatchObject({ status: 'kept' });
    expect(h.fake.has(markerPath)).toBe(true);
    expect(h.fake.has(gonePath)).toBe(false);
    // The re-check reads expiresAt only (no sealed field) in a transaction per document.
    const purgeReads = h.fake.transactions.filter((tx) => tx.reads.includes(inboxPath) || tx.reads.includes(gonePath));
    expect(purgeReads.map((tx) => tx.writes)).toEqual(expect.arrayContaining([[], [`delete:${gonePath}`]]));
  });

  it('logs nothing from the summary purges themselves (the scheduled run logs the counts)', async () => {
    const h = harness();
    seedRetention(h);
    await runDailyMaintenance(firestoreMaintenancePorts(h.db), RUN);
    expect(functionsLogger.info).not.toHaveBeenCalled();
    expect(functionsLogger.warn).not.toHaveBeenCalled();
  });
});

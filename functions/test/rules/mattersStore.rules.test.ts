/**
 * The matters store against the Firestore emulator (functions/src/matters/store.ts): the
 * create()-once guarantees the handlers rely on, which the in-memory fake only imitates.
 *   npm run test:rules      (from functions/; needs Java 21+ and firebase-tools)
 * Uses the Admin SDK (security rules do not apply to it), like the deployed functions.
 */
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

import { ACCOUNT_DELETIONS_COLLECTION } from '../../src/maintenance/core';
import { messageIdKey, type MatterDoc, type MatterEvent, type MatterMessage } from '../../src/matters/model';
import { MatterUnreadableError, firestoreMatterStore, type MatterStore } from '../../src/matters/store';

jest.mock('firebase-functions/logger', () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const PROJECT_ID = 'demo-meetingguard';
const ISO = '2026-11-12T09:00:00.000Z';
const TOKEN = '0123456789abcdef01234567';

let app: App;
let db: Firestore;
let store: MatterStore;

function matter(overrides: Partial<MatterDoc> = {}): MatterDoc {
  return {
    status: 'active',
    language: 'en',
    timeZone: 'Europe/Madrid',
    title: 'Proposal from Carlos',
    request: 'Ask Carlos for the proposal',
    source: 'text',
    ownerName: 'Ana Lopez',
    ownerEmail: 'ana@example.com',
    mandate: null,
    firstEmail: null,
    questions: [],
    readBack: '',
    mandateVersion: 1,
    confirmedHash: null,
    confirmedAt: null,
    firstSentAt: null,
    firstSendState: 'none',
    firstSendClaimedAt: null,
    firstSendUnknownCause: null,
    replyToken: TOKEN,
    createdAt: ISO,
    updatedAt: ISO,
    endedAt: null,
    stopReason: null,
    followUpsSent: 0,
    followUpClaim: null,
    lastOutboundAt: null,
    lastInboundAt: null,
    bouncedRecipients: [],
    pendingApprovals: 0,
    dailyCounts: null,
    scheduling: 'ask',
    offeredSlots: [],
    booking: null,
    resumedAt: null,
    pendingChange: null,
    usage: { modelCalls: 0, inputTokens: 0, outputTokens: 0, emails: 0, speechChars: 0 },
    purgedAt: null,
    sendFrom: 'assistant',
    mailboxAddress: null,
    ...overrides,
  };
}

const event = (type: MatterEvent['type']): MatterEvent => ({ type, at: ISO, messageId: null, detail: '' });

function message(rfcMessageId: string, direction: MatterMessage['direction'] = 'outbound'): MatterMessage {
  return {
    direction,
    status: direction === 'outbound' ? 'sent' : 'received',
    rfcMessageId,
    inReplyTo: null,
    references: [],
    from: { name: null, email: 'carlos@example.com' },
    to: ['carlos@example.com'],
    cc: [],
    subject: 'Updated proposal',
    text: 'Hello',
    at: ISO,
    providerId: 'pm-1',
    auth: null,
  };
}

const marker = (providerId: string) => ({ providerId, receivedAt: ISO, expiresAt: '2026-11-19T09:00:00.000Z' });

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Run through npm run test:rules (FIRESTORE_EMULATOR_HOST is not set).');
  app = initializeApp({ projectId: PROJECT_ID }, 'matters-store');
  db = getFirestore(app);
  store = firestoreMatterStore(db);
});

afterAll(async () => {
  await deleteApp(app);
});

beforeEach(async () => {
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: 'DELETE' });
});

describe('matters store (emulator)', () => {
  it('creates the matter, its first event and its reply address together, and only once', async () => {
    await expect(store.createMatter('alice', 'm1', matter(), event('created'))).resolves.toBe(true);
    expect((await db.doc('matterAddresses/' + TOKEN).get()).data()).toEqual({ uid: 'alice', matterId: 'm1', createdAt: ISO });
    expect((await db.collection('users/alice/matters/m1/events').get()).size).toBe(1);
    // the same reply token twice fails as a whole: no second matter points at it
    await expect(store.createMatter('bob', 'm2', matter(), event('created'))).rejects.toThrow();
    expect((await db.doc('users/bob/matters/m2').get()).exists).toBe(false);
    expect((await db.doc('matterAddresses/' + TOKEN).get()).data()).toMatchObject({ uid: 'alice' });
  });

  it('never creates a matter for an account that is being deleted', async () => {
    await db.collection(ACCOUNT_DELETIONS_COLLECTION).doc('alice').set({ deletedAt: ISO });
    await expect(store.createMatter('alice', 'm1', matter(), event('created'))).resolves.toBe(false);
    expect((await db.doc('users/alice/matters/m1').get()).exists).toBe(false);
    expect((await db.doc('matterAddresses/' + TOKEN).get()).exists).toBe(false);
  });

  it('indexes our own Message-ID with create(): a conflicting id fails the whole batch, never re-points', async () => {
    await store.createMatter('alice', 'm1', matter(), event('created'));
    await store.createMatter('bob', 'm2', matter({ replyToken: 'fedcba9876543210fedcba98' }), event('created'));
    const id = '<m1.r1@assistant.meetingguard.ai>';
    await store.addMessage('alice', 'm1', message(id), event('email_sent'), { indexMessageId: true, patch: { firstSendState: 'sent', firstSentAt: ISO } });
    await expect(store.findByMessageKey(messageIdKey(id))).resolves.toEqual({ uid: 'alice', matterId: 'm1' });
    // the same id for another matter: the batch fails, nothing of it is written
    await expect(store.addMessage('bob', 'm2', message(id), event('email_sent'), { indexMessageId: true, patch: { firstSendState: 'sent' } })).rejects.toThrow();
    await expect(store.findByMessageKey(messageIdKey(id))).resolves.toEqual({ uid: 'alice', matterId: 'm1' });
    expect((await db.collection('users/bob/matters/m2/messages').get()).size).toBe(0);
    expect((await store.getMatter('bob', 'm2'))?.firstSendState).toBe('none');
  });

  it('stores an inbound email once: the dedupe marker is created in the same batch', async () => {
    await store.createMatter('alice', 'm1', matter(), event('created'));
    const reply = message('<reply-1@example.com>', 'inbound');
    await expect(store.addInboundMessage('alice', 'm1', reply, event('email_received'), marker('pm-in-1'))).resolves.toBe('stored');
    await expect(store.addInboundMessage('alice', 'm1', reply, event('email_received'), marker('pm-in-1'))).resolves.toBe('duplicate');
    expect((await db.collection('users/alice/matters/m1/messages').get()).size).toBe(1);
    expect((await db.doc('inboundEmails/pm-in-1').get()).data()).toEqual({ receivedAt: ISO, expiresAt: '2026-11-19T09:00:00.000Z' });
    // an inbound Message-ID is never indexed
    await expect(store.findByMessageKey(messageIdKey('<reply-1@example.com>'))).resolves.toBeNull();
    // mail that is not stored is still marked once
    await expect(store.markInbound(marker('pm-in-2'))).resolves.toBe(true);
    await expect(store.markInbound(marker('pm-in-2'))).resolves.toBe(false);
  });

  it('reads a matter with a field it does not know, and reports a broken one as unreadable', async () => {
    await db.doc('users/alice/matters/m1').set({ ...matter(), addedByANewerVersion: true });
    await expect(store.getMatter('alice', 'm1')).resolves.toMatchObject({ status: 'active' });
    // an update is a patch: the unknown field stays
    await store.updateMatter('alice', 'm1', () => ({ result: null, patch: { status: 'paused' } }));
    expect((await db.doc('users/alice/matters/m1').get()).data()).toMatchObject({ status: 'paused', addedByANewerVersion: true });
    await db.doc('users/alice/matters/m2').set({ ...matter(), status: 'archived' });
    await expect(store.getMatter('alice', 'm2')).rejects.toBeInstanceOf(MatterUnreadableError);
    await expect(store.getMatter('alice', 'missing')).resolves.toBeNull();
  });

  it('A2: claims a read once, and a finished read writes its cards, commitments and queue entry in one transaction', async () => {
    await store.createMatter('alice', 'm1', matter(), event('created'));
    await store.addInboundMessage('alice', 'm1', { ...message('<reply-2@example.com>', 'inbound'), readState: 'none' }, event('email_received'), marker('pm-in-3'));
    const [messageDoc] = (await db.collection('users/alice/matters/m1/messages').get()).docs;
    const messageId = messageDoc!.id;
    const claim = { nowIso: ISO, retry: false, staleBeforeIso: '2026-11-12T08:50:00.000Z', maxAttempts: 3 };
    const [a, b] = await Promise.all([store.claimRead('alice', 'm1', messageId, claim), store.claimRead('alice', 'm1', messageId, claim)]);
    expect([a.state, b.state].sort()).toEqual(['busy', 'claimed']);
    expect((await db.doc(`matterReadQueue/m1_${messageId}`).get()).exists).toBe(true);
    const card = {
      kind: 'unclear' as const, status: 'pending' as const, reason: null, quote: null, from: null, draft: null, draftHash: null, threading: null,
      guardFlags: [], sendOutcome: null, sendState: 'none' as const, sendClaimedAt: null, auto: false, sourceMessageId: messageId,
      createdAt: ISO, updatedAt: ISO, decidedAt: null, slot: null, offers: [],
    };
    await store.updateMatter('alice', 'm1', () => ({
      result: null,
      patch: { pendingApprovals: 1 },
      cards: [{ id: 'c1', doc: card }],
      message: { id: messageId, patch: { readState: 'done', readOutcome: 'unclear' } },
      readQueue: { messageId, doc: null },
      schedule: { nextActionAt: '2026-11-14T09:00:00.000Z' },
    }));
    await expect(store.getCard('alice', 'm1', 'c1')).resolves.toMatchObject({ kind: 'unclear', status: 'pending' });
    await expect(store.getMessage('alice', 'm1', messageId)).resolves.toMatchObject({ readState: 'done' });
    expect((await db.doc(`matterReadQueue/m1_${messageId}`).get()).exists).toBe(false);
    await expect(store.dueSchedules('2026-11-14T09:00:00.000Z', 10)).resolves.toEqual([{ uid: 'alice', matterId: 'm1', nextActionAt: '2026-11-14T09:00:00.000Z' }]);
    await expect(store.dueSchedules('2026-11-14T08:59:59.000Z', 10)).resolves.toEqual([]);
  });

  it('A2: an accepted commitment creates its task once, in the same transaction', async () => {
    await store.createMatter('alice', 'm1', matter(), event('created'));
    const proposal = {
      quote: 'I will send it tomorrow.', title: 'Carlos: Send it', owner: null, due: null, status: 'open' as const, taskId: null,
      sourceMessageId: 'x1', createdAt: ISO, updatedAt: ISO, decidedAt: null,
    };
    await store.updateMatter('alice', 'm1', () => ({ result: null, proposals: [{ id: 'mt_' + 'e'.repeat(24), doc: proposal }] }));
    const accept = () =>
      store.decideProposal('alice', 'm1', 'mt_' + 'e'.repeat(24), (_m, p, exists) => ({
        result: exists,
        proposal: { status: 'accepted', taskId: 'mt_' + 'e'.repeat(24) },
        ...(exists ? {} : { task: { id: 'mt_' + 'e'.repeat(24), doc: { userId: 'alice', title: p!.title } } }),
      }));
    await expect(accept()).resolves.toBe(false);
    await expect(accept()).resolves.toBe(true);
    expect((await db.doc(`users/alice/tasks/mt_${'e'.repeat(24)}`).get()).data()).toEqual({ userId: 'alice', title: 'Carlos: Send it' });
  });
});

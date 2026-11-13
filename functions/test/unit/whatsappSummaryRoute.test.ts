/**
 * The webhook's suggested-tasks routing (functions/src/whatsapp/summaryRoute.ts and its two blocks in
 * webhook.ts; session.ts summaryOffer; docs/v2/M11-DESIGN.md section 4.1, section 8 "Webhook").
 * The session and link stores are the REAL Firestore adapters over the in-memory fake, so the
 * one-armed rule and the relink clear are tested on the writes that ship. The end-to-end cases run
 * the real worker behind an in-memory port. All data is synthetic.
 */
jest.mock('firebase-functions/logger', () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

import * as logger from 'firebase-functions/logger';
import type { Firestore } from 'firebase-admin/firestore';

import type { AiAction, AssistantRequest, AssistantResponse } from '../../src/shared/aiContract';
import { SUMMARY_WHATSAPP_TUNING } from '../../src/config';
import { handleSummaryWhatsApp, type SummaryWhatsAppDeps } from '../../src/summaries/whatsappCommitments';
import { uidTagOf, type SummaryOffer, type SummaryWhatsAppRequest, type SummaryWhatsAppResponse } from '../../src/summaries/whatsappProtocol';
import type { MeetingStore } from '../../src/whatsapp/executor';
import { SUMMARY_BOT_STRINGS } from '../../src/whatsapp/messages';
import type { WhatsappButton, WhatsappSender } from '../../src/whatsapp/send';
import { firestoreSummaryOfferStore, firestoreWhatsappStore, parseSession, withFreshContext } from '../../src/whatsapp/session';
import { hashLinkCode } from '../../src/whatsapp/signature';
import type { PortResult, SummaryPort } from '../../src/whatsapp/summaryPort';
import { isSummaryTrigger, parseSummaryReply } from '../../src/whatsapp/summaryRoute';
import { processInboundMessage, processWebhookPayload, type InboundMessage, type WebhookDeps } from '../../src/whatsapp/webhook';
import { NOW, OTHER_UID, SUMMARY_A, UID, harness, seedMeeting, seedSummary, type Harness } from './commitmentsHarness';
import { FakeFirestore } from './summariesFakeFirestore';

const PHONE = '15550002222';
const SESSION = `whatsappSessions/${PHONE}`;

class FakeSender implements WhatsappSender {
  sent: { kind: 'text' | 'buttons'; body: string; buttons?: WhatsappButton[] }[] = [];
  failText: RegExp | null = null;
  failButtons = false;
  async sendText(_to: string, body: string): Promise<void> {
    if (this.failText !== null && this.failText.test(body)) throw new Error('graph down');
    this.sent.push({ kind: 'text', body });
  }
  async sendButtons(_to: string, body: string, buttons: readonly WhatsappButton[]): Promise<void> {
    if (this.failButtons) throw new Error('graph down');
    this.sent.push({ kind: 'buttons', body, buttons: [...buttons] });
  }
}

class FakePort implements SummaryPort {
  calls: { request: SummaryWhatsAppRequest; timeoutMs: number }[] = [];
  constructor(private readonly answer: (request: SummaryWhatsAppRequest) => Promise<PortResult> | PortResult) {}
  async call(request: SummaryWhatsAppRequest, timeoutMs: number): Promise<PortResult> {
    this.calls.push({ request: structuredClone(request), timeoutMs });
    return this.answer(request);
  }
}

const noMeetings: MeetingStore = {
  getMeeting: async () => undefined,
  createMeeting: async () => undefined,
  updateMeetingFields: async () => undefined,
  newMeetingId: () => 'm1',
};

function offer(overrides: Partial<SummaryOffer> = {}): SummaryOffer {
  return {
    offerId: 'a'.repeat(16),
    uidTag: uidTagOf(UID),
    summaryId: SUMMARY_A,
    key: `x_${'1'.repeat(16)}`,
    anchors: [
      { n: 1, a: 'i_000000000001' },
      { n: 2, a: 'i_000000000002' },
      { n: 3, a: 'i_000000000003' },
    ],
    marked: [1, 2],
    open: [1, 2, 3],
    ai: 'offered',
    expiresAt: new Date(NOW.getTime() + 15 * 60_000).toISOString(),
    ...overrides,
  };
}

function listAnswer(next: SummaryOffer = offer(), text = 'LIST TEXT'): PortResult {
  const response: SummaryWhatsAppResponse = {
    outcome: 'offered',
    text,
    buttons: { body: 'Add the 2 marked tasks?', items: [{ id: `wa_sum_all:${next.offerId}`, title: 'Add marked (2)' }, { id: `wa_sum_none:${next.offerId}`, title: 'None' }] },
    offer: { action: 'set', offer: next },
  };
  return { kind: 'ok', response };
}

interface World {
  db: FakeFirestore;
  sender: FakeSender;
  port: FakePort;
  assistant: AssistantRequest[];
  deps: WebhookDeps;
  clock: { now: Date };
  pilot: Set<string>;
}

function world(options: { db?: FakeFirestore; port?: FakePort; summaries?: boolean; reply?: Partial<AssistantResponse> } = {}): World {
  const db = options.db ?? new FakeFirestore();
  db.seed(`whatsappLinks/${PHONE}`, { uid: UID, linkedAt: NOW.toISOString(), profileName: null });
  db.seed(`users/${UID}/settings/preferences`, { language: 'en', timezone: 'America/Mexico_City' });
  const sender = new FakeSender();
  const port = options.port ?? new FakePort(() => listAnswer());
  const assistant: AssistantRequest[] = [];
  const clock = { now: NOW };
  const pilot = new Set([UID]);
  const firestore = db as unknown as Firestore;
  const deps: WebhookDeps = {
    store: firestoreWhatsappStore(firestore),
    sender,
    assistant: async (_uid, request) => {
      assistant.push(structuredClone(request));
      return { reply: 'Assistant reply.', actions: [], suggestions: [], usage: { used: 1, limit: 10, plan: 'free', resetsAt: '2026-10-18T00:00:00.000Z' }, ...options.reply };
    },
    executor: { store: noMeetings, now: () => clock.now },
    dailyLimit: 50,
    displayNumber: '',
    now: () => clock.now,
    newNonce: () => 'nonce1',
    ...(options.summaries === false
      ? {}
      : { summaries: { allowed: (uid: string) => pilot.has(uid), port, offers: firestoreSummaryOfferStore(firestore) } }),
  };
  return { db, sender, port, assistant, deps, clock, pilot };
}

let wamids = 0;
function text(body: string): InboundMessage {
  wamids += 1;
  return { wamid: `wamid.t${wamids}`, from: PHONE, type: 'text', text: body, buttonReplyId: null, profileName: null, timestamp: null };
}
function button(id: string): InboundMessage {
  wamids += 1;
  return { wamid: `wamid.b${wamids}`, from: PHONE, type: 'interactive', text: null, buttonReplyId: id, profileName: null, timestamp: null };
}

function sessionOf(w: World) {
  return parseSession(w.db.data(SESSION), w.clock.now);
}

function armed(w: World, next: SummaryOffer = offer()): void {
  w.db.seed(SESSION, { ...(w.db.data(SESSION) ?? {}), summaryOffer: next, updatedAt: w.clock.now.toISOString() });
}

const createAction: AiAction = {
  type: 'create_meeting',
  id: 'a1',
  summary: 'Create "Dentist" Tuesday 9:30',
  confidence: 90,
  meeting: {
    title: 'Dentist',
    description: '',
    startAt: '2026-10-20T09:30:00.000Z',
    durationMinutes: 30,
    timezone: 'UTC',
    allDay: false,
    location: null,
    conference: null,
    participants: [],
    preparationTips: [],
    customAlertTimes: null,
    language: 'en',
  },
};

// ---------------------------------------------------------------------------------------------
// Reading the text
// ---------------------------------------------------------------------------------------------

describe('reading the text', () => {
  it('knows the trigger phrases exactly, after case, accents, spaces and a final mark', () => {
    for (const phrase of ['commitments', 'Commitments', '  COMPROMISOS! ', 'tasks from my  summary', 'Tareas de mi minuta?']) expect([phrase, isSummaryTrigger(phrase)]).toEqual([phrase, true]);
    for (const phrase of ['commitment', 'my commitments', 'compromiso', 'tasks', '']) expect([phrase, isSummaryTrigger(phrase)]).toEqual([phrase, false]);
  });

  it('reads every reply form', () => {
    expect(parseSummaryReply('ALL')).toEqual({ kind: 'all' });
    expect(parseSummaryReply('todos')).toEqual({ kind: 'all' });
    expect(parseSummaryReply('1 3')).toEqual({ kind: 'numbers', numbers: [1, 3] });
    expect(parseSummaryReply('1,3')).toEqual({ kind: 'numbers', numbers: [1, 3] });
    expect(parseSummaryReply('1 y 3')).toEqual({ kind: 'numbers', numbers: [1, 3] });
    expect(parseSummaryReply('1, 3 and 5')).toEqual({ kind: 'numbers', numbers: [1, 3, 5] });
    expect(parseSummaryReply('2')).toEqual({ kind: 'numbers', numbers: [2] });
    expect(parseSummaryReply('DROP 2')).toEqual({ kind: 'drop', numbers: [2] });
    expect(parseSummaryReply('quitar 2, 4')).toEqual({ kind: 'drop', numbers: [2, 4] });
    expect(parseSummaryReply('NONE')).toEqual({ kind: 'none' });
    expect(parseSummaryReply('ninguno')).toEqual({ kind: 'none' });
    expect(parseSummaryReply('NO')).toEqual({ kind: 'close' });
    expect(parseSummaryReply('cancel')).toEqual({ kind: 'close' });
    expect(parseSummaryReply('CANCELAR')).toEqual({ kind: 'close' });
    expect(parseSummaryReply('AI')).toEqual({ kind: 'ai' });
    expect(parseSummaryReply('IA')).toEqual({ kind: 'ai' });
    for (const other of ['hello', 'drop', 'drop it', '1 3 please', '0', '1000', 'yes', 'si', '1-3', '']) expect([other, parseSummaryReply(other)]).toEqual([other, null]);
  });
});

// ---------------------------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------------------------

describe('routing', () => {
  beforeEach(() => jest.mocked(logger.info).mockClear());

  it('"commitments" from a pilot user reaches the port, arms the offer, sends the text then the buttons, and never reaches the assistant', async () => {
    const w = world();
    await processInboundMessage(text('commitments'), w.deps);
    expect(w.port.calls).toEqual([{ request: { op: 'offer', phoneE164: PHONE, language: 'en' }, timeoutMs: SUMMARY_WHATSAPP_TUNING.maxPortTimeoutMs }]);
    expect(w.sender.sent.map((entry) => entry.kind)).toEqual(['text', 'buttons']);
    expect(w.sender.sent[0]?.body).toBe('LIST TEXT');
    expect(w.sender.sent[1]?.buttons?.map((entry) => entry.id)).toEqual([`wa_sum_all:${'a'.repeat(16)}`, `wa_sum_none:${'a'.repeat(16)}`]);
    expect(sessionOf(w).summaryOffer).toEqual(offer());
    expect(w.assistant).toEqual([]);
    expect(sessionOf(w).turns).toEqual([]);
  });

  it('"commitments" from a non-pilot user, or with summaries off at load, reaches the assistant exactly as before', async () => {
    const outside = world();
    outside.pilot.clear();
    await processInboundMessage(text('commitments'), outside.deps);
    const off = world({ summaries: false });
    await processInboundMessage(text('commitments'), off.deps);
    for (const w of [outside, off]) {
      expect(w.port.calls).toEqual([]);
      expect(w.assistant.map((request) => request.messages)).toEqual([[{ role: 'user', content: 'commitments' }]]);
      expect(w.sender.sent.map((entry) => entry.body)).toEqual(['Assistant reply.']);
    }
  });

  it('a reply to a live offer goes to the worker; NO closes it without a call; ALL with nothing marked answers here', async () => {
    const w = world({ port: new FakePort((request) => (request.op === 'reply' ? { kind: 'ok', response: { outcome: 'decided', text: 'RESULT', buttons: null, offer: { action: 'refresh', offer: offer({ open: [2] }) } } } : listAnswer())) });
    armed(w);
    await processInboundMessage(text('1 y 3'), w.deps);
    expect(w.port.calls[0]?.request).toEqual({ op: 'reply', phoneE164: PHONE, language: 'en', offer: offer(), selection: { kind: 'numbers', numbers: [1, 3] } });
    expect(w.sender.sent.map((entry) => entry.body)).toEqual(['RESULT']);
    expect(sessionOf(w).summaryOffer?.open).toEqual([2]);
    await processInboundMessage(text('cancelar'), w.deps);
    expect(w.port.calls).toHaveLength(1);
    expect(w.sender.sent.at(-1)?.body).toBe(SUMMARY_BOT_STRINGS.en.closed);
    expect(sessionOf(w).summaryOffer).toBeNull();
    armed(w, offer({ marked: [] }));
    await processInboundMessage(text('ALL'), w.deps);
    expect(w.port.calls).toHaveLength(1);
    expect(w.sender.sent.at(-1)?.body).toBe(SUMMARY_BOT_STRINGS.en.nothingMarked);
    expect(w.assistant).toEqual([]);
  });

  it('any other text leaves the offer alone and goes to the assistant; AI on an AI list is not a reply', async () => {
    const w = world();
    armed(w, offer({ ai: 'none' }));
    await processInboundMessage(text('What do I have tomorrow?'), w.deps);
    await processInboundMessage(text('AI'), w.deps);
    expect(w.port.calls).toEqual([]);
    expect(w.assistant).toHaveLength(2);
    expect(sessionOf(w).summaryOffer).toEqual(offer({ ai: 'none' }));
  });

  it('an expired offer, or one made for another uid, is not a live offer', async () => {
    const w = world();
    armed(w, offer({ expiresAt: new Date(NOW.getTime() - 1000).toISOString() }));
    await processInboundMessage(text('1'), w.deps);
    armed(w, offer({ uidTag: uidTagOf(OTHER_UID) }));
    await processInboundMessage(text('2'), w.deps);
    expect(w.port.calls).toEqual([]);
    expect(w.assistant).toHaveLength(2);
  });

  it('keeps a live offer when the conversation went idle (its own expiry, not the turns clock)', async () => {
    const w = world({ port: new FakePort(() => ({ kind: 'ok', response: { outcome: 'decided', text: 'RESULT', buttons: null, offer: { action: 'keep' } } })) });
    w.db.seed(SESSION, { updatedAt: new Date(NOW.getTime() - 60 * 60_000).toISOString(), turns: [{ role: 'user', text: 'old', atIso: '2026-10-17T13:00:00.000Z' }], summaryOffer: offer() });
    expect(withFreshContext(sessionOf(w), NOW).summaryOffer).toEqual(offer());
    await processInboundMessage(text('1'), w.deps);
    expect(w.port.calls).toHaveLength(1);
  });

  it('the buttons of the live offer reach the worker; an old button answers expired; a non-pilot tap is ignored', async () => {
    const w = world({ port: new FakePort(() => ({ kind: 'ok', response: { outcome: 'decided', text: 'RESULT', buttons: null, offer: { action: 'keep' } } })) });
    armed(w);
    await processInboundMessage(button(`wa_sum_all:${'a'.repeat(16)}`), w.deps);
    await processInboundMessage(button(`wa_sum_none:${'a'.repeat(16)}`), w.deps);
    expect(w.port.calls.map((call) => (call.request.op === 'reply' ? call.request.selection : null))).toEqual([{ kind: 'all' }, { kind: 'none' }]);
    await processInboundMessage(button(`wa_sum_all:${'b'.repeat(16)}`), w.deps);
    expect(w.sender.sent.at(-1)?.body).toBe(SUMMARY_BOT_STRINGS.en.expired);
    w.pilot.clear();
    const before = w.sender.sent.length;
    await processInboundMessage(button(`wa_sum_all:${'a'.repeat(16)}`), w.deps);
    expect(w.sender.sent).toHaveLength(before);
    expect(w.port.calls).toHaveLength(2);
  });

  it('an unreachable worker gives the fallback text; a port timeout says "Still preparing" for an offer and the reply text for numbers', async () => {
    const unreachable = world({ port: new FakePort(() => ({ kind: 'unreachable', reason: 'status', status: 403 })) });
    await processInboundMessage(text('compromisos'), unreachable.deps);
    expect(unreachable.sender.sent.map((entry) => entry.body)).toEqual([SUMMARY_BOT_STRINGS.en.unavailable]);
    expect(sessionOf(unreachable).summaryOffer).toBeNull();
    const slow = world({ port: new FakePort(() => ({ kind: 'timeout' })) });
    await processInboundMessage(text('commitments'), slow.deps);
    armed(slow);
    await processInboundMessage(text('1'), slow.deps);
    expect(slow.sender.sent.map((entry) => entry.body)).toEqual([SUMMARY_BOT_STRINGS.en.stillPreparing, SUMMARY_BOT_STRINGS.en.replyTimeout]);
  });

  it('a port call started at 230 s of the batch gets the short timeout and the "Still preparing" text', async () => {
    const w = world({ port: new FakePort(() => ({ kind: 'timeout' })) });
    await processInboundMessage(text('commitments'), w.deps, { startedMs: NOW.getTime() - 230_000 });
    expect(w.port.calls[0]?.timeoutMs).toBe(SUMMARY_WHATSAPP_TUNING.minPortTimeoutMs);
    expect(w.sender.sent.map((entry) => entry.body)).toEqual([SUMMARY_BOT_STRINGS.en.stillPreparing]);
    // processWebhookPayload hands its own start to every message of the batch.
    const batch = world();
    let calls = 0;
    batch.deps.now = () => new Date(NOW.getTime() + (calls++ > 2 ? 200_000 : 0));
    await processWebhookPayload(
      { object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { messages: [{ id: 'wamid.batch1', from: PHONE, type: 'text', text: { body: 'commitments' } }] } }] }] },
      batch.deps,
    );
    expect(batch.port.calls[0]?.timeoutMs).toBe(240_000 - 200_000 - SUMMARY_WHATSAPP_TUNING.sendsReserveMs);
  });

  it('a list that cannot be sent is disarmed again; a failed button send keeps it (the text has the replies)', async () => {
    const w = world();
    w.sender.failText = /LIST TEXT/;
    await processInboundMessage(text('commitments'), w.deps);
    expect(sessionOf(w).summaryOffer).toBeNull();
    const buttons = world();
    buttons.sender.failButtons = true;
    await processInboundMessage(text('commitments'), buttons.deps);
    expect(sessionOf(buttons).summaryOffer).toEqual(offer());
    expect(buttons.sender.sent.map((entry) => entry.kind)).toEqual(['text']);
  });

  it('logs outcomes only: no text, title, number or phone number', async () => {
    const w = world({ port: new FakePort(() => listAnswer(offer(), 'Secret Title Bish')) });
    await processInboundMessage(text('commitments'), w.deps);
    await processInboundMessage(text('1 3'), w.deps);
    const logged = JSON.stringify([jest.mocked(logger.info).mock.calls, jest.mocked(logger.warn).mock.calls, jest.mocked(logger.error).mock.calls]);
    expect(logged).toContain('whatsapp.summary');
    for (const secret of ['Secret Title', 'Bish', PHONE, '1 3', SUMMARY_A]) expect(logged).not.toContain(secret);
  });
});

// ---------------------------------------------------------------------------------------------
// One armed at a time, the relink, the stored shape (the real Firestore adapters)
// ---------------------------------------------------------------------------------------------

describe('summaryOffer and pendingActions', () => {
  it('arming one disarms the other in the same write, also when two invocations race', async () => {
    const db = new FakeFirestore();
    const store = firestoreWhatsappStore(db as unknown as Firestore);
    const offers = firestoreSummaryOfferStore(db as unknown as Firestore);
    const patch = { uid: UID, turns: [], updatedAt: NOW.toISOString() };
    const proposal = { pendingActions: [createAction], pendingNonce: 'n1', promptMsgId: 'w1', actionsExpireAt: new Date(NOW.getTime() + 60_000).toISOString() };
    await store.savePendingProposal(PHONE, patch, proposal);
    await offers.armSummaryOffer(PHONE, offer());
    expect(parseSession(db.data(SESSION), NOW)).toMatchObject({ pendingActions: null, pendingNonce: null, summaryOffer: offer() });
    await store.savePendingProposal(PHONE, patch, proposal);
    expect(parseSession(db.data(SESSION), NOW)).toMatchObject({ pendingNonce: 'n1', summaryOffer: null });
    for (let round = 0; round < 4; round += 1) {
      const order = round % 2 === 0 ? [offers.armSummaryOffer(PHONE, offer()), store.savePendingProposal(PHONE, patch, proposal)] : [store.savePendingProposal(PHONE, patch, proposal), offers.armSummaryOffer(PHONE, offer())];
      await Promise.all(order);
      const session = parseSession(db.data(SESSION), NOW);
      expect([session.summaryOffer !== null, session.pendingActions !== null].filter(Boolean)).toHaveLength(1);
    }
  });

  it('the webhook path keeps them apart: an assistant proposal after a list disarms the list', async () => {
    const w = world({ reply: { actions: [createAction] } });
    await processInboundMessage(text('commitments'), w.deps);
    expect(sessionOf(w).summaryOffer).not.toBeNull();
    await processInboundMessage(text('Create a dentist meeting on Tuesday'), w.deps);
    const session = sessionOf(w);
    expect(session.pendingActions).not.toBeNull();
    expect(session.summaryOffer).toBeNull();
    // "1" now confirms the proposal, never a suggestion.
    await processInboundMessage(text('1'), w.deps);
    expect(w.port.calls).toHaveLength(1);
  });

  it('refresh and clear touch only the offer they name', async () => {
    const db = new FakeFirestore();
    const offers = firestoreSummaryOfferStore(db as unknown as Firestore);
    expect(await offers.clearSummaryOffer(PHONE, 'a'.repeat(16))).toBe(false);
    await offers.armSummaryOffer(PHONE, offer());
    expect(await offers.refreshSummaryOffer(PHONE, offer({ offerId: 'b'.repeat(16), open: [] }))).toBe(false);
    expect(await offers.clearSummaryOffer(PHONE, 'b'.repeat(16))).toBe(false);
    expect(parseSession(db.data(SESSION), NOW).summaryOffer).toEqual(offer());
    expect(await offers.refreshSummaryOffer(PHONE, offer({ open: [3] }))).toBe(true);
    expect(parseSession(db.data(SESSION), NOW).summaryOffer?.open).toEqual([3]);
    expect(await offers.clearSummaryOffer(PHONE, 'a'.repeat(16))).toBe(true);
    expect(parseSession(db.data(SESSION), NOW).summaryOffer).toBeNull();
    // None of them writes turns or the idle clock.
    expect(Object.keys(db.data(SESSION) ?? {}).sort()).toEqual(['actionsExpireAt', 'pendingActions', 'pendingNonce', 'promptMsgId', 'summaryOffer']);
  });

  it('a relink to another account clears the offer in the same transaction', async () => {
    const db = new FakeFirestore();
    const store = firestoreWhatsappStore(db as unknown as Firestore);
    const offers = firestoreSummaryOfferStore(db as unknown as Firestore);
    db.seed(`whatsappLinks/${PHONE}`, { uid: UID, linkedAt: NOW.toISOString(), profileName: null });
    await offers.armSummaryOffer(PHONE, offer());
    db.seed(`whatsappLinkCodes/${hashLinkCode('123456')}`, { uid: OTHER_UID, expiresAt: new Date(NOW.getTime() + 60_000).toISOString() });
    expect(await store.redeemLinkCode(hashLinkCode('123456'), PHONE, null, NOW)).toEqual({ status: 'linked', uid: OTHER_UID });
    const session = parseSession(db.data(SESSION), NOW);
    expect(session.uid).toBe(OTHER_UID);
    expect(session.summaryOffer).toBeNull();
  });

  it('a stored offer of another shape reads as none', () => {
    expect(parseSession({ summaryOffer: { offerId: 'x' } }, NOW).summaryOffer).toBeNull();
    expect(parseSession({ summaryOffer: offer() }, NOW).summaryOffer).toEqual(offer());
  });
});

// ---------------------------------------------------------------------------------------------
// End to end with the real worker
// ---------------------------------------------------------------------------------------------

describe('end to end with the worker', () => {
  function connected(h: Harness): World {
    const workerDeps: SummaryWhatsAppDeps = {
      db: h.deps.db,
      now: h.deps.now,
      config: h.deps.config,
      authUsers: { getUser: async () => ({ exists: true, disabled: false, verified: true, displayName: 'Dana Ruiz' }) },
      commitments: () => h.deps,
      logger: h.log.logger,
    };
    // JSON both ways, as over HTTPS.
    const port = new FakePort(async (request) => {
      const answer = await handleSummaryWhatsApp(JSON.parse(JSON.stringify(request)) as unknown, workerDeps);
      return answer.status === 200 ? { kind: 'ok', response: JSON.parse(JSON.stringify(answer.body)) as SummaryWhatsAppResponse } : { kind: 'unreachable', reason: 'status', status: answer.status };
    });
    return world({ db: h.db, port });
  }

  it('nothing of the exchange enters session.turns, and the next assistant request carries none of it', async () => {
    const h = harness();
    seedSummary(h.db, SUMMARY_A);
    seedMeeting(h.db);
    const w = connected(h);
    await processInboundMessage(text('commitments'), w.deps);
    expect(w.sender.sent[0]?.body).toContain('1. [x] Bish: Provide APK access/files to Urpayroll');
    await processInboundMessage(text('1'), w.deps);
    expect(w.sender.sent.at(-1)?.body).toMatch(/^Added 1 task: Bish: Provide APK access\/files to Urpayroll\./);
    await processInboundMessage(text('1'), w.deps);
    expect(w.sender.sent.at(-1)?.body).toBe('Already in your tasks: 1.');
    await processInboundMessage(text('hello'), w.deps);
    expect(w.assistant.map((request) => request.messages)).toEqual([[{ role: 'user', content: 'hello' }]]);
    const stored = JSON.stringify(h.db.data(SESSION));
    for (const content of ['Provide APK', 'Bish', 'Urpayroll', 'commitments']) expect(stored).not.toContain(content);
    expect(sessionOf(w).turns.map((turn) => turn.text)).toEqual(['hello', 'Assistant reply.']);
    expect(h.db.paths(`users/${UID}/tasks/`)).toHaveLength(1);
  });

  it('the ALL button adds the marked ones, and AI prepares only after the reply AI', async () => {
    const h = harness();
    seedSummary(h.db, SUMMARY_A);
    seedMeeting(h.db);
    const w = connected(h);
    await processInboundMessage(text('compromisos'), w.deps);
    expect(h.llmFactory).not.toHaveBeenCalled();
    const ids = w.sender.sent.find((entry) => entry.kind === 'buttons')?.buttons?.map((entry) => entry.id) ?? [];
    await processInboundMessage(button(ids[0] ?? ''), w.deps);
    expect(w.sender.sent.at(-1)?.body).toMatch(/^Added \d+ tasks: /);
    await processInboundMessage(text('AI'), w.deps);
    expect(h.llm.requests).toHaveLength(1);
    expect(w.assistant).toEqual([]);
  });
});

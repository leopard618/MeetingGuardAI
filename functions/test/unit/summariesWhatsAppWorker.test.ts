/**
 * The summaryWhatsApp worker (functions/src/summaries/whatsappCommitments.ts; docs/v2/M11-DESIGN.md
 * sections 4.1, 4.3 and 4.4, section 8 "WhatsApp worker"). Firestore is the in-memory fake, the
 * commitments deps are the M11 harness (scripted model, quota fake, capturing logger). All data is
 * synthetic.
 */
jest.mock('firebase-functions/logger', () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

import { MAX_TEXT_CHARS } from '../../src/whatsapp/send';
import { handleSummaryCommitments } from '../../src/summaries/commitmentsHandler';
import { parseExtraction } from '../../src/summaries/commitmentsModel';
import { summaryDocPath } from '../../src/summaries/model';
import { firebaseWorkerAuthUsers, handleSummaryWhatsApp, type SummaryWhatsAppDeps, type WorkerAuthUser } from '../../src/summaries/whatsappCommitments';
import { uidTagOf, type SummaryOffer, type SummaryWhatsAppResponse } from '../../src/summaries/whatsappProtocol';
import type { SummaryCommitmentsResponse } from '../../src/shared/aiContract';
import { proposal } from './commitmentsFixtures';
import {
  MEETING_TITLE,
  NOW,
  OTHER_UID,
  SUMMARY_A,
  SUMMARY_B,
  UID,
  harness,
  seedMeeting,
  seedSummary,
  sid,
  specimenId,
  toolResult,
  verifiedAuth,
  type Harness,
} from './commitmentsHarness';

const PHONE = '15550001111';
const TASKS = `users/${UID}/tasks/`;

interface Setup {
  h: Harness;
  deps: SummaryWhatsAppDeps;
  user: WorkerAuthUser;
}

function setup(options: { steps?: Parameters<typeof harness>[0]; pilot?: string; enabled?: boolean; link?: string | null } = {}): Setup {
  const h = harness(options.steps ?? [toolResult([])], { ...(options.pilot === undefined ? {} : { pilot: options.pilot }), ...(options.enabled === undefined ? {} : { enabled: options.enabled }) });
  if (options.link !== null) h.db.seed(`whatsappLinks/${PHONE}`, { uid: options.link ?? UID, linkedAt: NOW.toISOString(), profileName: null });
  seedMeeting(h.db);
  const user: WorkerAuthUser = { exists: true, disabled: false, verified: true, displayName: 'Dana Ruiz' };
  let offers = 0;
  const deps: SummaryWhatsAppDeps = {
    db: h.deps.db,
    now: h.deps.now,
    config: h.deps.config,
    authUsers: { getUser: async () => ({ ...user }) },
    commitments: () => h.deps,
    logger: h.log.logger,
    newOfferId: () => {
      offers += 1;
      return offers.toString(16).padStart(16, '0');
    },
  };
  return { h, deps, user };
}

async function ask(deps: SummaryWhatsAppDeps, body: unknown): Promise<SummaryWhatsAppResponse> {
  const answer = await handleSummaryWhatsApp(body, deps);
  expect(answer.status).toBe(200);
  return answer.body as SummaryWhatsAppResponse;
}

function offerRequest(language: 'en' | 'es' = 'en') {
  return { op: 'offer', phoneE164: PHONE, language };
}

function replyRequest(offer: SummaryOffer, selection: unknown, language: 'en' | 'es' = 'en') {
  return { op: 'reply', phoneE164: PHONE, language, offer, selection };
}

function offerOf(response: SummaryWhatsAppResponse): SummaryOffer {
  if (response.offer.action !== 'set' && response.offer.action !== 'refresh') throw new Error(`no offer (${response.offer.action})`);
  return response.offer.offer;
}

async function view(h: Harness, summaryId: string = SUMMARY_A): Promise<SummaryCommitmentsResponse> {
  return handleSummaryCommitments(verifiedAuth(), { op: 'get', summaryId }, h.deps);
}

function tasksOf(h: Harness): Record<string, unknown>[] {
  return h.db.paths(TASKS).map((path) => h.db.data(path) as Record<string, unknown>);
}

function moveReceivedAt(h: Harness, summaryId: string, receivedAt: string): void {
  const path = summaryDocPath(UID, summaryId);
  h.db.seed(path, { ...(h.db.data(path) as Record<string, unknown>), receivedAt });
}

// ---------------------------------------------------------------------------------------------
// Gates
// ---------------------------------------------------------------------------------------------

describe('summaryWhatsApp gates', () => {
  it('takes the uid only from whatsappLinks: a uid in the request is ignored', async () => {
    const { h, deps } = setup({ link: OTHER_UID });
    seedSummary(h.db, SUMMARY_A);
    const response = await ask(deps, { ...offerRequest(), uid: UID });
    expect(response.outcome).toBe('no_summary');
    expect(h.db.paths(`users/${UID}/meetingSummaries/`)).toHaveLength(1);
    expect(parseExtraction(h.db.data(summaryDocPath(UID, SUMMARY_A))?.extraction)).toBeNull();
  });

  it('answers not_linked for a phone without a link, and refuses a request it cannot read', async () => {
    const { deps } = setup({ link: null });
    expect((await ask(deps, offerRequest())).outcome).toBe('not_linked');
    expect(await handleSummaryWhatsApp({ op: 'offer', phoneE164: 'not a phone', language: 'en' }, deps)).toEqual({ status: 400, body: 'Bad Request' });
    expect(await handleSummaryWhatsApp(null, deps)).toEqual({ status: 400, body: 'Bad Request' });
  });

  it('refuses a missing, disabled or unverified account, a uid outside the pilot and the switch off, before reading any summary', async () => {
    for (const patch of [{ exists: false }, { disabled: true }, { verified: false }] as Partial<WorkerAuthUser>[]) {
      const { h, deps, user } = setup();
      Object.assign(user, patch);
      seedSummary(h.db, SUMMARY_A);
      h.db.log.length = 0;
      expect((await ask(deps, offerRequest())).outcome).toBe('not_allowed');
      expect(h.db.log.filter((entry) => entry.includes('meetingSummaries'))).toEqual([]);
    }
    const outside = setup({ pilot: OTHER_UID });
    seedSummary(outside.h.db, SUMMARY_A);
    expect((await ask(outside.deps, offerRequest())).outcome).toBe('not_allowed');
    const off = setup({ enabled: false });
    expect((await ask(off.deps, offerRequest())).outcome).toBe('not_enabled');
  });

  it('reads Firebase Auth as the callables do: a verified email or a trusted provider; a missing user is not an error', async () => {
    const records: Record<string, unknown> = {
      email: { disabled: false, emailVerified: true, providerData: [], displayName: 'Dana' },
      google: { disabled: false, emailVerified: false, providerData: [{ providerId: 'google.com' }], displayName: '' },
      password: { disabled: false, emailVerified: false, providerData: [{ providerId: 'password' }] },
    };
    const users = firebaseWorkerAuthUsers({
      getUser: (async (uid: string) => {
        if (uid in records) return records[uid];
        throw Object.assign(new Error('missing'), { code: 'auth/user-not-found' });
      }) as never,
    });
    expect(await users.getUser('email')).toEqual({ exists: true, disabled: false, verified: true, displayName: 'Dana' });
    expect(await users.getUser('google')).toEqual({ exists: true, disabled: false, verified: true, displayName: null });
    expect((await users.getUser('password')).verified).toBe(false);
    expect(await users.getUser('gone')).toEqual({ exists: false, disabled: false, verified: false, displayName: null });
    const failing = firebaseWorkerAuthUsers({ getUser: (async () => Promise.reject(Object.assign(new Error('x'), { code: 'auth/internal-error' }))) as never });
    await expect(failing.getUser('any')).rejects.toThrow('x');
  });
});

// ---------------------------------------------------------------------------------------------
// The offer
// ---------------------------------------------------------------------------------------------

describe('the offer', () => {
  it('offers the items as written with the AI notice: no model call, no charge, numbers and marks from the extraction', async () => {
    const { h, deps } = setup();
    seedSummary(h.db, SUMMARY_A);
    const response = await ask(deps, offerRequest());
    expect(response.outcome).toBe('offered');
    expect(h.llmFactory).not.toHaveBeenCalled();
    expect(h.quota.transactions).toBe(0);
    const offer = offerOf(response);
    expect(response.offer.action).toBe('set');
    expect(offer.ai).toBe('offered');
    expect(offer.uidTag).toBe(uidTagOf(UID));
    expect(offer.summaryId).toBe(SUMMARY_A);
    expect(Date.parse(offer.expiresAt) - NOW.getTime()).toBe(15 * 60_000);
    const listed = (await view(h)).commitments;
    expect(listed?.mode).toBe('as_written');
    expect(offer.key).toBe(listed?.key);
    expect(offer.anchors).toEqual(listed?.items.map((item) => ({ n: item.number, a: item.anchorId })));
    expect(offer.marked).toEqual(listed?.items.filter((item) => item.preselected).map((item) => item.number));
    expect(offer.marked.length).toBeGreaterThan(0);
    expect(response.text).toContain(`The action items from your notetaker's summary of "${MEETING_TITLE}" (Oct 16), exactly as written.`);
    expect(response.text).toContain('1. [x] Bish: Provide APK access/files to Urpayroll');
    expect(response.text).toContain('Reply AI to have Meeting Guard AI read the whole summary and suggest tasks.');
    expect(response.text).toContain(`Reply ALL to add the ${offer.marked.length} marked`);
    expect(response.buttons?.items.map((button) => button.id)).toEqual([`wa_sum_all:${offer.offerId}`, `wa_sum_none:${offer.offerId}`]);
    expect(response.text.length).toBeLessThanOrEqual(MAX_TEXT_CHARS);
  });

  it('offers an AI list the app already prepared as it is, free, and says it was written by AI', async () => {
    const { h, deps } = setup({ steps: [toolResult([proposal(specimenId('Provide APK'), { title: 'Provide APK access/files to Urpayroll', owner: 'Bish' })])] });
    seedSummary(h.db, SUMMARY_A);
    await handleSummaryCommitments(verifiedAuth(), { op: 'prepare', summaryId: SUMMARY_A, mode: 'ai' }, h.deps);
    const charges = h.quota.transactions;
    const response = await ask(deps, offerRequest());
    expect(response.outcome).toBe('offered');
    expect(offerOf(response).ai).toBe('none');
    expect(response.text).toContain('Written by AI; Meeting Guard AI did not attend. Nothing is added until you reply.');
    expect(response.text).not.toContain('Reply AI');
    expect(h.llm.requests).toHaveLength(1);
    expect(h.quota.transactions).toBe(charges);
  });

  it('offers the AI list the app prepared before switching to the items as written for free (no new model call on AI)', async () => {
    const { h, deps } = setup({ steps: [toolResult([proposal(specimenId('Provide APK'), { title: 'Provide APK access/files to Urpayroll', owner: 'Bish' })])] });
    seedSummary(h.db, SUMMARY_A);
    await handleSummaryCommitments(verifiedAuth(), { op: 'prepare', summaryId: SUMMARY_A, mode: 'ai' }, h.deps);
    await handleSummaryCommitments(verifiedAuth(), { op: 'prepare', summaryId: SUMMARY_A, mode: 'as_written' }, h.deps);
    const charges = h.quota.transactions;
    const response = await ask(deps, offerRequest());
    const offer = offerOf(response);
    expect(offer.ai).toBe('prepared');
    expect(response.text).toContain('Reply AI to see the tasks Meeting Guard AI already suggested for this summary (no new AI action).');
    const ai = await ask(deps, replyRequest(offer, { kind: 'ai' }));
    expect(ai.outcome).toBe('offered');
    expect(offerOf(ai).ai).toBe('none');
    expect(h.llm.requests).toHaveLength(1);
    expect(h.quota.transactions).toBe(charges);
  });

  it('picks the newest filed or kept summary of the last 14 days that has open suggestions or none prepared', async () => {
    const { h, deps } = setup();
    const OLD = sid('old');
    const INBOX = sid('inbox');
    const KEPT = sid('kept');
    seedSummary(h.db, SUMMARY_A);
    seedSummary(h.db, OLD);
    seedSummary(h.db, INBOX, { status: 'inbox' });
    seedSummary(h.db, KEPT, { status: 'kept' });
    moveReceivedAt(h, SUMMARY_A, '2026-10-10T10:00:00.000Z');
    moveReceivedAt(h, OLD, '2026-10-01T10:00:00.000Z');
    moveReceivedAt(h, INBOX, '2026-10-17T10:00:00.000Z');
    moveReceivedAt(h, KEPT, '2026-10-12T10:00:00.000Z');
    // The newest eligible one is the kept summary (the inbox one is newer, but not filed or kept).
    const first = await ask(deps, offerRequest());
    expect(offerOf(first).summaryId).toBe(KEPT);
    expect(first.text).toContain('The action items from a notetaker summary');
    // Everything of it decided: the next ask moves on to the filed one; the one older than 14 days never.
    const all = await ask(deps, replyRequest(offerOf(first), { kind: 'all' }));
    await ask(deps, replyRequest(offerOf(all), { kind: 'none' }));
    const second = await ask(deps, offerRequest());
    expect(offerOf(second).summaryId).toBe(SUMMARY_A);
    const secondAll = await ask(deps, replyRequest(offerOf(second), { kind: 'all' }));
    await ask(deps, replyRequest(offerOf(secondAll), { kind: 'none' }));
    const third = await ask(deps, offerRequest());
    expect(third.outcome).toBe('no_summary');
    expect(third.text).toContain('last 14 days');
    expect(parseExtraction(h.db.data(summaryDocPath(UID, OLD))?.extraction)).toBeNull();
  });

  it('answers at most 20 lists per summary and UTC day', async () => {
    const { h, deps } = setup();
    seedSummary(h.db, SUMMARY_A);
    for (let index = 0; index < 20; index += 1) expect((await ask(deps, offerRequest())).outcome).toBe('offered');
    const capped = await ask(deps, offerRequest());
    expect(capped.outcome).toBe('offer_cap');
    expect(capped.offer).toEqual({ action: 'keep' });
    expect(capped.buttons).toBeNull();
    expect((parseExtraction(h.db.data(summaryDocPath(UID, SUMMARY_A))?.extraction) as unknown as { offers: unknown }).offers).toEqual({ day: '2026-10-17', n: 20 });
    h.clock.now = new Date('2026-10-18T00:30:00.000Z');
    expect((await ask(deps, offerRequest())).outcome).toBe('offered');
  });

  it('a summary not sent to one of the user\'s mailboxes shows no marks, no ALL and no buttons', async () => {
    const { h, deps } = setup();
    seedSummary(h.db, SUMMARY_A, { trust: { recipientBound: false } });
    const response = await ask(deps, offerRequest());
    const offer = offerOf(response);
    expect(offer.marked).toEqual([]);
    expect(response.buttons).toBeNull();
    expect(response.text).toContain('This summary was not sent to one of your mailboxes, so nothing is marked.');
    expect(response.text).not.toContain('[x]');
    expect(response.text).not.toContain('[ ]');
    expect(response.text).not.toContain('Reply ALL');
    const all = await ask(deps, replyRequest(offer, { kind: 'all' }));
    expect(all.outcome).toBe('nothing_marked');
    expect(tasksOf(h)).toEqual([]);
  });

  it('speaks Spanish', async () => {
    const { h, deps } = setup();
    seedSummary(h.db, SUMMARY_A);
    const response = await ask(deps, offerRequest('es'));
    expect(response.text).toContain(`Las tareas de la minuta de tu asistente de notas sobre "${MEETING_TITLE}" (16 oct), tal como están escritas.`);
    expect(response.text).toContain('Responde TODOS para agregar');
    expect(response.text).toContain('Responde IA para que Meeting Guard AI lea toda la minuta');
  });
});

// ---------------------------------------------------------------------------------------------
// Replies
// ---------------------------------------------------------------------------------------------

describe('replies', () => {
  it('ALL adds the marked ones through decide (channel whatsapp, the defaults of 3.4); a repeat says already added', async () => {
    const { h, deps } = setup();
    seedSummary(h.db, SUMMARY_A);
    const offer = offerOf(await ask(deps, offerRequest()));
    const response = await ask(deps, replyRequest(offer, { kind: 'all' }));
    expect(response.outcome).toBe('decided');
    expect(response.text).toMatch(new RegExp(`^Added ${offer.marked.length} tasks: Bish: Provide APK access/files to Urpayroll; `));
    expect(response.text).toContain('Your phone sets their reminders the next time Meeting Guard AI syncs; open the app to be sure.');
    const tasks = tasksOf(h);
    expect(tasks).toHaveLength(offer.marked.length);
    expect(tasks.every((task) => task.source === 'ai_chat' && task.pushPending === true)).toBe(true);
    // The refreshed offer keeps its id and numbers; nothing marked is open any more.
    expect(response.offer.action).toBe('refresh');
    const refreshed = offerOf(response);
    expect(refreshed.offerId).toBe(offer.offerId);
    expect(refreshed.anchors).toEqual(offer.anchors);
    expect(refreshed.marked).toEqual([]);
    const items = (await view(h)).commitments?.items ?? [];
    expect(items.filter((item) => item.status === 'accepted').every((item) => item.via === 'whatsapp')).toBe(true);
    // The same reply again (a redelivery, a second tap): nothing new.
    const again = await ask(deps, replyRequest(offer, { kind: 'all' }));
    expect(again.text).toBe(`Already in your tasks: ${offer.marked.join(', ')}.`);
    expect(tasksOf(h)).toHaveLength(offer.marked.length);
  });

  it('numbers add only those, DROP removes, NONE drops every open line shown, unknown numbers are named', async () => {
    const { h, deps } = setup();
    seedSummary(h.db, SUMMARY_A);
    const offer = offerOf(await ask(deps, offerRequest()));
    const added = await ask(deps, replyRequest(offer, { kind: 'numbers', numbers: [1, 3, 99] }));
    expect(added.text).toContain('Added 2 tasks: Bish: Provide APK access/files to Urpayroll; Cristina Reyes Sierra: Confirm the launch date with the store team.');
    expect(added.text).toContain('Not in the list: 99.');
    const dropped = await ask(deps, replyRequest(offerOf(added), { kind: 'drop', numbers: [2, 1] }));
    expect(dropped.text).toContain('Removed from the list: 2. You can restore them in the app.');
    expect(dropped.text).toContain('Already in your tasks, so not removed: 1.');
    const none = await ask(deps, replyRequest(offerOf(dropped), { kind: 'none' }));
    const items = (await view(h)).commitments?.items ?? [];
    expect(items.filter((item) => item.status === 'open')).toEqual([]);
    expect(items.filter((item) => item.status === 'accepted').map((item) => item.number)).toEqual([1, 3]);
    expect(none.text).toMatch(/^Removed from the list: /);
    expect(offerOf(none).open).toEqual([]);
    const unknown = await ask(deps, replyRequest(offerOf(none), { kind: 'numbers', numbers: [77] }));
    expect(unknown.outcome).toBe('unknown_numbers');
    expect(tasksOf(h)).toHaveLength(2);
  });

  it('numbers are stable: "commitments", "1", "commitments" again, then "2" adds the item that was 2 in the first list', async () => {
    const { h, deps } = setup();
    seedSummary(h.db, SUMMARY_A);
    const first = await ask(deps, offerRequest());
    const before = (await view(h)).commitments?.items ?? [];
    const second = before.find((item) => item.number === 2);
    await ask(deps, replyRequest(offerOf(first), { kind: 'numbers', numbers: [1] }));
    const again = await ask(deps, offerRequest());
    expect(again.text).toContain('1. (added) Bish: Provide APK access/files to Urpayroll');
    expect(again.text).toContain(`2. [x] ${second?.title ?? 'missing'}`);
    const reply = await ask(deps, replyRequest(offerOf(again), { kind: 'numbers', numbers: [2] }));
    expect(reply.text).toContain(`Added 1 task: ${second?.title ?? 'missing'}.`);
    const after = (await view(h)).commitments?.items ?? [];
    expect(after.find((item) => item.number === 2)?.status).toBe('accepted');
    expect(after.find((item) => item.number === 2)?.anchorId).toBe(second?.anchorId);
  });

  it('ALL never adds a line whose owner only matched the user\'s first name; the line names the person, and a number still adds it (review S1)', async () => {
    const { h, deps } = setup();
    const recap = ['Ops sync', 'Meeting notes 2026-10-16', '', 'Action items', '[ ] Send the invoice to Acme (owner: Dana)', '[ ] Prepare the board slides (owner: Lee)'].join('\n');
    seedSummary(h.db, SUMMARY_A, { text: recap });
    const offered = await ask(deps, offerRequest());
    const offer = offerOf(offered);
    expect(offered.text).toContain('1. [ ] Send the invoice to Acme (you? the summary says: Dana)');
    expect(offered.text).toContain('2. [x] Lee: Prepare the board slides');
    expect(offer.marked).toEqual([2]);
    // In the app the same line is pre-selected with its "You?" chip.
    const app = (await view(h)).commitments?.items ?? [];
    expect(app[0]).toMatchObject({ preselected: true, owner: { name: 'Dana', isUser: true, guess: true } });
    const all = await ask(deps, replyRequest(offer, { kind: 'all' }));
    expect(all.text).toMatch(/^Added 1 task: Lee: Prepare the board slides\./);
    expect(tasksOf(h).map((task) => task.title)).toEqual(['Lee: Prepare the board slides']);
    const picked = await ask(deps, replyRequest(offerOf(all), { kind: 'numbers', numbers: [1] }));
    expect(picked.text).toMatch(/^Added 1 task: Send the invoice to Acme\./);
    expect(tasksOf(h)).toHaveLength(2);
  });

  it('refuses an expired offer, an offer made for another uid and an old key, and clears them', async () => {
    const { h, deps } = setup();
    seedSummary(h.db, SUMMARY_A);
    const offer = offerOf(await ask(deps, offerRequest()));
    const expired = await ask(deps, replyRequest({ ...offer, expiresAt: '2026-10-17T14:59:00.000Z' }, { kind: 'all' }));
    expect([expired.outcome, expired.offer]).toEqual(['expired', { action: 'clear' }]);
    const other = await ask(deps, replyRequest({ ...offer, uidTag: uidTagOf(OTHER_UID) }, { kind: 'all' }));
    expect([other.outcome, other.offer]).toEqual(['wrong_account', { action: 'clear' }]);
    const old = await ask(deps, replyRequest({ ...offer, key: `x_${'0'.repeat(16)}` }, { kind: 'all' }));
    expect([old.outcome, old.offer]).toEqual(['stale', { action: 'clear' }]);
    expect(tasksOf(h)).toEqual([]);
  });

  it('a summary deleted after the offer answers not found and clears the offer', async () => {
    const { h, deps } = setup();
    seedSummary(h.db, SUMMARY_A);
    const offer = offerOf(await ask(deps, offerRequest()));
    h.db.docs.delete(summaryDocPath(UID, SUMMARY_A));
    const response = await ask(deps, replyRequest(offer, { kind: 'numbers', numbers: [1] }));
    expect([response.outcome, response.offer]).toEqual(['not_found', { action: 'clear' }]);
    expect(h.db.has(summaryDocPath(UID, SUMMARY_A))).toBe(false);
    expect(tasksOf(h)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// AI only after the reply AI
// ---------------------------------------------------------------------------------------------

describe('the reply AI', () => {
  const steps = [
    toolResult([
      proposal(specimenId('Provide APK'), { title: 'Provide APK access/files to Urpayroll', owner: 'Bish', confidence: 92 }),
      proposal(specimenId('Review the pricing page'), { title: 'Review the pricing page', confidence: 70 }),
    ]),
  ];

  it('prepares with the model only after AI, charges once, and the new numbers replace the old ones', async () => {
    const { h, deps } = setup({ steps });
    seedSummary(h.db, SUMMARY_A);
    const first = await ask(deps, offerRequest());
    expect(h.llmFactory).not.toHaveBeenCalled();
    const ai = await ask(deps, replyRequest(offerOf(first), { kind: 'ai' }));
    expect(ai.outcome).toBe('offered');
    expect(h.llm.requests).toHaveLength(1);
    const charges = h.quota.transactions;
    expect(charges).toBe(1);
    const aiOffer = offerOf(ai);
    expect(aiOffer.offerId).not.toBe(offerOf(first).offerId);
    expect(aiOffer.ai).toBe('none');
    expect(aiOffer.key).not.toBe(offerOf(first).key);
    expect(ai.text).toContain('Suggested tasks from your notetaker\'s summary of');
    // Document order: the Decisions line comes first, unticked, with its section named.
    expect(ai.text).toContain('1. [ ] Review the pricing page (from Decisions)');
    expect(ai.text).toContain('2. [x] Bish: Provide APK access/files to Urpayroll');
    // AI again from the old offer: the kept AI list, no model call, no charge.
    const again = await ask(deps, replyRequest(offerOf(first), { kind: 'ai' }));
    expect(again.outcome).toBe('offered');
    expect(h.llm.requests).toHaveLength(1);
    expect(h.quota.transactions).toBe(charges);
    // An AI list offers no AI.
    const refused = await ask(deps, replyRequest(aiOffer, { kind: 'ai' }));
    expect(refused.outcome).toBe('ai_unavailable');
    expect(h.llm.requests).toHaveLength(1);
  });

  it('over the allowance answers the allowance wording and keeps the offer of the items as written', async () => {
    const { h, deps } = setup({ steps });
    seedSummary(h.db, SUMMARY_A);
    h.quota.roots.set(UID, { introStartedAt: '2026-10-01T00:00:00.000Z', introUsed: 10 });
    const offer = offerOf(await ask(deps, offerRequest()));
    const response = await ask(deps, replyRequest(offer, { kind: 'ai' }));
    expect(response.outcome).toBe('quota_exceeded');
    expect(response.offer).toEqual({ action: 'keep' });
    expect(response.text).toBe(
      'Your free AI actions are used. A subscription unlocks AI; the action items as written stay free. You can still reply with numbers from the list above.',
    );
    expect(h.llmFactory).not.toHaveBeenCalled();
  });

  it('an AI answer with nothing usable keeps the items as written pickable, and the offer takes no AI any more', async () => {
    const { h, deps } = setup({ steps: [toolResult([])] });
    seedSummary(h.db, SUMMARY_A);
    const offer = offerOf(await ask(deps, offerRequest()));
    const response = await ask(deps, replyRequest(offer, { kind: 'ai' }));
    expect([response.outcome, response.offer]).toEqual(['ai_empty', { action: 'refresh', offer: { ...offer, ai: 'none' } }]);
    const added = await ask(deps, replyRequest(offerOf(response), { kind: 'numbers', numbers: [1] }));
    expect(added.text).toMatch(/^Added 1 task: /);
  });

  it('after an empty AI answer and an expired offer, "commitments" offers the items as written again (review P1)', async () => {
    const { h, deps } = setup({ steps: [toolResult([])] });
    seedSummary(h.db, SUMMARY_A);
    const first = offerOf(await ask(deps, offerRequest()));
    expect((await ask(deps, replyRequest(first, { kind: 'ai' }))).outcome).toBe('ai_empty');
    expect(h.llm.requests).toHaveLength(1);
    // The items as written are in use again; the empty AI list is kept beside them.
    const stored = parseExtraction(h.db.data(summaryDocPath(UID, SUMMARY_A))?.extraction);
    expect([stored?.mode, stored?.views.ai?.state, stored?.views.as_written?.state]).toEqual(['as_written', 'empty', 'ready']);
    h.clock.now = new Date(NOW.getTime() + 16 * 60_000);
    const again = await ask(deps, offerRequest());
    expect(again.outcome).toBe('offered');
    const offer = offerOf(again);
    expect([offer.summaryId, offer.key, offer.ai]).toEqual([SUMMARY_A, first.key, 'none']);
    expect(again.text).toContain('exactly as written');
    expect(again.text).not.toContain('Reply AI');
    expect(h.llm.requests).toHaveLength(1);
  });

  it('an empty AI list the app prepared is never offered as "already suggested"; the items as written are offered instead (review P1)', async () => {
    // The app prepared AI (nothing found) and then switched to the items as written.
    const switched = setup({ steps: [toolResult([])] });
    seedSummary(switched.h.db, SUMMARY_A);
    await handleSummaryCommitments(verifiedAuth(), { op: 'prepare', summaryId: SUMMARY_A, mode: 'ai' }, switched.h.deps);
    await handleSummaryCommitments(verifiedAuth(), { op: 'prepare', summaryId: SUMMARY_A, mode: 'as_written' }, switched.h.deps);
    const offered = await ask(switched.deps, offerRequest());
    expect(offered.outcome).toBe('offered');
    expect(offerOf(offered).ai).toBe('none');
    expect(offered.text).not.toContain('Reply AI');
    // The app prepared AI only (nothing found): the items as written are prepared now, free.
    const aiOnly = setup({ steps: [toolResult([])] });
    seedSummary(aiOnly.h.db, SUMMARY_A);
    await handleSummaryCommitments(verifiedAuth(), { op: 'prepare', summaryId: SUMMARY_A, mode: 'ai' }, aiOnly.h.deps);
    const charges = aiOnly.h.quota.transactions;
    const fromEmpty = await ask(aiOnly.deps, offerRequest());
    expect(fromEmpty.outcome).toBe('offered');
    expect([offerOf(fromEmpty).ai, (await view(aiOnly.h)).commitments?.mode]).toEqual(['none', 'as_written']);
    expect(fromEmpty.text).toContain('1. [x] Bish: Provide APK access/files to Urpayroll');
    expect(aiOnly.h.llm.requests).toHaveLength(1);
    expect(aiOnly.h.quota.transactions).toBe(charges);
  });
});

// ---------------------------------------------------------------------------------------------
// Logs
// ---------------------------------------------------------------------------------------------

describe('logs', () => {
  it('one summaries.whatsapp line per call, with no title, quote, name, phone number, summary id or anchor id', async () => {
    const { h, deps } = setup({ steps: [toolResult([proposal(specimenId('Provide APK'), { title: 'Provide APK access/files to Urpayroll', owner: 'Bish' })])] });
    seedSummary(h.db, SUMMARY_A);
    seedSummary(h.db, SUMMARY_B, { status: 'kept' });
    const offer = offerOf(await ask(deps, offerRequest()));
    await ask(deps, replyRequest(offer, { kind: 'numbers', numbers: [1, 2] }));
    await ask(deps, replyRequest(offer, { kind: 'ai' }));
    await ask(deps, replyRequest(offer, { kind: 'drop', numbers: [3] }));
    const lines = h.log.entries.filter((entry) => entry.event === 'summaries.whatsapp');
    expect(lines.map((entry) => entry.fields.op)).toEqual(['offer', 'reply', 'reply', 'reply']);
    expect(lines.every((entry) => entry.fields.uid === UID && typeof entry.fields.outcome === 'string')).toBe(true);
    const text = h.log.text();
    for (const secret of ['Provide APK', 'Bish', 'Cristina', 'Urpayroll', MEETING_TITLE, PHONE, SUMMARY_A, SUMMARY_B, offer.anchors[0]?.a ?? 'none']) {
      expect(text).not.toContain(secret);
    }
  });
});

/**
 * A4: security, limits and metering (docs/v2/A4-THREAT-MODEL.md): the day's spending cap, the
 * monthly allowance, the running-matters limit, retention and matterDelete, the runtime switch,
 * the admin views and the wider content guard. On the in-memory fakes, like the A2 and A3 tests.
 */
import { handleMatterUsage } from '../../src/matters/allowance';
import { handleMatterAsk, handleMatterSpeak } from '../../src/matters/ask';
import { FALLBACK_PRICES, capPrices, modelCostMicros, speechCostMicros, speechSeconds } from '../../src/matters/cost';
import { guardReply } from '../../src/matters/guard';
import { handleInboundEmail, handleMatterCancel, handleMatterConfirm, handleMatterDraft, limitError, matterError, type MatterDeps } from '../../src/matters/handlers';
import { MATTER_LIMITS, type EmailAuth } from '../../src/matters/model';
import { handleInboundRead, handleMatterDecide, runMatterTick } from '../../src/matters/replies';
import { handleMatterDelete, purgeDue } from '../../src/matters/retention';
import { overLimit } from '../../src/matters/store';
import { adminCallerOf, createRuntimeSwitch, handleMatterAdminSwitch, handleMatterAdminUsage, switchStateOf, type AdminDeps } from '../../src/matters/switch';
import { handleMatterMessage } from '../../src/matters/write';
import { MATTER_ALLOWANCES, matterErrorDetailsSchema } from '../../src/shared/aiContract';
import { CALLER, DOMAIN, NOW, REQUEST, inboundPayload, makeDeps, proposal } from './mattersFakes';

jest.mock('firebase-functions/logger', () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const DAY = 24 * 3_600_000;
const ZONE = 'Europe/Madrid';
const TRUSTED: EmailAuth = { verdict: 'trusted', fromAligned: true, spf: 'pass', arcTrusted: false, reason: null };
const DAY_KEY = NOW.toISOString().slice(0, 10);
const MONTH = NOW.toISOString().slice(0, 7);
/** One fake model call (100 in, 20 out) at the fallback prices. */
const CALL_MICROS = 100 * FALLBACK_PRICES.inPerM + 20 * FALLBACK_PRICES.outPerM;
const METERED = { matters: 10, emails: 100, voiceMinutes: 30 };

function setup(overrides: Partial<MatterDeps> = {}) {
  const clock = { now: NOW };
  let seq = 0;
  const ctx = makeDeps({ now: () => clock.now, random: () => `r${++seq}`, ...overrides });
  return { ...ctx, clock };
}
type Ctx = ReturnType<typeof setup>;

async function draft(ctx: Ctx, proposalOverrides: Record<string, unknown> = {}) {
  ctx.llm.queue.push(proposal({ ends_at: '2026-11-30T18:00', ...proposalOverrides }));
  return handleMatterDraft(CALLER, { text: REQUEST, source: 'text', language: 'en', timeZone: ZONE }, ctx.deps);
}

async function active(ctx: Ctx, proposalOverrides: Record<string, unknown> = {}) {
  const d = await draft(ctx, proposalOverrides);
  await handleMatterConfirm(CALLER, { matterId: d.matterId, draftHash: d.draftHash }, ctx.deps);
  return d.matterId;
}

let providerSeq = 0;
async function reply(ctx: Ctx, overrides: Record<string, unknown> = {}) {
  providerSeq += 1;
  await handleInboundEmail(inboundPayload({ MessageID: `a4-${providerSeq}`, ...overrides }), {
    store: ctx.store,
    now: ctx.deps.now,
    domain: DOMAIN,
    markerTtlDays: 7,
    checkSender: async () => TRUSTED,
  });
  return ctx.store.lastAddedId!;
}

const assess = { intent: 'answer_within_mandate', reason: 'none', quote: 'Here it is.', reply: 'Hello Carlos,\n\nThank you, I have received it.\n\nBest,', commitments: [] };

describe('the day\u2019s spending cap', () => {
  it('prices model calls (configured prices, else the high fallback) and the natural voice', () => {
    expect(capPrices(undefined)).toEqual(FALLBACK_PRICES);
    expect(capPrices({ inPerM: 0, outPerM: 2 })).toEqual(FALLBACK_PRICES);
    expect(capPrices({ inPerM: 0.5, outPerM: 2 })).toEqual({ inPerM: 0.5, outPerM: 2 });
    expect(modelCostMicros({ promptTokens: 1000, completionTokens: 100 }, { inPerM: 0.5, outPerM: 2 })).toBe(700);
    expect(modelCostMicros(null, undefined)).toBe(0);
    // 900 characters are about a minute of speech at USD 0.015
    expect(speechCostMicros(900)).toBe(15_000);
    expect(speechSeconds(900)).toBe(60);
    expect(speechSeconds(3)).toBe(1);
  });

  it('every model call adds its cost to the user\u2019s day; at the cap a draft is refused with limit spend', async () => {
    const ctx = setup({ spendCapCents: 1 });
    await draft(ctx);
    expect(await ctx.store.getSpend('u1', DAY_KEY)).toBe(CALL_MICROS);
    expect(ctx.store.spend.get(`${DAY_KEY}_u1`)).toMatchObject({ modelCalls: 1, inputTokens: 100, outputTokens: 20 });
    // 1 cent = 10,000 micro-dollars
    await ctx.store.addSpend('u1', DAY_KEY, { micros: 10_000 });
    const before = ctx.llm.requests.length;
    await expect(draft(ctx)).rejects.toMatchObject({ code: 'resource-exhausted', details: { reason: 'rate_limited', limit: 'spend' } });
    expect(ctx.llm.requests).toHaveLength(before);
    // another user is not affected, and the next day starts again
    ctx.clock.now = new Date(NOW.getTime() + DAY);
    await expect(draft(ctx)).resolves.toMatchObject({ status: 'draft' });
  });

  it('at the cap matterMessage says limit spend and matterAsk answers from code; no model call', async () => {
    const ctx = setup({ spendCapCents: 1 });
    const matterId = await active(ctx);
    await ctx.store.addSpend('u1', DAY_KEY, { micros: 10_000 });
    const before = ctx.llm.requests.length;
    // one open matter: its status is still answered, from the matter's own records
    await expect(handleMatterAsk(CALLER, { text: 'What is new?', language: 'en' }, ctx.deps)).resolves.toMatchObject({ intent: 'status', matterId });
    await expect(handleMatterMessage(CALLER, { matterId, text: 'Say hello' }, ctx.deps)).rejects.toMatchObject({ details: { limit: 'spend' } });
    expect(ctx.llm.requests).toHaveLength(before);

    // two open matters and no model: nothing to answer from, so the limit is named
    const two = setup({ spendCapCents: 1 });
    await active(two);
    await active(two);
    await two.store.addSpend('u1', DAY_KEY, { micros: 10_000 });
    const asked = two.llm.requests.length;
    await expect(handleMatterAsk(CALLER, { text: 'What is new?', language: 'en' }, two.deps)).rejects.toMatchObject({ details: { limit: 'spend' } });
    expect(two.llm.requests).toHaveLength(asked);
  });

  it('a reply that arrives at the cap is kept unread with one cap card, and no model call', async () => {
    const ctx = setup({ spendCapCents: 1 });
    const matterId = await active(ctx);
    await ctx.store.addSpend('u1', DAY_KEY, { micros: 10_000 });
    const messageId = await reply(ctx);
    const before = ctx.llm.requests.length;
    await expect(handleInboundRead({ uid: 'u1', matterId, messageId }, ctx.deps)).resolves.toBe('capped');
    expect(ctx.llm.requests).toHaveLength(before);
    expect(ctx.store.cardList('u1', matterId)).toEqual([expect.objectContaining({ kind: 'many_replies', reason: 'cap_reached', status: 'pending' })]);
  });

  it('without a cap (absent) nothing is refused', async () => {
    const ctx = setup();
    await ctx.store.addSpend('u1', DAY_KEY, { micros: 10_000_000 });
    await expect(draft(ctx)).resolves.toMatchObject({ status: 'draft' });
  });
});

describe('the monthly allowance', () => {
  it('the first confirm counts one matter and its first email; a retry counts nothing more', async () => {
    const ctx = setup({ monthly: METERED });
    const d = await draft(ctx);
    await handleMatterConfirm(CALLER, { matterId: d.matterId, draftHash: d.draftHash }, ctx.deps);
    await handleMatterConfirm(CALLER, { matterId: d.matterId, draftHash: d.draftHash }, ctx.deps);
    expect(await ctx.store.getMonthly('u1', MONTH)).toEqual({ matters: 1, emails: 1, voiceSeconds: 0 });
  });

  it('a confirm past the month\u2019s matters or emails is refused and nothing is sent', async () => {
    const ctx = setup({ monthly: { matters: 1, emails: 100, voiceMinutes: 30 } });
    await active(ctx);
    const second = await draft(ctx);
    await expect(handleMatterConfirm(CALLER, { matterId: second.matterId, draftHash: second.draftHash }, ctx.deps)).rejects.toMatchObject({ details: { reason: 'rate_limited', limit: 'matters' } });
    expect(ctx.sender.sent).toHaveLength(1);
    expect((await ctx.store.getMatter('u1', second.matterId))!.status).toBe('draft');

    const mailCtx = setup({ monthly: { matters: 10, emails: 0, voiceMinutes: 30 } });
    const third = await draft(mailCtx);
    await expect(handleMatterConfirm(CALLER, { matterId: third.matterId, draftHash: third.draftHash }, mailCtx.deps)).rejects.toMatchObject({ details: { limit: 'emails' } });
  });

  it('an approved reply counts on the month\u2019s emails; past them the send is released with limit emails', async () => {
    const ctx = setup({ monthly: { matters: 10, emails: 2, voiceMinutes: 30 } });
    const matterId = await active(ctx);
    ctx.llm.queue.push(assess);
    await handleInboundRead({ uid: 'u1', matterId, messageId: await reply(ctx) }, ctx.deps);
    const card = ctx.store.cardList('u1', matterId).find((c) => c.kind === 'reply_draft')!;
    await expect(handleMatterDecide(CALLER, { matterId, target: 'approval', id: card.id, action: 'approve', draftHash: card.draftHash }, ctx.deps)).resolves.toMatchObject({ outcome: 'sent' });
    expect((await ctx.store.getMonthly('u1', MONTH)).emails).toBe(2);

    ctx.llm.queue.push(assess);
    await handleInboundRead({ uid: 'u1', matterId, messageId: await reply(ctx) }, ctx.deps);
    const next = ctx.store.cardList('u1', matterId).find((c) => c.kind === 'reply_draft' && c.status === 'pending')!;
    await expect(handleMatterDecide(CALLER, { matterId, target: 'approval', id: next.id, action: 'approve', draftHash: next.draftHash }, ctx.deps)).rejects.toMatchObject({ details: { limit: 'emails' } });
    expect(ctx.sender.sent).toHaveLength(2);
    expect(ctx.store.cardList('u1', matterId).find((c) => c.id === next.id)).toMatchObject({ sendState: 'failed' });
  });

  it('the natural voice counts seconds; past the month\u2019s minutes it is refused with limit voice', async () => {
    const speech = jest.fn(async () => Buffer.from('mp3'));
    const ctx = setup({ monthly: { matters: 10, emails: 100, voiceMinutes: 1 }, naturalVoice: true, speech, spendCapCents: 100 });
    const text = 'x'.repeat(900);
    await expect(handleMatterSpeak(CALLER, { text, language: 'en' }, ctx.deps)).resolves.toMatchObject({ chars: 900 });
    expect((await ctx.store.getMonthly('u1', MONTH)).voiceSeconds).toBe(60);
    expect(await ctx.store.getSpend('u1', DAY_KEY)).toBe(15_000);
    await expect(handleMatterSpeak(CALLER, { text: 'Hello', language: 'en' }, ctx.deps)).rejects.toMatchObject({ details: { limit: 'voice' } });
    expect(speech).toHaveBeenCalledTimes(1);
  });

  it('overLimit names the first field that would go over; a limit left out is not checked', () => {
    expect(overLimit({ matters: 9, emails: 0, voiceSeconds: 0 }, { matters: 1 }, { matters: 10 })).toBeNull();
    expect(overLimit({ matters: 10, emails: 0, voiceSeconds: 0 }, { matters: 1, emails: 1 }, { matters: 10, emails: 5 })).toBe('matters');
    expect(overLimit({ matters: 10, emails: 99, voiceSeconds: 0 }, { emails: 1 }, {})).toBeNull();
  });

  it('matterUsage answers the meter: the month, its limits and today', async () => {
    const ctx = setup({ monthly: METERED, dailySendLimit: 30, spendCapCents: 100 });
    await active(ctx);
    await expect(handleMatterUsage(CALLER, {}, ctx.deps)).resolves.toEqual({
      month: MONTH,
      resetsAt: '2026-12-01T00:00:00.000Z',
      matters: { used: 1, limit: 10 },
      emails: { used: 1, limit: 100 },
      voiceMinutes: { used: 0, limit: 30 },
      today: { drafts: { used: 1, limit: 30 }, sends: { used: 0, limit: 30 }, capReached: false },
    });
    expect(MATTER_ALLOWANCES).toEqual({ mattersPerMonth: 10, emailsPerMonth: 100, voiceMinutesPerMonth: 30 });
  });
});

describe('hard limits', () => {
  it('no new draft or confirm past MATTER_LIMITS.maxOpenMatters running matters', async () => {
    const ctx = setup();
    const d = await draft(ctx);
    for (let n = 0; n < MATTER_LIMITS.maxOpenMatters; n += 1) {
      await ctx.store.createMatter('u1', `open${n}`, { ...(await ctx.store.getMatter('u1', d.matterId))!, status: n % 2 ? 'paused' : 'active' }, { type: 'created', at: NOW.toISOString(), messageId: null, detail: '' });
    }
    await expect(draft(ctx)).rejects.toMatchObject({ details: { reason: 'rate_limited', limit: 'open_matters' } });
    await expect(handleMatterConfirm(CALLER, { matterId: d.matterId, draftHash: d.draftHash }, ctx.deps)).rejects.toMatchObject({ details: { limit: 'open_matters' } });
  });

  it('every rate_limited error names its limit; the daily drafts cap is drafts', () => {
    expect(matterError('rate_limited').details).toEqual({ reason: 'rate_limited', limit: 'drafts' });
    expect(matterError('not_found').details).toEqual({ reason: 'not_found' });
    expect(limitError('sends')).toMatchObject({ code: 'resource-exhausted', details: { reason: 'rate_limited', limit: 'sends' } });
    expect(matterErrorDetailsSchema.parse({ reason: 'rate_limited', limit: 'voice' })).toEqual({ reason: 'rate_limited', limit: 'voice' });
  });
});

describe('retention and matterDelete', () => {
  it('a closed matter keeps its emails MATTERS_RETENTION_DAYS, then loses the texts and keeps its timeline', async () => {
    const ctx = setup({ retentionDays: 90 });
    const matterId = await active(ctx);
    ctx.llm.queue.push(assess);
    await handleInboundRead({ uid: 'u1', matterId, messageId: await reply(ctx) }, ctx.deps);
    await handleMatterCancel(CALLER, { matterId }, ctx.deps);
    expect(ctx.store.retention.get(matterId)).toEqual({ uid: 'u1', matterId, endedAt: NOW.toISOString() });

    ctx.clock.now = new Date(NOW.getTime() + 89 * DAY);
    await expect(purgeDue(ctx.deps, 20)).resolves.toBe(0);
    expect(ctx.store.messageList('u1', matterId).length).toBeGreaterThan(0);

    ctx.clock.now = new Date(NOW.getTime() + 91 * DAY);
    await expect(purgeDue(ctx.deps, 20)).resolves.toBe(1);
    const after = (await ctx.store.getMatter('u1', matterId))!;
    expect(after).toMatchObject({ status: 'cancelled', firstEmail: null, purgedAt: ctx.clock.now.toISOString() });
    expect(ctx.store.messageList('u1', matterId)).toEqual([]);
    expect(ctx.store.cardList('u1', matterId).every((c) => c.draft === null && c.quote === null && c.from === null)).toBe(true);
    expect([...ctx.store.messageIds.values()].some((l) => l.matterId === matterId)).toBe(false);
    expect(ctx.store.eventTypes('u1', matterId)).toEqual(expect.arrayContaining(['email_sent', 'status_changed', 'emails_deleted']));
    expect(ctx.store.retention.has(matterId)).toBe(false);
  });

  it('a matter that ends by the tick or a goal gets its retention entry too; matterTick purges, even switched off', async () => {
    const ctx = setup({ retentionDays: 1 });
    const matterId = await active(ctx, { ends_at: '2026-11-12T12:00' });
    ctx.clock.now = new Date(NOW.getTime() + 6 * 3_600_000);
    await runMatterTick(ctx.deps);
    expect((await ctx.store.getMatter('u1', matterId))!.status).toBe('done');
    expect(ctx.store.retention.has(matterId)).toBe(true);
    ctx.clock.now = new Date(NOW.getTime() + 3 * DAY);
    await expect(runMatterTick({ ...ctx.deps, enabled: false })).resolves.toMatchObject({ purged: 1 });
  });

  it('matterDelete stops a running matter and removes it with its lookups; nothing more goes out', async () => {
    const ctx = setup();
    const matterId = await active(ctx);
    const token = (await ctx.store.getMatter('u1', matterId))!.replyToken;
    // works switched off and off the tester list: the owner can always remove their own data
    await expect(handleMatterDelete(CALLER, { matterId }, { ...ctx.deps, enabled: false, allowed: () => false })).resolves.toEqual({ matterId, deleted: true });
    expect(await ctx.store.getMatter('u1', matterId)).toBeNull();
    expect(ctx.store.addresses.has(token)).toBe(false);
    expect(ctx.store.schedules.has(matterId)).toBe(false);
    expect(ctx.store.retention.has(matterId)).toBe(false);
    expect([...ctx.store.messageIds.values()].some((l) => l.matterId === matterId)).toBe(false);
    await expect(handleMatterDelete(CALLER, { matterId }, ctx.deps)).rejects.toMatchObject({ details: { reason: 'not_found' } });
    await expect(handleMatterDelete(null, { matterId }, ctx.deps)).rejects.toMatchObject({ details: { reason: 'unauthenticated' } });
    await expect(handleMatterDelete(CALLER, { matterId: 'bad id!' }, ctx.deps)).rejects.toMatchObject({ details: { reason: 'invalid_request' } });
  });
});

describe('the runtime switch', () => {
  it('only enabled === false turns it off; a missing document is on', () => {
    expect(switchStateOf(null)).toEqual({ enabled: true, updatedAt: null, updatedBy: null });
    expect(switchStateOf({ enabled: false, updatedAt: '2026-11-23T10:00:00.000Z', updatedBy: 'admin1' })).toEqual({ enabled: false, updatedAt: '2026-11-23T10:00:00.000Z', updatedBy: 'admin1' });
    expect(switchStateOf({ enabled: 'no' }).enabled).toBe(true);
  });

  it('reads at most once per cache period; a failed read keeps the last known value', async () => {
    let t = 0;
    const read = jest.fn<Promise<unknown>, []>().mockResolvedValueOnce({ enabled: false }).mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce({ enabled: true });
    const sw = createRuntimeSwitch(read, 30_000, () => t);
    await expect(sw.isOn()).resolves.toBe(false);
    t = 10_000;
    await expect(sw.isOn()).resolves.toBe(false);
    expect(read).toHaveBeenCalledTimes(1);
    t = 40_000;
    await expect(sw.isOn()).resolves.toBe(false);
    sw.clear();
    await expect(sw.isOn()).resolves.toBe(true);
    expect(read).toHaveBeenCalledTimes(3);
  });

  it('switched off: callables answer not_configured, a reply waits unread in the queue, the tick sends nothing', async () => {
    const ctx = setup();
    const matterId = await active(ctx, { follow_up: { every_days: 1, max_count: 3 } });
    const off = { ...ctx.deps, enabled: false };
    await expect(handleMatterAsk(CALLER, { text: 'What is new?', language: 'en' }, off)).rejects.toMatchObject({ details: { reason: 'not_configured' } });
    const messageId = await reply(ctx);
    const before = ctx.llm.requests.length;
    await expect(handleInboundRead({ uid: 'u1', matterId, messageId }, off)).resolves.toBe('deferred');
    expect(ctx.llm.requests).toHaveLength(before);
    expect(ctx.store.readQueue.get(`${matterId}_${messageId}`)).toMatchObject({ attempts: 0 });
    // a follow-up is due, but nothing goes out while off
    ctx.clock.now = new Date(NOW.getTime() + 2 * DAY);
    await expect(runMatterTick(off)).resolves.toMatchObject({ schedules: 0, reads: 0, followUps: 0 });
    expect(ctx.sender.sent).toHaveLength(1);
    // on again: the tick reads the waiting reply
    ctx.llm.queue.push(assess);
    await expect(runMatterTick(ctx.deps)).resolves.toMatchObject({ reads: 1 });
  });
});

describe('the admin views', () => {
  function admin(spend: unknown[] = [], initial: unknown = null) {
    let stored: unknown = initial;
    const deps: AdminDeps = {
      readSwitch: async () => stored,
      writeSwitch: async (state) => {
        stored = state;
      },
      listSpend: async () => spend,
      now: () => NOW,
    };
    return deps;
  }
  const ADMIN = { uid: 'admin1', isAdmin: true, isViewer: true };
  const VIEWER = { uid: 'viewer1', isAdmin: false, isViewer: true };

  it('the claims: admin writes, viewer reads, others are refused', async () => {
    expect(adminCallerOf({ uid: 'a', token: { admin: true } })).toEqual({ uid: 'a', isAdmin: true, isViewer: true });
    expect(adminCallerOf({ uid: 'v', token: { adminRole: 'viewer' } })).toEqual({ uid: 'v', isAdmin: false, isViewer: true });
    expect(adminCallerOf(undefined)).toBeNull();
    const deps = admin();
    await expect(handleMatterAdminSwitch(null, {}, deps)).rejects.toMatchObject({ code: 'unauthenticated' });
    await expect(handleMatterAdminSwitch({ uid: 'x', isAdmin: false, isViewer: false }, {}, deps)).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(handleMatterAdminSwitch(VIEWER, {}, deps)).resolves.toEqual({ enabled: true, updatedAt: null, updatedBy: null });
    await expect(handleMatterAdminSwitch(VIEWER, { enabled: false }, deps)).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(handleMatterAdminSwitch(ADMIN, { enabled: false }, deps)).resolves.toEqual({ enabled: false, updatedAt: NOW.toISOString(), updatedBy: 'admin1' });
    await expect(handleMatterAdminSwitch(VIEWER, {}, deps)).resolves.toMatchObject({ enabled: false });
    await expect(handleMatterAdminSwitch(ADMIN, { enabled: 'off' }, deps)).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('each user\u2019s cost over the last days, highest first, with today apart', async () => {
    const spend = [
      { uid: 'u1', day: DAY_KEY, micros: 250_000, modelCalls: 5, inputTokens: 1000, outputTokens: 200, speechChars: 0 },
      { uid: 'u1', day: '2026-11-10', micros: 750_000, modelCalls: 10, inputTokens: 3000, outputTokens: 600, speechChars: 900 },
      { uid: 'u2', day: DAY_KEY, micros: 2_000_000, modelCalls: 40 },
      { uid: 'u3', day: '2026-10-01', micros: 9_000_000 },
      { broken: true },
    ];
    await expect(handleMatterAdminUsage(VIEWER, { days: 7 }, admin(spend))).resolves.toEqual({
      fromDay: '2026-11-06',
      toDay: DAY_KEY,
      totalUsd: 3,
      users: [
        { uid: 'u2', costUsd: 2, todayUsd: 2, modelCalls: 40, inputTokens: 0, outputTokens: 0, speechChars: 0, activeDays: 1 },
        { uid: 'u1', costUsd: 1, todayUsd: 0.25, modelCalls: 15, inputTokens: 4000, outputTokens: 800, speechChars: 900, activeDays: 2 },
      ],
    });
    await expect(handleMatterAdminUsage(VIEWER, { days: 40 }, admin())).rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(handleMatterAdminUsage({ uid: 'x', isAdmin: false, isViewer: false }, {}, admin())).rejects.toMatchObject({ code: 'permission-denied' });
  });
});

describe('the content guard (A4 terms)', () => {
  const flags = (text: string) => guardReply({ text, allowedAddresses: [] });

  it('bank details, payment apps, crypto, quotations and taxes are money, in EN and ES', () => {
    for (const text of ['Please send your IBAN.', 'Pay me by PayPal.', 'Can you share the bank details?', 'We accept bitcoin.', 'Here is the quotation.', 'Plus VAT.']) {
      expect(flags(text)).toContain('money');
    }
    for (const text of ['Pásame tu cuenta bancaria.', 'Te mando la cotización.', 'Lo pagas por Bizum.', 'Más IVA.', 'El sueldo es bueno.']) {
      expect(flags(text)).toContain('money');
    }
  });

  it('e-signatures, liability, licences and purchase orders are contract, in EN and ES', () => {
    for (const text of ['Please DocuSign it.', 'We accept no liability.', 'The licence is attached.', 'Send the purchase order.', 'Firma el acuerdo de confidencialidad.', 'La orden de compra está lista.']) {
      expect(flags(text)).toContain('contract');
    }
  });

  it('promises made for the owner are flagged; everyday words are not', () => {
    for (const text of ['I promise it will be ready.', 'We guarantee delivery.', 'Rest assured, it is done.', 'Te prometo que llega mañana.', 'Nos comprometemos a enviarlo.', 'Lo envío sin falta.']) {
      expect(flags(text)).toContain('promise');
    }
    expect(flags('That time is fine, see you on Friday.')).toEqual([]);
    expect(flags('Perfecto, nos vemos el viernes.')).toEqual([]);
  });
});

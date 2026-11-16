/**
 * summaryCommitments get and prepare (functions/src/summaries/commitmentsHandler.ts;
 * docs/v2/M11-DESIGN.md sections 2.1 to 2.9, section 8 "Handler"). Firestore is the in-memory fake,
 * the quota is the assistant's fake store, the model is scripted. Every log line is captured and
 * scanned for content. All data is synthetic.
 */
jest.mock('firebase-functions/logger', () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

import { HttpsError } from 'firebase-functions/https';

import { UpstreamError } from '../../src/assistant/errors';
import { COMMITMENT_ERROR_HTTPS_CODES, commitmentErrorDetailsSchema, summaryCommitmentsResponseSchema, type CommitmentErrorCode } from '../../src/shared/aiContract';
import { SealedError } from '../../src/shared/sealed';
import { handleSummaryCommitments } from '../../src/summaries/commitmentsHandler';
import { parseExtraction, type StoredExtraction } from '../../src/summaries/commitmentsModel';
import { summaryDocPath } from '../../src/summaries/model';
import { SPECIMEN, proposal } from './commitmentsFixtures';
import {
  MEETING_ID,
  MEETING_TITLE,
  OTHER_UID,
  SUMMARY_A,
  SUMMARY_B,
  UID,
  autoMatch,
  harness,
  seedMeeting,
  seedSummary,
  specimenId,
  toolResult,
  verifiedAuth,
  type Harness,
} from './commitmentsHarness';

const DAY = '2026-10-17';
const PATH_A = summaryDocPath(UID, SUMMARY_A);

function call(h: Harness, data: unknown, auth = verifiedAuth()) {
  return handleSummaryCommitments(auth, data, h.deps);
}

async function reasonOf(promise: Promise<unknown>): Promise<{ reason: CommitmentErrorCode; code: string; details: unknown }> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(HttpsError);
    const details = commitmentErrorDetailsSchema.parse((error as HttpsError).details);
    expect((error as HttpsError).code).toBe(COMMITMENT_ERROR_HTTPS_CODES[details.reason]);
    return { reason: details.reason, code: (error as HttpsError).code, details };
  }
  throw new Error('expected a refusal');
}

function extractionOf(h: Harness, path: string = PATH_A): StoredExtraction {
  const parsed = parseExtraction(h.db.data(path)?.extraction);
  if (parsed === null) throw new Error('no extraction');
  return parsed;
}

/** The AI's proposals for the specimen: two action items and a decision line. */
function specimenProposals() {
  return [
    proposal(specimenId('Provide APK'), { title: 'Provide APK access/files to Urpayroll', owner: 'Bish', confidence: 92 }),
    proposal(specimenId('Confirm the launch date'), { title: 'Confirm the launch date with the store team', owner: 'Cristina Reyes Sierra', confidence: 88 }),
    proposal(specimenId('Review the pricing page'), { title: 'Review the pricing page', owner: null, confidence: 70 }),
  ];
}

const PREPARE_AI = { op: 'prepare', summaryId: SUMMARY_A, mode: 'ai' } as const;
const PREPARE_AS_WRITTEN = { op: 'prepare', summaryId: SUMMARY_A, mode: 'as_written' } as const;
const GET = { op: 'get', summaryId: SUMMARY_A } as const;

async function untilModelCalled(h: Harness, count = 1): Promise<void> {
  for (let spin = 0; spin < 500 && h.llm.requests.length < count; spin += 1) await new Promise((resolve) => setImmediate(resolve));
}

// ---------------------------------------------------------------------------------------------
// Gates
// ---------------------------------------------------------------------------------------------

describe('summaryCommitments gates', () => {
  it('refuses in order: signed out, unverified, switch off, not in the pilot, then the request', async () => {
    const h = harness();
    seedSummary(h.db, SUMMARY_A);
    expect((await reasonOf(call(h, GET, null))).reason).toBe('unauthenticated');
    expect((await reasonOf(call(h, GET, { uid: UID, token: { email_verified: false, firebase: { sign_in_provider: 'password' } } }))).reason).toBe('unauthenticated');
    const off = harness([], { enabled: false });
    expect((await reasonOf(call(off, { op: 'nonsense' }))).reason).toBe('not_enabled');
    const outside = harness([], { pilot: OTHER_UID });
    expect((await reasonOf(call(outside, { op: 'nonsense' }))).reason).toBe('not_allowed');
    expect((await reasonOf(call(h, { op: 'nonsense' }))).reason).toBe('invalid_request');
    expect((await reasonOf(call(h, { op: 'prepare', summaryId: SUMMARY_A, mode: 'magic' }))).reason).toBe('invalid_request');
    // A refused caller never reaches Firestore.
    expect(off.db.log).toEqual([]);
    expect(outside.db.log).toEqual([]);
  });

  it('answers not_found for an inbox summary, another user\'s summary and a missing one', async () => {
    const h = harness();
    seedSummary(h.db, SUMMARY_A, { status: 'inbox' });
    seedSummary(h.db, SUMMARY_B, { uid: OTHER_UID });
    expect((await reasonOf(call(h, GET))).reason).toBe('not_found');
    expect((await reasonOf(call(h, { ...GET, summaryId: SUMMARY_B }))).reason).toBe('not_found');
    expect((await reasonOf(call(h, PREPARE_AI))).reason).toBe('not_found');
    expect((await reasonOf(call(h, { ...PREPARE_AS_WRITTEN, summaryId: 'f'.repeat(64) }))).reason).toBe('not_found');
    expect(h.llm.requests).toHaveLength(0);
    expect(h.db.writeLog()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// get and prepare
// ---------------------------------------------------------------------------------------------

describe('get', () => {
  it('with nothing prepared answers none: no model call, no charge, no write', async () => {
    const h = harness();
    seedSummary(h.db, SUMMARY_A);
    const response = await call(h, GET);
    expect(response).toEqual({ op: 'get', state: 'none', commitments: null });
    expect(h.llmFactory).not.toHaveBeenCalled();
    expect(h.quota.transactions).toBe(0);
    expect(h.db.writeLog()).toEqual([]);
  });
});

describe('prepare in mode ai', () => {
  it('charges once on the first preparation; a second prepare is free and makes no model call', async () => {
    const h = harness([toolResult(specimenProposals())]);
    seedSummary(h.db, SUMMARY_A);
    const first = await call(h, PREPARE_AI);
    expect(summaryCommitmentsResponseSchema.parse(first)).toEqual(first);
    expect(first.state).toBe('ready');
    expect(first.usage).toMatchObject({ used: 1, plan: 'free' });
    // Document order: the Decisions line comes before the Action items.
    expect(first.commitments?.items.map((item) => item.title)).toEqual([
      'Review the pricing page',
      'Bish: Provide APK access/files to Urpayroll',
      'Cristina Reyes Sierra: Confirm the launch date with the store team',
    ]);
    // Pre-selection on a row 7 recap: the action items, never the decision line.
    expect(first.commitments?.items.map((item) => item.preselected)).toEqual([false, true, true]);
    expect(h.quota.count(UID, DAY)).toBe(1);
    expect(h.quota.root(UID).introUsed).toBe(1);

    const again = await call(h, PREPARE_AI);
    expect(again.state).toBe('ready');
    expect(again.usage).toBeUndefined();
    expect(h.llm.requests).toHaveLength(1);
    expect(h.quota.count(UID, DAY)).toBe(1);
    const got = await call(h, GET);
    expect(got.commitments?.key).toBe(first.commitments?.key);
    expect(h.llm.requests).toHaveLength(1);
  });

  it('asks the model with the one strict tool, toolChoice required, two messages and the safety identifier', async () => {
    const h = harness([toolResult(specimenProposals())]);
    seedSummary(h.db, SUMMARY_A);
    await call(h, PREPARE_AI);
    const request = h.llm.requests[0];
    expect(request?.toolChoice).toBe('required');
    expect(request?.tools.map((tool) => tool.function.name)).toEqual(['propose_commitments']);
    expect(request?.messages.map((message) => message.role)).toEqual(['developer', 'user']);
    expect(request?.messages[1]?.content.startsWith('<<<SUMMARY_DATA nonce=n0nce>>>')).toBe(true);
    expect(request?.safetyIdentifier).toMatch(/^[0-9a-f]{32}$/);
    // The TLDR (derived) is never sent; the developer message holds no summary text.
    expect(request?.messages[1]?.content).not.toContain('Bish ships everything by Friday');
    expect(request?.messages[0]?.content).not.toContain('Provide APK');
    expect(request?.messages[0]?.content).not.toContain(MEETING_TITLE);
  });

  it('quota_exceeded carries the usage, releases the lease, and the items as written still work', async () => {
    const h = harness([toolResult(specimenProposals())]);
    seedSummary(h.db, SUMMARY_A);
    h.quota.usage.set(`${UID}/${DAY}`, { count: 3, updatedAt: '2026-10-17T08:00:00.000Z' });
    const refused = await reasonOf(call(h, PREPARE_AI));
    expect(refused.reason).toBe('quota_exceeded');
    expect(refused.code).toBe('resource-exhausted');
    expect(refused.details).toMatchObject({ reason: 'quota_exceeded', usage: { used: 3, limit: 3, period: 'day' } });
    expect(h.llmFactory).not.toHaveBeenCalled();
    expect(extractionOf(h).lease).toBeNull();
    expect(extractionOf(h).charge).toBeNull();
    const asWritten = await call(h, PREPARE_AS_WRITTEN);
    expect(asWritten.state).toBe('ready');
    expect(asWritten.commitments?.mode).toBe('as_written');
    expect(asWritten.commitments?.items.length).toBeGreaterThanOrEqual(8);
    expect(h.quota.count(UID, DAY)).toBe(3);
  });

  it('two prepares at once make one model call; the second answers preparing', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const h = harness([
      async () => {
        await gate;
        return toolResult(specimenProposals());
      },
    ]);
    seedSummary(h.db, SUMMARY_A);
    const first = call(h, PREPARE_AI);
    await untilModelCalled(h);
    expect(await call(h, PREPARE_AI)).toEqual({ op: 'prepare', state: 'preparing', commitments: null });
    expect(await call(h, GET)).toEqual({ op: 'get', state: 'preparing', commitments: null });
    release();
    expect((await first).state).toBe('ready');
    expect(h.llm.requests).toHaveLength(1);
    expect(h.quota.count(UID, DAY)).toBe(1);
    expect(extractionOf(h).lease).toBeNull();
  });

  it('ai, then as written, then ai makes one model call in all, and the AI result is kept', async () => {
    const h = harness([toolResult(specimenProposals())]);
    seedSummary(h.db, SUMMARY_A);
    const ai = await call(h, PREPARE_AI);
    const asWritten = await call(h, PREPARE_AS_WRITTEN);
    expect(asWritten.commitments?.mode).toBe('as_written');
    expect(extractionOf(h).views.ai).not.toBeNull();
    const back = await call(h, PREPARE_AI);
    expect(back.commitments?.mode).toBe('ai');
    expect(back.commitments?.key).toBe(ai.commitments?.key);
    expect(h.llm.requests).toHaveLength(1);
    expect(h.quota.count(UID, DAY)).toBe(1);
  });

  it('a prepare after an upgrade in place is free; get says stale first, with no list when the text changed', async () => {
    const h = harness([toolResult(specimenProposals()), toolResult(specimenProposals())]);
    seedSummary(h.db, SUMMARY_A);
    const first = await call(h, PREPARE_AI);
    const provide = first.commitments?.items[1];
    const decided = await call(h, {
      op: 'decide',
      summaryId: SUMMARY_A,
      key: first.commitments?.key,
      timezone: 'America/Mexico_City',
      language: 'en',
      decisions: [
        { anchorId: provide?.anchorId, decision: 'accept', draft: { title: provide?.title, dueDate: null, dueTime: null, reminderMinutesBefore: null, owner: { name: 'Bish', isUser: false } } },
        { anchorId: first.commitments?.items[2]?.anchorId, decision: 'drop' },
      ],
    });
    const taskId = decided.results?.[0]?.taskId;
    // The vendor's better copy upgrades the summary in place: one more line, a new digest.
    const extraction = h.db.data(PATH_A)?.extraction;
    seedSummary(h.db, SUMMARY_A, { text: `${SPECIMEN}\n- One more note from the vendor copy.`, extraction });
    expect(await call(h, GET)).toEqual({ op: 'get', state: 'stale', commitments: null });
    const again = await call(h, PREPARE_AI);
    expect(again.state).toBe('ready');
    expect(again.usage).toBeUndefined();
    expect(h.llm.requests).toHaveLength(2);
    expect(h.quota.count(UID, DAY)).toBe(1);
    // Decisions carried over by anchorKey: accepted with its task, dropped stays dropped.
    expect(again.commitments?.items[1]).toMatchObject({ status: 'accepted', taskId, taskExists: true });
    expect(again.commitments?.items[2]?.status).toBe('dropped');
    expect(again.commitments?.items[0]?.status).toBe('open');
  });

  it('computes pre-selection from the current trust: an identical-bytes upgrade from row 10 to row 7 ticks without a model call', async () => {
    const h = harness();
    seedSummary(h.db, SUMMARY_A, { trust: { tier: 'user_forwarded', recipientBound: false, fresh: false, anchorSource: 'forward_wrapper' }, forwardedBy: 'dana@company.example' });
    const forwarded = await call(h, PREPARE_AS_WRITTEN);
    expect(forwarded.commitments?.preselect).toEqual({ allowed: false, selectAll: true, reason: 'forwarded' });
    expect(forwarded.commitments?.origin.forwardedBy).toBe('dana@company.example');
    expect(forwarded.commitments?.items.some((item) => item.preselected)).toBe(false);
    const doc = h.db.data(PATH_A) as Record<string, unknown>;
    h.db.seed(PATH_A, { ...doc, trust: { tier: 'vendor_verified', recipientBound: true, fresh: true, anchorSource: 'signed_date', originalInboxReason: null } });
    const upgraded = await call(h, GET);
    expect(upgraded.commitments?.preselect).toEqual({ allowed: true, selectAll: true, reason: null });
    expect(upgraded.commitments?.items.filter((item) => item.preselected).length).toBeGreaterThanOrEqual(8);
    expect(h.llmFactory).not.toHaveBeenCalled();
  });

  it('a parser bump of the same text makes it stale with the old decisions read-only, and prepare carries them over', async () => {
    const h = harness();
    seedSummary(h.db, SUMMARY_A);
    const prepared = await call(h, PREPARE_AS_WRITTEN);
    const item = prepared.commitments?.items[0];
    const decided = await call(h, {
      op: 'decide',
      summaryId: SUMMARY_A,
      key: prepared.commitments?.key,
      timezone: 'America/Mexico_City',
      language: 'en',
      decisions: [{ anchorId: item?.anchorId, decision: 'accept', draft: { title: item?.title, dueDate: null, dueTime: null, reminderMinutesBefore: null, owner: null } }],
    });
    const doc = h.db.data(PATH_A) as Record<string, unknown>;
    h.db.seed(PATH_A, { ...doc, extraction: { ...(doc.extraction as Record<string, unknown>), parserVersion: 0 } });
    const stale = await call(h, GET);
    expect(stale.state).toBe('stale');
    expect(stale.commitments?.items[0]?.status).toBe('accepted');
    expect(stale.commitments?.items.some((entry) => entry.preselected)).toBe(false);
    expect(stale.commitments?.preselect.selectAll).toBe(false);
    expect((await reasonOf(call(h, { op: 'decide', summaryId: SUMMARY_A, key: prepared.commitments?.key, timezone: 'UTC', language: 'en', decisions: [{ anchorId: item?.anchorId, decision: 'drop' }] }))).reason).toBe('stale');
    const again = await call(h, PREPARE_AS_WRITTEN);
    expect(again.state).toBe('ready');
    expect(again.commitments?.items[0]).toMatchObject({ status: 'accepted', taskId: decided.results?.[0]?.taskId });
  });

  it('a 150-item recap stays inside the 60,000-character budget and says it was cut', async () => {
    const lines = ['Big sync', '2026-10-16', '', 'Action items'];
    for (let index = 1; index <= 160; index += 1) {
      lines.push(`[ ] Deliver work package ${index} with a long description of its scope ${'and its details '.repeat(22)}(owner: Bish)`);
    }
    const text = lines.join('\n');
    const h = harness([toolResult([proposal(specimenId('Deliver work package 1 ', text), { title: 'Deliver work package 1', owner: 'Bish' })])]);
    seedSummary(h.db, SUMMARY_A, { text });
    const response = await call(h, PREPARE_AI);
    expect(response.commitments?.truncated).toBe(true);
    const done = h.log.entries.find((entry) => entry.event === 'summaries.commitments' && entry.fields.op === 'prepare');
    expect(done?.fields.inputChars as number).toBeLessThanOrEqual(60_000);
    expect(done?.fields.inputItems as number).toBeLessThanOrEqual(150);
    expect((h.llm.requests[0]?.messages[1]?.content.length ?? 0) < 75_000).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// The failure rows of section 2.9
// ---------------------------------------------------------------------------------------------

describe('failures and refunds (section 2.9)', () => {
  it.each(['configuration', 'connection', 'rate_limited', 'server'] as const)('%s: upstream_error, refunded, the charge cleared, the call still counted', async (kind) => {
    const h = harness([new UpstreamError(kind, 503)]);
    seedSummary(h.db, SUMMARY_A);
    expect((await reasonOf(call(h, PREPARE_AI))).reason).toBe('upstream_error');
    expect(h.quota.count(UID, DAY)).toBe(0);
    expect(h.quota.root(UID).introUsed).toBe(0);
    const extraction = extractionOf(h);
    expect(extraction.charge).toBeNull();
    // Section 2.8: every model call counts, refunded or not.
    expect(extraction.calls?.n).toBe(1);
    expect(extraction.lease).toBeNull();
  });

  it('three refunded failures in a row reach the call cap: the fourth prepare makes no model call, nothing is charged (review S5, P4)', async () => {
    const h = harness([new UpstreamError('connection', null), new UpstreamError('server', 502), new UpstreamError('rate_limited', 429), toolResult(specimenProposals())]);
    seedSummary(h.db, SUMMARY_A);
    for (let attempt = 0; attempt < 3; attempt += 1) expect((await reasonOf(call(h, PREPARE_AI))).reason).toBe('upstream_error');
    expect(h.llm.requests).toHaveLength(3);
    expect(extractionOf(h).calls?.n).toBe(3);
    expect((await reasonOf(call(h, PREPARE_AI))).reason).toBe('upstream_error');
    expect(h.llm.requests).toHaveLength(3);
    // Every attempt was refunded; the items as written stay free.
    expect(h.quota.count(UID, DAY)).toBe(0);
    expect(extractionOf(h).charge).toBeNull();
    expect((await call(h, PREPARE_AS_WRITTEN)).state).toBe('ready');
  });

  it('the global budget exhausted: upstream_error, refunded, no model call', async () => {
    const h = harness([toolResult(specimenProposals())]);
    h.deps.globalBudget = { tryAcquire: async () => false };
    seedSummary(h.db, SUMMARY_A);
    expect((await reasonOf(call(h, PREPARE_AI))).reason).toBe('upstream_error');
    expect(h.llmFactory).not.toHaveBeenCalled();
    expect(h.quota.count(UID, DAY)).toBe(0);
    expect(extractionOf(h)).toMatchObject({ charge: null, lease: null, calls: null });
    expect(h.log.entries.some((entry) => entry.level === 'error' && entry.event === 'summaries.commitments.global_budget_exhausted')).toBe(true);
  });

  it('spends one global-budget unit per started 10,000 characters of payload', async () => {
    const lines = ['Long sync', '2026-10-16', '', 'Action items'];
    for (let index = 1; index <= 60; index += 1) lines.push(`[ ] Deliver package ${index} ${'with words '.repeat(30)}(owner: Bish)`);
    const text = lines.join('\n');
    const h = harness([toolResult([])]);
    const acquired: string[] = [];
    h.deps.globalBudget = {
      tryAcquire: async (day) => {
        acquired.push(day);
        return true;
      },
    };
    seedSummary(h.db, SUMMARY_A, { text });
    await call(h, PREPARE_AI);
    const chars = h.llm.requests[0]?.messages[1]?.content.length ?? 0;
    expect(acquired).toHaveLength(Math.ceil(chars / 10_000));
    expect(acquired.length).toBeGreaterThan(1);
    expect(new Set(acquired)).toEqual(new Set([DAY]));
  });

  it('a timeout keeps the charge; the retry is free', async () => {
    const h = harness([new UpstreamError('timeout', null), toolResult(specimenProposals())]);
    seedSummary(h.db, SUMMARY_A);
    expect((await reasonOf(call(h, PREPARE_AI))).reason).toBe('upstream_error');
    expect(h.quota.count(UID, DAY)).toBe(1);
    expect(extractionOf(h).charge).not.toBeNull();
    expect(extractionOf(h).calls?.n).toBe(1);
    const retry = await call(h, PREPARE_AI);
    expect(retry.state).toBe('ready');
    expect(retry.usage).toBeUndefined();
    expect(h.quota.count(UID, DAY)).toBe(1);
  });

  it('three timeouts in a row, then upstream_error without a model call (the call cap)', async () => {
    const h = harness([new UpstreamError('timeout', null)]);
    seedSummary(h.db, SUMMARY_A);
    for (let attempt = 0; attempt < 3; attempt += 1) expect((await reasonOf(call(h, PREPARE_AI))).reason).toBe('upstream_error');
    expect(h.llm.requests).toHaveLength(3);
    const capped = await reasonOf(call(h, PREPARE_AI));
    expect(capped.reason).toBe('upstream_error');
    expect(h.llm.requests).toHaveLength(3);
    expect(h.quota.count(UID, DAY)).toBe(1);
    // The items as written are still free.
    expect((await call(h, PREPARE_AS_WRITTEN)).state).toBe('ready');
  });

  it('broken JSON from the model is upstream_error, kept, and its SyntaxError never reaches a log', async () => {
    const secret = 'Wire the 5000 to account SECRETTITLEX';
    const h = harness([
      {
        content: null,
        refusal: null,
        toolCalls: [{ name: 'propose_commitments', arguments: `{"commitments":[{"anchor_id":"i_000000000000","title":"${secret}` }],
        finishReason: 'tool_calls',
        usage: null,
      },
    ]);
    seedSummary(h.db, SUMMARY_A);
    expect((await reasonOf(call(h, PREPARE_AI))).reason).toBe('upstream_error');
    expect(h.quota.count(UID, DAY)).toBe(1);
    expect(h.log.text()).not.toContain('SECRETTITLEX');
    expect(h.log.entries.some((entry) => entry.event === 'summaries.commitments.output_unusable' && entry.fields.reason === 'unparsable')).toBe(true);
  });

  it("finish_reason 'length' with a cut call is a failure row (charge kept)", async () => {
    const h = harness([
      { content: null, refusal: null, toolCalls: [{ name: 'propose_commitments', arguments: '{"commitments":[{"anchor_id":"i_0' }], finishReason: 'length', usage: null },
    ]);
    seedSummary(h.db, SUMMARY_A);
    expect((await reasonOf(call(h, PREPARE_AI))).reason).toBe('upstream_error');
    expect(h.log.entries.some((entry) => entry.fields.reason === 'cut')).toBe(true);
    expect(extractionOf(h).charge).not.toBeNull();
  });

  it('output that parsed but where nothing survived the checks is state empty (charge kept)', async () => {
    const h = harness([toolResult([proposal('i_ffffffffffff', { title: 'Invented line' })])]);
    seedSummary(h.db, SUMMARY_A);
    const response = await call(h, PREPARE_AI);
    expect(response.state).toBe('empty');
    expect(response.commitments?.items).toEqual([]);
    expect(h.quota.count(UID, DAY)).toBe(1);
  });

  it('a refusal or no call is an empty result, and JSON written as text is never recovered', async () => {
    const json = JSON.stringify({ commitments: [proposal(specimenId('Provide APK'), { title: 'Provide APK access' })] });
    const h = harness([{ content: json, refusal: null, toolCalls: [], finishReason: 'stop', usage: null }]);
    seedSummary(h.db, SUMMARY_A);
    const response = await call(h, PREPARE_AI);
    expect(response.state).toBe('empty');
  });

  it('a data key that does not parse is upstream_error with the setup alarm; nothing is charged', async () => {
    const h = harness([toolResult(specimenProposals())]);
    seedSummary(h.db, SUMMARY_A);
    h.deps.keyring = () => {
      throw new SealedError('keyring_malformed', 'bad');
    };
    expect((await reasonOf(call(h, PREPARE_AI))).reason).toBe('upstream_error');
    expect(h.log.entries.some((entry) => entry.event === 'summaries.setup_alarm' && entry.fields.reason === 'data_key_invalid')).toBe(true);
    expect(h.quota.transactions).toBe(0);
  });

  it('content that changed during the call discards the result; the next preparation is free', async () => {
    const h = harness([
      (request) => {
        const doc = h.db.data(PATH_A) as Record<string, unknown>;
        h.db.seed(PATH_A, { ...doc, contentDigest: 'e'.repeat(64) });
        void request;
        return toolResult(specimenProposals());
      },
    ]);
    seedSummary(h.db, SUMMARY_A);
    const response = await call(h, PREPARE_AI);
    expect(response).toMatchObject({ op: 'prepare', state: 'stale', commitments: null });
    expect(extractionOf(h).views).toEqual({ ai: null, as_written: null });
    expect(extractionOf(h).lease).toBeNull();
    expect(h.quota.count(UID, DAY)).toBe(1);
  });

  it.each([
    ['deleted', (h: Harness) => h.db.doc(PATH_A).delete()],
    // Disconnect and delete removes every summary document (actions.ts deleteAllSummaries; the fake has no batch).
    ['removed by Disconnect and delete', async (h: Harness) => Promise.all(h.db.paths(`users/${UID}/meetingSummaries/`).map((path) => h.db.doc(path).delete()))],
  ])('a summary %s during the model call is never recreated', async (_label, remove) => {
    const h = harness([
      async () => {
        await remove(h);
        return toolResult(specimenProposals());
      },
    ]);
    seedSummary(h.db, SUMMARY_A);
    expect((await reasonOf(call(h, PREPARE_AI))).reason).toBe('not_found');
    expect(h.db.has(PATH_A)).toBe(false);
    expect(h.db.paths(`users/${UID}/meetingSummaries`)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// Logs and stored plaintext
// ---------------------------------------------------------------------------------------------

describe('no content in logs or plaintext', () => {
  it('logs counts and codes only, and the stored plaintext holds no title, quote or owner name', async () => {
    const h = harness([toolResult(specimenProposals())]);
    seedSummary(h.db, SUMMARY_A);
    seedMeeting(h.db);
    await call(h, GET);
    const prepared = await call(h, PREPARE_AI);
    await call(h, PREPARE_AS_WRITTEN);
    const item = prepared.commitments?.items[0];
    const decided = await call(h, {
      op: 'decide',
      summaryId: SUMMARY_A,
      key: prepared.commitments?.key,
      timezone: 'America/Mexico_City',
      language: 'en',
      decisions: [{ anchorId: item?.anchorId, decision: 'accept', draft: { title: item?.title, dueDate: null, dueTime: null, reminderMinutesBefore: null, owner: { name: 'Bish', isUser: false } } }],
    });
    await reasonOf(call(h, { ...PREPARE_AI, summaryId: SUMMARY_B }));
    const logs = h.log.text();
    expect(logs).toContain('summaries.commitments');
    const forbidden = [
      'Provide APK',
      'Urpayroll',
      'Bish',
      'Cristina',
      'pricing page',
      MEETING_TITLE,
      MEETING_ID,
      SUMMARY_A,
      SUMMARY_B,
      item?.anchorId as string,
      decided.results?.[0]?.taskId as string,
      prepared.commitments?.key as string,
    ];
    for (const secret of forbidden) expect([secret, logs.includes(secret)]).toEqual([secret, false]);

    const stored = extractionOf(h);
    const plaintext = JSON.stringify({
      ...stored,
      views: {
        ai: stored.views.ai === null ? null : { ...stored.views.ai, sealed: null },
        as_written: stored.views.as_written === null ? null : { ...stored.views.as_written, sealed: null },
      },
    });
    for (const secret of ['Provide APK', 'to Urpayroll', 'Bish', 'Cristina', 'pricing', 'launch date']) expect([secret, plaintext.includes(secret)]).toEqual([secret, false]);
  });
});

describe('the reference day', () => {
  it('counts relative dates from the meeting in its own zone (a 21:30 Mexico City meeting)', async () => {
    const h = harness([toolResult([])]);
    seedSummary(h.db, SUMMARY_A, { match: autoMatch({}, { startAt: '2026-10-17T03:30:00.000Z', endAt: '2026-10-17T04:30:00.000Z', timezone: 'America/Mexico_City' }) });
    await call(h, PREPARE_AI);
    const data = h.llm.requests[0]?.messages[1]?.content ?? '';
    const json = JSON.parse(data.split('\n')[1] ?? '{}') as { reference: { day: string; zone: string; weekday: string; dates: string[] } };
    expect(json.reference).toMatchObject({ day: '2026-10-16', zone: 'America/Mexico_City', weekday: 'Friday' });
    expect(json.reference.dates[1]).toBe('Friday 2026-10-16 (today)');
  });

  it('uses the summary date for a kept summary', async () => {
    const h = harness([toolResult([])]);
    seedSummary(h.db, SUMMARY_A, { status: 'kept', summaryDate: '2026-10-14' });
    await call(h, PREPARE_AI);
    const json = JSON.parse((h.llm.requests[0]?.messages[1]?.content ?? '').split('\n')[1] ?? '{}') as { reference: { day: string }; meeting: unknown };
    expect(json.reference.day).toBe('2026-10-14');
    expect(json.meeting).toBeNull();
  });
});

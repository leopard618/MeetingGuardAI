/**
 * The M11 summaryCommitments contract (shared/aiContract.ts, a verbatim copy of src/core; the
 * copy check is contract.test.ts). Additive only: the M10 shapes and error codes are unchanged
 * apart from optional fields. docs/v2/M11-DESIGN.md section 6.
 */
import {
  AI_CONTRACT_VERSION,
  CALLABLES,
  COMMITMENT_ERROR_CODES,
  COMMITMENT_ERROR_HTTPS_CODES,
  COMMITMENT_FLAGS,
  COMMITMENT_LIMITS,
  COMMITMENT_OUTCOMES,
  COMMITMENT_STATES,
  SUMMARY_COMMITMENTS_CALLABLE,
  SUMMARY_COMMITMENTS_TIMEOUT_MS,
  SUMMARY_ERROR_CODES,
  SUMMARY_ERROR_HTTPS_CODES,
  commitmentErrorDetailsSchema,
  commitmentFlagsSchema,
  summaryCommitmentsRequestSchema,
  summaryCommitmentsResponseSchema,
  summaryDetailSchema,
  summaryErrorDetailsSchema,
  summaryListItemSchema,
  summaryStatusResponseSchema,
} from '../../src/shared/aiContract';

const SUMMARY_ID = 'a'.repeat(64);
const KEY = 'x_0123456789abcdef';
const ANCHOR = 'i_0123456789ab';
const SENTENCE = 'q_ba9876543210';

function item(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    anchorId: ANCHOR,
    number: 1,
    anchorKind: 'item',
    sectionKind: 'action_items',
    sectionHeading: 'Action items',
    quote: 'Provide APK access/files to Urpayroll (owner: Bish)',
    title: 'Bish: Provide APK access/files to Urpayroll',
    owner: { name: 'Bish', isUser: false, guess: false },
    due: null,
    confidence: 90,
    flags: [],
    preselected: true,
    status: 'open',
    taskId: null,
    taskExists: null,
    via: null,
    ...overrides,
  };
}

function commitments(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    key: KEY,
    mode: 'ai',
    preparedAt: '2026-11-12T10:00:00.000Z',
    preselect: { allowed: true, selectAll: true, reason: null },
    origin: {
      meetingId: 'mtgUrpayrollSync01',
      meetingTitle: 'Urpayroll weekly sync',
      occurrenceDate: null,
      localDate: '2026-10-16',
      tier: 'vendor_verified',
      senderDomain: 'notetaker.example',
      forwardedBy: null,
    },
    truncated: false,
    meetingChanged: false,
    items: [item()],
    ...overrides,
  };
}

const USAGE = { used: 3, limit: 10, plan: 'free', resetsAt: '2026-11-13T00:00:00.000Z', period: 'window' };
const DRAFT = { title: 'Bish: Provide APK access', dueDate: '2026-10-16', dueTime: '09:00', reminderMinutesBefore: 0, owner: { name: 'Bish', isUser: false } };

describe('summaryCommitments: names, limits, enums', () => {
  it('names the callable and its client timeout; AI_CONTRACT_VERSION is unchanged (additive)', () => {
    expect(SUMMARY_COMMITMENTS_CALLABLE).toBe('summaryCommitments');
    expect(SUMMARY_COMMITMENTS_TIMEOUT_MS).toBe(100_000);
    expect(AI_CONTRACT_VERSION).toBe(7);
    // M11 day 4 (the app's service): CALLABLES holds the same name, with its FUNCTIONS_CONTRACT row
    // in src/core/contracts.ts; the M10 entries are unchanged.
    expect(CALLABLES.summaryCommitments).toBe(SUMMARY_COMMITMENTS_CALLABLE);
    expect(CALLABLES.summaryStatus).toBe('summaryStatus');
    expect(CALLABLES.summaryAction).toBe('summaryAction');
    expect(CALLABLES.summaryRead).toBe('summaryRead');
  });

  it('keeps the design limits and enums', () => {
    expect(COMMITMENT_LIMITS).toEqual({ maxProposals: 30, maxDecisionsPerCall: 30, maxQuoteChars: 300, minSentenceQuoteChars: 20, maxTitleChars: 200, maxOwnerChars: 100 });
    expect(COMMITMENT_STATES).toEqual(['none', 'preparing', 'ready', 'empty', 'stale']);
    expect(COMMITMENT_FLAGS).toEqual(['possible_instruction', 'has_link', 'truncated', 'payment_like', 'suggested', 'checklist', 'owner_guess', 'similar_added']);
    expect(COMMITMENT_OUTCOMES).toEqual(['added', 'already_added', 'dropped', 'restored', 'removed', 'changed', 'not_open']);
  });
});

describe('summaryCommitments requests', () => {
  it('parses get, prepare and decide', () => {
    expect(summaryCommitmentsRequestSchema.safeParse({ op: 'get', summaryId: SUMMARY_ID }).success).toBe(true);
    expect(summaryCommitmentsRequestSchema.safeParse({ op: 'prepare', summaryId: SUMMARY_ID, mode: 'as_written' }).success).toBe(true);
    const decide = {
      op: 'decide',
      summaryId: SUMMARY_ID,
      key: KEY,
      timezone: 'America/Mexico_City',
      language: 'es',
      decisions: [
        { anchorId: ANCHOR, decision: 'accept', draft: DRAFT },
        { anchorId: SENTENCE, decision: 'drop' },
        { anchorId: 'i_aaaaaaaaaaaa', decision: 'restore' },
        { anchorId: 'i_bbbbbbbbbbbb', decision: 'remove' },
      ],
    };
    expect(summaryCommitmentsRequestSchema.safeParse(decide).success).toBe(true);
    expect(summaryCommitmentsRequestSchema.safeParse({ ...decide, decisions: [{ anchorId: ANCHOR, decision: 'accept', draft: { ...DRAFT, owner: null } }] }).success).toBe(true);
  });

  it('refuses junk: unknown ops and modes, bad keys and anchors, 0 or 31 decisions, repeats, broken drafts', () => {
    const decide = { op: 'decide', summaryId: SUMMARY_ID, key: KEY, timezone: 'UTC', language: 'en', decisions: [{ anchorId: ANCHOR, decision: 'drop' }] };
    const bad: unknown[] = [
      { op: 'list', summaryId: SUMMARY_ID },
      { op: 'prepare', summaryId: SUMMARY_ID, mode: 'magic' },
      { op: 'get', summaryId: 'a/b' },
      { ...decide, key: 'x_short' },
      { ...decide, timezone: 'Not a zone!' },
      { ...decide, decisions: [] },
      { ...decide, decisions: Array.from({ length: 31 }, (_, n) => ({ anchorId: `i_${n.toString(16).padStart(12, '0')}`, decision: 'drop' })) },
      { ...decide, decisions: [{ anchorId: ANCHOR, decision: 'drop' }, { anchorId: ANCHOR, decision: 'restore' }] },
      { ...decide, decisions: [{ anchorId: 's_0123456789ab', decision: 'drop' }] },
      { ...decide, decisions: [{ anchorId: ANCHOR, decision: 'accept' }] },
      { ...decide, decisions: [{ anchorId: ANCHOR, decision: 'accept', draft: { ...DRAFT, dueDate: null } }] },
      { ...decide, decisions: [{ anchorId: ANCHOR, decision: 'accept', draft: { ...DRAFT, dueTime: null } }] },
      { ...decide, decisions: [{ anchorId: ANCHOR, decision: 'accept', draft: { ...DRAFT, title: 'x'.repeat(201) } }] },
      { ...decide, decisions: [{ anchorId: ANCHOR, decision: 'accept', draft: { ...DRAFT, owner: { name: 'x'.repeat(101), isUser: false } } }] },
    ];
    for (const request of bad) expect(summaryCommitmentsRequestSchema.safeParse(request).success).toBe(false);
    expect(summaryCommitmentsRequestSchema.safeParse({ ...decide, decisions: Array.from({ length: 30 }, (_, n) => ({ anchorId: `i_${n.toString(16).padStart(12, '0')}`, decision: 'drop' })) }).success).toBe(true);
  });
});

describe('summaryCommitments responses', () => {
  it('round-trips ready, empty, stale, none, preparing and a decide answer', () => {
    const ready = { op: 'prepare', state: 'ready', commitments: commitments(), usage: USAGE };
    expect(summaryCommitmentsResponseSchema.parse(ready)).toEqual(ready);
    expect(summaryCommitmentsResponseSchema.safeParse({ op: 'get', state: 'empty', commitments: commitments({ items: [] }) }).success).toBe(true);
    expect(summaryCommitmentsResponseSchema.safeParse({ op: 'get', state: 'stale', commitments: commitments({ mode: 'as_written' }) }).success).toBe(true);
    for (const state of ['none', 'preparing']) expect(summaryCommitmentsResponseSchema.safeParse({ op: 'get', state, commitments: null }).success).toBe(true);
    const decided = {
      op: 'decide',
      state: 'ready',
      commitments: commitments({ items: [item({ status: 'accepted', taskId: 'sm_0123456789abcdef0123456789abcdef', taskExists: true, via: 'app', preselected: false })] }),
      results: [{ anchorId: ANCHOR, outcome: 'added', taskId: 'sm_0123456789abcdef0123456789abcdef' }],
    };
    expect(summaryCommitmentsResponseSchema.parse(decided)).toEqual(decided);
  });

  it('carries a stated due with its zone and quote, a sentence anchor and an owner guess', () => {
    const rich = commitments({
      items: [
        item({
          anchorId: SENTENCE,
          anchorKind: 'sentence',
          sectionKind: 'notes',
          sectionHeading: 'Notes',
          quote: 'Cristina will send the pricing deck to the client by Friday at 17:00.',
          owner: { name: 'Cristina', isUser: true, guess: true },
          due: { date: '2026-10-16', time: '17:00', zone: 'Europe/Madrid', quote: 'by Friday at 17:00', overdue: false },
          flags: ['owner_guess'],
          confidence: null,
        }),
      ],
    });
    expect(summaryCommitmentsResponseSchema.safeParse({ op: 'get', state: 'ready', commitments: rich }).success).toBe(true);
  });

  it('drops a flag value a later server adds, and an unknown banner reason, instead of failing the answer', () => {
    expect(commitmentFlagsSchema.parse(['payment_like', 'teleport', 'payment_like', 7])).toEqual(['payment_like']);
    const later = commitments({ preselect: { allowed: false, selectAll: true, reason: 'cosmic_rays' }, items: [item({ flags: ['has_link', 'future_flag'] })] });
    const parsed = summaryCommitmentsResponseSchema.parse({ op: 'get', state: 'ready', commitments: later });
    expect(parsed.commitments?.preselect.reason).toBeNull();
    expect(parsed.commitments?.items[0]?.flags).toEqual(['has_link']);
  });

  it('refuses answers outside the bounds', () => {
    const bad: unknown[] = [
      { op: 'get', state: 'ready', commitments: commitments({ items: Array.from({ length: 31 }, (_, n) => item({ number: n + 1 })) }) },
      { op: 'get', state: 'ready', commitments: commitments({ items: [item({ title: '' })] }) },
      { op: 'get', state: 'ready', commitments: commitments({ items: [item({ quote: 'x'.repeat(1001) })] }) },
      { op: 'get', state: 'ready', commitments: commitments({ items: [item({ confidence: 101 })] }) },
      { op: 'get', state: 'ready', commitments: commitments({ items: [item({ due: { date: '2026-10-16', time: '25:00', zone: null, quote: null, overdue: false } })] }) },
      { op: 'get', state: 'teleporting', commitments: null },
      { op: 'decide', state: 'ready', commitments: null, results: [{ anchorId: ANCHOR, outcome: 'exploded', taskId: null }] },
    ];
    for (const response of bad) expect(summaryCommitmentsResponseSchema.safeParse(response).success).toBe(false);
  });
});

describe('summaryCommitments errors', () => {
  it('adds quota_exceeded and stale to the summary codes in a separate list; the M10 list is unchanged', () => {
    expect(COMMITMENT_ERROR_CODES).toEqual([...SUMMARY_ERROR_CODES, 'quota_exceeded', 'stale']);
    expect(SUMMARY_ERROR_CODES).toHaveLength(9);
    expect(Object.keys(COMMITMENT_ERROR_HTTPS_CODES).sort()).toEqual([...COMMITMENT_ERROR_CODES].sort());
    expect(COMMITMENT_ERROR_HTTPS_CODES.quota_exceeded).toBe('resource-exhausted');
    expect(COMMITMENT_ERROR_HTTPS_CODES.stale).toBe('failed-precondition');
    for (const code of SUMMARY_ERROR_CODES) expect(COMMITMENT_ERROR_HTTPS_CODES[code]).toBe(SUMMARY_ERROR_HTTPS_CODES[code]);
  });

  it('details carry the reason, and the usage for quota_exceeded', () => {
    expect(commitmentErrorDetailsSchema.safeParse({ reason: 'quota_exceeded', usage: USAGE }).success).toBe(true);
    expect(commitmentErrorDetailsSchema.safeParse({ reason: 'stale' }).success).toBe(true);
    expect(commitmentErrorDetailsSchema.safeParse({ reason: 'not_found' }).success).toBe(true);
    expect(commitmentErrorDetailsSchema.safeParse({ reason: 'teapot' }).success).toBe(false);
    // The M10 details schema is as it was.
    expect(summaryErrorDetailsSchema.safeParse({ reason: 'stale' }).success).toBe(false);
  });
});

describe('summaryRead rows gain optional counts (additive)', () => {
  const row = {
    summaryId: SUMMARY_ID,
    status: 'matched',
    title: 'Urpayroll weekly sync',
    summaryDate: '2026-10-16',
    receivedAt: '2026-10-16T21:00:00.000Z',
    tier: 'vendor_verified',
    recipientBound: true,
    fresh: true,
    inboxReason: null,
    refusedReason: null,
    senderDomain: 'notetaker.example',
    count: null,
    match: null,
    suggestions: [],
  };

  it('parses a row with and without them (an M10 server sends none)', () => {
    expect(summaryListItemSchema.parse(row)).toEqual(row);
    const counted = { ...row, commitments: { state: 'ready', open: 5, accepted: 3 } };
    expect(summaryListItemSchema.parse(counted)).toEqual(counted);
    expect(summaryListItemSchema.safeParse({ ...row, commitments: { state: 'ready', open: 31, accepted: 0 } }).success).toBe(false);
    const detail = { ...counted, subject: null, titleLine: null, fromAddress: null, forwardedBy: null, text: 'x', sections: [] };
    expect(summaryDetailSchema.safeParse(detail).success).toBe(true);
  });

  it('M11: the full view gains an optional truncated flag (an M10 server sends none)', () => {
    const detail = { ...row, subject: null, titleLine: null, fromAddress: null, forwardedBy: null, text: 'x', sections: [] };
    expect(summaryDetailSchema.parse(detail)).toEqual(detail);
    expect(summaryDetailSchema.parse(detail).truncated).toBeUndefined();
    expect(summaryDetailSchema.parse({ ...detail, truncated: true }).truncated).toBe(true);
    expect(summaryDetailSchema.parse({ ...detail, truncated: false }).truncated).toBe(false);
    expect(summaryDetailSchema.safeParse({ ...detail, truncated: 'yes' }).success).toBe(false);
  });
});

describe('summaryStatus gains an optional addressCreatedAt (additive)', () => {
  const status = {
    enabled: true,
    allowed: true,
    ready: true,
    address: 'abcdefghijklmnop@summaries.example',
    mailboxes: [],
    gmailRequests: [],
    inboxCount: 0,
    lastReceivedAt: null,
    lastRefused: null,
    refusedToday: null,
  };

  it('parses a status with a time, null, or without it (an M10 server)', () => {
    expect(summaryStatusResponseSchema.parse(status)).toEqual(status);
    expect(summaryStatusResponseSchema.parse(status).addressCreatedAt).toBeUndefined();
    expect(summaryStatusResponseSchema.parse({ ...status, addressCreatedAt: null }).addressCreatedAt).toBeNull();
    expect(summaryStatusResponseSchema.parse({ ...status, addressCreatedAt: '2026-11-12T10:00:00.000Z' }).addressCreatedAt).toBe('2026-11-12T10:00:00.000Z');
    expect(summaryStatusResponseSchema.safeParse({ ...status, addressCreatedAt: 'yesterday' }).success).toBe(false);
  });
});

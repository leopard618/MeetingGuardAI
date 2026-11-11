/**
 * Shared copies and the M10 summaries contract.
 *
 * Every file in PAIRS under functions/src/shared must be a VERBATIM copy of the app's
 * src/core/<name>.ts (same check as `npm run check:contract` and the CI step). Line endings are
 * normalized so a Windows checkout with autocrlf does not produce a false positive. The copies
 * may import only zod and each other, so they resolve inside functions/src/shared.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  CALLABLES,
  SUMMARIES_CALL_TIMEOUT_MS,
  SUMMARIES_READ_TIMEOUT_MS,
  SUMMARY_ACTION_OPS,
  SUMMARY_ERROR_CODES,
  SUMMARY_ERROR_HTTPS_CODES,
  SUMMARY_INBOX_REASONS,
  SUMMARY_LIMITS,
  SUMMARY_REFUSED_REASONS,
  SUMMARY_SECTION_KINDS,
  summaryActionRequestSchema,
  summaryActionResponseSchema,
  summaryAddrSpecSchema,
  summaryDetailSchema,
  summaryDomainSchema,
  summaryErrorDetailsSchema,
  summaryReadRequestSchema,
  summaryReadResponseSchema,
  summaryStatusResponseSchema,
} from '../../src/shared/aiContract';

/** Keep in sync with PAIRS in functions/scripts/check-contract.mjs. */
const PAIRS = ['aiContract', 'errors', 'time', 'recurrence'] as const;

const FUNCTIONS_DIR = join(__dirname, '..', '..');
const REPO_DIR = join(FUNCTIONS_DIR, '..');

const normalize = (text: string): string => text.replace(/\r\n/g, '\n');
const appPath = (name: string): string => join(REPO_DIR, 'src', 'core', `${name}.ts`);
const copyPath = (name: string): string => join(FUNCTIONS_DIR, 'src', 'shared', `${name}.ts`);

/** null when identical, else the pair and the first differing line (1-based) with both texts. */
function drift(name: string): { pair: string; line: number; app: string | null; copy: string | null } | null {
  const app = normalize(readFileSync(appPath(name), 'utf8'));
  const copy = normalize(readFileSync(copyPath(name), 'utf8'));
  if (app === copy) return null;
  const appLines = app.split('\n');
  const copyLines = copy.split('\n');
  let index = 0;
  while (appLines[index] === copyLines[index]) index += 1;
  return { pair: name, line: index + 1, app: appLines[index] ?? null, copy: copyLines[index] ?? null };
}

describe('shared copies of app core files', () => {
  it.each(PAIRS)('%s: functions/src/shared copy is identical to src/core', (name) => {
    expect(drift(name)).toBeNull();
  });

  it.each(PAIRS)('%s: imports only zod and the other shared copies', (name) => {
    const source = readFileSync(copyPath(name), 'utf8');
    const specifiers = [...source.matchAll(/\bfrom\s+'([^']+)'/g)].map((match) => match[1]);
    const allowed = new Set<string>(['zod', ...PAIRS.map((pair) => `./${pair}`)]);
    expect(specifiers.filter((specifier) => specifier === undefined || !allowed.has(specifier))).toEqual([]);
  });

  it('npm run check:contract passes and names all four pairs', () => {
    const output = execFileSync(process.execPath, [join(FUNCTIONS_DIR, 'scripts', 'check-contract.mjs')], {
      encoding: 'utf8',
    });
    expect(output).toContain('all 4 pairs match');
    for (const name of PAIRS) expect(output).toContain(name);
  });
});

// ---------------------------------------------------------------------------------------------
// M10 summaries contract (synthetic data only)
// ---------------------------------------------------------------------------------------------

const SUMMARY_ID = 'a'.repeat(64);
const AT = '2026-10-16T21:20:00.000Z';

const status = {
  enabled: true,
  allowed: true,
  ready: true,
  address: 'abcdefghijklmnopqrstuvwxyz@summaries.example.test',
  mailboxes: ['owner@example.test'],
  gmailRequests: [{ gmailAddress: 'owner@example.test', code: '123456789', receivedAt: AT }],
  inboxCount: 2,
  lastReceivedAt: AT,
  lastRefused: { reason: 'not_from_your_notetaker', at: AT, senderDomain: null },
};

const match = {
  meetingId: 'meeting_1',
  occurrenceDate: null,
  method: 'auto',
  meetingSnapshot: {
    title: 'Weekly sync',
    startAt: '2026-10-16T20:00:00.000Z',
    endAt: '2026-10-16T21:00:00.000Z',
    timezone: 'America/Mexico_City',
  },
};

const listItem = {
  summaryId: SUMMARY_ID,
  status: 'matched',
  title: 'Weekly sync',
  summaryDate: '2026-10-16',
  receivedAt: AT,
  tier: 'vendor_verified',
  recipientBound: true,
  fresh: true,
  inboxReason: null,
  refusedReason: null,
  senderDomain: 'notes.example.test',
  count: null,
  match,
  suggestions: [],
};

const TEXT = 'Weekly sync\nAction items\n[ ] Send the draft (owner: Ana)\n';
const itemText = '[ ] Send the draft (owner: Ana)';
const itemStart = TEXT.indexOf(itemText);

const detail = {
  ...listItem,
  subject: 'Weekly sync notes',
  titleLine: 'Weekly sync',
  fromAddress: 'notes@notes.example.test',
  forwardedBy: null,
  text: TEXT,
  sections: [
    { id: 's_preamble', kind: 'preamble', heading: null, derived: false, start: 0, end: 12, items: [] },
    {
      id: 's_actions',
      kind: 'action_items',
      heading: 'Action items',
      derived: false,
      start: 12,
      end: TEXT.length,
      items: [
        {
          id: 'i_0123456789ab',
          text: itemText,
          start: itemStart,
          end: itemStart + itemText.length,
          checked: false,
          owner: 'Ana',
          dueText: null,
          flags: [],
        },
      ],
    },
  ],
};

describe('M10 summaries contract', () => {
  it('adds the three callables, named after themselves, and the client timeouts', () => {
    expect(CALLABLES.summaryStatus).toBe('summaryStatus');
    expect(CALLABLES.summaryAction).toBe('summaryAction');
    expect(CALLABLES.summaryRead).toBe('summaryRead');
    expect(SUMMARIES_CALL_TIMEOUT_MS).toBe(15_000);
    expect(SUMMARIES_READ_TIMEOUT_MS).toBe(35_000);
  });

  it('keeps the design enums', () => {
    expect(SUMMARY_INBOX_REASONS).toHaveLength(8);
    expect(SUMMARY_REFUSED_REASONS).toHaveLength(7);
    expect(SUMMARY_SECTION_KINDS).toEqual([
      'preamble',
      'tldr',
      'summary',
      'updates',
      'decisions',
      'action_items',
      'next_steps',
      'waiting_on',
      'open_questions',
      'notes',
      'custom',
      'body',
    ]);
  });

  it('maps every error code to an HttpsError code and parses error details', () => {
    expect(Object.keys(SUMMARY_ERROR_HTTPS_CODES).sort()).toEqual([...SUMMARY_ERROR_CODES].sort());
    expect(summaryErrorDetailsSchema.safeParse({ reason: 'not_ready' }).success).toBe(true);
    expect(summaryErrorDetailsSchema.safeParse({ reason: 'teapot' }).success).toBe(false);
  });

  describe('summaryStatus', () => {
    it('parses a full status and the disabled shape', () => {
      expect(summaryStatusResponseSchema.safeParse(status).success).toBe(true);
      const disabled = {
        ...status,
        allowed: false,
        address: null,
        mailboxes: [],
        gmailRequests: [],
        inboxCount: 0,
        lastReceivedAt: null,
        lastRefused: null,
      };
      expect(summaryStatusResponseSchema.safeParse(disabled).success).toBe(true);
    });

    it('accepts the development address with a plus part', () => {
      const dev = { ...status, address: 'serverhash+abcdefghijklmnopqrstuvwxyz@inbound.example.test' };
      expect(summaryStatusResponseSchema.safeParse(dev).success).toBe(true);
    });

    it('bounds mailboxes and Gmail requests and refuses junk codes', () => {
      const six = Array.from({ length: 6 }, (_, index) => `user${index}@example.test`);
      expect(summaryStatusResponseSchema.safeParse({ ...status, mailboxes: six }).success).toBe(false);
      const request = status.gmailRequests[0];
      const four = [request, request, request, request];
      expect(summaryStatusResponseSchema.safeParse({ ...status, gmailRequests: four }).success).toBe(false);
      const phishing = [{ ...request, code: 'Call 555 now' }];
      expect(summaryStatusResponseSchema.safeParse({ ...status, gmailRequests: phishing }).success).toBe(false);
    });
  });

  describe('plain addresses and domains', () => {
    it.each(['owner@example.test', 'first.last+tag@sub.example.test', "o'neil@example.test", 'a@xn--p1ai.example'])(
      'accepts %s',
      (address) => {
        expect(summaryAddrSpecSchema.safeParse(address).success).toBe(true);
      },
    );

    it.each([
      'Owner <owner@example.test>',
      'owner@example.test, other@example.test',
      '"quoted"@example.test',
      'two@at@example.test',
      '.lead@example.test',
      'double..dot@example.test',
      'owner@localhost',
      'owner@-bad.example.test',
      `${'a'.repeat(65)}@example.test`,
    ])('refuses %s', (address) => {
      expect(summaryAddrSpecSchema.safeParse(address).success).toBe(false);
    });

    it('accepts a DNS name and refuses text that is not one', () => {
      expect(summaryDomainSchema.safeParse('mail.notes.example.test').success).toBe(true);
      expect(summaryDomainSchema.safeParse('example').success).toBe(false);
      expect(summaryDomainSchema.safeParse('verify-account now.example.test').success).toBe(false);
    });
  });

  describe('summaryAction', () => {
    it('has exactly the documented ops, in order', () => {
      const ops = summaryActionRequestSchema.options.map((option) => option.shape.op.value);
      expect(ops).toEqual([...SUMMARY_ACTION_OPS]);
    });

    it.each([
      { op: 'create_address' },
      { op: 'regenerate_address' },
      { op: 'set_mailboxes', mailboxes: [] },
      { op: 'set_mailboxes', mailboxes: ['Owner@Example.test', 'work@example.test'] },
      { op: 'dismiss_gmail', gmailAddress: 'owner@example.test' },
      { op: 'attach', summaryId: SUMMARY_ID, meetingId: 'meeting_1', occurrenceDate: null },
      { op: 'attach', summaryId: SUMMARY_ID, meetingId: 'series_1', occurrenceDate: '2026-10-16' },
      { op: 'detach', summaryId: SUMMARY_ID },
      { op: 'keep', summaryId: SUMMARY_ID },
      { op: 'delete', summaryId: SUMMARY_ID },
      { op: 'disconnect', deleteSummaries: true },
    ])('accepts $op', (request) => {
      expect(summaryActionRequestSchema.safeParse(request).success).toBe(true);
    });

    it.each([
      { op: 'rename_address' },
      { op: 'set_mailboxes', mailboxes: Array.from({ length: 6 }, (_, index) => `user${index}@example.test`) },
      { op: 'set_mailboxes', mailboxes: ['not an address'] },
      { op: 'attach', summaryId: SUMMARY_ID, meetingId: 'meeting_1' },
      { op: 'attach', summaryId: SUMMARY_ID, meetingId: 'bad:id', occurrenceDate: null },
      { op: 'attach', summaryId: SUMMARY_ID, meetingId: 'meeting_1', occurrenceDate: '16/10/2026' },
      { op: 'delete', summaryId: 'x'.repeat(129) },
      { op: 'delete', summaryId: 'users/u1' },
      { op: 'disconnect' },
    ])('refuses %j', (request) => {
      expect(summaryActionRequestSchema.safeParse(request).success).toBe(false);
    });

    it('parses a response with the new status and the summary state', () => {
      const response = {
        changed: true,
        status,
        summary: { summaryId: SUMMARY_ID, status: 'matched', inboxReason: null, match: { ...match, method: 'user' } },
      };
      expect(summaryActionResponseSchema.safeParse(response).success).toBe(true);
      expect(summaryActionResponseSchema.safeParse({ changed: false, status, summary: null }).success).toBe(true);
    });
  });

  describe('summaryRead', () => {
    it('requires meetingId for the meeting view, and only for it', () => {
      expect(summaryReadRequestSchema.safeParse({ op: 'list', view: 'meeting', meetingId: 'meeting_1' }).success).toBe(true);
      expect(summaryReadRequestSchema.safeParse({ op: 'list', view: 'meeting' }).success).toBe(false);
      expect(summaryReadRequestSchema.safeParse({ op: 'list', view: 'inbox' }).success).toBe(true);
      expect(summaryReadRequestSchema.safeParse({ op: 'list', view: 'inbox', meetingId: 'meeting_1' }).success).toBe(false);
      expect(summaryReadRequestSchema.safeParse({ op: 'list', view: 'archive' }).success).toBe(false);
      expect(summaryReadRequestSchema.safeParse({ op: 'get', summaryId: SUMMARY_ID }).success).toBe(true);
      expect(summaryReadRequestSchema.safeParse({ op: 'get' }).success).toBe(false);
    });

    it('parses list answers with inbox, filed and refused rows', () => {
      const inboxRow = {
        ...listItem,
        status: 'inbox',
        tier: 'user_forwarded',
        recipientBound: false,
        inboxReason: 'user_forwarded',
        match: null,
        suggestions: [
          { meetingId: 'meeting_1', occurrenceDate: null, title: 'Weekly sync', startAt: AT, score: 0.74 },
          { meetingId: 'series_1', occurrenceDate: '2026-10-16', title: 'Marketing review', startAt: AT, score: 0.47 },
        ],
      };
      const refusedRow = {
        ...listItem,
        summaryId: 'refused_2026-10-16',
        status: 'refused',
        title: null,
        summaryDate: null,
        tier: null,
        recipientBound: false,
        fresh: false,
        refusedReason: 'changed_after_sending',
        senderDomain: null,
        count: 3,
        match: null,
      };
      const answer = { op: 'list', view: 'inbox', items: [inboxRow, listItem, refusedRow], hasMore: false };
      expect(summaryReadResponseSchema.safeParse(answer).success).toBe(true);
      const tooMany = { ...answer, items: Array.from({ length: SUMMARY_LIMITS.maxListItems + 1 }, () => listItem) };
      expect(summaryReadResponseSchema.safeParse(tooMany).success).toBe(false);
      const fourSuggestions = { ...inboxRow, suggestions: [...inboxRow.suggestions, ...inboxRow.suggestions] };
      expect(summaryReadResponseSchema.safeParse({ ...answer, items: [fourSuggestions] }).success).toBe(false);
    });

    it('parses the full view and checks item offsets against the text', () => {
      expect(summaryReadResponseSchema.safeParse({ op: 'get', summary: detail }).success).toBe(true);
      const item = detail.sections[1]?.items[0];
      expect(item && TEXT.slice(item.start, item.end)).toBe(item?.text);

      const pastEnd = structuredClone(detail);
      const section = pastEnd.sections[1];
      if (!section) throw new Error('fixture');
      section.end = TEXT.length + 1;
      expect(summaryDetailSchema.safeParse(pastEnd).success).toBe(false);

      const reversed = structuredClone(detail);
      const reversedItem = reversed.sections[1]?.items[0];
      if (!reversedItem) throw new Error('fixture');
      reversedItem.start = reversedItem.end + 1;
      expect(summaryDetailSchema.safeParse(reversed).success).toBe(false);
    });

    it('caps text, sections and items in total', () => {
      const longText = { ...detail, text: 'x'.repeat(SUMMARY_LIMITS.maxTextChars + 1) };
      expect(summaryDetailSchema.safeParse(longText).success).toBe(false);
      expect(summaryDetailSchema.safeParse({ ...detail, text: '' }).success).toBe(false);

      const emptySection = { id: 's_x', kind: 'notes', heading: 'Notes', derived: false, start: 0, end: 0, items: [] };
      const tooManySections = { ...detail, sections: Array.from({ length: SUMMARY_LIMITS.maxSections + 1 }, () => emptySection) };
      expect(summaryDetailSchema.safeParse(tooManySections).success).toBe(false);

      const firstItem = detail.sections[1]?.items[0];
      if (!firstItem) throw new Error('fixture');
      const half = SUMMARY_LIMITS.maxItems / 2;
      const halfFull = { ...emptySection, end: TEXT.length, items: Array.from({ length: half }, () => firstItem) };
      const atCap = { ...detail, sections: [halfFull, halfFull] };
      expect(summaryDetailSchema.safeParse(atCap).success).toBe(true);
      const overCap = { ...detail, sections: [halfFull, { ...halfFull, items: [...halfFull.items, firstItem] }] };
      expect(summaryDetailSchema.safeParse(overCap).success).toBe(false);

      const longItem = { ...firstItem, text: 'x'.repeat(SUMMARY_LIMITS.maxItemChars + 1) };
      const withLongItem = { ...detail, sections: [{ ...emptySection, end: TEXT.length, items: [longItem] }] };
      expect(summaryDetailSchema.safeParse(withLongItem).success).toBe(false);

      const badFlag = { ...firstItem, flags: ['run_this'] };
      const withBadFlag = { ...detail, sections: [{ ...emptySection, end: TEXT.length, items: [badFlag] }] };
      expect(summaryDetailSchema.safeParse(withBadFlag).success).toBe(false);
    });
  });
});

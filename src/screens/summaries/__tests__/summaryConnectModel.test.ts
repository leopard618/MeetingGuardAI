/**
 * The connect screen's pure model: views, error messages, mailbox checks (the contract's
 * addr-spec, the private address's own domain, duplicates, the limit), the Gmail code cards, the
 * Gmail wait and polling, the Microsoft 365 hint, and the keys every branch points at (EN and ES).
 */
import { SUMMARY_LIMITS, type SummaryGmailRequest, type SummaryStatusResponse } from '../../../core/aiContract';
import { AppError } from '../../../core/errors';
import { RESOURCES } from '../../../i18n/resources';
import { SUMMARIES_DISABLED_STATUS, summaryAppError } from '../../../services/summaries/summaryCore';
import {
  SUMMARY_GMAIL_WAIT_MS,
  SUMMARY_MICROSOFT_ADMIN_KEY,
  SUMMARY_SETUP_EXTRAS,
  addressInUseSince,
  adminMailbox,
  checkNewMailbox,
  connectErrorKey,
  connectView,
  defaultSetupTab,
  gmailCards,
  gmailRequestKey,
  gmailWaitActive,
  mailboxProblemKey,
  mailboxesFull,
  normalizeMailboxInput,
  planMailboxSave,
  refreshAfterError,
  refusedFromText,
  sameMailboxes,
  shouldPollStatus,
  showMicrosoftHint,
  startGmailWait,
  withMailbox,
  withoutMailbox,
  type MailboxProblem,
} from '../summaryConnectModel';
import { SUMMARY_MICROSOFT_HINT_AFTER_MS, SUMMARY_SETUP_TABS } from '../summaryText';

const ADDRESS = 'abcdefghijklmnopqrstuvwxyz@summaries.meetingguard.ai';
const NOW = Date.parse('2026-11-12T12:00:00.000Z');
const HOUR = 60 * 60 * 1000;

const AVAILABLE: SummaryStatusResponse = {
  ...SUMMARIES_DISABLED_STATUS,
  enabled: true,
  allowed: true,
  ready: true,
};
const CONNECTED: SummaryStatusResponse = { ...AVAILABLE, address: ADDRESS, mailboxes: ['ana@example.com'] };

function gmailRequest(gmailAddress: string, receivedAt = '2026-11-12T11:00:00.000Z', code = '123456789'): SummaryGmailRequest {
  return { gmailAddress, code, receivedAt };
}

function translation(language: 'en' | 'es', qualifiedKey: string): unknown {
  const [namespace, key] = qualifiedKey.split(':') as [keyof (typeof RESOURCES)['en'], string];
  return key
    .split('.')
    .reduce<unknown>(
      (node, part) => (node !== null && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined),
      RESOURCES[language][namespace],
    );
}

function expectDefined(keys: readonly string[]): void {
  for (const language of ['en', 'es'] as const) {
    const missing = keys.filter((key) => typeof translation(language, key) !== 'string');
    expect({ language, missing }).toEqual({ language, missing: [] });
  }
}

describe('connectView', () => {
  it('waits, fails or hides while nothing is known', () => {
    expect(connectView(null, null)).toBe('loading');
    expect(connectView(null, new AppError('offline'))).toBe('error');
    expect(connectView(null, summaryAppError('not_enabled'))).toBe('unavailable');
    expect(connectView(null, summaryAppError('not_allowed'))).toBe('unavailable');
  });

  it('shows nothing but the notice unless the feature is on AND the account is in the pilot', () => {
    expect(connectView(SUMMARIES_DISABLED_STATUS, null)).toBe('unavailable');
    expect(connectView({ ...AVAILABLE, allowed: false }, null)).toBe('unavailable');
    expect(connectView({ ...AVAILABLE, enabled: false }, null)).toBe('unavailable');
  });

  it('says "being set up", offers the address, or shows it', () => {
    expect(connectView({ ...AVAILABLE, ready: false }, null)).toBe('not_ready');
    expect(connectView(AVAILABLE, null)).toBe('create');
    expect(connectView(CONNECTED, null)).toBe('connected');
    // A known status wins over a later failed ask.
    expect(connectView(CONNECTED, new AppError('offline'))).toBe('connected');
  });
});

describe('connectErrorKey and refreshAfterError', () => {
  it('reads not_ready as "being set up" and maps the rest like every summary screen', () => {
    expect(connectErrorKey(summaryAppError('not_ready'))).toBe('summaries:connect.notReady');
    expect(connectErrorKey(summaryAppError('rate_limited'))).toBe('summaries:errors.rate_limited');
    expect(connectErrorKey(summaryAppError('invalid_request'))).toBe('summaries:errors.invalid_request');
    expect(connectErrorKey(new AppError('offline'))).toBe('common:errors.offline');
    expect(connectErrorKey(new AppError('unknown'))).toBe('summaries:errors.generic');
    expectDefined(['summaries:connect.notReady']);
  });

  it('asks for the status again only when it is out of date', () => {
    expect(refreshAfterError(summaryAppError('not_enabled'))).toBe(true);
    expect(refreshAfterError(summaryAppError('not_allowed'))).toBe(true);
    expect(refreshAfterError(summaryAppError('not_ready'))).toBe(true);
    expect(refreshAfterError(summaryAppError('rate_limited'))).toBe(false);
    expect(refreshAfterError(new AppError('offline'))).toBe(false);
  });
});

describe('mailboxes', () => {
  it('accepts one plain address, trimmed and lowercased like the server', () => {
    expect(normalizeMailboxInput('  Ana.Lopez@Example.COM ')).toBe('ana.lopez@example.com');
    expect(checkNewMailbox(' Ana@Example.com ', [], ADDRESS)).toEqual({ ok: true, mailbox: 'ana@example.com' });
    expect(checkNewMailbox("o'brien+notes@mail.example.co.uk", [], ADDRESS)).toEqual({
      ok: true,
      mailbox: "o'brien+notes@mail.example.co.uk",
    });
  });

  it.each([
    'ana',
    'ana@',
    '@example.com',
    'Ana Lopez <ana@example.com>',
    'ana@example.com, bo@example.com',
    'ana@@example.com',
    'ana..lopez@example.com',
    '.ana@example.com',
    'ana@example',
    'ana lopez@example.com',
    '"ana"@example.com',
    'ana@-example.com',
    `${'a'.repeat(65)}@example.com`,
    '',
  ])('refuses %p as invalid (the contract addr-spec)', (input) => {
    expect(checkNewMailbox(input, [], ADDRESS)).toEqual({ ok: false, problem: 'invalid' });
  });

  it('refuses the private address and its domain, duplicates and a full list', () => {
    expect(checkNewMailbox(ADDRESS, [], ADDRESS)).toEqual({ ok: false, problem: 'reserved' });
    expect(checkNewMailbox('someone@SUMMARIES.meetingguard.ai', [], ADDRESS)).toEqual({ ok: false, problem: 'reserved' });
    expect(checkNewMailbox('someone@meetingguard.ai', [], ADDRESS)).toEqual({ ok: true, mailbox: 'someone@meetingguard.ai' });
    expect(checkNewMailbox('ANA@example.com', ['ana@example.com'], ADDRESS)).toEqual({ ok: false, problem: 'duplicate' });
    const full = Array.from({ length: SUMMARY_LIMITS.maxMailboxes }, (_, index) => `m${index}@example.com`);
    expect(mailboxesFull(full)).toBe(true);
    expect(mailboxesFull(full.slice(1))).toBe(false);
    expect(checkNewMailbox('new@example.com', full, ADDRESS)).toEqual({ ok: false, problem: 'maxReached' });
    // Without a known address there is no reserved domain to compare.
    expect(checkNewMailbox('a@summaries.meetingguard.ai', [], null)).toEqual({ ok: true, mailbox: 'a@summaries.meetingguard.ai' });
  });

  it('adds, removes and compares lists', () => {
    expect(withMailbox(['a@x.com'], 'b@x.com')).toEqual(['a@x.com', 'b@x.com']);
    expect(withoutMailbox(['a@x.com', 'b@x.com'], 'a@x.com')).toEqual(['b@x.com']);
    expect(sameMailboxes(['a@x.com'], ['A@X.com'])).toBe(true);
    expect(sameMailboxes(['a@x.com', 'b@x.com'], ['b@x.com', 'a@x.com'])).toBe(false);
    expect(sameMailboxes([], [])).toBe(true);
  });

  it('plans Save: the edited list plus what is still typed, nothing when unchanged', () => {
    const saved = ['ana@example.com'];
    expect(planMailboxSave(saved, null, '', ADDRESS)).toEqual({ kind: 'unchanged' });
    expect(planMailboxSave(saved, ['ana@example.com'], '  ', ADDRESS)).toEqual({ kind: 'unchanged' });
    expect(planMailboxSave(saved, [], '', ADDRESS)).toEqual({ kind: 'save', mailboxes: [] });
    expect(planMailboxSave(saved, null, 'Bo@Example.com', ADDRESS)).toEqual({
      kind: 'save',
      mailboxes: ['ana@example.com', 'bo@example.com'],
    });
    expect(planMailboxSave(saved, [], 'bo@example.com', ADDRESS)).toEqual({ kind: 'save', mailboxes: ['bo@example.com'] });
    expect(planMailboxSave(saved, null, 'not an address', ADDRESS)).toEqual({ kind: 'problem', problem: 'invalid' });
    expect(planMailboxSave(saved, null, 'ana@example.com', ADDRESS)).toEqual({ kind: 'problem', problem: 'duplicate' });
  });

  it('has a message for every problem in English and Spanish', () => {
    const problems: MailboxProblem[] = ['invalid', 'reserved', 'duplicate', 'maxReached'];
    expectDefined(problems.map(mailboxProblemKey));
    expectDefined(['summaries:connect.mailboxes.unsaved']);
  });
});

describe('Gmail confirmation codes', () => {
  it('makes a code prominent only for a listed mailbox, those first', () => {
    const status = {
      mailboxes: ['ana@gmail.com'],
      gmailRequests: [gmailRequest('stranger@gmail.com', '2026-11-12T11:30:00.000Z'), gmailRequest('Ana@Gmail.com')],
    };
    const cards = gmailCards(status);
    expect(cards.map((card) => [card.request.gmailAddress, card.prominent])).toEqual([
      ['Ana@Gmail.com', true],
      ['stranger@gmail.com', false],
    ]);
    expect(gmailCards({ mailboxes: [], gmailRequests: [gmailRequest('ana@gmail.com')] })[0]?.prominent).toBe(false);
    expect(gmailCards({ mailboxes: ['ana@gmail.com'], gmailRequests: [] })).toEqual([]);
  });

  it('waits for a NEW code after the user went to Gmail, for at most SUMMARY_GMAIL_WAIT_MS', () => {
    const old = gmailRequest('ana@gmail.com', '2026-11-12T10:00:00.000Z', '111');
    const before = { ...CONNECTED, gmailRequests: [old] };
    const wait = startGmailWait(before, NOW);
    expect(wait).toEqual({ since: NOW, seen: [gmailRequestKey(old)] });
    expect(gmailWaitActive(wait, before, NOW + 1000)).toBe(true);
    // The same Gmail with a new code ends the wait.
    const renewed = { ...CONNECTED, gmailRequests: [gmailRequest('ana@gmail.com', '2026-11-12T12:01:00.000Z', '222')] };
    expect(gmailWaitActive(wait, renewed, NOW + 1000)).toBe(false);
    expect(gmailWaitActive(wait, before, NOW + SUMMARY_GMAIL_WAIT_MS + 1)).toBe(false);
    expect(gmailWaitActive(null, before, NOW)).toBe(false);
    expect(gmailWaitActive(wait, null, NOW)).toBe(false);
    expect(startGmailWait(null, NOW)).toEqual({ since: NOW, seen: [] });
  });
});

describe('shouldPollStatus', () => {
  it('polls only with an address, while waiting for the first summary or a Gmail code', () => {
    expect(shouldPollStatus(null, true)).toBe(false);
    expect(shouldPollStatus({ ...CONNECTED, enabled: false }, true)).toBe(false);
    expect(shouldPollStatus(AVAILABLE, true)).toBe(false);
    expect(shouldPollStatus(CONNECTED, false)).toBe(true);
    const received = { ...CONNECTED, lastReceivedAt: '2026-11-12T09:00:00.000Z' };
    expect(shouldPollStatus(received, false)).toBe(false);
    expect(shouldPollStatus(received, true)).toBe(true);
  });
});

describe('the Microsoft 365 hint', () => {
  const refusedAt = (iso: string): SummaryStatusResponse => ({
    ...CONNECTED,
    lastRefused: { reason: 'not_from_your_notetaker', at: iso, senderDomain: null },
  });

  it('needs an address in use for 24 hours with nothing ever received', () => {
    const since = new Date(NOW - SUMMARY_MICROSOFT_HINT_AFTER_MS).toISOString();
    expect(showMicrosoftHint(refusedAt(since), NOW)).toBe(true);
    expect(showMicrosoftHint(refusedAt(new Date(NOW - 23 * HOUR).toISOString()), NOW)).toBe(false);
    expect(showMicrosoftHint({ ...refusedAt(since), lastReceivedAt: since }, NOW)).toBe(false);
    expect(showMicrosoftHint({ ...refusedAt(since), address: null }, NOW)).toBe(false);
    expect(showMicrosoftHint(null, NOW)).toBe(false);
    // summaryStatus does not say when the address was created: no mail yet means the age is unknown.
    expect(showMicrosoftHint(CONNECTED, NOW)).toBe(false);
  });

  it('dates the address by the earliest mail that reached it', () => {
    const status = {
      ...refusedAt('2026-11-12T08:00:00.000Z'),
      gmailRequests: [gmailRequest('ana@gmail.com', '2026-11-11T07:00:00.000Z'), gmailRequest('b@gmail.com', 'not a date')],
    };
    expect(addressInUseSince(status)).toBe(Date.parse('2026-11-11T07:00:00.000Z'));
    expect(showMicrosoftHint(status, NOW)).toBe(true);
    expect(addressInUseSince(CONNECTED)).toBeNull();
  });

  it('M11: dates the address by addressCreatedAt first, also with no mail at all (B8)', () => {
    const created = new Date(NOW - SUMMARY_MICROSOFT_HINT_AFTER_MS).toISOString();
    expect(addressInUseSince({ ...CONNECTED, addressCreatedAt: created })).toBe(Date.parse(created));
    expect(showMicrosoftHint({ ...CONNECTED, addressCreatedAt: created }, NOW)).toBe(true);
    expect(showMicrosoftHint({ ...CONNECTED, addressCreatedAt: new Date(NOW - 23 * HOUR).toISOString() }, NOW)).toBe(false);
    // A new address after "Get a new address": an older refusal of the old address does not count.
    const fresh = { ...refusedAt('2026-11-01T08:00:00.000Z'), addressCreatedAt: new Date(NOW - HOUR).toISOString() };
    expect(showMicrosoftHint(fresh, NOW)).toBe(false);
    // null (unknown) or an unreadable value: the M10 fallback.
    expect(addressInUseSince({ ...refusedAt('2026-11-12T08:00:00.000Z'), addressCreatedAt: null })).toBe(Date.parse('2026-11-12T08:00:00.000Z'));
    expect(addressInUseSince({ ...CONNECTED, addressCreatedAt: 'not a date' })).toBeNull();
  });
});

describe('activity and setup texts', () => {
  it('names a refused sender only by a verified domain', () => {
    expect(refusedFromText({ reason: 'changed_after_sending', at: '2026-11-12T08:00:00.000Z', senderDomain: 'notes.example.com' })).toEqual({
      key: 'summaries:common.refusedFrom',
      options: { domain: 'notes.example.com' },
    });
    expect(refusedFromText({ reason: 'not_from_your_notetaker', at: '2026-11-12T08:00:00.000Z', senderDomain: null })).toEqual({
      key: 'summaries:common.refusedFromUnknown',
    });
  });

  it('opens the tab of the first mailbox whose mail service is known', () => {
    expect(defaultSetupTab([])).toBe('gmail');
    expect(defaultSetupTab(['ana@company.com'])).toBe('gmail');
    expect(defaultSetupTab(['ana@company.com', 'ana@hotmail.es'])).toBe('outlook');
    expect(defaultSetupTab(['ana@outlook.com'])).toBe('outlook');
    expect(defaultSetupTab(['ana@live.com.mx'])).toBe('outlook');
    expect(defaultSetupTab(['ana@googlemail.com', 'ana@outlook.com'])).toBe('gmail');
  });

  it('gives every tab fixed https links and defined texts, with administrator steps for Gmail and Outlook', () => {
    for (const tab of SUMMARY_SETUP_TABS) {
      const extras = SUMMARY_SETUP_EXTRAS[tab];
      for (const link of extras.links) expect(link.url).toMatch(/^https:\/\//);
      expectDefined([
        ...extras.links.map((link) => link.labelKey),
        ...(extras.noteKey !== null ? [extras.noteKey] : []),
        ...(extras.adminKey !== null ? [extras.adminKey] : []),
      ]);
    }
    expect(SUMMARY_SETUP_EXTRAS.gmail.adminKey).toBe('summaries:connect.setup.admin.google');
    expect(SUMMARY_SETUP_EXTRAS.outlook.adminKey).toBe(SUMMARY_MICROSOFT_ADMIN_KEY);
    expect(SUMMARY_SETUP_EXTRAS.other.adminKey).toBeNull();
    // Only the Gmail forwarding page leads to a confirmation code.
    expect(SUMMARY_SETUP_TABS.flatMap((tab) => SUMMARY_SETUP_EXTRAS[tab].links.filter((link) => link.waitsForGmailCode))).toHaveLength(1);
    expect(adminMailbox(['ana@example.com', 'bo@example.com'])).toBe('ana@example.com');
    expect(adminMailbox([])).toBeNull();
  });
});

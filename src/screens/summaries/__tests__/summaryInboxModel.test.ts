/**
 * The summary inbox's pure model (M10 section 9): which view shows, what a waiting card carries
 * (never one-tap filing on not_addressed_to_you, at most 3 suggestions), the recent rows and the
 * refused rows (one per day with a count).
 */
import type { SummaryListItem, SummaryStatusResponse, SummarySuggestion } from '../../../core/aiContract';
import { AppError } from '../../../core/errors';
import { summaryAppError } from '../../../services/summaries/summaryCore';
import {
  attachRequestForSuggestion,
  attachTargetForItem,
  fileUnderSuggestions,
  inboxCardModel,
  inboxView,
  recentRowModel,
  refusedDayOf,
  refusedDayRows,
  suggestionKey,
} from '../summaryInboxModel';

const STATUS: SummaryStatusResponse = {
  enabled: true,
  allowed: true,
  ready: true,
  address: 'abcdefghijklmnopqrstuvwxyz@summaries.example.com',
  mailboxes: ['ana@example.com'],
  gmailRequests: [],
  inboxCount: 1,
  lastReceivedAt: null,
  lastRefused: null,
  refusedToday: null,
};

function suggestion(meetingId: string, occurrenceDate: string | null = null, title = 'Urpayroll weekly sync'): SummarySuggestion {
  return { meetingId, occurrenceDate, title, startAt: '2026-11-12T20:00:00.000Z', score: 0.7 };
}

function row(overrides: Partial<SummaryListItem> = {}): SummaryListItem {
  return {
    summaryId: 'a'.repeat(64),
    status: 'inbox',
    title: 'Urpayroll',
    summaryDate: '2026-11-12',
    receivedAt: '2026-11-12T21:20:00.000Z',
    tier: 'vendor_verified',
    recipientBound: true,
    fresh: true,
    inboxReason: 'ambiguous',
    refusedReason: null,
    senderDomain: 'notetaker.example.com',
    count: null,
    match: null,
    suggestions: [suggestion('m1'), suggestion('m2', null, 'Marketing review')],
    ...overrides,
  };
}

function refusedRow(day: string, overrides: Partial<SummaryListItem> = {}): SummaryListItem {
  return row({
    summaryId: `refused-${day}`,
    status: 'refused',
    title: null,
    summaryDate: null,
    receivedAt: `${day}T18:00:00.000Z`,
    tier: null,
    recipientBound: false,
    fresh: false,
    inboxReason: null,
    refusedReason: 'not_from_your_notetaker',
    senderDomain: null,
    count: 2,
    suggestions: [],
    ...overrides,
  });
}

const EMPTY = { items: [] as SummaryListItem[], error: null };
const UNKNOWN = { items: null, error: null };

describe('inboxView', () => {
  it('waits for the status, then for the inbox', () => {
    expect(inboxView({ status: null, statusError: null, waiting: UNKNOWN, recent: UNKNOWN }).view).toBe('loading');
    expect(inboxView({ status: STATUS, statusError: null, waiting: UNKNOWN, recent: UNKNOWN }).view).toBe('loading');
  });

  it('is unavailable when the feature is off, the caller is not in the pilot, or summaryRead is missing', () => {
    expect(inboxView({ status: { ...STATUS, enabled: false }, statusError: null, waiting: UNKNOWN, recent: UNKNOWN }).view).toBe('unavailable');
    expect(inboxView({ status: { ...STATUS, allowed: false }, statusError: null, waiting: UNKNOWN, recent: UNKNOWN }).view).toBe('unavailable');
    // summaryRead not deployed: functions/not-found without details maps to not_enabled.
    const missing = summaryAppError('not_enabled', 'functions/not-found');
    expect(inboxView({ status: STATUS, statusError: null, waiting: { items: null, error: missing }, recent: UNKNOWN }).view).toBe('unavailable');
    expect(inboxView({ status: STATUS, statusError: null, waiting: EMPTY, recent: { items: null, error: summaryAppError('not_allowed') } }).view).toBe(
      'unavailable',
    );
  });

  it('shows an error with nothing to show, and keeps the content when only the recent list failed', () => {
    const offline = new AppError('offline');
    expect(inboxView({ status: null, statusError: offline, waiting: UNKNOWN, recent: UNKNOWN })).toEqual({ view: 'error', error: offline });
    expect(inboxView({ status: STATUS, statusError: null, waiting: { items: null, error: offline }, recent: UNKNOWN })).toEqual({
      view: 'error',
      error: offline,
    });
    expect(inboxView({ status: STATUS, statusError: null, waiting: EMPTY, recent: { items: null, error: offline } }).view).toBe('content');
  });

  it('is empty only when nothing waits and nothing was filed', () => {
    expect(inboxView({ status: STATUS, statusError: null, waiting: EMPTY, recent: UNKNOWN }).view).toBe('loading');
    expect(inboxView({ status: STATUS, statusError: null, waiting: EMPTY, recent: EMPTY }).view).toBe('empty');
    expect(inboxView({ status: STATUS, statusError: null, waiting: EMPTY, recent: { items: [row({ status: 'kept' })], error: null } }).view).toBe(
      'content',
    );
    expect(inboxView({ status: STATUS, statusError: null, waiting: { items: [row()], error: null }, recent: UNKNOWN }).view).toBe('content');
  });
});

describe('waiting cards', () => {
  it('carries the title, dates, chip, reason and the suggestions', () => {
    const card = inboxCardModel(row());
    expect(card).toMatchObject({
      title: 'Urpayroll',
      summaryDate: '2026-11-12',
      chipKey: 'summaries:common.chip.vendor_verified',
      reasonKey: 'summaries:common.inboxReason.ambiguous',
      showNoSuggestionsNote: false,
    });
    expect(card.suggestions.map((entry) => entry.meetingId)).toEqual(['m1', 'm2']);
    expect(inboxCardModel(row({ title: '  ' })).title).toBeNull();
    expect(inboxCardModel(row({ tier: 'user_forwarded' })).chipKey).toBe('summaries:common.chip.user_forwarded');
  });

  it('never offers one-tap filing on a not_addressed_to_you card and says why', () => {
    const card = inboxCardModel(row({ inboxReason: 'not_addressed_to_you' }));
    expect(card.suggestions).toEqual([]);
    expect(card.showNoSuggestionsNote).toBe(true);
  });

  it('shows at most 3 suggestions and never the same meeting occurrence twice', () => {
    const many = [suggestion('m1'), suggestion('m1'), suggestion('s', '2026-11-05'), suggestion('s', '2026-11-12'), suggestion('m4'), suggestion('m5')];
    expect(fileUnderSuggestions({ inboxReason: 'weak', suggestions: many }).map(suggestionKey)).toEqual(['m1|', 's|2026-11-05', 's|2026-11-12']);
  });

  it('files a suggestion under the master id with its original date, and opens the sheet in file mode', () => {
    expect(attachRequestForSuggestion('x1', suggestion('series', '2026-11-12'))).toEqual({
      summaryId: 'x1',
      meetingId: 'series',
      occurrenceDate: '2026-11-12',
    });
    expect(attachTargetForItem(row())).toEqual({
      summaryId: 'a'.repeat(64),
      summaryDate: '2026-11-12',
      receivedAt: '2026-11-12T21:20:00.000Z',
      mode: 'file',
      currentMeetingId: null,
    });
  });
});

describe('recent rows', () => {
  it('says where a filed summary went, or that it was kept', () => {
    const matched = row({
      status: 'matched',
      inboxReason: null,
      suggestions: [],
      match: {
        meetingId: 'm1',
        occurrenceDate: null,
        method: 'auto',
        meetingSnapshot: { title: 'Urpayroll weekly sync', startAt: '2026-11-12T20:00:00.000Z', endAt: '2026-11-12T21:00:00.000Z', timezone: 'UTC' },
      },
    });
    expect(recentRowModel(matched)).toMatchObject({ filedUnder: 'Urpayroll weekly sync', kept: false });
    expect(recentRowModel(row({ status: 'kept', inboxReason: null, suggestions: [] }))).toMatchObject({ filedUnder: null, kept: true });
  });
});

describe('refused rows', () => {
  it('reads the day from the row id, else from the latest refusal time', () => {
    expect(refusedDayOf({ summaryId: 'refused-2026-11-10', receivedAt: '2026-11-11T01:00:00.000Z' })).toBe('2026-11-10');
    expect(refusedDayOf({ summaryId: 'other', receivedAt: '2026-11-11T01:00:00.000Z' })).toBe('2026-11-11');
    expect(refusedDayOf({ summaryId: 'other', receivedAt: 'nope' })).toBeNull();
  });

  it('gives one row per day, newest first, with the count, reason and sender', () => {
    const rows = refusedDayRows([
      refusedRow('2026-11-10', { count: 3, refusedReason: 'changed_after_sending', senderDomain: 'notetaker.example.com' }),
      refusedRow('2026-11-12'),
      row(),
    ]);
    expect(rows).toEqual([
      { day: '2026-11-12', count: 2, reason: 'not_from_your_notetaker', senderDomain: null },
      { day: '2026-11-10', count: 3, reason: 'changed_after_sending', senderDomain: 'notetaker.example.com' },
    ]);
  });

  it('merges rows that share a day, keeping the newest reason', () => {
    const rows = refusedDayRows([
      refusedRow('2026-11-12', { summaryId: 'x', receivedAt: '2026-11-12T08:00:00.000Z', count: 1, refusedReason: 'malformed' }),
      refusedRow('2026-11-12', { summaryId: 'y', receivedAt: '2026-11-12T20:00:00.000Z', count: 4, refusedReason: 'too_large' }),
    ]);
    expect(rows).toEqual([{ day: '2026-11-12', count: 5, reason: 'too_large', senderDomain: null }]);
  });
});

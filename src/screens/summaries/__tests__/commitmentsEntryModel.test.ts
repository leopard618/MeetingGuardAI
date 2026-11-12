/**
 * The "Review commitments" entry points (M11 section 3.1): offered only while the feature is on
 * for the account and only for a filed or kept summary; the open count of a ready list on the
 * button; the state words and the added count on the facts line; beside Debrief, the newest filed
 * summary.
 */
import type { SummaryListCommitments, SummaryListItem } from '../../../core/aiContract';
import {
  canReviewCommitments,
  commitmentsEntryFacts,
  commitmentsEntryFor,
  commitmentsEntryLabel,
  meetingCommitmentsEntry,
} from '../commitmentsEntryModel';

const ID_A = 'a'.repeat(64);
const ID_B = 'b'.repeat(64);

const ROW: SummaryListItem = {
  summaryId: ID_A,
  status: 'matched',
  title: 'Urpayroll launch sync',
  summaryDate: '2026-10-16',
  receivedAt: '2026-10-16T20:20:00.000Z',
  tier: 'vendor_verified',
  recipientBound: true,
  fresh: true,
  inboxReason: null,
  refusedReason: null,
  senderDomain: 'notes.example.com',
  count: null,
  match: {
    meetingId: 'm1',
    occurrenceDate: null,
    method: 'auto',
    meetingSnapshot: { title: 'Weekly sync', startAt: '2026-10-16T19:00:00.000Z', endAt: '2026-10-16T20:00:00.000Z', timezone: 'UTC' },
  },
  suggestions: [],
};

function facts(state: SummaryListCommitments['state'], open: number, accepted: number): SummaryListCommitments {
  return { state, open, accepted };
}

describe('canReviewCommitments', () => {
  it('needs the feature on and a filed or kept summary', () => {
    expect(canReviewCommitments({ status: 'matched' }, true)).toBe(true);
    expect(canReviewCommitments({ status: 'kept' }, true)).toBe(true);
    expect(canReviewCommitments({ status: 'inbox' }, true)).toBe(false);
    expect(canReviewCommitments({ status: 'refused' }, true)).toBe(false);
    expect(canReviewCommitments({ status: 'matched' }, false)).toBe(false);
  });
});

describe('commitmentsEntryLabel', () => {
  it('shows the open count of a ready list only', () => {
    expect(commitmentsEntryLabel(undefined)).toEqual({ key: 'summaries:commitments.entry.review' });
    expect(commitmentsEntryLabel(facts('ready', 5, 2))).toEqual({ key: 'summaries:commitments.entry.reviewCount', params: { count: 5 } });
    expect(commitmentsEntryLabel(facts('ready', 0, 3))).toEqual({ key: 'summaries:commitments.entry.review' });
    // A stale list is read-only until prepared again: no count to act on.
    expect(commitmentsEntryLabel(facts('stale', 4, 0))).toEqual({ key: 'summaries:commitments.entry.review' });
    expect(commitmentsEntryLabel(facts('none', 0, 0))).toEqual({ key: 'summaries:commitments.entry.review' });
  });
});

describe('commitmentsEntryFacts', () => {
  it('says nothing before the first preparation', () => {
    expect(commitmentsEntryFacts(undefined)).toEqual([]);
    expect(commitmentsEntryFacts(facts('none', 0, 0))).toEqual([]);
    expect(commitmentsEntryFacts(facts('ready', 3, 0))).toEqual([]);
  });

  it('names the state when it needs a word, then the added count', () => {
    expect(commitmentsEntryFacts(facts('preparing', 0, 0))).toEqual([{ key: 'summaries:commitments.entry.preparing' }]);
    expect(commitmentsEntryFacts(facts('empty', 0, 0))).toEqual([{ key: 'summaries:commitments.entry.empty' }]);
    expect(commitmentsEntryFacts(facts('stale', 1, 2))).toEqual([
      { key: 'summaries:commitments.entry.stale' },
      { key: 'summaries:commitments.entry.added', params: { count: 2 } },
    ]);
    expect(commitmentsEntryFacts(facts('ready', 3, 2))).toEqual([{ key: 'summaries:commitments.entry.added', params: { count: 2 } }]);
  });
});

describe('commitmentsEntryFor', () => {
  it('builds the entry of a filed summary, or none', () => {
    expect(commitmentsEntryFor({ ...ROW, commitments: facts('ready', 3, 2) }, true)).toEqual({
      summaryId: ID_A,
      label: { key: 'summaries:commitments.entry.reviewCount', params: { count: 3 } },
      facts: [{ key: 'summaries:commitments.entry.added', params: { count: 2 } }],
    });
    const inbox: SummaryListItem = { ...ROW, status: 'inbox', match: null };
    expect(commitmentsEntryFor(inbox, true)).toBeNull();
    expect(commitmentsEntryFor(ROW, false)).toBeNull();
  });
});

describe('meetingCommitmentsEntry', () => {
  it('targets the newest filed summary (rows come newest first)', () => {
    const older: SummaryListItem = { ...ROW, summaryId: ID_B, receivedAt: '2026-10-09T20:20:00.000Z' };
    expect(meetingCommitmentsEntry([ROW, older], true)?.summaryId).toBe(ID_A);
    expect(meetingCommitmentsEntry([{ ...ROW, status: 'inbox', match: null }, older], true)?.summaryId).toBe(ID_B);
  });

  it('offers nothing without rows or while the feature is off', () => {
    expect(meetingCommitmentsEntry(null, true)).toBeNull();
    expect(meetingCommitmentsEntry([], true)).toBeNull();
    expect(meetingCommitmentsEntry([ROW], false)).toBeNull();
  });
});

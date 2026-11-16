/**
 * The pure model of the commitments review screen (M11, docs/v2/M11-DESIGN.md sections 3, 8, 11
 * and 16): the screen states, the origin block and banners, pre-selection (payment-like,
 * instruction-like and owner guesses never ticked; no Select all on a summary sent to someone
 * else), the footer labels, the default reminders in the task zone (DST changes, 23:30 in Mexico
 * City, next Monday), the defaults of a stated date, the decide request built at the tap, the
 * feedback said only from the results, and the card lines.
 */
import type {
  CommitmentDecisionResult,
  CommitmentItem,
  SummaryCommitments,
  SummaryStatusResponse,
} from '../../../core/aiContract';
import { AppError } from '../../../core/errors';
import { commitmentAppError } from '../../../services/summaries/commitmentsCore';
import { SUMMARIES_DISABLED_STATUS, summaryAppError } from '../../../services/summaries/summaryCore';
import {
  bannerRefs,
  buildAcceptDecisions,
  commitmentCardView,
  commitmentsFooter,
  commitmentsPhase,
  decideErrorKey,
  decideFeedback,
  defaultSchedule,
  draftFor,
  dueRefs,
  hasOpenEdits,
  headerRefs,
  initialSelection,
  isPickedDefaultPast,
  isStillPreparingError,
  needsReminderDefault,
  originText,
  prepareAgainMode,
  quotaLines,
  reconcileSelection,
  reminderChoiceRef,
  reminderGroupRef,
  reminderSlot,
  selectAllAnchors,
  slotInstant,
  startsSelected,
  summaryKeptUntil,
  toggleSelection,
  type CommitmentsPhaseInput,
  type WallClockLabels,
} from '../summaryCommitmentsModel';

const KEY = 'x_0123456789abcdef';
const LABELS: WallClockLabels = { date: (date) => `D(${date})`, time: (time) => `T(${time})` };

let anchorCounter = 0;
function anchor(): string {
  anchorCounter += 1;
  return `i_${anchorCounter.toString(16).padStart(12, '0')}`;
}

function item(overrides: Partial<CommitmentItem> = {}): CommitmentItem {
  return {
    anchorId: anchor(),
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

function list(items: CommitmentItem[], overrides: Partial<SummaryCommitments> = {}): SummaryCommitments {
  return {
    key: KEY,
    mode: 'ai',
    preparedAt: '2026-11-12T10:00:00.000Z',
    preselect: { allowed: true, selectAll: true, reason: null },
    origin: {
      meetingId: 'mtgUrpayroll01',
      meetingTitle: 'Urpayroll weekly sync',
      occurrenceDate: null,
      localDate: '2026-10-16',
      tier: 'vendor_verified',
      senderDomain: 'notetaker.example',
      forwardedBy: null,
    },
    truncated: false,
    meetingChanged: false,
    items,
    ...overrides,
  };
}

const STATUS: SummaryStatusResponse = { ...SUMMARIES_DISABLED_STATUS, enabled: true, allowed: true, ready: true };

function phaseInput(overrides: Partial<CommitmentsPhaseInput> = {}): CommitmentsPhaseInput {
  return {
    status: STATUS,
    statusError: null,
    hookState: 'ready',
    data: list([item()]),
    error: null,
    busy: null,
    summaryStatus: 'matched',
    summaryError: null,
    summaryLoading: false,
    summaryChecked: false,
    ...overrides,
  };
}

describe('screen state', () => {
  it('waits for the status, then shows nothing unless enabled and allowed', () => {
    expect(commitmentsPhase(phaseInput({ status: null }))).toBe('loading');
    expect(commitmentsPhase(phaseInput({ status: null, statusError: new AppError('offline') }))).toBe('statusError');
    expect(commitmentsPhase(phaseInput({ status: { ...STATUS, allowed: false } }))).toBe('unavailable');
    // summaryCommitments not deployed (functions/not-found) reads as not_enabled.
    expect(commitmentsPhase(phaseInput({ error: commitmentAppError('not_enabled', 'functions/not-found') }))).toBe('unavailable');
    expect(commitmentsPhase(phaseInput({ error: commitmentAppError('not_allowed') }))).toBe('unavailable');
  });

  it('says an inbox summary must be filed first, and a deleted one is gone', () => {
    expect(commitmentsPhase(phaseInput({ summaryStatus: 'inbox', error: commitmentAppError('not_found') }))).toBe('notFiled');
    expect(commitmentsPhase(phaseInput({ data: null, hookState: 'error', error: commitmentAppError('not_found'), summaryChecked: true }))).toBe('gone');
    expect(commitmentsPhase(phaseInput({ summaryError: summaryAppError('not_found') }))).toBe('gone');
  });

  it('waits for summaryRead before a commitments not_found reads as gone (it may be back in the inbox)', () => {
    const notFound = { data: null, hookState: 'error' as const, error: commitmentAppError('not_found') };
    // The cached copy still says filed, or nothing is cached yet: summaryRead decides.
    expect(commitmentsPhase(phaseInput(notFound))).toBe('loading');
    expect(commitmentsPhase(phaseInput({ ...notFound, summaryStatus: null, summaryLoading: true }))).toBe('loading');
    expect(commitmentsPhase(phaseInput({ ...notFound, summaryStatus: 'inbox', summaryChecked: true }))).toBe('notFiled');
    expect(commitmentsPhase(phaseInput({ ...notFound, summaryChecked: true }))).toBe('gone');
  });

  it('is gone once summaryRead answered and its copy was dropped (deleted on this phone), never a spinner', () => {
    // Disconnect and delete on a screen above cleared both caches: the hook says loading again.
    expect(commitmentsPhase(phaseInput({ hookState: 'loading', data: null, summaryStatus: null }))).toBe('gone');
    // The first summaryRead get is still in flight: wait.
    expect(commitmentsPhase(phaseInput({ hookState: 'loading', data: null, summaryStatus: null, summaryLoading: true }))).toBe('loading');
    // summaryRead failed for another reason: not gone.
    expect(commitmentsPhase(phaseInput({ summaryStatus: null, summaryError: new AppError('offline') }))).toBe('list');
  });

  it('maps the hook states', () => {
    expect(commitmentsPhase(phaseInput({ hookState: 'loading', data: null }))).toBe('loading');
    expect(commitmentsPhase(phaseInput({ hookState: 'error', data: null, error: new AppError('offline') }))).toBe('error');
    expect(commitmentsPhase(phaseInput({ hookState: 'none', data: null }))).toBe('none');
    expect(commitmentsPhase(phaseInput({ hookState: 'none', data: null, busy: 'prepare' }))).toBe('preparingSelf');
    expect(commitmentsPhase(phaseInput({ hookState: 'preparing', data: null }))).toBe('preparing');
    expect(commitmentsPhase(phaseInput({ hookState: 'empty', data: list([]) }))).toBe('empty');
    expect(commitmentsPhase(phaseInput({ hookState: 'stale', data: list([item()]) }))).toBe('list');
    // Stale with no list: the text changed; Prepare again.
    expect(commitmentsPhase(phaseInput({ hookState: 'stale', data: null }))).toBe('staleNoList');
  });

  it('shows the quota card when the allowance is used up and no list is shown', () => {
    const quota = commitmentAppError('quota_exceeded', null, { used: 10, limit: 10, plan: 'free', resetsAt: '2026-11-13T00:00:00.000Z' });
    expect(commitmentsPhase(phaseInput({ hookState: 'none', data: null, error: quota }))).toBe('quota');
    expect(commitmentsPhase(phaseInput({ hookState: 'ready', error: quota }))).toBe('list');
    expect(quotaLines(quota, (iso) => `at ${iso}`)).toEqual([
      { key: 'summaries:commitments.quota.body' },
      { key: 'summaries:commitments.quota.resets', params: { time: 'at 2026-11-13T00:00:00.000Z' } },
    ]);
    const subscription = commitmentAppError('quota_exceeded', null, {
      used: 10,
      limit: 10,
      plan: 'free',
      resetsAt: '2026-11-13T00:00:00.000Z',
      subscriptionRequired: true,
    });
    expect(quotaLines(subscription, () => 'x')).toEqual([{ key: 'summaries:commitments.quota.body' }]);
    expect(quotaLines(new AppError('offline'), () => 'x')).toBeNull();
  });

  it('knows when the polls gave up while another device prepares', () => {
    expect(isStillPreparingError(new AppError('timeout', 'x', { details: { preparing: true } }))).toBe(true);
    expect(isStillPreparingError(new AppError('timeout'))).toBe(false);
    expect(prepareAgainMode(null)).toBe('as_written');
    expect(prepareAgainMode('ai')).toBe('ai');
  });
});

describe('origin block and banners', () => {
  const date = (localDate: string) => `<${localDate}>`;

  it('names the meeting and date, always with the two fixed notes', () => {
    expect(originText(list([]), date)).toEqual({
      source: { key: 'summaries:commitments.origin.suggested.meeting', params: { meeting: 'Urpayroll weekly sync', date: '<2026-10-16>' } },
      notes: [{ key: 'summaries:commitments.origin.notAttended' }, { key: 'summaries:commitments.origin.aiWritten' }],
    });
    const asWritten = originText(list([], { mode: 'as_written' }), date);
    expect(asWritten.source.key).toBe('summaries:commitments.origin.asWritten.meeting');
    expect(asWritten.notes[1]).toEqual({ key: 'summaries:commitments.origin.asWrittenLine' });
  });

  it('uses the occurrence date of a series, and the kept, forwarded and not-addressed variants', () => {
    const base = list([]);
    expect(originText({ ...base, origin: { ...base.origin, occurrenceDate: '2026-10-23' } }, date).source.params).toEqual({
      meeting: 'Urpayroll weekly sync',
      date: '<2026-10-23>',
    });
    expect(originText({ ...base, origin: { ...base.origin, meetingTitle: null, meetingId: null } }, date).source).toEqual({
      key: 'summaries:commitments.origin.suggested.kept',
      params: { date: '<2026-10-16>' },
    });
    expect(originText({ ...base, origin: { ...base.origin, meetingTitle: null, localDate: null } }, date).source.key).toBe(
      'summaries:commitments.origin.suggested.keptNoDate',
    );
    expect(originText({ ...base, origin: { ...base.origin, tier: 'user_forwarded', forwardedBy: 'ana@example.com' } }, date).source).toEqual({
      key: 'summaries:commitments.origin.suggested.forwarded',
      params: { address: 'ana@example.com' },
    });
    expect(originText({ ...base, preselect: { allowed: false, selectAll: false, reason: 'not_addressed_to_you' } }, date).source.key).toBe(
      'summaries:commitments.origin.suggested.notAddressed',
    );
  });

  it('gives one banner per reason, plus truncated and meeting changed', () => {
    const base = list([]);
    expect(bannerRefs(base)).toEqual([]);
    expect(bannerRefs({ ...base, preselect: { allowed: false, selectAll: true, reason: 'old_summary' } })).toEqual([
      { key: 'summaries:commitments.banner.old_summary' },
    ]);
    expect(
      bannerRefs({
        ...base,
        preselect: { allowed: false, selectAll: true, reason: 'forwarded' },
        origin: { ...base.origin, forwardedBy: 'ana@example.com' },
        truncated: true,
        meetingChanged: true,
      }),
    ).toEqual([
      { key: 'summaries:commitments.banner.forwarded', params: { address: 'ana@example.com' } },
      { key: 'summaries:commitments.banner.truncated' },
      { key: 'summaries:commitments.banner.meetingChanged' },
    ]);
    expect(bannerRefs({ ...base, preselect: { allowed: false, selectAll: false, reason: 'not_addressed_to_you' } })[0]?.key).toBe(
      'summaries:commitments.banner.not_addressed_to_you',
    );
    expect(bannerRefs({ ...base, preselect: { allowed: false, selectAll: true, reason: 'possible_instruction' } })[0]?.key).toBe(
      'summaries:commitments.banner.possible_instruction',
    );
  });

  it('counts suggestions, open ones and added ones', () => {
    expect(headerRefs(list([item(), item(), item({ status: 'accepted', taskId: 'sm_0123456789abcdef0123456789abcdef', taskExists: true })]))).toEqual([
      { key: 'summaries:commitments.header.count', params: { count: 3 } },
      { key: 'summaries:commitments.header.open', params: { count: 2 } },
      { key: 'summaries:commitments.header.added', params: { count: 1 } },
    ]);
  });
});

describe('default reminders in the task zone', () => {
  it('is tomorrow 9:00 on the wall clock across the spring DST change (New York)', () => {
    const now = new Date('2026-03-07T17:00:00.000Z'); // Saturday 12:00 EST
    const slot = reminderSlot({ kind: 'tomorrow' }, now, 'America/New_York');
    expect(slot).toEqual({ date: '2026-03-08', time: '09:00' });
    // 9:00 EDT (UTC-4) on the day the clocks go forward, not 24 hours after 9:00 EST.
    expect(slotInstant(slot!, 'America/New_York')).toBe('2026-03-08T13:00:00.000Z');
  });

  it('is tomorrow 9:00 across the autumn DST change (Madrid)', () => {
    const now = new Date('2026-10-24T20:00:00.000Z'); // Saturday 22:00 CEST
    const slot = reminderSlot({ kind: 'tomorrow' }, now, 'Europe/Madrid');
    expect(slot).toEqual({ date: '2026-10-25', time: '09:00' });
    expect(slotInstant(slot!, 'Europe/Madrid')).toBe('2026-10-25T08:00:00.000Z');
    expect(slotInstant(reminderSlot({ kind: 'dayAfter' }, now, 'Europe/Madrid')!, 'Europe/Madrid')).toBe('2026-10-26T08:00:00.000Z');
  });

  it('counts "tomorrow" from the LOCAL date: 23:30 in Mexico City is one day ahead, not two', () => {
    const now = new Date('2026-11-12T05:30:00.000Z'); // Nov 11, 23:30 in Mexico City
    expect(reminderSlot({ kind: 'tomorrow' }, now, 'America/Mexico_City')).toEqual({ date: '2026-11-12', time: '09:00' });
    expect(slotInstant({ date: '2026-11-12', time: '09:00' }, 'America/Mexico_City')).toBe('2026-11-12T15:00:00.000Z');
    // The same instant in UTC is already Nov 12.
    expect(reminderSlot({ kind: 'tomorrow' }, now, 'UTC')).toEqual({ date: '2026-11-13', time: '09:00' });
  });

  it('is recomputed at the tap: a screen left open past midnight moves with the day', () => {
    const before = new Date('2026-11-12T22:59:00.000Z'); // 23:59 in Madrid
    const after = new Date('2026-11-12T23:01:00.000Z'); // 00:01 the next day in Madrid
    expect(reminderSlot({ kind: 'tomorrow' }, before, 'Europe/Madrid')?.date).toBe('2026-11-13');
    expect(reminderSlot({ kind: 'tomorrow' }, after, 'Europe/Madrid')?.date).toBe('2026-11-14');
  });

  it('finds next Monday (a week ahead on a Monday, tomorrow on a Sunday)', () => {
    expect(reminderSlot({ kind: 'nextMonday' }, new Date('2026-11-12T12:00:00.000Z'), 'UTC')?.date).toBe('2026-11-16'); // Thursday
    expect(reminderSlot({ kind: 'nextMonday' }, new Date('2026-11-16T12:00:00.000Z'), 'UTC')?.date).toBe('2026-11-23'); // Monday
    expect(reminderSlot({ kind: 'nextMonday' }, new Date('2026-11-15T12:00:00.000Z'), 'UTC')?.date).toBe('2026-11-16'); // Sunday
  });

  it('keeps a picked date and time, and no slot for No reminder', () => {
    const now = new Date('2026-11-12T12:00:00.000Z');
    expect(reminderSlot({ kind: 'picked', date: '2026-11-20', time: '15:30' }, now, 'UTC')).toEqual({ date: '2026-11-20', time: '15:30' });
    expect(reminderSlot({ kind: 'none' }, now, 'UTC')).toBeNull();
    expect(isPickedDefaultPast({ kind: 'picked', date: '2026-11-12', time: '11:59' }, now, 'UTC')).toBe(true);
    expect(isPickedDefaultPast({ kind: 'picked', date: '2026-11-12', time: '12:01' }, now, 'UTC')).toBe(false);
    expect(isPickedDefaultPast({ kind: 'tomorrow' }, now, 'UTC')).toBe(false);
  });

  it('labels the choices with the user clock', () => {
    expect(reminderChoiceRef({ kind: 'tomorrow' }, LABELS)).toEqual({ key: 'summaries:commitments.reminder.choice.tomorrow', params: { time: 'T(09:00)' } });
    expect(reminderChoiceRef({ kind: 'picked', date: '2026-11-20', time: '15:30' }, LABELS)).toEqual({
      key: 'summaries:commitments.reminder.choice.picked',
      params: { date: 'D(2026-11-20)', time: 'T(15:30)' },
    });
    expect(reminderChoiceRef({ kind: 'none' }, LABELS)).toEqual({ key: 'summaries:commitments.reminder.choice.none' });
  });
});

describe('schedule before any edit (section 3.4)', () => {
  const now = new Date('2026-11-12T12:00:00.000Z');

  it('no date: the default reminder at its time, or nothing', () => {
    expect(defaultSchedule(null, { kind: 'tomorrow' }, now, 'UTC')).toEqual({ dueDate: '2026-11-13', dueTime: '09:00', reminderMinutesBefore: 0 });
    expect(defaultSchedule(null, { kind: 'none' }, now, 'UTC')).toEqual({ dueDate: null, dueTime: null, reminderMinutesBefore: null });
  });

  it('a stated date only: 9:00 that day at the time, or the date alone once 9:00 has passed', () => {
    const due = { date: '2026-11-14', time: null, zone: null, quote: 'by Saturday', overdue: false };
    expect(defaultSchedule(due, { kind: 'none' }, now, 'UTC')).toEqual({ dueDate: '2026-11-14', dueTime: '09:00', reminderMinutesBefore: 0 });
    expect(defaultSchedule({ ...due, date: '2026-11-12' }, { kind: 'tomorrow' }, now, 'UTC')).toEqual({
      dueDate: '2026-11-12',
      dueTime: null,
      reminderMinutesBefore: null,
    });
  });

  it('a stated time keeps the meeting zone: 60 minutes before, at the time when closer, none when past', () => {
    const due = { date: '2026-11-12', time: '17:00', zone: 'Europe/Madrid', quote: 'by 17:00', overdue: false };
    // 17:00 Madrid is 16:00 UTC, four hours ahead.
    expect(defaultSchedule(due, { kind: 'tomorrow' }, now, 'America/Mexico_City')).toEqual({
      dueDate: '2026-11-12',
      dueTime: '17:00',
      reminderMinutesBefore: 60,
    });
    expect(defaultSchedule(due, { kind: 'tomorrow' }, new Date('2026-11-12T15:30:00.000Z'), 'UTC').reminderMinutesBefore).toBe(0);
    expect(defaultSchedule(due, { kind: 'tomorrow' }, new Date('2026-11-12T16:30:00.000Z'), 'UTC').reminderMinutesBefore).toBeNull();
  });

  it('a stated due today whose time has passed keeps the date and sets no reminder', () => {
    const dateOnly = { date: '2026-11-12', time: null, zone: null, quote: 'today', overdue: false };
    expect(defaultSchedule(dateOnly, { kind: 'tomorrow' }, now, 'UTC').reminderMinutesBefore).toBeNull();
    expect(defaultSchedule(dateOnly, { kind: 'tomorrow' }, new Date('2026-11-12T07:00:00.000Z'), 'UTC').reminderMinutesBefore).toBe(0);
  });

  it('a stated date already past is overdue: the date kept, no reminder', () => {
    const due = { date: '2026-11-10', time: null, zone: null, quote: 'by Tuesday', overdue: false };
    expect(defaultSchedule(due, { kind: 'tomorrow' }, now, 'UTC')).toEqual({ dueDate: '2026-11-10', dueTime: null, reminderMinutesBefore: null });
    expect(defaultSchedule({ ...due, date: '2026-11-20', overdue: true }, { kind: 'tomorrow' }, now, 'UTC').reminderMinutesBefore).toBeNull();
  });
});

describe('selection and footer', () => {
  it('never pre-selects payment-like, instruction-like or owner guesses, even when the server did', () => {
    const plain = item();
    const payment = item({ flags: ['payment_like'] });
    const instruction = item({ flags: ['possible_instruction'] });
    const guess = item({ owner: { name: 'Francisco', isUser: true, guess: true }, flags: ['owner_guess'], title: 'Send the contract' });
    const unticked = item({ preselected: false });
    const accepted = item({ status: 'accepted', taskId: 'sm_0123456789abcdef0123456789abcdef', taskExists: true });
    const commitments = list([plain, payment, instruction, guess, unticked, accepted]);
    expect([plain, payment, instruction, guess].map(startsSelected)).toEqual([true, false, false, false]);
    expect(initialSelection(commitments, false)).toEqual([plain.anchorId]);
    expect(initialSelection(commitments, true)).toEqual([]);
    // Select all: every open one but instruction-like and guesses.
    expect(selectAllAnchors(commitments)).toEqual([plain.anchorId, payment.anchorId, unticked.anchorId]);
  });

  it('offers no Select all on a summary not sent to the user', () => {
    const commitments = list([item({ preselected: false })], { preselect: { allowed: false, selectAll: false, reason: 'not_addressed_to_you' } });
    expect(selectAllAnchors(commitments)).toEqual([]);
    expect(commitmentsFooter({ commitments, selection: [], offline: false })?.showSelectAll).toBe(false);
  });

  it('keeps only suggestions still open after an answer; toggles', () => {
    const a = item();
    const b = item({ status: 'accepted', taskId: 'sm_0123456789abcdef0123456789abcdef', taskExists: true });
    expect(reconcileSelection([a.anchorId, b.anchorId, 'i_ffffffffffff'], list([a, b]), false)).toEqual([a.anchorId]);
    expect(reconcileSelection([a.anchorId], list([a]), true)).toEqual([]);
    expect(toggleSelection([a.anchorId], a.anchorId)).toEqual([]);
    expect(toggleSelection([], a.anchorId)).toEqual([a.anchorId]);
  });

  it('says "Accept all (N)" when every open one is ticked, "Add N selected" otherwise, and is disabled offline', () => {
    const a = item();
    const b = item();
    const commitments = list([a, b]);
    expect(commitmentsFooter({ commitments, selection: [a.anchorId, b.anchorId], offline: false })).toEqual({
      label: { key: 'summaries:commitments.footer.acceptAll', params: { count: 2 } },
      count: 2,
      enabled: true,
      hint: null,
      showSelectAll: false,
      showClear: true,
    });
    const one = commitmentsFooter({ commitments, selection: [a.anchorId], offline: false });
    expect(one?.label).toEqual({ key: 'summaries:commitments.footer.acceptSelected', params: { count: 1 } });
    expect(one?.showSelectAll).toBe(true);
    const none = commitmentsFooter({ commitments, selection: [], offline: false });
    expect(none?.enabled).toBe(false);
    expect(none?.hint).toEqual({ key: 'summaries:commitments.footer.nothingSelected' });
    const offline = commitmentsFooter({ commitments, selection: [a.anchorId], offline: true });
    expect(offline?.enabled).toBe(false);
    expect(offline?.hint).toEqual({ key: 'summaries:commitments.footer.offline' });
    expect(commitmentsFooter({ commitments: list([item({ status: 'dropped' })]), selection: [], offline: false })).toBeNull();
  });

  it('announces several reminders at the same default time', () => {
    const a = item();
    const b = item();
    const dated = item({ due: { date: '2026-11-20', time: null, zone: null, quote: null, overdue: false } });
    const commitments = list([a, b, dated]);
    const all = [a.anchorId, b.anchorId, dated.anchorId];
    expect(reminderGroupRef(commitments, all, {}, { kind: 'tomorrow' }, LABELS)).toEqual({
      key: 'summaries:commitments.reminder.group.tomorrow',
      params: { count: 2, time: 'T(09:00)' },
    });
    expect(reminderGroupRef(commitments, [a.anchorId], {}, { kind: 'tomorrow' }, LABELS)).toBeNull();
    // An item with its own schedule does not share the default.
    const edited = { [b.anchorId]: { schedule: { dueDate: '2026-11-21', dueTime: null, reminderMinutesBefore: null } } };
    expect(reminderGroupRef(commitments, all, edited, { kind: 'tomorrow' }, LABELS)).toBeNull();
    expect(reminderGroupRef(commitments, all, {}, { kind: 'none' }, LABELS)).toEqual({ key: 'summaries:commitments.reminder.group.none', params: { count: 2 } });
    expect(reminderGroupRef(commitments, all, {}, { kind: 'picked', date: '2026-11-20', time: '15:00' }, LABELS)).toEqual({
      key: 'summaries:commitments.reminder.group.picked',
      params: { count: 2, date: 'D(2026-11-20)', time: 'T(15:00)' },
    });
    expect(needsReminderDefault(commitments)).toBe(true);
    expect(needsReminderDefault(list([dated]))).toBe(false);
  });
});

describe('the decide request', () => {
  const now = new Date('2026-11-12T12:00:00.000Z');

  it('builds one accept per selected open suggestion with its draft, computed at the tap', () => {
    const bish = item();
    const mine = item({ owner: { name: 'Francisco Gomez', isUser: true, guess: false }, title: 'Send the contract' });
    const nobody = item({ owner: null, title: 'Book the room', due: { date: '2026-11-14', time: null, zone: null, quote: 'Saturday', overdue: false } });
    const dropped = item({ status: 'dropped' });
    const built = buildAcceptDecisions({
      items: [bish, mine, nobody, dropped],
      anchors: [bish.anchorId, mine.anchorId, nobody.anchorId, dropped.anchorId],
      edits: {},
      choice: { kind: 'tomorrow' },
      now,
      deviceZone: 'UTC',
    });
    expect(built).toEqual({
      ok: true,
      decisions: [
        {
          anchorId: bish.anchorId,
          decision: 'accept',
          draft: {
            title: 'Bish: Provide APK access/files to Urpayroll',
            dueDate: '2026-11-13',
            dueTime: '09:00',
            reminderMinutesBefore: 0,
            owner: { name: 'Bish', isUser: false },
          },
        },
        {
          anchorId: mine.anchorId,
          decision: 'accept',
          draft: { title: 'Send the contract', dueDate: '2026-11-13', dueTime: '09:00', reminderMinutesBefore: 0, owner: { name: 'Francisco Gomez', isUser: true } },
        },
        {
          anchorId: nobody.anchorId,
          decision: 'accept',
          draft: { title: 'Book the room', dueDate: '2026-11-14', dueTime: '09:00', reminderMinutesBefore: 0, owner: null },
        },
      ],
      drafts: expect.any(Object),
    });
  });

  it('applies the edits: owner changed without a title edit re-prefixes; a typed title stays as typed', () => {
    const bish = item();
    const other = item();
    const draft = draftFor(bish, { owner: { kind: 'you' } }, { kind: 'none' }, now, 'UTC');
    expect(draft).toEqual({ title: 'Provide APK access/files to Urpayroll', dueDate: null, dueTime: null, reminderMinutesBefore: null, owner: { name: 'Bish', isUser: true } });
    expect(draftFor(other, { owner: { kind: 'other', name: 'Cristina' } }, { kind: 'none' }, now, 'UTC')).toMatchObject({
      title: 'Cristina: Provide APK access/files to Urpayroll',
      owner: { name: 'Cristina', isUser: false },
    });
    expect(draftFor(other, { title: 'Call Bish on +1 555 0100', schedule: { dueDate: '2026-11-20', dueTime: '10:30', reminderMinutesBefore: 15 } }, { kind: 'tomorrow' }, now, 'UTC')).toEqual({
      title: 'Call Bish on +1 555 0100',
      dueDate: '2026-11-20',
      dueTime: '10:30',
      reminderMinutesBefore: 15,
      owner: { name: 'Bish', isUser: false },
    });
  });

  it('recomputes "tomorrow" when Accept is tapped, not when the screen opened', () => {
    const a = item();
    const at = (iso: string) =>
      buildAcceptDecisions({ items: [a], anchors: [a.anchorId], edits: {}, choice: { kind: 'tomorrow' }, now: new Date(iso), deviceZone: 'Europe/Madrid' });
    const first = at('2026-11-12T22:59:00.000Z');
    const second = at('2026-11-12T23:01:00.000Z');
    expect(first.ok && first.decisions[0]?.decision === 'accept' && first.decisions[0].draft.dueDate).toBe('2026-11-13');
    expect(second.ok && second.decisions[0]?.decision === 'accept' && second.decisions[0].draft.dueDate).toBe('2026-11-14');
  });

  it('accepts a suggestion whose task was deleted ("Add again"), never an accepted one whose task exists', () => {
    const removed = item({ status: 'accepted', taskId: 'sm_0123456789abcdef0123456789abcdef', taskExists: false });
    const added = item({ status: 'accepted', taskId: 'sm_fedcba9876543210fedcba9876543210', taskExists: true });
    const built = buildAcceptDecisions({ items: [removed, added], anchors: [removed.anchorId, added.anchorId], edits: {}, choice: { kind: 'tomorrow' }, now, deviceZone: 'UTC' });
    expect(built.ok && built.decisions.map((decision) => decision.anchorId)).toEqual([removed.anchorId]);
    expect(buildAcceptDecisions({ items: [added], anchors: [added.anchorId], edits: {}, choice: { kind: 'tomorrow' }, now, deviceZone: 'UTC' })).toEqual({
      ok: false,
      reason: 'nothing',
    });
  });

  it('refuses a picked default that has passed, and a draft that breaks the task invariants', () => {
    const a = item();
    expect(
      buildAcceptDecisions({ items: [a], anchors: [a.anchorId], edits: {}, choice: { kind: 'picked', date: '2026-11-12', time: '08:00' }, now, deviceZone: 'UTC' }),
    ).toEqual({ ok: false, reason: 'pastPick' });
    // The passed pick does not matter when the item has its own schedule.
    expect(
      buildAcceptDecisions({
        items: [a],
        anchors: [a.anchorId],
        edits: { [a.anchorId]: { schedule: { dueDate: '2026-11-20', dueTime: null, reminderMinutesBefore: null } } },
        choice: { kind: 'picked', date: '2026-11-12', time: '08:00' },
        now,
        deviceZone: 'UTC',
      }).ok,
    ).toBe(true);
    expect(
      buildAcceptDecisions({
        items: [a],
        anchors: [a.anchorId],
        edits: { [a.anchorId]: { schedule: { dueDate: null, dueTime: '10:00', reminderMinutesBefore: 0 } } },
        choice: { kind: 'tomorrow' },
        now,
        deviceZone: 'UTC',
      }),
    ).toEqual({ ok: false, reason: 'invalid', anchorId: a.anchorId });
    expect(buildAcceptDecisions({ items: [a], anchors: [], edits: {}, choice: { kind: 'tomorrow' }, now, deviceZone: 'UTC' })).toEqual({ ok: false, reason: 'nothing' });
  });

  it('says "Added" only from the results, with or without reminders', () => {
    const results = (outcomes: CommitmentDecisionResult['outcome'][]): CommitmentDecisionResult[] =>
      outcomes.map((outcome, index) => ({ anchorId: `i_00000000000${index}`, outcome, taskId: null }));
    const withReminder = { i_000000000000: { title: 'x', dueDate: '2026-11-13', dueTime: '09:00', reminderMinutesBefore: 0, owner: null } };
    expect(decideFeedback(results(['added', 'already_added', 'not_open']), withReminder)).toEqual({
      messages: [
        { key: 'summaries:commitments.result.added', params: { count: 1 } },
        { key: 'summaries:commitments.result.alreadyAdded', params: { count: 1 } },
        { key: 'summaries:commitments.result.notOpen', params: { count: 1 } },
      ],
      tone: 'success',
      changed: false,
    });
    expect(decideFeedback(results(['added', 'added'])).messages).toEqual([{ key: 'summaries:commitments.result.addedNoReminder', params: { count: 2 } }]);
    expect(decideFeedback(results(['already_added'])).tone).toBe('info');
    expect(decideFeedback(results(['dropped'])).messages).toEqual([{ key: 'summaries:commitments.result.dropped' }]);
    expect(decideFeedback(results(['removed'])).messages).toEqual([{ key: 'summaries:commitments.result.removed' }]);
    expect(decideFeedback(results(['changed'])).changed).toBe(true);
    expect(decideFeedback([]).messages).toEqual([]);
  });

  it('says "Their reminders are set" only when every added task has one', () => {
    const draft = (reminderMinutesBefore: number | null) => ({
      title: 'x',
      dueDate: reminderMinutesBefore === null ? null : '2026-11-13',
      dueTime: reminderMinutesBefore === null ? null : '09:00',
      reminderMinutesBefore,
      owner: null,
    });
    const added = (ids: string[]): CommitmentDecisionResult[] => ids.map((anchorId) => ({ anchorId, outcome: 'added', taskId: null }));
    const ids = ['i_000000000001', 'i_000000000002', 'i_000000000003'];
    // "No reminder" as the default, one item with a stated date that keeps its 9:00 reminder.
    const mixed = { [ids[0] as string]: draft(0), [ids[1] as string]: draft(null), [ids[2] as string]: draft(null) };
    expect(decideFeedback(added(ids), mixed).messages[0]).toEqual({ key: 'summaries:commitments.result.addedSomeReminders', params: { count: 3 } });
    const all = { [ids[0] as string]: draft(0), [ids[1] as string]: draft(15), [ids[2] as string]: draft(60) };
    expect(decideFeedback(added(ids), all).messages[0]).toEqual({ key: 'summaries:commitments.result.added', params: { count: 3 } });
    const none = { [ids[0] as string]: draft(null), [ids[1] as string]: draft(null), [ids[2] as string]: draft(null) };
    expect(decideFeedback(added(ids), none).messages[0]).toEqual({ key: 'summaries:commitments.result.addedNoReminder', params: { count: 3 } });
  });

  it('says a decide that timed out or failed upstream could not be confirmed (it may have been saved)', () => {
    expect(decideErrorKey(new AppError('timeout', 'summary commitments request timed out'))).toBe('summaries:commitments.errors.decideUnconfirmed');
    expect(decideErrorKey(commitmentAppError('upstream_error'))).toBe('summaries:commitments.errors.decideUnconfirmed');
    expect(decideErrorKey(new AppError('upstream_error', 'invalid summaryCommitments response'))).toBe('summaries:commitments.errors.decideUnconfirmed');
    // Known not to be saved: their own messages.
    expect(decideErrorKey(new AppError('offline', 'Device is offline'))).toBe('summaries:commitments.errors.offline');
    expect(decideErrorKey(commitmentAppError('invalid_request'))).toBe('summaries:commitments.errors.invalid_request');
    expect(decideErrorKey(commitmentAppError('not_allowed'))).toBe('summaries:errors.not_allowed');
  });
});

describe('cards', () => {
  const now = new Date('2026-11-12T12:00:00.000Z');
  const card = (it: CommitmentItem, edit: Parameters<typeof commitmentCardView>[0]['edit'] = null) =>
    commitmentCardView({ item: it, edit, choice: { kind: 'tomorrow' }, now, deviceZone: 'UTC', labels: LABELS });

  it('shows another person as a follow-up with the name kept in the title', () => {
    const view = card(item());
    expect(view.title).toBe('Bish: Provide APK access/files to Urpayroll');
    expect(view.owner).toEqual({ key: 'summaries:commitments.owner.named', params: { name: 'Bish' } });
    expect(view.ownerNote).toEqual({ key: 'summaries:commitments.owner.followUp', params: { name: 'Bish' } });
    expect(view.quote).toBe('Provide APK access/files to Urpayroll (owner: Bish)');
    expect(view.section).toEqual({ key: 'summaries:commitments.card.section', params: { heading: 'Action items' } });
    expect(view.due).toEqual([
      { key: 'summaries:commitments.due.noDateReminder', params: { when: { key: 'summaries:commitments.reminder.choice.tomorrow', params: { time: 'T(09:00)' } } } },
    ]);
  });

  it('shows a first-name guess as "You? (the summary says: <name>)" with its reason, never as a follow-up', () => {
    const view = card(item({ owner: { name: 'Francisco', isUser: true, guess: true }, flags: ['owner_guess'], title: 'Send the contract', preselected: true }));
    expect(view.owner).toEqual({ key: 'summaries:commitments.owner.guess', params: { name: 'Francisco' } });
    expect(view.ownerNote).toBeNull();
    expect(view.chips).toContainEqual({ label: { key: 'summaries:commitments.chip.owner_guess' }, tone: 'warning' });
    expect(view.reason).toEqual({ key: 'summaries:commitments.reason.owner_guess' });
  });

  it('shows the chips and the reason of an unticked suggestion', () => {
    const view = card(item({ flags: ['payment_like', 'suggested'], confidence: 40, preselected: false }));
    expect(view.chips).toEqual([
      { label: { key: 'summaries:commitments.chip.payment_like' }, tone: 'warning' },
      { label: { key: 'summaries:commitments.chip.suggested' }, tone: 'neutral' },
      { label: { key: 'summaries:commitments.chip.lowConfidence' }, tone: 'neutral' },
    ]);
    expect(view.reason).toEqual({ key: 'summaries:commitments.reason.payment_like' });
    expect(card(item({ confidence: 40 })).reason).toEqual({ key: 'summaries:commitments.reason.lowConfidence' });
  });

  it('words the due line as section 11 does', () => {
    const due = (d: Partial<NonNullable<CommitmentItem['due']>>) => ({ date: '2026-11-14', time: null, zone: null, quote: null, overdue: false, ...d });
    const lines = (d: Partial<NonNullable<CommitmentItem['due']>>, deviceZone = 'UTC') =>
      dueRefs({ item: { due: due(d) }, edit: null, choice: { kind: 'tomorrow' }, now, deviceZone, labels: LABELS });
    expect(lines({})).toEqual([{ key: 'summaries:commitments.due.date', params: { date: 'D(2026-11-14)' } }]);
    expect(lines({ quote: 'by Saturday' })).toEqual([{ key: 'summaries:commitments.due.withQuote', params: { date: 'D(2026-11-14)', quote: 'by Saturday' } }]);
    expect(lines({ time: '17:00', zone: 'Europe/Madrid', quote: 'by 17:00' })).toEqual([
      {
        key: 'summaries:commitments.due.dateTime',
        params: { date: 'D(2026-11-14)', time: { key: 'summaries:commitments.due.meetingTime', params: { time: 'T(17:00)', zone: 'Europe/Madrid' } } },
      },
      { key: 'summaries:commitments.due.says', params: { quote: 'by 17:00' } },
    ]);
    expect(lines({ time: '17:00', zone: 'Europe/Madrid' }, 'Europe/Madrid')[0]).toEqual({
      key: 'summaries:commitments.due.dateTime',
      params: { date: 'D(2026-11-14)', time: 'T(17:00)' },
    });
    expect(lines({ date: '2026-11-10', quote: 'by Tuesday' })).toEqual([{ key: 'summaries:commitments.due.overdueQuote', params: { quote: 'by Tuesday' } }]);
    expect(lines({ date: '2026-11-10' })).toEqual([
      { key: 'summaries:commitments.due.overdue', params: { date: 'D(2026-11-10)' } },
      { key: 'summaries:commitments.due.noReminderUntilPick' },
    ]);
    expect(dueRefs({ item: { due: null }, edit: null, choice: { kind: 'none' }, now, deviceZone: 'UTC', labels: LABELS })).toEqual([
      { key: 'summaries:commitments.due.noDate' },
      { key: 'summaries:commitments.due.noReminder' },
    ]);
    expect(
      dueRefs({
        item: { due: null },
        edit: { schedule: { dueDate: '2026-11-20', dueTime: '10:00', reminderMinutesBefore: 15 } },
        choice: { kind: 'none' },
        now,
        deviceZone: 'UTC',
        labels: LABELS,
      }),
    ).toEqual([{ key: 'summaries:commitments.due.dateTime', params: { date: 'D(2026-11-20)', time: 'T(10:00)' } }]);
    // An overdue card carries the chip.
    expect(card(item({ due: due({ date: '2026-11-10' }) })).chips[0]).toEqual({ label: { key: 'summaries:commitments.chip.overdue' }, tone: 'warning' });
  });

  it('says "No reminder until you pick one" for a due today whose time has passed (now is 12:00 UTC)', () => {
    const due = (d: Partial<NonNullable<CommitmentItem['due']>>) => ({ date: '2026-11-12', time: null, zone: null, quote: null, overdue: false, ...d });
    const lines = (d: Partial<NonNullable<CommitmentItem['due']>>) =>
      dueRefs({ item: { due: due(d) }, edit: null, choice: { kind: 'tomorrow' }, now, deviceZone: 'UTC', labels: LABELS });
    // A date alone, today after 9:00.
    expect(lines({ quote: 'today' })).toEqual([
      { key: 'summaries:commitments.due.withQuote', params: { date: 'D(2026-11-12)', quote: 'today' } },
      { key: 'summaries:commitments.due.noReminderUntilPick' },
    ]);
    expect(lines({})).toEqual([
      { key: 'summaries:commitments.due.date', params: { date: 'D(2026-11-12)' } },
      { key: 'summaries:commitments.due.noReminderUntilPick' },
    ]);
    // A stated time earlier today.
    expect(lines({ time: '10:00', quote: 'by 10' })).toEqual([
      { key: 'summaries:commitments.due.dateTime', params: { date: 'D(2026-11-12)', time: 'T(10:00)' } },
      { key: 'summaries:commitments.due.says', params: { quote: 'by 10' } },
      { key: 'summaries:commitments.due.noReminderUntilPick' },
    ]);
    // Later today: the reminder is set, nothing more to say.
    expect(lines({ time: '17:00' })).toEqual([{ key: 'summaries:commitments.due.dateTime', params: { date: 'D(2026-11-12)', time: 'T(17:00)' } }]);
  });

  it('shows an edit: the re-prefixed title, the new owner and "Edited by you"', () => {
    const view = card(item(), { owner: { kind: 'other', name: 'Cristina' } });
    expect(view.title).toBe('Cristina: Provide APK access/files to Urpayroll');
    expect(view.owner).toEqual({ key: 'summaries:view.owner', params: { owner: 'Cristina' } });
    expect(view.ownerNote).toEqual({ key: 'summaries:commitments.owner.followUp', params: { name: 'Cristina' } });
    expect(view.edited).toBe(true);
    expect(card(item(), { owner: { kind: 'nobody' } }).owner).toEqual({ key: 'summaries:commitments.owner.none' });
  });

  it('marks accepted, removed and dropped suggestions', () => {
    const accepted = card(item({ status: 'accepted', taskId: 'sm_0123456789abcdef0123456789abcdef', taskExists: true, via: 'whatsapp' }));
    expect(accepted.status).toBe('accepted');
    expect(accepted.via).toEqual({ key: 'summaries:commitments.card.via.whatsapp' });
    expect(accepted.due).toEqual([]);
    expect(card(item({ status: 'accepted', taskId: 'sm_0123456789abcdef0123456789abcdef', taskExists: false })).status).toBe('removed');
    expect(card(item({ status: 'dropped' })).status).toBe('dropped');
  });

  it('knows when there are open edits to lose', () => {
    const a = item();
    const b = item({ status: 'accepted', taskId: 'sm_0123456789abcdef0123456789abcdef', taskExists: true });
    expect(hasOpenEdits(list([a, b]), { [a.anchorId]: { owner: { kind: 'you' } } })).toBe(true);
    expect(hasOpenEdits(list([a, b]), { [b.anchorId]: { owner: { kind: 'you' } } })).toBe(false);
    expect(hasOpenEdits(null, {})).toBe(false);
  });
});

describe('retention', () => {
  it('keeps a filed or kept summary 365 days after it arrived', () => {
    expect(summaryKeptUntil('2026-11-12T10:00:00.000Z')).toBe('2027-11-12T10:00:00.000Z');
    expect(summaryKeptUntil(null)).toBeNull();
    expect(summaryKeptUntil('not a date')).toBeNull();
  });
});

/**
 * PURE model of the commitments review screen (route "SummaryCommitments" { summaryId }; M11,
 * docs/v2/M11-DESIGN.md sections 3.2 to 3.5, 11 and 16): what the screen shows in each state,
 * the origin block and banners, each card's lines, the selection and its footer, the default
 * reminders computed in the task zone, and the decide request built from the selection and the
 * edits. No React, no Firebase: unit tests import this file directly. Texts are TextRefs (keys of
 * the summaries namespace); a param can itself be a TextRef, resolved by the screen.
 *
 * Rules the code follows (section 16 wins where it differs from the text above it):
 * - Pre-selection comes from the server (item.preselected, computed from the current trust facts),
 *   and the app never ticks a payment-like item, an item that reads like an instruction, or a
 *   first-name owner guess ("You? (the summary says: Francisco)"), so Accept all never adds a
 *   colleague's job as the user's own task (the WhatsApp S1 rule). A stale (read-only) list ticks
 *   nothing and decides nothing.
 * - "Select all" is offered only when preselect.selectAll (never on a summary not addressed to
 *   the user) and ticks every open suggestion except instruction-like ones and owner guesses.
 * - "Accept all (8)" when every open suggestion is ticked, "Add 5 selected" otherwise; disabled
 *   offline (the server writes the tasks; there is no offline accept).
 * - Defaults before any edit (section 3.4): a stated date and time keeps the meeting's zone and
 *   reminds 60 minutes before (at the time when that is less than 60 minutes ahead, none when
 *   past); a stated date only is 9:00 that day with the reminder at the time (no time and no
 *   reminder once 9:00 has passed); a stated date already past is overdue, the date kept, no
 *   reminder; no date is the screen's default reminder (tomorrow 9:00 unless the user picks
 *   another, or none), at the time, in the device zone. "Tomorrow" is the next LOCAL date of the
 *   task zone, computed when Accept is tapped, so a screen left open past midnight and a DST
 *   change both land on 9:00 of the right day.
 * - "Added" is said only from the decide answer's results.
 */
import {
  COMMITMENT_LIMITS,
  commitmentDraftSchema,
  type AssistantUsage,
  type CommitmentDecision,
  type CommitmentDecisionResult,
  type CommitmentDraft,
  type CommitmentFlag,
  type CommitmentItem,
  type CommitmentMode,
  type SummaryCommitments,
  type SummaryDetail,
  type SummaryStatusResponse,
} from '../../core/aiContract';
import type { AppError } from '../../core/errors';
import { addDaysToLocalDate, getZonedParts, isValidTimeZone, todayInZone, zonedDateTimeToUtcIso } from '../../core/time';
import {
  NO_SCHEDULE,
  defaultOwnerChoice,
  draftOwnerOf,
  editedTitle,
  ownerNameOf,
  type CommitmentEdit,
  type CommitmentSchedule,
  type ReminderDefault,
} from '../../components/commitments/commitmentEditModel';
import type { BadgeTone } from '../../components/ui/Badge';
import {
  commitmentErrorMessageKey,
  commitmentErrorReason,
  commitmentErrorUsage,
  isCommitmentsUnavailableError,
} from '../../services/summaries/commitmentsCore';
import { isSummariesAvailable, summaryErrorReason } from '../../services/summaries/summaryCore';
import type { CommitmentsBusy, SummaryCommitmentsHookState } from '../../services/summaries/useSummaryCommitments';

// ---- Text references -------------------------------------------------------------------------------

export type TextParam = string | number | TextRef;

/** An i18n key with its params; a param that is a TextRef is translated first. */
export interface TextRef {
  key: string;
  params?: Readonly<Record<string, TextParam>>;
}

export function isTextRef(value: TextParam): value is TextRef {
  return typeof value === 'object' && value !== null && typeof (value as TextRef).key === 'string';
}

/** Wall-clock labels the screen formats (12 or 24 h, language): a local date and an HH:MM time. */
export interface WallClockLabels {
  date(localDate: string): string;
  time(hhmm: string): string;
}

// ---- Screen state ---------------------------------------------------------------------------------

export type CommitmentsPhase =
  /** summaryStatus or the first get is in flight. */
  | 'loading'
  /** summaryStatus failed with nothing cached. */
  | 'statusError'
  /** Off, not in the pilot, or summaryCommitments not deployed. */
  | 'unavailable'
  /** The summary was deleted (here or elsewhere): the screen goes back. */
  | 'gone'
  /** The summary waits in the inbox: file or keep it first. */
  | 'notFiled'
  /** The first get failed with nothing cached. */
  | 'error'
  /** This screen is preparing and has nothing to show yet. */
  | 'preparingSelf'
  /** Nothing prepared yet (the screen prepares the action items as written, free). */
  | 'none'
  /** Another device or WhatsApp is preparing: the hook polls. */
  | 'preparing'
  /** The AI allowance is used up and no list is shown. */
  | 'quota'
  /** The text changed: no list; Prepare again (free). */
  | 'staleNoList'
  /** Prepared, nothing found. */
  | 'empty'
  /** A list (ready, or stale and read-only). */
  | 'list';

export interface CommitmentsPhaseInput {
  status: SummaryStatusResponse | null;
  statusError: AppError | null;
  hookState: SummaryCommitmentsHookState;
  data: SummaryCommitments | null;
  error: AppError | null;
  busy: CommitmentsBusy;
  /** The summary's status from summaryRead (null while unknown). */
  summaryStatus: SummaryDetail['status'] | null;
  /** The summaryRead get failed (only not_found matters here). */
  summaryError: AppError | null;
  /** useSummary(...).loading: the first summaryRead get is in flight with nothing cached. */
  summaryLoading: boolean;
  /**
   * summaryRead was asked again after the commitments error was not_found, and answered. Until
   * then a commitments not_found waits: summaryCommitments says not_found for a summary moved back
   * to the inbox too, and only summaryRead tells "file it first" from "deleted".
   */
  summaryChecked: boolean;
}

export function commitmentsPhase(input: CommitmentsPhaseInput): CommitmentsPhase {
  if (input.status === null) return input.statusError === null ? 'loading' : 'statusError';
  if (!isSummariesAvailable(input.status) || isCommitmentsUnavailableError(input.error)) return 'unavailable';
  if (input.summaryStatus === 'inbox') return 'notFiled';
  if (summaryErrorReason(input.summaryError) === 'not_found') return 'gone';
  // Deleted on this phone (also by "Disconnect and delete" on a screen above): summaryRead answered
  // and its cached copy is gone, exactly as the summary view reads it.
  if (input.summaryStatus === null && !input.summaryLoading && input.summaryError === null) return 'gone';
  if (commitmentErrorReason(input.error) === 'not_found') return input.summaryChecked ? 'gone' : 'loading';
  if (input.busy === 'prepare' && input.data === null) return 'preparingSelf';
  const quota = commitmentErrorReason(input.error) === 'quota_exceeded';
  switch (input.hookState) {
    case 'idle':
    case 'loading':
      return 'loading';
    case 'error':
      return quota ? 'quota' : 'error';
    case 'none':
      return quota ? 'quota' : 'none';
    case 'preparing':
      return 'preparing';
    case 'ready':
      return input.data !== null ? 'list' : 'loading';
    case 'empty':
      return input.data !== null ? 'empty' : 'loading';
    case 'stale':
      return input.data !== null ? 'list' : 'staleNoList';
  }
}

/** A stale list is shown read-only: nothing selectable, no decide (Prepare again first). */
export function isReadOnly(hookState: SummaryCommitmentsHookState): boolean {
  return hookState === 'stale';
}

/** The polls gave up while another device still prepared (refresh() starts again). */
export function isStillPreparingError(error: AppError | null): boolean {
  return error !== null && error.code === 'timeout' && error.details?.preparing === true;
}

/** quota_exceeded: the card's texts (the renewal time only when the plan renews). */
export function quotaLines(error: AppError | null, formatTime: (iso: string) => string): TextRef[] | null {
  if (commitmentErrorReason(error) !== 'quota_exceeded') return null;
  const usage: AssistantUsage | null = commitmentErrorUsage(error);
  const lines: TextRef[] = [{ key: 'summaries:commitments.quota.body' }];
  if (usage !== null && usage.subscriptionRequired !== true) {
    const time = formatTime(usage.resetsAt);
    if (time !== '') lines.push({ key: 'summaries:commitments.quota.resets', params: { time } });
  }
  return lines;
}

// ---- Origin and banners -----------------------------------------------------------------------------

export interface OriginText {
  source: TextRef;
  notes: TextRef[];
}

/**
 * The origin block, always first (section 11): where the suggestions come from, "Meeting Guard AI
 * did not attend this meeting." and "Written by AI ..." (or "The action items exactly as your
 * notetaker wrote them.").
 */
export function originText(commitments: Pick<SummaryCommitments, 'mode' | 'origin' | 'preselect'>, formatDate: (localDate: string) => string): OriginText {
  const ai = commitments.mode === 'ai';
  const { origin } = commitments;
  const date = origin.occurrenceDate ?? origin.localDate;
  const dateText = date !== null ? formatDate(date) : '';
  let source: TextRef;
  if (commitments.preselect.reason === 'not_addressed_to_you') {
    source = { key: ai ? 'summaries:commitments.origin.suggested.notAddressed' : 'summaries:commitments.origin.asWritten.notAddressed' };
  } else if (origin.tier === 'user_forwarded') {
    source =
      origin.forwardedBy !== null
        ? {
            key: ai ? 'summaries:commitments.origin.suggested.forwarded' : 'summaries:commitments.origin.asWritten.forwarded',
            params: { address: origin.forwardedBy },
          }
        : { key: ai ? 'summaries:commitments.origin.suggested.forwardedNoAddress' : 'summaries:commitments.origin.asWritten.forwardedNoAddress' };
  } else if (origin.meetingTitle !== null) {
    source =
      dateText !== ''
        ? {
            key: ai ? 'summaries:commitments.origin.suggested.meeting' : 'summaries:commitments.origin.asWritten.meeting',
            params: { meeting: origin.meetingTitle, date: dateText },
          }
        : {
            key: ai ? 'summaries:commitments.origin.suggested.meetingNoDate' : 'summaries:commitments.origin.asWritten.meetingNoDate',
            params: { meeting: origin.meetingTitle },
          };
  } else {
    source =
      dateText !== ''
        ? { key: ai ? 'summaries:commitments.origin.suggested.kept' : 'summaries:commitments.origin.asWritten.kept', params: { date: dateText } }
        : { key: ai ? 'summaries:commitments.origin.suggested.keptNoDate' : 'summaries:commitments.origin.asWritten.keptNoDate' };
  }
  return {
    source,
    notes: [
      { key: 'summaries:commitments.origin.notAttended' },
      { key: ai ? 'summaries:commitments.origin.aiWritten' : 'summaries:commitments.origin.asWrittenLine' },
    ],
  };
}

/** The notices under the origin block: why nothing is pre-selected, a cut summary, a moved summary. */
export function bannerRefs(commitments: Pick<SummaryCommitments, 'preselect' | 'origin' | 'truncated' | 'meetingChanged'>): TextRef[] {
  const banners: TextRef[] = [];
  switch (commitments.preselect.reason) {
    case 'old_summary':
      banners.push({ key: 'summaries:commitments.banner.old_summary' });
      break;
    case 'not_addressed_to_you':
      banners.push({ key: 'summaries:commitments.banner.not_addressed_to_you' });
      break;
    case 'possible_instruction':
      banners.push({ key: 'summaries:commitments.banner.possible_instruction' });
      break;
    case 'forwarded':
      banners.push(
        commitments.origin.forwardedBy !== null
          ? { key: 'summaries:commitments.banner.forwarded', params: { address: commitments.origin.forwardedBy } }
          : { key: 'summaries:commitments.banner.forwardedNoAddress' },
      );
      break;
    case null:
      break;
  }
  if (commitments.truncated) banners.push({ key: 'summaries:commitments.banner.truncated' });
  if (commitments.meetingChanged) banners.push({ key: 'summaries:commitments.banner.meetingChanged' });
  return banners;
}

/** "8 suggestions", "5 still to review", "3 in your tasks". */
export function headerRefs(commitments: Pick<SummaryCommitments, 'items'>): TextRef[] {
  const items = commitments.items;
  const open = items.filter((item) => item.status === 'open').length;
  const accepted = items.filter((item) => item.status === 'accepted').length;
  const refs: TextRef[] = [{ key: 'summaries:commitments.header.count', params: { count: items.length } }];
  if (open > 0 && open < items.length) refs.push({ key: 'summaries:commitments.header.open', params: { count: open } });
  if (accepted > 0) refs.push({ key: 'summaries:commitments.header.added', params: { count: accepted } });
  return refs;
}

// ---- Default reminders (task zone) -----------------------------------------------------------------

/** The time of day of the default reminder and of a stated date without a time (section 3.4). */
export const COMMITMENT_DEFAULT_TIME = '09:00';
/** A stated date and time reminds this many minutes before. */
export const STATED_TIME_REMINDER_MINUTES = 60;

export interface WallSlot {
  date: string;
  time: string;
}

function usableZone(zone: string | null | undefined): string {
  return typeof zone === 'string' && isValidTimeZone(zone) ? zone : 'UTC';
}

/**
 * The date and time a default reminder choice means at `now` in `zone` (null for "No reminder").
 * Calendar arithmetic on the zone's LOCAL date, so 23:30 in Mexico City (05:30 UTC the next day)
 * still gives one day ahead, and a DST change keeps 9:00 on the wall clock.
 */
export function reminderSlot(choice: ReminderDefault, now: Date, zone: string): WallSlot | null {
  if (choice.kind === 'none') return null;
  if (choice.kind === 'picked') return { date: choice.date, time: choice.time };
  const tz = usableZone(zone);
  const today = todayInZone(tz, now);
  if (choice.kind === 'tomorrow') return { date: addDaysToLocalDate(today, 1), time: COMMITMENT_DEFAULT_TIME };
  if (choice.kind === 'dayAfter') return { date: addDaysToLocalDate(today, 2), time: COMMITMENT_DEFAULT_TIME };
  // Next Monday: the first Monday after today (a week ahead on a Monday, tomorrow on a Sunday).
  const weekday = getZonedParts(now, tz).weekday;
  const ahead = (1 - weekday + 7) % 7 || 7;
  return { date: addDaysToLocalDate(today, ahead), time: COMMITMENT_DEFAULT_TIME };
}

/** The UTC instant of a wall-clock slot in `zone` (ISO), or null when it cannot be read. */
export function slotInstant(slot: WallSlot, zone: string): string | null {
  try {
    return zonedDateTimeToUtcIso(slot.date, slot.time, usableZone(zone));
  } catch {
    return null;
  }
}

/** A picked default that is no longer ahead ("That time has already passed"). */
export function isPickedDefaultPast(choice: ReminderDefault, now: Date, zone: string): boolean {
  if (choice.kind !== 'picked') return false;
  const instant = slotInstant(choice, zone);
  return instant === null || Date.parse(instant) <= now.getTime();
}

/** The label of a default choice ("Tomorrow at 9:00 AM", "Nov 20, 2026 at 3:00 PM", "No reminder"). */
export function reminderChoiceRef(choice: ReminderDefault, labels: WallClockLabels): TextRef {
  switch (choice.kind) {
    case 'tomorrow':
      return { key: 'summaries:commitments.reminder.choice.tomorrow', params: { time: labels.time(COMMITMENT_DEFAULT_TIME) } };
    case 'dayAfter':
      return { key: 'summaries:commitments.reminder.choice.dayAfter', params: { time: labels.time(COMMITMENT_DEFAULT_TIME) } };
    case 'nextMonday':
      return { key: 'summaries:commitments.reminder.choice.nextMonday', params: { time: labels.time(COMMITMENT_DEFAULT_TIME) } };
    case 'picked':
      return { key: 'summaries:commitments.reminder.choice.picked', params: { date: labels.date(choice.date), time: labels.time(choice.time) } };
    case 'none':
      return { key: 'summaries:commitments.reminder.choice.none' };
  }
}

function reminderAhead(date: string, time: string, zone: string, preferred: number, now: Date): number | null {
  const instant = slotInstant({ date, time }, zone);
  if (instant === null) return null;
  const at = Date.parse(instant);
  if (at - preferred * 60_000 > now.getTime()) return preferred;
  return at > now.getTime() ? 0 : null;
}

/** The zone a stated due is in: the meeting's for a stated time (when known), else the device's. */
export function dueZone(due: CommitmentItem['due'], deviceZone: string): string {
  if (due !== null && due.time !== null && due.zone !== null && isValidTimeZone(due.zone)) return due.zone;
  return usableZone(deviceZone);
}

/** The stated date has passed (the server's flag, or the date before today in the task zone). */
export function isDueOverdue(due: CommitmentItem['due'], now: Date, deviceZone: string): boolean {
  if (due === null) return false;
  if (due.overdue) return true;
  try {
    return due.date < todayInZone(dueZone(due, deviceZone), now);
  } catch {
    return false;
  }
}

/** The schedule of a suggestion before any edit (see the module comment). */
export function defaultSchedule(due: CommitmentItem['due'], choice: ReminderDefault, now: Date, deviceZone: string): CommitmentSchedule {
  if (due === null) {
    const slot = reminderSlot(choice, now, deviceZone);
    return slot === null ? NO_SCHEDULE : { dueDate: slot.date, dueTime: slot.time, reminderMinutesBefore: 0 };
  }
  const zone = dueZone(due, deviceZone);
  if (isDueOverdue(due, now, deviceZone)) return { dueDate: due.date, dueTime: due.time, reminderMinutesBefore: null };
  if (due.time !== null) {
    return { dueDate: due.date, dueTime: due.time, reminderMinutesBefore: reminderAhead(due.date, due.time, zone, STATED_TIME_REMINDER_MINUTES, now) };
  }
  const reminder = reminderAhead(due.date, COMMITMENT_DEFAULT_TIME, zone, 0, now);
  return reminder === null
    ? { dueDate: due.date, dueTime: null, reminderMinutesBefore: null }
    : { dueDate: due.date, dueTime: COMMITMENT_DEFAULT_TIME, reminderMinutesBefore: reminder };
}

/** The suggestion follows the screen's default reminder (no stated date, no schedule of its own). */
export function usesDefaultReminder(item: Pick<CommitmentItem, 'due'>, edit: CommitmentEdit | null | undefined): boolean {
  return item.due === null && edit?.schedule === undefined;
}

/** The schedule a suggestion is accepted with: the user's, else the default. */
export function scheduleFor(item: Pick<CommitmentItem, 'due'>, edit: CommitmentEdit | null | undefined, choice: ReminderDefault, now: Date, deviceZone: string): CommitmentSchedule {
  return edit?.schedule ?? defaultSchedule(item.due, choice, now, deviceZone);
}

/** The task a suggestion becomes with its edit (title, owner, schedule), as decide expects it. */
export function draftFor(
  item: Pick<CommitmentItem, 'title' | 'owner' | 'due'>,
  edit: CommitmentEdit | null | undefined,
  choice: ReminderDefault,
  now: Date,
  deviceZone: string,
): CommitmentDraft {
  const schedule = scheduleFor(item, edit, choice, now, deviceZone);
  return {
    title: editedTitle(item, edit).trim(),
    dueDate: schedule.dueDate,
    dueTime: schedule.dueTime,
    reminderMinutesBefore: schedule.reminderMinutesBefore,
    owner: draftOwnerOf(edit?.owner ?? defaultOwnerChoice(item.owner), item.owner),
  };
}

/**
 * "8 reminders tomorrow at 9:00": the selected suggestions that share the default reminder, when
 * there are at least two (Francisco's open question 6: they arrive together).
 */
export function reminderGroupRef(
  commitments: Pick<SummaryCommitments, 'items'>,
  selection: readonly string[],
  edits: Readonly<Record<string, CommitmentEdit>>,
  choice: ReminderDefault,
  labels: WallClockLabels,
): TextRef | null {
  const chosen = new Set(selection);
  const count = commitments.items.filter(
    (item) => item.status === 'open' && chosen.has(item.anchorId) && usesDefaultReminder(item, edits[item.anchorId]),
  ).length;
  if (count < 2) return null;
  const time = labels.time(choice.kind === 'picked' ? choice.time : COMMITMENT_DEFAULT_TIME);
  switch (choice.kind) {
    case 'tomorrow':
      return { key: 'summaries:commitments.reminder.group.tomorrow', params: { count, time } };
    case 'dayAfter':
      return { key: 'summaries:commitments.reminder.group.dayAfter', params: { count, time } };
    case 'nextMonday':
      return { key: 'summaries:commitments.reminder.group.nextMonday', params: { count, time } };
    case 'picked':
      return { key: 'summaries:commitments.reminder.group.picked', params: { count, date: labels.date(choice.date), time } };
    case 'none':
      return { key: 'summaries:commitments.reminder.group.none', params: { count } };
  }
}

/** The default-reminder picker is shown while an open suggestion has no stated date. */
export function needsReminderDefault(commitments: Pick<SummaryCommitments, 'items'>): boolean {
  return commitments.items.some((item) => item.status === 'open' && item.due === null);
}

// ---- Selection ---------------------------------------------------------------------------------------

/** The owner only matched the user's first name ("You?"). */
export function isOwnerGuess(item: Pick<CommitmentItem, 'owner' | 'flags'>): boolean {
  return item.owner?.guess === true || item.flags.includes('owner_guess');
}

/** Ticked when the list opens: the server pre-selected it, and it is not payment-like, instruction-like or an owner guess. */
export function startsSelected(item: CommitmentItem): boolean {
  return (
    item.status === 'open' &&
    item.preselected &&
    !isOwnerGuess(item) &&
    !item.flags.includes('payment_like') &&
    !item.flags.includes('possible_instruction')
  );
}

export function initialSelection(commitments: Pick<SummaryCommitments, 'items'>, readOnly: boolean): string[] {
  if (readOnly) return [];
  return commitments.items.filter(startsSelected).map((item) => item.anchorId);
}

/** A kept selection after a new answer: only suggestions still open in this list. */
export function reconcileSelection(selection: readonly string[], commitments: Pick<SummaryCommitments, 'items'>, readOnly: boolean): string[] {
  if (readOnly) return [];
  const open = new Set(commitments.items.filter((item) => item.status === 'open').map((item) => item.anchorId));
  return selection.filter((anchorId) => open.has(anchorId));
}

/** What "Select all" ticks ([] when it is not offered). */
export function selectAllAnchors(commitments: Pick<SummaryCommitments, 'items' | 'preselect'>): string[] {
  if (!commitments.preselect.selectAll) return [];
  return commitments.items
    .filter((item) => item.status === 'open' && !item.flags.includes('possible_instruction') && !isOwnerGuess(item))
    .map((item) => item.anchorId);
}

export function toggleSelection(selection: readonly string[], anchorId: string): string[] {
  return selection.includes(anchorId) ? selection.filter((id) => id !== anchorId) : [...selection, anchorId];
}

export interface CommitmentsFooter {
  label: TextRef;
  /** The number of tasks the button adds. */
  count: number;
  enabled: boolean;
  /** "Select the tasks you want to add." or "Connect to the internet to add these tasks." */
  hint: TextRef | null;
  showSelectAll: boolean;
  showClear: boolean;
}

/** The sticky footer of an editable list; null when nothing is open. */
export function commitmentsFooter(input: {
  commitments: Pick<SummaryCommitments, 'items' | 'preselect'>;
  selection: readonly string[];
  offline: boolean;
}): CommitmentsFooter | null {
  const open = input.commitments.items.filter((item) => item.status === 'open');
  if (open.length === 0) return null;
  const chosen = new Set(input.selection);
  const count = open.filter((item) => chosen.has(item.anchorId)).length;
  const label: TextRef =
    count === open.length
      ? { key: 'summaries:commitments.footer.acceptAll', params: { count } }
      : { key: 'summaries:commitments.footer.acceptSelected', params: { count } };
  const hint: TextRef | null = input.offline
    ? { key: 'summaries:commitments.footer.offline' }
    : count === 0
      ? { key: 'summaries:commitments.footer.nothingSelected' }
      : null;
  return {
    label,
    count,
    enabled: count > 0 && !input.offline,
    hint,
    showSelectAll: selectAllAnchors(input.commitments).some((anchorId) => !chosen.has(anchorId)),
    showClear: count > 0,
  };
}

// ---- Decide ------------------------------------------------------------------------------------------

export type AcceptBuild =
  | { ok: true; decisions: CommitmentDecision[]; drafts: Readonly<Record<string, CommitmentDraft>> }
  | { ok: false; reason: 'nothing' | 'pastPick' | 'invalid'; anchorId?: string };

/** An accept applies to an open suggestion, or to an accepted one whose task was deleted ("Add again"). */
function canAccept(item: CommitmentItem): boolean {
  return item.status === 'open' || (item.status === 'accepted' && item.taskExists === false);
}

/**
 * The accept decisions for `anchors` (the selection, or one "Add again"), each with its draft,
 * computed at `now` (the tap): the relative default reminders are recomputed here. Refused when
 * nothing applies, when a picked default reminder has passed, or when a draft breaks the task
 * invariants (the server would refuse the whole call).
 */
export function buildAcceptDecisions(input: {
  items: readonly CommitmentItem[];
  anchors: readonly string[];
  edits: Readonly<Record<string, CommitmentEdit>>;
  choice: ReminderDefault;
  now: Date;
  deviceZone: string;
}): AcceptBuild {
  const wanted = new Set(input.anchors);
  const targets = input.items.filter((item) => wanted.has(item.anchorId) && canAccept(item));
  if (targets.length === 0) return { ok: false, reason: 'nothing' };
  if (targets.length > COMMITMENT_LIMITS.maxDecisionsPerCall) return { ok: false, reason: 'invalid' };
  if (
    isPickedDefaultPast(input.choice, input.now, input.deviceZone) &&
    targets.some((item) => usesDefaultReminder(item, input.edits[item.anchorId]))
  ) {
    return { ok: false, reason: 'pastPick' };
  }
  const decisions: CommitmentDecision[] = [];
  const drafts: Record<string, CommitmentDraft> = {};
  for (const item of targets) {
    const draft = draftFor(item, input.edits[item.anchorId], input.choice, input.now, input.deviceZone);
    if (!commitmentDraftSchema.safeParse(draft).success) return { ok: false, reason: 'invalid', anchorId: item.anchorId };
    decisions.push({ anchorId: item.anchorId, decision: 'accept', draft });
    drafts[item.anchorId] = draft;
  }
  return { ok: true, decisions, drafts };
}

export interface DecideFeedback {
  /** The toast lines, the most important first. */
  messages: TextRef[];
  tone: 'success' | 'info';
  /** Undo was refused because the task changed since: the app offers Open task. */
  changed: boolean;
}

/**
 * What a decide answer says, from its results only ("Added 5 tasks. Their reminders are set on
 * this phone." only when the server created them and every one has a reminder; "Added 5 tasks."
 * when none has; the "some" wording for a mix).
 */
export function decideFeedback(results: readonly CommitmentDecisionResult[], drafts: Readonly<Record<string, CommitmentDraft>> = {}): DecideFeedback {
  const count = (outcome: CommitmentDecisionResult['outcome']): number => results.filter((result) => result.outcome === outcome).length;
  const added = results.filter((result) => result.outcome === 'added');
  const withReminder = added.filter((result) => (drafts[result.anchorId]?.reminderMinutesBefore ?? null) !== null).length;
  const messages: TextRef[] = [];
  if (added.length > 0) {
    messages.push({
      key:
        withReminder === added.length
          ? 'summaries:commitments.result.added'
          : withReminder === 0
            ? 'summaries:commitments.result.addedNoReminder'
            : 'summaries:commitments.result.addedSomeReminders',
      params: { count: added.length },
    });
  }
  if (count('already_added') > 0) messages.push({ key: 'summaries:commitments.result.alreadyAdded', params: { count: count('already_added') } });
  if (count('dropped') > 0) messages.push({ key: 'summaries:commitments.result.dropped' });
  if (count('restored') > 0) messages.push({ key: 'summaries:commitments.result.restored' });
  if (count('removed') > 0) messages.push({ key: 'summaries:commitments.result.removed' });
  const changed = count('changed') > 0;
  if (changed) messages.push({ key: 'summaries:commitments.result.changed' });
  if (count('not_open') > 0) messages.push({ key: 'summaries:commitments.result.notOpen', params: { count: count('not_open') } });
  return { messages, tone: added.length > 0 || count('removed') > 0 ? 'success' : 'info', changed };
}

/**
 * The message of a failed decide. A decide that timed out or failed upstream may have been
 * committed on the server (the service reloaded the list), so it never says a plain "Try again":
 * it says the change could not be confirmed and the list shows what was saved. Every other
 * failure keeps its own message (offline and refusals are known not to be saved).
 */
export function decideErrorKey(error: AppError): string {
  const reason = commitmentErrorReason(error);
  if (error.code === 'timeout' || (error.code === 'upstream_error' && (reason === null || reason === 'upstream_error'))) {
    return 'summaries:commitments.errors.decideUnconfirmed';
  }
  return commitmentErrorMessageKey(error);
}

// ---- Cards --------------------------------------------------------------------------------------------

/** Chips in the order they read: what to check first. */
const CHIP_FLAGS: readonly CommitmentFlag[] = [
  'payment_like',
  'possible_instruction',
  'owner_guess',
  'similar_added',
  'suggested',
  'checklist',
  'has_link',
  'truncated',
];
const WARNING_FLAGS: ReadonlySet<CommitmentFlag> = new Set<CommitmentFlag>(['payment_like', 'possible_instruction', 'owner_guess']);

/** Why an unticked suggestion is unticked (the first that applies). */
const REASON_FLAGS: readonly CommitmentFlag[] = [
  'possible_instruction',
  'payment_like',
  'suggested',
  'checklist',
  'similar_added',
  'owner_guess',
  'has_link',
  'truncated',
];

/** The server pre-selects only from this confidence on (COMMITMENTS_TUNING.preselectMinConfidence). */
export const LOW_CONFIDENCE_BELOW = 60;

export interface CardChip {
  label: TextRef;
  tone: BadgeTone;
}

export type CommitmentCardStatus = 'open' | 'accepted' | 'removed' | 'dropped';

export interface CommitmentCardView {
  anchorId: string;
  title: string;
  quote: string;
  section: TextRef | null;
  owner: TextRef;
  /** "A follow-up for you: the task title starts with Bish." */
  ownerNote: TextRef | null;
  due: TextRef[];
  chips: CardChip[];
  reason: TextRef | null;
  edited: boolean;
  status: CommitmentCardStatus;
  /** "Added in the app" / "Added on WhatsApp" for an accepted suggestion. */
  via: TextRef | null;
}

export function cardStatusOf(item: Pick<CommitmentItem, 'status' | 'taskExists'>): CommitmentCardStatus {
  if (item.status === 'dropped') return 'dropped';
  if (item.status === 'accepted') return item.taskExists === false ? 'removed' : 'accepted';
  return 'open';
}

function ownerRef(item: Pick<CommitmentItem, 'owner' | 'flags'>, edit: CommitmentEdit | null | undefined): TextRef {
  const choice = edit?.owner;
  if (choice !== undefined) {
    switch (choice.kind) {
      case 'you':
        return { key: 'summaries:commitments.owner.you' };
      case 'named':
        return item.owner !== null ? { key: 'summaries:commitments.owner.named', params: { name: item.owner.name } } : { key: 'summaries:commitments.owner.none' };
      case 'other':
        return { key: 'summaries:view.owner', params: { owner: ownerNameOf(choice, item.owner) ?? '' } };
      case 'nobody':
        return { key: 'summaries:commitments.owner.none' };
    }
  }
  if (item.owner === null) return { key: 'summaries:commitments.owner.none' };
  if (isOwnerGuess(item)) return { key: 'summaries:commitments.owner.guess', params: { name: item.owner.name } };
  if (item.owner.isUser) return { key: 'summaries:commitments.owner.you' };
  return { key: 'summaries:commitments.owner.named', params: { name: item.owner.name } };
}

function timeRef(time: string, zone: string | null, deviceZone: string, labels: WallClockLabels): TextParam {
  const text = labels.time(time);
  return zone !== null && zone !== deviceZone ? { key: 'summaries:commitments.due.meetingTime', params: { time: text, zone } } : text;
}

function scheduleRefs(schedule: CommitmentSchedule, labels: WallClockLabels): TextRef[] {
  if (schedule.dueDate === null) return [{ key: 'summaries:commitments.due.noReminder' }];
  const date = labels.date(schedule.dueDate);
  const refs: TextRef[] = [
    schedule.dueTime === null
      ? { key: 'summaries:commitments.due.date', params: { date } }
      : { key: 'summaries:commitments.due.dateTime', params: { date, time: labels.time(schedule.dueTime) } },
  ];
  if (schedule.reminderMinutesBefore === null) refs.push({ key: 'summaries:commitments.due.noReminder' });
  return refs;
}

/** The due lines of a card (section 11 wording). */
export function dueRefs(input: {
  item: Pick<CommitmentItem, 'due'>;
  edit: CommitmentEdit | null | undefined;
  choice: ReminderDefault;
  now: Date;
  deviceZone: string;
  labels: WallClockLabels;
}): TextRef[] {
  const { item, edit, labels } = input;
  if (edit?.schedule !== undefined) return scheduleRefs(edit.schedule, labels);
  const due = item.due;
  if (due === null) {
    if (input.choice.kind === 'none') return [{ key: 'summaries:commitments.due.noDate' }, { key: 'summaries:commitments.due.noReminder' }];
    return [{ key: 'summaries:commitments.due.noDateReminder', params: { when: reminderChoiceRef(input.choice, labels) } }];
  }
  const date = labels.date(due.date);
  if (isDueOverdue(due, input.now, input.deviceZone)) {
    return due.quote !== null
      ? [{ key: 'summaries:commitments.due.overdueQuote', params: { quote: due.quote } }]
      : [{ key: 'summaries:commitments.due.overdue', params: { date } }, { key: 'summaries:commitments.due.noReminderUntilPick' }];
  }
  // Due today but its time (or 9:00 for a date alone) has passed: the default sets no reminder, so
  // the card says so instead of letting the user expect one.
  const noReminder: TextRef[] =
    defaultSchedule(due, input.choice, input.now, input.deviceZone).reminderMinutesBefore === null
      ? [{ key: 'summaries:commitments.due.noReminderUntilPick' }]
      : [];
  if (due.time !== null) {
    const refs: TextRef[] = [
      { key: 'summaries:commitments.due.dateTime', params: { date, time: timeRef(due.time, due.zone, input.deviceZone, labels) } },
    ];
    if (due.quote !== null) refs.push({ key: 'summaries:commitments.due.says', params: { quote: due.quote } });
    return [...refs, ...noReminder];
  }
  return [
    due.quote !== null
      ? { key: 'summaries:commitments.due.withQuote', params: { date, quote: due.quote } }
      : { key: 'summaries:commitments.due.date', params: { date } },
    ...noReminder,
  ];
}

function chipsOf(item: CommitmentItem, overdue: boolean): CardChip[] {
  const chips: CardChip[] = [];
  if (overdue) chips.push({ label: { key: 'summaries:commitments.chip.overdue' }, tone: 'warning' });
  for (const flag of CHIP_FLAGS) {
    if (item.flags.includes(flag)) chips.push({ label: { key: `summaries:commitments.chip.${flag}` }, tone: WARNING_FLAGS.has(flag) ? 'warning' : 'neutral' });
  }
  if (item.confidence !== null && item.confidence < LOW_CONFIDENCE_BELOW) chips.push({ label: { key: 'summaries:commitments.chip.lowConfidence' }, tone: 'neutral' });
  return chips;
}

function reasonOf(item: CommitmentItem): TextRef | null {
  if (item.status !== 'open') return null;
  const flag = REASON_FLAGS.find((candidate) => item.flags.includes(candidate));
  if (flag !== undefined) return { key: `summaries:commitments.reason.${flag}` };
  if (isOwnerGuess(item)) return { key: 'summaries:commitments.reason.owner_guess' };
  if (item.confidence !== null && item.confidence < LOW_CONFIDENCE_BELOW) return { key: 'summaries:commitments.reason.lowConfidence' };
  return null;
}

/** One card: the title as it will be added, the quote, the owner, the due lines, chips and the reason. */
export function commitmentCardView(input: {
  item: CommitmentItem;
  edit: CommitmentEdit | null | undefined;
  choice: ReminderDefault;
  now: Date;
  deviceZone: string;
  labels: WallClockLabels;
}): CommitmentCardView {
  const { item, edit } = input;
  const status = cardStatusOf(item);
  const choice = edit?.owner ?? defaultOwnerChoice(item.owner);
  const otherName = choice.kind === 'named' || choice.kind === 'other' ? ownerNameOf(choice, item.owner) : null;
  const titleEdited = edit?.title !== undefined;
  const overdue = status === 'open' && edit?.schedule === undefined && isDueOverdue(item.due, input.now, input.deviceZone);
  return {
    anchorId: item.anchorId,
    title: status === 'open' ? editedTitle(item, edit) : item.title,
    quote: item.quote,
    section: item.sectionHeading !== null ? { key: 'summaries:commitments.card.section', params: { heading: item.sectionHeading } } : null,
    owner: status === 'open' ? ownerRef(item, edit) : ownerRef(item, null),
    ownerNote:
      status === 'open' && otherName !== null && !titleEdited && !isOwnerGuessShownAsYou(item, edit)
        ? { key: 'summaries:commitments.owner.followUp', params: { name: otherName } }
        : null,
    due: status === 'open' ? dueRefs(input) : [],
    chips: status === 'open' ? chipsOf(item, overdue) : [],
    reason: reasonOf(item),
    edited: status === 'open' && edit !== null && edit !== undefined && (edit.title !== undefined || edit.owner !== undefined || edit.schedule !== undefined),
    status,
    via:
      status === 'accepted' && item.via !== null
        ? { key: item.via === 'whatsapp' ? 'summaries:commitments.card.via.whatsapp' : 'summaries:commitments.card.via.app' }
        : null,
  };
}

/** A guess left as the user ("You?") is no follow-up. */
function isOwnerGuessShownAsYou(item: Pick<CommitmentItem, 'owner' | 'flags'>, edit: CommitmentEdit | null | undefined): boolean {
  return edit?.owner === undefined && isOwnerGuess(item);
}

/** The open edits of a list (the screen asks before leaving with any). */
export function hasOpenEdits(commitments: Pick<SummaryCommitments, 'items'> | null, edits: Readonly<Record<string, CommitmentEdit>>): boolean {
  if (commitments === null) return false;
  return commitments.items.some((item) => item.status === 'open' && edits[item.anchorId] !== undefined);
}

// ---- Retention -------------------------------------------------------------------------------------

/** A filed or kept summary is deleted this long after it arrived (functions SUMMARY_RETENTION_DAYS.filedOrKept). */
export const SUMMARY_FILED_RETENTION_DAYS = 365;

/** "This summary is kept until <date>": receivedAt plus the filed or kept retention (ISO), or null. */
export function summaryKeptUntil(receivedAt: string | null | undefined): string | null {
  if (typeof receivedAt !== 'string') return null;
  const ms = Date.parse(receivedAt);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms + SUMMARY_FILED_RETENTION_DAYS * 86_400_000).toISOString();
}

/** The mode a "Prepare again" uses: the last one seen on this screen, else the free one. */
export function prepareAgainMode(lastMode: CommitmentMode | null): CommitmentMode {
  return lastMode ?? 'as_written';
}

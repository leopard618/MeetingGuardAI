/**
 * Pure view-models for the assistant UI and the share text (no React / RN imports; unit-tested).
 * Every user-visible string comes from the "ai" namespace through the injected formatter.
 */
import type MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { ComponentProps } from 'react';

import {
  AI_LIMITS,
  type AiAction,
  type AiActionType,
  type AiMeetingChanges,
  type AiMeetingDraft,
  type AssistantUsage,
  type BulkUpdateAction,
  type ConferenceDetails,
  type Language,
  type MeetingLocation,
  type Plan,
  type RecurrenceRule,
  type ShareMeetingAction,
  type UpdateMeetingAction,
  type DeleteMeetingAction,
} from '../../core/aiContract';
import type { ActionResult, ActionWarning } from '../../core/contracts';
import { AppError, isAppError, type AppErrorCode } from '../../core/errors';
import type { Meeting } from '../../core/types';
// Service-layer file: tokens are imported directly (never the src/theme barrel, which pulls in
// React hooks) — docs/DESIGN_SYSTEM.md §7 group D.
import { mgColors, type MGColors } from '../../theme/tokens';

import { quotaUsageFromError } from './assistantClient';
import { draftLocalDate, shiftedStartAt, windowAfterChanges } from './mapping';
import { recurrenceScopeText, recurrenceSummary } from './recurrenceText';
import type { AiActionPreview, AiActionResult, AssistantFormatter } from './types';

// ---------------------------------------------------------------------------------------------
// Field formatting
// ---------------------------------------------------------------------------------------------

export type MeetingField =
  | 'title'
  | 'when'
  | 'duration'
  | 'description'
  | 'location'
  | 'conference'
  | 'participants'
  | 'tips'
  | 'alerts'
  | 'language'
  | 'repeats'
  | 'scope';

export interface DetailRow {
  field: MeetingField;
  label: string;
  value: string;
}

export interface DiffRow {
  field: MeetingField;
  label: string;
  before: string;
  after: string;
}

const DESCRIPTION_PREVIEW_CHARS = 300;

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function fieldLabel(fmt: AssistantFormatter, field: MeetingField): string {
  return fmt.t(`ai:fields.${field}`);
}

export function formatWhen(
  fmt: AssistantFormatter,
  value: { startAt: string; durationMinutes: number; allDay: boolean; timezone: string; date?: string },
): string {
  const date = value.date ?? draftLocalDate({ startAt: value.startAt, timezone: value.timezone });
  const range = fmt.meetingTime({ startAt: value.startAt, durationMinutes: value.durationMinutes, allDay: value.allDay, date });
  // Timed meetings are shown in the device zone; say so when the meeting was planned elsewhere.
  if (!value.allDay && value.timezone !== fmt.timeZone) {
    return fmt.t('ai:values.inZone', { when: range, zone: fmt.timeZone });
  }
  return range;
}

export function formatLocation(fmt: AssistantFormatter, location: MeetingLocation | null): string {
  if (!location) return fmt.t('ai:values.none');
  const parts = [location.address, location.virtualUrl].filter((part): part is string => !!part && part.trim() !== '');
  if (parts.length > 0) return parts.join(' · ');
  return fmt.t(`ai:values.locationType.${location.type}`);
}

export function formatConference(fmt: AssistantFormatter, conference: ConferenceDetails | null): string {
  if (!conference) return fmt.t('ai:values.none');
  const provider = fmt.t(`ai:values.provider.${conference.provider}`);
  const parts = [provider];
  if (conference.url) parts.push(conference.url);
  else parts.push(conference.provider === 'google_meet' ? fmt.t('ai:values.meetLinkPending') : fmt.t('ai:values.noLinkYet'));
  if (conference.password) parts.push(fmt.t('ai:values.password', { password: conference.password }));
  return parts.join(' · ');
}

export function formatParticipants(fmt: AssistantFormatter, participants: readonly { email: string; name: string | null }[]): string {
  if (participants.length === 0) return fmt.t('ai:values.none');
  return participants.map((p) => (p.name ? `${p.name} <${p.email}>` : p.email)).join(', ');
}

/** One reminder offset: "At start", "10 min before", "1 h before", "1 day before". */
function formatAlertOffset(fmt: AssistantFormatter, minutes: number): string {
  if (minutes === 0) return fmt.t('ai:values.alertAtStart');
  return fmt.t('ai:values.alertBefore', { duration: fmt.duration(minutes) });
}

/** "1 day before, 1 h before, At start" (earliest reminder first), like the rest of the app. */
export function formatAlertTimes(fmt: AssistantFormatter, times: readonly number[] | null): string {
  if (times === null) return fmt.t('ai:values.defaultAlerts');
  if (times.length === 0) return fmt.t('ai:values.noAlerts');
  const sorted = [...new Set(times)].sort((a, b) => b - a);
  return sorted.map((minutes) => formatAlertOffset(fmt, minutes)).join(', ');
}

function formatTips(fmt: AssistantFormatter, tips: readonly string[]): string {
  return tips.length === 0 ? fmt.t('ai:values.none') : tips.map((tip) => `• ${tip}`).join('\n');
}

function formatLanguage(fmt: AssistantFormatter, language: Language): string {
  return fmt.t(`ai:values.language.${language}`);
}

function formatDescription(fmt: AssistantFormatter, description: string): string {
  return description.trim() === '' ? fmt.t('ai:values.none') : truncate(description.trim(), DESCRIPTION_PREVIEW_CHARS);
}

/** "Repeats every 2 weeks on Monday, until <date>" / "Does not repeat" (rule null). */
export function formatRecurrence(
  fmt: AssistantFormatter,
  rule: RecurrenceRule | null,
  context: { anchorDate?: string | null; timezone?: string | null },
): string {
  return recurrenceSummary(fmt.t, rule, {
    formatDate: (localDate) => fmt.date(localDate),
    anchorDate: context.anchorDate ?? null,
    timezone: context.timezone ?? fmt.timeZone,
  });
}

// ---------------------------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------------------------

/** Rows for a create_meeting confirmation card (empty optional fields are left out). */
export function describeDraft(fmt: AssistantFormatter, draft: AiMeetingDraft): DetailRow[] {
  const rows: DetailRow[] = [
    { field: 'title', label: fieldLabel(fmt, 'title'), value: draft.title },
    { field: 'when', label: fieldLabel(fmt, 'when'), value: formatWhen(fmt, draft) },
    { field: 'duration', label: fieldLabel(fmt, 'duration'), value: draft.allDay ? fmt.t('ai:values.allDay') : fmt.duration(draft.durationMinutes) },
  ];
  if (draft.recurrence != null) {
    rows.push({
      field: 'repeats',
      label: fieldLabel(fmt, 'repeats'),
      value: formatRecurrence(fmt, draft.recurrence, { anchorDate: draftLocalDate(draft), timezone: draft.timezone }),
    });
  }
  if (draft.location) rows.push({ field: 'location', label: fieldLabel(fmt, 'location'), value: formatLocation(fmt, draft.location) });
  if (draft.conference) rows.push({ field: 'conference', label: fieldLabel(fmt, 'conference'), value: formatConference(fmt, draft.conference) });
  if (draft.participants.length > 0) {
    rows.push({ field: 'participants', label: fieldLabel(fmt, 'participants'), value: formatParticipants(fmt, draft.participants) });
  }
  if (draft.description.trim() !== '') {
    rows.push({ field: 'description', label: fieldLabel(fmt, 'description'), value: formatDescription(fmt, draft.description) });
  }
  if (draft.preparationTips.length > 0) rows.push({ field: 'tips', label: fieldLabel(fmt, 'tips'), value: formatTips(fmt, draft.preparationTips) });
  rows.push({ field: 'alerts', label: fieldLabel(fmt, 'alerts'), value: formatAlertTimes(fmt, draft.customAlertTimes) });
  return rows;
}

/** Rows identifying an existing meeting (delete / share / list cards). */
export function describeMeeting(fmt: AssistantFormatter, meeting: Meeting): DetailRow[] {
  const rows: DetailRow[] = [
    { field: 'title', label: fieldLabel(fmt, 'title'), value: meeting.title },
    { field: 'when', label: fieldLabel(fmt, 'when'), value: formatWhen(fmt, meeting) },
  ];
  if (meeting.recurrence !== null) {
    rows.push({
      field: 'repeats',
      label: fieldLabel(fmt, 'repeats'),
      value: formatRecurrence(fmt, meeting.recurrence, { anchorDate: meeting.date, timezone: meeting.timezone }),
    });
  }
  if (meeting.location) rows.push({ field: 'location', label: fieldLabel(fmt, 'location'), value: formatLocation(fmt, meeting.location) });
  if (meeting.conference) rows.push({ field: 'conference', label: fieldLabel(fmt, 'conference'), value: formatConference(fmt, meeting.conference) });
  if (meeting.participants.length > 0) {
    rows.push({ field: 'participants', label: fieldLabel(fmt, 'participants'), value: formatParticipants(fmt, meeting.participants) });
  }
  return rows;
}

/** Before/after rows for every field an update really changes. */
export function computeUpdateDiff(fmt: AssistantFormatter, meeting: Meeting, changes: AiMeetingChanges): DiffRow[] {
  const rows: DiffRow[] = [];
  const push = (field: MeetingField, before: string, after: string): void => {
    if (before !== after) rows.push({ field, label: fieldLabel(fmt, field), before, after });
  };

  if (changes.title !== undefined) push('title', meeting.title, changes.title);
  if (changes.startAt !== undefined || changes.allDay !== undefined || changes.timezone !== undefined || changes.durationMinutes !== undefined) {
    const next = windowAfterChanges(meeting, changes);
    const timezone = changes.timezone ?? meeting.timezone;
    push('when', formatWhen(fmt, meeting), formatWhen(fmt, { ...next, timezone }));
  }
  if (changes.durationMinutes !== undefined) {
    push('duration', fmt.duration(meeting.durationMinutes), fmt.duration(changes.durationMinutes));
  }
  if (changes.location !== undefined) push('location', formatLocation(fmt, meeting.location), formatLocation(fmt, changes.location));
  if (changes.conference !== undefined) {
    push('conference', formatConference(fmt, meeting.conference), formatConference(fmt, changes.conference));
  }
  if (changes.participants !== undefined) {
    push('participants', formatParticipants(fmt, meeting.participants), formatParticipants(fmt, changes.participants));
  }
  if (changes.description !== undefined) {
    push('description', formatDescription(fmt, meeting.description), formatDescription(fmt, changes.description));
  }
  if (changes.preparationTips !== undefined) {
    push('tips', formatTips(fmt, meeting.preparationTips), formatTips(fmt, changes.preparationTips));
  }
  if (changes.customAlertTimes !== undefined) {
    push('alerts', formatAlertTimes(fmt, meeting.customAlertTimes), formatAlertTimes(fmt, changes.customAlertTimes));
  }
  if (changes.language !== undefined) push('language', formatLanguage(fmt, meeting.language), formatLanguage(fmt, changes.language));
  if (changes.recurrence !== undefined) {
    const context = { anchorDate: meeting.date, timezone: meeting.timezone };
    push('repeats', formatRecurrence(fmt, meeting.recurrence, context), formatRecurrence(fmt, changes.recurrence, context));
  }
  return rows;
}

/** "30 min later" / "1 h earlier". */
export function formatShift(fmt: AssistantFormatter, shiftMinutes: number): string {
  const amount = fmt.duration(Math.abs(shiftMinutes));
  return shiftMinutes > 0 ? fmt.t('ai:values.shiftLater', { amount }) : fmt.t('ai:values.shiftEarlier', { amount });
}

export interface BulkItem {
  meetingId: string;
  title: string;
  before: string;
  /** New time when shifting; null when the time does not change (or the meeting cannot be shifted). */
  after: string | null;
  /** true when this meeting will be skipped (all-day meeting and a non-whole-day shift). */
  skipped: boolean;
}

export interface BulkDescription {
  /** Lines describing what changes for every meeting. */
  changes: string[];
  items: BulkItem[];
}

/**
 * New values only ("Title: Budget review") for changes whose current values are unknown (bulk
 * updates, or an update card whose meeting preview is not available).
 */
export function describeChangeRows(fmt: AssistantFormatter, changes: AiMeetingChanges): DetailRow[] {
  const rows: DetailRow[] = [];
  const add = (field: MeetingField, value: string): void => {
    rows.push({ field, label: fieldLabel(fmt, field), value });
  };
  if (changes.title !== undefined) add('title', changes.title);
  if (changes.startAt !== undefined) {
    const timezone = changes.timezone ?? fmt.timeZone;
    const allDay = changes.allDay ?? false;
    add('when', formatWhen(fmt, { startAt: changes.startAt, durationMinutes: changes.durationMinutes ?? 60, allDay, timezone }));
  } else if (changes.allDay !== undefined) {
    add('when', changes.allDay ? fmt.t('ai:values.allDay') : fmt.t('ai:values.timed'));
  }
  if (changes.durationMinutes !== undefined) add('duration', fmt.duration(changes.durationMinutes));
  if (changes.location !== undefined) add('location', formatLocation(fmt, changes.location));
  if (changes.conference !== undefined) add('conference', formatConference(fmt, changes.conference));
  if (changes.participants !== undefined) add('participants', formatParticipants(fmt, changes.participants));
  if (changes.description !== undefined) add('description', formatDescription(fmt, changes.description));
  if (changes.preparationTips !== undefined) add('tips', formatTips(fmt, changes.preparationTips));
  if (changes.customAlertTimes !== undefined) add('alerts', formatAlertTimes(fmt, changes.customAlertTimes));
  if (changes.language !== undefined) add('language', formatLanguage(fmt, changes.language));
  if (changes.recurrence !== undefined) {
    add('repeats', formatRecurrence(fmt, changes.recurrence, { timezone: changes.timezone ?? null }));
  }
  if (changes.timezone !== undefined && changes.startAt === undefined) {
    rows.push({ field: 'when', label: fieldLabel(fmt, 'when'), value: fmt.t('ai:values.timezoneChange', { zone: changes.timezone }) });
  }
  return rows;
}

/**
 * The "Applies to" row of an update/delete card: "Only the occurrence on <date>" for scoped
 * actions, "The whole repeating series" when the target repeats, null for plain one-off actions.
 */
export function describeScopeRow(
  fmt: AssistantFormatter,
  action: UpdateMeetingAction | DeleteMeetingAction,
  targetMeeting: Meeting | null,
): DetailRow | null {
  const value = recurrenceScopeText(fmt.t, {
    scope: action.scope,
    occurrenceDate: action.occurrenceDate ?? null,
    targetRecurring: targetMeeting !== null && targetMeeting.recurrence !== null,
    formatDate: (localDate) => fmt.date(localDate),
  });
  if (value === null) return null;
  return { field: 'scope', label: fieldLabel(fmt, 'scope'), value };
}

/** True when a delete action removes one occurrence, not the meeting (softer card copy). */
export function isOccurrenceDelete(action: DeleteMeetingAction, targetMeeting: Meeting | null): boolean {
  return action.scope === 'occurrence' && action.occurrenceDate != null && targetMeeting?.recurrence != null;
}

/**
 * The warning line of a delete card: scoped deletes of a recurring meeting keep part of the
 * series, so they must not claim the whole meeting disappears. `synced` = the meeting is linked
 * to Google or the device calendar (the whole-meeting warning then mentions the removal there).
 */
export function deleteWarningKey(action: DeleteMeetingAction, targetMeeting: Meeting | null, synced: boolean): string {
  if (isOccurrenceDelete(action, targetMeeting)) return 'ai:confirm.deleteOccurrenceWarning';
  if (action.scope === 'following' && action.occurrenceDate != null && targetMeeting?.recurrence != null) {
    return 'ai:confirm.deleteFollowingWarning';
  }
  return synced ? 'ai:confirm.deleteWarningSynced' : 'ai:confirm.deleteWarning';
}

export function describeBulk(fmt: AssistantFormatter, action: BulkUpdateAction, meetings: readonly Meeting[]): BulkDescription {
  const changes: string[] = [];
  if (action.shiftMinutes !== null) changes.push(formatShift(fmt, action.shiftMinutes));
  if (action.changes) {
    for (const row of describeChangeRows(fmt, action.changes)) changes.push(`${row.label}: ${row.value}`);
  }

  const byId = new Map(meetings.map((m) => [m.id, m]));
  const items: BulkItem[] = [];
  for (const id of action.meetingIds) {
    const meeting = byId.get(id);
    if (!meeting) continue;
    let after: string | null = null;
    let skipped = false;
    if (action.shiftMinutes !== null) {
      const startAt = shiftedStartAt(meeting, action.shiftMinutes);
      if (startAt === null) skipped = true;
      else after = formatWhen(fmt, { startAt, durationMinutes: meeting.durationMinutes, allDay: meeting.allDay, timezone: meeting.timezone });
    }
    items.push({ meetingId: id, title: meeting.title, before: formatWhen(fmt, meeting), after, skipped });
  }
  return { changes, items };
}

export interface ShareDescription {
  channel: string;
  recipients: string[];
  message: string | null;
}

export function describeShare(fmt: AssistantFormatter, action: ShareMeetingAction): ShareDescription {
  return {
    channel: fmt.t(`ai:share.channel.${action.channel}`),
    recipients: action.channel === 'email' ? [...action.recipients] : [],
    message: action.message && action.message.trim() !== '' ? action.message.trim() : null,
  };
}

export function describeWarnings(
  fmt: AssistantFormatter,
  preview: Pick<AiActionPreview, 'warnings' | 'missingMeetingIds'> & {
    overlapping?: readonly Meeting[];
    newPeople?: readonly string[];
  },
): string[] {
  return preview.warnings.map((warning: ActionWarning) => {
    if (warning === 'meeting_not_found') return fmt.t('ai:warnings.meeting_not_found', { count: Math.max(1, preview.missingMeetingIds.length) });
    if (warning === 'new_people') {
      const emails = (preview.newPeople ?? []).join(', ');
      return fmt.t('ai:warnings.new_people', { emails, interpolation: { escapeValue: false } });
    }
    if (warning === 'overlaps_existing') {
      const titles = (preview.overlapping ?? []).map((m) => m.title).slice(0, 3).join(', ');
      return titles ? fmt.t('ai:warnings.overlaps_with', { titles }) : fmt.t('ai:warnings.overlaps_existing');
    }
    return fmt.t(`ai:warnings.${warning}`);
  });
}

export function isDestructiveAction(action: AiAction): boolean {
  return action.type === 'delete_meeting';
}

export type AssistantIconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

/** MaterialCommunityIcons glyph per action type. */
export function actionIconName(type: AiActionType): AssistantIconName {
  switch (type) {
    case 'create_meeting':
      return 'calendar-plus';
    case 'update_meeting':
      return 'calendar-edit';
    case 'delete_meeting':
      return 'calendar-remove';
    case 'share_meeting':
      return 'share-variant';
    case 'bulk_update':
      return 'calendar-multiple-check';
    case 'list':
      return 'format-list-bulleted';
  }
}

// ---------------------------------------------------------------------------------------------
// Results, errors, usage
// ---------------------------------------------------------------------------------------------

export type FeedbackTone = 'success' | 'warning' | 'error' | 'info';

export interface Feedback {
  tone: FeedbackTone;
  message: string;
}

function errorText(fmt: AssistantFormatter, code: AppErrorCode): string {
  return fmt.t(`common:errors.${code}`);
}

/** One-line feedback for an executed action (snackbar + card footer). */
export function describeResult(fmt: AssistantFormatter, result: ActionResult | AiActionResult): Feedback {
  if (result.status === 'failed') {
    if (result.error.code === 'cancelled') return { tone: 'info', message: fmt.t('ai:results.cancelled') };
    return { tone: 'error', message: fmt.t('ai:results.failed', { reason: errorText(fmt, result.error.code) }) };
  }
  const extra = result as AiActionResult & { status: 'done' };
  if (result.duplicate) return { tone: 'info', message: fmt.t('ai:results.duplicate') };
  const meetNote = (): string | null => {
    if (result.meetLinkCreated === true) return fmt.t('ai:results.meetLinkCreated');
    if (result.meetLinkCreated === false) {
      return extra.meetLinkError === 'calendar_not_connected' || extra.meetLinkError === 'calendar_scope_missing' || extra.meetLinkError === 'google_not_signed_in'
        ? fmt.t('ai:results.meetLinkNeedsCalendar')
        : fmt.t('ai:results.meetLinkFailed');
    }
    return null;
  };
  const withMeet = (base: string): Feedback => {
    const note = meetNote();
    return note ? { tone: result.meetLinkCreated === false ? 'warning' : 'success', message: `${base} ${note}` } : { tone: 'success', message: base };
  };

  switch (result.type) {
    case 'create_meeting':
      return withMeet(fmt.t('ai:results.created'));
    case 'update_meeting':
      return withMeet(fmt.t('ai:results.updated'));
    case 'delete_meeting':
      return { tone: 'success', message: fmt.t('ai:results.deleted') };
    case 'bulk_update': {
      const skipped = extra.skippedMeetingIds?.length ?? 0;
      const base = fmt.t('ai:results.bulkUpdated', { count: result.meetingIds.length });
      if (skipped > 0) return { tone: 'warning', message: `${base} ${fmt.t('ai:results.bulkSkipped', { count: skipped })}` };
      return withMeet(base);
    }
    case 'share_meeting':
      if (result.delivery === 'mail_composer') {
        return { tone: 'success', message: fmt.t('ai:results.mailComposer', { recipients: (extra.recipients ?? []).join(', ') }) };
      }
      if (result.delivery === 'google_invite') return { tone: 'success', message: fmt.t('ai:results.googleInvite') };
      return { tone: 'success', message: fmt.t('ai:results.systemShare') };
    case 'list':
      return { tone: 'info', message: fmt.t('ai:results.listed', { count: result.meetingIds.length }) };
  }
}

export type ErrorRecovery = 'retry' | 'upgrade' | 'none';

export interface ErrorDescription {
  message: string;
  recovery: ErrorRecovery;
}

function planLabel(fmt: AssistantFormatter, plan: Plan): string {
  return fmt.t(`ai:usage.plan.${plan}`);
}

/** Inline chat error for a failed assistant request. */
export function describeAssistantError(fmt: AssistantFormatter, error: AppError | unknown, now: Date = new Date()): ErrorDescription {
  const appError = isAppError(error) ? error : new AppError('unknown');
  switch (appError.code) {
    case 'quota_exceeded': {
      const usage = quotaUsageFromError(appError);
      const message = usage
        ? fmt.t('ai:errors.quota', {
            limit: usage.limit,
            plan: planLabel(fmt, usage.plan),
            reset: fmt.relative(usage.resetsAt, now),
          })
        : fmt.t('ai:errors.quotaUnknown');
      return { message, recovery: usage?.plan === 'premium' ? 'none' : 'upgrade' };
    }
    case 'offline':
      return { message: fmt.t('ai:errors.offline'), recovery: 'retry' };
    case 'timeout':
      return { message: fmt.t('ai:errors.timeout'), recovery: 'retry' };
    case 'upstream_error':
      return { message: fmt.t('ai:errors.upstream'), recovery: 'retry' };
    case 'unauthenticated':
      return { message: fmt.t('ai:errors.unauthenticated'), recovery: 'none' };
    case 'invalid_input':
      return { message: fmt.t('ai:errors.invalid'), recovery: 'none' };
    case 'not_configured':
      return { message: fmt.t('ai:errors.notConfigured'), recovery: 'none' };
    default:
      return { message: errorText(fmt, appError.code), recovery: appError.retryable ? 'retry' : 'none' };
  }
}

export interface UsageDescription {
  label: string;
  accessibilityLabel: string;
  exhausted: boolean;
}

/**
 * Usage pill: "3/5 today" when today's usage is known, otherwise the plan's daily limit.
 * Usage from a previous UTC day counts as 0 used.
 */
export function describeUsage(
  fmt: AssistantFormatter,
  usage: AssistantUsage | null,
  fallback: { plan: Plan; limit: number } | null,
  now: Date = new Date(),
): UsageDescription | null {
  if (usage) {
    const fresh = new Date(usage.resetsAt).getTime() > now.getTime();
    const used = fresh ? Math.min(usage.used, usage.limit) : 0;
    const plan = planLabel(fmt, usage.plan);
    return {
      label: fmt.t('ai:usage.today', { used, limit: usage.limit, plan }),
      accessibilityLabel: fmt.t('ai:usage.a11y', { used, limit: usage.limit, plan }),
      exhausted: used >= usage.limit,
    };
  }
  if (!fallback) return null;
  const plan = planLabel(fmt, fallback.plan);
  return {
    label: fmt.t('ai:usage.perDay', { limit: fallback.limit, plan }),
    accessibilityLabel: fmt.t('ai:usage.a11yPlan', { limit: fallback.limit, plan }),
    exhausted: false,
  };
}

// ---------------------------------------------------------------------------------------------
// Share text
// ---------------------------------------------------------------------------------------------

export interface ShareContent {
  subject: string;
  body: string;
}

const SHARE_DESCRIPTION_CHARS = 1000;

/** Localized, plain-text meeting summary for email / the share sheet. */
export function buildShareContent(
  fmt: AssistantFormatter,
  meeting: Meeting,
  options: { message: string | null; recipients?: readonly string[] },
): ShareContent {
  const lines: string[] = [];
  const message = options.message?.trim();
  if (message) lines.push(truncate(message, AI_LIMITS.maxShareMessageChars), '');
  lines.push(meeting.title);
  lines.push(fmt.t('ai:share.when', { when: formatWhen(fmt, meeting) }));
  if (!meeting.allDay) lines.push(fmt.t('ai:share.duration', { duration: fmt.duration(meeting.durationMinutes) }));
  if (meeting.location?.address) lines.push(fmt.t('ai:share.location', { location: meeting.location.address }));
  const joinUrl = meeting.conference?.url ?? meeting.location?.virtualUrl ?? null;
  if (joinUrl) {
    const provider = meeting.conference ? fmt.t(`ai:values.provider.${meeting.conference.provider}`) : null;
    lines.push(provider ? fmt.t('ai:share.joinWith', { provider, url: joinUrl }) : fmt.t('ai:share.join', { url: joinUrl }));
  }
  if (meeting.conference?.password) lines.push(fmt.t('ai:share.password', { password: meeting.conference.password }));
  if (meeting.description.trim() !== '') lines.push('', truncate(meeting.description.trim(), SHARE_DESCRIPTION_CHARS));
  if (options.recipients && options.recipients.length > 0) {
    lines.push('', fmt.t('ai:share.to', { recipients: options.recipients.join(', ') }));
  }
  lines.push('', fmt.t('ai:share.footer'));
  return { subject: fmt.t('ai:share.subject', { title: meeting.title }), body: lines.join('\n') };
}

/** RFC 6068 mailto: URL (CRLF line breaks, '@' kept readable in the address list). */
export function buildMailtoUrl(recipients: readonly string[], content: ShareContent): string {
  const to = recipients.map((email) => encodeURIComponent(email).replace(/%40/g, '@')).join(',');
  const body = content.body.replace(/\r?\n/g, '\r\n');
  return `mailto:${to}?subject=${encodeURIComponent(content.subject)}&body=${encodeURIComponent(body)}`;
}

// ---------------------------------------------------------------------------------------------
// Colors (light / dark), shared by the chat screen and the confirmation modal
// ---------------------------------------------------------------------------------------------

/**
 * Every value is an MG Indigo token (src/theme/tokens.ts) — docs/DESIGN_SYSTEM.md §7 group D.
 * The legacy emerald/slate literals are gone; the field names stay so consumers compile, and a
 * few token-named fields were added for the restyled chat pieces. All pairings are AA in both
 * schemes (see src/theme/__tests__/contrast.test.ts for the documented pairs).
 */
export interface AssistantPalette {
  background: string;
  surface: string;
  /** surfaceContainerHigh: assistant bubble, avatar circle, status chips. */
  surfaceAlt: string;
  /** outlineVariant: decorative hairlines (card edges, dividers). */
  border: string;
  /** outline: functional borders (unselected suggestion chips). */
  outline: string;
  /** surfaceContainerLow: the composer input at rest. */
  inputSurface: string;
  text: string;
  textMuted: string;
  primary: string;
  onPrimary: string;
  userBubble: string;
  onUserBubble: string;
  assistantBubble: string;
  onAssistantBubble: string;
  /** tertiaryContainer / onTertiaryContainer: action-card icon circles. */
  accentSurface: string;
  onAccentSurface: string;
  danger: string;
  onDanger: string;
  dangerSurface: string;
  onDangerSurface: string;
  warning: string;
  warningSurface: string;
  onWarningSurface: string;
  success: string;
  successSurface: string;
  onSuccessSurface: string;
  info: string;
  infoSurface: string;
  onInfoSurface: string;
  /** Disabled controls (docs/DESIGN_SYSTEM.md par.8): surfaceDisabled fill + disabled label/icon. */
  disabledText: string;
  surfaceDisabled: string;
  onSurfaceDisabled: string;
  backdrop: string;
}

function paletteFromTokens(c: MGColors): AssistantPalette {
  return {
    background: c.background,
    surface: c.surface,
    surfaceAlt: c.surfaceContainerHigh,
    border: c.outlineVariant,
    outline: c.outline,
    inputSurface: c.surfaceContainerLow,
    text: c.onSurface,
    textMuted: c.onSurfaceVariant,
    primary: c.primary,
    onPrimary: c.onPrimary,
    userBubble: c.primary,
    onUserBubble: c.onPrimary,
    assistantBubble: c.surfaceContainerHigh,
    onAssistantBubble: c.onSurface,
    accentSurface: c.tertiaryContainer,
    onAccentSurface: c.onTertiaryContainer,
    danger: c.error,
    onDanger: c.onError,
    dangerSurface: c.errorContainer,
    onDangerSurface: c.onErrorContainer,
    warning: c.warning,
    warningSurface: c.warningContainer,
    onWarningSurface: c.onWarningContainer,
    success: c.success,
    successSurface: c.successContainer,
    onSuccessSurface: c.onSuccessContainer,
    info: c.info,
    infoSurface: c.infoContainer,
    onInfoSurface: c.onInfoContainer,
    disabledText: c.disabledText,
    surfaceDisabled: c.surfaceDisabled,
    onSurfaceDisabled: c.onSurfaceDisabled,
    backdrop: c.backdrop,
  };
}

const LIGHT: AssistantPalette = paletteFromTokens(mgColors.light);

const DARK: AssistantPalette = paletteFromTokens(mgColors.dark);

export function assistantPalette(isDarkMode: boolean): AssistantPalette {
  return isDarkMode ? DARK : LIGHT;
}

/** Container trio per tone (on-color on container — AA in both schemes by the contrast guard). */
export function feedbackColors(palette: AssistantPalette, tone: FeedbackTone): { color: string; background: string } {
  switch (tone) {
    case 'success':
      return { color: palette.onSuccessSurface, background: palette.successSurface };
    case 'warning':
      return { color: palette.onWarningSurface, background: palette.warningSurface };
    case 'error':
      return { color: palette.onDangerSurface, background: palette.dangerSurface };
    case 'info':
      return { color: palette.onInfoSurface, background: palette.infoSurface };
  }
}

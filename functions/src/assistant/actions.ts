/**
 * Tool calls -> AiAction[] (proposals only; the app confirms and executes them).
 *
 * Every call is parsed, re-validated (zod), resolved against the meeting context and finally
 * checked with the shared `aiActionSchema`. Anything invalid is DROPPED (counted, never repaired
 * into something the user did not ask for):
 * - refs that are not in the context (the model cannot target other meetings);
 * - dates/times that do not exist; empty updates; bulk updates without refs;
 * - conference URLs / passwords the user did not type;
 * - email addresses the user did not type, unless they already belong to the meeting the action
 *   targets (share / update) or, in follow-up mode, to the meeting that just ended (create).
 *   Addresses of OTHER meetings in the context are never accepted: calendar invitations are written
 *   by third parties, so an injected instruction could otherwise route a meeting (with its link and
 *   password) or an invitation to an attacker who is merely a participant of some other meeting.
 * Text the user sent by tapping a suggestion chip is model-written and does not count as typed
 * (collectUserText in ./prompt.ts leaves it out).
 */
import { randomBytes } from 'node:crypto';

import { CONTEXT_WINDOW } from '../config';
import {
  AI_LIMITS,
  aiActionSchema,
  emailSchema,
  httpUrlSchema,
  recurrenceRuleSchema,
  type AiAction,
  type AiMeetingChanges,
  type AiMeetingDraft,
  type AiParticipant,
  type AssistantMode,
  type ConferenceDetails,
  type Language,
  type MeetingLocation,
  type PendingResolution,
  type RecurrenceRule,
} from '../shared/aiContract';
import type { ContextMeeting, MeetingContext } from './context';
import {
  formatIsoWithOffset,
  isValidLocalDate,
  isValidLocalTime,
  isValidTimeZone,
  toLocalDate,
  toLocalTime,
  zonedDateTimeToInstant,
} from './time';
import {
  TOOL_NAMES,
  bulkUpdateArgsSchema,
  createMeetingArgsSchema,
  deleteMeetingArgsSchema,
  listMeetingsArgsSchema,
  resolvePendingArgsSchema,
  shareMeetingArgsSchema,
  suggestRepliesArgsSchema,
  updateMeetingArgsSchema,
  type BulkChangesArgs,
  type RecurrenceArgs,
  type UpdateChangesArgs,
} from './tools';

export interface ToolCall {
  name: string;
  /** Raw JSON arguments from the model. */
  arguments: string;
}

export interface MappingContext {
  language: Language;
  mode: AssistantMode;
  userTimeZone: string;
  context: MeetingContext;
  /** Concatenated text of the user's own messages. */
  userText: string;
  newActionId?: () => string;
}

export const DROP_REASONS = [
  'unknown_tool',
  'bad_json',
  'bad_args',
  'unknown_ref',
  'invalid_datetime',
  'empty_changes',
  'not_allowed',
  'duplicate',
  'limit',
  'contract',
] as const;
export type DropReason = (typeof DROP_REASONS)[number];

export interface MappingResult {
  actions: AiAction[];
  suggestions: string[];
  /** v4: the model resolved the request's pending proposals (handler gates and applies it). */
  resolution: PendingResolution | null;
  dropped: Partial<Record<DropReason, number>>;
}

class DropError extends Error {
  constructor(readonly reason: DropReason) {
    super(reason);
  }
}

const drop = (reason: DropReason): never => {
  throw new DropError(reason);
};

const DEFAULT_DURATION_MINUTES = 60;
const ALL_DAY_MINUTES = 1_440;

export function newActionId(): string {
  return `act_${randomBytes(10).toString('hex')}`;
}

function clip(value: string, max: number): string {
  const trimmed = value.trim();
  return trimmed.length > max ? trimmed.slice(0, max).trimEnd() : trimmed;
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 50;
  return Math.min(100, Math.max(0, Math.round(value)));
}

// ---------------------------------------------------------------------------------------------
// "Typed by the user" checks
// ---------------------------------------------------------------------------------------------

interface Provenance {
  userText: string;
  userTextLower: string;
}

const NO_EMAILS: ReadonlySet<string> = new Set<string>();

function buildProvenance(ctx: MappingContext): Provenance {
  return { userText: ctx.userText, userTextLower: ctx.userText.toLowerCase() };
}

/** Participant addresses of one meeting (lower-cased): the only non-typed addresses an action may use. */
function emailsOf(meeting: ContextMeeting | null): ReadonlySet<string> {
  return meeting ? new Set(meeting.participantEmails) : NO_EMAILS;
}

function stripScheme(url: string): string {
  return url.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
}

/** An http(s) URL the user typed (with or without scheme); null otherwise. */
export function acceptTypedUrl(candidate: string | null, provenance: Provenance): string | null {
  if (candidate === null) return null;
  const trimmed = candidate.trim();
  if (trimmed.length === 0) return null;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  if (!httpUrlSchema.safeParse(withScheme).success) return null;
  const bare = stripScheme(withScheme);
  if (bare.length < 4) return null;
  const typed = provenance.userText.includes(trimmed) || provenance.userText.includes(bare);
  return typed ? withScheme : null;
}

function acceptTypedSecret(candidate: string | null, provenance: Provenance): string | null {
  if (candidate === null) return null;
  const trimmed = candidate.trim();
  if (trimmed.length === 0 || trimmed.length > 100) return null;
  return provenance.userText.includes(trimmed) ? trimmed : null;
}

/** An address the user typed, or one of `allowed` (participants of the targeted meeting). */
function acceptEmail(candidate: string, provenance: Provenance, allowed: ReadonlySet<string>): string | null {
  const email = candidate.trim().toLowerCase();
  if (!emailSchema.safeParse(email).success) return null;
  return provenance.userTextLower.includes(email) || allowed.has(email) ? email : null;
}

function acceptParticipants(
  list: readonly { email: string; name: string | null }[],
  provenance: Provenance,
  allowed: ReadonlySet<string>,
): AiParticipant[] {
  const byEmail = new Map<string, AiParticipant>();
  for (const item of list) {
    const email = acceptEmail(item.email, provenance, allowed);
    if (!email || byEmail.has(email)) continue;
    const name = item.name ? clip(item.name, 200) : '';
    byEmail.set(email, { email, name: name.length > 0 ? name : null });
  }
  return [...byEmail.values()].slice(0, AI_LIMITS.maxParticipants);
}

function acceptAlertTimes(values: readonly number[]): number[] {
  const valid = values.filter((value) => Number.isInteger(value) && value >= 0 && value <= AI_LIMITS.maxAlertMinutes);
  return [...new Set(valid)].sort((a, b) => b - a).slice(0, AI_LIMITS.maxAlertTimes);
}

function acceptTips(values: readonly string[]): string[] {
  return values
    .map((tip) => clip(tip, AI_LIMITS.maxTipChars))
    .filter((tip) => tip.length > 0)
    .slice(0, AI_LIMITS.maxTips);
}

function acceptConference(
  args: { provider: ConferenceDetails['provider']; url: string | null; password: string | null },
  provenance: Provenance,
): ConferenceDetails {
  return {
    provider: args.provider,
    url: acceptTypedUrl(args.url, provenance),
    password: acceptTypedSecret(args.password, provenance),
  };
}

function toLocation(args: { type: MeetingLocation['type']; address: string | null }, virtualUrl: string | null): MeetingLocation {
  const address = args.address ? clip(args.address, 500) : '';
  return { type: args.type, address: address.length > 0 ? address : null, virtualUrl };
}

function resolveZone(candidate: string | null, fallback: string): string {
  return candidate !== null && isValidTimeZone(candidate) ? candidate : fallback;
}

/**
 * Tool recurrence args -> the shared RecurrenceRule. `zone` is the MEETING's zone: `until_date`
 * is the inclusive last local day there (stored as the end-of-day instant, so every occurrence of
 * that day is still included). Anything outside the v1 subset is dropped, never repaired.
 */
function mapRecurrence(args: RecurrenceArgs, zone: string): RecurrenceRule {
  let until: string | null = null;
  if (args.until_date !== null) {
    if (!isValidLocalDate(args.until_date)) drop('invalid_datetime');
    until = zonedDateTimeToInstant(args.until_date, '23:59', zone).toISOString();
  }
  const candidate: RecurrenceRule = {
    freq: args.freq,
    interval: args.interval ?? 1,
    byWeekday: args.freq === 'weekly' && args.by_weekday !== null && args.by_weekday.length > 0 ? args.by_weekday : null,
    byMonthDay: args.freq === 'monthly' ? args.by_month_day : null,
    until,
    count: until !== null ? null : args.count,
  };
  const checked = recurrenceRuleSchema.safeParse(candidate);
  return checked.success ? checked.data : drop('bad_args');
}

function meetingZone(meeting: ContextMeeting, userTimeZone: string): string {
  return isValidTimeZone(meeting.doc.timezone) ? meeting.doc.timezone : userTimeZone;
}

function resolveRef(ref: string, ctx: MappingContext): ContextMeeting {
  return ctx.context.byRef.get(ref.trim()) ?? drop('unknown_ref');
}

function resolveRefs(refs: readonly string[], ctx: MappingContext): string[] {
  const ids: string[] = [];
  for (const ref of refs) {
    const meeting = ctx.context.byRef.get(ref.trim());
    if (meeting && !ids.includes(meeting.meetingId)) ids.push(meeting.meetingId);
  }
  return ids;
}

function localStartIso(date: string, time: string, zone: string): string {
  if (!isValidLocalDate(date) || !isValidLocalTime(time)) drop('invalid_datetime');
  return formatIsoWithOffset(zonedDateTimeToInstant(date, time, zone), zone);
}

// ---------------------------------------------------------------------------------------------
// Per-tool mapping
// ---------------------------------------------------------------------------------------------

function parseArgs<T>(schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } }, raw: string): T {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return drop('bad_json');
  }
  const parsed = schema.safeParse(json);
  return parsed.success ? parsed.data : drop('bad_args');
}

function common(args: { summary: string; confidence: number }, ctx: MappingContext, fallbackSummary: string) {
  const summary = clip(args.summary, AI_LIMITS.maxSummaryChars);
  return {
    id: (ctx.newActionId ?? newActionId)(),
    summary: summary.length > 0 ? summary : fallbackSummary,
    confidence: clampConfidence(args.confidence),
  };
}

const DEFAULT_SUMMARIES: Readonly<Record<Language, Record<AiAction['type'], string>>> = {
  en: {
    create_meeting: 'Create a meeting',
    update_meeting: 'Update a meeting',
    delete_meeting: 'Delete a meeting',
    share_meeting: 'Share a meeting',
    bulk_update: 'Update several meetings',
    list: 'Show meetings',
  },
  es: {
    create_meeting: 'Crear una reunión',
    update_meeting: 'Actualizar una reunión',
    delete_meeting: 'Eliminar una reunión',
    share_meeting: 'Compartir una reunión',
    bulk_update: 'Actualizar varias reuniones',
    list: 'Mostrar reuniones',
  },
};

function mapCreate(raw: string, ctx: MappingContext, provenance: Provenance): AiAction {
  const args = parseArgs(createMeetingArgsSchema, raw);
  const title = clip(args.title, AI_LIMITS.maxTitleChars);
  if (title.length === 0) drop('bad_args');
  const zone = resolveZone(args.timezone, ctx.userTimeZone);
  const time = args.all_day ? '00:00' : (args.time ?? drop('invalid_datetime'));
  const conference = args.conference ? acceptConference(args.conference, provenance) : null;
  const meeting: AiMeetingDraft = {
    title,
    description: clip(args.description, AI_LIMITS.maxDescriptionChars),
    startAt: localStartIso(args.date, time, zone),
    durationMinutes: args.duration_minutes ?? (args.all_day ? ALL_DAY_MINUTES : DEFAULT_DURATION_MINUTES),
    timezone: zone,
    allDay: args.all_day,
    location: args.location ? toLocation(args.location, null) : null,
    conference,
    // A new meeting may only invite typed addresses, plus (follow-up mode) the participants of the
    // meeting that just ended ("schedule the next one with the same people").
    participants: acceptParticipants(args.participants, provenance, emailsOf(ctx.mode === 'followup' ? ctx.context.followUp : null)),
    preparationTips: acceptTips(args.preparation_tips),
    customAlertTimes: args.alert_minutes_before === null ? null : acceptAlertTimes(args.alert_minutes_before),
    language: ctx.language,
    recurrence: args.recurrence === null ? null : mapRecurrence(args.recurrence, zone),
  };
  return { type: 'create_meeting', ...common(args, ctx, DEFAULT_SUMMARIES[ctx.language].create_meeting), meeting };
}

/** Location/conference/alerts changes shared by update and bulk_update. */
function mapCommonChanges(
  changes: BulkChangesArgs,
  existing: ContextMeeting | null,
  provenance: Provenance,
  out: AiMeetingChanges,
): void {
  if (changes.duration_minutes !== null && changes.duration_minutes !== existing?.doc.durationMinutes) {
    out.durationMinutes = changes.duration_minutes;
  }

  if (changes.clear_location) {
    if (!existing || existing.doc.location !== null) out.location = null;
  } else if (changes.location) {
    const current = existing?.doc.location ?? null;
    const keepsAddress = current !== null && current.type === changes.location.type && changes.location.address === null;
    const next = toLocation(
      keepsAddress ? { ...changes.location, address: current.address } : changes.location,
      current !== null && changes.location.type !== 'physical' ? current.virtualUrl : null,
    );
    // Bulk: a physical/hybrid location without an address would wipe every meeting's address.
    const wipesAddresses = existing === null && next.type !== 'virtual' && next.address === null;
    if (!wipesAddresses && JSON.stringify(next) !== JSON.stringify(current)) out.location = next;
  }

  if (changes.clear_conference) {
    if (!existing || existing.doc.conference !== null) out.conference = null;
  } else if (changes.conference) {
    const proposed = acceptConference(changes.conference, provenance);
    const current = existing?.doc.conference ?? null;
    const sameProvider = current !== null && current.provider === proposed.provider;
    const next: ConferenceDetails = {
      provider: proposed.provider,
      url: proposed.url ?? (sameProvider ? current.url : null),
      password: proposed.password ?? (sameProvider ? current.password : null),
    };
    // Bulk: a non-Meet provider without a link would wipe every meeting's existing link.
    const wipesLinks = existing === null && next.url === null && next.provider !== 'google_meet';
    if (!wipesLinks && JSON.stringify(next) !== JSON.stringify(current)) out.conference = next;
  }

  if (changes.reset_alert_times) {
    out.customAlertTimes = null;
  } else if (changes.alert_minutes_before !== null) {
    out.customAlertTimes = acceptAlertTimes(changes.alert_minutes_before);
  }
}

function mapScheduleChanges(
  changes: UpdateChangesArgs,
  meeting: ContextMeeting,
  userTimeZone: string,
  out: AiMeetingChanges,
): void {
  const currentZone = meetingZone(meeting, userTimeZone);
  // A zone the user named explicitly ("3pm Madrid time") is used to read the new time even when it
  // is already the meeting's zone; it only becomes a change when it differs.
  const explicitZone = changes.timezone !== null && isValidTimeZone(changes.timezone) ? changes.timezone : null;
  const allDay = changes.all_day ?? meeting.doc.allDay;
  const allDayChanged = allDay !== meeting.doc.allDay;
  if (explicitZone && explicitZone !== currentZone) out.timezone = explicitZone;
  if (allDayChanged) out.allDay = allDay;
  if (changes.date === null && changes.time === null && !allDayChanged) return;

  // The model saw timed meetings in the user's zone and all-day meetings in their own zone.
  const displayZone = meeting.doc.allDay ? currentZone : userTimeZone;
  const date = changes.date ?? toLocalDate(meeting.start, displayZone);
  let time: string;
  if (allDay) {
    time = '00:00';
  } else if (changes.time !== null) {
    time = changes.time;
  } else if (meeting.doc.allDay) {
    // All-day -> timed needs an explicit time; never guess one.
    return drop('invalid_datetime');
  } else {
    time = toLocalTime(meeting.start, displayZone);
  }
  const interpretZone = explicitZone ?? (allDay ? currentZone : userTimeZone);
  const startAt = localStartIso(date, time, interpretZone);
  if (Date.parse(startAt) !== meeting.start.getTime()) out.startAt = startAt;
  if (allDayChanged && allDay && changes.duration_minutes === null) out.durationMinutes = ALL_DAY_MINUTES;
}

/**
 * Scope 'occurrence' (a real occurrence of a recurring meeting): only startAt / duration / title
 * may change (OCCURRENCE_CHANGE_KEYS in the contract); every other requested change is ignored.
 * A date/time given without the other half defaults to the occurrence's ORIGINAL date and the
 * master's wall-clock time, so "move tomorrow's standup to 10:00" moves only the time.
 */
function mapOccurrenceUpdate(
  args: { changes: UpdateChangesArgs; occurrence_date: string | null; summary: string; confidence: number },
  meeting: ContextMeeting,
  ctx: MappingContext,
): AiAction {
  const occurrenceDate =
    args.occurrence_date !== null && isValidLocalDate(args.occurrence_date) ? args.occurrence_date : drop('invalid_datetime');
  const c = args.changes;
  const changes: AiMeetingChanges = {};
  if (c.title !== null) {
    const title = clip(c.title, AI_LIMITS.maxTitleChars);
    if (title.length > 0) changes.title = title;
  }
  if (c.date !== null || c.time !== null) {
    const allDay = meeting.doc.allDay;
    const zone = meetingZone(meeting, ctx.userTimeZone);
    const date = c.date ?? occurrenceDate;
    // Only the date changed: keep the series' wall clock in the MEETING's zone and interpret it
    // there (§16 - wall-clock math runs in the meeting's zone). Deriving the fallback in the
    // user's zone would drift the occurrence an hour when the zones' DST offsets diverge between
    // the anchor date and the target date. An explicit time came from the model's user-zone view.
    const time = allDay ? (c.time ?? '00:00') : (c.time ?? toLocalTime(meeting.start, zone));
    const interpretZone = c.time === null ? zone : ctx.userTimeZone;
    changes.startAt = localStartIso(date, time, interpretZone);
  }
  if (c.duration_minutes !== null) changes.durationMinutes = c.duration_minutes;
  if (Object.keys(changes).length === 0) drop('empty_changes');
  return {
    type: 'update_meeting',
    ...common(args, ctx, DEFAULT_SUMMARIES[ctx.language].update_meeting),
    meetingId: meeting.meetingId,
    changes,
    scope: 'occurrence',
    occurrenceDate,
  };
}

function mapUpdate(raw: string, ctx: MappingContext, provenance: Provenance): AiAction {
  const args = parseArgs(updateMeetingArgsSchema, raw);
  const meeting = resolveRef(args.meeting_ref, ctx);
  // Scope only means something for a meeting that really repeats; on a one-off it is ignored.
  if (args.scope === 'occurrence' && meeting.doc.recurrence !== null) {
    return mapOccurrenceUpdate(args, meeting, ctx);
  }
  // v3 scope 'following': the FULL change surface applies to the tail series (the executor calls
  // editFollowing and the patch lands on the new tail master), so the mapping is a series update
  // ANCHORED at the split occurrence's ORIGINAL start: date/time fallbacks and the "did the start
  // change?" comparison use that occurrence, never the master's first occurrence - otherwise a
  // time-only change would silently move the tail back to the master's original date.
  const following = args.scope === 'following' && meeting.doc.recurrence !== null;
  let followingDate: string | null = null;
  let anchor = meeting;
  if (following) {
    followingDate =
      args.occurrence_date !== null && isValidLocalDate(args.occurrence_date) ? args.occurrence_date : drop('invalid_datetime');
    const zone = meetingZone(meeting, ctx.userTimeZone);
    // The split occurrence keeps the series' wall clock in the MEETING's zone (§16 - wall-clock
    // math runs there; deriving it in the user's zone would drift across DST divergences).
    const time = meeting.doc.allDay ? '00:00' : toLocalTime(meeting.start, zone);
    anchor = { ...meeting, start: new Date(localStartIso(followingDate, time, zone)) };
  }
  const c = args.changes;
  const changes: AiMeetingChanges = {};

  if (c.title !== null) {
    const title = clip(c.title, AI_LIMITS.maxTitleChars);
    if (title.length > 0 && title !== meeting.doc.title) changes.title = title;
  }
  if (c.description !== null) {
    const description = clip(c.description, AI_LIMITS.maxDescriptionChars);
    if (description !== meeting.doc.description) changes.description = description;
  }
  mapScheduleChanges(c, anchor, ctx.userTimeZone, changes);
  mapCommonChanges(c, meeting, provenance, changes);
  if (c.clear_recurrence) {
    if (meeting.doc.recurrence !== null) changes.recurrence = null;
  } else if (c.recurrence !== null) {
    const rule = mapRecurrence(c.recurrence, meetingZone(meeting, ctx.userTimeZone));
    if (JSON.stringify(rule) !== JSON.stringify(meeting.doc.recurrence)) changes.recurrence = rule;
  }
  if (c.participants !== null) {
    // The model only saw the first N participants; the others are kept as they are.
    const shown = new Set(meeting.participantEmails.slice(0, CONTEXT_WINDOW.maxParticipantsListed));
    const storedNames = new Map(
      meeting.doc.participants.map((participant) => [participant.email.trim().toLowerCase(), participant.name]),
    );
    const hidden = meeting.doc.participants
      .filter((participant) => !shown.has(participant.email.trim().toLowerCase()))
      .map((participant) => ({ email: participant.email, name: participant.name }));
    // A participant the model returns without a name keeps the name already stored for it.
    const proposed = c.participants.map((participant) => ({
      email: participant.email,
      name: participant.name ?? storedNames.get(participant.email.trim().toLowerCase()) ?? null,
    }));
    changes.participants = acceptParticipants([...proposed, ...hidden], provenance, emailsOf(meeting));
  }
  if (c.preparation_tips !== null) changes.preparationTips = acceptTips(c.preparation_tips);

  if (Object.keys(changes).length === 0) drop('empty_changes');
  return {
    type: 'update_meeting',
    ...common(args, ctx, DEFAULT_SUMMARIES[ctx.language].update_meeting),
    meetingId: meeting.meetingId,
    changes,
    ...(following && followingDate !== null ? { scope: 'following' as const, occurrenceDate: followingDate } : {}),
  };
}

function mapDelete(raw: string, ctx: MappingContext): AiAction {
  const args = parseArgs(deleteMeetingArgsSchema, raw);
  if (ctx.mode === 'followup') drop('not_allowed');
  const meeting = resolveRef(args.meeting_ref, ctx);
  if ((args.scope === 'occurrence' || args.scope === 'following') && meeting.doc.recurrence !== null) {
    // "Delete only tomorrow's standup": cancel one occurrence, keep the series. With scope
    // 'following' ("cancel the rest of the standups"): the executor truncates the series the
    // second before that occurrence's start; earlier occurrences stay. Same date validation.
    const occurrenceDate =
      args.occurrence_date !== null && isValidLocalDate(args.occurrence_date) ? args.occurrence_date : drop('invalid_datetime');
    return {
      type: 'delete_meeting',
      ...common(args, ctx, DEFAULT_SUMMARIES[ctx.language].delete_meeting),
      meetingId: meeting.meetingId,
      scope: args.scope,
      occurrenceDate,
    };
  }
  return {
    type: 'delete_meeting',
    ...common(args, ctx, DEFAULT_SUMMARIES[ctx.language].delete_meeting),
    meetingId: meeting.meetingId,
  };
}

function mapShare(raw: string, ctx: MappingContext, provenance: Provenance): AiAction {
  const args = parseArgs(shareMeetingArgsSchema, raw);
  const meeting = resolveRef(args.meeting_ref, ctx);
  // Recipients: typed by the user, or already participants of THIS meeting.
  const allowed = emailsOf(meeting);
  const recipients = [
    ...new Set(args.recipients.map((email) => acceptEmail(email, provenance, allowed)).filter((email) => email !== null)),
  ].slice(0, AI_LIMITS.maxRecipients);
  // Without an accepted address, fall back to the share sheet (the user picks the recipients).
  const channel = args.channel === 'email' && recipients.length > 0 ? 'email' : 'system_share';
  const message = args.message ? clip(args.message, AI_LIMITS.maxShareMessageChars) : '';
  return {
    type: 'share_meeting',
    ...common(args, ctx, DEFAULT_SUMMARIES[ctx.language].share_meeting),
    meetingId: meeting.meetingId,
    recipients: channel === 'email' ? recipients : [],
    channel,
    message: message.length > 0 ? message : null,
  };
}

function mapBulk(raw: string, ctx: MappingContext, provenance: Provenance): AiAction {
  const args = parseArgs(bulkUpdateArgsSchema, raw);
  const meetingIds = resolveRefs(args.meeting_refs, ctx).slice(0, AI_LIMITS.maxBulkMeetings);
  if (meetingIds.length === 0) drop('unknown_ref');
  const shift = args.shift_minutes;
  const shiftMinutes = shift !== null && shift !== 0 && Math.abs(shift) <= AI_LIMITS.maxShiftMinutes ? shift : null;
  let changes: AiMeetingChanges | null = null;
  if (args.changes) {
    const mapped: AiMeetingChanges = {};
    mapCommonChanges(args.changes, null, provenance, mapped);
    changes = Object.keys(mapped).length > 0 ? mapped : null;
  }
  if (shiftMinutes === null && changes === null) drop('empty_changes');
  return {
    type: 'bulk_update',
    ...common(args, ctx, DEFAULT_SUMMARIES[ctx.language].bulk_update),
    meetingIds,
    shiftMinutes,
    changes,
  };
}

function mapList(raw: string, ctx: MappingContext): AiAction {
  const args = parseArgs(listMeetingsArgsSchema, raw);
  return {
    type: 'list',
    ...common(args, ctx, DEFAULT_SUMMARIES[ctx.language].list),
    meetingIds: resolveRefs(args.meeting_refs, ctx).slice(0, AI_LIMITS.maxBulkMeetings),
  };
}

function actionKey(action: AiAction): string {
  const { id: _id, summary: _summary, confidence: _confidence, ...rest } = action;
  return JSON.stringify(rest);
}

/** Maps the model's tool calls to validated proposals + quick-reply suggestions. */
export function mapToolCalls(toolCalls: readonly ToolCall[], ctx: MappingContext): MappingResult {
  const provenance = buildProvenance(ctx);
  const actions: AiAction[] = [];
  const seen = new Set<string>();
  const suggestions: string[] = [];
  let resolution: PendingResolution | null = null;
  const dropped: Partial<Record<DropReason, number>> = {};
  const count = (reason: DropReason) => {
    dropped[reason] = (dropped[reason] ?? 0) + 1;
  };

  for (const call of toolCalls) {
    try {
      if (call.name === TOOL_NAMES.resolve) {
        const args = parseArgs(resolvePendingArgsSchema, call.arguments);
        resolution = resolution ?? args.decision;
        continue;
      }
      if (call.name === TOOL_NAMES.suggest) {
        const args = parseArgs(suggestRepliesArgsSchema, call.arguments);
        for (const suggestion of args.suggestions) {
          const text = clip(suggestion, AI_LIMITS.maxSuggestionChars);
          if (text.length > 0 && !suggestions.includes(text) && suggestions.length < AI_LIMITS.maxSuggestions) {
            suggestions.push(text);
          }
        }
        continue;
      }
      let action: AiAction;
      switch (call.name) {
        case TOOL_NAMES.create:
          action = mapCreate(call.arguments, ctx, provenance);
          break;
        case TOOL_NAMES.update:
          action = mapUpdate(call.arguments, ctx, provenance);
          break;
        case TOOL_NAMES.delete:
          action = mapDelete(call.arguments, ctx);
          break;
        case TOOL_NAMES.share:
          action = mapShare(call.arguments, ctx, provenance);
          break;
        case TOOL_NAMES.bulk:
          action = mapBulk(call.arguments, ctx, provenance);
          break;
        case TOOL_NAMES.list:
          action = mapList(call.arguments, ctx);
          break;
        default:
          count('unknown_tool');
          continue;
      }
      const validated = aiActionSchema.safeParse(action);
      if (!validated.success) {
        count('contract');
        continue;
      }
      const key = actionKey(validated.data);
      if (seen.has(key)) {
        count('duplicate');
        continue;
      }
      if (actions.length >= AI_LIMITS.maxActions) {
        count('limit');
        continue;
      }
      seen.add(key);
      actions.push(validated.data);
    } catch (error) {
      if (error instanceof DropError) count(error.reason);
      else if (error instanceof RangeError) count('invalid_datetime');
      else throw error;
    }
  }
  return { actions, suggestions, resolution, dropped };
}

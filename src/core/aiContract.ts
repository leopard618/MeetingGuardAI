/**
 * Callable Cloud Functions contract shared by the app and /functions.
 *
 * SELF-CONTAINED ON PURPOSE: this file imports only `zod`, so functions/src/shared/aiContract.ts
 * can be a VERBATIM copy (CI diffs the two files). Do not import app modules here, do not use
 * React Native / Expo APIs, and keep every export deterministic.
 *
 * Rules the contract encodes:
 * - The assistant NEVER executes changes. It returns a reply plus proposed actions; the app shows
 *   a confirmation card for every action and executes confirmed ones through its data layer.
 * - Meeting ids in actions always come from the user's own Firestore meetings that the server
 *   loaded (never invented). Conference URLs are only ever the ones the user typed (never
 *   fabricated); `conference.url === null` with provider `google_meet` means "create a real
 *   Google Meet link through Google Calendar when executing".
 * - Quota is enforced server-side per UTC day (usage/{uid}/days/{yyyy-mm-dd}); the plan comes from
 *   the server-owned entitlements/{uid} document (default free).
 */
import { z } from 'zod';

/**
 * v2: recurring meetings (ADDITIVE only). create/update drafts gain an optional `recurrence`
 * rule, and update/delete actions gain an optional `{ scope, occurrenceDate }` for series
 * targets. Both sides tolerate the other being on v1: zod object parsing strips unknown keys,
 * and every new field is optional.
 *
 * v3: scope 'following' (ADDITIVE only). update/delete on a recurring meeting may target "this
 * and the following occurrences": `occurrenceDate` doubles as the split date (the FIRST affected
 * occurrence's ORIGINAL local date). The executor splits the series at that date
 * (docs/v1/ARCHITECTURE.md §16): the master is truncated and a NEW series carries the remaining
 * occurrences with the changes applied (update) or is simply never created (delete). Unlike
 * 'occurrence', a 'following' update accepts the full change surface (it edits a series master).
 * A v2 server never sends 'following'; a v2 client rejects the unknown enum value, so servers
 * only propose it to clients that sent a v3-capable request (same release train here).
 *
 * v4: pending-proposal resolution (ADDITIVE only). The request may carry `pendingActions`,
 * brief summaries of proposals the app still shows as unconfirmed cards, and the response may
 * carry `resolution`: the model judged the user's latest message to be plain consent to (or
 * refusal of) ALL pending proposals. The app then confirms or rejects the pending cards exactly
 * as the on-screen buttons would; the server still never executes anything. An old client sends
 * no pendingActions and can never receive a resolution; an old server strips the unknown
 * request key, so both directions stay compatible.
 *
 * v5: tasks (V2 Stage 1). Four new action types (create_task, update_task, delete_task,
 * list_tasks) over users/{uid}/tasks. New ACTION TYPES are the one thing an old client cannot
 * tolerate (its enum rejects the whole response), so the request now carries `contractVersion`
 * and the server offers the task tools and the task context ONLY when it is >= 5. The live v4
 * production app and the WhatsApp bridge send no version and keep the exact v4 behavior.
 *
 * v6: combined requests that LINK (ADDITIVE only). "Book the call with Ana and add a task the
 * day before to prepare the proposal" proposes a create_meeting and a create_task in one
 * response, and the task should belong to the meeting that does not exist yet. The server cannot
 * know that meeting's id (the client derives it, see services/ai/ids), so the task draft may
 * instead carry `meetingActionId`: the `id` of the create_meeting action in the SAME response.
 * The client resolves it to the real id once that meeting is created, and falls back to an
 * UNLINKED task when the meeting was not created - a missing link never costs the user the task.
 * Both directions stay compatible: the key is optional, so an old server simply omits it and an
 * old client strips it and creates the task without the link.
 */
export const AI_CONTRACT_VERSION = 6;

// ---------------------------------------------------------------------------------------------
// Trusted sign-in providers (verification gate)
// ---------------------------------------------------------------------------------------------

/**
 * Sign-in providers whose accounts count as verified WITHOUT the email verification round-trip:
 * the provider verified the identity itself (Google accounts; Apple IDs, including private-relay
 * "Hide My Email" addresses, which Apple only issues to a verified Apple ID). The assistant and
 * zoom callables require `email_verified` OR one of these as
 * `request.auth.token.firebase.sign_in_provider` (functions/src/assistant/handler.ts,
 * functions/src/zoom/index.ts); the client mirrors the exact same rule in
 * `needsEmailVerification` (src/screens/shared/VerifyEmailBanner.tsx). Both sides MUST use this
 * constant so they cannot drift - the functions copy of this file is diffed verbatim
 * (functions: npm run check:contract).
 */
export const TRUSTED_SIGN_IN_PROVIDERS = ['google.com', 'apple.com'] as const;
export type TrustedSignInProvider = (typeof TRUSTED_SIGN_IN_PROVIDERS)[number];

const TRUSTED_SIGN_IN_PROVIDER_SET: ReadonlySet<string> = new Set(TRUSTED_SIGN_IN_PROVIDERS);

/** True when a Firebase sign-in provider id makes the account count as verified by itself. */
export function isTrustedSignInProvider(provider: string | null | undefined): boolean {
  return typeof provider === 'string' && TRUSTED_SIGN_IN_PROVIDER_SET.has(provider);
}

// ---------------------------------------------------------------------------------------------
// Callables
// ---------------------------------------------------------------------------------------------

/** Callable function names. The app calls them in the region from EXPO_PUBLIC_FUNCTIONS_REGION. */
export const CALLABLES = {
  assistant: 'assistant',
  deleteAccount: 'deleteAccount',
  zoomStatus: 'zoomStatus',
  zoomCreateMeeting: 'zoomCreateMeeting',
  zoomSyncMeeting: 'zoomSyncMeeting',
  zoomDeleteMeeting: 'zoomDeleteMeeting',
  whatsappLinkStart: 'whatsappLinkStart',
  whatsappLinkStatus: 'whatsappLinkStatus',
  whatsappUnlink: 'whatsappUnlink',
} as const;
export type CallableName = (typeof CALLABLES)[keyof typeof CALLABLES];

/** Default region; the deployed functions and the app's EXPO_PUBLIC_FUNCTIONS_REGION must match. */
export const DEFAULT_CALLABLE_REGION = 'us-central1';

/** Client-side timeout for the assistant callable (the function itself times out at 60 s). */
export const ASSISTANT_CALL_TIMEOUT_MS = 70_000;

/** Client-side timeout for the zoom* callables (one Zoom REST call plus a token mint). */
export const ZOOM_CALL_TIMEOUT_MS = 20_000;

/** Client-side timeout for the whatsapp* callables (Firestore work only, no external calls). */
export const WHATSAPP_CALL_TIMEOUT_MS = 15_000;

// ---------------------------------------------------------------------------------------------
// Shared enums (types.ts re-uses these so there is a single definition)
// ---------------------------------------------------------------------------------------------

export const LANGUAGES = ['en', 'es'] as const;
export type Language = (typeof LANGUAGES)[number];

export const PLANS = ['free', 'pro', 'premium'] as const;
export type Plan = (typeof PLANS)[number];

/** Daily assistant requests per plan (server-enforced; the day boundary is UTC midnight). */
export const PLAN_DAILY_AI_LIMITS: Readonly<Record<Plan, number>> = {
  free: 5,
  pro: 100,
  premium: 500,
};

export const CONFERENCE_PROVIDERS = ['zoom', 'teams', 'google_meet', 'other'] as const;
export type ConferenceProvider = (typeof CONFERENCE_PROVIDERS)[number];

export const LOCATION_TYPES = ['physical', 'virtual', 'hybrid'] as const;
export type LocationType = (typeof LOCATION_TYPES)[number];

export const ASSISTANT_MODES = ['chat', 'followup'] as const;
export type AssistantMode = (typeof ASSISTANT_MODES)[number];

export const AI_ACTION_TYPES = [
  'create_meeting',
  'update_meeting',
  'delete_meeting',
  'share_meeting',
  'bulk_update',
  'list',
  // v5 (only ever sent to clients whose request said contractVersion >= 5):
  'create_task',
  'update_task',
  'delete_task',
  'list_tasks',
] as const;
export type AiActionType = (typeof AI_ACTION_TYPES)[number];

export const SHARE_CHANNELS = ['email', 'system_share'] as const;
export type ShareChannel = (typeof SHARE_CHANNELS)[number];

/** v4: how the user's latest message resolved the pending proposals (assistantResponseSchema). */
export const PENDING_RESOLUTIONS = ['confirm', 'reject'] as const;
export type PendingResolution = (typeof PENDING_RESOLUTIONS)[number];

/** v5: task status values the assistant may set (mirrors TASK_STATUSES in core/types.ts). */
export const TASK_ACTION_STATUSES = ['open', 'done'] as const;
export type TaskActionStatus = (typeof TASK_ACTION_STATUSES)[number];

export const RECURRENCE_FREQS = ['daily', 'weekly', 'monthly'] as const;
export type RecurrenceFreq = (typeof RECURRENCE_FREQS)[number];

/** ISO weekday codes, Monday first (weeks start on Monday for weekly rules). */
export const RECURRENCE_WEEKDAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;
export type RecurrenceWeekday = (typeof RECURRENCE_WEEKDAYS)[number];

/**
 * How an update/delete applies to a recurring meeting. Absent scope = 'series' (v1 behavior).
 * 'following' (v3) = this and every later occurrence: the series is SPLIT at `occurrenceDate`
 * (src/core/recurrence.ts splitRecurrenceAt; repo ops editFollowing / deleteFollowing).
 */
export const RECURRENCE_EDIT_SCOPES = ['occurrence', 'series', 'following'] as const;
export type RecurrenceEditScope = (typeof RECURRENCE_EDIT_SCOPES)[number];

// ---------------------------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------------------------

export const AI_LIMITS = {
  maxMessages: 30,
  maxMessageChars: 4000,
  maxReplyChars: 8000,
  maxActions: 10,
  maxSuggestions: 5,
  maxSuggestionChars: 120,
  maxSummaryChars: 500,
  maxTitleChars: 200,
  maxDescriptionChars: 4000,
  maxTips: 10,
  maxTipChars: 300,
  maxParticipants: 100,
  maxRecipients: 20,
  maxShareMessageChars: 1000,
  maxBulkMeetings: 100,
  maxAlertTimes: 10,
  /** Longest "minutes before" an alert may be (7 days). */
  maxAlertMinutes: 10_080,
  /** Longest meeting (14 days, for multi-day all-day events). */
  maxDurationMinutes: 20_160,
  maxShiftMinutes: 10_080,
  maxRecurrenceInterval: 99,
  /** Two years of daily occurrences. */
  maxRecurrenceCount: 730,
} as const;

// ---------------------------------------------------------------------------------------------
// Primitive schemas
// ---------------------------------------------------------------------------------------------

/** IANA zone name, syntactic check only (e.g. "Europe/Madrid", "America/Argentina/Buenos_Aires", "UTC", "Etc/GMT+5"). */
export const TIME_ZONE_PATTERN = /^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)*$/;
/** Meeting / document ids: Firestore-safe and never containing ':' (used as separator in notification ids). */
export const MEETING_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export const languageSchema = z.enum(LANGUAGES);
export const planSchema = z.enum(PLANS);
export const conferenceProviderSchema = z.enum(CONFERENCE_PROVIDERS);
export const locationTypeSchema = z.enum(LOCATION_TYPES);
/** ISO-8601 date-time with `Z` or a numeric offset. */
export const isoDateTimeSchema = z.iso.datetime({ offset: true });
export const timeZoneSchema = z.string().min(1).max(64).regex(TIME_ZONE_PATTERN);
export const emailSchema = z.email().max(254);
export const meetingIdSchema = z.string().regex(MEETING_ID_PATTERN);
/** http(s) URLs only (rejects javascript:, file:, intent: ...). */
export const httpUrlSchema = z.url({ protocol: /^https?$/ }).max(2048);
/** "Minutes before start" alert offsets. */
export const alertTimesSchema = z
  .array(z.number().int().min(0).max(AI_LIMITS.maxAlertMinutes))
  .max(AI_LIMITS.maxAlertTimes);
export const durationMinutesSchema = z.number().int().min(1).max(AI_LIMITS.maxDurationMinutes);

export const meetingLocationSchema = z.object({
  type: locationTypeSchema,
  /** Street address / room; null for purely virtual meetings. */
  address: z.string().max(500).nullable(),
  /** Join URL for virtual/hybrid meetings when it is not a conference link (else use `conference`). */
  virtualUrl: httpUrlSchema.nullable(),
});
export type MeetingLocation = z.infer<typeof meetingLocationSchema>;

export const conferenceDetailsSchema = z.object({
  provider: conferenceProviderSchema,
  /** Real join URL, or null when not known yet (never fabricated). */
  url: httpUrlSchema.nullable(),
  password: z.string().max(100).nullable(),
});
export type ConferenceDetails = z.infer<typeof conferenceDetailsSchema>;

export const aiParticipantSchema = z.object({
  email: emailSchema,
  name: z.string().max(200).nullable(),
});
export type AiParticipant = z.infer<typeof aiParticipantSchema>;

/** Local calendar date "YYYY-MM-DD" (an occurrence key in a meeting's timezone). */
export const LOCAL_DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
export const localDateKeySchema = z.string().regex(LOCAL_DATE_KEY_PATTERN);

/**
 * Recurrence rule (v1 subset; shared by the stored meeting model - src/core/recurrence.ts - and
 * the AI drafts, so the assistant proposes exactly what is stored). Every field is present and
 * nullable (strict tool schemas). Semantics:
 * - The first occurrence is the meeting's own start; the rule's timezone is the meeting's.
 * - byWeekday: weekly only; null = the first occurrence's weekday.
 * - byMonthDay: monthly only (1-31; months without that day are skipped); null = the first
 *   occurrence's day of month.
 * - until: INCLUSIVE UTC instant compared against original occurrence starts. count: total
 *   occurrences including the first. Never both; both null = endless.
 */
export const recurrenceRuleSchema = z
  .object({
    freq: z.enum(RECURRENCE_FREQS),
    interval: z.number().int().min(1).max(AI_LIMITS.maxRecurrenceInterval),
    byWeekday: z.array(z.enum(RECURRENCE_WEEKDAYS)).min(1).max(7).nullable(),
    byMonthDay: z.number().int().min(1).max(31).nullable(),
    until: isoDateTimeSchema.nullable(),
    count: z.number().int().min(1).max(AI_LIMITS.maxRecurrenceCount).nullable(),
  })
  .refine((r) => r.until === null || r.count === null, { message: 'until and count are exclusive', path: ['count'] })
  .refine((r) => r.byWeekday === null || r.freq === 'weekly', { message: 'byWeekday is weekly-only', path: ['byWeekday'] })
  .refine((r) => r.byMonthDay === null || r.freq === 'monthly', {
    message: 'byMonthDay is monthly-only',
    path: ['byMonthDay'],
  });
export type RecurrenceRule = z.infer<typeof recurrenceRuleSchema>;

// ---------------------------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------------------------

export const MESSAGE_ORIGINS = ['typed', 'suggestion'] as const;
export type MessageOrigin = (typeof MESSAGE_ORIGINS)[number];

export const assistantMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1).max(AI_LIMITS.maxMessageChars),
  /**
   * User messages only: 'suggestion' when the user tapped a suggestion chip. Chip text is written
   * by the model, so the server never treats it as something the user typed (links, passwords and
   * email addresses in it are not accepted). Absent = typed.
   */
  origin: z.enum(MESSAGE_ORIGINS).optional(),
});
export type AssistantMessage = z.infer<typeof assistantMessageSchema>;

/** v4: a proposal the app still shows as an unconfirmed card (type + its card summary). */
export const pendingActionBriefSchema = z.object({
  type: z.enum(AI_ACTION_TYPES),
  summary: z.string().min(1).max(AI_LIMITS.maxSummaryChars),
});
export type PendingActionBrief = z.infer<typeof pendingActionBriefSchema>;

export const assistantRequestSchema = z
  .object({
    /** Conversation so far, oldest first. In chat mode the last message must be from the user. */
    messages: z.array(assistantMessageSchema).max(AI_LIMITS.maxMessages),
    /** Reply language (UI language). */
    language: languageSchema,
    /** User's IANA time zone; relative dates ("tomorrow 4pm") are resolved in it. */
    timezone: timeZoneSchema,
    /** Client clock, informational (the server uses its own clock for quotas). */
    nowIso: isoDateTimeSchema,
    mode: z.enum(ASSISTANT_MODES),
    /** Required in followup mode: the meeting that just ended. */
    followUpMeetingId: meetingIdSchema.nullable(),
    /** v4, optional: proposals still awaiting confirmation in the app when this message was sent. */
    pendingActions: z.array(pendingActionBriefSchema).max(AI_LIMITS.maxActions).optional(),
    /**
     * v5, optional: the AI_CONTRACT_VERSION the client was built with. The server gates
     * capabilities whose responses an older client cannot parse (the task action types) on it.
     * Absent = v4 behavior.
     */
    contractVersion: z.number().int().min(1).max(1000).optional(),
  })
  .refine((r) => r.mode !== 'followup' || r.followUpMeetingId !== null, {
    message: 'followUpMeetingId is required in followup mode',
    path: ['followUpMeetingId'],
  })
  .refine(
    (r) => r.mode !== 'chat' || (r.messages.length > 0 && r.messages[r.messages.length - 1]?.role === 'user'),
    { message: 'chat mode requires a trailing user message', path: ['messages'] },
  );
export type AssistantRequest = z.infer<typeof assistantRequestSchema>;

// ---------------------------------------------------------------------------------------------
// Actions (proposals only)
// ---------------------------------------------------------------------------------------------

/** A meeting the assistant proposes to create. All fields present (nullable) for strict tool schemas. */
export const aiMeetingDraftSchema = z.object({
  title: z.string().min(1).max(AI_LIMITS.maxTitleChars),
  description: z.string().max(AI_LIMITS.maxDescriptionChars),
  /** Start instant, ISO-8601 with offset or Z. For all-day meetings: local midnight in `timezone`. */
  startAt: isoDateTimeSchema,
  durationMinutes: durationMinutesSchema,
  timezone: timeZoneSchema,
  allDay: z.boolean(),
  location: meetingLocationSchema.nullable(),
  conference: conferenceDetailsSchema.nullable(),
  participants: z.array(aiParticipantSchema).max(AI_LIMITS.maxParticipants),
  preparationTips: z.array(z.string().min(1).max(AI_LIMITS.maxTipChars)).max(AI_LIMITS.maxTips),
  /** Minutes-before alert offsets; null = user's default alert times. */
  customAlertTimes: alertTimesSchema.nullable(),
  language: languageSchema,
  /**
   * v2, additive: repeat rule ("every Monday at 9"), or null for a one-off meeting. OPTIONAL so
   * v1 responses still parse; a missing value means null. In changes, null REMOVES the rule
   * (the series collapses to a single meeting).
   */
  recurrence: recurrenceRuleSchema.nullable().optional(),
});
export type AiMeetingDraft = z.infer<typeof aiMeetingDraftSchema>;

/** Partial changes to an existing meeting. Absent key = unchanged; null (where allowed) = clear. */
export const aiMeetingChangesSchema = aiMeetingDraftSchema
  .partial()
  .refine((c) => Object.keys(c).length > 0, { message: 'changes must not be empty' });
export type AiMeetingChanges = z.infer<typeof aiMeetingChangesSchema>;

const actionBase = {
  /** Server-generated, unique within the response (e.g. "act_3f9k2"); used for idempotent execution. */
  id: z.string().min(1).max(64),
  /** One-line description in the request language, shown on the confirmation card. */
  summary: z.string().min(1).max(AI_LIMITS.maxSummaryChars),
  /** Model confidence 0-100. */
  confidence: z.number().int().min(0).max(100),
};

export const createMeetingActionSchema = z.object({
  type: z.literal('create_meeting'),
  ...actionBase,
  meeting: aiMeetingDraftSchema,
});

/** update_meeting changes allowed with scope 'occurrence' (the v1 per-occurrence override surface). */
export const OCCURRENCE_CHANGE_KEYS = ['startAt', 'durationMinutes', 'title'] as const;

export const updateMeetingActionSchema = z
  .object({
    type: z.literal('update_meeting'),
    ...actionBase,
    meetingId: meetingIdSchema,
    changes: aiMeetingChangesSchema,
    /**
     * v2, additive: when `meetingId` is a recurring meeting, 'occurrence' changes only the
     * occurrence at `occurrenceDate`, 'series' changes the whole series. v3 adds 'following':
     * this and every later occurrence (the series is split at `occurrenceDate`; the changes
     * apply to the new tail series, full change surface allowed). Absent (older client or
     * one-off meeting) = 'series'. Executors ignore the scope on non-recurring meetings.
     */
    scope: z.enum(RECURRENCE_EDIT_SCOPES).optional(),
    /**
     * Required with scope 'occurrence' or 'following': the ORIGINAL local date (meeting's
     * timezone) of the targeted / first affected occurrence.
     */
    occurrenceDate: localDateKeySchema.nullable().optional(),
  })
  .refine(
    (a) =>
      (a.scope !== 'occurrence' && a.scope !== 'following') ||
      (a.occurrenceDate !== null && a.occurrenceDate !== undefined),
    {
      message: 'scopes "occurrence" and "following" need occurrenceDate',
      path: ['occurrenceDate'],
    },
  )
  .refine(
    (a) => a.scope !== 'occurrence' || Object.keys(a.changes).every((key) => (OCCURRENCE_CHANGE_KEYS as readonly string[]).includes(key)),
    { message: 'occurrence-scoped changes may only set startAt, durationMinutes or title', path: ['changes'] },
  );

export const deleteMeetingActionSchema = z
  .object({
    type: z.literal('delete_meeting'),
    ...actionBase,
    meetingId: meetingIdSchema,
    /**
     * v2, additive: 'occurrence' cancels one occurrence of a series; 'series' (or absent)
     * deletes the meeting. v3 adds 'following': ends the series the day before
     * `occurrenceDate` (this and every later occurrence disappear; earlier ones stay).
     */
    scope: z.enum(RECURRENCE_EDIT_SCOPES).optional(),
    occurrenceDate: localDateKeySchema.nullable().optional(),
  })
  .refine(
    (a) =>
      (a.scope !== 'occurrence' && a.scope !== 'following') ||
      (a.occurrenceDate !== null && a.occurrenceDate !== undefined),
    {
      message: 'scopes "occurrence" and "following" need occurrenceDate',
      path: ['occurrenceDate'],
    },
  );

export const shareMeetingActionSchema = z
  .object({
    type: z.literal('share_meeting'),
    ...actionBase,
    meetingId: meetingIdSchema,
    /** Required (>= 1) for channel "email"; ignored for "system_share" (the OS sheet picks). */
    recipients: z.array(emailSchema).max(AI_LIMITS.maxRecipients),
    channel: z.enum(SHARE_CHANNELS),
    message: z.string().max(AI_LIMITS.maxShareMessageChars).nullable(),
  })
  .refine((a) => a.channel !== 'email' || a.recipients.length > 0, {
    message: 'email sharing needs at least one recipient',
    path: ['recipients'],
  });

export const bulkUpdateActionSchema = z
  .object({
    type: z.literal('bulk_update'),
    ...actionBase,
    meetingIds: z.array(meetingIdSchema).min(1).max(AI_LIMITS.maxBulkMeetings),
    /** Move every meeting by this many minutes (non-zero), or null. */
    shiftMinutes: z
      .number()
      .int()
      .min(-AI_LIMITS.maxShiftMinutes)
      .max(AI_LIMITS.maxShiftMinutes)
      .refine((n) => n !== 0, { message: 'shiftMinutes must not be 0' })
      .nullable(),
    /** Same changes applied to every meeting (never `startAt`), or null. */
    changes: aiMeetingChangesSchema.nullable(),
  })
  .refine((a) => a.shiftMinutes !== null || a.changes !== null, {
    message: 'bulk_update needs shiftMinutes or changes',
  })
  .refine((a) => a.changes === null || a.changes.startAt === undefined, {
    message: 'bulk_update changes cannot set startAt (use shiftMinutes)',
    path: ['changes', 'startAt'],
  });

/** Read-only: show these meetings (may be empty when nothing matched). */
export const listActionSchema = z.object({
  type: z.literal('list'),
  ...actionBase,
  meetingIds: z.array(meetingIdSchema).max(AI_LIMITS.maxBulkMeetings),
});

// ---- Tasks (v5) -----------------------------------------------------------------------------

export const LOCAL_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
export const localTimeKeySchema = z.string().regex(LOCAL_TIME_PATTERN);

/** Someone a task involves; a name is enough, the email is optional. */
export const aiTaskPersonSchema = z.object({
  name: z.string().min(1).max(200),
  email: emailSchema.nullable(),
});
export type AiTaskPerson = z.infer<typeof aiTaskPersonSchema>;

export const AI_TASK_LIMITS = {
  maxPeople: 20,
  maxReminderMinutes: 10_080,
} as const;

/**
 * A task the assistant proposes to create. Due date and time are LOCAL values in the user's
 * zone (the executor anchors them in the device zone); a reminder needs a due time.
 */
export const aiTaskDraftSchema = z
  .object({
    title: z.string().min(1).max(AI_LIMITS.maxTitleChars),
    description: z.string().max(AI_LIMITS.maxDescriptionChars),
    dueDate: localDateKeySchema.nullable(),
    dueTime: localTimeKeySchema.nullable(),
    reminderMinutesBefore: z.number().int().min(0).max(AI_TASK_LIMITS.maxReminderMinutes).nullable(),
    meetingId: meetingIdSchema.nullable(),
    /**
     * v6, additive: the `id` of a create_meeting action in the SAME response whose meeting this
     * task belongs to. Set only when that meeting does not exist yet, so `meetingId` is null and
     * the server has no id to give. The executor resolves it after creating the meeting and
     * creates an unlinked task when it cannot (the meeting failed, or an older server sent
     * nothing). Never both this and `meetingId`.
     */
    meetingActionId: z.string().min(1).max(64).nullable().optional(),
    people: z.array(aiTaskPersonSchema).max(AI_TASK_LIMITS.maxPeople),
  })
  .refine((t) => t.dueTime === null || t.dueDate !== null, { message: 'dueTime needs a dueDate', path: ['dueTime'] })
  .refine((t) => t.reminderMinutesBefore === null || t.dueTime !== null, {
    message: 'a reminder needs a due time',
    path: ['reminderMinutesBefore'],
  })
  .refine((t) => t.meetingActionId === null || t.meetingActionId === undefined || t.meetingId === null, {
    message: 'meetingActionId is only for a meeting that does not exist yet',
    path: ['meetingActionId'],
  });
export type AiTaskDraft = z.infer<typeof aiTaskDraftSchema>;

/**
 * Partial changes to an existing task. Absent key = unchanged; null (where allowed) = clear.
 * `status: 'done'` completes, `status: 'open'` reopens. The executor normalizes the due fields
 * (clearing the date clears the time and the reminder).
 */
export const aiTaskChangesSchema = z
  .object({
    title: z.string().min(1).max(AI_LIMITS.maxTitleChars),
    description: z.string().max(AI_LIMITS.maxDescriptionChars),
    dueDate: localDateKeySchema.nullable(),
    dueTime: localTimeKeySchema.nullable(),
    reminderMinutesBefore: z.number().int().min(0).max(AI_TASK_LIMITS.maxReminderMinutes).nullable(),
    meetingId: meetingIdSchema.nullable(),
    people: z.array(aiTaskPersonSchema).max(AI_TASK_LIMITS.maxPeople),
    status: z.enum(TASK_ACTION_STATUSES),
  })
  .partial()
  .refine((c) => Object.keys(c).length > 0, { message: 'changes must not be empty' });
export type AiTaskChanges = z.infer<typeof aiTaskChangesSchema>;

export const createTaskActionSchema = z.object({
  type: z.literal('create_task'),
  ...actionBase,
  task: aiTaskDraftSchema,
});

export const updateTaskActionSchema = z.object({
  type: z.literal('update_task'),
  ...actionBase,
  taskId: meetingIdSchema,
  changes: aiTaskChangesSchema,
});

export const deleteTaskActionSchema = z.object({
  type: z.literal('delete_task'),
  ...actionBase,
  taskId: meetingIdSchema,
});

/** Read-only: show these tasks (may be empty when nothing matched). */
export const listTasksActionSchema = z.object({
  type: z.literal('list_tasks'),
  ...actionBase,
  taskIds: z.array(meetingIdSchema).max(AI_LIMITS.maxBulkMeetings),
});

export const aiActionSchema = z.discriminatedUnion('type', [
  createMeetingActionSchema,
  updateMeetingActionSchema,
  deleteMeetingActionSchema,
  shareMeetingActionSchema,
  bulkUpdateActionSchema,
  listActionSchema,
  createTaskActionSchema,
  updateTaskActionSchema,
  deleteTaskActionSchema,
  listTasksActionSchema,
]);
export type AiAction = z.infer<typeof aiActionSchema>;
export type CreateMeetingAction = z.infer<typeof createMeetingActionSchema>;
export type UpdateMeetingAction = z.infer<typeof updateMeetingActionSchema>;
export type DeleteMeetingAction = z.infer<typeof deleteMeetingActionSchema>;
export type ShareMeetingAction = z.infer<typeof shareMeetingActionSchema>;
export type BulkUpdateAction = z.infer<typeof bulkUpdateActionSchema>;
export type ListAction = z.infer<typeof listActionSchema>;
export type CreateTaskAction = z.infer<typeof createTaskActionSchema>;
export type UpdateTaskAction = z.infer<typeof updateTaskActionSchema>;
export type DeleteTaskAction = z.infer<typeof deleteTaskActionSchema>;
export type ListTasksAction = z.infer<typeof listTasksActionSchema>;

/** Actions that change data (everything except the read-only lists). */
export function isMutatingAction(action: AiAction): boolean {
  return action.type !== 'list' && action.type !== 'list_tasks';
}

// ---------------------------------------------------------------------------------------------
// Response
// ---------------------------------------------------------------------------------------------

export const assistantUsageSchema = z.object({
  /** Requests counted today, including this one. */
  used: z.number().int().min(0),
  limit: z.number().int().min(0),
  plan: planSchema,
  /** Next UTC midnight. */
  resetsAt: isoDateTimeSchema,
});
export type AssistantUsage = z.infer<typeof assistantUsageSchema>;

export const assistantResponseSchema = z.object({
  /** Assistant text in the request language. No actions => `actions: []`. */
  reply: z.string().max(AI_LIMITS.maxReplyChars),
  actions: z.array(aiActionSchema).max(AI_LIMITS.maxActions),
  /** Quick-reply chips (e.g. follow-up suggestions), in the request language. */
  suggestions: z.array(z.string().min(1).max(AI_LIMITS.maxSuggestionChars)).max(AI_LIMITS.maxSuggestions),
  usage: assistantUsageSchema,
  /**
   * v4, optional: set only when the request carried `pendingActions` and the user's latest
   * message was plain consent to (or refusal of) them. The app confirms or rejects the pending
   * cards exactly as the on-screen buttons would. A response that proposes actions never
   * carries a resolution.
   */
  resolution: z.enum(PENDING_RESOLUTIONS).nullable().optional(),
});
export type AssistantResponse = z.infer<typeof assistantResponseSchema>;

// ---------------------------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------------------------

export const ASSISTANT_ERROR_CODES = ['quota_exceeded', 'unauthenticated', 'invalid_request', 'upstream_error'] as const;
export type AssistantErrorCode = (typeof ASSISTANT_ERROR_CODES)[number];

/** Firebase HttpsError code the function throws for each assistant error. */
export const ASSISTANT_ERROR_HTTPS_CODES = {
  quota_exceeded: 'resource-exhausted',
  unauthenticated: 'unauthenticated',
  invalid_request: 'invalid-argument',
  upstream_error: 'unavailable',
} as const satisfies Record<AssistantErrorCode, string>;

/** `HttpsError.details` payload the function attaches to every assistant error. */
export const assistantErrorDetailsSchema = z.object({
  reason: z.enum(ASSISTANT_ERROR_CODES),
  /** Present for quota_exceeded. */
  usage: assistantUsageSchema.nullable(),
});
export type AssistantErrorDetails = z.infer<typeof assistantErrorDetailsSchema>;

/**
 * Maps a callable error code ("functions/resource-exhausted" on the client, or the bare
 * "resource-exhausted") to an assistant error code. Prefer `details.reason` when present.
 */
export function assistantErrorCodeFromFunctionsCode(code: string | null | undefined): AssistantErrorCode {
  const bare = (code ?? '').replace(/^functions\//, '');
  switch (bare) {
    case 'resource-exhausted':
      return 'quota_exceeded';
    case 'unauthenticated':
    case 'permission-denied':
      return 'unauthenticated';
    case 'invalid-argument':
    case 'failed-precondition':
    case 'out-of-range':
      return 'invalid_request';
    default:
      return 'upstream_error';
  }
}

// ---------------------------------------------------------------------------------------------
// deleteAccount
// ---------------------------------------------------------------------------------------------

export const deleteAccountRequestSchema = z.object({ confirm: z.literal(true) });
export type DeleteAccountRequest = z.infer<typeof deleteAccountRequestSchema>;
export const deleteAccountResponseSchema = z.object({ deleted: z.literal(true) });
export type DeleteAccountResponse = z.infer<typeof deleteAccountResponseSchema>;

// ---------------------------------------------------------------------------------------------
// Zoom auto links (zoom* callables; docs/v1/ARCHITECTURE.md §24, docs/v1/SETUP.md §12)
// ---------------------------------------------------------------------------------------------
//
// The server owns a Zoom Server-to-Server OAuth app (one host account for every user). The app
// NEVER sees Zoom credentials: it asks zoomStatus whether the integration is configured
// (ZOOM_ENABLED param; answerable without the secrets, so the function always deploys) and asks
// zoomCreateMeeting to create the link for a SAVED meeting. The server loads the caller's own
// meeting document, validates ownership + provider 'zoom' + no existing external.zoomMeetingId,
// creates a scheduled Zoom meeting (type 2) from the document's topic/startAt/duration/timezone,
// writes conference.url/password + external.zoomMeetingId back via the Admin SDK and returns
// them. All zoom* callables except zoomStatus require a VERIFIED account (same rule as the
// assistant) and are capped per user per UTC day (ZOOM_USER_DAILY_LIMIT).

/** Zoom's own numeric meeting id, stored as a string in external.zoomMeetingId. */
export const zoomMeetingNumberSchema = z.string().regex(/^[0-9]{1,32}$/);

export const zoomStatusRequestSchema = z.object({});
export type ZoomStatusRequest = z.infer<typeof zoomStatusRequestSchema>;
export const zoomStatusResponseSchema = z.object({ configured: z.boolean() });
export type ZoomStatusResponse = z.infer<typeof zoomStatusResponseSchema>;

export const zoomCreateMeetingRequestSchema = z.object({ meetingId: meetingIdSchema });
export type ZoomCreateMeetingRequest = z.infer<typeof zoomCreateMeetingRequestSchema>;
export const zoomCreateMeetingResponseSchema = z.object({
  /** The real join_url returned by Zoom (also written to conference.url server-side). */
  url: httpUrlSchema,
  /** Zoom passcode when the account settings add one; also written to conference.password. */
  password: z.string().max(100).nullable(),
  zoomMeetingId: zoomMeetingNumberSchema,
});
export type ZoomCreateMeetingResponse = z.infer<typeof zoomCreateMeetingResponseSchema>;

/** Patches topic/start/duration/timezone of the EXISTING Zoom meeting after a local edit. */
export const zoomSyncMeetingRequestSchema = z.object({ meetingId: meetingIdSchema });
export type ZoomSyncMeetingRequest = z.infer<typeof zoomSyncMeetingRequestSchema>;
export const zoomSyncMeetingResponseSchema = z.object({ updated: z.boolean() });
export type ZoomSyncMeetingResponse = z.infer<typeof zoomSyncMeetingResponseSchema>;

/**
 * Deletes the Zoom meeting. `meetingId` targets a still-existing meeting document;
 * `zoomMeetingId` covers cleanup after the document is already gone (tombstoned/hard-deleted).
 * At least one must be non-null; a Zoom meeting that is already gone resolves deleted: true.
 */
export const zoomDeleteMeetingRequestSchema = z
  .object({
    meetingId: meetingIdSchema.nullable(),
    zoomMeetingId: zoomMeetingNumberSchema.nullable(),
  })
  .refine((value) => value.meetingId !== null || value.zoomMeetingId !== null, {
    message: 'meetingId or zoomMeetingId is required',
  });
export type ZoomDeleteMeetingRequest = z.infer<typeof zoomDeleteMeetingRequestSchema>;
export const zoomDeleteMeetingResponseSchema = z.object({ deleted: z.boolean() });
export type ZoomDeleteMeetingResponse = z.infer<typeof zoomDeleteMeetingResponseSchema>;

/** Error taxonomy of the zoom* callables (details.reason, like the assistant's). */
export const ZOOM_ERROR_CODES = [
  'unauthenticated',
  'not_configured',
  'not_found',
  'invalid_request',
  'quota_exceeded',
  'upstream_error',
] as const;
export type ZoomErrorCode = (typeof ZOOM_ERROR_CODES)[number];

/** Firebase HttpsError code the function throws for each zoom error. */
export const ZOOM_ERROR_HTTPS_CODES = {
  unauthenticated: 'unauthenticated',
  not_configured: 'failed-precondition',
  not_found: 'not-found',
  invalid_request: 'invalid-argument',
  quota_exceeded: 'resource-exhausted',
  upstream_error: 'unavailable',
} as const satisfies Record<ZoomErrorCode, string>;

/** `HttpsError.details` payload the zoom* callables attach to every error. */
export const zoomErrorDetailsSchema = z.object({ reason: z.enum(ZOOM_ERROR_CODES) });
export type ZoomErrorDetails = z.infer<typeof zoomErrorDetailsSchema>;

// ---------------------------------------------------------------------------------------------
// WhatsApp bot (whatsapp* callables; docs/v1/ARCHITECTURE.md §27, docs/v1/SETUP.md §14)
// ---------------------------------------------------------------------------------------------
//
// The server owns ONE WhatsApp Cloud API phone number (the Meta test number during development).
// Users link their WhatsApp phone number to their account with a short-lived 6-digit code: the
// app mints it (whatsappLinkStart), the user sends it to the bot number, and the webhook matches
// it server-side. The bot then reuses the assistant pipeline over WhatsApp; confirmed actions
// are executed SERVER-side (the only place the server mutates meetings, owner-scoped and
// re-validated with these same schemas). The three whatsapp* callables below bind NO secrets and
// always deploy; the webhook itself is gated by the WHATSAPP_ENABLED param (§27).

/** A linked WhatsApp phone number as the Cloud API reports it: E.164 digits, no "+". */
export const WHATSAPP_PHONE_PATTERN = /^[0-9]{6,20}$/;
export const whatsappPhoneSchema = z.string().regex(WHATSAPP_PHONE_PATTERN);

/** The 6-digit link code (crypto random, zero-padded; stored only as a sha256 hash). */
export const WHATSAPP_LINK_CODE_PATTERN = /^[0-9]{6}$/;
export const whatsappLinkCodeSchema = z.string().regex(WHATSAPP_LINK_CODE_PATTERN);

export const whatsappLinkStartRequestSchema = z.object({});
export type WhatsappLinkStartRequest = z.infer<typeof whatsappLinkStartRequestSchema>;
export const whatsappLinkStartResponseSchema = z.object({
  /** Returned in plain text exactly once; the server keeps only the hash. */
  code: whatsappLinkCodeSchema,
  expiresAtIso: isoDateTimeSchema,
});
export type WhatsappLinkStartResponse = z.infer<typeof whatsappLinkStartResponseSchema>;

export const whatsappLinkStatusRequestSchema = z.object({});
export type WhatsappLinkStatusRequest = z.infer<typeof whatsappLinkStatusRequestSchema>;
export const whatsappLinkStatusResponseSchema = z.object({
  /** WHATSAPP_ENABLED param: the bot is deployed and configured. */
  enabled: z.boolean(),
  /** The caller has a linked phone number. */
  linked: z.boolean(),
  /** The bot's human-readable number (digits), or null while not configured. */
  displayNumber: whatsappPhoneSchema.nullable(),
  /** "https://wa.me/<digits>" chat link for the bot number, or null while not configured. */
  deepLink: httpUrlSchema.nullable(),
  /**
   * Last digits of the phone LINKED to this account (never the full number), or null while
   * unlinked. Lets the owner see which phone the bot answers to (a leaked link code binds an
   * attacker's phone; this makes that visible in Settings).
   */
  linkedLast4: z.string().regex(/^[0-9]{1,4}$/).nullable(),
});
export type WhatsappLinkStatusResponse = z.infer<typeof whatsappLinkStatusResponseSchema>;

export const whatsappUnlinkRequestSchema = z.object({});
export type WhatsappUnlinkRequest = z.infer<typeof whatsappUnlinkRequestSchema>;
export const whatsappUnlinkResponseSchema = z.object({
  /** true when a linked phone number was removed; false when nothing was linked (idempotent). */
  unlinked: z.boolean(),
});
export type WhatsappUnlinkResponse = z.infer<typeof whatsappUnlinkResponseSchema>;

/** Error taxonomy of the whatsapp* callables (details.reason, like the zoom ones). */
export const WHATSAPP_ERROR_CODES = [
  'not_configured',
  'unauthenticated',
  'invalid_request',
  'rate_limited',
  'upstream_error',
] as const;
export type WhatsappErrorCode = (typeof WHATSAPP_ERROR_CODES)[number];

/** Firebase HttpsError code the function throws for each whatsapp error. */
export const WHATSAPP_ERROR_HTTPS_CODES = {
  not_configured: 'failed-precondition',
  unauthenticated: 'unauthenticated',
  invalid_request: 'invalid-argument',
  rate_limited: 'resource-exhausted',
  upstream_error: 'unavailable',
} as const satisfies Record<WhatsappErrorCode, string>;

/** `HttpsError.details` payload the whatsapp* callables attach to every error. */
export const whatsappErrorDetailsSchema = z.object({ reason: z.enum(WHATSAPP_ERROR_CODES) });
export type WhatsappErrorDetails = z.infer<typeof whatsappErrorDetailsSchema>;

// ---------------------------------------------------------------------------------------------
// Server helpers (pure)
// ---------------------------------------------------------------------------------------------

/** Usage document id for a date: UTC "YYYY-MM-DD" (usage/{uid}/days/{key}). */
export function usageDayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Next UTC midnight after `date`, as ISO string (AssistantUsage.resetsAt). */
export function nextUsageResetIso(date: Date): string {
  const next = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1));
  return next.toISOString();
}

/**
 * Lenient reader for users/{uid}/meetings/{id} documents, limited to the fields the assistant
 * needs for context. Must stay compatible with `meetingSchema` in src/core/types.ts
 * (a unit test enforces this). Unknown/missing fields fall back instead of failing.
 */
/**
 * v5: lenient reader for users/{uid}/tasks/{id} documents, limited to the fields the assistant
 * needs for context. Must stay compatible with `taskSchema` in src/core/types.ts.
 */
export const aiTaskContextDocSchema = z.object({
  title: z.string().catch(''),
  description: z.string().catch(''),
  dueDate: z.string().nullable().catch(null),
  dueTime: z.string().nullable().catch(null),
  timezone: z.string().catch('UTC'),
  reminderMinutesBefore: z.number().nullable().catch(null),
  status: z.string().catch('open'),
  meetingId: z.string().nullable().catch(null),
  people: z
    .array(z.object({ name: z.string().catch(''), email: z.string().nullable().catch(null) }))
    .catch([]),
  completedAt: z.string().nullable().catch(null),
  updatedAt: z.string().catch(''),
});
export type AiTaskContextDoc = z.infer<typeof aiTaskContextDocSchema>;

export const aiMeetingContextDocSchema = z.object({
  title: z.string().catch(''),
  description: z.string().catch(''),
  startAt: z.string(),
  durationMinutes: z.number().catch(60),
  timezone: z.string().catch('UTC'),
  allDay: z.boolean().catch(false),
  status: z.string().catch('scheduled'),
  deletedAt: z.string().nullable().catch(null),
  source: z.string().catch('manual'),
  participants: z
    .array(z.object({ email: z.string(), name: z.string().nullable().catch(null) }))
    .catch([]),
  location: meetingLocationSchema.nullable().catch(null),
  conference: conferenceDetailsSchema.nullable().catch(null),
  /**
   * v6: per-occurrence exceptions of a series, keyed by the ORIGINAL occurrence date. Without
   * these an agenda answer announces a standup that was cancelled, or announces a moved one at
   * its old time. Only the status and the new start are read; everything else is tolerated.
   */
  recurrenceOverrides: z
    .record(
      z.string(),
      z.object({ status: z.string().catch('modified'), startAt: z.string().nullable().catch(null) }).catch({ status: 'modified', startAt: null }),
    )
    .nullable()
    .catch(null),
  /** v2: the repeat rule, so the assistant can describe series and propose scoped edits. */
  recurrence: recurrenceRuleSchema.nullable().catch(null),
});
export type AiMeetingContextDoc = z.infer<typeof aiMeetingContextDocSchema>;

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
 *
 * v7: spoken debrief (M8). Mode 'debrief': after a meeting the user dictates what was agreed
 * (one spoken transcript as the trailing user message, followUpMeetingId = that meeting) and the
 * server answers ONLY with create_task proposals linked to the meeting (owners in people, due
 * dates resolved from the transcript) plus a short reply. Nothing is saved until the user confirms
 * each card in the app. A v6 server rejects the unknown mode (the app shows the error); a v7
 * server keeps every older behavior unchanged.
 */
export const AI_CONTRACT_VERSION = 7;

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
  microsoftSignIn: 'microsoftSignIn',
  zoomStatus: 'zoomStatus',
  zoomCreateMeeting: 'zoomCreateMeeting',
  zoomSyncMeeting: 'zoomSyncMeeting',
  zoomDeleteMeeting: 'zoomDeleteMeeting',
  whatsappLinkStart: 'whatsappLinkStart',
  whatsappLinkStatus: 'whatsappLinkStatus',
  whatsappUnlink: 'whatsappUnlink',
  summaryStatus: 'summaryStatus',
  summaryAction: 'summaryAction',
  summaryRead: 'summaryRead',
  /** M11: equals SUMMARY_COMMITMENTS_CALLABLE (a test keeps them equal); FUNCTIONS_CONTRACT has its row. */
  summaryCommitments: 'summaryCommitments',
  matterDraft: 'matterDraft',
  matterRevise: 'matterRevise',
  matterConfirm: 'matterConfirm',
  matterCancel: 'matterCancel',
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

/** Client-side timeout for summaryStatus and summaryAction (Firestore work only, no external calls). */
export const SUMMARIES_CALL_TIMEOUT_MS = 15_000;

/** Client-side timeout for summaryRead (the function itself times out at 30 s: decrypt plus re-match). */
export const SUMMARIES_READ_TIMEOUT_MS = 35_000;

/**
 * M11: the summaryCommitments callable (suggested tasks from a filed or kept summary). Kept as its
 * own name for the server code that already uses it; since the app's service landed (M11 day 4)
 * CALLABLES.summaryCommitments holds the same value, with its FUNCTIONS_CONTRACT row in
 * src/core/contracts.ts (a missing row is a compile error).
 */
export const SUMMARY_COMMITMENTS_CALLABLE = 'summaryCommitments' as const;

/**
 * Client-side timeout for summaryCommitments (the function times out at 90 s: one OpenAI call of
 * at most 70 s plus the reads, the checks and the transaction).
 */
export const SUMMARY_COMMITMENTS_TIMEOUT_MS = 100_000;
/** Client-side timeout for the matter* callables (one model call, plus one email for confirm). */
export const MATTER_CALL_TIMEOUT_MS = 70_000;

// ---------------------------------------------------------------------------------------------
// Shared enums (types.ts re-uses these so there is a single definition)
// ---------------------------------------------------------------------------------------------

export const LANGUAGES = ['en', 'es'] as const;
export type Language = (typeof LANGUAGES)[number];

export const PLANS = ['free', 'pro', 'premium'] as const;
export type Plan = (typeof PLANS)[number];

/**
 * AI allowances per plan (server-enforced; functions/src/assistant/quota.ts):
 * - free: the introductory allowance. A window of `windowDays` days that starts with the user's
 *   first AI action, `total` actions in all, at most `perDay` per UTC day; afterwards AI needs a
 *   subscription. Manual creation, viewing, export and scheduled reminders stay free.
 * - pro / premium: `perMonth` actions per subscription month, renewing on the monthly
 *   anniversary of the subscription start (yearly subscribers included; a UTC calendar month
 *   when the start is unknown). The WhatsApp sublimits of Stage 3 count inside these numbers.
 */
export const AI_ALLOWANCES = {
  free: { kind: 'introductory', windowDays: 7, total: 10, perDay: 3 },
  pro: { kind: 'monthly', perMonth: 100 },
  premium: { kind: 'monthly', perMonth: 400 },
} as const;

/** The headline number of each plan (free: the window total; paid: per month). */
export const PLAN_AI_LIMITS: Readonly<Record<Plan, number>> = {
  free: AI_ALLOWANCES.free.total,
  pro: AI_ALLOWANCES.pro.perMonth,
  premium: AI_ALLOWANCES.premium.perMonth,
};

/** Replies that only ask for missing details are not charged, this many times in a row. */
export const CLARIFICATIONS_PER_ACTION = 2;

/** Which allowance an AssistantUsage describes. */
export const USAGE_PERIODS = ['day', 'window', 'month'] as const;
export type UsagePeriod = (typeof USAGE_PERIODS)[number];

export const CONFERENCE_PROVIDERS = ['zoom', 'teams', 'google_meet', 'other'] as const;
export type ConferenceProvider = (typeof CONFERENCE_PROVIDERS)[number];

export const LOCATION_TYPES = ['physical', 'virtual', 'hybrid'] as const;
export type LocationType = (typeof LOCATION_TYPES)[number];

export const ASSISTANT_MODES = ['chat', 'followup', 'debrief'] as const;
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
    /** Required in followup and debrief mode: the meeting that just ended. */
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
  .refine((r) => (r.mode !== 'followup' && r.mode !== 'debrief') || r.followUpMeetingId !== null, {
    message: 'followUpMeetingId is required in followup and debrief mode',
    path: ['followUpMeetingId'],
  })
  .refine(
    (r) => r.mode === 'followup' || (r.messages.length > 0 && r.messages[r.messages.length - 1]?.role === 'user'),
    { message: 'chat and debrief mode require a trailing user message', path: ['messages'] },
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
  /** Actions counted in the period, including this one. */
  used: z.number().int().min(0),
  limit: z.number().int().min(0),
  plan: planSchema,
  /** When the period ends (next UTC midnight for 'day', the window end, the next cycle start). */
  resetsAt: isoDateTimeSchema,
  /** The allowance described; absent on answers of older servers (then 'day'). */
  period: z.enum(USAGE_PERIODS).optional(),
  /** Free plan: the introductory allowance is over (window ended or total used); AI needs a subscription. */
  subscriptionRequired: z.boolean().optional(),
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
// Sign in with Microsoft (microsoftSignIn callable; docs/v1/ARCHITECTURE.md §31, SETUP.md §10.6)
// ---------------------------------------------------------------------------------------------
//
// The app runs the Microsoft PKCE sign-in (scopes openid profile email) and sends the id_token
// plus the raw nonce it put in the request. The callable verifies the token against Microsoft's
// published keys (audience = the Azure client id, issuer = the token's tenant, nonce, lifetime),
// resolves or creates the Firebase user and answers with a custom token the app signs in with.
// Unauthenticated by design (it IS the sign-in); it never reads anything but the token.

/** Client-side timeout for microsoftSignIn (one JWKS fetch at most plus a token mint). */
export const MICROSOFT_SIGN_IN_CALL_TIMEOUT_MS = 20_000;

export const microsoftSignInRequestSchema = z.object({
  /** The Microsoft id_token from the authorization-code exchange (RS256 JWT). */
  idToken: z.string().min(1).max(8192),
  /** The raw nonce the app sent in the authorize request; must equal the token's nonce claim. */
  nonce: z.string().min(16).max(128),
  /**
   * Website only: sign in EXISTING users and never create one. An unknown Microsoft account
   * (no identity, no verified-email match) answers not-found / microsoft_user_not_found and
   * nothing is written. The app omits it (first sign-in creates the account).
   */
  signInOnly: z.boolean().optional(),
});
export type MicrosoftSignInRequest = z.infer<typeof microsoftSignInRequestSchema>;

export const microsoftSignInResponseSchema = z.object({
  /** Firebase custom token for signInWithCustomToken. */
  customToken: z.string().min(1),
  uid: z.string().min(1),
  /** The Firebase user was created by this call. */
  created: z.boolean(),
  /** The Microsoft identity was attached to an existing account with the same verified email. */
  linked: z.boolean(),
});
export type MicrosoftSignInResponse = z.infer<typeof microsoftSignInResponseSchema>;

/** `details.reason` values of a failed microsoftSignIn call (HttpsError codes in parentheses). */
export const MICROSOFT_SIGN_IN_REASONS = [
  /** failed-precondition: MICROSOFT_CLIENT_ID is not set on the functions. */
  'microsoft_not_configured',
  /** unauthenticated: signature, audience, issuer, nonce or lifetime check failed. */
  'microsoft_token_invalid',
  /** already-exists: an account with this email exists and the Microsoft email is not verified. */
  'email_in_use',
  /** not-found: signInOnly and no Meeting Guard account for this Microsoft account yet. */
  'microsoft_user_not_found',
] as const;
export type MicrosoftSignInReason = (typeof MICROSOFT_SIGN_IN_REASONS)[number];

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
// Meeting summaries (summary* callables; M10, docs/v2/M10-DESIGN.md sections 4 to 9)
// ---------------------------------------------------------------------------------------------
//
// Meeting Guard AI never joins, records or listens to a meeting. The user's own notetaker emails
// its summary to a private forwarding address; the summaryInbound webhook (HTTP, not a callable)
// checks the DKIM signature itself, then files the summary under the meeting it matches by title
// AND time, holds it in the summary inbox, or refuses it without keeping its content. Summary
// documents are server-only and their content is sealed with a server key, so the app reads and
// changes them ONLY through these three callables:
// - summaryStatus (always deployed, no secret): whether the feature is on for the caller, the
//   private address, the mailboxes, pending Gmail confirmation codes, the inbox count, the last
//   refusal and today's refusal count. It answers enabled / allowed false instead of throwing
//   not_enabled / not_allowed, so the Settings row can hide itself; a signed-out caller still
//   gets unauthenticated.
// - summaryAction (always deployed, no secret): address, mailbox and filing changes. It cannot
//   decrypt, so it never returns summary content (titles included).
// - summaryRead (deployed only with SUMMARIES_ENABLED, binds the data key): the lists and the full
//   view. A missing summaryRead function reaches the app as functions/not-found WITHOUT details;
//   the app treats that as not_enabled (details.reason 'not_found' means a missing summary).
// Every op except summaryStatus requires a verified caller (the assistant's rule) in the pilot
// list. ADDITIVE: AI_CONTRACT_VERSION is unchanged and no older client sends these requests.

export const SUMMARY_LIMITS = {
  /** Mailboxes where the user's recaps arrive (lowercased by the server). */
  maxMailboxes: 5,
  /** Pending Gmail forwarding confirmations, one per requesting Gmail address (2-day expiry). */
  maxGmailRequests: 3,
  /**
   * New private addresses per UTC day; regenerate_address answers rate_limited after this, and so
   * does create_address after a disconnect (that create counts as a rotation).
   */
  maxRotationsPerDay: 5,
  /**
   * Refusals counted per UTC day (the only daily cap, deduped by the provider's delivery id).
   * Past it, further junk that day is dropped uncounted; summaryStatus refusedToday.capped tells
   * the app to suggest a new address. Accepted and inbox mail is never capped.
   */
  maxRefusalsPerDay: 40,
  /** Sanitized plain text of one summary. */
  maxTextChars: 100_000,
  maxSections: 40,
  /** Items across ALL sections of one summary (not per section). */
  maxItems: 400,
  maxItemChars: 1_000,
  /** owner and dueText of an item, as written ("(owner: Bish)"). */
  maxItemFieldChars: 200,
  maxHeadingChars: 200,
  /** Summary titles and meeting titles in snapshots and suggestions (the server truncates). */
  maxTitleChars: 500,
  maxSubjectChars: 1_000,
  /** One-tap "File under ..." suggestions on an inbox card. */
  maxSuggestions: 3,
  /** Rows in one summaryRead list answer, newest first (hasMore says more exist). */
  maxListItems: 100,
} as const;

/** Where a summary stands (plain text on the server: structure, not content). */
export const SUMMARY_STATUSES = [
  /** Filed under a meeting: automatically (rule A, vendor_verified only) or by the user. */
  'matched',
  /** Genuine, waiting in the summary inbox for the user; inboxReason says why. */
  'inbox',
  /** The user chose "Keep without a meeting". */
  'kept',
  /** Not accepted. The row keeps only the reason, a day, a count and a verified sender domain. */
  'refused',
] as const;
export type SummaryStatus = (typeof SUMMARY_STATUSES)[number];

/** How a summary reached the account (immutable trust fact, set at receipt). */
export const SUMMARY_TIERS = [
  /** Signed (aligned DKIM pass) by an allowlisted notetaker sender address. */
  'vendor_verified',
  /** Forwarded by hand from one of the user's own mailboxes; never filed automatically. */
  'user_forwarded',
] as const;
export type SummaryTier = (typeof SUMMARY_TIERS)[number];

/** Why a genuine summary waits in the inbox instead of being filed. */
export const SUMMARY_INBOX_REASONS = [
  /** Vendor-signed and addressed to the user, but the signed Date is stale or not signed. */
  'old_summary',
  /**
   * Vendor-signed, but none of the user's mailboxes is in a SIGNED To or Cc (sent straight to the
   * private address, Bcc, or To/Cc unsigned). Never gets one-tap suggestions.
   */
  'not_addressed_to_you',
  /** Forwarded by hand from a listed mailbox; one-tap suggestions, never filed automatically. */
  'user_forwarded',
  /**
   * One plausible meeting (rule B), or the best meeting is cancelled or all-day: suggested first,
   * never filed automatically.
   */
  'needs_confirmation',
  /** Two meetings scored too close to tell apart; both suggested. */
  'ambiguous',
  /** No meeting in the time window (it may be on a calendar that is not connected). */
  'no_candidate',
  /** Meetings in the window, none above the filing thresholds. */
  'weak',
  /** No date in the summary and no signed time to search by. */
  'no_date',
] as const;
export type SummaryInboxReason = (typeof SUMMARY_INBOX_REASONS)[number];

/** Why an email was refused (its content is not stored by Meeting Guard AI). */
export const SUMMARY_REFUSED_REASONS = [
  /** Over the size limits: 5 MiB raw, 100 MIME parts or 10 levels of nesting. */
  'too_large',
  /** Broken structure or headers: a repeated From, To, Cc, Date, Subject, Message-ID or Sender, or a From that is not one plain address. */
  'malformed',
  /** The notetaker's signature broke on the way, behind a valid Google or Microsoft forwarding seal (the fix is a Redirect rule; an attached recap is not verified yet). */
  'could_not_verify_after_forwarding',
  /** The notetaker's signature is present but no longer matches: changed after it was sent. */
  'changed_after_sending',
  /** From names the notetaker or one of the user's mailboxes, but no valid signature backs it. */
  'sender_not_verified',
  /** Anything else: an unlisted or missing signer, a display-name spoof, someone else's forward. */
  'not_from_your_notetaker',
  /** Genuine, but no readable text was left after parsing. */
  'unreadable',
] as const;
export type SummaryRefusedReason = (typeof SUMMARY_REFUSED_REASONS)[number];

/** Section kinds (headings recognized in English and Spanish; design section 8). */
export const SUMMARY_SECTION_KINDS = [
  /** Lines before the first heading (title line, date line). */
  'preamble',
  /** The notetaker's own digest; derived, never ground truth. */
  'tldr',
  /** A "Summary" or "Overview" section; derived, like tldr. */
  'summary',
  'updates',
  'decisions',
  'action_items',
  'next_steps',
  'waiting_on',
  'open_questions',
  'notes',
  /** An unknown short heading, kept verbatim ("Launch Readiness"). */
  'custom',
  /** No heading at all: the whole text as one section. */
  'body',
] as const;
export type SummarySectionKind = (typeof SUMMARY_SECTION_KINDS)[number];

export const SUMMARY_ITEM_FLAGS = [
  /** The text reads like an instruction to an AI or to the reader; never pre-selected in M11. */
  'possible_instruction',
  /** Contains a link; links are shown as plain text and never become actions. */
  'has_link',
  /** Cut at SUMMARY_LIMITS.maxItemChars. */
  'truncated',
] as const;
export type SummaryItemFlag = (typeof SUMMARY_ITEM_FLAGS)[number];

/** Who filed a summary under its meeting. */
export const SUMMARY_MATCH_METHODS = ['auto', 'user'] as const;
export type SummaryMatchMethod = (typeof SUMMARY_MATCH_METHODS)[number];

/** summaryRead list views. */
export const SUMMARY_LIST_VIEWS = [
  /** Waiting for a meeting (status inbox). */
  'inbox',
  /** Filed recently (status matched or kept). */
  'recent',
  /** Refused rows, one per UTC day with a count. */
  'refused',
  /** Summaries filed under one meeting (meetingId required; the master id for a series). */
  'meeting',
] as const;
export type SummaryListView = (typeof SUMMARY_LIST_VIEWS)[number];

/** summaryAction ops (the discriminant of summaryActionRequestSchema, same order). */
export const SUMMARY_ACTION_OPS = [
  'create_address',
  'regenerate_address',
  'set_mailboxes',
  'dismiss_gmail',
  'attach',
  'detach',
  'keep',
  'delete',
  'disconnect',
] as const;
export type SummaryActionOp = (typeof SUMMARY_ACTION_OPS)[number];

// ---- Primitives ------------------------------------------------------------------------------

/**
 * Summary, section and item ids: Firestore-safe, never ':'. Accepted summaries use 64 lowercase
 * hex characters (sha256), items "i_" plus 12 hex.
 */
export const SUMMARY_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
export const summaryIdSchema = z.string().regex(SUMMARY_ID_PATTERN);

/**
 * One plain addr-spec (dot-atom local part, LDH domain labels, no display name, no quotes): the
 * private address, the user's mailboxes, a Gmail requester, a sender. Lowercased IDNA ASCII when
 * the server returns it; any case accepted in requests. The local part takes the full RFC 5322
 * atext set (letters, digits and ! # $ % & ' * + - / = ? ^ _ ` { | } ~) so every mailbox the
 * server normalizes (functions/src/summaries/address.ts normalizeMailbox checks its output against
 * this pattern) parses here; no spaces, quotes, commas, angle brackets, a second "@", leading,
 * trailing or consecutive dots.
 */
export const SUMMARY_ADDR_SPEC_PATTERN =
  /^(?=[^@]{1,64}@)[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;
export const summaryAddrSpecSchema = z.string().max(254).regex(SUMMARY_ADDR_SPEC_PATTERN);

/** A DNS name (IDNA ASCII, at least two labels): the d= of a passing signature. */
export const SUMMARY_DOMAIN_PATTERN =
  /^(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;
export const summaryDomainSchema = z.string().regex(SUMMARY_DOMAIN_PATTERN);

/** Gmail's forwarding confirmation code (letters and digits only; exact format UNVERIFIED). */
export const SUMMARY_GMAIL_CODE_PATTERN = /^[A-Za-z0-9]{1,32}$/;
export const summaryGmailCodeSchema = z.string().regex(SUMMARY_GMAIL_CODE_PATTERN);

/** A character offset into a summary's text. */
const summaryOffsetSchema = z.number().int().min(0).max(SUMMARY_LIMITS.maxTextChars);

// ---- summaryStatus ---------------------------------------------------------------------------

/** A Gmail "confirm forwarding" mail that reached the private address (we never open its link). */
export const summaryGmailRequestSchema = z.object({
  /** The Gmail address that asked to forward here; the app makes the card prominent only when it is a listed mailbox. */
  gmailAddress: summaryAddrSpecSchema,
  /** The code the user pastes on the Gmail settings page. */
  code: summaryGmailCodeSchema,
  receivedAt: isoDateTimeSchema,
});
export type SummaryGmailRequest = z.infer<typeof summaryGmailRequestSchema>;

export const summaryLastRefusedSchema = z.object({
  reason: z.enum(SUMMARY_REFUSED_REASONS),
  at: isoDateTimeSchema,
  /** The d= of a PASSING signature only; null means the app says "an unknown sender". */
  senderDomain: summaryDomainSchema.nullable(),
});
export type SummaryLastRefused = z.infer<typeof summaryLastRefusedSchema>;

/** Today's refusal counter (UTC day). capped: SUMMARY_LIMITS.maxRefusalsPerDay was reached. */
export const summaryRefusedTodaySchema = z.object({
  /** The UTC day, YYYY-MM-DD. */
  day: localDateKeySchema,
  /** Refusals counted that day (redeliveries count once). */
  count: z.number().int().min(1),
  /** Over the cap: later junk that day is dropped uncounted; the app suggests a new address. */
  capped: z.boolean(),
});
export type SummaryRefusedToday = z.infer<typeof summaryRefusedTodaySchema>;

export const summaryStatusRequestSchema = z.object({});
export type SummaryStatusRequest = z.infer<typeof summaryStatusRequestSchema>;
export const summaryStatusResponseSchema = z.object({
  /** SUMMARIES_ENABLED: the summary functions are deployed and switched on. */
  enabled: z.boolean(),
  /** The caller is verified and in the pilot list. When false, every field below is empty. */
  allowed: z.boolean(),
  /** The server can hand out addresses (SUMMARIES_ADDRESS_TEMPLATE set); false means "being set up". */
  ready: z.boolean(),
  /** The caller's private forwarding address, or null before create_address (or while not ready). */
  address: summaryAddrSpecSchema.nullable(),
  /** Where the user's recaps arrive; starts as the verified sign-in email. */
  mailboxes: z.array(summaryAddrSpecSchema).max(SUMMARY_LIMITS.maxMailboxes),
  /** Unexpired Gmail confirmation codes, newest first. */
  gmailRequests: z.array(summaryGmailRequestSchema).max(SUMMARY_LIMITS.maxGmailRequests),
  /** Summaries waiting in the inbox ("2 waiting for a meeting"). */
  inboxCount: z.number().int().min(0),
  lastReceivedAt: isoDateTimeSchema.nullable(),
  lastRefused: summaryLastRefusedSchema.nullable(),
  /**
   * Today's refusals (UTC), or null when none were counted today. Added after the first day-2
   * build: a status without it parses as null.
   */
  refusedToday: summaryRefusedTodaySchema.nullable().default(null),
  /**
   * M11, optional: when the current private address was created (its summaryAddresses document;
   * a new address after "Get a new address" or a disconnect has its own time), for the "nothing
   * arrived in 24 hours" Microsoft 365 hint. null without an address or when unknown; absent on
   * every answer of an M10 server.
   */
  addressCreatedAt: isoDateTimeSchema.nullable().optional(),
});
export type SummaryStatusResponse = z.infer<typeof summaryStatusResponseSchema>;

// ---- summaryCommitments enums and limits (M11, docs/v2/M11-DESIGN.md sections 2, 3 and 6) ----
//
// M11 turns a filed or kept summary into suggested tasks ("commitments"): the model proposes, code
// checks every proposal against the stored text, and nothing becomes a task until the user accepts
// it (the server writes the task). ADDITIVE: no 1.6.0 client calls summaryCommitments,
// AI_CONTRACT_VERSION is unchanged, and the M10 shapes only gain optional fields.

export const COMMITMENT_LIMITS = {
  /** Suggestions in one extraction (AI proposals that survived the checks, or the items as written). */
  maxProposals: 30,
  /** Decisions in one decide call. */
  maxDecisionsPerCall: 30,
  /** A sentence quote (a commitment from a section without items) is a whole sentence of at most this. */
  maxQuoteChars: 300,
  /** A sentence quote shorter than this is dropped. Item quotes are always the whole item (maxItemChars). */
  minSentenceQuoteChars: 20,
  /** Suggested and accepted task titles (TASK_LIMITS.maxTitleChars). */
  maxTitleChars: 200,
  /** The person a suggestion names (the task's people entry). */
  maxOwnerChars: 100,
} as const;

/** How the suggestions were made: AI over the whole text, or the action items exactly as written (no AI, free). */
export const COMMITMENT_MODES = ['ai', 'as_written'] as const;
export type CommitmentMode = (typeof COMMITMENT_MODES)[number];

/** Where a summary's suggestions stand. */
export const COMMITMENT_STATES = [
  /** Nothing prepared yet (get never calls the model). */
  'none',
  /** Another device or WhatsApp is preparing them right now; ask again in a few seconds. */
  'preparing',
  'ready',
  /** Prepared, and nothing survived the checks (or there were no action items). */
  'empty',
  /** The summary changed since (content, parser or extractor): the old decisions are read-only; prepare again, free. */
  'stale',
] as const;
export type CommitmentState = (typeof COMMITMENT_STATES)[number];

/** What a suggestion quotes: one whole item of a list, or one whole sentence of a section without items. */
export const COMMITMENT_ANCHOR_KINDS = ['item', 'sentence'] as const;
export type CommitmentAnchorKind = (typeof COMMITMENT_ANCHOR_KINDS)[number];

/**
 * Flags on a suggestion, computed by code, never by the model. The first three are the summary
 * item flags. payment_like: amounts, account-like numbers, pay, wire, passwords. suggested: under a
 * "Suggested next steps" heading (the notetaker's idea, not a promise). checklist: a checkbox of a
 * custom section. owner_guess: "You?" because only the first name matched. similar_added: looks
 * like a task already added from another summary of the meeting. A later server may add values:
 * commitmentFlagsSchema drops unknown ones instead of failing the whole answer.
 */
export const COMMITMENT_FLAGS = [
  'possible_instruction',
  'has_link',
  'truncated',
  'payment_like',
  'suggested',
  'checklist',
  'owner_guess',
  'similar_added',
] as const;
export type CommitmentFlag = (typeof COMMITMENT_FLAGS)[number];

/** A suggestion's state (shared by the app, other devices and WhatsApp). */
export const COMMITMENT_STATUSES = ['open', 'accepted', 'dropped'] as const;
export type CommitmentStatus = (typeof COMMITMENT_STATUSES)[number];

/** Where an accepted suggestion was accepted. */
export const COMMITMENT_CHANNELS = ['app', 'whatsapp'] as const;
export type CommitmentChannel = (typeof COMMITMENT_CHANNELS)[number];

/**
 * Why nothing is pre-selected (the banner). old_summary: vendor signed and addressed to the user,
 * but not fresh. not_addressed_to_you: no "Select all" either. forwarded: a hand forward, the
 * notetaker's signature could not be checked. possible_instruction: part of the text reads like
 * instructions to software ("Select all" never ticks a flagged item).
 */
export const COMMITMENT_PRESELECT_REASONS = ['old_summary', 'not_addressed_to_you', 'forwarded', 'possible_instruction'] as const;
export type CommitmentPreselectReason = (typeof COMMITMENT_PRESELECT_REASONS)[number];

/** decide: accept (create the task), drop, restore (a dropped one), remove (Undo of an accept). */
export const COMMITMENT_DECISIONS = ['accept', 'drop', 'restore', 'remove'] as const;
export type CommitmentDecisionKind = (typeof COMMITMENT_DECISIONS)[number];

/** What one decision did. "Added" is said only from this answer. */
export const COMMITMENT_OUTCOMES = [
  /** The task was created now. */
  'added',
  /** Its task already exists (a second tap, device or WhatsApp reply): nothing created. */
  'already_added',
  'dropped',
  'restored',
  /** Undo: the task was deleted and the suggestion is open again. */
  'removed',
  /** Undo refused: the task was changed since it was added; the app opens the task instead. */
  'changed',
  /** The suggestion is not in a state this decision applies to. */
  'not_open',
] as const;
export type CommitmentOutcome = (typeof COMMITMENT_OUTCOMES)[number];

/**
 * A filed or kept summary's suggestions on a summaryRead row ("Review commitments (5)"). Absent
 * when nothing was prepared, and on every answer of an M10 server.
 */
export const summaryListCommitmentsSchema = z.object({
  state: z.enum(COMMITMENT_STATES),
  /** Suggestions still open (neither accepted nor dropped). */
  open: z.number().int().min(0).max(COMMITMENT_LIMITS.maxProposals),
  accepted: z.number().int().min(0).max(COMMITMENT_LIMITS.maxProposals),
});
export type SummaryListCommitments = z.infer<typeof summaryListCommitmentsSchema>;

// ---- Shared row shapes -----------------------------------------------------------------------

/** The meeting as it was when the summary was filed (plain text: the user's own calendar data). */
export const summaryMeetingSnapshotSchema = z.object({
  title: z.string().max(SUMMARY_LIMITS.maxTitleChars),
  startAt: isoDateTimeSchema,
  endAt: isoDateTimeSchema,
  timezone: timeZoneSchema,
});
export type SummaryMeetingSnapshot = z.infer<typeof summaryMeetingSnapshotSchema>;

export const summaryMatchSchema = z.object({
  /** The master id for a series. */
  meetingId: meetingIdSchema,
  /** For a series: the ORIGINAL local date of the occurrence (the recurrenceOverrides key); else null. */
  occurrenceDate: localDateKeySchema.nullable(),
  method: z.enum(SUMMARY_MATCH_METHODS),
  meetingSnapshot: summaryMeetingSnapshotSchema,
});
export type SummaryMatch = z.infer<typeof summaryMatchSchema>;

/** A one-tap "File under ..." suggestion (never on not_addressed_to_you items). */
export const summarySuggestionSchema = z.object({
  meetingId: meetingIdSchema,
  occurrenceDate: localDateKeySchema.nullable(),
  title: z.string().max(SUMMARY_LIMITS.maxTitleChars),
  startAt: isoDateTimeSchema,
  /** Match score S, 0 to 1. */
  score: z.number().min(0).max(1),
});
export type SummarySuggestion = z.infer<typeof summarySuggestionSchema>;

/** One row of a summaryRead list (titles are the only decrypted field). */
export const summaryListItemSchema = z.object({
  summaryId: summaryIdSchema,
  status: z.enum(SUMMARY_STATUSES),
  /** The summary's title line, else its cleaned subject; null for refused rows (no content kept). */
  title: z.string().max(SUMMARY_LIMITS.maxTitleChars).nullable(),
  /** The date written in the summary (YYYY-MM-DD), or null when none was found. */
  summaryDate: localDateKeySchema.nullable(),
  /** When it arrived; for a refused row, the latest refusal that day. */
  receivedAt: isoDateTimeSchema,
  /** Trust facts, fixed at receipt (filing or keeping never changes them). tier is null for refused rows. */
  tier: z.enum(SUMMARY_TIERS).nullable(),
  /** A listed mailbox was in a signed To or Cc. */
  recipientBound: z.boolean(),
  /** The signed Date was within 14 days before and 24 hours after receipt. */
  fresh: z.boolean(),
  /** Why it waits (status inbox); null otherwise. */
  inboxReason: z.enum(SUMMARY_INBOX_REASONS).nullable(),
  /** Why it was refused (status refused); null otherwise. */
  refusedReason: z.enum(SUMMARY_REFUSED_REASONS).nullable(),
  /** The d= of a passing signature only; null shows as "an unknown sender". */
  senderDomain: summaryDomainSchema.nullable(),
  /** Refused rows: how many refusals that UTC day. null for every other status. */
  count: z.number().int().min(1).nullable(),
  /** Status matched: the meeting it is filed under; null otherwise. */
  match: summaryMatchSchema.nullable(),
  /** Inbox items: up to 3 meetings to file under with one tap, best first. Empty otherwise. */
  suggestions: z.array(summarySuggestionSchema).max(SUMMARY_LIMITS.maxSuggestions),
  /** M11, optional: the suggested tasks' state and counts, once prepared (filed or kept summaries only). */
  commitments: summaryListCommitmentsSchema.optional(),
});
export type SummaryListItem = z.infer<typeof summaryListItemSchema>;

/** An item of a section, verbatim: text === summary.text.slice(start, end) unless truncated. */
export const summaryItemSchema = z.object({
  /** "i_" plus 12 hex, stable across re-parses (M11 cites items by this id). */
  id: summaryIdSchema,
  text: z.string().max(SUMMARY_LIMITS.maxItemChars),
  start: summaryOffsetSchema,
  end: summaryOffsetSchema,
  /** "[x]" true, "[ ]" false, null when the line has no checkbox. */
  checked: z.boolean().nullable(),
  /** As written ("(owner: Bish)", "(responsable: ...)"); null when absent. */
  owner: z.string().max(SUMMARY_LIMITS.maxItemFieldChars).nullable(),
  /** Only when the summary states one; never invented. */
  dueText: z.string().max(SUMMARY_LIMITS.maxItemFieldChars).nullable(),
  flags: z.array(z.enum(SUMMARY_ITEM_FLAGS)).max(SUMMARY_ITEM_FLAGS.length),
});
export type SummaryItem = z.infer<typeof summaryItemSchema>;

export const summarySectionSchema = z.object({
  id: summaryIdSchema,
  kind: z.enum(SUMMARY_SECTION_KINDS),
  /** The heading exactly as written; null for preamble and body. */
  heading: z.string().max(SUMMARY_LIMITS.maxHeadingChars).nullable(),
  /** true for tldr and summary: the notetaker's own digest, never ground truth. */
  derived: z.boolean(),
  /** The section's span of summary.text (heading included). */
  start: summaryOffsetSchema,
  end: summaryOffsetSchema,
  items: z.array(summaryItemSchema).max(SUMMARY_LIMITS.maxItems),
});
export type SummarySection = z.infer<typeof summarySectionSchema>;

/** Offsets inside the text and in order, and at most SUMMARY_LIMITS.maxItems items in total. */
function summarySpansAreValid(value: { text: string; sections: readonly SummarySection[] }): boolean {
  const length = value.text.length;
  let items = 0;
  for (const section of value.sections) {
    if (section.start > section.end || section.end > length) return false;
    for (const item of section.items) {
      if (item.start > item.end || item.end > length) return false;
      items += 1;
    }
  }
  return items <= SUMMARY_LIMITS.maxItems;
}

/** The full view (summaryRead get). Refused rows have no full view (not_found). */
export const summaryDetailSchema = summaryListItemSchema
  .extend({
    subject: z.string().max(SUMMARY_LIMITS.maxSubjectChars).nullable(),
    /** The first meaningful line of the body. */
    titleLine: z.string().max(SUMMARY_LIMITS.maxTitleChars).nullable(),
    /** The From address (the notetaker sender, or the user's mailbox for a hand forward). */
    fromAddress: summaryAddrSpecSchema.nullable(),
    /** user_forwarded: the mailbox it was forwarded from ("Forwarded from <address>"); else null. */
    forwardedBy: summaryAddrSpecSchema.nullable(),
    /** The sanitized plain text; links stay plain text. */
    text: z.string().min(1).max(SUMMARY_LIMITS.maxTextChars),
    sections: z.array(summarySectionSchema).max(SUMMARY_LIMITS.maxSections),
    /**
     * M11, optional: the stored text was cut at receipt (the text, section or item caps, or the
     * size fallback), so the view says only the first part was kept. Absent on every answer of an
     * M10 server (the app then guesses from the caps).
     */
    truncated: z.boolean().optional(),
  })
  .refine(summarySpansAreValid, {
    message: 'section and item offsets must lie inside the text, and items are capped in total',
    path: ['sections'],
  });
export type SummaryDetail = z.infer<typeof summaryDetailSchema>;

// ---- summaryAction ---------------------------------------------------------------------------

export const summaryActionRequestSchema = z.discriminatedUnion('op', [
  /**
   * Idempotent: an existing address is returned unchanged (changed: false). Needs ready. After a
   * disconnect the new address counts as a rotation (rate_limited past maxRotationsPerDay).
   */
  z.object({ op: z.literal('create_address') }),
  /** Confirmed in the app. Mail to the old address is dropped from then on. Needs ready. */
  z.object({ op: z.literal('regenerate_address') }),
  /** Replaces the whole list (the server lowercases and removes duplicates). */
  z.object({
    op: z.literal('set_mailboxes'),
    mailboxes: z.array(summaryAddrSpecSchema).max(SUMMARY_LIMITS.maxMailboxes),
  }),
  /** Removes a pending Gmail confirmation code. */
  z.object({ op: z.literal('dismiss_gmail'), gmailAddress: summaryAddrSpecSchema }),
  /** Files an inbox or kept summary (or moves a filed one) under the caller's meeting. */
  z.object({
    op: z.literal('attach'),
    summaryId: summaryIdSchema,
    meetingId: meetingIdSchema,
    /** Required for a series: the ORIGINAL local date of the occurrence; null for a one-off meeting. */
    occurrenceDate: localDateKeySchema.nullable(),
  }),
  /** "Not this meeting": back to the inbox; that meeting is not suggested again. */
  z.object({ op: z.literal('detach'), summaryId: summaryIdSchema }),
  /** "Keep without a meeting". */
  z.object({ op: z.literal('keep'), summaryId: summaryIdSchema }),
  /** Hard delete; an already deleted summary answers changed: false. */
  z.object({ op: z.literal('delete'), summaryId: summaryIdSchema }),
  /**
   * Deletes the address and the mailbox settings, and every summary when deleteSummaries. Only the
   * day's rotation count is kept, so disconnect plus create cannot reset the daily cap.
   */
  z.object({ op: z.literal('disconnect'), deleteSummaries: z.boolean() }),
]);
export type SummaryActionRequest = z.infer<typeof summaryActionRequestSchema>;

/** A summary's state after attach, detach or keep (no content: summaryAction holds no key). */
export const summaryStateSchema = z.object({
  summaryId: summaryIdSchema,
  status: z.enum(SUMMARY_STATUSES),
  inboxReason: z.enum(SUMMARY_INBOX_REASONS).nullable(),
  match: summaryMatchSchema.nullable(),
});
export type SummaryState = z.infer<typeof summaryStateSchema>;

export const summaryActionResponseSchema = z.object({
  /** false when there was nothing to change (an idempotent repeat). */
  changed: z.boolean(),
  /** The caller's status after the op, so the screens update without a second call. */
  status: summaryStatusResponseSchema,
  /** attach, detach and keep: the summary after the op; null for every other op. */
  summary: summaryStateSchema.nullable(),
});
export type SummaryActionResponse = z.infer<typeof summaryActionResponseSchema>;

// ---- summaryRead -----------------------------------------------------------------------------

export const summaryReadRequestSchema = z.discriminatedUnion('op', [
  /** A list view; inbox first re-matches up to 10 recent unmatched items. */
  z
    .object({
      op: z.literal('list'),
      view: z.enum(SUMMARY_LIST_VIEWS),
      /** Required for view 'meeting' and only for it. */
      meetingId: meetingIdSchema.optional(),
    })
    .refine((request) => (request.view === 'meeting') === (request.meetingId !== undefined), {
      message: 'meetingId is required for view "meeting" and not allowed for the other views',
      path: ['meetingId'],
    }),
  /** The full view of one summary. */
  z.object({ op: z.literal('get'), summaryId: summaryIdSchema }),
]);
export type SummaryReadRequest = z.infer<typeof summaryReadRequestSchema>;

export const summaryReadListResponseSchema = z.object({
  op: z.literal('list'),
  view: z.enum(SUMMARY_LIST_VIEWS),
  /** Newest first. */
  items: z.array(summaryListItemSchema).max(SUMMARY_LIMITS.maxListItems),
  /** More rows exist than fit in one answer. */
  hasMore: z.boolean(),
});
export type SummaryReadListResponse = z.infer<typeof summaryReadListResponseSchema>;

export const summaryReadGetResponseSchema = z.object({
  op: z.literal('get'),
  summary: summaryDetailSchema,
});
export type SummaryReadGetResponse = z.infer<typeof summaryReadGetResponseSchema>;

export const summaryReadResponseSchema = z.discriminatedUnion('op', [
  summaryReadListResponseSchema,
  summaryReadGetResponseSchema,
]);
export type SummaryReadResponse = z.infer<typeof summaryReadResponseSchema>;

// ---- Errors ----------------------------------------------------------------------------------

/** Error taxonomy of the summary* callables (details.reason; HttpsError codes in parentheses). */
export const SUMMARY_ERROR_CODES = [
  /** (unauthenticated) Signed out, or the email is not verified (the assistant's rule). */
  'unauthenticated',
  /** (failed-precondition) SUMMARIES_ENABLED is off. */
  'not_enabled',
  /** (permission-denied) The caller is not in the pilot list. */
  'not_allowed',
  /**
   * (failed-precondition) No address can be used yet: the server's address template is empty
   * (being set up), or the op needs an address the caller has not created.
   */
  'not_ready',
  /** (invalid-argument) The request does not match the schema. */
  'invalid_request',
  /** (not-found) No such summary for this caller, or a refused row asked for its full view. */
  'not_found',
  /**
   * (failed-precondition) attach: the meeting is missing, deleted or not the caller's, or
   * occurrenceDate is not a real occurrence of the series (or is missing for a series).
   */
  'invalid_meeting',
  /** (resource-exhausted) Over SUMMARY_LIMITS.maxRotationsPerDay new addresses in one UTC day. */
  'rate_limited',
  /** (unavailable) Storage or the data key failed; try again later. */
  'upstream_error',
] as const;
export type SummaryErrorCode = (typeof SUMMARY_ERROR_CODES)[number];

/** Firebase HttpsError code the summary* callables throw for each error. */
export const SUMMARY_ERROR_HTTPS_CODES = {
  unauthenticated: 'unauthenticated',
  not_enabled: 'failed-precondition',
  not_allowed: 'permission-denied',
  not_ready: 'failed-precondition',
  invalid_request: 'invalid-argument',
  not_found: 'not-found',
  invalid_meeting: 'failed-precondition',
  rate_limited: 'resource-exhausted',
  upstream_error: 'unavailable',
} as const satisfies Record<SummaryErrorCode, string>;

/** `HttpsError.details` payload the summary* callables attach to every error. */
export const summaryErrorDetailsSchema = z.object({ reason: z.enum(SUMMARY_ERROR_CODES) });
export type SummaryErrorDetails = z.infer<typeof summaryErrorDetailsSchema>;

// ---- summaryCommitments (M11, docs/v2/M11-DESIGN.md sections 2 to 4 and 6) -------------------
//
// One gated callable (SUMMARY_COMMITMENTS_CALLABLE), deployed like summaryRead, with three ops:
// - get {summaryId}: the current suggestions; never calls the model, never charges.
// - prepare {summaryId, mode}: builds them when none are valid. Mode 'ai' sends the text to OpenAI
//   through the server (one AI action per summary, the first time only); 'as_written' lists the
//   action items exactly as written (free, no AI).
// - decide {summaryId, key, timezone, language, decisions}: accept (the server creates the task in
//   one transaction, with a deterministic id, so a second tap, device or WhatsApp reply never
//   duplicates it), drop, restore, remove (Undo).
// The summary is only ever filed (matched) or kept; anything else answers not_found. Every quote is
// the summary's own text (a whole item or a whole sentence); titles, owners and dates are checked
// against it by code.

/** An extraction's key ("x_" + 16 hex): decide must name the key it was shown. */
export const commitmentKeySchema = z.string().regex(/^x_[0-9a-f]{16}$/);

/** A suggestion's anchor: the summary item id ("i_" + 12 hex) or a sentence id ("q_" + 12 hex). */
export const commitmentAnchorIdSchema = z.string().regex(/^[iq]_[0-9a-f]{12}$/);

/** COMMITMENT_FLAGS, leniently: an unknown value a later server adds is dropped, never a failed parse. */
export const commitmentFlagsSchema = z
  .array(z.enum(COMMITMENT_FLAGS).nullable().catch(null))
  .max(32)
  .transform((flags) => [...new Set(flags.filter((flag): flag is CommitmentFlag => flag !== null))]);

/** The person a suggestion names, as written in the summary. isUser: it is the user ("You"); guess: only the first name matched ("You?"). */
export const commitmentOwnerSchema = z.object({
  name: z.string().min(1).max(COMMITMENT_LIMITS.maxOwnerChars),
  isUser: z.boolean(),
  guess: z.boolean(),
});
export type CommitmentOwner = z.infer<typeof commitmentOwnerSchema>;

/** A deadline the summary states (read by code from its own words); null on the item when none. */
export const commitmentDueSchema = z.object({
  /** Local date YYYY-MM-DD. */
  date: localDateKeySchema,
  /** HH:MM, only when the summary writes a clock time. */
  time: localTimeKeySchema.nullable(),
  /** The zone a stated time is in (the meeting's); null for a date only. */
  zone: timeZoneSchema.nullable(),
  /** The summary's own words for it ("by Friday"), or null. */
  quote: z.string().min(1).max(COMMITMENT_LIMITS.maxQuoteChars).nullable(),
  /** The date has passed: shown as overdue, with no reminder until the user picks one. */
  overdue: z.boolean(),
});
export type CommitmentDue = z.infer<typeof commitmentDueSchema>;

/** One suggestion. */
export const commitmentItemSchema = z.object({
  anchorId: commitmentAnchorIdSchema,
  /** Stable 1-based number within this extraction, never reused (WhatsApp replies name it). */
  number: z.number().int().min(1).max(999),
  anchorKind: z.enum(COMMITMENT_ANCHOR_KINDS),
  sectionKind: z.enum(SUMMARY_SECTION_KINDS),
  /** The section heading as written; null for a body section. */
  sectionHeading: z.string().max(SUMMARY_LIMITS.maxHeadingChars).nullable(),
  /** "From the summary:" the whole item or the whole sentence, verbatim, plain text. */
  quote: z.string().min(1).max(SUMMARY_LIMITS.maxItemChars),
  /** The proposed task title (cleaned; "<owner>: ..." for someone else's commitment). */
  title: z.string().min(1).max(COMMITMENT_LIMITS.maxTitleChars),
  owner: commitmentOwnerSchema.nullable(),
  due: commitmentDueSchema.nullable(),
  /** The model's confidence 0 to 100; null for the items as written. */
  confidence: z.number().int().min(0).max(100).nullable(),
  flags: commitmentFlagsSchema,
  /** Ticked when the screen opens (computed when answered, from the current trust facts). */
  preselected: z.boolean(),
  status: z.enum(COMMITMENT_STATUSES),
  /** Accepted: the task's id; null otherwise. */
  taskId: meetingIdSchema.nullable(),
  /** Accepted: whether that task still exists ("Removed from your tasks" with Add again); null otherwise. */
  taskExists: z.boolean().nullable(),
  /** Accepted: where; null otherwise. */
  via: z.enum(COMMITMENT_CHANNELS).nullable(),
});
export type CommitmentItem = z.infer<typeof commitmentItemSchema>;

/** Summary-level pre-selection (docs/v2/M11-DESIGN.md section 2.6). */
export const commitmentPreselectSchema = z.object({
  /** Clean action-list items may be ticked (a fully trusted recap only). */
  allowed: z.boolean(),
  /** "Select all" is offered (never for a summary not addressed to the user). */
  selectAll: z.boolean(),
  /** The banner; null when pre-selection is allowed. */
  reason: z.enum(COMMITMENT_PRESELECT_REASONS).nullable().catch(null),
});
export type CommitmentPreselect = z.infer<typeof commitmentPreselectSchema>;

/** Where the suggestions come from (the origin block, always shown first). */
export const commitmentOriginSchema = z.object({
  /** The meeting it is filed under (the master id for a series); null for a kept summary. */
  meetingId: meetingIdSchema.nullable(),
  /** The user's own calendar title of that meeting; null for a kept summary. */
  meetingTitle: z.string().max(SUMMARY_LIMITS.maxTitleChars).nullable(),
  /** For a series: the ORIGINAL local date of the occurrence; else null. */
  occurrenceDate: localDateKeySchema.nullable(),
  /** The meeting's local date (else the summary's date), or null. */
  localDate: localDateKeySchema.nullable(),
  tier: z.enum(SUMMARY_TIERS),
  /** The d= of a passing signature only, or null. */
  senderDomain: summaryDomainSchema.nullable(),
  /** user_forwarded: the mailbox it was forwarded from; else null. */
  forwardedBy: summaryAddrSpecSchema.nullable(),
});
export type CommitmentOrigin = z.infer<typeof commitmentOriginSchema>;

/** A summary's suggestions (prepared or stale). */
export const summaryCommitmentsSchema = z.object({
  key: commitmentKeySchema,
  mode: z.enum(COMMITMENT_MODES),
  preparedAt: isoDateTimeSchema,
  preselect: commitmentPreselectSchema,
  origin: commitmentOriginSchema,
  /** Only the first part of a long summary was read. */
  truncated: z.boolean(),
  /** Filed under another meeting since the suggestions were prepared. */
  meetingChanged: z.boolean(),
  /** In document order. */
  items: z.array(commitmentItemSchema).max(COMMITMENT_LIMITS.maxProposals),
});
export type SummaryCommitments = z.infer<typeof summaryCommitmentsSchema>;

/** The task as the user accepts it (the app checked the task invariants first, as the server does). */
export const commitmentDraftSchema = z
  .object({
    title: z.string().min(1).max(COMMITMENT_LIMITS.maxTitleChars),
    dueDate: localDateKeySchema.nullable(),
    dueTime: localTimeKeySchema.nullable(),
    reminderMinutesBefore: z.number().int().min(0).max(AI_TASK_LIMITS.maxReminderMinutes).nullable(),
    /** null: nobody; isUser true: the user (no people entry); else that person on the task. */
    owner: z.object({ name: z.string().min(1).max(COMMITMENT_LIMITS.maxOwnerChars), isUser: z.boolean() }).nullable(),
  })
  .refine((d) => d.dueTime === null || d.dueDate !== null, { message: 'dueTime needs a dueDate', path: ['dueTime'] })
  .refine((d) => d.reminderMinutesBefore === null || d.dueTime !== null, {
    message: 'a reminder needs a due time',
    path: ['reminderMinutesBefore'],
  });
export type CommitmentDraft = z.infer<typeof commitmentDraftSchema>;

export const commitmentDecisionSchema = z.discriminatedUnion('decision', [
  z.object({ anchorId: commitmentAnchorIdSchema, decision: z.literal('accept'), draft: commitmentDraftSchema }),
  z.object({ anchorId: commitmentAnchorIdSchema, decision: z.literal('drop') }),
  z.object({ anchorId: commitmentAnchorIdSchema, decision: z.literal('restore') }),
  z.object({ anchorId: commitmentAnchorIdSchema, decision: z.literal('remove') }),
]);
export type CommitmentDecision = z.infer<typeof commitmentDecisionSchema>;

export const summaryCommitmentsRequestSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('get'), summaryId: summaryIdSchema }),
  z.object({ op: z.literal('prepare'), summaryId: summaryIdSchema, mode: z.enum(COMMITMENT_MODES) }),
  z
    .object({
      op: z.literal('decide'),
      summaryId: summaryIdSchema,
      /** The extraction key the screen shows (stale when it is no longer current). */
      key: commitmentKeySchema,
      /** The device zone, for the tasks' zone and the reminders. */
      timezone: timeZoneSchema,
      /** The language of the task's origin line (EN fallback). */
      language: z.string().min(1).max(35),
      decisions: z.array(commitmentDecisionSchema).min(1).max(COMMITMENT_LIMITS.maxDecisionsPerCall),
    })
    .refine((request) => new Set(request.decisions.map((d) => d.anchorId)).size === request.decisions.length, {
      message: 'one decision per anchorId',
      path: ['decisions'],
    }),
]);
export type SummaryCommitmentsRequest = z.infer<typeof summaryCommitmentsRequestSchema>;

/** What one decision did. */
export const commitmentDecisionResultSchema = z.object({
  anchorId: commitmentAnchorIdSchema,
  outcome: z.enum(COMMITMENT_OUTCOMES),
  /** The task concerned (added, already added, removed or changed); else null. */
  taskId: meetingIdSchema.nullable(),
});
export type CommitmentDecisionResult = z.infer<typeof commitmentDecisionResultSchema>;

export const summaryCommitmentsResponseSchema = z.object({
  op: z.enum(['get', 'prepare', 'decide']),
  state: z.enum(COMMITMENT_STATES),
  /** ready, empty and stale: the suggestions (stale: the old decisions, read-only); none and preparing: null. */
  commitments: summaryCommitmentsSchema.nullable(),
  /** decide only, one per decision. */
  results: z.array(commitmentDecisionResultSchema).max(COMMITMENT_LIMITS.maxDecisionsPerCall).optional(),
  /** prepare in mode 'ai' when it was charged: the allowance after it. */
  usage: assistantUsageSchema.optional(),
});
export type SummaryCommitmentsResponse = z.infer<typeof summaryCommitmentsResponseSchema>;

/**
 * summaryCommitments error taxonomy: every SUMMARY_ERROR_CODES value plus quota_exceeded
 * (resource-exhausted; details.usage set, the app offers the items as written) and stale
 * (failed-precondition; decide named an old key, the app reloads). A separate list, so the
 * exhaustive M10 maps of SUMMARY_ERROR_CODES stay as they are.
 */
export const COMMITMENT_ERROR_CODES = [...SUMMARY_ERROR_CODES, 'quota_exceeded', 'stale'] as const;
export type CommitmentErrorCode = (typeof COMMITMENT_ERROR_CODES)[number];

export const COMMITMENT_ERROR_HTTPS_CODES = {
  ...SUMMARY_ERROR_HTTPS_CODES,
  quota_exceeded: 'resource-exhausted',
  stale: 'failed-precondition',
} as const satisfies Record<CommitmentErrorCode, string>;

/** `HttpsError.details` of every summaryCommitments error; usage only for quota_exceeded. */
export const commitmentErrorDetailsSchema = z.object({
  reason: z.enum(COMMITMENT_ERROR_CODES),
  usage: assistantUsageSchema.optional(),
});
export type CommitmentErrorDetails = z.infer<typeof commitmentErrorDetailsSchema>;
// Executive assistant matters (matter* callables; docs/v1/ARCHITECTURE.md section 36)
// ---------------------------------------------------------------------------------------------
//
// The user hands the assistant a matter in their own words (matterDraft); the server answers
// with a draft: the mandate in plain words (readBack), the first email it would send, and any
// missing details as questions. Answers go through matterRevise. Only a complete draft carries a
// draftHash; matterConfirm sends that exact hash back, so only the version the user saw can be
// confirmed, and only then is the first email sent. The matter documents themselves are read
// from Firestore (users/{uid}/matters, owner read). Deployed only while MATTERS_ENABLED is true.

export const MATTER_SOURCES = ['text', 'voice'] as const;
export const MATTER_LIMITS_CONTRACT = {
  requestChars: 2000,
  answerChars: 1000,
} as const;
export const MATTER_ID_PATTERN = /^[A-Za-z0-9]{1,64}$/;
export const DRAFT_HASH_PATTERN = /^[a-f0-9]{64}$/;
export const matterIdSchema = z.string().regex(MATTER_ID_PATTERN);

export const matterDraftRequestSchema = z
  .object({
    text: z.string().trim().min(1).max(MATTER_LIMITS_CONTRACT.requestChars),
    source: z.enum(MATTER_SOURCES),
    language: languageSchema,
    timeZone: timeZoneSchema,
  })
  .strict();
export type MatterDraftRequest = z.infer<typeof matterDraftRequestSchema>;

export const matterReviseRequestSchema = z
  .object({
    matterId: matterIdSchema,
    answer: z.string().trim().min(1).max(MATTER_LIMITS_CONTRACT.answerChars),
  })
  .strict();
export type MatterReviseRequest = z.infer<typeof matterReviseRequestSchema>;

/** The draft as the user sees it (matterDraft and matterRevise answer with it). */
export const matterDraftResponseSchema = z.object({
  matterId: matterIdSchema,
  status: z.enum(['draft', 'active', 'paused', 'done', 'cancelled']),
  title: z.string(),
  /** The mandate in plain words, in the user's language. */
  readBack: z.string(),
  /** Missing details; while any remain there is no draftHash and nothing can be confirmed. */
  questions: z.array(z.string()),
  /** The first email exactly as it would be sent; null until the draft is complete. */
  firstEmail: z
    .object({
      from: z.string(),
      to: z.array(z.string()),
      cc: z.array(z.string()),
      subject: z.string(),
      text: z.string(),
    })
    .nullable(),
  /** Present only when the draft is complete; matterConfirm sends it back. */
  draftHash: z.string().regex(DRAFT_HASH_PATTERN).nullable(),
});
export type MatterDraftResponse = z.infer<typeof matterDraftResponseSchema>;

export const matterConfirmRequestSchema = z
  .object({ matterId: matterIdSchema, draftHash: z.string().regex(DRAFT_HASH_PATTERN) })
  .strict();
export type MatterConfirmRequest = z.infer<typeof matterConfirmRequestSchema>;
/**
 * Where the first email stands after matterConfirm.
 * sent:    it went out.
 * failed:  the email service refused it, nothing went out; the same confirm retries it.
 * unknown: no clear answer (or another confirm is sending it right now): it may have gone out, so
 *          it is never sent again automatically. The user's copy (cc) shows whether it arrived.
 */
export const MATTER_SEND_OUTCOMES = ['sent', 'failed', 'unknown'] as const;
export type MatterSendOutcome = (typeof MATTER_SEND_OUTCOMES)[number];

export const matterConfirmResponseSchema = z.object({
  matterId: matterIdSchema,
  status: z.literal('active'),
  outcome: z.enum(MATTER_SEND_OUTCOMES),
});
export type MatterConfirmResponse = z.infer<typeof matterConfirmResponseSchema>;

export const matterCancelRequestSchema = z.object({ matterId: matterIdSchema }).strict();
export type MatterCancelRequest = z.infer<typeof matterCancelRequestSchema>;
export const matterCancelResponseSchema = z.object({ matterId: matterIdSchema, status: z.literal('cancelled') });
export type MatterCancelResponse = z.infer<typeof matterCancelResponseSchema>;

/** Error taxonomy of the matter* callables (details.reason). */
export const MATTER_ERROR_CODES = [
  'not_configured',
  'unauthenticated',
  'invalid_request',
  'not_found',
  /** matterConfirm: the hash is not the current complete draft (the screen is out of date). */
  'stale_draft',
  /** The send check refused (not active, past the end date, a recipient outside the mandate). */
  'not_allowed',
  'rate_limited',
  'upstream_error',
] as const;
export type MatterErrorCode = (typeof MATTER_ERROR_CODES)[number];

export const MATTER_ERROR_HTTPS_CODES = {
  not_configured: 'failed-precondition',
  unauthenticated: 'unauthenticated',
  invalid_request: 'invalid-argument',
  not_found: 'not-found',
  stale_draft: 'failed-precondition',
  not_allowed: 'permission-denied',
  rate_limited: 'resource-exhausted',
  upstream_error: 'unavailable',
} as const satisfies Record<MatterErrorCode, string>;

export const matterErrorDetailsSchema = z.object({ reason: z.enum(MATTER_ERROR_CODES) });
export type MatterErrorDetails = z.infer<typeof matterErrorDetailsSchema>;

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

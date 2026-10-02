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
 * (docs/ARCHITECTURE.md §16): the master is truncated and a NEW series carries the remaining
 * occurrences with the changes applied (update) or is simply never created (delete). Unlike
 * 'occurrence', a 'following' update accepts the full change surface (it edits a series master).
 * A v2 server never sends 'following'; a v2 client rejects the unknown enum value, so servers
 * only propose it to clients that sent a v3-capable request (same release train here).
 */
export const AI_CONTRACT_VERSION = 3;

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
} as const;
export type CallableName = (typeof CALLABLES)[keyof typeof CALLABLES];

/** Default region; the deployed functions and the app's EXPO_PUBLIC_FUNCTIONS_REGION must match. */
export const DEFAULT_CALLABLE_REGION = 'us-central1';

/** Client-side timeout for the assistant callable (the function itself times out at 60 s). */
export const ASSISTANT_CALL_TIMEOUT_MS = 70_000;

/** Client-side timeout for the zoom* callables (one Zoom REST call plus a token mint). */
export const ZOOM_CALL_TIMEOUT_MS = 20_000;

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
] as const;
export type AiActionType = (typeof AI_ACTION_TYPES)[number];

export const SHARE_CHANNELS = ['email', 'system_share'] as const;
export type ShareChannel = (typeof SHARE_CHANNELS)[number];

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

export const aiActionSchema = z.discriminatedUnion('type', [
  createMeetingActionSchema,
  updateMeetingActionSchema,
  deleteMeetingActionSchema,
  shareMeetingActionSchema,
  bulkUpdateActionSchema,
  listActionSchema,
]);
export type AiAction = z.infer<typeof aiActionSchema>;
export type CreateMeetingAction = z.infer<typeof createMeetingActionSchema>;
export type UpdateMeetingAction = z.infer<typeof updateMeetingActionSchema>;
export type DeleteMeetingAction = z.infer<typeof deleteMeetingActionSchema>;
export type ShareMeetingAction = z.infer<typeof shareMeetingActionSchema>;
export type BulkUpdateAction = z.infer<typeof bulkUpdateActionSchema>;
export type ListAction = z.infer<typeof listActionSchema>;

/** Actions that change data (everything except `list`). */
export function isMutatingAction(action: AiAction): boolean {
  return action.type !== 'list';
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
// Zoom auto links (zoom* callables; docs/ARCHITECTURE.md §24, docs/SETUP.md §12)
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
  /** v2: the repeat rule, so the assistant can describe series and propose scoped edits. */
  recurrence: recurrenceRuleSchema.nullable().catch(null),
});
export type AiMeetingContextDoc = z.infer<typeof aiMeetingContextDocSchema>;

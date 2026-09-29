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

export const AI_CONTRACT_VERSION = 1;

// ---------------------------------------------------------------------------------------------
// Callables
// ---------------------------------------------------------------------------------------------

/** Callable function names. The app calls them in the region from EXPO_PUBLIC_FUNCTIONS_REGION. */
export const CALLABLES = {
  assistant: 'assistant',
  deleteAccount: 'deleteAccount',
} as const;
export type CallableName = (typeof CALLABLES)[keyof typeof CALLABLES];

/** Default region; the deployed functions and the app's EXPO_PUBLIC_FUNCTIONS_REGION must match. */
export const DEFAULT_CALLABLE_REGION = 'us-central1';

/** Client-side timeout for the assistant callable (the function itself times out at 60 s). */
export const ASSISTANT_CALL_TIMEOUT_MS = 70_000;

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

export const updateMeetingActionSchema = z.object({
  type: z.literal('update_meeting'),
  ...actionBase,
  meetingId: meetingIdSchema,
  changes: aiMeetingChangesSchema,
});

export const deleteMeetingActionSchema = z.object({
  type: z.literal('delete_meeting'),
  ...actionBase,
  meetingId: meetingIdSchema,
});

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
});
export type AiMeetingContextDoc = z.infer<typeof aiMeetingContextDocSchema>;

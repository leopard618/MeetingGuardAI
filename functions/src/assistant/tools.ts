/**
 * Tool definitions (OpenAI function calling, strict mode) and the zod schemas that re-validate
 * the arguments server-side.
 *
 * Strict-mode rules followed here: every object lists all its properties in `required` and sets
 * `additionalProperties: false`; optional values are expressed as nullable. Value constraints
 * (lengths, ranges, formats) are NOT expressed in JSON Schema keywords (support varies by model);
 * they are described in text and enforced by zod + the shared contract schemas after the call.
 */
import { z } from 'zod';

import {
  CONFERENCE_PROVIDERS,
  LOCATION_TYPES,
  PENDING_RESOLUTIONS,
  RECURRENCE_EDIT_SCOPES,
  RECURRENCE_FREQS,
  RECURRENCE_WEEKDAYS,
  SHARE_CHANNELS,
  TASK_ACTION_STATUSES,
} from '../shared/aiContract';

type JsonSchema = Record<string, unknown>;

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    strict: true;
    parameters: JsonSchema;
  };
}

export const TOOL_NAMES = {
  create: 'create_meeting',
  update: 'update_meeting',
  delete: 'delete_meeting',
  share: 'share_meeting',
  bulk: 'bulk_update_meetings',
  list: 'list_meetings',
  suggest: 'suggest_replies',
  resolve: 'resolve_pending',
  // v5 (offered only to contractVersion >= 5 clients):
  createTask: 'create_task',
  updateTask: 'update_task',
  deleteTask: 'delete_task',
  listTasks: 'list_tasks',
} as const;
export type ToolName = (typeof TOOL_NAMES)[keyof typeof TOOL_NAMES];

// ---------------------------------------------------------------------------------------------
// JSON Schema helpers
// ---------------------------------------------------------------------------------------------

const string = (description: string): JsonSchema => ({ type: 'string', description });
const nullableString = (description: string): JsonSchema => ({ type: ['string', 'null'], description });
const integer = (description: string): JsonSchema => ({ type: 'integer', description });
const nullableInteger = (description: string): JsonSchema => ({ type: ['integer', 'null'], description });
const boolean = (description: string): JsonSchema => ({ type: 'boolean', description });
const nullableBoolean = (description: string): JsonSchema => ({ type: ['boolean', 'null'], description });
const array = (items: JsonSchema, description: string): JsonSchema => ({ type: 'array', items, description });
const nullableArray = (items: JsonSchema, description: string): JsonSchema => ({
  anyOf: [{ type: 'array', items }, { type: 'null' }],
  description,
});
const enumeration = (values: readonly string[], description: string): JsonSchema => ({
  type: 'string',
  enum: [...values],
  description,
});
const object = (properties: Record<string, JsonSchema>, description?: string): JsonSchema => ({
  type: 'object',
  ...(description ? { description } : {}),
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const nullable = (schema: JsonSchema, description: string): JsonSchema => ({
  anyOf: [schema, { type: 'null' }],
  description,
});

const SUMMARY = string('One short sentence in the reply language describing this proposal for the confirmation card (max 300 characters).');
const CONFIDENCE = integer('How sure you are that this is what the user wants, 0-100.');
const MEETING_REF = string('The `ref` of an existing meeting from the meetings data block. Never invent one.');
const DATE = 'Local date "YYYY-MM-DD" in the user time zone.';
const TIME = 'Local 24-hour time "HH:mm" in the user time zone.';

const locationSchema = object({
  type: enumeration(LOCATION_TYPES, 'physical, virtual or hybrid.'),
  address: nullableString('Street address or room, or null.'),
});
const conferenceSchema = object({
  provider: enumeration(CONFERENCE_PROVIDERS, 'Conference provider.'),
  url: nullableString('Join URL exactly as the user typed it, or null. Never invent links.'),
  password: nullableString('Passcode exactly as the user typed it, or null.'),
});
const participantSchema = object({
  email: string('Email address the user wrote (or an existing participant). Never invent addresses.'),
  name: nullableString('Display name, or null.'),
});
const alertTimes = (description: string): JsonSchema =>
  nullableArray({ type: 'integer' }, `${description} Minutes before the start (0 = at start, max 10080), at most 10 values.`);

/** Repeat rule (v1 subset shared with the app; see the recurrence rules in the system prompt). */
const recurrenceSchema = object({
  freq: enumeration(RECURRENCE_FREQS, 'How often the meeting repeats: daily, weekly or monthly.'),
  interval: nullableInteger('Repeat every N days/weeks/months (1-99). Null = 1.'),
  by_weekday: nullableArray(
    { type: 'string', enum: [...RECURRENCE_WEEKDAYS] },
    'Weekly only: the weekdays it repeats on (MO..SU). Null = the weekday of the first occurrence.',
  ),
  by_month_day: nullableInteger('Monthly only: the day of month 1-31. Null = the day of the first occurrence.'),
  until_date: nullableString(`Last possible day of the series (inclusive). ${DATE} Null if the user gave a count or no end.`),
  count: nullableInteger('Total number of occurrences including the first (1-730). Null if the user gave an end date or no end. Never set both until_date and count.'),
});
const SCOPE = enumeration(
  RECURRENCE_EDIT_SCOPES,
  'For a repeating meeting: "occurrence" changes/deletes only the one occurrence at occurrence_date; "following" changes/deletes that occurrence AND every later one (earlier occurrences stay); "series" applies to the whole series. Ask the user which one they mean when it is ambiguous.',
);
const nullableScope: JsonSchema = { anyOf: [SCOPE, { type: 'null' }], description: 'Null (or "series") for one-off meetings and whole-series changes.' };
const OCCURRENCE_DATE = nullableString(
  'With scope "occurrence" or "following": the ORIGINAL local date "YYYY-MM-DD" of that occurrence (from the meeting\'s repeats info), even when moving it to another day. For "following" it is the FIRST occurrence that changes. Null otherwise.',
);

function meetingChangesSchema(options: { includeSchedule: boolean; includeTextAndPeople: boolean }): JsonSchema {
  const properties: Record<string, JsonSchema> = {};
  if (options.includeTextAndPeople) {
    properties.title = nullableString('New title, or null to keep it.');
    properties.description = nullableString('New description, or null to keep it.');
  }
  if (options.includeSchedule) {
    properties.date = nullableString(`New ${DATE} Null keeps the current date.`);
    properties.time = nullableString(`New ${TIME} Null keeps the current time.`);
    properties.all_day = nullableBoolean('Set true/false to change whether it is an all-day meeting, or null.');
    properties.timezone = nullableString('New IANA time zone of the meeting, only if the user explicitly asks; otherwise null.');
    properties.recurrence = nullable(recurrenceSchema, 'New repeat rule, or null to keep the current one. With scope "series" it replaces the whole series\' rule; with scope "following" it applies from occurrence_date on. Never with scope "occurrence".');
    properties.clear_recurrence = boolean('true only if the user wants the meeting to stop repeating (it becomes a single meeting).');
  }
  properties.duration_minutes = nullableInteger('New duration in minutes, or null to keep it.');
  properties.location = nullable(locationSchema, 'New location, or null to keep it.');
  properties.clear_location = boolean('true only if the user wants the location removed.');
  properties.conference = nullable(conferenceSchema, 'New conference details, or null to keep them.');
  properties.clear_conference = boolean('true only if the user wants the conference details removed.');
  if (options.includeTextAndPeople) {
    properties.participants = nullableArray(
      participantSchema,
      'The COMPLETE new participant list (existing participants you keep + new ones), or null to keep it.',
    );
    properties.preparation_tips = nullableArray({ type: 'string' }, 'New preparation tips (max 10), or null.');
  }
  properties.alert_minutes_before = alertTimes('New alert times, or null to keep them.');
  properties.reset_alert_times = boolean("true only if the user wants the meeting to use their default alert times again.");
  return object(properties);
}

// ---------------------------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------------------------

export const ASSISTANT_TOOLS: readonly ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: TOOL_NAMES.create,
      description: 'Propose creating a new meeting. The user confirms it in the app before anything is saved.',
      strict: true,
      parameters: object({
        title: string('Meeting title (max 200 characters).'),
        description: string('Agenda or description, "" if none.'),
        date: string(DATE),
        time: nullableString(`${TIME} Null only for all-day meetings.`),
        all_day: boolean('true for an all-day meeting.'),
        duration_minutes: nullableInteger('Duration in minutes; null = 60 (all-day: 1440 per day).'),
        timezone: nullableString('IANA time zone of the meeting if the user explicitly names another zone; otherwise null (user time zone).'),
        location: nullable(locationSchema, 'Location, or null.'),
        conference: nullable(conferenceSchema, 'Video conference, or null.'),
        participants: array(participantSchema, 'Participants to invite (only addresses the user wrote), [] if none.'),
        preparation_tips: array({ type: 'string' }, 'Up to 3 short, specific preparation tips, [] if none.'),
        alert_minutes_before: alertTimes('Custom alert times only if the user asked for them; null = the user default.'),
        recurrence: nullable(recurrenceSchema, 'Repeat rule ("every Monday at 9" => weekly, by_weekday ["MO"]), or null for a one-off meeting.'),
        summary: SUMMARY,
        confidence: CONFIDENCE,
      }),
    },
  },
  {
    type: 'function',
    function: {
      name: TOOL_NAMES.update,
      description:
        'Propose changing one existing meeting. Only the fields in `changes` that are not null change. For a repeating meeting, scope "occurrence" (with occurrence_date) changes just that occurrence: then only date, time, duration_minutes and title may change. Scope "following" (with occurrence_date) changes that occurrence and every later one, with the full change surface.',
      strict: true,
      parameters: object({
        meeting_ref: MEETING_REF,
        changes: meetingChangesSchema({ includeSchedule: true, includeTextAndPeople: true }),
        scope: nullableScope,
        occurrence_date: OCCURRENCE_DATE,
        summary: SUMMARY,
        confidence: CONFIDENCE,
      }),
    },
  },
  {
    type: 'function',
    function: {
      name: TOOL_NAMES.delete,
      description:
        'Propose deleting one existing meeting (with scope "occurrence": cancelling a single occurrence of a repeating meeting; with scope "following": ending the series before occurrence_date so that occurrence and every later one disappear).',
      strict: true,
      parameters: object({
        meeting_ref: MEETING_REF,
        scope: nullableScope,
        occurrence_date: OCCURRENCE_DATE,
        summary: SUMMARY,
        confidence: CONFIDENCE,
      }),
    },
  },
  {
    type: 'function',
    function: {
      name: TOOL_NAMES.share,
      description:
        'Propose sharing a meeting (its details and join link) by email or through the phone share sheet. The app inserts the real link.',
      strict: true,
      parameters: object({
        meeting_ref: MEETING_REF,
        channel: enumeration(SHARE_CHANNELS, '"email" when the user gave recipient addresses, otherwise "system_share".'),
        recipients: array(string('Email address.'), 'Recipient addresses the user wrote ([] for system_share).'),
        message: nullableString('Short message to include, in the reply language, or null.'),
        summary: SUMMARY,
        confidence: CONFIDENCE,
      }),
    },
  },
  {
    type: 'function',
    function: {
      name: TOOL_NAMES.bulk,
      description:
        'Propose the same change to several existing meetings: move them all by shift_minutes and/or apply the same changes (not date/time).',
      strict: true,
      parameters: object({
        meeting_refs: array(string('Meeting ref.'), 'Refs of the meetings to change (max 100).'),
        shift_minutes: nullableInteger('Move every meeting by this many minutes (negative = earlier), or null.'),
        changes: nullable(
          meetingChangesSchema({ includeSchedule: false, includeTextAndPeople: false }),
          'Changes applied to every meeting, or null.',
        ),
        summary: SUMMARY,
        confidence: CONFIDENCE,
      }),
    },
  },
  {
    type: 'function',
    function: {
      name: TOOL_NAMES.list,
      description: 'Show the user a list of existing meetings (read-only), e.g. "what do I have tomorrow?".',
      strict: true,
      parameters: object({
        meeting_refs: array(string('Meeting ref.'), 'Refs of the matching meetings in chronological order ([] if none match).'),
        summary: SUMMARY,
        confidence: CONFIDENCE,
      }),
    },
  },
  {
    type: 'function',
    function: {
      name: TOOL_NAMES.suggest,
      description: 'Offer up to 3 short quick replies the user can tap to send to you next.',
      strict: true,
      parameters: object({
        suggestions: array(string('Quick reply from the user point of view, max 80 characters.'), '1 to 3 quick replies.'),
      }),
    },
  },
];

// ---------------------------------------------------------------------------------------------
// v5 task tools (offered only to contractVersion >= 5 clients; handler.ts composes the list)
// ---------------------------------------------------------------------------------------------

const TASK_REF = string('The `ref` of an existing task from the tasks data block (starts with "t"). Never invent one, and never use a meeting ref here.');
const DUE_DATE = nullableString(`Due day. ${DATE} Null for no due date.`);
const DUE_TIME = nullableString(`Due time on due_date. ${TIME} Null when only the day matters. Needs due_date.`);
const REMINDER = nullableInteger('Minutes before the due time to remind the user (0 = at the due time, max 10080). Needs due_time. Null for no reminder.');
const TASK_PEOPLE = array(
  object({
    name: string('Name of the person, as the user said it.'),
    email: nullableString('Email address ONLY if the user typed it; otherwise null. Never invent addresses.'),
  }),
  'People this task involves, [] if none.',
);
const TASK_MEETING_REF = nullableString('The `ref` of a meeting from the meetings data block this task belongs to ("prepare before the kickoff"), or null.');

export const TASK_TOOLS: readonly ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: TOOL_NAMES.createTask,
      description: 'Propose creating a new task. Only a title is required. The user confirms it in the app before anything is saved.',
      strict: true,
      parameters: object({
        title: string('Task title (max 200 characters).'),
        description: string('Details, "" if none.'),
        due_date: DUE_DATE,
        due_time: DUE_TIME,
        reminder_minutes_before: REMINDER,
        meeting_ref: TASK_MEETING_REF,
        people: TASK_PEOPLE,
        summary: SUMMARY,
        confidence: CONFIDENCE,
      }),
    },
  },
  {
    type: 'function',
    function: {
      name: TOOL_NAMES.updateTask,
      description:
        'Propose changing one existing task: edit fields, postpone (new due_date/due_time), complete (status "done") or reopen (status "open"). Only non-null fields change; the clear_* flags remove values.',
      strict: true,
      parameters: object({
        task_ref: TASK_REF,
        changes: object({
          title: nullableString('New title, or null to keep it.'),
          description: nullableString('New details, or null to keep them.'),
          due_date: nullableString(`New due day (${DATE}), or null to keep it.`),
          due_time: nullableString(`New due time (${TIME}), or null to keep it.`),
          clear_due: boolean('true only if the user wants NO due date any more (also clears the time and the reminder).'),
          reminder_minutes_before: nullableInteger('New reminder (minutes before the due time, 0-10080), or null to keep it.'),
          clear_reminder: boolean('true only if the user wants the reminder removed.'),
          status: nullable(enumeration(TASK_ACTION_STATUSES, '"done" completes the task, "open" reopens it.'), 'New status, or null to keep it.'),
          meeting_ref: nullableString('Link the task to this meeting ref, or null to keep the current link.'),
          clear_meeting: boolean('true only if the user wants the meeting link removed.'),
          people: nullableArray(
            object({
              name: string('Name of the person.'),
              email: nullableString('Email ONLY if the user typed it; otherwise null.'),
            }),
            'The COMPLETE new people list, or null to keep it.',
          ),
        }),
        summary: SUMMARY,
        confidence: CONFIDENCE,
      }),
    },
  },
  {
    type: 'function',
    function: {
      name: TOOL_NAMES.deleteTask,
      description: 'Propose deleting one existing task (gone everywhere; completing is update_task with status "done" instead).',
      strict: true,
      parameters: object({
        task_ref: TASK_REF,
        summary: SUMMARY,
        confidence: CONFIDENCE,
      }),
    },
  },
  {
    type: 'function',
    function: {
      name: TOOL_NAMES.listTasks,
      description: 'Show the user a list of existing tasks (read-only), e.g. "what is overdue?" or "my tasks for today".',
      strict: true,
      parameters: object({
        task_refs: array(string('Task ref.'), 'Refs of the matching tasks in a sensible order ([] if none match).'),
        summary: SUMMARY,
        confidence: CONFIDENCE,
      }),
    },
  },
];

/**
 * v4: offered IN ADDITION to ASSISTANT_TOOLS, and only when the request carries pendingActions
 * (the model must never see it otherwise - handler.ts composes the tool list per request).
 */
export const RESOLVE_PENDING_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: TOOL_NAMES.resolve,
    description:
      'The pendingProposals in the data block are proposals you already made that the user has NOT confirmed yet; the app shows them as confirmation cards. Call this when the user\'s latest message is purely consent to ALL of them (decision "confirm") or purely refusal (decision "reject"). Never call it when the message changes any detail: propose the changed version with the normal tools instead.',
    strict: true,
    parameters: object({
      decision: enumeration(PENDING_RESOLUTIONS, '"confirm" executes the pending proposals after this response; "reject" dismisses them.'),
    }),
  },
};

// ---------------------------------------------------------------------------------------------
// Server-side argument schemas (shape only; value limits are applied when building actions)
// ---------------------------------------------------------------------------------------------

const locationArgs = z.object({ type: z.enum(LOCATION_TYPES), address: z.string().nullable() });
const conferenceArgs = z.object({
  provider: z.enum(CONFERENCE_PROVIDERS),
  url: z.string().nullable(),
  password: z.string().nullable(),
});
const participantArgs = z.object({ email: z.string(), name: z.string().nullable() });
const summaryArgs = { summary: z.string(), confidence: z.number() };

/**
 * Shape only; values are range-checked against recurrenceRuleSchema when building the action.
 * The nested fields default to null so a model that omits an optional-feeling key (despite strict
 * mode) degrades to "not set" instead of dropping the whole call.
 */
export const recurrenceArgsSchema = z.object({
  freq: z.enum(RECURRENCE_FREQS),
  interval: z.number().int().nullable().default(null),
  by_weekday: z.array(z.enum(RECURRENCE_WEEKDAYS)).nullable().default(null),
  by_month_day: z.number().int().nullable().default(null),
  until_date: z.string().nullable().default(null),
  count: z.number().int().nullable().default(null),
});
export type RecurrenceArgs = z.infer<typeof recurrenceArgsSchema>;

/** v2 additive: absent = null/"series", so v1-shaped calls keep parsing. */
const scopeArgs = {
  scope: z.enum(RECURRENCE_EDIT_SCOPES).nullable().default(null),
  occurrence_date: z.string().nullable().default(null),
};

export const createMeetingArgsSchema = z.object({
  title: z.string(),
  description: z.string(),
  date: z.string(),
  time: z.string().nullable(),
  all_day: z.boolean(),
  duration_minutes: z.number().int().nullable(),
  timezone: z.string().nullable(),
  location: locationArgs.nullable(),
  conference: conferenceArgs.nullable(),
  participants: z.array(participantArgs),
  preparation_tips: z.array(z.string()),
  alert_minutes_before: z.array(z.number().int()).nullable(),
  recurrence: recurrenceArgsSchema.nullable().default(null),
  ...summaryArgs,
});
export type CreateMeetingArgs = z.infer<typeof createMeetingArgsSchema>;

const commonChangeArgs = {
  duration_minutes: z.number().int().nullable(),
  location: locationArgs.nullable(),
  clear_location: z.boolean(),
  conference: conferenceArgs.nullable(),
  clear_conference: z.boolean(),
  alert_minutes_before: z.array(z.number().int()).nullable(),
  reset_alert_times: z.boolean(),
};

export const updateChangesArgsSchema = z.object({
  title: z.string().nullable(),
  description: z.string().nullable(),
  date: z.string().nullable(),
  time: z.string().nullable(),
  all_day: z.boolean().nullable(),
  timezone: z.string().nullable(),
  recurrence: recurrenceArgsSchema.nullable().default(null),
  clear_recurrence: z.boolean().default(false),
  participants: z.array(participantArgs).nullable(),
  preparation_tips: z.array(z.string()).nullable(),
  ...commonChangeArgs,
});
export type UpdateChangesArgs = z.infer<typeof updateChangesArgsSchema>;

export const bulkChangesArgsSchema = z.object(commonChangeArgs);
export type BulkChangesArgs = z.infer<typeof bulkChangesArgsSchema>;

export const updateMeetingArgsSchema = z.object({
  meeting_ref: z.string(),
  changes: updateChangesArgsSchema,
  ...scopeArgs,
  ...summaryArgs,
});

export const deleteMeetingArgsSchema = z.object({ meeting_ref: z.string(), ...scopeArgs, ...summaryArgs });

export const shareMeetingArgsSchema = z.object({
  meeting_ref: z.string(),
  channel: z.enum(SHARE_CHANNELS),
  recipients: z.array(z.string()),
  message: z.string().nullable(),
  ...summaryArgs,
});

export const bulkUpdateArgsSchema = z.object({
  meeting_refs: z.array(z.string()),
  shift_minutes: z.number().int().nullable(),
  changes: bulkChangesArgsSchema.nullable(),
  ...summaryArgs,
});

export const listMeetingsArgsSchema = z.object({ meeting_refs: z.array(z.string()), ...summaryArgs });

export const suggestRepliesArgsSchema = z.object({ suggestions: z.array(z.string()) });

export const resolvePendingArgsSchema = z.object({ decision: z.enum(PENDING_RESOLUTIONS) });

const taskPersonArgs = z.object({ name: z.string(), email: z.string().nullable().default(null) });

export const createTaskArgsSchema = z.object({
  title: z.string(),
  description: z.string().default(''),
  due_date: z.string().nullable().default(null),
  due_time: z.string().nullable().default(null),
  reminder_minutes_before: z.number().int().nullable().default(null),
  meeting_ref: z.string().nullable().default(null),
  people: z.array(taskPersonArgs).default([]),
  ...summaryArgs,
});
export type CreateTaskArgs = z.infer<typeof createTaskArgsSchema>;

export const taskChangesArgsSchema = z.object({
  title: z.string().nullable().default(null),
  description: z.string().nullable().default(null),
  due_date: z.string().nullable().default(null),
  due_time: z.string().nullable().default(null),
  clear_due: z.boolean().default(false),
  reminder_minutes_before: z.number().int().nullable().default(null),
  clear_reminder: z.boolean().default(false),
  status: z.enum(TASK_ACTION_STATUSES).nullable().default(null),
  meeting_ref: z.string().nullable().default(null),
  clear_meeting: z.boolean().default(false),
  people: z.array(taskPersonArgs).nullable().default(null),
});
export type TaskChangesArgs = z.infer<typeof taskChangesArgsSchema>;

export const updateTaskArgsSchema = z.object({
  task_ref: z.string(),
  changes: taskChangesArgsSchema,
  ...summaryArgs,
});

export const deleteTaskArgsSchema = z.object({ task_ref: z.string(), ...summaryArgs });

export const listTasksArgsSchema = z.object({ task_refs: z.array(z.string()), ...summaryArgs });

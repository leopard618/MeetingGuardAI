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

import { CONFERENCE_PROVIDERS, LOCATION_TYPES, SHARE_CHANNELS } from '../shared/aiContract';

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
        summary: SUMMARY,
        confidence: CONFIDENCE,
      }),
    },
  },
  {
    type: 'function',
    function: {
      name: TOOL_NAMES.update,
      description: 'Propose changing one existing meeting. Only the fields in `changes` that are not null change.',
      strict: true,
      parameters: object({
        meeting_ref: MEETING_REF,
        changes: meetingChangesSchema({ includeSchedule: true, includeTextAndPeople: true }),
        summary: SUMMARY,
        confidence: CONFIDENCE,
      }),
    },
  },
  {
    type: 'function',
    function: {
      name: TOOL_NAMES.delete,
      description: 'Propose deleting one existing meeting.',
      strict: true,
      parameters: object({ meeting_ref: MEETING_REF, summary: SUMMARY, confidence: CONFIDENCE }),
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
  ...summaryArgs,
});

export const deleteMeetingArgsSchema = z.object({ meeting_ref: z.string(), ...summaryArgs });

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

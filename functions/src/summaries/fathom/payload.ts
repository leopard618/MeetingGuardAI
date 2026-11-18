/**
 * The new-meeting-content-ready payload (developers.fathom.ai openapi.yaml, Meeting schema,
 * checked 2026-11-17) and the recap text built from it. PURE.
 *
 * Only the fields the integration reads are validated; everything else is ignored (looseObject).
 * The recap text has the shape sections.ts parses: the meeting title first, the conference link,
 * then Fathom's markdown summary (headings kept, links reduced to their label, inline bold
 * removed), then an Action items section from action_items with "(owner: Name)".
 *
 * Product text rule: ASCII punctuation only in this file.
 */
import { z } from 'zod';

const isoTime = z.string().max(64).nullable().optional();

export const fathomMeetingSchema = z.looseObject({
  recording_id: z.union([z.number().int().nonnegative(), z.string().regex(/^[0-9]{1,20}$/)]),
  title: z.string().max(1000).nullable().optional(),
  meeting_title: z.string().max(1000).nullable().optional(),
  url: z.string().max(2048).nullable().optional(),
  share_url: z.string().max(2048).nullable().optional(),
  meeting_url: z.string().max(2048).nullable().optional(),
  scheduled_start_time: isoTime,
  scheduled_end_time: isoTime,
  recording_start_time: isoTime,
  recording_end_time: isoTime,
  created_at: isoTime,
  transcript_language: z.string().max(35).nullable().optional(),
  default_summary: z
    .looseObject({ markdown_formatted: z.string().max(400_000).nullable().optional() })
    .nullable()
    .optional(),
  action_items: z
    .array(
      z.looseObject({
        description: z.string().max(4000).nullable().optional(),
        completed: z.boolean().nullable().optional(),
        assignee: z
          .looseObject({ name: z.string().max(200).nullable().optional(), email: z.string().max(320).nullable().optional() })
          .nullable()
          .optional(),
      }),
    )
    .max(500)
    .nullable()
    .optional(),
});
export type FathomMeeting = z.infer<typeof fathomMeetingSchema>;

/** The recording id as a decimal string. */
export function recordingIdOf(meeting: FathomMeeting): string {
  return String(meeting.recording_id);
}

/** An ISO time as a Date, or null. */
export function timeOf(value: string | null | undefined): Date | null {
  if (typeof value !== 'string') return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms) : null;
}

/** The meeting's title: the calendar title when there is one, else Fathom's. */
export function meetingTitleOf(meeting: FathomMeeting): string | null {
  for (const value of [meeting.meeting_title, meeting.title]) {
    const trimmed = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
    if (trimmed.length > 0) return trimmed;
  }
  return null;
}

/**
 * When the summary counts as written: the recording's end (the same moment Fathom sends its recap
 * email), else the scheduled end, else when the record was created. Null when none parses.
 */
export function anchorOf(meeting: FathomMeeting): Date | null {
  return timeOf(meeting.recording_end_time) ?? timeOf(meeting.scheduled_end_time) ?? timeOf(meeting.created_at);
}

const TIMESTAMP_LABEL = /^\(?\d{1,2}:\d{2}(?::\d{2})?\)?$/;

/** One markdown line, simplified for the stored text. */
function cleanLine(line: string): string {
  let out = line.replace(/\r/g, '');
  // [label](url): keep the label; a bare timestamp label ("0:35") goes away with its link.
  out = out.replace(/\[([^\]\n]{0,300})\]\((?:[^()\s]|\([^()\s]*\))*\)/g, (_whole, label: string) =>
    TIMESTAMP_LABEL.test(label.trim()) ? '' : label,
  );
  const trimmed = out.trim();
  // A line that is only a bold or italic label stays marked: sections.ts reads it as a heading.
  const wholeMarked = /^(\*\*|__)[^*_]+\1:?$/.test(trimmed);
  if (!wholeMarked) out = out.replace(/(\*\*|__)(.+?)\1/g, '$2');
  return out.replace(/[ \t]+$/g, '');
}

function cleanMarkdown(markdown: string): string {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n').map(cleanLine);
  // Collapse runs of blank lines to one.
  const out: string[] = [];
  for (const line of lines) {
    if (line.trim().length === 0 && (out.length === 0 || out[out.length - 1]!.trim().length === 0)) continue;
    out.push(line);
  }
  while (out.length > 0 && out[out.length - 1]!.trim().length === 0) out.pop();
  return out.join('\n');
}

function actionItemLines(meeting: FathomMeeting): string[] {
  const lines: string[] = [];
  for (const item of meeting.action_items ?? []) {
    const text = typeof item.description === 'string' ? item.description.replace(/\s+/g, ' ').trim() : '';
    if (text.length === 0) continue;
    const owner = typeof item.assignee?.name === 'string' ? item.assignee.name.replace(/\s+/g, ' ').trim() : '';
    lines.push(`- ${text}${owner.length > 0 ? ` (owner: ${owner})` : ''}`);
  }
  return lines;
}

/** Whether the payload carries anything to store (a summary or at least one action item). */
export function hasContent(meeting: FathomMeeting): boolean {
  const summary = meeting.default_summary?.markdown_formatted;
  return (typeof summary === 'string' && summary.trim().length > 0) || actionItemLines(meeting).length > 0;
}

/** The recap text (before sanitizeText). */
export function recapTextOf(meeting: FathomMeeting): string {
  const parts: string[] = [];
  const title = meetingTitleOf(meeting);
  if (title !== null) parts.push(title);
  const link = typeof meeting.meeting_url === 'string' && /^https:\/\//i.test(meeting.meeting_url.trim()) ? meeting.meeting_url.trim() : null;
  if (link !== null) parts.push(`Meeting link: ${link}`);
  const summary = meeting.default_summary?.markdown_formatted;
  if (typeof summary === 'string' && summary.trim().length > 0) {
    parts.push('');
    parts.push(cleanMarkdown(summary));
  }
  const items = actionItemLines(meeting);
  if (items.length > 0) {
    parts.push('');
    parts.push('## Action Items');
    parts.push(...items);
  }
  return parts.join('\n');
}

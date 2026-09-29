/**
 * Pure mapping between assistant proposals (aiContract) and the domain model (core/types).
 * Every write still goes through the data layer's builders (buildMeeting / applyMeetingPatch),
 * which validate again.
 */
import type { AiMeetingChanges, AiMeetingDraft, AiParticipant, ConferenceDetails } from '../../core/aiContract';
import { addMinutesIso, endIso, toLocalDateTime } from '../../core/time';
import type { Meeting, MeetingCreateInput, MeetingPatch, ParticipantInput } from '../../core/types';

const MINUTES_PER_DAY = 1440;

function participantsInput(list: readonly AiParticipant[], current?: Meeting | null): ParticipantInput[] {
  const statusByEmail = new Map((current?.participants ?? []).map((p) => [p.email.toLowerCase(), p.status]));
  return list.map((p) => ({
    email: p.email,
    name: p.name,
    status: statusByEmail.get(p.email.toLowerCase()) ?? null,
  }));
}

/** create_meeting draft -> MeetingCreateInput (source 'ai_chat', confidence from the action). */
export function draftToCreateInput(draft: AiMeetingDraft, confidence: number): MeetingCreateInput {
  return {
    title: draft.title,
    description: draft.description,
    startAt: draft.startAt,
    durationMinutes: draft.durationMinutes,
    timezone: draft.timezone,
    allDay: draft.allDay,
    location: draft.location,
    conference: draft.conference,
    participants: participantsInput(draft.participants),
    preparationTips: draft.preparationTips,
    customAlertTimes: draft.customAlertTimes,
    language: draft.language,
    source: 'ai_chat',
    confidence,
  };
}

/**
 * update_meeting / bulk_update changes -> MeetingPatch. Absent keys stay unchanged; participant
 * response statuses already known for an email are kept.
 */
export function changesToPatch(changes: AiMeetingChanges, current?: Meeting | null): MeetingPatch {
  const patch: MeetingPatch = {};
  if (changes.title !== undefined) patch.title = changes.title;
  if (changes.description !== undefined) patch.description = changes.description;
  if (changes.startAt !== undefined) patch.startAt = changes.startAt;
  if (changes.durationMinutes !== undefined) patch.durationMinutes = changes.durationMinutes;
  if (changes.timezone !== undefined) patch.timezone = changes.timezone;
  if (changes.allDay !== undefined) patch.allDay = changes.allDay;
  if (changes.location !== undefined) patch.location = changes.location;
  if (changes.conference !== undefined) patch.conference = changes.conference;
  if (changes.participants !== undefined) patch.participants = participantsInput(changes.participants, current);
  if (changes.preparationTips !== undefined) patch.preparationTips = changes.preparationTips;
  if (changes.customAlertTimes !== undefined) patch.customAlertTimes = changes.customAlertTimes;
  if (changes.language !== undefined) patch.language = changes.language;
  return patch;
}

/** A Google Meet conference without a URL means "create a real Meet link when executing". */
export function wantsMeetLink(conference: ConferenceDetails | null | undefined): boolean {
  return conference !== null && conference !== undefined && conference.provider === 'google_meet' && conference.url === null;
}

/** New start of a meeting moved by `shiftMinutes`; null when an all-day meeting would stop starting at midnight. */
export function shiftedStartAt(meeting: Pick<Meeting, 'startAt' | 'allDay'>, shiftMinutes: number): string | null {
  if (meeting.allDay && shiftMinutes % MINUTES_PER_DAY !== 0) return null;
  return addMinutesIso(meeting.startAt, shiftMinutes);
}

export interface TimeWindow {
  startAt: string;
  durationMinutes: number;
  allDay: boolean;
}

/** The meeting's time window after applying `changes` (for overlap / past checks). */
export function windowAfterChanges(meeting: Meeting, changes: AiMeetingChanges | null): TimeWindow {
  return {
    startAt: changes?.startAt !== undefined ? new Date(changes.startAt).toISOString() : meeting.startAt,
    durationMinutes: changes?.durationMinutes ?? meeting.durationMinutes,
    allDay: changes?.allDay ?? meeting.allDay,
  };
}

export function windowOfDraft(draft: AiMeetingDraft): TimeWindow {
  return { startAt: new Date(draft.startAt).toISOString(), durationMinutes: draft.durationMinutes, allDay: draft.allDay };
}

function windowBounds(window: TimeWindow): [number, number] {
  const start = new Date(window.startAt).getTime();
  return [start, new Date(endIso(window)).getTime()];
}

/** true when the window already ended / started before `now` (all-day: when it already ended). */
export function isInPast(window: TimeWindow, now: Date): boolean {
  const [start, end] = windowBounds(window);
  return window.allDay ? end <= now.getTime() : start < now.getTime();
}

/**
 * Active, scheduled, timed meetings that overlap `window` (all-day meetings never count as
 * conflicts). `excludeIds` = the meetings being changed.
 */
export function findOverlaps(window: TimeWindow, meetings: readonly Meeting[], excludeIds: readonly string[] = []): Meeting[] {
  if (window.allDay) return [];
  const [start, end] = windowBounds(window);
  const excluded = new Set(excludeIds);
  return meetings.filter((m) => {
    if (excluded.has(m.id) || m.deletedAt !== null || m.status !== 'scheduled' || m.allDay) return false;
    const [otherStart, otherEnd] = windowBounds(m);
    return otherStart < end && start < otherEnd;
  });
}

/** Local calendar date of a draft (needed to format all-day drafts). */
export function draftLocalDate(draft: Pick<AiMeetingDraft, 'startAt' | 'timezone'>): string {
  return toLocalDateTime(new Date(draft.startAt).toISOString(), draft.timezone).date;
}

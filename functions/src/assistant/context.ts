/**
 * The user's meetings as assistant context.
 *
 * - Loaded server-side from users/{uid}/meetings (single-field range on `startAt`, so no
 *   composite index), tombstones dropped in code, at most CONTEXT_WINDOW.maxMeetings kept
 *   (closest to now first).
 * - Each meeting gets a short, stable reference ("m" + 7 base32 chars of sha256(id)). The model
 *   only ever sees refs; real ids never leave the server, and refs that are not in this context
 *   are rejected when mapping tool calls (so the model cannot target other documents).
 * - The model view is minimal: no conference URLs or passwords, no notes, no descriptions
 *   (except the follow-up meeting), at most 10 participant emails.
 */
import { createHash } from 'node:crypto';

import type { Firestore } from 'firebase-admin/firestore';

import { CONTEXT_WINDOW } from '../config';
import { aiMeetingContextDocSchema, type AiMeetingContextDoc } from '../shared/aiContract';
import { isValidTimeZone, parseInstant, toLocalDate, toLocalTime, WEEKDAY_NAMES, getZonedParts } from './time';

export interface MeetingRecord {
  id: string;
  doc: AiMeetingContextDoc;
}

export interface MeetingReader {
  /** Meetings with startAt in [fromIso, toIso] (tombstones included; the caller filters). */
  listByStartRange(uid: string, fromIso: string, toIso: string, limit: number): Promise<MeetingRecord[]>;
  get(uid: string, meetingId: string): Promise<MeetingRecord | null>;
}

export interface ContextMeeting {
  ref: string;
  meetingId: string;
  start: Date;
  doc: AiMeetingContextDoc;
  /** Lower-cased participant emails (all of them; used to accept emails the model repeats). */
  participantEmails: string[];
}

export interface MeetingContext {
  meetings: ContextMeeting[];
  byRef: Map<string, ContextMeeting>;
  followUp: ContextMeeting | null;
  /** Documents skipped because they were malformed. */
  skippedInvalid: number;
}

const DAY_MS = 86_400_000;
const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';

function base32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  if (bits > 0) output += BASE32[(value << (5 - bits)) & 31];
  return output;
}

/** Short refs for meeting ids: deterministic, unique within the set (grows on collision). */
export function assignRefs(meetingIds: readonly string[]): Map<string, string> {
  const digests = new Map(meetingIds.map((id) => [id, base32(createHash('sha256').update(id).digest())]));
  for (let length = 7; length <= 52; length += 3) {
    const refs = new Map<string, string>();
    const seen = new Set<string>();
    let collision = false;
    for (const [id, digest] of digests) {
      const ref = `m${digest.slice(0, length)}`;
      if (seen.has(ref)) {
        collision = true;
        break;
      }
      seen.add(ref);
      refs.set(id, ref);
    }
    if (!collision) return refs;
  }
  // Unreachable in practice (52 base32 chars = 260 bits); fall back to positional refs.
  return new Map(meetingIds.map((id, index) => [id, `m${index + 1}`]));
}

export function isVisibleMeeting(doc: AiMeetingContextDoc): boolean {
  return doc.deletedAt === null;
}

/**
 * Builds the context from raw records: drops tombstones and unparsable starts, keeps the
 * `maxMeetings` closest to `now`, sorts by start, assigns refs. The follow-up meeting is always
 * kept (it is added by the caller when it falls outside the window).
 */
export function buildMeetingContext(
  records: readonly MeetingRecord[],
  now: Date,
  options: { followUpMeetingId: string | null; maxMeetings?: number; skippedInvalid?: number },
): MeetingContext {
  const maxMeetings = options.maxMeetings ?? CONTEXT_WINDOW.maxMeetings;
  const unique = new Map<string, { record: MeetingRecord; start: Date }>();
  let skippedInvalid = options.skippedInvalid ?? 0;
  for (const record of records) {
    if (!isVisibleMeeting(record.doc) || unique.has(record.id)) continue;
    const start = parseInstant(record.doc.startAt);
    if (!start) {
      skippedInvalid += 1;
      continue;
    }
    unique.set(record.id, { record, start });
  }

  const followUpId = options.followUpMeetingId;
  const nowMs = now.getTime();
  const ranked = [...unique.values()].sort((a, b) => {
    if (a.record.id === followUpId) return -1;
    if (b.record.id === followUpId) return 1;
    return Math.abs(a.start.getTime() - nowMs) - Math.abs(b.start.getTime() - nowMs);
  });
  const kept = ranked
    .slice(0, maxMeetings)
    .sort((a, b) => a.start.getTime() - b.start.getTime() || a.record.id.localeCompare(b.record.id));

  const refs = assignRefs(kept.map((item) => item.record.id));
  const meetings: ContextMeeting[] = kept.map(({ record, start }) => ({
    ref: refs.get(record.id) ?? record.id,
    meetingId: record.id,
    start,
    doc: record.doc,
    participantEmails: record.doc.participants.map((participant) => participant.email.trim().toLowerCase()),
  }));
  const byRef = new Map(meetings.map((meeting) => [meeting.ref, meeting]));
  const followUp = followUpId ? (meetings.find((meeting) => meeting.meetingId === followUpId) ?? null) : null;
  return { meetings, byRef, followUp, skippedInvalid };
}

export class FollowUpMeetingNotFoundError extends Error {
  constructor() {
    super('Follow-up meeting not found');
    this.name = 'FollowUpMeetingNotFoundError';
  }
}

/** Loads the window [-7 d, +60 d] (+ the follow-up meeting) and builds the context. */
export async function loadMeetingContext(
  reader: MeetingReader,
  uid: string,
  now: Date,
  followUpMeetingId: string | null,
): Promise<MeetingContext> {
  const fromIso = new Date(now.getTime() - CONTEXT_WINDOW.pastDays * DAY_MS).toISOString();
  const toIso = new Date(now.getTime() + CONTEXT_WINDOW.futureDays * DAY_MS).toISOString();
  const [records, followUpRecord] = await Promise.all([
    reader.listByStartRange(uid, fromIso, toIso, CONTEXT_WINDOW.queryLimit),
    followUpMeetingId ? reader.get(uid, followUpMeetingId) : Promise.resolve(null),
  ]);
  if (followUpMeetingId && (!followUpRecord || !isVisibleMeeting(followUpRecord.doc))) {
    throw new FollowUpMeetingNotFoundError();
  }
  const all = followUpRecord ? [followUpRecord, ...records] : records;
  const context = buildMeetingContext(all, now, { followUpMeetingId });
  if (followUpMeetingId && !context.followUp) throw new FollowUpMeetingNotFoundError();
  return context;
}

// ---------------------------------------------------------------------------------------------
// Model view
// ---------------------------------------------------------------------------------------------

export interface MeetingModelView {
  ref: string;
  title: string;
  /** Local "YYYY-MM-DD HH:mm" in the user's zone (all-day: "YYYY-MM-DD" in the meeting's zone). */
  start: string;
  weekday: string;
  durationMinutes: number;
  allDay: boolean;
  status: string;
  source: string;
  /** Present only when it differs from the user's zone. */
  meetingTimeZone?: string;
  location: { type: string; address: string | null } | null;
  conference: { provider: string; hasLink: boolean } | null;
  participants: string[];
  participantsTotal: number;
  /** Only for the follow-up meeting. */
  description?: string;
}

function clip(value: string, max: number): string {
  const trimmed = value.replace(/\s+/g, ' ').trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

export function toModelView(meeting: ContextMeeting, userTimeZone: string, isFollowUp: boolean): MeetingModelView {
  const { doc } = meeting;
  const meetingZone = isValidTimeZone(doc.timezone) ? doc.timezone : userTimeZone;
  const displayZone = doc.allDay ? meetingZone : userTimeZone;
  const date = toLocalDate(meeting.start, displayZone);
  const view: MeetingModelView = {
    ref: meeting.ref,
    title: clip(doc.title, CONTEXT_WINDOW.maxTitleChars),
    start: doc.allDay ? date : `${date} ${toLocalTime(meeting.start, displayZone)}`,
    weekday: WEEKDAY_NAMES[getZonedParts(meeting.start, displayZone).weekday] ?? '',
    durationMinutes: doc.durationMinutes,
    allDay: doc.allDay,
    status: doc.status,
    source: doc.source,
    location: doc.location
      ? {
          type: doc.location.type,
          address: doc.location.address ? clip(doc.location.address, CONTEXT_WINDOW.maxAddressChars) : null,
        }
      : null,
    conference: doc.conference ? { provider: doc.conference.provider, hasLink: doc.conference.url !== null } : null,
    participants: meeting.participantEmails.slice(0, CONTEXT_WINDOW.maxParticipantsListed),
    participantsTotal: meeting.participantEmails.length,
  };
  if (meetingZone !== userTimeZone) view.meetingTimeZone = meetingZone;
  if (isFollowUp && doc.description.trim().length > 0) {
    view.description = clip(doc.description, CONTEXT_WINDOW.maxFollowUpDescriptionChars);
  }
  return view;
}

// ---------------------------------------------------------------------------------------------
// Firestore reader
// ---------------------------------------------------------------------------------------------

export function firestoreMeetingReader(db: Firestore, onInvalid: (count: number) => void = () => undefined): MeetingReader {
  const parse = (id: string, data: unknown): MeetingRecord | null => {
    const parsed = aiMeetingContextDocSchema.safeParse(data);
    return parsed.success ? { id, doc: parsed.data } : null;
  };
  return {
    async listByStartRange(uid, fromIso, toIso, limit) {
      const snapshot = await db
        .collection(`users/${uid}/meetings`)
        .where('startAt', '>=', fromIso)
        .where('startAt', '<=', toIso)
        .orderBy('startAt')
        .limit(limit)
        .get();
      const records: MeetingRecord[] = [];
      let invalid = 0;
      for (const doc of snapshot.docs) {
        const record = parse(doc.id, doc.data());
        if (record) records.push(record);
        else invalid += 1;
      }
      if (invalid > 0) onInvalid(invalid);
      return records;
    },
    async get(uid, meetingId) {
      const snapshot = await db.doc(`users/${uid}/meetings/${meetingId}`).get();
      return snapshot.exists ? parse(snapshot.id, snapshot.data()) : null;
    },
  };
}

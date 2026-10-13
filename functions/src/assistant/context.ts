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
 *   (except the follow-up meeting), at most 10 participants (email + name, so "the meeting with
 *   Alejandro" can be resolved).
 * - Loading is bounded: only the fields the model view needs are read (field mask), documents are
 *   streamed, an oversized document is skipped and reading stops at a total byte budget. Meeting
 *   documents are user-writable and the rules cannot bound every list element, so a user must never
 *   be able to make this function load hundreds of megabytes (shared instances serve other users).
 */
import { createHash } from 'node:crypto';

import type { DocumentData, Firestore } from 'firebase-admin/firestore';

import { CONTEXT_WINDOW } from '../config';
import { RECURRENCE_FREQS, aiMeetingContextDocSchema, type AiMeetingContextDoc, type RecurrenceRule } from '../shared/aiContract';
import { isValidTimeZone, parseInstant, toLocalDate, toLocalTime, WEEKDAY_NAMES, getZonedParts } from './time';

export interface MeetingRecord {
  id: string;
  doc: AiMeetingContextDoc;
}

export interface MeetingReader {
  /** Meetings with startAt in [fromIso, toIso] (tombstones included; the caller filters). */
  listByStartRange(uid: string, fromIso: string, toIso: string, limit: number): Promise<MeetingRecord[]>;
  get(uid: string, meetingId: string): Promise<MeetingRecord | null>;
  /**
   * Recurring masters regardless of their (first-occurrence) startAt: an old series' master falls
   * outside the startAt window, but its occurrences are still current, so the assistant must see
   * it ("delete tomorrow's standup"). Optional for older fakes; absent = no extra lookup.
   */
  listRecurring?(uid: string, limit: number): Promise<MeetingRecord[]>;
}

/** How many recurring masters are loaded on top of the startAt window. */
export const RECURRING_MASTERS_LIMIT = 100;

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

/**
 * Short refs for document ids: deterministic, unique within the set (grows on collision).
 * Meetings use the default "m" prefix; tasks (v5) use "t", so the two ref spaces can never be
 * confused or targeted across kinds.
 */
export function assignRefs(meetingIds: readonly string[], prefix = 'm'): Map<string, string> {
  const digests = new Map(meetingIds.map((id) => [id, base32(createHash('sha256').update(id).digest())]));
  for (let length = 7; length <= 52; length += 3) {
    const refs = new Map<string, string>();
    const seen = new Set<string>();
    let collision = false;
    for (const [id, digest] of digests) {
      const ref = `${prefix}${digest.slice(0, length)}`;
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
  return new Map(meetingIds.map((id, index) => [id, `${prefix}${index + 1}`]));
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
  const [records, recurringRecords, followUpRecord] = await Promise.all([
    reader.listByStartRange(uid, fromIso, toIso, CONTEXT_WINDOW.queryLimit),
    reader.listRecurring ? reader.listRecurring(uid, RECURRING_MASTERS_LIMIT) : Promise.resolve([]),
    followUpMeetingId ? reader.get(uid, followUpMeetingId) : Promise.resolve(null),
  ]);
  if (followUpMeetingId && (!followUpRecord || !isVisibleMeeting(followUpRecord.doc))) {
    throw new FollowUpMeetingNotFoundError();
  }
  // Masters inside the window come back from both queries; buildMeetingContext deduplicates.
  const all = [...(followUpRecord ? [followUpRecord] : []), ...records, ...recurringRecords];
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
  participants: { email: string; name: string | null }[];
  participantsTotal: number;
  /** Only for the follow-up meeting. */
  description?: string;
  /** Recurring meetings only. `start` is the FIRST occurrence of the series. */
  recurring?: true;
  /** Compact rule, e.g. "every 2 weeks on MO,WE until 2026-12-31" (see compactRecurrence). */
  repeats?: string;
}

/**
 * Deterministic compact description of a recurrence rule for the data block (English, machine
 * readable): "every day" / "every 2 weeks on MO,WE" / "every month on day 15 x10" /
 * "... until 2026-12-31" (the until instant's local day in the meeting's zone).
 */
export function compactRecurrence(rule: RecurrenceRule, meetingZone: string): string {
  const unit = rule.freq === 'daily' ? 'day' : rule.freq === 'weekly' ? 'week' : 'month';
  let text = rule.interval === 1 ? `every ${unit}` : `every ${rule.interval} ${unit}s`;
  if (rule.freq === 'weekly' && rule.byWeekday !== null && rule.byWeekday.length > 0) {
    text += ` on ${rule.byWeekday.join(',')}`;
  }
  if (rule.freq === 'monthly' && rule.byMonthDay !== null) text += ` on day ${rule.byMonthDay}`;
  if (rule.until !== null) {
    const until = parseInstant(rule.until);
    text += ` until ${until ? toLocalDate(until, meetingZone) : rule.until.slice(0, 10)}`;
  } else if (rule.count !== null) {
    text += ` x${rule.count}`;
  }
  return text;
}

function clip(value: string, max: number): string {
  const trimmed = value.replace(/\s+/g, ' ').trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}...` : trimmed;
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
    participants: meeting.doc.participants.slice(0, CONTEXT_WINDOW.maxParticipantsListed).map((participant) => {
      const name = participant.name ? clip(participant.name, CONTEXT_WINDOW.maxParticipantNameChars) : '';
      return {
        email: clip(participant.email.trim().toLowerCase(), CONTEXT_WINDOW.maxParticipantEmailChars),
        name: name.length > 0 ? name : null,
      };
    }),
    participantsTotal: meeting.participantEmails.length,
  };
  if (meetingZone !== userTimeZone) view.meetingTimeZone = meetingZone;
  if (doc.recurrence !== null && doc.recurrence !== undefined) {
    view.recurring = true;
    view.repeats = compactRecurrence(doc.recurrence, meetingZone);
  }
  if (isFollowUp && doc.description.trim().length > 0) {
    view.description = clip(doc.description, CONTEXT_WINDOW.maxFollowUpDescriptionChars);
  }
  return view;
}

// ---------------------------------------------------------------------------------------------
// Bounded loading
// ---------------------------------------------------------------------------------------------

/** The only document fields the context reads (Firestore field mask). */
export const CONTEXT_FIELDS = [
  'title',
  'description',
  'startAt',
  'durationMinutes',
  'timezone',
  'allDay',
  'status',
  'deletedAt',
  'source',
  'participants',
  'location',
  'conference',
  'recurrence',
] as const;

/** Rough serialized size of a document (characters of its JSON). */
export function approximateSize(data: unknown): number {
  try {
    return JSON.stringify(data)?.length ?? 0;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

export interface CollectResult {
  records: MeetingRecord[];
  /** Malformed or oversized documents that were skipped. */
  skipped: number;
  /** true when reading stopped at the byte budget. */
  truncated: boolean;
}

/**
 * Consumes `docs` until `limit` records or `maxTotalBytes` are reached (stopping the source early),
 * skipping documents over `maxDocBytes` and documents that do not parse.
 */
export async function collectWithinBudget(
  docs: AsyncIterable<{ id: string; data: unknown }>,
  budget: { limit: number; maxDocBytes: number; maxTotalBytes: number },
): Promise<CollectResult> {
  const records: MeetingRecord[] = [];
  let skipped = 0;
  let total = 0;
  let truncated = false;
  for await (const item of docs) {
    const size = approximateSize(item.data);
    if (size > budget.maxDocBytes) {
      skipped += 1;
      continue;
    }
    if (total + size > budget.maxTotalBytes) {
      truncated = true;
      break;
    }
    total += size;
    const parsed = aiMeetingContextDocSchema.safeParse(item.data);
    if (parsed.success) records.push({ id: item.id, doc: parsed.data });
    else skipped += 1;
    if (records.length >= budget.limit) break;
  }
  return { records, skipped, truncated };
}

// ---------------------------------------------------------------------------------------------
// Firestore reader
// ---------------------------------------------------------------------------------------------

async function* snapshots(stream: AsyncIterable<unknown>): AsyncGenerator<{ id: string; data: unknown }> {
  for await (const doc of stream) {
    const snapshot = doc as { id: string; data(): DocumentData };
    yield { id: snapshot.id, data: snapshot.data() };
  }
}

export function firestoreMeetingReader(
  db: Firestore,
  onSkipped: (count: number, truncated: boolean) => void = () => undefined,
): MeetingReader {
  const budget = {
    maxDocBytes: CONTEXT_WINDOW.maxDocumentBytes,
    maxTotalBytes: CONTEXT_WINDOW.maxContextBytes,
  };
  return {
    async listByStartRange(uid, fromIso, toIso, limit) {
      const query = db
        .collection(`users/${uid}/meetings`)
        .where('startAt', '>=', fromIso)
        .where('startAt', '<=', toIso)
        .orderBy('startAt')
        .select(...CONTEXT_FIELDS)
        .limit(limit);
      // Streamed: leaving the loop early (budget reached) cancels the rest of the query.
      const result = await collectWithinBudget(snapshots(query.stream() as unknown as AsyncIterable<unknown>), {
        ...budget,
        limit,
      });
      if (result.skipped > 0 || result.truncated) onSkipped(result.skipped, result.truncated);
      return result.records;
    },
    async listRecurring(uid, limit) {
      // Sparse storage: one-off meetings have no `recurrence` field, so this only matches masters
      // (automatic single-field index on recurrence.freq; no composite index needed).
      const query = db
        .collection(`users/${uid}/meetings`)
        .where('recurrence.freq', 'in', [...RECURRENCE_FREQS])
        .select(...CONTEXT_FIELDS)
        .limit(limit);
      const result = await collectWithinBudget(snapshots(query.stream() as unknown as AsyncIterable<unknown>), {
        ...budget,
        limit,
      });
      if (result.skipped > 0 || result.truncated) onSkipped(result.skipped, result.truncated);
      return result.records;
    },
    async get(uid, meetingId) {
      const [snapshot] = await db.getAll(db.doc(`users/${uid}/meetings/${meetingId}`), { fieldMask: [...CONTEXT_FIELDS] });
      if (!snapshot || !snapshot.exists) return null;
      const result = await collectWithinBudget(
        (async function* single() {
          yield { id: snapshot.id, data: snapshot.data() };
        })(),
        { ...budget, limit: 1 },
      );
      if (result.skipped > 0) onSkipped(result.skipped, false);
      return result.records[0] ?? null;
    },
  };
}

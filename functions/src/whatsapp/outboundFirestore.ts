/**
 * M13: the Firestore side of the bot-started messages (./outbound.ts OutboundReader). Reads only
 * plaintext fields with the Admin SDK: the preferences, the meetings and tasks (the same fields
 * the chat reads), and the summaries' plaintext structure (status, receivedAt, match snapshot,
 * counts). Never a sealed field, so the scheduler binds no SUMMARIES_DATA_KEY (M11 separation).
 */
import type { Firestore } from 'firebase-admin/firestore';

import { SUMMARIES_ENABLED, SUMMARIES_PILOT_UIDS } from '../config';
import { firestoreQuotaStore, peekQuota } from '../assistant/quota';
import { APP_LANGUAGES, RECURRENCE_FREQS, type AppLanguage } from '../shared/aiContract';
import { expandOccurrences, type RecurringMeetingLike } from '../shared/recurrence';
import { isValidTimeZone, toLocalDateTime } from '../shared/time';
import { isPilotUid } from '../summaries/gate';
import { firestoreMeetingStore, formatMeetingForShare } from './executor';
import type { DayItem, OutboundReader, SummaryView, TaskView, UserPrefs } from './outbound';

/**
 * users/{uid}/meetingSummaries (summaries/model.ts MEETING_SUMMARIES_COLLECTION; a test keeps them
 * equal). Not imported: model.ts loads the sealing code, which the webhook's graph must never load.
 */
export const SUMMARIES_COLLECTION_NAME = 'meetingSummaries';

const MEETING_FIELDS = ['title', 'startAt', 'durationMinutes', 'timezone', 'allDay', 'status', 'deletedAt', 'recurrence', 'recurrenceOverrides'] as const;
const TASK_FIELDS = ['title', 'status', 'dueDate', 'dueTime', 'timezone', 'reminderMinutesBefore', 'people'] as const;
const MAX_MEETINGS = 300;
const MAX_TASKS = 300;
const MAX_OCCURRENCES = 50;

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function isLive(data: Record<string, unknown>): boolean {
  if (data.deletedAt !== undefined && data.deletedAt !== null) return false;
  return data.status !== 'cancelled' && data.status !== 'deleted';
}

function durationOf(data: Record<string, unknown>): number {
  const value = typeof data.durationMinutes === 'number' ? data.durationMinutes : 30;
  return Math.max(1, Math.min(24 * 60 * 14, Math.round(value)));
}

function oneOff(id: string, data: Record<string, unknown>): DayItem | null {
  const startAt = str(data.startAt);
  const startMs = startAt === null ? NaN : Date.parse(startAt);
  if (!Number.isFinite(startMs)) return null;
  return {
    meetingId: id,
    occurrenceDate: null,
    title: str(data.title) ?? '',
    startAt: new Date(startMs).toISOString(),
    endAt: new Date(startMs + durationOf(data) * 60_000).toISOString(),
    allDay: data.allDay === true,
  };
}

function seriesItems(id: string, data: Record<string, unknown>, fromIso: string, toIso: string): DayItem[] {
  const startAt = str(data.startAt);
  const zone = str(data.timezone);
  if (startAt === null || zone === null || !isValidTimeZone(zone) || !Number.isFinite(Date.parse(startAt))) return [];
  const local = toLocalDateTime(startAt, zone);
  const like: RecurringMeetingLike = {
    id,
    title: str(data.title) ?? '',
    date: local.date,
    time: local.time,
    timezone: zone,
    durationMinutes: durationOf(data),
    allDay: data.allDay === true,
    recurrence: data.recurrence as RecurringMeetingLike['recurrence'],
    recurrenceOverrides: (data.recurrenceOverrides ?? null) as RecurringMeetingLike['recurrenceOverrides'],
  };
  try {
    return expandOccurrences(like, fromIso, toIso, { max: MAX_OCCURRENCES })
      .filter((occurrence) => occurrence.startAt >= fromIso && occurrence.startAt < toIso)
      .map((occurrence) => ({
        meetingId: id,
        occurrenceDate: occurrence.localDateKey,
        title: occurrence.title,
        startAt: occurrence.startAt,
        endAt: occurrence.endAt,
        allDay: like.allDay,
      }));
  } catch {
    return [];
  }
}

function taskOf(id: string, data: Record<string, unknown> | undefined): TaskView | null {
  if (data === undefined) return null;
  const people = Array.isArray(data.people)
    ? data.people
        .map((person) => (typeof person === 'object' && person !== null ? str((person as Record<string, unknown>).name) : null))
        .filter((name): name is string => name !== null)
        .map((name) => ({ name }))
    : [];
  return {
    id,
    title: str(data.title) ?? '',
    status: str(data.status) ?? 'open',
    dueDate: str(data.dueDate),
    dueTime: str(data.dueTime),
    timezone: str(data.timezone) ?? 'UTC',
    reminderMinutesBefore: typeof data.reminderMinutesBefore === 'number' ? data.reminderMinutesBefore : null,
    people,
  };
}

function summaryOf(id: string, data: Record<string, unknown> | undefined): SummaryView | null {
  if (data === undefined) return null;
  const match = (typeof data.match === 'object' && data.match !== null ? data.match : null) as Record<string, unknown> | null;
  const snapshot = (match && typeof match.meetingSnapshot === 'object' && match.meetingSnapshot !== null ? match.meetingSnapshot : null) as Record<
    string,
    unknown
  > | null;
  let meetingDate = str(match?.occurrenceDate);
  if (meetingDate === null && snapshot !== null) {
    const startAt = str(snapshot.startAt);
    const zone = str(snapshot.timezone);
    if (startAt !== null && zone !== null && isValidTimeZone(zone) && Number.isFinite(Date.parse(startAt))) meetingDate = toLocalDateTime(startAt, zone).date;
  }
  meetingDate ??= str(data.summaryDate);
  const counts = (typeof data.counts === 'object' && data.counts !== null ? data.counts : {}) as Record<string, unknown>;
  return {
    summaryId: id,
    status: str(data.status) ?? '',
    receivedAt: str(data.receivedAt) ?? '',
    meetingTitle: snapshot ? str(snapshot.title) : null,
    meetingDate,
    items: typeof counts.items === 'number' ? counts.items : 0,
    handled: data.userAction !== undefined && data.userAction !== null,
  };
}

const SUMMARY_FIELDS = ['status', 'receivedAt', 'match', 'summaryDate', 'counts', 'userAction'] as const;

export function firestoreOutboundReader(db: Firestore): OutboundReader {
  const meetings = (uid: string) => db.collection(`users/${uid}/meetings`);
  const tasks = (uid: string) => db.collection(`users/${uid}/tasks`);
  const summaries = (uid: string) => db.collection(`users/${uid}/${SUMMARIES_COLLECTION_NAME}`);
  const quota = firestoreQuotaStore(db);
  const meetingStore = firestoreMeetingStore(db);

  return {
    async prefs(uid): Promise<UserPrefs> {
      const snapshot = await db.doc(`users/${uid}/settings/preferences`).get();
      const data = (snapshot.exists ? snapshot.data() : {}) as Record<string, unknown>;
      const uiLanguage: AppLanguage = (APP_LANGUAGES as readonly unknown[]).includes(data.language) ? (data.language as AppLanguage) : 'en';
      const zone = str(data.timezone);
      const briefing = str(data.briefingTime);
      return {
        uiLanguage,
        timezone: zone !== null && zone !== 'UTC' && isValidTimeZone(zone) ? zone : null,
        briefingTime: briefing !== null && /^([01]\d|2[0-3]):[0-5]\d$/.test(briefing) ? briefing : '08:00',
      };
    },
    async dayItems(uid, fromIso, toIso) {
      const [oneOffs, series] = await Promise.all([
        meetings(uid).where('startAt', '>=', fromIso).where('startAt', '<', toIso).orderBy('startAt').select(...MEETING_FIELDS).limit(MAX_MEETINGS).get(),
        meetings(uid).where('recurrence.freq', 'in', [...RECURRENCE_FREQS]).select(...MEETING_FIELDS).limit(MAX_MEETINGS).get(),
      ]);
      const items: DayItem[] = [];
      const seriesIds = new Set(series.docs.map((doc) => doc.id));
      for (const doc of oneOffs.docs) {
        const data = doc.data() as Record<string, unknown>;
        if (!isLive(data) || seriesIds.has(doc.id) || (data.recurrence !== undefined && data.recurrence !== null)) continue;
        const item = oneOff(doc.id, data);
        if (item !== null) items.push(item);
      }
      for (const doc of series.docs) {
        const data = doc.data() as Record<string, unknown>;
        if (!isLive(data)) continue;
        items.push(...seriesItems(doc.id, data, fromIso, toIso));
      }
      return items.sort((a, b) => (a.startAt < b.startAt ? -1 : a.startAt > b.startAt ? 1 : a.meetingId < b.meetingId ? -1 : 1));
    },
    async openTasks(uid) {
      const snapshot = await tasks(uid).where('status', '==', 'open').select(...TASK_FIELDS).limit(MAX_TASKS).get();
      return snapshot.docs.map((doc) => taskOf(doc.id, doc.data() as Record<string, unknown>)).filter((task): task is TaskView => task !== null);
    },
    async task(uid, taskId) {
      const snapshot = await tasks(uid).doc(taskId).get();
      return snapshot.exists ? taskOf(taskId, snapshot.data() as Record<string, unknown>) : null;
    },
    meetingBlock(uid, meetingId, language) {
      return formatMeetingForShare(uid, meetingId, language, { store: meetingStore, now: () => new Date() });
    },
    async summary(uid, summaryId) {
      const snapshot = await summaries(uid).doc(summaryId).get();
      if (!snapshot.exists) return null;
      const data = snapshot.data() as Record<string, unknown>;
      const picked: Record<string, unknown> = {};
      for (const field of SUMMARY_FIELDS) picked[field] = data[field];
      return summaryOf(summaryId, picked);
    },
    async summariesAfter(uid, afterIso, limit) {
      const snapshot = await summaries(uid).where('receivedAt', '>', afterIso).orderBy('receivedAt').select(...SUMMARY_FIELDS).limit(limit).get();
      return snapshot.docs.map((doc) => summaryOf(doc.id, doc.data() as Record<string, unknown>)).filter((s): s is SummaryView => s !== null);
    },
    async linkUid(phoneE164) {
      const snapshot = await db.doc(`whatsappLinks/${phoneE164}`).get();
      return snapshot.exists ? str((snapshot.data() as Record<string, unknown>).uid) : null;
    },
    hasAllowance(uid, now) {
      return peekQuota(quota, uid, now);
    },
    isCommitmentsPilot(uid) {
      return SUMMARIES_ENABLED.value() === true && isPilotUid(uid, SUMMARIES_PILOT_UIDS.value());
    },
  };
}

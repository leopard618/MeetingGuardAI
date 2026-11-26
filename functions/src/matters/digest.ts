/**
 * A5: the morning digest (matterDigest), written by CODE from the owner's own matters, never by the
 * model, so it costs nothing and cannot invent anything:
 * - what moved: the timeline of the last day on running matters and ones that ended that day;
 * - what needs the owner today: cards waiting and forwards waiting (a draft is not listed: an
 *   unfinished draft cannot be reopened from the app, so it would only be noise);
 * - follow-ups due before the end of the owner's day;
 * - meetings it arranged in the next week (also the list the app schedules briefings for).
 * The app shows it on the matters screen, reads it aloud on request, and puts "N need you" in the
 * daily briefing notification. Notifications sent from the server come with A8.
 */
import { matterDigestRequestSchema, type Language, type MatterDigestItem, type MatterDigestResponse } from '../shared/aiContract';
import { isValidTimeZone } from '../assistant/time';
import { addDaysToLocalDate, toLocalDateTime, zonedDateTimeToUtcIso } from '../shared/time';
import { matterError, readable, requireSignedIn, type MatterCaller, type MatterDeps } from './handlers';
import type { MatterDoc } from './model';
import { followUpDueAt } from './schedule';
import { prefsOf } from './settings';
import { DIGEST_TEXT, SUMMARY_TEXT, formatInstant } from './text';

const DAY_MS = 86_400_000;
/** Meetings ahead the digest names (and the app schedules briefings for). */
export const DIGEST_MEETING_DAYS = 7;
/** Timeline lines per matter under "what moved". */
const MOVED_LINES = 3;
const MAX_ITEMS = 10;

export function handleMatterDigest(callerIn: MatterCaller | null, data: unknown, deps: MatterDeps): Promise<MatterDigestResponse> {
  return readable(async () => {
    const caller = requireSignedIn(callerIn);
    const parsed = matterDigestRequestSchema.safeParse(data);
    if (!parsed.success || !isValidTimeZone(parsed.data.timeZone)) throw matterError('invalid_request');
    return buildDigest(caller.uid, parsed.data.language, parsed.data.timeZone, deps);
  });
}

export async function buildDigest(uid: string, language: Language, timeZone: string, deps: MatterDeps): Promise<MatterDigestResponse> {
  const now = deps.now();
  const nowMs = now.getTime();
  const sinceIso = new Date(nowMs - DAY_MS).toISOString();
  const endOfDay = Date.parse(zonedDateTimeToUtcIso(addDaysToLocalDate(toLocalDateTime(now, timeZone).date, 1), '00:00', timeZone));
  const [running, ended, prefs, watches] = await Promise.all([
    deps.store.listMatters(uid, ['draft', 'active', 'paused']),
    deps.store.listMatters(uid, ['done', 'cancelled']),
    prefsOf(uid, deps),
    deps.watches ? deps.watches.list(uid) : Promise.resolve([]),
  ]);
  const newest = (a: { doc: MatterDoc }, b: { doc: MatterDoc }) => b.doc.updatedAt.localeCompare(a.doc.updatedAt);

  // what moved: the last day of the timeline of matters that changed in it
  const moved: MatterDigestItem[] = [];
  const recentlyEnded = ended.filter(({ doc }) => (doc.endedAt ?? '') > sinceIso);
  for (const { id, doc } of [...running.filter(({ doc }) => doc.status !== 'draft'), ...recentlyEnded].sort(newest)) {
    if (moved.length >= MAX_ITEMS || doc.updatedAt <= sinceIso) continue;
    const events = (await deps.store.listEvents(uid, id, 20)).filter((e) => e.at > sinceIso);
    // oldest first, as it happened (the timeline is read newest first)
    const lines = [...events]
      .reverse()
      .map((e) => SUMMARY_TEXT.event(e.type, e.detail, language))
      .filter((line): line is string => line !== null)
      .slice(0, MOVED_LINES);
    if (lines.length) moved.push({ matterId: id, title: doc.title, text: lines.join(' ') });
  }

  // what needs the owner today
  const needsYou: MatterDigestItem[] = [];
  let needCount = 0;
  for (const { id, doc } of [...running].sort(newest)) {
    if (doc.status !== 'draft' && doc.pendingApprovals > 0) {
      needsYou.push({ matterId: id, title: doc.title, text: DIGEST_TEXT.cards(doc.pendingApprovals, language) });
      needCount += doc.pendingApprovals;
    }
  }
  const nowIso = now.toISOString();
  const waiting = watches.filter(({ record }) => record.expiresAt > nowIso && record.matterId === null).length;
  if (waiting > 0) {
    needsYou.push({ matterId: null, title: DIGEST_TEXT.forwardsTitle(language), text: DIGEST_TEXT.forwards(waiting, language) });
    needCount += waiting;
  }

  // follow-ups due before the end of the owner's day
  const followUps: MatterDigestItem[] = [];
  for (const { id, doc } of running) {
    if (doc.status !== 'active') continue;
    const due = followUpDueAt(doc);
    if (due === null || due >= endOfDay) continue;
    const zone = doc.mandate?.timeZone ?? timeZone;
    followUps.push({ matterId: id, title: doc.title, text: DIGEST_TEXT.followUp(formatInstant(new Date(Math.max(due, nowMs)).toISOString(), zone, language), language) });
  }

  // meetings it arranged in the next week
  const meetings: MatterDigestItem[] = [];
  const briefings: MatterDigestResponse['briefings'] = [];
  const horizon = nowMs + DIGEST_MEETING_DAYS * DAY_MS;
  const booked = [...running, ...recentlyEnded]
    .filter(({ doc }) => doc.booking && Date.parse(doc.booking.start) > nowMs && Date.parse(doc.booking.start) < horizon)
    .sort((a, b) => a.doc.booking!.start.localeCompare(b.doc.booking!.start));
  for (const { id, doc } of booked) {
    const zone = doc.mandate?.timeZone ?? timeZone;
    meetings.push({ matterId: id, title: doc.title, text: DIGEST_TEXT.meeting(formatInstant(doc.booking!.start, zone, language), language) });
    briefings.push({ matterId: id, title: doc.title, start: doc.booking!.start });
  }

  const sections = { moved: moved.slice(0, MAX_ITEMS), needsYou: needsYou.slice(0, MAX_ITEMS), followUps: followUps.slice(0, MAX_ITEMS), meetings: meetings.slice(0, MAX_ITEMS) };
  return { generatedAt: nowIso, needsYou: needCount, sections, spoken: spokenDigest(sections, language), briefings, briefingMinutes: prefs.briefingMinutes };
}

/** The digest as one text to read aloud: each section's heading, then its lines. */
export function spokenDigest(sections: MatterDigestResponse['sections'], language: Language): string {
  const parts: string[] = [];
  for (const key of ['needsYou', 'moved', 'followUps', 'meetings'] as const) {
    const items = sections[key];
    if (!items.length) continue;
    parts.push(`${DIGEST_TEXT.heading(key, language)}. ${items.map((i) => `${i.title}: ${i.text}`).join(' ')}`);
  }
  return parts.length ? parts.join(' ') : DIGEST_TEXT.nothing(language);
}

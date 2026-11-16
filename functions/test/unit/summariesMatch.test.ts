/**
 * M10 matching (functions/src/summaries/match.ts; docs/v2/M10-DESIGN.md section 6, section 5 rows
 * 7 to 10, section 12 Matching): title normalization and scores, the time score bands, the date
 * gate in the meeting's zone, the preferences zone and UTC, duplicate grouping, and the filing
 * decision. All data is synthetic: "Acmepay" stands in for the specimen's company name, and every
 * time is built by hand with the local time in a comment.
 */
import {
  SUMMARIES_TUNING,
  conferenceLinkInText,
  decide,
  normalizeTitle,
  summaryDateZone,
  timeScore,
  titlePairScore,
  titleScore,
  trustInboxReason,
  type MatchCandidate,
  type MatchInput,
  type MatchRecord,
} from '../../src/summaries/match';
import { toLocalDateTime } from '../../src/shared/time';

const MX = 'America/Mexico_City'; // UTC-6 all year since 2022
const NOW = new Date('2026-10-16T21:25:00.000Z');

/** "Acmepay weekly sync", 2026-10-16 14:00-15:00 Mexico City. */
function meeting(overrides: Partial<MatchCandidate> = {}): MatchCandidate {
  return {
    meetingId: 'm_sync',
    occurrenceDate: null,
    title: 'Acmepay weekly sync',
    startAt: '2026-10-16T20:00:00.000Z', // 14:00 local
    endAt: '2026-10-16T21:00:00.000Z', // 15:00 local
    timezone: MX,
    allDay: false,
    cancelled: false,
    deleted: false,
    source: 'google',
    conferenceUrl: null,
    ...overrides,
  };
}

/** "Marketing review", 2026-10-16 10:00-10:30 Mexico City. */
const MARKETING = meeting({
  meetingId: 'm_marketing',
  title: 'Marketing review',
  startAt: '2026-10-16T16:00:00.000Z', // 10:00 local
  endAt: '2026-10-16T16:30:00.000Z', // 10:30 local
});

/** The worked fixture: specimen-shaped title on 2026-10-16, signed Date 15:20 Mexico City. */
function input(overrides: Partial<MatchInput> = {}): MatchInput {
  return {
    tier: 'vendor_verified',
    recipientBound: true,
    fresh: true,
    titleLine: 'Acmepay marketing launch readiness',
    subjectClean: 'Meeting notes: Acmepay marketing launch readiness',
    summaryDate: '2026-10-16',
    anchor: { at: '2026-10-16T21:20:00.000Z', signed: true }, // 15:20 local
    text: 'Synthetic recap. TLDR: a made-up launch check. Action items: [ ] Send the synthetic file (owner: Pat)',
    preferencesTimeZone: MX,
    rejectedMeetingIds: [],
    candidates: [meeting(), MARKETING],
    now: NOW,
    ...overrides,
  };
}

function ids(record: MatchRecord): string[] {
  return record.candidates.map((c) => c.meetingId);
}

function suggestion(record: MatchRecord, meetingId: string) {
  const found = record.candidates.find((c) => c.meetingId === meetingId);
  if (!found) throw new Error(`no suggestion ${meetingId}`);
  return found;
}

// ---------------------------------------------------------------------------------------------

describe('SUMMARIES_TUNING', () => {
  it('carries the design constants', () => {
    expect(SUMMARIES_TUNING.weights).toEqual({ title: 0.65, time: 0.35 });
    expect(SUMMARIES_TUNING.conferenceBonus).toBe(0.15);
    expect(SUMMARIES_TUNING.ruleA).toEqual({ minTitleScore: 0.35, minScore: 0.6, tieWithin: 0.15 });
    expect(SUMMARIES_TUNING.ruleB).toEqual({ minTitleScore: 0.6, minTimeScore: 0.5 });
    expect(SUMMARIES_TUNING.suggestions).toEqual({ minScore: 0.2, max: 3 });
    expect(SUMMARIES_TUNING.time).toMatchObject({ fullFromMinutes: -15, fullToMinutes: 60, zeroAtMinutes: 360 });
    expect(SUMMARIES_TUNING.groupStartToleranceMinutes).toBe(5);
  });
});

describe('normalizeTitle', () => {
  it('folds accents, case, compatibility forms and "&"', () => {
    expect(normalizeTitle('Caf\u00e9 & Co.')).toBe('cafe and co');
    expect(normalizeTitle('\uff21\uff23\uff2d\uff25 Weekly SYNC')).toBe('acme weekly sync');
    expect(normalizeTitle("Bob's sync")).toBe('bobs sync');
    expect(normalizeTitle('Bob\u2019s sync')).toBe('bobs sync');
  });

  it('removes reply and forward prefixes and [tags]', () => {
    expect(normalizeTitle('RE: Fwd: [External] Acmepay weekly sync')).toBe('acmepay weekly sync');
    expect(normalizeTitle('RV: Acmepay weekly sync')).toBe('acmepay weekly sync');
  });

  it('removes notetaker labels and names before and after the title', () => {
    expect(normalizeTitle('Meeting notes: Acmepay weekly sync')).toBe('acmepay weekly sync');
    expect(normalizeTitle('Fireflies.ai notes for Acmepay weekly sync')).toBe('acmepay weekly sync');
    expect(normalizeTitle('Acmepay weekly sync - Meeting notes')).toBe('acmepay weekly sync');
    expect(normalizeTitle('Acmepay weekly sync (Meeting recap)')).toBe('acmepay weekly sync');
    expect(normalizeTitle('Resumen de la reuni\u00f3n: Acmepay sync semanal')).toBe('acmepay sync semanal');
    expect(normalizeTitle('Acmepay weekly sync | Fathom')).toBe('acmepay weekly sync');
  });

  it('removes trailing dates and times in English and Spanish, and a leading ISO date', () => {
    expect(normalizeTitle('Acmepay weekly sync - 2026-10-16')).toBe('acmepay weekly sync');
    expect(normalizeTitle('Acmepay weekly sync \u00b7 Meeting notes \u00b7 2026-10-16')).toBe('acmepay weekly sync');
    expect(normalizeTitle('Acmepay weekly sync \u2013 Oct 16, 2026')).toBe('acmepay weekly sync');
    expect(normalizeTitle('Acmepay weekly sync (Thu, Oct 16, 2026 at 2:00 pm)')).toBe('acmepay weekly sync');
    expect(normalizeTitle('Acmepay weekly sync 16/10/2026')).toBe('acmepay weekly sync');
    expect(normalizeTitle('Acmepay weekly sync 14:00')).toBe('acmepay weekly sync');
    expect(normalizeTitle('Revisi\u00f3n semanal - 16 de octubre de 2026')).toBe('revision semanal');
    expect(normalizeTitle('2026-10-16 Acmepay weekly sync')).toBe('acmepay weekly sync');
  });

  it('keeps numbers that are not dates', () => {
    expect(normalizeTitle('Release 1.2.10 planning')).toBe('release 1 2 10 planning');
    expect(normalizeTitle('Q3 2026 budget')).toBe('q3 2026 budget');
  });

  it('turns a title that is only a label into nothing', () => {
    expect(normalizeTitle('Meeting notes')).toBe('');
    expect(normalizeTitle('Resumen')).toBe('');
    expect(normalizeTitle('   ')).toBe('');
    expect(normalizeTitle(null)).toBe('');
  });

  it('stays fast on adversarial titles (inputs are cut at 500 characters)', () => {
    const hostile = [
      `${'- '.repeat(240)}x`,
      `${'-'.repeat(499)}1`,
      `a${' 1'.repeat(240)}`,
      `${'1/'.repeat(250)}x`,
      `${'oct '.repeat(120)}x`,
      `${'thu, '.repeat(100)}x`,
      `${'('.repeat(499)}x`,
      `${'12:00 '.repeat(80)}x`,
      `${'meeting notes - '.repeat(30)}x`,
      `${'[a]'.repeat(160)}x`,
      `${'16 de octubre de 2026 '.repeat(20)}x`,
      'x'.repeat(100_000),
    ];
    const started = Date.now();
    for (const title of hostile) normalizeTitle(title);
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});

describe('titleScore', () => {
  it('is 1.0 on equal normalized titles', () => {
    expect(titlePairScore('Meeting notes: Acmepay Weekly Sync - 2026-10-16', 'Acmepay weekly sync')).toEqual({
      score: 1,
      reason: 'title_equal',
    });
  });

  it('uses token Dice', () => {
    expect(titlePairScore('Acmepay budget forecast offsite', 'Acmepay budget forecast hiring')).toEqual({
      score: 0.75,
      reason: 'title_words',
    });
  });

  it('gives 0.85 when every token of the shorter title is in the longer one', () => {
    expect(titlePairScore('Acmepay sync', 'Acmepay weekly sync')).toEqual({ score: 0.85, reason: 'title_subset' });
  });

  it('gives 0.6 for one shared distinctive token (the worked fixture)', () => {
    expect(titlePairScore('Acmepay marketing launch readiness', 'Acmepay weekly sync')).toEqual({
      score: 0.6,
      reason: 'title_shared_word',
    });
    expect(titlePairScore('Acmepay marketing launch readiness', 'Marketing review')).toEqual({
      score: 0.6,
      reason: 'title_shared_word',
    });
    expect(titlePairScore('Acme budget', 'Acme hiring').score).toBe(0.6);
  });

  it('never counts generic words, months, short words or stopwords as distinctive', () => {
    expect(titlePairScore('Weekly finance board', 'Weekly hiring').score).toBe(0.4);
    expect(titlePairScore('Reuni\u00f3n semanal de ventas', 'Junta semanal').score).toBe(0.4);
    expect(titlePairScore('October offsite planning', 'October hiring').score).toBe(0.4);
    expect(titlePairScore('Abc budget', 'Abc hiring').score).toBe(0.5);
    expect(titlePairScore('Call with the team', 'Lunch with the CEO')).toEqual({ score: 0, reason: 'title_none' });
  });

  it('takes the better of the title line and the subject', () => {
    expect(titleScore({ titleLine: 'Notes', subjectClean: 'Acmepay weekly sync' }, 'Acmepay weekly sync')).toEqual({
      score: 1,
      reason: 'title_equal',
      fromSubject: true,
    });
    expect(titleScore({ titleLine: 'Acmepay sync', subjectClean: null }, 'Acmepay weekly sync')).toEqual({
      score: 0.85,
      reason: 'title_subset',
      fromSubject: false,
    });
    expect(titleScore({ titleLine: null, subjectClean: null }, 'Acmepay weekly sync').score).toBe(0);
  });

  it('scores the meeting name read after a first-line document label as equal', () => {
    // extractSummaryMeta reads "Meeting summary: Pricing review with Carlos" as this titleLine.
    expect(titleScore({ titleLine: 'Pricing review with Carlos', subjectClean: null }, 'Pricing review with Carlos')).toEqual({
      score: 1,
      reason: 'title_equal',
      fromSubject: false,
    });
  });
});

describe('timeScore', () => {
  const slot = { startAt: '2026-10-16T20:00:00.000Z', endAt: '2026-10-16T21:00:00.000Z' }; // 14:00-15:00 local
  const signed = (at: string) => ({ at, signed: true });

  it('is 0.5 without an anchor', () => {
    expect(timeScore(slot, null)).toEqual({ score: 0.5, reasons: ['time_no_anchor'] });
  });

  it('is 1.0 from 15 minutes before the end to 60 minutes after it', () => {
    expect(timeScore(slot, signed('2026-10-16T21:20:00.000Z')).score).toBe(1); // +20
    expect(timeScore(slot, signed('2026-10-16T20:45:00.000Z')).score).toBe(1); // -15
    expect(timeScore(slot, signed('2026-10-16T22:00:00.000Z'))).toEqual({ score: 1, reasons: ['time_close'] }); // +60
  });

  it('falls linearly to 0 at 6 hours after the end', () => {
    expect(timeScore(slot, signed('2026-10-17T00:30:00.000Z'))).toEqual({ score: 0.5, reasons: ['time_late'] }); // +210
    expect(timeScore(slot, signed('2026-10-17T01:50:00.000Z')).score).toBeCloseTo(0.2333, 4); // +290
    expect(timeScore(slot, signed('2026-10-17T03:00:00.000Z'))).toEqual({ score: 0, reasons: ['time_too_late'] }); // +360
    expect(timeScore(slot, signed('2026-10-17T07:00:00.000Z')).score).toBe(0);
  });

  it('is 0.6 when the meeting ended early: anchor more than 15 minutes before the end, after start minus 15', () => {
    expect(timeScore(slot, signed('2026-10-16T20:44:00.000Z'))).toEqual({ score: 0.6, reasons: ['time_ended_early'] }); // -16
    expect(timeScore(slot, signed('2026-10-16T20:30:00.000Z')).score).toBe(0.6); // 14:30 local
    expect(timeScore(slot, signed('2026-10-16T19:46:00.000Z')).score).toBe(0.6); // start minus 14
  });

  it('is 0 for an anchor at or before start minus 15 (written before the meeting began)', () => {
    expect(timeScore(slot, { at: '2026-10-16T19:45:00.000Z', signed: false })).toEqual({
      score: 0,
      reasons: ['time_before_start', 'time_unsigned_anchor'],
    });
  });

  it('caps an unsigned anchor at 0.8', () => {
    expect(timeScore(slot, { at: '2026-10-16T21:20:00.000Z', signed: false })).toEqual({
      score: 0.8,
      reasons: ['time_close', 'time_unsigned_anchor'],
    });
    expect(timeScore(slot, { at: '2026-10-17T00:30:00.000Z', signed: false }).score).toBe(0.5);
  });
});

describe('summaryDateZone', () => {
  it('uses the meeting zone first: 21:30 in Mexico City is the next day in UTC', () => {
    const start = '2026-10-17T03:30:00.000Z'; // 2026-10-16 21:30 local
    expect(toLocalDateTime(start, 'UTC').date).toBe('2026-10-17');
    expect(summaryDateZone({ startAt: start, timezone: MX, allDay: false }, '2026-10-16', null)).toBe('meeting');
    expect(summaryDateZone({ startAt: start, timezone: MX, allDay: false }, '2026-10-17', null)).toBe('utc');
  });

  it('falls back to the preferences zone, then UTC', () => {
    const start = '2026-10-17T03:30:00.000Z';
    expect(summaryDateZone({ startAt: start, timezone: 'UTC', allDay: false }, '2026-10-16', MX)).toBe('preferences');
    expect(summaryDateZone({ startAt: start, timezone: 'UTC', allDay: false }, '2026-10-16', null)).toBeNull();
    // 2026-10-16 20:00Z is already 2026-10-17 in Tokyo; only UTC says the 16th.
    expect(summaryDateZone({ startAt: '2026-10-16T20:00:00.000Z', timezone: 'Asia/Tokyo', allDay: false }, '2026-10-16', 'Asia/Tokyo')).toBe('utc');
  });

  it('skips invalid zone names instead of throwing', () => {
    const start = '2026-10-17T03:30:00.000Z';
    expect(summaryDateZone({ startAt: start, timezone: 'Not/A_Zone', allDay: false }, '2026-10-16', MX)).toBe('preferences');
    expect(summaryDateZone({ startAt: start, timezone: 'Not/A_Zone', allDay: false }, '2026-10-16', 'Bad/Zone')).toBeNull();
  });

  it('checks an all-day meeting in its own zone only', () => {
    const tokyoMidnight = '2026-10-15T15:00:00.000Z'; // 2026-10-16 00:00 in Tokyo
    expect(summaryDateZone({ startAt: tokyoMidnight, timezone: 'Asia/Tokyo', allDay: true }, '2026-10-16', null)).toBe('meeting');
    expect(summaryDateZone({ startAt: tokyoMidnight, timezone: 'Asia/Tokyo', allDay: true }, '2026-10-15', 'UTC')).toBeNull();
    expect(summaryDateZone({ startAt: tokyoMidnight, timezone: 'Asia/Tokyo', allDay: false }, '2026-10-15', null)).toBe('utc');
  });

  it('follows the Europe/London clock change (BST ends Sunday 2026-10-25 01:00Z)', () => {
    const london = (startAt: string) => ({ startAt, timezone: 'Europe/London', allDay: false });
    // Monday 2026-10-19 00:30 BST
    expect(summaryDateZone(london('2026-10-18T23:30:00.000Z'), '2026-10-19', 'Europe/London')).toBe('meeting');
    // Sunday 2026-10-25 00:30 BST, before the change
    expect(summaryDateZone(london('2026-10-24T23:30:00.000Z'), '2026-10-25', 'Europe/London')).toBe('meeting');
    expect(summaryDateZone(london('2026-10-24T23:30:00.000Z'), '2026-10-26', 'Europe/London')).toBeNull();
    // Monday 2026-10-26 00:30 GMT, after the change
    expect(summaryDateZone(london('2026-10-26T00:30:00.000Z'), '2026-10-26', 'Europe/London')).toBe('meeting');
    expect(summaryDateZone(london('2026-10-26T00:30:00.000Z'), '2026-10-25', 'Europe/London')).toBeNull();
    // The UTC fallback still admits the Sunday 00:30 BST start for a summary dated Saturday.
    expect(summaryDateZone(london('2026-10-24T23:30:00.000Z'), '2026-10-24', 'Europe/London')).toBe('utc');
  });

  it('handles the UTC+14 and UTC-12 edges', () => {
    const kiritimati = (startAt: string) => ({ startAt, timezone: 'Pacific/Kiritimati', allDay: false });
    expect(summaryDateZone(kiritimati('2026-10-15T18:00:00.000Z'), '2026-10-16', null)).toBe('meeting'); // 08:00 local
    expect(summaryDateZone(kiritimati('2026-10-16T09:59:00.000Z'), '2026-10-16', null)).toBe('meeting'); // 23:59 local
    expect(summaryDateZone(kiritimati('2026-10-15T18:00:00.000Z'), '2026-10-17', null)).toBeNull();

    const minus12 = (startAt: string) => ({ startAt, timezone: 'Etc/GMT+12', allDay: false });
    expect(summaryDateZone(minus12('2026-10-16T12:00:00.000Z'), '2026-10-16', null)).toBe('meeting'); // 00:00 local
    expect(summaryDateZone(minus12('2026-10-17T11:59:00.000Z'), '2026-10-16', null)).toBe('meeting'); // 23:59 local
    expect(summaryDateZone(minus12('2026-10-17T11:59:00.000Z'), '2026-10-15', null)).toBeNull();
  });
});

describe('conferenceLinkInText', () => {
  it('finds a Zoom link across regional subdomains, only at a boundary', () => {
    const url = 'https://us02web.zoom.us/j/81234567890?pwd=synthetic';
    expect(conferenceLinkInText(url, 'Join at https://zoom.us/j/81234567890 next time')).toBe(true);
    expect(conferenceLinkInText(url, 'Recording: https://us02web.zoom.us/j/81234567890?pwd=x')).toBe(true);
    expect(conferenceLinkInText(url, 'Other room: https://zoom.us/j/812345678901')).toBe(false);
  });

  it('finds a Google Meet code regardless of case', () => {
    expect(conferenceLinkInText('https://meet.google.com/abc-defg-hij', 'Link: MEET.GOOGLE.COM/ABC-DEFG-HIJ')).toBe(true);
    expect(conferenceLinkInText('https://meet.google.com/abc-defg-hij', 'Link: meet.google.com/abc-defg-hik')).toBe(false);
  });

  it('ignores missing, non-http and too-short links', () => {
    expect(conferenceLinkInText(null, 'zoom.us')).toBe(false);
    expect(conferenceLinkInText('javascript:alert(1)', 'javascript:alert(1)')).toBe(false);
    expect(conferenceLinkInText('https://zoom.us/', 'https://zoom.us/')).toBe(false);
  });
});

describe('trustInboxReason', () => {
  it('maps rows 8 to 10', () => {
    expect(trustInboxReason({ tier: 'vendor_verified', recipientBound: true, fresh: true })).toBeNull();
    expect(trustInboxReason({ tier: 'vendor_verified', recipientBound: true, fresh: false })).toBe('old_summary');
    expect(trustInboxReason({ tier: 'vendor_verified', recipientBound: false, fresh: true })).toBe('not_addressed_to_you');
    expect(trustInboxReason({ tier: 'user_forwarded', recipientBound: false, fresh: true })).toBe('user_forwarded');
  });
});

// ---------------------------------------------------------------------------------------------

describe('decide: the worked fixture', () => {
  it('files under the sync meeting: S 0.74 against 0.47', () => {
    const record = decide(input());
    expect(record.status).toBe('matched');
    expect(record.inboxReason).toBeNull();
    expect(record.outcome).toBe('confident');

    const sync = suggestion(record, 'm_sync');
    const marketing = suggestion(record, 'm_marketing');
    expect(sync).toMatchObject({ titleScore: 0.6, timeScore: 1, score: 0.74, zoneUsed: 'meeting' });
    expect(marketing.titleScore).toBe(0.6);
    expect(marketing.timeScore).toBeCloseTo(0.23, 2);
    expect(marketing.score).toBeCloseTo(0.47, 2);
    expect(ids(record)).toEqual(['m_sync', 'm_marketing']);

    expect(record.match).toEqual({
      meetingId: 'm_sync',
      occurrenceDate: null,
      duplicateMeetingIds: [],
      method: 'auto',
      score: 0.74,
      titleScore: 0.6,
      timeScore: 1,
      reasons: ['title_shared_word', 'time_close', 'date_meeting_zone', 'rule_a'],
      zoneUsed: 'meeting',
      matchedAt: NOW.toISOString(),
      meetingSnapshot: {
        title: 'Acmepay weekly sync',
        startAt: '2026-10-16T20:00:00.000Z',
        endAt: '2026-10-16T21:00:00.000Z',
        timezone: MX,
      },
    });
    expect(record.rejectedMeetingIds).toEqual([]);
    expect(record.groupCount).toBe(2);
  });

  it('without a signed time: 0.565 each, inbox ambiguous, both suggested', () => {
    // fresh with no anchor cannot happen in production (fresh needs a signed Date); it isolates M.
    const record = decide(input({ anchor: null }));
    expect(record.status).toBe('inbox');
    expect(record.inboxReason).toBe('ambiguous');
    expect(record.match).toBeNull();
    expect(record.candidates.map((c) => c.score)).toEqual([0.565, 0.565]);
    expect(ids(record).sort()).toEqual(['m_marketing', 'm_sync']);
  });

  it('never echoes the summary text or title line', () => {
    const serialized = JSON.stringify([decide(input()), decide(input({ anchor: null }))]);
    expect(serialized).not.toContain('launch readiness');
    expect(serialized).not.toContain('Synthetic recap');
    expect(serialized).not.toContain('owner: Pat');
  });
});

describe('decide: dates and zones', () => {
  const evening = (overrides: Partial<MatchCandidate> = {}) =>
    meeting({
      meetingId: 'm_evening',
      title: 'Acmepay evening review',
      startAt: '2026-10-17T03:30:00.000Z', // 2026-10-16 21:30 local
      endAt: '2026-10-17T04:30:00.000Z', // 22:30 local
      ...overrides,
    });

  it('files a 21:30 Mexico City meeting whose UTC date is the next day', () => {
    const record = decide(
      input({
        titleLine: 'Acmepay evening review',
        subjectClean: null,
        anchor: { at: '2026-10-17T04:40:00.000Z', signed: true }, // 22:40 local
        preferencesTimeZone: null,
        candidates: [evening()],
      }),
    );
    expect(record.status).toBe('matched');
    expect(record.match).toMatchObject({ meetingId: 'm_evening', score: 1, zoneUsed: 'meeting' });
  });

  it('keeps only the series occurrence on the summary date', () => {
    const record = decide(
      input({
        titleLine: 'Acmepay evening review',
        anchor: null,
        candidates: [
          evening({ occurrenceDate: '2026-10-16' }),
          evening({ occurrenceDate: '2026-10-17', startAt: '2026-10-18T03:30:00.000Z', endAt: '2026-10-18T04:30:00.000Z' }),
        ],
      }),
    );
    expect(record.groupCount).toBe(1);
    expect(record.candidates).toHaveLength(1);
    expect(record.candidates[0]).toMatchObject({ meetingId: 'm_evening', occurrenceDate: '2026-10-16', zoneUsed: 'meeting' });
    // A confident score without a signed time still asks the user.
    expect(record.status).toBe('inbox');
    expect(record.inboxReason).toBe('needs_confirmation');
  });

  it('falls back to the preferences zone, then to UTC, and records which one', () => {
    const base = input({ titleLine: 'Acmepay evening review', anchor: { at: '2026-10-17T04:40:00.000Z', signed: true } });
    const viaPreferences = decide({ ...base, candidates: [evening({ timezone: 'UTC' })] });
    expect(viaPreferences.match?.zoneUsed).toBe('preferences');
    expect(viaPreferences.match?.reasons).toContain('date_preferences_zone');

    expect(decide({ ...base, preferencesTimeZone: null, candidates: [evening({ timezone: 'UTC' })] }).inboxReason).toBe('no_candidate');

    const viaUtc = decide({
      ...base,
      titleLine: 'Acmepay weekly sync',
      anchor: { at: '2026-10-16T21:10:00.000Z', signed: true },
      preferencesTimeZone: 'Asia/Tokyo',
      candidates: [meeting({ timezone: 'Asia/Tokyo' })],
    });
    expect(viaUtc.match?.zoneUsed).toBe('utc');
  });

  it('matches across the Europe/London DST week', () => {
    const handover = (occurrenceDate: string, startAt: string, endAt: string) =>
      meeting({ meetingId: 'm_handover', occurrenceDate, title: 'Night desk handover', startAt, endAt, timezone: 'Europe/London' });
    const record = decide(
      input({
        titleLine: 'Night desk handover',
        subjectClean: null,
        summaryDate: '2026-10-25',
        preferencesTimeZone: 'Europe/London',
        anchor: { at: '2026-10-25T00:20:00.000Z', signed: true }, // 01:20 BST, before the change
        candidates: [
          handover('2026-10-19', '2026-10-18T23:30:00.000Z', '2026-10-19T00:00:00.000Z'), // Mon 00:30 BST
          handover('2026-10-25', '2026-10-24T23:30:00.000Z', '2026-10-25T00:00:00.000Z'), // Sun 00:30 BST
          handover('2026-10-26', '2026-10-26T00:30:00.000Z', '2026-10-26T01:00:00.000Z'), // Mon 00:30 GMT
        ],
      }),
    );
    expect(record.groupCount).toBe(1);
    expect(record.status).toBe('matched');
    expect(record.match).toMatchObject({ meetingId: 'm_handover', occurrenceDate: '2026-10-25', zoneUsed: 'meeting', timeScore: 1 });
  });

  it('matches at UTC+14 and UTC-12', () => {
    const reef = meeting({
      meetingId: 'm_reef',
      title: 'Reef survey briefing',
      timezone: 'Pacific/Kiritimati',
      startAt: '2026-10-15T18:00:00.000Z', // 2026-10-16 08:00 local
      endAt: '2026-10-15T19:00:00.000Z',
    });
    const base = input({ titleLine: 'Reef survey briefing', subjectClean: null, preferencesTimeZone: null });
    const plus14 = decide({ ...base, anchor: { at: '2026-10-15T19:20:00.000Z', signed: true }, candidates: [reef] });
    expect(plus14.match).toMatchObject({ meetingId: 'm_reef', zoneUsed: 'meeting', score: 1 });
    expect(decide({ ...base, summaryDate: '2026-10-17', anchor: null, candidates: [reef] }).inboxReason).toBe('no_candidate');

    const buoy = meeting({
      meetingId: 'm_buoy',
      title: 'Buoy maintenance',
      timezone: 'Etc/GMT+12',
      startAt: '2026-10-17T08:00:00.000Z', // 2026-10-16 20:00 local
      endAt: '2026-10-17T09:00:00.000Z',
    });
    const minus12 = decide({
      ...base,
      titleLine: 'Buoy maintenance',
      anchor: { at: '2026-10-17T09:10:00.000Z', signed: true },
      candidates: [buoy],
    });
    expect(minus12.match).toMatchObject({ meetingId: 'm_buoy', zoneUsed: 'meeting', score: 1 });
  });

  it('works from the anchor alone when the summary has no date', () => {
    const record = decide(input({ summaryDate: null }));
    expect(record.status).toBe('matched');
    expect(record.match).toMatchObject({ meetingId: 'm_sync', zoneUsed: null });
  });
});

describe('decide: duplicates', () => {
  const outlook = meeting({ meetingId: 'out_1', source: 'outlook' });
  const device = meeting({
    meetingId: 'dev_1',
    source: 'device',
    title: 'ACMEPAY Weekly Sync',
    startAt: '2026-10-16T20:02:00.000Z',
    endAt: '2026-10-16T21:02:00.000Z',
  });

  it('groups an Outlook import and its phone-calendar copy under the Outlook meeting', () => {
    const record = decide(input({ titleLine: 'Acmepay weekly sync', candidates: [device, outlook] }));
    expect(record.groupCount).toBe(1);
    expect(record.status).toBe('matched');
    expect(record.match).toMatchObject({ meetingId: 'out_1', duplicateMeetingIds: ['dev_1'] });
    expect(record.match?.reasons).toContain('duplicates_grouped');
    expect(record.candidates).toHaveLength(1);
  });

  it('prefers google over device as the representative', () => {
    const record = decide(input({ titleLine: 'Acmepay weekly sync', candidates: [device, meeting({ meetingId: 'g_1' })] }));
    expect(record.match).toMatchObject({ meetingId: 'g_1', duplicateMeetingIds: ['dev_1'] });
  });

  it('does not group starts 6 minutes apart or different durations', () => {
    const late = { ...device, startAt: '2026-10-16T20:06:00.000Z', endAt: '2026-10-16T21:06:00.000Z' };
    const longer = { ...device, endAt: '2026-10-16T21:32:00.000Z' };
    for (const other of [late, longer]) {
      const record = decide(input({ titleLine: 'Acmepay weekly sync', candidates: [outlook, other] }));
      expect(record.groupCount).toBe(2);
      expect(record.inboxReason).toBe('ambiguous');
      expect(ids(record).sort()).toEqual(['dev_1', 'out_1']);
    }
  });

  it('drops the whole group when any copy was rejected', () => {
    const record = decide(input({ titleLine: 'Acmepay weekly sync', candidates: [outlook, device], rejectedMeetingIds: ['dev_1', 'dev_1'] }));
    expect(record.inboxReason).toBe('no_candidate');
    expect(record.candidates).toEqual([]);
    expect(record.rejectedMeetingIds).toEqual(['dev_1']);
  });
});

describe('decide: cancelled and all-day are suggestions only', () => {
  it('never files a cancelled meeting, even a perfect one', () => {
    const record = decide(input({ titleLine: 'Acmepay weekly sync', candidates: [meeting({ cancelled: true })] }));
    expect(record.status).toBe('inbox');
    expect(record.inboxReason).toBe('needs_confirmation');
    expect(record.match).toBeNull();
    expect(record.candidates[0]).toMatchObject({ meetingId: 'm_sync', cancelled: true, score: 1 });
    expect(record.candidates[0]?.reasons).toContain('cancelled');
  });

  it('never files an all-day meeting', () => {
    const allDay = meeting({
      meetingId: 'm_offsite',
      title: 'Acmepay offsite',
      allDay: true,
      startAt: '2026-10-16T06:00:00.000Z', // 2026-10-16 00:00 local
      endAt: '2026-10-17T06:00:00.000Z',
    });
    const record = decide(input({ titleLine: 'Acmepay offsite', candidates: [allDay] }));
    expect(record.status).toBe('inbox');
    expect(record.inboxReason).toBe('needs_confirmation');
    expect(record.candidates[0]).toMatchObject({ meetingId: 'm_offsite', allDay: true, timeScore: 0.6, score: 0.86 });
  });

  it('treats a group with one cancelled copy as cancelled', () => {
    const record = decide(
      input({
        titleLine: 'Acmepay weekly sync',
        candidates: [meeting({ meetingId: 'out_1', source: 'outlook' }), meeting({ meetingId: 'dev_1', source: 'device', cancelled: true })],
      }),
    );
    expect(record.status).toBe('inbox');
    expect(record.candidates[0]).toMatchObject({ meetingId: 'out_1', cancelled: true, duplicateMeetingIds: ['dev_1'] });
  });

  it('suggests a cancelled best meeting first, ahead of a weaker live one', () => {
    const record = decide(input({ candidates: [meeting({ cancelled: true }), MARKETING] }));
    expect(record.status).toBe('inbox');
    expect(record.inboxReason).toBe('needs_confirmation');
    expect(ids(record)).toEqual(['m_sync', 'm_marketing']);
  });
});

describe('decide: rule B goes to the inbox', () => {
  const lateAnchor = { at: '2026-10-17T00:30:00.000Z', signed: true }; // 3.5 hours after the end: M 0.5

  it('puts the only meeting of the day first and does not file', () => {
    const record = decide(input({ anchor: lateAnchor, candidates: [meeting()] }));
    expect(record.candidates[0]).toMatchObject({ meetingId: 'm_sync', titleScore: 0.6, timeScore: 0.5, score: 0.565 });
    expect(record.status).toBe('inbox');
    expect(record.inboxReason).toBe('needs_confirmation');
    expect(record.match).toBeNull();
  });

  it('needs exactly one candidate that day', () => {
    const dentist = meeting({
      meetingId: 'm_dentist',
      title: 'Dentist appointment',
      startAt: '2026-10-16T14:00:00.000Z', // 08:00 local
      endAt: '2026-10-16T14:30:00.000Z',
    });
    const record = decide(input({ anchor: lateAnchor, candidates: [meeting(), dentist] }));
    expect(record.groupCount).toBe(2);
    expect(record.inboxReason).toBe('weak');
    expect(ids(record)).toEqual(['m_sync']);
  });
});

describe('decide: trust tiers (rows 8 to 10)', () => {
  const perfect = { titleLine: 'Acmepay weekly sync', candidates: [meeting()] };

  it('never auto-files a user_forwarded summary, signed time or not', () => {
    for (const anchor of [
      { at: '2026-10-16T21:20:00.000Z', signed: false },
      { at: '2026-10-16T21:20:00.000Z', signed: true },
    ]) {
      const record = decide(input({ ...perfect, tier: 'user_forwarded', recipientBound: false, anchor }));
      expect(record.outcome).toBe('confident');
      expect(record.status).toBe('inbox');
      expect(record.inboxReason).toBe('user_forwarded');
      expect(record.match).toBeNull();
      expect(ids(record)).toEqual(['m_sync']);
    }
    const unsigned = decide(input({ ...perfect, tier: 'user_forwarded', anchor: { at: '2026-10-16T21:20:00.000Z', signed: false } }));
    expect(unsigned.candidates[0]?.timeScore).toBe(0.8);
    expect(unsigned.candidates[0]?.score).toBe(0.93);
  });

  it('gives not_addressed_to_you no suggestions', () => {
    const record = decide(input({ ...perfect, recipientBound: false }));
    expect(record.status).toBe('inbox');
    expect(record.inboxReason).toBe('not_addressed_to_you');
    expect(record.candidates).toEqual([]);
    expect(record.match).toBeNull();
  });

  it('holds a stale vendor recap as old_summary with suggestions', () => {
    const record = decide(input({ ...perfect, fresh: false }));
    expect(record.status).toBe('inbox');
    expect(record.inboxReason).toBe('old_summary');
    expect(ids(record)).toEqual(['m_sync']);
  });
});

describe('decide: gates and empty outcomes', () => {
  it('gives no_date with no summary date and no anchor, and scores nothing', () => {
    const record = decide(input({ summaryDate: null, anchor: null }));
    expect(record).toMatchObject({ status: 'inbox', inboxReason: 'no_date', outcome: 'no_date', candidates: [], groupCount: 0 });
    expect(decide(input({ summaryDate: 'not-a-date', anchor: null })).inboxReason).toBe('no_date');
    expect(decide(input({ tier: 'user_forwarded', summaryDate: null, anchor: null })).inboxReason).toBe('user_forwarded');
  });

  it('gives no_candidate when nothing survives the gates', () => {
    expect(decide(input({ candidates: [] })).inboxReason).toBe('no_candidate');
    expect(decide(input({ candidates: [meeting({ deleted: true })] })).inboxReason).toBe('no_candidate');
  });

  it('drops meetings starting at or after the signed anchor plus 15 minutes', () => {
    const at = (startAt: string) => meeting({ title: 'Acmepay weekly sync', startAt, endAt: '2026-10-16T22:30:00.000Z' });
    const base = input({ titleLine: 'Acmepay weekly sync' }); // anchor 21:20Z
    expect(decide({ ...base, candidates: [at('2026-10-16T21:35:00.000Z')] }).groupCount).toBe(0);
    expect(decide({ ...base, candidates: [at('2026-10-16T21:34:00.000Z')] }).groupCount).toBe(1);
    // Unsigned anchors do not gate; the time score says "before the meeting began".
    const unsigned = decide({ ...base, tier: 'user_forwarded', anchor: { at: '2026-10-16T21:20:00.000Z', signed: false }, candidates: [at('2026-10-16T21:35:00.000Z')] });
    expect(unsigned.candidates[0]).toMatchObject({ timeScore: 0 });
    expect(unsigned.candidates[0]?.reasons).toContain('time_before_start');
  });

  it('is weak when the best meeting has no title in common', () => {
    const record = decide(input({ titleLine: 'Budget forecast', subjectClean: null, candidates: [meeting()] }));
    expect(record.inboxReason).toBe('weak');
    expect(record.candidates[0]).toMatchObject({ titleScore: 0, timeScore: 1, score: 0.35 });
  });

  it('drops a rejected meeting and decides on what is left', () => {
    const record = decide(input({ rejectedMeetingIds: ['m_sync'] }));
    expect(record.status).toBe('inbox');
    expect(record.inboxReason).toBe('weak');
    expect(ids(record)).toEqual(['m_marketing']);
    expect(record.rejectedMeetingIds).toEqual(['m_sync']);
  });

  it('suggests at most 3 groups with S at least 0.20', () => {
    const many = ['a', 'b', 'c', 'd'].map((id, i) =>
      meeting({ meetingId: `m_${id}`, title: `Acmepay topic ${id}`, startAt: `2026-10-16T1${i}:00:00.000Z`, endAt: `2026-10-16T1${i}:30:00.000Z` }),
    );
    const record = decide(input({ anchor: null, candidates: [...many, meeting({ meetingId: 'm_other', title: 'Dentist' })] }));
    expect(record.groupCount).toBe(5);
    expect(record.candidates).toHaveLength(3);
    expect(record.candidates.every((c) => c.score >= 0.2)).toBe(true);
    expect(ids(record)).not.toContain('m_other');
  });

  it('skips malformed candidates and invalid zones without throwing', () => {
    const record = decide(
      input({
        preferencesTimeZone: 'Bad/Zone',
        candidates: [
          meeting({ meetingId: 'bad/id' }),
          meeting({ meetingId: 'm_bad_time', startAt: 'yesterday' }),
          meeting({
            meetingId: 'm_bad_zone',
            title: 'Acmepay hiring',
            timezone: 'Not/A_Zone',
            startAt: '2026-10-16T19:00:00.000Z',
            endAt: '2026-10-16T19:30:00.000Z',
          }),
          meeting(),
        ],
      }),
    );
    expect(ids(record)).toContain('m_sync');
    expect(ids(record)).not.toContain('bad/id');
    expect(ids(record)).not.toContain('m_bad_time');
    // Invalid meeting zone: the UTC date of 20:00Z is still the 16th.
    expect(record.candidates.find((c) => c.meetingId === 'm_bad_zone')?.zoneUsed).toBe('utc');
  });
});

describe('decide: conference link bonus', () => {
  const zoom = 'https://us02web.zoom.us/j/81234567890?pwd=synthetic';
  const text = 'Synthetic recap. Recording: https://zoom.us/j/81234567890';

  it('adds 0.15 for the meeting whose link is in the text; a gap of exactly 0.15 is still a tie', () => {
    const record = decide(input({ anchor: null, text, candidates: [meeting({ conferenceUrl: zoom }), MARKETING] }));
    expect(suggestion(record, 'm_sync').score).toBe(0.715);
    expect(suggestion(record, 'm_sync').reasons).toContain('conference_link');
    expect(suggestion(record, 'm_marketing').score).toBe(0.565);
    expect(record.inboxReason).toBe('ambiguous');
  });

  it('caps S at 1', () => {
    const record = decide(input({ titleLine: 'Acmepay weekly sync', text, candidates: [meeting({ conferenceUrl: zoom })] }));
    expect(record.match?.score).toBe(1);
  });
});

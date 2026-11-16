/**
 * The task an accepted suggestion becomes (functions/src/commitments/taskDoc.ts; docs/v2/M11-DESIGN.md
 * decision 5, section 3.4; findings 11, 18, 19 and 29): existing fields only, the zone order, the
 * reminder defaults across zones and DST, the meeting link and the origin line. Synthetic data.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  COMMITMENT_TASK_KEYS,
  buildCommitmentTaskDoc,
  chooseTaskZone,
  commitmentOriginLine,
  defaultSchedule,
  taskMeetingIdOf,
  taskTitleFor,
  type CommitmentTaskInput,
} from '../../src/commitments/taskDoc';
import { aiTaskContextDocSchema } from '../../src/shared/aiContract';

const NOW = new Date('2026-10-15T15:00:00.000Z');

function input(overrides: Partial<CommitmentTaskInput> = {}): CommitmentTaskInput {
  return {
    uid: 'uidDana01',
    title: 'Bish: Provide APK access/files to Urpayroll',
    description: "From your notetaker's summary of Urpayroll weekly sync (Oct 16, 2026). Suggested by Meeting Guard AI, added by you.",
    dueDate: '2026-10-16',
    dueTime: '09:00',
    timezone: 'America/Mexico_City',
    reminderMinutesBefore: 0,
    meetingId: 'mtgUrpayrollSync01',
    owner: { name: 'Bish', isUser: false },
    now: NOW,
    ...overrides,
  };
}

/** The hasOnly list of firestore.rules isValidTask, read from the rules file itself. */
function rulesTaskKeys(): string[] {
  const rules = readFileSync(join(__dirname, '..', '..', '..', 'firestore.rules'), 'utf8');
  const start = rules.indexOf('function isValidTask(');
  const hasOnly = /keys\(\)\.hasOnly\(\[([^\]]+)\]\)/.exec(rules.slice(start));
  if (hasOnly?.[1] === undefined) throw new Error('isValidTask hasOnly not found');
  return [...hasOnly[1].matchAll(/'([A-Za-z]+)'/g)].map((m) => m[1] ?? '');
}

describe('buildCommitmentTaskDoc', () => {
  it('writes exactly the existing task fields: source ai_chat, pushPending true, the owner in people with no email', () => {
    const result = buildCommitmentTaskDoc(input());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.doc).toEqual({
      userId: 'uidDana01',
      title: 'Bish: Provide APK access/files to Urpayroll',
      description: "From your notetaker's summary of Urpayroll weekly sync (Oct 16, 2026). Suggested by Meeting Guard AI, added by you.",
      dueDate: '2026-10-16',
      dueTime: '09:00',
      timezone: 'America/Mexico_City',
      reminderMinutesBefore: 0,
      status: 'open',
      meetingId: 'mtgUrpayrollSync01',
      people: [{ name: 'Bish', email: null }],
      completedAt: null,
      source: 'ai_chat',
      pushPending: true,
      createdAt: '2026-10-15T15:00:00.000Z',
      updatedAt: '2026-10-15T15:00:00.000Z',
    });
    expect(Object.keys(result.doc).sort()).toEqual([...COMMITMENT_TASK_KEYS].sort());
    // Every key is one firestore.rules allows; the required ones are there.
    const allowed = rulesTaskKeys();
    for (const key of Object.keys(result.doc)) expect(allowed).toContain(key);
    for (const key of ['userId', 'title', 'timezone', 'status', 'createdAt', 'updatedAt']) expect(Object.keys(result.doc)).toContain(key);
    // The source is one of the five the 1.6.0 app knows.
    expect(['manual', 'ai_chat', 'whatsapp', 'todo', 'gtasks']).toContain(result.doc.source);
    // The app's lenient task reader takes it as it is.
    expect(aiTaskContextDocSchema.parse(result.doc)).toMatchObject({ title: result.doc.title, people: [{ name: 'Bish', email: null }] });
  });

  it('no people entry for the user or for nobody; a meeting link may be null', () => {
    for (const owner of [{ name: 'Dana Lee', isUser: true }, null]) {
      const result = buildCommitmentTaskDoc(input({ owner, meetingId: null }));
      expect(result.ok && result.doc.people).toEqual([]);
      expect(result.ok && result.doc.meetingId).toBeNull();
    }
  });

  it('refuses a broken task: invariants, sizes, zone, uid, owner', () => {
    const cases: [Partial<CommitmentTaskInput>, string][] = [
      [{ dueDate: null, dueTime: '09:00' }, 'invalid_task'],
      [{ dueTime: null, reminderMinutesBefore: 0 }, 'invalid_task'],
      [{ title: '' }, 'invalid_task'],
      [{ title: '   ' }, 'invalid_task'],
      [{ title: 'x'.repeat(201) }, 'invalid_task'],
      [{ description: 'x'.repeat(4001) }, 'invalid_task'],
      [{ reminderMinutesBefore: 10_081 }, 'invalid_task'],
      [{ meetingId: 'bad/id' }, 'invalid_task'],
      [{ dueDate: '2026-02-30' }, 'invalid_task'],
      [{ timezone: 'Mars/Olympus' }, 'invalid_zone'],
      [{ uid: 'a/b' }, 'invalid_uid'],
      [{ owner: { name: 'x'.repeat(101), isUser: false } }, 'invalid_owner'],
      [{ owner: { name: '  ', isUser: false } }, 'invalid_owner'],
    ];
    for (const [overrides, reason] of cases) expect(buildCommitmentTaskDoc(input(overrides))).toEqual({ ok: false, reason });
  });

  it('takes a title the user edited as typed (phone number included), within 200', () => {
    expect(taskTitleFor('Bish: Call the bank', 'Call the bank at 555 123 4567')).toBe('Call the bank at 555 123 4567');
    expect(taskTitleFor('Bish: Call the bank', '   ')).toBe('Bish: Call the bank');
    expect(taskTitleFor('Bish: Call the bank', null)).toBe('Bish: Call the bank');
    expect(taskTitleFor('t', 'y'.repeat(250))).toHaveLength(200);
    const result = buildCommitmentTaskDoc(input({ title: taskTitleFor('Bish: Call the bank', 'Call the bank at 555 123 4567') }));
    expect(result.ok && result.doc.title).toBe('Call the bank at 555 123 4567');
  });
});

describe('taskMeetingIdOf', () => {
  it('links the match (the master id for a series) while the meeting exists and is no tombstone', () => {
    expect(taskMeetingIdOf('mtgSeries01', { title: 'Weekly', recurrence: { freq: 'weekly' }, deletedAt: null, status: 'scheduled' })).toBe('mtgSeries01');
    expect(taskMeetingIdOf('mtgA', { status: 'cancelled' })).toBe('mtgA');
    expect(taskMeetingIdOf('mtgA', null)).toBeNull();
    expect(taskMeetingIdOf('mtgA', undefined)).toBeNull();
    expect(taskMeetingIdOf('mtgA', { deletedAt: '2026-10-01T00:00:00.000Z' })).toBeNull();
    expect(taskMeetingIdOf('mtgA', { status: 'deleted' })).toBeNull();
    expect(taskMeetingIdOf(null, { title: 'x' })).toBeNull();
    expect(taskMeetingIdOf('bad/id', { title: 'x' })).toBeNull();
  });
});

describe('chooseTaskZone (findings 11 and 19)', () => {
  const base = { channel: 'app' as const, statedTime: false, meetingZone: 'Europe/Madrid', requestZone: 'America/Mexico_City', preferencesZone: 'America/Bogota' };

  it('a stated time keeps the meeting\'s zone; otherwise the app\'s device zone', () => {
    expect(chooseTaskZone({ ...base, statedTime: true })).toEqual({ zone: 'Europe/Madrid', source: 'meeting' });
    expect(chooseTaskZone(base)).toEqual({ zone: 'America/Mexico_City', source: 'request' });
    expect(chooseTaskZone({ ...base, requestZone: 'Nowhere/Land' })).toEqual({ zone: 'America/Bogota', source: 'preferences' });
    expect(chooseTaskZone({ ...base, statedTime: true, meetingZone: 'Nowhere/Land' })).toEqual({ zone: 'America/Mexico_City', source: 'request' });
  });

  it('WhatsApp: the preferences zone only when set and not UTC, else the meeting\'s, else none (never 9:00 UTC)', () => {
    const wa = { ...base, channel: 'whatsapp' as const, requestZone: null };
    expect(chooseTaskZone(wa)).toEqual({ zone: 'America/Bogota', source: 'preferences' });
    expect(chooseTaskZone({ ...wa, preferencesZone: 'UTC' })).toEqual({ zone: 'Europe/Madrid', source: 'meeting' });
    expect(chooseTaskZone({ ...wa, preferencesZone: 'Etc/UTC' })).toEqual({ zone: 'Europe/Madrid', source: 'meeting' });
    expect(chooseTaskZone({ ...wa, preferencesZone: null })).toEqual({ zone: 'Europe/Madrid', source: 'meeting' });
    expect(chooseTaskZone({ ...wa, preferencesZone: null, meetingZone: null })).toEqual({ zone: null, source: 'none' });
  });
});

describe('defaultSchedule (decision 11, finding 18)', () => {
  it('no date: tomorrow 9:00 in the task zone, reminder at the time', () => {
    expect(defaultSchedule({ due: null, zone: 'America/Mexico_City', now: NOW })).toEqual({
      dueDate: '2026-10-16',
      dueTime: '09:00',
      reminderMinutesBefore: 0,
      overdue: false,
      source: 'default',
    });
  });

  it('"tomorrow" at 23:30 in Mexico City (05:30 UTC the next day) is still one local day ahead, not two', () => {
    const late = new Date('2026-11-13T05:30:00.000Z');
    expect(defaultSchedule({ due: null, zone: 'America/Mexico_City', now: late }).dueDate).toBe('2026-11-13');
    expect(defaultSchedule({ due: null, zone: 'UTC', now: late }).dueDate).toBe('2026-11-14');
  });

  it('a stated date and time: 60 minutes before; at the time when less than an hour is left; none once it passed', () => {
    const due = { date: '2026-10-16', time: '17:00' };
    expect(defaultSchedule({ due, zone: 'Europe/Madrid', now: NOW })).toMatchObject({ dueDate: '2026-10-16', dueTime: '17:00', reminderMinutesBefore: 60, source: 'summary' });
    const soon = new Date('2026-10-16T14:30:00.000Z'); // 16:30 in Madrid
    expect(defaultSchedule({ due, zone: 'Europe/Madrid', now: soon }).reminderMinutesBefore).toBe(0);
    const after = new Date('2026-10-16T15:30:00.000Z'); // 17:30 in Madrid, the same day
    expect(defaultSchedule({ due, zone: 'Europe/Madrid', now: after })).toMatchObject({ dueTime: '17:00', reminderMinutesBefore: null, overdue: false });
  });

  it('a stated date only: 9:00 that day at the time; a stated date already past: kept, overdue, no reminder', () => {
    expect(defaultSchedule({ due: { date: '2026-10-20', time: null }, zone: 'America/Mexico_City', now: NOW })).toEqual({
      dueDate: '2026-10-20',
      dueTime: '09:00',
      reminderMinutesBefore: 0,
      overdue: false,
      source: 'summary',
    });
    expect(defaultSchedule({ due: { date: '2026-10-14', time: '17:00' }, zone: 'America/Mexico_City', now: NOW })).toEqual({
      dueDate: '2026-10-14',
      dueTime: '17:00',
      reminderMinutesBefore: null,
      overdue: true,
      source: 'summary',
    });
    // Today, after 9:00: the date only, no reminder in the past.
    expect(defaultSchedule({ due: { date: '2026-10-15', time: null }, zone: 'America/Mexico_City', now: NOW })).toEqual({
      dueDate: '2026-10-15',
      dueTime: null,
      reminderMinutesBefore: null,
      overdue: false,
      source: 'summary',
    });
  });

  it('without any zone: a stated date kept, no time and no reminder; no date: nothing', () => {
    expect(defaultSchedule({ due: { date: '2026-10-20', time: '17:00' }, zone: null, now: NOW })).toEqual({
      dueDate: '2026-10-20',
      dueTime: null,
      reminderMinutesBefore: null,
      overdue: false,
      source: 'summary',
    });
    expect(defaultSchedule({ due: null, zone: null, now: NOW })).toEqual({ dueDate: null, dueTime: null, reminderMinutesBefore: null, overdue: false, source: 'none' });
  });

  it('keeps the local values across a DST change (New York, Sunday 2026-11-01)', () => {
    const saturdayEvening = new Date('2026-10-31T23:00:00.000Z'); // 19:00 EDT
    expect(defaultSchedule({ due: null, zone: 'America/New_York', now: saturdayEvening })).toMatchObject({ dueDate: '2026-11-01', dueTime: '09:00', reminderMinutesBefore: 0 });
    // 09:00 EST on the change day is 14:00 UTC: 60 minutes before it is still ahead at 13:30 UTC.
    const morning = new Date('2026-11-01T12:30:00.000Z');
    expect(defaultSchedule({ due: { date: '2026-11-01', time: '09:00' }, zone: 'America/New_York', now: morning }).reminderMinutesBefore).toBe(60);
    // Spring forward (Sunday 2026-03-08): the 9:00 default exists and is kept.
    expect(defaultSchedule({ due: null, zone: 'America/New_York', now: new Date('2026-03-07T23:00:00.000Z') })).toMatchObject({ dueDate: '2026-03-08', dueTime: '09:00' });
  });
});

describe('commitmentOriginLine (section 11): where it came from, never summary text', () => {
  it('EN and ES, AI and as written, filed and kept, with and without a date', () => {
    expect(commitmentOriginLine({ language: 'en', mode: 'ai', meetingTitle: 'Urpayroll weekly sync', date: '2026-10-16' })).toBe(
      "From your notetaker's summary of Urpayroll weekly sync (Oct 16, 2026). Suggested by Meeting Guard AI, added by you.",
    );
    expect(commitmentOriginLine({ language: 'en', mode: 'as_written', meetingTitle: 'Urpayroll weekly sync', date: '2026-10-16' })).toBe(
      "From the action items of your notetaker's summary of Urpayroll weekly sync (Oct 16, 2026). Added by you.",
    );
    expect(commitmentOriginLine({ language: 'en', mode: 'ai', meetingTitle: null, date: '2026-10-16' })).toBe(
      'From a notetaker summary dated Oct 16, 2026. Suggested by Meeting Guard AI, added by you.',
    );
    expect(commitmentOriginLine({ language: 'en', mode: 'ai', meetingTitle: null, date: null })).toBe('From a notetaker summary. Suggested by Meeting Guard AI, added by you.');
    expect(commitmentOriginLine({ language: 'es', mode: 'ai', meetingTitle: 'Sincronización semanal', date: '2026-10-16' })).toBe(
      'De la minuta de tu asistente de notas sobre Sincronización semanal (16 oct 2026). Sugerida por Meeting Guard AI, agregada por ti.',
    );
    expect(commitmentOriginLine({ language: 'es-MX', mode: 'as_written', meetingTitle: null, date: '2026-10-16' })).toBe(
      'De las tareas de una minuta de tu asistente de notas con fecha 16 oct 2026. Agregada por ti.',
    );
    // Any other language reads English until M12.
    expect(commitmentOriginLine({ language: 'pt', mode: 'ai', meetingTitle: 'Sync', date: null })).toBe(
      "From your notetaker's summary of Sync. Suggested by Meeting Guard AI, added by you.",
    );
  });

  it('cuts a long meeting title, keeps it on one line, and fits the 4,000-character description', () => {
    const line = commitmentOriginLine({ language: 'en', mode: 'ai', meetingTitle: `Weekly\n${'x'.repeat(600)}`, date: '2026-10-16' });
    expect(line).not.toContain('\n');
    expect(line.length).toBeLessThan(400);
    expect(buildCommitmentTaskDoc(input({ description: line })).ok).toBe(true);
  });
});

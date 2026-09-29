import { NOW, makeMeeting, minutesFrom, textDeps, translator } from '../__fixtures__/alertFixtures';
import {
  cleanText,
  extractContentData,
  fnv1a32,
  leadText,
  meetingJoinUrl,
  meetingLocationText,
  parseAlertData,
  parseRefillData,
  renderAlertSpec,
  renderRefillSpec,
  renderSnoozeSpec,
  summarizeMeeting,
  summaryFromAlertData,
} from '../content';

function alertInput(meetingId: string, offset: number, startAt: string) {
  return {
    identifier: `mg:${meetingId}:${offset}`,
    kind: 'alert' as const,
    meetingId,
    offsetMinutes: offset,
    fireAt: new Date(Date.parse(startAt) - offset * 60_000).toISOString(),
    intensity: 'max' as const,
  };
}

describe('renderAlertSpec', () => {
  const startAt = minutesFrom(NOW, 90);
  const meeting = makeMeeting('m1', startAt, {
    title: '  Weekly   sync  ',
    location: { type: 'physical', address: 'Room 4', virtualUrl: null },
  });

  it('renders localized English text, payload and platform hints', () => {
    const deps = textDeps('en');
    const spec = renderAlertSpec(alertInput('m1', 15, startAt), summarizeMeeting(meeting, deps.t), deps);
    expect(spec.title).toBe('Weekly sync starts in 15 minutes');
    expect(spec.body).toBe('13:30 · Room 4');
    expect(spec).toMatchObject({
      identifier: 'mg:m1:15',
      channelId: 'mg-alert-max-v2',
      categoryId: 'mg-alert',
      sound: 'meeting_alarm.wav',
      interruptionLevel: 'timeSensitive',
      androidPriority: 'max',
      sticky: true,
    });
    expect(spec.data).toMatchObject({
      v: 1,
      kind: 'alert',
      meetingId: 'm1',
      offsetMinutes: 15,
      intensity: 'max',
      startAt,
      url: 'meetingguardai://meeting/m1',
      fireAt: spec.fireAt,
      title: 'Weekly sync',
      language: 'en',
      durationMinutes: 60,
    });
    expect(spec.data.hash).toMatch(/^[0-9a-f]{8}$/);
  });

  it('renders natural Spanish text', () => {
    const deps = textDeps('es');
    const summary = summarizeMeeting(meeting, deps.t);
    expect(renderAlertSpec(alertInput('m1', 15, startAt), summary, deps).title).toBe('Weekly sync empieza en 15 minutos');
    expect(renderAlertSpec(alertInput('m1', 60, startAt), summary, deps).title).toBe('Weekly sync empieza en 1 hora');
    expect(renderAlertSpec(alertInput('m1', 0, startAt), summary, deps).title).toBe('Weekly sync empieza ahora');
  });

  it('uses hours / days / singular forms for the lead time', () => {
    const t = translator('en');
    expect(leadText(1, t)).toBe('in 1 minute');
    expect(leadText(90, t)).toBe('in 90 minutes');
    expect(leadText(120, t)).toBe('in 2 hours');
    expect(leadText(1440, t)).toBe('in 1 day');
  });

  it('renders follow-ups on their own channel/category with the assistant deep link', () => {
    const deps = textDeps('en');
    const spec = renderAlertSpec(
      {
        identifier: 'mg:m1:followup',
        kind: 'followup',
        meetingId: 'm1',
        offsetMinutes: null,
        fireAt: minutesFrom(NOW, 155),
        intensity: 'max',
      },
      summarizeMeeting(meeting, deps.t),
      deps,
    );
    expect(spec.title).toBe('How did “Weekly sync” go?');
    expect(spec.body).toBe('Capture notes, decisions and next steps with your AI assistant.');
    expect(spec).toMatchObject({
      channelId: 'mg-followup-v2',
      categoryId: 'mg-followup',
      sound: 'default',
      sticky: false,
      androidPriority: 'default',
    });
    expect(spec.data.url).toBe('meetingguardai://assistant?followup=m1');
    expect(spec.data.offsetMinutes).toBeNull();
  });

  it('renders snoozes relative to the meeting start (before and after it started)', () => {
    const deps = textDeps('en');
    const summary = summarizeMeeting(meeting, deps.t);
    const before = renderSnoozeSpec(summary, 'medium', minutesFrom(NOW, 80), deps);
    expect(before.identifier).toBe('mg:m1:snooze');
    expect(before.title).toBe('Reminder: Weekly sync starts in 10 minutes');
    expect(before.channelId).toBe('mg-alert-medium-v2');
    expect(before.sound).toBe('meeting_chime.wav');
    // MEDIUM is "minimizable, not dismissible": it cannot be swiped away either.
    expect(before.sticky).toBe(true);
    expect(renderSnoozeSpec(summary, 'light', minutesFrom(NOW, 80), deps).sticky).toBe(false);
    const after = renderSnoozeSpec(summary, 'max', minutesFrom(NOW, 95), deps);
    expect(after.title).toBe('Weekly sync has started');
  });

  it('never renders objects into the text', () => {
    const deps = textDeps('en');
    const virtualMeeting = makeMeeting('v1', startAt, {
      conference: { provider: 'google_meet', url: 'https://meet.google.com/abc-defg-hij', password: null },
    });
    const spec = renderAlertSpec(alertInput('v1', 5, startAt), summarizeMeeting(virtualMeeting, deps.t), deps);
    expect(spec.body).toBe('13:30 · Google Meet');
    expect(`${spec.title} ${spec.body}`).not.toMatch(/\[object Object\]|undefined|null/);
  });

  it('changes the hash when anything visible changes', () => {
    const summary = summarizeMeeting(meeting, translator('en'));
    const base = renderAlertSpec(alertInput('m1', 15, startAt), summary, textDeps('en')).data.hash;
    expect(renderAlertSpec(alertInput('m1', 15, startAt), summary, textDeps('en')).data.hash).toBe(base);
    expect(renderAlertSpec(alertInput('m1', 15, startAt), summary, textDeps('es')).data.hash).not.toBe(base);
    expect(
      renderAlertSpec(alertInput('m1', 15, startAt), { ...summary, title: 'Renamed' }, textDeps('en')).data.hash,
    ).not.toBe(base);
    const moved = minutesFrom(NOW, 100);
    expect(renderAlertSpec(alertInput('m1', 15, moved), { ...summary, startAt: moved }, textDeps('en')).data.hash).not.toBe(base);
    expect(
      renderAlertSpec(alertInput('m1', 15, startAt), summary, { ...textDeps('en'), vibrationEnabled: false }).data.hash,
    ).not.toBe(base);
  });

  it('uses the no-vibration channel and no pattern when vibration is off', () => {
    const deps = { ...textDeps('en'), vibrationEnabled: false };
    const spec = renderAlertSpec(alertInput('m1', 15, startAt), summarizeMeeting(meeting, deps.t), deps);
    expect(spec.channelId).toBe('mg-alert-max-novib-v2');
    expect(spec.vibrate).toEqual([]);
  });
});

describe('refill reminder', () => {
  it('renders a localized, action-less notification with a verifiable payload', () => {
    const spec = renderRefillSpec(minutesFrom(NOW, 600), textDeps('en'));
    expect(spec).toMatchObject({ identifier: 'mg:refill', kind: 'refill', categoryId: null, channelId: 'mg-followup-v2', sticky: false });
    expect(spec.title).toBe('Keep your meeting alerts up to date');
    expect(parseRefillData(spec.data)).toEqual(spec.data);
    expect(parseRefillData(JSON.stringify(spec.data))).toEqual(spec.data);
    expect(renderRefillSpec(minutesFrom(NOW, 600), textDeps('es')).title).toBe('Mantén al día tus alertas de reuniones');
    expect(renderRefillSpec(minutesFrom(NOW, 601), textDeps('en')).data.hash).not.toBe(spec.data.hash);
    expect(parseRefillData({ v: 1, kind: 'alert' })).toBeNull();
  });
});

describe('payload helpers', () => {
  const deps = textDeps('en');
  const meeting = makeMeeting('m1', minutesFrom(NOW, 60));
  const spec = renderAlertSpec(alertInput('m1', 5, meeting.startAt), summarizeMeeting(meeting, deps.t), deps);

  it('parses stored payloads from objects and JSON strings and rejects foreign data', () => {
    expect(parseAlertData(spec.data)).toEqual(spec.data);
    expect(parseAlertData(JSON.stringify(spec.data))).toEqual(spec.data);
    expect(parseAlertData({ meetingId: 'm1', alertType: '5min' })).toBeNull();
    expect(parseAlertData('not json')).toBeNull();
    expect(parseAlertData(null)).toBeNull();
  });

  it('extracts content data from data or dataString', () => {
    expect(extractContentData({ data: { a: 1 } })).toEqual({ a: 1 });
    expect(extractContentData({ data: {}, dataString: '{"a":2}' })).toBe('{"a":2}');
    expect(extractContentData(null)).toBeNull();
  });

  it('rebuilds a summary from a payload (headless snooze)', () => {
    expect(summaryFromAlertData(spec.data)).toEqual({
      id: 'm1',
      title: 'Meeting m1',
      startAt: meeting.startAt,
      durationMinutes: 60,
      language: 'en',
      locationText: null,
    });
  });

  it('cleans titles and computes locations / join links without fabricating them', () => {
    expect(cleanText('  a \n b  ', 10)).toBe('a b');
    expect(cleanText('abcdefghijkl', 5)).toBe('abcd…');
    expect(cleanText({ toString: () => 'x' }, 5)).toBe('');
    const t = translator('en');
    expect(meetingLocationText({ location: null, conference: null }, t)).toBeNull();
    expect(
      meetingLocationText({ location: { type: 'virtual', address: null, virtualUrl: 'https://x.example/j' }, conference: null }, t),
    ).toBe('Online meeting');
    expect(meetingJoinUrl({ location: null, conference: { provider: 'zoom', url: null, password: null } })).toBeNull();
    expect(
      meetingJoinUrl({ location: null, conference: { provider: 'zoom', url: 'https://zoom.us/j/1', password: null } }),
    ).toBe('https://zoom.us/j/1');
    expect(fnv1a32('abc')).toBe(fnv1a32('abc'));
    expect(fnv1a32('abc')).not.toBe(fnv1a32('abd'));
  });
});

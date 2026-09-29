import { NOW, makeMeeting, makePrefs, minutesFrom } from '../__fixtures__/alertFixtures';
import { computeAlertPlan, effectiveAlertOffsets } from '../plan';

describe('computeAlertPlan', () => {
  it('schedules the default offsets and the follow-up with deterministic ids and channels', () => {
    const meeting = makeMeeting('m1', minutesFrom(NOW, 120));
    const plan = computeAlertPlan([meeting], makePrefs(), NOW);

    expect(plan.items.map((item) => item.identifier)).toEqual(['mg:m1:15', 'mg:m1:5', 'mg:m1:0', 'mg:m1:followup']);
    expect(plan.items.map((item) => item.fireAt)).toEqual([
      minutesFrom(NOW, 105),
      minutesFrom(NOW, 115),
      minutesFrom(NOW, 120),
      minutesFrom(NOW, 120 + 60 + 5),
    ]);
    expect(plan.items[0]).toMatchObject({
      kind: 'alert',
      meetingId: 'm1',
      offsetMinutes: 15,
      intensity: 'max',
      channelId: 'mg-alert-max-v2',
      categoryId: 'mg-alert',
    });
    expect(plan.items[3]).toMatchObject({
      kind: 'followup',
      offsetMinutes: null,
      channelId: 'mg-followup-v2',
      categoryId: 'mg-followup',
    });
    expect(plan.truncated).toBe(false);
    expect(plan.refillBefore).toBeNull();
  });

  it('uses customAlertTimes (deduped) instead of the preference defaults', () => {
    const meeting = makeMeeting('m1', minutesFrom(NOW, 180), { customAlertTimes: [30, 10, 30, 60] });
    const plan = computeAlertPlan([meeting], makePrefs({ followUpEnabled: false }), NOW);
    expect(plan.items.map((item) => item.offsetMinutes)).toEqual([60, 30, 10]);
    expect(effectiveAlertOffsets(meeting, makePrefs())).toEqual([60, 30, 10]);
  });

  it('applies the per-meeting intensity override and its channel', () => {
    const meeting = makeMeeting('m1', minutesFrom(NOW, 60), { alertIntensity: 'light' });
    const plan = computeAlertPlan([meeting], makePrefs({ alertIntensity: 'max', followUpEnabled: false }), NOW);
    expect(new Set(plan.items.map((item) => item.intensity))).toEqual(new Set(['light']));
    expect(new Set(plan.items.map((item) => item.channelId))).toEqual(new Set(['mg-alert-light-v2']));

    const other = makeMeeting('m2', minutesFrom(NOW, 60));
    const planMedium = computeAlertPlan([other], makePrefs({ alertIntensity: 'medium', followUpEnabled: false }), NOW);
    expect(planMedium.items[0]?.channelId).toBe('mg-alert-medium-v2');
  });

  it('skips notifications in the past and meetings already over', () => {
    const soon = makeMeeting('soon', minutesFrom(NOW, 10)); // 15-min alert already past
    const over = makeMeeting('over', minutesFrom(NOW, -120), { durationMinutes: 30 });
    const inProgress = makeMeeting('live', minutesFrom(NOW, -20), { durationMinutes: 60 });
    const plan = computeAlertPlan([soon, over, inProgress], makePrefs(), NOW);
    expect(plan.items.map((item) => item.identifier)).toEqual([
      'mg:soon:5',
      'mg:soon:0',
      'mg:live:followup',
      'mg:soon:followup',
    ]);
  });

  it('never alerts for cancelled, deleted or all-day meetings', () => {
    const cancelled = makeMeeting('c1', minutesFrom(NOW, 60), { status: 'cancelled' });
    const deleted = makeMeeting('d1', minutesFrom(NOW, 60), {}, { deletedAt: NOW.toISOString() });
    const allDay = makeMeeting('a1', minutesFrom(NOW, 60), { allDay: true, durationMinutes: 1440 });
    expect(computeAlertPlan([cancelled, deleted, allDay], makePrefs(), NOW).items).toEqual([]);
  });

  it('returns an empty plan when alerts are disabled (no follow-ups either)', () => {
    const meeting = makeMeeting('m1', minutesFrom(NOW, 60));
    expect(computeAlertPlan([meeting], makePrefs({ alertEnabled: false }), NOW)).toEqual({
      items: [],
      truncated: false,
      refillBefore: null,
      refillReminderAt: null,
    });
  });

  it('omits the follow-up when followUpEnabled is false', () => {
    const meeting = makeMeeting('m1', minutesFrom(NOW, 60));
    const plan = computeAlertPlan([meeting], makePrefs({ followUpEnabled: false }), NOW);
    expect(plan.items.some((item) => item.kind === 'followup')).toBe(false);
  });

  it('keeps the nearest ALERTS within the budget, reserves a slot for the refill reminder and reports the refill point', () => {
    const meetings = Array.from({ length: 30 }, (_, index) => makeMeeting(`m${index}`, minutesFrom(NOW, 60 + index * 60)));
    const plan = computeAlertPlan(meetings, makePrefs(), NOW, { budget: 60 });
    // 90 alerts + 30 follow-ups do not fit: 59 alerts + 1 slot for the refill reminder, no follow-ups.
    expect(plan.items).toHaveLength(59);
    expect(plan.items.every((item) => item.kind === 'alert')).toBe(true);
    expect(plan.truncated).toBe(true);
    const fireTimes = plan.items.map((item) => Date.parse(item.fireAt));
    expect([...fireTimes].sort((a, b) => a - b)).toEqual(fireTimes);
    expect(plan.refillBefore).toBe(plan.items[58]?.fireAt);
    // The reminder fires an hour before the last scheduled alert.
    expect(plan.refillReminderAt).toBe(new Date(Date.parse(plan.items[58]!.fireAt) - 60 * 60_000).toISOString());
    // Every alert left out fires after every alert kept.
    const all = computeAlertPlan(meetings, makePrefs(), NOW, { budget: 1000 });
    const kept = new Set(plan.items.map((item) => item.identifier));
    const lastKept = Date.parse(plan.refillBefore ?? '');
    all.items
      .filter((item) => item.kind === 'alert' && !kept.has(item.identifier))
      .forEach((item) => {
        expect(Date.parse(item.fireAt)).toBeGreaterThanOrEqual(lastKept);
      });
  });

  it('never lets follow-ups push real alerts out of the budget', () => {
    // 15 meetings: 45 alerts + 15 follow-ups = 60, but only 50 slots.
    const meetings = Array.from({ length: 15 }, (_, index) => makeMeeting(`m${index}`, minutesFrom(NOW, 60 + index * 30)));
    const plan = computeAlertPlan(meetings, makePrefs(), NOW, { budget: 50 });
    expect(plan.items.filter((item) => item.kind === 'alert')).toHaveLength(45);
    expect(plan.items.filter((item) => item.kind === 'followup')).toHaveLength(5);
    // Follow-ups only lose: no refill reminder is needed.
    expect(plan.refillReminderAt).toBeNull();
    expect(plan.truncated).toBe(true);
  });

  it('never schedules the refill reminder sooner than 30 minutes from now', () => {
    const meetings = Array.from({ length: 3 }, (_, index) => makeMeeting(`m${index}`, minutesFrom(NOW, 20 + index)));
    const plan = computeAlertPlan(meetings, makePrefs({ followUpEnabled: false, defaultAlertTimes: [0] }), NOW, { budget: 2 });
    expect(plan.items.map((item) => item.identifier)).toEqual(['mg:m0:0']);
    expect(plan.refillReminderAt).toBe(minutesFrom(NOW, 30));
  });

  it('uses the no-vibration channels when vibration is off', () => {
    const meeting = makeMeeting('m1', minutesFrom(NOW, 60));
    const plan = computeAlertPlan([meeting], makePrefs({ vibrationEnabled: false }), NOW);
    expect(new Set(plan.items.map((item) => item.channelId))).toEqual(
      new Set(['mg-alert-max-novib-v2', 'mg-followup-novib-v2']),
    );
  });

  it('defaults to the 60-notification budget', () => {
    const meetings = Array.from({ length: 40 }, (_, index) => makeMeeting(`m${index}`, minutesFrom(NOW, 60 + index * 30)));
    // 120 alerts do not fit: 59 alerts + the refill reminder slot.
    expect(computeAlertPlan(meetings, makePrefs(), NOW).items).toHaveLength(59);
  });

  it('leaves out notifications beyond the horizon and marks the plan truncated', () => {
    const near = makeMeeting('near', minutesFrom(NOW, 60));
    const far = makeMeeting('far', minutesFrom(NOW, 20 * 24 * 60));
    const plan = computeAlertPlan([near, far], makePrefs({ followUpEnabled: false }), NOW, { horizonDays: 14 });
    expect(plan.items.every((item) => item.meetingId === 'near')).toBe(true);
    expect(plan.truncated).toBe(true);
    expect(plan.refillBefore).toBe(plan.items[plan.items.length - 1]?.fireAt);
  });

  it('computes offsets on UTC instants across a DST change (America/New_York spring forward)', () => {
    // 2026-03-08 03:30 EDT (07:30Z) is right after the 02:00 -> 03:00 jump.
    const now = new Date('2026-03-08T05:00:00.000Z');
    const meeting = makeMeeting('dst', '2026-03-08T07:30:00.000Z', {
      timezone: 'America/New_York',
      customAlertTimes: [60],
    });
    expect(meeting.time).toBe('03:30');
    const plan = computeAlertPlan([meeting], makePrefs({ followUpEnabled: false }), now);
    // Exactly 60 minutes before in absolute time = 01:30 EST (06:30Z), although the wall clock moved 2 h.
    expect(plan.items.map((item) => item.fireAt)).toEqual(['2026-03-08T06:30:00.000Z']);
  });

  it('drops planned alerts that would duplicate a pending snooze of the same meeting', () => {
    const meeting = makeMeeting('m1', minutesFrom(NOW, 30));
    const plan = computeAlertPlan([meeting], makePrefs({ followUpEnabled: false }), NOW, {
      suppress: [{ meetingId: 'm1', fireAt: minutesFrom(NOW, 26) }],
    });
    // The 5-min alert (fires at +25) is within 2 minutes of the snooze (+26): dropped.
    expect(plan.items.map((item) => item.identifier)).toEqual(['mg:m1:15', 'mg:m1:0']);
  });

  it('sorts ties deterministically (alerts before follow-ups) and ignores duplicate meeting ids', () => {
    const first = makeMeeting('a', minutesFrom(NOW, 30), { durationMinutes: 25 });
    const second = makeMeeting('b', minutesFrom(NOW, 60));
    const plan = computeAlertPlan([first, second, first], makePrefs({ defaultAlertTimes: [0] }), NOW);
    // a ends at +55, follow-up +60; b starts at +60.
    expect(plan.items.map((item) => item.identifier)).toEqual(['mg:a:0', 'mg:b:0', 'mg:a:followup', 'mg:b:followup']);
  });
});

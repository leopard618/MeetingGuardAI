import { NOW, makeMeeting, minutesFrom, textDeps } from '../__fixtures__/alertFixtures';
import { createCoalescingRunner } from '../coalescer';
import { parseSnoozeAction, snoozeActionId, snoozeChoices } from '../constants';
import { renderAlertSpec, summarizeMeeting } from '../content';
import { diffNotifications, isLegacyNotification, toScheduledEntries } from '../diff';
import {
  emptyRegistry,
  hasFired,
  isAcknowledged,
  markAcknowledged,
  markFired,
  mergeRegistries,
  parseRegistry,
  pruneRegistry,
  registryKey,
  serializeRegistry,
} from '../registry';

function specFor(offset: number, startAt = minutesFrom(NOW, 60), language: 'en' | 'es' = 'en') {
  const deps = textDeps(language);
  const meeting = makeMeeting('m1', startAt);
  return renderAlertSpec(
    {
      identifier: `mg:m1:${offset}`,
      kind: 'alert',
      meetingId: 'm1',
      offsetMinutes: offset,
      fireAt: new Date(Date.parse(startAt) - offset * 60_000).toISOString(),
      intensity: 'max',
    },
    summarizeMeeting(meeting, deps.t),
    deps,
  );
}

describe('diffNotifications', () => {
  it('keeps unchanged, reschedules changed, cancels stale and schedules missing', () => {
    const keep = specFor(15);
    const changedOld = specFor(5);
    const changedNew = specFor(5, minutesFrom(NOW, 70));
    const missing = specFor(0);
    const existing = toScheduledEntries([
      { identifier: keep.identifier, data: keep.data, triggerDate: null },
      { identifier: changedOld.identifier, data: changedOld.data, triggerDate: null },
      { identifier: 'mg:gone:15', data: { ...keep.data, meetingId: 'gone' }, triggerDate: null },
      { identifier: 'mg:nodata:5', data: null, triggerDate: Date.parse(minutesFrom(NOW, 10)) },
      { identifier: 'someone-else', data: {}, triggerDate: null },
    ]);
    expect(existing.map((entry) => entry.identifier)).toEqual(['mg:m1:15', 'mg:m1:5', 'mg:gone:15', 'mg:nodata:5']);
    expect(existing[3]?.fireAt).toBe(minutesFrom(NOW, 10));

    const diff = diffNotifications(existing, [keep, changedNew, missing]);
    expect(diff.keep).toEqual(['mg:m1:15']);
    expect(diff.cancel).toEqual(['mg:m1:5', 'mg:gone:15', 'mg:nodata:5']);
    expect(diff.schedule.map((spec) => spec.identifier)).toEqual(['mg:m1:5', 'mg:m1:0']);
  });

  it('keeps validated ids (snoozes) untouched', () => {
    const existing = toScheduledEntries([{ identifier: 'mg:m1:snooze', data: null, triggerDate: null }]);
    expect(diffNotifications(existing, [], new Set(['mg:m1:snooze']))).toEqual({
      cancel: [],
      schedule: [],
      keep: ['mg:m1:snooze'],
    });
    expect(diffNotifications(existing, []).cancel).toEqual(['mg:m1:snooze']);
  });

  it('recognises notifications of the pre-rebuild app', () => {
    expect(isLegacyNotification('abc-123', { meetingId: 'x', alertType: '5min' })).toBe(true);
    expect(isLegacyNotification('persistent-meeting-notification', null)).toBe(true);
    expect(isLegacyNotification('abc', '{"type":"persistent"}')).toBe(true);
    expect(isLegacyNotification('abc', { hello: 1 })).toBe(false);
    expect(isLegacyNotification('mg:m1:5', { alertType: 'x' })).toBe(false);
  });
});

describe('registry', () => {
  it('records fired and acknowledged deliveries per identifier + fire time', () => {
    const key = registryKey('mg:m1:5', '2026-10-05T12:00:00.000Z');
    let state = markFired(emptyRegistry(), key, NOW);
    expect(hasFired(state, key)).toBe(true);
    expect(isAcknowledged(state, key)).toBe(false);
    state = markAcknowledged(state, key, NOW);
    expect(isAcknowledged(state, key)).toBe(true);
    expect(hasFired(state, registryKey('mg:m1:5', '2026-10-05T12:10:00.000Z'))).toBe(false);
  });

  it('prunes old entries, merges, and round-trips through JSON tolerantly', () => {
    const old = markFired(emptyRegistry(), 'a', new Date(NOW.getTime() - 3 * 24 * 3600_000));
    const recent = markAcknowledged(old, 'b', NOW);
    const pruned = pruneRegistry(recent, NOW);
    expect(Object.keys(pruned.entries)).toEqual(['b']);
    const merged = mergeRegistries(markFired(emptyRegistry(), 'b', NOW), pruned);
    expect(isAcknowledged(merged, 'b')).toBe(true);
    expect(parseRegistry(serializeRegistry(merged))).toEqual(merged);
    expect(parseRegistry('{broken')).toEqual(emptyRegistry());
    expect(parseRegistry('{"entries":{"x":{"at":"nope"},"y":{"at":"2026-10-05T12:00:00.000Z","ack":1}}}').entries).toEqual({
      y: { at: '2026-10-05T12:00:00.000Z', ack: false },
    });
  });
});

describe('snooze actions', () => {
  it('encodes and parses snooze action ids', () => {
    expect(snoozeActionId(null)).toBe('mg-snooze');
    expect(snoozeActionId(10)).toBe('mg-snooze-10');
    expect(parseSnoozeAction('mg-snooze')).toEqual({ minutes: null });
    expect(parseSnoozeAction('mg-snooze-10')).toEqual({ minutes: 10 });
    expect(parseSnoozeAction('mg-snooze-0')).toBeNull();
    expect(parseSnoozeAction('mg-open')).toBeNull();
    expect(parseSnoozeAction('expo.modules.notifications.actions.DEFAULT')).toBeNull();
  });

  it('offers a default and a longer snooze', () => {
    expect(snoozeChoices(5)).toEqual([5, 10]);
    expect(snoozeChoices(10)).toEqual([10, 20]);
    expect(snoozeChoices(45)).toEqual([45, 60]);
    expect(snoozeChoices(60)).toEqual([60, 65]);
  });
});

describe('createCoalescingRunner', () => {
  const timers = {
    setTimeout: (callback: () => void, ms: number) => setTimeout(callback, ms),
    clearTimeout: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  };

  it('serializes runs and coalesces requests made while running into one follow-up run', async () => {
    let runs = 0;
    const control: { release: () => void } = { release: () => undefined };
    const runner = createCoalescingRunner(
      () =>
        new Promise<number>((resolve) => {
          runs += 1;
          const run = runs;
          control.release = () => resolve(run);
        }),
      { delayMs: 0, timers },
    );
    const first = runner.request({ immediate: true });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = runner.request();
    const third = runner.request();
    expect(runs).toBe(1);
    control.release();
    expect(await first).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(runs).toBe(2);
    control.release();
    expect(await second).toBe(2);
    expect(await third).toBe(2);
    await runner.idle();
    expect(runner.isBusy()).toBe(false);
  });

  it('propagates failures to the waiting callers only', async () => {
    let fail = true;
    const runner = createCoalescingRunner(
      async () => {
        if (fail) throw new Error('boom');
        return 'ok';
      },
      { delayMs: 0, timers },
    );
    await expect(runner.request()).rejects.toThrow('boom');
    fail = false;
    await expect(runner.request()).resolves.toBe('ok');
  });
});

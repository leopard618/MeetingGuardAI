/**
 * Notification content for occurrence items: the payload carries `localDateKey`, parses back, and
 * hashes stay distinct per occurrence. One-off rendering is covered by content.test.ts.
 */
import type { DesiredNotification } from '../../../core/contracts';
import { parseAlertData, renderPlanItem, renderSnoozeSpec } from '../content';
import { textDeps } from '../__fixtures__/alertFixtures';
import type { MeetingSummary } from '../types';

const summary: MeetingSummary = {
  id: 'rec1',
  title: 'Standup',
  startAt: '2026-10-07T14:00:00.000Z',
  durationMinutes: 30,
  language: 'en',
  locationText: null,
};

function item(overrides: Partial<DesiredNotification> = {}): DesiredNotification {
  return {
    identifier: 'mg:rec1:2026-10-07:15',
    kind: 'alert',
    meetingId: 'rec1',
    localDateKey: '2026-10-07',
    offsetMinutes: 15,
    fireAt: '2026-10-07T13:45:00.000Z',
    intensity: 'max',
    channelId: 'mg-alert-max-v2',
    categoryId: 'mg-alert',
    ...overrides,
  };
}

describe('occurrence payloads', () => {
  it('renderPlanItem stores localDateKey and it round-trips through parseAlertData', () => {
    const spec = renderPlanItem(item(), summary, textDeps());
    expect(spec.data.localDateKey).toBe('2026-10-07');
    expect(spec.data.startAt).toBe('2026-10-07T14:00:00.000Z');
    const parsed = parseAlertData(JSON.parse(JSON.stringify(spec.data)));
    expect(parsed?.localDateKey).toBe('2026-10-07');
    const asString = parseAlertData(JSON.stringify(spec.data));
    expect(asString?.localDateKey).toBe('2026-10-07');
  });

  it('a payload without localDateKey (one-off / pre-recurrence) still parses', () => {
    const spec = renderPlanItem(item({ identifier: 'mg:rec1:15', localDateKey: undefined }), summary, textDeps());
    expect(spec.data.localDateKey).toBeUndefined();
    expect(parseAlertData(spec.data)).not.toBeNull();
  });

  it('a malformed localDateKey invalidates the payload', () => {
    const spec = renderPlanItem(item(), summary, textDeps());
    expect(parseAlertData({ ...spec.data, localDateKey: 'not-a-date' })).toBeNull();
  });

  it('two occurrences of one series get distinct hashes (identifier is hashed)', () => {
    const first = renderPlanItem(item(), summary, textDeps());
    const second = renderPlanItem(
      item({ identifier: 'mg:rec1:2026-10-08:15', localDateKey: '2026-10-08', fireAt: '2026-10-08T13:45:00.000Z' }),
      { ...summary, startAt: '2026-10-08T14:00:00.000Z' },
      textDeps(),
    );
    expect(first.data.hash).not.toBe(second.data.hash);
  });

  it('renderSnoozeSpec keeps the snoozed occurrence key in the payload', () => {
    const spec = renderSnoozeSpec(summary, 'max', '2026-10-07T13:50:00.000Z', textDeps(), '2026-10-07');
    expect(spec.identifier).toBe('mg:rec1:snooze');
    expect(spec.data.localDateKey).toBe('2026-10-07');
    const plain = renderSnoozeSpec(summary, 'max', '2026-10-07T13:50:00.000Z', textDeps());
    expect(plain.data.localDateKey).toBeUndefined();
  });
});

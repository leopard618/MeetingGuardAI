/**
 * The ongoing "alerts are on" notification: what it says, and that it is presented, kept, refreshed
 * and removed at the right moments. It deliberately does NOT keep the app alive, so there is
 * nothing here about process lifetime; alarms are proven by the engine and taskReminders tests.
 */

import { createEventBus, type AppEventMap } from '../../../core/events';
import { AppError } from '../../../core/errors';
import { STATUS_NOTIFICATION_ID } from '../../../core/identifiers';
import type { Meeting, Preferences } from '../../../core/types';
import { computeStatusView, createStatusNotification, renderStatusSpec, type StatusNotification } from '../statusNotification';
import { fakeFormatTime, makeMeeting, makePrefs, textDeps, translator } from '../__fixtures__/alertFixtures';
import type { PresentedNotificationRecord, StatusNotificationSpec } from '../types';

// The feature is parked behind a build switch until its scheduled week. It must stay proven
// while it waits, so these tests run it as if the switch were on.
jest.mock('../../../core/features', () => ({ FEATURES: { statusNotification: true } }));

const NOW = new Date('2026-10-05T07:00:00.000Z');
const ZONE = 'Europe/Madrid';

function prefs(overrides: Partial<Preferences> = {}): Preferences {
  return makePrefs({ timezone: ZONE, statusNotificationEnabled: true, ...overrides });
}

describe('computeStatusView', () => {
  it('finds the next meeting, ignoring ones already past', () => {
    const view = computeStatusView(
      [makeMeeting('past', '2026-10-05T06:00:00.000Z'), makeMeeting('next', '2026-10-05T09:00:00.000Z')],
      NOW,
    );
    expect(view).toEqual({ nextTitle: 'Meeting next', nextStartAt: '2026-10-05T09:00:00.000Z' });
  });

  it('is empty when nothing is coming up', () => {
    expect(computeStatusView([], NOW)).toEqual({ nextTitle: null, nextStartAt: null });
  });

  it('uses the next OCCURRENCE of a series, not the first one', () => {
    const daily = makeMeeting('standup', '2026-06-01T07:00:00.000Z', {
      recurrence: { freq: 'daily', interval: 1, byWeekday: null, byMonthDay: null, until: null, count: null },
    });
    // 07:00Z today IS now, so it still counts as the next one.
    expect(computeStatusView([daily], NOW).nextStartAt).toBe('2026-10-05T07:00:00.000Z');
    // Half an hour later that occurrence is past, so the next one is tomorrow's.
    const later = new Date('2026-10-05T07:30:00.000Z');
    expect(computeStatusView([daily], later).nextStartAt).toBe('2026-10-06T07:00:00.000Z');
  });

  it('ignores cancelled and deleted meetings', () => {
    const cancelled = makeMeeting('cx', '2026-10-05T09:00:00.000Z', {}, { status: 'cancelled' });
    const deleted = makeMeeting('dx', '2026-10-05T10:00:00.000Z', {}, { deletedAt: NOW.toISOString() });
    expect(computeStatusView([cancelled, deleted], NOW).nextTitle).toBeNull();
  });
});

describe('renderStatusSpec', () => {
  function render(view: Parameters<typeof renderStatusSpec>[0], language: 'en' | 'es' = 'en'): StatusNotificationSpec {
    return renderStatusSpec(view, prefs(), textDeps(language, ZONE));
  }

  it('names the next meeting and its local time', () => {
    const spec = render({ nextTitle: 'Kickoff', nextStartAt: '2026-10-05T09:00:00.000Z' });
    expect(spec.identifier).toBe(STATUS_NOTIFICATION_ID);
    expect(spec.title).toBe('MeetingGuard is on');
    expect(spec.body).toBe('Next: Kickoff at 11:00');
    expect(spec.channelId).toBe('mg-status-v1');
  });

  it('says alerts are armed when the calendar is empty', () => {
    expect(render({ nextTitle: null, nextStartAt: null }).body).toBe('No meetings coming up. Your alerts are armed.');
  });

  it('renders in Spanish', () => {
    expect(render({ nextTitle: null, nextStartAt: null }, 'es').title).toBe('MeetingGuard está activo');
  });

  it('carries no payload key the engine would cancel on sight', () => {
    const data = render({ nextTitle: null, nextStartAt: null }).data as unknown as Record<string, unknown>;
    expect(data.kind).toBe('status');
    expect(data.alertType).toBeUndefined();
    expect(data.type).toBeUndefined();
  });
});

interface Harness {
  status: StatusNotification;
  presented: StatusNotificationSpec[];
  dismissed: string[];
  shown: PresentedNotificationRecord[];
  setMeetings(meetings: Meeting[]): void;
  setPreferences(preferences: Preferences | null): void;
}

function setup(options: { meetings?: Meeting[]; preferences?: Partial<Preferences> } = {}): Harness {
  const presented: StatusNotificationSpec[] = [];
  const dismissed: string[] = [];
  const shown: PresentedNotificationRecord[] = [];
  let meetings: Meeting[] = options.meetings ?? [];
  let preferences: Preferences | null = prefs(options.preferences);

  const status = createStatusNotification({
    notifications: {
      async getScheduled() {
        return [];
      },
      async getPresented() {
        return shown;
      },
      async present(spec: StatusNotificationSpec) {
        presented.push(spec);
        shown.length = 0;
        shown.push({ identifier: spec.identifier, data: spec.data, date: NOW.getTime() });
      },
      async cancel(identifier: string) {
        dismissed.push(identifier);
      },
      async dismiss(identifier: string) {
        dismissed.push(identifier);
        shown.length = 0;
      },
    },
    getPreferences: async () => {
      if (preferences === null) throw new AppError('unauthenticated', 'signed out');
      return preferences;
    },
    listMeetings: async () => meetings,
    i18n: { t: translator('en'), getLanguage: () => 'en', formatTime: fakeFormatTime },
    events: createEventBus<AppEventMap>(),
    deviceTimeZone: () => ZONE,
    now: () => NOW,
  });

  return {
    status,
    presented,
    dismissed,
    shown,
    setMeetings: (next) => {
      meetings = next;
    },
    setPreferences: (next) => {
      preferences = next;
    },
  };
}

describe('createStatusNotification', () => {
  it('shows nothing until the user asks for it', async () => {
    const h = setup({ preferences: { statusNotificationEnabled: false } });
    await h.status.refresh();
    expect(h.presented).toEqual([]);
  });

  it('presents the notification with the next meeting once enabled', async () => {
    const h = setup({ meetings: [makeMeeting('m1', '2026-10-05T09:00:00.000Z')] });
    await h.status.refresh();
    expect(h.presented).toHaveLength(1);
    expect(h.presented[0]?.body).toBe('Next: Meeting m1 at 11:00');
  });

  it('does not re-post an identical notification', async () => {
    const h = setup({ meetings: [makeMeeting('m1', '2026-10-05T09:00:00.000Z')] });
    await h.status.refresh();
    await h.status.refresh();
    expect(h.presented).toHaveLength(1);
  });

  it('re-posts when the next meeting changes', async () => {
    const h = setup({ meetings: [makeMeeting('m1', '2026-10-05T09:00:00.000Z')] });
    await h.status.refresh();

    h.setMeetings([makeMeeting('m0', '2026-10-05T08:00:00.000Z'), makeMeeting('m1', '2026-10-05T09:00:00.000Z')]);
    await h.status.refresh();

    expect(h.presented).toHaveLength(2);
    expect(h.presented[1]?.body).toBe('Next: Meeting m0 at 10:00');
  });

  it('re-posts when the notification is gone from the shade, even with the same text', async () => {
    const h = setup({ meetings: [makeMeeting('m1', '2026-10-05T09:00:00.000Z')] });
    await h.status.refresh();
    h.shown.length = 0; // the user swiped it away, or the phone restarted

    await h.status.refresh();

    expect(h.presented).toHaveLength(2);
  });

  it('removes it when the switch goes off, when alerts go off, and when signed out', async () => {
    const h = setup({ meetings: [makeMeeting('m1', '2026-10-05T09:00:00.000Z')] });
    await h.status.refresh();

    h.setPreferences(prefs({ statusNotificationEnabled: false }));
    await h.status.refresh();
    expect(h.dismissed).toContain(STATUS_NOTIFICATION_ID);

    h.setPreferences(prefs({ alertEnabled: false }));
    await h.status.refresh();
    h.setPreferences(null);
    await h.status.refresh();
    expect(h.presented).toHaveLength(1);
  });
});

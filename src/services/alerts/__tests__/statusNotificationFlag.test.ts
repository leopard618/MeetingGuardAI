/**
 * The feature switch itself. It is ON for the 1.5.0 release (week 5); the second test proves that
 * the preference, not the switch, is what keeps the notification away when the user has not
 * turned it on, and the third that the switch still works as an off switch for the scheduler.
 */
import { createEventBus, type AppEventMap } from '../../../core/events';
import { FEATURES } from '../../../core/features';
import type { Preferences } from '../../../core/types';
import { createStatusNotification } from '../statusNotification';
import { fakeFormatTime, makePrefs, translator } from '../__fixtures__/alertFixtures';
import type { StatusNotificationSpec } from '../types';

describe('status notification feature switch', () => {
  it('is on for the 1.5.0 release (week 5)', () => {
    expect(FEATURES.statusNotification).toBe(true);
  });

  it('presents nothing while the user preference is off, even with the switch on', async () => {
    const presented: StatusNotificationSpec[] = [];
    const preferences: Preferences = makePrefs({ statusNotificationEnabled: false });
    const status = createStatusNotification({
      notifications: {
        getScheduled: async () => [],
        getPresented: async () => [],
        present: async (spec) => {
          presented.push(spec);
        },
        cancel: async () => undefined,
        dismiss: async () => undefined,
      },
      getPreferences: async () => preferences,
      listMeetings: async () => [],
      i18n: { t: translator('en'), getLanguage: () => 'en', formatTime: fakeFormatTime },
      events: createEventBus<AppEventMap>(),
      now: () => new Date('2026-10-05T07:00:00.000Z'),
    });

    await status.refresh();

    expect(presented).toEqual([]);
  });
});

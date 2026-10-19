/**
 * The parked-feature switch itself: with it off, nothing is presented and the stored preference is
 * left alone. This is the test that proves "disabled" really means disabled.
 */
import { createEventBus, type AppEventMap } from '../../../core/events';
import { FEATURES } from '../../../core/features';
import type { Preferences } from '../../../core/types';
import { createStatusNotification } from '../statusNotification';
import { fakeFormatTime, makePrefs, translator } from '../__fixtures__/alertFixtures';
import type { StatusNotificationSpec } from '../types';

describe('status notification feature switch', () => {
  it('is off, so the feature is not shown to users yet', () => {
    expect(FEATURES.statusNotification).toBe(false);
  });

  it('presents nothing while the switch is off, even with the preference on', async () => {
    const presented: StatusNotificationSpec[] = [];
    const preferences: Preferences = makePrefs({ statusNotificationEnabled: true });
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

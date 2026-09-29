/** Test factory: a valid scheduled meeting (UTC) with overrides. */
import type { Meeting } from '../../../core/types';

export function makeMeeting(overrides: Partial<Meeting> & Pick<Meeting, 'id' | 'startAt'>): Meeting {
  return {
    userId: 'u1',
    title: overrides.id,
    description: '',
    durationMinutes: 60,
    timezone: 'UTC',
    allDay: false,
    date: overrides.startAt.slice(0, 10),
    time: overrides.startAt.slice(11, 16),
    location: null,
    conference: null,
    participants: [],
    source: 'manual',
    confidence: null,
    language: 'en',
    preparationTips: [],
    customAlertTimes: null,
    alertIntensity: null,
    notes: null,
    status: 'scheduled',
    external: {
      googleEventId: null,
      googleCalendarId: null,
      googleEtag: null,
      googleUpdatedAt: null,
      deviceEventId: null,
      deviceCalendarId: null,
    },
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    deletedAt: null,
    ...overrides,
  };
}

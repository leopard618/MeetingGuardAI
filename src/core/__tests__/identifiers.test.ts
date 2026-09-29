import {
  alertNotificationId,
  assistantDeepLink,
  channelForIntensity,
  firestorePaths,
  followUpNotificationId,
  googleEventIdForMeeting,
  isMeetingGuardNotificationId,
  meetingDeepLink,
  meetingIdFromGoogleEventId,
  parseDeepLink,
  parseNotificationId,
  snoozeNotificationId,
  userStorageKey,
  userStoragePrefix,
  USER_STORAGE,
} from '../identifiers';

describe('notification identifiers', () => {
  it('builds and parses the documented scheme', () => {
    expect(alertNotificationId('abc123', 15)).toBe('mg:abc123:15');
    expect(followUpNotificationId('abc123')).toBe('mg:abc123:followup');
    expect(snoozeNotificationId('abc123')).toBe('mg:abc123:snooze');
    expect(parseNotificationId('mg:abc123:0')).toEqual({ kind: 'alert', meetingId: 'abc123', offsetMinutes: 0 });
    expect(parseNotificationId('mg:abc123:followup')).toEqual({ kind: 'followup', meetingId: 'abc123' });
    expect(parseNotificationId('mg:abc123:snooze')).toEqual({ kind: 'snooze', meetingId: 'abc123' });
  });

  it('rejects foreign or malformed ids', () => {
    expect(parseNotificationId('mtg:abc:5')).toBeNull();
    expect(parseNotificationId('mg:abc:-5')).toBeNull();
    expect(parseNotificationId('mg:a b:5')).toBeNull();
    expect(isMeetingGuardNotificationId('expo-generated-id')).toBe(false);
    expect(() => alertNotificationId('bad:id', 5)).toThrow(RangeError);
    expect(() => alertNotificationId('abc', -1)).toThrow(RangeError);
  });

  it('maps intensities to channels', () => {
    expect(channelForIntensity('max')).toBe('mg-alert-max-v1');
    expect(channelForIntensity('light')).toBe('mg-alert-light-v1');
  });
});

describe('storage keys and Firestore paths', () => {
  it('prefixes per-user keys', () => {
    expect(userStorageKey('u1', USER_STORAGE.outbox)).toBe('mg:u1:outbox');
    expect(userStorageKey('u1', USER_STORAGE.meetings).startsWith(userStoragePrefix('u1'))).toBe(true);
  });

  it('builds the documented Firestore layout', () => {
    expect(firestorePaths.meeting('u1', 'm1')).toBe('users/u1/meetings/m1');
    expect(firestorePaths.preferences('u1')).toBe('users/u1/settings/preferences');
    expect(firestorePaths.entitlement('u1')).toBe('entitlements/u1');
    expect(firestorePaths.usageDay('u1', '2026-10-05')).toBe('usage/u1/days/2026-10-05');
  });
});

describe('deep links', () => {
  it('round-trips meeting and assistant links', () => {
    expect(meetingDeepLink('m1')).toBe('meetingguardai://meeting/m1');
    expect(parseDeepLink(meetingDeepLink('m1'))).toEqual({ type: 'meeting', meetingId: 'm1' });
    expect(assistantDeepLink({ followUpMeetingId: 'm2' })).toBe('meetingguardai://assistant?followup=m2');
    expect(parseDeepLink('meetingguardai://assistant?followup=m2')).toEqual({ type: 'assistant', followUpMeetingId: 'm2' });
    expect(parseDeepLink('meetingguardai://assistant')).toEqual({ type: 'assistant', followUpMeetingId: null });
  });

  it('rejects unknown links', () => {
    expect(parseDeepLink('https://example.com/meeting/m1')).toEqual({ type: 'unknown' });
    expect(parseDeepLink('meetingguardai://meeting/')).toEqual({ type: 'unknown' });
    expect(parseDeepLink('meetingguardai://settings')).toEqual({ type: 'unknown' });
  });
});

describe('Google event ids', () => {
  it('encodes to Google-valid base32hex and decodes back', () => {
    for (const id of ['AbCdEf0123456789XyZ_', 'legacy_1695000000000', 'a', 'ai_act-42']) {
      const eventId = googleEventIdForMeeting(id);
      expect(eventId).toMatch(/^[a-v0-9]{5,1024}$/);
      expect(meetingIdFromGoogleEventId(eventId)).toBe(id);
    }
  });

  it('returns null for events not created by MeetingGuard', () => {
    expect(meetingIdFromGoogleEventId('7kq3n0v9s8d1')).toBeNull();
    expect(meetingIdFromGoogleEventId('mgevzz')).toBeNull();
    expect(meetingIdFromGoogleEventId('mgev')).toBeNull();
    expect(meetingIdFromGoogleEventId(`${googleEventIdForMeeting('abc')}_20260101T090000Z`)).toBeNull();
  });
});

import { NOTIFICATION_ACTIONS, assistantDeepLink, meetingDeepLink } from '../../core/identifiers';
import { handleNotificationResponse, resetHandledNotificationResponsesForTests, urlForNotificationResponse } from '../linking';
import {
  clearPendingNavigation,
  getPendingNavigation,
  intentForDeepLink,
  navigate,
  openDeepLink,
} from '../navigationService';

jest.mock('expo-notifications', () => ({
  DEFAULT_ACTION_IDENTIFIER: 'expo.modules.notifications.actions.DEFAULT',
  getLastNotificationResponse: jest.fn(() => null),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
}));

const DEFAULT_ACTION = 'expo.modules.notifications.actions.DEFAULT';

function response(actionIdentifier: string, data: Record<string, unknown>, identifier = 'mg:m1:15', date = 1) {
  return { actionIdentifier, notification: { date, request: { identifier, content: { data } } } };
}

beforeEach(() => {
  clearPendingNavigation();
  resetHandledNotificationResponsesForTests();
});

describe('intentForDeepLink', () => {
  it('maps meeting and assistant links to routes', () => {
    expect(intentForDeepLink(meetingDeepLink('m1'))).toEqual({ name: 'MeetingDetails', params: { meetingId: 'm1' } });
    expect(intentForDeepLink(assistantDeepLink({ followUpMeetingId: 'm1' }))).toEqual({
      name: 'AIChat',
      params: { followup: 'm1' },
    });
    expect(intentForDeepLink(assistantDeepLink())).toEqual({ name: 'AIChat', params: undefined });
  });

  it('rejects foreign or malformed links', () => {
    expect(intentForDeepLink('https://example.com/meeting/m1')).toBeNull();
    expect(intentForDeepLink('meetingguardai://meeting/bad:id')).toBeNull();
    expect(intentForDeepLink('meetingguardai://settings')).toBeNull();
  });
});

describe('navigation queue (container not mounted)', () => {
  it('queues intents until the route is mounted; the latest wins', () => {
    navigate('CreateMeeting');
    expect(getPendingNavigation()).toEqual({ name: 'CreateMeeting', params: undefined });
    expect(openDeepLink(meetingDeepLink('m2'))).toBe(true);
    expect(getPendingNavigation()).toEqual({ name: 'MeetingDetails', params: { meetingId: 'm2' } });
  });

  it('does not queue unknown links', () => {
    expect(openDeepLink('exp+meetingguardai://expo-development-client/?url=x')).toBe(false);
    expect(getPendingNavigation()).toBeNull();
  });
});

describe('notification responses', () => {
  it('routes default taps and the open action through data.url', () => {
    expect(urlForNotificationResponse(response(DEFAULT_ACTION, { url: meetingDeepLink('m1') }))).toBe(
      'meetingguardai://meeting/m1',
    );
    expect(urlForNotificationResponse(response(NOTIFICATION_ACTIONS.open, { url: meetingDeepLink('m1') }))).toBe(
      'meetingguardai://meeting/m1',
    );
  });

  it('opens the follow-up assistant for the assistant action', () => {
    expect(
      urlForNotificationResponse(response(NOTIFICATION_ACTIONS.assistant, { meetingId: 'm1', url: meetingDeepLink('m1') })),
    ).toBe('meetingguardai://assistant?followup=m1');
  });

  it('leaves snooze to the alerts area and ignores foreign payloads', () => {
    expect(urlForNotificationResponse(response(NOTIFICATION_ACTIONS.snooze, { url: meetingDeepLink('m1') }))).toBeNull();
    expect(urlForNotificationResponse(response(DEFAULT_ACTION, { url: 'https://evil.example' }))).toBeNull();
    expect(urlForNotificationResponse(response(DEFAULT_ACTION, {}))).toBeNull();
  });

  it('handles the same response only once (cold start + listener)', () => {
    const tap = response(DEFAULT_ACTION, { url: meetingDeepLink('m3') });
    expect(handleNotificationResponse(tap)).toBe(true);
    clearPendingNavigation();
    expect(handleNotificationResponse(tap)).toBe(false);
    expect(getPendingNavigation()).toBeNull();
  });
});

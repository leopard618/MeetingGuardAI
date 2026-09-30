/**
 * conferenceCapability (§22): the empty-url behavior per provider and calendar state.
 */
import { conferenceCapability, teamsLinkOnCreateOnly, type ConferenceCalendarState } from '../conference';

function calendar(overrides: Partial<ConferenceCalendarState> = {}): ConferenceCalendarState {
  return { google: { connected: false }, ...overrides };
}

describe('conferenceCapability', () => {
  it('none and paste-only providers ignore the calendar state', () => {
    const connected = calendar({ google: { connected: true }, outlook: { configured: true, connected: true } });
    expect(conferenceCapability('none', connected)).toEqual({ mode: 'none', autoState: null });
    expect(conferenceCapability('zoom', connected)).toEqual({ mode: 'paste', autoState: null });
    expect(conferenceCapability('other', calendar())).toEqual({ mode: 'paste', autoState: null });
  });

  it('google_meet is auto_google: ready when connected, needs_connection otherwise', () => {
    expect(conferenceCapability('google_meet', calendar({ google: { connected: true } }))).toEqual({
      mode: 'auto_google',
      autoState: 'ready',
    });
    expect(conferenceCapability('google_meet', calendar())).toEqual({
      mode: 'auto_google',
      autoState: 'needs_connection',
    });
  });

  it('teams is paste-only while Outlook is hidden or unconfigured', () => {
    expect(conferenceCapability('teams', calendar())).toEqual({ mode: 'paste', autoState: null });
    expect(conferenceCapability('teams', calendar({ outlook: { configured: false, connected: false } }))).toEqual({
      mode: 'paste',
      autoState: null,
    });
  });

  it('teams is auto_outlook once Outlook is configured', () => {
    expect(conferenceCapability('teams', calendar({ outlook: { configured: true, connected: true } }))).toEqual({
      mode: 'auto_outlook',
      autoState: 'ready',
    });
    expect(conferenceCapability('teams', calendar({ outlook: { configured: true, connected: false } }))).toEqual({
      mode: 'auto_outlook',
      autoState: 'needs_connection',
    });
  });
});

describe('teamsLinkOnCreateOnly', () => {
  it('is true only for meetings already pushed to Outlook', () => {
    expect(teamsLinkOnCreateOnly({ outlookEventId: null })).toBe(false);
    expect(teamsLinkOnCreateOnly({ outlookEventId: 'AAMk123' })).toBe(true);
  });
});

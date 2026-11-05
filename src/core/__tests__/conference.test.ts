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

  it('zoom follows the server-side status: paste while unknown, auto_zoom once known (§24)', () => {
    // calendar.zoom absent = zoomStatus not answered this session: never advertise the feature.
    expect(conferenceCapability('zoom', calendar())).toEqual({ mode: 'paste', autoState: null });
    expect(conferenceCapability('zoom', calendar({ zoom: { configured: true } }))).toEqual({
      mode: 'auto_zoom',
      autoState: 'ready',
    });
    expect(conferenceCapability('zoom', calendar({ zoom: { configured: false } }))).toEqual({
      mode: 'auto_zoom',
      autoState: 'not_configured',
    });
  });

  it('auto_zoom never degrades for any push target (the link comes from our own callable)', () => {
    const zoomReady = calendar({ zoom: { configured: true } });
    for (const source of ['manual', 'google', 'device', 'outlook'] as const) {
      for (const recurring of [false, true]) {
        expect(conferenceCapability('zoom', zoomReady, { source, recurring })).toEqual({
          mode: 'auto_zoom',
          autoState: 'ready',
        });
      }
    }
  });

  it('an auto mode the push engines cannot reach for the target meeting degrades to paste', () => {
    const both = calendar({ google: { connected: true }, outlook: { configured: true, connected: true } });
    const paste = { mode: 'paste', autoState: null };
    // Outlook push: never for google/device imports; series are pushed since M6, link included.
    expect(conferenceCapability('teams', both, { source: 'manual', recurring: true })).toEqual({ mode: 'auto_outlook', autoState: 'ready' });
    expect(conferenceCapability('teams', both, { source: 'google', recurring: false })).toEqual(paste);
    expect(conferenceCapability('teams', both, { source: 'device', recurring: false })).toEqual(paste);
    expect(conferenceCapability('teams', both, { source: 'manual', recurring: false })).toEqual({
      mode: 'auto_outlook',
      autoState: 'ready',
    });
    // Google push: recurring masters ARE pushed; only device/outlook imports are not.
    expect(conferenceCapability('google_meet', both, { source: 'manual', recurring: true })).toEqual({
      mode: 'auto_google',
      autoState: 'ready',
    });
    expect(conferenceCapability('google_meet', both, { source: 'google', recurring: true })).toEqual({
      mode: 'auto_google',
      autoState: 'ready',
    });
    expect(conferenceCapability('google_meet', both, { source: 'device', recurring: false })).toEqual(paste);
    expect(conferenceCapability('google_meet', both, { source: 'outlook', recurring: false })).toEqual(paste);
    // The target never changes the non-auto modes.
    expect(conferenceCapability('zoom', both, { source: 'device', recurring: true })).toEqual(paste);
    expect(conferenceCapability('none', both, { source: 'device', recurring: true })).toEqual({ mode: 'none', autoState: null });
  });
});

describe('teamsLinkOnCreateOnly', () => {
  it('is true only for meetings already pushed to Outlook', () => {
    expect(teamsLinkOnCreateOnly({ outlookEventId: null })).toBe(false);
    expect(teamsLinkOnCreateOnly({ outlookEventId: 'AAMk123' })).toBe(true);
  });
});

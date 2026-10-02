/**
 * Video-call link semantics (pure; owner: architect/core). docs/ARCHITECTURE.md §22.
 *
 * A meeting's `conference` stores `{ provider, url, password } | null` and NOTHING else: the
 * app never fabricates a link, so `url === null` means "no link yet". What the UI must say
 * about that empty url depends on the provider AND on the live calendar connections, and that
 * derivation lives HERE so the form hint, the details card and the AI executor all agree.
 * The mode is DERIVED on render - it is never stored.
 *
 * Ground truth in the sync code (verified against the providers):
 * - google_meet + url null  => the ordinary Google push requests a real Meet link
 *   (conferenceData.createRequest) on INSERT AND PATCH (google/sync.ts `wantsMeetLink`), and
 *   the AI executor can force one via `createMeetLink`. So once Google Calendar is connected,
 *   saving is enough: the link appears after the next push.
 * - teams + url null        => the Outlook push creates a Teams meeting
 *   (`isOnlineMeeting: true`, provider teamsForBusiness) ON INSERT ONLY (outlook/mapping.ts;
 *   Graph cannot reliably upgrade an existing event, §17). A meeting that ALREADY has an
 *   `external.outlookEventId` and no url will NOT get one - the UI must fall back to the
 *   paste hint for that combination (`teamsLinkOnCreateOnly`).
 * - zoom + url null         => the zoomCreateMeeting callable creates a real Zoom meeting under
 *   the project's Server-to-Server OAuth app and writes the link back server-side (§24), but
 *   ONLY when the owner configured the integration. The app learns configured-ness from the
 *   zoomStatus callable (cached per session, src/services/zoom) and passes it in as
 *   `calendar.zoom`; while unknown (absent), zoom behaves as plain paste so the UI never
 *   promises a link the server might not create.
 * - other                   => links are only ever pasted by the user.
 */
import type { ConferenceProvider } from './aiContract';
import type { MeetingSource } from './types';

/**
 * What the calendar layer knows, reduced to what this helper needs (assignable from
 * `CalendarStatus` in contracts.ts / `useCalendarStatus()`).
 */
export interface ConferenceCalendarState {
  google: { connected: boolean };
  /** Absent when EXPO_PUBLIC_MSAL_CLIENT_ID is not set (the whole Outlook feature is hidden). */
  outlook?: { configured: boolean; connected: boolean };
  /**
   * What the app knows about the server-side Zoom integration (zoomStatus callable, cached per
   * session; src/services/zoom). Absent = not asked yet / answer unknown: zoom then behaves as
   * plain paste. `configured: false` = the server SAID it is not set up (the form may add the
   * muted "not set up yet" note, §24).
   */
  zoom?: { configured: boolean };
}

/**
 * How an EMPTY conference url behaves for the chosen provider:
 * - 'none':          no video call section content (provider 'none' in the form).
 * - 'paste':         only a pasted link ever fills the url (other; zoom while the server status
 *                    is unknown; teams while Outlook is unconfigured/hidden).
 * - 'auto_google':   Google Calendar creates a real Meet link on the next push.
 * - 'auto_outlook':  Outlook creates a real Teams link when the event is first pushed.
 * - 'auto_zoom':     the zoomCreateMeeting callable creates a real Zoom link after Save (§24).
 */
export type ConferenceMode = 'none' | 'paste' | 'auto_google' | 'auto_outlook' | 'auto_zoom';

/**
 * For the auto modes: 'ready' = saving with an empty link produces a real one;
 * 'needs_connection' = the provider could create the link, but the calendar is not connected yet
 * (show the connect CTA; pasting still works); 'not_configured' (auto_zoom only) = the server
 * said the Zoom integration is not set up - paste-only in practice, but the UI may say WHY
 * (there is no CTA: only the project owner can configure it). null for 'none' / 'paste'.
 */
export type ConferenceAutoState = 'ready' | 'needs_connection' | 'not_configured' | null;

export interface ConferenceCapability {
  mode: ConferenceMode;
  autoState: ConferenceAutoState;
}

/**
 * What the push engines know about the MEETING itself. The push filters refuse some meetings
 * entirely, so their auto mode would be a promise the sync never keeps:
 * - Google push (google/sync.ts `pushGoogleMeeting`): never pushes source 'device' or 'outlook'
 *   meetings (recurring masters ARE pushed, so Meet + recurrence works).
 * - Outlook push (outlook/sync.ts `isOutlookPushable`): never pushes source 'google' / 'device'
 *   meetings NOR any meeting with a recurrence rule (§17; a one-off that gains a rule even has
 *   its Graph event deleted).
 * For a NEW meeting (create form) use source 'manual' and the draft's repeat choice.
 */
export interface ConferencePushTarget {
  source: MeetingSource;
  /** Meeting.recurrence !== null (or the form draft's repeat choice != 'none'). */
  recurring: boolean;
}

/** True when the sync engines will never auto-create a link for this meeting in this mode. */
function autoUnreachable(mode: ConferenceMode, target: ConferencePushTarget): boolean {
  if (mode === 'auto_google') return target.source === 'device' || target.source === 'outlook';
  if (mode === 'auto_outlook') return target.source === 'google' || target.source === 'device' || target.recurring;
  // auto_zoom never degrades: the link comes from our own callable (not a push filter), which
  // works for every source, and a Zoom join url is reusable so recurring meetings keep it too.
  return false;
}

/**
 * Pure derivation of the empty-url behavior from the chosen provider and the live calendar
 * status. `provider` is the form's choice ('none' = no video call). Rules:
 * - none                => { none, null }
 * - other               => { paste, null }
 * - zoom, status unknown (calendar.zoom absent) => { paste, null } (never advertise a feature
 *                          the server might not offer)
 * - zoom, status known  => { auto_zoom, configured ? ready : not_configured }
 * - google_meet         => { auto_google, connected ? ready : needs_connection } (auto-create is
 *                          always one connection away; it is never plain paste-only)
 * - teams, Outlook hidden or unconfigured => { paste, null } (never advertise a feature the
 *                          build cannot offer)
 * - teams, configured   => { auto_outlook, connected ? ready : needs_connection }
 *
 * When `target` is given, an auto mode the push engines cannot reach for THAT meeting (see
 * `ConferencePushTarget`) degrades to { paste, null }: no "will be created" promise, no connect
 * CTA that would not help. Without `target` the capability describes the providers alone.
 */
export function conferenceCapability(
  provider: ConferenceProvider | 'none',
  calendar: ConferenceCalendarState,
  target?: ConferencePushTarget,
): ConferenceCapability {
  const capability = providerCapability(provider, calendar);
  if (target !== undefined && autoUnreachable(capability.mode, target)) return { mode: 'paste', autoState: null };
  return capability;
}

function providerCapability(provider: ConferenceProvider | 'none', calendar: ConferenceCalendarState): ConferenceCapability {
  switch (provider) {
    case 'none':
      return { mode: 'none', autoState: null };
    case 'other':
      return { mode: 'paste', autoState: null };
    case 'zoom': {
      const zoom = calendar.zoom;
      if (zoom === undefined) return { mode: 'paste', autoState: null };
      return { mode: 'auto_zoom', autoState: zoom.configured ? 'ready' : 'not_configured' };
    }
    case 'google_meet':
      return { mode: 'auto_google', autoState: calendar.google.connected ? 'ready' : 'needs_connection' };
    case 'teams': {
      const outlook = calendar.outlook;
      if (outlook === undefined || !outlook.configured) return { mode: 'paste', autoState: null };
      return { mode: 'auto_outlook', autoState: outlook.connected ? 'ready' : 'needs_connection' };
    }
  }
}

/**
 * Details-card special case (auto_outlook only): a meeting already pushed to Outlook
 * (`outlookEventId` set) with no url never gets an auto link (create-only, §17). The card then
 * shows the paste fallback copy instead of "waiting for sync".
 */
export function teamsLinkOnCreateOnly(external: { outlookEventId: string | null }): boolean {
  return external.outlookEventId !== null;
}

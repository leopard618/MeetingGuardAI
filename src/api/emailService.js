/**
 * COMPAT SHIM (stage 3 removes it). MeetingGuard does not send e-mails from the app: invitations
 * are sent by Google Calendar when a meeting with participants is pushed with sendUpdates
 * (calendar area). The old implementation posted to a backend that no longer exists and, in
 * development, reported fake "sent" results. This module now says honestly that nothing was sent.
 */
import { t } from '../i18n';

export const EMAIL_NOT_SENT_REASON = 'use_calendar_invites';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Always resolves `{ sent: false, reason: 'use_calendar_invites', message }` (nothing is sent).
 * `message` is a localized explanation the UI can show.
 */
export async function sendMeetingInvitations(_meeting, _participants) {
  return { sent: false, reason: EMAIL_NOT_SENT_REASON, message: t('data:email.useCalendarInvites') };
}

export function validateEmail(email) {
  return typeof email === 'string' && EMAIL_PATTERN.test(email.trim());
}

const emailService = {
  sendMeetingInvitations,
  sendMeetingInvitation: (meeting, participant) => sendMeetingInvitations(meeting, [participant]),
  validateEmail,
};

export default emailService;

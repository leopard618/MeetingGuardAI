/**
 * GUESTS area public API (M14): guest invitation links and the guests' answers.
 * Server: functions/src/guests; the page: public/g.
 */
export { GUEST_PAGE_URL, guestLinkUrl, hasGuestLink, newMeetingId, withGuestLink, withoutGuestLink } from './guestLinks';
export { guestService } from './guestService';
export type { GuestAnswer, GuestService } from './guestService';
export { startGuestNotifier } from './notifier';
export { useGuestAnswers } from './useGuestAnswers';

/**
 * Display helpers of the matters screens (A3): times in the device's zone and language, the
 * timeline lines and the cost. Pure.
 */
import type { Language, MatterEventView } from '../../core/aiContract';

const LOCALES: Readonly<Record<Language, string>> = { en: 'en-US', es: 'es-ES' };

/** "Fri, Nov 13, 9:00 AM" in the device's zone (or `timeZone`). */
export function formatWhen(iso: string, language: Language, timeZone?: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return iso;
  return new Intl.DateTimeFormat(LOCALES[language], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    ...(timeZone ? { timeZone } : {}),
  })
    .format(date)
    .replace(/[\u202f\u00a0]/g, ' ');
}

/** The event types the timeline names; any other type shows as a generic update. */
export const TIMELINE_TYPES = [
  'created',
  'mandate_drafted',
  'mandate_confirmed',
  'email_sent',
  'email_failed',
  'email_unconfirmed',
  'email_test',
  'email_received',
  'status_changed',
  'reply_read',
  'reply_not_acted_on',
  'approval_requested',
  'approval_decided',
  'commitment_proposed',
  'commitment_decided',
  'reply_sent',
  'follow_up_sent',
  'email_bounced',
  'spam_complaint',
  'times_offered',
  'meeting_booked',
  'booking_refused',
  'paused',
  'resumed',
  'change_drafted',
  'mandate_changed',
  'question_answered',
  // A3 feedback
  'meeting_moved',
  'message_drafted',
] as const;

/** Events whose detail is meant for people (names, a time); the others carry internal categories. */
const READABLE_DETAIL = new Set(['email_sent', 'email_received', 'email_bounced', 'meeting_booked', 'meeting_moved', 'reply_sent', 'follow_up_sent', 'email_unconfirmed']);

export function timelineKey(event: MatterEventView): string {
  return (TIMELINE_TYPES as readonly string[]).includes(event.type) ? `matters:timeline.type.${event.type}` : 'matters:timeline.type.other';
}

export function timelineDetail(event: MatterEventView): string | null {
  return READABLE_DETAIL.has(event.type) && event.detail.trim() ? event.detail.trim() : null;
}

/** "$0.0042" (a matter costs fractions of a cent per step). */
export function formatCost(usd: number): string {
  return `$${usd < 0.01 ? usd.toFixed(4) : usd.toFixed(2)}`;
}

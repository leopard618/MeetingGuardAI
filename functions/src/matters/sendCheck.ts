/**
 * The send check (docs/v1/ARCHITECTURE.md section 36): plain code, never the model, decides
 * whether an email of a matter may go out. Every send of the assistant goes through it: the
 * first email (A1), the follow-ups (A2) and the meeting confirmations (A3).
 *
 * Allowed only when ALL hold:
 * - the assistant is switched on;
 * - the matter is active (confirmed, not paused, done or cancelled);
 * - its mandate and first email still hash to the confirmed hash (nothing changed since);
 * - the end date has not passed;
 * - there is at least one recipient, every To address is a contact of the mandate, and every Cc
 *   address is a contact or the owner's own verified email;
 * - no recipient is on our own mail domain or a subdomain of it (it would loop into our own
 *   inbound, with our own SPF and DKIM).
 */
import { draftHash, isOwnDomain, type MatterDoc } from './model';

export const SEND_REFUSALS = [
  'switched_off',
  'not_active',
  'not_confirmed',
  'changed_since_confirmation',
  'ended',
  'no_recipients',
  'recipient_not_allowed',
  'own_domain',
] as const;
export type SendRefusal = (typeof SEND_REFUSALS)[number];

export type SendDecision = { ok: true } | { ok: false; reason: SendRefusal };

const norm = (email: string) => email.trim().toLowerCase();

export function checkSend(input: {
  matter: MatterDoc;
  to: readonly string[];
  cc: readonly string[];
  now: Date;
  enabled: boolean;
  /** Our mail domain (MATTERS_MAIL_DOMAIN). */
  domain: string;
}): SendDecision {
  const { matter, now } = input;
  if (!input.enabled) return { ok: false, reason: 'switched_off' };
  if (matter.status !== 'active') return { ok: false, reason: 'not_active' };
  if (!matter.mandate || !matter.firstEmail || !matter.confirmedHash) return { ok: false, reason: 'not_confirmed' };
  if (draftHash(matter.mandate, matter.firstEmail) !== matter.confirmedHash) {
    return { ok: false, reason: 'changed_since_confirmation' };
  }
  if (now.getTime() >= Date.parse(matter.mandate.endsAt)) return { ok: false, reason: 'ended' };
  if (input.to.length === 0) return { ok: false, reason: 'no_recipients' };
  if ([...input.to, ...input.cc].some((email) => isOwnDomain(email, input.domain))) return { ok: false, reason: 'own_domain' };
  const contacts = new Set(matter.mandate.contacts.map((c) => norm(c.email)));
  if (!input.to.every((email) => contacts.has(norm(email)))) return { ok: false, reason: 'recipient_not_allowed' };
  const owner = matter.ownerEmail ? norm(matter.ownerEmail) : null;
  if (!input.cc.every((email) => contacts.has(norm(email)) || norm(email) === owner)) {
    return { ok: false, reason: 'recipient_not_allowed' };
  }
  return { ok: true };
}

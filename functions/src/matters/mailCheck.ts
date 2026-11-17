/**
 * The sender check of an inbound email (A2; docs/v1/ARCHITECTURE.md section 36): is the From of a
 * reply really the contact's domain? Computed by our own code from the raw email, never from the
 * provider's verdicts and never from SPF (Postmark's Received-SPF is kept as a hint only).
 *
 * LOADED LAZILY: it value-imports ../mail/auth.ts, which loads mailauth. Only the inbound webhook
 * requires it, inside its handler (matters/index.ts loadMailCheck), never at deploy time
 * (test/unit/genericModules.test.ts checks that src/index.ts never loads mailauth).
 *
 * verdict:
 * - trusted:    a DKIM signature that passes, is aligned with the strict From domain, signs From,
 *               has no l= and a strong key (mail/auth.ts isPassSig);
 * - unverified: no such signature, no raw email (Postmark's "Include raw email content" is off),
 *               or the check itself failed: the reply is read, but nothing is sent automatically;
 * - malformed:  the headers do not parse strictly, or the raw From is not the From Postmark reports.
 * A valid ARC chain of a trusted sealer (google.com, microsoft.com) is recorded (arcTrusted) but
 * does not make a sender trusted in A2: it says the chain is intact, not who wrote the email.
 * DNS: the From domain gets the priority budget only for a contact or the owner (the routing is
 * fixed from the strict header facts before any lookup, as mail/auth.ts requires).
 * Logs: categories only (mail/auth.ts logs with the 'matters' scope).
 */
import type { DNSResolver } from 'mailauth';

import { TRUSTED_ARC_SEALERS, isPassSig, trustedArcKeyNames, verifyMailAuth, type DnsRouting, type DnsTuning } from '../mail/auth';
import { checkHeaders } from '../mail/headers';
import type { EmailAuth } from './model';

type SpfHint = EmailAuth['spf'];

export interface SenderCheckInput {
  /** Postmark's RawEmail as bytes; null when the payload has none. */
  raw: Buffer | null;
  /** The From address Postmark reports (FromFull.Email). */
  from: string;
  /** Received-SPF as Postmark states it (a hint only). */
  spf: SpfHint;
  /** The From is a mandate contact or the owner: its domain gets the priority DNS budget. */
  priority: boolean;
  now: Date;
  /** Tests: an injected resolver (no network). */
  resolver?: DNSResolver;
  dns?: DnsTuning;
}

export type SenderCheck = (input: SenderCheckInput) => Promise<EmailAuth>;

const result = (verdict: EmailAuth['verdict'], spf: SpfHint, reason: string | null, extra: Partial<EmailAuth> = {}): EmailAuth => ({
  verdict,
  fromAligned: false,
  spf,
  arcTrusted: false,
  reason: reason === null ? null : reason.slice(0, 40),
  ...extra,
});

export const checkSender: SenderCheck = async (input) => {
  if (input.raw === null || input.raw.length === 0) return result('unverified', input.spf, 'no_raw');
  try {
    const header = checkHeaders(input.raw);
    if (!header.ok) return result('malformed', input.spf, header.detail);
    if (header.from !== input.from.trim().toLowerCase()) return result('malformed', input.spf, 'from_mismatch');
    const routing: DnsRouting = {
      priorityDomains: input.priority ? [header.fromDomain] : [],
      alignedDomains: input.priority ? [header.fromDomain] : [],
      priorityKeyNames: trustedArcKeyNames(header.arcKeyNames),
    };
    const verified = await verifyMailAuth(input.raw, {
      now: input.now,
      header,
      routing: () => routing,
      logScope: 'matters',
      ...(input.resolver ? { resolver: input.resolver } : {}),
      ...(input.dns ? { dns: input.dns } : {}),
    });
    if (!verified.ok) return result('malformed', input.spf, verified.detail);
    const fromAligned = verified.signatures.some((sig) => isPassSig(sig, header.fromDomain));
    const arcTrusted = verified.arc.result === 'pass' && verified.arc.sealer !== null && TRUSTED_ARC_SEALERS.includes(verified.arc.sealer);
    if (fromAligned) return result('trusted', input.spf, null, { fromAligned: true, arcTrusted });
    const temporary = verified.signatures.some((sig) => sig.temperror);
    return result('unverified', input.spf, temporary ? 'dns_temperror' : 'no_aligned_signature', { arcTrusted });
  } catch {
    // never fails the store: an email we could not check is simply not trusted
    return result('unverified', input.spf, 'check_error');
  }
};

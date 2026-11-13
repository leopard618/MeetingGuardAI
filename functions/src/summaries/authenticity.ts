/**
 * Authenticity of inbound summary mail (docs/v2/M10-DESIGN.md section 4 steps 6 to 8, section 5,
 * red-team findings 1, 2, 6, 8 and 17): the summaries-only decision. The generic half (the strict
 * From parse, the mailauth run, DKIM and ARC normalization, alignment, passSig, the bounded
 * per-message DNS resolver and the trusted ARC sealers) lives in ../mail/headers.ts and
 * ../mail/auth.ts, shared with the assistant matters.
 *
 * - checkHeaders (../mail/headers.ts): header sanity and the ONE strict From parse (step 6), before
 *   any DNS work. It also reads the ARC key record names, so DNS routing is fixed before any lookup.
 * - runMailAuth: verifyMailAuth (../mail/auth.ts) routed by dnsRouting, with the 'summaries' log
 *   names: mailauth's DKIM verification and ARC chain validation over the raw bytes (step 7),
 *   alignment computed against the strict From domain, the verifier's header parse cross-checked.
 * - classify: PURE. Evaluates decision-table rows 4 to 14 and returns exactly one result; row 5
 *   comes first whenever it applies (below).
 * - assessAuthenticity: the three steps composed for the inbound handler.
 *
 * Deciding domains (decidingDomains), the only domains a temperror can decide for:
 * - Only when the strict From is EXACTLY a SUMMARIES_SENDERS address or a listed mailbox: each
 *   sender and mailbox domain that aligns with the From domain, so the From domain is always one
 *   of them. For any other From (an unlisted colleague, a stranger) there are none, since no
 *   passSig could lead to accept or inbox: a temperror then never retries and never earns a
 *   lookup the priority budget.
 *
 * DNS routing (dnsRouting; the resolver, its cap, the three budgets, EBUDGET and the 32 s hard
 * bound per message are in ../mail/auth.ts):
 * - The routing is fixed before any lookup from the strict From, the ARC key names, the senders
 *   and the mailboxes. The key-record domain of a lookup is the name after its last
 *   "._domainkey.":
 *   - priority (dnsPriorityBudgetMs, 16 s, two caps): any key lookup whose key-record domain
 *     EXACTLY equals a deciding domain, plus google.com when From is exactly the Gmail
 *     confirmation sender (the priority domains); and, for any From, any lookup whose name is
 *     EXACTLY a trusted sealer's ARC key name (the d= and s= of an ARC-Seal or
 *     ARC-Message-Signature in this message whose d= is a TRUSTED_ARC_SEALERS domain).
 *   - aligned (dnsAlignedBudgetMs, 8 s, one cap): a key lookup whose key-record domain ALIGNS
 *     with a deciding domain (or with google.com for the Gmail confirmation sender) but does not
 *     equal a priority domain, as an email service's d=mg.<vendor> does. Of those, only the ones
 *     that also align with the From domain (itself a deciding domain, or google.com) use it,
 *     since only they can make a passSig. A temperror here is never deciding (row 5 needs an
 *     exact deciding domain), so a forged hanging d=lame.<vendor> spends this budget and nothing
 *     else.
 *   - shared (dnsBudgetMs, 8 s, one cap): everything else: forwarding hops, unaligned email
 *     services, attacker zones, and every lookup but the trusted ARC keys of a message whose
 *     From is not exactly a listed sender, a listed mailbox or the Gmail confirmation sender.
 * - Row 5 retries a temperror only for a d= EXACTLY equal to a deciding domain (section 4 step
 *   7), only while 0 <= receivedAt - Date < 5 h, and only when that signature passing could change
 *   the result (its row, or the trust facts B and Fresh). A message that already has its best
 *   result, row 7, is never held back by a temperror on another signature.
 * - runMailAuth and assessAuthenticity take the senders and mailboxes as required inputs and
 *   route their own resolver with dnsRouting; createDnsResolver has no default routing either.
 *
 * Authenticity rests on our own DKIM check, never on the provider's verdicts and never on SPF.
 * Logs carry an error name or a count only: never addresses, subjects, bodies, header text or key
 * material.
 */
import type { DNSResolver } from 'mailauth';

import {
  MAIL_AUTH_TUNING,
  MAILAUTH_VERIFIER,
  NO_ARC,
  TRUSTED_ARC_SEALERS,
  domainsAlign,
  isPassSig,
  normalizeSigningDomain,
  trustedArcKeyNames,
  verifyMailAuth,
  type DnsRouting,
  type DnsTuning,
  type MailAuthResult,
  type NormalizedArc,
  type NormalizedSignature,
  type SignatureResult,
} from '../mail/auth';
import {
  checkHeaders,
  domainOf,
  normalizeAddress,
  parseAddrSpec,
  parseMailDate,
  type HeaderCheck,
  type HeaderFacts,
} from '../mail/headers';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** G: the only sender of Gmail's forwarding confirmation (UNVERIFIED until the first real one). */
export const GMAIL_CONFIRMATION_SENDER = 'forwarding-noreply@google.com';

/**
 * The verifier and DNS tuning of ../mail/auth.ts (MAIL_AUTH_TUNING: minRsaBits and the DNS
 * timeout, tries, cap and three budgets) plus the decision windows of the summaries.
 */
export const AUTHENTICITY_TUNING = {
  ...MAIL_AUTH_TUNING,
  /** Fresh: the signed Date lies within 14 days before receipt ... */
  freshBeforeMs: 14 * DAY_MS,
  /** ... and 24 hours after it. */
  freshAfterMs: 24 * HOUR_MS,
  /**
   * Row 5: a deciding DNS temperror is retried only while the Date header lies at most this long
   * before receipt and before the attempt, and never after either (no future skew, so a forged
   * Date cannot stretch the window).
   */
  temperrorRetryMs: 5 * HOUR_MS,
} as const;

// ---------------------------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------------------------

export type ClassifyOutcome = 'accept' | 'inbox' | 'refuse' | 'gmail' | 'retry';

export type SummaryTier = 'vendor_verified' | 'user_forwarded' | 'gmail_confirmation' | 'none';

export const CLASSIFY_REASONS = [
  'too_large',
  'malformed',
  'dns_temperror',
  'gmail_confirmation',
  'vendor_verified',
  'old_summary',
  'not_addressed_to_you',
  'user_forwarded',
  'could_not_verify_after_forwarding',
  'changed_after_sending',
  'sender_not_verified',
  'not_from_your_notetaker',
] as const;
export type ClassifyReason = (typeof CLASSIFY_REASONS)[number];

/** Decision-table row (section 5); rows 0 to 3 and 15, 16 belong to the inbound handler. */
export type DecisionRow = 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14;

export interface ClassifyInput {
  /** Step 5 and 6 outcome: 'ok', or the row 4 refusal. */
  structure: 'ok' | 'too_large' | 'malformed';
  /** The strict From addr-spec (../mail/headers.ts); null when the strict parse failed. */
  from: string | null;
  /** addr-specs of the To and Cc fields from the strict list parser. */
  to: readonly string[];
  cc: readonly string[];
  /** The Date header value, or null. */
  dateHeader: string | null;
  signatures: readonly NormalizedSignature[];
  arc: NormalizedArc;
  /** When the message was received (Fresh window). */
  receivedAt: Date;
  /** When this attempt runs (row 5 retry window); defaults to receivedAt. */
  now?: Date;
  /** SUMMARIES_SENDERS: exact sender addresses (normalized again here). */
  senders: readonly string[];
  /** The user's listed mailboxes plus the verified account email. */
  mailboxes: readonly string[];
}

export interface Classification {
  row: DecisionRow;
  outcome: ClassifyOutcome;
  tier: SummaryTier;
  reason: ClassifyReason;
  /** B: a listed mailbox is an addr-spec in a To or Cc field the deciding signature covers. */
  recipientBound: boolean;
  /** The deciding signature covers Date and Date lies in the Fresh window. */
  fresh: boolean;
  /** d= of the passSig that decided rows 6 to 10; null on every other row. */
  decidingDomain: string | null;
  /**
   * The only sender domain the app may show (finding 17): the deciding passSig's d=, else the
   * d= of any passSig aligned with From; null otherwise ("an unknown sender").
   */
  senderDomain: string | null;
  /** The signed Date of vendor mail (rows 7 to 9), the matching anchor; null otherwise. */
  anchorAt: Date | null;
  anchorSource: 'signed_date' | null;
}

// ---------------------------------------------------------------------------------------------
// Deciding domains, senders
// ---------------------------------------------------------------------------------------------

/**
 * The domains whose DNS temperror can decide this message (section 4 step 7), for the strict
 * From addr-spec `from`. Empty unless `from` is EXACTLY a SUMMARIES_SENDERS address or a listed
 * mailbox: for any other From no passSig can lead to accept or inbox, so no temperror may retry
 * and no lookup may get the priority budget for it. Otherwise each sender and mailbox domain
 * that aligns with the From domain, the From domain itself always among them. A signature counts
 * only when its d= EXACTLY equals one of them; a subdomain or a parent of one is not one of them.
 * Empty too when `from` is not a plain addr-spec.
 */
export function decidingDomains(from: string, senders: readonly string[], mailboxes: readonly string[]): string[] {
  const address = parseAddrSpec(from.trim());
  const result: string[] = [];
  if (address === null) return result;
  const listed = [...normalizedList(senders), ...normalizedList(mailboxes)];
  if (!listed.includes(address)) return result;
  const fromDomain = domainOf(address);
  for (const entry of listed) {
    const domain = domainOf(entry);
    if (domainsAlign(domain, fromDomain) && !result.includes(domain)) result.push(domain);
  }
  return result;
}

/** SUMMARIES_SENDERS as exact lowercased IDNA ASCII addresses; bare domains and junk dropped. */
export function normalizeSenders(value: string | readonly string[] | undefined | null): string[] {
  if (value === undefined || value === null) return [];
  const entries = typeof value === 'string' ? value.split(',') : value;
  const result: string[] = [];
  for (const entry of entries) {
    const address = normalizeAddress(entry);
    if (address && !result.includes(address)) result.push(address);
  }
  return result;
}

// ---------------------------------------------------------------------------------------------
// DNS routing
// ---------------------------------------------------------------------------------------------

/**
 * The routing of one message, fixed from facts known before any DNS work: the strict From and
 * the ARC key names (checkHeaders) and the configured senders and mailboxes.
 * - priorityDomains: decidingDomains() (none unless From is exactly a listed sender or mailbox),
 *   plus google.com only when From is exactly GMAIL_CONFIRMATION_SENDER (row 6).
 * - alignedDomains: the From domain whenever priorityDomains is not empty (it is then itself a
 *   priority domain), else nothing. So a key-record domain uses the aligned budget when it aligns
 *   with a deciding domain without equalling one AND aligns with the From domain: one aligned
 *   only with another deciding domain can never make a passSig and shares the shared budget.
 * - priorityKeyNames: the ARC-Seal and ARC-Message-Signature key records whose d= is exactly a
 *   TRUSTED_ARC_SEALERS domain (row 11). A DKIM-Signature by google.com or microsoft.com is not
 *   an ARC lookup and is routed by its key-record domain, unless it names that same key record.
 */
export function dnsRouting(
  header: Pick<HeaderFacts, 'from' | 'fromDomain' | 'arcKeyNames'>,
  senders: readonly string[],
  mailboxes: readonly string[],
): Required<DnsRouting> {
  const priorityDomains = decidingDomains(header.from, senders, mailboxes);
  if (header.from === GMAIL_CONFIRMATION_SENDER) {
    const google = domainOf(GMAIL_CONFIRMATION_SENDER);
    if (!priorityDomains.includes(google)) priorityDomains.push(google);
  }
  const fromDomain = normalizeSigningDomain(header.fromDomain);
  const alignedDomains = priorityDomains.length > 0 && fromDomain !== null ? [fromDomain] : [];
  const priorityKeyNames = trustedArcKeyNames(header.arcKeyNames);
  return { priorityDomains, alignedDomains, priorityKeyNames };
}

// ---------------------------------------------------------------------------------------------
// mailauth
// ---------------------------------------------------------------------------------------------

export interface RunMailAuthOptions {
  /** Current time for x= expiry checks. */
  now: Date;
  /** checkHeaders(raw) when the caller already ran it; computed here otherwise. */
  header?: HeaderFacts;
  /**
   * SUMMARIES_SENDERS and the user's mailboxes. Required: without an injected resolver they route
   * this message's lookups (dnsRouting with the strict From), so leaving them out can never
   * silently put every lookup, the deciding and aligned ones included, in the shared budget.
   */
  senders: readonly string[];
  mailboxes: readonly string[];
  /** Injected DNS resolver (tests); otherwise a fresh createDnsResolver per call, routed by dnsRouting. */
  resolver?: DNSResolver;
  /** Budgets and test seams for that fresh resolver; ignored with `resolver`. */
  dns?: DnsTuning;
}

/**
 * DKIM verification of every signature plus ARC chain validation, normalized (verifyMailAuth,
 * ../mail/auth.ts, logging as 'summaries'). Alignment is computed against the strict From domain.
 * A verifier crash or a header parse that differs from ours is malformed (row 4). Without an
 * injected resolver, the per-call resolver's priority and aligned budgets serve exactly
 * dnsRouting(header, senders, mailboxes).
 */
export function runMailAuth(raw: Buffer, options: RunMailAuthOptions): Promise<MailAuthResult> {
  return verifyMailAuth(raw, {
    now: options.now,
    header: options.header,
    resolver: options.resolver,
    dns: options.dns,
    routing: (header) => dnsRouting(header, options.senders, options.mailboxes),
    logScope: 'summaries',
  });
}

/** The auth block stored on a summary (section 7): at most 5 signatures, no b= values. */
export function storedAuth(signatures: readonly NormalizedSignature[], arc: NormalizedArc): {
  dkim: { domain: string; result: SignatureResult; aligned: boolean; signsTo: boolean; signsDate: boolean }[];
  arc: NormalizedArc;
  verifier: string;
} {
  return {
    dkim: signatures.slice(0, 5).map((sig) => ({
      domain: sig.domain,
      result: sig.result,
      aligned: sig.aligned,
      signsTo: sig.signsTo,
      signsDate: sig.signsDate,
    })),
    arc: { result: arc.result, sealer: arc.sealer },
    verifier: MAILAUTH_VERIFIER,
  };
}

// ---------------------------------------------------------------------------------------------
// classify (pure)
// ---------------------------------------------------------------------------------------------

interface SignatureFacts {
  sig: NormalizedSignature;
  bound: boolean;
  fresh: boolean;
  anchorAt: Date | null;
}

function normalizedList(values: readonly string[]): string[] {
  const result: string[] = [];
  for (const value of values) {
    const address = normalizeAddress(value);
    if (address && !result.includes(address)) result.push(address);
  }
  return result;
}

function recipientList(values: readonly string[]): string[] {
  const result: string[] = [];
  for (const value of values) {
    const address = parseAddrSpec(value.trim());
    if (address) result.push(address);
  }
  return result;
}

/** B, Fresh and the anchor for one passSig; the best one (B and Fresh first) decides. */
function decide(
  passSigs: readonly NormalizedSignature[],
  mailboxes: readonly string[],
  to: readonly string[],
  cc: readonly string[],
  date: Date | null,
  receivedAtMs: number,
): SignatureFacts {
  const listedIn = (addresses: readonly string[]): boolean => addresses.some((address) => mailboxes.includes(address));
  const dateMs = date === null ? null : date.getTime();
  const facts = passSigs.map((sig): SignatureFacts => {
    const bound = (sig.signsTo && listedIn(to)) || (sig.signsCc && listedIn(cc));
    const fresh =
      sig.signsDate &&
      dateMs !== null &&
      dateMs >= receivedAtMs - AUTHENTICITY_TUNING.freshBeforeMs &&
      dateMs <= receivedAtMs + AUTHENTICITY_TUNING.freshAfterMs;
    return { sig, bound, fresh, anchorAt: sig.signsDate && date !== null ? date : null };
  });
  const rank = (entry: SignatureFacts): number => (entry.bound ? 2 : 0) + (entry.fresh ? 1 : 0);
  let best = facts[0];
  for (const entry of facts) {
    if (best === undefined || rank(entry) > rank(best)) best = entry;
  }
  if (best === undefined) throw new Error('decide() needs at least one passSig');
  return best;
}

function classification(
  row: DecisionRow,
  outcome: ClassifyOutcome,
  reason: ClassifyReason,
  extra: Partial<Omit<Classification, 'row' | 'outcome' | 'reason'>> = {},
): Classification {
  return {
    row,
    outcome,
    reason,
    tier: 'none',
    recipientBound: false,
    fresh: false,
    decidingDomain: null,
    senderDomain: null,
    anchorAt: null,
    anchorSource: null,
    ...extra,
  };
}

/** What rows 6 to 14 read besides the signatures, normalized once by classify. */
interface MessageFacts {
  from: string;
  fromDomain: string;
  senders: readonly string[];
  mailboxes: readonly string[];
  senderDomains: readonly string[];
  to: readonly string[];
  cc: readonly string[];
  date: Date | null;
  receivedAtMs: number;
  arc: NormalizedArc;
}

/** Rows 6 to 14, evaluated in order, for one set of signatures. Pure and total. */
function classifyVerified(facts: MessageFacts, signatures: readonly NormalizedSignature[]): Classification {
  const { from, senders, mailboxes } = facts;
  const passSigs = signatures.filter((sig) => isPassSig(sig, facts.fromDomain));
  const authenticDomain = passSigs[0]?.domain ?? null;

  // Row 6: G, Gmail's forwarding confirmation with a google.com passSig.
  if (from === GMAIL_CONFIRMATION_SENDER && passSigs.length > 0) {
    const domain = passSigs[0]?.domain ?? null;
    return classification(6, 'gmail', 'gmail_confirmation', {
      tier: 'gmail_confirmation',
      decidingDomain: domain,
      senderDomain: domain,
    });
  }

  // Rows 7 to 9: V, an exact listed sender with a passSig.
  if (senders.includes(from) && passSigs.length > 0) {
    const best = decide(passSigs, mailboxes, facts.to, facts.cc, facts.date, facts.receivedAtMs);
    const extra = {
      tier: 'vendor_verified' as const,
      recipientBound: best.bound,
      fresh: best.fresh,
      decidingDomain: best.sig.domain,
      senderDomain: best.sig.domain,
      anchorAt: best.anchorAt,
      anchorSource: best.anchorAt === null ? null : ('signed_date' as const),
    };
    if (best.bound && best.fresh) return classification(7, 'accept', 'vendor_verified', extra);
    if (best.bound) return classification(8, 'inbox', 'old_summary', extra);
    return classification(9, 'inbox', 'not_addressed_to_you', extra);
  }

  // Row 10: U, From is exactly one of the user's mailboxes with a passSig. Never auto-filed;
  // the anchor comes from the forward wrapper (sections), not from the outer Date.
  if (mailboxes.includes(from) && passSigs.length > 0) {
    const best = decide(passSigs, mailboxes, facts.to, facts.cc, facts.date, facts.receivedAtMs);
    return classification(10, 'inbox', 'user_forwarded', {
      tier: 'user_forwarded',
      recipientBound: best.bound,
      fresh: best.fresh,
      decidingDomain: best.sig.domain,
      senderDomain: best.sig.domain,
    });
  }

  // Rows 11 and 12: T, a signature by a listed sender's domain is present but fails (no V here).
  const tampered = signatures.some(
    (sig) => sig.result === 'fail' && facts.senderDomains.some((domain) => domainsAlign(sig.domain, domain)),
  );
  if (tampered) {
    const arc = facts.arc;
    const trustedChain = arc.result === 'pass' && arc.sealer !== null && TRUSTED_ARC_SEALERS.includes(arc.sealer);
    if (trustedChain) return classification(11, 'refuse', 'could_not_verify_after_forwarding', { senderDomain: authenticDomain });
    return classification(12, 'refuse', 'changed_after_sending', { senderDomain: authenticDomain });
  }

  // Row 13: From claims a listed sender or a user mailbox, without a passSig.
  if (senders.includes(from) || mailboxes.includes(from)) {
    return classification(13, 'refuse', 'sender_not_verified', { senderDomain: authenticDomain });
  }

  // Row 14: everything else.
  return classification(14, 'refuse', 'not_from_your_notetaker', { senderDomain: authenticDomain });
}

/**
 * The best a temperror signature could turn out to be once its key is fetched: a pass with a key
 * of at least minRsaBits that is not a t=y testing key. What the signature itself states (d=,
 * h=, l=, a=) stays as it is, so one that could never be a passSig still is not one.
 */
function asIfPassed(sig: NormalizedSignature): NormalizedSignature {
  return {
    ...sig,
    result: 'pass',
    temperror: false,
    testing: false,
    bits: Math.max(sig.bits ?? 0, AUTHENTICITY_TUNING.minRsaBits),
  };
}

/**
 * Same result for row 5: the same row and the same trust facts B and Fresh. decide() maximizes
 * exactly these, so the comparison never depends on signature order.
 */
function sameResult(a: Classification, b: Classification): boolean {
  return a.row === b.row && a.recipientBound === b.recipientBound && a.fresh === b.fresh;
}

/**
 * The decision table, rows 4 to 14 (section 5). Pure and total: every input yields exactly one
 * row. Row 4 is evaluated first, then rows 6 to 14 in order; row 5 takes precedence over their
 * result only when a retry could change it.
 */
export function classify(input: ClassifyInput): Classification {
  // Row 4: too large, malformed structure, header sanity or strict From failed.
  if (input.structure !== 'ok') return classification(4, 'refuse', input.structure);
  const from = input.from === null ? null : parseAddrSpec(input.from.trim());
  if (!from) return classification(4, 'refuse', 'malformed');

  const senders = normalizedList(input.senders);
  const mailboxes = normalizedList(input.mailboxes);
  const date = input.dateHeader === null ? null : parseMailDate(input.dateHeader);
  const facts: MessageFacts = {
    from,
    fromDomain: domainOf(from),
    senders,
    mailboxes,
    senderDomains: senders.map(domainOf),
    to: recipientList(input.to),
    cc: recipientList(input.cc),
    date,
    receivedAtMs: input.receivedAt.getTime(),
    arc: input.arc,
  };
  const settled = classifyVerified(facts, input.signatures);

  // Row 5: a temperror on a signature that could still become the deciding passSig: its d=
  // EXACTLY equals a deciding domain, which exists only when From is exactly a listed sender or
  // mailbox (decidingDomains; section 4 step 7). A subdomain or a parent of one never decides,
  // and its lookup never has the priority DNS budget (at most the aligned one). A lookup refused
  // for DNS budget arrives here as neutral, never as temperror. Retried only while 0 <= receivedAt - Date < 5 h, and the same at this attempt:
  // a Date after receipt (future skew) never earns a retry, so a forged Date cannot stretch the
  // window. And only when those signatures passing could change the result (row, B or Fresh):
  // a message already at its best result, such as row 7, is never held back. After the window
  // the signature simply does not pass.
  const deciding = decidingDomains(from, senders, mailboxes);
  const isDecidingTemperror = (sig: NormalizedSignature): boolean => {
    const domain = normalizeSigningDomain(sig.domain);
    return sig.result === 'temperror' && domain !== null && deciding.includes(domain);
  };
  if (date === null || !input.signatures.some(isDecidingTemperror)) return settled;
  const dateMs = date.getTime();
  const nowMs = (input.now ?? input.receivedAt).getTime();
  const inRetryWindow = (atMs: number): boolean => atMs - dateMs >= 0 && atMs - dateMs < AUTHENTICITY_TUNING.temperrorRetryMs;
  if (!inRetryWindow(facts.receivedAtMs) || !inRetryWindow(nowMs)) return settled;
  const hoped = classifyVerified(
    facts,
    input.signatures.map((sig) => (isDecidingTemperror(sig) ? asIfPassed(sig) : sig)),
  );
  return sameResult(settled, hoped) ? settled : classification(5, 'retry', 'dns_temperror');
}

// ---------------------------------------------------------------------------------------------
// Composition for the inbound handler
// ---------------------------------------------------------------------------------------------

export interface AuthenticityContext {
  /** Injected DNS resolver (tests); otherwise one per message, routed by dnsRouting(). */
  resolver?: DNSResolver;
  /** Budgets and test seams for that per-message resolver; the routing is always dnsRouting(). */
  dns?: DnsTuning;
  receivedAt: Date;
  /** Time of this attempt (row 5 window and x= expiry); defaults to receivedAt. */
  now?: Date;
  senders: readonly string[];
  mailboxes: readonly string[];
}

export interface AuthenticityAssessment {
  classification: Classification;
  header: HeaderCheck;
  /** Null when header sanity failed before any DNS work. */
  mailAuth: MailAuthResult | null;
}

/** Steps 6 to 8: header sanity, mailauth, classify. Never throws for message content. */
export async function assessAuthenticity(raw: Buffer, context: AuthenticityContext): Promise<AuthenticityAssessment> {
  const common = {
    receivedAt: context.receivedAt,
    now: context.now ?? context.receivedAt,
    senders: context.senders,
    mailboxes: context.mailboxes,
  };
  const malformed = (): Classification =>
    classify({ ...common, structure: 'malformed', from: null, to: [], cc: [], dateHeader: null, signatures: [], arc: NO_ARC });

  // Header sanity (including the DKIM-Signature cap) runs before any DNS work, and fixes the
  // strict From and the ARC key names the DNS routing is computed from.
  const header = checkHeaders(raw);
  if (!header.ok) return { classification: malformed(), header, mailAuth: null };
  const mailAuth = await runMailAuth(raw, {
    now: context.now ?? context.receivedAt,
    header,
    senders: context.senders,
    mailboxes: context.mailboxes,
    resolver: context.resolver,
    dns: context.dns,
  });
  if (!mailAuth.ok) return { classification: malformed(), header, mailAuth };
  const classification = classify({
    ...common,
    structure: 'ok',
    from: header.from,
    to: header.to,
    cc: header.cc,
    dateHeader: header.date,
    signatures: mailAuth.signatures,
    arc: mailAuth.arc,
  });
  return { classification, header, mailAuth };
}

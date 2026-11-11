/**
 * Authenticity of inbound summary mail (docs/v2/M10-DESIGN.md section 4 steps 6 to 8, section 5,
 * red-team findings 1, 2, 6, 8 and 17).
 *
 * - checkHeaders (./headers.ts): header sanity and the ONE strict From parse (step 6), before any
 *   DNS work. It also reads the ARC key record names, so DNS routing is fixed before any lookup.
 * - runMailAuth: mailauth's DKIM verification and ARC chain validation over the raw bytes (step
 *   7). Every signature is normalized; alignment is computed here against the strict From
 *   domain, never taken from mailauth's status.aligned. The verifier's own header parse is
 *   cross-checked against ours; any disagreement is malformed. A DKIM d= or ARC sealer d= that
 *   is not plain ASCII LDH yields no domain (nothing is mapped), so the domain we align is always
 *   the domain whose key mailauth fetched.
 * - createDnsResolver: per-message DNS with a hard time bound (below).
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
 * DNS, exactly:
 * - TXT only, one cache per message, node:dns with a 4 s timeout and 2 tries.
 * - A lookup waits at most dnsLookupCapMs (8 s). Cut there, it fails with ETIMEOUT (a real
 *   temperror) and is charged exactly the cap, never the timer's lateness.
 * - Every lookup draws on exactly one of three budgets of waiting time, each counted only while
 *   one of its own lookups is in flight. The routing (dnsRouting) is fixed before any lookup from
 *   the strict From, the ARC key names, the senders and the mailboxes. The key-record domain of a
 *   lookup is the name after its last "._domainkey.":
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
 * - A lookup refused or cut short because its budget is spent fails with EBUDGET, which
 *   normalizeSignature reads as "no key" (neutral). It counts as no signature: never a passSig,
 *   never tampered, never a temperror, never a retry.
 * - Hard bound per message: dnsBudgetMs + dnsAlignedBudgetMs + dnsPriorityBudgetMs (32 s,
 *   DNS_MESSAGE_BOUND_MS) of DNS waiting, plus the lateness of at most a few timers, inside the
 *   60 s function timeout. Each budget bounds its own lookups, concurrent ones included.
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
import * as logger from 'firebase-functions/logger';
import { promises as dnsPromises } from 'node:dns';
import { arc as verifyArc, dkimVerify, type DKIMResult, type DKIMVerifyResult, type DNSResolver } from 'mailauth';

import {
  checkHeaders,
  domainOf,
  normalizeAddress,
  normalizeDomain,
  parseAddrSpec,
  parseMailDate,
  type HeaderCheck,
  type HeaderFacts,
  type HeaderFailureDetail,
} from './headers';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** Recorded on every summary as auth.verifier (section 7). A test pins it to the installed version. */
export const MAILAUTH_VERIFIER = 'mailauth@8.0.4';

/** G: the only sender of Gmail's forwarding confirmation (UNVERIFIED until the first real one). */
export const GMAIL_CONFIRMATION_SENDER = 'forwarding-noreply@google.com';

/** Row 11: ARC sealers whose valid chain turns changed_after_sending into the forwarding advice. */
export const TRUSTED_ARC_SEALERS: readonly string[] = ['google.com', 'microsoft.com'];

export const AUTHENTICITY_TUNING = {
  /** passSig: RSA keys shorter than this never pass. */
  minRsaBits: 1024,
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
  /** Production resolver: node:dns per-query timeout and tries. */
  dnsTimeoutMs: 4000,
  dnsTries: 2,
  /**
   * Hard cap on waiting for one lookup, node:dns retries included; then ETIMEOUT (a real
   * temperror), charged to its budget as exactly this much.
   */
  dnsLookupCapMs: 8000,
  /**
   * Shared budget: waiting time for every lookup that is neither priority nor aligned (attacker
   * zones, unaligned email services, forwarding hops). One full cap. Once spent, lookups fail
   * with EBUDGET, which is never a temperror.
   */
  dnsBudgetMs: 8000,
  /**
   * Aligned budget: waiting time for the lookups whose key-record domain aligns with a deciding
   * domain and the From domain without equalling a priority domain (an email service's
   * d=mg.<vendor>), kept apart so a hanging forwarding hop cannot starve them. One full cap. A
   * temperror here never decides, so a forged hanging subdomain can spend only this budget.
   */
  dnsAlignedBudgetMs: 8000,
  /**
   * Priority budget: waiting time for the lookups whose key-record domain exactly equals a
   * deciding domain, google.com for the Gmail confirmation sender, and the trusted sealers' ARC
   * keys (dnsRouting), kept apart so neither other budget can starve them. Two full caps.
   */
  dnsPriorityBudgetMs: 16_000,
} as const;

/**
 * Hard bound on the DNS waiting of one message: the three budgets together (32 s), plus the
 * lateness of at most a few timers, inside the 60 s function timeout.
 */
export const DNS_MESSAGE_BOUND_MS =
  AUTHENTICITY_TUNING.dnsBudgetMs + AUTHENTICITY_TUNING.dnsAlignedBudgetMs + AUTHENTICITY_TUNING.dnsPriorityBudgetMs;

/**
 * Error code of a key lookup refused or cut short because its DNS budget was spent. It says
 * nothing about the signer, so the signature counts as having no key (neutral): never a
 * temperror, never a retry.
 */
export const DNS_BUDGET_CODE = 'EBUDGET';

/** Algorithms a passSig may use. rsa-sha1 and anything unknown never pass. */
const STRONG_ALGORITHMS: ReadonlySet<string> = new Set(['rsa-sha256', 'ed25519-sha256']);

// ---------------------------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------------------------

/**
 * Normalized DKIM result. 'fail' covers both a bad signature (header changed) and a body hash
 * mismatch (body changed; mailauth's lenient mode reports that one as neutral). 'neutral' is
 * everything that is not a cryptographic verdict (no key, syntax error, expired).
 */
export type SignatureResult = 'pass' | 'fail' | 'neutral' | 'policy' | 'temperror';

export interface NormalizedSignature {
  /**
   * d=, lowercased plain ASCII LDH without a trailing dot: exactly the domain whose key was
   * fetched. A signature whose d= has any other form is left out (normalizeSigningDomain).
   */
  domain: string;
  /** s=, as written. */
  selector: string;
  result: SignatureResult;
  /** d= equals the strict From domain or one is a subdomain of the other (computed here). */
  aligned: boolean;
  /** The header row of each name was covered by this signature (from the verifier's h= walk). */
  signsFrom: boolean;
  signsTo: boolean;
  signsCc: boolean;
  signsDate: boolean;
  /** The signature has an l= body length limit. */
  bodyLengthLimited: boolean;
  /** a=, lowercased, e.g. 'rsa-sha256'. */
  algo: string;
  /** RSA modulus length from the key record, null when unknown (no key fetched, ed25519). */
  bits: number | null;
  /** The key record has t=y. */
  testing: boolean;
  /** The key lookup failed temporarily (DNS). */
  temperror: boolean;
  /** b= value, the step 11 messageKey fallback. Content: never log it. */
  signatureValue: string | null;
}

export interface NormalizedArc {
  result: 'pass' | 'fail' | 'none';
  /** d= of the newest ARC-Seal, lowercased plain ASCII LDH; null without a chain or for any other form. */
  sealer: string | null;
}

export const NO_ARC: NormalizedArc = { result: 'none', sealer: null };

export type MailAuthFailureDetail = HeaderFailureDetail | 'verifier_error' | 'parser_mismatch';

export type MailAuthResult =
  | { ok: true; signatures: NormalizedSignature[]; arc: NormalizedArc }
  | { ok: false; reason: 'malformed'; detail: MailAuthFailureDetail };

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
  /** The strict From addr-spec (headers.ts); null when the strict parse failed. */
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
// Domains, senders, passSig
// ---------------------------------------------------------------------------------------------

/**
 * A signing or sealing domain (DKIM d=, ARC-Seal d=) as alignment uses it, or null. Only plain
 * ASCII LDH is accepted (letters, digits, "-" and dots; no label starting or ending with "-";
 * at least two labels; at most 253 characters; one trailing root dot dropped), then lowercased.
 * Nothing is mapped: mailauth fetches the key of a non-ASCII d= at the Punycode of the labels as
 * written, while UTS46 mapping (domainToASCII) could turn that same d= into a listed domain. So
 * a d= with any non-ASCII character, underscore, whitespace or other character yields NO domain:
 * the signature is left out, never aligned and never deciding, and such a sealer is never trusted.
 */
export function normalizeSigningDomain(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return normalizeDomain(value.endsWith('.') ? value.slice(0, -1) : value);
}

/**
 * Alignment as section 5 defines it: equal, or one a subdomain of the other. Both sides need at
 * least two labels, so a bare top-level domain never aligns with anything.
 */
export function domainsAlign(a: string, b: string): boolean {
  const x = a.toLowerCase().replace(/\.$/, '');
  const y = b.toLowerCase().replace(/\.$/, '');
  if (!x.includes('.') || !y.includes('.')) return false;
  return x === y || x.endsWith(`.${y}`) || y.endsWith(`.${x}`);
}

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

/**
 * passSig (section 5): pass, aligned with the From domain, "from" signed, no l=, a strong
 * algorithm (never rsa-sha1), an RSA key of at least 1024 bits, not a t=y testing key.
 */
export function isPassSig(sig: NormalizedSignature, fromDomain: string): boolean {
  if (sig.result !== 'pass' || sig.temperror) return false;
  if (!domainsAlign(sig.domain, fromDomain)) return false;
  if (!sig.signsFrom || sig.bodyLengthLimited || sig.testing) return false;
  const algo = sig.algo.toLowerCase();
  if (!STRONG_ALGORITHMS.has(algo)) return false;
  if (algo.startsWith('rsa-') && (sig.bits === null || sig.bits < AUTHENTICITY_TUNING.minRsaBits)) return false;
  return true;
}

// ---------------------------------------------------------------------------------------------
// DNS
// ---------------------------------------------------------------------------------------------

function dnsError(code: string): Error {
  return Object.assign(new Error(`dns ${code}`), { code });
}

/**
 * Which of the three budgets each lookup of one message draws on. Priority is by exact match
 * only; aligned is by alignment, and never for an exact priority domain.
 */
export interface DnsRouting {
  /**
   * Key-record domains (the d= after the last "._domainkey.") whose lookups use the priority
   * budget, matched EXACTLY: a subdomain of one is not one of them. Required, with no default, so
   * no caller can put every lookup in the shared budget by leaving it out; pass dnsRouting(), or
   * an explicit [] when no lookup is meant to have priority.
   */
  priorityDomains: readonly string[];
  /**
   * A lookup whose key-record domain aligns (domainsAlign: equal, or a subdomain or a parent)
   * with one of these and is not exactly one of priorityDomains uses the aligned budget. Required
   * for the same reason; pass dnsRouting(), or an explicit [] when nothing is meant to use it.
   */
  alignedDomains: readonly string[];
  /** Exact key record names ("selector._domainkey.domain") that use priority too: trusted ARC keys. */
  priorityKeyNames?: readonly string[];
}

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
  const sealers = TRUSTED_ARC_SEALERS.map((sealer) => normalizeSigningDomain(sealer));
  const priorityKeyNames = header.arcKeyNames.filter((name) => {
    const domain = keyRecordDomain(name);
    return domain !== null && sealers.includes(domain);
  });
  return { priorityDomains, alignedDomains, priorityKeyNames };
}

export interface DnsResolverOptions extends DnsRouting {
  timeoutMs?: number;
  tries?: number;
  /**
   * Hard cap on waiting for one lookup; a lookup still unanswered then fails with ETIMEOUT and is
   * charged exactly this much.
   */
  lookupCapMs?: number;
  /**
   * Shared budget: waiting time for every lookup that is neither priority nor aligned. Once
   * spent, new lookups fail at once and running ones are cut, both with EBUDGET.
   */
  budgetMs?: number;
  /** Aligned budget: waiting time for the routing's aligned lookups, kept apart from the others. */
  alignedBudgetMs?: number;
  /** Priority budget: waiting time for the routing's priority lookups, kept apart from the others. */
  priorityBudgetMs?: number;
  /** Test seam: replaces the node:dns TXT lookup. */
  lookupTxt?: (name: string) => Promise<string[][]>;
  /** Test seam: replaces Date.now. */
  clock?: () => number;
}

/** Budgets and test seams of a per-message resolver; the routing always comes from dnsRouting(). */
export type DnsTuning = Omit<DnsResolverOptions, keyof DnsRouting>;

const DKIM_KEY_LABEL = '._domainkey.';

/**
 * The d= of a DKIM key record name "selector._domainkey.domain", or null for any other name.
 * The LAST "._domainkey." splits, so a selector that spells another domain cannot borrow it.
 */
export function keyRecordDomain(name: string): string | null {
  const lower = name.toLowerCase();
  const index = lower.lastIndexOf(DKIM_KEY_LABEL);
  if (index <= 0) return null;
  return normalizeSigningDomain(lower.slice(index + DKIM_KEY_LABEL.length));
}

/** Routing domains as signing domains (normalizeSigningDomain), unusable entries dropped. */
function signingDomains(values: readonly string[]): string[] {
  const result: string[] = [];
  for (const value of values) {
    const domain = normalizeSigningDomain(value);
    if (domain !== null && !result.includes(domain)) result.push(domain);
  }
  return result;
}

/**
 * Waiting time of one budget, counted only while at least one of its lookups is in flight: each
 * busy period costs from its first start to the latest charged end of its lookups.
 */
interface LookupPool {
  budgetMs: number;
  spentMs: number;
  inFlight: number;
  busySince: number;
  busyUntil: number;
}

function lookupPool(budgetMs: number): LookupPool {
  return { budgetMs, spentMs: 0, inFlight: 0, busySince: 0, busyUntil: 0 };
}

function remainingMs(pool: LookupPool, now: number): number {
  return pool.budgetMs - pool.spentMs - (pool.inFlight > 0 ? now - pool.busySince : 0);
}

/**
 * Runs one lookup on `pool`, cut at `deadlineMs` with `cutCode`. It is charged its waiting time
 * but never more than the deadline: a cut lookup costs exactly deadlineMs (a late timer is not
 * charged), and an answer that lands after the deadline time costs the deadline. So two lookups
 * cut at the cap fit a budget of twice the cap. The charge is booked before the caller sees the
 * outcome, so the caller's next lookup already sees the budget left.
 */
function boundedLookup(
  pool: LookupPool,
  run: () => Promise<string[][]>,
  startedAt: number,
  deadlineMs: number,
  cutCode: string,
  clock: () => number,
): Promise<string[][]> {
  if (pool.inFlight === 0) {
    pool.busySince = startedAt;
    pool.busyUntil = startedAt;
  }
  pool.inFlight += 1;
  const deadlineAt = startedAt + deadlineMs;
  return new Promise<string[][]>((resolve, reject) => {
    let settled = false;
    const settle = (endMs: number): boolean => {
      if (settled) return false;
      settled = true;
      clearTimeout(timer);
      pool.busyUntil = Math.max(pool.busyUntil, endMs);
      pool.inFlight -= 1;
      if (pool.inFlight === 0) pool.spentMs += pool.busyUntil - pool.busySince;
      return true;
    };
    const timer = setTimeout(() => {
      if (settle(deadlineAt)) reject(dnsError(cutCode));
    }, deadlineMs);
    Promise.resolve()
      .then(run)
      .then(
        (records) => {
          if (settle(Math.min(clock(), deadlineAt))) resolve(records);
        },
        (error: unknown) => {
          if (settle(Math.min(clock(), deadlineAt))) reject(error);
        },
      );
  });
}

/**
 * Production resolver for one message: node:dns with a 4 s timeout and 2 tries, TXT only, one
 * cache per instance (create one per message). Errors keep node:dns codes, so mailauth reports
 * ENOTFOUND and ENODATA as "no key" and everything else as temperror.
 *
 * Time is bounded twice. Each lookup waits at most lookupCapMs, then ETIMEOUT (a real temperror),
 * charged exactly lookupCapMs. And each lookup draws on exactly one of three budgets of waiting
 * time, chosen by its name alone:
 * - priorityBudgetMs: the name is one of `priorityKeyNames`, or its key-record domain EXACTLY
 *   equals one of `priorityDomains`;
 * - alignedBudgetMs: otherwise, its key-record domain aligns with one of `alignedDomains`;
 * - budgetMs: every other lookup, including any name that is not a key record name.
 * So signatures from a hanging zone placed above the vendor's spend only the shared budget, and a
 * hanging subdomain only the aligned one. A lookup that would get less than the cap is cut at the
 * budget left instead, and a lookup refused or cut because its budget is spent fails with
 * EBUDGET, which normalizeSignature turns into "no key", never a deciding temperror. The hard
 * bound per message is budgetMs + alignedBudgetMs + priorityBudgetMs. The routing is required
 * (no default); see DnsRouting.
 */
export function createDnsResolver(options: DnsResolverOptions): DNSResolver {
  const clock = options.clock ?? Date.now;
  const capMs = options.lookupCapMs ?? AUTHENTICITY_TUNING.dnsLookupCapMs;
  const shared = lookupPool(options.budgetMs ?? AUTHENTICITY_TUNING.dnsBudgetMs);
  const aligned = lookupPool(options.alignedBudgetMs ?? AUTHENTICITY_TUNING.dnsAlignedBudgetMs);
  const priority = lookupPool(options.priorityBudgetMs ?? AUTHENTICITY_TUNING.dnsPriorityBudgetMs);
  const priorityDomains = new Set(signingDomains(options.priorityDomains));
  const alignedDomains = signingDomains(options.alignedDomains);
  const priorityNames = new Set((options.priorityKeyNames ?? []).map((name) => name.toLowerCase()));
  const poolFor = (name: string): LookupPool => {
    if (priorityNames.has(name)) return priority;
    const domain = keyRecordDomain(name);
    if (domain === null) return shared;
    if (priorityDomains.has(domain)) return priority;
    return alignedDomains.some((anchor) => domainsAlign(domain, anchor)) ? aligned : shared;
  };
  let lookupTxt = options.lookupTxt;
  if (!lookupTxt) {
    const resolver = new dnsPromises.Resolver({
      timeout: options.timeoutMs ?? AUTHENTICITY_TUNING.dnsTimeoutMs,
      tries: options.tries ?? AUTHENTICITY_TUNING.dnsTries,
    });
    lookupTxt = (name) => resolver.resolveTxt(name);
  }
  const lookup = lookupTxt;
  const cache = new Map<string, Promise<string[][]>>();
  return async (domain: string, rrtype: string): Promise<string[][]> => {
    if (rrtype.toUpperCase() !== 'TXT') throw dnsError('ENOTIMP');
    const name = domain.toLowerCase();
    const cached = cache.get(name);
    if (cached) return cached;
    const pool = poolFor(name);
    const startedAt = clock();
    const leftMs = remainingMs(pool, startedAt);
    if (leftMs <= 0) throw dnsError(DNS_BUDGET_CODE);
    // Cut at the cap (a real timeout) or, when the budget left is shorter, at the budget.
    const deadlineMs = Math.min(capMs, leftMs);
    const pending = boundedLookup(pool, () => lookup(name), startedAt, deadlineMs, leftMs < capMs ? DNS_BUDGET_CODE : 'ETIMEOUT', clock);
    cache.set(name, pending);
    return pending;
  };
}

// ---------------------------------------------------------------------------------------------
// mailauth
// ---------------------------------------------------------------------------------------------

function signedHeaderNames(result: DKIMResult): Set<string> {
  const keys = result.signingHeaders?.keys ?? '';
  return new Set(
    keys
      .split(':')
      .map((key) => key.trim().toLowerCase())
      .filter((key) => key.length > 0),
  );
}

/** mailauth 8.0.4 reports a key lookup that failed with code X as temperror "DNS failure: X". */
const BUDGET_COMMENT = `DNS failure: ${DNS_BUDGET_CODE}`;

/** The key lookup was refused or cut because its DNS budget was spent. */
export function isBudgetRefusal(result: DKIMResult): boolean {
  const status = result.status.result;
  return (status === 'temperror' || status === 'temperr') && result.status.comment === BUDGET_COMMENT;
}

/**
 * Maps one mailauth DKIM result. Null for the "message not signed" placeholder and for a d= that
 * is not plain ASCII LDH (normalizeSigningDomain): such a signature has no domain, so it is never
 * aligned, never a passSig, never a temperror that decides and never stored. A lookup refused for
 * budget (EBUDGET) is "no key" (neutral), never temperror, so it can never decide row 5.
 */
export function normalizeSignature(result: DKIMResult, fromDomain: string | null): NormalizedSignature | null {
  const domain = normalizeSigningDomain(result.signingDomain);
  if (!domain) return null;
  const signed = signedHeaderNames(result);
  const bodyHashFailed =
    typeof result.bodyHash === 'string' &&
    typeof result.bodyHashExpecting === 'string' &&
    result.bodyHash !== result.bodyHashExpecting;
  let normalized: SignatureResult;
  switch (result.status.result) {
    case 'pass':
      normalized = bodyHashFailed ? 'fail' : 'pass';
      break;
    case 'fail':
      normalized = 'fail';
      break;
    case 'temperror':
    case 'temperr':
      normalized = isBudgetRefusal(result) ? 'neutral' : 'temperror';
      break;
    case 'policy':
      normalized = 'policy';
      break;
    default:
      normalized = bodyHashFailed ? 'fail' : 'neutral';
  }
  const bits = typeof result.modulusLength === 'number' && Number.isFinite(result.modulusLength) ? result.modulusLength : null;
  return {
    domain,
    selector: typeof result.selector === 'string' ? result.selector : '',
    result: normalized,
    aligned: fromDomain !== null && domainsAlign(domain, fromDomain),
    signsFrom: signed.has('from'),
    signsTo: signed.has('to'),
    signsCc: signed.has('cc'),
    signsDate: signed.has('date'),
    bodyLengthLimited: result.canonBodyLengthLimited === true,
    algo: typeof result.algo === 'string' ? result.algo.trim().toLowerCase() : '',
    bits,
    testing: result.status.testing === true,
    temperror: normalized === 'temperror',
    signatureValue: typeof result.signature === 'string' && result.signature.length > 0 ? result.signature : null,
  };
}

/** The verifier must have read the same header rows and the same single From as checkHeaders. */
function agreesWithVerifier(header: HeaderFacts, verified: DKIMVerifyResult): boolean {
  if (verified.fromFields !== 1 || verified.fromSyntax !== 'valid') return false;
  if (verified.headerFrom.length !== 1 || verified.headerFrom[0]?.toLowerCase() !== header.from) return false;
  const rows = verified.headers?.parsed;
  if (!rows || rows.length !== header.fieldNames.length) return false;
  return rows.every((row, index) => row.key === header.fieldNames[index]);
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

async function verifyArcChain(verified: DKIMVerifyResult, resolver: DNSResolver): Promise<NormalizedArc> {
  const data = verified.arc;
  if (!data) return NO_ARC;
  if (!data.chain || data.chain.length === 0) {
    // A chain that could not even be parsed is a failed chain, not a missing one.
    return data.error ? { result: 'fail', sealer: null } : NO_ARC;
  }
  const newest = data.chain[data.chain.length - 1];
  // Strict like a DKIM d=: a sealer d= that is not plain ASCII LDH is no sealer, never trusted.
  const sealer = normalizeSigningDomain(newest?.['arc-seal']?.parsed?.d?.value);
  try {
    const result = await verifyArc(data, { resolver, minBitLength: AUTHENTICITY_TUNING.minRsaBits });
    const status = result.status.result;
    return { result: status === 'pass' ? 'pass' : status === 'none' ? 'none' : 'fail', sealer };
  } catch (error) {
    logger.warn('summaries.mailauth_error', { stage: 'arc', errorName: errorName(error) });
    return { result: 'fail', sealer };
  }
}

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
 * DKIM verification of every signature plus ARC chain validation, normalized. Alignment is
 * computed against the strict From domain. A verifier crash or a header parse that differs from
 * ours is malformed (row 4). Without an injected resolver, the per-call resolver's priority and
 * aligned budgets serve exactly dnsRouting(header, senders, mailboxes).
 */
export async function runMailAuth(raw: Buffer, options: RunMailAuthOptions): Promise<MailAuthResult> {
  const header: HeaderCheck = options.header ?? checkHeaders(raw);
  if (!header.ok) return { ok: false, reason: 'malformed', detail: header.detail };
  const resolver = options.resolver ?? createDnsResolver({ ...options.dns, ...dnsRouting(header, options.senders, options.mailboxes) });
  let verified: DKIMVerifyResult;
  try {
    verified = await dkimVerify(raw, {
      resolver,
      curTime: options.now,
      minBitLength: AUTHENTICITY_TUNING.minRsaBits,
      rejectRsaSha1: true,
    });
  } catch (error) {
    logger.warn('summaries.mailauth_error', { stage: 'dkim', errorName: errorName(error) });
    return { ok: false, reason: 'malformed', detail: 'verifier_error' };
  }
  if (!agreesWithVerifier(header, verified)) return { ok: false, reason: 'malformed', detail: 'parser_mismatch' };
  const signatures: NormalizedSignature[] = [];
  let budgetRefusals = 0;
  for (const result of verified.results) {
    if (isBudgetRefusal(result)) budgetRefusals += 1;
    const normalized = normalizeSignature(result, header.fromDomain);
    if (normalized) signatures.push(normalized);
  }
  // A count only: never a domain, selector or any other header text.
  if (budgetRefusals > 0) logger.warn('summaries.dns_budget_spent', { signatures: budgetRefusals });
  const arc = await verifyArcChain(verified, resolver);
  return { ok: true, signatures, arc };
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

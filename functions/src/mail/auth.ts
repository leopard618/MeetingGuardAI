/**
 * DKIM and ARC verification of inbound mail (M10 summaries, assistant matters;
 * docs/v2/M10-DESIGN.md section 4 step 7, section 5, red-team findings 1, 2 and 8).
 *
 * Shared by the meeting summaries (functions/src/summaries) and the assistant matters
 * (functions/src/matters, A2). It loads mailauth, so only a module that is itself loaded lazily
 * may value-import it (summaries: ./authenticity.ts, loaded by inbound.ts on the first request);
 * a module loaded at deploy time uses `import type` only. There is no barrel in functions/src/mail,
 * so ./headers.ts stays importable without mailauth. It never logs addresses or content.
 *
 * - verifyMailAuth: mailauth's DKIM verification and ARC chain validation over the raw bytes.
 *   Every signature is normalized; alignment is computed here against the strict From domain
 *   (checkHeaders, ./headers.ts), never taken from mailauth's status.aligned. The verifier's own
 *   header parse is cross-checked against ours; any disagreement is malformed. A DKIM d= or ARC
 *   sealer d= that is not plain ASCII LDH yields no domain (nothing is mapped), so the domain we
 *   align is always the domain whose key mailauth fetched.
 * - isPassSig, domainsAlign, normalizeSigningDomain: passSig and alignment as section 5 defines them.
 * - createDnsResolver: per-message DNS with a hard time bound (below).
 *
 * DNS, exactly:
 * - TXT only, one cache per message, node:dns with a 4 s timeout and 2 tries.
 * - A lookup waits at most dnsLookupCapMs (8 s). Cut there, it fails with ETIMEOUT (a real
 *   temperror) and is charged exactly the cap, never the timer's lateness.
 * - Every lookup draws on exactly one of three budgets of waiting time, each counted only while
 *   one of its own lookups is in flight. The routing (DnsRouting) is fixed by the caller before any
 *   lookup, from facts known before any DNS work (the strict From and the ARC key names of
 *   checkHeaders, plus the caller's own lists). The key-record domain of a lookup is the name
 *   after its last "._domainkey.":
 *   - priority (dnsPriorityBudgetMs, 16 s, two caps): any lookup whose key-record domain EXACTLY
 *     equals one of the routing's priorityDomains, and any lookup whose name is EXACTLY one of its
 *     priorityKeyNames (trustedArcKeyNames: the ARC key names of the TRUSTED_ARC_SEALERS).
 *   - aligned (dnsAlignedBudgetMs, 8 s, one cap): a lookup whose key-record domain ALIGNS with one
 *     of the routing's alignedDomains but does not equal a priority domain, as an email service's
 *     d=mg.<vendor> does.
 *   - shared (dnsBudgetMs, 8 s, one cap): everything else: forwarding hops, unaligned email
 *     services, attacker zones, and any name that is not a key record name.
 * - A lookup refused or cut short because its budget is spent fails with EBUDGET, which
 *   normalizeSignature reads as "no key" (neutral). It counts as no signature: never a passSig,
 *   never tampered, never a temperror, never a retry.
 * - Hard bound per message: dnsBudgetMs + dnsAlignedBudgetMs + dnsPriorityBudgetMs (32 s,
 *   DNS_MESSAGE_BOUND_MS) of DNS waiting, plus the lateness of at most a few timers, inside the
 *   60 s function timeout. Each budget bounds its own lookups, concurrent ones included.
 * - verifyMailAuth requires a routing callback and createDnsResolver has no default routing
 *   either, so no caller can silently put every lookup in the shared budget.
 *
 * Authenticity rests on our own DKIM check, never on the provider's verdicts and never on SPF.
 * Logs carry an error name or a count only, named by the caller's logScope: never addresses,
 * subjects, bodies, header text or key material.
 */
import * as logger from 'firebase-functions/logger';
import { promises as dnsPromises } from 'node:dns';
import { arc as verifyArc, dkimVerify, type DKIMResult, type DKIMVerifyResult, type DNSResolver } from 'mailauth';

import { checkHeaders, normalizeDomain, type HeaderCheck, type HeaderFacts, type HeaderFailureDetail } from './headers';

/** Recorded on every summary as auth.verifier (section 7). A test pins it to the installed version. */
export const MAILAUTH_VERIFIER = 'mailauth@8.0.4';

/** Row 11: ARC sealers whose valid chain turns changed_after_sending into the forwarding advice. */
export const TRUSTED_ARC_SEALERS: readonly string[] = ['google.com', 'microsoft.com'];

/** The verifier and DNS tuning; the summaries' AUTHENTICITY_TUNING spreads it. */
export const MAIL_AUTH_TUNING = {
  /** passSig: RSA keys shorter than this never pass. */
  minRsaBits: 1024,
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
  MAIL_AUTH_TUNING.dnsBudgetMs + MAIL_AUTH_TUNING.dnsAlignedBudgetMs + MAIL_AUTH_TUNING.dnsPriorityBudgetMs;

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

// ---------------------------------------------------------------------------------------------
// Domains, passSig
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
 * passSig (section 5): pass, aligned with the From domain, "from" signed, no l=, a strong
 * algorithm (never rsa-sha1), an RSA key of at least 1024 bits, not a t=y testing key.
 */
export function isPassSig(sig: NormalizedSignature, fromDomain: string): boolean {
  if (sig.result !== 'pass' || sig.temperror) return false;
  if (!domainsAlign(sig.domain, fromDomain)) return false;
  if (!sig.signsFrom || sig.bodyLengthLimited || sig.testing) return false;
  const algo = sig.algo.toLowerCase();
  if (!STRONG_ALGORITHMS.has(algo)) return false;
  if (algo.startsWith('rsa-') && (sig.bits === null || sig.bits < MAIL_AUTH_TUNING.minRsaBits)) return false;
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
   * no caller can put every lookup in the shared budget by leaving it out; pass the caller's
   * routing (summaries: dnsRouting()), or an explicit [] when no lookup is meant to have priority.
   */
  priorityDomains: readonly string[];
  /**
   * A lookup whose key-record domain aligns (domainsAlign: equal, or a subdomain or a parent)
   * with one of these and is not exactly one of priorityDomains uses the aligned budget. Required
   * for the same reason; pass the caller's routing, or an explicit [] when nothing is meant to use
   * it.
   */
  alignedDomains: readonly string[];
  /** Exact key record names ("selector._domainkey.domain") that use priority too: trusted ARC keys. */
  priorityKeyNames?: readonly string[];
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

/** Budgets and test seams of a per-message resolver; the routing always comes from the caller's routing. */
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

/**
 * The ARC-Seal and ARC-Message-Signature key record names (HeaderFacts.arcKeyNames) whose d= is
 * exactly a TRUSTED_ARC_SEALERS domain: a routing's priorityKeyNames (row 11). A DKIM-Signature
 * by google.com or microsoft.com is not an ARC lookup and is routed by its key-record domain,
 * unless it names that same key record.
 */
export function trustedArcKeyNames(arcKeyNames: readonly string[]): string[] {
  const sealers = TRUSTED_ARC_SEALERS.map((sealer) => normalizeSigningDomain(sealer));
  return arcKeyNames.filter((name) => {
    const domain = keyRecordDomain(name);
    return domain !== null && sealers.includes(domain);
  });
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
  const capMs = options.lookupCapMs ?? MAIL_AUTH_TUNING.dnsLookupCapMs;
  const shared = lookupPool(options.budgetMs ?? MAIL_AUTH_TUNING.dnsBudgetMs);
  const aligned = lookupPool(options.alignedBudgetMs ?? MAIL_AUTH_TUNING.dnsAlignedBudgetMs);
  const priority = lookupPool(options.priorityBudgetMs ?? MAIL_AUTH_TUNING.dnsPriorityBudgetMs);
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
      timeout: options.timeoutMs ?? MAIL_AUTH_TUNING.dnsTimeoutMs,
      tries: options.tries ?? MAIL_AUTH_TUNING.dnsTries,
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

async function verifyArcChain(verified: DKIMVerifyResult, resolver: DNSResolver, logScope: MailAuthLogScope): Promise<NormalizedArc> {
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
    const result = await verifyArc(data, { resolver, minBitLength: MAIL_AUTH_TUNING.minRsaBits });
    const status = result.status.result;
    return { result: status === 'pass' ? 'pass' : status === 'none' ? 'none' : 'fail', sealer };
  } catch (error) {
    logger.warn(`${logScope}.mailauth_error`, { stage: 'arc', errorName: errorName(error) });
    return { result: 'fail', sealer };
  }
}

/** The first part of the log names: '<logScope>.mailauth_error' and '<logScope>.dns_budget_spent'. */
export type MailAuthLogScope = 'summaries' | 'matters';

export interface VerifyMailAuthOptions {
  /** Current time for x= expiry checks. */
  now: Date;
  /** checkHeaders(raw) when the caller already ran it; computed here otherwise. */
  header?: HeaderFacts;
  /**
   * The DNS routing of this message, from its strict header facts. Required, and called only
   * when no resolver is injected: the fresh resolver's priority and aligned budgets then serve
   * exactly what it returns, so leaving it out can never silently put every lookup, the deciding
   * and aligned ones included, in the shared budget.
   */
  routing: (header: HeaderFacts) => DnsRouting;
  /** Injected DNS resolver (tests); otherwise a fresh createDnsResolver per call, routed by `routing`. */
  resolver?: DNSResolver;
  /** Budgets and test seams for that fresh resolver; ignored with `resolver`. */
  dns?: DnsTuning;
  /** Names the logs of this call (MailAuthLogScope). */
  logScope: MailAuthLogScope;
}

/**
 * DKIM verification of every signature plus ARC chain validation, normalized. Alignment is
 * computed against the strict From domain. A verifier crash or a header parse that differs from
 * ours is malformed. Without an injected resolver, the per-call resolver's priority and aligned
 * budgets serve exactly options.routing(header).
 */
export async function verifyMailAuth(raw: Buffer, options: VerifyMailAuthOptions): Promise<MailAuthResult> {
  const header: HeaderCheck = options.header ?? checkHeaders(raw);
  if (!header.ok) return { ok: false, reason: 'malformed', detail: header.detail };
  const resolver = options.resolver ?? createDnsResolver({ ...options.dns, ...options.routing(header) });
  let verified: DKIMVerifyResult;
  try {
    verified = await dkimVerify(raw, {
      resolver,
      curTime: options.now,
      minBitLength: MAIL_AUTH_TUNING.minRsaBits,
      rejectRsaSha1: true,
    });
  } catch (error) {
    logger.warn(`${options.logScope}.mailauth_error`, { stage: 'dkim', errorName: errorName(error) });
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
  if (budgetRefusals > 0) logger.warn(`${options.logScope}.dns_budget_spent`, { signatures: budgetRefusals });
  const arc = await verifyArcChain(verified, resolver, options.logScope);
  return { ok: true, signatures, arc };
}

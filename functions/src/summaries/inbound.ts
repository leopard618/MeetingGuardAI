/**
 * summaryInbound pipeline (docs/v2/M10-DESIGN.md section 4 steps 1 to 16, section 5 decision table
 * rows 0 to 16, section 6 inputs and anchors, red-team findings 1 to 17). A pure handler over
 * injected ports, in the handleRevenueCatWebhook shape: the HTTPS shell (./inboundFunction.ts)
 * only maps the request and wires the ports. This module is loaded LAZILY by that shell on the
 * first request, because it pulls in mailauth (./authenticity) and postal-mime (./mime).
 *
 * Steps, in this order (security critical; never reorder):
 *   0. Switched off: 404. Not POST: 405.
 *   1. Basic auth FIRST (checkBasicAuth, timing-safe; an empty configured secret rejects): 401.
 *   2. Body over 12 MiB, unparsable payload or no RawEmail: 200 ignored (no RawEmail is a setup
 *      alarm: "Include raw email content" is off on the Postmark server).
 *   3. The token from the ENVELOPE recipient only (finding 15), resolveToken, then the uid must be
 *      in the pilot list and exist in Auth without being disabled (finding 12). Otherwise 200
 *      dropped and nothing stored. No MIME is parsed before this step.
 *   4. receivedAt = the first-seen time of this provider event (a retry keeps it), else the
 *      attempt time; `now` is always the attempt time. parseMime (size, parts, depth) and
 *      assessAuthenticity (header sanity, DKIM, classify) over the raw bytes.
 *   5. Row 5 retry: recordFirstSeen, then 500 so Postmark redelivers.
 *   6. Row 6 Gmail confirmation: parseGmailConfirmation, then storeGmailRequest with the verified
 *      account email (the user's own requests are never evicted). A confirmation
 *      that does not parse is logged and answered 200 WITHOUT a refused row (it is Gmail's own
 *      mail, signed by google.com; refusing it would only show a confusing row).
 *   Rows 4 and 11 to 14: recordRefusal, senderDomain ONLY from classification.senderDomain (the d=
 *      of a passing signature, finding 17).
 *   7 to 10. The text/plain part only (HTML-only mail is unreadable until an HTML-to-text converter
 *      that drops hidden elements exists; tags are never stripped with regexes, finding 16);
 *      sanitizeText, then stripForwardWrapper for row 10 ONLY (a vendor recap, rows 7 to 9, is
 *      used as signed: a quoted From/Date/Subject block inside it never cuts it; in a user
 *      forward the stripping stops at the wrapper whose From is a SUMMARIES_SENDERS address, so
 *      the notetaker's own text is never cut either), then parseSections and extractSummaryMeta
 *      on that text; empty text or no sections refuse as unreadable (row 15). A row 10 mail that
 *      carries an attached message (mime.ts attachedMessageCount) refuses as unreadable too
 *      (detail attached_message) UNLESS that wrapper's From is a SUMMARIES_SENDERS address: the
 *      recap may be only in the attachment, which is never parsed, so a note (the forwarder's,
 *      a colleague's above an inline wrapper, an Outlook reply's quoted block) must not be stored
 *      in its place. Fails closed: with SUMMARIES_SENDERS empty every such mail is refused.
 *      Anchor: the signed Date for vendor rows (signed), the forward wrapper's wall-clock
 *      Date in the preferences zone for user forwards (unsigned), else none. Candidates and
 *      decide(), the messageKey and summaryId, the sealed document, then ONE commit transaction
 *      that re-reads the address (row 16 duplicates and step 13 upgrades happen there). created,
 *      upgraded, duplicate and dropped answer 200.
 *   Any Firestore failure or other unexpected error answers 500 (Postmark retries), after the
 *   first-seen time is recorded when the message was already routed.
 *
 * Labels and the stored fromAddress come from the strict header facts (./headers.ts), never from
 * postal-mime; the display name is never read, so fromName is always null.
 *
 * Logs: exactly one `summaries.inbound` line per authorized request, carrying only fixed codes and
 * counts: uid, tok8, verdict, reason, detail, row, tier, outcome, matched, ms, and errorName on a
 * failure. Never the subject, a title, any address, the body, header text, the token, a code, the
 * provider event id or key material. Setup alarms go to `summaries.setup_alarm` {reason, detail}.
 */
import * as logger from 'firebase-functions/logger';
import type { Auth } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';
import type { DNSResolver } from 'mailauth';

import { SUMMARY_LIMITS, type SummaryRefusedReason, type SummaryTier as ContractSummaryTier } from '../shared/aiContract';
import { SealedError, parseKeyring, type Keyring } from '../shared/sealed';
import { isValidTimeZone, zonedDateTimeToUtcIso } from '../shared/time';
import { normalizeMailbox, parseAddressTemplate, readSummaryUser, resolveToken, tok8, tokenFromEnvelope, tokenHash } from './address';
import { assessAuthenticity, isPassSig, normalizeSenders, storedAuth, type Classification, type MailAuthResult } from './authenticity';
import { candidateWindow, readPreferencesTimeZone, type CandidateWindow, type LoadCandidatesOptions, type LoadedCandidates } from './candidates';
import { isPilotUid, parsePilotList } from './gate';
import { parseGmailConfirmation } from './gmail';
import { parseMailDate, type HeaderFacts } from './headers';
import { decide, type MatchAnchor, type MatchCandidate } from './match';
import { parseMime, type ParsedMime } from './mime';
import { buildSummaryDoc, digestMarkerKey, messageKeyFor, messageMarkerKey, refusedReasonOrNull, summaryIdFor } from './model';
import { SUMMARIES_MAX_BODY_BYTES, checkBasicAuth, parsePostmarkInbound, type InboundEnvelope } from './provider/postmark';
import { sanitizeLine, sanitizeText, stripForwardWrapper, type ForwardWrapper } from './sanitize';
import { extractSummaryMeta, parseLocalDateTime, parseSections } from './sections';
import { commitSummary, readFirstSeen, recordFirstSeen, recordRefusal, storeGmailRequest } from './store';

export { loadCandidates } from './candidates';

// ---------------------------------------------------------------------------------------------
// Ports and shapes
// ---------------------------------------------------------------------------------------------

/** The slice of the HTTPS request the pipeline reads. */
export interface InboundRequest {
  method: string;
  /** The Authorization header value, as received. Never logged. */
  authorization: string | undefined;
  /** The framework's parsed JSON body (req.body). Content: never logged. */
  body: unknown;
  /** Size of the request body in bytes (req.rawBody, or a larger Content-Length). */
  rawBodyBytes: number;
}

export interface InboundResponse {
  status: number;
  body: string;
}

/** What the pipeline needs from Firebase Auth about the uid an address routes to. */
export interface InboundAuthUser {
  exists: boolean;
  disabled: boolean;
  email: string | null;
  emailVerified: boolean;
}

export interface InboundAuthUsers {
  /** Resolves exists false for a deleted user; rejects only on a real Auth failure (answered 500). */
  getUser(uid: string): Promise<InboundAuthUser>;
}

/** candidates.ts loadCandidates (the shell passes it; tests may wrap it). */
export type CandidatesLoader = (
  db: Firestore,
  uid: string,
  window: CandidateWindow | null,
  now: Date,
  options?: LoadCandidatesOptions,
) => Promise<LoadedCandidates>;

export interface InboundDeps {
  /** SUMMARIES_ENABLED at request time (the shell checks it too). */
  enabled(): boolean;
  /** SUMMARIES_WEBHOOK_AUTH. Empty or whitespace-only rejects every request. */
  webhookSecret(): string;
  /** SUMMARIES_PILOT_UIDS, raw comma list. */
  pilotUids(): string;
  /** SUMMARIES_ADDRESS_TEMPLATE. Empty means "being set up": nothing routes. */
  addressTemplate(): string;
  /** SUMMARIES_SENDERS, raw comma list of exact notetaker sender addresses. */
  senders(): string;
  /**
   * The sealing keyring, parsed lazily from SUMMARIES_DATA_KEY (lazyKeyring). Called only when a
   * summary is sealed; a SealedError is a setup alarm and answers 500.
   */
  keyring(): Keyring;
  db: Firestore;
  authUsers: InboundAuthUsers;
  candidates: CandidatesLoader;
  /** DNS seam for mailauth (tests); production builds one resolver per message. */
  resolver?: DNSResolver;
  /** The attempt time. */
  now(): Date;
}

/** Verdicts of the summaries.inbound log line (fixed codes). */
export type InboundVerdict = 'ignored' | 'dropped' | 'refused' | 'retry' | 'gmail' | 'stored' | 'error';

/** Where an unexpected error happened (fixed codes, for the error log line). */
type InboundStage =
  | 'payload'
  | 'resolve'
  | 'auth_user'
  | 'first_seen'
  | 'summary_user'
  | 'mime'
  | 'authenticity'
  | 'retry'
  | 'gmail'
  | 'refusal'
  | 'text'
  | 'candidates'
  | 'keyring'
  | 'build'
  | 'commit';

const OK: InboundResponse = { status: 200, body: 'ok' };
const NOT_CONFIGURED: InboundResponse = { status: 404, body: 'Not configured' };
const METHOD_NOT_ALLOWED: InboundResponse = { status: 405, body: 'Method Not Allowed' };
const UNAUTHORIZED: InboundResponse = { status: 401, body: 'Unauthorized' };
const INTERNAL: InboundResponse = { status: 500, body: 'Internal Server Error' };

/** Rows that store a summary (accept or inbox). */
type StoringRow = 7 | 8 | 9 | 10;

// ---------------------------------------------------------------------------------------------
// Production adapters (used by the shell; kept here so they load lazily with the pipeline)
// ---------------------------------------------------------------------------------------------

/**
 * The keyring of SUMMARIES_DATA_KEY, parsed on first use and kept while the secret value stays the
 * same. A malformed value throws SealedError every time (never cached), so a fixed secret works on
 * the next request. The value is never logged.
 */
export function lazyKeyring(readSecret: () => string): () => Keyring {
  let cached: { secret: string; keyring: Keyring } | null = null;
  return () => {
    const secret = readSecret();
    if (cached !== null && cached.secret === secret) return cached.keyring;
    const keyring = parseKeyring(secret);
    cached = { secret, keyring };
    return keyring;
  };
}

function errorCode(error: unknown): unknown {
  return typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
}

/** firebase-admin Auth as InboundAuthUsers: auth/user-not-found is a missing user, anything else rejects. */
export function firebaseAuthUsers(auth: Pick<Auth, 'getUser'>): InboundAuthUsers {
  return {
    async getUser(uid: string): Promise<InboundAuthUser> {
      try {
        const record = await auth.getUser(uid);
        return {
          exists: true,
          disabled: record.disabled === true,
          email: typeof record.email === 'string' ? record.email : null,
          emailVerified: record.emailVerified === true,
        };
      } catch (error) {
        if (errorCode(error) === 'auth/user-not-found') return { exists: false, disabled: false, email: null, emailVerified: false };
        throw error;
      }
    },
  };
}

// ---------------------------------------------------------------------------------------------
// One request
// ---------------------------------------------------------------------------------------------

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

/** The facts of one run that the log line and the error path read. Codes and ids only. */
class InboundRun {
  uid: string | null = null;
  tok8: string | null = null;
  tier: string | null = null;
  row: number | null = null;
  stage: InboundStage = 'payload';
  /**
   * Set as soon as the payload parses (its providerEventId is known): any 500 after that records
   * the first-seen time, so a redelivery keeps the original receipt time even when the failure
   * came before routing (a resolveToken or Auth read error).
   */
  seen: { envelope: InboundEnvelope; attemptAt: Date } | null = null;

  constructor(private readonly startedMs: number) {}

  /** The one summaries.inbound line, then the response. */
  finish(
    response: InboundResponse,
    verdict: InboundVerdict,
    reason: string,
    extra: { detail?: string; outcome?: string; matched?: boolean; pilotInvalid?: number; errorName?: string } = {},
  ): InboundResponse {
    const fields: Record<string, unknown> = {
      uid: this.uid,
      tok8: this.tok8,
      verdict,
      reason,
      detail: extra.detail ?? null,
      row: this.row,
      tier: this.tier,
      outcome: extra.outcome ?? null,
      matched: extra.matched === true,
      ms: Date.now() - this.startedMs,
    };
    if (extra.pilotInvalid !== undefined && extra.pilotInvalid > 0) fields.pilotInvalid = extra.pilotInvalid;
    if (extra.errorName !== undefined) fields.errorName = extra.errorName;
    if (verdict === 'error') logger.error('summaries.inbound', fields);
    else if (verdict === 'retry') logger.warn('summaries.inbound', fields);
    else logger.info('summaries.inbound', fields);
    return response;
  }
}

function setupAlarm(reason: string, detail: string | null = null): void {
  logger.error('summaries.setup_alarm', { reason, detail });
}

/**
 * Handles one Postmark inbound webhook request (design section 4). Never throws: every unexpected
 * error is logged by name and answered 500 so Postmark retries.
 */
export async function handleInboundRequest(request: InboundRequest, deps: InboundDeps): Promise<InboundResponse> {
  const startedMs = Date.now();
  // Row 0.
  if (deps.enabled() !== true) return NOT_CONFIGURED;
  if (request.method !== 'POST') return METHOD_NOT_ALLOWED;
  // Row 1: Basic auth FIRST, before anything in the body is looked at.
  if (!checkBasicAuth(request.authorization, deps.webhookSecret())) {
    logger.warn('summaries.inbound_unauthorized', {
      hasHeader: typeof request.authorization === 'string' && request.authorization.length > 0,
    });
    return UNAUTHORIZED;
  }

  const run = new InboundRun(startedMs);
  try {
    return await processAuthorized(request, deps, run);
  } catch (error) {
    if (run.seen !== null && run.stage !== 'retry') {
      // Best effort: a redelivery keeps the original receipt time (Fresh and the row 5 window).
      try {
        await recordFirstSeen(deps.db, run.seen.envelope.providerEventId, run.seen.attemptAt);
      } catch {
        // Firestore is likely down; the retry then measures from its own attempt time.
      }
    }
    return run.finish(INTERNAL, 'error', run.stage, { errorName: errorName(error) });
  }
}

async function processAuthorized(request: InboundRequest, deps: InboundDeps, run: InboundRun): Promise<InboundResponse> {
  // Row 2: oversize body, unparsable payload, no RawEmail.
  if (!Number.isFinite(request.rawBodyBytes) || request.rawBodyBytes > SUMMARIES_MAX_BODY_BYTES) {
    return run.finish(OK, 'ignored', 'body_too_large');
  }
  const parsed = parsePostmarkInbound(request.body);
  if (!parsed.ok) {
    if (parsed.reason === 'no_raw_email') setupAlarm('no_raw_email');
    return run.finish(OK, 'ignored', parsed.reason);
  }
  const envelope = parsed.envelope;
  const attemptAt = deps.now();
  run.seen = { envelope, attemptAt };

  // Row 3: routing by the envelope recipient only, then pilot and Auth. Nothing parsed yet.
  const template = deps.addressTemplate();
  const token = tokenFromEnvelope(envelope.envelopeRecipient, template);
  if (token === null) {
    return run.finish(OK, 'dropped', parseAddressTemplate(template) === null ? 'template_not_set' : 'no_token');
  }
  const hash = tokenHash(token);
  run.tok8 = tok8(hash);
  run.stage = 'resolve';
  const uid = await resolveToken(hash, { db: deps.db });
  if (uid === null) return run.finish(OK, 'dropped', 'unknown_address');
  run.uid = uid;
  const pilotRaw = deps.pilotUids();
  if (!isPilotUid(uid, pilotRaw)) {
    return run.finish(OK, 'dropped', 'not_pilot', { pilotInvalid: parsePilotList(pilotRaw).invalid });
  }
  run.stage = 'auth_user';
  const authUser = await deps.authUsers.getUser(uid);
  if (!authUser.exists) return run.finish(OK, 'dropped', 'user_missing');
  if (authUser.disabled) return run.finish(OK, 'dropped', 'user_disabled');

  run.stage = 'first_seen';
  const receivedAt = (await readFirstSeen(deps.db, envelope.providerEventId)) ?? attemptAt;

  run.stage = 'summary_user';
  const summaryUser = await readSummaryUser(uid, { db: deps.db });
  if (summaryUser === null) return run.finish(OK, 'dropped', 'address_changed');
  const mailboxes = [...summaryUser.mailboxes];
  const accountEmail = authUser.emailVerified ? normalizeMailbox(authUser.email) : null;
  if (accountEmail !== null && !mailboxes.includes(accountEmail)) mailboxes.push(accountEmail);

  // Read once per message: the classifier and the row 10 text rules see the same list.
  const senders = normalizeSenders(deps.senders());
  const ctx: MessageContext = { deps, run, uid, hash, envelope, attemptAt, receivedAt, accountEmail, senders };

  // Row 4 (size, parts, depth), before any header or DNS work.
  run.stage = 'mime';
  const mime = await parseMime(envelope.rawMime);
  if (!mime.ok) {
    run.row = 4;
    return refuse(ctx, mime.reason, null, 'mime');
  }

  // Rows 4 to 14: header sanity, DKIM, classify.
  run.stage = 'authenticity';
  const assessment = await assessAuthenticity(envelope.rawMime, {
    receivedAt,
    now: attemptAt,
    senders,
    mailboxes,
    ...(deps.resolver !== undefined ? { resolver: deps.resolver } : {}),
  });
  const classification = assessment.classification;
  run.row = classification.row;
  run.tier = classification.tier;

  switch (classification.outcome) {
    case 'retry': {
      // Row 5: keep the first receipt time for the redelivery, then ask Postmark to retry.
      run.stage = 'retry';
      await recordFirstSeen(deps.db, envelope.providerEventId, attemptAt);
      return run.finish(INTERNAL, 'retry', classification.reason);
    }
    case 'gmail':
      return storeGmailCode(ctx, mime);
    case 'refuse': {
      const reason = refusedReasonOrNull(classification.reason);
      if (reason === null) throw new Error('summaries.inbound: a refusal without a contract reason');
      return refuse(ctx, reason, classification.senderDomain);
    }
    case 'accept':
    case 'inbox': {
      const header = assessment.header;
      const mailAuth = assessment.mailAuth;
      if (!header.ok || mailAuth === null || !mailAuth.ok) throw new Error('summaries.inbound: a stored row without verified headers');
      return storeSummary(ctx, mime, classification, header, mailAuth);
    }
    default:
      throw new Error('summaries.inbound: unknown classification outcome');
  }
}

interface MessageContext {
  deps: InboundDeps;
  run: InboundRun;
  uid: string;
  hash: string;
  envelope: InboundEnvelope;
  attemptAt: Date;
  receivedAt: Date;
  /**
   * The caller's Firebase Auth email, lowercased (normalizeMailbox), only when emailVerified;
   * else null. Content: never logged.
   */
  accountEmail: string | null;
  /** SUMMARIES_SENDERS normalized (normalizeSenders): exact lowercased notetaker sender addresses. */
  senders: readonly string[];
}

/**
 * Whether a user forward's wrapper (the one stripForwardWrapper stopped at) names a configured
 * notetaker sender as its From: then the inline text below it is the notetaker's own recap.
 */
function wrapperIsNotetaker(wrapper: ForwardWrapper | null, senders: readonly string[]): boolean {
  return wrapper !== null && wrapper.fromAddress !== null && senders.includes(wrapper.fromAddress);
}

/** Rows 4, 11 to 15: one refusal, no content kept. senderDomain is a passing signature's d= or null. */
async function refuse(ctx: MessageContext, reason: SummaryRefusedReason, senderDomain: string | null, detail?: string): Promise<InboundResponse> {
  ctx.run.stage = 'refusal';
  const outcome = await recordRefusal(ctx.deps.db, {
    uid: ctx.uid,
    reason,
    senderDomain,
    providerEventId: ctx.envelope.providerEventId,
    now: ctx.attemptAt,
    tokenHash: ctx.hash,
  });
  return ctx.run.finish(OK, 'refused', reason, { outcome, ...(detail !== undefined ? { detail } : {}) });
}

/** Row 6: the Gmail forwarding confirmation code (finding 14). */
async function storeGmailCode(ctx: MessageContext, mime: ParsedMime): Promise<InboundResponse> {
  ctx.run.stage = 'gmail';
  const confirmation = parseGmailConfirmation(mime.subject, mime.text);
  if (confirmation === null) return ctx.run.finish(OK, 'gmail', 'gmail_unparsable');
  const outcome = await storeGmailRequest(ctx.deps.db, {
    uid: ctx.uid,
    gmailAddress: confirmation.gmailAddress,
    code: confirmation.code,
    receivedAt: ctx.receivedAt,
    now: ctx.attemptAt,
    tokenHash: ctx.hash,
    // Requests from the user's own listed mailboxes or this verified account email are never
    // evicted by unlisted requesters (finding 14; store.ts ranks them).
    accountEmail: ctx.accountEmail,
  });
  return ctx.run.finish(OK, 'gmail', 'gmail_confirmation', { outcome });
}

/**
 * The b= of the signature that decided the row: the first passSig whose d= is the deciding domain
 * (deterministic, so a redelivery maps to the same messageKey).
 */
function decidingSignatureValue(classification: Classification, header: HeaderFacts, mailAuth: Extract<MailAuthResult, { ok: true }>): string | null {
  if (classification.decidingDomain === null) return null;
  const deciding = mailAuth.signatures.find((sig) => sig.domain === classification.decidingDomain && isPassSig(sig, header.fromDomain));
  return deciding?.signatureValue ?? null;
}

/**
 * The forward wrapper's Date (wall clock, no zone) as an instant in the user's preferences zone.
 * Null without a written time or without a usable zone: an unsigned anchor is never guessed.
 */
function forwardAnchor(dateText: string | null, zone: string | null): Date | null {
  if (zone === null || !isValidTimeZone(zone)) return null;
  const local = parseLocalDateTime(dateText);
  if (local === null || local.time === null) return null;
  try {
    const ms = Date.parse(zonedDateTimeToUtcIso(local.date, local.time, zone));
    return Number.isFinite(ms) ? new Date(ms) : null;
  } catch {
    return null;
  }
}

/** Rows 7 to 10 and 15, 16: parse, match, seal, commit. */
async function storeSummary(
  ctx: MessageContext,
  mime: ParsedMime,
  classification: Classification,
  header: HeaderFacts,
  mailAuth: Extract<MailAuthResult, { ok: true }>,
): Promise<InboundResponse> {
  const { deps, run, uid } = ctx;
  const row = classification.row;
  if (row !== 7 && row !== 8 && row !== 9 && row !== 10) throw new Error('summaries.inbound: not a storing row');
  const storingRow: StoringRow = row;
  const tier: ContractSummaryTier = storingRow === 10 ? 'user_forwarded' : 'vendor_verified';

  // Row 15: the own text/plain part only. HTML-only mail waits for a converter that drops hidden
  // elements (finding 16); its tags are never stripped with regexes.
  run.stage = 'text';
  // A user forward that carries an attached message (message/rfc822 and the other kinds mime.ts
  // counts; never parsed inline) may have its recap only in that attachment. Its inline text is
  // then someone's note: the forwarder's own, a colleague's note above an inline wrapper (Gmail
  // keeps the colleague's attachment when the user forwards inline), or an Outlook reply's quoted
  // From/Sent/To/Subject block. Storing it would file the wrong text, and a second such mail with
  // the same note would be dropped as its digest twin. So it fails CLOSED: refused unless the
  // wrapper stripForwardWrapper stopped at names a configured notetaker sender as its From (the
  // inline text below it is then the notetaker's recap, and an unrelated .eml merely rides
  // along). With SUMMARIES_SENDERS empty (it ships empty) every such mail is refused. Checked
  // before anything is sealed or any marker is claimed.
  const hasAttachedMessage = storingRow === 10 && mime.attachedMessageCount > 0;
  if (mime.text === null) {
    const detail = hasAttachedMessage ? 'attached_message' : mime.html !== null ? 'html_only' : 'no_text';
    return refuse(ctx, 'unreadable', classification.senderDomain, detail);
  }
  const sanitized = sanitizeText(mime.text);
  // The forward wrapper is a user-forward shape (row 10) only. A vendor recap (rows 7 to 9) is
  // used as signed: a From/Date/Subject block quoted inside it must never cut the signed text or
  // become the matching title. In a user forward the stripping stops at the notetaker's own
  // wrapper for the same reason, so the text (and its digest) equals the notetaker's copy and a
  // later bound copy upgrades the forward (step 13).
  const inner = storingRow === 10 ? stripForwardWrapper(sanitized.text, ctx.senders) : null;
  if (hasAttachedMessage && !wrapperIsNotetaker(inner?.wrapper ?? null, ctx.senders)) {
    return refuse(ctx, 'unreadable', classification.senderDomain, 'attached_message');
  }
  const text = inner?.text ?? sanitized.text;
  if (text.trim().length === 0) return refuse(ctx, 'unreadable', classification.senderDomain, 'empty_text');
  const sections = parseSections(text);
  if (sections.sections.length === 0) return refuse(ctx, 'unreadable', classification.senderDomain, 'no_sections');
  const meta = extractSummaryMeta(text, mime.subject);
  const subjectLine = sanitizeLine(mime.subject, SUMMARY_LIMITS.maxSubjectChars);
  const subject = subjectLine.length > 0 ? subjectLine : null;

  // Anchor and candidates (section 6). Row 9 never gets suggestions, so its meetings are not read.
  run.stage = 'candidates';
  let preferencesTimeZone: string | null = null;
  let candidates: MatchCandidate[] = [];
  let anchor: MatchAnchor | null = null;
  let forwardAnchorAt: Date | null = null;
  if (storingRow !== 9) {
    // Read first: a user forward's anchor needs the zone before the window exists.
    preferencesTimeZone = await readPreferencesTimeZone(deps.db, uid);
  }
  if (storingRow === 10) {
    forwardAnchorAt = forwardAnchor(inner?.wrapper?.dateText ?? null, preferencesTimeZone);
    if (forwardAnchorAt !== null) anchor = { at: forwardAnchorAt.toISOString(), signed: false };
  } else if (classification.anchorSource === 'signed_date' && classification.anchorAt !== null) {
    anchor = { at: classification.anchorAt.toISOString(), signed: true };
  }
  if (storingRow !== 9) {
    const window = candidateWindow({ summaryDate: meta.summaryDate, anchorAt: anchor?.at ?? null });
    const loaded = await deps.candidates(deps.db, uid, window, ctx.receivedAt, { preferencesTimeZone });
    candidates = loaded.candidates;
    preferencesTimeZone = loaded.preferencesTimeZone;
  }
  const record = decide({
    tier,
    recipientBound: classification.recipientBound,
    fresh: classification.fresh,
    titleLine: meta.titleLine,
    subjectClean: meta.subjectClean,
    summaryDate: meta.summaryDate,
    anchor,
    text,
    preferencesTimeZone,
    rejectedMeetingIds: [],
    candidates,
    now: ctx.attemptAt,
  });

  // Step 11: ids. Step 15: seal (the keyring is parsed here, only when something is sealed).
  const messageKey = messageKeyFor({
    messageIdHeader: header.messageId,
    decidingSignatureValue: decidingSignatureValue(classification, header, mailAuth),
    raw: ctx.envelope.rawMime,
  });
  const summaryId = summaryIdFor(uid, messageKey);
  run.stage = 'keyring';
  let keyring: Keyring;
  try {
    keyring = deps.keyring();
  } catch (error) {
    setupAlarm('data_key_invalid', error instanceof SealedError ? error.reason : errorName(error));
    throw error;
  }
  run.stage = 'build';
  const built = buildSummaryDoc({
    keyring,
    uid,
    summaryId,
    classification,
    match: record,
    sections,
    meta,
    text,
    textTruncated: sanitized.truncated,
    subject,
    fromAddress: header.from,
    // The strict parser never returns display names, and postal-mime's are never used for labels.
    fromName: null,
    auth: storedAuth(mailAuth.signatures, mailAuth.arc),
    sentAt: header.date === null ? null : parseMailDate(header.date),
    forwardAnchorAt,
    receivedAt: ctx.receivedAt,
    now: ctx.attemptAt,
  });

  run.stage = 'commit';
  const result = await commitSummary(deps.db, {
    uid,
    tokenHash: ctx.hash,
    summaryId,
    doc: built.doc,
    reseal: built.reseal,
    claimMarkers: built.claimMarkers,
    messageIdMarkerKey: messageMarkerKey(uid, messageKey),
    digestMarkerKey: digestMarkerKey(uid, built.doc.contentDigest),
    rank: built.rank,
    now: ctx.attemptAt,
  });
  const reason = built.doc.status === 'matched' ? 'filed' : (built.doc.inboxReason ?? 'inbox');
  const verdict: InboundVerdict = result.outcome === 'dropped' ? 'dropped' : 'stored';
  return run.finish(OK, verdict, result.outcome === 'dropped' ? result.reason : reason, {
    outcome: result.outcome,
    detail: result.outcome === 'dropped' ? reason : result.reason,
    matched: result.outcome !== 'dropped' && result.status === 'matched',
  });
}

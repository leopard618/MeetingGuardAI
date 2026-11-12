/**
 * summaryStatus and summaryAction (docs/v2/M10-DESIGN.md section 3, section 4 Callables, sections
 * 6, 7 and 9; contract: shared/aiContract.ts summary* schemas and SUMMARY_ERROR_CODES). Pure
 * handlers over injected deps (db, clock, the three non-secret params), so the Firebase shell in
 * ./index.ts stays thin and the tests run on the in-memory Firestore fake.
 *
 * Rules:
 * - Both callables are always deployed and bind NO secret. summaryAction never decrypts: it never
 *   reads SUMMARIES_DATA_KEY, never opens a sealed field, and its `summary` carries only
 *   {summaryId, status, inboxReason, match} (summaryStateOf in ./actions.ts).
 * - summaryStatus needs a signed-in caller (unauthenticated otherwise). It answers enabled false
 *   while SUMMARIES_ENABLED is off and allowed false for a caller that is not verified (the
 *   assistant's rule: email_verified or a trusted sign-in provider) or not in the pilot list, both
 *   with the empty status and without reading Firestore.
 * - summaryAction needs a verified caller (unauthenticated), SUMMARIES_ENABLED (not_enabled) and the
 *   pilot list (not_allowed), in that order, before the request is parsed (invalid_request).
 * - Errors carry details.reason; the HttpsError code comes from the contract's
 *   SUMMARY_ERROR_HTTPS_CODES (summaryError). Any other failure (Firestore) is upstream_error.
 * - Both outputs are validated with the contract response schemas before they are returned.
 * - Logs carry uid, op, changed, reason codes, counts and errorName only: never an email, an
 *   address, a token, a mailbox, a meeting id or title, or a summary id.
 */
import { HttpsError } from 'firebase-functions/https';
import * as logger from 'firebase-functions/logger';
import type { Firestore } from 'firebase-admin/firestore';

import {
  SUMMARY_ERROR_HTTPS_CODES,
  SUMMARY_LIMITS,
  isTrustedSignInProvider,
  isoDateTimeSchema,
  summaryActionRequestSchema,
  summaryActionResponseSchema,
  summaryLastRefusedSchema,
  summaryStatusRequestSchema,
  summaryStatusResponseSchema,
  type SummaryActionRequest,
  type SummaryActionResponse,
  type SummaryErrorCode,
  type SummaryLastRefused,
  type SummaryRefusedToday,
  type SummaryState,
  type SummaryStatusResponse,
} from '../shared/aiContract';
import {
  addressFor,
  createAddress,
  deleteAddressDocs,
  parseAddressTemplate,
  readSummaryUser,
  regenerateAddress,
  setMailboxes,
  type AddressDeps,
  type AddressLogger,
  type MailboxRejection,
  type RandomSource,
  type SummaryUserDoc,
} from './address';
import {
  SUMMARY_BULK_DELETE_LIMITS,
  attachSummary,
  deleteAllSummaries,
  deleteSummary,
  detachSummary,
  dismissGmailRequest,
  keepSummary,
  type BulkDeleteLimits,
  type SummaryOpResult,
} from './actions';
import { isPilotUid } from './gate';
import { utcDayOf } from './model';
import { activeGmailRequests, countInbox, prunedGmailRequests, pruneGmailRequests } from './store';

// ---------------------------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------------------------

/** Every summary* error carries details.reason (the app maps it to its own copy). */
export function summaryError(reason: SummaryErrorCode, message: string): HttpsError {
  return new HttpsError(SUMMARY_ERROR_HTTPS_CODES[reason], message, { reason });
}

const MESSAGES = {
  signedOut: 'Sign in to use meeting summaries.',
  unverified: 'Verify your email to use meeting summaries.',
  notEnabled: 'Meeting summaries are not switched on.',
  notAllowed: 'Meeting summaries are not available for this account yet.',
  statusArgs: 'summaryStatus takes no arguments.',
  invalidRequest: 'The summary request is not valid.',
  beingSetUp: 'The private summary address is being set up. Try again later.',
  noAddress: 'Create your private summary address first.',
  rateLimited: 'Too many new addresses today. Try again tomorrow.',
  notFound: 'That summary was not found.',
  invalidMeeting: 'That meeting cannot take this summary.',
  upstream: 'Meeting summaries are not available right now. Try again later.',
  deleteIncomplete: 'Some summaries are still being deleted. Try again.',
} as const;

const MAILBOX_MESSAGES: Readonly<Record<MailboxRejection, string>> = {
  too_many: 'Use at most 5 mailboxes.',
  invalid_mailbox: 'Each mailbox must be one plain email address.',
  reserved_mailbox: 'A private summary address cannot be one of your mailboxes.',
};

// ---------------------------------------------------------------------------------------------
// Caller
// ---------------------------------------------------------------------------------------------

/** request.auth as the callables receive it. */
export type SummaryCallableAuth = { uid: string; token: Record<string, unknown> } | null | undefined;

export interface SummaryCaller {
  uid: string;
  /** The token's email claim (any case), or null. */
  email: string | null;
  emailVerified: boolean;
  signInProvider: string | null;
}

export function summaryCallerOf(auth: SummaryCallableAuth): SummaryCaller | null {
  if (!auth || typeof auth.uid !== 'string' || auth.uid.length === 0) return null;
  const token = auth.token ?? {};
  const firebaseClaims = token.firebase as { sign_in_provider?: unknown } | undefined;
  return {
    uid: auth.uid,
    email: typeof token.email === 'string' && token.email.length > 0 ? token.email : null,
    emailVerified: token.email_verified === true,
    signInProvider: typeof firebaseClaims?.sign_in_provider === 'string' ? firebaseClaims.sign_in_provider : null,
  };
}

/** The assistant's rule: a verified email or a trusted sign-in provider. */
export function isVerifiedCaller(caller: SummaryCaller): boolean {
  return caller.emailVerified || isTrustedSignInProvider(caller.signInProvider);
}

/**
 * The sign-in email the first mailbox starts as (create_address): only when the caller is
 * verified by the same rule. address.ts normalizes it (and drops anything not a plain address).
 */
export function verifiedEmailOf(caller: SummaryCaller): string | null {
  return isVerifiedCaller(caller) ? caller.email : null;
}

// ---------------------------------------------------------------------------------------------
// Deps
// ---------------------------------------------------------------------------------------------

/** The three non-secret params, read by the shell at call time. */
export interface SummaryCallableConfig {
  /** SUMMARIES_ENABLED.value() === true. */
  enabled: boolean;
  /** SUMMARIES_PILOT_UIDS (raw comma list; gate.ts parses it). */
  pilotUids: string;
  /** SUMMARIES_ADDRESS_TEMPLATE (empty = being set up). Never logged. */
  template: string;
}

export interface SummaryCallableLogger {
  info(event: string, fields: Record<string, unknown>): void;
  warn(event: string, fields: Record<string, unknown>): void;
  error(event: string, fields: Record<string, unknown>): void;
}

const defaultLogger: SummaryCallableLogger = {
  info: (event, fields) => logger.info(event, fields),
  warn: (event, fields) => logger.warn(event, fields),
  error: (event, fields) => logger.error(event, fields),
};

export interface SummaryCallableDeps {
  db: Firestore;
  now: () => Date;
  config: SummaryCallableConfig;
  /** Test seam: the address token source (crypto randomBytes by default). */
  random?: RandomSource;
  /** Test seam: firebase-functions/logger by default (also passed to address.ts). */
  logger?: SummaryCallableLogger;
  /** Test seam: the disconnect bulk delete bounds (SUMMARY_BULK_DELETE_LIMITS by default). */
  deleteLimits?: BulkDeleteLimits;
}

function logOf(deps: SummaryCallableDeps): SummaryCallableLogger {
  return deps.logger ?? defaultLogger;
}

function addressDeps(deps: SummaryCallableDeps): AddressDeps {
  const out: AddressDeps = { db: deps.db, now: deps.now, template: deps.config.template };
  if (deps.random !== undefined) out.random = deps.random;
  if (deps.logger !== undefined) {
    const log = deps.logger;
    const addressLogger: AddressLogger = { info: (event, fields) => log.info(event, fields) };
    out.logger = addressLogger;
  }
  return out;
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

// ---------------------------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------------------------

/** The answer for a caller who may not use summaries (or while the switch is off): every field empty. */
export function emptySummaryStatus(enabled: boolean): SummaryStatusResponse {
  return {
    enabled,
    allowed: false,
    ready: false,
    address: null,
    mailboxes: [],
    gmailRequests: [],
    inboxCount: 0,
    lastReceivedAt: null,
    lastRefused: null,
    refusedToday: null,
  };
}

function isoOrNull(value: unknown): string | null {
  return typeof value === 'string' && isoDateTimeSchema.safeParse(value).success ? value : null;
}

function lastRefusedOrNull(value: unknown): SummaryLastRefused | null {
  const parsed = summaryLastRefusedSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/**
 * Today's refusal counter (design step 9) from summaryUsers {refusedDay, refusedCount}: null
 * unless refusals were counted on the current UTC day; capped once SUMMARY_LIMITS.maxRefusalsPerDay
 * is reached (store.ts recordRefusal then drops further junk that day, and the app suggests a new
 * address). Pure.
 */
export function refusedTodayOf(user: Pick<SummaryUserDoc, 'refusedDay' | 'refusedCount'>, now: Date): SummaryRefusedToday | null {
  const day = utcDayOf(now);
  if (user.refusedDay !== day || user.refusedCount < 1) return null;
  return { day, count: user.refusedCount, capped: user.refusedCount >= SUMMARY_LIMITS.maxRefusalsPerDay };
}

/**
 * Expired Gmail confirmation codes leave summaryUsers/{uid} when the status is next read (M11 day
 * 1, the 2-day promise): summaryStatus, and every summaryAction, which answers with the status. A
 * failure is logged by error name and never fails the status (the answer hides expired codes
 * anyway).
 */
async function pruneExpiredGmailCodes(uid: string, deps: SummaryCallableDeps, now: Date): Promise<void> {
  try {
    const removed = await pruneGmailRequests(deps.db, uid, now);
    if (removed > 0) logOf(deps).info('summaries.status.gmail_pruned', { uid, removed });
  } catch (error) {
    logOf(deps).warn('summaries.status.gmail_prune_failed', { uid, errorName: errorName(error) });
  }
}

/**
 * The full status of an allowed caller: summaryUsers/{uid} (a disconnect tombstone shows as no
 * address) and the inbox count, which still counts summaries kept after a disconnect without
 * deleteSummaries. Expired Gmail codes are pruned from the document on the way (pruneExpiredGmailCodes).
 * Validated with summaryStatusResponseSchema.
 */
export async function allowedSummaryStatus(uid: string, deps: SummaryCallableDeps): Promise<SummaryStatusResponse> {
  const template = deps.config.template;
  const ready = parseAddressTemplate(template) !== null;
  const now = deps.now();
  const [user, inboxCount] = await Promise.all([readSummaryUser(uid, { db: deps.db }), countInbox(deps.db, uid)]);
  if (user !== null && prunedGmailRequests(user, now) !== null) await pruneExpiredGmailCodes(uid, deps, now);
  const status: SummaryStatusResponse = {
    enabled: true,
    allowed: true,
    ready,
    address: user !== null && ready ? addressFor(user, template) : null,
    mailboxes: user !== null ? [...user.mailboxes] : [],
    gmailRequests: user !== null ? activeGmailRequests(user, now) : [],
    inboxCount,
    lastReceivedAt: user !== null ? isoOrNull(user.lastReceivedAt) : null,
    lastRefused: user !== null ? lastRefusedOrNull(user.lastRefused) : null,
    refusedToday: user !== null ? refusedTodayOf(user, now) : null,
  };
  return summaryStatusResponseSchema.parse(status);
}

function isAllowed(caller: SummaryCaller, config: SummaryCallableConfig): boolean {
  return isVerifiedCaller(caller) && isPilotUid(caller.uid, config.pilotUids);
}

/**
 * summaryStatus {} -> SummaryStatusResponse. Signed out: unauthenticated. Off: enabled false.
 * Unverified or not in the pilot: allowed false. Both answer the empty status without a read.
 */
export async function handleSummaryStatus(
  auth: SummaryCallableAuth,
  data: unknown,
  deps: SummaryCallableDeps,
): Promise<SummaryStatusResponse> {
  const caller = summaryCallerOf(auth);
  if (caller === null) throw summaryError('unauthenticated', MESSAGES.signedOut);
  if (!summaryStatusRequestSchema.safeParse(data ?? {}).success) throw summaryError('invalid_request', MESSAGES.statusArgs);
  if (deps.config.enabled !== true) return emptySummaryStatus(false);
  if (!isAllowed(caller, deps.config)) return emptySummaryStatus(true);
  try {
    return await allowedSummaryStatus(caller.uid, deps);
  } catch (error) {
    logOf(deps).error('summaries.status.failed', { uid: caller.uid, errorName: errorName(error) });
    throw summaryError('upstream_error', MESSAGES.upstream);
  }
}

// ---------------------------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------------------------

interface OpOutcome {
  changed: boolean;
  summary: SummaryState | null;
}

function summaryOutcome(result: SummaryOpResult): OpOutcome {
  if (result.status === 'not_found') throw summaryError('not_found', MESSAGES.notFound);
  if (result.status === 'invalid_meeting') throw summaryError('invalid_meeting', MESSAGES.invalidMeeting);
  return { changed: result.changed, summary: result.state };
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

async function runOp(caller: SummaryCaller, request: SummaryActionRequest, deps: SummaryCallableDeps): Promise<OpOutcome> {
  const uid = caller.uid;
  const db = deps.db;
  switch (request.op) {
    case 'create_address': {
      const result = await createAddress(uid, verifiedEmailOf(caller), addressDeps(deps));
      if (result.status === 'not_ready') throw summaryError('not_ready', MESSAGES.beingSetUp);
      if (result.status === 'rate_limited') throw summaryError('rate_limited', MESSAGES.rateLimited);
      // A deleted account (its ID token outlives the Auth user by up to an hour): nothing was written.
      if (result.status === 'account_deleted') throw summaryError('not_allowed', MESSAGES.notAllowed);
      return { changed: result.status === 'created', summary: null };
    }
    case 'regenerate_address': {
      const result = await regenerateAddress(uid, addressDeps(deps));
      if (result.status === 'not_ready') throw summaryError('not_ready', MESSAGES.beingSetUp);
      if (result.status === 'no_address') throw summaryError('not_ready', MESSAGES.noAddress);
      if (result.status === 'rate_limited') throw summaryError('rate_limited', MESSAGES.rateLimited);
      return { changed: true, summary: null };
    }
    case 'set_mailboxes': {
      const before = await readSummaryUser(uid, { db });
      const result = await setMailboxes(uid, request.mailboxes, addressDeps(deps));
      if (result.status === 'invalid') throw summaryError('invalid_request', MAILBOX_MESSAGES[result.reason]);
      if (result.status === 'no_address') throw summaryError('not_ready', MESSAGES.noAddress);
      return { changed: before === null || !sameList(before.mailboxes, result.mailboxes), summary: null };
    }
    case 'dismiss_gmail': {
      const result = await dismissGmailRequest(db, uid, request.gmailAddress, deps.now());
      return { changed: result.dismissed, summary: null };
    }
    case 'attach':
      return summaryOutcome(
        await attachSummary(
          db,
          uid,
          { summaryId: request.summaryId, meetingId: request.meetingId, occurrenceDate: request.occurrenceDate },
          deps.now(),
        ),
      );
    case 'detach':
      return summaryOutcome(await detachSummary(db, uid, request.summaryId, deps.now()));
    case 'keep':
      return summaryOutcome(await keepSummary(db, uid, request.summaryId, deps.now()));
    case 'delete': {
      const result = await deleteSummary(db, uid, request.summaryId, deps.now());
      return { changed: result.deleted, summary: null };
    }
    case 'disconnect': {
      // The address goes first, so no new summary lands while the summaries are deleted.
      const removed = await deleteAddressDocs(uid, addressDeps(deps), { mode: 'disconnect' });
      let summariesDeleted = 0;
      if (request.deleteSummaries) {
        const bulk = await deleteAllSummaries(db, uid, deps.deleteLimits ?? SUMMARY_BULK_DELETE_LIMITS);
        summariesDeleted = bulk.deleted;
        if (!bulk.complete) {
          logOf(deps).warn('summaries.action.delete_incomplete', { uid, summariesDeleted });
          throw summaryError('upstream_error', MESSAGES.deleteIncomplete);
        }
      }
      logOf(deps).info('summaries.action.disconnected', { uid, addressDeleted: removed.deleted, summariesDeleted });
      return { changed: removed.deleted || summariesDeleted > 0, summary: null };
    }
  }
}

/**
 * The caller after the summaryAction gates: verified, switch on, in the pilot (summaryRead uses
 * the same gates, ./read.ts).
 */
export function requireActionCaller(auth: SummaryCallableAuth, config: Pick<SummaryCallableConfig, 'enabled' | 'pilotUids'>): SummaryCaller {
  const caller = summaryCallerOf(auth);
  if (caller === null) throw summaryError('unauthenticated', MESSAGES.signedOut);
  if (!isVerifiedCaller(caller)) throw summaryError('unauthenticated', MESSAGES.unverified);
  if (config.enabled !== true) throw summaryError('not_enabled', MESSAGES.notEnabled);
  if (!isPilotUid(caller.uid, config.pilotUids)) throw summaryError('not_allowed', MESSAGES.notAllowed);
  return caller;
}

/**
 * summaryAction {op, ...} -> {changed, status, summary}. See the module comment for the gates.
 * The status is read after the op, so the screens update without a second call.
 */
export async function handleSummaryAction(
  auth: SummaryCallableAuth,
  data: unknown,
  deps: SummaryCallableDeps,
): Promise<SummaryActionResponse> {
  const caller = requireActionCaller(auth, deps.config);
  const parsed = summaryActionRequestSchema.safeParse(data ?? {});
  if (!parsed.success) throw summaryError('invalid_request', MESSAGES.invalidRequest);
  const request = parsed.data;
  const log = logOf(deps);
  try {
    const outcome = await runOp(caller, request, deps);
    const status = await allowedSummaryStatus(caller.uid, deps);
    const response = summaryActionResponseSchema.parse({ changed: outcome.changed, status, summary: outcome.summary });
    log.info('summaries.action', { uid: caller.uid, op: request.op, changed: response.changed });
    return response;
  } catch (error) {
    if (error instanceof HttpsError) {
      const reason = (error.details as { reason?: unknown } | undefined)?.reason;
      log.info('summaries.action.refused', { uid: caller.uid, op: request.op, reason: typeof reason === 'string' ? reason : error.code });
      throw error;
    }
    log.error('summaries.action.failed', { uid: caller.uid, op: request.op, errorName: errorName(error) });
    throw summaryError('upstream_error', MESSAGES.upstream);
  }
}

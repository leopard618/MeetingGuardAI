/**
 * fathomWebhook pipeline (docs/v2/FATHOM-CONNECT.md section 5). A pure handler over injected
 * ports; ./functions.ts is the HTTPS shell and loads this module on the first request.
 *
 * Steps, in this order:
 *   0. Switched off: 404. Not POST: 405. Body over FATHOM_MAX_BODY_BYTES: 413.
 *   1. The hook token from the URL (?k=): unknown or malformed answers 200 ignored (a deleted
 *      connection's webhook may still post; a 200 stops the retries and nothing is stored).
 *   2. The connection of that uid must name the same hook; its sealed webhook secret verifies
 *      webhook-id, webhook-timestamp and webhook-signature over the raw body (./signature.ts):
 *      a failure answers 401 and nothing in the body is read.
 *   3. Pilot list and Auth (exists, not disabled): else 200 dropped.
 *   4. The JSON payload (./payload.ts); a body that does not parse or carries no summary and no
 *      action item answers 200 ignored.
 *   5. The user's summary address must still exist (commitSummary re-checks it): else 200 dropped.
 *   6. The recap text through sanitizeText, parseSections and extractSummaryMeta, exactly as an
 *      email recap; no sections records an unreadable refusal.
 *   7. Trust: a signed delivery to this user's own webhook is the strongest copy there is, so it
 *      is stored as decision row 7 (vendor_verified, recipient bound), fresh when the anchor (the
 *      recording's end) is inside the email Fresh window, and the anchor is signed. Matching,
 *      sealing and the commit are the email pipeline's (decide, buildSummaryDoc, commitSummary);
 *      the message key is the Fathom recording id, so a redelivery is a duplicate.
 *   Any Firestore failure or other unexpected error answers 500 (Fathom retries), after the
 *   first-seen time is recorded.
 *
 * Logs: one `summaries.fathom_webhook` line per request past step 0: uid, hook8, verdict, reason,
 * outcome, matched, ms, errorName. Never a title, the text, a token, a secret or a header value.
 */
import * as logger from 'firebase-functions/logger';
import type { Firestore } from 'firebase-admin/firestore';

import { SUMMARY_LIMITS } from '../../shared/aiContract';
import type { Keyring } from '../../shared/sealed';
import { readSummaryUser, usableToken } from '../address';
import { candidateWindow, readPreferencesTimeZone } from '../candidates';
import { isPilotUid } from '../gate';
import type { CandidatesLoader, InboundAuthUsers } from '../inbound';
import { decide, type MatchAnchor, type MatchCandidate } from '../match';
import { buildSummaryDoc, digestMarkerKey, messageMarkerKey, summaryIdFor } from '../model';
import { sanitizeLine, sanitizeText } from '../sanitize';
import { extractSummaryMeta, parseSections } from '../sections';
import { commitSummary, readFirstSeen, recordFirstSeen, recordRefusal } from '../store';
import { anchorOf, fathomMeetingSchema, hasContent, meetingTitleOf, recapTextOf, recordingIdOf } from './payload';
import { verifyFathomSignature } from './signature';
import { hook8, hookHashOf, isRandomToken, openSecrets, readConnection, resolveHook, touchLastEvent } from './store';

/** The sender identity Fathom's own recap email uses; the stored copy names it the same way. */
export const FATHOM_SENDER = 'no-reply@fathom.video';
export const FATHOM_DOMAIN = 'fathom.video';
/** No transcript is asked for, so a delivery is small; this bounds a hostile body. */
export const FATHOM_MAX_BODY_BYTES = 5 * 1024 * 1024;
/** The email Fresh window (authenticity.ts AUTHENTICITY_TUNING freshBeforeMs and freshAfterMs). */
const FRESH_BEFORE_MS = 14 * 24 * 60 * 60 * 1000;
const FRESH_AFTER_MS = 24 * 60 * 60 * 1000;
/** Stored in the auth block's verifier field. */
export const FATHOM_VERIFIER = 'fathom-webhook-v1';

export interface FathomWebhookRequest {
  method: string;
  /** The ?k= query value. Never logged. */
  hookToken: unknown;
  webhookId: string | undefined;
  webhookTimestamp: string | undefined;
  webhookSignature: string | undefined;
  rawBody: Buffer;
}

export interface FathomWebhookResponse {
  status: number;
  body: string;
}

export interface FathomWebhookDeps {
  enabled(): boolean;
  pilotUids(): string;
  keyring(): Keyring;
  db: Firestore;
  authUsers: InboundAuthUsers;
  candidates: CandidatesLoader;
  now(): Date;
}

type Verdict = 'ignored' | 'unauthorized' | 'dropped' | 'refused' | 'stored' | 'error';

const OK: FathomWebhookResponse = { status: 200, body: 'ok' };

class Run {
  uid: string | null = null;
  hook: string | null = null;
  stage = 'start';
  providerEventId: string | null = null;
  attemptAt: Date | null = null;
  constructor(private readonly startedMs: number) {}

  finish(response: FathomWebhookResponse, verdict: Verdict, reason: string, extra: { outcome?: string; matched?: boolean; errorName?: string } = {}) {
    const fields: Record<string, unknown> = {
      uid: this.uid,
      hook8: this.hook,
      verdict,
      reason,
      outcome: extra.outcome ?? null,
      matched: extra.matched === true,
      ms: Date.now() - this.startedMs,
    };
    if (extra.errorName !== undefined) fields.errorName = extra.errorName;
    if (verdict === 'error') logger.error('summaries.fathom_webhook', fields);
    else if (verdict === 'unauthorized') logger.warn('summaries.fathom_webhook', fields);
    else logger.info('summaries.fathom_webhook', fields);
    return response;
  }
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

/** Handles one Fathom delivery. Never throws. */
export async function handleFathomWebhook(request: FathomWebhookRequest, deps: FathomWebhookDeps): Promise<FathomWebhookResponse> {
  if (deps.enabled() !== true) return { status: 404, body: 'Not configured' };
  if (request.method !== 'POST') return { status: 405, body: 'Method Not Allowed' };
  const run = new Run(Date.now());
  if (request.rawBody.length > FATHOM_MAX_BODY_BYTES) return run.finish({ status: 413, body: 'Payload Too Large' }, 'ignored', 'body_too_large');
  try {
    return await processDelivery(request, deps, run);
  } catch (error) {
    if (run.providerEventId !== null && run.attemptAt !== null) {
      try {
        await recordFirstSeen(deps.db, run.providerEventId, run.attemptAt);
      } catch {
        // Firestore is likely down.
      }
    }
    return run.finish({ status: 500, body: 'Internal Server Error' }, 'error', run.stage, { errorName: errorName(error) });
  }
}

async function processDelivery(request: FathomWebhookRequest, deps: FathomWebhookDeps, run: Run): Promise<FathomWebhookResponse> {
  // Step 1: the hook.
  if (!isRandomToken(request.hookToken)) return run.finish(OK, 'ignored', 'no_hook');
  const hash = hookHashOf(request.hookToken);
  run.hook = hook8(hash);
  run.stage = 'resolve';
  const uid = await resolveHook(deps.db, hash);
  if (uid === null) return run.finish(OK, 'ignored', 'unknown_hook');
  run.uid = uid;

  // Step 2: the signature, with the secret of this user's connection.
  run.stage = 'connection';
  const connection = await readConnection(deps.db, uid);
  if (connection === null || connection.hookHash !== hash) return run.finish(OK, 'ignored', 'stale_hook');
  run.stage = 'keyring';
  const secrets = openSecrets(deps.keyring(), uid, connection.sealedSecrets);
  if (secrets.webhookSecret === null) return run.finish(OK, 'ignored', 'no_webhook_secret');
  const attemptAt = deps.now();
  const verdict = verifyFathomSignature({
    id: request.webhookId,
    timestamp: request.webhookTimestamp,
    signature: request.webhookSignature,
    rawBody: request.rawBody,
    secret: secrets.webhookSecret,
    nowMs: attemptAt.getTime(),
  });
  if (verdict !== 'ok') return run.finish({ status: 401, body: 'Unauthorized' }, 'unauthorized', verdict);
  run.providerEventId = `fathom:${request.webhookId as string}`;
  run.attemptAt = attemptAt;

  // Steps 3 to 7: the same for a webhook delivery and a sync (./sync.ts).
  run.stage = 'payload';
  let raw: unknown;
  try {
    raw = JSON.parse(request.rawBody.toString('utf8'));
  } catch {
    return run.finish(OK, 'ignored', 'payload_not_json');
  }
  run.stage = 'first_seen';
  const receivedAt = (await readFirstSeen(deps.db, run.providerEventId)) ?? attemptAt;
  const result = await ingestFathomMeeting(uid, raw, deps, {
    attemptAt,
    receivedAt,
    providerEventId: run.providerEventId,
    stage: (stage) => {
      run.stage = stage;
    },
  });
  return run.finish(OK, result.verdict, result.reason, { outcome: result.outcome, matched: result.matched });
}

/** What ingestFathomMeeting did with one meeting (fixed codes, safe to log). */
export interface FathomIngestResult {
  verdict: 'ignored' | 'dropped' | 'refused' | 'stored';
  reason: string;
  outcome?: string;
  matched?: boolean;
}

export type FathomIngestDeps = Pick<FathomWebhookDeps, 'pilotUids' | 'keyring' | 'db' | 'authUsers' | 'candidates'>;

export interface FathomIngestContext {
  attemptAt: Date;
  /** The first time this copy was seen (a retry keeps it). */
  receivedAt: Date;
  /** The refusal marker key's event id (fathom:<webhook-id>, or fathom:sync:<recording id>). */
  providerEventId: string;
  /** Names the step in progress, for the caller's error log. */
  stage(stage: string): void;
}

/**
 * Steps 3 to 7 for one Fathom meeting of `uid` (a verified webhook delivery or a meeting the sync
 * read with the user's own token): pilot and Auth, the payload, the address, the text, then trust,
 * matching and the commit. Firestore errors propagate.
 */
export async function ingestFathomMeeting(uid: string, raw: unknown, deps: FathomIngestDeps, ctx: FathomIngestContext): Promise<FathomIngestResult> {
  const { attemptAt, receivedAt } = ctx;
  // Step 3: pilot and Auth.
  if (!isPilotUid(uid, deps.pilotUids())) return { verdict: 'dropped', reason: 'not_pilot' };
  ctx.stage('auth_user');
  const authUser = await deps.authUsers.getUser(uid);
  if (!authUser.exists) return { verdict: 'dropped', reason: 'user_missing' };
  if (authUser.disabled) return { verdict: 'dropped', reason: 'user_disabled' };

  // Step 4: the payload.
  ctx.stage('payload');
  const parsed = fathomMeetingSchema.safeParse(raw);
  if (!parsed.success) return { verdict: 'ignored', reason: 'payload_shape' };
  const meeting = parsed.data;
  if (!hasContent(meeting)) return { verdict: 'ignored', reason: 'no_content' };

  // Step 5: the address the commit re-checks.
  ctx.stage('summary_user');
  const summaryUser = await readSummaryUser(uid, { db: deps.db });
  const address = summaryUser === null ? null : usableToken(summaryUser);
  if (address === null) return { verdict: 'dropped', reason: 'no_address' };

  // Step 6: the text.
  ctx.stage('text');
  const sanitized = sanitizeText(recapTextOf(meeting));
  const text = sanitized.text;
  const subjectLine = sanitizeLine(meetingTitleOf(meeting) ?? '', SUMMARY_LIMITS.maxSubjectChars);
  const subject = subjectLine.length > 0 ? subjectLine : null;
  const sections = text.trim().length === 0 ? null : parseSections(text);
  if (sections === null || sections.sections.length === 0) {
    ctx.stage('refusal');
    const outcome = await recordRefusal(deps.db, {
      uid,
      reason: 'unreadable',
      senderDomain: FATHOM_DOMAIN,
      providerEventId: ctx.providerEventId,
      now: attemptAt,
      tokenHash: address.tokenHash,
    });
    return { verdict: 'refused', reason: 'unreadable', outcome };
  }
  const meta = extractSummaryMeta(text, subject);

  // Step 7: trust, anchor, candidates, decide.
  const anchorAtDate = anchorOf(meeting);
  const anchorMs = anchorAtDate?.getTime() ?? Number.NaN;
  const fresh = Number.isFinite(anchorMs) && anchorMs >= receivedAt.getTime() - FRESH_BEFORE_MS && anchorMs <= receivedAt.getTime() + FRESH_AFTER_MS;
  const anchor: MatchAnchor | null = anchorAtDate === null ? null : { at: anchorAtDate.toISOString(), signed: true };
  ctx.stage('candidates');
  const zone = await readPreferencesTimeZone(deps.db, uid);
  const window = candidateWindow({ summaryDate: meta.summaryDate, anchorAt: anchor?.at ?? null });
  const loaded = await deps.candidates(deps.db, uid, window, receivedAt, { preferencesTimeZone: zone });
  const candidates: MatchCandidate[] = loaded.candidates;
  const record = decide({
    tier: 'vendor_verified',
    recipientBound: true,
    fresh,
    titleLine: meta.titleLine,
    subjectClean: meta.subjectClean,
    summaryDate: meta.summaryDate,
    anchor,
    text,
    preferencesTimeZone: loaded.preferencesTimeZone,
    rejectedMeetingIds: [],
    candidates,
    now: attemptAt,
  });

  const messageKey = fathomMessageKey(recordingIdOf(meeting));
  const summaryId = summaryIdFor(uid, messageKey);
  ctx.stage('build');
  const built = buildSummaryDoc({
    keyring: deps.keyring(),
    uid,
    summaryId,
    classification: {
      row: 7,
      tier: 'vendor_verified',
      recipientBound: true,
      fresh,
      senderDomain: FATHOM_DOMAIN,
      anchorAt: anchorAtDate,
      anchorSource: anchorAtDate === null ? null : 'signed_date',
    },
    match: record,
    sections,
    meta,
    text,
    textTruncated: sanitized.truncated,
    subject,
    fromAddress: FATHOM_SENDER,
    fromName: null,
    auth: { dkim: [], arc: { result: 'none', sealer: null }, verifier: FATHOM_VERIFIER },
    sentAt: anchorAtDate,
    receivedAt,
    language: typeof meeting.transcript_language === 'string' ? meeting.transcript_language : null,
    now: attemptAt,
  });
  // Where the copy came from (the stored schema keeps unknown fields).
  const doc = { ...built.doc, source: 'fathom_api' };

  ctx.stage('commit');
  const result = await commitSummary(deps.db, {
    uid,
    tokenHash: address.tokenHash,
    summaryId,
    doc,
    reseal: built.reseal,
    claimMarkers: built.claimMarkers,
    messageIdMarkerKey: messageMarkerKey(uid, messageKey),
    digestMarkerKey: digestMarkerKey(uid, built.doc.contentDigest),
    rank: built.rank,
    now: attemptAt,
  });
  if (result.outcome === 'created' || result.outcome === 'upgraded') {
    try {
      await touchLastEvent(deps.db, uid, attemptAt);
    } catch {
      // Best effort: the status line only.
    }
  }
  if (result.outcome === 'dropped') return { verdict: 'dropped', reason: result.reason, outcome: result.outcome };
  const reason = built.doc.status === 'matched' ? 'filed' : (built.doc.inboxReason ?? 'inbox');
  return { verdict: 'stored', reason, outcome: result.outcome, matched: result.status === 'matched' };
}

/** The message key of a Fathom recording: a webhook delivery and a sync of it are one copy. */
export function fathomMessageKey(recordingId: string): string {
  return `fathom:rec:${recordingId}`;
}

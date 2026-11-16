/**
 * Shared harness for the M11 store and handler tests (functions/src/summaries/commitments*.ts):
 * sealed synthetic summaries in the in-memory Firestore fake, a scripted model, the quota fake and
 * a capturing logger. Not a test file itself (no *.test.ts suffix). All data is synthetic; special
 * characters are built from code points.
 */
import { createHash } from 'node:crypto';

import type { Firestore } from 'firebase-admin/firestore';

import type { LlmClient, LlmRequest, LlmResult } from '../../src/assistant/llm';
import { parseKeyring, type Keyring } from '../../src/shared/sealed';
import type { SummaryCallableAuth } from '../../src/summaries/callables';
import type { CommitmentsDeps, CommitmentsLogger } from '../../src/summaries/commitmentsHandler';
import {
  SUMMARY_SCHEMA_VERSION,
  addDaysIso,
  sealSummaryContent,
  storedSummarySchema,
  summaryDocPath,
  type StoredMatch,
  type StoredSummaryDoc,
} from '../../src/summaries/model';
import { parseSections } from '../../src/summaries/sections';
import { SPECIMEN, itemOf, parsed } from './commitmentsFixtures';
import { FakeQuotaStore } from './fakes';
import { FakeFirestore } from './summariesFakeFirestore';

export const KEY_1 = `k1:${Buffer.alloc(32, 7).toString('base64')}`;
export const KEY_2 = `k2:${Buffer.alloc(32, 9).toString('base64')}`;
export const KEYRING: Keyring = parseKeyring(KEY_1);
/** After a rotation: k2 seals and digests, k1 still opens. */
export const ROTATED_KEYRING: Keyring = parseKeyring(`${KEY_2},${KEY_1}`);

export const UID = 'uidCommitDana01';
export const OTHER_UID = 'uidCommitLee02';
export const MEETING_ID = 'mtgUrpayrollSync01';
export const MEETING_TITLE = 'Urpayroll weekly sync';
/** The meeting started Fri 2026-10-16 14:00 UTC (09:00 in Mexico City). */
export const MEETING_START = '2026-10-16T14:00:00.000Z';
export const NOW = new Date('2026-10-17T15:00:00.000Z');
export const RECEIVED_AT = '2026-10-16T16:00:00.000Z';

/** Distinct 64-hex summary ids. */
export function sid(label: string): string {
  return createHash('sha256').update(`commitments-test:${label}`).digest('hex');
}

export const SUMMARY_A = sid('a');
export const SUMMARY_B = sid('b');

export function verifiedAuth(uid: string = UID, name: string | null = 'Dana Ruiz'): SummaryCallableAuth {
  return {
    uid,
    token: { email: 'dana@company.example', email_verified: true, firebase: { sign_in_provider: 'password' }, ...(name === null ? {} : { name }) },
  };
}

export function autoMatch(overrides: Partial<StoredMatch> = {}, snapshot: Partial<StoredMatch['meetingSnapshot']> = {}): StoredMatch {
  return {
    meetingId: MEETING_ID,
    occurrenceDate: null,
    duplicateMeetingIds: [],
    method: 'auto',
    score: 1,
    titleScore: 1,
    timeScore: 1,
    reasons: ['rule_a'],
    zoneUsed: 'meeting',
    matchedAt: RECEIVED_AT,
    meetingSnapshot: {
      title: MEETING_TITLE,
      startAt: MEETING_START,
      endAt: '2026-10-16T15:00:00.000Z',
      timezone: 'America/Mexico_City',
      ...snapshot,
    },
    ...overrides,
  };
}

export interface SeedOptions {
  uid?: string;
  text?: string;
  status?: 'matched' | 'kept' | 'inbox';
  match?: StoredMatch | null;
  trust?: Partial<StoredSummaryDoc['trust']>;
  contentDigest?: string;
  parserVersion?: number;
  extraction?: unknown;
  forwardedBy?: string | null;
  summaryDate?: string | null;
  language?: string | null;
  possibleInstruction?: boolean;
  keyring?: Keyring;
}

/** A sealed summary document (row 7, filed under MEETING_ID by default). */
export function summaryDocOf(summaryId: string, options: SeedOptions = {}): StoredSummaryDoc {
  const uid = options.uid ?? UID;
  const text = options.text ?? SPECIMEN;
  const sections = parseSections(text);
  const sealed = sealSummaryContent(
    options.keyring ?? KEYRING,
    { uid, summaryId },
    {
      head: { subject: 'Recap: Urpayroll weekly sync', titleLine: 'Urpayroll weekly sync', dateLine: null },
      body: { fromAddress: 'recaps@notetaker.example', fromName: null, forwardedBy: options.forwardedBy ?? null, text, sections: sections.sections },
    },
  );
  const status = options.status ?? 'matched';
  return storedSummarySchema.parse({
    schemaVersion: SUMMARY_SCHEMA_VERSION,
    parserVersion: options.parserVersion ?? sections.parserVersion,
    status,
    inboxReason: status === 'inbox' ? 'no_candidate' : null,
    refusedReason: null,
    trust: { tier: 'vendor_verified', recipientBound: true, fresh: true, anchorSource: 'signed_date', originalInboxReason: null, ...options.trust },
    senderDomain: 'notetaker.example',
    vendorDomain: 'notetaker.example',
    auth: {
      dkim: [{ domain: 'notetaker.example', result: 'pass', aligned: true, signsTo: true, signsDate: true }],
      arc: { result: 'none', sealer: null },
      verifier: 'mailauth@8.0.4',
    },
    receivedAt: RECEIVED_AT,
    sentAt: RECEIVED_AT,
    anchorAt: RECEIVED_AT,
    summaryDate: options.summaryDate === undefined ? '2026-10-16' : options.summaryDate,
    language: options.language === undefined ? 'en' : options.language,
    match: status === 'matched' ? (options.match === undefined ? autoMatch() : options.match) : null,
    candidates: [],
    rejectedMeetingIds: [],
    counts: { sections: sections.sections.length, items: sections.counts.items, textChars: text.length },
    flags: { truncated: false, textCutForSize: false, itemTextFromOffsets: false, possibleInstruction: options.possibleInstruction ?? sections.possibleInstruction },
    contentDigest: options.contentDigest ?? createHash('sha256').update(`digest:${summaryId}:${text}`).digest('hex'),
    userAction: null,
    extraction: options.extraction ?? null,
    sealedHead: sealed.sealedHead,
    sealedBody: sealed.sealedBody,
    createdAt: RECEIVED_AT,
    updatedAt: RECEIVED_AT,
    expiresAt: addDaysIso(RECEIVED_AT, 365),
  });
}

export function seedSummary(db: FakeFirestore, summaryId: string, options: SeedOptions = {}): string {
  const path = summaryDocPath(options.uid ?? UID, summaryId);
  db.seed(path, summaryDocOf(summaryId, options) as unknown as Record<string, unknown>);
  return path;
}

export function seedMeeting(db: FakeFirestore, overrides: Record<string, unknown> = {}, meetingId: string = MEETING_ID, uid: string = UID): void {
  db.seed(`users/${uid}/meetings/${meetingId}`, {
    userId: uid,
    title: MEETING_TITLE,
    startAt: MEETING_START,
    durationMinutes: 60,
    timezone: 'America/Mexico_City',
    status: 'scheduled',
    source: 'manual',
    deletedAt: null,
    ...overrides,
  });
}

/** The item ids of the specimen (the parser's own ids). */
export function specimenId(prefix: string, text: string = SPECIMEN): string {
  return itemOf(parsed(text), prefix).id;
}

/** A model answer with one propose_commitments call. */
export function toolResult(commitments: unknown[], overrides: Partial<LlmResult> = {}): LlmResult {
  return {
    content: null,
    refusal: null,
    toolCalls: [{ name: 'propose_commitments', arguments: JSON.stringify({ commitments }) }],
    finishReason: 'tool_calls',
    usage: { promptTokens: 1200, completionTokens: 300 },
    ...overrides,
  };
}

export type ScriptStep = LlmResult | Error | ((request: LlmRequest) => Promise<LlmResult> | LlmResult);

/** A model that answers from a script, one step per call (the last step repeats). */
export class ScriptedLlm implements LlmClient {
  readonly requests: LlmRequest[] = [];
  constructor(private readonly steps: ScriptStep[]) {}

  async complete(request: LlmRequest): Promise<LlmResult> {
    this.requests.push(request);
    const step = this.steps[Math.min(this.requests.length - 1, this.steps.length - 1)];
    if (step === undefined) throw new Error('no scripted answer');
    if (step instanceof Error) throw step;
    if (typeof step === 'function') return step(request);
    return step;
  }
}

export interface CapturedLog {
  level: 'info' | 'warn' | 'error';
  event: string;
  fields: Record<string, unknown>;
}

export function capturingLogger(): { logger: CommitmentsLogger; entries: CapturedLog[]; text(): string } {
  const entries: CapturedLog[] = [];
  return {
    entries,
    logger: {
      info: (event, fields) => entries.push({ level: 'info', event, fields }),
      warn: (event, fields) => entries.push({ level: 'warn', event, fields }),
      error: (event, fields) => entries.push({ level: 'error', event, fields }),
    },
    text: () => JSON.stringify(entries),
  };
}

export interface Harness {
  db: FakeFirestore;
  quota: FakeQuotaStore;
  llm: ScriptedLlm;
  llmFactory: jest.Mock<LlmClient, []>;
  log: ReturnType<typeof capturingLogger>;
  deps: CommitmentsDeps;
  clock: { now: Date };
  /** The keyring the deps hand out (swap it to simulate a rotation). */
  keys: { ring: Keyring };
}

export function harness(steps: ScriptStep[] = [toolResult([])], options: { keyring?: Keyring; pilot?: string; enabled?: boolean } = {}): Harness {
  const db = new FakeFirestore();
  const quota = new FakeQuotaStore();
  const llm = new ScriptedLlm(steps);
  const llmFactory = jest.fn((): LlmClient => llm);
  const log = capturingLogger();
  const clock = { now: NOW };
  const keys = { ring: options.keyring ?? KEYRING };
  let lease = 0;
  const deps: CommitmentsDeps = {
    db: db as unknown as Firestore,
    now: () => clock.now,
    config: { enabled: options.enabled ?? true, pilotUids: options.pilot ?? `${UID},${OTHER_UID}` },
    keyring: () => keys.ring,
    quota,
    llm: llmFactory,
    model: () => 'gpt-test-mini',
    logger: log.logger,
    nonce: () => 'n0nce',
    newLeaseId: () => {
      lease += 1;
      return lease.toString(16).padStart(32, '0');
    },
  };
  return { db, quota, llm, llmFactory, log, deps, clock, keys };
}

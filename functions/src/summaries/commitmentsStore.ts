/**
 * The Firestore side of a summary's commitments (docs/v2/M11-DESIGN.md sections 2.7 to 2.9, 3.4
 * and 3.5; section 15 findings 8, 15 and 20). The shapes and the pure steps are in
 * ./commitmentsModel.ts; this file runs the transactions.
 *
 * Rules every write follows:
 * - Only the single top-level field `extraction` of users/{uid}/meetingSummaries/{id} is written,
 *   with tx.update() inside a transaction that first read the document and found a summary that is
 *   filed (matched) or kept (the M10 rule, summaries/actions.ts). Never set(), never a merge: a
 *   summary deleted, purged or removed by "Disconnect and delete" while the model runs gets
 *   nothing written, so no extraction-only document without expiresAt can appear (finding 15).
 * - The final write of a preparation re-reads the document and writes only while the content
 *   digest is the one the text was read with and (AI) the lease is still this preparation's;
 *   otherwise the result is discarded.
 * - The size of the document is estimated before every extraction write (model.ts
 *   estimateDocBytes); past FIRESTORE_MAX_DOC_BYTES minus a margin the kept other view is left
 *   out, and past it still the write is refused (too_large) instead of failing in Firestore.
 * - decide writes the tasks (users/{uid}/tasks/{id}, deterministic ids, existing task fields only)
 *   and the decisions in ONE transaction that reads the summary, the matched meeting and every
 *   target task before any write, so a second tap, a second device or a WhatsApp reply for the
 *   same line finds the task and answers already_added.
 * Nothing here logs; callers log counts and reason codes only.
 *
 * Product text rule: ASCII punctuation only in this file.
 */
import type { DocumentReference, DocumentSnapshot, Firestore, Transaction } from 'firebase-admin/firestore';

import {
  MEETING_ID_PATTERN,
  type CommitmentChannel,
  type CommitmentDecisionKind,
  type CommitmentDraft,
  type CommitmentMode,
  type CommitmentOutcome,
} from '../shared/aiContract';
import { toLocalDateTime } from '../shared/time';
import type { Keyring } from '../shared/sealed';
import { EXTRACTOR_VERSION } from '../commitments/extraction';
import { taskFieldsDigest, taskFieldsDigestCandidates, taskVisibleFieldsOf } from '../commitments/ids';
import {
  buildCommitmentTaskDoc,
  chooseTaskZone,
  commitmentOriginLine,
  defaultSchedule,
  taskMeetingIdOf,
  taskTitleFor,
  type CommitmentTaskDoc,
} from '../commitments/taskDoc';
import { ownerPrefixed } from '../commitments/verify';
import {
  callsFor,
  compactDecisions,
  decided,
  decisionOf,
  emptyExtraction,
  isCurrent,
  leaseAlive,
  mirrored,
  openView,
  parseExtraction,
  switchedTo,
  taskIdOf,
  withDecision,
  type SealedViewItem,
  type StoredCommitmentItem,
  type StoredDecision,
  type StoredExtraction,
  type StoredView,
} from './commitmentsModel';
import { FIRESTORE_MAX_DOC_BYTES, estimateDocBytes, parseSummaryRecord, summaryDocPath, type StoredSummaryDoc, type SummaryRef } from './model';
import { summariesCollection } from './store';

/** Headroom under Firestore's 1 MiB limit kept by every extraction write. */
export const EXTRACTION_SIZE_MARGIN_BYTES = 16 * 1024;
/** Other summaries of the same meeting read for the "already added" marks. */
export const SIMILAR_SCAN_LIMIT = 10;

const MEETINGS_PATH = (uid: string, meetingId: string): string => `users/${uid}/meetings/${meetingId}`;
const TASK_PATH = (uid: string, taskId: string): string => `users/${uid}/tasks/${taskId}`;

/** A filed or kept summary as a transaction read it, with its parsed extraction. */
export interface SummaryInTx {
  ref: DocumentReference;
  data: Record<string, unknown>;
  doc: StoredSummaryDoc;
  extraction: StoredExtraction | null;
}

async function readSummaryInTx(tx: Transaction, db: Firestore, ref: SummaryRef): Promise<SummaryInTx | null> {
  const docRef = db.doc(summaryDocPath(ref.uid, ref.summaryId));
  const snapshot = (await tx.get(docRef)) as DocumentSnapshot;
  if (!snapshot.exists) return null;
  const data = (snapshot.data() ?? {}) as Record<string, unknown>;
  const record = parseSummaryRecord(data);
  if (record === null || record.kind !== 'summary') return null;
  if (record.doc.status !== 'matched' && record.doc.status !== 'kept') return null;
  return { ref: docRef, data, doc: record.doc, extraction: parseExtraction(record.doc.extraction) };
}

/** Whether the extraction fits the document; drops the other view first when it does not. */
export function fitExtraction(path: string, data: Record<string, unknown>, extraction: StoredExtraction): StoredExtraction | null {
  const limit = FIRESTORE_MAX_DOC_BYTES - EXTRACTION_SIZE_MARGIN_BYTES;
  if (estimateDocBytes(path, { ...data, extraction }) <= limit) return extraction;
  if (extraction.mode === null) return null;
  const other: CommitmentMode = extraction.mode === 'ai' ? 'as_written' : 'ai';
  const slim: StoredExtraction = { ...extraction, views: { ...extraction.views, [other]: null } };
  return estimateDocBytes(path, { ...data, extraction: slim }) <= limit ? slim : null;
}

// ---------------------------------------------------------------------------------------------
// Preparation
// ---------------------------------------------------------------------------------------------

export type BeginResult =
  /** A current view of the mode exists (now in use). */
  | { kind: 'ready'; extraction: StoredExtraction }
  /** Nothing usable: build it (as_written takes no lease). */
  | { kind: 'build'; extraction: StoredExtraction | null }
  /** The lease is ours: call the model. */
  | { kind: 'leased'; extraction: StoredExtraction }
  | { kind: 'preparing' }
  /** maxModelCalls reached for this content and extractor version. */
  | { kind: 'cap' }
  | { kind: 'not_found' }
  /** The content changed since the text was read: read it again. */
  | { kind: 'changed' }
  | { kind: 'too_large' };

export interface BeginInput {
  ref: SummaryRef;
  mode: CommitmentMode;
  /** The contentDigest the text in hand was read with. */
  contentDigest: string;
  leaseId: string;
  leaseSeconds: number;
  maxModelCalls: number;
  now: Date;
}

/**
 * The first transaction of prepare: the current view of the mode when it exists (switching the
 * view in use, which needs no model call), 'preparing' while another lease lives, 'cap' at the
 * call cap, else the lease (AI) or a go-ahead (as written).
 */
export function beginPreparation(db: Firestore, input: BeginInput): Promise<BeginResult> {
  return db.runTransaction(async (tx): Promise<BeginResult> => {
    const summary = await readSummaryInTx(tx, db, input.ref);
    if (summary === null) return { kind: 'not_found' };
    if (summary.doc.contentDigest !== input.contentDigest) return { kind: 'changed' };
    const extraction = summary.extraction;
    if (extraction !== null && isCurrent(extraction, summary.doc) && extraction.views[input.mode] !== null) {
      if (extraction.mode === input.mode) return { kind: 'ready', extraction };
      const switched = fitExtraction(summary.ref.path, summary.data, switchedTo(extraction, input.mode, input.now));
      if (switched === null) return { kind: 'too_large' };
      tx.update(summary.ref, { extraction: switched });
      return { kind: 'ready', extraction: switched };
    }
    if (input.mode === 'as_written') return { kind: 'build', extraction };
    if (leaseAlive(extraction, input.now)) return { kind: 'preparing' };
    if (callsFor(extraction, summary.doc.contentDigest) >= input.maxModelCalls) return { kind: 'cap' };
    const base = extraction ?? emptyExtraction(summary.doc, input.now);
    const leased: StoredExtraction = {
      ...base,
      lease: { until: new Date(input.now.getTime() + input.leaseSeconds * 1000).toISOString(), id: input.leaseId },
      updatedAt: input.now.toISOString(),
    };
    const fitted = fitExtraction(summary.ref.path, summary.data, leased);
    if (fitted === null) return { kind: 'too_large' };
    tx.update(summary.ref, { extraction: fitted });
    return { kind: 'leased', extraction: fitted };
  });
}

export type LeaseWriteResult = 'ok' | 'gone' | 'lost';

export interface RecordCallInput {
  ref: SummaryRef;
  leaseId: string;
  contentDigest: string;
  /** The charge consumeQuota just made (null when the summary was charged before). */
  charge: StoredExtraction['charge'];
  now: Date;
}

/** Counts the model call about to be made (and records a new charge), while the lease is ours. */
export function recordModelCall(db: Firestore, input: RecordCallInput): Promise<LeaseWriteResult> {
  return db.runTransaction(async (tx): Promise<LeaseWriteResult> => {
    const summary = await readSummaryInTx(tx, db, input.ref);
    if (summary === null) return 'gone';
    const extraction = summary.extraction;
    if (extraction === null || extraction.lease?.id !== input.leaseId || summary.doc.contentDigest !== input.contentDigest) return 'lost';
    const next: StoredExtraction = {
      ...extraction,
      calls: { n: callsFor(extraction, input.contentDigest) + 1, digest: input.contentDigest, extractorVersion: EXTRACTOR_VERSION },
      charge: input.charge ?? extraction.charge,
      updatedAt: input.now.toISOString(),
    };
    tx.update(summary.ref, { extraction: next });
    return 'ok';
  });
}

export interface SettleInput {
  ref: SummaryRef;
  leaseId: string;
  contentDigest: string;
  /**
   * Take the counted call back off the cap. The handler passes false: section 2.8 counts every
   * model call, refunded or not (kept as a switch for the lead's decision, see M11-DESIGN.md).
   */
  uncountCall: boolean;
  /** The charge was refunded: the next AI preparation charges again. */
  clearCharge: boolean;
  now: Date;
}

/** After a failed preparation: releases our lease and undoes what the failure gives back. */
export function settleFailedPreparation(db: Firestore, input: SettleInput): Promise<LeaseWriteResult> {
  return db.runTransaction(async (tx): Promise<LeaseWriteResult> => {
    const summary = await readSummaryInTx(tx, db, input.ref);
    if (summary === null) return 'gone';
    const extraction = summary.extraction;
    if (extraction === null) return 'lost';
    const ours = extraction.lease?.id === input.leaseId;
    let calls = extraction.calls;
    if (input.uncountCall && calls !== null && calls.digest === input.contentDigest && calls.extractorVersion === EXTRACTOR_VERSION && calls.n > 0) {
      calls = { ...calls, n: calls.n - 1 };
    }
    if (!ours && calls === extraction.calls && !(input.clearCharge && extraction.charge !== null)) return 'lost';
    const next: StoredExtraction = {
      ...extraction,
      lease: ours ? null : extraction.lease,
      calls,
      charge: input.clearCharge ? null : extraction.charge,
      updatedAt: input.now.toISOString(),
    };
    tx.update(summary.ref, { extraction: next });
    return ours ? 'ok' : 'lost';
  });
}

export type CommitResult =
  | { kind: 'written'; extraction: StoredExtraction; carried: number; similar: number }
  | { kind: 'not_found' }
  | { kind: 'changed' }
  | { kind: 'lost' }
  | { kind: 'too_large' };

export interface CommitInput {
  ref: SummaryRef;
  contentDigest: string;
  /** The AI preparation's lease (the write needs it still ours); null for as written. */
  leaseId: string | null;
  /** The pure step (commitmentsModel nextExtraction) over the extraction read in the transaction. */
  build: (previous: StoredExtraction | null, doc: StoredSummaryDoc) => { extraction: StoredExtraction; carried: number; similar: number };
}

/** The final write of a preparation (see the module comment). */
export function commitPreparation(db: Firestore, input: CommitInput): Promise<CommitResult> {
  return db.runTransaction(async (tx): Promise<CommitResult> => {
    const summary = await readSummaryInTx(tx, db, input.ref);
    if (summary === null) return { kind: 'not_found' };
    if (summary.doc.contentDigest !== input.contentDigest) return { kind: 'changed' };
    if (input.leaseId !== null && summary.extraction?.lease?.id !== input.leaseId) return { kind: 'lost' };
    const built = input.build(summary.extraction, summary.doc);
    const fitted = fitExtraction(summary.ref.path, summary.data, built.extraction);
    if (fitted === null) return { kind: 'too_large' };
    tx.update(summary.ref, { extraction: fitted });
    return { kind: 'written', extraction: fitted, carried: built.carried, similar: built.similar };
  });
}

// ---------------------------------------------------------------------------------------------
// Reads outside transactions
// ---------------------------------------------------------------------------------------------

/**
 * textKeys of lines ACCEPTED in other summaries filed under the same meeting (the meeting view's
 * equality query, field mask on the decisions only, at most SIMILAR_SCAN_LIMIT documents).
 */
export async function readSimilarTextKeys(db: Firestore, ref: SummaryRef, meetingId: string | null): Promise<Set<string>> {
  const keys = new Set<string>();
  if (meetingId === null || !MEETING_ID_PATTERN.test(meetingId)) return keys;
  const snapshot = await summariesCollection(db, ref.uid)
    .where('match.meetingId', '==', meetingId)
    .select('status', 'extraction.decisions')
    .limit(SIMILAR_SCAN_LIMIT + 1)
    .get();
  for (const document of snapshot.docs) {
    if (document.id === ref.summaryId) continue;
    const data = (document.data() ?? {}) as { status?: unknown; extraction?: { decisions?: unknown } };
    if (data.status !== 'matched' || !Array.isArray(data.extraction?.decisions)) continue;
    for (const entry of data.extraction.decisions as unknown[]) {
      const decision = entry as { s?: unknown; t?: unknown };
      if (decision.s === 'accepted' && typeof decision.t === 'string' && /^[0-9a-f]{24}$/.test(decision.t)) keys.add(decision.t);
    }
  }
  return keys;
}

/** Which of these task ids still exist (one getAll; nothing when the list is empty). */
export async function readExistingTasks(db: Firestore, uid: string, taskIds: readonly string[]): Promise<Set<string>> {
  const unique = [...new Set(taskIds)].filter((id) => MEETING_ID_PATTERN.test(id));
  const existing = new Set<string>();
  if (unique.length === 0) return existing;
  const snapshots = await db.getAll(...unique.map((id) => db.doc(TASK_PATH(uid, id))), { fieldMask: ['userId'] });
  for (const snapshot of snapshots) if (snapshot.exists) existing.add(snapshot.id);
  return existing;
}

// ---------------------------------------------------------------------------------------------
// decide (section 3.4)
// ---------------------------------------------------------------------------------------------

export interface DecideRequestItem {
  anchorId: string;
  decision: CommitmentDecisionKind;
  /** accept: the task as the user accepts it (the app); null: the defaults of section 3.4 (WhatsApp). */
  draft: CommitmentDraft | null;
}

export interface DecideInput {
  ref: SummaryRef;
  /** The view the decisions were made on. */
  key: string;
  /** The contentDigest of the text the caller read (the answer quotes it). */
  contentDigest: string;
  channel: CommitmentChannel;
  /** The device zone (app); null on WhatsApp. */
  requestZone: string | null;
  /** users/{uid}/settings/preferences.timezone as stored, or null. */
  preferencesZone: string | null;
  /** The origin line's language. */
  language: string | null;
  decisions: readonly DecideRequestItem[];
  keyring: Keyring;
  now: Date;
}

export interface DecideOutcome {
  anchorId: string;
  outcome: CommitmentOutcome;
  taskId: string | null;
}

export type DecideResult =
  | { kind: 'decided'; extraction: StoredExtraction; view: StoredView; results: DecideOutcome[]; added: number; removed: number }
  | { kind: 'not_found' }
  | { kind: 'stale' };

/** A draft or a default that does not make a valid task (the whole call is invalid_request). */
export class CommitmentDecideError extends Error {
  constructor(readonly reason: 'invalid_task' | 'invalid_zone' | 'invalid_owner' | 'invalid_uid') {
    super(`summaries.commitments: ${reason}`);
    this.name = 'CommitmentDecideError';
  }
}

/** The date the origin line names: the occurrence, else the meeting's local date, else the summary's. */
export function originDateOf(doc: Pick<StoredSummaryDoc, 'match' | 'summaryDate'>): string | null {
  const match = doc.match;
  if (match !== null) {
    if (match.occurrenceDate !== null) return match.occurrenceDate;
    const ms = Date.parse(match.meetingSnapshot.startAt);
    if (Number.isFinite(ms)) {
      try {
        return toLocalDateTime(ms, match.meetingSnapshot.timezone).date;
      } catch {
        return toLocalDateTime(ms, 'UTC').date;
      }
    }
  }
  return doc.summaryDate;
}

/**
 * The title written for an accepted line: the user's edit as typed; an unchanged suggestion whose
 * owner the user changed gets its "<owner>: " prefix rebuilt for the new owner (or none for the
 * user or nobody).
 */
export function acceptedTitleOf(
  suggestion: { title: string; owner: string | null; role: StoredCommitmentItem['owner'] },
  draft: Pick<CommitmentDraft, 'title' | 'owner'> | null,
): string {
  if (draft === null) return suggestion.title;
  if (draft.title.trim() !== suggestion.title) return taskTitleFor(suggestion.title, draft.title);
  const before = suggestion.role === 'other' ? suggestion.owner : null;
  const after = draft.owner !== null && !draft.owner.isUser ? draft.owner.name : null;
  if ((before ?? '').trim() === (after ?? '').trim()) return suggestion.title;
  let title = suggestion.title;
  if (before !== null && title.startsWith(`${before}: `)) title = title.slice(before.length + 2).trim();
  if (title.length === 0) return suggestion.title;
  return after === null ? title : ownerPrefixed(title, after);
}

interface Target {
  index: number;
  request: DecideRequestItem;
  item: StoredCommitmentItem | null;
  content: SealedViewItem | null;
}

function taskRef(db: Firestore, uid: string, taskId: string): DocumentReference {
  return db.doc(TASK_PATH(uid, taskId));
}

/**
 * Applies 1 to 30 decisions in one transaction (see the module comment and section 3.4). Throws
 * CommitmentDecideError for a task that cannot be built (nothing is written) and SealedError
 * when the view's blob does not open.
 */
export function decideCommitments(db: Firestore, input: DecideInput): Promise<DecideResult> {
  const { ref, now } = input;
  return db.runTransaction(async (tx): Promise<DecideResult> => {
    // 1. The summary, its extraction and the view the decisions name.
    const summary = await readSummaryInTx(tx, db, ref);
    if (summary === null) return { kind: 'not_found' };
    const extraction = summary.extraction;
    if (extraction === null || summary.doc.contentDigest !== input.contentDigest || !isCurrent(extraction, summary.doc)) return { kind: 'stale' };
    const mode: CommitmentMode | null =
      extraction.views.ai?.key === input.key ? 'ai' : extraction.views.as_written?.key === input.key ? 'as_written' : null;
    const view = mode === null ? null : extraction.views[mode];
    if (mode === null || view === null) return { kind: 'stale' };
    const sealed = openView(input.keyring, ref, view);
    const byAnchor = new Map(view.items.map((item, index) => [item.a, { item, content: sealed[index] ?? null }]));
    const targets: Target[] = input.decisions.map((request, index) => {
      const found = byAnchor.get(request.anchorId);
      return { index, request, item: found?.item ?? null, content: found?.content ?? null };
    });

    // 2. The matched meeting (a missing or tombstoned one gives meetingId null on the task).
    const match = summary.doc.match;
    const meetingRef = match !== null && MEETING_ID_PATTERN.test(match.meetingId) ? db.doc(MEETINGS_PATH(ref.uid, match.meetingId)) : null;
    const meetingSnap = meetingRef === null ? null : ((await tx.get(meetingRef)) as DocumentSnapshot);
    const meetingDoc = meetingSnap !== null && meetingSnap.exists ? ((meetingSnap.data() ?? {}) as Record<string, unknown>) : null;

    // 3. Every target task, before any write.
    const wanted = new Set<string>();
    for (const target of targets) {
      if (target.item === null) continue;
      const decision = decisionOf(extraction.decisions, target.item.k);
      const gen = decision?.gen ?? 0;
      if (target.request.decision === 'accept') {
        if (decision?.s === 'accepted' && decision.taskId !== null) {
          wanted.add(decision.taskId);
          wanted.add(taskIdOf(ref.summaryId, target.item.k, gen + 1));
        } else {
          wanted.add(taskIdOf(ref.summaryId, target.item.k, gen));
        }
      } else if (target.request.decision === 'remove' && decision?.s === 'accepted' && decision.taskId !== null) {
        wanted.add(decision.taskId);
      }
    }
    const tasks = new Map<string, Record<string, unknown> | null>();
    const wantedIds = [...wanted];
    if (wantedIds.length > 0) {
      const snapshots = (await tx.getAll(...wantedIds.map((id) => taskRef(db, ref.uid, id)))) as DocumentSnapshot[];
      snapshots.forEach((snapshot, index) => {
        const id = wantedIds[index] as string;
        tasks.set(id, snapshot.exists ? ((snapshot.data() ?? {}) as Record<string, unknown>) : null);
      });
    }

    // 4 and 5. Outcomes and writes.
    const meetingZone = match?.meetingSnapshot.timezone ?? null;
    const description = commitmentOriginLine({
      language: input.language,
      mode,
      meetingTitle: match?.meetingSnapshot.title ?? null,
      date: originDateOf(summary.doc),
    });
    const taskMeetingId = taskMeetingIdOf(match?.meetingId ?? null, meetingDoc);
    let decisions: StoredDecision[] = [...extraction.decisions];
    const creates: { id: string; doc: Record<string, unknown> }[] = [];
    const deletes: string[] = [];
    const results: DecideOutcome[] = [];
    let added = 0;
    let removed = 0;
    const record = (item: StoredCommitmentItem, base: StoredDecision | null, next: Omit<Parameters<typeof decided>[1], 'k' | 't' | 'qs' | 'qe'>): void => {
      decisions = withDecision(decisions, decided(base, { ...next, k: item.k, t: item.t, qs: item.qs, qe: item.qe }, now));
    };

    for (const target of targets) {
      const { request, item, content } = target;
      if (item === null || content === null) {
        results.push({ anchorId: request.anchorId, outcome: 'not_open', taskId: null });
        continue;
      }
      const decision = decisionOf(decisions, item.k);
      const status = decision?.s ?? 'open';
      const gen = decision?.gen ?? 0;
      switch (request.decision) {
        case 'accept': {
          if (status === 'dropped') {
            results.push({ anchorId: request.anchorId, outcome: 'not_open', taskId: null });
            break;
          }
          let taskGen = gen;
          if (status === 'accepted' && decision !== null && decision.taskId !== null) {
            if (tasks.get(decision.taskId) !== null && tasks.get(decision.taskId) !== undefined) {
              results.push({ anchorId: request.anchorId, outcome: 'already_added', taskId: decision.taskId });
              break;
            }
            taskGen = gen + 1; // "Add again" after the task was deleted in Tasks.
          }
          const taskId = taskIdOf(ref.summaryId, item.k, taskGen);
          const existing = tasks.get(taskId) ?? null;
          if (existing !== null || creates.some((create) => create.id === taskId)) {
            const fd = existing === null ? null : taskFieldsDigest(input.keyring, taskVisibleFieldsOf(existing));
            record(item, decision, { s: 'accepted', taskId, gen: taskGen, fd, via: decision?.via ?? input.channel });
            results.push({ anchorId: request.anchorId, outcome: 'already_added', taskId });
            break;
          }
          const doc = buildTaskFor({ input, item, content, draft: request.draft, description, meetingZone, taskMeetingId });
          creates.push({ id: taskId, doc: doc as unknown as Record<string, unknown> });
          // Later targets of this same call see the task as existing (a second line with the same key).
          tasks.set(taskId, doc as unknown as Record<string, unknown>);
          record(item, decision, {
            s: 'accepted',
            taskId,
            gen: taskGen,
            fd: taskFieldsDigest(input.keyring, taskVisibleFieldsOf(doc)),
            via: input.channel,
          });
          results.push({ anchorId: request.anchorId, outcome: 'added', taskId });
          added += 1;
          break;
        }
        case 'drop': {
          if (status === 'accepted') {
            results.push({ anchorId: request.anchorId, outcome: 'not_open', taskId: null });
            break;
          }
          if (status === 'open') record(item, decision, { s: 'dropped', taskId: null, gen, fd: null, via: null });
          results.push({ anchorId: request.anchorId, outcome: 'dropped', taskId: null });
          break;
        }
        case 'restore': {
          if (status === 'accepted') {
            results.push({ anchorId: request.anchorId, outcome: 'not_open', taskId: null });
            break;
          }
          if (status === 'dropped') record(item, decision, { s: 'open', taskId: null, gen, fd: null, via: null });
          results.push({ anchorId: request.anchorId, outcome: 'restored', taskId: null });
          break;
        }
        case 'remove': {
          if (status !== 'accepted' || decision === null || decision.taskId === null) {
            results.push({ anchorId: request.anchorId, outcome: 'not_open', taskId: null });
            break;
          }
          const task = tasks.get(decision.taskId) ?? null;
          if (task !== null) {
            // Under every key of the ring: a task accepted before a data-key rotation still matches.
            const unchanged = decision.fd !== null && taskFieldsDigestCandidates(input.keyring, taskVisibleFieldsOf(task)).includes(decision.fd);
            if (!unchanged) {
              results.push({ anchorId: request.anchorId, outcome: 'changed', taskId: decision.taskId });
              break;
            }
            const created = creates.findIndex((create) => create.id === decision.taskId);
            if (created === -1) deletes.push(decision.taskId);
            else creates.splice(created, 1);
            tasks.set(decision.taskId, null);
          }
          record(item, decision, { s: 'open', taskId: null, gen: gen + 1, fd: null, via: null });
          results.push({ anchorId: request.anchorId, outcome: 'removed', taskId: decision.taskId });
          removed += 1;
          break;
        }
      }
    }

    // 6. The tasks, then the decisions, in this one transaction.
    for (const create of creates) tx.create(taskRef(db, ref.uid, create.id), create.doc);
    for (const id of deletes) tx.delete(taskRef(db, ref.uid, id));
    const referenced = new Set<string>([...(extraction.views.ai?.items ?? []), ...(extraction.views.as_written?.items ?? [])].map((entry) => entry.k));
    const next = mirrored({ ...extraction, decisions: compactDecisions(decisions, referenced), updatedAt: now.toISOString() });
    const changed = creates.length > 0 || deletes.length > 0 || JSON.stringify(next.decisions) !== JSON.stringify(extraction.decisions);
    if (changed) {
      const fitted = fitExtraction(summary.ref.path, summary.data, next);
      if (fitted === null) throw new CommitmentDecideError('invalid_task');
      tx.update(summary.ref, { extraction: fitted });
      return { kind: 'decided', extraction: fitted, view, results, added, removed };
    }
    return { kind: 'decided', extraction, view, results, added, removed };
  });
}

interface BuildTaskInput {
  input: DecideInput;
  item: StoredCommitmentItem;
  content: SealedViewItem;
  draft: CommitmentDraft | null;
  description: string;
  meetingZone: string | null;
  taskMeetingId: string | null;
}

/** The task document of one accept (the draft's values, or the defaults of section 3.4). */
function buildTaskFor(args: BuildTaskInput): CommitmentTaskDoc {
  const { input, item, content, draft } = args;
  const statedDue = content.dueDate === null ? null : { date: content.dueDate, time: content.dueTime };
  let dueDate: string | null;
  let dueTime: string | null;
  let reminderMinutesBefore: number | null;
  let owner: { name: string; isUser: boolean } | null;
  let statedTime: boolean;
  if (draft !== null) {
    // A blank title is a request error (the app checks it first), never "the suggestion's title".
    if (draft.title.trim().length === 0) throw new CommitmentDecideError('invalid_task');
    dueDate = draft.dueDate;
    dueTime = draft.dueTime;
    reminderMinutesBefore = draft.reminderMinutesBefore;
    owner = draft.owner;
    statedTime = statedDue !== null && statedDue.time !== null && draft.dueDate === statedDue.date && draft.dueTime === statedDue.time;
  } else {
    owner = content.owner === null ? null : { name: content.owner, isUser: item.owner === 'me' };
    statedTime = statedDue !== null && statedDue.time !== null;
    dueDate = null;
    dueTime = null;
    reminderMinutesBefore = null;
  }
  const zone = chooseTaskZone({
    channel: input.channel,
    statedTime,
    meetingZone: args.meetingZone,
    requestZone: input.requestZone,
    preferencesZone: input.preferencesZone,
  });
  if (draft === null) {
    const schedule = defaultSchedule({ due: statedDue, zone: zone.zone, now: input.now });
    dueDate = schedule.dueDate;
    dueTime = schedule.dueTime;
    reminderMinutesBefore = schedule.reminderMinutesBefore;
  }
  const title = acceptedTitleOf({ title: content.title, owner: content.owner, role: item.owner }, draft);
  const built = buildCommitmentTaskDoc({
    uid: input.ref.uid,
    title,
    description: args.description,
    dueDate,
    dueTime,
    // No usable zone at all (WhatsApp without preferences or meeting zone): 'UTC' with no time.
    timezone: zone.zone ?? 'UTC',
    reminderMinutesBefore,
    meetingId: args.taskMeetingId,
    owner,
    now: input.now,
  });
  if (!built.ok) throw new CommitmentDecideError(built.reason);
  return built.doc;
}

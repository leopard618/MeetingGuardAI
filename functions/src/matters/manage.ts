/**
 * A3: pause, resume and change a running matter (docs/v1/ARCHITECTURE.md section 36), on the same
 * injected dependencies as handlers.ts.
 *
 * matterSetStatus pause   active -> paused. Its matterSchedule entry is removed (no follow-up, no
 *                         end check), replies are kept and shown but never read or answered (the
 *                         webhook stores them 'skipped'), and every send is refused (the send
 *                         check needs 'active'). Any signed-in owner, like cancel: stopping never
 *                         needs the tester list.
 * matterSetStatus resume  paused -> active (the switch and the tester list: it may send again).
 *                         The follow-up interval counts from the resume (resumedAt), so it never
 *                         chases the moment it resumes. Past its end date it closes as ended.
 * matterChange text       the owner's words for a change ("move the deadline to Monday"): the whole
 *                         mandate is drafted again by the same code as a new matter, from the
 *                         matter's words plus the change, and read back. It is only a pending
 *                         change (pendingChange): the confirmed mandate stays in force. The
 *                         contacts must stay the same: a new person never got the first email, so
 *                         writing to them is a new matter.
 * matterChange draftHash  applies the pending change with the hash the owner saw: the mandate,
 *                         the read-back and the confirmed hash are replaced (the first email stays
 *                         as it was sent), the old offered times are dropped, the schedule is
 *                         recomputed. A3 feedback: when the change touches what the contact was told (the
 *                         goal, what is asked, the end date or the meeting) and the first email went
 *                         out, the answer says letThemKnow: the app offers to write to them
 *                         (matterMessage), and nothing is sent unless the owner sends that draft.
 */
import * as logger from 'firebase-functions/logger';

import { matterChangeRequestSchema, matterSetStatusRequestSchema, usageDayKey, type MatterDraftResponse, type MatterSetStatusResponse } from '../shared/aiContract';
import { changeView, event, matterError, readable, requireCaller, requireSignedIn, runDraft, type MatterCaller, type MatterDeps, type Tokens } from './handlers';
import { prefsOf, requireConsent } from './settings';
import { MATTER_LIMITS, changeHash, draftHash, mailboxOf, withModelCall, type MatterDoc, type PendingChange } from './model';
import { nextActionAt } from './schedule';
import { QUESTIONS, readBack } from './text';

// ---------------------------------------------------------------------------------------------
// matterSetStatus
// ---------------------------------------------------------------------------------------------

type StatusOutcome = { kind: 'not_found' } | { kind: 'invalid'; message: string } | { kind: 'done'; status: MatterDoc['status'] };

export function handleMatterSetStatus(callerIn: MatterCaller | null, data: unknown, deps: MatterDeps): Promise<MatterSetStatusResponse> {
  return readable(async () => {
    const parsed = matterSetStatusRequestSchema.safeParse(data);
    // pausing only needs a signed-in owner (like cancel); resuming may send again
    const caller = parsed.success && parsed.data.action === 'resume' ? requireCaller(callerIn, deps) : requireSignedIn(callerIn);
    if (!parsed.success) throw matterError('invalid_request');
    const { matterId, action } = parsed.data;
    const now = deps.now();
    const nowIso = now.toISOString();
    const outcome = await deps.store.updateMatter<StatusOutcome>(caller.uid, matterId, (doc) => {
      if (!doc) return { result: { kind: 'not_found' } };
      if (action === 'pause') {
        if (doc.status === 'paused') return { result: { kind: 'done', status: 'paused' } };
        if (doc.status !== 'active') return { result: { kind: 'invalid', message: 'Only an active matter can be paused.' } };
        return {
          result: { kind: 'done', status: 'paused' },
          patch: { status: 'paused', updatedAt: nowIso },
          events: [event('paused', nowIso)],
          schedule: { nextActionAt: null },
        };
      }
      if (doc.status === 'active') return { result: { kind: 'done', status: 'active' } };
      if (doc.status !== 'paused' || !doc.mandate) return { result: { kind: 'invalid', message: 'Only a paused matter can be resumed.' } };
      if (Date.parse(doc.mandate.endsAt) <= now.getTime()) {
        return {
          result: { kind: 'done', status: 'done' },
          patch: { status: 'done', stopReason: 'ended', endedAt: nowIso, followUpClaim: null, updatedAt: nowIso },
          events: [event('status_changed', nowIso, 'ended')],
          schedule: { nextActionAt: null },
        };
      }
      const next: MatterDoc = { ...doc, status: 'active', resumedAt: nowIso };
      return {
        result: { kind: 'done', status: 'active' },
        patch: { status: 'active', resumedAt: nowIso, updatedAt: nowIso },
        events: [event('resumed', nowIso)],
        schedule: { nextActionAt: nextActionAt(next) },
      };
    });
    if (outcome.kind === 'not_found') throw matterError('not_found');
    if (outcome.kind === 'invalid') throw matterError('invalid_request', outcome.message);
    logger.info('matters.status_set', { uid: caller.uid, matterId, action, status: outcome.status });
    return { matterId, status: outcome.status };
  });
}

// ---------------------------------------------------------------------------------------------
// matterChange
// ---------------------------------------------------------------------------------------------

/** A3 feedback: whether a change touches what the contact was told (follow-ups and the owner's copy do not). */
export function changeConcernsContact(before: MatterDoc['mandate'], after: MatterDoc['mandate']): boolean {
  if (!before || !after) return false;
  const told = (m: NonNullable<MatterDoc['mandate']>) => JSON.stringify([m.goal, [...m.mayAsk].sort(), Date.parse(m.endsAt), m.meeting, m.language]);
  return told(before) !== told(after);
}

const sameContacts = (a: MatterDoc['mandate'], b: MatterDoc['mandate']): boolean => {
  const set = (m: MatterDoc['mandate']) =>
    (m?.contacts ?? [])
      .map((c) => c.email.toLowerCase())
      .sort()
      .join(',');
  return set(a) === set(b);
};

export function handleMatterChange(callerIn: MatterCaller | null, data: unknown, deps: MatterDeps): Promise<MatterDraftResponse> {
  return readable(async () => {
    const caller = requireCaller(callerIn, deps);
    await requireConsent(caller.uid, deps);
    const parsed = matterChangeRequestSchema.safeParse(data);
    if (!parsed.success) throw matterError('invalid_request');
    const { matterId } = parsed.data;
    if (parsed.data.draftHash) return confirmChange(caller, matterId, parsed.data.draftHash, deps);
    return draftChange(caller, matterId, parsed.data.text!, deps);
  });
}

async function draftChange(caller: MatterCaller, matterId: string, text: string, deps: MatterDeps): Promise<MatterDraftResponse> {
  const current = await deps.store.getMatter(caller.uid, matterId);
  if (!current) throw matterError('not_found');
  if ((current.status !== 'active' && current.status !== 'paused') || !current.mandate) throw matterError('invalid_request', 'Only a running matter can be changed.');
  // an answer to the change's questions adds to the pending change; else a fresh change
  const base = current.pendingChange?.request ?? current.request;
  const request = `${base}\n${text}`;
  if (request.length > MATTER_LIMITS.requestChars) throw matterError('invalid_request', 'This matter has too many changes. Start a new one.');
  const now = deps.now();
  if (!(await deps.store.consumeDaily(caller.uid, usageDayKey(now), deps.dailyLimit, now.toISOString()))) throw matterError('rate_limited');
  let tokens: Tokens = null;
  const result = await runDraft(
    deps,
    caller.uid,
    // a watched thread keeps the email it answers (its sender stays a known contact)
    { request, language: current.language, timeZone: current.timeZone, ownerName: current.ownerName, ownerEmail: current.ownerEmail, now, domain: deps.domain, thread: current.watch, defaults: await prefsOf(caller.uid, deps) },
    (t) => {
      tokens = t;
    },
  );
  let mandate = result.mandate;
  let questions = result.questions;
  if (mandate && !sameContacts(mandate, current.mandate)) {
    mandate = null;
    questions = [QUESTIONS.sameContacts(current.language)];
  }
  const nowIso = now.toISOString();
  const change: PendingChange = {
    request,
    mandate,
    questions,
    readBack: mandate ? readBack(mandate, current.ownerEmail, current.language, current.scheduling, mailboxOf(current)) : '',
    hash: mandate && questions.length === 0 ? changeHash(mandate, current.scheduling) : null,
    createdAt: nowIso,
  };
  const updated = await deps.store.updateMatter<MatterDoc | 'gone'>(caller.uid, matterId, (doc) => {
    if (!doc || (doc.status !== 'active' && doc.status !== 'paused')) return { result: 'gone' };
    const next: MatterDoc = { ...doc, pendingChange: change, usage: withModelCall(doc.usage, tokens), updatedAt: nowIso };
    return { result: next, patch: { pendingChange: change, usage: next.usage, updatedAt: nowIso }, events: change.hash ? [event('change_drafted', nowIso)] : [] };
  });
  if (updated === 'gone') throw matterError('invalid_request', 'Only a running matter can be changed.');
  logger.info('matters.change_drafted', { uid: caller.uid, matterId, complete: change.hash !== null, questions: change.questions.length });
  return changeView(matterId, updated);
}

async function confirmChange(caller: MatterCaller, matterId: string, hash: string, deps: MatterDeps): Promise<MatterDraftResponse> {
  const now = deps.now();
  const nowIso = now.toISOString();
  let letThemKnow = false;
  const outcome = await deps.store.updateMatter<MatterDoc | 'not_found' | 'stale' | 'ended'>(caller.uid, matterId, (doc) => {
    if (!doc) return { result: 'not_found' };
    const change = doc.pendingChange;
    if ((doc.status !== 'active' && doc.status !== 'paused') || !change?.mandate || !doc.firstEmail || change.hash !== hash) return { result: 'stale' };
    if (changeHash(change.mandate, doc.scheduling) !== hash) return { result: 'stale' };
    if (Date.parse(change.mandate.endsAt) <= now.getTime()) return { result: 'ended' };
    letThemKnow = doc.firstSentAt !== null && changeConcernsContact(doc.mandate, change.mandate);
    const next: MatterDoc = {
      ...doc,
      mandate: change.mandate,
      readBack: change.readBack,
      confirmedHash: draftHash(change.mandate, doc.firstEmail, doc.scheduling, mailboxOf(doc)),
      mandateVersion: doc.mandateVersion + 1,
      pendingChange: null,
      offeredSlots: [],
      updatedAt: nowIso,
    };
    return {
      result: next,
      patch: {
        mandate: next.mandate,
        readBack: next.readBack,
        confirmedHash: next.confirmedHash,
        mandateVersion: next.mandateVersion,
        pendingChange: null,
        offeredSlots: [],
        updatedAt: nowIso,
      },
      events: [event('mandate_changed', nowIso)],
      ...(doc.status === 'active' ? { schedule: { nextActionAt: nextActionAt(next) } } : {}),
    };
  });
  if (outcome === 'not_found') throw matterError('not_found');
  if (outcome === 'stale') throw matterError('stale_draft');
  if (outcome === 'ended') throw matterError('not_allowed', 'The new end date has already passed.');
  logger.info('matters.change_confirmed', { uid: caller.uid, matterId, letThemKnow });
  return { ...changeView(matterId, outcome), letThemKnow };
}

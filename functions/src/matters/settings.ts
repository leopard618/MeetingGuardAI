/**
 * A5: the owner's assistant settings and consent (matterSettings), and the daily summary email of
 * the matters set to "a daily summary instead of copies".
 *
 * matterPrefs/{uid} (server only, with the uid for deleteAccount): the settings (aiContract
 * matterPrefsSchema), the device time zone they were saved in, the consent (version and time) and
 * when the next daily summary is due.
 * - get: the settings (defaults when none), the consent, the version the app must show, the
 *   assistant's own address. Any signed-in owner.
 * - save: the assistant must be on for the owner. Working hours and quiet days apply at once (they
 *   only narrow the times offered and when follow-ups go out); the signature is written to the open
 *   matters too (it only signs the emails); everything else is a default of NEW drafts, unless the
 *   owner asks to apply it to the running matters too (applyToOpen): then the follow-ups and the
 *   copy rule of each running matter change, as a mandate change with its read-back rewritten and
 *   'mandate_changed' on the timeline (a matter with a change waiting for confirmation is left).
 * - consent: records the version the owner agreed to. Until it is the current one, every call that
 *   sends the owner's words or emails to the model answers consent_required (requireConsent).
 * Daily summary: when a matter with copyOwner 'daily_summary' is confirmed, summaryNextAt is set to
 * the next summaryTime in the owner's zone; matterTick sends one email per due owner to their
 * verified address (what moved on those matters in the last day, written by code) and sets the
 * next one, or clears it when no such matter runs any more.
 */
import * as logger from 'firebase-functions/logger';
import type { Firestore } from 'firebase-admin/firestore';
import { z } from 'zod';

import {
  DEFAULT_MATTER_PREFS,
  MATTER_CONSENT_VERSION,
  isoDateTimeSchema,
  matterPrefsSchema,
  matterSettingsRequestSchema,
  timeZoneSchema,
  type Language,
  type MatterPrefs,
  type MatterSettingsResponse,
} from '../shared/aiContract';
import { addDaysToLocalDate, toLocalDateTime, zonedDateTimeToUtcIso } from '../shared/time';
import { event, matterError, readable, requireCaller, requireSignedIn, type MatterCaller, type MatterDeps } from './handlers';
import { MATTER_PREFS_COLLECTION, MATTER_LIMITS, draftHash, mailboxOf, type MatterDoc } from './model';
import { SUMMARY_TEXT, readBack } from './text';
import { nextActionAt, type WorkingHours } from './schedule';

// ---------------------------------------------------------------------------------------------
// The record and its store
// ---------------------------------------------------------------------------------------------

export const prefsRecordSchema = z
  .object({
    uid: z.string().min(1).max(128),
    prefs: matterPrefsSchema,
    timeZone: timeZoneSchema,
    consent: z.object({ version: z.number().int().min(1), at: isoDateTimeSchema }).strict().nullable(),
    /** When the next daily summary is due (matterTick); null: no matter needs one. */
    summaryNextAt: isoDateTimeSchema.nullable(),
    updatedAt: isoDateTimeSchema,
  })
  .strict();
export type PrefsRecord = z.infer<typeof prefsRecordSchema>;

export interface PrefsStore {
  get(uid: string): Promise<PrefsRecord | null>;
  put(uid: string, record: PrefsRecord): Promise<void>;
  /** Sets summaryNextAt when none is set or the given one is earlier (a transaction). */
  scheduleSummary(uid: string, atIso: string, nowIso: string): Promise<void>;
  setSummaryNext(uid: string, atIso: string | null, nowIso: string): Promise<void>;
  /** Owners whose daily summary is due (summaryNextAt <= now), oldest first. */
  dueSummaries(nowIso: string, limit: number): Promise<PrefsRecord[]>;
}

export function firestorePrefsStore(db: Firestore): PrefsStore {
  const docs = db.collection(MATTER_PREFS_COLLECTION);
  const parse = (data: unknown): PrefsRecord | null => {
    const parsed = prefsRecordSchema.safeParse(data);
    return parsed.success ? parsed.data : null;
  };
  return {
    async get(uid) {
      const snapshot = await docs.doc(uid).get();
      return snapshot.exists ? parse(snapshot.data()) : null;
    },
    async put(uid, record) {
      await docs.doc(uid).set(prefsRecordSchema.parse(record));
    },
    async scheduleSummary(uid, atIso, nowIso) {
      await db.runTransaction(async (tx) => {
        const ref = docs.doc(uid);
        const current = parse((await tx.get(ref)).data());
        const base = current ?? defaultRecord(uid, 'UTC', nowIso);
        if (base.summaryNextAt !== null && base.summaryNextAt <= atIso) return;
        tx.set(ref, prefsRecordSchema.parse({ ...base, summaryNextAt: atIso, updatedAt: nowIso }));
      });
    },
    async setSummaryNext(uid, atIso, nowIso) {
      await docs.doc(uid).set({ summaryNextAt: atIso, updatedAt: nowIso }, { merge: true });
    },
    async dueSummaries(nowIso, limit) {
      const snapshot = await docs.where('summaryNextAt', '<=', nowIso).limit(limit).get();
      return snapshot.docs.flatMap((doc) => {
        const record = parse(doc.data());
        return record ? [record] : [];
      });
    },
  };
}

export function defaultRecord(uid: string, timeZone: string, nowIso: string): PrefsRecord {
  return { uid, prefs: DEFAULT_MATTER_PREFS, timeZone, consent: null, summaryNextAt: null, updatedAt: nowIso };
}

// ---------------------------------------------------------------------------------------------
// Reading the settings where they apply
// ---------------------------------------------------------------------------------------------

/** The owner's settings (the defaults when none are saved, or the store is not set up or fails). */
export async function prefsOf(uid: string, deps: Pick<MatterDeps, 'prefs'>): Promise<MatterPrefs> {
  if (!deps.prefs) return DEFAULT_MATTER_PREFS;
  try {
    return (await deps.prefs.get(uid))?.prefs ?? DEFAULT_MATTER_PREFS;
  } catch (error) {
    logger.warn('matters.prefs_read_failed', { uid, errorName: error instanceof Error ? error.name : 'unknown' });
    return DEFAULT_MATTER_PREFS;
  }
}

/** Working hours and days for offering times (availability.ts). */
export function workingHoursOf(prefs: MatterPrefs): WorkingHours {
  return { start: prefs.workStart, end: prefs.workEnd, days: prefs.workDays };
}

/**
 * Every call that sends the owner's words or emails to the model needs the current consent. A
 * deployment without the store (tests, an old setup) has nothing to check against.
 */
export async function requireConsent(uid: string, deps: Pick<MatterDeps, 'prefs'>): Promise<void> {
  if (!deps.prefs) return;
  const record = await deps.prefs.get(uid);
  if (!record?.consent || record.consent.version < MATTER_CONSENT_VERSION) {
    throw matterError('consent_required', 'Agree to how the assistant uses your data first.');
  }
}

// ---------------------------------------------------------------------------------------------
// matterSettings
// ---------------------------------------------------------------------------------------------

function assistantAddress(deps: Pick<MatterDeps, 'fromLocalPart' | 'domain'>): string {
  return `${deps.fromLocalPart}@${deps.domain}`.toLowerCase();
}

function response(record: PrefsRecord | null, deps: MatterDeps, extra: { openMatters?: number; applied?: number } = {}): MatterSettingsResponse {
  return {
    prefs: record?.prefs ?? DEFAULT_MATTER_PREFS,
    consent: record?.consent ?? null,
    consentVersion: MATTER_CONSENT_VERSION,
    address: assistantAddress(deps),
    ...extra,
  };
}

/** How many matters are running (active or paused); undefined when it cannot be read. */
async function countOpen(uid: string, deps: MatterDeps): Promise<number | undefined> {
  try {
    return (await deps.store.listMatters(uid, ['active', 'paused'])).length;
  } catch {
    return undefined;
  }
}

export function handleMatterSettings(callerIn: MatterCaller | null, data: unknown, deps: MatterDeps): Promise<MatterSettingsResponse> {
  return readable(() => settingsAction(callerIn, data, deps));
}

async function settingsAction(callerIn: MatterCaller | null, data: unknown, deps: MatterDeps): Promise<MatterSettingsResponse> {
  const parsed = matterSettingsRequestSchema.safeParse(data);
  if (!parsed.success) {
    requireSignedIn(callerIn);
    throw matterError('invalid_request');
  }
  const request = parsed.data;
  const store = deps.prefs;
  if (request.action === 'get') {
    const caller = requireSignedIn(callerIn);
    const [record, openMatters] = await Promise.all([store ? store.get(caller.uid) : Promise.resolve(null), countOpen(caller.uid, deps)]);
    return response(record, deps, openMatters === undefined ? {} : { openMatters });
  }
  if (!store) throw matterError('not_configured');
  const nowIso = deps.now().toISOString();
  if (request.action === 'consent') {
    const caller = requireSignedIn(callerIn);
    if (request.version !== MATTER_CONSENT_VERSION) throw matterError('invalid_request', 'This consent text is out of date. Update the app.');
    const current = (await store.get(caller.uid)) ?? defaultRecord(caller.uid, request.timeZone, nowIso);
    const next: PrefsRecord = { ...current, consent: { version: request.version, at: nowIso }, updatedAt: nowIso };
    await store.put(caller.uid, next);
    logger.info('matters.consent_given', { uid: caller.uid, version: request.version });
    return response(next, deps);
  }
  const caller = requireCaller(callerIn, deps);
  const current = (await store.get(caller.uid)) ?? defaultRecord(caller.uid, request.timeZone, nowIso);
  const next: PrefsRecord = { ...current, prefs: request.prefs, timeZone: request.timeZone, updatedAt: nowIso };
  // a new summary time moves a scheduled summary to it
  if (next.summaryNextAt !== null) next.summaryNextAt = nextSummaryAt(next.prefs.summaryTime, next.timeZone, deps.now());
  await store.put(caller.uid, next);
  if (request.prefs.signature !== current.prefs.signature) await signOpenMatters(caller.uid, request.prefs.signature, deps, nowIso);
  const applied = request.applyToOpen === true ? await applyToOpenMatters(caller.uid, request.prefs, deps) : undefined;
  logger.info('matters.prefs_saved', { uid: caller.uid, applied: applied ?? null });
  const openMatters = await countOpen(caller.uid, deps);
  return response(next, deps, { ...(openMatters === undefined ? {} : { openMatters }), ...(applied === undefined ? {} : { applied }) });
}

/**
 * "Apply to my open matters too": the follow-ups and the copy rule of every running matter, as a
 * mandate change (the read-back and the confirmed hash rewritten, 'mandate_changed' on the
 * timeline, the next follow-up rescheduled). The owner asked for it on the settings page, so it is
 * their confirmation. A copy needs the owner's verified address; without one it stays a summary.
 * A matter with a change waiting for confirmation is left alone (confirming that change would
 * undo this one). Returns how many matters changed.
 */
export async function applyToOpenMatters(uid: string, prefs: MatterPrefs, deps: MatterDeps): Promise<number> {
  const open = await deps.store.listMatters(uid, ['active', 'paused']);
  let applied = 0;
  let summary = false;
  for (const { id } of open) {
    const nowIso = deps.now().toISOString();
    const changed = await deps.store
      .updateMatter<{ copyOwner: MatterPrefs['copyOwner'] } | null>(uid, id, (doc) => {
        if (!doc?.mandate || !doc.firstEmail || (doc.status !== 'active' && doc.status !== 'paused') || doc.pendingChange?.mandate) return { result: null };
        const copyOwner = prefs.copyOwner === 'cc' && !doc.ownerEmail ? 'daily_summary' : prefs.copyOwner;
        const same = doc.mandate.followUp.everyDays === prefs.followUpEveryDays && doc.mandate.followUp.maxCount === prefs.followUpMaxCount && doc.mandate.copyOwner === copyOwner;
        if (same) return { result: null };
        const mandate = { ...doc.mandate, followUp: { everyDays: prefs.followUpEveryDays, maxCount: prefs.followUpMaxCount }, copyOwner };
        const mailbox = mailboxOf(doc);
        const next: MatterDoc = {
          ...doc,
          mandate,
          readBack: readBack(mandate, doc.ownerEmail, doc.language, doc.scheduling, mailbox),
          confirmedHash: draftHash(mandate, doc.firstEmail, doc.scheduling, mailbox),
          mandateVersion: doc.mandateVersion + 1,
          updatedAt: nowIso,
        };
        return {
          result: { copyOwner },
          patch: { mandate, readBack: next.readBack, confirmedHash: next.confirmedHash, mandateVersion: next.mandateVersion, updatedAt: nowIso },
          events: [event('mandate_changed', nowIso, 'settings')],
          ...(doc.status === 'active' ? { schedule: { nextActionAt: nextActionAt(next) } } : {}),
        };
      })
      .catch((error: unknown) => {
        logger.warn('matters.apply_settings_failed', { uid, matterId: id, errorName: error instanceof Error ? error.name : 'unknown' });
        return null;
      });
    if (changed) {
      applied += 1;
      if (changed.copyOwner === 'daily_summary') summary = true;
    }
  }
  if (summary) await scheduleDailySummary(uid, deps);
  return applied;
}

/** The signature is written to the open matters too: it only signs their emails. */
async function signOpenMatters(uid: string, signature: string, deps: MatterDeps, nowIso: string): Promise<void> {
  const open = await deps.store.listMatters(uid, ['draft', 'active', 'paused']);
  for (const { id } of open) {
    await deps.store
      .updateMatter(uid, id, (doc) => (doc && doc.status !== 'done' && doc.status !== 'cancelled' ? { result: null, patch: { signature, updatedAt: nowIso } } : { result: null }))
      .catch((error: unknown) => {
        logger.warn('matters.sign_failed', { uid, matterId: id, errorName: error instanceof Error ? error.name : 'unknown' });
      });
  }
}

// ---------------------------------------------------------------------------------------------
// The daily summary email
// ---------------------------------------------------------------------------------------------

/** The next instant of `time` ("HH:MM") in `zone`, strictly after now. */
export function nextSummaryAt(time: string, zone: string, now: Date): string {
  const today = toLocalDateTime(now, zone).date;
  for (let add = 0; add < 3; add += 1) {
    const at = zonedDateTimeToUtcIso(addDaysToLocalDate(today, add), time, zone);
    if (Date.parse(at) > now.getTime()) return at;
  }
  return new Date(now.getTime() + 86_400_000).toISOString();
}

/** A matter with copyOwner 'daily_summary' was confirmed: make sure a daily summary is scheduled. */
export async function scheduleDailySummary(uid: string, deps: Pick<MatterDeps, 'prefs' | 'now'>): Promise<void> {
  if (!deps.prefs) return;
  try {
    const record = await deps.prefs.get(uid);
    const now = deps.now();
    const prefs = record?.prefs ?? DEFAULT_MATTER_PREFS;
    await deps.prefs.scheduleSummary(uid, nextSummaryAt(prefs.summaryTime, record?.timeZone ?? 'UTC', now), now.toISOString());
  } catch (error) {
    logger.warn('matters.summary_schedule_failed', { uid, errorName: error instanceof Error ? error.name : 'unknown' });
  }
}

/** The lines of one matter in the summary: what moved since `sinceIso` (code, from the timeline). */
export function summaryLines(title: string, events: readonly { type: string; at: string; detail: string }[], sinceIso: string, language: Language): string[] {
  // oldest first, as it happened (the timeline is read newest first)
  const recent = events.filter((e) => e.at > sinceIso).reverse();
  const lines = recent.map((e) => SUMMARY_TEXT.event(e.type, e.detail, language)).filter((line): line is string => line !== null);
  return lines.length ? [title, ...lines.map((line) => `- ${line}`)] : [];
}

/** A daily summary that fails is tried again on the next ticks for this long, then skipped to the next day. */
export const SUMMARY_RETRY_MS = 60 * 60_000;

/**
 * matterTick: one email per owner whose summary is due: what moved in the last day on their
 * running matters set to a daily summary, to their verified address only. Nothing moved: no email.
 */
export async function runDailySummaries(deps: MatterDeps, limit: number): Promise<number> {
  if (!deps.prefs) return 0;
  const now = deps.now();
  const nowIso = now.toISOString();
  let sent = 0;
  for (const record of await deps.prefs.dueSummaries(nowIso, limit)) {
    const uid = record.uid;
    try {
      const running = (await deps.store.listMatters(uid, ['active', 'paused'])).filter(({ doc }) => doc.mandate?.copyOwner === 'daily_summary');
      if (running.length === 0) {
        await deps.prefs.setSummaryNext(uid, null, nowIso);
        continue;
      }
      const since = new Date(now.getTime() - 86_400_000).toISOString();
      const owner = running.find(({ doc }) => doc.ownerEmail)?.doc;
      const language: Language = owner?.language === 'es' ? 'es' : 'en';
      const blocks: string[][] = [];
      for (const { id, doc } of running) {
        const events = await deps.store.listEvents(uid, id, 30);
        const lines = summaryLines(doc.title, events, since, language);
        if (lines.length) blocks.push(lines);
      }
      if (owner?.ownerEmail && blocks.length) {
        await sendSummary(uid, owner, blocks, language, deps);
        sent += 1;
      }
      await deps.prefs.setSummaryNext(uid, nextSummaryAt(record.prefs.summaryTime, record.timeZone, now), nowIso);
    } catch (error) {
      // tried again on the next ticks for SUMMARY_RETRY_MS, then that day's summary is skipped
      // (never an attempt every 15 minutes for ever)
      const due = record.summaryNextAt ? Date.parse(record.summaryNextAt) : now.getTime();
      const giveUp = now.getTime() - due >= SUMMARY_RETRY_MS;
      logger.error('matters.summary_failed', { uid, giveUp, errorName: error instanceof Error ? error.name : 'unknown' });
      if (giveUp) await deps.prefs.setSummaryNext(uid, nextSummaryAt(record.prefs.summaryTime, record.timeZone, now), nowIso).catch(() => undefined);
    }
  }
  return sent;
}

async function sendSummary(uid: string, owner: MatterDoc, blocks: string[][], language: Language, deps: MatterDeps): Promise<void> {
  const to = owner.ownerEmail!;
  const text = `${SUMMARY_TEXT.intro(language)}\n\n${blocks.map((b) => b.join('\n')).join('\n\n')}\n\n${SUMMARY_TEXT.outro(language)}`.slice(0, MATTER_LIMITS.bodyChars);
  const sender = deps.sender();
  await sender.send({
    from: `"${SUMMARY_TEXT.fromName(language)}" <${assistantAddress(deps)}>`,
    to: [to],
    cc: [],
    replyTo: assistantAddress(deps),
    subject: SUMMARY_TEXT.subject(language),
    text,
    messageId: `<summary.${Date.now().toString(36)}@${deps.domain}>`,
    inReplyTo: null,
    references: [],
    metadata: { uid, kind: 'summary' },
  });
  logger.info('matters.summary_sent', { uid, matters: blocks.length });
}

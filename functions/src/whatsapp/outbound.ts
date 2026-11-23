/**
 * M13: the messages the bot starts by itself (docs/v2/WhatsApp-Templates-2026-11-12.md). The
 * scheduler (whatsappTick, every 5 minutes) plans the agenda, debrief and commitments messages of
 * the opted-in users, then sends every due entry of the send log after the gate below. Reminders
 * are planned by the task trigger (./reminders.ts) and the welcome by the opt-in callable
 * (./optin.ts); both land in the same send log and go out here.
 *
 * The gate before every send (section 7): templates mode on; the user linked on this phone and
 * opted in for it; the message's switch on; in live mode the template APPROVED as UTILITY with the
 * validity of the registry; the quiet hours from 21:00 to 7:00 in the user zone (debrief prompts
 * skipped, commitments and confirmations held to 7:00); debrief prompts only with an AI action
 * left; and the content still true (the task still open at the same time, the meeting still
 * there). Errors are logged and dropped, never retried.
 *
 * Logs carry ids, kinds and codes only, never titles, text or phone numbers.
 */
import * as logger from 'firebase-functions/logger';

import { WHATSAPP_OUTBOUND_TUNING } from '../config';
import type { AppLanguage, WhatsappMessageSwitch } from '../shared/aiContract';
import { addDaysToLocalDate, dayRangeUtc, getZonedParts, isValidTimeZone, todayInZone, zonedDateTimeToUtcIso } from '../shared/time';
import { WhatsappApiError, type OutboundSender } from './send';
import { phoneLogId } from './signature';
import {
  FALLBACK_MEETING,
  TEMPLATES,
  atTime,
  cleanValue,
  dueMoment,
  previewButtons,
  previewText,
  renderTemplate,
  shortDate,
  templateLanguageOf,
  weekdayDate,
  type OutboundKind,
  type TemplateLanguage,
} from './templates';
import { newSend, type MessagesRecord, type OptedInUser, type OutboundStore, type SendRecord } from './outboundStore';

export type TemplatesMode = 'off' | 'preview' | 'live';

export function templatesModeOf(raw: string | null | undefined): TemplatesMode {
  const value = (raw ?? '').trim().toLowerCase();
  return value === 'preview' || value === 'live' ? value : 'off';
}

// ---------------------------------------------------------------------------------------------
// Ports
// ---------------------------------------------------------------------------------------------

export interface DayItem {
  meetingId: string;
  /** Series occurrence (original local date), null for a one-off. */
  occurrenceDate: string | null;
  title: string;
  startAt: string;
  endAt: string;
  allDay: boolean;
}

export interface TaskView {
  id: string;
  title: string;
  status: string;
  dueDate: string | null;
  dueTime: string | null;
  timezone: string;
  reminderMinutesBefore: number | null;
  people: { name: string }[];
}

export interface SummaryView {
  summaryId: string;
  status: string;
  receivedAt: string;
  meetingTitle: string | null;
  /** The local meeting date (occurrence date, else the start in the meeting zone, else the summary date). */
  meetingDate: string | null;
  items: number;
  /** The user already acted on it in the app (attached, kept, reviewed). */
  handled: boolean;
}

export interface UserPrefs {
  uiLanguage: AppLanguage;
  /** preferences.timezone when set to something other than the 'UTC' default; else null. */
  timezone: string | null;
  briefingTime: string;
}

export interface OutboundReader {
  prefs(uid: string): Promise<UserPrefs>;
  /** Meetings and occurrences that START in [fromIso, toIso), cancelled and deleted ones left out. */
  dayItems(uid: string, fromIso: string, toIso: string): Promise<DayItem[]>;
  openTasks(uid: string): Promise<TaskView[]>;
  task(uid: string, taskId: string): Promise<TaskView | null>;
  /** The meeting block of the chat (formatMeetingForShare), or null when it is gone. */
  meetingBlock(uid: string, meetingId: string, language: AppLanguage): Promise<string | null>;
  summary(uid: string, summaryId: string): Promise<SummaryView | null>;
  /** Summaries received after `afterIso`, oldest first. */
  summariesAfter(uid: string, afterIso: string, limit: number): Promise<SummaryView[]>;
  linkUid(phoneE164: string): Promise<string | null>;
  hasAllowance(uid: string, now: Date): Promise<boolean>;
  isCommitmentsPilot(uid: string): boolean;
}

export interface OutboundDeps {
  store: OutboundStore;
  reader: OutboundReader;
  sender: OutboundSender;
  mode: TemplatesMode;
  now: () => Date;
}

// ---------------------------------------------------------------------------------------------
// Zones and quiet hours
// ---------------------------------------------------------------------------------------------

/** The zone messages are timed and shown in: the device zone, else a real preferences zone. */
export function userZone(record: MessagesRecord, prefs: UserPrefs): string | null {
  if (record.deviceTimeZone !== null && isValidTimeZone(record.deviceTimeZone)) return record.deviceTimeZone;
  if (prefs.timezone !== null && isValidTimeZone(prefs.timezone)) return prefs.timezone;
  return null;
}

export function isQuietHour(instant: Date, zone: string): boolean {
  const { hour } = getZonedParts(instant, zone);
  const { quietStartHour, quietEndHour } = WHATSAPP_OUTBOUND_TUNING;
  return hour >= quietStartHour || hour < quietEndHour;
}

/** The next 7:00 local after a quiet instant (today's when before 7:00, else tomorrow's). */
export function quietEndAfter(instant: Date, zone: string): string {
  const today = todayInZone(zone, instant);
  const { hour } = getZonedParts(instant, zone);
  const date = hour < WHATSAPP_OUTBOUND_TUNING.quietEndHour ? today : addDaysToLocalDate(today, 1);
  return zonedDateTimeToUtcIso(date, `${String(WHATSAPP_OUTBOUND_TUNING.quietEndHour).padStart(2, '0')}:00`, zone);
}

// ---------------------------------------------------------------------------------------------
// Reminder fire time (as the phone: src/services/alerts/taskReminders.ts)
// ---------------------------------------------------------------------------------------------

export function reminderFireAt(task: TaskView): string | null {
  if (task.status !== 'open' || task.dueDate === null || task.dueTime === null || task.reminderMinutesBefore === null) return null;
  if (!isValidTimeZone(task.timezone)) return null;
  let dueMs: number;
  try {
    dueMs = Date.parse(zonedDateTimeToUtcIso(task.dueDate, task.dueTime, task.timezone));
  } catch {
    return null;
  }
  const fireMs = dueMs - task.reminderMinutesBefore * 60_000;
  return Number.isFinite(fireMs) ? new Date(fireMs).toISOString() : null;
}

export function dueInstant(task: TaskView): Date | null {
  if (task.dueDate === null || task.dueTime === null || !isValidTimeZone(task.timezone)) return null;
  try {
    return new Date(zonedDateTimeToUtcIso(task.dueDate, task.dueTime, task.timezone));
  } catch {
    return null;
  }
}

/** Tasks accepted from a summary (functions/src/commitments/ids.ts); the reminder filter (question 2). */
export function isSummaryTask(taskId: string): boolean {
  return taskId.startsWith('sm_');
}

/** 3.6 for someone else's commitment (exactly one person), 3.5 otherwise. */
export function reminderKindOf(task: TaskView): 'task' | 'followup' {
  return task.people.length === 1 && task.people[0]!.name.trim().length > 0 ? 'followup' : 'task';
}

export function reminderDedupeKey(uid: string, taskId: string, fireAt: string): string {
  return `rem:${uid}:${taskId}:${fireAt}`;
}

// ---------------------------------------------------------------------------------------------
// Template values (section 3)
// ---------------------------------------------------------------------------------------------

export function agendaMeetingsPhrase(language: TemplateLanguage, items: readonly DayItem[], zone: string): string {
  if (items.length === 0) return language === 'es' ? 'sin reuniones' : 'no meetings';
  const timed = items.filter((item) => !item.allDay);
  const n = items.length;
  if (timed.length === 0) {
    const title = cleanValue(items[0]!.title, 60, FALLBACK_MEETING[language]);
    if (language === 'es') return `${n} ${n === 1 ? 'reunión' : 'reuniones'} de todo el día (${title})`;
    return `${n} all-day ${n === 1 ? 'meeting' : 'meetings'} (${title})`;
  }
  const first = timed[0]!;
  const title = cleanValue(first.title, 60, FALLBACK_MEETING[language]);
  const time = atTime(language, new Date(first.startAt), zone);
  if (language === 'es') return n === 1 ? `1 reunión ${time} (${title})` : `${n} reuniones, la primera ${time} (${title})`;
  return n === 1 ? `1 meeting ${time} (${title})` : `${n} meetings, the first ${time} (${title})`;
}

export function agendaTasksPhrase(language: TemplateLanguage, dueToday: number, overdue: number): string {
  if (language === 'es') {
    const today = dueToday === 0 ? 'ninguna para hoy' : `${dueToday} para hoy`;
    return overdue === 0 ? today : `${today} y ${overdue} ${overdue === 1 ? 'vencida' : 'vencidas'}`;
  }
  const today = dueToday === 0 ? 'none due today' : `${dueToday} due today`;
  return overdue === 0 ? today : `${today} and ${overdue} overdue`;
}

export function taskCounts(tasks: readonly TaskView[], today: string): { dueToday: number; overdue: number } {
  let dueToday = 0;
  let overdue = 0;
  for (const task of tasks) {
    if (task.status !== 'open' || task.dueDate === null) continue;
    if (task.dueDate === today) dueToday += 1;
    else if (task.dueDate < today) overdue += 1;
  }
  return { dueToday, overdue };
}

/** The switches now on, in one line, for the welcome (3.7). */
export function welcomePhrase(language: TemplateLanguage, record: MessagesRecord, briefingTime: string): string {
  const time = briefingTime.replace(/^0(\d)/, '$1');
  const parts: string[] = [];
  const s = record.switches;
  if (language === 'es') {
    if (s.agenda) parts.push(`tu agenda diaria a las ${time}`);
    if (s.debrief) parts.push('los avisos de resumen');
    if (s.confirmations) parts.push('las confirmaciones de reuniones');
    if (s.commitments) parts.push('los compromisos por revisar');
    if (s.reminders) parts.push('los recordatorios de tareas');
  } else {
    if (s.agenda) parts.push(`your daily agenda at ${time}`);
    if (s.debrief) parts.push('debrief prompts');
    if (s.confirmations) parts.push('meeting confirmations');
    if (s.commitments) parts.push('commitments to review');
    if (s.reminders) parts.push('task reminders');
  }
  const and = language === 'es' ? 'y' : 'and';
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} ${and} ${parts[parts.length - 1]}`;
}

/** "<name>: what" titles of follow-ups lose the prefix (whatsappRender.ts titleWords). */
export function followUpTitle(title: string, name: string): string {
  const prefix = `${name}:`;
  return title.toLowerCase().startsWith(prefix.toLowerCase()) ? title.slice(prefix.length).trim() : title;
}

// ---------------------------------------------------------------------------------------------
// Planning (the scheduler, per opted-in user)
// ---------------------------------------------------------------------------------------------

const SWITCH_OF: Readonly<Record<OutboundKind, WhatsappMessageSwitch | null>> = {
  agenda: 'agenda',
  debrief: 'debrief',
  confirmation: 'confirmations',
  commitments: 'commitments',
  task: 'reminders',
  followup: 'reminders',
  welcome: null,
};

function linkedHere(user: OptedInUser): boolean {
  return user.record.phoneE164 !== null && user.record.phoneE164 === user.linkedPhone;
}

/** The agenda slot: once a day, within the grace after the briefing time, in a known zone. */
export async function planAgenda(user: OptedInUser, prefs: UserPrefs, deps: OutboundDeps): Promise<boolean> {
  const { record, uid } = user;
  if (!record.switches.agenda || !linkedHere(user)) return false;
  const zone = userZone(record, prefs);
  if (zone === null) return false;
  const now = deps.now();
  const today = todayInZone(zone, now);
  if (record.lastAgendaDate === today) return false;
  const slotMs = Date.parse(zonedDateTimeToUtcIso(today, prefs.briefingTime, zone));
  if (!Number.isFinite(slotMs) || now.getTime() < slotMs || now.getTime() > slotMs + WHATSAPP_OUTBOUND_TUNING.agendaGraceMinutes * 60_000) return false;
  await deps.store.queue(newSend({ dedupeKey: `agenda:${uid}:${today}`, uid, kind: 'agenda', target: { date: today }, dueAt: now.toISOString(), now }));
  await deps.store.patchMessages(uid, { lastAgendaDate: today });
  return true;
}

/** Debrief prompts for occurrences that ended since the cursor (5 minutes after their end). */
export async function planDebriefs(user: OptedInUser, prefs: UserPrefs, deps: OutboundDeps): Promise<number> {
  const { record, uid } = user;
  if (!record.switches.debrief || !linkedHere(user)) return 0;
  const zone = userZone(record, prefs);
  if (zone === null) return 0;
  const now = deps.now();
  const t = WHATSAPP_OUTBOUND_TUNING;
  const windowEndMs = now.getTime() - t.debriefDelayMinutes * 60_000;
  // Never further back than one hour (a long pause must not flood the user).
  const cursorMs = Math.max(Date.parse(record.debriefCursor ?? record.optedInAt ?? now.toISOString()) || 0, now.getTime() - 3_600_000);
  if (windowEndMs <= cursorMs) return 0;
  const items = await deps.reader.dayItems(uid, new Date(cursorMs - 24 * 3_600_000).toISOString(), new Date(windowEndMs).toISOString());
  const ended = items
    .filter((item) => !item.allDay)
    .filter((item) => {
      const endMs = Date.parse(item.endAt);
      return endMs > cursorMs && endMs <= windowEndMs;
    })
    .sort((a, b) => (a.endAt < b.endAt ? -1 : 1));
  let day = record.debriefDay;
  let planned = 0;
  for (const item of ended) {
    const dueAt = new Date(Date.parse(item.endAt) + t.debriefDelayMinutes * 60_000);
    if (isQuietHour(dueAt, zone)) continue;
    const date = todayInZone(zone, dueAt);
    const count = day !== null && day.date === date ? day.count : 0;
    if (count >= t.debriefPerDay) continue;
    const key = `debrief:${uid}:${item.meetingId}:${item.occurrenceDate ?? item.startAt}`;
    const created = await deps.store.queue(
      newSend({
        dedupeKey: key,
        uid,
        kind: 'debrief',
        target: { meetingId: item.meetingId, occurrenceDate: item.occurrenceDate, title: item.title },
        dueAt: now.toISOString(),
        now,
      }),
    );
    if (created) {
      day = { date, count: count + 1 };
      planned += 1;
    }
  }
  await deps.store.patchMessages(uid, { debriefCursor: new Date(windowEndMs).toISOString(), debriefDay: day });
  return planned;
}

/** "Commitments to review" for matched summaries that arrived since the opt-in (pilot users). */
export async function planCommitments(user: OptedInUser, deps: OutboundDeps): Promise<number> {
  const { record, uid } = user;
  if (!record.switches.commitments || !linkedHere(user) || !deps.reader.isCommitmentsPilot(uid)) return 0;
  const after = record.optedInAt ?? deps.now().toISOString();
  const summaries = await deps.reader.summariesAfter(uid, after, 10);
  let planned = 0;
  const now = deps.now();
  for (const summary of summaries) {
    if (summary.status !== 'matched' || summary.items === 0 || summary.handled) continue;
    const created = await deps.store.queue(
      newSend({ dedupeKey: `commit:${uid}:${summary.summaryId}`, uid, kind: 'commitments', target: { summaryId: summary.summaryId }, dueAt: now.toISOString(), now }),
    );
    if (created) planned += 1;
  }
  return planned;
}

// ---------------------------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------------------------

export type SendOutcome = 'sent' | 'skipped' | 'held' | 'failed';

interface Prepared {
  kind: OutboundKind;
  params: string[];
}

type PrepareResult = { ok: true; prepared: Prepared } | { ok: false; reason: string } | { ok: 'hold'; until: string };

async function prepare(send: SendRecord, record: MessagesRecord, prefs: UserPrefs, zone: string, language: TemplateLanguage, deps: OutboundDeps): Promise<PrepareResult> {
  const now = deps.now();
  switch (send.kind) {
    case 'welcome':
      return { ok: true, prepared: { kind: 'welcome', params: [cleanValue(welcomePhrase(language, record, prefs.briefingTime), 200, language === 'es' ? 'tus mensajes' : 'your messages')] } };
    case 'agenda': {
      const date = send.target.date ?? todayInZone(zone, now);
      const range = dayRangeUtc(date, zone);
      const [items, tasks] = await Promise.all([deps.reader.dayItems(send.uid, range.from, range.to), deps.reader.openTasks(send.uid)]);
      const counts = taskCounts(tasks, date);
      // An empty day sends nothing (question 4).
      if (items.length === 0 && counts.dueToday === 0 && counts.overdue === 0) return { ok: false, reason: 'empty_day' };
      return { ok: true, prepared: { kind: 'agenda', params: [agendaMeetingsPhrase(language, items, zone), agendaTasksPhrase(language, counts.dueToday, counts.overdue)] } };
    }
    case 'debrief': {
      if (isQuietHour(now, zone)) return { ok: false, reason: 'quiet_hours' };
      if (!(await deps.reader.hasAllowance(send.uid, now))) return { ok: false, reason: 'no_allowance' };
      return { ok: true, prepared: { kind: 'debrief', params: [cleanValue(send.target.title, 60, FALLBACK_MEETING[language])] } };
    }
    case 'commitments': {
      if (isQuietHour(now, zone)) return { ok: 'hold', until: quietEndAfter(now, zone) };
      const summary = send.target.summaryId ? await deps.reader.summary(send.uid, send.target.summaryId) : null;
      if (summary === null || summary.status !== 'matched' || summary.handled) return { ok: false, reason: 'summary_gone' };
      const date = summary.meetingDate ? shortDate(language, summary.meetingDate) : language === 'es' ? 'hoy' : 'today';
      return { ok: true, prepared: { kind: 'commitments', params: [cleanValue(summary.meetingTitle, 60, FALLBACK_MEETING[language]), date] } };
    }
    case 'task':
    case 'followup': {
      const task = send.target.taskId ? await deps.reader.task(send.uid, send.target.taskId) : null;
      if (task === null || task.status !== 'open') return { ok: false, reason: 'task_gone' };
      if (send.target.fireAt !== 'snooze' && reminderFireAt(task) !== send.target.fireAt) return { ok: false, reason: 'task_moved' };
      const due = dueInstant(task);
      const moment = due === null ? (language === 'es' ? 'hoy' : 'today') : dueMoment(language, due, zone, now);
      const kind = reminderKindOf(task);
      if (kind === 'followup') {
        const name = task.people[0]!.name;
        return { ok: true, prepared: { kind, params: [cleanValue(name, 60, '-'), cleanValue(followUpTitle(task.title, name), 100, task.title.slice(0, 100) || '-'), moment] } };
      }
      return { ok: true, prepared: { kind, params: [cleanValue(task.title, 100, '-'), moment] } };
    }
    case 'confirmation':
      // No server path adds meetings outside the chat yet (question 1): never queued today.
      return { ok: false, reason: 'not_used' };
  }
}

async function templateUsable(kind: OutboundKind, language: TemplateLanguage, deps: OutboundDeps): Promise<boolean> {
  if (deps.mode !== 'live') return true;
  const definition = TEMPLATES[kind];
  const state = await deps.store.getTemplate(definition.name, language);
  if (state === null) return false;
  if (state.status !== 'APPROVED' || state.category !== 'UTILITY') return false;
  return state.ttlSeconds === null || state.ttlSeconds === definition.ttlSeconds;
}

/** One due entry through the gate and out. Never throws. */
export async function sendDue(send: SendRecord, deps: OutboundDeps): Promise<SendOutcome> {
  const now = deps.now();
  const nowIso = now.toISOString();
  const skip = async (reason: string): Promise<SendOutcome> => {
    await deps.store.finish(send.sendId, { status: 'skipped', reason });
    logger.info('whatsapp.outbound_skipped', { sendId: send.sendId, kind: send.kind, reason });
    return 'skipped';
  };
  try {
    if (deps.mode === 'off') return 'skipped';
    if (!(await deps.store.claim(send.sendId, nowIso))) return 'skipped';
    const { record, linkedPhone } = await deps.store.getMessages(send.uid);
    if (record.phoneE164 === null || record.phoneE164 !== linkedPhone) return skip('not_linked_here');
    if ((await deps.reader.linkUid(record.phoneE164)) !== send.uid) return skip('link_mismatch');
    const switchKey = SWITCH_OF[send.kind];
    if (switchKey !== null && !record.switches[switchKey]) return skip('switch_off');
    if (switchKey === null && !Object.values(record.switches).some(Boolean)) return skip('switch_off');
    if (send.kind === 'commitments' && !deps.reader.isCommitmentsPilot(send.uid)) return skip('not_pilot');
    const prefs = await deps.reader.prefs(send.uid);
    const zone = userZone(record, prefs) ?? 'UTC';
    const language = templateLanguageOf(prefs.uiLanguage);
    const prepared = await prepare(send, record, prefs, zone, language, deps);
    if (prepared.ok === 'hold') {
      await deps.store.finish(send.sendId, { status: 'queued', queuedDueAt: prepared.until, sentAt: null, reason: 'quiet_hours' });
      return 'held';
    }
    if (prepared.ok === false) return skip(prepared.reason);
    const { kind, params } = prepared.prepared;
    if (!(await templateUsable(kind, language, deps))) return skip('template_unavailable');
    const rendered = renderTemplate(kind, language, params, send.sendId);
    const phone = record.phoneE164;
    let wamid: string | null;
    if (deps.mode === 'live') {
      wamid = await deps.sender.sendTemplate(phone, rendered);
    } else {
      const body = previewText(kind, language, params);
      wamid =
        rendered.payloads.length > 0
          ? await deps.sender.sendButtonsWithId(phone, body, previewButtons(kind, language, rendered.payloads))
          : await deps.sender.sendTextWithId(phone, body);
    }
    await deps.store.finish(send.sendId, {
      status: 'sent',
      sentAt: nowIso,
      phone,
      language,
      wamid,
      reason: deps.mode === 'live' ? null : 'preview',
      tapExpiresAt: new Date(now.getTime() + WHATSAPP_OUTBOUND_TUNING.tapValidityHours * 3_600_000).toISOString(),
    });
    logger.info('whatsapp.outbound_sent', { sendId: send.sendId, kind, mode: deps.mode, phone: phoneLogId(phone) });
    return 'sent';
  } catch (error) {
    const code = error instanceof WhatsappApiError ? error.code : null;
    logger.warn('whatsapp.outbound_failed', {
      sendId: send.sendId,
      kind: send.kind,
      status: error instanceof WhatsappApiError ? error.status : null,
      code,
      errorName: error instanceof Error ? error.name : typeof error,
    });
    try {
      await deps.store.finish(send.sendId, { status: 'failed', errorCode: code, reason: 'send_error' });
    } catch {
      // logged above
    }
    return 'failed';
  }
}

export interface TickResult {
  users: number;
  agendas: number;
  debriefs: number;
  commitments: number;
  sent: number;
  skipped: number;
  held: number;
  failed: number;
}

/** One scheduler run: plan for every opted-in user, then send what is due. */
export async function runTick(deps: OutboundDeps): Promise<TickResult> {
  const result: TickResult = { users: 0, agendas: 0, debriefs: 0, commitments: 0, sent: 0, skipped: 0, held: 0, failed: 0 };
  if (deps.mode === 'off') return result;
  const t = WHATSAPP_OUTBOUND_TUNING;
  const users = await deps.store.listOptedIn(t.maxUsersPerTick);
  for (const user of users) {
    result.users += 1;
    try {
      const prefs = await deps.reader.prefs(user.uid);
      if (await planAgenda(user, prefs, deps)) result.agendas += 1;
      result.debriefs += await planDebriefs(user, prefs, deps);
      result.commitments += await planCommitments(user, deps);
    } catch (error) {
      logger.warn('whatsapp.outbound_plan_failed', { uid: user.uid, errorName: error instanceof Error ? error.name : typeof error });
    }
  }
  const due = await deps.store.listDue(deps.now().toISOString(), t.maxSendsPerTick);
  for (const send of due) {
    const outcome = await sendDue(send, deps);
    result[outcome] += 1;
  }
  return result;
}

// ---------------------------------------------------------------------------------------------
// The "See my day" list (tap on the agenda; no AI)
// ---------------------------------------------------------------------------------------------

export interface DayListInput {
  date: string;
  zone: string;
  language: AppLanguage;
  meetingBlocks: string[];
  tasks: TaskView[];
  texts: { header: string; empty: string; tasksHeader: string; dueAt: string; overdue: string; more: string };
  maxChars: number;
}

export function renderDayList(input: DayListInput): string {
  const lang: TemplateLanguage = templateLanguageOf(input.language);
  const header = input.texts.header.replace('{date}', weekdayDate(lang, input.date));
  const lines: string[] = [header, ''];
  const blocks = input.meetingBlocks.length > 0 ? input.meetingBlocks : [input.texts.empty];
  const taskLines: string[] = [];
  for (const task of input.tasks) {
    if (task.status !== 'open' || task.dueDate === null || task.dueDate > input.date) continue;
    let suffix: string;
    if (task.dueDate < input.date) suffix = input.texts.overdue;
    else if (task.dueTime !== null) suffix = input.texts.dueAt.replace('{time}', task.dueTime.replace(/^0(\d)/, '$1'));
    else suffix = '';
    taskLines.push(`- ${task.title}${suffix ? ` (${suffix})` : ''}`);
  }
  const parts = [...blocks];
  if (taskLines.length > 0) parts.push([input.texts.tasksHeader, ...taskLines].join('\n'));
  let text = [lines.join('\n').trimEnd(), ...parts].join('\n\n');
  if (text.length <= input.maxChars) return text;
  // Cut whole parts and say how many are left.
  let kept = parts.length;
  while (kept > 0) {
    kept -= 1;
    const more = input.texts.more.replace('{count}', String(parts.length - kept));
    text = [header, ...parts.slice(0, kept), more].join('\n\n');
    if (text.length <= input.maxChars) return text;
  }
  return header;
}


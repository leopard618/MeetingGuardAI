/**
 * M13: the messages the bot starts (docs/v2/WhatsApp-Templates-2026-11-12.md): templates, the
 * opt-in, STOP, the planners, the send gate, the taps and the status webhooks.
 */
import { WHATSAPP_OUTBOUND_TUNING } from '../../src/config';
import { WhatsappApiError } from '../../src/whatsapp/send';
import {
  agendaMeetingsPhrase,
  agendaTasksPhrase,
  planAgenda,
  planCommitments,
  planDebriefs,
  quietEndAfter,
  reminderFireAt,
  renderDayList,
  runTick,
  sendDue,
  templatesModeOf,
  welcomePhrase,
  type DayItem,
  type OutboundDeps,
  type TaskView,
} from '../../src/whatsapp/outbound';
import { emptyMessagesRecord, newSend, sendIdOf, type MessagesRecord } from '../../src/whatsapp/outboundStore';
import { OptInError, applyStop, handleMessages, isStopRequest, rebuildReminders, syncTaskReminder } from '../../src/whatsapp/optin';
import { OUTBOUND_TEXTS } from '../../src/whatsapp/outboundTexts';
import { applyStatusEvents, extractStatusEvents, handleTap } from '../../src/whatsapp/taps';
import { TEMPLATES, atTime, cleanValue, dueMoment, parseTap, previewText, renderTemplate, shortDate, weekdayDate } from '../../src/whatsapp/templates';
import { syncTemplateStates } from '../../src/whatsapp/messagesIndex';
import { SUMMARIES_COLLECTION_NAME } from '../../src/whatsapp/outboundFirestore';
import { MEETING_SUMMARIES_COLLECTION } from '../../src/summaries/model';
import { MemoryOutboundStore, MemoryReader, RecordingSender } from './whatsappOutboundFakes';

// 14:00 UTC = 8:00 in Costa Rica (UTC-6, no DST).
const NOW = new Date('2026-11-23T14:00:00.000Z');
const ZONE = 'America/Costa_Rica';
const UID = 'u1';
const PHONE = '50688887777';
const ALL_ON = { agenda: true, debrief: true, confirmations: false, commitments: true, reminders: true };

function world(mode: OutboundDeps['mode'] = 'preview', now: Date = NOW) {
  const store = new MemoryOutboundStore();
  const reader = new MemoryReader();
  const sender = new RecordingSender();
  let clock = now;
  const deps: OutboundDeps = { store, reader, sender, mode, now: () => clock };
  reader.links.set(PHONE, UID);
  return {
    store,
    reader,
    sender,
    deps,
    setNow(next: Date) {
      clock = next;
    },
  };
}

function optIn(store: MemoryOutboundStore, record: Partial<MessagesRecord> = {}) {
  store.link(UID, PHONE, { switches: { ...ALL_ON }, optedInAt: '2026-11-20T00:00:00.000Z', deviceTimeZone: ZONE, ...record });
}

function meeting(id: string, startAt: string, minutes: number, extra: Partial<DayItem> = {}): DayItem {
  return { meetingId: id, occurrenceDate: null, title: `Meeting ${id}`, startAt, endAt: new Date(Date.parse(startAt) + minutes * 60_000).toISOString(), allDay: false, ...extra };
}

function task(id: string, extra: Partial<TaskView> = {}): TaskView {
  return { id, title: 'Send the signed proposal to Ana', status: 'open', dueDate: '2026-11-23', dueTime: '16:00', timezone: ZONE, reminderMinutesBefore: 0, people: [], ...extra };
}

describe('templates (the batch submitted to Meta)', () => {
  it('every template keeps Meta limits and the product text rule', () => {
    for (const template of Object.values(TEMPLATES)) {
      expect(template.name).toMatch(/^mg_[a-z_]+_v[1-9]$/);
      for (const texts of Object.values(template.texts)) {
        expect(texts.body.length).toBeLessThanOrEqual(1024);
        expect(texts.header.length).toBeLessThanOrEqual(60);
        if (texts.footer) expect(texts.footer.length).toBeLessThanOrEqual(60);
        expect(texts.buttons).toHaveLength(template.taps.length);
        for (const label of texts.buttons) expect(label.length).toBeLessThanOrEqual(25);
        const all = [texts.header, texts.body, texts.footer ?? '', ...texts.buttons].join(' ');
        expect(all).not.toMatch(/[–—…“”‘’«»]/);
        const vars = [...texts.body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
        expect(vars).toEqual(Array.from({ length: template.params }, (_, i) => i + 1));
        expect(texts.body.startsWith('{{')).toBe(false);
        expect(texts.body.trim().endsWith('.')).toBe(true);
      }
    }
  });

  it('renders the payloads per button and parses them back', () => {
    const sendId = sendIdOf('x');
    const rendered = renderTemplate('task', 'es', ['Enviar la propuesta', 'hoy a las 16:00'], sendId);
    expect(rendered).toEqual({ name: 'mg_task_reminder_v1', language: 'es', params: ['Enviar la propuesta', 'hoy a las 16:00'], payloads: [`wa_done:${sendId}`, `wa_later:${sendId}`] });
    expect(parseTap(`wa_later:${sendId}`)).toEqual({ action: 'later', sendId });
    expect(parseTap('wa_confirm:abc')).toBeNull();
    expect(parseTap(`wa_agenda:${sendId}x`)).toBeNull();
    expect(() => renderTemplate('task', 'en', ['only one'], sendId)).toThrow();
  });

  it('the value cleaner keeps one line, cuts at a word and never returns empty', () => {
    expect(cleanValue('  Weekly\nsync\t with  Ana ', 60, 'Meeting')).toBe('Weekly sync with Ana');
    expect(cleanValue('', 60, 'Meeting')).toBe('Meeting');
    expect(cleanValue('Quarterly planning with the whole regional team', 20, 'Meeting')).toBe('Quarterly planning');
  });

  it('times are H:MM with no leading zero; Spanish says "a la" for one o\'clock', () => {
    expect(atTime('en', new Date('2026-11-23T15:30:00Z'), ZONE)).toBe('at 9:30');
    expect(atTime('es', new Date('2026-11-23T07:30:00Z'), ZONE)).toBe('a la 1:30');
    expect(atTime('es', new Date('2026-11-23T22:00:00Z'), ZONE)).toBe('a las 16:00');
  });

  it('due moments read today, tomorrow or the date', () => {
    expect(dueMoment('en', new Date('2026-11-23T22:00:00Z'), ZONE, NOW)).toBe('today at 16:00');
    expect(dueMoment('es', new Date('2026-11-24T15:00:00Z'), ZONE, NOW)).toBe('mañana a las 9:00');
    expect(dueMoment('en', new Date('2026-11-27T15:00:00Z'), ZONE, NOW)).toBe('on Fri, Nov 27 at 9:00');
    expect(dueMoment('es', new Date('2026-11-27T15:00:00Z'), ZONE, NOW)).toBe('el vie 27 nov a las 9:00');
    expect(shortDate('es', '2026-10-16')).toBe('16 oct');
    expect(weekdayDate('en', '2026-11-12')).toBe('Thu, Nov 12');
  });

  it('preview mode shows header, body with the values, and footer', () => {
    const text = previewText('debrief', 'en', ['Weekly sync']);
    expect(text).toContain('*How did it go?*');
    expect(text).toContain('Your meeting "Weekly sync" has ended.');
    expect(text).toContain('_Reply STOP to turn off these messages._');
  });

  it('the summaries collection name equals the model constant', () => {
    expect(SUMMARIES_COLLECTION_NAME).toBe(MEETING_SUMMARIES_COLLECTION);
  });

  it('the mode reads off, preview or live, anything else off', () => {
    expect(templatesModeOf('live')).toBe('live');
    expect(templatesModeOf(' Preview ')).toBe('preview');
    expect(templatesModeOf('on')).toBe('off');
    expect(templatesModeOf(undefined)).toBe('off');
  });
});

describe('template values', () => {
  it('agenda meetings phrase forms', () => {
    const one = [meeting('a', '2026-11-23T15:30:00Z', 30, { title: 'Weekly sync' })];
    expect(agendaMeetingsPhrase('en', [], ZONE)).toBe('no meetings');
    expect(agendaMeetingsPhrase('en', one, ZONE)).toBe('1 meeting at 9:30 (Weekly sync)');
    const three = [...one, meeting('b', '2026-11-23T17:00:00Z', 30), meeting('c', '2026-11-23T19:00:00Z', 30)];
    expect(agendaMeetingsPhrase('es', three, ZONE)).toBe('3 reuniones, la primera a las 9:30 (Weekly sync)');
    expect(agendaMeetingsPhrase('en', [meeting('d', '2026-11-23T06:00:00Z', 1440, { allDay: true, title: 'Offsite' })], ZONE)).toBe('1 all-day meeting (Offsite)');
    expect(agendaMeetingsPhrase('es', [meeting('d', '2026-11-23T06:00:00Z', 1440, { allDay: true, title: 'Offsite' })], ZONE)).toBe('1 reunión de todo el día (Offsite)');
  });

  it('agenda tasks phrase forms', () => {
    expect(agendaTasksPhrase('en', 2, 1)).toBe('2 due today and 1 overdue');
    expect(agendaTasksPhrase('en', 1, 0)).toBe('1 due today');
    expect(agendaTasksPhrase('en', 0, 3)).toBe('none due today and 3 overdue');
    expect(agendaTasksPhrase('es', 2, 1)).toBe('2 para hoy y 1 vencida');
    expect(agendaTasksPhrase('es', 0, 3)).toBe('ninguna para hoy y 3 vencidas');
    expect(agendaTasksPhrase('es', 0, 0)).toBe('ninguna para hoy');
  });

  it('welcome lists the switches that are on', () => {
    const record = { ...emptyMessagesRecord(), switches: { agenda: true, debrief: false, confirmations: false, commitments: false, reminders: true } };
    expect(welcomePhrase('en', record, '08:00')).toBe('your daily agenda at 8:00 and task reminders');
    expect(welcomePhrase('es', record, '08:00')).toBe('tu agenda diaria a las 8:00 y los recordatorios de tareas');
  });

  it('a reminder fires at the due time minus the minutes before, open tasks only', () => {
    expect(reminderFireAt(task('sm_1', { reminderMinutesBefore: 15 }))).toBe('2026-11-23T21:45:00.000Z');
    expect(reminderFireAt(task('sm_1', { status: 'done' }))).toBeNull();
    expect(reminderFireAt(task('sm_1', { dueTime: null }))).toBeNull();
  });
});

describe('STOP', () => {
  it.each(['STOP', 'Stop.', 'stop!', '¡Baja!', 'parar', 'Darme de baja', 'no más mensajes', 'stop please', 'baja por favor', 'Stopp'])('"%s" stops', (text) => {
    expect(isStopRequest(text)).toBe(true);
  });
  it.each(['no', 'cancel', '2', 'stop the meeting tomorrow at 10 please', 'what is my agenda', ''])('"%s" does not', (text) => {
    expect(isStopRequest(text)).toBe(false);
  });
});

describe('the opt-in (whatsappMessages)', () => {
  function optInDeps(w: ReturnType<typeof world>, mode: OutboundDeps['mode'] = 'preview') {
    return { store: w.store, reader: w.reader, mode, enabled: true, now: () => NOW };
  }

  it('get answers off and unlinked for a new account', async () => {
    const w = world();
    const response = await handleMessages(UID, { op: 'get' }, optInDeps(w));
    expect(response).toMatchObject({ available: true, linked: false, stoppedAt: null });
    expect(Object.values(response.switches).every((v) => !v)).toBe(true);
    expect(response.offered.commitments).toBe(false);
    expect(response.offered.confirmations).toBe(false);
  });

  it('set refuses while the mode is off or the phone is not linked', async () => {
    const w = world();
    const request = { op: 'set' as const, switches: { ...ALL_ON }, wordingVersion: 1 };
    await expect(handleMessages(UID, request, optInDeps(w, 'off'))).rejects.toEqual(new OptInError('not_configured'));
    await expect(handleMessages(UID, request, optInDeps(w))).rejects.toEqual(new OptInError('invalid_request'));
  });

  it('the first switch on records the opt-in for this phone and queues the welcome once', async () => {
    const w = world();
    w.store.phones.set(UID, PHONE);
    const response = await handleMessages(UID, { op: 'set', switches: { ...ALL_ON }, wordingVersion: 1, deviceTimeZone: ZONE }, optInDeps(w));
    // commitments is not offered (not a pilot), confirmations never yet
    expect(response.switches).toEqual({ agenda: true, debrief: true, confirmations: false, commitments: false, reminders: true });
    const record = w.store.records.get(UID)!;
    expect(record).toMatchObject({ phoneE164: PHONE, optedInAt: NOW.toISOString(), deviceTimeZone: ZONE, wordingVersion: 1 });
    expect([...w.store.sends.values()].map((s) => s.kind)).toEqual(['welcome']);
    await handleMessages(UID, { op: 'set', switches: { ...ALL_ON, debrief: false }, wordingVersion: 1 }, optInDeps(w));
    expect([...w.store.sends.values()].filter((s) => s.kind === 'welcome')).toHaveLength(1);
  });

  it('the reminders switch queues the open summary tasks; all off removes every queued message', async () => {
    const w = world();
    w.store.phones.set(UID, PHONE);
    w.reader.tasks.set(UID, [task('sm_a'), task('plain1'), task('sm_past', { dueDate: '2026-11-20' })]);
    await handleMessages(UID, { op: 'set', switches: { ...ALL_ON }, wordingVersion: 1 }, optInDeps(w));
    const reminders = [...w.store.sends.values()].filter((s) => s.kind === 'task');
    expect(reminders.map((s) => s.target.taskId)).toEqual(['sm_a']);
    await handleMessages(UID, { op: 'set', switches: { agenda: false, debrief: false, confirmations: false, commitments: false, reminders: false }, wordingVersion: 1 }, optInDeps(w));
    expect(w.store.sends.size).toBe(0);
  });

  it('a new phone starts with every switch off', async () => {
    const w = world();
    optIn(w.store);
    w.store.phones.set(UID, '50611112222');
    w.reader.links.set('50611112222', UID);
    const response = await handleMessages(UID, { op: 'get' }, optInDeps(w));
    expect(Object.values(response.switches).every((v) => !v)).toBe(true);
  });

  it('get refreshes the device zone of an opted-in user', async () => {
    const w = world();
    optIn(w.store, { deviceTimeZone: 'UTC' });
    await handleMessages(UID, { op: 'get', deviceTimeZone: 'America/Mexico_City' }, optInDeps(w));
    expect(w.store.records.get(UID)!.deviceTimeZone).toBe('America/Mexico_City');
  });
});

describe('task reminders follow the task', () => {
  it('a moved due time drops the old reminder and queues the new one; done drops it', async () => {
    const w = world();
    optIn(w.store);
    const deps = { store: w.store, now: () => NOW };
    expect(await syncTaskReminder(UID, 'sm_1', null, task('sm_1'), deps)).toBe('queued');
    const moved = task('sm_1', { dueTime: '17:00' });
    expect(await syncTaskReminder(UID, 'sm_1', task('sm_1'), moved, deps)).toBe('queued');
    expect([...w.store.sends.values()].map((s) => s.target.fireAt)).toEqual(['2026-11-23T23:00:00.000Z']);
    expect(await syncTaskReminder(UID, 'sm_1', moved, { ...moved, status: 'done' }, deps)).toBe('dropped');
    expect(w.store.sends.size).toBe(0);
  });

  it('only summary tasks, only while the switch is on', async () => {
    const w = world();
    optIn(w.store, { switches: { ...ALL_ON, reminders: false } });
    const deps = { store: w.store, now: () => NOW };
    expect(await syncTaskReminder(UID, 'plain', null, task('plain'), deps)).toBe('ignored');
    expect(await syncTaskReminder(UID, 'sm_1', null, task('sm_1'), deps)).toBe('dropped');
    expect(w.store.sends.size).toBe(0);
  });

  it('a follow-up (one person) is queued as the follow-up template', async () => {
    const w = world();
    w.store.phones.set(UID, PHONE);
    w.reader.tasks.set(UID, [task('sm_f', { people: [{ name: 'Cristina Reyes' }], title: 'Cristina Reyes: Confirm the launch date' })]);
    await rebuildReminders(UID, { store: w.store, reader: w.reader, now: () => NOW });
    expect([...w.store.sends.values()][0]!.kind).toBe('followup');
  });
});

describe('planning', () => {
  it('the agenda is queued once at the briefing time, within the grace', async () => {
    const w = world();
    optIn(w.store);
    const user = (await w.store.listOptedIn(10))[0]!;
    const prefs = await w.reader.prefs(UID);
    w.setNow(new Date('2026-11-23T13:59:00Z'));
    expect(await planAgenda(user, prefs, w.deps)).toBe(false);
    w.setNow(NOW);
    expect(await planAgenda(user, prefs, w.deps)).toBe(true);
    expect(w.store.records.get(UID)!.lastAgendaDate).toBe('2026-11-23');
    const again = (await w.store.listOptedIn(10))[0]!;
    expect(await planAgenda(again, prefs, w.deps)).toBe(false);
    const late = world('preview', new Date(NOW.getTime() + (WHATSAPP_OUTBOUND_TUNING.agendaGraceMinutes + 1) * 60_000));
    optIn(late.store);
    expect(await planAgenda((await late.store.listOptedIn(10))[0]!, prefs, late.deps)).toBe(false);
  });

  it('no agenda while the server has no real zone for the user', async () => {
    const w = world();
    optIn(w.store, { deviceTimeZone: null });
    w.reader.prefsByUid.set(UID, { uiLanguage: 'en', timezone: null, briefingTime: '08:00' });
    expect(await planAgenda((await w.store.listOptedIn(10))[0]!, await w.reader.prefs(UID), w.deps)).toBe(false);
  });

  it('debrief prompts: ended meetings since the cursor, none in quiet hours, at most 3 a day', async () => {
    const w = world();
    optIn(w.store, { debriefCursor: '2026-11-23T13:00:00.000Z' });
    w.reader.items.set(UID, [
      meeting('a', '2026-11-23T13:00:00Z', 30),
      meeting('b', '2026-11-23T13:10:00Z', 30),
      meeting('c', '2026-11-23T13:15:00Z', 30),
      meeting('d', '2026-11-23T13:20:00Z', 30),
      meeting('allday', '2026-11-23T06:00:00Z', 420, { allDay: true }),
    ]);
    const planned = await planDebriefs((await w.store.listOptedIn(10))[0]!, await w.reader.prefs(UID), w.deps);
    expect(planned).toBe(3);
    expect(w.store.records.get(UID)!.debriefDay).toEqual({ date: '2026-11-23', count: 3 });
    expect(w.store.records.get(UID)!.debriefCursor).toBe('2026-11-23T13:55:00.000Z');

    const night = world('preview', new Date('2026-11-24T04:00:00Z')); // 22:00 local
    optIn(night.store, { debriefCursor: '2026-11-24T03:00:00.000Z' });
    night.reader.items.set(UID, [meeting('late', '2026-11-24T03:00:00Z', 30)]);
    expect(await planDebriefs((await night.store.listOptedIn(10))[0]!, await night.reader.prefs(UID), night.deps)).toBe(0);
  });

  it('commitments: pilot users, matched summaries with items, once per summary', async () => {
    const w = world();
    optIn(w.store);
    const summary = { summaryId: 's1', status: 'matched', receivedAt: '2026-11-23T12:00:00.000Z', meetingTitle: 'Urpayroll sync', meetingDate: '2026-11-23', items: 4, handled: false };
    w.reader.summaries.set(UID, [summary, { ...summary, summaryId: 's2', status: 'inbox' }, { ...summary, summaryId: 's3', items: 0 }]);
    const user = (await w.store.listOptedIn(10))[0]!;
    expect(await planCommitments(user, w.deps)).toBe(0);
    w.reader.pilot.add(UID);
    expect(await planCommitments(user, w.deps)).toBe(1);
    expect(await planCommitments(user, w.deps)).toBe(0);
  });
});

describe('the send gate', () => {
  function due(w: ReturnType<typeof world>, kind: Parameters<typeof newSend>[0]['kind'], target = {}) {
    const send = newSend({ dedupeKey: `${kind}:${JSON.stringify(target)}`, uid: UID, kind, target, dueAt: NOW.toISOString(), now: NOW });
    w.store.sends.set(send.sendId, send);
    return send;
  }

  it('preview: the agenda goes out as buttons with the tap payload, in the user language', async () => {
    const w = world();
    optIn(w.store);
    w.reader.prefsByUid.set(UID, { uiLanguage: 'es', timezone: ZONE, briefingTime: '08:00' });
    w.reader.items.set(UID, [meeting('a', '2026-11-23T15:30:00Z', 30, { title: 'Revisión semanal' })]);
    w.reader.tasks.set(UID, [task('t1'), task('t2', { dueDate: '2026-11-20' })]);
    const send = due(w, 'agenda', { date: '2026-11-23' });
    expect(await sendDue(send, w.deps)).toBe('sent');
    const out = w.sender.sent[0]!;
    expect(out.kind).toBe('buttons');
    expect(out.body).toContain('Esta es tu agenda de hoy en Meeting Guard AI: 1 reunión a las 9:30 (Revisión semanal). Tareas: 1 para hoy y 1 vencida.');
    expect(out.buttons).toEqual([{ id: `wa_agenda:${send.sendId}`, title: 'Ver mi día' }]);
    expect(w.store.sends.get(send.sendId)).toMatchObject({ status: 'sent', phone: PHONE, language: 'es', wamid: 'wamid.1', reason: 'preview' });
  });

  it('live: only an approved UTILITY template with the registry validity is sent', async () => {
    const w = world('live');
    optIn(w.store);
    w.reader.tasks.set(UID, [task('sm_1')]);
    const send = due(w, 'task', { taskId: 'sm_1', fireAt: '2026-11-23T22:00:00.000Z' });
    expect(await sendDue(send, w.deps)).toBe('skipped');
    expect(w.store.sends.get(send.sendId)!.reason).toBe('template_unavailable');

    const ok = world('live');
    optIn(ok.store);
    ok.reader.tasks.set(UID, [task('sm_1')]);
    await ok.store.setTemplate('mg_task_reminder_v1', 'en', { status: 'APPROVED', category: 'UTILITY', ttlSeconds: 3600 });
    const send2 = due(ok, 'task', { taskId: 'sm_1', fireAt: '2026-11-23T22:00:00.000Z' });
    expect(await sendDue(send2, ok.deps)).toBe('sent');
    expect(ok.sender.sent[0]!.template).toEqual({
      name: 'mg_task_reminder_v1',
      language: 'en',
      params: ['Send the signed proposal to Ana', 'today at 16:00'],
      payloads: [`wa_done:${send2.sendId}`, `wa_later:${send2.sendId}`],
    });

    const marketing = world('live');
    optIn(marketing.store);
    marketing.reader.tasks.set(UID, [task('sm_1')]);
    await marketing.store.setTemplate('mg_task_reminder_v1', 'en', { status: 'APPROVED', category: 'MARKETING', ttlSeconds: 3600 });
    expect(await sendDue(due(marketing, 'task', { taskId: 'sm_1', fireAt: '2026-11-23T22:00:00.000Z' }), marketing.deps)).toBe('skipped');
  });

  it('skips when the switch is off, the phone changed or the link moved', async () => {
    const off = world();
    optIn(off.store, { switches: { ...ALL_ON, agenda: false } });
    expect(await sendDue(due(off, 'agenda'), off.deps)).toBe('skipped');

    const moved = world();
    optIn(moved.store);
    moved.store.phones.set(UID, '50600000000');
    expect(await sendDue(due(moved, 'agenda'), moved.deps)).toBe('skipped');

    const relinked = world();
    optIn(relinked.store);
    relinked.reader.links.set(PHONE, 'someone-else');
    expect(await sendDue(due(relinked, 'agenda'), relinked.deps)).toBe('skipped');
    expect(off.sender.sent.length + moved.sender.sent.length + relinked.sender.sent.length).toBe(0);
  });

  it('an empty day sends no agenda; a moved or done task sends no reminder', async () => {
    const w = world();
    optIn(w.store);
    expect(await sendDue(due(w, 'agenda', { date: '2026-11-23' }), w.deps)).toBe('skipped');
    w.reader.tasks.set(UID, [task('sm_1', { dueTime: '17:00' })]);
    expect(await sendDue(due(w, 'task', { taskId: 'sm_1', fireAt: '2026-11-23T22:00:00.000Z' }), w.deps)).toBe('skipped');
    w.reader.tasks.set(UID, [task('sm_2', { status: 'done' })]);
    expect(await sendDue(due(w, 'task', { taskId: 'sm_2', fireAt: '2026-11-23T22:00:00.000Z' }), w.deps)).toBe('skipped');
    expect(w.sender.sent).toHaveLength(0);
  });

  it('a debrief prompt needs an AI action left', async () => {
    const w = world();
    optIn(w.store);
    w.reader.allowance = false;
    expect(await sendDue(due(w, 'debrief', { meetingId: 'm1', title: 'Weekly sync' }), w.deps)).toBe('skipped');
  });

  it('commitments in quiet hours are held to 7:00 local', async () => {
    const night = new Date('2026-11-24T04:00:00Z'); // 22:00 local
    const w = world('preview', night);
    optIn(w.store);
    w.reader.pilot.add(UID);
    w.reader.summaries.set(UID, [{ summaryId: 's1', status: 'matched', receivedAt: '2026-11-24T03:00:00Z', meetingTitle: 'Sync', meetingDate: '2026-11-23', items: 2, handled: false }]);
    const send = newSend({ dedupeKey: 'c', uid: UID, kind: 'commitments', target: { summaryId: 's1' }, dueAt: night.toISOString(), now: night });
    w.store.sends.set(send.sendId, send);
    expect(await sendDue(send, w.deps)).toBe('held');
    expect(w.store.sends.get(send.sendId)).toMatchObject({ status: 'queued', queuedDueAt: '2026-11-24T13:00:00.000Z' });
    expect(quietEndAfter(new Date('2026-11-24T10:00:00Z'), ZONE)).toBe('2026-11-24T13:00:00.000Z');
  });

  it('a Graph error is logged as failed with Meta\'s code, never retried', async () => {
    const w = world();
    optIn(w.store);
    w.reader.items.set(UID, [meeting('a', '2026-11-23T15:30:00Z', 30)]);
    w.sender.fail = new WhatsappApiError(400, 'x', 131047);
    const send = due(w, 'agenda', { date: '2026-11-23' });
    expect(await sendDue(send, w.deps)).toBe('failed');
    expect(w.store.sends.get(send.sendId)).toMatchObject({ status: 'failed', errorCode: 131047, queuedDueAt: null });
  });

  it('off mode sends nothing; a tick plans and sends what is due', async () => {
    const off = world('off');
    optIn(off.store);
    expect((await runTick(off.deps)).users).toBe(0);

    const w = world();
    optIn(w.store);
    w.reader.items.set(UID, [meeting('a', '2026-11-23T15:30:00Z', 30)]);
    const result = await runTick(w.deps);
    expect(result).toMatchObject({ users: 1, agendas: 1, sent: 1 });
  });
});

describe('taps', () => {
  async function sent(w: ReturnType<typeof world>, kind: Parameters<typeof newSend>[0]['kind'], target = {}) {
    const send = newSend({ dedupeKey: `${kind}-tap`, uid: UID, kind, target, dueAt: NOW.toISOString(), now: NOW });
    w.store.sends.set(send.sendId, { ...send, status: 'sent', queuedDueAt: null, phone: PHONE, tapExpiresAt: new Date(NOW.getTime() + 3_600_000).toISOString() });
    return send.sendId;
  }

  function tapDeps(w: ReturnType<typeof world>) {
    const updates: { taskId: string; fields: Record<string, unknown> }[] = [];
    const tasks = {
      getTask: async () => undefined,
      createTask: async () => undefined,
      updateTaskFields: async (_uid: string, taskId: string, fields: Record<string, unknown>) => {
        updates.push({ taskId, fields });
      },
      deleteTask: async () => undefined,
      newTaskId: () => 't',
    };
    return { deps: { store: w.store, reader: w.reader, sender: w.sender, tasks, now: () => NOW }, updates };
  }

  it('Mark as done writes done, completedAt, updatedAt and pushPending, at no AI action', async () => {
    const w = world();
    optIn(w.store);
    w.reader.tasks.set(UID, [task('sm_1')]);
    const id = await sent(w, 'task', { taskId: 'sm_1' });
    const { deps, updates } = tapDeps(w);
    expect(await handleTap(`wa_done:${id}`, PHONE, UID, 'en', deps)).toEqual({ handled: true });
    expect(updates[0]).toEqual({ taskId: 'sm_1', fields: { status: 'done', completedAt: NOW.toISOString(), updatedAt: NOW.toISOString(), pushPending: true } });
    expect(w.sender.sent[0]!.body).toBe('OK. I marked "Send the signed proposal to Ana" as done.');
  });

  it('Remind me in 1 hour queues a snooze and says when', async () => {
    const w = world();
    optIn(w.store);
    w.reader.tasks.set(UID, [task('sm_1')]);
    const id = await sent(w, 'task', { taskId: 'sm_1' });
    await handleTap(`wa_later:${id}`, PHONE, UID, 'es', tapDeps(w).deps);
    const snooze = [...w.store.sends.values()].find((s) => s.target.fireAt === 'snooze')!;
    expect(snooze.queuedDueAt).toBe('2026-11-23T15:00:00.000Z');
    expect(w.sender.sent[0]!.body).toBe('De acuerdo. Te lo recuerdo otra vez a las 9:00.');
  });

  it('a tap from another phone, account or after the validity is refused', async () => {
    const w = world();
    optIn(w.store);
    const id = await sent(w, 'agenda');
    const { deps } = tapDeps(w);
    await handleTap(`wa_agenda:${id}`, '50600000000', UID, 'en', deps);
    await handleTap(`wa_agenda:${id}`, PHONE, 'other', 'en', deps);
    await handleTap(`wa_agenda:${id}`, PHONE, UID, 'en', { ...deps, now: () => new Date(NOW.getTime() + 2 * 3_600_000) });
    expect(w.sender.sent.map((m) => m.body)).toEqual([OUTBOUND_TEXTS.en.outdated, OUTBOUND_TEXTS.en.outdated, OUTBOUND_TEXTS.en.outdated]);
    expect(await handleTap('wa_confirm:abc', PHONE, UID, 'en', deps)).toEqual({ handled: false });
  });

  it('See my day lists the meetings and the tasks due', async () => {
    const w = world();
    optIn(w.store);
    w.reader.items.set(UID, [meeting('a', '2026-11-23T15:30:00Z', 30, { title: 'Weekly sync' })]);
    w.reader.tasks.set(UID, [task('t1'), task('t2', { dueDate: '2026-11-20', title: 'Old one' })]);
    const id = await sent(w, 'agenda', { date: '2026-11-23' });
    await handleTap(`wa_agenda:${id}`, PHONE, UID, 'en', tapDeps(w).deps);
    expect(w.sender.sent[0]!.body).toBe('Your day (Mon, Nov 23):\n\n*Weekly sync*\n\nTasks:\n- Send the signed proposal to Ana (due 16:00)\n- Old one (overdue)');
  });

  it('Debrief arms the next message for that meeting', async () => {
    const w = world();
    optIn(w.store);
    const id = await sent(w, 'debrief', { meetingId: 'm1', title: 'Weekly sync' });
    await handleTap(`wa_debrief:${id}`, PHONE, UID, 'en', tapDeps(w).deps);
    expect(w.sender.sent[0]!.body).toContain('Tell me what was agreed in "Weekly sync"');
    expect(await w.store.takeDebrief(PHONE, UID, NOW)).toMatchObject({ meetingId: 'm1' });
    expect(await w.store.takeDebrief(PHONE, UID, NOW)).toBeNull();
  });

  it('Commitments hands over to the typed flow', async () => {
    const w = world();
    optIn(w.store);
    const id = await sent(w, 'commitments', { summaryId: 's1' });
    expect(await handleTap(`wa_commit:${id}`, PHONE, UID, 'en', tapDeps(w).deps)).toEqual({ handled: true, commitments: true });
  });

  it('the day list cuts whole parts and says how many are left', () => {
    const text = renderDayList({
      date: '2026-11-23',
      zone: ZONE,
      language: 'en',
      meetingBlocks: ['a'.repeat(50), 'b'.repeat(50), 'c'.repeat(50)],
      tasks: [],
      texts: { header: 'Your day ({date}):', empty: 'none', tasksHeader: 'Tasks:', dueAt: 'due {time}', overdue: 'overdue', more: 'and {count} more in the app' },
      maxChars: 140,
    });
    expect(text.length).toBeLessThanOrEqual(140);
    expect(text).toContain('more in the app');
  });
});

describe('status webhooks', () => {
  const payload = {
    object: 'whatsapp_business_account',
    entry: [
      {
        changes: [
          { field: 'messages', value: { statuses: [{ id: 'wamid.1', status: 'delivered' }, { id: 'wamid.2', status: 'failed', errors: [{ code: 131026 }] }] } },
          { field: 'message_template_status_update', value: { event: 'APPROVED', message_template_name: 'mg_task_reminder_v1', message_template_language: 'es' } },
          { field: 'template_category_update', value: { new_category: 'MARKETING', message_template_name: 'mg_daily_agenda_v1', message_template_language: 'en' } },
        ],
      },
    ],
  };

  it('extracts delivery statuses and template updates', () => {
    expect(extractStatusEvents(payload)).toEqual({
      statuses: [
        { wamid: 'wamid.1', status: 'delivered', errorCode: null },
        { wamid: 'wamid.2', status: 'failed', errorCode: 131026 },
      ],
      templates: [
        { name: 'mg_task_reminder_v1', language: 'es', status: 'APPROVED' },
        { name: 'mg_daily_agenda_v1', language: 'en', category: 'MARKETING' },
      ],
    });
  });

  it('stores them; a category change stops the template at the gate', async () => {
    const store = new MemoryOutboundStore();
    await applyStatusEvents(payload, store, NOW);
    expect(await store.getTemplate('mg_task_reminder_v1', 'es')).toMatchObject({ status: 'APPROVED' });
    expect(await store.getTemplate('mg_daily_agenda_v1', 'en')).toMatchObject({ category: 'MARKETING' });
  });

  it('the hourly sync stores only our templates', async () => {
    const store = new MemoryOutboundStore();
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify({
          data: [
            { name: 'mg_task_reminder_v1', language: 'en', status: 'APPROVED', category: 'UTILITY', message_send_ttl_seconds: 3600 },
            { name: 'hello_world', language: 'en_US', status: 'APPROVED', category: 'UTILITY' },
          ],
        }),
        { status: 200 },
      )) as unknown as typeof fetch;
    expect(await syncTemplateStates(store, '123456789', 'tok', NOW, fetchImpl)).toBe(1);
    expect(await store.getTemplate('mg_task_reminder_v1', 'en')).toEqual({ status: 'APPROVED', category: 'UTILITY', ttlSeconds: 3600, updatedAt: NOW.toISOString() });
    expect(await syncTemplateStates(store, 'not-an-id', 'tok', NOW, fetchImpl)).toBe(0);
  });
});

describe('review fixes', () => {
  it('commitments keep a cursor, so summaries past the first 10 are still planned', async () => {
    const w = world();
    optIn(w.store);
    w.reader.pilot.add(UID);
    const summaries = Array.from({ length: 12 }, (_, i) => ({
      summaryId: `s${i}`,
      status: 'matched',
      receivedAt: `2026-11-21T${String(10 + i).padStart(2, '0')}:00:00.000Z`,
      meetingTitle: 'Sync',
      meetingDate: '2026-11-21',
      items: 2,
      handled: false,
    }));
    w.reader.summaries.set(UID, summaries);
    expect(await planCommitments((await w.store.listOptedIn(10))[0]!, w.deps)).toBe(10);
    expect(w.store.records.get(UID)!.commitmentsCursor).toBe('2026-11-21T19:00:00.000Z');
    expect(await planCommitments((await w.store.listOptedIn(10))[0]!, w.deps)).toBe(2);
  });

  it('Mark as done leaves the other tasks reminders queued', async () => {
    const w = world();
    optIn(w.store);
    w.reader.tasks.set(UID, [task('sm_1'), task('sm_2')]);
    await rebuildReminders(UID, { store: w.store, reader: w.reader, now: () => NOW });
    const first = [...w.store.sends.values()].find((s) => s.target.taskId === 'sm_1')!;
    w.store.sends.set(first.sendId, { ...first, status: 'sent', queuedDueAt: null, phone: PHONE, tapExpiresAt: '2099-01-01T00:00:00.000Z' });
    const tasks = { getTask: async () => undefined, createTask: async () => undefined, updateTaskFields: async () => undefined, deleteTask: async () => undefined, newTaskId: () => 't' };
    await handleTap(`wa_done:${first.sendId}`, PHONE, UID, 'en', { store: w.store, reader: w.reader, sender: w.sender, tasks, now: () => NOW });
    expect([...w.store.sends.values()].filter((s) => s.status === 'queued').map((s) => s.target.taskId)).toEqual(['sm_2']);
  });

  it('STOP on an account already stopped does nothing and asks for no reply', async () => {
    const w = world();
    optIn(w.store);
    expect(await applyStop(UID, w.store, NOW)).toBe(true);
    expect(await applyStop(UID, w.store, NOW)).toBe(false);
  });
});

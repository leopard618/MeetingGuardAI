/**
 * A3: scheduling (availability.ts, scheduling.ts and the booking in replies.ts), pause, resume and
 * change (manage.ts), questions (ask.ts), the timeline and the usage in matterView, end to end on
 * the in-memory fakes with a fake calendar.
 */
import { handleInboundEmail, handleMatterConfirm, handleMatterDraft, type MatterDeps } from '../../src/matters/handlers';
import { handleMatterAsk, handleMatterSpeak, matchMatters, plainAnswer } from '../../src/matters/ask';
import { allowedRanges, busyIntervals, fitSlot, freeSlots, offerSlots, searchBounds } from '../../src/matters/availability';
import { handleMatterChange, handleMatterSetStatus } from '../../src/matters/manage';
import { draftHash, type EmailAuth, type Mandate } from '../../src/matters/model';
import { BOOKED_MEETING_SOURCE, handleInboundRead, handleMatterDecide, handleMatterView, meetingIdFor, runMatterTick } from '../../src/matters/replies';
import { withoutSchedulingWords, type ProposalSpec } from '../../src/matters/read';
import { readRange, readRangeOf, resolvePick } from '../../src/matters/scheduling';
import { checkSend } from '../../src/matters/sendCheck';
import { offerTimesText } from '../../src/matters/text';
import { CALLER, DOMAIN, FakeCalendar, NOW, REQUEST, inboundPayload, makeDeps, proposal } from './mattersFakes';

jest.mock('firebase-functions/logger', () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const TRUSTED: EmailAuth = { verdict: 'trusted', fromAligned: true, spf: 'pass', arcTrusted: false, reason: null };
const UNVERIFIED: EmailAuth = { verdict: 'unverified', fromAligned: false, spf: 'none', arcTrusted: false, reason: 'no_aligned_signature' };
const HOUR = 3_600_000;
const ZONE = 'Europe/Madrid';
const meeting30: NonNullable<Mandate['meeting']> = { durationMinutes: 30, windows: [] };

type Ctx = Awaited<ReturnType<typeof activeMatter>>;

/** A confirmed matter with a 30 minute meeting, first email out at NOW (Thu 2026-11-12, 10:00 Madrid). */
async function activeMatter(overrides: Partial<MatterDeps> = {}, proposalOverrides: Record<string, unknown> = {}) {
  const clock = { now: NOW };
  let seq = 0;
  const calendar = new FakeCalendar();
  const ctx = makeDeps({ now: () => clock.now, random: () => `r${++seq}`, meetings: calendar, prices: { inPerM: 0.4, outPerM: 1.6 }, ...overrides });
  ctx.llm.queue.push(proposal({ ends_at: '2026-11-30T18:00', ...proposalOverrides }));
  const draft = await handleMatterDraft(CALLER, { text: REQUEST, source: 'text', language: 'en', timeZone: ZONE }, ctx.deps);
  await handleMatterConfirm(CALLER, { matterId: draft.matterId, draftHash: draft.draftHash }, ctx.deps);
  return { ...ctx, clock, calendar, draft, matterId: draft.matterId };
}

let providerSeq = 0;
async function reply(ctx: Ctx, text: string, auth: EmailAuth = TRUSTED, overrides: Record<string, unknown> = {}) {
  providerSeq += 1;
  await handleInboundEmail(inboundPayload({ MessageID: `a3-${providerSeq}`, StrippedTextReply: text, TextBody: text, ...overrides }), {
    store: ctx.store,
    now: ctx.deps.now,
    domain: DOMAIN,
    markerTtlDays: 7,
    checkSender: async () => auth,
  });
  return ctx.store.lastAddedId!;
}

const assess = (overrides: Record<string, unknown> = {}) => ({
  intent: 'asks_for_times',
  reason: 'none',
  quote: null,
  reply: null,
  commitments: [],
  time_words: null,
  offered_choice: null,
  ...overrides,
});

async function read(ctx: Ctx, messageId: string, answer: unknown) {
  ctx.llm.queue.push(answer);
  return handleInboundRead({ uid: 'u1', matterId: ctx.matterId, messageId }, ctx.deps);
}

const matter = (ctx: Ctx) => ctx.store.getMatter('u1', ctx.matterId);
const cards = (ctx: Ctx) => ctx.store.cardList('u1', ctx.matterId);
const pending = (ctx: Ctx) => cards(ctx).filter((c) => c.status === 'pending');
const meetings = (ctx: Ctx) => [...ctx.store.meetings.values()];

// Thursday 2026-11-12, Madrid (UTC+1). From 11:00 local the first offered time is 15:00 local (4 h lead).
const SLOT_THU = { start: '2026-11-12T14:00:00.000Z', end: '2026-11-12T14:30:00.000Z' };
const SLOT_FRI = { start: '2026-11-13T08:00:00.000Z', end: '2026-11-13T08:30:00.000Z' };
const SLOT_MON = { start: '2026-11-16T08:00:00.000Z', end: '2026-11-16T08:30:00.000Z' };

/** Offers times at NOW + 1 h (Thu 11:00 Madrid) and sends them (automatic scheduling). */
async function offered(ctx: Ctx) {
  ctx.clock.now = new Date(NOW.getTime() + HOUR);
  const id = await reply(ctx, 'When would suit Ana for a call?');
  await read(ctx, id, assess());
  return id;
}

describe('availability (pure)', () => {
  const from = Date.parse('2026-11-12T13:00:00.000Z');
  const to = Date.parse('2026-11-20T23:00:00.000Z');

  it('reads one-off, recurring, cancelled, moved, all-day and deleted meetings', () => {
    const calendar = new FakeCalendar()
      .add('2026-11-13T08:00:00.000Z', 60)
      .add('2026-11-13T12:00:00.000Z', 60, { deletedAt: '2026-11-01T00:00:00.000Z' })
      .add('2026-11-13T13:00:00.000Z', 60, { status: 'cancelled' })
      .add('2026-11-14T00:00:00.000Z', 1440, { allDay: true })
      // every Monday 11:00 Madrid since October (09:00 UTC in summer time); the Nov 16 one is cancelled
      .add('2026-10-05T09:00:00.000Z', 30, {
        recurrence: { freq: 'weekly', interval: 1, byWeekday: ['MO'], byMonthDay: null, until: null, count: null },
        recurrenceOverrides: { '2026-11-16': { status: 'cancelled', startAt: null } },
      });
    const busy = busyIntervals(calendar.records, from, to);
    expect(busy.map((b) => new Date(b.start).toISOString())).toEqual(['2026-11-13T08:00:00.000Z']);
    // the cancellation removed the only Monday in range; the next one keeps 11:00 local after the
    // change to winter time (10:00 UTC)
    const later = busyIntervals(calendar.records, from, Date.parse('2026-11-24T00:00:00.000Z'));
    expect(later.map((b) => new Date(b.start).toISOString())).toContain('2026-11-23T10:00:00.000Z');
  });

  it('allows working hours on working days without windows, whole named days within working hours, timed windows as given', () => {
    const plain = allowedRanges(meeting30, ZONE, from, Date.parse('2026-11-16T23:00:00.000Z'));
    // Thu (from 14:00 local), Fri, Mon: never the weekend
    expect(plain.map((r) => new Date(r.start).toISOString())).toEqual(['2026-11-12T13:00:00.000Z', '2026-11-13T08:00:00.000Z', '2026-11-16T08:00:00.000Z']);
    const saturday = allowedRanges({ durationMinutes: 30, windows: [{ start: '2026-11-14T00:00:00+01:00', end: '2026-11-15T00:00:00+01:00' }] }, ZONE, from, to);
    expect(saturday).toEqual([{ start: Date.parse('2026-11-14T08:00:00.000Z'), end: Date.parse('2026-11-14T17:00:00.000Z') }]);
    const evening = allowedRanges({ durationMinutes: 30, windows: [{ start: '2026-11-17T19:00:00+01:00', end: '2026-11-17T21:00:00+01:00' }] }, ZONE, from, to);
    expect(evening).toEqual([{ start: Date.parse('2026-11-17T18:00:00.000Z'), end: Date.parse('2026-11-17T20:00:00.000Z') }]);
  });

  it('keeps working hours across the daylight saving change (9:00 local stays 9:00)', () => {
    // Madrid leaves summer time on Sunday 2026-10-25
    const ranges = allowedRanges(meeting30, ZONE, Date.parse('2026-10-23T00:00:00.000Z'), Date.parse('2026-10-26T23:00:00.000Z'));
    expect(ranges.map((r) => new Date(r.start).toISOString())).toEqual(['2026-10-23T07:00:00.000Z', '2026-10-26T08:00:00.000Z']);
  });

  it('offers at most one free time a day, keeping a buffer around busy meetings', () => {
    const allowed = allowedRanges(meeting30, ZONE, from, to);
    const busy = busyIntervals(new FakeCalendar().add('2026-11-13T08:00:00.000Z', 60).records, from, to);
    const slots = freeSlots({ busy, allowed, durationMinutes: 30, zone: ZONE, count: 3 });
    // Fri: 9:00 to 10:00 busy, 15 min buffer, so 10:30 local
    expect(slots).toEqual([
      { start: '2026-11-12T13:00:00.000Z', end: '2026-11-12T13:30:00.000Z' },
      { start: '2026-11-13T09:30:00.000Z', end: '2026-11-13T10:00:00.000Z' },
      { start: '2026-11-16T08:00:00.000Z', end: '2026-11-16T08:30:00.000Z' },
    ]);
  });

  it('says why a time cannot be booked', () => {
    const { fromMs } = searchBounds(new Date('2026-11-12T10:00:00.000Z'), '2026-11-20T17:00:00.000Z');
    const allowed = allowedRanges(meeting30, ZONE, fromMs, Date.parse('2026-11-20T17:00:00.000Z'));
    const busy = busyIntervals(new FakeCalendar().add('2026-11-13T08:00:00.000Z', 60).records, fromMs, Date.parse('2026-11-21T00:00:00.000Z'));
    const fit = (start: string, minutes = 30) => fitSlot({ start, end: new Date(Date.parse(start) + minutes * 60_000).toISOString() }, { busy, allowed, fromMs, endsAtMs: Date.parse('2026-11-20T17:00:00.000Z') });
    expect(fit('2026-11-16T08:00:00.000Z')).toBe('ok');
    expect(fit('2026-11-13T08:30:00.000Z')).toBe('slot_busy');
    expect(fit('2026-11-13T09:05:00.000Z')).toBe('slot_busy'); // inside the buffer
    expect(fit('2026-11-16T02:00:00.000Z')).toBe('outside_windows'); // 3:00 at night
    expect(fit('2026-11-14T10:00:00.000Z')).toBe('outside_windows'); // a Saturday
    expect(fit('2026-11-12T11:00:00.000Z')).toBe('outside_windows'); // sooner than the lead time
    expect(fit('2026-11-23T09:00:00.000Z')).toBe('after_end');
  });
});

describe('resolvePick (code reads the time)', () => {
  const offeredSlots = [SLOT_THU, SLOT_FRI, SLOT_MON];
  const pick = (words: string | null, choice: number | null = null) =>
    resolvePick({ words, choice, offered: offeredSlots, emailAt: '2026-11-12T11:00:00.000Z', zone: ZONE, durationMinutes: 30 });

  it('takes an offered time by its number, unless the words name another day or clock time', () => {
    expect(pick('The second one works', 2)).toEqual(SLOT_FRI);
    expect(pick(null, 3)).toEqual(SLOT_MON);
    expect(pick('Friday at 9:00 AM is fine', 2)).toEqual(SLOT_FRI);
    expect(pick('how about Friday at 4 pm', 1)).toBeNull();
    expect(pick('the fourth', 4)).toBeNull();
  });

  it('reads one date and one clock time in English or Spanish, and nothing less', () => {
    expect(pick('Tuesday at 10:00 AM')).toEqual({ start: '2026-11-17T09:00:00.000Z', end: '2026-11-17T09:30:00.000Z' });
    expect(pick('el martes a las 10:00')).toEqual({ start: '2026-11-17T09:00:00.000Z', end: '2026-11-17T09:30:00.000Z' });
    expect(pick('Friday 9:00')).toEqual(SLOT_FRI);
    expect(pick('Tuesday or Wednesday at 10:00')).toBeNull();
    expect(pick('Tuesday at 10')).toBeNull();
    expect(pick('in the morning')).toBeNull();
    expect(pick('every day at 10:00')).toBeNull();
  });
});

describe('the read-back and the confirmed hash', () => {
  it('says the assistant books automatically only when MATTERS_AUTO_SCHEDULE is on, and puts it in the hash', async () => {
    const ask = await activeMatter();
    const auto = await activeMatter({ autoSchedule: true });
    expect(ask.draft.readBack).toContain('I ask you before booking it.');
    expect(auto.draft.readBack).toContain('When they pick a free time, I book it in your calendar and send the confirmation.');
    const doc = (await matter(auto))!;
    expect(doc.scheduling).toBe('auto');
    expect(doc.confirmedHash).toBe(draftHash(doc.mandate!, doc.firstEmail!, 'auto'));
    expect(draftHash(doc.mandate!, doc.firstEmail!, 'auto')).not.toBe(draftHash(doc.mandate!, doc.firstEmail!));
    // matters confirmed before A3 keep their hash
    expect(draftHash(doc.mandate!, doc.firstEmail!, 'ask')).toBe(draftHash(doc.mandate!, doc.firstEmail!));
    expect(checkSend({ matter: doc, to: ['carlos@example.com'], cc: [], now: NOW, enabled: true, domain: DOMAIN })).toEqual({ ok: true });
  });

  it('never books automatically without a meeting in the mandate', async () => {
    const ctx = await activeMatter({ autoSchedule: true }, { meeting: { needed: false, duration_minutes: null, windows: [] } });
    expect((await matter(ctx))!.scheduling).toBe('ask');
    const id = await reply(ctx, 'Shall we meet on Tuesday at 10:00?');
    await read(ctx, id, assess({ intent: 'picks_time', quote: 'Shall we meet on Tuesday at 10:00?', time_words: 'Tuesday at 10:00' }));
    expect(pending(ctx)).toEqual([expect.objectContaining({ kind: 'time_proposal', reason: 'no_meeting' })]);
    expect(meetings(ctx)).toHaveLength(0);
  });
});

describe('offering free times', () => {
  it('ask mode: the offer is a reply draft with the numbered times, sent only on approval, then they are the offered times', async () => {
    const ctx = await activeMatter();
    ctx.calendar.add('2026-11-13T07:30:00.000Z', 90); // Fri 8:30 to 10:00 local
    await offered(ctx);
    const [card] = pending(ctx);
    expect(card).toMatchObject({ kind: 'reply_draft', reason: 'auto_reply_off', offers: [SLOT_THU, { start: '2026-11-13T09:30:00.000Z', end: '2026-11-13T10:00:00.000Z' }, SLOT_MON] });
    expect(card!.draft!.text).toContain('1. Thu, Nov 12, 3:00 PM\n2. Fri, Nov 13, 10:30 AM\n3. Mon, Nov 16, 9:00 AM');
    expect(card!.draft!.text).toContain('(Europe/Madrid time)');
    expect((await matter(ctx))!.offeredSlots).toEqual([]);
    expect(ctx.store.eventTypes('u1', ctx.matterId)).toContain('times_offered');
    await handleMatterDecide(CALLER, { matterId: ctx.matterId, target: 'approval', id: card!.id, action: 'approve', draftHash: card!.draftHash! }, ctx.deps);
    expect((await matter(ctx))!.offeredSlots).toHaveLength(3);
    expect(ctx.sender.sent).toHaveLength(2);
  });

  it('auto mode: a trusted contact gets the times at once; an unverified one gets them only on approval', async () => {
    const ctx = await activeMatter({ autoSchedule: true });
    await offered(ctx);
    expect(ctx.sender.sent).toHaveLength(2);
    expect((await matter(ctx))!.offeredSlots).toEqual([SLOT_THU, SLOT_FRI, SLOT_MON]);
    const other = await activeMatter({ autoSchedule: true });
    other.clock.now = new Date(NOW.getTime() + HOUR);
    await read(other, await reply(other, 'When is Ana free?', UNVERIFIED), assess());
    expect(other.sender.sent).toHaveLength(1);
    expect(pending(other)).toEqual([expect.objectContaining({ kind: 'reply_draft', reason: 'unverified_sender' })]);
  });

  it('a full calendar is a card, never an empty offer', async () => {
    const ctx = await activeMatter({ autoSchedule: true }, { ends_at: '2026-11-13T18:00' });
    ctx.calendar.add('2026-11-12T13:00:00.000Z', 240).add('2026-11-13T07:00:00.000Z', 600);
    await offered(ctx);
    expect(pending(ctx)).toEqual([expect.objectContaining({ kind: 'time_proposal', reason: 'no_free_time' })]);
    expect(ctx.sender.sent).toHaveLength(1);
  });
});

describe('booking', () => {
  async function picked(ctx: Ctx, words = 'The second one works for me.', choice: number | null = 2, auth: EmailAuth = TRUSTED) {
    ctx.clock.now = new Date(NOW.getTime() + 2 * HOUR);
    const id = await reply(ctx, words, auth);
    await read(ctx, id, assess({ intent: 'picks_time', quote: words, time_words: words.replace(/\.$/, ''), offered_choice: choice }));
    return id;
  }

  it('auto mode: books the picked time once, pushes it to the calendars, confirms once and stops following up', async () => {
    const ctx = await activeMatter({ autoSchedule: true });
    await offered(ctx);
    await picked(ctx);
    const meetingId = meetingIdFor(ctx.matterId);
    expect(ctx.store.meetings.get(`u1/${meetingId}`)).toMatchObject({
      userId: 'u1',
      startAt: SLOT_FRI.start,
      durationMinutes: 30,
      timezone: ZONE,
      date: '2026-11-13',
      time: '09:00',
      participants: [{ email: 'carlos@example.com', name: 'Carlos Ruiz', status: null }],
      source: BOOKED_MEETING_SOURCE,
      status: 'scheduled',
      pushPending: true,
      deletedAt: null,
    });
    const doc = (await matter(ctx))!;
    expect(doc.booking).toMatchObject({ meetingId, start: SLOT_FRI.start, end: SLOT_FRI.end, by: 'auto' });
    const confirmation = ctx.sender.sent[2]!;
    expect(confirmation.to).toEqual(['carlos@example.com']);
    expect(confirmation.text).toContain('The meeting is confirmed: Fri, Nov 13, 9:00 AM to 9:30 AM (Europe/Madrid time).');
    expect(confirmation.inReplyTo).toBe('<CAF=abc123@mail.gmail.com>');
    expect(pending(ctx).map((c) => c.kind)).toEqual(['goal_reached']);
    // no follow-up after the booking: the next look is the end date
    expect(ctx.store.schedules.get(ctx.matterId)!.nextActionAt).toBe(new Date(Date.parse(doc.mandate!.endsAt)).toISOString());
    ctx.clock.now = new Date(NOW.getTime() + 5 * 24 * HOUR);
    await runMatterTick(ctx.deps);
    expect(ctx.sender.sent).toHaveLength(3);
    expect(ctx.store.eventTypes('u1', ctx.matterId)).toEqual(expect.arrayContaining(['times_offered', 'meeting_booked']));
  });

  it('a second pick never books a second meeting nor sends a second confirmation', async () => {
    const ctx = await activeMatter({ autoSchedule: true });
    await offered(ctx);
    await picked(ctx);
    await picked(ctx, 'Actually the first one is better.', 1);
    expect(ctx.store.meetings.size).toBe(1);
    expect(ctx.sender.sent).toHaveLength(3);
    // the booking cleared the offered times, so "the first one" names nothing: a card for the owner
    expect(pending(ctx)).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'time_proposal', reason: 'unclear_time' })]));
    await picked(ctx, 'Or Monday at 9:00 AM?', null);
    expect(pending(ctx)).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'time_proposal', reason: 'other', slot: SLOT_MON })]));
    expect(ctx.store.meetings.size).toBe(1);
    expect(ctx.sender.sent).toHaveLength(3);
  });

  it('a busy time, a time at night or after the end date is a card with the time; nothing is booked', async () => {
    const ctx = await activeMatter({ autoSchedule: true });
    await offered(ctx);
    ctx.calendar.add('2026-11-13T08:00:00.000Z', 30);
    await picked(ctx);
    await picked(ctx, 'Monday at 3:00 AM', null);
    await picked(ctx, 'Dec 3 at 10:00', null);
    expect(pending(ctx).map((c) => [c.kind, c.reason])).toEqual([
      ['time_proposal', 'slot_busy'],
      ['time_proposal', 'outside_windows'],
      ['time_proposal', 'after_end'],
    ]);
    expect(pending(ctx)[0]!.slot).toEqual(SLOT_FRI);
    expect(ctx.store.meetings.size).toBe(0);
  });

  it('words the code cannot read as one time are a card, whatever the model says', async () => {
    const ctx = await activeMatter({ autoSchedule: true });
    await offered(ctx);
    await picked(ctx, 'Book it every day at 10:00 please.', null);
    await picked(ctx, 'None of these, how about Friday at 4 pm?', 1);
    expect(pending(ctx).map((c) => c.reason)).toEqual(['unclear_time', 'unclear_time']);
    expect(ctx.store.meetings.size).toBe(0);
  });

  it('an unverified sender, or ask mode, gives a card the owner books with one tap', async () => {
    const ctx = await activeMatter({ autoSchedule: true });
    await offered(ctx);
    await picked(ctx, 'The second one works for me.', 2, UNVERIFIED);
    const [card] = pending(ctx);
    expect(card).toMatchObject({ kind: 'time_proposal', reason: 'unverified_sender', slot: SLOT_FRI });
    expect(ctx.store.meetings.size).toBe(0);
    await expect(handleMatterDecide(CALLER, { matterId: ctx.matterId, target: 'approval', id: card!.id, action: 'approve' }, ctx.deps)).resolves.toMatchObject({ status: 'approved' });
    expect((await matter(ctx))!.booking).toMatchObject({ by: 'owner', start: SLOT_FRI.start });
    expect(ctx.sender.sent).toHaveLength(3);
    // approving again changes nothing
    await handleMatterDecide(CALLER, { matterId: ctx.matterId, target: 'approval', id: card!.id, action: 'approve' }, ctx.deps);
    expect(ctx.store.meetings.size).toBe(1);
    expect(ctx.sender.sent).toHaveLength(3);
  });

  it('re-checks the calendar right before booking: a time taken since the card is never booked', async () => {
    const ctx = await activeMatter();
    await offered(ctx);
    const [offer] = pending(ctx);
    await handleMatterDecide(CALLER, { matterId: ctx.matterId, target: 'approval', id: offer!.id, action: 'approve', draftHash: offer!.draftHash! }, ctx.deps);
    await picked(ctx);
    const [card] = pending(ctx);
    expect(card).toMatchObject({ kind: 'time_proposal', reason: 'ask_before_booking', slot: SLOT_FRI });
    ctx.calendar.add('2026-11-13T08:15:00.000Z', 30);
    await expect(handleMatterDecide(CALLER, { matterId: ctx.matterId, target: 'approval', id: card!.id, action: 'approve' }, ctx.deps)).rejects.toMatchObject({ details: { reason: 'not_allowed' } });
    expect(ctx.store.meetings.size).toBe(0);
    expect(pending(ctx)[0]).toMatchObject({ id: card!.id, status: 'pending' });
  });

  it('links the accepted commitments to the booked meeting, and later ones too', async () => {
    const ctx = await activeMatter({ autoSchedule: true });
    await offered(ctx);
    ctx.clock.now = new Date(NOW.getTime() + 90 * 60_000);
    const id = await reply(ctx, 'I will send the updated proposal tomorrow.');
    await read(ctx, id, assess({ intent: 'nothing_to_do', commitments: [{ title: 'Send the updated proposal', quote: 'I will send the updated proposal tomorrow.', owner: 'contact', due: 'tomorrow' }] }));
    const [first] = ctx.store.proposalList('u1', ctx.matterId);
    await handleMatterDecide(CALLER, { matterId: ctx.matterId, target: 'proposal', id: first!.id, action: 'accept' }, ctx.deps);
    await picked(ctx);
    const meetingId = meetingIdFor(ctx.matterId);
    expect(ctx.store.tasks.get(`u1/${first!.id}`)).toMatchObject({ meetingId });
  });

  it('the owner forging a pick from their own address books nothing', async () => {
    const ctx = await activeMatter({ autoSchedule: true });
    await offered(ctx);
    ctx.clock.now = new Date(NOW.getTime() + 2 * HOUR);
    const id = await reply(ctx, 'The second one works.', TRUSTED, { From: 'ana@example.com', FromFull: { Email: 'ana@example.com', Name: 'Ana', MailboxHash: '' }, FromName: 'Ana' });
    await expect(handleInboundRead({ uid: 'u1', matterId: ctx.matterId, messageId: id }, ctx.deps)).resolves.toBe('owner');
    expect(ctx.store.meetings.size).toBe(0);
  });
});

describe('when the contact says when (device test fixes)', () => {
  const at = '2026-11-12T10:00:00.000Z'; // Thursday, Madrid

  it('reads a week, a day or days, and a part of the day, in English and Spanish', () => {
    const week = (from: string) => Array.from({ length: 7 }, (_, i) => new Date(Date.parse(`${from}T12:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10));
    expect(readRange('Sometime next week', at, ZONE)).toEqual({ dates: week('2026-11-16'), part: null });
    expect(readRange('la semana que viene por la tarde', at, ZONE)).toEqual({ dates: week('2026-11-16'), part: 'afternoon' });
    expect(readRange('esta semana', at, ZONE)).toEqual({ dates: ['2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15'], part: null });
    expect(readRange('mañana por la mañana', at, ZONE)).toEqual({ dates: ['2026-11-13'], part: 'morning' });
    expect(readRange('Tuesday or Wednesday', at, ZONE)).toEqual({ dates: ['2026-11-17', '2026-11-18'], part: null });
    expect(readRange('any morning', at, ZONE)).toEqual({ dates: null, part: 'morning' });
    expect(readRange('What times work for you?', at, ZONE)).toBeNull();
    expect(readRange(null, at, ZONE)).toBeNull();
  });

  it('reads the time words and the whole sentence together', () => {
    const week = Array.from({ length: 7 }, (_, i) => `2026-11-${16 + i}`);
    expect(readRangeOf(['next week', 'Any afternoon next week?'], at, ZONE)).toEqual({ dates: week, part: 'afternoon' });
    expect(readRangeOf([null, 'Tuesday morning?'], at, ZONE)).toEqual({ dates: ['2026-11-17'], part: 'morning' });
    expect(readRangeOf([null, null], at, ZONE)).toBeNull();
  });

  it('"Any afternoon next week?" with the time words "next week" only: afternoons next week', async () => {
    const ctx = await activeMatter({ autoSchedule: true });
    ctx.clock.now = new Date(NOW.getTime() + HOUR);
    const words = 'Any afternoon next week?';
    await read(ctx, await reply(ctx, words), assess({ quote: words, time_words: 'next week' }));
    expect((await matter(ctx))!.offeredSlots).toEqual([
      { start: '2026-11-16T11:00:00.000Z', end: '2026-11-16T11:30:00.000Z' },
      { start: '2026-11-17T11:00:00.000Z', end: '2026-11-17T11:30:00.000Z' },
      { start: '2026-11-18T11:00:00.000Z', end: '2026-11-18T11:30:00.000Z' },
    ]);
  });

  it('"Sometime next week is fine": times next week only, and no task made of it', async () => {
    const ctx = await activeMatter({ autoSchedule: true });
    ctx.clock.now = new Date(NOW.getTime() + HOUR);
    const id = await reply(ctx, 'Sometime next week is fine');
    // the model's answer from the device test: the time in the quote only, and a "commitment"
    await read(ctx, id, assess({ quote: 'Sometime next week is fine', commitments: [{ title: 'Sometime next week is fine', quote: 'Sometime next week is fine', owner: 'contact', due: 'Sometime next week' }] }));
    expect((await matter(ctx))!.offeredSlots).toEqual([
      SLOT_MON,
      { start: '2026-11-17T08:00:00.000Z', end: '2026-11-17T08:30:00.000Z' },
      { start: '2026-11-18T08:00:00.000Z', end: '2026-11-18T08:30:00.000Z' },
    ]);
    expect(ctx.sender.sent[1]!.text).toContain('These times work');
    expect(ctx.store.proposalList('u1', ctx.matterId)).toEqual([]);
    expect(ctx.store.eventTypes('u1', ctx.matterId)).not.toContain('commitment_proposed');
  });

  it('afternoons this week; a day with no free time gets the nearest times, and says so', async () => {
    const ctx = await activeMatter({ autoSchedule: true });
    ctx.clock.now = new Date(NOW.getTime() + HOUR);
    await read(ctx, await reply(ctx, 'Any afternoon this week?'), assess({ quote: 'Any afternoon this week?', time_words: 'Any afternoon this week' }));
    expect((await matter(ctx))!.offeredSlots).toEqual([SLOT_THU, { start: '2026-11-13T11:00:00.000Z', end: '2026-11-13T11:30:00.000Z' }]);

    const other = await activeMatter({ autoSchedule: true });
    other.clock.now = new Date(NOW.getTime() + HOUR);
    await read(other, await reply(other, 'Can we do Saturday?'), assess({ quote: 'Can we do Saturday?', time_words: 'Saturday' }));
    expect((await matter(other))!.offeredSlots).toEqual([SLOT_THU, SLOT_FRI, SLOT_MON]);
    expect(other.sender.sent[1]!.text).toContain('no free time then, so these are the nearest free times for a 30 minute meeting (Europe/Madrid time):');
  });

  it('a named day without a clock time gets a choice of times that day', async () => {
    const ctx = await activeMatter({ autoSchedule: true });
    await offered(ctx);
    ctx.clock.now = new Date(NOW.getTime() + 2 * HOUR);
    await read(ctx, await reply(ctx, 'Tuesday works for me.'), assess({ intent: 'picks_time', quote: 'Tuesday works for me.', time_words: 'Tuesday' }));
    expect(ctx.store.meetings.size).toBe(0);
    expect((await matter(ctx))!.offeredSlots).toEqual([
      { start: '2026-11-17T08:00:00.000Z', end: '2026-11-17T08:30:00.000Z' },
      { start: '2026-11-17T10:00:00.000Z', end: '2026-11-17T10:30:00.000Z' },
      { start: '2026-11-17T12:00:00.000Z', end: '2026-11-17T12:30:00.000Z' },
    ]);
  });

  it('"How about Saturday at 11:00?" labelled outside the mandate is still read as a time: a card the owner books', async () => {
    const ctx = await activeMatter({ autoSchedule: true });
    await offered(ctx);
    ctx.clock.now = new Date(NOW.getTime() + 2 * HOUR);
    const words = 'How about Saturday November 14 at 11:00?';
    await read(ctx, await reply(ctx, words), assess({ intent: 'outside_mandate', reason: 'time_proposal', quote: words }));
    const [card] = pending(ctx);
    expect(card).toMatchObject({ kind: 'time_proposal', reason: 'outside_windows', slot: { start: '2026-11-14T10:00:00.000Z', end: '2026-11-14T10:30:00.000Z' } });
    expect(ctx.store.meetings.size).toBe(0);
    await handleMatterDecide(CALLER, { matterId: ctx.matterId, target: 'approval', id: card!.id, action: 'approve' }, ctx.deps);
    expect((await matter(ctx))!.booking).toMatchObject({ start: '2026-11-14T10:00:00.000Z', by: 'owner' });
    expect(ctx.store.meetings.size).toBe(1);
  });

  it('keeps a real promise next to a time, and drops a "promise" that is only the time', () => {
    const spec = (quote: string, due: string | null): ProposalSpec => ({
      quote,
      title: quote,
      owner: { name: 'Carlos', isUser: false, guess: false },
      due: due ? { date: '2026-11-17', time: null, zone: null, quote: due, overdue: false } : null,
    });
    const promise = spec('I will send the proposal on Friday.', 'on Friday');
    expect(withoutSchedulingWords([promise, spec('Tuesday at 10 works.', 'Tuesday')], ['Tuesday at 10 works.', 'Tuesday at 10'])).toEqual([promise]);
    expect(withoutSchedulingWords([spec('I will send it, and Tuesday at 10 works.', 'Tuesday')], [null, 'Tuesday at 10'])).toEqual([]);
    expect(withoutSchedulingWords([promise], [null, null])).toEqual([promise]);
  });

  it('says in Spanish too that the times are the nearest ones', () => {
    const text = offerTimesText({ contactName: 'Lucía Pérez', ownerName: 'Ana', slots: [SLOT_FRI], durationMinutes: 30, timeZone: ZONE, language: 'es', nearest: true });
    expect(text).toContain('Ana no tiene horas libres en ese momento, así que estas son las más cercanas para una reunión de 30 minutos (hora de Europe/Madrid):');
    expect(offerTimesText({ contactName: 'Lucía', ownerName: '', slots: [SLOT_FRI], durationMinutes: 30, timeZone: ZONE, language: 'en', nearest: true })).toContain(
      'Thank you. There is no free time then, so these are the nearest free times for a 30 minute meeting (Europe/Madrid time):',
    );
  });

  it('a range past the end date gets the nearest free times before it', () => {
    const fromMs = Date.parse('2026-11-12T14:00:00.000Z');
    const toMs = Date.parse('2026-11-13T17:00:00.000Z');
    const allowed = allowedRanges(meeting30, ZONE, fromMs, toMs);
    const result = offerSlots({ busy: [], allowed, durationMinutes: 30, zone: ZONE, count: 3, range: { dates: ['2026-11-20'], part: null }, fromMs, toMs });
    expect(result).toEqual({ slots: [SLOT_THU, SLOT_FRI], nearest: true });
  });
});

describe('pause, resume and change', () => {
  it('pause stops the schedule and every send; resume counts the interval from the resume', async () => {
    const ctx = await activeMatter();
    await expect(handleMatterSetStatus(CALLER, { matterId: ctx.matterId, action: 'pause' }, ctx.deps)).resolves.toEqual({ matterId: ctx.matterId, status: 'paused' });
    expect(ctx.store.schedules.has(ctx.matterId)).toBe(false);
    expect(checkSend({ matter: (await matter(ctx))!, to: ['carlos@example.com'], cc: [], now: NOW, enabled: true, domain: DOMAIN, requireFirstSent: true })).toEqual({ ok: false, reason: 'not_active' });
    // five days later: the follow-up (every 2 days) was due long ago, but it never chases at once
    ctx.clock.now = new Date(NOW.getTime() + 5 * 24 * HOUR);
    await expect(handleMatterSetStatus(CALLER, { matterId: ctx.matterId, action: 'resume' }, ctx.deps)).resolves.toMatchObject({ status: 'active' });
    expect(ctx.store.schedules.get(ctx.matterId)!.nextActionAt).toBe(new Date(ctx.clock.now.getTime() + 2 * 24 * HOUR).toISOString());
    await runMatterTick(ctx.deps);
    expect(ctx.sender.sent).toHaveLength(1);
    expect(ctx.store.eventTypes('u1', ctx.matterId)).toEqual(expect.arrayContaining(['paused', 'resumed']));
  });

  it('a matter resumed after its end date closes; pausing never needs the tester list, resuming does', async () => {
    const ctx = await activeMatter();
    await handleMatterSetStatus(CALLER, { matterId: ctx.matterId, action: 'pause' }, { ...ctx.deps, allowed: () => false });
    await expect(handleMatterSetStatus(CALLER, { matterId: ctx.matterId, action: 'resume' }, { ...ctx.deps, allowed: () => false })).rejects.toMatchObject({ details: { reason: 'not_configured' } });
    ctx.clock.now = new Date('2026-12-01T00:00:00.000Z');
    await expect(handleMatterSetStatus(CALLER, { matterId: ctx.matterId, action: 'resume' }, ctx.deps)).resolves.toMatchObject({ status: 'done' });
    expect((await matter(ctx))!.stopReason).toBe('ended');
  });

  it('a change is drafted and read back, and is in force only after its own confirmation', async () => {
    const ctx = await activeMatter();
    const before = (await matter(ctx))!;
    ctx.llm.queue.push(proposal({ ends_at: '2026-12-04T18:00' }));
    const change = await handleMatterChange(CALLER, { matterId: ctx.matterId, text: 'Move the deadline to Friday December 4.' }, ctx.deps);
    expect(change).toMatchObject({ status: 'active', firstEmail: null, questions: [] });
    expect(change.readBack).toContain('Dec 4');
    expect(change.draftHash).toMatch(/^[a-f0-9]{64}$/);
    expect((await matter(ctx))!.mandate!.endsAt).toBe(before.mandate!.endsAt);
    await expect(handleMatterChange(CALLER, { matterId: ctx.matterId, draftHash: 'a'.repeat(64) }, ctx.deps)).rejects.toMatchObject({ details: { reason: 'stale_draft' } });
    const applied = await handleMatterChange(CALLER, { matterId: ctx.matterId, draftHash: change.draftHash! }, ctx.deps);
    expect(applied.draftHash).toBeNull();
    const after = (await matter(ctx))!;
    expect(Date.parse(after.mandate!.endsAt)).toBe(Date.parse('2026-12-04T18:00:00+01:00'));
    expect(after.confirmedHash).toBe(draftHash(after.mandate!, after.firstEmail!, after.scheduling));
    expect(after.pendingChange).toBeNull();
    expect(checkSend({ matter: after, to: ['carlos@example.com'], cc: [], now: ctx.clock.now, enabled: true, domain: DOMAIN, requireFirstSent: true })).toEqual({ ok: true });
    expect(ctx.store.eventTypes('u1', ctx.matterId)).toEqual(expect.arrayContaining(['change_drafted', 'mandate_changed']));
  });

  it('a change that adds a person is refused with a question (a new person is a new matter)', async () => {
    const ctx = await activeMatter();
    ctx.llm.queue.push(proposal({ contacts: [{ name: 'Carlos Ruiz', email: 'carlos@example.com' }, { name: 'Maria', email: 'maria@example.com' }] }));
    const change = await handleMatterChange(CALLER, { matterId: ctx.matterId, text: 'Also email Maria at maria@example.com.' }, ctx.deps);
    expect(change.draftHash).toBeNull();
    expect(change.questions).toEqual(['A change keeps the same people. To write to someone new, start a new matter.']);
  });
});

describe('matterAsk', () => {
  const ask = (ctx: Ctx, text: string, answer: unknown, extra: Record<string, unknown> = {}) => {
    if (answer !== undefined) ctx.llm.queue.push(answer);
    return handleMatterAsk(CALLER, { text, language: 'en', ...extra }, ctx.deps);
  };

  it('answers a status question from the matter records, and counts the call on the matter', async () => {
    const ctx = await activeMatter();
    const before = (await matter(ctx))!.usage.modelCalls;
    const answer = await ask(ctx, 'What is happening with Carlos?', { intent: 'status', matter_ref: 'm1', answer: 'I wrote to Carlos \u2014 no reply yet.' });
    expect(answer).toEqual({ intent: 'status', matterId: ctx.matterId, title: 'Proposal from Carlos', answer: 'I wrote to Carlos - no reply yet.' });
    const request = ctx.llm.requests.at(-1)!;
    expect(request.tools[0]!.function.name).toBe('answer_question');
    expect(JSON.stringify(request.messages)).toContain('Timeline, newest first');
    expect((await matter(ctx))!.usage.modelCalls).toBe(before + 1);
  });

  it('never acts: an action is a confirmation question written by code', async () => {
    const ctx = await activeMatter();
    await expect(ask(ctx, 'Pause the Carlos matter', { intent: 'pause', matter_ref: 'm1', answer: 'Done, paused!' })).resolves.toMatchObject({
      intent: 'pause',
      answer: 'Pause "Proposal from Carlos"? Nothing is sent while it is paused.',
    });
    expect((await matter(ctx))!.status).toBe('active');
    await expect(ask(ctx, 'Resume it', { intent: 'resume', matter_ref: 'm1', answer: '' })).resolves.toMatchObject({ intent: 'status', answer: '"Proposal from Carlos" is not paused.' });
  });

  it('asks which matter when several could fit, and answers from code when the model fails', async () => {
    const ctx = await activeMatter();
    ctx.llm.queue.push(proposal({ title: 'Invoice from Lucia', contacts: [{ name: 'Lucia Gomez', email: 'lucia@example.com' }] }));
    const second = await handleMatterDraft(CALLER, { text: 'Ask Lucia Gomez (lucia@example.com) for the invoice and set up a meeting, until the end of the month.', source: 'text', language: 'en', timeZone: ZONE }, ctx.deps);
    await handleMatterConfirm(CALLER, { matterId: second.matterId, draftHash: second.draftHash }, ctx.deps);
    const which = await ask(ctx, 'Any news?', { intent: 'status', matter_ref: null, answer: 'Something' });
    expect(which).toMatchObject({ intent: 'unclear', matterId: null });
    expect(which.answer).toContain('"Proposal from Carlos"');
    ctx.llm.queue.push(new Error('boom'));
    const fallback = await ask(ctx, 'What about Lucia?', undefined);
    expect(fallback).toMatchObject({ intent: 'status', matterId: second.matterId });
    expect(fallback.answer).toContain('"Invoice from Lucia" is running.');
  });

  it('matches matters by contact name or title words in code', () => {
    const doc = (title: string, name: string) => ({ title, mandate: { contacts: [{ name, email: 'x@example.com' }] } }) as never;
    const listed = [
      { ref: 'm1', id: 'a', doc: doc('Proposal from Carlos', 'Carlos Ruiz') },
      { ref: 'm2', id: 'b', doc: doc('Invoice reminder', 'Lucía Gómez') },
    ];
    expect(matchMatters('what about lucia?', listed)).toEqual(['b']);
    expect(matchMatters('the invoice', listed)).toEqual(['b']);
    expect(matchMatters('hello', listed)).toEqual([]);
    expect(plainAnswer('**Yes** \u201cfine\u201d\u2026')).toBe('Yes "fine"...');
  });
});

describe('matterView (A3) and the usage', () => {
  it('shows the timeline, the booked meeting, the card time and the estimated cost', async () => {
    const ctx = await activeMatter({ autoSchedule: true });
    await offered(ctx);
    ctx.clock.now = new Date(NOW.getTime() + 2 * HOUR);
    await read(ctx, await reply(ctx, 'Tuesday at 3:00 AM'), assess({ intent: 'picks_time', time_words: 'Tuesday at 3:00 AM' }));
    const view = await handleMatterView(CALLER, { matterId: ctx.matterId }, ctx.deps);
    expect(view.page!.approvals[0]).toMatchObject({ kind: 'time_proposal', reason: 'outside_windows', slot: { start: '2026-11-17T02:00:00.000Z' } });
    expect(view.page!.events!.map((e) => e.at)).toEqual([...view.page!.events!.map((e) => e.at)].sort().reverse());
    expect(view.page!.events!.map((e) => e.type)).toEqual(expect.arrayContaining(['times_offered', 'reply_sent', 'email_sent', 'mandate_confirmed']));
    // 1 draft + 2 reads; 2 emails (first email and the offer); 100 in and 20 out tokens per fake call
    expect(view.page!.usage).toMatchObject({ modelCalls: 3, inputTokens: 300, outputTokens: 60, emails: 2, speechChars: 0 });
    expect(view.page!.usage!.costUsd).toBeCloseTo((300 * 0.4 + 60 * 1.6) / 1e6 + 2 * 0.0015, 6);
    const list = await handleMatterView(CALLER, {}, ctx.deps);
    expect(list.matters![0]).toMatchObject({ contacts: ['Carlos Ruiz'], meeting: null });
  });
});

describe('matterSpeak (demo only)', () => {
  it('is off unless MATTERS_NATURAL_VOICE, and counts the characters spoken on the matter', async () => {
    const ctx = await activeMatter();
    await expect(handleMatterSpeak(CALLER, { text: 'Hello', language: 'en' }, ctx.deps)).rejects.toMatchObject({ details: { reason: 'not_configured' } });
    const speech = jest.fn(async () => Buffer.from('mp3-bytes'));
    const deps = { ...ctx.deps, naturalVoice: true, speech };
    const spoken = await handleMatterSpeak(CALLER, { text: 'Carlos has not replied yet.', language: 'en', matterId: ctx.matterId }, deps);
    expect(spoken).toEqual({ audioBase64: Buffer.from('mp3-bytes').toString('base64'), chars: 27, estCostUsd: expect.any(Number) });
    expect(speech).toHaveBeenCalledWith('Carlos has not replied yet.', 'en');
    expect((await matter(ctx))!.usage.speechChars).toBe(27);
  });
});

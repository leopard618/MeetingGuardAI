/**
 * A3 feedback (the client's test of A3): write to the contact now (matterMessage), move the booked
 * meeting (matterMove), "let them know" after a change, and the new matterAsk intents. Nothing here
 * sends by itself: every email waits on a card the owner sends with matterDecide.
 */
import { handleMatterAsk } from '../../src/matters/ask';
import { handleMatterConfirm, handleMatterDraft, type MatterDeps } from '../../src/matters/handlers';
import { changeConcernsContact, handleMatterChange, handleMatterSetStatus } from '../../src/matters/manage';
import type { Mandate } from '../../src/matters/model';
import { bookSlot, handleMatterDecide, meetingIdFor } from '../../src/matters/replies';
import { handleMatterMessage, handleMatterMove, newStart, plainEmail, threadingFor } from '../../src/matters/write';
import { aiMeetingContextDocSchema } from '../../src/shared/aiContract';
import { CALLER, FakeCalendar, NOW, REQUEST, makeDeps, proposal } from './mattersFakes';

const HOUR = 3_600_000;
const ZONE = 'Europe/Madrid';
// Friday 2026-11-13, 9:00 to 9:30 in Madrid (UTC+1)
const SLOT_FRI = { start: '2026-11-13T08:00:00.000Z', end: '2026-11-13T08:30:00.000Z' };

async function activeMatter(overrides: Partial<MatterDeps> = {}, proposalOverrides: Record<string, unknown> = {}) {
  const clock = { now: NOW };
  let seq = 0;
  const calendar = new FakeCalendar();
  const ctx = makeDeps({ now: () => clock.now, random: () => `r${++seq}`, meetings: calendar, ...overrides });
  ctx.llm.queue.push(proposal({ ends_at: '2026-11-30T18:00', ...proposalOverrides }));
  const draft = await handleMatterDraft(CALLER, { text: REQUEST, source: 'text', language: 'en', timeZone: ZONE }, ctx.deps);
  await handleMatterConfirm(CALLER, { matterId: draft.matterId, draftHash: draft.draftHash }, ctx.deps);
  return { ...ctx, clock, calendar, matterId: draft.matterId };
}
type Ctx = Awaited<ReturnType<typeof activeMatter>>;

const matter = (ctx: Ctx) => ctx.store.getMatter('u1', ctx.matterId);
const cards = (ctx: Ctx) => ctx.store.cardList('u1', ctx.matterId);
const pending = (ctx: Ctx) => cards(ctx).filter((c) => c.status === 'pending');
const send = (ctx: Ctx, id: string, draftHash: string | null) => handleMatterDecide(CALLER, { matterId: ctx.matterId, target: 'approval', id, action: 'approve', draftHash }, ctx.deps);

/** The matter with its meeting booked on Friday 9:00 (the owner booked it; the confirmation went out). */
async function booked(overrides: Partial<MatterDeps> = {}) {
  const ctx = await activeMatter(overrides);
  await expect(bookSlot({ uid: 'u1', matterId: ctx.matterId, slot: SLOT_FRI, by: 'owner', contactEmail: 'carlos@example.com', deps: ctx.deps })).resolves.toBe('booked');
  // the goal_reached card stays; the confirmation went out
  expect(ctx.sender.sent).toHaveLength(2);
  return ctx;
}

describe('matterMessage: write to the contact now', () => {
  it('drafts the email the owner asked for as a card; nothing goes out until the owner sends it', async () => {
    const ctx = await activeMatter();
    ctx.llm.queue.push({ body: 'Hello Carlos,\n\nAna is running 10 minutes late \u2014 sorry.\n\nBest,', question: null });
    const result = await handleMatterMessage(CALLER, { matterId: ctx.matterId, text: 'Tell him I am running 10 minutes late' }, ctx.deps);
    expect(result).toEqual({ matterId: ctx.matterId, id: expect.any(String), question: null });
    expect(ctx.sender.sent).toHaveLength(1);
    const card = cards(ctx).find((c) => c.id === result.id)!;
    expect(card).toMatchObject({ kind: 'reply_draft', status: 'pending', reason: 'owner_message', auto: false, guardFlags: [] });
    expect(card.draft).toMatchObject({ to: ['carlos@example.com'], cc: ['ana@example.com'], subject: 'Re: Updated proposal' });
    expect(card.draft!.text).toContain('Ana is running 10 minutes late - sorry.');
    expect(card.draft!.text).toContain('This email was written by AI');
    // threaded under our own first email: it stays in the same conversation
    expect(card.threading!.inReplyTo).toBe(ctx.sender.sent[0]!.messageId);
    const request = ctx.llm.requests.at(-1)!;
    expect(request.tools[0]!.function.name).toBe('write_email');
    expect(JSON.stringify(request.messages)).toContain('<request>');
    expect(ctx.store.eventTypes('u1', ctx.matterId)).toContain('message_drafted');
    expect((await matter(ctx))!.pendingApprovals).toBe(1);

    await expect(send(ctx, card.id, card.draftHash)).resolves.toMatchObject({ status: 'approved', outcome: 'sent' });
    expect(ctx.sender.sent).toHaveLength(2);
    expect(ctx.sender.sent[1]!.text).toBe(card.draft!.text);
  });

  it('asks back when the words do not say what to tell them; flags money; refuses a paused matter', async () => {
    const ctx = await activeMatter();
    ctx.llm.queue.push({ body: null, question: 'What should I tell Carlos?' });
    await expect(handleMatterMessage(CALLER, { matterId: ctx.matterId, text: 'Carlos' }, ctx.deps)).resolves.toEqual({ matterId: ctx.matterId, id: null, question: 'What should I tell Carlos?' });
    expect(cards(ctx)).toHaveLength(0);

    ctx.llm.queue.push({ body: 'Hello Carlos,\n\nWe can pay 500 EUR for it.\n\nBest,', question: null });
    const flagged = await handleMatterMessage(CALLER, { matterId: ctx.matterId, text: 'Tell him we can pay 500 euros' }, ctx.deps);
    expect(cards(ctx).find((c) => c.id === flagged.id)!.guardFlags).toContain('money');

    await handleMatterSetStatus(CALLER, { matterId: ctx.matterId, action: 'pause' }, ctx.deps);
    await expect(handleMatterMessage(CALLER, { matterId: ctx.matterId, text: 'Say hello' }, ctx.deps)).rejects.toMatchObject({ details: { reason: 'not_allowed' } });
  });

  it('a model failure is upstream_error and writes nothing', async () => {
    const ctx = await activeMatter();
    ctx.llm.queue.push(new Error('boom'));
    await expect(handleMatterMessage(CALLER, { matterId: ctx.matterId, text: 'Say hello' }, ctx.deps)).rejects.toMatchObject({ details: { reason: 'upstream_error' } });
    expect(cards(ctx)).toHaveLength(0);
  });

  it('threads under the contact\u2019s last email when there is one, and keeps plain punctuation', () => {
    const base = { references: [], to: [], cc: [], text: '', at: NOW.toISOString(), providerId: null, auth: null, inReplyTo: null, from: { name: null, email: 'x@example.com' } };
    const thread = [
      { ...base, direction: 'outbound', status: 'sent', rfcMessageId: '<ours@x>', subject: 'Hello' },
      { ...base, direction: 'inbound', status: 'received', senderRole: 'contact', rfcMessageId: '<theirs@y>', subject: 'Re: Hello' },
    ] as never;
    expect(threadingFor(thread)).toEqual({ inReplyTo: '<theirs@y>', references: ['<theirs@y>'], subject: 'Re: Hello' });
    expect(threadingFor([])).toEqual({ inReplyTo: null, references: [], subject: null });
    expect(plainEmail(' \u201cYes\u201d \u2013 fine\u2026 ')).toBe('"Yes" - fine...');
  });
});

describe('matterMove: move the booked meeting', () => {
  const move = (ctx: Ctx, request: { text?: string; start?: string }) => handleMatterMove(CALLER, { matterId: ctx.matterId, ...request }, ctx.deps);
  const meetingDoc = (ctx: Ctx) => ctx.store.meetings.get(`u1/${meetingIdFor(ctx.matterId)}`)!;

  it('reads the new time and only shows it: nothing changes until the owner confirms it', async () => {
    const ctx = await booked();
    ctx.llm.queue.push({ date: '2026-11-13', time: '16:00' });
    const preview = await move(ctx, { text: 'Move it to Friday at 4 pm' });
    expect(preview).toEqual({ matterId: ctx.matterId, slot: { start: '2026-11-13T15:00:00.000Z', end: '2026-11-13T15:30:00.000Z' }, free: true, moved: false, id: null, question: null });
    expect(ctx.llm.requests.at(-1)!.tools[0]!.function.name).toBe('read_new_time');
    expect(meetingDoc(ctx).startAt).toBe(SLOT_FRI.start);
    expect((await matter(ctx))!.booking!.start).toBe(SLOT_FRI.start);
    expect(cards(ctx).filter((c) => c.reason === 'meeting_moved')).toHaveLength(0);
  });

  it('a missing day keeps the meeting\u2019s day, a missing time keeps its time; busy times are said, the meeting itself never counts', async () => {
    const ctx = await booked();
    ctx.llm.queue.push({ date: null, time: '22:00' });
    await expect(move(ctx, { text: 'make it 10 pm' })).resolves.toMatchObject({ slot: { start: '2026-11-13T21:00:00.000Z' }, free: true });
    ctx.llm.queue.push({ date: '2026-11-16', time: null });
    await expect(move(ctx, { text: 'move it to Monday' })).resolves.toMatchObject({ slot: { start: '2026-11-16T08:00:00.000Z' } });
    // the booked meeting itself in the calendar: moving it 15 minutes later is still free
    ctx.calendar.records.push({ id: meetingIdFor(ctx.matterId), doc: aiMeetingContextDocSchema.parse({ ...ctx.calendar.add(SLOT_FRI.start, 30).records.pop()!.doc }) });
    ctx.llm.queue.push({ date: null, time: '09:15' });
    await expect(move(ctx, { text: '15 minutes later' })).resolves.toMatchObject({ free: true });
    ctx.calendar.add('2026-11-13T15:00:00.000Z', 60);
    ctx.llm.queue.push({ date: null, time: '16:00' });
    await expect(move(ctx, { text: 'at 4 pm' })).resolves.toMatchObject({ slot: { start: '2026-11-13T15:00:00.000Z' }, free: false });
  });

  it('without the model, code reads one day and the time it moves TO', async () => {
    const ctx = await booked();
    ctx.llm.queue.push(new Error('boom'));
    await expect(move(ctx, { text: 'Friday at 4 pm' })).resolves.toMatchObject({ slot: { start: '2026-11-13T15:00:00.000Z' } });
    // the client's own words: "move the meeting we had for tomorrow from 10 a.m. to 10 p.m."
    const booking = SLOT_FRI;
    expect(newStart({ args: null, words: 'mueve la reunión que teníamos para mañana de las 10 a.m a las 10 p.m', booking, zone: ZONE, now: NOW })).toBe('2026-11-13T21:00:00.000Z');
    expect(newStart({ args: { date: 'soon', time: '25:00' }, words: '', booking, zone: ZONE, now: NOW })).toBeNull();
  });

  it('asks again when no time is read, the time has passed, it is the same, or nothing is booked', async () => {
    const ctx = await booked();
    ctx.llm.queue.push({ date: null, time: null });
    await expect(move(ctx, { text: 'move it' })).resolves.toMatchObject({ slot: null, question: 'Which day and time should I move it to? For example: Friday at 4 pm.' });
    ctx.llm.queue.push({ date: '2026-11-11', time: '10:00' });
    await expect(move(ctx, { text: 'yesterday' })).resolves.toMatchObject({ slot: null, question: 'That time has already passed. Which day and time should I move it to?' });
    ctx.llm.queue.push({ date: '2026-11-13', time: '09:00' });
    await expect(move(ctx, { text: 'Friday at 9' })).resolves.toMatchObject({ slot: null, question: 'The meeting is already at that time.' });
    const plain = await activeMatter();
    await expect(handleMatterMove(CALLER, { matterId: plain.matterId, text: 'Friday at 4 pm' }, plain.deps)).resolves.toMatchObject({ slot: null, question: 'This matter has no booked meeting to move.' });
    expect(plain.llm.requests).toHaveLength(1); // the draft only: no model call without a booking
  });

  it('moves the meeting on the confirmed time and drafts the email that tells the contact', async () => {
    const ctx = await booked();
    ctx.clock.now = new Date(NOW.getTime() + HOUR);
    const moved = await move(ctx, { start: '2026-11-13T15:00:00.000Z' });
    expect(moved).toMatchObject({ slot: { start: '2026-11-13T15:00:00.000Z', end: '2026-11-13T15:30:00.000Z' }, moved: true, id: expect.any(String), question: null });
    expect(meetingDoc(ctx)).toMatchObject({ startAt: '2026-11-13T15:00:00.000Z', date: '2026-11-13', time: '16:00', durationMinutes: 30, pushPending: true, updatedAt: ctx.clock.now.toISOString() });
    expect((await matter(ctx))!.booking).toMatchObject({ start: '2026-11-13T15:00:00.000Z', end: '2026-11-13T15:30:00.000Z', by: 'owner' });
    expect(ctx.store.eventTypes('u1', ctx.matterId)).toContain('meeting_moved');
    const card = cards(ctx).find((c) => c.id === moved.id)!;
    expect(card).toMatchObject({ kind: 'reply_draft', status: 'pending', reason: 'meeting_moved', slot: moved.slot });
    expect(card.draft!.to).toEqual(['carlos@example.com']);
    expect(card.draft!.text).toContain('A change from Ana Lopez: the meeting is now Fri, Nov 13, 4:00 PM to 4:30 PM (Europe/Madrid time), instead of Fri, Nov 13, 9:00 AM to 9:30 AM. Does the new time work for you?');
    // nothing went out yet
    expect(ctx.sender.sent).toHaveLength(2);
    await expect(send(ctx, card.id, card.draftHash)).resolves.toMatchObject({ outcome: 'sent' });
    expect(ctx.sender.sent).toHaveLength(3);
  });

  it('a second move expires the first email still waiting; a deleted meeting cannot be moved', async () => {
    const ctx = await booked();
    const first = await move(ctx, { start: '2026-11-13T15:00:00.000Z' });
    const second = await move(ctx, { start: '2026-11-13T16:00:00.000Z' });
    expect(cards(ctx).find((c) => c.id === first.id)!.status).toBe('expired');
    expect(pending(ctx).filter((c) => c.reason === 'meeting_moved').map((c) => c.id)).toEqual([second.id]);
    expect(cards(ctx).find((c) => c.id === second.id)!.draft!.text).toContain('instead of Fri, Nov 13, 4:00 PM to 4:30 PM');

    ctx.store.meetings.set(`u1/${meetingIdFor(ctx.matterId)}`, { ...meetingDoc(ctx), deletedAt: NOW.toISOString() });
    await expect(move(ctx, { start: '2026-11-13T17:00:00.000Z' })).rejects.toMatchObject({ details: { reason: 'not_allowed' } });
  });

  it('Spanish matters get the Spanish email', async () => {
    const ctx = await activeMatter({}, { email_language: 'es' });
    await bookSlot({ uid: 'u1', matterId: ctx.matterId, slot: SLOT_FRI, by: 'owner', contactEmail: 'carlos@example.com', deps: ctx.deps });
    const moved = await move(ctx, { start: '2026-11-13T15:00:00.000Z' });
    expect(cards(ctx).find((c) => c.id === moved.id)!.draft!.text).toContain('la reunión pasa a ser');
  });
});

describe('let them know after a change', () => {
  const mandate = (overrides: Partial<Mandate> = {}): Mandate =>
    ({
      goal: 'Get the proposal.',
      contacts: [{ name: 'Carlos', email: 'carlos@example.com' }],
      mayAsk: ['the proposal'],
      meeting: null,
      followUp: { everyDays: 2, maxCount: 3 },
      endsAt: '2026-11-30T17:00:00.000Z',
      copyOwner: 'cc',
      language: 'en',
      timeZone: ZONE,
      ...overrides,
    }) as Mandate;

  it('only what the contact was told counts', () => {
    expect(changeConcernsContact(mandate(), mandate({ endsAt: '2026-12-04T17:00:00.000Z' }))).toBe(true);
    expect(changeConcernsContact(mandate(), mandate({ mayAsk: ['the proposal', 'the invoice'] }))).toBe(true);
    expect(changeConcernsContact(mandate(), mandate({ followUp: { everyDays: 3, maxCount: 2 } }))).toBe(false);
    expect(changeConcernsContact(mandate(), mandate({ copyOwner: 'daily_summary' }))).toBe(false);
    expect(changeConcernsContact(null, mandate())).toBe(false);
  });

  it('an applied change of the end date says letThemKnow; a change of the follow-ups does not', async () => {
    const ctx = await activeMatter();
    ctx.llm.queue.push(proposal({ ends_at: '2026-12-04T18:00' }));
    const deadline = await handleMatterChange(CALLER, { matterId: ctx.matterId, text: 'Move the deadline to Friday December 4.' }, ctx.deps);
    await expect(handleMatterChange(CALLER, { matterId: ctx.matterId, draftHash: deadline.draftHash! }, ctx.deps)).resolves.toMatchObject({ letThemKnow: true });
    ctx.llm.queue.push(proposal({ ends_at: '2026-12-04T18:00', follow_up: { every_days: 3, max_count: 2 } }));
    const followUps = await handleMatterChange(CALLER, { matterId: ctx.matterId, text: 'Follow up every 3 days.' }, ctx.deps);
    await expect(handleMatterChange(CALLER, { matterId: ctx.matterId, draftHash: followUps.draftHash! }, ctx.deps)).resolves.toMatchObject({ letThemKnow: false });
    // nothing was sent by the change itself
    expect(ctx.sender.sent).toHaveLength(1);
  });
});

describe('matterAsk: move_meeting and message', () => {
  const ask = (ctx: Ctx, text: string, answer: unknown) => {
    ctx.llm.queue.push(answer);
    return handleMatterAsk(CALLER, { text, language: 'en' }, ctx.deps);
  };

  it('names the action with a confirmation written by code, and never acts', async () => {
    const ctx = await booked();
    await expect(ask(ctx, 'Move the Carlos meeting to 4 pm', { intent: 'move_meeting', matter_ref: 'm1', answer: '' })).resolves.toMatchObject({
      intent: 'move_meeting',
      answer: 'I will read the new time and show it to you before I move the meeting of "Proposal from Carlos".',
    });
    await expect(ask(ctx, 'Tell Carlos I am late', { intent: 'message', matter_ref: 'm1', answer: '' })).resolves.toMatchObject({
      intent: 'message',
      answer: 'I will write the email for "Proposal from Carlos" and show it to you before anything is sent.',
    });
    expect(ctx.sender.sent).toHaveLength(2);
  });

  it('a matter without a booked meeting says so instead of offering to move it', async () => {
    const ctx = await activeMatter();
    await expect(ask(ctx, 'Move the Carlos meeting', { intent: 'move_meeting', matter_ref: 'm1', answer: '' })).resolves.toMatchObject({
      intent: 'status',
      answer: 'This matter has no booked meeting to move.',
    });
  });
});

import type { MeetingReader, MeetingRecord } from '../../src/assistant/context';
import type { LlmClient, LlmRequest, LlmResult } from '../../src/assistant/llm';
import { aiMeetingContextDocSchema } from '../../src/shared/aiContract';
import type { EmailSender, OutboundEmail } from '../../src/matters/email';
import type { MatterDeps } from '../../src/matters/handlers';
import {
  EMPTY_MONTHLY,
  endedAtOf,
  matterMessageReadSchema,
  messageIdKey,
  type MatterRetention,
  type MatterSpendDelta,
  type MonthlyCounts,
  type MonthlyField,
  type MatterApproval,
  type MatterDoc,
  type MatterEvent,
  type MatterMessage,
  type MatterProposal,
  type MatterReadQueue,
  type MatterSchedule,
  type MatterUsage,
  type StoredMessage,
} from '../../src/matters/model';
import {
  overLimit,
  readClaimDecision,
  type AddMessageOptions,
  type BookingUpdate,
  type MoveUpdate,
  type CardUpdate,
  type InboundMarker,
  type MatterLookup,
  type MatterStore,
  type MatterUpdate,
  type ProposalUpdate,
  type ReadClaim,
  type StoredMessageWithId,
} from '../../src/matters/store';

export const NOW = new Date('2026-11-12T09:00:00.000Z');
export const DOMAIN = 'assistant.meetingguard.ai';
export const TOKEN = '0123456789abcdef01234567';

/** In-memory MatterStore with the same semantics as the Firestore one. */
export class FakeMatterStore implements MatterStore {
  readonly matters = new Map<string, MatterDoc>();
  readonly events = new Map<string, MatterEvent[]>();
  readonly messages = new Map<string, StoredMessageWithId[]>();
  readonly cards = new Map<string, Map<string, MatterApproval>>();
  readonly proposals = new Map<string, Map<string, MatterProposal>>();
  readonly tasks = new Map<string, Record<string, unknown>>();
  readonly schedules = new Map<string, MatterSchedule>();
  readonly readQueue = new Map<string, MatterReadQueue>();
  readonly sends = new Map<string, number>();
  readonly addresses = new Map<string, MatterLookup>();
  readonly messageIds = new Map<string, MatterLookup>();
  readonly inbound = new Set<string>();
  readonly daily = new Map<string, number>();
  /** A3: users/{uid}/meetings/{id} written by bookMeeting. */
  readonly meetings = new Map<string, Record<string, unknown>>();
  /** accountDeletions/{uid}: createMatter refuses these uids. */
  readonly deletions = new Set<string>();
  /** A4: matterRetention, matterSpend (micros and counters), usage/{uid}/months. */
  readonly retention = new Map<string, MatterRetention>();
  readonly spend = new Map<string, Record<string, number>>();
  readonly monthly = new Map<string, MonthlyCounts>();
  /** A4: matters removed by deleteMatter (their ids), for the tests. */
  readonly deleted = new Set<string>();
  /** Makes the next addInboundMessage batch fail (nothing written), like a Firestore error. */
  failNextInboundWrite = false;
  private next = 1;

  private key(uid: string, matterId: string) {
    return `${uid}/${matterId}`;
  }

  newMatterId() {
    return `m${this.next++}`;
  }

  async createMatter(uid: string, matterId: string, doc: MatterDoc, event: MatterEvent) {
    const k = this.key(uid, matterId);
    if (this.deletions.has(uid)) return false;
    if (this.matters.has(k)) throw new Error('exists');
    this.matters.set(k, structuredClone(doc));
    this.events.set(k, [event]);
    this.addresses.set(doc.replyToken, { uid, matterId });
    return true;
  }

  async getMatter(uid: string, matterId: string) {
    const doc = this.matters.get(this.key(uid, matterId));
    return doc ? structuredClone(doc) : null;
  }

  async updateMatter<T>(uid: string, matterId: string, decide: (doc: MatterDoc | null) => MatterUpdate<T>) {
    const k = this.key(uid, matterId);
    const current = this.matters.get(k);
    const outcome = decide(current ? structuredClone(current) : null);
    // like the transaction: every create is checked before anything is written
    for (const card of outcome.cards ?? []) if (this.cardMap(k).has(card.id)) throw new Error('already exists');
    for (const p of outcome.proposals ?? []) if (this.proposalMap(k).has(p.id)) throw new Error('already exists');
    if (outcome.patch && current) this.matters.set(k, { ...current, ...outcome.patch });
    if (outcome.patch && current) this.markEnded(uid, matterId, outcome.patch);
    if (outcome.events?.length) this.events.set(k, [...(this.events.get(k) ?? []), ...outcome.events]);
    for (const card of outcome.cards ?? []) this.cardMap(k).set(card.id, structuredClone(card.doc));
    for (const p of outcome.proposals ?? []) this.proposalMap(k).set(p.id, structuredClone(p.doc));
    if (outcome.message) this.patchMessage(k, outcome.message.id, outcome.message.patch);
    if (outcome.schedule) this.writeSchedule(uid, matterId, outcome.schedule.nextActionAt);
    if (outcome.readQueue) {
      const id = `${matterId}_${outcome.readQueue.messageId}`;
      if (outcome.readQueue.doc) this.readQueue.set(id, structuredClone(outcome.readQueue.doc));
      else this.readQueue.delete(id);
    }
    return outcome.result;
  }

  private cardMap(k: string) {
    if (!this.cards.has(k)) this.cards.set(k, new Map());
    return this.cards.get(k)!;
  }

  private proposalMap(k: string) {
    if (!this.proposals.has(k)) this.proposals.set(k, new Map());
    return this.proposals.get(k)!;
  }

  private patchMessage(k: string, id: string, patch: Partial<StoredMessage>) {
    const list = this.messages.get(k) ?? [];
    const index = list.findIndex((m) => m.id === id);
    if (index === -1) throw new Error('no message');
    list[index] = { ...list[index]!, ...patch };
  }

  private writeSchedule(uid: string, matterId: string, nextActionAt: string | null) {
    if (nextActionAt === null) this.schedules.delete(matterId);
    else this.schedules.set(matterId, { uid, matterId, nextActionAt });
  }

  private stored(message: MatterMessage, id: string): StoredMessageWithId {
    return { ...matterMessageReadSchema.parse(message), id };
  }

  async addMessage(uid: string, matterId: string, message: MatterMessage, event: MatterEvent, options: AddMessageOptions = {}) {
    const k = this.key(uid, matterId);
    const current = this.matters.get(k);
    if (!current) throw new Error('no matter');
    const indexKey = messageIdKey(message.rfcMessageId);
    // like Firestore's create(): an indexed id is never re-pointed (the whole batch fails)
    if (options.indexMessageId && this.messageIds.has(indexKey)) throw new Error('already exists');
    const id = `x${this.next++}`;
    this.messages.set(k, [...(this.messages.get(k) ?? []), this.stored(message, id)]);
    this.events.set(k, [...(this.events.get(k) ?? []), { ...event, messageId: id }]);
    if (options.indexMessageId) this.messageIds.set(indexKey, { uid, matterId });
    const counted = message.direction === 'outbound' ? { usage: { ...current.usage, emails: (current.usage?.emails ?? 0) + 1 } } : {};
    this.matters.set(k, { ...current, ...options.patch, ...counted, updatedAt: message.at });
    this.markEnded(uid, matterId, options.patch);
    if (options.card) {
      const card = this.cardMap(k).get(options.card.id);
      if (card) this.cardMap(k).set(options.card.id, { ...card, ...options.card.patch, updatedAt: message.at });
    }
    if (options.schedule) this.writeSchedule(uid, matterId, options.schedule.nextActionAt);
    this.lastAddedId = id;
    return id;
  }

  /** The id of the last message stored (tests fire matterInboundRead with it). */
  lastAddedId: string | null = null;

  async findByToken(token: string) {
    return this.addresses.get(token) ?? null;
  }

  async findByMessageKey(key: string) {
    return this.messageIds.get(key) ?? null;
  }

  async addInboundMessage(uid: string, matterId: string, message: MatterMessage, event: MatterEvent, marker: InboundMarker, patch?: Partial<MatterDoc>) {
    const k = this.key(uid, matterId);
    const current = this.matters.get(k);
    if (!current) throw new Error('no matter');
    // one batch: the marker's create() fails the whole write when it exists
    if (this.inbound.has(marker.providerId)) return 'duplicate' as const;
    if (this.failNextInboundWrite) {
      this.failNextInboundWrite = false;
      throw new Error('write failed');
    }
    const id = `x${this.next++}`;
    this.inbound.add(marker.providerId);
    this.messages.set(k, [...(this.messages.get(k) ?? []), this.stored(message, id)]);
    this.events.set(k, [...(this.events.get(k) ?? []), { ...event, messageId: id }]);
    this.matters.set(k, { ...current, ...patch, updatedAt: message.at });
    this.markEnded(uid, matterId, patch);
    this.lastAddedId = id;
    return 'stored' as const;
  }

  async markInbound(marker: InboundMarker) {
    if (this.inbound.has(marker.providerId)) return false;
    this.inbound.add(marker.providerId);
    return true;
  }

  async consumeDaily(uid: string, dayKey: string, limit: number) {
    const k = `${uid}/${dayKey}`;
    const used = this.daily.get(k) ?? 0;
    if (used >= limit) return false;
    this.daily.set(k, used + 1);
    return true;
  }

  eventTypes(uid: string, matterId: string) {
    return (this.events.get(this.key(uid, matterId)) ?? []).map((e) => e.type);
  }

  // ---- A2 ----

  newDocId() {
    return `d${this.next++}`;
  }

  async getMessage(uid: string, matterId: string, messageId: string) {
    const found = (this.messages.get(this.key(uid, matterId)) ?? []).find((m) => m.id === messageId);
    if (!found) return null;
    const { id: _id, ...message } = structuredClone(found);
    return message;
  }

  async listMessages(uid: string, matterId: string, limit: number) {
    return structuredClone((this.messages.get(this.key(uid, matterId)) ?? []).slice(-limit));
  }

  async claimRead(uid: string, matterId: string, messageId: string, input: { nowIso: string; retry: boolean; staleBeforeIso: string; maxAttempts: number }): Promise<ReadClaim> {
    const k = this.key(uid, matterId);
    const message = (this.messages.get(k) ?? []).find((m) => m.id === messageId);
    if (!message) return { state: 'missing', attempts: 0 };
    const decision = readClaimDecision(message, input);
    if (decision.state !== 'claimed') {
      if (decision.state === 'finished') this.readQueue.delete(`${matterId}_${messageId}`);
      return { state: decision.state, attempts: decision.attempts };
    }
    this.patchMessage(k, messageId, { readState: 'reading', readAttempts: decision.attempts, readClaimedAt: input.nowIso });
    this.readQueue.set(`${matterId}_${messageId}`, { uid, matterId, messageId, claimedAt: input.nowIso, attempts: decision.attempts });
    const { id: _id, ...stored } = structuredClone(message);
    return { state: 'claimed', message: stored, attempts: decision.attempts };
  }

  async expireReplyDrafts(uid: string, matterId: string, nowIso: string) {
    const k = this.key(uid, matterId);
    let count = 0;
    for (const [id, card] of this.cardMap(k)) {
      if (card.status === 'pending' && card.kind === 'reply_draft') {
        this.cardMap(k).set(id, { ...card, status: 'expired', updatedAt: nowIso, decidedAt: nowIso });
        count += 1;
      }
    }
    const matter = this.matters.get(k);
    if (count && matter) this.matters.set(k, { ...matter, pendingApprovals: matter.pendingApprovals - count, updatedAt: nowIso });
    return count;
  }

  async getCard(uid: string, matterId: string, cardId: string) {
    const card = this.cardMap(this.key(uid, matterId)).get(cardId);
    return card ? structuredClone(card) : null;
  }

  async updateCard<T>(uid: string, matterId: string, cardId: string, decide: (matter: MatterDoc | null, card: MatterApproval | null) => CardUpdate<T>) {
    const k = this.key(uid, matterId);
    const matter = this.matters.get(k);
    const card = this.cardMap(k).get(cardId);
    const outcome = decide(matter ? structuredClone(matter) : null, card ? structuredClone(card) : null);
    if (outcome.card && card) this.cardMap(k).set(cardId, { ...card, ...outcome.card });
    if (outcome.patch && matter) this.matters.set(k, { ...matter, ...outcome.patch });
    if (outcome.patch && matter) this.markEnded(uid, matterId, outcome.patch);
    if (outcome.events?.length) this.events.set(k, [...(this.events.get(k) ?? []), ...outcome.events]);
    if (outcome.schedule) this.writeSchedule(uid, matterId, outcome.schedule.nextActionAt);
    return outcome.result;
  }

  async decideProposal<T>(
    uid: string,
    matterId: string,
    proposalId: string,
    decide: (matter: MatterDoc | null, proposal: MatterProposal | null, taskExists: boolean) => ProposalUpdate<T>,
  ) {
    const k = this.key(uid, matterId);
    const matter = this.matters.get(k);
    const proposal = this.proposalMap(k).get(proposalId);
    const taskKey = `${uid}/${proposalId}`;
    const outcome = decide(matter ? structuredClone(matter) : null, proposal ? structuredClone(proposal) : null, this.tasks.has(taskKey));
    if (outcome.task && this.tasks.has(`${uid}/${outcome.task.id}`)) throw new Error('already exists');
    if (outcome.proposal && proposal) this.proposalMap(k).set(proposalId, { ...proposal, ...outcome.proposal });
    if (outcome.task) this.tasks.set(`${uid}/${outcome.task.id}`, structuredClone(outcome.task.doc));
    if (outcome.events?.length) this.events.set(k, [...(this.events.get(k) ?? []), ...outcome.events]);
    return outcome.result;
  }

  async dueSchedules(nowIso: string, limit: number) {
    return [...this.schedules.values()].filter((s) => s.nextActionAt <= nowIso).sort((a, b) => a.nextActionAt.localeCompare(b.nextActionAt)).slice(0, limit);
  }

  async dueReads(beforeIso: string, limit: number) {
    return [...this.readQueue.values()].filter((q) => q.claimedAt <= beforeIso).sort((a, b) => a.claimedAt.localeCompare(b.claimedAt)).slice(0, limit);
  }

  async consumeDailySend(uid: string, dayKey: string, limit: number) {
    const k = `${uid}/${dayKey}`;
    const used = this.sends.get(k) ?? 0;
    if (used >= limit) return false;
    this.sends.set(k, used + 1);
    return true;
  }

  async listMatters(uid: string, statuses: readonly MatterDoc['status'][]) {
    return [...this.matters.entries()]
      .filter(([k, doc]) => k.startsWith(`${uid}/`) && statuses.includes(doc.status))
      .map(([k, doc]) => ({ id: k.slice(uid.length + 1), doc: structuredClone(doc) }));
  }

  async listCards(uid: string, matterId: string, status: MatterApproval['status']) {
    return [...this.cardMap(this.key(uid, matterId)).entries()].filter(([, c]) => c.status === status).map(([id, doc]) => ({ id, doc: structuredClone(doc) }));
  }

  async listProposals(uid: string, matterId: string, status: MatterProposal['status']) {
    return [...this.proposalMap(this.key(uid, matterId)).entries()].filter(([, p]) => p.status === status).map(([id, doc]) => ({ id, doc: structuredClone(doc) }));
  }

  // ---- A3 ----

  async listEvents(uid: string, matterId: string, limit: number) {
    return structuredClone([...(this.events.get(this.key(uid, matterId)) ?? [])].sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit));
  }

  async bookMeeting<T>(
    uid: string,
    matterId: string,
    input: { meetingId: string; meeting: Record<string, unknown>; taskIds: readonly string[] },
    decide: (matter: MatterDoc | null, meetingExists: boolean, existingTasks: readonly string[]) => BookingUpdate<T>,
  ) {
    const k = this.key(uid, matterId);
    const current = this.matters.get(k);
    const meetingKey = `${uid}/${input.meetingId}`;
    const existing = input.taskIds.filter((id) => this.tasks.has(`${uid}/${id}`));
    const outcome = decide(current ? structuredClone(current) : null, this.meetings.has(meetingKey), existing);
    if (outcome.createMeeting && this.meetings.has(meetingKey)) throw new Error('already exists');
    for (const card of outcome.cards ?? []) if (this.cardMap(k).has(card.id)) throw new Error('already exists');
    if (outcome.createMeeting) this.meetings.set(meetingKey, structuredClone(input.meeting));
    for (const id of outcome.linkTasks ?? []) {
      const task = this.tasks.get(`${uid}/${id}`);
      if (task) this.tasks.set(`${uid}/${id}`, { ...task, meetingId: input.meetingId, updatedAt: input.meeting.createdAt });
    }
    if (outcome.patch && current) this.matters.set(k, { ...current, ...outcome.patch });
    if (outcome.patch && current) this.markEnded(uid, matterId, outcome.patch);
    if (outcome.events?.length) this.events.set(k, [...(this.events.get(k) ?? []), ...outcome.events]);
    for (const card of outcome.cards ?? []) this.cardMap(k).set(card.id, structuredClone(card.doc));
    if (outcome.schedule) this.writeSchedule(uid, matterId, outcome.schedule.nextActionAt);
    return outcome.result;
  }

  async moveMeeting<T>(uid: string, matterId: string, meetingId: string, decide: (matter: MatterDoc | null, meeting: Record<string, unknown> | null) => MoveUpdate<T>) {
    const k = this.key(uid, matterId);
    const current = this.matters.get(k);
    const meetingKey = `${uid}/${meetingId}`;
    const meeting = this.meetings.get(meetingKey);
    const outcome = decide(current ? structuredClone(current) : null, meeting ? structuredClone(meeting) : null);
    for (const card of outcome.cards ?? []) if (this.cardMap(k).has(card.id)) throw new Error('already exists');
    if (outcome.meetingPatch && meeting) this.meetings.set(meetingKey, { ...meeting, ...structuredClone(outcome.meetingPatch) });
    if (outcome.patch && current) this.matters.set(k, { ...current, ...outcome.patch });
    if (outcome.patch && current) this.markEnded(uid, matterId, outcome.patch);
    if (outcome.events?.length) this.events.set(k, [...(this.events.get(k) ?? []), ...outcome.events]);
    for (const card of outcome.cards ?? []) this.cardMap(k).set(card.id, structuredClone(card.doc));
    if (outcome.schedule) this.writeSchedule(uid, matterId, outcome.schedule.nextActionAt);
    return outcome.result;
  }

  async addUsage(uid: string, matterId: string, delta: Partial<MatterUsage>) {
    const k = this.key(uid, matterId);
    const current = this.matters.get(k);
    if (!current) throw new Error('no matter');
    const usage = { ...current.usage };
    for (const [key, value] of Object.entries(delta)) if (typeof value === 'number') usage[key as keyof MatterUsage] += value;
    this.matters.set(k, { ...current, usage });
  }

  // ---- A4 ----

  private markEnded(uid: string, matterId: string, patch: object | undefined) {
    const endedAt = endedAtOf(patch);
    if (endedAt) this.retention.set(matterId, { uid, matterId, endedAt });
  }

  async getSpend(uid: string, dayKey: string) {
    return this.spend.get(`${dayKey}_${uid}`)?.micros ?? 0;
  }

  async addSpend(uid: string, dayKey: string, delta: MatterSpendDelta) {
    const k = `${dayKey}_${uid}`;
    const current = { ...(this.spend.get(k) ?? {}) };
    for (const [key, value] of Object.entries(delta)) if (typeof value === 'number' && value > 0) current[key] = (current[key] ?? 0) + Math.round(value);
    this.spend.set(k, current);
  }

  async getDaily(uid: string, dayKey: string) {
    return { drafts: this.daily.get(`${uid}/${dayKey}`) ?? 0, sends: this.sends.get(`${uid}/${dayKey}`) ?? 0 };
  }

  async getMonthly(uid: string, monthKey: string) {
    return { ...(this.monthly.get(`${uid}/${monthKey}`) ?? EMPTY_MONTHLY) };
  }

  async consumeMonthly(uid: string, monthKey: string, amounts: Partial<MonthlyCounts>, limits: Partial<MonthlyCounts>): Promise<MonthlyField | null> {
    const k = `${uid}/${monthKey}`;
    const used = { ...(this.monthly.get(k) ?? EMPTY_MONTHLY) };
    const over = overLimit(used, amounts, limits);
    if (over) return over;
    for (const [field, amount] of Object.entries(amounts)) used[field as MonthlyField] += amount ?? 0;
    this.monthly.set(k, used);
    return null;
  }

  async consumeSend(uid: string, dayKey: string, dailyLimit: number, monthKey: string, monthlyLimit: number | null) {
    const dayK = `${uid}/${dayKey}`;
    const monthK = `${uid}/${monthKey}`;
    const month = { ...(this.monthly.get(monthK) ?? EMPTY_MONTHLY) };
    if ((this.sends.get(dayK) ?? 0) >= dailyLimit) return 'daily' as const;
    if (monthlyLimit !== null && month.emails >= monthlyLimit) return 'monthly' as const;
    this.sends.set(dayK, (this.sends.get(dayK) ?? 0) + 1);
    this.monthly.set(monthK, { ...month, emails: month.emails + 1 });
    return 'ok' as const;
  }

  async dueRetention(beforeIso: string, limit: number) {
    return [...this.retention.values()].filter((r) => r.endedAt <= beforeIso).sort((a, b) => a.endedAt.localeCompare(b.endedAt)).slice(0, limit);
  }

  async purgeMatter(uid: string, matterId: string, nowIso: string) {
    const k = this.key(uid, matterId);
    const current = this.matters.get(k);
    if (!current) {
      this.retention.delete(matterId);
      return 'gone' as const;
    }
    if (current.status !== 'done' && current.status !== 'cancelled') {
      this.retention.delete(matterId);
      return 'not_ended' as const;
    }
    this.messages.delete(k);
    this.proposals.delete(k);
    for (const [id, card] of this.cardMap(k)) this.cardMap(k).set(id, { ...card, draft: null, quote: null, from: null, threading: null, updatedAt: nowIso });
    this.dropLookups(uid, matterId, current.replyToken);
    this.matters.set(k, { ...current, firstEmail: null, purgedAt: nowIso, updatedAt: nowIso });
    this.events.set(k, [...(this.events.get(k) ?? []), { type: 'emails_deleted', at: nowIso, messageId: null, detail: '' }]);
    this.retention.delete(matterId);
    return 'purged' as const;
  }

  async deleteMatter(uid: string, matterId: string) {
    const k = this.key(uid, matterId);
    const current = this.matters.get(k);
    if (!current) return false;
    this.dropLookups(uid, matterId, current.replyToken);
    for (const map of [this.matters, this.events, this.messages, this.cards, this.proposals] as Map<string, unknown>[]) map.delete(k);
    this.retention.delete(matterId);
    this.deleted.add(matterId);
    return true;
  }

  private dropLookups(uid: string, matterId: string, replyToken: string) {
    this.schedules.delete(matterId);
    this.addresses.delete(replyToken);
    for (const [key, lookup] of this.messageIds) if (lookup.uid === uid && lookup.matterId === matterId) this.messageIds.delete(key);
    for (const [key, entry] of this.readQueue) if (entry.uid === uid && entry.matterId === matterId) this.readQueue.delete(key);
  }

  cardList(uid: string, matterId: string) {
    return [...this.cardMap(this.key(uid, matterId)).entries()].map(([id, card]) => ({ id, ...card }));
  }

  proposalList(uid: string, matterId: string) {
    return [...this.proposalMap(this.key(uid, matterId)).entries()].map(([id, p]) => ({ id, ...p }));
  }

  messageList(uid: string, matterId: string) {
    return this.messages.get(this.key(uid, matterId)) ?? [];
  }
}

/**
 * A3: the owner's calendar as the assistant's MeetingReader sees it. add() takes a one-off meeting
 * (start ISO, minutes) or a whole document; every list call is counted (bookSlot re-reads it).
 */
export class FakeCalendar implements MeetingReader {
  readonly records: MeetingRecord[] = [];
  reads = 0;

  add(startAt: string, durationMinutes: number, extra: Record<string, unknown> = {}): this {
    const doc = aiMeetingContextDocSchema.parse({
      title: 'Busy',
      description: '',
      startAt,
      durationMinutes,
      timezone: 'Europe/Madrid',
      allDay: false,
      status: 'scheduled',
      deletedAt: null,
      source: 'google',
      participants: [],
      location: null,
      conference: null,
      recurrenceOverrides: null,
      recurrence: null,
      ...extra,
    });
    this.records.push({ id: `cal${this.records.length + 1}`, doc });
    return this;
  }

  async listByStartRange(_uid: string, fromIso: string, toIso: string) {
    this.reads += 1;
    return this.records.filter((r) => !r.doc.recurrence && r.doc.startAt >= fromIso && r.doc.startAt <= toIso);
  }

  async listRecurring() {
    this.reads += 1;
    return this.records.filter((r) => r.doc.recurrence);
  }

  async get(_uid: string, id: string) {
    return this.records.find((r) => r.id === id) ?? null;
  }
}

/**
 * An LLM that answers with one tool call per queued answer: the call is named after the request's
 * only tool (propose_matter for drafts, assess_reply for reads).
 */
export class FakeLlm implements LlmClient {
  readonly requests: LlmRequest[] = [];
  readonly queue: (unknown | Error)[] = [];

  async complete(request: LlmRequest): Promise<LlmResult> {
    this.requests.push(request);
    const next = this.queue.shift();
    if (next instanceof Error) throw next;
    const name = request.tools[0]?.function.name ?? 'propose_matter';
    return {
      content: null,
      refusal: null,
      toolCalls: next === undefined ? [] : [{ name, arguments: JSON.stringify(next) }],
      finishReason: 'tool_calls',
      usage: { promptTokens: 100, completionTokens: 20 },
    };
  }
}

export class FakeSender implements EmailSender {
  readonly sent: OutboundEmail[] = [];
  /** Every call to send, including the failed ones (a timeout may still have delivered). */
  attempts = 0;
  failWith: Error | null = null;
  /** Answer like Postmark's test token (accepted, delivered to nobody). */
  test = false;

  async send(email: OutboundEmail) {
    this.attempts += 1;
    // a real provider call takes time: overlapping confirms interleave here
    await Promise.resolve();
    if (this.failWith) throw this.failWith;
    this.sent.push(email);
    return { providerId: `pm-${this.sent.length}`, ...(this.test ? { test: true } : {}) };
  }
}

/** A complete proposal for "contact Carlos (carlos@example.com) ... until Friday". */
export function proposal(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: 'Proposal from Carlos',
    contacts: [{ name: 'Carlos Ruiz', email: 'carlos@example.com' }],
    goal: 'Get the updated proposal and set up a meeting to discuss it.',
    may_ask: ['the updated proposal', 'a time for a 30 minute meeting'],
    meeting: { needed: true, duration_minutes: 30, windows: [] },
    follow_up: { every_days: 2, max_count: 3 },
    ends_at: '2026-11-13T18:00:00+01:00',
    copy_owner: 'cc',
    email_language: 'en',
    first_email: { subject: 'Updated proposal', text: 'Hello Carlos,\n\nI am writing on behalf of Ana Lopez. Could you send the updated proposal?\n\nBest,' },
    questions: [],
    ...overrides,
  };
}

export const REQUEST =
  'Contact Carlos Ruiz at carlos@example.com, ask for the updated proposal, set up a meeting to discuss it, and follow up until Friday. Keep me copied.';

export function makeDeps(overrides: Partial<MatterDeps> = {}) {
  const store = new FakeMatterStore();
  const llm = new FakeLlm();
  const sender = new FakeSender();
  const deps: MatterDeps = {
    store,
    llm: () => llm,
    sender: () => sender,
    now: () => NOW,
    enabled: true,
    allowed: () => true,
    domain: DOMAIN,
    fromLocalPart: 'assistant',
    dailyLimit: 30,
    newToken: () => TOKEN,
    random: () => 'r1',
    ...overrides,
  };
  return { deps, store, llm, sender };
}

export const CALLER = {
  uid: 'u1',
  name: 'Ana Lopez',
  email: 'ana@example.com',
  emailVerified: true,
  signInProvider: 'password',
};

/** A Postmark inbound webhook body (the documented shape, trimmed). */
export function inboundPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    FromName: 'Carlos Ruiz',
    MessageStream: 'inbound',
    From: 'carlos@example.com',
    FromFull: { Email: 'carlos@example.com', Name: 'Carlos Ruiz', MailboxHash: '' },
    To: `m-${TOKEN}@${DOMAIN}`,
    ToFull: [{ Email: `m-${TOKEN}@${DOMAIN}`, Name: '', MailboxHash: '' }],
    Cc: '',
    CcFull: [],
    Bcc: '',
    BccFull: [],
    OriginalRecipient: `m-${TOKEN}@${DOMAIN}`,
    Subject: 'Re: Updated proposal',
    MessageID: '73e6d360-66eb-11e1-8e72-a8904824019b',
    ReplyTo: '',
    MailboxHash: '',
    Date: 'Thu, 12 Nov 2026 10:00:00 +0100',
    TextBody: 'Here it is.\n\nOn Thu, Ana Lopez AI assistant wrote:\n> Could you send the updated proposal?',
    HtmlBody: '<p>Here it is.</p>',
    StrippedTextReply: 'Here it is.',
    Tag: '',
    Headers: [
      { Name: 'Message-ID', Value: '<CAF=abc123@mail.gmail.com>' },
      { Name: 'In-Reply-To', Value: '<m1.r1@assistant.meetingguard.ai>' },
      { Name: 'References', Value: '<m1.r1@assistant.meetingguard.ai>' },
    ],
    Attachments: [],
    ...overrides,
  };
}

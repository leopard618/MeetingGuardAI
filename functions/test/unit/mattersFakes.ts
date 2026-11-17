import type { LlmClient, LlmRequest, LlmResult } from '../../src/assistant/llm';
import type { EmailSender, OutboundEmail } from '../../src/matters/email';
import type { MatterDeps } from '../../src/matters/handlers';
import {
  matterMessageReadSchema,
  messageIdKey,
  type MatterApproval,
  type MatterDoc,
  type MatterEvent,
  type MatterMessage,
  type MatterProposal,
  type MatterReadQueue,
  type MatterSchedule,
  type StoredMessage,
} from '../../src/matters/model';
import {
  readClaimDecision,
  type AddMessageOptions,
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
  /** accountDeletions/{uid}: createMatter refuses these uids. */
  readonly deletions = new Set<string>();
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
    this.matters.set(k, { ...current, ...options.patch, updatedAt: message.at });
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

import type { LlmClient, LlmRequest, LlmResult } from '../../src/assistant/llm';
import type { EmailSender, OutboundEmail } from '../../src/matters/email';
import type { MatterDeps } from '../../src/matters/handlers';
import { messageIdKey, type MatterDoc, type MatterEvent, type MatterMessage } from '../../src/matters/model';
import type { AddMessageOptions, MatterLookup, MatterStore, MatterUpdate } from '../../src/matters/store';

export const NOW = new Date('2026-11-12T09:00:00.000Z');
export const DOMAIN = 'assistant.meetingguard.ai';
export const TOKEN = '0123456789abcdef01234567';

/** In-memory MatterStore with the same semantics as the Firestore one. */
export class FakeMatterStore implements MatterStore {
  readonly matters = new Map<string, MatterDoc>();
  readonly events = new Map<string, MatterEvent[]>();
  readonly messages = new Map<string, (MatterMessage & { id: string })[]>();
  readonly addresses = new Map<string, MatterLookup>();
  readonly messageIds = new Map<string, MatterLookup>();
  readonly inbound = new Set<string>();
  readonly daily = new Map<string, number>();
  private next = 1;

  private key(uid: string, matterId: string) {
    return `${uid}/${matterId}`;
  }

  newMatterId() {
    return `m${this.next++}`;
  }

  async createMatter(uid: string, matterId: string, doc: MatterDoc, event: MatterEvent) {
    const k = this.key(uid, matterId);
    if (this.matters.has(k)) throw new Error('exists');
    this.matters.set(k, structuredClone(doc));
    this.events.set(k, [event]);
    this.addresses.set(doc.replyToken, { uid, matterId });
  }

  async getMatter(uid: string, matterId: string) {
    const doc = this.matters.get(this.key(uid, matterId));
    return doc ? structuredClone(doc) : null;
  }

  async updateMatter<T>(uid: string, matterId: string, decide: (doc: MatterDoc | null) => MatterUpdate<T>) {
    const k = this.key(uid, matterId);
    const current = this.matters.get(k);
    const outcome = decide(current ? structuredClone(current) : null);
    if (outcome.patch && current) this.matters.set(k, { ...current, ...outcome.patch });
    if (outcome.events?.length) this.events.set(k, [...(this.events.get(k) ?? []), ...outcome.events]);
    return outcome.result;
  }

  async addMessage(uid: string, matterId: string, message: MatterMessage, event: MatterEvent, options: AddMessageOptions = {}) {
    const k = this.key(uid, matterId);
    const current = this.matters.get(k);
    if (!current) throw new Error('no matter');
    const indexKey = messageIdKey(message.rfcMessageId);
    // like Firestore's create(): an indexed id is never re-pointed (the whole batch fails)
    if (options.indexMessageId && this.messageIds.has(indexKey)) throw new Error('already exists');
    const id = `x${this.next++}`;
    this.messages.set(k, [...(this.messages.get(k) ?? []), { ...message, id }]);
    this.events.set(k, [...(this.events.get(k) ?? []), { ...event, messageId: id }]);
    if (options.indexMessageId) this.messageIds.set(indexKey, { uid, matterId });
    this.matters.set(k, { ...current, ...options.patch, updatedAt: message.at });
    return id;
  }

  async findByToken(token: string) {
    return this.addresses.get(token) ?? null;
  }

  async findByMessageKey(key: string) {
    return this.messageIds.get(key) ?? null;
  }

  async claimInbound(providerId: string) {
    if (this.inbound.has(providerId)) return false;
    this.inbound.add(providerId);
    return true;
  }

  async releaseInbound(providerId: string) {
    this.inbound.delete(providerId);
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
}

/** An LLM that answers with one propose_matter call per queued proposal. */
export class FakeLlm implements LlmClient {
  readonly requests: LlmRequest[] = [];
  readonly queue: (unknown | Error)[] = [];

  async complete(request: LlmRequest): Promise<LlmResult> {
    this.requests.push(request);
    const next = this.queue.shift();
    if (next instanceof Error) throw next;
    return {
      content: null,
      refusal: null,
      toolCalls: next === undefined ? [] : [{ name: 'propose_matter', arguments: JSON.stringify(next) }],
      finishReason: 'tool_calls',
      usage: null,
    };
  }
}

export class FakeSender implements EmailSender {
  readonly sent: OutboundEmail[] = [];
  /** Every call to send, including the failed ones (a timeout may still have delivered). */
  attempts = 0;
  failWith: Error | null = null;

  async send(email: OutboundEmail) {
    this.attempts += 1;
    // a real provider call takes time: overlapping confirms interleave here
    await Promise.resolve();
    if (this.failWith) throw this.failWith;
    this.sent.push(email);
    return { providerId: `pm-${this.sent.length}` };
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

/**
 * Inbound pipeline (functions/src/whatsapp/webhook.ts): payload extraction, dedupe, flood cap,
 * the link flow, the assistant bridge (quota reuse), confirm/cancel buttons with the 1/2 text
 * fallback, and proposal expiry.
 */
jest.mock('firebase-functions/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

import { HttpsError } from 'firebase-functions/https';

import { WHATSAPP_TUNING } from '../../src/config';
import type { AiAction, AssistantRequest, AssistantResponse, Language } from '../../src/shared/aiContract';
import { BOT_STRINGS } from '../../src/whatsapp/messages';
import { eventDocId, hashLinkCode } from '../../src/whatsapp/signature';
import type { ClaimResult, RedeemResult, WhatsappSession, WhatsappStore } from '../../src/whatsapp/session';
import type { MeetingStore } from '../../src/whatsapp/executor';
import type { WhatsappButton, WhatsappSender } from '../../src/whatsapp/send';
import {
  CANCEL_BUTTON_PREFIX,
  CONFIRM_BUTTON_PREFIX,
  extractInboundMessages,
  processInboundMessage,
  processWebhookPayload,
  textAnswerOf,
  type InboundMessage,
  type WebhookDeps,
} from '../../src/whatsapp/webhook';

const NOW = new Date('2026-10-05T12:00:00.000Z');
const PHONE = '15551234567';

class FakeStore implements WhatsappStore {
  events = new Set<string>();
  links = new Map<string, string>();
  codes = new Map<string, { uid: string; expiresAt: string }>();
  sessions = new Map<string, WhatsappSession>();
  prefs = new Map<string, { language: Language; timezone: string }>();

  async claimEvent(eventId: string): Promise<boolean> {
    if (this.events.has(eventId)) return false;
    this.events.add(eventId);
    return true;
  }
  async getLinkUid(phone: string): Promise<string | null> {
    return this.links.get(phone) ?? null;
  }
  async redeemLinkCode(codeHash: string, phone: string, _name: string | null, now: Date): Promise<RedeemResult> {
    const code = this.codes.get(codeHash);
    if (!code) return { status: 'invalid' };
    this.codes.delete(codeHash);
    if (Date.parse(code.expiresAt) < now.getTime()) return { status: 'expired' };
    this.links.set(phone, code.uid);
    return { status: 'linked', uid: code.uid };
  }
  async getSession(phone: string): Promise<WhatsappSession | null> {
    const session = this.sessions.get(phone);
    return session ? structuredClone(session) : null;
  }
  async putSession(phone: string, session: WhatsappSession): Promise<void> {
    this.sessions.set(phone, structuredClone(session));
  }
  async claimPendingActions(phone: string, nonce: string | null, now: Date): Promise<ClaimResult> {
    const session = this.sessions.get(phone);
    if (!session || session.pendingActions === null || session.uid === null) return { status: 'none' };
    if (nonce !== null && session.pendingNonce !== nonce) return { status: 'none' };
    const { pendingActions, promptMsgId, actionsExpireAt, uid } = session;
    session.pendingActions = null;
    session.pendingNonce = null;
    session.promptMsgId = null;
    session.actionsExpireAt = null;
    const expiresMs = actionsExpireAt !== null ? Date.parse(actionsExpireAt) : NaN;
    if (!Number.isFinite(expiresMs) || expiresMs < now.getTime()) return { status: 'expired' };
    return { status: 'claimed', uid, actions: pendingActions, promptMsgId };
  }
  async getPreferences(uid: string): Promise<{ language: Language; timezone: string }> {
    return this.prefs.get(uid) ?? { language: 'en', timezone: 'UTC' };
  }
}

class FakeSender implements WhatsappSender {
  sent: { kind: 'text' | 'buttons'; to: string; body: string; buttons?: WhatsappButton[] }[] = [];
  failNext = false;

  async sendText(to: string, body: string): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('graph down');
    }
    this.sent.push({ kind: 'text', to, body });
  }
  async sendButtons(to: string, body: string, buttons: readonly WhatsappButton[]): Promise<void> {
    this.sent.push({ kind: 'buttons', to, body, buttons: [...buttons] });
  }
}

class FakeMeetings implements MeetingStore {
  docs = new Map<string, Record<string, unknown>>();
  async getMeeting(uid: string, meetingId: string): Promise<unknown> {
    return this.docs.get(`${uid}/${meetingId}`);
  }
  async createMeeting(uid: string, meetingId: string, doc: Record<string, unknown>): Promise<void> {
    this.docs.set(`${uid}/${meetingId}`, doc);
  }
  async updateMeetingFields(uid: string, meetingId: string, fields: Record<string, unknown>): Promise<void> {
    Object.assign(this.docs.get(`${uid}/${meetingId}`) ?? {}, fields);
  }
  newMeetingId(): string {
    return `m${this.docs.size + 1}`;
  }
}

const usage = { used: 1, limit: 5, plan: 'free' as const, resetsAt: '2026-10-06T00:00:00.000Z' };

function okResponse(overrides: Partial<AssistantResponse> = {}): AssistantResponse {
  return { reply: 'Here you go.', actions: [], suggestions: [], usage, ...overrides };
}

function makeDeps(store: FakeStore, sender: FakeSender, assistant?: WebhookDeps['assistant']) {
  const meetings = new FakeMeetings();
  const requests: { uid: string; request: AssistantRequest }[] = [];
  const deps: WebhookDeps = {
    store,
    sender,
    assistant:
      assistant ??
      (async (uid, request) => {
        requests.push({ uid, request });
        return okResponse();
      }),
    executor: { store: meetings, now: () => NOW },
    dailyLimit: 50,
    displayNumber: '19990001111',
    now: () => NOW,
    newNonce: () => 'nonce1',
  };
  return { deps, meetings, requests };
}

function textMessage(overrides: Partial<InboundMessage> = {}): InboundMessage {
  return { wamid: `wamid.${Math.random().toString(36).slice(2)}`, from: PHONE, type: 'text', text: 'hello', buttonReplyId: null, profileName: 'Ana', ...overrides };
}

function linkedStore(): FakeStore {
  const store = new FakeStore();
  store.links.set(PHONE, 'u1');
  return store;
}

const createAction: AiAction = {
  type: 'create_meeting',
  id: 'a1',
  summary: 'Create "Dentist" Tuesday 9:30',
  confidence: 90,
  meeting: {
    title: 'Dentist',
    description: '',
    startAt: '2026-10-07T09:30:00.000Z',
    durationMinutes: 30,
    timezone: 'UTC',
    allDay: false,
    location: null,
    conference: null,
    participants: [],
    preparationTips: [],
    customAlertTimes: null,
    language: 'en',
  },
};

describe('extractInboundMessages', () => {
  const payload = {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'waba1',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { phone_number_id: '111', display_phone_number: '19990001111' },
              contacts: [{ wa_id: PHONE, profile: { name: 'Ana' } }],
              messages: [
                { id: 'wamid.text', from: PHONE, type: 'text', text: { body: 'hola' } },
                {
                  id: 'wamid.button',
                  from: PHONE,
                  type: 'interactive',
                  interactive: { type: 'button_reply', button_reply: { id: 'wa_confirm:n1', title: 'Confirm' } },
                },
              ],
            },
          },
          { field: 'messages', value: { statuses: [{ id: 'wamid.text', status: 'delivered' }] } },
          { field: 'message_template_status_update', value: {} },
        ],
      },
    ],
  };

  it('flattens messages, keeps the profile name, and drops statuses and other fields', () => {
    const messages = extractInboundMessages(payload);
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ wamid: 'wamid.text', from: PHONE, text: 'hola', buttonReplyId: null, profileName: 'Ana' });
    expect(messages[1]).toMatchObject({ wamid: 'wamid.button', buttonReplyId: 'wa_confirm:n1', text: null });
  });

  it('ignores foreign objects and malformed payloads', () => {
    expect(extractInboundMessages({ object: 'page', entry: [] })).toEqual([]);
    expect(extractInboundMessages(null)).toEqual([]);
    expect(extractInboundMessages('x')).toEqual([]);
  });
});

describe('dedupe and filters', () => {
  it('processes a wamid once and silently absorbs Meta redelivery', async () => {
    const store = new FakeStore();
    const sender = new FakeSender();
    const { deps } = makeDeps(store, sender);
    const message = textMessage({ wamid: 'wamid.same' });
    await processInboundMessage(message, deps);
    const sentAfterFirst = sender.sent.length;
    expect(sentAfterFirst).toBe(1); // link prompt
    await processInboundMessage(message, deps);
    expect(sender.sent.length).toBe(sentAfterFirst);
    expect(store.events.has(eventDocId('wamid.same'))).toBe(true);
  });

  it('ignores echoes from our own number and non-numeric senders', async () => {
    const store = new FakeStore();
    const sender = new FakeSender();
    const { deps } = makeDeps(store, sender);
    await processInboundMessage(textMessage({ from: '19990001111' }), deps);
    await processInboundMessage(textMessage({ from: 'abc' }), deps);
    expect(sender.sent).toEqual([]);
    expect(store.events.size).toBe(0);
  });
});

describe('flood cap', () => {
  it('sends ONE bilingual notice right past the limit, then drops silently', async () => {
    const store = linkedStore();
    const sender = new FakeSender();
    const { deps, requests } = makeDeps(store, sender);
    deps.dailyLimit = 2;
    await processInboundMessage(textMessage(), deps);
    await processInboundMessage(textMessage(), deps);
    expect(requests).toHaveLength(2);
    await processInboundMessage(textMessage(), deps); // 3rd: notice
    await processInboundMessage(textMessage(), deps); // 4th: silence
    expect(requests).toHaveLength(2);
    const notices = sender.sent.filter((item) => item.body.includes(BOT_STRINGS.en.floodNotice));
    expect(notices).toHaveLength(1);
    expect(notices[0]?.body).toContain(BOT_STRINGS.es.floodNotice);
  });
});

describe('link flow (unlinked phones)', () => {
  it('prompts bilingually, capped at unlinkedRepliesPerDay, then goes silent', async () => {
    const store = new FakeStore();
    const sender = new FakeSender();
    const { deps } = makeDeps(store, sender);
    for (let index = 0; index < WHATSAPP_TUNING.unlinkedRepliesPerDay + 2; index += 1) {
      await processInboundMessage(textMessage({ text: 'hi there' }), deps);
    }
    const prompts = sender.sent.filter((item) => item.body.includes(BOT_STRINGS.en.linkPrompt));
    expect(prompts).toHaveLength(WHATSAPP_TUNING.unlinkedRepliesPerDay);
    expect(prompts[0]?.body).toContain(BOT_STRINGS.es.linkPrompt);
  });

  it('links on a valid 6-digit code and confirms bilingually', async () => {
    const store = new FakeStore();
    store.codes.set(hashLinkCode('042099'), { uid: 'u1', expiresAt: new Date(NOW.getTime() + 60_000).toISOString() });
    const sender = new FakeSender();
    const { deps } = makeDeps(store, sender);
    await processInboundMessage(textMessage({ text: ' 042099 ' }), deps);
    expect(store.links.get(PHONE)).toBe('u1');
    expect(sender.sent[0]?.body).toContain(BOT_STRINGS.en.linkSuccess);
    expect(sender.sent[0]?.body).toContain(BOT_STRINGS.es.linkSuccess);
    expect(store.sessions.get(PHONE)?.uid).toBe('u1');
  });

  it('answers codeExpired for an expired code and linkPrompt for an unknown one', async () => {
    const store = new FakeStore();
    store.codes.set(hashLinkCode('111111'), { uid: 'u1', expiresAt: new Date(NOW.getTime() - 1).toISOString() });
    const sender = new FakeSender();
    const { deps } = makeDeps(store, sender);
    await processInboundMessage(textMessage({ text: '111111' }), deps);
    expect(sender.sent[0]?.body).toContain(BOT_STRINGS.en.codeExpired);
    expect(store.links.has(PHONE)).toBe(false);
    await processInboundMessage(textMessage({ text: '999999' }), deps);
    expect(sender.sent[1]?.body).toContain(BOT_STRINGS.en.linkPrompt);
  });
});

describe('assistant bridge (linked phones)', () => {
  it('builds the request from the session turns and the user preferences, and reuses the quota error', async () => {
    const store = linkedStore();
    store.prefs.set('u1', { language: 'es', timezone: 'Europe/Madrid' });
    const sender = new FakeSender();
    const { deps, requests } = makeDeps(store, sender);
    await processInboundMessage(textMessage({ text: 'Que tengo manana?' }), deps);
    expect(requests[0]?.uid).toBe('u1');
    expect(requests[0]?.request).toMatchObject({
      language: 'es',
      timezone: 'Europe/Madrid',
      mode: 'chat',
      followUpMeetingId: null,
      messages: [{ role: 'user', content: 'Que tengo manana?' }],
    });
    expect(sender.sent[0]).toMatchObject({ kind: 'text', body: 'Here you go.' });
    // The next message carries the history (user, assistant, user).
    await processInboundMessage(textMessage({ text: 'and friday?' }), deps);
    expect(requests[1]?.request.messages).toHaveLength(3);
    expect(requests[1]?.request.messages[1]).toEqual({ role: 'assistant', content: 'Here you go.' });
  });

  it('answers the localized quota message on quota_exceeded (same counters as the app callable)', async () => {
    const store = linkedStore();
    store.prefs.set('u1', { language: 'es', timezone: 'UTC' });
    const sender = new FakeSender();
    const quotaError = new HttpsError('resource-exhausted', 'limit', { reason: 'quota_exceeded', usage });
    const { deps } = makeDeps(store, sender, async () => {
      throw quotaError;
    });
    await processInboundMessage(textMessage(), deps);
    expect(sender.sent).toHaveLength(1);
    expect(sender.sent[0]?.body).toBe(BOT_STRINGS.es.quotaExceeded);
  });

  it('answers the generic error on other assistant failures and keeps the 200-side silent', async () => {
    const store = linkedStore();
    const sender = new FakeSender();
    const { deps } = makeDeps(store, sender, async () => {
      throw new HttpsError('unavailable', 'down', { reason: 'upstream_error', usage: null });
    });
    await processInboundMessage(textMessage(), deps);
    expect(sender.sent[0]?.body).toBe(BOT_STRINGS.en.error);
  });

  it('replies unsupportedType to non-text messages', async () => {
    const store = linkedStore();
    const sender = new FakeSender();
    const { deps, requests } = makeDeps(store, sender);
    await processInboundMessage(textMessage({ type: 'audio', text: null }), deps);
    expect(requests).toHaveLength(0);
    expect(sender.sent[0]?.body).toBe(BOT_STRINGS.en.unsupportedType);
  });

  it('a failed send is logged and dropped (never retried, session still saved)', async () => {
    const store = linkedStore();
    const sender = new FakeSender();
    sender.failNext = true;
    const { deps } = makeDeps(store, sender);
    await expect(processInboundMessage(textMessage(), deps)).resolves.toBeUndefined();
    expect(store.sessions.get(PHONE)?.turns.length).toBeGreaterThan(0);
  });
});

describe('proposals and confirmation', () => {
  async function propose(store: FakeStore, sender: FakeSender) {
    const { deps, meetings } = makeDeps(store, sender, async () => okResponse({ reply: 'I can create that.', actions: [createAction] }));
    await processInboundMessage(textMessage({ wamid: 'wamid.prompt', text: 'dentist tuesday 9:30' }), deps);
    return { deps, meetings };
  }

  it('stores pending actions and sends Confirm/Cancel buttons instead of executing', async () => {
    const store = linkedStore();
    const sender = new FakeSender();
    const { meetings } = await propose(store, sender);
    expect(meetings.docs.size).toBe(0); // nothing executed yet
    const buttons = sender.sent.find((item) => item.kind === 'buttons');
    expect(buttons?.body).toContain('- Create "Dentist" Tuesday 9:30');
    expect(buttons?.buttons).toEqual([
      { id: `${CONFIRM_BUTTON_PREFIX}nonce1`, title: 'Confirm' },
      { id: `${CANCEL_BUTTON_PREFIX}nonce1`, title: 'Cancel' },
    ]);
    const session = store.sessions.get(PHONE);
    expect(session?.pendingActions).toHaveLength(1);
    expect(session?.promptMsgId).toBe('wamid.prompt');
    expect(session?.actionsExpireAt).toBe(new Date(NOW.getTime() + WHATSAPP_TUNING.actionsTtlMinutes * 60_000).toISOString());
  });

  it('executes on the Confirm button exactly once (a second tap finds nothing)', async () => {
    const store = linkedStore();
    const sender = new FakeSender();
    const { deps, meetings } = await propose(store, sender);
    const tap = textMessage({ type: 'interactive', text: null, buttonReplyId: `${CONFIRM_BUTTON_PREFIX}nonce1` });
    await processInboundMessage(tap, deps);
    expect(meetings.docs.size).toBe(1);
    expect(sender.sent.at(-1)?.body).toBe(BOT_STRINGS.en.confirmed);
    // Second (differently-id'd) tap: the claim already cleared the proposal.
    await processInboundMessage(textMessage({ type: 'interactive', text: null, buttonReplyId: `${CONFIRM_BUTTON_PREFIX}nonce1` }), deps);
    expect(meetings.docs.size).toBe(1);
    expect(sender.sent.at(-1)?.body).toBe(BOT_STRINGS.en.actionsExpired);
  });

  it('accepts the text fallback: "1"/"si" confirms, "2"/"no" cancels (accent-normalized)', async () => {
    const store = linkedStore();
    const sender = new FakeSender();
    const { deps, meetings } = await propose(store, sender);
    await processInboundMessage(textMessage({ text: 'Si' }), deps);
    expect(meetings.docs.size).toBe(1);

    const store2 = linkedStore();
    const sender2 = new FakeSender();
    const { deps: deps2, meetings: meetings2 } = await propose(store2, sender2);
    await processInboundMessage(textMessage({ text: '2' }), deps2);
    expect(meetings2.docs.size).toBe(0);
    expect(sender2.sent.at(-1)?.body).toBe(BOT_STRINGS.en.cancelled);

    expect(textAnswerOf(' SI ')).toBe('confirm');
    expect(textAnswerOf('sí')).toBe('confirm'); // "si" with an accent
    expect(textAnswerOf('cancelar')).toBe('cancel');
    expect(textAnswerOf('what?')).toBeNull();
  });

  it('expired proposals are not executed (actionsExpired instead)', async () => {
    const store = linkedStore();
    const sender = new FakeSender();
    const { deps, meetings } = await propose(store, sender);
    const session = store.sessions.get(PHONE);
    if (session) session.actionsExpireAt = new Date(NOW.getTime() - 1).toISOString();
    await processInboundMessage(textMessage({ text: '1' }), deps);
    expect(meetings.docs.size).toBe(0);
    expect(sender.sent.at(-1)?.body).toBe(BOT_STRINGS.en.actionsExpired);
  });

  it('a wrong nonce on the button does not claim the proposal', async () => {
    const store = linkedStore();
    const sender = new FakeSender();
    const { deps, meetings } = await propose(store, sender);
    await processInboundMessage(textMessage({ type: 'interactive', text: null, buttonReplyId: `${CONFIRM_BUTTON_PREFIX}other` }), deps);
    expect(meetings.docs.size).toBe(0);
    expect(store.sessions.get(PHONE)?.pendingActions).toHaveLength(1); // the real proposal stays claimable
    expect(sender.sent.at(-1)?.body).toBe(BOT_STRINGS.en.actionsExpired);
  });

  it('share and list actions answer immediately with formatted text, never a confirm prompt', async () => {
    const store = linkedStore();
    const sender = new FakeSender();
    const shareAction: AiAction = { type: 'share_meeting', id: 'a1', summary: 's', confidence: 80, meetingId: 'm1', recipients: [], channel: 'system_share', message: null };
    const listAction: AiAction = { type: 'list', id: 'a2', summary: 's', confidence: 80, meetingIds: [] };
    const { deps, meetings } = makeDeps(store, sender, async () => okResponse({ reply: 'Sure.', actions: [shareAction, listAction] }));
    await meetings.createMeeting('u1', 'm1', {
      userId: 'u1',
      title: 'Board meeting',
      startAt: '2026-10-06T10:00:00.000Z',
      durationMinutes: 60,
      timezone: 'UTC',
      allDay: false,
      deletedAt: null,
      external: {},
    });
    await processInboundMessage(textMessage({ text: 'share the board meeting' }), deps);
    expect(sender.sent.some((item) => item.kind === 'buttons')).toBe(false);
    expect(sender.sent.map((item) => item.body).join('\n')).toContain('*Board meeting*');
    expect(sender.sent.map((item) => item.body).join('\n')).toContain(BOT_STRINGS.en.listEmpty);
    expect(store.sessions.get(PHONE)?.pendingActions).toBeNull();
  });

  it('occurrence/following-scoped proposals are answered as app-only, not queued', async () => {
    const store = linkedStore();
    const sender = new FakeSender();
    const scoped: AiAction = {
      type: 'update_meeting',
      id: 'a1',
      summary: 's',
      confidence: 80,
      meetingId: 'm1',
      changes: { title: 'x' },
      scope: 'occurrence',
      occurrenceDate: '2026-10-06',
    };
    const { deps } = makeDeps(store, sender, async () => okResponse({ actions: [scoped] }));
    await processInboundMessage(textMessage(), deps);
    expect(sender.sent.some((item) => item.body === BOT_STRINGS.en.actionUnsupported)).toBe(true);
    expect(store.sessions.get(PHONE)?.pendingActions).toBeNull();
  });
});

describe('processWebhookPayload', () => {
  it('survives a message that throws and still processes the rest', async () => {
    const store = linkedStore();
    const sender = new FakeSender();
    const { deps, requests } = makeDeps(store, sender);
    const failingStore = store;
    const original = failingStore.getSession.bind(failingStore);
    let first = true;
    failingStore.getSession = async (phone: string) => {
      if (first) {
        first = false;
        throw new Error('firestore down');
      }
      return original(phone);
    };
    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              field: 'messages',
              value: {
                contacts: [{ wa_id: PHONE, profile: { name: 'Ana' } }],
                messages: [
                  { id: 'wamid.a', from: PHONE, type: 'text', text: { body: 'one' } },
                  { id: 'wamid.b', from: PHONE, type: 'text', text: { body: 'two' } },
                ],
              },
            },
          ],
        },
      ],
    };
    await expect(processWebhookPayload(payload, deps)).resolves.toBeUndefined();
    expect(requests).toHaveLength(1);
    expect(requests[0]?.request.messages.at(-1)?.content).toBe('two');
  });
});

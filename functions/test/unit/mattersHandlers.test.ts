import { HttpsError } from 'firebase-functions/https';

import { UpstreamError } from '../../src/assistant/errors';
import { EmailSendError } from '../../src/matters/email';
import {
  handleInboundEmail,
  handleMatterCancel,
  handleMatterConfirm,
  handleMatterDraft,
  handleMatterRevise,
} from '../../src/matters/handlers';
import { CALLER, DOMAIN, NOW, REQUEST, TOKEN, inboundPayload, makeDeps, proposal } from './mattersFakes';

jest.mock('firebase-functions/logger', () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const draftRequest = { text: REQUEST, source: 'text', language: 'en', timeZone: 'Europe/Madrid' };

async function reason(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return 'resolved';
  } catch (error) {
    expect(error).toBeInstanceOf(HttpsError);
    return ((error as HttpsError).details as { reason: string }).reason;
  }
}

describe('matterDraft', () => {
  it('creates a draft with the read-back, the exact first email and a hash to confirm', async () => {
    const { deps, store, llm, sender } = makeDeps();
    llm.queue.push(proposal());
    const draft = await handleMatterDraft(CALLER, draftRequest, deps);
    expect(draft.status).toBe('draft');
    expect(draft.questions).toEqual([]);
    expect(draft.readBack).toContain('I will email Carlos Ruiz (carlos@example.com)');
    expect(draft.firstEmail).toMatchObject({
      from: `"Ana Lopez's AI assistant" <assistant@${DOMAIN}>`,
      to: ['carlos@example.com'],
      cc: ['ana@example.com'],
      subject: 'Updated proposal',
    });
    expect(draft.firstEmail?.text).toMatch(/I am Ana Lopez's AI assistant/);
    expect(draft.draftHash).toMatch(/^[a-f0-9]{64}$/);
    // nothing is sent before the confirmation
    expect(sender.sent).toHaveLength(0);
    const doc = await store.getMatter('u1', draft.matterId);
    expect(doc).toMatchObject({ status: 'draft', replyToken: TOKEN, ownerEmail: 'ana@example.com', confirmedHash: null });
    expect(store.addresses.get(TOKEN)).toEqual({ uid: 'u1', matterId: draft.matterId });
    expect(store.eventTypes('u1', draft.matterId)).toEqual(['created']);
  });

  it('answers with questions and no hash while details are missing', async () => {
    const { deps, llm } = makeDeps();
    llm.queue.push(proposal({ contacts: [{ name: 'Carlos', email: null }] }));
    const draft = await handleMatterDraft(CALLER, { ...draftRequest, text: 'Ask Carlos for the proposal by Friday.' }, deps);
    expect(draft.questions).toEqual(['What is the email address of Carlos?']);
    expect(draft.firstEmail).toBeNull();
    expect(draft.draftHash).toBeNull();
    expect(draft.readBack).toBe('');
  });

  it('needs a verified account, the switch on and the caller on the tester list', async () => {
    const { deps } = makeDeps();
    expect(await reason(handleMatterDraft(null, draftRequest, deps))).toBe('unauthenticated');
    expect(await reason(handleMatterDraft({ ...CALLER, emailVerified: false }, draftRequest, deps))).toBe('unauthenticated');
    expect(await reason(handleMatterDraft({ ...CALLER, emailVerified: false, signInProvider: 'google.com' }, draftRequest, makeDeps({ enabled: false }).deps))).toBe('not_configured');
    expect(await reason(handleMatterDraft(CALLER, draftRequest, makeDeps({ allowed: () => false }).deps))).toBe('not_configured');
  });

  it('validates the request and the zone', async () => {
    const { deps } = makeDeps();
    expect(await reason(handleMatterDraft(CALLER, { ...draftRequest, text: '' }, deps))).toBe('invalid_request');
    expect(await reason(handleMatterDraft(CALLER, { ...draftRequest, timeZone: 'Mars/Base' }, deps))).toBe('invalid_request');
    expect(await reason(handleMatterDraft(CALLER, { ...draftRequest, extra: 1 }, deps))).toBe('invalid_request');
  });

  it('caps drafts per day', async () => {
    const { deps, llm } = makeDeps({ dailyLimit: 1 });
    llm.queue.push(proposal(), proposal());
    await handleMatterDraft(CALLER, draftRequest, deps);
    expect(await reason(handleMatterDraft(CALLER, draftRequest, deps))).toBe('rate_limited');
  });

  it('reports a model failure as upstream_error', async () => {
    const { deps, llm } = makeDeps();
    llm.queue.push(new UpstreamError('timeout', null));
    expect(await reason(handleMatterDraft(CALLER, draftRequest, deps))).toBe('upstream_error');
  });
});

describe('matterRevise', () => {
  it('drafts again from the request plus the answer', async () => {
    const { deps, store, llm } = makeDeps();
    llm.queue.push(proposal({ contacts: [{ name: 'Carlos', email: null }] }));
    const first = await handleMatterDraft(CALLER, { ...draftRequest, text: 'Ask Carlos for the proposal by Friday.' }, deps);
    llm.queue.push(proposal({ contacts: [{ name: 'Carlos', email: 'carlos@example.com' }] }));
    const second = await handleMatterRevise(CALLER, { matterId: first.matterId, answer: 'carlos@example.com' }, deps);
    expect(second.questions).toEqual([]);
    expect(second.draftHash).toMatch(/^[a-f0-9]{64}$/);
    expect(llm.requests[1]!.messages[1]!.content).toContain('Ask Carlos for the proposal by Friday.\ncarlos@example.com');
    expect((await store.getMatter('u1', first.matterId))?.mandateVersion).toBe(2);
    expect(store.eventTypes('u1', first.matterId)).toEqual(['created', 'mandate_drafted']);
  });

  it('only changes the caller\'s own drafts', async () => {
    const { deps, llm } = makeDeps();
    llm.queue.push(proposal());
    const draft = await handleMatterDraft(CALLER, draftRequest, deps);
    expect(await reason(handleMatterRevise({ ...CALLER, uid: 'u2' }, { matterId: draft.matterId, answer: 'x' }, deps))).toBe('not_found');
    await handleMatterConfirm(CALLER, { matterId: draft.matterId, draftHash: draft.draftHash }, deps);
    expect(await reason(handleMatterRevise(CALLER, { matterId: draft.matterId, answer: 'x' }, deps))).toBe('invalid_request');
  });
});

describe('matterConfirm', () => {
  async function confirmedDraft() {
    const ctx = makeDeps();
    ctx.llm.queue.push(proposal());
    const draft = await handleMatterDraft(CALLER, draftRequest, ctx.deps);
    return { ...ctx, draft };
  }

  it('activates the matter and sends exactly the email the user saw, once', async () => {
    const { deps, store, sender, draft } = await confirmedDraft();
    await expect(handleMatterConfirm(CALLER, { matterId: draft.matterId, draftHash: draft.draftHash }, deps)).resolves.toEqual({
      matterId: draft.matterId,
      status: 'active',
      sent: true,
    });
    expect(sender.sent).toHaveLength(1);
    expect(sender.sent[0]).toMatchObject({
      from: draft.firstEmail!.from,
      to: draft.firstEmail!.to,
      cc: draft.firstEmail!.cc,
      subject: draft.firstEmail!.subject,
      text: draft.firstEmail!.text,
      replyTo: `m-${TOKEN}@${DOMAIN}`,
      messageId: `<${draft.matterId}.r1@${DOMAIN}>`,
    });
    const doc = await store.getMatter('u1', draft.matterId);
    expect(doc).toMatchObject({ status: 'active', confirmedHash: draft.draftHash, confirmedAt: NOW.toISOString(), firstSentAt: NOW.toISOString() });
    expect(store.eventTypes('u1', draft.matterId)).toEqual(['created', 'mandate_confirmed', 'email_sent']);
    // a repeated confirm (double tap, retry after a timeout) never sends twice
    await expect(handleMatterConfirm(CALLER, { matterId: draft.matterId, draftHash: draft.draftHash }, deps)).resolves.toMatchObject({ sent: true });
    expect(sender.sent).toHaveLength(1);
  });

  it('refuses a hash that is not the current draft', async () => {
    const { deps, sender, draft } = await confirmedDraft();
    expect(await reason(handleMatterConfirm(CALLER, { matterId: draft.matterId, draftHash: 'a'.repeat(64) }, deps))).toBe('stale_draft');
    expect(await reason(handleMatterConfirm(CALLER, { matterId: 'nope', draftHash: draft.draftHash }, deps))).toBe('not_found');
    expect(sender.sent).toHaveLength(0);
  });

  it('refuses a draft whose end date has passed meanwhile', async () => {
    const { deps, draft } = await confirmedDraft();
    const later = { ...deps, now: () => new Date('2026-11-14T00:00:00Z') };
    expect(await reason(handleMatterConfirm(CALLER, { matterId: draft.matterId, draftHash: draft.draftHash }, later))).toBe('not_allowed');
  });

  it('records a failed send, and the same confirm retries it', async () => {
    const { deps, store, sender, draft } = await confirmedDraft();
    sender.failWith = new EmailSendError('configuration', 412);
    await expect(handleMatterConfirm(CALLER, { matterId: draft.matterId, draftHash: draft.draftHash }, deps)).resolves.toMatchObject({ sent: false });
    expect(store.eventTypes('u1', draft.matterId)).toEqual(['created', 'mandate_confirmed', 'email_failed']);
    expect((await store.getMatter('u1', draft.matterId))?.firstSentAt).toBeNull();
    sender.failWith = null;
    await expect(handleMatterConfirm(CALLER, { matterId: draft.matterId, draftHash: draft.draftHash }, deps)).resolves.toMatchObject({ sent: true });
    expect(sender.sent).toHaveLength(1);
  });

  it('sends nothing once the assistant is switched off', async () => {
    const { deps, sender, draft } = await confirmedDraft();
    expect(await reason(handleMatterConfirm(CALLER, { matterId: draft.matterId, draftHash: draft.draftHash }, { ...deps, enabled: false }))).toBe('not_configured');
    expect(sender.sent).toHaveLength(0);
  });
});

describe('matterCancel', () => {
  it('cancels, idempotently, and only the caller\'s own matters', async () => {
    const { deps, store, llm } = makeDeps();
    llm.queue.push(proposal());
    const draft = await handleMatterDraft(CALLER, draftRequest, deps);
    await expect(handleMatterCancel(CALLER, { matterId: draft.matterId }, deps)).resolves.toEqual({ matterId: draft.matterId, status: 'cancelled' });
    await expect(handleMatterCancel(CALLER, { matterId: draft.matterId }, deps)).resolves.toMatchObject({ status: 'cancelled' });
    expect(store.eventTypes('u1', draft.matterId)).toEqual(['created', 'status_changed']);
    expect(await reason(handleMatterCancel({ ...CALLER, uid: 'u2' }, { matterId: draft.matterId }, deps))).toBe('not_found');
  });
});

describe('inbound email', () => {
  it('attaches a reply to its matter, once, by the reply address', async () => {
    const { deps, store, llm } = makeDeps();
    llm.queue.push(proposal());
    const draft = await handleMatterDraft(CALLER, draftRequest, deps);
    await handleMatterConfirm(CALLER, { matterId: draft.matterId, draftHash: draft.draftHash }, deps);
    const inbound = { store, now: deps.now, domain: DOMAIN, markerTtlDays: 7 };
    await expect(handleInboundEmail(inboundPayload(), inbound)).resolves.toBe('stored');
    await expect(handleInboundEmail(inboundPayload(), inbound)).resolves.toBe('duplicate');
    const messages = store.messages.get(`u1/${draft.matterId}`)!;
    expect(messages.map((m) => m.direction)).toEqual(['outbound', 'inbound']);
    expect(messages[1]).toMatchObject({ from: { email: 'carlos@example.com' }, text: 'Here it is.', auth: null });
    expect(store.eventTypes('u1', draft.matterId)).toEqual(['created', 'mandate_confirmed', 'email_sent', 'email_received']);
  });

  it('drops unmatched and unusable emails without storing anything', async () => {
    const { deps, store } = makeDeps();
    const inbound = { store, now: deps.now, domain: DOMAIN, markerTtlDays: 7 };
    await expect(handleInboundEmail(inboundPayload(), inbound)).resolves.toBe('unmatched');
    await expect(handleInboundEmail({ hello: 'world' }, inbound)).resolves.toBe('ignored');
    expect(store.messages.size).toBe(0);
  });

  it('lets the provider retry when storing failed', async () => {
    const { deps, store, llm } = makeDeps();
    llm.queue.push(proposal());
    await handleMatterDraft(CALLER, draftRequest, deps);
    const inbound = { store, now: deps.now, domain: DOMAIN, markerTtlDays: 7 };
    const add = jest.spyOn(store, 'addMessage').mockRejectedValueOnce(new Error('unavailable'));
    await expect(handleInboundEmail(inboundPayload(), inbound)).rejects.toThrow('unavailable');
    add.mockRestore();
    await expect(handleInboundEmail(inboundPayload(), inbound)).resolves.toBe('stored');
  });
});

import { normalizeProposal, buildDraftMessages, draftMatter, PROPOSE_MATTER_TOOL } from '../../src/matters/draft';
import { composeFirstEmail, createPostmarkSender, postmarkPayload, POSTMARK_API_URL, type EmailSendError } from '../../src/matters/email';
import { matchInbound, parseInbound, toMatterMessage } from '../../src/matters/inbound';
import { draftHash, matterMessageSchema, messageIdKey, type MatterDoc } from '../../src/matters/model';
import { checkSend } from '../../src/matters/sendCheck';
import { disclosureFooter, readBack, senderName } from '../../src/matters/text';
import { FakeLlm, FakeMatterStore, DOMAIN, NOW, REQUEST, TOKEN, inboundPayload, proposal } from './mattersFakes';

const ctx = (overrides: Partial<Parameters<typeof normalizeProposal>[1]> = {}) => ({
  request: REQUEST,
  language: 'en' as const,
  timeZone: 'Europe/Madrid',
  ownerName: 'Ana Lopez',
  ownerEmail: 'ana@example.com',
  now: NOW,
  ...overrides,
});

const NO_FANCY_PUNCTUATION = /[\u2013\u2014\u2026\u2018\u2019\u201c\u201d]/;

describe('matters draft: the model proposes, code decides', () => {
  it('turns a complete proposal into a mandate and a first email', () => {
    const result = normalizeProposal(proposal(), ctx());
    expect(result.questions).toEqual([]);
    expect(result.mandate).toMatchObject({
      contacts: [{ name: 'Carlos Ruiz', email: 'carlos@example.com' }],
      meeting: { durationMinutes: 30, windows: [] },
      followUp: { everyDays: 2, maxCount: 3 },
      endsAt: '2026-11-13T17:00:00.000Z',
      copyOwner: 'cc',
      language: 'en',
      timeZone: 'Europe/Madrid',
    });
    expect(result.firstEmail?.subject).toBe('Updated proposal');
  });

  it('never uses an email address the user did not give, and asks for it instead', () => {
    const result = normalizeProposal(proposal({ contacts: [{ name: 'Carlos Ruiz', email: 'carlos.ruiz@company.com' }] }), ctx());
    expect(result.mandate).toBeNull();
    expect(result.firstEmail).toBeNull();
    expect(result.questions).toEqual(['What is the email address of Carlos Ruiz?']);
  });

  it('asks for the end date when it is missing, past or too far away', () => {
    expect(normalizeProposal(proposal({ ends_at: null }), ctx()).questions).toEqual(['Until when should I keep working on this?']);
    expect(normalizeProposal(proposal({ ends_at: '2026-11-01T10:00:00Z' }), ctx()).questions[0]).toMatch(/already passed/);
    expect(normalizeProposal(proposal({ ends_at: '2027-06-01T10:00:00Z' }), ctx()).questions[0]).toMatch(/at most 90 days/);
  });

  it('asks in Spanish for a Spanish user', () => {
    const result = normalizeProposal(proposal({ ends_at: null, contacts: [{ name: 'Carlos', email: null }] }), ctx({ language: 'es' }));
    expect(result.questions).toEqual(['¿Cuál es la dirección de correo de Carlos?', '¿Hasta cuándo debo seguir con este asunto?']);
  });

  it('keeps the model\'s own questions, and nothing is complete while any remain', () => {
    const result = normalizeProposal(proposal({ questions: ['Should the meeting be online?'] }), ctx());
    expect(result.mandate).toBeNull();
    expect(result.questions).toEqual(['Should the meeting be online?']);
  });

  it('clips meeting windows to now and the end date, and clamps follow-ups', () => {
    const result = normalizeProposal(
      proposal({
        meeting: {
          needed: true,
          duration_minutes: 2,
          windows: [
            { start: '2026-11-12T08:00:00Z', end: '2026-11-12T12:00:00Z' },
            { start: '2026-11-13T16:00:00Z', end: '2026-11-13T20:00:00Z' },
            { start: '2026-11-20T09:00:00Z', end: '2026-11-20T10:00:00Z' },
          ],
        },
        follow_up: { every_days: 40, max_count: 50 },
      }),
      ctx(),
    );
    expect(result.mandate?.meeting).toEqual({
      durationMinutes: 5,
      windows: [
        { start: '2026-11-12T09:00:00.000Z', end: '2026-11-12T12:00:00.000Z' },
        { start: '2026-11-13T16:00:00.000Z', end: '2026-11-13T17:00:00.000Z' },
      ],
    });
    expect(result.mandate?.followUp).toEqual({ everyDays: 14, maxCount: 10 });
  });

  it('falls back to one summary a day when the owner has no verified email for the copies', () => {
    expect(normalizeProposal(proposal(), ctx({ ownerEmail: null })).mandate?.copyOwner).toBe('daily_summary');
  });

  it('turns fancy punctuation into plain punctuation', () => {
    const result = normalizeProposal(proposal({ first_email: { subject: 'Proposal \u2014 update', text: 'Hi Carlos \u2026 \u201cthanks\u201d' } }), ctx());
    expect(result.firstEmail?.subject).toBe('Proposal - update');
    expect(result.firstEmail?.text).not.toMatch(NO_FANCY_PUNCTUATION);
  });

  it('asks to say it again when the proposal is unusable', () => {
    expect(normalizeProposal({ nonsense: true }, ctx()).questions[0]).toMatch(/did not quite get/);
    expect(normalizeProposal(proposal({ first_email: { subject: '', text: '' } }), ctx()).questions[0]).toMatch(/did not quite get/);
  });

  it('calls the model once with the strict tool and the user\'s words fenced off', async () => {
    const llm = new FakeLlm();
    llm.queue.push(proposal());
    const result = await draftMatter(llm, ctx(), 'safety');
    expect(result.mandate).not.toBeNull();
    expect(llm.requests).toHaveLength(1);
    expect(llm.requests[0]!.tools).toEqual([PROPOSE_MATTER_TOOL]);
    expect(llm.requests[0]!.toolChoice).toBe('required');
    const messages = buildDraftMessages(ctx());
    const system = messages[0]!;
    const user = messages[1]!;
    expect(system.content).toMatch(/Never invent or guess an email address/);
    expect(system.content).toMatch(/never pay, accept a price, negotiate money/);
    expect(system.content).toMatch(/2026-11-12T10:00 \+01:00 \(Thursday\)/);
    expect(user.content).toBe(`<request>\n${REQUEST}\n</request>`);
  });

  it('treats a missing tool call as an unusable proposal', async () => {
    const llm = new FakeLlm();
    expect((await draftMatter(llm, ctx(), 's')).questions[0]).toMatch(/did not quite get/);
  });
});

describe('matters text: the read-back and the email framing', () => {
  const mandate = normalizeProposal(proposal({ meeting: { needed: true, duration_minutes: 30, windows: [{ start: '2026-11-13T08:00:00Z', end: '2026-11-13T12:00:00Z' }] } }), ctx()).mandate!;

  it('reads the whole mandate back in English, in the user\'s zone', () => {
    const text = readBack(mandate, 'ana@example.com', 'en');
    expect(text).toContain('I will email Carlos Ruiz (carlos@example.com) from my own address, as your AI assistant.');
    expect(text).toContain('I may ask for: the updated proposal; a time for a 30 minute meeting.');
    expect(text).toContain('Meeting: 30 minutes, at a free time in your calendar: Fri, Nov 13, 9:00 AM to 1:00 PM. I ask you before booking it.');
    expect(text).toContain('Follow-ups: if there is no answer, every 2 days, at most 3 times.');
    expect(text).toContain('Until: Fri, Nov 13, 6:00 PM (Europe/Madrid).');
    expect(text).toContain('Your copy: every email in copy to ana@example.com.');
    expect(text).toContain('Nothing is sent until you confirm.');
    expect(text).not.toMatch(NO_FANCY_PUNCTUATION);
  });

  it('reads it back in Spanish', () => {
    const text = readBack({ ...mandate, followUp: { everyDays: 1, maxCount: 1 }, copyOwner: 'daily_summary' }, null, 'es');
    expect(text).toContain('Voy a escribir a Carlos Ruiz (carlos@example.com) desde mi propia dirección, como tu asistente de IA.');
    expect(text).toContain('Seguimiento: si no hay respuesta, cada 1 día, como máximo 1 vez.');
    expect(text).toContain('Tu copia: un resumen al día.');
    expect(text).toContain('No se envía nada hasta que lo confirmes.');
  });

  it('always says it is an AI assistant, and keeps names safe in headers', () => {
    expect(senderName('Ana Lopez', 'en')).toBe("Ana Lopez's AI assistant");
    expect(senderName('Ana Lopez', 'es')).toBe('Asistente de IA de Ana Lopez');
    expect(senderName('', 'en')).toBe('Meeting Guard AI assistant');
    expect(senderName('Eve" <evil@x.com>\r\nBcc: a@b.c', 'en')).toBe("Eve evil@x.com Bcc: a@b.c's AI assistant");
    expect(disclosureFooter('Ana Lopez', 'en')).toMatch(/^--\nI am Ana Lopez's AI assistant\. This email was written by AI/);
  });
});

function activeMatter(overrides: Partial<MatterDoc> = {}): MatterDoc {
  const draft = normalizeProposal(proposal(), ctx());
  const base: MatterDoc = {
    status: 'active',
    language: 'en',
    timeZone: 'Europe/Madrid',
    title: draft.title,
    request: REQUEST,
    source: 'text',
    ownerName: 'Ana Lopez',
    ownerEmail: 'ana@example.com',
    mandate: draft.mandate,
    firstEmail: draft.firstEmail,
    questions: [],
    readBack: '',
    mandateVersion: 1,
    confirmedHash: draftHash(draft.mandate!, draft.firstEmail!),
    confirmedAt: NOW.toISOString(),
    firstSentAt: null,
    replyToken: TOKEN,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    endedAt: null,
    ...overrides,
  };
  return base;
}

describe('matters send check (code, never the model)', () => {
  const send = (matter: MatterDoc, to: string[], cc: string[] = [], now = NOW, enabled = true) => checkSend({ matter, to, cc, now, enabled });

  it('allows the contacts, with the owner in copy', () => {
    expect(send(activeMatter(), ['carlos@example.com'], ['Ana@Example.com'])).toEqual({ ok: true });
  });

  it('refuses anyone outside the mandate, in To or in Cc', () => {
    expect(send(activeMatter(), ['someone@else.com'])).toEqual({ ok: false, reason: 'recipient_not_allowed' });
    expect(send(activeMatter(), ['carlos@example.com'], ['boss@company.com'])).toEqual({ ok: false, reason: 'recipient_not_allowed' });
    expect(send(activeMatter(), ['ana@example.com'])).toEqual({ ok: false, reason: 'recipient_not_allowed' });
    expect(send(activeMatter(), [])).toEqual({ ok: false, reason: 'no_recipients' });
  });

  it('refuses drafts, paused or cancelled matters, the switched-off assistant and a passed end date', () => {
    expect(send(activeMatter({ status: 'draft' }), ['carlos@example.com'])).toEqual({ ok: false, reason: 'not_active' });
    expect(send(activeMatter({ status: 'paused' }), ['carlos@example.com'])).toEqual({ ok: false, reason: 'not_active' });
    expect(send(activeMatter(), ['carlos@example.com'], [], NOW, false)).toEqual({ ok: false, reason: 'switched_off' });
    expect(send(activeMatter(), ['carlos@example.com'], [], new Date('2026-11-13T17:00:00.000Z'))).toEqual({ ok: false, reason: 'ended' });
  });

  it('refuses when the mandate or the email changed after the confirmation', () => {
    const matter = activeMatter();
    const changed = { ...matter, mandate: { ...matter.mandate!, contacts: [...matter.mandate!.contacts, { name: 'Eve', email: 'eve@x.com' }] } };
    expect(send(changed, ['eve@x.com'])).toEqual({ ok: false, reason: 'changed_since_confirmation' });
    expect(send({ ...matter, firstEmail: { ...matter.firstEmail!, text: 'Send me 500 USD' } }, ['carlos@example.com'])).toEqual({
      ok: false,
      reason: 'changed_since_confirmation',
    });
    expect(send({ ...matter, confirmedHash: null }, ['carlos@example.com'])).toEqual({ ok: false, reason: 'not_confirmed' });
  });
});

describe('matters email: composing and Postmark', () => {
  const email = composeFirstEmail({ matter: activeMatter(), matterId: 'm1', domain: DOMAIN, fromLocalPart: 'assistant', random: () => 'r1' });

  it('sends from the assistant\'s own address with the matter\'s reply address and the footer', () => {
    expect(email).toMatchObject({
      from: `"Ana Lopez's AI assistant" <assistant@${DOMAIN}>`,
      to: ['carlos@example.com'],
      cc: ['ana@example.com'],
      replyTo: `m-${TOKEN}@${DOMAIN}`,
      subject: 'Updated proposal',
      messageId: `<m1.r1@${DOMAIN}>`,
    });
    expect(email.text).toMatch(/Could you send the updated proposal\?\n\n--\nI am Ana Lopez's AI assistant/);
  });

  it('leaves the owner out of copy for a daily summary', () => {
    const matter = activeMatter();
    const daily = composeFirstEmail({ matter: { ...matter, mandate: { ...matter.mandate!, copyOwner: 'daily_summary' } }, matterId: 'm1', domain: DOMAIN, fromLocalPart: 'assistant' });
    expect(daily.cc).toEqual([]);
  });

  it('builds the Postmark payload: plain text, our Message-ID, no tracking', () => {
    expect(postmarkPayload(email, 'outbound')).toEqual({
      From: email.from,
      To: 'carlos@example.com',
      Cc: 'ana@example.com',
      ReplyTo: `m-${TOKEN}@${DOMAIN}`,
      Subject: 'Updated proposal',
      TextBody: email.text,
      MessageStream: 'outbound',
      Headers: [{ Name: 'Message-ID', Value: `<m1.r1@${DOMAIN}>` }],
      TrackOpens: false,
      TrackLinks: 'None',
    });
  });

  function fakeFetch(status: number, body: unknown) {
    const calls: { url: string; init: { headers: Record<string, string>; body: string } }[] = [];
    const fn = jest.fn(async (url: string, init: { method: string; headers: Record<string, string>; body: string }) => {
      calls.push({ url, init });
      return { status, json: async () => body };
    });
    return { fn, calls };
  }

  it('sends with the server token (the public test token works without an account)', async () => {
    const { fn, calls } = fakeFetch(200, { ErrorCode: 0, Message: 'Test job accepted', MessageID: 'pm-1' });
    const sender = createPostmarkSender({ token: 'POSTMARK_API_TEST', messageStream: 'outbound', timeoutMs: 1000, fetch: fn });
    await expect(sender.send(email)).resolves.toEqual({ providerId: 'pm-1' });
    expect(calls[0]!.url).toBe(POSTMARK_API_URL);
    expect(calls[0]!.init.headers['X-Postmark-Server-Token']).toBe('POSTMARK_API_TEST');
    expect(JSON.parse(calls[0]!.init.body).To).toBe('carlos@example.com');
  });

  it('maps Postmark errors to categories, never to its message text', async () => {
    const kinds = async (status: number, body: unknown) => {
      const sender = createPostmarkSender({ token: 't', messageStream: 'outbound', timeoutMs: 1000, fetch: fakeFetch(status, body).fn });
      return sender.send(email).then(
        () => 'sent',
        (error: EmailSendError) => `${error.kind}:${error.code}`,
      );
    };
    expect(await kinds(401, { ErrorCode: 10, Message: 'Bad token' })).toBe('configuration:10');
    expect(await kinds(422, { ErrorCode: 412, Message: 'Account pending approval' })).toBe('configuration:412');
    expect(await kinds(422, { ErrorCode: 300, Message: 'Invalid email request' })).toBe('rejected:300');
    expect(await kinds(429, {})).toBe('rate_limited:429');
    expect(await kinds(503, {})).toBe('server:503');
    const empty = createPostmarkSender({ token: ' ', messageStream: 'outbound', timeoutMs: 1000, fetch: fakeFetch(200, {}).fn });
    await expect(empty.send(email)).rejects.toMatchObject({ kind: 'configuration' });
    const offline = createPostmarkSender({
      token: 't',
      messageStream: 'outbound',
      timeoutMs: 1000,
      fetch: async () => {
        throw new TypeError('fetch failed');
      },
    });
    await expect(offline.send(email)).rejects.toMatchObject({ kind: 'connection' });
  });
});

describe('matters inbound: reading Postmark and finding the matter', () => {
  it('reads the reply, its thread headers and the stripped text', () => {
    const email = parseInbound(inboundPayload())!;
    expect(email).toMatchObject({
      providerId: '73e6d360-66eb-11e1-8e72-a8904824019b',
      from: { name: 'Carlos Ruiz', email: 'carlos@example.com' },
      to: [`m-${TOKEN}@${DOMAIN}`],
      subject: 'Re: Updated proposal',
      text: 'Here it is.',
      rfcMessageId: '<CAF=abc123@mail.gmail.com>',
      inReplyTo: `<m1.r1@${DOMAIN}>`,
      references: [`<m1.r1@${DOMAIN}>`],
    });
    expect(matterMessageSchema.safeParse(toMatterMessage(email, NOW.toISOString())).success).toBe(true);
  });

  it('ignores payloads that are not usable emails', () => {
    expect(parseInbound(null)).toBeNull();
    expect(parseInbound({ ...inboundPayload(), MessageID: '' })).toBeNull();
    expect(parseInbound({ ...inboundPayload(), FromFull: { Email: 'not an address' }, From: 'nope' })).toBeNull();
  });

  it('matches by the reply address first, then by the thread, else not at all', async () => {
    const store = new FakeMatterStore();
    store.addresses.set(TOKEN, { uid: 'u1', matterId: 'm1' });
    store.messageIds.set(messageIdKey(`<m2.r9@${DOMAIN}>`), { uid: 'u1', matterId: 'm2' });
    const byAddress = parseInbound(inboundPayload())!;
    expect(await matchInbound(byAddress, DOMAIN, store)).toEqual({ uid: 'u1', matterId: 'm1' });

    const forwarded = parseInbound(
      inboundPayload({
        ToFull: [{ Email: `assistant@${DOMAIN}` }],
        OriginalRecipient: `assistant@${DOMAIN}`,
        Headers: [{ Name: 'In-Reply-To', Value: `<m2.r9@${DOMAIN}>` }],
      }),
    )!;
    expect(await matchInbound(forwarded, DOMAIN, store)).toEqual({ uid: 'u1', matterId: 'm2' });

    const stranger = parseInbound(inboundPayload({ ToFull: [{ Email: `assistant@${DOMAIN}` }], OriginalRecipient: '', Headers: [] }))!;
    expect(await matchInbound(stranger, DOMAIN, store)).toBeNull();

    const otherDomain = parseInbound(inboundPayload({ ToFull: [{ Email: `m-${TOKEN}@evil.example` }], OriginalRecipient: '', Headers: [] }))!;
    expect(await matchInbound(otherDomain, DOMAIN, store)).toBeNull();
  });
});

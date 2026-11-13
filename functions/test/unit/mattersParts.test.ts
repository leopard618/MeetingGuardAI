import { addressesIn, normalizeProposal, buildDraftMessages, draftMatter, PROPOSE_MATTER_TOOL, stripSignature } from '../../src/matters/draft';
import { composeFirstEmail, createPostmarkSender, postmarkPayload, POSTMARK_API_URL, type EmailSendError } from '../../src/matters/email';
import { matchInbound, ownMessageIdMatter, parseInbound, toMatterMessage } from '../../src/matters/inbound';
import { MATTER_LIMITS, draftHash, isOwnDomain, matterMessageSchema, messageIdKey, type Mandate, type MatterDoc } from '../../src/matters/model';
import { checkSend } from '../../src/matters/sendCheck';
import { disclosureFooter, formatWindow, readBack, senderName } from '../../src/matters/text';
import { FakeLlm, FakeMatterStore, DOMAIN, NOW, REQUEST, TOKEN, inboundPayload, proposal } from './mattersFakes';

const ctx = (overrides: Partial<Parameters<typeof normalizeProposal>[1]> = {}) => ({
  request: REQUEST,
  language: 'en' as const,
  timeZone: 'Europe/Madrid',
  ownerName: 'Ana Lopez',
  ownerEmail: 'ana@example.com',
  now: NOW,
  domain: DOMAIN,
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

  it('accepts only a whole address the user wrote, never a part of a longer one', () => {
    const asked = (email: string, request: string) =>
      normalizeProposal(proposal({ contacts: [{ name: 'Martinez', email }] }), ctx({ request })).questions.includes('What is the email address of Martinez?');
    // the substring trap: martinez@acme.com is not what the user wrote
    expect(asked('martinez@acme.com', 'Write to ana.martinez@acme.com until Friday.')).toBe(true);
    expect(asked('martinez@acme.co', 'Write to martinez@acme.com until Friday.')).toBe(true);
    expect(asked('artinez@acme.com', 'Write to martinez@acme.com until Friday.')).toBe(true);
    // the exact address, in any case and with sentence punctuation or brackets around it
    expect(asked('martinez@acme.com', 'Write to martinez@acme.com.')).toBe(false);
    expect(asked('Martinez@Acme.com', 'Write to Martinez (MARTINEZ@ACME.COM), until Friday')).toBe(false);
    expect(asked('martinez@acme.com', 'Martinez <martinez@acme.com>; until Friday')).toBe(false);
  });

  it('keeps an apostrophe inside an address, and strips quotes and punctuation only at its ends', () => {
    const asked = (email: string, request: string) =>
      normalizeProposal(proposal({ contacts: [{ name: 'Sean', email }] }), ctx({ request })).questions.includes('What is the email address of Sean?');
    expect(asked("o'brien@acme.com", "Write to Sean O'Brien at o'brien@acme.com until Friday.")).toBe(false);
    // a different mailbox: never taken from o'brien@acme.com
    expect(asked('brien@acme.com', "Write to Sean O'Brien at o'brien@acme.com until Friday.")).toBe(true);
    expect(asked('ana@acme.com', 'Escribe a Sean, \u00bfana@acme.com? hasta el viernes')).toBe(false);
    expect(asked('ana@acme.com', 'Write to \u2018ana@acme.com\u2019 until Friday')).toBe(false);
    expect(asked('ana@acme.com', 'Write to \u00abana@acme.com\u00bb until Friday')).toBe(false);
    expect(asked('ana@acme.com', 'Write to ana@acme.com\u2026 until Friday')).toBe(false);
    expect(asked('ana@acme.com', "Write to 'ana@acme.com'. Until Friday")).toBe(false);
  });

  it('never takes an address on our own mail domain as a contact', () => {
    const request = `Write to Carlos at m-${TOKEN}@${DOMAIN} until Friday.`;
    const result = normalizeProposal(proposal({ contacts: [{ name: 'Carlos', email: `m-${TOKEN}@${DOMAIN}` }] }), ctx({ request }));
    expect(result.mandate).toBeNull();
    expect(result.questions[0]).toMatch(/belongs to the assistant itself, not to Carlos/);
    expect(isOwnDomain(`x@mail.${DOMAIN}`, DOMAIN)).toBe(true);
    expect(isOwnDomain('x@meetingguard.ai', DOMAIN)).toBe(false);
    expect(isOwnDomain(`x@not${DOMAIN}`, DOMAIN)).toBe(false);
  });

  it('finds the whole addresses in the user\'s words', () => {
    expect([...addressesIn('Ana (ana.martinez@acme.com), Bob <BOB@x.io>; carl@y.es. Not: @nobody, mail me at')].sort()).toEqual([
      'ana.martinez@acme.com',
      'bob@x.io',
      'carl@y.es',
    ]);
    expect([...addressesIn("Sean <o'brien@acme.com>, \u00bfana@acme.com?, `x{1}@y.io`")].sort()).toEqual(['ana@acme.com', "o'brien@acme.com", 'x{1}@y.io']);
  });

  it('removes a name the model put under the closing (code signs every email)', () => {
    const names = ['Ana Lopez', "Ana Lopez's AI assistant"];
    expect(stripSignature('Hello Carlos,\nCould you send it?\nBest,\nAna Lopez', names)).toBe('Hello Carlos,\nCould you send it?\nBest,');
    expect(stripSignature("Hello,\nBest,\nana lopez's ai assistant\n", names)).toBe('Hello,\nBest,');
    expect(stripSignature('Hello Ana Lopez,\nBest,', names)).toBe('Hello Ana Lopez,\nBest,');
    const result = normalizeProposal(proposal({ first_email: { subject: 'Proposal', text: 'Hi Carlos,\nCould you send it?\nBest,\nAna Lopez' } }), ctx());
    expect(result.firstEmail?.text).toBe('Hi Carlos,\nCould you send it?\nBest,');
  });

  it('asks again when every meeting time the user gave is past or after the end date (never "any time")', () => {
    const past = { start: '2026-11-01T08:00:00Z', end: '2026-11-01T12:00:00Z' };
    const late = { start: '2026-12-01T08:00:00Z', end: '2026-12-01T12:00:00Z' };
    const result = normalizeProposal(proposal({ meeting: { needed: true, duration_minutes: 30, windows: [past, late] } }), ctx());
    expect(result.mandate).toBeNull();
    expect(result.questions).toEqual(['The meeting times you gave are already past or after the end date. Which days and times work for you?']);
    // no times given: any free time before the end date, as before
    expect(normalizeProposal(proposal({ meeting: { needed: true, duration_minutes: 30, windows: [] } }), ctx()).mandate?.meeting?.windows).toEqual([]);
  });

  it('drops model questions that repeat the code\'s own email or end date question', () => {
    const result = normalizeProposal(
      proposal({
        contacts: [{ name: 'Ana', email: null }],
        ends_at: null,
        questions: ["What should I use as Ana's email address?", 'Until when should I follow up?', 'Should the call be on video?'],
      }),
      ctx({ request: 'Set up a call with Ana next week.' }),
    );
    expect(result.questions).toEqual(['What is the email address of Ana?', 'Until when should I keep working on this?', 'Should the call be on video?']);
    const es = normalizeProposal(
      proposal({ contacts: [{ name: 'Ana', email: null }], questions: ['¿Cuál es el correo de Ana?', '¿La llamada es por video?'] }),
      ctx({ language: 'es', request: 'Organiza una llamada con Ana hasta el viernes.' }),
    );
    expect(es.questions).toEqual(['¿Cuál es la dirección de correo de Ana?', '¿La llamada es por video?']);
  });

  it('keeps a model question about the address when the code did not ask for one', () => {
    const result = normalizeProposal(proposal({ questions: ['Should I also write to Carlos\'s assistant by email?'] }), ctx());
    expect(result.questions).toEqual(["Should I also write to Carlos's assistant by email?"]);
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

  it('fits the longest possible mandate in the read-back limit, in both languages', () => {
    const long = (n: number) => `${'a'.repeat(64)}${n}@${'b'.repeat(60)}.${'c'.repeat(60)}.${'d'.repeat(60)}.com`;
    const longest: Mandate = {
      ...mandate,
      contacts: [1, 2, 3, 4, 5].map((n) => ({ name: 'N'.repeat(MATTER_LIMITS.nameChars - 1) + n, email: long(n) })),
      goal: 'g'.repeat(MATTER_LIMITS.goalChars),
      mayAsk: Array.from({ length: MATTER_LIMITS.maxAskItems }, () => 'm'.repeat(MATTER_LIMITS.itemChars)),
      meeting: {
        durationMinutes: MATTER_LIMITS.meetingMinutesMax,
        windows: Array.from({ length: MATTER_LIMITS.maxTimeWindows }, (_, i) => ({ start: `2026-11-1${i}T09:15:00Z`, end: `2026-11-2${i}T10:45:00Z` })),
      },
      followUp: { everyDays: MATTER_LIMITS.followUpEveryDaysMax, maxCount: MATTER_LIMITS.followUpMaxCount },
      timeZone: 'America/Argentina/ComodRivadavia',
    };
    for (const language of ['en', 'es'] as const) {
      expect(readBack(longest, long(9), language).length).toBeLessThanOrEqual(MATTER_LIMITS.readBackChars);
    }
  });

  it('reads it back in Spanish', () => {
    const text = readBack({ ...mandate, followUp: { everyDays: 1, maxCount: 1 }, copyOwner: 'daily_summary' }, null, 'es');
    expect(text).toContain('Voy a escribir a Carlos Ruiz (carlos@example.com) desde mi propia dirección, como tu asistente de IA.');
    expect(text).toContain('Seguimiento: si no hay respuesta, cada 1 día, como máximo 1 vez.');
    expect(text).toContain('Tu copia: un resumen al día.');
    expect(text).toContain('no escribo a nadie más.');
    expect(text).toContain('No se envía nada hasta que lo confirmes.');
  });

  it('shows whole-day meeting windows as dates, never as 0:00', () => {
    const z = 'America/Los_Angeles';
    // Mon Nov 16 00:00 to Sun Nov 22 18:00 local (the end clipped to the end date)
    expect(formatWindow({ start: '2026-11-16T08:00:00Z', end: '2026-11-23T02:00:00Z' }, z, 'es')).toBe('lun, 16 nov a dom, 22 nov, 18:00');
    // whole days: midnight to midnight, or to 23:59
    expect(formatWindow({ start: '2026-11-16T08:00:00Z', end: '2026-11-21T08:00:00Z' }, z, 'en')).toBe('Mon, Nov 16 to Fri, Nov 20');
    expect(formatWindow({ start: '2026-11-16T08:00:00Z', end: '2026-11-17T07:59:00Z' }, z, 'en')).toBe('Mon, Nov 16');
    // a window with real hours keeps them
    expect(formatWindow({ start: '2026-11-16T17:00:00Z', end: '2026-11-16T21:00:00Z' }, z, 'en')).toBe('Mon, Nov 16, 9:00 AM to 1:00 PM');
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
    firstSendState: 'none',
    firstSendClaimedAt: null,
    replyToken: TOKEN,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    endedAt: null,
    ...overrides,
  };
  return base;
}

describe('matters send check (code, never the model)', () => {
  const send = (matter: MatterDoc, to: string[], cc: string[] = [], now = NOW, enabled = true) => checkSend({ matter, to, cc, now, enabled, domain: DOMAIN });

  it('allows the contacts, with the owner in copy', () => {
    expect(send(activeMatter(), ['carlos@example.com'], ['Ana@Example.com'])).toEqual({ ok: true });
  });

  it('refuses anyone outside the mandate, in To or in Cc', () => {
    expect(send(activeMatter(), ['someone@else.com'])).toEqual({ ok: false, reason: 'recipient_not_allowed' });
    expect(send(activeMatter(), ['carlos@example.com'], ['boss@company.com'])).toEqual({ ok: false, reason: 'recipient_not_allowed' });
    expect(send(activeMatter(), ['ana@example.com'])).toEqual({ ok: false, reason: 'recipient_not_allowed' });
    expect(send(activeMatter(), [])).toEqual({ ok: false, reason: 'no_recipients' });
  });

  it('never sends to our own mail domain, even a contact on it (mail loops)', () => {
    const own = `m-${TOKEN}@${DOMAIN}`;
    const base = activeMatter();
    const mandate = { ...base.mandate!, contacts: [{ name: 'Loop', email: own }] };
    const matter = { ...base, mandate, confirmedHash: draftHash(mandate, base.firstEmail!) };
    expect(send(matter, [own])).toEqual({ ok: false, reason: 'own_domain' });
    expect(send({ ...base, ownerEmail: `ana@sub.${DOMAIN}` }, ['carlos@example.com'], [`ana@sub.${DOMAIN}`])).toEqual({ ok: false, reason: 'own_domain' });
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
    // code signs under the model's closing, then the footer
    expect(email.text).toMatch(/Could you send the updated proposal\?\n\nBest,\nAna Lopez's AI assistant\n\n--\nI am Ana Lopez's AI assistant/);
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
    // inactive recipient: with several recipients the others may have it, so never "failed"
    expect(await kinds(422, { ErrorCode: 406, Message: 'Message OK, but will not deliver to these inactive addresses' })).toBe('unknown:406');
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

  it('follows the thread only through our own Message-IDs that name the same matter', async () => {
    const store = new FakeMatterStore();
    // entries an older build wrote for ids a sender chose (inbound mail was indexed until Nov 13)
    store.messageIds.set(messageIdKey('<CAF=abc@mail.gmail.com>'), { uid: 'u1', matterId: 'm1' });
    store.messageIds.set(messageIdKey(`<m9.r1@${DOMAIN}>`), { uid: 'u1', matterId: 'm1' });
    const reply = (id: string) =>
      parseInbound(inboundPayload({ ToFull: [{ Email: `assistant@${DOMAIN}` }], OriginalRecipient: '', Headers: [{ Name: 'In-Reply-To', Value: id }] }))!;
    expect(await matchInbound(reply('<CAF=abc@mail.gmail.com>'), DOMAIN, store)).toBeNull();
    expect(await matchInbound(reply(`<m9.r1@${DOMAIN}>`), DOMAIN, store)).toBeNull();
    store.messageIds.set(messageIdKey(`<m1.r1@${DOMAIN}>`), { uid: 'u1', matterId: 'm1' });
    expect(await matchInbound(reply(`<m1.r1@${DOMAIN}>`), DOMAIN, store)).toEqual({ uid: 'u1', matterId: 'm1' });
    expect(ownMessageIdMatter(`<AbC123.0f1e@${DOMAIN.toUpperCase()}>`, DOMAIN)).toBe('AbC123');
    expect(ownMessageIdMatter('<m1.r1@evil.example>', DOMAIN)).toBeNull();
    expect(ownMessageIdMatter(`<m1@${DOMAIN}>`, DOMAIN)).toBeNull();
  });
});

import {
  MATTER_LIMITS,
  canonicalJson,
  mandateHash,
  mandateSchema,
  matterDocSchema,
  matterMessageSchema,
  matterPath,
  matterEventPath,
  messageIdKey,
  newReplyToken,
  replyAddressFor,
  replyTokenFromAddress,
  type Mandate,
} from '../../src/matters/model';

const ISO = '2026-11-12T10:00:00.000Z';
const DOMAIN = 'assistant.meetingguard.ai';

function mandate(overrides: Partial<Mandate> = {}): Mandate {
  return {
    contacts: [{ name: 'Carlos Ruiz', email: 'carlos@example.com' }],
    goal: 'Get the updated proposal and set up a meeting to discuss it.',
    mayAsk: ['the updated proposal', 'a time for a 30 minute meeting'],
    meeting: { durationMinutes: 30, windows: [{ start: '2026-11-13T09:00:00.000Z', end: '2026-11-13T17:00:00.000Z' }] },
    followUp: { everyDays: 2, maxCount: 2 },
    endsAt: '2026-11-14T23:00:00.000Z',
    copyOwner: 'cc',
    language: 'en',
    timeZone: 'Europe/Madrid',
    ...overrides,
  };
}

describe('matters model: the mandate', () => {
  it('accepts a complete mandate, with or without a meeting', () => {
    expect(mandateSchema.safeParse(mandate()).success).toBe(true);
    expect(mandateSchema.safeParse(mandate({ meeting: null, followUp: { everyDays: 1, maxCount: 0 } })).success).toBe(true);
  });

  it('rejects unknown keys, so nothing outside the schema can be granted', () => {
    expect(mandateSchema.safeParse({ ...mandate(), mayPay: true }).success).toBe(false);
    expect(mandateSchema.safeParse({ ...mandate(), contacts: [{ name: 'A', email: 'a@example.com', canSign: true }] }).success).toBe(false);
  });

  it('needs at least one contact, each once (case-insensitive), and at most the limit', () => {
    expect(mandateSchema.safeParse(mandate({ contacts: [] })).success).toBe(false);
    const twice = [
      { name: 'Carlos', email: 'carlos@example.com' },
      { name: 'Carlos again', email: 'Carlos@Example.com' },
    ];
    expect(mandateSchema.safeParse(mandate({ contacts: twice })).success).toBe(false);
    const many = Array.from({ length: MATTER_LIMITS.maxContacts + 1 }, (_, i) => ({ name: `P${i}`, email: `p${i}@example.com` }));
    expect(mandateSchema.safeParse(mandate({ contacts: many })).success).toBe(false);
  });

  it('rejects bad emails, empty goals, windows that end before they start and out-of-range follow-ups', () => {
    expect(mandateSchema.safeParse(mandate({ contacts: [{ name: 'X', email: 'not-an-email' }] })).success).toBe(false);
    expect(mandateSchema.safeParse(mandate({ goal: '   ' })).success).toBe(false);
    expect(
      mandateSchema.safeParse(mandate({ meeting: { durationMinutes: 30, windows: [{ start: ISO, end: '2026-11-12T09:00:00.000Z' }] } })).success,
    ).toBe(false);
    expect(mandateSchema.safeParse(mandate({ followUp: { everyDays: 0, maxCount: 1 } })).success).toBe(false);
    expect(mandateSchema.safeParse(mandate({ followUp: { everyDays: 1, maxCount: MATTER_LIMITS.followUpMaxCount + 1 } })).success).toBe(false);
    expect(mandateSchema.safeParse(mandate({ timeZone: 'not a zone' })).success).toBe(false);
  });
});

describe('matters model: the mandate hash', () => {
  it('is the same for the same mandate whatever the key order', () => {
    const a = mandate();
    // the same fields, inserted in reverse order
    const b = Object.fromEntries(Object.entries(a).reverse()) as Mandate;
    expect(Object.keys(b)[0]).toBe('timeZone');
    expect(mandateHash(a)).toBe(mandateHash(b));
    expect(mandateHash(a)).toMatch(/^[a-f0-9]{64}$/);
  });

  it('changes with any change the user would see', () => {
    const base = mandateHash(mandate());
    expect(mandateHash(mandate({ endsAt: '2026-11-15T23:00:00.000Z' }))).not.toBe(base);
    expect(mandateHash(mandate({ contacts: [{ name: 'Carlos Ruiz', email: 'carlos2@example.com' }] }))).not.toBe(base);
    expect(mandateHash(mandate({ mayAsk: ['the updated proposal'] }))).not.toBe(base);
  });

  it('keeps array order (the order of contacts is part of what was shown)', () => {
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
    expect(canonicalJson({ b: 1, a: { d: null, c: 'x' } })).toBe('{"a":{"c":"x","d":null},"b":1}');
  });
});

describe('matters model: the matter and its emails', () => {
  const matter = {
    status: 'draft',
    language: 'es',
    title: 'Propuesta de Carlos',
    request: 'Contacta a Carlos y pide la propuesta actualizada.',
    source: 'voice',
    mandate: mandate(),
    questions: [],
    readBack: 'Voy a escribir a Carlos Ruiz.',
    mandateVersion: 1,
    confirmedHash: null,
    confirmedAt: null,
    replyToken: '0123456789abcdef01234567',
    createdAt: ISO,
    updatedAt: ISO,
    endedAt: null,
  };

  it('accepts a draft matter and rejects a bad status, hash or token', () => {
    expect(matterDocSchema.safeParse(matter).success).toBe(true);
    expect(matterDocSchema.safeParse({ ...matter, status: 'sent' }).success).toBe(false);
    expect(matterDocSchema.safeParse({ ...matter, confirmedHash: 'abc' }).success).toBe(false);
    expect(matterDocSchema.safeParse({ ...matter, replyToken: 'ABCDEF0123456789ABCDEF01' }).success).toBe(false);
  });

  it('accepts an inbound email with its sender checks', () => {
    const message = {
      direction: 'inbound',
      status: 'received',
      rfcMessageId: '<CAF=abc@mail.gmail.com>',
      inReplyTo: '<m1.1@assistant.meetingguard.ai>',
      references: ['<m1.1@assistant.meetingguard.ai>'],
      from: { name: 'Carlos Ruiz', email: 'carlos@example.com' },
      to: ['m-0123456789abcdef01234567@assistant.meetingguard.ai'],
      cc: [],
      subject: 'Re: Updated proposal',
      text: 'Here it is.',
      at: ISO,
      providerId: 'pm-123',
      auth: { spf: 'pass', dkim: 'pass', dmarc: 'pass' },
    };
    expect(matterMessageSchema.safeParse(message).success).toBe(true);
    expect(matterMessageSchema.safeParse({ ...message, auth: { spf: 'pass', dkim: 'ok', dmarc: 'pass' } }).success).toBe(false);
  });

  it('builds the document paths under the owner', () => {
    expect(matterPath('u1', 'm1')).toBe('users/u1/matters/m1');
    expect(matterEventPath('u1', 'm1', 'e1')).toBe('users/u1/matters/m1/events/e1');
  });
});

describe('matters model: reply addresses and Message-IDs', () => {
  it('makes unguessable lowercase tokens', () => {
    const a = newReplyToken();
    expect(a).toMatch(/^[a-f0-9]{24}$/);
    expect(newReplyToken()).not.toBe(a);
  });

  it('round-trips a reply address, whatever the case or display name', () => {
    const token = '0123456789abcdef01234567';
    const address = replyAddressFor(token, 'Assistant.MeetingGuard.ai');
    expect(address).toBe(`m-${token}@${DOMAIN}`);
    expect(replyTokenFromAddress(address, DOMAIN)).toBe(token);
    expect(replyTokenFromAddress(`"Assistant" <M-${token.toUpperCase()}@ASSISTANT.MEETINGGUARD.AI>`, DOMAIN)).toBe(token);
  });

  it('ignores addresses on other domains or without a token', () => {
    const token = '0123456789abcdef01234567';
    expect(replyTokenFromAddress(`m-${token}@evil.example`, DOMAIN)).toBeNull();
    expect(replyTokenFromAddress(`m-${token}@sub.${DOMAIN}`, DOMAIN)).toBeNull();
    expect(replyTokenFromAddress(`assistant@${DOMAIN}`, DOMAIN)).toBeNull();
    expect(replyTokenFromAddress(`m-${token}x@${DOMAIN}`, DOMAIN)).toBeNull();
    expect(() => replyAddressFor('short', DOMAIN)).toThrow();
  });

  it('keys Message-IDs with or without angle brackets alike', () => {
    expect(messageIdKey('<abc@example.com>')).toBe(messageIdKey(' abc@example.com '));
    expect(messageIdKey('<abc@example.com>')).toMatch(/^[a-f0-9]{64}$/);
    expect(messageIdKey('<abc@example.com>')).not.toBe(messageIdKey('<abd@example.com>'));
  });
});

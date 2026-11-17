/**
 * A2's pure parts: the content guard, follow-up timing (working hours across a DST change), the
 * inbound text helpers, the read claim, the read decision and the sender check (real DKIM
 * signatures against a stub DNS, from the summaries fixtures; no network).
 */
import { guardReply } from '../../src/matters/guard';
import { hasHiddenHtml, htmlToText, isAutoReply, spfHint, stripQuoted, threadSafeId } from '../../src/matters/inbound';
import { checkSender } from '../../src/matters/mailCheck';
import { matterMessageReadSchema, type MatterDoc } from '../../src/matters/model';
import { decideRead, parseAssessment, promisesLater, verbatim } from '../../src/matters/read';
import { answeredSinceLastEmail, inWorkingHours, nextWorkingSlot } from '../../src/matters/schedule';
import { readClaimDecision } from '../../src/matters/store';
import { replySubject, followUpText, quoteBelow } from '../../src/matters/text';
import { USER_DOMAIN, buildMessage, createFixtureDns, fixtureKeys, signMessage } from './summariesFixtures';

jest.mock('firebase-functions/logger', () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

describe('content guard', () => {
  const allowed = ['carlos@example.com', 'ana@example.com'];
  it('passes a plain, polite reply', () => {
    expect(guardReply({ text: 'Hello Carlos,\n\nThank you, that works for us.\n\nBest,', allowedAddresses: allowed })).toEqual([]);
  });
  it.each([
    ['We can lower the price.', ['money']],
    ['Podemos hacer un descuento.', ['money']],
    ['It costs 500 EUR.', ['money']],
    ['Costs $500.', ['money']],
    ['Please sign the agreement.', ['contract']],
    ['Le envío el contrato para firmar.', ['contract']],
    ['See https://example.org/x', ['link']],
    ['Go to files.acme.io', ['link']],
    ['Write to maria@other.example', ['address']],
  ])('flags %s', (text, flags) => {
    expect(guardReply({ text, allowedAddresses: allowed })).toEqual(flags);
  });
  it('allows the contact\'s own address and flags a draft that is too long', () => {
    expect(guardReply({ text: 'I copied carlos@example.com.', allowedAddresses: allowed })).toEqual([]);
    expect(guardReply({ text: 'a '.repeat(2000), allowedAddresses: allowed })).toEqual(['length']);
  });
});

describe('follow-up timing', () => {
  it('knows working hours in the mandate\'s zone, across a DST change', () => {
    // Madrid: Monday 2026-10-26 is the first day of winter time (UTC+1)
    expect(inWorkingHours(new Date('2026-10-26T08:00:00Z'), 'Europe/Madrid')).toBe(true); // 9:00 local
    expect(inWorkingHours(new Date('2026-10-26T07:59:00Z'), 'Europe/Madrid')).toBe(false);
    expect(inWorkingHours(new Date('2026-10-24T10:00:00Z'), 'Europe/Madrid')).toBe(false); // Saturday
  });
  it('moves a weekend or night follow-up to the next working morning, at 9:00 local even after a DST change', () => {
    // Saturday 2026-10-24 (summer time) -> Monday 2026-10-26 9:00 (winter time) = 08:00 UTC
    expect(nextWorkingSlot(new Date('2026-10-24T10:00:00Z'), 'Europe/Madrid').toISOString()).toBe('2026-10-26T08:00:00.000Z');
    // Tuesday 20:00 local -> Wednesday 9:00
    expect(nextWorkingSlot(new Date('2026-11-17T19:00:00Z'), 'Europe/Madrid').toISOString()).toBe('2026-11-18T08:00:00.000Z');
    // Monday 7:00 local -> that morning
    expect(nextWorkingSlot(new Date('2026-11-16T06:00:00Z'), 'Europe/Madrid').toISOString()).toBe('2026-11-16T08:00:00.000Z');
  });
  it('treats a reply after our last email as answered', () => {
    expect(answeredSinceLastEmail({ lastInboundAt: null, lastOutboundAt: '2026-11-12T09:00:00Z' })).toBe(false);
    expect(answeredSinceLastEmail({ lastInboundAt: '2026-11-12T10:00:00Z', lastOutboundAt: '2026-11-12T09:00:00Z' })).toBe(true);
    expect(answeredSinceLastEmail({ lastInboundAt: '2026-11-12T08:00:00Z', lastOutboundAt: '2026-11-12T09:00:00Z' })).toBe(false);
  });
  it('words the fixed follow-up and quotes the earlier email', () => {
    expect(followUpText('Proposal', 'es')).toContain('Le escribo para hacer seguimiento de mi correo de abajo sobre "Proposal"');
    expect(quoteBelow('Hello\n\nBest,')).toBe('> Hello\n>\n> Best,');
    expect(replySubject('Updated proposal')).toBe('Re: Updated proposal');
    expect(replySubject('RE: Updated proposal')).toBe('RE: Updated proposal');
  });
});

describe('inbound text helpers', () => {
  it('reads only the visible text of HTML', () => {
    const html = '<style>p{}</style><p>Hello &amp; welcome</p><div hidden>secret</div><p style="display: none">secret2</p><blockquote>old</blockquote><br>Bye';
    expect(hasHiddenHtml(html)).toBe(true);
    expect(htmlToText(html)).toBe('Hello & welcome\n\nBye');
    expect(hasHiddenHtml('<p>Plain</p>')).toBe(false);
  });
  it('cuts a plain-text reply at the quoted older email, EN and ES', () => {
    expect(stripQuoted('Yes.\n\nOn Mon, 16 Nov 2026, Ana wrote:\n> old')).toBe('Yes.');
    expect(stripQuoted('Sí.\n\nEl lun, 16 nov 2026, Ana escribió:\n> antiguo')).toBe('Sí.');
    expect(stripQuoted('Ok\n> quoted line\nmore')).toBe('Ok\nmore');
  });
  it('recognises automatic replies', () => {
    expect(isAutoReply([{ Name: 'Auto-Submitted', Value: 'auto-replied' }], 'Re: x')).toBe(true);
    expect(isAutoReply([{ Name: 'Auto-Submitted', Value: 'no' }], 'Re: x')).toBe(false);
    expect(isAutoReply([{ Name: 'Precedence', Value: 'bulk' }], 'Re: x')).toBe(true);
    expect(isAutoReply([{ Name: 'X-Autoreply', Value: 'yes' }], 'Re: x')).toBe(true);
    expect(isAutoReply([], 'Fuera de la oficina')).toBe(true);
    expect(isAutoReply([], 'Re: Updated proposal')).toBe(false);
  });
  it('reads Received-SPF as a hint only', () => {
    expect(spfHint([{ Name: 'Received-SPF', Value: 'Pass (sender SPF authorized) identity=mailfrom' }])).toBe('pass');
    expect(spfHint([{ Name: 'Received-SPF', Value: 'weird' }])).toBe('unknown');
    expect(spfHint([])).toBe('unknown');
  });
  it('threads only on a single, bounded <local@domain> Message-ID', () => {
    expect(threadSafeId('<CAF=abc@mail.gmail.com>')).toBe('<CAF=abc@mail.gmail.com>');
    expect(threadSafeId('<a@b> <c@d>')).toBeNull();
    expect(threadSafeId(`<${'a'.repeat(300)}@b.example>`)).toBeNull();
    expect(threadSafeId('<no-at-sign>')).toBeNull();
    expect(threadSafeId('<inbound.p1@postmark>')).toBeNull();
  });
});

describe('read claim', () => {
  const base = matterMessageReadSchema.parse({
    direction: 'inbound',
    status: 'received',
    rfcMessageId: '<a@b.example>',
    inReplyTo: null,
    references: [],
    from: { name: null, email: 'carlos@example.com' },
    to: [],
    cc: [],
    subject: '',
    text: '',
    at: '2026-11-12T09:00:00.000Z',
    providerId: 'p1',
    auth: null,
    readState: 'none',
  });
  const input = { retry: false, staleBeforeIso: '2026-11-12T09:00:00.000Z', maxAttempts: 3 };
  it('claims a new read, never one in progress, a finished one or one past its attempts', () => {
    expect(readClaimDecision(base, input)).toEqual({ state: 'claimed', attempts: 1 });
    expect(readClaimDecision({ ...base, readState: 'reading', readClaimedAt: '2026-11-12T09:30:00.000Z' }, { ...input, retry: true })).toMatchObject({ state: 'busy' });
    expect(readClaimDecision({ ...base, readState: 'reading', readClaimedAt: '2026-11-12T08:00:00.000Z' }, { ...input, retry: true })).toMatchObject({ state: 'claimed' });
    expect(readClaimDecision({ ...base, readState: 'failed', readAttempts: 1 }, input)).toMatchObject({ state: 'busy' });
    expect(readClaimDecision({ ...base, readState: 'failed', readAttempts: 3 }, { ...input, retry: true })).toMatchObject({ state: 'exhausted' });
    expect(readClaimDecision({ ...base, readState: 'skipped' }, input)).toMatchObject({ state: 'finished' });
    expect(readClaimDecision({ ...base, direction: 'outbound' }, input)).toMatchObject({ state: 'not_inbound' });
  });
});

describe('promises, not facts', () => {
  it.each([
    ['I will send the final version tomorrow.', true],
    ["I'll get back to you.", true],
    ['We are going to review it.', true],
    ['Te lo envío mañana.', true],
    ['Lo enviaré el lunes.', true],
    ['Vamos a revisarlo.', true],
    ['Here is the brochure you asked for, that is everything.', false],
    ['Attached is the signed contract.', false],
    ['Aquí tienes el folleto.', false],
  ])('%s -> %s', (quote, expected) => {
    expect(promisesLater(quote as string, false)).toBe(expected);
  });
  it('accepts any sentence code read a due date from', () => {
    expect(promisesLater('Sending it Friday', true)).toBe(true);
  });
});

describe('read decision', () => {
  it('keeps only quotes that are the contact\'s own words', () => {
    expect(verbatim('Here it is. Thanks!', 'Here it is.')).toBe('Here it is.');
    expect(verbatim('Here it is. Thanks!', 'I agree to pay.')).toBeNull();
    expect(parseAssessment({ intent: 'nope' })).toBeNull();
  });
  it('drops a reply body that is empty', () => {
    const matter = { mandate: { goal: 'g', mayAsk: [], timeZone: 'Europe/Madrid' }, ownerName: 'Ana' } as unknown as MatterDoc;
    const email = matterMessageReadSchema.parse({
      direction: 'inbound', status: 'received', rfcMessageId: '<a@b.example>', inReplyTo: null, references: [],
      from: { name: null, email: 'c@example.com' }, to: [], cc: [], subject: '', text: 'Hi', at: '2026-11-12T09:00:00.000Z', providerId: 'p', auth: null,
    });
    const decision = decideRead({ assessment: { intent: 'answer_within_mandate', reason: 'none', quote: null, reply: '  ', commitments: [] }, matter, email, contactName: 'C' });
    expect(decision).toMatchObject({ outcome: 'unclear', cards: [{ kind: 'unclear' }], replyBody: null });
  });
});

describe('sender check (DKIM from the raw email)', () => {
  const keys = fixtureKeys();
  const contact = `lee@${USER_DOMAIN}`;
  const now = new Date('2026-11-10T16:00:00Z');

  it('trusts a signature that passes and aligns with From', async () => {
    const dns = createFixtureDns(keys);
    const raw = await signMessage(buildMessage({ from: `Lee <${contact}>`, to: 'm-0123@assistant.example' }), { domain: USER_DOMAIN, selector: 's1', privateKey: keys.user.privateKey });
    await expect(checkSender({ raw: Buffer.from(raw), from: contact, spf: 'pass', priority: true, now, resolver: dns.resolver })).resolves.toMatchObject({
      verdict: 'trusted',
      fromAligned: true,
      reason: null,
    });
  });

  it('does not trust an unsigned email, one signed by another domain, or one without the raw email', async () => {
    const dns = createFixtureDns(keys);
    const unsigned = buildMessage({ from: `Lee <${contact}>` });
    await expect(checkSender({ raw: Buffer.from(unsigned), from: contact, spf: 'pass', priority: true, now, resolver: dns.resolver })).resolves.toMatchObject({ verdict: 'unverified', reason: 'no_aligned_signature' });
    const foreign = await signMessage(buildMessage({ from: `Lee <${contact}>` }), { domain: 'attacker.example', selector: 's1', privateKey: keys.attacker.privateKey });
    await expect(checkSender({ raw: Buffer.from(foreign), from: contact, spf: 'pass', priority: true, now, resolver: dns.resolver })).resolves.toMatchObject({ verdict: 'unverified' });
    await expect(checkSender({ raw: null, from: contact, spf: 'pass', priority: true, now })).resolves.toMatchObject({ verdict: 'unverified', reason: 'no_raw' });
  });

  it('calls it malformed when the raw From is not the From Postmark reported', async () => {
    const dns = createFixtureDns(keys);
    const raw = await signMessage(buildMessage({ from: `Lee <${contact}>` }), { domain: USER_DOMAIN, selector: 's1', privateKey: keys.user.privateKey });
    await expect(checkSender({ raw: Buffer.from(raw), from: 'ana@example.com', spf: 'pass', priority: true, now, resolver: dns.resolver })).resolves.toMatchObject({ verdict: 'malformed', reason: 'from_mismatch' });
  });
});

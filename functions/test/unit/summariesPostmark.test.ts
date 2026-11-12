/**
 * M10 Postmark adapter and ship-dark gate (functions/src/summaries/provider/postmark.ts,
 * functions/src/summaries/gate.ts, the SUMMARIES_* config): Basic auth of the webhook, payload
 * picking (only RawEmail, OriginalRecipient, MailboxHash and MessageID are read), the body cap,
 * the raw-message line-ending question of day-0 check 2 against mailauth, and the pilot list.
 * docs/v2/M10-DESIGN.md sections 2, 4 (steps 1 to 4) and 12. All data is synthetic.
 */
import { dkimSign, dkimVerify } from 'mailauth';

import { SUMMARIES_FUNCTION_TUNING } from '../../src/config';
import { isPilotUid, parsePilotList, parsePilotUids, PILOT_UID_PATTERN, summariesEnabledAtLoad } from '../../src/summaries/gate';
import {
  POSTMARK_FIELD_LIMITS,
  SUMMARIES_MAX_BODY_BYTES,
  checkBasicAuth,
  exceedsBodyLimit,
  parsePostmarkInbound,
} from '../../src/summaries/provider/postmark';
import { SUMMARIES_TUNING } from '../../src/summaries/match';
import * as signature from '../../src/whatsapp/signature';
import { RECEIVED_AT, VENDOR_DOMAIN, buildMessage, createFixtureDns, fixtureKeys } from './summariesFixtures';

const SECRET = 'synthetic-webhook-secret-0001';
const MESSAGE_ID = '3f0c8a52-1b7e-4d0a-9a51-0c7e2b9d4f11';
const RAW = 'From: recaps@notetaker.example\r\nTo: dana@company.example\r\nSubject: Recap\r\n\r\nBody\r\n';
const ORIGINAL_RECIPIENT = 'k3j5h7g2f4d6s2a3p5o7i2u4y6@summaries.meetingguard.example';

function basic(credentials: string): string {
  return `Basic ${Buffer.from(credentials, 'utf8').toString('base64')}`;
}

function payload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    MessageID: MESSAGE_ID,
    RawEmail: RAW,
    OriginalRecipient: ORIGINAL_RECIPIENT,
    MailboxHash: '',
    ...overrides,
  };
}

describe('SUMMARIES_FUNCTION_TUNING (design section 4 Options, finding 11)', () => {
  it('holds the design values for each summary function', () => {
    expect(SUMMARIES_FUNCTION_TUNING).toEqual({
      inbound: { memory: '1GiB', cpu: 1, concurrency: 2, maxInstances: 3, timeoutSeconds: 60 },
      read: { memory: '512MiB', timeoutSeconds: 30, maxInstances: 10 },
      callables: { memory: '256MiB', timeoutSeconds: 10, maxInstances: 10 },
    });
  });

  it('does not collide with the matching thresholds named SUMMARIES_TUNING', () => {
    expect(SUMMARIES_TUNING).not.toBe(SUMMARIES_FUNCTION_TUNING);
    expect(Object.keys(SUMMARIES_TUNING)).not.toContain('inbound');
  });
});

describe('checkBasicAuth', () => {
  it('accepts Basic base64("postmark:" + secret)', () => {
    expect(checkBasicAuth(basic(`postmark:${SECRET}`), SECRET)).toBe(true);
  });

  it('accepts the scheme in any case and SP or HTAB around the token', () => {
    const token = Buffer.from(`postmark:${SECRET}`).toString('base64');
    expect(checkBasicAuth(`basic ${token}`, SECRET)).toBe(true);
    expect(checkBasicAuth(`BASIC ${token}`, SECRET)).toBe(true);
    expect(checkBasicAuth(`bAsIc \t${token} `, SECRET)).toBe(true);
  });

  it('accepts a secret that itself contains a colon (only the first one splits user and password)', () => {
    const secret = 'abc:def';
    expect(checkBasicAuth(basic(`postmark:${secret}`), secret)).toBe(true);
    expect(checkBasicAuth(basic('postmark:abc'), secret)).toBe(false);
  });

  it('rejects a wrong password', () => {
    expect(checkBasicAuth(basic('postmark:wrong-secret'), SECRET)).toBe(false);
    expect(checkBasicAuth(basic(`postmark:${SECRET}x`), SECRET)).toBe(false);
    expect(checkBasicAuth(basic(`postmark:${SECRET.slice(0, -1)}`), SECRET)).toBe(false);
    expect(checkBasicAuth(basic('postmark:'), SECRET)).toBe(false);
  });

  it('rejects a wrong user', () => {
    expect(checkBasicAuth(basic(`Postmark:${SECRET}`), SECRET)).toBe(false);
    expect(checkBasicAuth(basic(`admin:${SECRET}`), SECRET)).toBe(false);
    expect(checkBasicAuth(basic(`:${SECRET}`), SECRET)).toBe(false);
    expect(checkBasicAuth(basic(SECRET), SECRET)).toBe(false);
    expect(checkBasicAuth(basic(`postmark${SECRET}`), SECRET)).toBe(false);
  });

  it('rejects a missing header', () => {
    expect(checkBasicAuth(undefined, SECRET)).toBe(false);
    expect(checkBasicAuth('', SECRET)).toBe(false);
    expect(checkBasicAuth('   ', SECRET)).toBe(false);
    expect(checkBasicAuth('Basic', SECRET)).toBe(false);
    expect(checkBasicAuth('Basic ', SECRET)).toBe(false);
  });

  it('rejects other schemes and the bare secret', () => {
    const token = Buffer.from(`postmark:${SECRET}`).toString('base64');
    expect(checkBasicAuth(`Bearer ${token}`, SECRET)).toBe(false);
    expect(checkBasicAuth(`Digest ${token}`, SECRET)).toBe(false);
    expect(checkBasicAuth(`Basic: ${token}`, SECRET)).toBe(false);
    expect(checkBasicAuth(`BasicX ${token}`, SECRET)).toBe(false);
    expect(checkBasicAuth(token, SECRET)).toBe(false);
    expect(checkBasicAuth(SECRET, SECRET)).toBe(false);
    expect(checkBasicAuth(`postmark:${SECRET}`, SECRET)).toBe(false);
  });

  it('rejects malformed base64', () => {
    const token = Buffer.from(`postmark:${SECRET}`).toString('base64');
    expect(token.endsWith('=')).toBe(true);
    expect(checkBasicAuth('Basic !!!!', SECRET)).toBe(false);
    expect(checkBasicAuth(`Basic ${token.replace(/=+$/, '')}`, SECRET)).toBe(false);
    expect(checkBasicAuth(`Basic ${token}A`, SECRET)).toBe(false);
    expect(checkBasicAuth(`Basic ${token.slice(0, 4)} ${token.slice(4)}`, SECRET)).toBe(false);
    expect(checkBasicAuth(`Basic ${token}.`, SECRET)).toBe(false);
    expect(checkBasicAuth(`Basic ${token.replace(/\+/g, '-').replace(/\//g, '_')}x===`, SECRET)).toBe(false);
    expect(checkBasicAuth('Basic ====', SECRET)).toBe(false);
  });

  it('rejects non-canonical base64 (stray bits in the last character)', () => {
    // "postmark:a" is 10 bytes: base64 ends in "YQ==", and "YR==" decodes to the same bytes.
    expect(Buffer.from('postmark:a').toString('base64').endsWith('YQ==')).toBe(true);
    expect(checkBasicAuth(basic('postmark:a'), 'a')).toBe(true);
    const nonCanonical = Buffer.from('postmark:a').toString('base64').replace(/YQ==$/, 'YR==');
    expect(Buffer.from(nonCanonical, 'base64').toString('utf8')).toBe('postmark:a');
    expect(checkBasicAuth(`Basic ${nonCanonical}`, 'a')).toBe(false);
  });

  it('always rejects when the configured secret is empty or whitespace-only', () => {
    expect(checkBasicAuth(basic('postmark:'), '')).toBe(false);
    expect(checkBasicAuth(basic('postmark:   '), '   ')).toBe(false);
    expect(checkBasicAuth(basic('postmark:\t'), '\t')).toBe(false);
    expect(checkBasicAuth(basic('postmark:\n'), '\n')).toBe(false);
  });

  it('compares the configured secret exactly (no trimming, no case folding)', () => {
    expect(checkBasicAuth(basic(`postmark:${SECRET}`), `${SECRET}\n`)).toBe(false);
    expect(checkBasicAuth(basic(`postmark:${SECRET.toUpperCase()}`), SECRET)).toBe(false);
  });

  it('never matches through an invalid UTF-8 sequence (bytes are compared, not decoded text)', () => {
    const secretWithReplacement = `x${String.fromCharCode(0xfffd)}`;
    const invalidUtf8 = Buffer.concat([Buffer.from('postmark:x', 'utf8'), Buffer.from([0xff])]);
    expect(invalidUtf8.toString('utf8')).toBe(`postmark:${secretWithReplacement}`);
    expect(checkBasicAuth(`Basic ${invalidUtf8.toString('base64')}`, secretWithReplacement)).toBe(false);
    expect(checkBasicAuth(basic(`postmark:${secretWithReplacement}`), secretWithReplacement)).toBe(true);
  });

  it('rejects an over-long header before decoding it', () => {
    const long = `Basic ${Buffer.from(`postmark:${'s'.repeat(4000)}`).toString('base64')}`;
    expect(long.length).toBeGreaterThan(4096);
    expect(checkBasicAuth(long, 's'.repeat(4000))).toBe(false);
  });

  it('compares through the shared timing-safe helper of functions/src/whatsapp/signature.ts', () => {
    const spy = jest.spyOn(signature, 'timingSafeStringEqual');
    expect(checkBasicAuth(basic(`postmark:${SECRET}`), SECRET)).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(checkBasicAuth(basic('postmark:wrong'), SECRET)).toBe(false);
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe('exceedsBodyLimit (12 MiB, row 2)', () => {
  it('is 12 MiB', () => {
    expect(SUMMARIES_MAX_BODY_BYTES).toBe(12 * 1024 * 1024);
  });

  it('judges the raw body length', () => {
    expect(exceedsBodyLimit(Buffer.alloc(SUMMARIES_MAX_BODY_BYTES))).toBe(false);
    expect(exceedsBodyLimit(Buffer.alloc(SUMMARIES_MAX_BODY_BYTES + 1))).toBe(true);
    expect(exceedsBodyLimit(undefined)).toBe(false);
  });

  it('also judges a declared Content-Length, either one over the limit is enough', () => {
    expect(exceedsBodyLimit(Buffer.alloc(10), String(SUMMARIES_MAX_BODY_BYTES + 1))).toBe(true);
    expect(exceedsBodyLimit(undefined, String(SUMMARIES_MAX_BODY_BYTES))).toBe(false);
    expect(exceedsBodyLimit(undefined, '99999999999999999999999')).toBe(true);
    expect(exceedsBodyLimit(Buffer.alloc(10), 'abc')).toBe(false);
    expect(exceedsBodyLimit(Buffer.alloc(10), '')).toBe(false);
  });
});

describe('parsePostmarkInbound', () => {
  it('picks the four fields into a provider-neutral envelope', () => {
    const result = parsePostmarkInbound(payload({ MailboxHash: 'k3j5h7g2f4d6s2a3p5o7i2u4y6' }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.envelope).toEqual({
      provider: 'postmark',
      providerEventId: MESSAGE_ID,
      rawMime: Buffer.from(RAW, 'utf8'),
      envelopeRecipient: { originalRecipient: ORIGINAL_RECIPIENT, mailboxHash: 'k3j5h7g2f4d6s2a3p5o7i2u4y6' },
    });
    expect(Buffer.isBuffer(result.envelope.rawMime)).toBe(true);
  });

  it('ignores every other field and never reads Postmark parsed headers, spam or SPF fields', () => {
    const body = payload();
    const read: string[] = [];
    for (const key of ['From', 'FromFull', 'To', 'ToFull', 'Cc', 'Subject', 'Headers', 'SpamScore', 'SpamStatus', 'ReceivedSPF', 'TextBody', 'HtmlBody', 'StrippedTextReply', 'Date', 'Attachments']) {
      Object.defineProperty(body, key, {
        enumerable: true,
        get() {
          read.push(key);
          return 'synthetic';
        },
      });
    }
    const result = parsePostmarkInbound(body);
    expect(result.ok).toBe(true);
    expect(read).toEqual([]);
    if (!result.ok) return;
    expect(Object.keys(result.envelope).sort()).toEqual(['envelopeRecipient', 'provider', 'providerEventId', 'rawMime']);
    expect(Object.keys(result.envelope.envelopeRecipient).sort()).toEqual(['mailboxHash', 'originalRecipient']);
  });

  it('maps absent, null or empty envelope fields to null', () => {
    for (const value of [undefined, null, '']) {
      const result = parsePostmarkInbound(payload({ OriginalRecipient: value, MailboxHash: value }));
      expect(result).toMatchObject({ ok: true, envelope: { envelopeRecipient: { originalRecipient: null, mailboxHash: null } } });
    }
    const body = payload();
    delete body.OriginalRecipient;
    delete body.MailboxHash;
    expect(parsePostmarkInbound(body)).toMatchObject({ ok: true, envelope: { envelopeRecipient: { originalRecipient: null, mailboxHash: null } } });
  });

  it('keeps the envelope values as sent (address.ts tokenFromEnvelope normalizes them)', () => {
    const result = parsePostmarkInbound(payload({ OriginalRecipient: ` <${ORIGINAL_RECIPIENT.toUpperCase()}> ` }));
    expect(result).toMatchObject({ ok: true, envelope: { envelopeRecipient: { originalRecipient: ` <${ORIGINAL_RECIPIENT.toUpperCase()}> ` } } });
  });

  it('answers no_raw_email when RawEmail is missing, null or empty (raw content setting off)', () => {
    const body = payload();
    delete body.RawEmail;
    expect(parsePostmarkInbound(body)).toEqual({ ok: false, reason: 'no_raw_email' });
    expect(parsePostmarkInbound(payload({ RawEmail: null }))).toEqual({ ok: false, reason: 'no_raw_email' });
    expect(parsePostmarkInbound(payload({ RawEmail: '' }))).toEqual({ ok: false, reason: 'no_raw_email' });
  });

  it('answers invalid_payload for a body that is not a JSON object', () => {
    for (const body of [undefined, null, 'RawEmail', 42, true, [payload()], Buffer.from(JSON.stringify(payload())), new Map(Object.entries(payload()))]) {
      expect(parsePostmarkInbound(body)).toEqual({ ok: false, reason: 'invalid_payload' });
    }
  });

  it('answers invalid_payload for a picked field of the wrong type', () => {
    const cases: Record<string, unknown>[] = [
      { RawEmail: 42 },
      { RawEmail: { text: RAW } },
      { RawEmail: [RAW] },
      { OriginalRecipient: 42 },
      { OriginalRecipient: [ORIGINAL_RECIPIENT] },
      { MailboxHash: { hash: 'x' } },
      { MessageID: 42 },
      { MessageID: null },
      { MessageID: '' },
      { MessageID: 'has space' },
      { MessageID: `id${String.fromCharCode(0x0a)}` },
      { MessageID: `id${String.fromCharCode(0xe9)}` },
    ];
    for (const overrides of cases) {
      expect(parsePostmarkInbound(payload(overrides))).toEqual({ ok: false, reason: 'invalid_payload' });
    }
    const noId = payload();
    delete noId.MessageID;
    expect(parsePostmarkInbound(noId)).toEqual({ ok: false, reason: 'invalid_payload' });
  });

  it('answers invalid_payload over a field bound, and accepts each bound exactly', () => {
    const atLimit = (n: number) => 'a'.repeat(n);
    expect(parsePostmarkInbound(payload({ OriginalRecipient: atLimit(POSTMARK_FIELD_LIMITS.originalRecipientChars) })).ok).toBe(true);
    expect(parsePostmarkInbound(payload({ OriginalRecipient: atLimit(POSTMARK_FIELD_LIMITS.originalRecipientChars + 1) }))).toEqual({ ok: false, reason: 'invalid_payload' });
    expect(parsePostmarkInbound(payload({ MailboxHash: atLimit(POSTMARK_FIELD_LIMITS.mailboxHashChars) })).ok).toBe(true);
    expect(parsePostmarkInbound(payload({ MailboxHash: atLimit(POSTMARK_FIELD_LIMITS.mailboxHashChars + 1) }))).toEqual({ ok: false, reason: 'invalid_payload' });
    expect(parsePostmarkInbound(payload({ MessageID: atLimit(POSTMARK_FIELD_LIMITS.messageIdChars) })).ok).toBe(true);
    expect(parsePostmarkInbound(payload({ MessageID: atLimit(POSTMARK_FIELD_LIMITS.messageIdChars + 1) }))).toEqual({ ok: false, reason: 'invalid_payload' });
    expect(parsePostmarkInbound(payload({ RawEmail: atLimit(POSTMARK_FIELD_LIMITS.rawEmailChars + 1) }))).toEqual({ ok: false, reason: 'invalid_payload' });
  });

  it('lets a raw message over the 5 MiB MIME cap through (mime.ts refuses it as too_large, row 4)', () => {
    const big = `${RAW}${'x'.repeat(6 * 1024 * 1024)}`;
    const result = parsePostmarkInbound(payload({ RawEmail: big }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.envelope.rawMime.length).toBe(Buffer.byteLength(big, 'utf8'));
  });

  it('prefers invalid_payload over no_raw_email when another picked field is broken', () => {
    expect(parsePostmarkInbound(payload({ RawEmail: undefined, MessageID: 42 }))).toEqual({ ok: false, reason: 'invalid_payload' });
  });
});

describe('RawEmail bytes (day-0 check 2, UNVERIFIED against real Postmark payloads)', () => {
  const E_ACUTE = String.fromCharCode(0xe9);
  const O_ACUTE = String.fromCharCode(0xf3);

  it('a UTF-8 8-bit message survives the JSON string byte for byte', () => {
    const original = Buffer.from(
      `From: recaps@notetaker.example\r\nSubject: Reuni${O_ACUTE}n\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\nCaf${E_ACUTE} y reuni${O_ACUTE}n\r\n`,
      'utf8',
    );
    const wire = JSON.parse(JSON.stringify(payload({ RawEmail: original.toString('utf8') }))) as unknown;
    const result = parsePostmarkInbound(wire);
    expect(result.ok && result.envelope.rawMime.equals(original)).toBe(true);
  });

  it('a legacy-charset 8-bit body cannot survive a JSON string unchanged (why check 2 exists)', () => {
    const original = Buffer.concat([
      Buffer.from('From: recaps@notetaker.example\r\nContent-Type: text/plain; charset=iso-8859-1\r\n\r\nReuni', 'latin1'),
      Buffer.from([0xf3]),
      Buffer.from('n\r\n', 'latin1'),
    ]);
    const result = parsePostmarkInbound(payload({ RawEmail: original.toString('utf8') }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.envelope.rawMime.equals(original)).toBe(false);
  });

  describe('bare LF line endings and DKIM (mailauth rewrites bare LF to CRLF)', () => {
    const dns = createFixtureDns();

    async function signed(canonicalization: string): Promise<string> {
      const message = buildMessage({ body: ['Action items', '[ ] Send the checklist (owner: Dana)', '', 'Trailing text  ', ''].join('\r\n') });
      const result = await dkimSign(message, {
        canonicalization,
        headerList: 'from:to:subject:date:message-id',
        signatureData: [{ signingDomain: VENDOR_DOMAIN, selector: 's1', privateKey: fixtureKeys().vendor.privateKey }],
      });
      expect(result.errors).toEqual([]);
      return result.signatures + message;
    }

    async function verifyRaw(raw: Buffer): Promise<string | undefined> {
      const verified = await dkimVerify(raw, { resolver: dns.resolver, curTime: RECEIVED_AT });
      return verified.results[0]?.status.result;
    }

    for (const canonicalization of ['relaxed/relaxed', 'simple/simple']) {
      it(`an LF-only RawEmail still verifies (${canonicalization})`, async () => {
        const crlf = await signed(canonicalization);
        const lfOnly = crlf.replace(/\r\n/g, '\n');
        expect(lfOnly.includes('\r')).toBe(false);
        const result = parsePostmarkInbound(payload({ RawEmail: lfOnly }));
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(await verifyRaw(Buffer.from(crlf, 'utf8'))).toBe('pass');
        expect(await verifyRaw(result.envelope.rawMime)).toBe('pass');
      });
    }

    it('trailing whitespace stripped by a relay still breaks a simple/simple body hash', async () => {
      const crlf = await signed('simple/simple');
      const stripped = crlf.replace(/[ \t]+\r\n/g, '\r\n');
      expect(stripped).not.toBe(crlf);
      expect(await verifyRaw(Buffer.from(stripped, 'utf8'))).not.toBe('pass');
    });
  });
});

describe('ship-dark gate (functions/src/summaries/gate.ts)', () => {
  const original = process.env.SUMMARIES_ENABLED;

  afterEach(() => {
    if (original === undefined) delete process.env.SUMMARIES_ENABLED;
    else process.env.SUMMARIES_ENABLED = original;
  });

  it('summariesEnabledAtLoad reads SUMMARIES_ENABLED exactly like whatsappEnabledAtLoad', () => {
    delete process.env.SUMMARIES_ENABLED;
    expect(summariesEnabledAtLoad()).toBe(false);
    for (const value of ['', 'false', '0', '1', 'yes', 'truex', 'tru']) {
      process.env.SUMMARIES_ENABLED = value;
      expect(summariesEnabledAtLoad()).toBe(false);
    }
    for (const value of ['true', 'TRUE', ' True ', 'true\n']) {
      process.env.SUMMARIES_ENABLED = value;
      expect(summariesEnabledAtLoad()).toBe(true);
    }
  });

  it('parsePilotUids splits on commas, trims and drops empty entries', () => {
    expect([...parsePilotUids('')]).toEqual([]);
    expect([...parsePilotUids(' , ,, ')]).toEqual([]);
    expect([...parsePilotUids('u1')]).toEqual(['u1']);
    expect([...parsePilotUids(' u1 , uid-1,,user_2 ,u1')]).toEqual(['u1', 'uid-1', 'user_2']);
  });

  it('accepts the uid shapes the app produces', () => {
    const autoId = 'Ab3dE5gH7jK9mN1pQ3sT5vW7yZ2b';
    const microsoft = 'ms_00000000-0000-0000-0000-00000000c0de';
    expect(autoId).toHaveLength(28);
    const set = parsePilotUids(`${autoId},${microsoft},u-google,synthetic-uid-0002`);
    expect([...set]).toEqual([autoId, microsoft, 'u-google', 'synthetic-uid-0002']);
    expect(PILOT_UID_PATTERN.test('a'.repeat(128))).toBe(true);
    expect(PILOT_UID_PATTERN.test('a'.repeat(129))).toBe(false);
  });

  it('drops entries that are not a plain uid and counts them', () => {
    const raw = `ok_1,bad/uid,x/extra/y,has space,${'a'.repeat(129)},semi;colon,dot.ted,uml${String.fromCharCode(0xfc)}t,"quoted",ok-2`;
    const list = parsePilotList(raw);
    expect([...list.uids]).toEqual(['ok_1', 'ok-2']);
    expect(list.invalid).toBe(8);
  });

  it('isPilotUid matches exactly and case-sensitively', () => {
    const raw = 'u1, Uid-Two ,user_2';
    expect(isPilotUid('u1', raw)).toBe(true);
    expect(isPilotUid('Uid-Two', raw)).toBe(true);
    expect(isPilotUid('uid-two', raw)).toBe(false);
    expect(isPilotUid('u', raw)).toBe(false);
    expect(isPilotUid('u1 ', raw)).toBe(false);
    expect(isPilotUid('', raw)).toBe(false);
    expect(isPilotUid('u1', '')).toBe(false);
    expect(isPilotUid('bad/uid', 'bad/uid')).toBe(false);
  });

  it('tolerates a non-string list without throwing', () => {
    expect([...parsePilotUids(undefined as unknown as string)]).toEqual([]);
    expect(isPilotUid('u1', null as unknown as string)).toBe(false);
    expect(isPilotUid(42 as unknown as string, '42')).toBe(false);
  });
});

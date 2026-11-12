/**
 * The payload builder of functions/scripts/send-test-inbound.mjs
 * (functions/src/summaries/provider/postmarkTestPayload.ts; docs/v2/M10-DESIGN.md section 11 step
 * 4c and its usage note; docs/v2/M11-DESIGN.md section 10). The script only does I/O around these
 * pure functions: the payload must parse with the real adapter, keep the .eml bytes (so a signed
 * recap still verifies), route through the envelope recipient, authenticate with the real Basic
 * auth check, and its terminal views must never carry content or credentials. All data is
 * synthetic.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { dkimVerify } from 'mailauth';

import { tokenFromEnvelope } from '../../src/summaries/address';
import { SUMMARY_MIME_LIMITS } from '../../src/summaries/mime';
import { POSTMARK_FIELD_LIMITS, SUMMARIES_MAX_BODY_BYTES, checkBasicAuth, parsePostmarkInbound } from '../../src/summaries/provider/postmark';
import {
  TEST_MAX_EML_BYTES,
  TEST_PAYLOAD_WARNING_TEXT,
  TEST_RAW_TOO_LARGE_BYTES,
  TEST_WEBHOOK_AUTH_ENV,
  buildTestInboundPayload,
  checkTestUrl,
  describeTestPayload,
  describeTestResponse,
  isEnvelopeAddress,
  mailboxHashOf,
  printableUrl,
  readHeaderBlock,
  splitMailbox,
  testWebhookAuthorization,
  type BuildTestPayloadInput,
} from '../../src/summaries/provider/postmarkTestPayload';
import { PRIVATE_ADDRESS, RECAP_BODY, RECEIVED_AT, VENDOR_DOMAIN, buildMessage, createFixtureDns, fixtureKeys, signMessage } from './summariesFixtures';

const MESSAGE_ID = '0b6c2f5e-8d41-4a7b-9c3e-5f1a2b3c4d5e';
const SECRET = 'synthetic-webhook-secret-0002';
const TOKEN = 'k3j5h7g2f4d6s2a3p5o7i2u4y6';
const PROD_TEMPLATE = '{token}@summaries.meetingguard.example';
const DEV_PREFIX = 'a1b2c3d4e5f60718';
const DEV_TEMPLATE = `${DEV_PREFIX}+{token}@inbound.postmarkapp.com`;
const DEV_ADDRESS = `${DEV_PREFIX}+${TOKEN}@inbound.postmarkapp.com`;
const SUBJECT = 'Recap: Urpayroll weekly sync';

type Built = Extract<ReturnType<typeof buildTestInboundPayload>, { ok: true }>;

function build(raw: string | Buffer, overrides: Partial<BuildTestPayloadInput> = {}): ReturnType<typeof buildTestInboundPayload> {
  return buildTestInboundPayload({
    rawEmail: Buffer.isBuffer(raw) ? raw : Buffer.from(raw, 'utf8'),
    to: PRIVATE_ADDRESS,
    fromEnvelope: null,
    messageId: MESSAGE_ID,
    ...overrides,
  });
}

function built(raw: string | Buffer, overrides: Partial<BuildTestPayloadInput> = {}): Built {
  const result = build(raw, overrides);
  if (!result.ok) throw new Error(`build refused: ${result.reason}`);
  return result;
}

/** What the webhook's framework hands the adapter: the JSON body, parsed. */
function onTheWire(result: Built): unknown {
  return JSON.parse(result.body) as unknown;
}

describe('constants', () => {
  it('mirror the pipeline limits and name the environment variable', () => {
    expect(TEST_RAW_TOO_LARGE_BYTES).toBe(SUMMARY_MIME_LIMITS.maxRawBytes);
    expect(TEST_MAX_EML_BYTES).toBe(SUMMARIES_MAX_BODY_BYTES);
    expect(TEST_WEBHOOK_AUTH_ENV).toBe('SUMMARIES_TEST_WEBHOOK_AUTH');
  });
});

describe('the payload through the real adapter', () => {
  const dns = createFixtureDns();

  it('a signed recap keeps its exact bytes and still verifies', async () => {
    const signed = await signMessage(buildMessage(), { domain: VENDOR_DOMAIN, selector: 's1', privateKey: fixtureKeys().vendor.privateKey });
    const original = Buffer.from(signed, 'utf8');
    const result = built(original);
    expect(result.facts).toMatchObject({ rawBytes: original.length, utf8Exact: true, lineEndings: 'crlf', warnings: [] });
    expect(result.facts.headerCounts).toEqual({ from: 1, to: 1, date: 1, subject: 1, messageId: 1, dkimSignature: 1 });

    const parsed = parsePostmarkInbound(onTheWire(result));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.envelope.rawMime.equals(original)).toBe(true);
    expect(parsed.envelope.providerEventId).toBe(MESSAGE_ID);
    expect(parsed.envelope.envelopeRecipient).toEqual({ originalRecipient: PRIVATE_ADDRESS, mailboxHash: null });
    const verified = await dkimVerify(parsed.envelope.rawMime, { resolver: dns.resolver, curTime: RECEIVED_AT });
    expect(verified.results[0]?.status.result).toBe('pass');
  });

  it('a UTF-8 8-bit message (Spanish accents) round-trips byte for byte', () => {
    const accented = `Reuni${String.fromCharCode(0xf3)}n semanal, ma${String.fromCharCode(0xf1)}ana`;
    const original = Buffer.from(buildMessage({ subject: accented, body: `${accented}\r\n` }), 'utf8');
    const result = built(original);
    expect(result.facts.utf8Exact).toBe(true);
    expect(result.payload.Subject).toBe(accented);
    const parsed = parsePostmarkInbound(onTheWire(result));
    expect(parsed.ok && parsed.envelope.rawMime.equals(original)).toBe(true);
  });

  it('a legacy-charset 8-bit message is flagged, because RawEmail cannot keep its bytes', () => {
    const original = Buffer.concat([Buffer.from(buildMessage({ body: 'Reuni' }), 'latin1'), Buffer.from([0xf3]), Buffer.from('n\r\n', 'latin1')]);
    const result = built(original);
    expect(result.facts.utf8Exact).toBe(false);
    expect(result.facts.warnings).toContain('not_utf8');
    const parsed = parsePostmarkInbound(onTheWire(result));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.envelope.rawMime.equals(original)).toBe(false);
  });

  it('bare LF line endings are kept as they are', () => {
    const lf = buildMessage().replace(/\r\n/g, '\n');
    const result = built(lf);
    expect(result.facts.lineEndings).toBe('lf');
    expect(result.payload.RawEmail).toBe(lf);
    expect(built(`${buildMessage()}\nextra line\n`).facts.lineEndings).toBe('mixed');
    expect(built('From: a@b.example').facts.lineEndings).toBe('none');
  });

  it('routes through OriginalRecipient with the production template', () => {
    const parsed = parsePostmarkInbound(onTheWire(built(buildMessage())));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(tokenFromEnvelope(parsed.envelope.envelopeRecipient, PROD_TEMPLATE)).toBe(TOKEN);
  });

  it('fills MailboxHash from the part after "+" for the Postmark default address', () => {
    const result = built(buildMessage(), { to: DEV_ADDRESS });
    expect(result.payload).toMatchObject({ OriginalRecipient: DEV_ADDRESS, To: DEV_ADDRESS, MailboxHash: TOKEN });
    expect(result.payload.ToFull).toEqual([{ Email: DEV_ADDRESS, Name: '', MailboxHash: TOKEN }]);
    const wire = onTheWire(result) as Record<string, unknown>;
    const parsed = parsePostmarkInbound(wire);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(tokenFromEnvelope(parsed.envelope.envelopeRecipient, DEV_TEMPLATE)).toBe(TOKEN);
    // Without OriginalRecipient the adapter falls back to MailboxHash, which routes too.
    const hashOnly = parsePostmarkInbound({ ...wire, OriginalRecipient: '' });
    expect(hashOnly.ok).toBe(true);
    if (hashOnly.ok) expect(tokenFromEnvelope(hashOnly.envelope.envelopeRecipient, DEV_TEMPLATE)).toBe(TOKEN);
  });

  it('carries --from-envelope as a Return-Path entry the adapter ignores', () => {
    const result = built(buildMessage(), { fromEnvelope: 'bounce@mailer.example' });
    expect(result.payload.Headers).toEqual([{ Name: 'Return-Path', Value: '<bounce@mailer.example>' }]);
    expect(built(buildMessage()).payload.Headers).toEqual([]);
    const parsed = parsePostmarkInbound(onTheWire(result));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(Object.keys(parsed.envelope).sort()).toEqual(['envelopeRecipient', 'provider', 'providerEventId', 'rawMime']);
  });

  it('stays inside the adapter field bounds', () => {
    const result = built(buildMessage());
    expect(result.payload.MessageID.length).toBeLessThanOrEqual(POSTMARK_FIELD_LIMITS.messageIdChars);
    expect(result.payload.OriginalRecipient.length).toBeLessThanOrEqual(POSTMARK_FIELD_LIMITS.originalRecipientChars);
    expect(result.facts.bodyBytes).toBe(Buffer.byteLength(result.body, 'utf8'));
  });
});

describe('JSON fields from the header block only', () => {
  it('reads From, FromName, Subject and Date from the headers', () => {
    const result = built(buildMessage({ from: '"Notetaker Recaps" <recaps@notetaker.example>' }));
    expect(result.payload).toMatchObject({
      From: 'recaps@notetaker.example',
      FromName: 'Notetaker Recaps',
      Subject: SUBJECT,
      Date: 'Tue, 10 Nov 2026 15:20:00 +0000',
      MessageStream: 'inbound',
    });
    expect(result.payload.FromFull).toEqual({ Email: 'recaps@notetaker.example', Name: 'Notetaker Recaps', MailboxHash: '' });
  });

  it('unfolds a folded Subject and collapses its whitespace', () => {
    const raw = buildMessage({ subject: 'Recap:\r\n  Urpayroll\r\n\tweekly sync' });
    expect(built(raw).payload.Subject).toBe(SUBJECT);
  });

  it('never reads a field-like line of the body, and takes the first of duplicates', () => {
    const raw = buildMessage({ extraHeaders: ['Subject: second subject'], body: 'Subject: from the body\r\nFrom: body@attacker.example\r\n' });
    const result = built(raw);
    expect(result.payload.Subject).toBe(SUBJECT);
    expect(result.payload.From).toBe('recaps@notetaker.example');
    expect(result.facts.headerCounts.subject).toBe(2);
  });

  it('leaves absent fields empty', () => {
    const result = built('X-Only: one\r\n\r\nBody\r\n');
    expect(result.payload).toMatchObject({ From: '', FromName: '', Subject: '', Date: '' });
  });

  it('splitMailbox handles the common From forms', () => {
    expect(splitMailbox('Notetaker <recaps@notetaker.example>')).toEqual({ email: 'recaps@notetaker.example', name: 'Notetaker' });
    expect(splitMailbox('recaps@notetaker.example (Notetaker)')).toEqual({ email: 'recaps@notetaker.example', name: '' });
    expect(splitMailbox('<recaps@notetaker.example>')).toEqual({ email: 'recaps@notetaker.example', name: '' });
  });

  it('readHeaderBlock reports separators, mbox lines and malformed lines', () => {
    expect(readHeaderBlock('From: a@b.example\r\n\r\nBody').hasBodySeparator).toBe(true);
    expect(readHeaderBlock('From: a@b.example\r\nTo: c@d.example').hasBodySeparator).toBe(false);
    expect(readHeaderBlock('\r\nBody')).toEqual({ fields: [], hasBodySeparator: true, mboxFromLine: false, malformedLines: 0 });
    expect(readHeaderBlock('From sender@b.example Tue Nov 10 15:20:00 2026\nFrom: a@b.example\n\nBody').mboxFromLine).toBe(true);
    expect(readHeaderBlock('From: a@b.example\nnot a header\n\nBody').malformedLines).toBe(1);
    expect(readHeaderBlock(' leading continuation\nFrom: a@b.example\n\nBody').malformedLines).toBe(1);
  });
});

describe('warnings (the send still goes ahead; the pipeline decides)', () => {
  it('flags what the pipeline will refuse or treat as unsigned', () => {
    expect(built(buildMessage()).facts.warnings).toEqual(['no_dkim_signature']);
    expect(built(`From sender@b.example Tue Nov 10 15:20:00 2026\r\n${buildMessage()}`).facts.warnings).toContain('mbox_from_line');
    expect(built('From: a@b.example\r\nSubject: no body').facts.warnings).toContain('no_body_separator');
    expect(built(buildMessage({ extraHeaders: ['broken line'] })).facts.warnings).toContain('malformed_header_lines');
    expect(built(buildMessage({ extraHeaders: ['From: second@b.example'] })).facts.warnings).toContain('from_not_exactly_one');
    expect(built('To: a@b.example\r\n\r\nBody').facts.warnings).toContain('from_not_exactly_one');
  });

  it('flags a message over the 5 MiB raw limit', () => {
    const big = `${buildMessage({ body: '' })}${'a'.repeat(TEST_RAW_TOO_LARGE_BYTES)}`;
    expect(built(big).facts.warnings).toContain('raw_too_large');
  });

  it('has an ASCII explanation for every warning', () => {
    for (const text of Object.values(TEST_PAYLOAD_WARNING_TEXT)) expect(/^[\x20-\x7e]+$/.test(text)).toBe(true);
  });
});

describe('refusals (inputs the script controls)', () => {
  it('refuses an empty file, bad addresses, a bad id and an oversize body', () => {
    expect(build(Buffer.alloc(0))).toEqual({ ok: false, reason: 'empty_eml' });
    for (const to of ['', 'no-at-sign', 'two@@b.example', 'a b@c.example', '<a@b.example>', 'a@b.example, c@d.example', `${'a'.repeat(250)}@b.example`]) {
      expect(build(buildMessage(), { to })).toEqual({ ok: false, reason: 'invalid_to' });
    }
    expect(build(buildMessage(), { fromEnvelope: 'not an address' })).toEqual({ ok: false, reason: 'invalid_from_envelope' });
    expect(build(buildMessage(), { messageId: 'has space' })).toEqual({ ok: false, reason: 'invalid_message_id' });
    expect(build(buildMessage(), { messageId: 'x'.repeat(257) })).toEqual({ ok: false, reason: 'invalid_message_id' });
    const oversize = `${buildMessage({ body: '' })}${'a'.repeat(SUMMARIES_MAX_BODY_BYTES)}`;
    expect(build(oversize)).toEqual({ ok: false, reason: 'body_too_large' });
  });

  it('isEnvelopeAddress and mailboxHashOf', () => {
    expect(isEnvelopeAddress(PRIVATE_ADDRESS)).toBe(true);
    expect(isEnvelopeAddress(DEV_ADDRESS)).toBe(true);
    expect(isEnvelopeAddress('a@-b.example')).toBe(false);
    expect(mailboxHashOf(DEV_ADDRESS)).toBe(TOKEN);
    expect(mailboxHashOf(PRIVATE_ADDRESS)).toBe('');
    expect(mailboxHashOf('a+b+c@d.example')).toBe('b+c');
  });
});

describe('testWebhookAuthorization', () => {
  it('builds the header the real Basic auth check accepts', () => {
    const result = testWebhookAuthorization(`postmark:${SECRET}`);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(checkBasicAuth(result.authorization, SECRET)).toBe(true);
      expect(checkBasicAuth(result.authorization, `${SECRET}x`)).toBe(false);
      expect(result.authorization.includes(SECRET)).toBe(false);
    }
  });

  it('keeps a secret that itself contains ":"', () => {
    const result = testWebhookAuthorization('postmark:a:b:c');
    expect(result.ok && checkBasicAuth(result.authorization, 'a:b:c')).toBe(true);
  });

  it('refuses a missing or malformed value', () => {
    expect(testWebhookAuthorization(undefined)).toEqual({ ok: false, reason: 'missing' });
    expect(testWebhookAuthorization('')).toEqual({ ok: false, reason: 'missing' });
    for (const value of [SECRET, `user:${SECRET}`, 'Postmark:x', 'postmark:', 'postmark:   ', `postmark:${SECRET}\n`, `postmark:${SECRET}\r`]) {
      expect(testWebhookAuthorization(value)).toEqual({ ok: false, reason: 'bad_form' });
    }
  });
});

describe('checkTestUrl', () => {
  it('accepts https and loopback http only, never credentials in the URL', () => {
    expect(checkTestUrl('https://us-central1-demo.cloudfunctions.net/summaryInbound').ok).toBe(true);
    expect(checkTestUrl('http://127.0.0.1:5001/demo-meetingguard/us-central1/summaryInbound').ok).toBe(true);
    expect(checkTestUrl('http://localhost:5001/x').ok).toBe(true);
    expect(checkTestUrl('http://[::1]:5001/x').ok).toBe(true);
    expect(checkTestUrl('http://example.com/summaryInbound')).toEqual({ ok: false, reason: 'insecure_http' });
    expect(checkTestUrl('https://postmark:secret@example.com/summaryInbound')).toEqual({ ok: false, reason: 'credentials_in_url' });
    expect(checkTestUrl('ftp://example.com/')).toEqual({ ok: false, reason: 'invalid_url' });
    expect(checkTestUrl('not a url')).toEqual({ ok: false, reason: 'invalid_url' });
  });

  it('printableUrl drops the query and the fragment', () => {
    const checked = checkTestUrl('https://example.com/summaryInbound?x=1#y');
    expect(checked.ok && printableUrl(checked.url)).toBe('https://example.com/summaryInbound');
  });
});

describe('terminal views carry no content and no credentials', () => {
  it('describeTestPayload keeps the routing fields and shows .eml values as lengths', () => {
    const result = built(buildMessage({ from: 'Dana Notes <dana@company.example>' }), { to: DEV_ADDRESS, fromEnvelope: 'bounce@mailer.example' });
    const shape = describeTestPayload(result.payload);
    const text = JSON.stringify(shape);
    for (const content of ['Urpayroll', 'Recap', 'Dana', 'dana@company.example', 'Provide APK', 'Nov 2026', RECAP_BODY.slice(0, 20)]) {
      expect(text.includes(content)).toBe(false);
    }
    expect(shape).toMatchObject({
      To: DEV_ADDRESS,
      OriginalRecipient: DEV_ADDRESS,
      MailboxHash: TOKEN,
      MessageID: MESSAGE_ID,
      Subject: `<${SUBJECT.length} characters>`,
      RawEmail: `<${result.payload.RawEmail.length} characters, truncated>`,
      Headers: [{ Name: 'Return-Path', Value: '<bounce@mailer.example>' }],
    });
    expect(Object.keys(shape).sort()).toEqual(Object.keys(result.payload).sort());
  });

  it('describeTestResponse shows the fixed answers with a hint', () => {
    const ok = describeTestResponse(200, 'ok');
    expect(ok.line).toBe('HTTP 200 ok');
    expect(ok.hint).toContain('summaries.inbound');
    expect(describeTestResponse(401, 'Unauthorized')).toMatchObject({ line: 'HTTP 401 Unauthorized' });
    expect(describeTestResponse(401, 'Unauthorized').hint).toContain('postmark:');
    expect(describeTestResponse(404, 'Not configured').line).toBe('HTTP 404 Not configured');
    expect(describeTestResponse(500, 'Internal Server Error').hint).toContain('summaries.setup_alarm');
    expect(describeTestResponse(302, '').hint).toContain('Redirect not followed');
    expect(describeTestResponse(418, 'ok').hint).toBeNull();
  });

  it('describeTestResponse shows code-like reason fields only, never other text', () => {
    expect(describeTestResponse(200, JSON.stringify({ verdict: 'stored', reason: 'filed', title: 'Urpayroll weekly sync' })).line).toBe(
      'HTTP 200 verdict=stored reason=filed',
    );
    const google = describeTestResponse(403, JSON.stringify({ error: { code: 403, status: 'PERMISSION_DENIED', message: 'The caller does not have permission' } }));
    expect(google.line).toBe('HTTP 403 error.status=PERMISSION_DENIED error.code=403');
    const prose = describeTestResponse(200, JSON.stringify({ reason: 'Provide APK access to Urpayroll' }));
    expect(prose.line).toBe(`HTTP 200 (body not shown, ${Buffer.byteLength(JSON.stringify({ reason: 'Provide APK access to Urpayroll' }))} bytes)`);
    const html = describeTestResponse(502, '<html><body>Bad Gateway: Urpayroll</body></html>');
    expect(html.line).toMatch(/^HTTP 502 \(body not shown, \d+ bytes\)$/);
  });
});

describe('scripts/send-test-inbound.mjs', () => {
  const scriptPath = join(__dirname, '..', '..', 'scripts', 'send-test-inbound.mjs');
  const script = readFileSync(scriptPath, 'utf8');

  it('loads the compiled copy of this module', () => {
    expect(script).toContain("require('../lib/summaries/provider/postmarkTestPayload.js')");
    expect(existsSync(join(__dirname, '..', '..', 'src', 'summaries', 'provider', 'postmarkTestPayload.ts'))).toBe(true);
  });

  it('reads the credentials from the environment variable only and never prints them or the body', () => {
    expect(script).toContain('process.env[lib.TEST_WEBHOOK_AUTH_ENV]');
    expect(script.match(/process\.env/g)).toHaveLength(1);
    for (const line of script.split('\n').filter((candidate) => candidate.includes('console.'))) {
      for (const banned of ['auth.authorization', 'process.env', 'built.body', 'JSON.stringify(built', 'raw)', 'values.url', 'text)']) {
        expect(line.includes(banned)).toBe(false);
      }
    }
  });

  it('is plain ASCII (noTypographicChars does not scan functions/scripts)', () => {
    expect(/^[\t\n\r\x20-\x7e]*$/.test(script)).toBe(true);
  });
});

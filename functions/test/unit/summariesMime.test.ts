/**
 * M10 MIME parsing (functions/src/summaries/mime.ts, docs/v2/M10-DESIGN.md section 4 step 5, row
 * 4, findings 11 and 16): plain, alternative and HTML-only bodies, charset and transfer decoding,
 * the raw size cap before parsing, the part and depth caps enforced by postal-mime 4.1.4, attached
 * messages never parsed inline, own text parts only (no regex HTML conversion), and garbage that
 * never throws. All messages are synthetic.
 */
let mockParsersCreated = 0;
let mockBreak: 'none' | 'counters' | 'text_map' | 'text_entry' | 'text_mismatch' | 'throw' = 'none';

jest.mock('firebase-functions/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

jest.mock('postal-mime', () => {
  const Actual = jest.requireActual<typeof PostalMimeType>('postal-mime');
  type Internals = { counters?: unknown; textMap?: unknown };
  class CountingPostalMime extends Actual {
    constructor(options?: PostalMimeType.PostalMimeOptions) {
      super(options);
      mockParsersCreated += 1;
    }

    override async parse(buf: PostalMimeType.RawEmail): Promise<PostalMimeType.Email> {
      if (mockBreak === 'throw') throw new TypeError('synthetic parser crash');
      const email = await super.parse(buf);
      const internals = this as unknown as Internals;
      if (mockBreak === 'counters') delete internals.counters;
      if (mockBreak === 'text_map') internals.textMap = {};
      if (mockBreak === 'text_entry' && internals.textMap instanceof Map) {
        for (const entry of internals.textMap.values()) (entry as Record<string, unknown>).plain = [{ type: 'subMessage', value: {} }];
      }
      if (mockBreak === 'text_mismatch' && internals.textMap instanceof Map) {
        for (const entry of internals.textMap.values()) (entry as Record<string, unknown>).plain = [{ type: 'text', value: 'different' }];
      }
      return email;
    }
  }
  return { __esModule: true, default: CountingPostalMime };
});

import * as logger from 'firebase-functions/logger';
import type PostalMimeType from 'postal-mime';

import { POSTAL_MIME_OPTIONS, SUMMARY_MIME_LIMITS, parseMime, type MimeParseResult } from '../../src/summaries/mime';

const CRLF = '\r\n';
const O_ACUTE = String.fromCharCode(0xf3);
const E_ACUTE = String.fromCharCode(0xe9);
const N_TILDE = String.fromCharCode(0xf1);

const BASE_HEADERS = ['From: Notetaker <recaps@notetaker.example>', 'To: dana@company.example', 'Subject: Recap: weekly sync', 'MIME-Version: 1.0'];

function mail(headers: readonly string[], body: string): Buffer {
  return Buffer.from([...headers, '', body].join(CRLF), 'utf8');
}

function okResult(result: MimeParseResult): Extract<MimeParseResult, { ok: true }> {
  if (!result.ok) throw new Error(`expected ok, got ${result.reason}`);
  return result;
}

/** Root multipart at level 0, one multipart per level, the text leaf at level `depth`. */
function nested(depth: number): Buffer {
  let part = `Content-Type: text/plain${CRLF}${CRLF}leaf${CRLF}`;
  for (let level = depth - 1; level >= 0; level -= 1) {
    const boundary = `b${level}`;
    part = `Content-Type: multipart/mixed; boundary="${boundary}"${CRLF}${CRLF}--${boundary}${CRLF}${part}--${boundary}--${CRLF}`;
  }
  return Buffer.from(`${BASE_HEADERS.join(CRLF)}${CRLF}${part}`, 'utf8');
}

/** A multipart/mixed with `children` text parts: children + 1 MIME nodes. */
function flat(children: number): Buffer {
  let body = '';
  for (let index = 0; index < children; index += 1) body += `--zz${CRLF}Content-Type: text/plain${CRLF}${CRLF}part ${index}${CRLF}`;
  body += `--zz--${CRLF}`;
  return mail([...BASE_HEADERS, 'Content-Type: multipart/mixed; boundary="zz"'], body);
}

/** Deterministic pseudo-random bytes (xorshift32). */
function noise(length: number, seed: number): Buffer {
  const out = Buffer.alloc(length);
  let state = seed >>> 0 || 1;
  for (let index = 0; index < length; index += 1) {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    out[index] = state & 0xff;
  }
  return out;
}

beforeEach(() => {
  mockParsersCreated = 0;
  mockBreak = 'none';
});

describe('SUMMARY_MIME_LIMITS and parser options', () => {
  it('holds the design caps', () => {
    expect(SUMMARY_MIME_LIMITS).toEqual({ maxRawBytes: 5 * 1024 * 1024, maxParts: 100, maxDepth: 10, maxHeaderBytes: 1024 * 1024 });
  });

  it('passes the caps to postal-mime and never parses attached messages inline', () => {
    expect(POSTAL_MIME_OPTIONS).toMatchObject({
      maxNestingDepth: 10,
      maxPartCount: 100,
      maxHeadersSize: 1024 * 1024,
      forceRfc822Attachments: true,
      maxRfc822NestingDepth: 0,
    });
  });
});

describe('parseMime bodies', () => {
  it('reads a plain text message', async () => {
    const result = okResult(await parseMime(mail([...BASE_HEADERS, 'Content-Type: text/plain; charset=utf-8'], `Action items${CRLF}[ ] Send the checklist${CRLF}`)));
    expect(result.subject).toBe('Recap: weekly sync');
    expect(result.text?.trimEnd()).toBe(`Action items\n[ ] Send the checklist`);
    expect(result.html).toBeNull();
    expect(result.partCount).toBe(1);
    expect(result.attachmentCount).toBe(0);
    expect(result.attachedMessageCount).toBe(0);
  });

  it('defaults to text/plain without a Content-Type', async () => {
    const result = okResult(await parseMime(mail(BASE_HEADERS, 'Just text')));
    expect(result.text?.trimEnd()).toBe('Just text');
    expect(result.html).toBeNull();
  });

  it('reads multipart/alternative as the plain part and the html part', async () => {
    const body = [
      '--alt',
      'Content-Type: text/plain; charset=utf-8',
      '',
      'Decisions: ship Friday',
      '--alt',
      'Content-Type: text/html; charset=utf-8',
      '',
      '<p>Decisions: <b>ship Friday</b></p>',
      '--alt--',
      '',
    ].join(CRLF);
    const result = okResult(await parseMime(mail([...BASE_HEADERS, 'Content-Type: multipart/alternative; boundary="alt"'], body)));
    expect(result.text?.trim()).toBe('Decisions: ship Friday');
    expect(result.html?.trim()).toBe('<p>Decisions: <b>ship Friday</b></p>');
    expect(result.partCount).toBe(3);
    expect(result.attachmentCount).toBe(0);
  });

  it('reads an HTML-only message as html with no text', async () => {
    const result = okResult(await parseMime(mail([...BASE_HEADERS, 'Content-Type: text/html; charset=utf-8'], '<p>Only <i>html</i></p>')));
    expect(result.text).toBeNull();
    expect(result.html?.trim()).toBe('<p>Only <i>html</i></p>');
    expect(result.partCount).toBe(1);
  });

  it('never converts an HTML part into text: hidden HTML text stays out of text (finding 16)', async () => {
    const body = [
      '--mix',
      'Content-Type: text/html; charset=utf-8',
      '',
      '<p>Visible</p><div style="display:none">HIDDEN INSTRUCTION</div>',
      '--mix',
      'Content-Type: text/plain; charset=utf-8',
      '',
      'plain part',
      '--mix--',
      '',
    ].join(CRLF);
    const result = okResult(await parseMime(mail([...BASE_HEADERS, 'Content-Type: multipart/mixed; boundary="mix"'], body)));
    expect(result.text?.trim()).toBe('plain part');
    expect(result.text).not.toContain('HIDDEN');
    expect(result.text).not.toContain('Visible');
    expect(result.html?.trim()).toBe('<p>Visible</p><div style="display:none">HIDDEN INSTRUCTION</div>');
    expect(result.html).not.toContain('plain part');
    expect(result.partCount).toBe(3);
  });

  it('joins several own text parts in document order', async () => {
    const body = ['--mix', 'Content-Type: text/plain', '', 'first', '--mix', 'Content-Type: image/png', 'Content-Transfer-Encoding: base64', '', 'iVBORw0KGgo=', '--mix', 'Content-Type: text/plain', '', 'second', '--mix--', ''].join(CRLF);
    const result = okResult(await parseMime(mail([...BASE_HEADERS, 'Content-Type: multipart/mixed; boundary="mix"'], body)));
    expect(result.text?.split('\n').filter((line) => line.length > 0)).toEqual(['first', 'second']);
    expect(result.attachmentCount).toBe(1);
    expect(result.partCount).toBe(4);
  });

  it('counts attachments and keeps their content out of text', async () => {
    const body = [
      '--mix',
      'Content-Type: text/plain',
      '',
      'See attached',
      '--mix',
      'Content-Type: application/pdf; name="notes.pdf"',
      'Content-Disposition: attachment; filename="notes.pdf"',
      'Content-Transfer-Encoding: base64',
      '',
      Buffer.from('ATTACHED SECRET TEXT').toString('base64'),
      '--mix',
      'Content-Type: text/plain',
      'Content-Disposition: attachment; filename="extra.txt"',
      '',
      'ATTACHED TEXT FILE',
      '--mix--',
      '',
    ].join(CRLF);
    const result = okResult(await parseMime(mail([...BASE_HEADERS, 'Content-Type: multipart/mixed; boundary="mix"'], body)));
    expect(result.text?.trim()).toBe('See attached');
    expect(result.attachmentCount).toBe(2);
    // A PDF and a text file are attachments, not attached messages.
    expect(result.attachedMessageCount).toBe(0);
    expect(result.partCount).toBe(4);
  });

  it('keeps an attached message out of text and html, inline disposition included', async () => {
    for (const disposition of ['', 'Content-Disposition: inline', 'Content-Disposition: attachment; filename="fwd.eml"']) {
      const inner = ['From: someone@else.example', 'Subject: Inner subject', 'Content-Type: text/html', '', '<p>INNER BODY</p>'].join(CRLF);
      const headers = ['Content-Type: message/rfc822', ...(disposition ? [disposition] : [])];
      const body = ['--mix', 'Content-Type: text/plain', '', 'outer text', '--mix', ...headers, '', inner, '--mix--', ''].join(CRLF);
      const result = okResult(await parseMime(mail([...BASE_HEADERS, 'Content-Type: multipart/mixed; boundary="mix"'], body)));
      expect(result.text?.trim()).toBe('outer text');
      expect(result.html).toBeNull();
      expect(`${result.text}${result.html}${result.subject}`).not.toMatch(/INNER|Inner subject|someone@else/);
      expect(result.attachmentCount).toBe(1);
      expect(result.attachedMessageCount).toBe(1);
      expect(result.partCount).toBe(3);
    }
  });

  it('counts attached messages: message/rfc822 in any case, message/global and a multipart/digest child', async () => {
    const inner = ['From: someone@else.example', 'Subject: Inner subject', 'Content-Type: text/plain', '', 'INNER BODY'].join(CRLF);
    const body = [
      '--mix',
      'Content-Type: text/plain',
      '',
      'outer note',
      '--mix',
      'Content-Type: Message/RFC822',
      'Content-Disposition: attachment; filename="one.eml"',
      '',
      inner,
      '--mix',
      'Content-Type: message/global',
      'Content-Disposition: attachment; filename="two.eml"',
      '',
      inner,
      '--mix',
      'Content-Type: multipart/digest; boundary="dig"',
      '',
      '--dig',
      '',
      inner,
      '--dig--',
      '--mix',
      'Content-Type: application/pdf; name="notes.pdf"',
      'Content-Disposition: attachment; filename="notes.pdf"',
      'Content-Transfer-Encoding: base64',
      '',
      Buffer.from('PDF BYTES').toString('base64'),
      '--mix--',
      '',
    ].join(CRLF);
    const result = okResult(await parseMime(mail([...BASE_HEADERS, 'Content-Type: multipart/mixed; boundary="mix"'], body)));
    expect(result.text?.trim()).toBe('outer note');
    expect(`${result.text}${result.html}`).not.toMatch(/INNER|Inner subject/);
    expect(result.attachmentCount).toBe(4);
    expect(result.attachedMessageCount).toBe(3);
  });

  it('counts an attached message by file name (.eml or .msg, any case) whatever its declared type', async () => {
    const inner = ['From: someone@else.example', 'Subject: Inner subject', 'Content-Type: text/plain', '', 'INNER BODY', ''].join(CRLF);
    const attachment = (type: string, filename: string, content: string): string[] => [
      '--mix',
      `Content-Type: ${type}; name="${filename}"`,
      `Content-Disposition: attachment; filename="${filename}"`,
      'Content-Transfer-Encoding: base64',
      '',
      Buffer.from(content).toString('base64'),
    ];
    const cases: readonly [string, string][] = [
      ['application/octet-stream', 'recap.eml'],
      ['application/octet-stream', 'Recap.EML'],
      ['application/octet-stream', 'Weekly sync.Msg'],
      ['application/x-msg', 'recap.msg'],
      ['text/plain', 'recap.eml'],
      ['application/octet-stream', ' recap.eml. '],
    ];
    for (const [type, filename] of cases) {
      const body = ['--mix', 'Content-Type: text/plain', '', 'outer note', ...attachment(type, filename, inner), '--mix--', ''].join(CRLF);
      const result = okResult(await parseMime(mail([...BASE_HEADERS, 'Content-Type: multipart/mixed; boundary="mix"'], body)));
      expect([type, filename, result.text?.trim(), result.attachmentCount, result.attachedMessageCount]).toEqual([type, filename, 'outer note', 1, 1]);
      expect(`${result.text}${result.html}`).not.toMatch(/INNER|Inner subject/);
    }
    // A name that only contains the ending, or another ending, is no attached message.
    for (const filename of ['recap.eml.pdf', 'notes.emlx', 'message.txt', 'eml', 'msg']) {
      const body = ['--mix', 'Content-Type: text/plain', '', 'outer note', ...attachment('application/octet-stream', filename, 'bytes'), '--mix--', ''].join(CRLF);
      const result = okResult(await parseMime(mail([...BASE_HEADERS, 'Content-Type: multipart/mixed; boundary="mix"'], body)));
      expect([filename, result.attachmentCount, result.attachedMessageCount]).toEqual([filename, 1, 0]);
    }
  });

  it('counts message/news, message/partial and Outlook items (application/vnd.ms-outlook) as attached messages', async () => {
    const inner = ['From: someone@else.example', 'Subject: Inner subject', 'Content-Type: text/plain', '', 'INNER BODY'].join(CRLF);
    const parts = [
      ['Content-Type: message/news', 'Content-Disposition: attachment', '', inner],
      ['Content-Type: message/partial; id="frag-1@else.example"; number=1; total=1', '', inner],
      ['Content-Type: Application/Vnd.MS-Outlook', 'Content-Disposition: attachment', 'Content-Transfer-Encoding: base64', '', Buffer.from('0123456789abcdef').toString('base64')],
    ];
    for (const part of parts) {
      const body = ['--mix', 'Content-Type: text/plain', '', 'outer note', '--mix', ...part, '--mix--', ''].join(CRLF);
      const result = okResult(await parseMime(mail([...BASE_HEADERS, 'Content-Type: multipart/mixed; boundary="mix"'], body)));
      expect([part[0], result.text?.trim(), result.attachmentCount, result.attachedMessageCount]).toEqual([part[0], 'outer note', 1, 1]);
      expect(`${result.text}${result.html}`).not.toMatch(/INNER|Inner subject/);
    }
  });

  it('answers null for an absent or empty subject', async () => {
    expect(okResult(await parseMime(mail(['From: recaps@notetaker.example'], 'x'))).subject).toBeNull();
    expect(okResult(await parseMime(mail(['From: recaps@notetaker.example', 'Subject:'], 'x'))).subject).toBeNull();
  });

  it('answers null text for an empty body', async () => {
    const result = okResult(await parseMime(Buffer.from(`${BASE_HEADERS.join(CRLF)}${CRLF}${CRLF}`, 'utf8')));
    expect(result.text).toBeNull();
    expect(result.html).toBeNull();
  });

  it('accepts bare LF line endings', async () => {
    const raw = Buffer.from('From: recaps@notetaker.example\nSubject: LF only\nContent-Type: text/plain\n\nline one\nline two\n', 'utf8');
    const result = okResult(await parseMime(raw));
    expect(result.subject).toBe('LF only');
    expect(result.text?.trimEnd()).toBe('line one\nline two');
  });
});

describe('parseMime decoding', () => {
  it('decodes a latin1 8-bit body', async () => {
    const raw = Buffer.concat([
      Buffer.from([...BASE_HEADERS, 'Content-Type: text/plain; charset=iso-8859-1', 'Content-Transfer-Encoding: 8bit', '', 'Reuni'].join(CRLF), 'latin1'),
      Buffer.from([0xf3]),
      Buffer.from('n de espa', 'latin1'),
      Buffer.from([0xf1]),
      Buffer.from(`ol${CRLF}`, 'latin1'),
    ]);
    const result = okResult(await parseMime(raw));
    expect(result.text?.trimEnd()).toBe(`Reuni${O_ACUTE}n de espa${N_TILDE}ol`);
  });

  it('decodes a latin1 quoted-printable body', async () => {
    const raw = mail([...BASE_HEADERS, 'Content-Type: text/plain; charset=iso-8859-1', 'Content-Transfer-Encoding: quoted-printable'], `Caf=E9 y reuni=F3n=${CRLF}continued${CRLF}`);
    expect(okResult(await parseMime(raw)).text?.trimEnd()).toBe(`Caf${E_ACUTE} y reuni${O_ACUTE}ncontinued`);
  });

  it('decodes a utf-8 quoted-printable body with a soft line break', async () => {
    const raw = mail([...BASE_HEADERS, 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: quoted-printable'], `Reuni=C3=B3n de espa=C3=B1ol, pr=C3=B3xima=${CRLF} semana${CRLF}`);
    expect(okResult(await parseMime(raw)).text?.trimEnd()).toBe(`Reuni${O_ACUTE}n de espa${N_TILDE}ol, pr${O_ACUTE}xima semana`);
  });

  it('decodes a utf-8 base64 body', async () => {
    const text = `Decisi${O_ACUTE}n: lanzar el viernes`;
    const raw = mail([...BASE_HEADERS, 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64'], Buffer.from(text, 'utf8').toString('base64'));
    expect(okResult(await parseMime(raw)).text?.trimEnd()).toBe(text);
  });

  it('decodes RFC 2047 encoded words in the subject (Q and B)', async () => {
    const q = mail(['From: recaps@notetaker.example', 'Subject: =?UTF-8?Q?Reuni=C3=B3n_semanal?='], 'x');
    expect(okResult(await parseMime(q)).subject).toBe(`Reuni${O_ACUTE}n semanal`);
    const encoded = Buffer.from(`Resumen: reuni${O_ACUTE}n`, 'utf8').toString('base64');
    const b = mail(['From: recaps@notetaker.example', `Subject: =?utf-8?B?${encoded}?=`], 'x');
    expect(okResult(await parseMime(b)).subject).toBe(`Resumen: reuni${O_ACUTE}n`);
    const latin = mail(['From: recaps@notetaker.example', 'Subject: =?ISO-8859-1?Q?Caf=E9?='], 'x');
    expect(okResult(await parseMime(latin)).subject).toBe(`Caf${E_ACUTE}`);
  });

  it('decodes the html part with its own charset', async () => {
    const raw = mail([...BASE_HEADERS, 'Content-Type: text/html; charset=iso-8859-1', 'Content-Transfer-Encoding: quoted-printable'], '<p>Reuni=F3n</p>');
    const result = okResult(await parseMime(raw));
    expect(result.html?.trim()).toBe(`<p>Reuni${O_ACUTE}n</p>`);
    expect(result.text).toBeNull();
  });
});

describe('parseMime caps', () => {
  it('refuses a raw message over 5 MiB as too_large before the parser runs', async () => {
    const raw = Buffer.alloc(SUMMARY_MIME_LIMITS.maxRawBytes + 1, 0x61);
    await expect(parseMime(raw)).resolves.toEqual({ ok: false, reason: 'too_large' });
    expect(mockParsersCreated).toBe(0);
  });

  it('parses a message of exactly 5 MiB', async () => {
    const head = Buffer.from(`${BASE_HEADERS.join(CRLF)}${CRLF}Content-Type: text/plain${CRLF}${CRLF}`, 'utf8');
    const line = `${'a'.repeat(98)}${CRLF}`;
    const fill = SUMMARY_MIME_LIMITS.maxRawBytes - head.length;
    const bodyText = line.repeat(Math.floor(fill / line.length)) + 'b'.repeat(fill % line.length);
    const raw = Buffer.concat([head, Buffer.from(bodyText, 'utf8')]);
    expect(raw.length).toBe(SUMMARY_MIME_LIMITS.maxRawBytes);
    const result = okResult(await parseMime(raw));
    expect(result.partCount).toBe(1);
    expect(mockParsersCreated).toBe(1);
  });

  it('accepts parts nested 10 levels deep and refuses 11 as too_large (the contract: 10 levels of nesting)', async () => {
    const ten = okResult(await parseMime(nested(10)));
    expect(ten.partCount).toBe(11);
    expect(ten.text?.trim()).toBe('leaf');
    await expect(parseMime(nested(11))).resolves.toEqual({ ok: false, reason: 'too_large' });
    await expect(parseMime(nested(40))).resolves.toEqual({ ok: false, reason: 'too_large' });
  });

  it('accepts 100 MIME parts (the message included) and refuses 101 as too_large', async () => {
    expect(okResult(await parseMime(flat(99))).partCount).toBe(100);
    await expect(parseMime(flat(100))).resolves.toEqual({ ok: false, reason: 'too_large' });
    await expect(parseMime(flat(5000))).resolves.toEqual({ ok: false, reason: 'too_large' });
  });

  it('refuses header bytes over 1 MiB as too_large', async () => {
    const padding = Array.from({ length: 1200 }, (_, index) => `X-Pad-${index}: ${'a'.repeat(980)}`);
    const raw = mail([...BASE_HEADERS, ...padding], 'body');
    expect(raw.length).toBeLessThan(SUMMARY_MIME_LIMITS.maxRawBytes);
    await expect(parseMime(raw)).resolves.toEqual({ ok: false, reason: 'too_large' });
  });

  it('does not log the expected structural refusals', async () => {
    await parseMime(nested(11));
    await parseMime(flat(100));
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });
});

describe('parseMime never throws', () => {
  it('answers malformed for an empty or non-Buffer input', async () => {
    await expect(parseMime(Buffer.alloc(0))).resolves.toEqual({ ok: false, reason: 'malformed' });
    for (const value of [undefined, null, 'From: a@b.example', 42, {}, new Uint8Array([0x41])]) {
      await expect(parseMime(value as unknown as Buffer)).resolves.toEqual({ ok: false, reason: 'malformed' });
    }
    expect(mockParsersCreated).toBe(0);
  });

  it('resolves for garbage input, ok or malformed, never rejecting', async () => {
    const inputs: Buffer[] = [
      noise(4096, 1),
      noise(65536, 7),
      noise(300_000, 42),
      Buffer.alloc(1024, 0),
      Buffer.from(CRLF.repeat(5000), 'latin1'),
      Buffer.from('\r'.repeat(10_000), 'latin1'),
      Buffer.from('no colon header line\r\n\r\nbody', 'latin1'),
      Buffer.from(`Content-Type: multipart/mixed; boundary="x"${CRLF}${CRLF}--x${CRLF}--x${CRLF}--x`, 'latin1'),
      Buffer.from(`Content-Type: multipart/mixed${CRLF}${CRLF}--${CRLF}body`, 'latin1'),
      Buffer.from(`Content-Type: multipart/alternative; boundary=""${CRLF}${CRLF}----${CRLF}`, 'latin1'),
      Buffer.from(`Content-Type: text/plain; charset=x-unknown-charset${CRLF}${CRLF}text`, 'latin1'),
      Buffer.from(`Content-Type: text/plain${CRLF}Content-Transfer-Encoding: base64${CRLF}${CRLF}!!!not base64@@@${CRLF}`, 'latin1'),
      Buffer.from(`Content-Type: text/plain${CRLF}Content-Transfer-Encoding: quoted-printable${CRLF}${CRLF}=ZZ=0=${CRLF}`, 'latin1'),
      Buffer.from(`Subject: =?UTF-8?B?////?=${CRLF}Subject: =?bogus?Q?x?=${CRLF}${CRLF}x`, 'latin1'),
      Buffer.from(`Content-Type: message/rfc822${CRLF}${CRLF}Content-Type: message/rfc822${CRLF}${CRLF}deep`, 'latin1'),
      Buffer.from('x'.repeat(1024 * 1024), 'latin1'),
      Buffer.from(`${'H: v'.repeat(1)}${CRLF} ${'folded '.repeat(20_000)}${CRLF}${CRLF}b`, 'latin1'),
    ];
    for (const raw of inputs) {
      const result = await parseMime(raw);
      expect(typeof result.ok).toBe('boolean');
      if (!result.ok) expect(['malformed', 'too_large']).toContain(result.reason);
    }
  });

  it('answers malformed for an unexpected parser error and logs only its name', async () => {
    mockBreak = 'throw';
    await expect(parseMime(mail(BASE_HEADERS, 'secret body text'))).resolves.toEqual({ ok: false, reason: 'malformed' });
    expect(logger.warn).toHaveBeenCalledWith('summaries.mime_error', { errorName: 'TypeError', code: null });
    expect(JSON.stringify((logger.warn as jest.Mock).mock.calls)).not.toMatch(/secret|crash|Recap|notetaker/);
  });
});

describe('parseMime fails closed when the pinned parser internals change', () => {
  const raw = mail([...BASE_HEADERS, 'Content-Type: text/plain'], 'secret body text');

  for (const [mode, detail] of [
    ['counters', 'part_count'],
    ['text_map', 'text_map'],
    ['text_entry', 'text_entry'],
    ['text_mismatch', 'text_mismatch'],
  ] as const) {
    it(`${mode} -> malformed with an error log carrying the detail only`, async () => {
      mockBreak = mode;
      await expect(parseMime(raw)).resolves.toEqual({ ok: false, reason: 'malformed' });
      expect(logger.error).toHaveBeenCalledWith('summaries.mime_parser_shape', { detail });
      expect(JSON.stringify((logger.error as jest.Mock).mock.calls)).not.toMatch(/secret|Recap|notetaker/);
    });
  }

  it('reads the internals of the unmodified parser (the pinned 4.1.4 shape)', async () => {
    const result = okResult(await parseMime(raw));
    expect(result.text?.trimEnd()).toBe('secret body text');
    expect(logger.error).not.toHaveBeenCalled();
  });
});

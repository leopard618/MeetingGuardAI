/**
 * M10 Gmail forwarding confirmation (functions/src/summaries/gmail.ts, docs/v2/M10-DESIGN.md
 * section 4 step 10, definition G, finding 14).
 *
 * Every sample below is SYNTHETIC and UNVERIFIED: written from the known public shape of Gmail's
 * English confirmation, with a guessed Spanish form. Replace them with the shape of the first real
 * message once it is captured (never commit a real one; the addresses here are invented).
 */
import { parseGmailConfirmation, GMAIL_SCAN_LIMITS } from '../../src/summaries/gmail';

const PRIVATE_ADDRESS = 'k3j5h7g2f4d6s2a3p5o7i2u4y6@summaries.meetingguard.example';
const O_ACUTE = String.fromCharCode(0xf3);
const I_ACUTE = String.fromCharCode(0xed);
const O_ACUTE_UPPER = String.fromCharCode(0xd3);
const NBSP = String.fromCharCode(0xa0);

/** Synthetic English body in the known layout (UNVERIFIED). */
function englishBody(requester: string, code: string): string {
  return [
    `${requester} has requested to automatically forward mail to your email`,
    `address ${PRIVATE_ADDRESS}.`,
    `Confirmation code: ${code}`,
    '',
    `To allow ${requester} to automatically forward mail to your address,`,
    'please click the link below to confirm the request:',
    '',
    'https://mail-settings.google.example/mail/vf-%5B111111111%5D-AbCdEf0123',
    '',
    'If you click the link and it appears to be broken, please copy and paste it',
    'into a new browser window. If you are not able to access the link, you can',
    `send the confirmation code ${code} to ${requester}.`,
    '',
    'Thanks for using Gmail!',
    '',
    'If you do not approve of this request, no further action is required.',
    'To cancel this verification, click this link:',
    'https://mail-settings.google.example/mail/uf-%5B222222222%5D-ZyXwVu9876',
  ].join('\r\n');
}

function englishSubject(requester: string, code: string): string {
  return `(#${code}) Gmail Forwarding Confirmation - Receive Mail from ${requester}`;
}

/** Synthetic Spanish-like sample (wording UNVERIFIED). */
function spanishSubject(requester: string, code: string): string {
  return `(#${code}) Confirmaci${O_ACUTE}n de reenv${I_ACUTE}o de Gmail: recibir correo de ${requester}`;
}

function spanishBody(requester: string, code: string, label = `C${O_ACUTE}digo de confirmaci${O_ACUTE}n`): string {
  return [
    `${requester} ha solicitado reenviar autom${String.fromCharCode(0xe1)}ticamente correo a tu direcci${O_ACUTE}n ${PRIVATE_ADDRESS}.`,
    `${label}: ${code}`,
    '',
    'https://mail-settings.google.example/mail/vf-%5B333333333%5D-Spanish0001',
  ].join('\n');
}

describe('parseGmailConfirmation: English (synthetic, UNVERIFIED)', () => {
  it('reads the code and the requesting address', () => {
    const requester = 'dana.example@gmail.com';
    expect(parseGmailConfirmation(englishSubject(requester, '123456789'), englishBody(requester, '123456789'))).toEqual({
      gmailAddress: requester,
      code: '123456789',
    });
  });

  it('works from the subject alone', () => {
    expect(parseGmailConfirmation(englishSubject('dana.example@gmail.com', '123456789'), null)).toEqual({
      gmailAddress: 'dana.example@gmail.com',
      code: '123456789',
    });
  });

  it('works from the English body alone (code line plus requester line)', () => {
    expect(parseGmailConfirmation(null, englishBody('dana.example@gmail.com', '555000111'))).toEqual({
      gmailAddress: 'dana.example@gmail.com',
      code: '555000111',
    });
    expect(parseGmailConfirmation('Gmail Forwarding Confirmation', englishBody('dana.example@gmail.com', '555000111'))).toEqual({
      gmailAddress: 'dana.example@gmail.com',
      code: '555000111',
    });
  });

  it('lowercases the address', () => {
    expect(parseGmailConfirmation(englishSubject('Dana.Example@GMail.com', '123456789'), null)).toEqual({
      gmailAddress: 'dana.example@gmail.com',
      code: '123456789',
    });
  });

  it('accepts a Google Workspace address in any domain', () => {
    const requester = 'francisco.demo@company.example';
    expect(parseGmailConfirmation(englishSubject(requester, '987654321'), englishBody(requester, '987654321'))).toEqual({
      gmailAddress: requester,
      code: '987654321',
    });
    expect(parseGmailConfirmation(englishSubject('ops-team@mail.sub.company.example', '42'), null)).toEqual({
      gmailAddress: 'ops-team@mail.sub.company.example',
      code: '42',
    });
  });

  it('accepts an address wrapped in angle brackets or followed by punctuation', () => {
    expect(parseGmailConfirmation('(#123) Receive Mail from <dana@gmail.com>', null)).toEqual({ gmailAddress: 'dana@gmail.com', code: '123' });
    expect(parseGmailConfirmation('(#123) Receive Mail from dana@gmail.com.', null)).toEqual({ gmailAddress: 'dana@gmail.com', code: '123' });
    expect(parseGmailConfirmation('(#123) Receive Mail from (dana@gmail.com)', null)).toEqual({ gmailAddress: 'dana@gmail.com', code: '123' });
  });

  it('accepts a non-breaking space around the body code', () => {
    expect(parseGmailConfirmation(null, `dana@gmail.com has requested to automatically forward mail\nConfirmation code:${NBSP}777`)).toEqual({
      gmailAddress: 'dana@gmail.com',
      code: '777',
    });
  });
});

describe('parseGmailConfirmation: Spanish-like (synthetic, wording UNVERIFIED)', () => {
  it('reads the subject marker and address in another language', () => {
    const requester = 'dana.example@gmail.com';
    expect(parseGmailConfirmation(spanishSubject(requester, '246813579'), spanishBody(requester, '246813579'))).toEqual({
      gmailAddress: requester,
      code: '246813579',
    });
  });

  it('reads the code from the accented Spanish label when the subject has no marker', () => {
    const requester = 'Dana.Example@Company.example';
    const subject = `Confirmaci${O_ACUTE}n de reenv${I_ACUTE}o de Gmail: recibir correo de ${requester}`;
    expect(parseGmailConfirmation(subject, spanishBody(requester, '135792468'))).toEqual({
      gmailAddress: 'dana.example@company.example',
      code: '135792468',
    });
  });

  it('reads the unaccented and upper-case label forms', () => {
    const subject = 'Confirmacion de reenvio de Gmail: recibir correo de dana@gmail.com';
    for (const label of ['Codigo de confirmacion', `C${O_ACUTE_UPPER}DIGO DE CONFIRMACI${O_ACUTE_UPPER}N`, `co${String.fromCharCode(0x301)}digo de confirmacio${String.fromCharCode(0x301)}n`]) {
      expect(parseGmailConfirmation(subject, spanishBody('dana@gmail.com', '1112223', label))).toEqual({ gmailAddress: 'dana@gmail.com', code: '1112223' });
    }
  });

  it('uses only the subject address in Spanish (the body requester line is English-only)', () => {
    expect(parseGmailConfirmation(null, spanishBody('dana@gmail.com', '1112223'))).toBeNull();
  });
});

describe('parseGmailConfirmation: refusals', () => {
  const requester = 'dana.example@gmail.com';

  it('answers null when the subject code and the body code differ', () => {
    expect(parseGmailConfirmation(englishSubject(requester, '123456789'), englishBody(requester, '123456780'))).toBeNull();
  });

  it('answers null for two different subject markers or two different body code lines', () => {
    expect(parseGmailConfirmation(`(#111) (#222) Receive Mail from ${requester}`, null)).toBeNull();
    expect(parseGmailConfirmation(null, `${requester} has requested to automatically forward mail\nConfirmation code: 111\nConfirmation code: 222`)).toBeNull();
  });

  it('accepts the same code repeated in the subject and the body', () => {
    expect(parseGmailConfirmation(`(#111) (#111) Receive Mail from ${requester}`, 'Confirmation code: 111')).toEqual({ gmailAddress: requester, code: '111' });
  });

  it('answers null without a code', () => {
    expect(parseGmailConfirmation(`Gmail Forwarding Confirmation - Receive Mail from ${requester}`, null)).toBeNull();
    expect(parseGmailConfirmation(`Gmail Forwarding Confirmation - Receive Mail from ${requester}`, englishBody(requester, '').replace(/Confirmation code: \r\n/, ''))).toBeNull();
    expect(parseGmailConfirmation(null, null)).toBeNull();
    expect(parseGmailConfirmation('', '')).toBeNull();
  });

  it('never takes a code from running text that is not a whole label line', () => {
    const body = `${requester} has requested to automatically forward mail\nsend the confirmation code 999 to ${requester}.\nYour Confirmation code: 999 is below`;
    expect(parseGmailConfirmation(null, body)).toBeNull();
  });

  it('answers null for a code the contract pattern refuses', () => {
    expect(parseGmailConfirmation(`(#${'1'.repeat(33)}) Receive Mail from ${requester}`, null)).toBeNull();
    expect(parseGmailConfirmation(`(#${'1'.repeat(32)}) Receive Mail from ${requester}`, null)).toEqual({ gmailAddress: requester, code: '1'.repeat(32) });
    expect(parseGmailConfirmation(null, `${requester} has requested to automatically forward mail\nConfirmation code: 12-34`)).toBeNull();
    expect(parseGmailConfirmation(`(#12a) Receive Mail from ${requester}`, null)).toBeNull();
  });

  it('answers null without a valid address', () => {
    expect(parseGmailConfirmation('(#123456789) Gmail Forwarding Confirmation', null)).toBeNull();
    expect(parseGmailConfirmation('(#123456789) Receive Mail from dana@@gmail.com', null)).toBeNull();
    expect(parseGmailConfirmation('(#123456789) Receive Mail from "dana"@gmail.com', null)).toBeNull();
    expect(parseGmailConfirmation('(#123456789) Receive Mail from dana@localhost', null)).toBeNull();
    expect(parseGmailConfirmation('(#123456789) Receive Mail from dana@[192.0.2.1]', null)).toBeNull();
    expect(parseGmailConfirmation(`(#123456789) Receive Mail from dana@g${String.fromCharCode(0x43c)}ail.com`, null)).toBeNull();
    expect(parseGmailConfirmation('(#123456789) Receive Mail from =?utf-8?Q?x?=@gmail.com', null)).toBeNull();
  });

  it('skips an over-long token quickly instead of trying it as an address', () => {
    const started = Date.now();
    const body = `${'.'.repeat(60_000)}@gmail.com${'.'.repeat(4000)} has requested to automatically forward mail\nConfirmation code: 1`;
    expect(parseGmailConfirmation(null, body)).toBeNull();
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('answers null for two different addresses in the subject', () => {
    expect(parseGmailConfirmation(`(#123) Receive Mail from ${requester} for ${PRIVATE_ADDRESS}`, null)).toBeNull();
  });

  it('answers null when the subject address and the English requester line disagree', () => {
    expect(parseGmailConfirmation(englishSubject(requester, '123'), englishBody('mallory@attacker.example', '123'))).toBeNull();
  });

  it('answers null for an over-long subject', () => {
    const subject = `${englishSubject(requester, '123')} ${'x'.repeat(GMAIL_SCAN_LIMITS.maxSubjectChars)}`;
    expect(parseGmailConfirmation(subject, null)).toBeNull();
  });

  it('scans only the start of a long body', () => {
    const body = `${'filler line\n'.repeat(Math.ceil(GMAIL_SCAN_LIMITS.maxBodyChars / 12) + 10)}${requester} has requested to automatically forward mail\nConfirmation code: 123`;
    expect(parseGmailConfirmation(null, body)).toBeNull();
    expect(parseGmailConfirmation(englishSubject(requester, '123'), body)).toEqual({ gmailAddress: requester, code: '123' });
  });
});

describe('parseGmailConfirmation never returns a link', () => {
  it('ignores the confirmation and cancel links (their codes and addresses included)', () => {
    const requester = 'dana.example@gmail.com';
    const result = parseGmailConfirmation(englishSubject(requester, '123456789'), englishBody(requester, '123456789'));
    expect(result).not.toBeNull();
    expect(Object.keys(result ?? {}).sort()).toEqual(['code', 'gmailAddress']);
    expect(JSON.stringify(result)).not.toMatch(/https?:|mail-settings|vf-|uf-|111111111|222222222/);
  });

  it('never takes an address or a code out of a URL', () => {
    const body = [
      'https://user@attacker.example/confirm has requested to automatically forward mail',
      'https://mail-settings.google.example/mail/vf?code=999&from=dana@gmail.com',
      'Confirmation code: https://attacker.example/888',
      '<https://attacker.example/?u=mallory@attacker.example>',
    ].join('\n');
    expect(parseGmailConfirmation('(#123456789) Gmail Forwarding Confirmation', body)).toBeNull();
    expect(parseGmailConfirmation(null, body)).toBeNull();
  });

  it('ignores a link token in the subject', () => {
    expect(parseGmailConfirmation('(#123) Receive Mail from https://evil.example/@x', null)).toBeNull();
    expect(parseGmailConfirmation('(#123) Receive Mail from dana@gmail.com https://evil.example/x', null)).toEqual({ gmailAddress: 'dana@gmail.com', code: '123' });
  });
});

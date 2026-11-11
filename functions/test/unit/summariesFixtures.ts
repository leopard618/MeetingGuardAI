/**
 * Signed-mail fixtures for the M10 authenticity tests (docs/v2/M10-DESIGN.md section 12).
 *
 * Every message is synthetic and signed inside the test run with mailauth's own signer, using
 * RSA keys generated here with node:crypto (2048 bits, and 512 bits for the weak-key case). The
 * public keys are served by a stub DNS resolver, so no test touches the network. Domains:
 * notetaker.example (the vendor), mg.notetaker.example (the vendor's aligned email service
 * subdomain, signing with the vendor key, the common Mailgun pattern), company.example (the
 * user), attacker.example, mailer.example (an unaligned email service) and google.com (Gmail's
 * confirmation and ARC sealer). A look-alike
 * vendor domain written with a non-ASCII letter is signed by rawDkimSign, since mailauth's own
 * signer always writes A-labels.
 */
import { createHash, createSign, generateKeyPairSync } from 'node:crypto';
import { dkimSign, sealMessage, type DNSResolver } from 'mailauth';

export const VENDOR_DOMAIN = 'notetaker.example';
export const VENDOR_ADDRESS = 'recaps@notetaker.example';
/** The vendor's email service signs as a subdomain of the vendor domain: aligned, not equal. */
export const VENDOR_ESP_DOMAIN = 'mg.notetaker.example';
export const USER_DOMAIN = 'company.example';
export const USER_MAILBOX = 'dana@company.example';
export const COLLEAGUE_ADDRESS = 'lee@company.example';
export const ATTACKER_DOMAIN = 'attacker.example';
export const ATTACKER_ADDRESS = 'mallory@attacker.example';
export const ESP_DOMAIN = 'mailer.example';
export const GMAIL_CONFIRMATION = 'forwarding-noreply@google.com';
/** A synthetic private address: 26 base32 characters at a reserved test domain. */
export const PRIVATE_ADDRESS = 'k3j5h7g2f4d6s2a3p5o7i2u4y6@summaries.meetingguard.example';
/**
 * The vendor domain with its first letter written as U+1D427 MATHEMATICAL BOLD SMALL N. UTS46
 * mapping (domainToASCII) turns it into notetaker.example, while mailauth fetches its key at the
 * Punycode of the label as written, MAPPED_VENDOR_ALABEL.
 */
export const MAPPED_VENDOR_DOMAIN = `${String.fromCodePoint(0x1d427)}otetaker.example`;
export const MAPPED_VENDOR_ALABEL = 'xn--otetaker-5t39f.example';

export const RECEIVED_AT = new Date('2026-11-10T16:00:00Z');
/** 40 minutes before RECEIVED_AT. */
export const FRESH_DATE = 'Tue, 10 Nov 2026 15:20:00 +0000';
/** 6 hours before RECEIVED_AT: still Fresh, but past the 5 hour temperror retry window. */
export const SIX_HOURS_OLD_DATE = 'Tue, 10 Nov 2026 10:00:00 +0000';
/** 20 days before RECEIVED_AT: not Fresh. */
export const STALE_DATE = 'Wed, 21 Oct 2026 15:20:00 +0000';

export const RECAP_BODY = [
  'Urpayroll weekly sync',
  'Meeting notes - 2026-11-10',
  '',
  'Action items',
  '[ ] Provide APK access to Urpayroll (owner: Bish)',
  '[ ] Send the release checklist (owner: Dana)',
  '',
].join('\r\n');

export interface TestKey {
  privateKey: string;
  /** base64 DER SubjectPublicKeyInfo, the p= value of a DKIM key record. */
  publicKey: string;
}

export function makeKey(bits: number): TestKey {
  const pair = generateKeyPairSync('rsa', { modulusLength: bits });
  return {
    privateKey: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKey: pair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
  };
}

export interface FixtureKeys {
  vendor: TestKey;
  user: TestKey;
  google: TestKey;
  attacker: TestKey;
  weak: TestKey;
}

let cachedKeys: FixtureKeys | null = null;

/** Generated once per test file (2048-bit generation is the slow part). */
export function fixtureKeys(): FixtureKeys {
  if (!cachedKeys) {
    cachedKeys = {
      vendor: makeKey(2048),
      user: makeKey(2048),
      google: makeKey(2048),
      attacker: makeKey(2048),
      weak: makeKey(512),
    };
  }
  return cachedKeys;
}

export interface FixtureDns {
  resolver: DNSResolver;
  /**
   * The same records as a node:dns style TXT lookup, for createDnsResolver({ lookupTxt }), so
   * the production resolver's budgets and caps run against the stub.
   */
  lookupTxt: (name: string) => Promise<string[][]>;
  /** Every name the resolver was asked for, in order. */
  lookups: string[];
  publish(name: string, record: string): void;
  /** Makes a name fail with a DNS error code (ETIMEOUT gives a temperror). */
  failWith(name: string, code: string): void;
  /**
   * Makes every name in a zone (the zone itself and its subdomains) hang: never answered. Use it
   * only behind createDnsResolver, whose lookup cap and budgets end the wait.
   */
  hang(zone: string): void;
}

/** A DKIM key record (TXT value) for a fixture key. */
export function dkimRecord(key: TestKey, extra = ''): string {
  return `v=DKIM1; k=rsa;${extra} p=${key.publicKey}`;
}

/** A stub resolver serving the fixture key records. */
export function createFixtureDns(keys: FixtureKeys = fixtureKeys()): FixtureDns {
  const records = new Map<string, string>();
  const failures = new Map<string, string>();
  const hangingZones: string[] = [];
  const lookups: string[] = [];
  records.set(`s1._domainkey.${VENDOR_DOMAIN}`, dkimRecord(keys.vendor));
  records.set(`ty._domainkey.${VENDOR_DOMAIN}`, dkimRecord(keys.vendor, ' t=y;'));
  records.set(`weak._domainkey.${VENDOR_DOMAIN}`, dkimRecord(keys.weak));
  records.set(`s1._domainkey.${VENDOR_ESP_DOMAIN}`, dkimRecord(keys.vendor));
  records.set(`s1._domainkey.${USER_DOMAIN}`, dkimRecord(keys.user));
  records.set(`s1._domainkey.${ATTACKER_DOMAIN}`, dkimRecord(keys.attacker));
  records.set(`s1._domainkey.${ESP_DOMAIN}`, dkimRecord(keys.attacker));
  records.set('s1._domainkey.google.com', dkimRecord(keys.google));
  records.set('arc._domainkey.google.com', dkimRecord(keys.google));
  records.set(`arc._domainkey.${ATTACKER_DOMAIN}`, dkimRecord(keys.attacker));
  failures.set(`slow._domainkey.${VENDOR_DOMAIN}`, 'ETIMEOUT');

  const answer = async (name: string, rrtype: string): Promise<string[][]> => {
    const key = name.toLowerCase();
    lookups.push(key);
    if (hangingZones.some((zone) => key === zone || key.endsWith(`.${zone}`))) return new Promise<string[][]>(() => undefined);
    const code = failures.get(key);
    if (code) throw Object.assign(new Error(`stub ${code}`), { code });
    const record = rrtype === 'TXT' ? records.get(key) : undefined;
    if (record === undefined) throw Object.assign(new Error('stub ENOTFOUND'), { code: 'ENOTFOUND' });
    return [[record]];
  };
  return {
    resolver: answer,
    lookupTxt: (name) => answer(name, 'TXT'),
    lookups,
    publish: (name, record) => records.set(name.toLowerCase(), record),
    failWith: (name, code) => failures.set(name.toLowerCase(), code),
    hang: (zone) => hangingZones.push(zone.toLowerCase()),
  };
}

export interface MessageSpec {
  from?: string;
  /** null leaves the field out. */
  to?: string | null;
  cc?: string | null;
  date?: string | null;
  subject?: string;
  messageId?: string | null;
  /** Raw header lines added after the standard ones (duplicates, extra fields). */
  extraHeaders?: string[];
  /** Raw header lines put before everything else. */
  leadingHeaders?: string[];
  body?: string;
}

/** A CRLF message. From, To, Date, Subject and Message-ID default to a bound vendor recap. */
export function buildMessage(spec: MessageSpec = {}): string {
  const lines: string[] = [...(spec.leadingHeaders ?? [])];
  lines.push(`From: ${spec.from ?? `Notetaker <${VENDOR_ADDRESS}>`}`);
  const to = spec.to === undefined ? USER_MAILBOX : spec.to;
  if (to !== null) lines.push(`To: ${to}`);
  if (spec.cc !== undefined && spec.cc !== null) lines.push(`Cc: ${spec.cc}`);
  const date = spec.date === undefined ? FRESH_DATE : spec.date;
  if (date !== null) lines.push(`Date: ${date}`);
  lines.push(`Subject: ${spec.subject ?? 'Recap: Urpayroll weekly sync'}`);
  const messageId = spec.messageId === undefined ? '<recap-0001@notetaker.example>' : spec.messageId;
  if (messageId !== null) lines.push(`Message-ID: ${messageId}`);
  lines.push('MIME-Version: 1.0', 'Content-Type: text/plain; charset=utf-8');
  lines.push(...(spec.extraHeaders ?? []));
  return `${lines.join('\r\n')}\r\n\r\n${spec.body ?? RECAP_BODY}`;
}

export interface SignSpec {
  domain: string;
  selector: string;
  privateKey: string;
  /** Colon list for h=; defaults to the vendor's list (From, To, Cc, Subject, Date, Message-ID). */
  headerList?: string;
  algorithm?: string;
  /** l= tag. */
  maxBodyLength?: number;
}

export const DEFAULT_SIGNED_HEADERS = 'from:to:cc:subject:date:message-id:mime-version:content-type';

/** Prepends a DKIM-Signature made by mailauth's signer. Throws when mailauth refuses to sign. */
export async function signMessage(message: string, spec: SignSpec): Promise<string> {
  const result = await dkimSign(message, {
    ...(spec.algorithm ? { algorithm: spec.algorithm } : {}),
    headerList: spec.headerList ?? DEFAULT_SIGNED_HEADERS,
    signatureData: [
      {
        signingDomain: spec.domain,
        selector: spec.selector,
        privateKey: spec.privateKey,
        ...(spec.maxBodyLength === undefined ? {} : { maxBodyLength: spec.maxBodyLength }),
      },
    ],
  });
  if (result.errors.length > 0 || result.signatures.length === 0) {
    throw new Error(`fixture signing failed: ${result.errors.map((entry) => entry.err.code ?? entry.err.message).join(',')}`);
  }
  return result.signatures + message;
}

/**
 * Signs once per spec, in order. Each signature is prepended, so the LAST spec ends up on top,
 * where mailauth verifies first.
 */
export async function signStacked(message: string, specs: readonly SignSpec[]): Promise<string> {
  let signed = message;
  for (const spec of specs) signed = await signMessage(signed, spec);
  return signed;
}

/** RFC 6376 relaxed body canonicalization of a CRLF body. */
function relaxedBody(body: string): string {
  const lines = body.split('\r\n').map((line) => line.replace(/[ \t]+/g, ' ').replace(/ $/, ''));
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines.length === 0 ? '' : `${lines.join('\r\n')}\r\n`;
}

/** RFC 6376 relaxed header canonicalization of one field, without the trailing CRLF. */
function relaxedField(name: string, value: string): string {
  return `${name.toLowerCase()}:${value.replace(/\r\n/g, '').replace(/[ \t]+/g, ' ').replace(/^ | $/g, '')}`;
}

/**
 * Prepends an rsa-sha256 relaxed/relaxed DKIM-Signature whose d= is written EXACTLY as given,
 * non-ASCII included (mailauth's signer would write the A-label). Single-instance header fields
 * only, which is all buildMessage writes.
 */
export function rawDkimSign(message: string, spec: SignSpec): string {
  const split = message.indexOf('\r\n\r\n');
  if (split === -1) throw new Error('fixture message has no body');
  const fields: { name: string; value: string }[] = [];
  for (const line of message.slice(0, split).split('\r\n')) {
    const last = fields[fields.length - 1];
    if ((line.startsWith(' ') || line.startsWith('\t')) && last) {
      last.value += `\r\n${line}`;
      continue;
    }
    const colon = line.indexOf(':');
    fields.push({ name: line.slice(0, colon), value: line.slice(colon + 1) });
  }
  const headerList = spec.headerList ?? DEFAULT_SIGNED_HEADERS;
  const bodyHash = createHash('sha256').update(relaxedBody(message.slice(split + 4)), 'utf8').digest('base64');
  let canonical = '';
  for (const name of headerList.split(':')) {
    const field = fields.find((candidate) => candidate.name.toLowerCase() === name);
    if (field) canonical += `${relaxedField(field.name, field.value)}\r\n`;
  }
  const value = ` v=1; a=rsa-sha256; c=relaxed/relaxed; d=${spec.domain}; s=${spec.selector}; h=${headerList}; bh=${bodyHash}; b=`;
  canonical += relaxedField('DKIM-Signature', value);
  const signature = createSign('RSA-SHA256').update(canonical, 'utf8').sign(spec.privateKey, 'base64');
  return `DKIM-Signature:${value}${signature}\r\n${message}`;
}

/** Vendor-signed recap with the vendor key (selector s1 unless overridden). */
export async function vendorSigned(spec: MessageSpec = {}, sign: Partial<SignSpec> = {}): Promise<string> {
  return signMessage(buildMessage(spec), {
    domain: VENDOR_DOMAIN,
    selector: 's1',
    privateKey: fixtureKeys().vendor.privateKey,
    ...sign,
  });
}

/** Prepends an ARC set (i=1, cv=none) sealed by mailauth's sealer, as a forwarding hop would. */
export async function arcSeal(message: string, sealer: { domain: string; selector: string; privateKey: string }): Promise<string> {
  const headers = await sealMessage(message, {
    signingDomain: sealer.domain,
    selector: sealer.selector,
    privateKey: sealer.privateKey,
    cv: 'none',
    authResults: `mx.${sealer.domain}; dkim=pass header.i=@${VENDOR_DOMAIN}`,
  });
  if (headers.length === 0) throw new Error('fixture ARC sealing failed');
  return headers.toString('latin1') + message;
}

/** Appends text after the signed body, as a forwarding footer or an attacker would. */
export function appendToBody(message: string, text: string): string {
  return `${message}${text}\r\n`;
}

/** Replaces the first occurrence of a header line (keeps the signature header as it is). */
export function replaceHeader(message: string, from: string, to: string): string {
  const index = message.indexOf(from);
  if (index === -1) throw new Error('fixture header not found');
  return message.slice(0, index) + to + message.slice(index + from.length);
}

export function toRaw(message: string): Buffer {
  return Buffer.from(message, 'utf8');
}

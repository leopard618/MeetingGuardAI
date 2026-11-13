/**
 * M10 authenticity (functions/src/summaries/authenticity.ts, functions/src/mail/auth.ts and
 * functions/src/mail/headers.ts), the security core: the decision table rows 4 to 14 with
 * messages signed in the test by mailauth's signer behind a stub resolver (docs/v2/M10-DESIGN.md
 * sections 5 and 12), the pure classify, header sanity and the strict parsers, the production
 * resolver's cache and budget (fake lookup, no network), and the log names of the shared
 * verifier. All data is synthetic.
 */
let mockDkimVerifyFailure = false;

jest.mock('firebase-functions/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

jest.mock('mailauth', () => {
  const actual = jest.requireActual('mailauth');
  return {
    ...actual,
    dkimVerify: (...args: unknown[]) => {
      if (mockDkimVerifyFailure) return Promise.reject(new TypeError('synthetic verifier crash'));
      return actual.dkimVerify(...args);
    },
  };
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { domainToASCII } from 'node:url';
import * as logger from 'firebase-functions/logger';
import { dkimVerify, type DKIMResult } from 'mailauth';

import {
  DNS_BUDGET_CODE,
  DNS_MESSAGE_BOUND_MS,
  MAILAUTH_VERIFIER,
  NO_ARC,
  createDnsResolver,
  domainsAlign,
  isBudgetRefusal,
  isPassSig,
  keyRecordDomain,
  normalizeSignature,
  normalizeSigningDomain,
  verifyMailAuth,
  type DnsRouting,
  type NormalizedSignature,
} from '../../src/mail/auth';
import {
  HEADER_LIMITS,
  checkHeaders,
  normalizeAddress,
  normalizeDomain,
  parseAddrSpec,
  parseAddressList,
  parseMailDate,
  parseStrictMailbox,
  type HeaderFacts,
} from '../../src/mail/headers';
import {
  AUTHENTICITY_TUNING,
  CLASSIFY_REASONS,
  assessAuthenticity,
  classify,
  decidingDomains,
  dnsRouting,
  normalizeSenders,
  runMailAuth,
  storedAuth,
  type AuthenticityContext,
  type ClassifyInput,
  type ClassifyOutcome,
  type DecisionRow,
} from '../../src/summaries/authenticity';
import {
  ATTACKER_ADDRESS,
  ATTACKER_DOMAIN,
  COLLEAGUE_ADDRESS,
  ESP_DOMAIN,
  FRESH_DATE,
  GMAIL_CONFIRMATION,
  MAPPED_VENDOR_ALABEL,
  MAPPED_VENDOR_DOMAIN,
  PRIVATE_ADDRESS,
  RECEIVED_AT,
  SIX_HOURS_OLD_DATE,
  STALE_DATE,
  USER_DOMAIN,
  USER_MAILBOX,
  VENDOR_ADDRESS,
  VENDOR_DOMAIN,
  VENDOR_ESP_DOMAIN,
  appendToBody,
  arcSeal,
  buildMessage,
  createFixtureDns,
  dkimRecord,
  fixtureKeys,
  rawDkimSign,
  replaceHeader,
  signMessage,
  signStacked,
  toRaw,
  vendorSigned,
  type FixtureDns,
  type FixtureKeys,
  type SignSpec,
} from './summariesFixtures';

const SENDERS = [VENDOR_ADDRESS];
const MAILBOXES = [USER_MAILBOX];
/** The decision inputs runMailAuth requires. */
const DECISION = { senders: SENDERS, mailboxes: MAILBOXES } as const;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

let keys: FixtureKeys;
let dns: FixtureDns;

beforeAll(() => {
  keys = fixtureKeys();
}, 60_000);

beforeEach(() => {
  dns = createFixtureDns(keys);
  mockDkimVerifyFailure = false;
});

async function assess(message: string, overrides: Partial<AuthenticityContext> = {}) {
  return assessAuthenticity(toRaw(message), {
    resolver: dns.resolver,
    receivedAt: RECEIVED_AT,
    senders: SENDERS,
    mailboxes: MAILBOXES,
    ...overrides,
  });
}

async function classifyMessage(message: string, overrides: Partial<AuthenticityContext> = {}) {
  return (await assess(message, overrides)).classification;
}

function signedAs(domain: string, privateKey: string, selector = 's1') {
  return { domain, selector, privateKey };
}

/** Signatures by the attacker's own key for attacker.example, one selector (one lookup) each. */
function attackerSpecs(count: number): SignSpec[] {
  return Array.from({ length: count }, (_, i) => signedAs(ATTACKER_DOMAIN, keys.attacker.privateKey, `h${i + 1}`));
}

/**
 * The finding: an unsigned forgery whose From is a listed sender or mailbox, carrying one fake
 * signature for that domain (made with the attacker's key, so it fails) below `hanging`
 * signatures from attacker.example, which mailauth verifies first.
 */
async function forgery(from: string, forgedDomain: string, hanging: number): Promise<string> {
  const forged = await signMessage(buildMessage({ from, to: PRIVATE_ADDRESS }), signedAs(forgedDomain, keys.attacker.privateKey));
  return signStacked(forged, attackerSpecs(hanging));
}

/**
 * A node:dns style lookup over the fixture records in which every name in `zone` costs `costMs`
 * on a fake clock and then fails with ETIMEOUT, as a hanging name server does behind node:dns's
 * own timeout and tries. Deterministic: no real waiting.
 */
function slowZoneLookup(zone: string, costMs: number, clock: { now: number }) {
  return async (name: string): Promise<string[][]> => {
    if (name === zone || name.endsWith(`.${zone}`)) {
      dns.lookups.push(name);
      clock.now += costMs;
      throw Object.assign(new Error('stub ETIMEOUT'), { code: 'ETIMEOUT' });
    }
    return dns.lookupTxt(name);
  };
}

/** assessAuthenticity with its own production resolver over a lookup seam (no injected resolver). */
function withProductionResolver(dnsOptions: NonNullable<AuthenticityContext['dns']>): Partial<AuthenticityContext> {
  return { resolver: undefined, dns: dnsOptions };
}

/** Real-timer budgets for the hanging-zone tests: small, so the suite stays fast. */
const SMALL_DNS = { lookupCapMs: 40, budgetMs: 100, alignedBudgetMs: 100, priorityBudgetMs: 400 } as const;

/**
 * Real-timer budgets in the production ratio (cap 8 s, shared 8 s, aligned 8 s, priority 16 s,
 * scaled down): the shared and aligned budgets hold exactly one full cap each and the priority
 * budget exactly two, so a test passes only when the cap arithmetic is exact.
 */
const RATIO_DNS = {
  lookupCapMs: 40,
  budgetMs: 40,
  alignedBudgetMs: 40,
  priorityBudgetMs: 80,
} as const;

/**
 * A node:dns style lookup over the fixture records in which every name in `zones` never answers
 * and, on a fake clock, makes the timers look `lateMs` late: the clock jumps that far at the
 * start of each hanging lookup, beyond the real-timer cap that ends it. A resolver that charged
 * the clock instead of exactly the cap would spend a budget early.
 */
function lateHangingLookup(zones: readonly string[], lateMs: number, clock: { now: number }) {
  return async (name: string): Promise<string[][]> => {
    if (zones.some((zone) => name === zone || name.endsWith(`.${zone}`))) {
      dns.lookups.push(name);
      clock.now += lateMs;
      return new Promise<string[][]>(() => undefined);
    }
    return dns.lookupTxt(name);
  };
}

// ---------------------------------------------------------------------------------------------
// Decision table with signed fixtures (section 12, Authenticity)
// ---------------------------------------------------------------------------------------------

describe('decision table with signed fixtures', () => {
  it('row 7: a bound vendor recap (signed To, signed fresh Date) is accepted', async () => {
    const result = await classifyMessage(await vendorSigned());
    expect(result).toEqual({
      row: 7,
      outcome: 'accept',
      tier: 'vendor_verified',
      reason: 'vendor_verified',
      recipientBound: true,
      fresh: true,
      decidingDomain: VENDOR_DOMAIN,
      senderDomain: VENDOR_DOMAIN,
      anchorAt: new Date('2026-11-10T15:20:00Z'),
      anchorSource: 'signed_date',
    });
    expect(dns.lookups).toContain(`s1._domainkey.${VENDOR_DOMAIN}`);
  });

  it('row 7: binding through a signed Cc naming a listed mailbox', async () => {
    const result = await classifyMessage(await vendorSigned({ to: PRIVATE_ADDRESS, cc: `Dana <${USER_MAILBOX}>` }));
    expect(result.row).toBe(7);
    expect(result.recipientBound).toBe(true);
  });

  it('row 7: the verified account email counts as a mailbox', async () => {
    const message = await vendorSigned({ to: 'owner@company.example' });
    const result = await classifyMessage(message, { mailboxes: [USER_MAILBOX, 'owner@company.example'] });
    expect(result.row).toBe(7);
  });

  it('row 8: a stale signed Date gives old_summary, anchored on that Date', async () => {
    const result = await classifyMessage(await vendorSigned({ date: STALE_DATE }));
    expect(result).toMatchObject({ row: 8, outcome: 'inbox', reason: 'old_summary', recipientBound: true, fresh: false });
    expect(result.anchorAt).toEqual(new Date('2026-10-21T15:20:00Z'));
  });

  it('row 8: an unsigned Date is never Fresh and never an anchor', async () => {
    const message = await vendorSigned({}, { headerList: 'from:to:subject:message-id' });
    const result = await classifyMessage(message);
    expect(result).toMatchObject({ row: 8, reason: 'old_summary', fresh: false, anchorAt: null, anchorSource: null });
  });

  it('row 9: the vendor sent the recap To the private address', async () => {
    const result = await classifyMessage(await vendorSigned({ to: PRIVATE_ADDRESS }));
    expect(result).toMatchObject({ row: 9, outcome: 'inbox', reason: 'not_addressed_to_you', recipientBound: false, fresh: true });
  });

  it('row 9: To naming the mailbox but not signed', async () => {
    const message = await vendorSigned({}, { headerList: 'from:subject:date:message-id' });
    const assessment = await assess(message);
    expect(assessment.mailAuth).toMatchObject({ ok: true });
    expect(assessment.classification).toMatchObject({ row: 9, reason: 'not_addressed_to_you' });
  });

  it('row 9: an added unsigned Cc naming a listed mailbox never binds', async () => {
    const signed = await vendorSigned({ to: PRIVATE_ADDRESS });
    const attacked = replaceHeader(signed, `To: ${PRIVATE_ADDRESS}`, `To: ${PRIVATE_ADDRESS}\r\nCc: ${USER_MAILBOX}`);
    const assessment = await assess(attacked);
    if (!assessment.mailAuth?.ok) throw new Error('expected a verified message');
    expect(assessment.mailAuth.signatures[0]).toMatchObject({ result: 'pass', signsCc: false });
    expect(assessment.header).toMatchObject({ ok: true, cc: [USER_MAILBOX] });
    expect(assessment.classification).toMatchObject({ row: 9, reason: 'not_addressed_to_you', recipientBound: false });
  });

  it('row 9: a mailbox written as a display name in To never binds', async () => {
    const result = await classifyMessage(await vendorSigned({ to: `"${USER_MAILBOX}" <someone@elsewhere.example>` }));
    expect(result).toMatchObject({ row: 9, recipientBound: false });
  });

  it('row 9: an undisclosed-recipients group in To (Bcc delivery) never binds and is not malformed', async () => {
    const result = await classifyMessage(await vendorSigned({ to: 'undisclosed-recipients:;' }));
    expect(result).toMatchObject({ row: 9, recipientBound: false });
  });

  it('row 10: a user forward from a listed mailbox waits in the inbox, never auto-filed', async () => {
    const message = await signMessage(
      buildMessage({ from: 'D\u00e1na <dana@company.example>', to: PRIVATE_ADDRESS, subject: 'Fwd: Recap' }),
      signedAs(USER_DOMAIN, keys.user.privateKey),
    );
    const result = await classifyMessage(message);
    expect(result).toMatchObject({
      row: 10,
      outcome: 'inbox',
      tier: 'user_forwarded',
      reason: 'user_forwarded',
      decidingDomain: USER_DOMAIN,
      senderDomain: USER_DOMAIN,
      anchorAt: null,
    });
  });

  it('row 11: a body-hash failure behind a valid google.com ARC chain', async () => {
    const forwarded = appendToBody(await vendorSigned(), '-- Sent through a forwarding rule');
    const sealed = await arcSeal(forwarded, signedAs('google.com', keys.google.privateKey, 'arc'));
    const assessment = await assess(sealed);
    if (!assessment.mailAuth?.ok) throw new Error('expected a verified message');
    expect(assessment.mailAuth.signatures[0]).toMatchObject({ domain: VENDOR_DOMAIN, result: 'fail' });
    expect(assessment.mailAuth.arc).toEqual({ result: 'pass', sealer: 'google.com' });
    expect(assessment.classification).toMatchObject({ row: 11, outcome: 'refuse', reason: 'could_not_verify_after_forwarding' });
  });

  it('row 12: the same failure behind a chain sealed by an untrusted domain', async () => {
    const forwarded = appendToBody(await vendorSigned(), '-- Sent through a forwarding rule');
    const sealed = await arcSeal(forwarded, signedAs(ATTACKER_DOMAIN, keys.attacker.privateKey, 'arc'));
    const assessment = await assess(sealed);
    expect(assessment.mailAuth).toMatchObject({ ok: true, arc: { result: 'pass', sealer: ATTACKER_DOMAIN } });
    expect(assessment.classification).toMatchObject({ row: 12, reason: 'changed_after_sending' });
  });

  it('row 12: a google.com chain that no longer validates does not help', async () => {
    const forwarded = appendToBody(await vendorSigned(), '-- Sent through a forwarding rule');
    const sealed = await arcSeal(forwarded, signedAs('google.com', keys.google.privateKey, 'arc'));
    const assessment = await assess(appendToBody(sealed, 'changed after the seal'));
    expect(assessment.mailAuth).toMatchObject({ ok: true, arc: { result: 'fail', sealer: 'google.com' } });
    expect(assessment.classification).toMatchObject({ row: 12, reason: 'changed_after_sending' });
  });

  it('row 12: body tampered (an action item owner changed)', async () => {
    const tampered = (await vendorSigned()).replace('(owner: Bish)', '(owner: Mallory)');
    const assessment = await assess(tampered);
    if (!assessment.mailAuth?.ok) throw new Error('expected a verified message');
    expect(assessment.mailAuth.signatures[0]?.result).toBe('fail');
    expect(assessment.classification).toMatchObject({ row: 12, outcome: 'refuse', reason: 'changed_after_sending', senderDomain: null });
  });

  it('row 12: header tampered (Subject changed)', async () => {
    const tampered = replaceHeader(await vendorSigned(), 'Subject: Recap: Urpayroll weekly sync', 'Subject: Recap: Payroll access');
    const result = await classifyMessage(tampered);
    expect(result).toMatchObject({ row: 12, reason: 'changed_after_sending' });
  });

  it('row 13: an unaligned d= (the email service signs, not the vendor), and its domain is not shown', async () => {
    const message = await signMessage(buildMessage(), signedAs(ESP_DOMAIN, keys.attacker.privateKey));
    const assessment = await assess(message);
    if (!assessment.mailAuth?.ok) throw new Error('expected a verified message');
    expect(assessment.mailAuth.signatures[0]).toMatchObject({ domain: ESP_DOMAIN, result: 'pass', aligned: false });
    expect(assessment.classification).toMatchObject({ row: 13, reason: 'sender_not_verified', senderDomain: null });
  });

  it('row 13: an l= signature with text appended after the signed length', async () => {
    const signed = await vendorSigned({}, { maxBodyLength: 40 });
    const appended = appendToBody(signed, '[ ] Wire the payroll balance today (owner: Dana)');
    const assessment = await assess(appended);
    if (!assessment.mailAuth?.ok) throw new Error('expected a verified message');
    expect(assessment.mailAuth.signatures[0]).toMatchObject({ result: 'pass', bodyLengthLimited: true });
    expect(assessment.classification).toMatchObject({ row: 13, reason: 'sender_not_verified' });
  });

  it('row 13: a t=y testing key', async () => {
    const assessment = await assess(await vendorSigned({}, { selector: 'ty' }));
    if (!assessment.mailAuth?.ok) throw new Error('expected a verified message');
    expect(assessment.mailAuth.signatures[0]).toMatchObject({ result: 'pass', testing: true });
    expect(assessment.classification.row).toBe(13);
  });

  it('row 13: an rsa-sha1 signature', async () => {
    const assessment = await assess(await vendorSigned({}, { algorithm: 'rsa-sha1' }));
    if (!assessment.mailAuth?.ok) throw new Error('expected a verified message');
    expect(assessment.mailAuth.signatures[0]).toMatchObject({ algo: 'rsa-sha1', result: 'policy' });
    expect(assessment.classification).toMatchObject({ row: 13, reason: 'sender_not_verified' });
  });

  it('row 13: a 512-bit key', async () => {
    const assessment = await assess(await vendorSigned({}, { selector: 'weak', privateKey: keys.weak.privateKey }));
    if (!assessment.mailAuth?.ok) throw new Error('expected a verified message');
    expect(assessment.mailAuth.signatures[0]?.result).toBe('policy');
    expect(assessment.classification).toMatchObject({ row: 13, reason: 'sender_not_verified' });
  });

  it('row 13: the vendor From without any signature', async () => {
    const result = await classifyMessage(buildMessage());
    expect(result).toMatchObject({ row: 13, reason: 'sender_not_verified', senderDomain: null });
  });

  it('row 13: a spoofed own address, unsigned, signed by another domain, or signed with a wrong key', async () => {
    const own = buildMessage({ from: USER_MAILBOX, to: PRIVATE_ADDRESS });
    expect((await classifyMessage(own)).row).toBe(13);
    expect((await classifyMessage(await signMessage(own, signedAs(ATTACKER_DOMAIN, keys.attacker.privateKey)))).row).toBe(13);
    const forgedKey = await signMessage(own, signedAs(USER_DOMAIN, keys.attacker.privateKey));
    const assessment = await assess(forgedKey);
    if (!assessment.mailAuth?.ok) throw new Error('expected a verified message');
    expect(assessment.mailAuth.signatures[0]).toMatchObject({ domain: USER_DOMAIN, result: 'fail' });
    expect(assessment.classification).toMatchObject({ row: 13, reason: 'sender_not_verified' });
  });

  it('row 14: a display-name spoof signed by the attacker shows only the authenticated domain', async () => {
    const message = await signMessage(
      buildMessage({ from: `"${VENDOR_ADDRESS}" <${ATTACKER_ADDRESS}>` }),
      signedAs(ATTACKER_DOMAIN, keys.attacker.privateKey),
    );
    const result = await classifyMessage(message);
    expect(result).toMatchObject({ row: 14, outcome: 'refuse', reason: 'not_from_your_notetaker', senderDomain: ATTACKER_DOMAIN });
  });

  it('row 14: an unsigned display-name spoof shows an unknown sender', async () => {
    const result = await classifyMessage(buildMessage({ from: `Notetaker Recaps <${ATTACKER_ADDRESS}>` }));
    expect(result).toMatchObject({ row: 14, reason: 'not_from_your_notetaker', senderDomain: null });
  });

  it("row 14: someone else's forward from an unlisted mailbox of the same company", async () => {
    const message = await signMessage(
      buildMessage({ from: COLLEAGUE_ADDRESS, to: PRIVATE_ADDRESS }),
      signedAs(USER_DOMAIN, keys.user.privateKey),
    );
    const result = await classifyMessage(message);
    expect(result).toMatchObject({ row: 14, reason: 'not_from_your_notetaker', senderDomain: USER_DOMAIN });
  });

  it('row 6: a Gmail forwarding confirmation with a google.com pass', async () => {
    const message = await signMessage(
      buildMessage({ from: `Gmail Team <${GMAIL_CONFIRMATION}>`, to: PRIVATE_ADDRESS, subject: '(#000000001) Gmail Forwarding Confirmation' }),
      signedAs('google.com', keys.google.privateKey),
    );
    const result = await classifyMessage(message);
    expect(result).toMatchObject({ row: 6, outcome: 'gmail', tier: 'gmail_confirmation', reason: 'gmail_confirmation', decidingDomain: 'google.com' });
  });

  it('row 14: a Gmail confirmation without a google.com pass', async () => {
    const spec = { from: `Gmail Team <${GMAIL_CONFIRMATION}>`, to: PRIVATE_ADDRESS, subject: '(#000000001) Gmail Forwarding Confirmation' };
    expect((await classifyMessage(buildMessage(spec))).row).toBe(14);
    const otherDomain = await signMessage(buildMessage(spec), signedAs(ATTACKER_DOMAIN, keys.attacker.privateKey));
    expect((await classifyMessage(otherDomain)).row).toBe(14);
    const wrongKey = await signMessage(buildMessage(spec), signedAs('google.com', keys.attacker.privateKey));
    expect((await classifyMessage(wrongKey)).row).toBe(14);
  });

  it('row 4: a From prepended above a validly signed recap', async () => {
    const attacked = `From: ${ATTACKER_ADDRESS}\r\n${await vendorSigned()}`;
    const assessment = await assess(attacked);
    expect(assessment.header).toMatchObject({ ok: false, detail: 'from_duplicate' });
    expect(assessment.mailAuth).toBeNull();
    expect(assessment.classification).toMatchObject({ row: 4, outcome: 'refuse', reason: 'malformed' });
    expect(dns.lookups).toEqual([]);
  });

  it('row 4: a To prepended above a recap signed To the private address', async () => {
    const attacked = `To: ${USER_MAILBOX}\r\n${await vendorSigned({ to: PRIVATE_ADDRESS })}`;
    const assessment = await assess(attacked);
    expect(assessment.header).toMatchObject({ ok: false, detail: 'duplicate_field', field: 'to' });
    expect(assessment.classification).toMatchObject({ row: 4, reason: 'malformed' });
  });

  it.each([
    ['a comment', `${VENDOR_ADDRESS} (Notetaker)`],
    ['a comment in the display name', `Notetaker (recaps) <${VENDOR_ADDRESS}>`],
    ['a group', `Recaps: ${VENDOR_ADDRESS};`],
    ['route syntax', `<@relay.example:${VENDOR_ADDRESS}>`],
    ['an encoded word as the address', `=?utf-8?q?recaps?=@${VENDOR_DOMAIN}`],
    ['an encoded word inside the angle-addr', `Notetaker <=?utf-8?q?recaps?=@${VENDOR_DOMAIN}>`],
    ['a second "@"', `recaps@${ATTACKER_DOMAIN}@${VENDOR_DOMAIN}`],
    ['two mailboxes', `${VENDOR_ADDRESS}, ${ATTACKER_ADDRESS}`],
    ['a quoted local part', `"recaps"@${VENDOR_DOMAIN}`],
    ['text after the angle-addr', `Notetaker <${VENDOR_ADDRESS}> ${ATTACKER_ADDRESS}`],
  ])('row 4: a From with %s is malformed even when signed by the vendor', async (_label, from) => {
    let message = buildMessage({ from });
    try {
      message = await vendorSigned({ from });
    } catch {
      // mailauth may refuse to sign an unusable From; the unsigned message is refused the same way
    }
    const assessment = await assess(message);
    expect(assessment.header).toMatchObject({ ok: false });
    expect(assessment.classification).toMatchObject({ row: 4, reason: 'malformed' });
    expect(dns.lookups).toEqual([]);
  });

  it('row 5: a deciding DNS temperror is retried while the Date is under 5 hours old', async () => {
    const result = await classifyMessage(await vendorSigned({}, { selector: 'slow' }));
    expect(result).toMatchObject({ row: 5, outcome: 'retry', reason: 'dns_temperror', senderDomain: null });
  });

  it('row 13: the same temperror once the Date is more than 5 hours old', async () => {
    const result = await classifyMessage(await vendorSigned({ date: SIX_HOURS_OLD_DATE }, { selector: 'slow' }));
    expect(result).toMatchObject({ row: 13, reason: 'sender_not_verified' });
  });

  it('row 5: a temperror on a listed mailbox domain is deciding too', async () => {
    dns.failWith(`s1._domainkey.${USER_DOMAIN}`, 'ESERVFAIL');
    const message = await signMessage(buildMessage({ from: USER_MAILBOX, to: PRIVATE_ADDRESS }), signedAs(USER_DOMAIN, keys.user.privateKey));
    expect((await classifyMessage(message)).row).toBe(5);
  });

  it('a temperror on a domain that cannot decide is ignored', async () => {
    dns.failWith(`s1._domainkey.${ESP_DOMAIN}`, 'ETIMEOUT');
    const doubleSigned = await signMessage(await vendorSigned(), signedAs(ESP_DOMAIN, keys.attacker.privateKey));
    const assessment = await assess(doubleSigned);
    if (!assessment.mailAuth?.ok) throw new Error('expected a verified message');
    expect(assessment.mailAuth.signatures.map((sig) => sig.result).sort()).toEqual(['pass', 'temperror']);
    expect(assessment.classification.row).toBe(7);
  });

  it('row 7: a recap dual-signed by the vendor, s1 passing and s2 a temperror, is not held back', async () => {
    dns.failWith(`s2._domainkey.${VENDOR_DOMAIN}`, 'ETIMEOUT');
    const dualSigned = await signMessage(await vendorSigned(), signedAs(VENDOR_DOMAIN, keys.vendor.privateKey, 's2'));
    const assessment = await assess(dualSigned);
    if (!assessment.mailAuth?.ok) throw new Error('expected a verified message');
    // s2 is a deciding temperror (d= is exactly the vendor domain) inside the retry window, yet s1
    // already makes V, B and Fresh: s2 passing could not change the result.
    expect(assessment.mailAuth.signatures.map((sig) => [sig.selector, sig.result])).toEqual([
      ['s2', 'temperror'],
      ['s1', 'pass'],
    ]);
    expect(assessment.classification).toMatchObject({ row: 7, outcome: 'accept', reason: 'vendor_verified', recipientBound: true, fresh: true });
  });

  it('row 5: a vendor pass sent to the private address with a temperror on a signature that could bind', async () => {
    dns.failWith(`s2._domainkey.${VENDOR_DOMAIN}`, 'ETIMEOUT');
    // s1 passes without signing To (row 9); s2 signs To naming the listed mailbox, so its pass would bind.
    const s1 = await vendorSigned({}, { headerList: 'from:subject:date:message-id' });
    const dualSigned = await signMessage(s1, signedAs(VENDOR_DOMAIN, keys.vendor.privateKey, 's2'));
    expect((await classifyMessage(dualSigned)).row).toBe(5);
    // With the To naming only the private address, s2 passing could not bind either: row 9 at once.
    const unbound = await signMessage(
      await vendorSigned({ to: PRIVATE_ADDRESS }, { headerList: 'from:subject:date:message-id' }),
      signedAs(VENDOR_DOMAIN, keys.vendor.privateKey, 's2'),
    );
    expect(await classifyMessage(unbound)).toMatchObject({ row: 9, outcome: 'inbox', reason: 'not_addressed_to_you' });
  });

  it("row 14: an unlisted colleague's forward with a company.example temperror is refused, never retried", async () => {
    dns.failWith(`s1._domainkey.${USER_DOMAIN}`, 'ETIMEOUT');
    const message = await signMessage(buildMessage({ from: COLLEAGUE_ADDRESS, to: PRIVATE_ADDRESS }), signedAs(USER_DOMAIN, keys.user.privateKey));
    const assessment = await assess(message);
    if (!assessment.mailAuth?.ok) throw new Error('expected a verified message');
    // A real temperror on the listed mailbox's own domain, but From is not a listed address.
    expect(assessment.mailAuth.signatures).toEqual([expect.objectContaining({ domain: USER_DOMAIN, result: 'temperror', aligned: true })]);
    expect(assessment.classification).toMatchObject({ row: 14, outcome: 'refuse', reason: 'not_from_your_notetaker', senderDomain: null });
  });

  it('a duplicate Subject, Date, Message-ID or Sender is malformed', async () => {
    for (const [field, line] of [
      ['subject', 'Subject: second subject'],
      ['date', `Date: ${FRESH_DATE}`],
      ['message-id', 'Message-ID: <second@notetaker.example>'],
      ['sender', 'Sender: a@notetaker.example\r\nSender: b@notetaker.example'],
      ['cc', 'Cc: a@company.example\r\nCc: b@company.example'],
    ] as const) {
      const result = await assess(buildMessage({ extraHeaders: [line] }));
      expect(result.header).toMatchObject({ ok: false, detail: 'duplicate_field', field });
      expect(result.classification.row).toBe(4);
    }
  });

  it('row 13: a deciding temperror with a Date after receipt is never retried', async () => {
    const tenMinutesAhead = 'Tue, 10 Nov 2026 16:10:00 +0000';
    const assessment = await assess(await vendorSigned({ date: tenMinutesAhead }, { selector: 'slow' }));
    if (!assessment.mailAuth?.ok) throw new Error('expected a verified message');
    expect(assessment.mailAuth.signatures[0]).toMatchObject({ result: 'temperror', temperror: true });
    expect(assessment.classification).toMatchObject({ row: 13, outcome: 'refuse', reason: 'sender_not_verified' });
  });
});

// ---------------------------------------------------------------------------------------------
// DNS budget (red-team finding: hanging zones stacked above the vendor's signature)
// ---------------------------------------------------------------------------------------------

describe('DNS budget exhaustion never decides row 5', () => {
  const FORGERIES = [
    ['a listed sender', VENDOR_ADDRESS, VENDOR_DOMAIN, 12, 'changed_after_sending'],
    ['a listed mailbox', USER_MAILBOX, USER_DOMAIN, 13, 'sender_not_verified'],
  ] as const;

  describe.each([3, 4])('%i slow attacker.example signatures above (fake clock, production budgets)', (hanging) => {
    it.each(FORGERIES)('a forgery from %s ends refused, not retried', async (_label, from, forgedDomain, row, reason) => {
      const clock = { now: RECEIVED_AT.getTime() };
      const message = await forgery(from, forgedDomain, hanging);
      const assessment = await assess(
        message,
        withProductionResolver({ lookupTxt: slowZoneLookup(ATTACKER_DOMAIN, 9_000, clock), clock: () => clock.now }),
      );
      if (!assessment.mailAuth?.ok) throw new Error('expected a verified message');
      const attackerResults = assessment.mailAuth.signatures.filter((sig) => sig.domain === ATTACKER_DOMAIN).map((sig) => sig.result);
      // The first slow lookup spends the shared budget; the rest are refused with EBUDGET.
      expect(attackerResults).toEqual(['temperror', ...Array<string>(hanging - 1).fill('neutral')]);
      // The forged domain is a decision domain: its own budget, so its key is fetched and the fake fails.
      expect(assessment.mailAuth.signatures.find((sig) => sig.domain === forgedDomain)).toMatchObject({ result: 'fail', temperror: false });
      expect(dns.lookups).toContain(`s1._domainkey.${forgedDomain}`);
      expect(assessment.classification).toMatchObject({ row, outcome: 'refuse', reason });
      expect(logger.warn).toHaveBeenCalledWith('summaries.dns_budget_spent', { signatures: hanging - 1 });
    });

    it('a genuine vendor recap below them is still accepted', async () => {
      const clock = { now: RECEIVED_AT.getTime() };
      const message = await signStacked(await vendorSigned(), attackerSpecs(hanging));
      const assessment = await assess(
        message,
        withProductionResolver({ lookupTxt: slowZoneLookup(ATTACKER_DOMAIN, 9_000, clock), clock: () => clock.now }),
      );
      expect(assessment.classification).toMatchObject({ row: 7, outcome: 'accept', decidingDomain: VENDOR_DOMAIN });
    });
  });

  it('even a starved decision-domain lookup is "no key", never a deciding temperror (the original attack)', async () => {
    const clock = { now: RECEIVED_AT.getTime() };
    // No decision domains: the vendor's lookup shares the budget the slow zone already spent.
    const resolver = createDnsResolver({ lookupTxt: slowZoneLookup(ATTACKER_DOMAIN, 9_000, clock), clock: () => clock.now, priorityDomains: [], alignedDomains: [] });
    const assessment = await assess(await forgery(VENDOR_ADDRESS, VENDOR_DOMAIN, 4), { resolver });
    if (!assessment.mailAuth?.ok) throw new Error('expected a verified message');
    expect(assessment.mailAuth.signatures.find((sig) => sig.domain === VENDOR_DOMAIN)).toMatchObject({ result: 'neutral', temperror: false });
    expect(dns.lookups).not.toContain(`s1._domainkey.${VENDOR_DOMAIN}`);
    expect(assessment.classification).toMatchObject({ row: 13, outcome: 'refuse', reason: 'sender_not_verified' });
  });

  describe('a zone that never answers (real timers, small budgets)', () => {
    it('the forgery ends refused within the hard bound', async () => {
      dns.hang(ATTACKER_DOMAIN);
      const message = await forgery(VENDOR_ADDRESS, VENDOR_DOMAIN, 4);
      const started = Date.now();
      const assessment = await assess(message, withProductionResolver({ lookupTxt: dns.lookupTxt, ...SMALL_DNS }));
      expect(assessment.classification).toMatchObject({ row: 12, outcome: 'refuse', reason: 'changed_after_sending' });
      expect(logger.warn).toHaveBeenCalledWith('summaries.dns_budget_spent', { signatures: expect.any(Number) });
      expect(Date.now() - started).toBeLessThan(SMALL_DNS.budgetMs + SMALL_DNS.alignedBudgetMs + SMALL_DNS.priorityBudgetMs + 2_000);
    });

    it('a genuine vendor recap below those signatures is accepted', async () => {
      dns.hang(ATTACKER_DOMAIN);
      const message = await signStacked(await vendorSigned(), attackerSpecs(4));
      const assessment = await assess(message, withProductionResolver({ lookupTxt: dns.lookupTxt, ...SMALL_DNS }));
      expect(assessment.classification).toMatchObject({ row: 7, outcome: 'accept', decidingDomain: VENDOR_DOMAIN });
    });

    it("the vendor's own zone hanging is a real temperror: cut at the lookup cap and retried", async () => {
      dns.hang(VENDOR_DOMAIN);
      const assessment = await assess(await vendorSigned(), withProductionResolver({ lookupTxt: dns.lookupTxt, ...SMALL_DNS }));
      if (!assessment.mailAuth?.ok) throw new Error('expected a verified message');
      expect(assessment.mailAuth.signatures[0]).toMatchObject({ domain: VENDOR_DOMAIN, result: 'temperror', temperror: true });
      expect(assessment.classification).toMatchObject({ row: 5, outcome: 'retry', reason: 'dns_temperror' });
    });
  });

  it('normalizeSignature: EBUDGET is "no key" (neutral), any other DNS failure stays temperror', () => {
    const base = { signingDomain: VENDOR_DOMAIN, selector: 's1', algo: 'rsa-sha256', info: '' };
    const budget = { ...base, status: { result: 'temperror', comment: `DNS failure: ${DNS_BUDGET_CODE}` } } as DKIMResult;
    const timeout = { ...base, status: { result: 'temperror', comment: 'DNS failure: ETIMEOUT' } } as DKIMResult;
    expect(DNS_BUDGET_CODE).toBe('EBUDGET');
    expect(isBudgetRefusal(budget)).toBe(true);
    expect(isBudgetRefusal(timeout)).toBe(false);
    const neutral = normalizeSignature(budget, VENDOR_DOMAIN);
    expect(neutral).toMatchObject({ result: 'neutral', temperror: false });
    expect(normalizeSignature(timeout, VENDOR_DOMAIN)).toMatchObject({ result: 'temperror', temperror: true });
    if (!neutral) throw new Error('expected a signature');
    expect(classify(makeInput({ signatures: [neutral] }))).toMatchObject({ row: 13, outcome: 'refuse' });
  });

  it('decidingDomains: sender and mailbox domains that align with the From domain, nothing else', () => {
    const senders = [VENDOR_ADDRESS, 'Recaps@Mail.NoteTaker.Example', VENDOR_DOMAIN, ATTACKER_ADDRESS];
    expect(decidingDomains(VENDOR_ADDRESS, senders, [USER_MAILBOX, COLLEAGUE_ADDRESS])).toEqual([VENDOR_DOMAIN, 'mail.notetaker.example']);
    expect(decidingDomains(USER_MAILBOX, senders, [USER_MAILBOX, COLLEAGUE_ADDRESS])).toEqual([USER_DOMAIN]);
    expect(decidingDomains(COLLEAGUE_ADDRESS, senders, [USER_MAILBOX, COLLEAGUE_ADDRESS])).toEqual([USER_DOMAIN]);
    const subSender = `recaps@mail.${VENDOR_DOMAIN}`;
    expect(decidingDomains(subSender, [VENDOR_ADDRESS, subSender], [])).toEqual([VENDOR_DOMAIN, `mail.${VENDOR_DOMAIN}`]);
    expect(decidingDomains(' Recaps@NoteTaker.Example ', [VENDOR_ADDRESS], [])).toEqual([VENDOR_DOMAIN]);
    expect(decidingDomains(ATTACKER_ADDRESS, [VENDOR_ADDRESS], [USER_MAILBOX])).toEqual([]);
    expect(decidingDomains(GMAIL_CONFIRMATION, [VENDOR_ADDRESS], [USER_MAILBOX])).toEqual([]);
    expect(decidingDomains('not an address', [VENDOR_ADDRESS], [USER_MAILBOX])).toEqual([]);
    expect(decidingDomains(VENDOR_DOMAIN, [VENDOR_ADDRESS], [USER_MAILBOX])).toEqual([]);
  });

  it('decidingDomains: none unless From is EXACTLY a listed sender or mailbox', () => {
    // An unlisted colleague of a listed mailbox, and an unlisted address of the vendor.
    expect(decidingDomains(COLLEAGUE_ADDRESS, SENDERS, MAILBOXES)).toEqual([]);
    expect(decidingDomains(`noreply@${VENDOR_DOMAIN}`, SENDERS, MAILBOXES)).toEqual([]);
    expect(decidingDomains(`recaps@mail.${VENDOR_DOMAIN}`, SENDERS, MAILBOXES)).toEqual([]);
  });

  describe('dnsRouting: priority only for the lookups that can decide THIS message', () => {
    const facts = async (message: string): Promise<HeaderFacts> => {
      const header = checkHeaders(toRaw(message));
      if (!header.ok) throw new Error('expected header facts');
      return header;
    };

    it('a vendor recap: the vendor domain has priority, its relatives the aligned budget; the mailbox domain and google.com share', async () => {
      const routing = dnsRouting(await facts(await vendorSigned()), SENDERS, MAILBOXES);
      expect(routing).toEqual({ priorityDomains: [VENDOR_DOMAIN], alignedDomains: [VENDOR_DOMAIN], priorityKeyNames: [] });
    });

    it('a user forward: the mailbox domain only', async () => {
      const routing = dnsRouting(await facts(buildMessage({ from: USER_MAILBOX, to: PRIVATE_ADDRESS })), SENDERS, MAILBOXES);
      expect(routing).toEqual({ priorityDomains: [USER_DOMAIN], alignedDomains: [USER_DOMAIN], priorityKeyNames: [] });
    });

    it('google.com only when From is exactly the Gmail confirmation sender', async () => {
      const gmail = await facts(buildMessage({ from: `Gmail Team <${GMAIL_CONFIRMATION}>`, to: PRIVATE_ADDRESS }));
      expect(dnsRouting(gmail, SENDERS, MAILBOXES)).toEqual({ priorityDomains: ['google.com'], alignedDomains: ['google.com'], priorityKeyNames: [] });
      const otherGoogle = await facts(buildMessage({ from: 'someone@google.com', to: PRIVATE_ADDRESS }));
      expect(dnsRouting(otherGoogle, SENDERS, MAILBOXES)).toEqual({ priorityDomains: [], alignedDomains: [], priorityKeyNames: [] });
    });

    it('a stranger: nothing at all', async () => {
      const routing = dnsRouting(await facts(buildMessage({ from: ATTACKER_ADDRESS })), SENDERS, MAILBOXES);
      expect(routing).toEqual({ priorityDomains: [], alignedDomains: [], priorityKeyNames: [] });
    });

    it("an unlisted colleague of a listed mailbox: nothing at all, the mailbox's own domain included", async () => {
      const routing = dnsRouting(await facts(buildMessage({ from: COLLEAGUE_ADDRESS, to: PRIVATE_ADDRESS })), SENDERS, MAILBOXES);
      expect(routing).toEqual({ priorityDomains: [], alignedDomains: [], priorityKeyNames: [] });
      const vendorOther = await facts(buildMessage({ from: `noreply@${VENDOR_DOMAIN}`, to: PRIVATE_ADDRESS }));
      expect(dnsRouting(vendorOther, SENDERS, MAILBOXES)).toEqual({ priorityDomains: [], alignedDomains: [], priorityKeyNames: [] });
    });

    it('ARC keys: only those of the trusted sealers, by exact key record name', async () => {
      const forwarded = appendToBody(await vendorSigned(), '-- Sent through a forwarding rule');
      const google = await facts(await arcSeal(forwarded, signedAs('google.com', keys.google.privateKey, 'arc')));
      expect(google.arcKeyNames).toEqual(['arc._domainkey.google.com']);
      expect(dnsRouting(google, SENDERS, MAILBOXES)).toEqual({
        priorityDomains: [VENDOR_DOMAIN],
        alignedDomains: [VENDOR_DOMAIN],
        priorityKeyNames: ['arc._domainkey.google.com'],
      });
      const attacker = await facts(await arcSeal(forwarded, signedAs(ATTACKER_DOMAIN, keys.attacker.privateKey, 'arc')));
      expect(attacker.arcKeyNames).toEqual([`arc._domainkey.${ATTACKER_DOMAIN}`]);
      expect(dnsRouting(attacker, SENDERS, MAILBOXES).priorityKeyNames).toEqual([]);
    });

    it('arcKeyNames reads d= and s= as mailauth does and skips names it cannot write as ASCII', async () => {
      const header = await facts(
        buildMessage({
          extraHeaders: [
            'ARC-Seal: i=1; a=rsa-sha256; cv=none; D=Google.COM.; S=Arc-2026;\r\n\td=google.com; s=Arc-2026; b=x',
            'ARC-Message-Signature: i=1; a=rsa-sha256; d=google.com; s=arc-2026; b=y',
            `ARC-Seal: i=2; a=rsa-sha256; cv=pass; d=${MAPPED_VENDOR_DOMAIN}; s=arc; b=z`,
            'ARC-Seal: i=3; a=rsa-sha256; cv=pass; d=google.com; s=bad selector; b=z',
            'ARC-Seal: i=4; a=rsa-sha256; cv=pass; s=arc; b=z',
          ],
        }),
      );
      expect(header.arcKeyNames).toEqual(['arc-2026._domainkey.google.com']);
    });
  });
});

// ---------------------------------------------------------------------------------------------
// Priority routing and deciding temperror (exact domains only)
// ---------------------------------------------------------------------------------------------

describe('priority DNS and deciding temperror need an EXACT decision domain', () => {
  it('a forgery From the vendor signed by a hanging subdomain zone ends refused, not retried', async () => {
    const lame = `lame.${VENDOR_DOMAIN}`;
    dns.hang(lame);
    const message = await signMessage(buildMessage({ to: PRIVATE_ADDRESS }), signedAs(lame, keys.attacker.privateKey));
    const assessment = await assess(message, withProductionResolver({ lookupTxt: dns.lookupTxt, ...RATIO_DNS }));
    if (!assessment.mailAuth?.ok) throw new Error('expected a verified message');
    // A real temperror (cut at the cap in the aligned budget), aligned with From, yet not deciding.
    expect(assessment.mailAuth.signatures).toEqual([expect.objectContaining({ domain: lame, result: 'temperror', aligned: true })]);
    expect(assessment.classification).toMatchObject({ row: 13, outcome: 'refuse', reason: 'sender_not_verified' });
  });

  it('a forgery stacking hanging aligned subdomains and attacker zones above a fake vendor signature spends only the aligned and shared budgets', async () => {
    const lame = `lame.${VENDOR_DOMAIN}`;
    dns.hang(lame);
    dns.hang(ATTACKER_DOMAIN);
    const forged = await signMessage(buildMessage({ to: PRIVATE_ADDRESS }), signedAs(VENDOR_DOMAIN, keys.attacker.privateKey));
    // Five signatures in all, the DKIM-Signature cap.
    const lameSpecs = ['h1', 'h2'].map((selector) => signedAs(lame, keys.attacker.privateKey, selector));
    const message = await signStacked(forged, [...lameSpecs, ...attackerSpecs(2)]);
    const assessment = await assess(message, withProductionResolver({ lookupTxt: dns.lookupTxt, ...RATIO_DNS }));
    if (!assessment.mailAuth?.ok) throw new Error('expected a verified message');
    const signatures = assessment.mailAuth.signatures;
    const resultsOf = (domain: string) => signatures.filter((sig) => sig.domain === domain).map((sig) => sig.result);
    // One full cap each, then EBUDGET (neutral): neither pool reaches the priority budget.
    expect(resultsOf(ATTACKER_DOMAIN)).toEqual(['temperror', 'neutral']);
    expect(resultsOf(lame)).toEqual(['temperror', 'neutral']);
    // The vendor's key still comes from the priority budget, so the fake fails.
    expect(resultsOf(VENDOR_DOMAIN)).toEqual(['fail']);
    expect(dns.lookups).toContain(`s1._domainkey.${VENDOR_DOMAIN}`);
    expect(assessment.classification).toMatchObject({ row: 12, outcome: 'refuse', reason: 'changed_after_sending' });
    expect(logger.warn).toHaveBeenCalledWith('summaries.dns_budget_spent', { signatures: 2 });
  });

  it('a genuine recap signed by the aligned mg. subdomain behind a hanging company.example hop is accepted (row 7)', async () => {
    const clock = { now: RECEIVED_AT.getTime() };
    const recap = await signMessage(await vendorSigned({}, { domain: VENDOR_ESP_DOMAIN }), signedAs(USER_DOMAIN, keys.user.privateKey));
    // The hop's zone hangs and the fake clock runs 100 ms late per lookup, past the 40 ms cap.
    const lookupTxt = lateHangingLookup([USER_DOMAIN], 100, clock);
    const assessment = await assess(recap, withProductionResolver({ lookupTxt, clock: () => clock.now, ...RATIO_DNS }));
    if (!assessment.mailAuth?.ok) throw new Error('expected a verified message');
    // The hop spends the whole shared budget (exactly one cap); the vendor's aligned subdomain
    // draws on the aligned budget, so its key is still fetched and the signature passes.
    expect(assessment.mailAuth.signatures.map((sig) => [sig.domain, sig.result])).toEqual([
      [USER_DOMAIN, 'temperror'],
      [VENDOR_ESP_DOMAIN, 'pass'],
    ]);
    expect(dns.lookups).toEqual([`s1._domainkey.${USER_DOMAIN}`, `s1._domainkey.${VENDOR_ESP_DOMAIN}`]);
    expect(assessment.classification).toMatchObject({ row: 7, outcome: 'accept', decidingDomain: VENDOR_ESP_DOMAIN, senderDomain: VENDOR_ESP_DOMAIN });
  });

  it('the same genuine mg. recap with production budgets (fake clock) is accepted too', async () => {
    const clock = { now: RECEIVED_AT.getTime() };
    const recap = await signMessage(await vendorSigned({}, { domain: VENDOR_ESP_DOMAIN }), signedAs(USER_DOMAIN, keys.user.privateKey));
    const assessment = await assess(
      recap,
      withProductionResolver({ lookupTxt: slowZoneLookup(USER_DOMAIN, 9_000, clock), clock: () => clock.now }),
    );
    expect(assessment.classification).toMatchObject({ row: 7, outcome: 'accept', decidingDomain: VENDOR_ESP_DOMAIN });
  });

  it("an unlisted colleague's company.example key gets no priority: behind a spent shared budget it is never fetched", async () => {
    dns.hang(ATTACKER_DOMAIN);
    const forward = await signMessage(buildMessage({ from: COLLEAGUE_ADDRESS, to: PRIVATE_ADDRESS }), signedAs(USER_DOMAIN, keys.user.privateKey));
    const message = await signStacked(forward, attackerSpecs(1));
    const assessment = await assess(message, withProductionResolver({ lookupTxt: dns.lookupTxt, ...RATIO_DNS }));
    if (!assessment.mailAuth?.ok) throw new Error('expected a verified message');
    expect(assessment.mailAuth.signatures.map((sig) => [sig.domain, sig.result])).toEqual([
      [ATTACKER_DOMAIN, 'temperror'],
      [USER_DOMAIN, 'neutral'],
    ]);
    expect(dns.lookups).not.toContain(`s1._domainkey.${USER_DOMAIN}`);
    expect(assessment.classification).toMatchObject({ row: 14, outcome: 'refuse', reason: 'not_from_your_notetaker', senderDomain: null });
  });

  it("an unlisted colleague's hanging company.example zone is a temperror in the shared budget, refused (row 14)", async () => {
    dns.hang(USER_DOMAIN);
    const message = await signMessage(buildMessage({ from: COLLEAGUE_ADDRESS, to: PRIVATE_ADDRESS }), signedAs(USER_DOMAIN, keys.user.privateKey));
    const assessment = await assess(message, withProductionResolver({ lookupTxt: dns.lookupTxt, ...RATIO_DNS }));
    if (!assessment.mailAuth?.ok) throw new Error('expected a verified message');
    expect(assessment.mailAuth.signatures).toEqual([expect.objectContaining({ domain: USER_DOMAIN, result: 'temperror' })]);
    expect(assessment.classification).toMatchObject({ row: 14, outcome: 'refuse', reason: 'not_from_your_notetaker' });
  });

  it('a forgery From a listed mailbox signed by a hanging subdomain zone ends refused, not retried', async () => {
    const corp = `corp.${USER_DOMAIN}`;
    dns.hang(corp);
    const message = await signMessage(buildMessage({ from: USER_MAILBOX, to: PRIVATE_ADDRESS }), signedAs(corp, keys.attacker.privateKey));
    const assessment = await assess(message, withProductionResolver({ lookupTxt: dns.lookupTxt, ...RATIO_DNS }));
    if (!assessment.mailAuth?.ok) throw new Error('expected a verified message');
    expect(assessment.mailAuth.signatures).toEqual([expect.objectContaining({ domain: corp, result: 'temperror', aligned: true })]);
    expect(assessment.classification).toMatchObject({ row: 13, outcome: 'refuse', reason: 'sender_not_verified' });
  });

  it('a genuine vendor recap with a hanging company.example hop above a hanging vendor zone is retried (row 5)', async () => {
    const clock = { now: RECEIVED_AT.getTime() };
    const recap = await signMessage(await vendorSigned(), signedAs(USER_DOMAIN, keys.user.privateKey));
    // Both zones hang; the fake clock also runs 100 ms late per lookup, well past the 40 ms cap.
    const lookupTxt = lateHangingLookup([USER_DOMAIN, VENDOR_DOMAIN], 100, clock);
    const assessment = await assess(recap, withProductionResolver({ lookupTxt, clock: () => clock.now, ...RATIO_DNS }));
    if (!assessment.mailAuth?.ok) throw new Error('expected a verified message');
    // The hop (company.example does not align with the vendor From) spends the shared budget at
    // exactly one cap; the vendor's lookup still gets a full cap from the priority budget.
    expect(assessment.mailAuth.signatures.map((sig) => [sig.domain, sig.result])).toEqual([
      [USER_DOMAIN, 'temperror'],
      [VENDOR_DOMAIN, 'temperror'],
    ]);
    expect(dns.lookups).toEqual([`s1._domainkey.${USER_DOMAIN}`, `s1._domainkey.${VENDOR_DOMAIN}`]);
    expect(assessment.classification).toMatchObject({ row: 5, outcome: 'retry', reason: 'dns_temperror' });
  });

  it("a trusted sealer's ARC keys keep the priority budget behind spent shared lookups (row 11)", async () => {
    dns.hang(ATTACKER_DOMAIN);
    const forwarded = appendToBody(await vendorSigned(), '-- Sent through a forwarding rule');
    const sealed = await arcSeal(await signStacked(forwarded, attackerSpecs(4)), signedAs('google.com', keys.google.privateKey, 'arc'));
    const assessment = await assess(sealed, withProductionResolver({ lookupTxt: dns.lookupTxt, ...RATIO_DNS }));
    if (!assessment.mailAuth?.ok) throw new Error('expected a verified message');
    expect(assessment.mailAuth.signatures.filter((sig) => sig.domain === ATTACKER_DOMAIN).map((sig) => sig.result)).toEqual([
      'temperror',
      'neutral',
      'neutral',
      'neutral',
    ]);
    expect(assessment.mailAuth.arc).toEqual({ result: 'pass', sealer: 'google.com' });
    expect(assessment.classification).toMatchObject({ row: 11, reason: 'could_not_verify_after_forwarding' });
  });

  it('classify: a temperror decides only for a d= exactly equal to an aligned sender or mailbox domain', () => {
    const temp = (domain: string) => [makeSig({ domain, result: 'temperror', temperror: true, bits: null })];
    expect(classify(makeInput({ signatures: temp(VENDOR_DOMAIN) })).row).toBe(5);
    expect(classify(makeInput({ signatures: temp('NoteTaker.Example') })).row).toBe(5);
    expect(classify(makeInput({ signatures: temp(`lame.${VENDOR_DOMAIN}`) })).row).toBe(13);
    const viaMailbox = { from: USER_MAILBOX, to: [PRIVATE_ADDRESS] };
    expect(classify(makeInput({ ...viaMailbox, signatures: temp(USER_DOMAIN) })).row).toBe(5);
    expect(classify(makeInput({ ...viaMailbox, signatures: temp(`corp.${USER_DOMAIN}`) })).row).toBe(13);
    // A listed subdomain sender decides as itself, never through its parent.
    const subSender = `recaps@mail.${VENDOR_DOMAIN}`;
    expect(classify(makeInput({ from: subSender, senders: [subSender], signatures: temp(`mail.${VENDOR_DOMAIN}`) })).row).toBe(5);
    expect(classify(makeInput({ from: subSender, senders: [subSender], signatures: temp(VENDOR_DOMAIN) })).row).toBe(13);
    // An exact sender domain that does not align with From never decides either.
    expect(classify(makeInput({ from: ATTACKER_ADDRESS, signatures: temp(VENDOR_DOMAIN) })).row).toBe(14);
  });

  it('classify: a temperror decides only when From is EXACTLY a listed sender or mailbox', () => {
    const temp = (domain: string) => [makeSig({ domain, result: 'temperror', temperror: true, bits: null })];
    // An unlisted colleague of the listed mailbox: the mailbox's own domain decides nothing.
    const colleague = { from: COLLEAGUE_ADDRESS, to: [PRIVATE_ADDRESS] };
    expect(classify(makeInput({ ...colleague, signatures: temp(USER_DOMAIN) }))).toMatchObject({ row: 14, outcome: 'refuse', reason: 'not_from_your_notetaker' });
    // An unlisted address of the vendor domain: refused as before, never retried.
    expect(classify(makeInput({ from: `noreply@${VENDOR_DOMAIN}`, signatures: temp(VENDOR_DOMAIN) })).row).toBe(14);
    // The same signatures from the listed addresses do retry.
    expect(classify(makeInput({ from: USER_MAILBOX, to: [PRIVATE_ADDRESS], signatures: temp(USER_DOMAIN) })).row).toBe(5);
    expect(classify(makeInput({ signatures: temp(VENDOR_DOMAIN) })).row).toBe(5);
  });

  it('classify: row 5 only when the temperror signature passing could change the result', () => {
    const temp = (overrides: Partial<NormalizedSignature> = {}) =>
      makeSig({ selector: 's2', result: 'temperror', temperror: true, bits: null, ...overrides });
    // Row 7 already: V, B and Fresh. Another selector of the same domain cannot improve it.
    expect(classify(makeInput({ signatures: [makeSig(), temp()] }))).toMatchObject({ row: 7, outcome: 'accept' });
    expect(classify(makeInput({ signatures: [temp(), makeSig()] }))).toMatchObject({ row: 7, outcome: 'accept' });
    // Row 9 (To unsigned): a temperror signature that signs To could bind, so it retries.
    const unsignedTo = makeSig({ signsTo: false });
    expect(classify(makeInput({ signatures: [unsignedTo, temp()] })).row).toBe(5);
    // ... but not when it cannot bind either (To unsigned there too, or To names no mailbox).
    expect(classify(makeInput({ signatures: [unsignedTo, temp({ signsTo: false })] })).row).toBe(9);
    expect(classify(makeInput({ to: [PRIVATE_ADDRESS], signatures: [makeSig(), temp()] })).row).toBe(9);
    // Row 8 (Date unsigned): a temperror signature that signs Date could make it Fresh, one that
    // does not sign Date could not.
    const unsignedDate = makeSig({ signsDate: false });
    expect(classify(makeInput({ signatures: [unsignedDate, temp()] })).row).toBe(5);
    expect(classify(makeInput({ signatures: [unsignedDate, temp({ signsDate: false })] })).row).toBe(8);
    // A temperror signature that could never be a passSig never retries: From unsigned, an l=.
    expect(classify(makeInput({ signatures: [temp({ signsFrom: false })] })).row).toBe(13);
    expect(classify(makeInput({ signatures: [temp({ bodyLengthLimited: true })] })).row).toBe(13);
    // Row 10: a user forward that already passes, with a second temperror signature that could not change B or Fresh.
    const forward = { from: USER_MAILBOX, to: [PRIVATE_ADDRESS] };
    const userSig = makeSig({ domain: USER_DOMAIN });
    expect(classify(makeInput({ ...forward, signatures: [userSig, temp({ domain: USER_DOMAIN })] })).row).toBe(10);
    // Row 12 (a vendor signature fails): a second vendor signature passing would make V, so it retries.
    expect(classify(makeInput({ signatures: [makeSig({ result: 'fail' }), temp()] })).row).toBe(5);
  });
});

// ---------------------------------------------------------------------------------------------
// Signing domains are never mapped (alignment domain = fetched key domain)
// ---------------------------------------------------------------------------------------------

describe('a d= that is not plain ASCII LDH yields no domain', () => {
  /** The attacker's key published at the Punycode name mailauth fetches for the mapped d=. */
  const publishMappedKey = (): void => dns.publish(`s1._domainkey.${MAPPED_VENDOR_ALABEL}`, dkimRecord(keys.attacker));
  const mappedForgery = (): string =>
    rawDkimSign(buildMessage(), { domain: MAPPED_VENDOR_DOMAIN, selector: 's1', privateKey: keys.attacker.privateKey });

  it('premise: mailauth passes the mapped d= with the key at the Punycode name, and UTS46 maps it to the vendor', async () => {
    publishMappedKey();
    const verified = await dkimVerify(toRaw(mappedForgery()), { resolver: dns.resolver, curTime: RECEIVED_AT });
    expect(verified.results[0]).toMatchObject({ signingDomain: MAPPED_VENDOR_DOMAIN, status: { result: 'pass' } });
    expect(dns.lookups).toEqual([`s1._domainkey.${MAPPED_VENDOR_ALABEL}`]);
    expect(domainToASCII(MAPPED_VENDOR_DOMAIN)).toBe(VENDOR_DOMAIN);
  });

  it('the mapped d= with the key at the Punycode name ends row 13, never row 7', async () => {
    publishMappedKey();
    const assessment = await assess(mappedForgery());
    if (!assessment.mailAuth?.ok) throw new Error('expected a verified message');
    expect(assessment.mailAuth.signatures).toEqual([]);
    expect(assessment.classification).toMatchObject({ row: 13, outcome: 'refuse', reason: 'sender_not_verified', senderDomain: null });
  });

  it('the mapped d= with that zone hanging is never a deciding temperror (no row 5)', async () => {
    dns.hang(MAPPED_VENDOR_ALABEL);
    const assessment = await assess(mappedForgery(), withProductionResolver({ lookupTxt: dns.lookupTxt, ...RATIO_DNS }));
    if (!assessment.mailAuth?.ok) throw new Error('expected a verified message');
    expect(dns.lookups).toEqual([`s1._domainkey.${MAPPED_VENDOR_ALABEL}`]);
    expect(assessment.mailAuth.signatures).toEqual([]);
    expect(assessment.classification).toMatchObject({ row: 13, outcome: 'refuse', reason: 'sender_not_verified' });
  });

  it('an xn-- ASCII d= that is not the vendor domain stays unaligned', async () => {
    publishMappedKey();
    const message = await signMessage(buildMessage(), signedAs(MAPPED_VENDOR_ALABEL, keys.attacker.privateKey));
    const assessment = await assess(message);
    if (!assessment.mailAuth?.ok) throw new Error('expected a verified message');
    expect(assessment.mailAuth.signatures).toEqual([expect.objectContaining({ domain: MAPPED_VENDOR_ALABEL, result: 'pass', aligned: false })]);
    expect(assessment.classification).toMatchObject({ row: 13, reason: 'sender_not_verified', senderDomain: null });
  });

  it('normalizeSigningDomain: plain ASCII LDH lowercased, anything else null, nothing mapped', () => {
    const kelvin = String.fromCharCode(0x212a);
    const fullwidthStop = String.fromCharCode(0xff0e);
    expect(normalizeSigningDomain('NoteTaker.Example')).toBe(VENDOR_DOMAIN);
    expect(normalizeSigningDomain(`${VENDOR_DOMAIN}.`)).toBe(VENDOR_DOMAIN);
    expect(normalizeSigningDomain(MAPPED_VENDOR_ALABEL)).toBe(MAPPED_VENDOR_ALABEL);
    expect(normalizeSigningDomain(`a-1.b2.${VENDOR_DOMAIN}`)).toBe(`a-1.b2.${VENDOR_DOMAIN}`);
    for (const value of [
      MAPPED_VENDOR_DOMAIN,
      `nota${kelvin}er.example`, // lowercases to an ASCII "k"
      `notetaker${fullwidthStop}example`, // UTS46 maps it to "."
      `b${String.fromCharCode(0xfc)}cher.example`,
      'note_taker.example',
      '-notetaker.example',
      'notetaker-.example',
      'notetaker..example',
      ` ${VENDOR_DOMAIN}`,
      'example',
      `${'a'.repeat(63)}.${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(62)}.example`,
      `${'a'.repeat(64)}.example`,
      '',
      null,
      42,
    ]) {
      expect(normalizeSigningDomain(value)).toBeNull();
    }
    expect(normalizeDomain(`nota${kelvin}er.example`)).toBeNull();
  });

  it('a normalized signature never carries a mapped domain', () => {
    const base = { selector: 's1', algo: 'rsa-sha256', info: '', status: { result: 'pass' } };
    expect(normalizeSignature({ ...base, signingDomain: MAPPED_VENDOR_DOMAIN } as DKIMResult, VENDOR_DOMAIN)).toBeNull();
    expect(normalizeSignature({ ...base, signingDomain: 'NOTETAKER.EXAMPLE' } as DKIMResult, VENDOR_DOMAIN)).toMatchObject({ domain: VENDOR_DOMAIN, aligned: true });
  });
});

// ---------------------------------------------------------------------------------------------
// DKIM-Signature cap
// ---------------------------------------------------------------------------------------------

describe('DKIM-Signature cap (checked before any DNS work)', () => {
  const fourMoreSigners = (): SignSpec[] => [
    signedAs(ESP_DOMAIN, keys.attacker.privateKey),
    signedAs(USER_DOMAIN, keys.user.privateKey),
    signedAs('google.com', keys.google.privateKey),
    signedAs(ATTACKER_DOMAIN, keys.attacker.privateKey),
  ];

  it('is five: the vendor and its email service plus forwarding hops', () => {
    expect(HEADER_LIMITS.maxDkimSignatures).toBe(5);
  });

  it('a recap with five signatures and an ARC set verifies; ARC fields do not count', async () => {
    const five = await signStacked(await vendorSigned(), fourMoreSigners());
    const sealed = await arcSeal(five, signedAs('google.com', keys.google.privateKey, 'arc'));
    const assessment = await assess(sealed);
    expect(assessment.header).toMatchObject({ ok: true });
    expect(assessment.mailAuth).toMatchObject({ ok: true, arc: { result: 'pass', sealer: 'google.com' } });
    expect(assessment.classification).toMatchObject({ row: 7, outcome: 'accept' });
  });

  it('a sixth signature is malformed (row 4) and costs no DNS lookup', async () => {
    const six = await signStacked(await vendorSigned(), [...fourMoreSigners(), signedAs(ATTACKER_DOMAIN, keys.attacker.privateKey, 'h9')]);
    const assessment = await assess(six);
    expect(assessment.header).toMatchObject({ ok: false, detail: 'too_many_signatures' });
    expect(assessment.mailAuth).toBeNull();
    expect(assessment.classification).toMatchObject({ row: 4, outcome: 'refuse', reason: 'malformed' });
    expect(dns.lookups).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// runMailAuth
// ---------------------------------------------------------------------------------------------

describe('runMailAuth', () => {
  it('normalizes a vendor signature and computes alignment itself', async () => {
    const result = await runMailAuth(toRaw(await vendorSigned({ cc: COLLEAGUE_ADDRESS })), { ...DECISION, resolver: dns.resolver, now: RECEIVED_AT });
    if (!result.ok) throw new Error('expected ok');
    expect(result.arc).toEqual(NO_ARC);
    expect(result.signatures).toHaveLength(1);
    const [sig] = result.signatures;
    expect(sig).toMatchObject({
      domain: VENDOR_DOMAIN,
      selector: 's1',
      result: 'pass',
      aligned: true,
      signsFrom: true,
      signsTo: true,
      signsCc: true,
      signsDate: true,
      bodyLengthLimited: false,
      algo: 'rsa-sha256',
      bits: 2048,
      testing: false,
      temperror: false,
    });
    expect(typeof sig?.signatureValue).toBe('string');
  });

  it('reports no signature for unsigned mail', async () => {
    const result = await runMailAuth(toRaw(buildMessage()), { ...DECISION, resolver: dns.resolver, now: RECEIVED_AT });
    expect(result).toEqual({ ok: true, signatures: [], arc: NO_ARC });
  });

  it('refuses when the verifier read different header rows than the strict parse', async () => {
    const other = checkHeaders(toRaw(buildMessage({ extraHeaders: ['X-Extra: 1'] })));
    if (!other.ok) throw new Error('expected ok');
    const result = await runMailAuth(toRaw(await vendorSigned()), { ...DECISION, resolver: dns.resolver, now: RECEIVED_AT, header: other });
    expect(result).toEqual({ ok: false, reason: 'malformed', detail: 'parser_mismatch' });
  });

  it('refuses when the verifier read a different From', async () => {
    const message = await vendorSigned();
    const facts = checkHeaders(toRaw(message)) as HeaderFacts;
    const result = await runMailAuth(toRaw(message), { ...DECISION, resolver: dns.resolver, now: RECEIVED_AT, header: { ...facts, from: ATTACKER_ADDRESS } });
    expect(result).toMatchObject({ ok: false, detail: 'parser_mismatch' });
  });

  it('without a resolver, routes its own lookups from the strict From, senders and mailboxes', async () => {
    const clock = { now: RECEIVED_AT.getTime() };
    const raw = toRaw(await forgery(VENDOR_ADDRESS, VENDOR_DOMAIN, 4));
    const result = await runMailAuth(raw, {
      ...DECISION,
      now: RECEIVED_AT,
      dns: { lookupTxt: slowZoneLookup(ATTACKER_DOMAIN, 9_000, clock), clock: () => clock.now },
    });
    if (!result.ok) throw new Error('expected ok');
    // The shared budget is spent by the first slow lookup, yet the vendor's key is still fetched
    // from the priority budget, so the forged signature fails instead of going unchecked.
    expect(result.signatures.find((sig) => sig.domain === VENDOR_DOMAIN)).toMatchObject({ result: 'fail', temperror: false });
    expect(dns.lookups).toContain(`s1._domainkey.${VENDOR_DOMAIN}`);
  });

  it('requires the decision inputs: a call without senders and mailboxes does not compile', () => {
    const call = (raw: Buffer) =>
      // @ts-expect-error senders and mailboxes are required, so no caller can leave the routing out
      runMailAuth(raw, { now: RECEIVED_AT, dns: { lookupTxt: dns.lookupTxt } });
    expect(typeof call).toBe('function');
  });

  it('runs header sanity itself when no header facts are given', async () => {
    const result = await runMailAuth(toRaw(`From: ${ATTACKER_ADDRESS}\r\n${buildMessage()}`), { ...DECISION, resolver: dns.resolver, now: RECEIVED_AT });
    expect(result).toEqual({ ok: false, reason: 'malformed', detail: 'from_duplicate' });
  });

  it('turns a verifier crash into malformed and logs only the error name', async () => {
    mockDkimVerifyFailure = true;
    const assessment = await assess(await vendorSigned());
    expect(assessment.mailAuth).toEqual({ ok: false, reason: 'malformed', detail: 'verifier_error' });
    expect(assessment.classification).toMatchObject({ row: 4, reason: 'malformed' });
    expect(logger.warn).toHaveBeenCalledWith('summaries.mailauth_error', { stage: 'dkim', errorName: 'TypeError' });
  });

  it('storedAuth keeps at most 5 signatures, never b= values, and names the verifier', () => {
    const sig = makeSig();
    const stored = storedAuth([sig, sig, sig, sig, sig, sig], NO_ARC);
    expect(stored.dkim).toHaveLength(5);
    expect(stored.dkim[0]).toEqual({ domain: VENDOR_DOMAIN, result: 'pass', aligned: true, signsTo: true, signsDate: true });
    expect(JSON.stringify(stored)).not.toContain(sig.signatureValue ?? 'unused');
    expect(stored.verifier).toBe(MAILAUTH_VERIFIER);
  });

  it('MAILAUTH_VERIFIER matches the installed mailauth version', () => {
    const pkg = JSON.parse(readFileSync(join(__dirname, '../../node_modules/mailauth/package.json'), 'utf8')) as { version: string };
    expect(MAILAUTH_VERIFIER).toBe(`mailauth@${pkg.version}`);
  });
});

describe('verifyMailAuth (functions/src/mail/auth.ts, shared with the assistant matters)', () => {
  it('names its logs by logScope: matters.mailauth_error for the assistant, summaries.mailauth_error through runMailAuth', async () => {
    const raw = toRaw(await vendorSigned());
    mockDkimVerifyFailure = true;
    const routing = (): DnsRouting => ({ priorityDomains: [], alignedDomains: [] });
    const result = await verifyMailAuth(raw, { now: RECEIVED_AT, resolver: dns.resolver, routing, logScope: 'matters' });
    expect(result).toEqual({ ok: false, reason: 'malformed', detail: 'verifier_error' });
    expect(logger.warn).toHaveBeenCalledWith('matters.mailauth_error', { stage: 'dkim', errorName: 'TypeError' });
    expect(logger.warn).not.toHaveBeenCalledWith('summaries.mailauth_error', expect.anything());
    (logger.warn as jest.Mock).mockClear();
    await runMailAuth(raw, { ...DECISION, resolver: dns.resolver, now: RECEIVED_AT });
    expect(logger.warn).toHaveBeenCalledWith('summaries.mailauth_error', { stage: 'dkim', errorName: 'TypeError' });
    expect(logger.warn).not.toHaveBeenCalledWith('matters.mailauth_error', expect.anything());
  });

  it('calls the routing only when no resolver is injected, with the strict header facts', async () => {
    const raw = toRaw(await vendorSigned());
    const routing = jest.fn((_header: HeaderFacts): DnsRouting => ({ priorityDomains: [], alignedDomains: [] }));
    const injected = await verifyMailAuth(raw, { now: RECEIVED_AT, resolver: dns.resolver, routing, logScope: 'matters' });
    expect(routing).not.toHaveBeenCalled();
    const fresh = await verifyMailAuth(raw, { now: RECEIVED_AT, routing, logScope: 'matters', dns: { lookupTxt: dns.lookupTxt } });
    expect(routing).toHaveBeenCalledTimes(1);
    expect(routing.mock.calls[0]?.[0]).toMatchObject({ ok: true, from: VENDOR_ADDRESS, fromDomain: VENDOR_DOMAIN });
    // Same verdict either way: the routing only chooses budgets.
    expect(fresh).toEqual(injected);
    expect(injected).toMatchObject({ ok: true, signatures: [{ domain: VENDOR_DOMAIN, result: 'pass' }] });
  });
});

// ---------------------------------------------------------------------------------------------
// classify (pure)
// ---------------------------------------------------------------------------------------------

function makeSig(overrides: Partial<NormalizedSignature> = {}): NormalizedSignature {
  return {
    domain: VENDOR_DOMAIN,
    selector: 's1',
    result: 'pass',
    aligned: true,
    signsFrom: true,
    signsTo: true,
    signsCc: false,
    signsDate: true,
    bodyLengthLimited: false,
    algo: 'rsa-sha256',
    bits: 2048,
    testing: false,
    temperror: false,
    signatureValue: 'c3ludGhldGljLXNpZ25hdHVyZQ==',
    ...overrides,
  };
}

function makeInput(overrides: Partial<ClassifyInput> = {}): ClassifyInput {
  return {
    structure: 'ok',
    from: VENDOR_ADDRESS,
    to: [USER_MAILBOX],
    cc: [],
    dateHeader: FRESH_DATE,
    signatures: [makeSig()],
    arc: NO_ARC,
    receivedAt: RECEIVED_AT,
    senders: SENDERS,
    mailboxes: MAILBOXES,
    ...overrides,
  };
}

function rfcDate(ms: number): string {
  return new Date(ms).toUTCString().replace('GMT', '+0000');
}

describe('classify', () => {
  it('row 7 on the baseline input', () => {
    expect(classify(makeInput())).toMatchObject({ row: 7, outcome: 'accept' });
  });

  it('row 4 for too_large, malformed and an unusable From', () => {
    expect(classify(makeInput({ structure: 'too_large' }))).toMatchObject({ row: 4, outcome: 'refuse', reason: 'too_large' });
    expect(classify(makeInput({ structure: 'malformed' }))).toMatchObject({ row: 4, reason: 'malformed' });
    expect(classify(makeInput({ from: null }))).toMatchObject({ row: 4, reason: 'malformed' });
    expect(classify(makeInput({ from: `Notetaker <${VENDOR_ADDRESS}>` }))).toMatchObject({ row: 4, reason: 'malformed' });
  });

  it.each<[string, Partial<NormalizedSignature>]>([
    ['a key under 1024 bits', { bits: 1023 }],
    ['an unknown RSA key size', { bits: null }],
    ['rsa-sha1', { algo: 'rsa-sha1' }],
    ['an unknown algorithm', { algo: 'rsa-sha512' }],
    ['a t=y key', { testing: true }],
    ['an l= limit', { bodyLengthLimited: true }],
    ['From not signed', { signsFrom: false }],
    ['a neutral result', { result: 'neutral' }],
    ['a policy result', { result: 'policy' }],
    ['an unaligned d= even when flagged aligned', { domain: 'mailer.example', aligned: true }],
    ['a sibling domain', { domain: 'mail.other-notetaker.example' }],
    ['a bare top-level d=', { domain: 'example' }],
  ])('a signature with %s is not a passSig (row 13)', (_label, overrides) => {
    const sig = makeSig(overrides);
    expect(isPassSig(sig, VENDOR_DOMAIN)).toBe(false);
    expect(classify(makeInput({ signatures: [sig] }))).toMatchObject({ row: 13, reason: 'sender_not_verified', senderDomain: null });
  });

  it('ed25519 passes without an RSA key size', () => {
    expect(classify(makeInput({ signatures: [makeSig({ algo: 'ed25519-sha256', bits: null })] })).row).toBe(7);
  });

  it('aligns a subdomain signer and a parent signer, never siblings', () => {
    expect(classify(makeInput({ signatures: [makeSig({ domain: `mail.${VENDOR_DOMAIN}` })] })).row).toBe(7);
    const subFrom = `recaps@mail.${VENDOR_DOMAIN}`;
    expect(classify(makeInput({ from: subFrom, senders: [subFrom] })).row).toBe(7);
    expect(domainsAlign('a.notetaker.example', 'b.notetaker.example')).toBe(false);
    expect(domainsAlign('notetaker.example', 'evilnotetaker.example')).toBe(false);
    expect(domainsAlign('example', 'notetaker.example')).toBe(false);
    expect(domainsAlign('NoteTaker.Example.', 'notetaker.example')).toBe(true);
  });

  it('Fresh: 14 days before to 24 hours after receipt, with the signed Date only', () => {
    const at = RECEIVED_AT.getTime();
    expect(classify(makeInput({ dateHeader: rfcDate(at - 14 * DAY) })).row).toBe(7);
    expect(classify(makeInput({ dateHeader: rfcDate(at - 14 * DAY - 1000) })).row).toBe(8);
    expect(classify(makeInput({ dateHeader: rfcDate(at + 24 * HOUR) })).row).toBe(7);
    expect(classify(makeInput({ dateHeader: rfcDate(at + 24 * HOUR + MINUTE) })).row).toBe(8);
    expect(classify(makeInput({ dateHeader: 'yesterday afternoon' })).row).toBe(8);
    expect(classify(makeInput({ dateHeader: null })).row).toBe(8);
    expect(classify(makeInput({ signatures: [makeSig({ signsDate: false })] }))).toMatchObject({ row: 8, anchorAt: null });
  });

  it('B needs the covering header signed: Cc counts only when Cc is signed', () => {
    const viaCc = { to: [PRIVATE_ADDRESS], cc: [USER_MAILBOX] };
    expect(classify(makeInput({ ...viaCc, signatures: [makeSig({ signsCc: true })] })).row).toBe(7);
    expect(classify(makeInput({ ...viaCc, signatures: [makeSig({ signsCc: false })] })).row).toBe(9);
    expect(classify(makeInput({ signatures: [makeSig({ signsTo: false })] })).row).toBe(9);
  });

  it('the best passSig decides: one that binds and is fresh wins over a weaker one', () => {
    const weak = makeSig({ domain: `mail.${VENDOR_DOMAIN}`, signsTo: false, signsDate: false });
    const strong = makeSig();
    expect(classify(makeInput({ signatures: [weak, strong] }))).toMatchObject({ row: 7, decidingDomain: VENDOR_DOMAIN });
  });

  it('compares senders and mailboxes as lowercased exact addresses', () => {
    expect(classify(makeInput({ mailboxes: ['Dana@Company.Example'], senders: ['RECAPS@notetaker.example'] })).row).toBe(7);
    expect(classify(makeInput({ from: 'RECAPS@NOTETAKER.EXAMPLE' })).row).toBe(7);
  });

  it('a bare domain in SUMMARIES_SENDERS never makes V (finding 6)', () => {
    expect(classify(makeInput({ senders: [VENDOR_DOMAIN] }))).toMatchObject({ row: 14, reason: 'not_from_your_notetaker', senderDomain: VENDOR_DOMAIN });
  });

  describe('row 5 window: 0 <= receivedAt - Date < 5 hours, no future skew', () => {
    const temp = [makeSig({ result: 'temperror', temperror: true, bits: null })];
    const at = RECEIVED_AT.getTime();
    const rowFor = (dateMs: number | null, now?: Date): DecisionRow =>
      classify(makeInput({ signatures: temp, dateHeader: dateMs === null ? null : rfcDate(dateMs), ...(now ? { now } : {}) })).row;

    it('retries from the moment of the Date up to just under 5 hours after it', () => {
      expect(rowFor(at)).toBe(5);
      expect(rowFor(at - MINUTE)).toBe(5);
      expect(rowFor(at - 5 * HOUR + 1000)).toBe(5);
      expect(rowFor(at - 5 * HOUR)).toBe(13);
      expect(rowFor(at - DAY)).toBe(13);
    });

    it('never retries a Date after receipt, however small the skew (a forged Date cannot stretch it)', () => {
      expect(rowFor(at + 1000)).toBe(13);
      expect(rowFor(at + MINUTE)).toBe(13);
      expect(rowFor(at + 23 * HOUR)).toBe(13);
      expect(rowFor(at + 2 * DAY)).toBe(13);
    });

    it('never retries without a parseable Date', () => {
      expect(rowFor(null)).toBe(13);
      expect(classify(makeInput({ signatures: temp, dateHeader: 'soon' })).row).toBe(13);
    });

    it('holds at the attempt time too: a later attempt past 5 hours stops retrying', () => {
      const date = at - 30 * MINUTE;
      expect(rowFor(date, new Date(at + 4 * HOUR))).toBe(5);
      expect(rowFor(date, new Date(at + 4 * HOUR + 30 * MINUTE))).toBe(13);
      expect(rowFor(date, new Date(at + 6 * HOUR))).toBe(13);
      // An attempt clock behind the Date is future skew as well.
      expect(rowFor(date, new Date(at - HOUR))).toBe(13);
    });
  });

  it('row 5 only for a temperror that could decide this From', () => {
    const temp = makeSig({ result: 'temperror', temperror: true });
    expect(classify(makeInput({ from: ATTACKER_ADDRESS, signatures: [temp] })).row).toBe(14);
    expect(classify(makeInput({ signatures: [makeSig({ domain: ESP_DOMAIN, result: 'temperror', temperror: true })] })).row).toBe(13);
  });

  it('row 6 comes before V, and needs a passSig', () => {
    const gmail = makeInput({ from: GMAIL_CONFIRMATION, senders: [GMAIL_CONFIRMATION], signatures: [makeSig({ domain: 'google.com' })] });
    expect(classify(gmail).row).toBe(6);
    expect(classify({ ...gmail, senders: [], signatures: [makeSig({ domain: 'google.com', result: 'fail' })] }).row).toBe(14);
  });

  it('V comes before U when an address is both a sender and a mailbox', () => {
    expect(classify(makeInput({ mailboxes: [USER_MAILBOX, VENDOR_ADDRESS] })).row).toBe(7);
  });

  it('T needs a failing signature by a listed sender domain and no V', () => {
    const failing = makeSig({ result: 'fail' });
    expect(classify(makeInput({ signatures: [failing] })).row).toBe(12);
    expect(classify(makeInput({ signatures: [failing, makeSig({ signsTo: true })] })).row).toBe(7);
    expect(classify(makeInput({ signatures: [makeSig({ domain: ATTACKER_DOMAIN, result: 'fail' })] })).row).toBe(13);
    expect(classify(makeInput({ from: ATTACKER_ADDRESS, signatures: [failing] })).row).toBe(12);
  });

  it('row 11 needs a passing chain sealed exactly by google.com or microsoft.com', () => {
    const tampered = { signatures: [makeSig({ result: 'fail' })] };
    expect(classify(makeInput({ ...tampered, arc: { result: 'pass', sealer: 'google.com' } })).row).toBe(11);
    expect(classify(makeInput({ ...tampered, arc: { result: 'pass', sealer: 'microsoft.com' } })).row).toBe(11);
    expect(classify(makeInput({ ...tampered, arc: { result: 'pass', sealer: 'mail.google.com' } })).row).toBe(12);
    expect(classify(makeInput({ ...tampered, arc: { result: 'pass', sealer: ATTACKER_DOMAIN } })).row).toBe(12);
    expect(classify(makeInput({ ...tampered, arc: { result: 'fail', sealer: 'google.com' } })).row).toBe(12);
    expect(classify(makeInput({ ...tampered, arc: { result: 'pass', sealer: null } })).row).toBe(12);
    expect(classify(makeInput({ arc: { result: 'pass', sealer: 'google.com' }, signatures: [] })).row).toBe(13);
  });

  it('senderDomain only ever comes from a passSig (finding 17)', () => {
    expect(classify(makeInput({ signatures: [makeSig({ domain: ATTACKER_DOMAIN })] })).senderDomain).toBeNull();
    expect(classify(makeInput({ signatures: [makeSig({ result: 'fail' })] })).senderDomain).toBeNull();
    const spoof = makeInput({ from: ATTACKER_ADDRESS, signatures: [makeSig({ domain: ATTACKER_DOMAIN })] });
    expect(classify(spoof)).toMatchObject({ row: 14, senderDomain: ATTACKER_DOMAIN, decidingDomain: null });
  });

  it('every combination yields exactly one row with that row fixed outcome', () => {
    const outcomeOf: Record<DecisionRow, ClassifyOutcome> = {
      4: 'refuse',
      5: 'retry',
      6: 'gmail',
      7: 'accept',
      8: 'inbox',
      9: 'inbox',
      10: 'inbox',
      11: 'refuse',
      12: 'refuse',
      13: 'refuse',
      14: 'refuse',
    };
    const froms = [VENDOR_ADDRESS, USER_MAILBOX, GMAIL_CONFIRMATION, ATTACKER_ADDRESS, null];
    const domains = [VENDOR_DOMAIN, USER_DOMAIN, 'google.com', ATTACKER_DOMAIN];
    const results = ['pass', 'fail', 'neutral', 'temperror'] as const;
    const seen = new Set<DecisionRow>();
    for (const from of froms) {
      for (const domain of domains) {
        for (const sigResult of results) {
          for (const signsTo of [true, false]) {
            for (const arcResult of ['pass', 'none'] as const) {
              const out = classify(
                makeInput({
                  from,
                  signatures: [makeSig({ domain, result: sigResult, temperror: sigResult === 'temperror', signsTo })],
                  arc: { result: arcResult, sealer: arcResult === 'pass' ? 'google.com' : null },
                }),
              );
              expect(out.outcome).toBe(outcomeOf[out.row]);
              expect(CLASSIFY_REASONS).toContain(out.reason);
              seen.add(out.row);
            }
          }
        }
      }
    }
    expect([...seen].sort((a, b) => a - b)).toEqual([4, 5, 6, 7, 9, 10, 11, 12, 13, 14]);
  });

  it('exposes the documented tuning', () => {
    expect(AUTHENTICITY_TUNING).toMatchObject({
      minRsaBits: 1024,
      freshBeforeMs: 14 * DAY,
      freshAfterMs: DAY,
      temperrorRetryMs: 5 * HOUR,
      dnsTimeoutMs: 4000,
      dnsTries: 2,
      dnsLookupCapMs: 8000,
      dnsBudgetMs: 8000,
      dnsAlignedBudgetMs: 8000,
      dnsPriorityBudgetMs: 16_000,
    });
    // No future skew allowance any more.
    expect(AUTHENTICITY_TUNING).not.toHaveProperty('temperrorFutureMs');
    // Each budget holds whole caps: shared and aligned one each, priority two.
    expect(AUTHENTICITY_TUNING.dnsBudgetMs).toBe(AUTHENTICITY_TUNING.dnsLookupCapMs);
    expect(AUTHENTICITY_TUNING.dnsAlignedBudgetMs).toBe(AUTHENTICITY_TUNING.dnsLookupCapMs);
    expect(AUTHENTICITY_TUNING.dnsPriorityBudgetMs).toBe(2 * AUTHENTICITY_TUNING.dnsLookupCapMs);
    // The hard bound per message is the three budgets together, inside the 60 s function timeout.
    expect(DNS_MESSAGE_BOUND_MS).toBe(
      AUTHENTICITY_TUNING.dnsBudgetMs + AUTHENTICITY_TUNING.dnsAlignedBudgetMs + AUTHENTICITY_TUNING.dnsPriorityBudgetMs,
    );
    expect(DNS_MESSAGE_BOUND_MS).toBe(32_000);
    expect(DNS_MESSAGE_BOUND_MS).toBeLessThanOrEqual(40_000);
  });
});

// ---------------------------------------------------------------------------------------------
// Header sanity and the strict parsers
// ---------------------------------------------------------------------------------------------

describe('checkHeaders', () => {
  it('returns the strict From, To and Cc addr-specs, Date and Message-ID', () => {
    const result = checkHeaders(toRaw(buildMessage({ from: `"Recaps, Notetaker" <RECAPS@NoteTaker.example>`, cc: `"Lee, L." <${COLLEAGUE_ADDRESS}>, ${USER_MAILBOX}` })));
    expect(result).toMatchObject({
      ok: true,
      from: VENDOR_ADDRESS,
      fromDomain: VENDOR_DOMAIN,
      to: [USER_MAILBOX],
      cc: [COLLEAGUE_ADDRESS, USER_MAILBOX],
      date: FRESH_DATE,
      messageId: '<recap-0001@notetaker.example>',
    });
  });

  it('accepts bare LF line ends and folded fields', () => {
    const message = `From: Notetaker\n <${VENDOR_ADDRESS}>\nTo: ${USER_MAILBOX},\n\t${COLLEAGUE_ADDRESS}\nSubject: x\n\nbody\n`;
    expect(checkHeaders(toRaw(message))).toMatchObject({ ok: true, from: VENDOR_ADDRESS, to: [USER_MAILBOX, COLLEAGUE_ADDRESS] });
  });

  it.each<[string, string, string]>([
    ['a bare CR', `From: ${VENDOR_ADDRESS}\r\nSubject: a\rTo: ${USER_MAILBOX}\r\n\r\nbody`, 'bare_cr'],
    ['a NUL byte', `From: ${VENDOR_ADDRESS}\r\nSubject: a\0b\r\n\r\nbody`, 'nul_byte'],
    ['a line without a field name', `From: ${VENDOR_ADDRESS}\r\nnot a header line\r\n\r\nbody`, 'bad_line'],
    ['whitespace before the colon', `From: ${VENDOR_ADDRESS}\r\nTo : ${USER_MAILBOX}\r\n\r\nbody`, 'bad_line'],
    ['a fold before the colon', `From\r\n : ${VENDOR_ADDRESS}\r\n\r\nbody`, 'bad_line'],
    ['a continuation as the first line', ` From: ${VENDOR_ADDRESS}\r\n\r\nbody`, 'bad_line'],
    ['no header block', `\r\nFrom: ${VENDOR_ADDRESS}\r\n`, 'empty_header'],
    ['no From', `To: ${USER_MAILBOX}\r\n\r\nbody`, 'from_missing'],
    ['two From fields differing in case', `From: ${VENDOR_ADDRESS}\r\nFROM: ${ATTACKER_ADDRESS}\r\n\r\nbody`, 'from_duplicate'],
    ['an empty From', `From:  \r\n\r\nbody`, 'from_invalid'],
  ])('refuses %s', (_label, message, detail) => {
    expect(checkHeaders(toRaw(message))).toMatchObject({ ok: false, reason: 'malformed', detail });
  });

  it('bounds the signature fields that cost DNS lookups', () => {
    const many = (name: string, count: number) => Array.from({ length: count }, (_, i) => `${name}: i=${i + 1}; d=x.example`);
    const dkim = checkHeaders(toRaw(buildMessage({ extraHeaders: many('DKIM-Signature', HEADER_LIMITS.maxDkimSignatures + 1) })));
    expect(dkim).toMatchObject({ ok: false, detail: 'too_many_signatures' });
    const arcSeals = checkHeaders(toRaw(buildMessage({ extraHeaders: many('ARC-Seal', HEADER_LIMITS.maxArcFieldsEach + 1) })));
    expect(arcSeals).toMatchObject({ ok: false, detail: 'too_many_signatures' });
    expect(checkHeaders(toRaw(buildMessage({ extraHeaders: many('DKIM-Signature', HEADER_LIMITS.maxDkimSignatures) })))).toMatchObject({ ok: true });
  });

  it('an unparseable To or Cc yields no address instead of a refusal', () => {
    expect(checkHeaders(toRaw(buildMessage({ to: `${USER_MAILBOX} (me)`, cc: 'team: a@company.example;' })))).toMatchObject({ ok: true, to: [], cc: [] });
  });
});

describe('parseStrictMailbox', () => {
  it.each<[string, string]>([
    [VENDOR_ADDRESS, VENDOR_ADDRESS],
    [`  <${VENDOR_ADDRESS}>  `, VENDOR_ADDRESS],
    [`Notetaker <${VENDOR_ADDRESS}>`, VENDOR_ADDRESS],
    [`"${USER_MAILBOX}" <${ATTACKER_ADDRESS}>`, ATTACKER_ADDRESS],
    [`=?utf-8?q?Note_taker?= <${VENDOR_ADDRESS}>`, VENDOR_ADDRESS],
    [`D\u00e1na <${USER_MAILBOX}>`, USER_MAILBOX],
    [`John Q. Public <${USER_MAILBOX}>`, USER_MAILBOX],
    [`"Quote \\" inside" <${VENDOR_ADDRESS}>`, VENDOR_ADDRESS],
    ['Recaps@NoteTaker.Example', VENDOR_ADDRESS],
    // "?" is atext (the contract's SUMMARY_ADDR_SPEC_PATTERN accepts it); only "=?" is refused.
    [`What?@${USER_DOMAIN}`, `what?@${USER_DOMAIN}`],
    [`Dana <who?.what?@${USER_DOMAIN}>`, `who?.what?@${USER_DOMAIN}`],
    [`?=@${USER_DOMAIN}`, `?=@${USER_DOMAIN}`],
  ])('accepts %s', (value, expected) => {
    expect(parseStrictMailbox(value)).toBe(expected);
  });

  it.each([
    `${VENDOR_ADDRESS} (Notetaker)`,
    `(Notetaker) ${VENDOR_ADDRESS}`,
    `Recaps: ${VENDOR_ADDRESS};`,
    `<@relay.example:${VENDOR_ADDRESS}>`,
    `${VENDOR_ADDRESS}, ${ATTACKER_ADDRESS}`,
    `=?utf-8?b?cmVjYXBz?=@${VENDOR_DOMAIN}`,
    `re=?caps@${VENDOR_DOMAIN}`,
    `recaps=?@${VENDOR_DOMAIN}`,
    `Notetaker <=?utf-8?q?recaps?=@${VENDOR_DOMAIN}>`,
    `recaps@nota${String.fromCharCode(0x212a)}er.example`, // KELVIN SIGN lowercases to "k"
    `"recaps"@${VENDOR_DOMAIN}`,
    `recaps@${ATTACKER_DOMAIN}@${VENDOR_DOMAIN}`,
    'recaps@[192.0.2.1]',
    'recaps@localhost',
    'recaps@192.0.2.1',
    `Notetaker <${VENDOR_ADDRESS}> trailing`,
    `"Notetaker <${VENDOR_ADDRESS}>" <${ATTACKER_ADDRESS}>`,
    `Notetaker < ${VENDOR_ADDRESS} >`,
    `Notetaker <${VENDOR_ADDRESS}`,
    `noreply@${VENDOR_DOMAIN} <${ATTACKER_ADDRESS}>`,
    `"unterminated <${VENDOR_ADDRESS}>`,
    `.recaps@${VENDOR_DOMAIN}`,
    `re..caps@${VENDOR_DOMAIN}`,
    `recaps@-notetaker.example`,
    '',
  ])('refuses %s', (value) => {
    expect(parseStrictMailbox(value)).toBeNull();
  });
});

describe('parseAddressList', () => {
  it('splits on commas outside quotes and angle brackets', () => {
    expect(parseAddressList(`"Lee, L." <${COLLEAGUE_ADDRESS}>, ${USER_MAILBOX}, ,`)).toEqual([COLLEAGUE_ADDRESS, USER_MAILBOX]);
  });

  it('fails as a whole on a group or a single bad element', () => {
    expect(parseAddressList('undisclosed-recipients:;')).toBeNull();
    expect(parseAddressList(`${USER_MAILBOX}, Lee (colleague) <${COLLEAGUE_ADDRESS}>`)).toBeNull();
    expect(parseAddressList(`"open quote ${USER_MAILBOX}`)).toBeNull();
    expect(parseAddressList(`${USER_MAILBOX}, x=?y@${USER_DOMAIN}`)).toBeNull();
  });

  it('keeps a mailbox with "?" in its local part, so the rest of the list survives', () => {
    expect(parseAddressList(`Lee <${COLLEAGUE_ADDRESS}>, what?@${USER_DOMAIN}, ${USER_MAILBOX}`)).toEqual([
      COLLEAGUE_ADDRESS,
      `what?@${USER_DOMAIN}`,
      USER_MAILBOX,
    ]);
  });
});

describe('a listed mailbox with "?" in its local part', () => {
  const ODD_MAILBOX = `what?@${USER_DOMAIN}`;

  it('binds through a signed To (row 7)', async () => {
    const result = await classifyMessage(await vendorSigned({ to: `What <${ODD_MAILBOX}>` }), { mailboxes: [ODD_MAILBOX] });
    expect(result).toMatchObject({ row: 7, outcome: 'accept', recipientBound: true });
  });

  it('binds through a signed Cc listing others too, and does not drop the list', async () => {
    const message = await vendorSigned({ to: PRIVATE_ADDRESS, cc: `Lee <${COLLEAGUE_ADDRESS}>, ${ODD_MAILBOX}` });
    const assessment = await assess(message, { mailboxes: [USER_MAILBOX, ODD_MAILBOX] });
    expect(assessment.header).toMatchObject({ ok: true, cc: [COLLEAGUE_ADDRESS, ODD_MAILBOX] });
    expect(assessment.classification).toMatchObject({ row: 7, recipientBound: true });
  });

  it('normalizes as configured, while "=?" never does', () => {
    expect(normalizeAddress(' What?@Company.Example ')).toBe(ODD_MAILBOX);
    expect(parseAddrSpec(ODD_MAILBOX)).toBe(ODD_MAILBOX);
    expect(normalizeAddress(`a=?b@${USER_DOMAIN}`)).toBeNull();
    expect(parseAddrSpec(`a=?b@${USER_DOMAIN}`)).toBeNull();
  });
});

describe('parseMailDate', () => {
  it.each<[string, string]>([
    [FRESH_DATE, '2026-11-10T15:20:00.000Z'],
    ['Tue, 10 Nov 2026 15:20:00 +0000 (UTC)', '2026-11-10T15:20:00.000Z'],
    ['10 Nov 2026 09:20 -0600', '2026-11-10T15:20:00.000Z'],
    ['Tue, 10 Nov 2026 20:50:00 +0530', '2026-11-10T15:20:00.000Z'],
    ['Tue, 10 Nov 2026 07:20:00 PST', '2026-11-10T15:20:00.000Z'],
    ['Tue, 10 Nov 26 15:20:00 GMT', '2026-11-10T15:20:00.000Z'],
  ])('parses %s', (value, iso) => {
    expect(parseMailDate(value)?.toISOString()).toBe(iso);
  });

  it.each(['30 Feb 2026 10:00:00 +0000', '10 Nov 2026 25:00:00 +0000', '10 Foo 2026 10:00:00 +0000', '2026-11-10T15:20:00Z', 'soon', ''])(
    'refuses %s',
    (value) => {
      expect(parseMailDate(value)).toBeNull();
    },
  );
});

describe('senders and mailboxes', () => {
  it('normalizeSenders keeps exact lowercased IDNA ASCII addresses only', () => {
    expect(normalizeSenders(` RECAPS@notetaker.example , ${VENDOR_DOMAIN}, Notetaker <x@notetaker.example>, recaps@notetaker.example,, info@b\u00fccher.example`)).toEqual([
      VENDOR_ADDRESS,
      'info@xn--bcher-kva.example',
    ]);
    expect(normalizeSenders(undefined)).toEqual([]);
    expect(normalizeSenders('')).toEqual([]);
  });

  it('normalizeAddress refuses bare domains and display names', () => {
    expect(normalizeAddress(VENDOR_DOMAIN)).toBeNull();
    expect(normalizeAddress(`Dana <${USER_MAILBOX}>`)).toBeNull();
    expect(normalizeAddress(' Dana@Company.Example ')).toBe(USER_MAILBOX);
  });
});

// ---------------------------------------------------------------------------------------------
// Production resolver (fake lookup; no network)
// ---------------------------------------------------------------------------------------------

describe('createDnsResolver', () => {
  it('caches each name for the life of one resolver (one message)', async () => {
    const lookupTxt = jest.fn(async (name: string) => [[`record for ${name}`]]);
    const resolver = createDnsResolver({ lookupTxt, priorityDomains: [], alignedDomains: [] });
    await expect(resolver('S1._domainkey.notetaker.example', 'TXT')).resolves.toEqual([['record for s1._domainkey.notetaker.example']]);
    await resolver('s1._domainkey.notetaker.example', 'TXT');
    expect(lookupTxt).toHaveBeenCalledTimes(1);
    await createDnsResolver({ lookupTxt, priorityDomains: [], alignedDomains: [] })('s1._domainkey.notetaker.example', 'TXT');
    expect(lookupTxt).toHaveBeenCalledTimes(2);
  });

  it('keeps DNS error codes, caches failures, and answers TXT only', async () => {
    const lookupTxt = jest.fn(async () => {
      throw Object.assign(new Error('nf'), { code: 'ENOTFOUND' });
    });
    const resolver = createDnsResolver({ lookupTxt, priorityDomains: [], alignedDomains: [] });
    await expect(resolver('x._domainkey.notetaker.example', 'TXT')).rejects.toMatchObject({ code: 'ENOTFOUND' });
    await expect(resolver('x._domainkey.notetaker.example', 'TXT')).rejects.toMatchObject({ code: 'ENOTFOUND' });
    expect(lookupTxt).toHaveBeenCalledTimes(1);
    await expect(resolver('notetaker.example', 'A')).rejects.toMatchObject({ code: 'ENOTIMP' });
  });

  it('counts only waiting time, and refuses with EBUDGET once a budget is spent', async () => {
    let clock = 1_000;
    const lookupTxt = jest.fn(async (name: string) => {
      clock += 6_000;
      return [[name]];
    });
    const resolver = createDnsResolver({ lookupTxt, budgetMs: 10_000, priorityBudgetMs: 10_000, priorityDomains: [VENDOR_DOMAIN], alignedDomains: [], clock: () => clock });
    await resolver(`a._domainkey.${ATTACKER_DOMAIN}`, 'TXT');
    clock += 60_000; // idle time between lookups is not waiting time
    await resolver(`b._domainkey.${ATTACKER_DOMAIN}`, 'TXT'); // 4 s were left
    await expect(resolver(`c._domainkey.${ATTACKER_DOMAIN}`, 'TXT')).rejects.toMatchObject({ code: DNS_BUDGET_CODE });
    // The decision domains draw on their own budget.
    await expect(resolver(`s1._domainkey.${VENDOR_DOMAIN}`, 'TXT')).resolves.toEqual([[`s1._domainkey.${VENDOR_DOMAIN}`]]);
    // Answers already cached never cost anything.
    await expect(resolver(`a._domainkey.${ATTACKER_DOMAIN}`, 'TXT')).resolves.toEqual([[`a._domainkey.${ATTACKER_DOMAIN}`]]);
    expect(lookupTxt).toHaveBeenCalledTimes(3);
  });

  it('routes a key to the priority budget only when its d= EXACTLY equals a priority domain, or by exact ARC key name', async () => {
    let clock = 0;
    const lookupTxt = jest.fn(async (name: string) => {
      if (name.endsWith(`.${ATTACKER_DOMAIN}`)) clock += 20_000;
      return [[name]];
    });
    const resolver = createDnsResolver({
      lookupTxt,
      priorityDomains: [VENDOR_DOMAIN.toUpperCase(), USER_DOMAIN],
      alignedDomains: [],
      priorityKeyNames: ['ARC-2026._domainkey.google.com'],
      clock: () => clock,
    });
    await resolver(`spend._domainkey.${ATTACKER_DOMAIN}`, 'TXT'); // spends the shared budget
    for (const name of [`s1._domainkey.${VENDOR_DOMAIN}`, `S2._DOMAINKEY.${USER_DOMAIN}.`, 'arc-2026._domainkey.google.com']) {
      await expect(resolver(name, 'TXT')).resolves.toBeDefined();
    }
    for (const name of [
      `s1._domainkey.mail.${VENDOR_DOMAIN}`, // with no aligned domains, a subdomain of a priority domain shares
      `s1._domainkey.corp.${USER_DOMAIN}`,
      's1._domainkey.google.com', // google.com is not a priority domain here, only that one ARC key
      `s1._domainkey.${VENDOR_DOMAIN}.${ATTACKER_DOMAIN}`, // a decision domain as a label of the attacker's zone
      `s1._domainkey.evil${VENDOR_DOMAIN}`, // a look-alike, not a subdomain
      `${VENDOR_DOMAIN}._domainkey.${ATTACKER_DOMAIN}`, // the selector spells the decision domain
      `s1._domainkey.${VENDOR_DOMAIN}._domainkey.${ATTACKER_DOMAIN}`,
      `s1._domainkey.${MAPPED_VENDOR_ALABEL}`, // the A-label of a look-alike
      VENDOR_DOMAIN, // not a key record name at all
    ]) {
      await expect(resolver(name, 'TXT')).rejects.toMatchObject({ code: DNS_BUDGET_CODE });
    }
  });

  it('routes a key-record domain that aligns with an aligned domain, and is not a priority domain, to the aligned budget', async () => {
    let clock = 0;
    const slowZones = [ATTACKER_DOMAIN, `lame.${VENDOR_DOMAIN}`];
    const lookupTxt = jest.fn(async (name: string) => {
      if (slowZones.some((zone) => name.endsWith(`.${zone}`))) clock += 20_000;
      return [[name]];
    });
    const resolver = createDnsResolver({
      lookupTxt,
      priorityDomains: [VENDOR_DOMAIN],
      alignedDomains: [VENDOR_DOMAIN.toUpperCase()],
      clock: () => clock,
    });
    await resolver(`spend._domainkey.${ATTACKER_DOMAIN}`, 'TXT'); // spends the shared budget
    // Aligned, not equal: subdomains at any depth use the aligned budget the shared one cannot spend.
    await expect(resolver(`s1._domainkey.${VENDOR_ESP_DOMAIN}`, 'TXT')).resolves.toBeDefined();
    await expect(resolver(`s1._domainkey.a.b.${VENDOR_DOMAIN}.`, 'TXT')).resolves.toBeDefined();
    // Not aligned: shares, so refused.
    for (const name of [
      `s1._domainkey.other-${VENDOR_DOMAIN}`, // a look-alike, not a subdomain
      `s1._domainkey.${VENDOR_DOMAIN}.${ATTACKER_DOMAIN}`, // the vendor domain as a label of the attacker's zone
      `${VENDOR_ESP_DOMAIN}._domainkey.${ATTACKER_DOMAIN}`, // the selector spells an aligned domain
      's1._domainkey.example', // a bare top-level domain aligns with nothing
      VENDOR_ESP_DOMAIN, // not a key record name at all
    ]) {
      await expect(resolver(name, 'TXT')).rejects.toMatchObject({ code: DNS_BUDGET_CODE });
    }
    // A hanging aligned subdomain spends the aligned budget, and only that one.
    await resolver(`h1._domainkey.lame.${VENDOR_DOMAIN}`, 'TXT');
    await expect(resolver(`s2._domainkey.${VENDOR_ESP_DOMAIN}`, 'TXT')).rejects.toMatchObject({ code: DNS_BUDGET_CODE });
    // The exact priority domain is untouched by both.
    await expect(resolver(`s1._domainkey.${VENDOR_DOMAIN}`, 'TXT')).resolves.toBeDefined();
    await expect(resolver(`s2._domainkey.${VENDOR_DOMAIN}`, 'TXT')).resolves.toBeDefined();

    // A parent of the aligned domain aligns too (a From at mail.notetaker.example, a d= of
    // notetaker.example); a sibling of it does not.
    const parent = createDnsResolver({ lookupTxt, priorityDomains: [], alignedDomains: [`mail.${VENDOR_DOMAIN}`], clock: () => clock });
    await parent(`spend._domainkey.${ATTACKER_DOMAIN}`, 'TXT'); // spends the shared budget
    await expect(parent(`p1._domainkey.${VENDOR_DOMAIN}`, 'TXT')).resolves.toBeDefined();
    await expect(parent(`p1._domainkey.x.mail.${VENDOR_DOMAIN}`, 'TXT')).resolves.toBeDefined();
    await expect(parent(`p1._domainkey.other.${VENDOR_DOMAIN}`, 'TXT')).rejects.toMatchObject({ code: DNS_BUDGET_CODE });
  });

  it('charges a lookup cut at the cap exactly the cap: two full caps fit a budget of twice the cap', async () => {
    // The fake clock runs 25 ms past the 30 ms cap per lookup, like timers firing late.
    const clock = { now: 0 };
    const hang = jest.fn(() => {
      clock.now += 55;
      return new Promise<string[][]>(() => undefined);
    });
    const resolver = createDnsResolver({
      lookupTxt: hang,
      lookupCapMs: 30,
      budgetMs: 30,
      priorityBudgetMs: 60,
      priorityDomains: [VENDOR_DOMAIN],
      alignedDomains: [],
      clock: () => clock.now,
    });
    await expect(resolver(`s1._domainkey.${VENDOR_DOMAIN}`, 'TXT')).rejects.toMatchObject({ code: 'ETIMEOUT' });
    await expect(resolver(`s2._domainkey.${VENDOR_DOMAIN}`, 'TXT')).rejects.toMatchObject({ code: 'ETIMEOUT' });
    await expect(resolver(`s3._domainkey.${VENDOR_DOMAIN}`, 'TXT')).rejects.toMatchObject({ code: DNS_BUDGET_CODE });
    await expect(resolver(`a._domainkey.${ATTACKER_DOMAIN}`, 'TXT')).rejects.toMatchObject({ code: 'ETIMEOUT' });
    await expect(resolver(`b._domainkey.${ATTACKER_DOMAIN}`, 'TXT')).rejects.toMatchObject({ code: DNS_BUDGET_CODE });
    // Refused lookups never reach the network.
    expect(hang).toHaveBeenCalledTimes(3);
  });

  it('charges an answer no more than its deadline, and a clock that never moves still pays the full cap', async () => {
    const clock = { now: 0 };
    const slow = jest.fn(async (name: string) => {
      clock.now += 50_000; // answered far past the cap on the fake clock
      return [[name]];
    });
    const answered = createDnsResolver({ lookupTxt: slow, lookupCapMs: 8_000, priorityBudgetMs: 16_000, priorityDomains: [VENDOR_DOMAIN], alignedDomains: [], clock: () => clock.now });
    await expect(answered(`s1._domainkey.${VENDOR_DOMAIN}`, 'TXT')).resolves.toBeDefined();
    // Charged 8 s, not 50 s: a full cap is still left for the next lookup.
    await expect(answered(`s2._domainkey.${VENDOR_DOMAIN}`, 'TXT')).resolves.toBeDefined();
    await expect(answered(`s3._domainkey.${VENDOR_DOMAIN}`, 'TXT')).rejects.toMatchObject({ code: DNS_BUDGET_CODE });

    const frozen = createDnsResolver({
      lookupTxt: () => new Promise<string[][]>(() => undefined),
      lookupCapMs: 20,
      budgetMs: 40,
      priorityDomains: [],
      alignedDomains: [],
      clock: () => 0,
    });
    await expect(frozen(`a._domainkey.${ATTACKER_DOMAIN}`, 'TXT')).rejects.toMatchObject({ code: 'ETIMEOUT' });
    await expect(frozen(`b._domainkey.${ATTACKER_DOMAIN}`, 'TXT')).rejects.toMatchObject({ code: 'ETIMEOUT' });
    await expect(frozen(`c._domainkey.${ATTACKER_DOMAIN}`, 'TXT')).rejects.toMatchObject({ code: DNS_BUDGET_CODE });
  });

  it('requires the routing: there is no default that puts every lookup in the shared budget', () => {
    const build = () =>
      // @ts-expect-error priorityDomains is required
      createDnsResolver({ lookupTxt: dns.lookupTxt });
    expect(typeof build).toBe('function');
    const withoutAligned = () =>
      // @ts-expect-error alignedDomains is required too
      createDnsResolver({ lookupTxt: dns.lookupTxt, priorityDomains: [VENDOR_DOMAIN] });
    expect(typeof withoutAligned).toBe('function');
  });

  it('keyRecordDomain reads the d= after the last "._domainkey."', () => {
    expect(keyRecordDomain(`s1._domainkey.${VENDOR_DOMAIN}`)).toBe(VENDOR_DOMAIN);
    expect(keyRecordDomain(`S1._DomainKey.Mail.${VENDOR_DOMAIN}.`)).toBe(`mail.${VENDOR_DOMAIN}`);
    expect(keyRecordDomain(`${VENDOR_DOMAIN}._domainkey.${ATTACKER_DOMAIN}`)).toBe(ATTACKER_DOMAIN);
    expect(keyRecordDomain(`s1._domainkey.${VENDOR_DOMAIN}._domainkey.${ATTACKER_DOMAIN}`)).toBe(ATTACKER_DOMAIN);
    expect(keyRecordDomain(VENDOR_DOMAIN)).toBeNull();
    expect(keyRecordDomain(`._domainkey.${VENDOR_DOMAIN}`)).toBeNull();
  });

  it('cuts a hanging lookup at the cap with ETIMEOUT, and at the budget left with EBUDGET', async () => {
    const hang = jest.fn(() => new Promise<string[][]>(() => undefined));
    const resolver = createDnsResolver({ lookupTxt: hang, lookupCapMs: 30, budgetMs: 50, priorityBudgetMs: 50, priorityDomains: [VENDOR_DOMAIN], alignedDomains: [] });
    const started = Date.now();
    // The full cap fits the budget: a real timeout.
    await expect(resolver(`a._domainkey.${ATTACKER_DOMAIN}`, 'TXT')).rejects.toMatchObject({ code: 'ETIMEOUT' });
    // About 20 ms are left: cut there, and that is the budget, not the domain.
    await expect(resolver(`b._domainkey.${ATTACKER_DOMAIN}`, 'TXT')).rejects.toMatchObject({ code: DNS_BUDGET_CODE });
    await expect(resolver(`c._domainkey.${ATTACKER_DOMAIN}`, 'TXT')).rejects.toMatchObject({ code: DNS_BUDGET_CODE });
    // The decision budget is untouched by all of that.
    await expect(resolver(`s1._domainkey.${VENDOR_DOMAIN}`, 'TXT')).rejects.toMatchObject({ code: 'ETIMEOUT' });
    await expect(resolver(`s2._domainkey.${VENDOR_DOMAIN}`, 'TXT')).rejects.toMatchObject({ code: DNS_BUDGET_CODE });
    // Hard bound: both budgets, plus scheduling slack.
    expect(Date.now() - started).toBeLessThan(50 + 50 + 1_000);
    // A cut lookup stays cut (cached), it is not asked again.
    await expect(resolver(`a._domainkey.${ATTACKER_DOMAIN}`, 'TXT')).rejects.toMatchObject({ code: 'ETIMEOUT' });
    expect(hang).toHaveBeenCalledTimes(4);
  });

  it('each of the three budgets is spent on its own, and together they bound the message', async () => {
    const hang = jest.fn(() => new Promise<string[][]>(() => undefined));
    const budgets = { lookupCapMs: 30, budgetMs: 30, alignedBudgetMs: 30, priorityBudgetMs: 60 };
    const resolver = createDnsResolver({ lookupTxt: hang, ...budgets, priorityDomains: [VENDOR_DOMAIN], alignedDomains: [VENDOR_DOMAIN] });
    const started = Date.now();
    const codeOf = async (name: string): Promise<string | undefined> => {
      try {
        await resolver(name, 'TXT');
        return 'answered';
      } catch (error) {
        return (error as { code?: string }).code;
      }
    };
    // Shared, aligned and priority lookups in turn, as a hostile message would order them.
    const names = [
      `a._domainkey.${ATTACKER_DOMAIN}`,
      `b._domainkey.${ATTACKER_DOMAIN}`,
      `h1._domainkey.lame.${VENDOR_DOMAIN}`,
      `h2._domainkey.lame.${VENDOR_DOMAIN}`,
      `s1._domainkey.${VENDOR_DOMAIN}`,
      `s2._domainkey.${VENDOR_DOMAIN}`,
      `s3._domainkey.${VENDOR_DOMAIN}`,
    ];
    const codes: (string | undefined)[] = [];
    for (const name of names) codes.push(await codeOf(name));
    expect(codes).toEqual(['ETIMEOUT', DNS_BUDGET_CODE, 'ETIMEOUT', DNS_BUDGET_CODE, 'ETIMEOUT', 'ETIMEOUT', DNS_BUDGET_CODE]);
    expect(hang).toHaveBeenCalledTimes(4);
    // Hard bound: the three budgets together, plus scheduling slack.
    expect(Date.now() - started).toBeLessThan(budgets.budgetMs + budgets.alignedBudgetMs + budgets.priorityBudgetMs + 1_000);
  });

  it('concurrent lookups (ARC seal prefetch) share one budget in wall time', async () => {
    const hang = () => new Promise<string[][]>(() => undefined);
    const resolver = createDnsResolver({ lookupTxt: hang, lookupCapMs: 1_000, budgetMs: 40, priorityDomains: [], alignedDomains: [] });
    const settled = await Promise.allSettled(['a', 'b', 'c'].map((selector) => resolver(`${selector}._domainkey.${ATTACKER_DOMAIN}`, 'TXT')));
    expect(settled.map((entry) => (entry.status === 'rejected' ? (entry.reason as { code?: string }).code : 'answered'))).toEqual([
      DNS_BUDGET_CODE,
      DNS_BUDGET_CODE,
      DNS_BUDGET_CODE,
    ]);
    await expect(resolver(`d._domainkey.${ATTACKER_DOMAIN}`, 'TXT')).rejects.toMatchObject({ code: DNS_BUDGET_CODE });
  });
});

// ---------------------------------------------------------------------------------------------
// Logging hygiene
// ---------------------------------------------------------------------------------------------

describe('logging', () => {
  it('never logs addresses, subjects, bodies or header text', async () => {
    mockDkimVerifyFailure = true;
    await assess(await vendorSigned());
    mockDkimVerifyFailure = false;
    await assess(await vendorSigned());
    await assess(buildMessage({ from: `${VENDOR_ADDRESS} (x)` }));
    const clock = { now: RECEIVED_AT.getTime() };
    await assess(
      await forgery(VENDOR_ADDRESS, VENDOR_DOMAIN, 4),
      withProductionResolver({ lookupTxt: slowZoneLookup(ATTACKER_DOMAIN, 9_000, clock), clock: () => clock.now }),
    );
    expect(logger.warn).toHaveBeenCalledWith('summaries.dns_budget_spent', { signatures: 3 });
    const calls = [
      ...(logger.debug as jest.Mock).mock.calls,
      ...(logger.info as jest.Mock).mock.calls,
      ...(logger.warn as jest.Mock).mock.calls,
      ...(logger.error as jest.Mock).mock.calls,
    ];
    expect(calls.length).toBeGreaterThan(0);
    const text = JSON.stringify(calls);
    for (const fragment of ['@', 'Recap', 'Urpayroll', 'owner', 'notetaker.example', ATTACKER_DOMAIN, '_domainkey', 'Message-ID']) {
      expect(text).not.toContain(fragment);
    }
  });
});

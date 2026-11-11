/**
 * M10 private address (functions/src/summaries/address.ts; docs/v2/M10-DESIGN.md section 3 and
 * section 12, Address): token format and hash, envelope-only routing, mailbox syntax (every output
 * parses with the contract's summaryAddrSpecSchema), idempotent create, regenerate in one
 * transaction with the per-UTC-day cap, the disconnect tombstone that keeps that cap, account
 * deletion, resolve, and logs that never carry an address or a token. All data is synthetic.
 */
jest.mock('firebase-functions/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

import { createHash } from 'node:crypto';

import * as functionsLogger from 'firebase-functions/logger';
import type { Firestore } from 'firebase-admin/firestore';

import { summaryActionRequestSchema, summaryAddrSpecSchema, summaryStatusResponseSchema } from '../../src/shared/aiContract';
import {
  SUMMARY_ADDRESSES_COLLECTION,
  SUMMARY_ADDRESS_LIMITS,
  SUMMARY_USERS_COLLECTION,
  addressFor,
  createAddress,
  deleteAddressDocs,
  generateToken,
  isAddressTombstone,
  isToken,
  normalizeMailbox,
  parseAddressTemplate,
  parseSummaryUser,
  readSummaryUser,
  regenerateAddress,
  renderAddress,
  resolveToken,
  rotationDecision,
  setMailboxes,
  tok8,
  tokenFromEnvelope,
  tokenHash,
  validateMailboxes,
  type AddressDeps,
  type AddressLogger,
  type RandomSource,
} from '../../src/summaries/address';
import { hashLinkCode } from '../../src/whatsapp/signature';

// ---------------------------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------------------------

type Data = Record<string, unknown>;

interface FakeSnapshot {
  exists: boolean;
  id: string;
  data(): Data | undefined;
}

class FakeDocRef {
  constructor(
    private readonly store: FakeFirestore,
    readonly path: string,
  ) {}

  get id(): string {
    return this.path.split('/').pop() ?? '';
  }

  async get(): Promise<FakeSnapshot> {
    this.store.directReads.push(this.path);
    return this.store.snapshot(this.path);
  }

  async set(): Promise<never> {
    throw new Error('address writes must run inside a transaction');
  }

  async delete(): Promise<never> {
    throw new Error('address writes must run inside a transaction');
  }
}

interface TxLog {
  reads: string[];
  writes: string[];
}

/**
 * The slice of firebase-admin Firestore that address.ts uses: doc(path).get() and
 * runTransaction with tx.get / tx.set (merge) / tx.delete. Transactions run one at a time (like
 * Firestore's document locks), buffer their writes, refuse a read after a write (a real Firestore
 * rule) and apply nothing when the commit fails.
 */
class FakeFirestore {
  readonly docs = new Map<string, Data>();
  readonly directReads: string[] = [];
  readonly transactions: TxLog[] = [];
  failNextCommit: Error | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  doc(path: string): FakeDocRef {
    return new FakeDocRef(this, path);
  }

  snapshot(path: string): FakeSnapshot {
    const data = this.docs.get(path);
    return {
      exists: data !== undefined,
      id: path.split('/').pop() ?? '',
      data: () => (data === undefined ? undefined : structuredClone(data)),
    };
  }

  runTransaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
    const run = async (): Promise<T> => {
      const log: TxLog = { reads: [], writes: [] };
      this.transactions.push(log);
      const pending: (() => void)[] = [];
      const tx = {
        get: async (ref: FakeDocRef): Promise<FakeSnapshot> => {
          if (pending.length > 0) throw new Error('Firestore transactions require all reads before all writes');
          log.reads.push(ref.path);
          return this.snapshot(ref.path);
        },
        set: (ref: FakeDocRef, data: Data, options?: { merge?: boolean }): void => {
          log.writes.push(`set:${ref.path}`);
          const copy = structuredClone(data);
          pending.push(() => {
            const base = options?.merge === true ? (this.docs.get(ref.path) ?? {}) : {};
            this.docs.set(ref.path, { ...base, ...copy });
          });
        },
        delete: (ref: FakeDocRef): void => {
          log.writes.push(`delete:${ref.path}`);
          pending.push(() => this.docs.delete(ref.path));
        },
      };
      const result = await fn(tx);
      if (this.failNextCommit !== null) {
        const error = this.failNextCommit;
        this.failNextCommit = null;
        throw error;
      }
      pending.forEach((write) => write());
      return result;
    };
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }

  /** Index doc ids (tokenHashes) that map to `uid`. */
  indexHashesFor(uid: string): string[] {
    return [...this.docs.entries()]
      .filter(([path, data]) => path.startsWith(`${SUMMARY_ADDRESSES_COLLECTION}/`) && data.uid === uid)
      .map(([path]) => path.slice(SUMMARY_ADDRESSES_COLLECTION.length + 1));
  }

  user(uid: string): Data | undefined {
    return this.docs.get(`${SUMMARY_USERS_COLLECTION}/${uid}`);
  }
}

class RecordingLogger implements AddressLogger {
  readonly calls: { event: string; fields: Record<string, unknown> }[] = [];
  info(event: string, fields: Record<string, unknown>): void {
    this.calls.push({ event, fields });
  }
}

/** Deterministic, distinct 16-byte draws (0x01..., 0x02..., ...). */
function sequentialRandom(): RandomSource {
  let draw = 0;
  return (size) => {
    draw += 1;
    return new Uint8Array(size).fill(draw);
  };
}

const NOW = new Date('2026-11-11T09:00:00.000Z');
const PROD_TEMPLATE = '{token}@summaries.meetingguard.ai';
const DEV_TEMPLATE = 'a1b2c3d4e5f60718+{token}@inbound.postmarkapp.com';
const UID = 'uid-test-alice';
const OTHER_UID = 'uid-test-bob';
const VERIFIED_EMAIL = 'Alice.Tester@Example.com';

interface Harness {
  db: FakeFirestore;
  log: RecordingLogger;
  deps: AddressDeps;
  setNow(date: Date): void;
}

function harness(template = PROD_TEMPLATE): Harness {
  const db = new FakeFirestore();
  const log = new RecordingLogger();
  let clock = NOW;
  const deps: AddressDeps = {
    db: db as unknown as Firestore,
    now: () => clock,
    template,
    random: sequentialRandom(),
    logger: log,
  };
  return {
    db,
    log,
    deps,
    setNow(date) {
      clock = date;
    },
  };
}

/** Independent base32 reference (bit string, RFC 4648 alphabet, lowercase, no padding). */
function referenceBase32(bytes: Uint8Array): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz234567';
  const bits = [...bytes].map((byte) => byte.toString(2).padStart(8, '0')).join('');
  const padded = bits.padEnd(Math.ceil(bits.length / 5) * 5, '0');
  return (padded.match(/.{5}/g) ?? []).map((chunk) => alphabet.charAt(parseInt(chunk, 2))).join('');
}

// ---------------------------------------------------------------------------------------------
// Token
// ---------------------------------------------------------------------------------------------

describe('token', () => {
  it('the reference encoder matches the RFC 4648 vector', () => {
    expect(referenceBase32(new TextEncoder().encode('foobar'))).toBe('mzxw6ytboi');
  });

  it('draws exactly 16 bytes and encodes them as 26 lowercase base32 characters without padding', () => {
    const sizes: number[] = [];
    const zeros = generateToken((size) => {
      sizes.push(size);
      return new Uint8Array(size);
    });
    expect(sizes).toEqual([16]);
    expect(zeros).toBe('a'.repeat(26));
    expect(generateToken((size) => new Uint8Array(size).fill(0xff))).toBe(`${'7'.repeat(25)}4`);
    const pattern = Uint8Array.from({ length: 16 }, (_, index) => (index * 37 + 11) & 0xff);
    expect(generateToken(() => pattern)).toBe(referenceBase32(pattern));
  });

  it('crypto tokens are well-formed and distinct', () => {
    const tokens = new Set<string>();
    for (let index = 0; index < 200; index += 1) {
      const token = generateToken();
      expect(token).toMatch(/^[a-z2-7]{26}$/);
      expect(isToken(token)).toBe(true);
      tokens.add(token);
    }
    expect(tokens.size).toBe(200);
  });

  it('refuses a random source that returns the wrong length', () => {
    expect(() => generateToken(() => new Uint8Array(15))).toThrow('wrong number of bytes');
  });

  it('isToken accepts only 26 characters of [a-z2-7]', () => {
    const token = generateToken();
    expect(isToken(token)).toBe(true);
    expect(isToken(token.toUpperCase())).toBe(false);
    expect(isToken(token.slice(1))).toBe(false);
    expect(isToken(`${token}a`)).toBe(false);
    expect(isToken(`${token.slice(1)}0`)).toBe(false);
    expect(isToken(`${token.slice(1)}8`)).toBe(false);
    expect(isToken(42)).toBe(false);
    expect(isToken(null)).toBe(false);
  });

  it('tokenHash is sha256 hex of the versioned prefix plus the token, distinct from the link-code hash', () => {
    const token = generateToken();
    const expected = createHash('sha256').update(`mg-summary-address:v1:${token}`, 'utf8').digest('hex');
    expect(tokenHash(token)).toBe(expected);
    expect(tokenHash(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(tokenHash(token)).not.toBe(hashLinkCode(token));
  });

  it('tok8 is the first 8 hex of tokenHash and never echoes token characters', () => {
    const token = generateToken();
    const hash = tokenHash(token);
    expect(tok8(hash)).toBe(hash.slice(0, 8));
    expect(tok8(token)).toBe(hash.slice(0, 8));
    expect(tok8('not-a-token-or-hash')).toBe('invalid');
    expect(tok8('someone@example.com')).toBe('invalid');
  });
});

// ---------------------------------------------------------------------------------------------
// Template and envelope routing
// ---------------------------------------------------------------------------------------------

describe('renderAddress and parseAddressTemplate', () => {
  const token = generateToken(() => new Uint8Array(16).fill(7));

  it('renders the production and development shapes', () => {
    expect(renderAddress(PROD_TEMPLATE, token)).toBe(`${token}@summaries.meetingguard.ai`);
    expect(renderAddress(DEV_TEMPLATE, token)).toBe(`a1b2c3d4e5f60718+${token}@inbound.postmarkapp.com`);
    expect(renderAddress('  {TOKEN}@Summaries.MeetingGuard.AI  ', token)).toBe(`${token}@summaries.meetingguard.ai`);
  });

  it('an empty template means not ready', () => {
    expect(renderAddress('', token)).toBeNull();
    expect(renderAddress('   ', token)).toBeNull();
    expect(renderAddress(undefined, token)).toBeNull();
    expect(parseAddressTemplate('')).toBeNull();
  });

  it('requires exactly one {token} in a supported position', () => {
    expect(renderAddress('summaries.meetingguard.ai', token)).toBeNull();
    expect(renderAddress('inbox@summaries.meetingguard.ai', token)).toBeNull();
    expect(renderAddress('{token}{token}@summaries.meetingguard.ai', token)).toBeNull();
    expect(renderAddress('{token}@{token}.meetingguard.ai', token)).toBeNull();
    expect(renderAddress('x{token}@summaries.meetingguard.ai', token)).toBeNull();
    expect(renderAddress('{token}+x@summaries.meetingguard.ai', token)).toBeNull();
    expect(renderAddress('+{token}@inbound.postmarkapp.com', token)).toBeNull();
    expect(renderAddress('{token}@localhost', token)).toBeNull();
    expect(renderAddress('{token}@summaries@meetingguard.ai', token)).toBeNull();
  });

  it('refuses a token that is not well-formed', () => {
    expect(renderAddress(PROD_TEMPLATE, token.toUpperCase())).toBeNull();
    expect(renderAddress(PROD_TEMPLATE, 'short')).toBeNull();
  });

  it('parses the two shapes', () => {
    expect(parseAddressTemplate(PROD_TEMPLATE)).toEqual({ prefix: null, domain: 'summaries.meetingguard.ai' });
    expect(parseAddressTemplate(DEV_TEMPLATE)).toEqual({ prefix: 'a1b2c3d4e5f60718', domain: 'inbound.postmarkapp.com' });
  });

  it('every rendered address parses with summaryAddrSpecSchema', () => {
    for (const template of [PROD_TEMPLATE, DEV_TEMPLATE]) {
      for (let fill = 0; fill < 256; fill += 51) {
        const address = renderAddress(template, generateToken(() => new Uint8Array(16).fill(fill)));
        expect(address).not.toBeNull();
        expect(summaryAddrSpecSchema.safeParse(address).success).toBe(true);
      }
    }
  });

  it('treats a template whose addresses the contract would refuse as not ready', () => {
    // Local part: prefix + "+" + 26 token characters must stay within 64.
    expect(parseAddressTemplate(`${'p'.repeat(37)}+{token}@inbound.postmarkapp.com`)).toEqual({
      prefix: 'p'.repeat(37),
      domain: 'inbound.postmarkapp.com',
    });
    expect(parseAddressTemplate(`${'p'.repeat(38)}+{token}@inbound.postmarkapp.com`)).toBeNull();
    // Whole address: 26 + 1 + domain must stay within 254.
    const domain227 = `${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(63)}.${'e'.repeat(31)}.com`;
    const domain228 = `${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(63)}.${'e'.repeat(32)}.com`;
    expect(parseAddressTemplate(`{token}@${domain227}`)).toEqual({ prefix: null, domain: domain227 });
    expect(parseAddressTemplate(`{token}@${domain228}`)).toBeNull();
    expect(renderAddress(`{token}@${domain228}`, token)).toBeNull();
  });
});

describe('tokenFromEnvelope (production template)', () => {
  const token = generateToken(() => new Uint8Array(16).fill(9));

  it('reads the token from the envelope recipient local part', () => {
    expect(tokenFromEnvelope({ originalRecipient: `${token}@summaries.meetingguard.ai` }, PROD_TEMPLATE)).toBe(token);
    expect(tokenFromEnvelope({ originalRecipient: `<${token}@summaries.meetingguard.ai>` }, PROD_TEMPLATE)).toBe(token);
  });

  it('lowercases an uppercase local part and domain before matching', () => {
    const upper = `${token.toUpperCase()}@SUMMARIES.MeetingGuard.AI`;
    expect(tokenFromEnvelope({ originalRecipient: upper }, PROD_TEMPLATE)).toBe(token);
  });

  it('requires the template domain exactly', () => {
    expect(tokenFromEnvelope({ originalRecipient: `${token}@meetingguard.ai` }, PROD_TEMPLATE)).toBeNull();
    expect(tokenFromEnvelope({ originalRecipient: `${token}@x.summaries.meetingguard.ai` }, PROD_TEMPLATE)).toBeNull();
    expect(tokenFromEnvelope({ originalRecipient: `${token}@summaries.meetingguard.ai.example.com` }, PROD_TEMPLATE)).toBeNull();
  });

  it('gives null for anything that is not exactly a valid token', () => {
    expect(tokenFromEnvelope({ originalRecipient: `${token}+tag@summaries.meetingguard.ai` }, PROD_TEMPLATE)).toBeNull();
    expect(tokenFromEnvelope({ originalRecipient: `${token.slice(1)}@summaries.meetingguard.ai` }, PROD_TEMPLATE)).toBeNull();
    expect(tokenFromEnvelope({ originalRecipient: `${token.slice(1)}1@summaries.meetingguard.ai` }, PROD_TEMPLATE)).toBeNull();
    expect(tokenFromEnvelope({ originalRecipient: `"${token}"@summaries.meetingguard.ai` }, PROD_TEMPLATE)).toBeNull();
    expect(tokenFromEnvelope({ originalRecipient: `Alice <${token}@summaries.meetingguard.ai>` }, PROD_TEMPLATE)).toBeNull();
    expect(tokenFromEnvelope({ originalRecipient: '' }, PROD_TEMPLATE)).toBeNull();
    expect(tokenFromEnvelope({ originalRecipient: null }, PROD_TEMPLATE)).toBeNull();
    expect(tokenFromEnvelope({}, PROD_TEMPLATE)).toBeNull();
  });

  it('ignores MailboxHash in production', () => {
    expect(tokenFromEnvelope({ mailboxHash: token }, PROD_TEMPLATE)).toBeNull();
    expect(tokenFromEnvelope({ originalRecipient: 'other@example.com', mailboxHash: token }, PROD_TEMPLATE)).toBeNull();
  });

  it('gives null while the template is empty', () => {
    expect(tokenFromEnvelope({ originalRecipient: `${token}@summaries.meetingguard.ai` }, '')).toBeNull();
  });

  it('routes on the envelope only: header addresses (To, Cc, Delivered-To) are ignored', () => {
    const headerToken = generateToken(() => new Uint8Array(16).fill(3));
    const headerAddress = `${headerToken}@summaries.meetingguard.ai`;
    // A provider payload carrying header addresses beside the envelope fields.
    const payload = {
      originalRecipient: `${token}@summaries.meetingguard.ai`,
      mailboxHash: '',
      To: headerAddress,
      Cc: headerAddress,
      DeliveredTo: headerAddress,
      Headers: [{ Name: 'Delivered-To', Value: headerAddress }],
    };
    expect(tokenFromEnvelope(payload, PROD_TEMPLATE)).toBe(token);
    // The envelope names someone else: the header token never routes.
    const strangerEnvelope = { ...payload, originalRecipient: 'someone@example.com' };
    expect(tokenFromEnvelope(strangerEnvelope, PROD_TEMPLATE)).toBeNull();
    // No envelope at all: still nothing from the headers.
    const noEnvelope = { ...payload, originalRecipient: undefined };
    expect(tokenFromEnvelope(noEnvelope, PROD_TEMPLATE)).toBeNull();
  });
});

describe('tokenFromEnvelope (development template)', () => {
  const token = generateToken(() => new Uint8Array(16).fill(11));
  const devAddress = `a1b2c3d4e5f60718+${token}@inbound.postmarkapp.com`;

  it('reads the part after "+" of the envelope recipient', () => {
    expect(tokenFromEnvelope({ originalRecipient: devAddress }, DEV_TEMPLATE)).toBe(token);
    expect(tokenFromEnvelope({ originalRecipient: devAddress.toUpperCase() }, DEV_TEMPLATE)).toBe(token);
  });

  it('falls back to MailboxHash only when OriginalRecipient is absent', () => {
    expect(tokenFromEnvelope({ mailboxHash: token }, DEV_TEMPLATE)).toBe(token);
    expect(tokenFromEnvelope({ originalRecipient: '', mailboxHash: token.toUpperCase() }, DEV_TEMPLATE)).toBe(token);
    expect(tokenFromEnvelope({ mailboxHash: 'not-a-token' }, DEV_TEMPLATE)).toBeNull();
    expect(tokenFromEnvelope({ mailboxHash: '' }, DEV_TEMPLATE)).toBeNull();
  });

  it('a present OriginalRecipient alone decides (wrong server hash, domain or tag is null)', () => {
    const other = { mailboxHash: token };
    expect(tokenFromEnvelope({ ...other, originalRecipient: `ffff0000ffff0000+${token}@inbound.postmarkapp.com` }, DEV_TEMPLATE)).toBeNull();
    expect(tokenFromEnvelope({ ...other, originalRecipient: `a1b2c3d4e5f60718+${token}@example.com` }, DEV_TEMPLATE)).toBeNull();
    expect(tokenFromEnvelope({ ...other, originalRecipient: 'a1b2c3d4e5f60718@inbound.postmarkapp.com' }, DEV_TEMPLATE)).toBeNull();
    expect(tokenFromEnvelope({ ...other, originalRecipient: 'a1b2c3d4e5f60718+nope@inbound.postmarkapp.com' }, DEV_TEMPLATE)).toBeNull();
  });

  it('never reads header addresses', () => {
    const payload = { originalRecipient: undefined, mailboxHash: '', To: devAddress, Cc: devAddress };
    expect(tokenFromEnvelope(payload, DEV_TEMPLATE)).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
// Mailboxes
// ---------------------------------------------------------------------------------------------

describe('normalizeMailbox', () => {
  it('lowercases a plain addr-spec and trims outer whitespace', () => {
    expect(normalizeMailbox('Alice.Tester@Example.COM')).toBe('alice.tester@example.com');
    expect(normalizeMailbox('  bob+recaps@example.org \n')).toBe('bob+recaps@example.org');
    expect(normalizeMailbox("o'hara@example.net")).toBe("o'hara@example.net");
  });

  it('converts the domain to IDNA ASCII', () => {
    const uUmlaut = String.fromCharCode(0xfc);
    expect(normalizeMailbox(`ana@m${uUmlaut}nchen.example`)).toBe('ana@xn--mnchen-3ya.example');
    expect(normalizeMailbox(`ana@M${uUmlaut.toUpperCase()}NCHEN.example`)).toBe('ana@xn--mnchen-3ya.example');
  });

  it('refuses display names, angle brackets, comments, quotes, groups and route syntax', () => {
    for (const input of [
      'Alice <alice@example.com>',
      '<alice@example.com>',
      'alice@example.com (Alice)',
      '(Alice) alice@example.com',
      '"alice"@example.com',
      '"a b"@example.com',
      'team: alice@example.com;',
      '@relay.example:alice@example.com',
      'alice@b@example.com',
      'alice,bob@example.com',
    ]) {
      expect(normalizeMailbox(input)).toBeNull();
    }
  });

  it('refuses malformed local parts and domains', () => {
    for (const input of [
      '',
      '@example.com',
      'alice@',
      'alice',
      '.alice@example.com',
      'alice.@example.com',
      'al..ice@example.com',
      'al ice@example.com',
      `${String.fromCharCode(0xf1)}and${String.fromCharCode(0xfa)}@example.com`,
      '=?utf-8?b?YWxpY2U=?=@example.com',
      `${'a'.repeat(65)}@example.com`,
      'alice@localhost',
      'alice@[192.0.2.1]',
      'alice@192.0.2.1',
      'alice@example.com.',
      'alice@-example.com',
      'alice@exa_mple.com',
      'alice@ex%41mple.com',
      'alice@exa..mple.com',
      'alice@xn--zz.com',
      'alice@exa\tmple.com',
    ]) {
      expect(normalizeMailbox(input)).toBeNull();
    }
    expect(normalizeMailbox(42)).toBeNull();
    expect(normalizeMailbox(null)).toBeNull();
  });

  /** A 250-character domain: 'abc@' plus it is exactly 254 characters, the contract maximum. */
  const DOMAIN_250 = `${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(63)}.${'e'.repeat(54)}.com`;
  const KELVIN_SIGN = String.fromCharCode(0x212a);
  const U_UMLAUT = String.fromCharCode(0xfc);
  const NBSP = String.fromCharCode(0xa0);
  const ZERO_WIDTH_SPACE = String.fromCharCode(0x200b);

  /** [input, expected output]; every non-null output must parse with the contract's summaryAddrSpecSchema. */
  const TRICKY: [string, string | null][] = [
    ['First/Last@Example.com', 'first/last@example.com'],
    ['a|b@example.com', 'a|b@example.com'],
    ['{x}@example.com', '{x}@example.com'],
    ['a`b@example.com', 'a`b@example.com'],
    ["!#$%&'*+-/=^_`{|}~@Example.com", "!#$%&'*+-/=^_`{|}~@example.com"],
    ['what?@example.com', 'what?@example.com'],
    ['x=?y@example.com', null],
    ['TAG+Recaps@Example.ORG', 'tag+recaps@example.org'],
    ['a.b.c@Sub.Example.co.uk', 'a.b.c@sub.example.co.uk'],
    ['a@b.c0', 'a@b.c0'],
    ['a@xn--p1ai.example', 'a@xn--p1ai.example'],
    [`ana@m${U_UMLAUT}nchen.example`, 'ana@xn--mnchen-3ya.example'],
    [`${'a'.repeat(64)}@example.com`, `${'a'.repeat(64)}@example.com`],
    [`${'a'.repeat(65)}@example.com`, null],
    [`abc@${DOMAIN_250}`, `abc@${DOMAIN_250}`],
    [`abcd@${DOMAIN_250}`, null],
    [`${KELVIN_SIGN}elvin@example.com`, null],
    [`a${NBSP}b@example.com`, null],
    [`a${ZERO_WIDTH_SPACE}b@example.com`, null],
    ['a"b@example.com', null],
    ['a\\b@example.com', null],
    ['a,b@example.com', null],
    ['a<b@example.com', null],
    ['a>b@example.com', null],
    ['a:b@example.com', null],
    ['a;b@example.com', null],
    ['a(b)@example.com', null],
    ['a[b]@example.com', null],
    ['a@b@example.com', null],
    ['a..b@example.com', null],
    ['.a@example.com', null],
    ['a.@example.com', null],
    ['a@example..com', null],
    ['a@example.123', null],
    ['a@-x.example.com', null],
  ];

  it.each(TRICKY)('normalizes %j to %j, and every output parses with summaryAddrSpecSchema', (input, expected) => {
    const output = normalizeMailbox(input);
    expect(output).toBe(expected);
    if (output !== null) expect(summaryAddrSpecSchema.safeParse(output).success).toBe(true);
  });

  it('every printable ASCII character, in the local part or the domain, gives null or a contract addr-spec', () => {
    const atext = "!#$%&'*+-/=?^_`{|}~";
    let accepted = 0;
    for (let code = 0x21; code <= 0x7e; code += 1) {
      const char = String.fromCharCode(code);
      for (const input of [`a${char}b@example.com`, `${char}@example.com`, `a@ex${char}ample.com`, `a@example.c${char}m`]) {
        const output = normalizeMailbox(input);
        if (output === null) continue;
        accepted += 1;
        expect(summaryAddrSpecSchema.safeParse(output).success).toBe(true);
      }
      if (atext.includes(char)) {
        expect(normalizeMailbox(`a${char}b@example.com`)).toBe(`a${char}b@example.com`);
        expect(normalizeMailbox(`${char}@example.com`)).toBe(`${char}@example.com`);
      }
    }
    expect(accepted).toBeGreaterThan(100);
  });

  it('a status and a set_mailboxes request built from normalized mailboxes parse with the contract', () => {
    const mailboxes = ['First/Last@Example.com', 'a|b@example.com', '{x}@example.com', 'a`b@example.com']
      .map((input) => normalizeMailbox(input))
      .filter((output): output is string => output !== null);
    expect(mailboxes).toHaveLength(4);
    const status = {
      enabled: true,
      allowed: true,
      ready: true,
      address: renderAddress(PROD_TEMPLATE, generateToken()),
      mailboxes,
      gmailRequests: [],
      inboxCount: 0,
      lastReceivedAt: null,
      lastRefused: null,
    };
    expect(summaryStatusResponseSchema.safeParse(status).success).toBe(true);
    expect(summaryActionRequestSchema.safeParse({ op: 'set_mailboxes', mailboxes }).success).toBe(true);
  });
});

describe('validateMailboxes', () => {
  it('normalizes and deduplicates in input order; the verified sign-in email is an ordinary entry', () => {
    expect(validateMailboxes([VERIFIED_EMAIL, 'bob@example.org', 'alice.tester@example.com'])).toEqual({
      ok: true,
      mailboxes: ['alice.tester@example.com', 'bob@example.org'],
    });
    expect(validateMailboxes([])).toEqual({ ok: true, mailboxes: [] });
  });

  it('allows at most 5 distinct mailboxes (duplicates do not count)', () => {
    const five = ['a@example.com', 'b@example.com', 'c@example.com', 'd@example.com', 'e@example.com'];
    expect(validateMailboxes(five)).toEqual({ ok: true, mailboxes: five });
    expect(validateMailboxes([...five, 'A@example.com', 'b@EXAMPLE.com'])).toEqual({ ok: true, mailboxes: five });
    expect(validateMailboxes([...five, 'f@example.com'])).toEqual({ ok: false, reason: 'too_many', index: null });
    expect(validateMailboxes(new Array(21).fill('a@example.com'))).toEqual({ ok: false, reason: 'too_many', index: null });
  });

  it('names the position of an invalid entry, never its content', () => {
    expect(validateMailboxes(['a@example.com', 'Bob <bob@example.com>'])).toEqual({ ok: false, reason: 'invalid_mailbox', index: 1 });
    expect(validateMailboxes(['a@example.com', 7])).toEqual({ ok: false, reason: 'invalid_mailbox', index: 1 });
    expect(validateMailboxes('a@example.com')).toEqual({ ok: false, reason: 'invalid_mailbox', index: null });
  });

  it('refuses a mailbox on the private-address domain', () => {
    const own = `${generateToken()}@summaries.meetingguard.ai`;
    expect(validateMailboxes(['a@example.com', own], { template: PROD_TEMPLATE })).toEqual({
      ok: false,
      reason: 'reserved_mailbox',
      index: 1,
    });
    expect(validateMailboxes(['a@example.com', own])).toMatchObject({ ok: true });
  });
});

// ---------------------------------------------------------------------------------------------
// Stored state helpers
// ---------------------------------------------------------------------------------------------

describe('parseSummaryUser and rotationDecision', () => {
  it('reads garbage leniently', () => {
    expect(parseSummaryUser(undefined)).toEqual({
      token: null,
      tokenHash: null,
      address: null,
      createdAt: null,
      rotationDay: null,
      rotationsToday: 0,
      mailboxes: [],
      gmailRequests: [],
      refusedDay: null,
      refusedCount: 0,
      lastReceivedAt: null,
      lastRefused: null,
      updatedAt: null,
    });
    const parsed = parseSummaryUser({ token: 'BAD', tokenHash: 'xyz', rotationsToday: -3, mailboxes: ['A@example.com', 'junk', 'a@example.com'] });
    expect(parsed.token).toBeNull();
    expect(parsed.tokenHash).toBeNull();
    expect(parsed.rotationsToday).toBe(0);
    expect(parsed.mailboxes).toEqual(['a@example.com']);
  });

  it('caps rotations per UTC day and resets at UTC midnight', () => {
    expect(rotationDecision(undefined, NOW)).toEqual({ allowed: true, rotationDay: '2026-11-11', rotationsToday: 1 });
    const user = { rotationDay: '2026-11-11', rotationsToday: SUMMARY_ADDRESS_LIMITS.rotationsPerUtcDay - 1 };
    expect(rotationDecision(user, NOW)).toEqual({ allowed: true, rotationDay: '2026-11-11', rotationsToday: 5 });
    expect(rotationDecision({ ...user, rotationsToday: 5 }, NOW)).toEqual({ allowed: false });
    expect(rotationDecision({ ...user, rotationsToday: 5 }, new Date('2026-11-12T00:00:00.000Z'))).toEqual({
      allowed: true,
      rotationDay: '2026-11-12',
      rotationsToday: 1,
    });
  });

  it('addressFor re-renders the stored token under the current template', () => {
    const token = generateToken();
    const user = parseSummaryUser({ token, tokenHash: tokenHash(token) });
    expect(addressFor(user, PROD_TEMPLATE)).toBe(`${token}@summaries.meetingguard.ai`);
    expect(addressFor(user, '')).toBeNull();
    expect(addressFor(parseSummaryUser({ token, tokenHash: tokenHash(generateToken()) }), PROD_TEMPLATE)).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------------------------

describe('createAddress', () => {
  it('writes the index doc and summaryUsers with the section 3 fields in one transaction', async () => {
    const h = harness();
    const result = await createAddress(UID, VERIFIED_EMAIL, h.deps);
    expect(result).toEqual({
      status: 'created',
      address: expect.stringMatching(/^[a-z2-7]{26}@summaries\.meetingguard\.ai$/),
      mailboxes: ['alice.tester@example.com'],
    });
    expect(h.db.transactions).toHaveLength(1);
    const user = h.db.user(UID);
    const token = String(user?.token);
    const hash = tokenHash(token);
    expect(result).toMatchObject({ address: `${token}@summaries.meetingguard.ai` });
    expect(h.db.docs.get(`${SUMMARY_ADDRESSES_COLLECTION}/${hash}`)).toEqual({ uid: UID, createdAt: NOW.toISOString() });
    expect(user).toEqual({
      token,
      tokenHash: hash,
      address: `${token}@summaries.meetingguard.ai`,
      createdAt: NOW.toISOString(),
      rotationDay: null,
      rotationsToday: 0,
      mailboxes: ['alice.tester@example.com'],
      gmailRequests: [],
      refusedDay: null,
      refusedCount: 0,
      lastReceivedAt: null,
      lastRefused: null,
      updatedAt: NOW.toISOString(),
    });
    expect(h.log.calls).toEqual([{ event: 'summaries.address.created', fields: { uid: UID, tok8: hash.slice(0, 8) } }]);
    await expect(resolveToken(hash, h.deps)).resolves.toBe(UID);
  });

  it('is idempotent: a second call returns the existing address and writes nothing new', async () => {
    const h = harness();
    const first = await createAddress(UID, VERIFIED_EMAIL, h.deps);
    const before = structuredClone([...h.db.docs.entries()]);
    const second = await createAddress(UID, 'someone.else@example.com', h.deps);
    expect(second).toEqual({ status: 'existing', address: (first as { address: string }).address, mailboxes: ['alice.tester@example.com'] });
    expect([...h.db.docs.entries()]).toEqual(before);
    expect(h.db.transactions[1]?.writes).toEqual([]);
    expect(h.db.indexHashesFor(UID)).toHaveLength(1);
  });

  it('two concurrent creates leave one address', async () => {
    const h = harness();
    const [a, b] = await Promise.all([createAddress(UID, VERIFIED_EMAIL, h.deps), createAddress(UID, VERIFIED_EMAIL, h.deps)]);
    expect([a.status, b.status].sort()).toEqual(['created', 'existing']);
    expect((a as { address: string }).address).toBe((b as { address: string }).address);
    expect(h.db.indexHashesFor(UID)).toHaveLength(1);
  });

  it('starts with no mailbox when there is no usable verified email', async () => {
    const h = harness();
    await expect(createAddress(UID, null, h.deps)).resolves.toMatchObject({ status: 'created', mailboxes: [] });
    const h2 = harness();
    await expect(createAddress(UID, 'Alice <alice@example.com>', h2.deps)).resolves.toMatchObject({ mailboxes: [] });
  });

  it('a sign-in email that does not normalize starts an empty list instead of failing', async () => {
    for (const email of ['"quoted"@example.com', `${String.fromCharCode(0x212a)}elvin@example.com`, 'a..b@example.com']) {
      const h = harness();
      await expect(createAddress(UID, email, h.deps)).resolves.toMatchObject({ status: 'created', mailboxes: [] });
      expect(h.db.user(UID)?.mailboxes).toEqual([]);
    }
  });

  it('seeds an RFC 5322 atext sign-in email and the result parses with the contract', async () => {
    const h = harness();
    const result = await createAddress(UID, 'First/Last@Example.com', h.deps);
    expect(result).toMatchObject({ status: 'created', mailboxes: ['first/last@example.com'] });
    const { address, mailboxes } = result as { address: string; mailboxes: string[] };
    expect(summaryAddrSpecSchema.safeParse(address).success).toBe(true);
    const status = {
      enabled: true,
      allowed: true,
      ready: true,
      address,
      mailboxes,
      gmailRequests: [],
      inboxCount: 0,
      lastReceivedAt: null,
      lastRefused: null,
    };
    expect(summaryStatusResponseSchema.safeParse(status).success).toBe(true);
    await expect(readSummaryUser(UID, h.deps)).resolves.toMatchObject({ mailboxes: ['first/last@example.com'] });
  });

  it('answers not_ready and writes nothing while the template is empty', async () => {
    const h = harness('');
    await expect(createAddress(UID, VERIFIED_EMAIL, h.deps)).resolves.toEqual({ status: 'not_ready' });
    expect(h.db.transactions).toHaveLength(0);
    expect(h.db.docs.size).toBe(0);
  });

  it('re-renders an existing address when the template changes (development to production)', async () => {
    const h = harness(DEV_TEMPLATE);
    const dev = await createAddress(UID, VERIFIED_EMAIL, h.deps);
    const token = String(h.db.user(UID)?.token);
    expect(dev).toMatchObject({ address: `a1b2c3d4e5f60718+${token}@inbound.postmarkapp.com` });
    const prod = await createAddress(UID, VERIFIED_EMAIL, { ...h.deps, template: PROD_TEMPLATE });
    expect(prod).toEqual({ status: 'existing', address: `${token}@summaries.meetingguard.ai`, mailboxes: ['alice.tester@example.com'] });
    expect(h.db.user(UID)?.address).toBe(`${token}@summaries.meetingguard.ai`);
    const routed = tokenFromEnvelope({ originalRecipient: `${token}@summaries.meetingguard.ai` }, PROD_TEMPLATE);
    await expect(resolveToken(tokenHash(String(routed)), h.deps)).resolves.toBe(UID);
  });

  it('never revives an address whose index doc is gone: it mints a fresh token and keeps the mailboxes', async () => {
    const h = harness();
    await createAddress(UID, VERIFIED_EMAIL, h.deps);
    await setMailboxes(UID, ['alice.tester@example.com', 'work@example.org'], h.deps);
    const oldHash = String(h.db.user(UID)?.tokenHash);
    h.db.docs.delete(`${SUMMARY_ADDRESSES_COLLECTION}/${oldHash}`);
    const again = await createAddress(UID, VERIFIED_EMAIL, h.deps);
    expect(again).toMatchObject({ status: 'created', mailboxes: ['alice.tester@example.com', 'work@example.org'] });
    const newHash = String(h.db.user(UID)?.tokenHash);
    expect(newHash).not.toBe(oldHash);
    await expect(resolveToken(oldHash, h.deps)).resolves.toBeNull();
    await expect(resolveToken(newHash, h.deps)).resolves.toBe(UID);
  });

  it('rejects a uid that could splice a Firestore path, without echoing it', async () => {
    const h = harness();
    await expect(createAddress('a/b', VERIFIED_EMAIL, h.deps)).rejects.toThrow('summaries.address: invalid uid');
    await expect(createAddress('', VERIFIED_EMAIL, h.deps)).rejects.toThrow('summaries.address: invalid uid');
    expect(h.db.transactions).toHaveLength(0);
  });
});

describe('regenerateAddress', () => {
  it('rotates in ONE transaction: old index deleted, new index written, user doc updated, rotation logged', async () => {
    const h = harness();
    await createAddress(UID, VERIFIED_EMAIL, h.deps);
    const oldToken = String(h.db.user(UID)?.token);
    const oldHash = tokenHash(oldToken);
    const txBefore = h.db.transactions.length;

    const result = await regenerateAddress(UID, h.deps);

    expect(h.db.transactions).toHaveLength(txBefore + 1);
    const newToken = String(h.db.user(UID)?.token);
    const newHash = tokenHash(newToken);
    expect(newToken).not.toBe(oldToken);
    expect(result).toEqual({ status: 'rotated', address: `${newToken}@summaries.meetingguard.ai`, rotationsToday: 1 });
    expect(h.db.transactions[txBefore]).toEqual({
      reads: [`${SUMMARY_USERS_COLLECTION}/${UID}`, `${SUMMARY_ADDRESSES_COLLECTION}/${oldHash}`, `${SUMMARY_ADDRESSES_COLLECTION}/${newHash}`],
      writes: [
        `delete:${SUMMARY_ADDRESSES_COLLECTION}/${oldHash}`,
        `set:${SUMMARY_ADDRESSES_COLLECTION}/${newHash}`,
        `set:${SUMMARY_USERS_COLLECTION}/${UID}`,
      ],
    });
    expect(h.db.indexHashesFor(UID)).toEqual([newHash]);
    expect(h.db.user(UID)).toMatchObject({
      tokenHash: newHash,
      address: `${newToken}@summaries.meetingguard.ai`,
      rotationDay: '2026-11-11',
      rotationsToday: 1,
      createdAt: NOW.toISOString(),
      mailboxes: ['alice.tester@example.com'],
    });
    expect(h.log.calls.at(-1)).toEqual({
      event: 'summaries.address.rotated',
      fields: { uid: UID, oldTok8: oldHash.slice(0, 8), tok8: newHash.slice(0, 8), rotationsToday: 1 },
    });
  });

  it('a regenerated token no longer resolves; the new one does', async () => {
    const h = harness();
    await createAddress(UID, VERIFIED_EMAIL, h.deps);
    const oldAddress = String(h.db.user(UID)?.address);
    await regenerateAddress(UID, h.deps);
    const newAddress = String(h.db.user(UID)?.address);

    const oldToken = tokenFromEnvelope({ originalRecipient: oldAddress }, PROD_TEMPLATE);
    expect(oldToken).not.toBeNull();
    await expect(resolveToken(tokenHash(String(oldToken)), h.deps)).resolves.toBeNull();
    const newToken = tokenFromEnvelope({ originalRecipient: newAddress.toUpperCase() }, PROD_TEMPLATE);
    await expect(resolveToken(tokenHash(String(newToken)), h.deps)).resolves.toBe(UID);
  });

  it('refuses the sixth rotation in a UTC day without writing, and allows one again after UTC midnight', async () => {
    const h = harness();
    await createAddress(UID, VERIFIED_EMAIL, h.deps);
    for (let rotation = 1; rotation <= 5; rotation += 1) {
      await expect(regenerateAddress(UID, h.deps)).resolves.toMatchObject({ status: 'rotated', rotationsToday: rotation });
    }
    const before = structuredClone([...h.db.docs.entries()]);
    h.setNow(new Date('2026-11-11T23:59:59.000Z'));
    await expect(regenerateAddress(UID, h.deps)).resolves.toEqual({ status: 'rate_limited' });
    expect([...h.db.docs.entries()]).toEqual(before);
    expect(h.db.transactions.at(-1)?.writes).toEqual([]);
    expect(h.log.calls.at(-1)).toEqual({ event: 'summaries.address.rotation_limited', fields: { uid: UID } });

    h.setNow(new Date('2026-11-12T00:00:01.000Z'));
    await expect(regenerateAddress(UID, h.deps)).resolves.toMatchObject({ status: 'rotated', rotationsToday: 1 });
    expect(h.db.user(UID)).toMatchObject({ rotationDay: '2026-11-12', rotationsToday: 1 });
  });

  it('six concurrent rotations: five succeed, one is refused, one index doc remains', async () => {
    const h = harness();
    await createAddress(UID, VERIFIED_EMAIL, h.deps);
    const results = await Promise.all(Array.from({ length: 6 }, () => regenerateAddress(UID, h.deps)));
    expect(results.filter((result) => result.status === 'rotated')).toHaveLength(5);
    expect(results.filter((result) => result.status === 'rate_limited')).toHaveLength(1);
    expect(h.db.indexHashesFor(UID)).toEqual([String(h.db.user(UID)?.tokenHash)]);
  });

  it('a failed commit changes nothing: the old address keeps resolving and nothing is logged', async () => {
    const h = harness();
    await createAddress(UID, VERIFIED_EMAIL, h.deps);
    const oldHash = String(h.db.user(UID)?.tokenHash);
    const logged = h.log.calls.length;
    h.db.failNextCommit = new Error('unavailable');
    await expect(regenerateAddress(UID, h.deps)).rejects.toThrow('unavailable');
    expect(h.db.indexHashesFor(UID)).toEqual([oldHash]);
    await expect(resolveToken(oldHash, h.deps)).resolves.toBe(UID);
    expect(h.log.calls).toHaveLength(logged);
  });

  it('resets the Gmail requests and the refused counter that belonged to the old address', async () => {
    const h = harness();
    await createAddress(UID, VERIFIED_EMAIL, h.deps);
    const path = `${SUMMARY_USERS_COLLECTION}/${UID}`;
    h.db.docs.set(path, {
      ...h.db.docs.get(path),
      gmailRequests: [{ requester: 'alice.tester@example.com' }],
      refusedDay: '2026-11-11',
      refusedCount: 40,
      lastReceivedAt: '2026-11-10T10:00:00.000Z',
    });
    await regenerateAddress(UID, h.deps);
    expect(h.db.user(UID)).toMatchObject({
      gmailRequests: [],
      refusedDay: null,
      refusedCount: 0,
      lastReceivedAt: '2026-11-10T10:00:00.000Z',
    });
  });

  it('answers no_address before a create and not_ready while the template is empty', async () => {
    const h = harness();
    await expect(regenerateAddress(UID, h.deps)).resolves.toEqual({ status: 'no_address' });
    expect(h.db.docs.size).toBe(0);
    await createAddress(UID, VERIFIED_EMAIL, h.deps);
    const txCount = h.db.transactions.length;
    await expect(regenerateAddress(UID, { ...h.deps, template: '' })).resolves.toEqual({ status: 'not_ready' });
    expect(h.db.transactions).toHaveLength(txCount);
  });
});

describe('setMailboxes', () => {
  it('replaces the list, normalized and deduplicated, in one transaction', async () => {
    const h = harness();
    await createAddress(UID, VERIFIED_EMAIL, h.deps);
    const result = await setMailboxes(UID, ['Work@Example.org', VERIFIED_EMAIL, 'work@example.org'], h.deps);
    expect(result).toEqual({ status: 'saved', mailboxes: ['work@example.org', 'alice.tester@example.com'] });
    expect(h.db.user(UID)?.mailboxes).toEqual(['work@example.org', 'alice.tester@example.com']);
    expect(h.db.transactions.at(-1)?.writes).toEqual([`set:${SUMMARY_USERS_COLLECTION}/${UID}`]);
    expect(h.log.calls.at(-1)).toEqual({ event: 'summaries.mailboxes.saved', fields: { uid: UID, count: 2 } });
  });

  it('allows an empty list', async () => {
    const h = harness();
    await createAddress(UID, VERIFIED_EMAIL, h.deps);
    await expect(setMailboxes(UID, [], h.deps)).resolves.toEqual({ status: 'saved', mailboxes: [] });
  });

  it('refuses an invalid, reserved or oversized list before any transaction', async () => {
    const h = harness();
    await createAddress(UID, VERIFIED_EMAIL, h.deps);
    const txCount = h.db.transactions.length;
    await expect(setMailboxes(UID, ['ok@example.com', 'Eve <eve@example.com>'], h.deps)).resolves.toEqual({
      status: 'invalid',
      reason: 'invalid_mailbox',
      index: 1,
    });
    await expect(setMailboxes(UID, [String(h.db.user(UID)?.address)], h.deps)).resolves.toEqual({
      status: 'invalid',
      reason: 'reserved_mailbox',
      index: 0,
    });
    const six = ['a', 'b', 'c', 'd', 'e', 'f'].map((name) => `${name}@example.com`);
    await expect(setMailboxes(UID, six, h.deps)).resolves.toEqual({ status: 'invalid', reason: 'too_many', index: null });
    expect(h.db.transactions).toHaveLength(txCount);
    expect(h.db.user(UID)?.mailboxes).toEqual(['alice.tester@example.com']);
  });

  it('answers no_address and creates nothing before a create', async () => {
    const h = harness();
    await expect(setMailboxes(UID, ['a@example.com'], h.deps)).resolves.toEqual({ status: 'no_address' });
    expect(h.db.docs.size).toBe(0);
  });
});

describe('resolveToken', () => {
  it('gives null for a malformed hash without reading Firestore', async () => {
    const h = harness();
    await expect(resolveToken('not-a-hash', h.deps)).resolves.toBeNull();
    await expect(resolveToken(generateToken(), h.deps)).resolves.toBeNull();
    expect(h.db.directReads).toEqual([]);
  });

  it('gives null for an unknown hash', async () => {
    const h = harness();
    await expect(resolveToken(tokenHash(generateToken()), h.deps)).resolves.toBeNull();
  });

  it('gives null for a stale index doc the user doc no longer names (a restored backup)', async () => {
    const h = harness();
    await createAddress(UID, VERIFIED_EMAIL, h.deps);
    const staleHash = tokenHash(generateToken());
    h.db.docs.set(`${SUMMARY_ADDRESSES_COLLECTION}/${staleHash}`, { uid: UID, createdAt: NOW.toISOString() });
    await expect(resolveToken(staleHash, h.deps)).resolves.toBeNull();
    // An index doc pointing at a uid with no summaryUsers doc resolves to nobody either.
    const orphanHash = tokenHash(generateToken());
    h.db.docs.set(`${SUMMARY_ADDRESSES_COLLECTION}/${orphanHash}`, { uid: OTHER_UID, createdAt: NOW.toISOString() });
    await expect(resolveToken(orphanHash, h.deps)).resolves.toBeNull();
  });

  it('keeps two accounts apart', async () => {
    const h = harness();
    await createAddress(UID, VERIFIED_EMAIL, h.deps);
    await createAddress(OTHER_UID, 'bob@example.org', h.deps);
    await expect(resolveToken(String(h.db.user(UID)?.tokenHash), h.deps)).resolves.toBe(UID);
    await expect(resolveToken(String(h.db.user(OTHER_UID)?.tokenHash), h.deps)).resolves.toBe(OTHER_UID);
  });
});

describe('deleteAddressDocs (disconnect) and readSummaryUser', () => {
  it('deletes the index doc and leaves only a tombstone, in one transaction; the address stops resolving; idempotent', async () => {
    const h = harness();
    await createAddress(UID, VERIFIED_EMAIL, h.deps);
    await regenerateAddress(UID, h.deps);
    const hash = String(h.db.user(UID)?.tokenHash);
    await expect(readSummaryUser(UID, h.deps)).resolves.toMatchObject({ tokenHash: hash, mailboxes: ['alice.tester@example.com'] });
    const later = new Date('2026-11-11T10:00:00.000Z');
    h.setNow(later);

    await expect(deleteAddressDocs(UID, h.deps, { mode: 'disconnect' })).resolves.toEqual({ deleted: true });

    expect(h.db.transactions.at(-1)?.writes).toEqual([
      `delete:${SUMMARY_ADDRESSES_COLLECTION}/${hash}`,
      `set:${SUMMARY_USERS_COLLECTION}/${UID}`,
    ]);
    // Only the counters: no token, hash, address, mailboxes, Gmail requests or refusals.
    expect(h.db.user(UID)).toEqual({ rotationDay: '2026-11-11', rotationsToday: 1, updatedAt: later.toISOString() });
    expect(h.db.indexHashesFor(UID)).toEqual([]);
    expect(h.db.docs.size).toBe(1);
    expect(isAddressTombstone(parseSummaryUser(h.db.user(UID)))).toBe(true);
    await expect(resolveToken(hash, h.deps)).resolves.toBeNull();
    await expect(readSummaryUser(UID, h.deps)).resolves.toBeNull();
    expect(h.log.calls.at(-1)).toEqual({
      event: 'summaries.address.deleted',
      fields: { uid: UID, tok8: hash.slice(0, 8), mode: 'disconnect' },
    });

    const logged = h.log.calls.length;
    await expect(deleteAddressDocs(UID, h.deps, { mode: 'disconnect' })).resolves.toEqual({ deleted: false });
    expect(h.db.transactions.at(-1)?.writes).toEqual([]);
    expect(h.db.user(UID)).toEqual({ rotationDay: '2026-11-11', rotationsToday: 1, updatedAt: later.toISOString() });
    expect(h.log.calls).toHaveLength(logged);
  });

  it('a tombstone is "no address" for status, resolve, set_mailboxes and regenerate', async () => {
    const h = harness();
    await createAddress(UID, VERIFIED_EMAIL, h.deps);
    const hash = String(h.db.user(UID)?.tokenHash);
    await deleteAddressDocs(UID, h.deps, { mode: 'disconnect' });
    // Even a restored index doc that still maps the old hash to this uid resolves to nobody.
    h.db.docs.set(`${SUMMARY_ADDRESSES_COLLECTION}/${hash}`, { uid: UID, createdAt: NOW.toISOString() });
    await expect(resolveToken(hash, h.deps)).resolves.toBeNull();
    await expect(readSummaryUser(UID, h.deps)).resolves.toBeNull();
    const tombstone = parseSummaryUser(h.db.user(UID));
    expect(addressFor(tombstone, PROD_TEMPLATE)).toBeNull();
    expect(tombstone.mailboxes).toEqual([]);
    await expect(setMailboxes(UID, ['a@example.com'], h.deps)).resolves.toEqual({ status: 'no_address' });
    await expect(regenerateAddress(UID, h.deps)).resolves.toEqual({ status: 'no_address' });
    expect(h.db.user(UID)).toEqual({ rotationDay: null, rotationsToday: 0, updatedAt: NOW.toISOString() });
  });

  it('five regenerations, disconnect: create is refused the same UTC day and allowed the next', async () => {
    const h = harness();
    await createAddress(UID, VERIFIED_EMAIL, h.deps);
    for (let rotation = 1; rotation <= 5; rotation += 1) {
      await expect(regenerateAddress(UID, h.deps)).resolves.toMatchObject({ status: 'rotated', rotationsToday: rotation });
    }
    await expect(deleteAddressDocs(UID, h.deps, { mode: 'disconnect' })).resolves.toEqual({ deleted: true });
    expect(h.db.user(UID)).toEqual({ rotationDay: '2026-11-11', rotationsToday: 5, updatedAt: NOW.toISOString() });

    h.setNow(new Date('2026-11-11T23:59:59.000Z'));
    const before = structuredClone([...h.db.docs.entries()]);
    await expect(createAddress(UID, VERIFIED_EMAIL, h.deps)).resolves.toEqual({ status: 'rate_limited' });
    expect([...h.db.docs.entries()]).toEqual(before);
    expect(h.db.transactions.at(-1)?.writes).toEqual([]);
    expect(h.log.calls.at(-1)).toEqual({ event: 'summaries.address.rotation_limited', fields: { uid: UID, afterDisconnect: true } });

    const nextDay = new Date('2026-11-12T00:00:01.000Z');
    h.setNow(nextDay);
    const created = await createAddress(UID, VERIFIED_EMAIL, h.deps);
    expect(created).toMatchObject({ status: 'created', mailboxes: ['alice.tester@example.com'] });
    const token = String(h.db.user(UID)?.token);
    const hash = tokenHash(token);
    expect(h.db.user(UID)).toEqual({
      token,
      tokenHash: hash,
      address: `${token}@summaries.meetingguard.ai`,
      createdAt: nextDay.toISOString(),
      rotationDay: '2026-11-12',
      rotationsToday: 1,
      mailboxes: ['alice.tester@example.com'],
      gmailRequests: [],
      refusedDay: null,
      refusedCount: 0,
      lastReceivedAt: null,
      lastRefused: null,
      updatedAt: nextDay.toISOString(),
    });
    expect(h.db.indexHashesFor(UID)).toEqual([hash]);
    await expect(resolveToken(hash, h.deps)).resolves.toBe(UID);
    expect(h.log.calls.at(-1)).toEqual({
      event: 'summaries.address.created',
      fields: { uid: UID, tok8: hash.slice(0, 8), rotationsToday: 1 },
    });
  });

  it('a create after disconnect counts as a rotation, so the day still allows five new addresses in all', async () => {
    const h = harness();
    await createAddress(UID, VERIFIED_EMAIL, h.deps);
    await regenerateAddress(UID, h.deps);
    await regenerateAddress(UID, h.deps);
    await deleteAddressDocs(UID, h.deps, { mode: 'disconnect' });
    await expect(createAddress(UID, VERIFIED_EMAIL, h.deps)).resolves.toMatchObject({ status: 'created' });
    expect(h.db.user(UID)).toMatchObject({ rotationDay: '2026-11-11', rotationsToday: 3 });
    await expect(regenerateAddress(UID, h.deps)).resolves.toMatchObject({ status: 'rotated', rotationsToday: 4 });
    await deleteAddressDocs(UID, h.deps, { mode: 'disconnect' });
    await expect(createAddress(UID, VERIFIED_EMAIL, h.deps)).resolves.toMatchObject({ status: 'created' });
    await expect(regenerateAddress(UID, h.deps)).resolves.toEqual({ status: 'rate_limited' });
    await deleteAddressDocs(UID, h.deps, { mode: 'disconnect' });
    await expect(createAddress(UID, VERIFIED_EMAIL, h.deps)).resolves.toEqual({ status: 'rate_limited' });
  });

  it('two concurrent creates on a tombstone leave one address and count one rotation', async () => {
    const h = harness();
    await createAddress(UID, VERIFIED_EMAIL, h.deps);
    await deleteAddressDocs(UID, h.deps, { mode: 'disconnect' });
    const [a, b] = await Promise.all([createAddress(UID, VERIFIED_EMAIL, h.deps), createAddress(UID, VERIFIED_EMAIL, h.deps)]);
    expect([a.status, b.status].sort()).toEqual(['created', 'existing']);
    expect(h.db.indexHashesFor(UID)).toHaveLength(1);
    expect(h.db.user(UID)).toMatchObject({ rotationsToday: 1 });
  });

  it('rewrites a tombstone that carries stray fields into a clean one', async () => {
    const h = harness();
    h.db.docs.set(`${SUMMARY_USERS_COLLECTION}/${UID}`, {
      rotationDay: '2026-11-11',
      rotationsToday: 2,
      mailboxes: ['alice.tester@example.com'],
      lastRefused: { reason: 'unsigned' },
    });
    await expect(deleteAddressDocs(UID, h.deps, { mode: 'disconnect' })).resolves.toEqual({ deleted: false });
    expect(h.db.user(UID)).toEqual({ rotationDay: '2026-11-11', rotationsToday: 2, updatedAt: NOW.toISOString() });
  });

  it('answers deleted false and writes nothing when there was never an address', async () => {
    const h = harness();
    await expect(deleteAddressDocs(UID, h.deps, { mode: 'disconnect' })).resolves.toEqual({ deleted: false });
    expect(h.db.docs.size).toBe(0);
    expect(h.db.transactions.at(-1)?.writes).toEqual([]);
  });
});

describe('deleteAddressDocs (account deletion)', () => {
  it('removes the index doc and summaryUsers completely, tombstone counters included', async () => {
    const h = harness();
    await createAddress(UID, VERIFIED_EMAIL, h.deps);
    await regenerateAddress(UID, h.deps);
    await createAddress(OTHER_UID, 'bob@example.org', h.deps);
    const hash = String(h.db.user(UID)?.tokenHash);

    await expect(deleteAddressDocs(UID, h.deps, { mode: 'account_deletion' })).resolves.toEqual({ deleted: true });

    expect(h.db.transactions.at(-1)?.writes).toEqual([
      `delete:${SUMMARY_ADDRESSES_COLLECTION}/${hash}`,
      `delete:${SUMMARY_USERS_COLLECTION}/${UID}`,
    ]);
    expect(h.db.user(UID)).toBeUndefined();
    expect(h.db.indexHashesFor(UID)).toEqual([]);
    expect([...h.db.docs.keys()].filter((path) => path.includes(UID))).toEqual([]);
    await expect(resolveToken(hash, h.deps)).resolves.toBeNull();
    await expect(readSummaryUser(UID, h.deps)).resolves.toBeNull();
    // The other account is untouched.
    await expect(resolveToken(String(h.db.user(OTHER_UID)?.tokenHash), h.deps)).resolves.toBe(OTHER_UID);
    expect(h.log.calls.at(-1)).toEqual({
      event: 'summaries.address.deleted',
      fields: { uid: UID, tok8: hash.slice(0, 8), mode: 'account_deletion' },
    });

    await expect(deleteAddressDocs(UID, h.deps, { mode: 'account_deletion' })).resolves.toEqual({ deleted: false });
    expect(h.db.transactions.at(-1)?.writes).toEqual([]);
  });

  it('removes a disconnect tombstone, so a later create starts from zero', async () => {
    const h = harness();
    await createAddress(UID, VERIFIED_EMAIL, h.deps);
    for (let rotation = 0; rotation < 5; rotation += 1) await regenerateAddress(UID, h.deps);
    await deleteAddressDocs(UID, h.deps, { mode: 'disconnect' });
    expect(h.db.user(UID)).toMatchObject({ rotationsToday: 5 });
    const logged = h.log.calls.length;

    await expect(deleteAddressDocs(UID, h.deps, { mode: 'account_deletion' })).resolves.toEqual({ deleted: false });

    expect(h.db.transactions.at(-1)?.writes).toEqual([`delete:${SUMMARY_USERS_COLLECTION}/${UID}`]);
    expect(h.db.docs.size).toBe(0);
    expect(h.log.calls).toHaveLength(logged);
    await expect(createAddress(UID, VERIFIED_EMAIL, h.deps)).resolves.toMatchObject({ status: 'created' });
    expect(h.db.user(UID)).toMatchObject({ rotationDay: null, rotationsToday: 0 });
  });
});

describe('logging', () => {
  it('no log call contains an address, a mailbox, a full token or a full tokenHash', async () => {
    const h = harness();
    const secrets: string[] = [];
    const remember = (): void => {
      const user = h.db.user(UID);
      secrets.push(String(user?.token), String(user?.tokenHash), String(user?.address));
    };
    await createAddress(UID, VERIFIED_EMAIL, h.deps);
    remember();
    for (let rotation = 0; rotation < 6; rotation += 1) {
      await regenerateAddress(UID, h.deps);
      remember();
    }
    await setMailboxes(UID, ['work@example.org', VERIFIED_EMAIL], h.deps);
    await setMailboxes(UID, ['Eve <eve@example.com>'], h.deps);
    await deleteAddressDocs(UID, h.deps, { mode: 'disconnect' });
    await createAddress(UID, VERIFIED_EMAIL, h.deps);
    await deleteAddressDocs(UID, h.deps, { mode: 'account_deletion' });
    // The default logger path (firebase-functions/logger) too.
    const { logger: _ignored, ...withoutLogger } = h.deps;
    await createAddress(OTHER_UID, 'bob@example.org', withoutLogger);
    await regenerateAddress(OTHER_UID, withoutLogger);
    const other = h.db.user(OTHER_UID);
    secrets.push(String(other?.token), String(other?.tokenHash), String(other?.address));

    const infoMock = functionsLogger.info as unknown as jest.Mock;
    expect(infoMock).toHaveBeenCalledWith('summaries.address.rotated', expect.objectContaining({ uid: OTHER_UID }));
    const everything = JSON.stringify([
      h.log.calls,
      infoMock.mock.calls,
      (functionsLogger.warn as unknown as jest.Mock).mock.calls,
      (functionsLogger.error as unknown as jest.Mock).mock.calls,
      (functionsLogger.debug as unknown as jest.Mock).mock.calls,
    ]);
    expect(h.log.calls.map((call) => call.event)).toEqual([
      'summaries.address.created',
      'summaries.address.rotated',
      'summaries.address.rotated',
      'summaries.address.rotated',
      'summaries.address.rotated',
      'summaries.address.rotated',
      'summaries.address.rotation_limited',
      'summaries.mailboxes.saved',
      'summaries.address.deleted',
      'summaries.address.rotation_limited',
    ]);
    expect(everything).not.toContain('@');
    expect(everything).not.toContain('example');
    expect(everything).not.toContain('meetingguard.ai');
    for (const secret of secrets) {
      expect(secret.length).toBeGreaterThan(20);
      expect(everything).not.toContain(secret);
    }
    // tok8 is what the logs carry instead.
    expect(everything).toContain(String(other?.tokenHash).slice(0, 8));
  });
});

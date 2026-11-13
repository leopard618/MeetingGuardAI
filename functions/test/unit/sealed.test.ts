/**
 * Field encryption for meeting summaries (functions/src/shared/sealed.ts): keyring parsing,
 * AES-256-GCM seal and open bound to the summary AAD, HKDF purpose separation, key rotation and
 * the keyed content digest. Synthetic keys and text only.
 */
import { createDecipheriv, createHmac, hkdfSync, randomBytes } from 'node:crypto';
import { inspect } from 'node:util';

import {
  HKDF_SALT,
  SUMMARY_CONTENT_PURPOSE,
  SUMMARY_DIGEST_PURPOSE,
  SealedError,
  contentDigest,
  open,
  parseKeyring,
  seal,
  summaryAad,
  type Keyring,
  type SealedErrorReason,
} from '../../src/shared/sealed';

/** 32 bytes 0x00..0x1f, base64. Synthetic, used for the pinned vectors below. */
const FIXED_KEY = Buffer.from(Array.from({ length: 32 }, (_, i) => i)).toString('base64');
const KEY_A = randomBytes(32).toString('base64');
const KEY_B = randomBytes(32).toString('base64');

const UID = 'synthetic-uid-0001';
const SUMMARY_ID = 'a'.repeat(64);
const AAD = summaryAad({ uid: UID, summaryId: SUMMARY_ID });
const TEXT = 'Synthetic recap. Decisions: ship the beta Friday. Action items: Alex drafts the release notes.';

function reasonOf(fn: () => unknown): SealedErrorReason | 'no_error' | 'other_error' {
  try {
    fn();
    return 'no_error';
  } catch (error) {
    return error instanceof SealedError ? error.reason : 'other_error';
  }
}

function caught(fn: () => unknown): SealedError {
  try {
    fn();
  } catch (error) {
    if (error instanceof SealedError) return error;
    throw error;
  }
  throw new Error('expected a SealedError');
}

/** Splits a blob into its five parts with the binary ones decoded. */
function explode(blob: string): { version: string; keyId: string; iv: Buffer; ct: Buffer; tag: Buffer } {
  const [version, keyId, iv, ct, tag] = blob.split('.') as [string, string, string, string, string];
  return {
    version,
    keyId,
    iv: Buffer.from(iv, 'base64url'),
    ct: Buffer.from(ct, 'base64url'),
    tag: Buffer.from(tag, 'base64url'),
  };
}

function implode(parts: { version: string; keyId: string; iv: Buffer; ct: Buffer; tag: Buffer }): string {
  return [
    parts.version,
    parts.keyId,
    parts.iv.toString('base64url'),
    parts.ct.toString('base64url'),
    parts.tag.toString('base64url'),
  ].join('.');
}

function flipBit(bytes: Buffer, index: number, bit = 0): Buffer {
  const copy = Buffer.from(bytes);
  copy[index] = (copy[index] ?? 0) ^ (1 << bit);
  return copy;
}

describe('summaryAad', () => {
  it('is exactly meetingSummary:<uid>:<summaryId>', () => {
    expect(summaryAad({ uid: 'u1', summaryId: 'abc123' })).toBe('meetingSummary:u1:abc123');
    expect(AAD).toBe(`meetingSummary:${UID}:${SUMMARY_ID}`);
  });

  it('rejects an empty or oversize uid and a summaryId that is empty, too long or holds a colon', () => {
    expect(reasonOf(() => summaryAad({ uid: '', summaryId: 'x' }))).toBe('bad_aad');
    expect(reasonOf(() => summaryAad({ uid: 'u'.repeat(129), summaryId: 'x' }))).toBe('bad_aad');
    expect(reasonOf(() => summaryAad({ uid: 'u', summaryId: '' }))).toBe('bad_aad');
    expect(reasonOf(() => summaryAad({ uid: 'u', summaryId: 'x'.repeat(129) }))).toBe('bad_aad');
    expect(reasonOf(() => summaryAad({ uid: 'u', summaryId: 'a:b' }))).toBe('bad_aad');
    expect(reasonOf(() => summaryAad({ uid: 'u', summaryId: 'a/b' }))).toBe('bad_aad');
  });
});

describe('parseKeyring', () => {
  it('parses one key and a rotated ring, first key primary', () => {
    const one = parseKeyring(`k1:${KEY_A}`);
    expect(one.primaryId).toBe('k1');
    expect(one.keyIds).toEqual(['k1']);
    const two = parseKeyring(`k2:${KEY_B},k1:${KEY_A}`);
    expect(two.primaryId).toBe('k2');
    expect(two.keyIds).toEqual(['k2', 'k1']);
    expect(parseKeyring(`k10:${KEY_B},k9:${KEY_A}`).primaryId).toBe('k10');
  });

  it('keeps key material out of the object, its JSON and its inspect output', () => {
    const keyring = parseKeyring(`k2:${KEY_B},k1:${KEY_A}`);
    expect(Object.keys(keyring).sort()).toEqual(['keyIds', 'primaryId']);
    for (const shown of [JSON.stringify(keyring), inspect(keyring, { depth: 10, showHidden: true })]) {
      expect(shown).not.toContain(KEY_A);
      expect(shown).not.toContain(KEY_B);
      expect(shown).not.toContain(Buffer.from(KEY_A, 'base64').toString('hex'));
    }
    expect(Object.isFrozen(keyring)).toBe(true);
  });

  const shortKey = randomBytes(16).toString('base64');
  const longKey = randomBytes(48).toString('base64');
  const urlKey = Buffer.from(Array.from({ length: 32 }, () => 0xfb)).toString('base64url');
  const unpadded = KEY_A.replace(/=+$/, '');
  // 32 bytes of base64 end in "x=" where x carries 2 spare low bits; flipping one keeps the bytes.
  const STD_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const nonCanonical = `${KEY_A.slice(0, 42)}${STD_ALPHABET.charAt(STD_ALPHABET.indexOf(KEY_A.charAt(42)) ^ 1)}=`;

  it('the non-canonical fixture decodes to the same 32 bytes (so only canonical form rejects it)', () => {
    expect(nonCanonical).not.toBe(KEY_A);
    expect(Buffer.from(nonCanonical, 'base64').equals(Buffer.from(KEY_A, 'base64'))).toBe(true);
  });

  const malformed: Array<[string, string, SealedErrorReason]> = [
    ['empty', '', 'keyring_empty'],
    ['trailing newline', `k1:${KEY_A}\n`, 'keyring_whitespace'],
    ['CRLF', `k1:${KEY_A}\r\n`, 'keyring_whitespace'],
    ['leading space', ` k1:${KEY_A}`, 'keyring_whitespace'],
    ['space after comma', `k2:${KEY_B}, k1:${KEY_A}`, 'keyring_whitespace'],
    ['tab inside', `k1:${KEY_A.slice(0, 10)}\t${KEY_A.slice(10)}`, 'keyring_whitespace'],
    ['missing id', KEY_A, 'keyring_malformed'],
    ['trailing comma', `k1:${KEY_A},`, 'keyring_malformed'],
    ['empty middle entry', `k2:${KEY_B},,k1:${KEY_A}`, 'keyring_malformed'],
    ['empty id', `:${KEY_A}`, 'keyring_bad_id'],
    ['upper-case id', `K1:${KEY_A}`, 'keyring_bad_id'],
    ['zero id', `k0:${KEY_A}`, 'keyring_bad_id'],
    ['leading zero id', `k01:${KEY_A}`, 'keyring_bad_id'],
    ['word id', `key1:${KEY_A}`, 'keyring_bad_id'],
    ['id with dot', `k1.1:${KEY_A}`, 'keyring_bad_id'],
    ['duplicate id', `k1:${KEY_A},k1:${KEY_B}`, 'keyring_duplicate_id'],
    ['duplicate id, same key', `k1:${KEY_A},k2:${KEY_B},k1:${KEY_A}`, 'keyring_duplicate_id'],
    ['empty key', 'k1:', 'keyring_bad_base64'],
    ['base64url key', `k1:${urlKey}`, 'keyring_bad_base64'],
    ['unpadded key', `k1:${unpadded}`, 'keyring_bad_base64'],
    ['non-canonical key', `k1:${nonCanonical}`, 'keyring_bad_base64'],
    ['junk characters', `k1:${KEY_A.slice(0, 40)}!!!=`, 'keyring_bad_base64'],
    ['16-byte key', `k1:${shortKey}`, 'keyring_bad_length'],
    ['48-byte key', `k1:${longKey}`, 'keyring_bad_length'],
    ['bad second entry', `k2:${KEY_B},k1:${shortKey}`, 'keyring_bad_length'],
  ];

  it.each(malformed)('rejects %s', (_label, secret, reason) => {
    expect(reasonOf(() => parseKeyring(secret))).toBe(reason);
  });

  it('never echoes key material in errors', () => {
    const secrets = malformed.map(([, secret]) => secret);
    for (const secret of secrets) {
      const error = caught(() => parseKeyring(secret));
      const shown = [error.message, String(error), inspect(error), JSON.stringify(error)].join('\n');
      for (const piece of secret.split(/[,:\s]/)) {
        if (piece.length >= 8) expect(shown).not.toContain(piece);
      }
      expect(shown).not.toContain(KEY_A.slice(0, 12));
      expect(shown).not.toContain(KEY_B.slice(0, 12));
    }
  });

  it('rejects a non-string value', () => {
    expect(reasonOf(() => parseKeyring(undefined as unknown as string))).toBe('keyring_not_string');
    expect(reasonOf(() => parseKeyring(42 as unknown as string))).toBe('keyring_not_string');
  });

  it('refuses a keyring object not made by parseKeyring', () => {
    const fake: Keyring = { primaryId: 'k1', keyIds: ['k1'] };
    expect(reasonOf(() => seal(fake, SUMMARY_CONTENT_PURPOSE, TEXT, AAD))).toBe('keyring_malformed');
    expect(reasonOf(() => contentDigest(fake, TEXT))).toBe('keyring_malformed');
  });
});

describe('seal and open', () => {
  const keyring = parseKeyring(`k1:${KEY_A}`);

  it('round trips, including the empty string and non-ASCII text', () => {
    // Built from code points so the source stays ASCII: a-acute, two CJK ideographs, an emoji.
    const nonAscii = `Acuerdos: lanzar el viernes. Responsable: Ana. Prioridad ${String.fromCodePoint(0xe1, 0x4f1a, 0x8bae, 0x1f4c5)}`;
    for (const text of [TEXT, '', nonAscii]) {
      const blob = seal(keyring, SUMMARY_CONTENT_PURPOSE, text, AAD);
      expect(open(keyring, SUMMARY_CONTENT_PURPOSE, blob, AAD)).toBe(text);
    }
  });

  it('writes v1.<keyId>.<iv>.<ciphertext>.<tag> with a 12-byte IV and a 16-byte tag', () => {
    const blob = seal(keyring, SUMMARY_CONTENT_PURPOSE, TEXT, AAD);
    expect(blob).toMatch(/^v1\.k1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{22}$/);
    const parts = explode(blob);
    expect(parts.iv).toHaveLength(12);
    expect(parts.tag).toHaveLength(16);
    expect(parts.ct).toHaveLength(Buffer.byteLength(TEXT, 'utf8'));
  });

  it('uses a fresh IV every time', () => {
    const first = seal(keyring, SUMMARY_CONTENT_PURPOSE, TEXT, AAD);
    const second = seal(keyring, SUMMARY_CONTENT_PURPOSE, TEXT, AAD);
    expect(first).not.toBe(second);
    expect(explode(first).iv.equals(explode(second).iv)).toBe(false);
  });

  it('puts no plaintext, no encoding of it and no AAD in the blob', () => {
    const marker = 'SyntheticSecretActionItemZq7';
    const text = `${TEXT} ${marker} ${marker}`;
    const blob = seal(keyring, SUMMARY_CONTENT_PURPOSE, text, AAD);
    expect(blob).not.toContain(marker);
    expect(blob).not.toContain('SyntheticSecret');
    expect(blob).not.toContain(Buffer.from(marker, 'utf8').toString('base64url').slice(0, 16));
    expect(blob).not.toContain(Buffer.from(text, 'utf8').toString('base64url').slice(0, 16));
    expect(blob).not.toContain(Buffer.from(text, 'utf8').toString('hex').slice(0, 16));
    expect(blob).not.toContain(UID);
    expect(blob).not.toContain(SUMMARY_ID.slice(0, 16));
    expect(explode(blob).ct.toString('utf8')).not.toContain(marker);
  });

  it('fails to open under another uid or another summaryId', () => {
    const blob = seal(keyring, SUMMARY_CONTENT_PURPOSE, TEXT, AAD);
    const otherUid = summaryAad({ uid: 'synthetic-uid-0002', summaryId: SUMMARY_ID });
    const otherSummary = summaryAad({ uid: UID, summaryId: 'b'.repeat(64) });
    expect(reasonOf(() => open(keyring, SUMMARY_CONTENT_PURPOSE, blob, otherUid))).toBe('open_failed');
    expect(reasonOf(() => open(keyring, SUMMARY_CONTENT_PURPOSE, blob, otherSummary))).toBe('open_failed');
    expect(reasonOf(() => open(keyring, SUMMARY_CONTENT_PURPOSE, blob, `${AAD}x`))).toBe('open_failed');
  });

  it('fails when any bit of the IV, ciphertext or tag is flipped', () => {
    const blob = seal(keyring, SUMMARY_CONTENT_PURPOSE, TEXT, AAD);
    const parts = explode(blob);
    for (let i = 0; i < parts.iv.length; i += 1) {
      for (const bit of [0, 7]) {
        expect(reasonOf(() => open(keyring, SUMMARY_CONTENT_PURPOSE, implode({ ...parts, iv: flipBit(parts.iv, i, bit) }), AAD))).toBe('open_failed');
      }
    }
    for (const i of [0, Math.floor(parts.ct.length / 2), parts.ct.length - 1]) {
      expect(reasonOf(() => open(keyring, SUMMARY_CONTENT_PURPOSE, implode({ ...parts, ct: flipBit(parts.ct, i) }), AAD))).toBe('open_failed');
    }
    for (let i = 0; i < parts.tag.length; i += 1) {
      expect(reasonOf(() => open(keyring, SUMMARY_CONTENT_PURPOSE, implode({ ...parts, tag: flipBit(parts.tag, i, 3) }), AAD))).toBe('open_failed');
    }
    expect(open(keyring, SUMMARY_CONTENT_PURPOSE, implode(parts), AAD)).toBe(TEXT);
  });

  it('fails on a truncated or extended ciphertext and a swapped tag', () => {
    const parts = explode(seal(keyring, SUMMARY_CONTENT_PURPOSE, TEXT, AAD));
    const other = explode(seal(keyring, SUMMARY_CONTENT_PURPOSE, TEXT, AAD));
    expect(reasonOf(() => open(keyring, SUMMARY_CONTENT_PURPOSE, implode({ ...parts, ct: parts.ct.subarray(1) }), AAD))).toBe('open_failed');
    expect(reasonOf(() => open(keyring, SUMMARY_CONTENT_PURPOSE, implode({ ...parts, ct: Buffer.concat([parts.ct, Buffer.from([0])]) }), AAD))).toBe('open_failed');
    expect(reasonOf(() => open(keyring, SUMMARY_CONTENT_PURPOSE, implode({ ...parts, tag: other.tag }), AAD))).toBe('open_failed');
  });

  it('rejects malformed blobs before trying to decrypt', () => {
    const blob = seal(keyring, SUMMARY_CONTENT_PURPOSE, TEXT, AAD);
    const [, , iv, ct, tag] = blob.split('.') as [string, string, string, string, string];
    const cases: Array<[string, SealedErrorReason]> = [
      ['', 'blob_malformed'],
      ['not a blob', 'blob_malformed'],
      [blob.slice(3), 'blob_malformed'],
      [`${blob}.extra`, 'blob_malformed'],
      [`v2.k1.${iv}.${ct}.${tag}`, 'blob_version'],
      [`V1.k1.${iv}.${ct}.${tag}`, 'blob_malformed'],
      [`v1.K1.${iv}.${ct}.${tag}`, 'blob_malformed'],
      [`v1.k1.${iv.slice(1)}.${ct}.${tag}`, 'blob_malformed'],
      [`v1.k1.${iv}.${ct}.${tag.slice(1)}`, 'blob_malformed'],
      [`v1.k1.${iv}.${ct}.${tag}=`, 'blob_malformed'],
      [`v1.k1.${iv}.${ct}+/.${tag}`, 'blob_malformed'],
      [`v1.k1.${iv}.${ct} .${tag}`, 'blob_malformed'],
    ];
    for (const [value, reason] of cases) {
      expect(reasonOf(() => open(keyring, SUMMARY_CONTENT_PURPOSE, value, AAD))).toBe(reason);
    }
    expect(reasonOf(() => open(keyring, SUMMARY_CONTENT_PURPOSE, undefined as unknown as string, AAD))).toBe('blob_malformed');
  });

  it('rejects a non-canonical base64url tag (spare bits set)', () => {
    const blob = seal(keyring, SUMMARY_CONTENT_PURPOSE, TEXT, AAD);
    const tag = blob.split('.')[4] ?? '';
    // 16 bytes -> 22 chars; the last char carries 2 spare bits. Changing them keeps the bytes.
    const last = tag.charAt(21);
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const sibling = alphabet.charAt(alphabet.indexOf(last) ^ 1);
    const altered = `${blob.slice(0, blob.length - 1)}${sibling}`;
    expect(Buffer.from(tag, 'base64url').equals(Buffer.from(`${tag.slice(0, 21)}${sibling}`, 'base64url'))).toBe(true);
    expect(reasonOf(() => open(keyring, SUMMARY_CONTENT_PURPOSE, altered, AAD))).toBe('blob_malformed');
  });

  it('rejects an empty AAD, a bad purpose and a non-string plaintext', () => {
    const blob = seal(keyring, SUMMARY_CONTENT_PURPOSE, TEXT, AAD);
    expect(reasonOf(() => seal(keyring, SUMMARY_CONTENT_PURPOSE, TEXT, ''))).toBe('bad_aad');
    expect(reasonOf(() => open(keyring, SUMMARY_CONTENT_PURPOSE, blob, ''))).toBe('bad_aad');
    expect(reasonOf(() => seal(keyring, '', TEXT, AAD))).toBe('bad_purpose');
    expect(reasonOf(() => seal(keyring, 'meetingSummaries', TEXT, AAD))).toBe('bad_purpose');
    expect(reasonOf(() => seal(keyring, 'meeting summaries:content', TEXT, AAD))).toBe('bad_purpose');
    expect(reasonOf(() => seal(keyring, SUMMARY_CONTENT_PURPOSE, 42 as unknown as string, AAD))).toBe('bad_plaintext');
  });

  it('round trips a 100,000-character plaintext', () => {
    const unit = `Action item: Sam checks the budget (owner: Sam) ${String.fromCodePoint(0xb7)} due Friday ${String.fromCodePoint(0xf1)} `;
    const text = unit.repeat(Math.ceil(100_000 / unit.length)).slice(0, 100_000);
    expect(text).toHaveLength(100_000);
    const blob = seal(keyring, SUMMARY_CONTENT_PURPOSE, text, AAD);
    expect(blob).not.toContain('Action item');
    expect(open(keyring, SUMMARY_CONTENT_PURPOSE, blob, AAD)).toBe(text);
  });
});

describe('purpose separation', () => {
  const keyring = parseKeyring(`k1:${KEY_A}`);

  it('a blob sealed for one purpose does not open under another', () => {
    const blob = seal(keyring, SUMMARY_CONTENT_PURPOSE, TEXT, AAD);
    expect(reasonOf(() => open(keyring, 'meetingSummaries:extraction', blob, AAD))).toBe('open_failed');
    const other = seal(keyring, 'meetingSummaries:extraction', TEXT, AAD);
    expect(reasonOf(() => open(keyring, SUMMARY_CONTENT_PURPOSE, other, AAD))).toBe('open_failed');
    expect(open(keyring, 'meetingSummaries:extraction', other, AAD)).toBe(TEXT);
  });

  it('the digest purpose can neither seal nor open', () => {
    const blob = seal(keyring, SUMMARY_CONTENT_PURPOSE, TEXT, AAD);
    expect(reasonOf(() => seal(keyring, SUMMARY_DIGEST_PURPOSE, TEXT, AAD))).toBe('bad_purpose');
    expect(reasonOf(() => open(keyring, SUMMARY_DIGEST_PURPOSE, blob, AAD))).toBe('bad_purpose');
  });

  it('seals with the HKDF content subkey, not the raw key', () => {
    const blob = seal(keyring, SUMMARY_CONTENT_PURPOSE, TEXT, AAD);
    const parts = explode(blob);
    const tryKey = (key: Buffer): string | null => {
      try {
        const decipher = createDecipheriv('aes-256-gcm', key, parts.iv, { authTagLength: 16 });
        decipher.setAAD(Buffer.from(AAD, 'utf8'));
        decipher.setAuthTag(parts.tag);
        return Buffer.concat([decipher.update(parts.ct), decipher.final()]).toString('utf8');
      } catch {
        return null;
      }
    };
    const raw = Buffer.from(KEY_A, 'base64');
    expect(tryKey(raw)).toBeNull();
    expect(tryKey(Buffer.from(hkdfSync('sha256', raw, HKDF_SALT, SUMMARY_DIGEST_PURPOSE, 32)))).toBeNull();
    expect(tryKey(Buffer.from(hkdfSync('sha256', raw, HKDF_SALT, SUMMARY_CONTENT_PURPOSE, 32)))).toBe(TEXT);
  });
});

describe('key rotation', () => {
  const ringK1 = parseKeyring(`k1:${KEY_A}`);
  const ringK2K1 = parseKeyring(`k2:${KEY_B},k1:${KEY_A}`);
  const ringK2Only = parseKeyring(`k2:${KEY_B}`);

  it('k2 seals new blobs and k1 still opens the old ones', () => {
    const oldBlob = seal(ringK1, SUMMARY_CONTENT_PURPOSE, TEXT, AAD);
    const newBlob = seal(ringK2K1, SUMMARY_CONTENT_PURPOSE, TEXT, AAD);
    expect(oldBlob.startsWith('v1.k1.')).toBe(true);
    expect(newBlob.startsWith('v1.k2.')).toBe(true);
    expect(open(ringK2K1, SUMMARY_CONTENT_PURPOSE, oldBlob, AAD)).toBe(TEXT);
    expect(open(ringK2K1, SUMMARY_CONTENT_PURPOSE, newBlob, AAD)).toBe(TEXT);
  });

  it('an unknown key id is rejected as unknown_key', () => {
    const oldBlob = seal(ringK1, SUMMARY_CONTENT_PURPOSE, TEXT, AAD);
    const newBlob = seal(ringK2K1, SUMMARY_CONTENT_PURPOSE, TEXT, AAD);
    expect(reasonOf(() => open(ringK1, SUMMARY_CONTENT_PURPOSE, newBlob, AAD))).toBe('unknown_key');
    expect(reasonOf(() => open(ringK2Only, SUMMARY_CONTENT_PURPOSE, oldBlob, AAD))).toBe('unknown_key');
    expect(reasonOf(() => open(ringK2K1, SUMMARY_CONTENT_PURPOSE, oldBlob.replace(/^v1\.k1\./, 'v1.k7.'), AAD))).toBe('unknown_key');
  });

  it('a relabelled key id or a different key under the same id fails to open', () => {
    const oldBlob = seal(ringK1, SUMMARY_CONTENT_PURPOSE, TEXT, AAD);
    expect(reasonOf(() => open(ringK2K1, SUMMARY_CONTENT_PURPOSE, oldBlob.replace(/^v1\.k1\./, 'v1.k2.'), AAD))).toBe('open_failed');
    expect(reasonOf(() => open(parseKeyring(`k1:${KEY_B}`), SUMMARY_CONTENT_PURPOSE, oldBlob, AAD))).toBe('open_failed');
  });
});

describe('contentDigest', () => {
  it('is 64-char hex, deterministic and text-dependent', () => {
    const keyring = parseKeyring(`k1:${KEY_A}`);
    const digest = contentDigest(keyring, TEXT);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(contentDigest(keyring, TEXT)).toBe(digest);
    expect(contentDigest(parseKeyring(`k1:${KEY_A}`), TEXT)).toBe(digest);
    expect(contentDigest(keyring, `${TEXT} `)).not.toBe(digest);
    expect(contentDigest(keyring, '')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('depends on the key and always uses the first key', () => {
    const digestA = contentDigest(parseKeyring(`k1:${KEY_A}`), TEXT);
    const digestB = contentDigest(parseKeyring(`k1:${KEY_B}`), TEXT);
    expect(digestB).not.toBe(digestA);
    expect(contentDigest(parseKeyring(`k2:${KEY_B},k1:${KEY_A}`), TEXT)).toBe(digestB);
    expect(contentDigest(parseKeyring(`k2:${KEY_B}`), TEXT)).toBe(digestB);
    expect(contentDigest(parseKeyring(`k1:${KEY_A},k2:${KEY_B}`), TEXT)).toBe(digestA);
  });

  it('is HMAC-SHA256 under the digest subkey, not the raw key or the content subkey', () => {
    const raw = Buffer.from(KEY_A, 'base64');
    const hmac = (key: Buffer | string): string => createHmac('sha256', key).update(TEXT, 'utf8').digest('hex');
    const digest = contentDigest(parseKeyring(`k1:${KEY_A}`), TEXT);
    expect(digest).toBe(hmac(Buffer.from(hkdfSync('sha256', raw, HKDF_SALT, SUMMARY_DIGEST_PURPOSE, 32))));
    expect(digest).not.toBe(hmac(raw));
    expect(digest).not.toBe(hmac(Buffer.from(hkdfSync('sha256', raw, HKDF_SALT, SUMMARY_CONTENT_PURPOSE, 32))));
  });

  it('rejects a non-string text', () => {
    expect(reasonOf(() => contentDigest(parseKeyring(`k1:${KEY_A}`), null as unknown as string))).toBe('bad_plaintext');
  });
});

describe('pinned vectors (a change here makes stored data unreadable)', () => {
  const keyring = parseKeyring(`k1:${FIXED_KEY}`);
  const text = 'Synthetic golden plaintext: action items for the weekly sync.';

  it('opens a blob sealed by this version', () => {
    const blob =
      'v1.k1.YSXAVpYMOEJ47JUf.j7svokNWndEwfZfNPJcElVrMcu-Kp5AHlNYTDQbUl14t-NarW2aVI_7N-BKYIOfdLDez-Sm6u5qxX4Ak7A.bK2zh5KQMo1Ddn7D7AdGqQ';
    expect(open(keyring, SUMMARY_CONTENT_PURPOSE, blob, AAD)).toBe(text);
  });

  it('produces the same digest as this version', () => {
    expect(contentDigest(keyring, text)).toBe('53ee0019882ac7a441cd63c9821ac27f7dd96cac2cc0111079a13eb6abcddc49');
  });
});

/**
 * Field encryption for stored meeting summaries (M10, docs/v2/M10-DESIGN.md section 7).
 * Pure: node:crypto only, no Firebase imports, no logging.
 *
 * Keyring (the SUMMARIES_DATA_KEY secret): `k1:<base64 of 32 bytes>`, further keys comma
 * separated, newest first (`k2:<base64>,k1:<base64>`). The FIRST key seals and digests; any
 * listed key opens. Rotation: put the new key first and keep the old one listed until every blob
 * sealed under it is gone or resealed. A key removed from the ring makes its blobs unreadable.
 * Key ids are `k` plus a positive integer without a leading zero. Key material is canonical
 * standard base64 with padding (what `openssl rand -base64 32` prints). Whitespace and newlines
 * anywhere are rejected, so a secret stored with a trailing newline fails loudly instead of half
 * working. Parse errors name the entry position and the problem, never any part of the secret.
 *
 * Subkeys: HKDF-SHA256(ikm = key, salt = HKDF_SALT, info = purpose, 32 bytes), one per key and
 * purpose. `meetingSummaries:content` seals, `meetingSummaries:digest` is reserved for the
 * contentDigest HMAC, so no subkey is ever used by both AES-GCM and HMAC.
 *
 * Blob: `v1.<keyId>.<iv>.<ciphertext>.<tag>`, each binary part base64url without padding.
 * AES-256-GCM, a random 12-byte IV per seal, a 16-byte tag, and the caller's AAD (for summaries
 * exactly `meetingSummary:` + uid + `:` + summaryId, see summaryAad) so a blob copied to another
 * user or document fails to open. The version and key id are not in the AAD: an altered key id
 * selects a different key (or none) and fails the tag check, and only v1 is accepted.
 *
 * Plaintext is encoded as UTF-8; a lone UTF-16 surrogate (not valid text) comes back as U+FFFD.
 * Every failure throws SealedError; its `reason` is safe to log, its message names no content.
 */
import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from 'node:crypto';

/** Purpose of the subkey that seals summary content (the sealed field blob). */
export const SUMMARY_CONTENT_PURPOSE = 'meetingSummaries:content';
/** Purpose of the subkey behind contentDigest; seal and open refuse it. */
export const SUMMARY_DIGEST_PURPOSE = 'meetingSummaries:digest';

/** HKDF salt. Changing it makes every stored blob unreadable and every digest different. */
export const HKDF_SALT = 'meeting-guard-ai:sealed:v1';
/** Prefix of every blob this version writes. */
export const SEALED_VERSION = 'v1';

const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const IV_CHARS = 16; // base64url of 12 bytes, no padding
const TAG_CHARS = 22; // base64url of 16 bytes, no padding
const CIPHER = 'aes-256-gcm';

const KEY_ID_PATTERN = /^k[1-9][0-9]{0,5}$/;
const STD_BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]*$/;
const PURPOSE_PATTERN = /^[a-z][A-Za-z0-9]{0,39}:[a-z][A-Za-z0-9]{0,39}$/;
const SUMMARY_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_UID_CHARS = 128;

export type SealedErrorReason =
  | 'keyring_not_string'
  | 'keyring_empty'
  | 'keyring_whitespace'
  | 'keyring_malformed'
  | 'keyring_bad_id'
  | 'keyring_duplicate_id'
  | 'keyring_bad_base64'
  | 'keyring_bad_length'
  | 'bad_purpose'
  | 'bad_aad'
  | 'bad_plaintext'
  | 'blob_malformed'
  | 'blob_version'
  | 'unknown_key'
  | 'open_failed';

/** The only error this module throws on purpose. `reason` is safe to log; nothing else is added. */
export class SealedError extends Error {
  readonly reason: SealedErrorReason;

  constructor(reason: SealedErrorReason, message: string) {
    super(message);
    this.name = 'SealedError';
    this.reason = reason;
  }
}

/**
 * A parsed keyring. Holds only the key ids; the key material lives in a module-private WeakMap,
 * so logging or serializing a Keyring never prints a key.
 */
export interface Keyring {
  /** The id that seals and digests (the first entry of the secret). */
  readonly primaryId: string;
  /** Every id in secret order, primary first. */
  readonly keyIds: readonly string[];
}

interface KeyMaterial {
  readonly keys: ReadonlyMap<string, Buffer>;
  /** `${keyId}|${purpose}` -> 32-byte subkey, filled on first use. */
  readonly subkeys: Map<string, Buffer>;
}

const material = new WeakMap<Keyring, KeyMaterial>();

function keyringError(reason: SealedErrorReason, position: number | null, problem: string): SealedError {
  const where = position === null ? 'keyring' : `keyring entry ${position}`;
  return new SealedError(reason, `${where}: ${problem}`);
}

/** One `id:base64` entry; `position` is 1-based and is the only detail an error carries. */
function parseEntry(entry: string, position: number): [string, Buffer] {
  const colon = entry.indexOf(':');
  if (colon < 0) {
    throw keyringError('keyring_malformed', position, 'expected <id>:<base64 key>');
  }
  const id = entry.slice(0, colon);
  const encoded = entry.slice(colon + 1);
  if (!KEY_ID_PATTERN.test(id)) {
    throw keyringError('keyring_bad_id', position, 'key id must be k followed by a positive integer');
  }
  if (!STD_BASE64_PATTERN.test(encoded) || encoded.length % 4 !== 0) {
    throw keyringError('keyring_bad_base64', position, 'key is not padded standard base64');
  }
  const key = Buffer.from(encoded, 'base64');
  if (key.toString('base64') !== encoded) {
    key.fill(0);
    throw keyringError('keyring_bad_base64', position, 'key is not canonical base64');
  }
  if (key.length !== KEY_BYTES) {
    key.fill(0);
    throw keyringError('keyring_bad_length', position, `key must decode to ${KEY_BYTES} bytes`);
  }
  return [id, key];
}

/**
 * Parses the SUMMARIES_DATA_KEY secret. Throws SealedError (reason keyring_*) on: a non-string or
 * empty value, any whitespace or newline, an empty entry or one without `id:`, an id that is not
 * `k<n>`, a repeated id, key text that is not canonical padded standard base64, or a decoded key
 * that is not 32 bytes.
 */
export function parseKeyring(secret: string): Keyring {
  if (typeof secret !== 'string') {
    throw keyringError('keyring_not_string', null, 'value is not a string');
  }
  if (secret.length === 0) {
    throw keyringError('keyring_empty', null, 'value is empty');
  }
  if (/\s/.test(secret)) {
    throw keyringError('keyring_whitespace', null, 'value contains whitespace or a newline');
  }

  const keys = new Map<string, Buffer>();
  const ids: string[] = [];
  try {
    for (const [index, entry] of secret.split(',').entries()) {
      const [id, key] = parseEntry(entry, index + 1);
      if (keys.has(id)) {
        key.fill(0);
        throw keyringError('keyring_duplicate_id', index + 1, 'key id is listed more than once');
      }
      keys.set(id, key);
      ids.push(id);
    }
  } catch (error) {
    for (const key of keys.values()) key.fill(0);
    throw error;
  }

  const primaryId = ids[0];
  if (primaryId === undefined) {
    // Unreachable: a non-empty string always yields at least one entry.
    throw keyringError('keyring_empty', null, 'no keys');
  }
  const keyring: Keyring = Object.freeze({ primaryId, keyIds: Object.freeze([...ids]) });
  material.set(keyring, { keys, subkeys: new Map() });
  return keyring;
}

function materialOf(keyring: Keyring): KeyMaterial {
  const found = material.get(keyring);
  if (!found) {
    throw keyringError('keyring_malformed', null, 'not created by parseKeyring');
  }
  return found;
}

function assertPurpose(purpose: string): void {
  if (typeof purpose !== 'string' || !PURPOSE_PATTERN.test(purpose)) {
    throw new SealedError('bad_purpose', 'purpose must look like area:use');
  }
  if (purpose === SUMMARY_DIGEST_PURPOSE) {
    throw new SealedError('bad_purpose', 'the digest purpose cannot seal or open');
  }
}

/** HKDF-SHA256 subkey for (keyId, purpose); null when the keyring does not list keyId. */
function subkey(keyring: Keyring, keyId: string, purpose: string): Buffer | null {
  const { keys, subkeys } = materialOf(keyring);
  const cacheKey = `${keyId}|${purpose}`;
  const cached = subkeys.get(cacheKey);
  if (cached) return cached;
  const key = keys.get(keyId);
  if (!key) return null;
  const derived = Buffer.from(hkdfSync('sha256', key, HKDF_SALT, purpose, KEY_BYTES));
  subkeys.set(cacheKey, derived);
  return derived;
}

function primarySubkey(keyring: Keyring, purpose: string): { keyId: string; key: Buffer } {
  const keyId = keyring.primaryId;
  const key = subkey(keyring, keyId, purpose);
  if (!key) {
    throw keyringError('keyring_malformed', null, 'primary key missing');
  }
  return { keyId, key };
}

function aadBytes(aad: string): Buffer {
  if (typeof aad !== 'string' || aad.length === 0) {
    throw new SealedError('bad_aad', 'aad must be a non-empty string');
  }
  return Buffer.from(aad, 'utf8');
}

/**
 * The AAD every summary blob is sealed with: exactly `meetingSummary:` + uid + `:` + summaryId.
 * summaryId may not contain `:` (it is sha256 hex in M10), so the string splits one way only.
 */
export function summaryAad(ref: { uid: string; summaryId: string }): string {
  const { uid, summaryId } = ref;
  if (typeof uid !== 'string' || uid.length === 0 || uid.length > MAX_UID_CHARS) {
    throw new SealedError('bad_aad', 'uid must be 1 to 128 characters');
  }
  if (typeof summaryId !== 'string' || !SUMMARY_ID_PATTERN.test(summaryId)) {
    throw new SealedError('bad_aad', 'summaryId must be 1 to 128 characters of A-Z a-z 0-9 _ -');
  }
  return `meetingSummary:${uid}:${summaryId}`;
}

/**
 * Encrypts `plaintext` under the primary key's subkey for `purpose`, bound to `aad`.
 * Returns `v1.<keyId>.<iv>.<ciphertext>.<tag>`. Two seals of the same input differ (random IV).
 */
export function seal(keyring: Keyring, purpose: string, plaintext: string, aad: string): string {
  assertPurpose(purpose);
  const aadData = aadBytes(aad);
  if (typeof plaintext !== 'string') {
    throw new SealedError('bad_plaintext', 'plaintext must be a string');
  }
  const { keyId, key } = primarySubkey(keyring, purpose);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(CIPHER, key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(aadData);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    SEALED_VERSION,
    keyId,
    iv.toString('base64url'),
    ciphertext.toString('base64url'),
    tag.toString('base64url'),
  ].join('.');
}

/** Strict base64url (no padding, canonical); null when the text is not exactly that. */
function decodeBase64Url(text: string): Buffer | null {
  if (!BASE64URL_PATTERN.test(text) || text.length % 4 === 1) return null;
  const bytes = Buffer.from(text, 'base64url');
  return bytes.toString('base64url') === text ? bytes : null;
}

interface ParsedBlob {
  keyId: string;
  iv: Buffer;
  ciphertext: Buffer;
  tag: Buffer;
}

function parseBlob(blob: string): ParsedBlob {
  if (typeof blob !== 'string') {
    throw new SealedError('blob_malformed', 'sealed value is not a string');
  }
  const parts = blob.split('.');
  if (parts.length !== 5) {
    throw new SealedError('blob_malformed', 'sealed value has the wrong number of parts');
  }
  const [version, keyId, ivText, ciphertextText, tagText] = parts as [string, string, string, string, string];
  if (version !== SEALED_VERSION) {
    throw new SealedError(/^v[0-9]+$/.test(version) ? 'blob_version' : 'blob_malformed', 'unsupported sealed version');
  }
  if (!KEY_ID_PATTERN.test(keyId)) {
    throw new SealedError('blob_malformed', 'sealed value has a bad key id');
  }
  const iv = ivText.length === IV_CHARS ? decodeBase64Url(ivText) : null;
  const tag = tagText.length === TAG_CHARS ? decodeBase64Url(tagText) : null;
  const ciphertext = decodeBase64Url(ciphertextText);
  if (!iv || iv.length !== IV_BYTES || !tag || tag.length !== TAG_BYTES || !ciphertext) {
    throw new SealedError('blob_malformed', 'sealed value has a bad iv, ciphertext or tag');
  }
  return { keyId, iv, ciphertext, tag };
}

/**
 * Decrypts a blob from seal. Throws SealedError: blob_malformed or blob_version for text that is
 * not a v1 blob, unknown_key when the keyring does not list the blob's key id, open_failed when
 * the tag does not verify (wrong key, purpose or AAD, or any altered byte).
 */
export function open(keyring: Keyring, purpose: string, blob: string, aad: string): string {
  assertPurpose(purpose);
  const aadData = aadBytes(aad);
  const parsed = parseBlob(blob);
  const key = subkey(keyring, parsed.keyId, purpose);
  if (!key) {
    throw new SealedError('unknown_key', 'sealed value names a key id the keyring does not list');
  }
  try {
    const decipher = createDecipheriv(CIPHER, key, parsed.iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(aadData);
    decipher.setAuthTag(parsed.tag);
    return Buffer.concat([decipher.update(parsed.ciphertext), decipher.final()]).toString('utf8');
  } catch {
    // The crypto error adds nothing useful; one generic reason, no detail.
    throw new SealedError('open_failed', 'sealed value did not authenticate');
  }
}

/**
 * Keyed digest of summary text for dedupe: HMAC-SHA256 hex under the primary key's
 * `meetingSummaries:digest` subkey. Deterministic for one primary key; it changes when a new key
 * goes first, so digests written before a rotation stop matching new ones.
 */
export function contentDigest(keyring: Keyring, text: string): string {
  if (typeof text !== 'string') {
    throw new SealedError('bad_plaintext', 'text must be a string');
  }
  const { key } = primarySubkey(keyring, SUMMARY_DIGEST_PURPOSE);
  return createHmac('sha256', key).update(text, 'utf8').digest('hex');
}

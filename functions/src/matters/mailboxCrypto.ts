/**
 * A4 part 2: encryption of the owner's mailbox access at rest (docs/v2/A4-THREAT-MODEL.md T9).
 * Pure: the keys come from the secret MATTERS_MAILBOX_KEY (set by Dusko), never from Firestore.
 *
 * - AES-256-GCM, a random 12-byte nonce for every record, a 16-byte tag.
 * - Associated data binds a record to its place: the uid and the mailbox address for a refresh
 *   token (mailboxAad), the state id for a sign-in in progress (stateAad). A record copied to
 *   another user or mailbox does not decrypt.
 * - A key id in front of every record, so the key can be rotated: MATTERS_MAILBOX_KEY may hold
 *   several keys separated by commas; the FIRST encrypts, every one decrypts. The id is the first
 *   8 hex characters of the key's SHA-256 (it names the key without revealing it).
 * - Format: "v1.<keyId>.<nonce>.<ciphertext>.<tag>", the last three in base64url.
 * Nothing here logs; an error names a category only.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

export interface MailboxKey {
  id: string;
  key: Buffer;
}

export class MailboxCryptoError extends Error {
  constructor(readonly kind: 'no_key' | 'unknown_key' | 'malformed' | 'tampered') {
    super(`Mailbox secret could not be used: ${kind}`);
    this.name = 'MailboxCryptoError';
  }
}

const VERSION = 'v1';
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

/** One key from its text: 32 bytes as base64 (or base64url) or as 64 hex characters. */
function keyBytes(text: string): Buffer | null {
  const value = text.trim();
  if (/^[0-9a-f]{64}$/i.test(value)) return Buffer.from(value, 'hex');
  if (/^[A-Za-z0-9+/_-]{43}=?$/.test(value)) {
    const bytes = Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    if (bytes.length === 32) return bytes;
  }
  return null;
}

export function keyIdOf(key: Buffer): string {
  return createHash('sha256').update(key).digest('hex').slice(0, 8);
}

/**
 * The keys in MATTERS_MAILBOX_KEY, first one first. A value that is not 32 bytes of base64 or hex
 * is refused (no_key): a weak or mistyped key never encrypts anything.
 */
export function parseMailboxKeys(secret: string): MailboxKey[] {
  const keys: MailboxKey[] = [];
  for (const part of secret.split(',')) {
    if (!part.trim()) continue;
    const key = keyBytes(part);
    if (!key) throw new MailboxCryptoError('no_key');
    keys.push({ id: keyIdOf(key), key });
  }
  if (keys.length === 0) throw new MailboxCryptoError('no_key');
  return keys;
}

export const mailboxAad = (uid: string, address: string) => `matterMailbox:${uid}:${address.trim().toLowerCase()}`;
export const stateAad = (stateId: string) => `matterMailboxState:${stateId}`;

const b64 = (bytes: Buffer) => bytes.toString('base64url');

export function sealSecret(plain: string, aad: string, keys: readonly MailboxKey[], random: (size: number) => Buffer = randomBytes): string {
  const first = keys[0];
  if (!first) throw new MailboxCryptoError('no_key');
  const nonce = random(NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', first.key, nonce, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [VERSION, first.id, b64(nonce), b64(body), b64(cipher.getAuthTag())].join('.');
}

/** The key id a sealed record was written with (null when it is not one). */
export function sealedKeyId(sealed: string): string | null {
  const parts = sealed.split('.');
  return parts.length === 5 && parts[0] === VERSION ? (parts[1] ?? null) : null;
}

export function openSecret(sealed: string, aad: string, keys: readonly MailboxKey[]): string {
  const parts = sealed.split('.');
  if (parts.length !== 5 || parts[0] !== VERSION) throw new MailboxCryptoError('malformed');
  const [, keyId, nonceText, bodyText, tagText] = parts as [string, string, string, string, string];
  const key = keys.find((k) => k.id === keyId);
  if (!key) throw new MailboxCryptoError('unknown_key');
  const nonce = Buffer.from(nonceText, 'base64url');
  const tag = Buffer.from(tagText, 'base64url');
  if (nonce.length !== NONCE_BYTES || tag.length !== TAG_BYTES) throw new MailboxCryptoError('malformed');
  try {
    const decipher = createDecipheriv('aes-256-gcm', key.key, nonce, { authTagLength: TAG_BYTES });
    decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(Buffer.from(bodyText, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    throw new MailboxCryptoError('tampered');
  }
}

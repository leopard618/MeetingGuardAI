/**
 * `microsoftSignIn` callable: Sign in with Microsoft (docs/v1/ARCHITECTURE.md §31, SETUP.md §10.6).
 *
 * The app runs the Microsoft PKCE sign-in itself (scopes openid profile email) and sends the
 * id_token plus the raw nonce it put in the authorize request. This function:
 *   1. verifies the token: RS256 signature against Microsoft's published keys (JWKS of the
 *      common discovery endpoint, cached), audience = the Azure client id, issuer = the token's
 *      own tenant (`https://login.microsoftonline.com/{tid}/v2.0`), the tenant policy
 *      (MICROSOFT_TENANT), lifetime (exp / nbf with 60 s skew), the nonce, and the identity
 *      claims (oid, sub);
 *   2. resolves the Firebase user: microsoftIdentities/{oid} when the account signed in before,
 *      else an existing user with the same email when that email is VERIFIED (a personal
 *      Microsoft account, or a work account whose tenant proved domain ownership: xms_edov),
 *      else a new user `ms_{oid}`;
 *   3. answers with a Firebase custom token for signInWithCustomToken.
 *
 * Unauthenticated by design (it IS the sign-in): nothing is read from the request but the token,
 * and the only writes are the identity document and the Auth user. Never logs tokens or emails.
 *
 * Why not Firebase's own Microsoft provider: the JS SDK cannot sign in with a Microsoft token
 * (signInWithCredential is not supported for microsoft.com) and signInWithRedirect does not
 * exist in React Native; a custom token minted after our own verification is the documented
 * path for this case.
 */
import { createPublicKey, verify as cryptoVerify, type JsonWebKey } from 'node:crypto';

import * as logger from 'firebase-functions/logger';
import { HttpsError, onCall } from 'firebase-functions/https';

import { FUNCTIONS_REGION, MICROSOFT_CLIENT_ID, MICROSOFT_TENANT } from './config';
import { adminAuth, adminDb } from './firebase';
import { microsoftSignInRequestSchema, type MicrosoftSignInReason, type MicrosoftSignInResponse } from './shared/aiContract';

/** `microsoftIdentities/{oid}`: the Firebase uid a Microsoft account signs in to. */
export const MICROSOFT_IDENTITIES_COLLECTION = 'microsoftIdentities';

/** Tenant id of personal Microsoft accounts (outlook.com, hotmail.com, live.com). */
export const CONSUMER_TENANT_ID = '9188040d-6c67-4c5b-b112-36a304b66dad';

/** Microsoft's common key set: the keys of every tenant's v2.0 tokens. */
export const MICROSOFT_JWKS_URL = 'https://login.microsoftonline.com/common/discovery/v2.0/keys';

/** Accepted clock skew for exp / nbf. */
export const CLOCK_SKEW_SECONDS = 60;

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ---------------------------------------------------------------------------------------------
// Token verification (pure: the key set comes through a port)
// ---------------------------------------------------------------------------------------------

export interface JwksPort {
  /** The JWK (n, e) for `kid`, or null when unknown; `refresh` asks for a fresh key set first. */
  getKey(kid: string, options?: { refresh: boolean }): Promise<JsonWebKey | null>;
}

/** A verification failure; the reason is logged, never the token. */
export class MicrosoftTokenError extends Error {
  constructor(public readonly reason: string) {
    super(`Microsoft id_token rejected: ${reason}`);
    this.name = 'MicrosoftTokenError';
  }
}

export interface MicrosoftIdentity {
  oid: string;
  tid: string;
  sub: string;
  email: string | null;
  name: string | null;
  /** The email belongs to the signer: a personal account, or a tenant that proved the domain. */
  emailVerified: boolean;
}

export interface VerifyOptions {
  clientId: string;
  /** common | organizations | consumers | a tenant GUID. */
  tenant: string;
  nonce: string;
  now?: Date;
  keys: JwksPort;
}

interface JwtHeader {
  alg?: unknown;
  kid?: unknown;
  typ?: unknown;
}

interface JwtClaims {
  aud?: unknown;
  iss?: unknown;
  tid?: unknown;
  exp?: unknown;
  nbf?: unknown;
  iat?: unknown;
  nonce?: unknown;
  oid?: unknown;
  sub?: unknown;
  email?: unknown;
  preferred_username?: unknown;
  name?: unknown;
  xms_edov?: unknown;
}

function decodeSegment(segment: string, what: string): unknown {
  let text: string;
  try {
    text = Buffer.from(segment, 'base64url').toString('utf8');
  } catch {
    throw new MicrosoftTokenError(`${what} is not base64url`);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new MicrosoftTokenError(`${what} is not JSON`);
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isGuid(value: unknown): value is string {
  return typeof value === 'string' && GUID_RE.test(value);
}

function asEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase();
  return EMAIL_RE.test(trimmed) && trimmed.length <= 254 ? trimmed : null;
}

/** Tenant policy of MICROSOFT_TENANT against the token's tid. */
export function tenantAccepts(tenant: string, tid: string): boolean {
  const policy = tenant.trim().toLowerCase();
  if (policy === '' || policy === 'common') return true;
  if (policy === 'consumers') return tid.toLowerCase() === CONSUMER_TENANT_ID;
  if (policy === 'organizations') return tid.toLowerCase() !== CONSUMER_TENANT_ID;
  return policy === tid.toLowerCase();
}

async function verifySignature(signingInput: string, signature: Buffer, kid: string, keys: JwksPort): Promise<void> {
  let jwk = await keys.getKey(kid);
  if (jwk === null) jwk = await keys.getKey(kid, { refresh: true });
  if (jwk === null) throw new MicrosoftTokenError('unknown signing key');
  let key: ReturnType<typeof createPublicKey>;
  try {
    key = createPublicKey({ key: { kty: 'RSA', n: jwk.n, e: jwk.e }, format: 'jwk' });
  } catch {
    throw new MicrosoftTokenError('unusable signing key');
  }
  let ok = false;
  try {
    ok = cryptoVerify('RSA-SHA256', Buffer.from(signingInput, 'utf8'), key, signature);
  } catch {
    ok = false;
  }
  if (!ok) throw new MicrosoftTokenError('bad signature');
}

/** Verifies a Microsoft v2.0 id_token and returns the identity it carries. Throws MicrosoftTokenError. */
export async function verifyMicrosoftIdToken(idToken: string, options: VerifyOptions): Promise<MicrosoftIdentity> {
  const parts = idToken.split('.');
  if (parts.length !== 3 || parts.some((part) => part.length === 0)) throw new MicrosoftTokenError('malformed token');
  const [headerSegment, payloadSegment, signatureSegment] = parts as [string, string, string];

  const header = decodeSegment(headerSegment, 'header');
  if (!isObject(header)) throw new MicrosoftTokenError('header is not an object');
  const { alg, kid } = header as JwtHeader;
  if (alg !== 'RS256') throw new MicrosoftTokenError('unsupported algorithm');
  if (typeof kid !== 'string' || kid.length === 0 || kid.length > 128) throw new MicrosoftTokenError('missing kid');

  const payload = decodeSegment(payloadSegment, 'payload');
  if (!isObject(payload)) throw new MicrosoftTokenError('payload is not an object');
  const claims = payload as JwtClaims;

  let signature: Buffer;
  try {
    signature = Buffer.from(signatureSegment, 'base64url');
  } catch {
    throw new MicrosoftTokenError('signature is not base64url');
  }
  if (signature.length === 0) throw new MicrosoftTokenError('empty signature');
  await verifySignature(`${headerSegment}.${payloadSegment}`, signature, kid, options.keys);

  // Only a verified payload is worth reading.
  if (claims.aud !== options.clientId) throw new MicrosoftTokenError('audience mismatch');
  if (!isGuid(claims.tid)) throw new MicrosoftTokenError('missing tid');
  const tid = claims.tid.toLowerCase();
  if (claims.iss !== `https://login.microsoftonline.com/${tid}/v2.0` && claims.iss !== `https://login.microsoftonline.com/${claims.tid}/v2.0`) {
    throw new MicrosoftTokenError('issuer mismatch');
  }
  if (!tenantAccepts(options.tenant, tid)) throw new MicrosoftTokenError('tenant not accepted');

  const nowSeconds = Math.floor((options.now ?? new Date()).getTime() / 1000);
  if (typeof claims.exp !== 'number' || !Number.isFinite(claims.exp)) throw new MicrosoftTokenError('missing exp');
  if (claims.exp <= nowSeconds - CLOCK_SKEW_SECONDS) throw new MicrosoftTokenError('expired');
  if (claims.nbf !== undefined) {
    if (typeof claims.nbf !== 'number' || !Number.isFinite(claims.nbf)) throw new MicrosoftTokenError('invalid nbf');
    if (claims.nbf > nowSeconds + CLOCK_SKEW_SECONDS) throw new MicrosoftTokenError('not yet valid');
  }
  if (typeof claims.iat !== 'number' || !Number.isFinite(claims.iat)) throw new MicrosoftTokenError('missing iat');
  if (typeof claims.nonce !== 'string' || claims.nonce !== options.nonce) throw new MicrosoftTokenError('nonce mismatch');
  if (!isGuid(claims.oid)) throw new MicrosoftTokenError('missing oid');
  if (typeof claims.sub !== 'string' || claims.sub.length === 0) throw new MicrosoftTokenError('missing sub');

  const email = asEmail(claims.email) ?? asEmail(claims.preferred_username);
  const name = typeof claims.name === 'string' && claims.name.trim().length > 0 ? claims.name.trim().slice(0, 200) : null;
  return {
    oid: claims.oid.toLowerCase(),
    tid,
    sub: claims.sub,
    email,
    name,
    emailVerified: tid === CONSUMER_TENANT_ID || claims.xms_edov === true,
  };
}

// ---------------------------------------------------------------------------------------------
// JWKS port over Microsoft's discovery endpoint (module cache)
// ---------------------------------------------------------------------------------------------

/** The cached key set lives this long before a routine refetch. */
export const JWKS_CACHE_MS = 24 * 60 * 60 * 1000;
/** An unknown kid triggers a refetch at most this often (key rollover, not a flood). */
export const JWKS_MIN_REFRESH_INTERVAL_MS = 60 * 1000;

interface JwksDocument {
  keys?: { kid?: unknown; kty?: unknown; n?: unknown; e?: unknown }[];
}

export interface JwksOptions {
  fetchImpl?: typeof fetch;
  now?: () => number;
  url?: string;
}

export function createMicrosoftJwks(options: JwksOptions = {}): JwksPort {
  const fetchImpl = options.fetchImpl ?? ((input: Parameters<typeof fetch>[0], init?: RequestInit) => fetch(input, init));
  const now = options.now ?? ((): number => Date.now());
  const url = options.url ?? MICROSOFT_JWKS_URL;
  let keys = new Map<string, JsonWebKey>();
  let fetchedAt = 0;
  let inFlight: Promise<void> | null = null;

  async function load(): Promise<void> {
    const response = await fetchImpl(url, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`JWKS request failed with HTTP ${response.status}`);
    const body = (await response.json()) as JwksDocument;
    const next = new Map<string, JsonWebKey>();
    for (const key of body.keys ?? []) {
      if (typeof key.kid === 'string' && key.kty === 'RSA' && typeof key.n === 'string' && typeof key.e === 'string') {
        next.set(key.kid, { kty: 'RSA', n: key.n, e: key.e });
      }
    }
    keys = next;
    fetchedAt = now();
  }

  function refresh(): Promise<void> {
    if (inFlight === null) {
      inFlight = load().finally(() => {
        inFlight = null;
      });
    }
    return inFlight;
  }

  return {
    async getKey(kid, getOptions) {
      const age = now() - fetchedAt;
      const stale = fetchedAt === 0 || age >= JWKS_CACHE_MS;
      const wantRefresh = getOptions?.refresh === true && age >= JWKS_MIN_REFRESH_INTERVAL_MS;
      if (stale || wantRefresh) {
        try {
          await refresh();
        } catch (error) {
          // A failed refetch keeps the previous keys (a rollover retries on the next call).
          logger.warn('microsoftSignIn.jwks_fetch_failed', { errorMessage: error instanceof Error ? error.message.slice(0, 200) : '' });
          if (keys.size === 0) throw error;
        }
      }
      return keys.get(kid) ?? null;
    },
  };
}

let sharedJwks: JwksPort | null = null;

/** The process-wide key set (one fetch per instance per day). */
export function microsoftJwks(): JwksPort {
  if (sharedJwks === null) sharedJwks = createMicrosoftJwks();
  return sharedJwks;
}

// ---------------------------------------------------------------------------------------------
// Handler (ports: Firestore identities + Firebase Auth users)
// ---------------------------------------------------------------------------------------------

export interface MicrosoftIdentityRecord {
  uid: string;
  tid: string;
  email: string | null;
  createdAt: string;
  lastSignInAt: string;
}

export interface MicrosoftSignInPorts {
  keys: JwksPort;
  findIdentity(oid: string): Promise<MicrosoftIdentityRecord | null>;
  saveIdentity(oid: string, record: MicrosoftIdentityRecord): Promise<void>;
  touchIdentity(oid: string, lastSignInAtIso: string): Promise<void>;
  /** The uid of the user with this email, or null. */
  getUserByEmail(email: string): Promise<{ uid: string; displayName: string | null } | null>;
  /** The user's display name (null when unknown or missing). */
  getDisplayName(uid: string): Promise<string | null>;
  /** Creates the Auth user; throws the Admin SDK error codes (auth/uid-already-exists, auth/email-already-exists). */
  createUser(input: { uid: string; email: string | null; emailVerified: boolean; displayName: string | null }): Promise<void>;
  updateDisplayName(uid: string, displayName: string): Promise<void>;
  createCustomToken(uid: string): Promise<string>;
}

export interface MicrosoftSignInOptions {
  clientId: string;
  tenant: string;
  now?: () => Date;
}

function reasonError(code: 'failed-precondition' | 'unauthenticated' | 'already-exists', message: string, reason: MicrosoftSignInReason): HttpsError {
  return new HttpsError(code, message, { reason });
}

function adminErrorCode(error: unknown): string | null {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : null;
}

/** Microsoft uid: deterministic, so a retried first sign-in never creates a second user. */
export function microsoftUid(oid: string): string {
  return `ms_${oid.toLowerCase()}`;
}

async function linkByEmail(
  identity: MicrosoftIdentity,
  existing: { uid: string; displayName: string | null },
  ports: MicrosoftSignInPorts,
  nowIso: string,
): Promise<string> {
  if (!identity.emailVerified) {
    logger.info('microsoftSignIn.email_in_use', { tid: identity.tid });
    throw reasonError('already-exists', 'An account with this email already exists. Sign in with the method you used before.', 'email_in_use');
  }
  await ports.saveIdentity(identity.oid, { uid: existing.uid, tid: identity.tid, email: identity.email, createdAt: nowIso, lastSignInAt: nowIso });
  if (existing.displayName === null && identity.name !== null) await saveDisplayName(existing.uid, identity.name, ports);
  return existing.uid;
}

async function saveDisplayName(uid: string, name: string, ports: MicrosoftSignInPorts): Promise<void> {
  try {
    await ports.updateDisplayName(uid, name);
  } catch (error) {
    logger.warn('microsoftSignIn.display_name_failed', { uid, errorMessage: error instanceof Error ? error.message.slice(0, 200) : '' });
  }
}

export async function handleMicrosoftSignIn(data: unknown, ports: MicrosoftSignInPorts, options: MicrosoftSignInOptions): Promise<MicrosoftSignInResponse> {
  const parsed = microsoftSignInRequestSchema.safeParse(data);
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid Microsoft sign-in request.');
  const clientId = options.clientId.trim();
  if (clientId.length === 0) {
    throw reasonError('failed-precondition', 'Sign in with Microsoft is not set up on the server.', 'microsoft_not_configured');
  }
  const now = options.now ? options.now() : new Date();
  const nowIso = now.toISOString();

  let identity: MicrosoftIdentity;
  try {
    identity = await verifyMicrosoftIdToken(parsed.data.idToken, { clientId, tenant: options.tenant, nonce: parsed.data.nonce, now, keys: ports.keys });
  } catch (error) {
    if (error instanceof MicrosoftTokenError) {
      logger.info('microsoftSignIn.token_rejected', { reason: error.reason });
      throw reasonError('unauthenticated', 'The Microsoft sign-in could not be verified. Please try again.', 'microsoft_token_invalid');
    }
    logger.error('microsoftSignIn.verify_failed', { errorMessage: error instanceof Error ? error.message.slice(0, 300) : '' });
    throw new HttpsError('unavailable', 'The Microsoft sign-in could not be verified right now. Please try again.');
  }

  let uid: string;
  let created = false;
  let linked = false;
  try {
    const known = await ports.findIdentity(identity.oid);
    if (known !== null) {
      uid = known.uid;
      await ports.touchIdentity(identity.oid, nowIso);
      if (identity.name !== null && (await ports.getDisplayName(uid)) === null) await saveDisplayName(uid, identity.name, ports);
    } else {
      const existing = identity.email === null ? null : await ports.getUserByEmail(identity.email);
      if (existing !== null) {
        uid = await linkByEmail(identity, existing, ports, nowIso);
        linked = true;
      } else {
        uid = microsoftUid(identity.oid);
        try {
          await ports.createUser({ uid, email: identity.email, emailVerified: identity.emailVerified, displayName: identity.name });
          created = true;
        } catch (error) {
          const code = adminErrorCode(error);
          if (code === 'auth/uid-already-exists') {
            // A retried first sign-in whose identity write did not land: same user, same uid.
            created = false;
          } else if (code === 'auth/email-already-exists' && identity.email !== null) {
            // Raced with another sign-up of this email: link when the email is proven, else refuse.
            const raced = await ports.getUserByEmail(identity.email);
            if (raced === null) throw error;
            uid = await linkByEmail(identity, raced, ports, nowIso);
            linked = true;
          } else {
            throw error;
          }
        }
        if (!linked) {
          await ports.saveIdentity(identity.oid, { uid, tid: identity.tid, email: identity.email, createdAt: nowIso, lastSignInAt: nowIso });
        }
      }
    }
    const customToken = await ports.createCustomToken(uid);
    logger.info('microsoftSignIn.completed', { uid, created, linked, consumer: identity.tid === CONSUMER_TENANT_ID });
    return { customToken, uid, created, linked };
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    logger.error('microsoftSignIn.failed', {
      errorName: error instanceof Error ? error.name : typeof error,
      errorMessage: error instanceof Error ? error.message.slice(0, 300) : '',
    });
    throw new HttpsError('internal', 'Sign in with Microsoft failed. Please try again.');
  }
}

export function firebaseMicrosoftSignInPorts(): MicrosoftSignInPorts {
  const db = adminDb();
  const auth = adminAuth();
  const identities = db.collection(MICROSOFT_IDENTITIES_COLLECTION);
  return {
    keys: microsoftJwks(),
    async findIdentity(oid) {
      const snapshot = await identities.doc(oid).get();
      if (!snapshot.exists) return null;
      const value = snapshot.data() as Partial<MicrosoftIdentityRecord> | undefined;
      if (!value || typeof value.uid !== 'string' || value.uid.length === 0) return null;
      return {
        uid: value.uid,
        tid: typeof value.tid === 'string' ? value.tid : '',
        email: typeof value.email === 'string' ? value.email : null,
        createdAt: typeof value.createdAt === 'string' ? value.createdAt : '',
        lastSignInAt: typeof value.lastSignInAt === 'string' ? value.lastSignInAt : '',
      };
    },
    async saveIdentity(oid, record) {
      await identities.doc(oid).set(record);
    },
    async touchIdentity(oid, lastSignInAtIso) {
      await identities.doc(oid).set({ lastSignInAt: lastSignInAtIso }, { merge: true });
    },
    async getUserByEmail(email) {
      try {
        const user = await auth.getUserByEmail(email);
        return { uid: user.uid, displayName: user.displayName ?? null };
      } catch (error) {
        if (adminErrorCode(error) === 'auth/user-not-found') return null;
        throw error;
      }
    },
    async getDisplayName(uid) {
      try {
        const user = await auth.getUser(uid);
        return user.displayName ?? null;
      } catch (error) {
        if (adminErrorCode(error) === 'auth/user-not-found') return null;
        throw error;
      }
    },
    async createUser(input) {
      await auth.createUser({
        uid: input.uid,
        ...(input.email === null ? {} : { email: input.email, emailVerified: input.emailVerified }),
        ...(input.displayName === null ? {} : { displayName: input.displayName }),
      });
    },
    async updateDisplayName(uid, displayName) {
      await auth.updateUser(uid, { displayName });
    },
    createCustomToken(uid) {
      return auth.createCustomToken(uid, { signInProvider: 'microsoft.com' });
    },
  };
}

export const microsoftSignIn = onCall(
  {
    region: FUNCTIONS_REGION,
    enforceAppCheck: false,
    timeoutSeconds: 30,
    memory: '256MiB',
    maxInstances: 10,
  },
  (request): Promise<MicrosoftSignInResponse> =>
    handleMicrosoftSignIn(request.data, firebaseMicrosoftSignInPorts(), {
      clientId: MICROSOFT_CLIENT_ID.value(),
      tenant: MICROSOFT_TENANT.value(),
    }),
);

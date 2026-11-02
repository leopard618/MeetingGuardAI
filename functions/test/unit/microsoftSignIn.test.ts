/**
 * microsoftSignIn: token verification against a key pair generated here, the tenant policy,
 * the identity resolution (identity -> verified email -> new user) and the JWKS cache.
 */
import { generateKeyPairSync, sign as cryptoSign, type JsonWebKey, type KeyObject } from 'node:crypto';

import { HttpsError } from 'firebase-functions/https';

import {
  CONSUMER_TENANT_ID,
  JWKS_CACHE_MS,
  JWKS_MIN_REFRESH_INTERVAL_MS,
  MicrosoftTokenError,
  createMicrosoftJwks,
  handleMicrosoftSignIn,
  microsoftUid,
  tenantAccepts,
  verifyMicrosoftIdToken,
  type JwksPort,
  type MicrosoftIdentityRecord,
  type MicrosoftSignInPorts,
} from '../../src/microsoftSignIn';

jest.mock('firebase-functions/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const CLIENT_ID = '11111111-2222-3333-4444-555555555555';
const WORK_TID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const OID = '0a1b2c3d-1111-2222-3333-444455556666';
const NONCE = 'raw-nonce-0123456789abcdef';
const NOW = new Date('2026-11-02T10:00:00.000Z');
const NOW_S = Math.floor(NOW.getTime() / 1000);

const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
const otherPair = generateKeyPairSync('rsa', { modulusLength: 2048 });

function jwkOf(key: KeyObject): JsonWebKey {
  const exported = key.export({ format: 'jwk' });
  return { kty: 'RSA', n: exported.n, e: exported.e };
}

function b64(value: object | string): string {
  return Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');
}

interface SignOptions {
  kid?: string;
  alg?: string;
  privateKey?: KeyObject;
  /** Replace the signature with garbage. */
  breakSignature?: boolean;
}

function claims(overrides: Record<string, unknown> = {}, tid: string = CONSUMER_TENANT_ID): Record<string, unknown> {
  return {
    aud: CLIENT_ID,
    iss: `https://login.microsoftonline.com/${tid}/v2.0`,
    tid,
    exp: NOW_S + 3600,
    nbf: NOW_S - 60,
    iat: NOW_S - 60,
    nonce: NONCE,
    oid: OID,
    sub: 'subject-1',
    email: 'Dusko@Outlook.com',
    name: 'Dusko',
    ...overrides,
  };
}

function signToken(payload: Record<string, unknown>, options: SignOptions = {}): string {
  const header = { alg: options.alg ?? 'RS256', typ: 'JWT', kid: options.kid ?? 'kid-1' };
  const input = `${b64(header)}.${b64(payload)}`;
  let signature = cryptoSign('RSA-SHA256', Buffer.from(input), options.privateKey ?? pair.privateKey).toString('base64url');
  if (options.breakSignature) signature = `${signature.slice(0, -4)}AAAA`;
  return `${input}.${signature}`;
}

function fakeKeys(keys: Record<string, JsonWebKey> = { 'kid-1': jwkOf(pair.publicKey) }, afterRefresh: Record<string, JsonWebKey> = {}): JwksPort & { refreshes: number } {
  const port = {
    refreshes: 0,
    async getKey(kid: string, options?: { refresh: boolean }) {
      if (options?.refresh) {
        port.refreshes += 1;
        return afterRefresh[kid] ?? keys[kid] ?? null;
      }
      return keys[kid] ?? null;
    },
  };
  return port;
}

interface FakeUser {
  uid: string;
  email: string | null;
  emailVerified: boolean;
  displayName: string | null;
}

function fakePorts(options: { users?: FakeUser[]; identities?: Record<string, MicrosoftIdentityRecord>; keys?: JwksPort } = {}) {
  const users = new Map<string, FakeUser>((options.users ?? []).map((user) => [user.uid, user]));
  const identities = new Map<string, MicrosoftIdentityRecord>(Object.entries(options.identities ?? {}));
  const calls: string[] = [];
  const ports: MicrosoftSignInPorts = {
    keys: options.keys ?? fakeKeys(),
    async findIdentity(oid) {
      return identities.get(oid) ?? null;
    },
    async saveIdentity(oid, record) {
      calls.push(`save:${oid}`);
      identities.set(oid, record);
    },
    async touchIdentity(oid, lastSignInAt) {
      calls.push(`touch:${oid}`);
      const record = identities.get(oid);
      if (record) identities.set(oid, { ...record, lastSignInAt });
    },
    async getUserByEmail(email) {
      const user = [...users.values()].find((candidate) => candidate.email === email);
      return user ? { uid: user.uid, displayName: user.displayName } : null;
    },
    async getDisplayName(uid) {
      return users.get(uid)?.displayName ?? null;
    },
    async createUser(input) {
      calls.push(`create:${input.uid}`);
      if (users.has(input.uid)) throw Object.assign(new Error('uid exists'), { code: 'auth/uid-already-exists' });
      if (input.email !== null && [...users.values()].some((user) => user.email === input.email)) {
        throw Object.assign(new Error('email exists'), { code: 'auth/email-already-exists' });
      }
      users.set(input.uid, { uid: input.uid, email: input.email, emailVerified: input.emailVerified, displayName: input.displayName });
    },
    async updateDisplayName(uid, displayName) {
      calls.push(`name:${uid}=${displayName}`);
      const user = users.get(uid);
      if (user) user.displayName = displayName;
    },
    async createCustomToken(uid) {
      calls.push(`token:${uid}`);
      return `custom-${uid}`;
    },
  };
  return { ports, users, identities, calls };
}

const OPTIONS = { clientId: CLIENT_ID, tenant: 'common', now: () => NOW };

describe('verifyMicrosoftIdToken', () => {
  const verify = (token: string, overrides: Partial<Parameters<typeof verifyMicrosoftIdToken>[1]> = {}) =>
    verifyMicrosoftIdToken(token, { clientId: CLIENT_ID, tenant: 'common', nonce: NONCE, now: NOW, keys: fakeKeys(), ...overrides });

  it('accepts a valid consumer token and normalizes the identity', async () => {
    await expect(verify(signToken(claims()))).resolves.toEqual({
      oid: OID,
      tid: CONSUMER_TENANT_ID,
      sub: 'subject-1',
      email: 'dusko@outlook.com',
      name: 'Dusko',
      emailVerified: true,
    });
  });

  it('treats a work account as unverified unless xms_edov is true, and falls back to preferred_username', async () => {
    const work = await verify(signToken(claims({ email: undefined, preferred_username: 'Ana@Contoso.com' }, WORK_TID)));
    expect(work).toMatchObject({ tid: WORK_TID, email: 'ana@contoso.com', emailVerified: false });
    const proven = await verify(signToken(claims({ xms_edov: true }, WORK_TID)));
    expect(proven.emailVerified).toBe(true);
    const noEmail = await verify(signToken(claims({ email: undefined, preferred_username: 'not-an-email', name: '   ' }, WORK_TID)));
    expect(noEmail).toMatchObject({ email: null, name: null });
  });

  it.each<[string, () => string]>([
    ['bad signature', () => signToken(claims(), { breakSignature: true })],
    ['another key', () => signToken(claims(), { privateKey: otherPair.privateKey })],
    ['wrong audience', () => signToken(claims({ aud: 'someone-else' }))],
    ['wrong issuer', () => signToken(claims({ iss: 'https://login.microsoftonline.com/common/v2.0' }))],
    ['issuer of another tenant', () => signToken(claims({ iss: `https://login.microsoftonline.com/${WORK_TID}/v2.0` }))],
    ['missing tid', () => signToken(claims({ tid: undefined }))],
    ['expired', () => signToken(claims({ exp: NOW_S - 61 }))],
    ['not yet valid', () => signToken(claims({ nbf: NOW_S + 61 }))],
    ['missing iat', () => signToken(claims({ iat: undefined }))],
    ['nonce mismatch', () => signToken(claims({ nonce: 'other-nonce-0123456789' }))],
    ['missing nonce', () => signToken(claims({ nonce: undefined }))],
    ['missing oid', () => signToken(claims({ oid: 'not-a-guid' }))],
    ['missing sub', () => signToken(claims({ sub: '' }))],
    ['alg none', () => `${b64({ alg: 'none', kid: 'kid-1' })}.${b64(claims())}.`],
    ['alg HS256', () => signToken(claims(), { alg: 'HS256' })],
    ['missing kid', () => `${b64({ alg: 'RS256' })}.${b64(claims())}.${b64('sig')}`],
    ['malformed', () => 'not.a-token'],
    ['non-JSON header', () => `${b64('???')}.${b64(claims())}.${b64('sig')}`],
    ['empty signature', () => `${b64({ alg: 'RS256', kid: 'kid-1' })}.${b64(claims())}.`],
  ])('rejects %s', async (_label, make) => {
    await expect(verify(make())).rejects.toBeInstanceOf(MicrosoftTokenError);
  });

  it('tolerates 60 s of clock skew on exp and nbf', async () => {
    await expect(verify(signToken(claims({ exp: NOW_S - 30 })))).resolves.toBeDefined();
    await expect(verify(signToken(claims({ nbf: NOW_S + 30 })))).resolves.toBeDefined();
  });

  it('asks the key set to refresh once for an unknown kid, then gives up', async () => {
    const rotated = fakeKeys({}, { 'kid-2': jwkOf(pair.publicKey) });
    await expect(verify(signToken(claims(), { kid: 'kid-2' }), { keys: rotated })).resolves.toBeDefined();
    expect(rotated.refreshes).toBe(1);
    const unknown = fakeKeys({}, {});
    await expect(verify(signToken(claims(), { kid: 'kid-9' }), { keys: unknown })).rejects.toThrow('unknown signing key');
    expect(unknown.refreshes).toBe(1);
  });

  it('applies the tenant policy', () => {
    expect(tenantAccepts('common', WORK_TID)).toBe(true);
    expect(tenantAccepts('', CONSUMER_TENANT_ID)).toBe(true);
    expect(tenantAccepts('consumers', CONSUMER_TENANT_ID)).toBe(true);
    expect(tenantAccepts('consumers', WORK_TID)).toBe(false);
    expect(tenantAccepts('organizations', WORK_TID)).toBe(true);
    expect(tenantAccepts('organizations', CONSUMER_TENANT_ID)).toBe(false);
    expect(tenantAccepts(WORK_TID.toUpperCase(), WORK_TID)).toBe(true);
    expect(tenantAccepts(WORK_TID, CONSUMER_TENANT_ID)).toBe(false);
  });

  it('rejects a token of a tenant outside the policy', async () => {
    await expect(verify(signToken(claims()), { tenant: 'organizations' })).rejects.toThrow('tenant not accepted');
    await expect(verify(signToken(claims({}, WORK_TID)), { tenant: 'consumers' })).rejects.toThrow('tenant not accepted');
    await expect(verify(signToken(claims({}, WORK_TID)), { tenant: WORK_TID })).resolves.toBeDefined();
  });
});

describe('handleMicrosoftSignIn', () => {
  const request = (overrides: Record<string, unknown> = {}, tid?: string, sign?: SignOptions) => ({
    idToken: signToken(claims(overrides, tid), sign),
    nonce: NONCE,
  });

  it('creates a new user ms_<oid>, stores the identity and mints a custom token', async () => {
    const { ports, users, identities, calls } = fakePorts();
    await expect(handleMicrosoftSignIn(request(), ports, OPTIONS)).resolves.toEqual({
      customToken: `custom-${microsoftUid(OID)}`,
      uid: `ms_${OID}`,
      created: true,
      linked: false,
    });
    expect(users.get(`ms_${OID}`)).toEqual({ uid: `ms_${OID}`, email: 'dusko@outlook.com', emailVerified: true, displayName: 'Dusko' });
    expect(identities.get(OID)).toEqual({
      uid: `ms_${OID}`,
      tid: CONSUMER_TENANT_ID,
      email: 'dusko@outlook.com',
      createdAt: NOW.toISOString(),
      lastSignInAt: NOW.toISOString(),
    });
    expect(calls).toEqual([`create:ms_${OID}`, `save:${OID}`, `token:ms_${OID}`]);
  });

  it('signs a returning account in through its identity, touching lastSignInAt and filling a missing name', async () => {
    const { ports, calls, identities } = fakePorts({
      users: [{ uid: 'u-google', email: 'dusko@outlook.com', emailVerified: true, displayName: null }],
      identities: { [OID]: { uid: 'u-google', tid: CONSUMER_TENANT_ID, email: 'dusko@outlook.com', createdAt: '2026-01-01T00:00:00.000Z', lastSignInAt: '2026-01-01T00:00:00.000Z' } },
    });
    await expect(handleMicrosoftSignIn(request(), ports, OPTIONS)).resolves.toMatchObject({ uid: 'u-google', created: false, linked: false });
    expect(identities.get(OID)?.lastSignInAt).toBe(NOW.toISOString());
    expect(calls).toEqual([`touch:${OID}`, 'name:u-google=Dusko', 'token:u-google']);
  });

  it('links a personal Microsoft account to the existing user with the same email', async () => {
    const { ports, identities, calls } = fakePorts({ users: [{ uid: 'u-google', email: 'dusko@outlook.com', emailVerified: true, displayName: 'D.' }] });
    await expect(handleMicrosoftSignIn(request(), ports, OPTIONS)).resolves.toEqual({ customToken: 'custom-u-google', uid: 'u-google', created: false, linked: true });
    expect(identities.get(OID)?.uid).toBe('u-google');
    expect(calls).toEqual([`save:${OID}`, 'token:u-google']);
  });

  it('links a work account only when the tenant proved the email domain (xms_edov)', async () => {
    const existing = { uid: 'u-mail', email: 'ana@contoso.com', emailVerified: true, displayName: 'Ana' };
    const refused = fakePorts({ users: [existing] });
    await expect(handleMicrosoftSignIn(request({ email: 'ana@contoso.com' }, WORK_TID), refused.ports, OPTIONS)).rejects.toMatchObject({
      code: 'already-exists',
      details: { reason: 'email_in_use' },
    });
    expect(refused.calls).toEqual([]);
    const accepted = fakePorts({ users: [existing] });
    await expect(handleMicrosoftSignIn(request({ email: 'ana@contoso.com', xms_edov: true }, WORK_TID), accepted.ports, OPTIONS)).resolves.toMatchObject({
      uid: 'u-mail',
      linked: true,
    });
  });

  it('creates an unverified user for a work account with an unproven email', async () => {
    const { ports, users } = fakePorts();
    await expect(handleMicrosoftSignIn(request({ email: 'ana@contoso.com' }, WORK_TID), ports, OPTIONS)).resolves.toMatchObject({ created: true });
    expect(users.get(`ms_${OID}`)).toMatchObject({ email: 'ana@contoso.com', emailVerified: false });
  });

  it('reuses the uid when a retried first sign-in finds the user already created', async () => {
    const { ports, identities } = fakePorts({ users: [{ uid: `ms_${OID}`, email: null, emailVerified: false, displayName: null }] });
    await expect(handleMicrosoftSignIn(request({ email: undefined, preferred_username: 'x' }), ports, OPTIONS)).resolves.toMatchObject({
      uid: `ms_${OID}`,
      created: false,
      linked: false,
    });
    expect(identities.get(OID)?.uid).toBe(`ms_${OID}`);
  });

  it('answers failed-precondition when the client id is not configured', async () => {
    const { ports, calls } = fakePorts();
    await expect(handleMicrosoftSignIn(request(), ports, { ...OPTIONS, clientId: '  ' })).rejects.toMatchObject({
      code: 'failed-precondition',
      details: { reason: 'microsoft_not_configured' },
    });
    expect(calls).toEqual([]);
  });

  it('answers unauthenticated with reason microsoft_token_invalid for a rejected token', async () => {
    const { ports, calls } = fakePorts();
    await expect(handleMicrosoftSignIn(request({ aud: 'other' }), ports, OPTIONS)).rejects.toMatchObject({
      code: 'unauthenticated',
      details: { reason: 'microsoft_token_invalid' },
    });
    await expect(handleMicrosoftSignIn({ idToken: signToken(claims()), nonce: 'wrong-nonce-0123456789' }, ports, OPTIONS)).rejects.toMatchObject({
      code: 'unauthenticated',
    });
    expect(calls).toEqual([]);
  });

  it('rejects a malformed request', async () => {
    const { ports } = fakePorts();
    await expect(handleMicrosoftSignIn({ idToken: '', nonce: NONCE }, ports, OPTIONS)).rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(handleMicrosoftSignIn({ idToken: 'x', nonce: 'short' }, ports, OPTIONS)).rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(handleMicrosoftSignIn(null, ports, OPTIONS)).rejects.toBeInstanceOf(HttpsError);
  });

  it('answers unavailable when the key set cannot be fetched, and internal for other port failures', async () => {
    const failingKeys: JwksPort = { getKey: async () => Promise.reject(new Error('network')) };
    const { ports } = fakePorts({ keys: failingKeys });
    await expect(handleMicrosoftSignIn(request(), ports, OPTIONS)).rejects.toMatchObject({ code: 'unavailable' });
    const broken = fakePorts();
    broken.ports.createCustomToken = async () => Promise.reject(new Error('mint failed'));
    await expect(handleMicrosoftSignIn(request(), broken.ports, OPTIONS)).rejects.toMatchObject({ code: 'internal' });
  });

  it('keeps a failed display-name update best effort', async () => {
    const { ports } = fakePorts({ users: [{ uid: 'u-google', email: 'dusko@outlook.com', emailVerified: true, displayName: null }] });
    ports.updateDisplayName = async () => Promise.reject(new Error('nope'));
    await expect(handleMicrosoftSignIn(request(), ports, OPTIONS)).resolves.toMatchObject({ uid: 'u-google', linked: true });
  });
});

describe('createMicrosoftJwks', () => {
  function document(kids: string[]) {
    const jwk = jwkOf(pair.publicKey);
    return { keys: kids.map((kid) => ({ kid, kty: 'RSA', use: 'sig', n: jwk.n, e: jwk.e })) };
  }

  function fetchOf(responses: (() => object)[]) {
    const fetchImpl = jest.fn(async () => {
      const next = responses.shift();
      if (!next) throw new Error('unexpected fetch');
      const body = next();
      return { ok: true, status: 200, json: async () => body } as unknown as Response;
    });
    return fetchImpl as unknown as typeof fetch & jest.Mock;
  }

  it('fetches once, serves from the cache and refetches for an unknown kid after the minimum interval', async () => {
    let clock = 1_000_000;
    const fetchImpl = fetchOf([() => document(['kid-1']), () => document(['kid-1', 'kid-2'])]);
    const jwks = createMicrosoftJwks({ fetchImpl, now: () => clock });
    await expect(jwks.getKey('kid-1')).resolves.toMatchObject({ kty: 'RSA' });
    await expect(jwks.getKey('kid-1')).resolves.toMatchObject({ kty: 'RSA' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    // Too soon after the last fetch: no refetch, still unknown.
    await expect(jwks.getKey('kid-2', { refresh: true })).resolves.toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    clock += JWKS_MIN_REFRESH_INTERVAL_MS;
    await expect(jwks.getKey('kid-2', { refresh: true })).resolves.toMatchObject({ kty: 'RSA' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('refetches a stale key set and keeps the old keys when the refetch fails', async () => {
    let clock = 1_000_000;
    const fetchImpl = jest.fn<Promise<Response>, [Parameters<typeof fetch>[0], RequestInit | undefined]>();
    fetchImpl.mockResolvedValueOnce({ ok: true, status: 200, json: async () => document(['kid-1']) } as unknown as Response);
    fetchImpl.mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) } as unknown as Response);
    const jwks = createMicrosoftJwks({ fetchImpl: fetchImpl as unknown as typeof fetch, now: () => clock });
    await expect(jwks.getKey('kid-1')).resolves.not.toBeNull();
    clock += JWKS_CACHE_MS;
    await expect(jwks.getKey('kid-1')).resolves.not.toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('throws when the first fetch fails (no keys to fall back on)', async () => {
    const fetchImpl = jest.fn(async () => Promise.reject(new Error('offline')));
    const jwks = createMicrosoftJwks({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(jwks.getKey('kid-1')).rejects.toThrow('offline');
  });
});

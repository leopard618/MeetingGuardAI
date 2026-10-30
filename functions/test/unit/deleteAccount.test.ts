import { HttpsError } from 'firebase-functions/https';

import {
  deleteAccountData,
  handleDeleteAccount,
  isUserNotFound,
  type AccountDeletionPorts,
  type DeletionCaller,
} from '../../src/deleteAccount';

// Signed in one minute ago (Date.now() is used by default).
const recent: DeletionCaller = { uid: 'u1', authTimeSeconds: Math.floor(Date.now() / 1000) - 60 };

// Hoisted above the imports by ts-jest.
jest.mock('firebase-functions/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

function fakePorts(options: { failOn?: string; userExists?: boolean } = {}) {
  const calls: string[] = [];
  const ports: AccountDeletionPorts = {
    recordDeletion: jest.fn(async (uid: string, deletedAtIso: string) => {
      calls.push(`record:${uid}@${deletedAtIso}`);
    }),
    recursiveDelete: jest.fn(async (path: string) => {
      calls.push(`recursive:${path}`);
      if (options.failOn === path) throw new Error('unavailable');
    }),
    deleteDocument: jest.fn(async (path: string) => {
      calls.push(`doc:${path}`);
    }),
    deleteAuthUser: jest.fn(async (uid: string) => {
      calls.push(`auth:${uid}`);
      return options.userExists ?? true;
    }),
    revokeRefreshTokens: jest.fn(async (uid: string) => {
      calls.push(`revoke:${uid}`);
      return options.userExists ?? true;
    }),
    deleteWhatsAppData: jest.fn(async (uid: string) => {
      calls.push(`whatsapp:${uid}`);
    }),
    deleteZoomRegistry: jest.fn(async (uid: string) => {
      calls.push(`zoom:${uid}`);
    }),
  };
  return { ports, calls };
}

describe('deleteAccount', () => {
  it('records the deletion, revokes tokens, deletes user data, entitlement, usage, WhatsApp state, the auth user, then sweeps late writes', async () => {
    const { ports, calls } = fakePorts();
    await expect(deleteAccountData('u1', ports, new Date('2026-10-05T10:00:00.000Z'))).resolves.toEqual({ deleted: true });
    expect(calls).toEqual([
      'record:u1@2026-10-05T10:00:00.000Z',
      'revoke:u1',
      'recursive:users/u1',
      'doc:entitlements/u1',
      'recursive:usage/u1',
      'whatsapp:u1',
      'zoom:u1',
      'auth:u1',
      'recursive:users/u1',
    ]);
  });

  it('is idempotent when the auth user is already gone', async () => {
    const { ports } = fakePorts({ userExists: false });
    await expect(handleDeleteAccount(recent, { confirm: true }, () => ports)).resolves.toEqual({ deleted: true });
  });

  it('requires authentication and explicit confirmation', async () => {
    const { ports, calls } = fakePorts();
    await expect(handleDeleteAccount(null, { confirm: true }, () => ports)).rejects.toMatchObject({ code: 'unauthenticated' });
    await expect(handleDeleteAccount(recent, {}, () => ports)).rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(handleDeleteAccount(recent, { confirm: 'yes' }, () => ports)).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(calls).toEqual([]);
  });

  it('stops before deleting the auth user when data deletion fails', async () => {
    const { ports, calls } = fakePorts({ failOn: 'usage/u1' });
    const error = await handleDeleteAccount(recent, { confirm: true }, () => ports).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(HttpsError);
    expect((error as HttpsError).code).toBe('internal');
    expect(calls).not.toContain('auth:u1');
  });

  it('requires a recent sign-in (a stolen or long-lived session cannot delete the account)', async () => {
    const { ports, calls } = fakePorts();
    const nowMs = Date.parse('2026-10-05T12:00:00.000Z');
    const stale: DeletionCaller = { uid: 'u1', authTimeSeconds: nowMs / 1000 - 10 * 60 };
    const error = await handleDeleteAccount(stale, { confirm: true }, () => ports, () => nowMs).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(HttpsError);
    expect((error as HttpsError).code).toBe('failed-precondition');
    expect((error as HttpsError).details).toEqual({ reason: 'requires_recent_login' });
    await expect(
      handleDeleteAccount({ uid: 'u1', authTimeSeconds: null }, { confirm: true }, () => ports, () => nowMs),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(calls).toEqual([]);

    const fresh: DeletionCaller = { uid: 'u1', authTimeSeconds: nowMs / 1000 - 30 };
    await expect(handleDeleteAccount(fresh, { confirm: true }, () => ports, () => nowMs)).resolves.toEqual({ deleted: true });
  });

  it('recognizes the Admin SDK user-not-found error', () => {
    expect(isUserNotFound({ code: 'auth/user-not-found' })).toBe(true);
    expect(isUserNotFound({ code: 'auth/internal-error' })).toBe(false);
    expect(isUserNotFound(new Error('x'))).toBe(false);
  });
});

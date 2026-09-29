import { HttpsError } from 'firebase-functions/https';

import { deleteAccountData, handleDeleteAccount, isUserNotFound, type AccountDeletionPorts } from '../../src/deleteAccount';

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
  };
  return { ports, calls };
}

describe('deleteAccount', () => {
  it('revokes tokens, deletes user data, entitlement, usage, the auth user, then sweeps late writes', async () => {
    const { ports, calls } = fakePorts();
    await expect(deleteAccountData('u1', ports)).resolves.toEqual({ deleted: true });
    expect(calls).toEqual([
      'revoke:u1',
      'recursive:users/u1',
      'doc:entitlements/u1',
      'recursive:usage/u1',
      'auth:u1',
      'recursive:users/u1',
    ]);
  });

  it('is idempotent when the auth user is already gone', async () => {
    const { ports } = fakePorts({ userExists: false });
    await expect(handleDeleteAccount('u1', { confirm: true }, () => ports)).resolves.toEqual({ deleted: true });
  });

  it('requires authentication and explicit confirmation', async () => {
    const { ports, calls } = fakePorts();
    await expect(handleDeleteAccount(null, { confirm: true }, () => ports)).rejects.toMatchObject({ code: 'unauthenticated' });
    await expect(handleDeleteAccount('u1', {}, () => ports)).rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(handleDeleteAccount('u1', { confirm: 'yes' }, () => ports)).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(calls).toEqual([]);
  });

  it('stops before deleting the auth user when data deletion fails', async () => {
    const { ports, calls } = fakePorts({ failOn: 'usage/u1' });
    const error = await handleDeleteAccount('u1', { confirm: true }, () => ports).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(HttpsError);
    expect((error as HttpsError).code).toBe('internal');
    expect(calls).not.toContain('auth:u1');
  });

  it('recognizes the Admin SDK user-not-found error', () => {
    expect(isUserNotFound({ code: 'auth/user-not-found' })).toBe(true);
    expect(isUserNotFound({ code: 'auth/internal-error' })).toBe(false);
    expect(isUserNotFound(new Error('x'))).toBe(false);
  });
});

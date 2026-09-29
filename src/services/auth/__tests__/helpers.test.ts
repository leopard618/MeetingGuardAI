import type { AuthUser } from '../../../core/types';
import { legacyCancelled, legacyFailure, legacySuccess, sameIdentity, toLegacyAuthUserView } from '../legacyView';
import { createSerialQueue } from '../serialQueue';
import { createSessionCleanupRegistry } from '../sessionCleanup';

const user: AuthUser = {
  uid: 'u1',
  email: 'ana@example.com',
  displayName: 'Ana',
  photoURL: 'https://example.com/a.png',
  emailVerified: true,
  providerIds: ['google.com'],
};

describe('legacy view', () => {
  it('exposes the legacy and the new user field names', () => {
    expect(toLegacyAuthUserView(user)).toEqual({
      id: 'u1',
      uid: 'u1',
      email: 'ana@example.com',
      name: 'Ana',
      displayName: 'Ana',
      picture: 'https://example.com/a.png',
      photoURL: 'https://example.com/a.png',
      emailVerified: true,
      providerIds: ['google.com'],
    });
  });

  it('builds the legacy sign-in result shapes', () => {
    expect(legacySuccess(user)).toMatchObject({ success: true, user: { id: 'u1' } });
    expect(legacyCancelled()).toEqual({ success: false, cancelled: true });
    expect(legacyFailure('Nope', 'offline', null)).toEqual({
      success: false,
      error: 'Nope',
      errorCode: 'offline',
      errorReason: null,
    });
  });

  it('compares identities field by field', () => {
    expect(sameIdentity(user, { ...user, providerIds: ['google.com'] })).toBe(true);
    expect(sameIdentity(user, { ...user, displayName: 'Ana B' })).toBe(false);
    expect(sameIdentity(user, null)).toBe(false);
    expect(sameIdentity(null, null)).toBe(true);
  });
});

describe('createSerialQueue', () => {
  it('runs tasks one at a time in order, and a failure does not block the next task', async () => {
    const queue = createSerialQueue();
    const events: string[] = [];
    let running = 0;
    let maxRunning = 0;
    const task = (name: string, fail = false) => async () => {
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      events.push(`start:${name}`);
      await new Promise((resolve) => setTimeout(resolve, 5));
      events.push(`end:${name}`);
      running -= 1;
      if (fail) throw new Error(name);
      return name;
    };

    const a = queue.run(task('a'));
    const b = queue.run(task('b', true));
    const c = queue.run(task('c'));
    await expect(a).resolves.toBe('a');
    await expect(b).rejects.toThrow('b');
    await expect(c).resolves.toBe('c');
    await queue.idle();

    expect(maxRunning).toBe(1);
    expect(events).toEqual(['start:a', 'end:a', 'start:b', 'end:b', 'start:c', 'end:c']);
    expect(queue.size).toBe(0);
  });
});

describe('session cleanup registry', () => {
  it('runs every hook in order, isolates failures and supports unregistering', async () => {
    const registry = createSessionCleanupRegistry();
    const calls: string[] = [];
    registry.register('one', ({ uid }) => {
      calls.push(`one:${uid}`);
    });
    registry.register('boom', () => {
      throw new Error('boom');
    });
    const unregister = registry.register('two', async ({ reason }) => {
      calls.push(`two:${reason}`);
    });

    const failures = await registry.run({ uid: 'u1', reason: 'sign_out' });
    expect(calls).toEqual(['one:u1', 'two:sign_out']);
    expect(failures.map((failure) => failure.name)).toEqual(['boom']);

    unregister();
    expect(registry.names()).toEqual(['one', 'boom']);
  });
});

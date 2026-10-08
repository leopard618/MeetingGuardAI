import { createEventBus } from '../events';

interface TestEvents {
  ping: { n: number };
  other: { s: string };
}

describe('createEventBus', () => {
  it('delivers in registration order and supports unsubscribe', () => {
    const bus = createEventBus<TestEvents>();
    const calls: string[] = [];
    const offA = bus.on('ping', ({ n }) => {
      calls.push(`a${n}`);
    });
    bus.on('ping', ({ n }) => {
      calls.push(`b${n}`);
    });
    bus.emit('ping', { n: 1 });
    offA();
    bus.emit('ping', { n: 2 });
    expect(calls).toEqual(['a1', 'b1', 'b2']);
    expect(bus.listenerCount('ping')).toBe(1);
  });

  it('isolates throwing and rejecting handlers', async () => {
    const errors: string[] = [];
    const bus = createEventBus<TestEvents>({ onHandlerError: (_error, event) => errors.push(event) });
    const received: number[] = [];
    bus.on('ping', () => {
      throw new Error('sync boom');
    });
    bus.on('ping', async () => {
      throw new Error('async boom');
    });
    bus.on('ping', ({ n }) => {
      received.push(n);
    });
    expect(() => bus.emit('ping', { n: 7 })).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
    expect(received).toEqual([7]);
    expect(errors).toEqual(['ping', 'ping']);
  });

  it('once fires a single time and handlers added during emit wait for the next emit', () => {
    const bus = createEventBus<TestEvents>();
    const seen: string[] = [];
    bus.once('other', ({ s }) => {
      seen.push(`once:${s}`);
      bus.on('other', ({ s: later }) => {
        seen.push(`late:${later}`);
      });
    });
    bus.emit('other', { s: 'x' });
    bus.emit('other', { s: 'y' });
    expect(seen).toEqual(['once:x', 'late:y']);
    bus.clear();
    expect(bus.listenerCount()).toBe(0);
  });
});

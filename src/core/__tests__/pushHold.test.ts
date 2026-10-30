import { createPushHold, PUSH_HOLD_MAX_MS } from '../pushHold';

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('createPushHold', () => {
  it('holds until released and tells the listeners', () => {
    const holds = createPushHold();
    const released: string[] = [];
    holds.onRelease((id) => released.push(id));

    const release = holds.hold('m1');
    expect(holds.isHeld('m1')).toBe(true);
    expect(holds.isHeld('m2')).toBe(false);

    release();
    expect(holds.isHeld('m1')).toBe(false);
    expect(released).toEqual(['m1']);
    // A second release of the same hold is a no-op.
    release();
    expect(released).toEqual(['m1']);
  });

  it('nests: both holds on one meeting must be released', () => {
    const holds = createPushHold();
    const first = holds.hold('m1');
    const second = holds.hold('m1');
    first();
    expect(holds.isHeld('m1')).toBe(true);
    second();
    expect(holds.isHeld('m1')).toBe(false);
  });

  it('expires on its own so a lost release never blocks a push', () => {
    const holds = createPushHold();
    const released: string[] = [];
    holds.onRelease((id) => released.push(id));
    holds.hold('m1');
    jest.advanceTimersByTime(PUSH_HOLD_MAX_MS - 1);
    expect(holds.isHeld('m1')).toBe(true);
    jest.advanceTimersByTime(1);
    expect(holds.isHeld('m1')).toBe(false);
    expect(released).toEqual(['m1']);
  });

  it('clear releases everything and unsubscribed listeners stay quiet', () => {
    const holds = createPushHold();
    const released: string[] = [];
    const stop = holds.onRelease((id) => released.push(id));
    holds.hold('m1');
    holds.hold('m2');
    stop();
    holds.clear();
    expect(holds.isHeld('m1')).toBe(false);
    expect(holds.isHeld('m2')).toBe(false);
    expect(released).toEqual([]);
  });
});

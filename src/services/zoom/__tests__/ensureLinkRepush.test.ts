/**
 * Regression: the Zoom link is written SERVER-side, so the calendar engine's origin filter never
 * pushed it to Google - attendee invitation emails had no join link (user report, 2026-10-02).
 * ensureLink must re-announce the meeting as a pushable local change after the link lands.
 */
import { appEvents, createEventBus, type AppEventMap } from '../../../core/events';
import { createPushHold } from '../../../core/pushHold';
import { createZoomService, type ZoomTransport } from '../zoomService';

// The singleton default wiring is not under test: firebase/* ships untransformed ESM.
jest.mock('firebase/functions', () => ({ httpsCallable: jest.fn() }));
jest.mock('../../../config/firebase', () => ({ functions: null, isFirebaseReady: false }));
jest.mock('../../data', () => ({ meetingRepository: { flushOutbox: jest.fn(async () => ({ flushed: 0, pending: 0, rejected: 0 })) } }));
function okTransport(): ZoomTransport {
  return {
    call: jest.fn(async (name: string) => {
      if (name === 'zoomStatus') return { configured: true };
      return { url: 'https://us05web.zoom.us/j/1', password: 'x', zoomMeetingId: '1' };
    }),
  } as unknown as ZoomTransport;
}

describe('ensureLink re-push announcement', () => {
  it('emits a pushable meetings:changed after the link lands', async () => {
    const bus = createEventBus<AppEventMap>();
    const service = createZoomService({ getTransport: okTransport, events: bus });
    bus.emit('session:started', { uid: 'u1', restored: false });

    const seen: { uid: string; origin?: string; reason: string; changedIds?: string[] }[] = [];
    const stop = appEvents.on('meetings:changed', (event) => {
      if (event.changedIds?.includes('m1')) seen.push(event);
    });
    try {
      await service.ensureLink('m1');
    } finally {
      stop();
    }

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ uid: 'u1', reason: 'updated', origin: 'user', changedIds: ['m1'] });
  });

  it('holds the calendar push while the link is created and releases it after the announcement', async () => {
    const bus = createEventBus<AppEventMap>();
    const pushHold = createPushHold();
    let resolveCall: ((value: unknown) => void) | undefined;
    const transport = {
      call: jest.fn((name: string) => {
        if (name === 'zoomStatus') return Promise.resolve({ configured: true });
        return new Promise((resolve) => {
          resolveCall = resolve;
        });
      }),
    } as unknown as ZoomTransport;
    const service = createZoomService({ getTransport: () => transport, events: bus, pushHold });
    bus.emit('session:started', { uid: 'u1', restored: false });

    const order: string[] = [];
    const stop = appEvents.on('meetings:changed', (event) => {
      if (event.changedIds?.includes('m3')) order.push(pushHold.isHeld('m3') ? 'announced while held' : 'announced after release');
    });
    pushHold.onRelease((id) => order.push(`released ${id}`));
    try {
      const pending = service.ensureLink('m3');
      // Held from the first tick, before the status and create calls even start.
      expect(pushHold.isHeld('m3')).toBe(true);
      for (let i = 0; i < 50 && resolveCall === undefined; i += 1) await new Promise((r) => setTimeout(r, 0));
      expect(pushHold.isHeld('m3')).toBe(true);
      resolveCall?.({ url: 'https://us05web.zoom.us/j/3', password: 'x', zoomMeetingId: '3' });
      await pending;
    } finally {
      stop();
    }
    expect(pushHold.isHeld('m3')).toBe(false);
    // The engine queues the meeting on the announcement, then flushes it on the release.
    expect(order).toEqual(['announced while held', 'released m3']);
  });

  it('announces and releases after a failure too, so the held invitation still leaves', async () => {
    const bus = createEventBus<AppEventMap>();
    const pushHold = createPushHold();
    const transport = {
      call: jest.fn(async (name: string) => {
        if (name === 'zoomStatus') return { configured: true };
        throw Object.assign(new Error('boom'), { code: 'functions/internal', details: { reason: 'upstream_error' } });
      }),
    } as unknown as ZoomTransport;
    const service = createZoomService({ getTransport: () => transport, events: bus, pushHold });
    bus.emit('session:started', { uid: 'u1', restored: false });

    const seen: unknown[] = [];
    const stop = appEvents.on('meetings:changed', (event) => {
      if (event.changedIds?.includes('m4')) seen.push(event);
    });
    try {
      await expect(service.ensureLink('m4')).rejects.toMatchObject({ code: 'upstream_error' });
    } finally {
      stop();
    }
    expect(seen).toHaveLength(1);
    expect(pushHold.isHeld('m4')).toBe(false);
    expect(service.linkFailure('m4')).toBe('upstream_error');
  });

  it('does not emit after the session ended mid-flight', async () => {
    const bus = createEventBus<AppEventMap>();
    let resolveCall: ((value: unknown) => void) | undefined;
    const transport = {
      call: jest.fn((name: string) => {
        if (name === 'zoomStatus') return Promise.resolve({ configured: true });
        return new Promise((resolve) => {
          resolveCall = resolve;
        });
      }),
    } as unknown as ZoomTransport;
    const service = createZoomService({ getTransport: () => transport, events: bus });
    bus.emit('session:started', { uid: 'u1', restored: false });

    const seen: unknown[] = [];
    const stop = appEvents.on('meetings:changed', (event) => {
      if (event.changedIds?.includes('m2')) seen.push(event);
    });
    try {
      const pending = service.ensureLink('m2');
      // Wait until the create call actually started (ensureLink awaits status first), THEN end
      // the session and let the server answer arrive late.
      for (let i = 0; i < 50 && resolveCall === undefined; i += 1) await new Promise((r) => setTimeout(r, 0));
      bus.emit('session:ended', { uid: 'u1', reason: 'sign_out' });
      resolveCall?.({ url: 'https://us05web.zoom.us/j/2', password: null, zoomMeetingId: '2' });
      await pending;
    } finally {
      stop();
    }
    expect(seen).toHaveLength(0);
  });
});

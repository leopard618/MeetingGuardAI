import { createWhatsAppMessagesService, registerWhatsAppZoneRefresh } from '../whatsappMessages';

jest.mock('firebase/functions', () => ({ httpsCallable: jest.fn() }));
jest.mock('../../../config/firebase', () => ({ functions: null, isFirebaseReady: false }));

const OFF = { agenda: false, debrief: false, confirmations: false, commitments: false, reminders: false };
const RESPONSE = { available: true, linked: true, switches: OFF, offered: { ...OFF, agenda: true }, stoppedAt: null };

describe('whatsappMessages service (M13)', () => {
  it('get sends the device zone; set sends the switches and the wording version', async () => {
    const calls: unknown[] = [];
    const service = createWhatsAppMessagesService({
      getTransport: () => ({
        call: async (request: unknown) => {
          calls.push(request);
          return RESPONSE;
        },
      }),
      deviceTimeZone: () => 'America/Costa_Rica',
    });
    expect(await service.get()).toEqual(RESPONSE);
    await service.set({ ...OFF, agenda: true });
    expect(calls).toEqual([
      { op: 'get', deviceTimeZone: 'America/Costa_Rica' },
      { op: 'set', switches: { ...OFF, agenda: true }, deviceTimeZone: 'America/Costa_Rica', wordingVersion: 1 },
    ]);
  });

  it('a build without Firebase answers not_configured; a malformed answer is an upstream error', async () => {
    await expect(createWhatsAppMessagesService({ getTransport: () => null }).get()).rejects.toMatchObject({ code: 'not_configured' });
    const bad = createWhatsAppMessagesService({ getTransport: () => ({ call: async () => ({ nope: true }) }), deviceTimeZone: () => 'UTC' });
    await expect(bad.get()).rejects.toMatchObject({ code: 'upstream_error' });
  });

  it('maps the server reason (Link WhatsApp first)', async () => {
    const service = createWhatsAppMessagesService({
      getTransport: () => ({
        call: async () => {
          throw Object.assign(new Error('x'), { code: 'functions/invalid-argument', details: { reason: 'invalid_request' } });
        },
      }),
      deviceTimeZone: () => 'UTC',
    });
    await expect(service.set(OFF)).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('refreshes the zone once per session start, silently', async () => {
    const handlers: (() => void)[] = [];
    const get = jest.fn(async () => {
      throw new Error('offline');
    });
    const off = registerWhatsAppZoneRefresh({ on: ((_name: string, handler: () => void) => {
      handlers.push(handler);
      return () => undefined;
    }) as never }, { get, set: jest.fn() });
    handlers[0]!();
    await Promise.resolve();
    expect(get).toHaveBeenCalledTimes(1);
    off();
  });
});

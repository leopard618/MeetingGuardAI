/**
 * M13: the opt-in to the messages Meeting Guard AI starts on WhatsApp (whatsappMessages callable;
 * docs/v2/WhatsApp-Templates-2026-11-12.md section 7). All switches are off until the user turns
 * one on; STOP in the chat turns them all off. The server keeps the record (whatsappUsers/{uid},
 * server only); the app only shows and changes it.
 *
 * On every session start the app sends its device zone ('get' with deviceTimeZone), so the daily
 * agenda and the reminders are timed in the zone the phone is in now, not a stale preference.
 * Failures there are silent: the screen asks again when it opens.
 */
import { useCallback, useEffect, useState } from 'react';
import { httpsCallable } from 'firebase/functions';

import {
  CALLABLES,
  WHATSAPP_CALL_TIMEOUT_MS,
  WHATSAPP_MESSAGES_WORDING_VERSION,
  whatsappMessagesRequestSchema,
  whatsappMessagesResponseSchema,
  type WhatsappMessageSwitch,
  type WhatsappMessageSwitches,
  type WhatsappMessagesResponse,
} from '../../core/aiContract';
import { AppError, toAppError } from '../../core/errors';
import { appEvents, type AppEventMap, type EventBus } from '../../core/events';
import { createLogger } from '../../core/logger';
import { getDeviceTimeZone } from '../../core/time';
import { functions } from '../../config/firebase';
import { mapWhatsAppError } from './whatsappService';

const log = createLogger('whatsapp-messages');

export type WhatsAppMessagesState = WhatsappMessagesResponse;

export interface WhatsAppMessagesTransport {
  call(request: unknown): Promise<unknown>;
}

export interface WhatsAppMessagesService {
  get(): Promise<WhatsAppMessagesState>;
  set(switches: WhatsappMessageSwitches): Promise<WhatsAppMessagesState>;
}

export function createWhatsAppMessagesService(deps: { getTransport(): WhatsAppMessagesTransport | null; deviceTimeZone?: () => string }): WhatsAppMessagesService {
  const zone = (): string | null => {
    try {
      return (deps.deviceTimeZone ?? getDeviceTimeZone)();
    } catch {
      return null;
    }
  };

  async function call(request: unknown): Promise<WhatsAppMessagesState> {
    const transport = deps.getTransport();
    if (!transport) throw new AppError('not_configured', 'Firebase is not configured in this build');
    const checked = whatsappMessagesRequestSchema.parse(request);
    let raw: unknown;
    try {
      raw = await transport.call(checked);
    } catch (error) {
      const mapped = mapWhatsAppError(error);
      log.warn('whatsappMessages failed', { code: mapped.code });
      throw mapped;
    }
    const parsed = whatsappMessagesResponseSchema.safeParse(raw);
    if (!parsed.success) throw new AppError('upstream_error', 'invalid whatsappMessages response');
    return parsed.data;
  }

  return {
    get: () => call({ op: 'get', deviceTimeZone: zone() }),
    set: (switches) => call({ op: 'set', switches, deviceTimeZone: zone(), wordingVersion: WHATSAPP_MESSAGES_WORDING_VERSION }),
  };
}

function defaultTransport(): WhatsAppMessagesTransport | null {
  const instance = functions;
  if (!instance) return null;
  return {
    async call(request: unknown): Promise<unknown> {
      const callable = httpsCallable<unknown, unknown>(instance, CALLABLES.whatsappMessages, { timeout: WHATSAPP_CALL_TIMEOUT_MS });
      return (await callable(request)).data;
    },
  };
}

export const whatsappMessagesService: WhatsAppMessagesService = createWhatsAppMessagesService({ getTransport: defaultTransport });

/** Sends the device zone once per session (silent; the server stores it only for opted-in users). */
export function registerWhatsAppZoneRefresh(events: Pick<EventBus<AppEventMap>, 'on'> = appEvents, service: WhatsAppMessagesService = whatsappMessagesService): () => void {
  return events.on('session:started', () => {
    service.get().catch(() => undefined);
  });
}

export interface WhatsAppMessagesHook {
  state: WhatsAppMessagesState | null;
  loading: boolean;
  error: AppError | null;
  /** The switch being saved, or null. */
  saving: WhatsappMessageSwitch | null;
  toggle(key: WhatsappMessageSwitch, value: boolean): Promise<void>;
  reload(): void;
}

/** The screen's view of the record; asks only while `active` (the phone is linked). */
export function useWhatsAppMessages(active: boolean, service: WhatsAppMessagesService = whatsappMessagesService): WhatsAppMessagesHook {
  const [state, setState] = useState<WhatsAppMessagesState | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const [saving, setSaving] = useState<WhatsappMessageSwitch | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!active) return undefined;
    let alive = true;
    service.get().then(
      (next) => {
        if (!alive) return;
        setState(next);
        setError(null);
      },
      (caught: unknown) => {
        if (alive) setError(toAppError(caught));
      },
    );
    return () => {
      alive = false;
    };
  }, [active, service, nonce]);
  const loading = active && state === null && error === null;

  const toggle = useCallback(
    async (key: WhatsappMessageSwitch, value: boolean): Promise<void> => {
      if (state === null) return;
      const previous = state;
      const switches = { ...state.switches, [key]: value };
      setState({ ...state, switches });
      setSaving(key);
      try {
        setState(await service.set(switches));
      } catch (caught: unknown) {
        setState(previous);
        throw toAppError(caught);
      } finally {
        setSaving(null);
      }
    },
    [service, state],
  );

  const reload = useCallback((): void => {
    setError(null);
    setNonce((n) => n + 1);
  }, []);

  return { state, loading, error, saving, toggle, reload };
}

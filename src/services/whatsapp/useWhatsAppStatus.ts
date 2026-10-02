/**
 * useWhatsAppStatus() (owner: whatsapp-app). Contract: UseWhatsAppStatusResult in
 * src/core/contracts.ts. Asks whatsappService.getStatus() once on mount (the service caches the
 * answer per session), exposes the known answer synchronously for render and re-renders when it
 * arrives or changes (another hook instance asked first, refresh(), unlink, session end).
 * `status` stays null while the answer is unknown; `error` carries the last failed ask so
 * screens can offer a retry instead of spinning forever.
 */
import { useCallback, useEffect, useState } from 'react';

import type { UseWhatsAppStatusResult } from '../../core/contracts';
import { toAppError } from '../../core/errors';
import type { AppError } from '../../core/errors';

import { whatsappService } from './whatsappService';

export function useWhatsAppStatus(): UseWhatsAppStatusResult {
  const [status, setStatus] = useState(() => whatsappService.getKnownStatus());
  const [error, setError] = useState<AppError | null>(null);

  useEffect(() => {
    let active = true;
    const sync = (): void => {
      if (active) setStatus(whatsappService.getKnownStatus());
    };
    const unsubscribe = whatsappService.subscribeStatus(sync);
    sync();
    whatsappService.getStatus().then(
      () => {
        if (active) setError(null);
        sync();
      },
      (caught: unknown) => {
        if (active) setError(toAppError(caught));
        sync();
      },
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    // The subscription delivers the new answer to every mounted hook instance.
    try {
      await whatsappService.refreshStatus();
      setError(null);
    } catch (caught: unknown) {
      setError(toAppError(caught));
    }
  }, []);

  return { status, error, refresh };
}

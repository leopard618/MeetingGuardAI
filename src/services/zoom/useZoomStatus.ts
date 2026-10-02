/**
 * useZoomStatus() (owner: zoom-app). Contract: UseZoomStatusResult in src/core/contracts.ts.
 * Asks zoomService.isAvailable() once on mount (the service caches the answer per session),
 * exposes the known answer synchronously for render and re-renders when it arrives or changes
 * (another hook instance asked first, refresh(), session end). `configured` stays null while
 * the answer is unknown, so conferenceCapability keeps the plain paste behavior (§22/§24).
 */
import { useCallback, useEffect, useState } from 'react';

import type { UseZoomStatusResult } from '../../core/contracts';

import { zoomService } from './zoomService';

export function useZoomStatus(): UseZoomStatusResult {
  const [configured, setConfigured] = useState<boolean | null>(() => zoomService.getKnownAvailability());

  useEffect(() => {
    let active = true;
    const sync = (): void => {
      if (active) setConfigured(zoomService.getKnownAvailability());
    };
    const unsubscribe = zoomService.subscribeAvailability(sync);
    sync();
    void zoomService.isAvailable().then(sync, sync);
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    // The subscription delivers the new answer to every mounted hook instance.
    await zoomService.refreshAvailability();
  }, []);

  return { configured, refresh };
}

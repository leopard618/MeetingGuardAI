/**
 * useZoomStatus() (owner: zoom-app) - STUB. Contract: UseZoomStatusResult in
 * src/core/contracts.ts. The real hook asks zoomService.isAvailable() once on mount (per
 * session; the service caches), exposes the known answer synchronously and re-renders when it
 * arrives. The stub reports "unknown" so the form and details card keep today's paste behavior.
 */
import { useCallback } from 'react';

import type { UseZoomStatusResult } from '../../core/contracts';

export function useZoomStatus(): UseZoomStatusResult {
  const refresh = useCallback(async (): Promise<void> => {
    // STUB: nothing to ask yet.
  }, []);
  return { configured: null, refresh };
}

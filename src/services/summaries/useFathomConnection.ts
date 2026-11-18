/**
 * Connect Fathom for a screen (docs/v2/FATHOM-CONNECT.md section 7): the status, asked on mount,
 * and connect / disconnect with a busy flag. Errors come back to the caller (the screen shows its
 * own toast). Screen state only; nothing is cached across screens.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import type { FathomConnectionStatus } from '../../core/aiContract';
import { toAppError, type AppError } from '../../core/errors';
import { fathomService, type FathomConnectOutcome, type FathomService } from './fathom';

export type FathomBusy = 'connect' | 'disconnect' | null;

export interface UseFathomConnectionResult {
  /** null until the first answer. */
  status: FathomConnectionStatus | null;
  error: AppError | null;
  busy: FathomBusy;
  refresh(): Promise<void>;
  connect(): Promise<FathomConnectOutcome>;
  disconnect(): Promise<{ remoteRemoved: boolean | null }>;
}

export function useFathomConnection(service: FathomService = fathomService): UseFathomConnectionResult {
  const [status, setStatus] = useState<FathomConnectionStatus | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const [busy, setBusy] = useState<FathomBusy>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    try {
      const next = await service.status();
      if (!mounted.current) return;
      setStatus(next);
      setError(null);
    } catch (caught) {
      if (mounted.current) setError(toAppError(caught));
    }
  }, [service]);

  // The first ask (state is set in the promise callbacks, never in the effect body).
  useEffect(() => {
    let active = true;
    service.status().then(
      (next) => {
        if (!active) return;
        setStatus(next);
        setError(null);
      },
      (caught: unknown) => {
        if (active) setError(toAppError(caught));
      },
    );
    return () => {
      active = false;
    };
  }, [service]);

  const connect = useCallback(async () => {
    setBusy('connect');
    try {
      const outcome = await service.connect();
      await refresh();
      return outcome;
    } finally {
      if (mounted.current) setBusy(null);
    }
  }, [refresh, service]);

  const disconnect = useCallback(async () => {
    setBusy('disconnect');
    try {
      const answer = await service.disconnect();
      if (mounted.current) setStatus(answer.status);
      return { remoteRemoved: answer.remoteRemoved };
    } finally {
      if (mounted.current) setBusy(null);
    }
  }, [service]);

  return { status, error, busy, refresh, connect, disconnect };
}

/**
 * Connect Fathom for a screen (docs/v2/FATHOM-CONNECT.md section 7): the status, asked on mount,
 * and connect / disconnect with a busy flag. Errors come back to the caller (the screen shows its
 * own toast). Screen state only; nothing is cached across screens.
 * Sync (section 9): once the status says connected, one sync on mount; right after a connection,
 * a forced one (the meetings Fathom recorded before). `onImported` runs when a sync stored new
 * summaries, so the screen asks its lists again.
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

export function useFathomConnection(service: FathomService = fathomService, onImported?: () => void): UseFathomConnectionResult {
  const [status, setStatus] = useState<FathomConnectionStatus | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const [busy, setBusy] = useState<FathomBusy>(null);
  const mounted = useRef(true);
  const onImportedRef = useRef(onImported);
  useEffect(() => {
    onImportedRef.current = onImported;
  }, [onImported]);
  const synced = useRef(false);

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

  const runSync = useCallback(
    async (force: boolean) => {
      const outcome = await service.sync({ force });
      if (outcome !== null && outcome.imported > 0 && mounted.current) {
        onImportedRef.current?.();
        await refresh();
      }
    },
    [refresh, service],
  );

  // One sync per mount, once the status says connected.
  const connected = status?.connected === true;
  useEffect(() => {
    if (!connected || synced.current) return;
    synced.current = true;
    void runSync(false);
  }, [connected, runSync]);

  const connect = useCallback(async () => {
    setBusy('connect');
    try {
      const outcome = await service.connect();
      await refresh();
      if (outcome.result === 'connected') {
        synced.current = true;
        void runSync(true);
      }
      return outcome;
    } finally {
      if (mounted.current) setBusy(null);
    }
  }, [refresh, runSync, service]);

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

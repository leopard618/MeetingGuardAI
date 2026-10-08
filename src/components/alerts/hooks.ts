/**
 * Small hooks for the alert UI (owner: alerts).
 */
import { useEffect, useRef, useState } from 'react';
import { BackHandler } from 'react-native';

import { alertFeedback, type FeedbackRequest } from '../../services/alerts';

/**
 * Starts sound / voice / vibration for a visible alert and stops it on unmount. The request is
 * captured on mount: alert components are keyed by the alert, so a new alert remounts (and
 * restarts feedback) while re-renders (countdown ticks) do not.
 */
export function useAlertFeedback(request: FeedbackRequest | null): void {
  const [captured] = useState(request);
  useEffect(() => {
    if (!captured) return undefined;
    const handle = alertFeedback.start(captured);
    return () => handle.stop();
  }, [captured]);
}

/** Current time, refreshed every `intervalMs` while mounted. */
export function useNow(intervalMs: number): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/** Blocks the Android back button while mounted (MAX alert needs an explicit action). */
export function useBlockBackButton(): void {
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => subscription.remove();
  }, []);
}

/** Ref that always holds the latest value (timers call the current callback, not a stale one). */
export function useLatest<T>(value: T): { readonly current: T } {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  });
  return ref;
}

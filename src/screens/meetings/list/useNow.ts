/**
 * The current time for time-dependent screens ("Today", upcoming vs. past). Ticks every minute and
 * when the app comes back to the foreground (a list left open overnight moves to the new day).
 */
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

export function useNow(intervalMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), intervalMs);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') setNow(new Date());
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, [intervalMs]);
  return now;
}

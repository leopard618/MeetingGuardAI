/**
 * React Native adapters for the data engine: connectivity (NetInfo) and app foreground (AppState).
 * Kept separate so the engine itself stays testable with plain fakes.
 */
import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import { AppState, type AppStateStatus } from 'react-native';

import type { Unsubscribe } from '../../core/events';

export interface NetworkMonitor {
  /** Current reachability: true / false, or null when unknown. */
  fetch(): Promise<boolean | null>;
  subscribe(listener: (online: boolean | null) => void): Unsubscribe;
}

export interface ForegroundMonitor {
  /** Calls `listener` every time the app returns to the foreground. */
  subscribe(listener: () => void): Unsubscribe;
}

/** Online unless NetInfo positively says otherwise (isInternetReachable is null while probing). */
export function isOnline(state: Pick<NetInfoState, 'isConnected' | 'isInternetReachable'>): boolean | null {
  if (state.isConnected === false || state.isInternetReachable === false) return false;
  if (state.isConnected === null) return null;
  return true;
}

export const netInfoMonitor: NetworkMonitor = {
  async fetch() {
    const state = await NetInfo.fetch();
    return isOnline(state);
  },
  subscribe(listener) {
    return NetInfo.addEventListener((state) => listener(isOnline(state)));
  },
};

export const appStateMonitor: ForegroundMonitor = {
  subscribe(listener) {
    let previous: AppStateStatus = AppState.currentState;
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active' && previous !== 'active') listener();
      previous = next;
    });
    return () => subscription.remove();
  },
};

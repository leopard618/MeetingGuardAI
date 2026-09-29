/**
 * Imperative navigation outside React (notification taps, deep links, services) with a
 * gate-aware queue: an intent whose route is not mounted yet (container not ready, splash,
 * signed out, onboarding) is kept (latest wins) and dispatched as soon as the route exists.
 */
import { CommonActions, createNavigationContainerRef } from '@react-navigation/native';
import { useSyncExternalStore } from 'react';

import type { NavigationApi, RootStackParamList, RouteName } from '../core/contracts';
import { appEvents } from '../core/events';
import { DEEP_LINK_PREFIX, parseDeepLink } from '../core/identifiers';
import { createLogger } from '../core/logger';

const log = createLogger('navigation');

export const navigationRef = createNavigationContainerRef<RootStackParamList>();

export type NavigationIntent = {
  [K in RouteName]: { name: K; params?: RootStackParamList[K] };
}[RouteName];

let pending: NavigationIntent | null = null;

export const isNavigationReady: NavigationApi['isReady'] = () => navigationRef.isReady();

/** true when the container is ready and `name` belongs to the currently mounted screen group. */
export function isRouteMounted(name: RouteName): boolean {
  if (!navigationRef.isReady()) return false;
  const state = navigationRef.getRootState();
  return Array.isArray(state?.routeNames) && state.routeNames.includes(name);
}

function dispatchIntent(intent: NavigationIntent, options?: { pop?: boolean }): void {
  navigationRef.dispatch(CommonActions.navigate(intent.name, intent.params as object | undefined, options));
}

/** Navigates now if the route is mounted, otherwise queues it (latest intent wins). */
export const navigate: NavigationApi['navigate'] = (name, params) => {
  const intent = { name, params } as NavigationIntent;
  if (isRouteMounted(name)) {
    dispatchIntent(intent);
    return;
  }
  pending = intent;
};

/**
 * Top-level destinations (sidebar, header logo): go back to the existing screen of that name if
 * it is in the stack instead of pushing another copy.
 */
export function navigateToTopLevel(name: RouteName): void {
  if (!isRouteMounted(name)) {
    navigate(name);
    return;
  }
  dispatchIntent({ name } as NavigationIntent, { pop: true });
}

/** Dispatches the queued intent if its route is mounted now. Returns true when it navigated. */
export function flushPendingNavigation(): boolean {
  if (pending === null || !isRouteMounted(pending.name)) return false;
  const intent = pending;
  pending = null;
  dispatchIntent(intent);
  return true;
}

export function getPendingNavigation(): NavigationIntent | null {
  return pending;
}

export function clearPendingNavigation(): void {
  pending = null;
}

/** PURE: maps a meetingguardai:// URL to a navigation intent (null if unknown). */
export function intentForDeepLink(url: string): NavigationIntent | null {
  const parsed = parseDeepLink(url);
  switch (parsed.type) {
    case 'meeting':
      return { name: 'MeetingDetails', params: { meetingId: parsed.meetingId } };
    case 'assistant':
      return {
        name: 'AIChat',
        params: parsed.followUpMeetingId !== null ? { followup: parsed.followUpMeetingId } : undefined,
      };
    default:
      return null;
  }
}

/** Routes a meetingguardai:// URL (notification data.url). false if the URL is not ours/unknown. */
export const openDeepLink: NavigationApi['openDeepLink'] = (url) => {
  const intent = intentForDeepLink(url);
  if (intent === null) {
    if (typeof url === 'string' && url.startsWith(DEEP_LINK_PREFIX)) log.warn('ignoring an unknown deep link');
    return false;
  }
  navigate(intent.name, intent.params as never);
  return true;
};

/** NavigationContainer onReady handler. */
export function onNavigationReady(): void {
  flushPendingNavigation();
}

// Screen groups change when the gate changes (sign-in, onboarding done): retry the queue on every
// container state change. addListener on the ref is buffered until the container mounts.
navigationRef.addListener('state', () => {
  flushPendingNavigation();
});

// An intent queued for the previous user must not leak into the next session.
appEvents.on('session:ended', () => {
  pending = null;
});

// ---- current route (sidebar highlight) -------------------------------------------------------

function subscribeToRoute(listener: () => void): () => void {
  return navigationRef.addListener('state', listener);
}

function getCurrentRouteName(): RouteName | null {
  if (!navigationRef.isReady()) return null;
  return (navigationRef.getCurrentRoute()?.name as RouteName | undefined) ?? null;
}

/** Name of the focused route (re-renders on navigation). */
export function useCurrentRouteName(): RouteName | null {
  return useSyncExternalStore(subscribeToRoute, getCurrentRouteName, getCurrentRouteName);
}

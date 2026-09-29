/**
 * Crash reporting (Sentry).
 *
 * - Initialized only when EXPO_PUBLIC_SENTRY_DSN is set; otherwise every helper is a no-op.
 *   (A DSN is public by design - it only allows sending events.)
 * - Events are not sent from development builds (`enabled: !__DEV__`).
 * - No PII by default; emails / IPs are stripped before sending.
 *
 * Imported first in index.js so it can capture errors thrown while the rest of the app loads.
 */
import * as Sentry from '@sentry/react-native';
import type { ComponentType } from 'react';

import { env } from '../config/env';
import { createLogger } from '../core/logger';

const log = createLogger('sentry');

let initialized = false;

const EMAIL_PATTERN = /[\w.+-]+@[\w-]+\.[\w.-]+/g;

function scrub(text: string | undefined): string | undefined {
  return text ? text.replace(EMAIL_PATTERN, '[email]') : text;
}

/** "https://host/path?query#hash" -> "https://host/path" (queries carry sync tokens, ids, times). */
function stripQuery(url: unknown): unknown {
  return typeof url === 'string' ? url.replace(/[?#].*$/, '') : url;
}

/** Minimal breadcrumb shape handled here (a subset of Sentry's Breadcrumb). */
export interface BreadcrumbLike {
  category?: string;
  message?: string;
  data?: Record<string, unknown>;
}

/**
 * Removes user data from a breadcrumb before Sentry stores it:
 * - console breadcrumbs keep only the (email-scrubbed) message; their raw `data.arguments` (whole
 *   objects passed to console.warn / console.error by libraries) are dropped;
 * - HTTP breadcrumbs lose the query string of their URL;
 * - every message is email-scrubbed.
 */
export function scrubBreadcrumb<T extends BreadcrumbLike>(breadcrumb: T): T {
  const next: T = { ...breadcrumb };
  if (next.message) next.message = scrub(next.message);
  if (next.category === 'console') {
    delete next.data;
  } else if ((next.category === 'xhr' || next.category === 'fetch') && next.data) {
    next.data = { ...next.data, url: stripQuery(next.data.url) };
  }
  return next;
}

export function initSentry(): boolean {
  if (initialized) return true;
  const dsn = env.sentryDsn;
  if (!dsn) return false;

  try {
    Sentry.init({
      dsn,
      enabled: !__DEV__,
      environment: __DEV__ ? 'development' : env.appEnv,
      sendDefaultPii: false,
      tracesSampleRate: 0.1,
      beforeSend(event) {
        if (event.user) {
          delete event.user.email;
          delete event.user.ip_address;
        }
        if (event.message) event.message = scrub(event.message);
        event.exception?.values?.forEach((value) => {
          value.value = scrub(value.value);
        });
        return event;
      },
      beforeBreadcrumb(breadcrumb) {
        return scrubBreadcrumb(breadcrumb);
      },
    });
    initialized = true;
  } catch (error) {
    log.error('init failed', error);
  }
  return initialized;
}

export function isSentryEnabled(): boolean {
  return initialized;
}

/** Wraps the root component with Sentry's instrumentation when Sentry is active. */
export function wrapRootComponent<P extends Record<string, unknown>>(
  Root: ComponentType<P>,
): ComponentType<P> {
  return initialized ? Sentry.wrap(Root) : Root;
}

/** Reports an error (no-op when Sentry is not configured). */
export function captureException(error: unknown, extra?: Record<string, unknown>): void {
  if (!initialized) return;
  try {
    Sentry.captureException(error, extra ? { extra } : undefined);
  } catch {
    // Never let error reporting crash the app.
  }
}

initSentry();

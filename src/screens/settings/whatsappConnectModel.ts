/**
 * Pure view model of the WhatsApp connect screen (route "WhatsAppConnect"): which of the five
 * views to show, the code countdown, the prefilled wa.me URL and the error-to-message mapping.
 * Kept free of React so the unit tests cover it directly.
 */
import { Clipboard } from 'react-native';

import type { WhatsAppLinkStatus } from '../../core/contracts';
import { errorMessageKey, type AppError } from '../../core/errors';

export type WhatsAppConnectView = 'loading' | 'error' | 'unavailable' | 'not_linked' | 'linked';

/** Which view the screen shows for a status/error pair (useWhatsAppStatus's answer). */
export function connectView(status: WhatsAppLinkStatus | null, error: AppError | null): WhatsAppConnectView {
  if (status === null) return error === null ? 'loading' : 'error';
  if (!status.enabled) return 'unavailable';
  return status.linked ? 'linked' : 'not_linked';
}

/** Whole seconds until `expiresAtIso`, clamped at 0 (invalid dates count as expired). */
export function remainingSeconds(expiresAtIso: string, now: Date): number {
  const expiresAt = Date.parse(expiresAtIso);
  if (Number.isNaN(expiresAt)) return 0;
  return Math.max(0, Math.floor((expiresAt - now.getTime()) / 1000));
}

/** "9:07" from 547 seconds (minutes never padded, seconds always two digits). */
export function formatCountdown(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** The wa.me chat URL with the code prefilled as the message text. */
export function codeMessageUrl(deepLink: string, code: string): string {
  return `${deepLink}?text=${encodeURIComponent(code)}`;
}

/**
 * i18n key for a failed startLink/unlink call: the server's 'rate_limited' gets its own
 * message, 'not_configured' reuses the unavailable notice, transport problems reuse the shared
 * error messages, anything else falls back to the generic one.
 */
export function actionErrorKey(error: AppError): string {
  const reason = error.details?.reason;
  if (reason === 'rate_limited' || error.code === 'quota_exceeded') return 'whatsapp:error.rateLimited';
  if (error.code === 'not_configured') return 'whatsapp:status.unavailable';
  if (error.code === 'offline' || error.code === 'timeout' || error.code === 'unauthenticated') {
    return errorMessageKey(error.code);
  }
  return 'whatsapp:error.generic';
}

/**
 * Copies `text` to the clipboard; false when the clipboard is unavailable. Uses react-native's
 * deprecated-but-present Clipboard on purpose: this pass adds no new native dependency (swap to
 * expo-clipboard whenever it joins package.json).
 */
export function copyText(text: string): boolean {
  try {
    Clipboard.setString(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Error types of the zoom* callables.
 *
 * - `zoomError` builds the HttpsError the app sees (details.reason from ZOOM_ERROR_CODES,
 *   HTTPS code from ZOOM_ERROR_HTTPS_CODES) - defined here so handler.ts and index.ts share it
 *   without a cycle (index.ts re-exports it).
 * - `ZoomApiError` is the internal failure of a Zoom HTTP call (token mint or REST), already
 *   mapped to its reason per the table in docs/v1/ARCHITECTURE.md §24: 401 after one token
 *   refresh retry => not_configured; 404 => not_found; 429 => quota_exceeded; anything else
 *   => upstream_error. Handlers convert it with `toZoomHttpsError`.
 */
import * as logger from 'firebase-functions/logger';
import { HttpsError } from 'firebase-functions/https';

import { ZOOM_ERROR_HTTPS_CODES, type ZoomErrorCode } from '../shared/aiContract';

/** Every zoom* error carries details.reason (the app maps it to an AppError code). */
export function zoomError(reason: ZoomErrorCode, message: string): HttpsError {
  return new HttpsError(ZOOM_ERROR_HTTPS_CODES[reason], message, { reason });
}

/** A failed Zoom HTTP call (never carries meeting content, URLs or credentials). */
export class ZoomApiError extends Error {
  constructor(
    readonly reason: ZoomErrorCode,
    /** HTTP status of the failed call, or null for network/timeout failures. */
    readonly status: number | null,
    message: string,
  ) {
    super(message);
    this.name = 'ZoomApiError';
  }
}

/** Error class + short message for ops logs; never request or meeting content. */
export function describeZoomError(error: unknown): { errorName: string; errorMessage: string } {
  if (error instanceof Error) return { errorName: error.name, errorMessage: error.message.slice(0, 300) };
  return { errorName: typeof error, errorMessage: '' };
}

/**
 * Maps any failure of a zoom handler to the HttpsError the app expects. Logs uid + doc id +
 * error codes only (the §24 logging rule).
 */
export function toZoomHttpsError(error: unknown, context: { uid: string; op: string; meetingId?: string | null }): HttpsError {
  if (error instanceof HttpsError) return error;
  const fields: Record<string, unknown> = { uid: context.uid, op: context.op };
  if (context.meetingId) fields.meetingId = context.meetingId;
  if (error instanceof ZoomApiError) {
    logger.warn('zoom.upstream_failed', { ...fields, reason: error.reason, status: error.status });
    return zoomError(error.reason, 'The Zoom request failed.');
  }
  logger.error('zoom.failed', { ...fields, ...describeZoomError(error) });
  return zoomError('upstream_error', 'The Zoom request failed.');
}

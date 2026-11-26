/**
 * The message key for a failed matter action: the server's reason first, then the generic one.
 * A4: a rate_limited error says which limit was reached (details.limit).
 */
import { MATTER_LIMIT_KINDS } from '../../core/aiContract';
import { errorMessageKey, type AppError } from '../../core/errors';

/** A5: a streamed answer that could not start (the screen then asks the callable instead). */
export function isStreamUnavailable(error: unknown): boolean {
  return (error as { details?: { stream?: unknown } } | null)?.details?.stream === 'unavailable';
}

export function matterErrorKey(error: AppError): string {
  const reason = (error.details as { reason?: unknown } | undefined)?.reason;
  const limit = (error.details as { limit?: unknown } | undefined)?.limit;
  if (reason === 'rate_limited' && typeof limit === 'string' && (MATTER_LIMIT_KINDS as readonly string[]).includes(limit)) return `matters:errors.limit.${limit}`;
  if (reason === 'stale_draft') return 'matters:errors.stale';
  if (reason === 'not_allowed') return 'matters:errors.notAllowed';
  if (reason === 'consent_required') return 'matters:errors.consent';
  if (reason === 'not_configured' || error.code === 'not_configured') return 'matters:errors.unavailable';
  return errorMessageKey(error.code);
}

/** The message key for a failed matter action: the server's reason first, then the generic one. */
import { errorMessageKey, type AppError } from '../../core/errors';

export function matterErrorKey(error: AppError): string {
  const reason = (error.details as { reason?: unknown } | undefined)?.reason;
  if (reason === 'stale_draft') return 'matters:errors.stale';
  if (reason === 'not_allowed') return 'matters:errors.notAllowed';
  if (reason === 'not_configured' || error.code === 'not_configured') return 'matters:errors.unavailable';
  return errorMessageKey(error.code);
}

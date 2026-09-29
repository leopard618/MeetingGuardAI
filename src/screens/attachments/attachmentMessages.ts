/**
 * User-facing texts of attachment operations, shared by the meeting details section and the
 * meeting form: add results (toast), add errors, file sizes in the UI language.
 */
import Toast from 'react-native-toast-message';

import type { TranslateFn } from '../../core/contracts';
import { errorMessageKey, type AppError } from '../../core/errors';
import { MAX_ATTACHMENT_MB, fileSizeParts, type AttachmentAddResult, type AttachmentSource } from '../../services/attachments';

/** "1.5 MB" / "1,5 MB" in the UI language. */
export function formatFileSize(bytes: number, language: string, t: TranslateFn): string {
  const { value, unit } = fileSizeParts(bytes);
  let text = String(value);
  try {
    text = new Intl.NumberFormat(language, { maximumFractionDigits: 1 }).format(value);
  } catch {
    // Keep the plain number.
  }
  return t(`attachments:size.${unit}`, { value: text });
}

/** The toast texts of an add result; null when there is nothing to say (cancelled picker). */
export function addResultMessage(
  result: AttachmentAddResult,
  t: TranslateFn,
): { type: 'success' | 'info' | 'error'; text1: string; text2?: string } | null {
  if (result.cancelled) return null;
  const { added, failures } = result;
  if (failures.length === 0) {
    return added.length > 0 ? { type: 'success', text1: t('attachments:added', { count: added.length }) } : null;
  }
  const first = failures[0];
  const failed = t('attachments:failed', { count: failures.length });
  return {
    type: added.length > 0 ? 'info' : 'error',
    text1: added.length > 0 ? `${t('attachments:added', { count: added.length })} · ${failed}` : failed,
    text2: first ? t(`attachments:failure.${first.reason}`, { name: first.name, maxMb: MAX_ATTACHMENT_MB }) : undefined,
  };
}

export function showAddResult(result: AttachmentAddResult, t: TranslateFn): void {
  const message = addResultMessage(result, t);
  if (message) Toast.show(message);
}

/** The message for a failed add (a refused camera permission gets its own text). */
export function addErrorMessage(error: AppError, source: AttachmentSource, t: TranslateFn): string {
  if (source === 'camera' && error.code === 'permission_denied') return t('attachments:cameraDenied');
  return t(errorMessageKey(error.code));
}

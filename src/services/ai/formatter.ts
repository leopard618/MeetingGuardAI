/**
 * Default AssistantFormatter: i18n `t` + src/utils/format.ts in the current UI language, the
 * device time zone and the user's 12 h / 24 h preference (Preferences.use24HourClock; null = the
 * locale / device default). React code passes the hook-bound `t` (re-renders on language change);
 * non-React code (executor share text) uses the module-level `t`.
 */
import type { TranslateFn } from '../../core/contracts';
import { getDeviceTimeZone } from '../../core/time';
import type { Language } from '../../core/types';
import { getLanguage, t as translate } from '../../i18n';
import {
  formatDateTime,
  formatDuration,
  formatMeetingTimeRange,
  formatRelative,
  formatTime,
} from '../../utils/format';

import type { AssistantFormatter } from './types';

export function createAssistantFormatter(
  options: { t?: TranslateFn; language?: Language; timeZone?: string; use24Hour?: boolean | null } = {},
): AssistantFormatter {
  const language = options.language ?? getLanguage();
  const timeZone = options.timeZone ?? getDeviceTimeZone();
  const formatOptions = { language, timeZone, use24Hour: options.use24Hour ?? null };
  return {
    t: options.t ?? translate,
    language,
    timeZone,
    meetingTime: (meeting) => formatMeetingTimeRange(meeting, formatOptions),
    duration: (minutes) => formatDuration(minutes, formatOptions),
    dateTime: (value) => formatDateTime(value, formatOptions),
    time: (value) => formatTime(value, formatOptions),
    relative: (value, now) => formatRelative(value, { ...formatOptions, now }),
  };
}

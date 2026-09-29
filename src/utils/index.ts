/**
 * Legacy helpers still imported (with the ".ts" extension) by stage-3 screens and the old AI
 * manager. New code uses src/core (time, legacy mappers) and src/utils/format.ts instead.
 * Relative words ("today", "tomorrow", "next week") resolve in the DEVICE time zone.
 */
type LooseRecord = Record<string, unknown>;

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function localDateString(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function addDays(days: number): Date {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date;
}

export function createPageUrl(pageName: string): string {
  return '/' + pageName.toLowerCase().replace(/ /g, '-');
}

/**
 * Safely converts any value to a string for rendering (prevents "Objects are not valid as a React
 * child" errors).
 */
export function safeStringify(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return '[Object]';
    }
  }
  return String(value);
}

/** Reads a nested property ("a.b.c"), returning `defaultValue` when any step is missing. */
export function safeGet(obj: unknown, path: string, defaultValue: unknown = ''): unknown {
  if (!obj || typeof obj !== 'object') return defaultValue;
  let current: unknown = obj;
  for (const key of path.split('.')) {
    if (current && typeof current === 'object' && key in (current as LooseRecord)) {
      current = (current as LooseRecord)[key];
    } else {
      return defaultValue;
    }
  }
  return current;
}

/**
 * Checks the minimum fields of a legacy meeting payload (title, date, time) and fills defaults
 * (duration 60, source "Manual"). Returns null when a required field is missing.
 */
export function validateMeetingData(meetingData: unknown, _userMessage?: string): LooseRecord | null {
  if (!meetingData || typeof meetingData !== 'object') return null;
  const validated: LooseRecord = { ...(meetingData as LooseRecord) };
  const isBlank = (value: unknown): boolean => typeof value !== 'string' || value.trim() === '';
  if (isBlank(validated.title) || isBlank(validated.date) || isBlank(validated.time)) return null;
  if (!validated.duration) validated.duration = 60;
  if (!validated.source) validated.source = 'Manual';
  return validated;
}

/** Normalizes date/time (inferring them from the user's message when empty) and copies nested objects. */
export function makeMeetingDataSafe(meetingData: unknown, userMessage?: string): unknown {
  if (!meetingData || typeof meetingData !== 'object') return meetingData;
  const data = meetingData as LooseRecord;
  let date = data.date;
  let time = data.time;
  if ((!date || date === '') && userMessage) date = extractDateTimeFromMessage(userMessage).date || date;
  if ((!time || time === '') && userMessage) time = extractDateTimeFromMessage(userMessage).time || time;
  return {
    ...data,
    date: normalizeDate(date),
    time: normalizeTime(time),
    location: data.location && typeof data.location === 'object' ? { ...(data.location as LooseRecord) } : data.location,
    participants: Array.isArray(data.participants)
      ? data.participants.map((participant: unknown) =>
          participant && typeof participant === 'object' ? { ...(participant as LooseRecord) } : participant,
        )
      : data.participants,
  };
}

/**
 * Normalizes a date to "YYYY-MM-DD" in the device zone. Accepts "YYYY-MM-DD", Date objects,
 * parseable date strings, "MM/DD/YYYY", "today", "tomorrow" and "next week". Returns '' for empty
 * input and the input unchanged when it cannot be understood.
 */
export function normalizeDate(date: unknown): string {
  if (!date) return '';
  if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  if (date instanceof Date) return Number.isNaN(date.getTime()) ? '' : localDateString(date);
  if (typeof date === 'string') {
    const lower = date.toLowerCase();
    if (lower.includes('tomorrow')) return localDateString(addDays(1));
    if (lower.includes('today')) return localDateString(addDays(0));
    if (lower.includes('next week')) return localDateString(addDays(7));
    const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(date);
    if (slash) return `${slash[3]}-${(slash[1] ?? '').padStart(2, '0')}-${(slash[2] ?? '').padStart(2, '0')}`;
    const parsed = new Date(date);
    if (!Number.isNaN(parsed.getTime())) return localDateString(parsed);
    return date;
  }
  return String(date);
}

/** Extracts a date ("today" / "tomorrow" / "next week") and a time ("3pm", "15:30") from free text. */
export function extractDateTimeFromMessage(message: string): { date: string; time: string } {
  const result = { date: '', time: '' };
  if (!message) return result;
  const lower = message.toLowerCase();
  if (lower.includes('tomorrow')) result.date = localDateString(addDays(1));
  else if (lower.includes('today')) result.date = localDateString(addDays(0));
  else if (lower.includes('next week')) result.date = localDateString(addDays(7));

  const patterns = [/(\d{1,2}):(\d{2})\s*(am|pm)?/i, /(\d{1,2})\s*(am|pm)/i];
  for (const pattern of patterns) {
    const match = pattern.exec(message);
    if (!match) continue;
    let hours = Number.parseInt(match[1] ?? '0', 10);
    const hasMinutes = pattern === patterns[0];
    const minutes = hasMinutes ? Number.parseInt(match[2] ?? '0', 10) : 0;
    const meridiem = (hasMinutes ? match[3] : match[2])?.toLowerCase() ?? null;
    if (meridiem === 'pm' && hours !== 12) hours += 12;
    else if (meridiem === 'am' && hours === 12) hours = 0;
    if (hours > 23 || minutes > 59) continue;
    result.time = `${pad2(hours)}:${pad2(minutes)}`;
    break;
  }
  return result;
}

/**
 * Normalizes a time to "HH:mm" (24 h). Accepts "H:mm", "h:mm am/pm", "3 pm", Date objects and
 * "HH:mm:ss". Returns '' for empty input and the input unchanged when it cannot be understood.
 */
export function normalizeTime(time: unknown): string {
  if (!time) return '';
  if (time instanceof Date) return Number.isNaN(time.getTime()) ? '' : `${pad2(time.getHours())}:${pad2(time.getMinutes())}`;
  if (typeof time !== 'string') return String(time);
  const trimmed = time.trim();
  const plain = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(trimmed);
  if (plain) return `${(plain[1] ?? '').padStart(2, '0')}:${plain[2]}`;
  const meridiem = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i.exec(trimmed);
  if (meridiem) {
    let hours = Number.parseInt(meridiem[1] ?? '0', 10);
    const minutes = meridiem[2] ?? '00';
    const suffix = (meridiem[3] ?? '').toLowerCase();
    if (suffix === 'pm' && hours !== 12) hours += 12;
    if (suffix === 'am' && hours === 12) hours = 0;
    return `${pad2(hours)}:${minutes}`;
  }
  return time;
}

/**
 * Legacy meeting display helpers (stage-3 screens and the old alert components). They accept both
 * the legacy view (core/legacy.ts toLegacyMeetingView) and older ad-hoc shapes, and never throw.
 * New UI uses src/utils/format.ts and the domain Meeting type instead.
 */

/** Human-readable location ("Virtual Meeting (Zoom)", an address, ...). '' when there is none. */
export const getLocationString = (location) => {
  if (!location) return '';
  if (typeof location === 'string') return location;
  if (typeof location !== 'object') return String(location);

  const platform = location.virtualPlatform || location.virtual_platform || 'Online';
  if (location.type === 'virtual') return `Virtual Meeting (${platform})`;
  if (location.type === 'hybrid') {
    const address = typeof location.address === 'string' ? location.address : '';
    return address ? `${address} + Virtual (${platform})` : `Hybrid Meeting (${platform})`;
  }
  if (location.address) {
    return typeof location.address === 'string' ? location.address : JSON.stringify(location.address);
  }
  if (location.name) return location.name;
  if (location.location) return getLocationString(location.location);
  return 'Location specified';
};

/** Join link of a meeting (conference details first, then the legacy location fields); null if none. */
export const getMeetingLink = (meeting) => {
  if (!meeting) return null;
  const conferenceUrl = meeting.conference_details?.url ?? meeting.conference?.url;
  if (typeof conferenceUrl === 'string' && conferenceUrl) return conferenceUrl;
  if (typeof meeting.link === 'string' && meeting.link) return meeting.link;
  const location = meeting.location;
  if (location && typeof location === 'object') {
    return location.virtualLink || location.virtual_link || location.virtualUrl || location.link || null;
  }
  return null;
};

/** Video platform name ('Online' when unknown). */
export const getVirtualPlatform = (meeting) => {
  if (!meeting) return 'Online';
  const location = meeting.location;
  if (location && typeof location === 'object') {
    const fromLocation = location.virtualPlatform || location.virtual_platform || location.platform;
    if (fromLocation) return fromLocation;
  }
  return meeting.virtualPlatform || meeting.virtual_platform || 'Online';
};

/** Any value as display text ("Yes"/"No" for booleans, joined arrays, name/title/label of objects). */
export const safeStringify = (value) => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'object') {
    if (value.name) return value.name;
    if (value.title) return value.title;
    if (value.label) return value.label;
    try {
      return JSON.stringify(value);
    } catch {
      return '';
    }
  }
  return String(value);
};

/** "14:30" stays as is; ISO strings / Dates become a localized short time. '' when invalid. */
export const formatMeetingTime = (time) => {
  if (!time) return '';
  if (typeof time === 'string' && /^\d{1,2}:\d{2}/.test(time)) return time;
  const date = time instanceof Date ? time : new Date(time);
  if (Number.isNaN(date.getTime())) return typeof time === 'string' ? time : '';
  return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
};

/**
 * Localized short date. "YYYY-MM-DD" is read as a LOCAL calendar date (new Date('2026-10-05')
 * would be UTC midnight and show the previous day west of UTC). '' when invalid.
 */
export const formatMeetingDate = (date) => {
  if (!date) return '';
  let parsed;
  if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const [year, month, day] = date.split('-').map(Number);
    parsed = new Date(year, month - 1, day);
  } else {
    parsed = date instanceof Date ? date : new Date(date);
  }
  if (Number.isNaN(parsed.getTime())) return typeof date === 'string' ? date : '';
  return parsed.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
};

export default {
  getLocationString,
  getMeetingLink,
  getVirtualPlatform,
  safeStringify,
  formatMeetingTime,
  formatMeetingDate,
};

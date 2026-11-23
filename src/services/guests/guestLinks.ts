/**
 * M14: the reply link as text (pure, no Firebase): the page URL, the invitation line, and an id
 * for a meeting whose link is made before it is saved.
 */
/**
 * The guest page. Frozen into every invitation sent, so it changes only with a redirect in place
 * (docs/v2/M14-GUEST-LINKS.md). Firebase Hosting of this project serves public/g.
 */
export const GUEST_PAGE_URL = 'https://meetingguard-ai-app.web.app/g';

export function guestLinkUrl(token: string, language?: string): string {
  return `${GUEST_PAGE_URL}#t=${token}${language ? `&l=${language}` : ''}`;
}

const LINK_LINE = /\n*[^\n]*https:\/\/meetingguard-ai-app\.web\.app\/g#t=[A-Za-z0-9_-]{43}[^\n]*/;

/** True when the description already carries a reply link. */
export function hasGuestLink(description: string): boolean {
  return LINK_LINE.test(description);
}

/** The description with the reply line at the end (one line, replaced when present). */
export function withGuestLink(description: string, label: string, url: string): string {
  const base = description.replace(LINK_LINE, '').trimEnd();
  const line = `${label}: ${url}`;
  return base.length > 0 ? `${base}\n\n${line}` : line;
}

export function withoutGuestLink(description: string): string {
  return description.replace(LINK_LINE, '').trimEnd();
}

/** A Firestore-style id (20 characters), for a meeting whose link is made before it is saved. */
export function newMeetingId(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 20; i += 1) id += alphabet[Math.floor(Math.random() * alphabet.length)];
  return id;
}

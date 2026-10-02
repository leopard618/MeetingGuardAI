/**
 * Bot strings (functions/src/whatsapp/messages.ts): EN/ES snapshots, the plain-punctuation
 * product rule, and the WhatsApp interactive-message limits.
 */
import { MAX_BUTTON_TITLE_CHARS, MAX_INTERACTIVE_BODY_CHARS } from '../../src/whatsapp/send';
import { BOT_STRINGS, bilingual, botStrings, formatConfirmPrompt, formatMeetingSummary } from '../../src/whatsapp/messages';

// Built from code points so this file itself contains none of the banned characters
// (same list as src/i18n/__tests__/noTypographicChars.test.ts).
const BANNED_CODES = [0x2014, 0x2013, 0x2026, 0x2018, 0x2019, 0x201c, 0x201d];
const BANNED = new RegExp(`[${BANNED_CODES.map((code) => String.fromCodePoint(code)).join('')}]`);

function flatten(value: unknown, out: string[]): void {
  if (typeof value === 'string') out.push(value);
  else if (typeof value === 'object' && value !== null) {
    for (const child of Object.values(value)) flatten(child, out);
  }
}

describe('bot strings', () => {
  it('cover EN and ES with identical key sets', () => {
    expect(Object.keys(BOT_STRINGS).sort()).toEqual(['en', 'es']);
    expect(Object.keys(BOT_STRINGS.es).sort()).toEqual(Object.keys(BOT_STRINGS.en).sort());
  });

  it('contain no typographic characters (product rule: plain punctuation only)', () => {
    const all: string[] = [];
    flatten(BOT_STRINGS, all);
    expect(all.length).toBeGreaterThan(20);
    for (const text of all) {
      expect(text).not.toMatch(BANNED);
    }
  });

  it('EN snapshot', () => {
    expect(BOT_STRINGS.en).toMatchSnapshot();
  });

  it('ES snapshot', () => {
    expect(BOT_STRINGS.es).toMatchSnapshot();
  });

  it('button titles fit the WhatsApp 20-char limit in both languages', () => {
    for (const language of ['en', 'es'] as const) {
      expect(botStrings(language).buttons.confirm.length).toBeLessThanOrEqual(MAX_BUTTON_TITLE_CHARS);
      expect(botStrings(language).buttons.cancel.length).toBeLessThanOrEqual(MAX_BUTTON_TITLE_CHARS);
    }
  });

  it('bilingual joins EN and ES', () => {
    const text = bilingual('linkPrompt');
    expect(text).toContain(BOT_STRINGS.en.linkPrompt);
    expect(text).toContain(BOT_STRINGS.es.linkPrompt);
  });
});

describe('formatting', () => {
  const meeting = {
    title: 'Design review',
    date: '2026-10-06',
    time: '14:30',
    timezone: 'Europe/Madrid',
    durationMinutes: 45,
    place: 'https://zoom.us/j/123',
  };

  it('formats a forwardable meeting summary (EN and ES)', () => {
    const en = formatMeetingSummary('en', meeting);
    expect(en).toContain('*Design review*');
    expect(en).toContain('When: 2026-10-06 14:30 (Europe/Madrid)');
    expect(en).toContain('Duration: 45 min');
    expect(en).toContain('Where: https://zoom.us/j/123');
    const es = formatMeetingSummary('es', meeting);
    expect(es).toContain('Cuándo: 2026-10-06 14:30 (Europe/Madrid)');
  });

  it('marks all-day meetings and omits a missing place', () => {
    const text = formatMeetingSummary('en', { ...meeting, time: null, place: null });
    expect(text).toContain('2026-10-06 (all day)');
    expect(text).not.toContain('Where:');
  });

  it('builds a confirm prompt that fits the interactive body limit for max-size summaries', () => {
    const summaries = ['Create "Team sync" tomorrow at 9:00', 'Delete "Old standup"'];
    const prompt = formatConfirmPrompt('en', summaries);
    expect(prompt).toContain('- Create "Team sync" tomorrow at 9:00');
    expect(prompt).toContain(BOT_STRINGS.en.confirmPrompt);
    // 10 actions x 100 chars stays inside the (truncated) 1000-char interactive body minus slack.
    expect(formatConfirmPrompt('es', ['x'.repeat(90)]).length).toBeLessThanOrEqual(MAX_INTERACTIVE_BODY_CHARS);
  });
});

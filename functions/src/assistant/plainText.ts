/**
 * Plain punctuation for model text the user sees and hears (owner: assistant). The prompt asks
 * for straight quotes and hyphens, but French and German output often carries typographic
 * apostrophes, guillemets, German low quotes and narrow no-break spaces anyway. The product text
 * rule allows none of them, and they read oddly aloud, so the handler maps them to plain ASCII
 * before anything is sent to the app.
 *
 * Kept on the assistant side on purpose (the matters module has its own copy for its texts).
 * Written with \u escapes only, so this file stays ASCII.
 */

/** Typographic punctuation -> plain characters. Everything else is left exactly as it was. */
export function plainText(text: string): string {
  return (
    text
      // Guillemets usually come with (no-break) spaces inside, which \s covers: they go too.
      .replace(/\u00ab\s*/g, '"')
      .replace(/\s*\u00bb/g, '"')
      .replace(/\u2039\s*/g, "'")
      .replace(/\s*\u203a/g, "'")
      // Curly and low single quotes (apostrophes), curly and low double quotes.
      .replace(/[\u2018\u2019\u201a\u201b]/g, "'")
      .replace(/[\u201c\u201d\u201e\u201f]/g, '"')
      // En dash and em dash; the ellipsis character.
      .replace(/[\u2013\u2014]/g, '-')
      .replace(/\u2026/g, '...')
      // No-break, narrow no-break and thin spaces (French "?" and ":" spacing) -> plain space.
      .replace(/[\u00a0\u202f\u2009]/g, ' ')
  );
}

/** plainText, then clipped to `max` characters (the mapping can make a text longer: "..."). */
export function plainClip(text: string, max: number): string {
  const plain = plainText(text);
  return plain.length > max ? plain.slice(0, max) : plain;
}

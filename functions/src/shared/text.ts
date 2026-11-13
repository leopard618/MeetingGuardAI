/**
 * Generic string helpers. PURE: no imports, no Firebase, no logging, no clock.
 *
 * Shared by the M10 and M11 summaries (functions/src/summaries, functions/src/commitments) and the
 * assistant matters (functions/src/matters, A2). Not a contract pair: there is no src/core copy and
 * check:contract does not read it. Deliberately NOT here: anything that knows about summaries
 * (sanitizeText, line spans, section anchors) and anything keyed (the ids and digests of
 * commitments/ids.ts, HMACs under the summaries Keyring of shared/sealed.ts).
 *
 * Product text rule: ASCII punctuation only in this file.
 */

/** Cuts at `max` UTF-16 units without splitting a surrogate pair. */
export function sliceSafe(text: string, max: number): string {
  if (text.length <= max) return text;
  let cut = max;
  const code = text.charCodeAt(cut - 1);
  if (cut > 0 && code >= 0xd800 && code <= 0xdbff) cut -= 1;
  return text.slice(0, cut);
}

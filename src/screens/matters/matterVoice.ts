/**
 * Pure helpers of the assistant's voice on the matters screens (A3; docs/v1/ARCHITECTURE.md
 * section 36). The hook is useMatterVoice.ts. A3 feedback: the microphone no longer listens while an answer
 * is spoken (the phone's speaker wrote the assistant's own words into the box), so there is no echo
 * to tell apart any more.
 */

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Bytes of a base64 string (the natural voice's MP3); characters outside the alphabet are skipped. */
export function base64ToBytes(input: string): Uint8Array {
  const clean = input.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let buffer = 0;
  let bits = 0;
  let index = 0;
  for (const char of clean) {
    buffer = (buffer << 6) | BASE64.indexOf(char);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[index] = (buffer >> bits) & 0xff;
      index += 1;
    }
  }
  return out.subarray(0, index);
}

/** The ask intents that are an action the owner must confirm first. */
export const ACTION_INTENTS = ['pause', 'resume', 'cancel', 'change', 'new_matter', 'move_meeting', 'message'] as const;
export type ActionIntent = (typeof ACTION_INTENTS)[number];

export function isActionIntent(intent: string): intent is ActionIntent {
  return (ACTION_INTENTS as readonly string[]).includes(intent);
}

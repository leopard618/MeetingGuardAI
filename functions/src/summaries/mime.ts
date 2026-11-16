/**
 * MIME parsing of inbound summary mail (docs/v2/M10-DESIGN.md section 4 step 5, decision table
 * row 4, red-team findings 11 and 16), on postal-mime 4.1.4 (pinned exact).
 *
 * - The raw size is checked BEFORE parsing: over SUMMARY_MIME_LIMITS.maxRawBytes is too_large and
 *   the parser never runs.
 * - postal-mime enforces the structural caps while it parses, so a hostile message never builds a
 *   large tree: maxPartCount (every MIME node, the message itself included) over 100 rejects with
 *   EMAXPARTCOUNT, a part nested deeper than 10 levels below the message with EMAXNESTINGDEPTH,
 *   and header bytes over maxHeaderBytes (each line counted as at least 64 bytes) with
 *   EMAXHEADERSIZE. All three are too_large, as the contract defines it ("5 MiB raw, 100 MIME
 *   parts or 10 levels of nesting"). Any other parser error is malformed.
 * - Attached messages (message/rfc822) are NEVER parsed inline (forceRfc822Attachments, and
 *   maxRfc822NestingDepth 0 as a second lock). A nested parser restarts postal-mime's depth count
 *   at zero, so inline parsing would let the depth cap be exceeded once per attached message;
 *   with it off, the caps above describe the whole message exactly. An attached message counts as
 *   one attachment, and its text never reaches `text` or `html` (verifying an attached recap is
 *   not M10 base scope; section 10). attachedMessageCount tells the pipeline one is there (also an
 *   .eml or .msg file under another type, see ATTACHED_MESSAGE_TYPES), so a user forward that
 *   carries an attached message is refused unless its inline text is the notetaker's own
 *   forwarded recap, instead of being stored as the forwarder's note (inbound.ts).
 * - text and html are the message's OWN text/plain and text/html parts, decoded (transfer
 *   encoding and charset) by postal-mime. postal-mime's public `text` also renders an HTML part
 *   that has no text/plain sibling through its regex tag stripper when some other part is plain
 *   (multipart/mixed with both kinds); that would let hidden HTML text into `text` (finding 16,
 *   sanitize.ts HtmlToTextPort). So both are rebuilt from the parser's per-part text entries,
 *   joined with "\n" in document order as postal-mime joins them, without conversions.
 * - partCount is postal-mime's own node count (the counter the part cap is enforced on), read
 *   after the parse.
 *
 * Reading the parser's internals (counters.partCount, textMap) is safe because the version is
 * pinned exact and the tests pin the behavior. If an upgrade changes them, parseMime fails CLOSED
 * (malformed, with an error log carrying a detail code only) and the tests fail.
 *
 * Never throws for message content. The subject, text and html are message content: never log
 * them. Logs carry error names, codes and counts only.
 */
import * as logger from 'firebase-functions/logger';
import PostalMime from 'postal-mime';

export const SUMMARY_MIME_LIMITS = {
  /** Raw message bytes, checked before parsing (5 MiB). */
  maxRawBytes: 5 * 1024 * 1024,
  /** MIME nodes in the whole message, the message itself included. */
  maxParts: 100,
  /** Levels of parts below the message (the message is level 0). */
  maxDepth: 10,
  /**
   * Header bytes across every part, a line counted as at least 64 bytes (postal-mime's
   * accounting). A real recap's top-level header block is tens of KiB.
   */
  maxHeaderBytes: 1024 * 1024,
} as const;

export type MimeFailureReason = 'too_large' | 'malformed';

export interface ParsedMime {
  ok: true;
  /** The decoded Subject (RFC 2047 words decoded), or null when absent or empty. Content. */
  subject: string | null;
  /** The message's own text/plain parts, decoded; null when there are none (or all are empty). Content. */
  text: string | null;
  /** The message's own text/html parts, decoded; null when there are none. Content, never stored. */
  html: string | null;
  /** MIME nodes, the message itself included (1 for a single-part message). */
  partCount: number;
  /** Attachments as postal-mime classifies them (attached messages and inline images included). */
  attachmentCount: number;
  /**
   * Attached messages among them: message/rfc822 parts (a multipart/digest child defaults to it),
   * message/global (its RFC 6532 form), message/news, message/partial and
   * application/vnd.ms-outlook parts, and any attachment whose file name ends in .eml or .msg
   * (case-insensitive; a saved message sent as application/octet-stream). Never parsed inline,
   * so their text is in neither `text` nor `html`.
   */
  attachedMessageCount: number;
}

export type MimeParseResult = ParsedMime | { ok: false; reason: MimeFailureReason };

/** Options passed to every parse. Exported for the tests. */
export const POSTAL_MIME_OPTIONS: PostalMime.PostalMimeOptions = {
  maxNestingDepth: SUMMARY_MIME_LIMITS.maxDepth,
  maxPartCount: SUMMARY_MIME_LIMITS.maxParts,
  maxHeadersSize: SUMMARY_MIME_LIMITS.maxHeaderBytes,
  forceRfc822Attachments: true,
  maxRfc822NestingDepth: 0,
  attachmentEncoding: 'arraybuffer',
};

/**
 * postal-mime error codes that mean "too big" (the contract's too_large: size, parts or nesting);
 * every other failure is malformed. They are the expected structural refusals, not worth a log
 * line (the handler logs the verdict).
 */
const TOO_LARGE_CODES: ReadonlySet<string> = new Set(['EMAXPARTCOUNT', 'EMAXNESTINGDEPTH', 'EMAXHEADERSIZE', 'EMAXFORWARDEDADDRESSES']);

/**
 * Content types of an attached message (lowercased, as postal-mime parses them): message/rfc822
 * and its RFC 6532 form message/global, the older message/news, message/partial (one fragment of a
 * split message) and an Outlook item (application/vnd.ms-outlook, a .msg file).
 */
const ATTACHED_MESSAGE_TYPES: ReadonlySet<string> = new Set([
  'message/rfc822',
  'message/global',
  'message/news',
  'message/partial',
  'application/vnd.ms-outlook',
]);

/**
 * File name endings of an attached message whatever its declared type: a saved message (.eml)
 * often travels as application/octet-stream, and an Outlook item (.msg) under several types.
 */
const ATTACHED_MESSAGE_EXTENSIONS: readonly string[] = ['.eml', '.msg'];

const MALFORMED = { ok: false, reason: 'malformed' } as const;
const TOO_LARGE = { ok: false, reason: 'too_large' } as const;

function errorCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null || !('code' in error)) return null;
  const code = (error as { code: unknown }).code;
  return typeof code === 'string' ? code : null;
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

/** The parser state parseMime reads after a parse (postal-mime 4.1.4 internals). */
interface ParserInternals {
  counters?: { partCount?: unknown };
  textMap?: unknown;
}

type ShapeDetail = 'part_count' | 'text_map' | 'text_entry' | 'text_mismatch';

class ParserShapeError extends Error {
  constructor(readonly detail: ShapeDetail) {
    super('postal-mime internals changed');
    this.name = 'ParserShapeError';
  }
}

function readPartCount(internals: ParserInternals): number {
  const count = internals.counters?.partCount;
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 1 || count > SUMMARY_MIME_LIMITS.maxParts) {
    throw new ParserShapeError('part_count');
  }
  return count;
}

function collectEntries(list: unknown, out: string[]): void {
  if (list === undefined) return;
  if (!Array.isArray(list)) throw new ParserShapeError('text_entry');
  for (const item of list) {
    if (typeof item !== 'object' || item === null) throw new ParserShapeError('text_entry');
    const { type, value } = item as { type?: unknown; value?: unknown };
    // 'subMessage' entries exist only for inline message/rfc822 parts, which are switched off.
    if (type !== 'text' || typeof value !== 'string') throw new ParserShapeError('text_entry');
    out.push(value);
  }
}

/** The own text/plain and text/html parts, in document order, without any conversion. */
function readOwnText(internals: ParserInternals): { plain: string; html: string } {
  const textMap = internals.textMap;
  if (!(textMap instanceof Map)) throw new ParserShapeError('text_map');
  const plain: string[] = [];
  const html: string[] = [];
  for (const entry of textMap.values()) {
    if (typeof entry !== 'object' || entry === null) throw new ParserShapeError('text_entry');
    const lists = entry as { plain?: unknown; html?: unknown };
    collectEntries(lists.plain, plain);
    collectEntries(lists.html, html);
  }
  return { plain: plain.join('\n'), html: html.join('\n') };
}

function nonEmpty(value: string | undefined): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * The file name lowercased, without surrounding whitespace and without trailing dots (Windows
 * drops those, so "recap.eml." opens as recap.eml). A loop, not a regex: no backtracking on a
 * hostile run of dots.
 */
function normalizedFilename(filename: unknown): string {
  if (typeof filename !== 'string') return '';
  let name = filename.trim();
  let end = name.length;
  while (end > 0 && name.charCodeAt(end - 1) === 0x2e) end -= 1;
  name = name.slice(0, end).trimEnd();
  return name.toLowerCase();
}

/** Whether one of postal-mime's attachments is an attached message (by type or by file name). */
function isAttachedMessage(attachment: { mimeType?: unknown; filename?: unknown }): boolean {
  const type = typeof attachment.mimeType === 'string' ? attachment.mimeType.trim().toLowerCase() : '';
  if (ATTACHED_MESSAGE_TYPES.has(type)) return true;
  const name = normalizedFilename(attachment.filename);
  return ATTACHED_MESSAGE_EXTENSIONS.some((extension) => name.endsWith(extension));
}

/** How many of postal-mime's attachments are attached messages (see isAttachedMessage). */
function countAttachedMessages(attachments: readonly { mimeType?: unknown; filename?: unknown }[]): number {
  let count = 0;
  for (const attachment of attachments) {
    if (isAttachedMessage(attachment)) count += 1;
  }
  return count;
}

/**
 * Parses one raw message (step 5). too_large: over maxRawBytes (checked first), more than
 * maxParts MIME nodes, a part deeper than maxDepth, or header bytes over maxHeaderBytes.
 * malformed: not a non-empty Buffer, or any other parser failure. Never throws.
 */
export async function parseMime(raw: Buffer): Promise<MimeParseResult> {
  if (!Buffer.isBuffer(raw) || raw.length === 0) return MALFORMED;
  if (raw.length > SUMMARY_MIME_LIMITS.maxRawBytes) return TOO_LARGE;
  try {
    const parser = new PostalMime(POSTAL_MIME_OPTIONS);
    const email = await parser.parse(raw);
    const internals = parser as unknown as ParserInternals;
    const partCount = readPartCount(internals);
    const own = readOwnText(internals);
    // Cross-check against the public output where postal-mime converts nothing: with no HTML at
    // all its text is exactly the own plain parts, and with no plain part its html is exactly the
    // own HTML parts. A difference means the internals no longer mean what this module assumes.
    if (email.html === undefined && own.plain !== (email.text ?? '')) throw new ParserShapeError('text_mismatch');
    if (email.text === undefined && own.html !== (email.html ?? '')) throw new ParserShapeError('text_mismatch');
    const attachments = Array.isArray(email.attachments) ? email.attachments : [];
    return {
      ok: true,
      subject: nonEmpty(email.subject),
      text: nonEmpty(own.plain),
      html: nonEmpty(own.html),
      partCount,
      attachmentCount: attachments.length,
      attachedMessageCount: countAttachedMessages(attachments),
    };
  } catch (error) {
    if (error instanceof ParserShapeError) {
      logger.error('summaries.mime_parser_shape', { detail: error.detail });
      return MALFORMED;
    }
    const code = errorCode(error);
    if (code === null || !TOO_LARGE_CODES.has(code)) {
      logger.warn('summaries.mime_error', { errorName: errorName(error), code });
    }
    return code !== null && TOO_LARGE_CODES.has(code) ? TOO_LARGE : MALFORMED;
  }
}

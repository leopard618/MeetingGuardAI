/**
 * A5: the client of matterStream, answers and briefings streamed as they are written (the server
 * writes newline-delimited JSON lines: text pieces, then done or error). The app speaks from the
 * first sentence. Read with expo/fetch, which gives the body as it arrives; where a body cannot be
 * read as a stream, the whole body is read at the end (the same lines), so the answer still comes,
 * only later. Nothing the user says is logged.
 */
import { matterStreamLineSchema, MATTER_STREAM_FUNCTION, type MatterStreamLine } from '../../core/aiContract';
import { AppError } from '../../core/errors';
import { createLogger } from '../../core/logger';

const log = createLogger('matters.stream');

export interface StreamTransport {
  /** Posts the request and calls onLine for every line as it arrives; resolves at the end. */
  open(body: unknown, onLine: (line: MatterStreamLine) => void): Promise<void>;
}

/** The bits of a fetch response this client reads (expo/fetch or the global fetch). */
interface ResponseLike {
  ok: boolean;
  status: number;
  body?: { getReader(): { read(): Promise<{ done: boolean; value?: Uint8Array }> } } | null;
  text(): Promise<string>;
}
export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<ResponseLike>;

/** UTF-8 bytes to text across chunk boundaries (a character split between two chunks waits). */
export class Utf8Stream {
  private pending: number[] = [];

  decode(bytes: Uint8Array): string {
    const all = [...this.pending, ...bytes];
    let out = '';
    let i = 0;
    while (i < all.length) {
      const b = all[i]!;
      const size = b < 0x80 ? 1 : b >= 0xf0 ? 4 : b >= 0xe0 ? 3 : b >= 0xc0 ? 2 : 1;
      if (i + size > all.length) break;
      let code = size === 1 ? b : b & (0xff >> (size + 1));
      for (let k = 1; k < size; k += 1) code = (code << 6) | (all[i + k]! & 0x3f);
      out += String.fromCodePoint(code);
      i += size;
    }
    this.pending = all.slice(i);
    return out;
  }
}

/** Splits text into lines and parses each one; a line that does not parse is skipped. */
export class LineReader {
  private buffer = '';

  constructor(private readonly onLine: (line: MatterStreamLine) => void) {}

  push(text: string): void {
    this.buffer += text;
    let at = this.buffer.indexOf('\n');
    while (at >= 0) {
      this.emit(this.buffer.slice(0, at));
      this.buffer = this.buffer.slice(at + 1);
      at = this.buffer.indexOf('\n');
    }
  }

  end(): void {
    if (this.buffer.trim()) this.emit(this.buffer);
    this.buffer = '';
  }

  private emit(raw: string): void {
    if (!raw.trim()) return;
    try {
      const parsed = matterStreamLineSchema.safeParse(JSON.parse(raw));
      if (parsed.success) this.onLine(parsed.data);
    } catch {
      log.warn('an unreadable stream line was skipped');
    }
  }
}

export function createHttpStreamTransport(deps: { url(): string | null; token(): Promise<string | null>; fetch: FetchLike }): StreamTransport {
  return {
    async open(body, onLine) {
      const url = deps.url();
      const token = await deps.token();
      if (!url || !token) throw new AppError('not_configured', 'The streamed answers are not available.');
      let response: ResponseLike;
      try {
        response = await deps.fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
      } catch (error) {
        throw new AppError('offline', 'The streamed answer could not start.', { cause: error, details: { stream: 'unavailable' } });
      }
      if (!response.ok) throw new AppError('upstream_error', `matterStream answered ${response.status}`, { details: { stream: 'unavailable' } });
      const reader = new LineReader(onLine);
      const stream = response.body && typeof response.body.getReader === 'function' ? response.body.getReader() : null;
      if (!stream) {
        reader.push(await response.text());
        reader.end();
        return;
      }
      const utf8 = new Utf8Stream();
      for (;;) {
        const { done, value } = await stream.read();
        if (done) break;
        if (value) reader.push(utf8.decode(value));
      }
      reader.end();
    },
  };
}

/** The function's address: https://<region>-<project>.cloudfunctions.net/matterStream. */
export function streamUrl(region: string, projectId: string | undefined): string | null {
  return projectId ? `https://${region}-${projectId}.cloudfunctions.net/${MATTER_STREAM_FUNCTION}` : null;
}

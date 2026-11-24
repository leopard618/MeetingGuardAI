/**
 * M13: WhatsApp voice notes. A voice note is downloaded from the Cloud API, transcribed by
 * OpenAI, and its text then follows the same path as a typed message (webhook.ts). Nothing is
 * stored: the audio lives only in this invocation's memory and the transcript only in the
 * session turn the assistant bridge keeps anyway (as for a typed message). Logs carry sizes,
 * mime types and outcome codes only, never audio, text or phone numbers.
 *
 * Download (Graph media flow): GET /<version>/<media id> with the bot's token answers
 * { url, mime_type, file_size }; GET <url> with the same token answers the bytes. The URL is
 * short-lived, so both calls run back to back.
 */
import OpenAI, { toFile } from 'openai';

import { WHATSAPP_TUNING } from '../config';
import type { AppLanguage } from '../shared/aiContract';

export interface InboundAudio {
  /** The Cloud API media id (message.audio.id). */
  mediaId: string;
  mimeType: string | null;
  /** true for a recorded voice note (message.audio.voice), false for a forwarded audio file. */
  voice: boolean;
}

export type VoiceFailure = 'too_long' | 'empty' | 'failed';
export type VoiceResult = { ok: true; text: string } | { ok: false; reason: VoiceFailure };

export interface VoicePort {
  /** Read-only allowance check: false means no AI action is left, so nothing is downloaded. */
  hasAllowance(uid: string, now: Date): Promise<boolean>;
  transcribe(audio: InboundAudio, language: AppLanguage): Promise<VoiceResult>;
}

/** The download half (Graph), separate so tests can fake either half. */
export interface MediaFetcher {
  /** The bytes, or 'too_long' when Meta reports (or the body exceeds) the size cap. */
  download(mediaId: string): Promise<{ bytes: Buffer; mimeType: string } | 'too_long'>;
}

/** The transcription half (OpenAI). */
export interface Transcriber {
  transcribe(bytes: Buffer, mimeType: string, language: AppLanguage): Promise<string>;
}

export class VoiceDownloadError extends Error {
  constructor(
    readonly status: number | null,
    message: string,
  ) {
    super(message);
    this.name = 'VoiceDownloadError';
  }
}

export interface GraphMediaConfig {
  accessToken: string;
  graphVersion?: string;
  timeoutMs?: number;
  maxBytes?: number;
  fetchImpl?: typeof fetch;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

export function createGraphMediaFetcher(config: GraphMediaConfig): MediaFetcher {
  const version = config.graphVersion ?? WHATSAPP_TUNING.graphVersion;
  const timeoutMs = config.timeoutMs ?? WHATSAPP_TUNING.graphRequestTimeoutMs;
  const maxBytes = config.maxBytes ?? WHATSAPP_TUNING.voiceMaxBytes;
  const doFetch = config.fetchImpl ?? fetch;
  const headers = { Authorization: `Bearer ${config.accessToken}` };

  async function get(url: string): Promise<Response> {
    let response: Response;
    try {
      response = await doFetch(url, { method: 'GET', headers, signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      throw new VoiceDownloadError(null, error instanceof Error ? error.name : 'fetch_failed');
    }
    if (!response.ok) {
      await response.text().catch(() => '');
      throw new VoiceDownloadError(response.status, `Graph media request failed (${response.status})`);
    }
    return response;
  }

  return {
    async download(mediaId) {
      if (!/^[0-9A-Za-z_-]{1,128}$/.test(mediaId)) throw new VoiceDownloadError(null, 'bad_media_id');
      const meta = asRecord(await (await get(`https://graph.facebook.com/${version}/${mediaId}`)).json().catch(() => null));
      const url = typeof meta?.url === 'string' ? meta.url : null;
      if (url === null || !url.startsWith('https://')) throw new VoiceDownloadError(null, 'no_media_url');
      const size = typeof meta?.file_size === 'number' ? meta.file_size : Number(meta?.file_size);
      if (Number.isFinite(size) && size > maxBytes) return 'too_long';
      const body = await get(url);
      const bytes = Buffer.from(await body.arrayBuffer());
      if (bytes.length > maxBytes) return 'too_long';
      const mimeType = typeof meta?.mime_type === 'string' ? meta.mime_type : 'audio/ogg';
      return { bytes, mimeType };
    },
  };
}

/** File name with the extension OpenAI uses to detect the format. */
export function audioFileName(mimeType: string): string {
  const type = mimeType.split(';')[0]!.trim().toLowerCase();
  if (type === 'audio/mpeg' || type === 'audio/mp3') return 'voice.mp3';
  if (type === 'audio/mp4' || type === 'audio/m4a' || type === 'audio/x-m4a') return 'voice.m4a';
  if (type === 'audio/aac') return 'voice.aac';
  if (type === 'audio/amr') return 'voice.amr';
  if (type === 'audio/wav' || type === 'audio/x-wav') return 'voice.wav';
  if (type === 'audio/webm') return 'voice.webm';
  return 'voice.ogg'; // WhatsApp voice notes: audio/ogg; codecs=opus
}

export function createOpenAiTranscriber(getKey: () => Promise<string>, model: string = WHATSAPP_TUNING.voiceModel): Transcriber {
  return {
    async transcribe(bytes, mimeType, language) {
      const client = new OpenAI({ apiKey: await getKey(), timeout: WHATSAPP_TUNING.voiceTimeoutMs, maxRetries: 0 });
      const file = await toFile(bytes, audioFileName(mimeType), { type: mimeType.split(';')[0]!.trim() });
      const result = await client.audio.transcriptions.create({ file, model, language, response_format: 'json' });
      return typeof result.text === 'string' ? result.text : '';
    },
  };
}

/** Collapses whitespace and caps the length so a transcript reads like a typed message. */
export function cleanTranscript(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, WHATSAPP_TUNING.voiceMaxTranscriptChars);
}

export interface VoicePortDeps {
  media: MediaFetcher;
  transcriber: Transcriber;
  hasAllowance(uid: string, now: Date): Promise<boolean>;
  log?: (event: string, fields: Record<string, unknown>) => void;
}

export function createVoicePort(deps: VoicePortDeps): VoicePort {
  const log = deps.log ?? (() => undefined);
  return {
    hasAllowance: (uid, now) => deps.hasAllowance(uid, now),
    async transcribe(audio, language) {
      let downloaded: Awaited<ReturnType<MediaFetcher['download']>>;
      try {
        downloaded = await deps.media.download(audio.mediaId);
      } catch (error) {
        log('whatsapp.voice_download_failed', { status: error instanceof VoiceDownloadError ? error.status : null });
        return { ok: false, reason: 'failed' };
      }
      if (downloaded === 'too_long') {
        log('whatsapp.voice_too_long', {});
        return { ok: false, reason: 'too_long' };
      }
      let text: string;
      try {
        text = cleanTranscript(await deps.transcriber.transcribe(downloaded.bytes, downloaded.mimeType, language));
      } catch (error) {
        log('whatsapp.voice_transcribe_failed', { errorName: error instanceof Error ? error.name : typeof error });
        return { ok: false, reason: 'failed' };
      }
      log('whatsapp.voice_transcribed', { bytes: downloaded.bytes.length, mime: downloaded.mimeType.split(';')[0], chars: text.length });
      return text.length === 0 ? { ok: false, reason: 'empty' } : { ok: true, text };
    },
  };
}

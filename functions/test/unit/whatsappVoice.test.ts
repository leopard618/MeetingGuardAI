import { WHATSAPP_TUNING } from '../../src/config';
import { audioFileName, cleanTranscript, createGraphMediaFetcher, createVoicePort, type MediaFetcher, type Transcriber } from '../../src/whatsapp/voice';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('createGraphMediaFetcher', () => {
  it('asks Graph for the media URL, then downloads it, both with the bot token', async () => {
    const calls: { url: string; auth: string | null }[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push({ url, auth: new Headers(init?.headers).get('authorization') });
      if (url.endsWith('/media1')) return jsonResponse({ url: 'https://lookaside.example/abc', mime_type: 'audio/ogg; codecs=opus', file_size: 4 });
      return new Response(new Uint8Array([1, 2, 3, 4]), { status: 200 });
    }) as unknown as typeof fetch;
    const result = await createGraphMediaFetcher({ accessToken: 'tok', fetchImpl }).download('media1');
    expect(result).toEqual({ bytes: Buffer.from([1, 2, 3, 4]), mimeType: 'audio/ogg; codecs=opus' });
    expect(calls).toEqual([
      { url: `https://graph.facebook.com/${WHATSAPP_TUNING.graphVersion}/media1`, auth: 'Bearer tok' },
      { url: 'https://lookaside.example/abc', auth: 'Bearer tok' },
    ]);
  });

  it('refuses a note above the cap without downloading it', async () => {
    let downloads = 0;
    const fetchImpl = (async (url: string) => {
      if (url.endsWith('/media1')) return jsonResponse({ url: 'https://lookaside.example/abc', mime_type: 'audio/ogg', file_size: 900_000 });
      downloads += 1;
      return new Response(new Uint8Array([1]));
    }) as unknown as typeof fetch;
    expect(await createGraphMediaFetcher({ accessToken: 'tok', fetchImpl }).download('media1')).toBe('too_long');
    expect(downloads).toBe(0);
  });

  it('refuses a body above the cap when Meta gave no size', async () => {
    const fetchImpl = (async (url: string) => {
      if (url.endsWith('/media1')) return jsonResponse({ url: 'https://lookaside.example/abc' });
      return new Response(new Uint8Array(20));
    }) as unknown as typeof fetch;
    expect(await createGraphMediaFetcher({ accessToken: 'tok', fetchImpl, maxBytes: 10 }).download('media1')).toBe('too_long');
  });

  it('throws on a Graph error, a missing URL or a malformed media id', async () => {
    const failing = (async () => jsonResponse({ error: {} }, 404)) as unknown as typeof fetch;
    await expect(createGraphMediaFetcher({ accessToken: 'tok', fetchImpl: failing }).download('media1')).rejects.toThrow('404');
    const noUrl = (async () => jsonResponse({})) as unknown as typeof fetch;
    await expect(createGraphMediaFetcher({ accessToken: 'tok', fetchImpl: noUrl }).download('media1')).rejects.toThrow('no_media_url');
    await expect(createGraphMediaFetcher({ accessToken: 'tok', fetchImpl: noUrl }).download('../x')).rejects.toThrow('bad_media_id');
  });
});

describe('createVoicePort', () => {
  const media: MediaFetcher = { download: async () => ({ bytes: Buffer.from([1]), mimeType: 'audio/ogg' }) };
  const audio = { mediaId: 'm1', mimeType: 'audio/ogg', voice: true };

  it('returns the cleaned transcript in the user language', async () => {
    const languages: string[] = [];
    const transcriber: Transcriber = {
      transcribe: async (_bytes, _mime, language) => {
        languages.push(language);
        return '  Crea una reunión\n mañana a las 10  ';
      },
    };
    const port = createVoicePort({ media, transcriber, hasAllowance: async () => true });
    expect(await port.transcribe(audio, 'es')).toEqual({ ok: true, text: 'Crea una reunión mañana a las 10' });
    expect(languages).toEqual(['es']);
  });

  it('maps every failure to a reason and never throws', async () => {
    const ok: Transcriber = { transcribe: async () => 'x' };
    const tooLong = createVoicePort({ media: { download: async () => 'too_long' }, transcriber: ok, hasAllowance: async () => true });
    expect(await tooLong.transcribe(audio, 'en')).toEqual({ ok: false, reason: 'too_long' });
    const downFails = createVoicePort({ media: { download: async () => Promise.reject(new Error('x')) }, transcriber: ok, hasAllowance: async () => true });
    expect(await downFails.transcribe(audio, 'en')).toEqual({ ok: false, reason: 'failed' });
    const sttFails = createVoicePort({ media, transcriber: { transcribe: async () => Promise.reject(new Error('x')) }, hasAllowance: async () => true });
    expect(await sttFails.transcribe(audio, 'en')).toEqual({ ok: false, reason: 'failed' });
    const silent = createVoicePort({ media, transcriber: { transcribe: async () => '   ' }, hasAllowance: async () => true });
    expect(await silent.transcribe(audio, 'en')).toEqual({ ok: false, reason: 'empty' });
  });

  it('logs sizes and outcomes only, never the text', async () => {
    const events: Record<string, unknown>[] = [];
    const port = createVoicePort({
      media,
      transcriber: { transcribe: async () => 'secret words' },
      hasAllowance: async () => true,
      log: (_event, fields) => events.push(fields),
    });
    await port.transcribe(audio, 'en');
    expect(JSON.stringify(events)).not.toContain('secret');
  });
});

describe('helpers', () => {
  it('names the file by mime type (voice notes are ogg)', () => {
    expect(audioFileName('audio/ogg; codecs=opus')).toBe('voice.ogg');
    expect(audioFileName('audio/mpeg')).toBe('voice.mp3');
    expect(audioFileName('audio/mp4')).toBe('voice.m4a');
    expect(audioFileName('application/x-unknown')).toBe('voice.ogg');
  });

  it('cleanTranscript collapses whitespace and caps the length', () => {
    expect(cleanTranscript(' a\n\tb ')).toBe('a b');
    expect(cleanTranscript('x'.repeat(5000))).toHaveLength(WHATSAPP_TUNING.voiceMaxTranscriptChars);
  });
});

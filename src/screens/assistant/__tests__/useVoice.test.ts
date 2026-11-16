/**
 * Spoken output in the UI language (M12): the device's TTS voices are checked once per language,
 * and with no voice for the language nothing is spoken (a one-time hint instead).
 */
jest.mock('expo-speech', () => ({
  speak: jest.fn(),
  stop: jest.fn(() => Promise.resolve()),
  getAvailableVoicesAsync: jest.fn(),
}));

type Voice = { identifier: string; name: string; quality: string; language: string };
type SpeechMock = { speak: jest.Mock; stop: jest.Mock; getAvailableVoicesAsync: jest.Mock };

/** A fresh copy of useVoice (its voice caches are per module instance) with the device voices. */
function load(voices: Voice[] | Error): { speakAloud: typeof import('../useVoice').speakAloud; Speech: SpeechMock } {
  let loaded!: { speakAloud: typeof import('../useVoice').speakAloud; Speech: SpeechMock };
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Speech = require('expo-speech') as SpeechMock;
    Speech.getAvailableVoicesAsync.mockImplementation(() => (voices instanceof Error ? Promise.reject(voices) : Promise.resolve(voices)));
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { speakAloud } = require('../useVoice') as typeof import('../useVoice');
    loaded = { speakAloud, Speech };
  });
  return loaded;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const voice = (identifier: string, language: string, quality = 'Default'): Voice => ({ identifier, name: identifier, quality, language });

describe('speakAloud (M12 voices)', () => {
  it('speaks in the language tag with the best voice of that language', async () => {
    const { speakAloud, Speech } = load([voice('en', 'en-US'), voice('pt-br', 'pt-BR'), voice('pt-br-hq', 'pt-BR', 'Enhanced')]);
    speakAloud('Tudo certo', 'pt');
    await flush();
    expect(Speech.speak).toHaveBeenCalledWith('Tudo certo', expect.objectContaining({ language: 'pt-BR', rate: 1.0, pitch: 1.0 }));
    const options = Speech.speak.mock.calls[0]![1] as { voice?: string; onError?: unknown };
    expect(typeof options.onError).toBe('function');
    // jest-expo runs as iOS: the chosen voice is passed explicitly there.
    expect(options.voice).toBe('pt-br-hq');
  });

  it('stays silent and hints once when no voice speaks the language', async () => {
    const info = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const { speakAloud, Speech } = load([voice('en', 'en-US'), voice('es', 'es-ES')]);
    const onNoVoice = jest.fn();
    speakAloud('Erledigt', 'de', { onNoVoice });
    await flush();
    speakAloud('Erledigt', 'de', { onNoVoice });
    await flush();
    expect(Speech.speak).not.toHaveBeenCalled();
    expect(onNoVoice).toHaveBeenCalledTimes(1);
    expect(Speech.getAvailableVoicesAsync).toHaveBeenCalledTimes(1);
    info.mockRestore();
  });

  it('speaks with the language tag only when the voices cannot be listed', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { speakAloud, Speech } = load(new Error('no engine'));
    const onNoVoice = jest.fn();
    speakAloud("C'est fait", 'fr', { onNoVoice });
    await flush();
    expect(Speech.speak).toHaveBeenCalledWith("C'est fait", expect.objectContaining({ language: 'fr-FR' }));
    expect((Speech.speak.mock.calls[0]![1] as { voice?: string }).voice).toBeUndefined();
    expect(onNoVoice).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

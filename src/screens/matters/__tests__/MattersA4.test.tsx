/**
 * A4: "Delete this matter" (asks first), the usage meter on the matters screen, the messages that
 * name the limit reached, the "promise" guard flag, and the service calls behind them.
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { PaperProvider } from 'react-native-paper';
import Toast from 'react-native-toast-message';

import { CALLABLES } from '../../../core/aiContract';
import { AppError } from '../../../core/errors';
import { I18nProvider, i18n } from '../../../i18n';
import { createMatterService, mapMatterError, type MatterTransport } from '../../../services/matters/matterService';
import { MattersScreen } from '../MattersScreen';
import { matterErrorKey } from '../matterErrors';

jest.mock('expo-localization', () => ({
  getLocales: jest.fn(() => [{ languageCode: 'en', languageTag: 'en-US' }]),
  getCalendars: jest.fn(() => [{ timeZone: 'Europe/Madrid', uses24hourClock: false }]),
}));
jest.mock('react-native-toast-message', () => ({ __esModule: true, default: { show: jest.fn() } }));
jest.mock('expo-speech', () => ({ speak: jest.fn(), stop: jest.fn() }));
jest.mock('firebase/functions', () => ({ httpsCallable: jest.fn() }));
jest.mock('../../../config/firebase', () => ({ functions: null, isFirebaseReady: false }));
jest.mock('../../assistant/useVoice', () => ({ useVoiceInput: () => ({ status: 'idle', toggle: jest.fn() }) }));

const mockService = {
  listOpen: jest.fn(),
  getPage: jest.fn(),
  usage: jest.fn(),
  remove: jest.fn(),
  decide: jest.fn(),
  cancel: jest.fn(),
  setStatus: jest.fn(),
};
jest.mock('../../../services/matters', () => ({
  matterService: new Proxy(
    { isEnabled: () => true },
    { get: (target: Record<string, unknown>, key: string) => (key in target ? target[key] : (...args: unknown[]): unknown => (mockService as Record<string, jest.Mock>)[key]!(...args)) },
  ),
}));

const ITEM = { matterId: 'm1', status: 'active', title: 'Proposal from Carlos', updatedAt: '2026-11-12T10:00:00.000Z', pendingApprovals: 0, contacts: ['Carlos Ruiz'], meeting: null };
const CARD = {
  id: 'c1',
  kind: 'reply_draft',
  status: 'pending',
  reason: null,
  quote: 'Here it is.',
  from: 'Carlos Ruiz <carlos@example.com>',
  draft: { to: ['carlos@example.com'], cc: [], subject: 'Re: Updated proposal', text: 'Hello Carlos,\n\nI promise it will be ready.\n\nBest,' },
  draftHash: 'b'.repeat(64),
  guardFlags: ['promise'],
  sendOutcome: null,
  auto: false,
  createdAt: '2026-11-12T10:00:00.000Z',
  slot: null,
};
const PAGE = { matter: ITEM, approvals: [CARD], proposals: [], events: [], usage: null };
const USAGE = {
  month: '2026-11',
  resetsAt: '2026-12-01T00:00:00.000Z',
  matters: { used: 3, limit: 10 },
  emails: { used: 12, limit: 100 },
  voiceMinutes: { used: 0, limit: 30 },
  today: { drafts: { used: 2, limit: 30 }, sends: { used: 1, limit: 30 }, capReached: false },
};

async function renderScreen(): Promise<void> {
  await render(
    <I18nProvider>
      <PaperProvider>
        <MattersScreen />
      </PaperProvider>
    </I18nProvider>,
  );
}

async function press(testID: string): Promise<void> {
  await act(async () => {
    fireEvent.press(screen.getByTestId(testID));
  });
}

beforeEach(async () => {
  jest.clearAllMocks();
  mockService.listOpen.mockResolvedValue([ITEM]);
  mockService.getPage.mockResolvedValue(PAGE);
  mockService.usage.mockResolvedValue(USAGE);
  await i18n.changeLanguage('en');
});

describe('Delete this matter', () => {
  it('asks first; "Keep it" changes nothing, "Delete" removes it and goes back to the list', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    mockService.remove.mockResolvedValue({ matterId: 'm1', deleted: true });
    await renderScreen();
    await press('matters-open-m1');
    await press('matters-page-delete');
    expect(alert).toHaveBeenCalledWith('Delete this matter?', 'Its emails and history are removed for good. The meeting and tasks it added stay in your agenda.', expect.any(Array));
    const buttons = alert.mock.calls[0]![2] as { text: string; style?: string; onPress?: () => void }[];
    expect(buttons.map((b) => [b.text, b.style])).toEqual([
      ['Keep it', 'cancel'],
      ['Delete', 'destructive'],
    ]);
    expect(mockService.remove).not.toHaveBeenCalled();
    await act(async () => {
      buttons[1]!.onPress!();
    });
    expect(mockService.remove).toHaveBeenCalledWith('m1');
    expect(Toast.show).toHaveBeenCalledWith({ type: 'success', text1: 'Matter deleted.' });
    // back on the list
    expect(screen.getByTestId('matters-request')).toBeTruthy();
    alert.mockRestore();
  });

  it('a failed delete says why and stays on the page', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    mockService.remove.mockRejectedValue(new AppError('upstream_error', 'x'));
    await renderScreen();
    await press('matters-open-m1');
    await press('matters-page-delete');
    const buttons = alert.mock.calls[0]![2] as { onPress?: () => void }[];
    await act(async () => {
      buttons[1]!.onPress!();
    });
    expect(Toast.show).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
    expect(screen.getByTestId('matters-page-delete')).toBeTruthy();
    alert.mockRestore();
  });

  it('a flagged promise is named on the card', async () => {
    await renderScreen();
    await press('matters-open-m1');
    expect(screen.getByText('Check before sending, it mentions: a promise made for you')).toBeTruthy();
  });
});

describe('the usage meter', () => {
  it('shows this month\u2019s matters and emails; nothing when it cannot be read', async () => {
    await renderScreen();
    expect(screen.getByTestId('matters-usage')).toHaveTextContent('This month: 3 of 10 matters, 12 of 100 emails.');
    expect(screen.queryByTestId('matters-usage-cap')).toBeNull();
  });

  it('says when today\u2019s limit is reached', async () => {
    mockService.usage.mockResolvedValue({ ...USAGE, today: { ...USAGE.today, capReached: true } });
    await renderScreen();
    expect(screen.getByTestId('matters-usage-cap')).toBeTruthy();
    expect(screen.getByText("Today's assistant limit is reached. It works again tomorrow.")).toBeTruthy();
  });

  it('shows nothing when the meter cannot be read', async () => {
    mockService.usage.mockRejectedValue(new AppError('not_configured', 'off'));
    await renderScreen();
    expect(screen.queryByTestId('matters-usage')).toBeNull();
  });

  it('is in Spanish too', async () => {
    await i18n.changeLanguage('es');
    await renderScreen();
    expect(screen.getByTestId('matters-usage')).toHaveTextContent('Este mes: 3 de 10 asuntos, 12 de 100 correos.');
  });
});

describe('the limit reached', () => {
  const limited = (limit?: string) => new AppError('quota_exceeded', 'x', { details: { reason: 'rate_limited', ...(limit ? { limit } : {}) } });

  it('each limit has its own message, in EN and ES', async () => {
    expect(matterErrorKey(limited('emails'))).toBe('matters:errors.limit.emails');
    expect(matterErrorKey(limited('open_matters'))).toBe('matters:errors.limit.open_matters');
    // an unknown or missing limit falls back to the generic quota message
    expect(matterErrorKey(limited('something_new'))).not.toContain('errors.limit');
    expect(matterErrorKey(limited())).not.toContain('errors.limit');
    for (const kind of ['drafts', 'sends', 'matters', 'emails', 'voice', 'spend', 'open_matters']) {
      expect(i18n.t(`matters:errors.limit.${kind}`, { lng: 'en' })).not.toContain('errors.limit');
      expect(i18n.t(`matters:errors.limit.${kind}`, { lng: 'es' })).not.toContain('errors.limit');
    }
  });

  it('the service keeps the limit the server named', () => {
    const mapped = mapMatterError(Object.assign(new Error('x'), { code: 'functions/resource-exhausted', details: { reason: 'rate_limited', limit: 'spend' } }));
    expect(mapped.code).toBe('quota_exceeded');
    expect(mapped.details).toMatchObject({ reason: 'rate_limited', limit: 'spend' });
  });
});

describe('matterService (A4)', () => {
  function setup(answer: (name: string) => unknown) {
    const calls: { name: string; request: unknown }[] = [];
    const transport: MatterTransport = {
      async call(name, request) {
        calls.push({ name, request });
        return answer(name);
      },
    };
    return { calls, service: createMatterService({ getTransport: () => transport, enabled: () => true }) };
  }

  it('remove and usage call their callables and validate the answers', async () => {
    const { calls, service } = setup((name) => (name === CALLABLES.matterDelete ? { matterId: 'm1', deleted: true } : USAGE));
    await expect(service.remove('m1')).resolves.toEqual({ matterId: 'm1', deleted: true });
    await expect(service.usage()).resolves.toEqual(USAGE);
    expect(calls).toEqual([
      { name: CALLABLES.matterDelete, request: { matterId: 'm1' } },
      { name: CALLABLES.matterUsage, request: {} },
    ]);
    await expect(service.remove('bad id!')).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('an answer that does not match the contract is upstream_error', async () => {
    const { service } = setup(() => ({ month: 'nope' }));
    await expect(service.usage()).rejects.toMatchObject({ code: 'upstream_error' });
  });
});

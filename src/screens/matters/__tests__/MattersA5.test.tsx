/**
 * A5: the assistant complete in the app. The consent before first use, "Today" (the morning
 * digest), the settings page, a briefing notification opening its matter and starting the
 * briefing, a first email that did not go out, "Add an email to this matter", and the voice that
 * speaks an answer while it is still being written.
 */
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react-native';
import * as Speech from 'expo-speech';
import { Alert, type AlertButton } from 'react-native';
import { PaperProvider } from 'react-native-paper';
import Toast from 'react-native-toast-message';

import { DEFAULT_MATTER_PREFS, MATTER_CONSENT_VERSION } from '../../../core/aiContract';
import { I18nProvider, i18n } from '../../../i18n';
import { MattersScreen, type MattersScreenProps } from '../MattersScreen';
import { sentenceEnd, useMatterVoice } from '../useMatterVoice';

jest.mock('expo-localization', () => ({
  getLocales: jest.fn(() => [{ languageCode: 'en', languageTag: 'en-US' }]),
  getCalendars: jest.fn(() => [{ timeZone: 'Europe/Madrid', uses24hourClock: false }]),
}));
jest.mock('react-native-toast-message', () => ({ __esModule: true, default: { show: jest.fn() } }));
jest.mock('expo-speech', () => ({ speak: jest.fn(), stop: jest.fn() }));
jest.mock('firebase/functions', () => ({ httpsCallable: jest.fn() }));
jest.mock('../../../config/firebase', () => ({ functions: null, isFirebaseReady: false, auth: null }));
jest.mock('../../assistant/useVoice', () => ({ useVoiceInput: () => ({ status: 'idle', toggle: jest.fn() }) }));
// the phone's time picker: the test answers it the way the native one does
const mockPickers: Record<string, unknown>[] = [];
jest.mock('@react-native-community/datetimepicker', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    mockPickers.push(props);
    return null;
  },
}));

const mockService = {
  listOpen: jest.fn(),
  usage: jest.fn(),
  mailboxStatus: jest.fn(),
  watchList: jest.fn(),
  settings: jest.fn(),
  digest: jest.fn(),
  giveConsent: jest.fn(),
  saveSettings: jest.fn(),
  getPage: jest.fn(),
  confirm: jest.fn(),
  streamBriefing: jest.fn(),
};
const mockRemember = jest.fn();
const mockSchedule = jest.fn();
jest.mock('../../../services/matters', () => ({
  matterService: new Proxy(
    { isEnabled: () => true },
    { get: (target: Record<string, unknown>, key: string) => (key in target ? target[key] : (...args: unknown[]): unknown => (mockService as Record<string, jest.Mock>)[key]!(...args)) },
  ),
  openMailboxSignIn: jest.fn(),
  rememberDigest: (...args: unknown[]): unknown => mockRemember(...args),
  scheduleBriefings: (...args: unknown[]): unknown => mockSchedule(...args),
}));

const CONSENTED = { prefs: DEFAULT_MATTER_PREFS, consent: { version: MATTER_CONSENT_VERSION, at: '2026-11-25T10:00:00.000Z' }, consentVersion: MATTER_CONSENT_VERSION, address: 'assistant@assistant.meetingguard.ai' };
const DIGEST = {
  generatedAt: '2026-11-25T07:00:00.000Z',
  needsYou: 2,
  sections: {
    moved: [{ matterId: 'm1', title: 'Proposal from Carlos', text: 'Email received from Carlos Ruiz.' }],
    needsYou: [{ matterId: 'm1', title: 'Proposal from Carlos', text: '2 cards wait for your decision.' }],
    followUps: [],
    meetings: [{ matterId: 'm1', title: 'Proposal from Carlos', text: 'Meeting: Thu, Nov 26, 10:00 AM.' }],
  },
  spoken: 'Needs you today. Proposal from Carlos: 2 cards wait for your decision.',
  briefings: [{ matterId: 'm1', title: 'Proposal from Carlos', start: '2026-11-26T09:00:00.000Z' }],
  briefingMinutes: 30,
};
const PAGE = {
  matter: { matterId: 'm1', status: 'active', title: 'Proposal from Carlos', updatedAt: '2026-11-25T10:00:00.000Z', pendingApprovals: 0, contacts: ['Carlos Ruiz'], meeting: null },
  approvals: [],
  proposals: [],
  events: [],
  usage: null,
  address: 'm-0123456789abcdef01234567@assistant.meetingguard.ai',
  firstSend: { state: 'failed', draftHash: 'c'.repeat(64) },
};

async function renderScreen(props: MattersScreenProps = {}): Promise<void> {
  await render(
    <I18nProvider>
      <PaperProvider>
        <MattersScreen {...props} />
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
  mockService.listOpen.mockResolvedValue([]);
  mockService.usage.mockResolvedValue(null);
  mockService.mailboxStatus.mockResolvedValue({ available: false, connected: false, address: null });
  mockService.watchList.mockResolvedValue({ available: false, address: null, items: [] });
  mockService.settings.mockResolvedValue(CONSENTED);
  mockService.digest.mockResolvedValue(null);
  mockService.getPage.mockResolvedValue(PAGE);
  await i18n.changeLanguage('en');
});

describe('the consent before first use', () => {
  it('is shown until the owner agrees; "Not now" leaves', async () => {
    const navigation = { goBack: jest.fn() };
    mockService.settings.mockResolvedValue({ ...CONSENTED, consent: null });
    mockService.giveConsent.mockResolvedValue(CONSENTED);
    await renderScreen({ navigation });
    expect(screen.getByText('Before you start')).toBeTruthy();
    expect(screen.queryByTestId('matters-request')).toBeNull();
    await press('matters-consent-later');
    expect(navigation.goBack).toHaveBeenCalled();
    await press('matters-consent-agree');
    expect(mockService.giveConsent).toHaveBeenCalledWith(MATTER_CONSENT_VERSION, 'Europe/Madrid');
    expect(screen.getByTestId('matters-request')).toBeTruthy();
  });

  it('an older consent is asked again, in Spanish too', async () => {
    await i18n.changeLanguage('es');
    mockService.settings.mockResolvedValue({ ...CONSENTED, consentVersion: MATTER_CONSENT_VERSION + 1 });
    await renderScreen();
    expect(screen.getByText('Antes de empezar')).toBeTruthy();
  });
});

describe('Today (the morning digest)', () => {
  it('shows the sections, reads it aloud, and feeds the notifications', async () => {
    mockService.digest.mockResolvedValue(DIGEST);
    await renderScreen();
    expect(screen.getByText('Needs you today')).toBeTruthy();
    expect(screen.getByText('2 cards wait for your decision.')).toBeTruthy();
    // the header says what needs the owner
    expect(screen.getByText('2 things need you')).toBeTruthy();
    expect(screen.getByText('Meetings it arranged')).toBeTruthy();
    expect(screen.queryByTestId('matters-digest-followUps')).toBeNull();
    expect(mockService.digest).toHaveBeenCalledWith('en', 'Europe/Madrid');
    expect(mockRemember).toHaveBeenCalledWith(DIGEST);
    expect(mockSchedule).toHaveBeenCalledWith(DIGEST, expect.objectContaining({ body: 'Your meeting is coming up. Tap to hear the briefing.' }));
    const text = mockSchedule.mock.calls[0]![1] as { title(title: string): string };
    expect(text.title('Proposal from Carlos')).toBe('Briefing: Proposal from Carlos');
    await press('matters-digest-read');
    expect(Speech.speak).toHaveBeenCalledWith(DIGEST.spoken, expect.anything());
    // a line opens its matter
    await press('matters-digest-needsYou-0');
    expect(screen.getByTestId('matters-page')).toBeTruthy();
  });
});

describe('Assistant settings', () => {
  it('opens from the matters screen and saves what was changed', async () => {
    mockService.saveSettings.mockImplementation(async (prefs: unknown) => ({ ...CONSENTED, prefs }));
    await renderScreen();
    await press('matters-settings-open');
    expect(screen.getByText('assistant@assistant.meetingguard.ai')).toBeTruthy();
    // Save shows once something changed
    expect(screen.queryByTestId('matters-settings-save')).toBeNull();
    await press('matters-settings-every-plus');
    expect(screen.getByText('Every 3 days, at most 3 times.')).toBeTruthy();
    await press('matters-settings-day-6');
    await press('matters-settings-length-7');
    await press('matters-settings-briefing-60');
    await act(async () => {
      fireEvent.changeText(screen.getByTestId('matters-settings-signature'), 'Sales, Acme Ltd');
    });
    await press('matters-settings-save');
    expect(mockService.saveSettings).toHaveBeenCalledWith(
      { ...DEFAULT_MATTER_PREFS, followUpEveryDays: 3, workDays: [1, 2, 3, 4, 5, 6], defaultDays: 7, briefingMinutes: 60, signature: 'Sales, Acme Ltd' },
      'Europe/Madrid',
      false,
    );
    expect(Toast.show).toHaveBeenCalledWith({ type: 'success', text1: 'Settings saved.' });
    // saved: nothing left to save
    expect(screen.queryByTestId('matters-settings-save')).toBeNull();
  });

  it('times come from the time picker; hours that end before they start are not saved', async () => {
    await renderScreen();
    await press('matters-settings-open');
    await press('matters-settings-start');
    const picker = mockPickers[mockPickers.length - 1]!;
    await act(async () => {
      (picker.onChange as (event: { type: string }, value?: Date) => void)({ type: 'set' }, new Date(2026, 10, 25, 19, 30));
    });
    expect(screen.getByText('19:30')).toBeTruthy();
    expect(screen.getByTestId('matters-settings-hours-invalid')).toBeTruthy();
    await press('matters-settings-save');
    expect(mockService.saveSettings).not.toHaveBeenCalled();
    expect(Toast.show).toHaveBeenCalledWith({ type: 'error', text1: 'Working hours must end after they start.' });
  });

  it('"also change my running matters" asks first, then saves with it', async () => {
    mockService.settings.mockResolvedValue({ ...CONSENTED, openMatters: 2 });
    mockService.saveSettings.mockImplementation(async (prefs: unknown) => ({ ...CONSENTED, prefs, openMatters: 2, applied: 2 }));
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await renderScreen();
    await press('matters-settings-open');
    expect(screen.getByText('Also change my 2 running matters')).toBeTruthy();
    await press('matters-settings-max-minus');
    await act(async () => {
      fireEvent(screen.getByTestId('matters-settings-apply-open'), 'valueChange', true);
    });
    await press('matters-settings-save');
    expect(alert).toHaveBeenCalledWith('Change your running matters?', expect.stringContaining('your 2 running matters'), expect.anything());
    expect(mockService.saveSettings).not.toHaveBeenCalled();
    const buttons = alert.mock.calls[0]![2] as AlertButton[];
    await act(async () => {
      buttons.find((b) => b.text === 'Save and change')!.onPress!();
    });
    expect(mockService.saveSettings).toHaveBeenCalledWith({ ...DEFAULT_MATTER_PREFS, followUpMaxCount: 2 }, 'Europe/Madrid', true);
    expect(Toast.show).toHaveBeenCalledWith({ type: 'success', text1: 'Settings saved. 2 running matters changed.' });
    alert.mockRestore();
  });

  it('leaving with changes not saved asks first', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await renderScreen();
    await press('matters-settings-open');
    await press('matters-settings-back');
    expect(alert).not.toHaveBeenCalled();
    expect(screen.queryByTestId('matters-settings')).toBeNull();
    await press('matters-settings-open');
    await press('matters-settings-day-6');
    await press('matters-settings-back');
    expect(alert).toHaveBeenCalledWith('Leave without saving?', 'Your changes to the settings will be lost.', expect.anything());
    expect(screen.getByTestId('matters-settings')).toBeTruthy();
    alert.mockRestore();
  });
});

describe('the matter page (A5)', () => {
  it('a briefing notification opens the matter and starts the briefing', async () => {
    mockService.streamBriefing.mockImplementation(async (_input: unknown, onText: (piece: string) => void) => {
      onText('You meet Carlos. ');
      onText('He sent the proposal.');
      return { text: 'You meet Carlos. He sent the proposal.', matterId: 'm1', title: 'Proposal from Carlos' };
    });
    const navigation = { goBack: jest.fn(), setParams: jest.fn() };
    await renderScreen({ route: { params: { matterId: 'm1', brief: true } }, navigation });
    expect(screen.getByTestId('matters-page')).toBeTruthy();
    expect(mockService.streamBriefing).toHaveBeenCalledWith({ language: 'en', matterId: 'm1', timeZone: 'Europe/Madrid' }, expect.any(Function));
    expect(screen.getByText('You meet Carlos. He sent the proposal.')).toBeTruthy();
    expect(Speech.speak).toHaveBeenCalledWith('You meet Carlos.', expect.anything());
    expect(navigation.setParams).toHaveBeenCalledWith({ matterId: undefined, brief: undefined });
  });

  it('a first email that did not go out: try again with its hash; the address to forward to', async () => {
    mockService.confirm.mockResolvedValue({ matterId: 'm1', status: 'active', outcome: 'sent' });
    await renderScreen({ route: { params: { matterId: 'm1' } } });
    expect(screen.getByText('The first email was not sent. You can try again, or cancel the matter.')).toBeTruthy();
    expect(screen.getByText(PAGE.address)).toBeTruthy();
    expect(screen.getByText('Add an email to this matter')).toBeTruthy();
    await press('matters-page-first-retry');
    expect(mockService.confirm).toHaveBeenCalledWith('m1', 'c'.repeat(64));
    expect(mockService.streamBriefing).not.toHaveBeenCalled();
  });
});

describe('the voice says an answer while it is written', () => {
  const handlers = { language: 'en' as const, onTranscript: jest.fn(), onFinal: jest.fn(), onProblem: jest.fn() };

  it('each sentence as soon as it is complete, then the rest', async () => {
    expect(sentenceEnd('Hello there. How')).toBe(12);
    expect(sentenceEnd('No end yet')).toBe(-1);
    const { result } = await renderHook(() => useMatterVoice(handlers));
    let spoken!: ReturnType<typeof result.current.speakStream>;
    await act(async () => {
      spoken = result.current.speakStream();
      spoken.push('Carlos has not replied. A follow');
    });
    expect((Speech.speak as jest.Mock).mock.calls.map((c) => c[0])).toEqual(['Carlos has not replied.']);
    await act(async () => {
      spoken.push('-up goes out Saturday.');
      spoken.finish('Carlos has not replied. A follow-up goes out Saturday.');
    });
    expect((Speech.speak as jest.Mock).mock.calls.map((c) => c[0])).toEqual(['Carlos has not replied.', 'A follow-up goes out Saturday.']);
  });

  it('when code decided another answer, that one is said instead', async () => {
    const { result } = await renderHook(() => useMatterVoice(handlers));
    await act(async () => {
      const spoken = result.current.speakStream();
      spoken.push('Carlos has. ');
      spoken.finish('Which matter do you mean?');
    });
    expect(Speech.stop).toHaveBeenCalled();
    expect((Speech.speak as jest.Mock).mock.calls.at(-1)![0]).toBe('Which matter do you mean?');
  });
});

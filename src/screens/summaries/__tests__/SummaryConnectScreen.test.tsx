/**
 * SummaryConnectScreen: the gate (nothing but a notice unless enabled and allowed), "being set
 * up", Create my private address, Copy / Share / Get a new address (after the confirmation), the
 * mailbox list, the Gmail code cards, the setup tabs and administrator steps, activity, the
 * Microsoft 365 hint, polling only while waiting, and the error messages.
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert, Linking, Share, Text, type AlertButton } from 'react-native';
import { PaperProvider } from 'react-native-paper';
import Toast from 'react-native-toast-message';

import type { SummaryActionResponse, SummaryStatusResponse } from '../../../core/aiContract';
import { AppError } from '../../../core/errors';
import { I18nProvider, i18n } from '../../../i18n';
import { SUMMARIES_DISABLED_STATUS, summaryAppError } from '../../../services/summaries/summaryCore';
import { SummaryConnectScreen } from '../SummaryConnectScreen';

jest.mock('expo-localization', () => ({
  getLocales: jest.fn(() => [{ languageCode: 'en', languageTag: 'en-US' }]),
  getCalendars: jest.fn(() => [{ timeZone: 'UTC', uses24hourClock: false }]),
}));
jest.mock('react-native-toast-message', () => ({ __esModule: true, default: { show: jest.fn() } }));
jest.mock('../../../services/data', () => {
  const { createDefaultPreferences: defaults } = jest.requireActual('../../../core/types');
  return {
    usePreferences: () => ({ preferences: defaults({ language: 'en', timezone: 'UTC' }), isLoaded: true, error: null }),
  };
});

// A fixed clock (the 24 h hint and the Gmail wait are model-tested).
let mockNow = new Date('2026-11-12T12:00:00.000Z');
jest.mock('../../shared/useLiveNow', () => ({ useLiveNow: () => mockNow }));

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual<object>('@react-navigation/native'),
  useNavigation: () => ({ navigate: mockNavigate }),
}));

let mockStatus: SummaryStatusResponse | null = null;
let mockError: AppError | null = null;
const mockRefresh = jest.fn(async () => undefined);
const mockUseSummaryStatus = jest.fn((_options?: { pollMs?: number | null }) => ({
  status: mockStatus,
  available: mockStatus !== null && mockStatus.enabled && mockStatus.allowed,
  error: mockError,
  refresh: mockRefresh,
}));
const mockCreateAddress = jest.fn<Promise<SummaryActionResponse>, []>();
const mockRegenerateAddress = jest.fn<Promise<SummaryActionResponse>, []>();
const mockSetMailboxes = jest.fn<Promise<SummaryActionResponse>, [readonly string[]]>();
const mockDismissGmail = jest.fn<Promise<SummaryActionResponse>, [string]>();
jest.mock('../../../services/summaries', () => ({
  SUMMARY_STATUS_POLL_MS: 8_000,
  useSummaryStatus: (options?: { pollMs?: number | null }) => mockUseSummaryStatus(options),
  summariesService: {
    createAddress: () => mockCreateAddress(),
    regenerateAddress: () => mockRegenerateAddress(),
    setMailboxes: (mailboxes: readonly string[]) => mockSetMailboxes(mailboxes),
    dismissGmail: (gmailAddress: string) => mockDismissGmail(gmailAddress),
  },
}));

const mockCopyText: jest.Mock<boolean, [string]> = jest.fn((_text: string) => true);
jest.mock('../../settings/whatsappConnectModel', () => ({
  copyText: (text: string): boolean => mockCopyText(text) as boolean,
}));

const ADDRESS = 'abcdefghijklmnopqrstuvwxyz@summaries.meetingguard.ai';
const AVAILABLE: SummaryStatusResponse = { ...SUMMARIES_DISABLED_STATUS, enabled: true, allowed: true, ready: true };
const CONNECTED: SummaryStatusResponse = { ...AVAILABLE, address: ADDRESS, mailboxes: ['ana@gmail.com'] };
const RECEIVED: SummaryStatusResponse = { ...CONNECTED, lastReceivedAt: '2026-11-12T09:30:00.000Z' };

function answer(status: SummaryStatusResponse): SummaryActionResponse {
  return { changed: true, status, summary: null };
}

async function renderScreen() {
  await render(
    <I18nProvider>
      <PaperProvider>
        <SummaryConnectScreen />
      </PaperProvider>
    </I18nProvider>,
  );
}

async function press(testID: string) {
  await act(async () => {
    fireEvent.press(screen.getByTestId(testID));
  });
}

function pollCalls(): unknown[] {
  return mockUseSummaryStatus.mock.calls.map(([options]) => options?.pollMs ?? null).filter((value) => value !== null);
}

beforeEach(async () => {
  await i18n.changeLanguage('en');
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.sharedAction });
  mockStatus = CONNECTED;
  mockError = null;
  mockNow = new Date('2026-11-12T12:00:00.000Z');
  mockRefresh.mockClear();
  mockUseSummaryStatus.mockClear();
  mockNavigate.mockClear();
  mockCreateAddress.mockReset();
  mockRegenerateAddress.mockReset();
  mockSetMailboxes.mockReset();
  mockDismissGmail.mockReset();
  mockCopyText.mockClear();
  (Toast.show as jest.Mock).mockClear();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('the gate', () => {
  it('shows a loader, then an error state with Retry when the first ask fails', async () => {
    mockStatus = null;
    await renderScreen();
    expect(screen.getByTestId('summary-connect-loading')).toBeTruthy();

    mockError = new AppError('offline');
    await renderScreen();
    expect(screen.getByTestId('summary-connect-error')).toBeTruthy();
    mockRefresh.mockClear();
    await act(async () => {
      fireEvent.press(screen.getByText('Try again'));
    });
    expect(mockRefresh).toHaveBeenCalled();
  });

  it('shows only the notice while the feature is off or the account is not in the pilot', async () => {
    for (const status of [SUMMARIES_DISABLED_STATUS, { ...CONNECTED, allowed: false }]) {
      mockStatus = status;
      await renderScreen();
      expect(screen.getByTestId('summary-connect-unavailable')).toBeTruthy();
      expect(screen.queryByTestId('summary-connect-product-line')).toBeNull();
      expect(screen.queryByText(ADDRESS)).toBeNull();
    }
    mockStatus = null;
    mockError = summaryAppError('not_enabled');
    await renderScreen();
    expect(screen.getByTestId('summary-connect-unavailable')).toBeTruthy();
  });

  it('says "being set up" while the server cannot hand out addresses', async () => {
    mockStatus = { ...AVAILABLE, ready: false };
    await renderScreen();
    expect(screen.getByText('Meeting Guard AI does not join, record or listen to your meetings.')).toBeTruthy();
    expect(screen.getByTestId('summary-connect-not-ready')).toBeTruthy();
    expect(screen.queryByTestId('summary-connect-create-button')).toBeNull();
    expect(screen.getByTestId('summary-connect-checks')).toBeTruthy();
  });

  it('asks for the status again on open', async () => {
    await renderScreen();
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });
});

describe('the address', () => {
  it('creates the private address', async () => {
    mockStatus = AVAILABLE;
    mockCreateAddress.mockResolvedValue(answer(CONNECTED));
    await renderScreen();
    expect(screen.getByText('Meeting Guard AI does not join, record or listen to your meetings.')).toBeTruthy();
    // No mailbox editing or setup before an address exists (set_mailboxes needs one).
    expect(screen.queryByTestId('summary-connect-mailboxes')).toBeNull();
    await press('summary-connect-create-button');
    expect(mockCreateAddress).toHaveBeenCalledTimes(1);
    expect(Toast.show).toHaveBeenCalledWith(expect.objectContaining({ type: 'success', text1: 'Your private address is ready' }));
  });

  it('shows "being set up" when the create answers not_ready, and asks for the status again', async () => {
    mockStatus = AVAILABLE;
    mockCreateAddress.mockRejectedValue(summaryAppError('not_ready'));
    await renderScreen();
    mockRefresh.mockClear();
    await press('summary-connect-create-button');
    expect(Toast.show).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', text1: 'Summaries by email are still being set up. Check back soon.' }),
    );
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it('copies and shares the address', async () => {
    await renderScreen();
    expect(screen.getByTestId('summary-connect-address-value').props.children).toBe(ADDRESS);
    await press('summary-connect-copy');
    expect(mockCopyText).toHaveBeenCalledWith(ADDRESS);
    expect(screen.getByText('Address copied')).toBeTruthy();

    await press('summary-connect-share');
    expect(Share.share).toHaveBeenCalledWith({ message: `My Meeting Guard AI address for meeting summaries: ${ADDRESS}` });
  });

  it('says so when the clipboard fails', async () => {
    mockCopyText.mockReturnValueOnce(false);
    await renderScreen();
    await press('summary-connect-copy');
    expect(Toast.show).toHaveBeenCalledWith(expect.objectContaining({ type: 'error', text1: expect.stringContaining('Could not copy') }));
  });

  it('gets a new address only after the confirmation', async () => {
    mockRegenerateAddress.mockResolvedValue(answer({ ...CONNECTED, address: 'bbbbbbbbbbbbbbbbbbbbbbbbbb@summaries.meetingguard.ai' }));
    await renderScreen();
    await press('summary-connect-regenerate');
    expect(mockRegenerateAddress).not.toHaveBeenCalled();
    const [title, body, buttons] = (Alert.alert as jest.Mock).mock.calls[0] as [string, string, AlertButton[]];
    expect(title).toBe('Get a new address?');
    expect(body).toContain('stops working at once');
    // Section 14: "not stored by Meeting Guard AI", never "dropped" (Postmark still holds it).
    expect(body).toContain('Meeting Guard AI no longer stores mail sent to it');
    expect(body).not.toContain('dropped');
    expect(buttons.map((button) => button.style)).toEqual(['cancel', 'destructive']);
    await act(async () => {
      buttons[1]?.onPress?.();
    });
    expect(mockRegenerateAddress).toHaveBeenCalledTimes(1);
    expect(Toast.show).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'success', text1: 'Your new address is ready. Update your forwarding rule.' }),
    );
  });

  it('explains a rate-limited new address', async () => {
    mockRegenerateAddress.mockRejectedValue(summaryAppError('rate_limited'));
    await renderScreen();
    await press('summary-connect-regenerate');
    const buttons = (Alert.alert as jest.Mock).mock.calls[0]?.[2] as AlertButton[];
    await act(async () => {
      buttons[1]?.onPress?.();
    });
    expect(Toast.show).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', text1: 'You asked for too many new addresses today. Try again tomorrow.' }),
    );
  });

  it('suggests a new address when today\'s refusals are capped', async () => {
    mockStatus = { ...RECEIVED, refusedToday: { day: '2026-11-12', count: 40, capped: true } };
    await renderScreen();
    expect(screen.getByTestId('summary-connect-capped')).toBeTruthy();
    await press('summary-connect-capped-action');
    expect(Alert.alert).toHaveBeenCalledWith('Get a new address?', expect.any(String), expect.any(Array));
  });
});

describe('where your summaries arrive', () => {
  it('adds a mailbox and saves the list', async () => {
    mockSetMailboxes.mockResolvedValue(answer({ ...CONNECTED, mailboxes: ['ana@gmail.com', 'ana@company.com'] }));
    await renderScreen();
    expect(screen.getAllByTestId('summary-connect-mailbox')).toHaveLength(1);
    expect(screen.queryByTestId('summary-connect-mailboxes-save')).toBeNull();

    await act(async () => {
      fireEvent.changeText(screen.getByTestId('summary-connect-mailbox-input'), ' Ana@Company.com ');
    });
    await press('summary-connect-mailbox-add');
    expect(screen.getAllByTestId('summary-connect-mailbox')).toHaveLength(2);
    expect(screen.getByTestId('summary-connect-mailboxes-unsaved')).toBeTruthy();
    expect(mockSetMailboxes).not.toHaveBeenCalled();

    await press('summary-connect-mailboxes-save');
    expect(mockSetMailboxes).toHaveBeenCalledWith(['ana@gmail.com', 'ana@company.com']);
    expect(Toast.show).toHaveBeenCalledWith(expect.objectContaining({ type: 'success', text1: 'Mailboxes saved' }));
  });

  it('refuses an invalid address, a duplicate and the private address before anything is sent', async () => {
    await renderScreen();
    const input = screen.getByTestId('summary-connect-mailbox-input');
    for (const [typed, message] of [
      ['Ana <ana@company.com>', 'Enter one email address, like name@company.com.'],
      ['ANA@gmail.com', 'This mailbox is already on the list.'],
      [ADDRESS, 'Your private address cannot be one of your mailboxes. Enter the mailbox your notetaker sends its summaries to.'],
    ] as const) {
      await act(async () => {
        fireEvent.changeText(input, typed);
      });
      await press('summary-connect-mailbox-add');
      expect(screen.getByTestId('summary-connect-mailbox-problem').props.children).toBe(message);
    }
    await press('summary-connect-mailboxes-save');
    expect(mockSetMailboxes).not.toHaveBeenCalled();
  });

  it('removes a mailbox, and Cancel puts the saved list back', async () => {
    mockSetMailboxes.mockResolvedValue(answer({ ...CONNECTED, mailboxes: [] }));
    await renderScreen();
    await press('summary-connect-mailbox-remove-ana@gmail.com');
    expect(screen.getByTestId('summary-connect-mailboxes-empty')).toBeTruthy();
    await press('summary-connect-mailboxes-cancel');
    expect(screen.getAllByTestId('summary-connect-mailbox')).toHaveLength(1);

    await press('summary-connect-mailbox-remove-ana@gmail.com');
    await press('summary-connect-mailboxes-save');
    expect(mockSetMailboxes).toHaveBeenCalledWith([]);
  });

  it('stops offering Add at the limit', async () => {
    mockStatus = { ...CONNECTED, mailboxes: ['a@x.com', 'b@x.com', 'c@x.com', 'd@x.com', 'e@x.com'] };
    await renderScreen();
    expect(screen.getByText('You can list up to 5 mailboxes.')).toBeTruthy();
    expect(screen.queryByTestId('summary-connect-mailbox-input')).toBeNull();
  });
});

describe('Gmail confirmation codes', () => {
  it('shows the code of a listed mailbox with Copy, Open and Dismiss', async () => {
    mockStatus = {
      ...CONNECTED,
      gmailRequests: [{ gmailAddress: 'ana@gmail.com', code: '123456789', receivedAt: '2026-11-12T11:58:00.000Z' }],
    };
    mockDismissGmail.mockResolvedValue(answer(CONNECTED));
    await renderScreen();
    expect(screen.getByTestId('summary-connect-gmail-code').props.children).toBe('123456789');
    await press('summary-connect-gmail-copy');
    expect(mockCopyText).toHaveBeenCalledWith('123456789');
    expect(screen.getByText('Code copied')).toBeTruthy();
    await press('summary-connect-gmail-open');
    expect(Linking.openURL).toHaveBeenCalledWith('https://mail.google.com/mail/u/0/#settings/fwdandpop');
    await press('summary-connect-gmail-dismiss');
    expect(mockDismissGmail).toHaveBeenCalledWith('ana@gmail.com');
  });

  it('never shows the code of someone else\'s request, only "ignore it" and Dismiss', async () => {
    mockStatus = {
      ...CONNECTED,
      gmailRequests: [{ gmailAddress: 'stranger@gmail.com', code: '987654321', receivedAt: '2026-11-12T11:58:00.000Z' }],
    };
    mockDismissGmail.mockResolvedValue(answer(CONNECTED));
    await renderScreen();
    expect(screen.queryByTestId('summary-connect-gmail-code')).toBeNull();
    expect(screen.queryByText('987654321')).toBeNull();
    expect(screen.getByText('stranger@gmail.com is not one of your mailboxes. Someone else asked; ignore it.')).toBeTruthy();
    await press('summary-connect-gmail-other-dismiss');
    expect(mockDismissGmail).toHaveBeenCalledWith('stranger@gmail.com');
  });
});

describe('setup', () => {
  it('lists the Gmail steps for a Gmail mailbox and opens the Gmail pages', async () => {
    await renderScreen();
    expect(screen.getByTestId('summary-connect-step-gmail-5')).toBeTruthy();
    await press('summary-connect-link-openFilters');
    expect(Linking.openURL).toHaveBeenCalledWith('https://mail.google.com/mail/u/0/#settings/filters');
  });

  it('switches to the Outlook tab and shares the administrator steps', async () => {
    mockStatus = { ...CONNECTED, mailboxes: ['ana@company.com'] };
    await renderScreen();
    await press('summary-connect-tab-outlook');
    expect(screen.getByTestId('summary-connect-step-outlook-3')).toBeTruthy();
    expect(screen.queryByTestId('summary-connect-step-gmail-1')).toBeNull();
    await press('summary-connect-link-openRules');
    expect(Linking.openURL).toHaveBeenCalledWith('https://outlook.office.com/mail/options/mail/rules');

    await press('summary-connect-admin-share');
    const [content] = (Share.share as jest.Mock).mock.calls[0] as [{ message: string; title: string }];
    expect(content.title).toBe('Steps for your administrator');
    expect(content.message).toContain('A mail rule on ana@company.com redirects only');
    expect(content.message).toContain(ADDRESS);
    expect(content.message).toContain('https://security.microsoft.com/antispam');
  });

  it('has no administrator steps on the Other tab', async () => {
    await renderScreen();
    await press('summary-connect-tab-other');
    expect(screen.getByTestId('summary-connect-step-other-3')).toBeTruthy();
    expect(screen.queryByTestId('summary-connect-admin')).toBeNull();
  });
});

describe('activity', () => {
  it('waits for the first summary and polls only then', async () => {
    await renderScreen();
    expect(screen.getByTestId('summary-connect-nothing-yet')).toBeTruthy();
    expect(pollCalls()).toContain(8_000);

    mockUseSummaryStatus.mockClear();
    mockStatus = RECEIVED;
    await renderScreen();
    expect(screen.getByTestId('summary-connect-last-received').props.children).toBe('Last summary received Nov 12, 2026, 9:30 AM');
    expect(pollCalls()).toEqual([]);
  });

  it('polls for a Gmail code after the user opened the Gmail forwarding page', async () => {
    mockStatus = RECEIVED;
    await renderScreen();
    expect(pollCalls()).toEqual([]);
    await press('summary-connect-link-openForwarding');
    expect(pollCalls()).toContain(8_000);
  });

  it('explains the last refusal, with what to do, and counts today\'s', async () => {
    mockStatus = {
      ...RECEIVED,
      lastRefused: { reason: 'could_not_verify_after_forwarding', at: '2026-11-12T10:00:00.000Z', senderDomain: 'notes.example.com' },
      refusedToday: { day: '2026-11-12', count: 2, capped: false },
    };
    await renderScreen();
    expect(screen.getByText('Last refused Nov 12, 2026, 10:00 AM: Signature lost on the way')).toBeTruthy();
    expect(screen.getByText('From notes.example.com')).toBeTruthy();
    expect(screen.getByText(/Use a Redirect rule instead of Forward/)).toBeTruthy();
    expect(screen.getByTestId('summary-connect-refused-today').props.children).toBe('2 emails refused today');
    expect(screen.queryByTestId('summary-connect-capped')).toBeNull();
  });

  it('names an unverified sender as unknown', async () => {
    mockStatus = { ...RECEIVED, lastRefused: { reason: 'not_from_your_notetaker', at: '2026-11-12T10:00:00.000Z', senderDomain: null } };
    await renderScreen();
    expect(screen.getByText('From an unknown sender')).toBeTruthy();
  });

  it('opens the summary inbox', async () => {
    mockStatus = { ...RECEIVED, inboxCount: 2 };
    await renderScreen();
    expect(screen.getByTestId('summary-connect-inbox-count').props.children).toBe('2 waiting for a meeting');
    await press('summary-connect-open-inbox');
    expect(mockNavigate).toHaveBeenCalledWith('SummaryInbox');
  });

  it('shows the Microsoft 365 hint after 24 hours in use with nothing received', async () => {
    mockStatus = {
      ...CONNECTED,
      mailboxes: ['ana@company.com'],
      lastRefused: { reason: 'not_from_your_notetaker', at: '2026-11-11T08:00:00.000Z', senderDomain: null },
    };
    await renderScreen();
    expect(screen.getByTestId('summary-connect-microsoft-hint')).toBeTruthy();
    await press('summary-connect-microsoft-hint-action');
    const [content] = (Share.share as jest.Mock).mock.calls[0] as [{ message: string }];
    expect(content.message).toContain('Microsoft 365 blocks automatic forwarding');

    mockStatus = { ...mockStatus, lastRefused: { reason: 'not_from_your_notetaker', at: '2026-11-12T08:00:00.000Z', senderDomain: null } };
    await renderScreen();
    expect(screen.queryByTestId('summary-connect-microsoft-hint')).toBeNull();
  });

  it('keeps the last answer on screen with a notice when a later ask failed', async () => {
    mockError = new AppError('offline');
    await renderScreen();
    expect(screen.getByTestId('summary-connect-address-value')).toBeTruthy();
    expect(screen.getByTestId('summary-connect-stale')).toBeTruthy();
  });
});

describe('what we check and privacy', () => {
  it('states the checks and the privacy wording with the provider retention', async () => {
    await renderScreen();
    expect(screen.getByText(/carries your notetaker's own digital signature/)).toBeTruthy();
    // Never claim that only signed summaries get in (section 14): hand forwards and unbound or
    // old vendor summaries wait in the inbox for an OK.
    expect(screen.getByText(/or one you forward by hand from a listed mailbox, waits in your summary inbox for your OK/)).toBeTruthy();
    expect(screen.getByText(/Anything else is refused, and its content is not stored by Meeting Guard AI/)).toBeTruthy();
    expect(screen.getByText(/A real summary sent straight to your private address waits in your inbox for your OK/)).toBeTruthy();
    expect(screen.getByText(/receives each email first and keeps it for 45 days/)).toBeTruthy();
    expect(screen.getByText(/This is not end-to-end encryption/)).toBeTruthy();
  });

  it('renders in Spanish', async () => {
    await i18n.changeLanguage('es');
    await renderScreen();
    expect(screen.getByText('Meeting Guard AI no se une a tus reuniones, no las graba y no las escucha.')).toBeTruthy();
    expect(screen.getByText('Tu dirección privada')).toBeTruthy();
    expect(screen.getByText('Dónde llegan tus minutas')).toBeTruthy();
    expect(screen.getByText('Qué comprobamos')).toBeTruthy();
    // The privacy card names what is encrypted (T5), and the refused caveat shows in Spanish too.
    expect(screen.getByText(/^Google Cloud cifra tus minutas en tránsito y en reposo\./)).toBeTruthy();
    expect(screen.getByText(/espera en tu bandeja de minutas hasta que des tu visto bueno/)).toBeTruthy();
  });
});

describe('M11 slot', () => {
  it('renders nothing by default and the footer when given', async () => {
    await render(
      <I18nProvider>
        <PaperProvider>
          <SummaryConnectScreen footer={null} />
        </PaperProvider>
      </I18nProvider>,
    );
    expect(screen.queryByTestId('m11-footer')).toBeNull();
    await render(
      <I18nProvider>
        <PaperProvider>
          <SummaryConnectScreen footer={<Text testID="m11-footer">later</Text>} />
        </PaperProvider>
      </I18nProvider>,
    );
    expect(screen.getByTestId('m11-footer')).toBeTruthy();
  });
});

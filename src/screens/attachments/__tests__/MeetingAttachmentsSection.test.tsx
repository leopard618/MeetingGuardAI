import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { PaperProvider } from 'react-native-paper';
import Toast from 'react-native-toast-message';

import { AppError } from '../../../core/errors';
import { I18nProvider, i18n } from '../../../i18n';
import type { AttachmentAddResult, AttachmentRecord, UseMeetingAttachmentsResult } from '../../../services/attachments';
import { addResultMessage } from '../attachmentMessages';
import { MeetingAttachmentsSection } from '../MeetingAttachmentsSection';

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

let mockHook: UseMeetingAttachmentsResult;
const mockUseMeetingAttachments = jest.fn((_meetingId: string) => mockHook);
jest.mock('../../../services/attachments', () => ({
  ...jest.requireActual('../../../services/attachments/fileTypes'),
  useMeetingAttachments: (meetingId: string) => mockUseMeetingAttachments(meetingId),
}));

function record(overrides: Partial<AttachmentRecord> = {}): AttachmentRecord {
  return {
    id: 'a1',
    name: 'Agenda.pdf',
    category: 'documents',
    mimeType: 'application/pdf',
    size: 1536,
    uri: 'file:///docs/attachments/u1/a1_Agenda.pdf',
    meetingId: 'm1',
    createdAt: '2026-09-20T10:00:00.000Z',
    localOnly: true,
    ...overrides,
  };
}

function hook(overrides: Partial<UseMeetingAttachmentsResult> = {}): UseMeetingAttachmentsResult {
  return {
    attachments: [],
    isLoading: false,
    error: null,
    busy: false,
    reload: jest.fn(),
    add: jest.fn(async () => ({ cancelled: true, added: [], failures: [] })),
    remove: jest.fn(async () => undefined),
    open: jest.fn(async () => undefined),
    ...overrides,
  };
}

async function renderSection() {
  await render(
    <I18nProvider>
      <PaperProvider>
        <MeetingAttachmentsSection meetingId="m1" />
      </PaperProvider>
    </I18nProvider>,
  );
}

beforeEach(async () => {
  await i18n.changeLanguage('en');
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  (Toast.show as jest.Mock).mockClear();
  mockHook = hook();
});

afterEach(() => {
  jest.restoreAllMocks();
});

it('says the files stay on this device and shows an empty list', async () => {
  await renderSection();
  expect(mockUseMeetingAttachments).toHaveBeenCalledWith('m1');
  expect(screen.getByTestId('attachments-local-only').props.children).toContain('Stored on this device only');
  expect(screen.getByTestId('attachments-empty')).toBeTruthy();
});

it('lists attachments with size and date, opens and removes them', async () => {
  mockHook = hook({ attachments: [record()] });
  await renderSection();
  expect(screen.getByText('Agenda.pdf')).toBeTruthy();
  expect(screen.getByText('1.5 KB · added Sep 20, 2026')).toBeTruthy();

  await fireEvent.press(screen.getByLabelText('Open Agenda.pdf'));
  expect(mockHook.open).toHaveBeenCalledWith(record());

  await fireEvent.press(screen.getByTestId('attachment-remove-a1'));
  expect(Alert.alert).toHaveBeenCalledWith('Remove this attachment?', '"Agenda.pdf" will be deleted from this device.', expect.any(Array));
  const buttons = (Alert.alert as jest.Mock).mock.calls[0]?.[2] as { style?: string; onPress?: () => void }[];
  await act(async () => {
    buttons.find((button) => button.style === 'destructive')?.onPress?.();
  });
  expect(mockHook.remove).toHaveBeenCalledWith('a1');
  expect(Toast.show).toHaveBeenCalledWith({ type: 'success', text1: 'Attachment removed' });
});

it('explains a file that is gone or cannot be opened', async () => {
  mockHook = hook({ attachments: [record()], open: jest.fn(async () => Promise.reject(new AppError('not_found'))) });
  await renderSection();
  await fireEvent.press(screen.getByLabelText('Open Agenda.pdf'));
  await act(async () => undefined);
  expect(Toast.show).toHaveBeenCalledWith({ type: 'error', text1: 'This file is no longer on this device.' });
});

it('adds files and reports partial failures', async () => {
  const result: AttachmentAddResult = {
    cancelled: false,
    added: [record()],
    failures: [{ name: 'setup.exe', reason: 'unsupported_type', code: 'unsupported' }],
  };
  mockHook = hook({ add: jest.fn(async () => result) });
  await renderSection();
  await fireEvent.press(screen.getByTestId('attachments-add-file'));
  expect(mockHook.add).toHaveBeenCalledWith('document');
  expect(Toast.show).toHaveBeenCalledWith({
    type: 'info',
    text1: "1 file added · 1 file couldn't be added",
    text2: "\"setup.exe\" isn't a supported file type.",
  });
});

it('explains a refused camera permission', async () => {
  mockHook = hook({ add: jest.fn(async () => Promise.reject(new AppError('permission_denied'))) });
  await renderSection();
  await fireEvent.press(screen.getByTestId('attachments-take-photo'));
  expect(mockHook.add).toHaveBeenCalledWith('camera');
  expect(Toast.show).toHaveBeenCalledWith({ type: 'error', text1: 'Camera access is off. You can allow it in your device settings.' });
});

it('shows loading, busy and read-error states', async () => {
  mockHook = hook({ isLoading: true, busy: true });
  await renderSection();
  expect(screen.getByText('Loading attachments...')).toBeTruthy();
  expect(screen.getByTestId('attachments-busy')).toBeTruthy();

  mockHook = hook({ error: new AppError('unknown') });
  await renderSection();
  expect(screen.getByText("We couldn't read the attachments on this device.")).toBeTruthy();
  await fireEvent.press(screen.getByTestId('attachments-retry'));
  expect(mockHook.reload).toHaveBeenCalled();
});

describe('addResultMessage', () => {
  const t = (key: string, options?: Record<string, unknown>) => i18n.t(key, options ?? {});

  it('is silent for a cancelled picker and says how many files were added', () => {
    expect(addResultMessage({ cancelled: true, added: [], failures: [] }, t)).toBeNull();
    expect(addResultMessage({ cancelled: false, added: [record(), record({ id: 'a2' })], failures: [] }, t)).toEqual({
      type: 'success',
      text1: '2 files added',
    });
  });

  it('is an error when nothing could be added', () => {
    expect(addResultMessage({ cancelled: false, added: [], failures: [{ name: 'big.mov', reason: 'too_large', code: 'invalid_input' }] }, t)).toEqual({
      type: 'error',
      text1: "1 file couldn't be added",
      text2: '"big.mov" is larger than 50 MB.',
    });
  });
});

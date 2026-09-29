import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { Alert, Text } from 'react-native';
import { PaperProvider } from 'react-native-paper';
import Toast from 'react-native-toast-message';

import type { RootStackParamList } from '../../../core/contracts';
import { AppError } from '../../../core/errors';
import { buildMeeting, buildNote, type Meeting, type Note, type NoteInput } from '../../../core/types';
import { I18nProvider, i18n } from '../../../i18n';
import { NotesScreen } from '../NotesScreen';

jest.mock('expo-localization', () => ({
  getLocales: jest.fn(() => [{ languageCode: 'en', languageTag: 'en-US' }]),
  getCalendars: jest.fn(() => [{ timeZone: 'UTC', uses24hourClock: false }]),
}));
jest.mock('react-native-toast-message', () => ({ __esModule: true, default: { show: jest.fn() } }));

const mockCreate = jest.fn();
const mockUpdate = jest.fn();
const mockRemove = jest.fn();
let mockNotes: Note[] = [];
let mockNotesLoading = false;
let mockNotesError: AppError | null = null;
let mockMeetings: Meeting[] = [];
let mockOnline = true;

jest.mock('../../../services/data', () => {
  const { createDefaultPreferences: defaults } = jest.requireActual('../../../core/types');
  return {
    useNotes: () => ({
      notes: mockNotes,
      isLoading: mockNotesLoading,
      error: mockNotesError,
      create: (...args: unknown[]) => mockCreate(...args),
      update: (...args: unknown[]) => mockUpdate(...args),
      remove: (...args: unknown[]) => mockRemove(...args),
    }),
    useMeetings: () => ({ meetings: mockMeetings, isLoading: false, error: null, refresh: jest.fn() }),
    useSyncState: () => ({ online: mockOnline, pendingWrites: 0, lastSyncedAt: null }),
    usePreferences: () => ({ preferences: defaults({ language: 'en', timezone: 'UTC' }), isLoaded: true, error: null }),
  };
});

function note(id: string, input: NoteInput, updatedAt = '2026-09-20T10:00:00.000Z'): Note {
  return { ...buildNote(input, { id, userId: 'u1', now: updatedAt }) };
}

function meeting(id: string, title: string, startAt: string): Meeting {
  return buildMeeting(
    { title, startAt, timezone: 'UTC', durationMinutes: 30, source: 'manual' },
    { id, userId: 'u1', now: '2026-09-01T00:00:00.000Z', defaultTimezone: 'UTC', defaultLanguage: 'en' },
  );
}

const Stack = createStackNavigator<RootStackParamList>();

function MeetingDetailsStub({ route }: { route: { params?: { meetingId?: string } } }) {
  return <Text testID="meeting-details-stub">{route.params?.meetingId}</Text>;
}

async function renderNotes() {
  await render(
    <I18nProvider>
      <PaperProvider>
        <NavigationContainer>
          <Stack.Navigator screenOptions={{ headerShown: false }}>
            <Stack.Screen name="Notes" component={NotesScreen} />
            <Stack.Screen name="MeetingDetails" component={MeetingDetailsStub as never} />
          </Stack.Navigator>
        </NavigationContainer>
      </PaperProvider>
    </I18nProvider>,
  );
}

function lastAlertButtons(): { text?: string; style?: string; onPress?: () => void }[] {
  const calls = (Alert.alert as jest.Mock).mock.calls;
  return (calls[calls.length - 1]?.[2] ?? []) as { text?: string; style?: string; onPress?: () => void }[];
}

beforeEach(async () => {
  await i18n.changeLanguage('en');
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  (Toast.show as jest.Mock).mockClear();
  mockCreate.mockReset().mockImplementation(async (input: NoteInput) => note('new', input));
  mockUpdate.mockReset().mockImplementation(async (id: string) => mockNotes.find((item) => item.id === id));
  mockRemove.mockReset().mockResolvedValue(undefined);
  mockNotesLoading = false;
  mockNotesError = null;
  mockOnline = true;
  mockMeetings = [meeting('m1', 'Budget review', '2026-10-06T15:00:00.000Z'), meeting('m2', 'Design sync', '2026-10-07T09:00:00.000Z')];
  mockNotes = [
    note('n1', { title: 'Budget questions', content: 'Ask about Q3 travel costs', category: 'work', meetingId: 'm1', pinned: true }),
    note('n2', { title: 'App ideas', content: 'Habit tracker', category: 'ideas' }),
  ];
});

afterEach(() => {
  jest.restoreAllMocks();
});

it('shows the notes with their category, pin and linked meeting (no sample data)', async () => {
  await renderNotes();
  expect(screen.getByText('Budget questions')).toBeTruthy();
  expect(screen.getByText('App ideas')).toBeTruthy();
  expect(screen.getByText('2 notes')).toBeTruthy();
  expect(screen.getByLabelText('Pinned')).toBeTruthy();
  const card = within(screen.getByTestId('note-card-n1'));
  expect(card.getByText('Work')).toBeTruthy();
  expect(card.getByText('Budget review')).toBeTruthy();
  expect(screen.getByText('All (2)')).toBeTruthy();
  expect(screen.getByText('Ideas (1)')).toBeTruthy();
  expect(screen.queryByText('Shopping List')).toBeNull();
});

it('shows an empty state that starts the first note', async () => {
  mockNotes = [];
  await renderNotes();
  expect(screen.getByTestId('notes-empty')).toBeTruthy();
  await fireEvent.press(screen.getByText('Write your first note'));
  expect(screen.getByTestId('note-editor')).toBeTruthy();
  expect(within(screen.getByTestId('note-editor')).getByText('New note')).toBeTruthy();
});

it('shows a loading state', async () => {
  mockNotes = [];
  mockNotesLoading = true;
  await renderNotes();
  expect(screen.getByTestId('notes-loading')).toBeTruthy();
});

it('shows why the notes could not be loaded', async () => {
  mockNotes = [];
  mockNotesError = new AppError('permission_denied');
  await renderNotes();
  expect(screen.getByText("We couldn't load your notes")).toBeTruthy();
  expect(screen.getByText("You don't have permission to do that.")).toBeTruthy();
});

it('says when changes are only on this device', async () => {
  mockOnline = false;
  await renderNotes();
  expect(screen.getByTestId('notes-offline')).toBeTruthy();
});

it('searches (also by the linked meeting) and filters by category', async () => {
  await renderNotes();
  await fireEvent.changeText(screen.getByTestId('notes-search'), 'budget review');
  expect(screen.getByText('Budget questions')).toBeTruthy();
  expect(screen.queryByText('App ideas')).toBeNull();

  await fireEvent.changeText(screen.getByTestId('notes-search'), 'nothing like this');
  expect(screen.getByTestId('notes-no-matches')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('notes-clear-filters'));
  expect(screen.getByText('App ideas')).toBeTruthy();

  await fireEvent.press(screen.getByTestId('notes-filter-ideas'));
  expect(screen.getByText('App ideas')).toBeTruthy();
  expect(screen.queryByText('Budget questions')).toBeNull();
});

it('creates a note with a category and a linked meeting after validating the title', async () => {
  await renderNotes();
  await fireEvent.press(screen.getByTestId('notes-add'));
  await fireEvent.press(screen.getByTestId('note-editor-save'));
  expect(screen.getByText('Add a title for the note.')).toBeTruthy();
  expect(mockCreate).not.toHaveBeenCalled();

  await fireEvent.changeText(screen.getByTestId('note-title-input'), '  Agenda  ');
  await fireEvent.changeText(screen.getByTestId('note-content-input'), 'Review the Q3 numbers');
  await fireEvent.press(screen.getByTestId('note-category-work'));
  await fireEvent.press(screen.getByTestId('note-link-meeting'));
  expect(screen.getByText('Link a meeting')).toBeTruthy();
  expect(screen.getByText('Upcoming')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('picker-meeting-m2'));
  expect(screen.getByTestId('note-linked-meeting').props.children).toBe('Design sync');

  await fireEvent.press(screen.getByTestId('note-editor-save'));
  expect(mockCreate).toHaveBeenCalledWith({ title: 'Agenda', content: 'Review the Q3 numbers', category: 'work', meetingId: 'm2', pinned: false });
  expect(screen.queryByTestId('note-editor')).toBeNull();
  expect(Toast.show).toHaveBeenCalledWith({ type: 'success', text1: 'Note saved' });
});

it('edits only the changed fields and can remove the meeting link', async () => {
  await renderNotes();
  await fireEvent.press(screen.getByTestId('note-open-n1'));
  expect(screen.getByText('Edit note')).toBeTruthy();
  expect(screen.getByTestId('note-title-input').props.value).toBe('Budget questions');
  await fireEvent.changeText(screen.getByTestId('note-title-input'), 'Budget questions for Ana');
  await fireEvent.press(screen.getByTestId('note-unlink-meeting'));
  await fireEvent.press(screen.getByTestId('note-editor-save'));
  expect(mockUpdate).toHaveBeenCalledWith('n1', { title: 'Budget questions for Ana', meetingId: null });
});

it('keeps the editor open and explains a failed save', async () => {
  mockCreate.mockRejectedValue(new AppError('unauthenticated'));
  await renderNotes();
  await fireEvent.press(screen.getByTestId('notes-add'));
  await fireEvent.changeText(screen.getByTestId('note-title-input'), 'Draft');
  await fireEvent.press(screen.getByTestId('note-editor-save'));
  expect(screen.getByTestId('note-editor')).toBeTruthy();
  // Inside the editor: a toast would render under the editor's Modal.
  expect(screen.getByTestId('note-editor-error').props.children).toBe('Your session has expired. Please sign in again.');
  expect(Toast.show).not.toHaveBeenCalled();
});

it('asks before discarding unsaved changes', async () => {
  await renderNotes();
  await fireEvent.press(screen.getByTestId('notes-add'));
  await fireEvent.changeText(screen.getByTestId('note-title-input'), 'Half-written');
  await fireEvent.press(screen.getByTestId('note-editor-close'));
  expect(Alert.alert).toHaveBeenCalledWith('Discard your changes?', expect.any(String), expect.any(Array));
  expect(screen.getByTestId('note-editor')).toBeTruthy();
  await act(async () => {
    lastAlertButtons()
      .find((button) => button.style === 'destructive')
      ?.onPress?.();
  });
  expect(screen.queryByTestId('note-editor')).toBeNull();
});

it('deletes a note after confirmation and pins / unpins', async () => {
  await renderNotes();
  await fireEvent.press(screen.getByTestId('note-delete-n2'));
  expect(Alert.alert).toHaveBeenCalledWith('Delete “App ideas”?', expect.stringContaining('all your devices'), expect.any(Array));
  await act(async () => {
    lastAlertButtons()
      .find((button) => button.style === 'destructive')
      ?.onPress?.();
  });
  expect(mockRemove).toHaveBeenCalledWith('n2');
  expect(Toast.show).toHaveBeenCalledWith({ type: 'success', text1: 'Note deleted' });

  await fireEvent.press(screen.getByTestId('note-pin-n2'));
  expect(mockUpdate).toHaveBeenCalledWith('n2', { pinned: true });
  await fireEvent.press(screen.getByTestId('note-pin-n1'));
  expect(mockUpdate).toHaveBeenCalledWith('n1', { pinned: false });
});

it('opens the linked meeting', async () => {
  await renderNotes();
  await fireEvent.press(screen.getByTestId('note-meeting-n1'));
  expect((await screen.findByTestId('meeting-details-stub')).props.children).toBe('m1');
});

it('marks a link to a meeting that no longer exists', async () => {
  mockMeetings = [];
  await renderNotes();
  expect(screen.getByText('The linked meeting is no longer available')).toBeTruthy();
});

it('renders in Spanish', async () => {
  await i18n.changeLanguage('es');
  await renderNotes();
  expect(screen.getByText('Todas (2)')).toBeTruthy();
  expect(screen.getByText('Trabajo')).toBeTruthy();
  expect(screen.getByText('Nueva nota')).toBeTruthy();
});

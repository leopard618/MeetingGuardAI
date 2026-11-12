/**
 * ReminderDefaultPicker (M11, docs/v2/M11-DESIGN.md section 3.2 point 3): the choices report
 * themselves, and "Pick a date and time" on Android opens a date dialog, then a time dialog, and
 * reports the device wall clock; a dismissed dialog cancels. (The screen test covers iOS, the
 * jest-expo default.)
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Platform } from 'react-native';
import { PaperProvider } from 'react-native-paper';

import { ReminderDefaultPicker } from '../ReminderDefaultPicker';
import type { ReminderDefault } from '../commitmentEditModel';

const mockPickerProps: Record<string, unknown>[] = [];
jest.mock('@react-native-community/datetimepicker', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    mockPickerProps.push(props);
    return null;
  },
}));

type PickerChange = (event: { type: string }, value?: Date) => void;

function lastPicker(): Record<string, unknown> | undefined {
  return mockPickerProps[mockPickerProps.length - 1];
}

async function renderPicker(value: ReminderDefault, onChange: (next: ReminderDefault) => void) {
  await render(
    <PaperProvider>
      <ReminderDefaultPicker
        title="Reminder for items without a date"
        hint="Your choice. The summary gives no date."
        options={[
          { kind: 'tomorrow', label: 'Tomorrow at 9:00 AM' },
          { kind: 'dayAfter', label: 'The day after tomorrow at 9:00 AM' },
          { kind: 'nextMonday', label: 'Next Monday at 9:00 AM' },
          { kind: 'none', label: 'No reminder' },
        ]}
        pickLabel="Pick a date and time"
        value={value}
        onChange={onChange}
        notice="8 reminders tomorrow at 9:00 AM"
        noticeHint="Reminders set for the same time arrive together."
        doneLabel="Done"
        cancelLabel="Cancel"
        now={new Date(2026, 10, 12, 10, 0)}
      />
    </PaperProvider>,
  );
}

const originalOS = Platform.OS;

beforeEach(() => {
  mockPickerProps.length = 0;
  Object.defineProperty(Platform, 'OS', { configurable: true, get: () => 'android' });
});

afterAll(() => {
  Object.defineProperty(Platform, 'OS', { configurable: true, get: () => originalOS });
});

it('reports a choice, marks the current one, and shows the notice', async () => {
  const onChange = jest.fn();
  await renderPicker({ kind: 'tomorrow' }, onChange);
  expect(screen.getByTestId('reminder-default-tomorrow').props.accessibilityState).toMatchObject({ selected: true });
  expect(screen.getByTestId('reminder-default-none').props.accessibilityState).toMatchObject({ selected: false });
  expect(screen.getByText('8 reminders tomorrow at 9:00 AM')).toBeTruthy();
  await act(async () => {
    fireEvent.press(screen.getByTestId('reminder-default-nextMonday'));
  });
  expect(onChange).toHaveBeenCalledWith({ kind: 'nextMonday' });
  await act(async () => {
    fireEvent.press(screen.getByTestId('reminder-default-none'));
  });
  expect(onChange).toHaveBeenLastCalledWith({ kind: 'none' });
});

it('on Android picks a date, then a time, as the device wall clock', async () => {
  const onChange = jest.fn();
  await renderPicker({ kind: 'tomorrow' }, onChange);
  await act(async () => {
    fireEvent.press(screen.getByTestId('reminder-default-picked'));
  });
  expect(lastPicker()?.mode).toBe('date');
  // No date before today; the start value is 9:00 tomorrow.
  expect(lastPicker()?.minimumDate).toEqual(new Date(2026, 10, 12, 10, 0));
  expect(lastPicker()?.value).toEqual(new Date(2026, 10, 13, 9, 0));
  await act(async () => {
    (lastPicker()?.onChange as PickerChange)({ type: 'set' }, new Date(2026, 10, 20, 0, 0));
  });
  expect(lastPicker()?.mode).toBe('time');
  expect(lastPicker()?.value).toEqual(new Date(2026, 10, 20, 9, 0));
  await act(async () => {
    (lastPicker()?.onChange as PickerChange)({ type: 'set' }, new Date(2026, 10, 20, 15, 30));
  });
  expect(onChange).toHaveBeenCalledWith({ kind: 'picked', date: '2026-11-20', time: '15:30' });
  expect(screen.queryByTestId('reminder-default-picker')).toBeNull();
});

it('cancels the pick when a dialog is dismissed', async () => {
  const onChange = jest.fn();
  await renderPicker({ kind: 'tomorrow' }, onChange);
  await act(async () => {
    fireEvent.press(screen.getByTestId('reminder-default-picked'));
  });
  await act(async () => {
    (lastPicker()?.onChange as PickerChange)({ type: 'dismissed' });
  });
  expect(onChange).not.toHaveBeenCalled();
  expect(screen.queryByTestId('reminder-default-picker')).toBeNull();
});

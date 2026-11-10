/**
 * The native date / time picker drawn in the APP's theme, not the phone's.
 *
 * iOS userInterfaceStyle is 'automatic', so the native UIDatePicker follows the PHONE's
 * appearance. With the phone in dark mode and the app in its light theme (the default), the
 * spinner drew white text on the app's light sheet and only the grey selection bar stayed
 * visible: the time could not be read or picked (TestFlight 1.6.0 (11), November 9 2026).
 * themeVariant pins the picker to the app's own scheme. Android ignores it (its picker is a
 * dialog with its own background).
 */
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import type { ComponentProps, ReactElement } from 'react';

import { useAppTheme } from '../../theme';

export type { DateTimePickerEvent };

export type ThemedDateTimePickerProps = ComponentProps<typeof DateTimePicker>;

export function ThemedDateTimePicker(props: ThemedDateTimePickerProps): ReactElement {
  const { isDark } = useAppTheme();
  return <DateTimePicker themeVariant={isDark ? 'dark' : 'light'} {...props} />;
}

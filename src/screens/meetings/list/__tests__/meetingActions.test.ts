/**
 * Pure helpers of the row-action dialogs (§16). The full dialog flows are covered by
 * MeetingsListScreen.test.tsx; this file pins the platform-specific button layout: Android
 * renders AT MOST three alert buttons, so the three scope choices replace the explicit Cancel
 * there (the dialog stays dismissible via `cancelable: true`), while iOS keeps Cancel.
 */
import { Platform } from 'react-native';

import { scopeDialogButtons } from '../meetingActions';

jest.mock('../../../../services/data', () => ({ meetingRepository: {} }));
jest.mock('../../../../services/zoom', () => ({ zoomService: {} }));

const SCOPES = [{ text: 'This meeting only' }, { text: 'This and following' }, { text: 'The whole series' }];

afterEach(() => {
  jest.restoreAllMocks();
});

it('keeps the Cancel button on iOS (alerts cannot be dismissed by tapping outside)', () => {
  jest.replaceProperty(Platform, 'OS', 'ios');
  expect(scopeDialogButtons('Cancel', [...SCOPES]).map((button) => button.text)).toEqual([
    'Cancel',
    'This meeting only',
    'This and following',
    'The whole series',
  ]);
  expect(scopeDialogButtons('Cancel', [...SCOPES])[0]).toMatchObject({ style: 'cancel' });
});

it('drops the Cancel button on Android: all three scopes fit the three-button limit', () => {
  jest.replaceProperty(Platform, 'OS', 'android');
  expect(scopeDialogButtons('Cancel', [...SCOPES]).map((button) => button.text)).toEqual([
    'This meeting only',
    'This and following',
    'The whole series',
  ]);
});

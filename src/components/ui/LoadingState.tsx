/**
 * First-load spinner (owner: shell / Foundation; docs/DESIGN_SYSTEM.md §8): centered primary
 * ActivityIndicator for screens whose layout is unknown - use Skeletons where it is known.
 * Never rendered together with skeletons.
 */
import type { ReactElement } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { ActivityIndicator } from 'react-native-paper';

import { spacing } from '../../theme';

export interface LoadingStateProps {
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function LoadingState({ style, testID }: LoadingStateProps): ReactElement {
  return (
    <View style={[styles.container, style]} testID={testID}>
      <ActivityIndicator animating size="large" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.huge,
  },
});

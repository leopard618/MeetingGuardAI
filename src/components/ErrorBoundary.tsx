/**
 * Render-error boundary (owner: shell). Catches errors thrown while rendering its children,
 * reports them through the logger (log.error forwards to Sentry once AppRoot registered the
 * reporter; nothing is sent when Sentry is not configured) and shows a localized, theme-aware
 * fallback with "Try again" (remounts the children).
 *
 * Two scopes:
 * - 'app' (default): OUTSIDE the other providers at the root (core/contracts PROVIDER_ORDER). Its
 *   fallback replaces the whole app, so it says so, and "Try again" remounts every provider.
 * - 'screen': around each screen of the root stack (RootNavigator `screenLayout`). Only the failed
 *   screen is replaced; the header (back arrow, menu) keeps working and "Try again" remounts just
 *   that screen.
 * The fallback only relies on things that work without the other providers: i18next's global
 * instance, the optional theme (else the OS scheme) and the optional safe-area context.
 */
import { MaterialIcons } from '@expo/vector-icons';
import { Component, useContext, type ErrorInfo, type ReactElement, type ReactNode } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, useColorScheme, View } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';

import { APP_COLORS, resolveColorScheme, useOptionalTheme } from '../contexts/ThemeContext';
import { createLogger } from '../core/logger';
import { useT } from '../i18n';

const log = createLogger('ui');

export type ErrorBoundaryScope = 'app' | 'screen';

export interface ErrorFallbackProps {
  error: Error;
  onRetry(): void;
  scope?: ErrorBoundaryScope;
}

export function ErrorFallback({ error, onRetry, scope = 'app' }: ErrorFallbackProps): ReactElement {
  const t = useT();
  const theme = useOptionalTheme();
  const systemScheme = useColorScheme();
  const colors = theme?.colors ?? APP_COLORS[resolveColorScheme('system', systemScheme)];
  const insets = useContext(SafeAreaInsetsContext);

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={[
        styles.container,
        { paddingTop: (insets?.top ?? 24) + 24, paddingBottom: (insets?.bottom ?? 16) + 24 },
      ]}
      testID="error-boundary-fallback"
    >
      <MaterialIcons name="error-outline" size={56} color={colors.danger} accessibilityElementsHidden importantForAccessibility="no" />
      <Text style={[styles.title, { color: colors.text }]} accessibilityRole="header">
        {t('shell:errorBoundary.title')}
      </Text>
      <Text style={[styles.message, { color: colors.textSecondary }]}>
        {scope === 'screen' ? t('shell:errorBoundary.screenMessage') : t('shell:errorBoundary.message')}
      </Text>
      {__DEV__ ? (
        <View style={[styles.details, { backgroundColor: colors.surfaceVariant }]}>
          <Text style={[styles.detailsText, { color: colors.danger }]} selectable>
            {error.message}
          </Text>
        </View>
      ) : null}
      <Pressable
        onPress={onRetry}
        style={({ pressed }) => [styles.button, { backgroundColor: colors.primary }, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityHint={scope === 'screen' ? t('shell:errorBoundary.screenRetryHint') : t('shell:errorBoundary.retryHint')}
        testID="error-boundary-retry"
      >
        <Text style={[styles.buttonText, { color: colors.onPrimary }]}>{t('common:actions.retry')}</Text>
      </Pressable>
    </ScrollView>
  );
}

export interface ErrorBoundaryProps {
  children?: ReactNode;
  /** Called before the children are remounted by "Try again". */
  onReset?: () => void;
  /** What the fallback replaces (wording): the whole app (default) or one screen. */
  scope?: ErrorBoundaryScope;
}

interface ErrorBoundaryState {
  error: Error | null;
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(typeof value === 'string' ? value : 'Non-error value thrown while rendering');
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { error: asError(error) };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    // The Error carries the stack; the component stack only helps while developing.
    log.error('unhandled render error', asError(error));
    if (__DEV__ && info.componentStack) log.debug('component stack', info.componentStack);
  }

  private readonly reset = (): void => {
    this.props.onReset?.();
    this.setState({ error: null });
  };

  render(): ReactNode {
    const { error } = this.state;
    if (error) return <ErrorFallback error={error} onRetry={this.reset} scope={this.props.scope} />;
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: 16,
    marginBottom: 8,
  },
  message: {
    fontSize: 16,
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 24,
  },
  details: {
    alignSelf: 'stretch',
    borderRadius: 8,
    padding: 12,
    marginBottom: 24,
  },
  detailsText: {
    fontSize: 12,
    fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
  },
  button: {
    minHeight: 48,
    minWidth: 160,
    paddingHorizontal: 24,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  pressed: {
    opacity: 0.8,
  },
});

export default ErrorBoundary;

/**
 * Stable HOC for legacy (stage-3) screens that expect a `language` prop. Apply it at MODULE LEVEL
 * (`const DashboardScreen = withLanguage(Dashboard)`): the wrapper type never changes, so React
 * Navigation never remounts the screen; a language change only re-renders it with the new prop.
 */
import type { ComponentType, ReactElement } from 'react';

import type { Language } from '../core/types';
import { useLanguage } from '../i18n';

/** Legacy JS screens have untyped props. */
export type LegacyComponent = ComponentType<any>;

export type WithLanguageProps = Record<string, unknown>;

export function withLanguage(Component: LegacyComponent): ComponentType<WithLanguageProps> {
  const Inner = Component as ComponentType<WithLanguageProps & { language: Language }>;
  function WithLanguage(props: WithLanguageProps): ReactElement {
    const { language } = useLanguage();
    return <Inner {...props} language={language} />;
  }
  WithLanguage.displayName = `withLanguage(${Component.displayName ?? Component.name ?? 'Screen'})`;
  return WithLanguage;
}

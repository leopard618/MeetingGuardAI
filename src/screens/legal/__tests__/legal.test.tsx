import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { ThemeProvider } from '../../../contexts/ThemeContext';
import { I18nProvider, i18n } from '../../../i18n';
import { RESOURCES } from '../../../i18n/resources';
import { PrivacyScreen, StandaloneTermsScreen } from '..';
import {
  LEGAL_ENTITY,
  LEGAL_SECTIONS,
  contactEmail,
  isPlaceholder,
  legalVariables,
  readLegalDocument,
  readLegalSection,
  type LegalDocumentId,
  type RawTranslate,
} from '../legalContent';

jest.mock('expo-localization', () => ({
  getLocales: jest.fn(() => [{ languageCode: 'en', languageTag: 'en-US' }]),
  getCalendars: jest.fn(() => [{ timeZone: 'UTC', uses24hourClock: false }]),
}));

type Section = { title?: unknown; body?: unknown; items?: unknown; note?: unknown };

function sectionsOf(language: 'en' | 'es', document: LegalDocumentId): Record<string, Section> {
  const legal = RESOURCES[language].legal as Record<string, { sections: Record<string, Section> }>;
  return legal[document]!.sections;
}

const translate: RawTranslate = (key, options) => (i18n as unknown as { t: RawTranslate }).t(key, options);

describe('legal content', () => {
  it.each(['privacy', 'terms'] as const)('%s: every section exists in both languages with the same shape', (document) => {
    for (const language of ['en', 'es'] as const) {
      const sections = sectionsOf(language, document);
      expect(Object.keys(sections).sort()).toEqual([...LEGAL_SECTIONS[document]].sort());
    }
    for (const id of LEGAL_SECTIONS[document]) {
      const en = sectionsOf('en', document)[id]!;
      const es = sectionsOf('es', document)[id]!;
      for (const field of ['body', 'items', 'note'] as const) {
        const enLength = Array.isArray(en[field]) ? (en[field] as unknown[]).length : 0;
        const esLength = Array.isArray(es[field]) ? (es[field] as unknown[]).length : 0;
        expect({ id, field, length: esLength }).toEqual({ id, field, length: enLength });
      }
    }
  });

  it('covers what the stores and the Google API policy require', () => {
    const privacy = JSON.stringify(sectionsOf('en', 'privacy'));
    expect(privacy).toContain('Limited Use');
    expect(privacy).toContain('OpenAI');
    expect(privacy).toContain('Firebase');
    expect(privacy).toContain('Settings → Account → Delete account');
    expect(privacy).toContain('children under 16');
    const privacyEs = JSON.stringify(sectionsOf('es', 'privacy'));
    expect(privacyEs).toContain('Ajustes → Cuenta → Eliminar cuenta');
    expect(privacyEs).toContain('Limited Use');
  });

  it('keeps the company details as clearly marked placeholders until they are filled in', () => {
    expect(isPlaceholder('[COMPANY LEGAL NAME]')).toBe(true);
    expect(isPlaceholder('Acme S.L.')).toBe(false);
    expect(Object.values(LEGAL_ENTITY).every((value) => value.trim() !== '')).toBe(true);
    // Placeholders are never turned into mailto links.
    if (isPlaceholder(LEGAL_ENTITY.email)) expect(contactEmail()).toBeNull();
  });

  it('reads sections with interpolated company details and skips empty ones', async () => {
    await i18n.changeLanguage('en');
    const variables = legalVariables('[LAW]');
    const section = readLegalSection(translate, 'privacy', 'controller', variables);
    expect(section.title).toBe('Who is responsible for your data');
    expect(section.body[0]).toContain(LEGAL_ENTITY.name);
    expect(section.body[0]).toContain(LEGAL_ENTITY.email);

    const terms = readLegalDocument(translate, 'terms', variables);
    expect(terms.map((item) => item.id)).toEqual(LEGAL_SECTIONS.terms);
    expect(terms.find((item) => item.id === 'ai')?.items.join(' ')).toContain('10 actions during the 7 days');

    const fake: RawTranslate = (key) => (key.endsWith('.ok') ? { title: 'OK', body: ['Text'], items: 'x' } : key);
    expect(readLegalSection(fake, 'terms', 'ok', {})).toEqual({ id: 'ok', title: 'OK', body: ['Text'], items: ['x'], note: [] });
    expect(readLegalSection(fake, 'terms', 'missing', {}).title).toBe('');
  });
});

const Stack = createStackNavigator();

function Home({ navigation }: { navigation: { navigate(name: string): void } }) {
  return (
    <Text testID="home" onPress={() => navigation.navigate('Terms')}>
      home
    </Text>
  );
}

async function renderWith(name: 'Privacy' | 'Terms', component: () => React.ReactElement, withHome = false) {
  await render(
    <I18nProvider>
      <ThemeProvider initialMode="light">
        <NavigationContainer>
          <Stack.Navigator screenOptions={{ headerShown: false }}>
            {withHome ? <Stack.Screen name="Home" component={Home} /> : null}
            <Stack.Screen name={name} component={component} />
          </Stack.Navigator>
        </NavigationContainer>
      </ThemeProvider>
    </I18nProvider>,
  );
  await act(async () => undefined);
}

describe('legal screens', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('renders the privacy policy with the localized date', async () => {
    await renderWith('Privacy', PrivacyScreen);
    expect(screen.getByText('Last updated: September 28th, 2026')).toBeTruthy();
    expect(screen.getByText('Who is responsible for your data')).toBeTruthy();
    expect(screen.getByTestId('legal-privacy')).toBeTruthy();
  });

  it('renders the standalone terms with a back button, in Spanish', async () => {
    await i18n.changeLanguage('es');
    await renderWith('Terms', StandaloneTermsScreen, true);
    await act(async () => {
      fireEvent.press(screen.getByTestId('home'));
    });
    expect(screen.getByText('Términos del servicio')).toBeTruthy();
    expect(screen.getByText('Acuerdo')).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Volver'));
    });
    expect(screen.getByTestId('home')).toBeTruthy();
  });
});

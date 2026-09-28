import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

interface Props {
  missingKeys: readonly string[];
  invalidKeys: readonly string[];
}

/**
 * Shown instead of the app when the build has no (or incomplete) public configuration,
 * e.g. an EAS build without its EXPO_PUBLIC_* environment variables. Bilingual on purpose:
 * no i18n or other services are initialized at this point.
 */
export default function NotConfiguredScreen({ missingKeys, invalidKeys }: Props) {
  const hasDetails = missingKeys.length > 0 || invalidKeys.length > 0;

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title} accessibilityRole="header">
          App not configured
        </Text>
        <Text style={styles.body}>
          This build of MeetingGuard AI is missing its configuration, so it cannot start. Please
          install the latest version from the store or contact support.
        </Text>

        <View style={styles.divider} />

        <Text style={styles.title} accessibilityRole="header">
          Aplicación no configurada
        </Text>
        <Text style={styles.body}>
          A esta versión de MeetingGuard AI le falta su configuración y no puede iniciarse. Instala
          la última versión desde la tienda o contacta con soporte.
        </Text>

        {hasDetails ? (
          <View style={styles.details}>
            {missingKeys.length > 0 ? (
              <Text style={styles.detailText}>Missing / Faltan: {missingKeys.join(', ')}</Text>
            ) : null}
            {invalidKeys.length > 0 ? (
              <Text style={styles.detailText}>Invalid / No válidas: {invalidKeys.join(', ')}</Text>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#0b1020',
  },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 24,
  },
  title: {
    color: '#ffffff',
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 8,
  },
  body: {
    color: '#cbd5e1',
    fontSize: 16,
    lineHeight: 22,
  },
  divider: {
    height: 1,
    backgroundColor: '#1e293b',
    marginVertical: 24,
  },
  details: {
    marginTop: 32,
    padding: 12,
    borderRadius: 8,
    backgroundColor: '#111827',
  },
  detailText: {
    color: '#94a3b8',
    fontSize: 12,
    fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
  },
});

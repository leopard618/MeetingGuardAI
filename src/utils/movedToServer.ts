/**
 * Features that used to call third-party APIs straight from the app with a secret
 * (OpenAI API key, Google OAuth client secret) or through the retired Render backend.
 * Those secrets can no longer ship in the app bundle, so these features are unavailable
 * until they are rebuilt on Firebase (Cloud Functions / native Google Sign-In).
 */
export type MovedFeature =
  | 'ai-assistant'
  | 'google-sign-in'
  | 'google-calendar-connect'
  | 'google-token-refresh'
  | 'backend-sync';

export const MOVED_TO_SERVER_CODE = 'moved-to-server';

const MESSAGES: Record<MovedFeature, { en: string; es: string }> = {
  'ai-assistant': {
    en: 'The AI assistant is temporarily unavailable while it moves to our secure server. Please try again in a future update.',
    es: 'El asistente de IA no está disponible temporalmente mientras se traslada a nuestro servidor seguro. Vuelve a intentarlo en una próxima actualización.',
  },
  'google-sign-in': {
    en: 'Google sign-in is temporarily unavailable while it moves to our secure server. Please try again in a future update.',
    es: 'El inicio de sesión con Google no está disponible temporalmente mientras se traslada a nuestro servidor seguro. Vuelve a intentarlo en una próxima actualización.',
  },
  'google-calendar-connect': {
    en: 'Connecting Google Calendar is temporarily unavailable while it moves to our secure server. Please try again in a future update.',
    es: 'La conexión con Google Calendar no está disponible temporalmente mientras se traslada a nuestro servidor seguro. Vuelve a intentarlo en una próxima actualización.',
  },
  'google-token-refresh': {
    en: 'Your Google Calendar session could not be renewed on this device. Please reconnect Google Calendar after the next update.',
    es: 'No se pudo renovar tu sesión de Google Calendar en este dispositivo. Vuelve a conectar Google Calendar después de la próxima actualización.',
  },
  'backend-sync': {
    en: 'Server sync is temporarily unavailable while it moves to our secure server.',
    es: 'La sincronización con el servidor no está disponible temporalmente mientras se traslada a nuestro servidor seguro.',
  },
};

export type Language = 'en' | 'es';

export function movedToServerMessage(feature: MovedFeature, language: string = 'en'): string {
  const lang: Language = language === 'es' ? 'es' : 'en';
  return MESSAGES[feature][lang];
}

export class MovedToServerError extends Error {
  readonly code = MOVED_TO_SERVER_CODE;
  readonly feature: MovedFeature;

  constructor(feature: MovedFeature, language: string = 'en') {
    super(movedToServerMessage(feature, language));
    this.name = 'MovedToServerError';
    this.feature = feature;
  }
}

export function isMovedToServerError(error: unknown): error is MovedToServerError {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === MOVED_TO_SERVER_CODE
  );
}

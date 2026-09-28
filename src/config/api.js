// AI / API availability.
//
// The app no longer talks to OpenAI directly: an API key inside the app bundle can be
// extracted by anyone who has the APK. The AI assistant will be served by a Firebase
// callable Cloud Function (the OpenAI key lives only in Firebase Functions secrets).
// Until that function exists the assistant is reported as unavailable.
import { env } from './env';

/**
 * Whether the AI assistant can be used in this build.
 * Always false until the Firebase callable function is wired in.
 */
export const isAIAvailable = () => false;

/**
 * Configuration status (public values only - no secrets are read here).
 */
export const isAPIConfigured = () => ({
  ai: {
    available: isAIAvailable(),
    provider: 'firebase-functions',
  },
  google: {
    hasWebClientId: !!env.google.webClientId,
    hasIosClientId: !!env.google.iosClientId,
    configured: !!env.google.webClientId,
  },
});

export const getAPIConfigStatus = () => {
  const config = isAPIConfigured();
  return {
    aiAvailable: config.ai.available,
    googleConfigured: config.google.configured,
    missingConfig: {
      ai: config.ai.available ? null : 'AI assistant is moving to a secure server',
      google: config.google.configured ? null : 'EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID missing',
    },
  };
};

export default {
  isAIAvailable,
  isAPIConfigured,
  getAPIConfigStatus,
};

// AI service facade.
//
// The app used to call api.openai.com directly with an API key compiled into the bundle.
// That key was extractable from the published APK, so direct calls were removed. The AI
// assistant will be rebuilt as a Firebase callable Cloud Function (the key lives only in
// Firebase Functions secrets). Until then every generation call rejects with a
// MovedToServerError so callers can show a clear "temporarily unavailable" message.
// The previous prompts are in git history (src/api/openai.js before the SDK 57 upgrade).
import NetInfo from '@react-native-community/netinfo';

import { MovedToServerError } from '../utils/movedToServer';

class OpenAIService {
  constructor() {
    this.available = false;
  }

  /**
   * Check network connectivity
   */
  async checkNetworkConnectivity() {
    try {
      const state = await NetInfo.fetch();
      return Boolean(state.isConnected && state.isInternetReachable !== false);
    } catch (error) {
      console.error('Network check failed:', error);
      return false;
    }
  }

  /**
   * The AI backend is not available in this build.
   */
  async validateAPIKey() {
    return false;
  }

  async generateChatResponse(_messages, _options = {}) {
    throw new MovedToServerError('ai-assistant');
  }

  async generateMeetingResponse(_messages, _calendarData = {}) {
    throw new MovedToServerError('ai-assistant');
  }

  /**
   * Format messages for the (future) AI function.
   */
  formatMessages(messages) {
    return messages.map((msg) => ({
      role: msg.type === 'user' ? 'user' : 'assistant',
      content: msg.content,
    }));
  }

  async testNetworkConnectivity() {
    return this.checkNetworkConnectivity();
  }

  async testOpenAIConnectivity() {
    return false;
  }
}

export default new OpenAIService();

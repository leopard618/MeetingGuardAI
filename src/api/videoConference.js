import AsyncStorage from '@react-native-async-storage/async-storage';

// Environment variables for video conference APIs
let ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET, ZOOM_API_KEY, ZOOM_API_SECRET;
let TEAMS_CLIENT_ID, TEAMS_CLIENT_SECRET;
let GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET;

try {
  const env = require('@env');
  ZOOM_CLIENT_ID = env.ZOOM_CLIENT_ID;
  ZOOM_CLIENT_SECRET = env.ZOOM_CLIENT_SECRET;
  ZOOM_API_KEY = env.ZOOM_API_KEY;
  ZOOM_API_SECRET = env.ZOOM_API_SECRET;
  TEAMS_CLIENT_ID = env.TEAMS_CLIENT_ID;
  TEAMS_CLIENT_SECRET = env.TEAMS_CLIENT_SECRET;
  GOOGLE_CLIENT_ID = env.GOOGLE_CLIENT_ID;
  GOOGLE_CLIENT_SECRET = env.GOOGLE_CLIENT_SECRET;
} catch (error) {
  ZOOM_CLIENT_ID = process.env.ZOOM_CLIENT_ID;
  ZOOM_CLIENT_SECRET = process.env.ZOOM_CLIENT_SECRET;
  ZOOM_API_KEY = process.env.ZOOM_API_KEY;
  ZOOM_API_SECRET = process.env.ZOOM_API_SECRET;
  TEAMS_CLIENT_ID = process.env.TEAMS_CLIENT_ID;
  TEAMS_CLIENT_SECRET = process.env.TEAMS_CLIENT_SECRET;
  GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
  GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
}

class VideoConferenceService {
  constructor() {
    this.providers = {
      zoom: new ZoomProvider(),
      teams: new TeamsProvider(),
      meet: new GoogleMeetProvider(),
    };
    this.customProviders = new Map();
    this.defaultProvider = 'zoom';
  }

  /**
   * Initialize video conference service
   * @returns {Promise<boolean>} Whether initialization was successful
   */
  async initialize() {
    try {
      // Initialize all providers
      const initPromises = Object.values(this.providers).map(provider => provider.initialize());
      await Promise.all(initPromises);
      
      // Load custom providers
      await this.loadCustomProviders();
      
      return true;
    } catch (error) {
      console.error('Video conference initialization failed:', error);
      return false;
    }
  }

  /**
   * Create a meeting link with the specified provider
   * @param {string} provider - Provider name ('zoom', 'teams', 'meet', or custom)
   * @param {Object} meetingData - Meeting data
   * @returns {Promise<Object>} Meeting link data
   */
  async createMeetingLink(provider, meetingData) {
    try {
      const providerInstance = this.getProvider(provider);
      if (!providerInstance) {
        throw new Error(`Provider '${provider}' not found`);
      }

      return await providerInstance.createMeeting(meetingData);
    } catch (error) {
      console.error(`Failed to create meeting link with ${provider}:`, error);
      throw error;
    }
  }

  /**
   * Get available providers
   * @returns {Array} Array of available providers
   */
  getAvailableProviders() {
    const providers = Object.keys(this.providers).map(name => ({
      name,
      displayName: this.providers[name].displayName,
      isAuthenticated: this.providers[name].isAuthenticated(),
    }));

    // Add custom providers
    this.customProviders.forEach((provider, name) => {
      providers.push({
        name,
        displayName: provider.displayName,
        isAuthenticated: provider.isAuthenticated(),
        isCustom: true,
      });
    });

    return providers;
  }

  /**
   * Get provider instance
   * @param {string} providerName - Provider name
   * @returns {Object} Provider instance
   */
  getProvider(providerName) {
    return this.providers[providerName] || this.customProviders.get(providerName);
  }

  /**
   * Add custom provider
   * @param {string} name - Provider name
   * @param {Object} provider - Provider instance
   */
  addCustomProvider(name, provider) {
    this.customProviders.set(name, provider);
    this.saveCustomProviders();
  }

  /**
   * Remove custom provider
   * @param {string} name - Provider name
   */
  removeCustomProvider(name) {
    this.customProviders.delete(name);
    this.saveCustomProviders();
  }

  /**
   * Save custom providers to storage
   */
  async saveCustomProviders() {
    try {
      const providersData = Array.from(this.customProviders.entries()).map(([name, provider]) => ({
        name,
        displayName: provider.displayName,
        config: provider.getConfig(),
      }));
      
      await AsyncStorage.setItem('custom_video_providers', JSON.stringify(providersData));
    } catch (error) {
      console.error('Failed to save custom providers:', error);
    }
  }

  /**
   * Load custom providers from storage
   */
  async loadCustomProviders() {
    try {
      const providersData = await AsyncStorage.getItem('custom_video_providers');
      if (providersData) {
        const providers = JSON.parse(providersData);
        providers.forEach(providerData => {
          const provider = new CustomProvider(providerData.displayName, providerData.config);
          this.customProviders.set(providerData.name, provider);
        });
      }
    } catch (error) {
      console.error('Failed to load custom providers:', error);
    }
  }

  /**
   * Get service status
   * @returns {Promise<Object>} Service status
   */
  async getStatus() {
    const status = {};
    
    for (const [name, provider] of Object.entries(this.providers)) {
      status[name] = {
        isAuthenticated: provider.isAuthenticated(),
        displayName: provider.displayName,
      };
    }

    // Add custom providers status
    this.customProviders.forEach((provider, name) => {
      status[name] = {
        isAuthenticated: provider.isAuthenticated(),
        displayName: provider.displayName,
        isCustom: true,
      };
    });

    return status;
  }
}

// Zoom Provider
class ZoomProvider {
  constructor() {
    this.clientId = ZOOM_CLIENT_ID;
    this.clientSecret = ZOOM_CLIENT_SECRET;
    this.apiKey = ZOOM_API_KEY;
    this.apiSecret = ZOOM_API_SECRET;
    this.accessToken = null;
    this.refreshToken = null;
    this.displayName = 'Zoom';
  }

  async initialize() {
    try {
      await this.loadStoredTokens();
      return this.isAuthenticated();
    } catch (error) {
      console.error('Zoom initialization failed:', error);
      return false;
    }
  }

  async authenticate() {
    try {
      // For mobile apps, use OAuth flow
      const authUrl = `https://zoom.us/oauth/authorize?` +
        `response_type=code&` +
        `client_id=${this.clientId}&` +
        `redirect_uri=${encodeURIComponent('https://meetingguard.com/auth/zoom/callback')}`;

      console.log('Zoom authentication URL:', authUrl);
      
      // Simulate successful authentication
      this.accessToken = 'mock-zoom-access-token';
      this.refreshToken = 'mock-zoom-refresh-token';
      
      await this.storeTokens();
      return true;
    } catch (error) {
      console.error('Zoom authentication failed:', error);
      return false;
    }
  }

  async createMeeting(meetingData) {
    try {
      if (!this.isAuthenticated()) {
        throw new Error('Not authenticated with Zoom');
      }

      const { title, date, time, duration = 60, participants = [] } = meetingData;
      const startTime = new Date(`${date}T${time}:00`);

      const meetingPayload = {
        topic: title,
        type: 2, // Scheduled meeting
        start_time: startTime.toISOString(),
        duration: duration,
        settings: {
          host_video: true,
          participant_video: true,
          join_before_host: true,
          mute_upon_entry: false,
          watermark: false,
          use_pmi: false,
          approval_type: 0,
          audio: 'both',
          auto_recording: 'none',
        },
      };

      const response = await fetch('https://api.zoom.us/v2/users/me/meetings', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(meetingPayload),
      });

      if (!response.ok) {
        throw new Error(`Zoom API error: ${response.status}`);
      }

      const meeting = await response.json();

      return {
        provider: 'zoom',
        meetingId: meeting.id,
        joinUrl: meeting.join_url,
        startUrl: meeting.start_url,
        password: meeting.password,
        title: meeting.topic,
        startTime: meeting.start_time,
        duration: meeting.duration,
      };
    } catch (error) {
      console.error('Failed to create Zoom meeting:', error);
      throw error;
    }
  }

  async storeTokens() {
    try {
      await AsyncStorage.setItem('zoom_access_token', this.accessToken);
      if (this.refreshToken) {
        await AsyncStorage.setItem('zoom_refresh_token', this.refreshToken);
      }
    } catch (error) {
      console.error('Failed to store Zoom tokens:', error);
    }
  }

  async loadStoredTokens() {
    try {
      this.accessToken = await AsyncStorage.getItem('zoom_access_token');
      this.refreshToken = await AsyncStorage.getItem('zoom_refresh_token');
    } catch (error) {
      console.error('Failed to load Zoom tokens:', error);
    }
  }

  isAuthenticated() {
    return !!this.accessToken;
  }
}

// Microsoft Teams Provider
class TeamsProvider {
  constructor() {
    this.clientId = TEAMS_CLIENT_ID;
    this.clientSecret = TEAMS_CLIENT_SECRET;
    this.accessToken = null;
    this.refreshToken = null;
    this.displayName = 'Microsoft Teams';
  }

  async initialize() {
    try {
      await this.loadStoredTokens();
      return this.isAuthenticated();
    } catch (error) {
      console.error('Teams initialization failed:', error);
      return false;
    }
  }

  async authenticate() {
    try {
      // Use Microsoft Graph API for Teams
      const authUrl = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?` +
        `client_id=${this.clientId}&` +
        `response_type=code&` +
        `redirect_uri=${encodeURIComponent('https://meetingguard.com/auth/teams/callback')}&` +
        `scope=${encodeURIComponent('https://graph.microsoft.com/OnlineMeetings.ReadWrite')}`;

      console.log('Teams authentication URL:', authUrl);
      
      // Simulate successful authentication
      this.accessToken = 'mock-teams-access-token';
      this.refreshToken = 'mock-teams-refresh-token';
      
      await this.storeTokens();
      return true;
    } catch (error) {
      console.error('Teams authentication failed:', error);
      return false;
    }
  }

  async createMeeting(meetingData) {
    try {
      if (!this.isAuthenticated()) {
        throw new Error('Not authenticated with Teams');
      }

      const { title, date, time, duration = 60, participants = [] } = meetingData;
      const startTime = new Date(`${date}T${time}:00`);
      const endTime = new Date(startTime.getTime() + duration * 60000);

      const meetingPayload = {
        subject: title,
        startDateTime: startTime.toISOString(),
        endDateTime: endTime.toISOString(),
        participants: {
          attendees: participants.map(email => ({
            upn: email,
            role: 'attendee',
          })),
        },
        isOnlineMeeting: true,
        onlineMeetingProvider: 'teamsForBusiness',
      };

      const response = await fetch('https://graph.microsoft.com/v1.0/me/onlineMeetings', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(meetingPayload),
      });

      if (!response.ok) {
        throw new Error(`Teams API error: ${response.status}`);
      }

      const meeting = await response.json();

      return {
        provider: 'teams',
        meetingId: meeting.id,
        joinUrl: meeting.joinUrl,
        startUrl: meeting.startUrl,
        title: meeting.subject,
        startTime: meeting.startDateTime,
        endTime: meeting.endDateTime,
      };
    } catch (error) {
      console.error('Failed to create Teams meeting:', error);
      throw error;
    }
  }

  async storeTokens() {
    try {
      await AsyncStorage.setItem('teams_access_token', this.accessToken);
      if (this.refreshToken) {
        await AsyncStorage.setItem('teams_refresh_token', this.refreshToken);
      }
    } catch (error) {
      console.error('Failed to store Teams tokens:', error);
    }
  }

  async loadStoredTokens() {
    try {
      this.accessToken = await AsyncStorage.getItem('teams_access_token');
      this.refreshToken = await AsyncStorage.getItem('teams_refresh_token');
    } catch (error) {
      console.error('Failed to load Teams tokens:', error);
    }
  }

  isAuthenticated() {
    return !!this.accessToken;
  }
}

// Google Meet Provider
class GoogleMeetProvider {
  constructor() {
    this.clientId = GOOGLE_CLIENT_ID;
    this.clientSecret = GOOGLE_CLIENT_SECRET;
    this.accessToken = null;
    this.refreshToken = null;
    this.displayName = 'Google Meet';
  }

  async initialize() {
    try {
      await this.loadStoredTokens();
      return this.isAuthenticated();
    } catch (error) {
      console.error('Google Meet initialization failed:', error);
      return false;
    }
  }

  async authenticate() {
    try {
      // Use Google Calendar API for Meet integration
      const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
        `client_id=${this.clientId}&` +
        `response_type=code&` +
        `redirect_uri=${encodeURIComponent('https://meetingguard.com/auth/google/callback')}&` +
        `scope=${encodeURIComponent('https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/calendar.events')}`;

      console.log('Google Meet authentication URL:', authUrl);
      
      // Simulate successful authentication
      this.accessToken = 'mock-google-access-token';
      this.refreshToken = 'mock-google-refresh-token';
      
      await this.storeTokens();
      return true;
    } catch (error) {
      console.error('Google Meet authentication failed:', error);
      return false;
    }
  }

  async createMeeting(meetingData) {
    try {
      if (!this.isAuthenticated()) {
        throw new Error('Not authenticated with Google');
      }

      const { title, date, time, duration = 60, participants = [] } = meetingData;
      const startTime = new Date(`${date}T${time}:00`);
      const endTime = new Date(startTime.getTime() + duration * 60000);

      const eventPayload = {
        summary: title,
        start: {
          dateTime: startTime.toISOString(),
          timeZone: 'UTC',
        },
        end: {
          dateTime: endTime.toISOString(),
          timeZone: 'UTC',
        },
        attendees: participants.map(email => ({ email })),
        conferenceData: {
          createRequest: {
            requestId: `meeting-${Date.now()}`,
            conferenceSolutionKey: {
              type: 'hangoutsMeet',
            },
          },
        },
      };

      const response = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(eventPayload),
      });

      if (!response.ok) {
        throw new Error(`Google API error: ${response.status}`);
      }

      const event = await response.json();

      return {
        provider: 'meet',
        meetingId: event.id,
        joinUrl: event.conferenceData?.entryPoints?.[0]?.uri,
        startUrl: event.hangoutLink,
        title: event.summary,
        startTime: event.start.dateTime,
        endTime: event.end.dateTime,
      };
    } catch (error) {
      console.error('Failed to create Google Meet meeting:', error);
      throw error;
    }
  }

  async storeTokens() {
    try {
      await AsyncStorage.setItem('google_meet_access_token', this.accessToken);
      if (this.refreshToken) {
        await AsyncStorage.setItem('google_meet_refresh_token', this.refreshToken);
      }
    } catch (error) {
      console.error('Failed to store Google Meet tokens:', error);
    }
  }

  async loadStoredTokens() {
    try {
      this.accessToken = await AsyncStorage.getItem('google_meet_access_token');
      this.refreshToken = await AsyncStorage.getItem('google_meet_refresh_token');
    } catch (error) {
      console.error('Failed to load Google Meet tokens:', error);
    }
  }

  isAuthenticated() {
    return !!this.accessToken;
  }
}

// Custom Provider Base Class
class CustomProvider {
  constructor(displayName, config = {}) {
    this.displayName = displayName;
    this.config = config;
    this.isAuthenticated = false;
  }

  async initialize() {
    // Override in custom implementations
    return true;
  }

  async createMeeting(meetingData) {
    // Override in custom implementations
    throw new Error('createMeeting method must be implemented in custom provider');
  }

  getConfig() {
    return this.config;
  }

  isAuthenticated() {
    return this.isAuthenticated;
  }
}

export default new VideoConferenceService(); 
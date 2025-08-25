const express = require('express');
const cors = require('cors');
require('dotenv').config();

// Initialize Sentry for error tracking
let Sentry;
try {
  Sentry = require('@sentry/node');
  
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: 1.0,
    integrations: [
      new Sentry.Integrations.Http({ tracing: true }),
      new Sentry.Integrations.Express({ app: express }),
    ],
  });
} catch (error) {
  console.log('Sentry not available:', error.message);
}

const app = express();
const PORT = process.env.PORT || 3000;

// Sentry request handler (must be first)
if (Sentry) {
  app.use(Sentry.Handlers.requestHandler());
}

// Middleware
app.use(cors());
app.use(express.json());

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'MeetingGuard AI Backend API',
    version: '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    endpoints: {
      health: '/api/health',
      auth: '/api/auth/*',
      meetings: '/api/meetings',
      calendar: '/api/calendar/*'
    }
  });
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    message: 'MeetingGuard AI Backend is running on Render!',
    sentry: Sentry ? 'enabled' : 'disabled'
  });
});

// Auth endpoints
app.post('/api/auth/google/callback', async (req, res) => {
  try {
    const { code, error } = req.body;
    
    if (error) {
      console.error('OAuth error:', error);
      return res.status(400).json({
        error: 'OAuth error',
        message: error
      });
    }
    
    if (!code) {
      return res.status(400).json({
        error: 'Missing authorization code'
      });
    }
    
    console.log('Processing Google OAuth callback with code:', code);
    
    // Exchange code for tokens
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        code: code,
        grant_type: 'authorization_code',
        redirect_uri: 'https://meetingguard-backend.onrender.com/api/auth/google/callback',
      }),
    });
    
    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error('Token exchange failed:', errorText);
      return res.status(400).json({
        error: 'Token exchange failed',
        details: errorText
      });
    }
    
    const tokenData = await tokenResponse.json();
    console.log('Token exchange successful');
    
    // Get user info
    const userResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`
      }
    });
    
    const userData = await userResponse.json();
    
    res.json({
      success: true,
      user: userData,
      tokens: tokenData,
      message: 'OAuth callback processed successfully'
    });
    
  } catch (error) {
    console.error('OAuth callback error:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

// GET endpoint for OAuth callback (Google sometimes uses GET)
app.get('/api/auth/google/callback', async (req, res) => {
  try {
    const { code, error } = req.query;
    
    if (error) {
      console.error('OAuth error:', error);
      return res.status(400).json({
        error: 'OAuth error',
        message: error
      });
    }
    
    if (!code) {
      return res.status(400).json({
        error: 'Missing authorization code'
      });
    }
    
    console.log('Processing Google OAuth callback with code:', code);
    
    // Exchange code for tokens
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        code: code,
        grant_type: 'authorization_code',
        redirect_uri: 'https://meetingguard-backend.onrender.com/api/auth/google/callback',
      }),
    });
    
    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error('Token exchange failed:', errorText);
      return res.status(400).json({
        error: 'Token exchange failed',
        details: errorText
      });
    }
    
    const tokenData = await tokenResponse.json();
    console.log('Token exchange successful');
    
    // Get user info
    const userResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`
      }
    });
    
    const userData = await userResponse.json();
    
    res.json({
      success: true,
      user: userData,
      tokens: tokenData,
      message: 'OAuth callback processed successfully'
    });
    
  } catch (error) {
    console.error('OAuth callback error:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

app.post('/api/auth/validate', (req, res) => {
  // Mock JWT validation
  res.json({
    valid: true,
    message: 'JWT validation endpoint'
  });
});

// Meetings endpoints
app.get('/api/meetings', (req, res) => {
  // Mock meetings list
  res.json({
    meetings: [],
    message: 'Meetings endpoint'
  });
});

app.post('/api/meetings', (req, res) => {
  // Mock create meeting
  res.json({
    meeting: req.body,
    message: 'Meeting created'
  });
});

// Calendar endpoints
app.get('/api/calendar/events', (req, res) => {
  // Mock calendar events
  res.json({
    events: [
      {
        id: '1',
        title: 'Team Meeting',
        start: new Date(Date.now() + 3600000).toISOString(),
        end: new Date(Date.now() + 7200000).toISOString()
      }
    ]
  });
});

// Sentry error handler (must be before 404 handler)
if (Sentry) {
  app.use(Sentry.Handlers.errorHandler());
}

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Not found',
    path: req.originalUrl,
    timestamp: new Date().toISOString()
  });
});

// Start server for Render
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 MeetingGuard AI Backend running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/api/health`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔗 Render URL: https://meetingguard-backend.onrender.com`);
  console.log(`📈 Sentry: ${Sentry ? 'enabled' : 'disabled'}`);
});

// Error handling
server.on('error', (error) => {
  console.error('Server error:', error);
  if (Sentry) {
    Sentry.captureException(error);
  }
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use`);
  }
});

process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('Process terminated');
  });
});

// Export for Vercel (keep for compatibility)
module.exports = app;

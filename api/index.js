const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    message: 'MeetingGuard AI Backend is running on Vercel!'
  });
});

// Auth endpoints
app.post('/api/auth/google/callback', (req, res) => {
  // Mock Google OAuth callback
  res.json({
    message: 'Google OAuth callback endpoint',
    status: 'configured'
  });
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

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'MeetingGuard AI Backend API',
    version: '1.0.0',
    endpoints: {
      health: '/api/health',
      auth: '/api/auth/*',
      meetings: '/api/meetings',
      calendar: '/api/calendar/*'
    }
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Not found',
    path: req.originalUrl,
    timestamp: new Date().toISOString()
  });
});

// Export for Vercel
module.exports = app;

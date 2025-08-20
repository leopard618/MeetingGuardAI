const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

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
    message: 'MeetingGuard AI Backend is running on Render!'
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
});

// Error handling
server.on('error', (error) => {
  console.error('Server error:', error);
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

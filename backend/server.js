const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

// Import routes with error handling
let authRoutes, meetingRoutes, calendarRoutes, aiRoutes, fileRoutes, userRoutes;
let errorHandler, authenticateToken, billingRoutes, adminRoutes, planGate;

try {
  console.log('Importing routes and middleware...');
  
  authRoutes = require('./routes/auth');
  console.log('✅ authRoutes imported');
  
  meetingRoutes = require('./routes/meetings');
  console.log('✅ meetingRoutes imported');
  
  calendarRoutes = require('./routes/calendar');
  console.log('✅ calendarRoutes imported');
  
  aiRoutes = require('./routes/ai');
  console.log('✅ aiRoutes imported');
  
  fileRoutes = require('./routes/files');
  console.log('✅ fileRoutes imported');
  
  userRoutes = require('./routes/users');
  console.log('✅ userRoutes imported');
  
  const errorHandlerModule = require('./middleware/errorHandler');
  errorHandler = errorHandlerModule.errorHandler;
  console.log('✅ errorHandler imported');
  
  authenticateToken = require('./middleware/auth').authenticateToken;
  console.log('✅ authenticateToken imported');
  
  billingRoutes = require('./routes/billing');
  console.log('✅ billingRoutes imported');
  
  adminRoutes = require('./routes/admin');
  console.log('✅ adminRoutes imported');
  
  planGate = require('./middleware/planGate').planGate;
  console.log('✅ planGate imported');
  
  // Verify all imports are valid
  if (!authRoutes || !meetingRoutes || !calendarRoutes || !aiRoutes || !fileRoutes || !userRoutes || 
      !errorHandler || !authenticateToken || !billingRoutes || !adminRoutes || !planGate) {
    throw new Error('One or more imports are undefined');
  }
  
  console.log('✅ All imports successful');
} catch (error) {
  console.error('❌ Error importing routes or middleware:', error);
  console.error('Stack trace:', error.stack);
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Compression middleware
app.use(compression());

// Logging middleware
app.use(morgan('combined'));

// CORS configuration
const corsOptions = {
  origin: function (origin, callback) {
    const allowedOrigins = [
      'https://meetingguard.app',
      'https://www.meetingguard.app',
      'exp://localhost:8081',
      'exp://192.168.141.51:8081',
      'meetingguardai://'
    ];
    
    // Allow requests with no origin (like mobile apps or Postman)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      console.log('CORS blocked origin:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  optionsSuccessStatus: 200
};
app.use(cors(corsOptions));

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'MeetingGuard Backend API',
    version: '1.0.0',
    status: 'running',
    endpoints: {
      health: '/health',
      auth: '/api/auth',
      oauth: '/oauth',
      meetings: '/api/meetings',
      calendar: '/api/calendar',
      ai: '/api/ai',
      files: '/api/files',
      users: '/api/users',
      billing: '/api/billing',
      admin: '/api/admin'
    }
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    version: process.env.npm_package_version || '1.0.0'
  });
});

// API routes with error handling - TEMPORARILY DISABLED planGate
try {
  console.log('Setting up API routes...');
  
  app.use('/api/auth', authRoutes);
  console.log('✅ /api/auth route configured');
  
  // Temporarily disable planGate middleware to isolate the issue
  app.use('/api/meetings', authenticateToken, meetingRoutes);
  console.log('✅ /api/meetings route configured');
  
  app.use('/api/calendar', authenticateToken, calendarRoutes);
  console.log('✅ /api/calendar route configured');
  
  app.use('/api/ai', authenticateToken, aiRoutes);
  console.log('✅ /api/ai route configured');
  
  app.use('/api/files', authenticateToken, fileRoutes);
  console.log('✅ /api/files route configured');
  
  app.use('/api/users', authenticateToken, userRoutes);
  console.log('✅ /api/users route configured');
  
  app.use('/api/billing', authenticateToken, billingRoutes);
  console.log('✅ /api/billing route configured');
  
  app.use('/api/admin', authenticateToken, adminRoutes);
  console.log('✅ /api/admin route configured');

  // OAuth redirect endpoint (for Google Auth)
  app.use('/oauth', require('./routes/oauth'));
  console.log('✅ /oauth route configured');
  
  console.log('✅ All API routes configured successfully');
} catch (error) {
  console.error('❌ Error setting up routes:', error);
  console.error('Stack trace:', error.stack);
  process.exit(1);
}

// Error handling middleware
app.use(errorHandler);

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Endpoint not found',
    path: req.originalUrl,
    method: req.method
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 MeetingGuard Backend Server running on port ${PORT}`);
  console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔗 Health check: http://localhost:${PORT}/health`);
  console.log(`🔐 OAuth redirect: http://localhost:${PORT}/oauth`);

  // Show correct URLs based on environment
  if (process.env.NODE_ENV === 'production') {
    const baseUrl = process.env.BACKEND_URL || 'https://meetingguard-backend.onrender.com';
    console.log(`🔗 Health check: ${baseUrl}/health`);
    console.log(`🔐 OAuth redirect: ${baseUrl}/oauth`);
  } else {
    console.log(`🔗 Health check: http://localhost:${PORT}/health`);
    console.log(`🔐 OAuth redirect: http://localhost:${PORT}/oauth`);
  }

});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  process.exit(0);
});

module.exports = app;

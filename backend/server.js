const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

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

// Import routes and middleware
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
  
  console.log('✅ All imports successful');
} catch (error) {
  console.error('❌ Error importing routes or middleware:', error);
  console.error('Stack trace:', error.stack);
  process.exit(1);
}

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

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/meetings', authenticateToken, meetingRoutes);
app.use('/api/calendar', authenticateToken, calendarRoutes);
app.use('/api/ai', authenticateToken, aiRoutes);
app.use('/api/files', authenticateToken, fileRoutes);
app.use('/api/users', authenticateToken, userRoutes);
app.use('/api/billing', authenticateToken, billingRoutes);
app.use('/api/admin', authenticateToken, adminRoutes);

// OAuth redirect endpoint (for Google Auth)
app.use('/oauth', require('./routes/oauth'));

// Public endpoints (no authentication required)
app.get('/billing/stripe-links', async (req, res) => {
  try {
    const stripeLinks = {
      STRIPE_PRO_MONTHLY_LINK: process.env.STRIPE_PRO_MONTHLY_LINK,
      STRIPE_PRO_YEARLY_LINK: process.env.STRIPE_PRO_YEARLY_LINK,
      STRIPE_PREMIUM_MONTHLY_LINK: process.env.STRIPE_PREMIUM_MONTHLY_LINK,
      STRIPE_PREMIUM_YEARLY_LINK: process.env.STRIPE_PREMIUM_YEARLY_LINK
    };

    // Log the links for debugging (remove in production)
    console.log('Serving Stripe links:', stripeLinks);

    res.json(stripeLinks);
  } catch (error) {
    console.error('Error serving Stripe links:', error);
    res.status(500).json({ error: 'Failed to get Stripe links' });
  }
});

// Create checkout session with return URLs
app.post('/billing/create-checkout', async (req, res) => {
  try {
    const { planId, planName, price, period } = req.body;
    
    // Create checkout link with success/return URLs
    const checkoutData = {
      planId,
      planName,
      price,
      period,
      successUrl: `meetingguardai://payment-success?plan=${planId}&session_id={CHECKOUT_SESSION_ID}`,
      returnUrl: `meetingguardai://payment-return?plan=${planId}`,
      cancelUrl: `meetingguardai://payment-cancel?plan=${planId}`
    };

    res.json({
      success: true,
      checkoutData,
      message: 'Checkout session created successfully'
    });
  } catch (error) {
    console.error('Error creating checkout:', error);
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

// Payment success page - users land here after Stripe payment
app.get('/payment-success', (req, res) => {
  const { plan, session_id } = req.query;
  
  const planNames = {
    'pro_monthly': 'Pro Monthly',
    'pro_yearly': 'Pro Yearly', 
    'premium_monthly': 'Premium Monthly',
    'premium_yearly': 'Premium Yearly'
  };
  
  const planName = planNames[plan] || 'Premium Plan';
  
  const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Payment Successful - MeetingGuard AI</title>
        <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { 
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                min-height: 100vh;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 20px;
            }
            .container {
                background: white;
                border-radius: 20px;
                padding: 40px;
                text-align: center;
                box-shadow: 0 20px 40px rgba(0,0,0,0.1);
                max-width: 500px;
                width: 100%;
            }
            .success-icon {
                width: 80px;
                height: 80px;
                background: #10B981;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                margin: 0 auto 30px;
                font-size: 40px;
                color: white;
            }
            h1 {
                color: #1F2937;
                margin-bottom: 15px;
                font-size: 28px;
            }
            .subtitle {
                color: #6B7280;
                margin-bottom: 30px;
                font-size: 18px;
            }
            .plan-details {
                background: #F3F4F6;
                padding: 20px;
                border-radius: 12px;
                margin-bottom: 30px;
            }
            .plan-name {
                color: #10B981;
                font-weight: bold;
                font-size: 20px;
                margin-bottom: 10px;
            }
            .plan-info {
                color: #6B7280;
                font-size: 16px;
            }
            .return-button {
                background: #10B981;
                color: white;
                padding: 16px 32px;
                border: none;
                border-radius: 12px;
                font-size: 18px;
                font-weight: 600;
                cursor: pointer;
                margin-bottom: 20px;
                width: 100%;
                transition: all 0.3s ease;
            }
            .return-button:hover {
                background: #059669;
                transform: translateY(-2px);
            }
            .app-link {
                background: #3B82F6;
                color: white;
                padding: 16px 32px;
                border: none;
                border-radius: 12px;
                font-size: 18px;
                font-weight: 600;
                cursor: pointer;
                width: 100%;
                text-decoration: none;
                display: inline-block;
                transition: all 0.3s ease;
            }
            .app-link:hover {
                background: #2563EB;
                transform: translateY(-2px);
            }
            .session-id {
                background: #1F2937;
                color: #D1D5DB;
                padding: 8px 16px;
                border-radius: 8px;
                font-family: monospace;
                font-size: 12px;
                margin-bottom: 20px;
                display: inline-block;
            }
            .instructions {
                color: #6B7280;
                font-size: 14px;
                margin-top: 20px;
                line-height: 1.5;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="success-icon">✓</div>
            
            <h1>Payment Successful! 🎉</h1>
            <p class="subtitle">Welcome to ${planName}!</p>
            
            ${session_id ? `<div class="session-id">Session ID: ${session_id}</div>` : ''}
            
            <div class="plan-details">
                <div class="plan-name">${planName}</div>
                <div class="plan-info">You now have access to all premium features!</div>
            </div>
            
            <button class="return-button" onclick="returnToApp()">
                Return to MeetingGuard AI App
            </button>
            
            <a href="meetingguardai://dashboard" class="app-link">
                Open App Directly
            </a>
            
            <p class="instructions">
                If the app doesn't open automatically, tap "Open App Directly" above, 
                or manually return to your MeetingGuard AI app.
            </p>
        </div>
        
        <script>
            function returnToApp() {
                // Try to open the app first
                window.location.href = 'meetingguardai://dashboard';
                
                // Fallback: if app doesn't open, show instructions
                setTimeout(() => {
                    if (document.hidden) return;
                    alert('If the app didn\'t open, please manually return to your MeetingGuard AI app.');
                }, 1000);
            }
            
            // Auto-attempt to open app after 2 seconds
            setTimeout(() => {
                returnToApp();
            }, 2000);
        </script>
    </body>
    </html>
  `;
  
  res.send(html);
});

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

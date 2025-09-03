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

// Simple test endpoint to verify backend is working
app.get('/test', (req, res) => {
  res.json({ 
    message: 'Backend is working!', 
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
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
            .manual-return {
                background: #3B82F6;
                color: white;
                padding: 16px 32px;
                border: none;
                border-radius: 12px;
                font-size: 18px;
                font-weight: 600;
                cursor: pointer;
                width: 100%;
                margin-bottom: 20px;
                transition: all 0.3s ease;
            }
            .manual-return:hover {
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
                background: #FEF3C7;
                border: 1px solid #F59E0B;
                border-radius: 12px;
                padding: 20px;
                margin: 20px 0;
                text-align: left;
            }
            .instructions h3 {
                color: #92400E;
                margin-bottom: 10px;
                font-size: 16px;
            }
            .instructions ol {
                color: #92400E;
                padding-left: 20px;
                line-height: 1.6;
            }
            .instructions li {
                margin-bottom: 8px;
            }
            .close-tab {
                background: #EF4444;
                color: white;
                padding: 12px 24px;
                border: none;
                border-radius: 8px;
                font-size: 14px;
                cursor: pointer;
                margin-top: 10px;
            }
            .close-tab:hover {
                background: #DC2626;
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
            
            <button class="return-button" onclick="attemptReturn()">
                🔄 Try to Return to App
            </button>
            
            <button class="manual-return" onclick="showManualInstructions()">
                📱 Manual Return Instructions
            </button>
            
            <div class="instructions" id="manualInstructions" style="display: none;">
                <h3>📱 How to Return to MeetingGuard AI App:</h3>
                <ol>
                    <li><strong>On Mobile:</strong> Swipe up from bottom (iOS) or press recent apps button (Android)</li>
                    <li><strong>Find MeetingGuard AI</strong> in your recent apps</li>
                    <li><strong>Tap to open</strong> the app</li>
                    <li><strong>Alternative:</strong> Go to your home screen and tap the MeetingGuard AI icon</li>
                </ol>
                <button class="close-tab" onclick="closeTab()">Close This Tab</button>
            </div>
            
            <p style="color: #6B7280; font-size: 14px; margin-top: 20px;">
                Your subscription is now active! You can close this tab and return to your app.
            </p>
        </div>
        
        <script>
            function attemptReturn() {
                // Try multiple deep link formats
                const deepLinks = [
                    'meetingguardai://dashboard',
                    'meetingguardai://',
                    'meetingguard://dashboard',
                    'meetingguard://'
                ];
                
                let attempted = 0;
                const maxAttempts = deepLinks.length;
                
                function tryNextLink() {
                    if (attempted >= maxAttempts) {
                        showManualInstructions();
                        return;
                    }
                    
                    const link = deepLinks[attempted];
                    console.log('Trying deep link:', link);
                    
                    // Try to open the app
                    window.location.href = link;
                    
                    // Wait a bit, then try next link
                    setTimeout(() => {
                        attempted++;
                        tryNextLink();
                    }, 1000);
                }
                
                tryNextLink();
            }
            
            function showManualInstructions() {
                document.getElementById('manualInstructions').style.display = 'block';
            }
            
            function closeTab() {
                window.close();
                // Fallback for browsers that don't allow window.close()
                setTimeout(() => {
                    window.location.href = 'about:blank';
                }, 100);
            }
            
            // Auto-attempt return after 3 seconds
            setTimeout(() => {
                attemptReturn();
            }, 3000);
            
            // Show manual instructions after 8 seconds if still on page
            setTimeout(() => {
                if (!document.hidden) {
                    showManualInstructions();
                }
            }, 8000);
        </script>
    </body>
    </html>
  `;
  
  res.send(html);
});

// Help page for users who can't return to app
app.get('/payment-help', (req, res) => {
  const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Need Help? - MeetingGuard AI</title>
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
            .help-icon {
                width: 80px;
                height: 80px;
                background: #F59E0B;
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
            .steps {
                background: #F3F4F6;
                border-radius: 12px;
                padding: 20px;
                margin: 20px 0;
                text-align: left;
            }
            .step {
                margin-bottom: 15px;
                padding-left: 20px;
                position: relative;
            }
            .step:before {
                content: counter(step-counter);
                counter-increment: step-counter;
                position: absolute;
                left: 0;
                top: 0;
                background: #10B981;
                color: white;
                width: 24px;
                height: 24px;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 12px;
                font-weight: bold;
            }
            .steps {
                counter-reset: step-counter;
            }
            .close-button {
                background: #EF4444;
                color: white;
                padding: 16px 32px;
                border: none;
                border-radius: 12px;
                font-size: 18px;
                font-weight: 600;
                cursor: pointer;
                width: 100%;
                margin-top: 20px;
                transition: all 0.3s ease;
            }
            .close-button:hover {
                background: #DC2626;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="help-icon">❓</div>
            
            <h1>Need Help Returning to App?</h1>
            <p class="subtitle">Here's how to get back to MeetingGuard AI:</p>
            
            <div class="steps">
                <div class="step">
                    <strong>Close this browser tab</strong> - You can close this tab safely
                </div>
                <div class="step">
                    <strong>Go to your home screen</strong> - Press home button or swipe up
                </div>
                <div class="step">
                    <strong>Find MeetingGuard AI</strong> - Look for the app icon
                </div>
                <div class="step">
                    <strong>Tap to open</strong> - Your subscription is already active!
                </div>
            </div>
            
            <p style="color: #6B7280; font-size: 14px; margin: 20px 0;">
                Your payment was successful and your subscription is now active. 
                You can safely close this tab and return to your app.
            </p>
            
            <button class="close-button" onclick="closeTab()">
                Close This Tab
            </button>
        </div>
        
        <script>
            function closeTab() {
                window.close();
                // Fallback
                setTimeout(() => {
                    window.location.href = 'about:blank';
                }, 100);
            }
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

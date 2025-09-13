// Load environment variables FIRST
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const path = require('path');

// Conditional Stripe import - won't crash if package isn't available
let stripe;
try {
  console.log('🔍 Checking Stripe configuration...');
  console.log('🔑 STRIPE_SECRET_KEY exists:', !!process.env.STRIPE_SECRET_KEY);
  console.log('🔑 STRIPE_SECRET_KEY length:', process.env.STRIPE_SECRET_KEY ? process.env.STRIPE_SECRET_KEY.length : 0);
  console.log('🔑 STRIPE_SECRET_KEY starts with sk_:', process.env.STRIPE_SECRET_KEY ? process.env.STRIPE_SECRET_KEY.startsWith('sk_') : false);
  
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error('STRIPE_SECRET_KEY environment variable is not set');
  }
  
  stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
  console.log('✅ Stripe package loaded successfully');
} catch (error) {
  console.log('⚠️ Stripe package not available, webhook functionality will be disabled');
  console.log('❌ Stripe error:', error.message);
  stripe = null;
}

const app = express();
const PORT = process.env.PORT || 3000;

// API Version
const API_VERSION = 'v1';
const API_BASE_PATH = `/api/${API_VERSION}`;

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'", "'unsafe-inline'"], // Allow inline scripts for payment pages
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

// Stripe webhook handler for automatic plan activation
const handleStripeWebhook = async (req, res) => {
  // Check if Stripe is available
  if (!stripe) {
    console.error('Stripe package not available, webhook disabled');
    return res.status(503).json({ error: 'Stripe webhook service unavailable' });
  }

  const sig = req.headers['stripe-signature'];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET || 
                        process.env.STRIPE_WEBHOOK_SECRET_KEY || 
                        process.env.WEBHOOK_SECRET ||
                        'whsec_hkaL8iPNybslJxt2CVYwseM6LfU22mak'; // Fallback for testing

  console.log('Webhook received:', {
    hasSignature: !!sig,
    hasSecret: !!endpointSecret,
    secretLength: endpointSecret ? endpointSecret.length : 0,
    bodyLength: req.body ? req.body.length : 0,
    allEnvVars: Object.keys(process.env).filter(key => key.includes('STRIPE'))
  });

  if (!endpointSecret) {
    console.error('STRIPE_WEBHOOK_SECRET not found in environment variables');
    console.error('Available environment variables:', Object.keys(process.env).filter(key => key.includes('STRIPE')));
    return res.status(500).json({ error: 'Webhook secret not configured' });
  }

  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
    console.log('Webhook event verified successfully:', event.type);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    console.error('Signature:', sig);
    console.error('Secret exists:', !!endpointSecret);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle the event
  switch (event.type) {
    case 'checkout.session.completed':
      const session = event.data.object;
      console.log('Payment succeeded:', session.id);
      
      // Extract plan information from metadata or description
      const planId = session.metadata?.plan_id || 'pro_monthly'; // Default fallback
      const customerEmail = session.customer_details?.email;
      
      if (customerEmail) {
        try {
          // Import supabase instance
          const { supabase } = require('./config/database');
          
          // Check if Supabase is configured
          if (!supabase) {
            console.error('❌ Supabase not configured - cannot save user plan from checkout session');
            return;
          }

          console.log(`🔍 Checkout session - Looking for user with email: ${customerEmail}`);
          console.log(`📋 Plan ID from metadata: ${planId}`);
          
          // Update user's subscription
          const { data: user, error } = await supabase
            .from('users')
            .update({
              plan: planId,
              subscription_status: 'active',
              current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days from now
              updated_at: new Date().toISOString()
            })
            .eq('email', customerEmail)
            .select();

          if (error) {
            console.error('❌ Error updating user subscription from checkout session:', error);
          } else {
            console.log('✅ User subscription updated successfully from checkout session:', user);
            console.log(`📋 Payment successful for plan: ${planId} - User subscription activated`);
          }
        } catch (error) {
          console.error('❌ Error in webhook checkout session update:', error);
        }
      } else {
        console.log('⚠️ No customer email found in checkout session');
      }
      break;
      
    case 'payment_intent.succeeded':
      const paymentIntent = event.data.object;
      console.log('Payment Intent succeeded:', paymentIntent.id);
      console.log('Payment Intent details:', {
        amount: paymentIntent.amount,
        currency: paymentIntent.currency,
        receipt_email: paymentIntent.receipt_email,
        customer: paymentIntent.customer
      });
      
      // For Payment Links, we get the customer email from the payment intent
      const customerEmailFromIntent = paymentIntent.receipt_email;
      
      if (customerEmailFromIntent) {
        try {
          // Import supabase instance
          const { supabase } = require('./config/database');
          
          // Determine plan from amount (you'll need to map your amounts to plans)
          let planId = 'pro_monthly'; // Default
          const amount = paymentIntent.amount;
          
          // Map amounts to plans (adjust these amounts to match your Payment Links)
          // Note: These amounts should match your actual Stripe Payment Link prices
          if (amount === 799) { // $7.99 in cents
            planId = 'pro_monthly';
          } else if (amount === 1499) { // $14.99 in cents
            planId = 'premium_monthly';
          } else if (amount === 7188) { // $71.88 in cents (yearly)
            planId = 'pro_yearly';
          } else if (amount === 13991) { // $139.91 in cents (yearly)
            planId = 'premium_yearly';
          } else if (amount === 13491) { // $134.91 in cents (yearly premium)
            planId = 'premium_yearly';
          } else {
            // Log unknown amount for debugging
            console.log(`Unknown payment amount: ${amount} cents. Using default plan: pro_monthly`);
            planId = 'pro_monthly';
          }
          
          console.log(`Updating user ${customerEmailFromIntent} to plan ${planId} (amount: ${amount})`);
          
          // Check if Supabase is configured
          if (!supabase) {
            console.error('❌ Supabase not configured - cannot save user plan');
            return;
          }

          // First, check if user exists
          console.log(`🔍 Looking for user with email: ${customerEmailFromIntent}`);
          const { data: existingUser, error: findError } = await supabase
            .from('users')
            .select('id, email, name, picture, plan, subscription_status')
            .eq('email', customerEmailFromIntent)
            .single();

          if (findError && findError.code === 'PGRST116') {
            // User not found, create new user with subscription info
            console.log('👤 User not found, creating new user with email:', customerEmailFromIntent);
            
            const { data: newUser, error: createError } = await supabase
              .from('users')
              .insert({
                email: customerEmailFromIntent,
                name: customerEmailFromIntent.split('@')[0], // Use email prefix as name
                plan: planId,
                subscription_status: 'active',
                current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() // 30 days from now
              })
              .select();

            if (createError) {
              console.error('❌ Error creating user:', createError);
            } else {
              console.log('✅ User created successfully:', newUser);
              console.log(`📋 Payment successful for plan: ${planId} - User subscription activated`);
            }
          } else if (findError) {
            console.error('❌ Error finding user:', findError);
          } else {
            // User exists, update their subscription
            console.log('👤 Found existing user:', existingUser);
            console.log(`🔄 Updating user subscription from '${existingUser.plan}' to '${planId}'`);
            
            const { data: user, error } = await supabase
              .from('users')
              .update({
                plan: planId,
                subscription_status: 'active',
                current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days from now
                updated_at: new Date().toISOString()
              })
              .eq('email', customerEmailFromIntent)
              .select();

            if (error) {
              console.error('❌ Error updating user subscription from payment intent:', error);
            } else {
              console.log('✅ User subscription updated successfully from payment intent:', user);
              console.log(`📋 Payment successful for plan: ${planId} - User subscription activated`);
            }
          }
        } catch (error) {
          console.error('Error in webhook payment intent update:', error);
        }
      } else {
        console.log('No customer email found in payment intent');
      }
      break;
      
    case 'invoice.payment_succeeded':
      console.log('Invoice payment succeeded');
      break;
      
    case 'invoice.payment_failed':
      console.log('Invoice payment failed');
      break;
      
    default:
      console.log(`Unhandled event type ${event.type}`);
  }

  res.json({ received: true });
};

// Add error handling for webhook
const handleStripeWebhookWithErrorHandling = async (req, res) => {
  try {
    await handleStripeWebhook(req, res);
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
};

// Stripe webhook routes (MUST be before any body parsing middleware)
app.post('/api/billing/webhook', express.raw({ type: 'application/json' }), handleStripeWebhookWithErrorHandling);
app.post('/webhook', express.raw({ type: 'application/json' }), handleStripeWebhookWithErrorHandling);

// Body parsing middleware (AFTER webhook routes)
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
      'exp://192.168.1.100:8081',
      'exp://192.168.0.100:8081',
      'exp://10.0.2.2:8081',
      'exp://10.0.3.2:8081',
      'meetingguardai://',
      'http://localhost:3000',
      'http://localhost:8081',
      'http://127.0.0.1:3000',
      'http://127.0.0.1:8081'
    ];
    
    // Allow requests with no origin (like mobile apps, Postman, or React Native)
    if (!origin) {
      console.log('CORS: Allowing request with no origin (mobile app)');
      return callback(null, true);
    }
    
    // Check if origin is in allowed list
    if (allowedOrigins.indexOf(origin) !== -1) {
      console.log('CORS: Allowing origin:', origin);
      callback(null, true);
    } else {
      console.log('CORS: Blocked origin:', origin);
      console.log('CORS: Allowed origins:', allowedOrigins);
      // For development, allow all origins
      if (process.env.NODE_ENV === 'development') {
        console.log('CORS: Development mode - allowing all origins');
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    }
  },
  credentials: true,
  optionsSuccessStatus: 200,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
};
app.use(cors(corsOptions));

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Serve delete account page
app.get('/delete-account', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/delete-account.html'));
});

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
    version: process.env.npm_package_version || '1.0.0',
    cors: 'enabled',
    plans_api: 'available'
  });
});

// Simple test endpoint for plans API
app.get('/api/billing/test', (req, res) => {
  res.json({
    message: 'Plans API is working!',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// Test endpoint to manually update user plan (for testing)
app.post('/api/billing/test-update-plan', async (req, res) => {
  try {
    const { email, plan } = req.body;
    
    if (!email || !plan) {
      return res.status(400).json({
        success: false,
        error: 'Email and plan are required'
      });
    }

    const { supabase } = require('./config/database');
    
    if (!supabase) {
      return res.status(500).json({
        success: false,
        error: 'Database not configured'
      });
    }

    console.log(`🧪 Test: Updating user ${email} to plan ${plan}`);
    
    const { data: user, error } = await supabase
      .from('users')
      .update({
        plan: plan,
        subscription_status: 'active',
        current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('email', email)
      .select();

    if (error) {
      console.error('❌ Test update error:', error);
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }

    console.log('✅ Test update successful:', user);
    res.json({
      success: true,
      message: 'Plan updated successfully',
      user: user
    });

  } catch (error) {
    console.error('❌ Test endpoint error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Test endpoint to simulate Google user saving
app.post('/test-google-user-save', async (req, res) => {
  const { google_id, email, name, picture, given_name, family_name } = req.body;
  
  console.log('=== TEST GOOGLE USER SAVE ===');
  console.log('Email:', email);
  console.log('Name:', name);
  console.log('Google ID:', google_id);
  
  if (!email) {
    return res.status(400).json({
      success: false,
      error: 'Email is required'
    });
  }

  try {
    const { supabase } = require('./config/database');
    
    if (!supabase) {
      return res.status(500).json({
        success: false,
        error: 'Database not configured'
      });
    }

    console.log(`🧪 Test: Saving Google user ${email}`);
    
    // Check if user already exists
    const { data: existingUser, error: findError } = await supabase
      .from('users')
      .select('id, email, name, picture')
      .eq('email', email)
      .single();

    let result;
    
    if (findError && findError.code === 'PGRST116') {
      // User not found, create new user
      console.log('👤 User not found, creating new user');
      
      const { data: newUser, error: createError } = await supabase
        .from('users')
        .insert({
          email: email,
          name: name,
          picture: picture
        })
        .select();

      if (createError) {
        console.error('❌ Error creating user:', createError);
        result = { success: false, error: createError.message };
      } else {
        console.log('✅ User created successfully:', newUser);
        result = { success: true, user: newUser, action: 'created' };
      }
    } else if (findError) {
      console.error('❌ Error finding user:', findError);
      result = { success: false, error: findError.message };
    } else {
      // User exists, update their info
      console.log('👤 Found existing user:', existingUser);
      console.log(`🔄 Updating user info`);
      
      const { data: user, error } = await supabase
        .from('users')
        .update({
          name: name,
          picture: picture
        })
        .eq('email', email)
        .select();

      if (error) {
        console.error('❌ Error updating user:', error);
        result = { success: false, error: error.message };
      } else {
        console.log('✅ User updated successfully:', user);
        result = { success: true, user: user, action: 'updated' };
      }
    }

    res.json(result);

  } catch (error) {
    console.error('❌ Test Google user save error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Test endpoint to simulate payment success page
app.get('/test-payment-success', async (req, res) => {
  const { plan, email } = req.query;
  
  console.log('=== TEST PAYMENT SUCCESS ===');
  console.log('Plan:', plan);
  console.log('Email:', email);
  
  if (!plan || !email) {
    return res.status(400).json({
      success: false,
      error: 'Plan and email are required'
    });
  }

  try {
    const { supabase } = require('./config/database');
    
    if (!supabase) {
      return res.status(500).json({
        success: false,
        error: 'Database not configured'
      });
    }

    console.log(`🧪 Test: Simulating payment success for user ${email} with plan ${plan}`);
    
    // First, check if user exists
    const { data: existingUser, error: findError } = await supabase
      .from('users')
      .select('id, email, name, picture, plan, subscription_status')
      .eq('email', email)
      .single();

    let result;
    
    if (findError && findError.code === 'PGRST116') {
      // User not found, create new user with subscription info
      console.log('👤 User not found, creating new user');
      
      const { data: newUser, error: createError } = await supabase
        .from('users')
        .insert({
          email: email,
          name: email.split('@')[0], // Use email prefix as name
          plan: plan,
          subscription_status: 'active',
          current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() // 30 days from now
        })
        .select();

      if (createError) {
        console.error('❌ Error creating user:', createError);
        result = { success: false, error: createError.message };
      } else {
        console.log('✅ User created successfully:', newUser);
        console.log(`📋 Payment successful for plan: ${plan} - User subscription activated`);
        result = { success: true, user: newUser, action: 'created' };
      }
    } else if (findError) {
      console.error('❌ Error finding user:', findError);
      result = { success: false, error: findError.message };
    } else {
      // User exists, update their subscription
      console.log('👤 Found existing user:', existingUser);
      console.log(`🔄 Updating user subscription from '${existingUser.plan}' to '${plan}'`);
      
      const { data: user, error } = await supabase
        .from('users')
        .update({
          plan: plan,
          subscription_status: 'active',
          current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days from now
          updated_at: new Date().toISOString()
        })
        .eq('email', email)
        .select();

      if (error) {
        console.error('❌ Error updating user subscription:', error);
        result = { success: false, error: error.message };
      } else {
        console.log('✅ User subscription updated successfully:', user);
        result = { success: true, user: user, action: 'updated' };
      }
    }

    res.json(result);

  } catch (error) {
    console.error('❌ Test payment success error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Public endpoint to get user plan by email (for webhook-created users)
app.get('/api/billing/user-plan/:email', async (req, res) => {
  try {
    const { email } = req.params;
    
    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Email is required'
      });
    }

    const { supabase } = require('./config/database');
    
    if (!supabase) {
      return res.status(500).json({
        success: false,
        error: 'Database not configured'
      });
    }

    console.log(`🔍 Getting plan for user: ${email}`);
    
    const { data: user, error } = await supabase
      .from('users')
      .select('id, email, name, picture, plan, subscription_status, current_period_end, stripe_customer_id, created_at, updated_at')
      .eq('email', email)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        // User not found, return free plan
        console.log(`👤 User ${email} not found, returning free plan`);
        return res.json({
          success: true,
          subscription: {
            plan: 'free',
            status: 'inactive',
            currentPeriodEnd: null,
            stripeCustomerId: null
          }
        });
      }
      
      console.error('❌ Error fetching user:', error);
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }

    console.log(`✅ Found user: ${user.email} with plan: ${user.plan}`);
    res.json({
      success: true,
      subscription: {
        plan: user.plan || 'free',
        status: user.subscription_status || 'inactive',
        currentPeriodEnd: user.current_period_end,
        stripeCustomerId: user.stripe_customer_id
      }
    });

  } catch (error) {
    console.error('❌ Error in user plan endpoint:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Webhook routes are now defined earlier in the file (before body parsing middleware)

// Public API routes (no authentication required)
app.get('/api/billing/plans', async (req, res) => {
  try {
    console.log('=== PLANS API: Request received ===');
    console.log('Origin:', req.headers.origin);
    console.log('User-Agent:', req.headers['user-agent']);
    console.log('Request IP:', req.ip);
    
    const plans = {
      free: {
        name: 'Free',
        price: '$0',
        period: 'forever',
        features: [
          '5 AI requests per day',
          '5 meeting actions per day',
          'Basic calendar sync',
          'Email support'
        ],
        limits: {
          ai_requests: 5,
          meeting_actions: 5
        },
        checkoutLink: null,
        popular: false
      },
      pro_monthly: {
        name: 'Pro',
        price: '$7.99',
        period: 'month',
        originalPrice: '$7.99',
        features: [
          'Unlimited AI requests',
          'Unlimited meeting actions',
          'Advanced calendar sync',
          'Priority support',
          '7-day free trial'
        ],
        limits: {
          ai_requests: Infinity,
          meeting_actions: Infinity
        },
        checkoutLink: process.env.STRIPE_PRO_MONTHLY_LINK || 'https://buy.stripe.com/test_3cI28s924foc8FN18JgMw02',
        popular: true
      },
      pro_yearly: {
        name: 'Pro',
        price: '$5.99',
        period: 'month',
        originalPrice: '$7.99',
        periodText: 'year',
        totalPrice: '$71.88',
        savings: 'Save 25%',
        features: [
          'Unlimited AI requests',
          'Unlimited meeting actions',
          'Advanced calendar sync',
          'Priority support',
          '7-day free trial',
          '25% annual discount'
        ],
        limits: {
          ai_requests: Infinity,
          meeting_actions: Infinity
        },
        checkoutLink: process.env.STRIPE_PRO_YEARLY_LINK || 'https://buy.stripe.com/test_3cI28s924foc8FN18JgMw02',
        popular: false
      },
      premium_monthly: {
        name: 'Premium',
        price: '$14.99',
        period: 'month',
        originalPrice: '$14.99',
        features: [
          'Everything in Pro',
          'Advanced AI features',
          'Unlimited file storage',
          'Team collaboration',
          'API access',
          '7-day free trial'
        ],
        limits: {
          ai_requests: Infinity,
          meeting_actions: Infinity,
          file_storage: Infinity
        },
        checkoutLink: process.env.STRIPE_PREMIUM_MONTHLY_LINK || 'https://buy.stripe.com/test_3cI28s924foc8FN18JgMw02',
        popular: false
      },
      premium_yearly: {
        name: 'Premium',
        price: '$11.24',
        period: 'month',
        originalPrice: '$14.99',
        periodText: 'year',
        totalPrice: '$134.91',
        savings: 'Save 25%',
        features: [
          'Everything in Pro',
          'Advanced AI features',
          'Unlimited file storage',
          'Team collaboration',
          'API access',
          '7-day free trial',
          '25% annual discount'
        ],
        limits: {
          ai_requests: Infinity,
          meeting_actions: Infinity,
          file_storage: Infinity
        },
        checkoutLink: process.env.STRIPE_PREMIUM_YEARLY_LINK || 'https://buy.stripe.com/test_3cI28s924foc8FN18JgMw02',
        popular: false
      }
    };

    console.log('=== PLANS API: Sending response ===');
    console.log('Plans count:', Object.keys(plans).length);
    
    res.json({
      success: true,
      plans,
      message: 'Subscription plans retrieved successfully',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('=== PLANS API: Error ===');
    console.error('Error fetching plans:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch subscription plans',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// API routes with versioning
app.use(`${API_BASE_PATH}/auth`, authRoutes);
app.use(`${API_BASE_PATH}/meetings`, authenticateToken, meetingRoutes);
app.use(`${API_BASE_PATH}/calendar`, authenticateToken, calendarRoutes);
app.use(`${API_BASE_PATH}/ai`, authenticateToken, aiRoutes);
app.use(`${API_BASE_PATH}/files`, authenticateToken, fileRoutes);
app.use(`${API_BASE_PATH}/users`, authenticateToken, userRoutes);
app.use(`${API_BASE_PATH}/billing`, authenticateToken, billingRoutes);
app.use(`${API_BASE_PATH}/admin`, authenticateToken, adminRoutes);

// Legacy routes (for backward compatibility)
app.use('/api/auth', authRoutes);
app.use('/api/meetings', authenticateToken, meetingRoutes);
app.use('/api/calendar', authenticateToken, calendarRoutes);
app.use('/api/ai', authenticateToken, aiRoutes);
app.use('/api/files', authenticateToken, fileRoutes);
app.use('/api/users', authenticateToken, userRoutes);
app.use('/api/billing', authenticateToken, billingRoutes);
app.use('/api/admin', authenticateToken, adminRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development',
    apiVersion: API_VERSION,
    supportedVersions: ['v1']
  });
});

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
    environment: process.env.NODE_ENV || 'development',
    stripe: stripe ? 'available' : 'unavailable',
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET ? 'configured' : 'missing'
  });
});

// Note: We now use Stripe Payment Links directly from frontend environment variables
// The success URLs are configured in the Stripe Dashboard for each payment link

// Payment success page - users land here after Stripe payment
app.get('/payment-success', async (req, res) => {
  const { plan, session_id, email } = req.query;
  
  console.log('=== PAYMENT SUCCESS PAGE ===');
  console.log('Plan:', plan);
  console.log('Session ID:', session_id);
  console.log('Email:', email);
  console.log('req.query:', req.query);
  
  const planNames = {
    'pro_monthly': 'Pro Monthly',
    'pro_yearly': 'Pro Yearly', 
    'premium_monthly': 'Premium Monthly',
    'premium_yearly': 'Premium Yearly'
  };
  
  const planName = planNames[plan] || 'Premium Plan';
  
  // If we have plan, try to update the user in database
  if (plan) {
    try {
      const { supabase } = require('./config/database');
      
      if (supabase) {
        console.log(`🔄 Processing payment success for plan: ${plan}`);
        console.log(`🆔 Session ID from query: ${session_id || 'Not provided'}`);
        
        let customerEmail = null;
        
        // Try to get customer email from Stripe session if session_id is provided
        if (session_id && session_id !== '{CHECKOUT_SESSION_ID}' && !session_id.includes('{')) {
          try {
            console.log(`🔍 Fetching Stripe session: ${session_id}`);
            
            if (stripe) {
              const stripeSession = await stripe.checkout.sessions.retrieve(session_id);
              customerEmail = stripeSession.customer_details?.email;
              console.log(`📧 Customer email from Stripe session: ${customerEmail || 'Not found'}`);
            } else {
              console.log('⚠️ Stripe not configured - cannot fetch session details');
            }
          } catch (stripeError) {
            console.error('❌ Error fetching Stripe session:', stripeError.message);
          }
        }
        
        // Fallback to email from query parameters if available
        if (!customerEmail && email && email !== '{{CUSTOMER_EMAIL}}' && !email.includes('{{')) {
          customerEmail = email;
          console.log(`📧 Using email from query parameters: ${customerEmail}`);
        }
        
        if (customerEmail) {
          // We have a valid email, proceed with user update
          console.log(`👤 Processing payment for user: ${customerEmail}`);
          
          // First, check if user exists
          const { data: existingUser, error: findError } = await supabase
            .from('users')
            .select('id, email, name, picture, plan, subscription_status')
            .eq('email', customerEmail)
            .single();

          if (findError && findError.code === 'PGRST116') {
            // User not found, create new user with subscription info
            console.log('👤 User not found, creating new user with email:', customerEmail);
            
            const { data: newUser, error: createError } = await supabase
              .from('users')
              .insert({
                email: customerEmail,
                name: customerEmail.split('@')[0], // Use email prefix as name
                plan: plan,
                subscription_status: 'active',
                current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() // 30 days from now
              })
              .select();

            if (createError) {
              console.error('❌ Error creating user from payment success:', createError);
            } else {
              console.log('✅ User created successfully from payment success:', newUser);
              console.log(`📋 Payment successful for plan: ${plan} - User subscription activated`);
            }
          } else if (findError) {
            console.error('❌ Error finding user from payment success:', findError);
          } else {
            // User exists, update their subscription
            console.log('👤 Found existing user:', existingUser);
            console.log(`🔄 Updating user subscription from '${existingUser.plan}' to '${plan}'`);
            
            const { data: user, error: updateError } = await supabase
              .from('users')
              .update({
                plan: plan,
                subscription_status: 'active',
                current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days from now
                updated_at: new Date().toISOString()
              })
              .eq('email', customerEmail)
              .select();

            if (updateError) {
              console.error('❌ Error updating user subscription:', updateError);
            } else {
              console.log('✅ User subscription updated successfully:', user);
              console.log(`📋 Payment successful for plan: ${plan} - User subscription activated`);
            }
          }
        } else {
          // No valid email found, just log the payment success
          console.log(`📋 Payment successful for plan: ${plan}`);
          console.log(`⚠️ No customer email found - user will need to sign in to activate subscription`);
          console.log(`💡 Consider using Stripe webhooks for automatic subscription activation`);
        }
      } else {
        console.error('❌ Supabase not configured - cannot save user from payment success');
      }
    } catch (error) {
      console.error('❌ Error in payment success database update:', error);
    }
  } else {
    console.log('⚠️ Missing plan in payment success query parameters');
  }
  
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
                border-radius: 24px;
                padding: 48px 32px;
                text-align: center;
                box-shadow: 0 25px 50px rgba(0,0,0,0.15);
                max-width: 420px;
                width: 100%;
                position: relative;
                overflow: hidden;
            }
            .container::before {
                content: '';
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                height: 4px;
                background: linear-gradient(90deg, #10B981, #3B82F6);
            }
            .success-icon {
                width: 72px;
                height: 72px;
                background: linear-gradient(135deg, #10B981, #059669);
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                margin: 0 auto 24px;
                font-size: 36px;
                color: white;
                box-shadow: 0 8px 24px rgba(16, 185, 129, 0.3);
            }
            h1 {
                color: #111827;
                margin-bottom: 12px;
                font-size: 32px;
                font-weight: 800;
                letter-spacing: -0.025em;
            }
            .subtitle {
                color: #6B7280;
                margin-bottom: 32px;
                font-size: 18px;
                font-weight: 500;
            }
            .plan-badge {
                background: linear-gradient(135deg, #D1FAE5, #A7F3D0);
                border: 2px solid #10B981;
                border-radius: 16px;
                padding: 16px 24px;
                margin-bottom: 32px;
                display: inline-block;
            }
            .plan-name {
                color: #065F46;
                font-weight: 700;
                font-size: 18px;
                margin-bottom: 4px;
            }
            .plan-info {
                color: #047857;
                font-size: 14px;
                font-weight: 500;
            }
            .countdown-box {
                background: linear-gradient(135deg, #F0F9FF, #E0F2FE);
                border: 2px solid #0EA5E9;
                border-radius: 16px;
                padding: 24px;
                margin-bottom: 24px;
            }
            .countdown-text {
                font-size: 20px;
                font-weight: 700;
                color: #0C4A6E;
                margin-bottom: 8px;
            }
            .countdown-subtitle {
                color: #0369A1;
                font-size: 14px;
                font-weight: 500;
            }
            .countdown-number {
                color: #0EA5E9;
                font-size: 24px;
                font-weight: 800;
            }
            .close-button {
                background: linear-gradient(135deg, #EF4444, #DC2626);
                color: white;
                padding: 16px 32px;
                border: none;
                border-radius: 12px;
                font-size: 16px;
                font-weight: 600;
                cursor: pointer;
                width: 100%;
                transition: all 0.2s ease;
                box-shadow: 0 4px 12px rgba(239, 68, 68, 0.3);
            }
            .close-button:hover {
                transform: translateY(-2px);
                box-shadow: 0 6px 16px rgba(239, 68, 68, 0.4);
            }
            .close-button:active {
                transform: translateY(0);
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="success-icon">✓</div>
            
            <h1>Payment Complete!</h1>
            <p class="subtitle">Welcome to ${planName}</p>
        </div>
        
        <script>
            // Simple redirect that actually works
            setTimeout(function() {
                window.location.href = 'meetingguardai://dashboard';
            }, 3000);
            
            // Countdown timer
            var countdown = 3;
            var countdownElement = document.getElementById('countdown');
            
            var timer = setInterval(function() {
               
                if (countdownElement) {
                    countdownElement.textContent = countdown;
                }
                if (countdown <= 0) {
                    window.close();
                }
                else {
                  countdown--;
                }    
            }, 1000);
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

// Payment cancel page - users land here if they cancel payment
app.get('/payment-cancel', (req, res) => {
  const { plan } = req.query;
  
  const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Payment Cancelled - MeetingGuard AI</title>
        <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { 
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
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
            .cancel-icon {
                width: 80px;
                height: 80px;
                background: #EF4444;
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
            .return-button {
                background: #3B82F6;
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
                background: #2563EB;
                transform: translateY(-2px);
            }
            .close-button {
                background: #6B7280;
                color: white;
                padding: 12px 24px;
                border: none;
                border-radius: 8px;
                font-size: 14px;
                cursor: pointer;
                width: 100%;
                transition: all 0.3s ease;
            }
            .close-button:hover {
                background: #4B5563;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="cancel-icon">✕</div>
            
            <h1>Payment Cancelled</h1>
            <p class="subtitle">No worries! You can try again anytime.</p>
            
            <div style="background: #FEF3C7; border: 1px solid #F59E0B; border-radius: 12px; padding: 20px; margin: 20px 0; text-align: center;">
                <div style="font-size: 18px; font-weight: bold; color: #92400E; margin-bottom: 10px;">
                    ❌ Payment Cancelled! Returning to app in <span id="countdown">3</span> seconds...
                </div>
                <div style="color: #6B7280; font-size: 14px;">
                    You'll be redirected back to your app automatically.
                </div>
            </div>
            
            <div style="background: #F3F4F6; border-radius: 12px; padding: 20px; margin: 20px 0; text-align: left;">
                <h3 style="color: #1F2937; margin-bottom: 15px; font-size: 16px;">📱 How to Return to App:</h3>
                <ol style="color: #6B7280; padding-left: 20px; line-height: 1.6;">
                    <li><strong>On iPhone:</strong> Swipe up from bottom and hold, then find MeetingGuard AI</li>
                    <li><strong>On Android:</strong> Press the square/recent apps button, find MeetingGuard AI</li>
                    <li><strong>Alternative:</strong> Go to your home screen and tap the MeetingGuard AI icon</li>
                </ol>
            </div>
        </div>
        
        <script>
            // Simple redirect that actually works
            setTimeout(function() {
                window.location.href = 'meetingguardai://dashboard';
            }, 3000);
            
            // Countdown timer
            var countdown = 3;
            var countdownElement = document.getElementById('countdown');
            
            var timer = setInterval(function() {
                countdown--;
                if (countdownElement) {
                    countdownElement.textContent = countdown;
                }
                if (countdown <= 0) {
                    clearInterval(timer);
                    if (countdownElement) {
                        countdownElement.textContent = 'Redirecting...';
                    }
                }
            }, 1000);
        </script>
    </body>
    </html>
  `;
  
  res.send(html);
});

// Webhook routes are now defined earlier in the file (before authentication middleware)

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

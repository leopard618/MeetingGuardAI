const express = require('express');
const { body, validationResult } = require('express-validator');
const Stripe = require('stripe');
const { supabase } = require('../config/database');
const { ValidationError } = require('../middleware/errorHandler');

const router = express.Router();
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

// Stripe webhook endpoint secret
const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

// Plan configuration
const STRIPE_PLANS = {
  pro_monthly: {
    priceId: process.env.STRIPE_PRO_MONTHLY_PRICE_ID,
    name: 'Pro Monthly',
    amount: 799, // $7.99
    interval: 'month',
    trialDays: 7
  },
  pro_yearly: {
    priceId: process.env.STRIPE_PRO_YEARLY_PRICE_ID,
    name: 'Pro Yearly',
    amount: 7188, // $71.88 (25% discount)
    interval: 'year',
    trialDays: 7
  },
  premium_monthly: {
    priceId: process.env.STRIPE_PREMIUM_MONTHLY_PRICE_ID,
    name: 'Premium Monthly',
    amount: 1499, // $14.99
    interval: 'month',
    trialDays: 7
  },
  premium_yearly: {
    priceId: process.env.STRIPE_PREMIUM_YEARLY_PRICE_ID,
    name: 'Premium Yearly',
    amount: 13491, // $134.91 (25% discount)
    interval: 'year',
    trialDays: 7
  }
};

/**
 * Create Stripe checkout session
 */
router.post('/create-checkout-session', [
  body('planId').isIn(['pro_monthly', 'pro_yearly', 'premium_monthly', 'premium_yearly']),
  body('successUrl').isURL(),
  body('cancelUrl').isURL()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw new ValidationError('Validation failed', errors.array());
    }

    const { planId, successUrl, cancelUrl } = req.body;
    const userId = req.user.id;

    // Get user details
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('email, name, stripe_customer_id')
      .eq('id', userId)
      .single();

    if (userError) {
      throw new Error('Failed to fetch user details');
    }

    const plan = STRIPE_PLANS[planId];
    if (!plan) {
      throw new Error('Invalid plan ID');
    }

    let customerId = user.stripe_customer_id;

    // Create Stripe customer if doesn't exist
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: user.name,
        metadata: {
          userId: userId
        }
      });
      customerId = customer.id;

      // Update user with Stripe customer ID
      await supabase
        .from('users')
        .update({ stripe_customer_id: customerId })
        .eq('id', userId);
    }

    // Create checkout session
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [{
        price: plan.priceId,
        quantity: 1,
      }],
      mode: 'subscription',
      success_url: successUrl,
      cancel_url: cancelUrl,
      subscription_data: {
        trial_period_days: plan.trialDays,
        metadata: {
          userId: userId,
          planId: planId
        }
      },
      metadata: {
        userId: userId,
        planId: planId
      }
    });

    res.json({
      sessionId: session.id,
      url: session.url
    });

  } catch (error) {
    console.error('Create checkout session error:', error);
    if (error.name === 'ValidationError') {
      res.status(400).json({
        error: error.message,
        details: error.details
      });
    } else {
      res.status(500).json({
        error: 'Failed to create checkout session',
        message: error.message
      });
    }
  }
});

/**
 * Create Stripe billing portal session
 */
router.post('/create-portal-session', [
  body('returnUrl').isURL()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw new ValidationError('Validation failed', errors.array());
    }

    const { returnUrl } = req.body;
    const userId = req.user.id;

    // Get user's Stripe customer ID
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('stripe_customer_id')
      .eq('id', userId)
      .single();

    if (userError || !user.stripe_customer_id) {
      return res.status(400).json({
        error: 'No active subscription found'
      });
    }

    // Create portal session
    const session = await stripe.billingPortal.sessions.create({
      customer: user.stripe_customer_id,
      return_url: returnUrl,
    });

    res.json({
      url: session.url
    });

  } catch (error) {
    console.error('Create portal session error:', error);
    if (error.name === 'ValidationError') {
      res.status(400).json({
        error: error.message,
        details: error.details
      });
    } else {
      res.status(500).json({
        error: 'Failed to create portal session',
        message: error.message
      });
    }
  }
});

/**
 * Get user's subscription status
 */
router.get('/subscription', async (req, res) => {
  try {
    const userId = req.user.id;

    const { data: user, error } = await supabase
      .from('users')
      .select('plan, subscription_status, current_period_end, stripe_customer_id')
      .eq('id', userId)
      .single();

    if (error) {
      throw new Error('Failed to fetch subscription details');
    }

    res.json({
      plan: user.plan || 'free',
      status: user.subscription_status || 'inactive',
      currentPeriodEnd: user.current_period_end,
      hasStripeCustomer: !!user.stripe_customer_id
    });

  } catch (error) {
    console.error('Get subscription error:', error);
    res.status(500).json({
      error: 'Failed to fetch subscription details',
      message: error.message
    });
  }
});

/**
 * Get available plans
 */
router.get('/plans', async (req, res) => {
  try {
    const plans = Object.entries(STRIPE_PLANS).map(([id, plan]) => ({
      id,
      name: plan.name,
      amount: plan.amount,
      interval: plan.interval,
      trialDays: plan.trialDays,
      features: getPlanFeatures(id)
    }));

    res.json({ plans });
  } catch (error) {
    console.error('Get plans error:', error);
    res.status(500).json({
      error: 'Failed to fetch plans',
      message: error.message
    });
  }
});

/**
 * Stripe webhook handler
 */
router.post('/webhook', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(event.data.object);
        break;
      
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event.data.object);
        break;
      
      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object);
        break;
      
      case 'invoice.payment_succeeded':
        await handlePaymentSucceeded(event.data.object);
        break;
      
      case 'invoice.payment_failed':
        await handlePaymentFailed(event.data.object);
        break;
      
      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    res.json({ received: true });
  } catch (error) {
    console.error('Webhook handler error:', error);
    res.status(500).json({ error: 'Webhook handler failed' });
  }
});

/**
 * Handle successful checkout
 */
async function handleCheckoutCompleted(session) {
  const userId = session.metadata.userId;
  const planId = session.metadata.planId;

  if (!userId || !planId) {
    console.error('Missing metadata in checkout session:', session.id);
    return;
  }

  // Update user with subscription details
  await supabase
    .from('users')
    .update({
      plan: planId,
      subscription_status: 'trialing',
      subscription_id: session.subscription
    })
    .eq('id', userId);

  console.log(`Checkout completed for user ${userId}, plan ${planId}`);
}

/**
 * Handle subscription updates
 */
async function handleSubscriptionUpdated(subscription) {
  const customerId = subscription.customer;
  
  // Find user by Stripe customer ID
  const { data: user, error } = await supabase
    .from('users')
    .select('id')
    .eq('stripe_customer_id', customerId)
    .single();

  if (error || !user) {
    console.error('User not found for customer:', customerId);
    return;
  }

  // Determine plan from subscription
  const planId = getPlanIdFromSubscription(subscription);
  
  await supabase
    .from('users')
    .update({
      plan: planId,
      subscription_status: subscription.status,
      subscription_id: subscription.id,
      current_period_end: new Date(subscription.current_period_end * 1000).toISOString()
    })
    .eq('id', user.id);

  console.log(`Subscription updated for user ${user.id}: ${subscription.status}`);
}

/**
 * Handle subscription deletion
 */
async function handleSubscriptionDeleted(subscription) {
  const customerId = subscription.customer;
  
  const { data: user, error } = await supabase
    .from('users')
    .select('id')
    .eq('stripe_customer_id', customerId)
    .single();

  if (error || !user) {
    console.error('User not found for customer:', customerId);
    return;
  }

  await supabase
    .from('users')
    .update({
      plan: 'free',
      subscription_status: 'canceled',
      subscription_id: null,
      current_period_end: null
    })
    .eq('id', user.id);

  console.log(`Subscription canceled for user ${user.id}`);
}

/**
 * Handle successful payment
 */
async function handlePaymentSucceeded(invoice) {
  const customerId = invoice.customer;
  
  const { data: user, error } = await supabase
    .from('users')
    .select('id')
    .eq('stripe_customer_id', customerId)
    .single();

  if (error || !user) {
    console.error('User not found for customer:', customerId);
    return;
  }

  // Update subscription status to active
  await supabase
    .from('users')
    .update({
      subscription_status: 'active'
    })
    .eq('id', user.id);

  console.log(`Payment succeeded for user ${user.id}`);
}

/**
 * Handle failed payment
 */
async function handlePaymentFailed(invoice) {
  const customerId = invoice.customer;
  
  const { data: user, error } = await supabase
    .from('users')
    .select('id')
    .eq('stripe_customer_id', customerId)
    .single();

  if (error || !user) {
    console.error('User not found for customer:', customerId);
    return;
  }

  await supabase
    .from('users')
    .update({
      subscription_status: 'past_due'
    })
    .eq('id', user.id);

  console.log(`Payment failed for user ${user.id}`);
}

/**
 * Get plan ID from Stripe subscription
 */
function getPlanIdFromSubscription(subscription) {
  const priceId = subscription.items.data[0]?.price?.id;
  
  for (const [planId, plan] of Object.entries(STRIPE_PLANS)) {
    if (plan.priceId === priceId) {
      return planId;
    }
  }
  
  return 'free'; // fallback
}

/**
 * Get features for a plan
 */
function getPlanFeatures(planId) {
  const featureMap = {
    free: [
      '5 AI requests per day',
      'Basic meeting management',
      'Google Calendar sync'
    ],
    pro_monthly: [
      'Unlimited AI requests',
      'Advanced meeting features',
      'File attachments',
      'Priority support',
      '7-day free trial'
    ],
    pro_yearly: [
      'Unlimited AI requests',
      'Advanced meeting features', 
      'File attachments',
      'Priority support',
      '25% annual discount',
      '7-day free trial'
    ],
    premium_monthly: [
      'Everything in Pro',
      'Advanced analytics',
      'Custom integrations',
      'Dedicated support',
      '7-day free trial'
    ],
    premium_yearly: [
      'Everything in Pro',
      'Advanced analytics',
      'Custom integrations',
      'Dedicated support',
      '25% annual discount',
      '7-day free trial'
    ]
  };

  return featureMap[planId] || featureMap.free;
}

module.exports = router;

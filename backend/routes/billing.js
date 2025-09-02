const express = require('express');
const { supabase } = require('../config/database');
const router = express.Router();

/**
 * Get available subscription plans with checkout links
 */
router.get('/plans', async (req, res) => {
  try {
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

    res.json({
      success: true,
      plans,
      message: 'Subscription plans retrieved successfully'
    });

  } catch (error) {
    console.error('Error fetching plans:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch subscription plans'
    });
  }
});

/**
 * Get user's current subscription status
 */
router.get('/subscription', async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Get user's current plan and subscription status
    const { data: user, error } = await supabase
      .from('users')
      .select('plan, subscription_status, current_period_end, stripe_customer_id')
      .eq('id', userId)
      .single();

    if (error) {
      throw error;
    }

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
    console.error('Error fetching subscription:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch subscription status'
    });
  }
});

/**
 * Redirect user to Stripe Customer Portal for subscription management
 */
router.post('/customer-portal', async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Get user's Stripe customer ID
    const { data: user, error } = await supabase
      .from('users')
      .select('stripe_customer_id')
      .eq('id', userId)
      .single();

    if (error || !user.stripe_customer_id) {
      return res.status(400).json({
        success: false,
        error: 'No active subscription found'
      });
    }

    // Redirect to Stripe Customer Portal
    const portalUrl = `https://billing.stripe.com/session/${user.stripe_customer_id}`;
    
    res.json({
      success: true,
      portalUrl,
      message: 'Redirecting to customer portal'
    });

  } catch (error) {
    console.error('Error creating customer portal session:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create customer portal session'
    });
  }
});

/**
 * Update user's plan after successful Stripe checkout
 * This endpoint is called by your frontend after user completes checkout
 */
router.post('/update-plan', async (req, res) => {
  try {
    const { plan, stripeCustomerId } = req.body;
    const userId = req.user.id;

    if (!plan || !stripeCustomerId) {
      return res.status(400).json({
        success: false,
        error: 'Plan and Stripe customer ID are required'
      });
    }

    // Update user's plan in database
    const { error } = await supabase
      .from('users')
      .update({
        plan: plan,
        subscription_status: 'active',
        stripe_customer_id: stripeCustomerId,
        current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() // 30 days from now
      })
      .eq('id', userId);

    if (error) {
      throw error;
    }

    res.json({
      success: true,
      message: 'Plan updated successfully',
      plan: plan
    });

  } catch (error) {
    console.error('Error updating plan:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update plan'
    });
  }
});

module.exports = router;

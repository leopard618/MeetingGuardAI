const express = require('express');
const { query, body, validationResult } = require('express-validator');
const { supabase } = require('../config/database');
const { ValidationError } = require('../middleware/errorHandler');
const { adminOnly } = require('../middleware/planGate');

const router = express.Router();

// Apply admin-only middleware to all routes
router.use(adminOnly);

/**
 * Get admin dashboard metrics
 */
router.get('/metrics', async (req, res) => {
  try {
    // Get total users
    const { count: totalUsers, error: usersError } = await supabase
      .from('users')
      .select('*', { count: 'exact', head: true });

    if (usersError) throw usersError;

    // Get active subscriptions
    const { count: activeSubscriptions, error: subsError } = await supabase
      .from('users')
      .select('*', { count: 'exact', head: true })
      .in('subscription_status', ['active', 'trialing']);

    if (subsError) throw subsError;

    // Get users by plan
    const { data: planBreakdown, error: planError } = await supabase
      .from('users')
      .select('plan')
      .not('plan', 'is', null);

    if (planError) throw planError;

    const planCounts = planBreakdown.reduce((acc, user) => {
      acc[user.plan] = (acc[user.plan] || 0) + 1;
      return acc;
    }, {});

    // Get trial users
    const { count: trialUsers, error: trialError } = await supabase
      .from('users')
      .select('*', { count: 'exact', head: true })
      .eq('subscription_status', 'trialing');

    if (trialError) throw trialError;

    // Get today's usage stats
    const today = new Date().toISOString().split('T')[0];
    const { data: todayUsage, error: usageError } = await supabase
      .from('user_usage')
      .select('total_requests, ai_requests, meeting_requests')
      .eq('date', today);

    if (usageError) throw usageError;

    const usageStats = todayUsage.reduce((acc, usage) => {
      acc.totalRequests += usage.total_requests || 0;
      acc.aiRequests += usage.ai_requests || 0;
      acc.meetingRequests += usage.meeting_requests || 0;
      return acc;
    }, { totalRequests: 0, aiRequests: 0, meetingRequests: 0 });

    // Calculate basic MRR (Monthly Recurring Revenue)
    const mrr = calculateMRR(planCounts);

    res.json({
      totalUsers,
      activeSubscriptions,
      trialUsers,
      planBreakdown: planCounts,
      mrr,
      todayUsage: usageStats,
      lastUpdated: new Date().toISOString()
    });

  } catch (error) {
    console.error('Admin metrics error:', error);
    res.status(500).json({
      error: 'Failed to fetch admin metrics',
      message: error.message
    });
  }
});

/**
 * Get users list with pagination and filtering
 */
router.get('/users', [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('search').optional().isString(),
  query('plan').optional().isString(),
  query('status').optional().isString()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw new ValidationError('Validation failed', errors.array());
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    const { search, plan, status } = req.query;

    let query = supabase
      .from('users')
      .select(`
        id,
        email,
        name,
        plan,
        subscription_status,
        enabled,
        created_at,
        last_login,
        stripe_customer_id
      `, { count: 'exact' });

    // Apply filters
    if (search) {
      query = query.or(`email.ilike.%${search}%,name.ilike.%${search}%`);
    }

    if (plan) {
      query = query.eq('plan', plan);
    }

    if (status) {
      query = query.eq('subscription_status', status);
    }

    // Apply pagination
    query = query.range(offset, offset + limit - 1).order('created_at', { ascending: false });

    const { data: users, error, count } = await query;

    if (error) throw error;

    // Get today's usage for each user
    const today = new Date().toISOString().split('T')[0];
    const userIds = users.map(u => u.id);
    
    const { data: usageData, error: usageError } = await supabase
      .from('user_usage')
      .select('user_id, total_requests')
      .eq('date', today)
      .in('user_id', userIds);

    if (usageError) {
      console.error('Error fetching usage data:', usageError);
    }

    // Map usage to users
    const usageMap = (usageData || []).reduce((acc, usage) => {
      acc[usage.user_id] = usage.total_requests;
      return acc;
    }, {});

    const usersWithUsage = users.map(user => ({
      ...user,
      todayUsage: usageMap[user.id] || 0
    }));

    res.json({
      users: usersWithUsage,
      pagination: {
        page,
        limit,
        total: count,
        pages: Math.ceil(count / limit)
      }
    });

  } catch (error) {
    console.error('Admin users list error:', error);
    if (error.name === 'ValidationError') {
      res.status(400).json({
        error: error.message,
        details: error.details
      });
    } else {
      res.status(500).json({
        error: 'Failed to fetch users',
        message: error.message
      });
    }
  }
});

/**
 * Toggle user enabled status
 */
router.post('/users/:userId/toggle-enabled', [
  body('enabled').isBoolean()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw new ValidationError('Validation failed', errors.array());
    }

    const { userId } = req.params;
    const { enabled } = req.body;

    const { data: user, error } = await supabase
      .from('users')
      .update({ enabled })
      .eq('id', userId)
      .select('id, email, enabled')
      .single();

    if (error) throw error;

    res.json({
      message: `User ${enabled ? 'enabled' : 'disabled'} successfully`,
      user
    });

  } catch (error) {
    console.error('Toggle user enabled error:', error);
    if (error.name === 'ValidationError') {
      res.status(400).json({
        error: error.message,
        details: error.details
      });
    } else {
      res.status(500).json({
        error: 'Failed to toggle user status',
        message: error.message
      });
    }
  }
});

/**
 * Get user details with usage history
 */
router.get('/users/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    // Get user details
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();

    if (userError) throw userError;

    // Get user's usage history (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const { data: usageHistory, error: usageError } = await supabase
      .from('user_usage')
      .select('*')
      .eq('user_id', userId)
      .gte('date', thirtyDaysAgo.toISOString().split('T')[0])
      .order('date', { ascending: false });

    if (usageError) {
      console.error('Error fetching usage history:', usageError);
    }

    // Get user's meetings count
    const { count: meetingsCount, error: meetingsError } = await supabase
      .from('meetings')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);

    if (meetingsError) {
      console.error('Error fetching meetings count:', meetingsError);
    }

    res.json({
      user,
      usageHistory: usageHistory || [],
      meetingsCount: meetingsCount || 0
    });

  } catch (error) {
    console.error('Get user details error:', error);
    res.status(500).json({
      error: 'Failed to fetch user details',
      message: error.message
    });
  }
});

/**
 * Update user plan manually (for testing/support)
 */
router.post('/users/:userId/update-plan', [
  body('plan').isIn(['free', 'pro_monthly', 'pro_yearly', 'premium_monthly', 'premium_yearly']),
  body('subscriptionStatus').optional().isIn(['inactive', 'active', 'trialing', 'past_due', 'canceled', 'unpaid'])
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw new ValidationError('Validation failed', errors.array());
    }

    const { userId } = req.params;
    const { plan, subscriptionStatus } = req.body;

    const updateData = { plan };
    if (subscriptionStatus) {
      updateData.subscription_status = subscriptionStatus;
    }

    const { data: user, error } = await supabase
      .from('users')
      .update(updateData)
      .eq('id', userId)
      .select('id, email, plan, subscription_status')
      .single();

    if (error) throw error;

    res.json({
      message: 'User plan updated successfully',
      user
    });

  } catch (error) {
    console.error('Update user plan error:', error);
    if (error.name === 'ValidationError') {
      res.status(400).json({
        error: error.message,
        details: error.details
      });
    } else {
      res.status(500).json({
        error: 'Failed to update user plan',
        message: error.message
      });
    }
  }
});

/**
 * Calculate Monthly Recurring Revenue
 */
function calculateMRR(planCounts) {
  const planPrices = {
    pro_monthly: 7.99,
    pro_yearly: 5.99, // $71.88 / 12 months
    premium_monthly: 14.99,
    premium_yearly: 11.24 // $134.91 / 12 months
  };

  let mrr = 0;
  for (const [plan, count] of Object.entries(planCounts)) {
    if (planPrices[plan]) {
      mrr += planPrices[plan] * count;
    }
  }

  return Math.round(mrr * 100) / 100; // Round to 2 decimal places
}

module.exports = router;

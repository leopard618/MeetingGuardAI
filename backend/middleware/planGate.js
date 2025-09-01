const { supabase } = require('../config/database');

// Plan limits configuration
const PLAN_LIMITS = {
  free: {
    dailyRequests: 5,
    features: ['basic_meetings', 'basic_ai']
  },
  pro_monthly: {
    dailyRequests: -1, // unlimited
    features: ['advanced_meetings', 'advanced_ai', 'calendar_sync', 'file_attachments']
  },
  pro_yearly: {
    dailyRequests: -1, // unlimited
    features: ['advanced_meetings', 'advanced_ai', 'calendar_sync', 'file_attachments']
  },
  premium_monthly: {
    dailyRequests: -1, // unlimited
    features: ['advanced_meetings', 'advanced_ai', 'calendar_sync', 'file_attachments', 'priority_support', 'advanced_analytics']
  },
  premium_yearly: {
    dailyRequests: -1, // unlimited
    features: ['advanced_meetings', 'advanced_ai', 'calendar_sync', 'file_attachments', 'priority_support', 'advanced_analytics']
  }
};

/**
 * Get or create today's usage record for a user
 */
async function getTodayUsage(userId) {
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
  
  const { data: usage, error } = await supabase
    .from('user_usage')
    .select('*')
    .eq('user_id', userId)
    .eq('date', today)
    .single();

  if (error && error.code !== 'PGRST116') { // PGRST116 = no rows returned
    throw error;
  }

  if (!usage) {
    // Create today's usage record
    const { data: newUsage, error: createError } = await supabase
      .from('user_usage')
      .insert({
        user_id: userId,
        date: today,
        ai_requests: 0,
        meeting_requests: 0,
        total_requests: 0
      })
      .select()
      .single();

    if (createError) throw createError;
    return newUsage;
  }

  return usage;
}

/**
 * Increment usage count for a user
 */
async function incrementUsage(userId, requestType = 'total') {
  const today = new Date().toISOString().split('T')[0];
  
  const updateData = {
    total_requests: 1
  };

  if (requestType === 'ai') {
    updateData.ai_requests = 1;
  } else if (requestType === 'meeting') {
    updateData.meeting_requests = 1;
  }

  // Use PostgreSQL's increment functionality
  const { data, error } = await supabase.rpc('increment_usage', {
    p_user_id: userId,
    p_date: today,
    p_ai_requests: updateData.ai_requests || 0,
    p_meeting_requests: updateData.meeting_requests || 0,
    p_total_requests: updateData.total_requests
  });

  if (error) {
    console.error('Error incrementing usage:', error);
    // Fallback to manual increment if RPC fails
    await supabase
      .from('user_usage')
      .upsert({
        user_id: userId,
        date: today,
        ai_requests: updateData.ai_requests || 0,
        meeting_requests: updateData.meeting_requests || 0,
        total_requests: updateData.total_requests
      }, {
        onConflict: 'user_id,date',
        ignoreDuplicates: false
      });
  }

  return data;
}

/**
 * Check if user has access to a feature
 */
function hasFeatureAccess(userPlan, feature) {
  const planConfig = PLAN_LIMITS[userPlan] || PLAN_LIMITS.free;
  return planConfig.features.includes(feature);
}

/**
 * Check if user is within their daily request limit
 */
async function checkDailyLimit(userId, userPlan) {
  const planConfig = PLAN_LIMITS[userPlan] || PLAN_LIMITS.free;
  
  // Unlimited plans
  if (planConfig.dailyRequests === -1) {
    return { allowed: true, remaining: -1 };
  }

  const usage = await getTodayUsage(userId);
  const remaining = planConfig.dailyRequests - usage.total_requests;
  
  return {
    allowed: remaining > 0,
    remaining: Math.max(0, remaining),
    used: usage.total_requests,
    limit: planConfig.dailyRequests
  };
}

/**
 * Middleware to enforce plan limits on API endpoints
 */
const planGate = (options = {}) => {
  const {
    requestType = 'total', // 'ai', 'meeting', or 'total'
    feature = null, // required feature for this endpoint
    skipUsageIncrement = false // set to true for read-only endpoints
  } = options;

  return async (req, res, next) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({
          error: 'Authentication required',
          code: 'AUTH_REQUIRED'
        });
      }

      // Get user's current plan and subscription status
      const { data: user, error: userError } = await supabase
        .from('users')
        .select('plan, subscription_status, enabled')
        .eq('id', userId)
        .single();

      if (userError) {
        console.error('Error fetching user plan:', userError);
        return res.status(500).json({
          error: 'Failed to verify user plan',
          code: 'PLAN_CHECK_FAILED'
        });
      }

      // Check if user is enabled
      if (!user.enabled) {
        return res.status(403).json({
          error: 'Account disabled. Please contact support.',
          code: 'ACCOUNT_DISABLED'
        });
      }

      const userPlan = user.plan || 'free';
      const subscriptionStatus = user.subscription_status || 'inactive';

      // For paid plans, check if subscription is active
      if (userPlan !== 'free' && !['active', 'trialing'].includes(subscriptionStatus)) {
        // Downgrade to free plan behavior
        const effectivePlan = 'free';
        
        // Check feature access with free plan
        if (feature && !hasFeatureAccess(effectivePlan, feature)) {
          return res.status(403).json({
            error: 'This feature requires an active subscription',
            code: 'SUBSCRIPTION_REQUIRED',
            feature: feature,
            userPlan: userPlan,
            subscriptionStatus: subscriptionStatus
          });
        }

        // Check daily limits with free plan
        const limitCheck = await checkDailyLimit(userId, effectivePlan);
        if (!limitCheck.allowed) {
          return res.status(429).json({
            error: 'Daily request limit exceeded. Please upgrade your plan or try again tomorrow.',
            code: 'DAILY_LIMIT_EXCEEDED',
            limit: limitCheck.limit,
            used: limitCheck.used,
            remaining: limitCheck.remaining,
            resetTime: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
          });
        }
      } else {
        // Active subscription or free plan
        // Check feature access
        if (feature && !hasFeatureAccess(userPlan, feature)) {
          return res.status(403).json({
            error: 'This feature is not available in your current plan',
            code: 'FEATURE_NOT_AVAILABLE',
            feature: feature,
            userPlan: userPlan,
            upgradeRequired: true
          });
        }

        // Check daily limits
        const limitCheck = await checkDailyLimit(userId, userPlan);
        if (!limitCheck.allowed) {
          return res.status(429).json({
            error: 'Daily request limit exceeded',
            code: 'DAILY_LIMIT_EXCEEDED',
            limit: limitCheck.limit,
            used: limitCheck.used,
            remaining: limitCheck.remaining,
            resetTime: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
          });
        }
      }

      // Increment usage count (unless skipped)
      if (!skipUsageIncrement) {
        try {
          await incrementUsage(userId, requestType);
        } catch (usageError) {
          console.error('Error incrementing usage:', usageError);
          // Don't block the request if usage tracking fails
        }
      }

      // Add plan info to request object for use in route handlers
      req.userPlan = {
        plan: userPlan,
        subscriptionStatus: subscriptionStatus,
        features: PLAN_LIMITS[userPlan]?.features || PLAN_LIMITS.free.features
      };

      next();
    } catch (error) {
      console.error('Plan gate error:', error);
      res.status(500).json({
        error: 'Failed to verify plan access',
        code: 'PLAN_GATE_ERROR'
      });
    }
  };
};

/**
 * Admin-only middleware
 */
const adminOnly = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({
        error: 'Authentication required',
        code: 'AUTH_REQUIRED'
      });
    }

    const { data: user, error } = await supabase
      .from('users')
      .select('role')
      .eq('id', userId)
      .single();

    if (error) {
      console.error('Error checking admin role:', error);
      return res.status(500).json({
        error: 'Failed to verify admin access',
        code: 'ADMIN_CHECK_FAILED'
      });
    }

    if (user.role !== 'admin') {
      return res.status(403).json({
        error: 'Admin access required',
        code: 'ADMIN_REQUIRED'
      });
    }

    next();
  } catch (error) {
    console.error('Admin check error:', error);
    res.status(500).json({
      error: 'Failed to verify admin access',
      code: 'ADMIN_CHECK_ERROR'
    });
  }
};

module.exports = {
  planGate,
  adminOnly,
  hasFeatureAccess,
  checkDailyLimit,
  getTodayUsage,
  incrementUsage,
  PLAN_LIMITS
};

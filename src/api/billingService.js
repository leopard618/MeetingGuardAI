import { BACKEND_CONFIG, getApiUrl, createAuthHeaders } from '../config/backend';
import { getStoredToken } from './localStorage';

/**
 * Billing Service for Stripe integration
 */
class BillingService {
  /**
   * Get available plans
   */
  async getPlans() {
    try {
      const token = getStoredToken();
      const response = await fetch(getApiUrl('/api/billing/plans'), {
        method: 'GET',
        headers: createAuthHeaders(token),
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch plans: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Get plans error:', error);
      throw error;
    }
  }

  /**
   * Create Stripe checkout session
   */
  async createCheckoutSession(planId, successUrl, cancelUrl) {
    try {
      const token = getStoredToken();
      const response = await fetch(getApiUrl('/api/billing/create-checkout-session'), {
        method: 'POST',
        headers: createAuthHeaders(token),
        body: JSON.stringify({
          planId,
          successUrl,
          cancelUrl
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `Failed to create checkout session: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Create checkout session error:', error);
      throw error;
    }
  }

  /**
   * Create Stripe billing portal session
   */
  async createPortalSession(returnUrl) {
    try {
      const token = getStoredToken();
      const response = await fetch(getApiUrl('/api/billing/create-portal-session'), {
        method: 'POST',
        headers: createAuthHeaders(token),
        body: JSON.stringify({
          returnUrl
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `Failed to create portal session: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Create portal session error:', error);
      throw error;
    }
  }

  /**
   * Get user's subscription status
   */
  async getSubscription() {
    try {
      const token = getStoredToken();
      const response = await fetch(getApiUrl('/api/billing/subscription'), {
        method: 'GET',
        headers: createAuthHeaders(token),
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch subscription: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Get subscription error:', error);
      throw error;
    }
  }

  /**
   * Check if user has access to a feature
   */
  hasFeatureAccess(userPlan, feature) {
    const planFeatures = {
      free: ['basic_meetings', 'basic_ai'],
      pro_monthly: ['basic_meetings', 'basic_ai', 'advanced_meetings', 'advanced_ai', 'calendar_sync', 'file_attachments'],
      pro_yearly: ['basic_meetings', 'basic_ai', 'advanced_meetings', 'advanced_ai', 'calendar_sync', 'file_attachments'],
      premium_monthly: ['basic_meetings', 'basic_ai', 'advanced_meetings', 'advanced_ai', 'calendar_sync', 'file_attachments', 'priority_support', 'advanced_analytics'],
      premium_yearly: ['basic_meetings', 'basic_ai', 'advanced_meetings', 'advanced_ai', 'calendar_sync', 'file_attachments', 'priority_support', 'advanced_analytics']
    };

    const features = planFeatures[userPlan] || planFeatures.free;
    return features.includes(feature);
  }

  /**
   * Get plan display information
   */
  getPlanInfo(planId) {
    const planInfo = {
      free: {
        name: 'Free',
        price: 0,
        interval: null,
        features: [
          '5 AI requests per day',
          'Basic meeting management',
          'Google Calendar sync'
        ]
      },
      pro_monthly: {
        name: 'Pro',
        price: 7.99,
        interval: 'month',
        originalPrice: null,
        features: [
          'Unlimited AI requests',
          'Advanced meeting features',
          'File attachments',
          'Priority support',
          '7-day free trial'
        ]
      },
      pro_yearly: {
        name: 'Pro',
        price: 5.99,
        interval: 'month',
        originalPrice: 7.99,
        yearlyPrice: 71.88,
        features: [
          'Unlimited AI requests',
          'Advanced meeting features',
          'File attachments',
          'Priority support',
          '25% annual discount',
          '7-day free trial'
        ]
      },
      premium_monthly: {
        name: 'Premium',
        price: 14.99,
        interval: 'month',
        originalPrice: null,
        features: [
          'Everything in Pro',
          'Advanced analytics',
          'Custom integrations',
          'Dedicated support',
          '7-day free trial'
        ]
      },
      premium_yearly: {
        name: 'Premium',
        price: 11.24,
        interval: 'month',
        originalPrice: 14.99,
        yearlyPrice: 134.91,
        features: [
          'Everything in Pro',
          'Advanced analytics',
          'Custom integrations',
          'Dedicated support',
          '25% annual discount',
          '7-day free trial'
        ]
      }
    };

    return planInfo[planId] || planInfo.free;
  }

  /**
   * Format price for display
   */
  formatPrice(amount, currency = 'USD') {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency,
    }).format(amount);
  }

  /**
   * Get subscription status display text
   */
  getStatusDisplay(status) {
    const statusMap = {
      active: 'Active',
      trialing: 'Trial',
      past_due: 'Past Due',
      canceled: 'Canceled',
      unpaid: 'Unpaid',
      inactive: 'Inactive'
    };

    return statusMap[status] || 'Unknown';
  }

  /**
   * Check if subscription is active
   */
  isSubscriptionActive(status) {
    return ['active', 'trialing'].includes(status);
  }

  /**
   * Get days remaining in trial
   */
  getTrialDaysRemaining(currentPeriodEnd) {
    if (!currentPeriodEnd) return 0;
    
    const endDate = new Date(currentPeriodEnd);
    const now = new Date();
    const diffTime = endDate - now;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    return Math.max(0, diffDays);
  }
}

export default new BillingService();

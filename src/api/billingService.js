import { apiClient } from './backendService';

/**
 * Billing service for Stripe Checkout Links integration
 * This approach uses pre-built Stripe checkout pages instead of API-based checkout
 */

/**
 * Get available subscription plans
 */
export const getPlans = async () => {
  try {
    const response = await apiClient.get('/billing/plans');
    return response.data;
  } catch (error) {
    console.error('Error fetching plans:', error);
    throw error;
  }
};

/**
 * Get user's current subscription status
 */
export const getSubscription = async () => {
  try {
    const response = await apiClient.get('/billing/subscription');
    return response.data;
  } catch (error) {
    console.error('Error fetching subscription:', error);
    throw error;
  }
};

/**
 * Redirect user to Stripe checkout for a specific plan
 * @param {string} planId - The plan ID (e.g., 'pro_monthly', 'premium_yearly')
 * @param {string} checkoutLink - The Stripe checkout link for the plan
 */
export const redirectToCheckout = (planId, checkoutLink) => {
  if (!checkoutLink) {
    throw new Error('Checkout link not available for this plan');
  }
  
  // Store the plan ID in localStorage for when user returns
  localStorage.setItem('pendingPlan', planId);
  
  // Redirect to Stripe checkout
  window.location.href = checkoutLink;
};

/**
 * Update user's plan after successful checkout
 * This should be called when user returns from Stripe checkout
 * @param {string} planId - The plan ID
 * @param {string} stripeCustomerId - The Stripe customer ID
 */
export const updatePlan = async (planId, stripeCustomerId) => {
  try {
    const response = await apiClient.post('/billing/update-plan', {
      plan: planId,
      stripeCustomerId: stripeCustomerId
    });
    
    // Clear pending plan from localStorage
    localStorage.removeItem('pendingPlan');
    
    return response.data;
  } catch (error) {
    console.error('Error updating plan:', error);
    throw error;
  }
};

/**
 * Get customer portal URL for subscription management
 */
export const getCustomerPortal = async () => {
  try {
    const response = await apiClient.post('/billing/customer-portal');
    return response.data;
  } catch (error) {
    console.error('Error getting customer portal:', error);
    throw error;
  }
};

/**
 * Check if user has a pending plan upgrade
 * This is useful for detecting when user returns from Stripe checkout
 */
export const getPendingPlan = () => {
  return localStorage.getItem('pendingPlan');
};

/**
 * Handle successful checkout return
 * This should be called when user returns from Stripe checkout
 */
export const handleCheckoutReturn = async () => {
  const pendingPlan = getPendingPlan();
  
  if (pendingPlan) {
    // In a real implementation, you would get the Stripe customer ID
    // from the URL parameters or from your backend
    // For now, we'll just clear the pending plan
    localStorage.removeItem('pendingPlan');
    
    // You could also redirect to a success page or update the UI
    console.log(`User returned from checkout for plan: ${pendingPlan}`);
    
    return {
      success: true,
      plan: pendingPlan,
      message: 'Checkout completed successfully!'
    };
  }
  
  return null;
};

/**
 * Check if user can access a specific feature based on their plan
 * @param {string} feature - The feature to check
 * @param {string} userPlan - The user's current plan
 */
export const canAccessFeature = (feature, userPlan) => {
  const planLimits = {
    free: {
      ai_requests: 5,
      meeting_actions: 5,
      file_storage: 5
    },
    pro_monthly: {
      ai_requests: Infinity,
      meeting_actions: Infinity,
      file_storage: Infinity
    },
    pro_yearly: {
      ai_requests: Infinity,
      meeting_actions: Infinity,
      file_storage: Infinity
    },
    premium_monthly: {
      ai_requests: Infinity,
      meeting_actions: Infinity,
      file_storage: Infinity
    },
    premium_yearly: {
      ai_requests: Infinity,
      meeting_actions: Infinity,
      file_storage: Infinity
    }
  };
  
  const plan = planLimits[userPlan] || planLimits.free;
  return plan[feature] === Infinity || plan[feature] > 0;
};

/**
 * Get plan display name
 * @param {string} planId - The plan ID
 */
export const getPlanDisplayName = (planId) => {
  const planNames = {
    free: 'Free',
    pro_monthly: 'Pro Monthly',
    pro_yearly: 'Pro Yearly',
    premium_monthly: 'Premium Monthly',
    premium_yearly: 'Premium Yearly'
  };
  
  return planNames[planId] || 'Unknown Plan';
};

/**
 * Get plan price display
 * @param {string} planId - The plan ID
 */
export const getPlanPrice = (planId) => {
  const planPrices = {
    free: '$0',
    pro_monthly: '$7.99/month',
    pro_yearly: '$5.99/month ($71.88/year)',
    premium_monthly: '$14.99/month',
    premium_yearly: '$11.24/month ($134.91/year)'
  };
  
  return planPrices[planId] || 'Contact us';
};

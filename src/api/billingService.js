// Billing service - Using Google Play Billing for Android
// Replaces Stripe for Google Play Store compliance

import { Platform } from 'react-native';
import googlePlayBillingService from '../services/googlePlayBillingService';

/**
 * Get available subscription plans
 * Uses Google Play Billing on Android, fallback on other platforms
 */
export const getPlans = async () => {
  try {
    // Use Google Play Billing on Android
    if (Platform.OS === 'android') {
      return await googlePlayBillingService.getPlans();
    }
    
    // Fallback for iOS/Web (you can implement Apple IAP later)
    return {
      success: true,
      plans: {
        pro_monthly: {
          id: 'pro_monthly',
          name: 'Pro Monthly',
          price: '$9.99',
          features: ['All Free features', 'Unlimited meetings', 'Priority support']
        },
        pro_yearly: {
          id: 'pro_yearly',
          name: 'Pro Yearly',
          price: '$99.99',
          features: ['All Pro features', 'Save 17%', 'Annual billing']
        },
        premium_monthly: {
          id: 'premium_monthly',
          name: 'Premium Monthly',
          price: '$19.99',
          features: ['All Pro features', 'Advanced AI', 'Custom integrations']
        },
        premium_yearly: {
          id: 'premium_yearly',
          name: 'Premium Yearly',
          price: '$199.99',
          features: ['All Premium features', 'Save 17%', 'Annual billing']
        }
      }
    };
  } catch (error) {
    console.error('Error fetching plans:', error);
    throw error;
  }
};

/**
 * Get user's current subscription status (from Firestore)
 */
export const getSubscription = async () => {
  try {
    // Use Google Play Billing service on Android
    if (Platform.OS === 'android') {
      return await googlePlayBillingService.getSubscription();
    }
    
    // Fallback for other platforms
    const firestoreService = (await import('../services/firestoreService')).default;
    const userId = firestoreService.getCurrentUserId();
    const user = await firestoreService.getUser(userId);
    
    return {
      success: true,
      subscription: {
        plan: user?.plan || 'free',
        status: user?.subscription_status || 'inactive',
        current_period_end: user?.current_period_end || null
      }
    };
  } catch (error) {
    console.error('Error fetching subscription:', error);
    return {
      success: true,
      subscription: {
        plan: 'free',
        status: 'inactive',
        current_period_end: null
      }
    };
  }
};

/**
 * Purchase a subscription plan
 * @param {string} planId - The plan ID (e.g., 'pro_monthly', 'premium_yearly')
 */
export const purchaseSubscription = async (planId) => {
  try {
    if (Platform.OS === 'android') {
      // Use Google Play Billing
      return await googlePlayBillingService.purchaseSubscription(planId);
    } else {
      throw new Error('In-app purchases are only available on Android. iOS support coming soon.');
    }
  } catch (error) {
    console.error('Error purchasing subscription:', error);
    throw error;
  }
};

/**
 * Restore purchases (useful for users who reinstalled the app)
 */
export const restorePurchases = async () => {
  try {
    if (Platform.OS === 'android') {
      return await googlePlayBillingService.restorePurchases();
    } else {
      throw new Error('Restore purchases is only available on Android. iOS support coming soon.');
    }
  } catch (error) {
    console.error('Error restoring purchases:', error);
    throw error;
  }
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

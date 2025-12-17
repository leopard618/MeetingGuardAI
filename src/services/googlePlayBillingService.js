// Google Play Billing Service
// Replaces Stripe with Google Play Billing for Android compliance
// Uses react-native-iap library

import * as RNIap from 'react-native-iap';
import { Platform } from 'react-native';
import firestoreService from './firestoreService';
import { auth } from '../config/firebase';

class GooglePlayBillingService {
  constructor() {
    this.isInitialized = false;
    this.availableProducts = [];
    this.purchaseUpdateSubscription = null;
    this.purchaseErrorSubscription = null;
    
    // Product IDs from environment variables
    this.productIds = {
      pro_monthly: process.env.EXPO_PUBLIC_GOOGLE_PLAY_PRO_MONTHLY_ID || 'pro_monthly',
      pro_yearly: process.env.EXPO_PUBLIC_GOOGLE_PLAY_PRO_YEARLY_ID || 'pro_yearly',
      premium_monthly: process.env.EXPO_PUBLIC_GOOGLE_PLAY_PREMIUM_MONTHLY_ID || 'premium_monthly',
      premium_yearly: process.env.EXPO_PUBLIC_GOOGLE_PLAY_PREMIUM_YEARLY_ID || 'premium_yearly',
    };
  }

  /**
   * Initialize Google Play Billing connection
   */
  async initialize() {
    if (this.isInitialized) {
      return true;
    }

    try {
      // Only initialize on Android
      if (Platform.OS !== 'android') {
        console.log('⚠️ Google Play Billing is only available on Android');
        return false;
      }

      console.log('🔄 Initializing Google Play Billing...');
      
      // Initialize connection
      await RNIap.initConnection();
      this.isInitialized = true;
      console.log('✅ Google Play Billing initialized');

      // Set up purchase listeners
      this.setupPurchaseListeners();

      // Fetch available products
      await this.fetchProducts();

      return true;
    } catch (error) {
      console.error('❌ Error initializing Google Play Billing:', error);
      this.isInitialized = false;
      return false;
    }
  }

  /**
   * Set up purchase update and error listeners
   */
  setupPurchaseListeners() {
    // Listen for purchase updates
    this.purchaseUpdateSubscription = RNIap.purchaseUpdatedListener(
      async (purchase) => {
        console.log('🔄 Purchase updated:', purchase);
        await this.handlePurchase(purchase);
      }
    );

    // Listen for purchase errors
    this.purchaseErrorSubscription = RNIap.purchaseErrorListener(
      (error) => {
        console.error('❌ Purchase error:', error);
        // Handle error (user cancelled, payment failed, etc.)
      }
    );
  }

  /**
   * Fetch available products from Google Play
   */
  async fetchProducts() {
    try {
      const productIdsArray = Object.values(this.productIds);
      console.log('🔄 Fetching products:', productIdsArray);
      
      const products = await RNIap.getProducts(productIdsArray);
      this.availableProducts = products;
      
      console.log('✅ Products fetched:', products);
      return products;
    } catch (error) {
      console.error('❌ Error fetching products:', error);
      throw error;
    }
  }

  /**
   * Get available subscription plans
   */
  async getPlans() {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      // If we have fetched products, use them
      if (this.availableProducts.length > 0) {
        const plans = {};
        
        this.availableProducts.forEach((product) => {
          const planId = this.getPlanIdFromProductId(product.productId);
          if (planId) {
            plans[planId] = {
              id: planId,
              name: product.title || this.getPlanName(planId),
              price: product.localizedPrice || this.getPlanPrice(planId),
              productId: product.productId,
              description: product.description || this.getPlanDescription(planId),
              features: this.getPlanFeatures(planId),
            };
          }
        });

        return { success: true, plans };
      }

      // Fallback to static plans if products not available
      return this.getStaticPlans();
    } catch (error) {
      console.error('Error getting plans:', error);
      // Return static plans as fallback
      return this.getStaticPlans();
    }
  }

  /**
   * Get static plans (fallback)
   */
  getStaticPlans() {
    return {
      success: true,
      plans: {
        pro_monthly: {
          id: 'pro_monthly',
          name: 'Pro Monthly',
          price: '$9.99',
          productId: this.productIds.pro_monthly,
          features: ['All Free features', 'Unlimited meetings', 'Priority support']
        },
        pro_yearly: {
          id: 'pro_yearly',
          name: 'Pro Yearly',
          price: '$99.99',
          productId: this.productIds.pro_yearly,
          features: ['All Pro features', 'Save 17%', 'Annual billing']
        },
        premium_monthly: {
          id: 'premium_monthly',
          name: 'Premium Monthly',
          price: '$19.99',
          productId: this.productIds.premium_monthly,
          features: ['All Pro features', 'Advanced AI', 'Custom integrations']
        },
        premium_yearly: {
          id: 'premium_yearly',
          name: 'Premium Yearly',
          price: '$199.99',
          productId: this.productIds.premium_yearly,
          features: ['All Premium features', 'Save 17%', 'Annual billing']
        }
      }
    };
  }

  /**
   * Purchase a subscription
   */
  async purchaseSubscription(planId) {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      const productId = this.productIds[planId];
      if (!productId) {
        throw new Error(`Product ID not found for plan: ${planId}`);
      }

      console.log('🔄 Requesting purchase for:', productId);

      // Request purchase
      await RNIap.requestPurchase(productId, false); // false = not consumable (subscription)

      // Purchase will be handled by purchaseUpdatedListener
      return { success: true, message: 'Purchase initiated' };
    } catch (error) {
      console.error('❌ Error purchasing subscription:', error);
      throw error;
    }
  }

  /**
   * Handle completed purchase
   */
  async handlePurchase(purchase) {
    try {
      console.log('🔄 Handling purchase:', purchase);

      // Acknowledge purchase
      if (purchase.purchaseStateAndroid === RNIap.PurchaseStateAndroid.PURCHASED) {
        // Finish transaction
        await RNIap.finishTransaction(purchase, false);

        // Update user plan in Firestore
        const planId = this.getPlanIdFromProductId(purchase.productId);
        if (planId) {
          await this.updateUserSubscription(planId, purchase);
        }

        return { success: true, purchase, planId };
      } else {
        console.log('⚠️ Purchase not completed:', purchase.purchaseStateAndroid);
        return { success: false, message: 'Purchase not completed' };
      }
    } catch (error) {
      console.error('❌ Error handling purchase:', error);
      throw error;
    }
  }

  /**
   * Update user subscription in Firestore
   */
  async updateUserSubscription(planId, purchase) {
    try {
      const userId = auth.currentUser?.uid;
      if (!userId) {
        throw new Error('User not authenticated');
      }

      // Normalize plan ID (remove _monthly/_yearly suffix for storage)
      const normalizedPlan = planId.includes('pro') ? 'pro' : 
                            planId.includes('premium') ? 'premium' : 'free';

      // Calculate expiration date
      const expirationDate = new Date();
      if (planId.includes('yearly')) {
        expirationDate.setFullYear(expirationDate.getFullYear() + 1);
      } else {
        expirationDate.setMonth(expirationDate.getMonth() + 1);
      }

      // Update user document
      await firestoreService.saveUser({
        plan: normalizedPlan,
        subscription_status: 'active',
        subscription_provider: 'google_play',
        subscription_product_id: purchase.productId,
        subscription_purchase_token: purchase.purchaseToken,
        subscription_order_id: purchase.orderId,
        current_period_end: expirationDate.toISOString(),
        subscription_started_at: new Date().toISOString(),
      });

      console.log('✅ User subscription updated in Firestore');
    } catch (error) {
      console.error('❌ Error updating user subscription:', error);
      throw error;
    }
  }

  /**
   * Get current subscriptions
   */
  async getCurrentSubscriptions() {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      const subscriptions = await RNIap.getAvailablePurchases();
      return subscriptions;
    } catch (error) {
      console.error('❌ Error getting current subscriptions:', error);
      throw error;
    }
  }

  /**
   * Restore purchases
   */
  async restorePurchases() {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      console.log('🔄 Restoring purchases...');
      const purchases = await this.getCurrentSubscriptions();
      
      if (purchases.length > 0) {
        // Process each purchase
        for (const purchase of purchases) {
          await this.handlePurchase(purchase);
        }
        return { success: true, purchases };
      } else {
        return { success: true, purchases: [], message: 'No purchases found' };
      }
    } catch (error) {
      console.error('❌ Error restoring purchases:', error);
      throw error;
    }
  }

  /**
   * Get user's current subscription status
   */
  async getSubscription() {
    try {
      const firestoreService = (await import('./firestoreService')).default;
      const userId = firestoreService.getCurrentUserId();
      const user = await firestoreService.getUser(userId);
      
      return {
        success: true,
        subscription: {
          plan: user?.plan || 'free',
          status: user?.subscription_status || 'inactive',
          current_period_end: user?.current_period_end || null,
          provider: user?.subscription_provider || null,
        }
      };
    } catch (error) {
      console.error('Error fetching subscription:', error);
      return {
        success: true,
        subscription: {
          plan: 'free',
          status: 'inactive',
          current_period_end: null,
          provider: null,
        }
      };
    }
  }

  /**
   * Helper: Get plan ID from product ID
   */
  getPlanIdFromProductId(productId) {
    for (const [planId, pid] of Object.entries(this.productIds)) {
      if (pid === productId) {
        return planId;
      }
    }
    return null;
  }

  /**
   * Helper: Get plan name
   */
  getPlanName(planId) {
    const names = {
      pro_monthly: 'Pro Monthly',
      pro_yearly: 'Pro Yearly',
      premium_monthly: 'Premium Monthly',
      premium_yearly: 'Premium Yearly',
    };
    return names[planId] || planId;
  }

  /**
   * Helper: Get plan price
   */
  getPlanPrice(planId) {
    const prices = {
      pro_monthly: '$9.99',
      pro_yearly: '$99.99',
      premium_monthly: '$19.99',
      premium_yearly: '$199.99',
    };
    return prices[planId] || 'N/A';
  }

  /**
   * Helper: Get plan description
   */
  getPlanDescription(planId) {
    const descriptions = {
      pro_monthly: 'Best for growing teams',
      pro_yearly: 'Best for growing teams - Annual',
      premium_monthly: 'For enterprise teams',
      premium_yearly: 'For enterprise teams - Annual',
    };
    return descriptions[planId] || '';
  }

  /**
   * Helper: Get plan features
   */
  getPlanFeatures(planId) {
    const features = {
      pro_monthly: ['All Free features', 'Unlimited meetings', 'Priority support'],
      pro_yearly: ['All Pro features', 'Save 17%', 'Annual billing'],
      premium_monthly: ['All Pro features', 'Advanced AI', 'Custom integrations'],
      premium_yearly: ['All Premium features', 'Save 17%', 'Annual billing'],
    };
    return features[planId] || [];
  }

  /**
   * Cleanup: Remove listeners and close connection
   */
  async cleanup() {
    try {
      if (this.purchaseUpdateSubscription) {
        this.purchaseUpdateSubscription.remove();
        this.purchaseUpdateSubscription = null;
      }
      if (this.purchaseErrorSubscription) {
        this.purchaseErrorSubscription.remove();
        this.purchaseErrorSubscription = null;
      }
      if (this.isInitialized) {
        await RNIap.endConnection();
        this.isInitialized = false;
      }
    } catch (error) {
      console.error('Error cleaning up Google Play Billing:', error);
    }
  }
}

export default new GooglePlayBillingService();


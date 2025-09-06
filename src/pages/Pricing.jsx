import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
  Dimensions,
  Linking,
  StatusBar,
  ActivityIndicator
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../contexts/AuthContext';

const { width } = Dimensions.get('window');

const Pricing = () => {
  const { userPlan, isAuthenticated, refreshUserPlan } = useAuth();
  const [billingCycle, setBillingCycle] = useState('monthly');
  const [stripeLinks, setStripeLinks] = useState({});
  const [plans, setPlans] = useState({});
  const [loading, setLoading] = useState(true);

  // Fetch plan data and Stripe links from backend
  useEffect(() => {
    fetchPlanData();
  }, []);

  // Only refresh user plan when user returns to pricing page (minimal calls)
  useFocusEffect(
    React.useCallback(() => {
      // Only refresh if we're not already loading (to avoid conflicts with payment monitoring)
      if (isAuthenticated && !loading) {
        // Use a longer delay to avoid 429 errors
        setTimeout(() => {
          refreshUserPlan(2000); // 2 second delay
        }, 1000);
      }
    }, [isAuthenticated, refreshUserPlan, loading])
  );

  const fetchPlanData = async () => {
    try {
      // Fetching plan data from backend
      
      const backendUrl = process.env.BACKEND_URL;
      if (!backendUrl) {
        throw new Error('Backend URL not configured');
      }
      
      // Fetch plans from backend API
      const plansResponse = await fetch(`${backendUrl}/api/billing/plans`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        }
      });
      
      console.log('Response status:', plansResponse.status);
      console.log('Response ok:', plansResponse.ok);
      
      if (plansResponse.ok) {
        const plansData = await plansResponse.json();
        console.log('✅ Plans data from backend:', plansData);
        
        if (plansData.success && plansData.plans) {
          setPlans(plansData.plans);
          
          // Extract Stripe links from plans data
          const extractedLinks = {};
          Object.entries(plansData.plans).forEach(([planId, plan]) => {
            if (plan.checkoutLink) {
              switch (planId) {
                case 'pro_monthly':
                  extractedLinks.STRIPE_PRO_MONTHLY_LINK = plan.checkoutLink;
                  break;
                case 'pro_yearly':
                  extractedLinks.STRIPE_PRO_YEARLY_LINK = plan.checkoutLink;
                  break;
                case 'premium_monthly':
                  extractedLinks.STRIPE_PREMIUM_MONTHLY_LINK = plan.checkoutLink;
                  break;
                case 'premium_yearly':
                  extractedLinks.STRIPE_PREMIUM_YEARLY_LINK = plan.checkoutLink;
                  break;
              }
            }
          });
          
          console.log('✅ Extracted Stripe links:', extractedLinks);
          setStripeLinks(extractedLinks);
        } else {
          throw new Error('Invalid plans data structure');
        }
      } else {
        const errorText = await plansResponse.text();
        console.error('❌ Backend error response:', errorText);
        throw new Error(`Failed to fetch plans: ${plansResponse.status} - ${errorText}`);
      }
      
    } catch (error) {
      console.error('❌ Error fetching plan data from backend:', error);
      
      // Fallback to static plans and environment variables
      console.log('🔄 Using fallback plan data...');
      
      const fallbackPlans = {
        free: {
          name: 'Free',
          price: '$0',
          period: 'forever',
          description: 'Perfect for getting started',
          features: [
            '5 AI requests per day',
            'Basic meeting management',
            'Standard support',
            '1GB file storage'
          ],
          popular: false
        },
        pro_monthly: {
          name: 'Pro',
          price: '$7.99',
          period: 'month',
          description: 'Best for growing teams',
          features: [
            'Unlimited AI requests',
            'Advanced meeting features',
            'Priority support',
            '10GB file storage',
            'Team collaboration'
          ],
          popular: true
        },
        pro_yearly: {
          name: 'Pro',
          price: '$71.88',
          period: 'year',
          description: 'Best for growing teams',
          features: [
            'Unlimited AI requests',
            'Advanced meeting features',
            'Priority support',
            '10GB file storage',
            'Team collaboration'
          ],
          popular: true,
          savings: 'Save 25%',
          totalPrice: 'Billed annually'
        },
        premium_monthly: {
          name: 'Premium',
          price: '$14.99',
          period: 'month',
          description: 'For enterprise teams',
          features: [
            'Everything in Pro',
            'Unlimited file storage',
            'White-label options',
            'API access',
            'Dedicated support'
          ],
          popular: false
        },
        premium_yearly: {
          name: 'Premium',
          price: '$139.91',
          period: 'year',
          description: 'For enterprise teams',
          features: [
            'Everything in Pro',
            'Unlimited file storage',
            'White-label options',
            'API access',
            'Dedicated support'
          ],
          popular: false,
          savings: 'Save 25%',
          totalPrice: 'Billed annually'
        }
      };
      
      const fallbackLinks = {
        STRIPE_PRO_MONTHLY_LINK: process.env.EXPO_PUBLIC_STRIPE_PRO_MONTHLY_LINK || 'https://buy.stripe.com/test_3cI28s924foc8FN18JgMw02',
        STRIPE_PRO_YEARLY_LINK: process.env.EXPO_PUBLIC_STRIPE_PRO_YEARLY_LINK || 'https://buy.stripe.com/test_3cI28s924foc8FN18JgMw02',
        STRIPE_PREMIUM_MONTHLY_LINK: process.env.EXPO_PUBLIC_STRIPE_PREMIUM_MONTHLY_LINK || 'https://buy.stripe.com/test_3cI28s924foc8FN18JgMw02',
        STRIPE_PREMIUM_YEARLY_LINK: process.env.EXPO_PUBLIC_STRIPE_PREMIUM_YEARLY_LINK || 'https://buy.stripe.com/test_3cI28s924foc8FN18JgMw02'
      };
      
      setPlans(fallbackPlans);
      setStripeLinks(fallbackLinks);
    } finally {
      setLoading(false);
    }
  };

  // Note: We use Stripe Payment Links directly
  // IMPORTANT: To enable auto-return after payment, configure success page in Stripe Dashboard:
  // 1. Go to Stripe Dashboard > Payment Links
  // 2. Edit each payment link
  // 3. Set Success page to: https://meetingguard-backend.onrender.com/payment-success?plan={PLAN_ID}
  // 4. This will redirect users to your success page after payment

  // Plans data is now fetched from backend API

  const handleUpgrade = async (planId, planName, price, period) => {
    try {
      // Get the appropriate Stripe Payment Link
      let paymentLink = '';
      
      switch (planId) {
        case 'pro_monthly':
          paymentLink = stripeLinks.STRIPE_PRO_MONTHLY_LINK;
          break;
        case 'pro_yearly':
          paymentLink = stripeLinks.STRIPE_PRO_YEARLY_LINK;
          break;
        case 'premium_monthly':
          paymentLink = stripeLinks.STRIPE_PREMIUM_MONTHLY_LINK;
          break;
        case 'premium_yearly':
          paymentLink = stripeLinks.STRIPE_PREMIUM_YEARLY_LINK;
          break;
        default:
          throw new Error('Invalid plan selected');
      }
      
      if (!paymentLink) {
        Alert.alert('Plan Unavailable', 'This plan is not available for upgrade');
        return;
      }
      
      console.log('🔄 Opening Stripe Payment Link for:', planId, paymentLink);
      
      // Set loading state to show payment is in progress
      setLoading(true);
      
      // Open Stripe Payment Link in browser
      const supported = await Linking.canOpenURL(paymentLink);
      if (supported) {
        await Linking.openURL(paymentLink);
        
        // Start monitoring for payment completion
        startPaymentMonitoring(planId);
      } else {
        Alert.alert('Error', 'Cannot open payment link');
        setLoading(false);
      }
      
    } catch (error) {
      console.error('Error opening payment link:', error);
      Alert.alert('Error', 'Failed to open payment link. Please try again.');
      setLoading(false);
    }
  };

  // Monitor for payment completion by checking user plan periodically
  const startPaymentMonitoring = (planId) => {
    console.log('🔄 Starting payment monitoring for plan:', planId);
    
    let attempts = 0;
    const maxAttempts = 30; // 30 attempts = 30 seconds max
    const checkInterval = 1000; // Check every 1 second
    
    const paymentMonitor = setInterval(async () => {
      attempts++;
      console.log(`🔍 Payment check attempt ${attempts}/${maxAttempts}`);
      
      try {
        // Make a single API call to check current user plan
        const currentPlan = await refreshUserPlan(0); // No delay for monitoring
        
        // Check if plan has changed to the expected plan
        if (currentPlan === planId || 
            (planId.includes('pro') && currentPlan === 'pro') ||
            (planId.includes('premium') && currentPlan === 'premium')) {
          
          console.log('✅ Payment detected! Plan updated to:', currentPlan);
          clearInterval(paymentMonitor);
          setLoading(false);
          
          // Show success message
          Alert.alert(
            'Payment Successful! 🎉',
            `Welcome to ${planId.replace('_', ' ').toUpperCase()}! Your subscription is now active.`,
            [{ text: 'OK', onPress: () => {
              // Refresh the page to show updated plan status
              fetchPlanData();
            }}]
          );
          
          return;
        }
        
        // If max attempts reached, stop monitoring
        if (attempts >= maxAttempts) {
          console.log('⏰ Payment monitoring timeout - stopping checks');
          clearInterval(paymentMonitor);
          setLoading(false);
          
          Alert.alert(
            'Payment Processing',
            'Your payment is being processed. Please refresh the page in a few moments to see your updated plan.',
            [{ text: 'OK' }]
          );
        }
        
      } catch (error) {
        console.error('❌ Error during payment monitoring:', error);
        
        // If we get 429 error, stop monitoring to avoid more requests
        if (error.message && error.message.includes('429')) {
          console.log('🚫 429 error detected - stopping payment monitoring');
          clearInterval(paymentMonitor);
          setLoading(false);
          
          Alert.alert(
            'Payment Processing',
            'Your payment is being processed. Please wait a moment and refresh the page to see your updated plan.',
            [{ text: 'OK' }]
          );
        }
      }
    }, checkInterval);
    
    // Cleanup function to stop monitoring if component unmounts
    return () => {
      clearInterval(paymentMonitor);
    };
  };

  const getFilteredPlans = () => {
    return Object.entries(plans).filter(([planId, plan]) => {
      if (billingCycle === 'monthly') {
        return planId.includes('monthly') || planId === 'free';
      } else {
        return planId.includes('yearly') || planId === 'free';
      }
    });
  };

  const isCurrentPlan = (planId) => {
    if (!isAuthenticated) return false;

    console.log("[DEBUG] Userplan:", userPlan);
    
    // Handle different plan ID formats
    if (userPlan === 'free' && planId === 'free') return true;
    if (userPlan === 'pro' && (planId === 'pro_monthly' || planId === 'pro_yearly')) return true;
    if (userPlan === 'premium' && (planId === 'premium_monthly' || planId === 'premium_yearly')) return true;
    
    // Direct match for specific plan IDs
    if (userPlan === planId) return true;
    
    return false;
  };

  const getButtonText = (planId) => {
    if (isCurrentPlan(planId)) {
      return 'Current Plan';
    }
    
    // Disable free plan if user has a paid plan
    if (planId === 'free' && (userPlan === 'pro' || userPlan === 'premium')) {
      return 'Downgrade Not Available';
    }
    
    return 'Start 7-Day Trial';
  };

  const getButtonStyle = (planId, plan) => {
    if (isCurrentPlan(planId)) {
      return styles.currentPlanButton;
    }
    
    // Disable free plan if user has a paid plan
    if (planId === 'free' && (userPlan === 'pro' || userPlan === 'premium')) {
      return styles.disabledButton;
    }
    
    return [
      styles.upgradeButton,
      plan.popular && styles.popularUpgradeButton
    ];
  };

  const getButtonTextStyle = (planId) => {
    if (isCurrentPlan(planId)) {
      return styles.currentPlanButtonText;
    }
    
    // Disable free plan if user has a paid plan
    if (planId === 'free' && (userPlan === 'pro' || userPlan === 'premium')) {
      return styles.disabledButtonText;
    }
    
    return styles.upgradeButtonText;
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#3B82F6" />
        <Text style={styles.loadingText}>Loading pricing plans...</Text>
        <Text style={[styles.loadingText, { fontSize: 14, marginTop: 10, textAlign: 'center' }]}>
          Loading pricing plans from backend...
        </Text>
        <TouchableOpacity 
          style={styles.retryButton}
          onPress={() => {
            setLoading(true);
            fetchPlanData();
          }}
        >
          <Ionicons name="refresh" size={20} color="#FFFFFF" />
          <Text style={styles.retryButtonText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />
      
      <ScrollView 
        style={styles.scrollView} 
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {/* Billing Toggle */}
        <View style={styles.billingToggleContainer}>
          <View style={styles.billingToggle}>
            <TouchableOpacity
              style={[
                styles.billingButton,
                billingCycle === 'monthly' && styles.billingButtonActive
              ]}
              onPress={() => setBillingCycle('monthly')}
            >
              <Text style={[
                styles.billingButtonText,
                billingCycle === 'monthly' && styles.billingButtonTextActive
              ]}>
                Monthly
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.billingButton,
                billingCycle === 'yearly' && styles.billingButtonActive
              ]}
              onPress={() => setBillingCycle('yearly')}
            >
              <Text style={[
                styles.billingButtonText,
                billingCycle === 'yearly' && styles.billingButtonTextActive
              ]}>
                Yearly
              </Text>
             
            </TouchableOpacity>
          </View>
        </View>

        {/* Plans Grid */}
        <View style={styles.plansContainer}>
          {getFilteredPlans().map(([planId, plan]) => (
            <View
              key={planId}
              style={[
                styles.planCard,
                plan.popular && styles.popularPlan
              ]}
            >
              {/* Popular Badge */}
              {plan.popular && (
                <View style={styles.popularBadge}>
                  <Ionicons name="star" size={16} color="#FFFFFF" />
                  <Text style={styles.popularBadgeText}>Most Popular</Text>
                </View>
              )}

              <View style={styles.planContent}>
                {/* Plan Header */}
                <View style={styles.planHeader}>
                  <Text style={styles.planName}>{plan.name}</Text>
                  <Text style={styles.planDescription}>{plan.description}</Text>
                  
                  <View style={styles.priceContainer}>
                    <Text style={styles.price}>{plan.price}</Text>
                    {plan.period !== 'forever' && (
                      <Text style={styles.period}>/{plan.period}</Text>
                    )}
                  </View>
                  
                  {/* Yearly Savings */}
                  {plan.savings && (
                    <View style={styles.savingsContainer}>
                      <Ionicons name="trending-up" size={16} color="#10B981" />
                      <Text style={styles.savings}>{plan.savings}</Text>
                    </View>
                  )}
                  
                  {/* Total Yearly Price */}
                  {plan.totalPrice && (
                    <Text style={styles.totalPrice}>{plan.totalPrice}</Text>
                  )}
                  
                  {/* Period Text for yearly plans */}
                  {plan.periodText && (
                    <Text style={styles.periodText}>billed {plan.periodText}ly</Text>
                  )}
                </View>

                {/* Features */}
                <View style={styles.featuresContainer}>
                  {plan.features.map((feature, index) => (
                    <View key={index} style={styles.featureItem}>
                      <View style={styles.featureIconContainer}>
                        <Ionicons name="checkmark-circle" size={20} color="#10B981" />
                      </View>
                      <Text style={styles.featureText}>{feature}</Text>
                    </View>
                  ))}
                </View>

                {/* Action Button */}
                <View style={styles.actionContainer}>
                  {isCurrentPlan(planId) ? (
                    <TouchableOpacity
                      disabled
                      style={styles.currentPlanButton}
                    >
                      <Ionicons name="checkmark-circle" size={20} color="#10B981" />
                      <Text style={styles.currentPlanButtonText}>Current Plan</Text>
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity
                      disabled={planId === 'free' && (userPlan === 'pro' || userPlan === 'premium')}
                      style={getButtonStyle(planId, plan)}
                      onPress={() => handleUpgrade(planId)}
                    >
                      <Text style={getButtonTextStyle(planId)}>
                        {getButtonText(planId)}
                      </Text>
                      {!(planId === 'free' && (userPlan === 'pro' || userPlan === 'premium')) && (
                        <Ionicons name="arrow-forward" size={16} color="#FFFFFF" />
                      )}
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            </View>
          ))}
        </View>

      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 40,
  },
  header: {
    backgroundColor: '#1E293B',
    marginBottom: 32,
    paddingTop: 60,
    paddingBottom: 40,
    paddingHorizontal: 20,
  },
  headerContent: {
    alignItems: 'center',
  },
  iconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#3B82F6',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginBottom: 16,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 16,
    color: '#94A3B8',
    textAlign: 'center',
    lineHeight: 24,
    maxWidth: 300,
  },
  billingToggleContainer: {
    marginTop: 30,
    alignItems: 'center',
    marginBottom: 32,
    paddingHorizontal: 20,
  },
  billingToggle: {
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
    flexDirection: 'row',
  },
  billingButton: {
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 12,
    minWidth: 120,
    alignItems: 'center',
  },
  billingButtonActive: {
    backgroundColor: '#3B82F6',
    shadowColor: '#3B82F6',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  billingButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#94A3B8',
  },
  billingButtonTextActive: {
    color: '#FFFFFF',
  },
  savingsBadge: {
    backgroundColor: '#10B981',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    marginTop: 4,
    flexDirection: 'row',
    alignItems: 'center',
  },
  savingsText: {
    fontSize: 12,
    color: '#FFFFFF',
    fontWeight: '600',
    marginLeft: 4,
  },
  plansContainer: {
    paddingHorizontal: 20,
    marginBottom: 32,
  },
  planCard: {
    backgroundColor: '#1E293B',
    borderRadius: 24,
    marginBottom: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#334155',
  },
  popularPlan: {
    borderWidth: 2,
    borderColor: '#3B82F6',
    transform: [{ scale: 1.02 }],
    shadowColor: '#3B82F6',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 16,
  },
  popularBadge: {
    position: 'absolute',
    top: 16,
    right: 16,
    backgroundColor: '#3B82F6',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#3B82F6',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  popularBadgeText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
    marginLeft: 6,
  },
  planContent: {
    padding: 32,
  },
  planHeader: {
    alignItems: 'center',
    marginBottom: 32,
  },
  planName: {
    fontSize: 28,
    fontWeight: '800',
    color: '#F1F5F9',
    marginBottom: 8,
  },
  planDescription: {
    fontSize: 16,
    color: '#94A3B8',
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 22,
  },
  priceContainer: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginBottom: 16,
  },
  price: {
    fontSize: 48,
    fontWeight: '900',
    color: '#F1F5F9',
  },
  period: {
    fontSize: 20,
    color: '#94A3B8',
    marginLeft: 8,
    fontWeight: '600',
  },
  savingsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#D1FAE5',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    marginBottom: 8,
  },
  savings: {
    fontSize: 14,
    color: '#065F46',
    fontWeight: '700',
    marginLeft: 6,
  },
  totalPrice: {
    fontSize: 14,
    color: '#94A3B8',
    fontWeight: '500',
  },
  periodText: {
    fontSize: 14,
    color: '#94A3B8',
    fontWeight: '500',
    marginTop: 4,
  },
  featuresContainer: {
    marginBottom: 32,
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  featureIconContainer: {
    marginRight: 16,
    marginTop: 2,
  },
  featureText: {
    fontSize: 16,
    color: '#E2E8F0',
    flex: 1,
    lineHeight: 24,
    fontWeight: '500',
  },
  actionContainer: {
    alignItems: 'center',
  },
  upgradeButton: {
    backgroundColor: '#10B981',
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderRadius: 16,
    width: '100%',
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 8,
  },
  popularUpgradeButton: {
    backgroundColor: '#3B82F6',
    shadowColor: '#3B82F6',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 12,
  },
  upgradeButtonText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
    marginRight: 8,
  },
  disabledButton: {
    backgroundColor: '#334155',
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderRadius: 16,
    width: '100%',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#475569',
  },
  disabledButtonText: {
    color: '#64748B',
    fontSize: 18,
    fontWeight: '600',
  },
  currentPlanButton: {
    backgroundColor: '#D1FAE5',
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderRadius: 16,
    width: '100%',
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#10B981',
  },
  currentPlanButtonText: {
    color: '#065F46',
    fontSize: 18,
    fontWeight: '700',
    marginLeft: 8,
  },
  additionalInfo: {
    paddingHorizontal: 20,
  },
  infoCard: {
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 24,
    marginBottom: 16,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
    borderWidth: 1,
    borderColor: '#334155',
  },
  additionalInfoText: {
    fontSize: 16,
    color: '#E2E8F0',
    textAlign: 'center',
    lineHeight: 24,
    marginTop: 12,
    fontWeight: '500',
  },
  supportCard: {
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#334155',
  },
  supportText: {
    fontSize: 14,
    color: '#94A3B8',
    textAlign: 'center',
    marginTop: 8,
    fontWeight: '500',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0F172A',
  },
  loadingText: {
    color: '#94A3B8',
    fontSize: 18,
    marginTop: 10,
  },
  retryButton: {
    backgroundColor: '#3B82F6',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 8,
  },
  retryButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
});

export default Pricing;

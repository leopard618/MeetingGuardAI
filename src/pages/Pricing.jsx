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
import { useAuth } from '../contexts/AuthContext';

const { width } = Dimensions.get('window');

const Pricing = () => {
  const { userPlan, isAuthenticated } = useAuth();
  const [billingCycle, setBillingCycle] = useState('monthly');
  const [stripeLinks, setStripeLinks] = useState({});
  const [loading, setLoading] = useState(true);

  // Fetch real Stripe links from backend environment variables
  useEffect(() => {
    fetchStripeLinks();
  }, []);

  const fetchStripeLinks = async () => {
    try {
      // Use frontend environment variables instead of backend API
      const stripeLinks = {
        STRIPE_PRO_MONTHLY_LINK: process.env.EXPO_PUBLIC_STRIPE_PRO_MONTHLY_LINK || 'https://buy.stripe.com/test_3cI28s924foc8FN18JgMw02',
        STRIPE_PRO_YEARLY_LINK: process.env.EXPO_PUBLIC_STRIPE_PRO_YEARLY_LINK || 'https://buy.stripe.com/test_3cI28s924foc8FN18JgMw02',
        STRIPE_PREMIUM_MONTHLY_LINK: process.env.EXPO_PUBLIC_STRIPE_PREMIUM_MONTHLY_LINK || 'https://buy.stripe.com/test_3cI28s924foc8FN18JgMw02',
        STRIPE_PREMIUM_YEARLY_LINK: process.env.EXPO_PUBLIC_STRIPE_PREMIUM_YEARLY_LINK || 'https://buy.stripe.com/test_3cI28s924foc8FN18JgMw02'
      };
      
      console.log('✅ Using frontend environment variables for Stripe links:', stripeLinks);
      setStripeLinks(stripeLinks);
      
    } catch (error) {
      console.error('❌ Error setting Stripe links:', error);
      
      // Fallback to default links if environment variables fail
      const fallbackLinks = {
        STRIPE_PRO_MONTHLY_LINK: 'https://buy.stripe.com/test_3cI28s924foc8FN18JgMw02',
        STRIPE_PRO_YEARLY_LINK: 'https://buy.stripe.com/test_3cI28s924foc8FN18JgMw02',
        STRIPE_PREMIUM_MONTHLY_LINK: 'https://buy.stripe.com/test_3cI28s924foc8FN18JgMw02',
        STRIPE_PREMIUM_YEARLY_LINK: 'https://buy.stripe.com/test_3cI28s924foc8FN18JgMw02'
      };
      
      console.log('🔄 Using fallback Stripe links:', fallbackLinks);
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

  // Plans data with dynamic checkout links from backend
  const plans = {
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
      
      // Open Stripe Payment Link in browser
      const supported = await Linking.canOpenURL(paymentLink);
      if (supported) {
        await Linking.openURL(paymentLink);
      } else {
        Alert.alert('Error', 'Cannot open payment link');
      }
      
    } catch (error) {
      console.error('Error opening payment link:', error);
      Alert.alert('Error', 'Failed to open payment link. Please try again.');
    }
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
    return 'Start 7-Day Trial';
  };

  const getButtonStyle = (planId, plan) => {
    if (isCurrentPlan(planId)) {
      return styles.currentPlanButton;
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
    return styles.upgradeButtonText;
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#3B82F6" />
        <Text style={styles.loadingText}>Loading pricing plans...</Text>
        <Text style={[styles.loadingText, { fontSize: 14, marginTop: 10, textAlign: 'center' }]}>
          Loading pricing plans from environment variables...
        </Text>
        <TouchableOpacity 
          style={styles.retryButton}
          onPress={() => {
            setLoading(true);
            fetchStripeLinks();
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
                    <Text style={styles.totalPrice}>{plan.totalPrice} billed annually</Text>
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
                      style={getButtonStyle(planId, plan)}
                      onPress={() => handleUpgrade(planId)}
                    >
                      <Text style={getButtonTextStyle(planId)}>
                        {getButtonText(planId)}
                      </Text>
                      <Ionicons name="arrow-forward" size={16} color="#FFFFFF" />
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

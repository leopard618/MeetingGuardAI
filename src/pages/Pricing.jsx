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

const { width } = Dimensions.get('window');

const Pricing = () => {
  const [billingCycle, setBillingCycle] = useState('monthly');
  const [stripeLinks, setStripeLinks] = useState({});
  const [loading, setLoading] = useState(true);

  // Fetch real Stripe links from backend environment variables
  useEffect(() => {
    fetchStripeLinks();
  }, []);

  const fetchStripeLinks = async () => {
    try {
      const baseUrl = 'https://meetingguard-backend.onrender.com'; // Hardcoded for now
      console.log('🔄 Attempting to fetch Stripe links from:', baseUrl);
      
      // Add timeout to the fetch request
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        console.log('⏰ Request timed out after 10 seconds');
        controller.abort();
      }, 10000); // 10 second timeout
      
      const response = await fetch(`${baseUrl}/billing/stripe-links`, {
        signal: controller.signal,
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        }
      });
      
      clearTimeout(timeoutId);
      
      if (response.ok) {
        const data = await response.json();
        console.log('✅ Successfully fetched Stripe links:', data);
        setStripeLinks(data);
      } else {
        console.error('❌ Failed to fetch Stripe links:', response.status, response.statusText);
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
    } catch (error) {
      console.error('❌ Error fetching Stripe links:', error);
      
      if (error.name === 'AbortError') {
        console.log('⏰ Request timed out, using fallback links');
      }
      
      // Fallback to default links if API fails
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

  // Function to create checkout links with success URLs
  const createCheckoutLink = (planId, planName, price, period) => {
    const baseUrl = 'https://meetingguard-backend.onrender.com';
    const successUrl = `${baseUrl}/payment-success?plan=${planId}`;
    
    // Get the base Stripe link
    let stripeLink = '';
    switch (planId) {
      case 'pro_monthly':
        stripeLink = stripeLinks.STRIPE_PRO_MONTHLY_LINK || 'https://buy.stripe.com/test_3cI28s924foc8FN18JgMw02';
        break;
      case 'pro_yearly':
        stripeLink = stripeLinks.STRIPE_PRO_YEARLY_LINK || 'https://buy.stripe.com/test_3cI28s924foc8FN18JgMw02';
        break;
      case 'premium_monthly':
        stripeLink = stripeLinks.STRIPE_PREMIUM_MONTHLY_LINK || 'https://buy.stripe.com/test_3cI28s924foc8FN18JgMw02';
        break;
      case 'premium_yearly':
        stripeLink = stripeLinks.STRIPE_PREMIUM_YEARLY_LINK || 'https://buy.stripe.com/test_3cI28s924foc8FN18JgMw02';
        break;
      default:
        stripeLink = 'https://buy.stripe.com/test_3cI28s924foc8FN18JgMw02';
    }
    
    // Add success URL as a parameter to the Stripe link
    const separator = stripeLink.includes('?') ? '&' : '?';
    return `${stripeLink}${separator}success_url=${encodeURIComponent(successUrl)}`;
  };

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
      popular: true,
      get checkoutLink() {
        return createCheckoutLink('pro_monthly', 'Pro Monthly', '$7.99', 'month');
      }
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
      totalPrice: 'Billed annually',
      get checkoutLink() {
        return createCheckoutLink('pro_yearly', 'Pro Yearly', '$71.88', 'year');
      }
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
      popular: false,
      get checkoutLink() {
        return createCheckoutLink('premium_monthly', 'Premium Monthly', '$14.99', 'month');
      }
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
      totalPrice: 'Billed annually',
      get checkoutLink() {
        return createCheckoutLink('premium_yearly', 'Premium Yearly', '$139.91', 'year');
      }
    }
  };

  const handleUpgrade = async (planId, checkoutLink) => {
    if (!checkoutLink) {
      Alert.alert('Plan Unavailable', 'This plan is not available for upgrade');
      return;
    }

    try {
      const supported = await Linking.canOpenURL(checkoutLink);
      if (supported) {
        await Linking.openURL(checkoutLink);
      } else {
        Alert.alert('Error', 'Cannot open checkout link');
      }
    } catch (error) {
      console.error('Error redirecting to checkout:', error);
      Alert.alert('Error', 'Error redirecting to checkout. Please try again.');
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

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#3B82F6" />
        <Text style={styles.loadingText}>Loading pricing plans...</Text>
        <Text style={[styles.loadingText, { fontSize: 14, marginTop: 10, textAlign: 'center' }]}>
          If this takes too long, the backend might be deploying...
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
        {/* Header Section */}
        <View style={styles.header}>
          <View style={styles.headerContent}>
            <View style={styles.iconContainer}>
              <Ionicons name="diamond" size={32} color="#FFFFFF" />
            </View>
            <Text style={styles.title}>Choose Your Plan</Text>
            <Text style={styles.subtitle}>
              Start with our free plan and upgrade as you grow. All paid plans include a 7-day free trial.
            </Text>
          </View>
        </View>

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
              <View style={styles.savingsBadge}>
                <Ionicons name="star" size={12} color="#FFFFFF" />
                <Text style={styles.savingsText}>Save 25%</Text>
              </View>
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
                  {planId === 'free' ? (
                    <TouchableOpacity
                      disabled
                      style={styles.disabledButton}
                    >
                      <Text style={styles.disabledButtonText}>Current Plan</Text>
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity
                      style={[
                        styles.upgradeButton,
                        plan.popular && styles.popularUpgradeButton
                      ]}
                      onPress={() => handleUpgrade(planId, plan.checkoutLink)}
                    >
                      <Text style={styles.upgradeButtonText}>
                        Start 7-Day Trial
                      </Text>
                      <Ionicons name="arrow-forward" size={16} color="#FFFFFF" />
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            </View>
          ))}
        </View>

        {/* Additional Info */}
        <View style={styles.additionalInfo}>
          <View style={styles.infoCard}>
            <Ionicons name="shield-checkmark" size={24} color="#10B981" />
            <Text style={styles.additionalInfoText}>
              All plans include a 7-day free trial. Cancel anytime during the trial period.
            </Text>
          </View>
          
          <View style={styles.supportCard}>
            <Ionicons name="help-circle" size={20} color="#6B7280" />
            <Text style={styles.supportText}>
              Need help choosing? Contact our support team
            </Text>
          </View>
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

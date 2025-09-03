import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
  ActivityIndicator,
  Dimensions,
  Linking
} from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import { getPlans, redirectToCheckout, getSubscription } from '../api/billingService';
import { Ionicons } from '@expo/vector-icons';

const { width } = Dimensions.get('window');

const Pricing = () => {
  const [plans, setPlans] = useState(null);
  const [loading, setLoading] = useState(true);
  const [billingCycle, setBillingCycle] = useState('monthly');
  const [userSubscription, setUserSubscription] = useState(null);
  const { user } = useAuth();

  useEffect(() => {
    loadPlans();
    if (user) {
      loadUserSubscription();
    }
  }, [user]);

  const loadPlans = async () => {
    try {
      const response = await getPlans();
      setPlans(response.plans);
    } catch (error) {
      console.error('Error loading plans:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadUserSubscription = async () => {
    try {
      const response = await getSubscription();
      setUserSubscription(response.subscription);
    } catch (error) {
      console.error('Error loading subscription:', error);
    }
  };

  const handleUpgrade = async (planId, checkoutLink) => {
    if (!checkoutLink) {
      Alert.alert('Plan Unavailable', 'This plan is not available for upgrade');
      return;
    }

    try {
      // For React Native, we need to use Linking to open URLs
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

  const getCurrentPlan = () => {
    if (!userSubscription) return 'free';
    return userSubscription.plan;
  };

  const isCurrentPlan = (planId) => {
    return getCurrentPlan() === planId;
  };

  const getFilteredPlans = () => {
    if (!plans) return [];
    
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
        <Text style={styles.loadingText}>Loading plans...</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Choose Your Plan</Text>
        <Text style={styles.subtitle}>
          Start with our free plan and upgrade as you grow. All paid plans include a 7-day free trial.
        </Text>
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
              plan.popular && styles.popularPlan,
              isCurrentPlan(planId) && styles.currentPlan
            ]}
          >
            {/* Popular Badge */}
            {plan.popular && (
              <View style={styles.popularBadge}>
                <Text style={styles.popularBadgeText}>Most Popular</Text>
              </View>
            )}

            {/* Current Plan Badge */}
            {isCurrentPlan(planId) && (
              <View style={styles.currentPlanBadge}>
                <Text style={styles.currentPlanBadgeText}>Current Plan</Text>
              </View>
            )}

            <View style={styles.planContent}>
              {/* Plan Header */}
              <View style={styles.planHeader}>
                <Text style={styles.planName}>{plan.name}</Text>
                <View style={styles.priceContainer}>
                  <Text style={styles.price}>{plan.price}</Text>
                  {plan.period !== 'forever' && (
                    <Text style={styles.period}>/{plan.period}</Text>
                  )}
                </View>
                
                {/* Yearly Savings */}
                {plan.savings && (
                  <Text style={styles.savings}>{plan.savings}</Text>
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
                    <Ionicons name="checkmark-circle" size={20} color="#10B981" style={styles.featureIcon} />
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
                ) : isCurrentPlan(planId) ? (
                  <TouchableOpacity
                    disabled
                    style={styles.currentPlanButton}
                  >
                    <Text style={styles.currentPlanButtonText}>Current Plan</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity
                    style={styles.upgradeButton}
                    onPress={() => handleUpgrade(planId, plan.checkoutLink)}
                  >
                    <Text style={styles.upgradeButtonText}>Start 7-Day Trial</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          </View>
        ))}
      </View>

      {/* Additional Info */}
      <View style={styles.additionalInfo}>
        <Text style={styles.additionalInfoText}>
          All plans include a 7-day free trial. Cancel anytime during the trial period.
        </Text>
        <Text style={styles.supportText}>
          Need help choosing? Contact our support team
        </Text>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#64748B',
  },
  header: {
    alignItems: 'center',
    paddingVertical: 48,
    paddingHorizontal: 16,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#1E293B',
    marginBottom: 16,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 18,
    color: '#64748B',
    textAlign: 'center',
    maxWidth: 600,
    lineHeight: 24,
  },
  billingToggleContainer: {
    alignItems: 'center',
    marginBottom: 32,
  },
  billingToggle: {
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    padding: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  billingButton: {
    paddingHorizontal: 24,
    paddingVertical: 8,
    borderRadius: 6,
  },
  billingButtonActive: {
    backgroundColor: '#3B82F6',
  },
  billingButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6B7280',
  },
  billingButtonTextActive: {
    color: '#FFFFFF',
  },
  savingsBadge: {
    backgroundColor: '#D1FAE5',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
    marginTop: 4,
  },
  savingsText: {
    fontSize: 12,
    color: '#065F46',
    fontWeight: '600',
  },
  plansContainer: {
    paddingHorizontal: 16,
    paddingBottom: 32,
  },
  planCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    marginBottom: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
    overflow: 'hidden',
  },
  popularPlan: {
    borderWidth: 2,
    borderColor: '#3B82F6',
    transform: [{ scale: 1.02 }],
  },
  currentPlan: {
    borderWidth: 2,
    borderColor: '#10B981',
  },
  popularBadge: {
    position: 'absolute',
    top: 0,
    right: 0,
    backgroundColor: '#3B82F6',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderBottomLeftRadius: 8,
  },
  popularBadgeText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },
  currentPlanBadge: {
    position: 'absolute',
    top: 0,
    left: 0,
    backgroundColor: '#10B981',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderBottomRightRadius: 8,
  },
  currentPlanBadgeText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },
  planContent: {
    padding: 32,
  },
  planHeader: {
    alignItems: 'center',
    marginBottom: 24,
  },
  planName: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#1E293B',
    marginBottom: 8,
  },
  priceContainer: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginBottom: 16,
  },
  price: {
    fontSize: 36,
    fontWeight: 'bold',
    color: '#1E293B',
  },
  period: {
    fontSize: 18,
    color: '#6B7280',
    marginLeft: 4,
  },
  savings: {
    fontSize: 14,
    color: '#059669',
    fontWeight: '600',
  },
  totalPrice: {
    fontSize: 14,
    color: '#6B7280',
    marginTop: 4,
  },
  featuresContainer: {
    marginBottom: 32,
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  featureIcon: {
    marginRight: 12,
    marginTop: 2,
  },
  featureText: {
    fontSize: 16,
    color: '#374151',
    flex: 1,
    lineHeight: 22,
  },
  actionContainer: {
    alignItems: 'center',
  },
  upgradeButton: {
    backgroundColor: '#3B82F6',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    width: '100%',
    alignItems: 'center',
  },
  upgradeButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  disabledButton: {
    backgroundColor: '#F3F4F6',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    width: '100%',
    alignItems: 'center',
  },
  disabledButtonText: {
    color: '#9CA3AF',
    fontSize: 16,
    fontWeight: '600',
  },
  currentPlanButton: {
    backgroundColor: '#D1FAE5',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    width: '100%',
    alignItems: 'center',
  },
  currentPlanButtonText: {
    color: '#065F46',
    fontSize: 16,
    fontWeight: '600',
  },
  additionalInfo: {
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 48,
  },
  additionalInfoText: {
    fontSize: 16,
    color: '#64748B',
    textAlign: 'center',
    marginBottom: 16,
    lineHeight: 24,
  },
  supportText: {
    fontSize: 14,
    color: '#9CA3AF',
    textAlign: 'center',
  },
});

export default Pricing;

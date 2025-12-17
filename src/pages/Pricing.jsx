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
import { useAuth } from '../contexts/AuthContext.jsx';
import { useTranslation } from '../components/translations.jsx';

const { width } = Dimensions.get('window');

const Pricing = ({ language = 'en' }) => {
  const { userPlan, isAuthenticated, refreshUserPlan } = useAuth();
  const { t } = useTranslation(language);
  const [billingCycle, setBillingCycle] = useState('monthly');
  const [plans, setPlans] = useState({});
  const [loading, setLoading] = useState(true);
  const [purchasing, setPurchasing] = useState(false);

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
      setLoading(true);
      // Fetching plan data from billing service (Google Play Billing)
      const { getPlans } = await import('../api/billingService');
      const plansData = await getPlans();
      
      console.log('✅ Plans data:', plansData);
      
      if (plansData.success && plansData.plans) {
        // Convert plans to the format expected by the UI
        const formattedPlans = {};
        Object.entries(plansData.plans).forEach(([planId, plan]) => {
          formattedPlans[planId] = {
            name: plan.name || plan.id,
            price: plan.price || '$0',
            period: planId.includes('yearly') ? 'year' : planId.includes('monthly') ? 'month' : 'forever',
            description: plan.description || getPlanDescription(planId),
            features: plan.features || [],
            popular: planId === 'pro_monthly' || planId === 'pro_yearly',
            productId: plan.productId,
          };
          
          if (planId.includes('yearly')) {
            formattedPlans[planId].savings = 'Save 17%';
            formattedPlans[planId].totalPrice = 'Billed annually';
          }
        });
        
        // Add free plan
        formattedPlans.free = {
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
        };
        
        setPlans(formattedPlans);
      } else {
        throw new Error('Invalid plans data structure');
      }
    } catch (error) {
      console.error('❌ Error fetching plan data:', error);
      
      // Fallback to static plans
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
          price: '$9.99',
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
          price: '$99.99',
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
          savings: 'Save 17%',
          totalPrice: 'Billed annually'
        },
        premium_monthly: {
          name: 'Premium',
          price: '$19.99',
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
          price: '$199.99',
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
          savings: 'Save 17%',
          totalPrice: 'Billed annually'
        }
      };
      
      setPlans(fallbackPlans);
    } finally {
      setLoading(false);
    }
  };

  // Handle subscription purchase using Google Play Billing
  const handleUpgrade = async (planId) => {
    if (!isAuthenticated) {
      Alert.alert('Authentication Required', 'Please sign in to upgrade your plan.');
      return;
    }

    if (planId === 'free') {
      Alert.alert('Free Plan', 'You are already on the free plan.');
      return;
    }

    try {
      setPurchasing(true);
      console.log('🔄 Purchasing subscription:', planId);
      
      // Import billing service
      const { purchaseSubscription } = await import('../api/billingService');
      
      // Initiate purchase
      const result = await purchaseSubscription(planId);
      
      if (result.success) {
        // Purchase initiated - Google Play Billing will handle the rest
        // The purchase will be processed by the purchaseUpdatedListener in googlePlayBillingService
        console.log('✅ Purchase initiated successfully');
        
        // Wait a moment for purchase to complete, then refresh
        setTimeout(async () => {
          await refreshUserPlan(1000);
          setPurchasing(false);
          Alert.alert(
            'Purchase Initiated',
            'Please complete the purchase in the Google Play dialog. Your subscription will be activated once payment is confirmed.',
            [{ text: 'OK', onPress: () => fetchPlanData() }]
          );
        }, 500);
      }
    } catch (error) {
      console.error('❌ Error purchasing subscription:', error);
      setPurchasing(false);
      
      let errorMessage = 'Failed to initiate purchase. Please try again.';
      if (error.message) {
        if (error.message.includes('User cancelled')) {
          errorMessage = 'Purchase was cancelled.';
        } else if (error.message.includes('already owned')) {
          errorMessage = 'You already own this subscription.';
        } else {
          errorMessage = error.message;
        }
      }
      
      Alert.alert('Purchase Error', errorMessage);
    }
  };

  const getPlanDescription = (planId) => {
    const descriptions = {
      pro_monthly: 'Best for growing teams',
      pro_yearly: 'Best for growing teams - Annual',
      premium_monthly: 'For enterprise teams',
      premium_yearly: 'For enterprise teams - Annual',
    };
    return descriptions[planId] || '';
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
        <Text style={styles.loadingText}>{t('pricing.loadingPricingPlans')}</Text>
        <Text style={[styles.loadingText, { fontSize: 14, marginTop: 10, textAlign: 'center' }]}>
          {t('pricing.loadingFromBackend')}
        </Text>
        <TouchableOpacity 
          style={styles.retryButton}
          onPress={() => {
            setLoading(true);
            fetchPlanData();
          }}
        >
          <Ionicons name="refresh" size={20} color="#FFFFFF" />
          <Text style={styles.retryButtonText}>{t('pricing.retry')}</Text>
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
                      disabled={
                        (planId === 'free' && (userPlan === 'pro' || userPlan === 'premium')) ||
                        purchasing ||
                        isCurrentPlan(planId)
                      }
                      style={getButtonStyle(planId, plan)}
                      onPress={() => handleUpgrade(planId)}
                    >
                      {purchasing ? (
                        <>
                          <ActivityIndicator size="small" color="#FFFFFF" />
                          <Text style={getButtonTextStyle(planId)}>Processing...</Text>
                        </>
                      ) : (
                        <>
                          <Text style={getButtonTextStyle(planId)}>
                            {getButtonText(planId)}
                          </Text>
                          {!(planId === 'free' && (userPlan === 'pro' || userPlan === 'premium')) && !isCurrentPlan(planId) && (
                            <Ionicons name="arrow-forward" size={16} color="#FFFFFF" />
                          )}
                        </>
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


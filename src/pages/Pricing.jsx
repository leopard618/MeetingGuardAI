import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  StatusBar,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useTranslation } from '../components/translations.jsx';
import { getPlans, getPlanTier, formatUsd, PURCHASES_AVAILABLE } from '../api/billingService';

// Subscriptions are disabled in this release: the plans are shown for information only,
// purchase buttons are replaced by a "coming soon" state and there are no payment links.
const Pricing = ({ language = 'en' }) => {
  const { userPlan, isAuthenticated, refreshUserPlan } = useAuth();
  const { t } = useTranslation(language);
  const [billingCycle, setBillingCycle] = useState('monthly');

  // Refresh the displayed plan when the screen gains focus. refreshUserPlan is not
  // memoized by AuthContext, so keep it in a ref to avoid re-running on every render.
  const refreshUserPlanRef = useRef(refreshUserPlan);
  refreshUserPlanRef.current = refreshUserPlan;
  useFocusEffect(
    useCallback(() => {
      if (isAuthenticated) {
        refreshUserPlanRef.current();
      }
    }, [isAuthenticated])
  );

  const currentTier = isAuthenticated ? getPlanTier(userPlan) : null;
  const isCurrentPlan = (plan) => currentTier !== null && plan.tier === currentTier;
  const toList = (value) => (Array.isArray(value) ? value : []);

  const renderPlan = (plan) => {
    const period = plan.cycle === 'yearly' ? t('pricing.year') : plan.cycle === 'monthly' ? t('pricing.month') : null;
    return (
      <View key={plan.id} style={[styles.planCard, plan.popular && styles.popularPlan]}>
        {plan.popular && (
          <View style={styles.popularBadge}>
            <Ionicons name="star" size={16} color="#FFFFFF" />
            <Text style={styles.popularBadgeText}>{t('pricing.mostPopular')}</Text>
          </View>
        )}

        <View style={styles.planContent}>
          <View style={styles.planHeader}>
            <Text style={styles.planName}>{t(`pricing.${plan.tier}Name`)}</Text>
            <Text style={styles.planDescription}>{t(`pricing.${plan.tier}Description`)}</Text>

            <View style={styles.priceContainer}>
              <Text style={styles.price}>{formatUsd(plan.priceUsd)}</Text>
              {period && <Text style={styles.period}>/{period}</Text>}
            </View>

            {plan.discountPercent ? (
              <View style={styles.savingsContainer}>
                <Ionicons name="trending-up" size={16} color="#10B981" />
                <Text style={styles.savings}>{t('pricing.savePercent')}</Text>
              </View>
            ) : null}

            {plan.monthlyEquivalentUsd ? (
              <Text style={styles.totalPrice}>
                {`${t('pricing.billedAnnually')} · ${formatUsd(plan.monthlyEquivalentUsd)}/${t('pricing.month')}`}
              </Text>
            ) : null}
          </View>

          <View style={styles.featuresContainer}>
            {toList(t(`pricing.${plan.tier}Features`)).map((feature) => (
              <View key={feature} style={styles.featureItem}>
                <View style={styles.featureIconContainer}>
                  <Ionicons name="checkmark-circle" size={20} color="#10B981" />
                </View>
                <Text style={styles.featureText}>{feature}</Text>
              </View>
            ))}
          </View>

          <View style={styles.actionContainer}>
            {isCurrentPlan(plan) ? (
              <View style={styles.currentPlanButton}>
                <Ionicons name="checkmark-circle" size={20} color="#10B981" />
                <Text style={styles.currentPlanButtonText}>{t('pricing.currentPlan')}</Text>
              </View>
            ) : plan.tier !== 'free' && !PURCHASES_AVAILABLE ? (
              <View style={styles.disabledButton} accessibilityState={{ disabled: true }}>
                <Text style={styles.disabledButtonText}>{t('pricing.comingSoon')}</Text>
              </View>
            ) : null}
          </View>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />

      <ScrollView
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {!PURCHASES_AVAILABLE && (
          <View style={styles.comingSoonBanner}>
            <Ionicons name="time-outline" size={22} color="#FBBF24" />
            <View style={styles.comingSoonTextContainer}>
              <Text style={styles.comingSoonTitle}>{t('pricing.subscriptionsComingSoonTitle')}</Text>
              <Text style={styles.comingSoonBody}>{t('pricing.subscriptionsComingSoonBody')}</Text>
            </View>
          </View>
        )}

        {/* Billing Toggle */}
        <View style={styles.billingToggleContainer}>
          <View style={styles.billingToggle}>
            {['monthly', 'yearly'].map((cycle) => (
              <TouchableOpacity
                key={cycle}
                style={[styles.billingButton, billingCycle === cycle && styles.billingButtonActive]}
                onPress={() => setBillingCycle(cycle)}
              >
                <Text style={[styles.billingButtonText, billingCycle === cycle && styles.billingButtonTextActive]}>
                  {t(`pricing.${cycle}`)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Plans */}
        <View style={styles.plansContainer}>
          {getPlans(billingCycle).map(renderPlan)}
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
  comingSoonBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#1E293B',
    borderColor: '#FBBF24',
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    marginHorizontal: 20,
    marginTop: 24,
  },
  comingSoonTextContainer: {
    flex: 1,
    marginLeft: 12,
  },
  comingSoonTitle: {
    color: '#F1F5F9',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 4,
  },
  comingSoonBody: {
    color: '#94A3B8',
    fontSize: 14,
    lineHeight: 20,
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


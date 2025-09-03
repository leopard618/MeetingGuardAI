import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  StatusBar,
  ActivityIndicator
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';

const PaymentSuccess = () => {
  const navigation = useNavigation();
  const route = useRoute();
  const [loading, setLoading] = useState(true);
  const [planDetails, setPlanDetails] = useState(null);

  useEffect(() => {
    // Get plan details from route params or URL
    const { plan, session_id } = route.params || {};
    
    if (plan) {
      setPlanDetails({
        planId: plan,
        planName: getPlanName(plan),
        sessionId: session_id
      });
    }
    
    setLoading(false);
    
    // Auto-navigate back to main app after 3 seconds
    const timer = setTimeout(() => {
      navigation.navigate('Dashboard');
    }, 3000);
    
    return () => clearTimeout(timer);
  }, [navigation, route.params]);

  const getPlanName = (planId) => {
    const planNames = {
      'pro_monthly': 'Pro Monthly',
      'pro_yearly': 'Pro Yearly',
      'premium_monthly': 'Premium Monthly',
      'premium_yearly': 'Premium Yearly'
    };
    return planNames[planId] || 'Premium Plan';
  };

  const handleReturnToApp = () => {
    navigation.navigate('Dashboard');
  };

  const handleViewSubscription = () => {
    // Navigate to subscription management or billing page
    navigation.navigate('Settings');
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#10B981" />
        <Text style={styles.loadingText}>Processing payment...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />
      
      {/* Success Icon */}
      <View style={styles.iconContainer}>
        <Ionicons name="checkmark-circle" size={120} color="#10B981" />
      </View>

      {/* Success Message */}
      <View style={styles.contentContainer}>
        <Text style={styles.title}>Payment Successful! 🎉</Text>
        <Text style={styles.subtitle}>
          Welcome to {planDetails?.planName}!
        </Text>
        
        {planDetails?.sessionId && (
          <Text style={styles.sessionId}>
            Session ID: {planDetails.sessionId}
          </Text>
        )}

        {/* Plan Details */}
        <View style={styles.planDetails}>
          <Text style={styles.planTitle}>Your Plan:</Text>
          <Text style={styles.planName}>{planDetails?.planName}</Text>
          <Text style={styles.planInfo}>
            You now have access to all premium features!
          </Text>
        </View>

        {/* Next Steps */}
        <View style={styles.nextSteps}>
          <Text style={styles.nextStepsTitle}>What's Next?</Text>
          <Text style={styles.nextStep}>• Start using AI features</Text>
          <Text style={styles.nextStep}>• Create unlimited meetings</Text>
          <Text style={styles.nextStep}>• Access premium support</Text>
        </View>
      </View>

      {/* Action Buttons */}
      <View style={styles.buttonContainer}>
        <TouchableOpacity
          style={styles.primaryButton}
          onPress={handleReturnToApp}
        >
          <Ionicons name="home" size={20} color="#FFFFFF" />
          <Text style={styles.primaryButtonText}>Return to App</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.secondaryButton}
          onPress={handleViewSubscription}
        >
          <Ionicons name="settings" size={20} color="#6B7280" />
          <Text style={styles.secondaryButtonText}>Manage Subscription</Text>
        </TouchableOpacity>
      </View>

      {/* Auto-navigate notice */}
      <Text style={styles.autoNavigate}>
        Auto-returning to app in 3 seconds...
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: '#0F172A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    color: '#94A3B8',
    fontSize: 18,
    marginTop: 20,
  },
  iconContainer: {
    marginBottom: 30,
  },
  contentContainer: {
    alignItems: 'center',
    marginBottom: 40,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#FFFFFF',
    textAlign: 'center',
    marginBottom: 10,
  },
  subtitle: {
    fontSize: 18,
    color: '#94A3B8',
    textAlign: 'center',
    marginBottom: 20,
  },
  sessionId: {
    fontSize: 12,
    color: '#64748B',
    backgroundColor: '#1E293B',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    marginBottom: 20,
    fontFamily: 'monospace',
  },
  planDetails: {
    backgroundColor: '#1E293B',
    padding: 20,
    borderRadius: 16,
    marginBottom: 20,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#334155',
  },
  planTitle: {
    fontSize: 16,
    color: '#94A3B8',
    marginBottom: 8,
  },
  planName: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#10B981',
    marginBottom: 8,
  },
  planInfo: {
    fontSize: 14,
    color: '#E2E8F0',
    textAlign: 'center',
  },
  nextSteps: {
    backgroundColor: '#1E293B',
    padding: 20,
    borderRadius: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#334155',
  },
  nextStepsTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#F1F5F9',
    marginBottom: 12,
  },
  nextStep: {
    fontSize: 14,
    color: '#94A3B8',
    marginBottom: 6,
  },
  buttonContainer: {
    width: '100%',
    marginBottom: 20,
  },
  primaryButton: {
    backgroundColor: '#10B981',
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 8,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '600',
    marginLeft: 8,
  },
  secondaryButton: {
    backgroundColor: '#1E293B',
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#334155',
  },
  secondaryButtonText: {
    color: '#6B7280',
    fontSize: 16,
    fontWeight: '500',
    marginLeft: 8,
  },
  autoNavigate: {
    color: '#64748B',
    fontSize: 14,
    textAlign: 'center',
  },
});

export default PaymentSuccess;

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  CreditCard, 
  Check, 
  Star, 
  Zap, 
  Shield, 
  Users, 
  BarChart3,
  ArrowRight,
  Loader2
} from 'lucide-react';
import billingService from '../api/billingService';

const Pricing = () => {
  const navigate = useNavigate();
  const [isYearly, setIsYearly] = useState(false);
  const [loading, setLoading] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState(null);
  const [subscription, setSubscription] = useState(null);
  const [plans, setPlans] = useState([]);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [plansData, subscriptionData] = await Promise.all([
        billingService.getPlans(),
        billingService.getSubscription()
      ]);
      
      setPlans(plansData.plans || []);
      setSubscription(subscriptionData);
    } catch (error) {
      console.error('Failed to load pricing data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleUpgrade = async (planId) => {
    setCheckoutLoading(planId);
    try {
      const successUrl = `${window.location.origin}/dashboard?checkout=success`;
      const cancelUrl = `${window.location.origin}/pricing?checkout=canceled`;
      
      const { url } = await billingService.createCheckoutSession(planId, successUrl, cancelUrl);
      window.location.href = url;
    } catch (error) {
      console.error('Failed to create checkout session:', error);
      alert('Failed to start checkout. Please try again.');
    } finally {
      setCheckoutLoading(null);
    }
  };

  const handleManageBilling = async () => {
    try {
      const returnUrl = `${window.location.origin}/pricing`;
      const { url } = await billingService.createPortalSession(returnUrl);
      window.location.href = url;
    } catch (error) {
      console.error('Failed to open billing portal:', error);
      alert('Failed to open billing portal. Please try again.');
    }
  };

  const getPlanConfig = () => {
    return [
      {
        id: 'free',
        name: 'Free',
        description: 'Perfect for getting started',
        monthlyPrice: 0,
        yearlyPrice: 0,
        icon: <Users className="w-6 h-6" />,
        features: [
          '5 AI requests per day',
          'Basic meeting management',
          'Google Calendar sync',
          'Mobile & web access'
        ],
        limitations: [
          'Limited AI requests',
          'Basic features only'
        ],
        popular: false,
        buttonText: 'Current Plan',
        buttonVariant: 'secondary'
      },
      {
        id: isYearly ? 'pro_yearly' : 'pro_monthly',
        name: 'Pro',
        description: 'Best for professionals',
        monthlyPrice: isYearly ? 5.99 : 7.99,
        yearlyPrice: 71.88,
        originalMonthlyPrice: isYearly ? 7.99 : null,
        icon: <Zap className="w-6 h-6" />,
        features: [
          'Unlimited AI requests',
          'Advanced meeting features',
          'File attachments',
          'Priority support',
          'Advanced calendar sync',
          '7-day free trial'
        ],
        popular: true,
        buttonText: 'Start 7-Day Trial',
        buttonVariant: 'primary'
      },
      {
        id: isYearly ? 'premium_yearly' : 'premium_monthly',
        name: 'Premium',
        description: 'For power users and teams',
        monthlyPrice: isYearly ? 11.24 : 14.99,
        yearlyPrice: 134.91,
        originalMonthlyPrice: isYearly ? 14.99 : null,
        icon: <Star className="w-6 h-6" />,
        features: [
          'Everything in Pro',
          'Advanced analytics',
          'Custom integrations',
          'Dedicated support',
          'Priority processing',
          'Team collaboration'
        ],
        popular: false,
        buttonText: 'Start 7-Day Trial',
        buttonVariant: 'primary'
      }
    ];
  };

  const isCurrentPlan = (planId) => {
    if (planId === 'free') {
      return !subscription || subscription.plan === 'free' || subscription.status === 'inactive';
    }
    return subscription?.plan === planId;
  };

  const getButtonText = (plan) => {
    if (isCurrentPlan(plan.id)) {
      return subscription?.status === 'trialing' ? 'Current Trial' : 'Current Plan';
    }
    return plan.buttonText;
  };

  const getButtonVariant = (plan) => {
    if (isCurrentPlan(plan.id)) {
      return 'secondary';
    }
    return plan.buttonVariant;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4 text-blue-600" />
          <p className="text-gray-600">Loading pricing information...</p>
        </div>
      </div>
    );
  }

  const planConfigs = getPlanConfig();

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-center justify-between">
            <button
              onClick={() => navigate('/dashboard')}
              className="flex items-center text-gray-600 hover:text-gray-900"
            >
              <ArrowRight className="w-5 h-5 mr-2 rotate-180" />
              Back to Dashboard
            </button>
            
            {subscription && billingService.isSubscriptionActive(subscription.status) && (
              <button
                onClick={handleManageBilling}
                className="flex items-center px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
              >
                <CreditCard className="w-4 h-4 mr-2" />
                Manage Billing
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {/* Hero Section */}
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">
            Choose Your Plan
          </h1>
          <p className="text-xl text-gray-600 mb-8">
            Unlock the full potential of AI-powered meeting management
          </p>

          {/* Billing Toggle */}
          <div className="flex items-center justify-center mb-8">
            <span className={`mr-3 ${!isYearly ? 'text-gray-900 font-medium' : 'text-gray-500'}`}>
              Monthly
            </span>
            <button
              onClick={() => setIsYearly(!isYearly)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                isYearly ? 'bg-blue-600' : 'bg-gray-200'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  isYearly ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
            <span className={`ml-3 ${isYearly ? 'text-gray-900 font-medium' : 'text-gray-500'}`}>
              Yearly
            </span>
            {isYearly && (
              <span className="ml-2 px-2 py-1 text-xs font-medium text-green-800 bg-green-100 rounded-full">
                Save 25%
              </span>
            )}
          </div>
        </div>

        {/* Current Subscription Status */}
        {subscription && subscription.plan !== 'free' && (
          <div className="mb-8 p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-medium text-blue-900">
                  Current Plan: {billingService.getPlanInfo(subscription.plan).name}
                </h3>
                <p className="text-sm text-blue-700">
                  Status: {billingService.getStatusDisplay(subscription.status)}
                  {subscription.status === 'trialing' && subscription.currentPeriodEnd && (
                    <span className="ml-2">
                      ({billingService.getTrialDaysRemaining(subscription.currentPeriodEnd)} days remaining)
                    </span>
                  )}
                </p>
              </div>
              <button
                onClick={handleManageBilling}
                className="px-4 py-2 text-sm font-medium text-blue-700 bg-blue-100 rounded-lg hover:bg-blue-200"
              >
                Manage
              </button>
            </div>
          </div>
        )}

        {/* Pricing Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-12">
          {planConfigs.map((plan) => (
            <div
              key={plan.id}
              className={`relative bg-white rounded-2xl shadow-sm border-2 transition-all duration-200 hover:shadow-lg ${
                plan.popular
                  ? 'border-blue-500 ring-2 ring-blue-500 ring-opacity-20'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              {plan.popular && (
                <div className="absolute -top-4 left-1/2 transform -translate-x-1/2">
                  <span className="bg-blue-500 text-white px-4 py-1 rounded-full text-sm font-medium">
                    Most Popular
                  </span>
                </div>
              )}

              <div className="p-8">
                {/* Plan Header */}
                <div className="flex items-center mb-4">
                  <div className={`p-2 rounded-lg ${plan.popular ? 'bg-blue-100' : 'bg-gray-100'}`}>
                    {plan.icon}
                  </div>
                  <div className="ml-3">
                    <h3 className="text-xl font-bold text-gray-900">{plan.name}</h3>
                    <p className="text-gray-600">{plan.description}</p>
                  </div>
                </div>

                {/* Pricing */}
                <div className="mb-6">
                  <div className="flex items-baseline">
                    <span className="text-4xl font-bold text-gray-900">
                      ${plan.monthlyPrice}
                    </span>
                    {plan.monthlyPrice > 0 && (
                      <span className="text-gray-600 ml-1">/month</span>
                    )}
                  </div>
                  
                  {plan.originalMonthlyPrice && (
                    <div className="flex items-center mt-1">
                      <span className="text-lg text-gray-500 line-through">
                        ${plan.originalMonthlyPrice}/month
                      </span>
                      <span className="ml-2 px-2 py-1 text-xs font-medium text-green-800 bg-green-100 rounded-full">
                        25% off
                      </span>
                    </div>
                  )}
                  
                  {isYearly && plan.yearlyPrice > 0 && (
                    <p className="text-sm text-gray-600 mt-1">
                      Billed annually (${plan.yearlyPrice}/year)
                    </p>
                  )}
                </div>

                {/* Features */}
                <ul className="space-y-3 mb-8">
                  {plan.features.map((feature, index) => (
                    <li key={index} className="flex items-center">
                      <Check className="w-5 h-5 text-green-500 mr-3 flex-shrink-0" />
                      <span className="text-gray-700">{feature}</span>
                    </li>
                  ))}
                </ul>

                {/* Limitations (for free plan) */}
                {plan.limitations && (
                  <ul className="space-y-2 mb-6">
                    {plan.limitations.map((limitation, index) => (
                      <li key={index} className="flex items-center text-sm text-gray-500">
                        <div className="w-5 h-5 mr-3 flex-shrink-0 flex items-center justify-center">
                          <div className="w-1 h-1 bg-gray-400 rounded-full"></div>
                        </div>
                        {limitation}
                      </li>
                    ))}
                  </ul>
                )}

                {/* CTA Button */}
                <button
                  onClick={() => {
                    if (plan.id === 'free' || isCurrentPlan(plan.id)) {
                      return;
                    }
                    handleUpgrade(plan.id);
                  }}
                  disabled={checkoutLoading === plan.id || isCurrentPlan(plan.id)}
                  className={`w-full py-3 px-4 rounded-lg font-medium transition-colors flex items-center justify-center ${
                    getButtonVariant(plan) === 'primary'
                      ? 'bg-blue-600 text-white hover:bg-blue-700 disabled:bg-blue-400'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:bg-gray-50'
                  } ${isCurrentPlan(plan.id) ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                >
                  {checkoutLoading === plan.id ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    getButtonText(plan)
                  )}
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Features Comparison */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
          <h2 className="text-2xl font-bold text-gray-900 mb-6 text-center">
            Feature Comparison
          </h2>
          
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-3 px-4 font-medium text-gray-900">Feature</th>
                  <th className="text-center py-3 px-4 font-medium text-gray-900">Free</th>
                  <th className="text-center py-3 px-4 font-medium text-gray-900">Pro</th>
                  <th className="text-center py-3 px-4 font-medium text-gray-900">Premium</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                <tr>
                  <td className="py-3 px-4 text-gray-700">AI Requests per Day</td>
                  <td className="py-3 px-4 text-center">5</td>
                  <td className="py-3 px-4 text-center">Unlimited</td>
                  <td className="py-3 px-4 text-center">Unlimited</td>
                </tr>
                <tr>
                  <td className="py-3 px-4 text-gray-700">Meeting Management</td>
                  <td className="py-3 px-4 text-center"><Check className="w-5 h-5 text-green-500 mx-auto" /></td>
                  <td className="py-3 px-4 text-center"><Check className="w-5 h-5 text-green-500 mx-auto" /></td>
                  <td className="py-3 px-4 text-center"><Check className="w-5 h-5 text-green-500 mx-auto" /></td>
                </tr>
                <tr>
                  <td className="py-3 px-4 text-gray-700">File Attachments</td>
                  <td className="py-3 px-4 text-center">-</td>
                  <td className="py-3 px-4 text-center"><Check className="w-5 h-5 text-green-500 mx-auto" /></td>
                  <td className="py-3 px-4 text-center"><Check className="w-5 h-5 text-green-500 mx-auto" /></td>
                </tr>
                <tr>
                  <td className="py-3 px-4 text-gray-700">Advanced Analytics</td>
                  <td className="py-3 px-4 text-center">-</td>
                  <td className="py-3 px-4 text-center">-</td>
                  <td className="py-3 px-4 text-center"><Check className="w-5 h-5 text-green-500 mx-auto" /></td>
                </tr>
                <tr>
                  <td className="py-3 px-4 text-gray-700">Priority Support</td>
                  <td className="py-3 px-4 text-center">-</td>
                  <td className="py-3 px-4 text-center"><Check className="w-5 h-5 text-green-500 mx-auto" /></td>
                  <td className="py-3 px-4 text-center"><Check className="w-5 h-5 text-green-500 mx-auto" /></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* FAQ Section */}
        <div className="mt-12 text-center">
          <h2 className="text-2xl font-bold text-gray-900 mb-6">
            Frequently Asked Questions
          </h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 text-left">
            <div>
              <h3 className="font-medium text-gray-900 mb-2">Can I cancel anytime?</h3>
              <p className="text-gray-600">
                Yes, you can cancel your subscription at any time. You'll continue to have access until the end of your billing period.
              </p>
            </div>
            
            <div>
              <h3 className="font-medium text-gray-900 mb-2">What happens to my data if I cancel?</h3>
              <p className="text-gray-600">
                Your data remains safe and accessible. You can always reactivate your subscription to regain full access.
              </p>
            </div>
            
            <div>
              <h3 className="font-medium text-gray-900 mb-2">Do you offer refunds?</h3>
              <p className="text-gray-600">
                We offer a 7-day free trial for all paid plans. If you're not satisfied, you can cancel during the trial period.
              </p>
            </div>
            
            <div>
              <h3 className="font-medium text-gray-900 mb-2">Can I upgrade or downgrade my plan?</h3>
              <p className="text-gray-600">
                Yes, you can change your plan at any time. Changes will be prorated and reflected in your next billing cycle.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Pricing;

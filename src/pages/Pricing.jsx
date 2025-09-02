import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { getPlans, redirectToCheckout, getSubscription } from '../api/billingService';

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

  const handleUpgrade = (planId, checkoutLink) => {
    if (!checkoutLink) {
      alert('This plan is not available for upgrade');
      return;
    }

    try {
      redirectToCheckout(planId, checkoutLink);
    } catch (error) {
      console.error('Error redirecting to checkout:', error);
      alert('Error redirecting to checkout. Please try again.');
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
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading plans...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">
            Choose Your Plan
          </h1>
          <p className="text-xl text-gray-600 max-w-3xl mx-auto">
            Start with our free plan and upgrade as you grow. All paid plans include a 7-day free trial.
          </p>
        </div>

        {/* Billing Toggle */}
        <div className="flex justify-center mb-8">
          <div className="bg-white rounded-lg p-1 shadow-sm">
            <div className="flex">
              <button
                onClick={() => setBillingCycle('monthly')}
                className={`px-6 py-2 rounded-md text-sm font-medium transition-colors ${
                  billingCycle === 'monthly'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                Monthly
              </button>
              <button
                onClick={() => setBillingCycle('yearly')}
                className={`px-6 py-2 rounded-md text-sm font-medium transition-colors ${
                  billingCycle === 'yearly'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                Yearly
                <span className="ml-1 text-xs bg-green-100 text-green-800 px-2 py-1 rounded-full">
                  Save 25%
                </span>
              </button>
            </div>
          </div>
        </div>

        {/* Plans Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 max-w-6xl mx-auto">
          {getFilteredPlans().map(([planId, plan]) => (
            <div
              key={planId}
              className={`relative bg-white rounded-2xl shadow-lg overflow-hidden transition-all duration-300 hover:shadow-xl ${
                plan.popular ? 'ring-2 ring-blue-500 scale-105' : ''
              } ${isCurrentPlan(planId) ? 'ring-2 ring-green-500' : ''}`}
            >
              {/* Popular Badge */}
              {plan.popular && (
                <div className="absolute top-0 right-0 bg-blue-600 text-white px-3 py-1 text-sm font-medium rounded-bl-lg">
                  Most Popular
                </div>
              )}

              {/* Current Plan Badge */}
              {isCurrentPlan(planId) && (
                <div className="absolute top-0 left-0 bg-green-600 text-white px-3 py-1 text-sm font-medium rounded-br-lg">
                  Current Plan
                </div>
              )}

              <div className="p-8">
                {/* Plan Header */}
                <div className="text-center mb-6">
                  <h3 className="text-2xl font-bold text-gray-900 mb-2">
                    {plan.name}
                  </h3>
                  <div className="mb-4">
                    <span className="text-4xl font-bold text-gray-900">
                      {plan.price}
                    </span>
                    {plan.period !== 'forever' && (
                      <span className="text-gray-500 ml-1">
                        /{plan.period}
                      </span>
                    )}
                  </div>
                  
                  {/* Yearly Savings */}
                  {plan.savings && (
                    <div className="text-sm text-green-600 font-medium">
                      {plan.savings}
                    </div>
                  )}
                  
                  {/* Total Yearly Price */}
                  {plan.totalPrice && (
                    <div className="text-sm text-gray-500">
                      {plan.totalPrice} billed annually
                    </div>
                  )}
                </div>

                {/* Features */}
                <ul className="space-y-3 mb-8">
                  {plan.features.map((feature, index) => (
                    <li key={index} className="flex items-start">
                      <svg
                        className="h-5 w-5 text-green-500 mt-0.5 mr-3 flex-shrink-0"
                        fill="currentColor"
                        viewBox="0 0 20 20"
                      >
                        <path
                          fillRule="evenodd"
                          d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                          clipRule="evenodd"
                        />
                      </svg>
                      <span className="text-gray-700">{feature}</span>
                    </li>
                  ))}
                </ul>

                {/* Action Button */}
                <div className="text-center">
                  {planId === 'free' ? (
                    <button
                      disabled
                      className="w-full bg-gray-100 text-gray-500 py-3 px-6 rounded-lg font-medium cursor-not-allowed"
                    >
                      Current Plan
                    </button>
                  ) : isCurrentPlan(planId) ? (
                    <button
                      disabled
                      className="w-full bg-green-100 text-green-700 py-3 px-6 rounded-lg font-medium cursor-not-allowed"
                    >
                      Current Plan
                    </button>
                  ) : (
                    <button
                      onClick={() => handleUpgrade(planId, plan.checkoutLink)}
                      className="w-full bg-blue-600 hover:bg-blue-700 text-white py-3 px-6 rounded-lg font-medium transition-colors duration-200"
                    >
                      Start 7-Day Trial
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Additional Info */}
        <div className="text-center mt-12">
          <p className="text-gray-600 mb-4">
            All plans include a 7-day free trial. Cancel anytime during the trial period.
          </p>
          <p className="text-sm text-gray-500">
            Need help choosing? <a href="#" className="text-blue-600 hover:text-blue-700">Contact our support team</a>
          </p>
        </div>
      </div>
    </div>
  );
};

export default Pricing;

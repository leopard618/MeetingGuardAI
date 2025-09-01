/**
 * Simple test script to verify Stripe integration setup
 * Run with: node test-stripe.js
 */

require('dotenv').config();
const Stripe = require('stripe');

async function testStripeSetup() {
  console.log('🧪 Testing Stripe Integration Setup...\n');

  // Check environment variables
  console.log('📋 Checking Environment Variables:');
  const requiredEnvVars = [
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET',
    'STRIPE_PRO_MONTHLY_PRICE_ID',
    'STRIPE_PRO_YEARLY_PRICE_ID',
    'STRIPE_PREMIUM_MONTHLY_PRICE_ID',
    'STRIPE_PREMIUM_YEARLY_PRICE_ID'
  ];

  let missingVars = [];
  requiredEnvVars.forEach(varName => {
    if (process.env[varName]) {
      console.log(`✅ ${varName}: ${process.env[varName].substring(0, 20)}...`);
    } else {
      console.log(`❌ ${varName}: Missing`);
      missingVars.push(varName);
    }
  });

  if (missingVars.length > 0) {
    console.log(`\n❌ Missing required environment variables: ${missingVars.join(', ')}`);
    console.log('Please check your .env file and STRIPE_SETUP.md guide.');
    return;
  }

  // Initialize Stripe
  const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

  try {
    // Test API key validity
    console.log('\n🔑 Testing API Key:');
    const account = await stripe.accounts.retrieve();
    console.log(`✅ Connected to Stripe account: ${account.display_name || account.id}`);
    console.log(`   Mode: ${process.env.STRIPE_SECRET_KEY.startsWith('sk_test_') ? 'Test' : 'Live'}`);

    // Test price IDs
    console.log('\n💰 Testing Price IDs:');
    const priceIds = [
      { name: 'Pro Monthly', id: process.env.STRIPE_PRO_MONTHLY_PRICE_ID },
      { name: 'Pro Yearly', id: process.env.STRIPE_PRO_YEARLY_PRICE_ID },
      { name: 'Premium Monthly', id: process.env.STRIPE_PREMIUM_MONTHLY_PRICE_ID },
      { name: 'Premium Yearly', id: process.env.STRIPE_PREMIUM_YEARLY_PRICE_ID }
    ];

    for (const price of priceIds) {
      try {
        const priceData = await stripe.prices.retrieve(price.id);
        console.log(`✅ ${price.name}: $${(priceData.unit_amount / 100).toFixed(2)}/${priceData.recurring.interval}`);
        
        // Check if it has a trial
        if (priceData.recurring.trial_period_days) {
          console.log(`   Trial: ${priceData.recurring.trial_period_days} days`);
        }
      } catch (error) {
        console.log(`❌ ${price.name}: Invalid price ID (${error.message})`);
      }
    }

    // Test webhook endpoint (basic connectivity)
    console.log('\n🔗 Testing Webhook Endpoint:');
    const webhookEndpoint = `${process.env.BACKEND_URL || 'http://localhost:3000'}/api/billing/webhook`;
    console.log(`   Endpoint: ${webhookEndpoint}`);
    
    try {
      const response = await fetch(webhookEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ test: true })
      });
      
      if (response.status === 400) {
        console.log('✅ Webhook endpoint is accessible (returned 400 as expected for invalid signature)');
      } else {
        console.log(`⚠️  Webhook endpoint returned status: ${response.status}`);
      }
    } catch (error) {
      console.log(`❌ Webhook endpoint not accessible: ${error.message}`);
      console.log('   Make sure your backend server is running and accessible');
    }

    console.log('\n🎉 Stripe integration test completed!');
    console.log('\n📝 Next steps:');
    console.log('1. Run your backend server');
    console.log('2. Set up webhooks in Stripe Dashboard');
    console.log('3. Test the complete checkout flow');
    console.log('4. Check the admin dashboard for metrics');

  } catch (error) {
    console.log(`\n❌ Stripe API Error: ${error.message}`);
    console.log('Please check your STRIPE_SECRET_KEY and try again.');
  }
}

// Run the test
testStripeSetup().catch(console.error);

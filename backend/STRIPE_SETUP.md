# Stripe Integration Setup Guide

This guide will help you set up Stripe payments for your MeetingGuard application.

## Prerequisites

1. A Stripe account (sign up at https://stripe.com)
2. Access to your Stripe Dashboard
3. Your backend deployed and accessible

## Step 1: Create Stripe Products and Prices

### 1.1 Create Products

In your Stripe Dashboard:

1. Go to **Products** → **Add Product**
2. Create two products:
   - **Pro Plan**: "MeetingGuard Pro - Advanced meeting management with unlimited AI requests"
   - **Premium Plan**: "MeetingGuard Premium - Everything in Pro plus advanced analytics and dedicated support"

### 1.2 Create Prices for Each Product

For **Pro Plan**:
1. **Monthly Price**: $7.99/month, recurring monthly, with 7-day free trial
2. **Yearly Price**: $71.88/year (25% discount), recurring yearly, with 7-day free trial

For **Premium Plan**:
1. **Monthly Price**: $14.99/month, recurring monthly, with 7-day free trial  
2. **Yearly Price**: $134.91/year (25% discount), recurring yearly, with 7-day free trial

### 1.3 Copy Price IDs

After creating each price, copy the Price ID (starts with `price_`) and save them for the environment variables.

## Step 2: Configure Environment Variables

Add these variables to your backend `.env` file:

```env
# Stripe Configuration
STRIPE_SECRET_KEY=sk_test_your-stripe-secret-key-here
STRIPE_WEBHOOK_SECRET=whsec_your-webhook-secret-here
STRIPE_PRO_MONTHLY_PRICE_ID=price_your-pro-monthly-price-id
STRIPE_PRO_YEARLY_PRICE_ID=price_your-pro-yearly-price-id
STRIPE_PREMIUM_MONTHLY_PRICE_ID=price_your-premium-monthly-price-id
STRIPE_PREMIUM_YEARLY_PRICE_ID=price_your-premium-yearly-price-id

# Frontend URLs (update with your actual domains)
FRONTEND_URL=https://your-frontend-domain.com
BACKEND_URL=https://your-backend-domain.com
```

## Step 3: Set Up Webhooks

### 3.1 Create Webhook Endpoint

1. In Stripe Dashboard, go to **Developers** → **Webhooks**
2. Click **Add endpoint**
3. Set endpoint URL to: `https://your-backend-domain.com/api/billing/webhook`
4. Select these events to listen for:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_succeeded`
   - `invoice.payment_failed`

### 3.2 Copy Webhook Secret

After creating the webhook, click on it and copy the **Signing secret** (starts with `whsec_`) to use as `STRIPE_WEBHOOK_SECRET`.

## Step 4: Database Migration

Run the database migrations to add subscription fields:

```sql
-- Run these SQL commands on your database
\i backend/migrations/add-subscription-fields.sql
\i backend/migrations/add-usage-function.sql
```

Or manually execute the SQL in the migration files.

## Step 5: Set Up Admin User

To access the admin dashboard, you need to set a user as admin:

```sql
-- Replace 'your-email@example.com' with your actual email
UPDATE users SET role = 'admin' WHERE email = 'your-email@example.com';
```

## Step 6: Test the Integration

### 6.1 Test Mode

1. Use Stripe test mode initially
2. Use test card numbers from Stripe documentation
3. Test the complete flow:
   - Visit `/pricing` page
   - Start a trial subscription
   - Check webhook delivery in Stripe Dashboard
   - Verify user plan updated in database

### 6.2 Test Cards

Use these test card numbers:
- **Successful payment**: `4242424242424242`
- **Declined payment**: `4000000000000002`
- **Requires authentication**: `4000002500003155`

### 6.3 Test Scenarios

1. **Successful subscription**:
   - Create checkout session
   - Complete payment with test card
   - Verify webhook received
   - Check user plan in database

2. **Failed payment**:
   - Use declined test card
   - Verify user remains on free plan

3. **Subscription management**:
   - Access billing portal
   - Cancel subscription
   - Verify webhook updates user status

## Step 7: Go Live

### 7.1 Switch to Live Mode

1. Toggle to **Live mode** in Stripe Dashboard
2. Create live versions of products and prices
3. Update environment variables with live keys
4. Create new webhook endpoint for live mode

### 7.2 Update Environment Variables

Replace test keys with live keys:
```env
STRIPE_SECRET_KEY=sk_live_your-live-secret-key
STRIPE_WEBHOOK_SECRET=whsec_your-live-webhook-secret
# Update price IDs with live versions
```

## Troubleshooting

### Common Issues

1. **Webhook not receiving events**:
   - Check webhook URL is accessible
   - Verify webhook secret matches
   - Check Stripe Dashboard webhook logs

2. **Checkout session creation fails**:
   - Verify price IDs are correct
   - Check Stripe secret key is valid
   - Ensure user has valid email

3. **Plan not updating after payment**:
   - Check webhook handler logs
   - Verify database connection
   - Check user ID mapping

### Logs to Check

1. **Backend logs**: Check server console for errors
2. **Stripe webhook logs**: In Stripe Dashboard → Webhooks → [Your webhook] → Logs
3. **Database logs**: Check if user records are being updated

## Security Notes

1. **Never expose secret keys** in frontend code
2. **Validate webhook signatures** (already implemented)
3. **Use HTTPS** for all webhook endpoints
4. **Regularly rotate** API keys
5. **Monitor webhook failures** in Stripe Dashboard

## Support

If you encounter issues:

1. Check Stripe Dashboard logs
2. Review backend server logs  
3. Test with Stripe CLI for local development
4. Consult Stripe documentation: https://stripe.com/docs

## Next Steps

After successful setup:

1. Monitor subscription metrics in admin dashboard
2. Set up email notifications for failed payments
3. Implement usage analytics
4. Consider adding more payment methods
5. Set up subscription lifecycle emails

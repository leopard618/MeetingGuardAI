# Payment & Admin Testing Guide

## 💳 Payment System Testing

### Stripe Checkout Links Testing

#### 1. Test Cards
```
✅ SUCCESS CARDS:
- 4242 4242 4242 4242 (Visa)
- 5555 5555 5555 4444 (Mastercard)
- 3782 822463 10005 (American Express)

❌ DECLINE CARDS:
- 4000 0000 0000 0002 (Generic decline)
- 4000 0000 0000 9995 (Insufficient funds)
- 4000 0000 0000 9987 (Lost card)
- 4000 0000 0000 9979 (Stolen card)
- 4000 0000 0000 0069 (Incorrect CVC)
- 4000 0000 0000 0127 (Incorrect card number)
- 4000 0000 0000 0119 (Processing error)
```

#### 2. Test Scenarios
```
🔍 SUBSCRIPTION FLOWS:
1. Free → Pro Monthly (7-day trial)
2. Free → Pro Yearly (7-day trial)
3. Free → Premium Monthly (7-day trial)
4. Free → Premium Yearly (7-day trial)
5. Pro Monthly → Premium Monthly (immediate upgrade)
6. Pro Yearly → Premium Yearly (immediate upgrade)
7. Monthly → Yearly (immediate upgrade)
8. Yearly → Monthly (immediate downgrade)

🔄 BILLING SCENARIOS:
- Trial expiration
- Failed payments
- Subscription cancellations
- Plan changes
- Refunds
```

#### 3. Testing Steps
```
📱 FRONTEND TESTING:
1. Open app → Navigate to Pricing page
2. Select any plan → Should redirect to Stripe
3. Use test card → Complete checkout
4. Return to app → Should show new plan status
5. Check billing → Should show subscription details

🔧 BACKEND TESTING:
1. Check user plan in database
2. Verify subscription_status
3. Confirm current_period_end
4. Test plan enforcement
5. Verify usage tracking
```

## 🔐 Admin Dashboard Access

### 1. Setting Admin Role

#### Database Method:
```sql
-- Connect to your Supabase database
-- Set user as admin
UPDATE users 
SET role = 'admin' 
WHERE email = 'your-email@example.com';

-- Verify admin role
SELECT email, role, subscription_status, plan 
FROM users 
WHERE email = 'your-email@example.com';
```

#### Environment Variable Method:
```bash
# Add to your .env file
ADMIN_EMAILS=admin1@example.com,admin2@example.com
```

### 2. Admin Routes

#### User Management:
```
GET /admin/users - List all users
GET /admin/users/:id - Get specific user
PUT /admin/users/:id - Update user
DELETE /admin/users/:id - Disable user
```

#### System Metrics:
```
GET /admin/metrics - Overall system stats
GET /admin/usage - Usage analytics
GET /admin/subscriptions - Subscription overview
GET /admin/health - System health check
```

### 3. Admin Features

#### User Management:
- View all registered users
- Enable/disable user accounts
- Monitor user activity
- View subscription status
- Track usage patterns

#### Subscription Oversight:
- Monitor plan changes
- Track trial conversions
- View billing cycles
- Handle disputes/refunds
- Analyze revenue metrics

#### System Analytics:
- API usage patterns
- Feature adoption rates
- User engagement metrics
- Performance monitoring
- Error tracking

## 🧪 Complete Testing Checklist

### Payment Testing ✅
- [ ] Free plan signup works
- [ ] Pro Monthly subscription (7-day trial)
- [ ] Pro Yearly subscription (7-day trial)
- [ ] Premium Monthly subscription (7-day trial)
- [ ] Premium Yearly subscription (7-day trial)
- [ ] Plan upgrades work
- [ ] Plan downgrades work
- [ ] Failed payments handled
- [ ] Customer portal accessible
- [ ] Usage limits enforced

### Admin Testing ✅
- [ ] Admin role can be set
- [ ] Admin dashboard accessible
- [ ] User list displays correctly
- [ ] User management works
- [ ] Metrics display properly
- [ ] Subscription overview works
- [ ] Usage analytics functional
- [ ] System health check works

### Integration Testing ✅
- [ ] OAuth flow completes
- [ ] User data syncs with database
- [ ] Plan changes reflect immediately
- [ ] Usage tracking accurate
- [ ] Billing webhooks work
- [ ] Error handling robust
- [ ] Rate limiting functional

## 🚨 Common Issues & Solutions

### Payment Issues:
```
❌ "Checkout session expired"
✅ Solution: Increase session timeout in Stripe

❌ "Invalid redirect URI"
✅ Solution: Check GOOGLE_REDIRECT_URI in environment

❌ "Plan not updating after payment"
✅ Solution: Verify webhook handling in backend
```

### Admin Issues:
```
❌ "Access denied to admin routes"
✅ Solution: Check user role in database

❌ "Admin dashboard not loading"
✅ Solution: Verify admin middleware

❌ "User list empty"
✅ Solution: Check database connection
```

## 📊 Monitoring & Analytics

### Key Metrics to Track:
- **Conversion Rate**: Free → Paid plans
- **Trial Conversion**: 7-day trial success rate
- **Churn Rate**: Subscription cancellations
- **Revenue Growth**: Monthly recurring revenue
- **User Engagement**: Feature usage patterns
- **System Performance**: API response times

### Tools for Monitoring:
- **Stripe Dashboard**: Payment analytics
- **Supabase Analytics**: Database performance
- **Render Logs**: Backend monitoring
- **Frontend Analytics**: User behavior tracking

## 🔒 Security Considerations

### Admin Access:
- **Role-based access control** implemented
- **JWT token validation** required
- **Rate limiting** on admin routes
- **Audit logging** for admin actions

### Payment Security:
- **Stripe handles** all payment data
- **No sensitive data** stored locally
- **Webhook signature** verification
- **HTTPS encryption** enforced

## 📱 Testing on Different Devices

### Mobile Testing:
- **Expo Go**: Android/iOS testing
- **Web Browser**: Cross-platform compatibility
- **Responsive Design**: Different screen sizes

### Browser Testing:
- **Chrome**: Primary testing
- **Safari**: iOS compatibility
- **Firefox**: Cross-browser support
- **Edge**: Windows compatibility

---

## 🚀 Quick Start Testing

1. **Set up admin user** in database
2. **Test OAuth flow** with Google
3. **Try payment flow** with test cards
4. **Access admin dashboard** with admin user
5. **Verify all features** work correctly
6. **Check error handling** with invalid inputs
7. **Monitor performance** and logs
8. **Test edge cases** and boundary conditions

## 📞 Support & Debugging

### Debug Mode:
```javascript
// Enable detailed logging
console.log('Payment flow:', paymentData);
console.log('Admin access:', userRole);
console.log('Database state:', userData);
```

### Log Analysis:
- **Backend logs**: Check Render deployment logs
- **Frontend logs**: Use Expo/React Native debugger
- **Database logs**: Monitor Supabase query performance
- **Payment logs**: Review Stripe dashboard events

---

*Last updated: Payment & Admin Testing Guide v1.0*

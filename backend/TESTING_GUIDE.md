# 🧪 MeetingGuard Backend - Complete Testing Guide

## 🚀 **Quick Start Testing (5 minutes)**

### **1. Health Check Test**
```bash
# Test if server is running
curl https://your-backend-url.onrender.com/health

# Expected response:
{
  "status": "OK",
  "timestamp": "2024-01-XX...",
  "environment": "production",
  "version": "1.0.0"
}
```

### **2. Root Endpoint Test**
```bash
# Test main API info
curl https://your-backend-url.onrender.com/

# Expected response:
{
  "message": "MeetingGuard Backend API",
  "version": "1.0.0",
  "status": "running",
  "endpoints": { ... }
}
```

## 🔐 **Authentication Testing**

### **3. User Registration Test**
```bash
# Test user signup
curl -X POST https://your-backend-url.onrender.com/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "TestPassword123!",
    "firstName": "Test",
    "lastName": "User"
  }'

# Expected: 201 Created with user data
```

### **4. User Login Test**
```bash
# Test user signin
curl -X POST https://your-backend-url.onrender.com/api/auth/signin \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "TestPassword123!"
  }'

# Expected: 200 OK with JWT token
# Save the token for authenticated requests!
```

### **5. Protected Route Test**
```bash
# Test authenticated endpoint
curl -X GET https://your-backend-url.onrender.com/api/users/profile \
  -H "Authorization: Bearer YOUR_JWT_TOKEN_HERE"

# Expected: 200 OK with user profile data
```

## 📅 **Meeting Management Testing**

### **6. Create Meeting Test**
```bash
# Test meeting creation
curl -X POST https://your-backend-url.onrender.com/api/meetings \
  -H "Authorization: Bearer YOUR_JWT_TOKEN_HERE" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Test Meeting",
    "description": "Testing meeting creation",
    "startTime": "2024-01-15T10:00:00Z",
    "endTime": "2024-01-15T11:00:00Z",
    "location": "Virtual",
    "participants": ["test@example.com"]
  }'

# Expected: 201 Created with meeting data
```

### **7. Get Meetings Test**
```bash
# Test fetching user's meetings
curl -X GET https://your-backend-url.onrender.com/api/meetings \
  -H "Authorization: Bearer YOUR_JWT_TOKEN_HERE"

# Expected: 200 OK with meetings array
```

## 💳 **Billing & Subscription Testing**

### **8. Get Plans Test**
```bash
# Test subscription plans endpoint
curl -X GET https://your-backend-url.onrender.com/api/billing/plans \
  -H "Authorization: Bearer YOUR_JWT_TOKEN_HERE"

# Expected: 200 OK with plan details and Stripe links
```

### **9. Get Subscription Status Test**
```bash
# Test subscription status
curl -X GET https://your-backend-url.onrender.com/api/billing/subscription \
  -H "Authorization: Bearer YOUR_JWT_TOKEN_HERE"

# Expected: 200 OK with current plan info
```

## 🤖 **AI Features Testing**

### **10. AI Analysis Test**
```bash
# Test AI meeting analysis
curl -X POST https://your-backend-url.onrender.com/api/ai/analyze \
  -H "Authorization: Bearer YOUR_JWT_TOKEN_HERE" \
  -H "Content-Type: application/json" \
  -d '{
    "meetingId": "meeting-id-here",
    "content": "Meeting discussion about project timeline and deliverables"
  }'

# Expected: 200 OK with AI insights
```

## 📁 **File Management Testing**

### **11. File Upload Test**
```bash
# Test file upload (requires multipart/form-data)
curl -X POST https://your-backend-url.onrender.com/api/files/upload \
  -H "Authorization: Bearer YOUR_JWT_TOKEN_HERE" \
  -F "file=@/path/to/test-file.txt"

# Expected: 201 Created with file data
```

### **12. Get Files Test**
```bash
# Test fetching user's files
curl -X GET https://your-backend-url.onrender.com/api/files \
  -H "Authorization: Bearer YOUR_JWT_TOKEN_HERE"

# Expected: 200 OK with files array
```

## 🔧 **Admin Features Testing**

### **13. Admin Metrics Test**
```bash
# Test admin metrics (requires admin role)
curl -X GET https://your-backend-url.onrender.com/api/admin/metrics \
  -H "Authorization: Bearer ADMIN_JWT_TOKEN_HERE"

# Expected: 200 OK with system metrics
```

### **14. Admin Users Test**
```bash
# Test admin user management
curl -X GET https://your-backend-url.onrender.com/api/admin/users \
  -H "Authorization: Bearer ADMIN_JWT_TOKEN_HERE"

# Expected: 200 OK with users list
```

## 🌐 **OAuth Testing**

### **15. Google OAuth Test**
```bash
# Test OAuth redirect
curl -I https://your-backend-url.onrender.com/oauth/google

# Expected: 302 Redirect to Google OAuth
```

## 📊 **Performance Testing**

### **16. Load Testing**
```bash
# Test with multiple concurrent requests
for i in {1..10}; do
  curl -s https://your-backend-url.onrender.com/health &
done
wait

# Check response times and success rates
```

### **17. Rate Limiting Test**
```bash
# Test rate limiting (make 101 requests quickly)
for i in {1..101}; do
  curl -s https://your-backend-url.onrender.com/health
  echo "Request $i"
done

# Expected: Last request should be rate limited (429)
```

## 🛠️ **Testing Tools & Setup**

### **Option 1: Command Line (curl)**
- **Pros**: Quick, no setup needed
- **Cons**: Manual, repetitive
- **Best for**: Quick checks, debugging

### **Option 2: Postman Collection**
- **Pros**: Visual, organized, reusable
- **Cons**: Requires setup
- **Best for**: Comprehensive testing, team collaboration

### **Option 3: Automated Testing Scripts**
- **Pros**: Repeatable, comprehensive
- **Cons**: Requires coding
- **Best for**: CI/CD, regression testing

## 🚨 **Common Issues & Solutions**

### **Issue: 401 Unauthorized**
- **Cause**: Missing or invalid JWT token
- **Solution**: Get fresh token from login endpoint

### **Issue: 403 Forbidden**
- **Cause**: Insufficient permissions or plan restrictions
- **Solution**: Check user role and subscription plan

### **Issue: 429 Too Many Requests**
- **Cause**: Rate limiting triggered
- **Solution**: Wait 15 minutes or reduce request frequency

### **Issue: 500 Internal Server Error**
- **Cause**: Backend error or missing environment variables
- **Solution**: Check Render logs and environment configuration

## 📋 **Testing Checklist**

- [ ] Health endpoint responds
- [ ] Root endpoint shows API info
- [ ] User registration works
- [ ] User login works
- [ ] JWT authentication works
- [ ] Protected routes require auth
- [ ] Meeting creation works
- [ ] File upload works
- [ ] Billing endpoints work
- [ ] Admin features work (if admin user)
- [ ] OAuth redirect works
- [ ] Rate limiting works
- [ ] Error handling works
- [ ] CORS works from frontend

## 🎯 **Next Steps After Testing**

1. **Fix any issues** found during testing
2. **Set up monitoring** for production
3. **Configure alerts** for errors
4. **Test with real data** (not test data)
5. **Performance optimization** if needed
6. **Security audit** completion
7. **Launch preparation** checklist

---

**Need help with any specific test?** Let me know what's failing and I'll help you debug it!

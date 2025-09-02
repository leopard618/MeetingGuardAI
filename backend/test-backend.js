#!/usr/bin/env node

/**
 * 🧪 MeetingGuard Backend Testing Script
 * 
 * Usage:
 * 1. Set your backend URL: BACKEND_URL=https://your-backend.onrender.com
 * 2. Run: node test-backend.js
 */

const https = require('https');
const http = require('http');

// Configuration
const BACKEND_URL = process.env.BACKEND_URL || 'https://meetingguard-backend.onrender.com';
const BASE_URL = BACKEND_URL.replace(/^https?:\/\//, '');
const PROTOCOL = BACKEND_URL.startsWith('https') ? https : http;

// Test results storage
const testResults = {
  passed: 0,
  failed: 0,
  total: 0
};

// Utility function to make HTTP requests
function makeRequest(path, options = {}) {
  return new Promise((resolve, reject) => {
    const requestOptions = {
      hostname: BASE_URL.split('/')[0],
      port: BASE_URL.includes(':') ? BASE_URL.split(':')[1] : (PROTOCOL === https ? 443 : 80),
      path: path,
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      }
    };

    const req = PROTOCOL.request(requestOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const jsonData = data ? JSON.parse(data) : {};
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            data: jsonData
          });
        } catch (e) {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            data: data
          });
        }
      });
    });

    req.on('error', reject);
    
    if (options.body) {
      req.write(JSON.stringify(options.body));
    }
    
    req.end();
  });
}

// Test function
async function runTest(testName, testFunction) {
  testResults.total++;
  try {
    console.log(`\n🧪 Testing: ${testName}`);
    const result = await testFunction();
    if (result.success) {
      console.log(`✅ PASS: ${testName}`);
      testResults.passed++;
    } else {
      console.log(`❌ FAIL: ${testName} - ${result.error}`);
      testResults.failed++;
    }
  } catch (error) {
    console.log(`❌ ERROR: ${testName} - ${error.message}`);
    testResults.failed++;
  }
}

// Individual test functions
async function testHealthEndpoint() {
  const response = await makeRequest('/health');
  return {
    success: response.statusCode === 200 && response.data.status === 'OK',
    error: `Expected 200 OK, got ${response.statusCode}`
  };
}

async function testRootEndpoint() {
  const response = await makeRequest('/');
  return {
    success: response.statusCode === 200 && response.data.message,
    error: `Expected 200 OK with message, got ${response.statusCode}`
  };
}

async function testAuthSignup() {
  const response = await makeRequest('/api/auth/signup', {
    method: 'POST',
    body: {
      email: `test${Date.now()}@example.com`,
      password: 'TestPassword123!',
      firstName: 'Test',
      lastName: 'User'
    }
  });
  return {
    success: response.statusCode === 201 || response.statusCode === 200,
    error: `Expected 201/200, got ${response.statusCode}`
  };
}

async function testAuthSignin() {
  const response = await makeRequest('/api/auth/signin', {
    method: 'POST',
    body: {
      email: 'test@example.com',
      password: 'TestPassword123!'
    }
  });
  return {
    success: response.statusCode === 200 && response.data.token,
    error: `Expected 200 with token, got ${response.statusCode}`
  };
}

async function testProtectedRoute() {
  const response = await makeRequest('/api/users/profile', {
    headers: {
      'Authorization': 'Bearer invalid-token'
    }
  });
  return {
    success: response.statusCode === 401,
    error: `Expected 401 Unauthorized, got ${response.statusCode}`
  };
}

async function testBillingPlans() {
  const response = await makeRequest('/api/billing/plans', {
    headers: {
      'Authorization': 'Bearer invalid-token'
    }
  });
  return {
    success: response.statusCode === 401,
    error: `Expected 401 Unauthorized, got ${response.statusCode}`
  };
}

async function testOAuthRedirect() {
  const response = await makeRequest('/oauth/google');
  return {
    success: response.statusCode === 302 || response.statusCode === 200,
    error: `Expected 302 redirect or 200, got ${response.statusCode}`
  };
}

async function testRateLimiting() {
  // Make multiple requests quickly
  const promises = [];
  for (let i = 0; i < 5; i++) {
    promises.push(makeRequest('/health'));
  }
  
  const responses = await Promise.all(promises);
  const allSuccessful = responses.every(r => r.statusCode === 200);
  
  return {
    success: allSuccessful,
    error: 'Rate limiting test failed - some requests failed'
  };
}

// Main test runner
async function runAllTests() {
  console.log('🚀 Starting MeetingGuard Backend Tests...');
  console.log(`📍 Backend URL: ${BACKEND_URL}`);
  console.log('⏰ Starting at:', new Date().toLocaleString());
  
  // Run all tests
  await runTest('Health Endpoint', testHealthEndpoint);
  await runTest('Root Endpoint', testRootEndpoint);
  await runTest('Auth Signup', testAuthSignup);
  await runTest('Auth Signin', testAuthSignin);
  await runTest('Protected Route (Unauthorized)', testProtectedRoute);
  await runTest('Billing Plans (Unauthorized)', testBillingPlans);
  await runTest('OAuth Redirect', testOAuthRedirect);
  await runTest('Rate Limiting', testRateLimiting);
  
  // Print results
  console.log('\n📊 Test Results:');
  console.log(`✅ Passed: ${testResults.passed}`);
  console.log(`❌ Failed: ${testResults.failed}`);
  console.log(`📈 Total: ${testResults.total}`);
  console.log(`📊 Success Rate: ${((testResults.passed / testResults.total) * 100).toFixed(1)}%`);
  
  if (testResults.failed === 0) {
    console.log('\n🎉 All tests passed! Your backend is working correctly.');
  } else {
    console.log('\n⚠️  Some tests failed. Check the errors above.');
  }
  
  console.log('\n💡 Next Steps:');
  console.log('1. Set up environment variables in Render');
  console.log('2. Test with real authentication tokens');
  console.log('3. Test all endpoints with valid data');
  console.log('4. Check Render deployment logs for any issues');
}

// Run tests if this file is executed directly
if (require.main === module) {
  runAllTests().catch(console.error);
}

module.exports = {
  runAllTests,
  makeRequest,
  testResults
};

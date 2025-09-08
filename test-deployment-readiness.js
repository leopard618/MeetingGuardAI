// Test script for deployment readiness
// Run this with: node test-deployment-readiness.js

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3001';

async function testDeploymentReadiness() {
  console.log('🚀 Testing Deployment Readiness');
  console.log('Backend URL:', BACKEND_URL);
  
  const tests = [];
  let passedTests = 0;
  let totalTests = 0;

  // Test 1: Backend Health Check
  totalTests++;
  try {
    console.log('\n📡 Test 1: Backend Health Check');
    const response = await fetch(`${BACKEND_URL}/api/health`);
    if (response.ok) {
      console.log('✅ Backend is healthy');
      tests.push({ name: 'Backend Health', status: 'PASS' });
      passedTests++;
    } else {
      console.log('❌ Backend health check failed:', response.status);
      tests.push({ name: 'Backend Health', status: 'FAIL', error: response.status });
    }
  } catch (error) {
    console.log('❌ Backend health check error:', error.message);
    tests.push({ name: 'Backend Health', status: 'FAIL', error: error.message });
  }

  // Test 2: Manual Authentication
  totalTests++;
  try {
    console.log('\n🔐 Test 2: Manual Authentication');
    const testUser = {
      name: 'Deployment Test User',
      email: 'deployment-test@example.com',
      password: 'testpassword123'
    };

    // Test signup
    const signupResponse = await fetch(`${BACKEND_URL}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testUser)
    });

    if (signupResponse.ok) {
      console.log('✅ Manual signup works');
      
      // Test signin
      const signinResponse = await fetch(`${BACKEND_URL}/api/auth/signin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: testUser.email,
          password: testUser.password
        })
      });

      if (signinResponse.ok) {
        const signinData = await signinResponse.json();
        console.log('✅ Manual signin works');
        console.log('✅ JWT token generated:', !!signinData.jwtToken);
        tests.push({ name: 'Manual Authentication', status: 'PASS' });
        passedTests++;
      } else {
        console.log('❌ Manual signin failed:', signinResponse.status);
        tests.push({ name: 'Manual Authentication', status: 'FAIL', error: 'Signin failed' });
      }
    } else {
      console.log('❌ Manual signup failed:', signupResponse.status);
      tests.push({ name: 'Manual Authentication', status: 'FAIL', error: 'Signup failed' });
    }
  } catch (error) {
    console.log('❌ Manual authentication error:', error.message);
    tests.push({ name: 'Manual Authentication', status: 'FAIL', error: error.message });
  }

  // Test 3: Database Connection
  totalTests++;
  try {
    console.log('\n🗄️ Test 3: Database Connection');
    const response = await fetch(`${BACKEND_URL}/api/auth/check-user/test@example.com`);
    if (response.ok) {
      console.log('✅ Database connection works');
      tests.push({ name: 'Database Connection', status: 'PASS' });
      passedTests++;
    } else {
      console.log('❌ Database connection failed:', response.status);
      tests.push({ name: 'Database Connection', status: 'FAIL', error: response.status });
    }
  } catch (error) {
    console.log('❌ Database connection error:', error.message);
    tests.push({ name: 'Database Connection', status: 'FAIL', error: error.message });
  }

  // Test 4: Environment Variables
  totalTests++;
  try {
    console.log('\n🔧 Test 4: Environment Variables');
    const requiredEnvVars = [
      'SUPABASE_URL',
      'SUPABASE_ANON_KEY',
      'GOOGLE_CLIENT_ID',
      'GOOGLE_CLIENT_SECRET',
      'JWT_SECRET'
    ];

    let missingVars = [];
    for (const envVar of requiredEnvVars) {
      if (!process.env[envVar]) {
        missingVars.push(envVar);
      }
    }

    if (missingVars.length === 0) {
      console.log('✅ All required environment variables are set');
      tests.push({ name: 'Environment Variables', status: 'PASS' });
      passedTests++;
    } else {
      console.log('❌ Missing environment variables:', missingVars);
      tests.push({ name: 'Environment Variables', status: 'FAIL', error: `Missing: ${missingVars.join(', ')}` });
    }
  } catch (error) {
    console.log('❌ Environment variables check error:', error.message);
    tests.push({ name: 'Environment Variables', status: 'FAIL', error: error.message });
  }

  // Test 5: CORS Configuration
  totalTests++;
  try {
    console.log('\n🌐 Test 5: CORS Configuration');
    const response = await fetch(`${BACKEND_URL}/api/auth/signup`, {
      method: 'OPTIONS',
      headers: {
        'Origin': 'http://localhost:3000',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Content-Type'
      }
    });

    if (response.ok) {
      console.log('✅ CORS preflight works');
      tests.push({ name: 'CORS Configuration', status: 'PASS' });
      passedTests++;
    } else {
      console.log('❌ CORS preflight failed:', response.status);
      tests.push({ name: 'CORS Configuration', status: 'FAIL', error: response.status });
    }
  } catch (error) {
    console.log('❌ CORS configuration error:', error.message);
    tests.push({ name: 'CORS Configuration', status: 'FAIL', error: error.message });
  }

  // Test 6: Google OAuth Configuration
  totalTests++;
  try {
    console.log('\n🔑 Test 6: Google OAuth Configuration');
    const hasGoogleClientId = !!process.env.GOOGLE_CLIENT_ID;
    const hasGoogleClientSecret = !!process.env.GOOGLE_CLIENT_SECRET;
    const hasGoogleRedirectUri = !!process.env.GOOGLE_REDIRECT_URI;

    if (hasGoogleClientId && hasGoogleClientSecret && hasGoogleRedirectUri) {
      console.log('✅ Google OAuth configuration complete');
      tests.push({ name: 'Google OAuth Configuration', status: 'PASS' });
      passedTests++;
    } else {
      const missing = [];
      if (!hasGoogleClientId) missing.push('GOOGLE_CLIENT_ID');
      if (!hasGoogleClientSecret) missing.push('GOOGLE_CLIENT_SECRET');
      if (!hasGoogleRedirectUri) missing.push('GOOGLE_REDIRECT_URI');
      console.log('❌ Missing Google OAuth configuration:', missing);
      tests.push({ name: 'Google OAuth Configuration', status: 'FAIL', error: `Missing: ${missing.join(', ')}` });
    }
  } catch (error) {
    console.log('❌ Google OAuth configuration error:', error.message);
    tests.push({ name: 'Google OAuth Configuration', status: 'FAIL', error: error.message });
  }

  // Summary
  console.log('\n📊 DEPLOYMENT READINESS SUMMARY');
  console.log('================================');
  console.log(`Total Tests: ${totalTests}`);
  console.log(`Passed: ${passedTests}`);
  console.log(`Failed: ${totalTests - passedTests}`);
  console.log(`Success Rate: ${((passedTests / totalTests) * 100).toFixed(1)}%`);

  console.log('\n📋 Test Results:');
  tests.forEach(test => {
    const status = test.status === 'PASS' ? '✅' : '❌';
    console.log(`${status} ${test.name}: ${test.status}`);
    if (test.error) {
      console.log(`   Error: ${test.error}`);
    }
  });

  if (passedTests === totalTests) {
    console.log('\n🎉 ALL TESTS PASSED! Your app is ready for deployment!');
    return true;
  } else {
    console.log('\n⚠️ Some tests failed. Please fix the issues before deploying.');
    return false;
  }
}

// Run the test
testDeploymentReadiness().then(success => {
  process.exit(success ? 0 : 1);
}).catch(error => {
  console.error('Test failed with error:', error);
  process.exit(1);
});

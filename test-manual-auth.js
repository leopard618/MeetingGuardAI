// Test script for manual authentication
// Run this with: node test-manual-auth.js

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3001';

async function testManualAuth() {
  console.log('🧪 Testing Manual Authentication Flow');
  console.log('Backend URL:', BACKEND_URL);
  
  const testUser = {
    name: 'Test User',
    email: 'test@example.com',
    password: 'testpassword123'
  };

  try {
    // Test 1: Sign up
    console.log('\n📝 Test 1: Sign Up');
    const signupResponse = await fetch(`${BACKEND_URL}/api/auth/signup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(testUser)
    });

    const signupData = await signupResponse.json();
    console.log('Signup Status:', signupResponse.status);
    console.log('Signup Response:', signupData);

    if (signupResponse.ok) {
      console.log('✅ Signup successful!');
      
      // Test 2: Sign in
      console.log('\n🔐 Test 2: Sign In');
      const signinResponse = await fetch(`${BACKEND_URL}/api/auth/signin`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: testUser.email,
          password: testUser.password
        })
      });

      const signinData = await signinResponse.json();
      console.log('Signin Status:', signinResponse.status);
      console.log('Signin Response:', signinData);

      if (signinResponse.ok) {
        console.log('✅ Signin successful!');
        console.log('JWT Token received:', !!signinData.jwtToken);
      } else {
        console.log('❌ Signin failed:', signinData.error);
      }
    } else {
      console.log('❌ Signup failed:', signupData.error);
    }

    // Test 3: Try to sign up again (should fail)
    console.log('\n🔄 Test 3: Duplicate Signup (should fail)');
    const duplicateSignupResponse = await fetch(`${BACKEND_URL}/api/auth/signup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(testUser)
    });

    const duplicateSignupData = await duplicateSignupResponse.json();
    console.log('Duplicate Signup Status:', duplicateSignupResponse.status);
    console.log('Duplicate Signup Response:', duplicateSignupData);

    if (duplicateSignupResponse.status === 409) {
      console.log('✅ Duplicate signup correctly rejected!');
    } else {
      console.log('❌ Duplicate signup should have been rejected');
    }

    // Test 4: Wrong password (should fail)
    console.log('\n🔒 Test 4: Wrong Password (should fail)');
    const wrongPasswordResponse = await fetch(`${BACKEND_URL}/api/auth/signin`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: testUser.email,
        password: 'wrongpassword'
      })
    });

    const wrongPasswordData = await wrongPasswordResponse.json();
    console.log('Wrong Password Status:', wrongPasswordResponse.status);
    console.log('Wrong Password Response:', wrongPasswordData);

    if (wrongPasswordResponse.status === 401) {
      console.log('✅ Wrong password correctly rejected!');
    } else {
      console.log('❌ Wrong password should have been rejected');
    }

  } catch (error) {
    console.error('❌ Test failed with error:', error);
  }
}

// Run the test
testManualAuth();

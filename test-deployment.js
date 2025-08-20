#!/usr/bin/env node

/**
 * MeetingGuard AI - Deployment Test Script
 * Tests the deployed backend and database connectivity
 */

const https = require('https');

// Configuration - Try different URL formats
const POSSIBLE_URLS = [
  'https://meetingguardai-leopard618.deno.dev',
  'https://leopard618-meetingguardai.deno.dev', 
  'https://meetingguardai.deno.dev',
  'https://meetingguardai--leopard618.deno.dev',
  'https://meetingguardai.snowleopard618.deno.dev',
  'https://snowleopard618-meetingguardai.deno.dev'
];

// Test functions
async function testEndpoint(url, path, description) {
  return new Promise((resolve) => {
    console.log(`🧪 Testing ${description} at ${url}...`);
    
    https.get(`${url}${path}`, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          console.log(`✅ ${description}: ${res.statusCode} - ${result.status || 'OK'}`);
          resolve({ success: true, status: res.statusCode, data: result });
        } catch (e) {
          console.log(`❌ ${description}: ${res.statusCode} - Invalid JSON`);
          resolve({ success: false, status: res.statusCode, error: e.message });
        }
      });
    }).on('error', (err) => {
      console.log(`❌ ${description}: Connection failed - ${err.message}`);
      resolve({ success: false, error: err.message });
    });
  });
}

async function runTests() {
  console.log('🚀 MeetingGuard AI - Deployment Test\n');
  
  const tests = [
    { path: '/health', description: 'Basic Health Check' }
  ];
  
  let workingUrl = null;
  
  // First, find which URL works
  console.log('🔍 Finding correct deployment URL...\n');
  
  for (const url of POSSIBLE_URLS) {
    console.log(`Testing: ${url}`);
    const result = await testEndpoint(url, '/health', 'URL Test');
    if (result.success && result.status === 200) {
      workingUrl = url;
      console.log(`✅ Found working URL: ${url}\n`);
      break;
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  if (!workingUrl) {
    console.log('❌ Could not find working deployment URL');
    console.log('🔧 Please check:');
    console.log('   1. Deployment was successful');
    console.log('   2. Environment variables are set in Deno Deploy');
    console.log('   3. Application is running without errors');
    return;
  }
  
  // Run full test suite with working URL
  const fullTests = [
    { path: '/health', description: 'Basic Health Check' },
    { path: '/health/db', description: 'Database Health Check' },
    { path: '/health/auth', description: 'Auth Service Health Check' },
    { path: '/health/calendar', description: 'Calendar Service Health Check' },
    { path: '/health/all', description: 'Comprehensive Health Check' }
  ];
  
  const results = [];
  
  for (const test of fullTests) {
    const result = await testEndpoint(workingUrl, test.path, test.description);
    results.push(result);
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  // Summary
  console.log('\n📊 Test Summary:');
  const passed = results.filter(r => r.success && r.status === 200).length;
  const total = results.length;
  
  console.log(`✅ Passed: ${passed}/${total}`);
  console.log(`❌ Failed: ${total - passed}/${total}`);
  
  if (passed === total) {
    console.log('\n🎉 All tests passed! Your backend is ready for production.');
  } else {
    console.log('\n⚠️  Some tests failed. Check your environment variables and Supabase setup.');
  }
  
  console.log(`\n🌐 Backend URL: ${workingUrl}`);
  console.log('📱 Ready to build mobile apps!');
}

// Run tests
runTests().catch(console.error);

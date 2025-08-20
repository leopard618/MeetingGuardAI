const https = require('https');

// All possible URL patterns for Deno Deploy
const urlPatterns = [
  'https://meetingguardai.deno.dev',
  'https://meetingguardai-leopard618.deno.dev',
  'https://leopard618-meetingguardai.deno.dev',
  'https://meetingguardai--leopard618.deno.dev',
  'https://meetingguardai.snowleopard618.deno.dev',
  'https://snowleopard618-meetingguardai.deno.dev',
  'https://meetingguardai-leopard618.deno.dev',
  'https://leopard618.meetingguardai.deno.dev'
];

async function testUrl(url) {
  return new Promise((resolve) => {
    console.log(`Testing: ${url}`);
    
    const req = https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          console.log(`✅ FOUND WORKING URL: ${url}`);
          console.log(`Response: ${data.substring(0, 200)}...`);
          resolve({ url, status: 'working', data });
        } else if (res.statusCode === 404 && data.includes('DEPLOYMENT_NOT_FOUND')) {
          console.log(`❌ ${url} - Deployment not found`);
          resolve({ url, status: 'not_found' });
        } else if (res.statusCode === 404) {
          console.log(`⚠️ ${url} - 404 but server responding (might be working)`);
          resolve({ url, status: 'server_responding', data });
        } else {
          console.log(`❌ ${url} - Status: ${res.statusCode}`);
          resolve({ url, status: 'error', statusCode: res.statusCode });
        }
      });
    });

    req.on('error', (err) => {
      console.log(`❌ ${url} - Connection error: ${err.message}`);
      resolve({ url, status: 'connection_error', error: err.message });
    });

    req.setTimeout(5000, () => {
      console.log(`❌ ${url} - Timeout`);
      req.destroy();
      resolve({ url, status: 'timeout' });
    });
  });
}

async function findDeploymentUrl() {
  console.log('🔍 Searching for MeetingGuard AI deployment URL...\n');
  
  const results = [];
  
  for (const url of urlPatterns) {
    const result = await testUrl(url);
    results.push(result);
    
    // Small delay between requests
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  console.log('\n📊 Results Summary:');
  console.log('==================');
  
  const working = results.filter(r => r.status === 'working');
  const serverResponding = results.filter(r => r.status === 'server_responding');
  const notFound = results.filter(r => r.status === 'not_found');
  const errors = results.filter(r => r.status === 'error' || r.status === 'connection_error' || r.status === 'timeout');
  
  console.log(`✅ Working URLs: ${working.length}`);
  console.log(`⚠️ Server responding: ${serverResponding.length}`);
  console.log(`❌ Not found: ${notFound.length}`);
  console.log(`💥 Errors: ${errors.length}`);
  
  if (working.length > 0) {
    console.log('\n🎉 Found working deployment URL!');
    working.forEach(w => console.log(`   ${w.url}`));
  } else if (serverResponding.length > 0) {
    console.log('\n⚠️ Found URLs that might be working (server responding):');
    serverResponding.forEach(s => console.log(`   ${s.url}`));
  } else {
    console.log('\n❌ No working URLs found. Please check:');
    console.log('   1. Deployment was successful');
    console.log('   2. Environment variables are set');
    console.log('   3. Application is starting without errors');
  }
}

findDeploymentUrl().catch(console.error);

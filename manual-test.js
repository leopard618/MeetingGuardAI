// Manual URL Test - Replace with your actual deployment URL
const DEPLOYMENT_URL = 'YOUR_ACTUAL_DEPLOYMENT_URL_HERE';

const https = require('https');

console.log('🧪 Testing deployment URL:', DEPLOYMENT_URL);

https.get(`${DEPLOYMENT_URL}/health`, (res) => {
  let data = '';
  res.on('data', (chunk) => data += chunk);
  res.on('end', () => {
    console.log('Status:', res.statusCode);
    console.log('Response:', data);
    
    if (res.statusCode === 200) {
      console.log('✅ Backend is working!');
    } else {
      console.log('❌ Backend has issues');
    }
  });
}).on('error', (err) => {
  console.log('❌ Connection failed:', err.message);
});

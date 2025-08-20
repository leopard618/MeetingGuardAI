const https = require('https');

// Test the most likely URL pattern
const testUrl = 'https://meetingguardai.deno.dev';

console.log('🧪 Testing deployment at:', testUrl);

// Test with a simple GET request
const req = https.get(testUrl, (res) => {
  console.log('Status Code:', res.statusCode);
  console.log('Headers:', res.headers);
  
  let data = '';
  res.on('data', (chunk) => {
    data += chunk;
  });
  
  res.on('end', () => {
    console.log('Response Body:', data);
    
    if (res.statusCode === 200) {
      console.log('✅ Deployment is working!');
    } else if (res.statusCode === 404) {
      console.log('❌ 404 - Route not found, but server is responding');
    } else {
      console.log('⚠️ Unexpected status code');
    }
  });
});

req.on('error', (err) => {
  console.log('❌ Connection Error:', err.message);
});

req.setTimeout(5000, () => {
  console.log('❌ Request timeout');
  req.destroy();
});

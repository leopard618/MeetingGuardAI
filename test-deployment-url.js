const https = require('https');

// Test the most likely URL pattern based on Deno Deploy documentation
const testUrl = 'https://meetingguardai-leopard618.deno.dev';

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
      console.log('🎉 Your backend is ready!');
    } else if (res.statusCode === 404) {
      if (data.includes('DEPLOYMENT_NOT_FOUND')) {
        console.log('❌ Deployment not found - URL pattern might be wrong');
        console.log('🔧 Please check your Deno Deploy dashboard for the correct URL');
      } else {
        console.log('⚠️ 404 - Route not found, but server is responding');
        console.log('✅ This means the deployment is working!');
      }
    } else {
      console.log('⚠️ Unexpected status code');
    }
  });
});

req.on('error', (err) => {
  console.log('❌ Connection Error:', err.message);
  console.log('🔧 Please check the deployment URL in your Deno Deploy dashboard');
});

req.setTimeout(5000, () => {
  console.log('❌ Request timeout');
  req.destroy();
});

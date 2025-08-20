const https = require('https');

// Test script for Render deployment
const testRenderDeployment = (renderUrl) => {
  console.log('🧪 Testing Render deployment...');
  console.log('URL:', renderUrl);
  
  const testEndpoints = [
    '/',
    '/api/health',
    '/api/meetings'
  ];
  
  testEndpoints.forEach(endpoint => {
    const url = `${renderUrl}${endpoint}`;
    
    https.get(url, (res) => {
      console.log(`\n✅ ${endpoint}: ${res.statusCode}`);
      
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          console.log('Response:', JSON.stringify(json, null, 2));
        } catch (e) {
          console.log('Response:', data);
        }
      });
    }).on('error', (err) => {
      console.log(`❌ ${endpoint}: ${err.message}`);
    });
  });
};

// Usage: Replace with your actual Render URL
// testRenderDeployment('https://your-render-url.onrender.com');

module.exports = { testRenderDeployment };

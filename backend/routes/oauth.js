const express = require('express');
const router = express.Router();

/**
 * OAuth redirect handler for Google authentication
 * This replaces the old redirect-server.js functionality
 */
router.get('/google', async (req, res) => {
  const { code, error, forceExpoGo } = req.query;
  
  // Define the OAuth redirect URI from environment variable
  const oauthRedirectUri = process.env.GOOGLE_REDIRECT_URI;
  
  // Validate that we have the required environment variables
  if (!oauthRedirectUri) {
    console.error('ERROR: GOOGLE_REDIRECT_URI not set in environment variables');
    return res.status(500).send('Server configuration error: Missing redirect URI');
  }
  
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    console.error('ERROR: Google OAuth credentials not set in environment variables');
    return res.status(500).send('Server configuration error: Missing OAuth credentials');
  }
  
  // Log the request for debugging
  console.log('=== OAuth Redirect Received ===');
  console.log('Query params:', req.query);
  console.log('Code:', code ? 'Present' : 'Missing');
  console.log('Error:', error || 'None');
  console.log('Force Expo Go:', forceExpoGo || 'None');
  console.log('User-Agent:', req.headers['user-agent']);
  
  // Detect if this is Expo Go based on User-Agent or referer
  const userAgent = req.headers['user-agent'] || '';
  const referer = req.headers['referer'] || '';
  
  // More specific detection for Expo Go
  let isExpoGo = userAgent.includes('Expo') || 
                 userAgent.includes('ReactNative') || 
                 (userAgent.includes('Chrome') && userAgent.includes('Mobile') && userAgent.includes('Android')) ||
                 referer.includes('expo') ||
                 referer.includes('192.168.141.51:8081');
  
  // Based on the logs, we see: "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Mobile Safari/537.36"
  // This is likely Expo Go, so let's be more permissive
  if (userAgent.includes('Chrome') && userAgent.includes('Mobile') && userAgent.includes('Android')) {
    isExpoGo = true;
    console.log('Detected Expo Go based on Android Chrome Mobile User-Agent');
  }
  
  // Manual override for Expo Go
  if (forceExpoGo === 'true') {
    isExpoGo = true;
    console.log('Forcing Expo Go detection due to query parameter');
  }
  
  console.log('Client detection details:');
  console.log('- User-Agent:', userAgent);
  console.log('- Referer:', referer);
  console.log('- Detected client:', isExpoGo ? 'Expo Go' : 'Development Build');
  
  if (error) {
    console.log('Redirecting with ERROR:', error);
    res.send(`
      <html>
        <head><title>OAuth Error</title></head>
        <body>
          <h1>OAuth Error</h1>
          <p>Error: ${error}</p>
          <script>
            // Redirect back to app with error
            ${isExpoGo 
              ? 'window.location.href = "exp://192.168.141.51:8081/--/auth?error=' + error + '";'
              : 'window.location.href = "meetingguardai://auth?error=' + error + '";'
            }
          </script>
        </body>
      </html>
    `);
  } else if (code) {
    console.log('Authorization code received. Processing...');
    
    try {
      // Exchange the authorization code for tokens
      console.log('=== Exchanging Code for Tokens ===');
      console.log('Using redirect URI for token exchange:', oauthRedirectUri);
      console.log('Client ID:', process.env.GOOGLE_CLIENT_ID ? 'Set' : 'Not set');
      console.log('Client Secret:', process.env.GOOGLE_CLIENT_SECRET ? 'Set' : 'Not set');
      
             // Log the exact values being sent for debugging
       console.log('=== TOKEN EXCHANGE DETAILS ===');
       console.log('Client ID:', process.env.GOOGLE_CLIENT_ID ? 'Set' : 'Not set');
       console.log('Client Secret:', process.env.GOOGLE_CLIENT_SECRET ? 'Set' : 'Not set');
       console.log('Redirect URI:', oauthRedirectUri);
       console.log('Code length:', code ? code.length : 0);
       
       const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
         method: 'POST',
         headers: {
           'Content-Type': 'application/x-www-form-urlencoded',
         },
         body: new URLSearchParams({
           client_id: process.env.GOOGLE_CLIENT_ID,
           client_secret: process.env.GOOGLE_CLIENT_SECRET,
           code: code,
           grant_type: 'authorization_code',
           redirect_uri: oauthRedirectUri,
         }),
       });

      console.log('Token response status:', tokenResponse.status);
      
      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        console.error('Token exchange failed:', errorText);
        throw new Error(`Token exchange failed: ${tokenResponse.status} - ${errorText}`);
      }
      
      const tokenData = await tokenResponse.json();
      console.log('Token response data:', tokenData);

      if (tokenData.access_token) {
        console.log('=== Getting User Info ===');
        
        // Get user info
        const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
          headers: {
            'Authorization': `Bearer ${tokenData.access_token}`,
          },
        });

        if (!userInfoResponse.ok) {
          throw new Error(`Failed to get user info: ${userInfoResponse.status}`);
        }

        const userInfo = await userInfoResponse.json();
        console.log('=== USER AUTHENTICATION SUCCESS ===');
        console.log('User email:', userInfo.email);
        console.log('User name:', userInfo.name);
        console.log('User ID:', userInfo.id);
        
                 // Store the authentication data directly in this route
         console.log('=== STORING AUTH DATA IN DATABASE ===');
         
         try {
           // Import the database and auth functions
           const { supabase } = require('../config/database');
           const { generateToken } = require('../middleware/auth');
           
           // Find or create user in database
           let { data: user, error: userError } = await supabase
             .from('users')
             .select('*')
             .eq('google_id', userInfo.id)
             .single();

           if (userError && userError.code !== 'PGRST116') {
             throw userError;
           }

           if (!user) {
             // Create new user
             const { data: newUser, error: createError } = await supabase
               .from('users')
               .insert({
                 google_id: userInfo.id,
                 email: userInfo.email,
                 name: userInfo.name,
                 picture: userInfo.picture,
                 given_name: userInfo.given_name,
                 family_name: userInfo.family_name,
                 is_active: true,
                 last_login: new Date().toISOString()
               })
               .select()
               .single();

             if (createError) {
               throw createError;
             }

             user = newUser;
           } else {
             // Update existing user's last login
             const { error: updateError } = await supabase
               .from('users')
               .update({
                 last_login: new Date().toISOString(),
                 name: userInfo.name,
                 picture: userInfo.picture
               })
               .eq('id', user.id);

             if (updateError) {
               throw updateError;
             }
           }

           // Store Google tokens securely
           const { error: tokenError } = await supabase
             .from('user_tokens')
             .upsert({
               user_id: user.id,
               access_token: tokenData.access_token,
               refresh_token: tokenData.refresh_token,
               expires_at: new Date(Date.now() + tokenData.expires_in * 1000).toISOString(),
               token_type: 'google'
             });

           if (tokenError) {
             console.error('Error storing tokens:', tokenError);
           }

           // Generate JWT token
           const jwtToken = generateToken(user.id);
           
           console.log('=== DATABASE STORAGE SUCCESS ===');
           console.log('User stored in database, JWT token generated');
           
           // Store the JWT token for the app to retrieve
           global.authData = {
             success: true,
             jwtToken: jwtToken,
             user: {
               id: user.id,
               email: user.email,
               name: user.name,
               picture: user.picture
             },
             googleTokens: {
               access_token: tokenData.access_token,
               refresh_token: tokenData.refresh_token,
               expires_in: tokenData.expires_in
             }
           };
         } catch (dbError) {
           console.error('Error storing auth data in database:', dbError);
         }
         
         console.log('=== AUTHENTICATION COMPLETE ===');
         console.log('Authentication data ready for app to retrieve');
        
                 // Redirect back to the app with success
                  res.send(`
           <!DOCTYPE html>
           <html lang="en">
           <head>
             <meta charset="UTF-8">
             <meta name="viewport" content="width=device-width, initial-scale=1.0">
             <title>Authentication Success - MeetingGuard AI</title>
             <style>
               * {
                 margin: 0;
                 padding: 0;
                 box-sizing: border-box;
               }
               
               body {
                 font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
                 background: #1a1a1a;
                 min-height: 100vh;
                 display: flex;
                 align-items: center;
                 justify-content: center;
                 padding: 20px;
                 color: #ffffff;
               }
               
               .container {
                 background: #2d2d2d;
                 border-radius: 16px;
                 box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
                 padding: 40px;
                 max-width: 450px;
                 width: 100%;
                 text-align: center;
                 border: 1px solid #404040;
               }
               
               .success-icon {
                 width: 60px;
                 height: 60px;
                 background: #00d4aa;
                 border-radius: 50%;
                 display: flex;
                 align-items: center;
                 justify-content: center;
                 margin: 0 auto 24px;
                 box-shadow: 0 4px 16px rgba(0, 212, 170, 0.3);
               }
               
               .success-icon svg {
                 width: 30px;
                 height: 30px;
                 fill: white;
               }
               
               h1 {
                 color: #ffffff;
                 font-size: 24px;
                 font-weight: 600;
                 margin-bottom: 8px;
               }
               
               .welcome-text {
                 color: #b0b0b0;
                 font-size: 16px;
                 margin-bottom: 32px;
                 line-height: 1.4;
               }
               
               .user-info {
                 background: #404040;
                 border-radius: 12px;
                 padding: 20px;
                 margin: 24px 0;
                 border-left: 3px solid #00d4aa;
               }
               
               .user-info p {
                 margin: 8px 0;
                 color: #e0e0e0;
                 font-size: 14px;
               }
               
               .user-info strong {
                 color: #ffffff;
                 font-weight: 500;
               }
               
               .dashboard-btn {
                 background: #00d4aa;
                 color: #1a1a1a;
                 border: none;
                 padding: 16px 32px;
                 border-radius: 12px;
                 font-size: 16px;
                 font-weight: 600;
                 cursor: pointer;
                 transition: all 0.2s ease;
                 margin: 24px 0;
                 width: 100%;
                 max-width: 200px;
                 box-shadow: 0 4px 12px rgba(0, 212, 170, 0.3);
               }
               
               .dashboard-btn:hover {
                 background: #00b894;
                 transform: translateY(-1px);
                 box-shadow: 0 6px 16px rgba(0, 212, 170, 0.4);
               }
               
               .dashboard-btn:active {
                 transform: translateY(0);
               }
               
               .loading {
                 display: none;
                 margin: 16px 0;
               }
               
               .spinner {
                 width: 20px;
                 height: 20px;
                 border: 2px solid #404040;
                 border-top: 2px solid #00d4aa;
                 border-radius: 50%;
                 animation: spin 1s linear infinite;
                 margin: 0 auto 8px;
               }
               
               .loading p {
                 color: #b0b0b0;
                 font-size: 14px;
               }
               
               @keyframes spin {
                 0% { transform: rotate(0deg); }
                 100% { transform: rotate(360deg); }
               }
               
               .manual-link {
                 background: #404040;
                 border-radius: 8px;
                 padding: 16px;
                 margin: 24px 0 0 0;
                 font-size: 12px;
                 color: #b0b0b0;
                 border: 1px solid #505050;
               }
               
               .manual-link code {
                 background: #1a1a1a;
                 color: #00d4aa;
                 padding: 8px 12px;
                 border-radius: 6px;
                 font-family: 'Courier New', monospace;
                 display: block;
                 margin: 8px 0;
                 word-break: break-all;
                 border: 1px solid #505050;
               }
               
               @media (max-width: 480px) {
                 .container {
                   padding: 32px 24px;
                 }
                 
                 h1 {
                   font-size: 22px;
                 }
               }
             </style>
           </head>
           <body>
             <div class="container">
               <div class="success-icon">
                 <svg viewBox="0 0 24 24">
                   <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
                 </svg>
               </div>
               
               <h1>Authentication Successful!</h1>
               <p class="welcome-text">Hi, <strong>${userInfo.name}</strong>, welcome to MeetingGuard AI</p>
               
               <div class="user-info">
               </div>
               
               <button class="dashboard-btn" onclick="goToDashboard()">
                 Go to Dashboard
               </button>
               
               <div class="loading" id="loading">
                 <div class="spinner"></div>
                 <p>Redirecting to app...</p>
               </div>
               
               
             </div>
               
             <script>
               function goToDashboard() {
                 console.log('Go to Dashboard clicked');
                 
                 // Show loading spinner
                 document.getElementById('loading').style.display = 'block';
                 document.querySelector('.dashboard-btn').style.display = 'none';
                 
                 // Try multiple redirect methods with better error handling
                 setTimeout(() => {
                   try {
                     console.log('Attempting redirect to Expo Go...');
                     
                     // Method 1: Try Expo Go redirect with proper URL encoding
                     const expoUrl = "exp://192.168.141.51:8081/--/auth?success=true&user=" + encodeURIComponent(userInfo.email) + "&token=" + encodeURIComponent(global.authData?.jwtToken || '');
                     console.log('Expo URL:', expoUrl);
                     window.location.href = expoUrl;
                     
                   } catch (e) {
                     console.log('Expo redirect failed, trying custom scheme...');
                     try {
                       // Method 2: Try custom scheme
                       const customUrl = "meetingguardai://auth?success=true&user=" + encodeURIComponent(userInfo.email) + "&token=" + encodeURIComponent(global.authData?.jwtToken || '');
                       console.log('Custom URL:', customUrl);
                       window.location.href = customUrl;
                       
                     } catch (e2) {
                       console.log('Custom scheme failed, trying window.close...');
                       // Method 3: Fallback - try to close window
                       try {
                         window.close();
                       } catch (e3) {
                         console.log('All redirect methods failed');
                         // Show error message
                         document.getElementById('loading').innerHTML = '<p style="color: #ff6b6b;">Redirect failed. Please close this window and return to the app.</p>';
                       }
                     }
                   }
                 }, 1000);
               }
               
               // Auto-redirect after 3 seconds as fallback
               setTimeout(() => {
                 if (document.querySelector('.dashboard-btn').style.display !== 'none') {
                   console.log('Auto-redirecting...');
                   goToDashboard();
                 }
               }, 3000);
               
               // Add click event listener as backup
               document.addEventListener('DOMContentLoaded', function() {
                 const btn = document.querySelector('.dashboard-btn');
                 if (btn) {
                   btn.addEventListener('click', goToDashboard);
                 }
               });
             </script>
           </body>
           </html>
         `);
      } else {
        console.error('No access token in response:', tokenData);
        throw new Error('Failed to get access token from response');
      }
    } catch (error) {
      console.error('Error processing authorization code:', error);
      res.send(`
        <html>
          <head><title>OAuth Error</title></head>
          <body>
            <h1>OAuth Error</h1>
            <p>Error: ${error.message}</p>
            <script>
              setTimeout(() => {
                window.close();
              }, 2000);
            </script>
          </body>
        </html>
      `);
    }
  } else {
    console.log('No code or error received');
    res.send(`
      <html>
        <head><title>OAuth Redirect</title></head>
        <body>
          <h1>OAuth Redirect Server</h1>
          <p>This server handles OAuth redirects for MeetingGuard.</p>
          <p>Detected client: ${isExpoGo ? 'Expo Go' : 'Development Build'}</p>
          <p>User-Agent: ${userAgent}</p>
          <p>No authorization code or error received.</p>
        </body>
      </html>
    `);
  }
});

/**
 * Root OAuth endpoint for backward compatibility
 */
router.get('/', (req, res) => {
  res.json({
    message: 'OAuth endpoint',
    available: ['/google', '/test-config'],
    redirect_uri: process.env.GOOGLE_REDIRECT_URI || 'Not configured',
    client_id_set: !!process.env.GOOGLE_CLIENT_ID,
    client_secret_set: !!process.env.GOOGLE_CLIENT_SECRET
  });
});

/**
 * Test endpoint to check OAuth configuration
 */
router.get('/test-config', (req, res) => {
  res.json({
    google_client_id: process.env.GOOGLE_CLIENT_ID ? 'Set' : 'Not set',
    google_client_secret: process.env.GOOGLE_CLIENT_SECRET ? 'Set' : 'Not set',
    google_redirect_uri: process.env.GOOGLE_REDIRECT_URI || 'Not set',
    backend_url: process.env.BACKEND_URL || 'Not set',
    node_env: process.env.NODE_ENV || 'Not set'
  });
});

/**
 * Endpoint for the app to retrieve authentication data
 */
router.get('/auth-data', (req, res) => {
  console.log('=== Auth Data Request ===');
  console.log('Request headers:', req.headers);
  
  // Add CORS headers for mobile app
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  
  // Return stored authentication data
  if (global.authData && global.authData.success) {
    const authData = global.authData;
    // Clear the data after sending it
    global.authData = null;
    
    res.json(authData);
  } else {
    res.json({ 
      success: false, 
      message: 'No authentication data available. Please complete OAuth flow first.' 
    });
  }
});

/**
 * Endpoint to get auth data by user email (for cases where global.authData is cleared)
 */
router.get('/auth-data/:email', async (req, res) => {
  console.log('=== Auth Data Request by Email ===');
  console.log('Email:', req.params.email);
  
  // Add CORS headers for mobile app
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  
  try {
    const { supabase } = require('../config/database');
    const { generateToken } = require('../middleware/auth');
    
    // Find user by email
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('email', req.params.email)
      .single();
    
    if (userError || !user) {
      return res.json({ 
        success: false, 
        message: 'User not found' 
      });
    }
    
    // Get user tokens
    const { data: tokens, error: tokenError } = await supabase
      .from('user_tokens')
      .select('*')
      .eq('user_id', user.id)
      .eq('token_type', 'google')
      .single();
    
    if (tokenError) {
      console.error('Error getting tokens:', tokenError);
    }
    
    // Generate new JWT token
    const jwtToken = generateToken(user.id);
    
    res.json({
      success: true,
      jwtToken: jwtToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        picture: user.picture
      },
      googleTokens: tokens ? {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_in: Math.floor((new Date(tokens.expires_at) - new Date()) / 1000)
      } : null
    });
    
  } catch (error) {
    console.error('Error getting auth data by email:', error);
    res.json({ 
      success: false, 
      message: 'Error retrieving authentication data' 
    });
  }
});

/**
 * Endpoint for the app to check if authentication completed
 * This is a temporary endpoint for backward compatibility
 */
router.get('/check-auth', (req, res) => {
  console.log('=== Check Auth Request ===');
  console.log('Request headers:', req.headers);
  
  // Add CORS headers for mobile app
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  
  // Check if auth data is available
  if (global.authData && global.authData.success) {
    res.json({ 
      success: true, 
      message: 'Authentication data available' 
    });
  } else {
    res.json({ 
      success: false, 
      message: 'No authentication data available' 
    });
  }
});

module.exports = router;

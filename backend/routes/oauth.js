const express = require('express');
const router = express.Router();

/**
 * Root OAuth endpoint for testing
 */
router.get('/', (req, res) => {
  console.log('=== OAUTH ROOT ENDPOINT ACCESSED ===');
  res.json({
    message: 'OAuth endpoint is working',
    endpoints: {
      google: '/oauth/google',
      authData: '/oauth/auth-data'
    },
    timestamp: new Date().toISOString()
  });
});

/**
 * OAuth redirect handler for Google authentication
 * This replaces the old redirect-server.js functionality
 */
router.get('/google', async (req, res) => {
  console.log('=== OAUTH /GOOGLE ENDPOINT ACCESSED ===');
  console.log('Request URL:', req.url);
  console.log('Request method:', req.method);
  console.log('Request headers:', req.headers);
  
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
    
    // Prevent duplicate processing of the same code
    if (global.processingCode === code) {
      console.log('=== CODE ALREADY BEING PROCESSED ===');
      console.log('Skipping duplicate code processing');
      return res.send(`
        <html>
          <head><title>Processing...</title></head>
          <body>
            <h1>Authentication in Progress</h1>
            <p>Please wait while we complete your authentication...</p>
            <script>
              setTimeout(() => {
                window.close();
              }, 2000);
            </script>
          </body>
        </html>
      `);
    }
    
    // Mark this code as being processed
    global.processingCode = code;
    
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
         console.log('User picture:', userInfo.picture);
         
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
           
           // Even if database storage fails, we can still generate JWT and return user data
           console.log('=== FALLBACK: GENERATING JWT WITHOUT DATABASE ===');
           const jwtToken = generateToken(userInfo.id); // Use Google ID as fallback
           
           global.authData = {
             success: true,
             jwtToken: jwtToken,
             user: {
               id: userInfo.id,
               email: userInfo.email,
               name: userInfo.name,
               picture: userInfo.picture
             },
             googleTokens: {
               access_token: tokenData.access_token,
               refresh_token: tokenData.refresh_token,
               expires_in: tokenData.expires_in
             }
           };
         }
         
         console.log('=== AUTHENTICATION COMPLETE ===');
         console.log('Authentication data ready for app to retrieve');
         
         // Ensure we have the auth data
         if (!global.authData) {
           console.log('=== FALLBACK: CREATING AUTH DATA ===');
           const jwtToken = generateToken(userInfo.id);
           global.authData = {
             success: true,
             jwtToken: jwtToken,
             user: {
               id: userInfo.id,
               email: userInfo.email,
               name: userInfo.name,
               picture: userInfo.picture
             },
             googleTokens: {
               access_token: tokenData.access_token,
               refresh_token: tokenData.refresh_token,
               expires_in: tokenData.expires_in
             }
           };
         }
         
         console.log('=== STORED AUTH DATA GLOBALLY ===');
         console.log('Global auth data:', {
           success: global.authData.success,
           userEmail: global.authData.user.email,
           userName: global.authData.user.name,
           hasJWT: !!global.authData.jwtToken,
           hasAccessToken: !!global.authData.googleTokens.access_token
         });
         
         // Clear the processing code
         global.processingCode = null;
         
         // FINAL CHECK: Ensure auth data is stored globally
         if (!global.authData) {
           console.log('=== FINAL FALLBACK: ENSURING AUTH DATA IS STORED ===');
           const jwtToken = generateToken(userInfo.id);
           global.authData = {
             success: true,
             jwtToken: jwtToken,
             user: {
               id: userInfo.id,
               email: userInfo.email,
               name: userInfo.name,
               picture: userInfo.picture
             },
             googleTokens: {
               access_token: tokenData.access_token,
               refresh_token: tokenData.refresh_token,
               expires_in: tokenData.expires_in
             },
             timestamp: new Date().toISOString()
           };
         }
         
         console.log('=== FINAL AUTH DATA CONFIRMATION ===');
         console.log('Global auth data exists:', !!global.authData);
         console.log('Global auth data success:', global.authData?.success);
         console.log('User email:', global.authData?.user?.email);
         console.log('Has JWT:', !!global.authData?.jwtToken);
         
         // Send a simple success page using the same approach as local redirect-server.js
         res.send(`
           <html>
             <head><title>OAuth Success</title></head>
             <body>
               <h1>OAuth Success</h1>
               <p>Authentication completed successfully!</p>
               <p>User: ${userInfo.email}</p>
               <p>Name: ${userInfo.name}</p>
               <p>Auth data stored: ${!!global.authData}</p>
               <p>You can close this window now.</p>
               <script>
                 // Close the window
                 setTimeout(() => {
                   window.close();
                 }, 2000);
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
      
      // Clear the processing code on error
      global.processingCode = null;
      
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
  console.log('Global auth data exists:', !!global.authData);
  console.log('Global auth data success:', global.authData?.success);
  console.log('Global auth data type:', typeof global.authData);
  console.log('Global auth data keys:', global.authData ? Object.keys(global.authData) : 'null');
  console.log('Request timestamp:', new Date().toISOString());
  
  // Add CORS headers for mobile app
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  
  // Return stored authentication data
  if (global.authData && global.authData.success) {
    const authData = global.authData;
    console.log('=== SENDING AUTH DATA TO APP ===');
    console.log('User email:', authData.user.email);
    console.log('User name:', authData.user.name);
    console.log('Has JWT:', !!authData.jwtToken);
    console.log('Has access token:', !!authData.googleTokens?.access_token);
    console.log('Auth data timestamp:', new Date().toISOString());
    
    // Clear the data after sending it
    global.authData = null;
    console.log('Global auth data cleared');
    
    res.json(authData);
  } else {
    console.log('=== NO AUTH DATA AVAILABLE ===');
    console.log('Global auth data:', global.authData);
    console.log('No auth data timestamp:', new Date().toISOString());
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

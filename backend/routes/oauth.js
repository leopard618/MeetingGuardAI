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
         
         // Send a success page with immediate redirect attempt
         res.send(`
           <!DOCTYPE html>
           <html>
           <head>
             <title>Authentication Complete</title>
             <style>
               body { 
                 font-family: Arial, sans-serif; 
                 text-align: center; 
                 padding: 50px; 
                 background: #1a1a1a; 
                 color: white; 
                 margin: 0;
                 min-height: 100vh;
                 display: flex;
                 align-items: center;
                 justify-content: center;
               }
               .success { 
                 background: #2d2d2d; 
                 padding: 30px; 
                 border-radius: 12px; 
                 border: 1px solid #404040;
                 max-width: 400px;
               }
             </style>
           </head>
           <body>
             <div class="success">
               <h2>✅ Authentication Successful!</h2>
               <p>Welcome, ${userInfo.name}!</p>
               <p>Redirecting to your app...</p>
               <p style="font-size: 12px; color: #888; margin-top: 20px;">
                 Auth data ready: ${userInfo.email}
               </p>
             </div>
             <script>
               console.log('=== OAUTH SUCCESS PAGE LOADED ===');
               console.log('User:', '${userInfo.name}');
               console.log('Email:', '${userInfo.email}');
               console.log('Auth data available:', true);
               console.log('Auth data email:', '${userInfo.email}');
               
               // Function to check if auth data is available
               async function checkAuthData() {
                 try {
                   console.log('Checking auth data availability...');
                   const response = await fetch('/oauth/auth-data', {
                     method: 'GET',
                     headers: {
                       'Content-Type': 'application/json',
                     },
                   });
                   
                   console.log('Auth data check response status:', response.status);
                   
                   if (response.ok) {
                     const data = await response.json();
                     console.log('Auth data check result:', data);
                     
                     if (data.success) {
                       console.log('Auth data is available!');
                       return true;
                     } else {
                       console.log('Auth data not available yet');
                       return false;
                     }
                   } else {
                     console.log('Auth data check failed');
                     return false;
                   }
                 } catch (error) {
                   console.log('Auth data check error:', error.message);
                   return false;
                 }
               }
               
               // Try multiple redirect methods
               function tryRedirect() {
                 console.log('Attempting redirect to app...');
                 
                 // Method 1: Try Expo Go
                 try {
                   const expoUrl = "exp://192.168.141.51:8081/--/auth?success=true&user=${encodeURIComponent(userInfo.email)}";
                   console.log('Trying Expo URL:', expoUrl);
                   window.location.href = expoUrl;
                 } catch (e) {
                   console.log('Expo redirect failed:', e.message);
                   
                   // Method 2: Try custom scheme
                   try {
                     const customUrl = "meetingguardai://auth?success=true&user=${encodeURIComponent(userInfo.email)}";
                     console.log('Trying custom URL:', customUrl);
                     window.location.href = customUrl;
                   } catch (e2) {
                     console.log('Custom redirect failed:', e2.message);
                     
                     // Method 3: Close window
                     try {
                       window.close();
                       console.log('Window closed successfully');
                     } catch (e3) {
                       console.log('Window close failed:', e3.message);
                     }
                   }
                 }
               }
               
               // Main flow: check auth data, then redirect
               async function mainFlow() {
                 console.log('Starting main flow...');
                 
                 // Check auth data first
                 const authDataAvailable = await checkAuthData();
                 
                 if (authDataAvailable) {
                   console.log('Auth data confirmed, attempting redirect...');
                   tryRedirect();
                 } else {
                   console.log('Auth data not ready, waiting...');
                   // Wait 1 second and try again
                   setTimeout(mainFlow, 1000);
                 }
               }
               
               // Start the main flow
               mainFlow();
               
               // Fallback: close window after 10 seconds
               setTimeout(() => {
                 console.log('Final fallback: closing window');
                 try {
                   window.close();
                 } catch (e) {
                   console.log('Final close failed:', e.message);
                 }
               }, 10000);
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

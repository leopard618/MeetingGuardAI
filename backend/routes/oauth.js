const express = require('express');
const router = express.Router();

// Use built-in https module for HTTP requests
const https = require('https');
const { URLSearchParams } = require('url');

// Store temporary OAuth state (in production, use Redis or database)
const oauthState = new Map();

/**
 * Google OAuth redirect endpoint
 * Handles the OAuth callback from Google
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

      // Exchange authorization code for tokens using https module
      const tokenData = await new Promise((resolve, reject) => {
        const postData = new URLSearchParams({
          code: code,
          client_id: process.env.GOOGLE_CLIENT_ID,
          client_secret: process.env.GOOGLE_CLIENT_SECRET,
          redirect_uri: oauthRedirectUri,
          grant_type: 'authorization_code',
        }).toString();

        const options = {
          hostname: 'oauth2.googleapis.com',
          port: 443,
          path: '/token',
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': Buffer.byteLength(postData)
          }
        };

        const req = https.request(options, (res) => {
          let data = '';
          res.on('data', (chunk) => data += chunk);
          res.on('end', () => {
            try {
              if (res.statusCode === 200) {
                const tokenData = JSON.parse(data);
                resolve(tokenData);
              } else {
                reject(new Error(`Token exchange failed: ${res.statusCode} - ${data}`));
              }
            } catch (error) {
              reject(new Error(`Failed to parse token response: ${error.message}`));
            }
          });
        });

        req.on('error', (error) => {
          reject(new Error(`Token exchange request failed: ${error.message}`));
        });

        req.write(postData);
        req.end();
      });

      console.log('Token exchange successful');
      console.log('Token response data:', tokenData);

      if (tokenData.access_token) {
        console.log('=== Getting User Info ===');
        
        // Get user info using https module
        const userInfo = await new Promise((resolve, reject) => {
          const options = {
            hostname: 'www.googleapis.com',
            port: 443,
            path: '/oauth2/v2/userinfo',
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${tokenData.access_token}`
            }
          };

          const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
              try {
                if (res.statusCode === 200) {
                  const userInfo = JSON.parse(data);
                  resolve(userInfo);
                } else {
                  reject(new Error(`Failed to get user info: ${res.statusCode}`));
                }
              } catch (error) {
                reject(new Error(`Failed to parse user info response: ${error.message}`));
              }
            });
          });

          req.on('error', (error) => {
            reject(new Error(`User info request failed: ${error.message}`));
          });

          req.end();
        });
        console.log('User info received:', userInfo);

        // Save or update user in Supabase database
        try {
          const { supabase } = require('../config/database');
          
          if (supabase) {
            console.log('=== SAVING USER TO SUPABASE ===');
            console.log('User email:', userInfo.email);
            console.log('User name:', userInfo.name);
            
            // Check if user already exists
            const { data: existingUser, error: findError } = await supabase
              .from('users')
              .select('id, email, name, google_id, plan, subscription_status')
              .eq('email', userInfo.email)
              .single();

            let user;
            
            if (findError && findError.code === 'PGRST116') {
              // User not found, create new user
              console.log('👤 User not found, creating new user with Google info');
              
              const { data: newUser, error: createError } = await supabase
                .from('users')
                .insert({
                  google_id: userInfo.id,
                  email: userInfo.email,
                  name: userInfo.name,
                  picture: userInfo.picture,
                  given_name: userInfo.given_name,
                  family_name: userInfo.family_name,
                  plan: 'free', // Default to free plan
                  subscription_status: 'inactive',
                  enabled: true,
                  last_login: new Date().toISOString(),
                  created_at: new Date().toISOString(),
                  updated_at: new Date().toISOString()
                })
                .select()
                .single();

              if (createError) {
                console.error('❌ Error creating user from Google OAuth:', createError);
                throw createError;
              } else {
                console.log('✅ User created successfully from Google OAuth:', newUser);
                user = newUser;
              }
            } else if (findError) {
              console.error('❌ Error finding user:', findError);
              throw findError;
            } else {
              // User exists, update their info
              console.log('👤 Found existing user:', existingUser);
              console.log(`🔄 Updating user info for Google OAuth`);
              
              const { data: updatedUser, error: updateError } = await supabase
                .from('users')
                .update({
                  google_id: userInfo.id,
                  name: userInfo.name,
                  picture: userInfo.picture,
                  given_name: userInfo.given_name,
                  family_name: userInfo.family_name,
                  last_login: new Date().toISOString(),
                  updated_at: new Date().toISOString()
                })
                .eq('email', userInfo.email)
                .select()
                .single();

              if (updateError) {
                console.error('❌ Error updating user from Google OAuth:', updateError);
                throw updateError;
              } else {
                console.log('✅ User updated successfully from Google OAuth:', updatedUser);
                user = updatedUser;
              }
            }
            
            // Store user tokens in database
            if (user) {
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
                console.error('❌ Error storing user tokens:', tokenError);
              } else {
                console.log('✅ User tokens stored successfully');
              }
            }
          } else {
            console.error('❌ Supabase not configured - cannot save user from Google OAuth');
          }
        } catch (dbError) {
          console.error('❌ Database error during Google OAuth:', dbError);
          // Continue with OAuth flow even if database save fails
        }

        // Store the OAuth state temporarily
        const sessionId = Date.now().toString();
        oauthState.set(sessionId, {
          user: userInfo,
          accessToken: tokenData.access_token,
          refreshToken: tokenData.refresh_token,
          expiresAt: Date.now() + (tokenData.expires_in * 1000)
        });

        // Clean up old sessions (older than 5 minutes)
        const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
        for (const [key, value] of oauthState.entries()) {
          if (value.expiresAt < fiveMinutesAgo) {
            oauthState.delete(key);
          }
        }

        console.log('=== OAuth Success ===');
        console.log('Session ID:', sessionId);
        console.log('User email:', userInfo.email);
        console.log('Stored in oauthState for polling');

                 // Send success response with session ID and instructions for the app
         res.send(`
           <html>
             <head><title>OAuth Success</title></head>
             <body>
               <h1>Authentication Successful!</h1>
               <p>Welcome, ${userInfo.name}!</p>
               <p>Session ID: ${sessionId}</p>
               <p>You can close this window and return to the app.</p>
               <p>The app will automatically detect the completion.</p>
               <script>
                 // Try to communicate with the app
                 try {
                   // Store session ID in localStorage
                   localStorage.setItem('oauth_session_id', '${sessionId}');
                   
                   // Try to send message to parent window (if in iframe)
                   if (window.parent && window.parent !== window) {
                     window.parent.postMessage({
                       type: 'OAUTH_SUCCESS',
                       sessionId: '${sessionId}',
                       user: ${JSON.stringify(userInfo)}
                     }, '*');
                   }
                   
                   // Try to send message to opener (if opened by app)
                   if (window.opener) {
                     window.opener.postMessage({
                       type: 'OAUTH_SUCCESS',
                       sessionId: '${sessionId}',
                       user: ${JSON.stringify(userInfo)}
                     }, '*');
                   }
                   
                   console.log('OAuth success message sent');
                 } catch (e) {
                   console.log('Could not send message to app:', e);
                 }
                 
                 // Close window after 3 seconds
                 setTimeout(() => {
                   window.close();
                 }, 3000);
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
 * Endpoint for the app to check if authentication completed
 * This endpoint allows the frontend to poll for OAuth completion
 */
router.get('/google-status', (req, res) => {
  console.log('=== Google Status Check Request ===');
  console.log('Request headers:', req.headers);
  
  // Add CORS headers for mobile app
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');

  const { sessionId } = req.query;
  
  if (!sessionId) {
    return res.status(400).json({
      success: false,
      error: 'Session ID required'
    });
  }

  console.log('Checking session ID:', sessionId);
  
  const oauthData = oauthState.get(sessionId);
  
  if (oauthData) {
    console.log('Session found, returning user data');
    // Remove the session after returning it (one-time use)
    oauthState.delete(sessionId);
    
    return res.json({
      success: true,
      user: oauthData.user,
      accessToken: oauthData.accessToken,
      refreshToken: oauthData.refreshToken
    });
  } else {
    console.log('Session not found or expired');
    return res.json({
      success: false,
      error: 'Session not found or expired'
    });
  }
});

/**
 * Endpoint for the app to check for any available OAuth sessions
 * This allows the frontend to poll without knowing a specific session ID
 */
router.get('/google-check', (req, res) => {
  console.log('=== Google Check Request ===');
  console.log('Request headers:', req.headers);
  
  // Add CORS headers for mobile app
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');

  // Clean up expired sessions first
  const now = Date.now();
  const fiveMinutesAgo = now - (5 * 60 * 1000);
  for (const [key, value] of oauthState.entries()) {
    if (value.expiresAt < fiveMinutesAgo) {
      oauthState.delete(key);
    }
  }

  // Find any available session
  const availableSessions = Array.from(oauthState.entries());
  
  if (availableSessions.length > 0) {
    // Get the first available session
    const [sessionId, oauthData] = availableSessions[0];
    console.log('Available session found:', sessionId);
    
    // Remove the session after returning it (one-time use)
    oauthState.delete(sessionId);
    
    return res.json({
      success: true,
      sessionId: sessionId,
      user: oauthData.user,
      accessToken: oauthData.accessToken,
      refreshToken: oauthData.refreshToken
    });
  } else {
    console.log('No available sessions found');
    return res.json({
      success: false,
      error: 'No authentication sessions available'
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

  res.json({
    message: 'Check auth endpoint - use /google-status instead',
    success: false
  });
});

module.exports = router;

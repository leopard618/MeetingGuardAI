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
    const html = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Google Sign-In Error - MeetingGuard AI</title>
          <style>
              * { margin: 0; padding: 0; box-sizing: border-box; }
              body { 
                  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                  background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
                  min-height: 100vh;
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  padding: 20px;
              }
              .container {
                  background: white;
                  border-radius: 24px;
                  padding: 48px 32px;
                  text-align: center;
                  box-shadow: 0 25px 50px rgba(0,0,0,0.15);
                  max-width: 420px;
                  width: 100%;
                  position: relative;
                  overflow: hidden;
              }
              .container::before {
                  content: '';
                  position: absolute;
                  top: 0;
                  left: 0;
                  right: 0;
                  height: 4px;
                  background: linear-gradient(90deg, #EF4444, #DC2626);
              }
              .error-icon {
                  width: 72px;
                  height: 72px;
                  background: linear-gradient(135deg, #EF4444, #DC2626);
                  border-radius: 50%;
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  margin: 0 auto 24px;
                  font-size: 36px;
                  color: white;
                  box-shadow: 0 8px 24px rgba(239, 68, 68, 0.3);
              }
              h1 {
                  color: #111827;
                  margin-bottom: 12px;
                  font-size: 32px;
                  font-weight: 800;
                  letter-spacing: -0.025em;
              }
              .subtitle {
                  color: #6B7280;
                  margin-bottom: 32px;
                  font-size: 18px;
                  font-weight: 500;
              }
              .error-details {
                  background: linear-gradient(135deg, #FEF2F2, #FEE2E2);
                  border: 2px solid #EF4444;
                  border-radius: 16px;
                  padding: 20px;
                  margin-bottom: 32px;
              }
              .error-message {
                  color: #991B1B;
                  font-weight: 600;
                  font-size: 16px;
                  margin-bottom: 8px;
              }
              .error-description {
                  color: #7F1D1D;
                  font-size: 14px;
                  font-weight: 500;
              }
              .countdown-box {
                  background: linear-gradient(135deg, #F0F9FF, #E0F2FE);
                  border: 2px solid #0EA5E9;
                  border-radius: 16px;
                  padding: 24px;
                  margin-bottom: 24px;
              }
              .countdown-text {
                  font-size: 20px;
                  font-weight: 700;
                  color: #0C4A6E;
                  margin-bottom: 8px;
              }
              .countdown-subtitle {
                  color: #0369A1;
                  font-size: 14px;
                  font-weight: 500;
              }
              .countdown-number {
                  color: #0EA5E9;
                  font-size: 24px;
                  font-weight: 800;
              }
              .close-button {
                  background: linear-gradient(135deg, #6B7280, #4B5563);
                  color: white;
                  padding: 16px 32px;
                  border: none;
                  border-radius: 12px;
                  font-size: 16px;
                  font-weight: 600;
                  cursor: pointer;
                  width: 100%;
                  transition: all 0.2s ease;
                  box-shadow: 0 4px 12px rgba(107, 114, 128, 0.3);
              }
              .close-button:hover {
                  transform: translateY(-2px);
                  box-shadow: 0 6px 16px rgba(107, 114, 128, 0.4);
              }
              .close-button:active {
                  transform: translateY(0);
              }
          </style>
      </head>
        <body>
          <div class="container">
              <div class="error-icon">✕</div>
              
              <h1>Sign-In Failed</h1>
              <p class="subtitle">Something went wrong with Google authentication</p>
              
              <div class="error-details">
                  <div class="error-message">Error: ${error}</div>
                  <div class="error-description">Please try signing in again from the app</div>
              </div>
              
              <div class="countdown-box">
                  <div class="countdown-text">Returning to app in <span class="countdown-number" id="countdown">3</span> seconds...</div>
                  <div class="countdown-subtitle">You can close this tab manually if needed</div>
              </div>
              
              <button class="close-button" onclick="closeTab()">
                  Close This Tab
              </button>
          </div>
          
          <script>
              // Countdown timer
              var countdown = 3;
              var countdownElement = document.getElementById('countdown');
              
              var timer = setInterval(function() {
                  countdown--;
                  if (countdownElement) {
                      countdownElement.textContent = countdown;
                  }
                  if (countdown <= 0) {
                      clearInterval(timer);
                      closeTab();
                  }
              }, 1000);
              
              // Redirect to app (error case)
              function closeTab() {
                  console.log('Redirecting to app after error...');
                  
                  // Try different app deep links for error case
                  const appLinks = [
                      'meetingguardai://auth-error?error=${error}',
                      'meetingguardai://dashboard?auth=error&error=${error}',
                      'meetingguardai://login?error=true&message=${error}',
                      'exp://192.168.141.51:8081/--/auth-error?error=${error}',
                      'exp://localhost:8081/--/auth-error?error=${error}'
                  ];
                  
                  // Try each link in sequence
                  let linkIndex = 0;
                  const tryNextLink = () => {
                      if (linkIndex < appLinks.length) {
                          const link = appLinks[linkIndex];
                          console.log('Trying app link:', link);
                          
                          try {
                              window.location.href = link;
                              console.log('Redirected to app link:', link);
                              
                              // If redirect doesn't work after 2 seconds, try next link
                              setTimeout(() => {
                                  if (document.visibilityState === 'visible') {
                                      linkIndex++;
                                      tryNextLink();
                                  }
                              }, 2000);
                          } catch (e) {
                              console.log('Failed to redirect to:', link, e);
                              linkIndex++;
                              tryNextLink();
                          }
                      } else {
                          // All app links failed, show fallback message
                          console.log('All app links failed, showing fallback message');
                          document.body.innerHTML = \`
                              <div style="text-align:center;padding:50px;font-family:Arial,sans-serif;">
                                  <h1>❌ Sign-In Error</h1>
                                  <p>Error: ${error}</p>
                                  <p>Please try signing in again from your app.</p>
                                  <button onclick="window.close()" style="padding:10px 20px;margin-top:20px;background:#FF3B30;color:white;border:none;border-radius:8px;cursor:pointer;">
                                      Close This Tab
                                  </button>
                              </div>
                          \`;
                      }
                  };
                  
                  // Start trying links
                  tryNextLink();
              }
          </script>
        </body>
      </html>
    `;
    res.send(html);
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

                 // Send success response with beautiful HTML page
         const html = `
           <!DOCTYPE html>
           <html lang="en">
           <head>
               <meta charset="UTF-8">
               <meta name="viewport" content="width=device-width, initial-scale=1.0">
               <title>Google Sign-In Successful - MeetingGuard AI</title>
               <style>
                   * { margin: 0; padding: 0; box-sizing: border-box; }
                   body { 
                       font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                       background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                       min-height: 100vh;
                       display: flex;
                       align-items: center;
                       justify-content: center;
                       padding: 20px;
                   }
                   .container {
                       background: white;
                       border-radius: 24px;
                       padding: 48px 32px;
                       text-align: center;
                       box-shadow: 0 25px 50px rgba(0,0,0,0.15);
                       max-width: 420px;
                       width: 100%;
                       position: relative;
                       overflow: hidden;
                   }
                   .container::before {
                       content: '';
                       position: absolute;
                       top: 0;
                       left: 0;
                       right: 0;
                       height: 4px;
                       background: linear-gradient(90deg, #10B981, #3B82F6);
                   }
                   .success-icon {
                       width: 72px;
                       height: 72px;
                       background: linear-gradient(135deg, #10B981, #059669);
                       border-radius: 50%;
                       display: flex;
                       align-items: center;
                       justify-content: center;
                       margin: 0 auto 24px;
                       font-size: 36px;
                       color: white;
                       box-shadow: 0 8px 24px rgba(16, 185, 129, 0.3);
                   }
                   h1 {
                       color: #111827;
                       margin-bottom: 12px;
                       font-size: 32px;
                       font-weight: 800;
                       letter-spacing: -0.025em;
                   }
                   .subtitle {
                       color: #6B7280;
                       margin-bottom: 32px;
                       font-size: 18px;
                       font-weight: 500;
                   }
                   .user-info {
                       background: linear-gradient(135deg, #D1FAE5, #A7F3D0);
                       border: 2px solid #10B981;
                       border-radius: 16px;
                       padding: 20px;
                       margin-bottom: 32px;
                   }
                   .user-avatar {
                       width: 60px;
                       height: 60px;
                       border-radius: 50%;
                       margin: 0 auto 16px;
                       border: 3px solid #10B981;
                       object-fit: cover;
                   }
                   .user-name {
                       color: #065F46;
                       font-weight: 700;
                       font-size: 20px;
                       margin-bottom: 8px;
                   }
                   .user-email {
                       color: #047857;
                       font-size: 14px;
                       font-weight: 500;
                   }
                   .countdown-box {
                       background: linear-gradient(135deg, #F0F9FF, #E0F2FE);
                       border: 2px solid #0EA5E9;
                       border-radius: 16px;
                       padding: 24px;
                       margin-bottom: 24px;
                   }
                   .countdown-text {
                       font-size: 20px;
                       font-weight: 700;
                       color: #0C4A6E;
                       margin-bottom: 8px;
                   }
                   .countdown-subtitle {
                       color: #0369A1;
                       font-size: 14px;
                       font-weight: 500;
                   }
                   .countdown-number {
                       color: #0EA5E9;
                       font-size: 24px;
                       font-weight: 800;
                   }
                   .close-button {
                       background: linear-gradient(135deg, #EF4444, #DC2626);
                       color: white;
                       padding: 16px 32px;
                       border: none;
                       border-radius: 12px;
                       font-size: 16px;
                       font-weight: 600;
                       cursor: pointer;
                       width: 100%;
                       transition: all 0.2s ease;
                       box-shadow: 0 4px 12px rgba(239, 68, 68, 0.3);
                   }
                   .close-button:hover {
                       transform: translateY(-2px);
                       box-shadow: 0 6px 16px rgba(239, 68, 68, 0.4);
                   }
                   .close-button:active {
                       transform: translateY(0);
                   }
               </style>
           </head>
             <body>
               <div class="container">
                   <div class="success-icon">✓</div>
                   
                   <h1>Sign-In Complete!</h1>
                   <p class="subtitle">Welcome to MeetingGuard AI</p>
                   
                   <div class="user-info">
                       <img src="${userInfo.picture || 'https://via.placeholder.com/60x60/10B981/FFFFFF?text=' + userInfo.name.charAt(0).toUpperCase()}" 
                            alt="${userInfo.name}" class="user-avatar">
                       <div class="user-name">${userInfo.name}</div>
                       <div class="user-email">${userInfo.email}</div>
                   </div>
                   
                   <div class="countdown-box">
                       <div class="countdown-text">Returning to app in <span class="countdown-number" id="countdown">3</span> seconds...</div>
                       <div class="countdown-subtitle">Or click "Return to App" button below</div>
                   </div>
                   
                   <button class="close-button" onclick="closeTab()">
                       Return to App
                   </button>
               </div>
               
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
                 
                   // Countdown timer
                   var countdown = 3;
                   var countdownElement = document.getElementById('countdown');
                   
                   var timer = setInterval(function() {
                       countdown--;
                       if (countdownElement) {
                           countdownElement.textContent = countdown;
                       }
                       if (countdown <= 0) {
                           clearInterval(timer);
                           closeTab();
                       }
                   }, 1000);
                   
                   // Redirect to app with user info
                   function closeTab() {
                       console.log('Redirecting to app with user info...');
                       
                       // Create deep link with user information
                       const userInfo = ${JSON.stringify(userInfo)};
                       const sessionId = '${sessionId}';
                       
                       // Encode user info for URL
                       const encodedUserInfo = encodeURIComponent(JSON.stringify({
                           sessionId: sessionId,
                           user: userInfo,
                           timestamp: Date.now()
                       }));
                       
                       // Try different app deep links
                       const appLinks = [
                           'meetingguardai://auth-success?data=' + encodedUserInfo,
                           'meetingguardai://dashboard?auth=success&data=' + encodedUserInfo,
                           'meetingguardai://login?success=true&data=' + encodedUserInfo,
                           'exp://192.168.141.51:8081/--/auth-success?data=' + encodedUserInfo,
                           'exp://localhost:8081/--/auth-success?data=' + encodedUserInfo
                       ];
                       
                       // Try each link in sequence
                       let linkIndex = 0;
                       const tryNextLink = () => {
                           if (linkIndex < appLinks.length) {
                               const link = appLinks[linkIndex];
                               console.log('Trying app link:', link);
                               
                               try {
                                   window.location.href = link;
                                   console.log('Redirected to app link:', link);
                                   
                                   // If redirect doesn't work after 2 seconds, try next link
                 setTimeout(() => {
                                       if (document.visibilityState === 'visible') {
                                           linkIndex++;
                                           tryNextLink();
                                       }
                                   }, 2000);
                               } catch (e) {
                                   console.log('Failed to redirect to:', link, e);
                                   linkIndex++;
                                   tryNextLink();
                               }
                           } else {
                               // All app links failed, show fallback message
                               console.log('All app links failed, showing fallback message');
                               document.body.innerHTML = \`
                                   <div style="text-align:center;padding:50px;font-family:Arial,sans-serif;">
                                       <h1>✅ Sign-In Successful!</h1>
                                       <p>Welcome, \${userInfo.name}!</p>
                                       <p>You can now close this tab and return to your app.</p>
                                       <p>Your session ID: \${sessionId}</p>
                                       <button onclick="window.close()" style="padding:10px 20px;margin-top:20px;background:#007AFF;color:white;border:none;border-radius:8px;cursor:pointer;">
                                           Close This Tab
                                       </button>
                                   </div>
                               \`;
                           }
                       };
                       
                       // Start trying links
                       tryNextLink();
                   }
               </script>
             </body>
           </html>
         `;
         
         res.send(html);

      } else {
        console.error('No access token in response:', tokenData);
        throw new Error('Failed to get access token from response');
      }
    } catch (error) {
      console.error('Error processing authorization code:', error);

      const html = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Google Sign-In Error - MeetingGuard AI</title>
            <style>
                * { margin: 0; padding: 0; box-sizing: border-box; }
                body { 
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                    background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
                    min-height: 100vh;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    padding: 20px;
                }
                .container {
                    background: white;
                    border-radius: 24px;
                    padding: 48px 32px;
                    text-align: center;
                    box-shadow: 0 25px 50px rgba(0,0,0,0.15);
                    max-width: 420px;
                    width: 100%;
                    position: relative;
                    overflow: hidden;
                }
                .container::before {
                    content: '';
                    position: absolute;
                    top: 0;
                    left: 0;
                    right: 0;
                    height: 4px;
                    background: linear-gradient(90deg, #EF4444, #DC2626);
                }
                .error-icon {
                    width: 72px;
                    height: 72px;
                    background: linear-gradient(135deg, #EF4444, #DC2626);
                    border-radius: 50%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    margin: 0 auto 24px;
                    font-size: 36px;
                    color: white;
                    box-shadow: 0 8px 24px rgba(239, 68, 68, 0.3);
                }
                h1 {
                    color: #111827;
                    margin-bottom: 12px;
                    font-size: 32px;
                    font-weight: 800;
                    letter-spacing: -0.025em;
                }
                .subtitle {
                    color: #6B7280;
                    margin-bottom: 32px;
                    font-size: 18px;
                    font-weight: 500;
                }
                .error-details {
                    background: linear-gradient(135deg, #FEF2F2, #FEE2E2);
                    border: 2px solid #EF4444;
                    border-radius: 16px;
                    padding: 20px;
                    margin-bottom: 32px;
                }
                .error-message {
                    color: #991B1B;
                    font-weight: 600;
                    font-size: 16px;
                    margin-bottom: 8px;
                }
                .error-description {
                    color: #7F1D1D;
                    font-size: 14px;
                    font-weight: 500;
                }
                .countdown-box {
                    background: linear-gradient(135deg, #F0F9FF, #E0F2FE);
                    border: 2px solid #0EA5E9;
                    border-radius: 16px;
                    padding: 24px;
                    margin-bottom: 24px;
                }
                .countdown-text {
                    font-size: 20px;
                    font-weight: 700;
                    color: #0C4A6E;
                    margin-bottom: 8px;
                }
                .countdown-subtitle {
                    color: #0369A1;
                    font-size: 14px;
                    font-weight: 500;
                }
                .countdown-number {
                    color: #0EA5E9;
                    font-size: 24px;
                    font-weight: 800;
                }
                .close-button {
                    background: linear-gradient(135deg, #6B7280, #4B5563);
                    color: white;
                    padding: 16px 32px;
                    border: none;
                    border-radius: 12px;
                    font-size: 16px;
                    font-weight: 600;
                    cursor: pointer;
                    width: 100%;
                    transition: all 0.2s ease;
                    box-shadow: 0 4px 12px rgba(107, 114, 128, 0.3);
                }
                .close-button:hover {
                    transform: translateY(-2px);
                    box-shadow: 0 6px 16px rgba(107, 114, 128, 0.4);
                }
                .close-button:active {
                    transform: translateY(0);
                }
            </style>
        </head>
          <body>
            <div class="container">
                <div class="error-icon">✕</div>
                
                <h1>Sign-In Failed</h1>
                <p class="subtitle">Something went wrong with Google authentication</p>
                
                <div class="error-details">
                    <div class="error-message">Error: ${error.message}</div>
                    <div class="error-description">Please try signing in again from the app</div>
                </div>
                
                <div class="countdown-box">
                    <div class="countdown-text">Returning to app in <span class="countdown-number" id="countdown">3</span> seconds...</div>
                    <div class="countdown-subtitle">You can close this tab manually if needed</div>
                </div>
                
                <button class="close-button" onclick="closeTab()">
                    Close This Tab
                </button>
            </div>
            
            <script>
                // Countdown timer
                var countdown = 3;
                var countdownElement = document.getElementById('countdown');
                
                var timer = setInterval(function() {
                    countdown--;
                    if (countdownElement) {
                        countdownElement.textContent = countdown;
                    }
                    if (countdown <= 0) {
                        clearInterval(timer);
                        closeTab();
                    }
                }, 1000);
                
                   // Redirect to app with user info
                   function closeTab() {
                       console.log('Redirecting to app with user info...');
                       
                       // Create deep link with user information
                       const userInfo = ${JSON.stringify(userInfo)};
                       const sessionId = '${sessionId}';
                       
                       // Encode user info for URL
                       const encodedUserInfo = encodeURIComponent(JSON.stringify({
                           sessionId: sessionId,
                           user: userInfo,
                           timestamp: Date.now()
                       }));
                       
                       // Try different app deep links
                       const appLinks = [
                           'meetingguardai://auth-success?data=' + encodedUserInfo,
                           'meetingguardai://dashboard?auth=success&data=' + encodedUserInfo,
                           'meetingguardai://login?success=true&data=' + encodedUserInfo,
                           'exp://192.168.141.51:8081/--/auth-success?data=' + encodedUserInfo,
                           'exp://localhost:8081/--/auth-success?data=' + encodedUserInfo
                       ];
                       
                       // Try each link in sequence
                       let linkIndex = 0;
                       const tryNextLink = () => {
                           if (linkIndex < appLinks.length) {
                               const link = appLinks[linkIndex];
                               console.log('Trying app link:', link);
                               
                               try {
                                   window.location.href = link;
                                   console.log('Redirected to app link:', link);
                                   
                                   // If redirect doesn't work after 2 seconds, try next link
              setTimeout(() => {
                                       if (document.visibilityState === 'visible') {
                                           linkIndex++;
                                           tryNextLink();
                                       }
              }, 2000);
                               } catch (e) {
                                   console.log('Failed to redirect to:', link, e);
                                   linkIndex++;
                                   tryNextLink();
                               }
                           } else {
                               // All app links failed, show fallback message
                               console.log('All app links failed, showing fallback message');
                               document.body.innerHTML = \`
                                   <div style="text-align:center;padding:50px;font-family:Arial,sans-serif;">
                                       <h1>✅ Sign-In Successful!</h1>
                                       <p>Welcome, \${userInfo.name}!</p>
                                       <p>You can now close this tab and return to your app.</p>
                                       <p>Your session ID: \${sessionId}</p>
                                       <button onclick="window.close()" style="padding:10px 20px;margin-top:20px;background:#007AFF;color:white;border:none;border-radius:8px;cursor:pointer;">
                                           Close This Tab
                                       </button>
                                   </div>
                               \`;
                           }
                       };
                       
                       // Start trying links
                       tryNextLink();
                   }
            </script>
          </body>
        </html>
      `;
      res.send(html);
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

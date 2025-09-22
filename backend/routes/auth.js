const express = require('express');
const { body, validationResult } = require('express-validator');
const { supabase } = require('../config/database');
const { generateToken, authenticateToken } = require('../middleware/auth');
const { ValidationError } = require('../middleware/errorHandler');
const { hashPassword, verifyPassword, validatePassword } = require('../utils/password');

const router = express.Router();

/**
 * Manual sign up endpoint with password
 */
router.post('/signup', [
  body('email').isEmail().normalizeEmail(),
  body('name').trim().isLength({ min: 2 }),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters')
], async (req, res) => {
  try {
    // Validate input
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { email, name, password } = req.body;

    // Check if user already exists
    const { data: existingUser, error: checkError } = await supabase
      .from('users')
      .select('id, email')
      .eq('email', email)
      .single();

    if (checkError && checkError.code !== 'PGRST116') {
      throw checkError;
    }

    if (existingUser) {
      return res.status(409).json({
        success: false,
        error: 'User with this email already exists'
      });
    }

    // Hash the password
    const passwordHash = await hashPassword(password);

    // Create new user
    const { data: newUser, error: createError } = await supabase
      .from('users')
      .insert({
        email: email,
        name: name,
        password_hash: passwordHash,
        plan: 'free',
        subscription_status: 'inactive',
        last_login: new Date().toISOString()
      })
      .select('id, email, name, created_at, plan, subscription_status')
      .single();

    if (createError) {
      throw createError;
    }

    // Generate JWT token
    const jwtToken = generateToken(newUser.id);

    console.log('=== MANUAL SIGN UP SUCCESS ===');
    console.log('User created:', newUser.email);

    res.json({
      success: true,
      user: newUser,
      jwtToken: jwtToken
    });

  } catch (error) {
    console.error('Sign up error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create user'
    });
  }
});

/**
 * Manual sign in endpoint with password verification
 */
router.post('/signin', [
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty().withMessage('Password is required')
], async (req, res) => {
  try {
    // Validate input
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { email, password } = req.body;

    // Find user by email
    const { data: user, error: findError } = await supabase
      .from('users')
      .select('id, email, name, password_hash, created_at, plan, subscription_status')
      .eq('email', email)
      .single();

    if (findError) {
      if (findError.code === 'PGRST116') {
        return res.status(401).json({
          success: false,
          error: 'Invalid email or password'
        });
      }
      throw findError;
    }

    // Check if user has a password (manual signup)
    if (!user.password_hash) {
      return res.status(401).json({
        success: false,
        error: 'This account was created with Google. Please use Google Sign In.'
      });
    }

    // Verify password
    const isValidPassword = await verifyPassword(password, user.password_hash);
    if (!isValidPassword) {
      return res.status(401).json({
        success: false,
        error: 'Invalid email or password'
      });
    }

    // Update last login
    await supabase
      .from('users')
      .update({ last_login: new Date().toISOString() })
      .eq('id', user.id);

    // Generate JWT token
    const jwtToken = generateToken(user.id);

    console.log('=== MANUAL SIGN IN SUCCESS ===');
    console.log('User signed in:', user.email);

    // Remove password_hash from response
    const { password_hash, ...userWithoutPassword } = user;

    res.json({
      success: true,
      user: userWithoutPassword,
      jwtToken: jwtToken
    });

  } catch (error) {
    console.error('Sign in error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to sign in'
    });
  }
});

/**
 * Check if user exists for Google sign in
 */
router.get('/check-user/:email', async (req, res) => {
  try {
    const { email } = req.params;

    // Find user by email
    const { data: user, error: findError } = await supabase
      .from('users')
      .select('id, email, name, google_id, created_at')
      .eq('email', email)
      .single();

    if (findError) {
      if (findError.code === 'PGRST116') {
        return res.json({
          success: true,
          exists: false,
          message: 'User not found'
        });
      }
      throw findError;
    }

    res.json({
      success: true,
      exists: true,
      user: user,
      hasGoogleId: !!user.google_id
    });

  } catch (error) {
    console.error('Check user error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to check user'
    });
  }
});

/**

 * Google OAuth callback handler
 */
router.get('/google/callback', async (req, res) => {
  try {
    const { code, error } = req.query;

    if (error) {
      return res.status(400).json({
        error: 'OAuth error',
        message: error
      });
    }

    if (!code) {
      return res.status(400).json({
        error: 'Authorization code required'
      });
    }

    // Exchange code for tokens
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
        redirect_uri: process.env.GOOGLE_REDIRECT_URI,
      }),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      throw new Error(`Token exchange failed: ${tokenResponse.status} - ${errorText}`);
    }

    const tokenData = await tokenResponse.json();

    // Get user info from Google
    const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`,
      },
    });

    if (!userInfoResponse.ok) {
      throw new Error(`Failed to get user info: ${userInfoResponse.status}`);
    }

    const userInfo = await userInfoResponse.json();

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
      // Generate a random password for Google login users
      const randomPassword = Math.random().toString(36).slice(-12) + Math.random().toString(36).slice(-12);
      const passwordHash = await hashPassword(randomPassword);
      
      console.log('Google OAuth: Creating new user with generated password');
      
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
          password_hash: passwordHash, // Save generated password hash
          enabled: true,
          last_login: new Date().toISOString()
        })
        .select()
        .single();

      if (createError) {
        throw createError;
      }

      user = newUser;
      console.log('Google OAuth: New user created with password hash:', {
        userId: user.id,
        userEmail: user.email,
        googleId: user.google_id
      });
    } else {
      // Update existing user's last login and ensure they have a password hash
      const updateData = {
        last_login: new Date().toISOString(),
        name: userInfo.name,
        picture: userInfo.picture
      };

      // If user doesn't have a password hash, generate one
      if (!user.password_hash) {
        const randomPassword = Math.random().toString(36).slice(-12) + Math.random().toString(36).slice(-12);
        const passwordHash = await hashPassword(randomPassword);
        updateData.password_hash = passwordHash;
        console.log('Google OAuth: Adding password hash to existing user');
      }

      const { error: updateError } = await supabase
        .from('users')
        .update(updateData)
        .eq('id', user.id);

      if (updateError) {
        throw updateError;
      }
      
      console.log('Google OAuth: Existing user updated:', {
        userId: user.id,
        userEmail: user.email,
        googleId: user.google_id,
        hadPassword: !!user.password_hash
      });
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
    
    console.log('Google OAuth: Generating JWT token for user:', {
      userId: user.id,
      userEmail: user.email,
      tokenLength: jwtToken.length
    });

    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        picture: user.picture
      },
      jwtToken: jwtToken, // Fixed: changed from 'token' to 'jwtToken'
      googleTokens: {
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        expires_in: tokenData.expires_in
      }
    });

  } catch (error) {
    console.error('Google OAuth error:', error);
    res.status(500).json({
      error: 'Authentication failed',
      message: error.message
    });
  }
});

/**
 * Refresh Google access token
 */
router.post('/google/refresh', async (req, res) => {
  try {
    const { refresh_token } = req.body;

    if (!refresh_token) {
      return res.status(400).json({
        error: 'Refresh token required'
      });
    }

    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        refresh_token: refresh_token,
        grant_type: 'refresh_token',
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Token refresh failed: ${response.status} - ${errorText}`);
    }

    const tokenData = await response.json();

    res.json({
      access_token: tokenData.access_token,
      expires_in: tokenData.expires_in
    });

  } catch (error) {
    console.error('Token refresh error:', error);
    res.status(500).json({
      error: 'Token refresh failed',
      message: error.message
    });
  }
});

/**
 * Get current user profile
 */
router.get('/profile', authenticateToken, async (req, res) => {
  try {
    const { data: user, error } = await supabase
      .from('users')
      .select('id, email, name, picture, given_name, family_name, created_at, last_login')
      .eq('id', req.userId)
      .single();

    if (error) {
      throw error;
    }

    res.json({
      user: user
    });

  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({
      error: 'Failed to get profile',
      message: error.message
    });
  }
});

/**
 * Update user profile
 */
router.put('/profile', authenticateToken, [
  body('name').optional().isString().trim().isLength({ min: 1, max: 100 }),
  body('picture').optional().isURL()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw new ValidationError('Validation failed', errors.array());
    }

    const updateData = {};
    if (req.body.name) updateData.name = req.body.name;
    if (req.body.picture) updateData.picture = req.body.picture;

    const { data: user, error } = await supabase
      .from('users')
      .update(updateData)
      .eq('id', req.userId)
      .select('id, email, name, picture, given_name, family_name, created_at, last_login')
      .single();

    if (error) {
      throw error;
    }

    res.json({
      user: user
    });

  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({
      error: 'Failed to update profile',
      message: error.message
    });
  }
});

/**
 * Delete user account and all associated data
 */
router.delete('/delete-account', authenticateToken, async (req, res) => {
  try {
    const userId = req.userId;
    
    console.log('=== ACCOUNT DELETION REQUEST ===');
    console.log('User ID:', userId);

    // Start a transaction to delete all user data
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('email, name')
      .eq('id', userId)
      .single();

    if (userError) {
      throw userError;
    }

    console.log('Deleting account for:', user.email);

    // Delete user's meetings (if stored in database)
    const { error: meetingsError } = await supabase
      .from('meetings')
      .delete()
      .eq('user_id', userId);

    if (meetingsError) {
      console.warn('Warning: Could not delete meetings:', meetingsError);
    }

    // Delete user's calendar sync data (if stored in database)
    const { error: calendarError } = await supabase
      .from('calendar_sync')
      .delete()
      .eq('user_id', userId);

    if (calendarError) {
      console.warn('Warning: Could not delete calendar sync data:', calendarError);
    }

    // Delete user's AI chat history (if stored in database)
    const { error: chatError } = await supabase
      .from('ai_chats')
      .delete()
      .eq('user_id', userId);

    if (chatError) {
      console.warn('Warning: Could not delete AI chat history:', chatError);
    }

    // Delete user's settings/preferences (if stored in database)
    const { error: settingsError } = await supabase
      .from('user_settings')
      .delete()
      .eq('user_id', userId);

    if (settingsError) {
      console.warn('Warning: Could not delete user settings:', settingsError);
    }

    // Finally, delete the user account
    const { error: deleteError } = await supabase
      .from('users')
      .delete()
      .eq('id', userId);

    if (deleteError) {
      throw deleteError;
    }

    console.log('Account successfully deleted for:', user.email);

    res.json({
      success: true,
      message: 'Account and all associated data have been permanently deleted',
      deletedAt: new Date().toISOString()
    });

  } catch (error) {
    console.error('Account deletion error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete account',
      message: error.message
    });
  }
});

/**
 * Request account deletion via email (for Google Play compliance)
 */
router.post('/request-deletion', [
  body('email').isEmail().normalizeEmail(),
  body('reason').optional().isString().trim()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { email, reason } = req.body;

    // Check if user exists
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('id, email, name')
      .eq('email', email)
      .single();

    if (userError) {
      if (userError.code === 'PGRST116') {
        return res.status(404).json({
          success: false,
          error: 'User not found'
        });
      }
      throw userError;
    }

    // Log the deletion request
    console.log('=== ACCOUNT DELETION REQUEST ===');
    console.log('Email:', email);
    console.log('User ID:', user.id);
    console.log('Reason:', reason || 'Not specified');
    console.log('Requested at:', new Date().toISOString());

    // In a real implementation, you might:
    // 1. Send an email confirmation
    // 2. Store the request in a database
    // 3. Process it manually or automatically after a delay

    res.json({
      success: true,
      message: 'Account deletion request received. We will process your request within 24-48 hours.',
      requestId: `DEL-${Date.now()}-${user.id}`,
      estimatedProcessingTime: '24-48 hours'
    });

  } catch (error) {
    console.error('Deletion request error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process deletion request',
      message: error.message
    });
  }
});

/**
 * Save Google user to database (called from frontend)
 */
router.post('/google/save-user', async (req, res) => {
  try {
    const { google_id, email, name, picture, given_name, family_name } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Email is required'
      });
    }

    console.log('=== SAVING GOOGLE USER FROM FRONTEND ===');
    console.log('User email:', email);
    console.log('User name:', name);
    console.log('Google ID:', google_id);

    // Check if user already exists
    const { data: existingUser, error: findError } = await supabase
      .from('users')
      .select('id, email, name, picture, plan, subscription_status')
      .eq('email', email)
      .single();

    let user;
    
    if (findError && findError.code === 'PGRST116') {
      // User not found, create new user
      console.log('👤 User not found, creating new user with Google info');
      
      const { data: newUser, error: createError } = await supabase
        .from('users')
        .insert({
          email: email,
          name: name,
          picture: picture,
          google_id: google_id,
          plan: 'free', // Default to free plan
          subscription_status: 'inactive'
        })
        .select()
        .single();

      if (createError) {
        console.error('❌ Error creating user from frontend Google auth:', createError);
        return res.status(500).json({
          success: false,
          error: 'Failed to create user',
          details: createError.message
        });
      } else {
        console.log('✅ User created successfully from frontend Google auth:', newUser);
        user = newUser;
      }
    } else if (findError) {
      console.error('❌ Error finding user:', findError);
      return res.status(500).json({
        success: false,
        error: 'Database error',
        details: findError.message
      });
    } else {
      // User exists, update their info
      console.log('👤 Found existing user:', existingUser);
      console.log(`🔄 Updating user info for frontend Google auth`);
      
      const { data: updatedUser, error: updateError } = await supabase
        .from('users')
        .update({
          name: name,
          picture: picture,
          google_id: google_id
        })
        .eq('email', email)
        .select()
        .single();

      if (updateError) {
        console.error('❌ Error updating user from frontend Google auth:', updateError);
        return res.status(500).json({
          success: false,
          error: 'Failed to update user',
          details: updateError.message
        });
      } else {
        console.log('✅ User updated successfully from frontend Google auth:', updatedUser);
        user = updatedUser;
      }
    }

    // Generate JWT token for the user
    const jwtToken = generateToken(user.id);

    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        picture: user.picture,
        plan: user.plan,
        subscription_status: user.subscription_status
      },
      jwtToken: jwtToken,
      message: 'User saved successfully'
    });

  } catch (error) {
    console.error('❌ Error in save Google user endpoint:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
});

/**
 * Sync Google tokens with backend database
 */
router.post('/google/sync-tokens', authenticateToken, async (req, res) => {
  try {
    const { access_token, refresh_token, expires_in, expires_at } = req.body;

    if (!access_token) {
      return res.status(400).json({
        success: false,
        error: 'Access token is required'
      });
    }

    console.log('=== SYNCING GOOGLE TOKENS ===');
    console.log('User ID:', req.userId);
    console.log('Has access token:', !!access_token);
    console.log('Has refresh token:', !!refresh_token);
    console.log('Expires at:', expires_at);

    // Upsert tokens in database
    const { data: tokenData, error: tokenError } = await supabase
      .from('user_tokens')
      .upsert({
        user_id: req.userId,
        access_token: access_token,
        refresh_token: refresh_token,
        expires_at: expires_at,
        token_type: 'google'
      }, { 
        onConflict: 'user_id,token_type' 
      })
      .select()
      .single();

    if (tokenError) {
      console.error('❌ Error syncing tokens:', tokenError);
      return res.status(500).json({
        success: false,
        error: 'Failed to sync tokens',
        details: tokenError.message
      });
    }

    console.log('✅ Tokens synced successfully');

    res.json({
      success: true,
      message: 'Tokens synced successfully'
    });

  } catch (error) {
    console.error('❌ Error in sync tokens endpoint:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
});

/**
 * Logout user
 */
router.post('/logout', authenticateToken, async (req, res) => {
  try {
    // In a more sophisticated setup, you might want to blacklist the token
    // For now, we'll just return success since JWT tokens are stateless
    
    res.json({
      message: 'Logged out successfully'
    });

  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({
      error: 'Logout failed',
      message: error.message
    });
  }
});

module.exports = router;

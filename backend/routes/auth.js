const express = require('express');
const { body, validationResult } = require('express-validator');
const { supabase } = require('../config/database');
<<<<<<< HEAD
const { generateToken } = require('../middleware/auth');
const { ValidationError } = require('../middleware/errorHandler');
=======
const { generateToken, authenticateToken } = require('../middleware/auth');
const { ValidationError } = require('../middleware/errorHandler');
const { hashPassword, verifyPassword, validatePassword } = require('../utils/password');
>>>>>>> snow

const router = express.Router();

/**
<<<<<<< HEAD
=======
 * Manual sign up endpoint
 */
router.post('/signup', [
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 6 }),
  body('name').trim().isLength({ min: 2 })
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

    const { email, password, name } = req.body;

    // Validate password strength
    const passwordValidation = validatePassword(password);
    if (!passwordValidation.isValid) {
      return res.status(400).json({
        success: false,
        error: passwordValidation.message
      });
    }

    // Check if user already exists
    const { data: existingUser, error: checkError } = await supabase
      .from('users')
      .select('id, email, google_id')
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

    // Hash password
    const passwordHash = await hashPassword(password);

    // Create new user
    const { data: newUser, error: createError } = await supabase
      .from('users')
      .insert({
        email: email,
        name: name,
        password_hash: passwordHash,
        is_active: true,
        last_login: new Date().toISOString()
      })
      .select('id, email, name, created_at, last_login')
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
 * Manual sign in endpoint
 */
router.post('/signin', [
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty()
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
      .select('id, email, name, password_hash, google_id, created_at, last_login')
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

    // Check if user has password (manual user)
    if (!user.password_hash) {
      return res.status(401).json({
        success: false,
        error: 'This account was created with Google. Please use Google sign in.'
      });
    }

    // Verify password
    const isPasswordValid = await verifyPassword(password, user.password_hash);
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        error: 'Invalid email or password'
      });
    }

    // Update last login
    const { error: updateError } = await supabase
      .from('users')
      .update({ last_login: new Date().toISOString() })
      .eq('id', user.id);

    if (updateError) {
      console.error('Error updating last login:', updateError);
    }

    // Remove password_hash from response
    const { password_hash, ...userWithoutPassword } = user;

    // Generate JWT token
    const jwtToken = generateToken(user.id);

    console.log('=== MANUAL SIGN IN SUCCESS ===');
    console.log('User signed in:', user.email);

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
>>>>>>> snow
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

    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        picture: user.picture
      },
      token: jwtToken,
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
<<<<<<< HEAD
router.get('/profile', async (req, res) => {
=======
router.get('/profile', authenticateToken, async (req, res) => {
>>>>>>> snow
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
<<<<<<< HEAD
router.put('/profile', [
=======
router.put('/profile', authenticateToken, [
>>>>>>> snow
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
 * Logout user
 */
<<<<<<< HEAD
router.post('/logout', async (req, res) => {
=======
router.post('/logout', authenticateToken, async (req, res) => {
>>>>>>> snow
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

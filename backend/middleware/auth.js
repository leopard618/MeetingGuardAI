const jwt = require('jsonwebtoken');
const { supabase } = require('../config/database');

/**
 * Middleware to authenticate JWT tokens
 */
const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      return res.status(401).json({
        error: 'Access token required',
        message: 'Please provide a valid authentication token'
      });
    }

    // Verify JWT token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    console.log('Auth middleware: JWT decoded:', {
      userId: decoded.userId,
      iat: decoded.iat,
      exp: decoded.exp
    });
    
    // Get user from database to ensure they still exist
    const { data: user, error } = await supabase
      .from('users')
      .select('id, email, name, picture, enabled')
      .eq('id', decoded.userId)
      .single();

    console.log('Auth middleware: Database query result:', {
      user: user ? { id: user.id, email: user.email, enabled: user.enabled } : null,
      error: error ? { code: error.code, message: error.message } : null
    });

    if (error || !user) {
      console.log('Auth middleware: User not found or error:', error);
      return res.status(401).json({
        error: 'Invalid token',
        message: 'User not found or account deactivated'
      });
    }

    if (!user.enabled) {
      return res.status(401).json({
        error: 'Account deactivated',
        message: 'Your account has been deactivated'
      });
    }

    // Add user info to request
    req.user = user;
    req.userId = user.id;
    
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        error: 'Token expired',
        message: 'Your session has expired. Please log in again.'
      });
    }
    
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        error: 'Invalid token',
        message: 'Invalid authentication token'
      });
    }

    console.error('Auth middleware error:', error);
    return res.status(500).json({
      error: 'Authentication error',
      message: 'Internal server error during authentication'
    });
  }
};

/**
 * Optional authentication - doesn't fail if no token provided
 */
const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return next(); // Continue without authentication
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    const { data: user, error } = await supabase
      .from('users')
      .select('id, email, name, picture, enabled')
      .eq('id', decoded.userId)
      .single();

    if (!error && user && user.enabled) {
      req.user = user;
      req.userId = user.id;
    }
    
    next();
  } catch (error) {
    // Continue without authentication if token is invalid
    next();
  }
};

/**
 * Generate JWT token for user
 */
const generateToken = (userId) => {
  return jwt.sign(
    { userId },
    process.env.JWT_SECRET,
    { expiresIn: '7d' } // 7 days
  );
};

/**
 * Refresh JWT token
 */
const refreshToken = (req, res) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({
        error: 'Refresh token required'
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const newToken = generateToken(decoded.userId);

    res.json({
      token: newToken,
      expiresIn: '7d'
    });
  } catch (error) {
    res.status(401).json({
      error: 'Invalid refresh token'
    });
  }
};

module.exports = {
  authenticateToken,
  optionalAuth,
  generateToken,
  refreshToken
};

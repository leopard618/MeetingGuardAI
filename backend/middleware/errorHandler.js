/**
 * Global error handling middleware
 */
const errorHandler = (err, req, res, next) => {
  console.error('Error:', err);

  // Default error
  let error = {
    message: 'Internal Server Error',
    status: 500
  };

  // Handle specific error types
  if (err.name === 'ValidationError') {
    error = {
      message: 'Validation Error',
      status: 400,
      details: err.details || err.message
    };
  } else if (err.name === 'UnauthorizedError') {
    error = {
      message: 'Unauthorized',
      status: 401
    };
  } else if (err.name === 'ForbiddenError') {
    error = {
      message: 'Forbidden',
      status: 403
    };
  } else if (err.name === 'NotFoundError') {
    error = {
      message: 'Resource not found',
      status: 404
    };
  } else if (err.name === 'ConflictError') {
    error = {
      message: 'Resource conflict',
      status: 409
    };
  } else if (err.code === 'PGRST116') {
    // Supabase specific error
    error = {
      message: 'Resource not found',
      status: 404
    };
  } else if (err.code === '23505') {
    // PostgreSQL unique constraint violation
    error = {
      message: 'Resource already exists',
      status: 409
    };
  } else if (err.message) {
    error.message = err.message;
    error.status = err.status || 500;
  }

  // Don't leak error details in production
  if (process.env.NODE_ENV === 'production' && error.status === 500) {
    error.message = 'Internal Server Error';
    error.details = undefined;
  }

  res.status(error.status).json({
    error: error.message,
    ...(error.details && { details: error.details }),
    timestamp: new Date().toISOString(),
    path: req.originalUrl
  });
};

/**
 * Custom error classes
 */
class ValidationError extends Error {
  constructor(message, details) {
    super(message);
    this.name = 'ValidationError';
    this.details = details;
  }
}

class UnauthorizedError extends Error {
  constructor(message = 'Unauthorized') {
    super(message);
    this.name = 'UnauthorizedError';
    this.status = 401;
  }
}

class ForbiddenError extends Error {
  constructor(message = 'Forbidden') {
    super(message);
    this.name = 'ForbiddenError';
    this.status = 403;
  }
}

class NotFoundError extends Error {
  constructor(message = 'Resource not found') {
    super(message);
    this.name = 'NotFoundError';
    this.status = 404;
  }
}

class ConflictError extends Error {
  constructor(message = 'Resource conflict') {
    super(message);
    this.name = 'ConflictError';
    this.status = 409;
  }
}

module.exports = {
  errorHandler,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError
};

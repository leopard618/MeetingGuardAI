-- Add password fields to users table for manual authentication
-- Run this in Supabase SQL Editor

-- Add password-related columns to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login TIMESTAMP WITH TIME ZONE;

-- Add index for password_hash (though we won't query by it directly)
CREATE INDEX IF NOT EXISTS idx_users_password_hash ON users(password_hash);

-- Update existing users to have default values
UPDATE users SET 
  last_login = NOW()
WHERE last_login IS NULL;

-- Success message
SELECT 'Password fields added successfully!' as status;

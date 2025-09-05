-- Add subscription fields to users table
-- Run this in Supabase SQL Editor

-- Add subscription-related columns to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS plan VARCHAR(50) DEFAULT 'free';
ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_status VARCHAR(20) DEFAULT 'inactive';
ALTER TABLE users ADD COLUMN IF NOT EXISTS current_period_end TIMESTAMP WITH TIME ZONE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_customer_id VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id VARCHAR(255);

-- Add indexes for better performance
CREATE INDEX IF NOT EXISTS idx_users_plan ON users(plan);
CREATE INDEX IF NOT EXISTS idx_users_subscription_status ON users(subscription_status);
CREATE INDEX IF NOT EXISTS idx_users_stripe_customer_id ON users(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id);

-- Update existing users to have default values
UPDATE users SET 
  plan = 'free',
  subscription_status = 'inactive'
WHERE plan IS NULL OR subscription_status IS NULL;

-- Success message
SELECT 'Subscription fields added successfully!' as status;
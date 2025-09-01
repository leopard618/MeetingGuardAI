-- Add subscription and billing fields to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_customer_id VARCHAR(255) UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS plan VARCHAR(50) DEFAULT 'free';
ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_status VARCHAR(50) DEFAULT 'inactive';
ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_id VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS current_period_end TIMESTAMP WITH TIME ZONE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'user';
ALTER TABLE users ADD COLUMN IF NOT EXISTS enabled BOOLEAN DEFAULT true;

-- Create usage tracking table
CREATE TABLE IF NOT EXISTS user_usage (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    ai_requests INTEGER DEFAULT 0,
    meeting_requests INTEGER DEFAULT 0,
    total_requests INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, date)
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_users_stripe_customer_id ON users(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_users_plan ON users(plan);
CREATE INDEX IF NOT EXISTS idx_users_subscription_status ON users(subscription_status);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_user_usage_user_id ON user_usage(user_id);
CREATE INDEX IF NOT EXISTS idx_user_usage_date ON user_usage(date);
CREATE INDEX IF NOT EXISTS idx_user_usage_user_date ON user_usage(user_id, date);

-- Enable RLS on user_usage table
ALTER TABLE user_usage ENABLE ROW LEVEL SECURITY;

-- Create RLS policy for user_usage
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can manage own usage' AND tablename = 'user_usage') THEN
        CREATE POLICY "Users can manage own usage" ON user_usage FOR ALL USING (auth.uid()::text = user_id::text);
    END IF;
END $$;

DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow service role full access to usage' AND tablename = 'user_usage') THEN
        CREATE POLICY "Allow service role full access to usage" ON user_usage FOR ALL USING (auth.role() = 'service_role');
    END IF;
END $$;

-- Create trigger for automatic timestamp updates on user_usage
CREATE TRIGGER update_user_usage_updated_at BEFORE UPDATE ON user_usage FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Add check constraints for valid values
ALTER TABLE users ADD CONSTRAINT users_plan_check CHECK (plan IN ('free', 'pro_monthly', 'pro_yearly', 'premium_monthly', 'premium_yearly'));
ALTER TABLE users ADD CONSTRAINT users_subscription_status_check CHECK (subscription_status IN ('inactive', 'active', 'trialing', 'past_due', 'canceled', 'unpaid'));
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('user', 'admin'));

-- Add password_hash column to existing users table for manual authentication
-- This script only adds the new column without recreating existing tables

-- Add password_hash column to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255) NULL;

-- Add constraint to ensure either google_id or password_hash is present
-- First drop the constraint if it exists to avoid errors
DO $$ 
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'users_auth_method_check' 
        AND table_name = 'users'
    ) THEN
        ALTER TABLE users DROP CONSTRAINT users_auth_method_check;
    END IF;
END $$;

-- Add the constraint
ALTER TABLE users ADD CONSTRAINT users_auth_method_check 
    CHECK ((google_id IS NOT NULL) OR (password_hash IS NOT NULL));

-- Add index for password_hash column
CREATE INDEX IF NOT EXISTS idx_users_password_hash ON users(password_hash);

-- Add service role policy for users table if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow service role full access' AND tablename = 'users') THEN
        CREATE POLICY "Allow service role full access" ON users FOR ALL USING (auth.role() = 'service_role');
    END IF;
END $$;

-- Add service role policy for user_tokens table if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow service role full access to tokens' AND tablename = 'user_tokens') THEN
        CREATE POLICY "Allow service role full access to tokens" ON user_tokens FOR ALL USING (auth.role() = 'service_role');
    END IF;
END $$;

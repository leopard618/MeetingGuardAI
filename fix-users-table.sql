-- Fix Users Table - Add Missing Columns
-- Run this in your Supabase SQL Editor to fix the users table

-- Add missing columns to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS picture TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS given_name TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS family_name TEXT;

-- Add indexes for better performance
CREATE INDEX IF NOT EXISTS idx_users_picture ON users(picture);
CREATE INDEX IF NOT EXISTS idx_users_given_name ON users(given_name);
CREATE INDEX IF NOT EXISTS idx_users_family_name ON users(family_name);

-- Success message
SELECT 'Users table fixed successfully! Added picture, given_name, and family_name columns.' as status;

-- Database Cleanup Script
-- Run this in your Supabase SQL Editor to clean up duplicate meetings and reset the database

-- 1. Delete all meetings (this will also delete related records due to CASCADE)
DELETE FROM meetings;

-- 2. Delete all calendar events
DELETE FROM calendar_events;

-- 3. Delete all meeting participants
DELETE FROM meeting_participants;

-- 4. Delete all meeting attachments
DELETE FROM meeting_attachments;

-- 5. Delete all notes
DELETE FROM notes;

-- 6. Delete all user tokens (this will require users to re-authenticate)
DELETE FROM user_tokens;

-- 7. Delete all user usage records
DELETE FROM user_usage;

-- 8. Delete all API keys
DELETE FROM api_keys;

-- 9. Delete all user preferences
DELETE FROM user_preferences;

-- 10. Reset user data (keep users but clear some fields)
UPDATE users SET 
  last_login = NULL,
  updated_at = NOW();

-- Success message
SELECT 'Database cleaned up successfully! All meetings, events, and related data have been removed.' as status;

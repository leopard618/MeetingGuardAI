-- Fix Missing Tables - Run this in your Supabase SQL Editor
-- This script adds the missing meeting_participants and meeting_attachments tables

-- Create meeting_participants table
CREATE TABLE IF NOT EXISTS meeting_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id UUID REFERENCES meetings(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  name TEXT,
  role VARCHAR(20) DEFAULT 'participant',
  status VARCHAR(20) DEFAULT 'pending',
  response_status VARCHAR(20) DEFAULT 'no_response',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(meeting_id, email)
);

-- Create meeting_attachments table
CREATE TABLE IF NOT EXISTS meeting_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id UUID REFERENCES meetings(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_size INTEGER,
  file_type TEXT,
  uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS for the new tables
ALTER TABLE meeting_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting_attachments ENABLE ROW LEVEL SECURITY;

-- RLS Policies for meeting_participants
CREATE POLICY "Users can view meeting participants" ON meeting_participants FOR SELECT USING (
  auth.uid() = user_id OR 
  auth.uid() IN (SELECT user_id FROM meetings WHERE id = meeting_id)
);
CREATE POLICY "Users can insert meeting participants" ON meeting_participants FOR INSERT WITH CHECK (
  auth.uid() IN (SELECT user_id FROM meetings WHERE id = meeting_id)
);
CREATE POLICY "Users can update meeting participants" ON meeting_participants FOR UPDATE USING (
  auth.uid() = user_id OR 
  auth.uid() IN (SELECT user_id FROM meetings WHERE id = meeting_id)
);
CREATE POLICY "Users can delete meeting participants" ON meeting_participants FOR DELETE USING (
  auth.uid() = user_id OR 
  auth.uid() IN (SELECT user_id FROM meetings WHERE id = meeting_id)
);

-- RLS Policies for meeting_attachments
CREATE POLICY "Users can view meeting attachments" ON meeting_attachments FOR SELECT USING (
  auth.uid() = user_id OR 
  auth.uid() IN (SELECT user_id FROM meetings WHERE id = meeting_id)
);
CREATE POLICY "Users can insert meeting attachments" ON meeting_attachments FOR INSERT WITH CHECK (
  auth.uid() = user_id AND 
  auth.uid() IN (SELECT user_id FROM meetings WHERE id = meeting_id)
);
CREATE POLICY "Users can update meeting attachments" ON meeting_attachments FOR UPDATE USING (
  auth.uid() = user_id AND 
  auth.uid() IN (SELECT user_id FROM meetings WHERE id = meeting_id)
);
CREATE POLICY "Users can delete meeting attachments" ON meeting_attachments FOR DELETE USING (
  auth.uid() = user_id AND 
  auth.uid() IN (SELECT user_id FROM meetings WHERE id = meeting_id)
);

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_meeting_participants_meeting_id ON meeting_participants(meeting_id);
CREATE INDEX IF NOT EXISTS idx_meeting_participants_user_id ON meeting_participants(user_id);
CREATE INDEX IF NOT EXISTS idx_meeting_participants_email ON meeting_participants(email);
CREATE INDEX IF NOT EXISTS idx_meeting_participants_status ON meeting_participants(status);

CREATE INDEX IF NOT EXISTS idx_meeting_attachments_meeting_id ON meeting_attachments(meeting_id);
CREATE INDEX IF NOT EXISTS idx_meeting_attachments_user_id ON meeting_attachments(user_id);
CREATE INDEX IF NOT EXISTS idx_meeting_attachments_file_type ON meeting_attachments(file_type);

-- Success message
SELECT 'Missing tables created successfully! Added meeting_participants and meeting_attachments tables with proper relationships.' as status;

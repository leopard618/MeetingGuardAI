-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  picture TEXT,
  created_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_date TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Meetings table
CREATE TABLE IF NOT EXISTS meetings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title VARCHAR(255) NOT NULL,
  description TEXT,
  date DATE NOT NULL,
  time TIME NOT NULL,
  duration INTEGER, -- in minutes
  location TEXT,
  meeting_type VARCHAR(20) NOT NULL DEFAULT 'physical' CHECK (meeting_type IN ('physical', 'virtual', 'hybrid')),
  platform VARCHAR(50),
  meeting_link TEXT,
  participants TEXT[], -- array of email addresses
  attachments TEXT[], -- array of file URLs
  created_by VARCHAR(255) NOT NULL REFERENCES users(email) ON DELETE CASCADE,
  created_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_date TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Notes table
CREATE TABLE IF NOT EXISTS notes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  meeting_id UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_by VARCHAR(255) NOT NULL REFERENCES users(email) ON DELETE CASCADE,
  created_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_date TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- API Keys table
CREATE TABLE IF NOT EXISTS api_keys (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  key VARCHAR(255) UNIQUE NOT NULL,
  company_name VARCHAR(255) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'revoked')),
  usage_count INTEGER DEFAULT 0,
  created_by VARCHAR(255) NOT NULL REFERENCES users(email) ON DELETE CASCADE,
  created_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_date TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- User Preferences table
CREATE TABLE IF NOT EXISTS user_preferences (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_email VARCHAR(255) NOT NULL REFERENCES users(email) ON DELETE CASCADE,
  alert_intensity VARCHAR(20) DEFAULT 'maximum' CHECK (alert_intensity IN ('light', 'medium', 'maximum')),
  sound_enabled BOOLEAN DEFAULT true,
  vibration_enabled BOOLEAN DEFAULT true,
  speech_enabled BOOLEAN DEFAULT true,
  auto_close_enabled BOOLEAN DEFAULT true,
  default_snooze_minutes INTEGER DEFAULT 5,
  language VARCHAR(10) DEFAULT 'en' CHECK (language IN ('en', 'es')),
  theme VARCHAR(20) DEFAULT 'light' CHECK (theme IN ('light', 'dark', 'auto')),
  created_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_email)
);

-- Row Level Security (RLS) Policies

-- Enable RLS on all tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;

-- Users policies
CREATE POLICY "Users can view their own profile" ON users
  FOR SELECT USING (email = current_user);

CREATE POLICY "Users can update their own profile" ON users
  FOR UPDATE USING (email = current_user);

-- Meetings policies
CREATE POLICY "Users can view their own meetings" ON meetings
  FOR SELECT USING (created_by = current_user);

CREATE POLICY "Users can create their own meetings" ON meetings
  FOR INSERT WITH CHECK (created_by = current_user);

CREATE POLICY "Users can update their own meetings" ON meetings
  FOR UPDATE USING (created_by = current_user);

CREATE POLICY "Users can delete their own meetings" ON meetings
  FOR DELETE USING (created_by = current_user);

-- Notes policies
CREATE POLICY "Users can view notes for their meetings" ON notes
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM meetings 
      WHERE meetings.id = notes.meeting_id 
      AND meetings.created_by = current_user
    )
  );

CREATE POLICY "Users can create notes for their meetings" ON notes
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM meetings 
      WHERE meetings.id = notes.meeting_id 
      AND meetings.created_by = current_user
    )
  );

CREATE POLICY "Users can update their own notes" ON notes
  FOR UPDATE USING (created_by = current_user);

CREATE POLICY "Users can delete their own notes" ON notes
  FOR DELETE USING (created_by = current_user);

-- API Keys policies
CREATE POLICY "Users can view their own API keys" ON api_keys
  FOR SELECT USING (created_by = current_user);

CREATE POLICY "Users can create their own API keys" ON api_keys
  FOR INSERT WITH CHECK (created_by = current_user);

CREATE POLICY "Users can update their own API keys" ON api_keys
  FOR UPDATE USING (created_by = current_user);

CREATE POLICY "Users can delete their own API keys" ON api_keys
  FOR DELETE USING (created_by = current_user);

-- User Preferences policies
CREATE POLICY "Users can view their own preferences" ON user_preferences
  FOR SELECT USING (user_email = current_user);

CREATE POLICY "Users can create their own preferences" ON user_preferences
  FOR INSERT WITH CHECK (user_email = current_user);

CREATE POLICY "Users can update their own preferences" ON user_preferences
  FOR UPDATE USING (user_email = current_user);

-- Indexes for better performance
CREATE INDEX IF NOT EXISTS idx_meetings_created_by ON meetings(created_by);
CREATE INDEX IF NOT EXISTS idx_meetings_date ON meetings(date);
CREATE INDEX IF NOT EXISTS idx_notes_meeting_id ON notes(meeting_id);
CREATE INDEX IF NOT EXISTS idx_notes_created_by ON notes(created_by);
CREATE INDEX IF NOT EXISTS idx_api_keys_created_by ON api_keys(created_by);
CREATE INDEX IF NOT EXISTS idx_api_keys_status ON api_keys(status);

-- Functions for automatic updated_date
CREATE OR REPLACE FUNCTION update_updated_date()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_date = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers for automatic updated_date
CREATE TRIGGER update_users_updated_date
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_date();

CREATE TRIGGER update_meetings_updated_date
  BEFORE UPDATE ON meetings
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_date();

CREATE TRIGGER update_notes_updated_date
  BEFORE UPDATE ON notes
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_date();

CREATE TRIGGER update_api_keys_updated_date
  BEFORE UPDATE ON api_keys
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_date();

CREATE TRIGGER update_user_preferences_updated_date
  BEFORE UPDATE ON user_preferences
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_date();

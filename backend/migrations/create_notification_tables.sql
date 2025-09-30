-- Create table for storing user push notification tokens
CREATE TABLE IF NOT EXISTS user_push_tokens (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    push_token TEXT NOT NULL,
    platform VARCHAR(20) DEFAULT 'unknown',
    device_id VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, device_id)
);

-- Create table for scheduled push notifications
CREATE TABLE IF NOT EXISTS scheduled_notifications (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    meeting_id VARCHAR(255) NOT NULL,
    push_token TEXT NOT NULL,
    alert_type VARCHAR(20) NOT NULL,
    trigger_time TIMESTAMP NOT NULL,
    meeting_data JSONB,
    status VARCHAR(20) DEFAULT 'scheduled',
    sent_at TIMESTAMP NULL,
    error_message TEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_user_push_tokens_user_id ON user_push_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_notifications_user_id ON scheduled_notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_notifications_trigger_time ON scheduled_notifications(trigger_time);
CREATE INDEX IF NOT EXISTS idx_scheduled_notifications_status ON scheduled_notifications(status);
CREATE INDEX IF NOT EXISTS idx_scheduled_notifications_meeting_id ON scheduled_notifications(meeting_id);

-- Create composite index for common queries
CREATE INDEX IF NOT EXISTS idx_scheduled_notifications_user_status_trigger 
ON scheduled_notifications(user_id, status, trigger_time);

-- Add foreign key constraints if users table exists
-- ALTER TABLE user_push_tokens ADD CONSTRAINT fk_user_push_tokens_user_id 
-- FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

-- ALTER TABLE scheduled_notifications ADD CONSTRAINT fk_scheduled_notifications_user_id 
-- FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

-- Add comments for documentation
COMMENT ON TABLE user_push_tokens IS 'Stores push notification tokens for users across different devices';
COMMENT ON TABLE scheduled_notifications IS 'Stores scheduled push notifications for meetings';

COMMENT ON COLUMN user_push_tokens.push_token IS 'Expo push token or FCM token for sending notifications';
COMMENT ON COLUMN user_push_tokens.platform IS 'Platform: ios, android, web';
COMMENT ON COLUMN user_push_tokens.device_id IS 'Unique device identifier to handle multiple devices per user';

COMMENT ON COLUMN scheduled_notifications.alert_type IS 'Type of alert: 1day, 1hour, 15min, 5min, 1min, now';
COMMENT ON COLUMN scheduled_notifications.trigger_time IS 'When the notification should be sent';
COMMENT ON COLUMN scheduled_notifications.meeting_data IS 'JSON data of the meeting for notification content';
COMMENT ON COLUMN scheduled_notifications.status IS 'Status: scheduled, sent, failed, cancelled';

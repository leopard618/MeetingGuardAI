-- Create function to safely increment usage counts
CREATE OR REPLACE FUNCTION increment_usage(
    p_user_id UUID,
    p_date DATE,
    p_ai_requests INTEGER DEFAULT 0,
    p_meeting_requests INTEGER DEFAULT 0,
    p_total_requests INTEGER DEFAULT 0
) RETURNS void AS $$
BEGIN
    INSERT INTO user_usage (user_id, date, ai_requests, meeting_requests, total_requests)
    VALUES (p_user_id, p_date, p_ai_requests, p_meeting_requests, p_total_requests)
    ON CONFLICT (user_id, date)
    DO UPDATE SET
        ai_requests = user_usage.ai_requests + p_ai_requests,
        meeting_requests = user_usage.meeting_requests + p_meeting_requests,
        total_requests = user_usage.total_requests + p_total_requests,
        updated_at = NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

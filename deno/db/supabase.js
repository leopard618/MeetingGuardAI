import { createClient } from "@supabase/supabase-js";

// Environment variables
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "https://your-project.supabase.co";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "your-anon-key";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_KEY") || "your-service-key";

// Create Supabase clients
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
export const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Check database health
export async function checkDatabaseHealth() {
  try {
    // Test basic connection
    const { data, error } = await supabase
      .from("users")
      .select("count")
      .limit(1);
    
    if (error) {
      return {
        status: "unhealthy",
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
    
    return {
      status: "healthy",
      connection: "established",
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    return {
      status: "unhealthy",
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
}

// Database schema types (for reference)
export const DatabaseSchema = {
  users: {
    id: "uuid",
    email: "string",
    name: "string",
    google_id: "string",
    created_at: "timestamp",
    updated_at: "timestamp"
  },
  meetings: {
    id: "uuid",
    user_id: "uuid",
    title: "string",
    description: "text",
    start_time: "timestamp",
    end_time: "timestamp",
    location: "string",
    attendees: "jsonb",
    created_at: "timestamp",
    updated_at: "timestamp"
  },
  notes: {
    id: "uuid",
    meeting_id: "uuid",
    user_id: "uuid",
    content: "text",
    created_at: "timestamp",
    updated_at: "timestamp"
  },
  api_keys: {
    id: "uuid",
    user_id: "uuid",
    name: "string",
    key_hash: "string",
    permissions: "jsonb",
    created_at: "timestamp",
    expires_at: "timestamp"
  },
  user_preferences: {
    id: "uuid",
    user_id: "uuid",
    notification_settings: "jsonb",
    calendar_settings: "jsonb",
    theme: "string",
    language: "string",
    created_at: "timestamp",
    updated_at: "timestamp"
  }
};

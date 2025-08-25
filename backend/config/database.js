const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing Supabase configuration. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

// Database schema setup
const setupDatabase = async () => {
  try {
    console.log('Setting up database schema...');

    // Create users table
    const { error: usersError } = await supabase.rpc('create_users_table', {});
    if (usersError && !usersError.message.includes('already exists')) {
      console.error('Error creating users table:', usersError);
    }

    // Create meetings table
    const { error: meetingsError } = await supabase.rpc('create_meetings_table', {});
    if (meetingsError && !meetingsError.message.includes('already exists')) {
      console.error('Error creating meetings table:', meetingsError);
    }

    // Create calendar_events table
    const { error: calendarError } = await supabase.rpc('create_calendar_events_table', {});
    if (calendarError && !calendarError.message.includes('already exists')) {
      console.error('Error creating calendar_events table:', calendarError);
    }

    // Create files table
    const { error: filesError } = await supabase.rpc('create_files_table', {});
    if (filesError && !filesError.message.includes('already exists')) {
      console.error('Error creating files table:', filesError);
    }

    // Create user_preferences table
    const { error: preferencesError } = await supabase.rpc('create_user_preferences_table', {});
    if (preferencesError && !preferencesError.message.includes('already exists')) {
      console.error('Error creating user_preferences table:', preferencesError);
    }

    console.log('Database schema setup completed');
  } catch (error) {
    console.error('Database setup error:', error);
  }
};

// Test database connection
const testConnection = async () => {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('count')
      .limit(1);

    if (error) {
      console.error('Database connection test failed:', error);
      return false;
    }

    console.log('Database connection successful');
    return true;
  } catch (error) {
    console.error('Database connection test error:', error);
    return false;
  }
};

module.exports = {
  supabase,
  setupDatabase,
  testConnection
};

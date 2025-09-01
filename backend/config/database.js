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
<<<<<<< HEAD

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
=======
    
    // Check if tables exist by trying to query them
    const tables = ['users', 'meetings', 'participants', 'attachments', 'files', 'calendar_events'];
    
    for (const table of tables) {
      try {
        const { error } = await supabase
          .from(table)
          .select('*')
          .limit(1);
        
        if (error && error.code === 'PGRST116') {
          console.log(`⚠️  Table '${table}' does not exist. Please run the schema setup.`);
        } else {
          console.log(`✅ Table '${table}' exists`);
        }
      } catch (err) {
        console.log(`⚠️  Error checking table '${table}':`, err.message);
      }
    }
    
    console.log('Database schema setup check completed');
>>>>>>> snow
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

const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

let supabase = null;

if (supabaseUrl && supabaseServiceKey) {
  supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
} else {
  console.warn('⚠️  Missing Supabase configuration. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables.');
  console.warn('⚠️  Some features may not work without proper database configuration.');
}

// Database schema setup
const setupDatabase = async () => {
  try {
    if (!supabase) {
      console.log('⚠️  Database setup skipped - Supabase not configured');
      return;
    }

    console.log('Setting up database schema...');
    
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
  } catch (error) {
    console.error('Database setup error:', error);
  }
};

// Test database connection
const testConnection = async () => {
  try {
    if (!supabase) {
      console.log('⚠️  Database connection test skipped - Supabase not configured');
      return false;
    }

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

// Test Database Connection
// Run this to test if your Supabase database is properly configured

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

async function testDatabaseConnection() {
  try {
    console.log('🔍 Testing database connection...');
    
    // Check environment variables
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    
    console.log('SUPABASE_URL:', supabaseUrl ? 'Set' : 'Missing');
    console.log('SUPABASE_SERVICE_ROLE_KEY:', supabaseServiceKey ? 'Set' : 'Missing');
    
    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Missing Supabase configuration');
    }
    
    // Create Supabase client
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });
    
    console.log('✅ Supabase client created');
    
    // Test connection by querying users table
    console.log('🔍 Testing users table...');
    const { data: users, error: usersError } = await supabase
      .from('users')
      .select('id, email, name, picture, given_name, family_name')
      .limit(1);
    
    if (usersError) {
      console.error('❌ Users table error:', usersError);
      
      // Check if it's a column error
      if (usersError.message.includes('column') && usersError.message.includes('does not exist')) {
        console.log('🔧 Database schema issue detected!');
        console.log('🔧 Missing columns in users table');
        console.log('🔧 Please run the fix-users-table.sql script in your Supabase SQL Editor');
        return false;
      }
      
      throw usersError;
    }
    
    console.log('✅ Users table accessible');
    console.log('✅ Database connection successful');
    
    // Test inserting a user
    console.log('🔍 Testing user insertion...');
    const testUser = {
      email: 'test@example.com',
      name: 'Test User',
      picture: 'https://example.com/pic.jpg',
      given_name: 'Test',
      family_name: 'User',
      google_id: 'test123',
      plan: 'free',
      subscription_status: 'inactive'
    };
    
    const { data: newUser, error: insertError } = await supabase
      .from('users')
      .insert(testUser)
      .select()
      .single();
    
    if (insertError) {
      console.error('❌ User insertion error:', insertError);
      throw insertError;
    }
    
    console.log('✅ User insertion successful:', newUser);
    
    // Clean up test user
    const { error: deleteError } = await supabase
      .from('users')
      .delete()
      .eq('id', newUser.id);
    
    if (deleteError) {
      console.error('⚠️ Error deleting test user:', deleteError);
    } else {
      console.log('✅ Test user cleaned up');
    }
    
    console.log('🎉 Database connection test completed successfully!');
    return true;
    
  } catch (error) {
    console.error('❌ Database connection test failed:', error);
    return false;
  }
}

// Run the test
testDatabaseConnection().then(success => {
  if (success) {
    console.log('✅ All tests passed!');
    process.exit(0);
  } else {
    console.log('❌ Tests failed!');
    process.exit(1);
  }
});

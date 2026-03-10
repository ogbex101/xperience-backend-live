const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');

// Get the absolute path to the backend directory
const backendDir = process.cwd();
console.log('📁 Backend directory:', backendDir);

// BETTER WAY: Check if we're in production mode
// Look for .env.production first if NODE_ENV is production OR if it exists and .env doesn't have Supabase vars
const isProduction = process.env.NODE_ENV === 'production';

// Determine which env file to use
let envFile = '.env'; // default

if (isProduction) {
  // If in production mode, try .env.production first
  const prodPath = path.join(backendDir, '.env.production');
  if (fs.existsSync(prodPath)) {
    envFile = '.env.production';
  } else {
    console.log('⚠️ .env.production not found, falling back to .env');
  }
} else {
  // In development, check if .env.production exists and we might want to use it anyway
  const devPath = path.join(backendDir, '.env');
  if (!fs.existsSync(devPath)) {
    const prodPath = path.join(backendDir, '.env.production');
    if (fs.existsSync(prodPath)) {
      envFile = '.env.production';
      console.log('⚠️ .env not found, using .env.production as fallback');
    }
  }
}

const envPath = path.join(backendDir, envFile);

console.log(`📁 Selected env file: ${envFile}`);
console.log(`📁 Full path: ${envPath}`);
console.log(`📁 File exists: ${fs.existsSync(envPath)}`);

// Load environment variables
if (fs.existsSync(envPath)) {
  const result = dotenv.config({ path: envPath });
  if (result.error) {
    console.error('❌ Error loading env file:', result.error.message);
  } else {
    console.log(`✅ Loaded environment from: ${envFile}`);
  }
} else {
  console.error(`❌ Environment file not found: ${envPath}`);
  // Fallback to default dotenv behavior
  dotenv.config();
}

console.log(`🌍 NODE_ENV: ${process.env.NODE_ENV || 'development'}`);

// NOW check for Supabase variables AFTER they're loaded
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

console.log('\n📊 Environment variables after loading:');
console.log(`SUPABASE_URL: ${supabaseUrl ? '✅ Set' : '❌ Missing'}`);
console.log(`SUPABASE_ANON_KEY: ${supabaseAnonKey ? '✅ Set' : '❌ Missing'}`);
console.log(`SUPABASE_SERVICE_ROLE_KEY: ${supabaseServiceKey ? '✅ Set' : '❌ Missing'}`);

// Determine if we're using Supabase
const useSupabase = !!(supabaseUrl && supabaseAnonKey);

if (!useSupabase) {
  console.log('\n⚠️ Supabase not configured:');
  console.log('   Will use PostgreSQL client instead');
}

// Initialize Supabase clients
let supabase = null;
let supabaseAdmin = null;

if (useSupabase) {
  console.log(`\n🔗 Initializing Supabase client with URL: ${supabaseUrl}`);
  
  try {
    // Regular client (respects RLS)
    supabase = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      },
      db: {
        schema: 'public'
      }
    });
    console.log('✅ Supabase regular client initialized');

    // Admin client (bypasses RLS)
    if (supabaseServiceKey) {
      supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false
        },
        db: {
          schema: 'public'
        }
      });
      console.log('✅ Supabase admin client initialized');
    } else {
      console.log('⚠️ Admin client not initialized (service role key missing)');
    }

  } catch (error) {
    console.error('❌ Error initializing Supabase client:', error.message);
  }
}

// Test Supabase connection
const testSupabaseConnection = async () => {
  try {
    if (!supabase) {
      throw new Error('Supabase client not initialized');
    }
    
    console.log('\n🔄 Testing Supabase connection...');
    
    // Simple query to test connection
    const { data, error, count } = await supabase
      .from('users')
      .select('*', { count: 'exact', head: true });
    
    if (error) {
      if (error.code === '42P01') {
        // Table doesn't exist, but connection works
        console.log('✅ Supabase connection verified (users table not found)');
        return true;
      } else {
        throw error;
      }
    }
    
    console.log('✅ Supabase connection verified');
    if (count !== undefined) {
      console.log(`📊 Users table has approximately ${count} records`);
    }
    return true;
  } catch (err) {
    console.error('❌ Supabase connection failed:', err.message);
    if (err.code === 'ECONNREFUSED') {
      console.error('   Connection refused - check if Supabase URL is correct');
    } else if (err.code === '28P01') {
      console.error('   Authentication failed - check your anon key');
    }
    return false;
  }
};

// Helper to get client
const getClient = (useAdmin = false) => {
  if (!useSupabase) {
    throw new Error('Supabase not available');
  }
  
  if (useAdmin) {
    if (!supabaseAdmin) {
      throw new Error('Admin client not available - check SUPABASE_SERVICE_ROLE_KEY');
    }
    return supabaseAdmin;
  }
  
  return supabase;
};

module.exports = {
  supabase,
  supabaseAdmin,
  useSupabase,
  testSupabaseConnection,
  getClient
};
const { Pool } = require('pg');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');
dotenv.config();

// Initialize Supabase clients
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Regular Supabase client (for authenticated user operations)
const supabase = supabaseUrl && supabaseAnonKey 
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        autoRefreshToken: true,
        persistSession: true
      }
    })
  : null;

// Admin Supabase client (bypasses RLS for admin operations)
const supabaseAdmin = supabaseUrl && supabaseServiceKey
  ? createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    })
  : null;

// Helper function to create authenticated client with user's JWT
const createAuthenticatedClient = (token) => {
  if (!supabaseUrl || !supabaseAnonKey) return null;
  
  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false
    },
    global: {
      headers: {
        Authorization: `Bearer ${token}`
      }
    }
  });
};

// Determine if we're using Supabase
const isSupabase = process.env.NODE_ENV === 'production' || !!supabaseUrl;

// PostgreSQL connection configuration (fallback)
let pgPool = null;
if (!isSupabase) {
  const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'xperience_db',
    port: process.env.DB_PORT || 5432,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  };
  pgPool = new Pool(dbConfig);
}

// Test connection
const testConnection = async () => {
  try {
    if (isSupabase) {
      if (!supabase) {
        throw new Error('Supabase not initialized');
      }
      const { data, error } = await supabase.from('users').select('count', { count: 'exact', head: true });
      if (error) throw error;
      console.log('✅ Supabase connection verified');
      return true;
    } else {
      const client = await pgPool.connect();
      console.log('✅ PostgreSQL database connected successfully');
      console.log('   Environment: Development (Local)');
      client.release();
      return true;
    }
  } catch (err) {
    console.error(`❌ Database connection failed:`, err.message);
    throw err;
  }
};

// Get appropriate client based on context
const getClient = (useAdmin = false) => {
  if (!isSupabase) return supabase; // Return null? Actually for non-supabase we use pgPool
  return useAdmin && supabaseAdmin ? supabaseAdmin : supabase;
};

// REMOVED: execute and query functions that were causing errors
// We'll just use direct Supabase queries instead of raw SQL

// Supabase query builder (regular user) - DIRECT ACCESS
const supabaseBuilder = (table) => {
  if (!isSupabase || !supabase) {
    throw new Error('Supabase not available');
  }
  return supabase.from(table);
};

// Supabase admin query builder (bypasses RLS)
const supabaseAdminBuilder = (table) => {
  if (!isSupabase) {
    throw new Error('Supabase not available');
  }
  if (!supabaseAdmin) {
    throw new Error('Admin client not available - check SUPABASE_SERVICE_ROLE_KEY');
  }
  return supabaseAdmin.from(table);
};

// Legacy aliases for backward compatibility
const supabaseQuery = supabaseBuilder;
const supabaseAdminQuery = supabaseAdminBuilder;

// Admin function: Get all users (bypasses RLS)
const adminGetAllUsers = async () => {
  if (!isSupabase) {
    // For PostgreSQL fallback
    const result = await pgPool.query('SELECT * FROM users');
    return result.rows;
  }
  
  const { data, error } = await supabaseAdminBuilder('users').select('*');
  if (error) throw error;
  return data;
};

// Admin function: Delete user by email (bypasses RLS)
const adminDeleteUserByEmail = async (email) => {
  if (!isSupabase) {
    const result = await pgPool.query('DELETE FROM users WHERE email = $1 RETURNING *', [email]);
    return result.rows[0];
  }
  
  const { data, error } = await supabaseAdminBuilder('users')
    .delete()
    .eq('email', email)
    .select();
  
  if (error) throw error;
  return data[0];
};

// Admin function: Update any user (bypasses RLS)
const adminUpdateUser = async (userId, updates) => {
  if (!isSupabase) {
    const setClause = Object.keys(updates).map((key, i) => `${key} = $${i + 2}`).join(', ');
    const values = [userId, ...Object.values(updates)];
    const result = await pgPool.query(
      `UPDATE users SET ${setClause} WHERE id = $1 RETURNING *`,
      values
    );
    return result.rows[0];
  }
  
  const { data, error } = await supabaseAdminBuilder('users')
    .update(updates)
    .eq('id', userId)
    .select();
  
  if (error) throw error;
  return data[0];
};

// Transaction support - Simplified for Supabase
const executeTransaction = async (operations, useAdmin = false) => {
  if (isSupabase) {
    // Supabase doesn't support transactions across multiple tables easily
    // We'll execute sequentially and hope for the best
    const results = [];
    const client = getClient(useAdmin);
    
    for (const operation of operations) {
      try {
        // Assume operation is a Supabase query builder
        const { data, error } = await operation;
        if (error) throw error;
        results.push(data);
      } catch (error) {
        console.error('Transaction operation failed:', error);
        throw error;
      }
    }
    return results;
  } else {
    const client = await pgPool.connect();
    try {
      await client.query('BEGIN');
      const results = [];
      for (const operation of operations) {
        const { sql, params } = operation;
        const result = await client.query(sql, params);
        results.push(result.rows || result);
      }
      await client.query('COMMIT');
      return results;
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Transaction error:', error);
      throw error;
    } finally {
      client.release();
    }
  }
};

// Real-time subscription helper
const createRealtimeSubscription = (table, event, callback, useAdmin = false) => {
  if (!isSupabase) {
    console.warn('Real-time subscriptions only available with Supabase');
    return null;
  }

  const client = getClient(useAdmin);
  
  return client
    .channel(`public:${table}`)
    .on('postgres_changes', 
      { 
        event: event,
        schema: 'public', 
        table: table 
      }, 
      (payload) => {
        callback(payload);
      }
    )
    .subscribe();
};

module.exports = {
  pool: pgPool,
  supabase,                    // Direct Supabase client
  supabaseAdmin,               // Direct Admin client
  supabaseBuilder,             // Query builder for regular operations
  supabaseAdminBuilder,        // Query builder for admin operations
  testConnection,
  isSupabase,
  createAuthenticatedClient,   // NEW: Helper to create authed client
  // Legacy aliases
  supabaseQuery: supabaseBuilder,
  supabaseAdminQuery: supabaseAdminBuilder,
  createRealtimeSubscription,
  // Admin helper functions
  adminGetAllUsers,
  adminDeleteUserByEmail,
  adminUpdateUser,
  getClient
  // REMOVED: query and execute functions that were causing errors
};

// Export pool for backward compatibility
if (pgPool) {
  module.exports.default = pgPool;
}
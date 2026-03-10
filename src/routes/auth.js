const { pool } = require('../config/database');
const express = require('express');
const Joi = require('joi');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Validation schemas
const registerSchema = Joi.object({
  username: Joi.string().alphanum().min(3).max(30).required(),
  email: Joi.string().email().required(),
  password: Joi.string().min(6).required(),
  fullName: Joi.string().max(100).optional().allow('', null),
  firstname: Joi.string().max(100).optional().allow('', null),
  lastname: Joi.string().max(100).optional().allow('', null)
});

const loginSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().required()
});

// Generate JWT tokens for your app
const generateTokens = (userId) => {
  const accessToken = jwt.sign(
    { id: userId },
    process.env.JWT_SECRET || 'fallback_secret', 
    { expiresIn: '24h' }
  );
  
  const refreshToken = jwt.sign(
    { id: userId },
    process.env.JWT_REFRESH_SECRET || 'fallback_refresh_secret', 
    { expiresIn: '7d' }
  );

  return { accessToken, refreshToken };
};

// Helper functions for user operations
const User = {
  // Find user by email
  findByEmail: async (email) => {
    try {
      console.log('🔍 Finding user by email:', email);
      
      if (db.isSupabase) {
        const { data, error } = await db.supabase
          .from('users')
          .select('*')
          .eq('email', email)
          .maybeSingle();
        
        if (error) {
          console.error('Supabase error finding by email:', error);
          throw error;
        }
        
        return data;
      } else {
        const result = await db.execute(
          'SELECT * FROM users WHERE email = $1',
          [email]
        );
        return (result[0] && result[0][0]) || null;
      }
    } catch (error) {
      console.error('Error finding user by email:', error);
      throw error;
    }
  },

  // Find user by username
  findByUsername: async (username) => {
    try {
      console.log('🔍 Finding user by username:', username);
      
      if (db.isSupabase) {
        const { data, error } = await db.supabase
          .from('users')
          .select('*')
          .eq('username', username)
          .maybeSingle();
        
        if (error) {
          console.error('Supabase error finding by username:', error);
          throw error;
        }
        
        return data;
      } else {
        const result = await db.execute(
          'SELECT * FROM users WHERE username = $1',
          [username]
        );
        return (result[0] && result[0][0]) || null;
      }
    } catch (error) {
      console.error('Error finding user by username:', error);
      throw error;
    }
  },

  // Find user by ID
  findById: async (id) => {
    try {
      if (!id) {
        throw new Error('User ID is required');
      }
      
      console.log('🔍 Finding user by ID:', id);
      
      if (db.isSupabase) {
        const { data, error } = await db.supabase
          .from('users')
          .select('*')
          .eq('id', id)
          .maybeSingle();
        
        if (error) {
          console.error('Supabase error finding by ID:', error);
          throw error;
        }
        
        return data;
      } else {
        const result = await db.execute(
          'SELECT * FROM users WHERE id = $1',
          [id]
        );
        return (result[0] && result[0][0]) || null;
      }
    } catch (error) {
      console.error('Error finding user by ID:', error);
      throw error;
    }
  },

  // Create new user (with Supabase Auth)
  create: async (userData) => {
    try {
      console.log('🧠 User.create() called with:', { 
        username: userData.username, 
        email: userData.email 
      });
      
      const walletAccountNumber = 'XP' + Date.now().toString().slice(-8);
      console.log('🔧 Generated wallet:', walletAccountNumber);
      
      if (db.isSupabase) {
        // ===== SUPABASE AUTH APPROACH =====
        console.log('📝 Using Supabase Auth to create user...');
        
        // 1. Create user in Supabase Auth
        const { data: authData, error: authError } = await db.supabase.auth.signUp({
          email: userData.email,
          password: userData.password,
          options: {
            data: {
              username: userData.username,
              firstname: userData.firstname || '',
              lastname: userData.lastname || ''
            }
          }
        });

        if (authError) {
          console.error('❌ Supabase Auth error:', authError);
          throw authError;
        }

        if (!authData.user) {
          throw new Error('No user data returned from Supabase Auth');
        }

        console.log('✅ Supabase Auth user created with ID:', authData.user.id);

        // 2. Insert additional user data into public.users table
        const userPublicData = {
          id: authData.user.id, // Use the same ID from Auth
          username: userData.username,
          email: userData.email,
          firstname: userData.firstname || null,
          lastname: userData.lastname || null,
          wallet_account_number: walletAccountNumber,
          currency: 'NGN',
          profile_pic: 'default.png',
          rank: 'E',
          matches_played: 0,
          tournaments_played: 0,
          tournaments_won: 0,
          wins: 0,
          losses: 0,
          win_rate: 0.00,
          xp_points: 0,
          balance: 0.00,
          is_online: false,
          account_status: 'active',
          is_admin: false,
          is_banned: false,
          enable_2fa: false,
          login_alerts: true,
          session_timeout: 60,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };

        console.log('📝 Inserting public user data...');
        
        const { data: userData_result, error: userError } = await db.supabase
          .from('users')
          .insert([userPublicData])
          .select()
          .single();

        if (userError) {
          console.error('❌ Error inserting public user data:', userError);
          // If public insert fails, we should probably delete the auth user
          // But for now, log and throw
          throw userError;
        }

        console.log('✅ Public user data inserted successfully');
        return authData.user.id;

      } else {
        // ===== POSTGRESQL APPROACH (unchanged) =====
        const hashedPassword = await bcrypt.hash(userData.password, 10);
        
        const result = await db.execute(
          `INSERT INTO users (
            username, email, password, firstname, lastname, 
            wallet_account_number, currency, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, 'NGN', NOW(), NOW())
          RETURNING id`,
          [
            userData.username,
            userData.email,
            hashedPassword,
            userData.firstname || null,
            userData.lastname || null,
            walletAccountNumber
          ]
        );
        
        if (result[0] && result[0][0] && result[0][0].id) {
          return result[0][0].id;
        } else {
          throw new Error('Failed to get user ID from database');
        }
      }
      
    } catch (error) {
      console.error('💥 ERROR in User.create():', error.message);
      console.error(error.stack);
      throw error;
    }
  },

  // Verify password (for local PostgreSQL only)
  verifyPassword: async (plainPassword, hashedPassword) => {
    try {
      console.log('Verifying password...');
      
      if (hashedPassword.startsWith('$2a$') || hashedPassword.startsWith('$2b$') || hashedPassword.startsWith('$2y$')) {
        // Handle $2y$ format (old PHP users)
        if (hashedPassword.startsWith('$2y$')) {
          console.log('Converting $2y$ hash to $2b$ format');
          const convertedHash = '$2b$' + hashedPassword.substring(4);
          return await bcrypt.compare(plainPassword, convertedHash);
        }
        return await bcrypt.compare(plainPassword, hashedPassword);
      }
      
      console.log('Unknown password hash format:', hashedPassword.substring(0, 10));
      return false;
      
    } catch (error) {
      console.error('Password verification error:', error);
      return false;
    }
  }
};

// ============ ROUTES ============

// Debug route to test database connection
router.get('/debug/db-test', async (req, res) => {
  try {
    if (db.isSupabase) {
      const { data, error, count } = await db.supabase
        .from('users')
        .select('*', { count: 'exact', head: true });
      
      const { data: testUsers, error: testError } = await db.supabase
        .from('users')
        .select('id, email, username, firstname, lastname')
        .limit(3);
      
      res.json({
        success: true,
        database: 'Supabase (with Auth)',
        userCount: count || 0,
        testUsers: testUsers || [],
        dbConnected: true
      });
    } else {
      const result = await db.execute('SELECT COUNT(*) as count FROM users');
      const testResult = await db.execute(
        'SELECT id, email, username, firstname, lastname FROM users LIMIT 3',
        []
      );
      
      res.json({
        success: true,
        database: 'PostgreSQL',
        userCount: (result[0] && result[0][0] && result[0][0].count) || 0,
        testUsers: (testResult[0]) || [],
        dbConnected: true
      });
    }
    
  } catch (error) {
    console.error('DB Test Error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      dbConnected: false
    });
  }
});

// In your auth.js file - UPDATED REGISTER ENDPOINT

// In your auth.js - UPDATED REGISTER ENDPOINT with token

router.post('/register', async (req, res) => {
  try {
    console.log('=== REGISTRATION ATTEMPT ===');
    console.log('Request body:', req.body);
    console.log('Using database:', db.isSupabase ? 'Supabase (with Auth)' : 'PostgreSQL (local)');
    
    const { username, email, password, fullName } = req.body;
    
    // Process the data
    const processedData = {
      username: username,
      email: email,
      firstname: fullName || username,
      lastname: ''
    };
    
    console.log('Processed data:', processedData);
    
    if (db.isSupabase) {
      console.log('📝 Using Supabase Auth to create user...');
      
      // Check if user exists
      const { data: existingUsers, error: checkError } = await db.supabaseBuilder('users')
        .select('id')
        .or(`email.eq.${email},username.eq.${username}`)
        .limit(1);
      
      if (!checkError && existingUsers && existingUsers.length > 0) {
        console.log('❌ User already exists');
        return res.status(400).json({
          success: false,
          message: 'User with this email or username already exists'
        });
      }
      
      // Create user in Supabase Auth
      const { data: authData, error: authError } = await db.supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            username,
            full_name: fullName || username
          }
        }
      });
      
      if (authError) {
        console.error('❌ Supabase Auth error:', authError);
        return res.status(400).json({
          success: false,
          message: authError.message
        });
      }
      
      if (!authData.user) {
        console.error('❌ No user data returned from Supabase Auth');
        return res.status(500).json({
          success: false,
          message: 'Failed to create user'
        });
      }
      
      const userId = authData.user.id;
      console.log(`✅ Supabase Auth user created with ID: ${userId}`);
      
      // Wait a moment for the trigger to create public user record
      console.log('⏳ Waiting for trigger to create public user record...');
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Update the public record with additional data
      const walletNumber = `XP${Math.floor(10000000 + Math.random() * 90000000)}`;
      console.log(`🔧 Generated wallet: ${walletNumber}`);
      
      const { error: updateError } = await db.supabaseBuilder('users')
        .update({
          username: username,
          firstname: fullName || username,
          wallet_account_number: walletNumber
        })
        .eq('id', userId);
      
      if (updateError) {
        console.error('❌ Update of additional fields failed:', updateError);
      } else {
        console.log('✅ Additional fields updated');
      }
      
      // IMPORTANT: Return the session token to the frontend
      return res.status(201).json({
        success: true,
        message: 'Registration successful!',
        // Return the session from Supabase Auth
        token: authData.session?.access_token || null,
        user: {
          id: userId,
          username: username,
          email: email,
          fullName: fullName || username
        }
      });
      
    } else {
      // Local PostgreSQL registration (without Supabase Auth)
      console.log('📝 Using local PostgreSQL for registration...');
      
      // Hash password
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(password, salt);
      
      // Generate wallet number
      const walletNumber = `XP${Math.floor(10000000 + Math.random() * 90000000)}`;
      
      // Create user
      const user = await User.create({
        username,
        email,
        password: hashedPassword,
        firstname: fullName || username,
        lastname: '',
        wallet_account_number: walletNumber,
        balance: 0,
        xp_points: 0
      });
      
      // Generate JWT
      const token = jwt.sign(
        { id: user.id, username: user.username },
        process.env.JWT_SECRET,
        { expiresIn: '7d' }
      );
      
      return res.status(201).json({
        success: true,
        message: 'Registration successful!',
        token,
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          fullName: fullName || username
        }
      });
    }
    
  } catch (error) {
    console.error('💥 ERROR in registration:', error);
    
    res.status(500).json({ 
      success: false, 
      message: 'Registration failed',
      error: error.message 
    });
  }
});
// Login endpoint
router.post('/login', async (req, res) => {
  try {
    console.log('Login attempt:', req.body.email);
    console.log('Using database:', db.isSupabase ? 'Supabase (with Auth)' : 'PostgreSQL');
    
    // Validate input
    const { error, value } = loginSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const { email, password } = value;

    if (db.isSupabase) {
      // ===== SUPABASE AUTH LOGIN =====
      console.log('🔐 Attempting Supabase Auth login...');
      
      const { data: authData, error: authError } = await db.supabase.auth.signInWithPassword({
        email: email,
        password: password
      });

      if (authError) {
        console.error('❌ Supabase Auth error:', authError);
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      if (!authData.user) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      console.log('✅ Supabase Auth successful for user:', authData.user.id);

      // ===== CHECK IF USER EXISTS IN PUBLIC.USERS =====
      let user = await User.findById(authData.user.id);
      
      // Get user metadata from Auth (FIX: Define this variable)
      const userMetadata = authData.user.user_metadata || {};
      
      // If user doesn't exist in public.users, create them
      if (!user) {
        console.log('⚠️ User found in Auth but not in public.users - creating record...');
        
        // Generate wallet account number
        const walletAccountNumber = 'XP' + Date.now().toString().slice(-8);
        
        // Create the user in public.users
        const newUserData = {
          id: authData.user.id,
          username: userMetadata.username || email.split('@')[0],
          email: email,
          firstname: userMetadata.firstname || '',
          lastname: userMetadata.lastname || '',
          wallet_account_number: walletAccountNumber,
          currency: 'NGN',
          profile_pic: 'default.png',
          rank: 'E',
          matches_played: 0,
          tournaments_played: 0,
          tournaments_won: 0,
          wins: 0,
          losses: 0,
          win_rate: 0.00,
          xp_points: 0,
          balance: 0.00,
          is_online: false,
          account_status: 'active',
          is_admin: false,
          is_banned: false,
          enable_2fa: false,
          login_alerts: true,
          session_timeout: 60,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          // Set self-referential fields to NULL
          typing_for_user_id: null,
          last_typing_at: null,
          is_typing: false,
          last_seen_at: null,
          last_activity_at: null
        };

        const { data: insertedUser, error: insertError } = await db.supabase
          .from('users')
          .insert([newUserData])
          .select()
          .single();

        if (insertError) {
          console.error('❌ Failed to create user in public.users:', insertError);
          // Don't throw - we still want to log the user in
        } else {
          console.log('✅ User record created in public.users');
          user = insertedUser;
        }
      } else {
        console.log('✅ User found in public.users');
      }

      // Check if user is banned (only if we have user data)
      if (user && user.is_banned) {
        return res.status(403).json({ error: 'Account has been suspended' });
      }

      // Generate your app's JWT tokens
      const tokens = generateTokens(authData.user.id);

      // Update last login
      if (db.isSupabase && user) {
        await db.supabase
          .from('users')
          .update({ 
            last_login_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .eq('id', authData.user.id);
      }

      // Return user data
      const { password: pwd, reset_token, token_expiry, ...userData } = user || {};

      res.json({
        message: 'Login successful',
        user: {
          id: authData.user.id,
          username: userData?.username || userMetadata?.username || email.split('@')[0],
          email: userData?.email || email,
          firstname: userData?.firstname || userMetadata?.firstname || '',
          lastname: userData?.lastname || userMetadata?.lastname || '',
          profile_pic: userData?.profile_pic || 'default.png',
          rank: userData?.rank || 'E',
          balance: userData?.balance || 0,
          xp_points: userData?.xp_points || 0,
          wallet_account_number: userData?.wallet_account_number,
          currency: userData?.currency || 'NGN',
          is_admin: userData?.is_admin || false
        },
        ...tokens
      });

    } else {
      // ===== POSTGRESQL LOGIN (unchanged) =====
      const user = await User.findByEmail(email);
      if (!user) {
        console.log('User not found:', email);
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      if (user.is_banned) {
        return res.status(403).json({ error: 'Account has been suspended' });
      }

      const isValidPassword = await User.verifyPassword(password, user.password);
      
      if (!isValidPassword) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      const tokens = generateTokens(user.id);

      await db.execute(
        'UPDATE users SET updated_at = CURRENT_TIMESTAMP WHERE id = $1',
        [user.id]
      );

      const { password: pwd, reset_token, token_expiry, ...userData } = user;

      res.json({
        message: 'Login successful',
        user: userData,
        ...tokens
      });
    }

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error during login' });
  }
});

// Get current user (me)
router.get('/me', authenticateToken, async (req, res) => {
  try {
    console.log('🔵 /me endpoint called for user:', req.user.id);
    
    let user = await User.findById(req.user.id);
    
    // If user doesn't exist in public.users, try to fetch from Auth and create
    if (!user && db.isSupabase) {
      console.log('⚠️ User not found in public.users, attempting to fetch from Auth...');
      
      // Get user from Auth (requires admin client)
      const { data: authUser, error: authError } = await db.supabaseAdmin
        .from('users')
        .select('*')
        .eq('id', req.user.id)
        .single();
      
      if (authError) {
        console.error('❌ Could not fetch user from Auth:', authError);
      } else {
        // Create the user in public.users
        const walletAccountNumber = 'XP' + Date.now().toString().slice(-8);
        
        const newUserData = {
          id: req.user.id,
          username: authUser.email?.split('@')[0] || 'user',
          email: authUser.email,
          firstname: '',
          lastname: '',
          wallet_account_number: walletAccountNumber,
          currency: 'NGN',
          profile_pic: 'default.png',
          rank: 'E',
          matches_played: 0,
          tournaments_played: 0,
          tournaments_won: 0,
          wins: 0,
          losses: 0,
          win_rate: 0.00,
          xp_points: 0,
          balance: 0.00,
          is_online: false,
          account_status: 'active',
          is_admin: false,
          is_banned: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };

        const { data: insertedUser, error: insertError } = await db.supabase
          .from('users')
          .insert([newUserData])
          .select()
          .single();

        if (!insertError) {
          console.log('✅ User created in public.users via /me endpoint');
          user = insertedUser;
        }
      }
    }
    
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }
    
    // Remove sensitive data
    const { password, reset_token, token_expiry, ...userData } = user;
    
    res.json({
      success: true,
      user: {
        id: userData.id,
        username: userData.username,
        email: userData.email,
        firstname: userData.firstname || '',
        lastname: userData.lastname || '',
        profile_pic: userData.profile_pic || null,
        rank: userData.rank || 'E',
        balance: userData.balance || 0,
        xp_points: userData.xp_points || 0,
        wallet_account_number: userData.wallet_account_number,
        is_admin: userData.is_admin || false,
        account_status: userData.account_status || 'active'
      }
    });
    
  } catch (error) {
    console.error('/me endpoint error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch user data'
    });
  }
});
// Profile endpoint (alias for /me)
router.get('/profile', authenticateToken, async (req, res) => {
  try {
    console.log('🔵 /profile endpoint called for user:', req.user.id);
    
    const user = await User.findById(req.user.id);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }
    
    const { password, reset_token, token_expiry, ...userData } = user;
    
    res.json({
      success: true,
      user: {
        id: userData.id,
        username: userData.username,
        email: userData.email,
        firstname: userData.firstname || '',
        lastname: userData.lastname || '',
        profile_pic: userData.profile_pic || null,
        rank: userData.rank || 'E',
        balance: userData.balance || 0,
        xp_points: userData.xp_points || 0,
        wallet_account_number: userData.wallet_account_number,
        is_admin: userData.is_admin || false,
        account_status: userData.account_status || 'active'
      }
    });
    
  } catch (error) {
    console.error('/profile endpoint error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch profile'
    });
  }
});

// Logout endpoint
router.post('/logout', authenticateToken, async (req, res) => {
  try {
    if (db.isSupabase) {
      // Sign out from Supabase Auth
      const { error } = await db.supabase.auth.signOut();
      if (error) throw error;
    }
    
    res.json({ 
      success: true, 
      message: 'Logged out successfully' 
    });
    
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ error: 'Failed to logout' });
  }
});

// Password reset request
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }
    
    if (db.isSupabase) {
      const { error } = await db.supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${process.env.CLIENT_URL}/reset-password`
      });
      
      if (error) throw error;
      
      res.json({ 
        success: true, 
        message: 'Password reset email sent' 
      });
    } else {
      // Implement PostgreSQL password reset logic here
      res.json({ 
        success: true, 
        message: 'Password reset functionality coming soon for development mode' 
      });
    }
    
  } catch (error) {
    console.error('Password reset error:', error);
    res.status(500).json({ error: 'Failed to send reset email' });
  }
});

// Update password
router.post('/update-password', authenticateToken, async (req, res) => {
  try {
    const { newPassword } = req.body;
    
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    
    if (db.isSupabase) {
      const { error } = await db.supabase.auth.updateUser({
        password: newPassword
      });
      
      if (error) throw error;
      
      res.json({ 
        success: true, 
        message: 'Password updated successfully' 
      });
    } else {
      // Implement PostgreSQL password update
      const hashedPassword = await bcrypt.hash(newPassword, 10);
      await db.execute(
        'UPDATE users SET password = $1, updated_at = NOW() WHERE id = $2',
        [hashedPassword, req.user.id]
      );
      
      res.json({ 
        success: true, 
        message: 'Password updated successfully' 
      });
    }
    
  } catch (error) {
    console.error('Password update error:', error);
    res.status(500).json({ error: 'Failed to update password' });
  }
});

module.exports = router;
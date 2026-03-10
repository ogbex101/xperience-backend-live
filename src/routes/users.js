const express = require('express');
const Joi = require('joi');
const { User } = require('../models/User.js');
const { authenticateToken } = require('../middleware/auth.js');
const db = require('../config/database');
const jwt = require('jsonwebtoken');
const upload = require('../middleware/upload');
const fs = require('fs');
const path = require('path');

const router = express.Router();

// Add this authenticate middleware function (copy from tournaments.js or define it here)
const authenticate = (req, res, next) => {
  const authHeader = req.header('Authorization');
  
  if (!authHeader) {
    return res.status(401).json({ success: false, error: 'No authorization header' });
  }
  
  const token = authHeader.replace('Bearer ', '').trim();
  
  if (!token) {
    return res.status(401).json({ success: false, error: 'No token provided' });
  }
  
  try {
    console.log('🔑 Verifying token:', token.substring(0, 20) + '...');
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
    console.log('✅ Token decoded:', decoded);
    
    const userId = decoded.userId || decoded.id;
    
    if (db.isSupabase) {
      // Supabase mode
      db.supabase
        .from('users')
        .select('id, username, email, is_admin')
        .eq('id', userId)
        .maybeSingle()
        .then(({ data: user, error }) => {
          if (error) {
            console.error('❌ Database error:', error);
            return res.status(500).json({ success: false, error: 'Database error' });
          }
          
          if (!user) {
            return res.status(401).json({ success: false, error: 'User not found' });
          }
          
          req.user = {
            id: user.id,
            userId: user.id,
            username: user.username,
            email: user.email,
            is_admin: user.is_admin
          };
          
          console.log('✅ User object set with is_admin:', req.user.is_admin);
          next();
        })
        .catch(error => {
          console.error('❌ Database error:', error);
          res.status(500).json({ success: false, error: 'Database error' });
        });
    } else {
      // PostgreSQL mode
      db.query(
        'SELECT id, username, email, is_admin FROM users WHERE id = $1', 
        [userId]
      )
        .then((result) => {
          // Use result[0] for your database wrapper
          const users = result[0] || [];
          
          if (users.length === 0) {
            return res.status(401).json({ success: false, error: 'User not found' });
          }
          
          const user = users[0];
          req.user = {
            id: user.id,
            userId: user.id,
            username: user.username,
            email: user.email,
            is_admin: user.is_admin
          };
          
          console.log('✅ User object set with is_admin:', req.user.is_admin);
          next();
        })
        .catch(error => {
          console.error('❌ Database error:', error);
          res.status(500).json({ success: false, error: 'Database error' });
        });
    }
  } catch (error) {
    console.error('❌ Token verification error:', error.message);
    res.status(401).json({ success: false, error: 'Invalid token' });
  }
};

// Validation schemas
const updateProfileSchema = Joi.object({
  firstname: Joi.string().max(100).optional().allow('', null),
  lastname: Joi.string().max(100).optional().allow('', null),
  profile_pic: Joi.string().uri().optional().allow('', null)
});

const setPinSchema = Joi.object({
  pin: Joi.string().length(4).pattern(/^\d+$/).required()
});

// GET /api/users/me/xp - Get user XP balance (simple endpoint)
router.get('/me/xp', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    
    if (db.isSupabase) {
      // Supabase mode
      const { data: user, error } = await db.supabase
        .from('users')
        .select('id, username, xp_points')
        .eq('id', userId)
        .maybeSingle();

      if (error) {
        console.error('Database error:', error);
        return res.status(500).json({ success: false, error: 'Database error' });
      }

      if (!user) {
        return res.status(404).json({ success: false, error: 'User not found' });
      }

      res.json({
        success: true,
        xp_points: user.xp_points || 0,
        user_id: user.id
      });
    } else {
      // PostgreSQL mode
      const result = await db.query(
        `SELECT id, username, xp_points FROM users WHERE id = $1`,
        [userId]
      );
      
      const users = result[0] || [];

      if (users.length === 0) {
        return res.status(404).json({ 
          success: false,
          error: 'User not found' 
        });
      }

      res.json({
        success: true,
        xp_points: users[0].xp_points || 0,
        user_id: users[0].id
      });
    }
  } catch (error) {
    console.error('Get XP balance error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch XP balance' 
    });
  }
});

// ============ PROFILE PICTURE ENDPOINTS ============

// UPLOAD PROFILE PICTURE
router.post('/upload-profile-pic', authenticateToken, upload.single('profile_pic'), async (req, res) => {
  try {
    console.log('📸 Profile picture upload requested by user:', req.user.id);
    
    if (!req.file) {
      return res.status(400).json({ 
        success: false, 
        error: 'No file uploaded or file type not allowed' 
      });
    }

    // Create URL for the uploaded file
    const profilePicUrl = `/uploads/profile-pics/${req.file.filename}`;
    
    console.log('📸 Profile picture saved:', {
      filename: req.file.filename,
      path: req.file.path,
      url: profilePicUrl,
      userId: req.user.id
    });
    
    if (db.isSupabase) {
      // Supabase mode
      const { error } = await db.supabase
        .from('users')
        .update({ profile_pic: profilePicUrl })
        .eq('id', req.user.id);

      if (error) {
        console.error('Database error:', error);
        return res.status(500).json({ success: false, error: 'Database error' });
      }

      // Get updated user data
      const { data: updatedUser, error: fetchError } = await db.supabase
        .from('users')
        .select('id, username, email, profile_pic')
        .eq('id', req.user.id)
        .maybeSingle();

      if (fetchError) {
        console.error('Error fetching updated user:', fetchError);
      }

      res.json({
        success: true,
        message: 'Profile picture uploaded successfully',
        profile_pic_url: profilePicUrl,
        user: updatedUser || null
      });
    } else {
      // PostgreSQL mode
      await db.query(
        'UPDATE users SET profile_pic = $1 WHERE id = $2',
        [profilePicUrl, req.user.id]
      );
      
      // Get updated user data
      const updatedResult = await db.query(
        'SELECT id, username, email, profile_pic FROM users WHERE id = $1',
        [req.user.id]
      );
      
      const updatedUser = updatedResult[0] || [];
      
      res.json({
        success: true,
        message: 'Profile picture uploaded successfully',
        profile_pic_url: profilePicUrl,
        user: updatedUser[0] || null
      });
    }
  } catch (error) {
    console.error('❌ Profile pic upload error:', error);
    
    // Handle multer errors specifically
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ 
        success: false, 
        error: 'File too large. Maximum size is 5MB' 
      });
    }
    
    if (error.message.includes('Only image files are allowed')) {
      return res.status(400).json({ 
        success: false, 
        error: 'Only image files are allowed (jpeg, jpg, png, gif, webp)' 
      });
    }
    
    res.status(500).json({ 
      success: false, 
      error: 'Failed to upload profile picture',
      debug: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// REMOVE PROFILE PICTURE
router.delete('/remove-profile-pic', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    console.log('🗑️ Removing profile picture for user:', userId);
    
    if (db.isSupabase) {
      // Get current profile pic
      const { data: user, error: fetchError } = await db.supabase
        .from('users')
        .select('profile_pic')
        .eq('id', userId)
        .maybeSingle();

      if (fetchError) {
        console.error('Database error:', fetchError);
        return res.status(500).json({ success: false, error: 'Database error' });
      }

      if (!user) {
        return res.status(404).json({ success: false, error: 'User not found' });
      }

      const currentPic = user.profile_pic;

      // Delete file if exists
      if (currentPic) {
        // Extract filename from URL
        const filename = currentPic.split('/').pop();
        const filePath = path.join(__dirname, '..', '..', 'uploads', 'profile-pics', filename);
        
        console.log('🗑️ Attempting to delete file:', filePath);
        
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          console.log('✅ File deleted successfully:', filePath);
        } else {
          console.log('⚠️ File not found, skipping deletion:', filePath);
        }
      }

      // Update database to remove profile picture
      const { error: updateError } = await db.supabase
        .from('users')
        .update({ profile_pic: null })
        .eq('id', userId);

      if (updateError) {
        console.error('Error updating user:', updateError);
        return res.status(500).json({ success: false, error: 'Database error' });
      }
    } else {
      // PostgreSQL mode
      // Get current profile pic
      const result = await db.query(
        'SELECT profile_pic FROM users WHERE id = $1',
        [userId]
      );
      
      const users = result[0] || [];
      
      if (users.length === 0) {
        return res.status(404).json({ 
          success: false, 
          error: 'User not found' 
        });
      }
      
      const currentPic = users[0].profile_pic;
      
      // Delete file if exists
      if (currentPic) {
        // Extract filename from URL
        const filename = currentPic.split('/').pop();
        const filePath = path.join(__dirname, '..', '..', 'uploads', 'profile-pics', filename);
        
        console.log('🗑️ Attempting to delete file:', filePath);
        
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          console.log('✅ File deleted successfully:', filePath);
        } else {
          console.log('⚠️ File not found, skipping deletion:', filePath);
        }
      }
      
      // Update database to remove profile picture
      await db.query(
        'UPDATE users SET profile_pic = NULL WHERE id = $1',
        [userId]
      );
    }
    
    res.json({
      success: true,
      message: 'Profile picture removed successfully'
    });
    
  } catch (error) {
    console.error('❌ Remove profile pic error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to remove profile picture',
      debug: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// GET USER PROFILE (with picture)
router.get('/me/profile', authenticateToken, async (req, res) => {
  try {
    if (db.isSupabase) {
      // Supabase mode
      const { data: user, error } = await db.supabase
        .from('users')
        .select(`
          id, username, email, profile_pic, firstname, lastname, 
          rank, xp_points, matches_played, wins, losses, win_rate,
          bio, created_at
        `)
        .eq('id', req.user.id)
        .maybeSingle();

      if (error) {
        console.error('Database error:', error);
        return res.status(500).json({ success: false, error: 'Database error' });
      }

      if (!user) {
        return res.status(404).json({ success: false, error: 'User not found' });
      }

      // Ensure profile_pic is a full URL if it exists
      if (user.profile_pic && !user.profile_pic.startsWith('http')) {
        user.profile_pic = `${process.env.BASE_URL || 'http://localhost:5001'}${user.profile_pic}`;
      }

      res.json({
        success: true,
        data: user
      });
    } else {
      // PostgreSQL mode
      const result = await db.query(
        `SELECT id, username, email, profile_pic, firstname, lastname, 
                rank, xp_points, matches_played, wins, losses, win_rate,
                bio, created_at
         FROM users WHERE id = $1`,
        [req.user.id]
      );
      
      const users = result[0] || [];
      
      if (users.length === 0) {
        return res.status(404).json({ 
          success: false, 
          error: 'User not found' 
        });
      }
      
      const user = users[0];
      
      // Ensure profile_pic is a full URL if it exists
      if (user.profile_pic && !user.profile_pic.startsWith('http')) {
        user.profile_pic = `${process.env.BASE_URL || 'http://localhost:5001'}${user.profile_pic}`;
      }
      
      res.json({
        success: true,
        data: user
      });
    }
  } catch (error) {
    console.error('❌ Get profile error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to fetch profile' 
    });
  }
});

// GET /api/users/profile-with-xp
router.get('/profile-with-xp', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    
    console.log('🎯 /profile-with-xp called for user:', userId);
    
    // ADD CACHE CONTROL HEADERS
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    
    if (db.isSupabase) {
      // Supabase mode
      const { data: user, error } = await db.supabase
        .from('users')
        .select(`
          id, username, email, profile_pic, rank,
          matches_played, wins, losses, win_rate,
          xp_points, is_admin, account_status
        `)
        .eq('id', userId)
        .maybeSingle();

      if (error) {
        console.error('Database error:', error);
        return res.status(500).json({ 
          success: false, 
          error: 'Failed to fetch profile with XP',
          debug: error.message
        });
      }

      if (!user) {
        console.log('❌ User not found in database for ID:', userId);
        return res.status(404).json({ 
          success: false,
          error: 'User not found' 
        });
      }

      console.log('📊 User XP points from DB:', user.xp_points);
      
      // Format the response to match what Dashboard.jsx expects
      res.json({
        success: true,
        data: {
          user: {
            id: user.id,
            username: user.username,
            email: user.email,
            profile_pic: user.profile_pic,
            rank: user.rank || 'E',
            matches_played: user.matches_played || 0,
            wins: user.wins || 0,
            losses: user.losses || 0,
            win_rate: user.win_rate || 0,
            xp_points: user.xp_points || 0,
            is_admin: user.is_admin || false,
            account_status: user.account_status || 'active'
          },
          xp_points: user.xp_points || 0
        },
        user: { // Also include directly for backward compatibility
          id: user.id,
          username: user.username,
          email: user.email,
          profile_pic: user.profile_pic,
          rank: user.rank || 'E',
          matches_played: user.matches_played || 0,
          wins: user.wins || 0,
          losses: user.losses || 0,
          win_rate: user.win_rate || 0,
          xp_points: user.xp_points || 0,
          is_admin: user.is_admin || false,
          account_status: user.account_status || 'active'
        },
        xp_points: user.xp_points || 0,
        message: 'Profile with XP fetched successfully',
        timestamp: new Date().toISOString()
      });
    } else {
      // PostgreSQL mode
      const result = await db.query(
        `SELECT id, username, email, profile_pic, rank,
                matches_played, wins, losses, win_rate,
                xp_points, is_admin, account_status
         FROM users 
         WHERE id = $1`,
        [userId]
      );

      console.log('📊 Database query result structure:', {
        isArray: Array.isArray(result),
        length: result.length,
        result0: result[0],
        result1: result[1]
      });

      const users = result[0] || [];
      
      console.log('📊 Extracted users array:', users);
      console.log('📊 Users length:', users.length);

      if (users.length === 0) {
        console.log('❌ User not found in database for ID:', userId);
        return res.status(404).json({ 
          success: false,
          error: 'User not found' 
        });
      }

      const userData = users[0];
      console.log('📊 User XP points from DB:', userData.xp_points);
      
      // Format the response to match what Dashboard.jsx expects
      res.json({
        success: true,
        data: {
          user: {
            id: userData.id,
            username: userData.username,
            email: userData.email,
            profile_pic: userData.profile_pic,
            rank: userData.rank || 'E',
            matches_played: userData.matches_played || 0,
            wins: userData.wins || 0,
            losses: userData.losses || 0,
            win_rate: userData.win_rate || 0,
            xp_points: userData.xp_points || 0,
            is_admin: userData.is_admin || false,
            account_status: userData.account_status || 'active'
          },
          xp_points: userData.xp_points || 0
        },
        user: {
          id: userData.id,
          username: userData.username,
          email: userData.email,
          profile_pic: userData.profile_pic,
          rank: userData.rank || 'E',
          matches_played: userData.matches_played || 0,
          wins: userData.wins || 0,
          losses: userData.losses || 0,
          win_rate: userData.win_rate || 0,
          xp_points: userData.xp_points || 0,
          is_admin: userData.is_admin || false,
          account_status: userData.account_status || 'active'
        },
        xp_points: userData.xp_points || 0,
        message: 'Profile with XP fetched successfully',
        timestamp: new Date().toISOString()
      });
    }
  } catch (error) {
    console.error('❌ Get profile with XP error:', error);
    console.error('❌ Error stack:', error.stack);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch profile with XP',
      debug: error.message
    });
  }
});

// GET /api/users/xp - Get only XP balance (simple)
router.get('/xp', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    
    console.log('💰 /xp endpoint called for user:', userId);
    
    // ADD CACHE CONTROL HEADERS
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    
    if (db.isSupabase) {
      // Supabase mode
      const { data: user, error } = await db.supabase
        .from('users')
        .select('xp_points')
        .eq('id', userId)
        .maybeSingle();

      if (error) {
        console.error('Database error:', error);
        return res.status(500).json({ 
          success: false,
          error: 'Failed to fetch XP balance',
          xp_points: 0
        });
      }

      if (!user) {
        return res.status(404).json({ 
          success: false,
          error: 'User not found' 
        });
      }

      const xpBalance = user.xp_points || 0;
      console.log('💰 XP balance:', xpBalance);
      
      res.json({
        success: true,
        xp_points: xpBalance,
        user_id: userId,
        formatted_xp: xpBalance.toLocaleString(),
        timestamp: new Date().toISOString()
      });
    } else {
      // PostgreSQL mode
      const result = await db.query(
        `SELECT xp_points FROM users WHERE id = $1`,
        [userId]
      );
      
      const users = result[0] || [];

      if (users.length === 0) {
        return res.status(404).json({ 
          success: false,
          error: 'User not found' 
        });
      }

      const xpBalance = users[0].xp_points || 0;
      console.log('💰 XP balance:', xpBalance);
      
      res.json({
        success: true,
        xp_points: xpBalance,
        user_id: userId,
        formatted_xp: xpBalance.toLocaleString(),
        timestamp: new Date().toISOString()
      });
    }
  } catch (error) {
    console.error('❌ Get XP error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch XP balance',
      xp_points: 0
    });
  }
});

// SEARCH USERS - MOVED HERE (BEFORE :id routes)
router.get('/search', authenticateToken, async (req, res) => {
  try {
    const { query } = req.query;
    
    console.log('🔍 Search endpoint called with query:', query);
    
    if (!query || query.length < 2) {
      return res.json({ 
        success: true,
        users: [] 
      });
    }

    if (db.isSupabase) {
      // Supabase mode
      const { data: users, error } = await db.supabase
        .from('users')
        .select('id, username, profile_pic, rank, matches_played, wins, losses, win_rate')
        .ilike('username', `%${query}%`)
        .neq('id', req.user.id)
        .eq('is_banned', false)
        .limit(10);

      if (error) {
        console.error('Database error:', error);
        return res.status(500).json({ 
          success: false,
          error: 'Search failed',
          users: []
        });
      }

      console.log('✅ Found users:', users.length);
      
      res.json({ 
        success: true,
        users: users || []
      });
    } else {
      // PostgreSQL mode
      const result = await db.query(
        `SELECT id, username, profile_pic, rank, matches_played, wins, losses, win_rate
         FROM users 
         WHERE username ILIKE $1 AND id != $2 AND is_banned = false
         LIMIT 10`,
        [`%${query}%`, req.user.id]
      );
      
      const users = result[0] || [];

      console.log('✅ Found users:', users.length);
      
      res.json({ 
        success: true,
        users: users || []
      });
    }
  } catch (error) {
    console.error('❌ User search error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Search failed',
      users: []
    });
  }
});

// Get user by ID (for viewing other users' profiles)
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const userId = req.params.id;
    const currentUserId = req.user.id;
    
    console.log('🔵 GET USER BY ID: Requested', userId, 'Current user:', currentUserId);
    
    if (db.isSupabase) {
      // Supabase mode
      const { data: user, error } = await db.supabase
        .from('users')
        .select(`
          id, username, email, firstname, lastname, profile_pic, 
          rank, matches_played, wins, losses, balance, win_rate,
          xp_points, wallet_account_number, bio, account_status,
          created_at, is_banned, is_admin
        `)
        .eq('id', userId)
        .eq('is_banned', false)
        .maybeSingle();

      if (error) {
        console.error('Database error:', error);
        return res.status(500).json({ 
          success: false,
          error: 'Failed to fetch user profile' 
        });
      }

      if (!user) {
        return res.status(404).json({ 
          success: false,
          error: 'User not found' 
        });
      }

      // HIDE SENSITIVE DATA if viewing other user's profile
      if (userId !== currentUserId) {
        user.email = 'hidden@example.com';
        user.wallet_account_number = '********';
        user.balance = 0;
        user.is_admin = false;
      }

      // Get user's equipped title (only if viewing own profile)
      let equipped_title = null;
      if (userId === currentUserId) {
        const { data: titleData, error: titleError } = await db.supabase
          .from('user_titles')
          .select(`
            title_id,
            titles:title_id (name, tier, color, icon, description)
          `)
          .eq('user_id', userId)
          .eq('is_equipped', true)
          .maybeSingle();

        if (!titleError && titleData && titleData.titles) {
          equipped_title = titleData.titles;
        }
      }

      // Get user stats from user_stats table
      const { data: stats, error: statsError } = await db.supabase
        .from('user_stats')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();

      res.json({
        success: true,
        data: {
          ...user,
          equipped_title: equipped_title,
          stats: stats || null
        }
      });
    } else {
      // PostgreSQL mode
      const result = await db.query(
        `SELECT u.id, u.username, u.email, u.firstname, u.lastname, u.profile_pic, 
                u.rank, u.matches_played, u.wins, u.losses, u.balance, u.win_rate,
                u.xp_points, u.wallet_account_number, u.bio, u.account_status,
                u.created_at, u.is_banned, u.is_admin,
                ur.name as rank_name, ur.color as rank_color, ur.glow as rank_glow
         FROM users u
         LEFT JOIN rank_requirements ur ON u.rank = ur.rank
         WHERE u.id = $1 AND u.is_banned = false`,
        [userId]
      );
      
      const users = result[0] || [];

      if (users.length === 0) {
        return res.status(404).json({ 
          success: false,
          error: 'User not found' 
        });
      }

      let userData = users[0];
      
      // HIDE SENSITIVE DATA if viewing other user's profile
      if (parseInt(userId) !== parseInt(currentUserId)) {
        userData = {
          ...userData,
          email: 'hidden@example.com',
          wallet_account_number: '********',
          balance: 0,
          is_admin: false
        };
      }

      // Get user's equipped title (only if viewing own profile)
      let equipped_title = null;
      if (parseInt(userId) === parseInt(currentUserId)) {
        const titleResult = await db.query(
          `SELECT t.name, t.tier, t.color, t.icon, t.description
           FROM user_titles ut
           JOIN titles t ON ut.title_id = t.id
           WHERE ut.user_id = $1 AND ut.is_equipped = true
           LIMIT 1`,
          [userId]
        );
        const titles = titleResult[0] || [];
        equipped_title = titles.length > 0 ? titles[0] : null;
      }

      // Get user stats from user_stats table
      const statsResult = await db.query(
        `SELECT * FROM user_stats WHERE user_id = $1`,
        [userId]
      );
      const stats = statsResult[0] || [];

      res.json({
        success: true,
        data: {
          ...userData,
          equipped_title: equipped_title,
          stats: stats.length > 0 ? stats[0] : null
        }
      });
    }
  } catch (error) {
    console.error('Get user by ID error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch user profile' 
    });
  }
});

// Get user's rank progress
router.get('/:id/rank-progress', authenticateToken, async (req, res) => {
  try {
    const userId = req.params.id;
    
    console.log('📊 Fetching rank progress for user:', userId);
    
    if (db.isSupabase) {
      // Supabase mode
      // Get user's current rank and stats
      const { data: user, error: userError } = await db.supabase
        .from('users')
        .select('id, rank, username, wins, matches_played, win_rate, balance')
        .eq('id', userId)
        .maybeSingle();

      if (userError) {
        console.error('Database error:', userError);
        return res.status(500).json({ error: 'Failed to fetch user data' });
      }

      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      // Get current rank requirements
      const { data: currentRankData, error: rankError } = await db.supabase
        .from('rank_requirements')
        .select('*')
        .eq('rank', user.rank)
        .maybeSingle();

      if (rankError) {
        console.error('Error fetching rank:', rankError);
        return res.status(500).json({ error: 'Failed to fetch rank data' });
      }

      if (!currentRankData) {
        return res.status(404).json({ error: 'Rank not found' });
      }

      // Define rank sequence
      const rankSequence = ['SSS', 'SS', 'S', 'A', 'B', 'C', 'D', 'E'];
      
      // Find current rank position
      const currentRankIndex = rankSequence.indexOf(user.rank);
      
      // Get next rank if not at highest rank
      let nextRank = null;
      let targetRank = null;
      
      if (currentRankIndex > 0) {
        const nextRankCode = rankSequence[currentRankIndex - 1];
        const { data: nextRankData, error: nextError } = await db.supabase
          .from('rank_requirements')
          .select('*')
          .eq('rank', nextRankCode)
          .maybeSingle();

        if (!nextError && nextRankData) {
          nextRank = nextRankData;
          targetRank = nextRankData.target_rank;
        }
      }

      // Get user's additional stats
      let stakedWins = 0;
      if (nextRank && nextRank.min_staked_wins > 0 && nextRank.min_stake_amount > 0) {
        const { count } = await db.supabase
          .from('matches')
          .select('*', { count: 'exact', head: true })
          .eq('winner_id', userId)
          .gte('stake_amount', nextRank.min_stake_amount)
          .eq('status', 'completed');

        stakedWins = count || 0;
      }

      let tournamentWins = 0;
      if (nextRank && nextRank.min_tournament_wins > 0) {
        const { count } = await db.supabase
          .from('tournaments')
          .select('*', { count: 'exact', head: true })
          .eq('winner_id', userId)
          .eq('status', 'completed');

        tournamentWins = count || 0;
      }

      let higherRankDefeats = 0;
      if (nextRank && nextRank.min_higher_rank_defeats > 0 && targetRank) {
        const { count } = await db.supabase
          .from('matches')
          .select('*', { count: 'exact', head: true })
          .eq('winner_id', userId)
          .eq('status', 'completed')
          .filter('opponent.rank', 'eq', targetRank);

        higherRankDefeats = count || 0;
      }

      let freeforallWins = 0, squadWins = 0, onevsoneWins = 0;
      if (nextRank && (nextRank.min_freeforall_wins > 0 || nextRank.min_squad_wins > 0 || nextRank.min_onevsone_wins > 0)) {
        const { data: tournamentData } = await db.supabase
          .from('tournaments')
          .select('type')
          .eq('winner_id', userId)
          .eq('status', 'completed');

        if (tournamentData) {
          freeforallWins = tournamentData.filter(t => t.type === 'freeforall').length;
          squadWins = tournamentData.filter(t => t.type === 'squad').length;
          onevsoneWins = tournamentData.filter(t => t.type === 'onevsone').length;
        }
      }

      // Calculate progress
      const progress = {
        wins: {
          label: 'Wins',
          icon: 'trophy',
          current: user.wins,
          required: nextRank ? nextRank.min_wins : currentRankData.min_wins,
          percentage: nextRank ? 
            Math.min(100, (user.wins / Math.max(1, nextRank.min_wins)) * 100) :
            100,
          color: '#FBBF24'
        },
        matches: {
          label: 'Matches Played',
          icon: 'gamepad',
          current: user.matches_played,
          required: nextRank ? nextRank.min_matches : currentRankData.min_matches,
          percentage: nextRank ? 
            Math.min(100, (user.matches_played / Math.max(1, nextRank.min_matches)) * 100) :
            100,
          color: '#60A5FA'
        },
        win_rate: {
          label: 'Win Rate',
          icon: 'trending-up',
          current: parseFloat(user.win_rate),
          required: nextRank ? parseFloat(nextRank.win_rate) : parseFloat(currentRankData.win_rate),
          percentage: nextRank ? 
            Math.min(100, (parseFloat(user.win_rate) / Math.max(1, parseFloat(nextRank.win_rate))) * 100) :
            100,
          color: '#10B981'
        }
      };

      if (nextRank && nextRank.min_staked_wins > 0) {
        progress.staked_wins = {
          label: `Staked Wins (≥₦${nextRank.min_stake_amount || 0})`,
          icon: 'coins',
          current: stakedWins,
          required: nextRank.min_staked_wins,
          percentage: Math.min(100, (stakedWins / Math.max(1, nextRank.min_staked_wins)) * 100),
          color: '#F59E0B'
        };
      }

      if (nextRank && nextRank.min_tournament_wins > 0) {
        progress.tournament_wins = {
          label: 'Tournament Wins',
          icon: 'trophy',
          current: tournamentWins,
          required: nextRank.min_tournament_wins,
          percentage: Math.min(100, (tournamentWins / Math.max(1, nextRank.min_tournament_wins)) * 100),
          color: '#8B5CF6'
        };
      }

      if (nextRank && nextRank.min_higher_rank_defeats > 0) {
        progress.higher_rank_defeats = {
          label: `Defeat ${targetRank || 'Higher'} Ranks`,
          icon: 'swords',
          current: higherRankDefeats,
          required: nextRank.min_higher_rank_defeats,
          percentage: Math.min(100, (higherRankDefeats / Math.max(1, nextRank.min_higher_rank_defeats)) * 100),
          color: '#EF4444'
        };
      }

      // Calculate overall progress
      const requirements = Object.values(progress);
      const validRequirements = requirements.filter(req => req.required > 0);
      const completedRequirements = validRequirements.filter(req => req.current >= req.required).length;
      const overallPercentage = validRequirements.length > 0 ? 
        Math.round((completedRequirements / validRequirements.length) * 100) : 
        (nextRank ? 0 : 100);

      const canRankUp = nextRank ? validRequirements.every(req => req.current >= req.required) : false;

      res.json({
        success: true,
        data: {
          user: {
            id: user.id,
            username: user.username,
            rank: user.rank,
            current_wins: user.wins,
            current_matches: user.matches_played,
            current_win_rate: user.win_rate,
            balance: user.balance
          },
          current_rank: {
            ...currentRankData,
            color: currentRankData.color || '#FFFFFF',
            glow: currentRankData.glow || '0 0 10px #FFFFFF'
          },
          next_rank: nextRank,
          progress: progress,
          stats: {
            wins: user.wins,
            matches: user.matches_played,
            win_rate: user.win_rate,
            staked_wins: stakedWins,
            tournament_wins: tournamentWins,
            higher_rank_defeats: higherRankDefeats,
            freeforall_wins: freeforallWins,
            squad_wins: squadWins,
            onevsone_wins: onevsoneWins
          },
          overall_percentage: overallPercentage,
          can_rank_up: canRankUp,
          requirements_met: completedRequirements,
          total_requirements: validRequirements.length
        }
      });
    } else {
      // PostgreSQL mode (keep existing code)
      const result = await db.query(
        `SELECT id, rank, username, wins, matches_played, win_rate, balance 
         FROM users WHERE id = $1`,
        [userId]
      );

      const userData = result[0] || [];
      
      if (userData.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }

      const user = userData[0];
      
      // Get current rank requirements
      const currentRankResult = await db.query(
        `SELECT * FROM rank_requirements WHERE rank = $1`,
        [user.rank]
      );
      
      const currentRankData = currentRankResult[0] || [];

      if (currentRankData.length === 0) {
        return res.status(404).json({ error: 'Rank not found' });
      }

      const currentRank = currentRankData[0];
      
      // Define rank sequence
      const rankSequence = ['SSS', 'SS', 'S', 'A', 'B', 'C', 'D', 'E'];
      
      // Find current rank position
      const currentRankIndex = rankSequence.indexOf(user.rank);
      
      // Get next rank if not at highest rank
      let nextRank = null;
      let targetRank = null;
      
      if (currentRankIndex > 0) {
        const nextRankCode = rankSequence[currentRankIndex - 1];
        const nextRankResult = await db.query(
          `SELECT * FROM rank_requirements WHERE rank = $1`,
          [nextRankCode]
        );
        const nextRankData = nextRankResult[0] || [];
        if (nextRankData.length > 0) {
          nextRank = nextRankData[0];
          targetRank = nextRank.target_rank;
        }
      }

      // Get user's additional stats
      let stakedWins = 0;
      if (nextRank && nextRank.min_staked_wins > 0 && nextRank.min_stake_amount > 0) {
        const stakedWinsResult = await db.query(
          `SELECT COUNT(*) AS count FROM matches 
           WHERE winner_id = $1 
             AND stake_amount >= $2
             AND status = 'completed'`,
          [userId, nextRank.min_stake_amount]
        );
        const stakedWinsData = stakedWinsResult[0] || [];
        stakedWins = parseInt(stakedWinsData[0]?.count) || 0;
      }

      let tournamentWins = 0;
      if (nextRank && nextRank.min_tournament_wins > 0) {
        const tournamentWinsResult = await db.query(
          `SELECT COUNT(DISTINCT tp.tournament_id) AS count
           FROM tournament_participants tp
           JOIN tournaments t ON tp.tournament_id = t.id
           WHERE tp.user_id = $1 
             AND t.status = 'completed'
             AND t.winner_id = $2`,
          [userId, userId]
        );
        const tournamentWinsData = tournamentWinsResult[0] || [];
        tournamentWins = parseInt(tournamentWinsData[0]?.count) || 0;
      }

      let higherRankDefeats = 0;
      if (nextRank && nextRank.min_higher_rank_defeats > 0 && targetRank) {
        const higherRankDefeatsResult = await db.query(
          `SELECT COUNT(*) AS count 
           FROM matches m
           JOIN users opponent ON (m.player1_id = opponent.id OR m.player2_id = opponent.id)
           WHERE m.winner_id = $1
             AND opponent.id != $2
             AND opponent.rank = $3
             AND m.status = 'completed'`,
          [userId, userId, targetRank]
        );
        const higherRankDefeatsData = higherRankDefeatsResult[0] || [];
        higherRankDefeats = parseInt(higherRankDefeatsData[0]?.count) || 0;
      }

      let freeforallWins = 0, squadWins = 0, onevsoneWins = 0;
      if (nextRank && (nextRank.min_freeforall_wins > 0 || nextRank.min_squad_wins > 0 || nextRank.min_onevsone_wins > 0)) {
        const tournamentTypeWinsResult = await db.query(
          `SELECT 
             SUM(CASE WHEN t.type = 'freeforall' THEN 1 ELSE 0 END) AS freeforall_wins,
             SUM(CASE WHEN t.type = 'squad' THEN 1 ELSE 0 END) AS squad_wins,
             SUM(CASE WHEN t.type = 'onevsone' THEN 1 ELSE 0 END) AS onevsone_wins
           FROM tournaments t
           WHERE t.winner_id = $1 AND t.status = 'completed'`,
          [userId]
        );
        
        const tournamentTypeWinsData = tournamentTypeWinsResult[0] || [];
        freeforallWins = parseInt(tournamentTypeWinsData[0]?.freeforall_wins) || 0;
        squadWins = parseInt(tournamentTypeWinsData[0]?.squad_wins) || 0;
        onevsoneWins = parseInt(tournamentTypeWinsData[0]?.onevsone_wins) || 0;
      }

      // Calculate progress
      const progress = {
        wins: {
          label: 'Wins',
          icon: 'trophy',
          current: user.wins,
          required: nextRank ? nextRank.min_wins : currentRank.min_wins,
          percentage: nextRank ? 
            Math.min(100, (user.wins / Math.max(1, nextRank.min_wins)) * 100) :
            100,
          color: '#FBBF24'
        },
        matches: {
          label: 'Matches Played',
          icon: 'gamepad',
          current: user.matches_played,
          required: nextRank ? nextRank.min_matches : currentRank.min_matches,
          percentage: nextRank ? 
            Math.min(100, (user.matches_played / Math.max(1, nextRank.min_matches)) * 100) :
            100,
          color: '#60A5FA'
        },
        win_rate: {
          label: 'Win Rate',
          icon: 'trending-up',
          current: parseFloat(user.win_rate),
          required: nextRank ? parseFloat(nextRank.win_rate) : parseFloat(currentRank.win_rate),
          percentage: nextRank ? 
            Math.min(100, (parseFloat(user.win_rate) / Math.max(1, parseFloat(nextRank.win_rate))) * 100) :
            100,
          color: '#10B981'
        }
      };

      if (nextRank && nextRank.min_staked_wins > 0) {
        progress.staked_wins = {
          label: `Staked Wins (≥₦${nextRank.min_stake_amount || 0})`,
          icon: 'coins',
          current: stakedWins,
          required: nextRank.min_staked_wins,
          percentage: Math.min(100, (stakedWins / Math.max(1, nextRank.min_staked_wins)) * 100),
          color: '#F59E0B'
        };
      }

      if (nextRank && nextRank.min_tournament_wins > 0) {
        progress.tournament_wins = {
          label: 'Tournament Wins',
          icon: 'trophy',
          current: tournamentWins,
          required: nextRank.min_tournament_wins,
          percentage: Math.min(100, (tournamentWins / Math.max(1, nextRank.min_tournament_wins)) * 100),
          color: '#8B5CF6'
        };
      }

      if (nextRank && nextRank.min_higher_rank_defeats > 0) {
        progress.higher_rank_defeats = {
          label: `Defeat ${targetRank || 'Higher'} Ranks`,
          icon: 'swords',
          current: higherRankDefeats,
          required: nextRank.min_higher_rank_defeats,
          percentage: Math.min(100, (higherRankDefeats / Math.max(1, nextRank.min_higher_rank_defeats)) * 100),
          color: '#EF4444'
        };
      }

      // Calculate overall progress
      const requirements = Object.values(progress);
      const validRequirements = requirements.filter(req => req.required > 0);
      const completedRequirements = validRequirements.filter(req => req.current >= req.required).length;
      const overallPercentage = validRequirements.length > 0 ? 
        Math.round((completedRequirements / validRequirements.length) * 100) : 
        (nextRank ? 0 : 100);

      const canRankUp = nextRank ? validRequirements.every(req => req.current >= req.required) : false;

      res.json({
        success: true,
        data: {
          user: {
            id: user.id,
            username: user.username,
            rank: user.rank,
            current_wins: user.wins,
            current_matches: user.matches_played,
            current_win_rate: user.win_rate,
            balance: user.balance
          },
          current_rank: {
            ...currentRank,
            color: currentRank.color || '#FFFFFF',
            glow: currentRank.glow || '0 0 10px #FFFFFF'
          },
          next_rank: nextRank,
          progress: progress,
          stats: {
            wins: user.wins,
            matches: user.matches_played,
            win_rate: user.win_rate,
            staked_wins: stakedWins,
            tournament_wins: tournamentWins,
            higher_rank_defeats: higherRankDefeats,
            freeforall_wins: freeforallWins,
            squad_wins: squadWins,
            onevsone_wins: onevsoneWins
          },
          overall_percentage: overallPercentage,
          can_rank_up: canRankUp,
          requirements_met: completedRequirements,
          total_requirements: validRequirements.length
        }
      });
    }
  } catch (error) {
    console.error('Get rank progress error:', error);
    res.status(500).json({ error: 'Failed to fetch rank progress' });
  }
});

// GET /api/users/:id/matches - Get user's recent matches
router.get('/:id/matches', authenticate, async (req, res) => {
  try {
    const userId = req.params.id;
    const { limit = 10, status } = req.query;
    
    console.log(`🎮 Fetching matches for user ${userId}, limit: ${limit}`);

    if (db.isSupabase) {
      // Supabase mode
      let query = db.supabase
        .from('matches')
        .select(`
          *,
          player1:player1_id (username),
          player2:player2_id (username),
          winner:winner_id (username)
        `)
        .or(`player1_id.eq.${userId},player2_id.eq.${userId}`)
        .order('created_at', { ascending: false })
        .limit(parseInt(limit));

      if (status) {
        query = query.eq('status', status);
      }

      const { data: matches, error } = await query;

      if (error) {
        console.error('Database error:', error);
        return res.status(500).json({
          success: false,
          error: 'Failed to fetch user matches: ' + error.message
        });
      }

      console.log(`✅ Found ${matches?.length || 0} matches for user ${userId}`);
      
      res.json({
        success: true,
        data: (matches || []).map(match => ({
          id: match.id,
          player1_id: match.player1_id,
          player2_id: match.player2_id,
          winner_id: match.winner_id,
          status: match.status,
          game: match.game || 'Unknown Game',
          opponent_name: match.player1_id === userId ? match.player2?.username : match.player1?.username,
          created_at: match.created_at,
          ended_at: match.completed_at || match.updated_at,
          xp_earned: match.xp_earned || (match.winner_id === userId ? 100 : 0)
        }))
      });
    } else {
      // PostgreSQL mode
      let query = `
        SELECT 
          m.*,
          CASE 
            WHEN m.player1_id = $1 THEN p2.username
            WHEN m.player2_id = $1 THEN p1.username
          END as opponent_name,
          p1.username as player1_username,
          p2.username as player2_username,
          w.username as winner_username
        FROM matches m
        LEFT JOIN users p1 ON m.player1_id = p1.id
        LEFT JOIN users p2 ON m.player2_id = p2.id
        LEFT JOIN users w ON m.winner_id = w.id
        WHERE (m.player1_id = $1 OR m.player2_id = $1)
      `;
      
      const params = [userId];
      
      if (status) {
        query += ` AND m.status = $${params.length + 1}`;
        params.push(status);
      }
      
      query += ` ORDER BY m.created_at DESC LIMIT $${params.length + 1}`;
      params.push(parseInt(limit));
      
      const result = await db.query(query, params);
      const matches = result[0] || [];
      
      console.log(`✅ Found ${matches.length} matches for user ${userId}`);
      
      res.json({
        success: true,
        data: matches.map(match => ({
          id: match.id,
          player1_id: match.player1_id,
          player2_id: match.player2_id,
          winner_id: match.winner_id,
          status: match.status,
          game: match.game || 'Unknown Game',
          opponent_name: match.opponent_name,
          created_at: match.created_at,
          ended_at: match.completed_at || match.updated_at,
          xp_earned: match.xp_earned || (match.winner_id === userId ? 100 : 0)
        }))
      });
    }
  } catch (error) {
    console.error('❌ Get user matches error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch user matches: ' + error.message
    });
  }
});

// GET /api/users/:id/dashboard - Get dashboard summary
router.get('/:id/dashboard', authenticateToken, async (req, res) => {
  try {
    const userId = req.params.id;
    const currentUserId = req.user.id;
    
    console.log('🔵 DASHBOARD: Requested for user', userId, 'Current user:', currentUserId);
    
    // Allow viewing own dashboard OR public view of others
    const isOwnDashboard = parseInt(userId) === parseInt(currentUserId);

    if (db.isSupabase) {
      // Supabase mode
      const { data: user, error: userError } = await db.supabase
        .from('users')
        .select(`
          wins, matches_played, win_rate, rank, tournaments_won, xp_points
        `)
        .eq('id', userId)
        .maybeSingle();

      if (userError) {
        console.error('Database error:', userError);
        return res.status(500).json({
          success: false,
          error: 'Failed to fetch dashboard data: ' + userError.message
        });
      }

      if (!user) {
        return res.status(404).json({
          success: false,
          error: 'User not found'
        });
      }

      // Get recent activity (last 5 matches)
      const { data: recentMatches, error: matchesError } = await db.supabase
        .from('matches')
        .select(`
          *,
          player1:player1_id (username),
          player2:player2_id (username)
        `)
        .or(`player1_id.eq.${userId},player2_id.eq.${userId}`)
        .eq('status', 'completed')
        .order('completed_at', { ascending: false })
        .limit(5);

      if (matchesError) {
        console.error('Error fetching matches:', matchesError);
      }

      // Format activity
      const recentActivity = (recentMatches || []).map(match => {
        const opponent = match.player1_id === userId ? match.player2?.username : match.player1?.username;
        const isWin = match.winner_id === userId;
        
        return {
          type: isWin ? 'win' : 'loss',
          description: isWin 
            ? `Defeated ${opponent || 'Opponent'}`
            : `Lost to ${opponent || 'Opponent'}`,
          game: match.game || 'Unknown',
          timestamp: match.completed_at,
          xp: isWin ? 100 : 0
        };
      });

      // Get live tournaments user is in (only for own dashboard)
      let liveTournaments = [];
      if (isOwnDashboard) {
        const { data: tournaments, error: tourError } = await db.supabase
          .from('tournaments')
          .select(`
            id, name, game, type, prize_pool, max_players
          `)
          .eq('status', 'ongoing')
          .eq('creator_id', userId)
          .limit(3);

        if (!tourError && tournaments) {
          liveTournaments = tournaments;
        }
      }

      // Calculate rank progress
      const currentRank = user.rank || 'E';
      const rankOrder = ['E', 'D', 'C', 'B', 'A', 'S', 'SS', 'SSS'];
      const currentIndex = rankOrder.indexOf(currentRank);
      const nextRank = currentIndex < rankOrder.length - 1 ? rankOrder[currentIndex + 1] : null;
      
      // Simple progress calculation
      const winsProgress = Math.min(100, (user.wins || 0) / 10 * 100);
      const matchesProgress = Math.min(100, (user.matches_played || 0) / 20 * 100);
      const winRateProgress = Math.min(100, (parseFloat(user.win_rate) || 0) / 50 * 100);
      const overallProgress = Math.round((winsProgress + matchesProgress + winRateProgress) / 3);
      
      const rankProgress = {
        current: currentRank,
        next: nextRank,
        progress: overallProgress,
        wins_needed: 10,
        matches_needed: 20,
        win_rate_needed: 50
      };

      res.json({
        success: true,
        data: {
          tournaments_won: user.tournaments_won || 0,
          matches_played: user.matches_played || 0,
          win_rate: parseFloat(user.win_rate) || 0,
          rank: currentRank,
          wins: user.wins || 0,
          xp_points: user.xp_points || 0,
          recent_activity: recentActivity,
          live_tournaments: liveTournaments,
          rank_progress: rankProgress,
          is_own_dashboard: isOwnDashboard
        }
      });
    } else {
      // PostgreSQL mode
      const result = await db.query(`
        SELECT 
          u.wins,
          u.matches_played,
          u.win_rate,
          u.rank,
          u.tournaments_won,
          u.xp_points
        FROM users u
        WHERE u.id = $1
      `, [userId]);
      
      const users = result[0] || [];

      if (users.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'User not found'
        });
      }
      
      const user = users[0];
      
      // Get recent activity (last 5 matches)
      const recentMatchesResult = await db.query(`
        SELECT 
          m.*,
          CASE 
            WHEN m.winner_id = $1 THEN 'win'
            WHEN m.winner_id IS NOT NULL AND m.winner_id != $1 THEN 'loss'
            ELSE 'match'
          END AS type,
          CASE 
            WHEN m.player1_id = $1 THEN p2.username
            WHEN m.player2_id = $1 THEN p1.username
            ELSE 'Unknown'
          END AS opponent_name,
          m.game
        FROM matches m
        LEFT JOIN users p1 ON m.player1_id = p1.id
        LEFT JOIN users p2 ON m.player2_id = p2.id
        WHERE (m.player1_id = $1 OR m.player2_id = $1)
          AND m.status = 'completed'
        ORDER BY m.completed_at DESC
        LIMIT 5
      `, [userId]);
      
      const recentMatches = recentMatchesResult[0] || [];
      
      // Format activity
      const recentActivity = recentMatches.map(match => ({
        type: match.type,
        description: match.type === 'win' 
          ? `Defeated ${match.opponent_name || 'Opponent'}`
          : match.type === 'loss'
          ? `Lost to ${match.opponent_name || 'Opponent'}`
          : `Match vs ${match.opponent_name || 'Opponent'}`,
        game: match.game || 'Unknown',
        timestamp: match.completed_at,
        xp: match.type === 'win' ? 100 : 0
      }));
      
      // Get live tournaments user is in (only for own dashboard)
      let liveTournaments = [];
      if (isOwnDashboard) {
        try {
          const tournamentsResult = await db.query(`
            SELECT DISTINCT 
              t.id,
              t.name,
              t.game,
              t.type,
              t.prize_pool,
              t.max_players
            FROM tournaments t
            WHERE t.status = 'ongoing'
              AND t.creator_id = $1
            LIMIT 3
          `, [userId]);
          const tournaments = tournamentsResult[0] || [];
          liveTournaments = tournaments;
        } catch (error) {
          console.log('No live tournaments:', error.message);
        }
      }
      
      // Calculate rank progress
      const currentRank = user.rank || 'E';
      const rankOrder = ['E', 'D', 'C', 'B', 'A', 'S', 'SS', 'SSS'];
      const currentIndex = rankOrder.indexOf(currentRank);
      const nextRank = currentIndex < rankOrder.length - 1 ? rankOrder[currentIndex + 1] : null;
      
      // Simple progress calculation
      const winsProgress = Math.min(100, (user.wins || 0) / 10 * 100);
      const matchesProgress = Math.min(100, (user.matches_played || 0) / 20 * 100);
      const winRateProgress = Math.min(100, (parseFloat(user.win_rate) || 0) / 50 * 100);
      const overallProgress = Math.round((winsProgress + matchesProgress + winRateProgress) / 3);
      
      const rankProgress = {
        current: currentRank,
        next: nextRank,
        progress: overallProgress,
        wins_needed: 10,
        matches_needed: 20,
        win_rate_needed: 50
      };
      
      res.json({
        success: true,
        data: {
          tournaments_won: user.tournaments_won || 0,
          matches_played: user.matches_played || 0,
          win_rate: parseFloat(user.win_rate) || 0,
          rank: currentRank,
          wins: user.wins || 0,
          xp_points: user.xp_points || 0,
          recent_activity: recentActivity,
          live_tournaments: liveTournaments,
          rank_progress: rankProgress,
          is_own_dashboard: isOwnDashboard
        }
      });
    }
  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch dashboard data: ' + error.message
    });
  }
});

// GET /api/users/:id/stats
router.get('/:id/stats', authenticateToken, async (req, res) => {
  try {
    const userId = req.params.id;
    
    console.log('📊 Fetching stats for user ID:', userId);
    
    if (db.isSupabase) {
      // Supabase mode
      const { data: user, error } = await db.supabase
        .from('users')
        .select(`
          wins, matches_played, win_rate, rank, tournaments_won, xp_points
        `)
        .eq('id', userId)
        .maybeSingle();

      if (error) {
        console.error('Database error:', error);
        return res.status(500).json({ 
          success: false, 
          error: error.message
        });
      }

      if (!user) {
        console.log('⚠️ No stats found for user:', userId);
        return res.json({
          success: true,
          data: {
            wins: 0,
            matches_played: 0,
            win_rate: 0,
            rank: 'E',
            tournaments_won: 0,
            xp_points: 0
          }
        });
      }

      // Get tournament wins count
      const { count } = await db.supabase
        .from('tournaments')
        .select('*', { count: 'exact', head: true })
        .eq('winner_id', userId)
        .eq('status', 'completed');

      res.json({
        success: true,
        data: {
          ...user,
          tournament_wins: count || 0
        }
      });
    } else {
      // PostgreSQL mode
      const result = await db.query(`
        SELECT 
          u.wins,
          u.matches_played,
          u.win_rate,
          u.rank,
          u.tournaments_won,
          u.xp_points,
          COALESCE(COUNT(DISTINCT CASE WHEN t.status = 'completed' AND t.winner_id = u.id THEN t.id END), 0) AS tournament_wins
        FROM users u
        LEFT JOIN tournaments t ON t.winner_id = u.id
        WHERE u.id = $1
        GROUP BY u.id
      `, [userId]);
      
      const stats = result[0] || [];
      
      if (stats.length === 0) {
        console.log('⚠️ No stats found for user:', userId);
        return res.json({
          success: true,
          data: {
            wins: 0,
            matches_played: 0,
            win_rate: 0,
            rank: 'E',
            tournaments_won: 0,
            xp_points: 0,
            tournament_wins: 0
          }
        });
      }
      
      res.json({
        success: true,
        data: stats[0]
      });
    }
  } catch (error) {
    console.error('❌ Get user stats error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message
    });
  }
});

// Get user's earned titles
router.get('/:id/titles', authenticateToken, async (req, res) => {
  try {
    const userId = req.params.id;
    
    if (db.isSupabase) {
      // Supabase mode
      const { data: titles, error } = await db.supabase
        .from('user_titles')
        .select(`
          id,
          title_id,
          earned_at,
          is_equipped,
          tournament_id,
          titles:title_id (name, tier, description, color, icon)
        `)
        .eq('user_id', userId)
        .order('earned_at', { ascending: false });

      if (error) {
        console.error('Database error:', error);
        return res.status(500).json({ error: 'Failed to fetch user titles' });
      }

      // Group titles by tier
      const titlesByTier = {
        sacred: [],
        disputable: [],
        class: []
      };

      (titles || []).forEach(item => {
        if (item.titles && titlesByTier[item.titles.tier]) {
          titlesByTier[item.titles.tier].push({
            ...item.titles,
            user_title_id: item.id,
            earned_at: item.earned_at,
            is_equipped: item.is_equipped,
            tournament_id: item.tournament_id
          });
        }
      });

      res.json({
        success: true,
        data: {
          all: titles || [],
          by_tier: titlesByTier,
          total: titles?.length || 0
        }
      });
    } else {
      // PostgreSQL mode
      const result = await db.query(
        `SELECT ut.id, ut.title_id, ut.earned_at, ut.is_equipped, ut.tournament_id,
                t.name, t.tier, t.description, t.color, t.icon
         FROM user_titles ut
         JOIN titles t ON ut.title_id = t.id
         WHERE ut.user_id = $1
         ORDER BY 
           CASE t.tier 
             WHEN 'sacred' THEN 1
             WHEN 'disputable' THEN 2
             WHEN 'class' THEN 3
             ELSE 4
           END,
           ut.earned_at DESC`,
        [userId]
      );
      
      const titles = result[0] || [];

      // Group titles by tier
      const titlesByTier = {
        sacred: [],
        disputable: [],
        class: []
      };

      titles.forEach(title => {
        if (titlesByTier[title.tier]) {
          titlesByTier[title.tier].push(title);
        }
      });

      res.json({
        success: true,
        data: {
          all: titles,
          by_tier: titlesByTier,
          total: titles.length
        }
      });
    }
  } catch (error) {
    console.error('Get user titles error:', error);
    res.status(500).json({ error: 'Failed to fetch user titles' });
  }
});

// Equip a title
router.post('/:id/titles/equip', authenticateToken, async (req, res) => {
  try {
    const userId = req.params.id;
    const { title_id } = req.body;

    if (db.isSupabase) {
      // Supabase mode
      // Verify the title belongs to the user
      const { data: userTitle, error: verifyError } = await db.supabase
        .from('user_titles')
        .select('id')
        .eq('user_id', userId)
        .eq('title_id', title_id)
        .maybeSingle();

      if (verifyError) {
        console.error('Database error:', verifyError);
        return res.status(500).json({ error: 'Database error' });
      }

      if (!userTitle) {
        return res.status(404).json({ error: 'Title not found for this user' });
      }

      // First, unequip all titles
      const { error: unequipError } = await db.supabase
        .from('user_titles')
        .update({ is_equipped: false })
        .eq('user_id', userId);

      if (unequipError) {
        console.error('Error unequipping titles:', unequipError);
        return res.status(500).json({ error: 'Failed to unequip titles' });
      }

      // Then equip the selected title
      const { error: equipError } = await db.supabase
        .from('user_titles')
        .update({ is_equipped: true })
        .eq('user_id', userId)
        .eq('title_id', title_id);

      if (equipError) {
        console.error('Error equipping title:', equipError);
        return res.status(500).json({ error: 'Failed to equip title' });
      }

      // Get the equipped title details
      const { data: equippedTitle, error: fetchError } = await db.supabase
        .from('user_titles')
        .select(`
          titles:title_id (name, tier, color, icon, description)
        `)
        .eq('user_id', userId)
        .eq('title_id', title_id)
        .eq('is_equipped', true)
        .maybeSingle();

      res.json({
        success: true,
        message: 'Title equipped successfully',
        data: equippedTitle?.titles || null
      });
    } else {
      // PostgreSQL mode
      const titleResult = await db.query(
        `SELECT id FROM user_titles WHERE user_id = $1 AND title_id = $2`,
        [userId, title_id]
      );
      
      const userTitle = titleResult[0] || [];

      if (userTitle.length === 0) {
        return res.status(404).json({ error: 'Title not found for this user' });
      }

      // First, unequip all titles
      await db.query(
        `UPDATE user_titles SET is_equipped = false WHERE user_id = $1`,
        [userId]
      );

      // Then equip the selected title
      await db.query(
        `UPDATE user_titles SET is_equipped = true WHERE user_id = $1 AND title_id = $2`,
        [userId, title_id]
      );

      // Get the equipped title details
      const equippedTitleResult = await db.query(
        `SELECT t.name, t.tier, t.color, t.icon, t.description
         FROM user_titles ut
         JOIN titles t ON ut.title_id = t.id
         WHERE ut.user_id = $1 AND ut.is_equipped = true
         LIMIT 1`,
        [userId]
      );
      
      const equippedTitle = equippedTitleResult[0] || [];

      res.json({
        success: true,
        message: 'Title equipped successfully',
        data: equippedTitle[0] || null
      });
    }
  } catch (error) {
    console.error('Equip title error:', error);
    res.status(500).json({ error: 'Failed to equip title' });
  }
});

// Unequip title
router.post('/:id/titles/unequip', authenticateToken, async (req, res) => {
  try {
    const userId = req.params.id;
    
    if (db.isSupabase) {
      // Supabase mode
      const { error } = await db.supabase
        .from('user_titles')
        .update({ is_equipped: false })
        .eq('user_id', userId);

      if (error) {
        console.error('Database error:', error);
        return res.status(500).json({ error: 'Failed to unequip title' });
      }
    } else {
      // PostgreSQL mode
      await db.query(
        `UPDATE user_titles SET is_equipped = false WHERE user_id = $1`,
        [userId]
      );
    }

    res.json({
      success: true,
      message: 'Title unequipped successfully'
    });
  } catch (error) {
    console.error('Unequip title error:', error);
    res.status(500).json({ error: 'Failed to unequip title' });
  }
});

// Update user profile
router.put('/profile', authenticateToken, async (req, res) => {
  try {
    // Validate input
    const { error, value } = updateProfileSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const user = await User.updateProfile(req.user.id, value);

    res.json({
      success: true,
      message: 'Profile updated successfully',
      data: user
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// Set transaction PIN
router.post('/set-pin', authenticateToken, async (req, res) => {
  try {
    const { error, value } = setPinSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    await User.setTransactionPin(req.user.id, value.pin);

    res.json({
      success: true,
      message: 'Transaction PIN set successfully'
    });
  } catch (error) {
    console.error('Set PIN error:', error);
    res.status(500).json({ error: 'Failed to set transaction PIN' });
  }
});

// Get user's match history
router.get('/:id/match-history', authenticateToken, async (req, res) => {
  try {
    const userId = req.params.id;
    const { page = 1, limit = 10 } = req.query;
    const offset = (page - 1) * limit;

    if (db.isSupabase) {
      // Supabase mode
      const { data: matches, error, count } = await db.supabase
        .from('matches')
        .select(`
          id, game, stake_amount, prize_pool_amount, status, winner_id,
          created_at, completed_at,
          player1:player1_id (username),
          player2:player2_id (username),
          winner:winner_id (username)
        `, { count: 'exact' })
        .or(`player1_id.eq.${userId},player2_id.eq.${userId}`)
        .order('created_at', { ascending: false })
        .range(offset, offset + parseInt(limit) - 1);

      if (error) {
        console.error('Database error:', error);
        return res.status(500).json({ error: 'Failed to fetch match history' });
      }

      res.json({
        success: true,
        data: {
          matches: matches || [],
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total: count || 0
          }
        }
      });
    } else {
      // PostgreSQL mode
      const matchesResult = await db.query(
        `SELECT m.id, m.game, m.stake_amount, m.prize_pool_amount, m.status, m.winner_id,
                m.created_at, m.completed_at,
                p1.username AS player1_username,
                p2.username AS player2_username,
                winner.username AS winner_username
         FROM matches m
         LEFT JOIN users p1 ON m.player1_id = p1.id
         LEFT JOIN users p2 ON m.player2_id = p2.id
         LEFT JOIN users winner ON m.winner_id = winner.id
         WHERE (m.player1_id = $1 OR m.player2_id = $2)
         ORDER BY m.created_at DESC
         LIMIT $3 OFFSET $4`,
        [userId, userId, parseInt(limit), offset]
      );
      
      const matches = matchesResult[0] || [];

      const totalCountResult = await db.query(
        `SELECT COUNT(*) AS total
         FROM matches
         WHERE player1_id = $1 OR player2_id = $2`,
        [userId, userId]
      );
      
      const totalCount = totalCountResult[0] || [];

      res.json({
        success: true,
        data: {
          matches,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total: parseInt(totalCount[0]?.total || 0)
          }
        }
      });
    }
  } catch (error) {
    console.error('Get match history error:', error);
    res.status(500).json({ error: 'Failed to fetch match history' });
  }
});

// Get user's tournament history
router.get('/:id/tournament-history', authenticateToken, async (req, res) => {
  try {
    const userId = req.params.id;
    const { page = 1, limit = 10 } = req.query;
    const offset = (page - 1) * limit;

    if (db.isSupabase) {
      // Supabase mode
      const { data: tournaments, error, count } = await db.supabase
        .from('tournaments')
        .select(`
          id, name, game, entry_fee, prize_pool, status,
          start_date, completed_at, winner_id,
          winner:winner_id (username),
          creator:creator_id (username)
        `, { count: 'exact' })
        .filter('participants.user_id', 'eq', userId)
        .order('created_at', { ascending: false })
        .range(offset, offset + parseInt(limit) - 1);

      if (error) {
        console.error('Database error:', error);
        return res.status(500).json({ error: 'Failed to fetch tournament history' });
      }

      res.json({
        success: true,
        data: {
          tournaments: tournaments || [],
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total: count || 0
          }
        }
      });
    } else {
      // PostgreSQL mode
      const tournamentsResult = await db.query(
        `SELECT t.id, t.name, t.game, t.entry_fee, t.prize_pool, t.status,
                t.start_date, t.completed_at, t.winner_id,
                winner.username AS winner_username,
                creator.username AS creator_username
         FROM tournaments t
         LEFT JOIN users winner ON t.winner_id = winner.id
         LEFT JOIN users creator ON t.creator_id = creator.id
         WHERE EXISTS (
           SELECT 1 FROM tournament_participants tp 
           WHERE tp.tournament_id = t.id AND tp.user_id = $1
         )
         ORDER BY t.created_at DESC
         LIMIT $2 OFFSET $3`,
        [userId, parseInt(limit), offset]
      );
      
      const tournaments = tournamentsResult[0] || [];

      const totalCountResult = await db.query(
        `SELECT COUNT(*) AS total
         FROM tournament_participants tp
         WHERE tp.user_id = $1`,
        [userId]
      );
      
      const totalCount = totalCountResult[0] || [];

      res.json({
        success: true,
        data: {
          tournaments,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total: parseInt(totalCount[0]?.total || 0)
          }
        }
      });
    }
  } catch (error) {
    console.error('Get tournament history error:', error);
    res.status(500).json({ error: 'Failed to fetch tournament history' });
  }
});

// Update last seen
router.post('/update-last-seen', authenticateToken, async (req, res) => {
  try {
    if (db.isSupabase) {
      // Supabase mode
      const { error } = await db.supabase
        .from('users')
        .update({ last_seen: new Date().toISOString() })
        .eq('id', req.user.id);

      if (error) {
        console.error('Database error:', error);
        return res.status(500).json({
          success: false,
          error: 'Failed to update last seen'
        });
      }
    } else {
      // PostgreSQL mode
      await db.query(
        'UPDATE users SET last_seen = NOW() WHERE id = $1',
        [req.user.id]
      );
    }
    
    res.json({
      success: true,
      message: 'Last seen updated'
    });
  } catch (error) {
    console.error('Error updating last seen:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update last seen'
    });
  }
});

module.exports = router;
console.log('🔧 LOADING admin.js - START');

const express = require('express');
const router = express.Router();
console.log('🔧 1. Express loaded');

const { supabaseAdmin, supabase, isSupabase } = require('../config/database');
console.log('🔧 2. Database loaded, isSupabase:', isSupabase);

const bcrypt = require('bcrypt');
console.log('🔧 3. Bcrypt loaded');

const jwt = require('jsonwebtoken');
console.log('🔧 4. JWT loaded');

const { v4: uuidv4 } = require('uuid');
console.log('🔧 5. UUID loaded');

const multer = require('multer');
console.log('🔧 6. Multer loaded');

const emailService = require('../services/emailService');
console.log('🔧 7. Email service loaded');

console.log('🔧 LOADING admin.js - COMPLETE');

// ==================== TEST & DEBUG ROUTES ====================

// Test endpoint - should always work
router.get('/test', (req, res) => {
  console.log('🔧 Admin API test endpoint called');
  res.json({ 
    success: true, 
    message: 'Admin API is working',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// Simple test login (no database required)
router.post('/login-test', (req, res) => {
  try {
    const { username, password } = req.body;
    
    console.log('🔐 TEST Admin login attempt:', { username, password: '***' });
    
    // Hardcoded credentials for testing
    if (username === 'admin' && password === 'admin@2005') {
      const token = jwt.sign(
        { 
          id: 1, 
          username: 'admin', 
          role: 'super_admin',
          type: 'admin'
        },
        process.env.JWT_SECRET || 'fallback_secret',
        { expiresIn: '24h' }
      );
      
      console.log('✅ Test login successful');
      
      return res.json({
        success: true,
        message: 'Login successful (TEST MODE)',
        token,
        admin: {
          id: 1,
          username: 'admin',
          email: 'admin@xperience.com',
          role: 'super_admin'
        }
      });
    }
    
    console.log('❌ Test login failed: Invalid credentials');
    res.status(401).json({ 
      success: false, 
      message: 'Invalid credentials. Use admin/admin@2005 for testing' 
    });
    
  } catch (error) {
    console.error('❌ Login test error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error during test login' 
    });
  }
});

// ==================== MIDDLEWARE ====================

const authenticateAdmin = async (req, res, next) => {
  try {
    console.log('🛡️ Admin auth middleware checking...');
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.log('❌ No Bearer token found or malformed header');
      return res.status(401).json({ 
        success: false, 
        message: 'Admin token required' 
      });
    }

    const token = authHeader.split(' ')[1];
    
    if (!token || token === 'null' || token === 'undefined') {
      console.log('❌ Token is null/undefined');
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid admin token' 
      });
    }
    
    console.log('Token received (first 10 chars):', token.substring(0, 10) + '...');
    
    const jwtSecret = process.env.JWT_SECRET || 'fallback_secret';
    const decoded = jwt.verify(token, jwtSecret);
    console.log('Token decoded:', { 
      id: decoded.id, 
      username: decoded.username,
      role: decoded.role,
      type: decoded.type 
    });
    
    // ✅ FIX: Handle hardcoded admin (id: 999)
    if (decoded.id === 999 && decoded.username === 'admin') {
      console.log('✅ Hardcoded admin detected (id: 999) - granting access');
      req.admin = {
        id: 999,
        username: 'admin',
        email: 'admin@xperience.com',
        role: 'super_admin',
        permissions: ['all'],
        is_active: true
      };
      console.log('✅ Admin authenticated (hardcoded):', req.admin.username);
      return next();
    }
    
    // For normal database admins with UUID
    try {
      // Convert to string for UUID comparison
      const adminId = String(decoded.id);
      
      const { data: adminRows, error: adminError } = await supabase
        .from('admin_users')
        .select('id, username, email, role, permissions, is_active')
        .eq('id', adminId);

      if (adminError) {
        console.error('❌ Admin query error:', adminError);
        return res.status(401).json({ 
          success: false, 
          message: 'Authentication failed' 
        });
      }

      const admin = adminRows && adminRows.length > 0 ? adminRows[0] : null;

      if (!admin || admin.is_active !== true) {
        console.log('❌ Admin not found or inactive');
        return res.status(403).json({ 
          success: false, 
          message: 'Admin access denied' 
        });
      }

      req.admin = admin;
      console.log('✅ Admin authenticated (database):', admin.username);
      next();
      
    } catch (dbError) {
      console.error('❌ Database lookup error:', dbError);
      return res.status(500).json({ 
        success: false, 
        message: 'Database error during authentication' 
      });
    }
    
  } catch (error) {
    console.error('❌ Admin auth error:', error.message);
    
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid or expired token' 
      });
    }
    
    res.status(401).json({ 
      success: false, 
      message: 'Authentication failed' 
    });
  }
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  }
});

// ==================== ADMIN AUTH ====================

router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    console.log('🔐 Admin login attempt for:', username);
    console.log('Password received (first 3 chars):', password ? password.substring(0, 3) + '***' : 'none');
    
    if (!username || !password) {
      return res.status(400).json({ 
        success: false, 
        message: 'Username and password required' 
      });
    }

    // ============ TEMPORARY: HARDCODED FALLBACK ============
    if (username === 'admin' && password === 'admin@2005') {
      console.log('✅ Using hardcoded admin credentials (FALLBACK)');
      
      try {
        const { data: existingAdmins, error: checkError } = await supabase
          .from('admin_users')
          .select('id')
          .eq('username', username);
        
        if (!checkError && (!existingAdmins || existingAdmins.length === 0)) {
          console.log('⚠️ Creating admin user in database...');
          const hashedPassword = await bcrypt.hash(password, 10);
          await supabase
            .from('admin_users')
            .insert({
              username: username,
              password_hash: hashedPassword,
              email: 'admin@xperience.com',
              role: 'super_admin',
              is_active: true
            });
          console.log('✅ Admin user created in database');
        }
      } catch (dbError) {
        console.warn('⚠️ Could not check/create admin in database:', dbError.message);
      }
      
      const token = jwt.sign(
        { 
          id: 999, 
          username: 'admin', 
          role: 'super_admin',
          type: 'admin'
        },
        process.env.JWT_SECRET || 'fallback_secret',
        { expiresIn: '8h' }
      );

      return res.json({
        success: true,
        message: 'Login successful',
        token,
        admin: {
          id: 999,
          username: 'admin',
          email: 'admin@xperience.com',
          role: 'super_admin',
          permissions: []
        }
      });
    }
    // ============ END TEMPORARY FALLBACK ============

    console.log('🔍 Checking database for admin user...');
    const { data: admins, error: adminError } = await supabase
      .from('admin_users')
      .select('*')
      .eq('username', username)
      .eq('is_active', true);

    if (adminError) {
      console.error('❌ Admin query error:', adminError);
      return res.status(500).json({ 
        success: false, 
        message: 'Database error' 
      });
    }

    if (!admins || admins.length === 0) {
      console.log('❌ Admin user not found in database');
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid credentials' 
      });
    }

    const admin = admins[0];
    console.log('✅ Admin found:', admin.username);
    
    let validPassword = false;
    
    if (admin.password_hash && admin.password_hash.startsWith('$2')) {
      validPassword = await bcrypt.compare(password, admin.password_hash);
      console.log('🔐 Bcrypt password check:', validPassword ? '✅ Match' : '❌ No match');
    } 
    else if (admin.password_hash === password) {
      validPassword = true;
      console.log('🔐 Plain password match (DEV MODE)');
    }
    
    if (!validPassword) {
      console.log('❌ Password does not match');
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid credentials' 
      });
    }

    console.log('✅ Password verified successfully');
    
    // Update last login
    await supabase
      .from('admin_users')
      .update({ last_login: new Date().toISOString() })
      .eq('id', admin.id);

    // Create token
    const token = jwt.sign(
      { 
        id: admin.id, 
        username: admin.username, 
        role: admin.role,
        type: 'admin'
      },
      process.env.JWT_SECRET || 'fallback_secret',
      { expiresIn: '8h' }
    );

    // Log activity
    try {
      await supabase
        .from('admin_activity_logs')
        .insert({
          admin_id: admin.id,
          action_type: 'login',
          description: 'Admin logged in',
          ip_address: req.ip || 'unknown'
        });
    } catch (logError) {
      console.warn('⚠️ Could not log admin activity:', logError.message);
    }

    console.log('🎉 Admin login successful for:', admin.username);
    
    // Parse permissions
    let permissions = [];
    try {
      if (admin.permissions) {
        if (typeof admin.permissions === 'string') {
          try {
            permissions = JSON.parse(admin.permissions);
          } catch (jsonError) {
            if (admin.permissions.includes(',')) {
              permissions = admin.permissions.split(',').map(item => item.trim());
            } else {
              permissions = [admin.permissions.trim()];
            }
          }
        } else if (Array.isArray(admin.permissions)) {
          permissions = admin.permissions;
        } else if (admin.permissions && typeof admin.permissions === 'object') {
          permissions = Object.keys(admin.permissions);
        }
      }
    } catch (permError) {
      console.error('❌ Error processing permissions:', permError.message);
      permissions = [];
    }
    
    if (!Array.isArray(permissions)) {
      permissions = [];
    }
    
    res.json({
      success: true,
      message: 'Login successful',
      token,
      admin: {
        id: admin.id,
        username: admin.username,
        email: admin.email,
        role: admin.role,
        permissions: permissions
      }
    });

  } catch (error) {
    console.error('❌ Admin login error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Login failed',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});
// ==================== VERIFY TOKEN ENDPOINT ====================

// GET /api/admin/verify - Verify admin token
router.get('/verify', authenticateAdmin, async (req, res) => {
  try {
    console.log('✅ Admin token verification successful for:', req.admin.username);
    res.json({
      success: true,
      admin: {
        id: req.admin.id,
        username: req.admin.username,
        email: req.admin.email,
        role: req.admin.role,
        permissions: req.admin.permissions || []
      }
    });
  } catch (error) {
    console.error('❌ Admin verification error:', error);
    res.status(401).json({
      success: false,
      message: 'Invalid admin session'
    });
  }
});
// ==================== DASHBOARD STATS ====================

router.get('/dashboard/stats', authenticateAdmin, async (req, res) => {
  try {
    console.log('📊 Fetching dashboard stats for admin:', req.admin.username);
    
    // Get tournament stats
    const { data: tournamentStats, error: tournamentError } = await supabase
      .from('tournaments')
      .select('*');

    if (tournamentError) {
      console.error('Tournament stats error:', tournamentError);
    }

    const tournamentStatsCalc = {
      totalTournaments: tournamentStats?.length || 0,
      upcomingTournaments: tournamentStats?.filter(t => t.status === 'upcoming').length || 0,
      ongoingTournaments: tournamentStats?.filter(t => t.status === 'ongoing').length || 0,
      completedTournaments: tournamentStats?.filter(t => t.status === 'completed').length || 0,
      cancelledTournaments: tournamentStats?.filter(t => t.status === 'cancelled').length || 0,
      totalPrizePool: tournamentStats?.reduce((sum, t) => sum + (t.prize_pool || 0) + (t.custom_prize_pool || 0), 0) || 0,
      monitored_tournaments: tournamentStats?.filter(t => t.admin_monitoring === true).length || 0
    };

    // Get user stats
    const { data: users, error: usersError } = await supabase
      .from('users')
      .select('balance, xp_points');

    // Get withdrawal stats
    const { data: withdrawals, error: withdrawalError } = await supabase
      .from('withdrawal_requests')
      .select('status, amount')
      .eq('status', 'pending');

    // Get transaction stats
    const today = new Date().toISOString().split('T')[0];
    const { data: todayTransactions, error: txError } = await supabase
      .from('transactions')
      .select('amount, type')
      .gte('created_at', `${today}T00:00:00`)
      .lte('created_at', `${today}T23:59:59`);

    // Get fraud stats
    const { data: fraudFlags, error: fraudError } = await supabase
      .from('fraud_flags')
      .select('status')
      .eq('status', 'active');

    // Get match stats
    const { data: ongoingMatches, error: matchError } = await supabase
      .from('matches')
      .select('*')
      .eq('status', 'ongoing');

    // Get group stats
    const { data: groups, error: groupError } = await supabase
      .from('groups')
      .select('id, visibility, created_at');

    const { data: groupMembers, error: memberError } = await supabase
      .from('group_members')
      .select('*')
      .eq('status', 'joined');

    const stats = {
      total_users: users?.length || 0,
      total_balance: users?.reduce((sum, u) => sum + (parseFloat(u.balance) || 0), 0) || 0,
      total_xp: users?.reduce((sum, u) => sum + (parseFloat(u.xp_points) || 0), 0) || 0,
      pending_withdrawals: withdrawals?.length || 0,
      today_transactions: todayTransactions?.length || 0,
      today_deposits: todayTransactions?.filter(tx => tx.type === 'deposit').reduce((sum, tx) => sum + parseFloat(tx.amount), 0) || 0,
      active_fraud_flags: fraudFlags?.length || 0,
      ongoing_matches: ongoingMatches?.length || 0,
      today_groups: groups?.filter(g => g.created_at?.split('T')[0] === today).length || 0,
      total_groups: groups?.length || 0,
      public_groups: groups?.filter(g => g.visibility === 'public').length || 0,
      private_groups: groups?.filter(g => g.visibility === 'private').length || 0,
      total_group_members: groupMembers?.length || 0,
      active_groups: groups?.filter(g => {
        const createdDate = new Date(g.created_at);
        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 7);
        return createdDate >= weekAgo;
      }).length || 0
    };

    const combinedStats = { ...stats, ...tournamentStatsCalc };

    // Get recent withdrawals
    const { data: recentWithdrawals, error: wrError } = await supabase
      .from('withdrawal_requests')
      .select(`
        *,
        users (
          username,
          email
        )
      `)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(10);

    // Get recent users
    const { data: recentUsers, error: ruError } = await supabase
      .from('users')
      .select('id, username, email, balance, xp_points, created_at')
      .order('created_at', { ascending: false })
      .limit(5);

    // Get ongoing matches with player info
    const { data: ongoingMatchesData, error: omError } = await supabase
      .from('matches')
      .select(`
        *,
        player1:player1_id (username),
        player2:player2_id (username),
        winner:winner_id (username)
      `)
      .eq('status', 'ongoing')
      .order('created_at', { ascending: false })
      .limit(5);

    const formattedMatches = ongoingMatchesData?.map(m => ({
      ...m,
      player1_username: m.player1?.username,
      player2_username: m.player2?.username,
      winner_username: m.winner?.username
    })) || [];

    // Get ongoing tournaments
    const { data: ongoingTournaments, error: otError } = await supabase
      .from('tournaments')
      .select(`
        *,
        creator:creator_id (username),
        winner:winner_id (username)
      `)
      .eq('status', 'ongoing')
      .order('start_date', { ascending: true })
      .limit(5);

    const formattedTournaments = ongoingTournaments?.map(t => ({
      ...t,
      creator_username: t.creator?.username,
      winner_username: t.winner?.username
    })) || [];

    // Get recent groups
    const { data: recentGroups, error: rgError } = await supabase
      .from('groups')
      .select(`
        *,
        creator:creator_id (username)
      `)
      .order('created_at', { ascending: false })
      .limit(5);

    const groupsWithCounts = await Promise.all((recentGroups || []).map(async (group) => {
      const { count } = await supabase
        .from('group_members')
        .select('*', { count: 'exact', head: true })
        .eq('group_id', group.id)
        .eq('status', 'joined');
      
      return {
        ...group,
        creator_username: group.creator?.username,
        member_count: count || 0
      };
    }));

    res.json({
      success: true,
      stats: combinedStats,
      recent_withdrawals: recentWithdrawals || [],
      recent_users: recentUsers || [],
      ongoing_matches: formattedMatches,
      ongoing_tournaments: formattedTournaments,
      recent_groups: groupsWithCounts
    });

  } catch (error) {
    console.error('❌ Dashboard stats error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch dashboard stats',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// ==================== WITHDRAWAL MANAGEMENT ====================

router.get('/withdrawals', authenticateAdmin, async (req, res) => {
  try {
    const { status = '', page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    console.log('📋 Fetching withdrawals - Status:', status, 'Page:', page);

    let query = supabase
      .from('withdrawal_requests')
      .select(`
        *,
        users (
          username,
          email,
          wallet_account_number
        )
      `, { count: 'exact' });

    if (status && status.trim() !== '') {
      query = query.eq('status', status);
    }

    const { data: withdrawals, error, count } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    const formattedWithdrawals = (withdrawals || []).map(withdrawal => {
      let accountDetails = {};
      try {
        if (withdrawal.account_details) {
          accountDetails = typeof withdrawal.account_details === 'string' 
            ? JSON.parse(withdrawal.account_details) 
            : withdrawal.account_details;
        }
      } catch (error) {
        console.warn('Could not parse account_details for withdrawal:', withdrawal.id);
      }

      return {
        ...withdrawal,
        username: withdrawal.users?.username,
        email: withdrawal.users?.email,
        wallet_account_number: withdrawal.users?.wallet_account_number,
        account_details: accountDetails,
        users: undefined
      };
    });

    res.json({
      success: true,
      withdrawals: formattedWithdrawals,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limit)
      }
    });

  } catch (error) {
    console.error('❌ Get withdrawals error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch withdrawals',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

router.get('/withdrawals/:id', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    console.log('🔍 Fetching withdrawal details for ID:', id);

    const { data: withdrawals, error } = await supabase
      .from('withdrawal_requests')
      .select(`
        *,
        users (*)
      `)
      .eq('id', id);

    if (error) throw error;

    if (!withdrawals || withdrawals.length === 0) {
      console.log('❌ Withdrawal not found:', id);
      return res.status(404).json({ 
        success: false, 
        message: 'Withdrawal not found' 
      });
    }

    const withdrawal = withdrawals[0];
    
    let accountDetails = {};
    try {
      if (withdrawal.account_details) {
        accountDetails = typeof withdrawal.account_details === 'string' 
          ? JSON.parse(withdrawal.account_details) 
          : withdrawal.account_details;
      }
    } catch (error) {
      console.warn('Could not parse account_details:', error);
    }

    console.log('✅ Withdrawal found:', withdrawal.receipt_number);

    // Get transaction details
    const { data: transactions, error: txError } = await supabase
      .from('transactions')
      .select('*')
      .eq('id', withdrawal.transaction_id);

    // Get approval history
    const { data: approvals, error: appError } = await supabase
      .from('withdrawal_approvals')
      .select(`
        *,
        admin_users (username)
      `)
      .eq('withdrawal_request_id', id)
      .order('created_at', { ascending: false });

    res.json({
      success: true,
      withdrawal: {
        ...withdrawal,
        account_details: accountDetails,
        users: withdrawal.users
      },
      transaction: transactions?.[0] || null,
      approvals: approvals || []
    });

  } catch (error) {
    console.error('❌ Get withdrawal details error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch withdrawal details' 
    });
  }
});

router.post('/withdrawals/:id/action', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { action, notes, proof_document } = req.body;
    const adminId = req.admin.id;

    console.log('⚡ Processing withdrawal action:', { 
      withdrawalId: id, 
      action, 
      adminId 
    });

    if (!['approve', 'reject', 'processing', 'completed'].includes(action)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid action' 
      });
    }

    // Get withdrawal
    const { data: withdrawals, error: wError } = await supabase
      .from('withdrawal_requests')
      .select('*')
      .eq('id', id);

    if (wError) throw wError;

    if (!withdrawals || withdrawals.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'Withdrawal not found' 
      });
    }

    const withdrawal = withdrawals[0];
    const oldStatus = withdrawal.status;
    let newStatus = withdrawal.status;

    switch (action) {
      case 'approve':
        newStatus = 'processing';
        break;
      case 'reject':
        newStatus = 'rejected';
        // Refund money back to user using RPC
        await supabase.rpc('increment_user_balance', {
          user_id: withdrawal.user_id,
          amount: withdrawal.amount
        });
        break;
      case 'processing':
        newStatus = 'processing';
        break;
      case 'completed':
        newStatus = 'completed';
        break;
    }

    // Update withdrawal status
    const { error: updateError } = await supabase
      .from('withdrawal_requests')
      .update({
        status: newStatus,
        processed_by: adminId,
        processed_at: new Date().toISOString()
      })
      .eq('id', id);

    if (updateError) throw updateError;

    // Update transaction status
    const { error: txUpdateError } = await supabase
      .from('transactions')
      .update({ status: newStatus })
      .eq('id', withdrawal.transaction_id);

    if (txUpdateError) throw txUpdateError;

    // Record approval
    const { error: approvalError } = await supabase
      .from('withdrawal_approvals')
      .insert({
        withdrawal_request_id: id,
        admin_id: adminId,
        old_status: oldStatus,
        new_status: newStatus,
        notes: notes || null,
        proof_document: proof_document || null
      });

    if (approvalError) throw approvalError;

    // Log activity
    const { error: logError } = await supabase
      .from('admin_activity_logs')
      .insert({
        admin_id: adminId,
        action_type: 'withdrawal_action',
        description: `${action} withdrawal #${id}`,
        affected_user_id: withdrawal.user_id,
        affected_transaction_id: withdrawal.transaction_id
      });

    if (logError) throw logError;

    console.log('💾 All operations completed successfully');

    res.json({
      success: true,
      message: `Withdrawal ${action}d successfully`,
      new_status: newStatus
    });

  } catch (error) {
    console.error('❌ Withdrawal action error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to process withdrawal' 
    });
  }
});

// ==================== USER MANAGEMENT ====================

router.get('/users', authenticateAdmin, async (req, res) => {
  try {
    const { search, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    console.log('👥 Fetching users - Search:', search, 'Page:', page);

    let query = supabase
      .from('users')
      .select('id, username, email, wallet_account_number, balance, xp_points, rank, created_at', { count: 'exact' });

    if (search) {
      query = query.or(`username.ilike.%${search}%,email.ilike.%${search}%,wallet_account_number.ilike.%${search}%`);
    }

    const { data: users, error, count } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    res.json({
      success: true,
      users: users || [],
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limit)
      }
    });

  } catch (error) {
    console.error('❌ Get users error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch users' 
    });
  }
});

router.get('/users/:id', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    console.log('🔍 Fetching user details for ID:', id);

    const { data: users, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', id);

    if (error) throw error;

    if (!users || users.length === 0) {
      console.log('❌ User not found:', id);
      return res.status(404).json({ 
        success: false, 
        message: 'User not found' 
      });
    }

    // Get user transactions
    const { data: transactions, error: txError } = await supabase
      .from('transactions')
      .select('*')
      .eq('user_id', id)
      .order('created_at', { ascending: false })
      .limit(20);

    // Get user XP transactions
    const { data: xpTransactions, error: xpError } = await supabase
      .from('xp_transactions')
      .select('*')
      .eq('user_id', id)
      .order('created_at', { ascending: false })
      .limit(20);

    // Get withdrawal history
    const { data: withdrawals, error: wError } = await supabase
      .from('withdrawal_requests')
      .select('*')
      .eq('user_id', id)
      .order('created_at', { ascending: false });

    console.log('✅ User details fetched successfully');

    res.json({
      success: true,
      user: users[0],
      transactions: transactions || [],
      xp_transactions: xpTransactions || [],
      withdrawals: withdrawals || []
    });

  } catch (error) {
    console.error('❌ Get user details error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch user details' 
    });
  }
});

router.put('/users/:id', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;
    const adminId = req.admin.id;

    console.log('✏️ Updating user ID:', id, 'Data:', updateData);

    // Get current user data
    const { data: users, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('id', id);

    if (userError) throw userError;

    if (!users || users.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const allowedFields = [
      'username', 'email', 'firstname', 'lastname', 'rank',
      'account_status', 'xp_points', 'is_admin', 'is_banned',
      'enable_2fa', 'login_alerts', 'session_timeout', 'bio',
      'favorite_games', 'balance'
    ];

    const updateObject = {};
    for (const field of allowedFields) {
      if (field in updateData) {
        updateObject[field] = updateData[field];
      }
    }

    if (Object.keys(updateObject).length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No valid fields to update'
      });
    }

    updateObject.updated_at = new Date().toISOString();

    // Update user
    const { error: updateError } = await supabase
      .from('users')
      .update(updateObject)
      .eq('id', id);

    if (updateError) throw updateError;

    // Log admin activity
    await supabase
      .from('admin_activity_logs')
      .insert({
        admin_id: adminId,
        action_type: 'user_update',
        description: 'Updated user profile',
        affected_user_id: id
      });

    // Get updated user
    const { data: updatedUsers } = await supabase
      .from('users')
      .select('*')
      .eq('id', id);

    console.log('✅ User updated successfully');

    res.json({
      success: true,
      message: 'User updated successfully',
      user: updatedUsers?.[0] || null
    });

  } catch (error) {
    console.error('❌ Update user error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update user'
    });
  }
});

router.post('/users/:id/ban', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { isBanned, reason } = req.body;
    const adminId = req.admin.id;

    console.log(`🚫 ${isBanned ? 'Banning' : 'Unbanning'} user ID:`, id, 'Reason:', reason);

    // Check if user exists
    const { data: users, error: userError } = await supabase
      .from('users')
      .select('id, username, is_banned')
      .eq('id', id);

    if (userError) throw userError;

    if (!users || users.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const currentUser = users[0];

    // Update user
    const { error: updateError } = await supabase
      .from('users')
      .update({
        is_banned: isBanned,
        account_status: isBanned ? 'suspended' : 'active',
        updated_at: new Date().toISOString()
      })
      .eq('id', id);

    if (updateError) throw updateError;

    // Log admin activity
    await supabase
      .from('admin_activity_logs')
      .insert({
        admin_id: adminId,
        action_type: 'user_ban',
        description: isBanned ? 'Banned user' : 'Unbanned user',
        affected_user_id: id,
        details: JSON.stringify({ reason, previous_status: currentUser.is_banned ? 'banned' : 'active' })
      });

    console.log('✅ User ban status updated successfully');

    res.json({
      success: true,
      message: `User ${isBanned ? 'banned' : 'unbanned'} successfully`,
      is_banned: isBanned
    });

  } catch (error) {
    console.error('❌ User ban error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update user ban status'
    });
  }
});

router.post('/users/:id/balance', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { amount, reason } = req.body;
    const adminId = req.admin.id;

    console.log('💰 Updating balance for user ID:', id, 'Amount:', amount, 'Reason:', reason);

    if (!amount || isNaN(parseFloat(amount))) {
      return res.status(400).json({
        success: false,
        message: 'Valid amount is required'
      });
    }

    // Get current user balance
    const { data: users, error: userError } = await supabase
      .from('users')
      .select('id, username, balance')
      .eq('id', id);

    if (userError) throw userError;

    if (!users || users.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const currentUser = users[0];
    const newBalance = parseFloat(currentUser.balance) + parseFloat(amount);

    // Update balance using RPC for atomic operation
    await supabase.rpc('increment_user_balance', {
      user_id: id,
      amount: parseFloat(amount)
    });

    // Create transaction record
    const transactionId = uuidv4();
    const { error: txError } = await supabase
      .from('transactions')
      .insert({
        id: transactionId,
        user_id: id,
        type: amount >= 0 ? 'admin_adjustment_add' : 'admin_adjustment_deduct',
        amount: Math.abs(parseFloat(amount)),
        status: 'completed',
        description: reason || 'Admin balance adjustment',
        admin_id: adminId,
        previous_balance: parseFloat(currentUser.balance),
        new_balance: newBalance,
        created_at: new Date().toISOString()
      });

    if (txError) throw txError;

    // Log admin activity
    await supabase
      .from('admin_activity_logs')
      .insert({
        admin_id: adminId,
        action_type: 'balance_adjustment',
        description: 'Adjusted user balance',
        affected_user_id: id,
        details: JSON.stringify({
          amount,
          previous_balance: currentUser.balance,
          new_balance: newBalance,
          reason
        })
      });

    console.log('✅ User balance updated successfully');

    res.json({
      success: true,
      message: 'Balance updated successfully',
      previous_balance: parseFloat(currentUser.balance),
      new_balance: newBalance,
      adjustment: parseFloat(amount)
    });

  } catch (error) {
    console.error('❌ Update balance error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update user balance'
    });
  }
});

router.delete('/users/:id', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const adminId = req.admin.id;

    console.log('🗑️ Deleting user ID:', id);

    // Check if user exists
    const { data: users, error: userError } = await supabase
      .from('users')
      .select('id, username, is_admin')
      .eq('id', id);

    if (userError) throw userError;

    if (!users || users.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const user = users[0];

    // Prevent deleting admin users
    if (user.is_admin) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete admin users'
      });
    }

    // Soft delete - mark as deleted
    const { error: updateError } = await supabase
      .from('users')
      .update({
        account_status: 'deleted',
        is_banned: true,
        updated_at: new Date().toISOString()
      })
      .eq('id', id);

    if (updateError) throw updateError;

    // Log admin activity
    await supabase
      .from('admin_activity_logs')
      .insert({
        admin_id: adminId,
        action_type: 'user_delete',
        description: 'Deleted user account',
        affected_user_id: id
      });

    console.log('✅ User marked as deleted successfully');

    res.json({
      success: true,
      message: 'User deleted successfully'
    });

  } catch (error) {
    console.error('❌ Delete user error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete user'
    });
  }
});

router.get('/users/:id/stats', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    console.log('📊 Fetching stats for user ID:', id);

    const { data: users, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('id', id);

    if (userError) throw userError;

    if (!users || users.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const user = users[0];

    // Get counts
    const { count: transactionCount } = await supabase
      .from('transactions')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', id);

    const { count: withdrawalCount } = await supabase
      .from('withdrawal_requests')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', id);

    const { count: completedMatches } = await supabase
      .from('matches')
      .select('*', { count: 'exact', head: true })
      .or(`player1_id.eq.${id},player2_id.eq.${id}`)
      .eq('status', 'completed');

    const { count: tournamentsParticipated } = await supabase
      .from('tournament_participants')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', id);

    const userStats = {
      ...user,
      total_transactions: transactionCount || 0,
      total_withdrawals: withdrawalCount || 0,
      completed_matches: completedMatches || 0,
      tournaments_participated: tournamentsParticipated || 0
    };

    res.json({
      success: true,
      stats: userStats
    });

  } catch (error) {
    console.error('❌ Get user stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch user stats'
    });
  }
});

// ==================== SYSTEM SETTINGS ====================

router.get('/settings', authenticateAdmin, async (req, res) => {
  try {
    console.log('⚙️ Fetching system settings');
    
    const { data: settings, error } = await supabase
      .from('system_settings')
      .select('*')
      .order('category', { ascending: true })
      .order('setting_key', { ascending: true });

    if (error) throw error;

    res.json({
      success: true,
      settings: settings || []
    });

  } catch (error) {
    console.error('❌ Get settings error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch settings' 
    });
  }
});

router.post('/settings/:key', authenticateAdmin, async (req, res) => {
  try {
    const { key } = req.params;
    const { value } = req.body;
    const adminId = req.admin.id;

    console.log('⚙️ Updating setting:', key, 'Value:', value);

    const { error } = await supabase
      .from('system_settings')
      .upsert({
        setting_key: key,
        setting_value: value,
        updated_by: adminId,
        updated_at: new Date().toISOString()
      }, { onConflict: 'setting_key' });

    if (error) throw error;

    // Log activity
    await supabase
      .from('admin_activity_logs')
      .insert({
        admin_id: adminId,
        action_type: 'settings_update',
        description: `Updated setting: ${key}`
      });

    res.json({
      success: true,
      message: 'Setting updated successfully'
    });

  } catch (error) {
    console.error('❌ Update setting error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to update setting' 
    });
  }
});

// ==================== XP RATES SETTINGS ====================

router.get('/settings/xp-rates', authenticateAdmin, async (req, res) => {
  try {
    console.log('⚙️ Fetching XP rates settings');
    
    const { data: xpRates, error } = await supabase
      .from('xp_rates')
      .select('currency, xp_per_unit, unit_amount, is_active, description')
      .eq('is_active', true)
      .order('currency');

    if (error) throw error;

    const rates = {};
    (xpRates || []).forEach(rate => {
      const xpPerCurrency = rate.xp_per_unit / rate.unit_amount;
      rates[rate.currency] = parseFloat(xpPerCurrency.toFixed(3));
    });

    const defaultRates = {
      'NGN': 0.025,
      'USD': 0,
      'EUR': 0,
      'GBP': 0
    };

    const finalRates = { ...defaultRates, ...rates };

    res.json({
      success: true,
      rates: finalRates
    });

  } catch (error) {
    console.error('❌ Get XP rates error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch XP rates',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

router.post('/settings/xp-rates/:currency', authenticateAdmin, async (req, res) => {
  try {
    const { currency } = req.params;
    const { rate } = req.body;
    const adminId = req.admin.id;

    console.log('⚙️ Updating XP rate for currency:', currency, 'Rate:', rate);

    if (!rate || isNaN(parseFloat(rate))) {
      return res.status(400).json({
        success: false,
        message: 'Valid rate value is required'
      });
    }

    const xpRate = parseFloat(rate);
    const xp_per_unit = 25;
    const unit_amount = 1000 / xpRate;

    const { error: xpError } = await supabase
      .from('xp_rates')
      .upsert({
        currency: currency,
        xp_per_unit: xp_per_unit,
        unit_amount: unit_amount,
        is_active: true,
        description: `${xp_per_unit} XP per ${unit_amount.toFixed(2)} ${currency}`,
        updated_at: new Date().toISOString()
      }, { onConflict: 'currency' });

    if (xpError) throw xpError;

    // Also update in system_settings for backward compatibility
    const settingKey = `xp_rate_${currency}`;
    const { error: sysError } = await supabase
      .from('system_settings')
      .upsert({
        setting_key: settingKey,
        setting_value: rate.toString(),
        category: 'xp_rates',
        updated_by: adminId,
        updated_at: new Date().toISOString()
      }, { onConflict: 'setting_key' });

    if (sysError) throw sysError;

    // Log activity
    await supabase
      .from('admin_activity_logs')
      .insert({
        admin_id: adminId,
        action_type: 'settings_update',
        description: `Updated XP rate for ${currency}`
      });

    res.json({
      success: true,
      message: 'XP rate updated successfully',
      currency,
      rate: xpRate
    });

  } catch (error) {
    console.error('❌ Update XP rate error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to update XP rate' 
    });
  }
});

// ==================== FRAUD MANAGEMENT ====================

router.get('/fraud/flags', authenticateAdmin, async (req, res) => {
  try {
    const { status } = req.query;
    console.log('🚨 Fetching fraud flags - Status:', status);

    let query = supabase
      .from('fraud_flags')
      .select(`
        *,
        users (username, email),
        admin_users:assigned_admin_id (username)
      `);

    if (status) {
      query = query.eq('status', status);
    }

    const { data: flags, error } = await query.order('created_at', { ascending: false });

    if (error) throw error;

    const formattedFlags = (flags || []).map(flag => ({
      ...flag,
      username: flag.users?.username,
      email: flag.users?.email,
      assigned_admin_name: flag.admin_users?.username,
      users: undefined,
      admin_users: undefined
    }));

    res.json({
      success: true,
      flags: formattedFlags
    });

  } catch (error) {
    console.error('❌ Get fraud flags error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch fraud flags' 
    });
  }
});

router.get('/fraud/stats', authenticateAdmin, async (req, res) => {
  try {
    console.log('📊 Admin: Fetching fraud statistics');
    
    // Get fraud flag stats
    const { data: flags, error: flagError } = await supabase
      .from('fraud_flags')
      .select('status');

    if (flagError) throw flagError;

    const flagStats = {
      total_flags: flags?.length || 0,
      pending_flags: flags?.filter(f => f.status === 'pending').length || 0,
      confirmed_flags: flags?.filter(f => f.status === 'confirmed').length || 0,
      false_positive_flags: flags?.filter(f => f.status === 'false_positive').length || 0
    };

    // Get suspicious activities stats
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const { data: activities, error: actError } = await supabase
      .from('suspicious_activities')
      .select('status, severity_level')
      .gte('created_at', thirtyDaysAgo.toISOString());

    if (actError) throw actError;

    const activityStats = {
      total_activities: activities?.length || 0,
      pending_activities: activities?.filter(a => a.status === 'pending').length || 0,
      high_risk_activities: activities?.filter(a => a.severity_level === 'high' || a.severity_level === 'critical').length || 0
    };

    // Get user risk stats
    const { data: users, error: userError } = await supabase
      .from('users')
      .select('risk_score, balance')
      .eq('account_status', 'active')
      .eq('is_banned', false);

    if (userError) throw userError;

    const userStats = {
      total_users: users?.length || 0,
      high_risk_users: users?.filter(u => (u.risk_score || 0) >= 70).length || 0,
      medium_risk_users: users?.filter(u => (u.risk_score || 0) >= 40 && (u.risk_score || 0) < 70).length || 0,
      amount_at_risk: users?.filter(u => (u.risk_score || 0) >= 40).reduce((sum, u) => sum + parseFloat(u.balance || 0), 0) || 0
    };

    // Get recent scans
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    const { count: recentScans, error: scanError } = await supabase
      .from('fraud_detection_logs')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', sevenDaysAgo.toISOString());

    if (scanError) throw scanError;

    // Get weekly activity data for chart
    const { data: weeklyData, error: weeklyError } = await supabase
      .from('suspicious_activities')
      .select('created_at')
      .gte('created_at', sevenDaysAgo.toISOString());

    if (weeklyError) throw weeklyError;

    const weeklyGrouped = {};
    (weeklyData || []).forEach(activity => {
      const date = activity.created_at?.split('T')[0];
      if (date) {
        weeklyGrouped[date] = (weeklyGrouped[date] || 0) + 1;
      }
    });

    const formattedWeeklyData = Object.entries(weeklyGrouped).map(([date, count]) => ({
      date,
      count,
      type: 'activities'
    }));

    res.json({
      success: true,
      stats: {
        ...flagStats,
        ...activityStats,
        ...userStats,
        recent_scans: recentScans || 0,
        amount_at_risk: userStats.amount_at_risk
      },
      weeklyData: formattedWeeklyData,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Get fraud stats error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch fraud statistics',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

router.get('/fraud/suspicious-users', authenticateAdmin, async (req, res) => {
  try {
    const { page = 1, limit = 20, risk_min = 0 } = req.query;
    const offset = (page - 1) * limit;

    console.log('🔍 Admin: Fetching suspicious users - Page:', page, 'Risk min:', risk_min);

    const { data: users, error, count } = await supabase
      .from('users')
      .select(`
        id,
        username,
        email,
        risk_score,
        balance,
        created_at,
        last_login_at,
        last_seen,
        account_status,
        is_banned
      `, { count: 'exact' })
      .gte('risk_score', parseFloat(risk_min))
      .order('risk_score', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    const formattedUsers = await Promise.all((users || []).map(async (user) => {
      const { count: suspiciousCount } = await supabase
        .from('suspicious_activities')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('status', 'pending');

      const { count: flagsCount } = await supabase
        .from('fraud_flags')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .in('status', ['pending', 'confirmed']);

      const { data: lastActivity } = await supabase
        .from('suspicious_activities')
        .select('created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(1);

      const accountAge = Math.floor((new Date() - new Date(user.created_at)) / (1000 * 60 * 60 * 24));

      return {
        id: user.id,
        username: user.username,
        email: user.email,
        risk_score: user.risk_score || 0,
        risk_level: (user.risk_score || 0) >= 70 ? 'high' : (user.risk_score || 0) >= 40 ? 'medium' : 'low',
        balance: user.balance,
        account_age: accountAge,
        suspicious_activities_count: suspiciousCount || 0,
        fraud_flags_count: flagsCount || 0,
        last_activity: lastActivity?.[0]?.created_at || user.last_login_at || user.last_seen || user.created_at,
        account_status: user.account_status,
        is_banned: user.is_banned
      };
    }));

    res.json({
      success: true,
      users: formattedUsers,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limit)
      }
    });

  } catch (error) {
    console.error('❌ Get suspicious users error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch suspicious users',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

router.get('/fraud/patterns', authenticateAdmin, async (req, res) => {
  try {
    console.log('🔄 Admin: Fetching fraud patterns');
    
    const { data: patterns, error } = await supabase
      .from('fraud_patterns')
      .select(`
        *,
        admin_users:created_by (username)
      `)
      .order('created_at', { ascending: false });

    if (error) throw error;

    const formattedPatterns = (patterns || []).map(pattern => ({
      ...pattern,
      created_by_name: pattern.admin_users?.username,
      admin_users: undefined,
      rules: typeof pattern.rules === 'object' ? pattern.rules : 
             (pattern.rules ? JSON.parse(pattern.rules) : {})
    }));

    res.json({
      success: true,
      patterns: formattedPatterns
    });

  } catch (error) {
    console.error('❌ Get fraud patterns error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch fraud patterns',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

router.post('/fraud/scan', authenticateAdmin, async (req, res) => {
  try {
    const { scanType = 'full' } = req.body;
    const adminId = req.admin.id;

    console.log('🔍 Admin: Initiating fraud scan - Type:', scanType, 'Admin:', adminId);

    const scanId = uuidv4();
    const { error: logError } = await supabase
      .from('fraud_detection_logs')
      .insert({
        id: scanId,
        scan_type: scanType,
        status: 'running',
        initiated_by: adminId,
        created_at: new Date().toISOString()
      });

    if (logError) throw logError;

    res.json({
      success: true,
      message: 'Fraud detection scan initiated',
      scanType,
      scanId,
      timestamp: new Date().toISOString()
    });

    // Run scan in background
    setTimeout(async () => {
      try {
        await runFraudScan(scanType, adminId, scanId);
        console.log('✅ Fraud scan completed in background');
      } catch (bgError) {
        console.error('❌ Background scan error:', bgError);
      }
    }, 100);

  } catch (error) {
    console.error('❌ Initiate fraud scan error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to initiate fraud scan' 
    });
  }
});

router.post('/fraud/suspicious-activities/:id/review', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, notes } = req.body;
    const adminId = req.admin.id;

    console.log('📝 Admin: Reviewing suspicious activity:', { id, status, adminId });

    if (!['reviewed', 'dismissed', 'confirmed'].includes(status)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid status. Must be: reviewed, dismissed, or confirmed' 
      });
    }

    const { data: activities, error: actError } = await supabase
      .from('suspicious_activities')
      .select('*')
      .eq('id', id);

    if (actError) throw actError;

    if (!activities || activities.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'Suspicious activity not found' 
      });
    }

    const activity = activities[0];

    const { error: updateError } = await supabase
      .from('suspicious_activities')
      .update({
        status: status,
        reviewed_by: adminId,
        reviewed_at: new Date().toISOString(),
        review_notes: notes || null,
        updated_at: new Date().toISOString()
      })
      .eq('id', id);

    if (updateError) throw updateError;

    if (status === 'confirmed') {
      const { data: userData } = await supabase
        .from('users')
        .select('risk_score')
        .eq('id', activity.user_id);

      if (userData && userData[0]) {
        const newRiskScore = Math.min((userData[0].risk_score || 0) + 20, 100);
        await supabase
          .from('users')
          .update({
            risk_score: newRiskScore,
            last_risk_assessment: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .eq('id', activity.user_id);
      }
    }

    await supabase
      .from('admin_activity_logs')
      .insert({
        admin_id: adminId,
        action_type: 'fraud_review',
        description: `Reviewed suspicious activity #${id} as ${status}`,
        affected_user_id: activity.user_id
      });

    res.json({
      success: true,
      message: 'Activity reviewed successfully',
      status: status
    });

  } catch (error) {
    console.error('❌ Review suspicious activity error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to review activity' 
    });
  }
});

// Helper function for background fraud scan
async function runFraudScan(scanType, adminId, scanId) {
  const startTime = Date.now();
  
  console.log(`🔄 Starting fraud scan ${scanId} - Type: ${scanType}`);

  try {
    let usersChecked = 0;
    let suspiciousFound = 0;
    const triggeredPatterns = [];

    const { data: patterns, error: patternError } = await supabase
      .from('fraud_patterns')
      .select('*')
      .eq('is_active', true);

    if (patternError) throw patternError;

    let userQuery = supabase
      .from('users')
      .select('id, username, email, created_at, last_login_at, balance, risk_score')
      .lt('risk_score', 100);

    if (scanType === 'targeted') {
      userQuery = userQuery.gt('risk_score', 30);
    } else if (scanType === 'recent') {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      userQuery = userQuery.gte('created_at', sevenDaysAgo.toISOString());
    }

    const { data: users, error: userError } = await userQuery;

    if (userError) throw userError;

    for (const user of (users || [])) {
      usersChecked++;
      let userSuspicious = false;

      for (const pattern of (patterns || [])) {
        try {
          const rules = pattern.rules ? 
            (typeof pattern.rules === 'string' ? JSON.parse(pattern.rules) : pattern.rules) : {};
          const isMatch = await checkPattern(user, rules);

          if (isMatch) {
            userSuspicious = true;
            suspiciousFound++;
            triggeredPatterns.push({
              patternId: pattern.id,
              patternName: pattern.pattern_name
            });

            await supabase
              .from('suspicious_activities')
              .insert({
                user_id: user.id,
                activity_type: pattern.pattern_type,
                severity_level: 'medium',
                risk_score: pattern.risk_weight * 10,
                description: pattern.description || `Detected pattern: ${pattern.pattern_name}`,
                metadata: JSON.stringify({
                  pattern: pattern.pattern_name,
                  scan_id: scanId,
                  user_data: {
                    username: user.username,
                    balance: user.balance,
                    account_age_days: Math.floor((new Date() - new Date(user.created_at)) / (1000 * 60 * 60 * 24))
                  }
                })
              });

            const newRiskScore = Math.min((user.risk_score || 0) + (pattern.risk_weight * 5), 100);
            await supabase
              .from('users')
              .update({
                risk_score: newRiskScore,
                last_risk_assessment: new Date().toISOString()
              })
              .eq('id', user.id);
          }
        } catch (patternError) {
          console.warn(`⚠️ Error checking pattern ${pattern.pattern_name}:`, patternError.message);
        }
      }

      if (userSuspicious) {
        console.log(`🔍 User ${user.username} (${user.id}) flagged as suspicious`);
      }
    }

    const scanDuration = Date.now() - startTime;

    await supabase
      .from('fraud_detection_logs')
      .update({
        triggered_patterns: JSON.stringify(triggeredPatterns),
        users_checked: usersChecked,
        suspicious_found: suspiciousFound,
        scan_duration_ms: scanDuration,
        status: 'completed'
      })
      .eq('id', scanId);

    console.log(`✅ Fraud scan completed: ${usersChecked} users checked, ${suspiciousFound} suspicious activities found`);

  } catch (error) {
    console.error('❌ Fraud scan error:', error);
    
    try {
      await supabase
        .from('fraud_detection_logs')
        .update({ status: 'failed' })
        .eq('id', scanId);
    } catch (updateError) {
      console.error('Failed to update scan log:', updateError);
    }
  }
}

async function checkPattern(user, rules) {
  if (!rules || typeof rules !== 'object') {
    return false;
  }

  try {
    if (rules.type === 'multiple_accounts') {
      const { count, error } = await supabase
        .from('users')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', new Date(Date.now() - (rules.timeframe || 24) * 60 * 60 * 1000).toISOString());

      if (error) throw error;
      return (count || 0) > (rules.threshold || 3);
    }

    if (rules.type === 'transaction_anomaly') {
      const { data: transactions, error } = await supabase
        .from('transactions')
        .select('amount')
        .eq('user_id', user.id)
        .eq('status', 'completed')
        .gte('created_at', new Date(Date.now() - (rules.timeframe || 24) * 60 * 60 * 1000).toISOString());

      if (error) throw error;

      const txCount = transactions?.length || 0;
      const totalAmount = transactions?.reduce((sum, tx) => sum + Math.abs(parseFloat(tx.amount)), 0) || 0;

      return txCount > (rules.maxTransactions || 10) || totalAmount > (rules.maxAmount || 100000);
    }

    if (rules.type === 'login_anomaly') {
      const { data: logins, error } = await supabase
        .from('user_logins')
        .select('ip_address')
        .eq('user_id', user.id)
        .gte('login_time', new Date(Date.now() - (rules.timeframe || 24) * 60 * 60 * 1000).toISOString());

      if (error) throw error;

      const uniqueIPs = new Set(logins?.map(l => l.ip_address) || []).size;
      return uniqueIPs > (rules.maxUniqueIPs || 5);
    }

    if (rules.type === 'new_account_high_activity') {
      const accountAgeHours = Math.floor((new Date() - new Date(user.created_at)) / (1000 * 60 * 60));
      
      if (accountAgeHours < (rules.maxAgeHours || 24)) {
        const { count, error } = await supabase
          .from('matches')
          .select('*', { count: 'exact', head: true })
          .or(`player1_id.eq.${user.id},player2_id.eq.${user.id}`)
          .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

        if (error) throw error;
        return (count || 0) > (rules.minActivities || 10);
      }
    }

    return false;

  } catch (error) {
    console.error('Pattern check error:', error);
    return false;
  }
}

// ==================== TRANSACTIONS MANAGEMENT ====================

router.get('/transactions', authenticateAdmin, async (req, res) => {
  try {
    const { 
      type, 
      status, 
      page = 1, 
      limit = 20,
      search 
    } = req.query;
    
    const offset = (page - 1) * limit;
    
    console.log('💰 Admin: Fetching transactions - Type:', type, 'Status:', status, 'Page:', page, 'Search:', search);

    let query = supabase
      .from('transactions')
      .select(`
        *,
        users (username, email, wallet_account_number)
      `, { count: 'exact' });

    if (type && type !== '') {
      query = query.eq('type', type);
    }
    
    if (status && status !== '') {
      query = query.eq('status', status);
    }
    
    if (search && search.trim() !== '') {
      query = query.or(`reference.ilike.%${search}%,users.username.ilike.%${search}%,users.email.ilike.%${search}%,users.wallet_account_number.ilike.%${search}%`);
    }

    const { data: transactions, error, count } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    const formattedTransactions = (transactions || []).map(tx => ({
      ...tx,
      username: tx.users?.username,
      email: tx.users?.email,
      wallet_account_number: tx.users?.wallet_account_number,
      users: undefined
    }));

    try {
      await supabase
        .from('admin_activity_logs')
        .insert({
          admin_id: req.admin.id,
          action_type: 'view',
          description: 'Viewed transactions list'
        });
    } catch (logError) {
      console.warn('⚠️ Could not log activity:', logError.message);
    }

    console.log('✅ Found', formattedTransactions.length, 'transactions');

    res.json({
      success: true,
      transactions: formattedTransactions,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limit)
      }
    });

  } catch (error) {
    console.error('❌ Get transactions error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch transactions',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

router.get('/transactions/stats', authenticateAdmin, async (req, res) => {
  try {
    console.log('📊 Admin: Fetching transaction statistics');
    
    const { data: allTransactions, error } = await supabase
      .from('transactions')
      .select('status, amount, type, created_at');

    if (error) throw error;

    const today = new Date().toISOString().split('T')[0];
    
    const stats = {
      total: allTransactions?.length || 0,
      totalAmount: allTransactions?.filter(tx => tx.status === 'completed' && tx.amount > 0)
        .reduce((sum, tx) => sum + parseFloat(tx.amount), 0) || 0,
      pending: allTransactions?.filter(tx => tx.status === 'pending').length || 0,
      completed: allTransactions?.filter(tx => tx.status === 'completed').length || 0,
      failed: allTransactions?.filter(tx => tx.status === 'failed').length || 0,
      todayCount: allTransactions?.filter(tx => tx.created_at?.split('T')[0] === today).length || 0,
      todayAmount: allTransactions?.filter(tx => tx.created_at?.split('T')[0] === today && tx.amount > 0)
        .reduce((sum, tx) => sum + parseFloat(tx.amount), 0) || 0
    };

    console.log('✅ Transaction stats fetched');

    res.json({
      success: true,
      stats
    });

  } catch (error) {
    console.error('❌ Get transaction stats error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch transaction statistics'
    });
  }
});

router.get('/transactions/:id', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    console.log('🔍 Admin: Fetching transaction details for ID:', id);

    const { data: transactions, error } = await supabase
      .from('transactions')
      .select(`
        *,
        users (username, email, wallet_account_number)
      `)
      .eq('id', id);

    if (error) throw error;

    if (!transactions || transactions.length === 0) {
      console.log('❌ Transaction not found:', id);
      return res.status(404).json({ 
        success: false, 
        message: 'Transaction not found' 
      });
    }

    const transaction = {
      ...transactions[0],
      username: transactions[0].users?.username,
      email: transactions[0].users?.email,
      wallet_account_number: transactions[0].users?.wallet_account_number,
      users: undefined
    };

    let withdrawalRequest = null;
    if (transaction.type === 'withdrawal') {
      const { data: withdrawals, error: wError } = await supabase
        .from('withdrawal_requests')
        .select('*')
        .eq('transaction_id', id);

      if (!wError && withdrawals && withdrawals.length > 0) {
        withdrawalRequest = withdrawals[0];
      }
    }

    console.log('✅ Transaction details fetched:', transaction.reference);

    res.json({
      success: true,
      transaction: transaction,
      withdrawalRequest: withdrawalRequest
    });

  } catch (error) {
    console.error('❌ Get transaction details error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch transaction details' 
    });
  }
});

router.put('/transactions/:id/status', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, notes } = req.body;
    const adminId = req.admin.id;

    console.log('⚡ Admin: Updating transaction status:', { 
      transactionId: id, 
      newStatus: status,
      adminId 
    });

    if (!['pending', 'completed', 'failed', 'pending_approval', 'approved'].includes(status)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid status' 
      });
    }

    const { data: transactions, error: txError } = await supabase
      .from('transactions')
      .select('*')
      .eq('id', id);

    if (txError) throw txError;

    if (!transactions || transactions.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'Transaction not found' 
      });
    }

    const transaction = transactions[0];
    const oldStatus = transaction.status;

    const updateData = {
      status: status,
      updated_at: new Date().toISOString()
    };

    if (status === 'completed' && oldStatus !== 'completed') {
      updateData.completed_at = new Date().toISOString();
    }

    const { error: updateError } = await supabase
      .from('transactions')
      .update(updateData)
      .eq('id', id);

    if (updateError) throw updateError;

    if (transaction.type === 'withdrawal') {
      await supabase
        .from('withdrawal_requests')
        .update({
          status: status === 'completed' ? 'processing' : status,
          processed_by: adminId,
          processed_at: new Date().toISOString()
        })
        .eq('transaction_id', id);
    }

    if (status === 'completed' && oldStatus !== 'completed') {
      if (transaction.type === 'deposit' && transaction.amount > 0) {
        await supabase.rpc('increment_user_balance', {
          user_id: transaction.user_id,
          amount: transaction.amount
        });
        console.log(`✅ Added ${transaction.amount} to user ${transaction.user_id} balance`);
      }
    }
    
    if (transaction.type === 'withdrawal' && (status === 'failed' || status === 'rejected') && oldStatus === 'pending_approval') {
      await supabase.rpc('increment_user_balance', {
        user_id: transaction.user_id,
        amount: Math.abs(transaction.amount)
      });
      console.log(`✅ Refunded ${Math.abs(transaction.amount)} to user ${transaction.user_id} for failed withdrawal`);
    }

    await supabase
      .from('admin_activity_logs')
      .insert({
        admin_id: adminId,
        action_type: 'transaction_status',
        description: `Updated transaction #${id} from ${oldStatus} to ${status}`,
        affected_user_id: transaction.user_id,
        affected_transaction_id: id
      });

    console.log('💾 Transaction status updated successfully');

    res.json({
      success: true,
      message: 'Transaction status updated successfully',
      new_status: status
    });

  } catch (error) {
    console.error('❌ Update transaction status error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to update transaction status',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

router.post('/transactions/:id/refund', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const adminId = req.admin.id;

    console.log('💸 Admin: Processing refund for transaction ID:', id);

    const { data: transactions, error: txError } = await supabase
      .from('transactions')
      .select('*')
      .eq('id', id)
      .eq('type', 'deposit')
      .eq('status', 'completed');

    if (txError) throw txError;

    if (!transactions || transactions.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'Completed deposit transaction not found' 
      });
    }

    const transaction = transactions[0];
    const refundReference = `REFUND-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const refundId = uuidv4();

    const { error: refundError } = await supabase
      .from('transactions')
      .insert({
        id: refundId,
        user_id: transaction.user_id,
        amount: -Math.abs(transaction.amount),
        currency: transaction.currency,
        type: 'refund',
        status: 'completed',
        reference: refundReference,
        description: reason || 'Admin refund for deposit',
        external_reference: transaction.reference,
        created_at: new Date().toISOString()
      });

    if (refundError) throw refundError;

    await supabase.rpc('increment_user_balance', {
      user_id: transaction.user_id,
      amount: -Math.abs(transaction.amount)
    });

    await supabase
      .from('admin_activity_logs')
      .insert({
        admin_id: adminId,
        action_type: 'transaction_refund',
        description: `Refunded transaction #${id} - ${transaction.amount} ${transaction.currency}`,
        affected_user_id: transaction.user_id,
        affected_transaction_id: id
      });

    console.log('✅ Refund processed successfully');

    res.json({
      success: true,
      message: 'Refund processed successfully',
      refund_id: refundId,
      refund_reference: refundReference,
      amount: Math.abs(transaction.amount)
    });

  } catch (error) {
    console.error('❌ Process refund error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to process refund' 
    });
  }
});

// ==================== MATCHES MANAGEMENT ====================

router.get('/matches', authenticateAdmin, async (req, res) => {
  try {
    const { 
      status, 
      game_type, 
      page = 1, 
      limit = 20,
      search 
    } = req.query;
    
    const offset = (page - 1) * limit;
    
    console.log('🎮 Admin: Fetching matches - Status:', status, 'Game Type:', game_type, 'Page:', page);

    let query = supabase
      .from('matches')
      .select(`
        *,
        player1:player1_id (username),
        player2:player2_id (username),
        winner:winner_id (username)
      `, { count: 'exact' });

    if (status && status !== '') {
      query = query.eq('status', status);
    }
    
    if (game_type && game_type !== '') {
      query = query.eq('game_type', game_type);
    }
    
    if (search && search.trim() !== '') {
      query = query.or(`id::text.ilike.%${search}%,game.ilike.%${search}%,player1.username.ilike.%${search}%,player2.username.ilike.%${search}%`);
    }

    const { data: matches, error, count } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    const formattedMatches = (matches || []).map(m => ({
      ...m,
      player1_username: m.player1?.username,
      player2_username: m.player2?.username,
      winner_username: m.winner?.username,
      player1: undefined,
      player2: undefined,
      winner: undefined
    }));

    try {
      await supabase
        .from('admin_activity_logs')
        .insert({
          admin_id: req.admin.id,
          action_type: 'view',
          description: 'Viewed matches list'
        });
    } catch (logError) {
      console.warn('⚠️ Could not log activity:', logError.message);
    }

    console.log('✅ Found', formattedMatches.length, 'matches');

    res.json({
      success: true,
      matches: formattedMatches,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limit)
      }
    });

  } catch (error) {
    console.error('❌ Get matches error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch matches',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

router.get('/matches/stats', authenticateAdmin, async (req, res) => {
  try {
    console.log('📊 Admin: Fetching match statistics');
    
    const { data: matches, error } = await supabase
      .from('matches')
      .select('status, stake_amount, admin_monitoring, prize_pool_amount, custom_prize_pool');

    if (error) throw error;

    const stats = {
      total: matches?.length || 0,
      pending: matches?.filter(m => m.status === 'pending').length || 0,
      ongoing: matches?.filter(m => m.status === 'ongoing').length || 0,
      completed: matches?.filter(m => m.status === 'completed').length || 0,
      totalStake: matches?.reduce((sum, m) => sum + (parseFloat(m.stake_amount) || 0), 0) || 0,
      adminMonitored: matches?.filter(m => m.admin_monitoring === true).length || 0,
      totalPrize: matches?.reduce((sum, m) => sum + (parseFloat(m.prize_pool_amount || 0) + parseFloat(m.custom_prize_pool || 0)), 0) || 0
    };

    console.log('✅ Match stats fetched');

    res.json({
      success: true,
      stats
    });

  } catch (error) {
    console.error('❌ Get match stats error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch match statistics'
    });
  }
});

router.get('/matches/:id', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    console.log('🔍 Admin: Fetching match details for ID:', id);

    const { data: matches, error } = await supabase
      .from('matches')
      .select(`
        *,
        player1:player1_id (username, email),
        player2:player2_id (username, email),
        winner:winner_id (username)
      `)
      .eq('id', id);

    if (error) throw error;

    if (!matches || matches.length === 0) {
      console.log('❌ Match not found:', id);
      return res.status(404).json({ 
        success: false, 
        message: 'Match not found' 
      });
    }

    const match = {
      ...matches[0],
      player1_username: matches[0].player1?.username,
      player1_email: matches[0].player1?.email,
      player2_username: matches[0].player2?.username,
      player2_email: matches[0].player2?.email,
      winner_username: matches[0].winner?.username,
      player1: undefined,
      player2: undefined,
      winner: undefined
    };

    const { data: disputes, error: dispError } = await supabase
      .from('match_disputes')
      .select('*')
      .eq('match_id', id)
      .order('created_at', { ascending: false });

    console.log('✅ Match details fetched:', match.id);

    res.json({
      success: true,
      match: match,
      disputes: disputes || []
    });

  } catch (error) {
    console.error('❌ Get match details error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch match details' 
    });
  }
});

router.post('/matches/:id/cancel', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const adminId = req.admin.id;

    console.log('🗑️ Admin: Cancelling match:', { 
      matchId: id, 
      reason,
      adminId 
    });

    const { data: matches, error: mError } = await supabase
      .from('matches')
      .select('*')
      .eq('id', id)
      .in('status', ['pending', 'ongoing']);

    if (mError) throw mError;

    if (!matches || matches.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'Match not found or cannot be cancelled' 
      });
    }

    const match = matches[0];

    const { error: updateError } = await supabase
      .from('matches')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString()
      })
      .eq('id', id);

    if (updateError) throw updateError;

    if (match.stake_amount > 0) {
      await supabase.rpc('increment_user_balance', {
        user_id: match.player1_id,
        amount: match.stake_amount
      });
      
      if (match.player2_id) {
        await supabase.rpc('increment_user_balance', {
          user_id: match.player2_id,
          amount: match.stake_amount
        });
      }
    }

    if (match.admin_monitoring === true) {
      await supabase
        .from('admin_monitoring_logs')
        .insert({
          tournament_id: null,
          match_id: id,
          admin_id: adminId,
          action_type: 'overrode_result',
          details: JSON.stringify({
            reason: reason,
            action: 'cancelled_by_admin',
            stake_amount: match.stake_amount,
            refunded_to_players: [match.player1_id, match.player2_id].filter(Boolean)
          }),
          ip_address: req.ip || 'unknown'
        });
    }

    await supabase
      .from('admin_activity_logs')
      .insert({
        admin_id: adminId,
        action_type: 'match_cancellation',
        description: `Cancelled match #${id}`,
        details: JSON.stringify({ 
          reason, 
          stake_amount: match.stake_amount,
          admin_monitoring: match.admin_monitoring,
          final_decision: true
        })
      });

    console.log('✅ Match cancelled successfully');

    res.json({
      success: true,
      message: 'Match cancelled successfully',
      admin_monitoring: match.admin_monitoring === true,
      final_decision: true
    });

  } catch (error) {
    console.error('❌ Cancel match error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to cancel match',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

router.post('/matches/:id/resolve', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { winnerId, adminNotes } = req.body;
    const adminId = req.admin.id;

    console.log('⚡ Admin: Resolving match dispute:', { 
      matchId: id, 
      winnerId,
      adminId 
    });

    if (!winnerId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Winner ID is required' 
      });
    }

    const { data: matches, error: mError } = await supabase
      .from('matches')
      .select('*')
      .eq('id', id)
      .eq('status', 'ongoing');

    if (mError) throw mError;

    if (!matches || matches.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'Match not found or not in ongoing status' 
      });
    }

    const match = matches[0];

    const { error: updateError } = await supabase
      .from('matches')
      .update({
        status: 'completed',
        winner_id: winnerId,
        completed_at: new Date().toISOString()
      })
      .eq('id', id);

    if (updateError) throw updateError;

    const prizeAmount = match.prize_pool_amount || match.custom_prize_pool || 0;
    if (prizeAmount > 0) {
      await supabase.rpc('increment_user_balance', {
        user_id: winnerId,
        amount: prizeAmount
      });
      
      const reference = `MATCH_PRIZE_${id}_${Date.now()}`;
      await supabase
        .from('transactions')
        .insert({
          user_id: winnerId,
          type: 'match_prize',
          amount: prizeAmount,
          status: 'completed',
          description: `Prize for winning match #${id}`,
          reference: reference,
          currency: 'NGN'
        });
      console.log(`✅ Created transaction with reference: ${reference}`);
    }

    if (match.admin_monitoring === true) {
      await supabase
        .from('admin_monitoring_logs')
        .insert({
          tournament_id: null,
          match_id: id,
          admin_id: adminId,
          action_type: 'resolved_dispute',
          details: JSON.stringify({
            winner_id: winnerId,
            admin_notes: adminNotes,
            stake_amount: match.stake_amount,
            prize_amount: prizeAmount
          }),
          ip_address: req.ip || 'unknown'
        });
      console.log('📝 Admin monitoring log created');
    }

    await supabase
      .from('admin_activity_logs')
      .insert({
        admin_id: adminId,
        action_type: 'match_resolution',
        description: `Resolved match #${id} - Winner: ${winnerId}`,
        affected_user_id: winnerId,
        details: JSON.stringify({ 
          adminNotes, 
          prizeAmount,
          admin_monitoring: match.admin_monitoring,
          final_decision: true
        })
      });

    console.log('✅ Match resolved successfully');

    res.json({
      success: true,
      message: 'Match resolved successfully',
      winner_id: winnerId,
      admin_monitoring: match.admin_monitoring === true,
      final_decision: true
    });

  } catch (error) {
    console.error('❌ Resolve match error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to resolve match',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// ==================== MATCH AUDIT LOGS ====================

router.get('/matches/:id/audit-logs', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    console.log('📝 Admin: Fetching audit logs for match ID:', id);

    const { data: matches, error: mError } = await supabase
      .from('matches')
      .select('id')
      .eq('id', id);

    if (mError) throw mError;

    if (!matches || matches.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'Match not found' 
      });
    }

    let monitoringLogs = [];
    const { data: logs, error: logError } = await supabase
      .from('admin_monitoring_logs')
      .select(`
        *,
        admin_users (username)
      `)
      .eq('match_id', id)
      .order('created_at', { ascending: false })
      .limit(50);

    if (!logError && logs) {
      monitoringLogs = logs.map(log => ({
        ...log,
        admin_username: log.admin_users?.username,
        log_source: 'monitoring'
      }));
    }

    let activityLogs = [];
    const { data: activities, error: actError } = await supabase
      .from('admin_activity_logs')
      .select(`
        *,
        admin_users (username)
      `)
      .or(`description.ilike.%match #${id}%,description.ilike.%Match #${id}%`)
      .order('created_at', { ascending: false })
      .limit(50);

    if (!actError && activities) {
      activityLogs = activities.map(act => ({
        ...act,
        admin_username: act.admin_users?.username,
        log_source: 'activity'
      }));
    }

    let disputeLogs = [];
    const { data: disputes, error: dispError } = await supabase
      .from('match_disputes')
      .select('*')
      .eq('match_id', id)
      .order('created_at', { ascending: false })
      .limit(20);

    if (!dispError && disputes) {
      disputeLogs = disputes.map(dispute => ({
        ...dispute,
        log_source: 'dispute',
        action_type: 'match_dispute',
        details: JSON.stringify(dispute)
      }));
    }

    let transactionLogs = [];
    const { data: transactions, error: txError } = await supabase
      .from('transactions')
      .select('*')
      .or(`description.ilike.%match #${id}%,reference.ilike.%MATCH_${id}_%`)
      .order('created_at', { ascending: false })
      .limit(20);

    if (!txError && transactions) {
      transactionLogs = transactions.map(tx => ({
        ...tx,
        log_source: 'transaction',
        action_type: 'match_transaction',
        details: `Transaction: ${tx.description}`
      }));
    }

    const allLogs = [
      ...monitoringLogs,
      ...activityLogs,
      ...disputeLogs,
      ...transactionLogs
    ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    console.log('✅ Found', allLogs.length, 'audit logs for match', id);

    res.json({
      success: true,
      logs: allLogs,
      match_id: id
    });

  } catch (error) {
    console.error('❌ Get audit logs error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch audit logs',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// ==================== TOURNAMENTS MANAGEMENT ====================

router.get('/tournaments', authenticateAdmin, async (req, res) => {
  try {
    const { 
      status, 
      type, 
      monitoring,
      sort = 'newest',
      page = 1, 
      limit = 20,
      search 
    } = req.query;
    
    const offset = (page - 1) * limit;
    
    console.log('🎯 Admin: Fetching tournaments - Status:', status, 'Type:', type, 'Monitoring:', monitoring, 'Sort:', sort, 'Page:', page);

    let query = supabase
      .from('tournaments')
      .select(`
        *,
        creator:creator_id (username)
      `, { count: 'exact' });

    if (status && status !== '') {
      query = query.eq('status', status);
    }
    
    if (type && type !== '') {
      query = query.eq('type', type);
    }
    
    if (monitoring === 'monitored') {
      query = query.eq('admin_monitoring', true);
    } else if (monitoring === 'not-monitored') {
      query = query.eq('admin_monitoring', false);
    }
    
    if (search && search.trim() !== '') {
      query = query.or(`name.ilike.%${search}%,game.ilike.%${search}%,creator.username.ilike.%${search}%`);
    }

    switch(sort) {
      case 'oldest':
        query = query.order('created_at', { ascending: true });
        break;
      case 'prize_high':
        query = query.order('prize_pool', { ascending: false });
        break;
      case 'prize_low':
        query = query.order('prize_pool', { ascending: true });
        break;
      case 'newest':
      default:
        query = query.order('created_at', { ascending: false });
    }

    const { data: tournaments, error, count } = await query
      .range(offset, offset + limit - 1);

    if (error) throw error;

    const tournamentsWithStats = await Promise.all((tournaments || []).map(async (tournament) => {
      const { count: participantCount } = await supabase
        .from('tournament_participants')
        .select('*', { count: 'exact', head: true })
        .eq('tournament_id', tournament.id)
        .eq('status', 'joined');

      const { count: squadCount } = await supabase
        .from('tournament_participants')
        .select('*', { count: 'exact', head: true })
        .eq('tournament_id', tournament.id)
        .eq('type', 'squad')
        .eq('status', 'joined');

      const { count: logCount } = await supabase
        .from('admin_monitoring_logs')
        .select('*', { count: 'exact', head: true })
        .eq('tournament_id', tournament.id);

      return {
        ...tournament,
        creator_name: tournament.creator?.username,
        current_participants: participantCount || 0,
        current_squads: squadCount || 0,
        log_count: logCount || 0,
        entry_fee: tournament.xp_entry_fee
      };
    }));

    try {
      await supabase
        .from('admin_activity_logs')
        .insert({
          admin_id: req.admin.id,
          action_type: 'view',
          description: 'Viewed tournaments list'
        });
    } catch (logError) {
      console.warn('⚠️ Could not log activity:', logError.message);
    }

    console.log('✅ Found', tournamentsWithStats.length, 'tournaments');

    res.json({
      success: true,
      tournaments: tournamentsWithStats,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limit)
      }
    });

  } catch (error) {
    console.error('❌ Get tournaments error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch tournaments',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

router.get('/tournaments/stats', authenticateAdmin, async (req, res) => {
  try {
    console.log('📊 Admin: Fetching tournament statistics');
    
    const { data: tournaments, error } = await supabase
      .from('tournaments')
      .select('status, prize_pool, custom_prize_pool');

    if (error) throw error;

    const stats = {
      totalTournaments: tournaments?.length || 0,
      upcomingTournaments: tournaments?.filter(t => t.status === 'upcoming').length || 0,
      ongoingTournaments: tournaments?.filter(t => t.status === 'ongoing').length || 0,
      completedTournaments: tournaments?.filter(t => t.status === 'completed').length || 0,
      cancelledTournaments: tournaments?.filter(t => t.status === 'cancelled').length || 0,
      totalPrizePool: tournaments?.reduce((sum, t) => sum + (parseFloat(t.prize_pool || 0) + parseFloat(t.custom_prize_pool || 0)), 0) || 0
    };

    console.log('✅ Tournament stats fetched');

    res.json({
      success: true,
      stats
    });

  } catch (error) {
    console.error('❌ Get tournament stats error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch tournament statistics'
    });
  }
});

router.get('/tournaments/:id/participants', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    console.log('👥 Admin: Fetching participants for tournament:', id);

    const { data: participants, error } = await supabase
      .from('tournament_participants')
      .select(`
        *,
        users (username, email, rank, profile_pic),
        groups:group_id (name)
      `)
      .eq('tournament_id', id)
      .eq('status', 'joined')
      .order('created_at', { ascending: true });

    if (error) throw error;

    const formattedParticipants = (participants || []).map(p => ({
      ...p,
      username: p.users?.username,
      email: p.users?.email,
      rank: p.users?.rank,
      profile_pic: p.users?.profile_pic,
      group_name: p.groups?.name,
      users: undefined,
      groups: undefined
    }));

    console.log('✅ Found', formattedParticipants.length, 'participants');

    res.json({
      success: true,
      participants: formattedParticipants,
      tournament_id: id
    });

  } catch (error) {
    console.error('❌ Get participants error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch participants' 
    });
  }
});

router.post('/tournaments/:id/cancel', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const adminId = req.admin.id;

    console.log('🚫 Admin: Cancelling tournament:', { 
      tournamentId: id, 
      reason,
      adminId 
    });

    const { data: tournaments, error: tError } = await supabase
      .from('tournaments')
      .select('*')
      .eq('id', id)
      .in('status', ['upcoming', 'ongoing']);

    if (tError) throw tError;

    if (!tournaments || tournaments.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'Tournament not found or cannot be cancelled' 
      });
    }

    const tournament = tournaments[0];

    const { error: updateError } = await supabase
      .from('tournaments')
      .update({
        status: 'cancelled',
        completed_at: new Date().toISOString()
      })
      .eq('id', id);

    if (updateError) throw updateError;

    if (tournament.xp_entry_fee > 0) {
      const { data: participants, error: partError } = await supabase
        .from('tournament_participants')
        .select('user_id')
        .eq('tournament_id', id)
        .eq('status', 'joined');

      if (!partError && participants) {
        for (const participant of participants) {
          await supabase.rpc('increment_user_xp', {
            user_id: participant.user_id,
            amount: tournament.xp_entry_fee
          });

          await supabase
            .from('xp_transactions')
            .insert({
              user_id: participant.user_id,
              tournament_id: id,
              amount: tournament.xp_entry_fee,
              type: 'refund',
              description: `XP refund for cancelled tournament: ${tournament.name}`,
              created_at: new Date().toISOString()
            });
        }
        console.log(`✅ Refunded XP to ${participants.length} participants`);
      }
    }

    const { data: participants } = await supabase
      .from('tournament_participants')
      .select('user_id')
      .eq('tournament_id', id)
      .eq('status', 'joined');

    if (participants) {
      for (const participant of participants) {
        await supabase
          .from('notifications')
          .insert({
            user_id: participant.user_id,
            message: `Tournament "${tournament.name}" has been cancelled by admin. ${tournament.xp_entry_fee > 0 ? 'Your entry fee has been refunded.' : ''}`,
            type: 'system',
            status: 'unread',
            tournament_id: id,
            created_at: new Date().toISOString()
          });
      }
    }

    await supabase
      .from('admin_activity_logs')
      .insert({
        admin_id: adminId,
        action_type: 'tournament_cancellation',
        description: `Cancelled tournament #${id}`,
        details: JSON.stringify({
          reason,
          tournament_name: tournament.name,
          entry_fee: tournament.xp_entry_fee,
          participants_notified: participants?.length || 0
        })
      });

    console.log('✅ Tournament cancelled successfully');

    res.json({
      success: true,
      message: 'Tournament cancelled successfully',
      refunded: tournament.xp_entry_fee > 0
    });

  } catch (error) {
    console.error('❌ Cancel tournament error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to cancel tournament',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

router.post('/tournaments/:id/distribute-prizes', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const adminId = req.admin.id;

    console.log('💰 Admin: Distributing prizes for tournament:', id);

    const { data: tournaments, error: tError } = await supabase
      .from('tournaments')
      .select('*')
      .eq('id', id)
      .eq('status', 'completed');

    if (tError) throw tError;

    if (!tournaments || tournaments.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'Tournament not found or not completed' 
      });
    }

    const tournament = tournaments[0];

    if (!tournament.winner_id) {
      return res.status(400).json({ 
        success: false, 
        message: 'Tournament has no winner set' 
      });
    }

    const { data: existingPrizes, error: checkError } = await supabase
      .from('xp_transactions')
      .select('id')
      .eq('tournament_id', id)
      .eq('type', 'earned')
      .like('description', '%prize%')
      .limit(1);

    if (!checkError && existingPrizes && existingPrizes.length > 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'Prizes already distributed for this tournament' 
      });
    }

    const totalPrize = tournament.prize_pool || tournament.custom_prize_pool || 0;
    
    if (totalPrize > 0) {
      await supabase.rpc('increment_user_xp', {
        user_id: tournament.winner_id,
        amount: totalPrize
      });

      await supabase
        .from('xp_transactions')
        .insert({
          user_id: tournament.winner_id,
          tournament_id: id,
          amount: totalPrize,
          type: 'earned',
          description: `Tournament prize: ${tournament.name}`,
          created_at: new Date().toISOString()
        });

      console.log(`💰 Awarded ${totalPrize} XP to winner ${tournament.winner_id}`);
    }

    await supabase
      .from('admin_activity_logs')
      .insert({
        admin_id: adminId,
        action_type: 'prize_distribution',
        description: `Distributed prizes for tournament #${id}`,
        details: JSON.stringify({
          tournament_name: tournament.name,
          winner_id: tournament.winner_id,
          prize_amount: totalPrize,
          prize_type: tournament.prize_pool_option
        })
      });

    console.log('✅ Prizes distributed successfully');

    res.json({
      success: true,
      message: 'Prizes distributed successfully',
      prize_distributed: totalPrize,
      winner_id: tournament.winner_id
    });

  } catch (error) {
    console.error('❌ Distribute prizes error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to distribute prizes',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

router.delete('/tournaments/:id/participants/:userId', authenticateAdmin, async (req, res) => {
  try {
    const { id, userId } = req.params;
    const adminId = req.admin.id;
    const { reason } = req.body;

    console.log('👢 Admin: Removing participant:', { tournamentId: id, userId, adminId });

    const { data: tournaments, error: tError } = await supabase
      .from('tournaments')
      .select('*')
      .eq('id', id)
      .eq('status', 'upcoming');

    if (tError) throw tError;

    if (!tournaments || tournaments.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'Tournament not found or already started' 
      });
    }

    const tournament = tournaments[0];

    const { data: participants, error: pError } = await supabase
      .from('tournament_participants')
      .select(`
        *,
        users (username)
      `)
      .eq('tournament_id', id)
      .eq('user_id', userId)
      .eq('status', 'joined');

    if (pError) throw pError;

    if (!participants || participants.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'Participant not found in tournament' 
      });
    }

    const participant = participants[0];

    await supabase
      .from('tournament_participants')
      .update({ status: 'declined' })
      .eq('tournament_id', id)
      .eq('user_id', userId);

    if (tournament.xp_entry_fee > 0) {
      await supabase.rpc('increment_user_xp', {
        user_id: userId,
        amount: tournament.xp_entry_fee
      });

      await supabase
        .from('xp_transactions')
        .insert({
          user_id: userId,
          tournament_id: id,
          amount: tournament.xp_entry_fee,
          type: 'refund',
          description: `XP refund for removal from tournament: ${tournament.name}`,
          created_at: new Date().toISOString()
        });
    }

    await supabase
      .from('notifications')
      .insert({
        user_id: userId,
        message: `You have been removed from tournament "${tournament.name}" by admin. ${tournament.xp_entry_fee > 0 ? 'Your entry fee has been refunded.' : ''}`,
        type: 'system',
        status: 'unread',
        tournament_id: id,
        created_at: new Date().toISOString()
      });

    await supabase
      .from('admin_activity_logs')
      .insert({
        admin_id: adminId,
        action_type: 'participant_removal',
        description: `Removed participant ${userId} from tournament #${id}`,
        details: JSON.stringify({
          reason,
          participant_username: participant.users?.username,
          tournament_name: tournament.name,
          entry_fee_refunded: tournament.xp_entry_fee
        })
      });

    console.log('✅ Participant removed successfully');

    res.json({
      success: true,
      message: 'Participant removed successfully',
      refunded: tournament.xp_entry_fee > 0
    });

  } catch (error) {
    console.error('❌ Remove participant error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to remove participant',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

router.get('/tournaments/:id/matches', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    console.log('🎮 Admin: Fetching matches for tournament:', id);

    const { data: matches, error } = await supabase
      .from('tournament_matches')
      .select(`
        *,
        player1:player1_id (username),
        player2:player2_id (username),
        winner:winner_id (username)
      `)
      .eq('tournament_id', id)
      .order('round_number', { ascending: true })
      .order('id', { ascending: true });

    if (error) throw error;

    const formattedMatches = (matches || []).map(m => ({
      ...m,
      player1_username: m.player1?.username,
      player2_username: m.player2?.username,
      winner_username: m.winner?.username,
      player1: undefined,
      player2: undefined,
      winner: undefined
    }));

    console.log('✅ Found', formattedMatches.length, 'matches');

    res.json({
      success: true,
      matches: formattedMatches,
      tournament_id: id
    });

  } catch (error) {
    console.error('❌ Get matches error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch matches' 
    });
  }
});

// ==================== ADMIN MONITORING ====================

router.get('/monitored-tournaments', authenticateAdmin, async (req, res) => {
  try {
    console.log('🛡️ Admin: Fetching monitored tournaments');

    const { data: tournaments, error } = await supabase
      .from('tournaments')
      .select(`
        *,
        creator:creator_id (username)
      `)
      .eq('admin_monitoring', true)
      .order('created_at', { ascending: false });

    if (error) throw error;

    const tournamentsWithStats = await Promise.all((tournaments || []).map(async (tournament) => {
      const { count: participantsCount } = await supabase
        .from('tournament_participants')
        .select('*', { count: 'exact', head: true })
        .eq('tournament_id', tournament.id)
        .eq('status', 'joined');

      const { count: logCount } = await supabase
        .from('admin_monitoring_logs')
        .select('*', { count: 'exact', head: true })
        .eq('tournament_id', tournament.id);

      return {
        ...tournament,
        creator_name: tournament.creator?.username,
        participants_count: participantsCount || 0,
        log_count: logCount || 0
      };
    }));

    res.json({
      success: true,
      tournaments: tournamentsWithStats,
      count: tournamentsWithStats.length
    });

  } catch (error) {
    console.error('❌ Get monitored tournaments error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch monitored tournaments'
    });
  }
});

router.get('/tournaments/:id/monitoring-logs', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    console.log('📝 Admin: Fetching monitoring logs for tournament:', id);

    const { data: logs, error } = await supabase
      .from('admin_monitoring_logs')
      .select(`
        *,
        admin_users:admin_id (username),
        tournaments:tournament_id (name)
      `)
      .eq('tournament_id', id)
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) throw error;

    const formattedLogs = (logs || []).map(log => ({
      ...log,
      admin_name: log.admin_users?.username,
      tournament_name: log.tournaments?.name
    }));

    res.json({
      success: true,
      logs: formattedLogs,
      tournament_id: id,
      count: formattedLogs.length
    });

  } catch (error) {
    console.error('❌ Get monitoring logs error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch monitoring logs'
    });
  }
});

router.get('/tournaments/:id/monitoring-stats', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const { data: logs, error } = await supabase
      .from('admin_monitoring_logs')
      .select('action_type, admin_id, created_at')
      .eq('tournament_id', id);

    if (error) throw error;

    const uniqueAdmins = new Set((logs || []).map(l => l.admin_id)).size;
    
    const stats = {
      total_actions: logs?.length || 0,
      disputes_resolved: logs?.filter(l => l.action_type === 'resolved_dispute').length || 0,
      results_overridden: logs?.filter(l => l.action_type === 'overrode_result').length || 0,
      prizes_distributed: logs?.filter(l => l.action_type === 'distributed_prize').length || 0,
      warnings_issued: logs?.filter(l => l.action_type === 'warned_player').length || 0,
      unique_admins: uniqueAdmins,
      first_action: logs?.length > 0 ? logs[logs.length - 1]?.created_at : null,
      last_action: logs?.length > 0 ? logs[0]?.created_at : null
    };

    res.json({
      success: true,
      stats,
      tournament_id: id
    });

  } catch (error) {
    console.error('❌ Get monitoring stats error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch monitoring statistics'
    });
  }
});

// ==================== SYSTEM MAINTENANCE ENDPOINTS ====================

router.get('/maintenance/health', authenticateAdmin, async (req, res) => {
  try {
    console.log('🔧 Checking system health');
    
    let dbStatus = 'disconnected';
    try {
      const { error } = await supabase.from('users').select('id').limit(1);
      if (!error) dbStatus = 'connected';
    } catch (dbError) {
      console.error('Database connection error:', dbError);
    }

    res.json({
      success: true,
      health: {
        api_status: 'online',
        database_status: dbStatus,
        cache_status: 'active',
        server_load: 'normal',
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('❌ Health check error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Health check failed' 
    });
  }
});

router.post('/broadcast-message', authenticateAdmin, async (req, res) => {
  try {
    const { message } = req.body;
    const adminId = req.admin.id;

    if (!message || message.trim() === '') {
      return res.status(400).json({ 
        success: false, 
        message: 'Message is required' 
      });
    }

    console.log('📢 Broadcasting in-app message to all users:', message);

    const { data: users, error: userError } = await supabase
      .from('users')
      .select('id')
      .eq('account_status', 'active')
      .eq('is_banned', false);

    if (userError) throw userError;

    let usersNotified = 0;
    
    for (const user of (users || [])) {
      try {
        await supabase
          .from('notifications')
          .insert({
            user_id: user.id,
            sender_id: adminId,
            message: message,
            type: 'system',
            status: 'unread',
            created_at: new Date().toISOString()
          });
        usersNotified++;
      } catch (error) {
        console.warn(`⚠️ Could not notify user ${user.id}:`, error.message);
      }
    }

    await supabase
      .from('admin_activity_logs')
      .insert({
        admin_id: adminId,
        action_type: 'broadcast',
        description: 'Sent in-app message to all users'
      });

    res.json({
      success: true,
      message: 'Broadcast message sent successfully',
      users_notified: usersNotified
    });

  } catch (error) {
    console.error('❌ Broadcast message error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to broadcast message' 
    });
  }
});

// ==================== GAMES MANAGEMENT ====================

router.get('/games', authenticateAdmin, async (req, res) => {
  try {
    const { category, is_active, search = '' } = req.query;
    
    console.log('🎮 Admin: Fetching games - Category:', category, 'Search:', search);

    let query = supabase
      .from('games')
      .select('*');

    if (category && category !== 'all') {
      query = query.eq('category', category);
    }
    
    if (is_active !== undefined) {
      query = query.eq('is_active', is_active === 'true');
    }
    
    if (search.trim() !== '') {
      query = query.ilike('name', `%${search.trim()}%`);
    }

    const { data: games, error } = await query.order('name', { ascending: true });

    if (error) throw error;

    res.json({
      success: true,
      games: games || [],
      count: games?.length || 0
    });

  } catch (error) {
    console.error('❌ Get games error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch games' 
    });
  }
});

router.post('/games', authenticateAdmin, async (req, res) => {
  try {
    const { 
      name, 
      category = 'other', 
      min_players = 2, 
      max_players = 10, 
      platforms = 'PC,Console,Mobile',
      description = '',
      icon_url = null
    } = req.body;
    const adminId = req.admin.id;

    if (!name || name.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Game name is required'
      });
    }

    console.log('🎮 Admin: Adding new game:', name);

    const { data: existingGames, error: checkError } = await supabase
      .from('games')
      .select('id')
      .ilike('name', name.trim());

    if (checkError) throw checkError;

    if (existingGames && existingGames.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Game already exists'
      });
    }

    const { data: newGame, error: insertError } = await supabase
      .from('games')
      .insert({
        name: name.trim(),
        category: category,
        min_players: parseInt(min_players),
        max_players: parseInt(max_players),
        platforms: platforms,
        description: description,
        icon_url: icon_url
      })
      .select();

    if (insertError) throw insertError;

    await supabase
      .from('admin_activity_logs')
      .insert({
        admin_id: adminId,
        action_type: 'game_add',
        description: `Added new game: ${name}`
      });

    res.json({
      success: true,
      message: 'Game added successfully',
      game_id: newGame?.[0]?.id
    });

  } catch (error) {
    console.error('❌ Add game error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to add game' 
    });
  }
});

router.put('/games/:id', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const gameData = req.body;
    const adminId = req.admin.id;

    console.log('🎮 Admin: Updating game ID:', id, 'Data:', gameData);

    const { data: games, error: checkError } = await supabase
      .from('games')
      .select('id, name')
      .eq('id', id);

    if (checkError) throw checkError;

    if (!games || games.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Game not found'
      });
    }

    const allowedFields = [
      'name', 'category', 'min_players', 'max_players', 
      'platforms', 'description', 'icon_url', 'is_active'
    ];

    const updateObject = {};
    for (const field of allowedFields) {
      if (field in gameData) {
        updateObject[field] = gameData[field];
      }
    }

    if (Object.keys(updateObject).length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No valid fields to update'
      });
    }

    updateObject.updated_at = new Date().toISOString();

    const { error: updateError } = await supabase
      .from('games')
      .update(updateObject)
      .eq('id', id);

    if (updateError) throw updateError;

    await supabase
      .from('admin_activity_logs')
      .insert({
        admin_id: adminId,
        action_type: 'game_update',
        description: `Updated game #${id}`
      });

    res.json({
      success: true,
      message: 'Game updated successfully'
    });

  } catch (error) {
    console.error('❌ Update game error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to update game' 
    });
  }
});

router.delete('/games/:id', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const adminId = req.admin.id;

    console.log('🎮 Admin: Deleting game ID:', id);

    const { data: games, error: checkError } = await supabase
      .from('games')
      .select('name')
      .eq('id', id);

    if (checkError) throw checkError;

    if (!games || games.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Game not found'
      });
    }

    const gameName = games[0].name;

    const { error: updateError } = await supabase
      .from('games')
      .update({
        is_active: false,
        updated_at: new Date().toISOString()
      })
      .eq('id', id);

    if (updateError) throw updateError;

    await supabase
      .from('admin_activity_logs')
      .insert({
        admin_id: adminId,
        action_type: 'game_delete',
        description: `Deleted game: ${gameName}`
      });

    res.json({
      success: true,
      message: 'Game deleted successfully'
    });

  } catch (error) {
    console.error('❌ Delete game error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to delete game' 
    });
  }
});

// ==================== FACTORY RESET ====================

router.post('/factory-reset', authenticateAdmin, async (req, res) => {
  try {
    const adminId = req.admin.id;
    const { backup = true } = req.body;

    console.log('🏭 Admin performing factory reset', { backup, adminId });

    if (backup) {
      const { data: settings, error: settingsError } = await supabase
        .from('system_settings')
        .select('setting_key, setting_value');

      if (!settingsError && settings) {
        const settingsData = {};
        settings.forEach(setting => {
          settingsData[setting.setting_key] = setting.setting_value;
        });

        await supabase
          .from('settings_backup')
          .insert({
            admin_id: adminId,
            settings_data: settingsData,
            created_at: new Date().toISOString()
          });
        console.log('✅ Settings backup created');
      }
    }

    const defaultSettings = [
      { setting_key: 'platformName', setting_value: 'Xperience', category: 'general' },
      { setting_key: 'platformCurrency', setting_value: 'NGN', category: 'general' },
      { setting_key: 'sessionTimeout', setting_value: '15', category: 'security' },
      { setting_key: 'minDepositAmount', setting_value: '500', category: 'financial' },
      { setting_key: 'maxDepositAmount', setting_value: '100000', category: 'financial' },
      { setting_key: 'minWithdrawalAmount', setting_value: '1000', category: 'financial' },
      { setting_key: 'maxWithdrawalAmount', setting_value: '100000', category: 'financial' },
      { setting_key: 'withdrawalLimitDaily', setting_value: '1', category: 'financial' },
      { setting_key: 'withdrawalLimitWeekly', setting_value: '3', category: 'financial' },
      { setting_key: 'withdrawalLimitMonthly', setting_value: '11', category: 'financial' },
      { setting_key: 'enableUSD', setting_value: 'false', category: 'financial' },
      { setting_key: 'enableEUR', setting_value: 'false', category: 'financial' },
      { setting_key: 'enableGBP', setting_value: 'false', category: 'financial' },
      { setting_key: 'enableRegistration', setting_value: 'true', category: 'general' },
      { setting_key: 'requireEmailVerification', setting_value: 'false', category: 'security' },
      { setting_key: 'defaultUserRank', setting_value: 'E', category: 'gaming' },
      { setting_key: 'maxLoginAttempts', setting_value: '5', category: 'security' },
      { setting_key: 'requireProfileCompletion', setting_value: 'true', category: 'general' },
      { setting_key: 'allowMultipleDevices', setting_value: 'false', category: 'security' },
      { setting_key: 'minMatchStakePercentage', setting_value: '15', category: 'gaming' },
      { setting_key: 'emailNotifications', setting_value: 'true', category: 'notifications' },
      { setting_key: 'pushNotifications', setting_value: 'true', category: 'notifications' },
      { setting_key: 'adminAlerts', setting_value: 'true', category: 'notifications' },
      { setting_key: 'systemAnnouncements', setting_value: 'true', category: 'notifications' },
      { setting_key: 'enable2FA', setting_value: 'false', category: 'security' },
      { setting_key: 'requireTransactionPIN', setting_value: 'true', category: 'security' },
      { setting_key: 'enforceStrongPasswords', setting_value: 'true', category: 'security' },
      { setting_key: 'sessionEncryption', setting_value: 'true', category: 'security' },
      { setting_key: 'ipWhitelisting', setting_value: 'false', category: 'security' },
      { setting_key: 'maintenanceMode', setting_value: 'false', category: 'system' },
      { setting_key: 'backupFrequency', setting_value: 'daily', category: 'system' },
      { setting_key: 'logRetentionDays', setting_value: '30', category: 'system' },
      { setting_key: 'cacheEnabled', setting_value: 'true', category: 'system' }
    ];

    await supabase
      .from('system_settings')
      .delete()
      .neq('setting_key', 'none');

    for (const setting of defaultSettings) {
      await supabase
        .from('system_settings')
        .insert({
          ...setting,
          updated_by: adminId,
          updated_at: new Date().toISOString()
        });
    }

    await supabase
      .from('xp_rates')
      .delete()
      .neq('currency', 'none');

    const defaultXpRates = [
      { currency: 'NGN', xp_per_unit: 25, unit_amount: 1000, is_active: true, description: '25 XP per 1000 NGN' },
      { currency: 'USD', xp_per_unit: 25, unit_amount: 1.20, is_active: false, description: '25 XP per 1.2 USD' },
      { currency: 'EUR', xp_per_unit: 25, unit_amount: 1.10, is_active: false, description: '25 XP per 1.1 EUR' },
      { currency: 'GBP', xp_per_unit: 25, unit_amount: 0.90, is_active: false, description: '25 XP per 0.9 GBP' }
    ];

    for (const rate of defaultXpRates) {
      await supabase
        .from('xp_rates')
        .insert(rate);
    }

    await supabase
      .from('admin_activity_logs')
      .insert({
        admin_id: adminId,
        action_type: 'factory_reset',
        description: 'Performed factory reset of all settings',
        created_at: new Date().toISOString()
      });

    console.log('✅ Factory reset completed');

    res.json({
      success: true,
      message: 'Factory reset completed successfully',
      backup_created: backup
    });

  } catch (error) {
    console.error('❌ Factory reset error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Factory reset failed' 
    });
  }
});

router.post('/factory-reset/undo', authenticateAdmin, async (req, res) => {
  try {
    const adminId = req.admin.id;

    console.log('↩️ Admin undoing factory reset', { adminId });

    const { data: backups, error: backupError } = await supabase
      .from('settings_backup')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(1);

    if (backupError) throw backupError;

    if (!backups || backups.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'No backup found' 
      });
    }

    const backup = backups[0];
    const settingsData = typeof backup.settings_data === 'string' 
      ? JSON.parse(backup.settings_data) 
      : backup.settings_data;

    await supabase
      .from('system_settings')
      .delete()
      .neq('setting_key', 'none');

    for (const [key, value] of Object.entries(settingsData)) {
      await supabase
        .from('system_settings')
        .insert({
          setting_key: key,
          setting_value: value,
          updated_by: adminId,
          updated_at: new Date().toISOString()
        });
    }

    await supabase
      .from('admin_activity_logs')
      .insert({
        admin_id: adminId,
        action_type: 'factory_reset_undo',
        description: 'Restored settings from backup',
        created_at: new Date().toISOString()
      });

    console.log('✅ Factory reset undone');

    res.json({
      success: true,
      message: 'Settings restored from backup'
    });

  } catch (error) {
    console.error('❌ Undo factory reset error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to restore from backup' 
    });
  }
});

// ==================== EMAIL NOTIFICATION SYSTEM ====================

router.get('/email/templates', authenticateAdmin, async (req, res) => {
  try {
    console.log('📧 Fetching email templates');
    
    const { data: templates, error } = await supabase
      .from('email_templates')
      .select('*')
      .order('name');

    if (error) throw error;

    res.json({
      success: true,
      templates: templates || []
    });

  } catch (error) {
    console.error('❌ Get email templates error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch email templates' 
    });
  }
});

router.post('/email/templates', authenticateAdmin, async (req, res) => {
  try {
    const { name, subject, content, variables } = req.body;
    const adminId = req.admin.id;

    if (!name || !subject || !content) {
      return res.status(400).json({
        success: false,
        message: 'Name, subject, and content are required'
      });
    }

    console.log('📧 Creating email template:', name);

    const { error } = await supabase
      .from('email_templates')
      .insert({
        name,
        subject,
        content,
        variables: variables ? JSON.stringify(variables) : null
      });

    if (error) throw error;

    await supabase
      .from('admin_activity_logs')
      .insert({
        admin_id: adminId,
        action_type: 'email_template_create',
        description: `Created email template: ${name}`
      });

    res.json({
      success: true,
      message: 'Email template created successfully'
    });

  } catch (error) {
    console.error('❌ Create email template error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to create email template' 
    });
  }
});

router.post('/send-email-notification', authenticateAdmin, async (req, res) => {
  try {
    const adminId = req.admin.id;
    
    console.log('📧 BACKEND: Received email notification request');
    
    let subject, message, recipientType, filters, recipients;
    
    if (typeof req.body === 'object' && !Array.isArray(req.body)) {
      subject = req.body.subject || '';
      message = req.body.message || '';
      recipientType = req.body.recipientType || req.body.sendTo || 'all';
      recipients = Array.isArray(req.body.recipients) ? req.body.recipients : [];
      
      if (typeof req.body.filters === 'string') {
        try {
          filters = JSON.parse(req.body.filters);
        } catch (e) {
          filters = {};
        }
      } else if (typeof req.body.filters === 'object') {
        filters = req.body.filters || {};
      } else {
        filters = {};
      }
    } else {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid request format' 
      });
    }

    if (!subject || subject.trim() === '') {
      return res.status(400).json({ 
        success: false, 
        message: 'Subject is required' 
      });
    }

    if (!message || message.trim() === '') {
      return res.status(400).json({ 
        success: false, 
        message: 'Message is required' 
      });
    }

    const cleanSubject = subject.trim();
    const cleanMessage = message.trim();

    let userEmails = [];
    let userIds = [];
    
    if (recipientType === 'all') {
      const { data: users, error: userError } = await supabase
        .from('users')
        .select('id, email')
        .eq('account_status', 'active')
        .eq('is_banned', false);

      if (!userError && users) {
        userEmails = users.map(user => user.email);
        userIds = users.map(user => user.id);
      }
      console.log(`📧 BACKEND: Found ${userEmails.length} active users for "all"`);
    } else if (recipientType === 'selected' && recipients.length > 0) {
      const { data: users, error: userError } = await supabase
        .from('users')
        .select('id, email')
        .in('id', recipients);

      if (!userError && users) {
        userEmails = users.map(user => user.email);
        userIds = users.map(user => user.id);
      }
      console.log(`📧 BACKEND: Found ${userEmails.length} selected users`);
    } else if (recipientType === 'filtered') {
      let query = supabase
        .from('users')
        .select('id, email')
        .eq('account_status', 'active')
        .eq('is_banned', false);
      
      if (filters.rank && filters.rank.trim() !== '') {
        query = query.eq('rank', filters.rank.trim());
      }
      
      if (filters.status && filters.status !== 'active') {
        query = query.eq('account_status', filters.status);
      }
      
      if (filters.minBalance) {
        query = query.gte('balance', parseFloat(filters.minBalance));
      }
      
      if (filters.maxBalance) {
        query = query.lte('balance', parseFloat(filters.maxBalance));
      }
      
      const { data: users, error: userError } = await query;
      
      if (!userError && users) {
        userEmails = users.map(user => user.email);
        userIds = users.map(user => user.id);
      }
      console.log(`📧 BACKEND: Found ${userEmails.length} filtered users`);
    } else {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid recipient selection' 
      });
    }

    if (userEmails.length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'No recipients found' 
      });
    }

    console.log(`📧 BACKEND: Will send to ${userEmails.length} users`);

    const emailResults = await emailService.sendToUsers(
      userEmails,
      cleanSubject,
      cleanMessage
    );

    const sentCount = emailResults.filter(r => r.success).length;
    const failedCount = emailResults.filter(r => !r.success).length;

    if (userEmails.length > 0) {
      for (const email of userEmails) {
        await supabase
          .from('email_queue')
          .insert({
            recipient_email: email,
            subject: cleanSubject,
            content: cleanMessage,
            status: sentCount > 0 ? 'sent' : 'failed',
            created_at: new Date().toISOString()
          });
      }
      console.log('📧 BACKEND: Emails logged to queue');
    }

    const broadcastMessage = `SYSTEM: ${cleanSubject} - ${cleanMessage.substring(0, 200)}${cleanMessage.length > 200 ? '...' : ''}`;
    let broadcastCount = 0;
    
    for (const userId of userIds) {
      try {
        await supabase
          .from('notifications')
          .insert({
            user_id: userId,
            sender_id: adminId,
            message: broadcastMessage,
            type: 'system',
            status: 'unread',
            created_at: new Date().toISOString()
          });
        broadcastCount++;
      } catch (error) {
        console.warn(`⚠️ BACKEND: Could not create in-app notification for user ${userId}:`, error.message);
      }
    }

    await supabase
      .from('admin_activity_logs')
      .insert({
        admin_id: adminId,
        action_type: 'email_notification',
        description: `Sent email to ${sentCount} users: ${cleanSubject} (${failedCount} failed)`
      });

    console.log(`✅ BACKEND: Email notification sent to ${sentCount} users`);
    console.log(`✅ BACKEND: In-app broadcast sent to ${broadcastCount} users`);

    res.json({
      success: true,
      message: 'Email and in-app notification sent successfully',
      email_results: {
        sent: sentCount,
        failed: failedCount,
        total: userEmails.length
      },
      broadcast_results: {
        sent: broadcastCount,
        total: userIds.length
      }
    });

  } catch (error) {
    console.error('❌ BACKEND: Send email notification error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to send email notification',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

router.get('/email/queue', authenticateAdmin, async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    console.log('📧 Fetching email queue - Status:', status, 'Page:', page);

    let query = supabase
      .from('email_queue')
      .select('*', { count: 'exact' });

    if (status && status !== 'all') {
      query = query.eq('status', status);
    }

    const { data: queue, error, count } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    res.json({
      success: true,
      queue: queue || [],
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limit)
      }
    });

  } catch (error) {
    console.error('❌ Get email queue error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch email queue' 
    });
  }
});

router.post('/email/test', authenticateAdmin, async (req, res) => {
  try {
    const { email = req.admin.email } = req.body;
    const adminId = req.admin.id;

    console.log('🧪 Testing email configuration to:', email);

    const testResult = await emailService.sendEmail(
      email,
      'Test Email from Xperience Platform',
      `
      <h1>✅ Email Test Successful!</h1>
      <p>This is a test email from Xperience Platform.</p>
      <p>If you received this, your email configuration is working correctly.</p>
      <p><strong>Timestamp:</strong> ${new Date().toISOString()}</p>
      <p><strong>Admin:</strong> ${req.admin.username}</p>
      `
    );

    await supabase
      .from('admin_activity_logs')
      .insert({
        admin_id: adminId,
        action_type: 'email_test',
        description: 'Tested email configuration'
      });

    res.json({
      success: testResult.success,
      message: testResult.success ? 'Test email sent successfully' : 'Failed to send test email',
      result: testResult
    });

  } catch (error) {
    console.error('❌ Test email error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Email test failed' 
    });
  }
});

// ==================== GROUPS MANAGEMENT ENDPOINTS ====================

router.get('/groups/stats', authenticateAdmin, async (req, res) => {
  try {
    console.log('📊 Admin: Fetching groups statistics');

    const { data: groups, error: gError } = await supabase
      .from('groups')
      .select('id, visibility, created_at');

    if (gError) throw gError;

    const { data: members, error: mError } = await supabase
      .from('group_members')
      .select('*')
      .eq('status', 'joined');

    if (mError) throw mError;

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const stats = {
      total_groups: groups?.length || 0,
      public_groups: groups?.filter(g => g.visibility === 'public').length || 0,
      private_groups: groups?.filter(g => g.visibility === 'private').length || 0,
      total_members: members?.length || 0,
      recent_groups: groups?.filter(g => new Date(g.created_at) >= sevenDaysAgo).length || 0
    };

    res.json({
      success: true,
      stats
    });

  } catch (error) {
    console.error('❌ Get groups stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch groups statistics'
    });
  }
});

router.get('/groups', authenticateAdmin, async (req, res) => {
  try {
    const { search = '', page = 1, limit = 20, visibility = '' } = req.query;
    const offset = (page - 1) * limit;
    const adminId = req.admin.id;

    console.log('👥 Admin: Fetching groups - Search:', search, 'Page:', page, 'Visibility:', visibility);

    let query = supabase
      .from('groups')
      .select(`
        *,
        creator:creator_id (username, email)
      `, { count: 'exact' });

    if (search && search.trim() !== '') {
      query = query.or(`name.ilike.%${search.trim()}%,description.ilike.%${search.trim()}%,game_specialty.ilike.%${search.trim()}%`);
    }

    if (visibility && visibility !== '') {
      query = query.eq('visibility', visibility);
    }

    const { data: groups, error, count } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    const groupsWithCounts = await Promise.all((groups || []).map(async (group) => {
      const { count: memberCount } = await supabase
        .from('group_members')
        .select('*', { count: 'exact', head: true })
        .eq('group_id', group.id)
        .eq('status', 'joined');

      return {
        id: group.id,
        name: group.name,
        description: group.description || '',
        game_specialty: group.game_specialty || '',
        visibility: group.visibility || 'public',
        max_members: group.max_members || 20,
        creator_id: group.creator_id,
        creator: {
          username: group.creator?.username,
          email: group.creator?.email
        },
        current_members: memberCount || 0,
        created_at: group.created_at,
        updated_at: group.updated_at
      };
    }));

    try {
      await supabase
        .from('admin_activity_logs')
        .insert({
          admin_id: adminId,
          action_type: 'view',
          description: 'Viewed groups list',
          created_at: new Date().toISOString()
        });
    } catch (logError) {
      console.warn('⚠️ Could not log activity:', logError.message);
    }

    res.json({
      success: true,
      groups: groupsWithCounts,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limit)
      }
    });

  } catch (error) {
    console.error('❌ Get groups error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch groups',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

router.get('/groups/:id', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    console.log('👥 Admin: Fetching group details for ID:', id);

    const { data: groups, error } = await supabase
      .from('groups')
      .select(`
        *,
        creator:creator_id (username, email)
      `)
      .eq('id', id);

    if (error) throw error;

    if (!groups || groups.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Group not found'
      });
    }

    const group = groups[0];

    const { count: memberCount } = await supabase
      .from('group_members')
      .select('*', { count: 'exact', head: true })
      .eq('group_id', id)
      .eq('status', 'joined');

    const formattedGroup = {
      id: group.id,
      name: group.name,
      description: group.description || '',
      game_specialty: group.game_specialty || '',
      visibility: group.visibility || 'public',
      max_members: group.max_members || 20,
      creator_id: group.creator_id,
      creator: {
        username: group.creator?.username,
        email: group.creator?.email
      },
      current_members: memberCount || 0,
      created_at: group.created_at,
      updated_at: group.updated_at
    };

    res.json({
      success: true,
      group: formattedGroup
    });

  } catch (error) {
    console.error('❌ Get group details error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch group details'
    });
  }
});

router.get('/groups/:id/members', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    console.log('👥 Admin: Fetching members for group ID:', id);

    const { data: groups, error: gError } = await supabase
      .from('groups')
      .select('id, name')
      .eq('id', id);

    if (gError) throw gError;

    if (!groups || groups.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Group not found'
      });
    }

    const { data: members, error: mError } = await supabase
      .from('group_members')
      .select(`
        *,
        users (username, email, profile_pic, rank, xp_points, created_at)
      `)
      .eq('group_id', id)
      .eq('status', 'joined')
      .order('joined_at', { ascending: true });

    if (mError) throw mError;

    const formattedMembers = (members || []).map(member => ({
      user_id: member.user_id,
      group_id: member.group_id,
      role: member.role || 'member',
      status: member.status,
      joined_at: member.joined_at,
      user: {
        username: member.users?.username,
        email: member.users?.email,
        profile_pic: member.users?.profile_pic,
        rank: member.users?.rank,
        xp_points: member.users?.xp_points,
        created_at: member.users?.created_at
      }
    }));

    res.json({
      success: true,
      members: formattedMembers,
      group_id: id,
      group_name: groups[0].name
    });

  } catch (error) {
    console.error('❌ Get group members error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch group members',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

router.delete('/groups/:id', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { reason = 'Deleted by admin' } = req.body;
    const adminId = req.admin.id;

    console.log('🗑️ Admin: Deleting group ID:', id, 'Reason:', reason);

    const { data: groups, error: gError } = await supabase
      .from('groups')
      .select('*')
      .eq('id', id);

    if (gError) throw gError;

    if (!groups || groups.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Group not found'
      });
    }

    const group = groups[0];

    const { count: memberCount, error: countError } = await supabase
      .from('group_members')
      .select('*', { count: 'exact', head: true })
      .eq('group_id', id);

    if (countError) throw countError;

    if (memberCount && memberCount > 0) {
      const { error: deleteError } = await supabase
        .from('group_members')
        .delete()
        .eq('group_id', id);

      if (deleteError) throw deleteError;
    }

    const { error: deleteGroupError } = await supabase
      .from('groups')
      .delete()
      .eq('id', id);

    if (deleteGroupError) throw deleteGroupError;

    try {
      await supabase
        .from('notifications')
        .insert({
          user_id: group.creator_id,
          message: `Your group "${group.name}" has been deleted by admin. Reason: ${reason}`,
          type: 'system',
          status: 'unread',
          created_at: new Date().toISOString()
        });
    } catch (notifyError) {
      console.warn('⚠️ Could not notify group creator:', notifyError.message);
    }

    await supabase
      .from('admin_activity_logs')
      .insert({
        admin_id: adminId,
        action_type: 'group_delete',
        description: `Deleted group: ${group.name}`,
        details: JSON.stringify({
          group_id: id,
          group_name: group.name,
          members_removed: memberCount || 0,
          reason: reason
        }),
        created_at: new Date().toISOString()
      });

    console.log('✅ Group deleted successfully');

    res.json({
      success: true,
      message: 'Group deleted successfully',
      group_name: group.name,
      members_removed: memberCount || 0
    });

  } catch (error) {
    console.error('❌ Delete group error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete group',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

router.delete('/groups/:groupId/members/:userId', authenticateAdmin, async (req, res) => {
  try {
    const { groupId, userId } = req.params;
    const { reason = 'Removed by admin' } = req.body;
    const adminId = req.admin.id;

    console.log('👥 Admin: Removing member', userId, 'from group', groupId);

    const { data: members, error: mError } = await supabase
      .from('group_members')
      .select(`
        *,
        users (username),
        groups (name)
      `)
      .eq('group_id', groupId)
      .eq('user_id', userId);

    if (mError) throw mError;

    if (!members || members.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Member not found in group'
      });
    }

    const member = members[0];

    const { data: groupInfo, error: infoError } = await supabase
      .from('groups')
      .select('creator_id')
      .eq('id', groupId);

    if (infoError) throw infoError;

    if (groupInfo && groupInfo[0] && parseInt(groupInfo[0].creator_id) === parseInt(userId)) {
      return res.status(400).json({
        success: false,
        message: 'Cannot remove group creator'
      });
    }

    const { error: deleteError } = await supabase
      .from('group_members')
      .delete()
      .eq('group_id', groupId)
      .eq('user_id', userId);

    if (deleteError) throw deleteError;

    try {
      await supabase
        .from('notifications')
        .insert({
          user_id: userId,
          message: `You have been removed from group "${member.groups?.name}" by admin. Reason: ${reason}`,
          type: 'system',
          status: 'unread',
          created_at: new Date().toISOString()
        });
    } catch (notifyError) {
      console.warn('⚠️ Could not notify removed member:', notifyError.message);
    }

    await supabase
      .from('admin_activity_logs')
      .insert({
        admin_id: adminId,
        action_type: 'group_member_remove',
        description: `Removed member from group: ${member.groups?.name}`,
        affected_user_id: userId,
        details: JSON.stringify({
          group_id: groupId,
          group_name: member.groups?.name,
          member_username: member.users?.username,
          reason: reason
        }),
        created_at: new Date().toISOString()
      });

    console.log('✅ Member removed successfully');

    res.json({
      success: true,
      message: 'Member removed successfully'
    });

  } catch (error) {
    console.error('❌ Remove member error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to remove member',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

router.get('/groups/test', authenticateAdmin, async (req, res) => {
  try {
    const { count: groupsCount, error: gError } = await supabase
      .from('groups')
      .select('*', { count: 'exact', head: true });

    const { count: membersCount, error: mError } = await supabase
      .from('group_members')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'joined');

    res.json({
      success: true,
      message: 'Groups API is working',
      test_data: {
        groups_count: groupsCount || 0,
        members_count: membersCount || 0,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Test failed',
      error: error.message
    });
  }
});

// ==================== ANALYTICS & REPORTS ENDPOINTS ====================

router.get('/analytics', authenticateAdmin, async (req, res) => {
  try {
    const { period = '30d' } = req.query;
    console.log('📈 Admin: Fetching analytics for period:', period);

    let intervalDays = 30;
    switch(period) {
      case '7d': intervalDays = 7; break;
      case '30d': intervalDays = 30; break;
      case '90d': intervalDays = 90; break;
      case '1y': intervalDays = 365; break;
      case 'all': intervalDays = 3650; break;
      default: intervalDays = 30;
    }

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - intervalDays);

    const { data: transactions, error: txError } = await supabase
      .from('transactions')
      .select('amount, type, status, created_at')
      .gte('created_at', startDate.toISOString())
      .eq('status', 'completed');

    if (txError) throw txError;

    const { data: matches, error: matchError } = await supabase
      .from('matches')
      .select('stake_amount, status, created_at')
      .gte('created_at', startDate.toISOString());

    if (matchError) throw matchError;

    const { data: tournaments, error: tourError } = await supabase
      .from('tournaments')
      .select('xp_entry_fee, status, created_at')
      .gte('created_at', startDate.toISOString())
      .in('status', ['ongoing', 'completed']);

    if (tourError) throw tourError;

    const { data: users, error: userError } = await supabase
      .from('users')
      .select('created_at')
      .gte('created_at', startDate.toISOString());

    if (userError) throw userError;

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    const { data: activeUsersData, error: activeError } = await supabase
      .from('matches')
      .select('player1_id, player2_id')
      .gte('created_at', sevenDaysAgo.toISOString());

    if (activeError) throw activeError;

    const activeUserIds = new Set();
    (activeUsersData || []).forEach(match => {
      activeUserIds.add(match.player1_id);
      if (match.player2_id) activeUserIds.add(match.player2_id);
    });

    const deposits = transactions?.filter(tx => tx.type === 'deposit') || [];
    const withdrawals = transactions?.filter(tx => tx.type === 'withdrawal') || [];
    
    const totalDeposits = deposits.reduce((sum, tx) => sum + parseFloat(tx.amount), 0);
    const totalWithdrawals = withdrawals.reduce((sum, tx) => sum + parseFloat(tx.amount), 0);

    const completedMatches = matches?.filter(m => m.status === 'completed') || [];
    const matchStakes = completedMatches.reduce((sum, m) => sum + (parseFloat(m.stake_amount) || 0), 0);
    const matchPlatformFees = matchStakes * 0.15;
    
    const tournamentFees = tournaments?.reduce((sum, t) => sum + (parseFloat(t.xp_entry_fee) || 0), 0) || 0;
    const tournamentPlatformFees = tournamentFees * 0.15;
    
    const totalPlatformFees = matchPlatformFees + tournamentPlatformFees;

    const revenueTrend = [];
    const days = intervalDays > 90 ? 7 : 1;
    let currentDate = new Date(startDate);
    
    while (currentDate <= new Date()) {
      const dateStr = currentDate.toISOString().split('T')[0];
      const dayDeposits = deposits.filter(tx => tx.created_at?.split('T')[0] === dateStr)
        .reduce((sum, tx) => sum + parseFloat(tx.amount), 0);
      const dayWithdrawals = withdrawals.filter(tx => tx.created_at?.split('T')[0] === dateStr)
        .reduce((sum, tx) => sum + parseFloat(tx.amount), 0);
      
      revenueTrend.push({
        period: dateStr,
        deposits: dayDeposits,
        withdrawals: dayWithdrawals
      });
      
      currentDate.setDate(currentDate.getDate() + days);
    }

    const { data: gameStats, error: gameError } = await supabase
      .from('matches')
      .select('game, stake_amount')
      .gte('created_at', startDate.toISOString())
      .not('game', 'is', null);

    const gameMap = new Map();
    (gameStats || []).forEach(match => {
      if (!gameMap.has(match.game)) {
        gameMap.set(match.game, { count: 0, total_stake: 0 });
      }
      const stats = gameMap.get(match.game);
      stats.count++;
      stats.total_stake += parseFloat(match.stake_amount) || 0;
    });

    const topGames = Array.from(gameMap.entries())
      .map(([game, stats]) => ({
        game,
        match_count: stats.count,
        total_stake: stats.total_stake
      }))
      .sort((a, b) => b.match_count - a.match_count)
      .slice(0, 5);

    res.json({
      success: true,
      analytics: {
        period,
        summary: {
          total_deposits: totalDeposits,
          total_withdrawals: totalWithdrawals,
          net_revenue: totalDeposits - totalWithdrawals + totalPlatformFees,
          platform_fees: totalPlatformFees,
          match_stakes: matchStakes,
          tournament_fees: tournamentFees,
          total_users: users?.length || 0,
          active_users: activeUserIds.size,
          total_matches: matches?.length || 0,
          total_tournaments: tournaments?.length || 0,
          ongoing_tournaments: tournaments?.filter(t => t.status === 'ongoing').length || 0,
          total_groups: 0,
          active_groups: 0,
          pending_withdrawals: 0,
          pending_withdrawal_amount: 0,
          unique_players: 0
        },
        revenue_trend: revenueTrend,
        top_games: topGames,
        platform_fee_breakdown: {
          match_stakes: matchStakes,
          match_fees: matchPlatformFees,
          tournament_fees: tournamentFees,
          tournament_platform_fees: tournamentPlatformFees,
          total_platform_fees: totalPlatformFees
        }
      }
    });

  } catch (error) {
    console.error('❌ Get analytics error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch analytics',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// ==================== REPORTS ENDPOINTS ====================

router.get('/reports/history', authenticateAdmin, async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    console.log('📋 Admin: Fetching report history - Page:', page, 'Limit:', limit);

    const { data: reports, error, count } = await supabase
      .from('admin_reports')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.warn('Reports table might not exist:', error.message);
      return res.json({
        success: true,
        reports: [],
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: 0,
          totalPages: 0
        }
      });
    }

    const formattedReports = (reports || []).map(report => ({
      id: report.id,
      name: report.filename?.replace(/_/g, ' ') || `${report.report_type} Report`,
      type: report.report_type,
      created_at: report.created_at,
      start_date: report.start_date,
      end_date: report.end_date,
      format: report.format,
      filename: report.filename,
      record_count: report.record_count,
      download_count: report.download_count,
      status: report.status
    }));

    res.json({
      success: true,
      reports: formattedReports,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limit)
      }
    });

  } catch (error) {
    console.error('❌ Get report history error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch report history',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

router.post('/reports/generate', authenticateAdmin, async (req, res) => {
  try {
    const { type, startDate, endDate, format = 'json' } = req.body;
    const adminId = req.admin.id;

    console.log('📊 Admin: Generating report - Type:', type, 'Format:', format);

    if (!type || !startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: 'Type, startDate, and endDate are required'
      });
    }

    let reportData = [];
    let filename = '';

    switch(type) {
      case 'users':
        const { data: users, error: uError } = await supabase
          .from('users')
          .select(`
            *,
            matches:matches!matches_player1_id_fkey (id),
            tournament_participants (tournament_id),
            group_members (group_id),
            transactions (amount, type)
          `)
          .gte('created_at', startDate)
          .lte('created_at', endDate);

        if (uError) throw uError;
        
        reportData = (users || []).map(u => ({
          ...u,
          total_matches: u.matches?.length || 0,
          total_tournaments: u.tournament_participants?.length || 0,
          total_groups: u.group_members?.length || 0,
          total_deposits: u.transactions?.filter(tx => tx.type === 'deposit').reduce((sum, tx) => sum + parseFloat(tx.amount), 0) || 0,
          total_withdrawals: u.transactions?.filter(tx => tx.type === 'withdrawal').reduce((sum, tx) => sum + parseFloat(tx.amount), 0) || 0
        }));
        filename = `users_report_${startDate}_to_${endDate}`;
        break;

      case 'transactions':
        const { data: transactions, error: tError } = await supabase
          .from('transactions')
          .select(`
            *,
            users (username, email, wallet_account_number)
          `)
          .gte('created_at', startDate)
          .lte('created_at', endDate)
          .order('created_at', { ascending: false });

        if (tError) throw tError;
        reportData = transactions || [];
        filename = `transactions_report_${startDate}_to_${endDate}`;
        break;

      case 'tournaments':
        const { data: tournaments, error: tourError } = await supabase
          .from('tournaments')
          .select(`
            *,
            creator:creator_id (username),
            tournament_participants (id),
            tournament_matches (id)
          `)
          .gte('created_at', startDate)
          .lte('created_at', endDate)
          .order('created_at', { ascending: false });

        if (tourError) throw tourError;
        
        reportData = (tournaments || []).map(t => ({
          ...t,
          creator_username: t.creator?.username,
          participants_count: t.tournament_participants?.length || 0,
          matches_count: t.tournament_matches?.length || 0
        }));
        filename = `tournaments_report_${startDate}_to_${endDate}`;
        break;

      case 'groups':
        const { data: groups, error: gError } = await supabase
          .from('groups')
          .select(`
            *,
            creator:creator_id (username),
            group_members (user_id)
          `)
          .gte('created_at', startDate)
          .lte('created_at', endDate)
          .order('created_at', { ascending: false });

        if (gError) throw gError;
        
        reportData = (groups || []).map(g => ({
          ...g,
          creator_username: g.creator?.username,
          members_count: g.group_members?.length || 0
        }));
        filename = `groups_report_${startDate}_to_${endDate}`;
        break;

      case 'financial':
        const { data: financialTx, error: fError } = await supabase
          .from('transactions')
          .select(`
            *,
            users (username, email, wallet_account_number)
          `)
          .gte('created_at', startDate)
          .lte('created_at', endDate)
          .eq('status', 'completed');

        if (fError) throw fError;

        const financialData = (financialTx || []).map(tx => ({
          ...tx,
          category: tx.type === 'deposit' ? 'Revenue' : tx.type === 'withdrawal' ? 'Payout' : tx.type,
          net_amount: tx.type === 'deposit' ? tx.amount : tx.type === 'withdrawal' ? -tx.amount : tx.amount
        }));

        const { data: platformFeesMatches, error: pfError } = await supabase
          .from('matches')
          .select('stake_amount, created_at, id')
          .gte('created_at', startDate)
          .lte('created_at', endDate)
          .eq('status', 'completed')
          .gt('stake_amount', 0);

        const { data: platformFeesTournaments, error: pftError } = await supabase
          .from('tournaments')
          .select('xp_entry_fee, created_at, id')
          .gte('created_at', startDate)
          .lte('created_at', endDate)
          .in('status', ['ongoing', 'completed'])
          .gt('xp_entry_fee', 0);

        const feesData = [
          ...(platformFeesMatches || []).map(m => ({
            category: 'Platform Fee',
            amount: m.stake_amount * 0.15,
            created_at: m.created_at,
            source_type: 'Match',
            source_id: m.id
          })),
          ...(platformFeesTournaments || []).map(t => ({
            category: 'Tournament Fee',
            amount: t.xp_entry_fee * 0.15,
            created_at: t.created_at,
            source_type: 'Tournament',
            source_id: t.id
          }))
        ];

        reportData = [...financialData, ...feesData];
        filename = `financial_report_${startDate}_to_${endDate}`;
        break;

      default:
        return res.status(400).json({
          success: false,
          message: 'Invalid report type. Available: users, transactions, tournaments, groups, financial'
        });
    }

    const reportId = `report_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    try {
      await supabase
        .from('admin_reports')
        .insert({
          id: reportId,
          admin_id: adminId,
          report_type: type,
          start_date: startDate,
          end_date: endDate,
          format: format,
          filename: filename,
          record_count: reportData.length,
          status: 'completed',
          created_at: new Date().toISOString()
        });
    } catch (saveError) {
      console.warn('⚠️ Could not save report to database:', saveError.message);
    }

    await supabase
      .from('admin_activity_logs')
      .insert({
        admin_id: adminId,
        action_type: 'report_generate',
        description: `Generated ${type} report from ${startDate} to ${endDate}`,
        created_at: new Date().toISOString()
      });

    if (format === 'csv') {
      const csv = convertToCSV(reportData);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
      return res.send(csv);
    }

    res.json({
      success: true,
      report: {
        id: reportId,
        type,
        startDate,
        endDate,
        format,
        filename,
        record_count: reportData.length,
        data: reportData
      }
    });

  } catch (error) {
    console.error('❌ Generate report error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate report',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

router.get('/reports/:id', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    console.log('📋 Admin: Fetching report:', id);

    const { data: reports, error } = await supabase
      .from('admin_reports')
      .select('*')
      .eq('id', id);

    if (error) {
      return res.status(404).json({
        success: false,
        message: 'Report not found'
      });
    }

    if (!reports || reports.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Report not found'
      });
    }

    res.json({
      success: true,
      report: reports[0]
    });

  } catch (error) {
    console.error('❌ Get report error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch report'
    });
  }
});

router.get('/reports/types', authenticateAdmin, async (req, res) => {
  try {
    console.log('📋 Admin: Fetching report types');
    
    const reportTypes = [
      {
        id: 'users',
        name: 'Users Report',
        description: 'Detailed user information and activity',
        fields: ['id', 'username', 'email', 'created_at', 'total_matches', 'total_tournaments', 'total_deposits']
      },
      {
        id: 'transactions',
        name: 'Transactions Report',
        description: 'All financial transactions',
        fields: ['id', 'user_id', 'type', 'amount', 'status', 'created_at', 'reference']
      },
      {
        id: 'tournaments',
        name: 'Tournaments Report',
        description: 'Tournament information and participation',
        fields: ['id', 'name', 'game', 'status', 'creator_id', 'participants_count', 'prize_pool', 'created_at']
      },
      {
        id: 'groups',
        name: 'Groups Report',
        description: 'Group information and membership',
        fields: ['id', 'name', 'visibility', 'creator_id', 'members_count', 'game_specialty', 'created_at']
      },
      {
        id: 'financial',
        name: 'Financial Report',
        description: 'Revenue, payouts, and platform fees',
        fields: ['id', 'type', 'amount', 'category', 'net_amount', 'created_at', 'user_id']
      }
    ];

    res.json({
      success: true,
      report_types: reportTypes
    });

  } catch (error) {
    console.error('❌ Get report types error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch report types'
    });
  }
});

router.get('/reports/:id/download', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { format = 'json' } = req.query;
    const adminId = req.admin.id;

    console.log('📥 Admin: Downloading report:', id, 'Format:', format);

    const { data: reports, error: reportError } = await supabase
      .from('admin_reports')
      .select('*')
      .eq('id', id);

    if (reportError || !reports || reports.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Report not found'
      });
    }

    const report = reports[0];

    await supabase
      .from('admin_reports')
      .update({ download_count: (report.download_count || 0) + 1 })
      .eq('id', id);

    let reportData = [];

    switch(report.report_type) {
      case 'users':
        const { data: users, error: uError } = await supabase
          .from('users')
          .select(`
            *,
            matches:matches!matches_player1_id_fkey (id),
            tournament_participants (tournament_id),
            group_members (group_id),
            transactions (amount, type)
          `)
          .gte('created_at', report.start_date)
          .lte('created_at', report.end_date);

        if (!uError && users) {
          reportData = users.map(u => ({
            ...u,
            total_matches: u.matches?.length || 0,
            total_tournaments: u.tournament_participants?.length || 0,
            total_groups: u.group_members?.length || 0,
            total_deposits: u.transactions?.filter(tx => tx.type === 'deposit').reduce((sum, tx) => sum + parseFloat(tx.amount), 0) || 0,
            total_withdrawals: u.transactions?.filter(tx => tx.type === 'withdrawal').reduce((sum, tx) => sum + parseFloat(tx.amount), 0) || 0
          }));
        }
        break;

      case 'transactions':
        const { data: transactions, error: tError } = await supabase
          .from('transactions')
          .select(`
            *,
            users (username, email, wallet_account_number)
          `)
          .gte('created_at', report.start_date)
          .lte('created_at', report.end_date)
          .order('created_at', { ascending: false });

        if (!tError && transactions) {
          reportData = transactions;
        }
        break;

      case 'tournaments':
        const { data: tournaments, error: tourError } = await supabase
          .from('tournaments')
          .select(`
            *,
            creator:creator_id (username),
            tournament_participants (id),
            tournament_matches (id)
          `)
          .gte('created_at', report.start_date)
          .lte('created_at', report.end_date);

        if (!tourError && tournaments) {
          reportData = tournaments.map(t => ({
            ...t,
            creator_username: t.creator?.username,
            participants_count: t.tournament_participants?.length || 0,
            matches_count: t.tournament_matches?.length || 0
          }));
        }
        break;

      case 'groups':
        const { data: groups, error: gError } = await supabase
          .from('groups')
          .select(`
            *,
            creator:creator_id (username),
            group_members (user_id)
          `)
          .gte('created_at', report.start_date)
          .lte('created_at', report.end_date);

        if (!gError && groups) {
          reportData = groups.map(g => ({
            ...g,
            creator_username: g.creator?.username,
            members_count: g.group_members?.length || 0
          }));
        }
        break;

      case 'financial':
        const { data: financialTx, error: fError } = await supabase
          .from('transactions')
          .select(`
            *,
            users (username, email, wallet_account_number)
          `)
          .gte('created_at', report.start_date)
          .lte('created_at', report.end_date)
          .eq('status', 'completed');

        if (!fError && financialTx) {
          reportData = financialTx.map(tx => ({
            ...tx,
            category: tx.type === 'deposit' ? 'Revenue' : tx.type === 'withdrawal' ? 'Payout' : tx.type,
            net_amount: tx.type === 'deposit' ? tx.amount : tx.type === 'withdrawal' ? -tx.amount : tx.amount
          }));
        }
        break;
    }

    await supabase
      .from('admin_activity_logs')
      .insert({
        admin_id: adminId,
        action_type: 'report_download',
        description: `Downloaded ${report.report_type} report ${id}`,
        created_at: new Date().toISOString()
      });

    if (format === 'csv') {
      const csv = convertToCSV(reportData);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${report.filename || 'report'}.csv"`);
      return res.send(csv);
    }

    res.json({
      success: true,
      report: {
        ...report,
        data: reportData
      }
    });

  } catch (error) {
    console.error('❌ Download report error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to download report'
    });
  }
});

function convertToCSV(data) {
  if (!data || data.length === 0) return '';
  
  const headers = Object.keys(data[0]);
  const csvRows = [];
  
  csvRows.push(headers.join(','));
  
  for (const row of data) {
    const values = headers.map(header => {
      const value = row[header];
      if (value === null || value === undefined) return '';
      const escaped = String(value).replace(/"/g, '""');
      return `"${escaped}"`;
    });
    csvRows.push(values.join(','));
  }
  
  return csvRows.join('\n');
}

// ==================== ADMIN MANAGEMENT ENDPOINTS ====================

router.get('/admins', authenticateAdmin, async (req, res) => {
  try {
    const adminId = req.admin.id;
    console.log('👑 Admin: Fetching all admins - Requested by:', adminId);

    const { data: admins, error } = await supabase
      .from('admin_users')
      .select('id, username, email, role, is_active, last_login, created_at, updated_at, permissions')
      .order('created_at', { ascending: false });

    if (error) throw error;

    const formattedAdmins = (admins || []).map(admin => ({
      ...admin,
      permissions: admin.permissions ? 
        (typeof admin.permissions === 'string' ? JSON.parse(admin.permissions) : admin.permissions) 
        : []
    }));

    res.json({
      success: true,
      admins: formattedAdmins,
      count: formattedAdmins.length
    });

  } catch (error) {
    console.error('❌ Get admins error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch admin users',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

router.get('/logs', authenticateAdmin, async (req, res) => {
  try {
    const { adminId = '', page = 1, limit = 50, action_type = '' } = req.query;
    const offset = (page - 1) * limit;

    console.log('📝 Admin: Fetching admin logs - Page:', page, 'AdminId:', adminId);

    let query = supabase
      .from('admin_activity_logs')
      .select(`
        *,
        admin_users (username),
        users:affected_user_id (username)
      `, { count: 'exact' });

    if (adminId && adminId !== '') {
      query = query.eq('admin_id', adminId);
    }

    if (action_type && action_type !== '') {
      query = query.eq('action_type', action_type);
    }

    const { data: logs, error, count } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    const formattedLogs = (logs || []).map(log => ({
      ...log,
      admin_username: log.admin_users?.username,
      affected_user_username: log.users?.username,
      admin_users: undefined,
      users: undefined,
      details: log.details ? 
        (typeof log.details === 'string' ? JSON.parse(log.details) : log.details) 
        : null
    }));

    res.json({
      success: true,
      logs: formattedLogs,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limit)
      }
    });

  } catch (error) {
    console.error('❌ Get admin logs error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch admin logs',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

router.post('/admins', authenticateAdmin, async (req, res) => {
  try {
    const { username, email, password, role = 'admin', permissions = [] } = req.body;
    const adminId = req.admin.id;

    console.log('👑 Admin: Creating new admin - Requested by:', adminId, 'Username:', username);

    if (!username || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Username, email, and password are required'
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters'
      });
    }

    const { data: existingUsername, error: uError } = await supabase
      .from('admin_users')
      .select('id')
      .eq('username', username);

    if (uError) throw uError;

    if (existingUsername && existingUsername.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Username already exists'
      });
    }

    const { data: existingEmail, error: eError } = await supabase
      .from('admin_users')
      .select('id')
      .eq('email', email);

    if (eError) throw eError;

    if (existingEmail && existingEmail.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Email already exists'
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    let permissionsJson = '[]';
    try {
      if (Array.isArray(permissions)) {
        permissionsJson = JSON.stringify(permissions);
      } else if (permissions && typeof permissions === 'string') {
        const parsed = JSON.parse(permissions);
        permissionsJson = JSON.stringify(parsed);
      }
    } catch (error) {
      console.warn('⚠️ Could not parse permissions, using empty array:', error.message);
      permissionsJson = '[]';
    }

    const { data: newAdmin, error: createError } = await supabase
      .from('admin_users')
      .insert({
        username,
        email,
        password_hash: hashedPassword,
        role,
        permissions: permissionsJson,
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .select('id, username, email, role');

    if (createError) throw createError;

    await supabase
      .from('admin_activity_logs')
      .insert({
        admin_id: adminId,
        action_type: 'admin_create',
        description: `Created new admin user: ${username}`,
        details: JSON.stringify({
          created_username: username,
          created_email: email,
          role: role,
          permissions: permissions
        }),
        created_at: new Date().toISOString()
      });

    res.json({
      success: true,
      message: 'Admin user created successfully',
      admin: {
        ...newAdmin?.[0],
        permissions: Array.isArray(permissions) ? permissions : []
      }
    });

  } catch (error) {
    console.error('❌ Create admin error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create admin user',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

router.put('/admins/:id', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { username, email, role, permissions, is_active } = req.body;
    const adminId = req.admin.id;

    console.log('👑 Admin: Updating admin:', id, 'Requested by:', adminId);

    const { data: admins, error: checkError } = await supabase
      .from('admin_users')
      .select('id, username')
      .eq('id', id);

    if (checkError) throw checkError;

    if (!admins || admins.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Admin not found'
      });
    }

    const admin = admins[0];
    const updateObject = { updated_at: new Date().toISOString() };

    if (username !== undefined) {
      const { data: existing, error: uError } = await supabase
        .from('admin_users')
        .select('id')
        .eq('username', username)
        .neq('id', id);

      if (uError) throw uError;

      if (existing && existing.length > 0) {
        return res.status(400).json({
          success: false,
          message: 'Username already exists'
        });
      }
      updateObject.username = username;
    }

    if (email !== undefined) {
      const { data: existing, error: eError } = await supabase
        .from('admin_users')
        .select('id')
        .eq('email', email)
        .neq('id', id);

      if (eError) throw eError;

      if (existing && existing.length > 0) {
        return res.status(400).json({
          success: false,
          message: 'Email already exists'
        });
      }
      updateObject.email = email;
    }

    if (role !== undefined) {
      updateObject.role = role;
    }

    if (permissions !== undefined) {
      updateObject.permissions = JSON.stringify(permissions);
    }

    if (is_active !== undefined) {
      updateObject.is_active = is_active;
    }

    const { error: updateError } = await supabase
      .from('admin_users')
      .update(updateObject)
      .eq('id', id);

    if (updateError) throw updateError;

    await supabase
      .from('admin_activity_logs')
      .insert({
        admin_id: adminId,
        action_type: 'admin_update',
        description: `Updated admin user: ${admin.username}`,
        affected_user_id: id,
        details: JSON.stringify({
          updated_fields: Object.keys(req.body),
          new_values: req.body
        }),
        created_at: new Date().toISOString()
      });

    res.json({
      success: true,
      message: 'Admin updated successfully'
    });

  } catch (error) {
    console.error('❌ Update admin error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update admin',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

router.put('/admins/:id/password', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { newPassword } = req.body;
    const adminId = req.admin.id;

    console.log('👑 Admin: Updating password for admin:', id, 'Requested by:', adminId);

    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'New password must be at least 6 characters'
      });
    }

    const { data: admins, error: checkError } = await supabase
      .from('admin_users')
      .select('id, username')
      .eq('id', id);

    if (checkError) throw checkError;

    if (!admins || admins.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Admin not found'
      });
    }

    const admin = admins[0];
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    const { error: updateError } = await supabase
      .from('admin_users')
      .update({
        password_hash: hashedPassword,
        updated_at: new Date().toISOString()
      })
      .eq('id', id);

    if (updateError) throw updateError;

    await supabase
      .from('admin_activity_logs')
      .insert({
        admin_id: adminId,
        action_type: 'admin_password_reset',
        description: `Reset password for admin: ${admin.username}`,
        affected_user_id: id,
        created_at: new Date().toISOString()
      });

    res.json({
      success: true,
      message: 'Password updated successfully'
    });

  } catch (error) {
    console.error('❌ Update admin password error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update password',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

router.delete('/admins/:id', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const adminId = req.admin.id;

    console.log('👑 Admin: Deleting admin:', id, 'Requested by:', adminId);

    if (parseInt(id) === parseInt(adminId)) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete your own account'
      });
    }

    const { data: admins, error: checkError } = await supabase
      .from('admin_users')
      .select('id, username, role')
      .eq('id', id);

    if (checkError) throw checkError;

    if (!admins || admins.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Admin not found'
      });
    }

    const admin = admins[0];

    const { data: requesterData, error: reqError } = await supabase
      .from('admin_users')
      .select('role')
      .eq('id', adminId);

    if (reqError) throw reqError;

    const requester = requesterData?.[0];

    if (admin.role === 'super_admin' && requester?.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'Only super admin can delete other super admins'
      });
    }

    const { error: updateError } = await supabase
      .from('admin_users')
      .update({
        is_active: false,
        updated_at: new Date().toISOString()
      })
      .eq('id', id);

    if (updateError) throw updateError;

    await supabase
      .from('admin_activity_logs')
      .insert({
        admin_id: adminId,
        action_type: 'admin_delete',
        description: `Deleted admin user: ${admin.username}`,
        affected_user_id: id,
        details: JSON.stringify({
          admin_username: admin.username,
          admin_role: admin.role
        }),
        created_at: new Date().toISOString()
      });

    res.json({
      success: true,
      message: 'Admin deactivated successfully'
    });

  } catch (error) {
    console.error('❌ Delete admin error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete admin',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

router.post('/admins/:id/toggle-active', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { is_active } = req.body;
    const adminId = req.admin.id;

    console.log('👑 Admin: Toggling active status for admin:', id, 'Status:', is_active);

    if (parseInt(id) === parseInt(adminId)) {
      return res.status(400).json({
        success: false,
        message: 'Cannot change your own active status'
      });
    }

    const { data: admins, error: checkError } = await supabase
      .from('admin_users')
      .select('id, username')
      .eq('id', id);

    if (checkError) throw checkError;

    if (!admins || admins.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Admin not found'
      });
    }

    const admin = admins[0];

    const { error: updateError } = await supabase
      .from('admin_users')
      .update({
        is_active: is_active,
        updated_at: new Date().toISOString()
      })
      .eq('id', id);

    if (updateError) throw updateError;

    await supabase
      .from('admin_activity_logs')
      .insert({
        admin_id: adminId,
        action_type: 'admin_status_change',
        description: `${is_active ? 'Activated' : 'Deactivated'} admin: ${admin.username}`,
        affected_user_id: id,
        details: JSON.stringify({
          new_status: is_active ? 'active' : 'inactive',
          admin_username: admin.username
        }),
        created_at: new Date().toISOString()
      });

    res.json({
      success: true,
      message: `Admin ${is_active ? 'activated' : 'deactivated'} successfully`
    });

  } catch (error) {
    console.error('❌ Toggle admin active error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update admin status',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

router.get('/activity-types', authenticateAdmin, async (req, res) => {
  try {
    console.log('📝 Admin: Fetching activity types');

    const { data: logs, error } = await supabase
      .from('admin_activity_logs')
      .select('action_type')
      .order('action_type');

    if (error) throw error;

    const types = [...new Set((logs || []).map(log => log.action_type))];

    res.json({
      success: true,
      activity_types: types
    });

  } catch (error) {
    console.error('❌ Get activity types error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch activity types',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

router.post('/admins/:id/promote', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { promote_to } = req.body;
    const adminId = req.admin.id;

    console.log('👑 Admin: Promoting admin:', id, 'to:', promote_to);

    if (!['super_admin', 'admin'].includes(promote_to)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid promotion type'
      });
    }

    if (promote_to === 'super_admin') {
      const { data: requesterData, error: reqError } = await supabase
        .from('admin_users')
        .select('role')
        .eq('id', adminId);

      if (reqError) throw reqError;

      const requester = requesterData?.[0];

      if (requester?.role !== 'super_admin') {
        return res.status(403).json({
          success: false,
          message: 'Only super admin can promote to super_admin'
        });
      }
    }

    const { data: admins, error: checkError } = await supabase
      .from('admin_users')
      .select('id, username, role')
      .eq('id', id);

    if (checkError) throw checkError;

    if (!admins || admins.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Admin not found'
      });
    }

    const admin = admins[0];
    const oldRole = admin.role;

    const { error: updateError } = await supabase
      .from('admin_users')
      .update({
        role: promote_to,
        updated_at: new Date().toISOString()
      })
      .eq('id', id);

    if (updateError) throw updateError;

    await supabase
      .from('admin_activity_logs')
      .insert({
        admin_id: adminId,
        action_type: 'admin_promotion',
        description: `Promoted admin ${admin.username} from ${oldRole} to ${promote_to}`,
        affected_user_id: id,
        details: JSON.stringify({
          old_role: oldRole,
          new_role: promote_to,
          admin_username: admin.username
        }),
        created_at: new Date().toISOString()
      });

    res.json({
      success: true,
      message: `Admin promoted to ${promote_to} successfully`
    });

  } catch (error) {
    console.error('❌ Promote admin error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to promote admin',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

module.exports = router;
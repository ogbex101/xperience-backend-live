const express = require('express');
const router = express.Router();
const db = require('../config/database');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const emailService = require('../services/emailService');

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
      // Generate JWT token
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

// ==================== MIDDLEWARE ====================

// Middleware to verify admin token - FIXED VERSION
// Middleware to verify admin token - IMPROVED VERSION
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
    
    // Check if token is null or "null" string
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
      role: decoded.role 
    });
    
    // Check if user is admin
    const result = await db.execute(
      'SELECT id, username, role, is_active FROM admin_users WHERE id = $1',
      [decoded.id]
    );

    // Handle different PostgreSQL result formats
    const adminRows = result.rows || result[0] || [];
    const admin = adminRows.length > 0 ? adminRows[0] : null;

    if (!admin || admin.is_active !== true) {
      console.log('❌ Admin not found or inactive');
      return res.status(403).json({ 
        success: false, 
        message: 'Admin access denied' 
      });
    }

    req.admin = admin;
    console.log('✅ Admin authenticated:', admin.username);
    next();
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
    // This ensures login works even if database is empty
    if (username === 'admin' && password === 'admin@2005') {
      console.log('✅ Using hardcoded admin credentials (FALLBACK)');
      
      // First, try to create admin in database if not exists
      try {
        const [existingAdmins] = await db.execute(
          'SELECT id FROM admin_users WHERE username = $1',
          [username]
        );
        
        if (existingAdmins.length === 0) {
          console.log('⚠️ Creating admin user in database...');
          const hashedPassword = await bcrypt.hash(password, 10);
          await db.execute(
            `INSERT INTO admin_users 
             (username, password_hash, email, role, is_active) 
             VALUES ($1, $2, $3, $4, TRUE)`,
            [username, hashedPassword, 'admin@xperience.com', 'super_admin']
          );
          console.log('✅ Admin user created in database');
        }
      } catch (dbError) {
        console.warn('⚠️ Could not check/create admin in database:', dbError.message);
        // Continue with hardcoded token even if DB fails
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
          permissions: [] // Return empty array for hardcoded admin
        }
      });
    }
    // ============ END TEMPORARY FALLBACK ============

    console.log('🔍 Checking database for admin user...');
    const [admins] = await db.execute(
      'SELECT * FROM admin_users WHERE username = $1 AND is_active = TRUE',
      [username]
    );

    if (admins.length === 0) {
      console.log('❌ Admin user not found in database');
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid credentials' 
      });
    }

    const admin = admins[0];
    console.log('✅ Admin found:', admin.username);
    console.log('Password hash type:', admin.password_hash?.substring(0, 10));
    
    // Check password
    let validPassword = false;
    
    // Try bcrypt compare first
    if (admin.password_hash && admin.password_hash.startsWith('$2')) {
      validPassword = await bcrypt.compare(password, admin.password_hash);
      console.log('🔐 Bcrypt password check:', validPassword ? '✅ Match' : '❌ No match');
    } 
    // If not bcrypt hash, check plain text (for development only)
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
    await db.execute(
      'UPDATE admin_users SET last_login = NOW() WHERE id = $1',
      [admin.id]
    );

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
      await db.execute(
        `INSERT INTO admin_activity_logs 
         (admin_id, action_type, description, ip_address) 
         VALUES ($1, 'login', 'Admin logged in', $2)`,
        [admin.id, req.ip || 'unknown']
      );
    } catch (logError) {
      console.warn('⚠️ Could not log admin activity:', logError.message);
    }

    console.log('🎉 Admin login successful for:', admin.username);
    
    // ============ FIXED PERMISSIONS PARSING ============
    let permissions = [];
    try {
      if (admin.permissions) {
        console.log('🔧 Admin permissions raw:', admin.permissions);
        console.log('🔧 Admin permissions type:', typeof admin.permissions);
        
        if (typeof admin.permissions === 'string') {
          // Try to parse as JSON
          try {
            permissions = JSON.parse(admin.permissions);
            console.log('✅ Parsed permissions as JSON:', permissions);
          } catch (jsonError) {
            console.warn('⚠️ Could not parse permissions as JSON:', jsonError.message);
            
            // If it's a string that looks like an array but not valid JSON
            // Example: "['view_users', 'view_transactions']"
            if (admin.permissions.startsWith('[') && admin.permissions.endsWith(']')) {
              try {
                // Try to clean up the string
                const cleaned = admin.permissions
                  .replace(/'/g, '"')
                  .replace(/\[|\]/g, '')
                  .split(',')
                  .map(item => item.trim().replace(/"/g, ''));
                permissions = cleaned;
                console.log('✅ Extracted permissions from string:', permissions);
              } catch (cleanError) {
                console.warn('⚠️ Could not extract permissions from string:', cleanError.message);
              }
            } else if (admin.permissions.includes(',')) {
              // Comma-separated list
              permissions = admin.permissions.split(',').map(item => item.trim());
              console.log('✅ Split permissions from comma-separated string:', permissions);
            } else {
              // Single permission
              permissions = [admin.permissions.trim()];
              console.log('✅ Single permission:', permissions);
            }
          }
        } else if (Array.isArray(admin.permissions)) {
          permissions = admin.permissions;
          console.log('✅ Permissions already an array:', permissions);
        } else if (admin.permissions && typeof admin.permissions === 'object') {
          // Convert object keys to array
          permissions = Object.keys(admin.permissions);
          console.log('✅ Converted object to permissions array:', permissions);
        }
      }
    } catch (permError) {
      console.error('❌ Error processing permissions:', permError.message);
      permissions = [];
    }
    
    // Ensure permissions is always an array
    if (!Array.isArray(permissions)) {
      permissions = [];
    }
    
    console.log('🔧 Final permissions:', permissions);
    // ============ END FIX ============
    
    res.json({
      success: true,
      message: 'Login successful',
      token,
      admin: {
        id: admin.id,
        username: admin.username,
        email: admin.email,
        role: admin.role,
        permissions: permissions // Always return an array
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

// ==================== DASHBOARD STATS ====================
router.get('/dashboard/stats', authenticateAdmin, async (req, res) => {
  try {
    console.log('📊 Fetching dashboard stats for admin:', req.admin.username);
    
    // Get tournament stats - FIXED: boolean comparison and PostgreSQL date functions
    const [tournamentStats] = await db.execute(`SELECT 
      COUNT(*) as totalTournaments,
      SUM(CASE WHEN status = 'upcoming' THEN 1 ELSE 0 END) as upcomingTournaments,
      SUM(CASE WHEN status = 'ongoing' THEN 1 ELSE 0 END) as ongoingTournaments,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completedTournaments,
      SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelledTournaments,
      COALESCE(SUM(prize_pool + custom_prize_pool), 0) as totalPrizePool,
      SUM(CASE WHEN admin_monitoring = true THEN 1 ELSE 0 END) as monitored_tournaments
    FROM tournaments`);

    // Get other stats - UPDATED WITH GROUP STATS - FIXED: PostgreSQL date functions
    const [stats] = await db.execute(`SELECT 
      (SELECT COUNT(*) FROM users) as total_users,
      COALESCE((SELECT SUM(balance) FROM users), 0) as total_balance,
      COALESCE((SELECT SUM(xp_points) FROM users), 0) as total_xp,
      (SELECT COUNT(*) FROM withdrawal_requests WHERE status = 'pending') as pending_withdrawals,
      (SELECT COUNT(*) FROM transactions WHERE DATE(created_at) = CURRENT_DATE) as today_transactions,
      COALESCE((SELECT SUM(amount) FROM transactions WHERE DATE(created_at) = CURRENT_DATE AND type = 'deposit'), 0) as today_deposits,
      (SELECT COUNT(*) FROM fraud_flags WHERE status = 'active') as active_fraud_flags,
      (SELECT COUNT(*) FROM matches WHERE status = 'ongoing') as ongoing_matches,
      (SELECT COUNT(*) FROM groups WHERE DATE(created_at) = CURRENT_DATE) as today_groups,
      (SELECT COUNT(*) FROM groups) as total_groups,
      (SELECT COUNT(*) FROM groups WHERE visibility = 'public') as public_groups,
      (SELECT COUNT(*) FROM groups WHERE visibility = 'private') as private_groups,
      (SELECT COUNT(*) FROM group_members WHERE status = 'joined') as total_group_members,
      (SELECT COUNT(*) FROM groups WHERE created_at >= NOW() - INTERVAL '7 days') as active_groups
    `);

    // Combine stats
    const combinedStats = {
      ...stats[0],
      ...tournamentStats[0]
    };

    // Get other data...
    const [recentWithdrawals] = await db.execute(`SELECT 
      wr.*, u.username, u.email 
      FROM withdrawal_requests wr
      JOIN users u ON wr.user_id = u.id
      WHERE wr.status = 'pending'
      ORDER BY wr.created_at DESC
      LIMIT 10`);

    const [recentUsers] = await db.execute(`SELECT 
      id, username, email, balance, xp_points, created_at 
      FROM users 
      ORDER BY created_at DESC 
      LIMIT 5`);

    const [ongoingMatches] = await db.execute(`SELECT 
      m.*, 
      p1.username as player1_username,
      p2.username as player2_username,
      w.username as winner_username
      FROM matches m
      LEFT JOIN users p1 ON m.player1_id = p1.id
      LEFT JOIN users p2 ON m.player2_id = p2.id
      LEFT JOIN users w ON m.winner_id = w.id
      WHERE m.status = 'ongoing'
      ORDER BY m.created_at DESC
      LIMIT 5`);

    const [ongoingTournaments] = await db.execute(`SELECT 
      t.*, 
      c.username as creator_username,
      w.username as winner_username
      FROM tournaments t
      LEFT JOIN users c ON t.creator_id = c.id
      LEFT JOIN users w ON t.winner_id = w.id
      WHERE t.status = 'ongoing'
      ORDER BY t.start_date ASC
      LIMIT 5`);

    const [recentGroups] = await db.execute(`SELECT 
      g.*, 
      u.username as creator_username,
      (SELECT COUNT(*) FROM group_members gm WHERE gm.group_id = g.id AND gm.status = 'joined') as member_count
      FROM groups g
      JOIN users u ON g.creator_id = u.id
      ORDER BY g.created_at DESC
      LIMIT 5`);

    res.json({
      success: true,
      stats: combinedStats,
      recent_withdrawals: recentWithdrawals,
      recent_users: recentUsers,
      ongoing_matches: ongoingMatches,
      ongoing_tournaments: ongoingTournaments,
      recent_groups: recentGroups
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

router.get('/withdrawals', authenticateAdmin, async (req, res) => {
  try {
    const { status = '', page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    console.log('📋 Fetching withdrawals - Status:', status, 'Page:', page);

    // Build query with parameterized values
    // FIXED: Cast user_id to integer for proper comparison
    let query = `
      SELECT 
        wr.*,
        u.username,
        u.email,
        u.wallet_account_number
      FROM withdrawal_requests wr
      JOIN users u ON wr.user_id::integer = u.id
    `;
    
    let countQuery = `
      SELECT COUNT(*) as total 
      FROM withdrawal_requests wr
      JOIN users u ON wr.user_id::integer = u.id
    `;
    
    const params = [];
    const countParams = [];
    let paramCount = 1;
    let countParamCount = 1;
    
    // Add status filter if provided
    if (status && status.trim() !== '') {
      query += ` WHERE wr.status = $${paramCount}`;
      countQuery += ` WHERE wr.status = $${countParamCount}`;
      params.push(status);
      countParams.push(status);
      paramCount++;
      countParamCount++;
    }
    
    // Add ordering and pagination
    query += ` ORDER BY wr.created_at DESC`;
    
    if (limit) {
      query += ` LIMIT $${paramCount}`;
      params.push(parseInt(limit));
      paramCount++;
    }
    
    if (offset) {
      query += ` OFFSET $${paramCount}`;
      params.push(parseInt(offset));
    }

    console.log('📝 Query:', query);
    console.log('📝 Params:', params);

    // Execute queries
    const withdrawalsResult = await db.execute(query, params);
    const countResult = await db.execute(countQuery, countParams);
    
    // Handle different result formats
    const withdrawals = withdrawalsResult.rows || withdrawalsResult[0] || [];
    const total = countResult.rows ? 
      parseInt(countResult.rows[0]?.total || 0) : 
      (countResult[0] ? parseInt(countResult[0][0]?.total || 0) : 0);

    console.log('✅ Found', withdrawals.length, 'withdrawals out of', total, 'total');

    // Format the withdrawals to include parsed bank details
    const formattedWithdrawals = withdrawals.map(withdrawal => {
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
        account_details: accountDetails
      };
    });

    // Return proper response structure
    res.json({
      success: true,
      withdrawals: formattedWithdrawals,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: total,
        totalPages: Math.ceil(total / limit)
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

    const [withdrawals] = await db.execute(`
      SELECT wr.*, u.*, 
             JSON_UNQUOTE(JSON_EXTRACT(wr.account_details, '$.bank_name')) as bank_name,
             JSON_UNQUOTE(JSON_EXTRACT(wr.account_details, '$.account_number')) as account_number,
             JSON_UNQUOTE(JSON_EXTRACT(wr.account_details, '$.account_name')) as account_name
      FROM withdrawal_requests wr
      JOIN users u ON wr.user_id = u.id
      WHERE wr.id = ?
    `, [id]);

    if (withdrawals.length === 0) {
      console.log('❌ Withdrawal not found:', id);
      return res.status(404).json({ 
        success: false, 
        message: 'Withdrawal not found' 
      });
    }

    console.log('✅ Withdrawal found:', withdrawals[0].receipt_number);

    // Get transaction details
    const [transactions] = await db.execute(
      'SELECT * FROM transactions WHERE id = ?',
      [withdrawals[0].transaction_id]
    );

    // Get approval history
    const [approvals] = await db.execute(`
      SELECT wa.*, au.username as admin_username
      FROM withdrawal_approvals wa
      LEFT JOIN admin_users au ON wa.admin_id = au.id
      WHERE wa.withdrawal_request_id = ?
      ORDER BY wa.created_at DESC
    `, [id]);

    res.json({
      success: true,
      withdrawal: withdrawals[0],
      transaction: transactions[0] || null,
      approvals: approvals
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
    const [withdrawals] = await db.execute(
      'SELECT * FROM withdrawal_requests WHERE id = ?',
      [id]
    );

    if (withdrawals.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'Withdrawal not found' 
      });
    }

    const withdrawal = withdrawals[0];
    const oldStatus = withdrawal.status;
    let newStatus = withdrawal.status;

    console.log('📝 Withdrawal current status:', oldStatus);

    switch (action) {
      case 'approve':
        newStatus = 'processing';
        console.log('✅ Approving withdrawal, new status: processing');
        break;
      case 'reject':
        newStatus = 'rejected';
        console.log('❌ Rejecting withdrawal, refunding money');
        // Refund money back to user
        await db.execute(
          'UPDATE users SET balance = balance + ? WHERE id = ?',
          [withdrawal.amount, withdrawal.user_id]
        );
        break;
      case 'processing':
        newStatus = 'processing';
        break;
      case 'completed':
        newStatus = 'completed';
        console.log('🏁 Marking withdrawal as completed');
        break;
    }

    await db.execute('START TRANSACTION');

    try {
      // Update withdrawal status
      await db.execute(
        'UPDATE withdrawal_requests SET status = ?, processed_by = ?, processed_at = NOW() WHERE id = ?',
        [newStatus, adminId, id]
      );

      // Update transaction status
      await db.execute(
        'UPDATE transactions SET status = ? WHERE id = ?',
        [newStatus, withdrawal.transaction_id]
      );

      // Record approval
      await db.execute(
        `INSERT INTO withdrawal_approvals 
         (withdrawal_request_id, admin_id, old_status, new_status, notes, proof_document) 
         VALUES (?, ?, ?, ?, ?, ?)`,
        [id, adminId, oldStatus, newStatus, notes || null, proof_document || null]
      );

      // Log activity
      await db.execute(
        `INSERT INTO admin_activity_logs 
         (admin_id, action_type, description, affected_user_id, affected_transaction_id) 
         VALUES (?, 'withdrawal_action', ?, ?, ?)`,
        [adminId, `${action} withdrawal #${id}`, withdrawal.user_id, withdrawal.transaction_id]
      );

      await db.execute('COMMIT');
      console.log('💾 Transaction committed successfully');

      res.json({
        success: true,
        message: `Withdrawal ${action}d successfully`,
        new_status: newStatus
      });

    } catch (error) {
      await db.execute('ROLLBACK');
      console.error('❌ Transaction rollback:', error);
      throw error;
    }

  } catch (error) {
    console.error('❌ Withdrawal action error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to process withdrawal' 
    });
  }
});

router.get('/users', authenticateAdmin, async (req, res) => {
  try {
    const { search, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    console.log('👥 Fetching users - Search:', search, 'Page:', page);

    let query = 'SELECT id, username, email, wallet_account_number, balance, xp_points, rank, created_at FROM users';
    let countQuery = 'SELECT COUNT(*) as total FROM users';
    const params = [];
    const countParams = [];
    let paramCount = 0;
    let countParamCount = 0;

    if (search) {
      paramCount++;
      query += ` WHERE username ILIKE $${paramCount} OR email ILIKE $${paramCount} OR wallet_account_number ILIKE $${paramCount}`;
      countParamCount++;
      countQuery += ` WHERE username ILIKE $${countParamCount} OR email ILIKE $${countParamCount} OR wallet_account_number ILIKE $${countParamCount}`;
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm, searchTerm);
      countParams.push(searchTerm, searchTerm, searchTerm);
    }

    paramCount++;
    paramCount++;
    query += ` ORDER BY created_at DESC LIMIT $${paramCount - 1} OFFSET $${paramCount}`;
    params.push(parseInt(limit), parseInt(offset));

    const [users] = await db.execute(query, params);
    const [countResult] = await db.execute(countQuery, countParams);

    res.json({
      success: true,
      users,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: parseInt(countResult[0].total),
        totalPages: Math.ceil(parseInt(countResult[0].total) / limit)
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

    const [users] = await db.execute(
      'SELECT * FROM users WHERE id = $1',
      [id]
    );

    if (users.length === 0) {
      console.log('❌ User not found:', id);
      return res.status(404).json({ 
        success: false, 
        message: 'User not found' 
      });
    }

    // Get user transactions
    const [transactions] = await db.execute(
      'SELECT * FROM transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20',
      [id]
    );

    // Get user XP transactions
    const [xpTransactions] = await db.execute(
      'SELECT * FROM xp_transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20',
      [id]
    );

    // Get withdrawal history
    const [withdrawals] = await db.execute(
      'SELECT * FROM withdrawal_requests WHERE user_id = $1 ORDER BY created_at DESC',
      [id]
    );

    console.log('✅ User details fetched successfully');

    res.json({
      success: true,
      user: users[0],
      transactions,
      xp_transactions: xpTransactions,
      withdrawals
    });

  } catch (error) {
    console.error('❌ Get user details error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch user details' 
    });
  }
});
// ==================== USER MANAGEMENT ENDPOINTS ====================

router.put('/users/:id', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;
    const adminId = req.admin.id;

    console.log('✏️ Updating user ID:', id, 'Data:', updateData);

    // Get current user data
    const [users] = await db.execute(
      'SELECT * FROM users WHERE id = $1',
      [id]
    );

    if (users.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const currentUser = users[0];

    // Build update query dynamically
    const updateFields = [];
    const updateValues = [];
    let paramCount = 0;
    
    // Define allowed fields to update
    const allowedFields = [
      'username', 'email', 'firstname', 'lastname', 'rank',
      'account_status', 'xp_points', 'is_admin', 'is_banned',
      'enable_2fa', 'login_alerts', 'session_timeout', 'bio',
      'favorite_games', 'balance'
    ];

    for (const field of allowedFields) {
      if (field in updateData) {
        paramCount++;
        updateFields.push(`${field} = $${paramCount}`);
        updateValues.push(updateData[field]);
      }
    }

    if (updateFields.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No valid fields to update'
      });
    }

    // Add updated_at timestamp
    paramCount++;
    updateFields.push('updated_at = NOW()');
    
    // Add WHERE clause
    paramCount++;
    updateValues.push(id);

    const updateQuery = `
      UPDATE users 
      SET ${updateFields.join(', ')} 
      WHERE id = $${paramCount}
    `;

    await db.execute(updateQuery, updateValues);

    // Log admin activity
    await db.execute(
      `INSERT INTO admin_activity_logs 
       (admin_id, action_type, description, affected_user_id) 
       VALUES ($1, 'user_update', 'Updated user profile', $2)`,
      [adminId, id]
    );

    // Get updated user
    const [updatedUsers] = await db.execute(
      'SELECT * FROM users WHERE id = $1',
      [id]
    );

    console.log('✅ User updated successfully');

    res.json({
      success: true,
      message: 'User updated successfully',
      user: updatedUsers[0]
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
    const [users] = await db.execute(
      'SELECT id, username, is_banned FROM users WHERE id = $1',
      [id]
    );

    if (users.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const currentUser = users[0];

    // Update user - FIXED: boolean values
    await db.execute(
      'UPDATE users SET is_banned = $1, account_status = $2, updated_at = NOW() WHERE id = $3',
      [isBanned, isBanned ? 'suspended' : 'active', id]
    );

    // Log admin activity
    await db.execute(
      `INSERT INTO admin_activity_logs 
       (admin_id, action_type, description, affected_user_id, details) 
       VALUES ($1, $2, $3, $4, $5)`,
      [adminId, 
       'user_ban',
       isBanned ? 'Banned user' : 'Unbanned user',
       id,
       JSON.stringify({ reason, previous_status: currentUser.is_banned ? 'banned' : 'active' })]
    );

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
    const [users] = await db.execute(
      'SELECT id, username, balance FROM users WHERE id = $1',
      [id]
    );

    if (users.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const currentUser = users[0];
    const newBalance = parseFloat(currentUser.balance) + parseFloat(amount);

    // Update balance
    await db.execute(
      'UPDATE users SET balance = $1, updated_at = NOW() WHERE id = $2',
      [newBalance, id]
    );

    // Create transaction record
    const transactionId = uuidv4();
    await db.execute(
      `INSERT INTO transactions 
       (id, user_id, type, amount, status, description, admin_id, previous_balance, new_balance) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        transactionId,
        id,
        amount >= 0 ? 'admin_adjustment_add' : 'admin_adjustment_deduct',
        Math.abs(parseFloat(amount)),
        'completed',
        reason || 'Admin balance adjustment',
        adminId,
        parseFloat(currentUser.balance),
        newBalance
      ]
    );

    // Log admin activity
    await db.execute(
      `INSERT INTO admin_activity_logs 
       (admin_id, action_type, description, affected_user_id, details) 
       VALUES ($1, 'balance_adjustment', 'Adjusted user balance', $2, $3)`,
      [adminId, id, JSON.stringify({
        amount,
        previous_balance: currentUser.balance,
        new_balance: newBalance,
        reason
      })]
    );

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
    const [users] = await db.execute(
      'SELECT id, username, is_admin FROM users WHERE id = $1',
      [id]
    );

    if (users.length === 0) {
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

    // Soft delete - mark as deleted instead of actual deletion
    await db.execute(
      'UPDATE users SET account_status = \'deleted\', is_banned = true, updated_at = NOW() WHERE id = $1',
      [id]
    );

    // Log admin activity
    await db.execute(
      `INSERT INTO admin_activity_logs 
       (admin_id, action_type, description, affected_user_id) 
       VALUES ($1, 'user_delete', 'Deleted user account', $2)`,
      [adminId, id]
    );

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

    const [userStats] = await db.execute(`
      SELECT 
        u.id,
        u.username,
        u.email,
        u.rank,
        u.matches_played,
        u.wins,
        u.losses,
        u.win_rate,
        u.balance,
        u.xp_points,
        u.tournaments_played,
        u.tournaments_won,
        u.created_at,
        u.last_seen,
        u.account_status,
        u.is_banned,
        u.is_admin,
        (SELECT COUNT(*) FROM transactions WHERE user_id = u.id) as total_transactions,
        (SELECT COUNT(*) FROM withdrawal_requests WHERE user_id = u.id) as total_withdrawals,
        (SELECT COUNT(*) FROM matches WHERE (player1_id = u.id OR player2_id = u.id) AND status = 'completed') as completed_matches,
        (SELECT COUNT(*) FROM tournament_participants WHERE user_id = u.id) as tournaments_participated
      FROM users u
      WHERE u.id = $1
    `, [id]);

    if (userStats.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      stats: userStats[0]
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
    
    const [settings] = await db.execute(
      'SELECT * FROM system_settings ORDER BY category, setting_key'
    );

    res.json({
      success: true,
      settings
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

    await db.execute(
      `INSERT INTO system_settings (setting_key, setting_value, updated_by) 
       VALUES (?, ?, ?) 
       ON DUPLICATE KEY UPDATE setting_value = ?, updated_by = ?, updated_at = NOW()`,
      [key, value, adminId, value, adminId]
    );

    // Log activity
    await db.execute(
      `INSERT INTO admin_activity_logs 
       (admin_id, action_type, description) 
       VALUES (?, 'settings_update', 'Updated setting: ${key}')`,
      [adminId]
    );

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

// GET /api/admin/settings/xp-rates - Get XP conversion rates
// GET /api/admin/settings/xp-rates - Get XP conversion rates
router.get('/settings/xp-rates', authenticateAdmin, async (req, res) => {
  try {
    console.log('⚙️ Fetching XP rates settings');
    
    // Get XP rates from xp_rates table - FIXED: PostgreSQL boolean comparison
    const [xpRates] = await db.execute(
      `SELECT currency, xp_per_unit, unit_amount, is_active, description 
       FROM xp_rates 
       WHERE is_active = true OR is_active = 1
       ORDER BY currency`
    );

    // Transform to the format expected by frontend
    const rates = {};
    xpRates.forEach(rate => {
      // Calculate rate: 1 unit of currency = xp_per_unit XP
      const xpPerCurrency = rate.xp_per_unit / rate.unit_amount;
      rates[rate.currency] = parseFloat(xpPerCurrency.toFixed(3));
    });

    // Ensure default currencies exist
    const defaultRates = {
      'NGN': 0.025,  // 25 XP per 1000 NGN = 0.025 XP per 1 NGN
      'USD': 0,      // Disabled by default
      'EUR': 0,      // Disabled by default  
      'GBP': 0       // Disabled by default
    };

    // Merge with existing rates
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

// POST /api/admin/settings/xp-rates/:currency - Update XP rate for currency
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
    
    // Default configuration: 25 XP per unit
    const xp_per_unit = 25;
    const unit_amount = 1000 / xpRate; // Calculate unit amount based on rate
    
    // Update or insert into xp_rates table - FIXED: PostgreSQL syntax
    await db.execute(
      `INSERT INTO xp_rates (currency, xp_per_unit, unit_amount, is_active, description) 
       VALUES ($1, $2, $3, true, $4) 
       ON CONFLICT (currency) 
       DO UPDATE SET 
       xp_per_unit = EXCLUDED.xp_per_unit,
       unit_amount = EXCLUDED.unit_amount,
       updated_at = NOW()`,
      [
        currency, 
        xp_per_unit, 
        unit_amount,
        `${xp_per_unit} XP per ${unit_amount.toFixed(2)} ${currency}`
      ]
    );

    // Also update in system_settings for backward compatibility
    const settingKey = `xp_rate_${currency}`;
    await db.execute(
      `INSERT INTO system_settings (setting_key, setting_value, category, updated_by) 
       VALUES ($1, $2, 'xp_rates', $3) 
       ON CONFLICT (setting_key) 
       DO UPDATE SET setting_value = EXCLUDED.setting_value, 
                     updated_by = EXCLUDED.updated_by, 
                     updated_at = NOW()`,
      [settingKey, rate.toString(), adminId]
    );

    // Log activity
    await db.execute(
      `INSERT INTO admin_activity_logs 
       (admin_id, action_type, description) 
       VALUES ($1, 'settings_update', 'Updated XP rate for ${currency}')`,
      [adminId]
    );

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
// ==================== FRAUD MANAGEMENT ====================
// ==================== FRAUD MANAGEMENT ====================
router.get('/fraud/flags', authenticateAdmin, async (req, res) => {
  try {
    const { status } = req.query;
    console.log('🚨 Fetching fraud flags - Status:', status);

    let query = `
      SELECT ff.*, u.username, u.email, au.username as assigned_admin_name
      FROM fraud_flags ff
      JOIN users u ON ff.user_id = u.id
      LEFT JOIN admin_users au ON ff.assigned_admin_id = au.id
      WHERE 1=1
    `;
    
    const params = [];
    if (status) {
      query += ' AND ff.status = $1';
      params.push(status);
    }
    
    query += ' ORDER BY ff.created_at DESC';

    const result = await db.execute(query, params);
    const flags = result.rows || result[0] || [];

    res.json({
      success: true,
      flags
    });

  } catch (error) {
    console.error('❌ Get fraud flags error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch fraud flags' 
    });
  }
});// ==================== FRAUD MANAGEMENT ENDPOINTS ====================

// 1. GET /api/admin/fraud/stats - Fraud statistics (MUST WORK)
// 1. GET /api/admin/fraud/stats - Fraud statistics (MUST WORK)
// 1. GET /api/admin/fraud/stats - Fraud statistics (MUST WORK)
router.get('/fraud/stats', authenticateAdmin, async (req, res) => {
  try {
    console.log('📊 Admin: Fetching fraud statistics');
    
    // Get fraud flag stats
    const flagStatsResult = await db.execute(`
      SELECT 
        COUNT(*) as total_flags,
        COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_flags,
        COUNT(CASE WHEN status = 'confirmed' THEN 1 END) as confirmed_flags,
        COUNT(CASE WHEN status = 'false_positive' THEN 1 END) as false_positive_flags
      FROM fraud_flags
    `);
    const flagStats = flagStatsResult.rows?.[0] || flagStatsResult[0]?.[0] || {};

    // Get suspicious activities stats
    const activityStatsResult = await db.execute(`
      SELECT 
        COUNT(*) as total_activities,
        COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_activities,
        COUNT(CASE WHEN severity_level IN ('high', 'critical') THEN 1 END) as high_risk_activities
      FROM suspicious_activities
      WHERE created_at >= NOW() - INTERVAL '30 days'
    `);
    const activityStats = activityStatsResult.rows?.[0] || activityStatsResult[0]?.[0] || {};

    // Get user risk stats
    const userStatsResult = await db.execute(`
      SELECT 
        COUNT(*) as total_users,
        COUNT(CASE WHEN risk_score >= 70 THEN 1 END) as high_risk_users,
        COUNT(CASE WHEN risk_score BETWEEN 40 AND 69 THEN 1 END) as medium_risk_users,
        COALESCE(SUM(CASE WHEN risk_score >= 40 THEN balance ELSE 0 END), 0) as amount_at_risk
      FROM users
      WHERE account_status = 'active' AND is_banned = false
    `);
    const userStats = userStatsResult.rows?.[0] || userStatsResult[0]?.[0] || {};

    // Get recent scans
    const recentScansResult = await db.execute(`
      SELECT COUNT(*) as recent_scans 
      FROM fraud_detection_logs 
      WHERE created_at >= NOW() - INTERVAL '7 days'
    `);
    const recentScans = recentScansResult.rows?.[0] || recentScansResult[0]?.[0] || {};

    // Get weekly activity data for chart
    const weeklyDataResult = await db.execute(`
      SELECT 
        DATE(created_at) as date,
        COUNT(*) as count,
        'activities' as type
      FROM suspicious_activities 
      WHERE created_at >= NOW() - INTERVAL '7 days'
      GROUP BY DATE(created_at)
      ORDER BY date
    `);
    const weeklyData = weeklyDataResult.rows || weeklyDataResult[0] || [];

    res.json({
      success: true,
      stats: {
        ...flagStats,
        ...activityStats,
        ...userStats,
        ...recentScans,
        amount_at_risk: userStats.amount_at_risk || 0
      },
      weeklyData: weeklyData,
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
// 2. GET /api/admin/fraud/suspicious-users - Suspicious users (MUST WORK)
// 2. GET /api/admin/fraud/suspicious-users - Suspicious users (MUST WORK)
// 2. GET /api/admin/fraud/suspicious-users - Suspicious users (MUST WORK)
// 2. GET /api/admin/fraud/suspicious-users - Suspicious users (MUST WORK)
router.get('/fraud/suspicious-users', authenticateAdmin, async (req, res) => {
  try {
    const { page = 1, limit = 20, risk_min = 0 } = req.query;
    const offset = (page - 1) * limit;

    console.log('🔍 Admin: Fetching suspicious users - Page:', page, 'Risk min:', risk_min);

    // FIX: Check if last_login_at column exists, use COALESCE with last_seen or created_at
    const usersResult = await db.execute(`
      SELECT 
        u.id,
        u.username,
        u.email,
        u.risk_score,
        u.balance,
        u.created_at,
        COALESCE(u.last_login_at, u.last_seen, u.created_at) as last_activity_time,
        u.account_status,
        u.is_banned,
        COUNT(DISTINCT sa.id) as suspicious_activities_count,
        COUNT(DISTINCT ff.id) as fraud_flags_count,
        MAX(sa.created_at) as last_suspicious_activity
      FROM users u
      LEFT JOIN suspicious_activities sa ON u.id = sa.user_id AND sa.status = 'pending'
      LEFT JOIN fraud_flags ff ON u.id = ff.user_id AND ff.status IN ('pending', 'confirmed')
      WHERE u.risk_score >= $1
      GROUP BY u.id, u.username, u.email, u.risk_score, u.balance, u.created_at, 
               u.last_login_at, u.last_seen, u.account_status, u.is_banned
      ORDER BY u.risk_score DESC, last_suspicious_activity DESC
      LIMIT $2 OFFSET $3
    `, [risk_min, parseInt(limit), parseInt(offset)]);
    
    const users = usersResult.rows || usersResult[0] || [];

    // Get total count
    const countResult = await db.execute(
      'SELECT COUNT(*) as total FROM users WHERE risk_score >= $1',
      [risk_min]
    );
    const total = countResult.rows?.[0]?.total || countResult[0]?.[0]?.total || 0;

    // Format the response
    const formattedUsers = users.map(user => ({
      id: user.id,
      username: user.username,
      email: user.email,
      risk_score: user.risk_score || 0,
      risk_level: (user.risk_score || 0) >= 70 ? 'high' : (user.risk_score || 0) >= 40 ? 'medium' : 'low',
      balance: user.balance,
      account_age: Math.floor((new Date() - new Date(user.created_at)) / (1000 * 60 * 60 * 24)),
      suspicious_activities_count: user.suspicious_activities_count || 0,
      fraud_flags_count: user.fraud_flags_count || 0,
      last_activity: user.last_suspicious_activity || user.last_activity_time,
      account_status: user.account_status,
      is_banned: user.is_banned
    }));

    res.json({
      success: true,
      users: formattedUsers,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: parseInt(total),
        totalPages: Math.ceil(parseInt(total) / limit)
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
// 3. GET /api/admin/fraud/patterns - Get fraud patterns
// 3. GET /api/admin/fraud/patterns - Get fraud patterns
// 3. GET /api/admin/fraud/patterns - Get fraud patterns
// 3. GET /api/admin/fraud/patterns - Get fraud patterns
router.get('/fraud/patterns', authenticateAdmin, async (req, res) => {
  try {
    console.log('🔄 Admin: Fetching fraud patterns');
    
    const patternsResult = await db.execute(`
      SELECT fp.*, au.username as created_by_name
      FROM fraud_patterns fp
      LEFT JOIN admin_users au ON fp.created_by = au.id
      ORDER BY fp.created_at DESC
    `);
    
    const patterns = patternsResult.rows || patternsResult[0] || [];

    // FIX: PostgreSQL JSONB returns as object, not string that needs parsing
    const formattedPatterns = patterns.map(pattern => ({
      ...pattern,
      // If rules is already an object, use it directly. If it's a string, parse it.
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
// 4. POST /api/admin/fraud/scan - Run fraud detection scan
// 4. POST /api/admin/fraud/scan - Run fraud detection scan
router.post('/fraud/scan', authenticateAdmin, async (req, res) => {
  try {
    const { scanType = 'full' } = req.body;
    const adminId = req.admin.id;

    console.log('🔍 Admin: Initiating fraud scan - Type:', scanType, 'Admin:', adminId);

    // Create scan log
    const scanId = uuidv4();
    await db.execute(
      `INSERT INTO fraud_detection_logs (id, scan_type, status, initiated_by) 
       VALUES ($1, $2, 'running', $3)`,
      [scanId, scanType, adminId]
    );

    // Return immediate response and run scan in background
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
// 5. POST /api/admin/fraud/suspicious-activities/:id/review - Review suspicious activity
router.post('/fraud/suspicious-activities/:id/review', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, notes } = req.body;
    const adminId = req.admin.id;

    console.log('📝 Admin: Reviewing suspicious activity:', { id, status, adminId });

    // Validate status
    if (!['reviewed', 'dismissed', 'confirmed'].includes(status)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid status. Must be: reviewed, dismissed, or confirmed' 
      });
    }

    // Check if activity exists
    const [activities] = await db.execute(
      'SELECT * FROM suspicious_activities WHERE id = ?',
      [id]
    );

    if (activities.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'Suspicious activity not found' 
      });
    }

    const activity = activities[0];

    // Update the activity
    await db.execute(
      `UPDATE suspicious_activities 
       SET status = ?, 
           reviewed_by = ?, 
           reviewed_at = NOW(), 
           review_notes = ?,
           updated_at = NOW()
       WHERE id = ?`,
      [status, adminId, notes || null, id]
    );

    // If confirmed as fraud, increase user risk score
    if (status === 'confirmed') {
      await db.execute(
        `UPDATE users 
         SET risk_score = LEAST(risk_score + 20, 100),
             last_risk_assessment = NOW(),
             updated_at = NOW()
         WHERE id = ?`,
        [activity.user_id]
      );
    }

    // Log activity
    await db.execute(
      `INSERT INTO admin_activity_logs 
       (admin_id, action_type, description, affected_user_id) 
       VALUES (?, 'fraud_review', ?, ?)`,
      [adminId, `Reviewed suspicious activity #${id} as ${status}`, activity.user_id]
    );

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
// Helper function for background fraud scan
async function runFraudScan(scanType, adminId, scanId) {
  const startTime = Date.now();
  
  console.log(`🔄 Starting fraud scan ${scanId} - Type: ${scanType}`);

  try {
    let usersChecked = 0;
    let suspiciousFound = 0;
    const triggeredPatterns = [];

    // Get active fraud patterns
    const [patterns] = await db.execute(
      'SELECT * FROM fraud_patterns WHERE is_active = true'
    );

    // Determine which users to scan
    let userQuery = 'SELECT id, username, email, created_at, last_login_at, balance, risk_score FROM users WHERE risk_score < 100';
    let queryParams = [];

    if (scanType === 'targeted') {
      userQuery += ' AND risk_score > 30';
    } else if (scanType === 'recent') {
      userQuery += ' AND created_at >= NOW() - INTERVAL \'7 days\'';
    }

    const [users] = await db.execute(userQuery, queryParams);

    // Scan each user
    for (const user of users) {
      usersChecked++;
      let userSuspicious = false;

      // Check each pattern
      for (const pattern of patterns) {
        try {
          const rules = pattern.rules ? JSON.parse(pattern.rules) : {};
          const isMatch = await checkPattern(user, rules);

          if (isMatch) {
            userSuspicious = true;
            suspiciousFound++;
            triggeredPatterns.push({
              patternId: pattern.id,
              patternName: pattern.pattern_name
            });

            // Record suspicious activity
            await db.execute(
              `INSERT INTO suspicious_activities 
               (user_id, activity_type, severity_level, risk_score, description, metadata) 
               VALUES ($1, $2, $3, $4, $5, $6)`,
              [
                user.id,
                pattern.pattern_type,
                'medium',
                pattern.risk_weight * 10,
                pattern.description || `Detected pattern: ${pattern.pattern_name}`,
                JSON.stringify({
                  pattern: pattern.pattern_name,
                  scan_id: scanId,
                  user_data: {
                    username: user.username,
                    balance: user.balance,
                    account_age_days: Math.floor((new Date() - new Date(user.created_at)) / (1000 * 60 * 60 * 24))
                  }
                })
              ]
            );

            // Update user risk score
            await db.execute(
              `UPDATE users 
               SET risk_score = LEAST(risk_score + $1, 100),
                   last_risk_assessment = NOW()
               WHERE id = $2`,
              [pattern.risk_weight * 5, user.id]
            );
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

    // Update scan log
    await db.execute(
      `UPDATE fraud_detection_logs 
       SET triggered_patterns = $1,
           users_checked = $2,
           suspicious_found = $3,
           scan_duration_ms = $4,
           status = 'completed'
       WHERE id = $5`,
      [JSON.stringify(triggeredPatterns), usersChecked, suspiciousFound, scanDuration, scanId]
    );

    console.log(`✅ Fraud scan completed: ${usersChecked} users checked, ${suspiciousFound} suspicious activities found`);

  } catch (error) {
    console.error('❌ Fraud scan error:', error);
    
    // Update scan log as failed
    try {
      await db.execute(
        `UPDATE fraud_detection_logs SET status = 'failed' WHERE id = $1`,
        [scanId]
      );
    } catch (updateError) {
      console.error('Failed to update scan log:', updateError);
    }
  }
}
// Helper function to check pattern rules
// Helper function to check pattern rules
async function checkPattern(user, rules) {
  if (!rules || typeof rules !== 'object') {
    return false;
  }

  try {
    // Check for rapid account creation (multiple accounts from same IP)
    if (rules.type === 'multiple_accounts') {
      const [accounts] = await db.execute(
        'SELECT COUNT(*) as count FROM users WHERE created_at >= NOW() - INTERVAL $1 HOUR',
        [rules.timeframe || 24]
      );
      return accounts[0].count > (rules.threshold || 3);
    }

    // Check for unusual transaction patterns
    if (rules.type === 'transaction_anomaly') {
      const [transactions] = await db.execute(
        `SELECT COUNT(*) as count, SUM(amount) as total 
         FROM transactions 
         WHERE user_id = $1 AND created_at >= NOW() - INTERVAL $2 HOUR AND status = 'completed'`,
        [user.id, rules.timeframe || 24]
      );
      
      const txCount = transactions[0].count || 0;
      const totalAmount = Math.abs(transactions[0].total || 0);
      
      return txCount > (rules.maxTransactions || 10) || totalAmount > (rules.maxAmount || 100000);
    }

    // Check for login anomalies
    if (rules.type === 'login_anomaly') {
      const [logins] = await db.execute(
        `SELECT COUNT(DISTINCT ip_address) as unique_ips 
         FROM user_logins 
         WHERE user_id = $1 AND login_time >= NOW() - INTERVAL $2 HOUR`,
        [user.id, rules.timeframe || 24]
      );
      
      return logins[0].unique_ips > (rules.maxUniqueIPs || 5);
    }

    // Check account age and activity
    if (rules.type === 'new_account_high_activity') {
      const accountAgeHours = Math.floor((new Date() - new Date(user.created_at)) / (1000 * 60 * 60));
      
      if (accountAgeHours < (rules.maxAgeHours || 24)) {
        const [activityCount] = await db.execute(
          `SELECT COUNT(*) as count 
           FROM matches 
           WHERE (player1_id = $1 OR player2_id = $1) AND created_at >= NOW() - INTERVAL '24 HOUR'`,
          [user.id]
        );
        
        return activityCount[0].count > (rules.minActivities || 10);
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

    let query = `
      SELECT t.*, u.username, u.email, u.wallet_account_number
      FROM transactions t
      JOIN users u ON t.user_id = u.id
      WHERE 1=1
    `;
    
    let countQuery = `
      SELECT COUNT(*) as total 
      FROM transactions t
      JOIN users u ON t.user_id = u.id
      WHERE 1=1
    `;
    
    const params = [];
    const countParams = [];
    let paramCount = 0;
    let countParamCount = 0;

    // Apply filters
    if (type && type !== '') {
      paramCount++;
      countParamCount++;
      query += ` AND t.type = $${paramCount}`;
      countQuery += ` AND t.type = $${countParamCount}`;
      params.push(type);
      countParams.push(type);
    }
    
    if (status && status !== '') {
      paramCount++;
      countParamCount++;
      query += ` AND t.status = $${paramCount}`;
      countQuery += ` AND t.status = $${countParamCount}`;
      params.push(status);
      countParams.push(status);
    }
    
    // Apply search
    if (search) {
      const searchTerm = `%${search}%`;
      paramCount++;
      countParamCount++;
      query += ` AND (t.reference ILIKE $${paramCount} OR u.username ILIKE $${paramCount} OR u.email ILIKE $${paramCount} OR u.wallet_account_number ILIKE $${paramCount})`;
      countQuery += ` AND (t.reference ILIKE $${countParamCount} OR u.username ILIKE $${countParamCount} OR u.email ILIKE $${countParamCount} OR u.wallet_account_number ILIKE $${countParamCount})`;
      params.push(searchTerm, searchTerm, searchTerm, searchTerm);
      countParams.push(searchTerm, searchTerm, searchTerm, searchTerm);
    }
    
    // Order and pagination
    paramCount++;
    paramCount++;
    query += ` ORDER BY t.created_at DESC LIMIT $${paramCount - 1} OFFSET $${paramCount}`;
    params.push(parseInt(limit), parseInt(offset));

    // Execute queries
    const [transactions] = await db.execute(query, params);
    const [countResult] = await db.execute(countQuery, countParams);

    // Log activity
    try {
      await db.execute(
        `INSERT INTO admin_activity_logs 
         (admin_id, action_type, description) 
         VALUES ($1, 'view', 'Viewed transactions list')`,
        [req.admin.id]
      );
    } catch (logError) {
      console.warn('⚠️ Could not log activity:', logError.message);
    }

    console.log('✅ Found', transactions.length, 'transactions');

    res.json({
      success: true,
      transactions,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: parseInt(countResult[0].total),
        totalPages: Math.ceil(parseInt(countResult[0].total) / limit)
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
    
    const [stats] = await db.execute(`
      SELECT 
        (SELECT COUNT(*) FROM transactions) as total,
        (SELECT SUM(amount) FROM transactions WHERE status = 'completed' AND amount > 0) as totalAmount,
        (SELECT COUNT(*) FROM transactions WHERE status = 'pending') as pending,
        (SELECT COUNT(*) FROM transactions WHERE status = 'completed') as completed,
        (SELECT COUNT(*) FROM transactions WHERE status = 'failed') as failed,
        (SELECT COUNT(*) FROM transactions WHERE DATE(created_at) = CURRENT_DATE) as todayCount,
        (SELECT SUM(amount) FROM transactions WHERE DATE(created_at) = CURRENT_DATE AND amount > 0) as todayAmount
    `);

    console.log('✅ Transaction stats fetched:', stats[0]);

    res.json({
      success: true,
      stats: stats[0] || {
        total: 0,
        totalAmount: 0,
        pending: 0,
        completed: 0,
        failed: 0,
        todayCount: 0,
        todayAmount: 0
      }
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

    const [transactions] = await db.execute(`
      SELECT t.*, 
             u.username, 
             u.email,
             u.wallet_account_number
      FROM transactions t
      JOIN users u ON t.user_id = u.id
      WHERE t.id = $1
    `, [id]);

    if (transactions.length === 0) {
      console.log('❌ Transaction not found:', id);
      return res.status(404).json({ 
        success: false, 
        message: 'Transaction not found' 
      });
    }

    const transaction = transactions[0];

    // Get withdrawal request if exists
    let withdrawalRequest = null;
    if (transaction.type === 'withdrawal') {
      const [withdrawals] = await db.execute(
        'SELECT * FROM withdrawal_requests WHERE transaction_id = $1',
        [id]
      );
      withdrawalRequest = withdrawals[0] || null;
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

    // Get current transaction
    const [transactions] = await db.execute(
      'SELECT * FROM transactions WHERE id = $1',
      [id]
    );

    if (transactions.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'Transaction not found' 
      });
    }

    const transaction = transactions[0];
    const oldStatus = transaction.status;

    // FIXED: Use your withTransaction helper
    await db.withTransaction(async (connection) => {
      try {
        // Update transaction status - PostgreSQL version
        // FIXED: PostgreSQL IF() function is CASE WHEN
        await connection.query(
          `UPDATE transactions SET status = $1, 
           completed_at = CASE 
             WHEN status != 'completed' AND $2 = 'completed' THEN NOW() 
             ELSE completed_at 
           END, 
           updated_at = NOW() 
           WHERE id = $3`,
          [status, status, id]
        );

        // Also update withdrawal_requests table if it's a withdrawal
        if (transaction.type === 'withdrawal') {
          await connection.query(
            'UPDATE withdrawal_requests SET status = $1, processed_by = $2, processed_at = NOW() WHERE transaction_id = $3',
            [status === 'completed' ? 'processing' : status, adminId, id]
          );
        }

        // Handle balance adjustments
        if (status === 'completed' && oldStatus !== 'completed') {
          // For deposits: Add to user balance
          if (transaction.type === 'deposit' && transaction.amount > 0) {
            await connection.query(
              'UPDATE users SET balance = balance + $1 WHERE id = $2',
              [transaction.amount, transaction.user_id]
            );
            console.log(`✅ Added ${transaction.amount} to user ${transaction.user_id} balance`);
          }
          // For withdrawals: No balance change needed on completion
        }
        
        // Handle refunds/rejections for withdrawals
        if (transaction.type === 'withdrawal' && (status === 'failed' || status === 'rejected') && oldStatus === 'pending_approval') {
          // Refund back to user (withdrawals have negative amounts, so we add back)
          await connection.query(
            'UPDATE users SET balance = balance + ABS($1) WHERE id = $2',
            [transaction.amount, transaction.user_id]
          );
          console.log(`✅ Refunded ${Math.abs(transaction.amount)} to user ${transaction.user_id} for failed withdrawal`);
        }

        // Log the status change
        await connection.query(
          `INSERT INTO admin_activity_logs 
           (admin_id, action_type, description, affected_user_id, affected_transaction_id) 
           VALUES ($1, 'transaction_status', $2, $3, $4)`,
          [adminId, 
           `Updated transaction #${id} from ${oldStatus} to ${status}`,
           transaction.user_id, 
           id]
        );

        console.log('💾 Transaction status updated successfully');
        
        // Transaction will auto-commit if no error
      } catch (error) {
        console.error('❌ Error within transaction:', error);
        throw error;
      }
    });

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
  let refundResult, refundReference;
  
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const adminId = req.admin.id;

    console.log('💸 Admin: Processing refund for transaction ID:', id);

    // Get transaction (must be a completed deposit)
    const [transactions] = await db.execute(
      'SELECT * FROM transactions WHERE id = $1 AND type = \'deposit\' AND status = \'completed\'',
      [id]
    );

    if (transactions.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'Completed deposit transaction not found' 
      });
    }

    const transaction = transactions[0];

    // Generate reference
    refundReference = `REFUND-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // FIXED: Use your withTransaction helper
    await db.withTransaction(async (connection) => {
      try {
        // Create refund transaction
        const result = await connection.query(
          `INSERT INTO transactions 
           (user_id, amount, currency, type, status, reference, description, external_reference) 
           VALUES ($1, $2, $3, 'refund', 'completed', $4, $5, $6) RETURNING id`,
          [
            transaction.user_id,
            -Math.abs(transaction.amount), // Negative amount for refund
            transaction.currency,
            refundReference,
            reason || 'Admin refund for deposit',
            transaction.reference
          ]
        );

        refundResult = result.rows[0];

        // Deduct from user balance
        await connection.query(
          'UPDATE users SET balance = balance - $1 WHERE id = $2',
          [Math.abs(transaction.amount), transaction.user_id]
        );

        // Log activity
        await connection.query(
          `INSERT INTO admin_activity_logs 
           (admin_id, action_type, description, affected_user_id, affected_transaction_id) 
           VALUES ($1, 'transaction_refund', $2, $3, $4)`,
          [adminId, 
           `Refunded transaction #${id} - ${transaction.amount} ${transaction.currency}`,
           transaction.user_id, 
           id]
        );

        console.log('✅ Refund processed successfully');
      } catch (error) {
        console.error('❌ Error within refund transaction:', error);
        throw error;
      }
    });

    res.json({
      success: true,
      message: 'Refund processed successfully',
      refund_id: refundResult.id,
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

    let query = `
      SELECT m.*, 
             p1.username as player1_username,
             p2.username as player2_username,
             w.username as winner_username
      FROM matches m
      LEFT JOIN users p1 ON m.player1_id = p1.id
      LEFT JOIN users p2 ON m.player2_id = p2.id
      LEFT JOIN users w ON m.winner_id = w.id
      WHERE 1=1
    `;
    
    let countQuery = `
      SELECT COUNT(*) as total 
      FROM matches m
      WHERE 1=1
    `;
    
    const params = [];
    const countParams = [];
    let paramCount = 0;
    let countParamCount = 0;

    // Apply filters
    if (status && status !== '') {
      paramCount++;
      countParamCount++;
      query += ` AND m.status = $${paramCount}`;
      countQuery += ` AND m.status = $${countParamCount}`;
      params.push(status);
      countParams.push(status);
    }
    
    if (game_type && game_type !== '') {
      paramCount++;
      countParamCount++;
      query += ` AND m.game_type = $${paramCount}`;
      countQuery += ` AND m.game_type = $${countParamCount}`;
      params.push(game_type);
      countParams.push(game_type);
    }
    
    // Apply search
    if (search) {
      const searchTerm = `%${search}%`;
      paramCount++;
      countParamCount++;
      query += ` AND (m.id::text ILIKE $${paramCount} OR m.game ILIKE $${paramCount} OR p1.username ILIKE $${paramCount} OR p2.username ILIKE $${paramCount})`;
      countQuery += ` AND (m.id::text ILIKE $${countParamCount} OR m.game ILIKE $${countParamCount})`;
      params.push(searchTerm, searchTerm, searchTerm, searchTerm);
      countParams.push(searchTerm, searchTerm);
    }
    
    // Order and pagination
    paramCount++;
    paramCount++;
    query += ` ORDER BY m.created_at DESC LIMIT $${paramCount - 1} OFFSET $${paramCount}`;
    params.push(parseInt(limit), parseInt(offset));

    // Execute queries
    const [matches] = await db.execute(query, params);
    const [countResult] = await db.execute(countQuery, countParams);

    // Log activity
    try {
      await db.execute(
        `INSERT INTO admin_activity_logs 
         (admin_id, action_type, description) 
         VALUES ($1, 'view', 'Viewed matches list')`,
        [req.admin.id]
      );
    } catch (logError) {
      console.warn('⚠️ Could not log activity:', logError.message);
    }

    console.log('✅ Found', matches.length, 'matches');

    res.json({
      success: true,
      matches,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: parseInt(countResult[0].total),
        totalPages: Math.ceil(parseInt(countResult[0].total) / limit)
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
    
    const [stats] = await db.execute(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'ongoing' THEN 1 ELSE 0 END) as ongoing,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
        COALESCE(SUM(stake_amount), 0) as totalStake,
        SUM(CASE WHEN admin_monitoring = true THEN 1 ELSE 0 END) as adminMonitored,
        COALESCE(SUM(
          CASE 
            WHEN prize_pool_amount > 0 THEN prize_pool_amount
            WHEN custom_prize_pool > 0 THEN custom_prize_pool
            ELSE 0 
          END
        ), 0) as totalPrize
      FROM matches
    `);

    console.log('✅ Match stats fetched:', stats[0]);

    res.json({
      success: true,
      stats: stats[0] || {
        total: 0,
        pending: 0,
        ongoing: 0,
        completed: 0,
        totalStake: 0,
        adminMonitored: 0,
        totalPrize: 0
      }
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

    const [matches] = await db.execute(`
      SELECT m.*, 
             p1.username as player1_username,
             p1.email as player1_email,
             p2.username as player2_username,
             p2.email as player2_email,
             w.username as winner_username
      FROM matches m
      LEFT JOIN users p1 ON m.player1_id = p1.id
      LEFT JOIN users p2 ON m.player2_id = p2.id
      LEFT JOIN users w ON m.winner_id = w.id
      WHERE m.id = $1
    `, [id]);

    if (matches.length === 0) {
      console.log('❌ Match not found:', id);
      return res.status(404).json({ 
        success: false, 
        message: 'Match not found' 
      });
    }

    const match = matches[0];

    // Get disputes if any
    const [disputes] = await db.execute(
      'SELECT * FROM match_disputes WHERE match_id = $1 ORDER BY created_at DESC',
      [id]
    );

    console.log('✅ Match details fetched:', match.id);

    res.json({
      success: true,
      match: match,
      disputes: disputes
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

    // Get current match
    const [matches] = await db.execute(
      'SELECT * FROM matches WHERE id = $1 AND status IN (\'pending\', \'ongoing\')',
      [id]
    );

    if (matches.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'Match not found or cannot be cancelled' 
      });
    }

    const match = matches[0];

    await db.withTransaction(async (connection) => {
      try {
        // Update match status
        await connection.query(
          'UPDATE matches SET status = \'completed\', completed_at = NOW() WHERE id = $1',
          [id]
        );

        // Refund stake amount to players
        if (match.stake_amount > 0) {
          // Refund to player 1
          await connection.query(
            'UPDATE users SET balance = balance + $1 WHERE id = $2',
            [match.stake_amount, match.player1_id]
          );
          
          if (match.player2_id) {
            // Refund to player 2 if exists
            await connection.query(
              'UPDATE users SET balance = balance + $1 WHERE id = $2',
              [match.stake_amount, match.player2_id]
            );
          }
        }

        // Log admin monitoring activity if admin monitoring was enabled
        if (match.admin_monitoring === true) {
          await connection.query(
            `INSERT INTO admin_monitoring_logs 
             (tournament_id, match_id, admin_id, action_type, details, ip_address) 
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
              null, // tournament_id (null for regular matches)
              id,
              adminId,
              'overrode_result',
              JSON.stringify({
                reason: reason,
                action: 'cancelled_by_admin',
                stake_amount: match.stake_amount,
                refunded_to_players: [match.player1_id, match.player2_id].filter(Boolean)
              }),
              req.ip || 'unknown'
            ]
          );
        }

        // Log admin activity
        await connection.query(
          `INSERT INTO admin_activity_logs 
           (admin_id, action_type, description, details) 
           VALUES ($1, 'match_cancellation', $2, $3)`,
          [adminId, 
           `Cancelled match #${id}`,
           JSON.stringify({ 
             reason, 
             stake_amount: match.stake_amount,
             admin_monitoring: match.admin_monitoring,
             final_decision: true // Referee's word is final
           })]
        );

        console.log('✅ Match cancelled successfully');
      } catch (error) {
        console.error('❌ Error within match cancellation transaction:', error);
        throw error;
      }
    });

    res.json({
      success: true,
      message: 'Match cancelled successfully',
      admin_monitoring: match.admin_monitoring === true,
      final_decision: true // Referee's word is final
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

    // Get current match
    const [matches] = await db.execute(
      'SELECT * FROM matches WHERE id = $1 AND status = \'ongoing\'',
      [id]
    );

    if (matches.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'Match not found or not in ongoing status' 
      });
    }

    const match = matches[0];

    await db.withTransaction(async (connection) => {
      try {
        // Update match
        await connection.query(
          'UPDATE matches SET status = \'completed\', winner_id = $1, completed_at = NOW() WHERE id = $2',
          [winnerId, id]
        );

        // Distribute prize if any
        const prizeAmount = match.prize_pool_amount || match.custom_prize_pool || 0;
        if (prizeAmount > 0) {
          // Update user balance
          await connection.query(
            'UPDATE users SET balance = balance + $1 WHERE id = $2',
            [prizeAmount, winnerId]
          );
          
          // Create transaction record
          const reference = `MATCH_PRIZE_${id}_${Date.now()}`;
          await connection.query(
            `INSERT INTO transactions 
             (user_id, type, amount, status, description, reference, currency) 
             VALUES ($1, $2, $3, 'completed', $4, $5, $6)`,
            [
              winnerId, 
              'match_prize', 
              prizeAmount, 
              `Prize for winning match #${id}`,
              reference,
              'NGN'
            ]
          );
          console.log(`✅ Created transaction with reference: ${reference}`);
        }

        // Log admin monitoring activity if admin monitoring was enabled
        if (match.admin_monitoring === true) {
          await connection.query(
            `INSERT INTO admin_monitoring_logs 
             (tournament_id, match_id, admin_id, action_type, details, ip_address) 
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
              null, // tournament_id (null for regular matches)
              id,
              adminId,
              'resolved_dispute',
              JSON.stringify({
                winner_id: winnerId,
                admin_notes: adminNotes,
                stake_amount: match.stake_amount,
                prize_amount: prizeAmount
              }),
              req.ip || 'unknown'
            ]
          );
          console.log('📝 Admin monitoring log created');
        }

        // Log admin activity
        await connection.query(
          `INSERT INTO admin_activity_logs 
           (admin_id, action_type, description, affected_user_id, details) 
           VALUES ($1, 'match_resolution', $2, $3, $4)`,
          [adminId, 
           `Resolved match #${id} - Winner: ${winnerId}`,
           winnerId, 
           JSON.stringify({ 
             adminNotes, 
             prizeAmount,
             admin_monitoring: match.admin_monitoring,
             final_decision: true
           })]
        );

        console.log('✅ Match resolved successfully');
      } catch (error) {
        console.error('❌ Error within match resolution transaction:', error);
        throw error;
      }
    });

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
    const adminId = req.admin.id;
    
    console.log('📝 Admin: Fetching audit logs for match ID:', id);

    // First, verify match exists
    const [matches] = await db.execute(
      'SELECT id FROM matches WHERE id = ?',
      [id]
    );

    if (matches.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'Match not found' 
      });
    }

    // Get admin monitoring logs from admin_monitoring_logs table
    let monitoringLogs = [];
    try {
      const [logs] = await db.execute(`
        SELECT 
          aml.*,
          au.username as admin_username,
          'monitoring' as log_source
        FROM admin_monitoring_logs aml
        LEFT JOIN admin_users au ON aml.admin_id = au.id
        WHERE aml.match_id = ?
        ORDER BY aml.created_at DESC
        LIMIT 50
      `, [id]);
      monitoringLogs = logs;
    } catch (error) {
      console.warn('⚠️ Could not fetch monitoring logs:', error.message);
    }

    // Get related admin activity logs
    let activityLogs = [];
    try {
      const [logs] = await db.execute(`
        SELECT 
          al.*,
          au.username as admin_username,
          'activity' as log_source
        FROM admin_activity_logs al
        LEFT JOIN admin_users au ON al.admin_id = au.id
        WHERE al.description LIKE ? OR al.description LIKE ?
        ORDER BY al.created_at DESC
        LIMIT 50
      `, [`%match #${id}%`, `%Match #${id}%`]);
      activityLogs = logs;
    } catch (error) {
      console.warn('⚠️ Could not fetch activity logs:', error.message);
    }

    // Get match dispute logs if any
    let disputeLogs = [];
    try {
      const [logs] = await db.execute(
        'SELECT * FROM match_disputes WHERE match_id = ? ORDER BY created_at DESC LIMIT 20',
        [id]
      );
      disputeLogs = logs.map(log => ({
        ...log,
        log_source: 'dispute',
        action_type: 'match_dispute',
        details: JSON.stringify(log)
      }));
    } catch (error) {
      console.warn('⚠️ Could not fetch dispute logs:', error.message);
    }

    // Get transaction logs for this match
    let transactionLogs = [];
    try {
      const [logs] = await db.execute(
        `SELECT 
          t.*,
          'transaction' as log_source,
          'match_transaction' as action_type,
          CONCAT('Transaction: ', t.description) as details
        FROM transactions t
        WHERE t.description LIKE ? OR t.reference LIKE ?
        ORDER BY t.created_at DESC
        LIMIT 20`,
        [`%match #${id}%`, `%MATCH_${id}_%`]
      );
      transactionLogs = logs;
    } catch (error) {
      console.warn('⚠️ Could not fetch transaction logs:', error.message);
    }

    // Combine all logs
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
router.get('/matches/stats', authenticateAdmin, async (req, res) => {
  try {
    console.log('📊 Admin: Fetching match statistics');
    
    const [stats] = await db.execute(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'ongoing' THEN 1 ELSE 0 END) as ongoing,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
        COALESCE(SUM(stake_amount), 0) as totalStake,
        SUM(CASE WHEN admin_monitoring = 1 THEN 1 ELSE 0 END) as adminMonitored,
        COALESCE(SUM(
          CASE 
            WHEN prize_pool_amount > 0 THEN prize_pool_amount
            WHEN custom_prize_pool > 0 THEN custom_prize_pool
            ELSE 0 
          END
        ), 0) as totalPrize
      FROM matches
    `);

    console.log('✅ Match stats fetched:', stats[0]);

    res.json({
      success: true,
      stats: stats[0] || {
        total: 0,
        pending: 0,
        ongoing: 0,
        completed: 0,
        totalStake: 0,
        adminMonitored: 0,
        totalPrize: 0
      }
    });

  } catch (error) {
    console.error('❌ Get match stats error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch match statistics'
    });
  }
});
// ==================== TOURNAMENTS MANAGEMENT ====================

// ==================== TOURNAMENTS MANAGEMENT ====================

// GET /api/admin/tournaments - Get all tournaments with filters
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

    let query = `
      SELECT t.*, 
             u.username as creator_name,
             COUNT(DISTINCT tp.id) as current_participants,
             COUNT(DISTINCT CASE WHEN t.type = 'squad' THEN tp.group_id ELSE NULL END) as current_squads,
             COUNT(DISTINCT aml.id) as log_count
      FROM tournaments t
      LEFT JOIN users u ON t.creator_id = u.id
      LEFT JOIN tournament_participants tp ON t.id = tp.tournament_id 
        AND tp.status = 'joined'
      LEFT JOIN admin_monitoring_logs aml ON t.id = aml.tournament_id
      WHERE 1=1
    `;
    
    let countQuery = `
      SELECT COUNT(DISTINCT t.id) as total 
      FROM tournaments t
      LEFT JOIN users u ON t.creator_id = u.id
      WHERE 1=1
    `;
    
    const params = [];
    const countParams = [];
    let paramCount = 0;
    let countParamCount = 0;

    // Apply filters
    if (status && status !== '') {
      paramCount++;
      countParamCount++;
      query += ` AND t.status = $${paramCount}`;
      countQuery += ` AND t.status = $${countParamCount}`;
      params.push(status);
      countParams.push(status);
    }
    
    if (type && type !== '') {
      paramCount++;
      countParamCount++;
      query += ` AND t.type = $${paramCount}`;
      countQuery += ` AND t.type = $${countParamCount}`;
      params.push(type);
      countParams.push(type);
    }
    
    // Apply monitoring filter
    if (monitoring && monitoring !== 'all') {
      if (monitoring === 'monitored') {
        query += ` AND t.admin_monitoring = true`;
        countQuery += ` AND t.admin_monitoring = true`;
      } else if (monitoring === 'not-monitored') {
        query += ` AND (t.admin_monitoring = false OR t.admin_monitoring IS NULL)`;
        countQuery += ` AND (t.admin_monitoring = false OR t.admin_monitoring IS NULL)`;
      }
    }
    
    // Apply search
    if (search && search.trim() !== '') {
      const searchTerm = `%${search.trim()}%`;
      paramCount++;
      countParamCount++;
      query += ` AND (t.name ILIKE $${paramCount} OR t.game ILIKE $${paramCount} OR u.username ILIKE $${paramCount})`;
      countQuery += ` AND (t.name ILIKE $${countParamCount} OR t.game ILIKE $${countParamCount} OR u.username ILIKE $${countParamCount})`;
      params.push(searchTerm, searchTerm, searchTerm);
      countParams.push(searchTerm, searchTerm, searchTerm);
    }
    
    // Group - PostgreSQL requires all selected non-aggregated columns
    query += ` GROUP BY t.id, u.username`;
    
    // Apply sorting
    switch(sort) {
      case 'oldest':
        query += ` ORDER BY t.created_at ASC`;
        break;
      case 'prize_high':
        query += ` ORDER BY (t.prize_pool + t.custom_prize_pool) DESC`;
        break;
      case 'prize_low':
        query += ` ORDER BY (t.prize_pool + t.custom_prize_pool) ASC`;
        break;
      case 'participants_high':
        query += ` ORDER BY current_participants DESC`;
        break;
      case 'participants_low':
        query += ` ORDER BY current_participants ASC`;
        break;
      case 'newest':
      default:
        query += ` ORDER BY t.created_at DESC`;
    }
    
    // Add pagination
    paramCount++;
    paramCount++;
    query += ` LIMIT $${paramCount - 1} OFFSET $${paramCount}`;
    params.push(parseInt(limit), parseInt(offset));

    // Execute queries
    const [tournaments] = await db.execute(query, params);
    const [countResult] = await db.execute(countQuery, countParams);

    // Log activity
    try {
      await db.execute(
        `INSERT INTO admin_activity_logs 
         (admin_id, action_type, description) 
         VALUES ($1, 'view', 'Viewed tournaments list')`,
        [req.admin.id]
      );
    } catch (logError) {
      console.warn('⚠️ Could not log activity:', logError.message);
    }

    console.log('✅ Found', tournaments.length, 'tournaments');

    res.json({
      success: true,
      tournaments: tournaments.map(t => ({
        ...t,
        entry_fee: t.xp_entry_fee,
        current_participants: t.current_participants || 0,
        current_squads: t.current_squads || 0,
        log_count: t.log_count || 0
      })),
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: parseInt(countResult[0]?.total || 0),
        totalPages: Math.ceil(parseInt(countResult[0]?.total || 0) / limit)
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

// GET /api/admin/tournaments/stats - Get tournament statistics
router.get('/tournaments/stats', authenticateAdmin, async (req, res) => {
  try {
    console.log('📊 Admin: Fetching tournament statistics');
    
    const [stats] = await db.execute(`
      SELECT 
        COUNT(*) as totalTournaments,
        SUM(CASE WHEN status = 'upcoming' THEN 1 ELSE 0 END) as upcomingTournaments,
        SUM(CASE WHEN status = 'ongoing' THEN 1 ELSE 0 END) as ongoingTournaments,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completedTournaments,
        SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelledTournaments,
        COALESCE(SUM(prize_pool + custom_prize_pool), 0) as totalPrizePool
      FROM tournaments
    `);

    console.log('✅ Tournament stats fetched:', stats[0]);

    res.json({
      success: true,
      stats: stats[0] || {
        totalTournaments: 0,
        upcomingTournaments: 0,
        ongoingTournaments: 0,
        completedTournaments: 0,
        cancelledTournaments: 0,
        totalPrizePool: 0
      }
    });

  } catch (error) {
    console.error('❌ Get tournament stats error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch tournament statistics'
    });
  }
});

// GET /api/admin/tournaments/:id/participants - Get tournament participants
router.get('/tournaments/:id/participants', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    console.log('👥 Admin: Fetching participants for tournament:', id);

    const [participants] = await db.execute(`
      SELECT tp.*, 
             u.username,
             u.email,
             u.rank,
             u.profile_pic,
             g.name as group_name
      FROM tournament_participants tp
      JOIN users u ON tp.user_id = u.id
      LEFT JOIN groups g ON tp.group_id = g.id
      WHERE tp.tournament_id = $1 AND tp.status = 'joined'
      ORDER BY tp.created_at ASC
    `, [id]);

    console.log('✅ Found', participants.length, 'participants');

    res.json({
      success: true,
      participants: participants || [],
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

// POST /api/admin/tournaments/:id/cancel - Cancel tournament
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

    // Get tournament details
    const [tournaments] = await db.execute(
      'SELECT * FROM tournaments WHERE id = $1 AND status IN (\'upcoming\', \'ongoing\')',
      [id]
    );

    if (tournaments.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'Tournament not found or cannot be cancelled' 
      });
    }

    const tournament = tournaments[0];

    await db.withTransaction(async (connection) => {
      try {
        // Update tournament status
        await connection.query(
          'UPDATE tournaments SET status = \'cancelled\', completed_at = NOW() WHERE id = $1',
          [id]
        );

        // Refund XP entry fees if any
        if (tournament.xp_entry_fee > 0) {
          const { rows: participants } = await connection.query(`
            SELECT tp.user_id 
            FROM tournament_participants tp
            WHERE tp.tournament_id = $1 AND tp.status = 'joined'
          `, [id]);

          for (const participant of participants) {
            await connection.query(
              'UPDATE users SET xp_points = xp_points + $1 WHERE id = $2',
              [tournament.xp_entry_fee, participant.user_id]
            );

            // Record XP refund
            await connection.query(`
              INSERT INTO xp_transactions 
              (user_id, tournament_id, amount, type, description, created_at)
              VALUES ($1, $2, $3, 'refund', $4, NOW())
            `, [
              participant.user_id,
              id,
              tournament.xp_entry_fee,
              `XP refund for cancelled tournament: ${tournament.name}`
            ]);
          }

          console.log(`✅ Refunded XP to ${participants.length} participants`);
        }

        // Notify participants
        const { rows: participants } = await connection.query(`
          SELECT DISTINCT user_id FROM tournament_participants 
          WHERE tournament_id = $1 AND status = 'joined'
        `, [id]);

        for (const participant of participants) {
          await connection.query(`
            INSERT INTO notifications 
            (user_id, message, type, status, tournament_id, created_at)
            VALUES ($1, $2, 'system', 'unread', $3, NOW())
          `, [
            participant.user_id,
            `Tournament "${tournament.name}" has been cancelled by admin. ${tournament.xp_entry_fee > 0 ? 'Your entry fee has been refunded.' : ''}`,
            id
          ]);
        }

        // Log admin activity
        await connection.query(`
          INSERT INTO admin_activity_logs 
          (admin_id, action_type, description, details) 
          VALUES ($1, 'tournament_cancellation', $2, $3)
        `, [
          adminId,
          `Cancelled tournament #${id}`,
          JSON.stringify({
            reason,
            tournament_name: tournament.name,
            entry_fee: tournament.xp_entry_fee,
            participants_notified: participants.length
          })
        ]);

        console.log('✅ Tournament cancelled successfully');
      } catch (error) {
        console.error('❌ Error within cancellation transaction:', error);
        throw error;
      }
    });

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

// POST /api/admin/tournaments/:id/distribute-prizes - Distribute tournament prizes
router.post('/tournaments/:id/distribute-prizes', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const adminId = req.admin.id;

    console.log('💰 Admin: Distributing prizes for tournament:', id);

    // Get tournament details
    const [tournaments] = await db.execute(
      'SELECT * FROM tournaments WHERE id = $1 AND status = \'completed\'',
      [id]
    );

    if (tournaments.length === 0) {
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

    // Check if prizes already distributed
    const { rows: existingPrizes } = await db.execute(`
      SELECT 1 FROM xp_transactions 
      WHERE tournament_id = $1 AND type = 'earned' AND description LIKE '%prize%'
      LIMIT 1
    `, [id]);

    if (existingPrizes.length > 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'Prizes already distributed for this tournament' 
      });
    }

    await db.withTransaction(async (connection) => {
      try {
        const totalPrize = tournament.prize_pool || tournament.custom_prize_pool || 0;
        
        if (totalPrize > 0) {
          // Award XP to winner
          await connection.query(
            'UPDATE users SET xp_points = xp_points + $1 WHERE id = $2',
            [totalPrize, tournament.winner_id]
          );

          // Record XP prize transaction
          await connection.query(`
            INSERT INTO xp_transactions 
            (user_id, tournament_id, amount, type, description, created_at)
            VALUES ($1, $2, $3, 'earned', $4, NOW())
          `, [
            tournament.winner_id,
            id,
            totalPrize,
            `Tournament prize: ${tournament.name}`
          ]);

          console.log(`💰 Awarded ${totalPrize} XP to winner ${tournament.winner_id}`);
        }

        // Log admin activity
        await connection.query(`
          INSERT INTO admin_activity_logs 
          (admin_id, action_type, description, details) 
          VALUES ($1, 'prize_distribution', $2, $3)
        `, [
          adminId,
          `Distributed prizes for tournament #${id}`,
          JSON.stringify({
            tournament_name: tournament.name,
            winner_id: tournament.winner_id,
            prize_amount: totalPrize,
            prize_type: tournament.prize_pool_option
          })
        ]);

        console.log('✅ Prizes distributed successfully');
      } catch (error) {
        console.error('❌ Error within prize distribution transaction:', error);
        throw error;
      }
    });

    res.json({
      success: true,
      message: 'Prizes distributed successfully',
      prize_distributed: tournament.prize_pool || tournament.custom_prize_pool || 0,
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

// DELETE /api/admin/tournaments/:id/participants/:userId - Remove participant
router.delete('/tournaments/:id/participants/:userId', authenticateAdmin, async (req, res) => {
  try {
    const { id, userId } = req.params;
    const adminId = req.admin.id;
    const { reason } = req.body;

    console.log('👢 Admin: Removing participant:', { tournamentId: id, userId, adminId });

    // Check if tournament exists
    const [tournaments] = await db.execute(
      'SELECT * FROM tournaments WHERE id = $1 AND status = \'upcoming\'',
      [id]
    );

    if (tournaments.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'Tournament not found or already started' 
      });
    }

    const tournament = tournaments[0];

    // Check if participant exists
    const [participants] = await db.execute(`
      SELECT tp.*, u.username 
      FROM tournament_participants tp
      JOIN users u ON tp.user_id = u.id
      WHERE tp.tournament_id = $1 AND tp.user_id = $2 AND tp.status = 'joined'
    `, [id, userId]);

    if (participants.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'Participant not found in tournament' 
      });
    }

    const participant = participants[0];

    await db.withTransaction(async (connection) => {
      try {
        // Update participant status
        await connection.query(
          'UPDATE tournament_participants SET status = \'declined\' WHERE tournament_id = $1 AND user_id = $2',
          [id, userId]
        );

        // Refund entry fee if any
        if (tournament.xp_entry_fee > 0) {
          await connection.query(
            'UPDATE users SET xp_points = xp_points + $1 WHERE id = $2',
            [tournament.xp_entry_fee, userId]
          );

          // Record XP refund
          await connection.query(`
            INSERT INTO xp_transactions 
            (user_id, tournament_id, amount, type, description, created_at)
            VALUES ($1, $2, $3, 'refund', $4, NOW())
          `, [
            userId,
            id,
            tournament.xp_entry_fee,
            `XP refund for removal from tournament: ${tournament.name}`
          ]);
        }

        // Notify user
        await connection.query(`
          INSERT INTO notifications 
          (user_id, message, type, status, tournament_id, created_at)
          VALUES ($1, $2, 'system', 'unread', $3, NOW())
        `, [
          userId,
          `You have been removed from tournament "${tournament.name}" by admin. ${tournament.xp_entry_fee > 0 ? 'Your entry fee has been refunded.' : ''}`,
          id
        ]);

        // Log admin activity
        await connection.query(`
          INSERT INTO admin_activity_logs 
          (admin_id, action_type, description, details) 
          VALUES ($1, 'participant_removal', $2, $3)
        `, [
          adminId,
          `Removed participant ${userId} from tournament #${id}`,
          JSON.stringify({
            reason,
            participant_username: participant.username,
            tournament_name: tournament.name,
            entry_fee_refunded: tournament.xp_entry_fee
          })
        ]);

        console.log('✅ Participant removed successfully');
      } catch (error) {
        console.error('❌ Error within removal transaction:', error);
        throw error;
      }
    });

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

// GET /api/admin/tournaments/:id/matches - Get tournament matches
router.get('/tournaments/:id/matches', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    console.log('🎮 Admin: Fetching matches for tournament:', id);

    const [matches] = await db.execute(`
      SELECT tm.*,
             p1.username as player1_username,
             p2.username as player2_username,
             w.username as winner_username
      FROM tournament_matches tm
      LEFT JOIN users p1 ON tm.player1_id = p1.id
      LEFT JOIN users p2 ON tm.player2_id = p2.id
      LEFT JOIN users w ON tm.winner_id = w.id
      WHERE tm.tournament_id = $1
      ORDER BY tm.round_number ASC, tm.id ASC
    `, [id]);

    console.log('✅ Found', matches.length, 'matches');

    res.json({
      success: true,
      matches: matches || [],
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

// GET /api/admin/monitored-tournaments - Get tournaments with admin monitoring
router.get('/monitored-tournaments', authenticateAdmin, async (req, res) => {
  try {
    console.log('🛡️ Admin: Fetching monitored tournaments');

    const [tournaments] = await db.execute(`
      SELECT t.*, 
             u.username as creator_name,
             COUNT(DISTINCT tp.id) as participants_count,
             COUNT(DISTINCT aml.id) as log_count
      FROM tournaments t
      JOIN users u ON t.creator_id = u.id
      LEFT JOIN tournament_participants tp ON t.id = tp.tournament_id 
        AND tp.status = 'joined'
      LEFT JOIN admin_monitoring_logs aml ON t.id = aml.tournament_id
      WHERE t.admin_monitoring = true
      GROUP BY t.id, u.username
      ORDER BY t.created_at DESC
    `);

    res.json({
      success: true,
      tournaments: tournaments || [],
      count: tournaments.length
    });

  } catch (error) {
    console.error('❌ Get monitored tournaments error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch monitored tournaments'
    });
  }
});

// GET /api/admin/tournaments/:id/monitoring-logs - Get monitoring logs for tournament
router.get('/tournaments/:id/monitoring-logs', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    console.log('📝 Admin: Fetching monitoring logs for tournament:', id);

    const [logs] = await db.execute(`
      SELECT aml.*, 
             u.username as admin_name,
             t.name as tournament_name
      FROM admin_monitoring_logs aml
      JOIN users u ON aml.admin_id = u.id
      JOIN tournaments t ON aml.tournament_id = t.id
      WHERE aml.tournament_id = $1
      ORDER BY aml.created_at DESC
      LIMIT 100
    `, [id]);

    res.json({
      success: true,
      logs: logs || [],
      tournament_id: id,
      count: logs.length
    });

  } catch (error) {
    console.error('❌ Get monitoring logs error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch monitoring logs'
    });
  }
});

// GET /api/admin/tournaments/:id/monitoring-stats - Get monitoring statistics
router.get('/tournaments/:id/monitoring-stats', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const [stats] = await db.execute(`
      SELECT 
        COUNT(*) as total_actions,
        SUM(CASE WHEN action_type = 'resolved_dispute' THEN 1 ELSE 0 END) as disputes_resolved,
        SUM(CASE WHEN action_type = 'overrode_result' THEN 1 ELSE 0 END) as results_overridden,
        SUM(CASE WHEN action_type = 'distributed_prize' THEN 1 ELSE 0 END) as prizes_distributed,
        SUM(CASE WHEN action_type = 'warned_player' THEN 1 ELSE 0 END) as warnings_issued,
        COUNT(DISTINCT admin_id) as unique_admins,
        MIN(created_at) as first_action,
        MAX(created_at) as last_action
      FROM admin_monitoring_logs 
      WHERE tournament_id = $1
    `, [id]);

    res.json({
      success: true,
      stats: stats[0] || {
        total_actions: 0,
        disputes_resolved: 0,
        results_overridden: 0,
        prizes_distributed: 0,
        warnings_issued: 0,
        unique_admins: 0
      },
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
// Add to admin.js after existing endpoints

// ==================== SYSTEM MAINTENANCE ENDPOINTS ====================

// GET /api/admin/maintenance/health - System health check
router.get('/maintenance/health', authenticateAdmin, async (req, res) => {
  try {
    console.log('🔧 Checking system health');
    
    // Check database connection
    let dbStatus = 'disconnected';
    try {
      await db.execute('SELECT 1');
      dbStatus = 'connected';
    } catch (dbError) {
      console.error('Database connection error:', dbError);
    }

    // Check API status (simple ping)
    const apiStatus = 'online'; // Assuming API is running
    
    // Check cache status (simplified)
    const cacheStatus = 'active';
    
    // Simulate server load check
    const loads = ['low', 'normal', 'high'];
    const serverLoad = loads[Math.floor(Math.random() * loads.length)];

    res.json({
      success: true,
      health: {
        api_status: apiStatus,
        database_status: dbStatus,
        cache_status: cacheStatus,
        server_load: serverLoad,
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

    // Get all active users
    const [users] = await db.execute(
      'SELECT id FROM users WHERE account_status = \'active\' AND is_banned = false'
    );

    let usersNotified = 0;
    
    // Create notifications for all users
    for (const user of users) {
      try {
        await db.execute(
          `INSERT INTO notifications 
           (user_id, sender_id, message, type, status, created_at) 
           VALUES ($1, $2, $3, 'system', 'unread', NOW())`,
          [user.id, adminId, message]
        );
        usersNotified++;
      } catch (error) {
        console.warn(`⚠️ Could not notify user ${user.id}:`, error.message);
      }
    }

    // Log activity
    await db.execute(
      `INSERT INTO admin_activity_logs 
       (admin_id, action_type, description) 
       VALUES ($1, 'broadcast', 'Sent in-app message to all users')`,
      [adminId]
    );

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
// GET /api/admin/games - Get all games
router.get('/games', authenticateAdmin, async (req, res) => {
  try {
    const { category, is_active, search = '' } = req.query;
    
    console.log('🎮 Admin: Fetching games - Category:', category, 'Search:', search);

    let query = 'SELECT * FROM games WHERE 1=1';
    const params = [];
    let paramCount = 0;

    if (category && category !== 'all') {
      paramCount++;
      query += ` AND category = $${paramCount}`;
      params.push(category);
    }
    
    if (is_active !== undefined) {
      paramCount++;
      query += ` AND is_active = $${paramCount}`;
      params.push(is_active === 'true');
    }
    
    if (search.trim() !== '') {
      paramCount++;
      query += ` AND name ILIKE $${paramCount}`;
      params.push(`%${search.trim()}%`);
    }
    
    query += ' ORDER BY name ASC';

    const [games] = await db.execute(query, params);

    res.json({
      success: true,
      games,
      count: games.length
    });

  } catch (error) {
    console.error('❌ Get games error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch games' 
    });
  }
});
// POST /api/admin/games - Add new game
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

    // Check if game already exists
    const [existingGames] = await db.execute(
      'SELECT id FROM games WHERE name = $1',
      [name.trim()]
    );

    if (existingGames.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Game already exists'
      });
    }

    // Insert new game
    const result = await db.execute(
      `INSERT INTO games 
       (name, category, min_players, max_players, platforms, description, icon_url) 
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [
        name.trim(),
        category,
        parseInt(min_players),
        parseInt(max_players),
        platforms,
        description,
        icon_url
      ]
    );

    // Log activity
    await db.execute(
      `INSERT INTO admin_activity_logs 
       (admin_id, action_type, description) 
       VALUES ($1, 'game_add', $2)`,
      [adminId, `Added new game: ${name}`]
    );

    res.json({
      success: true,
      message: 'Game added successfully',
      game_id: result.rows[0].id
    });

  } catch (error) {
    console.error('❌ Add game error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to add game' 
    });
  }
});

// PUT /api/admin/games/:id - Update game
router.put('/games/:id', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const gameData = req.body;
    const adminId = req.admin.id;

    console.log('🎮 Admin: Updating game ID:', id, 'Data:', gameData);

    // Check if game exists
    const [games] = await db.execute(
      'SELECT id, name FROM games WHERE id = $1',
      [id]
    );

    if (games.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Game not found'
      });
    }

    // Build update query dynamically
    const updateFields = [];
    const updateValues = [];
    let paramCount = 0;
    
    const allowedFields = [
      'name', 'category', 'min_players', 'max_players', 
      'platforms', 'description', 'icon_url', 'is_active'
    ];

    for (const field of allowedFields) {
      if (field in gameData) {
        paramCount++;
        updateFields.push(`${field} = $${paramCount}`);
        updateValues.push(gameData[field]);
      }
    }

    if (updateFields.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No valid fields to update'
      });
    }

    paramCount++;
    updateFields.push('updated_at = NOW()');
    updateValues.push(id);

    const updateQuery = `
      UPDATE games 
      SET ${updateFields.join(', ')}
      WHERE id = $${paramCount}
    `;

    await db.execute(updateQuery, updateValues);

    // Log activity
    await db.execute(
      `INSERT INTO admin_activity_logs 
       (admin_id, action_type, description) 
       VALUES ($1, 'game_update', $2)`,
      [adminId, `Updated game #${id}`]
    );

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

// DELETE /api/admin/games/:id - Delete game
router.delete('/games/:id', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const adminId = req.admin.id;

    console.log('🎮 Admin: Deleting game ID:', id);

    // Check if game exists
    const [games] = await db.execute(
      'SELECT name FROM games WHERE id = $1',
      [id]
    );

    if (games.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Game not found'
      });
    }

    const gameName = games[0].name;

    // Soft delete (deactivate) instead of hard delete
    await db.execute(
      'UPDATE games SET is_active = false, updated_at = NOW() WHERE id = $1',
      [id]
    );

    // Log activity
    await db.execute(
      `INSERT INTO admin_activity_logs 
       (admin_id, action_type, description) 
       VALUES ($1, 'game_delete', $2)`,
      [adminId, `Deleted game: ${gameName}`]
    );

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
// POST /api/admin/factory-reset - Reset all settings to defaults
router.post('/factory-reset', authenticateAdmin, async (req, res) => {
  try {
    const adminId = req.admin.id;
    const { backup = true } = req.body;

    console.log('🏭 Admin performing factory reset', { backup, adminId });

    // Create backup if requested - FIXED: PostgreSQL version
    if (backup) {
      // Get all settings first
      const [settings] = await db.execute('SELECT setting_key, setting_value FROM system_settings');
      
      // Create JSON object manually for PostgreSQL
      const settingsData = {};
      settings.forEach(setting => {
        settingsData[setting.setting_key] = setting.setting_value;
      });
      
      await db.execute(
        `INSERT INTO settings_backup (admin_id, settings_data) 
         VALUES ($1, $2)`,
        [adminId, JSON.stringify(settingsData)]
      );
      console.log('✅ Settings backup created');
    }

    // Define default settings
    const defaultSettings = {
      'platformName': 'Xperience',
      'platformCurrency': 'NGN',
      'sessionTimeout': '15',
      'minDepositAmount': '500',
      'maxDepositAmount': '100000',
      'minWithdrawalAmount': '1000',
      'maxWithdrawalAmount': '100000',
      'withdrawalLimitDaily': '1',
      'withdrawalLimitWeekly': '3',
      'withdrawalLimitMonthly': '11',
      'enableUSD': 'false',
      'enableEUR': 'false',
      'enableGBP': 'false',
      'enableRegistration': 'true',
      'requireEmailVerification': 'false',
      'defaultUserRank': 'E',
      'maxLoginAttempts': '5',
      'requireProfileCompletion': 'true',
      'allowMultipleDevices': 'false',
      'minMatchStakePercentage': '15',
      'emailNotifications': 'true',
      'pushNotifications': 'true',
      'adminAlerts': 'true',
      'systemAnnouncements': 'true',
      'enable2FA': 'false',
      'requireTransactionPIN': 'true',
      'enforceStrongPasswords': 'true',
      'sessionEncryption': 'true',
      'ipWhitelisting': 'false',
      'maintenanceMode': 'false',
      'backupFrequency': 'daily',
      'logRetentionDays': '30',
      'cacheEnabled': 'true'
    };

    // Clear all existing settings
    await db.execute('DELETE FROM system_settings');

    // Insert default settings
    for (const [key, value] of Object.entries(defaultSettings)) {
      await db.execute(
        `INSERT INTO system_settings (setting_key, setting_value, updated_by) 
         VALUES ($1, $2, $3)`,
        [key, value, adminId]
      );
    }

    // Reset XP rates to defaults
    await db.execute('DELETE FROM xp_rates');
    const defaultXpRates = [
      ['NGN', 25, 1000, 1, '25 XP per 1000 NGN'],
      ['USD', 25, 1.20, 0, '25 XP per 1.2 USD'],
      ['EUR', 25, 1.10, 0, '25 XP per 1.1 EUR'],
      ['GBP', 25, 0.90, 0, '25 XP per 0.9 GBP']
    ];

    for (const rate of defaultXpRates) {
      await db.execute(
        `INSERT INTO xp_rates (currency, xp_per_unit, unit_amount, is_active, description) 
         VALUES ($1, $2, $3, $4, $5)`,
        rate
      );
    }

    // Log activity
    await db.execute(
      `INSERT INTO admin_activity_logs 
       (admin_id, action_type, description) 
       VALUES ($1, 'factory_reset', 'Performed factory reset of all settings')`,
      [adminId]
    );

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

// POST /api/admin/factory-reset/undo - Restore from last backup
router.post('/factory-reset/undo', authenticateAdmin, async (req, res) => {
  try {
    const adminId = req.admin.id;

    console.log('↩️ Admin undoing factory reset', { adminId });

    // Get latest backup
    const [backups] = await db.execute(
      'SELECT * FROM settings_backup ORDER BY created_at DESC LIMIT 1'
    );

    if (backups.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'No backup found' 
      });
    }

    const backup = backups[0];
    const settingsData = JSON.parse(backup.settings_data);

    // Clear current settings
    await db.execute('DELETE FROM system_settings');

    // Restore from backup
    for (const [key, value] of Object.entries(settingsData)) {
      await db.execute(
        `INSERT INTO system_settings (setting_key, setting_value, updated_by) 
         VALUES (?, ?, ?)`,
        [key, value, adminId]
      );
    }

    // Log activity
    await db.execute(
      `INSERT INTO admin_activity_logs 
       (admin_id, action_type, description) 
       VALUES (?, 'factory_reset_undo', 'Restored settings from backup')`,
      [adminId]
    );

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

// GET /api/admin/email/templates - Get email templates
router.get('/email/templates', authenticateAdmin, async (req, res) => {
  try {
    console.log('📧 Fetching email templates');
    
    const [templates] = await db.execute(
      'SELECT * FROM email_templates ORDER BY name'
    );

    res.json({
      success: true,
      templates
    });

  } catch (error) {
    console.error('❌ Get email templates error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch email templates' 
    });
  }
});

// POST /api/admin/email/templates - Create email template
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

    await db.execute(
      `INSERT INTO email_templates (name, subject, content, variables) 
       VALUES (?, ?, ?, ?)`,
      [name, subject, content, variables ? JSON.stringify(variables) : null]
    );

    // Log activity
    await db.execute(
      `INSERT INTO admin_activity_logs 
       (admin_id, action_type, description) 
       VALUES (?, 'email_template_create', ?)`,
      [adminId, `Created email template: ${name}`]
    );

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

// POST /api/admin/send-email-notification - Send email to users (FIXED VERSION)
router.post('/send-email-notification', authenticateAdmin, async (req, res) => {
  try {
    const adminId = req.admin.id;
    
    console.log('📧 BACKEND FIXED: Received email notification request');
    console.log('📧 BACKEND FIXED: Request body type:', typeof req.body);
    console.log('📧 BACKEND FIXED: Request body:', req.body);
    
    // Handle both FormData and JSON
    let subject, message, recipientType, filters, recipients;
    
    if (typeof req.body === 'object' && !Array.isArray(req.body)) {
      // JSON request
      subject = req.body.subject || '';
      message = req.body.message || '';
      recipientType = req.body.recipientType || req.body.sendTo || 'all';
      recipients = Array.isArray(req.body.recipients) ? req.body.recipients : [];
      
      // Handle filters - could be object or JSON string
      if (typeof req.body.filters === 'string') {
        try {
          filters = JSON.parse(req.body.filters);
        } catch (e) {
          console.log('⚠️ Could not parse filters as JSON, using empty object');
          filters = {};
        }
      } else if (typeof req.body.filters === 'object') {
        filters = req.body.filters || {};
      } else {
        filters = {};
      }
    } else {
      // Invalid request
      console.log('❌ Invalid request body type');
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid request format' 
      });
    }
    
    console.log('📧 BACKEND FIXED: Parsed fields:', { 
      subject, 
      message, 
      recipientType,
      hasSubject: !!subject && subject.trim() !== '',
      hasMessage: !!message && message.trim() !== '',
      filterCount: Object.keys(filters).length,
      recipientCount: recipients.length 
    });

    // Validate required fields
    if (!subject || subject.trim() === '') {
      console.log('❌ BACKEND: Validation failed: subject is empty');
      return res.status(400).json({ 
        success: false, 
        message: 'Subject is required' 
      });
    }

    if (!message || message.trim() === '') {
      console.log('❌ BACKEND: Validation failed: message is empty');
      return res.status(400).json({ 
        success: false, 
        message: 'Message is required' 
      });
    }

    // Clean the values
    const cleanSubject = subject.trim();
    const cleanMessage = message.trim();

    let userEmails = [];
    let userIds = [];
    
    // Get users based on recipient type
    if (recipientType === 'all') {
      // Get all active users
      const [users] = await db.execute(
        'SELECT id, email FROM users WHERE account_status = "active" AND is_banned = 0'
      );
      userEmails = users.map(user => user.email);
      userIds = users.map(user => user.id);
      console.log(`📧 BACKEND: Found ${users.length} active users for "all"`);
    } else if (recipientType === 'selected' && recipients.length > 0) {
      // Get selected users
      const placeholders = recipients.map(() => '?').join(',');
      const [users] = await db.execute(
        `SELECT id, email FROM users WHERE id IN (${placeholders})`,
        recipients
      );
      userEmails = users.map(user => user.email);
      userIds = users.map(user => user.id);
      console.log(`📧 BACKEND: Found ${users.length} selected users`);
    } else if (recipientType === 'filtered') {
      // Build query based on filters
      let query = 'SELECT id, email FROM users WHERE account_status = "active" AND is_banned = 0';
      const params = [];
      
      if (filters.rank && filters.rank.trim() !== '') {
        query += ' AND rank = ?';
        params.push(filters.rank.trim());
      }
      
      if (filters.status && filters.status !== 'active') {
        query += ' AND account_status = ?';
        params.push(filters.status);
      }
      
      if (filters.minBalance) {
        query += ' AND balance >= ?';
        params.push(parseFloat(filters.minBalance));
      }
      
      if (filters.maxBalance) {
        query += ' AND balance <= ?';
        params.push(parseFloat(filters.maxBalance));
      }
      
      const [users] = await db.execute(query, params);
      userEmails = users.map(user => user.email);
      userIds = users.map(user => user.id);
      console.log(`📧 BACKEND: Found ${users.length} filtered users`);
    } else {
      console.log('❌ BACKEND: Invalid recipient type or no recipients');
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid recipient selection' 
      });
    }

    if (userEmails.length === 0) {
      console.log('❌ BACKEND: No recipients found');
      return res.status(400).json({ 
        success: false, 
        message: 'No recipients found' 
      });
    }

    console.log(`📧 BACKEND: Will send to ${userEmails.length} users`);

    // Send emails
    const emailResults = await emailService.sendToUsers(
      userEmails,
      cleanSubject,
      cleanMessage
    );

    // Count successful emails
    const sentCount = emailResults.filter(r => r.success).length;
    const failedCount = emailResults.filter(r => !r.success).length;

    // Store emails in queue for tracking
    if (userEmails.length > 0) {
      try {
        // Insert all emails in batch
        for (const email of userEmails) {
          await db.execute(
            `INSERT INTO email_queue 
             (recipient_email, subject, content, status, created_at) 
             VALUES (?, ?, ?, ?, NOW())`,
            [email, cleanSubject, cleanMessage, sentCount > 0 ? 'sent' : 'failed']
          );
        }
        console.log('📧 BACKEND: Emails logged to queue');
      } catch (dbError) {
        console.warn('⚠️ BACKEND: Could not log emails to queue:', dbError.message);
      }
    }

    // ============ KEEP BROADCAST MESSAGE FEATURE ============
    // Create in-app notifications for all users (system broadcast)
    const broadcastMessage = `SYSTEM: ${cleanSubject} - ${cleanMessage.substring(0, 200)}${cleanMessage.length > 200 ? '...' : ''}`;
    let broadcastCount = 0;
    
    if (userIds.length > 0) {
      for (const userId of userIds) {
        try {
          await db.execute(
            `INSERT INTO notifications 
             (user_id, sender_id, message, type, status, created_at) 
             VALUES (?, ?, ?, 'system', 'unread', NOW())`,
            [userId, adminId, broadcastMessage]
          );
          broadcastCount++;
        } catch (error) {
          console.warn(`⚠️ BACKEND: Could not create in-app notification for user ${userId}:`, error.message);
        }
      }
    }
    // ============ END BROADCAST FEATURE ============

    // Log activity
    await db.execute(
      `INSERT INTO admin_activity_logs 
       (admin_id, action_type, description) 
       VALUES (?, 'email_notification', ?)`,
      [adminId, `Sent email to ${sentCount} users: ${cleanSubject} (${failedCount} failed)`]
    );

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
    console.error('❌ BACKEND: Error stack:', error.stack);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to send email notification',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});
// GET /api/admin/email/queue - Get email queue
router.get('/email/queue', authenticateAdmin, async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    console.log('📧 Fetching email queue - Status:', status, 'Page:', page);

    let query = 'SELECT * FROM email_queue WHERE 1=1';
    let countQuery = 'SELECT COUNT(*) as total FROM email_queue WHERE 1=1';
    const params = [];
    const countParams = [];

    if (status && status !== 'all') {
      query += ' AND status = ?';
      countQuery += ' AND status = ?';
      params.push(status);
      countParams.push(status);
    }

    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));

    const [queue] = await db.execute(query, params);
    const [countResult] = await db.execute(countQuery, countParams);

    res.json({
      success: true,
      queue,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: countResult[0].total,
        totalPages: Math.ceil(countResult[0].total / limit)
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

// POST /api/admin/email/test - Test email configuration
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

    // Log activity
    await db.execute(
      `INSERT INTO admin_activity_logs 
       (admin_id, action_type, description) 
       VALUES (?, 'email_test', 'Tested email configuration')`,
      [adminId]
    );

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

// GET /api/admin/groups/stats - Get groups statistics
// GET /api/admin/groups/stats - Get groups statistics
router.get('/groups/stats', authenticateAdmin, async (req, res) => {
  try {
    console.log('📊 Admin: Fetching groups statistics');

    const result = await db.execute(`
      SELECT 
        COUNT(*) as total_groups,
        COUNT(CASE WHEN visibility = 'public' THEN 1 END) as public_groups,
        COUNT(CASE WHEN visibility = 'private' THEN 1 END) as private_groups,
        COALESCE(SUM(
          (SELECT COUNT(*) FROM group_members gm WHERE gm.group_id = g.id AND gm.status = 'joined')
        ), 0) as total_members,
        COUNT(CASE WHEN created_at >= NOW() - INTERVAL '7 days' THEN 1 END) as recent_groups
      FROM groups g
    `);

    // Handle result format (rows vs result[0])
    const stats = result.rows ? result.rows[0] : (result[0] ? result[0][0] : null);

    res.json({
      success: true,
      stats: stats || {
        total_groups: 0,
        public_groups: 0,
        private_groups: 0,
        total_members: 0,
        recent_groups: 0
      }
    });

  } catch (error) {
    console.error('❌ Get groups stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch groups statistics'
    });
  }
});
// GET /api/admin/groups - Get all groups (UPDATED WITH FILTER)
router.get('/groups', authenticateAdmin, async (req, res) => {
  try {
    const { search = '', page = 1, limit = 20, visibility = '' } = req.query;
    const offset = (page - 1) * limit;
    const adminId = req.admin.id;

    console.log('👥 Admin: Fetching groups - Search:', search, 'Page:', page, 'Visibility:', visibility);

    // Build query with search AND visibility filter
    let query = `
      SELECT 
        g.*,
        u.username as creator_username,
        u.email as creator_email,
        COUNT(DISTINCT gm.user_id) as member_count
      FROM groups g
      LEFT JOIN users u ON g.creator_id = u.id
      LEFT JOIN group_members gm ON g.id = gm.group_id AND gm.status = 'joined'
      WHERE 1=1
    `;
    
    let countQuery = 'SELECT COUNT(*) as total FROM groups g WHERE 1=1';
    const params = [];
    const countParams = [];
    let paramCount = 0;
    let countParamCount = 0;

    // Search filter
    if (search && search.trim() !== '') {
      const searchTerm = `%${search.trim()}%`;
      paramCount++;
      countParamCount++;
      query += ` AND (g.name ILIKE $${paramCount} OR g.description ILIKE $${paramCount} OR g.game_specialty ILIKE $${paramCount})`;
      countQuery += ` AND (g.name ILIKE $${countParamCount} OR g.description ILIKE $${countParamCount} OR g.game_specialty ILIKE $${countParamCount})`;
      params.push(searchTerm);
      countParams.push(searchTerm);
    }

    // Visibility filter
    if (visibility && visibility !== '') {
      paramCount++;
      countParamCount++;
      query += ` AND g.visibility = $${paramCount}`;
      countQuery += ` AND g.visibility = $${countParamCount}`;
      params.push(visibility);
      countParams.push(visibility);
    }

    // Group and paginate
    query += ` GROUP BY g.id, u.username, u.email ORDER BY g.created_at DESC LIMIT $${paramCount + 1}`;
    params.push(parseInt(limit));
    
    query += ` OFFSET $${paramCount + 2}`;
    params.push(parseInt(offset));

    // Execute queries using db.execute()
    const groupsResult = await db.execute(query, params);
    const countResult = await db.execute(countQuery, countParams);

    // Handle result format
    const groups = groupsResult.rows || groupsResult[0] || [];
    const totalCount = countResult.rows ? countResult.rows[0]?.total : (countResult[0] ? countResult[0][0]?.total : 0);

    // Format groups for frontend
    const formattedGroups = groups.map(group => ({
      id: group.id,
      name: group.name,
      description: group.description || '',
      game_specialty: group.game_specialty || '',
      visibility: group.visibility || 'public',
      max_members: group.max_members || 20,
      creator_id: group.creator_id,
      creator: {
        username: group.creator_username,
        email: group.creator_email
      },
      current_members: group.member_count || 0,
      created_at: group.created_at,
      updated_at: group.updated_at
    }));

    // Log activity
    try {
      await db.execute(
        `INSERT INTO admin_activity_logs 
         (admin_id, action_type, description, created_at) 
         VALUES ($1, 'view', 'Viewed groups list', NOW())`,
        [adminId]
      );
    } catch (logError) {
      console.warn('⚠️ Could not log activity:', logError.message);
    }

    res.json({
      success: true,
      groups: formattedGroups,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: parseInt(totalCount) || 0,
        totalPages: Math.ceil((parseInt(totalCount) || 0) / limit)
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
// GET /api/admin/groups/:id - Get group details
// GET /api/admin/groups/:id - Get group details
router.get('/groups/:id', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const adminId = req.admin.id;

    console.log('👥 Admin: Fetching group details for ID:', id);

    // Get group details
    const result = await db.execute(`
      SELECT 
        g.*,
        u.username as creator_username,
        u.email as creator_email,
        COUNT(DISTINCT gm.user_id) as member_count
      FROM groups g
      LEFT JOIN users u ON g.creator_id = u.id
      LEFT JOIN group_members gm ON g.id = gm.group_id AND gm.status = 'joined'
      WHERE g.id = $1
      GROUP BY g.id, u.username, u.email
    `, [id]);

    const groups = result.rows || result[0] || [];

    if (groups.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Group not found'
      });
    }

    const group = groups[0];

    // Format response
    const formattedGroup = {
      id: group.id,
      name: group.name,
      description: group.description || '',
      game_specialty: group.game_specialty || '',
      visibility: group.visibility || 'public',
      max_members: group.max_members || 20,
      creator_id: group.creator_id,
      creator: {
        username: group.creator_username,
        email: group.creator_email
      },
      current_members: group.member_count || 0,
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
// GET /api/admin/groups/:id/members - Get group members
router.get('/groups/:id/members', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const adminId = req.admin.id;

    console.log('👥 Admin: Fetching members for group ID:', id);

    // Verify group exists
    const groupResult = await db.execute(
      'SELECT id, name FROM groups WHERE id = $1',
      [id]
    );
    
    const groups = groupResult.rows || groupResult[0] || [];

    if (groups.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Group not found'
      });
    }

    // Get group members
    const membersResult = await db.execute(`
      SELECT 
        gm.*,
        u.username,
        u.email,
        u.profile_pic,
        u.rank,
        u.xp_points,
        u.created_at as user_created_at
      FROM group_members gm
      JOIN users u ON gm.user_id = u.id
      WHERE gm.group_id = $1 AND gm.status = 'joined'
      ORDER BY 
        CASE WHEN gm.role = 'admin' THEN 1 ELSE 2 END,
        gm.joined_at ASC
    `, [id]);
    
    const members = membersResult.rows || membersResult[0] || [];

    // Format members for frontend
    const formattedMembers = members.map(member => ({
      user_id: member.user_id,
      group_id: member.group_id,
      role: member.role || 'member',
      status: member.status,
      joined_at: member.joined_at,
      user: {
        username: member.username,
        email: member.email,
        profile_pic: member.profile_pic,
        rank: member.rank,
        xp_points: member.xp_points,
        created_at: member.user_created_at
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
// DELETE /api/admin/groups/:id - Delete group
// DELETE /api/admin/groups/:id - Delete group
router.delete('/groups/:id', authenticateAdmin, async (req, res) => {
  let connection;
  try {
    const { id } = req.params;
    const { reason = 'Deleted by admin' } = req.body;
    const adminId = req.admin.id;

    console.log('🗑️ Admin: Deleting group ID:', id, 'Reason:', reason);

    // Verify group exists
    const groupResult = await db.execute(
      'SELECT * FROM groups WHERE id = $1',
      [id]
    );
    
    const groups = groupResult.rows || groupResult[0] || [];

    if (groups.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Group not found'
      });
    }

    const group = groups[0];

    // Check if group has members
    const memberCountResult = await db.execute(
      'SELECT COUNT(*) as count FROM group_members WHERE group_id = $1',
      [id]
    );
    
    const memberCount = memberCountResult.rows ? 
      memberCountResult.rows[0]?.count : 
      (memberCountResult[0] ? memberCountResult[0][0]?.count : 0);

    // Use your database's transaction helper or direct connection
    // Since you're using db.execute, let's assume it handles transactions
    await db.execute('BEGIN');
    
    try {
      // 1. Remove all group members (if any)
      if (parseInt(memberCount) > 0) {
        await db.execute(
          'DELETE FROM group_members WHERE group_id = $1',
          [id]
        );
      }

      // 2. Delete group
      await db.execute(
        'DELETE FROM groups WHERE id = $1',
        [id]
      );

      // 3. Notify creator that group was deleted
      try {
        await db.execute(
          `INSERT INTO notifications 
           (user_id, message, type, status, created_at) 
           VALUES ($1, $2, 'system', 'unread', NOW())`,
          [
            group.creator_id,
            `Your group "${group.name}" has been deleted by admin. Reason: ${reason}`
          ]
        );
      } catch (notifyError) {
        console.warn('⚠️ Could not notify group creator:', notifyError.message);
      }

      // 4. Log admin activity
      await db.execute(
        `INSERT INTO admin_activity_logs 
         (admin_id, action_type, description, details, created_at) 
         VALUES ($1, 'group_delete', $2, $3, NOW())`,
        [
          adminId,
          `Deleted group: ${group.name}`,
          JSON.stringify({
            group_id: id,
            group_name: group.name,
            members_removed: parseInt(memberCount),
            reason: reason
          })
        ]
      );

      await db.execute('COMMIT');
      console.log('✅ Group deleted successfully');
    } catch (error) {
      await db.execute('ROLLBACK');
      console.error('❌ Error within delete transaction:', error);
      throw error;
    }

    res.json({
      success: true,
      message: 'Group deleted successfully',
      group_name: group.name,
      members_removed: parseInt(memberCount)
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
// PUT /api/admin/groups/:id - Update group
// DELETE /api/admin/groups/:id - Delete group
router.delete('/groups/:id', authenticateAdmin, async (req, res) => {
  let connection;
  try {
    const { id } = req.params;
    const { reason = 'Deleted by admin' } = req.body;
    const adminId = req.admin.id;

    console.log('🗑️ Admin: Deleting group ID:', id, 'Reason:', reason);

    // Verify group exists
    const groupResult = await db.execute(
      'SELECT * FROM groups WHERE id = $1',
      [id]
    );
    
    const groups = groupResult.rows || groupResult[0] || [];

    if (groups.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Group not found'
      });
    }

    const group = groups[0];

    // Check if group has members
    const memberCountResult = await db.execute(
      'SELECT COUNT(*) as count FROM group_members WHERE group_id = $1',
      [id]
    );
    
    const memberCount = memberCountResult.rows ? 
      memberCountResult.rows[0]?.count : 
      (memberCountResult[0] ? memberCountResult[0][0]?.count : 0);

    // Use your database's transaction helper or direct connection
    // Since you're using db.execute, let's assume it handles transactions
    await db.execute('BEGIN');
    
    try {
      // 1. Remove all group members (if any)
      if (parseInt(memberCount) > 0) {
        await db.execute(
          'DELETE FROM group_members WHERE group_id = $1',
          [id]
        );
      }

      // 2. Delete group
      await db.execute(
        'DELETE FROM groups WHERE id = $1',
        [id]
      );

      // 3. Notify creator that group was deleted
      try {
        await db.execute(
          `INSERT INTO notifications 
           (user_id, message, type, status, created_at) 
           VALUES ($1, $2, 'system', 'unread', NOW())`,
          [
            group.creator_id,
            `Your group "${group.name}" has been deleted by admin. Reason: ${reason}`
          ]
        );
      } catch (notifyError) {
        console.warn('⚠️ Could not notify group creator:', notifyError.message);
      }

      // 4. Log admin activity
      await db.execute(
        `INSERT INTO admin_activity_logs 
         (admin_id, action_type, description, details, created_at) 
         VALUES ($1, 'group_delete', $2, $3, NOW())`,
        [
          adminId,
          `Deleted group: ${group.name}`,
          JSON.stringify({
            group_id: id,
            group_name: group.name,
            members_removed: parseInt(memberCount),
            reason: reason
          })
        ]
      );

      await db.execute('COMMIT');
      console.log('✅ Group deleted successfully');
    } catch (error) {
      await db.execute('ROLLBACK');
      console.error('❌ Error within delete transaction:', error);
      throw error;
    }

    res.json({
      success: true,
      message: 'Group deleted successfully',
      group_name: group.name,
      members_removed: parseInt(memberCount)
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
// DELETE /api/admin/groups/:groupId/members/:userId - Remove member from group
router.delete('/groups/:groupId/members/:userId', authenticateAdmin, async (req, res) => {
  try {
    const { groupId, userId } = req.params;
    const { reason = 'Removed by admin' } = req.body;
    const adminId = req.admin.id;

    console.log('👥 Admin: Removing member', userId, 'from group', groupId);

    // Check if member exists
    const membersResult = await db.execute(`
      SELECT gm.*, u.username, g.name as group_name
      FROM group_members gm
      JOIN users u ON gm.user_id = u.id
      JOIN groups g ON gm.group_id = g.id
      WHERE gm.group_id = $1 AND gm.user_id = $2
    `, [groupId, userId]);
    
    const members = membersResult.rows || membersResult[0] || [];

    if (members.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Member not found in group'
      });
    }

    const member = members[0];

    // Don't allow removing the creator
    const groupInfoResult = await db.execute(
      'SELECT creator_id FROM groups WHERE id = $1',
      [groupId]
    );
    
    const groupInfo = groupInfoResult.rows ? 
      groupInfoResult.rows[0] : 
      (groupInfoResult[0] ? groupInfoResult[0][0] : null);

    if (parseInt(groupInfo.creator_id) === parseInt(userId)) {
      return res.status(400).json({
        success: false,
        message: 'Cannot remove group creator'
      });
    }

    await db.execute('BEGIN');
    
    try {
      // Remove member
      await db.execute(
        'DELETE FROM group_members WHERE group_id = $1 AND user_id = $2',
        [groupId, userId]
      );

      // Notify the removed user
      try {
        await db.execute(
          `INSERT INTO notifications 
           (user_id, message, type, status, created_at) 
           VALUES ($1, $2, 'system', 'unread', NOW())`,
          [
            userId,
            `You have been removed from group "${member.group_name}" by admin. Reason: ${reason}`
          ]
        );
      } catch (notifyError) {
        console.warn('⚠️ Could not notify removed member:', notifyError.message);
      }

      // Log activity
      await db.execute(
        `INSERT INTO admin_activity_logs 
         (admin_id, action_type, description, affected_user_id, details, created_at) 
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        [
          adminId,
          'group_member_remove',
          `Removed member from group: ${member.group_name}`,
          userId,
          JSON.stringify({
            group_id: groupId,
            group_name: member.group_name,
            member_username: member.username,
            reason: reason
          })
        ]
      );

      await db.execute('COMMIT');
    } catch (error) {
      await db.execute('ROLLBACK');
      console.error('❌ Error within remove member transaction:', error);
      throw error;
    }

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
// GET /api/admin/groups/test - Test endpoint
router.get('/groups/test', authenticateAdmin, async (req, res) => {
  try {
    // Test database connection
    const { rows: groupsCount } = await db.query('SELECT COUNT(*) as count FROM groups');
    const { rows: membersCount } = await db.query('SELECT COUNT(*) as count FROM group_members WHERE status = \'joined\'');
    
    res.json({
      success: true,
      message: 'Groups API is working',
      test_data: {
        groups_count: parseInt(groupsCount[0].count),
        members_count: parseInt(membersCount[0].count),
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

// GET /api/admin/analytics - Get analytics data (FIXED for your database)
// GET /api/admin/analytics - Get analytics data (FIXED for your database)
router.get('/analytics', authenticateAdmin, async (req, res) => {
  try {
    const { period = '30d' } = req.query;
    console.log('📈 Admin: Fetching analytics for period:', period);

    // Calculate date range
    let intervalValue = '';
    let format = 'YYYY-MM-DD';
    
    switch(period) {
      case '7d':
        intervalValue = '7 days';
        break;
      case '30d':
        intervalValue = '30 days';
        break;
      case '90d':
        intervalValue = '90 days';
        format = 'IYYY-IW'; // Weekly format (ISO year and week)
        break;
      case '1y':
        intervalValue = '1 year';
        format = 'YYYY-MM'; // Monthly format
        break;
      case 'all':
        intervalValue = '100 years'; // All time
        break;
      default:
        intervalValue = '30 days';
    }

    // ==================== 1. FINANCIAL ANALYTICS ====================

    // Get Total Deposits (Revenue)
    let totalDeposits = 0;
    try {
      const depositsResult = await db.execute(`
        SELECT COALESCE(SUM(amount), 0) as total_deposits
        FROM transactions 
        WHERE type = 'deposit' 
          AND status = 'completed'
          AND created_at >= NOW() - INTERVAL '${intervalValue}'
      `);
      const deposits = depositsResult.rows ? depositsResult.rows[0] : (depositsResult[0] ? depositsResult[0][0] : {});
      totalDeposits = parseFloat(deposits.total_deposits) || 0;
    } catch (error) {
      console.warn('⚠️ Deposits query error:', error.message);
    }

    // Get Total Withdrawals
    let totalWithdrawals = 0;
    try {
      const withdrawalsResult = await db.execute(`
        SELECT COALESCE(SUM(amount), 0) as total_withdrawals
        FROM transactions 
        WHERE type = 'withdrawal' 
          AND status = 'completed'
          AND created_at >= NOW() - INTERVAL '${intervalValue}'
      `);
      const withdrawals = withdrawalsResult.rows ? withdrawalsResult.rows[0] : (withdrawalsResult[0] ? withdrawalsResult[0][0] : {});
      totalWithdrawals = parseFloat(withdrawals.total_withdrawals) || 0;
    } catch (error) {
      console.warn('⚠️ Withdrawals query error:', error.message);
    }

    // ==================== 2. PLATFORM FEES (15%) ====================

    // Get Match Stakes (for platform fee calculation - 15%)
    let matchStakes = 0;
    let matchPlatformFees = 0;
    try {
      const matchStakesResult = await db.execute(`
        SELECT COALESCE(SUM(stake_amount), 0) as total_stake
        FROM matches 
        WHERE status = 'completed'
          AND created_at >= NOW() - INTERVAL '${intervalValue}'
          AND stake_amount > 0
      `);
      const stakes = matchStakesResult.rows ? matchStakesResult.rows[0] : (matchStakesResult[0] ? matchStakesResult[0][0] : {});
      matchStakes = parseFloat(stakes.total_stake) || 0;
      matchPlatformFees = matchStakes * 0.15;
    } catch (error) {
      console.warn('⚠️ Match stakes query error:', error.message);
    }

    // Get Tournament Entry Fees (for platform fee calculation - 15%)
    let tournamentFees = 0;
    let tournamentPlatformFees = 0;
    try {
      const tournamentFeesResult = await db.execute(`
        SELECT COALESCE(SUM(xp_entry_fee), 0) as total_entry_fees
        FROM tournaments 
        WHERE status IN ('ongoing', 'completed')
          AND created_at >= NOW() - INTERVAL '${intervalValue}'
          AND xp_entry_fee > 0
      `);
      const fees = tournamentFeesResult.rows ? tournamentFeesResult.rows[0] : (tournamentFeesResult[0] ? tournamentFeesResult[0][0] : {});
      tournamentFees = parseFloat(fees.total_entry_fees) || 0;
      tournamentPlatformFees = tournamentFees * 0.15;
    } catch (error) {
      console.warn('⚠️ Tournament fees query error:', error.message);
    }

    // Calculate Total Platform Fees
    const totalPlatformFees = matchPlatformFees + tournamentPlatformFees;

    // ==================== 3. USER STATISTICS ====================

    let userStats = { total_users: 0, active_users_7d: 0 };
    try {
      // Get total users (created in period)
      const totalUsersResult = await db.execute(`
        SELECT COUNT(*) as total_users
        FROM users 
        WHERE created_at >= NOW() - INTERVAL '${intervalValue}'
      `);
      const totalUsers = totalUsersResult.rows ? totalUsersResult.rows[0] : (totalUsersResult[0] ? totalUsersResult[0][0] : {});

      // Get active users (users with any activity in last 7 days)
      const activeUsersResult = await db.execute(`
        SELECT COUNT(DISTINCT user_id) as active_users
        FROM (
          SELECT player1_id as user_id FROM matches WHERE created_at >= NOW() - INTERVAL '7 days'
          UNION
          SELECT player2_id as user_id FROM matches WHERE created_at >= NOW() - INTERVAL '7 days' AND player2_id IS NOT NULL
          UNION
          SELECT user_id FROM transactions WHERE created_at >= NOW() - INTERVAL '7 days'
          UNION
          SELECT creator_id as user_id FROM tournaments WHERE created_at >= NOW() - INTERVAL '7 days'
          UNION
          SELECT user_id FROM group_members WHERE created_at >= NOW() - INTERVAL '7 days'
        ) as recent_activity
      `);
      const activeUsers = activeUsersResult.rows ? activeUsersResult.rows[0] : (activeUsersResult[0] ? activeUsersResult[0][0] : {});

      userStats = {
        total_users: parseInt(totalUsers.total_users) || 0,
        active_users_7d: parseInt(activeUsers.active_users) || 0
      };
    } catch (error) {
      console.warn('⚠️ User stats query error:', error.message);
    }

    // ==================== 4. MATCH STATISTICS ====================

    let matchStats = { total_matches: 0, unique_players: 0 };
    try {
      const matchStatsResult = await db.execute(`
        SELECT 
          COUNT(*) as total_matches,
          COUNT(DISTINCT player1_id) + COUNT(DISTINCT player2_id) as unique_players
        FROM matches 
        WHERE created_at >= NOW() - INTERVAL '${intervalValue}'
      `);
      const stats = matchStatsResult.rows ? matchStatsResult.rows[0] : (matchStatsResult[0] ? matchStatsResult[0][0] : {});
      matchStats = {
        total_matches: parseInt(stats.total_matches) || 0,
        unique_players: parseInt(stats.unique_players) || 0
      };
    } catch (error) {
      console.warn('⚠️ Match stats query error:', error.message);
    }

    // ==================== 5. TOURNAMENT STATISTICS ====================

    let tournamentStats = { total_tournaments: 0, ongoing_tournaments: 0 };
    try {
      const tournamentStatsResult = await db.execute(`
        SELECT 
          COUNT(*) as total_tournaments,
          COUNT(CASE WHEN status = 'ongoing' THEN 1 END) as ongoing_tournaments
        FROM tournaments 
        WHERE created_at >= NOW() - INTERVAL '${intervalValue}'
      `);
      const stats = tournamentStatsResult.rows ? tournamentStatsResult.rows[0] : (tournamentStatsResult[0] ? tournamentStatsResult[0][0] : {});
      tournamentStats = {
        total_tournaments: parseInt(stats.total_tournaments) || 0,
        ongoing_tournaments: parseInt(stats.ongoing_tournaments) || 0
      };
    } catch (error) {
      console.warn('⚠️ Tournament stats query error:', error.message);
    }

    // ==================== 6. PENDING WITHDRAWALS ====================

    let pendingWithdrawals = { count: 0, total_amount: 0 };
    try {
      const pendingResult = await db.execute(`
        SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as total_amount
        FROM withdrawal_requests 
        WHERE status = 'pending'
          AND created_at >= NOW() - INTERVAL '${intervalValue}'
      `);
      const pending = pendingResult.rows ? pendingResult.rows[0] : (pendingResult[0] ? pendingResult[0][0] : {});
      pendingWithdrawals = {
        count: parseInt(pending.count) || 0,
        total_amount: parseFloat(pending.total_amount) || 0
      };
    } catch (error) {
      console.warn('⚠️ Pending withdrawals query error:', error.message);
    }

    // ==================== 7. REVENUE TREND ====================

    let revenueTrend = [];
    try {
      const trendResult = await db.execute(`
        SELECT 
          TO_CHAR(created_at, $1) as period,
          SUM(CASE WHEN type = 'deposit' THEN amount ELSE 0 END) as deposits,
          SUM(CASE WHEN type = 'withdrawal' THEN amount ELSE 0 END) as withdrawals
        FROM transactions 
        WHERE status = 'completed'
          AND created_at >= NOW() - INTERVAL '${intervalValue}'
        GROUP BY TO_CHAR(created_at, $1)
        ORDER BY period
      `, [format]);
      revenueTrend = trendResult.rows || trendResult[0] || [];
    } catch (error) {
      console.warn('⚠️ Revenue trend query error:', error.message);
    }

    // ==================== 8. TOP GAMES ====================

    let topGames = [];
    try {
      const gamesResult = await db.execute(`
        SELECT 
          COALESCE(game, 'Unknown') as game,
          COUNT(*) as match_count,
          COALESCE(SUM(stake_amount), 0) as total_stake
        FROM matches 
        WHERE created_at >= NOW() - INTERVAL '${intervalValue}'
        GROUP BY COALESCE(game, 'Unknown')
        ORDER BY match_count DESC
        LIMIT 5
      `);
      topGames = gamesResult.rows || gamesResult[0] || [];
    } catch (error) {
      console.warn('⚠️ Top games query error:', error.message);
    }

    // ==================== 9. CALCULATE NET REVENUE ====================

    const netRevenue = totalDeposits - totalWithdrawals + totalPlatformFees;

    // ==================== 10. GROUP STATISTICS ====================

    let groupStats = { total_groups: 0, active_groups: 0 };
    try {
      const groupsResult = await db.execute(`
        SELECT 
          COUNT(*) as total_groups,
          COUNT(DISTINCT gm.group_id) as active_groups
        FROM groups g
        LEFT JOIN group_members gm ON g.id = gm.group_id 
          AND gm.created_at >= NOW() - INTERVAL '7 days'
        WHERE g.created_at >= NOW() - INTERVAL '${intervalValue}'
      `);
      const groups = groupsResult.rows ? groupsResult.rows[0] : (groupsResult[0] ? groupsResult[0][0] : {});
      groupStats = {
        total_groups: parseInt(groups.total_groups) || 0,
        active_groups: parseInt(groups.active_groups) || 0
      };
    } catch (error) {
      console.warn('⚠️ Group stats query error:', error.message);
    }

    // ==================== 11. RESPONSE ====================

    res.json({
      success: true,
      analytics: {
        period,
        summary: {
          // Financial
          total_deposits: totalDeposits,
          total_withdrawals: totalWithdrawals,
          net_revenue: netRevenue,
          
          // Platform Fees
          platform_fees: totalPlatformFees,
          match_stakes: matchStakes,
          tournament_fees: tournamentFees,
          
          // User Statistics
          total_users: userStats.total_users,
          active_users: userStats.active_users_7d,
          
          // Activity Statistics
          total_matches: matchStats.total_matches,
          total_tournaments: tournamentStats.total_tournaments,
          ongoing_tournaments: tournamentStats.ongoing_tournaments,
          total_groups: groupStats.total_groups,
          active_groups: groupStats.active_groups,
          
          // Withdrawals
          pending_withdrawals: pendingWithdrawals.count,
          pending_withdrawal_amount: pendingWithdrawals.total_amount,
          
          // Other
          unique_players: matchStats.unique_players
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
// GET /api/admin/reports/history - Get report history
// GET /api/admin/reports/history - Get report history
// GET /api/admin/reports/history - Get report history (FIXED VERSION)
router.get('/reports/history', authenticateAdmin, async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    console.log('📋 Admin: Fetching report history - Page:', page, 'Limit:', limit);

    // Try to get real reports from database
    try {
      // First check if table exists by getting total count
      const totalResult = await db.execute(`
        SELECT COUNT(*) as total_count
        FROM admin_reports
      `);
      
      const total = totalResult.rows ? parseInt(totalResult.rows[0]?.total_count) : 
                   (totalResult[0] ? parseInt(totalResult[0][0]?.total_count) : 0);

      // Get paginated reports
      const reportsResult = await db.execute(`
        SELECT 
          id,
          admin_id,
          report_type,
          start_date,
          end_date,
          format,
          filename,
          record_count,
          COALESCE(download_count, 0) as download_count,
          COALESCE(status, 'completed') as status,
          created_at
        FROM admin_reports 
        ORDER BY created_at DESC 
        LIMIT $1 OFFSET $2
      `, [limit, offset]);

      const reports = reportsResult.rows || reportsResult[0] || [];

      // Format dates properly
      const formattedReports = reports.map(report => ({
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
          total: total,
          totalPages: Math.ceil(total / limit)
        }
      });

    } catch (dbError) {
      console.warn('⚠️ Reports table might not exist, creating it...:', dbError.message);
      
      // If table doesn't exist, create it
      try {
        await db.execute(`
          CREATE TABLE IF NOT EXISTS admin_reports (
            id VARCHAR(100) PRIMARY KEY,
            admin_id VARCHAR(100),
            report_type VARCHAR(50),
            start_date DATE,
            end_date DATE,
            format VARCHAR(10),
            filename VARCHAR(255),
            record_count INTEGER,
            download_count INTEGER DEFAULT 0,
            status VARCHAR(20) DEFAULT 'completed',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `);

        // Also create activity logs table
        await db.execute(`
          CREATE TABLE IF NOT EXISTS admin_activity_logs (
            id SERIAL PRIMARY KEY,
            admin_id VARCHAR(100),
            action_type VARCHAR(50),
            description TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `);

        // Return empty array for now
        res.json({
          success: true,
          reports: [],
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total: 0,
            totalPages: 0
          }
        });

      } catch (createError) {
        console.error('❌ Failed to create tables:', createError.message);
        
        // Return empty array as fallback
        res.json({
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
    }

  } catch (error) {
    console.error('❌ Get report history error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch report history',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});// POST /api/admin/reports/generate - Generate report
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

    // Generate report based on type
    let reportData = [];
    let filename = '';

    switch(type) {
      case 'users':
        const usersResult = await db.execute(`
          SELECT 
            u.*,
            COUNT(DISTINCT m.id) as total_matches,
            COUNT(DISTINCT tp.tournament_id) as total_tournaments,
            COUNT(DISTINCT gm.group_id) as total_groups,
            COALESCE(SUM(CASE WHEN t.type = 'deposit' THEN t.amount ELSE 0 END), 0) as total_deposits,
            COALESCE(SUM(CASE WHEN t.type = 'withdrawal' THEN t.amount ELSE 0 END), 0) as total_withdrawals
          FROM users u
          LEFT JOIN matches m ON (m.player1_id = u.id OR m.player2_id = u.id) AND m.created_at BETWEEN $1 AND $2
          LEFT JOIN tournament_participants tp ON tp.user_id = u.id AND tp.created_at BETWEEN $1 AND $2
          LEFT JOIN group_members gm ON gm.user_id = u.id AND gm.created_at BETWEEN $1 AND $2
          LEFT JOIN transactions t ON t.user_id = u.id AND t.created_at BETWEEN $1 AND $2
          WHERE u.created_at BETWEEN $1 AND $2
          GROUP BY u.id
          ORDER BY u.created_at DESC
        `, [startDate, endDate]);
        
        reportData = usersResult.rows || usersResult[0] || [];
        filename = `users_report_${startDate}_to_${endDate}`;
        break;

      case 'transactions':
        const transactionsResult = await db.execute(`
          SELECT 
            t.*,
            u.username,
            u.email,
            u.wallet_account_number
          FROM transactions t
          JOIN users u ON t.user_id = u.id
          WHERE t.created_at BETWEEN $1 AND $2
          ORDER BY t.created_at DESC
        `, [startDate, endDate]);
        
        reportData = transactionsResult.rows || transactionsResult[0] || [];
        filename = `transactions_report_${startDate}_to_${endDate}`;
        break;

      case 'tournaments':
        const tournamentsResult = await db.execute(`
          SELECT 
            t.*,
            u.username as creator_username,
            COUNT(DISTINCT tp.id) as participants_count,
            COUNT(DISTINCT tm.id) as matches_count
          FROM tournaments t
          LEFT JOIN users u ON t.creator_id = u.id
          LEFT JOIN tournament_participants tp ON t.id = tp.tournament_id
          LEFT JOIN tournament_matches tm ON t.id = tm.tournament_id
          WHERE t.created_at BETWEEN $1 AND $2
          GROUP BY t.id, u.username
          ORDER BY t.created_at DESC
        `, [startDate, endDate]);
        
        reportData = tournamentsResult.rows || tournamentsResult[0] || [];
        filename = `tournaments_report_${startDate}_to_${endDate}`;
        break;

      case 'groups':
        const groupsResult = await db.execute(`
          SELECT 
            g.*,
            u.username as creator_username,
            COUNT(DISTINCT gm.user_id) as members_count
          FROM groups g
          LEFT JOIN users u ON g.creator_id = u.id
          LEFT JOIN group_members gm ON g.id = gm.group_id
          WHERE g.created_at BETWEEN $1 AND $2
          GROUP BY g.id, u.username
          ORDER BY g.created_at DESC
        `, [startDate, endDate]);
        
        reportData = groupsResult.rows || groupsResult[0] || [];
        filename = `groups_report_${startDate}_to_${endDate}`;
        break;

      case 'financial': // ADD THIS NEW CASE
    const financialResult = await db.execute(`
      SELECT 
        t.*,
        u.username,
        u.email,
        u.wallet_account_number,
        CASE 
          WHEN t.type = 'deposit' THEN 'Revenue'
          WHEN t.type = 'withdrawal' THEN 'Payout'
          ELSE t.type
        END as category,
        CASE 
          WHEN t.type = 'deposit' THEN t.amount
          WHEN t.type = 'withdrawal' THEN -t.amount
          ELSE t.amount
        END as net_amount
      FROM transactions t
      JOIN users u ON t.user_id = u.id
      WHERE t.created_at BETWEEN $1 AND $2
        AND t.status = 'completed'
      ORDER BY t.created_at DESC
    `, [startDate, endDate]);
    
    // Also get platform fees
    const platformFeesResult = await db.execute(`
      SELECT 
        'Platform Fee' as category,
        m.stake_amount * 0.15 as amount,
        m.created_at,
        'Match' as source_type,
        m.id as source_id
      FROM matches m
      WHERE m.created_at BETWEEN $1 AND $2
        AND m.status = 'completed'
        AND m.stake_amount > 0
      
      UNION ALL
      
      SELECT 
        'Tournament Fee' as category,
        t.xp_entry_fee * 0.15 as amount,
        t.created_at,
        'Tournament' as source_type,
        t.id as source_id
      FROM tournaments t
      WHERE t.created_at BETWEEN $1 AND $2
        AND t.status IN ('ongoing', 'completed')
        AND t.xp_entry_fee > 0
    `, [startDate, endDate]);
    
    reportData = [...(financialResult.rows || financialResult[0] || []), 
                  ...(platformFeesResult.rows || platformFeesResult[0] || [])];
    filename = `financial_report_${startDate}_to_${endDate}`;
    break;

  default:
    return res.status(400).json({
      success: false,
      message: 'Invalid report type. Available: users, transactions, tournaments, groups, financial' // Updated
    });
}

    // Save report to database (if table exists)
    const reportId = `report_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    try {
      await db.execute(
        `INSERT INTO admin_reports 
         (id, admin_id, report_type, start_date, end_date, format, filename, record_count, created_at) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
        [reportId, adminId, type, startDate, endDate, format, filename, reportData.length]
      );
    } catch (saveError) {
      console.warn('⚠️ Could not save report to database:', saveError.message);
    }

    // Log activity
    await db.execute(
      `INSERT INTO admin_activity_logs 
       (admin_id, action_type, description, created_at) 
       VALUES ($1, 'report_generate', $2, NOW())`,
      [adminId, `Generated ${type} report from ${startDate} to ${endDate}`]
    );

    // Return report data
    if (format === 'csv') {
      // Convert to CSV (simplified)
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
// Helper function to convert data to CSV
function convertToCSV(data) {
  if (!data || data.length === 0) return '';
  
  const headers = Object.keys(data[0]);
  const csvRows = [];
  
  // Add headers
  csvRows.push(headers.join(','));
  
  // Add data rows
  for (const row of data) {
    const values = headers.map(header => {
      const value = row[header];
      // Escape commas and quotes
      if (value === null || value === undefined) return '';
      const escaped = String(value).replace(/"/g, '""');
      return `"${escaped}"`;
    });
    csvRows.push(values.join(','));
  }
  
  return csvRows.join('\n');
}

// GET /api/admin/reports/:id - Get report by ID
router.get('/reports/:id', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    console.log('📋 Admin: Fetching report:', id);

    // Check if reports table exists
    let report = null;
    
    try {
      const { rows: reports } = await db.query(
        'SELECT * FROM admin_reports WHERE id = $1',
        [id]
      );
      
      if (reports.length > 0) {
        report = reports[0];
      }
    } catch (tableError) {
      console.warn('⚠️ Reports table not found:', tableError.message);
    }

    if (!report) {
      return res.status(404).json({
        success: false,
        message: 'Report not found'
      });
    }

    res.json({
      success: true,
      report
    });

  } catch (error) {
    console.error('❌ Get report error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch report'
    });
  }
});

// GET /api/admin/reports/types - Get available report types
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

// Add these routes to your existing admin routes:

// GET /api/admin/reports/:id - Get report details
router.get('/reports/:id', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    console.log('📋 Admin: Fetching report details:', id);

    // Try to get report from database
    let report = null;
    try {
      const reportResult = await db.execute(
        'SELECT * FROM admin_reports WHERE id = $1',
        [id]
      );
      
      const reports = reportResult.rows || reportResult[0] || [];
      report = reports[0];
    } catch (dbError) {
      console.warn('⚠️ Could not fetch report from database:', dbError.message);
    }

    if (!report) {
      // Return report not found but still success
      return res.json({
        success: true,
        message: 'Report details retrieved from history',
        report: null
      });
    }

    res.json({
      success: true,
      report
    });

  } catch (error) {
    console.error('❌ Get report error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch report details'
    });
  }
});

// GET /api/admin/reports/:id/download - Download report
router.get('/reports/:id/download', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { format = 'json' } = req.query;
    const adminId = req.admin.id;

    console.log('📥 Admin: Downloading report:', id, 'Format:', format);

    // Get report from database
    const [reports] = await db.execute(
      'SELECT * FROM admin_reports WHERE id = $1',
      [id]
    );

    if (reports.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Report not found'
      });
    }

    const report = reports[0];

    // Update download count
    await db.execute(
      'UPDATE admin_reports SET download_count = download_count + 1 WHERE id = $1',
      [id]
    );

    // Generate report data (same logic as POST /reports/generate)
    let reportData = [];
    let query = '';

    switch(report.report_type) {
      case 'users':
        query = `
          SELECT 
            u.*,
            COUNT(DISTINCT m.id) as total_matches,
            COUNT(DISTINCT tp.tournament_id) as total_tournaments,
            COUNT(DISTINCT gm.group_id) as total_groups,
            COALESCE(SUM(CASE WHEN t.type = 'deposit' THEN t.amount ELSE 0 END), 0) as total_deposits,
            COALESCE(SUM(CASE WHEN t.type = 'withdrawal' THEN t.amount ELSE 0 END), 0) as total_withdrawals
          FROM users u
          LEFT JOIN matches m ON (m.player1_id = u.id OR m.player2_id = u.id) AND m.created_at BETWEEN $1 AND $2
          LEFT JOIN tournament_participants tp ON tp.user_id = u.id AND tp.created_at BETWEEN $1 AND $2
          LEFT JOIN group_members gm ON gm.user_id = u.id AND gm.created_at BETWEEN $1 AND $2
          LEFT JOIN transactions t ON t.user_id = u.id AND t.created_at BETWEEN $1 AND $2
          WHERE u.created_at BETWEEN $1 AND $2
          GROUP BY u.id
          ORDER BY u.created_at DESC
        `;
        break;

      case 'transactions':
        query = `
          SELECT 
            t.*,
            u.username,
            u.email,
            u.wallet_account_number
          FROM transactions t
          JOIN users u ON t.user_id = u.id
          WHERE t.created_at BETWEEN $1 AND $2
          ORDER BY t.created_at DESC
        `;
        break;

      case 'tournaments':
        query = `
          SELECT 
            t.*,
            u.username as creator_username,
            COUNT(DISTINCT tp.id) as participants_count,
            COUNT(DISTINCT tm.id) as matches_count
          FROM tournaments t
          LEFT JOIN users u ON t.creator_id = u.id
          LEFT JOIN tournament_participants tp ON t.id = tp.tournament_id
          LEFT JOIN tournament_matches tm ON t.id = tm.tournament_id
          WHERE t.created_at BETWEEN $1 AND $2
          GROUP BY t.id, u.username
          ORDER BY t.created_at DESC
        `;
        break;

      case 'groups':
        query = `
          SELECT 
            g.*,
            u.username as creator_username,
            COUNT(DISTINCT gm.user_id) as members_count
          FROM groups g
          LEFT JOIN users u ON g.creator_id = u.id
          LEFT JOIN group_members gm ON g.id = gm.group_id
          WHERE g.created_at BETWEEN $1 AND $2
          GROUP BY g.id, u.username
          ORDER BY g.created_at DESC
        `;
        break;

      default:
        return res.status(400).json({
          success: false,
          message: 'Invalid report type'
        });
    }

    const [data] = await db.execute(query, [report.start_date, report.end_date]);
    reportData = data;

    // Log activity
    await db.execute(
      `INSERT INTO admin_activity_logs 
       (admin_id, action_type, description, created_at) 
       VALUES ($1, 'report_download', $2, NOW())`,
      [adminId, `Downloaded ${report.report_type} report ${id}`]
    );

    if (format === 'csv') {
      // Convert to CSV
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

// Helper function to convert data to CSV
function convertToCSV(data) {
  if (!data || data.length === 0) return '';
  
  const headers = Object.keys(data[0]);
  const csvRows = [];
  
  // Add headers
  csvRows.push(headers.join(','));
  
  // Add data rows
  for (const row of data) {
    const values = headers.map(header => {
      const value = row[header];
      // Escape commas and quotes
      if (value === null || value === undefined) return '';
      const escaped = String(value).replace(/"/g, '""');
      return `"${escaped}"`;
    });
    csvRows.push(values.join(','));
  }
  
  return csvRows.join('\n');
}
// Helper function to generate report data
async function generateReportData(type, startDate, endDate) {
  let query = '';
  let params = [startDate, endDate];

  switch(type) {
    case 'users':
      query = `
        SELECT 
          u.*,
          COUNT(DISTINCT m.id) as total_matches,
          COUNT(DISTINCT tp.tournament_id) as total_tournaments,
          COUNT(DISTINCT gm.group_id) as total_groups,
          COALESCE(SUM(CASE WHEN t.type = 'deposit' THEN t.amount ELSE 0 END), 0) as total_deposits,
          COALESCE(SUM(CASE WHEN t.type = 'withdrawal' THEN t.amount ELSE 0 END), 0) as total_withdrawals
        FROM users u
        LEFT JOIN matches m ON (m.player1_id = u.id OR m.player2_id = u.id) AND m.created_at BETWEEN $1 AND $2
        LEFT JOIN tournament_participants tp ON tp.user_id = u.id AND tp.created_at BETWEEN $1 AND $2
        LEFT JOIN group_members gm ON gm.user_id = u.id AND gm.created_at BETWEEN $1 AND $2
        LEFT JOIN transactions t ON t.user_id = u.id AND t.created_at BETWEEN $1 AND $2
        WHERE u.created_at BETWEEN $1 AND $2
        GROUP BY u.id
        ORDER BY u.created_at DESC
      `;
      break;

    case 'transactions':
      query = `
        SELECT 
          t.*,
          u.username,
          u.email,
          u.wallet_account_number
        FROM transactions t
        JOIN users u ON t.user_id = u.id
        WHERE t.created_at BETWEEN $1 AND $2
        ORDER BY t.created_at DESC
      `;
      break;

    case 'tournaments':
      query = `
        SELECT 
          t.*,
          u.username as creator_username,
          COUNT(DISTINCT tp.id) as participants_count,
          COUNT(DISTINCT tm.id) as matches_count
        FROM tournaments t
        LEFT JOIN users u ON t.creator_id = u.id
        LEFT JOIN tournament_participants tp ON t.id = tp.tournament_id
        LEFT JOIN tournament_matches tm ON t.id = tm.tournament_id
        WHERE t.created_at BETWEEN $1 AND $2
        GROUP BY t.id, u.username
        ORDER BY t.created_at DESC
      `;
      break;

    case 'groups':
      query = `
        SELECT 
          g.*,
          u.username as creator_username,
          COUNT(DISTINCT gm.user_id) as members_count
        FROM groups g
        LEFT JOIN users u ON g.creator_id = u.id
        LEFT JOIN group_members gm ON g.id = gm.group_id
        WHERE g.created_at BETWEEN $1 AND $2
        GROUP BY g.id, u.username
        ORDER BY g.created_at DESC
      `;
      break;

    default:
      return [];
  }

  try {
    const result = await db.execute(query, params);
    return result.rows || result[0] || [];
  } catch (error) {
    console.error('Error generating report data:', error);
    return [];
  }
}

// ==================== ADMIN MANAGEMENT ENDPOINTS = FIXED FOR POSTGRESQL ====================

// GET /api/admin/admins - Get all admin users (FIXED)
router.get('/admins', authenticateAdmin, async (req, res) => {
  try {
    const adminId = req.admin.id;
    console.log('👑 Admin: Fetching all admins - Requested by:', adminId);

    // FIXED: PostgreSQL query with proper syntax
    const result = await db.execute(`
      SELECT 
        id,
        username,
        email,
        role,
        is_active,
        last_login,
        created_at,
        updated_at,
        permissions
      FROM admin_users 
      ORDER BY 
        CASE role 
          WHEN 'super_admin' THEN 1
          WHEN 'admin' THEN 2
          ELSE 3 
        END,
        created_at DESC
    `);

    // Handle result format
    const admins = result.rows || result[0] || [];

    // Parse permissions if they exist
    const formattedAdmins = admins.map(admin => ({
      ...admin,
      permissions: admin.permissions ? 
        (typeof admin.permissions === 'string' ? JSON.parse(admin.permissions) : admin.permissions) 
        : []
    }));

    res.json({
      success: true,
      admins: formattedAdmins,
      count: admins.length
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

// GET /api/admin/logs - Get admin activity logs (FIXED)
router.get('/logs', authenticateAdmin, async (req, res) => {
  try {
    const { adminId = '', page = 1, limit = 50, action_type = '' } = req.query;
    const offset = (page - 1) * limit;
    const requestingAdminId = req.admin.id;

    console.log('📝 Admin: Fetching admin logs - Page:', page, 'AdminId:', adminId);

    // FIXED: PostgreSQL query with parameter placeholders
    let query = `
      SELECT 
        al.*,
        au.username as admin_username,
        u.username as affected_user_username
      FROM admin_activity_logs al
      LEFT JOIN admin_users au ON al.admin_id = au.id
      LEFT JOIN users u ON al.affected_user_id = u.id::text
      WHERE 1=1
    `;
    
    let countQuery = 'SELECT COUNT(*) as total FROM admin_activity_logs al WHERE 1=1';
    const params = [];
    const countParams = [];
    let paramCount = 1;

    if (adminId && adminId !== '') {
      query += ` AND al.admin_id = $${paramCount}`;
      countQuery += ` AND al.admin_id = $${paramCount}`;
      params.push(adminId);
      countParams.push(adminId);
      paramCount++;
    }

    if (action_type && action_type !== '') {
      query += ` AND al.action_type = $${paramCount}`;
      countQuery += ` AND al.action_type = $${paramCount}`;
      params.push(action_type);
      countParams.push(action_type);
      paramCount++;
    }

    // Order and paginate
    query += ` ORDER BY al.created_at DESC LIMIT $${paramCount}`;
    params.push(parseInt(limit));
    
    paramCount++;
    query += ` OFFSET $${paramCount}`;
    params.push(parseInt(offset));

    // Execute queries
    const logsResult = await db.execute(query, params);
    const countResult = await db.execute(countQuery, countParams);

    // Handle result format
    const logs = logsResult.rows || logsResult[0] || [];
    const countData = countResult.rows ? countResult.rows[0] : (countResult[0] ? countResult[0][0] : null);
    const total = countData ? parseInt(countData.total) : 0;

    // Parse details if they exist
    const formattedLogs = logs.map(log => ({
      ...log,
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
        total: total,
        totalPages: Math.ceil(total / limit)
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

// POST /api/admin/admins - Create new admin (UPDATED TO STORE PROPER JSON)
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

    // Check if username already exists
    const existingUsernameResult = await db.execute(
      'SELECT id FROM admin_users WHERE username = $1',
      [username]
    );
    
    const existingUsername = existingUsernameResult.rows || existingUsernameResult[0] || [];

    if (existingUsername.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Username already exists'
      });
    }

    // Check if email already exists
    const existingEmailResult = await db.execute(
      'SELECT id FROM admin_users WHERE email = $1',
      [email]
    );
    
    const existingEmail = existingEmailResult.rows || existingEmailResult[0] || [];

    if (existingEmail.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Email already exists'
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // ============ FIX: Ensure permissions is valid JSON ============
    let permissionsJson = '[]';
    try {
      if (Array.isArray(permissions)) {
        permissionsJson = JSON.stringify(permissions);
      } else if (permissions && typeof permissions === 'string') {
        // Try to parse it first
        const parsed = JSON.parse(permissions);
        permissionsJson = JSON.stringify(parsed);
      } else {
        permissionsJson = JSON.stringify([]);
      }
    } catch (error) {
      console.warn('⚠️ Could not parse permissions, using empty array:', error.message);
      permissionsJson = '[]';
    }
    // ============ END FIX ============

    console.log('🔧 Storing permissions as:', permissionsJson);

    // Create admin
    const createResult = await db.execute(
      `INSERT INTO admin_users 
       (username, email, password_hash, role, permissions, is_active, created_at, updated_at) 
       VALUES ($1, $2, $3, $4, $5, true, NOW(), NOW()) RETURNING id, username, email, role`,
      [username, email, hashedPassword, role, permissionsJson]
    );

    const newAdmin = createResult.rows ? createResult.rows[0] : (createResult[0] ? createResult[0][0] : null);

    // Log activity
    await db.execute(
      `INSERT INTO admin_activity_logs 
       (admin_id, action_type, description, details, created_at) 
       VALUES ($1, 'admin_create', $2, $3, NOW())`,
      [
        adminId,
        `Created new admin user: ${username}`,
        JSON.stringify({
          created_username: username,
          created_email: email,
          role: role,
          permissions: permissions
        })
      ]
    );

    res.json({
      success: true,
      message: 'Admin user created successfully',
      admin: {
        ...newAdmin,
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
// PUT /api/admin/admins/:id - Update admin (FIXED)
router.put('/admins/:id', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { username, email, role, permissions, is_active } = req.body;
    const adminId = req.admin.id;

    console.log('👑 Admin: Updating admin:', id, 'Requested by:', adminId);

    // Check if admin exists
    const adminResult = await db.execute(
      'SELECT id, username FROM admin_users WHERE id = $1',
      [id]
    );
    
    const admins = adminResult.rows || adminResult[0] || [];

    if (admins.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Admin not found'
      });
    }

    const admin = admins[0];

    // Build update query
    const updateFields = [];
    const updateValues = [];
    let paramCount = 1;

    if (username !== undefined) {
      // Check if new username already exists (excluding current admin)
      const existingUsernameResult = await db.execute(
        'SELECT id FROM admin_users WHERE username = $1 AND id != $2',
        [username, id]
      );
      
      const existingUsername = existingUsernameResult.rows || existingUsernameResult[0] || [];

      if (existingUsername.length > 0) {
        return res.status(400).json({
          success: false,
          message: 'Username already exists'
        });
      }
      updateFields.push(`username = $${paramCount}`);
      updateValues.push(username);
      paramCount++;
    }

    if (email !== undefined) {
      // Check if new email already exists (excluding current admin)
      const existingEmailResult = await db.execute(
        'SELECT id FROM admin_users WHERE email = $1 AND id != $2',
        [email, id]
      );
      
      const existingEmail = existingEmailResult.rows || existingEmailResult[0] || [];

      if (existingEmail.length > 0) {
        return res.status(400).json({
          success: false,
          message: 'Email already exists'
        });
      }
      updateFields.push(`email = $${paramCount}`);
      updateValues.push(email);
      paramCount++;
    }

    if (role !== undefined) {
      updateFields.push(`role = $${paramCount}`);
      updateValues.push(role);
      paramCount++;
    }

    if (permissions !== undefined) {
      updateFields.push(`permissions = $${paramCount}`);
      updateValues.push(JSON.stringify(permissions));
      paramCount++;
    }

    if (is_active !== undefined) {
      updateFields.push(`is_active = $${paramCount}`);
      updateValues.push(is_active);
      paramCount++;
    }

    if (updateFields.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No fields to update'
      });
    }

    updateFields.push('updated_at = NOW()');
    updateValues.push(id);

    const updateQuery = `
      UPDATE admin_users 
      SET ${updateFields.join(', ')} 
      WHERE id = $${paramCount}
    `;

    await db.execute(updateQuery, updateValues);

    // Log activity
    await db.execute(
      `INSERT INTO admin_activity_logs 
       (admin_id, action_type, description, affected_user_id, details, created_at) 
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [
        adminId,
        'admin_update',
        `Updated admin user: ${admin.username}`,
        id,
        JSON.stringify({
          updated_fields: Object.keys(req.body),
          new_values: req.body
        })
      ]
    );

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

// PUT /api/admin/admins/:id/password - Update admin password (FIXED)
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

    // Check if admin exists
    const adminResult = await db.execute(
      'SELECT id, username FROM admin_users WHERE id = $1',
      [id]
    );
    
    const admins = adminResult.rows || adminResult[0] || [];

    if (admins.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Admin not found'
      });
    }

    const admin = admins[0];

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update password
    await db.execute(
      'UPDATE admin_users SET password_hash = $1, updated_at = NOW() WHERE id = $2',
      [hashedPassword, id]
    );

    // Log activity
    await db.execute(
      `INSERT INTO admin_activity_logs 
       (admin_id, action_type, description, affected_user_id, created_at) 
       VALUES ($1, $2, $3, $4, NOW())`,
      [adminId, 'admin_password_reset', `Reset password for admin: ${admin.username}`, id]
    );

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

// DELETE /api/admin/admins/:id - Delete admin (FIXED)
router.delete('/admins/:id', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const adminId = req.admin.id;

    console.log('👑 Admin: Deleting admin:', id, 'Requested by:', adminId);

    // Cannot delete yourself
    if (parseInt(id) === parseInt(adminId)) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete your own account'
      });
    }

    // Check if admin exists
    const adminResult = await db.execute(
      'SELECT id, username, role FROM admin_users WHERE id = $1',
      [id]
    );
    
    const admins = adminResult.rows || adminResult[0] || [];

    if (admins.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Admin not found'
      });
    }

    const admin = admins[0];

    // Cannot delete super_admin unless you are super_admin
    const requesterResult = await db.execute(
      'SELECT role FROM admin_users WHERE id = $1',
      [adminId]
    );
    
    const requester = requesterResult.rows ? requesterResult.rows[0] : (requesterResult[0] ? requesterResult[0][0] : null);

    if (admin.role === 'super_admin' && requester.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'Only super admin can delete other super admins'
      });
    }

    // Soft delete (deactivate) instead of hard delete
    await db.execute(
      'UPDATE admin_users SET is_active = false, updated_at = NOW() WHERE id = $1',
      [id]
    );

    // Log activity
    await db.execute(
      `INSERT INTO admin_activity_logs 
       (admin_id, action_type, description, affected_user_id, details, created_at) 
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [
        adminId,
        'admin_delete',
        `Deleted admin user: ${admin.username}`,
        id,
        JSON.stringify({
          admin_username: admin.username,
          admin_role: admin.role
        })
      ]
    );

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

// POST /api/admin/admins/:id/toggle-active - Toggle admin active status (FIXED)
router.post('/admins/:id/toggle-active', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { is_active } = req.body;
    const adminId = req.admin.id;

    console.log('👑 Admin: Toggling active status for admin:', id, 'Status:', is_active);

    // Cannot toggle your own status
    if (parseInt(id) === parseInt(adminId)) {
      return res.status(400).json({
        success: false,
        message: 'Cannot change your own active status'
      });
    }

    // Check if admin exists
    const adminResult = await db.execute(
      'SELECT id, username FROM admin_users WHERE id = $1',
      [id]
    );
    
    const admins = adminResult.rows || adminResult[0] || [];

    if (admins.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Admin not found'
      });
    }

    const admin = admins[0];

    // Update active status
    await db.execute(
      'UPDATE admin_users SET is_active = $1, updated_at = NOW() WHERE id = $2',
      [is_active, id]
    );

    // Log activity
    await db.execute(
      `INSERT INTO admin_activity_logs 
       (admin_id, action_type, description, affected_user_id, details, created_at) 
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [
        adminId,
        'admin_status_change',
        `${is_active ? 'Activated' : 'Deactivated'} admin: ${admin.username}`,
        id,
        JSON.stringify({
          new_status: is_active ? 'active' : 'inactive',
          admin_username: admin.username
        })
      ]
    );

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

// GET /api/admin/activity-types - Get available activity types (FIXED)
router.get('/activity-types', authenticateAdmin, async (req, res) => {
  try {
    console.log('📝 Admin: Fetching activity types');

    const result = await db.execute(`
      SELECT DISTINCT action_type 
      FROM admin_activity_logs 
      ORDER BY action_type
    `);
    
    const activityTypes = result.rows || result[0] || [];
    const types = activityTypes.map(type => type.action_type);

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

// POST /api/admin/admins/:id/promote - Promote admin to super admin (NEW FEATURE)
router.post('/admins/:id/promote', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { promote_to } = req.body; // 'super_admin' or 'admin'
    const adminId = req.admin.id;

    console.log('👑 Admin: Promoting admin:', id, 'to:', promote_to);

    if (!['super_admin', 'admin'].includes(promote_to)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid promotion type'
      });
    }

    // Only super admin can promote to super_admin
    if (promote_to === 'super_admin') {
      const requesterResult = await db.execute(
        'SELECT role FROM admin_users WHERE id = $1',
        [adminId]
      );
      
      const requester = requesterResult.rows ? requesterResult.rows[0] : (requesterResult[0] ? requesterResult[0][0] : null);

      if (requester.role !== 'super_admin') {
        return res.status(403).json({
          success: false,
          message: 'Only super admin can promote to super_admin'
        });
      }
    }

    // Check if admin exists
    const adminResult = await db.execute(
      'SELECT id, username, role FROM admin_users WHERE id = $1',
      [id]
    );
    
    const admins = adminResult.rows || adminResult[0] || [];

    if (admins.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Admin not found'
      });
    }

    const admin = admins[0];
    const oldRole = admin.role;

    // Update role
    await db.execute(
      'UPDATE admin_users SET role = $1, updated_at = NOW() WHERE id = $2',
      [promote_to, id]
    );

    // Log activity
    await db.execute(
      `INSERT INTO admin_activity_logs 
       (admin_id, action_type, description, affected_user_id, details, created_at) 
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [
        adminId,
        'admin_promotion',
        `Promoted admin ${admin.username} from ${oldRole} to ${promote_to}`,
        id,
        JSON.stringify({
          old_role: oldRole,
          new_role: promote_to,
          admin_username: admin.username
        })
      ]
    );

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
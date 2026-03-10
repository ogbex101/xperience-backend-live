// backend/src/routes/matches.js - COMPLETE FIXED VERSION
const express = require('express');
const Joi = require('joi');
const { authenticateToken } = require('../middleware/auth');
const db = require('../config/database');
const NotificationService = require('../services/notificationService');

const router = express.Router();

// ==================== CONSTANTS ====================
const XP_CONVERSION_RATE = 25; // 25 XP per 1000₦
const PLATFORM_FEE_PERCENT = 15; // 15% for money matches ONLY
const MIN_STAKE_MONEY = 100; // ₦100 minimum
const MIN_STAKE_XP = Math.ceil((MIN_STAKE_MONEY / 1000) * XP_CONVERSION_RATE); // 3 XP minimum

// ==================== VALIDATION SCHEMAS ====================
// Update the createMatchSchema (around line 30-50)
const createMatchSchema = Joi.object({
  game: Joi.string().required(),
  stake_amount: Joi.number().min(1).required(),
  prize_pool_option: Joi.string().valid('entry_fee', 'custom').required(),
  custom_prize_pool: Joi.when('prize_pool_option', {
    is: 'custom',
    then: Joi.number().min(1).required(),
    otherwise: Joi.optional().allow(null)
  }),
  opponent_type: Joi.string().valid('open', 'specific').required(),
  specific_username: Joi.when('opponent_type', {
    is: 'specific',
    then: Joi.string().required(),
    otherwise: Joi.optional().allow(null)
  }),
  scheduled_at: Joi.date().optional().allow(null),
  stake_currency: Joi.string().valid('money', 'xp').required(),
  admin_monitoring: Joi.boolean().optional().default(false) // ✅ NEW
});
const submitResultSchema = Joi.object({
  winner_id: Joi.number().integer().required()
});

// ==================== UTILITY FUNCTIONS ====================
const executeTransaction = async (operations) => {
  const connection = await db.pool.promise().getConnection();
  try {
    await connection.beginTransaction();
    
    for (const operation of operations) {
      await connection.execute(operation.query, operation.params || []);
    }
    
    await connection.commit();
    connection.release();
    return { success: true };
  } catch (error) {
    await connection.rollback();
    connection.release();
    throw error;
  }
};

const getMatchWithDetails = async (matchId, userId = null) => {
  let query = `
    SELECT 
      m.*,
      p1.username as player1_username,
      p1.rank as player1_rank,
      p1.profile_pic as player1_profile_pic,
      p2.username as player2_username,
      p2.rank as player2_rank,
      p2.profile_pic as player2_profile_pic,
      w.username as winner_username,
      p1.balance as player1_balance,
      p1.xp_points as player1_xp,
      p2.balance as player2_balance,
      p2.xp_points as player2_xp,
      -- Calculate display values
      (m.stake_amount * 2) as total_stakes,
      -- FIXED: Platform fee based on prize pool option
      CASE 
        WHEN m.stake_currency = 'money' AND m.prize_pool_option = 'entry_fee' THEN m.stake_amount * 2 * 0.15
        WHEN m.stake_currency = 'money' AND m.prize_pool_option = 'custom' THEN m.custom_prize_pool * 0.15
        ELSE 0
      END as platform_fee,
      -- ✅ NEW: Check if admin should monitor this match
      CASE 
        WHEN m.admin_monitoring = 1 THEN 1
        WHEN m.opponent_type = 'open' THEN 1  -- Auto-monitor open matches
        ELSE 0
      END as requires_admin_monitoring
    FROM matches m
    LEFT JOIN users p1 ON m.player1_id = p1.id
    LEFT JOIN users p2 ON m.player2_id = p2.id
    LEFT JOIN users w ON m.winner_id = w.id
    WHERE m.id = ?
  `;
  
  const params = [matchId];
  
  if (userId) {
    query += `
      AND (
        m.player1_id = ? 
        OR m.player2_id = ? 
        OR m.opponent_type = 'open'
        OR (m.opponent_type = 'specific' AND m.opponent_username = (
          SELECT username FROM users WHERE id = ?
        ))
      )
    `;
    params.push(userId, userId, userId);
  }
  
  const [matches] = await db.execute(query, params);
  return matches[0] || null;
};

// ==================== 1. CREATE MATCH (NO DEDUCTIONS) ====================
router.post('/create', authenticateToken, async (req, res) => {
  try {
    // Validate input
    const { error, value } = createMatchSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ 
        success: false,
        error: error.details[0].message 
      });
    }

    const {
      game,
      stake_amount,
      prize_pool_option,
      custom_prize_pool,
      opponent_type,
      specific_username,
      scheduled_at,
      stake_currency
    } = value;

    // ✅ FIXED: Use parseFloat for all number operations
    const stakeAmount = parseFloat(stake_amount);
    const customPrizePool = custom_prize_pool ? parseFloat(custom_prize_pool) : 0;

    // Validate minimum stake based on currency
    if (stake_currency === 'money' && stakeAmount < MIN_STAKE_MONEY) {
      return res.status(400).json({
        success: false,
        error: `Minimum stake amount is ₦${MIN_STAKE_MONEY} for money matches`
      });
    }
    
    if (stake_currency === 'xp' && stakeAmount < MIN_STAKE_XP) {
      return res.status(400).json({
        success: false,
        error: `Minimum stake amount is ${MIN_STAKE_XP} XP (equivalent to ₦${MIN_STAKE_MONEY})`
      });
    }

    // ========== FIXED: VALIDATE CUSTOM PRIZE POOL ==========
    if (prize_pool_option === 'custom') {
      if (!custom_prize_pool) {
        return res.status(400).json({
          success: false,
          error: 'Custom prize pool amount is required for custom prize option'
        });
      }
      
      // ✅ FIXED: Use parseFloat for comparison
      if (customPrizePool <= stakeAmount * 2) {
        return res.status(400).json({
          success: false,
          error: `Custom prize pool must be greater than ${stakeAmount * 2} (entry fee × 2)`
        });
      }
    }

    // Check creator balance (but don't deduct yet)
    const [creator] = await db.execute(
      'SELECT balance, xp_points, username FROM users WHERE id = ?',
      [req.user.id]
    );
    
    if (creator.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    const creatorBalance = parseFloat(creator[0].balance || 0);
    const creatorXp = parseFloat(creator[0].xp_points || 0);

    // ========== FIXED: BALANCE CHECK FOR CUSTOM PRIZE ==========
    if (prize_pool_option === 'custom') {
      // For custom prize: creator needs custom_prize_pool (not stake_amount)
      if (stake_currency === 'money' && creatorBalance < customPrizePool) {
        return res.status(400).json({
          success: false,
          error: `Insufficient balance for custom prize pool. You have ₦${creatorBalance}, need ₦${customPrizePool}`
        });
      }
      
      if (stake_currency === 'xp' && creatorXp < customPrizePool) {
        return res.status(400).json({
          success: false,
          error: `Insufficient XP for custom prize pool. You have ${creatorXp} XP, need ${customPrizePool} XP`
        });
      }
    } else {
      // For entry fee: creator needs stake_amount
      if (stake_currency === 'money' && creatorBalance < stakeAmount) {
        return res.status(400).json({
          success: false,
          error: `Insufficient balance. You have ₦${creatorBalance}, need ₦${stakeAmount}`
        });
      }
      
      if (stake_currency === 'xp' && creatorXp < stakeAmount) {
        return res.status(400).json({
          success: false,
          error: `Insufficient XP. You have ${creatorXp} XP, need ${stakeAmount} XP`
        });
      }
    }

    // Handle specific player invitation
    let invitedPlayerId = null;
    if (opponent_type === 'specific' && specific_username) {
      const [users] = await db.execute(
        'SELECT id, username FROM users WHERE username = ? AND is_banned = 0',
        [specific_username]
      );

      if (users.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Player not found or is banned'
        });
      }

      if (users[0].id === req.user.id) {
        return res.status(400).json({
          success: false,
          error: 'Cannot challenge yourself'
        });
      }

      invitedPlayerId = users[0].id;
      
      // Check if already played 3 times with this player
      const [recentMatches] = await db.execute(
        `SELECT COUNT(*) as count FROM matches 
         WHERE status = 'completed'
         AND ((player1_id = ? AND player2_id = ?) OR (player1_id = ? AND player2_id = ?))
         AND created_at > DATE_SUB(NOW(), INTERVAL 7 DAY)`,
        [req.user.id, invitedPlayerId, invitedPlayerId, req.user.id]
      );
      
      if (recentMatches[0].count >= 3) {
        return res.status(400).json({
          success: false,
          error: 'Cannot play the same opponent more than 3 times in a week'
        });
      }
    }

    // ========== FIXED PRIZE POOL CALCULATION ==========
    let prize_pool_amount = 0;
    if (prize_pool_option === 'entry_fee') {
      // ✅ FIXED: Use parseFloat for calculations
      const totalStakes = stakeAmount * 2;
      
      if (stake_currency === 'money') {
        // Money match: 15% platform fee
        prize_pool_amount = totalStakes * (1 - PLATFORM_FEE_PERCENT / 100);
      } else {
        // XP match: NO platform fee, 100% of total stakes
        prize_pool_amount = totalStakes;
      }
    } else {
      // ========== FIXED: Custom prize pool option ==========
      // Prize pool = FULL custom amount (platform fee deducted later during distribution)
      prize_pool_amount = customPrizePool;
    }

 const [result] = await db.execute(
  `INSERT INTO matches (
    player1_id, player2_id, game_type, game, stake_amount, 
    prize_pool_amount, custom_prize_pool, prize_pool_option,
    opponent_type, opponent_username, status, scheduled_at,
    stake_currency, stake_currency_type, stake_xp_amount,
    admin_monitoring, match_chat_enabled  -- ✅ NEW FIELDS
  ) VALUES (?, NULL, 'individual', ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)`,
  [
    req.user.id,
    game,
    stakeAmount,
    prize_pool_amount,
    customPrizePool || null,
    prize_pool_option,
    opponent_type,
    specific_username,
    scheduled_at,
    stake_currency,
    stake_currency === 'money' ? 'NGN' : 'XP',
    stake_currency === 'xp' ? stakeAmount : null,
    value.admin_monitoring ? 1 : 0,  // ✅ FIXED: Use value from validation
    1  // ✅ Default chat enabled
  ]
);
    const matchId = result.insertId;

    // Send notification for specific invitation
    if (invitedPlayerId) {
      const stakeDisplay = stake_currency === 'money' 
        ? `₦${stakeAmount}` 
        : `${stakeAmount} XP`;
      
      await NotificationService.createNotification({
        userId: invitedPlayerId,
        senderId: req.user.id,
        message: `${creator[0].username} challenged you to a ${game} match with ${stakeDisplay} stake!`,
        type: 'match_invitation',
        matchId: matchId
      });
    }

    res.json({
      success: true,
      message: opponent_type === 'open' 
        ? 'Open match created! Waiting for opponent to join.' 
        : 'Match invitation sent!',
      matchId: matchId,
      stake_currency: stake_currency,
      stake_amount: stakeAmount,
      prize_pool_amount: prize_pool_amount,
      custom_prize_pool: customPrizePool || null
    });

  } catch (error) {
    console.error('Create match error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create match'
    });
  }
});

// ==================== 2. ACCEPT MATCH (DEDUCTIONS HAPPEN HERE) ====================
router.post('/:id/accept', authenticateToken, async (req, res) => {
  const connection = await db.pool.promise().getConnection();
  
  try {
    await connection.beginTransaction();

    const matchId = req.params.id;
    const userId = req.user.id;

    // Get match with all details
    const [matches] = await connection.execute(
      `SELECT m.*,
              p1.username as player1_username,
              p2.username as player2_username,
              p1.balance as player1_balance,
              p1.xp_points as player1_xp,
              p2.balance as player2_balance,
              p2.xp_points as player2_xp
       FROM matches m
       LEFT JOIN users p1 ON m.player1_id = p1.id
       LEFT JOIN users p2 ON m.player2_id = p2.id
       WHERE m.id = ? AND m.status = 'pending'`,
      [matchId]
    );

    if (matches.length === 0) {
      await connection.rollback();
      connection.release();
      return res.status(404).json({
        success: false,
        error: 'Match not found or not available'
      });
    }

    const match = matches[0];

    // ✅ FIXED: Parse all numbers
    const stakeAmount = parseFloat(match.stake_amount || 0);
    const customPrizePool = parseFloat(match.custom_prize_pool || 0);
    const player1Balance = parseFloat(match.player1_balance || 0);
    const player1Xp = parseFloat(match.player1_xp || 0);

    // Validate user can accept
    if (match.opponent_type === 'specific') {
      // Get current user's username
      const [currentUser] = await connection.execute(
        'SELECT username FROM users WHERE id = ?',
        [userId]
      );
      
      if (!currentUser[0] || currentUser[0].username !== match.opponent_username) {
        await connection.rollback();
        connection.release();
        return res.status(403).json({
          success: false,
          error: 'You are not invited to this match'
        });
      }
    }

    // Check if user is creator
    if (match.player1_id === userId) {
      await connection.rollback();
      connection.release();
      return res.status(400).json({
        success: false,
        error: 'You cannot accept your own match'
      });
    }

    // Check if match already has opponent
    if (match.player2_id) {
      await connection.rollback();
      connection.release();
      return res.status(400).json({
        success: false,
        error: 'This match already has an opponent'
      });
    }

    // ========== CHECK BOTH PLAYERS' BALANCES ==========
    // Check acceptor's balance (always needs stake_amount)
    const [acceptor] = await connection.execute(
      'SELECT balance, xp_points, username FROM users WHERE id = ?',
      [userId]
    );
    
    if (!acceptor[0]) {
      await connection.rollback();
      connection.release();
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }
    
    const acceptorData = acceptor[0];
    const acceptorBalance = parseFloat(acceptorData.balance || 0);
    const acceptorXp = parseFloat(acceptorData.xp_points || 0);
    
    if (match.stake_currency === 'money') {
      // ✅ FIXED: Use parseFloat() for number comparison
      if (acceptorBalance < stakeAmount) {
        await connection.rollback();
        connection.release();
        return res.status(400).json({
          success: false,
          error: `Insufficient balance. You have ₦${acceptorBalance}, need ₦${stakeAmount}`
        });
      }
    } else {
      // ✅ FIXED: Use parseFloat() for number comparison
      if (acceptorXp < stakeAmount) {
        await connection.rollback();
        connection.release();
        return res.status(400).json({
          success: false,
          error: `Insufficient XP. You have ${acceptorXp} XP, need ${stakeAmount} XP`
        });
      }
    }

    // Check creator's balance (depends on prize pool option)
    if (match.prize_pool_option === 'custom') {
      // For custom prize: creator needs custom_prize_pool
      if (match.stake_currency === 'money') {
        if (!player1Balance || player1Balance < customPrizePool) {
          await connection.rollback();
          connection.release();
          return res.status(400).json({
            success: false,
            error: 'Creator no longer has sufficient balance for custom prize pool'
          });
        }
      } else {
        if (!player1Xp || player1Xp < customPrizePool) {
          await connection.rollback();
          connection.release();
          return res.status(400).json({
            success: false,
            error: 'Creator no longer has sufficient XP for custom prize pool'
          });
        }
      }
    } else {
      // For entry fee: creator needs stake_amount
      if (match.stake_currency === 'money') {
        if (!player1Balance || player1Balance < stakeAmount) {
          await connection.rollback();
          connection.release();
          return res.status(400).json({
            success: false,
            error: 'Creator no longer has sufficient balance'
          });
        }
      } else {
        if (!player1Xp || player1Xp < stakeAmount) {
          await connection.rollback();
          connection.release();
          return res.status(400).json({
            success: false,
            error: 'Creator no longer has sufficient XP'
          });
        }
      }
    }

    // ========== FIXED: EXECUTE ATOMIC TRANSACTION ==========
    // 1. Deduct from acceptor (always stake_amount)
    if (match.stake_currency === 'money') {
      await connection.execute(
        'UPDATE users SET balance = balance - ? WHERE id = ?',
        [stakeAmount, userId]
      );
      
      // Record transaction for acceptor
      await connection.execute(
        `INSERT INTO transactions (user_id, amount, type, status, reference, description, currency) 
         VALUES (?, ?, 'match_entry', 'completed', ?, ?, ?)`,
        [
          userId,
          -stakeAmount,
          `MATCH-ACCEPT-${Date.now()}-${matchId}`,
          `Match entry for ${match.game || 'game'}`,
          'NGN'
        ]
      );
    } else {
      await connection.execute(
        'UPDATE users SET xp_points = COALESCE(xp_points, 0) - ? WHERE id = ?',
        [stakeAmount, userId]
      );
      
      // Record XP transaction for acceptor
      await connection.execute(
        `INSERT INTO xp_transactions (user_id, type, amount, description, match_id) 
         VALUES (?, 'match_entry', ?, ?, ?)`,
        [
          userId,
          -stakeAmount,
          `XP stake for ${match.game || 'game'} match`,
          matchId
        ]
      );
    }
    
    // 2. Deduct from creator (depends on prize pool option)
    if (match.prize_pool_option === 'custom') {
      // For custom prize: deduct custom_prize_pool from creator
      if (match.stake_currency === 'money') {
        await connection.execute(
          'UPDATE users SET balance = balance - ? WHERE id = ?',
          [customPrizePool, match.player1_id]
        );
        
        // Record transaction for creator (custom prize)
        await connection.execute(
          `INSERT INTO transactions (user_id, amount, type, status, reference, description, currency) 
           VALUES (?, ?, 'match_entry', 'completed', ?, ?, ?)`,
          [
            match.player1_id,
            -customPrizePool,
            `MATCH-CUSTOM-${Date.now()}-${matchId}`,
            `Custom prize pool for ${match.game || 'game'}`,
            'NGN'
          ]
        );
      } else {
        await connection.execute(
          'UPDATE users SET xp_points = COALESCE(xp_points, 0) - ? WHERE id = ?',
          [customPrizePool, match.player1_id]
        );
        
        // Record XP transaction for creator
        await connection.execute(
          `INSERT INTO xp_transactions (user_id, type, amount, description, match_id) 
           VALUES (?, 'match_entry', ?, ?, ?)`,
          [
            match.player1_id,
            -customPrizePool,
            `Custom XP prize pool for ${match.game || 'game'} match`,
            matchId
          ]
        );
      }
    } else {
      // For entry fee: deduct stake_amount from creator
      if (match.stake_currency === 'money') {
        await connection.execute(
          'UPDATE users SET balance = balance - ? WHERE id = ?',
          [stakeAmount, match.player1_id]
        );
        
        // Record transaction for creator
        await connection.execute(
          `INSERT INTO transactions (user_id, amount, type, status, reference, description, currency) 
           VALUES (?, ?, 'match_entry', 'completed', ?, ?, ?)`,
          [
            match.player1_id,
            -stakeAmount,
            `MATCH-CREATE-${Date.now()}-${matchId}`,
            `Match stake for ${match.game || 'game'}`,
            'NGN'
          ]
        );
      } else {
        await connection.execute(
          'UPDATE users SET xp_points = COALESCE(xp_points, 0) - ? WHERE id = ?',
          [stakeAmount, match.player1_id]
        );
        
        // Record XP transaction for creator
        await connection.execute(
          `INSERT INTO xp_transactions (user_id, type, amount, description, match_id) 
           VALUES (?, 'match_entry', ?, ?, ?)`,
          [
            match.player1_id,
            -stakeAmount,
            `XP stake for ${match.game || 'game'} match`,
            matchId
          ]
        );
      }
    }
    
    // 3. Update match status
    await connection.execute(
      'UPDATE matches SET player2_id = ?, status = "ongoing", started_at = NOW() WHERE id = ?',
      [userId, matchId]
    );
    
    // 4. Record match attempt for ranking
    const [acceptorRank] = await connection.execute(
      'SELECT rank FROM users WHERE id = ?',
      [userId]
    );
    
    const [creatorRank] = await connection.execute(
      'SELECT rank FROM users WHERE id = ?',
      [match.player1_id]
    );
    
    await connection.execute(
      `INSERT INTO match_attempts (player1_id, player2_id, player1_rank, player2_rank, match_id) 
       VALUES (?, ?, ?, ?, ?)`,
      [
        match.player1_id,
        userId,
        creatorRank[0]?.rank || 'E',
        acceptorRank[0]?.rank || 'E',
        matchId
      ]
    );

    await connection.commit();
    connection.release();

    // Send notification
    await NotificationService.createNotification({
      userId: match.player1_id,
      senderId: userId,
      message: `${acceptorData.username} accepted your match invitation!`,
      type: 'match_accepted',
      matchId: matchId
    });

    res.json({
      success: true,
      message: 'Match accepted successfully! The game is now active.',
      matchId: matchId,
      stake_deducted: stakeAmount,
      custom_prize_deducted: match.prize_pool_option === 'custom' ? customPrizePool : null,
      currency: match.stake_currency
    });

  } catch (error) {
    await connection.rollback();
    connection.release();
    console.error('Accept match error details:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to accept match: ' + error.message
    });
  }
});

// ==================== 3. JOIN OPEN MATCH (FIXED VERSION) ====================
router.post('/:id/join', authenticateToken, async (req, res) => {
  const connection = await db.pool.promise().getConnection();
  
  try {
    await connection.beginTransaction();

    const matchId = req.params.id;
    const userId = req.user.id;

    console.log(`User ${userId} attempting to join match ${matchId}`);

    // Get match with all details
    const [matches] = await connection.execute(
      `SELECT m.*,
              p1.username as player1_username,
              p2.username as player2_username,
              p1.balance as player1_balance,
              p1.xp_points as player1_xp,
              p2.balance as player2_balance,
              p2.xp_points as player2_xp
       FROM matches m
       LEFT JOIN users p1 ON m.player1_id = p1.id
       LEFT JOIN users p2 ON m.player2_id = p2.id
       WHERE m.id = ?`,
      [matchId]
    );

    if (matches.length === 0) {
      await connection.rollback();
      connection.release();
      return res.status(404).json({
        success: false,
        error: 'Match not found'
      });
    }

    const match = matches[0];

    // ✅ FIXED: Parse all numbers
    const stakeAmount = parseFloat(match.stake_amount || 0);
    const customPrizePool = parseFloat(match.custom_prize_pool || 0);
    const player1Balance = parseFloat(match.player1_balance || 0);
    const player1Xp = parseFloat(match.player1_xp || 0);

    // Validate match is open for joining
    if (match.opponent_type !== 'open') {
      await connection.rollback();
      connection.release();
      return res.status(400).json({
        success: false,
        error: 'This match is not open for joining'
      });
    }

    if (match.status !== 'pending') {
      await connection.rollback();
      connection.release();
      return res.status(400).json({
        success: false,
        error: 'Match is not available for joining'
      });
    }

    if (match.player2_id) {
      await connection.rollback();
      connection.release();
      return res.status(400).json({
        success: false,
        error: 'This match already has an opponent'
      });
    }

    if (match.player1_id === userId) {
      await connection.rollback();
      connection.release();
      return res.status(400).json({
        success: false,
        error: 'You cannot join your own match'
      });
    }

    // ========== CHECK BOTH PLAYERS' BALANCES ==========
    const [acceptor] = await connection.execute(
      'SELECT balance, xp_points, username FROM users WHERE id = ?',
      [userId]
    );
    
    if (!acceptor[0]) {
      await connection.rollback();
      connection.release();
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }
    
    const acceptorData = acceptor[0];
    const acceptorBalance = parseFloat(acceptorData.balance || 0);
    const acceptorXp = parseFloat(acceptorData.xp_points || 0);
    
    if (match.stake_currency === 'money') {
      if (acceptorBalance < stakeAmount) {
        await connection.rollback();
        connection.release();
        return res.status(400).json({
          success: false,
          error: `Insufficient balance. You have ₦${acceptorBalance}, need ₦${stakeAmount}`
        });
      }
    } else {
      if (acceptorXp < stakeAmount) {
        await connection.rollback();
        connection.release();
        return res.status(400).json({
          success: false,
          error: `Insufficient XP. You have ${acceptorXp} XP, need ${stakeAmount} XP`
        });
      }
    }

    // Check creator's balance
    if (match.prize_pool_option === 'custom') {
      if (match.stake_currency === 'money') {
        if (!player1Balance || player1Balance < customPrizePool) {
          await connection.rollback();
          connection.release();
          return res.status(400).json({
            success: false,
            error: 'Creator no longer has sufficient balance for custom prize pool'
          });
        }
      } else {
        if (!player1Xp || player1Xp < customPrizePool) {
          await connection.rollback();
          connection.release();
          return res.status(400).json({
            success: false,
            error: 'Creator no longer has sufficient XP for custom prize pool'
          });
        }
      }
    } else {
      if (match.stake_currency === 'money') {
        if (!player1Balance || player1Balance < stakeAmount) {
          await connection.rollback();
          connection.release();
          return res.status(400).json({
            success: false,
            error: 'Creator no longer has sufficient balance'
          });
        }
      } else {
        if (!player1Xp || player1Xp < stakeAmount) {
          await connection.rollback();
          connection.release();
          return res.status(400).json({
            success: false,
            error: 'Creator no longer has sufficient XP'
          });
        }
      }
    }

    // ========== EXECUTE ATOMIC TRANSACTION ==========
    // 1. Deduct from acceptor
    if (match.stake_currency === 'money') {
      await connection.execute(
        'UPDATE users SET balance = balance - ? WHERE id = ?',
        [stakeAmount, userId]
      );
      
      await connection.execute(
        `INSERT INTO transactions (user_id, amount, type, status, reference, description, currency) 
         VALUES (?, ?, 'match_entry', 'completed', ?, ?, ?)`,
        [
          userId,
          -stakeAmount,
          `MATCH-JOIN-${Date.now()}-${matchId}`,
          `Match entry for ${match.game || 'game'}`,
          'NGN'
        ]
      );
    } else {
      await connection.execute(
        'UPDATE users SET xp_points = COALESCE(xp_points, 0) - ? WHERE id = ?',
        [stakeAmount, userId]
      );
      
      await connection.execute(
        `INSERT INTO xp_transactions (user_id, type, amount, description, match_id) 
         VALUES (?, 'match_entry', ?, ?, ?)`,
        [
          userId,
          -stakeAmount,
          `XP stake for ${match.game || 'game'} match`,
          matchId
        ]
      );
    }
    
    // 2. Deduct from creator
    if (match.prize_pool_option === 'custom') {
      if (match.stake_currency === 'money') {
        await connection.execute(
          'UPDATE users SET balance = balance - ? WHERE id = ?',
          [customPrizePool, match.player1_id]
        );
        
        await connection.execute(
          `INSERT INTO transactions (user_id, amount, type, status, reference, description, currency) 
           VALUES (?, ?, 'match_entry', 'completed', ?, ?, ?)`,
          [
            match.player1_id,
            -customPrizePool,
            `MATCH-CUSTOM-${Date.now()}-${matchId}`,
            `Custom prize pool for ${match.game || 'game'}`,
            'NGN'
          ]
        );
      } else {
        await connection.execute(
          'UPDATE users SET xp_points = COALESCE(xp_points, 0) - ? WHERE id = ?',
          [customPrizePool, match.player1_id]
        );
        
        await connection.execute(
          `INSERT INTO xp_transactions (user_id, type, amount, description, match_id) 
           VALUES (?, 'match_entry', ?, ?, ?)`,
          [
            match.player1_id,
            -customPrizePool,
            `Custom XP prize pool for ${match.game || 'game'} match`,
            matchId
          ]
        );
      }
    } else {
      if (match.stake_currency === 'money') {
        await connection.execute(
          'UPDATE users SET balance = balance - ? WHERE id = ?',
          [stakeAmount, match.player1_id]
        );
        
        await connection.execute(
          `INSERT INTO transactions (user_id, amount, type, status, reference, description, currency) 
           VALUES (?, ?, 'match_entry', 'completed', ?, ?, ?)`,
          [
            match.player1_id,
            -stakeAmount,
            `MATCH-CREATE-${Date.now()}-${matchId}`,
            `Match stake for ${match.game || 'game'}`,
            'NGN'
          ]
        );
      } else {
        await connection.execute(
          'UPDATE users SET xp_points = COALESCE(xp_points, 0) - ? WHERE id = ?',
          [stakeAmount, match.player1_id]
        );
        
        await connection.execute(
          `INSERT INTO xp_transactions (user_id, type, amount, description, match_id) 
           VALUES (?, 'match_entry', ?, ?, ?)`,
          [
            match.player1_id,
            -stakeAmount,
            `XP stake for ${match.game || 'game'} match`,
            matchId
          ]
        );
      }
    }
    
    // 3. Update match status
    await connection.execute(
      'UPDATE matches SET player2_id = ?, status = "ongoing", started_at = NOW() WHERE id = ?',
      [userId, matchId]
    );
    
    // 4. Record match attempt for ranking
    const [acceptorRank] = await connection.execute(
      'SELECT rank FROM users WHERE id = ?',
      [userId]
    );
    
    const [creatorRank] = await connection.execute(
      'SELECT rank FROM users WHERE id = ?',
      [match.player1_id]
    );
    
    await connection.execute(
      `INSERT INTO match_attempts (player1_id, player2_id, player1_rank, player2_rank, match_id) 
       VALUES (?, ?, ?, ?, ?)`,
      [
        match.player1_id,
        userId,
        creatorRank[0]?.rank || 'E',
        acceptorRank[0]?.rank || 'E',
        matchId
      ]
    );

    await connection.commit();
    connection.release();

    // Send notification
    await NotificationService.createNotification({
      userId: match.player1_id,
      senderId: userId,
      message: `${acceptorData.username} joined your match!`,
      type: 'match_accepted',
      matchId: matchId
    });

    console.log(`✅ User ${userId} successfully joined match ${matchId}`);
    
    res.json({
      success: true,
      message: 'Match joined successfully! The game is now active.',
      matchId: matchId,
      stake_deducted: stakeAmount,
      custom_prize_deducted: match.prize_pool_option === 'custom' ? customPrizePool : null,
      currency: match.stake_currency
    });

  } catch (error) {
    await connection.rollback();
    connection.release();
    console.error('Join match transaction error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to join match: ' + error.message
    });
  }
});

// ==================== 4. DECLINE INVITATION ====================
router.post('/:id/decline', authenticateToken, async (req, res) => {
  try {
    const matchId = req.params.id;
    
    const match = await getMatchWithDetails(matchId);
    
    if (!match) {
      return res.status(404).json({
        success: false,
        error: 'Match not found'
      });
    }

    // Check if user is invited
    if (match.opponent_type !== 'specific' || match.status !== 'pending') {
      return res.status(400).json({
        success: false,
        error: 'Cannot decline this match'
      });
    }

    // Get current user's username
    const [currentUser] = await db.execute(
      'SELECT username FROM users WHERE id = ?',
      [req.user.id]
    );
    
    if (!currentUser[0] || currentUser[0].username !== match.opponent_username) {
      return res.status(403).json({
        success: false,
        error: 'You are not invited to this match'
      });
    }

    // Update match status
    await db.execute(
      'UPDATE matches SET status = "cancelled", completed_at = NOW() WHERE id = ?',
      [matchId]
    );

    // Notify creator
    await NotificationService.createNotification({
      userId: match.player1_id,
      senderId: req.user.id,
      message: `${currentUser[0].username} declined your match invitation`,
      type: 'match_declined',
      matchId: matchId
    });

    res.json({
      success: true,
      message: 'Invitation declined'
    });

  } catch (error) {
    console.error('Decline invitation error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to decline invitation'
    });
  }
});

// ==================== 5. SUBMIT MATCH RESULT (WITH AUTO-DISTRIBUTE) ====================
router.post('/:id/result', authenticateToken, async (req, res) => {
  const connection = await db.pool.promise().getConnection();
  
  try {
    await connection.beginTransaction();

    const { error, value } = submitResultSchema.validate(req.body);
    if (error) {
      await connection.rollback();
      connection.release();
      return res.status(400).json({
        success: false,
        error: error.details[0].message
      });
    }

    const { winner_id } = value;
    const matchId = req.params.id;
    const userId = req.user.id;

    // Get match with all details within transaction
    const [matches] = await connection.execute(
      `SELECT m.*,
              p1.username as player1_username,
              p2.username as player2_username
       FROM matches m
       LEFT JOIN users p1 ON m.player1_id = p1.id
       LEFT JOIN users p2 ON m.player2_id = p2.id
       WHERE m.id = ?`,
      [matchId]
    );

    if (matches.length === 0) {
      await connection.rollback();
      connection.release();
      return res.status(404).json({
        success: false,
        error: 'Match not found'
      });
    }

    const match = matches[0];

    // ✅ FIXED: Parse all numbers
    const stakeAmount = parseFloat(match.stake_amount || 0);
    const customPrizePool = parseFloat(match.custom_prize_pool || 0);
    const prizePoolAmount = parseFloat(match.prize_pool_amount || 0);

    // Validate match status
    if (match.status !== 'ongoing') {
      await connection.rollback();
      connection.release();
      return res.status(400).json({
        success: false,
        error: `Match is ${match.status}, cannot submit result`
      });
    }

    // Check if user is a participant
    if (parseInt(userId) !== parseInt(match.player1_id) && parseInt(userId) !== parseInt(match.player2_id)) {
      await connection.rollback();
      connection.release();
      return res.status(403).json({
        success: false,
        error: 'You are not a participant in this match'
      });
    }

    // Validate winner is one of the players
    if (parseInt(winner_id) !== parseInt(match.player1_id) && parseInt(winner_id) !== parseInt(match.player2_id)) {
      await connection.rollback();
      connection.release();
      return res.status(400).json({
        success: false,
        error: 'Winner must be one of the match participants'
      });
    }

    // Check if user already submitted a result
    const [existingResult] = await connection.execute(
      'SELECT * FROM match_results WHERE match_id = ? AND user_id = ?',
      [matchId, userId]
    );

    if (existingResult.length > 0) {
      await connection.rollback();
      connection.release();
      return res.status(400).json({
        success: false,
        error: 'You already submitted a result for this match'
      });
    }

    // Submit result
    await connection.execute(
      'INSERT INTO match_results (match_id, user_id, winner_id) VALUES (?, ?, ?)',
      [matchId, userId, winner_id]
    );

    // Check if BOTH players submitted results
    const [results] = await connection.execute(
      'SELECT COUNT(DISTINCT user_id) as count FROM match_results WHERE match_id = ?',
      [matchId]
    );

    if (results[0].count >= 2) {
      // Both submitted - check if they agree
      const [winnerCounts] = await connection.execute(
        'SELECT winner_id, COUNT(*) as count FROM match_results WHERE match_id = ? GROUP BY winner_id',
        [matchId]
      );
      
      if (winnerCounts.length === 1) {
        // ✅ BOTH AGREE ON WINNER - AUTO-DISTRIBUTE PRIZE
        const agreedWinnerId = winnerCounts[0].winner_id;
        
        console.log('=== AUTO-DISTRIBUTING PRIZE ===');
        console.log('Match ID:', matchId);
        console.log('Winner ID:', agreedWinnerId);
        console.log('Prize option:', match.prize_pool_option);
        console.log('Stake amount (parsed):', stakeAmount);
        console.log('Custom prize (parsed):', customPrizePool);
        
        // Update match as completed
        await connection.execute(
          'UPDATE matches SET status = "completed", winner_id = ?, completed_at = NOW() WHERE id = ?',
          [agreedWinnerId, matchId]
        );
        
        // ========== FIXED: DISTRIBUTE PRIZE BASED ON PRIZE POOL OPTION ==========
        if (match.prize_pool_option === 'entry_fee') {
          // Entry fee option distribution
          const totalStakes = stakeAmount * 2;
          let prizeAmount = prizePoolAmount;
          
          console.log('Entry fee distribution:');
          console.log('Total stakes:', totalStakes);
          console.log('Prize amount:', prizeAmount);
          
          if (match.stake_currency === 'money') {
            // Distribute prize to winner
            await connection.execute(
              'UPDATE users SET balance = balance + ? WHERE id = ?',
              [prizeAmount, agreedWinnerId]
            );
            
            // Record winner transaction
            await connection.execute(
              `INSERT INTO transactions (user_id, amount, type, status, reference, description, currency) 
               VALUES (?, ?, 'match_win', 'completed', ?, ?, ?)`,
              [
                agreedWinnerId,
                prizeAmount,
                `MATCH-WIN-${Date.now()}-${matchId}`,
                `Match winnings from ${match.game}`,
                'NGN'
              ]
            );
            
            // Record platform fee (15% of total stakes)
            const platformFee = totalStakes * 0.15;
            await connection.execute(
              `INSERT INTO revenue (tournament_id, amount, revenue_date, notes) 
               VALUES (NULL, ?, NOW(), '15% platform fee from 1vs1_match')`,
              [platformFee]
            );
          } else {
            // XP match - no platform fee
            // But the prize pool should be totalStakes (100%), not 85%
            const xpPrize = totalStakes; // 100% of total stakes for XP matches
            await connection.execute(
              'UPDATE users SET xp_points = COALESCE(xp_points, 0) + ? WHERE id = ?',
              [xpPrize, agreedWinnerId]
            );
            
            // Create XP transaction for winner
            await connection.execute(
              `INSERT INTO xp_transactions (user_id, type, amount, description, match_id) 
               VALUES (?, 'match_win', ?, ?, ?)`,
              [
                agreedWinnerId,
                xpPrize,
                `XP winnings from ${match.game} match`,
                matchId
              ]
            );
          }
          
        } else {
          // ========== CUSTOM PRIZE POOL OPTION DISTRIBUTION ==========
          console.log('Custom prize pool distribution:');
          console.log('Custom prize pool:', customPrizePool);
          console.log('Stake amount:', stakeAmount);
          
          if (match.stake_currency === 'money') {
            const platformFee = customPrizePool * 0.15;
            const prizeForWinner = customPrizePool - platformFee;
            
            if (agreedWinnerId === match.player1_id) {
              // Creator wins: gets custom prize + opponent's entry fee
              const totalForCreator = prizeForWinner + stakeAmount;
              
              console.log('=== CUSTOM PRIZE CREATOR WINS CALCULATION ===');
              console.log('Custom prize (parsed):', customPrizePool);
              console.log('Platform fee (15%):', platformFee);
              console.log('Prize after fee:', prizeForWinner);
              console.log('Opponent entry fee (parsed):', stakeAmount);
              console.log('TOTAL for creator:', totalForCreator);
              
              await connection.execute(
                'UPDATE users SET balance = balance + ? WHERE id = ?',
                [totalForCreator, match.player1_id]
              );
              
              await connection.execute(
                `INSERT INTO transactions (user_id, amount, type, status, reference, description, currency) 
                 VALUES (?, ?, 'match_win', 'completed', ?, ?, ?)`,
                [
                  match.player1_id,
                  totalForCreator,
                  `MATCH-CUSTOM-WIN-${Date.now()}-${matchId}`,
                  `Custom prize winnings (${customPrizePool} - 15% fee = ${prizeForWinner}) + opponent entry fee (${stakeAmount}) = ${totalForCreator}`,
                  'NGN'
                ]
              );
            } else {
              // Opponent wins: gets custom prize only
              console.log('Opponent wins. Prize:', prizeForWinner);
              
              await connection.execute(
                'UPDATE users SET balance = balance + ? WHERE id = ?',
                [prizeForWinner, match.player2_id]
              );
              
              // Record transaction for opponent
              await connection.execute(
                `INSERT INTO transactions (user_id, amount, type, status, reference, description, currency) 
                 VALUES (?, ?, 'match_win', 'completed', ?, ?, ?)`,
                [
                  match.player2_id,
                  prizeForWinner,
                  `MATCH-CUSTOM-WIN-${Date.now()}-${matchId}`,
                  `Custom prize winnings from ${match.game}`,
                  'NGN'
                ]
              );
              
              // Creator gets opponent's entry fee back
              await connection.execute(
                'UPDATE users SET balance = balance + ? WHERE id = ?',
                [stakeAmount, match.player1_id]
              );
              
              // Record transaction for creator (entry fee return)
              await connection.execute(
                `INSERT INTO transactions (user_id, amount, type, status, reference, description, currency) 
                 VALUES (?, ?, 'match_entry_return', 'completed', ?, ?, ?)`,
                [
                  match.player1_id,
                  stakeAmount,
                  `MATCH-ENTRY-RETURN-${Date.now()}-${matchId}`,
                  `Entry fee return from ${match.game}`,
                  'NGN'
                ]
              );
            }
            
            // Record platform fee (15% of custom prize pool)
            await connection.execute(
              `INSERT INTO revenue (tournament_id, amount, revenue_date, notes) 
               VALUES (NULL, ?, NOW(), '15% platform fee from custom prize match')`,
              [platformFee]
            );
            
          } else {
            // XP match - no platform fee
            if (agreedWinnerId === match.player1_id) {
              // Creator wins: gets custom prize + opponent's entry fee
              const totalForCreator = customPrizePool + stakeAmount;
              
              await connection.execute(
                'UPDATE users SET xp_points = COALESCE(xp_points, 0) + ? WHERE id = ?',
                [totalForCreator, match.player1_id]
              );
              
              // Create XP transaction for creator
              await connection.execute(
                `INSERT INTO xp_transactions (user_id, type, amount, description, match_id) 
                 VALUES (?, 'match_win', ?, ?, ?)`,
                [
                  match.player1_id,
                  totalForCreator,
                  `Custom XP prize winnings from ${match.game} match`,
                  matchId
                ]
              );
            } else {
              // Opponent wins: gets custom prize only
              await connection.execute(
                'UPDATE users SET xp_points = COALESCE(xp_points, 0) + ? WHERE id = ?',
                [customPrizePool, match.player2_id]
              );
              
              // Create XP transaction for opponent
              await connection.execute(
                `INSERT INTO xp_transactions (user_id, type, amount, description, match_id) 
                 VALUES (?, 'match_win', ?, ?, ?)`,
                [
                  match.player2_id,
                  customPrizePool,
                  `Custom XP prize winnings from ${match.game} match`,
                  matchId
                ]
              );
              
              // Creator gets opponent's entry fee back
              await connection.execute(
                'UPDATE users SET xp_points = COALESCE(xp_points, 0) + ? WHERE id = ?',
                [stakeAmount, match.player1_id]
              );
              
              // Create XP transaction for creator (entry fee return)
              await connection.execute(
                `INSERT INTO xp_transactions (user_id, type, amount, description, match_id) 
                 VALUES (?, 'match_entry_return', ?, ?, ?)`,
                [
                  match.player1_id,
                  stakeAmount,
                  `Entry fee return from ${match.game}`,
                  matchId
                ]
              );
            }
          }
        }
        
        await connection.commit();
        connection.release();
        
        console.log('✅ Prize distributed successfully');
        
        // Send notification to both players
        const winnerUsername = agreedWinnerId === match.player1_id ? match.player1_username : match.player2_username;
        const loserId = agreedWinnerId === match.player1_id ? match.player2_id : match.player1_id;
        
        // Notify winner
        await NotificationService.createNotification({
          userId: agreedWinnerId,
          senderId: null,
          message: `🎉 You won the match!`,
          type: 'match_completed',
          matchId: matchId
        });
        
        // Notify loser
        await NotificationService.createNotification({
          userId: loserId,
          senderId: null,
          message: `Match completed. Winner: ${winnerUsername}`,
          type: 'match_completed',
          matchId: matchId
        });
        
        return res.json({
          success: true,
          message: `✅ Match completed! Prize distributed to ${winnerUsername}.`,
          status: 'completed',
          winner: agreedWinnerId,
          winner_username: winnerUsername
        });
        
      } else {
        // Disagreement - different winners selected
        await connection.execute(
          'UPDATE matches SET status = "disputed" WHERE id = ?',
          [matchId]
        );
        
        // Create dispute record
        await connection.execute(
          'INSERT INTO match_disputes (match_id, disputing_user_id, reason, status) VALUES (?, ?, ?, "open")',
          [matchId, userId, 'Players disagree on winner']
        );

        await connection.commit();
        connection.release();
        
        // Notify both players
        const players = [match.player1_id, match.player2_id];
        for (const playerId of players) {
          await NotificationService.createNotification({
            userId: playerId,
            senderId: userId,
            message: 'Players disagree on winner. Match disputed and sent to admin.',
            type: 'match_disputed',
            matchId: matchId
          });
        }
        
        return res.json({
          success: true,
          message: '⚠️ Players disagree on winner. Match disputed and sent to admin.',
          status: 'disputed'
        });
      }
    } else {
      // Only one player submitted so far
      await connection.commit();
      connection.release();
      
      const opponentId = userId === match.player1_id ? match.player2_id : match.player1_id;
      await NotificationService.createNotification({
        userId: opponentId,
        senderId: userId,
        message: `${req.user.username} submitted match results. Please submit yours.`,
        type: 'result_submitted',
        matchId: matchId
      });
      
      return res.json({
        success: true,
        message: '✅ Result submitted. Waiting for opponent to submit.',
        status: 'awaiting_opponent',
        submitted_by: userId
      });
    }

  } catch (error) {
    await connection.rollback();
    connection.release();
    console.error('Submit result error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to submit result: ' + error.message
    });
  }
});

// ==================== 6. CONFIRM/CONTEST RESULT (FOR BACKWARD COMPATIBILITY) ====================
router.post('/:id/confirm', authenticateToken, async (req, res) => {
  try {
    const matchId = req.params.id;
    
    const match = await getMatchWithDetails(matchId);
    
    if (!match) {
      return res.status(404).json({
        success: false,
        error: 'Match not found'
      });
    }
    
    // If match already completed, return info
    if (match.status === 'completed') {
      return res.json({
        success: true,
        message: '✅ Match already completed. Prize already distributed.',
        status: 'completed',
        winner: match.winner_username
      });
    }
    
    // If not completed, explain new system
    return res.json({
      success: false,
      error: 'Match not completed. Both players need to submit results through the result submission.',
      current_status: match.status
    });

  } catch (error) {
    console.error('Confirm result error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process confirmation'
    });
  }
});

// ==================== 7. GET MATCH DETAILS WITH CORRECT DISPLAY ====================
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const matchId = req.params.id;
    
    const match = await getMatchWithDetails(matchId, req.user.id);
    
    if (!match) {
      return res.status(404).json({
        success: false,
        error: 'Match not found'
      });
    }

    // Get match results
    const [results] = await db.execute(
      `SELECT mr.*, u.username as submitter_username 
       FROM match_results mr
       JOIN users u ON mr.user_id = u.id
       WHERE mr.match_id = ?
       ORDER BY mr.submitted_at DESC`,
      [matchId]
    );

    // Get match disputes if any
    const [disputes] = await db.execute(
      `SELECT md.*, u.username as disputer_username 
       FROM match_disputes md
       JOIN users u ON md.disputing_user_id = u.id
       WHERE md.match_id = ?`,
      [matchId]
    );

    // Calculate correct display values
    const individualStake = parseFloat(match.stake_amount);
    const totalStakes = individualStake * 2;
    const platformFee = parseFloat(match.platform_fee || 0);
    const prizePool = parseFloat(match.prize_pool_amount);

    res.json({
      success: true,
      match: {
        ...match,
        individual_stake: individualStake,
        total_stakes: totalStakes,
        platform_fee: platformFee,
        prize_pool_calculated: prizePool,
        results: results,
        disputes: disputes
      }
    });

  } catch (error) {
    console.error('Get match error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch match details'
    });
  }
});

// ==================== 8. GET ALL MATCHES ====================
router.get('/', authenticateToken, async (req, res) => {
  try {
    const [matches] = await db.execute(
      `SELECT 
        m.*,
        p1.username as player1_username,
        p1.rank as player1_rank,
        p2.username as player2_username,
        p2.rank as player2_rank,
        w.username as winner_username,
        (m.stake_amount * 2) as total_stakes,
        -- FIXED: Platform fee based on prize pool option
        CASE 
          WHEN m.stake_currency = 'money' AND m.prize_pool_option = 'entry_fee' THEN m.stake_amount * 2 * 0.15
          WHEN m.stake_currency = 'money' AND m.prize_pool_option = 'custom' THEN m.custom_prize_pool * 0.15
          ELSE 0
        END as platform_fee,
        CASE 
          WHEN m.player1_id = ? THEN 'creator'
          WHEN m.player2_id = ? THEN 'opponent'
          ELSE 'viewer'
        END as user_role
       FROM matches m
       LEFT JOIN users p1 ON m.player1_id = p1.id
       LEFT JOIN users p2 ON m.player2_id = p2.id
       LEFT JOIN users w ON m.winner_id = w.id
       WHERE (m.opponent_type = 'open' OR m.player1_id = ? OR m.player2_id = ? OR 
              (m.opponent_type = 'specific' AND m.opponent_username = (
                SELECT username FROM users WHERE id = ?
              )))
       ORDER BY 
         CASE m.status 
           WHEN 'ongoing' THEN 1
           WHEN 'pending' THEN 2
           WHEN 'pending_confirmation' THEN 3
           ELSE 4 
         END,
         m.created_at DESC`,
      [req.user.id, req.user.id, req.user.id, req.user.id, req.user.id]
    );

    res.json({
      success: true,
      matches: matches.map(match => ({
        ...match,
        individual_stake: parseFloat(match.stake_amount),
        total_stakes: parseFloat(match.stake_amount) * 2
      }))
    });
  } catch (error) {
    console.error('Get matches error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch matches'
    });
  }
});

// ==================== 9. GET PENDING INVITATIONS ====================
router.get('/invitations/pending', authenticateToken, async (req, res) => {
  try {
    const [invitations] = await db.execute(
      `SELECT m.*,
              p1.username as player1_username,
              p1.profile_pic as player1_profile_pic,
              p1.rank as player1_rank,
              (m.stake_amount * 2) as total_stakes,
              -- FIXED: Platform fee based on prize pool option
              CASE 
                WHEN m.stake_currency = 'money' AND m.prize_pool_option = 'entry_fee' THEN m.stake_amount * 2 * 0.15
                WHEN m.stake_currency = 'money' AND m.prize_pool_option = 'custom' THEN m.custom_prize_pool * 0.15
                ELSE 0
              END as platform_fee
       FROM matches m
       JOIN users p1 ON m.player1_id = p1.id
       WHERE m.status = 'pending'
         AND m.opponent_type = 'specific'
         AND m.opponent_username = ?
         AND m.player2_id IS NULL
       ORDER BY m.created_at DESC`,
      [req.user.username]
    );

    res.json({
      success: true,
      invitations: invitations.map(invite => ({
        ...invite,
        individual_stake: parseFloat(invite.stake_amount),
        total_stakes: parseFloat(invite.stake_amount) * 2
      }))
    });
  } catch (error) {
    console.error('Get pending invitations error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch invitations'
    });
  }
});

// ==================== 10. CANCEL MATCH ====================
router.post('/:id/cancel', authenticateToken, async (req, res) => {
  try {
    const matchId = req.params.id;
    
    const match = await getMatchWithDetails(matchId);
    
    if (!match) {
      return res.status(404).json({
        success: false,
        error: 'Match not found'
      });
    }

    // Check if user can cancel
    if (match.player1_id !== req.user.id || match.status !== 'pending') {
      return res.status(403).json({
        success: false,
        error: 'Only the creator can cancel a pending match'
      });
    }

    // Update match status
    await db.execute(
      'UPDATE matches SET status = "cancelled", completed_at = NOW() WHERE id = ?',
      [matchId]
    );

    // Notify opponent if it was a specific invitation
    if (match.opponent_type === 'specific' && match.opponent_username) {
      const [opponent] = await db.execute(
        'SELECT id FROM users WHERE username = ?',
        [match.opponent_username]
      );
      
      if (opponent.length > 0) {
        await NotificationService.createNotification({
          userId: opponent[0].id,
          senderId: req.user.id,
          message: `${req.user.username} cancelled the match invitation`,
          type: 'match_cancelled',
          matchId: matchId
        });
      }
    }

    res.json({
      success: true,
      message: 'Match cancelled successfully'
    });

  } catch (error) {
    console.error('Cancel match error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to cancel match'
    });
  }
});

// ==================== 11. GET USER MATCH STATS ====================
router.get('/user/stats', authenticateToken, async (req, res) => {
  try {
    const [stats] = await db.execute(
      `SELECT 
        COUNT(*) as total_matches,
        SUM(CASE WHEN winner_id = ? THEN 1 ELSE 0 END) as wins,
        SUM(CASE WHEN winner_id != ? AND winner_id IS NOT NULL THEN 1 ELSE 0 END) as losses,
        SUM(CASE WHEN status = 'completed' AND stake_currency = 'money' THEN prize_pool_amount ELSE 0 END) as total_winnings_money,
        SUM(CASE WHEN status = 'completed' AND stake_currency = 'xp' THEN prize_pool_amount ELSE 0 END) as total_winnings_xp,
        AVG(CASE WHEN winner_id = ? THEN 1 ELSE 0 END) * 100 as win_rate
       FROM matches
       WHERE (player1_id = ? OR player2_id = ?)
         AND status = 'completed'`,
      [req.user.id, req.user.id, req.user.id, req.user.id, req.user.id]
    );

    // Get recent match history
    const [recentMatches] = await db.execute(
      `SELECT m.*,
              p1.username as player1_username,
              p2.username as player2_username,
              w.username as winner_username,
              (m.stake_amount * 2) as total_stakes
       FROM matches m
       LEFT JOIN users p1 ON m.player1_id = p1.id
       LEFT JOIN users p2 ON m.player2_id = p2.id
       LEFT JOIN users w ON m.winner_id = w.id
       WHERE (m.player1_id = ? OR m.player2_id = ?)
       ORDER BY m.created_at DESC
       LIMIT 10`,
      [req.user.id, req.user.id]
    );

    res.json({
      success: true,
      stats: stats[0] || {},
      recent_matches: recentMatches.map(match => ({
        ...match,
        individual_stake: parseFloat(match.stake_amount),
        total_stakes: parseFloat(match.stake_amount) * 2
      }))
    });

  } catch (error) {
    console.error('Get user stats error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch user stats'
    });
  }
});

// ==================== 12. GET USER MATCH HISTORY ====================
router.get('/user/history', authenticateToken, async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    const [matches] = await db.execute(
      `SELECT m.*,
              p1.username as player1_username,
              p2.username as player2_username,
              w.username as winner_username,
              (m.stake_amount * 2) as total_stakes,
              -- FIXED: Platform fee based on prize pool option
              CASE 
                WHEN m.stake_currency = 'money' AND m.prize_pool_option = 'entry_fee' THEN m.stake_amount * 2 * 0.15
                WHEN m.stake_currency = 'money' AND m.prize_pool_option = 'custom' THEN m.custom_prize_pool * 0.15
                ELSE 0
              END as platform_fee
       FROM matches m
       LEFT JOIN users p1 ON m.player1_id = p1.id
       LEFT JOIN users p2 ON m.player2_id = p2.id
       LEFT JOIN users w ON m.winner_id = w.id
       WHERE (m.player1_id = ? OR m.player2_id = ?)
       ORDER BY m.created_at DESC
       LIMIT ? OFFSET ?`,
      [req.user.id, req.user.id, parseInt(limit), offset]
    );

    const [total] = await db.execute(
      `SELECT COUNT(*) as total
       FROM matches
       WHERE player1_id = ? OR player2_id = ?`,
      [req.user.id, req.user.id]
    );

    res.json({
      success: true,
      matches: matches.map(match => ({
        ...match,
        individual_stake: parseFloat(match.stake_amount),
        total_stakes: parseFloat(match.stake_amount) * 2
      })),
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: total[0].total,
        pages: Math.ceil(total[0].total / limit)
      }
    });

  } catch (error) {
    console.error('Get user history error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch match history'
    });
  }
});

// ==================== 13. FIX PRIZE POOL FOR EXISTING MATCHES ====================
router.post('/admin/fix-prizes', authenticateToken, async (req, res) => {
  try {
    // Check if user is admin
    const [user] = await db.execute(
      'SELECT is_admin FROM users WHERE id = ?',
      [req.user.id]
    );
    
    if (!user[0] || !user[0].is_admin) {
      return res.status(403).json({
        success: false,
        error: 'Admin access required'
      });
    }

    // Fix XP matches with wrong prize pools
    await db.execute(
      `UPDATE matches 
       SET prize_pool_amount = stake_amount * 2 
       WHERE stake_currency = 'xp' 
       AND prize_pool_option = 'entry_fee' 
       AND prize_pool_amount != stake_amount * 2`
    );

    // Fix money matches with wrong prize pools
    await db.execute(
      `UPDATE matches 
       SET prize_pool_amount = stake_amount * 2 * 0.85 
       WHERE stake_currency = 'money' 
       AND prize_pool_option = 'entry_fee' 
       AND ABS(prize_pool_amount - (stake_amount * 2 * 0.85)) > 0.01`
    );

    // Fix custom prize pool matches
    await db.execute(
      `UPDATE matches 
       SET prize_pool_amount = custom_prize_pool 
       WHERE prize_pool_option = 'custom' 
       AND prize_pool_amount != custom_prize_pool`
    );

    const [fixedXP] = await db.execute(
      'SELECT ROW_COUNT() as xp_fixed'
    );
    
    const [fixedMoney] = await db.execute(
      'SELECT ROW_COUNT() as money_fixed'
    );
    
    const [fixedCustom] = await db.execute(
      'SELECT ROW_COUNT() as custom_fixed'
    );

    res.json({
      success: true,
      message: 'Prize pools fixed',
      xp_matches_fixed: fixedXP[0].xp_fixed,
      money_matches_fixed: fixedMoney[0].money_fixed,
      custom_matches_fixed: fixedCustom[0].custom_fixed
    });

  } catch (error) {
    console.error('Fix prizes error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fix prize pools'
    });
  }
});

module.exports = router;
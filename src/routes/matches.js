const express = require('express');
const Joi = require('joi');
const { authenticateToken } = require('../middleware/auth');
const db = require('../config/database');
const NotificationService = require('../services/notificationService');

const router = express.Router();

// ==================== DEBUG LOGGING HELPER ====================
const debugLog = (req, endpoint = '') => {
  console.log(`=== ${req.method} ${req.originalUrl} === ${endpoint}`);
  console.log('User:', req.user?.id, req.user?.username);
  console.log('Params:', req.params);
  console.log('Body:', req.body);
};

// ==================== HELPER FUNCTIONS FOR [rows, fields] FORMAT ====================
const getFirstRow = (result) => {
  if (!result) return null;
  
  if (Array.isArray(result) && result.length >= 1) {
    const rows = result[0];
    if (Array.isArray(rows)) {
      return rows.length > 0 ? rows[0] : null;
    }
  }
  
  if (Array.isArray(result)) {
    return result.length > 0 ? result[0] : null;
  }
  
  if (result.data !== undefined) {
    return result.data && result.data.length > 0 ? result.data[0] : null;
  }
  
  return null;
};

const getAllRows = (result) => {
  if (!result) return [];
  
  if (Array.isArray(result) && result.length >= 1) {
    const rows = result[0];
    if (Array.isArray(rows)) {
      return rows;
    }
  }
  
  if (Array.isArray(result)) {
    return result;
  }
  
  if (result.data !== undefined) {
    return result.data || [];
  }
  
  return [];
};

const executeQuery = async (queryFn, ...args) => {
  if (db.isSupabase) {
    return await queryFn(...args);
  } else {
    return await db.query(...args);
  }
};

// XP Transaction Types
const XP_TYPES = {
  EARNED: 'earned',
  SPENT: 'spent',
  TRANSFERRED_IN: 'transferred_in',
  TRANSFERRED_OUT: 'transferred_out',
  CONVERTED_FROM_MONEY: 'converted_from_money',
  CONVERTED_TO_MONEY: 'converted_to_money'
};

// ==================== CONSTANTS ====================
const XP_CONVERSION_RATE = 25;
const PLATFORM_FEE_PERCENT = 15;
const MIN_STAKE_MONEY = 100;
const MIN_STAKE_XP = 0;

// ==================== VALIDATION SCHEMAS ====================
const createMatchSchema = Joi.object({
  game: Joi.string().required(),
  stake_amount: Joi.number().min(0).default(0),
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
  stake_currency: Joi.string().valid('xp').required(),
  admin_monitoring: Joi.boolean().optional().default(false)
});

const submitResultSchema = Joi.object({
  winner_id: Joi.number().integer().required()
});

// ==================== UTILITY FUNCTIONS ====================
const executeTransaction = async (operations) => {
  if (db.isSupabase) {
    try {
      for (const operation of operations) {
        const { error } = await db.supabaseAdmin
          .from(operation.table)
          [operation.method](operation.data)
          .match(operation.match || {});
        
        if (error) throw error;
      }
      return { success: true };
    } catch (error) {
      throw error;
    }
  } else {
    const connection = await db.pool.connect();
    try {
      await connection.query('BEGIN');
      
      for (const operation of operations) {
        await connection.query(operation.query, operation.params || []);
      }
      
      await connection.query('COMMIT');
      connection.release();
      return { success: true };
    } catch (error) {
      await connection.query('ROLLBACK');
      connection.release();
      throw error;
    }
  }
};

const getMatchWithDetails = async (matchId, userId = null) => {
  if (db.isSupabase) {
    try {
      let query = db.supabaseAdmin
        .from('matches')
        .select(`
          *,
          player1:player1_id (id, username, rank, profile_pic, balance, xp_points),
          player2:player2_id (id, username, rank, profile_pic, balance, xp_points),
          winner:winner_id (username)
        `)
        .eq('id', matchId);

      const { data: matchData, error } = await query.single();
      
      if (error || !matchData) return null;

      const match = {
        ...matchData,
        player1_username: matchData.player1?.username,
        player1_rank: matchData.player1?.rank,
        player1_profile_pic: matchData.player1?.profile_pic,
        player1_balance: matchData.player1?.balance,
        player1_xp: matchData.player1?.xp_points,
        player2_username: matchData.player2?.username,
        player2_rank: matchData.player2?.rank,
        player2_profile_pic: matchData.player2?.profile_pic,
        player2_balance: matchData.player2?.balance,
        player2_xp: matchData.player2?.xp_points,
        winner_username: matchData.winner?.username,
        total_stakes: (matchData.stake_amount || 0) * 2,
        platform_fee: matchData.stake_currency === 'money' && matchData.prize_pool_option === 'entry_fee' 
          ? (matchData.stake_amount || 0) * 2 * 0.15
          : matchData.stake_currency === 'money' && matchData.prize_pool_option === 'custom'
            ? (matchData.custom_prize_pool || 0) * 0.15
            : 0,
        requires_admin_monitoring: matchData.admin_monitoring || matchData.opponent_type === 'open'
      };

      if (userId !== null) {
        const userHasAccess = 
          matchData.player1_id === userId ||
          matchData.player2_id === userId ||
          matchData.opponent_type === 'open' ||
          (matchData.opponent_type === 'specific' && 
           matchData.opponent_username === (await getUserUsername(userId)));
        
        if (!userHasAccess) return null;
        match.user_has_access = true;
      }

      return match;

    } catch (error) {
      console.error('Error in getMatchWithDetails (Supabase):', error);
      return null;
    }
  } else {
    let query;
    let params;
    
    if (userId === null) {
      query = `
        SELECT 
          m.*,
          p1.username AS player1_username,
          p1.rank AS player1_rank,
          p1.profile_pic AS player1_profile_pic,
          p2.username AS player2_username,
          p2.rank AS player2_rank,
          p2.profile_pic AS player2_profile_pic,
          w.username AS winner_username,
          p1.balance AS player1_balance,
          p1.xp_points AS player1_xp,
          p2.balance AS player2_balance,
          p2.xp_points AS player2_xp,
          (m.stake_amount * 2) AS total_stakes,
          CASE 
            WHEN m.stake_currency = 'money' AND m.prize_pool_option = 'entry_fee' THEN m.stake_amount * 2 * 0.15
            WHEN m.stake_currency = 'money' AND m.prize_pool_option = 'custom' THEN m.custom_prize_pool * 0.15
            ELSE 0
          END AS platform_fee,
          CASE 
            WHEN m.admin_monitoring = true THEN true
            WHEN m.opponent_type = 'open' THEN true
            ELSE false
          END AS requires_admin_monitoring,
          true AS user_has_access
        FROM matches m
        LEFT JOIN users p1 ON m.player1_id = p1.id
        LEFT JOIN users p2 ON m.player2_id = p2.id
        LEFT JOIN users w ON m.winner_id = w.id
        WHERE m.id = $1
      `;
      params = [matchId];
    } else {
      query = `
        SELECT 
          m.*,
          p1.username AS player1_username,
          p1.rank AS player1_rank,
          p1.profile_pic AS player1_profile_pic,
          p2.username AS player2_username,
          p2.rank AS player2_rank,
          p2.profile_pic AS player2_profile_pic,
          w.username AS winner_username,
          p1.balance AS player1_balance,
          p1.xp_points AS player1_xp,
          p2.balance AS player2_balance,
          p2.xp_points AS player2_xp,
          (m.stake_amount * 2) AS total_stakes,
          CASE 
            WHEN m.stake_currency = 'money' AND m.prize_pool_option = 'entry_fee' THEN m.stake_amount * 2 * 0.15
            WHEN m.stake_currency = 'money' AND m.prize_pool_option = 'custom' THEN m.custom_prize_pool * 0.15
            ELSE 0
          END AS platform_fee,
          CASE 
            WHEN m.admin_monitoring = true THEN true
            WHEN m.opponent_type = 'open' THEN true
            ELSE false
          END AS requires_admin_monitoring,
          CASE 
            WHEN m.player1_id = $2 THEN true
            WHEN m.player2_id = $3 THEN true
            WHEN m.opponent_type = 'open' THEN true
            WHEN m.opponent_type = 'specific' AND m.opponent_username = (
              SELECT username FROM users WHERE id = $4
            ) THEN true
            ELSE false
          END AS user_has_access
        FROM matches m
        LEFT JOIN users p1 ON m.player1_id = p1.id
        LEFT JOIN users p2 ON m.player2_id = p2.id
        LEFT JOIN users w ON m.winner_id = w.id
        WHERE m.id = $1
      `;
      params = [matchId, userId, userId, userId];
    }
    
    const result = await db.query(query, params);
    const rows = result[0] || [];
    
    if (rows.length === 0) return null;
    
    const match = rows[0];
    
    if (userId !== null && !match.user_has_access) return null;
    
    return match;
  }
};

const getUserUsername = async (userId) => {
  if (db.isSupabase) {
    const { data } = await db.supabaseAdmin
      .from('users')
      .select('username')
      .eq('id', userId)
      .single();
    return data?.username;
  } else {
    const result = await db.query('SELECT username FROM users WHERE id = $1', [userId]);
    const user = getFirstRow(result);
    return user?.username;
  }
};

// ==================== TEST ENDPOINTS ====================
router.get('/test', (req, res) => {
  console.log('✅ Matches router test endpoint hit');
  res.json({
    success: true,
    message: 'Matches router is working',
    timestamp: new Date().toISOString()
  });
});

router.get('/:id/debug', authenticateToken, async (req, res) => {
  debugLog(req, 'DEBUG MATCH');
  
  try {
    const matchId = req.params.id;
    
    let match;
    if (db.isSupabase) {
      const { data, error } = await db.supabaseAdmin
        .from('matches')
        .select('id, game, status, opponent_type, player1_id, player2_id')
        .eq('id', matchId)
        .single();
      
      if (error) throw error;
      match = data;
    } else {
      const result = await db.query(
        'SELECT id, game, status, opponent_type, player1_id, player2_id FROM matches WHERE id = $1',
        [matchId]
      );
      match = getFirstRow(result);
    }
    
    if (!match) {
      return res.json({
        success: false,
        error: `Match ${matchId} not found in database`,
        database_check: 'NOT_FOUND'
      });
    }
    
    res.json({
      success: true,
      match: match,
      database_check: 'FOUND',
      endpoint_test: {
        join: `/api/matches/${matchId}/join`,
        accept: `/api/matches/${matchId}/accept`,
        chat: `/api/matches/${matchId}/chat`
      }
    });
    
  } catch (error) {
    console.error('Debug error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ==================== 1. CREATE MATCH ====================
router.post('/create', authenticateToken, async (req, res) => {
  debugLog(req, 'CREATE MATCH');
  
  try {
    console.log('🔍 [CREATE MATCH] Starting for user ID:', req.user.id);
    
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
      stake_currency,
      admin_monitoring
    } = value;

    const stakeAmount = parseFloat(stake_amount) || 0;
    const customPrizePool = custom_prize_pool ? parseFloat(custom_prize_pool) : 0;

    console.log('Stake amount:', stakeAmount);
    console.log('Custom prize pool:', customPrizePool);
    console.log('Prize pool option:', prize_pool_option);

    if (stake_currency === 'xp' && stakeAmount < 0) {
      return res.status(400).json({
        success: false,
        error: 'Stake amount cannot be negative'
      });
    }

    if (prize_pool_option === 'custom') {
      if (!custom_prize_pool) {
        return res.status(400).json({
          success: false,
          error: 'Custom prize pool amount is required for custom prize option'
        });
      }
      
      if (customPrizePool <= stakeAmount * 2) {
        return res.status(400).json({
          success: false,
          error: `Custom prize pool must be greater than ${stakeAmount * 2} (entry fee × 2)`
        });
      }
    }

    console.log('🔍 [CREATE MATCH] Querying user with ID:', req.user.id);
    
    let creator, creatorBalance, creatorXp;
    
    if (db.isSupabase) {
      const { data, error } = await db.supabaseAdmin
        .from('users')
        .select('balance, xp_points, username')
        .eq('id', req.user.id)
        .single();
      
      if (error) throw error;
      creator = data;
      creatorBalance = parseFloat(data.balance || 0);
      creatorXp = parseInt(data.xp_points || 0);
    } else {
      const creatorResult = await db.query(
        'SELECT balance, xp_points, username FROM users WHERE id = $1',
        [req.user.id]
      );
      const creatorRows = creatorResult[0] || [];
      console.log('🔍 [CREATE MATCH] Creator rows:', creatorRows);
      
      if (creatorRows.length === 0) {
        console.log('❌ User not found in database');
        return res.status(400).json({
          success: false,
          error: 'User not found in database'
        });
      }
      creator = creatorRows[0];
      creatorBalance = parseFloat(creator.balance || 0);
      creatorXp = parseInt(creator.xp_points || 0);
    }

    console.log('Creator XP:', creatorXp);

    if (prize_pool_option === 'custom') {
      if (stake_currency === 'xp') {
        if (creatorXp < customPrizePool) {
          return res.status(400).json({
            success: false,
            error: `Insufficient XP for custom prize pool. You have ${creatorXp} XP, need ${customPrizePool} XP`
          });
        }
      }
    } else {
      if (stake_currency === 'xp' && stakeAmount > 0 && creatorXp < stakeAmount) {
        return res.status(400).json({
          success: false,
          error: `Insufficient XP. You have ${creatorXp} XP, need ${stakeAmount} XP`
        });
      }
    }

    let invitedPlayerId = null;
    if (opponent_type === 'specific' && specific_username) {
      let users;
      
      if (db.isSupabase) {
        const { data, error } = await db.supabaseAdmin
          .from('users')
          .select('id, username')
          .eq('username', specific_username)
          .eq('is_banned', false);
        
        if (error) throw error;
        users = data || [];
      } else {
        const usersResult = await db.query(
          'SELECT id, username FROM users WHERE username = $1 AND is_banned = false',
          [specific_username]
        );
        users = usersResult[0] || [];
      }

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
      
      if (db.isSupabase) {
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        
        const { data, error } = await db.supabaseAdmin
          .from('matches')
          .select('count', { count: 'exact', head: true })
          .eq('status', 'completed')
          .or(`and(player1_id.eq.${req.user.id},player2_id.eq.${invitedPlayerId}),and(player1_id.eq.${invitedPlayerId},player2_id.eq.${req.user.id})`)
          .gte('created_at', sevenDaysAgo.toISOString());
        
        if (error) throw error;
        
        if (data && data.length >= 3) {
          return res.status(400).json({
            success: false,
            error: 'Cannot play the same opponent more than 3 times in a week'
          });
        }
      } else {
        const recentMatchesResult = await db.query(
          `SELECT COUNT(*) AS count FROM matches 
           WHERE status = 'completed'
           AND ((player1_id = $1 AND player2_id = $2) OR (player1_id = $3 AND player2_id = $4))
           AND created_at > NOW() - INTERVAL '7 days'`,
          [req.user.id, invitedPlayerId, invitedPlayerId, req.user.id]
        );
        
        const recentMatchesRows = recentMatchesResult[0] || [];
        const recentMatches = recentMatchesRows[0];
        
        if (parseInt(recentMatches?.count || 0) >= 3) {
          return res.status(400).json({
            success: false,
            error: 'Cannot play the same opponent more than 3 times in a week'
          });
        }
      }
    }

    let prize_pool_amount = 0;
    if (prize_pool_option === 'entry_fee') {
      const totalStakes = stakeAmount * 2;
      
      if (stake_currency === 'money') {
        prize_pool_amount = totalStakes * (1 - PLATFORM_FEE_PERCENT / 100);
      } else {
        prize_pool_amount = totalStakes;
      }
    } else {
      prize_pool_amount = customPrizePool;
    }

    let matchId;
    
    if (db.isSupabase) {
      const { data, error } = await db.supabaseAdmin
        .from('matches')
        .insert([{
          player1_id: req.user.id,
          player2_id: null,
          game_type: 'individual',
          game: game,
          stake_amount: stakeAmount,
          prize_pool_amount: prize_pool_amount,
          custom_prize_pool: customPrizePool || null,
          prize_pool_option: prize_pool_option,
          opponent_type: opponent_type,
          opponent_username: specific_username,
          status: 'pending',
          scheduled_at: scheduled_at,
          stake_currency: stake_currency,
          stake_currency_type: 'XP',
          stake_xp_amount: stake_currency === 'xp' ? stakeAmount : null,
          admin_monitoring: admin_monitoring || false,
          match_chat_enabled: true
        }])
        .select();
      
      if (error) throw error;
      matchId = data[0].id;
    } else {
      const resultResult = await db.query(
        `INSERT INTO matches (
          player1_id, player2_id, game_type, game, stake_amount, 
          prize_pool_amount, custom_prize_pool, prize_pool_option,
          opponent_type, opponent_username, status, scheduled_at,
          stake_currency, stake_currency_type, stake_xp_amount,
          admin_monitoring, match_chat_enabled
        ) VALUES ($1, NULL, 'individual', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING id`,
        [
          req.user.id,
          game,
          stakeAmount,
          prize_pool_amount,
          customPrizePool || null,
          prize_pool_option,
          opponent_type,
          specific_username,
          'pending',
          scheduled_at,
          stake_currency,
          'XP',
          stake_currency === 'xp' ? stakeAmount : null,
          admin_monitoring || false,
          true
        ]
      );

      const resultRows = resultResult[0] || [];
      const result = resultRows[0];
      matchId = result.id;
    }

    if (invitedPlayerId) {
      const stakeDisplay = stake_currency === 'money' 
        ? `₦${stakeAmount}` 
        : `${stakeAmount} XP`;
      
      await NotificationService.createNotification({
        userId: invitedPlayerId,
        senderId: req.user.id,
        message: `${creator.username} challenged you to a ${game} match with ${stakeDisplay} stake!`,
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
      error: 'Failed to create match: ' + error.message
    });
  }
});

// ==================== 2. JOIN MATCH ====================
router.post('/:id/join', authenticateToken, async (req, res) => {
  debugLog(req, 'JOIN MATCH');
  
  if (db.isSupabase) {
    try {
      const matchId = req.params.id;
      const userId = req.user.id;

      console.log('🔍 Checking match ID:', matchId);

      const { data: match, error: matchError } = await db.supabaseAdmin
        .from('matches')
        .select(`
          *,
          player1:player1_id (username, balance, xp_points),
          player2:player2_id (username, balance, xp_points)
        `)
        .eq('id', matchId)
        .single();

      if (matchError || !match) {
        console.log('❌ Match not found in database');
        return res.status(404).json({
          success: false,
          error: 'Match not found'
        });
      }

      console.log('✅ Match found:', {
        id: match.id,
        game: match.game,
        status: match.status,
        opponent_type: match.opponent_type,
        player1_id: match.player1_id,
        player2_id: match.player2_id,
        stake_amount: match.stake_amount,
        stake_currency: match.stake_currency
      });

      const stakeAmount = parseFloat(match.stake_amount || 0);
      const customPrizePool = parseFloat(match.custom_prize_pool || 0);
      const player1Xp = parseFloat(match.player1?.xp_points || 0);

      if (match.opponent_type !== 'open') {
        console.log('❌ Match is not open:', match.opponent_type);
        return res.status(400).json({
          success: false,
          error: 'This match is not open for joining'
        });
      }

      if (match.status !== 'pending') {
        console.log('❌ Match status not pending:', match.status);
        return res.status(400).json({
          success: false,
          error: `Match is ${match.status}, cannot join`
        });
      }

      if (match.player2_id) {
        console.log('❌ Match already has opponent:', match.player2_id);
        return res.status(400).json({
          success: false,
          error: 'This match already has an opponent'
        });
      }

      if (match.player1_id === userId) {
        console.log('❌ User trying to join own match');
        return res.status(400).json({
          success: false,
          error: 'You cannot join your own match'
        });
      }

      const { data: acceptorData, error: acceptorError } = await db.supabaseAdmin
        .from('users')
        .select('balance, xp_points, username')
        .eq('id', userId)
        .single();

      if (acceptorError || !acceptorData) {
        console.log('❌ Acceptor user not found');
        return res.status(404).json({
          success: false,
          error: 'User not found'
        });
      }

      const acceptorBalance = parseFloat(acceptorData.balance || 0);
      const acceptorXp = parseFloat(acceptorData.xp_points || 0);
      const acceptorUsername = acceptorData.username;

      console.log('👤 Acceptor details:', {
        username: acceptorUsername,
        xp: acceptorXp,
        requiredStake: stakeAmount
      });

      if (match.stake_currency === 'money') {
        if (acceptorBalance < stakeAmount) {
          return res.status(400).json({
            success: false,
            error: `Insufficient balance. You have ₦${acceptorBalance}, need ₦${stakeAmount}`
          });
        }
      } else {
        if (acceptorXp < stakeAmount) {
          return res.status(400).json({
            success: false,
            error: `Insufficient XP. You have ${acceptorXp} XP, need ${stakeAmount} XP`
          });
        }
      }

      if (match.prize_pool_option === 'custom') {
        if (match.stake_currency === 'xp') {
          if (!player1Xp || player1Xp < customPrizePool) {
            return res.status(400).json({
              success: false,
              error: 'Creator no longer has sufficient XP for custom prize pool'
            });
          }
        }
      } else {
        if (match.stake_currency === 'xp') {
          if (!player1Xp || player1Xp < stakeAmount) {
            return res.status(400).json({
              success: false,
              error: 'Creator no longer has sufficient XP'
            });
          }
        }
      }

      console.log('✅ All validations passed, proceeding with deductions...');

      if (match.stake_currency === 'money') {
        const { data: currentUser } = await db.supabaseAdmin
          .from('users')
          .select('balance')
          .eq('id', userId)
          .single();
        
        const newBalance = parseFloat(currentUser?.balance || 0) - stakeAmount;
        
        const { error: updateError } = await db.supabaseAdmin
          .from('users')
          .update({ balance: newBalance })
          .eq('id', userId);
        
        if (updateError) throw updateError;

        const { error: txError } = await db.supabaseAdmin
          .from('transactions')
          .insert([{
            user_id: userId,
            amount: -stakeAmount,
            type: 'match_entry',
            status: 'completed',
            reference: `MATCH-JOIN-${Date.now()}-${matchId}`,
            description: `Match entry for ${match.game || 'game'}`,
            currency: 'NGN'
          }]);
        
        if (txError) throw txError;
      } else {
        const { data: currentUser } = await db.supabaseAdmin
          .from('users')
          .select('xp_points')
          .eq('id', userId)
          .single();
        
        const newXpPoints = parseInt(currentUser?.xp_points || 0) - stakeAmount;
        
        const { error: updateError } = await db.supabaseAdmin
          .from('users')
          .update({ xp_points: newXpPoints })
          .eq('id', userId);
        
        if (updateError) throw updateError;

        const { error: txError } = await db.supabaseAdmin
          .from('xp_transactions')
          .insert([{
            user_id: userId,
            type: XP_TYPES.SPENT,
            amount: -stakeAmount,
            description: `XP stake for ${match.game || 'game'} match`,
            match_id: matchId,
            metadata: {
              match_id: matchId,
              stake_amount: stakeAmount,
              action: 'join_match'
            }
          }]);
        
        if (txError) throw txError;
      }

      if (match.prize_pool_option === 'custom') {
        if (match.stake_currency === 'money') {
          const { data: creatorUser } = await db.supabaseAdmin
            .from('users')
            .select('balance')
            .eq('id', match.player1_id)
            .single();
          
          const newCreatorBalance = parseFloat(creatorUser?.balance || 0) - customPrizePool;
          
          const { error: updateError } = await db.supabaseAdmin
            .from('users')
            .update({ balance: newCreatorBalance })
            .eq('id', match.player1_id);
          
          if (updateError) throw updateError;

          const { error: txError } = await db.supabaseAdmin
            .from('transactions')
            .insert([{
              user_id: match.player1_id,
              amount: -customPrizePool,
              type: 'match_entry',
              status: 'completed',
              reference: `MATCH-CUSTOM-${Date.now()}-${matchId}`,
              description: `Custom prize pool for ${match.game || 'game'}`,
              currency: 'NGN'
            }]);
          
          if (txError) throw txError;
        } else {
          const { data: creatorUser } = await db.supabaseAdmin
            .from('users')
            .select('xp_points')
            .eq('id', match.player1_id)
            .single();
          
          const newCreatorXp = parseInt(creatorUser?.xp_points || 0) - customPrizePool;
          
          const { error: updateError } = await db.supabaseAdmin
            .from('users')
            .update({ xp_points: newCreatorXp })
            .eq('id', match.player1_id);
          
          if (updateError) throw updateError;

          const { error: txError } = await db.supabaseAdmin
            .from('xp_transactions')
            .insert([{
              user_id: match.player1_id,
              type: XP_TYPES.SPENT,
              amount: -customPrizePool,
              description: `Custom XP prize pool for ${match.game || 'game'} match`,
              match_id: matchId,
              metadata: {
                match_id: matchId,
                custom_prize: customPrizePool,
                action: 'custom_prize_hold'
              }
            }]);
          
          if (txError) throw txError;
        }
      } else {
        if (match.stake_currency === 'money') {
          const { data: creatorUser } = await db.supabaseAdmin
            .from('users')
            .select('balance')
            .eq('id', match.player1_id)
            .single();
          
          const newCreatorBalance = parseFloat(creatorUser?.balance || 0) - stakeAmount;
          
          const { error: updateError } = await db.supabaseAdmin
            .from('users')
            .update({ balance: newCreatorBalance })
            .eq('id', match.player1_id);
          
          if (updateError) throw updateError;

          const { error: txError } = await db.supabaseAdmin
            .from('transactions')
            .insert([{
              user_id: match.player1_id,
              amount: -stakeAmount,
              type: 'match_entry',
              status: 'completed',
              reference: `MATCH-CREATE-${Date.now()}-${matchId}`,
              description: `Match stake for ${match.game || 'game'}`,
              currency: 'NGN'
            }]);
          
          if (txError) throw txError;
        } else {
          const { data: creatorUser } = await db.supabaseAdmin
            .from('users')
            .select('xp_points')
            .eq('id', match.player1_id)
            .single();
          
          const newCreatorXp = parseInt(creatorUser?.xp_points || 0) - stakeAmount;
          
          const { error: updateError } = await db.supabaseAdmin
            .from('users')
            .update({ xp_points: newCreatorXp })
            .eq('id', match.player1_id);
          
          if (updateError) throw updateError;

          const { error: txError } = await db.supabaseAdmin
            .from('xp_transactions')
            .insert([{
              user_id: match.player1_id,
              type: XP_TYPES.SPENT,
              amount: -stakeAmount,
              description: `XP stake for ${match.game || 'game'} match`,
              match_id: matchId,
              metadata: {
                match_id: matchId,
                stake_amount: stakeAmount,
                action: 'create_match'
              }
            }]);
          
          if (txError) throw txError;
        }
      }

      console.log('✅ Deductions completed');

      const { error: matchUpdateError } = await db.supabaseAdmin
        .from('matches')
        .update({ 
          player2_id: userId, 
          status: 'ongoing', 
          started_at: new Date().toISOString() 
        })
        .eq('id', matchId);

      if (matchUpdateError) throw matchUpdateError;

      console.log('✅ Match status updated to ongoing');

      const { data: acceptorRankData } = await db.supabaseAdmin
        .from('users')
        .select('rank')
        .eq('id', userId)
        .single();

      const { data: creatorRankData } = await db.supabaseAdmin
        .from('users')
        .select('rank')
        .eq('id', match.player1_id)
        .single();

      const { error: attemptError } = await db.supabaseAdmin
        .from('match_attempts')
        .insert([{
          player1_id: match.player1_id,
          player2_id: userId,
          player1_rank: creatorRankData?.rank || 'E',
          player2_rank: acceptorRankData?.rank || 'E',
          match_id: matchId,
          created_at: new Date().toISOString()
        }]);

      if (attemptError) throw attemptError;

      console.log('✅ Match attempt record created');

      try {
        await NotificationService.createNotification({
          userId: match.player1_id,
          senderId: userId,
          message: `${acceptorUsername} joined your match!`,
          type: 'match_accepted',
          matchId: matchId
        });
        console.log('✅ Notification sent');
      } catch (notifError) {
        console.error('❌ Notification failed but match join succeeded:', notifError);
      }

      res.json({
        success: true,
        message: 'Match joined successfully! The game is now active.',
        matchId: matchId,
        stake_deducted: stakeAmount,
        custom_prize_deducted: match.prize_pool_option === 'custom' ? customPrizePool : null,
        currency: match.stake_currency
      });

    } catch (error) {
      console.error('❌ Join match error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to join match: ' + error.message
      });
    }
  } else {
    const connection = await db.pool.connect();
    
    try {
      await connection.query('BEGIN');

      const matchId = req.params.id;
      const userId = req.user.id;

      console.log('🔍 Checking match ID:', matchId);

      const matchesResult = await connection.query(
        `SELECT m.*,
                p1.username AS player1_username,
                p2.username AS player2_username,
                p1.balance AS player1_balance,
                p1.xp_points AS player1_xp,
                p2.balance AS player2_balance,
                p2.xp_points AS player2_xp
         FROM matches m
         LEFT JOIN users p1 ON m.player1_id = p1.id
         LEFT JOIN users p2 ON m.player2_id = p2.id
         WHERE m.id = $1`,
        [matchId]
      );

      const matchesRows = matchesResult.rows || [];
      console.log('✅ Database query returned', matchesRows.length, 'rows');
      
      if (matchesRows.length === 0) {
        await connection.query('ROLLBACK');
        connection.release();
        console.log('❌ Match not found in database');
        return res.status(404).json({
          success: false,
          error: 'Match not found'
        });
      }

      const match = matchesRows[0];
      console.log('✅ Match found:', {
        id: match.id,
        game: match.game,
        status: match.status,
        opponent_type: match.opponent_type,
        player1_id: match.player1_id,
        player2_id: match.player2_id,
        stake_amount: match.stake_amount,
        stake_currency: match.stake_currency
      });

      const stakeAmount = parseFloat(match.stake_amount || 0);
      const customPrizePool = parseFloat(match.custom_prize_pool || 0);
      const player1Xp = parseFloat(match.player1_xp || 0);

      if (match.opponent_type !== 'open') {
        await connection.query('ROLLBACK');
        connection.release();
        console.log('❌ Match is not open:', match.opponent_type);
        return res.status(400).json({
          success: false,
          error: 'This match is not open for joining'
        });
      }

      if (match.status !== 'pending') {
        await connection.query('ROLLBACK');
        connection.release();
        console.log('❌ Match status not pending:', match.status);
        return res.status(400).json({
          success: false,
          error: `Match is ${match.status}, cannot join`
        });
      }

      if (match.player2_id) {
        await connection.query('ROLLBACK');
        connection.release();
        console.log('❌ Match already has opponent:', match.player2_id);
        return res.status(400).json({
          success: false,
          error: 'This match already has an opponent'
        });
      }

      if (parseInt(match.player1_id) === parseInt(userId)) {
        await connection.query('ROLLBACK');
        connection.release();
        console.log('❌ User trying to join own match');
        return res.status(400).json({
          success: false,
          error: 'You cannot join your own match'
        });
      }

      const acceptorResult = await connection.query(
        'SELECT balance, xp_points, username FROM users WHERE id = $1',
        [userId]
      );
      
      const acceptorRows = acceptorResult.rows || [];
      
      if (acceptorRows.length === 0) {
        await connection.query('ROLLBACK');
        connection.release();
        console.log('❌ Acceptor user not found');
        return res.status(404).json({
          success: false,
          error: 'User not found'
        });
      }
      
      const acceptorData = acceptorRows[0];
      const acceptorBalance = parseFloat(acceptorData.balance || 0);
      const acceptorXp = parseFloat(acceptorData.xp_points || 0);
      const acceptorUsername = acceptorData.username;
      
      console.log('👤 Acceptor details:', {
        username: acceptorUsername,
        xp: acceptorXp,
        requiredStake: stakeAmount
      });

      if (match.stake_currency === 'money') {
        if (acceptorBalance < stakeAmount) {
          await connection.query('ROLLBACK');
          connection.release();
          console.log('❌ Insufficient balance');
          return res.status(400).json({
            success: false,
            error: `Insufficient balance. You have ₦${acceptorBalance}, need ₦${stakeAmount}`
          });
        }
      } else {
        if (acceptorXp < stakeAmount) {
          await connection.query('ROLLBACK');
          connection.release();
          console.log('❌ Insufficient XP');
          return res.status(400).json({
            success: false,
            error: `Insufficient XP. You have ${acceptorXp} XP, need ${stakeAmount} XP`
          });
        }
      }

      if (match.prize_pool_option === 'custom') {
        if (match.stake_currency === 'xp') {
          if (!player1Xp || player1Xp < customPrizePool) {
            await connection.query('ROLLBACK');
            connection.release();
            console.log('❌ Creator insufficient XP for custom prize');
            return res.status(400).json({
              success: false,
              error: 'Creator no longer has sufficient XP for custom prize pool'
            });
          }
        }
      } else {
        if (match.stake_currency === 'xp') {
          if (!player1Xp || player1Xp < stakeAmount) {
            await connection.query('ROLLBACK');
            connection.release();
            console.log('❌ Creator insufficient XP');
            return res.status(400).json({
              success: false,
              error: 'Creator no longer has sufficient XP'
            });
          }
        }
      }

      console.log('✅ All validations passed, proceeding with deductions...');

      if (match.stake_currency === 'money') {
        await connection.query(
          'UPDATE users SET balance = balance - $1 WHERE id = $2',
          [stakeAmount, userId]
        );
        
        await connection.query(
          `INSERT INTO transactions (user_id, amount, type, status, reference, description, currency) 
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            userId,
            -stakeAmount,
            'match_entry',
            'completed',
            `MATCH-JOIN-${Date.now()}-${matchId}`,
            `Match entry for ${match.game || 'game'}`,
            'NGN'
          ]
        );
      } else {
        await connection.query(
          'UPDATE users SET xp_points = COALESCE(xp_points, 0) - $1 WHERE id = $2',
          [stakeAmount, userId]
        );
        
        await connection.query(
          `INSERT INTO xp_transactions (user_id, type, amount, description, match_id) 
           VALUES ($1, $2, $3, $4, $5)`,
          [
            userId,
            XP_TYPES.SPENT,
            -stakeAmount,
            `XP stake for ${match.game || 'game'} match`,
            matchId
          ]
        );
      }
      
      if (match.prize_pool_option === 'custom') {
        if (match.stake_currency === 'money') {
          await connection.query(
            'UPDATE users SET balance = balance - $1 WHERE id = $2',
            [customPrizePool, match.player1_id]
          );
          
          await connection.query(
            `INSERT INTO transactions (user_id, amount, type, status, reference, description, currency) 
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
              match.player1_id,
              -customPrizePool,
              'match_entry',
              'completed',
              `MATCH-CUSTOM-${Date.now()}-${matchId}`,
              `Custom prize pool for ${match.game || 'game'}`,
              'NGN'
            ]
          );
        } else {
          await connection.query(
            'UPDATE users SET xp_points = COALESCE(xp_points, 0) - $1 WHERE id = $2',
            [customPrizePool, match.player1_id]
          );
          
          await connection.query(
            `INSERT INTO xp_transactions (user_id, type, amount, description, match_id) 
             VALUES ($1, $2, $3, $4, $5)`,
            [
              match.player1_id,
              XP_TYPES.SPENT,
              -customPrizePool,
              `Custom XP prize pool for ${match.game || 'game'} match`,
              matchId
            ]
          );
        }
      } else {
        if (match.stake_currency === 'money') {
          await connection.query(
            'UPDATE users SET balance = balance - $1 WHERE id = $2',
            [stakeAmount, match.player1_id]
          );
          
          await connection.query(
            `INSERT INTO transactions (user_id, amount, type, status, reference, description, currency) 
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
              match.player1_id,
              -stakeAmount,
              'match_entry',
              'completed',
              `MATCH-CREATE-${Date.now()}-${matchId}`,
              `Match stake for ${match.game || 'game'}`,
              'NGN'
            ]
          );
        } else {
          await connection.query(
            'UPDATE users SET xp_points = COALESCE(xp_points, 0) - $1 WHERE id = $2',
            [stakeAmount, match.player1_id]
          );
          
          await connection.query(
            `INSERT INTO xp_transactions (user_id, type, amount, description, match_id) 
             VALUES ($1, $2, $3, $4, $5)`,
            [
              match.player1_id,
              XP_TYPES.SPENT,
              -stakeAmount,
              `XP stake for ${match.game || 'game'} match`,
              matchId
            ]
          );
        }
      }
      
      console.log('✅ Deductions completed');

      await connection.query(
        'UPDATE matches SET player2_id = $1, status = $2, started_at = NOW() WHERE id = $3',
        [userId, 'ongoing', matchId]
      );
      
      console.log('✅ Match status updated');

      const acceptorRankResult = await connection.query(
        'SELECT rank FROM users WHERE id = $1',
        [userId]
      );
      
      const creatorRankResult = await connection.query(
        'SELECT rank FROM users WHERE id = $1',
        [match.player1_id]
      );
      
      const acceptorRankRows = acceptorRankResult.rows || [];
      const creatorRankRows = creatorRankResult.rows || [];
      
      const acceptorRank = acceptorRankRows.length > 0 ? acceptorRankRows[0] : null;
      const creatorRank = creatorRankRows.length > 0 ? creatorRankRows[0] : null;
      
      await connection.query(
        `INSERT INTO match_attempts (player1_id, player2_id, player1_rank, player2_rank, match_id) 
         VALUES ($1, $2, $3, $4, $5)`,
        [
          match.player1_id,
          userId,
          creatorRank?.rank || 'E',
          acceptorRank?.rank || 'E',
          matchId
        ]
      );

      await connection.query('COMMIT');
      connection.release();

      console.log('✅ Transaction committed successfully');

      await NotificationService.createNotification({
        userId: match.player1_id,
        senderId: userId,
        message: `${acceptorUsername} joined your match!`,
        type: 'match_accepted',
        matchId: matchId
      });

      console.log('✅ Notification sent');

      res.json({
        success: true,
        message: 'Match joined successfully! The game is now active.',
        matchId: matchId,
        stake_deducted: stakeAmount,
        custom_prize_deducted: match.prize_pool_option === 'custom' ? customPrizePool : null,
        currency: match.stake_currency
      });

    } catch (error) {
      console.error('❌ Join match error:', error);
      console.error('❌ Error stack:', error.stack);
      
      try {
        await connection.query('ROLLBACK');
        connection.release();
        console.log('✅ Rollback completed');
      } catch (rollbackError) {
        console.error('❌ Rollback error:', rollbackError);
      }
      
      res.status(500).json({
        success: false,
        error: 'Failed to join match: ' + error.message
      });
    }
  }
});

// ==================== 3. ACCEPT MATCH - FIXED ====================
router.post('/:id/accept', authenticateToken, async (req, res) => {
  debugLog(req, 'ACCEPT MATCH');
  
  if (db.isSupabase) {
    try {
      const matchId = req.params.id;
      const userId = req.user.id;

      console.log('=== 🎮 ACCEPT MATCH DEBUG START ===');
      console.log('Match ID:', matchId);
      console.log('User ID:', userId);
      console.log('User username:', req.user.username);

      const { data: directMatch, error: directError } = await db.supabaseAdmin
        .from('matches')
        .select('id, status, opponent_type, opponent_username, player1_id, player2_id')
        .eq('id', matchId)
        .single();

      if (directError || !directMatch) {
        console.log('❌ Match ID ' + matchId + ' does not exist in database');
        return res.status(404).json({
          success: false,
          error: 'Match not found in database'
        });
      }

      console.log('📊 Match exists in DB:', {
        id: directMatch.id,
        status: directMatch.status,
        opponent_type: directMatch.opponent_type,
        opponent_username: directMatch.opponent_username,
        player1_id: directMatch.player1_id,
        player2_id: directMatch.player2_id
      });

      const { data: match, error: matchError } = await db.supabaseAdmin
        .from('matches')
        .select(`
          *,
          player1:player1_id (username, balance, xp_points),
          player2:player2_id (username, balance, xp_points)
        `)
        .eq('id', matchId)
        .eq('status', 'pending')
        .single();

      if (matchError || !match) {
        console.log('❌ Main query returned 0 rows - checking why...');
        
        const { data: statusQuery3 } = await db.supabaseAdmin
          .from('matches')
          .select('id, status')
          .eq('id', matchId);
        
        console.log('📊 No filter query result:', statusQuery3);
        
        return res.status(404).json({
          success: false,
          error: `Match found but status check failed. Status in DB: "${directMatch.status}"`,
          debug: {
            match_id: matchId,
            db_status: directMatch.status,
            db_status_lower: directMatch.status?.toLowerCase()
          }
        });
      }

      console.log('✅ Main query successful - Match loaded');
      console.log('📊 Match details from query:', {
        id: match.id,
        game: match.game,
        status: match.status,
        opponent_type: match.opponent_type,
        opponent_username: match.opponent_username,
        player1_id: match.player1_id,
        player2_id: match.player2_id,
        stake_amount: match.stake_amount,
        stake_currency: match.stake_currency,
        prize_pool_option: match.prize_pool_option,
        has_opponent_username: !!match.opponent_username
      });

      const stakeAmount = parseFloat(match.stake_amount || 0);
      const customPrizePool = parseFloat(match.custom_prize_pool || 0);
      const player1Xp = parseFloat(match.player1?.xp_points || 0);

      if (match.opponent_type === 'specific') {
        const { data: currentUser } = await db.supabaseAdmin
          .from('users')
          .select('username')
          .eq('id', userId)
          .single();
        
        console.log('👤 Current user username:', currentUser?.username);
        console.log('📧 Match opponent_username:', match.opponent_username);
        console.log('✅ Username match?:', currentUser?.username === match.opponent_username);
        
        if (!currentUser || currentUser.username !== match.opponent_username) {
          return res.status(403).json({
            success: false,
            error: `You are not invited to this match. Invited: "${match.opponent_username}", You: "${currentUser?.username}"`
          });
        }
      }

      if (match.player1_id === userId) {
        return res.status(400).json({
          success: false,
          error: 'You cannot accept your own match'
        });
      }

      if (match.player2_id) {
        return res.status(400).json({
          success: false,
          error: 'This match already has an opponent'
        });
      }

      const { data: acceptorData, error: acceptorError } = await db.supabaseAdmin
        .from('users')
        .select('balance, xp_points, username')
        .eq('id', userId)
        .single();

      if (acceptorError || !acceptorData) {
        return res.status(404).json({
          success: false,
          error: 'User not found'
        });
      }

      const acceptorBalance = parseFloat(acceptorData.balance || 0);
      const acceptorXp = parseFloat(acceptorData.xp_points || 0);
      const acceptorUsername = acceptorData.username;

      console.log('💰 Acceptor details:', {
        username: acceptorUsername,
        balance: acceptorBalance,
        xp: acceptorXp,
        requiredStake: stakeAmount,
        stake_currency: match.stake_currency
      });

      if (match.stake_currency === 'money') {
        if (acceptorBalance < stakeAmount) {
          return res.status(400).json({
            success: false,
            error: `Insufficient balance. You have ₦${acceptorBalance}, need ₦${stakeAmount}`
          });
        }
      } else {
        if (acceptorXp < stakeAmount) {
          return res.status(400).json({
            success: false,
            error: `Insufficient XP. You have ${acceptorXp} XP, need ${stakeAmount} XP`
          });
        }
      }

      if (match.prize_pool_option === 'custom') {
        if (match.stake_currency === 'xp') {
          if (!player1Xp || player1Xp < customPrizePool) {
            return res.status(400).json({
              success: false,
              error: 'Creator no longer has sufficient XP for custom prize pool'
            });
          }
        }
      } else {
        if (match.stake_currency === 'xp') {
          if (!player1Xp || player1Xp < stakeAmount) {
            return res.status(400).json({
              success: false,
              error: 'Creator no longer has sufficient XP'
            });
          }
        }
      }

      console.log('✅ All validations passed, processing deductions...');

      // Deduct from acceptor - FIXED: Get current value and update directly
      if (match.stake_currency === 'money') {
        // Get current balance
        const { data: currentUser } = await db.supabaseAdmin
          .from('users')
          .select('balance')
          .eq('id', userId)
          .single();
        
        const newBalance = parseFloat(currentUser?.balance || 0) - stakeAmount;
        
        const { error: updateError } = await db.supabaseAdmin
          .from('users')
          .update({ balance: newBalance })
          .eq('id', userId);
        
        if (updateError) throw updateError;

        // Create transaction
        const { error: txError } = await db.supabaseAdmin
          .from('transactions')
          .insert([{
            user_id: userId,
            amount: -stakeAmount,
            type: 'match_entry',
            status: 'completed',
            reference: `MATCH-ACCEPT-${Date.now()}-${matchId}`,
            description: `Match entry for ${match.game || 'game'}`,
            currency: 'NGN'
          }]);
        
        if (txError) throw txError;
      } else {
        // XP deduction - Get current XP and update directly
        const { data: currentUser } = await db.supabaseAdmin
          .from('users')
          .select('xp_points')
          .eq('id', userId)
          .single();
        
        const newXpPoints = parseInt(currentUser?.xp_points || 0) - stakeAmount;
        
        const { error: updateError } = await db.supabaseAdmin
          .from('users')
          .update({ xp_points: newXpPoints })
          .eq('id', userId);
        
        if (updateError) throw updateError;

        // Create XP transaction
        const { error: txError } = await db.supabaseAdmin
          .from('xp_transactions')
          .insert([{
            user_id: userId,
            type: 'spent',
            amount: -stakeAmount,
            description: `XP stake for ${match.game || 'game'} match`,
            match_id: matchId,
            metadata: {
              match_id: matchId,
              stake_amount: stakeAmount,
              action: 'accept_match'
            }
          }]);
        
        if (txError) throw txError;
      }

      // Deduct from creator based on prize pool option - FIXED: Get current values and update directly
      if (match.prize_pool_option === 'custom') {
        if (match.stake_currency === 'money') {
          // Get current balance
          const { data: creatorUser } = await db.supabaseAdmin
            .from('users')
            .select('balance')
            .eq('id', match.player1_id)
            .single();
          
          const newCreatorBalance = parseFloat(creatorUser?.balance || 0) - customPrizePool;
          
          const { error: updateError } = await db.supabaseAdmin
            .from('users')
            .update({ balance: newCreatorBalance })
            .eq('id', match.player1_id);
          
          if (updateError) throw updateError;

          // Create transaction
          const { error: txError } = await db.supabaseAdmin
            .from('transactions')
            .insert([{
              user_id: match.player1_id,
              amount: -customPrizePool,
              type: 'match_entry',
              status: 'completed',
              reference: `MATCH-CUSTOM-${Date.now()}-${matchId}`,
              description: `Custom prize pool for ${match.game || 'game'}`,
              currency: 'NGN'
            }]);
          
          if (txError) throw txError;
        } else {
          // XP custom prize deduction
          const { data: creatorUser } = await db.supabaseAdmin
            .from('users')
            .select('xp_points')
            .eq('id', match.player1_id)
            .single();
          
          const newCreatorXp = parseInt(creatorUser?.xp_points || 0) - customPrizePool;
          
          const { error: updateError } = await db.supabaseAdmin
            .from('users')
            .update({ xp_points: newCreatorXp })
            .eq('id', match.player1_id);
          
          if (updateError) throw updateError;

          // Create XP transaction
          const { error: txError } = await db.supabaseAdmin
            .from('xp_transactions')
            .insert([{
              user_id: match.player1_id,
              type: 'spent',
              amount: -customPrizePool,
              description: `Custom XP prize pool for ${match.game || 'game'} match`,
              match_id: matchId,
              metadata: {
                match_id: matchId,
                custom_prize: customPrizePool,
                action: 'custom_prize_hold'
              }
            }]);
          
          if (txError) throw txError;
        }
      } else {
        // Entry fee mode - deduct creator's stake
        if (match.stake_currency === 'money') {
          const { data: creatorUser } = await db.supabaseAdmin
            .from('users')
            .select('balance')
            .eq('id', match.player1_id)
            .single();
          
          const newCreatorBalance = parseFloat(creatorUser?.balance || 0) - stakeAmount;
          
          const { error: updateError } = await db.supabaseAdmin
            .from('users')
            .update({ balance: newCreatorBalance })
            .eq('id', match.player1_id);
          
          if (updateError) throw updateError;

          // Create transaction
          const { error: txError } = await db.supabaseAdmin
            .from('transactions')
            .insert([{
              user_id: match.player1_id,
              amount: -stakeAmount,
              type: 'match_entry',
              status: 'completed',
              reference: `MATCH-CREATE-${Date.now()}-${matchId}`,
              description: `Match stake for ${match.game || 'game'}`,
              currency: 'NGN'
            }]);
          
          if (txError) throw txError;
        } else {
          // XP deduction for creator
          const { data: creatorUser } = await db.supabaseAdmin
            .from('users')
            .select('xp_points')
            .eq('id', match.player1_id)
            .single();
          
          const newCreatorXp = parseInt(creatorUser?.xp_points || 0) - stakeAmount;
          
          const { error: updateError } = await db.supabaseAdmin
            .from('users')
            .update({ xp_points: newCreatorXp })
            .eq('id', match.player1_id);
          
          if (updateError) throw updateError;

          // Create XP transaction
          const { error: txError } = await db.supabaseAdmin
            .from('xp_transactions')
            .insert([{
              user_id: match.player1_id,
              type: 'spent',
              amount: -stakeAmount,
              description: `XP stake for ${match.game || 'game'} match`,
              match_id: matchId,
              metadata: {
                match_id: matchId,
                stake_amount: stakeAmount,
                action: 'create_match'
              }
            }]);
          
          if (txError) throw txError;
        }
      }

      console.log('✅ Deductions completed');

      // Update match status
      const { error: matchUpdateError } = await db.supabaseAdmin
        .from('matches')
        .update({ 
          player2_id: userId, 
          status: 'ongoing', 
          started_at: new Date().toISOString() 
        })
        .eq('id', matchId);

      if (matchUpdateError) throw matchUpdateError;

      console.log('✅ Match status updated to ongoing');

      // Get ranks for match attempt
      const { data: acceptorRankData } = await db.supabaseAdmin
        .from('users')
        .select('rank')
        .eq('id', userId)
        .single();

      const { data: creatorRankData } = await db.supabaseAdmin
        .from('users')
        .select('rank')
        .eq('id', match.player1_id)
        .single();

      // Create match attempt record
      const { error: attemptError } = await db.supabaseAdmin
        .from('match_attempts')
        .insert([{
          player1_id: match.player1_id,
          player2_id: userId,
          player1_rank: creatorRankData?.rank || 'E',
          player2_rank: acceptorRankData?.rank || 'E',
          match_id: matchId,
          created_at: new Date().toISOString()
        }]);

      if (attemptError) throw attemptError;

      console.log('✅ Match attempt record created');

      // Send notification
      try {
        await NotificationService.createNotification({
          userId: match.player1_id,
          senderId: userId,
          message: `${acceptorUsername} accepted your match invitation!`,
          type: 'match_accepted',
          matchId: matchId
        });
        console.log('✅ Notification sent');
      } catch (notifError) {
        console.error('❌ Notification failed but match accept succeeded:', notifError);
      }

      res.json({
        success: true,
        message: 'Match accepted successfully! The game is now active.',
        matchId: matchId,
        stake_deducted: stakeAmount,
        custom_prize_deducted: match.prize_pool_option === 'custom' ? customPrizePool : null,
        currency: match.stake_currency
      });

    } catch (error) {
      console.error('❌ Accept match error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to accept match: ' + error.message
      });
    }
  } else {
    // PostgreSQL version (keep existing code)
    const connection = await db.pool.connect();
    
    try {
      await connection.query('BEGIN');

      const matchId = req.params.id;
      const userId = req.user.id;

      console.log('=== 🎮 ACCEPT MATCH DEBUG START ===');
      console.log('Match ID:', matchId);
      console.log('User ID:', userId);
      console.log('User username:', req.user.username);

      const directCheck = await connection.query(
        'SELECT id, status, opponent_type, opponent_username, player1_id, player2_id FROM matches WHERE id = $1',
        [matchId]
      );
      
      console.log('📊 Direct check - Rows found:', directCheck.rows.length);
      
      if (directCheck.rows.length === 0) {
        await connection.query('ROLLBACK');
        connection.release();
        console.log('❌ Match ID ' + matchId + ' does not exist in database');
        return res.status(404).json({
          success: false,
          error: 'Match not found in database'
        });
      }
      
      const directMatch = directCheck.rows[0];
      console.log('📊 Match exists in DB:', {
        id: directMatch.id,
        status: directMatch.status,
        status_trimmed: directMatch.status?.trim(),
        status_lower: directMatch.status?.toLowerCase(),
        opponent_type: directMatch.opponent_type,
        opponent_username: directMatch.opponent_username,
        player1_id: directMatch.player1_id,
        player2_id: directMatch.player2_id
      });

      const matchesResult = await connection.query(
        `SELECT m.*,
            p1.username AS player1_username,
            p2.username AS player2_username,
            p1.balance AS player1_balance,
            p1.xp_points AS player1_xp,
            p2.balance AS player2_balance,
            p2.xp_points AS player2_xp
     FROM matches m
     LEFT JOIN users p1 ON m.player1_id = p1.id
     LEFT JOIN users p2 ON m.player2_id = p2.id
     WHERE m.id = $1 AND LOWER(TRIM(m.status)) = 'pending'`,
        [matchId]
      );

      console.log('📊 Main query - Rows:', matchesResult.rows?.length || 0);
      console.log('📊 Main query - Raw first row:', matchesResult.rows?.[0]);

      const matchesRows = matchesResult.rows || [];
      console.log('📊 matchesRows length (FIXED):', matchesRows.length);
      
      if (matchesRows.length === 0) {
        console.log('❌ Main query returned 0 rows - checking why...');
        
        const statusQuery1 = await connection.query(
          "SELECT id, status FROM matches WHERE id = $1 AND status ILIKE 'pending'",
          [matchId]
        );
        console.log('📊 ILIKE query result:', statusQuery1.rows);
        
        const statusQuery2 = await connection.query(
          "SELECT id, status FROM matches WHERE id = $1 AND status LIKE '%pending%'",
          [matchId]
        );
        console.log('📊 LIKE %pending% result:', statusQuery2.rows);
        
        const statusQuery3 = await connection.query(
          "SELECT id, status FROM matches WHERE id = $1",
          [matchId]
        );
        console.log('📊 No filter query result:', statusQuery3.rows);
        
        await connection.query('ROLLBACK');
        connection.release();
        
        return res.status(404).json({
          success: false,
          error: `Match found but status check failed. Status in DB: "${directMatch.status}"`,
          debug: {
            match_id: matchId,
            db_status: directMatch.status,
            db_status_trimmed: directMatch.status?.trim(),
            db_status_lower: directMatch.status?.toLowerCase(),
            main_query_result: 0,
            ilike_query_result: statusQuery1.rows.length,
            like_query_result: statusQuery2.rows.length
          }
        });
      }

      console.log('✅ Main query successful - Match loaded');
      const match = matchesRows[0];
      console.log('📊 Match details from query:', {
        id: match.id,
        game: match.game,
        status: match.status,
        opponent_type: match.opponent_type,
        opponent_username: match.opponent_username,
        player1_id: match.player1_id,
        player2_id: match.player2_id,
        stake_amount: match.stake_amount,
        stake_currency: match.stake_currency,
        prize_pool_option: match.prize_pool_option,
        has_opponent_username: !!match.opponent_username
      });
      console.log('=== 🎮 ACCEPT MATCH DEBUG END ===');

      const stakeAmount = parseFloat(match.stake_amount || 0);
      const customPrizePool = parseFloat(match.custom_prize_pool || 0);
      const player1Xp = parseFloat(match.player1_xp || 0);

      if (match.opponent_type === 'specific') {
        const currentUserResult = await connection.query(
          'SELECT username FROM users WHERE id = $1',
          [userId]
        );
        
        const currentUserRows = currentUserResult.rows || [];
        const currentUser = currentUserRows.length > 0 ? currentUserRows[0] : null;
        
        console.log('👤 Current user username:', currentUser?.username);
        console.log('📧 Match opponent_username:', match.opponent_username);
        console.log('✅ Username match?:', currentUser?.username === match.opponent_username);
        
        if (!currentUser || currentUser.username !== match.opponent_username) {
          await connection.query('ROLLBACK');
          connection.release();
          return res.status(403).json({
            success: false,
            error: `You are not invited to this match. Invited: "${match.opponent_username}", You: "${currentUser?.username}"`
          });
        }
      }

      if (parseInt(match.player1_id) === parseInt(userId)) {
        await connection.query('ROLLBACK');
        connection.release();
        return res.status(400).json({
          success: false,
          error: 'You cannot accept your own match'
        });
      }

      if (match.player2_id) {
        await connection.query('ROLLBACK');
        connection.release();
        return res.status(400).json({
          success: false,
          error: 'This match already has an opponent'
        });
      }

      const acceptorResult = await connection.query(
        'SELECT balance, xp_points, username FROM users WHERE id = $1',
        [userId]
      );
      
      const acceptorRows = acceptorResult.rows || [];
      const acceptorData = acceptorRows.length > 0 ? acceptorRows[0] : null;
      
      if (!acceptorData) {
        await connection.query('ROLLBACK');
        connection.release();
        return res.status(404).json({
          success: false,
          error: 'User not found'
        });
      }
      
      const acceptorBalance = parseFloat(acceptorData.balance || 0);
      const acceptorXp = parseFloat(acceptorData.xp_points || 0);
      const acceptorUsername = acceptorData.username;
      
      console.log('💰 Acceptor details:', {
        username: acceptorUsername,
        balance: acceptorBalance,
        xp: acceptorXp,
        requiredStake: stakeAmount,
        stake_currency: match.stake_currency
      });
      
      if (match.stake_currency === 'money') {
        if (acceptorBalance < stakeAmount) {
          await connection.query('ROLLBACK');
          connection.release();
          return res.status(400).json({
            success: false,
            error: `Insufficient balance. You have ₦${acceptorBalance}, need ₦${stakeAmount}`
          });
        }
      } else {
        if (acceptorXp < stakeAmount) {
          await connection.query('ROLLBACK');
          connection.release();
          return res.status(400).json({
            success: false,
            error: `Insufficient XP. You have ${acceptorXp} XP, need ${stakeAmount} XP`
          });
        }
      }

      if (match.prize_pool_option === 'custom') {
        if (match.stake_currency === 'xp') {
          if (!player1Xp || player1Xp < customPrizePool) {
            await connection.query('ROLLBACK');
            connection.release();
            return res.status(400).json({
              success: false,
              error: 'Creator no longer has sufficient XP for custom prize pool'
            });
          }
        }
      } else {
        if (match.stake_currency === 'xp') {
          if (!player1Xp || player1Xp < stakeAmount) {
            await connection.query('ROLLBACK');
            connection.release();
            return res.status(400).json({
              success: false,
              error: 'Creator no longer has sufficient XP'
            });
          }
        }
      }

      console.log('✅ All validations passed, processing deductions...');

      if (match.stake_currency === 'money') {
        await connection.query(
          'UPDATE users SET balance = balance - $1 WHERE id = $2',
          [stakeAmount, userId]
        );
        
        await connection.query(
          `INSERT INTO transactions (user_id, amount, type, status, reference, description, currency) 
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            userId,
            -stakeAmount,
            'match_entry',
            'completed',
            `MATCH-ACCEPT-${Date.now()}-${matchId}`,
            `Match entry for ${match.game || 'game'}`,
            'NGN'
          ]
        );
      } else {
        await connection.query(
          'UPDATE users SET xp_points = COALESCE(xp_points, 0) - $1 WHERE id = $2',
          [stakeAmount, userId]
        );
        
        await connection.query(
          `INSERT INTO xp_transactions (user_id, type, amount, description, match_id) 
           VALUES ($1, $2, $3, $4, $5)`,
          [
            userId,
            'spent',
            -stakeAmount,
            `XP stake for ${match.game || 'game'} match`,
            matchId
          ]
        );
      }
      
      if (match.prize_pool_option === 'custom') {
        if (match.stake_currency === 'money') {
          await connection.query(
            'UPDATE users SET balance = balance - $1 WHERE id = $2',
            [customPrizePool, match.player1_id]
          );
          
          await connection.query(
            `INSERT INTO transactions (user_id, amount, type, status, reference, description, currency) 
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
              match.player1_id,
              -customPrizePool,
              'match_entry',
              'completed',
              `MATCH-CUSTOM-${Date.now()}-${matchId}`,
              `Custom prize pool for ${match.game || 'game'}`,
              'NGN'
            ]
          );
        } else {
          await connection.query(
            'UPDATE users SET xp_points = COALESCE(xp_points, 0) - $1 WHERE id = $2',
            [customPrizePool, match.player1_id]
          );
          
          await connection.query(
            `INSERT INTO xp_transactions (user_id, type, amount, description, match_id) 
             VALUES ($1, $2, $3, $4, $5)`,
            [
              match.player1_id,
              'spent',
              -customPrizePool,
              `Custom XP prize pool for ${match.game || 'game'} match`,
              matchId
            ]
          );
        }
      } else {
        if (match.stake_currency === 'money') {
          await connection.query(
            'UPDATE users SET balance = balance - $1 WHERE id = $2',
            [stakeAmount, match.player1_id]
          );
          
          await connection.query(
            `INSERT INTO transactions (user_id, amount, type, status, reference, description, currency) 
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
              match.player1_id,
              -stakeAmount,
              'match_entry',
              'completed',
              `MATCH-CREATE-${Date.now()}-${matchId}`,
              `Match stake for ${match.game || 'game'}`,
              'NGN'
            ]
          );
        } else {
          await connection.query(
            'UPDATE users SET xp_points = COALESCE(xp_points, 0) - $1 WHERE id = $2',
            [stakeAmount, match.player1_id]
          );
          
          await connection.query(
            `INSERT INTO xp_transactions (user_id, type, amount, description, match_id) 
             VALUES ($1, $2, $3, $4, $5)`,
            [
              match.player1_id,
              'spent',
              -stakeAmount,
              `XP stake for ${match.game || 'game'} match`,
              matchId
            ]
          );
        }
      }
      
      console.log('✅ Deductions completed');

      await connection.query(
        'UPDATE matches SET player2_id = $1, status = $2, started_at = NOW() WHERE id = $3',
        [userId, 'ongoing', matchId]
      );
      
      console.log('✅ Match status updated to ongoing');

      const acceptorRankResult = await connection.query(
        'SELECT rank FROM users WHERE id = $1',
        [userId]
      );
      
      const creatorRankResult = await connection.query(
        'SELECT rank FROM users WHERE id = $1',
        [match.player1_id]
      );
      
      const acceptorRankRows = acceptorRankResult.rows || [];
      const creatorRankRows = creatorRankResult.rows || [];
      
      const acceptorRank = acceptorRankRows.length > 0 ? acceptorRankRows[0] : null;
      const creatorRank = creatorRankRows.length > 0 ? creatorRankRows[0] : null;
      
      await connection.query(
        `INSERT INTO match_attempts (player1_id, player2_id, player1_rank, player2_rank, match_id) 
         VALUES ($1, $2, $3, $4, $5)`,
        [
          match.player1_id,
          userId,
          creatorRank?.rank || 'E',
          acceptorRank?.rank || 'E',
          matchId
        ]
      );

      await connection.query('COMMIT');
      connection.release();

      console.log('✅ Transaction committed successfully');

      await NotificationService.createNotification({
        userId: match.player1_id,
        senderId: userId,
        message: `${acceptorUsername} accepted your match invitation!`,
        type: 'match_accepted',
        matchId: matchId
      });

      console.log('✅ Notification sent');

      res.json({
        success: true,
        message: 'Match accepted successfully! The game is now active.',
        matchId: matchId,
        stake_deducted: stakeAmount,
        custom_prize_deducted: match.prize_pool_option === 'custom' ? customPrizePool : null,
        currency: match.stake_currency
      });

    } catch (error) {
      console.error('❌ Accept match error:', error);
      console.error('❌ Error stack:', error.stack);
      
      try {
        await connection.query('ROLLBACK');
        connection.release();
        console.log('✅ Rollback completed');
      } catch (rollbackError) {
        console.error('❌ Rollback error:', rollbackError);
      }
      
      res.status(500).json({
        success: false,
        error: 'Failed to accept match: ' + error.message
      });
    }
  }
});

// ==================== 4. DECLINE INVITATION ====================
router.post('/:id/decline', authenticateToken, async (req, res) => {
  debugLog(req, 'DECLINE MATCH');
  
  try {
    const matchId = req.params.id;
    
    const match = await getMatchWithDetails(matchId);
    
    if (!match) {
      return res.status(404).json({
        success: false,
        error: 'Match not found'
      });
    }

    if (match.opponent_type !== 'specific' || match.status !== 'pending') {
      return res.status(400).json({
        success: false,
        error: 'Cannot decline this match'
      });
    }

    let currentUser;
    if (db.isSupabase) {
      const { data } = await db.supabaseAdmin
        .from('users')
        .select('username')
        .eq('id', req.user.id)
        .single();
      currentUser = data;
    } else {
      const currentUserResult = await db.query(
        'SELECT username FROM users WHERE id = $1',
        [req.user.id]
      );
      currentUser = getFirstRow(currentUserResult);
    }
    
    if (!currentUser || currentUser.username !== match.opponent_username) {
      return res.status(403).json({
        success: false,
        error: 'You are not invited to this match'
      });
    }

    if (db.isSupabase) {
      const { error } = await db.supabaseAdmin
        .from('matches')
        .update({ status: 'cancelled', completed_at: new Date().toISOString() })
        .eq('id', matchId);
      
      if (error) throw error;
    } else {
      await db.query(
        'UPDATE matches SET status = $1, completed_at = NOW() WHERE id = $2',
        ['cancelled', matchId]
      );
    }

    await NotificationService.createNotification({
      userId: match.player1_id,
      senderId: req.user.id,
      message: `${currentUser.username} declined your match invitation`,
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

// ==================== 5. SUBMIT MATCH RESULT - COMPLETE FIXED VERSION ====================
router.post('/:id/result', authenticateToken, async (req, res) => {
  debugLog(req, 'SUBMIT RESULT');
  
  // Validate the request body
  if (!req.body || !req.body.winner_id) {
    return res.status(400).json({
      success: false,
      error: 'winner_id is required'
    });
  }

  const matchId = req.params.id;
  const userId = req.user.id;
  let winner_id = req.body.winner_id;

  console.log('📝 Submit result request:', { 
    matchId, 
    userId, 
    winner_id,
    winner_id_type: typeof winner_id 
  });

  // Handle different types of winner_id
  if (typeof winner_id === 'number') {
    winner_id = winner_id.toString();
    console.log('⚠️ Converting numeric winner_id to string:', winner_id);
  }

  if (db.isSupabase) {
    try {
      // First, get the match details to validate participants
      const { data: match, error: matchError } = await db.supabaseAdmin
        .from('matches')
        .select(`
          *,
          player1:player1_id (id, username, balance, xp_points),
          player2:player2_id (id, username, balance, xp_points)
        `)
        .eq('id', matchId)
        .single();

      if (matchError || !match) {
        console.error('❌ Match not found:', matchError);
        return res.status(404).json({
          success: false,
          error: 'Match not found'
        });
      }

      console.log('📊 Match details:', {
        status: match.status,
        player1_id: match.player1_id,
        player2_id: match.player2_id,
        player1_username: match.player1?.username,
        player2_username: match.player2?.username,
        stake_currency: match.stake_currency,
        stake_amount: match.stake_amount,
        prize_pool_option: match.prize_pool_option,
        prize_pool_amount: match.prize_pool_amount,
        custom_prize_pool: match.custom_prize_pool
      });

      // Validate match status
      if (match.status !== 'ongoing') {
        return res.status(400).json({
          success: false,
          error: `Match is ${match.status}, cannot submit result`
        });
      }

      // Check if user is a participant
      const isPlayer1 = match.player1_id === userId;
      const isPlayer2 = match.player2_id === userId;
      
      if (!isPlayer1 && !isPlayer2) {
        return res.status(403).json({
          success: false,
          error: 'You are not a participant in this match'
        });
      }

      // Map numeric winner_id to actual UUID
      let actualWinnerId = winner_id;
      
      // If winner_id is a number, map it to the actual UUID
      if (!isNaN(parseInt(winner_id))) {
        if (match.player1_id && match.player1_id.includes(winner_id)) {
          actualWinnerId = match.player1_id;
        } else if (match.player2_id && match.player2_id.includes(winner_id)) {
          actualWinnerId = match.player2_id;
        } else {
          return res.status(400).json({
            success: false,
            error: 'Invalid winner_id - must be one of the match participants'
          });
        }
      }

      console.log('🎯 Actual winner_id to use:', actualWinnerId);

      // Validate winner is a participant
      if (actualWinnerId !== match.player1_id && actualWinnerId !== match.player2_id) {
        return res.status(400).json({
          success: false,
          error: 'Winner must be one of the match participants'
        });
      }

      // Check if user already submitted result
      const { data: existingResult, error: checkError } = await db.supabaseAdmin
        .from('match_results')
        .select('*')
        .eq('match_id', matchId)
        .eq('user_id', userId);

      if (checkError) {
        console.error('❌ Error checking existing result:', checkError);
        throw checkError;
      }

      if (existingResult && existingResult.length > 0) {
        return res.status(400).json({
          success: false,
          error: 'You already submitted a result for this match'
        });
      }

      // Insert result using admin client
      const { error: insertError } = await db.supabaseAdmin
        .from('match_results')
        .insert([{
          match_id: matchId,
          user_id: userId,
          winner_id: actualWinnerId
        }]);

      if (insertError) {
        console.error('❌ Error inserting result:', insertError);
        throw insertError;
      }

      console.log('✅ Result inserted successfully');

      // Count results
      const { count: resultsCount, error: countError } = await db.supabaseAdmin
        .from('match_results')
        .select('*', { count: 'exact', head: true })
        .eq('match_id', matchId);

      if (countError) {
        console.error('❌ Error counting results:', countError);
        throw countError;
      }

      console.log(`📊 Results count: ${resultsCount}`);

      const stakeAmount = parseFloat(match.stake_amount || 0);
      const customPrizePool = parseFloat(match.custom_prize_pool || 0);
      const prizePoolAmount = parseFloat(match.prize_pool_amount || 0);

      // If both players have submitted
      if (resultsCount >= 2) {
        // Get all results to check if they agree
        const { data: allResults, error: resultsError } = await db.supabaseAdmin
          .from('match_results')
          .select('winner_id, user_id')
          .eq('match_id', matchId);

        if (resultsError) {
          console.error('❌ Error getting all results:', resultsError);
          throw resultsError;
        }

        // Check if all results have the same winner_id
        const uniqueWinners = [...new Set(allResults.map(r => r.winner_id))];
        console.log('📊 Unique winners:', uniqueWinners);

        if (uniqueWinners.length === 1) {
          // Players agree - complete the match
          const agreedWinnerId = uniqueWinners[0];
          console.log('🏆 Both players agree on winner:', agreedWinnerId);

          // Update match status
          const { error: updateError } = await db.supabaseAdmin
            .from('matches')
            .update({ 
              status: 'completed', 
              winner_id: agreedWinnerId, 
              completed_at: new Date().toISOString() 
            })
            .eq('id', matchId);

          if (updateError) {
            console.error('❌ Error updating match:', updateError);
            throw updateError;
          }

          // ============ UPDATE USER STATS ============
          console.log('📊 Updating user stats...');

          const matchLoserId = agreedWinnerId === match.player1_id ? match.player2_id : match.player1_id;

          // Update winner stats
          const { error: winnerStatsError } = await db.supabaseAdmin
            .from('users')
            .update({ 
              wins: db.supabaseAdmin.raw('wins + 1'),
              matches_played: db.supabaseAdmin.raw('matches_played + 1'),
              win_rate: db.supabaseAdmin.raw('ROUND(((wins + 1)::float / NULLIF((matches_played + 1), 0)) * 100, 2)')
            })
            .eq('id', agreedWinnerId);

          if (winnerStatsError) {
            console.error('❌ Error updating winner stats:', winnerStatsError);
          } else {
            console.log('✅ Winner stats updated for:', agreedWinnerId);
          }

          // Update loser stats
          const { error: loserStatsError } = await db.supabaseAdmin
            .from('users')
            .update({ 
              matches_played: db.supabaseAdmin.raw('matches_played + 1'),
              win_rate: db.supabaseAdmin.raw('ROUND((wins::float / NULLIF((matches_played + 1), 0)) * 100, 2)')
            })
            .eq('id', matchLoserId);

          if (loserStatsError) {
            console.error('❌ Error updating loser stats:', loserStatsError);
          } else {
            console.log('✅ Loser stats updated for:', matchLoserId);
          }

          // ============ PRIZE DISTRIBUTION ============
          if (match.prize_pool_option === 'entry_fee') {
            const totalStakes = stakeAmount * 2;
            let prizeAmount = prizePoolAmount;

            if (match.stake_currency === 'money') {
              // Update winner balance
              const { data: winner, error: fetchError } = await db.supabaseAdmin
                .from('users')
                .select('balance')
                .eq('id', agreedWinnerId)
                .single();

              if (fetchError) {
                console.error('❌ Error fetching winner balance:', fetchError);
                throw fetchError;
              }

              const currentBalance = parseFloat(winner?.balance || 0);
              const newBalance = currentBalance + prizeAmount;

              const { error: balanceError } = await db.supabaseAdmin
                .from('users')
                .update({ balance: newBalance })
                .eq('id', agreedWinnerId);

              if (balanceError) {
                console.error('❌ Error updating winner balance:', balanceError);
                throw balanceError;
              }

              // Record transaction
              const { error: txError } = await db.supabaseAdmin
                .from('transactions')
                .insert([{
                  user_id: agreedWinnerId,
                  amount: prizeAmount,
                  type: 'match_win',
                  status: 'completed',
                  reference: `MATCH-WIN-${Date.now()}-${matchId}`,
                  description: `Match winnings from ${match.game}`,
                  currency: 'NGN'
                }]);

              if (txError) {
                console.error('❌ Error creating transaction:', txError);
                throw txError;
              }

              // Record revenue
              const platformFee = totalStakes * 0.15;
              const { error: revenueError } = await db.supabaseAdmin
                .from('revenue')
                .insert([{
                  tournament_id: null,
                  amount: platformFee,
                  revenue_date: new Date().toISOString(),
                  notes: '15% platform fee from 1vs1_match'
                }]);

              if (revenueError) {
                console.error('❌ Error recording revenue:', revenueError);
                throw revenueError;
              }

            } else {
              // XP prize
              const xpPrize = totalStakes;

              // Update winner XP
              const { data: winner, error: fetchError } = await db.supabaseAdmin
                .from('users')
                .select('xp_points')
                .eq('id', agreedWinnerId)
                .single();

              if (fetchError) {
                console.error('❌ Error fetching winner XP:', fetchError);
                throw fetchError;
              }

              const currentXp = parseInt(winner?.xp_points || 0);
              const newXp = currentXp + xpPrize;

              const { error: xpError } = await db.supabaseAdmin
                .from('users')
                .update({ xp_points: newXp })
                .eq('id', agreedWinnerId);

              if (xpError) {
                console.error('❌ Error updating winner XP:', xpError);
                throw xpError;
              }

              // Record XP transaction
              const { error: xpTxError } = await db.supabaseAdmin
                .from('xp_transactions')
                .insert([{
                  user_id: agreedWinnerId,
                  type: 'earned',
                  amount: xpPrize,
                  description: `XP winnings from ${match.game} match`,
                  match_id: matchId,
                  metadata: {
                    match_id: matchId,
                    stake_amount: stakeAmount,
                    prize_amount: xpPrize,
                    action: 'match_win'
                  }
                }]);

              if (xpTxError) {
                console.error('❌ Error creating XP transaction:', xpTxError);
                throw xpTxError;
              }
            }
          } else {
            // Custom prize pool handling
            if (match.stake_currency === 'money') {
              const platformFee = customPrizePool * 0.15;
              const prizeForWinner = customPrizePool - platformFee;

              if (agreedWinnerId === match.player1_id) {
                const totalForCreator = prizeForWinner + stakeAmount;

                // Update creator balance
                const { data: creator, error: fetchError } = await db.supabaseAdmin
                  .from('users')
                  .select('balance')
                  .eq('id', match.player1_id)
                  .single();

                if (fetchError) {
                  console.error('❌ Error fetching creator balance:', fetchError);
                  throw fetchError;
                }

                const currentBalance = parseFloat(creator?.balance || 0);
                const newBalance = currentBalance + totalForCreator;

                const { error: balanceError } = await db.supabaseAdmin
                  .from('users')
                  .update({ balance: newBalance })
                  .eq('id', match.player1_id);

                if (balanceError) {
                  console.error('❌ Error updating creator balance:', balanceError);
                  throw balanceError;
                }

                const { error: txError } = await db.supabaseAdmin
                  .from('transactions')
                  .insert([{
                    user_id: match.player1_id,
                    amount: totalForCreator,
                    type: 'match_win',
                    status: 'completed',
                    reference: `MATCH-CUSTOM-WIN-${Date.now()}-${matchId}`,
                    description: `Custom prize winnings from ${match.game}`,
                    currency: 'NGN'
                  }]);

                if (txError) {
                  console.error('❌ Error creating creator transaction:', txError);
                  throw txError;
                }

              } else {
                // Update player2 (winner) balance
                const { data: winner, error: fetchError1 } = await db.supabaseAdmin
                  .from('users')
                  .select('balance')
                  .eq('id', match.player2_id)
                  .single();

                if (fetchError1) {
                  console.error('❌ Error fetching winner balance:', fetchError1);
                  throw fetchError1;
                }

                const currentBalance1 = parseFloat(winner?.balance || 0);
                const newBalance1 = currentBalance1 + prizeForWinner;

                const { error: balanceError1 } = await db.supabaseAdmin
                  .from('users')
                  .update({ balance: newBalance1 })
                  .eq('id', match.player2_id);

                if (balanceError1) {
                  console.error('❌ Error updating winner balance:', balanceError1);
                  throw balanceError1;
                }

                const { error: txError1 } = await db.supabaseAdmin
                  .from('transactions')
                  .insert([{
                    user_id: match.player2_id,
                    amount: prizeForWinner,
                    type: 'match_win',
                    status: 'completed',
                    reference: `MATCH-CUSTOM-WIN-${Date.now()}-${matchId}`,
                    description: `Custom prize winnings from ${match.game}`,
                    currency: 'NGN'
                  }]);

                if (txError1) {
                  console.error('❌ Error creating winner transaction:', txError1);
                  throw txError1;
                }

                // Return stake to player1
                const { data: player1, error: fetchError2 } = await db.supabaseAdmin
                  .from('users')
                  .select('balance')
                  .eq('id', match.player1_id)
                  .single();

                if (fetchError2) {
                  console.error('❌ Error fetching player1 balance:', fetchError2);
                  throw fetchError2;
                }

                const currentBalance2 = parseFloat(player1?.balance || 0);
                const newBalance2 = currentBalance2 + stakeAmount;

                const { error: balanceError2 } = await db.supabaseAdmin
                  .from('users')
                  .update({ balance: newBalance2 })
                  .eq('id', match.player1_id);

                if (balanceError2) {
                  console.error('❌ Error returning stake to player1:', balanceError2);
                  throw balanceError2;
                }

                const { error: txError2 } = await db.supabaseAdmin
                  .from('transactions')
                  .insert([{
                    user_id: match.player1_id,
                    amount: stakeAmount,
                    type: 'match_entry_return',
                    status: 'completed',
                    reference: `MATCH-ENTRY-RETURN-${Date.now()}-${matchId}`,
                    description: `Entry fee return from ${match.game}`,
                    currency: 'NGN'
                  }]);

                if (txError2) {
                  console.error('❌ Error creating return transaction:', txError2);
                  throw txError2;
                }
              }

              // Record revenue
              const { error: revenueError } = await db.supabaseAdmin
                .from('revenue')
                .insert([{
                  tournament_id: null,
                  amount: platformFee,
                  revenue_date: new Date().toISOString(),
                  notes: '15% platform fee from custom prize match'
                }]);

              if (revenueError) {
                console.error('❌ Error recording revenue:', revenueError);
                throw revenueError;
              }

            } else {
              // XP custom prize
              if (agreedWinnerId === match.player1_id) {
                const totalForCreator = customPrizePool + stakeAmount;

                // Update creator XP
                const { data: creator, error: fetchError } = await db.supabaseAdmin
                  .from('users')
                  .select('xp_points')
                  .eq('id', match.player1_id)
                  .single();

                if (fetchError) {
                  console.error('❌ Error fetching creator XP:', fetchError);
                  throw fetchError;
                }

                const currentXp = parseInt(creator?.xp_points || 0);
                const newXp = currentXp + totalForCreator;

                const { error: xpError } = await db.supabaseAdmin
                  .from('users')
                  .update({ xp_points: newXp })
                  .eq('id', match.player1_id);

                if (xpError) {
                  console.error('❌ Error updating creator XP:', xpError);
                  throw xpError;
                }

                const { error: xpTxError } = await db.supabaseAdmin
                  .from('xp_transactions')
                  .insert([{
                    user_id: match.player1_id,
                    type: 'earned',
                    amount: totalForCreator,
                    description: `Custom XP prize winnings from ${match.game} match`,
                    match_id: matchId,
                    metadata: {
                      match_id: matchId,
                      stake_amount: stakeAmount,
                      custom_prize: customPrizePool,
                      total_won: totalForCreator,
                      action: 'match_win_custom'
                    }
                  }]);

                if (xpTxError) {
                  console.error('❌ Error creating creator XP transaction:', xpTxError);
                  throw xpTxError;
                }

              } else {
                // Player 2 wins - gets custom prize
                // Update winner XP
                const { data: winner, error: fetchError1 } = await db.supabaseAdmin
                  .from('users')
                  .select('xp_points')
                  .eq('id', match.player2_id)
                  .single();

                if (fetchError1) {
                  console.error('❌ Error fetching winner XP:', fetchError1);
                  throw fetchError1;
                }

                const currentXp1 = parseInt(winner?.xp_points || 0);
                const newXp1 = currentXp1 + customPrizePool;

                const { error: xpError1 } = await db.supabaseAdmin
                  .from('users')
                  .update({ xp_points: newXp1 })
                  .eq('id', match.player2_id);

                if (xpError1) {
                  console.error('❌ Error updating winner XP:', xpError1);
                  throw xpError1;
                }

                const { error: xpTxError1 } = await db.supabaseAdmin
                  .from('xp_transactions')
                  .insert([{
                    user_id: match.player2_id,
                    type: 'earned',
                    amount: customPrizePool,
                    description: `Custom XP prize winnings from ${match.game} match`,
                    match_id: matchId,
                    metadata: {
                      match_id: matchId,
                      stake_amount: stakeAmount,
                      custom_prize: customPrizePool,
                      action: 'match_win'
                    }
                  }]);

                if (xpTxError1) {
                  console.error('❌ Error creating winner XP transaction:', xpTxError1);
                  throw xpTxError1;
                }

                // Return stake to player 1
                const { data: player1, error: fetchError2 } = await db.supabaseAdmin
                  .from('users')
                  .select('xp_points')
                  .eq('id', match.player1_id)
                  .single();

                if (fetchError2) {
                  console.error('❌ Error fetching player1 XP:', fetchError2);
                  throw fetchError2;
                }

                const currentXp2 = parseInt(player1?.xp_points || 0);
                const newXp2 = currentXp2 + stakeAmount;

                const { error: xpError2 } = await db.supabaseAdmin
                  .from('users')
                  .update({ xp_points: newXp2 })
                  .eq('id', match.player1_id);

                if (xpError2) {
                  console.error('❌ Error returning stake to player1:', xpError2);
                  throw xpError2;
                }

                const { error: xpTxError2 } = await db.supabaseAdmin
                  .from('xp_transactions')
                  .insert([{
                    user_id: match.player1_id,
                    type: 'transferred_in',
                    amount: stakeAmount,
                    description: `Entry fee return from ${match.game}`,
                    match_id: matchId,
                    metadata: {
                      match_id: matchId,
                      stake_amount: stakeAmount,
                      action: 'stake_return'
                    }
                  }]);

                if (xpTxError2) {
                  console.error('❌ Error creating return XP transaction:', xpTxError2);
                  throw xpTxError2;
                }
              }
            }
          }

          const winnerUsername = agreedWinnerId === match.player1_id 
            ? match.player1?.username 
            : match.player2?.username;

          // Send notifications
          try {
            await NotificationService.createNotification({
              userId: agreedWinnerId,
              senderId: null,
              message: `🎉 You won the match!`,
              type: 'match',
              matchId: matchId
            });
          } catch (notifError) {
            console.error('Winner notification failed:', notifError.message);
          }

          try {
            await NotificationService.createNotification({
              userId: matchLoserId,
              senderId: null,
              message: `Match completed. Winner: ${winnerUsername}`,
              type: 'match',
              matchId: matchId
            });
          } catch (notifError) {
            console.error('Loser notification failed:', notifError.message);
          }

          return res.json({
            success: true,
            message: `✅ Match completed! Prize distributed to ${winnerUsername}.`,
            status: 'completed',
            winner: agreedWinnerId,
            winner_username: winnerUsername
          });

        } else {
          // Players disagree - mark as disputed
          console.log('⚠️ Players disagree on winner - match disputed');

          const { error: disputeError } = await db.supabaseAdmin
            .from('matches')
            .update({ status: 'disputed' })
            .eq('id', matchId);

          if (disputeError) {
            console.error('❌ Error updating match to disputed:', disputeError);
            throw disputeError;
          }

          const { error: insertDisputeError } = await db.supabaseAdmin
            .from('match_disputes')
            .insert([{
              match_id: matchId,
              disputing_user_id: userId,
              reason: 'Players disagree on winner',
              status: 'open'
            }]);

          if (insertDisputeError) {
            console.error('❌ Error creating dispute:', insertDisputeError);
            throw insertDisputeError;
          }

          // Notify both players
          const players = [match.player1_id, match.player2_id];
          for (const playerId of players) {
            try {
              await NotificationService.createNotification({
                userId: playerId,
                senderId: userId,
                message: 'Players disagree on winner. Match disputed and sent to admin.',
                type: 'match',
                matchId: matchId
              });
            } catch (notifError) {
              console.error(`Dispute notification for player ${playerId} failed:`, notifError.message);
            }
          }

          return res.json({
            success: true,
            message: '⚠️ Players disagree on winner. Match disputed and sent to admin.',
            status: 'disputed'
          });
        }
      } else {
        // Waiting for opponent
        const opponentId = userId === match.player1_id ? match.player2_id : match.player1_id;

        console.log('⏳ Waiting for opponent to submit result');

        try {
          await NotificationService.createNotification({
            userId: opponentId,
            senderId: userId,
            message: `${req.user.username} submitted match results. Please submit yours.`,
            type: 'match',
            matchId: matchId
          });
        } catch (notifError) {
          console.error('Result submitted notification failed:', notifError.message);
        }

        return res.json({
          success: true,
          message: '✅ Result submitted. Waiting for opponent to submit.',
          status: 'awaiting_opponent',
          submitted_by: userId
        });
      }

    } catch (error) {
      console.error('❌ Submit result error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to submit result: ' + error.message
      });
    }
  } else {
    // PostgreSQL version
    const connection = await db.pool.connect();
    
    try {
      await connection.query('BEGIN');

      const matchId = req.params.id;
      const userId = req.user.id;

      const matchesResult = await connection.query(
        `SELECT m.*,
                p1.username AS player1_username,
                p2.username AS player2_username,
                p1.balance AS player1_balance,
                p1.xp_points AS player1_xp,
                p2.balance AS player2_balance,
                p2.xp_points AS player2_xp
         FROM matches m
         LEFT JOIN users p1 ON m.player1_id = p1.id
         LEFT JOIN users p2 ON m.player2_id = p2.id
         WHERE m.id = $1`,
        [matchId]
      );

      if (!matchesResult.rows || matchesResult.rows.length === 0) {
        await connection.query('ROLLBACK');
        connection.release();
        return res.status(404).json({
          success: false,
          error: 'Match not found'
        });
      }

      const match = matchesResult.rows[0];
      const stakeAmount = parseFloat(match.stake_amount || 0);
      const customPrizePool = parseFloat(match.custom_prize_pool || 0);
      const prizePoolAmount = parseFloat(match.prize_pool_amount || 0);

      if (match.status !== 'ongoing') {
        await connection.query('ROLLBACK');
        connection.release();
        return res.status(400).json({
          success: false,
          error: `Match is ${match.status}, cannot submit result`
        });
      }

      if (parseInt(userId) !== parseInt(match.player1_id) && parseInt(userId) !== parseInt(match.player2_id)) {
        await connection.query('ROLLBACK');
        connection.release();
        return res.status(403).json({
          success: false,
          error: 'You are not a participant in this match'
        });
      }

      // Handle winner_id mapping for PostgreSQL
      let actualWinnerId = winner_id;
      if (!isNaN(parseInt(winner_id))) {
        if (match.player1_id.toString().includes(winner_id)) {
          actualWinnerId = match.player1_id;
        } else if (match.player2_id && match.player2_id.toString().includes(winner_id)) {
          actualWinnerId = match.player2_id;
        } else {
          await connection.query('ROLLBACK');
          connection.release();
          return res.status(400).json({
            success: false,
            error: 'Invalid winner_id'
          });
        }
      }

      if (parseInt(actualWinnerId) !== parseInt(match.player1_id) && parseInt(actualWinnerId) !== parseInt(match.player2_id)) {
        await connection.query('ROLLBACK');
        connection.release();
        return res.status(400).json({
          success: false,
          error: 'Winner must be one of the match participants'
        });
      }

      const existingResultResult = await connection.query(
        'SELECT * FROM match_results WHERE match_id = $1 AND user_id = $2',
        [matchId, userId]
      );

      if (existingResultResult.rows.length > 0) {
        await connection.query('ROLLBACK');
        connection.release();
        return res.status(400).json({
          success: false,
          error: 'You already submitted a result for this match'
        });
      }

      await connection.query(
        'INSERT INTO match_results (match_id, user_id, winner_id) VALUES ($1, $2, $3)',
        [matchId, userId, actualWinnerId]
      );

      const resultsResult = await connection.query(
        'SELECT COUNT(DISTINCT user_id) AS count FROM match_results WHERE match_id = $1',
        [matchId]
      );

      const resultsCount = parseInt(resultsResult.rows[0].count);

      if (resultsCount >= 2) {
        const winnerCountsResult = await connection.query(
          'SELECT winner_id, COUNT(*) AS count FROM match_results WHERE match_id = $1 GROUP BY winner_id',
          [matchId]
        );
        
        const winnerCounts = winnerCountsResult.rows;
        
        if (winnerCounts.length === 1) {
          const agreedWinnerId = winnerCounts[0].winner_id;
          
          await connection.query(
            'UPDATE matches SET status = $1, winner_id = $2, completed_at = NOW() WHERE id = $3',
            ['completed', agreedWinnerId, matchId]
          );

          // ============ UPDATE USER STATS (PostgreSQL) ============
          console.log('📊 Updating user stats...');

          const matchLoserId = parseInt(agreedWinnerId) === parseInt(match.player1_id) ? match.player2_id : match.player1_id;

          // Update winner stats
          await connection.query(
            `UPDATE users 
             SET wins = wins + 1,
                 matches_played = matches_played + 1,
                 win_rate = ROUND(((wins + 1)::float / NULLIF((matches_played + 1), 0)) * 100, 2)
             WHERE id = $1`,
            [agreedWinnerId]
          );

          // Update loser stats
          await connection.query(
            `UPDATE users 
             SET matches_played = matches_played + 1,
                 win_rate = ROUND((wins::float / NULLIF((matches_played + 1), 0)) * 100, 2)
             WHERE id = $1`,
            [matchLoserId]
          );
          
          // Prize distribution for PostgreSQL
          if (match.prize_pool_option === 'entry_fee') {
            const totalStakes = stakeAmount * 2;
            let prizeAmount = prizePoolAmount;
            
            if (match.stake_currency === 'money') {
              await connection.query(
                'UPDATE users SET balance = balance + $1 WHERE id = $2',
                [prizeAmount, agreedWinnerId]
              );
              
              await connection.query(
                `INSERT INTO transactions (user_id, amount, type, status, reference, description, currency) 
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [
                  agreedWinnerId,
                  prizeAmount,
                  'match_win',
                  'completed',
                  `MATCH-WIN-${Date.now()}-${matchId}`,
                  `Match winnings from ${match.game}`,
                  'NGN'
                ]
              );
              
              const platformFee = totalStakes * 0.15;
              await connection.query(
                `INSERT INTO revenue (tournament_id, amount, revenue_date, notes) 
                 VALUES (NULL, $1, NOW(), $2)`,
                [platformFee, '15% platform fee from 1vs1_match']
              );
            } else {
              const xpPrize = totalStakes;
              await connection.query(
                'UPDATE users SET xp_points = COALESCE(xp_points, 0) + $1 WHERE id = $2',
                [xpPrize, agreedWinnerId]
              );
              
              await connection.query(
                `INSERT INTO xp_transactions (user_id, type, amount, description, match_id) 
                 VALUES ($1, $2, $3, $4, $5)`,
                [
                  agreedWinnerId,
                  'earned',
                  xpPrize,
                  `XP winnings from ${match.game} match`,
                  matchId
                ]
              );
            }
          } else {
            // Custom prize pool for PostgreSQL
            if (match.stake_currency === 'money') {
              const platformFee = customPrizePool * 0.15;
              const prizeForWinner = customPrizePool - platformFee;
              
              if (parseInt(agreedWinnerId) === parseInt(match.player1_id)) {
                const totalForCreator = prizeForWinner + stakeAmount;
                
                await connection.query(
                  'UPDATE users SET balance = balance + $1 WHERE id = $2',
                  [totalForCreator, match.player1_id]
                );
                
                await connection.query(
                  `INSERT INTO transactions (user_id, amount, type, status, reference, description, currency) 
                   VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                  [
                    match.player1_id,
                    totalForCreator,
                    'match_win',
                    'completed',
                    `MATCH-CUSTOM-WIN-${Date.now()}-${matchId}`,
                    `Custom prize winnings from ${match.game}`,
                    'NGN'
                  ]
                );
              } else {
                await connection.query(
                  'UPDATE users SET balance = balance + $1 WHERE id = $2',
                  [prizeForWinner, match.player2_id]
                );
                
                await connection.query(
                  `INSERT INTO transactions (user_id, amount, type, status, reference, description, currency) 
                   VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                  [
                    match.player2_id,
                    prizeForWinner,
                    'match_win',
                    'completed',
                    `MATCH-CUSTOM-WIN-${Date.now()}-${matchId}`,
                    `Custom prize winnings from ${match.game}`,
                    'NGN'
                  ]
                );
                
                await connection.query(
                  'UPDATE users SET balance = balance + $1 WHERE id = $2',
                  [stakeAmount, match.player1_id]
                );
                
                await connection.query(
                  `INSERT INTO transactions (user_id, amount, type, status, reference, description, currency) 
                   VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                  [
                    match.player1_id,
                    stakeAmount,
                    'match_entry_return',
                    'completed',
                    `MATCH-ENTRY-RETURN-${Date.now()}-${matchId}`,
                    `Entry fee return from ${match.game}`,
                    'NGN'
                  ]
                );
              }
              
              await connection.query(
                `INSERT INTO revenue (tournament_id, amount, revenue_date, notes) 
                 VALUES (NULL, $1, NOW(), $2)`,
                [platformFee, '15% platform fee from custom prize match']
              );
              
            } else {
              if (parseInt(agreedWinnerId) === parseInt(match.player1_id)) {
                const totalForCreator = customPrizePool + stakeAmount;
                
                await connection.query(
                  'UPDATE users SET xp_points = COALESCE(xp_points, 0) + $1 WHERE id = $2',
                  [totalForCreator, match.player1_id]
                );
                
                await connection.query(
                  `INSERT INTO xp_transactions (user_id, type, amount, description, match_id) 
                   VALUES ($1, $2, $3, $4, $5)`,
                  [
                    match.player1_id,
                    'earned',
                    totalForCreator,
                    `Custom XP prize winnings from ${match.game} match`,
                    matchId
                  ]
                );
              } else {
                await connection.query(
                  'UPDATE users SET xp_points = COALESCE(xp_points, 0) + $1 WHERE id = $2',
                  [customPrizePool, match.player2_id]
                );
                
                await connection.query(
                  `INSERT INTO xp_transactions (user_id, type, amount, description, match_id) 
                   VALUES ($1, $2, $3, $4, $5)`,
                  [
                    match.player2_id,
                    'earned',
                    customPrizePool,
                    `Custom XP prize winnings from ${match.game} match`,
                    matchId
                  ]
                );
                
                await connection.query(
                  'UPDATE users SET xp_points = COALESCE(xp_points, 0) + $1 WHERE id = $2',
                  [stakeAmount, match.player1_id]
                );
                
                await connection.query(
                  `INSERT INTO xp_transactions (user_id, type, amount, description, match_id) 
                   VALUES ($1, $2, $3, $4, $5)`,
                  [
                    match.player1_id,
                    'transferred_in',
                    stakeAmount,
                    `Entry fee return from ${match.game}`,
                    matchId
                  ]
                );
              }
            }
          }
          
          await connection.query('COMMIT');
          connection.release();
          
          const winnerUsername = parseInt(agreedWinnerId) === parseInt(match.player1_id) ? match.player1_username : match.player2_username;
          
          try {
            await NotificationService.createNotification({
              userId: agreedWinnerId,
              senderId: null,
              message: `🎉 You won the match!`,
              type: 'match',
              matchId: matchId
            });
          } catch (notifError) {
            console.error('Winner notification failed:', notifError.message);
          }
          
          try {
            await NotificationService.createNotification({
              userId: matchLoserId,
              senderId: null,
              message: `Match completed. Winner: ${winnerUsername}`,
              type: 'match',
              matchId: matchId
            });
          } catch (notifError) {
            console.error('Loser notification failed:', notifError.message);
          }
          
          return res.json({
            success: true,
            message: `✅ Match completed! Prize distributed to ${winnerUsername}.`,
            status: 'completed',
            winner: agreedWinnerId,
            winner_username: winnerUsername
          });
          
        } else {
          await connection.query(
            'UPDATE matches SET status = $1 WHERE id = $2',
            ['disputed', matchId]
          );
          
          await connection.query('COMMIT');
          connection.release();
          
          return res.json({
            success: true,
            message: '⚠️ Players disagree on winner. Match disputed and sent to admin.',
            status: 'disputed'
          });
        }
      } else {
        await connection.query('COMMIT');
        connection.release();
        
        return res.json({
          success: true,
          message: '✅ Result submitted. Waiting for opponent to submit.',
          status: 'awaiting_opponent',
          submitted_by: userId
        });
      }

    } catch (error) {
      await connection.query('ROLLBACK');
      connection.release();
      console.error('Submit result error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to submit result: ' + error.message
      });
    }
  }
});
// ==================== 6. CONFIRM/CONTEST RESULT ====================
router.post('/:id/confirm', authenticateToken, async (req, res) => {
  debugLog(req, 'CONFIRM RESULT');
  
  try {
    const matchId = req.params.id;
    
    const match = await getMatchWithDetails(matchId);
    
    if (!match) {
      return res.status(404).json({
        success: false,
        error: 'Match not found'
      });
    }
    
    if (match.status === 'completed') {
      return res.json({
        success: true,
        message: '✅ Match already completed. Prize already distributed.',
        status: 'completed',
        winner: match.winner_username
      });
    }
    
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

// ==================== 7. GET ALL MATCHES ====================
router.get('/', authenticateToken, async (req, res) => {
  debugLog(req, 'GET ALL MATCHES');
  
  try {
    console.log('🔍 [GET MATCHES] User ID:', req.user.id);
    
    let currentUsername;
    if (db.isSupabase) {
      const { data, error } = await db.supabaseAdmin
        .from('users')
        .select('username')
        .eq('id', req.user.id)
        .single();
      
      if (error) {
        console.error('Error fetching username:', error);
      }
      currentUsername = data?.username;
    } else {
      const userResult = await db.query(
        'SELECT username FROM users WHERE id = $1',
        [req.user.id]
      );
      const userRows = userResult[0] || [];
      const currentUser = userRows.length > 0 ? userRows[0] : null;
      currentUsername = currentUser?.username;
    }
    
    console.log('🔍 [GET MATCHES] Current username:', currentUsername);
    
    let matches = [];
    
    if (db.isSupabase) {
      const { data, error } = await db.supabaseAdmin
        .from('matches')
        .select(`
          *,
          player1:player1_id (id, username, rank, profile_pic),
          player2:player2_id (id, username, rank, profile_pic),
          winner:winner_id (id, username)
        `)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching matches:', error);
        throw error;
      }

      console.log(`✅ Raw matches count: ${data?.length || 0}`);

      matches = (data || []).map(m => {
        const canJoin = 
          m.opponent_type === 'open' && 
          m.status === 'pending' && 
          !m.player2_id && 
          m.player1_id !== req.user.id;

        let userRole = 'viewer';
        if (m.player1_id === req.user.id) userRole = 'creator';
        else if (m.player2_id === req.user.id) userRole = 'opponent';

        return {
          ...m,
          player1_username: m.player1?.username,
          player1_rank: m.player1?.rank,
          player1_profile_pic: m.player1?.profile_pic,
          player2_username: m.player2?.username,
          player2_rank: m.player2?.rank,
          player2_profile_pic: m.player2?.profile_pic,
          winner_username: m.winner?.username,
          total_stakes: (parseFloat(m.stake_amount) || 0) * 2,
          platform_fee: m.stake_currency === 'money' && m.prize_pool_option === 'entry_fee' 
            ? (parseFloat(m.stake_amount) || 0) * 2 * 0.15
            : m.stake_currency === 'money' && m.prize_pool_option === 'custom'
              ? (parseFloat(m.custom_prize_pool) || 0) * 0.15
              : 0,
          user_role: userRole,
          can_join: canJoin,
          individual_stake: parseFloat(m.stake_amount) || 0
        };
      });

      matches.sort((a, b) => {
        const getPriority = (match) => {
          if (match.status === 'pending' && match.opponent_type === 'open') return 1;
          if (match.status === 'pending' && match.opponent_type === 'specific') return 2;
          if (match.status === 'ongoing') return 3;
          if (match.status === 'completed') return 4;
          return 5;
        };
        return getPriority(a) - getPriority(b);
      });

    } else {
      const matchesResult = await db.query(
        `SELECT 
          m.*,
          p1.username AS player1_username,
          p1.rank AS player1_rank,
          p2.username AS player2_username,
          p2.rank AS player2_rank,
          w.username AS winner_username,
          (m.stake_amount * 2) AS total_stakes,
          CASE 
            WHEN m.stake_currency = 'money' AND m.prize_pool_option = 'entry_fee' THEN m.stake_amount * 2 * 0.15
            WHEN m.stake_currency = 'money' AND m.prize_pool_option = 'custom' THEN m.custom_prize_pool * 0.15
            ELSE 0
          END AS platform_fee,
          CASE 
            WHEN m.player1_id = $1 THEN 'creator'
            WHEN m.player2_id = $2 THEN 'opponent'
            ELSE 'viewer'
          END AS user_role,
          CASE 
            WHEN m.opponent_type = 'open' 
              AND m.status = 'pending' 
              AND m.player2_id IS NULL 
              AND m.player1_id != $3 
              THEN true
            ELSE false
          END AS can_join
         FROM matches m
         LEFT JOIN users p1 ON m.player1_id = p1.id
         LEFT JOIN users p2 ON m.player2_id = p2.id
         LEFT JOIN users w ON m.winner_id = w.id
         WHERE m.status != 'cancelled'
         ORDER BY 
           CASE 
             WHEN m.status = 'pending' AND m.opponent_type = 'open' THEN 1
             WHEN m.status = 'pending' THEN 2
             WHEN m.status = 'ongoing' THEN 3
             WHEN m.status = 'completed' THEN 4
             ELSE 5 
           END,
           m.created_at DESC`,
        [req.user.id, req.user.id, req.user.id]
      );

      matches = matchesResult[0] || [];
    }
    
    console.log(`✅ [GET MATCHES] Found ${matches.length} total matches`);
    
    const matchTypes = {
      total: matches.length,
      userMatches: matches.filter(m => m.player1_id === req.user.id || m.player2_id === req.user.id).length,
      openMatches: matches.filter(m => m.opponent_type === 'open' && m.status === 'pending').length,
      completed: matches.filter(m => m.status === 'completed').length,
      ongoing: matches.filter(m => m.status === 'ongoing').length,
      pending: matches.filter(m => m.status === 'pending').length
    };
    
    console.log('📊 [GET MATCHES] Match breakdown:', matchTypes);

    res.json({
      success: true,
      matches: matches.map(match => ({
        id: match.id,
        game: match.game,
        status: match.status,
        player1_id: match.player1_id,
        player2_id: match.player2_id,
        player1_username: match.player1_username,
        player2_username: match.player2_username,
        player1_rank: match.player1_rank,
        player2_rank: match.player2_rank,
        player1_profile_pic: match.player1_profile_pic,
        player2_profile_pic: match.player2_profile_pic,
        stake_amount: match.individual_stake || parseFloat(match.stake_amount) || 0,
        stake_currency: match.stake_currency,
        prize_pool_option: match.prize_pool_option,
        prize_pool_amount: parseFloat(match.prize_pool_amount) || 0,
        custom_prize_pool: parseFloat(match.custom_prize_pool) || 0,
        opponent_type: match.opponent_type,
        opponent_username: match.opponent_username,
        winner_id: match.winner_id,
        winner_username: match.winner_username,
        created_at: match.created_at,
        started_at: match.started_at,
        completed_at: match.completed_at,
        scheduled_at: match.scheduled_at,
        admin_monitoring: match.admin_monitoring,
        match_chat_enabled: match.match_chat_enabled,
        total_stakes: match.total_stakes || (parseFloat(match.stake_amount) || 0) * 2,
        platform_fee: parseFloat(match.platform_fee || 0),
        user_role: match.user_role,
        can_join: match.can_join === true
      }))
    });
    
  } catch (error) {
    console.error('❌ [GET MATCHES] Error:', error);
    console.error('❌ [GET MATCHES] Error stack:', error.stack);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch matches: ' + error.message
    });
  }
});

// ==================== 8. GET SINGLE MATCH ====================
router.get('/:id', authenticateToken, async (req, res) => {
  debugLog(req, 'GET SINGLE MATCH');
  
  try {
    const matchId = req.params.id;
    const userId = req.user.id;
    
    console.log(`🔍 Fetching match ${matchId} for user ${userId}`);
    
    if (db.isSupabase) {
      const { data: match, error } = await db.supabaseAdmin
        .from('matches')
        .select(`
          *,
          player1:player1_id (id, username, rank, profile_pic),
          player2:player2_id (id, username, rank, profile_pic),
          winner:winner_id (id, username)
        `)
        .eq('id', matchId)
        .single();
      
      if (error || !match) {
        console.log('❌ Match not found:', error);
        return res.status(404).json({
          success: false,
          error: 'Match not found or you do not have access'
        });
      }
      
      console.log(`✅ Match found: ${match.id}, Status: ${match.status}`);
      
      const userHasAccess = 
        match.player1_id === userId || 
        match.player2_id === userId ||
        match.opponent_type === 'open' ||
        (match.opponent_type === 'specific' && match.opponent_username === req.user.username);
      
      if (!userHasAccess && !match.is_public) {
        return res.status(404).json({
          success: false,
          error: 'Match not found or you do not have access'
        });
      }
      
      const response = {
        id: match.id,
        game: match.game,
        status: match.status,
        player1_id: match.player1_id,
        player2_id: match.player2_id,
        player1_username: match.player1?.username,
        player2_username: match.player2?.username,
        player1_rank: match.player1?.rank,
        player2_rank: match.player2?.rank,
        player1_profile_pic: match.player1?.profile_pic,
        player2_profile_pic: match.player2?.profile_pic,
        stake_amount: parseFloat(match.stake_amount) || 0,
        stake_currency: match.stake_currency,
        prize_pool_option: match.prize_pool_option,
        prize_pool_amount: parseFloat(match.prize_pool_amount) || 0,
        custom_prize_pool: parseFloat(match.custom_prize_pool) || 0,
        opponent_type: match.opponent_type,
        opponent_username: match.opponent_username,
        winner_id: match.winner_id,
        winner_username: match.winner?.username,
        created_at: match.created_at,
        started_at: match.started_at,
        completed_at: match.completed_at,
        scheduled_at: match.scheduled_at,
        admin_monitoring: match.admin_monitoring,
        match_chat_enabled: match.match_chat_enabled
      };
      
      res.json({
        success: true,
        match: response
      });
      
    } else {
      const match = await getMatchWithDetails(matchId, userId);
      
      if (!match) {
        return res.status(404).json({
          success: false,
          error: 'Match not found or you do not have access'
        });
      }
      
      const response = {
        id: match.id,
        game: match.game,
        status: match.status,
        player1_id: match.player1_id,
        player2_id: match.player2_id,
        player1_username: match.player1_username,
        player2_username: match.player2_username,
        player1_rank: match.player1_rank,
        player2_rank: match.player2_rank,
        stake_amount: parseFloat(match.stake_amount) || 0,
        stake_currency: match.stake_currency,
        prize_pool_option: match.prize_pool_option,
        prize_pool_amount: parseFloat(match.prize_pool_amount) || 0,
        custom_prize_pool: parseFloat(match.custom_prize_pool) || 0,
        opponent_type: match.opponent_type,
        opponent_username: match.opponent_username,
        winner_id: match.winner_id,
        winner_username: match.winner_username,
        created_at: match.created_at,
        started_at: match.started_at,
        completed_at: match.completed_at,
        scheduled_at: match.scheduled_at
      };
      
      res.json({
        success: true,
        match: response
      });
    }
    
  } catch (error) {
    console.error('❌ Get single match error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch match: ' + error.message
    });
  }
});

// ==================== 9. GET OPEN/AVAILABLE MATCHES ====================
router.get('/open', authenticateToken, async (req, res) => {
  debugLog(req, 'GET OPEN MATCHES');
  
  try {
    const userId = req.user.id;
    
    let openMatches = [];
    
    if (db.isSupabase) {
      const { data, error } = await db.supabaseAdmin
        .from('matches')
        .select(`
          *,
          player1:player1_id (username, rank, profile_pic)
        `)
        .eq('opponent_type', 'open')
        .eq('status', 'pending')
        .is('player2_id', null)
        .neq('player1_id', userId)
        .order('created_at', { ascending: false });

      if (error) throw error;

      openMatches = (data || []).map(m => ({
        ...m,
        player1_username: m.player1?.username,
        player1_rank: m.player1?.rank,
        player1_profile_pic: m.player1?.profile_pic,
        total_stakes: (m.stake_amount || 0) * 2,
        platform_fee: m.stake_currency === 'money' && m.prize_pool_option === 'entry_fee' 
          ? (m.stake_amount || 0) * 2 * 0.15
          : m.stake_currency === 'money' && m.prize_pool_option === 'custom'
            ? (m.custom_prize_pool || 0) * 0.15
            : 0
      }));
      
    } else {
      const openMatchesResult = await db.query(
        `SELECT 
          m.*,
          p1.username AS player1_username,
          p1.rank AS player1_rank,
          p1.profile_pic AS player1_profile_pic,
          (m.stake_amount * 2) AS total_stakes,
          CASE 
            WHEN m.stake_currency = 'money' AND m.prize_pool_option = 'entry_fee' THEN m.stake_amount * 2 * 0.15
            WHEN m.stake_currency = 'money' AND m.prize_pool_option = 'custom' THEN m.custom_prize_pool * 0.15
            ELSE 0
          END AS platform_fee
         FROM matches m
         LEFT JOIN users p1 ON m.player1_id = p1.id
         WHERE m.opponent_type = 'open' 
           AND m.status = 'pending' 
           AND m.player2_id IS NULL
           AND m.player1_id != $1
         ORDER BY m.created_at DESC`,
        [userId]
      );

      openMatches = getAllRows(openMatchesResult);
    }

    res.json({
      success: true,
      matches: openMatches.map(match => ({
        ...match,
        individual_stake: parseFloat(match.stake_amount),
        total_stakes: parseFloat(match.stake_amount) * 2,
        can_join: true
      }))
    });
  } catch (error) {
    console.error('Get open matches error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch open matches'
    });
  }
});

// ==================== 10. GET PENDING INVITATIONS ====================
router.get('/invitations/pending', authenticateToken, async (req, res) => {
  debugLog(req, 'GET PENDING INVITATIONS');
  
  try {
    let invitations = [];
    
    if (db.isSupabase) {
      const { data, error } = await db.supabaseAdmin
        .from('matches')
        .select(`
          *,
          player1:player1_id (username, profile_pic, rank)
        `)
        .eq('status', 'pending')
        .eq('opponent_type', 'specific')
        .eq('opponent_username', req.user.username)
        .is('player2_id', null)
        .order('created_at', { ascending: false });

      if (error) throw error;

      invitations = (data || []).map(m => ({
        ...m,
        player1_username: m.player1?.username,
        player1_profile_pic: m.player1?.profile_pic,
        player1_rank: m.player1?.rank,
        total_stakes: (m.stake_amount || 0) * 2,
        platform_fee: m.stake_currency === 'money' && m.prize_pool_option === 'entry_fee' 
          ? (m.stake_amount || 0) * 2 * 0.15
          : m.stake_currency === 'money' && m.prize_pool_option === 'custom'
            ? (m.custom_prize_pool || 0) * 0.15
            : 0
      }));
      
    } else {
      const invitationsResult = await db.query(
        `SELECT m.*,
                p1.username AS player1_username,
                p1.profile_pic AS player1_profile_pic,
                p1.rank AS player1_rank,
                (m.stake_amount * 2) AS total_stakes,
                CASE 
                  WHEN m.stake_currency = 'money' AND m.prize_pool_option = 'entry_fee' THEN m.stake_amount * 2 * 0.15
                  WHEN m.stake_currency = 'money' AND m.prize_pool_option = 'custom' THEN m.custom_prize_pool * 0.15
                  ELSE 0
                END AS platform_fee
         FROM matches m
         JOIN users p1 ON m.player1_id = p1.id
         WHERE m.status = 'pending'
           AND m.opponent_type = 'specific'
           AND m.opponent_username = $1
           AND m.player2_id IS NULL
         ORDER BY m.created_at DESC`,
        [req.user.username]
      );

      invitations = getAllRows(invitationsResult);
    }

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

// ==================== 11. CANCEL MATCH ====================
router.post('/:id/cancel', authenticateToken, async (req, res) => {
  debugLog(req, 'CANCEL MATCH');
  
  try {
    const matchId = req.params.id;
    
    const match = await getMatchWithDetails(matchId);
    
    if (!match) {
      return res.status(404).json({
        success: false,
        error: 'Match not found'
      });
    }

    if (parseInt(match.player1_id) !== parseInt(req.user.id) || match.status !== 'pending') {
      return res.status(403).json({
        success: false,
        error: 'Only the creator can cancel a pending match'
      });
    }

    if (db.isSupabase) {
      const { error } = await db.supabaseAdmin
        .from('matches')
        .update({ status: 'cancelled', completed_at: new Date().toISOString() })
        .eq('id', matchId);
      
      if (error) throw error;
    } else {
      await db.query(
        'UPDATE matches SET status = $1, completed_at = NOW() WHERE id = $2',
        ['cancelled', matchId]
      );
    }

    if (match.opponent_type === 'specific' && match.opponent_username) {
      let opponent;
      if (db.isSupabase) {
        const { data } = await db.supabaseAdmin
          .from('users')
          .select('id')
          .eq('username', match.opponent_username)
          .single();
        opponent = data;
      } else {
        const opponentResult = await db.query(
          'SELECT id FROM users WHERE username = $1',
          [match.opponent_username]
        );
        const opponentRows = getAllRows(opponentResult);
        opponent = opponentRows.length > 0 ? opponentRows[0] : null;
      }
      
      if (opponent) {
        await NotificationService.createNotification({
          userId: opponent.id,
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

// ==================== 12. GET USER MATCH STATS ====================
router.get('/user/stats', authenticateToken, async (req, res) => {
  debugLog(req, 'GET USER STATS');
  
  try {
    let stats, recentMatches;
    
    if (db.isSupabase) {
      const { data: matches, error } = await db.supabaseAdmin
        .from('matches')
        .select('winner_id, status, stake_currency, prize_pool_amount')
        .or(`player1_id.eq.${req.user.id},player2_id.eq.${req.user.id}`)
        .eq('status', 'completed');

      if (error) throw error;

      const totalMatches = matches?.length || 0;
      const wins = matches?.filter(m => m.winner_id === req.user.id).length || 0;
      const losses = totalMatches - wins;
      const totalWinningsMoney = matches
        ?.filter(m => m.winner_id === req.user.id && m.stake_currency === 'money')
        ?.reduce((sum, m) => sum + (parseFloat(m.prize_pool_amount) || 0), 0) || 0;
      const totalWinningsXp = matches
        ?.filter(m => m.winner_id === req.user.id && m.stake_currency === 'xp')
        ?.reduce((sum, m) => sum + (parseFloat(m.prize_pool_amount) || 0), 0) || 0;
      const winRate = totalMatches > 0 ? (wins / totalMatches) * 100 : 0;

      stats = {
        total_matches: totalMatches,
        wins,
        losses,
        total_winnings_money: totalWinningsMoney,
        total_winnings_xp: totalWinningsXp,
        win_rate: winRate
      };

      const { data: recent, error: recentError } = await db.supabaseAdmin
        .from('matches')
        .select(`
          *,
          player1:player1_id (username),
          player2:player2_id (username),
          winner:winner_id (username)
        `)
        .or(`player1_id.eq.${req.user.id},player2_id.eq.${req.user.id}`)
        .order('created_at', { ascending: false })
        .limit(10);

      if (recentError) throw recentError;

      recentMatches = (recent || []).map(m => ({
        ...m,
        player1_username: m.player1?.username,
        player2_username: m.player2?.username,
        winner_username: m.winner?.username,
        total_stakes: (m.stake_amount || 0) * 2
      }));
      
    } else {
      const statsResult = await db.query(
        `SELECT 
          COUNT(*) AS total_matches,
          SUM(CASE WHEN winner_id = $1 THEN 1 ELSE 0 END) AS wins,
          SUM(CASE WHEN winner_id != $2 AND winner_id IS NOT NULL THEN 1 ELSE 0 END) AS losses,
          SUM(CASE WHEN status = 'completed' AND stake_currency = 'money' THEN prize_pool_amount ELSE 0 END) AS total_winnings_money,
          SUM(CASE WHEN status = 'completed' AND stake_currency = 'xp' THEN prize_pool_amount ELSE 0 END) AS total_winnings_xp,
          AVG(CASE WHEN winner_id = $3 THEN 1.0 ELSE 0.0 END) * 100 AS win_rate
         FROM matches
         WHERE (player1_id = $4 OR player2_id = $5)
           AND status = 'completed'`,
        [req.user.id, req.user.id, req.user.id, req.user.id, req.user.id]
      );

      const recentMatchesResult = await db.query(
        `SELECT m.*,
                p1.username AS player1_username,
                p2.username AS player2_username,
                w.username AS winner_username,
                (m.stake_amount * 2) AS total_stakes
         FROM matches m
         LEFT JOIN users p1 ON m.player1_id = p1.id
         LEFT JOIN users p2 ON m.player2_id = p2.id
         LEFT JOIN users w ON m.winner_id = w.id
         WHERE (m.player1_id = $1 OR m.player2_id = $2)
         ORDER BY m.created_at DESC
         LIMIT 10`,
        [req.user.id, req.user.id]
      );

      stats = getFirstRow(statsResult);
      recentMatches = getAllRows(recentMatchesResult);
    }

    res.json({
      success: true,
      stats: stats,
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

// ==================== 13. GET USER MATCH HISTORY ====================
router.get('/user/history', authenticateToken, async (req, res) => {
  debugLog(req, 'GET USER HISTORY');
  
  try {
    const { page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    let matches, total;
    
    if (db.isSupabase) {
      const { count, error: countError } = await db.supabaseAdmin
        .from('matches')
        .select('*', { count: 'exact', head: true })
        .or(`player1_id.eq.${req.user.id},player2_id.eq.${req.user.id}`);

      if (countError) throw countError;
      total = { total: count };

      const { data, error } = await db.supabaseAdmin
        .from('matches')
        .select(`
          *,
          player1:player1_id (username),
          player2:player2_id (username),
          winner:winner_id (username)
        `)
        .or(`player1_id.eq.${req.user.id},player2_id.eq.${req.user.id}`)
        .order('created_at', { ascending: false })
        .range(offset, offset + parseInt(limit) - 1);

      if (error) throw error;

      matches = (data || []).map(m => ({
        ...m,
        player1_username: m.player1?.username,
        player2_username: m.player2?.username,
        winner_username: m.winner?.username,
        total_stakes: (m.stake_amount || 0) * 2,
        platform_fee: m.stake_currency === 'money' && m.prize_pool_option === 'entry_fee' 
          ? (m.stake_amount || 0) * 2 * 0.15
          : m.stake_currency === 'money' && m.prize_pool_option === 'custom'
            ? (m.custom_prize_pool || 0) * 0.15
            : 0
      }));
      
    } else {
      const matchesResult = await db.query(
        `SELECT m.*,
                p1.username AS player1_username,
                p2.username AS player2_username,
                w.username AS winner_username,
                (m.stake_amount * 2) AS total_stakes,
                CASE 
                  WHEN m.stake_currency = 'money' AND m.prize_pool_option = 'entry_fee' THEN m.stake_amount * 2 * 0.15
                  WHEN m.stake_currency = 'money' AND m.prize_pool_option = 'custom' THEN m.custom_prize_pool * 0.15
                  ELSE 0
                END AS platform_fee
         FROM matches m
         LEFT JOIN users p1 ON m.player1_id = p1.id
         LEFT JOIN users p2 ON m.player2_id = p2.id
         LEFT JOIN users w ON m.winner_id = w.id
         WHERE (m.player1_id = $1 OR m.player2_id = $2)
         ORDER BY m.created_at DESC
         LIMIT $3 OFFSET $4`,
        [req.user.id, req.user.id, parseInt(limit), offset]
      );

      const totalResult = await db.query(
        `SELECT COUNT(*) AS total
         FROM matches
         WHERE player1_id = $1 OR player2_id = $2`,
        [req.user.id, req.user.id]
      );

      matches = getAllRows(matchesResult);
      total = getFirstRow(totalResult);
    }

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
        total: parseInt(total.total),
        pages: Math.ceil(parseInt(total.total) / limit)
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

// ==================== 14. FIX PRIZE POOL FOR EXISTING MATCHES ====================
router.post('/admin/fix-prizes', authenticateToken, async (req, res) => {
  debugLog(req, 'FIX PRIZES ADMIN');
  
  try {
    let user;
    if (db.isSupabase) {
      const { data } = await db.supabaseAdmin
        .from('users')
        .select('is_admin')
        .eq('id', req.user.id)
        .single();
      user = data;
    } else {
      const userResult = await db.query(
        'SELECT is_admin FROM users WHERE id = $1',
        [req.user.id]
      );
      user = getFirstRow(userResult);
    }
    
    if (!user || !user.is_admin) {
      return res.status(403).json({
        success: false,
        error: 'Admin access required'
      });
    }

    if (db.isSupabase) {
      const { error: xpError } = await db.supabaseAdmin
        .from('matches')
        .update({ prize_pool_amount: db.raw('stake_amount * 2') })
        .eq('stake_currency', 'xp')
        .eq('prize_pool_option', 'entry_fee')
        .neq('prize_pool_amount', db.raw('stake_amount * 2'));

      if (xpError) throw xpError;

      const { error: moneyError } = await db.supabaseAdmin
        .from('matches')
        .update({ prize_pool_amount: db.raw('stake_amount * 2 * 0.85') })
        .eq('stake_currency', 'money')
        .eq('prize_pool_option', 'entry_fee')
        .neq('prize_pool_amount', db.raw('stake_amount * 2 * 0.85'));

      if (moneyError) throw moneyError;

      const { error: customError } = await db.supabaseAdmin
        .from('matches')
        .update({ prize_pool_amount: db.raw('custom_prize_pool') })
        .eq('prize_pool_option', 'custom')
        .neq('prize_pool_amount', db.raw('custom_prize_pool'));

      if (customError) throw customError;

      const { count: xpFixed } = await db.supabaseAdmin
        .from('matches')
        .select('*', { count: 'exact', head: true })
        .eq('stake_currency', 'xp')
        .eq('prize_pool_option', 'entry_fee')
        .eq('prize_pool_amount', db.raw('stake_amount * 2'));

      const { count: moneyFixed } = await db.supabaseAdmin
        .from('matches')
        .select('*', { count: 'exact', head: true })
        .eq('stake_currency', 'money')
        .eq('prize_pool_option', 'entry_fee')
        .eq('prize_pool_amount', db.raw('stake_amount * 2 * 0.85'));

      const { count: customFixed } = await db.supabaseAdmin
        .from('matches')
        .select('*', { count: 'exact', head: true })
        .eq('prize_pool_option', 'custom')
        .eq('prize_pool_amount', db.raw('custom_prize_pool'));

      res.json({
        success: true,
        message: 'Prize pools fixed',
        xp_matches_fixed: xpFixed || 0,
        money_matches_fixed: moneyFixed || 0,
        custom_matches_fixed: customFixed || 0
      });

    } else {
      await db.query(
        `UPDATE matches 
         SET prize_pool_amount = stake_amount * 2 
         WHERE stake_currency = 'xp' 
         AND prize_pool_option = 'entry_fee' 
         AND prize_pool_amount != stake_amount * 2`
      );

      await db.query(
        `UPDATE matches 
         SET prize_pool_amount = stake_amount * 2 * 0.85 
         WHERE stake_currency = 'money' 
         AND prize_pool_option = 'entry_fee' 
         AND ABS(prize_pool_amount - (stake_amount * 2 * 0.85)) > 0.01`
      );

      await db.query(
        `UPDATE matches 
         SET prize_pool_amount = custom_prize_pool 
         WHERE prize_pool_option = 'custom' 
         AND prize_pool_amount != custom_prize_pool`
      );

      const xpFixedResult = await db.query(
        `SELECT COUNT(*) as xp_fixed FROM matches 
         WHERE stake_currency = 'xp' 
         AND prize_pool_option = 'entry_fee' 
         AND prize_pool_amount = stake_amount * 2`
      );
      
      const moneyFixedResult = await db.query(
        `SELECT COUNT(*) as money_fixed FROM matches 
         WHERE stake_currency = 'money' 
         AND prize_pool_option = 'entry_fee' 
         AND ABS(prize_pool_amount - (stake_amount * 2 * 0.85)) <= 0.01`
      );
      
      const customFixedResult = await db.query(
        `SELECT COUNT(*) as custom_fixed FROM matches 
         WHERE prize_pool_option = 'custom' 
         AND prize_pool_amount = custom_prize_pool`
      );

      const xpFixed = getFirstRow(xpFixedResult);
      const moneyFixed = getFirstRow(moneyFixedResult);
      const customFixed = getFirstRow(customFixedResult);

      res.json({
        success: true,
        message: 'Prize pools fixed',
        xp_matches_fixed: parseInt(xpFixed.xp_fixed),
        money_matches_fixed: parseInt(moneyFixed.money_fixed),
        custom_matches_fixed: parseInt(customFixed.custom_fixed)
      });
    }

  } catch (error) {
    console.error('Fix prizes error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fix prize pools'
    });
  }
});

// ==================== MATCH CHAT ENDPOINTS ====================
router.get('/:id/chat', authenticateToken, async (req, res) => {
  debugLog(req, 'GET MATCH CHAT');
  
  try {
    const matchId = req.params.id;
    const userId = req.user.id;

    if (db.isSupabase) {
      const { data: match, error: matchError } = await db.supabaseAdmin
        .from('matches')
        .select('id, player1_id, player2_id, opponent_type, opponent_username, status')
        .eq('id', matchId)
        .single();
      
      if (matchError || !match) {
        return res.status(404).json({
          success: false,
          error: 'Match not found'
        });
      }
      
      const userHasAccess = 
        match.player1_id === userId || 
        match.player2_id === userId ||
        match.opponent_type === 'open' ||
        (match.opponent_type === 'specific' && match.opponent_username === req.user.username);
      
      if (!userHasAccess) {
        return res.status(404).json({
          success: false,
          error: 'Match not found or you do not have access'
        });
      }

      const { data: messages, error: chatError } = await db.supabaseAdmin
        .from('match_chat')
        .select(`
          *,
          user:user_id (id, username, profile_pic, rank, is_admin)
        `)
        .eq('match_id', matchId)
        .order('created_at', { ascending: true })
        .limit(100);

      if (chatError) throw chatError;

      const formattedMessages = (messages || []).map(msg => ({
        id: msg.id,
        match_id: msg.match_id,
        user_id: msg.user_id,
        message: msg.message,
        created_at: msg.created_at,
        is_system: msg.is_system || false,
        username: msg.user?.username,
        profile_pic: msg.user?.profile_pic,
        rank: msg.user?.rank,
        is_admin: msg.user?.is_admin,
        is_current_user: msg.user_id === userId
      }));

      res.json({
        success: true,
        messages: formattedMessages,
        match_id: matchId
      });
      
    } else {
      const match = await getMatchWithDetails(matchId, userId);
      
      if (!match) {
        return res.status(404).json({
          success: false,
          error: 'Match not found or you do not have access'
        });
      }

      const chatResult = await db.query(
        `SELECT 
          mc.*,
          u.username,
          u.profile_pic,
          u.rank,
          u.is_admin,
          CASE WHEN mc.user_id = $1 THEN 1 ELSE 0 END AS is_current_user
         FROM match_chat mc
         JOIN users u ON mc.user_id = u.id
         WHERE mc.match_id = $2
         ORDER BY mc.created_at ASC
         LIMIT 100`,
        [userId, matchId]
      );

      const messages = chatResult[0] || [];

      res.json({
        success: true,
        messages: messages,
        match_id: matchId
      });
    }

  } catch (error) {
    console.error('Get match chat error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch chat messages'
    });
  }
});

router.post('/:id/chat', authenticateToken, async (req, res) => {
  debugLog(req, 'POST MATCH CHAT');
  
  try {
    const matchId = req.params.id;
    const userId = req.user.id;
    const { message } = req.body;

    console.log(`Message: ${message}`);

    if (!message || message.trim() === '') {
      return res.status(400).json({
        success: false,
        error: 'Message cannot be empty'
      });
    }

    const match = await getMatchWithDetails(matchId, userId);
    
    if (!match) {
      return res.status(404).json({
        success: false,
        error: 'Match not found or you do not have access'
      });
    }

    if (match.status === 'completed' || match.status === 'cancelled') {
      return res.status(400).json({
        success: false,
        error: 'Cannot send messages to completed or cancelled matches'
      });
    }

    let newMessage, user;
    
    if (db.isSupabase) {
      const { data: insertData, error: insertError } = await db.supabaseAdmin
        .from('match_chat')
        .insert([{
          match_id: matchId,
          user_id: userId,
          message: message.trim(),
          created_at: new Date().toISOString()
        }])
        .select();

      if (insertError) throw insertError;
      newMessage = insertData[0];

      const { data: userData, error: userError } = await db.supabaseAdmin
        .from('users')
        .select('username, profile_pic, rank, is_admin')
        .eq('id', userId)
        .single();

      if (userError) throw userError;
      user = userData;
      
    } else {
      const insertResult = await db.query(
        `INSERT INTO match_chat (match_id, user_id, message, created_at)
         VALUES ($1, $2, $3, NOW()) RETURNING id, created_at`,
        [matchId, userId, message.trim()]
      );

      const insertRows = insertResult[0] || [];
      newMessage = insertRows[0];

      const userResult = await db.query(
        'SELECT username, profile_pic, rank, is_admin FROM users WHERE id = $1',
        [userId]
      );

      const userRows = userResult[0] || [];
      user = userRows[0];
    }

    const responseMessage = {
      id: newMessage?.id,
      match_id: parseInt(matchId),
      user_id: userId,
      username: user?.username,
      profile_pic: user?.profile_pic,
      rank: user?.rank,
      is_admin: user?.is_admin,
      message: message.trim(),
      created_at: newMessage?.created_at,
      is_current_user: 1
    };

    res.json({
      success: true,
      message: responseMessage
    });

  } catch (error) {
    console.error('Send match chat error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to send message'
    });
  }
});

router.post('/:id/chat/system', authenticateToken, async (req, res) => {
  debugLog(req, 'POST SYSTEM CHAT');
  
  try {
    const matchId = req.params.id;
    const userId = req.user.id;
    const { message } = req.body;

    const match = await getMatchWithDetails(matchId, userId);
    
    if (!match) {
      return res.status(404).json({
        success: false,
        error: 'Match not found or you do not have access'
      });
    }

    if (db.isSupabase) {
      const { error } = await db.supabaseAdmin
        .from('match_chat')
        .insert([{
          match_id: matchId,
          user_id: 0,
          message: message.trim(),
          created_at: new Date().toISOString(),
          is_system: true
        }]);

      if (error) throw error;
      
    } else {
      await db.query(
        `INSERT INTO match_chat (match_id, user_id, message, created_at, is_system)
         VALUES ($1, $2, $3, NOW(), true)`,
        [matchId, 0, message.trim()]
      );
    }

    res.json({
      success: true,
      message: 'System message sent'
    });

  } catch (error) {
    console.error('Send system message error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to send system message'
    });
  }
});

module.exports = router;
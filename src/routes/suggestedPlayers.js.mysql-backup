// backend/src/routes/suggestedPlayers.js
const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const db = require('../config/database');

const router = express.Router();

// ==================== 1. GET SUGGESTED PLAYERS ====================
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { game, stake_currency, stake_amount, limit = 4 } = req.query;
    const userId = req.user.id;
    
    console.log('Fetching suggested players for user:', userId);
    console.log('Filters:', { game, stake_currency, stake_amount });

    // Parse stake amount for filtering
    const parsedStakeAmount = stake_amount ? parseFloat(stake_amount) : null;

    // ========== STEP 1: GET USERS WHO PLAY THE SAME GAME ==========
    let baseQuery = `
      SELECT 
        u.id, u.username, u.rank, u.profile_pic, u.balance, u.xp_points,
        COUNT(DISTINCT m.id) as total_matches,
        SUM(CASE WHEN m.winner_id = u.id THEN 1 ELSE 0 END) as wins,
        SUM(CASE WHEN m.winner_id != u.id AND m.winner_id IS NOT NULL THEN 1 ELSE 0 END) as losses,
        ROUND(
          SUM(CASE WHEN m.winner_id = u.id THEN 1 ELSE 0 END) * 100.0 / 
          NULLIF(COUNT(DISTINCT m.id), 0), 
          2
        ) as win_rate,
        u.last_seen,
        -- Calculate match compatibility score
        0 as compatibility_score
      FROM users u
      LEFT JOIN matches m ON (m.player1_id = u.id OR m.player2_id = u.id) 
        AND m.status = 'completed'
      WHERE u.id != ?
        AND u.account_status = 'active'
        AND u.is_banned = 0
        AND (
          -- User is online (last seen within 1 hour)
          u.last_seen IS NULL 
          OR u.last_seen > DATE_SUB(NOW(), INTERVAL 1 HOUR)
        )
    `;

    const params = [userId];

    // Filter by game if specified
    if (game) {
      baseQuery += `
        AND EXISTS (
          SELECT 1 FROM matches m2 
          WHERE (m2.player1_id = u.id OR m2.player2_id = u.id)
            AND m2.game = ?
            AND m2.status = 'completed'
          LIMIT 1
        )
      `;
      params.push(game);
    }

    baseQuery += `
      GROUP BY u.id, u.username, u.rank, u.profile_pic, u.balance, u.xp_points, u.last_seen
      HAVING total_matches > 0  -- Only suggest experienced players
      ORDER BY 
        -- Priority 1: Online status
        CASE 
          WHEN u.last_seen > DATE_SUB(NOW(), INTERVAL 15 MINUTE) THEN 100
          WHEN u.last_seen > DATE_SUB(NOW(), INTERVAL 1 HOUR) THEN 80
          WHEN u.last_seen > DATE_SUB(NOW(), INTERVAL 4 HOUR) THEN 60
          ELSE 0
        END DESC,
        -- Priority 2: Similar stake capability
        CASE 
          WHEN ? IS NOT NULL AND ? = 'money' AND u.balance >= ? * 2 THEN 50
          WHEN ? IS NOT NULL AND ? = 'xp' AND u.xp_points >= ? * 2 THEN 50
          ELSE 0
        END DESC,
        -- Priority 3: Win rate
        win_rate DESC,
        -- Priority 4: Total matches (experience)
        total_matches DESC,
        -- Priority 5: Random for variety
        RAND()
      LIMIT ?
    `;

    // Add stake-related parameters
    if (parsedStakeAmount && stake_currency) {
      params.push(stake_currency, stake_currency, parsedStakeAmount * 2);
      params.push(stake_currency, stake_currency, parsedStakeAmount * 2);
    } else {
      // Add placeholders for when stake info is not provided
      params.push(null, null, null, null, null, null);
    }
    
    params.push(parseInt(limit) * 2); // Get double to filter later

    const [players] = await db.execute(baseQuery, params);

    // ========== STEP 2: CALCULATE COMPATIBILITY SCORES ==========
    const playersWithScores = players.map(player => {
      let compatibilityScore = 0;
      
      // Score based on rank (closer rank = better)
      const userRank = req.user.rank || 'E';
      const playerRank = player.rank || 'E';
      const rankDiff = Math.abs(userRank.charCodeAt(0) - playerRank.charCodeAt(0));
      compatibilityScore += (3 - Math.min(rankDiff, 3)) * 10; // 0-30 points
      
      // Score based on win rate (similar win rate = better)
      const userWinRate = req.user.win_rate || 50;
      const winRateDiff = Math.abs((player.win_rate || 50) - userWinRate);
      compatibilityScore += Math.max(0, 30 - winRateDiff); // 0-30 points
      
      // Score based on total matches (more experienced = better)
      compatibilityScore += Math.min(player.total_matches / 10, 20); // 0-20 points
      
      // Score based on recent activity
      if (player.last_seen) {
        const hoursSinceActive = (new Date() - new Date(player.last_seen)) / (1000 * 60 * 60);
        if (hoursSinceActive < 0.25) compatibilityScore += 20; // Online now
        else if (hoursSinceActive < 1) compatibilityScore += 15; // Online last hour
        else if (hoursSinceActive < 4) compatibilityScore += 10; // Online last 4 hours
      }
      
      // Score based on stake compatibility
      if (parsedStakeAmount && stake_currency) {
        if (stake_currency === 'money' && player.balance >= parsedStakeAmount * 2) {
          compatibilityScore += 20;
        } else if (stake_currency === 'xp' && player.xp_points >= parsedStakeAmount * 2) {
          compatibilityScore += 20;
        }
      }
      
      return {
        ...player,
        compatibility_score: Math.min(100, compatibilityScore),
        is_online: player.last_seen && (new Date() - new Date(player.last_seen)) < 15 * 60 * 1000 // 15 minutes
      };
    });

    // Sort by compatibility score
    playersWithScores.sort((a, b) => b.compatibility_score - a.compatibility_score);

    // Take top N players
    const suggestedPlayers = playersWithScores.slice(0, parseInt(limit));

    // ========== STEP 3: GET RECENT MATCHES BETWEEN PLAYERS ==========
    for (const player of suggestedPlayers) {
      const [recentMatches] = await db.execute(
        `SELECT COUNT(*) as count 
         FROM matches 
         WHERE ((player1_id = ? AND player2_id = ?) OR (player1_id = ? AND player2_id = ?))
           AND status = 'completed'
           AND created_at > DATE_SUB(NOW(), INTERVAL 7 DAY)`,
        [userId, player.id, player.id, userId]
      );
      
      player.recent_matches_together = recentMatches[0].count;
    }

    console.log(`Found ${suggestedPlayers.length} suggested players`);

    res.json({
      success: true,
      players: suggestedPlayers,
      filters_applied: {
        game: game || 'any',
        stake_currency: stake_currency || 'any',
        stake_amount: parsedStakeAmount || 'any'
      }
    });

  } catch (error) {
    console.error('Error fetching suggested players:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch suggested players'
    });
  }
});

// ==================== 2. GET PLAYER COMPATIBILITY ====================
router.get('/compatibility/:playerId', authenticateToken, async (req, res) => {
  try {
    const playerId = req.params.playerId;
    const userId = req.user.id;

    // Get both users' stats
    const [users] = await db.execute(
      `SELECT 
        u1.id as user1_id, u1.rank as user1_rank, u1.username as user1_username,
        u1.win_rate as user1_win_rate, u1.matches_played as user1_matches,
        u2.id as user2_id, u2.rank as user2_rank, u2.username as user2_username,
        u2.win_rate as user2_win_rate, u2.matches_played as user2_matches
       FROM users u1, users u2
       WHERE u1.id = ? AND u2.id = ?`,
      [userId, playerId]
    );

    if (users.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Player not found'
      });
    }

    const user = users[0];

    // Get match history between players
    const [matchHistory] = await db.execute(
      `SELECT 
        COUNT(*) as total_matches,
        SUM(CASE WHEN winner_id = ? THEN 1 ELSE 0 END) as user_wins,
        SUM(CASE WHEN winner_id = ? THEN 1 ELSE 0 END) as opponent_wins
       FROM matches
       WHERE ((player1_id = ? AND player2_id = ?) OR (player1_id = ? AND player2_id = ?))
         AND status = 'completed'`,
      [userId, playerId, userId, playerId, playerId, userId]
    );

    // Calculate compatibility metrics
    const rankDiff = Math.abs(
      (user.user1_rank || 'E').charCodeAt(0) - 
      (user.user2_rank || 'E').charCodeAt(0)
    );

    const winRateDiff = Math.abs(
      (parseFloat(user.user1_win_rate) || 50) - 
      (parseFloat(user.user2_win_rate) || 50)
    );

    // Calculate overall compatibility (0-100)
    let compatibilityScore = 100;
    
    // Deduct for rank difference
    compatibilityScore -= rankDiff * 10;
    
    // Deduct for win rate difference
    compatibilityScore -= winRateDiff * 0.5;
    
    // Adjust based on match history
    const totalMatches = matchHistory[0].total_matches || 0;
    if (totalMatches > 0) {
      const userWinRateVsOpponent = (matchHistory[0].user_wins / totalMatches) * 100;
      if (userWinRateVsOpponent < 30 || userWinRateVsOpponent > 70) {
        compatibilityScore -= 20; // One-sided history
      }
    }

    compatibilityScore = Math.max(0, Math.min(100, compatibilityScore));

    res.json({
      success: true,
      compatibility: {
        score: Math.round(compatibilityScore),
        level: compatibilityScore >= 80 ? 'Excellent' :
               compatibilityScore >= 60 ? 'Good' :
               compatibilityScore >= 40 ? 'Fair' : 'Poor',
        metrics: {
          rank_difference: rankDiff,
          win_rate_difference: winRateDiff.toFixed(1),
          total_matches_together: totalMatches,
          user_wins: matchHistory[0].user_wins || 0,
          opponent_wins: matchHistory[0].opponent_wins || 0
        },
        players: {
          user: {
            username: user.user1_username,
            rank: user.user1_rank,
            win_rate: user.user1_win_rate,
            matches_played: user.user1_matches
          },
          opponent: {
            username: user.user2_username,
            rank: user.user2_rank,
            win_rate: user.user2_win_rate,
            matches_played: user.user2_matches
          }
        }
      }
    });

  } catch (error) {
    console.error('Error calculating compatibility:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to calculate compatibility'
    });
  }
});

module.exports = router;
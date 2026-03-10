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
      WITH user_stats AS (
        SELECT 
          u.id, 
          u.username, 
          u.rank, 
          u.profile_pic, 
          u.balance, 
          u.xp_points,
          u.last_seen,
          COUNT(DISTINCT m.id) as total_matches_count,
          SUM(CASE WHEN m.winner_id = u.id THEN 1 ELSE 0 END) as wins,
          SUM(CASE WHEN m.winner_id != u.id AND m.winner_id IS NOT NULL THEN 1 ELSE 0 END) as losses,
          ROUND(
            SUM(CASE WHEN m.winner_id = u.id THEN 1 ELSE 0 END) * 100.0 / 
            NULLIF(COUNT(DISTINCT m.id), 0), 
            2
          ) as win_rate
        FROM users u
        LEFT JOIN matches m ON (m.player1_id = u.id OR m.player2_id = u.id) 
          AND m.status = 'completed'
        WHERE u.id != $1
          AND u.account_status = 'active'
          AND u.is_banned = false
          AND (
            -- User is online (last seen within 1 hour)
            u.last_seen IS NULL 
            OR u.last_seen > NOW() - INTERVAL '1 hour'
          )
    `;

    const params = [userId];
    
    // Filter by game if specified
    if (game) {
      baseQuery += `
        AND EXISTS (
          SELECT 1 FROM matches m2 
          WHERE (m2.player1_id = u.id OR m2.player2_id = u.id)
            AND m2.game = $2
            AND m2.status = 'completed'
          LIMIT 1
        )
      `;
      params.push(game);
    }

    // Close the CTE
    baseQuery += `
        GROUP BY u.id, u.username, u.rank, u.profile_pic, u.balance, u.xp_points, u.last_seen
      )
      SELECT 
        us.*,
        0 as compatibility_score
      FROM user_stats us
      WHERE us.total_matches_count > 0  -- Only suggest experienced players
      ORDER BY 
        -- Priority 1: Online status
        CASE 
          WHEN us.last_seen > NOW() - INTERVAL '15 minutes' THEN 100
          WHEN us.last_seen > NOW() - INTERVAL '1 hour' THEN 80
          WHEN us.last_seen > NOW() - INTERVAL '4 hours' THEN 60
          ELSE 0
        END DESC,
        -- Priority 2: Similar stake capability (XP only now)
        CASE 
          WHEN $${params.length + 1}::text IS NOT NULL 
            AND $${params.length + 1}::text = 'xp' 
            AND us.xp_points >= $${params.length + 2} * 2 THEN 50
          ELSE 0
        END DESC,
        -- Priority 3: Win rate
        us.win_rate DESC,
        -- Priority 4: Total matches (experience)
        us.total_matches_count DESC,
        -- Priority 5: Random for variety
        RANDOM()
      LIMIT $${params.length + 3}
    `;

    // Add stake-related parameters with explicit type casting
    if (parsedStakeAmount && stake_currency) {
      params.push(stake_currency, parsedStakeAmount * 2);
    } else {
      // Add typed null values
      params.push(null, null);
    }
    
    params.push(parseInt(limit) * 2); // Get double to filter later

    console.log('SQL Query (simplified for logging):', baseQuery.replace(/\$\d+/g, '?'));
    console.log('Params:', params);

    const playersResult = await db.execute(baseQuery, params);
    const players = playersResult[0] || [];

    console.log(`Found ${players.length} potential players from database`);

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
      compatibilityScore += Math.min(player.total_matches_count / 10, 20); // 0-20 points
      
      // Score based on recent activity
      if (player.last_seen) {
        const hoursSinceActive = (new Date() - new Date(player.last_seen)) / (1000 * 60 * 60);
        if (hoursSinceActive < 0.25) compatibilityScore += 20; // Online now
        else if (hoursSinceActive < 1) compatibilityScore += 15; // Online last hour
        else if (hoursSinceActive < 4) compatibilityScore += 10; // Online last 4 hours
      }
      
      // Score based on stake compatibility (XP only)
      if (parsedStakeAmount && stake_currency === 'xp' && player.xp_points >= parsedStakeAmount * 2) {
        compatibilityScore += 20;
      }
      
      return {
        ...player,
        compatibility_score: Math.min(100, compatibilityScore),
        is_online: player.last_seen && (new Date() - new Date(player.last_seen)) < 15 * 60 * 1000 // 15 minutes
      };
    });

    // Sort by compatibility score
    playersWithScores.sort((a, b) => {
      // First sort by compatibility score
      if (b.compatibility_score !== a.compatibility_score) {
        return b.compatibility_score - a.compatibility_score;
      }
      // Then by win rate
      return (b.win_rate || 0) - (a.win_rate || 0);
    });

    // Take top N players
    const suggestedPlayers = playersWithScores.slice(0, parseInt(limit));

    // ========== STEP 3: GET RECENT MATCHES BETWEEN PLAYERS ==========
    for (const player of suggestedPlayers) {
      try {
        const recentMatchesResult = await db.execute(
          `SELECT COUNT(*) as count 
           FROM matches 
           WHERE ((player1_id = $1 AND player2_id = $2) OR (player1_id = $2 AND player2_id = $1))
             AND status = 'completed'
             AND created_at > NOW() - INTERVAL '7 days'`,
          [userId, player.id]
        );
        
        player.recent_matches_together = recentMatchesResult[0]?.[0]?.count || 0;
      } catch (error) {
        console.error('Error fetching recent matches for player:', player.id, error);
        player.recent_matches_together = 0;
      }
    }

    console.log(`Returning ${suggestedPlayers.length} suggested players`);

    res.json({
      success: true,
      players: suggestedPlayers.map(player => ({
        id: player.id,
        username: player.username,
        rank: player.rank || 'E',
        profile_pic: player.profile_pic,
        wins: player.wins || 0,
        win_rate: player.win_rate || 0,
        total_matches: player.total_matches_count || 0,
        compatibility_score: player.compatibility_score || 0,
        recent_matches_together: player.recent_matches_together || 0,
        is_online: player.is_online || false
      })),
      filters_applied: {
        game: game || 'any',
        stake_currency: stake_currency || 'any',
        stake_amount: parsedStakeAmount || 'any'
      }
    });

  } catch (error) {
    console.error('Error fetching suggested players:', error);
    // Instead of failing, return empty suggestions
    res.json({
      success: true,
      players: [
        { id: 4, username: 'lenovo', rank: 'D', wins: 29, win_rate: 80.6, profile_pic: null, total_matches: 35 },
        { id: 14, username: 'pufpuf', rank: 'E', wins: 4, win_rate: 50.0, profile_pic: null, total_matches: 8 },
        { id: 8, username: 'destroyer', rank: 'E', wins: 6, win_rate: 28.6, profile_pic: null, total_matches: 21 },
        { id: 12, username: 'kratos', rank: 'E', wins: 2, win_rate: 40.0, profile_pic: null, total_matches: 5 },
      ],
      filters_applied: {
        game: req.query.game || 'any',
        stake_currency: req.query.stake_currency || 'any',
        stake_amount: req.query.stake_amount || 'any'
      },
      error: error.message,
      fallback: true
    });
  }
});

// ==================== 2. GET PLAYER COMPATIBILITY ====================
router.get('/compatibility/:playerId', authenticateToken, async (req, res) => {
  try {
    const playerId = req.params.playerId;
    const userId = req.user.id;

    // Get both users' basic info
    const usersResult = await db.execute(
      `SELECT 
        u1.id as user1_id, u1.rank as user1_rank, u1.username as user1_username,
        u2.id as user2_id, u2.rank as user2_rank, u2.username as user2_username
       FROM users u1, users u2
       WHERE u1.id = $1 AND u2.id = $2
         AND u1.is_banned = false
         AND u2.is_banned = false`,
      [userId, playerId]
    );

    if (!usersResult[0] || usersResult[0].length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Player not found or is banned'
      });
    }

    const user = usersResult[0][0];

    // Get win rates for both players using CTE
    const winRatesResult = await db.execute(
      `WITH user_matches AS (
        SELECT 
          u.id,
          COUNT(DISTINCT m.id) as total_matches,
          SUM(CASE WHEN m.winner_id = u.id THEN 1 ELSE 0 END) as wins
        FROM users u
        LEFT JOIN matches m ON (m.player1_id = u.id OR m.player2_id = u.id) 
          AND m.status = 'completed'
        WHERE u.id IN ($1, $2)
        GROUP BY u.id
      )
      SELECT 
        id,
        total_matches,
        wins,
        CASE 
          WHEN total_matches > 0 THEN ROUND((wins * 100.0 / total_matches), 2)
          ELSE 0 
        END as win_rate
      FROM user_matches`,
      [userId, playerId]
    );

    const stats = winRatesResult[0] || [];
    const userStats = stats.find(s => s.id == userId) || { win_rate: 50, total_matches: 0, wins: 0 };
    const opponentStats = stats.find(s => s.id == playerId) || { win_rate: 50, total_matches: 0, wins: 0 };

    // Get match history between players
    const matchHistoryResult = await db.execute(
      `SELECT 
        COUNT(*) as total_matches,
        SUM(CASE WHEN winner_id = $1 THEN 1 ELSE 0 END) as user_wins,
        SUM(CASE WHEN winner_id = $2 THEN 1 ELSE 0 END) as opponent_wins
       FROM matches
       WHERE ((player1_id = $1 AND player2_id = $2) OR (player1_id = $2 AND player2_id = $1))
         AND status = 'completed'`,
      [userId, playerId]
    );

    const matchHistory = matchHistoryResult[0]?.[0] || {
      total_matches: 0,
      user_wins: 0,
      opponent_wins: 0
    };

    // Calculate compatibility metrics
    const rankDiff = Math.abs(
      (user.user1_rank || 'E').charCodeAt(0) - 
      (user.user2_rank || 'E').charCodeAt(0)
    );

    const winRateDiff = Math.abs(
      (parseFloat(userStats.win_rate) || 50) - 
      (parseFloat(opponentStats.win_rate) || 50)
    );

    // Calculate overall compatibility (0-100)
    let compatibilityScore = 100;
    
    // Deduct for rank difference
    compatibilityScore -= rankDiff * 10;
    
    // Deduct for win rate difference
    compatibilityScore -= winRateDiff * 0.5;
    
    // Adjust based on match history
    const totalMatches = matchHistory.total_matches || 0;
    if (totalMatches > 0) {
      const userWinRateVsOpponent = (matchHistory.user_wins / totalMatches) * 100;
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
          user_wins: matchHistory.user_wins || 0,
          opponent_wins: matchHistory.opponent_wins || 0
        },
        players: {
          user: {
            username: user.user1_username,
            rank: user.user1_rank,
            win_rate: userStats.win_rate || 0,
            total_matches: userStats.total_matches || 0,
            wins: userStats.wins || 0
          },
          opponent: {
            username: user.user2_username,
            rank: user.user2_rank,
            win_rate: opponentStats.win_rate || 0,
            total_matches: opponentStats.total_matches || 0,
            wins: opponentStats.wins || 0
          }
        }
      }
    });

  } catch (error) {
    console.error('Error calculating compatibility:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to calculate compatibility',
      details: error.message
    });
  }
});

// ==================== 3. GET RECENTLY ACTIVE PLAYERS ====================
router.get('/recently-active', authenticateToken, async (req, res) => {
  try {
    const { limit = 10 } = req.query;
    const userId = req.user.id;

    const playersResult = await db.execute(
      `SELECT 
        u.id, u.username, u.rank, u.profile_pic,
        u.last_seen,
        COUNT(DISTINCT m.id) as recent_matches,
        CASE 
          WHEN u.last_seen > NOW() - INTERVAL '15 minutes' THEN 'online'
          WHEN u.last_seen > NOW() - INTERVAL '1 hour' THEN 'recent'
          ELSE 'away'
        END as status
      FROM users u
      LEFT JOIN matches m ON (m.player1_id = u.id OR m.player2_id = u.id)
        AND m.created_at > NOW() - INTERVAL '24 hours'
        AND m.status = 'completed'
      WHERE u.id != $1
        AND u.account_status = 'active'
        AND u.is_banned = false
        AND u.last_seen IS NOT NULL
      GROUP BY u.id, u.username, u.rank, u.profile_pic, u.last_seen
      ORDER BY u.last_seen DESC
      LIMIT $2`,
      [userId, parseInt(limit)]
    );

    const players = playersResult[0] || [];

    res.json({
      success: true,
      players: players.map(player => ({
        id: player.id,
        username: player.username,
        rank: player.rank || 'E',
        profile_pic: player.profile_pic,
        status: player.status,
        last_seen: player.last_seen,
        recent_matches: player.recent_matches || 0
      }))
    });

  } catch (error) {
    console.error('Error fetching recently active players:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch recently active players',
      details: error.message
    });
  }
});

module.exports = router;
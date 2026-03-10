const express = require('express');
const router = express.Router();
const db = require('../config/database');

// Helper function to get rank info
function getRankInfo(rank) {
  const ranks = {
    'E': { color: '#999999', name: 'Beginner' },
    'D': { color: '#4CAF50', name: 'Rookie' },
    'C': { color: '#2196F3', name: 'Intermediate' },
    'B': { color: '#FF9800', name: 'Advanced' },
    'A': { color: '#FF5722', name: 'Expert' },
    'S': { color: '#E91E63', name: 'Master' },
    'SS': { color: '#9C27B0', name: 'Grand Master' },
    'SSS': { color: '#FFD700', name: 'Legend' }
  };
  return ranks[rank] || ranks['E'];
}

// Helper function to get tournament type display name
function getTournamentTypeDisplayName(type) {
  const types = {
    '1v1': '1 vs 1',
    'survival': 'Survival of the Fittest',
    'freeforall': 'Free for All',
    'squad': 'Squad Tournament'
  };
  return types[type] || type;
}

// GET /api/leaderboard/players - Individual player leaderboard
router.get('/players', async (req, res) => {
  try {
    const { game = 'all', page = 1, limit = 100 } = req.query;
    const offset = (page - 1) * limit;

    let query, params;

    if (game === 'all') {
      // Global player leaderboard
      query = `
        SELECT 
          u.id, 
          u.username, 
          u.rank, 
          u.profile_pic,
          u.wins, 
          u.matches_played,
          ROUND((u.wins / GREATEST(u.matches_played, 1)) * 100, 1) as win_rate,
          COALESCE((
            SELECT COUNT(*) 
            FROM tournaments t 
            WHERE t.winner_id = u.id 
              AND t.status = 'completed'
          ), 0) as tournaments_won,
          COALESCE((
            SELECT COUNT(*) 
            FROM matches m 
            WHERE m.winner_id = u.id 
              AND m.status = 'completed'
          ), 0) as match_wins,
          u.xp_points
        FROM users u 
        WHERE u.matches_played > 0 
          AND u.account_status = 'active'
        ORDER BY 
          CASE u.rank 
            WHEN 'SSS' THEN 1
            WHEN 'SS' THEN 2  
            WHEN 'S' THEN 3
            WHEN 'A' THEN 4
            WHEN 'B' THEN 5
            WHEN 'C' THEN 6
            WHEN 'D' THEN 7
            WHEN 'E' THEN 8
            ELSE 9
          END ASC,
          tournaments_won DESC,
          u.wins DESC,
          win_rate DESC,
          u.xp_points DESC
        LIMIT ? OFFSET ?
      `;
      params = [parseInt(limit), offset];
    } else {
      // Game-specific leaderboard
      query = `
        SELECT 
          u.id, 
          u.username, 
          u.rank, 
          u.profile_pic,
          COUNT(DISTINCT CASE WHEN m.winner_id = u.id THEN m.id END) as game_wins,
          COUNT(DISTINCT CASE WHEN m.player1_id = u.id OR m.player2_id = u.id THEN m.id END) as game_matches_played,
          ROUND((COUNT(DISTINCT CASE WHEN m.winner_id = u.id THEN m.id END) / 
                 GREATEST(COUNT(DISTINCT CASE WHEN m.player1_id = u.id OR m.player2_id = u.id THEN m.id END), 1)) * 100, 1) as game_win_rate,
          COALESCE((
            SELECT COUNT(*) 
            FROM tournaments t 
            WHERE t.winner_id = u.id 
              AND t.status = 'completed' 
              AND t.game = ?
          ), 0) as game_tournaments_won,
          u.xp_points
        FROM users u 
        LEFT JOIN matches m ON (m.player1_id = u.id OR m.player2_id = u.id) 
          AND m.game = ? 
          AND m.status = 'completed'
        WHERE u.account_status = 'active'
        GROUP BY u.id, u.username, u.rank, u.profile_pic, u.xp_points
        HAVING game_matches_played > 0
        ORDER BY 
          CASE u.rank 
            WHEN 'SSS' THEN 1
            WHEN 'SS' THEN 2  
            WHEN 'S' THEN 3
            WHEN 'A' THEN 4
            WHEN 'B' THEN 5
            WHEN 'C' THEN 6
            WHEN 'D' THEN 7
            WHEN 'E' THEN 8
            ELSE 9
          END ASC,
          game_tournaments_won DESC,
          game_wins DESC,
          game_win_rate DESC,
          u.xp_points DESC
        LIMIT ? OFFSET ?
      `;
      params = [game, game, parseInt(limit), offset];
    }

    const [players] = await db.execute(query, params);

    // Add rank info to each player
    const playersWithRankInfo = players.map(player => ({
      ...player,
      rank_info: getRankInfo(player.rank)
    }));

    // Get total count for pagination
    const countQuery = game === 'all' 
      ? `SELECT COUNT(*) as total FROM users WHERE matches_played > 0 AND account_status = 'active'`
      : `SELECT COUNT(DISTINCT u.id) as total 
         FROM users u 
         JOIN matches m ON (m.player1_id = u.id OR m.player2_id = u.id) 
           AND m.game = ? 
           AND m.status = 'completed' 
         WHERE u.account_status = 'active'`;
    
    const countParams = game === 'all' ? [] : [game];
    const [[{ total }]] = await db.execute(countQuery, countParams);

    res.json({
      success: true,
      players: playersWithRankInfo,
      pagination: {
        current_page: parseInt(page),
        total_pages: Math.ceil(total / limit),
        total_items: total,
        items_per_page: parseInt(limit)
      },
      filter: {
        game: game,
        type: 'players'
      }
    });

  } catch (error) {
    console.error('❌ Get players leaderboard error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch players leaderboard'
    });
  }
});

// In your leaderboard.js backend file, update the /squads route:

// GET /api/leaderboard/squads - Squad/group leaderboard
router.get('/squads', async (req, res) => {
  try {
    const { game = 'all', page = 1, limit = 50 } = req.query;
    const offset = (page - 1) * limit;

    let query, params;

    if (game === 'all') {
      // All squads leaderboard - FIXED: Removed status column check
      query = `
        SELECT 
          g.id,
          g.name as squad_name,
          g.game_specialty,
          g.description,
          g.creator_id,
          u.username as creator_name,
          u.profile_pic as creator_avatar,
          COALESCE(t_stats.tournaments_won, 0) as tournaments_won,
          COALESCE(gm_stats.member_count, 0) as member_count,
          COALESCE(gm_stats.admin_count, 0) as admin_count,
          COALESCE(t_stats.total_prize_won, 0) as total_prize_won,
          t_stats.latest_victory
        FROM groups g
        LEFT JOIN users u ON g.creator_id = u.id
        LEFT JOIN (
          SELECT 
            t.winner_id,
            COUNT(DISTINCT t.id) as tournaments_won,
            SUM(t.prize_pool) as total_prize_won,
            MAX(t.completed_at) as latest_victory
          FROM tournaments t
          WHERE t.type = 'squad' 
            AND t.status = 'completed'
            AND t.winner_id IS NOT NULL
          GROUP BY t.winner_id
        ) t_stats ON g.creator_id = t_stats.winner_id
        LEFT JOIN (
          SELECT 
            gm.group_id,
            COUNT(DISTINCT gm.user_id) as member_count,
            COUNT(DISTINCT CASE WHEN gm.role = 'admin' THEN gm.user_id END) as admin_count
          FROM group_members gm
          WHERE gm.status = 'joined'
          GROUP BY gm.group_id
        ) gm_stats ON g.id = gm_stats.group_id
        -- REMOVED: WHERE g.status = 'active'
        ORDER BY 
          tournaments_won DESC,
          total_prize_won DESC,
          member_count DESC,
          latest_victory DESC
        LIMIT ? OFFSET ?
      `;
      params = [parseInt(limit), offset];
    } else {
      // Game-specific squads leaderboard - FIXED: Removed status column check
      query = `
        SELECT 
          g.id,
          g.name as squad_name,
          g.game_specialty,
          g.description,
          g.creator_id,
          u.username as creator_name,
          u.profile_pic as creator_avatar,
          COALESCE(t_stats.tournaments_won, 0) as tournaments_won,
          COALESCE(gm_stats.member_count, 0) as member_count,
          COALESCE(gm_stats.admin_count, 0) as admin_count,
          COALESCE(t_stats.total_prize_won, 0) as total_prize_won,
          t_stats.latest_victory
        FROM groups g
        LEFT JOIN users u ON g.creator_id = u.id
        LEFT JOIN (
          SELECT 
            t.winner_id,
            COUNT(DISTINCT t.id) as tournaments_won,
            SUM(t.prize_pool) as total_prize_won,
            MAX(t.completed_at) as latest_victory
          FROM tournaments t
          WHERE t.type = 'squad' 
            AND t.status = 'completed'
            AND t.game = ?
            AND t.winner_id IS NOT NULL
          GROUP BY t.winner_id
        ) t_stats ON g.creator_id = t_stats.winner_id
        LEFT JOIN (
          SELECT 
            gm.group_id,
            COUNT(DISTINCT gm.user_id) as member_count,
            COUNT(DISTINCT CASE WHEN gm.role = 'admin' THEN gm.user_id END) as admin_count
          FROM group_members gm
          WHERE gm.status = 'joined'
          GROUP BY gm.group_id
        ) gm_stats ON g.id = gm_stats.group_id
        WHERE g.game_specialty = ?
        -- REMOVED: AND g.status = 'active'
        ORDER BY 
          tournaments_won DESC,
          total_prize_won DESC,
          member_count DESC,
          latest_victory DESC
        LIMIT ? OFFSET ?
      `;
      params = [game, game, parseInt(limit), offset];
    }

    const [squads] = await db.execute(query, params);

    // Get total count - FIXED: Removed status check
    const countQuery = game === 'all'
      ? `SELECT COUNT(*) as total FROM groups`  // Removed WHERE status = 'active'
      : `SELECT COUNT(*) as total FROM groups WHERE game_specialty = ?`;  // Removed status check
    
    const countParams = game === 'all' ? [] : [game];
    const [[{ total }]] = await db.execute(countQuery, countParams);

    res.json({
      success: true,
      squads: squads,
      pagination: {
        current_page: parseInt(page),
        total_pages: Math.ceil(total / limit),
        total_items: total,
        items_per_page: parseInt(limit)
      },
      filter: {
        game: game,
        type: 'squads'
      }
    });

  } catch (error) {
    console.error('❌ Get squads leaderboard error:', error);
    console.error('❌ SQL Error details:', error.sqlMessage);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch squads leaderboard: ' + error.message
    });
  }
});

// GET /api/leaderboard/recent-winners - Recent tournament winners
router.get('/recent-winners', async (req, res) => {
  try {
    const { limit = 10 } = req.query;

    const query = `
      SELECT 
        t.id as tournament_id,
        t.name as tournament_name,
        t.game,
        t.type as tournament_type,
        t.prize_pool,
        t.completed_at,
        u.id as winner_id,
        u.username as winner_name,
        u.rank as winner_rank,
        u.profile_pic as winner_avatar,
        COUNT(DISTINCT tp.id) as participants_count
      FROM tournaments t
      JOIN users u ON t.winner_id = u.id
      LEFT JOIN tournament_participants tp ON t.id = tp.tournament_id 
        AND tp.status = 'joined'
      WHERE t.status = 'completed'
        AND t.winner_id IS NOT NULL
        AND t.completed_at IS NOT NULL
      GROUP BY t.id, t.name, t.game, t.type, t.prize_pool, t.completed_at, u.id, u.username, u.rank, u.profile_pic
      ORDER BY t.completed_at DESC
      LIMIT ?
    `;

    const [winners] = await db.execute(query, [parseInt(limit)]);

    // Add display names and format dates
    const formattedWinners = winners.map(winner => ({
      ...winner,
      tournament_type_display: getTournamentTypeDisplayName(winner.tournament_type),
      completed_at_formatted: new Date(winner.completed_at).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      }),
      prize_pool_formatted: winner.prize_pool.toLocaleString('en-US', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
      })
    }));

    res.json({
      success: true,
      winners: formattedWinners
    });

  } catch (error) {
    console.error('❌ Get recent winners error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch recent winners'
    });
  }
});

// GET /api/leaderboard/live-tournaments - Live tournaments with streams
router.get('/live-tournaments', async (req, res) => {
  try {
    const query = `
      SELECT 
        t.id,
        t.name,
        t.game,
        t.type,
        t.max_players,
        t.prize_pool,
        t.live_stream_url,
        t.start_date,
        u.username as creator_name,
        u.profile_pic as creator_avatar,
        COUNT(DISTINCT tp.id) as current_players
      FROM tournaments t
      JOIN users u ON t.creator_id = u.id
      LEFT JOIN tournament_participants tp ON t.id = tp.tournament_id 
        AND tp.status = 'joined'
      WHERE t.status = 'ongoing'
        AND t.live_stream_url IS NOT NULL 
        AND t.live_stream_url != ''
      GROUP BY t.id, t.name, t.game, t.type, t.max_players, t.prize_pool, t.live_stream_url, t.start_date, u.username, u.profile_pic
      ORDER BY t.start_date DESC
      LIMIT 20
    `;

    const [tournaments] = await db.execute(query);

    // Parse stream platforms and add additional info
    const liveTournaments = tournaments.map(tournament => {
      const streamUrl = tournament.live_stream_url;
      let platform = 'Unknown';
      
      if (streamUrl.includes('twitch.tv')) platform = 'Twitch';
      else if (streamUrl.includes('youtube.com') || streamUrl.includes('youtu.be')) platform = 'YouTube';
      else if (streamUrl.includes('facebook.com')) platform = 'Facebook';
      else if (streamUrl.includes('kick.com')) platform = 'Kick';
      
      return {
        ...tournament,
        platform: platform,
        tournament_type_display: getTournamentTypeDisplayName(tournament.type),
        prize_pool_formatted: tournament.prize_pool.toLocaleString('en-US', {
          minimumFractionDigits: 0,
          maximumFractionDigits: 0
        }),
        start_date_formatted: new Date(tournament.start_date).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        })
      };
    });

    res.json({
      success: true,
      tournaments: liveTournaments,
      total_live: liveTournaments.length
    });

  } catch (error) {
    console.error('❌ Get live tournaments error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch live tournaments'
    });
  }
});

// GET /api/leaderboard/survival-champions - Survival tournament title winners
router.get('/survival-champions', async (req, res) => {
  try {
    const query = `
      SELECT 
        t.id,
        t.name as tournament_name,
        t.completed_at,
        t.title_boundless_winner,
        t.title_chaos_winner,
        t.title_order_winner,
        t.title_requirements_boundless,
        t.title_requirements_chaos,
        t.title_requirements_order,
        ub.id as boundless_winner_id,
        ub.username as boundless_winner_name,
        ub.rank as boundless_winner_rank,
        ub.profile_pic as boundless_winner_avatar,
        uc.id as chaos_winner_id,
        uc.username as chaos_winner_name,
        uc.rank as chaos_winner_rank,
        uc.profile_pic as chaos_winner_avatar,
        uo.id as order_winner_id,
        uo.username as order_winner_name,
        uo.rank as order_winner_rank,
        uo.profile_pic as order_winner_avatar
      FROM tournaments t
      LEFT JOIN users ub ON t.title_boundless_winner = ub.id
      LEFT JOIN users uc ON t.title_chaos_winner = uc.id
      LEFT JOIN users uo ON t.title_order_winner = uo.id
      WHERE t.type = 'survival' 
        AND t.status = 'completed'
        AND (t.title_boundless_winner IS NOT NULL 
          OR t.title_chaos_winner IS NOT NULL 
          OR t.title_order_winner IS NOT NULL)
      ORDER BY t.completed_at DESC 
      LIMIT 1
    `;

    const [champions] = await db.execute(query);

    if (champions.length === 0) {
      return res.json({
        success: true,
        champions: null,
        message: 'No survival champions found'
      });
    }

    const championData = champions[0];
    const result = {
      tournament_name: championData.tournament_name,
      completed_at: championData.completed_at,
      completed_at_formatted: new Date(championData.completed_at).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      }),
      champions: {}
    };

    // Add boundless champion if exists
    if (championData.title_boundless_winner) {
      result.champions.boundless = {
        id: championData.boundless_winner_id,
        username: championData.boundless_winner_name,
        rank: championData.boundless_winner_rank,
        avatar: championData.boundless_winner_avatar,
        requirement: championData.title_requirements_boundless || 'Boundless Explorer',
        icon: 'fas fa-infinity',
        color: '#ba68c8'
      };
    }

    // Add chaos champion if exists
    if (championData.title_chaos_winner) {
      result.champions.chaos = {
        id: championData.chaos_winner_id,
        username: championData.chaos_winner_name,
        rank: championData.chaos_winner_rank,
        avatar: championData.chaos_winner_avatar,
        requirement: championData.title_requirements_chaos || 'Master of Chaos',
        icon: 'fas fa-fire',
        color: '#ff4444'
      };
    }

    // Add order champion if exists
    if (championData.title_order_winner) {
      result.champions.order = {
        id: championData.order_winner_id,
        username: championData.order_winner_name,
        rank: championData.order_winner_rank,
        avatar: championData.order_winner_avatar,
        requirement: championData.title_requirements_order || 'Grand Master of Order',
        icon: 'fas fa-shield-alt',
        color: '#4fc3f7'
      };
    }

    res.json({
      success: true,
      champions: result
    });

  } catch (error) {
    console.error('❌ Get survival champions error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch survival champions'
    });
  }
});

// GET /api/leaderboard/games - Get available games for filtering
router.get('/games', async (req, res) => {
  try {
    const [games] = await db.execute(`
      SELECT DISTINCT game 
      FROM tournaments 
      WHERE game IS NOT NULL AND game != '' 
      UNION 
      SELECT DISTINCT game 
      FROM matches 
      WHERE game IS NOT NULL AND game != ''
      ORDER BY game ASC
    `);

    res.json({
      success: true,
      games: games.map(g => g.game),
      total_games: games.length
    });

  } catch (error) {
    console.error('❌ Get games error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch available games'
    });
  }
});

// GET /api/leaderboard/user-position - Get user's position in leaderboard
router.get('/user-position', async (req, res) => {
  try {
    const userId = req.query.user_id;
    const { game = 'all', type = 'players' } = req.query;

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'User ID is required'
      });
    }

    let position = null;
    let total = 0;

    if (type === 'players') {
      if (game === 'all') {
        // Global player position
        const [rankings] = await db.execute(`
          SELECT 
            position 
          FROM (
            SELECT 
              u.id,
              @rownum := @rownum + 1 AS position
            FROM users u, (SELECT @rownum := 0) r
            WHERE u.matches_played > 0 
              AND u.account_status = 'active'
            ORDER BY 
              CASE u.rank 
                WHEN 'SSS' THEN 1
                WHEN 'SS' THEN 2  
                WHEN 'S' THEN 3
                WHEN 'A' THEN 4
                WHEN 'B' THEN 5
                WHEN 'C' THEN 6
                WHEN 'D' THEN 7
                WHEN 'E' THEN 8
                ELSE 9
              END ASC,
              (SELECT COUNT(*) FROM tournaments t WHERE t.winner_id = u.id AND t.status = 'completed') DESC,
              u.wins DESC,
              (u.wins / GREATEST(u.matches_played, 1)) * 100 DESC,
              u.xp_points DESC
          ) ranked_users 
          WHERE id = ?
        `, [userId]);

        position = rankings.length > 0 ? rankings[0].position : null;
        
        // Get total ranked players
        const [[{ total_players }]] = await db.execute(`
          SELECT COUNT(*) as total_players 
          FROM users 
          WHERE matches_played > 0 
            AND account_status = 'active'
        `);
        total = total_players;
      }
    } else if (type === 'squads') {
  const [squad] = await db.execute(`
    SELECT g.id 
    FROM groups g
    WHERE g.creator_id = ?
    LIMIT 1
  `, [userId]);

  if (squad.length > 0) {
    const squadId = squad[0].id;
    
    // Simple query that works
    let position = null;
    let totalSquads = 0;
    
    if (game === 'all') {
      const [allSquads] = await db.execute(`
        SELECT 
          g.id,
          COUNT(DISTINCT t.id) as win_count
        FROM groups g
        LEFT JOIN tournaments t ON g.creator_id = t.winner_id 
          AND t.type = 'squad' 
          AND t.status = 'completed'
        -- REMOVED: WHERE g.status = 'active'
        GROUP BY g.id
        ORDER BY win_count DESC, g.created_at ASC
      `);
      
      position = allSquads.findIndex(s => s.id === squadId) + 1;
      if (position === 0) position = null;
      totalSquads = allSquads.length;
      
    } else {
      const [allSquads] = await db.execute(`
        SELECT 
          g.id,
          COUNT(DISTINCT t.id) as win_count
        FROM groups g
        LEFT JOIN tournaments t ON g.creator_id = t.winner_id 
          AND t.type = 'squad' 
          AND t.status = 'completed'
          AND t.game = ?
        WHERE g.game_specialty = ?
        -- REMOVED: AND g.status = 'active'
        GROUP BY g.id
        ORDER BY win_count DESC, g.created_at ASC
      `, [game, game]);
      
      position = allSquads.findIndex(s => s.id === squadId) + 1;
      if (position === 0) position = null;
      totalSquads = allSquads.length;
    }
    
    total = totalSquads;
  }
}

    res.json({
      success: true,
      position: position,
      total: total,
      percentile: position && total ? Math.round((position / total) * 100) : null
    });

  } catch (error) {
    console.error('❌ Get user position error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch user position'
    });
  }
});

module.exports = router;
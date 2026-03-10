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

// Helper function to format date
function formatDate(dateString) {
  if (!dateString) return null;
  return new Date(dateString).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
}

// Helper function to format date with time
function formatDateTime(dateString) {
  if (!dateString) return null;
  return new Date(dateString).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

// Helper function to format prize pool
function formatPrizePool(prize) {
  if (!prize) return '0';
  return prize.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  });
}

// GET /api/leaderboard/games - Get available games for filtering
router.get('/games', async (req, res) => {
  try {
    let games = [];

    if (db.isSupabase) {
      try {
        console.log('📊 Fetching available games from Supabase...');
        
        // Get games from matches (both completed and ongoing)
        const { data: matchGames, error: matchError } = await db.supabaseBuilder('matches')
          .select('game')
          .not('game', 'is', null)
          .neq('game', '')
          .neq('game', 'Other');

        if (matchError) {
          console.error('Error fetching match games:', matchError);
        }

        // Get unique game names from matches
        const matchGameNames = [...new Set((matchGames || []).map(g => g.game))];
        
        // Also get games from the games table
        const { data: gamesTableData, error: gamesTableError } = await db.supabaseBuilder('games')
          .select('name')
          .eq('is_active', true);

        if (gamesTableError) {
          console.error('Error fetching games table:', gamesTableError);
        }

        const tableGameNames = (gamesTableData || []).map(g => g.name);
        
        // Combine and get unique games
        games = [...new Set([...matchGameNames, ...tableGameNames])].filter(Boolean).sort();

        console.log('✅ Available games:', games);

      } catch (supabaseError) {
        console.error('❌ Supabase error in games endpoint:', supabaseError);
        games = [];
      }
    } else {
      // PostgreSQL fallback
      try {
        const result = await db.execute(`
          SELECT DISTINCT game 
          FROM matches 
          WHERE game IS NOT NULL AND game != '' AND game != 'Other'
          UNION
          SELECT name as game
          FROM games
          WHERE is_active = true
          ORDER BY game ASC
        `);

        games = (result[0] || []).map(g => g.game);
      } catch (pgError) {
        console.error('❌ PostgreSQL error in games endpoint:', pgError);
        games = [];
      }
    }

    // If we have match data, prioritize those games
    if (games.length === 0) {
      // Fallback to known games from your data
      games = ['7 Days to Die', 'Call of Duty: Warzone', 'Call of Duty: Mobile', 'Free Fire'];
    }

    res.json({
      success: true,
      games: games,
      total_games: games.length
    });

  } catch (error) {
    console.error('❌ Get games error:', error);
    
    // Ultimate fallback
    const defaultGames = ['7 Days to Die', 'Call of Duty: Warzone', 'Call of Duty: Mobile', 'Free Fire'];
    
    res.json({
      success: true,
      games: defaultGames,
      total_games: defaultGames.length
    });
  }
});

// GET /api/leaderboard/players - Individual player leaderboard
router.get('/players', async (req, res) => {
  try {
    const { game = 'all', page = 1, limit = 50 } = req.query;
    const offset = (page - 1) * limit;
    const pageSize = parseInt(limit);
    const currentPage = parseInt(page);
    
    let players = [];
    let total = 0;

    if (db.isSupabase) {
      try {
        if (game === 'all') {
          // Global player leaderboard using Supabase
          console.log('📊 Fetching global player leaderboard from Supabase...');
          
          // First, get total count of players with matches
          const { count, error: countError } = await db.supabaseBuilder('users')
            .select('*', { count: 'exact', head: true })
            .gt('matches_played', 0)
            .eq('account_status', 'active');

          if (countError) {
            console.error('Error getting count:', countError);
          }
          
          total = count || 0;

          // Get paginated players
          const { data, error } = await db.supabaseBuilder('users')
            .select(`
              id, 
              username, 
              rank, 
              profile_pic,
              wins, 
              matches_played,
              xp_points,
              account_status
            `)
            .gt('matches_played', 0)
            .eq('account_status', 'active')
            .order('rank', { ascending: true, nullsFirst: false })
            .order('wins', { ascending: false })
            .order('xp_points', { ascending: false })
            .range(offset, offset + pageSize - 1);

          if (error) {
            console.error('Error fetching players:', error);
            throw error;
          }
          
          players = data || [];

          // For each player, get additional stats
          for (let player of players) {
            try {
              // Calculate win rate
              player.win_rate = player.matches_played > 0 
                ? Math.round((player.wins / player.matches_played) * 100 * 10) / 10
                : 0;

              // Get tournaments won count
              const { count: tournamentsWon } = await db.supabaseBuilder('tournaments')
                .select('*', { count: 'exact', head: true })
                .eq('winner_id', player.id)
                .eq('status', 'completed');

              player.tournaments_won = tournamentsWon || 0;
              
              // Get match wins count
              const { count: matchWins } = await db.supabaseBuilder('matches')
                .select('*', { count: 'exact', head: true })
                .eq('winner_id', player.id)
                .eq('status', 'completed');

              player.match_wins = matchWins || 0;
              
              // Add rank info
              player.rank_info = getRankInfo(player.rank);
              
            } catch (playerStatError) {
              console.error(`Error fetching stats for player ${player.id}:`, playerStatError);
              player.win_rate = player.win_rate || 0;
              player.tournaments_won = 0;
              player.match_wins = 0;
              player.rank_info = getRankInfo(player.rank);
            }
          }

        } else {
          // Game-specific leaderboard
          console.log(`📊 Fetching "${game}" player leaderboard from Supabase...`);
          
          // First, get all completed matches for this specific game
          const { data: matches, error: matchesError } = await db.supabaseBuilder('matches')
            .select(`
              id,
              winner_id,
              player1_id,
              player2_id
            `)
            .eq('game', game)
            .eq('status', 'completed');

          if (matchesError) {
            console.error('Error fetching matches:', matchesError);
            throw matchesError;
          }

          console.log(`Found ${matches?.length || 0} completed matches for "${game}"`);

          if (!matches || matches.length === 0) {
            // No matches for this game
            return res.json({
              success: true,
              players: [],
              pagination: {
                current_page: currentPage,
                total_pages: 1,
                total_items: 0,
                items_per_page: pageSize
              },
              filter: { game, type: 'players' }
            });
          }

          // Get all unique player IDs from these matches
          const playerIds = new Set();
          const winCounts = new Map();
          
          matches.forEach(match => {
            if (match.player1_id) playerIds.add(match.player1_id);
            if (match.player2_id) playerIds.add(match.player2_id);
            if (match.winner_id) {
              winCounts.set(match.winner_id, (winCounts.get(match.winner_id) || 0) + 1);
            }
          });

          console.log(`Found ${playerIds.size} unique players for "${game}"`);

          // Get user details for these players
          const { data: users, error: usersError } = await db.supabaseBuilder('users')
            .select(`
              id,
              username,
              rank,
              profile_pic,
              xp_points,
              account_status
            `)
            .in('id', Array.from(playerIds))
            .eq('account_status', 'active');

          if (usersError) {
            console.error('Error fetching users:', usersError);
            throw usersError;
          }

          // Build player list with game-specific stats
          const gamePlayers = [];
          
          for (let user of users || []) {
            // Get all matches for this player in this game
            const playerMatches = matches.filter(m => 
              m.player1_id === user.id || m.player2_id === user.id
            );
            
            const gamesPlayed = playerMatches.length;
            const gamesWon = winCounts.get(user.id) || 0;
            const winRate = gamesPlayed > 0 
              ? Math.round((gamesWon / gamesPlayed) * 100 * 10) / 10
              : 0;

            // Get tournaments won in this game
            const { count: tournamentsWon, error: tournError } = await db.supabaseBuilder('tournaments')
              .select('*', { count: 'exact', head: true })
              .eq('winner_id', user.id)
              .eq('game', game)
              .eq('status', 'completed');

            if (tournError) {
              console.error(`Error fetching tournaments for user ${user.id}:`, tournError);
            }

            gamePlayers.push({
              id: user.id,
              username: user.username,
              rank: user.rank,
              profile_pic: user.profile_pic,
              xp_points: user.xp_points,
              wins: gamesWon,
              matches_played: gamesPlayed,
              win_rate: winRate,
              tournaments_won: tournamentsWon || 0,
              rank_info: getRankInfo(user.rank)
            });
          }

          console.log(`Processed ${gamePlayers.length} players for "${game}"`);

          // Sort players
          const rankOrder = { 'SSS': 1, 'SS': 2, 'S': 3, 'A': 4, 'B': 5, 'C': 6, 'D': 7, 'E': 8 };
          gamePlayers.sort((a, b) => {
            const rankA = rankOrder[a.rank] || 9;
            const rankB = rankOrder[b.rank] || 9;
            if (rankA !== rankB) return rankA - rankB;
            if (a.tournaments_won !== b.tournaments_won) return b.tournaments_won - a.tournaments_won;
            if (a.wins !== b.wins) return b.wins - a.wins;
            if (a.win_rate !== b.win_rate) return b.win_rate - a.win_rate;
            return b.xp_points - a.xp_points;
          });

          total = gamePlayers.length;
          players = gamePlayers.slice(offset, offset + pageSize);
        }
      } catch (supabaseError) {
        console.error('❌ Supabase error in players leaderboard:', supabaseError);
        players = [];
        total = 0;
      }
    } else {
      // PostgreSQL fallback
      try {
        let query, params;

        if (game === 'all') {
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
            LIMIT $1 OFFSET $2
          `;
          params = [parseInt(limit), offset];
        } else {
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
                  AND t.game = $3
              ), 0) as game_tournaments_won,
              u.xp_points
            FROM users u 
            LEFT JOIN matches m ON (m.player1_id = u.id OR m.player2_id = u.id) 
              AND m.game = $3 
              AND m.status = 'completed'
            WHERE u.account_status = 'active'
            GROUP BY u.id, u.username, u.rank, u.profile_pic, u.xp_points
            HAVING COUNT(DISTINCT CASE WHEN m.player1_id = u.id OR m.player2_id = u.id THEN m.id END) > 0
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
            LIMIT $1 OFFSET $2
          `;
          params = [parseInt(limit), offset, game];
        }

        const result = await db.execute(query, params);
        players = result[0] || [];

        // Get total count for pagination
        let countQuery, countParams;
        if (game === 'all') {
          countQuery = `SELECT COUNT(*) as total FROM users WHERE matches_played > 0 AND account_status = 'active'`;
          countParams = [];
        } else {
          countQuery = `SELECT COUNT(DISTINCT u.id) as total 
                        FROM users u 
                        JOIN matches m ON (m.player1_id = u.id OR m.player2_id = u.id) 
                          AND m.game = $1 
                          AND m.status = 'completed' 
                        WHERE u.account_status = 'active'`;
          countParams = [game];
        }
        
        const countResult = await db.execute(countQuery, countParams);
        total = parseInt(countResult[0]?.[0]?.total || 0);
        
        // Add rank info
        players = players.map(player => ({
          ...player,
          rank_info: getRankInfo(player.rank)
        }));
        
      } catch (pgError) {
        console.error('❌ PostgreSQL error in players leaderboard:', pgError);
        players = [];
        total = 0;
      }
    }

    res.json({
      success: true,
      players: players,
      pagination: {
        current_page: currentPage,
        total_pages: Math.ceil(total / pageSize) || 1,
        total_items: total,
        items_per_page: pageSize
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
      error: 'Failed to fetch players leaderboard: ' + error.message
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

    if (db.isSupabase) {
      try {
        if (type === 'players') {
          if (game === 'all') {
            // Check if user exists and has matches
            const { data: userData, error: userError } = await db.supabaseBuilder('users')
              .select('id, matches_played, account_status')
              .eq('id', userId)
              .maybeSingle();

            if (userError || !userData || userData.matches_played <= 0 || userData.account_status !== 'active') {
              return res.json({
                success: true,
                position: null,
                total: 0,
                percentile: null
              });
            }

            // Get all ranked players
            const { data: allPlayers, error: playersError } = await db.supabaseBuilder('users')
              .select('id, rank, wins, matches_played, xp_points')
              .gt('matches_played', 0)
              .eq('account_status', 'active');

            if (playersError) throw playersError;

            total = allPlayers?.length || 0;

            if (allPlayers && allPlayers.length > 0) {
              // Get tournaments won for each player
              const playersWithStats = [];
              
              for (let player of allPlayers) {
                const { count: tournamentsWon } = await db.supabaseBuilder('tournaments')
                  .select('*', { count: 'exact', head: true })
                  .eq('winner_id', player.id)
                  .eq('status', 'completed');

                const winRate = player.matches_played > 0 
                  ? Math.round((player.wins / player.matches_played) * 100 * 10) / 10
                  : 0;

                playersWithStats.push({
                  id: player.id,
                  rank: player.rank,
                  wins: player.wins,
                  win_rate: winRate,
                  xp_points: player.xp_points,
                  tournaments_won: tournamentsWon || 0
                });
              }

              // Sort players
              const rankOrder = { 'SSS': 1, 'SS': 2, 'S': 3, 'A': 4, 'B': 5, 'C': 6, 'D': 7, 'E': 8 };
              playersWithStats.sort((a, b) => {
                const rankA = rankOrder[a.rank] || 9;
                const rankB = rankOrder[b.rank] || 9;
                if (rankA !== rankB) return rankA - rankB;
                if (a.tournaments_won !== b.tournaments_won) return b.tournaments_won - a.tournaments_won;
                if (a.wins !== b.wins) return b.wins - a.wins;
                if (a.win_rate !== b.win_rate) return b.win_rate - a.win_rate;
                return b.xp_points - a.xp_points;
              });

              const userIndex = playersWithStats.findIndex(p => p.id === userId);
              position = userIndex !== -1 ? userIndex + 1 : null;
            }
          } else {
            // Game-specific position
            console.log(`📊 Calculating position for user ${userId} in game "${game}"`);
            
            // Get all completed matches for this game
            const { data: matches, error: matchesError } = await db.supabaseBuilder('matches')
              .select(`
                id,
                winner_id,
                player1_id,
                player2_id
              `)
              .eq('game', game)
              .eq('status', 'completed');

            if (matchesError) throw matchesError;

            if (!matches || matches.length === 0) {
              return res.json({
                success: true,
                position: null,
                total: 0,
                percentile: null
              });
            }

            // Check if user has played this game
            const userPlayed = matches.some(m => 
              m.player1_id === userId || m.player2_id === userId
            );

            if (!userPlayed) {
              return res.json({
                success: true,
                position: null,
                total: 0,
                percentile: null
              });
            }

            // Get all unique player IDs from these matches
            const playerIds = new Set();
            const winCounts = new Map();
            
            matches.forEach(match => {
              if (match.player1_id) playerIds.add(match.player1_id);
              if (match.player2_id) playerIds.add(match.player2_id);
              if (match.winner_id) {
                winCounts.set(match.winner_id, (winCounts.get(match.winner_id) || 0) + 1);
              }
            });

            // Get user details for all players
            const { data: users, error: usersError } = await db.supabaseBuilder('users')
              .select('id, rank, xp_points')
              .in('id', Array.from(playerIds));

            if (usersError) throw usersError;

            // Build player stats
            const playersWithStats = [];
            
            for (let user of users || []) {
              const playerMatches = matches.filter(m => 
                m.player1_id === user.id || m.player2_id === user.id
              );
              
              const gamesPlayed = playerMatches.length;
              const gamesWon = winCounts.get(user.id) || 0;
              const winRate = gamesPlayed > 0 
                ? Math.round((gamesWon / gamesPlayed) * 100 * 10) / 10
                : 0;

              const { count: tournamentsWon } = await db.supabaseBuilder('tournaments')
                .select('*', { count: 'exact', head: true })
                .eq('winner_id', user.id)
                .eq('game', game)
                .eq('status', 'completed');

              playersWithStats.push({
                id: user.id,
                rank: user.rank,
                wins: gamesWon,
                win_rate: winRate,
                xp_points: user.xp_points,
                tournaments_won: tournamentsWon || 0
              });
            }

            // Sort
            const rankOrder = { 'SSS': 1, 'SS': 2, 'S': 3, 'A': 4, 'B': 5, 'C': 6, 'D': 7, 'E': 8 };
            playersWithStats.sort((a, b) => {
              const rankA = rankOrder[a.rank] || 9;
              const rankB = rankOrder[b.rank] || 9;
              if (rankA !== rankB) return rankA - rankB;
              if (a.tournaments_won !== b.tournaments_won) return b.tournaments_won - a.tournaments_won;
              if (a.wins !== b.wins) return b.wins - a.wins;
              if (a.win_rate !== b.win_rate) return b.win_rate - a.win_rate;
              return b.xp_points - a.xp_points;
            });

            total = playersWithStats.length;
            const userIndex = playersWithStats.findIndex(p => p.id === userId);
            position = userIndex !== -1 ? userIndex + 1 : null;
          }
        }
      } catch (supabaseError) {
        console.error('❌ Supabase error in user-position:', supabaseError);
      }
    } else {
      // PostgreSQL fallback
      try {
        if (type === 'players' && game === 'all') {
          const rankingsResult = await db.execute(`
            WITH ranked_users AS (
              SELECT 
                u.id,
                ROW_NUMBER() OVER (
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
                ) as position
              FROM users u
              WHERE u.matches_played > 0 
                AND u.account_status = 'active'
            )
            SELECT position 
            FROM ranked_users 
            WHERE id = $1
          `, [userId]);

          const rankings = rankingsResult[0] || [];
          position = rankings.length > 0 ? rankings[0].position : null;
          
          const totalResult = await db.execute(`
            SELECT COUNT(*) as total_players 
            FROM users 
            WHERE matches_played > 0 
              AND account_status = 'active'
          `);
          total = parseInt(totalResult[0]?.[0]?.total_players || 0);
        }
      } catch (pgError) {
        console.error('❌ PostgreSQL error in user-position:', pgError);
      }
    }

    const percentile = position && total > 0 ? Math.round((position / total) * 100) : null;

    res.json({
      success: true,
      position: position,
      total: total,
      percentile: percentile
    });

  } catch (error) {
    console.error('❌ Get user position error:', error);
    res.status(200).json({
      success: true,
      position: null,
      total: 0,
      percentile: null
    });
  }
});

// GET /api/leaderboard/recent-winners - Recent tournament winners
router.get('/recent-winners', async (req, res) => {
  try {
    const { limit = 10 } = req.query;

    let winners = [];

    if (db.isSupabase) {
      try {
        const { data, error } = await db.supabaseBuilder('tournaments')
          .select(`
            id,
            name,
            game,
            type,
            prize_pool,
            completed_at,
            winner_id,
            users!tournaments_winner_id_fkey (
              id,
              username,
              rank,
              profile_pic
            )
          `)
          .eq('status', 'completed')
          .not('winner_id', 'is', null)
          .not('completed_at', 'is', null)
          .order('completed_at', { ascending: false })
          .limit(parseInt(limit));

        if (error) throw error;

        winners = (data || []).map(tournament => ({
          tournament_id: tournament.id,
          tournament_name: tournament.name,
          game: tournament.game,
          tournament_type: tournament.type,
          prize_pool: tournament.prize_pool,
          completed_at: tournament.completed_at,
          winner_id: tournament.users?.id,
          winner_name: tournament.users?.username,
          winner_rank: tournament.users?.rank,
          winner_avatar: tournament.users?.profile_pic
        }));

        // Get participant counts
        for (let winner of winners) {
          const { count } = await db.supabaseBuilder('tournament_participants')
            .select('*', { count: 'exact', head: true })
            .eq('tournament_id', winner.tournament_id)
            .eq('status', 'joined');
          
          winner.participants_count = count || 0;
        }

      } catch (supabaseError) {
        console.error('❌ Supabase error in recent-winners:', supabaseError);
      }
    } else {
      // PostgreSQL fallback
      try {
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
          LIMIT $1
        `;

        const result = await db.execute(query, [parseInt(limit)]);
        winners = result[0] || [];
      } catch (pgError) {
        console.error('❌ PostgreSQL error in recent-winners:', pgError);
      }
    }

    const formattedWinners = winners.map(winner => ({
      ...winner,
      tournament_type_display: getTournamentTypeDisplayName(winner.tournament_type),
      completed_at_formatted: formatDate(winner.completed_at),
      prize_pool_formatted: formatPrizePool(winner.prize_pool)
    }));

    res.json({
      success: true,
      winners: formattedWinners
    });

  } catch (error) {
    console.error('❌ Get recent winners error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch recent winners: ' + error.message
    });
  }
});

// GET /api/leaderboard/live-tournaments - Live tournaments with streams
router.get('/live-tournaments', async (req, res) => {
  try {
    let tournaments = [];

    if (db.isSupabase) {
      try {
        const { data, error } = await db.supabaseBuilder('tournaments')
          .select(`
            id,
            name,
            game,
            type,
            max_players,
            prize_pool,
            live_stream_url,
            start_date,
            creator_id,
            users!tournaments_creator_id_fkey (
              username,
              profile_pic
            )
          `)
          .eq('status', 'ongoing')
          .not('live_stream_url', 'is', null)
          .neq('live_stream_url', '')
          .order('start_date', { ascending: false })
          .limit(20);

        if (error) throw error;

        tournaments = data || [];

        for (let tournament of tournaments) {
          const { count } = await db.supabaseBuilder('tournament_participants')
            .select('*', { count: 'exact', head: true })
            .eq('tournament_id', tournament.id)
            .eq('status', 'joined');
          
          tournament.current_players = count || 0;
        }

      } catch (supabaseError) {
        console.error('❌ Supabase error in live-tournaments:', supabaseError);
      }
    } else {
      // PostgreSQL fallback
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

        const result = await db.execute(query);
        tournaments = result[0] || [];
      } catch (pgError) {
        console.error('❌ PostgreSQL error in live-tournaments:', pgError);
      }
    }

    const liveTournaments = tournaments.map(tournament => {
      const streamUrl = tournament.live_stream_url || '';
      let platform = 'Unknown';
      
      if (streamUrl.includes('twitch.tv')) platform = 'Twitch';
      else if (streamUrl.includes('youtube.com') || streamUrl.includes('youtu.be')) platform = 'YouTube';
      else if (streamUrl.includes('facebook.com')) platform = 'Facebook';
      else if (streamUrl.includes('kick.com')) platform = 'Kick';
      
      return {
        ...tournament,
        platform: platform,
        creator_name: tournament.users?.username || tournament.creator_name || 'Unknown',
        creator_avatar: tournament.users?.profile_pic || tournament.creator_avatar || null,
        tournament_type_display: getTournamentTypeDisplayName(tournament.type),
        prize_pool_formatted: formatPrizePool(tournament.prize_pool),
        start_date_formatted: formatDateTime(tournament.start_date)
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
      error: 'Failed to fetch live tournaments: ' + error.message
    });
  }
});

// GET /api/leaderboard/survival-champions - Survival tournament title winners
router.get('/survival-champions', async (req, res) => {
  try {
    let champions = [];

    if (db.isSupabase) {
      try {
        console.log('🏆 Fetching survival champions from Supabase...');
        
        const { data, error } = await db.supabaseBuilder('tournaments')
          .select(`
            id,
            name,
            completed_at,
            title_boundless_winner,
            title_chaos_winner,
            title_order_winner,
            title_requirements_boundless,
            title_requirements_chaos,
            title_requirements_order,
            boundless_winner:users!tournaments_title_boundless_winner_fkey (
              id,
              username,
              rank,
              profile_pic
            ),
            chaos_winner:users!tournaments_title_chaos_winner_fkey (
              id,
              username,
              rank,
              profile_pic
            ),
            order_winner:users!tournaments_title_order_winner_fkey (
              id,
              username,
              rank,
              profile_pic
            )
          `)
          .eq('type', 'survival')
          .eq('status', 'completed')
          .or('title_boundless_winner.not.is.null,title_chaos_winner.not.is.null,title_order_winner.not.is.null')
          .order('completed_at', { ascending: false })
          .limit(1);

        if (error) throw error;
        champions = data || [];

      } catch (supabaseError) {
        console.error('❌ Supabase error in survival-champions:', supabaseError);
      }
    } else {
      // PostgreSQL fallback
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

        const result = await db.execute(query);
        champions = result[0] || [];
      } catch (pgError) {
        console.error('❌ PostgreSQL error in survival-champions:', pgError);
      }
    }

    if (champions.length === 0) {
      return res.json({
        success: true,
        champions: null,
        message: 'No survival champions found'
      });
    }

    const championData = champions[0];
    const resultObj = {
      tournament_name: championData.name || championData.tournament_name,
      completed_at: championData.completed_at,
      completed_at_formatted: formatDate(championData.completed_at),
      champions: {}
    };

    if (championData.title_boundless_winner) {
      const winner = championData.boundless_winner || {
        id: championData.boundless_winner_id,
        username: championData.boundless_winner_name,
        rank: championData.boundless_winner_rank,
        profile_pic: championData.boundless_winner_avatar
      };
      
      resultObj.champions.boundless = {
        id: winner?.id,
        username: winner?.username || 'Unknown',
        rank: winner?.rank || 'E',
        avatar: winner?.profile_pic || null,
        requirement: championData.title_requirements_boundless || 'Boundless Explorer',
        icon: 'fas fa-infinity',
        color: '#ba68c8'
      };
    }

    if (championData.title_chaos_winner) {
      const winner = championData.chaos_winner || {
        id: championData.chaos_winner_id,
        username: championData.chaos_winner_name,
        rank: championData.chaos_winner_rank,
        profile_pic: championData.chaos_winner_avatar
      };
      
      resultObj.champions.chaos = {
        id: winner?.id,
        username: winner?.username || 'Unknown',
        rank: winner?.rank || 'E',
        avatar: winner?.profile_pic || null,
        requirement: championData.title_requirements_chaos || 'Master of Chaos',
        icon: 'fas fa-fire',
        color: '#ff4444'
      };
    }

    if (championData.title_order_winner) {
      const winner = championData.order_winner || {
        id: championData.order_winner_id,
        username: championData.order_winner_name,
        rank: championData.order_winner_rank,
        profile_pic: championData.order_winner_avatar
      };
      
      resultObj.champions.order = {
        id: winner?.id,
        username: winner?.username || 'Unknown',
        rank: winner?.rank || 'E',
        avatar: winner?.profile_pic || null,
        requirement: championData.title_requirements_order || 'Grand Master of Order',
        icon: 'fas fa-shield-alt',
        color: '#4fc3f7'
      };
    }

    res.json({
      success: true,
      champions: resultObj
    });

  } catch (error) {
    console.error('❌ Get survival champions error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch survival champions: ' + error.message
    });
  }
});

// GET /api/leaderboard/squads - Squad/group leaderboard
router.get('/squads', async (req, res) => {
  try {
    const { game = 'all', page = 1, limit = 50 } = req.query;
    const offset = (page - 1) * limit;
    const pageSize = parseInt(limit);
    const currentPage = parseInt(page);

    let squads = [];
    let total = 0;

    if (db.isSupabase) {
      try {
        // Get total count
        let countQuery = db.supabaseBuilder('groups').select('*', { count: 'exact', head: true });
        
        if (game !== 'all') {
          countQuery = countQuery.eq('game_specialty', game);
        }
        
        const { count } = await countQuery;
        total = count || 0;

        // Get paginated groups
        let query = db.supabaseBuilder('groups')
          .select(`
            id,
            name,
            game_specialty,
            description,
            creator_id,
            created_at
          `);

        if (game !== 'all') {
          query = query.eq('game_specialty', game);
        }

        const { data: groupsData } = await query
          .range(offset, offset + pageSize - 1);

        squads = groupsData || [];

        for (let squad of squads) {
          // Get creator info
          const { data: creator } = await db.supabaseBuilder('users')
            .select('username, profile_pic')
            .eq('id', squad.creator_id)
            .maybeSingle();

          squad.creator_name = creator?.username || 'Unknown';
          squad.creator_avatar = creator?.profile_pic || null;
          squad.squad_name = squad.name;

          // Get member stats
          const { data: members } = await db.supabaseBuilder('group_members')
            .select('role')
            .eq('group_id', squad.id)
            .eq('status', 'joined');

          squad.member_count = members?.length || 0;
          squad.admin_count = members?.filter(m => m.role === 'admin').length || 0;

          // Get tournament wins
          let tournamentQuery = db.supabaseBuilder('tournaments')
            .select('id, prize_pool, completed_at')
            .eq('winner_id', squad.creator_id)
            .eq('type', 'squad')
            .eq('status', 'completed');

          if (game !== 'all') {
            tournamentQuery = tournamentQuery.eq('game', game);
          }

          const { data: tournaments } = await tournamentQuery;

          squad.tournaments_won = tournaments?.length || 0;
          squad.total_prize_won = tournaments?.reduce((sum, t) => sum + (t.prize_pool || 0), 0) || 0;
          squad.latest_victory = tournaments?.length > 0 
            ? tournaments.sort((a, b) => new Date(b.completed_at) - new Date(a.completed_at))[0]?.completed_at
            : null;
        }

        // Sort
        squads.sort((a, b) => {
          if (a.tournaments_won !== b.tournaments_won) return b.tournaments_won - a.tournaments_won;
          if (a.total_prize_won !== b.total_prize_won) return b.total_prize_won - a.total_prize_won;
          if (a.member_count !== b.member_count) return b.member_count - a.member_count;
          if (a.latest_victory && b.latest_victory) {
            return new Date(b.latest_victory) - new Date(a.latest_victory);
          }
          return a.latest_victory ? -1 : 1;
        });

      } catch (supabaseError) {
        console.error('❌ Supabase error in squads leaderboard:', supabaseError);
      }
    } else {
      // PostgreSQL fallback
      try {
        let query, params;

        if (game === 'all') {
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
            ORDER BY 
              tournaments_won DESC,
              total_prize_won DESC,
              member_count DESC,
              latest_victory DESC
            LIMIT $1 OFFSET $2
          `;
          params = [parseInt(limit), offset];
        } else {
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
                AND t.game = $3
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
            WHERE g.game_specialty = $3
            ORDER BY 
              tournaments_won DESC,
              total_prize_won DESC,
              member_count DESC,
              latest_victory DESC
            LIMIT $1 OFFSET $2
          `;
          params = [parseInt(limit), offset, game];
        }

        const result = await db.execute(query, params);
        squads = result[0] || [];

        // Get total count
        let countQuery, countParams;
        if (game === 'all') {
          countQuery = `SELECT COUNT(*) as total FROM groups`;
          countParams = [];
        } else {
          countQuery = `SELECT COUNT(*) as total FROM groups WHERE game_specialty = $1`;
          countParams = [game];
        }
        
        const countResult = await db.execute(countQuery, countParams);
        total = parseInt(countResult[0]?.[0]?.total || 0);
      } catch (pgError) {
        console.error('❌ PostgreSQL error in squads leaderboard:', pgError);
      }
    }

    res.json({
      success: true,
      squads: squads,
      pagination: {
        current_page: currentPage,
        total_pages: Math.ceil(total / pageSize) || 1,
        total_items: total,
        items_per_page: pageSize
      },
      filter: {
        game: game,
        type: 'squads'
      }
    });

  } catch (error) {
    console.error('❌ Get squads leaderboard error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch squads leaderboard: ' + error.message
    });
  }
});

module.exports = router;
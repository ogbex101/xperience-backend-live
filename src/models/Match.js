const db = require('../config/database.js');

class Match {
  // Create a new 1v1 match
  static async createMatch(matchData) {
    const {
      player1_id,
      player2_id,
      game,
      stake_amount,
      prize_pool_option,
      custom_prize_pool,
      scheduled_at
    } = matchData;

    // Use the transaction wrapper from database.js
    const { executeTransaction } = require('../config/database.js');
    
    try {
      // Calculate prize pool
      let prize_pool_amount = 0;
      if (prize_pool_option === 'entry_fee') {
        prize_pool_amount = stake_amount * 0.85; // 15% platform fee
      } else {
        prize_pool_amount = custom_prize_pool * 0.85;
      }

      // Validate custom prize pool
      if (prize_pool_option === 'custom' && custom_prize_pool < stake_amount) {
        throw new Error('Custom prize pool cannot be less than stake amount');
      }

      // Prepare all operations for the transaction
      const operations = [
        // Check player1 balance
        {
          sql: 'SELECT balance FROM users WHERE id = $1',
          params: [player1_id]
        },
        // Check player2 balance
        {
          sql: 'SELECT balance FROM users WHERE id = $1',
          params: [player2_id]
        },
        // Deduct from player1
        {
          sql: 'UPDATE users SET balance = balance - $1 WHERE id = $2',
          params: [stake_amount, player1_id]
        },
        // Deduct from player2
        {
          sql: 'UPDATE users SET balance = balance - $1 WHERE id = $2',
          params: [stake_amount, player2_id]
        },
        // Create match record
        {
          sql: `
            INSERT INTO matches (
              player1_id, player2_id, game, stake_amount, prize_pool_option,
              custom_prize_pool, prize_pool_amount, scheduled_at, status
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')
            RETURNING id
          `,
          params: [
            player1_id, player2_id, game, stake_amount, prize_pool_option,
            custom_prize_pool, prize_pool_amount, scheduled_at
          ]
        }
      ];

      // Execute transaction
      const results = await executeTransaction(operations);
      
      // Get the match ID from the last operation result
      const matchId = results[4][0]?.id || results[4]?.rows?.[0]?.id;
      
      // Create transaction records (separate queries)
      const { query } = require('../config/database.js');
      const reference = `MATCH-STAKE-${Date.now()}-${matchId}`;
      
      // Player1 transaction
      await query(`
        INSERT INTO transactions (user_id, amount, type, status, reference, description)
        VALUES ($1, $2, 'match_stake', 'completed', $3, $4)
      `, [player1_id, -stake_amount, reference, `Stake deduction for 1vs1 match #${matchId}`]);

      // Player2 transaction
      await query(`
        INSERT INTO transactions (user_id, amount, type, status, reference, description)
        VALUES ($1, $2, 'match_stake', 'completed', $3, $4)
      `, [player2_id, -stake_amount, reference, `Stake deduction for 1vs1 match #${matchId}`]);

      // Track platform revenue
      const platformFee = prize_pool_option === 'entry_fee' ? 
        stake_amount * 0.15 : custom_prize_pool * 0.15;
      
      await query(`
        INSERT INTO revenue (amount, revenue_date, notes)
        VALUES ($1, NOW(), $2)
      `, [platformFee, `15% platform fee from 1vs1_match`]);

      return matchId;

    } catch (error) {
      throw error;
    }
  }

  // Submit match result
  static async submitResult(matchId, userId, winnerId) {
    const { withTransaction } = require('../config/database.js');
    
    return await withTransaction(async (client) => {
      // Get match details
      const result = await client.query(`
        SELECT * FROM matches WHERE id = $1
      `, [matchId]);

      if (result.rows.length === 0) {
        throw new Error('Match not found');
      }

      const match = result.rows[0];

      // Verify user is part of the match
      if (match.player1_id !== userId && match.player2_id !== userId) {
        throw new Error('Not authorized to submit result for this match');
      }

      // Verify winner is part of the match
      if (match.player1_id !== winnerId && match.player2_id !== winnerId) {
        throw new Error('Winner must be one of the match participants');
      }

      // Check if result already submitted by this user
      const existingResult = await client.query(`
        SELECT * FROM match_results 
        WHERE match_id = $1 AND user_id = $2
      `, [matchId, userId]);

      if (existingResult.rows.length > 0) {
        throw new Error('Result already submitted');
      }

      // Submit result
      await client.query(`
        INSERT INTO match_results (match_id, user_id, winner_id)
        VALUES ($1, $2, $3)
      `, [matchId, userId, winnerId]);

      // Check if both players submitted results
      const results = await client.query(`
        SELECT * FROM match_results WHERE match_id = $1
      `, [matchId]);

      // If both players submitted and agree on winner
      if (results.rows.length === 2) {
        const winner1 = results.rows[0].winner_id;
        const winner2 = results.rows[1].winner_id;

        if (winner1 === winner2) {
          // Players agree on winner - complete match
          await this.completeMatch(matchId, winner1, client);
        } else {
          // Dispute - set match to disputed status
          await client.query(`
            UPDATE matches SET status = 'disputed' WHERE id = $1
          `, [matchId]);
        }
      }

      return { message: 'Result submitted successfully' };
    });
  }

  // Complete match and distribute winnings
  static async completeMatch(matchId, winnerId, client) {
    // Get match details
    const result = await client.query(`
      SELECT * FROM matches WHERE id = $1
    `, [matchId]);

    const match = result.rows[0];

    // Determine loser
    const loserId = match.player1_id === winnerId ? match.player2_id : match.player1_id;

    // Distribute winnings to winner
    const winnings = match.prize_pool_amount + match.stake_amount;

    await client.query(
      'UPDATE users SET balance = balance + $1 WHERE id = $2',
      [winnings, winnerId]
    );

    // Update match status
    await client.query(`
      UPDATE matches 
      SET status = 'completed', winner_id = $1, completed_at = NOW()
      WHERE id = $2
    `, [winnerId, matchId]);

    // Create transaction for winnings
    await client.query(`
      INSERT INTO transactions (user_id, amount, type, status, reference, description)
      VALUES ($1, $2, 'winning', 'completed', $3, $4)
    `, [
      winnerId,
      winnings,
      `MATCH-WIN-${Date.now()}-${matchId}`,
      `Match winnings from 1vs1 match #${matchId} (including returned stake)`
    ]);

    // Update player stats
    await client.query(`
      UPDATE users 
      SET wins = wins + 1, matches_played = matches_played + 1
      WHERE id = $1
    `, [winnerId]);

    await client.query(`
      UPDATE users 
      SET losses = losses + 1, matches_played = matches_played + 1
      WHERE id = $1
    `, [loserId]);

    // Update win rates
    await client.query(`
      UPDATE users 
      SET win_rate = ROUND((wins * 100.0) / matches_played, 2)
      WHERE id IN ($1, $2)
    `, [winnerId, loserId]);
  }

  // Get user's match history
  static async getUserMatches(userId) {
    const { query } = require('../config/database.js');
    const result = await query(`
      SELECT 
        m.*,
        p1.username as player1_username,
        p1.rank as player1_rank,
        p1.profile_pic as player1_avatar,
        p2.username as player2_username,
        p2.rank as player2_rank,
        p2.profile_pic as player2_avatar,
        w.username as winner_username
      FROM matches m
      LEFT JOIN users p1 ON m.player1_id = p1.id
      LEFT JOIN users p2 ON m.player2_id = p2.id
      LEFT JOIN users w ON m.winner_id = w.id
      WHERE m.player1_id = $1 OR m.player2_id = $1
      ORDER BY m.created_at DESC
    `, [userId]);

    return result[0] || [];
  }

  // Get match details
  static async getMatch(matchId) {
    const { query } = require('../config/database.js');
    const result = await query(`
      SELECT 
        m.*,
        p1.username as player1_username,
        p1.rank as player1_rank,
        p1.profile_pic as player1_avatar,
        p2.username as player2_username,
        p2.rank as player2_rank,
        p2.profile_pic as player2_avatar,
        w.username as winner_username
      FROM matches m
      LEFT JOIN users p1 ON m.player1_id = p1.id
      LEFT JOIN users p2 ON m.player2_id = p2.id
      LEFT JOIN users w ON m.winner_id = w.id
      WHERE m.id = $1
    `, [matchId]);

    return result[0]?.[0] || null;
  }

  // Get open challenges for a game
  static async getOpenChallenges(game) {
    const { query } = require('../config/database.js');
    const result = await query(`
      SELECT 
        m.*,
        p1.username as player1_username,
        p1.rank as player1_rank
      FROM matches m
      LEFT JOIN users p1 ON m.player1_id = p1.id
      WHERE m.game = $1 AND m.status = 'pending'
      ORDER BY m.created_at DESC
    `, [game]);

    return result[0] || [];
  }
}

module.exports = Match;
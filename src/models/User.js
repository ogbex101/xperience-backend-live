const { query } = require('../config/database.js');
const bcrypt = require('bcrypt');

class User {
  // Create new user - PostgreSQL version
  static async create(userData) {
    const {
      username,
      email,
      password,
      firstname = null,
      lastname = null
    } = userData;

    // Hash password
    const saltRounds = 12;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Generate wallet account number
    const walletAccountNumber = `XP${Date.now().toString().slice(-8)}`;

    // PostgreSQL uses RETURNING clause to get inserted data
    const result = await query(
      `INSERT INTO users 
       (username, email, firstname, lastname, password, wallet_account_number, currency) 
       VALUES ($1, $2, $3, $4, $5, $6, 'NGN')
       RETURNING id`,
      [username, email, firstname, lastname, hashedPassword, walletAccountNumber]
    );

    // PostgreSQL result structure: result[0] = rows, result[1] = fields
    const rows = result[0];
    return rows[0]?.id; // Access the returned ID
  }

  // Find user by email - PostgreSQL version
  static async findByEmail(email) {
    const result = await query(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );
    const rows = result[0];
    return rows[0] || null;
  }

  // Find user by username - PostgreSQL version
  static async findByUsername(username) {
    const result = await query(
      'SELECT * FROM users WHERE username = $1',
      [username]
    );
    const rows = result[0];
    return rows[0] || null;
  }

  // Find user by ID - PostgreSQL version
  static async findById(id) {
    const result = await query(
      `SELECT id, username, email, firstname, lastname, profile_pic, rank,
              matches_played, wins, losses, win_rate, balance, wallet_account_number,
              currency, created_at, is_banned
       FROM users WHERE id = $1`,
      [id]
    );
    const rows = result[0];
    return rows[0] || null;
  }

  // Verify password (unchanged - no SQL)
  static async verifyPassword(plainPassword, hashedPassword) {
    return await bcrypt.compare(plainPassword, hashedPassword);
  }

  // Update user profile - PostgreSQL version
  static async updateProfile(userId, updateData) {
    const allowedFields = ['firstname', 'lastname', 'profile_pic'];
    const fieldsToUpdate = {};
    
    Object.keys(updateData).forEach(key => {
      if (allowedFields.includes(key) && updateData[key] !== undefined) {
        fieldsToUpdate[key] = updateData[key];
      }
    });

    if (Object.keys(fieldsToUpdate).length === 0) {
      return null;
    }

    // Build dynamic SET clause with PostgreSQL parameter binding
    const setClause = Object.keys(fieldsToUpdate)
      .map((key, index) => `${key} = $${index + 1}`)
      .join(', ');
    
    const values = [...Object.values(fieldsToUpdate), userId];

    // Use CURRENT_TIMESTAMP (same in PostgreSQL)
    await query(
      `UPDATE users SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE id = $${values.length}`,
      values
    );

    return this.findById(userId);
  }

  // Update user stats after match - PostgreSQL version
  static async updateStats(userId, isWinner) {
    if (isWinner) {
      await query(
        `UPDATE users 
         SET wins = wins + 1, 
             matches_played = matches_played + 1,
             win_rate = ROUND((wins + 1) * 100.0 / (matches_played + 1), 2)
         WHERE id = $1`,
        [userId]
      );
    } else {
      await query(
        `UPDATE users 
         SET losses = losses + 1, 
             matches_played = matches_played + 1,
             win_rate = ROUND(wins * 100.0 / (matches_played + 1), 2)
         WHERE id = $1`,
        [userId]
      );
    }

    // Check for rank promotion
    await this.checkRankPromotion(userId);
  }

  // Check and update user rank - PostgreSQL version
  static async checkRankPromotion(userId) {
    const user = await this.findById(userId);
    if (!user) return;

    const result = await query(
      'SELECT * FROM rank_requirements ORDER BY min_wins DESC'
    );
    const rankRequirements = result[0];

    for (const requirement of rankRequirements) {
      if (user.wins >= requirement.min_wins && 
          user.matches_played >= requirement.min_matches &&
          user.win_rate >= requirement.win_rate) {
        
        if (user.rank !== requirement.rank) {
          await query(
            'UPDATE users SET rank = $1 WHERE id = $2',
            [requirement.rank, userId]
          );
          
          // Here you would typically send a notification
          console.log(`User ${user.username} promoted to ${requirement.rank} rank`);
        }
        break;
      }
    }
  }

  // Set transaction PIN - PostgreSQL version
  static async setTransactionPin(userId, pin) {
    const hashedPin = await bcrypt.hash(pin, 10);
    await query(
      'UPDATE users SET transaction_pin = $1, pin_set_at = CURRENT_TIMESTAMP WHERE id = $2',
      [hashedPin, userId]
    );
  }

  // Verify transaction PIN - PostgreSQL version
  static async verifyTransactionPin(userId, pin) {
    const result = await query(
      'SELECT transaction_pin FROM users WHERE id = $1',
      [userId]
    );
    const rows = result[0];
    
    if (!rows[0] || !rows[0].transaction_pin) {
      return false;
    }

    return await bcrypt.compare(pin, rows[0].transaction_pin);
  }
}

module.exports = { User };
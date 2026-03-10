const db = require('../config/database');

class NotificationService {
  /**
   * Create a notification
   */
  static async createNotification({
    userId,
    senderId = null,
    message,
    type = 'system',
    matchId = null,
    tournamentId = null,
    groupId = null,
    transactionId = null,
    friendRequestId = null
  }) {
    try {
      console.log(`📨 Creating ${type} notification for user ${userId}: ${message}`);
      
      const notificationData = {
        user_id: userId,
        sender_id: senderId,
        message: message,
        type: type,
        status: 'unread',
        match_id: matchId,
        tournament_id: tournamentId,
        group_id: groupId,
        transaction_id: transactionId,
        friend_request_id: friendRequestId,
        created_at: new Date().toISOString()
      };
      
      let notification;
      
      if (db.isSupabase) {
        const { data, error } = await db.supabaseBuilder('notifications')
          .insert([notificationData])
          .select();
        
        if (error) throw error;
        notification = data[0];
      } else {
        // Fallback to PostgreSQL
        const keys = Object.keys(notificationData);
        const values = Object.values(notificationData);
        const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
        
        const result = await db.pool.query(
          `INSERT INTO notifications (${keys.join(', ')}) 
           VALUES (${placeholders})
           RETURNING id`,
          values
        );
        
        notification = result.rows[0];
      }
      
      return {
        success: true,
        id: notification.id,
        notification: notification,
        message: 'Notification created'
      };
    } catch (error) {
      console.error('❌ Notification creation failed:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Create match-related notifications
   */
  static async createMatchNotification(userId, senderId, matchId, action, data = {}) {
    try {
      console.log(`🎮 Match notification: ${action} for match ${matchId}`);
      
      let match = null;
      
      if (db.isSupabase) {
        const { data: matchData, error } = await db.supabaseBuilder('matches')
          .select(`
            *,
            player1:player1_id (id, username, profile_pic),
            player2:player2_id (id, username, profile_pic)
          `)
          .eq('id', matchId)
          .single();
        
        if (error) throw error;
        match = matchData;
      } else {
        // Fallback to PostgreSQL
        const result = await db.pool.query(
          `SELECT m.*, 
                  p1.username as player1_username,
                  p2.username as player2_username
           FROM matches m
           LEFT JOIN users p1 ON m.player1_id = p1.id
           LEFT JOIN users p2 ON m.player2_id = p2.id
           WHERE m.id = $1`,
          [matchId]
        );
        match = result.rows[0];
      }
      
      let message = '';
      let recipientId = userId;
      let finalSenderId = senderId;
      
      // Enhanced messages with match details
      if (match) {
        switch(action) {
          case 'created':
            message = `${data.senderName || 'Someone'} created a ${match.game} match challenge (₦${match.stake_amount})`;
            break;
          case 'joined':
            message = `${data.senderName || 'Someone'} joined your ${match.game} match!`;
            recipientId = match.player1_id;
            break;
          case 'completed':
            const winnerName = data.winnerName || 'Unknown';
            message = `🏆 ${winnerName} won your ${match.game} match! Prize: ₦${match.prize_pool_amount}`;
            finalSenderId = null;
            break;
          case 'result_submitted':
            message = `${data.senderName || 'Opponent'} submitted results for your ${match.game} match. Please confirm.`;
            recipientId = senderId === match.player1_id ? match.player2_id : match.player1_id;
            break;
          case 'invitation':
            const player1Name = match.player1?.username || match.player1_username || 'Someone';
            message = `${player1Name} challenged you to a ${match.game} match! Stake: ₦${match.stake_amount}`;
            break;
          case 'cancelled':
            message = `${data.senderName || 'Someone'} cancelled the ${match.game} match`;
            break;
          case 'disputed':
            message = `${data.senderName || 'Someone'} disputed the ${match.game} match results`;
            break;
          default:
            message = `${senderId ? '[Action] ' : ''}${action} on match`;
        }
      } else {
        const messages = {
          created: '🎮 created a new match challenge',
          joined: '👥 joined your match',
          completed: '🏆 completed a match',
          result_submitted: '📝 submitted match results',
          invitation: '⚔️ challenged you to a match',
          cancelled: '❌ cancelled a match',
          disputed: '⚠️ disputed match results'
        };
        
        message = `${senderId ? '[Sender] ' : ''}${messages[action] || action}`;
      }
      
      if (!recipientId) {
        console.error(`❌ No valid recipient for match notification: match=${matchId}, action=${action}`);
        return { success: false, error: 'No recipient specified' };
      }
      
      return await this.createNotification({
        userId: recipientId,
        senderId: finalSenderId,
        message,
        type: 'match',
        matchId
      });
      
    } catch (error) {
      console.error(`❌ Error in createMatchNotification:`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Notify both match players
   */
  static async notifyBothMatchPlayers(matchId, message, data = {}) {
    try {
      let match;
      
      if (db.isSupabase) {
        const { data: matchData, error } = await db.supabaseBuilder('matches')
          .select('player1_id, player2_id')
          .eq('id', matchId)
          .single();
        
        if (error) throw error;
        match = matchData;
      } else {
        const result = await db.pool.query(
          'SELECT player1_id, player2_id FROM matches WHERE id = $1',
          [matchId]
        );
        match = result.rows[0];
      }
      
      if (!match) {
        return { success: false, error: 'Match not found' };
      }
      
      const players = [match.player1_id, match.player2_id].filter(id => id);
      
      const results = [];
      for (const playerId of players) {
        const result = await this.createNotification({
          userId: playerId,
          message: message,
          type: 'match',
          matchId: matchId
        });
        results.push(result);
      }
      
      return { success: true, results };
      
    } catch (error) {
      console.error('Error notifying both players:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Create tournament notifications
   */
  static async createTournamentNotification(userId, senderId, tournamentId, action, data = {}) {
    const messages = {
      created: '🏟️ created a new tournament',
      joined: '🎯 joined your tournament',
      started: '🚀 tournament has started',
      completed: '🏅 tournament completed',
      winner: '👑 won the tournament',
      invitation: '📨 invited you to join a tournament'
    };
    
    let message = `${senderId ? '[Sender] ' : ''}${messages[action]}`;
    if (data.prize) {
      message += ` and won ₦${data.prize}`;
    }
    
    return this.createNotification({
      userId,
      senderId,
      message,
      type: 'tournament',
      tournamentId
    });
  }

  /**
   * Create friend notifications
   */
  static async createFriendNotification(userId, senderId, action) {
    const messages = {
      request_sent: '🤝 sent you a friend request',
      request_accepted: '✅ accepted your friend request',
      request_declined: '❌ declined your friend request'
    };
    
    return this.createNotification({
      userId,
      senderId,
      message: `${senderId ? '[Sender] ' : ''}${messages[action]}`,
      type: 'friend',
      friendRequestId: senderId
    });
  }

  /**
   * Create chat notifications
   */
  static async createChatNotification(userId, senderId, action, data = {}) {
    const messages = {
      message_received: `💬 sent you a message: "${data.message?.substring(0, 50)}..."`,
      group_message: `👥 sent a message in ${data.groupName || 'group'}`,
      mention: `👋 mentioned you in ${data.context || 'chat'}`
    };
    
    return this.createNotification({
      userId,
      senderId,
      message: `${senderId ? '[Sender] ' : ''}${messages[action]}`,
      type: 'chat',
      groupId: data.groupId || null
    });
  }

  /**
   * Create wallet/transaction notifications
   */
  static async createTransactionNotification(userId, transactionId, action, amount, currency = 'NGN') {
    const messages = {
      deposit: `💰 Deposit successful: ${currency} ${amount}`,
      withdrawal: `💳 Withdrawal requested: ${currency} ${amount}`,
      transfer_received: `🔄 Received transfer: ${currency} ${amount}`,
      transfer_sent: `🔄 Transfer sent: ${currency} ${amount}`,
      conversion_xp: `✨ Converted to XP: ${currency} ${amount}`
    };
    
    return this.createNotification({
      userId,
      message: messages[action],
      type: 'transaction',
      transactionId
    });
  }

  /**
   * Create group notifications
   */
  static async createGroupNotification(userId, senderId, groupId, action, data = {}) {
    const messages = {
      joined: '👤 joined the group',
      left: '👋 left the group',
      invited: '📨 invited you to join a group',
      promoted: '⭐ promoted to admin',
      demoted: '📉 demoted from admin',
      removed: '🚫 removed from group'
    };
    
    return this.createNotification({
      userId,
      senderId,
      message: `${senderId ? '[Sender] ' : ''}${messages[action]} ${data.groupName ? `"${data.groupName}"` : ''}`,
      type: 'group',
      groupId
    });
  }

  /**
   * Create system notifications
   */
  static async createSystemNotification(userId, message, data = {}) {
    return this.createNotification({
      userId,
      message: `⚙️ ${message}`,
      type: 'system',
      ...data
    });
  }

  /**
   * Get user notifications with pagination
   */
  static async getUserNotifications(userId, filters = {}) {
    try {
      let notifications = [];
      let total = 0;
      
      if (db.isSupabase) {
        console.log('📊 Fetching notifications for user:', userId);
        
        // STEP 1: Get notifications without join first
        let query = db.supabaseBuilder('notifications')
          .select('*', { count: 'exact' })
          .eq('user_id', userId)
          .order('created_at', { ascending: false });
        
        // Apply filters
        if (filters.type) {
          query = query.eq('type', filters.type);
        }
        
        if (filters.status) {
          query = query.eq('status', filters.status);
        }
        
        // Apply pagination
        if (filters.limit) {
          query = query.limit(parseInt(filters.limit));
        }
        
        if (filters.offset) {
          query = query.range(
            parseInt(filters.offset), 
            parseInt(filters.offset) + parseInt(filters.limit) - 1
          );
        }
        
        const { data, error, count } = await query;
        
        if (error) {
          console.error('Error fetching notifications:', error);
          throw error;
        }
        
        console.log(`📊 Found ${data?.length || 0} notifications`);
        
        // STEP 2: If we have notifications with sender_id, fetch sender details separately
        if (data && data.length > 0) {
          // Get all unique sender_ids that are not null
          const senderIds = [...new Set(data
            .map(n => n.sender_id)
            .filter(id => id !== null))];
          
          console.log('📊 Fetching sender details for IDs:', senderIds);
          
          // Fetch sender details if there are any
          let senderMap = {};
          if (senderIds.length > 0) {
            const { data: senders, error: senderError } = await db.supabaseBuilder('users')
              .select('id, username, profile_pic, rank')
              .in('id', senderIds);
            
            if (senderError) {
              console.error('Error fetching senders:', senderError);
            } else if (senders) {
              // Create a map of sender info for easy lookup
              senderMap = senders.reduce((acc, sender) => {
                acc[sender.id] = sender;
                return acc;
              }, {});
              console.log('📊 Sender map created:', Object.keys(senderMap).length, 'senders');
            }
          }
          
          // Combine notifications with sender info
          notifications = data.map(notification => ({
            ...notification,
            sender_username: notification.sender_id ? senderMap[notification.sender_id]?.username : null,
            sender_profile_pic: notification.sender_id ? senderMap[notification.sender_id]?.profile_pic : null,
            sender_rank: notification.sender_id ? senderMap[notification.sender_id]?.rank : null
          }));
        } else {
          notifications = data || [];
        }
        
        total = count || 0;
        
      } else {
        // Fallback to PostgreSQL
        console.log('📊 Using PostgreSQL fallback');
        let query = `
          SELECT n.*, 
                 u.username as sender_username,
                 u.profile_pic as sender_profile_pic,
                 u.rank as sender_rank
          FROM notifications n
          LEFT JOIN users u ON n.sender_id = u.id
          WHERE n.user_id = $1
        `;
        
        const params = [userId];
        let paramCount = 2;
        
        if (filters.type) {
          query += ` AND n.type = $${paramCount}`;
          params.push(filters.type);
          paramCount++;
        }
        
        if (filters.status) {
          query += ` AND n.status = $${paramCount}`;
          params.push(filters.status);
          paramCount++;
        }
        
        query += ' ORDER BY n.created_at DESC';
        
        if (filters.limit) {
          query += ` LIMIT $${paramCount}`;
          params.push(parseInt(filters.limit));
          paramCount++;
        }
        
        if (filters.offset) {
          query += ` OFFSET $${paramCount}`;
          params.push(parseInt(filters.offset));
        }
        
        const result = await db.pool.query(query, params);
        notifications = result.rows;
        
        // Get total count
        let countQuery = 'SELECT COUNT(*) as total FROM notifications WHERE user_id = $1';
        const countParams = [userId];
        
        if (filters.type) {
          countQuery += ` AND type = $2`;
          countParams.push(filters.type);
        }
        
        const countResult = await db.pool.query(countQuery, countParams);
        total = parseInt(countResult.rows[0].total);
      }
      
      return {
        success: true,
        notifications,
        total: total
      };
    } catch (error) {
      console.error('Get user notifications error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Mark notification as read
   */
  static async markAsRead(notificationId, userId) {
    try {
      let success = false;
      let notification = null;
      
      if (db.isSupabase) {
        const { data, error } = await db.supabaseBuilder('notifications')
          .update({ 
            status: 'read', 
            read_at: new Date().toISOString() 
          })
          .eq('id', notificationId)
          .eq('user_id', userId)
          .select();
        
        if (error) throw error;
        success = data && data.length > 0;
        notification = data[0];
      } else {
        const result = await db.pool.query(
          "UPDATE notifications SET status = 'read', read_at = NOW() WHERE id = $1 AND user_id = $2 RETURNING *",
          [notificationId, userId]
        );
        success = result.rows.length > 0;
        notification = result.rows[0];
      }
      
      return {
        success,
        notification: notification || null
      };
    } catch (error) {
      console.error('Mark as read error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Mark all notifications as read
   */
  static async markAllAsRead(userId) {
    try {
      let count = 0;
      
      if (db.isSupabase) {
        const { data, error } = await db.supabaseBuilder('notifications')
          .update({ 
            status: 'read', 
            read_at: new Date().toISOString() 
          })
          .eq('user_id', userId)
          .eq('status', 'unread')
          .select();
        
        if (error) throw error;
        count = data ? data.length : 0;
      } else {
        const result = await db.pool.query(
          "UPDATE notifications SET status = 'read', read_at = NOW() WHERE user_id = $1 AND status = 'unread'",
          [userId]
        );
        count = result.rowCount || 0;
      }
      
      return {
        success: true,
        count
      };
    } catch (error) {
      console.error('Mark all as read error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get unread counts
   */
  static async getUnreadCounts(userId) {
    try {
      let counts = {
        total: 0,
        matches: 0,
        tournaments: 0,
        friends: 0,
        chats: 0,
        transactions: 0,
        groups: 0,
        system: 0
      };
      
      if (db.isSupabase) {
        console.log('📊 Fetching unread counts for user:', userId);
        
        // Get all unread notifications
        const { data, error } = await db.supabaseBuilder('notifications')
          .select('type')
          .eq('user_id', userId)
          .eq('status', 'unread');
        
        if (error) {
          console.error('Error fetching unread counts:', error);
          throw error;
        }
        
        console.log(`📊 Found ${data?.length || 0} unread notifications`);
        
        // Calculate counts
        if (data && data.length > 0) {
          counts.total = data.length;
          
          // Count by type
          data.forEach(notification => {
            switch(notification.type) {
              case 'match':
                counts.matches++;
                break;
              case 'tournament':
                counts.tournaments++;
                break;
              case 'friend':
                counts.friends++;
                break;
              case 'chat':
                counts.chats++;
                break;
              case 'transaction':
                counts.transactions++;
                break;
              case 'group':
                counts.groups++;
                break;
              case 'system':
                counts.system++;
                break;
            }
          });
        }
        
      } else {
        // Fallback to PostgreSQL
        console.log('📊 Using PostgreSQL for unread counts');
        const result = await db.pool.query(`
          SELECT 
            COUNT(*) as total,
            SUM(CASE WHEN type = 'match' THEN 1 ELSE 0 END) as matches,
            SUM(CASE WHEN type = 'tournament' THEN 1 ELSE 0 END) as tournaments,
            SUM(CASE WHEN type = 'friend' THEN 1 ELSE 0 END) as friends,
            SUM(CASE WHEN type = 'chat' THEN 1 ELSE 0 END) as chats,
            SUM(CASE WHEN type = 'transaction' THEN 1 ELSE 0 END) as transactions,
            SUM(CASE WHEN type = 'group' THEN 1 ELSE 0 END) as groups,
            SUM(CASE WHEN type = 'system' THEN 1 ELSE 0 END) as system
          FROM notifications 
          WHERE user_id = $1 AND status = 'unread'
        `, [userId]);
        
        counts = result.rows[0] || counts;
      }
      
      return {
        success: true,
        counts: {
          total: parseInt(counts.total) || 0,
          matches: parseInt(counts.matches) || 0,
          tournaments: parseInt(counts.tournaments) || 0,
          friends: parseInt(counts.friends) || 0,
          chats: parseInt(counts.chats) || 0,
          transactions: parseInt(counts.transactions) || 0,
          groups: parseInt(counts.groups) || 0,
          system: parseInt(counts.system) || 0
        }
      };
    } catch (error) {
      console.error('Get unread counts error:', error);
      return { success: false, error: error.message };
    }
  }
}

module.exports = NotificationService;
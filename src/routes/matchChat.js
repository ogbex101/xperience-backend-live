// backend/src/routes/matchChat.js
const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const db = require('../config/database');

const router = express.Router();

// GET match chat messages
router.get('/:matchId/chat', authenticateToken, async (req, res) => {
  try {
    const { matchId } = req.params;
    const userId = req.user.id;

    // Check if user has access to this match
    const matchAccessResult = await db.execute(
      `SELECT id FROM matches 
       WHERE id = $1 AND (
         player1_id = $2 OR player2_id = $2 
         OR opponent_type = 'open'
         OR (opponent_type = 'specific' AND opponent_username = (
           SELECT username FROM users WHERE id = $2
         ))
       )`,
      [matchId, userId]
    );

    if (matchAccessResult[0].length === 0) {
      return res.status(403).json({
        success: false,
        error: 'Access denied to this match chat'
      });
    }

    // Get chat messages with user info
    const messagesResult = await db.execute(
      `SELECT 
         mcm.id,
         mcm.match_id,
         mcm.user_id,
         mcm.message,
         mcm.is_admin,
         mcm.is_system,
         mcm.created_at,
         u.username,
         u.profile_pic,
         u.rank,
         CASE 
           WHEN u.id = $1 THEN 1 
           ELSE 0 
         END as is_current_user
       FROM match_chat_messages mcm
       JOIN users u ON mcm.user_id = u.id
       WHERE mcm.match_id = $2
       ORDER BY mcm.created_at ASC`,
      [userId, matchId]
    );

    res.json({
      success: true,
      messages: messagesResult[0]
    });
  } catch (error) {
    console.error('Get match chat error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch chat messages'
    });
  }
});

// POST send message to match chat
router.post('/:matchId/chat', authenticateToken, async (req, res) => {
  try {
    const { matchId } = req.params;
    const userId = req.user.id;
    const { message } = req.body;

    if (!message || message.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Message cannot be empty'
      });
    }

    // Check if user has access to this match
    const matchAccessResult = await db.execute(
      `SELECT id, player1_id, player2_id, status FROM matches 
       WHERE id = $1 AND (
         player1_id = $2 OR player2_id = $2 
         OR opponent_type = 'open'
         OR (opponent_type = 'specific' AND opponent_username = (
           SELECT username FROM users WHERE id = $2
         ))
       )`,
      [matchId, userId]
    );

    if (matchAccessResult[0].length === 0) {
      return res.status(403).json({
        success: false,
        error: 'Cannot send message to this match'
      });
    }

    const match = matchAccessResult[0][0];

    // Check if match is active (can't chat in completed/cancelled matches)
    if (match.status === 'completed' || match.status === 'cancelled') {
      return res.status(400).json({
        success: false,
        error: 'Cannot send messages to completed or cancelled matches'
      });
    }

    // Insert message
    const result = await db.execute(
      `INSERT INTO match_chat_messages (match_id, user_id, message) 
       VALUES ($1, $2, $3)
       RETURNING id`,
      [matchId, userId, message.trim()]
    );

    const messageId = result[0][0].id;

    // Get the created message with user info
    const messagesResult = await db.execute(
      `SELECT 
         mcm.id,
         mcm.match_id,
         mcm.user_id,
         mcm.message,
         mcm.is_admin,
         mcm.is_system,
         mcm.created_at,
         u.username,
         u.profile_pic,
         u.rank,
         1 as is_current_user
       FROM match_chat_messages mcm
       JOIN users u ON mcm.user_id = u.id
       WHERE mcm.id = $1`,
      [messageId]
    );

    res.json({
      success: true,
      message: 'Message sent successfully',
      chatMessage: messagesResult[0][0]
    });
  } catch (error) {
    console.error('Send match chat error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to send message'
    });
  }
});

// POST send system message (for admin/system events)
router.post('/:matchId/chat/system', authenticateToken, async (req, res) => {
  try {
    const { matchId } = req.params;
    const userId = req.user.id;
    const { message } = req.body;

    // Check if user is admin
    const userResult = await db.execute(
      'SELECT is_admin FROM users WHERE id = $1',
      [userId]
    );

    if (!userResult[0][0] || !userResult[0][0].is_admin) {
      return res.status(403).json({
        success: false,
        error: 'Admin access required'
      });
    }

    // Insert system message
    await db.execute(
      `INSERT INTO match_chat_messages (match_id, user_id, message, is_system) 
       VALUES ($1, $2, $3, TRUE)`,
      [matchId, userId, message]
    );

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
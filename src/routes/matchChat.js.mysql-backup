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
    const [matchAccess] = await db.execute(
      `SELECT id FROM matches 
       WHERE id = ? AND (
         player1_id = ? OR player2_id = ? 
         OR opponent_type = 'open'
         OR (opponent_type = 'specific' AND opponent_username = (
           SELECT username FROM users WHERE id = ?
         ))
       )`,
      [matchId, userId, userId, userId]
    );

    if (matchAccess.length === 0) {
      return res.status(403).json({
        success: false,
        error: 'Access denied to this match chat'
      });
    }

    // Get chat messages with user info
    const [messages] = await db.execute(
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
           WHEN u.id = ? THEN 1 
           ELSE 0 
         END as is_current_user
       FROM match_chat_messages mcm
       JOIN users u ON mcm.user_id = u.id
       WHERE mcm.match_id = ?
       ORDER BY mcm.created_at ASC`,
      [userId, matchId]
    );

    res.json({
      success: true,
      messages: messages
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
    const [matchAccess] = await db.execute(
      `SELECT id, player1_id, player2_id, status FROM matches 
       WHERE id = ? AND (
         player1_id = ? OR player2_id = ? 
         OR opponent_type = 'open'
         OR (opponent_type = 'specific' AND opponent_username = (
           SELECT username FROM users WHERE id = ?
         ))
       )`,
      [matchId, userId, userId, userId]
    );

    if (matchAccess.length === 0) {
      return res.status(403).json({
        success: false,
        error: 'Cannot send message to this match'
      });
    }

    const match = matchAccess[0];

    // Check if match is active (can't chat in completed/cancelled matches)
    if (match.status === 'completed' || match.status === 'cancelled') {
      return res.status(400).json({
        success: false,
        error: 'Cannot send messages to completed or cancelled matches'
      });
    }

    // Insert message
    const [result] = await db.execute(
      `INSERT INTO match_chat_messages (match_id, user_id, message) 
       VALUES (?, ?, ?)`,
      [matchId, userId, message.trim()]
    );

    // Get the created message with user info
    const [messages] = await db.execute(
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
       WHERE mcm.id = ?`,
      [result.insertId]
    );

    res.json({
      success: true,
      message: 'Message sent successfully',
      chatMessage: messages[0]
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
    const [user] = await db.execute(
      'SELECT is_admin FROM users WHERE id = ?',
      [userId]
    );

    if (!user[0] || !user[0].is_admin) {
      return res.status(403).json({
        success: false,
        error: 'Admin access required'
      });
    }

    // Insert system message
    const [result] = await db.execute(
      `INSERT INTO match_chat_messages (match_id, user_id, message, is_system) 
       VALUES (?, ?, ?, TRUE)`,
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
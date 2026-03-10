const express = require('express');
const db = require('../config/database');
const { authenticateToken } = require('../middleware/auth.js');
const NotificationService = require('../services/notificationService.js');

const router = express.Router();

// ==================== DEBUG ENDPOINTS ====================
router.get('/debug/all', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    
    const result = await NotificationService.getUserNotifications(userId, { limit: 50 });
    
    res.json({
      success: result.success,
      data: result.notifications || [],
      count: result.total || 0
    });
  } catch (error) {
    console.error('Debug notifications error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message,
      message: 'Debug endpoint failed'
    });
  }
});

// ==================== MAIN ENDPOINTS ====================

// Get all notifications
router.get('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { type, status, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;
    
    const filters = { limit, offset };
    if (type) filters.type = type;
    if (status) filters.status = status;
    
    const result = await NotificationService.getUserNotifications(userId, filters);
    
    if (!result.success) {
      return res.status(500).json({ error: result.error });
    }
    
    // Get unread counts
    const countsResult = await NotificationService.getUnreadCounts(userId);
    
    res.json({
      success: true,
      data: {
        notifications: result.notifications,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: result.total,
          totalPages: Math.ceil(result.total / limit)
        },
        unreadCounts: countsResult.success ? countsResult.counts : {
          total: 0, matches: 0, tournaments: 0, friends: 0,
          chats: 0, transactions: 0, groups: 0, system: 0
        }
      }
    });
  } catch (error) {
    console.error('Get notifications error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to fetch notifications' 
    });
  }
});

// Get notification counts
router.get('/counts', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    
    const result = await NotificationService.getUnreadCounts(userId);
    
    if (result.success) {
      res.json({
        success: true,
        data: result.counts
      });
    } else {
      res.status(500).json({ error: result.error });
    }
  } catch (error) {
    console.error('Get notification counts error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to fetch notification counts' 
    });
  }
});

// Mark notification as read
router.put('/:id/read', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    
    const result = await NotificationService.markAsRead(id, userId);
    
    if (result.success) {
      res.json({
        success: true,
        message: 'Notification marked as read'
      });
    } else {
      res.status(result.notification ? 404 : 500).json({
        success: false,
        error: result.notification ? 'Notification not found' : result.error
      });
    }
  } catch (error) {
    console.error('Mark notification as read error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to mark notification as read' 
    });
  }
});

// Mark all notifications as read
router.put('/mark-all-read', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    
    const result = await NotificationService.markAllAsRead(userId);
    
    res.json({
      success: true,
      message: 'All notifications marked as read',
      affected: result.count || 0
    });
  } catch (error) {
    console.error('Mark all as read error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to mark all notifications as read' 
    });
  }
});

// Create a test notification
router.post('/test', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { message, type } = req.body;
    
    const result = await NotificationService.createNotification({
      userId,
      message: message || '🎯 Test notification created successfully!',
      type: type || 'system'
    });
    
    if (result.success) {
      res.json({
        success: true,
        message: 'Test notification created',
        data: result.notification || result
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error
      });
    }
  } catch (error) {
    console.error('Test notification error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to create test notification' 
    });
  }
});

// Accept invitation
router.post('/:id/accept', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    
    // Get notification using Supabase
    let notification;
    if (db.isSupabase) {
      const { data, error } = await db.supabaseBuilder('notifications')
        .select('*')
        .eq('id', id)
        .eq('user_id', userId)
        .single();
      
      if (error || !data) {
        return res.status(404).json({ 
          success: false, 
          error: 'Notification not found' 
        });
      }
      notification = data;
    } else {
      // Fallback to PostgreSQL
      const result = await db.pool.query(
        'SELECT * FROM notifications WHERE id = $1 AND user_id = $2',
        [id, userId]
      );
      
      if (result.rows.length === 0) {
        return res.status(404).json({ 
          success: false, 
          error: 'Notification not found' 
        });
      }
      notification = result.rows[0];
    }
    
    // Mark as accepted
    await NotificationService.markAsRead(id, userId);
    
    let redirectUrl = null;
    
    // Handle different notification types
    if (notification.match_id) {
      redirectUrl = `/matches/${notification.match_id}`;
    } else if (notification.tournament_id) {
      redirectUrl = `/tournaments/${notification.tournament_id}`;
    } else if (notification.group_id) {
      redirectUrl = `/groups/${notification.group_id}`;
    }
    
    res.json({
      success: true,
      message: 'Invitation accepted',
      redirectUrl,
      notification
    });
  } catch (error) {
    console.error('Accept invitation error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to accept invitation' 
    });
  }
});

// Reject invitation
router.post('/:id/reject', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    
    // Mark as read
    await NotificationService.markAsRead(id, userId);
    
    res.json({
      success: true,
      message: 'Invitation rejected'
    });
  } catch (error) {
    console.error('Reject invitation error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to reject invitation' 
    });
  }
});

// Delete notification
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    
    let deleted = false;
    
    if (db.isSupabase) {
      const { data, error } = await db.supabaseBuilder('notifications')
        .delete()
        .eq('id', id)
        .eq('user_id', userId)
        .select();
      
      if (error) throw error;
      deleted = data && data.length > 0;
    } else {
      // Fallback to PostgreSQL
      const result = await db.pool.query(
        'DELETE FROM notifications WHERE id = $1 AND user_id = $2 RETURNING id',
        [id, userId]
      );
      deleted = result.rows.length > 0;
    }
    
    if (!deleted) {
      return res.status(404).json({ 
        success: false, 
        error: 'Notification not found' 
      });
    }
    
    res.json({
      success: true,
      message: 'Notification deleted'
    });
  } catch (error) {
    console.error('Delete notification error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to delete notification' 
    });
  }
});

// Clear all notifications
router.delete('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    
    let deletedCount = 0;
    
    if (db.isSupabase) {
      const { data, error } = await db.supabaseBuilder('notifications')
        .delete()
        .eq('user_id', userId)
        .select();
      
      if (error) throw error;
      deletedCount = data ? data.length : 0;
    } else {
      // Fallback to PostgreSQL
      const result = await db.pool.query(
        'DELETE FROM notifications WHERE user_id = $1',
        [userId]
      );
      deletedCount = result.rowCount || 0;
    }
    
    res.json({
      success: true,
      message: 'All notifications cleared',
      deletedCount
    });
  } catch (error) {
    console.error('Clear all notifications error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to clear notifications' 
    });
  }
});

module.exports = router;
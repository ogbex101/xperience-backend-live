const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

// Apply authentication to all chat routes
router.use(authenticateToken);

// Use admin client to bypass RLS - define once
const getClient = () => db.supabaseAdmin || db.supabase;

// Get chat history with a user
router.get('/history/:userId', async (req, res) => {
  try {
    const userId = req.user.id;
    const otherUserId = req.params.userId;
    const client = getClient();
    
    console.log(`📜 Chat History Request: User ${userId} requesting history with ${otherUserId}`);
    
    if (!userId || !otherUserId) {
      return res.status(400).json({ 
        success: false, 
        message: 'User IDs are required' 
      });
    }
    
    // Verify friendship
    const { data: friendship, error: friendError } = await client
      .from('friends')
      .select('*')
      .or(`and(user_id.eq.${userId},friend_id.eq.${otherUserId}),and(user_id.eq.${otherUserId},friend_id.eq.${userId})`)
      .eq('status', 'accepted')
      .maybeSingle();
    
    if (friendError) {
      console.error('Error checking friendship:', friendError);
    }
    
    if (!friendship) {
      return res.status(403).json({ 
        success: false, 
        message: 'You can only chat with friends' 
      });
    }
    
    // Get messages
    const { data: messages, error: messagesError } = await client
      .from('chat_messages')
      .select(`
        *,
        sender:user_id (
          username,
          profile_pic
        )
      `)
      .or(`and(user_id.eq.${userId},room_id.eq.${otherUserId}),and(user_id.eq.${otherUserId},room_id.eq.${userId})`)
      .order('created_at', { ascending: true })
      .limit(100);
    
    if (messagesError) {
      console.error('Error fetching messages:', messagesError);
      
      if (messagesError.message && messagesError.message.includes('relation "chat_messages" does not exist')) {
        return res.json({ 
          success: true, 
          messages: [],
          count: 0,
          message: 'No messages yet'
        });
      }
      
      throw messagesError;
    }
    
    // Format messages
    const formattedMessages = (messages || []).map(msg => ({
      id: msg.id,
      user_id: msg.user_id,
      room_id: msg.room_id,
      message: msg.message,
      media_type: msg.media_type,
      media_url: msg.media_url,
      reply_to: msg.reply_to,
      original_message: msg.original_message,
      original_sender: msg.original_sender,
      is_forwarded: msg.is_forwarded,
      reactions: msg.reactions,
      read_by: msg.read_by,
      delivered_to: msg.delivered_to,
      deleted_for: msg.deleted_for,
      cleared_for_users: msg.cleared_for_users,
      deleted_by_sender: msg.deleted_by_sender,
      deleted_for_everyone: msg.deleted_for_everyone,
      is_read: msg.is_read || false,
      client_id: msg.client_id,
      created_at: msg.created_at,
      updated_at: msg.updated_at,
      sender_id: msg.user_id,
      sender_username: msg.sender?.username,
      sender_profile_pic: msg.sender?.profile_pic,
      read_status: msg.is_read || false
    }));
    
    // Mark messages as read
    if (formattedMessages.length > 0) {
      const { error: updateError } = await client
        .from('chat_messages')
        .update({ is_read: true })
        .eq('room_id', otherUserId)
        .eq('user_id', otherUserId)
        .eq('is_read', false);
      
      if (updateError) {
        console.error('Error marking messages as read:', updateError);
      }
    }
    
    res.json({ 
      success: true, 
      messages: formattedMessages,
      count: formattedMessages.length
    });
    
  } catch (error) {
    console.error('❌ Error fetching chat history:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error fetching chat history',
      error: error.message
    });
  }
});

// Send message
router.post('/send', async (req, res) => {
  try {
    const { receiverId, groupId, message } = req.body;
    const senderId = req.user.id;
    const client = getClient();
    
    console.log('📤 Send message request:', { senderId, receiverId, groupId, message: message?.substring(0, 50) });
    
    if (!message || message.trim() === '') {
      return res.status(400).json({ 
        success: false, 
        message: 'Message cannot be empty' 
      });
    }
    
    const trimmedMessage = message.trim();
    
    if (receiverId) {
      const { data: friendship, error: friendError } = await client
        .from('friends')
        .select('*')
        .or(`and(user_id.eq.${senderId},friend_id.eq.${receiverId}),and(user_id.eq.${receiverId},friend_id.eq.${senderId})`)
        .eq('status', 'accepted')
        .maybeSingle();
      
      if (friendError) {
        console.error('Error checking friendship:', friendError);
      }
      
      if (!friendship) {
        return res.status(403).json({ 
          success: false, 
          message: 'You can only chat with friends' 
        });
      }
    }
    
    if (groupId) {
      const { data: membership, error: memberError } = await client
        .from('group_members')
        .select('id')
        .eq('group_id', groupId)
        .eq('user_id', senderId)
        .eq('status', 'joined')
        .maybeSingle();
      
      if (memberError) {
        console.error('Error checking group membership:', memberError);
      }
      
      if (!membership) {
        return res.status(403).json({ 
          success: false, 
          message: 'You are not a member of this group' 
        });
      }
    }
    
    const { data: sender, error: senderError } = await client
      .from('users')
      .select('username, profile_pic')
      .eq('id', senderId)
      .maybeSingle();
    
    if (senderError) {
      console.error('Error getting sender info:', senderError);
    }
    
    const roomId = groupId || receiverId;
    
    const messageData = {
      user_id: senderId,
      room_id: roomId,
      message: trimmedMessage,
      is_read: false,
      created_at: new Date().toISOString(),
      read_by: [],
      delivered_to: [],
      deleted_for: [],
      cleared_for_users: []
    };
    
    const { data: savedMessage, error: saveError } = await client
      .from('chat_messages')
      .insert([messageData])
      .select()
      .single();
    
    if (saveError) {
      console.error('Error saving message:', saveError);
      throw saveError;
    }
    
    const messageWithSender = {
      ...savedMessage,
      sender_username: sender?.username,
      sender_profile_pic: sender?.profile_pic,
      sender_id: senderId
    };
    
    console.log('✅ Message saved with ID:', savedMessage.id);
    
    res.json({ 
      success: true, 
      message: messageWithSender,
      messageId: savedMessage.id
    });
    
  } catch (error) {
    console.error('❌ Error sending message:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error sending message',
      error: error.message
    });
  }
});

// Get recent conversations
router.get('/conversations', async (req, res) => {
  try {
    const userId = req.user.id;
    const client = getClient();
    
    console.log(`📋 Fetching conversations for user ${userId}`);
    
    // Get all friends first
    const { data: friendships, error: friendsError } = await client
      .from('friends')
      .select('*')
      .or(`user_id.eq.${userId},friend_id.eq.${userId}`)
      .eq('status', 'accepted');
    
    if (friendsError) {
      console.error('Error fetching friends:', friendsError);
    }
    
    const friendIds = new Set();
    for (const f of friendships || []) {
      if (f.user_id === userId) {
        friendIds.add(f.friend_id);
      } else {
        friendIds.add(f.user_id);
      }
    }
    
    // Get all messages
    const { data: messages, error: messagesError } = await client
      .from('chat_messages')
      .select(`
        *,
        sender:user_id (
          id,
          username,
          profile_pic,
          rank
        )
      `)
      .or(`user_id.eq.${userId},room_id.eq.${userId}`)
      .order('created_at', { ascending: false });
    
    if (messagesError) {
      console.error('Error fetching messages:', messagesError);
      
      if (messagesError.message && messagesError.message.includes('relation "chat_messages" does not exist')) {
        return res.json({ 
          success: true, 
          conversations: []
        });
      }
      
      throw messagesError;
    }
    
    const conversationMap = new Map();
    
    // Add all friends as potential conversations
    for (const friendId of friendIds) {
      const { data: friendData, error: friendError } = await client
        .from('users')
        .select('id, username, profile_pic, rank')
        .eq('id', friendId)
        .single();
      
      if (!friendError && friendData) {
        conversationMap.set(friendId, {
          other_user_id: friendId,
          other_user_username: friendData.username || 'Unknown',
          profile_pic: friendData.profile_pic || null,
          rank: friendData.rank || 'E',
          last_message: null,
          last_message_time: null,
          unread_count: 0
        });
      }
    }
    
    // Update with message data
    for (const msg of messages || []) {
      let otherUserId = null;
      if (msg.user_id === userId) {
        otherUserId = msg.room_id;
      } else {
        otherUserId = msg.user_id;
      }
      
      if (!otherUserId || otherUserId === userId) continue;
      
      if (!conversationMap.has(otherUserId) || 
          (msg.created_at && (!conversationMap.get(otherUserId).last_message_time || 
           new Date(msg.created_at) > new Date(conversationMap.get(otherUserId).last_message_time)))) {
        
        const { count, error: countError } = await client
          .from('chat_messages')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', otherUserId)
          .eq('room_id', userId)
          .eq('is_read', false);
        
        let userInfo = conversationMap.get(otherUserId) || {};
        
        if (!userInfo.other_user_username) {
          const { data: userData } = await client
            .from('users')
            .select('username, profile_pic, rank')
            .eq('id', otherUserId)
            .single();
          
          if (userData) {
            userInfo = {
              ...userInfo,
              other_user_username: userData.username,
              profile_pic: userData.profile_pic,
              rank: userData.rank || 'E'
            };
          }
        }
        
        conversationMap.set(otherUserId, {
          ...userInfo,
          other_user_id: otherUserId,
          last_message: msg.message,
          last_message_time: msg.created_at,
          unread_count: count || 0
        });
      }
    }
    
    const conversations = Array.from(conversationMap.values())
      .sort((a, b) => {
        if (!a.last_message_time) return 1;
        if (!b.last_message_time) return -1;
        return new Date(b.last_message_time) - new Date(a.last_message_time);
      });
    
    console.log(`📋 Found ${conversations.length} conversations`);
    res.json({ success: true, conversations });
    
  } catch (error) {
    console.error('❌ Error fetching conversations:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error fetching conversations',
      error: error.message,
      conversations: []
    });
  }
});

// Get group conversations
router.get('/group-conversations', async (req, res) => {
  try {
    const userId = req.user.id;
    const client = getClient();
    
    console.log(`👥 Fetching group conversations for user ${userId}`);
    
    // Get user's groups
    const { data: memberships, error: memberError } = await client
      .from('group_members')
      .select(`
        group_id,
        groups:group_id (
          id,
          name,
          game_specialty,
          description,
          created_at,
          current_members,
          max_members
        )
      `)
      .eq('user_id', userId)
      .eq('status', 'joined');
    
    if (memberError) {
      console.error('Error fetching group memberships:', memberError);
      
      if (memberError.message && memberError.message.includes('relation "group_members" does not exist')) {
        return res.json({ 
          success: true, 
          groups: []
        });
      }
      
      throw memberError;
    }
    
    const groupsWithDetails = await Promise.all((memberships || []).map(async (membership) => {
      const group = membership.groups || membership;
      
      if (!group || !group.id) {
        console.error('Invalid group data:', membership);
        return null;
      }
      
      const { data: lastMessages, error: lastError } = await client
        .from('chat_messages')
        .select('message, created_at')
        .eq('room_id', group.id)
        .order('created_at', { ascending: false })
        .limit(1);
      
      const { count, error: countError } = await client
        .from('chat_messages')
        .select('*', { count: 'exact', head: true })
        .eq('room_id', group.id)
        .eq('is_read', false)
        .neq('user_id', userId);
      
      return {
        group_id: group.id,
        group_name: group.name || 'Unnamed Group',
        game_specialty: group.game_specialty || 'General',
        description: group.description || '',
        created_at: group.created_at,
        current_members: group.current_members || 0,
        max_members: group.max_members || 20,
        last_message: lastMessages && lastMessages[0]?.message,
        last_message_time: lastMessages && lastMessages[0]?.created_at,
        unread_count: count || 0
      };
    }));
    
    const validGroups = groupsWithDetails.filter(g => g !== null);
    validGroups.sort((a, b) => {
      if (!a.last_message_time) return 1;
      if (!b.last_message_time) return -1;
      return new Date(b.last_message_time) - new Date(a.last_message_time);
    });
    
    console.log(`👥 Found ${validGroups.length} groups`);
    res.json({ success: true, groups: validGroups });
    
  } catch (error) {
    console.error('❌ Error fetching group conversations:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error fetching group conversations',
      error: error.message,
      groups: []
    });
  }
});

// Mark messages as read
router.post('/mark-read', async (req, res) => {
  try {
    const { senderId, groupId } = req.body;
    const userId = req.user.id;
    const client = getClient();
    
    console.log(`📖 Marking messages as read for user ${userId}:`, { senderId, groupId });
    
    if (senderId) {
      const { error } = await client
        .from('chat_messages')
        .update({ is_read: true })
        .eq('user_id', senderId)
        .eq('room_id', userId)
        .eq('is_read', false);
      
      if (error) {
        console.error('Error marking messages as read:', error);
      }
    } else if (groupId) {
      const { error } = await client
        .from('chat_messages')
        .update({ is_read: true })
        .eq('room_id', groupId)
        .neq('user_id', userId)
        .eq('is_read', false);
      
      if (error) {
        console.error('Error marking messages as read:', error);
      }
    }
    
    res.json({ 
      success: true, 
      message: 'Messages marked as read' 
    });
    
  } catch (error) {
    console.error('❌ Error marking messages as read:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error marking messages as read',
      error: error.message
    });
  }
});

// Get group chat history
router.get('/group/:groupId/history', async (req, res) => {
  try {
    const userId = req.user.id;
    const groupId = req.params.groupId;
    const client = getClient();
    
    console.log(`📜 Fetching group chat history: Group ${groupId} for user ${userId}`);
    
    // Verify group membership
    const { data: membership, error: memberError } = await client
      .from('group_members')
      .select('id')
      .eq('group_id', groupId)
      .eq('user_id', userId)
      .eq('status', 'joined')
      .maybeSingle();
    
    if (memberError) {
      console.error('Error checking group membership:', memberError);
    }
    
    if (!membership) {
      return res.status(403).json({ 
        success: false, 
        message: 'You are not a member of this group' 
      });
    }
    
    // Get group messages
    const { data: messages, error: messagesError } = await client
      .from('chat_messages')
      .select(`
        *,
        sender:user_id (
          username,
          profile_pic
        )
      `)
      .eq('room_id', groupId)
      .order('created_at', { ascending: true })
      .limit(200);
    
    if (messagesError) {
      console.error('Error fetching group messages:', messagesError);
      throw messagesError;
    }
    
    // Format messages
    const formattedMessages = (messages || []).map(msg => ({
      id: msg.id,
      user_id: msg.user_id,
      room_id: msg.room_id,
      message: msg.message,
      media_type: msg.media_type,
      media_url: msg.media_url,
      reply_to: msg.reply_to,
      original_message: msg.original_message,
      original_sender: msg.original_sender,
      is_forwarded: msg.is_forwarded,
      reactions: msg.reactions,
      read_by: msg.read_by,
      delivered_to: msg.delivered_to,
      deleted_for: msg.deleted_for,
      cleared_for_users: msg.cleared_for_users,
      deleted_by_sender: msg.deleted_by_sender,
      deleted_for_everyone: msg.deleted_for_everyone,
      is_read: msg.is_read || false,
      client_id: msg.client_id,
      created_at: msg.created_at,
      updated_at: msg.updated_at,
      sender_id: msg.user_id,
      sender_username: msg.sender?.username,
      sender_profile_pic: msg.sender?.profile_pic,
      read_status: msg.is_read || false
    }));
    
    // Mark messages as read
    const { error: updateError } = await client
      .from('chat_messages')
      .update({ is_read: true })
      .eq('room_id', groupId)
      .neq('user_id', userId)
      .eq('is_read', false);
    
    if (updateError) {
      console.error('Error marking group messages as read:', updateError);
    }
    
    console.log(`📨 Found ${formattedMessages.length} group messages`);
    res.json({ success: true, messages: formattedMessages });
    
  } catch (error) {
    console.error('❌ Error fetching group chat history:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error fetching group chat history',
      error: error.message
    });
  }
});

module.exports = router;
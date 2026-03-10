// friends.js - COMPLETE FIXED VERSION
const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

// ADD AUTHENTICATION MIDDLEWARE TO ALL ROUTES
router.use(authenticateToken);

// Get friends list and pending requests
router.get('/', async (req, res) => {
  try {
    const userId = req.user.id;
    const token = req.headers.authorization?.split(' ')[1];
    
    console.log('📋 Fetching friends for user ID:', userId);
    
    // Use admin client to bypass RLS issues
    const client = db.supabaseAdmin || db.supabase;
    
    // Get all accepted friendships where user is involved
    const { data: friendships, error: friendsError } = await client
      .from('friends')
      .select('*')
      .or(`user_id.eq.${userId},friend_id.eq.${userId}`)
      .eq('status', 'accepted');
    
    if (friendsError) {
      console.error('Error fetching friendships:', friendsError);
      throw friendsError;
    }
    
    console.log(`Found ${friendships?.length || 0} accepted friendships`);
    
    // Collect all friend IDs
    const friendIds = [];
    for (const f of friendships || []) {
      const friendId = f.user_id === userId ? f.friend_id : f.user_id;
      friendIds.push(friendId);
    }
    
    // Get friend details
    const friends = [];
    
    if (friendIds.length > 0) {
      const { data: friendUsers, error: usersError } = await client
        .from('users')
        .select('id, username, profile_pic, rank, wins, losses, matches_played, win_rate, balance, account_status')
        .in('id', friendIds);
      
      if (usersError) {
        console.error('Error fetching friend users:', usersError);
      } else {
        const friendMap = {};
        for (const user of friendUsers || []) {
          friendMap[user.id] = user;
        }
        
        for (const friendship of friendships || []) {
          const friendId = friendship.user_id === userId ? friendship.friend_id : friendship.user_id;
          const friendUser = friendMap[friendId];
          
          if (friendUser) {
            friends.push({
              id: friendUser.id,
              username: friendUser.username,
              profile_pic: friendUser.profile_pic || 'default.png',
              rank: friendUser.rank || 'E',
              wins: friendUser.wins || 0,
              losses: friendUser.losses || 0,
              matches_played: friendUser.matches_played || 0,
              win_rate: parseFloat(friendUser.win_rate) || 0,
              balance: friendUser.balance || 0,
              account_status: friendUser.account_status,
              status: 'accepted',
              is_favorite: friendship.is_favorite || friendship.favorite || false,
              chat_enabled: friendship.chat_enabled || true,
              note: friendship.note,
              friends_since: friendship.friendship_date || friendship.created_at,
              online_status: 'offline'
            });
          }
        }
      }
    }
    
    console.log(`✅ Processed ${friends.length} friends`);
    
    // Get pending incoming requests
    const { data: requests, error: requestsError } = await client
      .from('friends')
      .select('*')
      .eq('friend_id', userId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });
    
    if (requestsError) {
      console.error('Error fetching requests:', requestsError);
    }
    
    // Format incoming requests
    const formattedRequests = [];
    if (requests && requests.length > 0) {
      const requesterIds = requests.map(r => r.user_id);
      
      const { data: requesterUsers, error: requesterError } = await client
        .from('users')
        .select('id, username, profile_pic, rank, win_rate, wins, losses, matches_played')
        .in('id', requesterIds);
      
      if (requesterError) {
        console.error('Error fetching requester users:', requesterError);
      } else {
        const requesterMap = {};
        for (const user of requesterUsers || []) {
          requesterMap[user.id] = user;
        }
        
        for (const req of requests) {
          const requester = requesterMap[req.user_id];
          formattedRequests.push({
            request_id: req.id,
            user_id: req.user_id,
            username: requester?.username || 'Unknown User',
            profile_pic: requester?.profile_pic || 'default.png',
            rank: requester?.rank || 'E',
            win_rate: parseFloat(requester?.win_rate) || 0,
            wins: requester?.wins || 0,
            losses: requester?.losses || 0,
            matches_played: requester?.matches_played || 0,
            created_at: req.created_at,
            direction: 'incoming'
          });
        }
      }
    }
    
    // Get pending outgoing requests
    const { data: sentRequests, error: sentError } = await client
      .from('friends')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });
    
    if (sentError) {
      console.error('Error fetching sent requests:', sentError);
    }
    
    // Format outgoing requests
    const formattedSentRequests = [];
    if (sentRequests && sentRequests.length > 0) {
      const recipientIds = sentRequests.map(r => r.friend_id);
      
      const { data: recipientUsers, error: recipientError } = await client
        .from('users')
        .select('id, username, profile_pic, rank, win_rate, wins, losses, matches_played')
        .in('id', recipientIds);
      
      if (recipientError) {
        console.error('Error fetching recipient users:', recipientError);
      } else {
        const recipientMap = {};
        for (const user of recipientUsers || []) {
          recipientMap[user.id] = user;
        }
        
        for (const req of sentRequests) {
          const recipient = recipientMap[req.friend_id];
          formattedSentRequests.push({
            request_id: req.id,
            user_id: req.friend_id,
            username: recipient?.username || 'Unknown User',
            profile_pic: recipient?.profile_pic || 'default.png',
            rank: recipient?.rank || 'E',
            win_rate: parseFloat(recipient?.win_rate) || 0,
            wins: recipient?.wins || 0,
            losses: recipient?.losses || 0,
            matches_played: recipient?.matches_played || 0,
            created_at: req.created_at,
            direction: 'outgoing'
          });
        }
      }
    }
    
    console.log(`✅ FINAL: ${friends.length} friends, ${formattedRequests.length} incoming requests, ${formattedSentRequests.length} outgoing requests`);
    
    res.json({
      success: true,
      friends: friends,
      requests: formattedRequests,
      sentRequests: formattedSentRequests,
      counts: {
        friends: friends.length,
        incoming: formattedRequests.length,
        outgoing: formattedSentRequests.length
      }
    });
    
  } catch (error) {
    console.error('❌ Error fetching friends:', error);
    console.error('Error code:', error.code);
    console.error('Error message:', error.message);
    res.status(500).json({ 
      success: false, 
      message: 'Error fetching friends list',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
      friends: [],
      requests: [],
      sentRequests: []
    });
  }
});

// Get friend requests only
router.get('/requests', async (req, res) => {
  try {
    const userId = req.user.id;
    const token = req.headers.authorization?.split(' ')[1];
    
    console.log(`📋 Fetching friend requests for user: ${userId}`);
    
    const client = db.supabaseAdmin || db.supabase;
    
    const { data: requests, error } = await client
      .from('friends')
      .select('*')
      .eq('friend_id', userId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });
    
    if (error) {
      console.error('Error fetching requests:', error);
      throw error;
    }
    
    console.log(`Found ${requests?.length || 0} pending requests for user ${userId}`);
    
    const formattedRequests = [];
    if (requests && requests.length > 0) {
      const requesterIds = requests.map(r => r.user_id);
      
      const { data: requesterUsers, error: requesterError } = await client
        .from('users')
        .select('id, username, profile_pic, rank, win_rate, wins, losses, matches_played')
        .in('id', requesterIds);
      
      if (requesterError) {
        console.error('Error fetching requester users:', requesterError);
      } else {
        const requesterMap = {};
        for (const user of requesterUsers || []) {
          requesterMap[user.id] = user;
        }
        
        for (const req of requests) {
          const requester = requesterMap[req.user_id];
          formattedRequests.push({
            request_id: req.id,
            user_id: req.user_id,
            username: requester?.username || 'Unknown User',
            profile_pic: requester?.profile_pic || 'default.png',
            rank: requester?.rank || 'E',
            win_rate: parseFloat(requester?.win_rate) || 0,
            wins: requester?.wins || 0,
            losses: requester?.losses || 0,
            matches_played: requester?.matches_played || 0,
            created_at: req.created_at,
            direction: 'incoming'
          });
        }
      }
    }
    
    console.log(`✅ Returning ${formattedRequests.length} formatted requests`);
    
    res.json({ 
      success: true, 
      requests: formattedRequests 
    });
    
  } catch (error) {
    console.error('❌ Error fetching friend requests:', error);
    console.error('Error code:', error.code);
    console.error('Error message:', error.message);
    res.status(500).json({ 
      success: false, 
      message: 'Error fetching friend requests',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Search users
router.get('/search', async (req, res) => {
  try {
    const { query } = req.query;
    const userId = req.user.id;
    
    console.log('🔍 Searching users with query:', query, 'for user:', userId);
    
    const client = db.supabaseAdmin || db.supabase;
    
    let usersQuery = client
      .from('users')
      .select('id, username, profile_pic, rank, win_rate, wins, losses, matches_played, balance, is_admin, created_at, account_status, is_banned')
      .neq('id', userId)
      .eq('account_status', 'active')
      .eq('is_banned', false);
    
    if (!query || query.trim() === '') {
      usersQuery = usersQuery.order('created_at', { ascending: false }).limit(20);
    } else {
      usersQuery = usersQuery
        .or(`username.ilike.%${query}%,rank.ilike.%${query}%`)
        .order('rank', { ascending: true })
        .order('win_rate', { ascending: false })
        .order('matches_played', { ascending: false })
        .limit(50);
    }
    
    const { data: users, error } = await usersQuery;
    
    if (error) {
      console.error('Error searching users:', error);
      throw error;
    }
    
    const usersWithStatus = [];
    for (const user of users || []) {
      const { data: friendship } = await client
        .from('friends')
        .select('status')
        .or(`and(user_id.eq.${userId},friend_id.eq.${user.id}),and(user_id.eq.${user.id},friend_id.eq.${userId})`)
        .maybeSingle();
      
      usersWithStatus.push({
        id: user.id,
        username: user.username,
        profile_pic: user.profile_pic || 'default.png',
        rank: user.rank || 'E',
        win_rate: parseFloat(user.win_rate) || 0,
        wins: user.wins || 0,
        losses: user.losses || 0,
        matches_played: user.matches_played || 0,
        balance: user.balance || 0,
        is_admin: user.is_admin || false,
        created_at: user.created_at,
        account_status: user.account_status,
        is_banned: user.is_banned || false,
        friend_status: friendship?.status || null,
        status: 'offline'
      });
    }
    
    console.log('✅ Found', usersWithStatus.length, 'users');
    res.json({ success: true, results: usersWithStatus });
    
  } catch (error) {
    console.error('❌ Error searching users:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error searching users',
      error: error.message 
    });
  }
});

// Send friend request
router.post('/send-request', async (req, res) => {
  try {
    const userId = req.user.id;
    const { friendId } = req.body;
    const token = req.headers.authorization?.split(' ')[1];
    
    console.log(`📤 User ${userId} sending friend request to ${friendId}`);
    
    if (!friendId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Friend ID is required' 
      });
    }
    
    if (userId === friendId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Cannot send friend request to yourself' 
      });
    }
    
    const client = db.supabaseAdmin || db.supabase;
    
    const { data: user, error: userError } = await client
      .from('users')
      .select('id')
      .eq('id', friendId)
      .maybeSingle();
    
    if (userError || !user) {
      return res.status(404).json({ 
        success: false, 
        message: 'User not found' 
      });
    }
    
    const { data: existing, error: existingError } = await client
      .from('friends')
      .select('*')
      .or(`and(user_id.eq.${userId},friend_id.eq.${friendId}),and(user_id.eq.${friendId},friend_id.eq.${userId})`);
    
    if (existing && existing.length > 0) {
      const friendship = existing[0];
      if (friendship.status === 'accepted') {
        return res.status(400).json({ 
          success: false, 
          message: 'You are already friends with this user' 
        });
      } else if (friendship.status === 'pending') {
        if (friendship.user_id === userId) {
          return res.status(400).json({ 
            success: false, 
            message: 'You already sent a friend request to this user' 
          });
        } else {
          return res.status(400).json({ 
            success: false, 
            message: 'This user has already sent you a friend request' 
          });
        }
      }
    }
    
    const { error: insertError } = await client
      .from('friends')
      .insert([{
        user_id: userId,
        friend_id: friendId,
        status: 'pending',
        chat_enabled: true,
        favorite: false,
        is_favorite: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }]);
    
    if (insertError) {
      console.error('Error sending friend request:', insertError);
      throw insertError;
    }
    
    console.log(`✅ Friend request sent from ${userId} to ${friendId}`);
    
    res.json({ 
      success: true, 
      message: 'Friend request sent successfully' 
    });
    
  } catch (error) {
    console.error('❌ Error sending friend request:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error sending friend request'
    });
  }
});

// Accept friend request
router.post('/accept-request', async (req, res) => {
  try {
    const userId = req.user.id;
    const { requestId } = req.body;
    
    console.log(`✅ User ${userId} accepting friend request ${requestId}`);
    
    if (!requestId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Request ID is required' 
      });
    }
    
    const client = db.supabaseAdmin || db.supabase;
    
    const { data: request, error: requestError } = await client
      .from('friends')
      .select('*')
      .eq('id', requestId)
      .eq('friend_id', userId)
      .eq('status', 'pending')
      .maybeSingle();
    
    if (requestError || !request) {
      return res.status(404).json({ 
        success: false, 
        message: 'Friend request not found' 
      });
    }
    
    const senderId = request.user_id;
    
    const { error: updateError } = await client
      .from('friends')
      .update({ status: 'accepted', updated_at: new Date().toISOString() })
      .eq('id', requestId);
    
    if (updateError) {
      console.error('Error updating request:', updateError);
      throw updateError;
    }
    
    const { data: reverseCheck } = await client
      .from('friends')
      .select('id')
      .eq('user_id', userId)
      .eq('friend_id', senderId)
      .maybeSingle();
    
    if (!reverseCheck) {
      await client
        .from('friends')
        .insert([{
          user_id: userId,
          friend_id: senderId,
          status: 'accepted',
          chat_enabled: true,
          favorite: false,
          is_favorite: false,
          friendship_date: new Date().toISOString(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }]);
    }
    
    const { data: senderData } = await client
      .from('users')
      .select('id, username, profile_pic, rank, wins, losses, matches_played, win_rate, balance, account_status')
      .eq('id', senderId)
      .single();
    
    const newFriend = senderData ? {
      id: senderData.id,
      username: senderData.username,
      profile_pic: senderData.profile_pic || 'default.png',
      rank: senderData.rank || 'E',
      wins: senderData.wins || 0,
      losses: senderData.losses || 0,
      matches_played: senderData.matches_played || 0,
      win_rate: parseFloat(senderData.win_rate) || 0,
      balance: senderData.balance || 0,
      account_status: senderData.account_status,
      status: 'accepted',
      is_favorite: false,
      friends_since: new Date().toISOString(),
      online_status: 'offline'
    } : null;
    
    res.json({ 
      success: true, 
      message: 'Friend request accepted',
      friendId: senderId,
      friendUsername: senderData?.username,
      newFriend: newFriend,
      removedRequestId: requestId
    });
    
  } catch (error) {
    console.error('❌ Error accepting friend request:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error accepting friend request'
    });
  }
});

// Reject friend request
router.post('/reject-request', async (req, res) => {
  try {
    const userId = req.user.id;
    const { requestId } = req.body;
    
    console.log(`❌ User ${userId} rejecting friend request ${requestId}`);
    
    if (!requestId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Request ID is required' 
      });
    }
    
    const client = db.supabaseAdmin || db.supabase;
    
    const { error: deleteError } = await client
      .from('friends')
      .delete()
      .eq('id', requestId)
      .eq('friend_id', userId)
      .eq('status', 'pending');
    
    if (deleteError) {
      console.error('Error rejecting request:', deleteError);
      throw deleteError;
    }
    
    res.json({ 
      success: true, 
      message: 'Friend request rejected',
      removedRequestId: requestId
    });
    
  } catch (error) {
    console.error('❌ Error rejecting friend request:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error rejecting friend request'
    });
  }
});

// Remove friend
router.delete('/:friendId', async (req, res) => {
  try {
    const userId = req.user.id;
    const { friendId } = req.params;
    
    console.log(`🗑️ User ${userId} removing friend ${friendId}`);
    
    if (!friendId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Friend ID is required' 
      });
    }
    
    const client = db.supabaseAdmin || db.supabase;
    
    const { error: deleteError } = await client
      .from('friends')
      .delete()
      .or(`and(user_id.eq.${userId},friend_id.eq.${friendId}),and(user_id.eq.${friendId},friend_id.eq.${userId})`)
      .eq('status', 'accepted');
    
    if (deleteError) {
      console.error('Error removing friend:', deleteError);
      throw deleteError;
    }
    
    res.json({ 
      success: true, 
      message: 'Friend removed successfully' 
    });
    
  } catch (error) {
    console.error('❌ Error removing friend:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error removing friend'
    });
  }
});

// Block user
router.post('/block', async (req, res) => {
  try {
    const userId = req.user.id;
    const { friendId } = req.body;
    
    console.log(`🚫 User ${userId} blocking user ${friendId}`);
    
    if (!friendId) {
      return res.status(400).json({ 
        success: false, 
        message: 'User ID is required' 
      });
    }
    
    const client = db.supabaseAdmin || db.supabase;
    
    const { data: existing, error: existingError } = await client
      .from('friends')
      .select('id')
      .or(`and(user_id.eq.${userId},friend_id.eq.${friendId}),and(user_id.eq.${friendId},friend_id.eq.${userId})`)
      .maybeSingle();
    
    if (existing) {
      const { error: updateError } = await client
        .from('friends')
        .update({ status: 'blocked', updated_at: new Date().toISOString() })
        .or(`and(user_id.eq.${userId},friend_id.eq.${friendId}),and(user_id.eq.${friendId},friend_id.eq.${userId})`);
      
      if (updateError) {
        console.error('Error updating relationship:', updateError);
        throw updateError;
      }
    } else {
      const { error: insertError } = await client
        .from('friends')
        .insert([{
          user_id: userId,
          friend_id: friendId,
          status: 'blocked',
          chat_enabled: false,
          favorite: false,
          is_favorite: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }]);
      
      if (insertError) {
        console.error('Error creating blocked relationship:', insertError);
        throw insertError;
      }
    }
    
    res.json({ 
      success: true, 
      message: 'User blocked successfully' 
    });
    
  } catch (error) {
    console.error('❌ Error blocking user:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error blocking user'
    });
  }
});

// Get online friends
router.get('/online', async (req, res) => {
  try {
    const userId = req.user.id;
    
    const client = db.supabaseAdmin || db.supabase;
    
    const { data: friendships, error } = await client
      .from('friends')
      .select('*')
      .or(`user_id.eq.${userId},friend_id.eq.${userId}`)
      .eq('status', 'accepted');
    
    if (error) {
      console.error('Error fetching online friends:', error);
      throw error;
    }
    
    const friendIds = [];
    for (const f of friendships || []) {
      const friendId = f.user_id === userId ? f.friend_id : f.user_id;
      friendIds.push(friendId);
    }
    
    const friends = [];
    if (friendIds.length > 0) {
      const { data: friendUsers } = await client
        .from('users')
        .select('id, username, profile_pic, rank, wins, losses, win_rate')
        .in('id', friendIds);
      
      for (const user of friendUsers || []) {
        friends.push({
          id: user.id,
          username: user.username,
          profile_pic: user.profile_pic || 'default.png',
          rank: user.rank || 'E',
          wins: user.wins || 0,
          losses: user.losses || 0,
          win_rate: parseFloat(user.win_rate) || 0,
          status: 'online'
        });
      }
    }
    
    res.json({ success: true, friends });
    
  } catch (error) {
    console.error('❌ Error fetching online friends:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error fetching online friends'
    });
  }
});

// Toggle favorite status
router.post('/toggle-favorite', async (req, res) => {
  try {
    const userId = req.user.id;
    const { friendId, isFavorite } = req.body;
    
    console.log(`⭐ User ${userId} toggling favorite for friend ${friendId} to ${isFavorite}`);
    
    if (!friendId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Friend ID is required' 
      });
    }
    
    const client = db.supabaseAdmin || db.supabase;
    
    const { error: updateError } = await client
      .from('friends')
      .update({ is_favorite: isFavorite, updated_at: new Date().toISOString() })
      .or(`and(user_id.eq.${userId},friend_id.eq.${friendId}),and(user_id.eq.${friendId},friend_id.eq.${userId})`)
      .eq('status', 'accepted');
    
    if (updateError) {
      console.error('Error updating favorite:', updateError);
      throw updateError;
    }
    
    res.json({ 
      success: true, 
      message: isFavorite ? 'Added to favorites' : 'Removed from favorites'
    });
    
  } catch (error) {
    console.error('❌ Error toggling favorite:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error updating favorite status'
    });
  }
});

// Get online friends count
router.get('/online-count', async (req, res) => {
  try {
    const userId = req.user.id;
    
    const client = db.supabaseAdmin || db.supabase;
    
    const { data: friendships, error } = await client
      .from('friends')
      .select('*')
      .or(`user_id.eq.${userId},friend_id.eq.${userId}`)
      .eq('status', 'accepted');
    
    if (error) {
      console.error('Error fetching friends count:', error);
      throw error;
    }
    
    const friends = [];
    for (const f of friendships || []) {
      const friendId = f.user_id === userId ? f.friend_id : f.user_id;
      friends.push({ id: friendId });
    }
    
    res.json({ 
      success: true, 
      friends: friends,
      count: friends.length
    });
    
  } catch (error) {
    console.error('❌ Error fetching friends count:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error fetching friends count'
    });
  }
});

// Check friendship status
router.get('/status/:friendId', async (req, res) => {
  try {
    const userId = req.user.id;
    const { friendId } = req.params;
    
    const client = db.supabaseAdmin || db.supabase;
    
    const { data: friendship, error } = await client
      .from('friends')
      .select('status, is_favorite')
      .or(`and(user_id.eq.${userId},friend_id.eq.${friendId}),and(user_id.eq.${friendId},friend_id.eq.${userId})`)
      .maybeSingle();
    
    if (error) {
      console.error('Error checking friendship status:', error);
      throw error;
    }
    
    if (!friendship) {
      return res.json({ 
        success: true, 
        status: 'none',
        is_favorite: false
      });
    }
    
    res.json({ 
      success: true, 
      status: friendship.status,
      is_favorite: friendship.is_favorite || false
    });
    
  } catch (error) {
    console.error('❌ Error checking friendship status:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error checking friendship status'
    });
  }
});

// Debug state endpoint
router.get('/debug/state', async (req, res) => {
  try {
    const userId = req.user.id;
    
    console.log(`🔍 Debugging friendship state for user ${userId}`);
    
    const client = db.supabaseAdmin || db.supabase;
    
    const { data: friendships, error } = await client
      .from('friends')
      .select('*')
      .or(`user_id.eq.${userId},friend_id.eq.${userId}`)
      .order('created_at', { ascending: false });
    
    if (error) {
      console.error('Error fetching debug state:', error);
      throw error;
    }
    
    const userIds = new Set();
    for (const f of friendships || []) {
      userIds.add(f.user_id);
      userIds.add(f.friend_id);
    }
    
    const { data: users } = await client
      .from('users')
      .select('id, username')
      .in('id', Array.from(userIds));
    
    const userMap = {};
    for (const u of users || []) {
      userMap[u.id] = u.username;
    }
    
    const enrichedFriendships = (friendships || []).map(f => ({
      ...f,
      user_name: userMap[f.user_id] || 'Unknown',
      friend_name: userMap[f.friend_id] || 'Unknown'
    }));
    
    res.json({
      success: true,
      userId: userId,
      friendships: enrichedFriendships,
      count: enrichedFriendships.length
    });
    
  } catch (error) {
    console.error('❌ Debug error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Debug error',
      error: error.message 
    });
  }
});

module.exports = router;
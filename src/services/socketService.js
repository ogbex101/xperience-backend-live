const jwt = require('jsonwebtoken');
const db = require('../config/database');

const onlineUsers = new Map();
const userConnections = new Map();
const matchRooms = new Map();
let ioInstance;

const initializeSocket = (io) => {
  ioInstance = io;
  
  io.use((socket, next) => {
    const token = socket.handshake.auth.token || socket.handshake.query.token;
    
    console.log('Socket Auth - Token exists:', !!token);
    
    if (!token) {
      console.log('No token provided');
      return next(new Error('Authentication error: No token provided'));
    }
    
    try {
      const cleanToken = token.startsWith('Bearer ') ? token.slice(7) : token;
      const decoded = jwt.verify(cleanToken, process.env.JWT_SECRET || 'your-secret-key');
      
      console.log('Socket Auth - Decoded:', decoded);
      
      socket.userId = decoded.id || decoded.userId;
      socket.username = decoded.username;
      
      if (!socket.userId) {
        console.error('Socket Auth - No userId in token');
        return next(new Error('Authentication error: Invalid token structure'));
      }
      
      next();
    } catch (err) {
      console.error('Socket Auth - Token verification failed:', err.message);
      next(new Error('Authentication error: Invalid token'));
    }
  });
  
  io.on('connection', async (socket) => {
    console.log('✅ Socket.io: User connected:', {
      userId: socket.userId,
      username: socket.username,
      socketId: socket.id
    });

    if (!socket.userId) {
      console.error('❌ Socket.io: User ID is undefined, disconnecting');
      socket.disconnect();
      return;
    }

    // Get username from database if not in token
    if (!socket.username && db.isSupabase) {
      const { data: user } = await db.supabaseAdmin
        .from('users')
        .select('username')
        .eq('id', socket.userId)
        .maybeSingle();
      
      if (user) {
        socket.username = user.username;
      }
    }

    onlineUsers.set(socket.userId, socket.id);
    userConnections.set(socket.userId, socket);
    
    socket.join(`user_${socket.userId}`);
    
    await notifyFriendsOnlineStatus(socket.userId, true, socket.username);
    
    const onlineUserIds = Array.from(onlineUsers.keys());
    socket.emit('online_users_list', { users: onlineUserIds });
    
    socket.broadcast.emit('friend_status_change', {
      userId: socket.userId,
      username: socket.username,
      isOnline: true
    });

    // ============ MATCH CHAT FUNCTIONALITY ============
    socket.on('join_match_chat', async (data) => {
      try {
        const { matchId } = data;
        
        console.log(`💬 User ${socket.userId} (${socket.username}) attempting to join match chat ${matchId}`);
        
        if (!matchId) {
          console.error('❌ No matchId provided');
          socket.emit('match_chat_error', { message: 'Match ID is required' });
          return;
        }
        
        // Check if user is already in the room
        const roomName = `match_chat_${matchId}`;
        if (socket.rooms.has(roomName)) {
          console.log(`✅ User ${socket.userId} already in room ${roomName}`);
          socket.emit('match_chat_joined', {
            matchId: matchId,
            room: roomName,
            success: true,
            alreadyJoined: true
          });
          return;
        }
        
        let matchAccess = false;
        let matchData = null;
        
        if (db.isSupabase) {
          // First, get match data to check access
          const { data: match, error } = await db.supabaseAdmin
            .from('matches')
            .select('id, player1_id, player2_id, opponent_type, opponent_username, status')
            .eq('id', matchId)
            .single();

          if (error) {
            console.error('❌ Match query error:', error);
            socket.emit('match_chat_error', { message: 'Database error' });
            return;
          }

          if (!match) {
            console.error('❌ Match not found:', matchId);
            socket.emit('match_chat_error', { message: 'Match not found' });
            return;
          }

          matchData = match;
          console.log('✅ Match found:', match);

          // Check if user has access to this match
          if (match.player1_id === socket.userId) {
            matchAccess = true;
            console.log(`✅ User ${socket.userId} is player1`);
          } else if (match.player2_id === socket.userId) {
            matchAccess = true;
            console.log(`✅ User ${socket.userId} is player2`);
          } else if (match.opponent_type === 'open' && match.status === 'pending') {
            matchAccess = true;
            console.log(`✅ User ${socket.userId} can view open match`);
          } else if (match.opponent_type === 'specific' && match.opponent_username) {
            // Get current user's username
            const { data: user, error: userError } = await db.supabaseAdmin
              .from('users')
              .select('username')
              .eq('id', socket.userId)
              .single();
            
            if (!userError && user && user.username === match.opponent_username) {
              matchAccess = true;
              console.log(`✅ User ${socket.userId} is invited player`);
            }
          }
        } else {
          const matchAccessResult = await db.query(
            `SELECT id FROM matches 
             WHERE id = $1 AND (
               player1_id = $2 OR player2_id = $3 
               OR opponent_type = 'open'
               OR (opponent_type = 'specific' AND opponent_username = (
                 SELECT username FROM users WHERE id = $4
               ))
             )`,
            [matchId, socket.userId, socket.userId, socket.userId]
          );

          matchAccess = matchAccessResult && matchAccessResult[0]?.length > 0;
        }

        if (!matchAccess) {
          console.log(`❌ User ${socket.userId} denied access to match chat ${matchId}`);
          socket.emit('match_chat_error', {
            message: 'Access denied to this match chat'
          });
          return;
        }

        // Join the room
        await socket.join(roomName);
        
        // Track user's match rooms
        if (!matchRooms.has(socket.userId)) {
          matchRooms.set(socket.userId, new Set());
        }
        matchRooms.get(socket.userId).add(matchId);
        
        console.log(`✅✅✅ User ${socket.userId} SUCCESSFULLY joined match chat ${matchId}`);
        console.log(`📊 User ${socket.userId} is now in rooms:`, Array.from(socket.rooms));
        
        // Send success response
        socket.emit('match_chat_joined', {
          matchId: matchId,
          room: roomName,
          success: true
        });
        
        // Notify others in the room
        socket.to(roomName).emit('user_joined_chat', {
          userId: socket.userId,
          username: socket.username,
          matchId: matchId
        });
        
        // Send match data if available
        if (matchData) {
          socket.emit('match_data', matchData);
        }
        
      } catch (error) {
        console.error('❌ Error in join_match_chat:', error);
        socket.emit('match_chat_error', {
          message: 'Failed to join match chat: ' + error.message
        });
      }
    });

    socket.on('leave_match_chat', (data) => {
      const { matchId } = data;
      const roomName = `match_chat_${matchId}`;
      
      socket.leave(roomName);
      
      if (matchRooms.has(socket.userId)) {
        matchRooms.get(socket.userId).delete(matchId);
        if (matchRooms.get(socket.userId).size === 0) {
          matchRooms.delete(socket.userId);
        }
      }
      
      console.log(`💬 User ${socket.userId} left match chat ${matchId}`);
      
      socket.to(roomName).emit('user_left_chat', {
        userId: socket.userId,
        username: socket.username,
        matchId: matchId
      });
    });

    socket.on('match_chat_message', async (data) => {
      try {
        const { matchId, message, tempId } = data;
        
        console.log('🔴 ===== MATCH CHAT MESSAGE RECEIVED =====');
        console.log('🔴 Timestamp:', new Date().toISOString());
        console.log('🔴 Data received:', { matchId, message, tempId, userId: socket.userId, username: socket.username });
        console.log('🔴 User rooms before check:', Array.from(socket.rooms));
        
        if (!matchId || !message) {
          console.error('❌ Invalid match chat data:', data);
          socket.emit('match_chat_error', {
            message: 'Invalid message data'
          });
          return;
        }
        
        if (!message.trim()) {
          console.error('❌ Empty message');
          socket.emit('match_chat_error', {
            message: 'Message cannot be empty'
          });
          return;
        }
        
        const roomName = `match_chat_${matchId}`;
        
        // Auto-rejoin if not in room
        if (!socket.rooms.has(roomName)) {
          console.log(`⚠️ User ${socket.userId} not in room ${roomName}, attempting auto-rejoin...`);
          
          try {
            // Verify access before rejoining
            let matchAccess = false;
            
            if (db.isSupabase) {
              const { data: match } = await db.supabaseAdmin
                .from('matches')
                .select('player1_id, player2_id')
                .eq('id', matchId)
                .single();

              if (match) {
                matchAccess = match.player1_id === socket.userId || match.player2_id === socket.userId;
              }
            }

            if (!matchAccess) {
              console.error(`❌ User ${socket.userId} no longer has access to match ${matchId}`);
              socket.emit('match_chat_error', {
                message: 'You no longer have access to this chat'
              });
              return;
            }

            await socket.join(roomName);
            console.log(`✅ Auto-rejoin successful, now in rooms:`, Array.from(socket.rooms));
            
            if (!matchRooms.has(socket.userId)) {
              matchRooms.set(socket.userId, new Set());
            }
            matchRooms.get(socket.userId).add(matchId);
          } catch (joinError) {
            console.error('❌ Auto-rejoin failed:', joinError);
            socket.emit('match_chat_error', {
              message: 'Not connected to chat. Please refresh the page.'
            });
            return;
          }
        }
        
        console.log(`✅ User ${socket.userId} is in room ${roomName}, proceeding with message...`);
        
        // Save message to database
        console.log('🔴 Attempting to save message to database...');
        const savedMessage = await saveMatchChatMessage(matchId, socket.userId, message.trim());
        console.log('🔴 saveMatchChatMessage returned:', savedMessage);
        
        if (!savedMessage) {
          console.error('❌ Failed to save message to database - savedMessage is null/falsy');
          socket.emit('match_chat_error', {
            message: 'Failed to save message to database'
          });
          return;
        }
        
        // Get saved message ID and timestamp
        let savedMessageId;
        let savedTimestamp;
        
        if (Array.isArray(savedMessage) && savedMessage.length > 0) {
          savedMessageId = savedMessage[0].id;
          savedTimestamp = savedMessage[0].created_at;
          console.log('🔴 Got ID from array:', savedMessageId);
          console.log('🔴 Got timestamp from array:', savedTimestamp);
        } else if (savedMessage?.id) {
          savedMessageId = savedMessage.id;
          savedTimestamp = savedMessage.created_at;
          console.log('🔴 Got ID from object:', savedMessageId);
          console.log('🔴 Got timestamp from object:', savedTimestamp);
        } else {
          savedMessageId = tempId || `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          savedTimestamp = new Date().toISOString();
          console.log('🔴 Using generated ID:', savedMessageId);
          console.log('🔴 Using generated timestamp:', savedTimestamp);
        }
        
        console.log('🔴 Final message ID to use:', savedMessageId);
        
        // Get user data
        let user = { 
          username: socket.username || 'Unknown', 
          profile_pic: null, 
          rank: 'E', 
          is_admin: false 
        };
        
        if (db.isSupabase) {
          try {
            const { data: userData, error } = await db.supabaseAdmin
              .from('users')
              .select('username, profile_pic, rank, is_admin')
              .eq('id', socket.userId)
              .single();

            if (!error && userData) {
              user = userData;
              console.log('✅ User data fetched:', user.username);
            } else if (error) {
              console.error('❌ Error fetching user data:', error);
            }
          } catch (userError) {
            console.error('❌ Exception fetching user data:', userError);
          }
        } else {
          try {
            const userInfoResult = await db.query(
              'SELECT username, profile_pic, rank, is_admin FROM users WHERE id = $1',
              [socket.userId]
            );
            
            if (userInfoResult && userInfoResult[0] && userInfoResult[0][0]) {
              user = userInfoResult[0][0];
            }
          } catch (userError) {
            console.error('❌ Error fetching user data:', userError);
          }
        }
        
        // Prepare message data
        const messageData = {
          id: savedMessageId,
          match_id: parseInt(matchId),
          user_id: socket.userId,
          username: user.username || socket.username || 'Unknown',
          profile_pic: user.profile_pic,
          rank: user.rank || 'E',
          is_admin: user.is_admin === true,
          is_system: false,
          message: message.trim(),
          created_at: savedTimestamp,
          is_current_user: false  // Frontend will determine this
        };
        
        console.log('🔴 Message data prepared:', messageData);
        
        // Emit to ALL users in the room (including sender)
        io.to(roomName).emit('new_match_message', messageData);
        
        // Also emit a confirmation to sender with tempId for tracking
        socket.emit('message_sent_confirmation', {
          tempId: tempId,
          messageId: savedMessageId,
          timestamp: savedTimestamp
        });
        
        console.log(`🔴 Message broadcast to room ${roomName}`);
        console.log('🔴 ===== MATCH CHAT MESSAGE COMPLETE =====');
        
      } catch (error) {
        console.error('❌ Fatal error in match_chat_message handler:', error);
        console.error('❌ Error stack:', error.stack);
        socket.emit('match_chat_error', {
          message: 'Failed to send message: ' + (error.message || 'Unknown error')
        });
      }
    });

    socket.on('match_typing', async (data) => {
      const { matchId, isTyping } = data;
      
      console.log(`⌨️ User ${socket.userId} typing in match ${matchId}: ${isTyping}`);
      
      // Check if user is in the room
      const roomName = `match_chat_${matchId}`;
      
      // Auto-rejoin if not in room
      if (!socket.rooms.has(roomName)) {
        console.log(`⚠️ User ${socket.userId} not in room ${roomName}, attempting to rejoin for typing...`);
        
        try {
          // Verify access before rejoining
          let matchAccess = false;
          
          if (db.isSupabase) {
            const { data: match } = await db.supabaseAdmin
              .from('matches')
              .select('player1_id, player2_id')
              .eq('id', matchId)
              .single();

            if (match) {
              matchAccess = match.player1_id === socket.userId || match.player2_id === socket.userId;
            }
          }

          if (matchAccess) {
            await socket.join(roomName);
            console.log(`✅ Auto-rejoin successful for typing, now in rooms:`, Array.from(socket.rooms));
            
            if (!matchRooms.has(socket.userId)) {
              matchRooms.set(socket.userId, new Set());
            }
            matchRooms.get(socket.userId).add(matchId);
          }
        } catch (joinError) {
          console.error('❌ Failed to rejoin for typing:', joinError);
          return;
        }
      }
      
      // Broadcast to ALL users in the room EXCEPT sender
      socket.to(roomName).emit('match_user_typing', {
        userId: socket.userId,
        username: socket.username,
        matchId: matchId,
        isTyping: isTyping
      });
      
      console.log(`✅ Typing indicator broadcast to room ${roomName}`);
    });

   socket.on('private_message', async (data) => {
  try {
    const { to, message, tempId } = data;
    
    console.log('📤 Socket.io: Private message from', socket.userId, 'to', to);
    console.log('📤 Message content:', message);
    console.log('📤 TempId:', tempId);
    
    if (!to || !message) {
      console.error('Invalid message data:', data);
      return;
    }
    
    let messageId;
    let roomId;
    let sender = { username: socket.username, profile_pic: null };
    
    if (db.isSupabase) {
      // STEP 1: Find or create chat room
      const user1 = socket.userId < to ? socket.userId : to;
      const user2 = socket.userId < to ? to : socket.userId;
      
      // Check if room exists
      const { data: existingRoom, error: roomCheckError } = await db.supabaseAdmin
        .from('chat_rooms')
        .select('id')
        .eq('user1_id', user1)
        .eq('user2_id', user2)
        .maybeSingle();
      
      if (roomCheckError) {
        console.error('Error checking room:', roomCheckError);
      }
      
      if (existingRoom) {
        roomId = existingRoom.id;
        console.log('✅ Found existing room:', roomId);
      } else {
        // Create new room
        const { data: newRoom, error: roomCreateError } = await db.supabaseAdmin
          .from('chat_rooms')
          .insert([{
            user1_id: user1,
            user2_id: user2,
            created_at: new Date().toISOString(),
            last_message_at: new Date().toISOString(),
            is_group: false
          }])
          .select('id')
          .single();
        
        if (roomCreateError) {
          console.error('Error creating room:', roomCreateError);
          throw roomCreateError;
        }
        
        roomId = newRoom.id;
        console.log('✅ Created new room:', roomId);
      }
      
      // STEP 2: Update last_message_at
      await db.supabaseAdmin
        .from('chat_rooms')
        .update({ last_message_at: new Date().toISOString() })
        .eq('id', roomId);
      
      // STEP 3: Insert message
      const messageData = {
        user_id: socket.userId,
        room_id: roomId,
        message: message,
        is_read: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        read_by: [],
        delivered_to: [],
        deleted_for: [],
        cleared_for_users: []
      };
      
      console.log('📤 Saving message to chat_messages with room_id:', roomId);
      
      const { data: msgData, error: msgError } = await db.supabaseAdmin
        .from('chat_messages')
        .insert([messageData])
        .select('id, created_at')
        .single();

      if (msgError) {
        console.error('❌ Error saving message:', msgError);
        throw msgError;
      }
      
      messageId = msgData.id;
      console.log('✅ Message saved with ID:', messageId);

      // Get sender info
      const { data: userData } = await db.supabaseAdmin
        .from('users')
        .select('username, profile_pic')
        .eq('id', socket.userId)
        .single();

      if (userData) {
        sender = userData;
      }
    } else {
      // PostgreSQL fallback
      console.log('PostgreSQL fallback not implemented');
      return;
    }
    
    // ============ FIXED: Send to recipient WITHOUT tempId ============
    const messageForRecipient = {
      id: messageId,
      sender_id: socket.userId,
      sender_username: sender.username || socket.username || 'Unknown',
      sender_profile_pic: sender.profile_pic,
      receiver_id: to,
      message: message,
      created_at: new Date().toISOString(),
      read_status: false
      // IMPORTANT: NO tempId here!
    };
    
    // Send to recipient if online
    const recipientSocketId = onlineUsers.get(to);
    if (recipientSocketId) {
      io.to(recipientSocketId).emit('new_message', messageForRecipient);
      console.log('✅ Message sent to recipient (without tempId)');
    } else {
      console.log('ℹ️ Recipient is offline, message saved to database');
    }
    
    // ============ Send confirmation to SENDER WITH tempId ============
    // IMPORTANT: Only send message_sent, NOT also new_message to sender
    socket.emit('message_sent', { 
      messageId: messageId, 
      tempId: tempId,
      created_at: new Date().toISOString()
    });
    
    console.log('✅ Message sent confirmation emitted to sender');
    
  } catch (error) {
    console.error('❌ Error sending private message:', error);
    socket.emit('error', { message: 'Failed to send message: ' + error.message });
  }
});

socket.on('group_message', async (data) => {
  try {
    console.log('🔴 ===== GROUP MESSAGE RECEIVED =====');
    console.log('🔴 Data:', JSON.stringify(data, null, 2));
    
    const { groupId, message, tempId } = data;
    
    if (!groupId || !message) {
      console.error('❌ Missing groupId or message');
      socket.emit('group_message_error', { message: 'Missing group ID or message', tempId });
      return;
    }
    
    if (!message.trim()) {
      console.error('❌ Empty message');
      socket.emit('group_message_error', { message: 'Message cannot be empty', tempId });
      return;
    }
    
    // Check if user is member of this group
    const { data: membership, error: memberError } = await db.supabaseAdmin
      .from('group_members')
      .select('id, role')
      .eq('group_id', groupId)
      .eq('user_id', socket.userId)
      .eq('status', 'joined');
    
    if (memberError) {
      console.error('❌ Error checking membership:', memberError);
    }
    
    const isMember = membership && membership.length > 0;
    
    if (!isMember) {
      console.error('❌ User is not a member of this group');
      socket.emit('group_message_error', { message: 'You are not a member of this group', tempId });
      return;
    }
    
    // Ensure chat room exists for group
    const { data: existingRoom, error: roomCheckError } = await db.supabaseAdmin
      .from('chat_rooms')
      .select('id')
      .eq('id', groupId)
      .maybeSingle();
    
    if (roomCheckError) {
      console.error('❌ Error checking room:', roomCheckError);
    }
    
    if (!existingRoom) {
      console.log('🔴 No chat room found for group, creating one...');
      
      const { data: group, error: groupError } = await db.supabaseAdmin
        .from('groups')
        .select('created_by, name')
        .eq('id', groupId)
        .single();
      
      if (groupError) {
        console.error('❌ Error fetching group:', groupError);
      }
      
      const { data: newRoom, error: roomCreateError } = await db.supabaseAdmin
        .from('chat_rooms')
        .insert([{
          id: groupId,
          user1_id: group?.created_by || socket.userId,
          user2_id: null,
          created_at: new Date().toISOString(),
          last_message_at: new Date().toISOString(),
          is_group: true
        }])
        .select()
        .single();
      
      if (roomCreateError && roomCreateError.code !== '23505') {
        console.error('❌ Error creating chat room:', roomCreateError);
        throw roomCreateError;
      }
    } else {
      // Update last_message_at
      await db.supabaseAdmin
        .from('chat_rooms')
        .update({ last_message_at: new Date().toISOString() })
        .eq('id', groupId);
    }
    
    // Save message to database
    const messageData = {
      user_id: socket.userId,
      room_id: groupId,
      message: message,
      is_read: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      read_by: [],
      delivered_to: [],
      deleted_for: [],
      cleared_for_users: []
    };
    
    const { data: savedMessage, error: saveError } = await db.supabaseAdmin
      .from('chat_messages')
      .insert([messageData])
      .select()
      .single();
    
    if (saveError) {
      console.error('❌ Error saving group message:', saveError);
      socket.emit('group_message_error', { message: 'Failed to save message: ' + saveError.message, tempId });
      return;
    }
    
    console.log('✅ Group message saved with ID:', savedMessage.id);
    
    // Get sender info
    const { data: sender, error: senderError } = await db.supabaseAdmin
      .from('users')
      .select('username, profile_pic')
      .eq('id', socket.userId)
      .single();
    
    if (senderError) {
      console.error('Error fetching sender:', senderError);
    }
    
    const roomName = `group_${groupId}`;
    
    // Make sure socket is in the room
    if (!socket.rooms.has(roomName)) {
      await socket.join(roomName);
      console.log(`✅ User joined room ${roomName}`);
    }
    
    // ============ FIXED: Broadcast to OTHER users WITHOUT tempId ============
    const messageForOthers = {
      id: savedMessage.id,
      groupId: groupId,
      senderId: socket.userId,
      senderUsername: sender?.username || socket.username || 'Unknown',
      senderProfilePic: sender?.profile_pic,
      message: message,
      timestamp: savedMessage.created_at
      // IMPORTANT: NO tempId here!
    };
    
    // Broadcast to ALL OTHER users in the group room (excluding sender)
    socket.to(roomName).emit('group_message_received', messageForOthers);
    console.log(`✅ Group message broadcast to other users in room ${roomName} (without tempId)`);
    
    // ============ Send confirmation to SENDER WITH tempId ============
    socket.emit('group_message_sent', {
      tempId: tempId,
      messageId: savedMessage.id,
      timestamp: savedMessage.created_at
    });
    console.log(`✅ Group message confirmation sent to sender (with tempId)`);
    
    console.log('🔴 ===== GROUP MESSAGE COMPLETE =====');
    
  } catch (error) {
    console.error('❌ Fatal error in group_message handler:', error);
    socket.emit('group_message_error', { 
      message: 'Server error: ' + error.message,
      tempId: data?.tempId 
    });
  }
});

    // ============ JOIN GROUP ROOM ============
    socket.on('join_group', async (data) => {
      try {
        const { groupId } = data;
        
        console.log(`👥 User ${socket.userId} joining group room: ${groupId}`);
        
        if (!groupId) {
          console.error('❌ No groupId provided');
          return;
        }
        
        // Check if user is member of this group
        const { data: membership, error: memberError } = await db.supabaseAdmin
          .from('group_members')
          .select('id')
          .eq('group_id', groupId)
          .eq('user_id', socket.userId)
          .eq('status', 'joined');
        
        if (memberError) {
          console.error('❌ Error checking membership:', memberError);
        }
        
        const isMember = membership && membership.length > 0;
        
        if (!isMember) {
          console.error(`❌ User ${socket.userId} is not a member of group ${groupId}`);
          socket.emit('group_error', { 
            message: 'You are not a member of this group',
            groupId 
          });
          return;
        }
        
        const roomName = `group_${groupId}`;
        await socket.join(roomName);
        
        console.log(`✅ User ${socket.userId} joined group room ${roomName}`);
        
        socket.emit('group_joined', {
          groupId: groupId,
          room: roomName,
          success: true
        });
        
      } catch (error) {
        console.error('❌ Error joining group:', error);
      }
    });

    // ============ LEAVE GROUP ROOM ============
    socket.on('leave_group', (data) => {
      const { groupId } = data;
      const roomName = `group_${groupId}`;
      
      socket.leave(roomName);
      console.log(`👋 User ${socket.userId} left group room ${roomName}`);
    });
    
    socket.on('typing', (data) => {
      const { to, isTyping } = data;
      const recipientSocketId = onlineUsers.get(to);
      
      if (recipientSocketId) {
        io.to(recipientSocketId).emit('user_typing', {
          userId: socket.userId,
          username: socket.username,
          isTyping: isTyping
        });
      }
    });

    // ============ GROUP TYPING INDICATOR ============
    socket.on('group_typing', (data) => {
      const { groupId, isTyping } = data;
      const roomName = `group_${groupId}`;
      
      console.log(`⌨️ User ${socket.userId} typing in group ${groupId}: ${isTyping}`);
      
      // Broadcast to all users in the group room EXCEPT sender
      socket.to(roomName).emit('group_user_typing', {
        userId: socket.userId,
        username: socket.username,
        groupId: groupId,
        isTyping: isTyping
      });
    });
    
    socket.on('join_user', (data) => {
      console.log(`👤 User ${socket.userId} joining personal room`);
    });
    
    socket.on('disconnect', async () => {
      console.log(`🔌 Socket.io: User disconnected: ${socket.username} (ID: ${socket.userId})`);
      
      if (socket.userId) {
        // Notify all match rooms that user left
        if (matchRooms.has(socket.userId)) {
          const userMatches = matchRooms.get(socket.userId);
          userMatches.forEach(matchId => {
            const roomName = `match_chat_${matchId}`;
            socket.to(roomName).emit('user_left_chat', {
              userId: socket.userId,
              username: socket.username,
              matchId: matchId,
              reason: 'disconnected'
            });
          });
          matchRooms.delete(socket.userId);
        }
        
        onlineUsers.delete(socket.userId);
        userConnections.delete(socket.userId);
        
        await notifyFriendsOnlineStatus(socket.userId, false, socket.username);
        
        socket.broadcast.emit('friend_status_change', {
          userId: socket.userId,
          username: socket.username,
          isOnline: false
        });
      }
    });
    
    socket.on('heartbeat', () => {
      socket.emit('heartbeat_response');
    });
    
    socket.on('message_read', async (data) => {
      try {
        const { messageId } = data;
        let senderId = null;
        
        if (db.isSupabase) {
          await db.supabaseAdmin
            .from('messages')
            .update({ read_status: 1 })
            .eq('id', messageId);

          const { data: message } = await db.supabaseAdmin
            .from('messages')
            .select('sender_id')
            .eq('id', messageId)
            .single();

          if (message) {
            senderId = message.sender_id;
          }
        } else {
          await db.query(
            'UPDATE messages SET read_status = 1 WHERE id = $1',
            [messageId]
          );
          
          const messageResult = await db.query(
            'SELECT sender_id FROM messages WHERE id = $1',
            [messageId]
          );
          
          if (messageResult && messageResult[0] && messageResult[0][0]) {
            senderId = messageResult[0][0].sender_id;
          }
        }
        
        if (senderId) {
          const senderSocketId = onlineUsers.get(senderId);
          if (senderSocketId) {
            io.to(senderSocketId).emit('message_read_confirmation', {
              messageId: messageId
            });
          }
        }
      } catch (error) {
        console.error('Error marking message as read:', error);
      }
    });

    socket.on('match_update', (data) => {
      const { matchId, update } = data;
      const roomName = `match_updates_${matchId}`;
      
      io.to(roomName).emit('match_updated', {
        matchId: matchId,
        update: update
      });
      
      if (update.status) {
        const matchChatRoom = `match_chat_${matchId}`;
        const systemMessage = getMatchStatusSystemMessage(update.status);
        
        if (systemMessage) {
          io.to(matchChatRoom).emit('match_system_message', {
            matchId: matchId,
            message: systemMessage,
            timestamp: new Date().toISOString()
          });
        }
      }
    });

    socket.on('check_rooms', () => {
      console.log(`🔍 Room check for user ${socket.userId}:`, Array.from(socket.rooms));
      socket.emit('rooms_list', {
        rooms: Array.from(socket.rooms),
        userId: socket.userId
      });
    });
  });
};

// ============ HELPER FUNCTIONS ============

const saveMatchChatMessage = async (matchId, userId, message) => {
  console.log('🔍 ===== SAVE MATCH CHAT MESSAGE DEBUG START =====');
  console.log('🔍 matchId:', matchId);
  console.log('🔍 userId:', userId);
  console.log('🔍 message:', message);
  console.log('🔍 db.isSupabase:', db.isSupabase);
  console.log('🔍 db.supabaseAdmin exists:', !!db.supabaseAdmin);
  
  try {
    if (db.isSupabase) {
      console.log('🔍 Attempting to save to Supabase match_chat table...');
      
      if (!matchId || !userId || !message) {
        console.error('❌ Invalid input parameters:', { matchId, userId, message });
        return null;
      }
      
      const messageData = {
        match_id: matchId,
        user_id: userId,
        message: message,
        is_system: false,
        created_at: new Date().toISOString()
      };
      
      console.log('🔍 Message data to insert:', messageData);
      
      const { data, error } = await db.supabaseAdmin
        .from('match_chat')
        .insert([messageData])
        .select();

      console.log('🔍 Insert response - Data:', JSON.stringify(data, null, 2));
      console.log('🔍 Insert response - Error:', error);

      if (error) {
        console.error('❌ Supabase error saving match chat message:', error);
        console.error('❌ Error code:', error.code);
        console.error('❌ Error message:', error.message);
        console.error('❌ Error details:', error.details);
        console.log('🔍 ===== SAVE MATCH CHAT MESSAGE DEBUG END WITH ERROR =====');
        return null;
      }
      
      if (!data || data.length === 0) {
        console.error('❌ No data returned from insert');
        console.log('🔍 ===== SAVE MATCH CHAT MESSAGE DEBUG END WITH NO DATA =====');
        return null;
      }
      
      console.log('✅ Match chat message saved successfully!');
      console.log('🔍 Saved data:', JSON.stringify(data, null, 2));
      console.log('🔍 ===== SAVE MATCH CHAT MESSAGE DEBUG END SUCCESS =====');
      return data;
    } else {
      console.log('🔍 Attempting to save to PostgreSQL...');
      try {
        const result = await db.query(
          `INSERT INTO match_chat (match_id, user_id, message, is_system, created_at) 
           VALUES ($1, $2, $3, $4, $5) RETURNING *`,
          [matchId, userId, message, false, new Date().toISOString()]
        );
        console.log('🔍 PostgreSQL result:', JSON.stringify(result, null, 2));
        console.log('✅ Match chat message saved for match', matchId);
        console.log('🔍 ===== SAVE MATCH CHAT MESSAGE DEBUG END =====');
        return result;
      } catch (pgError) {
        console.error('❌ PostgreSQL error:', pgError);
        return null;
      }
    }
  } catch (error) {
    console.error('❌ Unexpected error in saveMatchChatMessage:', error);
    console.error('❌ Error stack:', error.stack);
    console.log('🔍 ===== SAVE MATCH CHAT MESSAGE DEBUG END WITH CATCH ERROR =====');
    return null;
  }
};

const getMatchStatusSystemMessage = (status) => {
  switch(status) {
    case 'ongoing':
      return 'Match has started! Good luck to both players!';
    case 'completed':
      return 'Match has been completed!';
    case 'disputed':
      return 'Match is under dispute. Admin review required.';
    case 'cancelled':
      return 'Match has been cancelled.';
    default:
      return null;
  }
};

const notifyFriendsOnlineStatus = async (userId, isOnline, username = '') => {
  try {
    if (!userId) {
      console.error('❌ notifyFriendsOnlineStatus: userId is undefined');
      return;
    }

    let friends = [];

    if (db.isSupabase) {
      const { data: friendsData, error } = await db.supabaseAdmin
        .from('friends')
        .select(`
          friend_id,
          user_id
        `)
        .or(`user_id.eq.${userId},friend_id.eq.${userId}`)
        .eq('status', 'accepted');

      if (!error && friendsData) {
        friends = friendsData.map(f => ({
          friendId: f.user_id === userId ? f.friend_id : f.user_id
        }));
      }
    } else {
      const friendsResult = await db.query(`
        SELECT DISTINCT 
          CASE 
            WHEN f.user_id = $1 THEN f.friend_id 
            ELSE f.user_id 
          END as friendId
        FROM friends f
        WHERE (f.user_id = $2 OR f.friend_id = $3) 
          AND f.status = 'accepted'
      `, [userId, userId, userId]);
      
      friends = friendsResult[0] || [];
    }
    
    console.log(`👥 Notifying ${friends.length} friends about user ${userId} (${username})`);
    
    friends.forEach(friend => {
      const friendSocketId = onlineUsers.get(friend.friendId);
      if (friendSocketId && ioInstance) {
        ioInstance.to(friendSocketId).emit('friend_status_change', {
          userId: userId,
          username: username,
          isOnline: isOnline
        });
      }
    });
  } catch (error) {
    console.error('Error notifying friends:', error);
  }
};

const sendMatchUpdate = (matchId, update) => {
  if (!ioInstance) return;
  
  const roomName = `match_updates_${matchId}`;
  const matchChatRoom = `match_chat_${matchId}`;
  
  ioInstance.to(roomName).emit('match_updated', {
    matchId: matchId,
    update: update
  });
  
  if (update.status) {
    const systemMessage = getMatchStatusSystemMessage(update.status);
    if (systemMessage) {
      ioInstance.to(matchChatRoom).emit('match_system_message', {
        matchId: matchId,
        message: systemMessage,
        timestamp: new Date().toISOString()
      });
    }
  }
};

module.exports = { 
  initializeSocket,
  sendMatchUpdate 
};
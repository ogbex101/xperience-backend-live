// routes/groups.js - COMPLETE WORKING VERSION
const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

// ==================== HELPER FUNCTIONS ====================

/**
 * Check if user has permission to view group details
 * Manual check since RLS is disabled
 */
async function canViewGroup(userId, groupId) {
  try {
    if (db.isSupabase) {
      // Get group details
      const { data: group, error: groupError } = await db.supabase
        .from('groups')
        .select('visibility, is_public, created_by')
        .eq('id', groupId)
        .maybeSingle();
      
      if (groupError || !group) return false;
      
      // Public groups - anyone can view
      if (group.visibility === 'public' || group.is_public === true) {
        return true;
      }
      
      // Creator can always view
      if (group.created_by === userId) {
        return true;
      }
      
      // Check membership for private groups
      const { data: member, error: memberError } = await db.supabase
        .from('group_members')
        .select('id')
        .eq('group_id', groupId)
        .eq('user_id', userId)
        .eq('status', 'joined')
        .maybeSingle();
      
      return !!member;
    }
    return false;
  } catch (error) {
    console.error('Error in canViewGroup:', error);
    return false;
  }
}

/**
 * Get user's role in group
 */
async function getUserGroupRole(userId, groupId) {
  if (!userId) return null;
  
  try {
    if (db.isSupabase) {
      // Check if user is creator
      const { data: group, error: groupError } = await db.supabase
        .from('groups')
        .select('created_by')
        .eq('id', groupId)
        .maybeSingle();
      
      if (groupError) return null;
      
      if (group && group.created_by === userId) {
        return 'owner';
      }
      
      // Check membership role
      const { data: membership, error: memberError } = await db.supabase
        .from('group_members')
        .select('role')
        .eq('group_id', groupId)
        .eq('user_id', userId)
        .eq('status', 'joined')
        .maybeSingle();
      
      return membership?.role || null;
    }
    return null;
  } catch (error) {
    console.error('Error in getUserGroupRole:', error);
    return null;
  }
}

/**
 * Check group capacity
 */
async function checkGroupCapacity(groupId) {
  try {
    if (db.isSupabase) {
      // Get current member count
      const { count, error: countError } = await db.supabase
        .from('group_members')
        .select('*', { count: 'exact', head: true })
        .eq('group_id', groupId)
        .eq('status', 'joined');
      
      if (countError) throw countError;
      
      // Get group max members
      const { data: group, error: groupError } = await db.supabase
        .from('groups')
        .select('max_members')
        .eq('id', groupId)
        .maybeSingle();
      
      if (groupError) throw groupError;
      
      const max = group?.max_members || 20;
      const current = count || 0;
      
      return {
        current,
        max,
        hasSpace: current < max
      };
    }
    return { current: 0, max: 20, hasSpace: true };
  } catch (error) {
    console.error('Error in checkGroupCapacity:', error);
    return { current: 0, max: 20, hasSpace: true };
  }
}

/**
 * Check if user is already in group
 */
async function isUserInGroup(userId, groupId) {
  try {
    if (db.isSupabase) {
      const { data: existing, error } = await db.supabase
        .from('group_members')
        .select('status')
        .eq('group_id', groupId)
        .eq('user_id', userId)
        .maybeSingle();
      
      if (error) return { inGroup: false, status: null };
      
      if (existing) {
        return { inGroup: true, status: existing.status };
      }
      
      return { inGroup: false, status: null };
    }
    return { inGroup: false, status: null };
  } catch (error) {
    console.error('Error in isUserInGroup:', error);
    return { inGroup: false, status: null };
  }
}

// ==================== PUBLIC ROUTES ====================

/**
 * GET /popular - Get popular groups (public)
 */
router.get('/popular', async (req, res) => {
  console.log('[GET /popular] Fetching popular groups');
  
  try {
    if (db.isSupabase) {
      // Get public groups
      const { data: groups, error } = await db.supabase
        .from('groups')
        .select(`
          id,
          name,
          description,
          game_specialty,
          visibility,
          max_members,
          created_at,
          created_by
        `)
        .or('visibility.eq.public,is_public.eq.true')
        .order('created_at', { ascending: false })
        .limit(10);
      
      if (error) {
        console.error('[GET /popular] Supabase error:', error);
        return res.json({ success: true, groups: [] });
      }
      
      // Get member counts and creator names
      const groupsWithDetails = await Promise.all((groups || []).map(async (group) => {
        // Get member count
        const { count } = await db.supabase
          .from('group_members')
          .select('*', { count: 'exact', head: true })
          .eq('group_id', group.id)
          .eq('status', 'joined');
        
        // Get creator name
        let creatorName = 'Unknown';
        if (group.created_by) {
          const { data: creator } = await db.supabase
            .from('users')
            .select('username, profile_pic, rank')
            .eq('id', group.created_by)
            .maybeSingle();
          
          if (creator) {
            creatorName = creator.username;
          }
        }
        
        return {
          id: group.id,
          name: group.name || 'Unnamed Group',
          description: group.description || '',
          game_specialty: group.game_specialty || 'Gaming',
          visibility: group.visibility || 'public',
          max_members: Number(group.max_members) || 20,
          member_count: count || 0,
          current_members: count || 0,
          created_at: group.created_at,
          creator_id: group.created_by,
          creator_name: creatorName,
          tournament_participations: 0,
          tournament_wins: 0,
          is_member: false
        };
      }));
      
      res.json({ success: true, groups: groupsWithDetails });
    } else {
      res.json({ success: true, groups: [] });
    }
  } catch (error) {
    console.error('[GET /popular] Error:', error);
    res.status(200).json({ success: true, groups: [] });
  }
});

/**
 * GET /discover - Get discover groups (public)
 */
router.get('/discover', async (req, res) => {
  console.log('[GET /discover] Fetching discover groups');
  
  try {
    // Get user ID from token if exists (for filtering)
    const token = req.headers.authorization?.split(' ')[1];
    let userId = null;
    
    if (token) {
      try {
        const jwt = require('jsonwebtoken');
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
        userId = decoded.id;
      } catch (jwtError) {
        console.log('[GET /discover] Invalid token, treating as guest');
      }
    }
    
    if (db.isSupabase) {
      // Get public groups
      const { data: groups, error } = await db.supabase
        .from('groups')
        .select(`
          id,
          name,
          description,
          game_specialty,
          visibility,
          max_members,
          created_at,
          created_by
        `)
        .or('visibility.eq.public,is_public.eq.true')
        .order('created_at', { ascending: false })
        .limit(20);
      
      if (error) {
        console.error('[GET /discover] Supabase error:', error);
        return res.json({ success: true, groups: [] });
      }
      
      // Get groups the user is already a member of (if logged in)
      let userGroupIds = [];
      if (userId) {
        const { data: userGroups, error: memberError } = await db.supabase
          .from('group_members')
          .select('group_id')
          .eq('user_id', userId)
          .in('status', ['joined', 'requested']);
        
        if (!memberError && userGroups) {
          userGroupIds = userGroups.map(ug => ug.group_id);
        }
      }
      
      // Process groups
      const processedGroups = await Promise.all((groups || []).map(async (group) => {
        // Skip groups user is already in
        if (userGroupIds.includes(group.id)) {
          return null;
        }
        
        // Get member count
        const { count } = await db.supabase
          .from('group_members')
          .select('*', { count: 'exact', head: true })
          .eq('group_id', group.id)
          .eq('status', 'joined');
        
        // Get creator name
        let creatorName = 'Unknown';
        if (group.created_by) {
          const { data: creator } = await db.supabase
            .from('users')
            .select('username')
            .eq('id', group.created_by)
            .maybeSingle();
          
          if (creator) {
            creatorName = creator.username;
          }
        }
        
        return {
          id: group.id,
          name: group.name || 'Unnamed Group',
          description: group.description || '',
          game_specialty: group.game_specialty || 'Gaming',
          visibility: group.visibility || 'public',
          max_members: Number(group.max_members) || 20,
          member_count: count || 0,
          current_members: count || 0,
          created_at: group.created_at,
          creator_id: group.created_by,
          creator_name: creatorName,
          is_member: false
        };
      }));
      
      const filteredGroups = processedGroups.filter(g => g !== null);
      res.json({ success: true, groups: filteredGroups });
    } else {
      res.json({ success: true, groups: [] });
    }
  } catch (error) {
    console.error('[GET /discover] Error:', error);
    res.status(200).json({ success: true, groups: [] });
  }
});

/**
 * GET /health - Health check
 */
router.get('/health', (req, res) => {
  res.json({ success: true, message: 'Groups API is healthy' });
});

/**
 * GET /debug-ping - Debug endpoint
 */
router.get('/debug-ping', (req, res) => {
  res.json({ success: true, message: 'PONG! Groups router is working' });
});

// ==================== PROTECTED ROUTES ====================

/**
 * GET /my-groups - Get current user's groups
 */
router.get('/my-groups', authenticateToken, async (req, res) => {
  console.log('[GET /my-groups] Fetching groups for user:', req.user.id);
  
  try {
    const userId = req.user.id;
    
    if (db.isSupabase) {
      // Get user's memberships
      const { data: memberships, error: memberError } = await db.supabase
        .from('group_members')
        .select('group_id, role, status, joined_at')
        .eq('user_id', userId)
        .eq('status', 'joined');
      
      if (memberError) {
        console.error('[GET /my-groups] Member error:', memberError);
        return res.json({ success: true, groups: [] });
      }
      
      if (!memberships || memberships.length === 0) {
        return res.json({ success: true, groups: [] });
      }
      
      // Get group IDs
      const groupIds = memberships.map(m => m.group_id);
      
      // Get group details
      const { data: groups, error: groupError } = await db.supabase
        .from('groups')
        .select('*')
        .in('id', groupIds);
      
      if (groupError) {
        console.error('[GET /my-groups] Group error:', groupError);
        return res.json({ success: true, groups: [] });
      }
      
      // Get creator names
      const creatorIds = [...new Set(groups.map(g => g.created_by).filter(Boolean))];
      let creatorMap = {};
      
      if (creatorIds.length > 0) {
        const { data: creators, error: creatorError } = await db.supabase
          .from('users')
          .select('id, username, profile_pic, rank')
          .in('id', creatorIds);
        
        if (!creatorError && creators) {
          creatorMap = creators.reduce((acc, creator) => {
            acc[creator.id] = creator;
            return acc;
          }, {});
        }
      }
      
      // Combine data
      const userGroups = groups.map(group => {
        const membership = memberships.find(m => m.group_id === group.id);
        const creator = creatorMap[group.created_by];
        
        return {
          id: group.id,
          name: group.name || 'Unnamed Group',
          description: group.description || '',
          game_specialty: group.game_specialty || group.game_name || 'Gaming',
          visibility: group.visibility || (group.is_public ? 'public' : 'private'),
          max_members: Number(group.max_members) || 20,
          member_count: Number(group.current_members) || 0,
          current_members: Number(group.current_members) || 0,
          created_at: group.created_at,
          creator_id: group.created_by,
          creator_name: creator?.username || 'Unknown',
          creator_profile_pic: creator?.profile_pic || null,
          creator_rank: creator?.rank || 'E',
          role: membership?.role || 'member',
          status: membership?.status || 'joined',
          joined_at: membership?.joined_at,
          is_member: true,
          tournament_participations: 0,
          tournament_wins: 0
        };
      });
      
      res.json({ success: true, groups: userGroups });
    } else {
      res.json({ success: true, groups: [] });
    }
  } catch (error) {
    console.error('[GET /my-groups] Error:', error);
    res.status(200).json({ success: true, groups: [] });
  }
});

/**
 * POST /create - Create a new group
 */
router.post('/create', authenticateToken, async (req, res) => {
  console.log('[POST /create] Creating new group for user:', req.user.id);
  
  try {
    const { name, game_specialty, description, max_members = 20, visibility = 'public' } = req.body;
    
    if (!name || !game_specialty) {
      return res.status(400).json({ 
        success: false, 
        message: 'Name and game specialty are required' 
      });
    }
    
    if (db.isSupabase) {
      // Check if user exists
      const { data: user, error: userError } = await db.supabase
        .from('users')
        .select('id, username, profile_pic, rank')
        .eq('id', req.user.id)
        .maybeSingle();
      
      if (userError || !user) {
        return res.status(404).json({ 
          success: false, 
          message: 'User account not found' 
        });
      }
      
      // Check for duplicate group name
      const { data: existingGroup, error: checkError } = await db.supabase
        .from('groups')
        .select('id, name')
        .ilike('name', name)
        .maybeSingle();
      
      if (existingGroup) {
        return res.status(400).json({ 
          success: false, 
          message: `A group with the name "${name}" already exists.`
        });
      }
      
      // Create the group
      const groupData = {
        name,
        created_by: req.user.id,
        game_specialty,
        description: description || '',
        max_members,
        current_members: 1,
        is_public: visibility === 'public',
        visibility,
        game_name: game_specialty
      };
      
      const { data: newGroup, error: createError } = await db.supabase
        .from('groups')
        .insert([groupData])
        .select()
        .single();
      
      if (createError) {
        console.error('Error creating group:', createError);
        throw createError;
      }
      
      const groupId = newGroup.id;
      
      // Add creator as admin
      const memberData = {
        group_id: groupId,
        user_id: req.user.id,
        username: user.username,
        role: 'admin',
        status: 'joined',
        joined_at: new Date().toISOString()
      };
      
      const { error: memberError } = await db.supabase
        .from('group_members')
        .insert([memberData]);
      
      if (memberError) {
        console.error('Error adding creator as admin:', memberError);
        // Rollback - delete the group
        await db.supabase.from('groups').delete().eq('id', groupId);
        return res.status(500).json({
          success: false,
          message: 'Failed to add you as group admin. Please try again.'
        });
      }
      
      // Create welcome message
      try {
        await db.supabase
          .from('group_chat')
          .insert([{
            group_id: groupId,
            user_id: req.user.id,
            message: `SYSTEM: ${user.username} created the group!`,
            created_at: new Date().toISOString()
          }]);
      } catch (chatError) {
        console.error('Error creating welcome message:', chatError);
      }
      
      res.json({
        success: true,
        message: 'Group created successfully!',
        group_id: groupId,
        group: {
          id: groupId,
          name,
          description: description || '',
          game_specialty,
          visibility,
          max_members,
          current_members: 1,
          created_by: req.user.id,
          creator_name: user.username,
          creator_profile_pic: user.profile_pic,
          creator_rank: user.rank,
          is_member: true,
          role: 'admin'
        }
      });
    } else {
      res.status(500).json({ success: false, message: 'Database not configured' });
    }
  } catch (error) {
    console.error('[POST /create] Error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to create group. Please try again.'
    });
  }
});

/**
 * GET /:groupId - Get group details
 */
router.get('/:groupId', authenticateToken, async (req, res) => {
  console.log(`[GET /:groupId] Fetching group ${req.params.groupId} for user ${req.user.id}`);
  
  try {
    const { groupId } = req.params;
    const userId = req.user.id;
    
    if (db.isSupabase) {
      // Get the group
      const { data: group, error: groupError } = await db.supabase
        .from('groups')
        .select('*')
        .eq('id', groupId)
        .maybeSingle();
      
      if (groupError) {
        console.error('Error fetching group:', groupError);
        return res.status(500).json({ 
          success: false, 
          message: 'Database error fetching group' 
        });
      }
      
      if (!group) {
        return res.status(404).json({ 
          success: false, 
          message: 'Group not found' 
        });
      }
      
      // Check if user can view (manual check)
      const canView = await canViewGroup(userId, groupId);
      if (!canView) {
        return res.status(403).json({ 
          success: false, 
          message: 'You do not have permission to view this group' 
        });
      }
      
      // Get creator info
      let creatorName = 'Unknown';
      let creatorProfilePic = null;
      
      if (group.created_by) {
        const { data: creator, error: creatorError } = await db.supabase
          .from('users')
          .select('username, profile_pic')
          .eq('id', group.created_by)
          .maybeSingle();
        
        if (!creatorError && creator) {
          creatorName = creator.username;
          creatorProfilePic = creator.profile_pic;
        }
      }
      
      // Get members
      const { data: members, error: memberError } = await db.supabase
        .from('group_members')
        .select('*')
        .eq('group_id', groupId);
      
      if (memberError) {
        console.error('Error fetching members:', memberError);
      }
      
      // Get member details
      let membersWithDetails = [];
      if (members && members.length > 0) {
        const userIds = members.map(m => m.user_id).filter(Boolean);
        
        if (userIds.length > 0) {
          const { data: userDetails, error: userError } = await db.supabase
            .from('users')
            .select('id, username, profile_pic, rank')
            .in('id', userIds);
          
          if (!userError && userDetails) {
            const userMap = {};
            userDetails.forEach(u => { userMap[u.id] = u; });
            
            membersWithDetails = members.map(m => ({
              ...m,
              username: userMap[m.user_id]?.username || m.username || 'Unknown',
              profile_pic: userMap[m.user_id]?.profile_pic || null,
              rank: userMap[m.user_id]?.rank || 'E',
              is_creator: m.user_id === group.created_by
            }));
          } else {
            membersWithDetails = members.map(m => ({
              ...m,
              username: m.username || 'Unknown',
              is_creator: m.user_id === group.created_by
            }));
          }
        }
      }
      
      // Determine user's role
      let userRole = 'none';
      let isMember = false;
      
      if (group.created_by === userId) {
        userRole = 'owner';
        isMember = true;
      } else if (members) {
        const userMember = members.find(m => m.user_id === userId);
        if (userMember) {
          userRole = userMember.role || 'member';
          isMember = true;
        }
      }
      
      res.json({
        success: true,
        group: {
          id: group.id,
          name: group.name,
          description: group.description || '',
          game_specialty: group.game_specialty || group.game_name || 'General',
          visibility: group.visibility || (group.is_public ? 'public' : 'private'),
          max_members: Number(group.max_members) || 20,
          current_members: members?.filter(m => m.status === 'joined').length || 0,
          created_at: group.created_at,
          creator_id: group.created_by,
          creator_name: creatorName,
          creator_profile_pic: creatorProfilePic,
          tournament_participations: 0,
          tournament_wins: 0
        },
        members: membersWithDetails,
        userRole,
        isMember,
        can_edit: userRole === 'admin' || userRole === 'owner'
      });
    } else {
      res.status(500).json({ success: false, message: 'Database not configured' });
    }
  } catch (error) {
    console.error('[GET /:groupId] Error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to load group details',
      error: error.message 
    });
  }
});

/**
 * POST /:groupId/join - Join a group
 */
router.post('/:groupId/join', authenticateToken, async (req, res) => {
  console.log(`[POST /:groupId/join] User ${req.user.id} joining group ${req.params.groupId}`);
  
  try {
    const { groupId } = req.params;
    const userId = req.user.id;
    
    if (db.isSupabase) {
      // Check if group exists
      const { data: group, error: groupError } = await db.supabase
        .from('groups')
        .select('*')
        .eq('id', groupId)
        .maybeSingle();
      
      if (groupError || !group) {
        return res.status(404).json({ success: false, message: 'Group not found' });
      }
      
      // Check if already a member
      const { data: existing, error: existingError } = await db.supabase
        .from('group_members')
        .select('status')
        .eq('group_id', groupId)
        .eq('user_id', userId)
        .maybeSingle();
      
      if (existing) {
        return res.status(400).json({ 
          success: false, 
          message: existing.status === 'joined' 
            ? 'You are already a member of this group' 
            : `You already have a pending ${existing.status} for this group`
        });
      }
      
      // Check capacity
      const capacity = await checkGroupCapacity(groupId);
      if (!capacity.hasSpace) {
        return res.status(400).json({ 
          success: false, 
          message: 'Group has reached maximum capacity' 
        });
      }
      
      // Get user info
      const { data: user, error: userError } = await db.supabase
        .from('users')
        .select('username')
        .eq('id', userId)
        .maybeSingle();
      
      // Determine join type based on visibility
      const isPublic = group.visibility === 'public' || group.is_public === true;
      const status = isPublic ? 'joined' : 'requested';
      
      // Create membership
      const { error: insertError } = await db.supabase
        .from('group_members')
        .insert([{
          group_id: groupId,
          user_id: userId,
          username: user?.username,
          role: 'member',
          status,
          joined_at: status === 'joined' ? new Date().toISOString() : null
        }]);
      
      if (insertError) {
        console.error('Error joining group:', insertError);
        throw insertError;
      }
      
      // Update member count if joined
      if (status === 'joined') {
        await db.supabase
          .from('groups')
          .update({ current_members: (group.current_members || 0) + 1 })
          .eq('id', groupId);
      }
      
      // Create system message
      try {
        await db.supabase
          .from('group_chat')
          .insert([{
            group_id: groupId,
            user_id: 0,
            message: status === 'joined' 
              ? `SYSTEM: ${user?.username || 'A new member'} has joined the group!`
              : `SYSTEM: ${user?.username || 'A user'} has requested to join the group.`,
            created_at: new Date().toISOString()
          }]);
      } catch (chatError) {
        console.error('Error creating system message:', chatError);
      }
      
      res.json({ 
        success: true, 
        message: status === 'joined' ? 'Successfully joined the group!' : 'Join request sent. Waiting for admin approval.',
        status
      });
    } else {
      res.status(500).json({ success: false, message: 'Database not configured' });
    }
  } catch (error) {
    console.error('[POST /:groupId/join] Error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to join group',
      error: error.message 
    });
  }
});

/**
 * POST /:groupId/leave - Leave a group
 */
router.post('/:groupId/leave', authenticateToken, async (req, res) => {
  console.log(`[POST /:groupId/leave] User ${req.user.id} leaving group ${req.params.groupId}`);
  
  try {
    const { groupId } = req.params;
    const userId = req.user.id;
    
    if (db.isSupabase) {
      // Check if user is the creator
      const { data: group, error: groupError } = await db.supabase
        .from('groups')
        .select('created_by, current_members')
        .eq('id', groupId)
        .maybeSingle();
      
      if (groupError || !group) {
        return res.status(404).json({ success: false, message: 'Group not found' });
      }
      
      if (group.created_by === userId) {
        return res.status(400).json({ 
          success: false, 
          message: 'Group creator cannot leave. Transfer ownership or delete the group instead.' 
        });
      }
      
      // Get user info for message
      const { data: user } = await db.supabase
        .from('users')
        .select('username')
        .eq('id', userId)
        .maybeSingle();
      
      // Remove member
      const { error: deleteError } = await db.supabase
        .from('group_members')
        .delete()
        .eq('group_id', groupId)
        .eq('user_id', userId);
      
      if (deleteError) {
        console.error('Error leaving group:', deleteError);
        throw deleteError;
      }
      
      // Update member count
      await db.supabase
        .from('groups')
        .update({ current_members: Math.max(0, (group.current_members || 1) - 1) })
        .eq('id', groupId);
      
      // Create system message
      try {
        await db.supabase
          .from('group_chat')
          .insert([{
            group_id: groupId,
            user_id: 0,
            message: `SYSTEM: ${user?.username || 'A member'} has left the group.`,
            created_at: new Date().toISOString()
          }]);
      } catch (chatError) {
        console.error('Error creating system message:', chatError);
      }
      
      res.json({ success: true, message: 'Successfully left the group' });
    } else {
      res.status(500).json({ success: false, message: 'Database not configured' });
    }
  } catch (error) {
    console.error('[POST /:groupId/leave] Error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to leave group',
      error: error.message 
    });
  }
});

/**
 * GET /:groupId/members - Get group members
 */
router.get('/:groupId/members', authenticateToken, async (req, res) => {
  console.log(`[GET /:groupId/members] Fetching members for group ${req.params.groupId}`);
  
  try {
    const { groupId } = req.params;
    const userId = req.user.id;
    
    // Check if user can view this group
    const canView = await canViewGroup(userId, groupId);
    if (!canView) {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied: You do not have permission to view group members' 
      });
    }
    
    if (db.isSupabase) {
      const { data: members, error } = await db.supabase
        .from('group_members')
        .select('*')
        .eq('group_id', groupId)
        .eq('status', 'joined')
        .order('role', { ascending: false });
      
      if (error) {
        console.error('Error fetching members:', error);
        throw error;
      }
      
      // Get user details
      const membersWithDetails = await Promise.all((members || []).map(async (m) => {
        const { data: user } = await db.supabase
          .from('users')
          .select('username, profile_pic, rank')
          .eq('id', m.user_id)
          .maybeSingle();
        
        return {
          ...m,
          username: user?.username || m.username || 'Unknown',
          profile_pic: user?.profile_pic || null,
          rank: user?.rank || 'E'
        };
      }));
      
      res.json({ success: true, members: membersWithDetails });
    } else {
      res.status(500).json({ success: false, message: 'Database not configured' });
    }
  } catch (error) {
    console.error('[GET /:groupId/members] Error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to load group members',
      error: error.message 
    });
  }
});

/**
 * GET /search/query - Search groups
 */
router.get('/search/query', async (req, res) => {
  console.log(`[GET /search/query] Searching groups with query: "${req.query.q}"`);
  
  try {
    const { q } = req.query;
    
    if (!q || q.trim().length < 2) {
      return res.status(400).json({ 
        success: false, 
        message: 'Search query must be at least 2 characters' 
      });
    }
    
    const searchPattern = `%${q}%`;
    
    if (db.isSupabase) {
      const { data: groups, error } = await db.supabase
        .from('groups')
        .select(`
          id,
          name,
          description,
          game_specialty,
          visibility,
          max_members,
          created_at,
          created_by
        `)
        .or(`name.ilike.${searchPattern},game_specialty.ilike.${searchPattern},description.ilike.${searchPattern}`)
        .or('visibility.eq.public,is_public.eq.true')
        .order('created_at', { ascending: false })
        .limit(20);
      
      if (error) {
        console.error('Search error:', error);
        throw error;
      }
      
      // Get member counts and creator names
      const groupsWithDetails = await Promise.all((groups || []).map(async (group) => {
        const { count } = await db.supabase
          .from('group_members')
          .select('*', { count: 'exact', head: true })
          .eq('group_id', group.id)
          .eq('status', 'joined');
        
        let creatorName = 'Unknown';
        if (group.created_by) {
          const { data: creator } = await db.supabase
            .from('users')
            .select('username')
            .eq('id', group.created_by)
            .maybeSingle();
          if (creator) creatorName = creator.username;
        }
        
        return {
          id: group.id,
          name: group.name,
          description: group.description || '',
          game_specialty: group.game_specialty || 'General',
          visibility: group.visibility || 'public',
          max_members: group.max_members || 20,
          member_count: count || 0,
          created_at: group.created_at,
          creator_name: creatorName,
          is_member: false
        };
      }));
      
      res.json({ success: true, groups: groupsWithDetails });
    } else {
      res.json({ success: true, groups: [] });
    }
  } catch (error) {
    console.error('[GET /search/query] Error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Search failed',
      error: error.message 
    });
  }
});

module.exports = router;
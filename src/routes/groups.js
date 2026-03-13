const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

// ==================== HELPER FUNCTIONS ====================
console.log('🔥🔥🔥🔥🔥 GROUPS.JS IS BEING EXECUTED 🔥🔥🔥🔥🔥');
console.log('Time:', new Date().toISOString());
console.log('__dirname:', __dirname);
/**
 * Check if user has permission to view group details
 */
async function canViewGroup(userId, groupId) {
  try {
    if (db.isSupabase) {
      // Get group visibility
      const { data: group, error: groupError } = await db.supabase
        .from('groups')
        .select('visibility, is_public, created_by')
        .eq('id', groupId)
        .maybeSingle();
      
      if (groupError) {
        console.error('Supabase error in canViewGroup:', groupError);
        return false;
      }
      
      if (!group) return false;
      
      // Creator can always view
      if (group.created_by === userId) return true;
      
      // Check visibility
      const isPublic = group.visibility === 'public' || group.is_public === true;
      
      // Public groups can be viewed by anyone
      if (isPublic) return true;
      
      // Private groups require membership
      const { data: member, error: memberError } = await db.supabase
        .from('group_members')
        .select('id')
        .eq('group_id', groupId)
        .eq('user_id', userId)
        .eq('status', 'joined')
        .maybeSingle();
      
      if (memberError) {
        console.error('Supabase error checking membership:', memberError);
        return false;
      }
      
      return !!member;
    } else {
      // PostgreSQL fallback
      const groupResult = await db.query(
        'SELECT visibility, is_public, created_by FROM groups WHERE id = $1',
        [groupId]
      );
      
      const group = groupResult[0] || [];
      
      if (group.length === 0) return false;
      
      if (group[0].created_by === userId) return true;
      
      const isPublic = group[0].visibility === 'public' || group[0].is_public === true;
      
      if (isPublic) return true;
      
      const memberResult = await db.query(
        'SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2 AND status = $3',
        [groupId, userId, 'joined']
      );
      
      const member = memberResult[0] || [];
      return member.length > 0;
    }
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
      // Check if user is creator (owner)
      const { data: group, error: groupError } = await db.supabase
        .from('groups')
        .select('created_by')
        .eq('id', groupId)
        .maybeSingle();
      
      if (groupError) {
        console.error('Supabase error in getUserGroupRole:', groupError);
        return null;
      }
      
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
      
      if (memberError) {
        console.error('Supabase error checking membership role:', memberError);
        return null;
      }
      
      return membership?.role || null;
    } else {
      // PostgreSQL fallback
      const groupResult = await db.query(
        'SELECT created_by FROM groups WHERE id = $1',
        [groupId]
      );
      
      const group = groupResult[0] || [];
      
      if (group.length > 0 && group[0].created_by === userId) {
        return 'owner';
      }
      
      const membershipResult = await db.query(
        'SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2 AND status = $3',
        [groupId, userId, 'joined']
      );
      
      const membership = membershipResult[0] || [];
      return membership.length > 0 ? membership[0].role : null;
    }
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
      const { count: currentMembers, error: countError } = await db.supabase
        .from('group_members')
        .select('*', { count: 'exact', head: true })
        .eq('group_id', groupId)
        .eq('status', 'joined');
      
      if (countError) {
        console.error('Supabase error getting member count:', countError);
        throw countError;
      }
      
      // Get group max members
      const { data: group, error: groupError } = await db.supabase
        .from('groups')
        .select('max_members')
        .eq('id', groupId)
        .maybeSingle();
      
      if (groupError) {
        console.error('Supabase error getting group capacity:', groupError);
        throw groupError;
      }
      
      const max = group?.max_members || 20;
      const current = currentMembers || 0;
      
      return {
        current: current,
        max: max,
        hasSpace: current < max
      };
    } else {
      // PostgreSQL fallback
      const currentMembersResult = await db.query(
        'SELECT COUNT(*) AS count FROM group_members WHERE group_id = $1 AND status = $2',
        [groupId, 'joined']
      );
      
      const groupCapacityResult = await db.query(
        'SELECT max_members FROM groups WHERE id = $1',
        [groupId]
      );
      
      const currentMembers = currentMembersResult[0] || [];
      const groupCapacity = groupCapacityResult[0] || [];
      
      return {
        current: parseInt(currentMembers[0]?.count || 0),
        max: parseInt(groupCapacity[0]?.max_members || 20),
        hasSpace: parseInt(currentMembers[0]?.count || 0) < parseInt(groupCapacity[0]?.max_members || 20)
      };
    }
  } catch (error) {
    console.error('Error in checkGroupCapacity:', error);
    return {
      current: 0,
      max: 20,
      hasSpace: true
    };
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
      
      if (error) {
        console.error('Supabase error checking user in group:', error);
        return { inGroup: false, status: null };
      }
      
      if (existing) {
        return {
          inGroup: true,
          status: existing.status
        };
      }
      
      return { inGroup: false, status: null };
    } else {
      // PostgreSQL fallback
      const existingResult = await db.query(
        'SELECT status FROM group_members WHERE group_id = $1 AND user_id = $2',
        [groupId, userId]
      );
      
      const existing = existingResult[0] || [];
      
      if (existing.length > 0) {
        return {
          inGroup: true,
          status: existing[0].status
        };
      }
      
      return { inGroup: false, status: null };
    }
  } catch (error) {
    console.error('Error in isUserInGroup:', error);
    return { inGroup: false, status: null };
  }
}

// ==================== PUBLIC ROUTES (NO AUTH REQUIRED) ====================

// Get popular groups
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
          game_name,
          is_public,
          visibility,
          max_members,
          current_members,
          created_at,
          created_by
        `)
        .or('is_public.eq.true,visibility.eq.public')
        .order('current_members', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(10);
      
      if (error) {
        console.error('[GET /popular] Supabase error:', error);
        throw error;
      }
      
      if (!groups || groups.length === 0) {
        return res.json({ success: true, groups: [] });
      }
      
      // Get creator names
      const creatorIds = groups.map(g => g.created_by).filter(Boolean);
      let creatorMap = {};
      
      if (creatorIds.length > 0) {
        const { data: creators, error: creatorError } = await db.supabase
          .from('users')
          .select('id, username, profile_pic, rank')
          .in('id', creatorIds);
        
        if (creatorError) {
          console.error('[GET /popular] Error fetching creators:', creatorError);
        } else if (creators) {
          creatorMap = creators.reduce((acc, creator) => {
            acc[creator.id] = creator;
            return acc;
          }, {});
        }
      }
      
      // Format groups
      const groupsWithDetails = (groups || []).map((group) => {
        const creator = creatorMap[group.created_by];
        const visibilityStr = group.visibility || (group.is_public ? 'public' : 'private');
        
        return {
          id: group.id,
          name: group.name || 'Unnamed Group',
          description: group.description || '',
          game_specialty: group.game_specialty || group.game_name || 'General',
          visibility: visibilityStr,
          max_members: Number(group.max_members) || 20,
          current_members: Number(group.current_members) || 0,
          created_at: group.created_at,
          creator_id: group.created_by,
          creator_name: creator?.username || 'Unknown',
          creator_profile_pic: creator?.profile_pic || null,
          creator_rank: creator?.rank || 'E',
          member_count: Number(group.current_members) || 0,
          tournament_participations: 0,
          tournament_wins: 0,
          is_member: false
        };
      });
      
      res.json({ success: true, groups: groupsWithDetails });
    } else {
      // PostgreSQL fallback
      const result = await db.query(`
        SELECT 
          g.id,
          g.name,
          g.description,
          COALESCE(g.game_specialty, g.game_name, 'General') AS game_specialty,
          COALESCE(g.visibility, CASE WHEN g.is_public THEN 'public' ELSE 'private' END) AS visibility,
          g.max_members,
          g.current_members AS member_count,
          g.created_at,
          g.created_by AS creator_id,
          u.username AS creator_name,
          u.profile_pic AS creator_profile_pic,
          u.rank AS creator_rank
        FROM groups g
        LEFT JOIN users u ON g.created_by = u.id
        WHERE g.is_public = true OR g.visibility = 'public'
        ORDER BY g.current_members DESC, g.created_at DESC
        LIMIT 10
      `);
      
      const rows = result[0] || [];
      
      const groups = rows.map(group => ({
        id: group.id || 0,
        name: group.name || 'Unnamed Group',
        description: group.description || '',
        game_specialty: group.game_specialty || 'General',
        visibility: group.visibility || 'public',
        max_members: Number(group.max_members) || 20,
        member_count: Number(group.member_count) || 0,
        current_members: Number(group.member_count) || 0,
        created_at: group.created_at || new Date().toISOString(),
        creator_id: group.creator_id || 0,
        creator_name: group.creator_name || 'Unknown',
        creator_profile_pic: group.creator_profile_pic || null,
        creator_rank: group.creator_rank || 'E',
        tournament_participations: 0,
        tournament_wins: 0,
        is_member: false
      }));
      
      res.json({ success: true, groups });
    }
  } catch (error) {
    console.error('[GET /popular] Error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Discover groups
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
          game_name,
          visibility,
          is_public,
          max_members,
          current_members,
          created_at,
          created_by
        `)
        .or('visibility.eq.public,is_public.eq.true')
        .order('created_at', { ascending: false })
        .limit(20);
      
      if (error) {
        console.error('[GET /discover] Supabase error:', error);
        throw error;
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
        
        // Get creator name
        let creatorName = 'Unknown';
        if (group.created_by) {
          const { data: creator, error: creatorError } = await db.supabase
            .from('users')
            .select('username')
            .eq('id', group.created_by)
            .maybeSingle();
          
          if (!creatorError && creator) {
            creatorName = creator.username;
          }
        }
        
        return {
          id: group.id,
          name: group.name || 'Unnamed Group',
          description: group.description || '',
          game_specialty: group.game_specialty || group.game_name || 'General',
          visibility: group.visibility || (group.is_public ? 'public' : 'private'),
          max_members: Number(group.max_members) || 20,
          current_members: Number(group.current_members) || 0,
          created_at: group.created_at,
          creator_id: group.created_by,
          creator_name: creatorName,
          member_count: Number(group.current_members) || 0,
          is_member: false
        };
      }));
      
      const filteredGroups = processedGroups.filter(g => g !== null);
      res.json({ success: true, groups: filteredGroups });
    } else {
      // PostgreSQL fallback
      let baseQuery = `
        SELECT 
          g.id,
          g.name,
          g.description,
          g.game_specialty,
          g.visibility,
          g.max_members,
          g.current_members AS member_count,
          g.created_at,
          g.created_by AS creator_id,
          COALESCE(u.username, 'Unknown') AS creator_name
        FROM groups g
        LEFT JOIN users u ON g.created_by = u.id
        WHERE g.visibility = 'public' OR g.is_public = true
      `;
      
      let queryParams = [];
      
      if (userId) {
        baseQuery += ` AND g.id NOT IN (
          SELECT group_id FROM group_members 
          WHERE user_id = $1 AND status IN ('joined', 'requested')
        )`;
        queryParams.push(userId);
      }
      
      baseQuery += ' ORDER BY g.created_at DESC LIMIT 20';
      
      const result = await db.query(baseQuery, queryParams);
      const rows = result[0] || [];
      
      const groups = rows.map(group => ({
        id: group.id || 0,
        name: group.name || 'Unnamed Group',
        description: group.description || '',
        game_specialty: group.game_specialty || 'General',
        visibility: group.visibility || 'public',
        max_members: Number(group.max_members) || 20,
        member_count: Number(group.member_count) || 0,
        created_at: group.created_at || new Date().toISOString(),
        creator_id: group.creator_id || 0,
        creator_name: group.creator_name || 'Unknown',
        is_member: false
      }));
      
      res.json({ success: true, groups });
    }
  } catch (error) {
    console.error('[GET /discover] Error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error',
      error: error.message 
    });
  }
});

// Health check
router.get('/health', (req, res) => {
  res.json({ success: true, message: 'Groups API is healthy' });
});

// Debug ping
router.get('/debug-ping', (req, res) => {
  res.json({ success: true, message: 'PONG! Groups router is working' });
});

// ==================== PROTECTED ROUTES (require authentication) ====================

// Get user's groups
router.get('/my-groups', authenticateToken, async (req, res) => {
  console.log('[GET /my-groups] Fetching groups for user:', req.user.id);
  
  try {
    if (db.isSupabase) {
      // Get user's memberships
      const { data: memberships, error: memberError } = await db.supabase
        .from('group_members')
        .select('group_id, role, status, joined_at')
        .eq('user_id', req.user.id)
        .eq('status', 'joined');
      
      if (memberError) {
        console.error('[GET /my-groups] Member error:', memberError);
        throw memberError;
      }
      
      if (!memberships || memberships.length === 0) {
        return res.json({ success: true, groups: [] });
      }
      
      // Get group details
      const groupIds = memberships.map(m => m.group_id);
      const { data: groups, error: groupError } = await db.supabase
        .from('groups')
        .select('*')
        .in('id', groupIds);
      
      if (groupError) {
        console.error('[GET /my-groups] Group error:', groupError);
        throw groupError;
      }
      
      // Get creator names
      const creatorIds = groups.map(g => g.created_by).filter(Boolean);
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
        const visibilityStr = group.visibility || (group.is_public ? 'public' : 'private');
        
        return {
          id: group.id,
          name: group.name,
          description: group.description || '',
          game_specialty: group.game_specialty || group.game_name || 'General',
          visibility: visibilityStr,
          max_members: group.max_members || 20,
          current_members: group.current_members || 0,
          created_at: group.created_at,
          creator_id: group.created_by,
          creator_name: creator?.username || 'Unknown',
          creator_profile_pic: creator?.profile_pic || null,
          creator_rank: creator?.rank || 'E',
          member_count: group.current_members || 0,
          role: membership?.role || 'member',
          status: membership?.status || 'joined',
          joined_at: membership?.joined_at,
          is_member: true
        };
      });
      
      res.json({ success: true, groups: userGroups });
    } else {
      // PostgreSQL fallback
      const result = await db.query(`
        SELECT 
          g.*,
          gm.role,
          gm.status,
          gm.joined_at,
          COALESCE(u.username, 'Unknown') AS creator_name,
          u.profile_pic AS creator_profile_pic,
          u.rank AS creator_rank
        FROM groups g
        INNER JOIN group_members gm ON g.id = gm.group_id
        LEFT JOIN users u ON g.created_by = u.id
        WHERE gm.user_id = $1 AND gm.status = 'joined'
        ORDER BY g.created_at DESC
      `, [req.user.id]);
      
      const rows = result[0] || [];
      
      const groups = rows.map(group => ({
        id: group.id,
        name: group.name,
        description: group.description || '',
        game_specialty: group.game_specialty || group.game_name || 'General',
        visibility: group.visibility || (group.is_public ? 'public' : 'private'),
        max_members: group.max_members || 20,
        current_members: group.current_members || 0,
        created_at: group.created_at,
        creator_id: group.created_by,
        creator_name: group.creator_name || 'Unknown',
        creator_profile_pic: group.creator_profile_pic || null,
        creator_rank: group.creator_rank || 'E',
        member_count: group.current_members || 0,
        role: group.role || 'member',
        status: group.status || 'joined',
        joined_at: group.joined_at,
        is_member: true
      }));
      
      res.json({ success: true, groups });
    }
  } catch (error) {
    console.error('[GET /my-groups] Error:', error);
    res.status(200).json({ 
      success: true, 
      groups: [],
      message: 'Could not load groups, but continuing with empty list'
    });
  }
});

// Create a new group
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
      // PostgreSQL fallback
      // Check if user exists
      const userResult = await db.query(
        'SELECT id, username, profile_pic, rank FROM users WHERE id = $1',
        [req.user.id]
      );
      
      const userRows = userResult[0] || [];
      
      if (userRows.length === 0) {
        return res.status(404).json({ 
          success: false, 
          message: 'User account not found' 
        });
      }
      
      const user = userRows[0];
      
      // Check for duplicate
      const existingResult = await db.query(
        'SELECT id, name FROM groups WHERE LOWER(name) = LOWER($1)',
        [name]
      );
      
      const existingRows = existingResult[0] || [];
      
      if (existingRows.length > 0) {
        return res.status(400).json({ 
          success: false, 
          message: `A group with the name "${name}" already exists.`
        });
      }
      
      // Create group
      const insertResult = await db.query(
        `INSERT INTO groups 
          (name, created_by, game_specialty, description, max_members, is_public, current_members, game_name, visibility) 
         VALUES 
          ($1, $2, $3, $4, $5, $6, $7, $8, $9) 
         RETURNING id`,
        [name, req.user.id, game_specialty, description || '', max_members, visibility === 'public', 1, game_specialty, visibility]
      );
      
      const groupId = insertResult[0]?.[0]?.id;
      
      if (!groupId) {
        throw new Error('Failed to get group ID');
      }
      
      // Add creator as admin
      await db.query(
        `INSERT INTO group_members (group_id, user_id, username, role, status, joined_at) 
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        [groupId, req.user.id, user.username, 'admin', 'joined']
      );
      
      // Create welcome message
      await db.query(
        `INSERT INTO group_chat (group_id, user_id, message, created_at) 
         VALUES ($1, $2, $3, NOW())`,
        [groupId, req.user.id, `SYSTEM: ${user.username} created the group!`]
      );
      
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
    }
  } catch (error) {
    console.error('[POST /create] Error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to create group. Please try again.'
    });
  }
});

// Get group details
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
      
      // Check if user can view
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
        .eq('group_id', groupId)
        .eq('status', 'joined');
      
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
              username: userMap[m.user_id]?.username || 'Unknown',
              profile_pic: userMap[m.user_id]?.profile_pic || null,
              rank: userMap[m.user_id]?.rank || 'E',
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
          current_members: members?.length || 0,
          created_at: group.created_at,
          creator_id: group.created_by,
          creator_name: creatorName,
          creator_profile_pic: creatorProfilePic
        },
        members: membersWithDetails,
        userRole,
        isMember,
        can_edit: userRole === 'admin' || userRole === 'owner'
      });
    } else {
      // PostgreSQL fallback
      const result = await db.query('SELECT * FROM groups WHERE id = $1', [groupId]);
      const group = result[0]?.[0];
      
      if (!group) {
        return res.status(404).json({ success: false, message: 'Group not found' });
      }
      
      // Check if user can view
      const canView = await canViewGroup(userId, groupId);
      if (!canView) {
        return res.status(403).json({ success: false, message: 'Access denied' });
      }
      
      // Get creator info
      let creatorName = 'Unknown';
      if (group.created_by) {
        const creatorResult = await db.query('SELECT username FROM users WHERE id = $1', [group.created_by]);
        if (creatorResult[0]?.[0]) {
          creatorName = creatorResult[0][0].username;
        }
      }
      
      // Get members
      const memberResult = await db.query(`
        SELECT gm.*, u.username, u.profile_pic, u.rank
        FROM group_members gm
        LEFT JOIN users u ON gm.user_id = u.id
        WHERE gm.group_id = $1 AND gm.status = 'joined'
      `, [groupId]);
      
      const members = memberResult[0] || [];
      
      // Determine user role
      let userRole = 'none';
      let isMember = false;
      
      if (group.created_by === userId) {
        userRole = 'owner';
        isMember = true;
      } else {
        const userMember = members.find(m => m.user_id === userId);
        if (userMember) {
          userRole = userMember.role;
          isMember = true;
        }
      }
      
      res.json({
        success: true,
        group: {
          ...group,
          creator_name: creatorName,
          member_count: members.length
        },
        members: members.map(m => ({ ...m, is_creator: m.user_id === group.created_by })),
        userRole,
        isMember,
        can_edit: userRole === 'admin' || userRole === 'owner'
      });
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

// Join group
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
      // PostgreSQL fallback
      const groupResult = await db.query('SELECT * FROM groups WHERE id = $1', [groupId]);
      const group = groupResult[0] || [];
      
      if (group.length === 0) {
        return res.status(404).json({ success: false, message: 'Group not found' });
      }
      
      const groupData = group[0];
      
      const existingResult = await db.query(
        'SELECT status FROM group_members WHERE group_id = $1 AND user_id = $2',
        [groupId, userId]
      );
      
      const existing = existingResult[0] || [];
      
      if (existing.length > 0) {
        return res.status(400).json({ 
          success: false, 
          message: existing[0].status === 'joined' 
            ? 'You are already a member' 
            : `You already have a pending ${existing[0].status}`
        });
      }
      
      const capacity = await checkGroupCapacity(groupId);
      if (!capacity.hasSpace) {
        return res.status(400).json({ success: false, message: 'Group is full' });
      }
      
      const userResult = await db.query('SELECT username FROM users WHERE id = $1', [userId]);
      const username = userResult[0]?.[0]?.username || 'User';
      
      const isPublic = groupData.visibility === 'public' || groupData.is_public === true;
      const status = isPublic ? 'joined' : 'requested';
      
      await db.query(
        'INSERT INTO group_members (group_id, user_id, username, role, status, joined_at) VALUES ($1, $2, $3, $4, $5, $6)',
        [groupId, userId, username, 'member', status, status === 'joined' ? new Date() : null]
      );
      
      if (status === 'joined') {
        await db.query(
          'UPDATE groups SET current_members = current_members + 1 WHERE id = $1',
          [groupId]
        );
      }
      
      await db.query(
        'INSERT INTO group_chat (group_id, user_id, message, created_at) VALUES ($1, $2, $3, NOW())',
        [groupId, 0, status === 'joined' 
          ? `SYSTEM: ${username} has joined the group!`
          : `SYSTEM: ${username} has requested to join the group.`
        ]
      );
      
      res.json({ 
        success: true, 
        message: status === 'joined' ? 'Successfully joined group!' : 'Join request sent!',
        status
      });
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

// Leave group
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
      // PostgreSQL fallback
      const groupResult = await db.query('SELECT created_by FROM groups WHERE id = $1', [groupId]);
      const group = groupResult[0] || [];
      
      if (group.length === 0) {
        return res.status(404).json({ success: false, message: 'Group not found' });
      }
      
      if (group[0].created_by === userId) {
        return res.status(400).json({ 
          success: false, 
          message: 'Group creator cannot leave.' 
        });
      }
      
      const userResult = await db.query('SELECT username FROM users WHERE id = $1', [userId]);
      const username = userResult[0]?.[0]?.username || 'A member';
      
      await db.query('DELETE FROM group_members WHERE group_id = $1 AND user_id = $2', [groupId, userId]);
      
      await db.query('UPDATE groups SET current_members = current_members - 1 WHERE id = $1', [groupId]);
      
      await db.query(
        'INSERT INTO group_chat (group_id, user_id, message, created_at) VALUES ($1, $2, $3, NOW())',
        [groupId, 0, `SYSTEM: ${username} has left the group.`]
      );
      
      res.json({ success: true, message: 'Successfully left the group' });
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

// Get group members
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
        .select(`
          *,
          users:user_id (
            username,
            profile_pic,
            rank,
            created_at
          )
        `)
        .eq('group_id', groupId)
        .eq('status', 'joined')
        .order('role', { ascending: false });
      
      if (error) {
        console.error('Error fetching members:', error);
        throw error;
      }
      
      const formattedMembers = (members || []).map(m => ({
        ...m,
        username: m.users?.username,
        profile_pic: m.users?.profile_pic,
        rank: m.users?.rank,
        user_created_at: m.users?.created_at
      }));
      
      res.json({ success: true, members: formattedMembers });
    } else {
      const result = await db.query(`
        SELECT 
          gm.*, 
          u.username, 
          u.profile_pic, 
          u.rank,
          u.created_at AS user_created_at
        FROM group_members gm
        LEFT JOIN users u ON gm.user_id = u.id
        WHERE gm.group_id = $1 AND gm.status = 'joined'
        ORDER BY 
          CASE gm.role 
            WHEN 'admin' THEN 1 
            WHEN 'moderator' THEN 2
            ELSE 3 
          END,
          gm.created_at
      `, [groupId]);
      
      const members = result[0] || [];
      res.json({ success: true, members });
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

// Search groups
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
          is_public,
          max_members,
          current_members,
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
      
      // Get creator names
      const groupsWithDetails = await Promise.all((groups || []).map(async (group) => {
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
          visibility: group.visibility || (group.is_public ? 'public' : 'private'),
          max_members: group.max_members || 20,
          member_count: group.current_members || 0,
          created_at: group.created_at,
          creator_name: creatorName,
          is_member: false
        };
      }));
      
      res.json({ success: true, groups: groupsWithDetails });
    } else {
      const result = await db.query(`
        SELECT 
          g.*,
          COALESCE(u.username, 'Unknown') AS creator_name
        FROM groups g
        LEFT JOIN users u ON g.created_by = u.id
        WHERE (g.name ILIKE $1 OR g.game_specialty ILIKE $2 OR g.description ILIKE $3)
        AND (g.visibility = 'public' OR g.is_public = true)
        ORDER BY g.created_at DESC
        LIMIT 20
      `, [searchPattern, searchPattern, searchPattern]);
      
      const rows = result[0] || [];
      
      const groups = rows.map(group => ({
        id: group.id,
        name: group.name,
        description: group.description || '',
        game_specialty: group.game_specialty || 'General',
        visibility: group.visibility || (group.is_public ? 'public' : 'private'),
        max_members: group.max_members || 20,
        member_count: group.current_members || 0,
        created_at: group.created_at,
        creator_name: group.creator_name || 'Unknown',
        is_member: false
      }));
      
      res.json({ success: true, groups });
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
console.log('✅ GROUPS ROUTES REGISTERED:');
console.log('   - GET /debug-ping');
console.log('   - GET /popular');
console.log('   - GET /discover');
console.log('   - GET /my-groups');
console.log('   - POST /create');
module.exports = router;
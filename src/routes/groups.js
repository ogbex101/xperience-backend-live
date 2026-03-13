const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

// ==================== HELPER FUNCTIONS ====================

/**
 * Check if user has permission to view group details
 */
/**
 * Check if user has permission to view group details
 */
async function canViewGroup(userId, groupId) {
  try {
    if (db.isSupabase) {
      // Get group visibility - using correct column names
      const { data: group, error: groupError } = await db.supabase
        .from('groups')
        .select('visibility, is_public')
        .eq('id', groupId)
        .maybeSingle();
      
      if (groupError) {
        console.error('Supabase error in canViewGroup:', groupError);
        return false;
      }
      
      if (!group) return false;
      
      // Check visibility (using either visibility string or is_public boolean)
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
        'SELECT visibility, is_public FROM groups WHERE id = $1',
        [groupId]
      );
      
      const group = groupResult[0] || [];
      
      if (group.length === 0) return false;
      
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
/**
 * Get user's role in group
 */
async function getUserGroupRole(userId, groupId) {
  if (!userId) return null;
  
  try {
    if (db.isSupabase) {
      // Check if user is creator (owner) - using created_by
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
 * Check if user is already in group (joined or requested)
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
// SUPER SIMPLE DEBUG - Add this at the top of your routes
router.get('/debug/simple/:groupId', async (req, res) => {
  try {
    const { groupId } = req.params;
    
    console.log('🔍 SIMPLE DEBUG for group:', groupId);
    
    // Try with admin client first
    if (db.supabaseAdmin) {
      const { data, error } = await db.supabaseAdmin
        .from('groups')
        .select('*')
        .eq('id', groupId);
      
      return res.json({
        method: 'admin_client',
        data,
        error,
        note: 'Check if the group exists and what columns are available'
      });
    }
    
    // Try with regular client
    const { data, error } = await db.supabase
      .from('groups')
      .select('*')
      .eq('id', groupId);
    
    res.json({
      method: 'regular_client',
      data,
      error,
      note: 'Check if the group exists and what columns are available'
    });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
// ==================== PUBLIC ROUTES (NO AUTH REQUIRED) ====================

router.get('/popular', async (req, res) => {
  console.log('[GET /popular] Fetching popular groups');
  
  try {
    if (!db.isSupabase) {
      return res.status(500).json({ success: false, message: 'Database not configured' });
    }

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
      .or('visibility.eq.public,is_public.eq.true')
      .order('current_members', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(10);
    
    if (error) {
      console.error('[GET /popular] Error:', error);
      return res.status(500).json({ success: false, message: 'Database error' });
    }
    
    // Get creator names
    const groupsWithCreators = await Promise.all((groups || []).map(async (group) => {
      let creatorName = 'Unknown';
      if (group.created_by) {
        const { data: user } = await db.supabase
          .from('users')
          .select('username')
          .eq('id', group.created_by)
          .maybeSingle();
        if (user) creatorName = user.username;
      }
      
      return {
        ...group,
        creator_name: creatorName,
        member_count: group.current_members || 0
      };
    }));
    
    res.json({ success: true, groups: groupsWithCreators });
    
  } catch (error) {
    console.error('[GET /popular] Error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});
// Discover groups (public groups)
router.get('/discover', async (req, res) => {
  console.log('[GET /discover] Fetching discover groups');
  
  try {
    // Get user ID from token if exists
    const token = req.headers.authorization?.split(' ')[1];
    let userId = null;
    
    if (token) {
      try {
        const jwt = require('jsonwebtoken');
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
        userId = decoded.id;
      } catch (jwtError) {
        console.log('[GET /discover] Invalid token, treating as guest');
        userId = null;
      }
    }
    
    if (db.isSupabase) {
      // Get all public groups
      const { data: groups, error } = await db.supabase
        .from('groups')
        .select('*')
        .eq('visibility', 'public')
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
      
      // Process groups with creator names and member counts
      const processedGroups = [];
      
      for (const group of groups || []) {
        // Skip groups user is already in
        if (userGroupIds.includes(group.id)) {
          continue;
        }
        
        // Get creator name
        let creatorName = 'Unknown';
        if (group.creator_id) {
          const { data: creator, error: creatorError } = await db.supabase
            .from('users')
            .select('username')
            .eq('id', group.creator_id)
            .maybeSingle();
          
          if (!creatorError && creator) {
            creatorName = creator.username;
          }
        }
        
        // Get member count
        const { count: memberCount, error: countError } = await db.supabase
          .from('group_members')
          .select('*', { count: 'exact', head: true })
          .eq('group_id', group.id)
          .eq('status', 'joined');
        
        if (countError) {
          console.error(`Error getting member count for group ${group.id}:`, countError);
        }
        
        processedGroups.push({
          id: group.id || 0,
          name: group.name || 'Unnamed Group',
          description: group.description || '',
          game_specialty: group.game_specialty || 'General',
          visibility: group.visibility || 'public',
          max_members: Number(group.max_members) || 20,
          created_at: group.created_at || new Date().toISOString(),
          creator_id: group.creator_id || 0,
          creator_name: creatorName,
          member_count: Number(memberCount) || 0,
          tournament_participations: 0,
          tournament_wins: 0
        });
      }
      
      console.log(`[GET /discover] Returning ${processedGroups.length} groups for user ${userId || 'guest'}`);
      res.json({ success: true, groups: processedGroups });
      
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
          g.created_at,
          g.creator_id,
          COALESCE(u.username, 'Unknown') AS creator_name,
          COALESCE(gm.member_count, 0) AS member_count,
          COALESCE(gt.tournament_count, 0) AS tournament_participations,
          COALESCE(gt.win_count, 0) AS tournament_wins
        FROM groups g
        LEFT JOIN users u ON g.creator_id = u.id
        LEFT JOIN (
          SELECT group_id, COUNT(*) AS member_count
          FROM group_members
          WHERE status = 'joined'
          GROUP BY group_id
        ) gm ON g.id = gm.group_id
        LEFT JOIN (
          SELECT 
            gt.group_id,
            COUNT(*) AS tournament_count,
            SUM(CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END) AS win_count
          FROM group_tournaments gt
          LEFT JOIN tournaments t ON gt.tournament_id = t.id
          GROUP BY gt.group_id
        ) gt ON g.id = gt.group_id
        WHERE g.visibility = 'public'
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
      
      const processedGroups = rows.map(group => ({
        id: group.id || 0,
        name: group.name || 'Unnamed Group',
        description: group.description || '',
        game_specialty: group.game_specialty || 'General',
        visibility: group.visibility || 'public',
        max_members: Number(group.max_members) || 20,
        created_at: group.created_at || new Date().toISOString(),
        creator_id: group.creator_id || 0,
        creator_name: group.creator_name || 'Unknown',
        member_count: Number(group.member_count) || 0,
        tournament_participations: Number(group.tournament_participations) || 0,
        tournament_wins: Number(group.tournament_wins) || 0
      }));
      
      console.log(`[GET /discover] Returning ${processedGroups.length} groups for user ${userId || 'guest'}`);
      res.json({ success: true, groups: processedGroups });
    }
    
  } catch (error) {
    console.error('[GET /discover] Error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error',
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// ==================== ROUTES WITH AUTHORIZATION ====================

// Create a new group - WITH DUPLICATE HANDLING
router.post('/create', async (req, res) => {
  console.log('=== CREATE GROUP START ===');
  
  try {
    const body = req.body || {};
    console.log('Body received:', JSON.stringify(body, null, 2));
    
    const name = (body.name || '').toString().trim();
    const game_specialty = (body.game_specialty || '').toString().trim();
    const description = (body.description || '').toString().trim();
    const max_members = parseInt(body.max_members) || 20;
    const is_public = body.visibility !== 'private'; // true for public, false for private
    
    console.log('Parsed values:', {
      name: `"${name}"`,
      game_specialty: `"${game_specialty}"`,
      description: `"${description}"`,
      max_members,
      is_public,
      user_id: req.user.id
    });
    
    if (!name) {
      return res.status(400).json({ 
        success: false, 
        message: 'Group name is required' 
      });
    }
    
    if (!game_specialty) {
      return res.status(400).json({ 
        success: false, 
        message: 'Game specialty is required' 
      });
    }
    
    if (db.isSupabase) {
      // Check if user exists
      const { data: user, error: userError } = await db.supabase
        .from('users')
        .select('id, username, profile_pic, rank')
        .eq('id', req.user.id)
        .maybeSingle();
      
      if (userError) {
        console.error('Error checking user:', userError);
        return res.status(500).json({ 
          success: false, 
          message: 'Error verifying user account' 
        });
      }
      
      if (!user) {
        console.log('User not found in database');
        return res.status(404).json({ 
          success: false, 
          message: 'User account not found' 
        });
      }
      
      console.log('User verified:', user.username);
      
      // Check for duplicate group name
      const { data: existingGroup, error: checkError } = await db.supabase
        .from('groups')
        .select('id, name')
        .ilike('name', name)
        .maybeSingle();
      
      if (checkError) {
        console.error('Error checking duplicate:', checkError);
      }
      
      if (existingGroup) {
        console.log('❌ Duplicate group name found. Existing group:', existingGroup);
        
        const suggestions = [
          `${name} ${user.username}'s Squad`,
          `${name} Elite`,
          `${name} Warriors`,
          `Team ${name}`,
          `${name} ${Math.floor(Math.random() * 1000)}`
        ];
        
        return res.status(400).json({ 
          success: false, 
          message: `A group with the name "${name}" already exists.`,
          suggestions: suggestions,
          duplicate_id: existingGroup.id
        });
      }
      
      console.log('✅ No duplicate found, proceeding with creation');
      
      // Create the group with correct column names from your schema
      const groupData = {
        name: name,
        created_by: req.user.id,
        game_specialty: game_specialty,
        description: description,
        max_members: max_members,
        is_public: is_public,
        current_members: 1, // Start with 1 member (the creator)
        game_name: game_specialty, // Also set game_name for compatibility
        visibility: is_public ? 'public' : 'private' // Set visibility string for backward compatibility
      };
      
      console.log('Inserting group with data:', groupData);
      
      // Try using the service role client to bypass RLS if needed
      let newGroup;
      let createError;
      
      if (db.supabaseAdmin) {
        // Use admin client to bypass RLS
        console.log('Using admin client to bypass RLS...');
        const result = await db.supabaseAdmin
          .from('groups')
          .insert([groupData])
          .select()
          .single();
        
        newGroup = result.data;
        createError = result.error;
      } else {
        // Use regular client
        const result = await db.supabase
          .from('groups')
          .insert([groupData])
          .select()
          .single();
        
        newGroup = result.data;
        createError = result.error;
      }
      
      if (createError) {
        console.error('Error creating group:', createError);
        
        // If RLS error, try with a minimal set of fields
        if (createError.code === '42501') {
          console.log('RLS policy violation, trying minimal insert...');
          
          const minimalData = {
            name: name,
            created_by: req.user.id,
            game_specialty: game_specialty,
            is_public: is_public
          };
          
          const minimalResult = await db.supabase
            .from('groups')
            .insert([minimalData])
            .select()
            .single();
          
          if (minimalResult.error) {
            console.error('Minimal insert also failed:', minimalResult.error);
            throw minimalResult.error;
          }
          
          newGroup = minimalResult.data;
        } else {
          throw createError;
        }
      }
      
      const groupId = newGroup.id;
      console.log('✅ Group created with ID:', groupId);
      
      // Add creator as admin to group_members
      console.log('Adding creator as admin...');
      
      const memberData = {
        group_id: groupId,
        user_id: req.user.id,
        username: user.username, // Store username for quick access
        role: 'admin',
        status: 'joined',
        joined_at: new Date().toISOString()
      };
      
      let memberError;
      
      if (db.supabaseAdmin) {
        // Use admin client to bypass RLS
        const result = await db.supabaseAdmin
          .from('group_members')
          .insert([memberData]);
        
        memberError = result.error;
      } else {
        // Use regular client
        const result = await db.supabase
          .from('group_members')
          .insert([memberData]);
        
        memberError = result.error;
      }
      
      if (memberError) {
        console.error('Error adding creator as admin:', memberError);
        
        // If we couldn't add the member, we should probably delete the group
        // to avoid orphaned groups
        console.log('Attempting to rollback - deleting created group...');
        
        if (db.supabaseAdmin) {
          await db.supabaseAdmin
            .from('groups')
            .delete()
            .eq('id', groupId);
        } else {
          await db.supabase
            .from('groups')
            .delete()
            .eq('id', groupId);
        }
        
        return res.status(500).json({
          success: false,
          message: 'Failed to add you as group admin. Please try again.'
        });
      }
      
      console.log('✅ Creator added as admin');
      
      // Create a welcome message in group chat
      try {
        const chatMessage = {
          group_id: groupId,
          user_id: req.user.id,
          message: `SYSTEM: ${user.username} created the group!`,
          created_at: new Date().toISOString()
        };
        
        if (db.supabaseAdmin) {
          await db.supabaseAdmin
            .from('group_chat')
            .insert([chatMessage]);
        } else {
          await db.supabase
            .from('group_chat')
            .insert([chatMessage]);
        }
        
        console.log('✅ Welcome message created');
      } catch (chatError) {
        console.error('Error creating welcome message:', chatError);
        // Non-critical, continue
      }
      
      // Update the group's current_members count if needed
      try {
        if (db.supabaseAdmin) {
          await db.supabaseAdmin
            .from('groups')
            .update({ current_members: 1 })
            .eq('id', groupId);
        }
      } catch (updateError) {
        console.error('Error updating member count:', updateError);
        // Non-critical, continue
      }
      
      console.log('=== ✅ GROUP CREATION COMPLETE ===');
      
      // Return the created group data
      res.json({
        success: true,
        message: 'Group created successfully!',
        group_id: groupId,
        group_name: name,
        group: {
          id: groupId,
          name: name,
          description: description,
          game_specialty: game_specialty,
          visibility: is_public ? 'public' : 'private',
          max_members: max_members,
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
      console.log('[POST /create] Using PostgreSQL fallback');
      
      try {
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
          const suggestions = [
            `${name} ${user.username}'s Squad`,
            `${name} Elite`,
            `${name} Warriors`,
            `Team ${name}`,
            `${name} ${Math.floor(Math.random() * 1000)}`
          ];
          
          return res.status(400).json({ 
            success: false, 
            message: `A group with the name "${name}" already exists.`,
            suggestions: suggestions,
            duplicate_id: existingRows[0].id
          });
        }
        
        // Create group
        const insertResult = await db.query(
          `INSERT INTO groups 
            (name, created_by, game_specialty, description, max_members, is_public, current_members, game_name, visibility) 
           VALUES 
            ($1, $2, $3, $4, $5, $6, $7, $8, $9) 
           RETURNING id`,
          [name, req.user.id, game_specialty, description, max_members, is_public, 1, game_specialty, is_public ? 'public' : 'private']
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
          group_name: name,
          group: {
            id: groupId,
            name: name,
            description: description,
            game_specialty: game_specialty,
            visibility: is_public ? 'public' : 'private',
            max_members: max_members,
            current_members: 1,
            created_by: req.user.id,
            creator_name: user.username,
            creator_profile_pic: user.profile_pic,
            creator_rank: user.rank,
            is_member: true,
            role: 'admin'
          }
        });
      } catch (pgError) {
        console.error('PostgreSQL error:', pgError);
        throw pgError;
      }
    }
    
  } catch (error) {
    console.error('=== ❌ CREATE GROUP ERROR ===');
    console.error('Error message:', error.message);
    console.error('Error code:', error.code);
    console.error('Error stack:', error.stack);
    
    let userMessage = 'Failed to create group. Please try again.';
    let statusCode = 500;
    
    if (error.code === '42501') {
      userMessage = 'Permission denied. Please check your account permissions.';
      statusCode = 403;
    } else if (error.code === '23505') {
      userMessage = 'A group with this name already exists. Please choose a different name.';
      statusCode = 400;
    } else if (error.code === '23503') {
      userMessage = 'Invalid user account. Please log in again.';
      statusCode = 401;
    } else if (error.code === '23502') {
      userMessage = 'Missing required information. Please fill all required fields.';
      statusCode = 400;
    } else if (error.code === '42P17') {
      userMessage = 'Database policy error. Please contact support.';
      statusCode = 500;
    }
    
    res.status(statusCode).json({ 
      success: false, 
      message: userMessage,
      technical: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});
// PUBLIC DEBUG ENDPOINT - No authentication required
router.get('/debug/public/group/:groupId', async (req, res) => {
  try {
    const { groupId } = req.params;
    
    console.log('🔍 PUBLIC DEBUG: Checking group with ID:', groupId);
    console.log('Supabase available:', !!db.supabase);
    console.log('SupabaseAdmin available:', !!db.supabaseAdmin);
    
    if (!db.isSupabase) {
      return res.json({ 
        message: 'Not in Supabase mode',
        isSupabase: false 
      });
    }
    
    // Try with admin client first (bypasses RLS)
    if (db.supabaseAdmin) {
      console.log('Trying with admin client...');
      
      const { data: adminData, error: adminError } = await db.supabaseAdmin
        .from('groups')
        .select('*')
        .eq('id', groupId)
        .maybeSingle();
      
      console.log('Admin client result:', { 
        found: !!adminData,
        error: adminError 
      });
      
      if (adminData) {
        return res.json({
          success: true,
          method: 'admin_client',
          group: adminData,
          group_exists: true
        });
      }
    }
    
    // Try with regular client
    console.log('Trying with regular client...');
    
    const { data: regularData, error: regularError } = await db.supabase
      .from('groups')
      .select('*')
      .eq('id', groupId)
      .maybeSingle();
    
    console.log('Regular client result:', { 
      found: !!regularData,
      error: regularError 
    });
    
    // Try to list all groups (maybe the ID is wrong)
    console.log('Trying to list all groups...');
    const { data: allGroups, error: listError } = await db.supabase
      .from('groups')
      .select('id, name')
      .limit(5);
    
    console.log('All groups (first 5):', allGroups);
    
    res.json({
      success: true,
      debug_info: {
        groupId,
        isSupabase: db.isSupabase,
        hasAdminClient: !!db.supabaseAdmin,
        hasRegularClient: !!db.supabase,
      },
      admin_result: adminData ? { found: true, group: adminData } : { found: false, error: adminError },
      regular_result: regularData ? { found: true, group: regularData } : { found: false, error: regularError },
      all_groups: allGroups || [],
      list_error: listError
    });
    
  } catch (error) {
    console.error('Public debug endpoint error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message,
      stack: error.stack
    });
  }
});
// Get user's groups
router.get('/my-groups', async (req, res) => {
  console.log('[GET /my-groups] Fetching groups for user:', req.user.id);
  
  try {
    if (db.isSupabase) {
      console.log('Fetching groups for user using direct query...');
      
      // Instead of querying group_members first (which has RLS recursion),
      // let's get groups directly using the admin client if available
      
      let groups = [];
      
      if (db.supabaseAdmin) {
        // Use admin client to bypass RLS completely
        console.log('Using admin client to bypass RLS...');
        
        // First get the group IDs from group_members using admin client
        const { data: memberships, error: memberError } = await db.supabaseAdmin
          .from('group_members')
          .select('group_id, role, status, joined_at')
          .eq('user_id', req.user.id)
          .eq('status', 'joined');
        
        if (memberError) {
          console.error('Admin client error getting memberships:', memberError);
          throw memberError;
        }
        
        console.log(`Found ${memberships?.length || 0} memberships via admin client`);
        
        if (!memberships || memberships.length === 0) {
          return res.json({ success: true, groups: [] });
        }
        
        // Get group details
        const groupIds = memberships.map(m => m.group_id);
        
        const { data: groupsData, error: groupError } = await db.supabaseAdmin
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
            updated_at,
            created_by
          `)
          .in('id', groupIds);
        
        if (groupError) {
          console.error('Admin client error getting groups:', groupError);
          throw groupError;
        }
        
        // Get creator names
        const creatorIds = groupsData.map(g => g.created_by).filter(Boolean);
        let creatorMap = {};
        
        if (creatorIds.length > 0) {
          const { data: creators, error: creatorError } = await db.supabaseAdmin
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
        groups = groupsData.map(group => {
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
            role: membership?.role || 'member',
            status: membership?.status || 'joined',
            joined_at: membership?.joined_at || group.created_at,
            member_count: group.current_members || 0,
            tournament_count: 0,
            win_count: 0,
            tournament_participations: 0,
            tournament_wins: 0,
            is_member: true
          };
        });
        
      } else {
        // No admin client, try a different approach with regular client
        console.log('No admin client, trying alternative query...');
        
        // Try a raw SQL query if available
        try {
          // Get groups where user is a member using a different method
          // This is a workaround for the RLS recursion
          const { data: userGroups, error } = await db.supabase
            .rpc('get_user_groups', {
              user_uuid: req.user.id
            });
          
          if (!error && userGroups) {
            groups = userGroups;
          } else {
            console.log('RPC failed, trying fallback...');
            
            // Fallback: get all groups and filter manually? Not efficient but works for now
            const { data: allGroups, error: allError } = await db.supabase
              .from('groups')
              .select('*')
              .limit(50); // Reasonable limit
            
            if (!allError && allGroups) {
              // Get user's memberships in a separate query
              const { data: memberships, error: memberError } = await db.supabase
                .from('group_members')
                .select('group_id, role, status, joined_at')
                .eq('user_id', req.user.id);
              
              if (!memberError && memberships) {
                const membershipMap = memberships.reduce((acc, m) => {
                  acc[m.group_id] = m;
                  return acc;
                }, {});
                
                groups = allGroups
                  .filter(g => membershipMap[g.id])
                  .map(g => ({
                    ...g,
                    role: membershipMap[g.id]?.role,
                    status: membershipMap[g.id]?.status,
                    joined_at: membershipMap[g.id]?.joined_at,
                    creator_name: 'Unknown',
                    is_member: true
                  }));
              }
            }
          }
        } catch (rpcError) {
          console.error('Alternative approach failed:', rpcError);
        }
      }
      
      console.log(`[GET /my-groups] Returning ${groups.length} groups for user ${req.user.id}`);
      res.json({ success: true, groups: groups || [] });
      
    } else {
      // PostgreSQL fallback
      console.log('[GET /my-groups] Using PostgreSQL fallback');
      
      try {
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
        
        const safeGroups = rows.map(group => ({
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
          role: group.role || 'member',
          status: group.status || 'joined',
          joined_at: group.joined_at || group.created_at,
          member_count: group.current_members || 0,
          tournament_count: 0,
          win_count: 0,
          tournament_participations: 0,
          tournament_wins: 0,
          is_member: true
        }));
        
        console.log(`[GET /my-groups] Returning ${safeGroups.length} groups for user ${req.user.id}`);
        res.json({ success: true, groups: safeGroups });
      } catch (pgError) {
        console.error('[GET /my-groups] PostgreSQL error:', pgError);
        throw pgError;
      }
    }
    
  } catch (error) {
    console.error('[GET /my-groups] Error:', error);
    console.error('Error code:', error.code);
    console.error('Error message:', error.message);
    
    // Return empty array instead of failing
    res.status(200).json({ 
      success: true, 
      groups: [],
      message: 'Could not load groups, but continuing with empty list',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});
// Add this temporary debug endpoint to check your schema
router.get('/debug/schema', async (req, res) => {
  try {
    if (db.isSupabase) {
      // Try to get one row to see the structure
      const { data: group, error: groupError } = await db.supabase
        .from('groups')
        .select('*')
        .limit(1);
      
      if (groupError) {
        return res.json({ 
          error: 'Could not access groups table',
          message: groupError.message,
          hint: 'Check if table name is correct (case sensitive?)'
        });
      }
      
      // Try to get user table structure
      const { data: user, error: userError } = await db.supabase
        .from('users')
        .select('*')
        .limit(1);
      
      res.json({
        group_sample: group,
        group_columns: group && group.length > 0 ? Object.keys(group[0]) : 'No groups found',
        user_sample: user,
        user_columns: user && user.length > 0 ? Object.keys(user[0]) : 'No users found',
        note: 'Check the column names above - they must match exactly what you use in your queries'
      });
    } else {
      res.json({ message: 'Not in Supabase mode' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get group details - COMPLETELY REWRITTEN
router.get('/:groupId', async (req, res) => {
  console.log(`[GET /:groupId] Fetching group ${req.params.groupId} for user ${req.user.id}`);
  
  try {
    const { groupId } = req.params;
    const userId = req.user.id;
    
    if (db.isSupabase) {
      // USE ADMIN CLIENT TO BYPASS ALL RLS ISSUES
      if (!db.supabaseAdmin) {
        return res.status(500).json({ 
          success: false, 
          message: 'Server configuration error - no admin client' 
        });
      }
      
      console.log('Using admin client to fetch group details');
      
      // STEP 1: Get the group
      const { data: group, error: groupError } = await db.supabaseAdmin
        .from('groups')
        .select('*')
        .eq('id', groupId)
        .maybeSingle();
      
      if (groupError) {
        console.error('Error fetching group:', groupError);
        return res.status(500).json({ 
          success: false, 
          message: 'Database error fetching group',
          error: groupError.message 
        });
      }
      
      if (!group) {
        return res.status(404).json({ 
          success: false, 
          message: 'Group not found' 
        });
      }
      
      console.log('Group found:', group.id, group.name);
      
      // STEP 2: Get creator info
      let creatorName = 'Unknown';
      let creatorProfilePic = null;
      
      if (group.created_by) {
        const { data: creator, error: creatorError } = await db.supabaseAdmin
          .from('users')
          .select('username, profile_pic')
          .eq('id', group.created_by)
          .maybeSingle();
        
        if (!creatorError && creator) {
          creatorName = creator.username;
          creatorProfilePic = creator.profile_pic;
        }
      }
      
      // STEP 3: Get member count
      const { count: memberCount, error: countError } = await db.supabaseAdmin
        .from('group_members')
        .select('*', { count: 'exact', head: true })
        .eq('group_id', groupId)
        .eq('status', 'joined');
      
      if (countError) {
        console.error('Error counting members:', countError);
      }
      
      // STEP 4: Determine user's role
      let userRole = 'none';
      let isMember = false;
      
      // Check if user is the creator
      if (group.created_by === userId) {
        userRole = 'owner';
        isMember = true;
      } else {
        // Check membership
        const { data: membership, error: memberError } = await db.supabaseAdmin
          .from('group_members')
          .select('role, status')
          .eq('group_id', groupId)
          .eq('user_id', userId)
          .maybeSingle();
        
        if (!memberError && membership) {
          if (membership.status === 'joined') {
            userRole = membership.role || 'member';
            isMember = true;
          } else if (membership.status === 'requested') {
            userRole = 'requested';
          } else if (membership.status === 'invited') {
            userRole = 'invited';
          }
        }
      }
      
      // STEP 5: Get members list (only if user is a member)
      let members = [];
      
      if (isMember) {
        // Get all member records
        const { data: memberRecords, error: memberError } = await db.supabaseAdmin
          .from('group_members')
          .select('*')
          .eq('group_id', groupId);
        
        if (!memberError && memberRecords && memberRecords.length > 0) {
          // Get user details for all members
          const userIds = memberRecords.map(m => m.user_id).filter(Boolean);
          
          if (userIds.length > 0) {
            const { data: userDetails, error: userError } = await db.supabaseAdmin
              .from('users')
              .select('id, username, profile_pic, rank, wins, losses, win_rate, created_at')
              .in('id', userIds);
            
            if (!userError && userDetails) {
              // Create user map
              const userMap = {};
              userDetails.forEach(u => {
                userMap[u.id] = u;
              });
              
              // Combine data
              members = memberRecords.map(m => ({
                id: m.id,
                user_id: m.user_id,
                username: userMap[m.user_id]?.username || 'Unknown',
                profile_pic: userMap[m.user_id]?.profile_pic || 'default.png',
                rank: userMap[m.user_id]?.rank || 'E',
                role: m.role,
                status: m.status,
                joined_at: m.joined_at || m.created_at,
                wins: userMap[m.user_id]?.wins || 0,
                losses: userMap[m.user_id]?.losses || 0,
                win_rate: parseFloat(userMap[m.user_id]?.win_rate) || 0,
                user_created_at: userMap[m.user_id]?.created_at,
                is_creator: m.user_id === group.created_by
              }));
            }
          }
        }
      }
      
      // STEP 6: Prepare response
      const response = {
        success: true,
        group: {
          id: group.id,
          name: group.name,
          description: group.description || '',
          game_specialty: group.game_specialty || group.game_name || 'General',
          visibility: group.visibility || (group.is_public ? 'public' : 'private'),
          max_members: Number(group.max_members) || 20,
          current_members: memberCount || 0,
          created_at: group.created_at,
          creator_id: group.created_by,
          creator_name: creatorName,
          creator_profile_pic: creatorProfilePic,
          member_count: memberCount || 0,
          tournament_participations: 0,
          tournament_wins: 0
        },
        members: members,
        recent_messages: [],
        userRole: userRole,
        isMember: isMember,
        can_edit: userRole === 'admin' || userRole === 'owner'
      };
      
      console.log(`✅ Returning group ${groupId} with ${members.length} members`);
      res.json(response);
      
    } else {
      // PostgreSQL fallback
      const result = await db.query(
        'SELECT * FROM groups WHERE id = $1',
        [groupId]
      );
      
      const group = result[0]?.[0];
      
      if (!group) {
        return res.status(404).json({ success: false, message: 'Group not found' });
      }
      
      // Get creator info
      let creatorName = 'Unknown';
      if (group.created_by) {
        const creatorResult = await db.query(
          'SELECT username FROM users WHERE id = $1',
          [group.created_by]
        );
        if (creatorResult[0]?.[0]) {
          creatorName = creatorResult[0][0].username;
        }
      }
      
      // Get member count
      const countResult = await db.query(
        'SELECT COUNT(*) as count FROM group_members WHERE group_id = $1 AND status = $2',
        [groupId, 'joined']
      );
      const memberCount = parseInt(countResult[0]?.[0]?.count || 0);
      
      // Determine user role
      let userRole = 'none';
      let isMember = false;
      
      if (group.created_by === userId) {
        userRole = 'owner';
        isMember = true;
      } else {
        const memberResult = await db.query(
          'SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2 AND status = $3',
          [groupId, userId, 'joined']
        );
        if (memberResult[0]?.[0]) {
          userRole = memberResult[0][0].role;
          isMember = true;
        }
      }
      
      // Get members
      let members = [];
      if (isMember) {
        const memberResult = await db.query(`
          SELECT gm.*, u.username, u.profile_pic, u.rank
          FROM group_members gm
          LEFT JOIN users u ON gm.user_id = u.id
          WHERE gm.group_id = $1
        `, [groupId]);
        members = (memberResult[0] || []).map(m => ({
          ...m,
          is_creator: m.user_id === group.created_by
        }));
      }
      
      res.json({
        success: true,
        group: {
          ...group,
          creator_name: creatorName,
          member_count: memberCount
        },
        members,
        recent_messages: [],
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

// Get group members
router.get('/:groupId/members', async (req, res) => {
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
        console.error('Supabase error in /members:', error);
        throw error;
      }
      
      const formattedMembers = (members || []).map(m => ({
        ...m,
        username: m.users?.username,
        profile_pic: m.users?.profile_pic,
        rank: m.users?.rank,
        user_created_at: m.users?.created_at
      }));
      
      res.json({ 
        success: true, 
        members: formattedMembers,
        count: formattedMembers.length
      });
      
    } else {
      // PostgreSQL fallback
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
      
      res.json({ 
        success: true, 
        members: members,
        count: members.length
      });
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
// TEMPORARY DEBUG ENDPOINT - Add this to your group.js
router.get('/debug/group/:groupId', async (req, res) => {
  try {
    const { groupId } = req.params;
    const token = req.headers.authorization?.split(' ')[1];
    
    console.log('🔍 DEBUG: Checking group with ID:', groupId);
    
    let supabase = db.supabase;
    if (db.createAuthenticatedClient && token) {
      supabase = db.createAuthenticatedClient(token);
    }
    
    // Test 1: Try to get the group with a very simple query
    console.log('Test 1: Simple select');
    const { data: simpleData, error: simpleError } = await supabase
      .from('groups')
      .select('*')
      .eq('id', groupId);
    
    console.log('Simple query result:', { 
      hasData: !!simpleData, 
      dataLength: simpleData?.length,
      error: simpleError 
    });
    
    // Test 2: Try using maybeSingle()
    console.log('Test 2: Using maybeSingle()');
    const { data: singleData, error: singleError } = await supabase
      .from('groups')
      .select('*')
      .eq('id', groupId)
      .maybeSingle();
    
    console.log('maybeSingle result:', { 
      hasData: !!singleData, 
      data: singleData,
      error: singleError 
    });
    
    // Test 3: Try with a different column (maybe id is not the primary key?)
    console.log('Test 3: Try selecting only id');
    const { data: idData, error: idError } = await supabase
      .from('groups')
      .select('id')
      .eq('id', groupId);
    
    console.log('ID only result:', { 
      hasData: !!idData, 
      data: idData,
      error: idError 
    });
    
    // Test 4: Try to get any row from groups (no filter)
    console.log('Test 4: Get first row from groups');
    const { data: anyData, error: anyError } = await supabase
      .from('groups')
      .select('*')
      .limit(1);
    
    console.log('Any row result:', { 
      hasData: !!anyData, 
      data: anyData,
      error: anyError 
    });
    
    // Return all test results
    res.json({
      success: true,
      groupId,
      tests: {
        simple: { data: simpleData, error: simpleError },
        maybeSingle: { data: singleData, error: singleError },
        idOnly: { data: idData, error: idError },
        anyRow: { data: anyData, error: anyError }
      }
    });
    
  } catch (error) {
    console.error('Debug endpoint error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Check group access
router.get('/:groupId/check-access', async (req, res) => {
  try {
    const { groupId } = req.params;
    const userId = req.user.id;
    
    const canView = await canViewGroup(userId, groupId);
    
    if (!canView) {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied' 
      });
    }
    
    res.json({ 
      success: true, 
      hasAccess: true,
      role: await getUserGroupRole(userId, groupId)
    });
    
  } catch (error) {
    console.error('[GET /:groupId/check-access] Error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error',
      error: error.message 
    });
  }
});

// Request to join group
router.post('/:groupId/request', async (req, res) => {
  console.log(`[POST /:groupId/request] User ${req.user.id} requesting to join group ${req.params.groupId}`);
  
  try {
    const { groupId } = req.params;
    const userId = req.user.id;
    
    if (db.isSupabase) {
      // Check if group exists
      const { data: group, error: groupError } = await db.supabase
        .from('groups')
        .select('id, name, visibility')
        .eq('id', groupId)
        .maybeSingle();
      
      if (groupError) {
        console.error('Supabase error checking group:', groupError);
        throw groupError;
      }
      
      if (!group) {
        return res.status(404).json({ 
          success: false, 
          message: 'Group not found' 
        });
      }
      
      if (group.visibility === 'private') {
        return res.status(403).json({ 
          success: false, 
          message: 'This is a private group. You need an invitation to join.' 
        });
      }
      
      // Check if already a member or has pending request
      const { data: existing, error: existingError } = await db.supabase
        .from('group_members')
        .select('status')
        .eq('group_id', groupId)
        .eq('user_id', userId)
        .maybeSingle();
      
      if (existingError) {
        console.error('Error checking existing membership:', existingError);
      }
      
      if (existing) {
        return res.status(400).json({ 
          success: false, 
          message: existing.status === 'joined' 
            ? 'You are already a member of this group'
            : 'You already have a pending request to join this group'
        });
      }
      
      // Check group capacity
      const capacity = await checkGroupCapacity(groupId);
      if (!capacity.hasSpace) {
        return res.status(400).json({ 
          success: false, 
          message: 'Group has reached maximum capacity' 
        });
      }
      
      // Get user info for notification
      const { data: user } = await db.supabase
        .from('users')
        .select('username')
        .eq('id', userId)
        .maybeSingle();
      
      // Create join request
      const { error: insertError } = await db.supabase
        .from('group_members')
        .insert([{
          group_id: groupId,
          user_id: userId,
          role: 'member',
          status: 'requested'
        }]);
      
      if (insertError) {
        console.error('Error creating join request:', insertError);
        throw insertError;
      }
      
      // Notify admins via system message
      try {
        await db.supabase
          .from('group_chat')
          .insert([{
            group_id: groupId,
            user_id: 0,
            message: `SYSTEM: ${user?.username || 'A user'} has requested to join the group.`
          }]);
      } catch (notificationError) {
        console.error('Error creating notification:', notificationError);
      }
      
      console.log(`[POST /:groupId/request] Join request created for user ${userId} to group ${groupId}`);
      res.json({ 
        success: true, 
        message: 'Join request sent. Waiting for admin approval.' 
      });
      
    } else {
      // PostgreSQL fallback
      const result = await db.query(
        'SELECT id, name, visibility FROM groups WHERE id = $1',
        [groupId]
      );
      
      const group = result[0] || [];
      
      if (group.length === 0) {
        return res.status(404).json({ 
          success: false, 
          message: 'Group not found' 
        });
      }
      
      if (group[0].visibility === 'private') {
        return res.status(403).json({ 
          success: false, 
          message: 'This is a private group. You need an invitation to join.' 
        });
      }
      
      const existingResult = await db.query(
        'SELECT * FROM group_members WHERE group_id = $1 AND user_id = $2',
        [groupId, userId]
      );
      
      const existing = existingResult[0] || [];
      
      if (existing.length > 0) {
        return res.status(400).json({ 
          success: false, 
          message: existing[0].status === 'joined' 
            ? 'You are already a member of this group'
            : 'You already have a pending request to join this group'
        });
      }
      
      const capacity = await checkGroupCapacity(groupId);
      if (!capacity.hasSpace) {
        return res.status(400).json({ 
          success: false, 
          message: 'Group has reached maximum capacity' 
        });
      }
      
      await db.query(
        'INSERT INTO group_members (group_id, user_id, role, status) VALUES ($1, $2, $3, $4)',
        [groupId, userId, 'member', 'requested']
      );
      
      try {
        const adminsResult = await db.query(
          'SELECT user_id FROM group_members WHERE group_id = $1 AND role = $2 AND status = $3',
          [groupId, 'admin', 'joined']
        );
        
        const admins = adminsResult[0] || [];
        
        for (const admin of admins) {
          await db.query(
            'INSERT INTO group_chat (group_id, user_id, message) VALUES ($1, $2, $3)',
            [groupId, 0, `SYSTEM: ${req.user.username} has requested to join the group.`]
          );
        }
      } catch (notificationError) {
        console.error('Error creating notifications:', notificationError);
      }
      
      console.log(`[POST /:groupId/request] Join request created for user ${userId} to group ${groupId}`);
      res.json({ 
        success: true, 
        message: 'Join request sent. Waiting for admin approval.' 
      });
    }
    
  } catch (error) {
    console.error('[POST /:groupId/request] Error:', error);
    
    if (error.code === '23505') {
      return res.status(400).json({ 
        success: false, 
        message: 'You already have a pending request for this group' 
      });
    }
    
    res.status(500).json({ 
      success: false, 
      message: 'Failed to send join request',
      error: error.message 
    });
  }
});

// Approve join request (Admin only)
router.post('/:groupId/approve/:userId', async (req, res) => {
  console.log(`[POST /:groupId/approve/:userId] Admin ${req.user.id} approving user ${req.params.userId} for group ${req.params.groupId}`);
  
  try {
    const { groupId, userId } = req.params;
    const adminId = req.user.id;
    
    // Check if admin is actually an admin
    const adminRole = await getUserGroupRole(adminId, groupId);
    if (!['admin', 'owner'].includes(adminRole)) {
      return res.status(403).json({ 
        success: false, 
        message: 'Only group admins can approve join requests' 
      });
    }
    
    if (db.isSupabase) {
      // Check if user has a pending request
      const { data: request, error: requestError } = await db.supabase
        .from('group_members')
        .select('*')
        .eq('group_id', groupId)
        .eq('user_id', userId)
        .eq('status', 'requested')
        .maybeSingle();
      
      if (requestError) {
        console.error('Error checking request:', requestError);
        throw requestError;
      }
      
      if (!request) {
        return res.status(404).json({ 
          success: false, 
          message: 'No pending join request found for this user' 
        });
      }
      
      // Check group capacity
      const capacity = await checkGroupCapacity(groupId);
      if (!capacity.hasSpace) {
        return res.status(400).json({ 
          success: false, 
          message: 'Group has reached maximum capacity' 
        });
      }
      
      // Update membership status to joined
      const { error: updateError } = await db.supabase
        .from('group_members')
        .update({ status: 'joined' })
        .eq('group_id', groupId)
        .eq('user_id', userId);
      
      if (updateError) {
        console.error('Error updating membership:', updateError);
        throw updateError;
      }
      
      // Get user info for notification
      const { data: user } = await db.supabase
        .from('users')
        .select('username')
        .eq('id', userId)
        .maybeSingle();
      
      // Create system message in group chat
      await db.supabase
        .from('group_chat')
        .insert([{
          group_id: groupId,
          user_id: 0,
          message: `SYSTEM: ${user?.username || 'New member'} has joined the group!`
        }]);
      
      console.log(`[POST /:groupId/approve/:userId] User ${userId} approved for group ${groupId}`);
      res.json({ 
        success: true, 
        message: 'Join request approved successfully' 
      });
      
    } else {
      // PostgreSQL fallback
      const result = await db.query(
        'SELECT * FROM group_members WHERE group_id = $1 AND user_id = $2 AND status = $3',
        [groupId, userId, 'requested']
      );
      
      const request = result[0] || [];
      
      if (request.length === 0) {
        return res.status(404).json({ 
          success: false, 
          message: 'No pending join request found for this user' 
        });
      }
      
      const capacity = await checkGroupCapacity(groupId);
      if (!capacity.hasSpace) {
        return res.status(400).json({ 
          success: false, 
          message: 'Group has reached maximum capacity' 
        });
      }
      
      await db.query(
        'UPDATE group_members SET status = $1 WHERE group_id = $2 AND user_id = $3',
        ['joined', groupId, userId]
      );
      
      const userResult = await db.query(
        'SELECT username FROM users WHERE id = $1',
        [userId]
      );
      
      const userInfo = userResult[0] || [];
      const username = userInfo[0]?.username || 'New member';
      
      await db.query(
        'INSERT INTO group_chat (group_id, user_id, message) VALUES ($1, $2, $3)',
        [groupId, 0, `SYSTEM: ${username} has joined the group!`]
      );
      
      console.log(`[POST /:groupId/approve/:userId] User ${userId} approved for group ${groupId}`);
      res.json({ 
        success: true, 
        message: 'Join request approved successfully' 
      });
    }
    
  } catch (error) {
    console.error('[POST /:groupId/approve/:userId] Error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to approve join request',
      error: error.message 
    });
  }
});

// Reject join request (Admin only)
router.post('/:groupId/reject/:userId', async (req, res) => {
  console.log(`[POST /:groupId/reject/:userId] Admin ${req.user.id} rejecting user ${req.params.userId} for group ${req.params.groupId}`);
  
  try {
    const { groupId, userId } = req.params;
    const adminId = req.user.id;
    
    // Check if admin is actually an admin
    const adminRole = await getUserGroupRole(adminId, groupId);
    if (!['admin', 'owner'].includes(adminRole)) {
      return res.status(403).json({ 
        success: false, 
        message: 'Only group admins can reject join requests' 
      });
    }
    
    if (db.isSupabase) {
      // Delete the join request
      const { data: deleted, error: deleteError } = await db.supabase
        .from('group_members')
        .delete()
        .eq('group_id', groupId)
        .eq('user_id', userId)
        .eq('status', 'requested')
        .select();
      
      if (deleteError) {
        console.error('Error rejecting request:', deleteError);
        throw deleteError;
      }
      
      if (!deleted || deleted.length === 0) {
        return res.status(404).json({ 
          success: false, 
          message: 'No pending join request found for this user' 
        });
      }
      
      console.log(`[POST /:groupId/reject/:userId] User ${userId} rejected from group ${groupId}`);
      res.json({ 
        success: true, 
        message: 'Join request rejected successfully' 
      });
      
    } else {
      // PostgreSQL fallback
      const result = await db.query(
        'DELETE FROM group_members WHERE group_id = $1 AND user_id = $2 AND status = $3 RETURNING *',
        [groupId, userId, 'requested']
      );
      
      const deleted = result[0] || [];
      
      if (deleted.length === 0) {
        return res.status(404).json({ 
          success: false, 
          message: 'No pending join request found for this user' 
        });
      }
      
      console.log(`[POST /:groupId/reject/:userId] User ${userId} rejected from group ${groupId}`);
      res.json({ 
        success: true, 
        message: 'Join request rejected successfully' 
      });
    }
    
  } catch (error) {
    console.error('[POST /:groupId/reject/:userId] Error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to reject join request',
      error: error.message 
    });
  }
});

// Direct join for public groups, request for private groups
router.post('/:groupId/join', async (req, res) => {
  console.log(`[POST /:groupId/join] User ${req.user.id} joining group ${req.params.groupId}`);
  
  try {
    const { groupId } = req.params;
    const userId = req.user.id;
    
    console.log('Join request:', { groupId, userId });
    
    if (db.isSupabase) {
      // Check if group exists
      const { data: group, error: groupError } = await db.supabase
        .from('groups')
        .select('id, name, visibility, max_members')
        .eq('id', groupId)
        .maybeSingle();
      
      if (groupError) {
        console.error('Supabase error checking group:', groupError);
        throw groupError;
      }
      
      if (!group) {
        return res.status(404).json({ 
          success: false, 
          message: 'Group not found' 
        });
      }
      
      // Check if already a member
      const { data: existing, error: existingError } = await db.supabase
        .from('group_members')
        .select('status')
        .eq('group_id', groupId)
        .eq('user_id', userId)
        .maybeSingle();
      
      if (existingError) {
        console.error('Error checking existing membership:', existingError);
      }
      
      if (existing) {
        const status = existing.status;
        if (status === 'joined') {
          return res.status(400).json({ 
            success: false, 
            message: 'You are already a member of this group' 
          });
        } else {
          return res.status(400).json({ 
            success: false, 
            message: `You already have a pending ${status} for this group` 
          });
        }
      }
      
      // Check group capacity
      const { count: currentMembers, error: countError } = await db.supabase
        .from('group_members')
        .select('*', { count: 'exact', head: true })
        .eq('group_id', groupId)
        .eq('status', 'joined');
      
      if (countError) {
        console.error('Error counting members:', countError);
      }
      
      if ((currentMembers || 0) >= (group.max_members || 20)) {
        return res.status(400).json({ 
          success: false, 
          message: 'Group has reached maximum capacity' 
        });
      }
      
      // Get user info
      const { data: user } = await db.supabase
        .from('users')
        .select('username')
        .eq('id', userId)
        .maybeSingle();
      
      if (group.visibility === 'private') {
        // For private groups, create a join request
        const { error: insertError } = await db.supabase
          .from('group_members')
          .insert([{
            group_id: groupId,
            user_id: userId,
            role: 'member',
            status: 'requested'
          }]);
        
        if (insertError) {
          console.error('Error creating join request:', insertError);
          throw insertError;
        }
        
        // Notify admins
        await db.supabase
          .from('group_chat')
          .insert([{
            group_id: groupId,
            user_id: 0,
            message: `SYSTEM: ${user?.username || 'User'} has requested to join the group.`
          }]);
        
        return res.json({ 
          success: true, 
          message: 'Join request sent. Waiting for admin approval.' 
        });
      } else {
        // For public groups, join directly
        const { error: insertError } = await db.supabase
          .from('group_members')
          .insert([{
            group_id: groupId,
            user_id: userId,
            role: 'member',
            status: 'joined'
          }]);
        
        if (insertError) {
          console.error('Error joining group:', insertError);
          throw insertError;
        }
        
        // Welcome message
        await db.supabase
          .from('group_chat')
          .insert([{
            group_id: groupId,
            user_id: 0,
            message: `SYSTEM: ${user?.username || 'New member'} has joined the group!`
          }]);
        
        return res.json({ 
          success: true, 
          message: 'Successfully joined the group!' 
        });
      }
      
    } else {
      // PostgreSQL fallback (existing code)
      const groupResult = await db.query(
        'SELECT id, name, visibility, max_members FROM groups WHERE id = $1',
        [groupId]
      );
      
      const group = groupResult[0] || [];
      
      if (group.length === 0) {
        return res.status(404).json({ 
          success: false, 
          message: 'Group not found' 
        });
      }
      
      const groupData = group[0];
      
      const existingResult = await db.query(
        'SELECT status FROM group_members WHERE group_id = $1 AND user_id = $2',
        [groupId, userId]
      );
      
      const existing = existingResult[0] || [];
      
      if (existing.length > 0) {
        const status = existing[0].status;
        if (status === 'joined') {
          return res.status(400).json({ 
            success: false, 
            message: 'You are already a member of this group' 
          });
        } else {
          return res.status(400).json({ 
            success: false, 
            message: `You already have a pending ${status} for this group` 
          });
        }
      }
      
      const capacityResult = await db.query(
        'SELECT COUNT(*) as count FROM group_members WHERE group_id = $1 AND status = $2',
        [groupId, 'joined']
      );
      
      const currentMembers = parseInt(capacityResult[0]?.[0]?.count || 0);
      const maxMembers = parseInt(groupData.max_members || 20);
      
      if (currentMembers >= maxMembers) {
        return res.status(400).json({ 
          success: false, 
          message: 'Group has reached maximum capacity' 
        });
      }
      
      if (groupData.visibility === 'private') {
        await db.query(
          'INSERT INTO group_members (group_id, user_id, role, status, created_at) VALUES ($1, $2, $3, $4, NOW())',
          [groupId, userId, 'member', 'requested']
        );
        
        const userResult = await db.query(
          'SELECT username FROM users WHERE id = $1',
          [userId]
        );
        const username = userResult[0]?.[0]?.username || 'User';
        
        await db.query(
          'INSERT INTO group_chat (group_id, user_id, message, created_at) VALUES ($1, $2, $3, NOW())',
          [groupId, 0, `SYSTEM: ${username} has requested to join the group.`]
        );
        
        return res.json({ 
          success: true, 
          message: 'Join request sent. Waiting for admin approval.' 
        });
      } else {
        await db.query(
          'INSERT INTO group_members (group_id, user_id, role, status, created_at) VALUES ($1, $2, $3, $4, NOW())',
          [groupId, userId, 'member', 'joined']
        );
        
        const userResult = await db.query(
          'SELECT username FROM users WHERE id = $1',
          [userId]
        );
        const username = userResult[0]?.[0]?.username || 'New member';
        
        await db.query(
          'INSERT INTO group_chat (group_id, user_id, message, created_at) VALUES ($1, $2, $3, NOW())',
          [groupId, 0, `SYSTEM: ${username} has joined the group!`]
        );
        
        return res.json({ 
          success: true, 
          message: 'Successfully joined the group!' 
        });
      }
    }
    
  } catch (error) {
    console.error('[POST /:groupId/join] ERROR:', error);
    console.error('Error details:', {
      code: error.code,
      message: error.message,
      detail: error.detail
    });
    
    if (error.code === '23505') {
      return res.status(400).json({ 
        success: false, 
        message: 'You already have a pending request to join this group' 
      });
    }
    
    res.status(500).json({ 
      success: false, 
      message: 'Failed to join group',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Invite user to group
router.post('/:groupId/invite', async (req, res) => {
  console.log(`[POST /:groupId/invite] User ${req.user.id} inviting to group ${req.params.groupId}`);
  
  try {
    const { groupId } = req.params;
    const { username } = req.body;
    const userId = req.user.id;
    
    console.log('Invite request:', { groupId, username, userId });
    
    if (!username || typeof username !== 'string' || username.trim() === '') {
      return res.status(400).json({ 
        success: false, 
        message: 'Username is required' 
      });
    }
    
    const cleanUsername = username.trim();
    
    if (db.isSupabase) {
      // Check if group exists
      const { data: group, error: groupError } = await db.supabase
        .from('groups')
        .select('id, creator_id')
        .eq('id', groupId)
        .maybeSingle();
      
      if (groupError) {
        console.error('Supabase error checking group:', groupError);
        throw groupError;
      }
      
      if (!group) {
        return res.status(404).json({ 
          success: false, 
          message: 'Group not found' 
        });
      }
      
      // Check permissions: owner or admin can invite
      const isOwner = group.creator_id === userId;
      
      let isAdmin = false;
      if (!isOwner) {
        const { data: adminCheck, error: adminError } = await db.supabase
          .from('group_members')
          .select('id')
          .eq('group_id', groupId)
          .eq('user_id', userId)
          .in('role', ['admin', 'owner'])
          .eq('status', 'joined')
          .maybeSingle();
        
        if (!adminError && adminCheck) {
          isAdmin = true;
        }
      }
      
      if (!isOwner && !isAdmin) {
        return res.status(403).json({ 
          success: false, 
          message: 'Only group owner or admins can invite users' 
        });
      }
      
      // Find user by username
      const { data: invitedUser, error: userError } = await db.supabase
        .from('users')
        .select('id, username')
        .ilike('username', cleanUsername)
        .maybeSingle();
      
      if (userError || !invitedUser) {
        return res.status(404).json({ 
          success: false, 
          message: `User "${cleanUsername}" not found` 
        });
      }
      
      const invitedUserId = invitedUser.id;
      
      if (invitedUserId === userId) {
        return res.status(400).json({ 
          success: false, 
          message: 'You cannot invite yourself' 
        });
      }
      
      // Check if user is already in the group
      const { data: existing, error: existingError } = await db.supabase
        .from('group_members')
        .select('status')
        .eq('group_id', groupId)
        .eq('user_id', invitedUserId)
        .maybeSingle();
      
      if (existing) {
        if (existing.status === 'joined') {
          return res.status(400).json({ 
            success: false, 
            message: 'User is already a member of this group' 
          });
        } else {
          return res.status(400).json({ 
            success: false, 
            message: `User already has a pending ${existing.status} for this group` 
          });
        }
      }
      
      // Check group capacity
      const { count: currentMembers, error: countError } = await db.supabase
        .from('group_members')
        .select('*', { count: 'exact', head: true })
        .eq('group_id', groupId)
        .eq('status', 'joined');
      
      if (countError) {
        console.error('Error counting members:', countError);
      }
      
      const { data: groupInfo } = await db.supabase
        .from('groups')
        .select('max_members')
        .eq('id', groupId)
        .maybeSingle();
      
      if ((currentMembers || 0) >= (groupInfo?.max_members || 20)) {
        return res.status(400).json({ 
          success: false, 
          message: 'Group has reached maximum capacity' 
        });
      }
      
      // Create invitation
      const { error: insertError } = await db.supabase
        .from('group_members')
        .insert([{
          group_id: groupId,
          user_id: invitedUserId,
          role: 'member',
          status: 'invited'
        }]);
      
      if (insertError) {
        console.error('Error creating invitation:', insertError);
        throw insertError;
      }
      
      // Get inviter's username
      const { data: inviter } = await db.supabase
        .from('users')
        .select('username')
        .eq('id', userId)
        .maybeSingle();
      
      // Create system message
      await db.supabase
        .from('group_chat')
        .insert([{
          group_id: groupId,
          user_id: 0,
          message: `SYSTEM: ${inviter?.username || 'Admin'} has invited ${cleanUsername} to join the group.`
        }]);
      
      res.json({ 
        success: true, 
        message: `Invitation sent to ${cleanUsername} successfully`
      });
      
    } else {
      // PostgreSQL fallback
      const groupResult = await db.query('SELECT id, creator_id FROM groups WHERE id = $1', [groupId]);
      const group = groupResult[0] || [];
      
      if (group.length === 0) {
        return res.status(404).json({ 
          success: false, 
          message: 'Group not found' 
        });
      }
      
      const isOwner = group[0].creator_id === userId;
      
      let isAdmin = false;
      if (!isOwner) {
        const adminCheck = await db.query(
          'SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2 AND role IN ($3, $4) AND status = $5',
          [groupId, userId, 'admin', 'owner', 'joined']
        );
        isAdmin = (adminCheck[0] || []).length > 0;
      }
      
      if (!isOwner && !isAdmin) {
        return res.status(403).json({ 
          success: false, 
          message: 'Only group owner or admins can invite users' 
        });
      }
      
      const userResult = await db.query(
        'SELECT id, username FROM users WHERE username ILIKE $1',
        [cleanUsername]
      );
      
      const users = userResult[0] || [];
      
      if (users.length === 0) {
        return res.status(404).json({ 
          success: false, 
          message: `User "${cleanUsername}" not found` 
        });
      }
      
      const invitedUserId = users[0].id;
      
      if (invitedUserId === userId) {
        return res.status(400).json({ 
          success: false, 
          message: 'You cannot invite yourself' 
        });
      }
      
      const existingResult = await db.query(
        'SELECT status FROM group_members WHERE group_id = $1 AND user_id = $2',
        [groupId, invitedUserId]
      );
      
      const existing = existingResult[0] || [];
      
      if (existing.length > 0) {
        const status = existing[0].status;
        if (status === 'joined') {
          return res.status(400).json({ 
            success: false, 
            message: 'User is already a member of this group' 
          });
        } else {
          return res.status(400).json({ 
            success: false, 
            message: `User already has a pending ${status} for this group` 
          });
        }
      }
      
      const capacityResult = await db.query(
        'SELECT COUNT(*) as count FROM group_members WHERE group_id = $1 AND status = $2',
        [groupId, 'joined']
      );
      
      const groupCapacityResult = await db.query(
        'SELECT max_members FROM groups WHERE id = $1',
        [groupId]
      );
      
      const currentMembers = parseInt(capacityResult[0]?.[0]?.count || 0);
      const maxMembers = parseInt(groupCapacityResult[0]?.[0]?.max_members || 20);
      
      if (currentMembers >= maxMembers) {
        return res.status(400).json({ 
          success: false, 
          message: 'Group has reached maximum capacity' 
        });
      }
      
      await db.query(
        'INSERT INTO group_members (group_id, user_id, role, status, created_at) VALUES ($1, $2, $3, $4, NOW()) RETURNING id',
        [groupId, invitedUserId, 'member', 'invited']
      );
      
      const inviterResult = await db.query(
        'SELECT username FROM users WHERE id = $1',
        [userId]
      );
      const inviterUsername = inviterResult[0]?.[0]?.username || 'Admin';
      
      await db.query(
        'INSERT INTO group_chat (group_id, user_id, message, created_at) VALUES ($1, $2, $3, NOW())',
        [groupId, 0, `SYSTEM: ${inviterUsername} has invited ${cleanUsername} to join the group.`]
      );
      
      res.json({ 
        success: true, 
        message: `Invitation sent to ${cleanUsername} successfully`
      });
    }
    
  } catch (error) {
    console.error('[POST /:groupId/invite] ERROR:', error);
    
    if (error.code === '23505') {
      return res.status(400).json({ 
        success: false, 
        message: 'User already has a pending invitation for this group' 
      });
    }
    
    if (error.code === '23503') {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid user or group' 
      });
    }
    
    res.status(500).json({ 
      success: false, 
      message: 'Failed to send invitation',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Leave group
router.post('/:groupId/leave', async (req, res) => {
  console.log(`[POST /:groupId/leave] User ${req.user.id} leaving group ${req.params.groupId}`);
  
  try {
    const { groupId } = req.params;
    const userId = req.user.id;
    
    console.log('Leave request:', { groupId, userId });
    
    if (db.isSupabase) {
      // Check if user is a member
      const { data: membership, error: membershipError } = await db.supabase
        .from('group_members')
        .select('role, status')
        .eq('group_id', groupId)
        .eq('user_id', userId)
        .maybeSingle();
      
      if (membershipError) {
        console.error('Error checking membership:', membershipError);
      }
      
      if (!membership) {
        // Check if user is the owner (who might not be in group_members)
        const { data: group, error: groupError } = await db.supabase
          .from('groups')
          .select('creator_id')
          .eq('id', groupId)
          .maybeSingle();
        
        if (groupError) {
          console.error('Error checking group ownership:', groupError);
        }
        
        if (group && group.creator_id === userId) {
          return res.status(400).json({ 
            success: false, 
            message: 'Group owner cannot leave. Transfer ownership or delete the group instead.' 
          });
        }
        
        return res.status(400).json({ 
          success: false, 
          message: 'You are not a member of this group' 
        });
      }
      
      const memberStatus = membership.status;
      
      if (memberStatus !== 'joined') {
        // If user has pending request/invitation, just remove it
        const { error: deleteError } = await db.supabase
          .from('group_members')
          .delete()
          .eq('group_id', groupId)
          .eq('user_id', userId);
        
        if (deleteError) {
          console.error('Error deleting membership:', deleteError);
          throw deleteError;
        }
        
        return res.json({ 
          success: true, 
          message: 'Request/invitation removed successfully' 
        });
      }
      
      // Get user's username
      const { data: user } = await db.supabase
        .from('users')
        .select('username')
        .eq('id', userId)
        .maybeSingle();
      
      const username = user?.username || 'User';
      const memberRole = membership.role;
      
      // If user is admin and there are other members, check if we need to promote someone
      if (memberRole === 'admin') {
        const { count: otherAdminsCount, error: countError } = await db.supabase
          .from('group_members')
          .select('*', { count: 'exact', head: true })
          .eq('group_id', groupId)
          .eq('role', 'admin')
          .eq('status', 'joined')
          .neq('user_id', userId);
        
        if (countError) {
          console.error('Error counting other admins:', countError);
        }
        
        if (!otherAdminsCount) {
          // Check if there are other members to promote
          const { data: otherMembers, error: memberError } = await db.supabase
            .from('group_members')
            .select('user_id')
            .eq('group_id', groupId)
            .eq('status', 'joined')
            .neq('user_id', userId)
            .order('created_at', { ascending: true })
            .limit(1);
          
          if (!memberError && otherMembers && otherMembers.length > 0) {
            // Promote oldest member to admin
            const { error: promoteError } = await db.supabase
              .from('group_members')
              .update({ role: 'admin' })
              .eq('group_id', groupId)
              .eq('user_id', otherMembers[0].user_id);
            
            if (promoteError) {
              console.error('Error promoting member:', promoteError);
            } else {
              console.log('Promoted user', otherMembers[0].user_id, 'to admin');
            }
          }
        }
      }
      
      // Remove user from group
      const { error: deleteError } = await db.supabase
        .from('group_members')
        .delete()
        .eq('group_id', groupId)
        .eq('user_id', userId);
      
      if (deleteError) {
        console.error('Error removing user from group:', deleteError);
        throw deleteError;
      }
      
      console.log('User removed from group');
      
      // Create system message
      await db.supabase
        .from('group_chat')
        .insert([{
          group_id: groupId,
          user_id: 0,
          message: `SYSTEM: ${username} has left the group.`
        }]);
      
      res.json({ 
        success: true, 
        message: 'Successfully left the group' 
      });
      
    } else {
      // PostgreSQL fallback
      const membershipResult = await db.query(
        'SELECT role, status FROM group_members WHERE group_id = $1 AND user_id = $2',
        [groupId, userId]
      );
      
      const membership = membershipResult[0] || [];
      
      if (membership.length === 0) {
        const groupResult = await db.query(
          'SELECT creator_id FROM groups WHERE id = $1',
          [groupId]
        );
        const group = groupResult[0] || [];
        
        if (group.length > 0 && group[0].creator_id === userId) {
          return res.status(400).json({ 
            success: false, 
            message: 'Group owner cannot leave. Transfer ownership or delete the group instead.' 
          });
        }
        
        return res.status(400).json({ 
          success: false, 
          message: 'You are not a member of this group' 
        });
      }
      
      const memberStatus = membership[0].status;
      
      if (memberStatus !== 'joined') {
        await db.query(
          'DELETE FROM group_members WHERE group_id = $1 AND user_id = $2',
          [groupId, userId]
        );
        
        return res.json({ 
          success: true, 
          message: 'Request/invitation removed successfully' 
        });
      }
      
      const userResult = await db.query(
        'SELECT username FROM users WHERE id = $1',
        [userId]
      );
      const username = userResult[0]?.[0]?.username || 'User';
      
      const memberRole = membership[0].role;
      
      if (memberRole === 'admin') {
        const otherAdminsResult = await db.query(
          'SELECT COUNT(*) as count FROM group_members WHERE group_id = $1 AND role = $2 AND status = $3 AND user_id != $4',
          [groupId, 'admin', 'joined', userId]
        );
        
        const otherAdminsCount = parseInt(otherAdminsResult[0]?.[0]?.count || 0);
        
        if (otherAdminsCount === 0) {
          const otherMembersResult = await db.query(
            'SELECT user_id FROM group_members WHERE group_id = $1 AND status = $2 AND user_id != $3 ORDER BY created_at ASC LIMIT 1',
            [groupId, 'joined', userId]
          );
          
          const otherMembers = otherMembersResult[0] || [];
          
          if (otherMembers.length > 0) {
            await db.query(
              'UPDATE group_members SET role = $1 WHERE group_id = $2 AND user_id = $3',
              ['admin', groupId, otherMembers[0].user_id]
            );
            console.log('Promoted user', otherMembers[0].user_id, 'to admin');
          }
        }
      }
      
      await db.query(
        'DELETE FROM group_members WHERE group_id = $1 AND user_id = $2',
        [groupId, userId]
      );
      
      console.log('User removed from group');
      
      await db.query(
        'INSERT INTO group_chat (group_id, user_id, message, created_at) VALUES ($1, $2, $3, NOW())',
        [groupId, 0, `SYSTEM: ${username} has left the group.`]
      );
      
      res.json({ 
        success: true, 
        message: 'Successfully left the group' 
      });
    }
    
  } catch (error) {
    console.error('[POST /:groupId/leave] ERROR:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to leave group',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Update group settings
router.put('/:groupId/settings', async (req, res) => {
  console.log(`[PUT /:groupId/settings] User ${req.user.id} updating settings for group ${req.params.groupId}`);
  
  try {
    const { groupId } = req.params;
    const { name, description, game_specialty, max_members, visibility } = req.body;
    const userId = req.user.id;
    
    console.log('Settings update:', { groupId, name, game_specialty, max_members, visibility });
    
    if (db.isSupabase) {
      // Check if group exists
      const { data: group, error: groupError } = await db.supabase
        .from('groups')
        .select('*')
        .eq('id', groupId)
        .maybeSingle();
      
      if (groupError) {
        console.error('Supabase error getting group:', groupError);
        throw groupError;
      }
      
      if (!group) {
        return res.status(404).json({ 
          success: false, 
          message: 'Group not found' 
        });
      }
      
      // Check permissions: only owner or admin can update settings
      const isOwner = group.creator_id === userId;
      
      let isAdmin = false;
      if (!isOwner) {
        const { data: adminCheck, error: adminError } = await db.supabase
          .from('group_members')
          .select('id')
          .eq('group_id', groupId)
          .eq('user_id', userId)
          .eq('role', 'admin')
          .eq('status', 'joined')
          .maybeSingle();
        
        if (!adminError && adminCheck) {
          isAdmin = true;
        }
      }
      
      if (!isOwner && !isAdmin) {
        return res.status(403).json({ 
          success: false, 
          message: 'Only group owner or admins can update settings' 
        });
      }
      
      // Build update object
      const updates = {};
      const changedFields = [];
      
      if (name !== undefined && name !== null) {
        const trimmedName = name.toString().trim();
        if (trimmedName.length < 3 || trimmedName.length > 100) {
          return res.status(400).json({
            success: false,
            message: 'Group name must be between 3 and 100 characters'
          });
        }
        updates.name = trimmedName;
        changedFields.push(`name to "${trimmedName}"`);
      }
      
      if (description !== undefined && description !== null) {
        updates.description = description.toString().trim();
        changedFields.push('description');
      }
      
      if (game_specialty !== undefined && game_specialty !== null) {
        const trimmedGame = game_specialty.toString().trim();
        if (!trimmedGame) {
          return res.status(400).json({
            success: false,
            message: 'Game specialty cannot be empty'
          });
        }
        updates.game_specialty = trimmedGame;
        changedFields.push(`game to ${trimmedGame}`);
      }
      
      if (max_members !== undefined && max_members !== null) {
        const max = parseInt(max_members);
        if (isNaN(max) || max < 2 || max > 100) {
          return res.status(400).json({
            success: false,
            message: 'Max members must be a number between 2 and 100'
          });
        }
        
        // Check current members count
        const { count: currentMembers, error: countError } = await db.supabase
          .from('group_members')
          .select('*', { count: 'exact', head: true })
          .eq('group_id', groupId)
          .eq('status', 'joined');
        
        if (countError) {
          console.error('Error counting members:', countError);
        }
        
        if (max < (currentMembers || 0)) {
          return res.status(400).json({
            success: false,
            message: `Cannot set max members to ${max}. Group already has ${currentMembers} members.`
          });
        }
        
        updates.max_members = max;
        changedFields.push(`max members to ${max}`);
      }
      
      if (visibility !== undefined && visibility !== null) {
        if (!['public', 'private'].includes(visibility)) {
          return res.status(400).json({
            success: false,
            message: 'Visibility must be either "public" or "private"'
          });
        }
        updates.visibility = visibility;
        changedFields.push(`visibility to ${visibility}`);
      }
      
      if (Object.keys(updates).length === 0) {
        return res.status(400).json({
          success: false,
          message: 'No fields to update'
        });
      }
      
      // Add updated_at
      updates.updated_at = new Date().toISOString();
      
      // Update group
      const { error: updateError } = await db.supabase
        .from('groups')
        .update(updates)
        .eq('id', groupId);
      
      if (updateError) {
        console.error('Error updating group:', updateError);
        throw updateError;
      }
      
      // Get username for notification
      const { data: user } = await db.supabase
        .from('users')
        .select('username')
        .eq('id', userId)
        .maybeSingle();
      
      // Create system message
      if (changedFields.length > 0) {
        await db.supabase
          .from('group_chat')
          .insert([{
            group_id: groupId,
            user_id: 0,
            message: `SYSTEM: ${user?.username || 'Admin'} updated group settings: ${changedFields.join(', ')}.`
          }]);
      }
      
      res.json({ 
        success: true, 
        message: 'Group settings updated successfully'
      });
      
    } else {
      // PostgreSQL fallback
      const groupResult = await db.query('SELECT * FROM groups WHERE id = $1', [groupId]);
      const group = groupResult[0] || [];
      
      if (group.length === 0) {
        return res.status(404).json({ 
          success: false, 
          message: 'Group not found' 
        });
      }
      
      const currentGroup = group[0];
      
      const isOwner = currentGroup.creator_id === userId;
      
      let isAdmin = false;
      if (!isOwner) {
        const adminCheck = await db.query(
          'SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2 AND role = $3 AND status = $4',
          [groupId, userId, 'admin', 'joined']
        );
        isAdmin = (adminCheck[0] || []).length > 0;
      }
      
      if (!isOwner && !isAdmin) {
        return res.status(403).json({ 
          success: false, 
          message: 'Only group owner or admins can update settings' 
        });
      }
      
      const updates = [];
      const values = [];
      let paramIndex = 1;
      const changedFields = [];
      
      if (name !== undefined && name !== null) {
        const trimmedName = name.toString().trim();
        if (trimmedName.length < 3 || trimmedName.length > 100) {
          return res.status(400).json({
            success: false,
            message: 'Group name must be between 3 and 100 characters'
          });
        }
        updates.push(`name = $${paramIndex}`);
        values.push(trimmedName);
        paramIndex++;
        changedFields.push(`name to "${trimmedName}"`);
      }
      
      if (description !== undefined && description !== null) {
        updates.push(`description = $${paramIndex}`);
        values.push(description.toString().trim());
        paramIndex++;
        changedFields.push('description');
      }
      
      if (game_specialty !== undefined && game_specialty !== null) {
        const trimmedGame = game_specialty.toString().trim();
        if (!trimmedGame) {
          return res.status(400).json({
            success: false,
            message: 'Game specialty cannot be empty'
          });
        }
        updates.push(`game_specialty = $${paramIndex}`);
        values.push(trimmedGame);
        paramIndex++;
        changedFields.push(`game to ${trimmedGame}`);
      }
      
      if (max_members !== undefined && max_members !== null) {
        const max = parseInt(max_members);
        if (isNaN(max) || max < 2 || max > 100) {
          return res.status(400).json({
            success: false,
            message: 'Max members must be a number between 2 and 100'
          });
        }
        
        const currentMembersResult = await db.query(
          'SELECT COUNT(*) as count FROM group_members WHERE group_id = $1 AND status = $2',
          [groupId, 'joined']
        );
        const currentMembers = parseInt(currentMembersResult[0]?.[0]?.count || 0);
        
        if (max < currentMembers) {
          return res.status(400).json({
            success: false,
            message: `Cannot set max members to ${max}. Group already has ${currentMembers} members.`
          });
        }
        
        updates.push(`max_members = $${paramIndex}`);
        values.push(max);
        paramIndex++;
        changedFields.push(`max members to ${max}`);
      }
      
      if (visibility !== undefined && visibility !== null) {
        if (!['public', 'private'].includes(visibility)) {
          return res.status(400).json({
            success: false,
            message: 'Visibility must be either "public" or "private"'
          });
        }
        updates.push(`visibility = $${paramIndex}`);
        values.push(visibility);
        paramIndex++;
        changedFields.push(`visibility to ${visibility}`);
      }
      
      if (updates.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'No fields to update'
        });
      }
      
      updates.push(`updated_at = NOW()`);
      values.push(groupId);
      
      const query = `UPDATE groups SET ${updates.join(', ')} WHERE id = $${paramIndex}`;
      await db.query(query, values);
      
      const userResult = await db.query(
        'SELECT username FROM users WHERE id = $1',
        [userId]
      );
      const username = userResult[0]?.[0]?.username || 'Admin';
      
      if (changedFields.length > 0) {
        await db.query(
          'INSERT INTO group_chat (group_id, user_id, message, created_at) VALUES ($1, $2, $3, NOW())',
          [groupId, 0, `SYSTEM: ${username} updated group settings: ${changedFields.join(', ')}.`]
        );
      }
      
      res.json({ 
        success: true, 
        message: 'Group settings updated successfully'
      });
    }
    
  } catch (error) {
    console.error('[PUT /:groupId/settings] ERROR:', error);
    
    if (error.code === '23505') {
      return res.status(400).json({ 
        success: false, 
        message: 'A group with this name already exists' 
      });
    }
    
    res.status(500).json({ 
      success: false, 
      message: 'Failed to update group settings',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Remove member from group
router.delete('/:groupId/members/:userId', async (req, res) => {
  console.log(`[DELETE /:groupId/members/:userId] User ${req.user.id} removing member ${req.params.userId} from group ${req.params.groupId}`);
  
  try {
    const { groupId, userId } = req.params;
    const adminId = req.user.id;
    
    // Check if admin is actually an admin
    const adminRole = await getUserGroupRole(adminId, groupId);
    if (!['admin', 'owner'].includes(adminRole)) {
      return res.status(403).json({ 
        success: false, 
        message: 'Only group admins can remove members' 
      });
    }
    
    if (parseInt(userId) === adminId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Use the leave endpoint to remove yourself' 
      });
    }
    
    // Can't remove other admins unless you're owner
    const targetRole = await getUserGroupRole(userId, groupId);
    if (targetRole === 'admin' && adminRole !== 'owner') {
      return res.status(403).json({ 
        success: false, 
        message: 'Only group owner can remove other admins' 
      });
    }
    
    if (db.isSupabase) {
      // Get user info before removal
      const { data: user } = await db.supabase
        .from('users')
        .select('username')
        .eq('id', userId)
        .maybeSingle();
      
      const username = user?.username || 'A member';
      
      // Get admin username
      const { data: admin } = await db.supabase
        .from('users')
        .select('username')
        .eq('id', adminId)
        .maybeSingle();
      
      // Remove member
      const { error: deleteError } = await db.supabase
        .from('group_members')
        .delete()
        .eq('group_id', groupId)
        .eq('user_id', userId);
      
      if (deleteError) {
        console.error('Error removing member:', deleteError);
        throw deleteError;
      }
      
      // Create system message
      await db.supabase
        .from('group_chat')
        .insert([{
          group_id: groupId,
          user_id: 0,
          message: `SYSTEM: ${username} has been removed from the group by ${admin?.username || 'an admin'}.`
        }]);
      
      res.json({ success: true, message: 'Member removed successfully' });
      
    } else {
      // PostgreSQL fallback
      const userResult = await db.query(
        'SELECT username FROM users WHERE id = $1',
        [userId]
      );
      
      const userInfo = userResult[0] || [];
      const username = userInfo[0]?.username || 'A member';
      
      await db.query(
        'DELETE FROM group_members WHERE group_id = $1 AND user_id = $2',
        [groupId, userId]
      );
      
      await db.query(
        'INSERT INTO group_chat (group_id, user_id, message) VALUES ($1, $2, $3)',
        [groupId, 0, `SYSTEM: ${username} has been removed from the group by ${req.user.username}.`]
      );
      
      res.json({ success: true, message: 'Member removed successfully' });
    }
    
  } catch (error) {
    console.error('[DELETE /:groupId/members/:userId] Error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to remove member',
      error: error.message 
    });
  }
});

// Search groups
router.get('/search', async (req, res) => {
  console.log(`[GET /search] Searching groups with query: "${req.query.query}"`);
  
  try {
    const { query } = req.query;
    
    if (!query || query.trim().length < 2) {
      return res.status(400).json({ 
        success: false, 
        message: 'Search query must be at least 2 characters' 
      });
    }
    
    const searchPattern = `%${query}%`;
    
    if (db.isSupabase) {
      const { data: groups, error } = await db.supabase
        .from('groups')
        .select('*')
        .eq('visibility', 'public')
        .or(`name.ilike.${searchPattern},game_specialty.ilike.${searchPattern},description.ilike.${searchPattern}`)
        .order('created_at', { ascending: false })
        .limit(20);
      
      if (error) {
        console.error('Supabase error in search:', error);
        throw error;
      }
      
      // Add member counts
      const groupsWithStats = await Promise.all((groups || []).map(async (group) => {
        // Get creator name
        let creatorName = 'Unknown';
        if (group.creator_id) {
          const { data: creator, error: creatorError } = await db.supabase
            .from('users')
            .select('username')
            .eq('id', group.creator_id)
            .maybeSingle();
          
          if (!creatorError && creator) {
            creatorName = creator.username;
          }
        }
        
        const { count, error: countError } = await db.supabase
          .from('group_members')
          .select('*', { count: 'exact', head: true })
          .eq('group_id', group.id)
          .eq('status', 'joined');
        
        if (countError) {
          console.error('Error getting member count:', countError);
        }
        
        return {
          id: group.id || 0,
          name: group.name || 'Unnamed Group',
          description: group.description || '',
          game_specialty: group.game_specialty || 'General',
          visibility: group.visibility || 'public',
          max_members: Number(group.max_members) || 20,
          created_at: group.created_at || new Date().toISOString(),
          creator_id: group.creator_id || 0,
          creator_name: creatorName,
          member_count: Number(count) || 0,
          tournament_participations: 0,
          tournament_wins: 0
        };
      }));
      
      console.log(`[GET /search] Found ${groupsWithStats.length} groups for query "${query}"`);
      res.json({ success: true, groups: groupsWithStats });
      
    } else {
      // PostgreSQL fallback
      const result = await db.query(`
        SELECT 
          g.*,
          COALESCE(u.username, 'Unknown') AS creator_name,
          COALESCE(gm.member_count, 0) AS member_count
        FROM groups g
        LEFT JOIN users u ON g.creator_id = u.id
        LEFT JOIN (
          SELECT group_id, COUNT(*) AS member_count
          FROM group_members
          WHERE status = 'joined'
          GROUP BY group_id
        ) gm ON g.id = gm.group_id
        WHERE (g.name ILIKE $1 OR g.game_specialty ILIKE $2 OR g.description ILIKE $3)
        AND g.visibility = 'public'
        ORDER BY g.created_at DESC
        LIMIT 20
      `, [searchPattern, searchPattern, searchPattern]);
      
      const groups = result[0] || [];
      
      const safeGroups = groups.map(group => ({
        ...group,
        member_count: Number(group.member_count) || 0,
        creator_name: group.creator_name || 'Unknown',
        tournament_participations: 0,
        tournament_wins: 0
      }));
      
      console.log(`[GET /search] Found ${safeGroups.length} groups for query "${query}"`);
      res.json({ success: true, groups: safeGroups });
    }
    
  } catch (error) {
    console.error('[GET /search] Error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Search failed',
      error: error.message 
    });
  }
});

// Search users for inviting
router.get('/search-users', async (req, res) => {
  console.log(`[GET /search-users] Searching users with query: "${req.query.username}"`);
  
  try {
    const { username } = req.query;
    
    if (!username || username.length < 3) {
      return res.status(400).json({ 
        success: false, 
        message: 'Username must be at least 3 characters' 
      });
    }
    
    if (db.isSupabase) {
      const { data: users, error } = await db.supabase
        .from('users')
        .select('id, username, profile_pic, rank, created_at')
        .ilike('username', `%${username}%`)
        .neq('id', req.user.id)
        .order('username')
        .limit(10);
      
      if (error) {
        console.error('Supabase error in search-users:', error);
        throw error;
      }
      
      console.log(`[GET /search-users] Found ${users?.length || 0} users for query "${username}"`);
      res.json({ success: true, users: users || [] });
      
    } else {
      // PostgreSQL fallback
      const result = await db.query(`
        SELECT id, username, profile_pic, rank, created_at
        FROM users
        WHERE username ILIKE $1 AND id != $2
        ORDER BY username
        LIMIT 10
      `, [`%${username}%`, req.user.id]);
      
      const users = result[0] || [];
      
      console.log(`[GET /search-users] Found ${users.length} users for query "${username}"`);
      res.json({ success: true, users: users });
    }
    
  } catch (error) {
    console.error('[GET /search-users] Error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'User search failed',
      error: error.message 
    });
  }
});

// Update member role (Admin only)
router.put('/:groupId/members/:userId/role', async (req, res) => {
  console.log(`[PUT /:groupId/members/:userId/role] User ${req.user.id} updating role for member ${req.params.userId} in group ${req.params.groupId}`);
  
  try {
    const { groupId, userId } = req.params;
    const { role } = req.body;
    const adminId = req.user.id;
    
    if (!role || !['member', 'moderator', 'admin'].includes(role)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Valid role (member, moderator, or admin) is required' 
      });
    }
    
    // Check if admin is actually an admin
    const adminRole = await getUserGroupRole(adminId, groupId);
    if (!['admin', 'owner'].includes(adminRole)) {
      return res.status(403).json({ 
        success: false, 
        message: 'Only group admins can update member roles' 
      });
    }
    
    if (parseInt(userId) === adminId && adminRole !== 'owner') {
      return res.status(400).json({ 
        success: false, 
        message: 'You cannot change your own role' 
      });
    }
    
    if (db.isSupabase) {
      // Get user info before update
      const { data: user } = await db.supabase
        .from('users')
        .select('username')
        .eq('id', userId)
        .maybeSingle();
      
      const username = user?.username || 'A member';
      
      // Get admin username
      const { data: admin } = await db.supabase
        .from('users')
        .select('username')
        .eq('id', adminId)
        .maybeSingle();
      
      // Update role
      const { error: updateError } = await db.supabase
        .from('group_members')
        .update({ role })
        .eq('group_id', groupId)
        .eq('user_id', userId);
      
      if (updateError) {
        console.error('Error updating role:', updateError);
        throw updateError;
      }
      
      // Create system message
      await db.supabase
        .from('group_chat')
        .insert([{
          group_id: groupId,
          user_id: 0,
          message: `SYSTEM: ${username} has been promoted to ${role} by ${admin?.username || 'an admin'}.`
        }]);
      
      res.json({ 
        success: true, 
        message: `Member role updated to ${role} successfully` 
      });
      
    } else {
      // PostgreSQL fallback
      const userResult = await db.query(
        'SELECT username FROM users WHERE id = $1',
        [userId]
      );
      
      const userInfo = userResult[0] || [];
      const username = userInfo[0]?.username || 'A member';
      
      await db.query(
        'UPDATE group_members SET role = $1 WHERE group_id = $2 AND user_id = $3',
        [role, groupId, userId]
      );
      
      await db.query(
        'INSERT INTO group_chat (group_id, user_id, message) VALUES ($1, $2, $3)',
        [groupId, 0, `SYSTEM: ${username} has been promoted to ${role} by ${req.user.username}.`]
      );
      
      res.json({ 
        success: true, 
        message: `Member role updated to ${role} successfully` 
      });
    }
    
  } catch (error) {
    console.error('[PUT /:groupId/members/:userId/role] Error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to update member role',
      error: error.message 
    });
  }
});

// Get group chat messages
router.get('/:groupId/chat', async (req, res) => {
  console.log(`[GET /:groupId/chat] Getting chat messages for group ${req.params.groupId}`);
  
  try {
    const { groupId } = req.params;
    const userId = req.user.id;
    
    // Check if user can view this group
    const canView = await canViewGroup(userId, groupId);
    if (!canView) {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied: You do not have permission to view group chat' 
      });
    }
    
    const { limit = 50, offset = 0 } = req.query;
    
    if (db.isSupabase) {
      const { data: messages, error } = await db.supabase
        .from('group_chat')
        .select(`
          *,
          users:user_id (
            username,
            profile_pic
          )
        `)
        .eq('group_id', groupId)
        .order('created_at', { ascending: false })
        .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);
      
      if (error) {
        console.error('Supabase error in /chat:', error);
        throw error;
      }
      
      const formattedMessages = (messages || []).map(m => ({
        ...m,
        username: m.users?.username,
        profile_pic: m.users?.profile_pic
      }));
      
      // Update last visit time
      try {
        const { error: upsertError } = await db.supabase
          .from('group_chat_visits')
          .upsert({
            user_id: userId,
            group_id: groupId,
            last_visit: new Date().toISOString(),
            updated_at: new Date().toISOString()
          }, {
            onConflict: 'user_id, group_id'
          });
        
        if (upsertError) {
          console.error('Error updating visit time:', upsertError);
        }
      } catch (visitError) {
        console.error('Error updating visit time:', visitError);
      }
      
      res.json({ 
        success: true, 
        messages: formattedMessages,
        count: formattedMessages.length
      });
      
    } else {
      // PostgreSQL fallback
      const result = await db.query(`
        SELECT 
          gc.*,
          u.username,
          u.profile_pic
        FROM group_chat gc
        LEFT JOIN users u ON gc.user_id = u.id
        WHERE gc.group_id = $1
        ORDER BY gc.created_at DESC
        LIMIT $2 OFFSET $3
      `, [groupId, limit, offset]);
      
      const messages = result[0] || [];
      
      try {
        await db.query(`
          INSERT INTO group_chat_visits (user_id, group_id, last_visit)
          VALUES ($1, $2, CURRENT_TIMESTAMP)
          ON CONFLICT (user_id, group_id) 
          DO UPDATE SET last_visit = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        `, [userId, groupId]);
      } catch (visitError) {
        console.error('Error updating visit time:', visitError);
      }
      
      res.json({ 
        success: true, 
        messages: messages,
        count: messages.length || 0
      });
    }
    
  } catch (error) {
    console.error('[GET /:groupId/chat] Error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to load chat messages',
      error: error.message 
    });
  }
});

// Post message to group chat
router.post('/:groupId/chat', async (req, res) => {
  console.log(`[POST /:groupId/chat] User ${req.user.id} posting message to group ${req.params.groupId}`);
  
  try {
    const { groupId } = req.params;
    const { message } = req.body;
    const userId = req.user.id;
    
    if (!message || message.trim().length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'Message cannot be empty' 
      });
    }
    
    if (message.length > 1000) {
      return res.status(400).json({ 
        success: false, 
        message: 'Message is too long (max 1000 characters)' 
      });
    }
    
    if (db.isSupabase) {
      // Check if user is a member of the group
      const { data: membership, error: memberError } = await db.supabase
        .from('group_members')
        .select('id')
        .eq('group_id', groupId)
        .eq('user_id', userId)
        .eq('status', 'joined')
        .maybeSingle();
      
      if (memberError) {
        console.error('Error checking membership:', memberError);
      }
      
      if (!membership) {
        return res.status(403).json({ 
          success: false, 
          message: 'You must be a member of the group to post messages' 
        });
      }
      
      // Insert message
      const { data: inserted, error: insertError } = await db.supabase
        .from('group_chat')
        .insert([{
          group_id: groupId,
          user_id: userId,
          message: message.trim()
        }])
        .select()
        .single();
      
      if (insertError) {
        console.error('Error posting message:', insertError);
        throw insertError;
      }
      
      res.json({ 
        success: true, 
        message: 'Message posted successfully',
        message_id: inserted.id,
        created_at: inserted.created_at
      });
      
    } else {
      // PostgreSQL fallback
      const result = await db.query(
        'SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2 AND status = $3',
        [groupId, userId, 'joined']
      );
      
      const membership = result[0] || [];
      
      if (membership.length === 0) {
        return res.status(403).json({ 
          success: false, 
          message: 'You must be a member of the group to post messages' 
        });
      }
      
      const insertResult = await db.query(
        'INSERT INTO group_chat (group_id, user_id, message) VALUES ($1, $2, $3) RETURNING id, created_at',
        [groupId, userId, message.trim()]
      );
      
      const inserted = insertResult[0] || [];
      
      res.json({ 
        success: true, 
        message: 'Message posted successfully',
        message_id: inserted[0]?.id,
        created_at: inserted[0]?.created_at
      });
    }
    
  } catch (error) {
    console.error('[POST /:groupId/chat] Error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to post message',
      error: error.message 
    });
  }
});

// Health check endpoint
router.get('/health', async (req, res) => {
  console.log('[GET /health] Health check requested');
  
  try {
    if (db.isSupabase) {
      const tables = ['groups', 'users', 'group_members', 'group_tournaments', 'group_chat', 'group_chat_visits'];
      const tableStatus = {};
      
      for (const table of tables) {
        try {
          const { count, error } = await db.supabase
            .from(table)
            .select('*', { count: 'exact', head: true });
          
          tableStatus[table] = { 
            exists: !error, 
            count: count || 0,
            error: error ? error.message : null
          };
        } catch (error) {
          tableStatus[table] = { exists: false, error: error.message };
        }
      }
      
      res.json({
        success: true,
        message: 'Groups API is running',
        database: 'Supabase',
        tables: tableStatus,
        timestamp: new Date().toISOString()
      });
      
    } else {
      // PostgreSQL fallback
      const tables = ['groups', 'users', 'group_members', 'group_tournaments', 'group_chat', 'group_chat_visits'];
      const tableStatus = {};
      
      for (const table of tables) {
        try {
          const result = await db.query(`SELECT COUNT(*) as count FROM ${table} LIMIT 1`);
          const rows = result[0] || [];
          tableStatus[table] = { exists: true, count: parseInt(rows[0]?.count || 0) };
        } catch (error) {
          tableStatus[table] = { exists: false, error: error.message };
        }
      }
      
      res.json({
        success: true,
        message: 'Groups API is running',
        database: 'PostgreSQL',
        tables: tableStatus,
        timestamp: new Date().toISOString()
      });
    }
    
  } catch (error) {
    console.error('[GET /health] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Health check failed',
      error: error.message
    });
  }
});

// Get user's group invitations
router.get('/invitations', async (req, res) => {
  console.log('[GET /invitations] Getting invitations for user:', req.user.id);
  
  try {
    if (db.isSupabase) {
      const { data: invitations, error } = await db.supabase
        .from('group_members')
        .select(`
          *,
          groups:group_id (
            name,
            description,
            game_specialty,
            visibility,
            max_members,
            created_at,
            creator_id,
            users:creator_id (
              username
            )
          )
        `)
        .eq('user_id', req.user.id)
        .eq('status', 'invited')
        .order('created_at', { ascending: false });
      
      if (error) {
        console.error('Supabase error in /invitations:', error);
        throw error;
      }
      
      const formattedInvitations = (invitations || []).map(inv => ({
        ...inv,
        group_name: inv.groups?.name,
        group_description: inv.groups?.description,
        game_specialty: inv.groups?.game_specialty,
        visibility: inv.groups?.visibility,
        max_members: inv.groups?.max_members,
        group_created_at: inv.groups?.created_at,
        inviter_name: inv.groups?.users?.username
      }));
      
      res.json({ 
        success: true, 
        invitations: formattedInvitations 
      });
      
    } else {
      // PostgreSQL fallback
      const result = await db.query(`
        SELECT 
          gm.*,
          g.name as group_name,
          g.description as group_description,
          g.game_specialty,
          g.visibility,
          g.max_members,
          g.created_at as group_created_at,
          u.username as inviter_name
        FROM group_members gm
        INNER JOIN groups g ON gm.group_id = g.id
        LEFT JOIN users u ON g.creator_id = u.id
        WHERE gm.user_id = $1 AND gm.status = 'invited'
        ORDER BY gm.created_at DESC
      `, [req.user.id]);
      
      const invitations = result[0] || [];
      
      res.json({ 
        success: true, 
        invitations: invitations 
      });
    }
    
  } catch (error) {
    console.error('[GET /invitations] Error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to load invitations',
      error: error.message 
    });
  }
});

module.exports = router;
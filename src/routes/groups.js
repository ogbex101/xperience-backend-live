const express = require('express');
const router = express.Router();

// ==================== DEBUGGING ====================
console.log('🔍🔍🔍 GROUPS ROUTER FILE IS BEING EXECUTED 🔍🔍🔍');
console.log('Current directory:', __dirname);
console.log('Time:', new Date().toISOString());

// ==================== PUBLIC ROUTES ====================

// Debug root - let's see if ANY route works
router.get('/debug-ping', (req, res) => {
  console.log('✅ DEBUG-PING: Route hit successfully!');
  res.json({ 
    success: true, 
    message: 'PONG! Groups router is working',
    time: new Date().toISOString(),
    headers: req.headers
  });
});

// Health check
router.get('/health', (req, res) => {
  console.log('🏥 HEALTH CHECK: Route hit');
  res.json({ 
    success: true, 
    message: 'Groups API is healthy',
    timestamp: new Date().toISOString()
  });
});

router.get('/popular', async (req, res) => {
  console.log('[GROUPS] GET /popular');
  
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
      .limit(10);
    
    if (error) {
      console.error('[GROUPS] Popular error:', error);
      return res.status(500).json({ success: false, message: 'Database error' });
    }
    
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
        current_members: group.current_members || 0,
        created_at: group.created_at,
        creator_id: group.created_by,
        creator_name: creatorName,
        member_count: group.current_members || 0,
        is_member: false,
        tournament_participations: 0,
        tournament_wins: 0
      };
    }));
    
    res.json({ success: true, groups: groupsWithDetails });
    
  } catch (error) {
    console.error('[GROUPS] Popular error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Discover groups - returns empty array for testing
router.get('/discover', (req, res) => {
  console.log('🔍 DISCOVER GROUPS: Route hit');
  res.json({ 
    success: true, 
    groups: [],
    message: 'Discover endpoint working (test mode)'
  });
});

router.get('/my-groups', authenticateToken, async (req, res) => {
  console.log('[GROUPS] GET /my-groups - User:', req.user.id);
  
  try {
    if (!db.isSupabase) {
      return res.status(500).json({ success: false, message: 'Database not configured' });
    }

    // Get user's memberships
    const { data: memberships, error: memberError } = await db.supabase
      .from('group_members')
      .select('group_id, role, status, joined_at')
      .eq('user_id', req.user.id)
      .eq('status', 'joined');
    
    if (memberError) {
      console.error('[GROUPS] Member error:', memberError);
      return res.status(500).json({ success: false, message: 'Database error' });
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
      console.error('[GROUPS] Group error:', groupError);
      return res.status(500).json({ success: false, message: 'Database error' });
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
      
      const membership = memberships.find(m => m.group_id === group.id);
      
      return {
        id: group.id,
        name: group.name,
        description: group.description || '',
        game_specialty: group.game_specialty || 'General',
        visibility: group.visibility || (group.is_public ? 'public' : 'private'),
        max_members: group.max_members || 20,
        current_members: group.current_members || 0,
        created_at: group.created_at,
        creator_id: group.created_by,
        creator_name: creatorName,
        member_count: group.current_members || 0,
        role: membership?.role || 'member',
        joined_at: membership?.joined_at,
        is_member: true,
        tournament_participations: 0,
        tournament_wins: 0
      };
    }));
    
    res.json({ success: true, groups: groupsWithDetails });
    
  } catch (error) {
    console.error('[GROUPS] My groups error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Create group (mock)
router.post('/create', (req, res) => {
  console.log('➕ CREATE GROUP: Route hit');
  console.log('   Body:', req.body);
  console.log('   User:', req.user ? req.user.id : 'No user');
  
  res.json({ 
    success: true, 
    message: 'Create endpoint working (test mode)',
    received: req.body
  });
});

// Get single group
router.get('/:groupId', (req, res) => {
  console.log(`📦 GROUP DETAILS: Route hit for ID: ${req.params.groupId}`);
  res.json({ 
    success: true, 
    group: {
      id: req.params.groupId,
      name: 'Test Group',
      description: 'This is a test group',
      game_specialty: 'Testing',
      member_count: 0
    },
    message: 'Group details endpoint working (test mode)'
  });
});

// Join group
router.post('/:groupId/join', (req, res) => {
  console.log(`🚪 JOIN GROUP: Route hit for ID: ${req.params.groupId}`);
  res.json({ 
    success: true, 
    message: 'Join endpoint working (test mode)'
  });
});

// Leave group
router.post('/:groupId/leave', (req, res) => {
  console.log(`👋 LEAVE GROUP: Route hit for ID: ${req.params.groupId}`);
  res.json({ 
    success: true, 
    message: 'Leave endpoint working (test mode)'
  });
});

// ==================== ROUTE LIST ====================
console.log('📋 ROUTES REGISTERED:');
console.log('   GET    /debug-ping');
console.log('   GET    /health');
console.log('   GET    /popular');
console.log('   GET    /discover');
console.log('   GET    /my-groups');
console.log('   POST   /create');
console.log('   GET    /:groupId');
console.log('   POST   /:groupId/join');
console.log('   POST   /:groupId/leave');
console.log('✅ GROUPS ROUTER LOADED SUCCESSFULLY');

module.exports = router;
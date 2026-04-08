const express = require('express');
const router = express.Router();
const db = require('../config/database'); // PostgreSQL pool with Supabase support
const { authenticateToken } = require('../middleware/auth');
// Helper function to get round name based on round number and total participants
function getRoundName(roundNumber, totalParticipants = null) {
  // Calculate expected participants in this round
  const participantsInRound = totalParticipants ? Math.pow(2, Math.ceil(Math.log2(totalParticipants)) - roundNumber + 1) : null;
  
  // Specific round names based on participant count
  const roundNameMap = {
    2048: 'Round of 2048',
    1024: 'Round of 1024',
    512: 'Round of 512',
    256: 'Round of 256',
    128: 'Round of 128',
    64: 'Round of 64',
    32: 'Round of 32',
    16: 'Round of 16',
    8: 'Quarter Finals',
    4: 'Semi Finals',
    2: 'Finals'
  };
  
  // If we have participant count and it matches a known round name
  if (participantsInRound && roundNameMap[participantsInRound]) {
    return roundNameMap[participantsInRound];
  }
  
  // For final rounds detection
  if (roundNumber === 1 && participantsInRound === 2) {
    return 'Finals';
  }
  
  if (roundNumber === 1 && participantsInRound === 4) {
    return 'Semi Finals';
  }
  
  if (roundNumber === 1 && participantsInRound === 8) {
    return 'Quarter Finals';
  }
  
  // Handle round numbers with specific names (for when we know the round number)
  const specificRoundNames = {
    1: 'Round 1',
    2: 'Round 2',
    3: 'Quarter Finals',
    4: 'Semi Finals',
    5: 'Finals',
    6: 'Grand Finals',
    7: 'Championship',
    8: 'Ultimate Finals'
  };
  
  if (specificRoundNames[roundNumber]) {
    return specificRoundNames[roundNumber];
  }
  
  // For rounds beyond known ones, use ordinal numbers
  const lastDigit = roundNumber % 10;
  const lastTwoDigits = roundNumber % 100;
  
  if (lastTwoDigits >= 11 && lastTwoDigits <= 13) {
    return `${roundNumber}th Round`;
  }
  
  switch (lastDigit) {
    case 1: return `${roundNumber}st Round`;
    case 2: return `${roundNumber}nd Round`;
    case 3: return `${roundNumber}rd Round`;
    default: return `${roundNumber}th Round`;
  }
}
// ============================
// NO AUTHENTICATION MIDDLEWARE HERE - server.js already applies auth globally
// ============================

// ============================
// HELPER FUNCTIONS FOR POSTGRES TRANSACTIONS
// ============================

const withTransaction = async (callback) => {
  if (db.isSupabase) {
    // For Supabase, we'll execute sequentially (Supabase doesn't support multi-statement transactions in same way)
    // We'll use the callback directly - it should handle its own operations
    try {
      return await callback(db);
    } catch (error) {
      console.error('❌ Supabase transaction error:', error);
      throw error;
    }
  } else {
    // PostgreSQL transaction
    try {
      // Start transaction
      await db.query('BEGIN');
      
      // Execute callback with db reference
      const result = await callback(db);
      
      // Commit transaction
      await db.query('COMMIT');
      
      return result;
    } catch (error) {
      // Rollback on error
      await db.query('ROLLBACK');
      console.error('❌ Transaction error:', error);
      throw error;
    }
  }
};

// ============================
// ALL ROUTES - COMPLETE CONVERSION
// ============================
// ============================
// ADVANCED BRACKET GENERATOR - ONLY FOR 1v1 TOURNAMENTS
// ============================

function generateAdvancedBracket(participants, tournamentId, startDate, config) {
  const {
    elimination_type = 'single',
    max_rounds = null,
    consolation_bracket = false
  } = config;
  
  const matches = [];
  const participantCount = participants.length;
  
  if (participantCount < 2) return matches;
  
  // Calculate rounds needed
  let roundsNeeded = max_rounds || Math.ceil(Math.log2(participantCount));
  const firstRoundSize = Math.pow(2, roundsNeeded);
  
  console.log(`🏆 Generating ${elimination_type} elimination bracket for ${participantCount} players`);
  
  // Shuffle participants for random seeding
  const shuffled = [...participants].sort(() => Math.random() - 0.5);
  const startDateTime = new Date(startDate || new Date());
  
  // ========== WINNERS BRACKET ==========
  const winnersMatches = [];
  let matchIndex = 0;
  
  // Create first round matches
  for (let i = 0; i < firstRoundSize / 2; i++) {
    const player1Index = i * 2;
    const player2Index = i * 2 + 1;
    
    const player1 = shuffled[player1Index] || null;
    const player2 = shuffled[player2Index] || null;
    
    const matchTime = new Date(startDateTime.getTime() + (matchIndex * 15 * 60000));
    
    // BYE match (only one player)
    if (player1 && !player2) {
      winnersMatches.push({
        tournament_id: tournamentId,
        player1_id: player1.user_id,
        player2_id: null,
        round_number: 1,
        match_time: matchTime.toISOString(),
        status: 'completed',
        winner_id: player1.user_id,
        completed_at: new Date().toISOString(),
        bracket_type: 'winners',
        created_at: new Date().toISOString()
      });
    } 
    else if (!player1 && player2) {
      winnersMatches.push({
        tournament_id: tournamentId,
        player1_id: player2.user_id,
        player2_id: null,
        round_number: 1,
        match_time: matchTime.toISOString(),
        status: 'completed',
        winner_id: player2.user_id,
        completed_at: new Date().toISOString(),
        bracket_type: 'winners',
        created_at: new Date().toISOString()
      });
    }
    else if (player1 && player2) {
      winnersMatches.push({
        tournament_id: tournamentId,
        player1_id: player1.user_id,
        player2_id: player2.user_id,
        round_number: 1,
        match_time: matchTime.toISOString(),
        status: 'upcoming',
        bracket_type: 'winners',
        created_at: new Date().toISOString()
      });
    }
    matchIndex++;
  }
  
  matches.push(...winnersMatches);
  
  // Create subsequent winners bracket rounds
  let matchesInCurrentRound = Math.ceil(winnersMatches.filter(m => m.status !== 'completed').length / 2);
  let currentRound = 2;
  
  while (currentRound <= roundsNeeded && matchesInCurrentRound > 0) {
    for (let i = 0; i < matchesInCurrentRound; i++) {
      const matchTime = new Date(startDateTime.getTime() + (currentRound * 60 * 60000));
      matches.push({
        tournament_id: tournamentId,
        player1_id: null,
        player2_id: null,
        round_number: currentRound,
        match_time: matchTime.toISOString(),
        status: 'upcoming',
        bracket_type: 'winners',
        created_at: new Date().toISOString()
      });
    }
    matchesInCurrentRound = Math.ceil(matchesInCurrentRound / 2);
    currentRound++;
  }
  
  // ========== LOSERS BRACKET (Double Elimination Only) ==========
  if (elimination_type === 'double') {
    const losersRoundsNeeded = (roundsNeeded * 2) - 1;
    
    for (let round = 1; round <= losersRoundsNeeded; round++) {
      const matchesInRound = Math.max(1, Math.pow(2, Math.ceil(losersRoundsNeeded - round)));
      for (let i = 0; i < matchesInRound; i++) {
        const matchTime = new Date(startDateTime.getTime() + ((round + roundsNeeded) * 45 * 60000));
        matches.push({
          tournament_id: tournamentId,
          player1_id: null,
          player2_id: null,
          round_number: round,
          match_time: matchTime.toISOString(),
          status: 'upcoming',
          bracket_type: 'losers',
          created_at: new Date().toISOString()
        });
      }
    }
    
    // Grand Finals
    matches.push({
      tournament_id: tournamentId,
      player1_id: null,
      player2_id: null,
      round_number: roundsNeeded + 1,
      match_time: new Date(startDateTime.getTime() + ((roundsNeeded + 1) * 60 * 60000)).toISOString(),
      status: 'upcoming',
      bracket_type: 'grand_finals',
      is_bracket_reset: true,
      created_at: new Date().toISOString()
    });
  }
  
  // ========== CONSOLATION BRACKET (3rd Place) ==========
  if (consolation_bracket) {
    matches.push({
      tournament_id: tournamentId,
      player1_id: null,
      player2_id: null,
      round_number: roundsNeeded + (elimination_type === 'double' ? 2 : 1),
      match_time: new Date(startDateTime.getTime() + ((roundsNeeded + 1) * 60 * 60000)).toISOString(),
      status: 'upcoming',
      bracket_type: 'consolation',
      is_third_place: true,
      created_at: new Date().toISOString()
    });
  }
  
  console.log(`✅ Generated ${matches.length} matches for ${elimination_type} elimination`);
  return matches;
}
// Add this route to your tournaments.js file (anywhere before module.exports)
router.get('/:id/debug-state', async (req, res) => {
  try {
    const tournamentId = req.params.id;
    
    if (db.isSupabase) {
      // SUPABASE VERSION
      // Get tournament details
      const { data: tournament, error: tournamentError } = await db.supabaseAdmin
        .from('tournaments')
        .select('*')
        .eq('id', tournamentId)
        .single();
      
      if (tournamentError) throw tournamentError;
      
      // Get all participants
      const { data: participants, error: participantsError } = await db.supabaseAdmin
        .from('tournament_participants')
        .select('*')
        .eq('tournament_id', tournamentId);
      
      if (participantsError) throw participantsError;
      
      // Get squad count
      const { count: squadCount, error: squadError } = await db.supabaseAdmin
        .from('tournament_participants')
        .select('*', { count: 'exact', head: true })
        .eq('tournament_id', tournamentId)
        .eq('status', 'joined')
        .not('group_id', 'is', null);
      
      if (squadError) throw squadError;
      
      res.json({
        success: true,
        tournament: tournament || null,
        participants: participants || [],
        squad_count: squadCount || 0,
        total_participants: participants?.length || 0,
        has_max_squads: tournament?.max_squads !== undefined,
        has_max_groups: tournament?.max_groups !== undefined
      });
      
    } else {
      // POSTGRESQL VERSION - keep your original code
      // Get tournament details
      const tournamentResult = await db.query(`
        SELECT * FROM tournaments WHERE id = $1
      `, [tournamentId]);
      
      // Get all participants
      const participantsResult = await db.query(`
        SELECT * FROM tournament_participants WHERE tournament_id = $1
      `, [tournamentId]);
      
      // Get squad count
      const squadCountResult = await db.query(`
        SELECT COUNT(DISTINCT group_id) as squad_count 
        FROM tournament_participants 
        WHERE tournament_id = $1 AND group_id IS NOT NULL AND status = 'joined'
      `, [tournamentId]);
      
      res.json({
        success: true,
        tournament: tournamentResult[0]?.[0] || null,
        participants: participantsResult[0] || [],
        squad_count: squadCountResult[0]?.[0]?.squad_count || 0,
        total_participants: participantsResult[0].length,
        has_max_squads: tournamentResult[0]?.[0]?.max_squads !== undefined,
        has_max_groups: tournamentResult[0]?.[0]?.max_groups !== undefined
      });
    }
  } catch (error) {
    console.error('❌ Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/tournaments/user-groups - Get groups user is admin of
router.get('/user-groups', async (req, res) => {
  try {
    // ✅ Get user ID from multiple possible locations
    const userId = req.user?.id || req.user?.userId;
    
    console.log('🔍 Fetching user groups:', {
      reqUser: req.user,
      userId,
      userIdType: typeof userId
    });
    
    if (!userId || userId === undefined) {
      return res.status(400).json({
        success: false,
        error: 'User ID is undefined',
        debug: { userObject: req.user }
      });
    }
    
    if (db.isSupabase) {
      // SUPABASE VERSION
      const { data: groups, error } = await db.supabaseAdmin
        .from('groups')
        .select(`
          *,
          group_members!inner (
            user_id,
            role,
            status
          )
        `)
        .eq('group_members.user_id', userId)
        .eq('group_members.role', 'admin')
        .eq('group_members.status', 'joined');

      if (error) throw error;

      // Process groups to add member count and member_ids
      const processedGroups = (groups || []).map(group => {
        // Get all members for this group to calculate count and member_ids
        // This is simplified - in a real scenario you might need a separate query
        const memberCount = group.group_members?.length || 0;
        const memberIds = group.group_members?.map(m => m.user_id).join(',') || '';
        
        return {
          id: group.id,
          name: group.name,
          game_specialty: group.game_specialty,
          description: group.description,
          member_count: memberCount,
          member_ids: memberIds ? memberIds.split(',').map(Number) : []
        };
      }).filter(group => group.member_count >= 1 && group.member_count <= 5);

      console.log('✅ Found groups:', processedGroups.length);
      
      res.json({
        success: true,
        groups: processedGroups
      });
      
    } else {
      // POSTGRESQL VERSION - keep your original code
      const result = await db.query(`
        SELECT g.*, 
               COUNT(gm.user_id) as member_count,
               STRING_AGG(gm.user_id::text, ',') as member_ids
        FROM groups g
        JOIN group_members gm ON g.id = gm.group_id
        WHERE gm.user_id = $1 AND gm.role = 'admin' AND gm.status = 'joined'
        GROUP BY g.id
        HAVING COUNT(gm.user_id) BETWEEN 1 AND 5
      `, [userId]);

      // ✅ FIXED: Use result[0] for PostgreSQL pattern
      const groups = result[0] || [];
      
      console.log('✅ Found groups:', groups.length);
      
      res.json({
        success: true,
        groups: groups.map(group => ({
          id: group.id,
          name: group.name,
          game_specialty: group.game_specialty,
          description: group.description,
          member_count: parseInt(group.member_count),
          member_ids: group.member_ids ? group.member_ids.split(',').map(Number) : []
        }))
      });
    }
  } catch (error) {
    console.error('❌ Get user groups error:', error);
    console.error('❌ Error stack:', error.stack);
    
    res.status(500).json({
      success: false,
      error: 'Failed to fetch user groups: ' + error.message,
      debug: {
        message: error.message,
        code: error.code
      }
    });
  }
});

// GET /api/tournaments/my-tournaments - Get user's tournaments (FIXED)
router.get('/my-tournaments', async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.userId;
    
    console.log('🎯 Fetching tournaments for user ID:', userId);
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'User ID not found in token'
      });
    }

    if (db.isSupabase) {
      // SUPABASE VERSION - Complex query with counts
      // First, get tournaments where user is creator or participant
      const { data: tournaments, error } = await db.supabaseAdmin
        .from('tournaments')
        .select(`
          *,
          users!creator_id (
            username
          ),
          tournament_participants (
            user_id,
            status,
            group_id
          )
        `)
        .or(`creator_id.eq.${userId},and(tournament_participants.user_id.eq.${userId},tournament_participants.status.eq.joined)`)
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Process tournaments to add counts
      const processedTournaments = (tournaments || []).map(tournament => {
        const participants = tournament.tournament_participants || [];
        const joinedParticipants = participants.filter(p => p.status === 'joined');
        
        const current_players = joinedParticipants.length;
        const current_squads = tournament.type === 'squad' 
          ? new Set(joinedParticipants.filter(p => p.group_id).map(p => p.group_id)).size
          : 0;
        
        return {
          ...tournament,
          creator_name: tournament.users?.username,
          current_players,
          current_squads,
          tournament_participants: undefined // Remove the nested array
        };
      });

      console.log('✅ Found tournaments:', processedTournaments.length);
      
      res.json({
        success: true,
        tournaments: processedTournaments
      });
      
    } else {
      // POSTGRESQL VERSION - keep your original code
      const result = await db.query(`
        SELECT 
          t.*,
          u.username as creator_name,
          COUNT(DISTINCT CASE WHEN tp.status = 'joined' THEN tp.user_id END) as current_players,
          COUNT(DISTINCT CASE WHEN t.type = 'squad' AND tp.status = 'joined' THEN tp.group_id END) as current_squads
        FROM tournaments t
        LEFT JOIN users u ON t.creator_id = u.id
        LEFT JOIN tournament_participants tp ON t.id = tp.tournament_id
        WHERE t.creator_id = $1 OR EXISTS (
          SELECT 1 FROM tournament_participants tp2 
          WHERE tp2.tournament_id = t.id 
            AND tp2.user_id = $2 
            AND tp2.status = 'joined'
        )
        GROUP BY t.id, u.username
        ORDER BY t.created_at DESC
      `, [userId, userId]);

      const tournaments = result[0] || [];
      
      console.log('✅ Found tournaments:', tournaments.length);
      
      res.json({
        success: true,
        tournaments: tournaments
      });
    }
  } catch (error) {
    console.error('❌ Error fetching user tournaments:', error);
    console.error('❌ Error stack:', error.stack);
    res.status(500).json({ 
      success: false, 
      error: 'Server error fetching tournaments',
      debug: error.message
    });
  }
});

// GET /api/tournaments/:id/squads - Get registered squads
router.get('/:id/squads', async (req, res) => {
  try {
    const tournamentId = req.params.id;

    if (db.isSupabase) {
      // SUPABASE VERSION
      const { data: squads, error } = await db.supabaseAdmin
        .from('tournament_participants')
        .select(`
          group_id,
          groups!inner (
            name
          ),
          users!inner (
            id,
            username
          ),
          created_at
        `)
        .eq('tournament_id', tournamentId)
        .not('group_id', 'is', null)
        .order('created_at', { ascending: true });

      if (error) throw error;

      // Process to group by group_id
      const groupedSquads = {};
      (squads || []).forEach(item => {
        const groupId = item.group_id;
        if (!groupedSquads[groupId]) {
          groupedSquads[groupId] = {
            group_id: groupId,
            group_name: item.groups?.name || 'Unknown Group',
            members: [],
            registered_at: item.created_at
          };
        }
        if (item.users) {
          groupedSquads[groupId].members.push(item.users.username);
        }
      });

      const formattedSquads = Object.values(groupedSquads).map(squad => ({
        group_id: squad.group_id,
        group_name: squad.group_name,
        squad_size: squad.members.length,
        members: squad.members.join(','),
        registered_at: squad.registered_at
      }));

      res.json({
        success: true,
        squads: formattedSquads,
        tournament_id: tournamentId
      });
      
    } else {
      // POSTGRESQL VERSION - keep your original code
      const result = await db.query(`
        SELECT 
          tp.group_id,
          g.name as group_name,
          COUNT(DISTINCT tp.user_id) as squad_size,
          STRING_AGG(DISTINCT u.username, ',' ORDER BY u.username) as members,
          MAX(tp.created_at) as registered_at
        FROM tournament_participants tp
        JOIN groups g ON tp.group_id = g.id
        JOIN users u ON tp.user_id = u.id
        WHERE tp.tournament_id = $1 AND tp.group_id IS NOT NULL
        GROUP BY tp.group_id, g.name
        ORDER BY registered_at ASC
      `, [tournamentId]);

      res.json({
        success: true,
        squads: result[0] || [],
        tournament_id: tournamentId
      });
    }
  } catch (error) {
    console.error('❌ Get squads error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch squads'
    });
  }
});

// POST /api/tournaments/:id/validate-group - Validate group for tournament
router.post('/:id/validate-group', async (req, res) => {
  try {
    const tournamentId = req.params.id;
    const userId = req.user.id;
    const { group_id } = req.body;

    if (db.isSupabase) {
      // SUPABASE VERSION
      
      // Get tournament
      const { data: tournament, error: tournamentError } = await db.supabaseAdmin
        .from('tournaments')
        .select('type, max_squads')
        .eq('id', tournamentId)
        .single();

      if (tournamentError || !tournament) {
        return res.status(404).json({
          eligible: false,
          error: 'Tournament not found'
        });
      }

      // Check if user is group admin
      const { data: isGroupAdmin, error: adminError } = await db.supabaseAdmin
        .from('group_members')
        .select('*', { count: 'exact', head: true })
        .eq('group_id', group_id)
        .eq('user_id', userId)
        .eq('role', 'admin')
        .eq('status', 'joined');

      if (adminError) throw adminError;
      
      if (isGroupAdmin === 0) {
        return res.json({
          eligible: false,
          message: 'You must be a group admin'
        });
      }

      // Check group size
      const { count: memberCount, error: memberCountError } = await db.supabaseAdmin
        .from('group_members')
        .select('*', { count: 'exact', head: true })
        .eq('group_id', group_id)
        .eq('status', 'joined');

      if (memberCountError) throw memberCountError;

      if (memberCount < 1 || memberCount > 5) {
        return res.json({
          eligible: false,
          message: 'Group must have 1-5 members'
        });
      }

      // Check if group already registered
      const { count: groupInTournament, error: groupInError } = await db.supabaseAdmin
        .from('tournament_participants')
        .select('*', { count: 'exact', head: true })
        .eq('tournament_id', tournamentId)
        .eq('group_id', group_id)
        .limit(1);

      if (groupInError) throw groupInError;

      if (groupInTournament > 0) {
        return res.json({
          eligible: false,
          message: 'Group already registered'
        });
      }

      // Check for member conflicts
      // First get group members
      const { data: groupMembers, error: membersError } = await db.supabaseAdmin
        .from('group_members')
        .select('user_id')
        .eq('group_id', group_id)
        .eq('status', 'joined');

      if (membersError) throw membersError;

      const memberIds = groupMembers.map(m => m.user_id);

      // Check if any member is in tournament with different group
      const { data: conflicts, error: conflictsError } = await db.supabaseAdmin
        .from('tournament_participants')
        .select(`
          user_id,
          group_id,
          groups!inner (
            name
          ),
          users!inner (
            id,
            username
          )
        `)
        .eq('tournament_id', tournamentId)
        .eq('status', 'joined')
        .in('user_id', memberIds)
        .neq('group_id', group_id);

      if (conflictsError) throw conflictsError;

      // Check max squads
      const { count: currentSquads, error: squadCountError } = await db.supabaseAdmin
        .from('tournament_participants')
        .select('*', { count: 'exact', head: true })
        .eq('tournament_id', tournamentId)
        .not('group_id', 'is', null);

      if (squadCountError) throw squadCountError;

      const canRegisterMoreSquads = currentSquads < tournament.max_squads;

      // Format conflicts
      const formattedConflicts = (conflicts || []).map(c => ({
        user_id: c.users?.id,
        username: c.users?.username,
        existing_group: c.groups?.name
      }));

      return res.json({
        eligible: formattedConflicts.length === 0 && canRegisterMoreSquads,
        conflicts: formattedConflicts,
        group_already_registered: groupInTournament > 0,
        member_count: memberCount,
        valid_member_count: memberCount >= 1 && memberCount <= 5,
        max_squads_reached: !canRegisterMoreSquads,
        current_squads: currentSquads,
        max_squads_allowed: tournament.max_squads
      });
      
    } else {
      // POSTGRESQL VERSION - keep your original code
      // Get tournament
      const tournamentResult = await db.query(
        `SELECT type, max_squads FROM tournaments WHERE id = $1`,
        [tournamentId]
      );

      if (tournamentResult[0].length === 0) {
        return res.status(404).json({
          eligible: false,
          error: 'Tournament not found'
        });
      }

      const tournament = tournamentResult[0][0];

      // Check if user is group admin
      const isGroupAdminResult = await db.query(`
        SELECT 1 FROM group_members 
        WHERE group_id = $1 AND user_id = $2 AND role = 'admin' AND status = 'joined'
      `, [group_id, userId]);

      if (isGroupAdminResult[0].length === 0) {
        return res.json({
          eligible: false,
          message: 'You must be a group admin'
        });
      }

      // Check group size
      const groupMembersResult = await db.query(`
        SELECT COUNT(*) as member_count FROM group_members 
        WHERE group_id = $1 AND status = 'joined'
      `, [group_id]);

      if (groupMembersResult[0][0].member_count < 1 || groupMembersResult[0][0].member_count > 5) {
        return res.json({
          eligible: false,
          message: 'Group must have 1-5 members'
        });
      }

      // Check if group already registered
      const groupInTournamentResult = await db.query(`
        SELECT 1 FROM tournament_participants 
        WHERE tournament_id = $1 AND group_id = $2
        LIMIT 1
      `, [tournamentId, group_id]);

      if (groupInTournamentResult[0].length > 0) {
        return res.json({
          eligible: false,
          message: 'Group already registered'
        });
      }

      // Check for member conflicts
      const conflictsResult = await db.query(`
        SELECT DISTINCT u.id, u.username, tp.group_id as existing_group_id, g.name as existing_group_name
        FROM group_members gm
        JOIN users u ON gm.user_id = u.id
        JOIN tournament_participants tp ON gm.user_id = tp.user_id
        JOIN groups g ON tp.group_id = g.id
        WHERE gm.group_id = $1 
          AND tp.tournament_id = $2
          AND tp.status = 'joined'
          AND tp.group_id != $3
      `, [group_id, tournamentId, group_id]);

      // Check max squads
      const currentSquadsResult = await db.query(`
        SELECT COUNT(DISTINCT group_id) as squad_count 
        FROM tournament_participants 
        WHERE tournament_id = $1 AND group_id IS NOT NULL
      `, [tournamentId]);

      const canRegisterMoreSquads = currentSquadsResult[0][0].squad_count < tournament.max_squads;

      return res.json({
        eligible: conflictsResult[0].length === 0 && canRegisterMoreSquads,
        conflicts: conflictsResult[0].map(c => ({
          user_id: c.id,
          username: c.username,
          existing_group: c.existing_group_name
        })),
        group_already_registered: groupInTournamentResult[0].length > 0,
        member_count: groupMembersResult[0][0].member_count,
        valid_member_count: groupMembersResult[0][0].member_count >= 1 && groupMembersResult[0][0].member_count <= 5,
        max_squads_reached: !canRegisterMoreSquads,
        current_squads: currentSquadsResult[0][0].squad_count,
        max_squads_allowed: tournament.max_squads
      });
    }
  } catch (error) {
    console.error('❌ Validate group error:', error);
    res.status(500).json({
      eligible: false,
      error: 'Validation failed: ' + error.message
    });
  }
});

// POST /api/tournaments/:id/matches/:matchId/result - Submit match result (FULLY DEBUGGED - FIXED)
router.post('/:id/matches/:matchId/result', async (req, res) => {
  try {
    const tournamentId = req.params.id;
    const matchId = req.params.matchId;
    const { winnerId, proof, notes } = req.body;
    const userId = req.user.userId || req.user.id;

    console.log('🏆 SUBMIT MATCH RESULT:', { tournamentId, matchId, winnerId, userId });

    if (db.isSupabase) {
      // SUPABASE VERSION - Will need to execute sequentially
      try {
        // Get match details
        console.log('📋 Fetching match details...');
       // First get the match
const { data: match, error: matchError } = await db.supabaseAdmin
  .from('tournament_matches')
  .select('*')
  .eq('id', matchId)
  .eq('tournament_id', tournamentId)
  .single();

if (matchError || !match) {
  throw new Error('Match not found');
}

// Then get the tournament details separately
const { data: tournamentDetails, error: tournamentError } = await db.supabaseAdmin
  .from('tournaments')
  .select('type, prize_pool, xp_entry_fee, prize_pool_option, custom_prize_pool, name, status')
  .eq('id', tournamentId)
  .single();

if (tournamentError) {
  throw new Error('Tournament not found');
}

// Combine them
match.tournaments = tournamentDetails;
        
        console.log('🔍 MATCH DETAILS:', {
          matchId,
          player1_id: match.player1_id,
          player2_id: match.player2_id,
          currentStatus: match.status,
          tournamentType: match.tournaments.type,
          tournamentStatus: match.tournaments.tournament_status,
          tournamentName: match.tournaments.tournament_name,
          roundNumber: match.round_number
        });

        // Validate user is participant
        if (match.player1_id !== userId && match.player2_id !== userId) {
          throw new Error('You are not a participant in this match');
        }

        // Validate match status
        if (match.status === 'completed') {
          throw new Error('Match is already completed');
        }

        // Validate match is ready
        if (!match.player1_id || !match.player2_id) {
          throw new Error('Match is not ready - waiting for players');
        }

        // Validate winner
        if (winnerId !== match.player1_id && winnerId !== match.player2_id) {
          throw new Error('Invalid winner selection');
        }

        const loserId = winnerId === match.player1_id ? match.player2_id : match.player1_id;

        console.log('✅ VALIDATION PASSED. Starting database updates...');

        // ========== UPDATE MATCH STATUS ==========
        console.log('🔄 Step 1: Updating match status...');
        const { error: updateError } = await db.supabaseAdmin
          .from('tournament_matches')
          .update({ 
            winner_id: winnerId, 
            status: 'completed', 
            completed_at: new Date().toISOString() 
          })
          .eq('id', matchId);
        
        if (updateError) throw updateError;
        console.log(`✅ MATCH ${matchId} UPDATED: winner=${winnerId}, status=completed`);
        
        // VERIFY the update
        const { data: verifyMatch } = await db.supabaseAdmin
          .from('tournament_matches')
          .select('status, winner_id')
          .eq('id', matchId)
          .single();
        
        console.log(`🔍 VERIFIED Match ${matchId}:`, verifyMatch);

        // ========== RECORD MATCH HISTORY ==========
        try {
          console.log('🔄 Step 2: Recording match history...');
          
          // Try to insert with scores first
          try {
            const { error: historyError } = await db.supabaseAdmin
              .from('match_history')
              .insert([{
                tournament_id: tournamentId,
                winner_id: winnerId,
                loser_id: loserId,
                winner_score: 1,
                loser_score: 0,
                match_date: new Date().toISOString(),
                is_final: false,
                round_number: match.round_number
              }]);
            
            if (historyError) {
              console.log('⚠️ History insert with scores failed, trying without scores...');
              // Try without scores
              const { error: historyError2 } = await db.supabaseAdmin
                .from('match_history')
                .insert([{
                  tournament_id: tournamentId,
                  winner_id: winnerId,
                  loser_id: loserId,
                  match_date: new Date().toISOString(),
                  is_final: false,
                  round_number: match.round_number
                }]);
              
              if (historyError2) {
                console.log('⚠️ Could not record match history, continuing...');
              } else {
                console.log('✅ MATCH HISTORY RECORDED (minimal fields)');
              }
            } else {
              console.log('✅ MATCH HISTORY RECORDED with scores (1-0)');
            }
          } catch (historyCatchError) {
            console.log('⚠️ Match history table issue, continuing...');
          }
        } catch (historyError) {
          console.error('❌ Failed to record history:', historyError);
          // Don't throw - continue with other updates
        }

        // ========== UPDATE PLAYER STATS ==========
        try {
          console.log('🔄 Step 3: Updating player stats...');
          
          // Update winner stats
          const { error: winnerStatsError } = await db.supabaseAdmin.rpc('increment_user_stats', {
            user_id: winnerId,
            wins_increment: 1,
            matches_played_increment: 1
          });
          
          if (winnerStatsError) {
            // Fallback to direct update
            await db.supabaseAdmin
              .from('users')
              .update({ 
                wins: db.supabaseAdmin.raw('wins + 1'),
                matches_played: db.supabaseAdmin.raw('matches_played + 1')
              })
              .eq('id', winnerId);
          }

          // Update loser stats
          const { error: loserStatsError } = await db.supabaseAdmin.rpc('increment_user_stats', {
            user_id: loserId,
            losses_increment: 1,
            matches_played_increment: 1
          });
          
          if (loserStatsError) {
            // Fallback to direct update
            await db.supabaseAdmin
              .from('users')
              .update({ 
                losses: db.supabaseAdmin.raw('losses + 1'),
                matches_played: db.supabaseAdmin.raw('matches_played + 1')
              })
              .eq('id', loserId);
          }
          
          console.log('✅ PLAYER STATS UPDATED');
        } catch (statsError) {
          console.error('❌ Failed to update stats:', statsError);
          throw statsError;
        }

        // ========== RECALCULATE WIN RATES ==========
        try {
          console.log('🔄 Step 4: Recalculating win rates...');
          
          // Get winner stats
          const { data: winnerStats } = await db.supabaseAdmin
            .from('users')
            .select('wins, matches_played')
            .eq('id', winnerId)
            .single();
          
          if (winnerStats && winnerStats.matches_played > 0) {
            const winnerWinRate = (winnerStats.wins * 100.0) / winnerStats.matches_played;
            await db.supabaseAdmin
              .from('users')
              .update({ win_rate: Math.round(winnerWinRate * 100) / 100 })
              .eq('id', winnerId);
          }

          // Get loser stats
          const { data: loserStats } = await db.supabaseAdmin
            .from('users')
            .select('wins, matches_played')
            .eq('id', loserId)
            .single();
          
          if (loserStats && loserStats.matches_played > 0) {
            const loserWinRate = (loserStats.wins * 100.0) / loserStats.matches_played;
            await db.supabaseAdmin
              .from('users')
              .update({ win_rate: Math.round(loserWinRate * 100) / 100 })
              .eq('id', loserId);
          }
          
          console.log('✅ WIN RATES UPDATED');
        } catch (winrateError) {
          console.error('❌ Failed to update win rates:', winrateError);
          // Don't throw - continue
        }

        // ========== UPDATE USER RANKS ==========
        try {
          console.log('🔄 Step 5: Updating user ranks...');
          await updateUserRankSupabase(winnerId);
          await updateUserRankSupabase(loserId);
          console.log('✅ USER RANKS UPDATED');
        } catch (rankError) {
          console.error('❌ Failed to update ranks:', rankError);
          // Don't throw - continue
        }

        // ========== RECORD MATCH PROOF ==========
        if (proof) {
          try {
            console.log('🔄 Step 6: Recording match proof...');
            const { error: proofError } = await db.supabaseAdmin
              .from('match_proofs')
              .insert([{
                match_id: matchId,
                user_id: userId,
                proof_path: proof,
                proof_type: 'screenshot',
                description: notes || 'Match result proof',
                created_at: new Date().toISOString()
              }]);
            
            if (proofError) throw proofError;
            console.log('✅ MATCH PROOF RECORDED');
          } catch (proofError) {
            console.error('❌ Failed to record proof:', proofError);
            // Don't throw - continue
          }
        }

        // ========== RECORD MATCH ATTEMPT ==========
        try {
          console.log('🔄 Step 7: Recording match attempt...');
          
          const { data: winnerRank } = await db.supabaseAdmin
            .from('users')
            .select('rank')
            .eq('id', winnerId)
            .single();
          
          const { data: loserRank } = await db.supabaseAdmin
            .from('users')
            .select('rank')
            .eq('id', loserId)
            .single();

          const { error: attemptError } = await db.supabaseAdmin
            .from('match_attempts')
            .insert([{
              player1_id: winnerId,
              player2_id: loserId,
              player1_rank: winnerRank?.rank || 'E',
              player2_rank: loserRank?.rank || 'E',
              match_id: matchId,
              created_at: new Date().toISOString()
            }]);
          
          if (attemptError) throw attemptError;
          console.log('✅ MATCH ATTEMPT RECORDED');
        } catch (attemptError) {
          console.error('❌ Failed to record match attempt:', attemptError);
          // Don't throw - continue
        }

        // ========== AUTOMATIC ADVANCEMENT ==========
        console.log('🚨 DEBUG TOURNAMENT TYPE:', {
          type: match.tournaments.type,
          is1v1: match.tournaments.type === '1v1',
          isOneVsOne: match.tournaments.type === 'onevsone',
          lowerCaseType: match.tournaments.type.toLowerCase(),
          shouldAdvance: match.tournaments.type === '1v1' || match.tournaments.type === 'onevsone'
        });
        
        // FIXED TOURNAMENT TYPE CHECK
        const tournamentType = match.tournaments.type.toLowerCase();
        const shouldAdvance = tournamentType === '1v1' || tournamentType === 'onevsone' || tournamentType === 'one_vs_one';
        
        console.log(`🔍 TOURNAMENT TYPE CHECK: "${match.tournaments.type}" -> "${tournamentType}"`);
        console.log(`🔍 Should advance: ${shouldAdvance}`);
        
        if (shouldAdvance) {
          console.log(`🚀 AUTOMATICALLY ADVANCING WINNER ${winnerId} TO NEXT ROUND`);
          
          try {
            console.log(`🎯 Calling advanceWinnerToNextRoundSupabase function...`);
            const nextMatchId = await advanceWinnerToNextRoundSupabase(tournamentId, matchId, winnerId, match.round_number);
            
            if (nextMatchId) {
              console.log(`✅ WINNER ${winnerId} ADVANCED TO MATCH ${nextMatchId}`);
              
              // Check if next match is now ready
              const { data: nextMatch } = await db.supabaseAdmin
                .from('tournament_matches')
                .select('player1_id, player2_id, status')
                .eq('id', nextMatchId)
                .single();
              
              if (nextMatch?.player1_id && nextMatch?.player2_id) {
                // Schedule the match for 15 minutes from now
                const matchTime = new Date(Date.now() + 15 * 60000);
                await db.supabaseAdmin
                  .from('tournament_matches')
                  .update({ match_time: matchTime.toISOString(), status: 'upcoming' })
                  .eq('id', nextMatchId);
                console.log(`⏰ NEXT MATCH ${nextMatchId} SCHEDULED FOR ${matchTime}`);
              }
            } else {
              console.log(`⚠️ advanceWinnerToNextRoundSupabase returned null/undefined`);
              
              // Try manual bracket logic as fallback
              await manualBracketAdvancementSupabase(tournamentId, matchId, winnerId, match.round_number);
            }
          } catch (advanceError) {
            console.error('❌ Advance function error:', advanceError);
            
            // Try manual advancement as fallback
            console.log('🔄 Trying manual advancement as fallback...');
            try {
              await manualBracketAdvancementSupabase(tournamentId, matchId, winnerId, match.round_number);
            } catch (manualError) {
              console.error('❌ Manual advancement also failed:', manualError);
            }
            // Don't fail the whole transaction if advance fails
          }
        } else {
          console.log(`ℹ️ Tournament type "${tournamentType}", not advancing winner`);
        }

        // ========== CHECK TOURNAMENT COMPLETION ==========
        try {
          console.log('🔄 Checking tournament completion...');
          const tournamentCompleted = await checkTournamentCompletionSupabase(tournamentId, false);
          console.log(`✅ Tournament completion check: ${tournamentCompleted}`);
        } catch (completionError) {
          console.error('❌ Tournament completion check failed:', completionError);
          // Don't throw - continue
        }

        // ========== SEND NOTIFICATIONS ==========
        try {
          console.log('🔄 Sending notifications...');
          
          const { data: winnerUser } = await db.supabaseAdmin
            .from('users')
            .select('username')
            .eq('id', winnerId)
            .single();
          
          const { data: loserUser } = await db.supabaseAdmin
            .from('users')
            .select('username')
            .eq('id', loserId)
            .single();

          // Winner notification
          await db.supabaseAdmin
            .from('notifications')
            .insert([{
              user_id: winnerId,
              sender_id: userId,
              message: `You won your match against ${loserUser?.username || 'opponent'} in tournament ${match.tournaments.tournament_name}!`,
              type: 'system',
              status: 'unread',
              match_id: matchId,
              tournament_id: tournamentId,
              created_at: new Date().toISOString()
            }]);
          
          // Loser notification
          await db.supabaseAdmin
            .from('notifications')
            .insert([{
              user_id: loserId,
              sender_id: userId,
              message: `Match result submitted: You lost to ${winnerUser?.username || 'opponent'} in tournament ${match.tournaments.tournament_name}.`,
              type: 'system',
              status: 'unread',
              match_id: matchId,
              tournament_id: tournamentId,
              created_at: new Date().toISOString()
            }]);
          
          console.log('✅ NOTIFICATIONS SENT');
        } catch (notificationError) {
          console.error('❌ Failed to send notifications:', notificationError);
          // Don't throw - continue
        }

        console.log(`✅ TRANSACTION COMPLETED - MATCH ${matchId} COMPLETED SUCCESSFULLY`);

        res.json({
          success: true,
          message: 'Match result submitted successfully!',
          tournament_completed: false,
          winner_advanced: shouldAdvance
        });

      } catch (error) {
        console.error('❌ TRANSACTION ERROR:', error);
        throw error;
      }
      
    } else {
      // POSTGRESQL VERSION - keep your original code (entire block)
      await withTransaction(async (client) => {
        try {
          // Get match details
          console.log('📋 Fetching match details...');
          const matchResult = await client.query(`
            SELECT tm.*, t.type as tournament_type, t.prize_pool, t.xp_entry_fee as entry_fee,
                   t.prize_pool_option, t.custom_prize_pool, t.name as tournament_name,
                   t.status as tournament_status
            FROM tournament_matches tm
            JOIN tournaments t ON tm.tournament_id = t.id
            WHERE tm.id = $1 AND tm.tournament_id = $2
          `, [matchId, tournamentId]);
          
          if (matchResult[0].length === 0) {
            throw new Error('Match not found');
          }

          const match = matchResult[0][0];
          
          console.log('🔍 MATCH DETAILS:', {
            matchId,
            player1_id: match.player1_id,
            player2_id: match.player2_id,
            currentStatus: match.status,
            tournamentType: match.tournament_type,
            tournamentStatus: match.tournament_status,
            tournamentName: match.tournament_name,
            roundNumber: match.round_number
          });

          // Validate user is participant
          if (match.player1_id !== userId && match.player2_id !== userId) {
            throw new Error('You are not a participant in this match');
          }

          // Validate match status
          if (match.status === 'completed') {
            throw new Error('Match is already completed');
          }

          // Validate match is ready
          if (!match.player1_id || !match.player2_id) {
            throw new Error('Match is not ready - waiting for players');
          }

          // Validate winner
          if (winnerId !== match.player1_id && winnerId !== match.player2_id) {
            throw new Error('Invalid winner selection');
          }

          const loserId = winnerId === match.player1_id ? match.player2_id : match.player1_id;

          console.log('✅ VALIDATION PASSED. Starting database updates...');

          // ========== UPDATE MATCH STATUS ==========
          try {
            console.log('🔄 Step 1: Updating match status...');
            await client.query(`
              UPDATE tournament_matches 
              SET winner_id = $1, status = 'completed', completed_at = NOW()
              WHERE id = $2
            `, [winnerId, matchId]);
            console.log(`✅ MATCH ${matchId} UPDATED: winner=${winnerId}, status=completed`);
           // VERIFY the update
    const verifyResult = await client.query(
      `SELECT status, winner_id FROM tournament_matches WHERE id = $1`,
      [matchId]
    );
    console.log(`🔍 VERIFIED Match ${matchId}:`, verifyResult[0][0]);
  } catch (updateError) {
    console.error('❌ Failed to update match:', updateError);
    throw updateError;
  }

          // ========== RECORD MATCH HISTORY ==========
          try {
            console.log('🔄 Step 2: Recording match history...');
            
            // FIX: Check if match_history table exists and has required columns
            try {
              // First check if table exists and has score columns
              const checkColumns = await client.query(`
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_schema = 'public' 
                  AND table_name = 'match_history'
                  AND column_name IN ('winner_score', 'loser_score')
              `);
              
              const hasScoreColumns = checkColumns[0] && checkColumns[0].some(col => 
                col.column_name === 'winner_score' || col.column_name === 'loser_score'
              );
              
              if (hasScoreColumns) {
                // Insert with scores (default 1-0)
                await client.query(`
                  INSERT INTO match_history 
                  (tournament_id, winner_id, loser_id, winner_score, loser_score, match_date, is_final, round_number)
                  VALUES ($1, $2, $3, $4, $5, NOW(), false, $6)
                `, [tournamentId, winnerId, loserId, 1, 0, match.round_number]);
                console.log('✅ MATCH HISTORY RECORDED with scores (1-0)');
              } else {
                // Insert without scores
                await client.query(`
                  INSERT INTO match_history 
                  (tournament_id, winner_id, loser_id, match_date, is_final, round_number)
                  VALUES ($1, $2, $3, NOW(), false, $4)
                `, [tournamentId, winnerId, loserId, match.round_number]);
                console.log('✅ MATCH HISTORY RECORDED without scores');
              }
            } catch (tableError) {
              // Table might not exist or have different structure
              console.log('⚠️ Match history table issue, trying alternative...');
              try {
                // Try minimal insert
                await client.query(`
                  INSERT INTO match_history 
                  (tournament_id, winner_id, loser_id, match_date, round_number)
                  VALUES ($1, $2, $3, NOW(), $4)
                `, [tournamentId, winnerId, loserId, match.round_number]);
                console.log('✅ MATCH HISTORY RECORDED (minimal fields)');
              } catch (minimalError) {
                console.log('⚠️ Could not record match history, continuing...');
              }
            }
          } catch (historyError) {
            console.error('❌ Failed to record history:', historyError);
            // Don't throw - continue with other updates
          }

          // ========== UPDATE PLAYER STATS ==========
          try {
            console.log('🔄 Step 3: Updating player stats...');
            await client.query(`
              UPDATE users 
              SET wins = wins + 1, matches_played = matches_played + 1
              WHERE id = $1
            `, [winnerId]);

            await client.query(`
              UPDATE users 
              SET losses = losses + 1, matches_played = matches_played + 1
              WHERE id = $1
            `, [loserId]);
            console.log('✅ PLAYER STATS UPDATED');
          } catch (statsError) {
            console.error('❌ Failed to update stats:', statsError);
            throw statsError;
          }

          // ========== RECALCULATE WIN RATES ==========
          try {
            console.log('🔄 Step 4: Recalculating win rates...');
            const winnerStatsResult = await client.query(
              `SELECT wins, matches_played FROM users WHERE id = $1`,
              [winnerId]
            );
            
            const loserStatsResult = await client.query(
              `SELECT wins, matches_played FROM users WHERE id = $1`,
              [loserId]
            );

            if (winnerStatsResult[0].length > 0 && winnerStatsResult[0][0].matches_played > 0) {
              const winnerWinRate = (winnerStatsResult[0][0].wins * 100.0) / winnerStatsResult[0][0].matches_played;
              await client.query(
                `UPDATE users SET win_rate = ROUND($1::numeric, 2) WHERE id = $2`,
                [winnerWinRate, winnerId]
              );
            }

            if (loserStatsResult[0].length > 0 && loserStatsResult[0][0].matches_played > 0) {
              const loserWinRate = (loserStatsResult[0][0].wins * 100.0) / loserStatsResult[0][0].matches_played;
              await client.query(
                `UPDATE users SET win_rate = ROUND($1::numeric, 2) WHERE id = $2`,
                [loserWinRate, loserId]
              );
            }
            console.log('✅ WIN RATES UPDATED');
          } catch (winrateError) {
            console.error('❌ Failed to update win rates:', winrateError);
            // Don't throw - continue
          }

          // ========== UPDATE USER RANKS ==========
          try {
            console.log('🔄 Step 5: Updating user ranks...');
            await updateUserRank(winnerId, client);
            await updateUserRank(loserId, client);
            console.log('✅ USER RANKS UPDATED');
          } catch (rankError) {
            console.error('❌ Failed to update ranks:', rankError);
            // Don't throw - continue
          }

          // ========== RECORD MATCH PROOF ==========
          if (proof) {
            try {
              console.log('🔄 Step 6: Recording match proof...');
              await client.query(`
                INSERT INTO match_proofs 
                (match_id, user_id, proof_path, proof_type, description, created_at)
                VALUES ($1, $2, $3, 'screenshot', $4, NOW())
              `, [matchId, userId, proof, notes || 'Match result proof']);
              console.log('✅ MATCH PROOF RECORDED');
            } catch (proofError) {
              console.error('❌ Failed to record proof:', proofError);
              // Don't throw - continue
            }
          }

          // ========== RECORD MATCH ATTEMPT ==========
          try {
            console.log('🔄 Step 7: Recording match attempt...');
            const winnerRankResult = await client.query(
              `SELECT rank FROM users WHERE id = $1`,
              [winnerId]
            );
            
            const loserRankResult = await client.query(
              `SELECT rank FROM users WHERE id = $1`,
              [loserId]
            );

            await client.query(`
              INSERT INTO match_attempts 
              (player1_id, player2_id, player1_rank, player2_rank, match_id, created_at)
              VALUES ($1, $2, $3, $4, $5, NOW())
            `, [winnerId, loserId, winnerRankResult[0][0]?.rank || 'E', loserRankResult[0][0]?.rank || 'E', matchId]);
            console.log('✅ MATCH ATTEMPT RECORDED');
          } catch (attemptError) {
            console.error('❌ Failed to record match attempt:', attemptError);
            // Don't throw - continue
          }

          // ========== AUTOMATIC ADVANCEMENT ==========
          console.log('🚨 DEBUG TOURNAMENT TYPE:', {
            type: match.tournament_type,
            is1v1: match.tournament_type === '1v1',
            isOneVsOne: match.tournament_type === 'onevsone',
            lowerCaseType: match.tournament_type.toLowerCase(),
            shouldAdvance: match.tournament_type === '1v1' || match.tournament_type === 'onevsone'
          });
          
          // FIXED TOURNAMENT TYPE CHECK
          const tournamentType = match.tournament_type.toLowerCase();
          const shouldAdvance = tournamentType === '1v1' || tournamentType === 'onevsone' || tournamentType === 'one_vs_one';
          
          console.log(`🔍 TOURNAMENT TYPE CHECK: "${match.tournament_type}" -> "${tournamentType}"`);
          console.log(`🔍 Should advance: ${shouldAdvance}`);
          
          if (shouldAdvance) {
            console.log(`🚀 AUTOMATICALLY ADVANCING WINNER ${winnerId} TO NEXT ROUND`);
            
            try {
              console.log(`🎯 Calling advanceWinnerToNextRound function...`);
              const nextMatchId = await advanceWinnerToNextRound(tournamentId, matchId, winnerId, match.round_number, client);
              
              if (nextMatchId) {
                console.log(`✅ WINNER ${winnerId} ADVANCED TO MATCH ${nextMatchId}`);
                
                // Check if next match is now ready
                const nextMatchResult = await client.query(
                  `SELECT player1_id, player2_id, status FROM tournament_matches WHERE id = $1`,
                  [nextMatchId]
                );
                
                if (nextMatchResult[0][0]?.player1_id && nextMatchResult[0][0]?.player2_id) {
                  // Schedule the match for 15 minutes from now
                  const matchTime = new Date(Date.now() + 15 * 60000);
                  await client.query(
                    `UPDATE tournament_matches SET match_time = $1, status = 'upcoming' WHERE id = $2`,
                    [matchTime, nextMatchId]
                  );
                  console.log(`⏰ NEXT MATCH ${nextMatchId} SCHEDULED FOR ${matchTime}`);
                }
              } else {
                console.log(`⚠️ advanceWinnerToNextRound returned null/undefined`);
                
                // DEBUG: Check what advanceWinnerToNextRound is doing
                console.log(`🔍 DEBUG advanceWinnerToNextRound call details:`, {
                  tournamentId,
                  matchId,
                  winnerId,
                  currentRound: match.round_number
                });
                
                // Try manual bracket logic as fallback
                await manualBracketAdvancement(tournamentId, matchId, winnerId, match.round_number, client);
              }
            } catch (advanceError) {
              console.error('❌ Advance function error:', advanceError);
              console.error('❌ Advance error stack:', advanceError.stack);
              
              // Try manual advancement as fallback
              console.log('🔄 Trying manual advancement as fallback...');
              try {
                await manualBracketAdvancement(tournamentId, matchId, winnerId, match.round_number, client);
              } catch (manualError) {
                console.error('❌ Manual advancement also failed:', manualError);
              }
              // Don't fail the whole transaction if advance fails
            }
          } else {
            console.log(`ℹ️ Tournament type "${tournamentType}", not advancing winner`);
          }

          // ========== CHECK TOURNAMENT COMPLETION ==========
          try {
            console.log('🔄 Checking tournament completion...');
            const tournamentCompleted = await checkTournamentCompletion(tournamentId, false, client);
            console.log(`✅ Tournament completion check: ${tournamentCompleted}`);
          } catch (completionError) {
            console.error('❌ Tournament completion check failed:', completionError);
            // Don't throw - continue
          }

          // ========== SEND NOTIFICATIONS ==========
          try {
            console.log('🔄 Sending notifications...');
            const winnerUserResult = await client.query(
              `SELECT username FROM users WHERE id = $1`,
              [winnerId]
            );
            
            const loserUserResult = await client.query(
              `SELECT username FROM users WHERE id = $1`,
              [loserId]
            );

            await client.query(`
              INSERT INTO notifications 
              (user_id, sender_id, message, type, status, match_id, tournament_id, created_at)
              VALUES ($1, $2, $3, 'system', 'unread', $4, $5, NOW())
            `, [
              winnerId,
              userId,
              `You won your match against ${loserUserResult[0][0]?.username || 'opponent'} in tournament ${match.tournament_name}!`,
              matchId,
              tournamentId
            ]);
            
            await client.query(`
              INSERT INTO notifications 
              (user_id, sender_id, message, type, status, match_id, tournament_id, created_at)
              VALUES ($1, $2, $3, 'system', 'unread', $4, $5, NOW())
            `, [
              loserId,
              userId,
              `Match result submitted: You lost to ${winnerUserResult[0][0]?.username || 'opponent'} in tournament ${match.tournament_name}.`,
              matchId,
              tournamentId
            ]);
            console.log('✅ NOTIFICATIONS SENT');
          } catch (notificationError) {
            console.error('❌ Failed to send notifications:', notificationError);
            // Don't throw - continue
          }

          console.log(`✅ TRANSACTION COMMITTED - MATCH ${matchId} COMPLETED SUCCESSFULLY`);

        } catch (error) {
          console.error('❌ TRANSACTION ERROR:', error);
          console.error('❌ Error message:', error.message);
          console.error('❌ Error stack:', error.stack);
          throw error;
        }
      });

      res.json({
        success: true,
        message: 'Match result submitted successfully!',
        tournament_completed: false, // Will be updated by frontend
        winner_advanced: true
      });
    }
  } catch (error) {
    console.error('❌ SUBMIT MATCH RESULT ERROR:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to submit match result: ' + error.message
    });
  }
});
// GET /api/tournaments/:id/matches - Get all matches for tournament
router.get('/:id/matches', async (req, res) => {
  try {
    const tournamentId = req.params.id;
    
    console.log('🎮 Fetching matches for tournament:', tournamentId);

    if (db.isSupabase) {
      // SUPABASE VERSION
      const { data: matches, error } = await db.supabaseAdmin
        .from('tournament_matches')
        .select(`
          *,
          player1:player1_id (id, username, rank),
          player2:player2_id (id, username, rank),
          winner:winner_id (id, username)
        `)
        .eq('tournament_id', tournamentId)
        .order('round_number', { ascending: true })
        .order('id', { ascending: true });

      if (error) throw error;

      // Format the response to match PostgreSQL structure
      const formattedMatches = (matches || []).map(match => ({
        id: match.id,
        tournament_id: match.tournament_id,
        player1_id: match.player1_id,
        player2_id: match.player2_id,
        winner_id: match.winner_id,
        round_number: match.round_number,
        status: match.status,
        match_time: match.match_time,
        completed_at: match.completed_at,
        created_at: match.created_at,
        updated_at: match.updated_at,
        player1_username: match.player1?.username,
        player1_rank: match.player1?.rank,
        player2_username: match.player2?.username,
        player2_rank: match.player2?.rank,
        winner_username: match.winner?.username
      }));

      console.log(`✅ Found ${formattedMatches.length} matches`);

      res.json({
        success: true,
        matches: formattedMatches,
        count: formattedMatches.length
      });
      
    } else {
      // POSTGRESQL VERSION - keep your original code
      const result = await db.query(`
        SELECT 
          tm.*,
          p1.username as player1_username,
          p1.rank as player1_rank,
          p2.username as player2_username,
          p2.rank as player2_rank,
          w.username as winner_username
        FROM tournament_matches tm
        LEFT JOIN users p1 ON tm.player1_id = p1.id
        LEFT JOIN users p2 ON tm.player2_id = p2.id
        LEFT JOIN users w ON tm.winner_id = w.id
        WHERE tm.tournament_id = $1
        ORDER BY tm.round_number ASC, tm.id ASC
      `, [tournamentId]);

      console.log(`✅ Found ${result[0].length} matches`);

      res.json({
        success: true,
        matches: result[0] || [],
        count: result[0].length
      });
    }
  } catch (error) {
    console.error('❌ Get matches error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch matches: ' + error.message
    });
  }
});

// GET /api/tournaments/:id/match-status/:matchId - Debug match status
router.get('/:id/match-status/:matchId', async (req, res) => {
  try {
    const tournamentId = req.params.id;
    const matchId = req.params.matchId;
    
    if (db.isSupabase) {
      // SUPABASE VERSION
      const { data: match, error } = await db.supabaseAdmin
        .from('tournament_matches')
        .select(`
          *,
          player1:player1_id (username),
          player2:player2_id (username),
          winner:winner_id (username)
        `)
        .eq('id', matchId)
        .eq('tournament_id', tournamentId)
        .single();

      if (error || !match) {
        return res.status(404).json({ success: false, error: 'Match not found' });
      }

      res.json({
        success: true,
        match: {
          ...match,
          player1_name: match.player1?.username,
          player2_name: match.player2?.username,
          winner_name: match.winner?.username
        },
        debug: {
          raw_winner_id: match.winner_id,
          winner_name: match.winner?.username,
          status: match.status,
          tournament_id: tournamentId,
          match_id: matchId
        }
      });
      
    } else {
      // POSTGRESQL VERSION - keep your original code
      const result = await db.query(`
        SELECT 
          tm.*,
          p1.username as player1_name,
          p2.username as player2_name,
          w.username as winner_name
        FROM tournament_matches tm
        LEFT JOIN users p1 ON tm.player1_id = p1.id
        LEFT JOIN users p2 ON tm.player2_id = p2.id
        LEFT JOIN users w ON tm.winner_id = w.id
        WHERE tm.id = $1 AND tm.tournament_id = $2
      `, [matchId, tournamentId]);
      
      if (result[0].length === 0) {
        return res.status(404).json({ success: false, error: 'Match not found' });
      }
      
      res.json({
        success: true,
        match: result[0][0],
        debug: {
          raw_winner_id: result[0][0].winner_id,
          winner_name: result[0][0].winner_name,
          status: result[0][0].status,
          tournament_id: tournamentId,
          match_id: matchId
        }
      });
    }
  } catch (error) {
    console.error('❌ Match status debug error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/tournaments/:id/manual-advance - COMPLETE FIXED VERSION
router.post('/:id/manual-advance', async (req, res) => {
  try {
    const tournamentId = req.params.id;
    const userId = req.user.userId || req.user.id;
    const { match_id, winner_id } = req.body;

    console.log('🔧 Manual advance request:', { tournamentId, match_id, winner_id });

    if (db.isSupabase) {
      // SUPABASE VERSION
      
      // 1. Get tournament details
      const { data: tournament, error: tournamentError } = await db.supabaseAdmin
        .from('tournaments')
        .select('creator_id, status, type')
        .eq('id', tournamentId)
        .single();

      if (tournamentError || !tournament) {
        return res.status(404).json({ success: false, error: 'Tournament not found' });
      }

      // 2. Check if user is creator
      if (parseInt(tournament.creator_id) !== parseInt(userId)) {
        return res.status(403).json({ success: false, error: 'Only tournament creator can manually advance' });
      }

      // 3. Get match details
      const { data: match, error: matchError } = await db.supabaseAdmin
        .from('tournament_matches')
        .select('round_number, winner_id, player1_id, player2_id')
        .eq('id', match_id)
        .eq('tournament_id', tournamentId)
        .single();

      if (matchError || !match) {
        return res.status(404).json({ success: false, error: 'Match not found' });
      }

      // 4. Verify match has winner
      if (!match.winner_id) {
        return res.status(400).json({ success: false, error: 'Match has no winner' });
      }

      if (parseInt(match.winner_id) !== parseInt(winner_id)) {
        return res.status(400).json({ success: false, error: 'Winner ID does not match' });
      }

      // 5. Check if winner is already in next round (prevent duplicates)
      const currentRound = match.round_number;
      const nextRound = currentRound + 1;

      // First check if winner is already in next round
      const { data: alreadyInNextRound, error: alreadyError } = await db.supabaseAdmin
        .from('tournament_matches')
        .select('id')
        .eq('tournament_id', tournamentId)
        .eq('round_number', nextRound)
        .or(`player1_id.eq.${winner_id},player2_id.eq.${winner_id}`)
        .limit(1);

      if (alreadyError) throw alreadyError;

      if (alreadyInNextRound && alreadyInNextRound.length > 0) {
        return res.status(400).json({ 
          success: false, 
          error: 'Winner is already in next round' 
        });
      }

      // 6. Find matches in next round
      const { data: nextMatches, error: nextMatchesError } = await db.supabaseAdmin
        .from('tournament_matches')
        .select('id, player1_id, player2_id')
        .eq('tournament_id', tournamentId)
        .eq('round_number', nextRound)
        .order('id', { ascending: true });

      if (nextMatchesError) throw nextMatchesError;

      if (!nextMatches || nextMatches.length === 0) {
        return res.status(400).json({ 
          success: false, 
          error: 'No next round matches found. Tournament might be complete.' 
        });
      }

      // 7. DYNAMIC BRACKET LOGIC - Find the correct next match based on bracket position
      const { data: currentMatches, error: currentMatchesError } = await db.supabaseAdmin
        .from('tournament_matches')
        .select('id')
        .eq('tournament_id', tournamentId)
        .eq('round_number', currentRound)
        .order('id', { ascending: true });

      if (currentMatchesError) throw currentMatchesError;

      console.log('🔍 Bracket calculation:', {
        currentRound,
        currentMatches: currentMatches?.map(m => m.id) || [],
        matchId: match_id,
        nextRound,
        nextMatches: nextMatches?.map(m => ({ id: m.id, player1: m.player1_id, player2: m.player2_id })) || []
      });

      // Find position of current match in its round
      const matchIndex = (currentMatches || []).findIndex(m => m.id === parseInt(match_id));
      
      if (matchIndex === -1) {
        return res.status(400).json({ 
          success: false, 
          error: 'Cannot determine bracket position for this match' 
        });
      }

      // Calculate which next match this winner should go to
      // Standard bracket: matches are paired (0,1 → 0), (2,3 → 1), etc.
      const nextMatchIndex = Math.floor(matchIndex / 2);
      
      if (nextMatchIndex >= (nextMatches || []).length) {
        return res.status(400).json({ 
          success: false, 
          error: 'No corresponding next match found' 
        });
      }

      const targetMatch = nextMatches[nextMatchIndex];
      const targetMatchId = targetMatch.id;
      
      // Determine which slot to fill (player1 for even index, player2 for odd)
      const targetSlot = matchIndex % 2 === 0 ? 'player1' : 'player2';

      console.log('🎯 Advancement details:', {
        matchIndex,
        nextMatchIndex,
        targetMatchId,
        targetSlot,
        currentMatchCount: currentMatches?.length || 0,
        nextMatchCount: nextMatches?.length || 0
      });

      // 8. Check if slot is already filled
      if (targetSlot === 'player1' && targetMatch.player1_id) {
        return res.status(400).json({ 
          success: false, 
          error: `Player1 slot in match ${targetMatchId} is already filled by user ${targetMatch.player1_id}` 
        });
      }
      
      if (targetSlot === 'player2' && targetMatch.player2_id) {
        return res.status(400).json({ 
          success: false, 
          error: `Player2 slot in match ${targetMatchId} is already filled by user ${targetMatch.player2_id}` 
        });
      }

      // 9. Update the next match
      const updateData = {};
      updateData[targetSlot] = winner_id;
      
      const { error: updateError } = await db.supabaseAdmin
        .from('tournament_matches')
        .update(updateData)
        .eq('id', targetMatchId);

      if (updateError) throw updateError;
      
      console.log(`✅ Set ${targetSlot} of match ${targetMatchId} to ${winner_id}`);

      // 10. Check if next match now has both players
      const { data: updatedMatch, error: updatedError } = await db.supabaseAdmin
        .from('tournament_matches')
        .select('player1_id, player2_id, status')
        .eq('id', targetMatchId)
        .single();

      if (updatedError) throw updatedError;

      console.log('🔍 Updated match status:', updatedMatch);

      if (updatedMatch.player1_id && updatedMatch.player2_id) {
        // Both players are set, schedule the match
        const matchTime = new Date(Date.now() + 15 * 60000); // 15 minutes from now
        await db.supabaseAdmin
          .from('tournament_matches')
          .update({ status: 'upcoming', match_time: matchTime.toISOString() })
          .eq('id', targetMatchId);
        
        console.log(`⏰ Match ${targetMatchId} scheduled for ${matchTime}`);
      }

      console.log(`✅ Manual advance successful: winner ${winner_id} added to match ${targetMatchId} (${targetSlot})`);

      // 11. Send notification to the advanced player
      const { data: winnerUser, error: winnerUserError } = await db.supabaseAdmin
        .from('users')
        .select('username')
        .eq('id', winner_id)
        .single();
      
      const winnerName = winnerUser?.username || 'Player';
      
      await db.supabaseAdmin
        .from('notifications')
        .insert([{
          user_id: winner_id,
          sender_id: userId,
          message: `You have been advanced to the next round in tournament! Your next match will start soon.`,
          type: 'system',
          status: 'unread',
          tournament_id: tournamentId,
          created_at: new Date().toISOString()
        }]);

      res.json({
        success: true,
        message: 'Winner advanced to next round!',
        next_match_id: targetMatchId,
        next_match_slot: targetSlot,
        scheduled: !!(updatedMatch.player1_id && updatedMatch.player2_id)
      });
      
    } else {
      // POSTGRESQL VERSION - keep your original code (entire block)
      // 1. Get tournament details
      const tournamentResult = await db.query(
        'SELECT creator_id, status, type FROM tournaments WHERE id = $1',
        [tournamentId]
      );

      if (tournamentResult[0].length === 0) {
        return res.status(404).json({ success: false, error: 'Tournament not found' });
      }

      const tournament = tournamentResult[0][0];

      // 2. Check if user is creator
      if (parseInt(tournament.creator_id) !== parseInt(userId)) {
        return res.status(403).json({ success: false, error: 'Only tournament creator can manually advance' });
      }

      // 3. Get match details
      const matchResult = await db.query(
        'SELECT round_number, winner_id, player1_id, player2_id FROM tournament_matches WHERE id = $1 AND tournament_id = $2',
        [match_id, tournamentId]
      );

      if (matchResult[0].length === 0) {
        return res.status(404).json({ success: false, error: 'Match not found' });
      }

      const match = matchResult[0][0];

      // 4. Verify match has winner
      if (!match.winner_id) {
        return res.status(400).json({ success: false, error: 'Match has no winner' });
      }

      if (parseInt(match.winner_id) !== parseInt(winner_id)) {
        return res.status(400).json({ success: false, error: 'Winner ID does not match' });
      }

      // 5. Check if winner is already in next round (prevent duplicates)
      const currentRound = match.round_number;
      const nextRound = currentRound + 1;

      // First check if winner is already in next round
      const alreadyInNextRoundResult = await db.query(
        `SELECT id FROM tournament_matches 
         WHERE tournament_id = $1 AND round_number = $2 
           AND (player1_id = $3 OR player2_id = $3)`,
        [tournamentId, nextRound, winner_id]
      );

      if (alreadyInNextRoundResult[0].length > 0) {
        return res.status(400).json({ 
          success: false, 
          error: 'Winner is already in next round' 
        });
      }

      // 6. Find matches in next round
      const nextMatchesResult = await db.query(
        'SELECT id, player1_id, player2_id FROM tournament_matches WHERE tournament_id = $1 AND round_number = $2 ORDER BY id ASC',
        [tournamentId, nextRound]
      );

      if (nextMatchesResult[0].length === 0) {
        return res.status(400).json({ 
          success: false, 
          error: 'No next round matches found. Tournament might be complete.' 
        });
      }

      // 7. DYNAMIC BRACKET LOGIC - Find the correct next match based on bracket position
      const currentMatchesResult = await db.query(
        'SELECT id FROM tournament_matches WHERE tournament_id = $1 AND round_number = $2 ORDER BY id ASC',
        [tournamentId, currentRound]
      );

      console.log('🔍 Bracket calculation:', {
        currentRound,
        currentMatches: currentMatchesResult[0].map(m => m.id),
        matchId: match_id,
        nextRound,
        nextMatches: nextMatchesResult[0].map(m => ({ id: m.id, player1: m.player1_id, player2: m.player2_id }))
      });

      // Find position of current match in its round
      const matchIndex = currentMatchesResult[0].findIndex(m => m.id === parseInt(match_id));
      
      if (matchIndex === -1) {
        return res.status(400).json({ 
          success: false, 
          error: 'Cannot determine bracket position for this match' 
        });
      }

      // Calculate which next match this winner should go to
      // Standard bracket: matches are paired (0,1 → 0), (2,3 → 1), etc.
      const nextMatchIndex = Math.floor(matchIndex / 2);
      
      if (nextMatchIndex >= nextMatchesResult[0].length) {
        return res.status(400).json({ 
          success: false, 
          error: 'No corresponding next match found' 
        });
      }

      const targetMatch = nextMatchesResult[0][nextMatchIndex];
      const targetMatchId = targetMatch.id;
      
      // Determine which slot to fill (player1 for even index, player2 for odd)
      const targetSlot = matchIndex % 2 === 0 ? 'player1' : 'player2';

      console.log('🎯 Advancement details:', {
        matchIndex,
        nextMatchIndex,
        targetMatchId,
        targetSlot,
        currentMatchCount: currentMatchesResult[0].length,
        nextMatchCount: nextMatchesResult[0].length
      });

      // 8. Check if slot is already filled
      if (targetSlot === 'player1' && targetMatch.player1_id) {
        return res.status(400).json({ 
          success: false, 
          error: `Player1 slot in match ${targetMatchId} is already filled by user ${targetMatch.player1_id}` 
        });
      }
      
      if (targetSlot === 'player2' && targetMatch.player2_id) {
        return res.status(400).json({ 
          success: false, 
          error: `Player2 slot in match ${targetMatchId} is already filled by user ${targetMatch.player2_id}` 
        });
      }

      // 9. Update the next match
      if (targetSlot === 'player1') {
        await db.query(
          'UPDATE tournament_matches SET player1_id = $1 WHERE id = $2',
          [winner_id, targetMatchId]
        );
        console.log(`✅ Set player1 of match ${targetMatchId} to ${winner_id}`);
      } else {
        await db.query(
          'UPDATE tournament_matches SET player2_id = $1 WHERE id = $2',
          [winner_id, targetMatchId]
        );
        console.log(`✅ Set player2 of match ${targetMatchId} to ${winner_id}`);
      }

      // 10. Check if next match now has both players
      const updatedMatchResult = await db.query(
        'SELECT player1_id, player2_id, status FROM tournament_matches WHERE id = $1',
        [targetMatchId]
      );

      const updatedMatch = updatedMatchResult[0][0];
      console.log('🔍 Updated match status:', updatedMatch);

      if (updatedMatch.player1_id && updatedMatch.player2_id) {
        // Both players are set, schedule the match
        const matchTime = new Date(Date.now() + 15 * 60000); // 15 minutes from now
        await db.query(
          'UPDATE tournament_matches SET status = $1, match_time = $2 WHERE id = $3',
          ['upcoming', matchTime, targetMatchId]
        );
        console.log(`⏰ Match ${targetMatchId} scheduled for ${matchTime}`);
      }

      console.log(`✅ Manual advance successful: winner ${winner_id} added to match ${targetMatchId} (${targetSlot})`);

      // 11. Send notification to the advanced player
      const winnerUserResult = await db.query(
        'SELECT username FROM users WHERE id = $1',
        [winner_id]
      );
      
      const winnerName = winnerUserResult[0][0]?.username || 'Player';
      
      await db.query(`
        INSERT INTO notifications 
        (user_id, sender_id, message, type, status, tournament_id, created_at)
        VALUES ($1, $2, $3, 'system', 'unread', $4, NOW())
      `, [
        winner_id,
        userId,
        `You have been advanced to the next round in tournament! Your next match will start soon.`,
        tournamentId
      ]);

      res.json({
        success: true,
        message: 'Winner advanced to next round!',
        next_match_id: targetMatchId,
        next_match_slot: targetSlot,
        scheduled: updatedMatch.player1_id && updatedMatch.player2_id
      });
    }
  } catch (error) {
    console.error('❌ Manual advance error:', error);
    console.error('❌ Error stack:', error.stack);
    res.status(500).json({
      success: false,
      error: 'Failed to manually advance: ' + error.message
    });
  }
});

// POST /api/tournaments/:id/fix-matches - Fix tournament with no matches
router.post('/:id/fix-matches', async (req, res) => {
  try {
    const tournamentId = req.params.id;
    const userId = req.user.id;
    
    console.log('🔧 Fixing tournament matches:', { tournamentId, userId });

    if (db.isSupabase) {
      // SUPABASE VERSION
      
      // 1. Get tournament
      const { data: tournament, error: tournamentError } = await db.supabaseAdmin
        .from('tournaments')
        .select(`
          *,
          tournament_participants!inner (
            user_id,
            status
          )
        `)
        .eq('id', tournamentId)
        .eq('tournament_participants.status', 'joined')
        .single();

      if (tournamentError || !tournament) {
        return res.status(404).json({ success: false, error: 'Tournament not found' });
      }

      // 2. Check if user is creator
      if (parseInt(tournament.creator_id) !== parseInt(userId)) {
        return res.status(403).json({ success: false, error: 'Only tournament creator can fix matches' });
      }

      // 3. Check if tournament needs fixing
      if (tournament.status !== 'ongoing') {
        return res.status(400).json({ success: false, error: 'Tournament must be ongoing to fix' });
      }

      const { count: matchCount, error: matchCountError } = await db.supabaseAdmin
        .from('tournament_matches')
        .select('*', { count: 'exact', head: true })
        .eq('tournament_id', tournamentId);

      if (matchCountError) throw matchCountError;

      if (matchCount > 0) {
        return res.status(400).json({ success: false, error: 'Tournament already has matches' });
      }

      // 4. Get participants
      const participants = tournament.tournament_participants || [];
      
      // Get user details for each participant
      const participantDetails = [];
      for (const p of participants) {
        const { data: user } = await db.supabaseAdmin
          .from('users')
          .select('id, username')
          .eq('id', p.user_id)
          .single();
        
        if (user) {
          participantDetails.push({
            user_id: user.id,
            username: user.username
          });
        }
      }

      // Shuffle participants
      const shuffled = participantDetails.sort(() => Math.random() - 0.5);

      if (shuffled.length < 2) {
        return res.status(400).json({ success: false, error: 'Need at least 2 participants' });
      }

      // 5. Generate matches for 4 participants (or less)
      const matches = [];
      const startDate = new Date();
      
      // Round 1 matches
      for (let i = 0; i < Math.min(2, Math.floor(shuffled.length / 2)); i++) {
        if (shuffled[i * 2] && shuffled[i * 2 + 1]) {
          matches.push({
            tournament_id: tournamentId,
            player1_id: shuffled[i * 2].user_id,
            player2_id: shuffled[i * 2 + 1].user_id,
            round_number: 1,
            match_time: startDate.toISOString(),
            status: 'upcoming',
            created_at: new Date().toISOString()
          });
        }
      }
      
      // Round 2 (final) - placeholder
      matches.push({
        tournament_id: tournamentId,
        player1_id: null,
        player2_id: null,
        round_number: 2,
        match_time: new Date(Date.now() + 3600000).toISOString(), // 1 hour later
        status: 'upcoming',
        created_at: new Date().toISOString()
      });

      // 6. Insert matches
      const { error: insertError } = await db.supabaseAdmin
        .from('tournament_matches')
        .insert(matches);

      if (insertError) throw insertError;

      console.log(`✅ Created ${matches.length} matches`);

      res.json({
        success: true,
        message: `Created ${matches.length} matches`,
        matches_created: matches.length
      });
      
    } else {
      // POSTGRESQL VERSION - keep your original code
      // 1. Get tournament
      const tournamentResult = await db.query(`
        SELECT t.*, COUNT(tp.id) as participants_count
        FROM tournaments t
        LEFT JOIN tournament_participants tp ON t.id = tp.tournament_id AND tp.status = 'joined'
        WHERE t.id = $1
        GROUP BY t.id
      `, [tournamentId]);

      if (tournamentResult[0].length === 0) {
        return res.status(404).json({ success: false, error: 'Tournament not found' });
      }

      const tournament = tournamentResult[0][0];

      // 2. Check if user is creator
      if (parseInt(tournament.creator_id) !== parseInt(userId)) {
        return res.status(403).json({ success: false, error: 'Only tournament creator can fix matches' });
      }

      // 3. Check if tournament needs fixing
      if (tournament.status !== 'ongoing') {
        return res.status(400).json({ success: false, error: 'Tournament must be ongoing to fix' });
      }

      const matchCountResult = await db.query(
        'SELECT COUNT(*) as count FROM tournament_matches WHERE tournament_id = $1',
        [tournamentId]
      );

      if (matchCountResult[0][0].count > 0) {
        return res.status(400).json({ success: false, error: 'Tournament already has matches' });
      }

      // 4. Get participants
      const participantsResult = await db.query(`
        SELECT tp.user_id, u.username
        FROM tournament_participants tp
        JOIN users u ON tp.user_id = u.id
        WHERE tp.tournament_id = $1 AND tp.status = 'joined'
        ORDER BY RANDOM()
      `, [tournamentId]);

      if (participantsResult[0].length < 2) {
        return res.status(400).json({ success: false, error: 'Need at least 2 participants' });
      }

      // 5. Generate matches for 4 participants
      const matches = [];
      
      // Round 1 (2 matches)
      matches.push({
        player1_id: participantsResult[0][0].user_id,
        player2_id: participantsResult[0][1].user_id,
        round_number: 1,
        match_time: new Date()
      });
      
      matches.push({
        player1_id: participantsResult[0][2].user_id,
        player2_id: participantsResult[0][3].user_id,
        round_number: 1,
        match_time: new Date()
      });
      
      // Round 2 (final)
      matches.push({
        player1_id: null,
        player2_id: null,
        round_number: 2,
        match_time: new Date(Date.now() + 3600000) // 1 hour later
      });

      // 6. Insert matches
      for (const match of matches) {
        await db.query(
          `INSERT INTO tournament_matches 
           (tournament_id, player1_id, player2_id, round_number, match_time, status)
           VALUES ($1, $2, $3, $4, $5, 'upcoming')`,
          [tournamentId, match.player1_id, match.player2_id, match.round_number, match.match_time]
        );
      }

      console.log(`✅ Created ${matches.length} matches`);

      res.json({
        success: true,
        message: `Created ${matches.length} matches`,
        matches_created: matches.length
      });
    }
  } catch (error) {
    console.error('❌ Fix matches error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/tournaments/:id/complete - Manually complete tournament (admin/creator)
router.post('/:id/complete', async (req, res) => {
  try {
    const tournamentId = req.params.id;
    const userId = req.user.userId || req.user.id;

    console.log('🎯 Manually completing tournament:', { tournamentId, userId });

    if (db.isSupabase) {
      const tournamentCompleted = await checkTournamentCompletionSupabase(tournamentId, true);

      if (!tournamentCompleted) {
        return res.status(400).json({
          success: false,
          error: 'Tournament cannot be completed yet. Not all matches are finished.'
        });
      }

      res.json({
        success: true,
        message: 'Tournament completed successfully!',
        tournament_id: tournamentId
      });
    } else {
      const tournamentCompleted = await checkTournamentCompletion(tournamentId, true);

      if (!tournamentCompleted) {
        return res.status(400).json({
          success: false,
          error: 'Tournament cannot be completed yet. Not all matches are finished.'
        });
      }

      res.json({
        success: true,
        message: 'Tournament completed successfully!',
        tournament_id: tournamentId
      });
    }
  } catch (error) {
    console.error('❌ Complete tournament error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to complete tournament: ' + error.message
    });
  }
});

// GET /api/tournaments/:id/standings - Get tournament standings
router.get('/:id/standings', async (req, res) => {
  try {
    const tournamentId = req.params.id;

    if (db.isSupabase) {
      // SUPABASE VERSION - Complex aggregation
      const { data: participants, error } = await db.supabaseAdmin
        .from('tournament_participants')
        .select(`
          user_id,
          users!inner (
            id,
            username,
            rank,
            profile_pic
          )
        `)
        .eq('tournament_id', tournamentId)
        .eq('status', 'joined');

      if (error) throw error;

      // Get all matches for this tournament
      const { data: matches, error: matchesError } = await db.supabaseAdmin
        .from('tournament_matches')
        .select('player1_id, player2_id, winner_id, status')
        .eq('tournament_id', tournamentId)
        .eq('status', 'completed');

      if (matchesError) throw matchesError;

      // Calculate standings
      const standings = (participants || []).map(p => {
        const userId = p.user_id;
        const userMatches = (matches || []).filter(m => 
          m.player1_id === userId || m.player2_id === userId
        );
        
        const wins = (matches || []).filter(m => m.winner_id === userId).length;
        const losses = userMatches.length - wins;
        const winRate = userMatches.length > 0 
          ? Math.round((wins * 100.0) / userMatches.length * 100) / 100
          : 0;

        return {
          id: userId,
          username: p.users.username,
          rank: p.users.rank,
          profile_pic: p.users.profile_pic,
          matches_played: userMatches.length,
          wins: wins,
          losses: losses,
          win_rate: winRate
        };
      });

      // Sort standings
      standings.sort((a, b) => {
        if (b.wins !== a.wins) return b.wins - a.wins;
        if (b.win_rate !== a.win_rate) return b.win_rate - a.win_rate;
        return a.matches_played - b.matches_played;
      });

      res.json({
        success: true,
        standings: standings,
        tournament_id: tournamentId
      });
      
    } else {
      // POSTGRESQL VERSION - keep your original code
      const result = await db.query(`
        SELECT 
          u.id,
          u.username,
          u.rank,
          u.profile_pic,
          COUNT(DISTINCT tm.id) as matches_played,
          SUM(CASE WHEN tm.winner_id = u.id THEN 1 ELSE 0 END) as wins,
          SUM(CASE WHEN tm.winner_id != u.id AND tm.winner_id IS NOT NULL THEN 1 ELSE 0 END) as losses,
          ROUND(
            (SUM(CASE WHEN tm.winner_id = u.id THEN 1 ELSE 0 END) * 100.0) / 
            NULLIF(COUNT(DISTINCT tm.id), 0), 
            2
          ) as win_rate
        FROM tournament_participants tp
        JOIN users u ON tp.user_id = u.id
        LEFT JOIN tournament_matches tm ON (
          (tm.player1_id = u.id OR tm.player2_id = u.id) 
          AND tm.tournament_id = tp.tournament_id
          AND tm.status = 'completed'
        )
        WHERE tp.tournament_id = $1 AND tp.status = 'joined'
        GROUP BY u.id, u.username, u.rank, u.profile_pic
        ORDER BY 
          wins DESC,
          win_rate DESC,
          matches_played ASC
      `, [tournamentId]);

      res.json({
        success: true,
        standings: result[0] || [],
        tournament_id: tournamentId
      });
    }
  } catch (error) {
    console.error('❌ Get standings error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get standings: ' + error.message
    });
  }
});

// GET /api/tournaments/live - Get live tournaments
router.get('/live', async (req, res) => {
  try {
    if (db.isSupabase) {
      // SUPABASE VERSION
      const { data: tournaments, error } = await db.supabaseAdmin
        .from('tournaments')
        .select(`
          *,
          users!creator_id (username),
          tournament_participants!left (
            user_id,
            status
          ),
          tournament_matches!left (
            id,
            status
          )
        `)
        .eq('status', 'ongoing')
        .order('start_date', { ascending: false })
        .limit(10);

      if (error) throw error;

      const processedTournaments = (tournaments || []).map(t => {
        const participants = t.tournament_participants || [];
        const joinedParticipants = participants.filter(p => p.status === 'joined');
        const matches = t.tournament_matches || [];
        const ongoingMatches = matches.filter(m => m.status === 'ongoing' || m.status === 'upcoming');
        
        return {
          id: t.id,
          name: t.name,
          game: t.game,
          type: t.type,
          creator_name: t.users?.username,
          current_players: joinedParticipants.length,
          max_players: t.max_players,
          match_count: ongoingMatches.length,
          prize_pool: t.prize_pool,
          prize_pool_formatted: `${parseInt(t.prize_pool || 0).toLocaleString()} XP`,
          platform: t.platform_fee ? 'Premium' : 'Standard'
        };
      });
      
      res.json({ 
        success: true, 
        tournaments: processedTournaments,
        count: processedTournaments.length
      });
      
    } else {
      // POSTGRESQL VERSION - keep your original code
      const result = await db.query(`
        SELECT 
          t.*,
          u.username as creator_name,
          COUNT(DISTINCT tp.user_id) as current_players,
          COUNT(DISTINCT tm.id) as match_count,
          ARRAY_AGG(DISTINCT tm.id) as match_ids
        FROM tournaments t
        LEFT JOIN users u ON t.creator_id = u.id
        LEFT JOIN tournament_participants tp ON t.id = tp.tournament_id AND tp.status = 'joined'
        LEFT JOIN tournament_matches tm ON t.id = tm.tournament_id AND tm.status IN ('ongoing', 'upcoming')
        WHERE t.status = 'ongoing'
        GROUP BY t.id, u.username
        ORDER BY t.start_date DESC
        LIMIT 10
      `);
      
      const tournaments = (result[0] || []).map(t => ({
        id: t.id,
        name: t.name,
        game: t.game,
        type: t.type,
        creator_name: t.creator_name,
        current_players: t.current_players,
        max_players: t.max_players,
        match_count: t.match_count,
        prize_pool: t.prize_pool,
        prize_pool_formatted: `${parseInt(t.prize_pool || 0).toLocaleString()} XP`,
        platform: t.platform_fee ? 'Premium' : 'Standard'
      }));
      
      res.json({ 
        success: true, 
        tournaments: tournaments,
        count: tournaments.length
      });
    }
  } catch (error) {
    console.error('❌ Get live tournaments error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to fetch live tournaments: ' + error.message 
    });
  }
});

// In users.js - this route stays in tournaments.js as per your file
router.get('/:id/activity', async (req, res) => {
  try {
    const userId = req.params.id;
    
    if (db.isSupabase) {
      // SUPABASE VERSION
      const { data: matches, error } = await db.supabaseAdmin
        .from('matches')
        .select(`
          *,
          player1:player1_id (id, username),
          player2:player2_id (id, username),
          tournaments!left (
            name,
            game
          )
        `)
        .or(`player1_id.eq.${userId},player2_id.eq.${userId}`)
        .eq('status', 'completed')
        .order('completed_at', { ascending: false })
        .limit(10);

      if (error) throw error;

      // Format activity
      const activities = (matches || []).map(match => {
        const opponent = match.player1_id === userId ? match.player2 : match.player1;
        const type = match.winner_id === userId ? 'win' : 'loss';
        
        return {
          type: type,
          description: type === 'win' 
            ? `You defeated ${opponent?.username || 'opponent'}`
            : `You lost to ${opponent?.username || 'opponent'}`,
          game: match.tournaments?.game,
          timestamp: match.completed_at,
          xp: type === 'win' ? 100 : 50
        };
      });
      
      res.json({ success: true, activities });
      
    } else {
      // POSTGRESQL VERSION - keep your original code
      const result = await db.query(`
        SELECT 
          m.*,
          CASE 
            WHEN m.winner_id = $1 THEN 'win'
            WHEN m.winner_id IS NOT NULL AND m.winner_id != $1 THEN 'loss'
            ELSE 'match'
          END as type,
          u1.username as opponent_username,
          t.name as tournament_name,
          t.game
        FROM matches m
        LEFT JOIN users u1 ON (m.player1_id = u1.id OR m.player2_id = u1.id) AND u1.id != $1
        LEFT JOIN tournaments t ON m.tournament_id = t.id
        WHERE (m.player1_id = $1 OR m.player2_id = $1)
          AND m.status = 'completed'
        ORDER BY m.completed_at DESC
        LIMIT 10
      `, [userId, userId, userId, userId, userId]);
      
      // Format activity
      const activities = result[0].map(match => ({
        type: match.type,
        description: match.type === 'win' 
          ? `You defeated ${match.opponent_username}`
          : match.type === 'loss'
          ? `You lost to ${match.opponent_username}`
          : `Match completed against ${match.opponent_username}`,
        game: match.game,
        timestamp: match.completed_at,
        xp: match.type === 'win' ? 100 : 50 // Example XP
      }));
      
      res.json({ success: true, activities });
    }
  } catch (error) {
    console.error('❌ Get user activity error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/tournaments/recent-winners - Get recent tournament winners (FIXED)
router.get('/recent-winners', async (req, res) => {
  try {
    const { limit = 5 } = req.query;
    
    if (db.isSupabase) {
      // SUPABASE VERSION
      const { data: tournaments, error } = await db.supabaseAdmin
        .from('tournaments')
        .select(`
          id,
          name,
          game,
          type,
          completed_at,
          prize_pool,
          winner_id,
          users!winner_id (
            id,
            username,
            profile_pic,
            rank
          )
        `)
        .eq('status', 'completed')
        .not('winner_id', 'is', null)
        .not('completed_at', 'is', null)
        .order('completed_at', { ascending: false })
        .limit(parseInt(limit));

      if (error) throw error;

      const winners = (tournaments || []).map(t => ({
        tournament_id: t.id,
        tournament_name: t.name,
        game: t.game,
        tournament_type: t.type,
        completed_at: t.completed_at,
        prize_pool: t.prize_pool,
        prize_pool_formatted: `${parseInt(t.prize_pool || 0).toLocaleString()} XP`,
        winner_id: t.users?.id,
        winner_name: t.users?.username,
        winner_avatar: t.users?.profile_pic,
        winner_rank: t.users?.rank
      }));

      res.json({
        success: true,
        winners: winners,
        count: winners.length
      });
      
    } else {
      // POSTGRESQL VERSION - keep your original code
      const result = await db.query(`
        SELECT 
          t.id as tournament_id,
          t.name as tournament_name,
          t.game,
          t.type as tournament_type,
          t.completed_at,
          t.prize_pool,
          u.id as winner_id,
          u.username as winner_name,
          u.profile_pic as winner_avatar,
          u.rank as winner_rank
        FROM tournaments t
        JOIN users u ON t.winner_id = u.id
        WHERE t.status = 'completed'
          AND t.winner_id IS NOT NULL
          AND t.completed_at IS NOT NULL
        ORDER BY t.completed_at DESC
        LIMIT $1
      `, [parseInt(limit)]);

      const winners = (result[0] || []).map(winner => ({
        tournament_id: winner.tournament_id,
        tournament_name: winner.tournament_name,
        game: winner.game,
        tournament_type: winner.tournament_type,
        completed_at: winner.completed_at,
        prize_pool: winner.prize_pool,
        prize_pool_formatted: `${parseInt(winner.prize_pool || 0).toLocaleString()} XP`,
        winner_id: winner.winner_id,
        winner_name: winner.winner_name,
        winner_avatar: winner.winner_avatar,
        winner_rank: winner.winner_rank
      }));

      res.json({
        success: true,
        winners: winners,
        count: winners.length
      });
    }
  } catch (error) {
    console.error('❌ Get recent winners error:', error);
    console.error('❌ Full error:', error.stack);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch recent winners: ' + error.message,
      debug: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// GET /api/tournaments/survival-champions - Get current survival champions (WORKING VERSION)
router.get('/survival-champions', async (req, res) => {
  try {
    console.log('🏆 Fetching survival champions...');
    
    if (db.isSupabase) {
      // SUPABASE VERSION
      
      // FIRST: Check if the required columns exist (we'll handle gracefully)
      // Get the latest completed survival tournament
      const { data: tournament, error: tournamentError } = await db.supabaseAdmin
        .from('tournaments')
        .select(`
          id,
          name,
          game,
          completed_at,
          winner_id,
          title_requirements_boundless,
          title_requirements_chaos,
          title_requirements_order,
          title_boundless_winner,
          title_chaos_winner,
          title_order_winner
        `)
        .eq('type', 'survival')
        .eq('status', 'completed')
        .not('completed_at', 'is', null)
        .order('completed_at', { ascending: false })
        .limit(1)
        .single();

      if (tournamentError || !tournament) {
        console.log('ℹ️ No survival tournaments completed yet');
        return res.json({
          success: true,
          champions: null,
          message: 'No survival tournaments completed yet'
        });
      }

      console.log('🎮 Latest survival tournament:', tournament.name);
      
      // Get winner details
      const champions = {};
      
      // Helper to get user details
      const getUserDetails = async (userId, titleName) => {
        if (!userId) return null;
        
        try {
          const { data: user, error: userError } = await db.supabaseAdmin
            .from('users')
            .select('id, username, profile_pic, rank')
            .eq('id', userId)
            .single();
          
          if (userError || !user) return null;
          
          return {
            username: user.username,
            avatar: user.profile_pic || '/default-avatar.png',
            rank: user.rank || 'E',
            requirement: titleName,
            user_id: user.id
          };
        } catch (error) {
          console.error(`❌ Error fetching user ${userId}:`, error);
          return null;
        }
      };
      
      // Boundless Champion (1st place)
      if (tournament.title_boundless_winner || tournament.winner_id) {
        const boundlessUserId = tournament.title_boundless_winner || tournament.winner_id;
        const boundlessChamp = await getUserDetails(
          boundlessUserId, 
          tournament.title_requirements_boundless || 'Boundless Explorer'
        );
        if (boundlessChamp) {
          champions.boundless = boundlessChamp;
          console.log('🏅 Found Boundless champion:', boundlessChamp.username);
        }
      }
      
      // Chaos Champion (3rd place)
      if (tournament.title_chaos_winner) {
        const chaosChamp = await getUserDetails(
          tournament.title_chaos_winner, 
          tournament.title_requirements_chaos || 'Master of Chaos'
        );
        if (chaosChamp) {
          champions.chaos = chaosChamp;
          console.log('🏅 Found Chaos champion:', chaosChamp.username);
        }
      }
      
      // Order Champion (2nd place)
      if (tournament.title_order_winner) {
        const orderChamp = await getUserDetails(
          tournament.title_order_winner, 
          tournament.title_requirements_order || 'Grand Master of Order'
        );
        if (orderChamp) {
          champions.order = orderChamp;
          console.log('🏅 Found Order champion:', orderChamp.username);
        }
      }

      console.log('✅ Champions found:', Object.keys(champions).length);

      const response = {
        success: true,
        champions: {
          tournament_id: tournament.id,
          tournament_name: tournament.name,
          game: tournament.game,
          completed_at: tournament.completed_at,
          completed_at_formatted: tournament.completed_at,
          champions: champions
        }
      };

      res.json(response);
      
    } else {
      // POSTGRESQL VERSION - keep your original code (entire block)
      console.log('🏆 Fetching survival champions...');
      
      // FIRST: Check if the required columns exist in tournaments table
      const columnCheck = await db.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_schema = 'public' 
          AND table_name = 'tournaments'
          AND column_name IN ('title_boundless_winner', 'title_chaos_winner', 'title_order_winner')
      `);
      
      const hasTitleColumns = columnCheck[0].length > 0;
      console.log('📊 Title columns exist?', hasTitleColumns, 'Columns found:', columnCheck[0].map(c => c.column_name));
      
      // Get the latest completed survival tournament
      let query = `
        SELECT 
          t.id,
          t.name as tournament_name,
          t.game,
          t.completed_at,
          t.title_requirements_boundless,
          t.title_requirements_chaos,
          t.title_requirements_order,
          t.winner_id
      `;
      
      // Add title winner columns if they exist
      if (hasTitleColumns) {
        query += `,
          t.title_boundless_winner,
          t.title_chaos_winner,
          t.title_order_winner`;
      }
      
      query += `
          , TO_CHAR(t.completed_at, 'YYYY-MM-DD HH24:MI') as completed_at_formatted
        FROM tournaments t
        WHERE t.type = 'survival' 
          AND t.status = 'completed'
          AND t.completed_at IS NOT NULL
        ORDER BY t.completed_at DESC
        LIMIT 1
      `;

      const tournamentResult = await db.query(query);
      console.log('📊 Tournament result:', tournamentResult[0]?.length || 0);

      if (tournamentResult[0].length === 0) {
        console.log('ℹ️ No survival tournaments found');
        return res.json({
          success: true,
          message: 'No survival tournaments completed yet',
          champions: null
        });
      }

      const tournament = tournamentResult[0][0];
      console.log('🎮 Found tournament:', tournament.tournament_name);
      
      // Get winner details
      const champions = {};
      
      // Helper function to get user details
      const getUserDetails = async (userId, titleColumn, titleFallback) => {
        if (!userId) return null;
        
        try {
          const userResult = await db.query(`
            SELECT 
              u.id,
              u.username,
              u.profile_pic,
              u.rank
            FROM users u
            WHERE u.id = $1
            LIMIT 1
          `, [userId]);
          
          if (userResult[0].length > 0) {
            const user = userResult[0][0];
            return {
              username: user.username,
              avatar: user.profile_pic,
              rank: user.rank,
              requirement: tournament[titleColumn] || titleFallback,
              user_id: user.id
            };
          }
          return null;
        } catch (error) {
          console.error(`❌ Error fetching user ${userId}:`, error);
          return null;
        }
      };
      
      // Determine winners based on available columns
      if (hasTitleColumns) {
        // Boundless Champion (1st place)
        if (tournament.title_boundless_winner) {
          console.log('🏅 Fetching Boundless champion:', tournament.title_boundless_winner);
          const boundlessChamp = await getUserDetails(
            tournament.title_boundless_winner, 
            'title_requirements_boundless', 
            'Boundless Explorer'
          );
          if (boundlessChamp) {
            champions.boundless = boundlessChamp;
          }
        }
        
        // Chaos Champion (3rd place)
        if (tournament.title_chaos_winner) {
          console.log('🏅 Fetching Chaos champion:', tournament.title_chaos_winner);
          const chaosChamp = await getUserDetails(
            tournament.title_chaos_winner, 
            'title_requirements_chaos', 
            'Master of Chaos'
          );
          if (chaosChamp) {
            champions.chaos = chaosChamp;
          }
        }
        
        // Order Champion (2nd place)
        if (tournament.title_order_winner) {
          console.log('🏅 Fetching Order champion:', tournament.title_order_winner);
          const orderChamp = await getUserDetails(
            tournament.title_order_winner, 
            'title_requirements_order', 
            'Grand Master of Order'
          );
          if (orderChamp) {
            champions.order = orderChamp;
          }
        }
      } else {
        // If no title columns, use winner_id as the only winner
        if (tournament.winner_id) {
          console.log('🏅 Fetching winner (no title columns):', tournament.winner_id);
          const winner = await getUserDetails(
            tournament.winner_id,
            'title_requirements_boundless',
            'Survival Champion'
          );
          if (winner) {
            champions.winner = winner;
          }
        }
      }

      console.log('✅ Champions data:', Object.keys(champions).length > 0 ? 'Found' : 'None');

      const response = {
        success: true,
        champions: {
          tournament_id: tournament.id,
          tournament_name: tournament.tournament_name,
          game: tournament.game,
          completed_at: tournament.completed_at,
          completed_at_formatted: tournament.completed_at_formatted,
          champions: champions
        }
      };

      // If no champions but we have a tournament, return empty champions
      if (Object.keys(champions).length === 0) {
        response.champions.champions = {
          boundless: null,
          chaos: null,
          order: null
        };
        response.message = 'Tournament found but no champions recorded';
      }

      res.json(response);
    }
  } catch (error) {
    console.error('❌ Get survival champions error:', error);
    console.error('❌ Error stack:', error.stack);
    res.status(500).json({
      success: false,
      error: 'Failed to get survival champions: ' + error.message,
      debug: process.env.NODE_ENV === 'development' ? {
        message: error.message,
        code: error.code,
        detail: error.detail
      } : undefined
    });
  }
});

// GET /api/tournaments/debug-tables - Debug endpoint to check table structure
router.get('/debug-tables', async (req, res) => {
  try {
    if (db.isSupabase) {
      // SUPABASE VERSION - limited debug info
      // Check tournaments table - get one record to see structure
      const { data: tournamentSample, error: tournamentError } = await db.supabaseAdmin
        .from('tournaments')
        .select('*')
        .limit(3);

      if (tournamentError) throw tournamentError;

      // Check titles table
      const { data: titlesSample, error: titlesError } = await db.supabaseAdmin
        .from('titles')
        .select('*')
        .limit(3);

      if (titlesError && titlesError.code !== '42P01') { // Table doesn't exist error
        throw titlesError;
      }

      // Check user_titles table
      const { data: userTitlesSample, error: userTitlesError } = await db.supabaseAdmin
        .from('user_titles')
        .select('*')
        .limit(3);

      if (userTitlesError && userTitlesError.code !== '42P01') {
        throw userTitlesError;
      }

      res.json({
        success: true,
        tables: {
          tournaments: {
            columns: tournamentSample && tournamentSample.length > 0 ? Object.keys(tournamentSample[0]) : [],
            sample: tournamentSample || []
          },
          titles: {
            exists: !titlesError || titlesError.code !== '42P01',
            sample: titlesSample || []
          },
          user_titles: {
            exists: !userTitlesError || userTitlesError.code !== '42P01',
            sample: userTitlesSample || []
          }
        }
      });
      
    } else {
      // POSTGRESQL VERSION - keep your original code
      // Check tournaments table columns
      const tournamentsColumns = await db.query(`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns 
        WHERE table_schema = 'public' 
          AND table_name = 'tournaments'
        ORDER BY ordinal_position
      `);
      
      // Check titles table columns
      const titlesColumns = await db.query(`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns 
        WHERE table_schema = 'public' 
          AND table_name = 'titles'
        ORDER BY ordinal_position
      `);
      
      // Check user_titles table columns
      const userTitlesColumns = await db.query(`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns 
        WHERE table_schema = 'public' 
          AND table_name = 'user_titles'
        ORDER BY ordinal_position
      `);
      
      // Get sample data from tables
      const tournamentSample = await db.query(`
        SELECT id, name, type, status, winner_id, completed_at
        FROM tournaments 
        WHERE type = 'survival' 
        ORDER BY completed_at DESC 
        LIMIT 3
      `);
      
      res.json({
        success: true,
        tables: {
          tournaments: {
            columns: tournamentsColumns[0],
            sample: tournamentSample[0]
          },
          titles: {
            columns: titlesColumns[0],
            count: titlesColumns[0].length
          },
          user_titles: {
            columns: userTitlesColumns[0],
            count: userTitlesColumns[0].length
          }
        }
      });
    }
  } catch (error) {
    console.error('❌ Debug tables error:', error);
    res.status(500).json({
      success: false,
      error: 'Debug failed: ' + error.message
    });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const tournamentId = req.params.id;
    
    console.log('🚀 Fetching tournament ID:', tournamentId);

    if (db.isSupabase) {
      // SUPABASE VERSION
      
      // Get tournament details with creator
      const { data: tournament, error: tournamentError } = await db.supabaseAdmin
        .from('tournaments')
        .select(`
          *,
          users!creator_id (
            username,
            profile_pic
          )
        `)
        .eq('id', tournamentId)
        .single();

      if (tournamentError || !tournament) {
        return res.status(404).json({ 
          success: false, 
          error: 'Tournament not found' 
        });
      }

      console.log('✅ Tournaments found: 1');

      // Get participants count and squad count
      const { data: participants, error: participantsError } = await db.supabaseAdmin
        .from('tournament_participants')
        .select('user_id, group_id, status')
        .eq('tournament_id', tournamentId)
        .eq('status', 'joined');

      if (participantsError) throw participantsError;

      const participantsCount = participants?.length || 0;
      const currentSquads = tournament.type === 'squad' 
        ? new Set(participants?.filter(p => p.group_id).map(p => p.group_id)).size
        : 0;

      // CHECK IF TOURNAMENT IS FULL AND SHOULD BE LOCKED
      let isFull = false;
      let isLocked = false;
      
      if (tournament.type === 'squad') {
        const maxSquads = tournament.max_squads || tournament.max_groups || 8;
        isFull = (currentSquads || 0) >= maxSquads;
        isLocked = isFull && tournament.status === 'upcoming';
      } else {
        isFull = (participantsCount || 0) >= (tournament.max_players || 0);
        isLocked = isFull && tournament.status === 'upcoming';
      }
      
      // If tournament is locked, hide details from non-participants
      if (isLocked) {
        const userId = req.user?.id || req.user?.userId;
        
        if (userId) {
          // Check if user is participant or creator
          const { data: hasAccess, error: accessError } = await db.supabaseAdmin
            .from('tournament_participants')
            .select('user_id')
            .eq('tournament_id', tournamentId)
            .eq('user_id', userId)
            .eq('status', 'joined')
            .limit(1);

          if (accessError) throw accessError;

          const isCreator = parseInt(tournament.creator_id) === parseInt(userId);
          
          if (!isCreator && (!hasAccess || hasAccess.length === 0)) {
            return res.status(403).json({
              success: false,
              error: 'Tournament is full and locked. Only participants can view details.',
              tournament_locked: true,
              tournament_status: 'full'
            });
          }
        } else {
          return res.status(403).json({
            success: false,
            error: 'Tournament is full and locked. Please login to access.',
            tournament_locked: true,
            tournament_status: 'full'
          });
        }
      }

      // Get participants with user details
      const { data: participantsWithUsers, error: usersError } = await db.supabaseAdmin
        .from('tournament_participants')
        .select(`
          user_id,
          group_id,
          users!inner (
            id,
            username,
            rank,
            profile_pic
          )
        `)
        .eq('tournament_id', tournamentId)
        .eq('status', 'joined')
        .order('created_at', { ascending: true });

      if (usersError) throw usersError;

      console.log('✅ Participants found:', participantsWithUsers?.length || 0);

      // Format participants
      const formattedParticipants = (participantsWithUsers || []).map(p => ({
        user_id: p.user_id,
        username: p.users?.username,
        rank: p.users?.rank,
        profile_pic: p.users?.profile_pic,
        group_id: p.group_id
      }));

      // Combine data
      const tournamentData = {
        ...tournament,
        creator_name: tournament.users?.username,
        creator_avatar: tournament.users?.profile_pic,
        participants_count: participantsCount,
        current_squads: currentSquads,
        is_full: isFull,
        is_locked: isLocked
      };

      res.json({
        success: true,
        tournament: tournamentData,
        participants: formattedParticipants || [],
        access: {
          can_view: true,
          can_join: !isFull && tournament.status === 'upcoming'
        }
      });
      
    } else {
      // POSTGRESQL VERSION - keep your original code
      // Get tournament details WITH squad count
      const tournamentResult = await db.query(`
        SELECT t.*, 
               u.username as creator_name,
               u.profile_pic as creator_avatar,
               COUNT(DISTINCT CASE WHEN t.type != 'squad' THEN tp.user_id ELSE NULL END) as participants_count,
               COUNT(DISTINCT CASE WHEN t.type = 'squad' THEN tp.group_id ELSE NULL END) as current_squads
        FROM tournaments t
        LEFT JOIN users u ON t.creator_id = u.id
        LEFT JOIN tournament_participants tp ON t.id = tp.tournament_id 
          AND tp.status = 'joined'
        WHERE t.id = $1
        GROUP BY t.id, u.username, u.profile_pic
      `, [tournamentId]);

      console.log('✅ Tournaments found:', tournamentResult[0].length);

      if (tournamentResult[0].length === 0) {
        return res.status(404).json({ 
          success: false, 
          error: 'Tournament not found' 
        });
      }

      const tournament = tournamentResult[0][0];
      
      // CHECK IF TOURNAMENT IS FULL AND SHOULD BE LOCKED
      let isFull = false;
      let isLocked = false;
      
      if (tournament.type === 'squad') {
        const maxSquads = tournament.max_squads || tournament.max_groups || 8;
        isFull = (tournament.current_squads || 0) >= maxSquads;
        isLocked = isFull && tournament.status === 'upcoming';
      } else {
        isFull = (tournament.participants_count || 0) >= (tournament.max_players || 0);
        isLocked = isFull && tournament.status === 'upcoming';
      }
      
      // If tournament is locked, hide details from non-participants
      if (isLocked) {
        const userId = req.user?.id || req.user?.userId;
        
        if (userId) {
          // Check if user is participant or creator
          const hasAccessResult = await db.query(`
            SELECT 1 FROM (
              SELECT creator_id FROM tournaments WHERE id = $1 AND creator_id = $2
              UNION
              SELECT user_id FROM tournament_participants WHERE tournament_id = $1 AND user_id = $2 AND status = 'joined'
            ) as access_check
          `, [tournamentId, userId]);
          
          if (hasAccessResult[0].length === 0) {
            return res.status(403).json({
              success: false,
              error: 'Tournament is full and locked. Only participants can view details.',
              tournament_locked: true,
              tournament_status: 'full'
            });
          }
        } else {
          return res.status(403).json({
            success: false,
            error: 'Tournament is full and locked. Please login to access.',
            tournament_locked: true,
            tournament_status: 'full'
          });
        }
      }

      // Get participants (only if not locked or user has access)
      const participantsResult = await db.query(`
        SELECT tp.user_id, u.username, u.rank, u.profile_pic, tp.group_id
        FROM tournament_participants tp
        JOIN users u ON tp.user_id = u.id
        WHERE tp.tournament_id = $1 AND tp.status = 'joined'
        ORDER BY tp.created_at ASC
      `, [tournamentId]);

      console.log('✅ Participants found:', participantsResult[0].length);

      // Combine data
      const tournamentData = {
        ...tournament,
        participants_count: tournament.participants_count || 0,
        current_squads: tournament.current_squads || 0,
        is_full: isFull,
        is_locked: isLocked
      };

      res.json({
        success: true,
        tournament: tournamentData,
        participants: participantsResult[0] || [],
        access: {
          can_view: true,
          can_join: !isFull && tournament.status === 'upcoming'
        }
      });
    }
  } catch (error) {
    console.error('❌ Database error fetching tournament:', error);
    console.error('❌ Full error details:', error.stack);
    res.status(500).json({ 
      success: false, 
      error: 'Database error: ' + error.message 
    });
  }
});

// GET /api/tournaments/debug/all - Debug route to see all tournaments
router.get('/debug/all', async (req, res) => {
  try {
    if (db.isSupabase) {
      // SUPABASE VERSION
      const { data: tournaments, error } = await db.supabaseAdmin
        .from('tournaments')
        .select('id, name, creator_id, status, created_at')
        .order('id', { ascending: false });

      if (error) throw error;

      res.json({
        success: true,
        tournaments: tournaments || [],
        total: tournaments?.length || 0
      });
      
    } else {
      // POSTGRESQL VERSION - keep your original code
      const result = await db.query(`
        SELECT id, name, creator_id, status, created_at 
        FROM tournaments 
        ORDER BY id DESC
      `);
      
      res.json({
        success: true,
        tournaments: result[0],
        total: result[0].length
      });
    }
  } catch (error) {
    console.error('❌ Debug all error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Debug error: ' + error.message 
    });
  }
});

// Add this route BEFORE your /:id route for debugging
router.get('/debug/:id', async (req, res) => {
  try {
    const tournamentId = req.params.id;
    console.log('🧪 Debug fetching tournament:', tournamentId);
    
    if (db.isSupabase) {
      // SUPABASE VERSION
      
      // Test 1: Simple query
      const { data: simpleTest, error: simpleError } = await db.supabaseAdmin
        .from('tournaments')
        .select('id, name')
        .eq('id', tournamentId);

      if (simpleError) throw simpleError;
      console.log('🧪 Simple test result:', simpleTest);
      
      // Test 2: Check participants
      const { data: participantsTest, error: participantsError } = await db.supabaseAdmin
        .from('tournament_participants')
        .select('*')
        .eq('tournament_id', tournamentId);

      if (participantsError) throw participantsError;
      console.log('🧪 Participants test:', participantsTest);
      
      res.json({
        success: true,
        simple: simpleTest,
        participants: participantsTest
      });
      
    } else {
      // POSTGRESQL VERSION - keep your original code
      // Test 1: Simple query
      const simpleTestResult = await db.query(
        'SELECT id, name FROM tournaments WHERE id = $1',
        [tournamentId]
      );
      console.log('🧪 Simple test result:', simpleTestResult[0]);
      
      // Test 2: Check participants
      const participantsTestResult = await db.query(
        'SELECT * FROM tournament_participants WHERE tournament_id = $1',
        [tournamentId]
      );
      console.log('🧪 Participants test:', participantsTestResult[0]);
      
      res.json({
        success: true,
        simple: simpleTestResult[0],
        participants: participantsTestResult[0]
      });
    }
  } catch (error) {
    console.error('🧪 Debug error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/tournaments/:id/manage - Get tournament management data
router.get('/:id/manage', async (req, res) => {
  try {
    const tournamentId = req.params.id;
    const userId = req.user.id;

    if (db.isSupabase) {
      // SUPABASE VERSION
      
      // Get tournament with creator check
      const { data: tournament, error: tournamentError } = await db.supabaseAdmin
        .from('tournaments')
        .select(`
          *,
          users!creator_id (
            username
          )
        `)
        .eq('id', tournamentId)
        .eq('creator_id', userId)
        .single();

      if (tournamentError || !tournament) {
        return res.status(403).json({
          success: false,
          error: 'Access denied or tournament not found'
        });
      }

      // Get all squads with details - complex query
      const { data: squads, error: squadsError } = await db.supabaseAdmin
        .from('tournament_participants')
        .select(`
          group_id,
          groups!inner (
            name,
            group_members!inner (
              user_id,
              role,
              users!inner (
                id,
                username
              )
            )
          ),
          users!inner (
            id,
            username
          ),
          created_at
        `)
        .eq('tournament_id', tournamentId)
        .eq('status', 'joined')
        .not('group_id', 'is', null);

      if (squadsError) throw squadsError;

      // Process squads to group by group_id
      const squadMap = new Map();
      
      (squads || []).forEach(item => {
        const groupId = item.group_id;
        if (!squadMap.has(groupId)) {
          // Find admin for this group
          const admin = item.groups?.group_members?.find(
            gm => gm.role === 'admin' && gm.user_id
          );
          
          squadMap.set(groupId, {
            group_id: groupId,
            group_name: item.groups?.name || 'Unknown Group',
            members: [],
            member_ids: [],
            registered_at: item.created_at,
            admin_id: admin?.user_id,
            admin_name: admin?.users?.username
          });
        }
        
        const squad = squadMap.get(groupId);
        if (item.users) {
          squad.members.push(item.users.username);
          squad.member_ids.push(item.users.id);
        }
      });

      const formattedSquads = Array.from(squadMap.values()).map(squad => ({
        ...squad,
        squad_size: squad.members.length,
        members: squad.members.join(','),
        member_ids: squad.member_ids.join(',')
      }));

      // Get tournament revenue/stats from xp_transactions
      const { data: revenue, error: revenueError } = await db.supabaseAdmin
        .from('xp_transactions')
        .select('amount, type, user_id')
        .eq('tournament_id', tournamentId);

      if (revenueError && revenueError.code !== '42P01') { // Table doesn't exist
        throw revenueError;
      }

      const totalEntryFees = (revenue || [])
        .filter(t => t.type === 'spent')
        .reduce((sum, t) => sum + (t.amount || 0), 0);
      
      const totalRefunds = (revenue || [])
        .filter(t => t.type === 'refund')
        .reduce((sum, t) => sum + (t.amount || 0), 0);
      
      const uniquePayers = new Set(
        (revenue || [])
          .filter(t => t.type === 'spent')
          .map(t => t.user_id)
      ).size;

      res.json({
        success: true,
        tournament: tournament,
        squads: formattedSquads || [],
        stats: {
          total_squads: formattedSquads.length,
          total_participants: formattedSquads.reduce((sum, squad) => sum + squad.squad_size, 0),
          revenue: {
            total_entry_fees: totalEntryFees,
            total_refunds: totalRefunds,
            unique_payers: uniquePayers
          }
        },
        can_manage: tournament.status === 'upcoming'
      });
      
    } else {
      // POSTGRESQL VERSION - keep your original code
      // Get tournament with creator check
      const tournamentResult = await db.query(`
        SELECT t.*, u.username as creator_name
        FROM tournaments t
        LEFT JOIN users u ON t.creator_id = u.id
        WHERE t.id = $1 AND t.creator_id = $2
      `, [tournamentId, userId]);

      if (tournamentResult[0].length === 0) {
        return res.status(403).json({
          success: false,
          error: 'Access denied or tournament not found'
        });
      }

      const tournament = tournamentResult[0][0];

      // Get all squads with details
      const squadsResult = await db.query(`
        SELECT 
          tp.group_id,
          g.name as group_name,
          COUNT(DISTINCT tp.user_id) as squad_size,
          STRING_AGG(DISTINCT u.username, ',' ORDER BY u.username) as members,
          STRING_AGG(DISTINCT u.id::text, ',') as member_ids,
          MIN(tp.created_at) as registered_at,
          gm_admin.user_id as admin_id,
          u_admin.username as admin_name
        FROM tournament_participants tp
        JOIN groups g ON tp.group_id = g.id
        JOIN users u ON tp.user_id = u.id
        JOIN group_members gm_admin ON g.id = gm_admin.group_id AND gm_admin.role = 'admin'
        JOIN users u_admin ON gm_admin.user_id = u_admin.id
        WHERE tp.tournament_id = $1 AND tp.status = 'joined'
        GROUP BY tp.group_id, g.name, gm_admin.user_id, u_admin.username
        ORDER BY registered_at ASC
      `, [tournamentId]);

      // Get tournament revenue/stats
      const revenueResult = await db.query(`
        SELECT 
          SUM(CASE WHEN type = 'spent' THEN amount ELSE 0 END) as total_entry_fees,
          SUM(CASE WHEN type = 'refund' THEN amount ELSE 0 END) as total_refunds,
          COUNT(DISTINCT user_id) as unique_payers
        FROM xp_transactions 
        WHERE tournament_id = $1
      `, [tournamentId]);

      res.json({
        success: true,
        tournament: tournament,
        squads: squadsResult[0] || [],
        stats: {
          total_squads: squadsResult[0].length,
          total_participants: squadsResult[0].reduce((sum, squad) => sum + squad.squad_size, 0),
          revenue: revenueResult[0][0] || {
            total_entry_fees: 0,
            total_refunds: 0,
            unique_payers: 0
          }
        },
        can_manage: tournament.status === 'upcoming'
      });
    }
  } catch (error) {
    console.error('❌ Get tournament manage error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get management data: ' + error.message
    });
  }
});

// POST /api/tournaments/:id/complete-with-winner - Fixed version for both PostgreSQL and Supabase
router.post('/:id/complete-with-winner', async (req, res) => {
  let tournament;
  let winnerCheckResult;
  
  try {
    const tournamentId = req.params.id;
    const userId = req.user.id;
    const { winner_id, runner_up_id, third_place_id } = req.body;

    console.log('🏆 Completing tournament with winners:', {
      tournamentId,
      userId,
      winner_id,
      runner_up_id,
      third_place_id
    });

    if (db.isSupabase) {
      // SUPABASE VERSION - FIXED for UUID compatibility
      
      // Get tournament details
      const { data: tournamentData, error: tournamentError } = await db.supabaseAdmin
        .from('tournaments')
        .select(`
          *,
          users!creator_id (
            username
          )
        `)
        .eq('id', tournamentId)
        .single();

      if (tournamentError || !tournamentData) {
        throw new Error('Tournament not found');
      }

      tournament = tournamentData;
      
      console.log('🎮 Tournament type:', tournament.type);

      // Check if user is creator - FIXED: Don't use parseInt for UUID comparison
      if (tournament.creator_id !== userId) {
        throw new Error('Only tournament creator can complete the tournament');
      }

      if (tournament.status === 'completed') {
        throw new Error('Tournament is already completed');
      }

      // Check if winner exists - FIXED: winner_id is already a UUID string
      const { data: winnerData, error: winnerError } = await db.supabaseAdmin
        .from('users')
        .select('id, username')
        .eq('id', winner_id)
        .single();

      if (winnerError || !winnerData) {
        throw new Error('Winner not found');
      }

      winnerCheckResult = winnerData;

      // Handle Survival tournament differently
      if (tournament.type === 'survival') {
        console.log('🔥 Processing survival tournament completion...');
        
        // Validate all 3 winners for survival
        if (!runner_up_id || !third_place_id) {
          throw new Error('Survival tournaments require all 3 winners (1st, 2nd, 3rd place)');
        }

        // Check if runner-up and third place exist (optional but recommended)
        const { data: runnerUpData, error: runnerUpError } = await db.supabaseAdmin
          .from('users')
          .select('id')
          .eq('id', runner_up_id)
          .single();
          
        if (runnerUpError || !runnerUpData) {
          throw new Error('Runner-up not found');
        }
        
        const { data: thirdPlaceData, error: thirdPlaceError } = await db.supabaseAdmin
          .from('users')
          .select('id')
          .eq('id', third_place_id)
          .single();
          
        if (thirdPlaceError || !thirdPlaceData) {
          throw new Error('Third place winner not found');
        }

        // Update tournament with ALL winners including title columns
        const { error: updateError } = await db.supabaseAdmin
          .from('tournaments')
          .update({
            status: 'completed',
            winner_id: winner_id,
            title_boundless_winner: winner_id,
            title_order_winner: runner_up_id,
            title_chaos_winner: third_place_id,
            completed_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .eq('id', tournamentId);

        if (updateError) throw updateError;

        console.log('✅ Saved survival winners to title columns:', {
          boundless: winner_id,
          order: runner_up_id,
          chaos: third_place_id
        });

        // TRY to award titles, but don't fail if it errors
        try {
          await awardSurvivalTitlesSupabase(tournamentId, winner_id, runner_up_id, third_place_id, tournament);
        } catch (titleError) {
          console.error('❌ Title awarding failed, but continuing:', titleError.message);
          // Continue without titles
        }
      } else {
        // For non-survival tournaments
        const { error: updateError } = await db.supabaseAdmin
          .from('tournaments')
          .update({
            status: 'completed',
            winner_id: winner_id,
            completed_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .eq('id', tournamentId);

        if (updateError) throw updateError;
      }

      // Convert XP values to numbers
      const prizePool = parseFloat(tournament.prize_pool) || 0;

      // Distribute prize pool
      if (prizePool > 0) {
        await distributeTournamentPrizesSupabase(tournamentId, winner_id, runner_up_id, third_place_id, tournament);
      }

      // Update user tournament win count - FIXED: Use RPC or direct update without parseInt
      const { error: userUpdateError } = await db.supabaseAdmin.rpc('increment_user_tournaments_won', {
        user_id: winner_id
      });

      if (userUpdateError) {
        console.log('⚠️ RPC failed, trying direct update:', userUpdateError.message);
        // Fallback to direct update
        const { data: currentUser } = await db.supabaseAdmin
          .from('users')
          .select('tournaments_won')
          .eq('id', winner_id)
          .single();
        
        await db.supabaseAdmin
          .from('users')
          .update({ tournaments_won: (currentUser?.tournaments_won || 0) + 1 })
          .eq('id', winner_id);
      }

      // Send notifications to all participants - FIXED: Don't use parseInt for UUID comparison
      const { data: participants, error: participantsError } = await db.supabaseAdmin
        .from('tournament_participants')
        .select('user_id')
        .eq('tournament_id', tournamentId)
        .eq('status', 'joined');

      if (participantsError) throw participantsError;

      for (const participant of participants || []) {
        const isWinner = participant.user_id === winner_id;
        let message;
        
        if (tournament.type === 'survival') {
          const position = participant.user_id === winner_id ? '1st (Boundless Explorer)' :
                          participant.user_id === runner_up_id ? '2nd (Grand Master of Order)' :
                          participant.user_id === third_place_id ? '3rd (Master of Chaos)' : 'participant';
          
          message = position !== 'participant' 
            ? `🏆 Survival Tournament "${tournament.name}" completed! You placed ${position} and earned a special title!`
            : `🏁 Survival Tournament "${tournament.name}" has been completed.`;
        } else {
          message = isWinner 
            ? `🏆 Congratulations! You won the tournament "${tournament.name}"!`
            : `🏁 Tournament "${tournament.name}" has been completed. Winner: ${winnerCheckResult.username}`;
        }
        
        await db.supabaseAdmin
          .from('notifications')
          .insert([{
            user_id: participant.user_id,
            message: message,
            type: 'system',
            status: 'unread',
            tournament_id: tournamentId,
            created_at: new Date().toISOString()
          }]);
      }

      res.json({
        success: true,
        message: tournament.type === 'survival' 
          ? 'Survival tournament completed successfully! Titles awarded to winners.'
          : 'Tournament completed successfully!',
        tournament: {
          id: tournamentId,
          name: tournament.name,
          status: 'completed',
          type: tournament.type,
          winner_id: winner_id,
          winner_name: winnerCheckResult.username
        }
      });
      
    } else {
      // POSTGRESQL VERSION - Keep your original code, but fix parseInt issues
      await withTransaction(async (client) => {
        // Get tournament details
        const tournamentResult = await client.query(`
          SELECT t.*, u.username as creator_name
          FROM tournaments t
          LEFT JOIN users u ON t.creator_id = u.id
          WHERE t.id = $1
        `, [tournamentId]);

        if (tournamentResult[0].length === 0) {
          throw new Error('Tournament not found');
        }

        tournament = tournamentResult[0][0];
        
        console.log('🎮 Tournament type:', tournament.type);

        // Check if user is creator - FIXED: Convert both to integers for comparison
        if (parseInt(tournament.creator_id) !== parseInt(userId)) {
          throw new Error('Only tournament creator can complete the tournament');
        }

        if (tournament.status === 'completed') {
          throw new Error('Tournament is already completed');
        }

        // Check if winner exists - FIXED: Convert winner_id to integer if needed
        const winnerIdInt = parseInt(winner_id);
        winnerCheckResult = await client.query(
          `SELECT id, username FROM users WHERE id = $1`,
          [winnerIdInt]
        );

        if (winnerCheckResult[0].length === 0) {
          throw new Error('Winner not found');
        }

        // Handle Survival tournament differently
        if (tournament.type === 'survival') {
          console.log('🔥 Processing survival tournament completion...');
          
          // Validate all 3 winners for survival
          if (!runner_up_id || !third_place_id) {
            throw new Error('Survival tournaments require all 3 winners (1st, 2nd, 3rd place)');
          }

          // Check if runner-up and third place exist
          const runnerUpIdInt = parseInt(runner_up_id);
          const thirdPlaceIdInt = parseInt(third_place_id);
          
          const runnerUpCheck = await client.query(
            `SELECT id FROM users WHERE id = $1`,
            [runnerUpIdInt]
          );
          
          if (runnerUpCheck[0].length === 0) {
            throw new Error('Runner-up not found');
          }
          
          const thirdPlaceCheck = await client.query(
            `SELECT id FROM users WHERE id = $1`,
            [thirdPlaceIdInt]
          );
          
          if (thirdPlaceCheck[0].length === 0) {
            throw new Error('Third place winner not found');
          }

          // Update tournament with ALL winners including title columns
          await client.query(`
            UPDATE tournaments 
            SET 
              status = 'completed', 
              winner_id = $1,
              title_boundless_winner = $1,     -- 1st place = Boundless
              title_order_winner = $2,         -- 2nd place = Order  
              title_chaos_winner = $3,         -- 3rd place = Chaos
              completed_at = NOW(),
              updated_at = NOW()
            WHERE id = $4
          `, [winnerIdInt, runnerUpIdInt, thirdPlaceIdInt, tournamentId]);

          console.log('✅ Saved survival winners to title columns:', {
            boundless: winnerIdInt,
            order: runnerUpIdInt,
            chaos: thirdPlaceIdInt
          });

          // TRY to award titles, but don't fail if it errors
          try {
            await awardSurvivalTitles(tournamentId, winnerIdInt, runnerUpIdInt, thirdPlaceIdInt, tournament, client);
          } catch (titleError) {
            console.error('❌ Title awarding failed, but continuing:', titleError.message);
            // Continue without titles
          }
        } else {
          // For non-survival tournaments
          const winnerIdInt = parseInt(winner_id);
          await client.query(`
            UPDATE tournaments 
            SET status = 'completed', 
                winner_id = $1,
                completed_at = NOW(),
                updated_at = NOW()
            WHERE id = $2
          `, [winnerIdInt, tournamentId]);
        }

        // Convert XP values to numbers
        const prizePool = parseFloat(tournament.prize_pool) || 0;

        // Distribute prize pool
        if (prizePool > 0) {
          await distributeTournamentPrizes(tournamentId, parseInt(winner_id), parseInt(runner_up_id), parseInt(third_place_id), tournament, client);
        }

        // Update user tournament win count
        await client.query(`
          UPDATE users 
          SET tournaments_won = COALESCE(tournaments_won, 0) + 1
          WHERE id = $1
        `, [parseInt(winner_id)]);

        // Send notifications to all participants
        const participantsResult = await client.query(`
          SELECT DISTINCT user_id FROM tournament_participants 
          WHERE tournament_id = $1 AND status = 'joined'
        `, [tournamentId]);

        for (const participant of participantsResult[0]) {
          const isWinner = participant.user_id === parseInt(winner_id);
          let message;
          
          if (tournament.type === 'survival') {
            const position = participant.user_id === parseInt(winner_id) ? '1st (Boundless Explorer)' :
                            participant.user_id === parseInt(runner_up_id) ? '2nd (Grand Master of Order)' :
                            participant.user_id === parseInt(third_place_id) ? '3rd (Master of Chaos)' : 'participant';
            
            message = position !== 'participant' 
              ? `🏆 Survival Tournament "${tournament.name}" completed! You placed ${position} and earned a special title!`
              : `🏁 Survival Tournament "${tournament.name}" has been completed.`;
          } else {
            message = isWinner 
              ? `🏆 Congratulations! You won the tournament "${tournament.name}"!`
              : `🏁 Tournament "${tournament.name}" has been completed. Winner: ${winnerCheckResult[0][0].username}`;
          }
          
          await client.query(`
            INSERT INTO notifications 
            (user_id, message, type, status, tournament_id, created_at)
            VALUES ($1, $2, 'system', 'unread', $3, NOW())
          `, [participant.user_id, message, tournamentId]);
        }
      });

      res.json({
        success: true,
        message: tournament.type === 'survival' 
          ? 'Survival tournament completed successfully! Titles awarded to winners.'
          : 'Tournament completed successfully!',
        tournament: {
          id: tournamentId,
          name: tournament.name,
          status: 'completed',
          type: tournament.type,
          winner_id: parseInt(winner_id),
          winner_name: winnerCheckResult[0][0].username
        }
      });
    }
  } catch (error) {
    console.error('❌ Complete tournament error:', error);
    console.error('❌ Error stack:', error.stack);
    res.status(500).json({
      success: false,
      error: 'Failed to complete tournament: ' + error.message
    });
  }
});
// Helper function to get ordinal suffix (1st, 2nd, 3rd, 4th, etc.)
function getOrdinalSuffix(n) {
  if (n > 3 && n < 21) return 'th';
  switch (n % 10) {
    case 1: return 'st';
    case 2: return 'nd';
    case 3: return 'rd';
    default: return 'th';
  }
}

// Helper function to distribute prizes - FIXED VERSION
async function distributeTournamentPrizes(tournamentId, winnerId, runnerUpId, thirdPlaceId, tournament, client) {
  const prizePool = parseFloat(tournament.prize_pool) || 0;
  
  if (prizePool <= 0) return;
  
  console.log('💰 Prize distribution input:', {
    prizePool,
    winnerId,
    runnerUpId,
    thirdPlaceId
  });

  // FIXED: Properly check if IDs are valid
  const hasRunnerUp = runnerUpId && runnerUpId !== 'null' && runnerUpId !== 'undefined' && runnerUpId !== '' && runnerUpId !== null;
  const hasThirdPlace = thirdPlaceId && thirdPlaceId !== 'null' && thirdPlaceId !== 'undefined' && thirdPlaceId !== '' && thirdPlaceId !== null;
  
  console.log('💰 Position check:', { hasRunnerUp, hasThirdPlace });
  
  // Calculate distribution
  let winnerPrize = prizePool;
  let runnerUpPrize = 0;
  let thirdPlacePrize = 0;
  
  if (hasRunnerUp && hasThirdPlace) {
    // All three positions specified: 70%, 20%, 10%
    winnerPrize = Math.floor(prizePool * 0.7);
    runnerUpPrize = Math.floor(prizePool * 0.2);
    thirdPlacePrize = Math.floor(prizePool * 0.1);
  } else if (hasRunnerUp && !hasThirdPlace) {
    // Only winner and runner-up specified: 80%, 20%
    winnerPrize = Math.floor(prizePool * 0.8);
    runnerUpPrize = Math.floor(prizePool * 0.2);
  } else if (!hasRunnerUp && hasThirdPlace) {
    // Only winner and third place (unusual but handle it)
    winnerPrize = Math.floor(prizePool * 0.9);
    thirdPlacePrize = Math.floor(prizePool * 0.1);
  }
  // If only winner specified: winner gets 100% (default)

  console.log('💰 Calculated prizes:', {
    winnerPrize,
    runnerUpPrize,
    thirdPlacePrize,
    totalDistributed: winnerPrize + runnerUpPrize + thirdPlacePrize
  });

  // Award prizes
  const prizes = [
    { userId: winnerId, amount: winnerPrize, position: 1 },
    { userId: runnerUpId, amount: runnerUpPrize, position: 2 },
    { userId: thirdPlaceId, amount: thirdPlacePrize, position: 3 }
  ];

  for (const prize of prizes) {
    // Check if userId exists and amount > 0
    if (prize.userId && prize.amount > 0) {
      const amountInt = Math.floor(prize.amount);
      
      await client.query(`
        UPDATE users SET xp_points = COALESCE(xp_points, 0) + $1 WHERE id = $2
      `, [amountInt, prize.userId]);

      await client.query(`
        INSERT INTO xp_transactions (user_id, tournament_id, amount, type, description)
        VALUES ($1, $2, $3, 'earned', $4)
      `, [
        prize.userId, 
        tournamentId, 
        amountInt, 
        `${prize.position === 1 ? '🏆 ' : ''}Tournament prize (${prize.position}${getOrdinalSuffix(prize.position)} place): ${tournament.name}`
      ]);
      
      console.log(`💰 Awarded ${amountInt} XP to user ${prize.userId} for ${prize.position}${getOrdinalSuffix(prize.position)} place`);
    }
  }
}

// Supabase version of distribute prizes
async function distributeTournamentPrizesSupabase(tournamentId, winnerId, runnerUpId, thirdPlaceId, tournament) {
  const prizePool = parseFloat(tournament.prize_pool) || 0;
  
  if (prizePool <= 0) return;
  
  console.log('💰 Prize distribution input:', {
    prizePool,
    winnerId,
    runnerUpId,
    thirdPlaceId
  });

  const hasRunnerUp = runnerUpId && runnerUpId !== 'null' && runnerUpId !== 'undefined' && runnerUpId !== '' && runnerUpId !== null;
  const hasThirdPlace = thirdPlaceId && thirdPlaceId !== 'null' && thirdPlaceId !== 'undefined' && thirdPlaceId !== '' && thirdPlaceId !== null;
  
  console.log('💰 Position check:', { hasRunnerUp, hasThirdPlace });
  
  // Calculate distribution
  let winnerPrize = prizePool;
  let runnerUpPrize = 0;
  let thirdPlacePrize = 0;
  
  if (hasRunnerUp && hasThirdPlace) {
    winnerPrize = Math.floor(prizePool * 0.7);
    runnerUpPrize = Math.floor(prizePool * 0.2);
    thirdPlacePrize = Math.floor(prizePool * 0.1);
  } else if (hasRunnerUp && !hasThirdPlace) {
    winnerPrize = Math.floor(prizePool * 0.8);
    runnerUpPrize = Math.floor(prizePool * 0.2);
  } else if (!hasRunnerUp && hasThirdPlace) {
    winnerPrize = Math.floor(prizePool * 0.9);
    thirdPlacePrize = Math.floor(prizePool * 0.1);
  }

  console.log('💰 Calculated prizes:', {
    winnerPrize,
    runnerUpPrize,
    thirdPlacePrize
  });

  const prizes = [
    { userId: winnerId, amount: winnerPrize, position: 1 },
    { userId: runnerUpId, amount: runnerUpPrize, position: 2 },
    { userId: thirdPlaceId, amount: thirdPlacePrize, position: 3 }
  ];

  for (const prize of prizes) {
    if (prize.userId && prize.amount > 0) {
      const amountInt = Math.floor(prize.amount);
      
      // Update user XP
      await db.supabaseAdmin.rpc('add_xp_to_user', {
        user_id: prize.userId,
        xp_amount: amountInt
      });

      // Record transaction
      await db.supabaseAdmin
        .from('xp_transactions')
        .insert([{
          user_id: prize.userId,
          tournament_id: tournamentId,
          amount: amountInt,
          type: 'earned',
          description: `${prize.position === 1 ? '🏆 ' : ''}Tournament prize (${prize.position}${getOrdinalSuffix(prize.position)} place): ${tournament.name}`,
          created_at: new Date().toISOString()
        }]);
      
      console.log(`💰 Awarded ${amountInt} XP to user ${prize.userId} for ${prize.position}${getOrdinalSuffix(prize.position)} place`);
    }
  }
}

// POST /api/tournaments/:id/kick-group - Remove group from tournament (Creator only)
router.post('/:id/kick-group', async (req, res) => {
  try {
    const tournamentId = req.params.id;
    const userId = req.user.id;
    const { group_id } = req.body;

    console.log('👢 Removing group from tournament:', { tournamentId, group_id, userId });

    if (db.isSupabase) {
      // SUPABASE VERSION - sequential execution
      
      // Get tournament details
      const { data: tournament, error: tournamentError } = await db.supabaseAdmin
        .from('tournaments')
        .select('*')
        .eq('id', tournamentId)
        .single();

      if (tournamentError || !tournament) {
        throw new Error('Tournament not found');
      }

      // Check permissions - only creator can kick groups
      if (parseInt(tournament.creator_id) !== parseInt(userId)) {
        throw new Error('Only tournament creator can remove groups');
      }

      if (tournament.status !== 'upcoming') {
        throw new Error('Cannot remove groups after tournament has started');
      }

      // Check if group exists in tournament
      const { data: groupInTournament, error: groupError } = await db.supabaseAdmin
        .from('tournament_participants')
        .select('user_id')
        .eq('tournament_id', tournamentId)
        .eq('group_id', group_id)
        .eq('status', 'joined');

      if (groupError) throw groupError;

      if (!groupInTournament || groupInTournament.length === 0) {
        throw new Error('Group not found in tournament');
      }

      // Get group members to notify
      const { data: groupMembers, error: membersError } = await db.supabaseAdmin
        .from('tournament_participants')
        .select(`
          user_id,
          users!inner (
            username,
            email
          )
        `)
        .eq('tournament_id', tournamentId)
        .eq('group_id', group_id)
        .eq('status', 'joined');

      if (membersError) throw membersError;

      // Remove all group members from tournament
      const { error: updateError } = await db.supabaseAdmin
        .from('tournament_participants')
        .update({ status: 'declined' })
        .eq('tournament_id', tournamentId)
        .eq('group_id', group_id)
        .eq('status', 'joined');

      if (updateError) throw updateError;

      // Refund XP entry fee to each member
      if (tournament.xp_entry_fee > 0) {
        for (const member of groupMembers || []) {
          await db.supabaseAdmin.rpc('add_xp_to_user', {
            user_id: member.user_id,
            xp_amount: tournament.xp_entry_fee
          });

          await db.supabaseAdmin
            .from('xp_transactions')
            .insert([{
              user_id: member.user_id,
              tournament_id: tournamentId,
              amount: tournament.xp_entry_fee,
              type: 'refund',
              description: `Refund for group removal: ${tournament.name}`,
              created_at: new Date().toISOString()
            }]);
        }
      }

      // Get creator username
      const { data: creatorData } = await db.supabaseAdmin
        .from('users')
        .select('username')
        .eq('id', userId)
        .single();

      // Send notifications to removed members
      for (const member of groupMembers || []) {
        await db.supabaseAdmin
          .from('notifications')
          .insert([{
            user_id: member.user_id,
            sender_id: userId,
            message: `Your group has been removed from tournament "${tournament.name}" by ${creatorData?.username || 'tournament admin'}. ${tournament.xp_entry_fee > 0 ? 'XP entry fee has been refunded.' : ''}`,
            type: 'system',
            status: 'unread',
            tournament_id: tournamentId,
            created_at: new Date().toISOString()
          }]);
      }

      res.json({
        success: true,
        message: 'Group removed successfully',
        members_removed: groupMembers?.length || 0,
        xp_refunded: tournament.xp_entry_fee > 0 ? (groupMembers?.length || 0) * tournament.xp_entry_fee : 0,
        group_id: group_id
      });
      
    } else {
      // POSTGRESQL VERSION - keep your original code (entire block)
      await withTransaction(async (client) => {
        // Get tournament details
        const tournamentResult = await client.query(`
          SELECT t.*, COUNT(tp.id) as participants_count
          FROM tournaments t
          LEFT JOIN tournament_participants tp ON t.id = tp.tournament_id 
            AND tp.status = 'joined'
          WHERE t.id = $1
          GROUP BY t.id
        `, [tournamentId]);

        if (tournamentResult[0].length === 0) {
          throw new Error('Tournament not found');
        }

        const tournament = tournamentResult[0][0];

        // Check permissions - only creator can kick groups
        if (parseInt(tournament.creator_id) !== parseInt(userId)) {
          throw new Error('Only tournament creator can remove groups');
        }

        if (tournament.status !== 'upcoming') {
          throw new Error('Cannot remove groups after tournament has started');
        }

        // Check if group exists in tournament
        const groupInTournamentResult = await client.query(`
          SELECT DISTINCT group_id, COUNT(*) as member_count 
          FROM tournament_participants 
          WHERE tournament_id = $1 AND group_id = $2 AND status = 'joined'
          GROUP BY group_id
        `, [tournamentId, group_id]);

        if (groupInTournamentResult[0].length === 0) {
          throw new Error('Group not found in tournament');
        }

        // Get group members to notify
        const groupMembersResult = await client.query(`
          SELECT tp.user_id, u.username, u.email
          FROM tournament_participants tp
          JOIN users u ON tp.user_id = u.id
          WHERE tp.tournament_id = $1 AND tp.group_id = $2 AND tp.status = 'joined'
        `, [tournamentId, group_id]);

        // Remove all group members from tournament
        await client.query(`
          UPDATE tournament_participants 
          SET status = 'declined'
          WHERE tournament_id = $1 AND group_id = $2 AND status = 'joined'
        `, [tournamentId, group_id]);

        // Refund XP entry fee to each member
        if (tournament.xp_entry_fee > 0) {
          for (const member of groupMembersResult[0]) {
            await client.query(
              `UPDATE users SET xp_points = xp_points + $1 WHERE id = $2`,
              [tournament.xp_entry_fee, member.user_id]
            );

            // Record XP refund transaction
            await client.query(
              `INSERT INTO xp_transactions (user_id, tournament_id, amount, type, description)
               VALUES ($1, $2, $3, 'refund', $4)`,
              [member.user_id, tournamentId, tournament.xp_entry_fee, `Refund for group removal: ${tournament.name}`]
            );
          }
        }

        // Send notifications to removed members
        const creatorResult = await client.query(
          `SELECT username FROM users WHERE id = $1`,
          [userId]
        );

        for (const member of groupMembersResult[0]) {
          await client.query(`
            INSERT INTO notifications (user_id, sender_id, message, type, status, tournament_id, created_at)
            VALUES ($1, $2, $3, 'system', 'unread', $4, NOW())
          `, [
            member.user_id,
            userId,
            `Your group has been removed from tournament "${tournament.name}" by ${creatorResult[0][0]?.username || 'tournament admin'}. ${tournament.xp_entry_fee > 0 ? 'XP entry fee has been refunded.' : ''}`,
            tournamentId
          ]);
        }
      });

      res.json({
        success: true,
        message: 'Group removed successfully',
        members_removed: groupMembersResult[0].length,
        xp_refunded: tournament.xp_entry_fee > 0 ? groupMembersResult[0].length * tournament.xp_entry_fee : 0,
        group_id: group_id
      });
    }
  } catch (error) {
    console.error('❌ Remove group error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to remove group: ' + error.message
    });
  }
});
// GET /api/tournaments/:id/bracket - Get tournament bracket (FIXED with fallback)
router.get('/:id/bracket', async (req, res) => {
  try {
    const tournamentId = req.params.id;
    const userId = req.user.userId || req.user.id;

    console.log('📊 FETCHING BRACKET FOR TOURNAMENT:', tournamentId);

    // Define fallback function INSIDE the endpoint to ensure it exists
    const getRoundNameSafe = (roundNumber, totalParticipants = null) => {
      // Calculate expected participants in this round
      const participantsInRound = totalParticipants ? Math.pow(2, Math.ceil(Math.log2(totalParticipants)) - roundNumber + 1) : null;
      
      // Specific round names based on participant count
      const roundNameMap = {
        2048: 'Round of 2048',
        1024: 'Round of 1024',
        512: 'Round of 512',
        256: 'Round of 256',
        128: 'Round of 128',
        64: 'Round of 64',
        32: 'Round of 32',
        16: 'Round of 16',
        8: 'Quarter Finals',
        4: 'Semi Finals',
        2: 'Finals'
      };
      
      // If we have participant count and it matches a known round name
      if (participantsInRound && roundNameMap[participantsInRound]) {
        return roundNameMap[participantsInRound];
      }
      
      // For final rounds detection
      if (roundNumber === 1 && participantsInRound === 2) {
        return 'Finals';
      }
      
      if (roundNumber === 1 && participantsInRound === 4) {
        return 'Semi Finals';
      }
      
      if (roundNumber === 1 && participantsInRound === 8) {
        return 'Quarter Finals';
      }
      
      // Handle round numbers with specific names
      const specificRoundNames = {
        1: 'Round 1',
        2: 'Round 2',
        3: 'Quarter Finals',
        4: 'Semi Finals',
        5: 'Finals',
        6: 'Grand Finals',
        7: 'Championship',
        8: 'Ultimate Finals'
      };
      
      if (specificRoundNames[roundNumber]) {
        return specificRoundNames[roundNumber];
      }
      
      // For rounds beyond known ones, use ordinal numbers
      const lastDigit = roundNumber % 10;
      const lastTwoDigits = roundNumber % 100;
      
      if (lastTwoDigits >= 11 && lastTwoDigits <= 13) {
        return `${roundNumber}th Round`;
      }
      
      switch (lastDigit) {
        case 1: return `${roundNumber}st Round`;
        case 2: return `${roundNumber}nd Round`;
        case 3: return `${roundNumber}rd Round`;
        default: return `${roundNumber}th Round`;
      }
    };

    if (db.isSupabase) {
      // SUPABASE VERSION
      
      // 1. Get tournament info
      const { data: tournament, error: tournamentError } = await db.supabaseAdmin
        .from('tournaments')
        .select(`
          id,
          name,
          type,
          status,
          winner_id,
          max_players,
          creator_id
        `)
        .eq('id', tournamentId)
        .single();

      if (tournamentError || !tournament) {
        return res.status(404).json({
          success: false,
          error: 'Tournament not found'
        });
      }

      // Get participant count
      const { count: participantCount, error: countError } = await db.supabaseAdmin
        .from('tournament_participants')
        .select('*', { count: 'exact', head: true })
        .eq('tournament_id', tournamentId)
        .eq('status', 'joined');

      if (countError) throw countError;

      tournament.participant_count = participantCount || 0;

      // 2. If tournament not started
      if (tournament.status === 'upcoming') {
        return res.json({
          success: true,
          bracket: {
            tournament_id: tournamentId,
            tournament_name: tournament.name,
            tournament_type: tournament.type,
            status: tournament.status,
            rounds: [],
            participant_count: tournament.participant_count,
            total_matches: 0,
            should_generate_bracket: tournament.participant_count >= 2
          }
        });
      }

      // 3. Get matches with player and winner details
      const { data: matches, error: matchesError } = await db.supabaseAdmin
        .from('tournament_matches')
        .select(`
          id,
          round_number,
          player1_id,
          player2_id,
          winner_id,
          status,
          match_time,
          completed_at,
          player1:player1_id (id, username, rank),
          player2:player2_id (id, username, rank),
          winner:winner_id (id, username, rank)
        `)
        .eq('tournament_id', tournamentId)
        .order('round_number', { ascending: true })
        .order('id', { ascending: true })
        .limit(50);

      if (matchesError) throw matchesError;

      console.log(`✅ LOADED ${matches?.length || 0} MATCHES`);

      // 4. Debug: Log what we got
      (matches || []).forEach(match => {
        console.log(`🎯 Match ${match.id}:`, {
          p1: match.player1?.username,
          p2: match.player2?.username,
          winner_id: match.winner_id,
          winner_name: match.winner?.username,
          status: match.status
        });
      });

      // 5. Group matches by round
      const rounds = {};
      (matches || []).forEach(match => {
        const roundNum = match.round_number;
        if (!rounds[roundNum]) {
          rounds[roundNum] = [];
        }
        
        // CREATE WINNER OBJECT IF winner_id EXISTS
        let winnerObj = null;
        if (match.winner_id && match.winner) {
          winnerObj = {
            id: match.winner.id,
            username: match.winner.username,
            rank: match.winner.rank
          };
          console.log(`✅ Match ${match.id} winner object created:`, winnerObj);
        } else if (match.winner_id) {
          console.log(`⚠️ Match ${match.id} has winner_id=${match.winner_id} but no username!`);
        }
        
        rounds[roundNum].push({
          id: match.id,
          player1: match.player1 ? {
            id: match.player1.id,
            username: match.player1.username || `Player ${match.player1_id}`,
            rank: match.player1.rank
          } : null,
          player2: match.player2 ? {
            id: match.player2.id,
            username: match.player2.username || `Player ${match.player2_id}`,
            rank: match.player2.rank
          } : null,
          winner: winnerObj,
          winner_id: match.winner_id,
          status: match.status,
          round: match.round_number,
          match_time: match.match_time,
          completed_at: match.completed_at
        });
      });

      // 6. Create rounds array - USING SAFE FUNCTION
      const roundsArray = Object.keys(rounds)
        .map(roundNumber => {
          const roundNum = parseInt(roundNumber);
          const roundMatches = rounds[roundNum];
          
          return {
            number: roundNum,
            name: getRoundNameSafe(roundNum, tournament.participant_count),
            matches: roundMatches || [],
            match_count: roundMatches.length,
            completed_count: roundMatches.filter(m => m.status === 'completed').length
          };
        })
        .sort((a, b) => a.number - b.number);

      // 7. Response
      res.json({
        success: true,
        bracket: {
          tournament_id: tournamentId,
          tournament_name: tournament.name,
          tournament_type: tournament.type,
          status: tournament.status,
          rounds: roundsArray,
          participant_count: tournament.participant_count,
          total_matches: matches?.length || 0,
          should_generate_bracket: tournament.status === 'upcoming' && tournament.participant_count >= 2,
          creator_id: tournament.creator_id
        }
      });
      
    } else {
      // POSTGRESQL VERSION
      
      // 1. Get tournament info
      const tournamentResult = await db.query(`
        SELECT 
          t.id,
          t.name,
          t.type,
          t.status,
          t.winner_id,
          t.max_players,
          COUNT(tp.id) as participant_count,
          t.creator_id
        FROM tournaments t
        LEFT JOIN tournament_participants tp ON t.id = tp.tournament_id 
          AND tp.status = 'joined'
        WHERE t.id = $1
        GROUP BY t.id
        LIMIT 1
      `, [tournamentId]);

      if (tournamentResult[0].length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Tournament not found'
        });
      }

      const tournament = tournamentResult[0][0];

      // 2. If tournament not started
      if (tournament.status === 'upcoming') {
        return res.json({
          success: true,
          bracket: {
            tournament_id: tournamentId,
            tournament_name: tournament.name,
            tournament_type: tournament.type,
            status: tournament.status,
            rounds: [],
            participant_count: tournament.participant_count,
            total_matches: 0,
            should_generate_bracket: tournament.participant_count >= 2
          }
        });
      }

      // 3. Get matches with proper winner joins
      const matchesResult = await db.query(`
        SELECT 
          tm.id,
          tm.round_number,
          tm.player1_id,
          tm.player2_id,
          tm.winner_id,
          tm.status,
          tm.match_time,
          tm.completed_at,
          
          -- Player 1
          p1.username as player1_username,
          p1.rank as player1_rank,
          
          -- Player 2
          p2.username as player2_username,
          p2.rank as player2_rank,
          
          -- Winner
          w.username as winner_username,
          w.rank as winner_rank
          
        FROM tournament_matches tm
        
        LEFT JOIN users p1 ON tm.player1_id = p1.id
        LEFT JOIN users p2 ON tm.player2_id = p2.id
        LEFT JOIN users w ON tm.winner_id = w.id
        
        WHERE tm.tournament_id = $1
        ORDER BY tm.round_number ASC, tm.id ASC
        LIMIT 50
      `, [tournamentId]);

      console.log(`✅ LOADED ${matchesResult[0].length} MATCHES`);

      // 4. Debug: Log what we got
      matchesResult[0].forEach(match => {
        console.log(`🎯 Match ${match.id}:`, {
          p1: match.player1_username,
          p2: match.player2_username,
          winner_id: match.winner_id,
          winner_name: match.winner_username,
          status: match.status
        });
      });

      // 5. Group matches by round
      const rounds = {};
      matchesResult[0].forEach(match => {
        const roundNum = match.round_number;
        if (!rounds[roundNum]) {
          rounds[roundNum] = [];
        }
        
        let winnerObj = null;
        if (match.winner_id && match.winner_username) {
          winnerObj = {
            id: match.winner_id,
            username: match.winner_username,
            rank: match.winner_rank
          };
          console.log(`✅ Match ${match.id} winner object created:`, winnerObj);
        } else if (match.winner_id) {
          console.log(`⚠️ Match ${match.id} has winner_id=${match.winner_id} but no username!`);
        }
        
        rounds[roundNum].push({
          id: match.id,
          player1: match.player1_id ? {
            id: match.player1_id,
            username: match.player1_username || `Player ${match.player1_id}`,
            rank: match.player1_rank
          } : null,
          player2: match.player2_id ? {
            id: match.player2_id,
            username: match.player2_username || `Player ${match.player2_id}`,
            rank: match.player2_rank
          } : null,
          winner: winnerObj,
          winner_id: match.winner_id,
          status: match.status,
          round: match.round_number,
          match_time: match.match_time,
          completed_at: match.completed_at
        });
      });

      // 6. Create rounds array - USING SAFE FUNCTION
      const roundsArray = Object.keys(rounds)
        .map(roundNumber => {
          const roundNum = parseInt(roundNumber);
          const roundMatches = rounds[roundNum];
          
          return {
            number: roundNum,
            name: getRoundNameSafe(roundNum, tournament.participant_count),
            matches: roundMatches || [],
            match_count: roundMatches.length,
            completed_count: roundMatches.filter(m => m.status === 'completed').length
          };
        })
        .sort((a, b) => a.number - b.number);

      // 7. Response
      res.json({
        success: true,
        bracket: {
          tournament_id: tournamentId,
          tournament_name: tournament.name,
          tournament_type: tournament.type,
          status: tournament.status,
          rounds: roundsArray,
          participant_count: tournament.participant_count,
          total_matches: matchesResult[0].length,
          should_generate_bracket: tournament.status === 'upcoming' && tournament.participant_count >= 2,
          creator_id: tournament.creator_id
        }
      });
    }
  } catch (error) {
    console.error('❌ Get bracket error:', error);
    console.error('❌ Error stack:', error.stack);
    res.status(500).json({
      success: false,
      error: 'Failed to get bracket: ' + error.message
    });
  }
});
// ============================
// TEST ROUTE FOR SURVIVAL TITLES
// ============================

// POST /api/tournaments/test-award-titles - Test survival titles (admin only)
router.post('/test-award-titles', async (req, res) => {
  try {
    // Check if user is admin
    if (!req.user.is_admin) {
      return res.status(403).json({
        success: false,
        error: 'Only administrators can test title awards'
      });
    }
    
    const { tournament_id, winner_id } = req.body;
    
    if (!tournament_id || !winner_id) {
      return res.status(400).json({
        success: false,
        error: 'tournament_id and winner_id are required'
      });
    }
    
    console.log(`🧪 Testing survival titles for tournament ${tournament_id}, winner ${winner_id}`);
    
    // Call the function based on environment
    let result;
    if (db.isSupabase) {
      result = await awardSurvivalTitlesSupabase(tournament_id, winner_id);
    } else {
      result = await awardSurvivalTitles(tournament_id, winner_id);
    }
    
    res.json({
      success: true,
      message: 'Test completed',
      test_results: result,
      debug: {
        tournament_id,
        winner_id,
        timestamp: new Date().toISOString()
      }
    });
    
  } catch (error) {
    console.error('❌ Test award titles error:', error);
    res.status(500).json({
      success: false,
      error: 'Test failed: ' + error.message
    });
  }
});

// POST /api/tournaments/:id/join - Join tournament (FIXED TYPE CONVERSION - ALL LOGIC PRESERVED)
router.post('/:id/join', async (req, res) => {
  let connection;
  let groupMembers = []; // DECLARE groupMembers HERE for proper scope
  
  try {
    const tournamentId = req.params.id;
    const userId = req.user.id;
    const { group_id, squad_name } = req.body; // For squad tournaments

    console.log('👥 Join request:', { tournamentId, userId, group_id });

    if (db.isSupabase) {
      // SUPABASE VERSION
      
      // ==================== DEBUGGING: CHECK CURRENT DATABASE STATE ====================
      console.log('🔍 [DEBUG] Checking database state before join attempt...');
      
      // Check tournament details
      const { data: tournamentCheck, error: tournamentCheckError } = await db.supabaseAdmin
        .from('tournaments')
        .select('id, name, type, max_players, max_squads, max_groups, status')
        .eq('id', tournamentId)
        .single();

      if (tournamentCheckError) throw tournamentCheckError;
      
      // Check current participants
      const { data: participantsCheck, error: participantsCheckError } = await db.supabaseAdmin
        .from('tournament_participants')
        .select('user_id, group_id, status')
        .eq('tournament_id', tournamentId);

      if (participantsCheckError) throw participantsCheckError;
      
      console.log('🔍 [DEBUG] Database state:', {
        tournamentExists: !!tournamentCheck,
        tournament: tournamentCheck,
        totalParticipants: participantsCheck?.length || 0,
        participants: participantsCheck
      });
      // ==================== END DEBUGGING ====================

      // Get tournament details with participant count
      const { data: tournament, error: tournamentError } = await db.supabaseAdmin
        .from('tournaments')
        .select(`
          *,
          tournament_participants!left (
            user_id,
            status
          )
        `)
        .eq('id', tournamentId)
        .single();

      if (tournamentError || !tournament) {
        return res.status(404).json({
          success: false,
          error: 'Tournament not found'
        });
      }

      // Calculate participants count
      const joinedParticipants = (tournament.tournament_participants || [])
        .filter(p => p.status === 'joined');
      tournament.participants_count = joinedParticipants.length;

      // Check tournament status
      if (tournament.status !== 'upcoming') {
        return res.status(400).json({
          success: false,
          error: 'Tournament is not accepting new participants'
        });
      }

      // SQUAD TOURNAMENT VALIDATION (CRITICAL FOR SQUAD TYPE)
      if (tournament.type === 'squad') {
        if (!group_id) {
          return res.status(400).json({
            success: false,
            error: 'Group ID required for squad tournaments'
          });
        }

        // Check if user is admin of the group
        const { count: isGroupAdmin, error: adminError } = await db.supabaseAdmin
          .from('group_members')
          .select('*', { count: 'exact', head: true })
          .eq('group_id', group_id)
          .eq('user_id', userId)
          .eq('role', 'admin')
          .eq('status', 'joined');

        if (adminError) throw adminError;

        if (!isGroupAdmin || isGroupAdmin === 0) {
          return res.status(403).json({
            success: false,
            error: 'You must be a group admin to join squad tournaments'
          });
        }

        // Check if group already in tournament
        const { count: groupInTournament, error: groupInError } = await db.supabaseAdmin
          .from('tournament_participants')
          .select('*', { count: 'exact', head: true })
          .eq('tournament_id', tournamentId)
          .eq('group_id', group_id)
          .eq('status', 'joined')
          .limit(1);

        if (groupInError) throw groupInError;

        if (groupInTournament > 0) {
          return res.status(400).json({
            success: false,
            error: 'Your group is already registered in this tournament'
          });
        }

        // Check group size (1-5 members)
        const { count: memberCount, error: memberCountError } = await db.supabaseAdmin
          .from('group_members')
          .select('*', { count: 'exact', head: true })
          .eq('group_id', group_id)
          .eq('status', 'joined');

        if (memberCountError) throw memberCountError;

        if (memberCount < 1 || memberCount > 5) {
          return res.status(400).json({
            success: false,
            error: 'Group must have 1-5 members'
          });
        }

        // Check if any group member is already in tournament via another group
        const { data: groupMembersData, error: membersError } = await db.supabaseAdmin
          .from('group_members')
          .select('user_id')
          .eq('group_id', group_id)
          .eq('status', 'joined');

        if (membersError) throw membersError;

        const memberIds = groupMembersData.map(m => m.user_id);

        const { data: conflictingMembers, error: conflictError } = await db.supabaseAdmin
          .from('tournament_participants')
          .select(`
            user_id,
            users!inner (
              username
            )
          `)
          .eq('tournament_id', tournamentId)
          .eq('status', 'joined')
          .in('user_id', memberIds)
          .neq('group_id', group_id);

        if (conflictError) throw conflictError;

        if (conflictingMembers && conflictingMembers.length > 0) {
          const memberNames = conflictingMembers.map(m => m.users?.username).join(', ');
          return res.status(400).json({
            success: false,
            error: `These group members are already in tournament via other groups: ${memberNames}`
          });
        }

        // ==================== FIXED SQUAD COUNT LOGIC ====================
        console.log('🔍 [DEBUG] Starting squad capacity check...');
        
        // Check current squads
        const { count: currentSquadCount, error: squadCountError } = await db.supabaseAdmin
          .from('tournament_participants')
          .select('*', { count: 'exact', head: true })
          .eq('tournament_id', tournamentId)
          .not('group_id', 'is', null)
          .eq('status', 'joined');

        if (squadCountError) throw squadCountError;

        console.log('🔍 [DEBUG] Squad count:', {
          currentSquadCount,
          tournamentId
        });

        // Get actual list of registered groups for debugging
        const { data: registeredGroups, error: groupsError } = await db.supabaseAdmin
          .from('tournament_participants')
          .select('group_id, created_at')
          .eq('tournament_id', tournamentId)
          .not('group_id', 'is', null)
          .eq('status', 'joined')
          .order('created_at', { ascending: true });

        if (groupsError) throw groupsError;

        // Count distinct groups
        const uniqueGroups = new Set(registeredGroups?.map(g => g.group_id) || []);
        const distinctGroupCount = uniqueGroups.size;

        console.log('🔍 [DEBUG] Registered groups detail:', {
          groups: registeredGroups,
          totalGroups: registeredGroups?.length || 0,
          distinctGroups: distinctGroupCount
        });

        // Handle both max_squads and max_groups columns
        const maxSquads = tournament.max_squads || tournament.max_groups || 8;
        const currentSquadCountValue = distinctGroupCount;

        console.log('🔍 [DEBUG] Capacity calculation:', {
          tournamentId: tournamentId,
          tournamentName: tournament.name,
          tournamentType: tournament.type,
          maxSquadsFromDB: tournament.max_squads,
          maxGroupsFromDB: tournament.max_groups,
          maxSquadsUsed: maxSquads,
          currentSquadCount: currentSquadCountValue,
          registeredGroupsCount: distinctGroupCount,
          isFull: currentSquadCountValue >= maxSquads
        });

        if (currentSquadCountValue >= maxSquads) {
          return res.status(400).json({
            success: false,
            error: `Tournament is full. ${currentSquadCountValue}/${maxSquads} squads already registered.`,
            debug_info: {
              tournament_id: tournamentId,
              tournament_name: tournament.name,
              current_squads: currentSquadCountValue,
              max_squads: maxSquads,
              registered_groups: registeredGroups?.map(g => ({
                group_id: g.group_id,
                first_joined: g.created_at
              })),
              tournament_type: tournament.type
            }
          });
        }
      }

      // For non-squad tournaments (1v1, survival, freeforall)
      if (tournament.type !== 'squad') {
        // Check if user already joined
        const { count: existingCount, error: existingError } = await db.supabaseAdmin
          .from('tournament_participants')
          .select('*', { count: 'exact', head: true })
          .eq('tournament_id', tournamentId)
          .eq('user_id', userId)
          .eq('status', 'joined');

        if (existingError) throw existingError;

        if (existingCount > 0) {
          return res.status(400).json({
            success: false,
            error: 'You have already joined this tournament'
          });
        }
      }

      // Check tournament capacity (for non-squad tournaments)
      if (tournament.type !== 'squad' && tournament.participants_count >= tournament.max_players) {
        return res.status(400).json({
          success: false,
          error: 'Tournament is full'
        });
      }

      // XP balance check
      const xpEntryFee = parseFloat(tournament.xp_entry_fee) || 0;
      if (xpEntryFee > 0) {
        const { data: user, error: userError } = await db.supabaseAdmin
          .from('users')
          .select('xp_points, username')
          .eq('id', userId)
          .single();

        if (userError || !user) {
          return res.status(404).json({
            success: false,
            error: 'User not found'
          });
        }

        const userXpBalance = parseFloat(user.xp_points) || 0;
        if (userXpBalance < xpEntryFee) {
          return res.status(400).json({
            success: false,
            error: `Insufficient XP balance. You need ${xpEntryFee} XP, you have ${userXpBalance} XP`
          });
        }
      }

      // START TRANSACTION (sequential operations)
      
      // Deduct XP if entry fee > 0
      if (xpEntryFee > 0) {
        const xpFee = parseFloat(xpEntryFee);
        console.log('💰 Deducting XP:', { userId, xpFee });
        
        // Deduct XP
        await db.supabaseAdmin.rpc('deduct_xp_from_user', {
          user_id: userId,
          xp_amount: xpFee
        });

        // Record XP transaction
        await db.supabaseAdmin
          .from('xp_transactions')
          .insert([{
            user_id: userId,
            tournament_id: tournamentId,
            amount: xpFee,
            type: 'spent',
            description: `Tournament entry fee: ${tournament.name}`,
            created_at: new Date().toISOString()
          }]);
      }

      // Add participant(s)
      if (tournament.type === 'squad') {
        // Get group members
        const { data: membersData, error: membersError } = await db.supabaseAdmin
          .from('group_members')
          .select('user_id')
          .eq('group_id', group_id)
          .eq('status', 'joined');

        if (membersError) throw membersError;
        
        groupMembers = membersData || [];

        console.log('🔍 [DEBUG] Adding group members to tournament:', {
          groupId: group_id,
          memberCount: groupMembers.length,
          members: groupMembers
        });

        const participantInserts = groupMembers.map(member => ({
          tournament_id: tournamentId,
          user_id: member.user_id,
          group_id: group_id,
          squad_name: squad_name || null,
          status: 'joined',
          created_at: new Date().toISOString()
        }));

        const { error: insertError } = await db.supabaseAdmin
          .from('tournament_participants')
          .insert(participantInserts);

        if (insertError) throw insertError;

        // Send notification to group members
        for (const member of groupMembers) {
          if (member.user_id !== userId) { // Don't notify yourself
            await db.supabaseAdmin
              .from('notifications')
              .insert([{
                user_id: member.user_id,
                message: `Your group has joined tournament "${tournament.name}"`,
                type: 'tournament',
                status: 'unread',
                tournament_id: tournamentId,
                created_at: new Date().toISOString()
              }]);
          }
        }
        
        console.log('✅ [DEBUG] Successfully registered squad:', {
          tournamentId: tournamentId,
          groupId: group_id,
          squadName: squad_name,
          membersAdded: groupMembers.length
        });
      } else {
        // Add individual participant (for 1v1, survival, freeforall)
        const { error: insertError } = await db.supabaseAdmin
          .from('tournament_participants')
          .insert([{
            tournament_id: tournamentId,
            user_id: userId,
            status: 'joined',
            created_at: new Date().toISOString()
          }]);

        if (insertError) throw insertError;
      }

      // Notify tournament creator
      if (parseInt(tournament.creator_id) !== parseInt(userId)) {
        const { data: userData } = await db.supabaseAdmin
          .from('users')
          .select('username')
          .eq('id', userId)
          .single();
        
        const username = userData?.username || 'User';
        
        await db.supabaseAdmin
          .from('notifications')
          .insert([{
            user_id: tournament.creator_id,
            sender_id: userId,
            message: `${username} has joined your tournament "${tournament.name}"`,
            type: 'tournament',
            status: 'unread',
            tournament_id: tournamentId,
            created_at: new Date().toISOString()
          }]);
      }

      res.json({
        success: true,
        message: tournament.type === 'squad' 
          ? 'Squad registered successfully!' 
          : 'Successfully joined tournament!',
        xp_deducted: xpEntryFee,
        debug: tournament.type === 'squad' ? {
          group_id: group_id,
          members_added: groupMembers.length,
          squad_name: squad_name
        } : null
      });
      
    } else {
      // POSTGRESQL VERSION - keep your original code (entire block)
      // ==================== DEBUGGING: CHECK CURRENT DATABASE STATE ====================
      console.log('🔍 [DEBUG] Checking database state before join attempt...');
      
      // Check tournament details
      const tournamentCheckResult = await db.query(`
        SELECT id, name, type, max_players, max_squads, max_groups, status
        FROM tournaments WHERE id = $1
      `, [tournamentId]);
      
      // Check current participants
      const participantsCheckResult = await db.query(`
        SELECT user_id, group_id, status 
        FROM tournament_participants 
        WHERE tournament_id = $1
      `, [tournamentId]);
      
      console.log('🔍 [DEBUG] Database state:', {
        tournamentExists: tournamentCheckResult[0].length > 0,
        tournament: tournamentCheckResult[0][0],
        totalParticipants: participantsCheckResult[0].length,
        participants: participantsCheckResult[0]
      });
      // ==================== END DEBUGGING ====================

      // Get tournament details
      const tournamentResult = await db.query(`
        SELECT t.*, 
               COUNT(tp.id) as participants_count
        FROM tournaments t
        LEFT JOIN tournament_participants tp ON t.id = tp.tournament_id 
          AND tp.status = 'joined'
        WHERE t.id = $1
        GROUP BY t.id
      `, [tournamentId]);

      if (tournamentResult[0].length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Tournament not found'
        });
      }

      const tournament = tournamentResult[0][0];

      // Check tournament status
      if (tournament.status !== 'upcoming') {
        return res.status(400).json({
          success: false,
          error: 'Tournament is not accepting new participants'
        });
      }

      // SQUAD TOURNAMENT VALIDATION (CRITICAL FOR SQUAD TYPE)
      if (tournament.type === 'squad') {
        if (!group_id) {
          return res.status(400).json({
            success: false,
            error: 'Group ID required for squad tournaments'
          });
        }

        // Check if user is admin of the group
        const isGroupAdminResult = await db.query(`
          SELECT 1 FROM group_members 
          WHERE group_id = $1 AND user_id = $2 AND role = 'admin' AND status = 'joined'
        `, [group_id, userId]);

        if (isGroupAdminResult[0].length === 0) {
          return res.status(403).json({
            success: false,
            error: 'You must be a group admin to join squad tournaments'
          });
        }

        // Check if group already in tournament
        const groupInTournamentResult = await db.query(`
          SELECT 1 FROM tournament_participants 
          WHERE tournament_id = $1 AND group_id = $2 AND status = 'joined'
          LIMIT 1
        `, [tournamentId, group_id]);

        if (groupInTournamentResult[0].length > 0) {
          return res.status(400).json({
            success: false,
            error: 'Your group is already registered in this tournament'
          });
        }

        // Check group size (1-5 members) - IMPORTANT FOR SQUAD TYPE
        const groupMembersCheckResult = await db.query(`
          SELECT COUNT(*) as member_count FROM group_members 
          WHERE group_id = $1 AND status = 'joined'
        `, [group_id]);

        if (groupMembersCheckResult[0][0].member_count < 1 || groupMembersCheckResult[0][0].member_count > 5) {
          return res.status(400).json({
            success: false,
            error: 'Group must have 1-5 members'
          });
        }

        // Check if any group member is already in tournament via another group
        const conflictingMembersResult = await db.query(`
          SELECT DISTINCT gm.user_id, u.username 
          FROM group_members gm
          JOIN users u ON gm.user_id = u.id
          JOIN tournament_participants tp ON gm.user_id = tp.user_id
          WHERE gm.group_id = $1 
            AND tp.tournament_id = $2
            AND tp.status = 'joined'
            AND tp.group_id != $3 -- Different group
        `, [group_id, tournamentId, group_id]);

        if (conflictingMembersResult[0].length > 0) {
          const memberNames = conflictingMembersResult[0].map(m => m.username).join(', ');
          return res.status(400).json({
            success: false,
            error: `These group members are already in tournament via other groups: ${memberNames}`
          });
        }

        // ==================== FIXED SQUAD COUNT LOGIC ====================
        console.log('🔍 [DEBUG] Starting squad capacity check...');
        
        // Check current squads - FIXED QUERY
        const currentSquadsResult = await db.query(`
          SELECT COUNT(DISTINCT group_id) as squad_count 
          FROM tournament_participants 
          WHERE tournament_id = $1 
            AND group_id IS NOT NULL 
            AND status = 'joined'
        `, [tournamentId]);

        console.log('🔍 [DEBUG] Squad count query result:', {
          rawResult: currentSquadsResult[0][0],
          tournamentId: tournamentId,
          query: 'COUNT DISTINCT group_id WHERE status = joined'
        });

        // Get actual list of registered groups for debugging
        const registeredGroupsResult = await db.query(`
          SELECT DISTINCT group_id, 
                 COUNT(*) as member_count,
                 MIN(created_at) as first_joined
          FROM tournament_participants 
          WHERE tournament_id = $1 
            AND group_id IS NOT NULL 
            AND status = 'joined'
          GROUP BY group_id
        `, [tournamentId]);

        console.log('🔍 [DEBUG] Registered groups detail:', {
          groups: registeredGroupsResult[0],
          totalGroups: registeredGroupsResult[0].length
        });

        // Handle both max_squads and max_groups columns
        const maxSquads = tournament.max_squads || tournament.max_groups || 8;
        const currentSquadCount = currentSquadsResult[0][0]?.squad_count || 0;

        console.log('🔍 [DEBUG] Capacity calculation:', {
          tournamentId: tournamentId,
          tournamentName: tournament.name,
          tournamentType: tournament.type,
          maxSquadsFromDB: tournament.max_squads,
          maxGroupsFromDB: tournament.max_groups,
          maxSquadsUsed: maxSquads,
          currentSquadCount: currentSquadCount,
          registeredGroupsCount: registeredGroupsResult[0].length,
          isFull: currentSquadCount >= maxSquads,
          tournamentData: tournament
        });

        if (currentSquadCount >= maxSquads) {
          return res.status(400).json({
            success: false,
            error: `Tournament is full. ${currentSquadCount}/${maxSquads} squads already registered.`,
            debug_info: {
              tournament_id: tournamentId,
              tournament_name: tournament.name,
              current_squads: currentSquadCount,
              max_squads: maxSquads,
              registered_groups: registeredGroupsResult[0].map(g => ({
                group_id: g.group_id,
                members: g.member_count,
                first_joined: g.first_joined
              })),
              tournament_type: tournament.type,
              query_used: 'COUNT(DISTINCT group_id) WHERE status = joined'
            }
          });
        }
      }

      // For non-squad tournaments (1v1, survival, freeforall)
      if (tournament.type !== 'squad') {
        // Check if user already joined
        const existingResult = await db.query(
          `SELECT * FROM tournament_participants 
           WHERE tournament_id = $1 AND user_id = $2 AND status = 'joined'`,
          [tournamentId, userId]
        );

        if (existingResult[0].length > 0) {
          return res.status(400).json({
            success: false,
            error: 'You have already joined this tournament'
          });
        }
      }

      // Check tournament capacity (for non-squad tournaments)
      if (tournament.type !== 'squad' && tournament.participants_count >= tournament.max_players) {
        return res.status(400).json({
          success: false,
          error: 'Tournament is full'
        });
      }

      // XP balance check - FIXED TYPE CONVERSION HERE
      const xpEntryFee = parseFloat(tournament.xp_entry_fee) || 0;
      if (xpEntryFee > 0) {
        const userResult = await db.query(
          `SELECT xp_points, username FROM users WHERE id = $1`,
          [userId]
        );

        if (userResult[0].length === 0) {
          return res.status(404).json({
            success: false,
            error: 'User not found'
          });
        }

        // FIXED: Convert xp_points to number for comparison
        const userXpBalance = parseFloat(userResult[0][0].xp_points) || 0;
        if (userXpBalance < xpEntryFee) {
          return res.status(400).json({
            success: false,
            error: `Insufficient XP balance. You need ${xpEntryFee} XP, you have ${userXpBalance} XP`
          });
        }
      }

      // Get connection for transaction
      await withTransaction(async (client) => {
        // Deduct XP if entry fee > 0 - FIXED TYPE CONVERSION
        if (xpEntryFee > 0) {
          const xpFee = parseFloat(xpEntryFee);
          console.log('💰 Deducting XP:', { userId, xpFee });
          
          // FIXED: Use numeric value
          await client.query(
            `UPDATE users SET xp_points = xp_points - $1 WHERE id = $2`,
            [xpFee, userId]
          );

          // Record XP transaction - FIXED: Use numeric value
          await client.query(
            `INSERT INTO xp_transactions (user_id, tournament_id, amount, type, description)
             VALUES ($1, $2, $3, 'spent', $4)`,
            [userId, tournamentId, xpFee, `Tournament entry fee: ${tournament.name}`]
          );
        }

        // Add participant(s) - ALL 4 TOURNAMENT TYPES PRESERVED
        if (tournament.type === 'squad') {
          // Get group members
          const membersResult = await client.query(`
            SELECT user_id FROM group_members 
            WHERE group_id = $1 AND status = 'joined'
          `, [group_id]);
          
          groupMembers = membersResult[0]; // Assign to the outer variable

          console.log('🔍 [DEBUG] Adding group members to tournament:', {
            groupId: group_id,
            memberCount: groupMembers.length,
            members: groupMembers
          });

          for (const member of groupMembers) {
            await client.query(
              `INSERT INTO tournament_participants (tournament_id, user_id, group_id, squad_name, status, created_at)
               VALUES ($1, $2, $3, $4, 'joined', NOW())`,
              [tournamentId, member.user_id, group_id, squad_name || null]
            );
          }

          // Send notification to group members
          for (const member of groupMembers) {
            if (member.user_id !== userId) { // Don't notify yourself
              await client.query(
                `INSERT INTO notifications (user_id, message, type, status, tournament_id, created_at)
                 VALUES ($1, $2, 'tournament', 'unread', $3, NOW())`,
                [
                  member.user_id,
                  `Your group has joined tournament "${tournament.name}"`,
                  tournamentId
                ]
              );
            }
          }
          
          console.log('✅ [DEBUG] Successfully registered squad:', {
            tournamentId: tournamentId,
            groupId: group_id,
            squadName: squad_name,
            membersAdded: groupMembers.length
          });
        } else {
          // Add individual participant (for 1v1, survival, freeforall)
          await client.query(
            `INSERT INTO tournament_participants (tournament_id, user_id, status, created_at)
             VALUES ($1, $2, 'joined', NOW())`,
            [tournamentId, userId]
          );
        }

        // Notify tournament creator
        if (parseInt(tournament.creator_id) !== parseInt(userId)) {
          const userResult = await client.query(
            `SELECT username FROM users WHERE id = $1`,
            [userId]
          );
          
          const username = userResult[0][0]?.username || 'User';
          
          await client.query(
            `INSERT INTO notifications (user_id, sender_id, message, type, status, tournament_id, created_at)
             VALUES ($1, $2, $3, 'tournament', 'unread', $4, NOW())`,
            [
              tournament.creator_id,
              userId,
              `${username} has joined your tournament "${tournament.name}"`,
              tournamentId
            ]
          );
        }
      });

      res.json({
        success: true,
        message: tournament.type === 'squad' 
          ? 'Squad registered successfully!' 
          : 'Successfully joined tournament!',
        xp_deducted: xpEntryFee,
        debug: tournament.type === 'squad' ? {
          group_id: group_id,
          members_added: groupMembers.length,
          squad_name: squad_name
        } : null
      });
    }
  } catch (error) {
    console.error('❌ Join tournament error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to join tournament: ' + error.message,
      debug: {
        tournamentId: req.params.id,
        userId: req.user?.id,
        errorType: error.name
      }
    });
  }
});

// ============================
// TOURNAMENT CREATION (UPDATED FOR XP SYSTEM)
// ============================

// POST /api/tournaments - Create tournament
router.post('/', async (req, res) => {
  try {
  const {
  name,
  game,
  description,
  max_players,
  entry_fee,
  prize_pool_option,
  custom_prize_pool,
  type,
  start_date,
  group_id,
  squad_name,
  max_squads = 8,
  admin_monitoring = false,
  admin_pin = null,
  dispute_resolution = 'auto',
  title_requirements_boundless = '',
  title_requirements_chaos = '',
  title_requirements_order = '',
  elimination_type = 'single',
  max_rounds = null,
  bracket_seed_type = 'random',
  consolation_bracket = false,
} = req.body;

    const userId = req.user.id;
    const isUserAdmin = Boolean(req.user.is_admin);

    console.log('🎮 Creating tournament:', {
      name,
      type,
      userId,
      isUserAdmin,
      admin_monitoring,
      dispute_resolution
    });

    if (db.isSupabase) {
      // SUPABASE VERSION
      
      // ==================== VALIDATION ====================

      if (!name || !game || !max_players || !type || !start_date) {
        return res.status(400).json({
          success: false,
          error: 'Missing required fields: name, game, max_players, type, start_date'
        });
      }

      const typeMapping = {
        '1v1': '1v1',
        'freeforall': 'freeforall', 
        'squad': 'squad',
        'survival': 'survival'
      };
      
      const dbType = typeMapping[type] || 'onevsone';

      // Squad tournament specific validations
      if (dbType === 'squad') {
        if (!group_id) {
          return res.status(400).json({
            success: false,
            error: 'Group ID is required for squad tournaments'
          });
        }
        
        const { count: isGroupAdmin, error: adminError } = await db.supabaseAdmin
          .from('group_members')
          .select('*', { count: 'exact', head: true })
          .eq('group_id', group_id)
          .eq('user_id', userId)
          .eq('role', 'admin')
          .eq('status', 'joined');

        if (adminError) throw adminError;

        if (!isGroupAdmin || isGroupAdmin === 0) {
          return res.status(403).json({
            success: false,
            error: 'You must be an admin of the selected group to create squad tournaments'
          });
        }

        const { count: memberCount, error: countError } = await db.supabaseAdmin
          .from('group_members')
          .select('*', { count: 'exact', head: true })
          .eq('group_id', group_id)
          .eq('status', 'joined');

        if (countError) throw countError;

        if (memberCount < 1 || memberCount > 5) {
          return res.status(400).json({
            success: false,
            error: 'Group must have 1-5 members for squad tournament'
          });
        }
      }

      const maxPlayers = parseInt(max_players);
      if (maxPlayers < 2 || maxPlayers > 100) {
        return res.status(400).json({
          success: false,
          error: 'Max players must be between 2 and 100'
        });
      }

      const xpEntryFee = parseFloat(entry_fee) || 0;
      if (xpEntryFee < 0) {
        return res.status(400).json({
          success: false,
          error: 'Entry fee cannot be negative'
        });
      }

      let prize_pool = 0;
      let platform_fee = 0;
      let customPrizePool = parseFloat(custom_prize_pool) || 0;

      if (prize_pool_option === 'entry_fee') {
        prize_pool = (xpEntryFee * maxPlayers) * 0.85;
        platform_fee = (xpEntryFee * maxPlayers) * 0.15;
      } else if (prize_pool_option === 'custom') {
        if (customPrizePool <= 0) {
          return res.status(400).json({
            success: false,
            error: 'Custom prize pool must be greater than 0'
          });
        }
        prize_pool = customPrizePool * 0.85;
        platform_fee = customPrizePool * 0.15;
      } else {
        return res.status(400).json({
          success: false,
          error: 'Invalid prize pool option'
        });
      }

      const startDate = new Date(start_date);
      const now = new Date();
      if (startDate <= now) {
        return res.status(400).json({
          success: false,
          error: 'Start date must be in the future'
        });
      }

      if (admin_pin && (admin_pin.length !== 4 || !/^\d+$/.test(admin_pin))) {
        return res.status(400).json({
          success: false,
          error: 'Admin PIN must be 4 digits'
        });
      }

      const validDisputeResolutions = ['auto', 'admin', 'voting'];
      if (!validDisputeResolutions.includes(dispute_resolution)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid dispute resolution method'
        });
      }

      const finalAdminMonitoring = dbType === 'survival' ? true : admin_monitoring;
      const finalDisputeResolution = dbType === 'survival' ? 'admin' : dispute_resolution;

      // ==================== XP BALANCE CHECK ====================

      const { data: user, error: userError } = await db.supabaseAdmin
        .from('users')
        .select('id, username, xp_points')
        .eq('id', userId)
        .single();

      if (userError || !user) {
        return res.status(404).json({
          success: false,
          error: 'User not found'
        });
      }

      const userXpBalance = user.xp_points || 0;

      if (xpEntryFee > 0 && userXpBalance < xpEntryFee) {
        return res.status(400).json({
          success: false,
          error: `Insufficient XP balance. You need ${xpEntryFee} XP, you have ${userXpBalance} XP`
        });
      }

      // ==================== DATABASE TRANSACTION (sequential) ====================

      let tournamentId;
      
      try {
        // ==================== CREATE TOURNAMENT ====================

        console.log('💾 Inserting tournament...');
        
       const { data: tournamentData, error: insertError } = await db.supabaseAdmin
  .from('tournaments')
  .insert([{
    name: name.trim(),
    game: game,
    description: description ? description.trim() : null,
    creator_id: userId,
    group_id: group_id || null,
    max_players: maxPlayers,
    xp_entry_fee: xpEntryFee,
    prize_pool: prize_pool,
    custom_prize_pool: customPrizePool,
    platform_fee: platform_fee,
    start_date: start_date,
    status: 'upcoming',
    type: dbType,
    prize_pool_option: prize_pool_option,
    currency: 'xp',
    squad_name: squad_name ? squad_name.trim() : null,
    max_squads: max_squads,
    max_players_per_squad: 5,
    admin_monitoring: finalAdminMonitoring,
    admin_pin: admin_pin,
    dispute_resolution: finalDisputeResolution,
    title_requirements_boundless: dbType === 'survival' ? (title_requirements_boundless || 'Boundless Explorer') : null,
    title_requirements_chaos: dbType === 'survival' ? (title_requirements_chaos || 'Master of Chaos') : null,
    title_requirements_order: dbType === 'survival' ? (title_requirements_order || 'Grand Master of Order') : null,
    elimination_type: elimination_type,
    max_rounds: max_rounds ? parseInt(max_rounds) : null,
    bracket_seed_type: bracket_seed_type,
    consolation_bracket: consolation_bracket,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }])
  .select();

        if (insertError) throw insertError;

        tournamentId = tournamentData[0].id;
        
        console.log(`✅ Tournament created with ID: ${tournamentId}`);

        // ==================== DEDUCT XP ENTRY FEE ====================

        if (xpEntryFee > 0) {
          await db.supabaseAdmin.rpc('deduct_xp_from_user', {
            user_id: userId,
            xp_amount: xpEntryFee
          });

          console.log(`💰 Deducted ${xpEntryFee} XP from user ${userId}`);

          await db.supabaseAdmin
            .from('xp_transactions')
            .insert([{
              user_id: userId,
              tournament_id: tournamentId,
              amount: xpEntryFee,
              type: 'spent',
              description: `Tournament entry fee: ${name}`,
              created_at: new Date().toISOString()
            }]);

          console.log(`📝 Recorded XP transaction`);
        }

        // ==================== ADD PARTICIPANTS ====================

        if (dbType === 'squad' && group_id) {
          const { data: groupMembers, error: membersError } = await db.supabaseAdmin
            .from('group_members')
            .select('user_id')
            .eq('group_id', group_id)
            .eq('status', 'joined');

          if (membersError) throw membersError;

          console.log(`👥 Adding ${groupMembers?.length || 0} group members to tournament`);

          const participantInserts = (groupMembers || []).map(member => ({
            tournament_id: tournamentId,
            user_id: member.user_id,
            group_id: group_id,
            squad_name: squad_name || null,
            status: 'joined',
            created_at: new Date().toISOString()
          }));

          if (participantInserts.length > 0) {
            const { error: participantError } = await db.supabaseAdmin
              .from('tournament_participants')
              .insert(participantInserts);

            if (participantError) throw participantError;
          }

          console.log(`✅ Added ${groupMembers?.length || 0} group members as participants`);
        } else {
          const { error: participantError } = await db.supabaseAdmin
            .from('tournament_participants')
            .insert([{
              tournament_id: tournamentId,
              user_id: userId,
              status: 'joined',
              created_at: new Date().toISOString()
            }]);

          if (participantError) throw participantError;

          console.log(`✅ Added creator ${userId} as first participant`);
        }

        // ==================== ADMIN MONITORING SETUP ====================

        if (finalAdminMonitoring) {
          const { error: adminError } = await db.supabaseAdmin
            .from('tournament_admins')
            .insert([{
              tournament_id: tournamentId,
              admin_id: userId,
              role: 'full_access',
              added_by: userId,
              permissions: JSON.stringify({
                monitor_matches: true,
                resolve_disputes: true,
                override_results: true,
                kick_players: true,
                distribute_prizes: true,
                modify_tournament: true
              }),
              created_at: new Date().toISOString()
            }]);

          if (adminError) throw adminError;

          console.log(`🛡️ Added creator as tournament admin with full access`);

          const { error: logError } = await db.supabaseAdmin
            .from('admin_monitoring_logs')
            .insert([{
              tournament_id: tournamentId,
              admin_id: userId,
              action_type: 'created_tournament',
              details: JSON.stringify({
                tournament_name: name,
                tournament_type: dbType,
                entry_fee: xpEntryFee,
                admin_monitoring: true,
                dispute_resolution: finalDisputeResolution
              }),
              created_at: new Date().toISOString()
            }]);

          if (logError) throw logError;
        }

        // ==================== NOTIFICATIONS ====================

        await db.supabaseAdmin
          .from('notifications')
          .insert([{
            user_id: userId,
            sender_id: userId,
            message: `Your tournament "${name}" has been created successfully!`,
            type: 'tournament',
            status: 'unread',
            tournament_id: tournamentId,
            created_at: new Date().toISOString()
          }]);

        console.log(`📨 Notification sent to creator`);

        if (dbType === 'squad' && group_id) {
          const { data: groupMembers, error: membersError } = await db.supabaseAdmin
            .from('group_members')
            .select('user_id')
            .eq('group_id', group_id)
            .eq('status', 'joined')
            .neq('user_id', userId);

          if (membersError) throw membersError;

          const notificationInserts = (groupMembers || []).map(member => ({
            user_id: member.user_id,
            sender_id: userId,
            message: `Your group has been registered in tournament "${name}"`,
            type: 'tournament',
            status: 'unread',
            tournament_id: tournamentId,
            created_at: new Date().toISOString()
          }));

          if (notificationInserts.length > 0) {
            const { error: notifError } = await db.supabaseAdmin
              .from('notifications')
              .insert(notificationInserts);

            if (notifError) throw notifError;
          }

          console.log(`📨 Notified ${groupMembers?.length || 0} group members`);
        }

        console.log(`✅ Tournament ${tournamentId} created successfully!`);

        // ==================== SUCCESS RESPONSE ====================

        res.json({
          success: true,
          message: 'Tournament created successfully!',
          tournament: {
            id: tournamentId,
            name: name,
            type: dbType,
            status: 'upcoming',
            max_players: maxPlayers,
            xp_entry_fee: xpEntryFee,
            prize_pool: prize_pool,
            admin_monitoring: finalAdminMonitoring,
            dispute_resolution: finalDisputeResolution,
            start_date: start_date,
            created_at: new Date().toISOString()
          },
          xp_deducted: xpEntryFee,
          participants_added: dbType === 'squad' ? 'all_group_members' : 'creator_only'
        });

      } catch (error) {
        console.error('❌ Tournament creation error:', error);
        throw error;
      }
      
    } else {
      // POSTGRESQL VERSION - keep your original code (entire block)
      // ==================== VALIDATION ====================

      if (!name || !game || !max_players || !type || !start_date) {
        return res.status(400).json({
          success: false,
          error: 'Missing required fields: name, game, max_players, type, start_date'
        });
      }

      const typeMapping = {
        '1v1': '1v1',
        'freeforall': 'freeforall', 
        'squad': 'squad',
        'survival': 'survival'
      };
      
      const dbType = typeMapping[type] || 'onevsone';

      // Squad tournament specific validations
      if (dbType === 'squad') {
        if (!group_id) {
          return res.status(400).json({
            success: false,
            error: 'Group ID is required for squad tournaments'
          });
        }
        
        const isGroupAdminResult = await db.query(`
          SELECT 1 FROM group_members 
          WHERE group_id = $1 AND user_id = $2 AND role = 'admin' AND status = 'joined'
          LIMIT 1
        `, [group_id, userId]);

        if (isGroupAdminResult[0].length === 0) {
          return res.status(403).json({
            success: false,
            error: 'You must be an admin of the selected group to create squad tournaments'
          });
        }

        const groupMembersResult = await db.query(`
          SELECT COUNT(*) as member_count FROM group_members 
          WHERE group_id = $1 AND status = 'joined'
        `, [group_id]);

        if (groupMembersResult[0][0].member_count < 1 || groupMembersResult[0][0].member_count > 5) {
          return res.status(400).json({
            success: false,
            error: 'Group must have 1-5 members for squad tournament'
          });
        }
      }

      const maxPlayers = parseInt(max_players);
      if (maxPlayers < 2 || maxPlayers > 100) {
        return res.status(400).json({
          success: false,
          error: 'Max players must be between 2 and 100'
        });
      }

      const xpEntryFee = parseFloat(entry_fee) || 0;
      if (xpEntryFee < 0) {
        return res.status(400).json({
          success: false,
          error: 'Entry fee cannot be negative'
        });
      }

      let prize_pool = 0;
      let platform_fee = 0;
      let customPrizePool = parseFloat(custom_prize_pool) || 0;

      if (prize_pool_option === 'entry_fee') {
        prize_pool = (xpEntryFee * maxPlayers) * 0.85;
        platform_fee = (xpEntryFee * maxPlayers) * 0.15;
      } else if (prize_pool_option === 'custom') {
        if (customPrizePool <= 0) {
          return res.status(400).json({
            success: false,
            error: 'Custom prize pool must be greater than 0'
          });
        }
        prize_pool = customPrizePool * 0.85;
        platform_fee = customPrizePool * 0.15;
      } else {
        return res.status(400).json({
          success: false,
          error: 'Invalid prize pool option'
        });
      }

      const startDate = new Date(start_date);
      const now = new Date();
      if (startDate <= now) {
        return res.status(400).json({
          success: false,
          error: 'Start date must be in the future'
        });
      }

      if (admin_pin && (admin_pin.length !== 4 || !/^\d+$/.test(admin_pin))) {
        return res.status(400).json({
          success: false,
          error: 'Admin PIN must be 4 digits'
        });
      }

      const validDisputeResolutions = ['auto', 'admin', 'voting'];
      if (!validDisputeResolutions.includes(dispute_resolution)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid dispute resolution method'
        });
      }

      const finalAdminMonitoring = dbType === 'survival' ? true : admin_monitoring;
      const finalDisputeResolution = dbType === 'survival' ? 'admin' : dispute_resolution;

      // ==================== XP BALANCE CHECK ====================

      const userResult = await db.query(
        `SELECT id, username, xp_points FROM users WHERE id = $1`,
        [userId]
      );

      if (userResult[0].length === 0) {
        return res.status(404).json({
          success: false,
          error: 'User not found'
        });
      }

      const userXpBalance = userResult[0][0].xp_points || 0;

      if (xpEntryFee > 0 && userXpBalance < xpEntryFee) {
        return res.status(400).json({
          success: false,
          error: `Insufficient XP balance. You need ${xpEntryFee} XP, you have ${userXpBalance} XP`
        });
      }

      // ==================== DATABASE TRANSACTION ====================

      let tournamentId;
      
      // Use BEGIN/COMMIT for PostgreSQL transaction
      await db.query('BEGIN');
      
      try {
        // ==================== CREATE TOURNAMENT ====================

        console.log('💾 Inserting tournament...');
        
        const tournamentResult = await db.query(`
          INSERT INTO tournaments (
            name, game, description, creator_id, group_id, 
            max_players, xp_entry_fee, prize_pool, custom_prize_pool, 
            platform_fee, start_date, status, type, prize_pool_option, 
            currency, squad_name, max_squads, max_players_per_squad,
            admin_monitoring, admin_pin, dispute_resolution,
            title_requirements_boundless, title_requirements_chaos, title_requirements_order,
            created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'upcoming', $12, $13, 'xp', $14, $15, 5, $16, $17, $18, $19, $20, $21, NOW(), NOW())
          RETURNING id
        `, [
          name.trim(),
          game,
          description ? description.trim() : null,
          userId,
          group_id || null,
          maxPlayers,
          xpEntryFee,
          prize_pool,
          customPrizePool,
          platform_fee,
          start_date,
          dbType,
          prize_pool_option,
          squad_name ? squad_name.trim() : null,
          max_squads,
          finalAdminMonitoring,
          admin_pin,
          finalDisputeResolution,
          dbType === 'survival' ? (title_requirements_boundless || 'Boundless Explorer') : null,
          dbType === 'survival' ? (title_requirements_chaos || 'Master of Chaos') : null,
          dbType === 'survival' ? (title_requirements_order || 'Grand Master of Order') : null
        ]);

        // POSTGRESQL: Use result[0][0]
        tournamentId = tournamentResult[0][0].id;
        
        console.log(`✅ Tournament created with ID: ${tournamentId}`);

        // ==================== DEDUCT XP ENTRY FEE ====================

        if (xpEntryFee > 0) {
          await db.query(
            `UPDATE users SET xp_points = xp_points - $1 WHERE id = $2`,
            [xpEntryFee, userId]
          );

          console.log(`💰 Deducted ${xpEntryFee} XP from user ${userId}`);

          await db.query(`
            INSERT INTO xp_transactions (
              user_id, tournament_id, amount, type, description, created_at
            ) VALUES ($1, $2, $3, 'spent', $4, NOW())
          `, [
            userId,
            tournamentId,
            xpEntryFee,
            `Tournament entry fee: ${name}`
          ]);

          console.log(`📝 Recorded XP transaction`);
        }

        // ==================== ADD PARTICIPANTS ====================

        if (dbType === 'squad' && group_id) {
          const groupMembersResult = await db.query(`
            SELECT user_id FROM group_members 
            WHERE group_id = $1 AND status = 'joined'
          `, [group_id]);

          console.log(`👥 Adding ${groupMembersResult[0].length} group members to tournament`);

          for (const member of groupMembersResult[0]) {
            await db.query(`
              INSERT INTO tournament_participants (
                tournament_id, user_id, group_id, squad_name, status, created_at
              ) VALUES ($1, $2, $3, $4, 'joined', NOW())
            `, [tournamentId, member.user_id, group_id, squad_name || null]);
          }

          console.log(`✅ Added ${groupMembersResult[0].length} group members as participants`);
        } else {
          await db.query(`
            INSERT INTO tournament_participants (
              tournament_id, user_id, status, created_at
            ) VALUES ($1, $2, 'joined', NOW())
          `, [tournamentId, userId]);

          console.log(`✅ Added creator ${userId} as first participant`);
        }

        // ==================== ADMIN MONITORING SETUP ====================

        if (finalAdminMonitoring) {
          await db.query(`
            INSERT INTO tournament_admins (
              tournament_id, admin_id, role, added_by, permissions
            ) VALUES ($1, $2, 'full_access', $3, $4)
          `, [
            tournamentId,
            userId,
            userId,
            JSON.stringify({
              monitor_matches: true,
              resolve_disputes: true,
              override_results: true,
              kick_players: true,
              distribute_prizes: true,
              modify_tournament: true
            })
          ]);

          console.log(`🛡️ Added creator as tournament admin with full access`);

          await db.query(`
            INSERT INTO admin_monitoring_logs (
              tournament_id, admin_id, action_type, details, created_at
            ) VALUES ($1, $2, 'created_tournament', $3, NOW())
          `, [
            tournamentId,
            userId,
            JSON.stringify({
              tournament_name: name,
              tournament_type: dbType,
              entry_fee: xpEntryFee,
              admin_monitoring: true,
              dispute_resolution: finalDisputeResolution
            })
          ]);
        }

        // ==================== NOTIFICATIONS ====================

        await db.query(`
          INSERT INTO notifications (
            user_id, sender_id, message, type, status, tournament_id, created_at
          ) VALUES ($1, $2, $3, 'tournament', 'unread', $4, NOW())
        `, [
          userId,
          userId,
          `Your tournament "${name}" has been created successfully!`,
          tournamentId
        ]);

        console.log(`📨 Notification sent to creator`);

        if (dbType === 'squad' && group_id) {
          const groupMembersResult = await db.query(`
            SELECT DISTINCT user_id FROM group_members 
            WHERE group_id = $1 AND status = 'joined' AND user_id != $2
          `, [group_id, userId]);

          for (const member of groupMembersResult[0]) {
            await db.query(`
              INSERT INTO notifications (
                user_id, sender_id, message, type, status, tournament_id, created_at)
              VALUES ($1, $2, $3, 'tournament', 'unread', $4, NOW())
            `, [
              member.user_id,
              userId,
              `Your group has been registered in tournament "${name}"`,
              tournamentId
            ]);
          }

          console.log(`📨 Notified ${groupMembersResult[0].length} group members`);
        }

        // Commit transaction
        await db.query('COMMIT');
        
        console.log(`✅ Tournament ${tournamentId} created successfully!`);

        // ==================== SUCCESS RESPONSE ====================

        res.json({
          success: true,
          message: 'Tournament created successfully!',
          tournament: {
            id: tournamentId,
            name: name,
            type: dbType,
            status: 'upcoming',
            max_players: maxPlayers,
            xp_entry_fee: xpEntryFee,
            prize_pool: prize_pool,
            admin_monitoring: finalAdminMonitoring,
            dispute_resolution: finalDisputeResolution,
            start_date: start_date,
            created_at: new Date().toISOString()
          },
          xp_deducted: xpEntryFee,
          participants_added: dbType === 'squad' ? 'all_group_members' : 'creator_only'
        });

      } catch (error) {
        // Rollback on error
        await db.query('ROLLBACK');
        console.error('❌ Transaction error:', error);
        throw error;
      }
    }
  } catch (error) {
    console.error('❌ Create tournament error:', error);
    console.error('❌ Error stack:', error.stack);
    res.status(500).json({
      success: false,
      error: 'Failed to create tournament: ' + error.message
    });
  }
});

// POST /api/tournaments/:id/start - Start tournament with bracket generation
router.post('/:id/start', authenticateToken, async (req, res) => {
  try {
    const tournamentId = req.params.id;
    const userId = req.user.id;

    console.log('🚀 Starting tournament:', { tournamentId, userId });

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'User ID not found in token'
      });
    }

    if (db.isSupabase) {
      // ==================== SUPABASE VERSION ====================
      
      // 1. Get tournament details
      const { data: tournament, error: tournamentError } = await db.supabaseAdmin
        .from('tournaments')
        .select('*')
        .eq('id', tournamentId)
        .single();

      if (tournamentError || !tournament) {
        return res.status(404).json({
          success: false,
          error: 'Tournament not found'
        });
      }

      // 2. Get all participants
      const { data: participants, error: participantsError } = await db.supabaseAdmin
        .from('tournament_participants')
        .select(`
          user_id,
          users!inner (
            id,
            username,
            rank,
            wins
          )
        `)
        .eq('tournament_id', tournamentId)
        .eq('status', 'joined');

      if (participantsError) {
        console.error('Error fetching participants:', participantsError);
        return res.status(500).json({
          success: false,
          error: 'Failed to fetch participants'
        });
      }

      const participantsCount = participants?.length || 0;

      // 3. Check permissions
      if (tournament.creator_id.toString() !== userId.toString()) {
        return res.status(403).json({
          success: false,
          error: 'Only tournament creator can start the tournament'
        });
      }

      // 4. Check tournament status
      if (tournament.status !== 'upcoming') {
        return res.status(400).json({
          success: false,
          error: `Tournament is already ${tournament.status}`
        });
      }

      // 5. Check minimum participants
      if (participantsCount < 2) {
        return res.status(400).json({
          success: false,
          error: `Need at least 2 participants to start (currently ${participantsCount})`
        });
      }

            // 6. Generate bracket matches for 1v1 tournaments ONLY
      let matchesGenerated = 0;
      
      if (tournament.type === '1v1') {
        console.log('🎮 Generating advanced bracket for 1v1 tournament...');
        
        const bracketConfig = {
          elimination_type: tournament.elimination_type || 'single',
          max_rounds: tournament.max_rounds || null,
          consolation_bracket: tournament.consolation_bracket || false
        };
        
        const bracketMatches = generateAdvancedBracket(
          participants, 
          tournamentId, 
          tournament.start_date || new Date(),
          bracketConfig
        );
        
        if (bracketMatches.length > 0) {
          const { error: insertError } = await db.supabaseAdmin
            .from('tournament_matches')
            .insert(bracketMatches);
          
          if (insertError) {
            console.error('❌ Failed to insert matches:', insertError);
            return res.status(500).json({
              success: false,
              error: 'Failed to generate bracket matches: ' + insertError.message
            });
          }
          
          matchesGenerated = bracketMatches.length;
          console.log(`✅ Generated ${bracketMatches.length} matches with ${bracketConfig.elimination_type} elimination`);
        }
      } else if (tournament.type === 'survival') {
        console.log('🔥 Survival tournament started - no bracket needed');
      } else if (tournament.type === 'freeforall') {
        console.log('🎯 Free-for-all tournament started - no bracket needed');
      } else if (tournament.type === 'squad') {
        console.log('👥 Squad tournament started - bracket generation would go here');
      }

      // 7. Update tournament status to ongoing
      const { error: updateError } = await db.supabaseAdmin
        .from('tournaments')
        .update({ 
          status: 'ongoing', 
          updated_at: new Date().toISOString() 
        })
        .eq('id', tournamentId);

      if (updateError) {
        console.error('❌ Failed to update tournament status:', updateError);
        return res.status(500).json({
          success: false,
          error: 'Failed to update tournament status'
        });
      }

      console.log('✅ Tournament status updated to ongoing');

      // 8. Send notifications to all participants
      if (participants && participants.length > 0) {
        for (const participant of participants) {
          let message = `Tournament '${tournament.name}' has started! `;
          
          if (tournament.type === 'survival') {
            message += 'Enter the game room and start battling!';
          } else if (tournament.type === '1v1') {
            message += `Check the bracket for your match schedule.`;
          } else {
            message += 'The tournament is now live!';
          }
          
          await db.supabaseAdmin
            .from('notifications')
            .insert([{
              user_id: participant.user_id,
              message: message,
              type: 'system',
              status: 'unread',
              tournament_id: tournamentId,
              created_at: new Date().toISOString()
            }]);
        }
      }

      console.log(`✅ Tournament ${tournamentId} started successfully with ${matchesGenerated} matches`);

      // 9. Return success response
      res.json({
        success: true,
        message: tournament.type === '1v1' 
          ? `Tournament started! ${matchesGenerated} matches have been created.`
          : `Tournament started successfully!`,
        tournament: {
          id: tournamentId,
          name: tournament.name,
          status: 'ongoing',
          type: tournament.type
        },
        matches_generated: matchesGenerated
      });
      
    } else {
      // ==================== POSTGRESQL VERSION ====================
      
      // Get tournament details
      const tournamentResult = await db.query(`
        SELECT * FROM tournaments WHERE id = $1
      `, [tournamentId]);

      if (tournamentResult[0].length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Tournament not found'
        });
      }

      const tournament = tournamentResult[0][0];

      // Get participants
      const participantsResult = await db.query(`
        SELECT tp.user_id, u.username, u.rank, u.wins
        FROM tournament_participants tp
        JOIN users u ON tp.user_id = u.id
        WHERE tp.tournament_id = $1 AND tp.status = 'joined'
      `, [tournamentId]);

      const participants = participantsResult[0];
      const participantsCount = participants.length;

      // Check permissions
      if (tournament.creator_id.toString() !== userId.toString()) {
        return res.status(403).json({
          success: false,
          error: 'Only tournament creator can start the tournament'
        });
      }

      // Check tournament status
      if (tournament.status !== 'upcoming') {
        return res.status(400).json({
          success: false,
          error: `Tournament is already ${tournament.status}`
        });
      }

      // Check minimum participants
      if (participantsCount < 2) {
        return res.status(400).json({
          success: false,
          error: `Need at least 2 participants to start (currently ${participantsCount})`
        });
      }

      // Start transaction
      await db.query('BEGIN');
      
      try {
        let matchesGenerated = 0;
        
        // Generate bracket for 1v1 tournaments
        if (tournament.type === '1v1') {
          console.log('🎮 Generating 1v1 bracket for', participantsCount, 'participants...');
          
          // Shuffle participants
          const shuffled = [...participants].sort(() => Math.random() - 0.5);
          const startDate = new Date(tournament.start_date || new Date());
          
          // Create first round matches
          for (let i = 0; i < shuffled.length; i += 2) {
            const player1 = shuffled[i];
            const player2 = shuffled[i + 1];
            
            if (player2) {
              // Normal match
              await db.query(`
                INSERT INTO tournament_matches 
                (tournament_id, player1_id, player2_id, round_number, match_time, status, created_at)
                VALUES ($1, $2, $3, 1, $4, 'upcoming', NOW())
              `, [tournamentId, player1.user_id, player2.user_id, new Date(startDate.getTime() + (i * 15 * 60000))]);
              matchesGenerated++;
              console.log(`✅ Match created: ${player1.username} vs ${player2.username}`);
            } else if (player1) {
              // BYE match
              await db.query(`
                INSERT INTO tournament_matches 
                (tournament_id, player1_id, player2_id, round_number, match_time, status, winner_id, completed_at, created_at)
                VALUES ($1, $2, NULL, 1, $3, 'completed', $4, NOW(), NOW())
              `, [tournamentId, player1.user_id, new Date(startDate.getTime() + (i * 15 * 60000)), player1.user_id]);
              matchesGenerated++;
              console.log(`✅ BYE match created for: ${player1.username}`);
            }
          }
          
          // Calculate rounds needed
          const roundsNeeded = Math.ceil(Math.log2(participantsCount));
          let matchesInCurrentRound = Math.ceil(shuffled.length / 2);
          let currentRound = 2;
          
          // Create placeholder matches for subsequent rounds
          while (currentRound <= roundsNeeded && matchesInCurrentRound > 0) {
            for (let i = 0; i < matchesInCurrentRound; i++) {
              await db.query(`
                INSERT INTO tournament_matches 
                (tournament_id, player1_id, player2_id, round_number, match_time, status, created_at)
                VALUES ($1, NULL, NULL, $2, $3, 'upcoming', NOW())
              `, [tournamentId, currentRound, new Date(startDate.getTime() + (currentRound * 60 * 60000))]);
              matchesGenerated++;
            }
            
            matchesInCurrentRound = Math.ceil(matchesInCurrentRound / 2);
            currentRound++;
          }
        }
        
        // Update tournament status
        await db.query(`
          UPDATE tournaments 
          SET status = 'ongoing', updated_at = NOW() 
          WHERE id = $1
        `, [tournamentId]);
        
        // Send notifications
        for (const participant of participants) {
          let message = `Tournament '${tournament.name}' has started! `;
          if (tournament.type === '1v1') {
            message += 'Check the bracket for your match schedule.';
          } else {
            message += 'The tournament is now live!';
          }
          
          await db.query(`
            INSERT INTO notifications (user_id, message, type, status, tournament_id, created_at)
            VALUES ($1, $2, 'system', 'unread', $3, NOW())
          `, [participant.user_id, message, tournamentId]);
        }
        
        await db.query('COMMIT');
        
        console.log(`✅ Tournament ${tournamentId} started successfully with ${matchesGenerated} matches`);
        
        res.json({
          success: true,
          message: tournament.type === '1v1' 
            ? `Tournament started! ${matchesGenerated} matches have been created.`
            : `Tournament started successfully!`,
          tournament: {
            id: tournamentId,
            name: tournament.name,
            status: 'ongoing',
            type: tournament.type
          },
          matches_generated: matchesGenerated
        });
        
      } catch (error) {
        await db.query('ROLLBACK');
        console.error('❌ Transaction error:', error);
        throw error;
      }
    }
  } catch (error) {
    console.error('❌ Start tournament error:', error);
    console.error('❌ Error stack:', error.stack);
    
    res.status(500).json({
      success: false,
      error: 'Failed to start tournament: ' + error.message
    });
  }
});

// Helper function for tournament start messages
function getTournamentStartMessage(tournamentType) {
  const messages = {
    'survival': 'Survival tournament started! All players can now enter the game room and battle.',
    '1v1': 'Tournament started and bracket generated! Check your matches.',
    'freeforall': 'Free-for-all tournament started! Battle begins now.',
    'squad': 'Squad tournament started!'
  };
  return messages[tournamentType] || 'Tournament started successfully!';
}

// GET /api/tournaments/:id/chat - Get tournament chat messages (UPDATED WITH DEBUG)
router.get('/:id/chat', async (req, res) => {
  try {
    const tournamentId = req.params.id;
    const userId = req.user.id;

    console.log('💬 CHAT ACCESS - User ID:', userId, 'Tournament ID:', tournamentId);

    if (db.isSupabase) {
      // SUPABASE VERSION
      
      // Check if user is participant or creator
      const { data: tournament, error: tournamentError } = await db.supabaseAdmin
        .from('tournaments')
        .select('creator_id, name')
        .eq('id', tournamentId)
        .single();

      if (tournamentError) throw tournamentError;

      const { count: participantCount, error: participantError } = await db.supabaseAdmin
        .from('tournament_participants')
        .select('*', { count: 'exact', head: true })
        .eq('tournament_id', tournamentId)
        .eq('user_id', userId)
        .eq('status', 'joined');

      if (participantError) throw participantError;

      const isCreator = tournament.creator_id === userId;
      const isParticipant = participantCount > 0;

      console.log('💬 CHAT ACCESS RESULT:', {
        hasAccess: isCreator || isParticipant,
        userId: userId,
        tournamentId: tournamentId,
        isCreator,
        isParticipant
      });

      if (!isCreator && !isParticipant) {
        console.log('💬 CHAT ACCESS DENIED DETAILS:', {
          tournamentCreator: tournament.creator_id,
          currentUser: userId,
          isCreator: tournament.creator_id == userId,
          participantStatus: isParticipant ? 'joined' : 'not found',
          tournamentName: tournament.name
        });
        
        return res.status(403).json({
          success: false,
          error: 'Only tournament participants and creator can access chat',
          debug: {
            isCreator,
            isParticipant,
            tournamentId: tournamentId,
            userId: userId
          }
        });
      }

      // Get chat messages with user details
      const { data: messages, error: messagesError } = await db.supabaseAdmin
        .from('tournament_chat')
        .select(`
          *,
          users!inner (
            id,
            username,
            profile_pic,
            rank
          )
        `)
        .eq('tournament_id', tournamentId)
        .order('created_at', { ascending: false })
        .limit(50);

      if (messagesError) throw messagesError;

      // Format messages with user role
      const formattedMessages = (messages || []).map(msg => {
        let userRole = 'participant';
        if (msg.user_id === userId) {
          userRole = 'you';
        } else if (msg.user_id === tournament.creator_id) {
          userRole = 'creator';
        }
        
        return {
          ...msg,
          username: msg.users?.username,
          profile_pic: msg.users?.profile_pic,
          rank: msg.users?.rank,
          user_role: userRole,
          users: undefined // Remove nested
        };
      });

      console.log('💬 FOUND MESSAGES:', formattedMessages.length);

      res.json({
        success: true,
        messages: formattedMessages.reverse() || [], // Return in chronological order
        tournament_id: tournamentId,
        user_id: userId
      });
      
    } else {
      // POSTGRESQL VERSION - keep your original code
      console.log('💬 CHAT ACCESS - User ID:', userId, 'Tournament ID:', tournamentId);

      // Check if user is participant or creator
      const hasAccessResult = await db.query(`
        SELECT 1 FROM (
          SELECT creator_id FROM tournaments WHERE id = $1 AND creator_id = $2
          UNION
          SELECT user_id FROM tournament_participants 
          WHERE tournament_id = $1 AND user_id = $2 AND status = 'joined'
        ) as access_check
      `, [tournamentId, userId]);

      console.log('💬 CHAT ACCESS RESULT:', {
        hasAccess: hasAccessResult[0].length > 0,
        userId: userId,
        tournamentId: tournamentId
      });

      if (hasAccessResult[0].length === 0) {
        // For debugging, get more details
        const tournamentInfo = await db.query(
          'SELECT creator_id, name FROM tournaments WHERE id = $1',
          [tournamentId]
        );
        
        const participantCheck = await db.query(
          'SELECT user_id, status FROM tournament_participants WHERE tournament_id = $1 AND user_id = $2',
          [tournamentId, userId]
        );
        
        console.log('💬 CHAT ACCESS DENIED DETAILS:', {
          tournamentCreator: tournamentInfo[0][0]?.creator_id,
          currentUser: userId,
          isCreator: tournamentInfo[0][0]?.creator_id == userId,
          participantStatus: participantCheck[0][0]?.status || 'not found',
          tournamentName: tournamentInfo[0][0]?.name
        });
        
        return res.status(403).json({
          success: false,
          error: 'Only tournament participants and creator can access chat',
          debug: {
            isCreator: tournamentInfo[0][0]?.creator_id == userId,
            isParticipant: participantCheck[0].length > 0,
            participantStatus: participantCheck[0][0]?.status,
            tournamentId: tournamentId,
            userId: userId
          }
        });
      }

      // Get chat messages with user details
      const messagesResult = await db.query(`
        SELECT 
          tc.*, 
          u.username,
          u.profile_pic,
          u.rank,
          CASE 
            WHEN u.id = $1 THEN 'you'
            WHEN u.id = (SELECT creator_id FROM tournaments WHERE id = $2) THEN 'creator'
            ELSE 'participant'
          END as user_role
        FROM tournament_chat tc
        JOIN users u ON tc.user_id = u.id
        WHERE tc.tournament_id = $2
        ORDER BY tc.created_at DESC
        LIMIT 50
      `, [userId, tournamentId]);

      console.log('💬 FOUND MESSAGES:', messagesResult[0].length);

      res.json({
        success: true,
        messages: messagesResult[0].reverse() || [], // Return in chronological order
        tournament_id: tournamentId,
        user_id: userId
      });
    }
  } catch (error) {
    console.error('❌ Get chat error:', error);
    console.error('❌ Error stack:', error.stack);
    res.status(500).json({
      success: false,
      error: 'Failed to get chat messages: ' + error.message
    });
  }
});

// POST /api/tournaments/:id/chat/send - Send chat message (UPDATED)
router.post('/:id/chat/send', async (req, res) => {
  try {
    const tournamentId = req.params.id;
    const userId = req.user.id;
    const { message } = req.body;

    console.log('💬 SENDING CHAT:', { tournamentId, userId, messageLength: message?.length });

    if (!message || message.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Message cannot be empty'
      });
    }

    if (message.length > 500) {
      return res.status(400).json({
        success: false,
        error: 'Message too long (max 500 characters)'
      });
    }

    if (db.isSupabase) {
      // SUPABASE VERSION
      
      // Check if user is participant or creator
      const { data: tournament, error: tournamentError } = await db.supabaseAdmin
        .from('tournaments')
        .select('creator_id')
        .eq('id', tournamentId)
        .single();

      if (tournamentError) throw tournamentError;

      const { count: participantCount, error: participantError } = await db.supabaseAdmin
        .from('tournament_participants')
        .select('*', { count: 'exact', head: true })
        .eq('tournament_id', tournamentId)
        .eq('user_id', userId)
        .eq('status', 'joined');

      if (participantError) throw participantError;

      const hasAccess = tournament.creator_id === userId || participantCount > 0;

      if (!hasAccess) {
        console.log('💬 SEND CHAT DENIED - User has no access:', { userId, tournamentId });
        return res.status(403).json({
          success: false,
          error: 'Only tournament participants and creator can send messages'
        });
      }

      // Insert message
      const { data: insertedMessage, error: insertError } = await db.supabaseAdmin
        .from('tournament_chat')
        .insert([{
          tournament_id: tournamentId,
          user_id: userId,
          message: message.trim(),
          created_at: new Date().toISOString()
        }])
        .select();

      if (insertError) throw insertError;

      console.log('💬 MESSAGE INSERTED:', insertedMessage[0]?.id);

      // Get the inserted message with user details
      const { data: messageWithUser, error: userError } = await db.supabaseAdmin
        .from('tournament_chat')
        .select(`
          *,
          users!inner (
            id,
            username,
            profile_pic,
            rank
          )
        `)
        .eq('id', insertedMessage[0].id)
        .single();

      if (userError) throw userError;

      const userRole = messageWithUser.user_id === userId ? 'you' : 
                      messageWithUser.user_id === tournament.creator_id ? 'creator' : 'participant';

      const formattedMessage = {
        ...messageWithUser,
        username: messageWithUser.users?.username,
        profile_pic: messageWithUser.users?.profile_pic,
        rank: messageWithUser.users?.rank,
        user_role: userRole,
        users: undefined
      };

      res.json({
        success: true,
        message: 'Message sent successfully',
        chat_message: formattedMessage
      });
      
    } else {
      // POSTGRESQL VERSION - keep your original code
      // Check if user is participant or creator
      const hasAccessResult = await db.query(`
        SELECT 1 FROM (
          SELECT creator_id FROM tournaments WHERE id = $1 AND creator_id = $2
          UNION
          SELECT user_id FROM tournament_participants WHERE tournament_id = $1 AND user_id = $2 AND status = 'joined'
        ) as access_check
      `, [tournamentId, userId]);

      if (hasAccessResult[0].length === 0) {
        console.log('💬 SEND CHAT DENIED - User has no access:', { userId, tournamentId });
        return res.status(403).json({
          success: false,
          error: 'Only tournament participants and creator can send messages'
        });
      }

      // Insert message
      const result = await db.query(`
        INSERT INTO tournament_chat (tournament_id, user_id, message, created_at)
        VALUES ($1, $2, $3, NOW())
        RETURNING *
      `, [tournamentId, userId, message.trim()]);

      console.log('💬 MESSAGE INSERTED:', result[0][0]?.id);

      // Get the inserted message with user details
      const insertedMessageResult = await db.query(`
        SELECT 
          tc.*, 
          u.username,
          u.profile_pic,
          u.rank,
          CASE 
            WHEN u.id = $1 THEN 'you'
            WHEN u.id = (SELECT creator_id FROM tournaments WHERE id = $2) THEN 'creator'
            ELSE 'participant'
          END as user_role
        FROM tournament_chat tc
        JOIN users u ON tc.user_id = u.id
        WHERE tc.id = $3
      `, [userId, tournamentId, result[0][0].id]);

      res.json({
        success: true,
        message: 'Message sent successfully',
        chat_message: insertedMessageResult[0][0]
      });
    }
  } catch (error) {
    console.error('❌ Send chat error:', error);
    console.error('❌ Error stack:', error.stack);
    res.status(500).json({
      success: false,
      error: 'Failed to send message: ' + error.message
    });
  }
});

// DELETE /api/tournaments/:id/participants/:userId - Kick participant from tournament
router.delete('/:id/participants/:userId', async (req, res) => {
  try {
    const tournamentId = req.params.id;
    const targetUserId = req.params.userId;
    const adminUserId = req.user.userId || req.user.id;

    console.log('👢 Kicking participant:', { tournamentId, targetUserId, adminUserId });

    if (db.isSupabase) {
      // SUPABASE VERSION
      
      // Get tournament details
      const { data: tournament, error: tournamentError } = await db.supabaseAdmin
        .from('tournaments')
        .select('*')
        .eq('id', tournamentId)
        .single();

      if (tournamentError || !tournament) {
        throw new Error('Tournament not found');
      }

      // Get participant count
      const { count: participantsCount, error: countError } = await db.supabaseAdmin
        .from('tournament_participants')
        .select('*', { count: 'exact', head: true })
        .eq('tournament_id', tournamentId)
        .eq('status', 'joined');

      if (countError) throw countError;
      tournament.participants_count = participantsCount || 0;

      // Check permissions
      if (tournament.creator_id !== adminUserId) {
        throw new Error('Only tournament creator can kick participants');
      }

      if (tournament.status !== 'upcoming') {
        throw new Error('Cannot kick participants after tournament has started');
      }

      // Check if target is participant
      const { count: isParticipant, error: participantError } = await db.supabaseAdmin
        .from('tournament_participants')
        .select('*', { count: 'exact', head: true })
        .eq('tournament_id', tournamentId)
        .eq('user_id', targetUserId)
        .eq('status', 'joined');

      if (participantError) throw participantError;

      if (!isParticipant || isParticipant === 0) {
        throw new Error('User is not a participant in this tournament');
      }

      // Cannot kick yourself or the creator
      if (parseInt(targetUserId) === parseInt(adminUserId)) {
        throw new Error('Cannot kick yourself from tournament');
      }

      // Update participant status to kicked
      const { error: updateError } = await db.supabaseAdmin
        .from('tournament_participants')
        .update({ status: 'declined' })
        .eq('tournament_id', tournamentId)
        .eq('user_id', targetUserId);

      if (updateError) throw updateError;

      // Refund entry fee if tournament hasn't started
      if (tournament.xp_entry_fee > 0) {
        await db.supabaseAdmin.rpc('add_xp_to_user', {
          user_id: targetUserId,
          xp_amount: tournament.xp_entry_fee
        });

        // Record refund transaction
        await db.supabaseAdmin
          .from('xp_transactions')
          .insert([{
            user_id: targetUserId,
            tournament_id: tournamentId,
            amount: tournament.xp_entry_fee,
            type: 'refund',
            description: `Refund for tournament kick: ${tournament.name}`,
            created_at: new Date().toISOString()
          }]);
      }

      // Get admin username
      const { data: adminUser } = await db.supabaseAdmin
        .from('users')
        .select('username')
        .eq('id', adminUserId)
        .single();

      // Send notification to kicked user
      await db.supabaseAdmin
        .from('notifications')
        .insert([{
          user_id: targetUserId,
          sender_id: adminUserId,
          message: `You have been removed from tournament '${tournament.name}' by ${adminUser?.username || 'tournament admin'}`,
          type: 'system',
          status: 'unread',
          tournament_id: tournamentId,
          created_at: new Date().toISOString()
        }]);

      console.log(`✅ User ${targetUserId} kicked from tournament ${tournamentId}`);

      res.json({
        success: true,
        message: 'Participant removed successfully',
        refunded: tournament.xp_entry_fee > 0
      });
      
    } else {
      // POSTGRESQL VERSION - keep your original code
      await withTransaction(async (client) => {
        // Get tournament details
        const tournamentResult = await client.query(`
          SELECT t.*, COUNT(tp.id) as participants_count
          FROM tournaments t
          LEFT JOIN tournament_participants tp ON t.id = tp.tournament_id 
            AND tp.status = 'joined'
          WHERE t.id = $1
          GROUP BY t.id
        `, [tournamentId]);

        if (tournamentResult[0].length === 0) {
          throw new Error('Tournament not found');
        }

        const tournament = tournamentResult[0][0];

        // Check permissions
        if (tournament.creator_id !== adminUserId) {
          throw new Error('Only tournament creator can kick participants');
        }

        if (tournament.status !== 'upcoming') {
          throw new Error('Cannot kick participants after tournament has started');
        }

        // Check if target is participant
        const isParticipantResult = await client.query(`
          SELECT * FROM tournament_participants 
          WHERE tournament_id = $1 AND user_id = $2 AND status = 'joined'
        `, [tournamentId, targetUserId]);

        if (isParticipantResult[0].length === 0) {
          throw new Error('User is not a participant in this tournament');
        }

        // Cannot kick yourself or the creator
        if (parseInt(targetUserId) === parseInt(adminUserId)) {
          throw new Error('Cannot kick yourself from tournament');
        }

        // Update participant status to kicked
        await client.query(`
          UPDATE tournament_participants 
          SET status = 'declined'
          WHERE tournament_id = $1 AND user_id = $2
        `, [tournamentId, targetUserId]);

        // Refund entry fee if tournament hasn't started
        if (tournament.entry_fee > 0) {
          await client.query(`
            UPDATE users 
            SET balance = balance + $1
            WHERE id = $2
          `, [tournament.entry_fee, targetUserId]);

          // Record refund transaction
          const reference = `KICK-REFUND-${Date.now()}-${tournamentId}`;
          await client.query(`
            INSERT INTO transactions 
            (user_id, amount, currency, type, status, reference, description, created_at)
            VALUES ($1, $2, 'NGN', 'refund', 'completed', $3, $4, NOW())
          `, [
            targetUserId,
            tournament.entry_fee,
            reference,
            `Refund for tournament kick: ${tournament.name}`
          ]);
        }

        // Send notification to kicked user
        const adminUserResult = await client.query(
          `SELECT username FROM users WHERE id = $1`,
          [adminUserId]
        );

        await client.query(`
          INSERT INTO notifications 
          (user_id, sender_id, message, type, status, tournament_id, created_at)
          VALUES ($1, $2, $3, 'system', 'unread', $4, NOW())
        `, [
          targetUserId,
          adminUserId,
          `You have been removed from tournament '${tournament.name}' by ${adminUserResult[0][0]?.username || 'tournament admin'}`,
          tournamentId
        ]);
      });

      console.log(`✅ User ${targetUserId} kicked from tournament ${tournamentId}`);

      res.json({
        success: true,
        message: 'Participant removed successfully',
        refunded: tournament.entry_fee > 0
      });
    }
  } catch (error) {
    console.error('❌ Kick participant error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to kick participant: ' + error.message
    });
  }
});

// POST /api/tournaments/:id/auto-complete - Auto-complete tournament when all matches are done
router.post('/:id/auto-complete', async (req, res) => {
  try {
    const tournamentId = req.params.id;
    const userId = req.user.userId || req.user.id;

    console.log('🤖 Auto-completing tournament:', tournamentId);

    if (db.isSupabase) {
      // SUPABASE VERSION
      
      // Check if user is creator
      const { data: tournament, error: tournamentError } = await db.supabaseAdmin
        .from('tournaments')
        .select('creator_id')
        .eq('id', tournamentId)
        .single();

      if (tournamentError || !tournament) {
        return res.status(404).json({
          success: false,
          error: 'Tournament not found'
        });
      }

      if (tournament.creator_id !== userId) {
        return res.status(403).json({
          success: false,
          error: 'Only tournament creator can auto-complete'
        });
      }

      // Check and complete tournament
      const completed = await checkTournamentCompletionSupabase(tournamentId, false);

      if (completed) {
        res.json({
          success: true,
          message: 'Tournament auto-completed successfully!',
          tournament_id: tournamentId
        });
      } else {
        res.status(400).json({
          success: false,
          error: 'Tournament cannot be completed yet. Not all matches are finished.'
        });
      }
      
    } else {
      // POSTGRESQL VERSION - keep your original code
      // Check if user is creator
      const tournamentResult = await db.query(
        `SELECT creator_id FROM tournaments WHERE id = $1`,
        [tournamentId]
      );

      if (tournamentResult[0].length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Tournament not found'
        });
      }

      if (tournamentResult[0][0].creator_id !== userId) {
        return res.status(403).json({
          success: false,
          error: 'Only tournament creator can auto-complete'
        });
      }

      // Check and complete tournament
      const completed = await checkTournamentCompletion(tournamentId, false);

      if (completed) {
        res.json({
          success: true,
          message: 'Tournament auto-completed successfully!',
          tournament_id: tournamentId
        });
      } else {
        res.status(400).json({
          success: false,
          error: 'Tournament cannot be completed yet. Not all matches are finished.'
        });
      }
    }
  } catch (error) {
    console.error('❌ Auto-complete tournament error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to auto-complete tournament: ' + error.message
    });
  }
});

// POST /api/tournaments/:id/cancel - Cancel tournament with refunds
router.post('/:id/cancel', async (req, res) => {
  try {
    const tournamentId = req.params.id;
    const userId = req.user.userId || req.user.id;

    console.log('🚫 Canceling tournament:', { tournamentId, userId });

    if (db.isSupabase) {
      // SUPABASE VERSION
      
      // Get tournament with participants
      const { data: tournament, error: tournamentError } = await db.supabaseAdmin
        .from('tournaments')
        .select(`
          *,
          tournament_participants!left (
            user_id,
            status
          )
        `)
        .eq('id', tournamentId)
        .single();

      if (tournamentError || !tournament) {
        throw new Error('Tournament not found');
      }

      // Calculate participants count
      const joinedParticipants = (tournament.tournament_participants || [])
        .filter(p => p.status === 'joined');
      tournament.participants_count = joinedParticipants.length;

      // Check permissions
      if (tournament.creator_id !== userId) {
        throw new Error('Only tournament creator can cancel tournament');
      }

      if (tournament.status === 'completed' || tournament.status === 'cancelled') {
        throw new Error(`Tournament is already ${tournament.status}`);
      }

      // Get all participants to refund
      const participants = joinedParticipants;

      // Update tournament status
      const { error: updateError } = await db.supabaseAdmin
        .from('tournaments')
        .update({ 
          status: 'cancelled', 
          completed_at: new Date().toISOString() 
        })
        .eq('id', tournamentId);

      if (updateError) throw updateError;

      // Refund entry fees to all participants
      if (tournament.xp_entry_fee > 0) {
        for (const participant of participants) {
          await db.supabaseAdmin.rpc('add_xp_to_user', {
            user_id: participant.user_id,
            xp_amount: tournament.xp_entry_fee
          });

          // Record refund transaction
          await db.supabaseAdmin
            .from('xp_transactions')
            .insert([{
              user_id: participant.user_id,
              tournament_id: tournamentId,
              amount: tournament.xp_entry_fee,
              type: 'refund',
              description: `Refund for cancelled tournament: ${tournament.name}`,
              created_at: new Date().toISOString()
            }]);
        }
      }

      // Send notifications to all participants
      for (const participant of participants) {
        await db.supabaseAdmin
          .from('notifications')
          .insert([{
            user_id: participant.user_id,
            message: `The tournament '${tournament.name}' has been cancelled by the creator. ${tournament.xp_entry_fee > 0 ? 'Your entry fee has been refunded.' : ''}`,
            type: 'system',
            status: 'unread',
            tournament_id: tournamentId,
            created_at: new Date().toISOString()
          }]);
      }

      // Record revenue reversal if platform fee was collected
      if (tournament.platform_fee > 0) {
        await db.supabaseAdmin
          .from('revenue')
          .insert([{
            tournament_id: tournamentId,
            amount: -tournament.platform_fee,
            revenue_date: new Date().toISOString(),
            notes: `Refunded platform fee from cancelled tournament: ${tournament.name}`
          }]);
      }

      console.log(`✅ Tournament ${tournamentId} cancelled successfully. Refunded ${participants.length} participants.`);

      res.json({
        success: true,
        message: 'Tournament cancelled successfully',
        refunds: {
          participants: participants.length,
          total_amount: tournament.xp_entry_fee * participants.length,
          entry_fee: tournament.xp_entry_fee
        }
      });
      
    } else {
      // POSTGRESQL VERSION - keep your original code
      await withTransaction(async (client) => {
        // Get tournament with participants
        const tournamentResult = await client.query(`
          SELECT t.*, 
                 COUNT(tp.id) as participants_count
          FROM tournaments t
          LEFT JOIN tournament_participants tp ON t.id = tp.tournament_id 
            AND tp.status = 'joined'
          WHERE t.id = $1
          GROUP BY t.id
        `, [tournamentId]);

        if (tournamentResult[0].length === 0) {
          throw new Error('Tournament not found');
        }

        const tournament = tournamentResult[0][0];

        // Check permissions
        if (tournament.creator_id !== userId) {
          throw new Error('Only tournament creator can cancel tournament');
        }

        if (tournament.status === 'completed' || tournament.status === 'cancelled') {
          throw new Error(`Tournament is already ${tournament.status}`);
        }

        // Get all participants to refund
        const participantsResult = await client.query(`
          SELECT tp.user_id, u.username, u.email
          FROM tournament_participants tp
          JOIN users u ON tp.user_id = u.id
          WHERE tp.tournament_id = $1 AND tp.status = 'joined'
        `, [tournamentId]);

        // Update tournament status
        await client.query(
          `UPDATE tournaments SET status = 'cancelled', completed_at = NOW() WHERE id = $1`,
          [tournamentId]
        );

        // Refund entry fees to all participants
        if (tournament.entry_fee > 0) {
          for (const participant of participantsResult[0]) {
            await client.query(`
              UPDATE users 
              SET balance = balance + $1
              WHERE id = $2
            `, [tournament.entry_fee, participant.user_id]);

            // Record refund transaction
            const reference = `TOURNAMENT-CANCEL-${Date.now()}-${tournamentId}`;
            await client.query(`
              INSERT INTO transactions 
              (user_id, amount, currency, type, status, reference, description, created_at)
              VALUES ($1, $2, 'NGN', 'refund', 'completed', $3, $4, NOW())
            `, [
              participant.user_id,
              tournament.entry_fee,
              reference,
              `Refund for cancelled tournament: ${tournament.name}`
            ]);
          }
        }

        // Send notifications to all participants
        for (const participant of participantsResult[0]) {
          await client.query(`
            INSERT INTO notifications 
            (user_id, message, type, status, tournament_id, created_at)
            VALUES ($1, $2, 'system', 'unread', $3, NOW())
          `, [
            participant.user_id,
            `The tournament '${tournament.name}' has been cancelled by the creator. ${tournament.entry_fee > 0 ? 'Your entry fee has been refunded.' : ''}`,
            tournamentId
          ]);
        }

        // Record revenue reversal if platform fee was collected
        if (tournament.platform_fee > 0) {
          await client.query(`
            INSERT INTO revenue 
            (tournament_id, amount, revenue_date, notes)
            VALUES ($1, $2, NOW(), $3)
          `, [
            tournamentId,
            -tournament.platform_fee,
            `Refunded platform fee from cancelled tournament: ${tournament.name}`
          ]);
        }

        console.log(`✅ Tournament ${tournamentId} cancelled successfully. Refunded ${participantsResult[0].length} participants.`);
      });

      res.json({
        success: true,
        message: 'Tournament cancelled successfully',
        refunds: {
          participants: participantsResult[0].length,
          total_amount: tournament.entry_fee * participantsResult[0].length,
          entry_fee: tournament.entry_fee
        }
      });
    }
  } catch (error) {
    console.error('❌ Cancel tournament error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to cancel tournament: ' + error.message
    });
  }
});

// GET /api/tournaments/games - Get games list
router.get('/games', async (req, res) => {
  try {
    console.log('🎮 Fetching games list');

    if (db.isSupabase) {
      // SUPABASE VERSION
      const { data: games, error } = await db.supabaseAdmin
        .from('games')
        .select('id, name, category, is_active, min_players, max_players, platforms, description, icon_url')
        .eq('is_active', true)
        .order('name', { ascending: true });

      if (error) throw error;
      
      const gamesList = games || [];
      console.log(`✅ Found ${gamesList.length} active games`);

      res.json({
        success: true,
        games: gamesList.map(game => game.name),
        games_data: gamesList,
        total: gamesList.length
      });
      
    } else {
      // POSTGRESQL VERSION - keep your original code
      const result = await db.query(`
        SELECT id, name, category, is_active, min_players, max_players, platforms, description, icon_url
        FROM games 
        WHERE is_active = true
        ORDER BY name ASC
      `);
      
      const games = result[0] || [];
      
      console.log(`✅ Found ${games.length} active games`);
      
      res.json({
        success: true,
        games: games.map(game => game.name),
        games_data: games,
        total: games.length
      });
    }
  } catch (error) {
    console.error('❌ Get games error:', error);
    // Return default games on error
    res.json({
      success: true,
      games: [
        'Call of Duty: Warzone',
        'Call of Duty: Mobile',
        'PUBG Mobile',
        'Free Fire',
        'Fortnite',
        'VALORANT',
        'Dota 2',
        'EA Sports FC 24',
        'Other'
      ],
      error: error.message,
      default: true
    });
  }
});

// ============================
// HELPER FUNCTIONS (SUPABASE VERSIONS)
// ============================

async function getTournamentParticipantsSupabase(tournamentId) {
  const { data: participants, error } = await db.supabaseAdmin
    .from('tournament_participants')
    .select(`
      user_id,
      users!inner (
        id,
        username,
        rank,
        wins,
        losses
      )
    `)
    .eq('tournament_id', tournamentId)
    .eq('status', 'joined')
    .order('users.wins', { ascending: false })
    .order('users.rank', { ascending: false });

  if (error) throw error;
  
  return (participants || []).map(p => ({
    user_id: p.user_id,
    username: p.users?.username,
    rank: p.users?.rank,
    wins: p.users?.wins || 0,
    losses: p.users?.losses || 0
  }));
}

function generate1v1BracketSupabase(participants, tournamentId, startDate) {
  const matches = [];
  
  if (!participants || participants.length === 0) {
    console.warn('⚠️ No participants for bracket generation');
    return matches;
  }
  
  console.log('🎮 Generating 1v1 bracket for', participants.length, 'participants');
  
  // Random shuffle for seeding
  const shuffled = [...participants].sort(() => Math.random() - 0.5);
  
  const participantCount = shuffled.length;
  
  // Determine number of rounds needed
  let roundsNeeded = Math.ceil(Math.log2(participantCount));
  if (participantCount <= 2) roundsNeeded = 1;
  
  console.log('📊 Bracket calculation:', {
    participants: participantCount,
    roundsNeeded: roundsNeeded,
    powerOfTwo: Math.pow(2, roundsNeeded)
  });
  
  // Create first round matches
  let round = 1;
  let currentParticipants = [...shuffled];
  
  // If we have more than 2 players, we need multiple rounds
  if (participantCount > 2) {
    // First round
    const firstRoundMatches = Math.min(currentParticipants.length, Math.pow(2, roundsNeeded - 1));
    
    console.log(`Creating ${firstRoundMatches} matches for round ${round}`);
    
    for (let i = 0; i < firstRoundMatches; i++) {
      const player1 = currentParticipants[i * 2] || null;
      const player2 = currentParticipants[i * 2 + 1] || null;
      
      // Calculate match time (stagger matches)
      const matchTime = new Date(startDate);
      matchTime.setMinutes(matchTime.getMinutes() + (i * 15));
      
      matches.push({
        tournament_id: tournamentId,
        player1_id: player1?.user_id || null,
        player2_id: player2?.user_id || null,
        round_number: round,
        match_time: matchTime.toISOString(),
        status: 'upcoming',
        created_at: new Date().toISOString()
      });
      
      console.log(`Round ${round} Match ${i + 1}:`, {
        player1: player1?.username || 'BYE',
        player2: player2?.username || 'BYE'
      });
    }
    
    round++;
    currentParticipants = []; // Winners will fill these in next rounds
  }
  
  // Create placeholder matches for subsequent rounds
  let matchesInCurrentRound = Math.ceil(matches.length / 2);
  
  while (round <= roundsNeeded) {
    console.log(`Creating ${matchesInCurrentRound} placeholder matches for round ${round}`);
    
    for (let i = 0; i < matchesInCurrentRound; i++) {
      const matchTime = new Date(startDate);
      matchTime.setHours(matchTime.getHours() + (round - 1)); // Next day for later rounds
      
      matches.push({
        tournament_id: tournamentId,
        player1_id: null, // Will be filled by winners
        player2_id: null,
        round_number: round,
        match_time: matchTime.toISOString(),
        status: 'upcoming',
        created_at: new Date().toISOString()
      });
      
      console.log(`Round ${round} placeholder created`);
    }
    
    matchesInCurrentRound = Math.ceil(matchesInCurrentRound / 2);
    round++;
  }
  
  console.log('✅ Total matches generated:', matches.length);
  
  return matches;
}

async function advanceWinnerToNextRoundSupabase(tournamentId, matchId, winnerId, currentRound) {
  console.log('🎯 ADVANCE FUNCTION CALLED (Supabase):', { tournamentId, matchId, winnerId, currentRound });
  
  try {
    const nextRound = currentRound + 1;
    
    // Find matches in the next round
    const { data: nextMatches, error: nextError } = await db.supabaseAdmin
      .from('tournament_matches')
      .select('id, player1_id, player2_id, status')
      .eq('tournament_id', tournamentId)
      .eq('round_number', nextRound)
      .order('id', { ascending: true });

    if (nextError) throw nextError;

    console.log(`Found ${nextMatches?.length || 0} matches in round ${nextRound}`);

    if (!nextMatches || nextMatches.length === 0) {
      console.log('No next round matches found - tournament might be complete');
      return null;
    }

    // Get all matches in current round
    const { data: currentMatches, error: currentError } = await db.supabaseAdmin
      .from('tournament_matches')
      .select('id')
      .eq('tournament_id', tournamentId)
      .eq('round_number', currentRound)
      .order('id', { ascending: true });

    if (currentError) throw currentError;

    console.log(`Current round ${currentRound} has ${currentMatches?.length || 0} matches`);

    // Find position of current match in its round
    const matchIndex = (currentMatches || []).findIndex(m => m.id === parseInt(matchId));
    
    if (matchIndex === -1) {
      console.log(`ERROR: Match ${matchId} not found in round ${currentRound}`);
      console.log('Available matches:', currentMatches?.map(m => m.id));
      return null;
    }

    // Calculate which next match this winner should go to
    const nextMatchIndex = Math.floor(matchIndex / 2);
    
    if (nextMatchIndex >= (nextMatches || []).length) {
      console.log(`ERROR: No next match at index ${nextMatchIndex} (only ${nextMatches?.length} next matches)`);
      return null;
    }

    const targetMatch = nextMatches[nextMatchIndex];
    const targetMatchId = targetMatch.id;
    
    // Determine which slot to fill (player1 for even index, player2 for odd)
    const targetSlot = matchIndex % 2 === 0 ? 'player1' : 'player2';
    
    console.log(`Bracket position: matchIndex=${matchIndex}, nextMatchIndex=${nextMatchIndex}, targetSlot=${targetSlot}`);

    // Check if winner is already in next round
    const { data: alreadyInNext, error: alreadyError } = await db.supabaseAdmin
      .from('tournament_matches')
      .select('id')
      .eq('tournament_id', tournamentId)
      .eq('round_number', nextRound)
      .or(`player1_id.eq.${winnerId},player2_id.eq.${winnerId}`)
      .limit(1);

    if (alreadyError) throw alreadyError;

    if (alreadyInNext && alreadyInNext.length > 0) {
      console.log(`⚠️ Winner ${winnerId} is already in next round`);
      return null;
    }

    // Update the database
    const updateData = {};
    updateData[targetSlot] = winnerId;
    
    const { error: updateError } = await db.supabaseAdmin
      .from('tournament_matches')
      .update(updateData)
      .eq('id', targetMatchId);

    if (updateError) throw updateError;
    
    console.log(`✅ Updated match ${targetMatchId} ${targetSlot} = ${winnerId}`);
    
    // If both players are now set, schedule the match
    const { data: updatedMatch, error: updatedError } = await db.supabaseAdmin
      .from('tournament_matches')
      .select('player1_id, player2_id')
      .eq('id', targetMatchId)
      .single();

    if (updatedError) throw updatedError;
    
    if (updatedMatch.player1_id && updatedMatch.player2_id) {
      const matchTime = new Date(Date.now() + 15 * 60000); // 15 minutes from now
      await db.supabaseAdmin
        .from('tournament_matches')
        .update({ 
          match_time: matchTime.toISOString(), 
          status: 'upcoming' 
        })
        .eq('id', targetMatchId);
      console.log(`⏰ Match ${targetMatchId} scheduled for ${matchTime}`);
      
      // Get player names for notifications
      const { data: player1 } = await db.supabaseAdmin
        .from('users')
        .select('username')
        .eq('id', updatedMatch.player1_id)
        .single();
      
      const { data: player2 } = await db.supabaseAdmin
        .from('users')
        .select('username')
        .eq('id', updatedMatch.player2_id)
        .single();
      
      const player1Name = player1?.username || 'Opponent';
      const player2Name = player2?.username || 'Opponent';
      
      // Notify player 1
      await db.supabaseAdmin
        .from('notifications')
        .insert([{
          user_id: updatedMatch.player1_id,
          message: `Your next match in the tournament is ready! You'll be facing ${player2Name}. Match starts in 15 minutes.`,
          type: 'system',
          status: 'unread',
          tournament_id: tournamentId,
          created_at: new Date().toISOString()
        }]);
      
      // Notify player 2
      await db.supabaseAdmin
        .from('notifications')
        .insert([{
          user_id: updatedMatch.player2_id,
          message: `Your next match in the tournament is ready! You'll be facing ${player1Name}. Match starts in 15 minutes.`,
          type: 'system',
          status: 'unread',
          tournament_id: tournamentId,
          created_at: new Date().toISOString()
        }]);
    }

    console.log(`✅ Successfully advanced winner ${winnerId} to match ${targetMatchId}`);
    return targetMatchId;

  } catch (error) {
    console.error('❌ Advance winner error (Supabase):', error);
    throw error;
  }
}

async function manualBracketAdvancementSupabase(tournamentId, matchId, winnerId, currentRound) {
  console.log('🔧 MANUAL BRACKET ADVANCEMENT FALLBACK (Supabase):', { tournamentId, matchId, winnerId, currentRound });
  
  try {
    const nextRound = currentRound + 1;
    
    // Get all matches in current round
    const { data: currentMatches, error: currentError } = await db.supabaseAdmin
      .from('tournament_matches')
      .select('id, player1_id, player2_id')
      .eq('tournament_id', tournamentId)
      .eq('round_number', currentRound)
      .order('id', { ascending: true });

    if (currentError) throw currentError;
    
    console.log(`🔍 Current round ${currentRound} matches:`, currentMatches);
    
    // Find our match index
    const matchIndex = (currentMatches || []).findIndex(m => m.id === parseInt(matchId));
    console.log(`🔍 Match index: ${matchIndex}`);
    
    if (matchIndex === -1) {
      console.log('❌ Match not found in current round');
      return null;
    }
    
    // Get next round matches
    const { data: nextMatches, error: nextError } = await db.supabaseAdmin
      .from('tournament_matches')
      .select('id, player1_id, player2_id')
      .eq('tournament_id', tournamentId)
      .eq('round_number', nextRound)
      .order('id', { ascending: true });

    if (nextError) throw nextError;
    
    console.log(`🔍 Next round ${nextRound} matches:`, nextMatches);
    
    if (!nextMatches || nextMatches.length === 0) {
      console.log('⚠️ No next round matches - might be final');
      return null;
    }
    
    // Simple bracket logic: Each pair feeds into one next match
    const nextMatchIndex = Math.floor(matchIndex / 2);
    
    if (nextMatchIndex >= nextMatches.length) {
      console.log(`❌ Next match index ${nextMatchIndex} out of bounds`);
      return null;
    }
    
    const targetMatch = nextMatches[nextMatchIndex];
    const targetSlot = matchIndex % 2 === 0 ? 'player1' : 'player2';
    
    console.log(`🎯 Target: match ${targetMatch.id}, slot: ${targetSlot}`);
    
    // Update the target slot
    const updateData = {};
    updateData[targetSlot] = winnerId;
    
    const { error: updateError } = await db.supabaseAdmin
      .from('tournament_matches')
      .update(updateData)
      .eq('id', targetMatch.id);

    if (updateError) throw updateError;
    
    console.log(`✅ Updated ${targetSlot} of match ${targetMatch.id} with winner ${winnerId}`);
    
    // Check if match is now ready
    const { data: updatedMatch, error: updatedError } = await db.supabaseAdmin
      .from('tournament_matches')
      .select('player1_id, player2_id')
      .eq('id', targetMatch.id)
      .single();

    if (updatedError) throw updatedError;
    
    if (updatedMatch.player1_id && updatedMatch.player2_id) {
      const matchTime = new Date(Date.now() + 15 * 60000);
      await db.supabaseAdmin
        .from('tournament_matches')
        .update({ 
          status: 'upcoming', 
          match_time: matchTime.toISOString() 
        })
        .eq('id', targetMatch.id);
      console.log(`⏰ Match ${targetMatch.id} scheduled for ${matchTime}`);
    }
    
    return targetMatch.id;
    
  } catch (error) {
    console.error('❌ Manual bracket advancement error (Supabase):', error);
    throw error;
  }
}

async function updateUserRankSupabase(userId) {
  try {
    console.log(`📊 Updating rank for user ${userId}`);
    
    const { data: user, error: userError } = await db.supabaseAdmin
      .from('users')
      .select('wins, losses, matches_played, win_rate, rank')
      .eq('id', userId)
      .single();

    if (userError || !user) return;

    // SIMPLE RANK LOGIC
    let newRank = user.rank;
    
    if (user.wins >= 50 && user.win_rate >= 80) {
      newRank = 'SSS';
    } else if (user.wins >= 30 && user.win_rate >= 70) {
      newRank = 'SS';
    } else if (user.wins >= 20 && user.win_rate >= 65) {
      newRank = 'S';
    } else if (user.wins >= 15 && user.win_rate >= 60) {
      newRank = 'A';
    } else if (user.wins >= 10 && user.win_rate >= 55) {
      newRank = 'B';
    } else if (user.wins >= 5 && user.win_rate >= 50) {
      newRank = 'C';
    } else if (user.wins >= 3 && user.win_rate >= 45) {
      newRank = 'D';
    }
    // 'E' is default

    // Only update if rank changed
    if (newRank !== user.rank) {
      const { error: updateError } = await db.supabaseAdmin
        .from('users')
        .update({ rank: newRank })
        .eq('id', userId);
      
      if (!updateError) {
        console.log(`✅ User ${userId} rank updated: ${user.rank} -> ${newRank}`);
      }
    }

  } catch (error) {
    console.error('Update user rank error:', error);
  }
}

async function checkTournamentCompletionSupabase(tournamentId, forceComplete = false) {
  try {
    console.log(`🔍 Checking tournament ${tournamentId} completion...`);
    
    // Get tournament details
    const { data: tournament, error: tournamentError } = await db.supabaseAdmin
      .from('tournaments')
      .select(`
        *,
        tournament_participants!left (
          user_id,
          status
        )
      `)
      .eq('id', tournamentId)
      .single();

    if (tournamentError || !tournament) {
      console.log(`❌ Tournament ${tournamentId} not found`);
      return false;
    }

    // Calculate participant count
    const participantCount = (tournament.tournament_participants || [])
      .filter(p => p.status === 'joined').length;
    
    console.log(`📊 Tournament current status: ${tournament.status}, type: ${tournament.type}`);
    
    // If already completed, return true
    if (tournament.status === 'completed') {
      console.log(`✅ Tournament ${tournamentId} already completed`);
      return true;
    }

    // For different tournament types, check completion differently
    let isComplete = false;
    
    if (tournament.type === 'survival' || tournament.type === 'freeforall') {
      console.log(`🎯 ${tournament.type} tournament - needs manual completion`);
      return false;
    }
    else if (tournament.type === '1v1') {
      // Check bracket matches
      const { data: matches, error: matchesError } = await db.supabaseAdmin
        .from('tournament_matches')
        .select('status')
        .eq('tournament_id', tournamentId);

      if (matchesError) throw matchesError;

      const total = matches?.length || 0;
      const completed = (matches || []).filter(m => m.status === 'completed').length;

      console.log(`📈 1v1 Match stats: ${completed}/${total} completed`);
      
      isComplete = total > 0 && completed === total;
    }
    else {
      // Default: Check if any matches exist and all are completed
      const { data: matches, error: matchesError } = await db.supabaseAdmin
        .from('tournament_matches')
        .select('status')
        .eq('tournament_id', tournamentId);

      if (matchesError) throw matchesError;

      const total = matches?.length || 0;
      const completed = (matches || []).filter(m => m.status === 'completed').length;

      console.log(`📈 Match stats: ${completed}/${total} completed`);
      
      isComplete = total === 0 || (total > 0 && completed === total);
    }

    if (isComplete || forceComplete) {
      console.log(`✅ Tournament ${tournamentId} is ready for completion`);
      
      // Find winner for bracket tournaments
      let winnerId = tournament.winner_id;
      
      if (!winnerId && tournament.type === '1v1') {
        // Find final match winner
        const { data: finalMatch, error: finalError } = await db.supabaseAdmin
          .from('tournament_matches')
          .select('winner_id')
          .eq('tournament_id', tournamentId)
          .eq('status', 'completed')
          .order('round_number', { ascending: false })
          .order('id', { ascending: false })
          .limit(1)
          .single();

        if (!finalError && finalMatch?.winner_id) {
          winnerId = finalMatch.winner_id;
          console.log(`🏆 Found bracket winner: ${winnerId}`);
        }
      }

      if (winnerId || tournament.type === 'survival' || forceComplete) {
        // Actually complete the tournament
        await completeTournamentWithWinnerSupabase(tournamentId, winnerId, tournament);
        return true;
      } else {
        console.log(`❌ No winner found for tournament ${tournamentId}`);
        return false;
      }
    }

    console.log(`⏳ Tournament ${tournamentId} not ready for completion yet`);
    return false;

  } catch (error) {
    console.error('❌ Check tournament completion error:', error);
    return false;
  }
}

async function completeTournamentWithWinnerSupabase(tournamentId, winnerId, tournament) {
  try {
    console.log(`🏆 Completing tournament ${tournamentId} with winner ${winnerId || 'N/A'}`);
    
    // 1. Update tournament status
    const updateData = {
      status: 'completed',
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    
    if (winnerId) {
      updateData.winner_id = winnerId;
    }
    
    const { error: updateError } = await db.supabaseAdmin
      .from('tournaments')
      .update(updateData)
      .eq('id', tournamentId);

    if (updateError) throw updateError;

    console.log(`✅ Tournament ${tournamentId} marked as completed`);

    // 2. Distribute prize pool if exists
    const prizePool = parseFloat(tournament.prize_pool) || 0;
    if (prizePool > 0 && winnerId) {
      console.log(`💰 Distributing prize pool: ${prizePool} XP`);
      
      await db.supabaseAdmin.rpc('add_xp_to_user', {
        user_id: winnerId,
        xp_amount: prizePool
      });

      await db.supabaseAdmin
        .from('xp_transactions')
        .insert([{
          user_id: winnerId,
          tournament_id: tournamentId,
          amount: prizePool,
          type: 'earned',
          description: `🏆 Tournament prize: ${tournament.name}`,
          created_at: new Date().toISOString()
        }]);
    }

    // 3. Update user tournament win count
    if (winnerId) {
      await db.supabaseAdmin.rpc('increment_user_tournaments_won', {
        user_id: winnerId
      });
    }

    // 4. For survival tournaments, award titles
    if (tournament.type === 'survival' && winnerId) {
      console.log(`🎖️ Awarding survival titles for tournament ${tournamentId}`);
      
      // Get the other winners from tournament columns
      const { data: tournamentDetails } = await db.supabaseAdmin
        .from('tournaments')
        .select('title_boundless_winner, title_chaos_winner, title_order_winner')
        .eq('id', tournamentId)
        .single();
      
      if (tournamentDetails) {
        const t = tournamentDetails;
        if (t.title_boundless_winner || t.title_chaos_winner || t.title_order_winner) {
          await awardSurvivalTitlesSupabase(
            tournamentId, 
            winnerId, 
            t.title_order_winner, 
            t.title_chaos_winner, 
            tournament
          );
        }
      }
    }

    // 5. Send notifications
    await notifyTournamentCompletionSupabase(tournamentId, tournament.name, winnerId, null, null);

    console.log(`✅ Tournament ${tournamentId} completed successfully!`);

  } catch (error) {
    console.error('❌ Complete tournament with winner error:', error);
    throw error;
  }
}

async function notifyTournamentCompletionSupabase(tournamentId, tournamentName, winnerId, runnerUpId, thirdPlaceId) {
  try {
    // Get winner username
    const { data: winnerData } = await db.supabaseAdmin
      .from('users')
      .select('username')
      .eq('id', winnerId)
      .single();
    
    const winnerName = winnerData?.username || 'Unknown';

    // Get all participants
    const { data: participants, error: participantsError } = await db.supabaseAdmin
      .from('tournament_participants')
      .select('user_id')
      .eq('tournament_id', tournamentId)
      .eq('status', 'joined');

    if (participantsError) throw participantsError;

    // Send notification to all participants
    for (const participant of participants || []) {
      let message;
      
      if (participant.user_id === parseInt(winnerId)) {
        message = `🏆 Congratulations! You won the tournament '${tournamentName}'!`;
      } else if (runnerUpId && participant.user_id === parseInt(runnerUpId)) {
        message = `🥈 You placed 2nd in tournament '${tournamentName}'!`;
      } else if (thirdPlaceId && participant.user_id === parseInt(thirdPlaceId)) {
        message = `🥉 You placed 3rd in tournament '${tournamentName}'!`;
      } else {
        message = `🏁 Tournament '${tournamentName}' has been completed. Winner: ${winnerName}`;
      }
      
      await db.supabaseAdmin
        .from('notifications')
        .insert([{
          user_id: participant.user_id,
          message: message,
          type: 'system',
          status: 'unread',
          tournament_id: tournamentId,
          created_at: new Date().toISOString()
        }]);
    }

  } catch (error) {
    console.error('Notify tournament completion error:', error);
  }
}

async function awardSurvivalTitlesSupabase(tournamentId, boundlessWinnerId, orderWinnerId, chaosWinnerId, tournament) {
  try {
    console.log(`🏆 Awarding survival titles for tournament ${tournamentId}`);
    
    // First, ensure default titles exist (we'll check titles table)
    const titleAwards = [
      {
        userId: boundlessWinnerId,
        titleName: 'Boundless Explorer',
        position: '1st'
      },
      {
        userId: orderWinnerId,
        titleName: 'Grand Master of Order',
        position: '2nd'
      },
      {
        userId: chaosWinnerId,
        titleName: 'Master of Chaos',
        position: '3rd'
      }
    ];

    for (const award of titleAwards) {
      if (award.userId) {
        try {
          // Get the title ID
          const { data: titleData, error: titleError } = await db.supabaseAdmin
            .from('titles')
            .select('id')
            .eq('name', award.titleName)
            .maybeSingle();

          if (titleError || !titleData) {
            console.log(`ℹ️ Title "${award.titleName}" not found, creating it...`);
            
            // Create the title
            const tierMap = {
              '1st': 'sacred',
              '2nd': 'disputable',
              '3rd': 'class'
            };
            
            const { data: newTitle, error: createError } = await db.supabaseAdmin
              .from('titles')
              .insert([{
                name: award.titleName,
                tier: tierMap[award.position] || 'class',
                description: `Awarded for placing ${award.position} in a Survival tournament`,
                color: award.position === '1st' ? '#FFD700' : award.position === '2nd' ? '#C0C0C0' : '#CD7F32',
                icon: award.position === '1st' ? 'fas fa-crown' : award.position === '2nd' ? 'fas fa-medal' : 'fas fa-award',
                requirements: ''
              }])
              .select();

            if (createError) throw createError;
            titleData = newTitle[0];
          }
          
          const titleId = titleData.id;
          
          // Check if user already has this title
          const { count: existingCount, error: existingError } = await db.supabaseAdmin
            .from('user_titles')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', award.userId)
            .eq('title_id', titleId);

          if (existingError) throw existingError;

          if (existingCount > 0) {
            console.log(`ℹ️ User ${award.userId} already has title "${award.titleName}"`);
            continue;
          }
          
          // Award the title
          const { error: awardError } = await db.supabaseAdmin
            .from('user_titles')
            .insert([{
              user_id: award.userId,
              title_id: titleId,
              tournament_id: tournamentId,
              achievement_data: {
                position: award.position,
                tournament_name: tournament.name,
                tournament_type: 'survival',
                awarded_for: 'survival_tournament_victory',
                awarded_at: new Date().toISOString()
              },
              earned_at: new Date().toISOString(),
              is_equipped: false
            }]);

          if (awardError) throw awardError;
          
          console.log(`✅ Awarded "${award.titleName}" to user ${award.userId} (${award.position} place)`);
          
          // Get username for notification
          const { data: userData } = await db.supabaseAdmin
            .from('users')
            .select('username')
            .eq('id', award.userId)
            .single();
          
          const username = userData?.username || 'Player';
          
          // Send notification
          await db.supabaseAdmin
            .from('notifications')
            .insert([{
              user_id: award.userId,
              message: `🎖️ Congratulations! You earned the "${award.titleName}" title by placing ${award.position} in the Survival tournament "${tournament.name}"!`,
              type: 'system',
              status: 'unread',
              tournament_id: tournamentId,
              created_at: new Date().toISOString()
            }]);
          
        } catch (error) {
          console.error(`❌ Error awarding title for ${award.position} place to user ${award.userId}:`, error.message);
          // Continue with other titles
        }
      }
    }
    
    console.log(`✅ Survival titles awarded successfully for tournament ${tournamentId}`);
    
  } catch (error) {
    console.error('❌ Award survival titles error:', error);
  }
}

// ============================
// REMAINING ROUTES (ROOT ROUTES LAST)
// ============================

// GET /api/tournaments - Get all tournaments (ROOT ROUTES LAST)
router.get('/', async (req, res) => {
  try {
    if (db.isSupabase) {
      // SUPABASE VERSION
      const { data: tournaments, error } = await db.supabaseAdmin
        .from('tournaments')
        .select(`
          *,
          users!creator_id (
            username
          ),
          tournament_participants!left (
            user_id,
            group_id,
            status
          )
        `)
        .neq('status', 'cancelled')
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Process tournaments to add counts
      const processedTournaments = (tournaments || []).map(t => {
        const participants = t.tournament_participants || [];
        const joinedParticipants = participants.filter(p => p.status === 'joined');
        
        const current_players = joinedParticipants.length;
        const current_squads = t.type === 'squad' 
          ? new Set(joinedParticipants.filter(p => p.group_id).map(p => p.group_id)).size
          : 0;
        
        return {
          ...t,
          creator_name: t.users?.username,
          current_players,
          current_squads,
          tournament_participants: undefined
        };
      });

      res.json({
        success: true,
        tournaments: processedTournaments || []
      });
      
    } else {
      // POSTGRESQL VERSION - keep your original code
      const result = await db.query(`
        SELECT t.*, u.username as creator_name,
         COUNT(DISTINCT CASE WHEN t.type = 'squad' THEN NULL ELSE tp.user_id END) as current_players,
         COUNT(DISTINCT CASE WHEN t.type = 'squad' THEN tp.group_id ELSE NULL END) as current_squads
        FROM tournaments t
        LEFT JOIN users u ON t.creator_id = u.id
        LEFT JOIN tournament_participants tp ON t.id = tp.tournament_id 
          AND tp.status = 'joined'
        WHERE t.status != 'cancelled'
        GROUP BY t.id, u.username
        ORDER BY t.created_at DESC
      `);

      res.json({
        success: true,
        tournaments: result[0] || []
      });
    }
  } catch (error) {
    console.error('Error fetching tournaments:', error);
    res.status(500).json({ success: false, error: 'Server error fetching tournaments' });
  }
});

module.exports = router;
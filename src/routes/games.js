const express = require('express');
const router = express.Router();
const db = require('../config/database');

// GET /api/games - Allow unauthenticated access for group creation
router.get('/', async (req, res) => {
  try {
    console.log('[GET /games] Fetching games list');
    
    let games = [];
    
    if (db.isSupabase) {
      // USE ADMIN CLIENT TO BYPASS RLS
      const { data, error } = await db.supabaseAdmin  // ← CHANGED HERE
        .from('games')
        .select('id, name, category, is_active, min_players, max_players, platforms, description, icon_url')
        .eq('is_active', true)
        .order('name');
      
      if (error) {
        console.error('❌ Supabase games error:', error);
        throw error;
      }
      
      games = data || [];
    } else {
      const result = await db.query(`
        SELECT id, name, category, is_active, min_players, max_players, platforms, description, icon_url
        FROM games 
        WHERE is_active = true
        ORDER BY name ASC
      `);
      
      games = result[0] || [];
    }
    
    // Return both array of names and full game objects
    const gameNames = games.map(game => game.name);
    
    console.log(`✅ Found ${games.length} games`);
    
    res.json({
      success: true,
      games: gameNames,
      games_data: games,
      total: games.length
    });
    
  } catch (error) {
    console.error('❌ Get games error:', error);
    
    // FALLBACK: Check if there are ANY games in the table (using admin client)
    if (db.isSupabase && db.supabaseAdmin) {
      try {
        const { data, error } = await db.supabaseAdmin
          .from('games')
          .select('name')
          .limit(5);
        
        console.log('Fallback query result:', data);
        console.log('Fallback query error:', error);
      } catch (e) {
        console.error('Fallback also failed:', e);
      }
    }
    
    // Return default games without requiring auth
    const defaultGames = [
      'Call of Duty: Warzone',
      'Call of Duty: Mobile',
      'PUBG Mobile',
      'Free Fire',
      'Fortnite',
      'VALORANT',
      'Dota 2',
      'EA Sports FC 24',
      'Other'
    ];
    
    res.json({
      success: true,
      games: defaultGames,
      games_data: defaultGames.map((name, index) => ({ id: index + 1, name })),
      total: defaultGames.length,
      error: error.message,
      default: true
    });
  }
});

// Optional: Add authenticated version with more features
router.get('/auth', async (req, res) => {
  try {
    // Your existing authenticated logic here
    res.json({ success: true, message: 'Authenticated games endpoint' });
  } catch (error) {
    console.error('Auth games error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
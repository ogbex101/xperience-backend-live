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

// Popular groups - returns empty array for testing
router.get('/popular', (req, res) => {
  console.log('🔥 POPULAR GROUPS: Route hit');
  console.log('   Query params:', req.query);
  console.log('   Headers:', req.headers['user-agent']);
  
  res.json({ 
    success: true, 
    groups: [],
    message: 'Popular endpoint working (test mode)'
  });
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

// My groups (mock data)
router.get('/my-groups', (req, res) => {
  console.log('👥 MY GROUPS: Route hit');
  console.log('   User from auth:', req.user ? 'Present' : 'Not present');
  
  res.json({ 
    success: true, 
    groups: [],
    message: 'My groups endpoint working (test mode)'
  });
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
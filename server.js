// server.js - COMPLETE UPDATED VERSION WITH FIXED CORS
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const dotenv = require('dotenv');
const path = require('path');

// ============ ENVIRONMENT VARIABLES ============
// In production (Railway), env vars are injected directly
// In development, load from .env file
if (process.env.NODE_ENV !== 'production') {
  // We're in development - load from .env file
  const envPath = path.resolve(process.cwd(), '.env');
  console.log(`📝 Loading environment from: ${envPath}`);
  require('dotenv').config({ path: envPath });
} else {
  console.log('🚀 Running in production mode - using Railway environment variables');
}

// Debug: Check if Supabase variables are loaded
console.log('\n🔍 Environment Configuration Check:');
console.log('=====================================');
console.log(`NODE_ENV: ${process.env.NODE_ENV || 'development'}`);
console.log(`SUPABASE_URL: ${process.env.SUPABASE_URL ? '✅ Present' : '❌ MISSING'}`);
console.log(`SUPABASE_ANON_KEY: ${process.env.SUPABASE_ANON_KEY ? '✅ Present' : '❌ MISSING'}`);
console.log(`SUPABASE_SERVICE_ROLE_KEY: ${process.env.SUPABASE_SERVICE_ROLE_KEY ? '✅ Present' : '❌ MISSING'}`);
console.log('=====================================\n');

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
  console.error('❌ CRITICAL ERROR: Supabase credentials missing!');
  console.error('   Please check your environment variables in Railway dashboard');
  if (process.env.NODE_ENV === 'production') {
    // Don't exit in production - let the app try to recover
    console.warn('⚠️ Continuing despite missing credentials - this may cause errors!');
  }
}

// Import database with Supabase support
const db = require('./src/config/database');
const { supabase, supabaseAdmin, isSupabase, testSupabaseConnection } = db;

// Import routes
const authRoutes = require('./src/routes/auth');
const userRoutes = require('./src/routes/users');
const tournamentRoutes = require('./src/routes/tournaments');
const matchRoutes = require('./src/routes/matches');
const friendsRoutes = require('./src/routes/friends');
const groupsRoutes = require('./src/routes/groups');
const chatRoutes = require('./src/routes/chat');
const adminRoutes = require('./src/routes/admin');
const leaderboardRoutes = require('./src/routes/leaderboard');
const walletRoutes = require('./src/routes/wallet');
const gamesRoutes = require('./src/routes/games');
const notificationsRouter = require('./src/routes/notifications');
const suggestedPlayersRoutes = require('./src/routes/suggestedPlayers');

// Import middleware
const { authenticateToken } = require('./src/middleware/auth');

// Import socket handler
const { initializeSocket } = require('./src/services/socketService');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    methods: ["GET", "POST"],
    credentials: true
  }
});

// ============ MIDDLEWARE ============

// Define allowed origins for CORS
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:3000',
  'http://localhost:5000',
  'https://xperience-frontend-live-49xr.vercel.app',
  process.env.CLIENT_URL,
  process.env.PRODUCTION_FRONTEND_URL
].filter(Boolean); // Remove any undefined values

console.log('✅ Allowed CORS origins:', allowedOrigins);

// Handle OPTIONS (preflight) requests FIRST
app.options('*', (req, res) => {
  const origin = req.headers.origin;
  
  // Check if the origin is allowed
  if (allowedOrigins.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
  } else if (process.env.CLIENT_URL) {
    // Fallback to CLIENT_URL env var
    res.header('Access-Control-Allow-Origin', process.env.CLIENT_URL);
  } else {
    // Default fallback
    res.header('Access-Control-Allow-Origin', 'http://localhost:5173');
  }
  
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.sendStatus(200);
});

// CORS middleware
app.use(cors({
  origin: function(origin, callback) {
    // Allow requests with no origin (like mobile apps or curl)
    if (!origin) return callback(null, true);
    
    // Check if origin is allowed
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      console.log('❌ Blocked by CORS - Origin:', origin);
      console.log('✅ Allowed origins:', allowedOrigins);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Debug middleware
app.use((req, res, next) => {
  console.log(`🌐 ${req.method} ${req.url}`);
  console.log(`   Origin: ${req.headers.origin || 'No origin'}`);
  if (isSupabase) {
    console.log(`📊 Using Supabase (${process.env.NODE_ENV} mode)`);
  }
  next();
});

// Static files
app.use('/uploads', express.static('uploads'));

// ============ DATABASE CONNECTION CHECK ============
(async () => {
  try {
    await db.testConnection();
    if (isSupabase) {
      console.log('🚀 Using Supabase for database operations');
      console.log('📡 Real-time features available for chat');
      
      // Optional: Log Supabase project info
      console.log(`🔗 Supabase Project: ${process.env.SUPABASE_URL.split('//')[1].split('.')[0]}`);
    } else {
      console.log('💾 Using local PostgreSQL for database operations');
    }
  } catch (error) {
    console.error('❌ Database connection failed:', error);
    if (process.env.NODE_ENV === 'production') {
      console.error('⚠️ Production environment detected but Supabase connection failed!');
      process.exit(1); // Exit in production if DB fails
    }
  }
})();

// ============ ROUTES REGISTRATION ============

// 1. Public routes
app.use('/api/auth', authRoutes);
app.use('/api/leaderboard', leaderboardRoutes);

// 2. Health check with Supabase status
app.get('/api/health', async (req, res) => {
  let dbStatus = 'connected';
  let dbType = isSupabase ? 'Supabase' : 'PostgreSQL';
  
  try {
    if (isSupabase) {
      // Quick Supabase health check
      const { error } = await supabase
        .from('users')
        .select('count', { count: 'exact', head: true })
        .limit(1);
      
      if (error) dbStatus = 'degraded';
    }
  } catch (error) {
    dbStatus = 'error';
  }
  
  res.json({ 
    status: 'OK', 
    message: 'XP Gaming Platform API is running',
    database: {
      type: dbType,
      status: dbStatus,
      environment: process.env.NODE_ENV || 'development'
    },
    realtime: isSupabase ? 'available' : 'socket.io only',
    timestamp: new Date().toISOString()
  });
});

// 3. Admin routes
app.use('/api/admin', adminRoutes);

// 4. Games routes
app.use('/api/games', gamesRoutes);

// ============ AUTHENTICATED ROUTES ============

// 5. Groups routes with selective authentication
app.use('/api/groups', (req, res, next) => {
  const publicRoutes = ['/popular', '/discover'];
  const isPublicRoute = publicRoutes.some(route => req.path.includes(route));
  
  if (isPublicRoute) {
    console.log(`✅ Skipping auth for public route: ${req.path}`);
    return next();
  }
  
  authenticateToken(req, res, next);
}, groupsRoutes);

// 6. MATCHES ROUTES
console.log('🔧 Registering matches routes...');
app.use('/api/matches', authenticateToken, matchRoutes);
console.log('✅ Matches routes registered at /api/matches');

// 7. Other authenticated routes
app.use('/api/users', authenticateToken, userRoutes);
app.use('/api/tournaments', authenticateToken, tournamentRoutes);
app.use('/api/friends', authenticateToken, friendsRoutes);
app.use('/api/chat', authenticateToken, chatRoutes);
app.use('/api/suggested-players', authenticateToken, suggestedPlayersRoutes);
app.use('/api/wallet', authenticateToken, walletRoutes);
app.use('/api/notifications', authenticateToken, notificationsRouter);

// ============ SOCKET.IO + SUPABASE REAL-TIME ============

// Store active Supabase real-time subscriptions
const activeSubscriptions = new Map();

// Enhanced socket initialization with Supabase real-time
initializeSocket(io, { supabase, isSupabase, activeSubscriptions });

io.on('connection', (socket) => {
  console.log('🔵 Socket.io: User connected:', {
    userId: socket.userId,
    username: socket.username,
    socketId: socket.id
  });
  
  // Handle joining chat rooms with Supabase real-time
  socket.on('join-chat-room', async (roomId) => {
    socket.join(`chat-${roomId}`);
    
    if (isSupabase) {
      // Create Supabase real-time subscription for this room
      const subscription = db.createRealtimeSubscription(
        'messages',
        'INSERT',
        (payload) => {
          if (payload.new.room_id === roomId) {
            io.to(`chat-${roomId}`).emit('new-message', payload.new);
          }
        }
      );
      
      // Store subscription to clean up later
      if (!activeSubscriptions.has(socket.id)) {
        activeSubscriptions.set(socket.id, []);
      }
      activeSubscriptions.get(socket.id).push(subscription);
    }
    
    console.log(`👥 User ${socket.userId} joined chat room: ${roomId}`);
  });
  
  // Handle leaving chat rooms
  socket.on('leave-chat-room', (roomId) => {
    socket.leave(`chat-${roomId}`);
    console.log(`👋 User ${socket.userId} left chat room: ${roomId}`);
  });
  
  socket.on('disconnect', () => {
    console.log('🔴 Socket.io: User disconnected:', socket.userId);
    
    // Clean up Supabase subscriptions for this socket
    if (activeSubscriptions.has(socket.id)) {
      const subscriptions = activeSubscriptions.get(socket.id);
      subscriptions.forEach(sub => {
        if (sub && sub.unsubscribe) {
          sub.unsubscribe();
        }
      });
      activeSubscriptions.delete(socket.id);
    }
  });
  
  socket.on('error', (error) => {
    console.error('❌ Socket.io error:', error);
  });
});

// ============ ERROR HANDLING ============

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('🔥 Server Error:', err.stack);
  
  // Check if it's a Supabase error
  if (err.code && err.code.startsWith('PGRST')) {
    console.error('📡 Supabase error:', err.message);
    return res.status(503).json({ 
      error: 'Database service unavailable',
      message: process.env.NODE_ENV === 'development' ? err.message : 'Please try again later'
    });
  }
  
  res.status(500).json({ 
    error: 'Something went wrong!',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error'
  });
});

// 404 handler with detailed logging
app.use('*', (req, res) => {
  console.log(`❌ 404: Route not found: ${req.method} ${req.originalUrl}`);
  console.log(`🔍 Available match routes:`);
  console.log(`   POST /api/matches/create`);
  console.log(`   GET  /api/matches/`);
  console.log(`   GET  /api/matches/:id`);
  console.log(`   POST /api/matches/:id/join`);
  console.log(`   POST /api/matches/:id/accept`);
  console.log(`   POST /api/matches/:id/decline`);
  console.log(`   POST /api/matches/:id/result`);
  console.log(`   POST /api/matches/:id/cancel`);
  console.log(`   GET  /api/matches/open`);
  console.log(`   GET  /api/matches/invitations/pending`);
  console.log(`   GET  /api/matches/user/stats`);
  console.log(`   GET  /api/matches/user/history`);
  console.log(`   GET  /api/matches/:id/chat`);
  console.log(`   POST /api/matches/:id/chat`);
  
  res.status(404).json({ 
    success: false,
    error: 'Route not found',
    requestedPath: req.originalUrl,
    database: isSupabase ? 'Supabase' : 'PostgreSQL',
    environment: process.env.NODE_ENV
  });
});

// ============ SERVER START ============

const PORT = process.env.PORT || 5001;

server.listen(PORT, () => {
  console.log('\n' + '='.repeat(50));
  console.log(`🎮 XP Gaming Platform Backend running on port ${PORT}`);
  console.log('='.repeat(50));
  console.log(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🗄️  Database: ${isSupabase ? 'Supabase (Cloud)' : 'PostgreSQL (Local)'}`);
  console.log(`🌐 CORS Origins:`);
  allowedOrigins.forEach(origin => console.log(`   - ${origin}`));
  
  if (isSupabase) {
    console.log(`📡 Real-time: Supabase + Socket.IO`);
    console.log(`🔑 Admin client: ${supabaseAdmin ? 'Available' : 'Not configured'}`);
  }
  
  console.log('\n=== REGISTERED MATCH ENDPOINTS ===');
  console.log('✅ POST /api/matches/create');
  console.log('✅ GET  /api/matches/');
  console.log('✅ GET  /api/matches/:id');
  console.log('✅ POST /api/matches/:id/join');
  console.log('✅ POST /api/matches/:id/accept');
  console.log('✅ POST /api/matches/:id/decline');
  console.log('✅ POST /api/matches/:id/result');
  console.log('✅ POST /api/matches/:id/cancel');
  console.log('✅ GET  /api/matches/open');
  console.log('✅ GET  /api/matches/invitations/pending');
  console.log('✅ GET  /api/matches/user/stats');
  console.log('✅ GET  /api/matches/user/history');
  console.log('✅ GET  /api/matches/:id/chat');
  console.log('✅ POST /api/matches/:id/chat');
  console.log('==================================\n');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  
  // Clean up Supabase subscriptions
  activeSubscriptions.forEach((subscriptions, socketId) => {
    subscriptions.forEach(sub => {
      if (sub && sub.unsubscribe) {
        sub.unsubscribe();
      }
    });
  });
  activeSubscriptions.clear();
  
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
});
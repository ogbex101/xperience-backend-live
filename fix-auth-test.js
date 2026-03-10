const db = require('./src/config/database');
const bcrypt = require('bcryptjs');

async function testAuth() {
  console.log('🔧 Testing auth system...\n');
  
  try {
    // 1. Check if users table has data
    const usersResult = await db.query('SELECT id, email, username FROM users LIMIT 5');
    const users = usersResult;
    
    console.log('1. Users in database:', users.length);
    users.forEach((user, i) => {
      console.log(`   ${i+1}. ID: ${user.id}, Email: ${user.email}, Username: ${user.username}`);
    });
    
    // 2. Create a test user if none exists
    if (users.length === 0) {
      console.log('\n2. No users found. Creating test user...');
      
      const email = 'test@test.com';
      const password = 'test123';
      const hashedPassword = await bcrypt.hash(password, 10);
      
      const result = await db.query(
        `INSERT INTO users (username, email, password_hash, full_name, wallet_account_number) 
         VALUES ($1, $2, $3, $4, $5) RETURNING id, email, username`,
        ['testuser', email, hashedPassword, 'Test User', 'XTX' + Date.now().toString().slice(-9)]
      );
      
      const newUser = result[0];
      console.log('✅ Test user created:');
      console.log(`   ID: ${newUser.id}, Email: ${newUser.email}, Username: ${newUser.username}`);
      console.log(`   Password: ${password}`);
    }
    
    // 3. Test password verification
    console.log('\n3. Testing password verification...');
    const testUser = await db.query('SELECT password_hash FROM users WHERE email = $1', ['test@test.com']);
    
    if (testUser.length > 0) {
      const hash = testUser[0].password_hash;
      const isValid = await bcrypt.compare('test123', hash);
      console.log(`   Password 'test123' matches hash: ${isValid}`);
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error('Full error:', error);
  }
}

testAuth();
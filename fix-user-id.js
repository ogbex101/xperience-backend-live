const db = require('./src/config/database');

async function fixUserIdIssue() {
  console.log('🔧 FIXING USER ID 0 ISSUE\n');

  // FIRST: Let's check what db.execute actually returns
  console.log('1. Testing db.execute() return structure...');
  try {
    const simpleTest = await db.execute('SELECT 1 as test');
    console.log('✅ db.execute() result structure:');
    console.log('   Type of result:', typeof simpleTest);
    console.log('   Is array?', Array.isArray(simpleTest));
    console.log('   Length:', simpleTest.length);
    console.log('   Result[0]:', simpleTest[0]);
    console.log('   Result[1]:', simpleTest[1]);
    console.log('   Result[0][0]:', simpleTest[0] ? simpleTest[0][0] : 'undefined');
  } catch (err) {
    console.log('❌ Error testing db.execute:', err.message);
  }

  // SECOND: Check actual users table column names
  console.log('\n2. Checking ACTUAL users table columns...');
  try {
    // Use raw pool query to bypass our wrapper
    const pool = require('./src/config/database').pool;
    const result = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'users' 
      ORDER BY ordinal_position
    `);
    
    console.log('Actual users table columns:');
    result.rows.forEach(col => {
      console.log(`   ${col.column_name} (${col.data_type})`);
    });
  } catch (err) {
    console.log('❌ Error checking table:', err.message);
  }

  // THIRD: Test actual INSERT with debug
  console.log('\n3. Testing actual INSERT with RETURNING...');
  try {
    const pool = require('./src/config/database').pool;
    const testEmail = `fix_test_${Date.now()}@test.com`;
    
    console.log('   Using email:', testEmail);
    
    const result = await pool.query(
      `INSERT INTO users (email, password, username, firstname, lastname, wallet_account_number, currency, created_at, updated_at) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
       RETURNING id, email, username`,
      [
        testEmail,
        '$2b$testhash',
        'fixtestuser',
        'Fix',
        'Test',
        'XP' + Date.now().toString().slice(-8),
        'NGN'
      ]
    );
    
    console.log('   INSERT result from pool.query:');
    console.log('   Result object keys:', Object.keys(result));
    console.log('   Result.rows:', result.rows);
    console.log('   Result.rowCount:', result.rowCount);
    console.log('   First row:', result.rows[0]);
    console.log('   ID returned:', result.rows[0]?.id);
    
    // Clean up
    await pool.query('DELETE FROM users WHERE email = $1', [testEmail]);
    console.log('   ✅ Test record cleaned up');
    
  } catch (err) {
    console.log('❌ INSERT test error:', err.message);
    console.log('   Error details:', err);
  }

  // FOURTH: Check recent users to see current IDs
  console.log('\n4. Checking current users...');
  try {
    const pool = require('./src/config/database').pool;
    const result = await pool.query(`
      SELECT id, email, username, created_at 
      FROM users 
      ORDER BY id DESC 
      LIMIT 5
    `);
    
    console.log('Recent users (highest IDs first):');
    result.rows.forEach(user => {
      console.log(`   ID: ${user.id}, Email: ${user.email}, Username: ${user.username}`);
    });
  } catch (err) {
    console.log('❌ Error checking users:', err.message);
  }

  console.log('\n🎯 Based on this, I\'ll give you the exact fix.');
}

fixUserIdIssue();
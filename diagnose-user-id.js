const db = require('./src/config/database');

async function diagnoseUserIdIssue() {
  console.log('🔍 DIAGNOSING USER ID 0 ISSUE\n');
  
  // Test 1: Check database connection and structure
  console.log('1. Testing database connection...');
  try {
    const result = await db.execute('SELECT version()');
    console.log('✅ PostgreSQL version:', result.rows[0].version);
  } catch (err) {
    console.log('❌ Database connection error:', err.message);
  }

  // Test 2: Check users table structure
  console.log('\n2. Checking users table structure...');
  try {
    const result = await db.execute(`
      SELECT column_name, data_type, is_identity 
      FROM information_schema.columns 
      WHERE table_name = 'users' 
      ORDER BY ordinal_position
    `);
    
    console.log('Users table columns:');
    result.rows.forEach(col => {
      console.log(`  ${col.column_name} (${col.data_type}) ${col.is_identity === 'YES' ? '[IDENTITY]' : ''}`);
    });
  } catch (err) {
    console.log('❌ Table structure error:', err.message);
  }

  // Test 3: Check what ID is actually returned by INSERT
  console.log('\n3. Testing INSERT with RETURNING clause...');
  try {
    const testEmail = `diagnose_${Date.now()}@test.com`;
    const insertQuery = `
      INSERT INTO users (email, password, username, first_name, last_name, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
      RETURNING id, email, created_at
    `;
    
    const result = await db.execute(insertQuery, [
      testEmail,
      'testhash',
      'diagnoseuser',
      'Diagnose',
      'Test'
    ]);
    
    console.log('✅ INSERT result structure:');
    console.log('  Full result object keys:', Object.keys(result));
    console.log('  Rows array length:', result.rows?.length);
    console.log('  Row count:', result.rowCount);
    
    if (result.rows && result.rows[0]) {
      const insertedUser = result.rows[0];
      console.log('  Inserted user data:', insertedUser);
      console.log('  ID type:', typeof insertedUser.id);
      console.log('  ID value:', insertedUser.id);
      
      // Clean up
      await db.execute('DELETE FROM users WHERE email = $1', [testEmail]);
      console.log('  Test record cleaned up');
    }
  } catch (err) {
    console.log('❌ INSERT test error:', err.message);
  }

  // Test 4: Check existing registrations
  console.log('\n4. Checking recent user registrations...');
  try {
    const result = await db.execute(`
      SELECT id, email, username, created_at 
      FROM users 
      ORDER BY created_at DESC 
      LIMIT 5
    `);
    
    console.log('Recent users in database:');
    result.rows.forEach(user => {
      console.log(`  ID: ${user.id}, Email: ${user.email}, Created: ${user.created_at}`);
    });
  } catch (err) {
    console.log('❌ Recent users query error:', err.message);
  }

  console.log('\n🔧 Based on this diagnosis, we can fix the exact issue.');
}

diagnoseUserIdIssue();
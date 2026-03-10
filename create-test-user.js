// create-test-user.js
const db = require('./src/config/database');
const bcrypt = require('bcryptjs');

async function createTestUser() {
  try {
    console.log('👤 Creating test user...');
    
    const email = `test${Date.now()}@test.com`;
    const username = `testuser${Date.now()}`;
    const password = 'Test123!';
    const hashedPassword = await bcrypt.hash(password, 10);
    const walletAccount = 'XTX' + Date.now().toString().slice(-9);
    
    const result = await db.query(
      `INSERT INTO users (email, username, password_hash, full_name, wallet_account_number) 
       VALUES ($1, $2, $3, $4, $5) RETURNING id, email, username, wallet_account_number`,
      [email, username, hashedPassword, 'Test User', walletAccount]
    );
    
    const user = result[0];
    
    console.log('✅ Test user created successfully!');
    console.log('\n📋 USER DETAILS:');
    console.log('ID:', user.id);
    console.log('Email:', user.email);
    console.log('Username:', user.username);
    console.log('Wallet Account:', user.wallet_account_number);
    console.log('Password:', password);
    
    console.log('\n🔐 Use these credentials to login and test:');
    console.log(`Email: ${email}`);
    console.log(`Password: ${password}`);
    
  } catch (error) {
    console.error('❌ Error creating test user:', error.message);
    console.error('Full error:', error);
  }
}

createTestUser();
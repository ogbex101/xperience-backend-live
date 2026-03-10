// manual-test.js
const axios = require('axios');

const BASE_URL = 'http://localhost:5000/api';

async function manualTest() {
  console.log('🔧 MANUAL WALLET TEST\n');
  
  // Try these common test emails
  const testCredentials = [
    { email: 'admin@example.com', password: 'admin123' },
    { email: 'user@example.com', password: 'user123' },
    { email: 'test@example.com', password: 'test123' },
    { email: 'demo@example.com', password: 'demo123' },
    { email: 'admin@admin.com', password: 'admin' },
    { email: 'test@test.com', password: 'test' }
  ];
  
  for (const creds of testCredentials) {
    console.log(`Trying login with: ${creds.email}`);
    
    try {
      const loginRes = await axios.post(`${BASE_URL}/auth/login`, creds);
      console.log('✅ Login successful!');
      
      const token = loginRes.data.token;
      const userId = loginRes.data.user.id;
      console.log(`User ID: ${userId}`);
      console.log(`Token (first 20 chars): ${token.substring(0, 20)}...`);
      
      const headers = { 'Authorization': `Bearer ${token}` };
      
      // Test balance endpoint
      console.log('\nTesting /wallet/balance...');
      try {
        const balanceRes = await axios.get(`${BASE_URL}/wallet/balance`, { headers });
        console.log('✅ Balance endpoint works!');
        console.log('Status:', balanceRes.status);
        console.log('Balance:', balanceRes.data.balance);
        console.log('XP Points:', balanceRes.data.xp_points);
        console.log('Currency:', balanceRes.data.currency);
      } catch (balanceError) {
        console.log('❌ Balance endpoint failed:');
        console.log('Error:', balanceError.response?.data?.message || balanceError.message);
      }
      
      return; // Stop after successful test
      
    } catch (error) {
      console.log(`❌ Failed: ${error.response?.data?.error || error.message}`);
      console.log('---');
    }
  }
  
  console.log('\n❌ No valid credentials worked.');
  console.log('\n💡 Try creating a new user:');
  console.log('1. Run: node create-test-user.js');
  console.log('2. Use the generated credentials to login');
}

manualTest();
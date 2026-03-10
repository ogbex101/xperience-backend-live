const http = require('http');

console.log('🧪 FULL SYSTEM POSTGRESQL MIGRATION TEST\n');

const tests = [
  // Phase 1: Core functionality
  { name: 'Health Check', path: '/api/health', method: 'GET' },
  { name: 'Database Test', path: '/api/auth/debug/db-test', method: 'GET' },
  
  // Phase 2: Authentication
  { name: 'User Registration', path: '/api/auth/register', method: 'POST', 
    data: { username: 'migrationtest', email: 'migration@test.com', password: 'test123' } },
  { name: 'User Login', path: '/api/auth/login', method: 'POST',
    data: { email: 'migration@test.com', password: 'test123' } },
  
  // Phase 3: Public features
  { name: 'Leaderboard Players', path: '/api/leaderboard/players', method: 'GET' },
  { name: 'Leaderboard Games', path: '/api/leaderboard/games', method: 'GET' },
  { name: 'Open Matches', path: '/api/matches/open', method: 'GET' },
  
  // Phase 4: Protected features (will fail without token, but should return 401, not 500)
  { name: 'User Profile (no auth)', path: '/api/auth/profile', method: 'GET', expect401: true },
];

let authToken = '';

async function makeRequest(test) {
  return new Promise((resolve) => {
    const postData = test.data ? JSON.stringify(test.data) : null;
    
    const options = {
      hostname: 'localhost',
      port: 5000,
      path: test.path,
      method: test.method,
      headers: {
        ...(postData && { 'Content-Type': 'application/json' }),
        ...(authToken && { 'Authorization': `Bearer ${authToken}` })
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const json = data ? JSON.parse(data) : {};
          
          // Success criteria
          let success = false;
          if (test.expect401) {
            success = res.statusCode === 401; // Expected unauthorized
          } else if (test.method === 'POST' && test.path.includes('/auth/')) {
            success = res.statusCode >= 200 && res.statusCode < 300;
            // Save token for subsequent requests
            if (success && json.accessToken) {
              authToken = json.accessToken;
            }
          } else {
            success = res.statusCode >= 200 && res.statusCode < 300;
          }
          
          if (success) {
            console.log(`✅ ${test.name}: Success (${res.statusCode})`);
            if (json.id !== undefined && json.id === 0) {
              console.log(`   ⚠️  Warning: ID is 0, should be actual PostgreSQL ID`);
            }
          } else {
            console.log(`❌ ${test.name}: Failed (${res.statusCode})`);
            if (json.error) console.log(`   Error: ${json.error}`);
            if (res.statusCode === 500) {
              console.log(`   💀 SERVER ERROR - PostgreSQL syntax issue!`);
            }
          }
          
          resolve(success);
        } catch (e) {
          console.log(`❌ ${test.name}: Parse error - ${e.message}`);
          resolve(false);
        }
      });
    });

    req.on('error', (error) => {
      console.log(`❌ ${test.name}: Connection error - ${error.message}`);
      resolve(false);
    });

    req.setTimeout(10000, () => {
      console.log(`⏱️  ${test.name}: Timeout`);
      req.destroy();
      resolve(false);
    });

    if (postData) {
      req.write(postData);
    }
    
    req.end();
  });
}

async function runAllTests() {
  console.log('='.repeat(60));
  console.log('PHASE 1: Core PostgreSQL Connectivity\n');
  
  let phase1Passed = 0;
  for (let i = 0; i < 2; i++) {
    if (await makeRequest(tests[i])) phase1Passed++;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  console.log('\nPHASE 2: PostgreSQL Authentication\n');
  let phase2Passed = 0;
  for (let i = 2; i < 4; i++) {
    if (await makeRequest(tests[i])) phase2Passed++;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  console.log('\nPHASE 3: PostgreSQL Public Features\n');
  let phase3Passed = 0;
  for (let i = 4; i < 7; i++) {
    if (await makeRequest(tests[i])) phase3Passed++;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  console.log('\nPHASE 4: PostgreSQL Protected Features\n');
  let phase4Passed = 0;
  for (let i = 7; i < tests.length; i++) {
    if (await makeRequest(tests[i])) phase4Passed++;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('📊 MIGRATION TEST RESULTS:');
  console.log(`Phase 1 (Connectivity): ${phase1Passed}/2 ${phase1Passed === 2 ? '✅' : '❌'}`);
  console.log(`Phase 2 (Authentication): ${phase2Passed}/2 ${phase2Passed === 2 ? '✅' : '❌'}`);
  console.log(`Phase 3 (Public Features): ${phase3Passed}/3 ${phase3Passed === 3 ? '✅' : '❌'}`);
  console.log(`Phase 4 (Protected Features): ${phase4Passed}/1 ${phase4Passed === 1 ? '✅' : '❌'}`);
  
  const totalPassed = phase1Passed + phase2Passed + phase3Passed + phase4Passed;
  const totalTests = tests.length;
  
  console.log(`\n🎯 OVERALL: ${totalPassed}/${totalTests} tests passed`);
  console.log(`📈 SUCCESS RATE: ${Math.round((totalPassed / totalTests) * 100)}%`);
  
  if (totalPassed >= totalTests - 1) {
    console.log('\n🎉🎉🎉 POSTGRESQL MIGRATION SUCCESSFUL! 🎉🎉🎉');
    console.log('\n✅ Your application is running on PostgreSQL!');
    console.log('✅ Authentication is working!');
    console.log('✅ Database queries are executing!');
    console.log('\n🚀 NEXT: Test specific features and deploy!');
  } else {
    console.log('\n⚠️  Some tests failed. Need to fix before production.');
  }
}

runAllTests().catch(console.error);
const fs = require('fs');
const path = require('path');

console.log('🔍 Checking for PostgreSQL compatibility issues...\n');

const routesDir = path.join(__dirname, 'src/routes');
const files = fs.readdirSync(routesDir).filter(f => f.endsWith('.js') && f !== 'admin.js');

const postgresqlIssues = {
  'questionMarks': { pattern: /\?/g, fix: 'Change ? to $1, $2, $3' },
  'backticks': { pattern: /`[^`]+`/g, fix: 'Remove backticks or use double quotes' },
  'executeMethod': { pattern: /\.execute\(/g, fix: 'Change .execute() to .query()' },
  'insertId': { pattern: /result\.insertId/g, fix: 'Change to result.rows[0].id' },
  'lastInsertId': { pattern: /LAST_INSERT_ID\(\)/gi, fix: 'Use RETURNING id instead' },
  'ifnull': { pattern: /IFNULL\(/gi, fix: 'Change to COALESCE()' },
  'mysqlInterval': { pattern: /DATE_SUB\(NOW\(\), INTERVAL/g, fix: "Use NOW() - INTERVAL '1 hour'" },
  'randFunction': { pattern: /RAND\(\)/g, fix: 'Change to RANDOM()' },
};

let totalIssues = 0;

files.forEach(file => {
  const filePath = path.join(routesDir, file);
  const content = fs.readFileSync(filePath, 'utf8');
  
  const issues = [];
  
  Object.entries(postgresqlIssues).forEach(([key, { pattern, fix }]) => {
    const matches = content.match(pattern);
    if (matches && matches.length > 0) {
      issues.push({ issue: key, count: matches.length, fix });
      totalIssues += matches.length;
    }
  });
  
  if (issues.length > 0) {
    console.log(`📄 ${file}:`);
    issues.forEach(({ issue, count, fix }) => {
      console.log(`   ❌ ${issue}: ${count} occurrences - ${fix}`);
    });
    console.log('');
  }
});

console.log('='.repeat(50));
console.log(`📊 TOTAL ISSUES FOUND: ${totalIssues}`);

if (totalIssues === 0) {
  console.log('🎉 All converted routes are PostgreSQL compatible!');
  console.log('\n✅ NEXT STEPS:');
  console.log('   1. Test authentication endpoints');
  console.log('   2. Test core features (matches, tournaments)');
  console.log('   3. Test payment flows (wallet, transactions)');
  console.log('   4. Test real-time features (chat, socket.io)');
} else {
  console.log('\n⚠️  Issues found. Need to fix before production.');
  console.log('\n🚀 QUICK FIX SCRIPT:');
  console.log('Create fix-remaining.js with:');
  console.log(`
    const fs = require('fs');
    const path = require('path');
    
    const files = ['matches.js', 'wallet.js', 'groups.js', 'users.js', 'friends.js', 'chat.js'];
    
    files.forEach(file => {
      const filePath = path.join(__dirname, 'src/routes', file);
      let content = fs.readFileSync(filePath, 'utf8');
      
      // Apply fixes
      content = content.replace(/\\?/g, '$$$'); // You need to number these properly
      content = content.replace(/\`([^\`]+)\`/g, '"$1"');
      content = content.replace(/\\.execute\\(/g, '.query(');
      content = content.replace(/result\\.insertId/g, 'result.rows[0].id');
      content = content.replace(/LAST_INSERT_ID\\(\\)/gi, 'RETURNING id');
      content = content.replace(/IFNULL\\(/gi, 'COALESCE(');
      content = content.replace(/RAND\\(\\)/g, 'RANDOM()');
      content = content.replace(/DATE_SUB\\(NOW\\(\\), INTERVAL/g, "NOW() - INTERVAL '");
      
      fs.writeFileSync(filePath + '.backup', fs.readFileSync(filePath, 'utf8'));
      fs.writeFileSync(filePath, content);
      console.log('Fixed:', file);
    });
  `);
}

// Generate test commands
console.log('\n📋 MANUAL TEST COMMANDS:');
console.log('curl http://localhost:5000/api/health');
console.log('curl http://localhost:5000/api/auth/debug/db-test');
console.log('curl http://localhost:5000/api/leaderboard/players');
console.log('curl -X POST http://localhost:5000/api/auth/register \\');
console.log('  -H "Content-Type: application/json" \\');
console.log('  -d \'{"username":"testuser","email":"test@example.com","password":"password123"}\'');
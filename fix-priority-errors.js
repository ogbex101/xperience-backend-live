#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const routesDir = path.join(__dirname, 'src', 'routes');

console.log('🔧 FIXING PRIORITY ERRORS\n');
console.log('='.repeat(60));

// Function to fix MySQL patterns in a file
function fixFile(fileName) {
  const filePath = path.join(routesDir, fileName);
  
  if (!fs.existsSync(filePath)) {
    console.log(`❌ ${fileName} not found`);
    return 0;
  }
  
  console.log(`\n📄 Fixing ${fileName}:`);
  
  let content = fs.readFileSync(filePath, 'utf8');
  let changes = 0;
  const lines = content.split('\n');
  const newLines = [];
  
  lines.forEach((line, lineNum) => {
    let newLine = line;
    const lineNumber = lineNum + 1;
    
    // Skip comments and logs
    if (line.includes('//') || line.includes('console.log') || line.includes('console.error')) {
      newLines.push(newLine);
      return;
    }
    
    // Fix 1: MySQL ? placeholders
    if (line.includes('?') && 
        (line.includes('SELECT') || line.includes('INSERT') || 
         line.includes('UPDATE') || line.includes('DELETE') ||
         line.includes('db.execute') || line.includes('db.query'))) {
      
      // Count ? in this line
      const matches = line.match(/\?/g);
      if (matches) {
        // Replace ? with $1, $2, $3...
        for (let i = 1; i <= matches.length; i++) {
          newLine = newLine.replace('?', `$${i}`);
        }
        
        if (matches.length > 0) {
          console.log(`   Line ${lineNumber}: Fixed ${matches.length} ? placeholders`);
          changes++;
        }
      }
    }
    
    // Fix 2: LAST_INSERT_ID() → RETURNING id
    if (line.includes('LAST_INSERT_ID()')) {
      newLine = newLine.replace('LAST_INSERT_ID()', 'RETURNING id');
      console.log(`   Line ${lineNumber}: Fixed LAST_INSERT_ID()`);
      changes++;
    }
    
    // Fix 3: LIMIT x, y → LIMIT y OFFSET x (MySQL to PostgreSQL)
    const limitMatch = line.match(/LIMIT\s+(\d+)\s*,\s*(\d+)/i);
    if (limitMatch) {
      const offset = limitMatch[1];
      const limit = limitMatch[2];
      newLine = newLine.replace(`LIMIT ${offset}, ${limit}`, `LIMIT ${limit} OFFSET ${offset}`);
      console.log(`   Line ${lineNumber}: Fixed LIMIT ${offset}, ${limit} → LIMIT ${limit} OFFSET ${offset}`);
      changes++;
    }
    
    // Fix 4: ORDER BY RAND() → ORDER BY RANDOM()
    if (line.includes('ORDER BY RAND()')) {
      newLine = line.replace('ORDER BY RAND()', 'ORDER BY RANDOM()');
      console.log(`   Line ${lineNumber}: Fixed ORDER BY RAND() → ORDER BY RANDOM()`);
      changes++;
    }
    
    newLines.push(newLine);
  });
  
  if (changes > 0) {
    fs.writeFileSync(filePath, newLines.join('\n'));
    console.log(`   ✅ Fixed ${changes} issues`);
  } else {
    console.log(`   ✅ No MySQL patterns found`);
  }
  
  return changes;
}

// Fix in priority order
const priorityFiles = [
  'users.js',      // /users/:id 500 error
  'wallet.js',     // /wallet/balance 500 error  
  'notifications.js', // syntax error near "ORDER"
  'friends.js',    // /friends 500 error
  'matches.js',    // public routes requiring auth
  'suggestedPlayers.js' // requires auth but should be public?
];

let totalChanges = 0;

priorityFiles.forEach(file => {
  totalChanges += fixFile(file);
});

console.log('\n' + '='.repeat(60));
console.log(`🎯 Total changes made: ${totalChanges}`);
console.log('\n📝 Next steps:');
console.log('1. Restart server: npm run dev');
console.log('2. Run test again: node test-all-working.js');
console.log('3. Check server logs for remaining SQL errors');
console.log('\n💡 If errors persist, check specific lines mentioned in server logs');
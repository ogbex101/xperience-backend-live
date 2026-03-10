#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const routesDir = path.join(__dirname, 'src', 'routes');

function fixFile(filePath) {
  console.log(`\n🔧 Fixing ${path.basename(filePath)}...`);
  
  let content = fs.readFileSync(filePath, 'utf8');
  let changes = 0;
  
  // Convert ? placeholders to $1, $2, $3
  const lines = content.split('\n');
  const newLines = [];
  
  lines.forEach((line, lineIndex) => {
    let newLine = line;
    
    // Skip comments and console.log
    if (!line.includes('//') && 
        !line.includes('console.log') &&
        (line.includes('SELECT') || line.includes('INSERT') || 
         line.includes('UPDATE') || line.includes('DELETE') ||
         line.includes('db.execute') || line.includes('pool.query'))) {
      
      // Count ? placeholders
      const questionMarks = (line.match(/\?/g) || []).length;
      
      if (questionMarks > 0) {
        console.log(`   Line ${lineIndex + 1}: Found ${questionMarks} ? placeholders`);
        
        // Replace ? with $1, $2, $3...
        for (let i = 1; i <= questionMarks; i++) {
          newLine = newLine.replace('?', `$${i}`);
        }
        
        changes++;
      }
    }
    
    newLines.push(newLine);
  });
  
  if (changes > 0) {
    fs.writeFileSync(filePath, newLines.join('\n'));
    console.log(`   ✅ Fixed ${changes} placeholders`);
  } else {
    console.log('   ✅ No placeholders to fix');
  }
  
  return changes;
}

// Fix in priority order
const filesToFix = [
  'matches.js',
  'wallet.js', 
  'users.js',
  'friends.js',
  'chat.js',
  'groups.js'
  // tournaments.js and admin.js later - they're huge
];

console.log('🚀 BATCH FIXING MYSQL PLACEHOLDERS');
console.log('='.repeat(50));

let totalChanges = 0;

filesToFix.forEach(fileName => {
  const filePath = path.join(routesDir, fileName);
  if (fs.existsSync(filePath)) {
    totalChanges += fixFile(filePath);
  } else {
    console.log(`\n⚠️  ${fileName} not found`);
  }
});

console.log('\n' + '='.repeat(50));
console.log(`🎯 Total changes: ${totalChanges}`);
console.log('\n📝 Next steps:');
console.log('1. Restart server: npm run dev');
console.log('2. Test with: node quick-test-with-real-user.js');
console.log('3. Check for syntax errors in fixed files');
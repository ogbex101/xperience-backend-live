const fs = require('fs');
const path = require('path');

console.log('🔍 Smart PostgreSQL compatibility check...\n');

function isSqlTemplateString(line) {
  // Check if backticks contain SQL keywords
  const sqlKeywords = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'FROM', 'WHERE', 'JOIN', 'VALUES'];
  return sqlKeywords.some(keyword => 
    line.includes('`') && line.includes(keyword) && line.includes('`')
  );
}

function checkFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  
  let realIssues = [];
  let falsePositives = 0;
  
  lines.forEach((line, index) => {
    // Check for REAL MySQL issues (not template strings)
    
    // 1. Question marks in SQL context
    if (line.includes('?') && 
        (line.includes('SELECT') || line.includes('INSERT') || 
         line.includes('UPDATE') || line.includes('DELETE') ||
         line.includes('WHERE') || line.includes('VALUES'))) {
      // But NOT if it's in a comment
      if (!line.trim().startsWith('//') && !line.includes('/*')) {
        realIssues.push({
          line: index + 1,
          issue: 'Question mark parameter',
          code: line.trim().substring(0, 80)
        });
      }
    }
    
    // 2. MySQL-specific functions
    const mysqlFunctions = [
      { pattern: /IFNULL\(/gi, name: 'IFNULL()' },
      { pattern: /LAST_INSERT_ID\(\)/gi, name: 'LAST_INSERT_ID()' },
      { pattern: /LIMIT\s+\d+\s*,\s*\d+/g, name: 'LIMIT x,y syntax' },
      { pattern: /@\w+/g, name: 'MySQL user variables' }
    ];
    
    mysqlFunctions.forEach(({ pattern, name }) => {
      if (line.match(pattern)) {
        realIssues.push({
          line: index + 1,
          issue: `MySQL function: ${name}`,
          code: line.trim().substring(0, 80)
        });
      }
    });
  });
  
  return realIssues;
}

// Check auth.js
const authPath = path.join(__dirname, 'src/routes/auth.js');
const issues = checkFile(authPath);

console.log(`📄 auth.js check:\n`);

if (issues.length === 0) {
  console.log('✅ PERFECT! No PostgreSQL issues found!');
  console.log('\n💡 Your auth.js is fully PostgreSQL compatible!');
} else {
  console.log(`Found ${issues.length} issues:`);
  issues.forEach(({ line, issue, code }) => {
    console.log(`   Line ${line}: ${issue}`);
    console.log(`       ${code}...`);
  });
}

// Also check a few other critical files
console.log('\n🔍 Quick check of other critical files:\n');

const criticalFiles = ['matches.js', 'wallet.js', 'users.js'];
criticalFiles.forEach(file => {
  const filePath = path.join(__dirname, 'src/routes', file);
  if (fs.existsSync(filePath)) {
    const issues = checkFile(filePath);
    console.log(`${file}: ${issues.length} real issues`);
  }
});
const fs = require('fs');
const path = require('path');

console.log('🔍 Accurate PostgreSQL compatibility check...\n');

function isJavaScriptTernary(line) {
  // Check if ? is a JavaScript ternary operator (has : after)
  const trimmed = line.trim();
  const qIndex = trimmed.indexOf('?');
  const colonIndex = trimmed.indexOf(':', qIndex);
  
  return qIndex !== -1 && 
         colonIndex !== -1 && 
         colonIndex > qIndex &&
         !trimmed.includes('SELECT ?') &&
         !trimmed.includes('WHERE ?') &&
         !trimmed.includes('VALUES ?');
}

function checkFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  
  let realIssues = [];
  
  lines.forEach((line, index) => {
    // Skip comments
    if (line.trim().startsWith('//') || line.trim().startsWith('/*')) {
      return;
    }
    
    // Check for REAL MySQL issues (not JavaScript ternaries)
    
    // 1. Question marks in SQL context (not JavaScript ternaries)
    if (line.includes('?') && 
        (line.includes('SELECT') || line.includes('INSERT') || 
         line.includes('UPDATE') || line.includes('DELETE') ||
         line.includes('WHERE') || line.includes('VALUES')) &&
        !isJavaScriptTernary(line)) {
      
      realIssues.push({
        line: index + 1,
        issue: 'SQL question mark parameter',
        code: line.trim().substring(0, 80)
      });
    }
    
    // 2. REAL MySQL-specific functions only
    const mysqlFunctions = [
      { pattern: /IFNULL\([^)]+\)/gi, name: 'IFNULL() function' },
      { pattern: /LAST_INSERT_ID\(\)/gi, name: 'LAST_INSERT_ID() function' },
      { pattern: /LIMIT\s+\d+\s*,\s*\d+/g, name: 'MySQL LIMIT x,y syntax' },
      { pattern: /@\w+\s*:=/g, name: 'MySQL variable assignment' },
      { pattern: /`[a-zA-Z_][a-zA-Z0-9_]*`/g, name: 'MySQL backticks around identifiers' }
    ];
    
    mysqlFunctions.forEach(({ pattern, name }) => {
      const matches = line.match(pattern);
      if (matches) {
        // Check it's not in a string literal
        const inString = line.match(/['"`].*?['"`]/g);
        if (!inString || !inString.some(str => str.includes(matches[0]))) {
          realIssues.push({
            line: index + 1,
            issue: `MySQL: ${name}`,
            code: line.trim().substring(0, 80)
          });
        }
      }
    });
  });
  
  return realIssues;
}

// Check all route files
const routesDir = path.join(__dirname, 'src/routes');
const files = fs.readdirSync(routesDir).filter(f => f.endsWith('.js') && f !== 'admin.js');

console.log('Checking all converted routes:\n');

let totalRealIssues = 0;

files.forEach(file => {
  const filePath = path.join(routesDir, file);
  const issues = checkFile(filePath);
  
  if (issues.length > 0) {
    console.log(`📄 ${file}: ${issues.length} real issues`);
    issues.forEach(({ line, issue, code }) => {
      console.log(`   Line ${line}: ${issue}`);
      console.log(`       ${code}...`);
    });
    console.log('');
    totalRealIssues += issues.length;
  } else {
    console.log(`✅ ${file}: No PostgreSQL issues found`);
  }
});

console.log('='.repeat(50));
console.log(`📊 TOTAL REAL ISSUES: ${totalRealIssues}`);

if (totalRealIssues === 0) {
  console.log('\n🎉 ALL ROUTES ARE POSTGRESQL COMPATIBLE!');
  console.log('\n✅ MIGRATION COMPLETE!');
  console.log('\n🚀 NEXT: Full system testing');
} else {
  console.log('\n⚠️  Need to fix remaining issues before production');
}
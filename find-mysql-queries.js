const fs = require('fs');
const path = require('path');

function findMySQLQueries(dir) {
  const files = fs.readdirSync(dir, { withFileTypes: true });
  let mysqlQueries = [];

  files.forEach(file => {
    const filePath = path.join(dir, file.name);
    
    if (file.isDirectory()) {
      mysqlQueries = mysqlQueries.concat(findMySQLQueries(filePath));
    } else if (file.name.endsWith('.js')) {
      const content = fs.readFileSync(filePath, 'utf8');
      
      // Find MySQL patterns
      const patterns = {
        questionMarks: (content.match(/\?/g) || []).length,
        backticks: (content.match(/`[^`]+`/g) || []).length,
        lastInsertId: (content.match(/LAST_INSERT_ID\(\)/gi) || []).length,
        ifnull: (content.match(/IFNULL\(/gi) || []).length,
        limitOffset: (content.match(/LIMIT\s+\d+\s*,\s*\d+/g) || []).length
      };

      const totalIssues = Object.values(patterns).reduce((a, b) => a + b, 0);
      
      if (totalIssues > 0) {
        mysqlQueries.push({
          file: filePath.replace(process.cwd(), ''),
          ...patterns,
          total: totalIssues
        });
      }
    }
  });

  return mysqlQueries;
}

// Run from backend directory
console.log('🔍 Scanning for MySQL queries in routes...\n');
const routesDir = path.join(__dirname, 'src/routes');
const results = findMySQLQueries(routesDir);

if (results.length === 0) {
  console.log('✅ No MySQL queries found!');
} else {
  console.log('📊 MySQL Queries Found:\n');
  results.sort((a, b) => b.total - a.total).forEach(result => {
    console.log(`📄 ${result.file}`);
    console.log(`   ? parameters: ${result.questionMarks}`);
    console.log(`   Backticks: ${result.backticks}`);
    console.log(`   LAST_INSERT_ID(): ${result.lastInsertId}`);
    console.log(`   IFNULL(): ${result.ifnull}`);
    console.log(`   LIMIT x,y: ${result.limitOffset}`);
    console.log(`   🔴 TOTAL ISSUES: ${result.total}\n`);
  });
  
  console.log(`\n📈 Summary: ${results.length} files need conversion`);
  console.log(`   Priority order:`);
  results.sort((a, b) => b.total - a.total).slice(0, 5).forEach((result, i) => {
    console.log(`   ${i + 1}. ${result.file} (${result.total} issues)`);
  });
}
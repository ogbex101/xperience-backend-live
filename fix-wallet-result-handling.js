// backend/fix-wallet-result-handling.js
const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src', 'routes', 'wallet.js');

console.log('🔧 Fixing db.query() result handling in wallet.js\n');

let content = fs.readFileSync(filePath, 'utf8');
let changes = 0;

const lines = content.split('\n');
const newLines = [];

for (let i = 0; i < lines.length; i++) {
  let line = lines[i];
  
  // Find lines with const { rows: xxx } = await db.query(
  const match = line.match(/const\s+\{\s*rows:\s*(\w+)\s*\}\s*=\s*await\s+db\.query\(/);
  
  if (match) {
    const varName = match[1];
    
    // Change this line
    line = line.replace(/const\s+\{\s*rows:\s*(\w+)\s*\}\s*=\s*await\s+db\.query\(/, 
      `const ${varName}Result = await db.query(`);
    
    // Add next line to extract rows
    newLines.push(line);
    newLines.push(`    const ${varName} = ${varName}Result[0];`);
    changes++;
    
  } else {
    newLines.push(line);
  }
}

if (changes > 0) {
  fs.writeFileSync(filePath, newLines.join('\n'));
  console.log(`✅ Fixed ${changes} db.query() patterns in wallet.js`);
} else {
  console.log('✅ No patterns to fix');
}
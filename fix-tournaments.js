const fs = require('fs');
const path = require('path');

console.log('🔧 Fixing tournaments.js MySQL to PostgreSQL...\n');

const filePath = path.join(__dirname, 'src/routes/tournaments.js');
let content = fs.readFileSync(filePath, 'utf8');

// Count occurrences
const beforeCount = (content.match(/\.promise\(\)\.getConnection\(\)/g) || []).length;
console.log(`Found ${beforeCount} occurrences of .promise().getConnection()`);

// Fix 1: Replace .promise().getConnection() with .connect()
content = content.replace(/\.promise\(\)\.getConnection\(\)/g, '.connect()');

const afterCount = (content.match(/\.promise\(\)\.getConnection\(\)/g) || []).length;

// Backup original
const backupPath = filePath + '.backup';
fs.writeFileSync(backupPath, fs.readFileSync(filePath, 'utf8'));

// Write fixed version
fs.writeFileSync(filePath, content);

console.log(`✅ Fixed ${beforeCount - afterCount} occurrences`);
console.log(`📋 Backup saved as ${path.basename(backupPath)}`);
console.log('\n⚠️  Next steps:');
console.log('   1. Also fix connection.beginTransaction() → connection.query("BEGIN")');
console.log('   2. Fix connection.commit() → connection.query("COMMIT")');
console.log('   3. Comment out setInterval at bottom of file');
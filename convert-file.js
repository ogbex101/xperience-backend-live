const fs = require('fs');
const path = require('path');

function convertMySQLtoPostgreSQL(content) {
  let converted = content;
  
  // 1. Convert backticks to double quotes (or remove them)
  converted = converted.replace(/`([^`]+)`/g, '"$1"');
  
  // 2. Convert ? to $1, $2, $3...
  let paramCounter = 0;
  converted = converted.replace(/\?/g, () => {
    paramCounter++;
    return `$${paramCounter}`;
  });
  
  // 3. Convert LAST_INSERT_ID() to RETURNING id (in INSERT statements)
  converted = converted.replace(/INSERT INTO\s+([^(]+)\([^)]+\)[^;]+VALUES\s*\([^)]+\)[^;]*;/gi, (match) => {
    if (!match.includes('RETURNING') && !match.includes('LAST_INSERT_ID()')) {
      return match.replace(/;/, ' RETURNING id;');
    }
    return match;
  });
  
  // 4. Convert IFNULL to COALESCE
  converted = converted.replace(/IFNULL\(/gi, 'COALESCE(');
  
  // 5. Convert LIMIT offset,count to LIMIT count OFFSET offset
  converted = converted.replace(/LIMIT\s+(\d+)\s*,\s*(\d+)/gi, 'LIMIT $2 OFFSET $1');
  
  return converted;
}

// Test the conversion
function testConversion() {
  const testQueries = [
    // MySQL queries
    'SELECT * FROM `users` WHERE `email` = ? AND `status` = ? LIMIT 1',
    'INSERT INTO `matches` (`player1_id`, `player2_id`) VALUES (?, ?)',
    'SELECT IFNULL(`balance`, 0) FROM `users` WHERE `id` = ?',
    'SELECT * FROM `matches` LIMIT 10, 20',
    // Already PostgreSQL
    'SELECT * FROM users WHERE email = $1 AND status = $2 LIMIT 1',
    'INSERT INTO matches (player1_id, player2_id) VALUES ($1, $2) RETURNING id'
  ];
  
  console.log('🧪 Testing MySQL to PostgreSQL conversion:\n');
  testQueries.forEach((query, i) => {
    console.log(`${i + 1}. MySQL: ${query}`);
    console.log(`   PostgreSQL: ${convertMySQLtoPostgreSQL(query)}\n`);
  });
}

// Convert a specific file
function convertFile(filePath) {
  try {
    const fullPath = path.resolve(__dirname, filePath);
    
    if (!fs.existsSync(fullPath)) {
      console.error(`❌ File not found: ${filePath}`);
      return;
    }
    
    const original = fs.readFileSync(fullPath, 'utf8');
    const converted = convertMySQLtoPostgreSQL(original);
    
    // Check if conversion actually changed anything
    if (original === converted) {
      console.log(`✅ ${filePath} - No changes needed (already PostgreSQL?)`);
      return;
    }
    
    // Backup original
    const backupPath = `${fullPath}.mysql-backup`;
    fs.writeFileSync(backupPath, original);
    console.log(`📋 Backup created: ${backupPath}`);
    
    // Write converted file
    fs.writeFileSync(fullPath, converted);
    console.log(`✅ ${filePath} - Converted to PostgreSQL syntax`);
    
    // Show changes
    const originalLines = original.split('\n');
    const convertedLines = converted.split('\n');
    
    console.log('\n📝 Changes made:');
    for (let i = 0; i < Math.min(originalLines.length, convertedLines.length); i++) {
      if (originalLines[i] !== convertedLines[i]) {
        console.log(`   Line ${i + 1}:`);
        console.log(`     Before: ${originalLines[i].substring(0, 80)}...`);
        console.log(`     After:  ${convertedLines[i].substring(0, 80)}...`);
        console.log();
      }
    }
    
  } catch (error) {
    console.error(`❌ Error converting ${filePath}:`, error.message);
  }
}

// Main function
function main() {
  console.log('🔄 MySQL to PostgreSQL Converter\n');
  
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log('Usage: node convert-file.js <file1> [file2] [file3] ...');
    console.log('Or: node convert-file.js --test (to test conversion)');
    console.log('\nExample: node convert-file.js src/routes/notifications.js');
    return;
  }
  
  if (args[0] === '--test') {
    testConversion();
    return;
  }
  
  // Convert all specified files
  args.forEach(file => {
    console.log(`\n📄 Converting: ${file}`);
    console.log('='.repeat(50));
    convertFile(file);
  });
  
  console.log('\n' + '='.repeat(50));
  console.log('🎉 Conversion complete!');
  console.log('\n⚠️  IMPORTANT:');
  console.log('   1. Review the converted files');
  console.log('   2. Test with your server');
  console.log('   3. Some manual fixes may still be needed');
}

main();
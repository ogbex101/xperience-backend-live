const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const readdir = promisify(fs.readdir);
const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);

async function fixFile(filePath) {
  try {
    let content = await readFile(filePath, 'utf8');
    const original = content;
    
    // Apply fixes
    content = content.replace(/\.promise\(\)\.getConnection\(\)/g, '.connect()');
    content = content.replace(/await connection\.beginTransaction\(\)/g, "await connection.query('BEGIN')");
    content = content.replace(/await connection\.commit\(\)/g, "await connection.query('COMMIT')");
    content = content.replace(/await connection\.rollback\(\)/g, "await connection.query('ROLLBACK')");
    content = content.replace(/connection\.execute\(/g, 'connection.query(');
    content = content.replace(/LAST_INSERT_ID\(\)/gi, '(SELECT lastval())');
    
    if (content !== original) {
      await writeFile(filePath + '.backup', original);
      await writeFile(filePath, content);
      console.log(`✅ Fixed: ${path.basename(filePath)}`);
      return true;
    }
    
    return false;
  } catch (error) {
    console.log(`❌ Error fixing ${path.basename(filePath)}: ${error.message}`);
    return false;
  }
}

async function main() {
  const routesDir = path.join(__dirname, 'src/routes');
  const files = (await readdir(routesDir)).filter(f => f.endsWith('.js'));
  
  console.log('🔧 Fixing MySQL patterns in all route files...\n');
  
  let fixedCount = 0;
  
  for (const file of files) {
    const fixed = await fixFile(path.join(routesDir, file));
    if (fixed) fixedCount++;
  }
  
  console.log(`\n🎉 Fixed ${fixedCount} out of ${files.length} files`);
  console.log('📋 Backups created with .backup extension');
}

main().catch(console.error);
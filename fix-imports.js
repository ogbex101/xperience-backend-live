const fs = require('fs');
const path = require('path');

// Files to convert
const filesToConvert = [
  'server.js',
  'src/routes/auth.js',
  'src/routes/users.js', 
  'src/routes/tournaments.js',
  'src/routes/matches.js',
  'src/middleware/auth.js',
  'src/config/database.js',
  'src/services/socketService.js'
];

function convertFile(filePath) {
  try {
    const fullPath = path.join(__dirname, filePath);
    
    if (!fs.existsSync(fullPath)) {
      console.log(`❌ File not found: ${filePath}`);
      return;
    }

    let content = fs.readFileSync(fullPath, 'utf8');
    
    // Convert imports
    content = content.replace(/import\s+([^ ]+)\s+from\s+['"]([^'"]+)['"];/g, 'const $1 = require(\'$2\');');
    content = content.replace(/import\s+{\s*([^}]+)\s*}\s+from\s+['"]([^'"]+)['"];/g, 'const { $1 } = require(\'$2\');');
    content = content.replace(/import\s+\*\s+as\s+([^ ]+)\s+from\s+['"]([^'"]+)['"];/g, 'const $1 = require(\'$2\');');
    
    // Convert exports
    content = content.replace(/export\s+default\s+([^;]+);/g, 'module.exports = $1;');
    content = content.replace(/export\s+{\s*([^}]+)\s*};/g, 'module.exports = { $1 };');
    content = content.replace(/export\s+const\s+([^=;]+)=/g, 'const $1 =');
    content = content.replace(/export\s+function\s+([^(]+)/g, 'function $1');
    
    // Fix individual export statements
    const exportRegex = /export\s+{([^}]+)}/g;
    let match;
    while ((match = exportRegex.exec(content)) !== null) {
      const exports = match[1].split(',').map(e => e.trim()).join(', ');
      content = content.replace(match[0], `module.exports = { ${exports} };`);
    }

    fs.writeFileSync(fullPath, content, 'utf8');
    console.log(`✅ Converted: ${filePath}`);
    
  } catch (error) {
    console.log(`❌ Error converting ${filePath}:`, error.message);
  }
}

console.log('🔄 Converting ES6 modules to CommonJS...\n');

// Convert all files
filesToConvert.forEach(convertFile);

console.log('\n🎉 Conversion complete!');
console.log('📝 Now remove "type": "module" from package.json and restart your server.');
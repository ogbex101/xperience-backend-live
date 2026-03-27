// hash.js
const bcrypt = require('bcrypt');

async function generateHash() {
  const password = 'admin@2005';
  const hash = await bcrypt.hash(password, 10);
  console.log('Password:', password);
  console.log('Hash:', hash);
}

generateHash();
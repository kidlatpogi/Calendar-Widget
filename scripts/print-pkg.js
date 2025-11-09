const fs = require('fs');
const path = require('path');
const p = path.join(__dirname, '..', 'package.json');
const s = fs.readFileSync(p, 'utf8');
console.log('RAW PACKAGE.JSON:\n');
console.log(s);
try {
  const j = JSON.parse(s);
  console.log('\nPARSED version =', j.version);
} catch (e) {
  console.error('JSON parse error', e.message);
}

const fs = require('fs');
const path = require('path');
const EventParser = require('../lib/event-parser');
const resolved = require.resolve('../lib/event-parser');
console.log('require.resolve ->', resolved);
try {
	const disk = fs.readFileSync(resolved, 'utf8');
	console.log('\n--- disk file head (first 2000 chars) ---\n', disk.slice(0, 2000));
} catch (e) { console.log('could not read disk file', e.message); }
console.log('\n--- loaded parseIcal source (first 2000 chars) ---\n', EventParser.parseIcal.toString().slice(0, 2000));
console.log('\n--- loaded expandRecurringEvent source (first 2000 chars) ---\n', EventParser.expandRecurringEvent.toString().slice(0, 2000));

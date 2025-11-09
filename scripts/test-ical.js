const EventParser = require('../lib/event-parser');

const ics = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:3lee3vcboaqj5k5mfs0leh5b41@google.com
DTSTART;TZID=Asia/Manila:20251110T130000
DTEND;TZID=Asia/Manila:20251110T140000
RRULE:FREQ=WEEKLY;COUNT=3;BYDAY=MO
SUMMARY:Introduction to Human Computer Interaction
END:VEVENT
BEGIN:VEVENT
UID:3lee3vcboaqj5k5mfs0leh5b41@google.com
RECURRENCE-ID;TZID=Asia/Manila:20251110T130000
DTSTART;VALUE=DATE:20251110
SUMMARY:WALANG PASOK
END:VEVENT
END:VCALENDAR`;

// Also inspect raw VEVENT blocks and UID/RECURRENCE-ID matches
const eventMatches = ics.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g) || [];
console.log('RAW VEVENT COUNT:', eventMatches.length);
eventMatches.forEach((b,i) => {
	console.log('--- RAW EVENT', i+1);
	console.log(b);
	const uid = (b.match(/UID:(.+?)(?:\r?\n|$)/) || [])[1];
	const rid = (b.match(/RECURRENCE-ID(?:;[^:]*)?:(.+?)(?:\r?\n|$)/) || [])[1];
	console.log('UID raw:', uid);
	console.log('RECURRENCE-ID raw:', rid);
});

const parsed = EventParser.parseIcal(ics);
const util = require('util');
console.log('PARSED COUNT:', parsed.length);
parsed.forEach((p,i) => {
	console.log('---', i+1);
	console.log(util.inspect(p, { depth: null, colors: false }));
});

// Direct expansion test to validate expandRecurringEvent attaches uid
console.log('\nDirect expandRecurringEvent test:');
const baseEvent = {
	summary: 'Introduction to Human Computer Interaction',
	start: { dateTime: '2025-11-10T13:00:00' },
	end: { dateTime: '2025-11-10T14:00:00' }
};
const expanded = EventParser.expandRecurringEvent(baseEvent, 'FREQ=WEEKLY;COUNT=3;BYDAY=MO', '3lee3vcboaqj5k5mfs0leh5b41@google.com');
console.log('EXPANDED COUNT:', expanded.length);
expanded.forEach((e,i) => console.log(i+1, util.inspect(e, { depth: null })));

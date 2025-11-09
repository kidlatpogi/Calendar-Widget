const https = require('https');
const EventParser = require('../lib/event-parser');

const url = 'https://calendar.google.com/calendar/ical/5427e4bf32400f368524ecbafff579cfa90487c38667fdcfd9a90dc7bd8321fa%40group.calendar.google.com/private-1d896c8448b30ef01e7e9565121b0bf9/basic.ics';

function fetchText(u, cb) {
  https.get(u, res => {
    const { statusCode } = res;
    if (statusCode !== 200) { cb(new Error('HTTP ' + statusCode)); res.resume(); return; }
    let body = '';
    res.setEncoding('utf8');
    res.on('data', c => body += c);
    res.on('end', () => cb(null, body));
  }).on('error', cb);
}

fetchText(url, (err, ics) => {
  if (err) return console.error('fetch error', err.message);
  const parsed = EventParser.parseIcal(ics);
  const target = parsed.filter(ev => (ev.start && (ev.start.dateTime === '2025-11-10T13:00:00')));
  console.log('Parsed events with start=2025-11-10T13:00:00 count:', target.length);
  target.forEach((ev, i) => console.log(i+1, JSON.stringify(ev)));
});

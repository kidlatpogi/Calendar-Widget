const https = require('https');
const EventParser = require('../lib/event-parser');

const url = 'https://calendar.google.com/calendar/ical/5427e4bf32400f368524ecbafff579cfa90487c38667fdcfd9a90dc7bd8321fa%40group.calendar.google.com/private-1d896c8448b30ef01e7e9565121b0bf9/basic.ics';

function fetchText(u, cb) {
  https.get(u, res => {
    const { statusCode } = res;
    if (statusCode !== 200) {
      cb(new Error('HTTP ' + statusCode));
      res.resume();
      return;
    }
    let body = '';
    res.setEncoding('utf8');
    res.on('data', c => body += c);
    res.on('end', () => cb(null, body));
  }).on('error', cb);
}

fetchText(url, (err, ics) => {
  if (err) return console.error('fetch error', err.message);
  const parsed = EventParser.parseIcal(ics);
  const start = new Date('2025-11-09T00:00:00');
  const end = new Date('2025-11-11T23:59:59');
  const filtered = parsed.filter(ev => {
    const s = ev.start?.dateTime || ev.start?.date;
    if (!s) return false;
    const dt = new Date((s.length === 10) ? s + 'T00:00:00' : s);
    return dt >= start && dt <= end;
  });
  console.log('PARSED FOR 2025-11-09..11 COUNT:', filtered.length);
  filtered.forEach(ev => console.log(JSON.stringify(ev)));
});

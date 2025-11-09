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
  let withUid = 0, withoutUid = 0;
  const examplesWith = [], examplesWithout = [];
  for (const ev of parsed) {
    if (ev.uid) {
      withUid++;
      if (examplesWith.length < 5) examplesWith.push({ uid: ev.uid, summary: ev.summary, start: ev.start });
    } else {
      withoutUid++;
      if (examplesWithout.length < 5) examplesWithout.push({ summary: ev.summary, start: ev.start });
    }
  }
  console.log('parsed total:', parsed.length, 'withUid:', withUid, 'withoutUid:', withoutUid);
  console.log('examples with uid:', examplesWith);
  console.log('examples without uid:', examplesWithout);
});

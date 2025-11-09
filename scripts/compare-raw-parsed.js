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
  const blocks = ics.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g) || [];
  const parsed = EventParser.parseIcal(ics);
  console.log('raw blocks:', blocks.length, 'parsed events:', parsed.length);
  for (const b of blocks) {
    const rawUid = (b.match(/UID:(.+?)(?:\r?\n|$)/i) || [])[1];
    const rawDt = (b.match(/DTSTART(?:;[^:]*)?:(.+?)(?:\r?\n|$)/i) || [])[1];
    const parsedMatch = parsed.find(ev => {
      const s = ev.start?.dateTime || ev.start?.date;
      if (!s) return false;
      // normalize formats
      const norm = s.replace(/Z$/, '').split('T')[0];
      const rawNorm = (rawDt || '').replace(/Z$/, '').split('T')[0];
      return String(norm) === String(rawNorm);
    });
    console.log('BLOCK UID=', rawUid, 'DTSTART=', rawDt, ' -> parsed has uid=', parsedMatch && parsedMatch.uid);
  }
});
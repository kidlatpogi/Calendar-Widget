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

function extractUidLocal(block) {
  if (!block) return null;
  const lines = block.split(/\r?\n/);
  const uidLine = lines.find(l => /^\s*UID\b\s*:/i.test(l));
  if (uidLine) return uidLine.split(':').slice(1).join(':').trim();
  const m = block.match(/UID:(.+?)(?:\r?\n|$)/i);
  return m && m[1] ? m[1].trim() : null;
}

function normalizeDateStr(s) {
  if (!s) return null;
  return String(s).replace(/Z$/, '').split('T')[0];
}

fetchText(url, (err, ics) => {
  if (err) return console.error('fetch error', err.message);
  const blocks = ics.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g) || [];
  const parsed = EventParser.parseIcal(ics);
  console.log('blocks', blocks.length, 'parsed', parsed.length);
  let mapped = 0, mappedWithUid = 0, mappedWithoutUid = 0;
  for (let i = 0; i < Math.min(50, blocks.length); i++) {
    const b = blocks[i];
    const rawUid = extractUidLocal(b);
    const summary = (b.match(/SUMMARY:(.+?)(?:\r?\n|$)/i) || [])[1] || '';
    const dt = (b.match(/DTSTART(?:;[^:]*)?:(.+?)(?:\r?\n|$)/i) || [])[1] || '';
    const norm = normalizeDateStr(dt);
    // try to find a parsed event with same summary and same normalized start
    const match = parsed.find(ev => {
      const s = ev.start?.dateTime || ev.start?.date;
      if (!s) return false;
      const evNorm = normalizeDateStr(s);
      // summary may differ in case/whitespace; compare lowercased prefix
      if (!ev.summary || !summary) return false;
      if (ev.summary.toLowerCase().includes(summary.trim().toLowerCase()) || summary.trim().toLowerCase().includes(ev.summary.toLowerCase())) {
        return evNorm === norm;
      }
      return false;
    });
    if (match) {
      mapped++;
      if (match.uid) mappedWithUid++; else mappedWithoutUid++;
      console.log('block', i, 'rawUid=', rawUid, 'start=', norm, 'parsed.uid=', match.uid, 'summary=', match.summary);
    }
  }
  console.log('mapped', mapped, 'withUid', mappedWithUid, 'withoutUid', mappedWithoutUid);
});

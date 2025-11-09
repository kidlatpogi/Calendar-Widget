const https = require('https');

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

function extractUid(block) {
  if (!block) return null;
  const lines = block.split(/\r?\n/);
  const uidLine = lines.find(l => /^\s*UID\b\s*:/i.test(l));
  if (uidLine) return uidLine.split(':').slice(1).join(':').trim();
  const m = block.match(/UID:(.+?)(?:\r?\n|$)/i);
  return m && m[1] ? m[1].trim() : null;
}

fetchText(url, (err, ics) => {
  if (err) return console.error('fetch error', err.message);
  const matches = ics.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g) || [];
  console.log('Total VEVENT blocks:', matches.length);
  for (let i = 0; i < matches.length; i++) {
    const b = matches[i];
    const uid = extractUid(b);
    if (!uid) continue;
    console.log('Found UID at VEVENT', i+1, ':', uid);
    if (/Introduction to Human Computer Interaction/i.test(b)) {
      console.log('  This is HCI event; lines:');
      b.split(/\r?\n/).forEach(l => console.log('   ', l));
    }
  }
});

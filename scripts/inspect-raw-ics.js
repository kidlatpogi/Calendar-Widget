const https = require('https');

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
  const eventMatches = ics.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g) || [];
  console.log('RAW VEVENT COUNT:', eventMatches.length);
  eventMatches.forEach((b, i) => {
    console.log('\n--- RAW EVENT', i+1);
    // print first 20 lines to keep output small
    console.log(b.split(/\r?\n/).slice(0, 20).join('\n'));
    const uid = (b.match(/UID:(.+?)(?:\r?\n|$)/) || [])[1];
    const rid = (b.match(/RECURRENCE-ID(?:;[^:]*)?:(.+?)(?:\r?\n|$)/) || [])[1];
    const dt = (b.match(/DTSTART(?:;[^:]*)?:(.+?)(?:\r?\n|$)/) || [])[1];
    console.log('UID raw:', uid);
    console.log('RECURRENCE-ID raw:', rid);
    console.log('DTSTART raw:', dt);
  });
});

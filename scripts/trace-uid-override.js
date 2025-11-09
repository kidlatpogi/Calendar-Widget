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
  const targets = [];
  for (const b of eventMatches) {
    const summary = (b.match(/SUMMARY:(.+?)(?:\r?\n|$)/) || [])[1];
    if (!summary) continue;
    if (summary.includes('Human Computer Interaction')) {
      const uid = (b.match(/UID:(.+?)(?:\r?\n|$)/) || [])[1];
      const rrule = (b.match(/RRULE:(.+?)(?:\r?\n|$)/) || [])[1];
      const dtstart = (b.match(/DTSTART(?:;[^:]*)?:(.+?)(?:\r?\n|$)/) || [])[1];
      const rid = (b.match(/RECURRENCE-ID(?:;[^:]*)?:(.+?)(?:\r?\n|$)/) || [])[1];
      targets.push({ uid, summary, rrule, dtstart, rid, raw: b });
    }
  }
  console.log('FOUND TARGET VEVENTS:', targets.length);
  for (const t of targets) {
    console.log('\n--- VEVENT');
    console.log('UID:', t.uid);
    console.log('SUMMARY:', t.summary);
    console.log('RRULE:', t.rrule);
    console.log('DTSTART:', t.dtstart);
    console.log('RECURRENCE-ID:', t.rid);
    console.log('RAW (first 12 lines):\n', t.raw.split(/\r?\n/).slice(0,12).join('\n'));
  }

  // find all override VEVENTs (have RECURRENCE-ID)
  const overrides = [];
  for (const b of eventMatches) {
    const rid = (b.match(/RECURRENCE-ID(?:;[^:]*)?:(.+?)(?:\r?\n|$)/) || [])[1];
    if (!rid) continue;
    const uid = (b.match(/UID:(.+?)(?:\r?\n|$)/) || [])[1];
    const dt = (b.match(/DTSTART(?:;[^:]*)?:(.+?)(?:\r?\n|$)/) || [])[1];
    const summary = (b.match(/SUMMARY:(.+?)(?:\r?\n|$)/) || [])[1];
    overrides.push({ uid, rid, dt, summary, raw: b });
  }
  console.log('\nFOUND OVERRIDE COUNT:', overrides.length);
  // show overrides that match any target uid
  for (const o of overrides) {
    for (const t of targets) {
      if (o.uid && t.uid && o.uid === t.uid) {
        console.log('\n-- OVERRIDE for target UID');
        console.log('UID:', o.uid, 'RID:', o.rid, 'DTSTART:', o.dt, 'SUMMARY:', o.summary);
        console.log('RAW (first 12 lines):\n', o.raw.split(/\r?\n/).slice(0,12).join('\n'));
      }
    }
  }
});

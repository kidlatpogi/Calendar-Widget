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
  const matches = ics.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g) || [];
  const uid = '3lee3vcboaqj5k5mfs0leh5b41@google.com';
  const block = matches.find(m => new RegExp('UID:\\s*'+uid.replace(/\./g,'\\.'),'i').test(m) && /RRULE:/i.test(m));
  if (!block) return console.error('No RRULE block for uid');
  const dtStart = (block.match(/DTSTART(?:;[^:]*)?:(.+?)(?:\r?\n|$)/i) || [])[1];
  const dtEnd = (block.match(/DTEND(?:;[^:]*)?:(.+?)(?:\r?\n|$)/i) || [])[1];
  const rrule = (block.match(/RRULE:(.+?)(?:\r?\n|$)/i) || [])[1];
  const seriesUid = (block.match(/UID:(.+?)(?:\r?\n|$)/i) || [])[1];
  console.log('base dtStart', dtStart, 'dtEnd', dtEnd, 'rrule', rrule, 'uid', seriesUid);
  const baseEvent = {
    summary: (block.match(/SUMMARY:(.+?)(?:\r?\n|$)/i) || [])[1] || 'No title',
    start: { dateTime: EventParser._parseIcalDateTime(dtStart) },
    end: dtEnd ? { dateTime: EventParser._parseIcalDateTime(dtEnd) } : undefined
  };
  const expanded = EventParser.expandRecurringEvent(baseEvent, rrule, seriesUid);
  console.log('expanded count', expanded.length);
  expanded.forEach((e, i) => console.log(i+1, 'uid=', e.uid, 'start=', e.start && (e.start.dateTime || e.start.date)));
});

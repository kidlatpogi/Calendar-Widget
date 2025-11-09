// lib/event-parser.js - iCal event parsing and recurring event expansion
class EventParser {
    /**
     * Parse iCal text and return array of events
     */
    static parseIcal(icsText) {
        const events = [];
        try {
            const eventMatches = icsText.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g) || [];
            for (const eventBlock of eventMatches) {
                // Skip cancelled events (deleted in Google Calendar) so they are not returned
                // to the renderer. STATUS:CANCELLED is used by many calendar providers
                // to indicate a deleted event.
                if (/^STATUS:CANCELLED$/im.test(eventBlock)) continue;

                const event = {};

                const summaryMatch = eventBlock.match(/SUMMARY:(.+?)(?:\r?\n|$)/);
                event.summary = summaryMatch ? summaryMatch[1].trim() : 'No title';
                
                // Only store necessary fields to minimize memory
                const dtStartMatch = eventBlock.match(/DTSTART(?:;[^:]*)?:(.+?)(?:\r?\n|$)/);
                if (dtStartMatch) {
                    const dtStr = dtStartMatch[1].trim();
                    if (dtStr.includes('T')) {
                        event.start = { dateTime: EventParser._parseIcalDateTime(dtStr) };
                    } else {
                        event.start = { date: EventParser._formatIcalDate(dtStr) };
                    }
                }
                
                const dtEndMatch = eventBlock.match(/DTEND(?:;[^:]*)?:(.+?)(?:\r?\n|$)/);
                if (dtEndMatch) {
                    const dtStr = dtEndMatch[1].trim();
                    if (dtStr.includes('T')) {
                        event.end = { dateTime: EventParser._parseIcalDateTime(dtStr) };
                    } else {
                        event.end = { date: EventParser._formatIcalDate(dtStr) };
                    }
                }
                
                // Parse EXDATE lines (explicit excluded occurrences) so expanded recurring
                // events don't include instances that have been removed.
                const exdateMatches = Array.from(eventBlock.matchAll(/EXDATE(?:;[^:]*)?:(.+?)(?:\r?\n|$)/g)) || [];
                const exdates = new Set();
                for (const m of exdateMatches) {
                    if (m && m[1]) {
                        // Normalize to YYYY-MM-DD or full date-time without Z
                        const raw = m[1].trim().replace(/Z$/, '');
                        // Split when multiple dates are on the same EXDATE line
                        for (const part of raw.split(',')) {
                            exdates.add(part.trim());
                        }
                    }
                }

                // Check for recurring event (RRULE)
                const rruleMatch = eventBlock.match(/RRULE:(.+?)(?:\r?\n|$)/);
                if (rruleMatch && event.start) {
                    // Expand recurring events; filter out any occurrences matching EXDATE
                    const expandedEvents = EventParser.expandRecurringEvent(event, rruleMatch[1].trim());
                    if (exdates.size > 0) {
                        // Normalize expanded event start strings for comparison
                        const filtered = expandedEvents.filter(ev => {
                            const s = ev.start?.dateTime || ev.start?.date;
                            if (!s) return true;
                            const normalized = s.replace(/Z$/, '');
                            return !exdates.has(normalized) && !exdates.has(normalized.split('T')[0]);
                        });
                        events.push(...filtered);
                    } else {
                        events.push(...expandedEvents);
                    }
                } else {
                    // Only push if we have at least summary or start date (avoid empty events)
                    if ((event.summary && event.summary !== 'No title') || event.start) {
                        events.push(event);
                    }
                }
            }
        } catch (e) {
            console.warn('iCal parse error:', e.message);
        }
        return events;
    }

    /**
     * Expand a recurring event based on RRULE
     */
    static expandRecurringEvent(baseEvent, rruleStr) {
        const expanded = [];
        try {
            // Parse RRULE components
            const rruleParts = {};
            rruleStr.split(';').forEach(part => {
                const [key, value] = part.split('=');
                if (key && value) rruleParts[key] = value;
            });
            
            const freq = rruleParts['FREQ'];
            const count = parseInt(rruleParts['COUNT']) || 14; // Default to 14 occurrences (2 weeks) for memory
            const interval = parseInt(rruleParts['INTERVAL']) || 1;
            
            if (!freq || !baseEvent.start) return [baseEvent];
            
            // Get start date/time
            const startStr = baseEvent.start.dateTime || baseEvent.start.date;
            if (!startStr) return [baseEvent];
            
            const baseDate = new Date(startStr);
            if (isNaN(baseDate.getTime())) return [baseEvent];
            
            // Calculate duration if end time exists
            let duration = 0;
            if (baseEvent.end) {
                const endStr = baseEvent.end.dateTime || baseEvent.end.date;
                const endDate = new Date(endStr);
                if (!isNaN(endDate.getTime())) {
                    duration = endDate.getTime() - baseDate.getTime();
                }
            }
            
            // Expand based on frequency (limit to 2 weeks max for memory efficiency)
            const maxOccurrences = Math.min(count, 14);
            for (let i = 0; i < maxOccurrences; i++) {
                const occurrenceDate = new Date(baseDate);
                
                // Add interval based on frequency
                if (freq === 'DAILY') {
                    occurrenceDate.setDate(baseDate.getDate() + (i * interval));
                } else if (freq === 'WEEKLY') {
                    occurrenceDate.setDate(baseDate.getDate() + (i * interval * 7));
                } else if (freq === 'MONTHLY') {
                    occurrenceDate.setMonth(baseDate.getMonth() + (i * interval));
                } else if (freq === 'YEARLY') {
                    occurrenceDate.setFullYear(baseDate.getFullYear() + (i * interval));
                } else {
                    // Unsupported frequency, just return base event
                    return [baseEvent];
                }
                
                // Create occurrence event
                const occurrence = {
                    summary: baseEvent.summary,
                    start: null,
                    end: null
                };
                
                // Format start time
                if (baseEvent.start.dateTime) {
                    const y = occurrenceDate.getFullYear();
                    const m = String(occurrenceDate.getMonth() + 1).padStart(2, '0');
                    const d = String(occurrenceDate.getDate()).padStart(2, '0');
                    const hh = String(occurrenceDate.getHours()).padStart(2, '0');
                    const mm = String(occurrenceDate.getMinutes()).padStart(2, '0');
                    const ss = String(occurrenceDate.getSeconds()).padStart(2, '0');
                    occurrence.start = { dateTime: `${y}-${m}-${d}T${hh}:${mm}:${ss}` };
                    
                    // Calculate end time
                    if (duration > 0) {
                        const endDate = new Date(occurrenceDate.getTime() + duration);
                        const ey = endDate.getFullYear();
                        const em = String(endDate.getMonth() + 1).padStart(2, '0');
                        const ed = String(endDate.getDate()).padStart(2, '0');
                        const ehh = String(endDate.getHours()).padStart(2, '0');
                        const emm = String(endDate.getMinutes()).padStart(2, '0');
                        const ess = String(endDate.getSeconds()).padStart(2, '0');
                        occurrence.end = { dateTime: `${ey}-${em}-${ed}T${ehh}:${emm}:${ess}` };
                    }
                } else {
                    // All-day event
                    const y = occurrenceDate.getFullYear();
                    const m = String(occurrenceDate.getMonth() + 1).padStart(2, '0');
                    const d = String(occurrenceDate.getDate()).padStart(2, '0');
                    occurrence.start = { date: `${y}-${m}-${d}` };
                    
                    if (duration > 0) {
                        const endDate = new Date(occurrenceDate.getTime() + duration);
                        const ey = endDate.getFullYear();
                        const em = String(endDate.getMonth() + 1).padStart(2, '0');
                        const ed = String(endDate.getDate()).padStart(2, '0');
                        occurrence.end = { date: `${ey}-${em}-${ed}` };
                    }
                }
                
                expanded.push(occurrence);
            }
        } catch (e) {
            console.warn('RRULE expansion error:', e.message);
            return [baseEvent];
        }
        
        return expanded.length > 0 ? expanded : [baseEvent];
    }

    static _formatIcalDate(dateStr) {
        if (!dateStr || dateStr.length < 8) return null;
        const y = dateStr.substring(0, 4);
        const m = dateStr.substring(4, 6);
        const d = dateStr.substring(6, 8);
        return `${y}-${m}-${d}`;
    }

    static _parseIcalDateTime(dtStr) {
        try {
            const cleanStr = dtStr.replace(/Z$/, '');
            if (cleanStr.length === 8) {
                return `${cleanStr.substring(0, 4)}-${cleanStr.substring(4, 6)}-${cleanStr.substring(6, 8)}T00:00:00`;
            }
            if (cleanStr.includes('T')) {
                const [date, time] = cleanStr.split('T');
                const y = date.substring(0, 4);
                const m = date.substring(4, 6);
                const d = date.substring(6, 8);
                const hh = time.substring(0, 2) || '00';
                const mm = time.substring(2, 4) || '00';
                const ss = time.substring(4, 6) || '00';
                return `${y}-${m}-${d}T${hh}:${mm}:${ss}`;
            }
        } catch (e) { /* ignore */ }
        return dtStr;
    }
}

module.exports = EventParser;

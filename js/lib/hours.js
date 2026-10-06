const TZ = {
  VIC: 'Australia/Melbourne', NSW: 'Australia/Sydney', ACT: 'Australia/Sydney', TAS: 'Australia/Hobart',
  QLD: 'Australia/Brisbane', SA: 'Australia/Adelaide', WA: 'Australia/Perth', NT: 'Australia/Darwin',
};
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Parses strings like "9.00am to 5.00pm Mon to Fri".
export function parseHours(str) {
  const m = (str || '').match(/(\d{1,2})[.:](\d{2})\s*(am|pm)\s*to\s*(\d{1,2})[.:](\d{2})\s*(am|pm)/i);
  if (!m) return null;
  const toMin = (h, mi, ap) => ((+h % 12) + (ap.toLowerCase() === 'pm' ? 12 : 0)) * 60 + +mi;
  return { open: toMin(m[1], m[2], m[3]), close: toMin(m[4], m[5], m[6]), days: [1, 2, 3, 4, 5] };
}

export function fmtTime(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')}${h < 12 ? 'am' : 'pm'}`;
}

function localNow(tz, now) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(now).map(p => [p.type, p.value]),
  );
  return { day: DAYS.indexOf(parts.weekday), minutes: (+parts.hour % 24) * 60 + +parts.minute };
}

// → { state: 'open' | 'closed' | 'appointment', label, detail }
export function openStatus(loc, now = new Date()) {
  const h = parseHours(loc.hours);
  if (!h) return { state: 'appointment', label: 'By appointment', detail: '' };
  const byAppt = /appointment only/i.test(loc.hours);
  const { day, minutes } = localNow(TZ[loc.state] || 'Australia/Sydney', now);
  const openToday = h.days.includes(day);

  if (openToday && minutes >= h.open && minutes < h.close) {
    return { state: 'open', label: byAppt ? 'Open by appointment' : 'Open now', detail: `Closes ${fmtTime(h.close)}` };
  }
  if (openToday && minutes < h.open) {
    return { state: 'closed', label: 'Closed', detail: `Opens ${fmtTime(h.open)}` };
  }
  for (let i = 1; i <= 7; i++) {
    const d = (day + i) % 7;
    if (h.days.includes(d)) {
      return { state: 'closed', label: 'Closed', detail: `Opens ${fmtTime(h.open)} ${i === 1 ? 'tomorrow' : DAYS[d]}` };
    }
  }
  return { state: 'closed', label: 'Closed', detail: '' };
}

export function hoursSummary(loc) {
  const h = parseHours(loc.hours);
  if (!h) return 'Consultant visits by appointment';
  return `Mon–Fri, ${fmtTime(h.open)} – ${fmtTime(h.close)}`;
}

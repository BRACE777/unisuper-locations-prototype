// Illustrative content for the prototype: services, appointment slots and events.
// None of this comes from UniSuper systems — it shows what the UI could surface.

const hash = s => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

export function servicesFor(loc) {
  if (loc.type === 'office') {
    const appointmentOnly = /appointment only/i.test(loc.hours || '');
    return {
      walkIn: !appointmentOnly,
      appointmentOnly,
      tags: ['Financial advice', 'Super consultants', appointmentOnly ? 'Appointment only' : 'Walk-ins welcome'],
      note: /bookings recommended/i.test(loc.hours || '') ? 'Bookings recommended' : '',
    };
  }
  return {
    walkIn: false,
    appointmentOnly: true,
    tags: ['Super consultant on campus', 'Appointment only'],
    note: `Consultant on campus ${campusDaysLabel(loc)}`,
  };
}

const EVENTS = [
  { at: 'mel-office', title: 'Retirement planning seminar', days: 6, time: '10:00am', format: 'In person' },
  { at: 'mel-office', title: 'Transition to retirement explained', days: 20, time: '12:30pm', format: 'In person + live stream' },
  { at: 'syd-office', title: 'Transition to retirement explained', days: 9, time: '12:30pm', format: 'In person' },
  { at: 'bne-office', title: 'Planning for retirement in your 50s', days: 7, time: '10:00am', format: 'In person' },
  { at: 'adl-main', title: 'Contribution strategies', days: 4, time: '12:00pm', format: 'In person' },
  { at: 'per-office', title: 'Retirement planning seminar', days: 14, time: '10:00am', format: 'In person' },
  { at: 'unimelb', title: 'Super basics for new staff', days: 3, time: '12:00pm', format: 'On campus' },
  { at: 'monash', title: 'Super basics for new staff', days: 12, time: '1:00pm', format: 'On campus' },
  { at: 'unsw', title: 'Salary sacrifice & contributions', days: 5, time: '12:30pm', format: 'On campus' },
  { at: 'uq', title: 'Investment options explained', days: 8, time: '12:00pm', format: 'On campus' },
  { at: 'anu', title: 'Super basics for new staff', days: 10, time: '12:00pm', format: 'On campus' },
  { at: 'uwa', title: 'Investment options explained', days: 15, time: '12:30pm', format: 'On campus' },
];

const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const dayLabel = d => d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });

export function eventsFor(id, now = new Date()) {
  return EVENTS.filter(e => e.at === id).map(e => ({ ...e, date: addDays(now, e.days), dateLabel: dayLabel(addDays(now, e.days)) }));
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Weekdays a consultant visits a campus (illustrative, stable per campus).
export function campusDays(loc) {
  const h = hash(loc.id);
  return [...new Set([1 + (h % 5), 1 + ((h >> 3) % 5)])].sort();
}
export const campusDaysLabel = loc => campusDays(loc).map(d => WEEKDAYS[d]).join(' & ');

const TIMES =['9:30am', '10:00am', '11:00am', '11:30am', '1:00pm', '1:30pm', '2:30pm', '3:30pm'];

// Offices: next 3 business days. Campuses: consultant visits two weekdays a week.
export function slotsFor(loc, now = new Date()) {
  const visitDays = campusDays(loc);
  const days = [];
  for (let i = 1; days.length < 3 && i < 21; i++) {
    const d = addDays(now, i);
    const wd = d.getDay();
    if (wd === 0 || wd === 6) continue;
    if (loc.type === 'campus' && !visitDays.includes(wd)) continue;
    const seed = hash(loc.id + d.toDateString());
    const times = TIMES.filter((_, t) => (seed >> t) & 1).slice(0, 3);
    days.push({ date: d, label: dayLabel(d), times: times.length ? times : [TIMES[seed % TIMES.length]] });
  }
  return days;
}

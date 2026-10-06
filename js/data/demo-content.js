// Illustrative content for the prototype: services and campus visit days.
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

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Weekdays a consultant visits a campus (illustrative, stable per campus).
export function campusDays(loc) {
  const h = hash(loc.id);
  return [...new Set([1 + (h % 5), 1 + ((h >> 3) % 5)])].sort();
}
export const campusDaysLabel = loc => campusDays(loc).map(d => WEEKDAYS[d]).join(' & ');

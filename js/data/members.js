// Fictional members for the personalisation demo. All names, addresses and contact
// details are made up. In production these come from the member's authenticated
// profile (member view) or the CRM (consultant view) — never from a public lookup.
import { byId } from './locations.js';

export const MEMBERS = [
  {
    number: '10000001', firstName: 'Alex', lastName: 'Chen',
    email: 'alex.chen@example.com', mobile: '0491 570 156', preferred: 'email',
    home: { line: '12 Sample Street', suburb: 'Geelong', state: 'VIC', postcode: '3220', lat: -38.1471, lng: 144.3607 },
    postal: null,
    employer: { name: 'Deakin University', locationId: 'deakin' },
    accessibility: '',
    appointment: { locationId: 'mel-office', days: 5, time: '10:00am', format: 'In person', topic: 'Transition to retirement' },
    lastContact: 'Phone · 12 Sep 2026 · Asked about transition to retirement',
  },
  {
    number: '10000002', firstName: 'Priya', lastName: 'Sharma',
    email: 'priya.sharma@example.com', mobile: '0491 570 157', preferred: 'sms',
    home: { line: '4/88 Demo Road', suburb: 'Newtown', state: 'NSW', postcode: '2042', lat: -33.8978, lng: 151.1794 },
    postal: null,
    employer: { name: 'University of Sydney', locationId: 'usyd' },
    accessibility: 'Uses a wheelchair — confirm step-free access before booking in person.',
    appointment: null,
    lastContact: 'Email · 28 Aug 2026 · Contribution caps question',
  },
  {
    number: '10000003', firstName: 'Jordan', lastName: 'Lee',
    email: 'jordan.lee@example.com', mobile: '0491 570 158', preferred: 'phone',
    home: { line: '230 Placeholder Lane', suburb: 'Toowoomba', state: 'QLD', postcode: '4350', lat: -27.5606, lng: 151.9539 },
    postal: { line: 'PO Box 456', suburb: 'Brisbane', state: 'QLD', postcode: '4001', lat: -27.4679, lng: 153.0281 },
    employer: { name: 'University of Queensland', locationId: 'uq' },
    accessibility: '',
    appointment: null,
    lastContact: 'Phone · 3 Oct 2026 · Wants to meet in person when next in Brisbane',
  },
  {
    number: '10000004', firstName: 'Sam', lastName: 'Taylor',
    email: 'sam.taylor@example.com', mobile: '0491 570 159', preferred: 'email',
    home: { line: '7 Mock Court', suburb: 'Albany', state: 'WA', postcode: '6330', lat: -35.0228, lng: 117.8814 },
    postal: null,
    employer: { name: 'The University of Western Australia', locationId: 'uwa' },
    accessibility: '',
    appointment: null,
    lastContact: 'Video · 19 Jul 2026 · Prefers video appointments (regional)',
  },
  {
    number: '10000005', firstName: 'Morgan', lastName: 'Ng',
    email: 'morgan.ng@example.com', mobile: '0491 570 110', preferred: 'sms',
    home: { line: '55 Example Esplanade', suburb: 'Glenelg', state: 'SA', postcode: '5045', lat: -34.9806, lng: 138.5156 },
    postal: null,
    employer: { name: 'Flinders University', locationId: 'flinders' },
    accessibility: 'Requires a Cantonese interpreter — book with interpreter service.',
    appointment: { locationId: 'adl-main', days: 9, time: '1:30pm', format: 'In person', topic: 'Retirement income options' },
    lastContact: 'Phone (interpreter) · 30 Sep 2026 · Booked retirement income meeting',
  },
];

export const findMember = number => MEMBERS.find(m => m.number === String(number).replace(/\D/g, ''));

export function searchMembers(q) {
  const s = q.trim().toLowerCase();
  if (!s) return [];
  const digits = s.replace(/\D/g, '');
  return MEMBERS.filter(m => (digits && m.number.startsWith(digits))
    || `${m.firstName} ${m.lastName}`.toLowerCase().includes(s));
}

export const maskNumber = n => `${n.slice(0, 2)}•••${n.slice(-2)}`;
export const maskEmail = e => e.replace(/^(.).*(@.*)$/, '$1•••$2');
export const maskMobile = m => m.replace(/^(\d{2})\d{2} \d{3} (\d{3})$/, '$1•• ••• $2');
export const fullName = m => `${m.firstName} ${m.lastName}`;
export const suburbLabel = a => `${a.suburb} ${a.state} ${a.postcode}`;
export const fullAddress = a => `${a.line}, ${suburbLabel(a)}`;

// kind: 'home' | 'postal' | 'work' | 'member-number'
export function memberOrigin(m, kind) {
  if (kind === 'work') {
    const loc = byId(m.employer.locationId);
    return { lat: loc.lat, lng: loc.lng, source: 'work', label: m.employer.name, detail: loc.lines.join(', ') };
  }
  const a = kind === 'postal' && m.postal ? m.postal : m.home;
  return { lat: a.lat, lng: a.lng, source: kind, label: suburbLabel(a), detail: fullAddress(a) };
}

export function appointmentInfo(appt, now = new Date()) {
  if (!appt) return null;
  let label = appt.dateLabel;
  if (!label) {
    const d = new Date(now);
    d.setDate(d.getDate() + appt.days);
    while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
    label = d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
  }
  return { ...appt, dateLabel: label, location: byId(appt.locationId) };
}

export const CONSULTANT = { name: 'Jamie Rivera', role: 'Member Services Consultant', initials: 'JR' };

export const ACCESS_REASONS = ['Inbound phone call', 'Email enquiry', 'Scheduled callback', 'Complaint follow-up'];

// Lets the search box work for a handful of postcodes before a Google key is added.
export const OFFLINE_POSTCODES = {
  '3000': ['Melbourne VIC 3000', -37.8136, 144.9631],
  '2000': ['Sydney NSW 2000', -33.8688, 151.2093],
  '4000': ['Brisbane QLD 4000', -27.4698, 153.0251],
  '5000': ['Adelaide SA 5000', -34.9285, 138.6007],
  '6000': ['Perth WA 6000', -31.9523, 115.8613],
  '2600': ['Canberra ACT 2600', -35.3075, 149.1244],
  '7000': ['Hobart TAS 7000', -42.8821, 147.3272],
  ...Object.fromEntries(MEMBERS.map(m => [m.home.postcode, [suburbLabel(m.home), m.home.lat, m.home.lng]])),
};

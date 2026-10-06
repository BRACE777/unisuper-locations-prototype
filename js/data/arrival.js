// Sample arrival information and direct phone numbers. NOT sourced from UniSuper —
// facilities teams would supply and maintain the real content. Phone numbers use the
// ACMA range reserved for fiction ((0X) 5550 xxxx) so nobody dials a real person.
import { LOCATIONS } from './locations.js';
import { campusDaysLabel } from './demo-content.js';

const AREA = { VIC: '03', TAS: '03', NSW: '02', ACT: '02', QLD: '07', SA: '08', WA: '08', NT: '08' };

export function phoneFor(loc) {
  const n = String(100 + LOCATIONS.indexOf(loc)).padStart(4, '0');
  return `(${AREA[loc.state]}) 5550 ${n}`;
}

const OFFICES = {
  'mel-office': {
    entrance: 'Enter from Bourke Street and take the lifts to Level 1. Reception is opposite the lifts.',
    parking: 'No visitor parking on site. Several paid public car parks within a 5-minute walk.',
    transit: 'Trams 86 and 96 stop on Bourke Street at Elizabeth Street. Melbourne Central station is about a 5-minute walk.',
    access: 'Step-free entry, lift to Level 1, accessible toilets on the floor.',
    arrival: 'Walk-ins welcome for general enquiries. Sign in at reception.',
  },
  'syd-office': {
    entrance: 'Gateway building, 1 Macquarie Place. Lifts to Level 28.',
    parking: 'No visitor parking. Paid public car parks nearby in Circular Quay.',
    transit: 'Circular Quay station, ferries and light rail are about a 3-minute walk.',
    access: 'Step-free entry and lifts. Accessible toilets on Level 28.',
    arrival: 'Sign in with building security on the ground floor, then UniSuper reception on Level 28.',
  },
  'bne-office': {
    entrance: 'Enter from Queen Street and take the lifts to Level 16.',
    parking: 'No visitor parking. Paid public car parks within a short walk in the CBD.',
    transit: 'Central station and Queen Street bus station are each about a 5-minute walk.',
    access: 'Step-free entry, lifts, accessible toilets.',
    arrival: 'Walk-ins welcome for general enquiries. Sign in at reception on Level 16.',
  },
  'cbr-office': {
    entrance: 'Enter from Marcus Clarke Street. UniSuper is on Level 1.',
    parking: 'Paid street parking and public car parks in Civic.',
    transit: 'Alinga Street light rail stop and the City bus interchange are about a 5-minute walk.',
    access: 'Step-free entry and lift to Level 1.',
    arrival: 'Walk-ins welcome for general enquiries. Sign in at reception.',
  },
  'adl-main': {
    entrance: 'Enter from King William Street and take the lifts to Level 8.',
    parking: 'No visitor parking. Paid public car parks off North Terrace.',
    transit: 'Tram stop at King William Street / North Terrace is outside. Adelaide Railway Station is about a 3-minute walk.',
    access: 'Step-free entry, lifts, accessible toilets.',
    arrival: 'Bookings recommended. Sign in at reception on Level 8.',
  },
  'adl-north-terrace': {
    entrance: 'Ground-floor entry from North Terrace.',
    parking: 'Limited paid street parking on North Terrace. Public car parks nearby.',
    transit: 'Trams stop along North Terrace, a short walk from the door.',
    access: 'Step-free ground-floor access.',
    arrival: 'By appointment only. Please book ahead. The door may be locked outside appointment times.',
  },
  'per-office': {
    entrance: 'Enter from St Georges Terrace and take the lifts to Level 15.',
    parking: 'No visitor parking. Paid public car parks within a short walk in the CBD.',
    transit: 'Elizabeth Quay station is about a 5-minute walk. Buses run along St Georges Terrace.',
    access: 'Step-free entry, lifts, accessible toilets.',
    arrival: 'Walk-ins welcome for general enquiries. Sign in at reception on Level 15.',
  },
};

export function arrivalFor(loc) {
  if (OFFICES[loc.id]) return OFFICES[loc.id];
  const room = loc.lines.slice(0, -1).join(', ');
  return {
    entrance: `${room}. Use the university's campus map to find the building.`,
    parking: 'Paid visitor parking on campus. Spaces fill quickly during semester.',
    transit: 'See the university\'s transport page for the nearest bus or train stop.',
    access: 'Most university buildings have lift access. Let us know when booking if you need assistance.',
    arrival: `A consultant is on campus ${campusDaysLabel(loc)}. Appointments are needed: book ahead and come straight to the room.`,
  };
}

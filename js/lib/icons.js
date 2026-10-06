const PATHS = {
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  locate: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  car: '<path d="M5 11l1.6-4.2A2 2 0 0 1 8.5 5.5h7a2 2 0 0 1 1.9 1.3L19 11"/><rect x="3" y="11" width="18" height="6" rx="2"/><path d="M6 17v2M18 17v2"/><circle cx="7.5" cy="14" r=".9" fill="currentColor"/><circle cx="16.5" cy="14" r=".9" fill="currentColor"/>',
  transit: '<rect x="6" y="3" width="12" height="13" rx="3"/><path d="M6 10h12M9 20l1.5-4M15 20l-1.5-4"/><circle cx="9.5" cy="13" r=".8" fill="currentColor"/><circle cx="14.5" cy="13" r=".8" fill="currentColor"/>',
  walk: '<circle cx="13" cy="4.5" r="1.8"/><path d="M10.5 21l2-6-2.5-3 1-4.5 3 3.5 3 1M10.5 8L7.5 10l-1 3.5M12.5 15l2.5 6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  pin: '<path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/>',
  video: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10.5l5-3v9l-5-3z"/>',
  back: '<path d="M15 18l-6-6 6-6"/>',
  directions: '<path d="M12 2.5l9.5 9.5-9.5 9.5L2.5 12z"/><path d="M9.5 14v-2.5h5M12.5 9l2.5 2.5-2.5 2.5"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  building: '<rect x="5" y="3" width="14" height="18" rx="1"/><path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2M10 21v-3h4v3"/>',
  cap: '<path d="M2 9l10-5 10 5-10 5z"/><path d="M6 11v5c3 2 9 2 12 0v-5M22 9v5"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-5h4v5"/>',
  check: '<path d="M5 12l5 5L20 7"/>',
  sliders: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
  access: '<circle cx="11" cy="4" r="1.8"/><path d="M11 7v6h5l2.5 5M11 10h4.5"/><path d="M8 11.5a5.5 5.5 0 1 0 7.2 6.8"/>',
  // UniSuper app (More screen + tab bar)
  contributions: '<circle cx="9.5" cy="7.5" r="4.5"/><path d="M9.5 5.5v4M2.5 16.5h4l3.5 2.5h5l6.5-4.5-1.6-1.5-4.4 2.5H11"/>',
  retirement: '<circle cx="12" cy="6" r="3.5"/><path d="M12 4.6v2.8M12 9.5V21M12 17c-3 0-5.5-2-5.5-4.5 3 0 5.5 2 5.5 4.5zM12 17c3 0 5.5-2 5.5-4.5-3 0-5.5 2-5.5 4.5z"/>',
  statement: '<path d="M6 2.5h9l4 4v15H6z"/><path d="M15 2.5v4h4M9 11h7M9 14h7M9 17h5"/>',
  insurance: '<circle cx="12" cy="4.5" r="2.2"/><path d="M8.5 9.5h7l-1 5.5h-1.5v6h-3v-6H9.5z"/><path d="M15.5 10.5l3 2"/>',
  beneficiaries: '<path d="M12 11.5S8 9 8 6.3a2 2 0 0 1 4-.8 2 2 0 0 1 4 .8C16 9 12 11.5 12 11.5z"/><path d="M3 11l2.5 6.5L9 21M21 11l-2.5 6.5L15 21"/>',
  forms: '<rect x="4.5" y="4" width="12" height="17" rx="1.5"/><path d="M8.5 4V2.5h4V4M7.5 9h6M7.5 12h4"/><circle cx="17" cy="17" r="3.8" fill="#fff"/><path d="M15.4 17l1.1 1.1 2-2.2"/>',
  smile: '<circle cx="12" cy="12" r="9"/><path d="M8.5 14a4 4 0 0 0 7 0M9 9.5v.6M15 9.5v.6"/>',
  inbox: '<path d="M3 10.5h11v7H3zM14 10.5a3.5 3.5 0 0 1 7 0v7h-7M8.5 17.5V21M10 7V3h4"/>',
  tools: '<path d="M4 20l7.5-7.5M14.5 3.5a4 4 0 0 0-1.6 5L4.5 17v2.5H7l8.5-8.4a4 4 0 0 0 5-1.6l-2.4-.3-.7-2.6-2.6-.7z"/><path d="M14 14l5.5 5.5M4.5 4.5l3 3"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.2a2.5 2.5 0 1 1 3.4 2.3c-.6.3-.9.8-.9 1.4v.8M12 16.8v.4"/>',
  wallet: '<rect x="3" y="6.5" width="18" height="13" rx="2"/><path d="M16 13h3M5 6.5l11-3.5 1 3.5"/>',
  pie: '<path d="M11 4a8.5 8.5 0 1 0 9 9h-9z"/><path d="M14 2.5A8 8 0 0 1 21.5 10H14z"/>',
  dots: '<circle cx="5.5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="18.5" cy="12" r="1.7"/>',
  chevron: '<path d="M9 5l7 7-7 7"/>',
  list:'<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1" fill="currentColor"/><circle cx="4.5" cy="12" r="1" fill="currentColor"/><circle cx="4.5" cy="18" r="1" fill="currentColor"/>',
  info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
  alert: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.5"/>',
};

export function icon(name, cls = '') {
  return `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name] || ''}</svg>`;
}

export const MODE_ICON = { drive: 'car', transit: 'transit', walk: 'walk' };
export const MODE_LABEL = { drive: 'Car', transit: 'Public transport', walk: 'Walk' };
export const MODE_VERB = { drive: 'drive', transit: 'by public transport', walk: 'walk' };

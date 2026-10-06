import { CONFIG } from './config.js';
import { LOCATIONS, STATE_ORDER, byId } from './data/locations.js';
import {
  MEMBERS, ACCESS_REASONS, OFFLINE_POSTCODES,
  findMember, memberOrigin, appointmentInfo,
  maskNumber, fullName,
} from './data/members.js';
import { servicesFor } from './data/demo-content.js';
import { arrivalFor, phoneFor } from './data/arrival.js';
import { haversineKm, estimateTravel, fmtDistance, fmtDuration, originKey } from './lib/geo.js';
import { openStatus, hoursSummary } from './lib/hours.js';
import { icon, MODE_ICON } from './lib/icons.js';
import * as G from './lib/google.js';
import * as M from './lib/map.js';

const VIEWS = {
  guest: 'Guest',
  member: 'Logged-in member',
  consultant: 'Consultant (impersonating)',
  'mobile-web': 'Mobile web (guest)',
  app: 'App (logged in)',
};
// Device views render the real page inside a phone frame (an iframe with ?embed=…).
const DEVICE_VIEWS = {
  'mobile-web': { view: 'guest', embed: 'web', url: 'unisuper.com.au/contact-us/our-locations' },
  app: { view: 'member', embed: 'app' },
};
const EMBED = new URLSearchParams(location.search).get('embed'); // 'web' | 'app' | null
const URL_MEMBER = findMember(new URLSearchParams(location.search).get('member') || '');
const ACCESS = { all: 'All locations', walkin: 'Walk-ins accepted', appointment: 'Appointment only' };
const MODE_NAME = { drive: 'Car', transit: 'Public transport', walk: 'Walk' };
const MODE_UNIT = { drive: 'drive', transit: 'by transit', walk: 'walk' };
const KEYS = { view: 'us-locations-proto:view', layout: 'us-locations-proto:layout', lookup: 'us-locations-proto:guest-lookup' };
const LIST_LIMIT = 10;

const state = {
  view: readChoice('view', VIEWS, 'guest'),
  layout: readChoice('layout', { map: 1, list: 1 }, 'map'),
  guestLookup: read(KEYS.lookup) === '1',
  searchTab: 'address',
  member: null,
  accessReason: null,
  origin: null,
  mode: 'drive',
  access: 'all',
  selectedId: null,
  showAll: false,
  mapReady: false,
  notice: null,
  live: new Map(),
  fetched: new Set(),
  liveSource: null,
  loadingTravel: false,
  message: null,
};

const $ = sel => document.querySelector(sel);
const els = {
  viewBar: $('#view-bar'),
  memberSlot: $('#member-slot'),
  brandTag: $('#brand-tag'),
  settingsBtn: $('#settings-btn'),
  settingsPop: $('#settings-pop'),
  imperson: $('#impersonation'),
  notice: $('#notice'),
  personal: $('#personal-area'),
  title: $('#panel-title'),
  layoutToggle: $('#layout-toggle'),
  locator: $('#locator'),
  search: $('#search-area'),
  body: $('#panel-body'),
  map: $('#map'),
  modal: $('#modal'),
  live: $('#live-region'),
};

function read(key) { try { return localStorage.getItem(key); } catch { return null; } }
function store(key, v) {
  if (EMBED) return; // a framed page must not overwrite the outer page's remembered view
  try { localStorage.setItem(key, v); } catch { /* per-viewer convenience only */ }
}
function readChoice(name, options, fallback) {
  const fromUrl = new URLSearchParams(location.search).get(name);
  if (fromUrl && options[fromUrl]) return fromUrl;
  const saved = read(KEYS[name]);
  return saved && options[saved] ? saved : fallback;
}
function syncUrl() {
  const url = new URL(location.href);
  url.searchParams.set('view', state.view);
  url.searchParams.set('layout', state.layout);
  history.replaceState(null, '', url);
}

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const announce = msg => { els.live.textContent = ''; requestAnimationFrame(() => { els.live.textContent = msg; }); };
const isConsultant = () => state.view === 'consultant';
// While impersonating, the consultant sees exactly what the member sees. The only
// additions are the yellow "Viewing as…" bar and the yellow consultant notes box.
const isMemberView = () => state.view === 'member' || state.view === 'consultant';
const isImpersonating = () => isConsultant() && !!state.member;
const isList = () => state.layout === 'list';
const telHref = n => `tel:${n.replace(/\s/g, '')}`;

// ── Travel data ──────────────────────────────────────────────────────────

const liveKey = (o, mode) => `${originKey(o)}|${mode}`;

function travelFor(loc, mode = state.mode) {
  const km = haversineKm(state.origin, loc);
  if (km < 0.05) return { seconds: 0, meters: 0, km, live: true, here: true };
  const live = state.live.get(liveKey(state.origin, mode))?.get(loc.id);
  const t = live ? { ...live, km, live: true } : { ...estimateTravel(km, mode), km, live: false };
  // Google will happily return a 19-hour walk; treat those as not practical.
  if (mode === 'walk' && t.seconds > 2 * 3600) t.seconds = null;
  return t;
}

function liveCandidates(origin) {
  const byDist = [...LOCATIONS].sort((a, b) => haversineKm(origin, a) - haversineKm(origin, b));
  const picked = new Set(byDist.slice(0, CONFIG.NEAREST_WITH_LIVE_TIMES));
  byDist.filter(l => l.type === 'office').slice(0, 2).forEach(l => picked.add(l));
  return [...picked];
}

async function refreshTravel() {
  const origin = state.origin;
  const mode = state.mode;
  if (!origin || !state.mapReady) return;
  const key = liveKey(origin, mode);
  if (state.fetched.has(key)) return;
  state.fetched.add(key);
  state.loadingTravel = true;
  renderBody();
  const { results, source } = await G.travelTimes(origin, liveCandidates(origin), mode);
  if (state.origin !== origin) return;
  if (!state.live.has(key)) state.live.set(key, new Map());
  results.forEach((v, id) => state.live.get(key).set(id, v));
  state.liveSource = source;
  state.loadingTravel = false;
  renderBody();
  if (isImpersonating()) renderPersonal();
}

async function refreshDetailTravel(loc) {
  const origin = state.origin;
  if (!origin || !state.mapReady) return;
  let changed = false;
  for (const mode of ['drive', 'transit', 'walk']) {
    const key = liveKey(origin, mode);
    if (state.live.get(key)?.has(loc.id)) continue;
    const { results } = await G.travelTimes(origin, [loc], mode);
    if (state.origin !== origin) return;
    const r = results.get(loc.id);
    if (!r) continue;
    if (!state.live.has(key)) state.live.set(key, new Map());
    state.live.get(key).set(loc.id, r);
    changed = true;
  }
  if (changed && state.selectedId === loc.id) renderBody();
}

// ── Filtering & sorting (by proximity) ───────────────────────────────────

function passes(loc) {
  if (state.access === 'all') return true;
  const walkIn = servicesFor(loc).walkIn;
  return state.access === 'walkin' ? walkIn : !walkIn;
}

function proximity(loc) {
  const t = travelFor(loc, 'drive');
  return t.here ? 0 : (t.meters ?? t.km * 1300);
}

function sortedResults() {
  const list = LOCATIONS.filter(passes);
  if (!state.origin) {
    return list.sort((a, b) => STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state)
      || (a.type === b.type ? 0 : a.type === 'office' ? -1 : 1) || a.name.localeCompare(b.name));
  }
  return list.map(l => ({ l, d: proximity(l) })).sort((a, b) => a.d - b.d).map(x => x.l);
}

function closestLocation() {
  if (!state.origin) return null;
  return LOCATIONS.map(l => ({ l, d: proximity(l) })).sort((a, b) => a.d - b.d)[0]?.l || null;
}

function nearestOffice() {
  return LOCATIONS.filter(l => l.type === 'office').map(l => ({ l, t: travelFor(l, 'drive') }))
    .sort((a, b) => (a.t.seconds ?? Infinity) - (b.t.seconds ?? Infinity))[0];
}

function nearestByDrive() {
  if (!state.origin) return null;
  return LOCATIONS.map(l => ({ l, t: travelFor(l, 'drive') }))
    .sort((a, b) => (a.t.seconds ?? Infinity) - (b.t.seconds ?? Infinity))[0];
}

// ── Origin ───────────────────────────────────────────────────────────────

async function setOrigin(origin) {
  state.origin = origin;
  state.selectedId = null;
  state.showAll = false;
  state.message = null;
  state.loadingTravel = false;
  // The "Near …" line now says where results are from, so empty the search box ready for
  // the next search. (A search that finds nothing never gets here, so its text stays.)
  if (origin) ['#q', '#member-number'].forEach(sel => { const input = $(sel); if (input) input.value = ''; });
  M.clearRoute();
  M.setSelected(null);
  M.setOrigin(origin);
  renderSearchMessage();
  renderBody();
  if (isImpersonating()) renderPersonal();
  if (origin) {
    const near = sortedResults().slice(0, 4);
    M.fitTo([origin, ...near]);
    announce(`Showing locations near ${origin.label}.${near[0] ? ` Nearest is ${near[0].name}.` : ''}`);
    await refreshTravel();
  } else {
    M.resetView();
  }
  syncMap();
}

async function searchAddress(query) {
  const q = query.trim();
  if (!q) return;
  if (state.mapReady) {
    setMessage('Searching…');
    const r = await G.geocode(q);
    if (r) return setOrigin({ ...r, source: 'search' });
  }
  const offline = OFFLINE_POSTCODES[q];
  if (offline) return setOrigin({ label: offline[0], lat: offline[1], lng: offline[2], source: 'search' });
  setMessage(state.mapReady
    ? `We couldn't find "${q}". Try a suburb name or 4-digit postcode.`
    : 'Address search needs a Google Maps API key. Without one, try a capital-city postcode such as 3000.', 'error');
}

function useMyLocation() {
  if (!navigator.geolocation) return setMessage('Your browser does not support location access.', 'error');
  setMessage('Finding your location…');
  navigator.geolocation.getCurrentPosition(async pos => {
    const o = { lat: pos.coords.latitude, lng: pos.coords.longitude, source: 'geo', label: 'your current location' };
    const label = await G.reverseGeocode(o);
    if (label) o.label = label;
    setOrigin(o);
  }, err => {
    setMessage(err.code === 1 ? 'Location access was blocked. Search by suburb or postcode instead.' : 'We couldn\'t get your location. Try searching instead.', 'error');
  }, { timeout: 10000, maximumAge: 300000 });
}

function guestLookup(raw) {
  const num = raw.replace(/\D/g, '');
  if (num.length < 6) return setMessage('Enter a member number (demo numbers: 10000001 – 10000005).', 'error');
  const m = findMember(num);
  if (!m) return setMessage(`No member found for ${num}. Demo numbers are 10000001 – 10000005.`, 'error');
  setOrigin({ ...memberOrigin(m, 'home'), source: 'member-number', detail: undefined });
}

// ── Views, layout, impersonation ─────────────────────────────────────────

function setView(view, { member = null } = {}) {
  // Moving into or out of a phone-frame view swaps the whole page, so reload.
  if (!EMBED && (DEVICE_VIEWS[view] || DEVICE_VIEWS[state.view]) && view !== state.view) {
    store(KEYS.view, view);
    location.href = `${location.pathname}?view=${view}`;
    return;
  }
  state.view = view;
  store(KEYS.view, view);
  if (!EMBED) syncUrl();
  Object.assign(state, { member: null, accessReason: null, searchTab: 'address', access: 'all' });
  closeModal();
  toggleSettings(false);
  if (view === 'member') state.member = member || URL_MEMBER || MEMBERS[0];
  if (view === 'consultant') {
    // Sessions open from the CRM when the consultant takes a call: start already impersonating.
    state.member = member || URL_MEMBER || MEMBERS[0];
    state.accessReason = ACCESS_REASONS[0];
  }
  renderChrome();
  setOrigin(state.member ? memberOrigin(state.member, 'home') : null);
}

function setLayout(layout) {
  if (layout === state.layout) return;
  state.layout = layout;
  store(KEYS.layout, layout);
  syncUrl();
  els.locator.dataset.layout = layout;
  renderLayoutToggle();
  renderBody();
  if (layout === 'map' && state.mapReady) {
    const sel = state.selectedId && byId(state.selectedId);
    requestAnimationFrame(() => {
      if (sel) selectLocation(sel.id);
      else if (state.origin) M.fitTo([state.origin, ...sortedResults().slice(0, 4)]);
      else M.resetView();
    });
  }
}

function impersonate(member, reason) {
  Object.assign(state, { member, accessReason: reason });
  renderChrome();
  setOrigin(memberOrigin(member, 'home'));
}

function endImpersonation() {
  Object.assign(state, { member: null, accessReason: null });
  renderChrome();
  setOrigin(null);
}

// ── Selection ────────────────────────────────────────────────────────────

async function selectLocation(id) {
  const loc = byId(id);
  if (!loc) return;
  state.selectedId = id;
  M.setSelected(id);
  renderBody();
  if (inSheet()) {
    $('#sheet .sheet-close')?.focus({ preventScroll: true });
  } else {
    els.body.querySelector('.detail h3')?.focus({ preventScroll: true });
    if (isList()) els.locator.scrollIntoView({ behavior: 'smooth', block: 'start' });
    else els.body.scrollTop = 0;
  }

  if (state.origin) {
    refreshDetailTravel(loc);
    if (isList()) return;
    const path = await G.routePath(state.origin, loc, state.mode);
    if (state.selectedId !== id || isList()) return;
    M.drawRoute(path || [state.origin, loc], { estimated: !path });
  } else {
    M.focusLocation(loc);
  }
}

function deselect() {
  const prev = state.selectedId;
  state.selectedId = null;
  M.setSelected(null);
  M.clearRoute();
  renderBody();
  if (state.origin) M.fitTo([state.origin, ...sortedResults().slice(0, 4)]);
  els.body.querySelector(`[data-id="${prev}"]`)?.focus();
}

function syncMap() {
  if (state.mapReady) M.setVisible(LOCATIONS.filter(passes).map(l => l.id));
}

// ── Chrome ───────────────────────────────────────────────────────────────

function renderViewBar() {
  els.viewBar.innerHTML = `
    <span class="proto-bar-label">Prototype view</span>
    <div class="proto-switch" role="radiogroup" aria-label="Prototype view">
      ${Object.entries(VIEWS).map(([v, label]) => `<button role="radio" aria-checked="${state.view === v}" class="${state.view === v ? 'is-on' : ''}" data-action="view" data-view="${v}">${label}</button>`).join('')}
    </div>`;
}

function renderHeader() {
  document.body.dataset.view = state.view;
  els.brandTag.hidden = true;
  // Logged-in views use the member account site's layout: account header, left menu, navy banner.
  const signedIn = isMemberView() && !!state.member;
  document.body.classList.toggle('is-signed-in', signedIn);
  $('#mol-name').textContent = signedIn ? fullName(state.member).toUpperCase() : '';
  $('#hero-title').textContent = signedIn ? 'Find a location' : 'Our Locations';
  if (state.member) {
    const m = state.member;
    els.memberSlot.innerHTML = `
      <div class="member-chip">
        <span class="member-chip-text"><strong>${esc(fullName(m))}</strong><small>Member ${maskNumber(m.number)}</small></span>
        <button class="btn btn-outline" data-action="logout">Log out</button>
      </div>`;
  } else {
    els.memberSlot.innerHTML = `
      <button class="btn btn-outline" data-action="open-login">Login <svg class="icon-xs" viewBox="0 0 12 8" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M1 1.5l5 5 5-5"/></svg></button>
      <a class="btn btn-primary" href="#" data-action="noop">Join</a>`;
  }
}

function renderImpersonation() {
  const m = state.member;
  els.imperson.hidden = !(isConsultant() && m);
  els.imperson.innerHTML = isConsultant() && m ? `
    ${icon('user')}
    <p>Viewing as <strong>${esc(fullName(m))}</strong> (member ${m.number}) <span class="imp-meta">· Reason: ${esc(state.accessReason)} · All actions are logged</span></p>
    <button class="btn btn-sm" data-action="end-impersonation">End session</button>` : '';
}

function renderTitle() {
  const m = state.member;
  let h2 = 'Find a location near you';
  let lede = 'UniSuper offices and on-campus member centres. Member? <button class="link" data-action="open-login">Log in</button> to start from your home address.';
  if (isMemberView() && m) { h2 = `Hi ${esc(m.firstName)}, find a location near you`; lede = 'We\'ve started from your home address.'; }
  if (isConsultant() && !m) { h2 = 'Find a location near you'; lede = 'UniSuper offices and on-campus member centres.'; }
  els.title.innerHTML = `<h2>${h2}</h2><p class="lede">${lede}</p>`;
}

function renderLayoutToggle() {
  els.layoutToggle.innerHTML = [['map', 'pin', 'Map'], ['list', 'list', 'List']].map(([v, ic, label]) => `
    <button role="radio" aria-checked="${state.layout === v}" class="${state.layout === v ? 'is-on' : ''}" data-action="layout" data-layout="${v}">${icon(ic)}${label}</button>`).join('');
}

function renderPersonal() {
  const m = state.member;
  if (isConsultant() && !m) {
    els.personal.innerHTML = `
      <section class="session-ended">
        <p><strong>Member session ended.</strong> In production a new session opens from the CRM when you take the next call.</p>
        <button class="btn btn-outline btn-sm" data-action="impersonate" data-number="${MEMBERS[0].number}">Start demo session again</button>
      </section>`;
    return;
  }
  if (!isMemberView() || !m) { els.personal.innerHTML = ''; return; }
  const a = appointmentInfo(m.appointment);
  els.personal.innerHTML = `
    ${isImpersonating() ? consultantNotes() : ''}
    ${a ? `
      <section class="appt" aria-label="Your next appointment">
        <div><small>Your next appointment</small><strong>${esc(a.dateLabel)}, ${esc(a.time)}</strong><span>${esc(a.location.name)} · ${esc(a.format)}${a.topic ? ` · ${esc(a.topic)}` : ''}</span></div>
        <button class="btn btn-outline btn-sm" data-action="select" data-id="${a.locationId}">View location</button>
      </section>` : ''}`;
}

// The one consultant-only addition to the page: warnings, the closest location, and
// whether the nearest office is too far (CONFIG.OFFICE_FAR_MINUTES).
function consultantNotes() {
  const m = state.member;
  const items = [];
  if (m.accessibility) items.push(['alert', esc(m.accessibility), true]);
  const loc = closestLocation();
  if (loc) {
    const t = travelFor(loc, 'drive');
    const travel = t.here ? 'at the starting point' : `${fmtDistance(t.meters ?? t.km * 1000)}${t.seconds == null ? '' : `, ${fmtDuration(t.seconds)} by car`}`;
    items.push(['pin', `Closest location: <button class="link" data-action="select" data-id="${loc.id}">${esc(loc.name)}</button> (${travel})`]);
  }
  const office = state.origin && nearestOffice();
  if (office && office.t.seconds != null) {
    const far = office.t.seconds > CONFIG.OFFICE_FAR_MINUTES * 60;
    if (far) items.push(['alert', `<strong>Nearest office is over ${CONFIG.OFFICE_FAR_MINUTES} minutes away:</strong> ${esc(office.l.name)}, ${fmtDuration(office.t.seconds)} by car. Offer a phone appointment (or video).`, true]);
    else if (office.l.id !== loc?.id) items.push(['building', `Nearest office: ${esc(office.l.name)}, ${fmtDuration(office.t.seconds)} by car`]);
  }
  return `
    <aside class="imp-notes" aria-label="Consultant notes">
      <ul>${items.map(([ic, html, warn]) => `<li class="${warn ? 'is-warn' : ''}">${icon(ic)}<span>${html}</span></li>`).join('')}</ul>
    </aside>`;
}

function renderSettings() {
  const source = !state.mapReady ? 'Estimated (no Google key loaded)'
    : state.liveSource === 'routes' ? 'Live (Google Routes API)'
    : state.liveSource === 'distance-matrix' ? 'Live (Distance Matrix, legacy)'
    : state.liveSource === 'estimate' ? 'Estimated (routing API unavailable)' : 'Live once you search';
  els.settingsPop.innerHTML = `
    <div class="pop-head"><h2>Prototype settings</h2><button class="icon-btn" data-action="close-settings" aria-label="Close">${icon('close')}</button></div>
    ${state.view === 'guest' ? `
      <label class="check-row"><input type="checkbox" data-setting="guest-lookup" ${state.guestLookup ? 'checked' : ''}>
        <span><strong>Show public member-number field</strong>Matches a member number to a residential postcode. Included for comparison only.</span></label>` : ''}
    ${isMemberView() ? `
      <label class="field">${isConsultant() ? 'Member on the call' : 'Demo member'}<select class="input" data-setting="member">${MEMBERS.map(m => `<option value="${m.number}" ${state.member?.number === m.number ? 'selected' : ''}>${esc(fullName(m))}, ${esc(m.home.suburb)} ${m.home.state}</option>`).join('')}</select></label>` : ''}
    ${isConsultant() && state.member ? `
      <label class="field">Reason for access<select class="input" data-setting="reason">${ACCESS_REASONS.map(r => `<option ${r === state.accessReason ? 'selected' : ''}>${esc(r)}</option>`).join('')}</select></label>` : ''}
    <dl class="kv">
      <dt>Travel times</dt><dd>${esc(source)}</dd>
      <dt>Demo members</dt><dd>${MEMBERS.map(m => `${m.number} ${esc(fullName(m))}`).join('<br>')}</dd>
    </dl>
    <button class="btn btn-outline btn-block" data-action="reset">Reset this view</button>`;
}

function toggleSettings(open = els.settingsPop.hidden) {
  if (open) renderSettings();
  els.settingsPop.hidden = !open;
  els.settingsBtn.setAttribute('aria-expanded', String(open));
  if (open) els.settingsPop.querySelector('input, select, button')?.focus();
}

function renderNotice() {
  const n = state.notice;
  const text = {
    'no-key': '<strong>Running without Google Maps.</strong> The map, address suggestions and live travel times need a Google Maps key (<code>js/config.local.js</code> locally, or the <code>GOOGLE_MAPS_API_KEY</code> repository secret on GitHub). Times shown are estimates.',
    auth: `<strong>Google rejected the API key on this site.</strong> In Google Cloud, add <code>${esc(location.origin)}/*</code> to the key's allowed websites, then reload. Changes can take about 5 minutes.`,
    'load-failed': '<strong>Google Maps failed to load.</strong> Check your connection and API key. Times shown are estimates.',
  }[n];
  els.notice.innerHTML = n ? `<div class="notice ${n === 'no-key' ? '' : 'notice-warn'}" role="status">${icon(n === 'no-key' ? 'info' : 'alert')}<p>${text}</p></div>` : '';
}

function renderChrome() {
  renderViewBar();
  renderHeader();
  renderImpersonation();
  renderPersonal();
  renderTitle();
  renderLayoutToggle();
  renderSearch();
  if (!els.settingsPop.hidden) renderSettings();
}

// ── Search ───────────────────────────────────────────────────────────────

function renderSearch() {
  const guestTabs = state.view === 'guest' && state.guestLookup;
  if (!guestTabs) state.searchTab = 'address';
  const tab = state.searchTab;
  const signedIn = isMemberView() && !!state.member;
  const label = signedIn ? 'Search for a UniSuper office or campus' : 'Find a location near you';

  const tabs = guestTabs ? `
    <div class="tabs" role="tablist" aria-label="Search by">
      <button role="tab" id="tab-address" aria-selected="${tab === 'address'}" data-action="tab" data-tab="address">Postcode or address</button>
      <button role="tab" id="tab-member" aria-selected="${tab === 'member'}" data-action="tab" data-tab="member">Member number</button>
    </div>` : '';

  const addressForm = `
    <form id="search-form" class="search" role="search" autocomplete="off">
      <label class="field-label" for="q">${label}</label>
      <div class="search-field">
        <div class="input-wrap">
          <input id="q" class="input" type="text" placeholder="Enter postcode or address" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="suggestions">
          <ul id="suggestions" class="suggestions" role="listbox" aria-label="Suggested addresses" hidden></ul>
        </div>
        <button type="submit" class="btn btn-primary">Search</button>
      </div>
      <div class="search-help ${signedIn ? 'search-help-member' : ''}">
        ${signedIn ? '' : '<span>Search for a UniSuper office or campus</span>'}
        <button type="button" class="link" data-action="geolocate">${icon('locate', 'icon-xs')} Use my location</button>
      </div>
    </form>`;

  const memberForm = `
    <form id="member-form" class="search" autocomplete="off">
      <label class="field-label" for="member-number">Member number</label>
      <div class="search-field">
        <div class="input-wrap"><input id="member-number" class="input" type="text" inputmode="numeric" placeholder="e.g. 10000001" maxlength="12"></div>
        <button type="submit" class="btn btn-primary">Find</button>
      </div>
    </form>
    <p class="privacy-note"><strong>Privacy risk:</strong> on a public page anyone who knows a member number could find out roughly where that member lives. Logging in avoids this.</p>`;

  els.search.innerHTML = `
    <div class="search-block">${tabs}${tab === 'member' ? memberForm : addressForm}<div id="search-msg" aria-live="polite"></div>
    </div>
    <div id="filter-slot"></div>`;
  wireSearch();
  renderSearchMessage();
  renderFilter();
}

function renderFilter() {
  const slot = $('#filter-slot');
  if (!slot) return;
  slot.innerHTML = `
    <fieldset class="filter">
      <legend>Appointment type</legend>
      <div class="radio-pills">
        ${Object.entries(ACCESS).map(([v, label]) => `<label><input type="radio" name="access" value="${v}" ${state.access === v ? 'checked' : ''}><span>${label}</span></label>`).join('')}
      </div>
    </fieldset>`;
}

function setMessage(text, kind = 'muted') {
  state.message = text ? { text, kind } : null;
  renderSearchMessage();
}

function renderSearchMessage() {
  const box = $('#search-msg');
  if (box) box.innerHTML = state.message ? `<p class="search-msg search-msg-${state.message.kind}">${esc(state.message.text)}</p>` : '';
}

let suggestTimer, suggestions = [], activeIdx = -1, suggestSeq = 0;

function wireSearch() {
  const form = $('#search-form');
  if (form) {
    const input = $('#q');
    const list = $('#suggestions');
    const close = () => { list.hidden = true; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); activeIdx = -1; };
    const paint = () => {
      list.innerHTML = suggestions.map((s, i) => `
        <li role="option" id="sugg-${i}" aria-selected="${i === activeIdx}" data-idx="${i}" class="${i === activeIdx ? 'is-active' : ''}"><strong>${esc(s.main)}</strong><small>${esc(s.secondary)}</small></li>`).join('')
        + '<li class="powered" aria-hidden="true">Powered by Google</li>';
      list.hidden = !suggestions.length;
      input.setAttribute('aria-expanded', String(!!suggestions.length));
      if (activeIdx >= 0) input.setAttribute('aria-activedescendant', `sugg-${activeIdx}`); else input.removeAttribute('aria-activedescendant');
    };
    const choose = async i => {
      const s = suggestions[i];
      if (!s) return;
      input.value = s.main + (s.secondary ? `, ${s.secondary}` : '');
      close();
      setMessage('Searching…');
      try {
        const r = await G.resolveSuggestion(s);
        setOrigin({ ...r, source: 'search' });
      } catch { searchAddress(input.value); }
    };
    input.addEventListener('input', () => {
      clearTimeout(suggestTimer);
      const q = input.value.trim();
      if (q.length < 3 || !state.mapReady) { suggestions = []; close(); return; }
      suggestTimer = setTimeout(async () => {
        const seq = ++suggestSeq;
        const res = await G.suggest(q);
        if (seq !== suggestSeq) return;
        suggestions = res; activeIdx = -1; paint();
      }, 200);
    });
    input.addEventListener('keydown', e => {
      if (list.hidden) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); activeIdx = (activeIdx + 1) % suggestions.length; paint(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); activeIdx = (activeIdx - 1 + suggestions.length) % suggestions.length; paint(); }
      else if (e.key === 'Escape') close();
      else if (e.key === 'Enter' && activeIdx >= 0) { e.preventDefault(); choose(activeIdx); }
    });
    input.addEventListener('blur', () => setTimeout(close, 150));
    list.addEventListener('mousedown', e => {
      const li = e.target.closest('[data-idx]');
      if (li) { e.preventDefault(); choose(+li.dataset.idx); }
    });
    form.addEventListener('submit', e => {
      e.preventDefault();
      close();
      if (suggestions.length && input.value.trim().length >= 3 && !/^\d{4}$/.test(input.value.trim())) return choose(0);
      searchAddress(input.value);
    });
  }
  $('#member-form')?.addEventListener('submit', e => { e.preventDefault(); guestLookup($('#member-number').value); });
}

// ── Results ──────────────────────────────────────────────────────────────

const kindLabel = loc => (loc.type === 'office' ? 'Office' : 'Campus');
const accessLabel = loc => (servicesFor(loc).walkIn ? 'Walk-ins accepted' : 'Appointment only');

function statusText(loc) {
  const s = openStatus(loc);
  if (s.state === 'appointment') return '';
  return `<span class="${s.state === 'open' ? 'status-open' : ''}">${esc(s.label)}${s.detail ? ` · ${esc(s.detail)}` : ''}</span>`;
}

function travelText(loc) {
  if (!state.origin) return null;
  const t = travelFor(loc);
  if (t.here) return { main: 'You\'re here', sub: 'Starting point' };
  const dist = fmtDistance(t.meters ?? t.km * 1000);
  if (t.seconds == null) return { main: fmtDistance(t.km * 1000), sub: `${MODE_NAME[state.mode].toLowerCase()} not practical` };
  return { main: dist, sub: `${fmtDuration(t.seconds)} ${MODE_UNIT[state.mode]}${t.live ? '' : ' (est.)'}` };
}

function tags(loc) {
  const m = state.member;
  const out = [];
  if (m?.appointment?.locationId === loc.id) out.push('Your appointment');
  return out.map(t => `<span class="flagword">${t}</span>`).join('');
}

// Logged-in members always start from home: it's stated plainly, and after searching
// somewhere else a single link takes them back.
function originBlock() {
  const o = state.origin;
  const personal = state.member && isMemberView();
  if (!o) return '';
  if (personal && o.source === 'home') {
    return `
      <div class="origin origin-home">
        ${icon('home')}
        <p>Near your home: <strong>${esc(o.label)}</strong><small>From your member profile</small></p>
      </div>`;
  }
  const sourceText = {
    'member-number': 'Postcode matched to member number',
    geo: 'Your current location',
    search: 'Searched address',
  }[o.source] || '';
  // Logged-in member looking somewhere else: one line, with a single "Home" button back.
  if (personal) {
    return `
      <div class="origin origin-away">
        <p>Near <strong>${esc(o.label)}</strong></p>
        <button class="origin-home-btn" data-action="origin" data-kind="home" aria-label="Show results near your home again">${icon('home')} Home</button>
      </div>`;
  }
  return `
    <div class="origin">
      <div class="origin-row">
        <p>Near <strong>${esc(o.label)}</strong><small>${sourceText}</small></p>
        <button class="link" data-action="clear-origin">Clear</button>
      </div>
    </div>`;
}

function virtualBlock() {
  const n = nearestByDrive();
  if (!n || n.t.seconds == null || n.t.seconds < CONFIG.VIRTUAL_THRESHOLD_MINUTES * 60) return '';
  return `
    <aside class="virtual">
      <strong>Your nearest location is ${fmtDuration(n.t.seconds)} away by car</strong>
      <p>Talk to a super consultant by phone instead. Same help, no travel.</p>
      <div class="btn-row">
        <a class="btn btn-primary btn-sm" href="${telHref(CONFIG.ADVICE_PHONE)}">Call ${CONFIG.ADVICE_PHONE}</a>
        <button class="btn btn-outline btn-sm" data-action="callback">Request a call back</button>
      </div>
      <p class="small">Prefer to see someone? <button class="link" data-action="book" data-id="${n.l.id}" data-format="video">Book a video call</button></p>
    </aside>`;
}

function metaLine(count) {
  const sortText = state.origin ? 'nearest first' : 'by state';
  const loading = state.loadingTravel ? '<span class="loading">Getting live travel times…</span>' : '';
  return `<div class="results-meta"><span><strong>${count}</strong> location${count === 1 ? '' : 's'} · ${sortText}</span>${loading}</div>`;
}

function mapResults() {
  const all = sortedResults();
  const list = state.showAll ? all : all.slice(0, LIST_LIMIT);
  const hint = state.origin ? '' : '<p class="empty-hint">Enter a postcode or address to sort locations by distance and see travel times.</p>';
  const items = list.map(loc => {
    const t = travelText(loc);
    return `
      <li class="result ${state.selectedId === loc.id ? 'is-selected' : ''}">
        <button class="result-btn" data-action="select" data-id="${loc.id}">
          <span class="result-title">${esc(loc.name)}</span>
          <span class="result-sub">${loc.lines.map(esc).join(', ')}</span>
          ${t ? `<span class="result-travel"><strong>${esc(t.main)}</strong><small>${esc(t.sub)}</small></span>` : ''}
          <span class="result-meta"><span class="kind">${kindLabel(loc)}</span><span>${accessLabel(loc)}</span>${statusText(loc)}${tags(loc)}</span>
        </button>
      </li>`;
  }).join('');
  return `
    ${originBlock()}
    ${virtualBlock()}
    ${hint}
    ${metaLine(all.length)}
    ${all.length ? `<ol class="results">${items}</ol>` : emptyState()}
    ${all.length > list.length ? `<button class="btn btn-outline btn-block show-all" data-action="show-all">Show all ${all.length} locations</button>` : ''}`;
}

function listResults() {
  const all = sortedResults();
  const list = state.showAll || !state.origin ? all : all.slice(0, 15);
  const rows = list.map((loc, i) => {
    const t = travelText(loc);
    return `
      <tr>
        ${state.origin ? `<td class="rank">${i + 1}</td>` : ''}
        <td>
          <button class="loc-name" data-action="select" data-id="${loc.id}">${esc(loc.name)}</button>
          <div class="addr">${loc.lines.map(esc).join(', ')}</div>
          ${tags(loc) ? `<div class="result-meta">${tags(loc)}</div>` : ''}
        </td>
        <td>${kindLabel(loc)}</td>
        ${state.origin ? `<td class="col-dist">${t ? `<strong>${esc(t.main)}</strong>${esc(t.sub)}` : ''}</td>` : ''}
        <td>${accessLabel(loc)}<div class="small">${statusText(loc) || esc(servicesFor(loc).note)}</div></td>
        <td class="col-actions">
          <button class="btn btn-outline btn-sm" data-action="book" data-id="${loc.id}">Book</button>
          <button class="btn btn-outline btn-sm" data-action="view-on-map" data-id="${loc.id}">Map</button>
        </td>
      </tr>`;
  }).join('');
  return `
    ${originBlock()}
    ${virtualBlock()}
    ${metaLine(all.length)}
    ${all.length ? `
      <table class="table">
        <thead><tr>${state.origin ? '<th aria-label="Rank"></th>' : ''}<th>Location</th><th>Type</th>${state.origin ? '<th>Distance</th>' : ''}<th>Appointment type</th><th><span class="sr-only">Actions</span></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>` : emptyState()}
    ${all.length > list.length ? `<button class="btn btn-outline show-all" data-action="show-all">Show all ${all.length} locations</button>` : ''}`;
}

function emptyState() {
  return '<div class="empty"><p>No locations match this appointment type.</p><button class="link" data-action="clear-filter">Show all locations</button></div>';
}

// ── Detail ───────────────────────────────────────────────────────────────

// `compact`: the phone bottom sheet, where contact options collapse into one row of actions.
function detailView(loc, { compact = false } = {}) {
  const svc = servicesFor(loc);
  const m = state.member;
  const gmode = { drive: 'driving', transit: 'transit', walk: 'walking' }[state.mode];
  const originParam = state.origin ? `&origin=${state.origin.lat},${state.origin.lng}` : '';
  const directionsUrl = `https://www.google.com/maps/dir/?api=1${originParam}&destination=${loc.lat},${loc.lng}&travelmode=${gmode}`;
  const appt = m && m.appointment?.locationId === loc.id ? appointmentInfo(m.appointment) : null;

  const tiles = state.origin ? `
    <div class="mode-tiles" role="radiogroup" aria-label="Travel time">
      ${['drive', 'transit', 'walk'].map(md => {
        const t = travelFor(loc, md);
        return `<button role="radio" aria-checked="${state.mode === md}" class="mode-tile ${state.mode === md ? 'is-on' : ''}" data-action="mode" data-mode="${md}">
          ${icon(MODE_ICON[md])}
          <strong>${t.here ? 'Here' : fmtDuration(t.seconds)}</strong>
          <small>${t.here ? MODE_NAME[md] : t.seconds == null ? 'Not practical' : `${fmtDistance(t.meters)}${t.live ? '' : ' est.'}`}</small>
        </button>`;
      }).join('')}
    </div>
    <p class="from-note">From ${esc(state.origin.label)}</p>` : '';

  const driveSecs = state.origin ? travelFor(loc, 'drive').seconds : null;
  const farAway = driveSecs != null && driveSecs > CONFIG.VIRTUAL_THRESHOLD_MINUTES * 60;

  return `
    <div class="detail">
      <button class="link back" data-action="back">${icon('back', 'icon-xs')} Back to results</button>
      <div class="detail-head">
        <span class="kind">${kindLabel(loc)} · ${accessLabel(loc)}</span>
        <h3 tabindex="-1">${esc(loc.name)}</h3>
        <p class="addr">${loc.lines.map(esc).join('<br>')}</p>
      </div>
      ${appt ? `<p class="callout callout-teal"><strong>Your appointment:</strong> ${esc(appt.dateLabel)}, ${esc(appt.time)} · ${esc(appt.format)}</p>` : ''}

      ${compact ? `
      <!-- Phone sheet: one line of context, then one row of actions -->
      <p class="advice-note">Financial advice is by appointment.${svc.walkIn ? ' Walk-ins are welcome for general enquiries.' : ' This location is appointment only.'}</p>
      <div class="quick-actions">
        <a class="qa qa-primary" href="${telHref(CONFIG.ADVICE_PHONE)}" aria-label="Call the advice line on ${CONFIG.ADVICE_PHONE}">${icon('phone')}<span>Call</span><small>${CONFIG.ADVICE_PHONE}</small></a>
        <button class="qa" data-action="book" data-id="${loc.id}">${icon('calendar')}<span>Book</span></button>
        <a class="qa" href="${directionsUrl}" target="_blank" rel="noopener">${icon('directions')}<span>Directions</span></a>
      </div>
      <p class="callback-line">Prefer we call you? <button class="link" data-action="callback">Request a call back</button></p>
      ${tiles}` : `
      <!-- One contact block: the advice line leads; the office's own number sits with its hours below -->
      <div class="advice-callout">
        <strong>Financial advice is by appointment</strong>
        <p>${svc.walkIn ? 'Walk-ins are welcome for general enquiries. To see an adviser, call our advice line or book online.' : 'This location is appointment only. Call our advice line or book online.'}</p>
        <a class="btn btn-primary advice-call" href="${telHref(CONFIG.ADVICE_PHONE)}">${icon('phone')} Call ${CONFIG.ADVICE_PHONE}</a>
        <div class="advice-more">
          <button class="btn btn-outline btn-sm" data-action="book" data-id="${loc.id}">Book an appointment</button>
          <button class="link" data-action="callback">Request a call back</button>
        </div>
      </div>

      ${tiles}
      <div class="btn-row">
        <a class="btn btn-outline" href="${directionsUrl}" target="_blank" rel="noopener">Get directions</a>
      </div>`}
      ${farAway ? `<p class="small">It's a ${fmtDuration(driveSecs)} drive. <button class="link" data-action="book" data-id="${loc.id}" data-format="phone">Book a phone appointment instead</button></p>` : ''}

      <section class="detail-section">
        <h4>Arrival information <span class="sample-tag">Sample</span></h4>
        <dl class="arrival">
          ${[['building', 'Entrance & level', 'entrance'], ['car', 'Parking', 'parking'], ['transit', 'Public transport', 'transit'], ['access', 'Accessibility', 'access'], ['user', 'When you arrive', 'arrival']]
            .map(([ic, label, k]) => `<div>${icon(ic)}<dt>${label}</dt><dd>${esc(arrivalFor(loc)[k])}</dd></div>`).join('')}
        </dl>
      </section>

      <section class="detail-section">
        <h4>Opening hours</h4>
        <p>${esc(hoursSummary(loc))}</p>
        <p>${statusText(loc) || esc(svc.note)}</p>
        <p class="office-phone">${loc.type === 'office' ? 'Office' : 'Campus'} phone: <a href="${telHref(phoneFor(loc))}">${phoneFor(loc)}</a> <span>for directions or general questions</span></p>
      </section>

      <section class="detail-section">
        <h4>Services</h4>
        <ul class="plain-list">${svc.tags.map(t => `<li>${esc(t)}</li>`).join('')}</ul>
      </section>
    </div>`;
}

// On phones (website and app) a chosen location opens in a bottom sheet over the results;
// on wider screens its details replace the results in the side panel.
const narrowScreen = window.matchMedia('(max-width: 900px)');
const inSheet = () => EMBED === 'app' || narrowScreen.matches;
narrowScreen.addEventListener('change', () => renderBody());

function renderBody() {
  const loc = state.selectedId && byId(state.selectedId);
  if (inSheet()) {
    els.body.innerHTML = isList() ? listResults() : mapResults();
    renderSheet(loc);
    return;
  }
  renderSheet(null); // e.g. the window was widened while the sheet was open
  els.body.innerHTML = loc ? detailView(loc) : isList() ? listResults() : mapResults();
}

// ── Bottom sheet (app) ───────────────────────────────────────────────────
// Closes with the Close button, a swipe or drag down, a tap on the dimmed backdrop, or Esc.

function renderSheet(loc) {
  const sheet = $('#sheet');
  const backdrop = $('#sheet-backdrop');
  if (!sheet) return;
  const body = sheet.querySelector('.sheet-body');
  if (loc) {
    const isNew = sheet.dataset.loc !== loc.id;
    body.innerHTML = detailView(loc, { compact: true });
    sheet.setAttribute('aria-label', loc.name);
    if (isNew) body.scrollTop = 0;
    sheet.dataset.loc = loc.id;
    if (sheet.hidden) {
      sheet.hidden = backdrop.hidden = false;
      document.body.classList.add('sheet-open');
      void sheet.offsetHeight; // lay out the closed position first, so the slide-up animates
      sheet.classList.add('is-open');
      backdrop.classList.add('is-open');
    }
  } else if (!sheet.hidden) {
    delete sheet.dataset.loc;
    sheet.classList.remove('is-open');
    backdrop.classList.remove('is-open');
    document.body.classList.remove('sheet-open');
    setTimeout(() => { if (!sheet.classList.contains('is-open')) sheet.hidden = backdrop.hidden = true; }, 320);
  }
}

function renderSheetShell() {
  document.body.insertAdjacentHTML('beforeend', `
    <div id="sheet-backdrop" class="sheet-backdrop" data-action="back" hidden></div>
    <section id="sheet" class="sheet" role="dialog" aria-modal="true" hidden>
      <div class="sheet-top">
        <span class="sheet-handle" aria-hidden="true"></span>
        <span class="sheet-hint">Swipe down to close</span>
        <button class="sheet-close" data-action="back">${icon('close')} Close</button>
      </div>
      <div class="sheet-body"></div>
    </section>`);
  wireSheet();
}

function wireSheet() {
  const sheet = $('#sheet');
  const body = sheet.querySelector('.sheet-body');
  let startY = null;
  let startT = 0;
  let dy = 0;

  const begin = y => { startY = y; startT = performance.now(); dy = 0; sheet.classList.add('is-dragging'); };
  const move = y => {
    dy = Math.max(0, y - startY);
    sheet.style.transform = `translateY(${dy}px)`;
    $('#sheet-backdrop').style.opacity = String(Math.max(0, 1 - dy / 400));
  };
  const end = () => {
    if (startY == null) return;
    const fast = dy / Math.max(1, performance.now() - startT) > 0.5;
    startY = null;
    sheet.classList.remove('is-dragging');
    sheet.style.transform = '';
    $('#sheet-backdrop').style.opacity = '';
    if (dy > 110 || (fast && dy > 30)) deselect();
  };

  // Drag the top bar (handle + Close row) with a finger or a mouse.
  const grab = sheet.querySelector('.sheet-top');
  grab.addEventListener('pointerdown', e => {
    if (e.target.closest('.sheet-close')) return;
    try { grab.setPointerCapture(e.pointerId); } catch { /* keep dragging without capture */ }
    begin(e.clientY);
  });
  grab.addEventListener('pointermove', e => { if (startY != null) move(e.clientY); });
  grab.addEventListener('pointerup', end);
  grab.addEventListener('pointercancel', end);

  // Swipe down on the content too, once it's scrolled to the top.
  body.addEventListener('touchstart', e => { if (body.scrollTop <= 0) begin(e.touches[0].clientY); }, { passive: true });
  body.addEventListener('touchmove', e => {
    if (startY == null) return;
    const y = e.touches[0].clientY;
    if (y - startY > 0 && body.scrollTop <= 0) { e.preventDefault(); move(y); }
    else if (dy === 0) { startY = null; sheet.classList.remove('is-dragging'); }
  }, { passive: false });
  body.addEventListener('touchend', end);
}

// ── Modals ───────────────────────────────────────────────────────────────

function openModal(html, label) {
  els.modal.innerHTML = `<div class="modal-inner">${html}</div>`;
  els.modal.setAttribute('aria-label', label);
  if (!els.modal.open) els.modal.showModal();
  els.modal.querySelector('input, select, textarea, button:not(.icon-btn)')?.focus();
}
function closeModal() { if (els.modal.open) els.modal.close(); }
const modalHead = (title, extra = '') => `<div class="modal-head"><h2>${title}${extra}</h2><button class="icon-btn" data-action="close-modal" aria-label="Close">${icon('close')}</button></div>`;

function openLogin() {
  openModal(`
    ${modalHead('Member login', '<span class="pill">Demo</span>')}
    <p>In production this is MemberOnline sign-in. Choose a demo member. Their home address becomes the starting point.</p>
    <ul class="member-list">
      ${MEMBERS.map(m => `<li><button class="member-option" data-action="login-as" data-number="${m.number}">
        <span class="avatar">${m.firstName[0]}${m.lastName[0]}</span>
        <span><strong>${esc(fullName(m))}</strong><small>${esc(m.home.suburb)} ${m.home.state} ${m.home.postcode} · member ${maskNumber(m.number)}</small></span>
      </button></li>`).join('')}
    </ul>`, 'Member login');
}

// Advice bookings and call-back requests open full-screen placeholders. In production
// each would hand off to UniSuper's existing form.
function openTakeover(text, label) {
  els.modal.classList.add('modal-takeover');
  openModal(`
    <button class="takeover-close" data-action="close-modal">${icon('close')} Close</button>
    <p class="takeover-text">${text}</p>`, label);
}

// ── Events ───────────────────────────────────────────────────────────────

document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el) {
    if (!els.settingsPop.hidden && !e.target.closest('#settings-pop, #settings-btn')) toggleSettings(false);
    return;
  }
  const d = el.dataset;
  switch (d.action) {
    case 'view': if (d.view !== state.view) setView(d.view); break;
    case 'layout': setLayout(d.layout); break;
    case 'select': selectLocation(d.id); break;
    case 'view-on-map': setLayout('map'); selectLocation(d.id); break;
    case 'back': deselect(); break;
    case 'mode':
      state.mode = d.mode;
      renderBody();
      refreshTravel();
      if (state.selectedId && !isList()) selectLocation(state.selectedId);
      break;
    case 'origin': setOrigin(memberOrigin(state.member, d.kind)); break;
    case 'clear-filter': state.access = 'all'; renderFilter(); renderBody(); syncMap(); break;
    case 'show-all': state.showAll = true; renderBody(); break;
    case 'clear-origin': setOrigin(null); break;
    case 'geolocate': useMyLocation(); break;
    case 'tab': state.searchTab = d.tab; state.message = null; renderSearch(); (d.tab === 'member' ? $('#member-number') : $('#q'))?.focus(); break;
    case 'open-login': openLogin(); break;
    case 'login-as': setView('member', { member: findMember(d.number) }); break;
    case 'logout': if (isConsultant()) endImpersonation(); else setView('guest'); break;
    case 'impersonate': impersonate(findMember(d.number), state.accessReason || ACCESS_REASONS[0]); break;
    case 'end-impersonation': endImpersonation(); break;
    case 'close-modal': closeModal(); break;
    case 'book': e.preventDefault(); openTakeover('LINK TO ADVICE BOOKINGS FORM', 'Advice bookings form'); break;
    case 'callback': openTakeover('LINK TO REQUEST A CALL BACK FORM', 'Request a call back form'); break;
    case 'app-screen': e.preventDefault(); setAppScreen(d.screen); break;
    case 'noop': e.preventDefault(); break;
    case 'close-settings': toggleSettings(false); els.settingsBtn.focus(); break;
    case 'reset': state.mode = 'drive'; setView(state.view, { member: isMemberView() ? state.member : null }); break;
  }
});

document.addEventListener('change', e => {
  if (e.target.name === 'access' && e.target.closest('#filter-slot')) {
    state.access = e.target.value;
    state.showAll = false;
    if (state.selectedId && !passes(byId(state.selectedId))) deselect();
    renderBody();
    syncMap();
  }
});

els.settingsBtn.addEventListener('click', e => { e.stopPropagation(); toggleSettings(); });

els.settingsPop.addEventListener('change', e => {
  const s = e.target.dataset.setting;
  if (s === 'guest-lookup') {
    state.guestLookup = e.target.checked;
    store(KEYS.lookup, state.guestLookup ? '1' : '0');
    renderSearch();
  } else if (s === 'member') {
    if (isConsultant()) impersonate(findMember(e.target.value), state.accessReason || ACCESS_REASONS[0]);
    else setView('member', { member: findMember(e.target.value) });
    toggleSettings(true);
  } else if (s === 'reason') {
    state.accessReason = e.target.value;
    renderImpersonation();
    renderPersonal();
  }
});

els.modal.addEventListener('click', e => { if (e.target === els.modal) closeModal(); });
// Esc, Close or a backdrop click: the next pop-up opens at normal size.
els.modal.addEventListener('close', () => els.modal.classList.remove('modal-takeover'));

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !els.settingsPop.hidden) { toggleSettings(false); els.settingsBtn.focus(); }
  else if (e.key === 'Escape' && inSheet() && state.selectedId && !els.modal.open) deselect();
});

// ── Device previews ──────────────────────────────────────────────────────

const STATUS_ICONS = '<svg viewBox="0 0 18 12" width="18" height="12" aria-hidden="true"><rect x="0" y="8" width="3" height="4" rx=".6"/><rect x="5" y="5.5" width="3" height="6.5" rx=".6"/><rect x="10" y="3" width="3" height="9" rx=".6"/><rect x="15" y="0" width="3" height="12" rx=".6"/></svg><svg viewBox="0 0 16 12" width="16" height="12" aria-hidden="true"><path d="M8 11.5l2.4-2.9a3.6 3.6 0 0 0-4.8 0zM3.8 6.5a6.2 6.2 0 0 1 8.4 0l1.4-1.7a8.4 8.4 0 0 0-11.2 0zM.9 3a10.6 10.6 0 0 1 14.2 0L16.5 1.3A12.8 12.8 0 0 0-.5 1.3z"/></svg><svg viewBox="0 0 27 12" width="27" height="12" aria-hidden="true"><rect x=".5" y=".5" width="22" height="11" rx="3" fill="none" stroke="currentColor" opacity=".4"/><rect x="2" y="2" width="17" height="8" rx="1.8"/><path d="M24 4v4c.8-.3 1.4-1.1 1.4-2s-.6-1.7-1.4-2z" opacity=".5"/></svg>';

function renderDeviceStage() {
  const dev = DEVICE_VIEWS[state.view];
  const memberNo = new URLSearchParams(location.search).get('member') || MEMBERS[0].number;
  const src = `${location.pathname}?view=${dev.view}&embed=${dev.embed}&layout=map${dev.embed === 'app' ? `&member=${memberNo}` : ''}`;
  document.body.classList.add('device-mode');
  renderViewBar();
  const stage = $('#device-stage');
  stage.hidden = false;
  stage.innerHTML = `
    <div class="device-caption">
      <h1>${VIEWS[state.view]}</h1>
      <p>${dev.embed === 'web'
        ? 'unisuper.com.au in a phone browser, not logged in. Same page as desktop, responsive layout.'
        : 'The UniSuper app\'s More tab, with a new <strong>Find a location</strong> row under Support. Tap it to open the locator. The member is already signed in, so it starts from their home address.'}</p>
      ${dev.embed === 'app' ? `
        <label class="field">Signed in as
          <select class="input" id="device-member">${MEMBERS.map(m => `<option value="${m.number}" ${m.number === memberNo ? 'selected' : ''}>${esc(fullName(m))}, ${esc(m.home.suburb)} ${m.home.state}</option>`).join('')}</select>
        </label>` : ''}
      <a class="link" href="${src}" target="_blank" rel="noopener">Open the framed page on its own</a>
    </div>
    <div class="phone phone-${dev.embed}">
      <div class="phone-screen">
        <div class="phone-status"><span>9:41</span><span class="phone-island"></span><span class="phone-icons">${STATUS_ICONS}</span></div>
        ${dev.embed === 'web' ? `<div class="phone-urlbar"><span>${icon('lock', 'icon-xs')} ${dev.url}</span></div>` : ''}
        <iframe src="${src}" title="${VIEWS[state.view]} preview"></iframe>
        ${dev.embed === 'web' ? `<div class="phone-browserbar" aria-hidden="true"><span>‹</span><span>›</span><span>⬆</span><span>▢</span></div>` : ''}
        <div class="phone-home" aria-hidden="true"></div>
      </div>
    </div>`;
  $('#device-member')?.addEventListener('change', e => {
    location.href = `${location.pathname}?view=${state.view}&member=${e.target.value}`;
  });
}

// Inside the app frame: recreate the UniSuper app's More tab, with the locator as a
// new "Find a location" row under Support. Rows other than that one are inert.
const APP_SECTIONS = [
  ['Account', [['contributions', 'Contributions'], ['retirement', 'Retirement planning'], ['statement', 'Statements and summaries'], ['insurance', 'Insurance'], ['beneficiaries', 'Beneficiaries'], ['forms', 'Forms and tools']]],
  ['Details and preferences', [['smile', 'Personal details'], ['inbox', 'Inbox'], ['tools', 'Settings']]],
  ['Support', [['pin', 'Find a location', 'locator'], ['phone', 'Contact us'], ['help', 'Help and FAQs']]],
];

function renderAppChrome() {
  const rows = items => items.map(([ic, label, target]) => `
    <li><button class="app-row ${target ? 'is-new' : ''}" data-action="${target ? 'app-screen' : 'noop'}" ${target ? `data-screen="${target}"` : ''}>
      ${icon(ic, 'app-row-icon')}<span>${label}</span>${target ? '<span class="app-new">New</span>' : ''}${icon('chevron', 'app-chevron')}
    </button></li>`).join('');
  document.body.insertAdjacentHTML('afterbegin', `
    <header class="app-head">
      <button class="app-head-back" data-action="app-screen" data-screen="more" aria-label="Back to More">${icon('back')}</button>
      <span class="app-head-title"></span>
    </header>
    <section id="app-more" class="app-more" aria-label="More">
      ${APP_SECTIONS.map(([title, items]) => `<h2 class="app-section" ${title === 'Support' ? 'id="app-support"' : ''}>${title}</h2><ul class="app-list">${rows(items)}</ul>`).join('')}
    </section>`);
  document.body.insertAdjacentHTML('beforeend', `
    <nav class="app-tabs" aria-label="App">
      <a href="#" data-action="noop">${icon('wallet')}<span>Overview</span></a>
      <a href="#" data-action="noop">${icon('pie')}<span>Investments</span></a>
      <a href="#" data-action="noop">${icon('statement')}<span>Transactions</span></a>
      <a href="#" data-action="app-screen" data-screen="more" aria-current="page" class="is-on">${icon('dots')}<span>More</span></a>
    </nav>`);
  setAppScreen(new URLSearchParams(location.search).get('screen') === 'locator' ? 'locator' : 'more');
}

function setAppScreen(screen) {
  if (screen === 'more' && state.selectedId) deselect();
  document.body.dataset.appScreen = screen;
  document.querySelector('.app-head-title').textContent = screen === 'more' ? 'More' : 'Find a location';
  window.scrollTo(0, 0);
  if (screen === 'more') {
    // Bring the Support section (where the new row lives) into view.
    requestAnimationFrame(() => document.querySelector('#app-support + .app-list')?.scrollIntoView({ block: 'end' }));
    return;
  }
  // The map was laid out while hidden; re-fit now it has a size.
  requestAnimationFrame(() => {
    if (!state.mapReady) return;
    if (state.origin) M.fitTo([state.origin, ...sortedResults().slice(0, 4)]);
    else M.resetView();
  });
}

// ── Boot ─────────────────────────────────────────────────────────────────

async function boot() {
  if (EMBED) {
    document.body.dataset.embed = EMBED;
    // A framed preview should always open at the top, not where the last visit left off.
    history.scrollRestoration = 'manual';
    window.scrollTo(0, 0);
  }
  if (!EMBED && DEVICE_VIEWS[state.view]) { renderDeviceStage(); return; }
  renderSheetShell();
  if (EMBED === 'app') renderAppChrome();
  els.locator.dataset.layout = state.layout;
  setView(state.view);
  if (!G.hasKey(CONFIG.GOOGLE_MAPS_API_KEY)) {
    state.notice = 'no-key';
    renderNotice();
    els.map.innerHTML = `<div class="map-placeholder">${icon('pin', 'icon-lg')}<p>The map needs a Google Maps key. See the README.</p></div>`;
    return;
  }
  try {
    const ok = await G.init(CONFIG.GOOGLE_MAPS_API_KEY, {
      onAuthFailure: () => { state.notice = 'auth'; state.mapReady = false; renderNotice(); },
    });
    if (!ok) throw new Error('Maps library unavailable');
    M.createMap(els.map, LOCATIONS, id => selectLocation(id));
    state.mapReady = true;
    syncMap();
    if (state.origin) {
      M.setOrigin(state.origin);
      M.fitTo([state.origin, ...sortedResults().slice(0, 4)]);
      refreshTravel();
    }
  } catch (err) {
    console.error(err);
    state.notice = 'load-failed';
    renderNotice();
  }
}

boot();

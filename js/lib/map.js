import { getLibs } from './google.js';

const BLUE = '#0E71F2';

// Greyscale basemap, matching the live site's monochrome map; colour comes from the markers.
const MAP_STYLE = [
  { stylers: [{ saturation: -100 }] },
  { elementType: 'geometry', stylers: [{ color: '#f2f2f2' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#737373' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#ffffff' }, { weight: 3 }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#dcdcdc' }] },
  { featureType: 'water', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#ffffff' }] },
  { featureType: 'road', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#e3e3e3' }] },
  { featureType: 'road.arterial', elementType: 'labels', stylers: [{ visibility: 'simplified' }] },
  { featureType: 'administrative.province', elementType: 'geometry.stroke', stylers: [{ color: '#b5b5b5' }, { weight: 1 }] },
  { featureType: 'administrative.locality', elementType: 'labels.text.fill', stylers: [{ color: '#5c5c5c' }] },
  { featureType: 'administrative.neighborhood', stylers: [{ visibility: 'off' }] },
];

const svgUrl = s => `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(s)}`;

// Same construction as the live site's markers: light pin with drop shadow holding a
// gradient disc — navy→blue for offices, teal for campuses.
const GRADIENTS = {
  office: ['#112C5C', '#0E71F2'],
  campus: ['#22828F', '#38BDAD'],
  selected: ['#0B4FB3', '#3D8EF7'],
};
const GLYPH = {
  office: '<path d="M-4.5 4.5v-8h9v8M-2.5-1.5h1.6M.9-1.5h1.6M-2.5 1.2h1.6M.9 1.2h1.6" stroke="#fff" stroke-width="1.3" fill="none" stroke-linecap="round"/>',
  campus: '<path d="M-5.5-1L0-3.8 5.5-1 0 1.8zM-3.2.2v2.4c1.9 1.2 4.5 1.2 6.4 0V.2" stroke="#fff" stroke-width="1.2" fill="none" stroke-linejoin="round"/>',
};

export function markerSvg(type, selected = false, ring = false) {
  const big = type === 'office' || selected || ring;
  const [w, h] = big ? [44, 56] : [32, 42];
  const R = big ? 17 : 12.5;          // pin head radius
  const r = R - 2;                    // gradient disc radius
  const cx = w / 2;
  const cy = R + 4;
  const tip = h - 5;
  const [c1, c2] = GRADIENTS[selected ? 'selected' : type];
  const pin = `M${cx} ${tip}C${cx - 2} ${tip - 6} ${cx - R} ${cy + R * 0.62} ${cx - R} ${cy}A${R} ${R} 0 1 1 ${cx + R} ${cy}C${cx + R} ${cy + R * 0.62} ${cx + 2} ${tip - 6} ${cx} ${tip}Z`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs><linearGradient id="g" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient><filter id="s" x="-50%" y="-30%" width="200%" height="170%"><feDropShadow dx="0" dy="2" stdDeviation="2" flood-opacity=".35"/></filter></defs><path d="${pin}" fill="#F5F5F5" filter="url(#s)"/><circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#g)"/>${ring ? `<circle cx="${cx}" cy="${cy}" r="${R + 0.5}" fill="none" stroke="${BLUE}" stroke-width="2.5"/>` : ''}<g transform="translate(${cx} ${cy}) scale(${big ? 1.35 : 1})">${GLYPH[type]}</g></svg>`;
  return { svg, w, h, tip };
}

function markerIcon(type, selected, ring) {
  const { svg, w, h, tip } = markerSvg(type, selected, ring && !selected);
  const scale = selected || ring ? 1.12 : 1;
  return {
    url: svgUrl(svg),
    scaledSize: new google.maps.Size(w * scale, h * scale),
    anchor: new google.maps.Point((w * scale) / 2, tip * scale),
  };
}

function originIcon(kind) {
  const inner = kind === 'home'
    ? '<path d="M11 18.5l7-5.5 7 5.5M13 17.5v6h10v-6" fill="none" stroke="#fff" stroke-width="2" stroke-linejoin="round"/>'
    : '<circle cx="18" cy="18" r="5" fill="#fff"/>';
  return {
    url: svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36"><circle cx="18" cy="18" r="17" fill="${BLUE}" fill-opacity=".18"/><circle cx="18" cy="18" r="11" fill="${BLUE}" stroke="#fff" stroke-width="2.5"/>${inner}</svg>`),
    scaledSize: new google.maps.Size(36, 36),
    anchor: new google.maps.Point(18, 18),
  };
}

// Clusters only ever contain campuses, so they use the campus teal.
function clusterIcon(count) {
  const s = count < 4 ? 34 : count < 8 ? 40 : 46;
  return {
    url: svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="46" height="46" viewBox="0 0 46 46"><defs><linearGradient id="c" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#22828F"/><stop offset="1" stop-color="#38BDAD"/></linearGradient></defs><circle cx="23" cy="23" r="22" fill="#22828F" fill-opacity=".18"/><circle cx="23" cy="23" r="16" fill="url(#c)" stroke="#F5F5F5" stroke-width="2.5"/></svg>`),
    scaledSize: new google.maps.Size(s, s),
    anchor: new google.maps.Point(s / 2, s / 2),
  };
}

let map, clusterer, originMarker, routeLines = [];
const markers = new Map();
const locs = new Map();
let visibleIds = new Set();
let selectedId = null;
let highlightId = null;

const iconFor = loc => markerIcon(loc.type, loc.id === selectedId, loc.id === highlightId);
// Offices always sit above campus clusters; the selected pin above everything.
const Z = { campus: 10, cluster: 1000, office: 2000, origin: 2500, selected: 3000 };
const baseZ = loc => (loc.type === 'office' ? Z.office : Z.campus);
const AUSTRALIA = { center: { lat: -28.5, lng: 134 }, zoom: 4 };
// Whole-of-Australia zoom that fits the map's width (phones need one level further out).
const auZoom = el => ((el || map.getDiv()).clientWidth < 560 ? 3 : AUSTRALIA.zoom);

// ── Smooth camera ────────────────────────────────────────────────────────
// Raster maps jump (and show blurry tiles) when the zoom changes by several levels
// at once. Instead: zoom out until both ends are on screen, pan, then zoom in one
// level at a time so each step animates and tiles load progressively.

const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
let flight = 0;

const wait = ms => new Promise(r => setTimeout(r, ms));

// Wait until the map's current animation has finished: Google drops an animation (and
// jumps) if the next zoom or pan starts while one is still running. Resolves on the
// map's 'idle' event, but no sooner than `min` ms and no later than `max` ms.
function settled(min, max) {
  return new Promise(resolve => {
    const start = performance.now();
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      listener.remove();
      clearTimeout(timer);
      setTimeout(resolve, Math.max(0, min - (performance.now() - start)));
    };
    const listener = google.maps.event.addListenerOnce(map, 'idle', finish);
    const timer = setTimeout(finish, max);
  });
}
const toLatLng = p => (p instanceof google.maps.LatLng ? p : new google.maps.LatLng(p.lat, p.lng));

function zoomForBounds(bounds, pad = 60) {
  const div = map.getDiv();
  const w = Math.max(div.clientWidth - pad * 2, 50);
  const h = Math.max(div.clientHeight - pad * 2, 50);
  const ne = bounds.getNorthEast();
  const sw = bounds.getSouthWest();
  const latRad = lat => { const s = Math.sin((lat * Math.PI) / 180); return Math.max(Math.min(Math.log((1 + s) / (1 - s)) / 2, Math.PI), -Math.PI) / 2; };
  const latFrac = Math.max((latRad(ne.lat()) - latRad(sw.lat())) / Math.PI, 1e-9);
  let lngDiff = ne.lng() - sw.lng();
  if (lngDiff < 0) lngDiff += 360;
  const lngFrac = Math.max(lngDiff / 360, 1e-9);
  const z = (px, frac) => Math.floor(Math.log(px / 256 / frac) / Math.LN2);
  return Math.max(3, Math.min(z(h, latFrac), z(w, lngFrac), 18));
}

// Google glides a pan smoothly (GPU, no redraw) only when it is shorter than the map's
// width and height, and only when no other animation is running; otherwise it jumps.
// True when the move from `a` to `b` at `zoom` is comfortably inside that limit.
function glidable(a, b, zoom) {
  const proj = map.getProjection();
  if (!proj) return true;
  const pa = proj.fromLatLngToPoint(a);
  const pb = proj.fromLatLngToPoint(b);
  const scale = 2 ** zoom;
  const div = map.getDiv();
  return Math.abs(pa.x - pb.x) * scale < div.clientWidth * 0.75
    && Math.abs(pa.y - pb.y) * scale < div.clientHeight * 0.75;
}

export async function flyTo(target, targetZoom) {
  if (!map) return;
  const id = ++flight;
  const dest = toLatLng(target);
  if (reduceMotion) { map.setCenter(dest); map.setZoom(targetZoom); return; }

  // 1. Zoom out, one animated level at a time, until the trip is short enough on screen
  //    for Google to glide it — and at least to the final zoom if that is wider (e.g. a
  //    cross-country route), so the flight never zooms out again after the glide.
  let zoomedOut = false;
  while (map.getZoom() > 3 && (map.getZoom() > targetZoom || !glidable(map.getCenter(), dest, map.getZoom()))) {
    map.setZoom(map.getZoom() - 1);
    zoomedOut = true;
    await wait(140);
    if (id !== flight) return;
  }
  // 2. Glide across with Google's own animation, but only once the last zoom has finished
  //    (starting it mid-zoom is what caused the jump), then let the glide finish.
  if (!map.getCenter().equals(dest)) {
    if (zoomedOut) await settled(150, 400);
    if (id !== flight) return;
    map.panTo(dest);
    await settled(350, 1000);
    if (id !== flight) return;
  }
  // 3. Zoom in (or out, if the target is wider) one level at a time. The centre is already
  //    on the destination, so each step zooms in place.
  while (map.getZoom() !== targetZoom) {
    map.setZoom(map.getZoom() + (map.getZoom() < targetZoom ? 1 : -1));
    await wait(200);
    if (id !== flight) return;
  }
}

export function flyToBounds(bounds, { maxZoom = 15, pad = 60 } = {}) {
  if (!map) return;
  return flyTo(bounds.getCenter(), Math.min(zoomForBounds(bounds, pad), maxZoom));
}

export function createMap(el, locations, onSelect) {
  const { maps, marker } = getLibs();
  map = new maps.Map(el, {
    center: AUSTRALIA.center, zoom: auZoom(el), minZoom: 3,
    styles: MAP_STYLE, clickableIcons: false,
    // The map moves the way people expect: one finger on phones, the plain mouse wheel on
    // desktop ("use two fingers" / "Ctrl + scroll" confused people). The page still scrolls
    // around it: on phones the search box sits above and the map is under half the screen;
    // on desktop the results panel and the rest of the page sit beside and below it.
    gestureHandling: 'greedy',
    mapTypeControl: false, streetViewControl: false, fullscreenControl: false,
    zoomControlOptions: { position: google.maps.ControlPosition.RIGHT_TOP },
  });

  for (const loc of locations) {
    const m = new marker.Marker({
      position: { lat: loc.lat, lng: loc.lng },
      title: `${loc.name} (${loc.type === 'office' ? 'office' : 'campus'})`,
      icon: markerIcon(loc.type, false, false),
      zIndex: baseZ(loc),
      optimized: false,
    });
    m.addListener('click', () => onSelect(loc.id));
    markers.set(loc.id, m);
    locs.set(loc.id, loc);
  }

  const MC = window.markerClusterer;
  if (MC?.MarkerClusterer) {
    clusterer = new MC.MarkerClusterer({
      map,
      markers: [],
      algorithm: new MC.SuperClusterAlgorithm({ radius: 50, maxZoom: 11 }),
      renderer: {
        render: ({ count, position }) => new marker.Marker({
          position, icon: clusterIcon(count), zIndex: Z.cluster + count,
          label: { text: String(count), color: '#fff', fontSize: '13px', fontWeight: '600' },
          title: `${count} campuses — click to zoom in`,
        }),
      },
      onClusterClick: (_event, cluster) => flyToBounds(cluster.bounds, { maxZoom: 14, pad: 80 }),
    });
  }
  setVisible(locations.map(l => l.id));
  return map;
}

function syncMarkers() {
  if (!map) return;
  // Clear first: the clusterer detaches every marker it held, including a newly selected one.
  clusterer?.clearMarkers(true);
  const clustered = [];
  for (const [id, m] of markers) {
    const show = visibleIds.has(id);
    if (!show) { m.setMap(null); continue; }
    // Offices are never clustered; only campuses group into numbered clusters.
    if (id === selectedId || id === highlightId || locs.get(id).type === 'office' || !clusterer) { m.setMap(map); continue; }
    clustered.push(m);
  }
  clusterer?.addMarkers(clustered);
}

export function setVisible(ids) {
  visibleIds = new Set(ids);
  syncMarkers();
}

function restyle(id) {
  if (!id || !markers.has(id)) return;
  const loc = locs.get(id);
  const m = markers.get(id);
  m.setIcon(iconFor(loc));
  m.setZIndex(id === selectedId ? Z.selected : id === highlightId ? Z.selected - 1 : baseZ(loc));
}

export function setSelected(id) {
  if (!map) return;
  const prev = selectedId;
  selectedId = id;
  restyle(prev);
  restyle(id);
  syncMarkers();
}

// A persistent emphasis (e.g. the location closest to the member) separate from selection.
export function setHighlighted(id) {
  if (!map || id === highlightId) return;
  const prev = highlightId;
  highlightId = id || null;
  restyle(prev);
  restyle(highlightId);
  syncMarkers();
}

export function setOrigin(origin) {
  if (!map) return;
  originMarker?.setMap(null);
  originMarker = null;
  if (!origin) return;
  const { marker } = getLibs();
  const home = ['home', 'postal', 'member-number'].includes(origin.source);
  originMarker = new marker.Marker({
    map, position: { lat: origin.lat, lng: origin.lng }, icon: originIcon(home ? 'home' : 'dot'),
    title: home ? 'Home address' : 'Starting point', zIndex: Z.origin,
  });
}

export function fitTo(points, { maxZoom = 13 } = {}) {
  if (!map || !points.length) return;
  if (points.length === 1) return flyTo(points[0], maxZoom);
  const b = new google.maps.LatLngBounds();
  points.forEach(p => b.extend(p));
  return flyToBounds(b, { maxZoom });
}

export const hasMap = () => !!map;
export const getMap = () => map;

export function resetView() {
  if (map) flyTo(AUSTRALIA.center, auZoom());
}

export function focusLocation(loc) {
  if (!map) return;
  const inView = map.getBounds()?.contains(loc) && map.getZoom() >= 12;
  if (!inView) flyTo(loc, Math.max(map.getZoom(), 14));
}

export function clearRoute() {
  routeLines.forEach(l => l.setMap(null));
  routeLines = [];
}

export function drawRoute(path, { estimated = false } = {}) {
  clearRoute();
  if (!map || !path?.length) return;
  if (estimated) {
    routeLines.push(new google.maps.Polyline({
      map, path, geodesic: true, strokeOpacity: 0, zIndex: 5,
      icons: [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: 0.8, strokeColor: BLUE, scale: 3 }, offset: '0', repeat: '14px' }],
    }));
  } else {
    routeLines.push(new google.maps.Polyline({ map, path, strokeColor: '#ffffff', strokeWeight: 8, strokeOpacity: 0.9, zIndex: 4 }));
    routeLines.push(new google.maps.Polyline({ map, path, strokeColor: BLUE, strokeWeight: 4.5, strokeOpacity: 0.95, zIndex: 5 }));
  }
  const b = new google.maps.LatLngBounds();
  path.forEach(p => b.extend(p));
  flyToBounds(b, { maxZoom: 16, pad: 70 });
}

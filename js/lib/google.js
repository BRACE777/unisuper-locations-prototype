// Thin wrapper over Google Maps Platform with graceful fallbacks:
//   travel times: Routes API (computeRouteMatrix) → legacy Distance Matrix → caller's estimate
//   route line:   Routes API (computeRoutes)      → legacy Directions       → none
//   autocomplete: Places API (New) suggestions    → none (search falls back to Geocoder)

let libs = null;
let apiKey = '';
const broken = { routes: false, legacyMatrix: false, legacyDirections: false, places: false };
let sessionToken = null;

export const hasKey = k => !!k && !/^YOUR_/i.test(k);
export const isReady = () => !!libs?.maps;
export const getLibs = () => libs;

// Google's dynamic library bootstrap loader (https://developers.google.com/maps/documentation/javascript/load-maps-js-api)
function bootstrap(g) {
  /* eslint-disable */
  var h,a,k,p="The Google Maps JavaScript API",c="google",l="importLibrary",q="__ib__",m=document,b=window;b=b[c]||(b[c]={});var d=b.maps||(b.maps={}),r=new Set,e=new URLSearchParams,u=()=>h||(h=new Promise(async(f,n)=>{await (a=m.createElement("script"));e.set("libraries",[...r]+"");for(k in g)e.set(k.replace(/[A-Z]/g,t=>"_"+t[0].toLowerCase()),g[k]);e.set("callback",c+".maps."+q);a.src=`https://maps.${c}apis.com/maps/api/js?`+e;d[q]=f;a.onerror=()=>h=n(Error(p+" could not load."));a.nonce=m.querySelector("script[nonce]")?.nonce||"";m.head.append(a)}));d[l]?console.warn(p+" only loads once. Ignoring:",g):d[l]=(f,...n)=>r.add(f)&&u().then(()=>d[l](f,...n));
  /* eslint-enable */
}

export async function init(key, { onAuthFailure } = {}) {
  apiKey = key;
  window.gm_authFailure = () => onAuthFailure?.();
  bootstrap({ key, v: 'weekly', region: 'AU', language: 'en-AU' });
  const names = ['maps', 'marker', 'geocoding', 'places', 'routes', 'geometry'];
  const loaded = await Promise.all(names.map(n => google.maps.importLibrary(n).catch(() => null)));
  libs = Object.fromEntries(names.map((n, i) => [n, loaded[i]]));
  return isReady();
}

const cleanLabel = s => (s || '').replace(/,?\s*Australia$/, '');

export async function geocode(query) {
  if (!libs?.geocoding) return null;
  const q = query.trim();
  const req = /^\d{4}$/.test(q)
    ? { componentRestrictions: { country: 'AU', postalCode: q } }
    : { address: q, componentRestrictions: { country: 'AU' } };
  try {
    const { results } = await new libs.geocoding.Geocoder().geocode(req);
    const r = results?.[0];
    if (!r) return null;
    return { lat: r.geometry.location.lat(), lng: r.geometry.location.lng(), label: cleanLabel(r.formatted_address) };
  } catch (e) {
    console.warn('[geocode]', e);
    return null;
  }
}

export async function reverseGeocode({ lat, lng }) {
  if (!libs?.geocoding) return null;
  try {
    const { results } = await new libs.geocoding.Geocoder().geocode({ location: { lat, lng } });
    const r = results.find(x => x.types.includes('locality')) || results[0];
    return r ? cleanLabel(r.formatted_address) : null;
  } catch {
    return null;
  }
}

export async function suggest(input) {
  const P = libs?.places;
  if (!P?.AutocompleteSuggestion || broken.places) return [];
  sessionToken ||= new P.AutocompleteSessionToken();
  try {
    const { suggestions } = await P.AutocompleteSuggestion.fetchAutocompleteSuggestions({
      input, sessionToken, includedRegionCodes: ['au'],
    });
    return suggestions.filter(s => s.placePrediction).slice(0, 5).map(s => ({
      main: s.placePrediction.mainText?.text ?? s.placePrediction.text.text,
      secondary: cleanLabel(s.placePrediction.secondaryText?.text ?? ''),
      prediction: s.placePrediction,
    }));
  } catch (e) {
    console.warn('[autocomplete] Places API (New) unavailable — falling back to geocoding on submit.', e);
    broken.places = true;
    return [];
  }
}

export async function resolveSuggestion(s) {
  const place = s.prediction.toPlace();
  await place.fetchFields({ fields: ['location', 'formattedAddress'] });
  sessionToken = null;
  return { lat: place.location.lat(), lng: place.location.lng(), label: cleanLabel(place.formattedAddress) };
}

// ── Travel times ─────────────────────────────────────────────────────────

const ROUTES_MODE = { drive: 'DRIVE', transit: 'TRANSIT', walk: 'WALK' };
const LEGACY_MODE = { drive: 'DRIVING', transit: 'TRANSIT', walk: 'WALKING' };
const latLng = p => ({ location: { latLng: { latitude: p.lat, longitude: p.lng } } });

async function routesMatrix(origin, dests, mode) {
  const body = { origins: [{ waypoint: latLng(origin) }], destinations: dests.map(d => ({ waypoint: latLng(d) })), travelMode: ROUTES_MODE[mode] };
  if (mode === 'drive') body.routingPreference = 'TRAFFIC_AWARE';
  const res = await fetch('https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'originIndex,destinationIndex,duration,distanceMeters,condition',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Routes API ${res.status}: ${await res.text()}`);
  const out = new Map();
  for (const el of await res.json()) {
    if (el.condition === 'ROUTE_EXISTS' && el.duration) {
      out.set(dests[el.destinationIndex].id, { seconds: parseInt(el.duration, 10), meters: el.distanceMeters });
    }
  }
  return out;
}

async function legacyMatrix(origin, dests, mode) {
  const svc = new libs.routes.DistanceMatrixService();
  const resp = await svc.getDistanceMatrix({
    origins: [origin], destinations: dests.map(d => ({ lat: d.lat, lng: d.lng })), travelMode: LEGACY_MODE[mode],
  });
  const out = new Map();
  resp.rows[0].elements.forEach((el, i) => {
    if (el.status === 'OK') out.set(dests[i].id, { seconds: el.duration.value, meters: el.distance.value });
  });
  return out;
}

// → { results: Map<id, {seconds, meters}>, source: 'routes' | 'distance-matrix' | 'estimate' }
export async function travelTimes(origin, dests, mode) {
  if (!isReady() || !dests.length) return { results: new Map(), source: 'estimate' };
  if (!broken.routes) {
    try { return { results: await routesMatrix(origin, dests, mode), source: 'routes' }; }
    catch (e) { console.warn('[travel] Routes API unavailable, trying legacy Distance Matrix.', e); broken.routes = true; }
  }
  if (!broken.legacyMatrix && libs.routes?.DistanceMatrixService) {
    try { return { results: await legacyMatrix(origin, dests, mode), source: 'distance-matrix' }; }
    catch (e) { console.warn('[travel] Distance Matrix unavailable, using estimates.', e); broken.legacyMatrix = true; }
  }
  return { results: new Map(), source: 'estimate' };
}

export async function routePath(origin, dest, mode) {
  if (!isReady()) return null;
  if (!broken.routes && libs.geometry) {
    try {
      const body = { origin: latLng(origin), destination: latLng(dest), travelMode: ROUTES_MODE[mode] };
      const res = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': 'routes.polyline.encodedPolyline' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const enc = (await res.json()).routes?.[0]?.polyline?.encodedPolyline;
        if (enc) return libs.geometry.encoding.decodePath(enc).map(p => ({ lat: p.lat(), lng: p.lng() }));
        return null;
      }
    } catch { /* fall through */ }
  }
  if (!broken.legacyDirections && libs.routes?.DirectionsService) {
    try {
      const r = await new libs.routes.DirectionsService().route({ origin, destination: { lat: dest.lat, lng: dest.lng }, travelMode: LEGACY_MODE[mode] });
      return r.routes[0].overview_path.map(p => ({ lat: p.lat(), lng: p.lng() }));
    } catch { broken.legacyDirections = true; }
  }
  return null;
}

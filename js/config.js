// The Google Maps key is kept out of the repository. It lives in js/config.local.js
// (git-ignored; on GitHub Pages the deploy workflow writes it from a repository secret).
// Without it the prototype still runs, using estimated travel times and no map.
let localKey = '';
try {
  ({ GOOGLE_MAPS_API_KEY: localKey } = await import('./config.local.js'));
} catch { /* no local key: run without Google */ }

export const CONFIG = {
  // Google Maps Platform browser key. Enable these APIs on the key's project:
  //   Maps JavaScript API, Places API (New), Geocoding API, Routes API
  // Restrict the key to your site's address (and http://localhost:5173/* for local use).
  GOOGLE_MAPS_API_KEY: localKey || 'YOUR_GOOGLE_MAPS_API_KEY',

  // Live travel times are requested for the N nearest locations (straight line);
  // the rest show an estimate. Keeps Routes API usage (and cost) low.
  NEAREST_WITH_LIVE_TIMES: 10,

  // Suggest a video/phone appointment when the nearest location is further than this by car.
  VIRTUAL_THRESHOLD_MINUTES: 90,

  // Consultant view: flag when the member's nearest office is further than this by car.
  OFFICE_FAR_MINUTES: 45,

  ADVICE_PHONE: '1800 823 842',
};

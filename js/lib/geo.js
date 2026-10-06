export function haversineKm(a, b) {
  const R = 6371;
  const toRad = d => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// Rough fallback when live routing isn't available. Road distance ≈ 1.3 × straight line.
export function estimateTravel(km, mode) {
  if (mode === 'drive') {
    const road = km * 1.3;
    const kmh = road < 15 ? 32 : road < 60 ? 50 : road < 200 ? 75 : 90;
    return { seconds: (road / kmh) * 3600 + 120, meters: road * 1000 };
  }
  if (mode === 'transit') {
    if (km > 200) return { seconds: null, meters: null };
    const road = km * 1.3;
    const kmh = road < 10 ? 16 : road < 30 ? 24 : road < 80 ? 40 : 55;
    return { seconds: (road / kmh) * 3600 + 600, meters: road * 1000 };
  }
  if (km > 25) return { seconds: null, meters: null };
  return { seconds: ((km * 1.25) / 4.8) * 3600, meters: km * 1250 };
}

export function fmtDistance(meters) {
  if (meters == null) return '';
  if (meters < 1000) return `${Math.round(meters / 10) * 10} m`;
  const km = meters / 1000;
  return km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km).toLocaleString('en-AU')} km`;
}

export function fmtDuration(seconds) {
  if (seconds == null) return '—';
  const mins = Math.max(1, Math.round(seconds / 60));
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h >= 10) return `${h} h`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export const originKey = o => `${o.lat.toFixed(5)},${o.lng.toFixed(5)}`;

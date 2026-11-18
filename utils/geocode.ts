/**
 * utils/geocode.ts — address ⇄ coordinates that work on Android, iOS AND web.
 *
 * expo-location's geocodeAsync / reverseGeocodeAsync are NOT available on web
 * (they throw), so on web we use OpenStreetMap's free Nominatim service.
 * On phones it still uses expo-location exactly as before.
 */
import { Platform } from "react-native";
import * as Location from "expo-location";

const NOMINATIM = "https://nominatim.openstreetmap.org";

/** Text address → { latitude, longitude } or null */
export async function geocodeText(text: string): Promise<{ latitude: number; longitude: number } | null> {
  const q = text.trim();
  if (!q) return null;
  if (Platform.OS !== "web") {
    const r = await Location.geocodeAsync(q);
    return r.length ? { latitude: r[0].latitude, longitude: r[0].longitude } : null;
  }
  const res = await fetch(`${NOMINATIM}/search?format=json&limit=1&countrycodes=in&q=${encodeURIComponent(q)}`, {
    headers: { "Accept-Language": "en" },
  });
  const data = await res.json();
  if (!Array.isArray(data) || !data.length) return null;
  return { latitude: Number(data[0].lat), longitude: Number(data[0].lon) };
}

/** Coordinates → human address ("Rajapeth, Amravati, Maharashtra"), or "lat, lng" if not found */
export async function reverseGeocode(lat: number, lng: number): Promise<string> {
  const fallback = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  try {
    if (Platform.OS !== "web") {
      const geo = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
      if (!geo.length) return fallback;
      const p = geo[0];
      const parts = [p.street || p.name, p.district || p.subregion, p.city || p.subregion, p.region].filter(Boolean);
      return parts.length ? parts.join(", ") : fallback;
    }
    const res = await fetch(`${NOMINATIM}/reverse?format=json&lat=${lat}&lon=${lng}`, {
      headers: { "Accept-Language": "en" },
    });
    const data = await res.json();
    const a = data?.address || {};
    const parts = [
      a.road || a.neighbourhood,
      a.suburb || a.city_district,
      a.city || a.town || a.village || a.county,
      a.state,
    ].filter(Boolean);
    return parts.length ? parts.join(", ") : data?.display_name || fallback;
  } catch {
    return fallback;
  }
}

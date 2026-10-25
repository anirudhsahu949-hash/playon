/**
 * utils/cities.ts — one place for everything "city" in PlayOn.
 *
 * Firestore: cities/{cityId}     (cityId = slug, e.g. "amravati", "nagpur")
 *   name        "Amravati"
 *   state       "Maharashtra"
 *   lat, lng    centre of the city
 *   radiusKm    how far from the centre still counts as this city (default 25)
 *   status      "live"        → shown to players, turfs listed
 *               "coming_soon" → shown in the city picker as "Coming soon"
 *               "hidden"      → admin only (setting a city up before launch)
 *   aliases     other names GPS / owners may use ("Amravati Division", "Badnera")
 *   isDefault   the city shown when we can't tell where a player is
 *   order       sort order in the picker (lower first)
 *
 * Every turf gets:  cityId, cityName, locality (+ latitude/longitude it already had)
 * Every player gets: users/{uid}.cityId, cityName  (guests: kept on the phone)
 *
 * cityWaitlist/{cityKey}_{who}  — "Notify me when PlayOn is live in <city>"
 *   cityKey, cityName, uid ("" for guests), lat, lng, createdAt
 */
import { collection, getDocs, doc, setDoc, serverTimestamp } from "firebase/firestore";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { db, auth } from "../firebaseConfig";

export type CityStatus = "live" | "coming_soon" | "hidden";

export type City = {
  id: string;
  name: string;
  state: string;
  lat: number | null;
  lng: number | null;
  radiusKm: number;
  status: CityStatus;
  aliases: string[];
  isDefault?: boolean;
  order?: number;
};

export const DEFAULT_RADIUS_KM = 25;

export const CITY_STATUS_META: Record<CityStatus, { label: string; color: string; bg: string }> = {
  live:        { label: "Live",        color: "#15803D", bg: "#DCFCE7" },
  coming_soon: { label: "Coming soon", color: "#B45309", bg: "#FEF3C7" },
  hidden:      { label: "Hidden",      color: "#6B7280", bg: "#F3F4F6" },
};

// "Navi Mumbai" → "navi-mumbai"
export function citySlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function toCity(id: string, d: any): City {
  return {
    id,
    name: String(d?.name || id),
    state: String(d?.state || ""),
    lat: typeof d?.lat === "number" ? d.lat : null,
    lng: typeof d?.lng === "number" ? d.lng : null,
    radiusKm: Number(d?.radiusKm) > 0 ? Number(d.radiusKm) : DEFAULT_RADIUS_KM,
    status: (["live", "coming_soon", "hidden"].includes(d?.status) ? d.status : "hidden") as CityStatus,
    aliases: Array.isArray(d?.aliases) ? d.aliases.map(String) : [],
    isDefault: !!d?.isDefault,
    order: typeof d?.order === "number" ? d.order : 999,
  };
}

export function sortCities(list: City[]): City[] {
  return [...list].sort(
    (a, b) => (a.order ?? 999) - (b.order ?? 999) || a.name.localeCompare(b.name)
  );
}

/**
 * Closest city to a point. With `withinRadiusOnly` (default) a city only
 * counts if the point is inside its radius — so a turf in a town we haven't
 * set up doesn't get forced into the nearest big city.
 */
export function nearestCity(
  lat: number, lng: number, cities: City[], withinRadiusOnly = true,
): { city: City; km: number } | null {
  let best: { city: City; km: number } | null = null;
  for (const c of cities) {
    if (c.lat == null || c.lng == null) continue;
    const km = haversineKm(lat, lng, c.lat, c.lng);
    if (withinRadiusOnly && km > c.radiusKm) continue;
    if (!best || km < best.km) best = { city: c, km };
  }
  return best;
}

/** Match free text ("Amravati", "amravati division", "Badnera") to a city. */
export function matchCityByName(text: string, cities: City[]): City | null {
  const t = (text || "").trim().toLowerCase();
  if (!t) return null;
  const names = (c: City) => [c.name, c.id, ...c.aliases].map((x) => x.trim().toLowerCase()).filter(Boolean);
  // exact name / alias first, then "contains" (e.g. "Rajapeth, Amravati")
  return (
    cities.find((c) => names(c).includes(t)) ||
    cities.find((c) => names(c).some((n) => n.length >= 4 && t.includes(n))) ||
    null
  );
}

/** Best guess for a turf: pin inside a city radius → text match → none. */
export function guessCity(
  opts: { lat?: number | null; lng?: number | null; text?: string },
  cities: City[],
): City | null {
  if (opts.lat != null && opts.lng != null) {
    const hit = nearestCity(opts.lat, opts.lng, cities, true);
    if (hit) return hit.city;
  }
  return matchCityByName(opts.text || "", cities);
}

// ── Cached read (cities change rarely — 10 min cache, force to refresh) ─────
let _citiesCache: { data: City[]; fetchedAt: number } | null = null;
const CITIES_TTL = 10 * 60 * 1000;

export async function fetchCities(force = false): Promise<City[]> {
  if (!force && _citiesCache && Date.now() - _citiesCache.fetchedAt < CITIES_TTL) {
    return _citiesCache.data;
  }
  const snap = await getDocs(collection(db, "cities"));
  const data = sortCities(snap.docs.map((d) => toCity(d.id, d.data())));
  _citiesCache = { data, fetchedAt: Date.now() };
  return data;
}

export function clearCitiesCache() {
  _citiesCache = null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Player's chosen city — on the user doc (logged in) + on the phone (everyone)
// ─────────────────────────────────────────────────────────────────────────────
const CITY_KEY  = "playon.city.v1";        // { id, name }
const GUEST_KEY = "playon.guestId.v1";     // random id so a guest's waitlist entry isn't duplicated
const ASKED_KEY = "playon.cityAsked.v1";   // "1" once we've shown the first-open / not-live sheet

export async function wasCityAsked(): Promise<boolean> {
  try { return (await AsyncStorage.getItem(ASKED_KEY)) === "1"; } catch { return false; }
}
export async function markCityAsked(): Promise<void> {
  try { await AsyncStorage.setItem(ASKED_KEY, "1"); } catch {}
}

// id = Live PlayOn city. id "" = the player is somewhere PlayOn isn't live yet
// (name = that place, e.g. "Pune") → Home shows "PlayOn is coming to Pune".
export type SavedCity = { id: string; name: string };

export async function getSavedCity(): Promise<SavedCity | null> {
  try {
    const raw = await AsyncStorage.getItem(CITY_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    if (!v || (!v.id && !v.name)) return null;
    return { id: String(v.id || ""), name: String(v.name || v.id) };
  } catch { return null; }
}

/** GPS found a place where PlayOn isn't live. Never throws. */
export async function saveNotLiveCity(name: string): Promise<void> {
  try { await AsyncStorage.setItem(CITY_KEY, JSON.stringify({ id: "", name })); } catch {}
  const uid = auth.currentUser?.uid;
  if (uid) {
    try { await setDoc(doc(db, "users", uid), { cityId: "", cityName: "" }, { merge: true }); } catch {}
  }
}

/** Saves on the phone always, and on users/{uid} when logged in. Never throws. */
export async function saveCityChoice(city: City): Promise<void> {
  try { await AsyncStorage.setItem(CITY_KEY, JSON.stringify({ id: city.id, name: city.name })); } catch {}
  const uid = auth.currentUser?.uid;
  if (uid) {
    try { await setDoc(doc(db, "users", uid), { cityId: city.id, cityName: city.name }, { merge: true }); } catch {}
  }
}

/** Where is this point? live = a Live city it falls in; nearest = closest Live city (any distance). */
export function resolveCity(lat: number, lng: number, gpsCityName: string, cities: City[]) {
  const live = cities.filter((c) => c.status === "live");
  const hit = guessCity({ lat, lng, text: gpsCityName }, live);
  return {
    live: hit,
    nearest: hit ? null : nearestCity(lat, lng, live, false),
  };
}

async function whoAmI(): Promise<string> {
  const uid = auth.currentUser?.uid;
  if (uid) return uid;
  try {
    let g = await AsyncStorage.getItem(GUEST_KEY);
    if (!g) {
      g = "guest_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
      await AsyncStorage.setItem(GUEST_KEY, g);
    }
    return g;
  } catch { return "guest_" + Date.now().toString(36); }
}

/** "Notify me when PlayOn is live in <city>". One entry per person per city. */
export async function joinCityWaitlist(cityName: string, lat?: number | null, lng?: number | null): Promise<boolean> {
  const name = cityName.trim();
  const key = citySlug(name);
  if (!key) return false;
  try {
    const who = await whoAmI();
    await setDoc(doc(db, "cityWaitlist", `${key}_${who}`), {
      cityKey: key,
      cityName: name,
      uid: auth.currentUser?.uid || "",
      lat: lat ?? null,
      lng: lng ?? null,
      createdAt: serverTimestamp(),
    });
    return true;
  } catch { return false; }
}

// ─────────────────────────────────────────────────────────────────────────────
// Player's GPS point — saved on the phone so Home / Explore can measure exact
// distances after the City Picker screen found it (guests included).
// ─────────────────────────────────────────────────────────────────────────────
const COORDS_KEY = "playon.coords.v1";     // { lat, lng, at }

export async function saveCoords(lat: number, lng: number): Promise<void> {
  try { await AsyncStorage.setItem(COORDS_KEY, JSON.stringify({ lat, lng, at: Date.now() })); } catch {}
}

export async function getSavedCoords(): Promise<{ lat: number; lng: number } | null> {
  try {
    const raw = await AsyncStorage.getItem(COORDS_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    return typeof v?.lat === "number" && typeof v?.lng === "number" ? { lat: v.lat, lng: v.lng } : null;
  } catch { return null; }
}
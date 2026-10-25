import {
  View,
  Text,
  TextInput,
  FlatList,
  TouchableOpacity,
  Image,
  StyleSheet,
  StatusBar,
  ActivityIndicator,
  Platform,
  ScrollView,
  Alert,
  RefreshControl,
  Modal,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { db, auth } from "../../firebaseConfig";
import { collection, getDocs, query, where, doc, getDoc, setDoc, arrayUnion, arrayRemove } from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import { getSavedCity, getSavedCoords } from "../../utils/cities";   // 🏙️ all-India
import { DEFAULT_TURF_IMAGE, hasPrice } from "../../utils/turfDisplay";   // no photo / no price
import { Ionicons } from "@expo/vector-icons";
import GymCardGrid from "../../components/screen-gym/gym-card-grid";  // ✅ Grid version for explore

const TODAY_STRING = new Date().toDateString();

const SPORT_STYLE: Record<string, { color: string; icon: keyof typeof Ionicons.glyphMap }> = {
  Football:   { color: "#0B1220", icon: "football-outline" },
  Cricket:    { color: "#16A34A", icon: "baseball-outline" },
  Badminton:  { color: "#7C3AED", icon: "tennisball-outline" },
  Basketball: { color: "#EA580C", icon: "basketball-outline" },
  Tennis:     { color: "#65A30D", icon: "tennisball-outline" },
  Volleyball: { color: "#0EA5E9", icon: "ellipse-outline" },
  Kabaddi:    { color: "#B45309", icon: "body-outline" },
  Hockey:     { color: "#0891B2", icon: "fitness-outline" },
  Swimming:   { color: "#0284C7", icon: "water-outline" },
  Boxing:     { color: "#DC2626", icon: "fitness-outline" },
  Pickleball: { color: "#0891B2", icon: "tennisball-outline" },
};
const SPORT_FALLBACK = { color: "#6B7280", icon: "ellipse-outline" as const };

function getSportCfg(sport: string) {
  const key = Object.keys(SPORT_STYLE).find(k => k.toLowerCase() === sport.toLowerCase());
  return key ? SPORT_STYLE[key] : SPORT_FALLBACK;
}

function toTitleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

// ── One place to read a turf's sports ────────────────────────────────────────
// Handles every shape stored in Firestore:
//   ["Cricket", "Football"]  → array
//   "Cricket, Football"      → comma string
//   "cricket"                → single string
// Returns clean, Title Case, de-duplicated names: ["Cricket", "Football"]
function getSports(t: { sport?: string | string[] }): string[] {
  const raw: string[] = Array.isArray(t.sport)
    ? t.sport.flatMap(s => String(s).split(","))
    : typeof t.sport === "string"
      ? t.sport.split(",")
      : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of raw) {
    const name = toTitleCase(r.trim());
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push(name);
  }
  return out;
}

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R    = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a    =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function fmtDist(km: number): string {
  if (km < 1)  return `${Math.round(km * 1000)} m`;
  if (km < 10) return `${km.toFixed(1)} km`;
  return `${Math.round(km)} km`;
}

type SlotStatus = "available" | "booked" | "blocked" | "past";

type Slot = {
  label: string;
  time: string;
  start: number;
  price: number;
  status: SlotStatus;
};

type Turf = {
  id: string;
  name?: string;
  location?: string;
  sport?: string | string[];
  dayPrice?: number;
  nightPrice?: number;
  bookingPrice?: number;
  price?: number;
  image?: string;
  images?: string[];
  openingTime?: number;
  closingTime?: number;
  lateCutoffHours?: number;
  slots?: Slot[];
  slotsLoading?: boolean;
  latitude?: number | null;
  longitude?: number | null;
  distanceKm?: number | null;
  bookingMode?: "online" | "phone" | "both";
  bookingPhone?: string;
  facilities?: string[];
};


// ─────────────────────────────────────────────────────────────────────────────
// MODULE-LEVEL CACHE
//
// Survives tab switches and re-mounts for the entire app session.
//
// _turfsCache     — the raw turf list (rarely changes; only when admin edits)
//                   TTL: 10 minutes
//
// _slotsCache     — today's booked/blocked slot maps (changes when bookings happen)
//                   TTL: 5 minutes  ← shorter because slot availability changes
//
// The 60-second interval is KEPT but made smart: it skips the Firestore call
// if the slot cache is still fresh (< 5 min old). This means the interval only
// actually reads Firestore once every 5 minutes instead of every 60 seconds.
// ─────────────────────────────────────────────────────────────────────────────
const TURFS_TTL = 2 * 60 * 1000; //  10 minutes
const SLOTS_TTL  =  5 * 60 * 1000; //   5 minutes

type TurfsCache = { data: Turf[]; fetchedAt: number } | null;
type SlotsCache = {
  booked:  Record<string, string[]>;
  blocked: Record<string, string[]>;
  fetchedAt: number;
} | null;

let _turfsCache: TurfsCache = null;
let _slotsCache: SlotsCache = null;

function isTurfsFresh(): boolean {
  return !!_turfsCache && Date.now() - _turfsCache.fetchedAt < TURFS_TTL;
}
function isSlotsFresh(): boolean {
  return !!_slotsCache && Date.now() - _slotsCache.fetchedAt < SLOTS_TTL;
}

// ── Offer badges ────────────────────────────────────────────────────────────
// Same module-level pattern as _turfsCache / _slotsCache, so badges survive a
// tab switch. 5 minutes matches the slot cache; the server holds its own 60s
// cache behind this, so a pause by an owner shows up within ~6 minutes worst
// case — and immediately on pull-to-refresh.
type OfferBadge = {
  offerId:    string;
  title:      string;
  type:       "flat" | "percent";
  badge:      string;   // "20% OFF" | "₹150 OFF"
  qualifier:  string;   // "6 AM–10 AM · min ₹500", or "" when unrestricted
  offerCount: number;
};

const OFFERS_TTL = 5 * 60 * 1000;

type OffersCache = { data: Record<string, OfferBadge>; fetchedAt: number } | null;
let _offersCache: OffersCache = null;

function isOffersFresh(): boolean {
  return !!_offersCache && Date.now() - _offersCache.fetchedAt < OFFERS_TTL;
}

// ─────────────────────────────────────────────────────────────────────────────

function pad(n: number) { return String(n).padStart(2, "0"); }

function formatTime(v: number): string {
  if (v >= 24) v -= 24;                 // 24.5 → 12:30 AM, 25 → 1:00 AM
  const h = Math.floor(v);
  const m = Math.round((v % 1) * 60);
  const suffix = h >= 12 ? "PM" : "AM";
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr}:${pad(m)} ${suffix}`;
}

function shortLabel(v: number): string {
  if (v >= 24) v -= 24;                 // 26 → "2 AM"
  const h = Math.floor(v);
  const m = Math.round((v % 1) * 60);
  const suffix = h >= 12 ? "PM" : "AM";
  const hr = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${hr} ${suffix}` : `${hr}:${pad(m)}`;
}

function parseTime(s: string): number {
  const parts = s.trim().split(" ");
  const [hStr, mStr] = parts[0].split(":");
  let h = Number(hStr);
  const m = Number(mStr || 0);
  const period = (parts[1] || "").toUpperCase();
  if (period === "PM" && h !== 12) h += 12;
  if (period === "AM" && h === 12) h = 0;
  return h + m / 60;
}

function nowDecimal(): number {
  const n = new Date();
  return n.getHours() + n.getMinutes() / 60;
}

function rangesOverlap(aS: number, aE: number, bS: number, bE: number) {
  return aS < bE && bS < aE;
}

function parseSlotRange(s: string, open = 0, late = false): { start: number; end: number } | null {
  try {
    const parts = s.split(" - ");
    if (parts.length < 2) return null;
    let start = parseTime(parts[0].trim());
    let end   = parseTime(parts[1].trim());
    if (late && start < open) start += 24;   // "12:30 AM" on a late turf → 24.5
    if (late && end   < open) end   += 24;
    if (end <= start) end = 24;
    return { start, end };
  } catch { return null; }
}

function buildSlots(
  turf: Turf,
  bookedStrings: string[],
  blockedStrings: string[]
): Slot[] {
  const open  = turf.openingTime ?? 6;
  const close = turf.closingTime === 0 ? 24 : (turf.closingTime ?? 24);
  const now   = nowDecimal();
  const late  = close > 24;
  const cutoff = Number(turf.lateCutoffHours || 0);
  const lateShut = late && cutoff > 0 && now >= 24 - cutoff;   // owner's late-night cutoff passed
  const day   = turf.dayPrice   || turf.price || 0;
  const night = turf.nightPrice || turf.price || 0;
  const slots: Slot[] = [];

  for (let t = open; t < close; t += 0.5) {
    const next    = Math.min(t + 0.5, close);
    const timeStr = `${formatTime(t)} - ${formatTime(next)}`;
    const price   = t >= 6 && t < 18 ? day : night;
    let status: SlotStatus = "available";

    if (t < now || (t >= 24 && lateShut)) {
      status = "past";
    } else {
      const isBooked = bookedStrings.some(s => {
        const r = parseSlotRange(s.trim(), open, late)
        return r ? rangesOverlap(t, next, r.start, r.end) : s.trim() === timeStr.trim();
      });
      const isBlocked = blockedStrings.some(s => {
        const r = parseSlotRange(s.trim(), open, late)
        return r ? rangesOverlap(t, next, r.start, r.end) : s.trim() === timeStr.trim();
      });
      if (isBooked)       status = "booked";
      else if (isBlocked) status = "blocked";
    }
    slots.push({ label: shortLabel(t), time: timeStr, start: t, price, status });
  }
  return slots;
}

const getTurfImage = (t: Turf) =>
  (Array.isArray(t.images) && t.images.length > 0 ? t.images[0] : t.image) || DEFAULT_TURF_IMAGE;

const getBasePrice = (t: Turf) => t.dayPrice || t.nightPrice || t.price || 0;
// ── Admin-set booking mode (missing = old turf = online) ──
const isPhoneOnly = (t: Turf) => t.bookingMode === "phone" && !!t.bookingPhone;
const hasCallOption = (t: Turf) => (t.bookingMode === "phone" || t.bookingMode === "both") && !!t.bookingPhone;

// ── Time filter helpers ──────────────────────────────────────────────────────
const FILTER_HOURS = Array.from({ length: 23 }, (_, i) => i + 5); // 5 AM … 3 AM (late night)

function hourLabel(h: number): string {
  if (h >= 24) h -= 24;                 // 25 → "1 AM"
  if (h === 0) return "12 AM";
  if (h === 12) return "12 PM";
  return h < 12 ? `${h} AM` : `${h - 12} PM`;
}

// True only if EVERY half-hour slot in [start, end) is available today
function isFreeAt(t: Turf, start: number, end: number): boolean {
  if (isPhoneOnly(t)) return false;
  const close = t.closingTime === 0 ? 24 : (t.closingTime ?? 24);
  if (start < (t.openingTime ?? 6) || end > close) return false;
  const slots = t.slots ?? [];
  for (let x = start; x < end; x += 0.5) {
    const sl = slots.find(s => Math.abs(s.start - x) < 0.01);
    if (!sl || sl.status !== "available") return false;
  }
  return true;
}

// Price for the chosen window (sum of half-hour slot prices)
function windowPrice(t: Turf, start: number, end: number): number {
  return Math.round(
    (t.slots ?? [])
      .filter(s => s.start >= start && s.start < end)
      .reduce((sum, s) => sum + s.price * 0.5, 0)
  );
}

// ── Slot chip: time only (no price). Booked / blocked are crossed out;
//    the legend at the top of the list explains the colors. ──
function SlotChip({ slot }: { slot: Slot }) {
  const bk = slot.status === "booked";
  const bl = slot.status === "blocked";
  const bg     = bk ? "#FEF2F2" : bl ? "#FFFBEB" : "#F0FDF4";
  const border = bk ? "#FECACA" : bl ? "#FDE68A" : "#86EFAC";
  const clr    = bk ? "#B91C1C" : bl ? "#92400E" : "#15803D";
  const status = bk ? "booked" : bl ? "blocked" : "available";
  return (
    <View
      style={[sc.chip, { backgroundColor: bg, borderColor: border }]}
      accessibilityLabel={`${slot.label} ${status}`}
    >
      <Text style={[sc.time, { color: clr }, (bk || bl) && sc.crossed]}>{slot.label}</Text>
    </View>
  );
}

const sc = StyleSheet.create({
  chip:    { height: 32, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  time:    { fontSize: 12, fontWeight: "700" },
  crossed: { textDecorationLine: "line-through" },
});

// ── Sport pills on the turf card ─────────────────────────────────────────────
// Shows up to 2 sports, then "+N" for the rest, so a turf with 5 sports
// still fits on one line and never pushes the card wider.
const MAX_SPORT_PILLS = 2;

function SportPills({ sports }: { sports: string[] }) {
  if (sports.length === 0) return null;
  const shown = sports.slice(0, MAX_SPORT_PILLS);
  const extra = sports.length - shown.length;
  return (
    <View style={sp.row} accessibilityLabel={`Sports: ${sports.join(", ")}`}>
      {shown.map(name => {
        const cfg = getSportCfg(name);
        return (
          <View key={name} style={sp.pill}>
            <Ionicons name={cfg.icon} size={11} color={cfg.color} />
            <Text style={sp.txt} numberOfLines={1}>{name}</Text>
          </View>
        );
      })}
      {extra > 0 && (
        <View style={sp.pill}>
          <Text style={sp.txt}>+{extra}</Text>
        </View>
      )}
    </View>
  );
}

const sp = StyleSheet.create({
  row:  { flexDirection: "row", flexWrap: "nowrap", gap: 5, marginTop: 3 },
  pill: { flexDirection: "row", alignItems: "center", gap: 3, flexShrink: 1, backgroundColor: "#F3F4F6", borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  txt:  { fontSize: 11, fontWeight: "700", color: "#374151", flexShrink: 1 },
});

// ─────────────────────────────────────────────────────────────────────────────
// Apply cached slot maps to turf list — pure function, no Firestore reads
// ─────────────────────────────────────────────────────────────────────────────
function applySlotCache(turfs: Turf[]): Turf[] {
  if (!_slotsCache) return turfs;
  const { booked, blocked } = _slotsCache;
  return turfs.map(t => ({
    ...t,
    slots: buildSlots(
      t,
      [...(booked[t.id] || []), ...(blocked[t.id] || [])],  // offline already merged into booked map
      blocked[t.id] || []
    ),
    slotsLoading: false,
  }));
}

export default function Explore() {
  const insets = useSafeAreaInsets();
  const [turfs,      setTurfs]      = useState<Turf[]>([]);
  const [turfsBase,  setTurfsBase]  = useState<Turf[]>([]);
  const [search,     setSearch]     = useState("");
  const [sport,      setSport]      = useState("All");
  const [liked,      setLiked]      = useState<Set<string>>(new Set());
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [userCoords, setUserCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [offersByTurf, setOffersByTurf] = useState<Record<string, OfferBadge>>(
    _offersCache?.data ?? {}
  );

  // 🏙️ City — same as Home (set by GPS on Home, or Profile → City Picker).
  // cityId "" + cityName = PlayOn isn't live there (coming soon).
  const [cityId,   setCityId]   = useState("");
  const [cityName, setCityName] = useState("");
  const comingSoon = !cityId && !!cityName;

  const router    = useRouter();
  const searchRef = useRef<TextInput>(null);

  // Re-read the city every time Explore is opened (it may have changed on Home)
  useFocusEffect(
    useCallback(() => {
      (async () => {
        const [saved, coords] = await Promise.all([getSavedCity(), getSavedCoords()]);
        if (coords) setUserCoords(coords);
        if (saved) {
          setCityId(saved.id);
          setCityName(saved.name);
        }
      })();
    }, [])
  );

  // Home "See all" / highlight cards can open Explore on a filter (e.g. Cricket).
  // The Offers filter was removed, so an old "Offers" link just opens "All".
  const params = useLocalSearchParams<{ sport?: string }>();
  useEffect(() => {
    if (!params.sport) return;
    const p = String(params.sport);
    setSport(p.toLowerCase() === "offers" ? "All" : p);
  }, [params.sport]);

  // ── Time filter ──
  const [timeFilter,    setTimeFilter]    = useState<{ start: number; end: number } | null>(null);
  const [showTimeSheet, setShowTimeSheet] = useState(false);
  const [draftStart,    setDraftStart]    = useState<number | null>(null);
  const [draftHours,    setDraftHours]    = useState<number>(1);

  const openTimeSheet = () => {
    setDraftStart(timeFilter?.start ?? null);
    setDraftHours(timeFilter ? timeFilter.end - timeFilter.start : 1);
    setShowTimeSheet(true);
  };
  const applyTimeFilter = () => {
    if (draftStart == null) return;
    setTimeFilter({ start: draftStart, end: Math.min(draftStart + draftHours, 28) });
    setShowTimeSheet(false);
  };
  const clearTimeFilter = () => {
    setTimeFilter(null);
    setDraftStart(null);
    setShowTimeSheet(false);
  };

  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, async (u) => {
      if (!u) {
        setLiked(new Set());          // logged out → no saved turfs
        return;
      }
      try {
        const snap = await getDoc(doc(db, "users", u.uid));
        if (snap.exists()) {
          const d = snap.data();
          if (d.latitude != null && d.longitude != null) {
            setUserCoords(prev => prev ?? { lat: d.latitude, lng: d.longitude });
          }
          // 🏙️ No city saved on this phone yet → use the account's city
          if (!(await getSavedCity()) && d.cityId) {
            setCityId(d.cityId);
            setCityName(d.cityName || d.city || "");
          }
          // Saved turfs live on the user doc, so they survive app restarts
          // and show on every phone the user logs in on.
          if (Array.isArray(d.savedTurfs)) {
            setLiked(new Set(d.savedTurfs as string[]));
          }
        }
      } catch { /* non-fatal */ }
    });

    fetchAll();

    // ─── Throttled interval ───────────────────────────────────────────────
    // BEFORE: fired getDocs every 60 seconds unconditionally
    //         → user on Explore for 10 min = 20 Firestore reads (2 per tick)
    // AFTER:  checks if slot cache is still fresh before hitting Firestore
    //         → only reads when cache is stale (> 5 min), so at most
    //         one Firestore read per 5 minutes regardless of interval speed
    const interval = setInterval(() => {
      if (!isSlotsFresh()) {
        fetchSlots();  // only fires if > 5 min since last slot fetch
      }
    }, 60_000);

    return () => { unsubAuth(); clearInterval(interval); };
  }, []);

  // ─── fetchSlots ──────────────────────────────────────────────────────────
  // BEFORE: 2 full collection reads every call (every 60s + on mount)
  // AFTER:
  //   - forceRefresh=false → returns immediately if cache < 5 min old (0 reads)
  //   - forceRefresh=true  → always hits Firestore (used by pull-to-refresh)
  const fetchSlots = async (baseList?: Turf[], forceRefresh = false) => {
    const source = baseList ?? turfsBase;
    if (source.length === 0) return;

    // Cache hit — apply existing maps to turfs, no Firestore reads
    if (!forceRefresh && isSlotsFresh()) {
      setTurfs(applySlotCache(source));
      return;
    }

    // Cache miss or forced refresh — fetch from Firestore
    try {
      const [bookSnap, blockSnap] = await Promise.all([
        getDocs(query(collection(db, "bookings"),     where("dateString", "==", TODAY_STRING))),
        getDocs(query(collection(db, "blockedSlots"), where("date",       "==", TODAY_STRING))),
      ]);

      const bookedMap:  Record<string, string[]> = {};
      const blockedMap: Record<string, string[]> = {};

      bookSnap.docs.forEach(d => {
        const data = d.data();
        if (data.status === "cancelled") return;
        const tid = data.turfId as string;
        if (!bookedMap[tid]) bookedMap[tid] = [];
        bookedMap[tid].push(...((data.selectedSlots as string[]) || []));
      });

      blockSnap.docs.forEach(d => {
        const data = d.data();
        const tid  = data.turfId as string;
        if (!tid) return;
        const slotStrings: string[] = Array.isArray(data.slots) && data.slots.length > 0
          ? (data.slots as string[])
          : data.slotTime ? [data.slotTime as string] : [];
        if (slotStrings.length === 0) return;

        if (data.type === "offline") {
          // Offline bookings count as booked (merged into bookedMap)
          if (!bookedMap[tid]) bookedMap[tid] = [];
          bookedMap[tid].push(...slotStrings);
        } else {
          if (!blockedMap[tid]) blockedMap[tid] = [];
          blockedMap[tid].push(...slotStrings);
        }
      });

      // Store in module-level cache
      _slotsCache = { booked: bookedMap, blocked: blockedMap, fetchedAt: Date.now() };

      setTurfs(prev => prev.map(t => ({
        ...t,
        slots: buildSlots(
          t,
          [...(bookedMap[t.id] || [])],
          blockedMap[t.id] || []
        ),
        slotsLoading: false,
      })));
    } catch (e) {
      console.error("fetchSlots error:", e);
    }
  };

  // ─── fetchOffers ─────────────────────────────────────────────────────────
  // Fire-and-forget. Never awaited by the render path, never throws upward.
  // Explore worked before offers existed and must keep working if this fails.
  const fetchOffers = async (forceRefresh = false) => {
    if (!forceRefresh && isOffersFresh()) {
      setOffersByTurf(_offersCache!.data);
      return;
    }
    try {
      const controller = new AbortController();
      // Render free tier cold-starts at ~30s. We are not waiting that long for
      // a decoration — bail at 8s and try again on the next visit.
      const timer = setTimeout(() => controller.abort(), 8000);

      const res = await fetch("https://bookora-backend-95u4.onrender.com/turf-offers", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({}),   // {} = every turf with an offer today
        signal:  controller.signal,
      });
      clearTimeout(timer);

      const data = await res.json();
      const map  = (data?.offers ?? {}) as Record<string, OfferBadge>;
      _offersCache = { data: map, fetchedAt: Date.now() };
      setOffersByTurf(map);
    } catch {
      // Silent on purpose — a missing badge is invisible, an error toast is not.
    }
  };

  // ─── fetchAll ────────────────────────────────────────────────────────────
  // BEFORE: getDocs("turfs") on every mount — re-fetches every tab switch
  // AFTER:
  //   - forceRefresh=false → serves turfs from cache if < 10 min old (0 reads)
  //   - forceRefresh=true  → bypasses cache (pull-to-refresh)
  const fetchAll = async (isRefresh = false) => {
    try {
      isRefresh ? setRefreshing(true) : setLoading(true);

      let raw: Turf[];

      if (!isRefresh && isTurfsFresh()) {
        // ✅ Cache hit — 0 Firestore reads for turfs
        raw = _turfsCache!.data;
      } else {
        // Cache miss or forced refresh — fetch from Firestore
        const turfSnap = await getDocs(collection(db, "turfs"));
        raw = turfSnap.docs
          .map(d => ({ id: d.id, ...d.data(), slotsLoading: true } as Turf))
          .filter((t: any) => t.active !== false);
        _turfsCache = { data: raw, fetchedAt: Date.now() };
      }

      setTurfsBase(raw);

      // Not awaited — badges land whenever they land.
      fetchOffers(isRefresh);

      // If slot cache is still fresh, apply it immediately (0 reads)
      // Otherwise fetch fresh slots from Firestore
      if (!isRefresh && isSlotsFresh()) {
        setTurfs(applySlotCache(raw));
        setLoading(false);
        setRefreshing(false);
        return;
      }

      // Show turfs immediately with slotsLoading=true, then fill slots
      setTurfs(raw.map(t => ({ ...t, slotsLoading: true })));
      await fetchSlots(raw, isRefresh);

    } catch (e) {
      console.error("Explore fetchAll error:", e);
      Alert.alert("Error", "Could not load venues. Pull to refresh.");
      setTurfs(prev => prev.map(t => ({ ...t, slotsLoading: false })));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  // ─── Save / unsave a turf ────────────────────────────────────────────────
  // Updates the star instantly, then writes users/{uid}.savedTurfs.
  // If the write fails, the star goes back to how it was.
  const toggleLike = async (id: string) => {
    const user = auth.currentUser;
    if (!user) {
      Alert.alert("Login required", "Please log in to save turfs.", [
        { text: "Cancel", style: "cancel" },
        { text: "Log In", onPress: () => router.push("/(auth)/login") },
      ]);
      return;
    }

    const wasSaved = liked.has(id);
    const flip = (save: boolean) =>
      setLiked(prev => {
        const next = new Set(prev);
        save ? next.add(id) : next.delete(id);
        return next;
      });

    flip(!wasSaved);
    try {
      await setDoc(
        doc(db, "users", user.uid),
        { savedTurfs: wasSaved ? arrayRemove(id) : arrayUnion(id) },
        { merge: true }
      );
    } catch (e) {
      console.error("toggleLike error:", e);
      flip(wasSaved);
      Alert.alert("Couldn't update", "Please check your internet and try again.");
    }
  };

  const handleBook = (id: string) => {
    if (!auth.currentUser) {
      Alert.alert("Login required", "Please log in to book.", [
        { text: "Cancel", style: "cancel" },
        { text: "Log In", onPress: () => router.push("/(auth)/login") },
      ]);
      return;
    }
    router.push(`/turf/${id}`);
  };

  // 🏙️ Venues in the current city only. Coming soon → none. No city yet → all.
  const cityTurfs = useMemo(
    () => comingSoon ? [] : cityId ? turfs.filter((t: any) => t.cityId === cityId) : turfs,
    [turfs, cityId, comingSoon]
  );

  const sportFilters = useMemo<string[]>(() => {
    // Sports from turfs only (gyms have no sport field). getSports already
    // splits "Cricket, Football", trims, Title Cases and de-dupes per turf.
    const seen = new Set<string>();
    const unique: string[] = [];
    cityTurfs
      .filter((t: any) => t.venueType !== "gym")
      .flatMap(getSports)
      .forEach(name => {
        if (!seen.has(name.toLowerCase())) {
          seen.add(name.toLowerCase());
          unique.push(name);
        }
      });

    // ✅ Check if any gyms exist — if yes, add "Gym" chip at the end
    const hasGyms = cityTurfs.some((t: any) => t.venueType === "gym");

    // "Saved" (star only) is always shown, last in the row; its empty state explains the star.
    return [
      "All",
      ...unique.sort(),
      ...(hasGyms ? ["Gym"] : []),
      "Saved",
    ];
  }, [cityTurfs]);

  const filtered = useMemo<Turf[]>(() => {
    const q = search.trim().toLowerCase();

    // Saved shows everything the player starred, in any city
    const base = sport === "Saved" ? turfs : cityTurfs;
    const withDist = base.map(t => {
      let distanceKm: number | null = null;
      if (userCoords && t.latitude != null && t.longitude != null) {
        distanceKm = haversine(userCoords.lat, userCoords.lng, t.latitude, t.longitude);
      }
      return { ...t, distanceKm };
    });

    const sorted = [...withDist].sort((a, b) => {
      if (a.distanceKm == null && b.distanceKm == null) return 0;
      if (a.distanceKm == null) return 1;
      if (b.distanceKm == null) return -1;
      return a.distanceKm - b.distanceKm;
    });

    return sorted.filter((t: any) => {
      // ── Time filter: only turfs free for the whole window ──
      if (timeFilter) {
        if (t.venueType === "gym") return false;
        if (t.slotsLoading) return false;
        if (!isFreeAt(t, timeFilter.start, timeFilter.end)) return false;
      }

      // Saved filter — everything the user starred (turfs and gyms)
      if (sport === "Saved") {
        if (!liked.has(t.id)) return false;
      } else if (sport === "Gym") {
        if (t.venueType !== "gym") return false;
      } else if (sport === "All") {
        // "All" shows only turfs (not gyms)
        if (t.venueType === "gym") return false;
      } else {
        // Specific sport filter — a multi-sport turf shows under EACH of its sports
        if (t.venueType === "gym") return false;
        if (!getSports(t).some(s => s.toLowerCase() === sport.toLowerCase())) return false;
      }

      if (!q) return true;

      const sportStr = getSports(t).join(" ").toLowerCase();
      const amenityStr = Array.isArray(t.amenities)
        ? t.amenities.join(" ").toLowerCase()
        : "";
      return [
        (t.name ?? "").toLowerCase(),
        (t.location ?? "").toLowerCase(),
        sportStr,
        amenityStr,
      ].some(v => v.includes(q));
    });
  }, [turfs, cityTurfs, search, sport, userCoords, offersByTurf, timeFilter, liked]);

  // Searched something that isn't in this city → show matches from other cities
  const otherCityHits = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q || filtered.length > 0 || !cityId) return [];
    return turfs
      .filter((t: any) => t.cityId !== cityId && t.venueType !== "gym")
      .filter((t: any) => [t.name, t.location, t.cityName].some((v: any) => String(v || "").toLowerCase().includes(q)))
      .slice(0, 5);
  }, [search, filtered, turfs, cityId]);

  if (loading) {
    return (
      <SafeAreaView style={s.center}>
        <StatusBar barStyle="dark-content" backgroundColor="#fff" />
        <ActivityIndicator size="large" color="#0B1220" />
        <Text style={s.loadTxt}>Finding venues…</Text>
      </SafeAreaView>
    );
  }

  return (
    <View style={s.root}>
      <StatusBar barStyle="dark-content" backgroundColor="#fff" />

      <FlatList
        data={filtered}
        keyExtractor={t => t.id}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={s.list}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => fetchAll(true)}
            tintColor="#0B1220"
            colors={["#0B1220"]}
          />
        }

        ListHeaderComponent={
          <View>
            <View style={[s.header, { paddingTop: insets.top + 12 }]}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={s.title}>Explore</Text>
                <Text style={s.sub} numberOfLines={1}>
                  {cityName
                    ? `${comingSoon ? "Coming soon to" : "Turfs in"} ${cityName}${userCoords && !comingSoon ? " · nearest first" : ""}`
                    : userCoords ? "Sorted by distance from you" : "Find your perfect venue"}
                </Text>
              </View>
              {!!cityName && (
                <View style={s.nearBadge} accessibilityLabel={`City ${cityName}`}>
                  <Ionicons name="location" size={13} color="#15803D" />
                  <Text style={s.nearBadgeTxt} numberOfLines={1}>{cityName}</Text>
                </View>
              )}
            </View>

            <View style={s.searchWrap}>
              <View style={s.searchBar}>
                <Ionicons name="search-outline" size={18} color="#6B7280" />
                <TextInput
                  ref={searchRef}
                  placeholder={cityName && !comingSoon ? `Search turfs in ${cityName}...` : "Search turfs, sports, locations..."}
                  placeholderTextColor="#9CA3AF"
                  value={search}
                  onChangeText={setSearch}
                  style={s.searchInput}
                  returnKeyType="search"
                />
                {search.length > 0 ? (
                  <TouchableOpacity onPress={() => setSearch("")} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                    <Ionicons name="close-circle" size={18} color="#9CA3AF" />
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity
                    style={[s.searchFilter, timeFilter && s.searchFilterOn]}
                    onPress={openTimeSheet}
                    activeOpacity={0.8}
                  >
                    <Ionicons name="time-outline" size={17} color={timeFilter ? "#fff" : "#374151"} />
                  </TouchableOpacity>
                )}
              </View>
            </View>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>
              {sportFilters.map(f => {
                const active = sport === f;

                // ✅ Special configs for "All" and "Gym"
                const cfg =
                  f === "All"   ? { color: "#374151", icon: "grid-outline" as const } :
                  f === "Saved" ? { color: "#FACC15", icon: "star" as const } :
                  f === "Gym"   ? { color: "#7C3AED", icon: "barbell-outline" as const } :
                  getSportCfg(f);

                return (
                  <TouchableOpacity
                    key={f}
                    style={[s.chip, active && s.chipOn]}
                    onPress={() => setSport(f)}
                    activeOpacity={0.7}
                    accessibilityLabel={f === "Saved" ? "Saved turfs" : f}
                  >
                    <Ionicons name={cfg.icon} size={f === "Saved" ? 16 : 14} color={f === "Saved" ? (active ? "#FACC15" : "#CA8A04") : active ? "#fff" : cfg.color} />
                    {/* Saved chip is icon-only: just the star */}
                    {f !== "Saved" && <Text style={[s.chipTxt, active && s.chipTxtOn]}>{f}</Text>}
                    {f === "Saved" && liked.size > 0 && (
                      <View style={[s.chipCount, active && s.chipCountOn]}>
                        <Text style={[s.chipCountTxt, active && s.chipCountTxtOn]}>{liked.size}</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            {timeFilter && (
              <View style={s.timePillRow}>
                <TouchableOpacity style={s.timePill} onPress={openTimeSheet} activeOpacity={0.85}>
                  <Ionicons name="time" size={13} color="#15803D" />
                  <Text style={s.timePillTxt}>
                    Free today {hourLabel(timeFilter.start)} – {hourLabel(timeFilter.end)}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={clearTimeFilter} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Ionicons name="close-circle" size={20} color="#9CA3AF" />
                </TouchableOpacity>
              </View>
            )}
            <View style={s.legendRow}>
              {sport !== "Gym" && (
                <>
                  <View style={s.legendItem}>
                    <View style={[s.legendDot, { backgroundColor: "#F0FDF4", borderColor: "#86EFAC" }]} />
                    <Text style={s.legendTxt}>Available</Text>
                  </View>
                  <View style={s.legendItem}>
                    <View style={[s.legendDot, { backgroundColor: "#FEE2E2", borderColor: "#FECACA" }]} />
                    <Text style={s.legendTxt}>Booked</Text>
                  </View>
                  <View style={s.legendItem}>
                    <View style={[s.legendDot, { backgroundColor: "#FEF3C7", borderColor: "#FDE68A" }]} />
                    <Text style={s.legendTxt}>Blocked</Text>
                  </View>
                </>
              )}
              <View style={{ flex: 1 }} />
              <Text style={s.listCount}>
                {filtered.length} {sport === "Gym" ? "gyms" : sport === "Saved" ? "saved" : "venues"}
              </Text>
            </View>

          </View>
        }

        ListEmptyComponent={
          sport === "Saved" && !search && !timeFilter ? (
            <View style={s.empty}>
              <Ionicons name="star-outline" size={48} color="#D1D5DB" />
              <Text style={s.emptyTitle}>
                {auth.currentUser ? "No saved turfs yet" : "Log in to see saved turfs"}
              </Text>
              <Text style={s.emptySub}>
                {auth.currentUser
                  ? "Tap the star on any turf photo to save it here for quick booking."
                  : "Your saved turfs are kept on your account."}
              </Text>
              <TouchableOpacity
                style={s.emptyBtn}
                onPress={() => auth.currentUser ? setSport("All") : router.push("/(auth)/login")}
              >
                <Text style={s.emptyBtnTxt}>{auth.currentUser ? "Browse turfs" : "Log In"}</Text>
              </TouchableOpacity>
            </View>
          ) : comingSoon && sport !== "Saved" ? (
            <View style={s.empty}>
              <Ionicons name="time-outline" size={48} color="#F59E0B" />
              <Text style={s.emptyTitle}>PlayOn is coming to {cityName}</Text>
              <Text style={s.emptySub}>No turfs here yet. Know one? Add it and we'll bring PlayOn to {cityName}.</Text>
              <TouchableOpacity style={s.emptyBtn} onPress={() => router.push("/add-a-turf" as any)}>
                <Text style={s.emptyBtnTxt}>Add a turf</Text>
              </TouchableOpacity>
            </View>
          ) : otherCityHits.length > 0 ? (
            <View style={s.empty}>
              <Ionicons name="search-outline" size={40} color="#D1D5DB" />
              <Text style={s.emptyTitle}>Not in {cityName}</Text>
              <Text style={s.emptySub}>Found in other cities:</Text>
              <View style={{ alignSelf: "stretch", marginTop: 10, gap: 8 }}>
                {otherCityHits.map((t: any) => (
                  <TouchableOpacity key={t.id} style={s.otherRow} onPress={() => router.push(`/turf/${t.id}` as any)} activeOpacity={0.85}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={s.otherName} numberOfLines={1}>{t.name}</Text>
                      <Text style={s.otherCity} numberOfLines={1}>{t.cityName || t.location || ""}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color="#6B7280" />
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          ) : (
          <View style={s.empty}>
            <Ionicons name="search-outline" size={48} color="#D1D5DB" />
            <Text style={s.emptyTitle}>
              {timeFilter ? "No free turfs at that time" : "No venues found"}
            </Text>
            <Text style={s.emptySub}>
              {timeFilter
                ? "Try a different time, or a shorter duration."
                : "Try a different sport or clear your search."}
            </Text>
            <TouchableOpacity
              style={s.emptyBtn}
              onPress={() => timeFilter ? openTimeSheet() : (setSearch(""), setSport("All"))}
            >
              <Text style={s.emptyBtnTxt}>{timeFilter ? "Change time" : "Show all"}</Text>
            </TouchableOpacity>
          </View>
          )
        }

        renderItem={({ item }) => {
          // ✅ If it's a gym, render the GymCard
          if ((item as any).venueType === "gym") {
            return (
              <View style={{ marginHorizontal: 10, marginBottom: 14 }}>
                <GymCardGrid
                  item={item}
                  userCoords={userCoords ? { lat: userCoords.lat, lng: userCoords.lng } : null}
                  onPress={() => {
                    if (!auth.currentUser) {
                      Alert.alert("Login required", "Please log in to view memberships.", [
                        { text: "Cancel", style: "cancel" },
                        { text: "Log In", onPress: () => router.push("/(auth)/login") },
                      ]);
                      return;
                    }
                    router.push(`/turf/gym-details/${item.id}`);
                  }}
                />
              </View>
            );
          }

          const img       = getTurfImage(item);
          const basePrice = getBasePrice(item);
          const sports    = getSports(item);          // ["Cricket", "Football", ...]
          const isLiked   = liked.has(item.id);
          const phoneOnly = isPhoneOnly(item);
          const offer     = phoneOnly ? undefined : offersByTurf[item.id];   // offers are online-only

          const upcoming = (item.slots ?? []).filter(sl => sl.status !== "past");
          const freeCount = upcoming.filter(sl => sl.status === "available").length;
          const slotPreview = upcoming
            .filter(sl => !timeFilter || sl.start >= timeFilter.start);  // all upcoming slots (row scrolls sideways)
          const winPrice = timeFilter ? windowPrice(item, timeFilter.start, timeFilter.end) : 0;

          return (
            // Card itself is NOT tappable — only the photo, the name block, the
            // phone box and the button open the turf. The slot row sits outside
            // every touchable, so swiping it only scrolls.
            <View style={s.card}>
              {/* ── Left: photo (tap → turf) — clean photo, no sport badge ── */}
              <TouchableOpacity style={s.imgWrap} activeOpacity={0.9} onPress={() => handleBook(item.id)}>
                <Image source={{ uri: img }} style={s.img} resizeMode="cover" />

                {/* Offer: corner tag, flush top-left. Big number, small "OFF" under it.
                    "20% OFF" → 20% / OFF,  "₹150 OFF" → ₹150 / OFF.
                    Fixed size so every card's tag looks the same; long values shrink to fit. */}
                {!!offer && (() => {
                  const hasOff = /\s*OFF\s*$/i.test(offer.badge);
                  const value  = offer.badge.replace(/\s*OFF\s*$/i, "").trim() || offer.badge;
                  return (
                    <View style={s.offerBadge} accessibilityLabel={`Offer: ${offer.badge}`}>
                      <Text style={s.offerBadgeNum} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
                        {value}
                      </Text>
                      {hasOff && <Text style={s.offerBadgeOff}>OFF</Text>}
                    </View>
                  );
                })()}

                <TouchableOpacity style={s.heart} onPress={() => toggleLike(item.id)} activeOpacity={0.8} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityLabel={isLiked ? "Remove from saved" : "Save turf"}>
                  <Ionicons name={isLiked ? "star" : "star-outline"} size={14} color={isLiked ? "#FACC15" : "#fff"} />
                </TouchableOpacity>

                {/* Bottom: distance (right) */}
                <View style={s.imgBottom}>
                  {item.distanceKm != null && (
                    <View style={s.distBadge}>
                      <Text style={s.distBadgeTxt}>{fmtDist(item.distanceKm)}</Text>
                    </View>
                  )}
                </View>
              </TouchableOpacity>

              {/* ── Right: details ── */}
              <View style={s.body}>
                <TouchableOpacity style={{ gap: 3 }} activeOpacity={0.7} onPress={() => handleBook(item.id)}>
                  <Text numberOfLines={1} style={s.turfName}>{item.name ?? "Turf"}</Text>
                  <View style={s.locRow}>
                    <Ionicons name="location-outline" size={12} color="#6B7280" />
                    <Text numberOfLines={1} style={s.locTxt}>{item.location ?? "—"}</Text>
                  </View>
                  <SportPills sports={sports} />
                  {!!offer && (
                    <Text numberOfLines={1} style={s.offerLine}>
                      {offer.title}
                      {offer.qualifier ? ` · ${offer.qualifier}` : ""}
                    </Text>
                  )}
                </TouchableOpacity>

                {/* Call-to-book turfs look like any other turf here (no "call" hints).
                    They have no live slots, so we show their timings instead.
                    The call option is only revealed on the turf page. */}
                {phoneOnly ? (
                  <View style={s.slotSection}>
                    <Text style={s.slotLabel}>Timings</Text>
                    <Text style={s.hoursTxt}>
                      {(item as any).hoursSet === false ? "Call to book" : `Open ${shortLabel(item.openingTime ?? 6)} – ${shortLabel(item.closingTime ?? 24)}`}
                    </Text>
                  </View>
                ) : (
                  // Scroll-only: chips are plain Views, nothing here opens the turf
                  <View style={s.slotSection}>
                    <Text style={s.slotLabel}>Today's slots</Text>
                    {item.slotsLoading ? (
                      <ActivityIndicator size="small" color="#0B1220" style={{ alignSelf: "flex-start", marginVertical: 4 }} />
                    ) : slotPreview.length === 0 ? (
                      <Text style={s.noSlots}>No upcoming slots today</Text>
                    ) : (
                      <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        contentContainerStyle={s.slotRow}
                        nestedScrollEnabled
                        keyboardShouldPersistTaps="handled"
                      >
                        {slotPreview.map((sl, i) => <SlotChip key={i} slot={sl} />)}
                      </ScrollView>
                    )}
                  </View>
                )}

                {/* ── Bottom: price + free count | button ── */}
                <View style={s.bottomRow}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    {!hasPrice(basePrice) && !(timeFilter && !phoneOnly) ? (
                      <Text style={[s.price, { fontSize: 14 }]} numberOfLines={1}>Price on call</Text>
                    ) : (
                    <Text style={s.price} numberOfLines={1}>
                      {timeFilter && !phoneOnly ? `₹${winPrice}` : `₹${basePrice}`}
                      <Text style={s.priceUnit}>
                        {timeFilter && !phoneOnly ? ` · ${hourLabel(timeFilter.start)}–${hourLabel(timeFilter.end)}` : "/hr"}
                      </Text>
                    </Text>
                    )}
                    {!phoneOnly && !item.slotsLoading && upcoming.length > 0 && (
                      <Text style={[s.freeCount, freeCount === 0 && { color: "#B91C1C" }]}>
                        {freeCount === 0 ? "Full today" : `${freeCount} free today`}
                      </Text>
                    )}
                  </View>
                  <TouchableOpacity style={s.bookBtn} onPress={() => handleBook(item.id)} activeOpacity={0.85}>
                    <Text style={s.bookBtnTxt}>Book Now</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          );
        }}
      />
      {/* ── Time filter sheet ── */}
      <Modal visible={showTimeSheet} transparent animationType="slide" onRequestClose={() => setShowTimeSheet(false)}>
        <View style={s.sheetBackdrop}>
          <View style={[s.sheet, { paddingBottom: insets.bottom + 16 }]}>
            <View style={s.sheetHandle} />
            <Text style={s.sheetTitle}>Find a free turf</Text>
            <Text style={s.sheetSub}>Today · pick when you want to play</Text>

            <Text style={s.sheetLabel}>START TIME</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 4 }}>
              {FILTER_HOURS.map(h => {
                const past = h < nowDecimal();
                const on   = draftStart === h;
                return (
                  <TouchableOpacity
                    key={h}
                    disabled={past}
                    style={[s.hourChip, on && s.hourChipOn, past && s.hourChipPast]}
                    onPress={() => setDraftStart(h)}
                  >
                    <Text style={[s.hourChipTxt, on && s.hourChipTxtOn, past && s.hourChipTxtPast]}>
                      {hourLabel(h)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <Text style={s.sheetLabel}>HOW LONG</Text>
            <View style={{ flexDirection: "row", gap: 8 }}>
              {[1, 2, 3].map(d => {
                const on = draftHours === d;
                const tooLate = draftStart != null && draftStart + d > 28;
                return (
                  <TouchableOpacity
                    key={d}
                    disabled={tooLate}
                    style={[s.durChip, on && s.hourChipOn, tooLate && s.hourChipPast]}
                    onPress={() => setDraftHours(d)}
                  >
                    <Text style={[s.hourChipTxt, on && s.hourChipTxtOn]}>{d} hr</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {draftStart != null && (
              <Text style={s.sheetPreview}>
                {hourLabel(draftStart)} – {hourLabel(Math.min(draftStart + draftHours, 28))}
              </Text>
            )}

            <View style={{ flexDirection: "row", gap: 10, marginTop: 16 }}>
              <TouchableOpacity style={s.sheetClearBtn} onPress={clearTimeFilter}>
                <Text style={s.sheetClearTxt}>Clear</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.sheetApplyBtn, draftStart == null && { opacity: 0.45 }]}
                disabled={draftStart == null}
                onPress={applyTimeFilter}
              >
                <Text style={s.sheetApplyTxt}>Show free turfs</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  root:    { flex: 1, backgroundColor: "#F0F2F5" },
  center:  { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#fff" },
  loadTxt: { marginTop: 10, fontSize: 14, color: "#6B7280" },
  list:    { paddingBottom: 110 },

  header: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    backgroundColor: "#fff", paddingHorizontal: 16,
    paddingBottom: 8,
  },
  title: { fontSize: 22, fontWeight: "800", color: "#0B1220", letterSpacing: -0.3 },
  sub:   { fontSize: 12, color: "#9CA3AF", marginTop: 1 },

  nearBadge:    { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#DCFCE7", paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, borderWidth: 1, borderColor: "#86EFAC" },
  nearBadgeTxt: { fontSize: 12, fontWeight: "700", color: "#15803D", maxWidth: 140 },
  // 🏙️ other-city search results
  otherRow:     { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#fff", borderRadius: 12, padding: 12, borderWidth: 1, borderColor: "#E5E7EB" },
  otherName:    { fontSize: 14, fontWeight: "800", color: "#0B1220" },
  otherCity:    { fontSize: 12, color: "#6B7280", marginTop: 2 },

  searchWrap: { backgroundColor: "#fff", paddingHorizontal: 16, paddingBottom: 10 },
  searchBar:  { flexDirection: "row", alignItems: "center", backgroundColor: "#FFFFFF", borderRadius: 16, paddingHorizontal: 14, height: 52, borderWidth: 1, borderColor: "#E5E7EB", shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.04, shadowRadius: 6, elevation: 2 },
  searchInput:  { flex: 1, fontSize: 14, color: "#111827", marginLeft: 10, paddingRight: 10 },
  searchFilter: { width: 34, height: 34, borderRadius: 10, backgroundColor: "#F3F4F6", alignItems: "center", justifyContent: "center" },

  chips:     { paddingHorizontal: 16, paddingVertical: 7, gap: 6 },
  chip:      { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 11, paddingVertical: 6, backgroundColor: "#F3F4F6", borderRadius: 20 },
  chipOn:    { backgroundColor: "#0B1220" },
  chipEmoji: { fontSize: 13 },
  chipTxt:   { fontSize: 12, fontWeight: "600", color: "#374151" },
  chipTxtOn: { color: "#fff" },

  legendRow:  {  marginBottom:5,flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 7, backgroundColor: "#fff", borderTopWidth: 0.5, borderTopColor: "#F0F0F0", gap: 10 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  legendDot:  { width: 12, height: 12, borderRadius: 3, borderWidth: 1 },
  legendTxt:  { fontSize: 11, fontWeight: "600", color: "#6B7280" },
  listCount:  { fontSize: 11, fontWeight: "600", color: "#9CA3AF" },

  // Saved chip count bubble
  chipCount:      { minWidth: 18, height: 18, paddingHorizontal: 5, borderRadius: 9, backgroundColor: "#FEF3C7", alignItems: "center", justifyContent: "center", marginLeft: 2 },
  chipCountOn:    { backgroundColor: "#FACC15" },
  chipCountTxt:   { fontSize: 10, fontWeight: "800", color: "#92400E" },
  chipCountTxtOn: { color: "#0B1220" },

  // ── Turf card: photo left, details right ──
  card: { flexDirection: "row", minHeight: 200, backgroundColor: "#fff", borderRadius: 16, marginHorizontal: 10, marginBottom: 10, overflow: "hidden", shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  imgWrap:      { width: 132, alignSelf: "stretch", position: "relative", backgroundColor: "#E5E7EB" },
  img:          { ...StyleSheet.absoluteFillObject },
  heart:        { position: "absolute", top: 6, right: 6, width: 28, height: 28, borderRadius: 14, backgroundColor: "rgba(0,0,0,0.38)", alignItems: "center", justifyContent: "center" },
  imgBottom:    { position: "absolute", left: 6, right: 6, bottom: 8, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 4 },

  // Option B offer badge: corner tag flush to the photo's top-left corner
  offerBadge: {
    position: "absolute", top: 0, left: 0,
    width: 74, height: 46, paddingHorizontal: 6,
    alignItems: "center", justifyContent: "center",
    backgroundColor: "#15803D", borderBottomRightRadius: 14,
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.25, shadowRadius: 6, elevation: 4,
  },
  offerBadgeNum: { fontSize: 18, lineHeight: 24, fontWeight: "900", color: "#fff", textAlign: "center" },
  offerBadgeOff: { fontSize: 10, fontWeight: "800", letterSpacing: 1.5, color: "#fff", marginTop: 1 },
  offerLine:     { fontSize: 11, fontWeight: "700", color: "#15803D", marginTop: 2 },

  distBadge:    { backgroundColor: "#0B1220", paddingHorizontal: 7, paddingVertical: 3, borderRadius: 20 },
  distBadgeTxt: { fontSize: 10, fontWeight: "700", color: "#fff" },

  body:       { flex: 1, minWidth: 0, paddingVertical: 12, paddingLeft: 12, paddingRight: 10, gap: 8, justifyContent: "space-between" },
  turfName:   { fontSize: 16, fontWeight: "800", color: "#0B1220" },
  locRow:     { flexDirection: "row", alignItems: "center", gap: 3 },
  locTxt:     { flex: 1, fontSize: 12, color: "#6B7280" },
  hoursTxt:   { fontSize: 13, fontWeight: "700", color: "#0B1220" },

  bottomRow:  { flexDirection: "row", alignItems: "center", gap: 8, borderTopWidth: 1, borderTopColor: "#F1F3F5", paddingTop: 10 },
  price:      { fontSize: 16, fontWeight: "900", color: "#0B1220" },
  priceUnit:  { fontSize: 11, fontWeight: "600", color: "#6B7280" },
  bookBtn:    { height: 34, justifyContent: "center", backgroundColor: "#178c42", paddingHorizontal: 16, borderRadius: 10 },
  bookBtnTxt: { fontSize: 12, fontWeight: "800", color: "#fff" },

  slotSection: { gap: 5 },
  slotRow:     { gap: 5, paddingRight: 4 },   // one row, swipe left for later slots
  slotLabel:   { fontSize: 10, fontWeight: "700", color: "#6B7280", textTransform: "uppercase", letterSpacing: 0.5 },
  freeCount:   { fontSize: 11, fontWeight: "700", color: "#15803D", marginTop: 1 },
  noSlots:     { fontSize: 12, color: "#9CA3AF", paddingVertical: 4 },

  empty:      { alignItems: "center", paddingTop: 80, paddingHorizontal: 40 },
  emptyTitle: { fontSize: 17, fontWeight: "700", color: "#374151", marginTop: 14 },
  emptySub:   { fontSize: 13, color: "#9CA3AF", textAlign: "center", marginTop: 6, lineHeight: 20 },
  emptyBtn:   { marginTop: 18, backgroundColor: "#0B1220", paddingHorizontal: 22, paddingVertical: 10, borderRadius: 10 },
  emptyBtnTxt:{ fontSize: 13, fontWeight: "700", color: "#fff" },

  // time filter
  searchFilterOn:  { backgroundColor: "#16A34A" },
  timePillRow:     { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingBottom: 8, backgroundColor: "#fff" },
  timePill:        { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#F0FDF4", borderWidth: 1, borderColor: "#86EFAC", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 },
  timePillTxt:     { fontSize: 12, fontWeight: "700", color: "#15803D" },
  sheetBackdrop:   { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheet:           { backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingTop: 10 },
  sheetHandle:     { width: 40, height: 4, borderRadius: 2, backgroundColor: "#E5E7EB", alignSelf: "center", marginBottom: 14 },
  sheetTitle:      { fontSize: 19, fontWeight: "800", color: "#0B1220" },
  sheetSub:        { fontSize: 12.5, color: "#6B7280", fontWeight: "600", marginTop: 2 },
  sheetLabel:      { fontSize: 11, fontWeight: "800", color: "#6B7280", letterSpacing: 0.5, marginTop: 18, marginBottom: 8 },
  hourChip:        { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, backgroundColor: "#F3F4F6", borderWidth: 1, borderColor: "#E5E7EB" },
  durChip:         { flex: 1, alignItems: "center", paddingVertical: 11, borderRadius: 12, backgroundColor: "#F3F4F6", borderWidth: 1, borderColor: "#E5E7EB" },
  hourChipOn:      { backgroundColor: "#0B1220", borderColor: "#0B1220" },
  hourChipPast:    { opacity: 0.35 },
  hourChipTxt:     { fontSize: 13, fontWeight: "700", color: "#374151" },
  hourChipTxtOn:   { color: "#fff" },
  hourChipTxtPast: { color: "#9CA3AF" },
  sheetPreview:    { marginTop: 14, fontSize: 15, fontWeight: "800", color: "#15803D", textAlign: "center" },
  sheetClearBtn:   { flex: 1, height: 48, borderRadius: 14, backgroundColor: "#F3F4F6", alignItems: "center", justifyContent: "center" },
  sheetClearTxt:   { fontSize: 14, fontWeight: "800", color: "#374151" },
  sheetApplyBtn:   { flex: 2, height: 48, borderRadius: 14, backgroundColor: "#16A34A", alignItems: "center", justifyContent: "center" },
  sheetApplyTxt:   { fontSize: 14, fontWeight: "800", color: "#fff" },
});
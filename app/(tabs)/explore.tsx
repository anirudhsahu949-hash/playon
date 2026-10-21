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
import { useEffect, useMemo, useRef, useState } from "react";
import { db, auth } from "../../firebaseConfig";
import { collection, getDocs, query, where, doc, getDoc } from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { useRouter, useLocalSearchParams } from "expo-router";
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
  (Array.isArray(t.images) && t.images.length > 0 ? t.images[0] : t.image) ||
  "https://images.unsplash.com/photo-1575361204480-aadea25e6e68?auto=format&fit=crop&w=800&q=80";

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

function SlotChip({ slot }: { slot: Slot }) {
  const bk = slot.status === "booked";
  const bl = slot.status === "blocked";
  const ps = slot.status === "past";
  const bg     = bk ? "#FEE2E2" : bl ? "#FEF3C7" : ps ? "#F9FAFB" : "#F0FDF4";
  const border = bk ? "#FECACA" : bl ? "#FDE68A" : ps ? "#E5E7EB" : "#86EFAC";
  const clr    = bk ? "#DC2626" : bl ? "#92400E" : ps ? "#D1D5DB" : "#15803D";
  const sub    = bk ? "Booked"  : bl ? "Locked"  : ps ? ""        : `₹${slot.price}`;
  const subClr = bk ? "#EF4444" : bl ? "#B45309" : "#15803D";
  return (
    <View style={[sc.chip, { backgroundColor: bg, borderColor: border }]}>
      <Text style={[sc.time, { color: clr }]}>{slot.label}</Text>
      {!!sub && <Text style={[sc.sub, { color: subClr }]}>{sub}</Text>}
    </View>
  );
}

const sc = StyleSheet.create({
  chip: { width: 60, paddingVertical: 7, borderRadius: 8, borderWidth: 1, alignItems: "center", marginRight: 6 },
  time: { fontSize: 12, fontWeight: "700" },
  sub:  { fontSize: 10, fontWeight: "600", marginTop: 2 },
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

  const router    = useRouter();
  const searchRef = useRef<TextInput>(null);

  // Home "See all" / highlight cards can open Explore on a filter (e.g. Offers)
  const params = useLocalSearchParams<{ sport?: string }>();
  useEffect(() => {
    if (params.sport) setSport(String(params.sport));
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
      if (u) {
        try {
          const snap = await getDoc(doc(db, "users", u.uid));
          if (snap.exists()) {
            const d = snap.data();
            if (d.latitude != null && d.longitude != null) {
              setUserCoords({ lat: d.latitude, lng: d.longitude });
            }
          }
        } catch { /* non-fatal */ }
      }
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

  const toggleLike = (id: string) => {
    setLiked(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
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

const sportFilters = useMemo<string[]>(() => {
  // Get sports from turfs only (skip gyms — they have no sport field)
  const raw = turfs
    .filter((t: any) => t.venueType !== "gym")
    .flatMap(t => Array.isArray(t.sport) ? t.sport : t.sport ? [t.sport] : []);
  
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const s of raw) {
    const normalized = toTitleCase(s.trim());
    if (!seen.has(normalized.toLowerCase())) {
      seen.add(normalized.toLowerCase());
      unique.push(normalized);
    }
  }

  // ✅ Check if any gyms exist — if yes, add "Gym" chip at the end
    const hasGyms = turfs.some((t: any) => t.venueType === "gym");

  // Only offer the filter when there is something behind it. A chip that leads
  // to an empty list reads as a broken app, not as "no deals today".
    const hasOffers = turfs.some(t => !!offersByTurf[t.id] && !isPhoneOnly(t));

  return [
    "All",
    ...(hasOffers ? ["Offers"] : []),
    ...unique.sort(),
    ...(hasGyms ? ["Gym"] : []),
  ];
}, [turfs, offersByTurf]);

  const likedTurfs = useMemo(() => turfs.filter(t => liked.has(t.id)), [turfs, liked]);

  const filtered = useMemo<Turf[]>(() => {
    const q = search.trim().toLowerCase();

    const withDist = turfs.map(t => {
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

  // Offers filter — turfs and gyms both, since an offer is an offer.
   if (sport === "Offers") {
    if (!offersByTurf[t.id] || isPhoneOnly(t)) return false;
  } else if (sport === "Gym") {
    if (t.venueType !== "gym") return false;
  } else if (sport === "All") {
    // "All" shows only turfs (not gyms)
    if (t.venueType === "gym") return false;
  } else {
    // Specific sport filter — turfs only with matching sport
    if (t.venueType === "gym") return false;
    const sports = Array.isArray(t.sport) ? t.sport : t.sport ? [t.sport] : [];
    if (!sports.some((s: string) => s.toLowerCase() === sport.toLowerCase())) return false;
  }

  if (!q) return true;

  const sportStr = Array.isArray(t.sport)
    ? t.sport.join(" ").toLowerCase()
    : (t.sport ?? "").toLowerCase();
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
   }, [turfs, search, sport, userCoords, offersByTurf, timeFilter]);

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
              <View>
                <Text style={s.title}>Explore</Text>
                <Text style={s.sub}>
                  {userCoords ? "Sorted by distance from you" : "Find your perfect venue"}
                </Text>
              </View>
              {userCoords && (
                <View style={s.nearBadge}>
                  <Ionicons name="location" size={13} color="#15803D" />
                  <Text style={s.nearBadgeTxt}>Near you</Text>
                </View>
              )}
            </View>

            <View style={s.searchWrap}>
              <View style={s.searchBar}>
                <Ionicons name="search-outline" size={18} color="#6B7280" />
                <TextInput
                  ref={searchRef}
                  placeholder="Search turfs, sports, locations..."
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
    f === "All" ? { color: "#374151", icon: "grid-outline" as const } :
    f === "Gym" ? { color: "#7C3AED", icon: "barbell-outline" as const } :
    getSportCfg(f);

  return (
    <TouchableOpacity key={f} style={[s.chip, active && s.chipOn]} onPress={() => setSport(f)} activeOpacity={0.7}>
      <Ionicons name={cfg.icon} size={14} color={active ? "#fff" : cfg.color} />
      <Text style={[s.chipTxt, active && s.chipTxtOn]}>{f}</Text>
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
        {filtered.length} {sport === "Gym" ? "gyms" : sport === "Offers" ? "with offers" : "venues"}
  </Text>
</View>

            {likedTurfs.length > 0 && (
              <View style={s.likedSection}>
                <Text style={s.sectionTitle}>⭐ Saved</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.likedRow}>
                  {likedTurfs.map(t => (
                    <TouchableOpacity key={t.id} style={s.likedCard} onPress={() => handleBook(t.id)} activeOpacity={0.85}>
                      <Image source={{ uri: getTurfImage(t) }} style={s.likedImg} resizeMode="cover" />
                      <View style={s.likedInfo}>
                        <Text numberOfLines={1} style={s.likedName}>{t.name}</Text>
                        <Text style={s.likedPrice}>₹{getBasePrice(t)}/hr</Text>
                      </View>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            )}
          </View>
        }

        ListEmptyComponent={
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

 
    
          const img        = getTurfImage(item);
          const basePrice  = getBasePrice(item);
          const sportArray = Array.isArray(item.sport)
            ? item.sport
            : typeof item.sport === "string" && item.sport.includes(",")
              ? item.sport.split(",").map(s => s.trim())
              : item.sport ? [item.sport] : [];
         const firstSport    = sportArray[0] ?? "";
const firstSportCfg = firstSport ? getSportCfg(firstSport) : SPORT_FALLBACK;
const isLiked       = liked.has(item.id);
const phoneOnly = isPhoneOnly(item);
const callToo   = hasCallOption(item) && !phoneOnly;
const offer     = phoneOnly ? undefined : offersByTurf[item.id];   // offers are online-only

                   const slotPreview = (item.slots ?? [])
            .filter(sl => sl.status !== "past")
            .filter(sl => !timeFilter || sl.start >= timeFilter.start)   // start the row at the chosen time
            .slice(0, 10);
          const winPrice = timeFilter ? windowPrice(item, timeFilter.start, timeFilter.end) : 0;

          return (
            <View style={s.card}>
              <TouchableOpacity style={s.imgWrap} activeOpacity={0.9} onPress={() => handleBook(item.id)}>
                <Image source={{ uri: img }} style={s.img} resizeMode="cover" />
                <View style={s.sportBadge}>
  <Ionicons name={firstSportCfg.icon} size={12} color="#fff" />
  <Text style={s.sportBadgeTxt}>
    {sportArray.slice(0, 2).map(s => toTitleCase(s.trim())).join(" · ") || "Venue"}
  </Text>
</View>
                <TouchableOpacity style={s.heart} onPress={() => toggleLike(item.id)} activeOpacity={0.8} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Ionicons name={isLiked ? "star" : "star-outline"} size={18} color={isLiked ? "#000000" : "#fff"} />
                </TouchableOpacity>
                                <View style={s.imgPrice}>
                                   <Text style={s.imgPriceTxt}>
                    {timeFilter
                      ? `₹${winPrice} · ${hourLabel(timeFilter.start)}–${hourLabel(timeFilter.end)}`
                      : `₹${basePrice}/hr`}
                  </Text>
                </View>
                                {!!offer && (
                  <View style={s.offerBadge}>
                    <Ionicons name="pricetag" size={11} color="#fff" />
                    <Text style={s.offerBadgeTxt}>{offer.badge}</Text>
                  </View>
                )}
              </TouchableOpacity>

              <View style={s.infoRow}>
                <View style={{ flex: 1, marginRight: 10 }}>
                                    <Text numberOfLines={1} style={s.turfName}>{item.name ?? "Turf"}</Text>
                                   {!!offer && (
                    <Text numberOfLines={1} style={s.offerLine}>
                      {offer.title}
                      {offer.qualifier ? ` · ${offer.qualifier}` : ""}
                      {offer.offerCount > 1 ? ` · +${offer.offerCount - 1} more` : ""}
                    </Text>
                  )}
                  <View style={s.locRow}>
                    <Ionicons name="location-outline" size={12} color="#9CA3AF" />
                    <Text numberOfLines={1} style={s.locTxt}> {item.location ?? "—"}</Text>
                    {item.distanceKm != null && (
                      <Text style={s.distInline}> · {fmtDist(item.distanceKm)} away</Text>
                    )}
                  </View>

                                    {callToo && (
                    <View style={s.callLine}>
                      <Ionicons name="call" size={11} color="#15803D" />
                      <Text style={s.callLineTxt}>Also bookable by call</Text>
                    </View>
                  )}
                </View>
                               <TouchableOpacity style={[s.bookBtn, phoneOnly && s.bookBtnPhone]} onPress={() => handleBook(item.id)} activeOpacity={0.85}>
                  {phoneOnly && <Ionicons name="call" size={12} color="#fff" />}
                  <Text style={s.bookBtnTxt}>{phoneOnly ? "Call to Book" : "Book Now"}</Text>
                </TouchableOpacity>
              </View>

                            {phoneOnly ? (
                <TouchableOpacity style={s.phoneStrip} onPress={() => handleBook(item.id)} activeOpacity={0.85}>
                  <View style={s.phoneStripIcon}>
                    <Ionicons name="call-outline" size={15} color="#15803D" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.phoneStripTitle}>Bookings by phone</Text>
                    <Text style={s.phoneStripSub}>
                      Open {shortLabel(item.openingTime ?? 6)} – {shortLabel(item.closingTime ?? 24)} · Tap to see number
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color="#9CA3AF" />
                </TouchableOpacity>
              ) : (
              <View style={s.slotSection}>
                <Text style={s.slotLabel}>Today's slots</Text>
                {item.slotsLoading ? (
                  <ActivityIndicator size="small" color="#0B1220" style={{ marginVertical: 6 }} />
                ) : slotPreview.length === 0 ? (
                  <Text style={s.noSlots}>No upcoming slots today</Text>
                ) : (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingRight: 6 }}>
                    {slotPreview.map((sl, i) => <SlotChip key={i} slot={sl} />)}
                    <TouchableOpacity style={s.moreArrow} onPress={() => handleBook(item.id)} activeOpacity={0.8}>
                      <Ionicons name="chevron-forward" size={16} color="#6B7280" />
                    </TouchableOpacity>
                  </ScrollView>
                )}
              </View>
              )}
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
  nearBadgeTxt: { fontSize: 12, fontWeight: "700", color: "#15803D" },

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

  legendRow:  { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 7, backgroundColor: "#fff", borderTopWidth: 0.5, borderTopColor: "#F0F0F0", gap: 10 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  legendDot:  { width: 12, height: 12, borderRadius: 3, borderWidth: 1 },
  legendTxt:  { fontSize: 11, fontWeight: "600", color: "#6B7280" },
  listCount:  { fontSize: 11, fontWeight: "600", color: "#9CA3AF" },

  likedSection: { backgroundColor: "#fff", marginTop: 8, paddingTop: 10, paddingBottom: 6 },
  sectionTitle: { fontSize: 13, fontWeight: "700", color: "#0B1220", paddingHorizontal: 16, marginBottom: 8 },
  likedRow:     { paddingHorizontal: 16, gap: 10 },
  likedCard:    { width: 110, borderRadius: 10, overflow: "hidden", backgroundColor: "#fff", shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.07, shadowRadius: 3, elevation: 2 },
  likedImg:     { width: "100%", height: 68, backgroundColor: "#E5E7EB" },
  likedInfo:    { padding: 7 },
  likedName:    { fontSize: 11, fontWeight: "700", color: "#0B1220" },
  likedPrice:   { fontSize: 10, color: "#6B7280", marginTop: 1 },

  card: { backgroundColor: "#fff", borderRadius: 18, marginHorizontal: 10, marginBottom: 14, overflow: "hidden", shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  imgWrap:      { width: "100%", height: 165, position: "relative" },
  img:          { width: "100%", height: "100%", backgroundColor: "#E5E7EB" },
  sportBadge: { position: "absolute", top: 10, left: 10, flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "rgba(11,18,32,0.72)", paddingHorizontal: 9, paddingVertical: 4, borderRadius: 20 },
  sportBadgeTxt:{ fontSize: 11, fontWeight: "700", color: "#fff" },
  heart:        { position: "absolute", top: 10, right: 10, width: 30, height: 30, borderRadius: 15, backgroundColor: "rgba(0,0,0,0.3)", alignItems: "center", justifyContent: "center" },
  imgPrice:     { position: "absolute", bottom: 10, right: 10, backgroundColor: "#0B1220", paddingHorizontal: 9, paddingVertical: 4, borderRadius: 20 },
    imgPriceTxt:  { fontSize: 12, fontWeight: "800", color: "#fff" },

  offerBadge:    { position: "absolute", bottom: 10, left: 10, flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#16A34A", paddingHorizontal: 9, paddingVertical: 4, borderRadius: 20 },
  offerBadgeTxt: { fontSize: 11, fontWeight: "800", color: "#fff", letterSpacing: 0.2 },
  offerLine:     { fontSize: 11, fontWeight: "700", color: "#16A34A", marginTop: 3 },

  distBadge:    { position: "absolute", bottom: 10, left: 10, flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: "rgba(11,18,32,0.75)", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999 },
  distBadgeTxt: { fontSize: 11, fontWeight: "700", color: "#fff" },

  infoRow:    { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingTop: 8, paddingBottom: 6 },
  turfName:   { fontSize: 15, fontWeight: "800", color: "#0B1220" },
  locRow:     { flexDirection: "row", alignItems: "center", marginTop: 2 },
  locTxt:     { fontSize: 12, color: "#9CA3AF" },
  distInline: { fontSize: 12, color: "#059669", fontWeight: "600" },

  bookBtn:    { backgroundColor: "#178c42", paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10 },
  bookBtnTxt: { fontSize: 12, fontWeight: "800", color: "#fff" },

  slotSection: { borderTopWidth: 1, borderTopColor: "#F3F4F6", paddingHorizontal: 12, paddingTop: 6, paddingBottom: 10 },
  slotLabel:   { fontSize: 10, fontWeight: "700", color: "#9CA3AF", marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 },
  noSlots:     { fontSize: 12, color: "#9CA3AF", paddingVertical: 4 },
  moreArrow:   { width: 34, height: 50, borderRadius: 8, borderWidth: 1, borderColor: "#E5E7EB", backgroundColor: "#F9FAFB", alignItems: "center", justifyContent: "center" },

  empty:      { alignItems: "center", paddingTop: 80, paddingHorizontal: 40 },
  emptyTitle: { fontSize: 17, fontWeight: "700", color: "#374151", marginTop: 14 },
  emptySub:   { fontSize: 13, color: "#9CA3AF", textAlign: "center", marginTop: 6, lineHeight: 20 },
  emptyBtn:   { marginTop: 18, backgroundColor: "#0B1220", paddingHorizontal: 22, paddingVertical: 10, borderRadius: 10 },
  emptyBtnTxt:{ fontSize: 13, fontWeight: "700", color: "#fff" },
    // phone booking
  bookBtnPhone:    { flexDirection: "row", alignItems: "center", gap: 5 },
  callLine:        { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 3 },
  callLineTxt:     { fontSize: 11, fontWeight: "700", color: "#15803D" },
  phoneStrip:      { flexDirection: "row", alignItems: "center", gap: 10, borderTopWidth: 1, borderTopColor: "#F3F4F6", paddingHorizontal: 12, paddingVertical: 10 },
  phoneStripIcon:  { width: 30, height: 30, borderRadius: 9, backgroundColor: "#DCFCE7", alignItems: "center", justifyContent: "center" },
  phoneStripTitle: { fontSize: 12.5, fontWeight: "800", color: "#0B1220" },
  phoneStripSub:   { fontSize: 11, fontWeight: "600", color: "#6B7280", marginTop: 1 },

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
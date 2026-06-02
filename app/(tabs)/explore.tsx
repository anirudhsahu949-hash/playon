import {
  View,
  Text,
  TextInput,
  FlatList,
  TouchableOpacity,
  Image,
  StyleSheet,
  SafeAreaView,
  StatusBar,
  ActivityIndicator,
  Platform,
  ScrollView,
  Alert,
  RefreshControl
} from "react-native";
import { useEffect, useMemo, useRef, useState } from "react";
import { db, auth } from "../../firebaseConfig";
import { collection, getDocs, query, where, doc, getDoc } from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

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
  slots?: Slot[];
  slotsLoading?: boolean;
  latitude?: number | null;
  longitude?: number | null;
  distanceKm?: number | null;
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

// ─────────────────────────────────────────────────────────────────────────────

function pad(n: number) { return String(n).padStart(2, "0"); }

function formatTime(v: number): string {
  if (v >= 24) v = 0;
  const h = Math.floor(v);
  const m = Math.round((v % 1) * 60);
  const suffix = h >= 12 ? "PM" : "AM";
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr}:${pad(m)} ${suffix}`;
}

function shortLabel(v: number): string {
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

function parseSlotRange(s: string): { start: number; end: number } | null {
  try {
    const parts = s.split(" - ");
    if (parts.length < 2) return null;
    const start = parseTime(parts[0].trim());
    let end = parseTime(parts[1].trim());
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
  const close = turf.closingTime ?? 24;
  const now   = nowDecimal();
  const day   = turf.dayPrice   || turf.price || 0;
  const night = turf.nightPrice || turf.price || 0;
  const slots: Slot[] = [];

  for (let t = open; t < close; t += 0.5) {
    const next    = Math.min(t + 0.5, close);
    const timeStr = `${formatTime(t)} - ${formatTime(next)}`;
    const price   = t >= 6 && t < 18 ? day : night;
    let status: SlotStatus = "available";

    if (t < now) {
      status = "past";
    } else {
      const isBooked = bookedStrings.some(s => {
        const r = parseSlotRange(s.trim());
        return r ? rangesOverlap(t, next, r.start, r.end) : s.trim() === timeStr.trim();
      });
      const isBlocked = blockedStrings.some(s => {
        const r = parseSlotRange(s.trim());
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
  const [turfs,      setTurfs]      = useState<Turf[]>([]);
  const [turfsBase,  setTurfsBase]  = useState<Turf[]>([]);
  const [search,     setSearch]     = useState("");
  const [sport,      setSport]      = useState("All");
  const [liked,      setLiked]      = useState<Set<string>>(new Set());
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [userCoords, setUserCoords] = useState<{ lat: number; lng: number } | null>(null);

  const router    = useRouter();
  const searchRef = useRef<TextInput>(null);

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
    const raw = turfs.flatMap(t =>
      Array.isArray(t.sport) ? t.sport : t.sport ? [t.sport] : []
    );
    const seen = new Set<string>();
    const unique: string[] = [];
    for (const s of raw) {
      const normalized = toTitleCase(s.trim());
      if (!seen.has(normalized.toLowerCase())) {
        seen.add(normalized.toLowerCase());
        unique.push(normalized);
      }
    }
    return ["All", ...unique.sort()];
  }, [turfs]);

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

    return sorted.filter(t => {
      if (sport !== "All") {
        const sports = Array.isArray(t.sport) ? t.sport : t.sport ? [t.sport] : [];
        if (!sports.some(s => s.toLowerCase() === sport.toLowerCase())) return false;
      }
      if (!q) return true;
      const sportStr = Array.isArray(t.sport)
        ? t.sport.join(" ").toLowerCase()
        : (t.sport ?? "").toLowerCase();
      return [
        (t.name ?? "").toLowerCase(),
        (t.location ?? "").toLowerCase(),
        sportStr,
      ].some(v => v.includes(q));
    });
  }, [turfs, search, sport, userCoords]);

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
    <SafeAreaView style={s.root}>
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
            <View style={s.header}>
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
                  <View style={s.searchFilter}>
                    <Ionicons name="options-outline" size={16} color="#374151" />
                  </View>
                )}
              </View>
            </View>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>
             {sportFilters.map(f => {
  const active = sport === f;
  const cfg = f === "All" ? { color: "#374151", icon: "grid-outline" as const } : getSportCfg(f);
  return (
    <TouchableOpacity key={f} style={[s.chip, active && s.chipOn]} onPress={() => setSport(f)} activeOpacity={0.7}>
      <Ionicons name={cfg.icon} size={14} color={active ? "#fff" : cfg.color} />
      <Text style={[s.chipTxt, active && s.chipTxtOn]}>{f}</Text>
    </TouchableOpacity>
  );
})}
            </ScrollView>

            <View style={s.legendRow}>
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
              <View style={{ flex: 1 }} />
              <Text style={s.listCount}>{filtered.length} venues</Text>
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
            <Text style={s.emptyTitle}>No venues found</Text>
            <Text style={s.emptySub}>Try a different sport or clear your search.</Text>
            <TouchableOpacity style={s.emptyBtn} onPress={() => { setSearch(""); setSport("All"); }}>
              <Text style={s.emptyBtnTxt}>Show all</Text>
            </TouchableOpacity>
          </View>
        }

        renderItem={({ item }) => {
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

          const slotPreview = (item.slots ?? [])
            .filter(sl => sl.status !== "past")
            .slice(0, 10);

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
                  <Text style={s.imgPriceTxt}>₹{basePrice}/hr</Text>
                </View>
              </TouchableOpacity>

              <View style={s.infoRow}>
                <View style={{ flex: 1, marginRight: 10 }}>
                  <Text numberOfLines={1} style={s.turfName}>{item.name ?? "Turf"}</Text>
                  <View style={s.locRow}>
                    <Ionicons name="location-outline" size={12} color="#9CA3AF" />
                    <Text numberOfLines={1} style={s.locTxt}> {item.location ?? "—"}</Text>
                    {item.distanceKm != null && (
                      <Text style={s.distInline}> · {fmtDist(item.distanceKm)} away</Text>
                    )}
                  </View>
                </View>
                <TouchableOpacity style={s.bookBtn} onPress={() => handleBook(item.id)} activeOpacity={0.85}>
                  <Text style={s.bookBtnTxt}>Book Now</Text>
                </TouchableOpacity>
              </View>

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
            </View>
          );
        }}
      />
    </SafeAreaView>
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
    paddingTop: Platform.OS === "android" ? (StatusBar.currentHeight ?? 0) + 10 : 12,
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
});
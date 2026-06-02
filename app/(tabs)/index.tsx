import {
  View, Text, TouchableOpacity, Image, StyleSheet,
  ScrollView, RefreshControl, SafeAreaView, StatusBar,
  ActivityIndicator, Dimensions, Linking, Alert, Platform,
} from "react-native";
import { useEffect, useMemo, useState } from "react";
import { collection, getDocs, doc, getDoc, orderBy, query } from "firebase/firestore";
import { db, auth } from "../../firebaseConfig";
import { useRouter } from "expo-router";
import Carousel from "react-native-reanimated-carousel";
import { Ionicons } from "@expo/vector-icons";
import { onAuthStateChanged } from "firebase/auth";
import { subscribeToNotifications } from "./../notification/usenotification";
import GymCard from "../../components/screen-gym/gym-card-horizontal";

const { width: SCREEN_W } = Dimensions.get("window");
const BRAND = "#0B1220";
const GREEN = "#22C55E";
const WHITE = "#FFFF";

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

// ─────────────────────────────────────────────────────────────────────────────
// MODULE-LEVEL CACHE
// Lives outside the component so it survives tab switches and re-mounts.
// Each cache entry stores the data + the timestamp it was fetched.
// TTL = 10 minutes. Pull-to-refresh always bypasses (forceRefresh = true).
// ─────────────────────────────────────────────────────────────────────────────
const CACHE_TTL = 2 * 60 * 1000; // 10 minutes in ms

type CacheEntry<T> = { data: T; fetchedAt: number } | null;

let _turfsCache:      CacheEntry<any[]>             = null;
let _bannersCache:    CacheEntry<any[]>             = null;
let _sectionsCache:   CacheEntry<FeaturedSection[]> = null;
let _highlightsCache: CacheEntry<HighlightCard[]>   = null;
let _gymsCache: CacheEntry<any[]> = null;

function isFresh(entry: CacheEntry<any>): boolean {
  if (!entry) return false;
  return Date.now() - entry.fetchedAt < CACHE_TTL;
}

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
type FeaturedSection = {
  id: string;
  title: string;
  subtitle?: string;
  icon: string;
  type: "manual" | "sport" | "location" | "nearby" | "all" | "highlights";
  turfIds: string[];
  filter?: { sport?: string; location?: string };
  maxItems?: number;
  active: boolean;
  order: number;
  style: "horizontal" | "grid";
};

type HighlightCard = {
  id: string;
  title: string;
  sub: string;
  icon: string;
  color: string;
  iconBg: string;
  action: "explore" | "sport" | "turf" | "link" | "profile";
  actionValue: string;
  active: boolean;
  order: number;
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function fmtDist(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  if (km < 10) return `${km.toFixed(1)} km`;
  return `${Math.round(km)} km`;
}
const getTurfImage = (item: any): string =>
  (Array.isArray(item.images) && item.images.length > 0 ? item.images[0] : item.image) ||
  "https://media.istockphoto.com/id/1405637348/photo/red-cricket-ball.jpg?s=612x612&w=0&k=20&c=DBkyp2Pp7AZOtqJrn9daux-NHl7ZwdDC5VnH8mCSZrE=";
const getNightPrice = (item: any): number => item.nightPrice || item.price || 0;
const getDayPrice   = (item: any): number => item.dayPrice   || item.price || 0;
const getRating = (item: any): string | null => {
  const r = parseFloat(item.rating);
  if (!isNaN(r) && r > 0) return r.toFixed(1);
  return null;
};
const getSport = (item: any): string[] => {
  if (Array.isArray(item.sport)) return item.sport;
  return item.sport ? [item.sport] : [];
};

// ─────────────────────────────────────────────────────────────────────────────

function SportTag({ sport }: { sport: string }) {
  const cfg = SPORT_STYLE[sport] ?? SPORT_FALLBACK;
  return (
    <View style={[pc.sportTag, { backgroundColor: cfg.color + "14", borderColor: cfg.color + "33" }]}>
      <Ionicons name={cfg.icon} size={12} color={cfg.color} />
      <Text style={[pc.sportTagTxt, { color: cfg.color }]}>{sport}</Text>
    </View>
  );
}
// PopCard
// ─────────────────────────────────────────────────────────────────────────────
function PopCard({
  item, userCoords, onPress, label,
}: {
  item: any;
  userCoords: { lat: number; lng: number } | null;
  onPress: () => void;
  label?: string;
}) {
  const dist = userCoords && item.latitude != null
    ? haversine(userCoords.lat, userCoords.lng, item.latitude, item.longitude)
    : null;
  const sport = getSport(item);
  const rating = getRating(item);

  return (
    <TouchableOpacity style={pc.card} onPress={onPress} activeOpacity={0.9}>
      <View style={pc.imgWrap}>
        <Image source={{ uri: getTurfImage(item) }} style={pc.img} resizeMode="cover" />

        <View style={pc.topLeft}>
          <Text style={pc.topLeftTxt}>
            {label ?? "🔥 Popular"}
          </Text>
        </View>
      </View>

      <View style={pc.body}>
        <Text numberOfLines={1} style={pc.name}>{item.name}</Text>

        <View style={pc.locRow}>
          <Ionicons name="location-outline" size={12} color="#9CA3AF" />
          <Text numberOfLines={1} style={pc.locTxt}>{item.location || "—"}</Text>
          {rating && (
            <View style={pc.ratingInline}>
              <Ionicons name="star" size={11} color={GREEN} />
              <Text style={pc.ratingInlineTxt}>{rating}</Text>
            </View>
          )}
        </View>

        <View style={pc.footer}>
          <View style={pc.sportsRow}>
  {sport.map((sp, index) => (
    <SportTag key={index} sport={sp} />
  ))}
</View>
          <Text style={pc.price}>₹{getNightPrice(item)}/hr</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

const pc = StyleSheet.create({
  card: {
    width: 290,
    backgroundColor: "#fff",
    borderRadius: 18,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#E5E7EB",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  imgWrap: { width: "100%", height: 165, position: "relative" },
  img:     { width: "100%", height: "100%", backgroundColor: "#E5E7EB" },

  topLeft:    { position: "absolute", top: 10, left: 10, backgroundColor: "rgba(11,18,32,0.72)", paddingHorizontal: 9, paddingVertical: 4, borderRadius: 99 },
  topLeftTxt: { fontSize: 11, fontWeight: "700", color: "#fff" },

  heartBtn: { position: "absolute", top: 10, right: 10, width: 30, height: 30, borderRadius: 15, backgroundColor: "rgba(0,0,0,0.35)", alignItems: "center", justifyContent: "center" },

  ratingBadge: { position: "absolute", bottom: 10, right: 10, flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: "rgba(0,0,0,0.6)", paddingHorizontal: 7, paddingVertical: 4, borderRadius: 99 },
  ratingTxt:   { fontSize: 11, fontWeight: "800", color: "#fff" },

  body:   { padding: 12 },
  name:   { fontSize: 15, fontWeight: "800", color: BRAND },
  locRow: { flexDirection: "row", alignItems: "center", gap: 3, marginTop: 4 },
  locTxt: { fontSize: 12, color: "#9CA3AF", flex: 1 },

  ratingInline:    { flexDirection: "row", alignItems: "center", gap: 2, marginLeft: "auto" },
  ratingInlineTxt: { fontSize: 12, fontWeight: "700", color: GREEN },

  footer:    { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 10 },
  sportsRow: { flexDirection: "row", gap: 6, flex: 1, flexWrap: "wrap" },
sportTag:    { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 99, borderWidth: 1 },
sportTagTxt: { fontSize: 11, fontWeight: "700" },
  price:     { fontSize: 14, fontWeight: "900", color: BRAND },
});

// ─────────────────────────────────────────────────────────────────────────────
// FullCard
// ─────────────────────────────────────────────────────────────────────────────
function FullCard({
  item, userCoords, onPress,
}: {
  item: any;
  userCoords: { lat: number; lng: number } | null;
  onPress: () => void;
}) {
  const dist   = userCoords && item.latitude != null
    ? haversine(userCoords.lat, userCoords.lng, item.latitude, item.longitude)
    : null;
  const sport  = getSport(item);
  const rating = getRating(item);

  return (
    <TouchableOpacity style={fc.card} onPress={onPress} activeOpacity={0.92}>
      <View style={fc.imgWrap}>
        <Image source={{ uri: getTurfImage(item) }} style={fc.img} resizeMode="cover" />
        <View style={fc.gradient} />

       {sport.length > 0 && (
  <View style={fc.sportBadge}>
    {sport.map((sp, index) => {
      const cfg = SPORT_STYLE[sp] ?? SPORT_FALLBACK;
      return (
        <View key={index} style={fc.sportBadgeItem}>
          <Ionicons name={cfg.icon} size={11} color="#fff" />
          <Text style={fc.sportTxt}>{sp}</Text>
        </View>
      );
    })}
  </View>
)}

        {dist != null && (
          <View style={fc.distBadge}>
            <Ionicons name="location" size={11} color="#fff" />
            <Text style={fc.distTxt}>{fmtDist(dist)}</Text>
          </View>
        )}

        <View style={fc.topOverlay}>
          <Text numberOfLines={1} style={fc.name}>
            {item.name}
          </Text>
        </View>

        <View style={fc.bottomOverlay}>
          <View style={fc.locationBadge}>
            <Ionicons name="location-outline" size={13} color="#fff" />
            <Text numberOfLines={1} style={fc.locTxt}>
              {item.location || "—"}
            </Text>
          </View>
        </View>
      </View>

      <View style={fc.bottom}>
        <View>
          <Text style={fc.bottomLabel}>Night price</Text>
          <Text style={fc.bottomPrice}>₹{getNightPrice(item)}/hr</Text>
        </View>
        <View style={fc.bottomRight}>
          <Text style={fc.dayPrice}>Day ₹{getDayPrice(item)}/hr</Text>
          <TouchableOpacity style={fc.bookBtn} onPress={onPress} activeOpacity={0.85}>
            <Text style={fc.bookBtnTxt}>Book Now</Text>
            <Ionicons name="arrow-forward" size={12} color="#fff" />
          </TouchableOpacity>
        </View>
      </View>
    </TouchableOpacity>
  );
}

const fc = StyleSheet.create({
  card:    { backgroundColor: "#fff", borderRadius: 18, marginBottom: 14, overflow: "hidden", shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.07, shadowRadius: 6, elevation: 3 },
  imgWrap: { width: "100%", height: 180, position: "relative" },
  img:     { width: "100%", height: "100%", backgroundColor: "#fff" },
  gradient:{ position: "absolute", bottom: 0, left: 0, right: 0, top: 0, backgroundColor: "rgba(0,0,0,0.03)" },

  priceBadge: { position: "absolute", top: 12, left: 12, backgroundColor: "#16A34A", paddingHorizontal: 10, paddingVertical: 5, borderRadius: 99 },
  priceTxt:   { fontSize: 12, fontWeight: "800", color: "#fff" },

 sportBadge:     { position: "absolute", top: 8, right: 10, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "rgba(0,0,0,0.55)", paddingHorizontal: 10, paddingVertical: 5, borderRadius: 99, borderWidth: 1, borderColor: "rgba(255,255,255,0.15)" },
sportBadgeItem: { flexDirection: "row", alignItems: "center", gap: 3 },
sportTxt:       { fontSize: 11, fontWeight: "700", color: "#fff" },

  distBadge: { position: "absolute", bottom: 10, right: 12, flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: "rgba(11,18,32,0.75)", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 99 },
  distTxt:   { fontSize: 11, fontWeight: "700", color: "#fff" },

  ratingBadge: { position: "absolute", bottom: 60, left: 12, flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: "rgba(0,0,0,0.65)", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 99 },
  ratingTxt:   { fontSize: 11, fontWeight: "800", color: "#fff" },

  overlay: { position: "absolute", bottom: 0, left: 0, right: 0, padding: 14, backgroundColor: "rgba(0,0,0,0.008)" },
  topOverlay: { position: "absolute", top: 12, left: 14, right: 90 },
  bottomOverlay: { position: "absolute", bottom: 8, left: 8, right: 100 },
  name: { fontSize: 19, fontWeight: "900", color: "#fff", letterSpacing: -0.3 },
  locRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  locTxt: { fontSize: 12, color: "#fff", fontWeight: "700", maxWidth: 180 },
  locationBadge: {
    flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start",
    backgroundColor: "rgba(0,0,0,0.55)", paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 999, borderWidth: 1, borderColor: "rgba(255,255,255,0.12)",
  },

  bottom:       { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "#fff", paddingHorizontal: 14, paddingVertical: 12 },
  bottomLabel:  { fontSize: 10, color: "#9CA3AF", fontWeight: "500", textTransform: "uppercase", letterSpacing: 0.4 },
  bottomPrice:  { fontSize: 15, fontWeight: "900", color: BRAND, marginTop: 1 },
  bottomRight:  { flexDirection: "row", alignItems: "center", gap: 10 },
  dayPrice:     { fontSize: 12, color: "#9CA3AF", fontWeight: "500" },
  bookBtn:      { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#178c42", paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10 },
  bookBtnTxt:   { fontSize: 12, fontWeight: "800", color: "#fff" },
});

// ─────────────────────────────────────────────────────────────────────────────
// FeaturedSectionRow — unchanged, renders one admin-controlled section
// ─────────────────────────────────────────────────────────────────────────────
function FeaturedSectionRow({
  section, allTurfs, sortedTurfs, allHighlights, userCoords, onTurf, onExplore, onHighlight,
}: {
  section: FeaturedSection;
  allTurfs: any[];
  sortedTurfs: any[];
  allHighlights: HighlightCard[];
  userCoords: { lat: number; lng: number } | null;
  onTurf: (id: string) => void;
  onExplore: () => void;
  onHighlight: (card: HighlightCard) => void;
}) {
  const turfsToShow = useMemo(() => {
    const max = section.maxItems ?? 6;
    if (section.type === "nearby")    return sortedTurfs.slice(0, max);
    if (section.type === "all")       return sortedTurfs.slice(0, max);
    if (section.type === "highlights") return [];
    if (section.type === "manual") {
      return section.turfIds
        .map(id => allTurfs.find(t => t.id === id))
        .filter(Boolean);
    }
    if (section.type === "sport") {
      const sp = section.filter?.sport?.toLowerCase();
      return allTurfs.filter(t => {
        const sports = Array.isArray(t.sport) ? t.sport : [t.sport];
        return sports.some((s: string) => s?.toLowerCase() === sp);
      });
    }
    if (section.type === "location") {
      const loc = section.filter?.location?.toLowerCase() || "";
      return allTurfs.filter(t => (t.location || "").toLowerCase().includes(loc));
    }
    return [];
  }, [section, allTurfs, sortedTurfs]);

  if (section.type === "highlights") {
    if (allHighlights.length === 0) return null;
    return (
      <View style={s.section}>
        <View style={s.sectionRow}>
          <View style={s.sectionTitleWrap}>
            <Text style={s.sectionEmoji}>{section.icon}</Text>
            <View>
              <Text style={s.sectionTitle}>{section.title}</Text>
              {section.subtitle ? <Text style={s.sectionSubtitle}>{section.subtitle}</Text> : null}
            </View>
          </View>
          <TouchableOpacity style={s.seeAllBtn} onPress={onExplore} activeOpacity={0.7}>
            <Text style={s.seeAllTxt}>See all</Text>
            <Ionicons name="arrow-forward" size={13} color={BRAND} />
          </TouchableOpacity>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingRight: 4 }}>
          {allHighlights.map(card => (
            <TouchableOpacity
              key={card.id}
              style={[s.pickCard, { backgroundColor: card.color }]}
              activeOpacity={0.85}
              onPress={() => onHighlight(card)}
            >
              <Text style={s.pickTitle}>{card.title}</Text>
              <Text style={s.pickSub}>{card.sub}</Text>
              <View style={[s.pickIconWrap, { backgroundColor: card.iconBg }]}>
                <Text style={s.pickIcon}>{card.icon}</Text>
              </View>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>
    );
  }

  if (turfsToShow.length === 0) return null;

  return (
    <View style={s.section}>
      <View style={s.sectionRow}>
        <View style={s.sectionTitleWrap}>
          <Text style={s.sectionEmoji}>{section.icon}</Text>
          <View>
            <Text style={s.sectionTitle}>{section.title}</Text>
            {section.subtitle ? <Text style={s.sectionSubtitle}>{section.subtitle}</Text> : null}
          </View>
        </View>
        <TouchableOpacity style={s.seeAllBtn} onPress={onExplore} activeOpacity={0.7}>
          <Text style={s.seeAllTxt}>See all</Text>
          <Ionicons name="arrow-forward" size={13} color={BRAND} />
        </TouchableOpacity>
      </View>

      {section.style === "horizontal" ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 12, paddingRight: 4 }}
        >
          {turfsToShow.map((item: any, i: number) => (
            <PopCard
              key={item.id}
              item={item}
              userCoords={userCoords}
              onPress={() => onTurf(item.id)}
            />
          ))}
        </ScrollView>
      ) : (
        <View>
          {turfsToShow.map((item: any) => (
            <FullCard key={item.id} item={item} userCoords={userCoords} onPress={() => onTurf(item.id)} />
          ))}
        </View>
      )}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Home Screen
// ─────────────────────────────────────────────────────────────────────────────
export default function Home() {
  const [turfs,      setTurfs]      = useState<any[]>([]);
  const [banners,    setBanners]    = useState<any[]>([]);
  const [sections,   setSections]   = useState<FeaturedSection[]>([]);
  const [highlights, setHighlights] = useState<HighlightCard[]>([]);
  const [user,        setUser]        = useState<any>(null);
  const [userInitial, setUserInitial] = useState("U");
  const [userAvatar,  setUserAvatar]  = useState<string | null>(null);
  const [location,    setLocation]    = useState("Amravati Division, Amravati");
  const [loading,     setLoading]     = useState(true);
  const [refreshing,  setRefreshing]  = useState(false);
  const [activeDot,   setActiveDot]   = useState(0);
  const [notifCount,  setNotifCount]  = useState(0);
  const [userCoords,  setUserCoords]  = useState<{ lat: number; lng: number } | null>(null);
  const router = useRouter();

  // gym 
  const [gyms, setGyms] = useState<any[]>([]);
  // end

  useEffect(() => {
    loadHome();
    const unsubAuth = onAuthStateChanged(auth, (u) => {
      setUser(u);
      if (u) fetchUser(u.uid);
      else { setUserInitial("U"); setUserAvatar(null); setUserCoords(null); }
    });
    const unsubNotif = subscribeToNotifications((notifs) => {
      setNotifCount(notifs.filter((n: any) => !n.read).length);
    });
    return () => { unsubAuth(); unsubNotif(); };
  }, []);

  // ─── loadHome — forceRefresh=false by default (uses cache) ───────────────
  // Pull-to-refresh passes forceRefresh=true to bypass the cache and
  // re-fetch everything fresh from Firestore.
  const loadHome = async (forceRefresh = false) => {
    try {
      setLoading(true);
      await Promise.all([
        fetchTurfs(forceRefresh),
        fetchBanners(forceRefresh),
        fetchSections(forceRefresh),
        fetchHighlights(forceRefresh),
        // gym
         fetchGyms(forceRefresh), 
      ]);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  // ─── fetchTurfs ───────────────────────────────────────────────────────────
  // BEFORE: getDocs on every mount = N reads every tab switch
  // AFTER:  reads from module-level cache; only hits Firestore when cache is
  //         stale (>10 min) or forceRefresh=true (pull-to-refresh)
  const fetchTurfs = async (forceRefresh = false) => {
    if (!forceRefresh && isFresh(_turfsCache)) {
      // ✅ Cache hit — 0 Firestore reads
      setTurfs(_turfsCache!.data);
      return;
    }
    // Cache miss or forced refresh — fetch from Firestore
    const snap = await getDocs(collection(db, "turfs"));
    // FIX — one extra line
const data = snap.docs
  .map(d => ({ id: d.id, ...d.data() }))
  .filter((t: any) => t.active !== false);   // ← ADD THIS
    _turfsCache = { data, fetchedAt: Date.now() };
    setTurfs(data);
  };

  // gym code
  const fetchGyms = async (forceRefresh = false) => {
  if (!forceRefresh && isFresh(_gymsCache)) {
    setGyms(_gymsCache!.data);
    return;
  }
  const snap = await getDocs(collection(db, "gyms"));
  const data = snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter((g: any) => g.active !== false);
  _gymsCache = { data, fetchedAt: Date.now() };
  setGyms(data);
};

  // ─── fetchBanners ─────────────────────────────────────────────────────────
  // Banners change only when admin updates them — safe to cache for 10 min
  const fetchBanners = async (forceRefresh = false) => {
    if (!forceRefresh && isFresh(_bannersCache)) {
      setBanners(_bannersCache!.data);
      return;
    }
    const snap = await getDocs(collection(db, "banners"));
    const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    _bannersCache = { data, fetchedAt: Date.now() };
    setBanners(data);
  };

  // ─── fetchSections ────────────────────────────────────────────────────────
  // Featured sections change only when admin reorders/edits them
  const fetchSections = async (forceRefresh = false) => {
    if (!forceRefresh && isFresh(_sectionsCache)) {
      setSections(_sectionsCache!.data);
      return;
    }
    const snap = await getDocs(query(collection(db, "featuredSections"), orderBy("order")));
    const data = snap.docs.map(d => ({ id: d.id, ...d.data() } as FeaturedSection)).filter(s => s.active);
    _sectionsCache = { data, fetchedAt: Date.now() };
    setSections(data);
  };

  // ─── fetchHighlights ──────────────────────────────────────────────────────
  // Highlight cards change only when admin edits them
  const fetchHighlights = async (forceRefresh = false) => {
    if (!forceRefresh && isFresh(_highlightsCache)) {
      setHighlights(_highlightsCache!.data);
      return;
    }
    const snap = await getDocs(query(collection(db, "featuredHighlights"), orderBy("order")));
    const data = snap.docs.map(d => ({ id: d.id, ...d.data() } as HighlightCard)).filter(h => h.active);
    _highlightsCache = { data, fetchedAt: Date.now() };
    setHighlights(data);
  };

  // ─── fetchUser — single doc read, no cache needed ────────────────────────
  // User doc is per-user so it's already 1 read. No change needed here.
  const fetchUser = async (uid: string) => {
    try {
      const snap = await getDoc(doc(db, "users", uid));
      if (snap.exists()) {
        const d = snap.data();
        setUserInitial((d.name || "U").charAt(0).toUpperCase());
        setLocation(d.location || d.city || "Amravati Division, Amravati");
        if (d.photoURL) setUserAvatar(d.photoURL);
        if (d.latitude != null && d.longitude != null)
          setUserCoords({ lat: d.latitude, lng: d.longitude });
      }
    } catch (e) { console.error(e); }
  };

  // ─── onRefresh — bypasses all caches, re-fetches everything fresh ─────────
  const onRefresh = async () => {
    setRefreshing(true);
    await loadHome(true); // forceRefresh=true → ignores cache, hits Firestore
    if (auth.currentUser) await fetchUser(auth.currentUser.uid);
    setRefreshing(false);
  };

  const openBannerLink = async (link?: string) => {
    if (!link) return;
    const url = link.startsWith("http") ? link : `https://${link}`;
    try { if (await Linking.canOpenURL(url)) await Linking.openURL(url); }
    catch { Alert.alert("Error", "Unable to open this link."); }
  };

  const goToTurf = (id: string) => {
    if (!auth.currentUser) {
      Alert.alert("Login required", "Please log in to book.", [
        { text: "Cancel", style: "cancel" },
        { text: "Log In", onPress: () => router.push("/(auth)/login") },
      ]);
      return;
    }
    router.push(`/turf/${id}`);
  };

  const onHighlightTap = (card: HighlightCard) => {
    if (card.action === "explore") router.push("/(tabs)/explore");
    else if (card.action === "sport") router.push({ pathname: "/(tabs)/explore", params: { sport: card.actionValue } });
    else if (card.action === "turf" && card.actionValue) goToTurf(card.actionValue);
    else if (card.action === "link" && card.actionValue) openBannerLink(card.actionValue);
    else if (card.action === "profile") router.push("/(tabs)/profile");
  };

  const activeBanners = useMemo(() => banners.filter(b => b.active !== false), [banners]);

  const sortedTurfs = useMemo(() => {
    if (!userCoords) return turfs;
    return [...turfs].sort((a, b) => {
      const hasA = a.latitude != null && a.longitude != null;
      const hasB = b.latitude != null && b.longitude != null;
      if (!hasA && !hasB) return 0;
      if (!hasA) return 1;
      if (!hasB) return -1;
      return haversine(userCoords.lat, userCoords.lng, a.latitude, a.longitude) -
             haversine(userCoords.lat, userCoords.lng, b.latitude, b.longitude);
    });
  }, [turfs, userCoords]);

  // gym code
  const sortedGyms = useMemo(() => {
  if (!userCoords) return gyms;
  return [...gyms].sort((a, b) => {
    const hasA = a.latitude != null && a.longitude != null;
    const hasB = b.latitude != null && b.longitude != null;
    if (!hasA && !hasB) return 0;
    if (!hasA) return 1;
    if (!hasB) return -1;
    return haversine(userCoords.lat, userCoords.lng, a.latitude, a.longitude) -
           haversine(userCoords.lat, userCoords.lng, b.latitude, b.longitude);
  });
}, [gyms, userCoords]);

const goToGym = (id: string) => {
  if (!auth.currentUser) {
    Alert.alert("Login required", "Please log in to view memberships.", [
      { text: "Cancel", style: "cancel" },
      { text: "Log In", onPress: () => router.push("/(auth)/login") },
    ]);
    return;
  }
  router.push(`../turf/gym-details/${id}`);
};

  if (loading) return (
    <SafeAreaView style={s.center}>
      <StatusBar barStyle="dark-content" backgroundColor="#F5F5F5" />
      <ActivityIndicator size="large" color={BRAND} />
      <Text style={s.loadTxt}>Loading Playon...</Text>
    </SafeAreaView>
  );

  return (
    <SafeAreaView style={s.root}>
      <StatusBar barStyle="dark-content" backgroundColor="#F5F5F5" />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={s.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={BRAND} />}
      >
        {/* ── Header ── */}
        <View style={s.fixedHeader}>
          <View style={s.header}>
            <View style={s.headerTextBlock}>
              <Text style={s.appTitle}>Playon</Text>
              <TouchableOpacity style={s.locationRow} activeOpacity={0.7} onPress={() => router.push("/(tabs)/explore")}>
                <Ionicons name="location-outline" size={14} color="#6B7280" />
                <Text style={s.locationTxt} numberOfLines={1}>{location}</Text>
                <Ionicons name="chevron-down" size={13} color="#6B7280" />
              </TouchableOpacity>
            </View>
            <View style={s.headerIcons}>
              <TouchableOpacity style={s.iconCircle} onPress={() => router.push("/(tabs)/explore")} activeOpacity={0.8}>
                <Ionicons name="search-outline" size={21} color={BRAND} />
              </TouchableOpacity>
              <TouchableOpacity style={s.iconCircle} onPress={() => router.push("/notification/user-notification")} activeOpacity={0.8}>
                <Ionicons name="notifications-outline" size={21} color={BRAND} />
                {notifCount > 0 && <View style={s.badge}><Text style={s.badgeTxt}>{notifCount}</Text></View>}
              </TouchableOpacity>
              <TouchableOpacity style={s.avatarWrap} onPress={() => user ? router.push("/(tabs)/profile") : router.push("/(auth)/login")} activeOpacity={0.85}>
                {userAvatar
                  ? <Image source={{ uri: userAvatar }} style={s.avatarImg} />
                  : <View style={s.avatarFallback}><Text style={s.avatarTxt}>{userInitial}</Text></View>}
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* ── Banners ── */}
        {activeBanners.length > 0 && (
          <View style={s.bannerSection}>
            <Carousel
              width={SCREEN_W} height={190} autoPlay autoPlayInterval={3500}
              scrollAnimationDuration={700} data={activeBanners}
              onSnapToItem={i => setActiveDot(i)} mode="parallax"
              pagingEnabled snapEnabled loop enabled
              modeConfig={{ parallaxScrollingScale: 0.94, parallaxScrollingOffset: 18 }}
              style={{ width: SCREEN_W, alignSelf: "center" }}
              renderItem={({ item }) => (
                <TouchableOpacity style={s.bannerCard} activeOpacity={0.92} onPress={() => openBannerLink(item.link)} disabled={!item.link}>
                  <Image source={{ uri: item.image }} style={s.bannerImg} resizeMode="cover" />
                  <View style={s.bannerOverlay} />
                  <View style={s.bannerContent}>
                    {!!item.badge    && <View style={s.bannerBadge}><Text style={s.bannerBadgeTxt}>{item.badge}</Text></View>}
                    {!!item.title    && <Text style={s.bannerTitle}>{item.title}</Text>}
                    {!!item.subtitle && <Text style={s.bannerSub}>{item.subtitle}</Text>}
                    {!!item.date && (
                      <View style={s.bannerDateRow}>
                        <Ionicons name="calendar-outline" size={13} color="rgba(255,255,255,0.8)" />
                        <Text style={s.bannerDateTxt}>{item.date}</Text>
                      </View>
                    )}
                    {!!item.link && (
                      <TouchableOpacity style={s.bannerBtn} onPress={() => openBannerLink(item.link)} activeOpacity={0.85}>
                        <Text style={s.bannerBtnTxt}>Book Now</Text>
                        <Ionicons name="arrow-forward" size={13} color="#fff" />
                      </TouchableOpacity>
                    )}
                  </View>
                </TouchableOpacity>
              )}
            />
            {activeBanners.length > 1 && (
              <View style={s.dotRow}>
                {activeBanners.map((_, i) => <View key={i} style={[s.dot, activeDot === i && s.dotActive]} />)}
              </View>
            )}
          </View>
        )}

        {/* ── All sections — fully controlled by admin ── */}
        {sections.map(section => (
          <FeaturedSectionRow
            key={section.id}
            section={section}
            allTurfs={turfs}
            sortedTurfs={sortedTurfs}
            allHighlights={highlights}
            userCoords={userCoords}
            onTurf={goToTurf}
            onExplore={() => router.push("/(tabs)/explore")}
            onHighlight={onHighlightTap}
          />
        ))}

      {/** gym code */}
      {sortedGyms.length > 0 && (
  <View style={s.section}>
    <View style={s.sectionRow}>
      <View style={s.sectionTitleWrap}>
        <Text style={s.sectionEmoji}>🏋️</Text>
        <View>
          <Text style={s.sectionTitle}>Gyms near you</Text>
          <Text style={s.sectionSubtitle}>Monthly · Quarterly · Yearly plans</Text>
        </View>
      </View>
      <TouchableOpacity style={s.seeAllBtn} onPress={() => router.push("/(tabs)/explore")} activeOpacity={0.7}>
        <Text style={s.seeAllTxt}>See all</Text>
        <Ionicons name="arrow-forward" size={13} color={BRAND} />
      </TouchableOpacity>
    </View>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingRight: 4 }}>
      {sortedGyms.map((item: any) => (
        <GymCard key={item.id} item={item} userCoords={userCoords} onPress={() => goToGym(item.id)} />
      ))}
    </ScrollView>
  </View>
)}
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Screen Styles ──────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root:   { flex: 1, backgroundColor: "#F5F5F5" },
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#F5F5F5" },
  loadTxt:{ marginTop: 12, fontSize: 14, color: "#6B7280" },
  scroll: { paddingBottom: 110 },

  fixedHeader: {
    backgroundColor: "#F5F5F5",
    paddingTop: Platform.OS === "android" ? (StatusBar.currentHeight ?? 0) + 6 : 6,
    paddingBottom: 8,
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05, shadowRadius: 5, elevation: 5, zIndex: 10,
  },
  header:          { flexDirection: "row", alignItems: "center", paddingHorizontal: 16 },
  headerTextBlock: { flex: 1, paddingRight: 8 },
  appTitle:        { fontSize: 23, lineHeight: 36, fontWeight: "900", color: BRAND, letterSpacing: -0.5 },
  locationRow:     { flexDirection: "row", alignItems: "center", gap: 3, marginTop: 2 },
  locationTxt:     { fontSize: 12.5, color: "#6B7280", fontWeight: "500", flexShrink: 1 },
  headerIcons:     { flexDirection: "row", alignItems: "center", gap: 8 },
  iconCircle:      { width: 40, height: 40, borderRadius: 20, backgroundColor: "#fff", borderWidth: 1, borderColor: "#E5E7EB", alignItems: "center", justifyContent: "center" },
  badge:           { position: "absolute", top: -3, right: -2, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: "#EF4444", alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "#F5F5F5" },
  badgeTxt:        { fontSize: 10, fontWeight: "900", color: "#fff" },
  avatarWrap:      { width: 42, height: 42, borderRadius: 21, overflow: "hidden", borderWidth: 2, borderColor: WHITE },
  avatarImg:       { width: "100%", height: "100%" },
  avatarFallback:  { width: "100%", height: "100%", backgroundColor: "#000", alignItems: "center", justifyContent: "center" },
  avatarTxt:       { color: "#fff", fontWeight: "800", fontSize: 15 },

  bannerSection: { marginTop: 5 },
  bannerCard:    { width: SCREEN_W - 12, alignSelf: "center", borderRadius: 22, overflow: "hidden", backgroundColor: "#0F172A" },
  bannerImg:     { width: "100%", height: 190, backgroundColor: "#1E293B" },
  bannerOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(5,12,24,0.15)" },
  bannerContent: { position: "absolute", left: 16, right: 16, bottom: 16 },
  bannerBadge:   { alignSelf: "flex-start", backgroundColor: GREEN, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6, marginBottom: 6 },
  bannerBadgeTxt:{ fontSize: 10, fontWeight: "800", color: "#fff", letterSpacing: 0.8, textTransform: "uppercase" },
  bannerTitle:   { fontSize: 20, fontWeight: "900", color: "#fff", letterSpacing: -0.3, lineHeight: 26 },
  bannerSub:     { fontSize: 10, color: "rgba(255,255,255,0.75)", marginTop: 3 },
  bannerDateRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 5 },
  bannerDateTxt: { fontSize: 12, color: "rgba(255,255,255,0.8)", fontWeight: "500" },
  bannerBtn:     { position: "absolute", right: 5, flexDirection: "row", alignItems: "center", gap: 5, alignSelf: "flex-start", backgroundColor: GREEN, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, marginTop: 10 },
  bannerBtnTxt:  { fontSize: 12, fontWeight: "800", color: "#fff" },
  dotRow:        { position: "absolute", bottom: 14, left: 0, right: 0, flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 6, zIndex: 20 },
  dot:           { width: 7, height: 6, borderRadius: 99, backgroundColor: "rgba(255,255,255,0.35)" },
  dotActive:     { width: 8, height: 6, borderRadius: 99, backgroundColor: "#fff" },

  section:          { marginTop: 20, paddingHorizontal: 16 },
  sectionRow:       { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 },
  sectionTitleWrap: { flexDirection: "row", alignItems: "flex-start", gap: 8, flex: 1 },
  sectionEmoji:     { fontSize: 18, marginTop: 1 },
  sectionTitle:     { fontSize: 17, fontWeight: "800", color: BRAND, letterSpacing: -0.2 },
  sectionSubtitle:  { fontSize: 12, color: "#9CA3AF", marginTop: 2, fontWeight: "500" },
  seeAllBtn:        { flexDirection: "row", alignItems: "center", gap: 3, paddingTop: 2 },
  seeAllTxt:        { fontSize: 13, fontWeight: "600", color: "#6B7280" },
  turfCount:        { fontSize: 12, fontWeight: "600", color: "#9CA3AF", paddingTop: 2 },

  pickCard:     { width: 130, borderRadius: 16, padding: 14, minHeight: 130, borderWidth: 1, borderColor: "rgba(0,0,0,0.04)", shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4, elevation: 1 },
  pickTitle:    { fontSize: 13, fontWeight: "800", color: BRAND, lineHeight: 18 },
  pickSub:      { fontSize: 11, color: "#6B7280", marginTop: 3, fontWeight: "500" },
  pickIconWrap: { width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center", marginTop: 14 },
  pickIcon:     { fontSize: 22 },

  empty:      { backgroundColor: "#fff", borderRadius: 16, padding: 32, alignItems: "center", borderWidth: 1, borderColor: "#E5E7EB" },
  emptyTitle: { fontSize: 16, fontWeight: "800", color: BRAND, marginTop: 10 },
  emptySub:   { fontSize: 13, color: "#9CA3AF", marginTop: 6, textAlign: "center" },
});
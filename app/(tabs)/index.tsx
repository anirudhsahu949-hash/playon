import {
  View, Text, TouchableOpacity, Image, StyleSheet,
  ScrollView, RefreshControl, StatusBar,        // ← remove SafeAreaView here
  ActivityIndicator, Dimensions, Linking, Alert, Platform,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
// ← add this line
import { useEffect, useMemo, useState } from "react";
import { collection, getDocs, doc, getDoc, orderBy, query,where } from "firebase/firestore";
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
// OTHER PLAYON PRODUCTS — shown in the "Explore more" section at the bottom
// of the home screen. Purely client-side (not admin/Firestore controlled) —
// add a new entry here any time a new standalone tool ships.
// ─────────────────────────────────────────────────────────────────────────────
type OtherProduct = { id: string; title: string; subtitle: string; icon: string; color: string; route: string; image?: any };
const OTHER_PRODUCTS: OtherProduct[] = [
  {
    id: "toss",
    title: "Playon Toss",
    subtitle: "Flip a fair coin before your match starts",
    icon: "🪙",
    color: "#F59E0B",
    route: "/(tabs)/toss",
    // custom badge — the cricket-pitch coin logo. Drop the file at this path.
    image: require("../../assets/images/toss-badge.png"),
  },
  {
    id: "scorer",
    title: "PlayOn Scorer",
    subtitle: "Score gully cricket matches, fully offline",
    icon: "🏏",
    color: "#16A34A",
    route: "/GullyScorer",
    image:require("../../assets/images/scroer.png"),
  },

   {
    id: "refer-venue",
    title: "Refer Your Venue",
    subtitle: "Refer Turfs & venue and get 500 rupess coin" ,
    icon: "🎁",
    color: "#16A34A",
    route: "/refer-venue",
    
  },
  {
    id: "refer-and-earn",
    title: "Refer & Earn",
    subtitle: "Invite friends and earn PCoins on their first booking",
    icon: "🎁",
    color: "#7C3AED",
    route: "/refer-earn-user",
  },

 
];

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


function isFresh(entry: CacheEntry<any>): boolean {
  if (!entry) return false;
  return Date.now() - entry.fetchedAt < CACHE_TTL;
}

// ── Offer badges (from the server's /turf-offers) ───────────────────────────
// Same shape Explore uses. Cached 5 min; pull-to-refresh bypasses.
type OfferBadge = {
  offerId: string; title: string; tag?: string;
  type: "flat" | "percent"; value: number; maxDiscount?: number;
  badge: string;      // "20% OFF" | "₹150 OFF"
  qualifier: string;  // "6 AM–10 AM · min ₹500" or ""
  offerCount: number;
};
const SERVER_URL = "https://bookora-backend-95u4.onrender.com";
const OFFERS_TTL = 5 * 60 * 1000;
let _offersCache: { data: Record<string, OfferBadge>; fetchedAt: number } | null = null;
const isPhoneOnly = (t: any) => t?.bookingMode === "phone" && !!t?.bookingPhone;
const offerSaving = (o: OfferBadge) =>
  o.type === "flat" ? `Save ₹${o.value}` : Number(o.maxDiscount) > 0 ? `Save up to ₹${o.maxDiscount}` : `${o.value}% off`;

// ─────────────────────────────────────────────────────────────────────────────
// Types
type FeaturedSection = {
  id: string;
  title: string;
  subtitle?: string;
  icon: string;
  venueType?: "turf" | "gym" | "ball_machine";      // ✅ NEW — which venue type to show (default "turf")
  type: "manual" | "sport" | "location" | "nearby" | "all" | "highlights" | "offers";
  turfIds: string[];
  gymIds?: string[];                 // ✅ NEW — for manual gym sections
  ballMachineIds?: string[];         // ✅ NEW — for manual Ball Machine sections
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
  item, userCoords, onPress, label, offer,
}: {
  item: any;
  userCoords: { lat: number; lng: number } | null;
  onPress: () => void;
  label?: string;
  offer?: OfferBadge;
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
        {!!offer && (
          <View style={pc.offerBadge}>
            <Ionicons name="pricetag" size={11} color="#fff" />
            <Text style={pc.offerBadgeTxt}>{offer.badge}</Text>
          </View>
        )}
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
  machineMeta: { fontSize: 12, color: "#6B7280", fontWeight: "600" },
  offerBadge:    { position: "absolute", top: 10, right: 10, flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#16A34A", paddingHorizontal: 9, paddingVertical: 5, borderRadius: 99 },
  offerBadgeTxt: { fontSize: 11.5, fontWeight: "800", color: "#fff" },
});

// ─────────────────────────────────────────────────────────────────────────────
// BallMachineCard — for venueType "ball_machine". Same visual language as
// PopCard, but shows "From ₹X" (cheapest package) instead of a ₹/hr rate,
// since these venues have no hourly slot price at all.
// ─────────────────────────────────────────────────────────────────────────────
function BallMachineCard({
  item, userCoords, onPress,
}: {
  item: any;
  userCoords: { lat: number; lng: number } | null;
  onPress: () => void;
}) {
  const sport = getSport(item);
  const rating = getRating(item);
  const packages = Array.isArray(item.ballMachinePackages) ? item.ballMachinePackages : [];
  const cheapest = packages.length > 0
    ? Math.min(...packages.map((p: any) => Number(p.price) || Infinity))
    : null;
  const machineCount = Number(item.ballMachineCount || 1);

  return (
    <TouchableOpacity style={pc.card} onPress={onPress} activeOpacity={0.9}>
      <View style={pc.imgWrap}>
        <Image source={{ uri: getTurfImage(item) }} style={pc.img} resizeMode="cover" />
        <View style={pc.topLeft}>
          <Text style={pc.topLeftTxt}>🎯 Ball Machine</Text>
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
          <Text style={pc.price}>
            {cheapest != null && isFinite(cheapest) ? `From ₹${cheapest}` : "View packages"}
          </Text>
        </View>
        <Text style={[pc.machineMeta, { marginTop: 6 }]}>
          {machineCount} machine{machineCount === 1 ? "" : "s"} available
        </Text>
      </View>
    </TouchableOpacity>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// FullCard
// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// FullCard
// ─────────────────────────────────────────────────────────────────────────────
function FullCard({
  item, userCoords, onPress, offer,
}: {
  item: any;
  userCoords: { lat: number; lng: number } | null;
  onPress: () => void;
  offer?: OfferBadge;
}) {
  const dist  = userCoords && item.latitude != null
    ? haversine(userCoords.lat, userCoords.lng, item.latitude, item.longitude)
    : null;
  const sport = getSport(item);

  return (
    <TouchableOpacity style={fc.card} onPress={onPress} activeOpacity={0.92}>
      <View style={fc.imgWrap}>
        <Image source={{ uri: getTurfImage(item) }} style={fc.img} resizeMode="cover" />
        <View style={fc.gradient} />

        {dist != null && (
          <View style={fc.distBadge}>
            <Ionicons name="location" size={11} color="#fff" />
            <Text style={fc.distTxt}>{fmtDist(dist)}</Text>
          </View>
        )}

        <View style={fc.topOverlay}>
          <Text numberOfLines={1} style={fc.name}>{item.name}</Text>
        </View>

        {!!offer && (
          <View style={pc.offerBadge}>
            <Ionicons name="pricetag" size={11} color="#fff" />
            <Text style={pc.offerBadgeTxt}>{offer.badge}</Text>
          </View>
        )}

        <View style={fc.bottomOverlay}>
          <View style={fc.locationBadge}>
            <Ionicons name="location-outline" size={13} color="#fff" />
            <Text numberOfLines={1} style={fc.locTxt}>{item.location || "—"}</Text>
          </View>
        </View>
      </View>

      {/* ── Bottom bar: Night | Day | divider | sports | Book Now ── */}
      <View style={fc.bottom}>
        {/* Night price */}
        <View style={fc.priceCol}>
          <Text style={fc.bottomLabel}>Night</Text>
          <Text style={fc.bottomPrice}>₹{getNightPrice(item)}/hr</Text>
        </View>

        {/* Day price */}
        <View style={fc.priceCol}>
          <Text style={fc.bottomLabel}>Day</Text>
          <Text style={fc.dayPriceValue}>₹{getDayPrice(item)}/hr</Text>
        </View>

        {/* Divider */}
        <View style={fc.dividerV} />

        {/* Sport icon + name */}
        <View style={fc.sportsBottom}>
          {sport.slice(0, 2).map((sp, i) => {
            const cfg = SPORT_STYLE[sp] ?? SPORT_FALLBACK;
            return (
              <View key={i} style={fc.sportItem}>
                <View style={[fc.sportCircle, { borderColor: cfg.color }]}>
                  <Ionicons name={cfg.icon} size={12} color={cfg.color} />
                </View>
                <Text numberOfLines={1} style={fc.sportName}>{sp}</Text>
              </View>
            );
          })}
        </View>

        {/* Book Now */}
        <TouchableOpacity style={fc.bookBtn} onPress={onPress} activeOpacity={0.85}>
          <Text style={fc.bookBtnTxt}>Book Now</Text>
          <Ionicons name="arrow-forward" size={12} color="#fff" />
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
}

const fc = StyleSheet.create({
  card:    { backgroundColor: "#fff", borderRadius: 18, marginBottom: 14, overflow: "hidden", shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.07, shadowRadius: 6, elevation: 3 },
  imgWrap: { width: "100%", height: 180, position: "relative" },
  img:     { width: "100%", height: "100%", backgroundColor: "#fff" },
  gradient:{ position: "absolute", bottom: 0, left: 0, right: 0, top: 0, backgroundColor: "rgba(0,0,0,0.03)" },

  distBadge: { position: "absolute", bottom: 10, right: 12, flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: "rgba(11,18,32,0.75)", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 99 },
  distTxt:   { fontSize: 11, fontWeight: "700", color: "#fff" },

  topOverlay:    { position: "absolute", top: 12, left: 14, right: 90 },
  bottomOverlay: { position: "absolute", bottom: 8, left: 8, right: 100 },
  name:    { fontSize: 19, fontWeight: "900", color: "#fff", letterSpacing: -0.3 },
  locTxt:  { fontSize: 12, color: "#fff", fontWeight: "700", maxWidth: 180 },
  locationBadge: {
    flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start",
    backgroundColor: "rgba(0,0,0,0.55)", paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 999, borderWidth: 1, borderColor: "rgba(255,255,255,0.12)",
  },

  // ── bottom bar ──
  bottom:        { flexDirection: "row", alignItems: "center", backgroundColor: "#fff", paddingHorizontal: 12, paddingVertical: 12 },
  priceCol:      { marginRight:6 },
  bottomLabel:   { fontSize: 10, color: "#9CA3AF", fontWeight: "500", textTransform: "uppercase", letterSpacing: 0.4 },
  bottomPrice:   { fontSize: 15, fontWeight: "900", color: BRAND, marginTop: 1 },
  dayPriceValue: { fontSize: 13, fontWeight: "600", color: "#6B7280", marginTop: 1 },
  dividerV:      { width: 1, height: 30, backgroundColor: "#E5E7EB", marginRight: 5 },
  sportsBottom:  { flex: 1, flexDirection: "row", alignItems: "center", gap: 5, marginRight: 8 },
  sportItem:     { alignItems: "center", maxWidth: 46 },
  sportCircle:   { width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, alignItems: "center", justifyContent: "center", backgroundColor: "#fff" },
  sportName:     { fontSize: 9.5, color: "#374151", fontWeight: "600", marginTop: 3 },
  bookBtn:       { flexShrink: 0, flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#178c42", paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10 },
  bookBtnTxt:    { fontSize: 12, fontWeight: "800", color: "#fff" },
});

// ─────────────────────────────────────────────────────────────────────────────
// FeaturedSectionRow — unchanged, renders one admin-controlled section
// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// FeaturedSectionRow — handles both turf AND gym sections
// ─────────────────────────────────────────────────────────────────────────────
function FeaturedSectionRow({
  section, 
  allTurfs, sortedTurfs,
  allGyms, sortedGyms,
  allBallMachines, sortedBallMachines,
  allHighlights, 
  userCoords, 
  onTurf, 
  onGym,
  onBallMachine,
  onExplore, 
  onHighlight,
  offersByTurf = {},
}: {
  offersByTurf?: Record<string, OfferBadge>;
  section: FeaturedSection;
  allTurfs: any[];
  sortedTurfs: any[];
  allGyms: any[];
  sortedGyms: any[];
  allBallMachines: any[];
  sortedBallMachines: any[];
  allHighlights: HighlightCard[];
  userCoords: { lat: number; lng: number } | null;
  onTurf: (id: string) => void;
  onGym: (id: string) => void;
  onBallMachine: (id: string) => void;
  onExplore: () => void;
  onHighlight: (card: HighlightCard) => void;
}) {
  // ✅ Determine which venue type this section shows
  const isGymSection = section.venueType === "gym";
  const isBallMachineSection = section.venueType === "ball_machine";

  // ✅ Pick the right data sources based on venueType
  const allVenues    = isGymSection ? allGyms    : isBallMachineSection ? allBallMachines    : allTurfs;
  const sortedVenues = isGymSection ? sortedGyms : isBallMachineSection ? sortedBallMachines : sortedTurfs;
  const manualIds    = isGymSection ? (section.gymIds || []) : isBallMachineSection ? (section.ballMachineIds || []) : section.turfIds;
  const onTap        = isGymSection ? onGym : isBallMachineSection ? onBallMachine : onTurf;

  const venuesToShow = useMemo(() => {
    const max = section.maxItems ?? 6;
    if (section.type === "nearby")     return sortedVenues.slice(0, max);
    if (section.type === "all")        return sortedVenues.slice(0, max);
    if (section.type === "highlights") return [];
    if (section.type === "manual") {
      return manualIds
        .map(id => allVenues.find(v => v.id === id))
        .filter(Boolean);
    }
    if (section.type === "sport") {
      const sp = section.filter?.sport?.toLowerCase();
      return allVenues.filter(t => {
        const sports = Array.isArray(t.sport) ? t.sport : [t.sport];
        return sports.some((s: string) => s?.toLowerCase() === sp);
      });
    }
    if (section.type === "location") {
      const loc = section.filter?.location?.toLowerCase() || "";
      return allVenues.filter(t => (t.location || "").toLowerCase().includes(loc));
    }
    return [];
  }, [section, allVenues, sortedVenues, manualIds]);

  // ── Highlights section (unchanged) ────────────────────────────────────
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

  if (venuesToShow.length === 0) return null;

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

      {/* ✅ Render the right card based on venueType */}
      {isGymSection ? (
        // ── Gym sections always use horizontal scroll with GymCard ──
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 12, paddingRight: 4 }}
        >
          {venuesToShow.map((item: any) => (
            <GymCard
              key={item.id}
              item={item}
              userCoords={userCoords}
              onPress={() => onTap(item.id)}
            />
          ))}
        </ScrollView>
      ) : isBallMachineSection ? (
        // ── Ball Machine sections always use horizontal scroll with BallMachineCard ──
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 12, paddingRight: 4 }}
        >
          {venuesToShow.map((item: any) => (
            <BallMachineCard
              key={item.id}
              item={item}
              userCoords={userCoords}
              onPress={() => onTap(item.id)}
            />
          ))}
        </ScrollView>
      ) : section.style === "horizontal" ? (
        // ── Turf horizontal: PopCard ──
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 12, paddingRight: 4 }}
        >
          {venuesToShow.map((item: any) => (
            <PopCard
              key={item.id}
              item={item}
              userCoords={userCoords}
              onPress={() => onTap(item.id)}
              offer={isPhoneOnly(item) ? undefined : offersByTurf[item.id]}
            />
          ))}
        </ScrollView>
      ) : (
        // ── Turf grid: FullCard ──
        <View>
          {venuesToShow.map((item: any) => (
            <FullCard key={item.id} item={item} userCoords={userCoords} onPress={() => onTap(item.id)} offer={isPhoneOnly(item) ? undefined : offersByTurf[item.id]} />
          ))}
        </View>
      )}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// OfferTodayCard — "Offers today" row on the home screen
// ─────────────────────────────────────────────────────────────────────────────
function OfferTodayCard({ item, offer, userCoords, onPress }: {
  item: any; offer: OfferBadge; userCoords: { lat: number; lng: number } | null; onPress: () => void;
}) {
  const dist = userCoords && item.latitude != null
    ? haversine(userCoords.lat, userCoords.lng, item.latitude, item.longitude) : null;
  return (
    <TouchableOpacity style={oc.card} onPress={onPress} activeOpacity={0.9}
      accessibilityLabel={`${item.name}, ${offer.badge} today`}>
      <View style={oc.imgWrap}>
        <Image source={{ uri: getTurfImage(item) }} style={oc.img} resizeMode="cover" />
        <View style={oc.badge}>
          <Ionicons name="pricetag" size={12} color="#fff" />
          <Text style={oc.badgeTxt}>{offer.badge} today</Text>
        </View>
        <View style={oc.tag}>
          <Text style={oc.tagTxt} numberOfLines={1}>🎉 {offer.tag || offer.title}</Text>
        </View>
      </View>
      <View style={oc.body}>
        <Text style={oc.name} numberOfLines={1}>{item.name}</Text>
        <Text style={oc.loc} numberOfLines={1}>
          {item.location || "—"}{dist != null ? ` · ${fmtDist(dist)}` : ""}
        </Text>
        <View style={oc.saveRow}>
          <Text style={oc.save}>{offerSaving(offer)}</Text>
          <Text style={oc.qual} numberOfLines={1}>· {offer.qualifier || "all day"}</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

const oc = StyleSheet.create({
  card:    { width: 270, backgroundColor: "#fff", borderRadius: 18, overflow: "hidden", borderWidth: 1, borderColor: "#E5E7EB", shadowColor: "#000", shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.08, shadowRadius: 8, elevation: 3 },
  imgWrap: { width: "100%", height: 140 },
  img:     { width: "100%", height: "100%", backgroundColor: "#E5E7EB" },
  badge:   { position: "absolute", top: 10, left: 10, flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "#16A34A", paddingHorizontal: 10, paddingVertical: 5, borderRadius: 99 },
  badgeTxt:{ fontSize: 12, fontWeight: "800", color: "#fff" },
  tag:     { position: "absolute", bottom: 10, left: 10, maxWidth: 240, backgroundColor: "rgba(11,18,32,0.78)", paddingHorizontal: 9, paddingVertical: 4, borderRadius: 99 },
  tagTxt:  { fontSize: 11, fontWeight: "700", color: "#fff" },
  body:    { padding: 12 },
  name:    { fontSize: 15, fontWeight: "800", color: BRAND },
  loc:     { fontSize: 12, color: "#9CA3AF", marginTop: 3 },
  saveRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 8 },
  save:    { fontSize: 13, fontWeight: "800", color: "#15803D" },
  qual:    { flex: 1, fontSize: 11, fontWeight: "700", color: "#6B7280" },
});

// ─────────────────────────────────────────────────────────────────────────────
// OtherProductsSection — static "Explore more from PlayOn" row, bottom of home
// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// OtherProductsSection — static "Explore more from PlayOn" grid, bottom of home
// 2 cards per row, wraps to the next line
// ─────────────────────────────────────────────────────────────────────────────
function OtherProductsSection({ router }: { router: ReturnType<typeof useRouter> }) {
  return (
    <View style={[s.section, { marginTop: 26 }]}>
      <View style={s.sectionTitleWrap}>
        <Text style={s.sectionEmoji}>🚀</Text>
        <View>
          <Text style={s.sectionTitle}>Explore More from PlayOn</Text>
          <Text style={s.sectionSubtitle}>Other tools built for players like you</Text>
        </View>
      </View>

      <View style={pd.grid}>
        {OTHER_PRODUCTS.map((p) => (
          <TouchableOpacity
            key={p.id}
            style={pd.card}
            activeOpacity={0.9}
            onPress={() => router.push(p.route as any)}
          >
            {p.image ? (
              <Image source={p.image} style={pd.iconImage} resizeMode="contain" />
            ) : (
              <View style={[pd.iconBadge, { backgroundColor: p.color + "20" }]}>
                <Text style={{ fontSize: 24 }}>{p.icon}</Text>
              </View>
            )}
            <Text style={pd.title} numberOfLines={1}>{p.title}</Text>
            <Text style={pd.subtitle} numberOfLines={2}>{p.subtitle}</Text>
            <View style={pd.openRow}>
              <Text style={[pd.openTxt, { color: p.color }]}>Open</Text>
              <Ionicons name="arrow-forward" size={12} color={p.color} />
            </View>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

// Section has paddingHorizontal: 16 (32 total) and a 12px gutter between columns
const PRODUCT_CARD_W = (SCREEN_W - 32 - 12) / 2;

const pd = StyleSheet.create({
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    marginTop: 12,
  },
  card: {
    width: PRODUCT_CARD_W,
    backgroundColor: "#fff",
    borderRadius: 18,
    padding: 12,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },
  iconBadge: { width: 46, height: 46, borderRadius: 14, alignItems: "center", justifyContent: "center", marginBottom: 10 },
  iconImage: { width: 46, height: 46, marginBottom: 10 },
  title:     { fontSize: 14.5, fontWeight: "800", color: BRAND },
  subtitle:  { fontSize: 11.5, color: "#9CA3AF", marginTop: 4, lineHeight: 15, minHeight: 30 },
  openRow:   { flexDirection: "row", alignItems: "center", gap: 4, marginTop: "auto", paddingTop: 10 },
  openTxt:   { fontSize: 12, fontWeight: "800" },
});

// ─────────────────────────────────────────────────────────────────────────────
// Main Home Screen
// ─────────────────────────────────────────────────────────────────────────────
export default function Home() {
    const insets = useSafeAreaInsets();  
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
  const [walletBalance, setWalletBalance] = useState<number>(0);
  const [offersByTurf, setOffersByTurf] = useState<Record<string, OfferBadge>>(_offersCache?.data ?? {});
  const router = useRouter();

  

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
]);
      fetchOffers(forceRefresh);   // not awaited — badges are a decoration
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

  // ─── fetchOffers — never blocks the home screen, never shows an error ─────
  const fetchOffers = async (forceRefresh = false) => {
    if (!forceRefresh && _offersCache && Date.now() - _offersCache.fetchedAt < OFFERS_TTL) {
      setOffersByTurf(_offersCache.data);
      return;
    }
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);   // server cold start
      const res = await fetch(`${SERVER_URL}/turf-offers`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}), signal: controller.signal,
      });
      clearTimeout(timer);
      const data = await res.json();
      const map = (data?.offers ?? {}) as Record<string, OfferBadge>;
      _offersCache = { data: map, fetchedAt: Date.now() };
      setOffersByTurf(map);
    } catch { /* silent on purpose */ }
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

        // Wallet balance
        try {
          const pcSnap = await getDoc(doc(db, "pcoinWallets", uid));
          const pc = pcSnap.exists() ? Number(pcSnap.data().balance || 0) : 0;
          const vcSnap = await getDocs(
            query(collection(db, "vcoinWallets"), where("uid", "==", uid))
          );
          const vc = vcSnap.docs.reduce((s: number, d: any) => s + Number(d.data().balance || 0), 0);
          setWalletBalance(pc + vc);
        } catch {}
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
    router.push(`/turf/${id}`);
};

  const onHighlightTap = (card: HighlightCard) => {
    if (card.action === "explore") router.push("/(tabs)/explore");
    else if (card.action === "sport") router.push({ pathname: "/(tabs)/explore", params: { sport: card.actionValue } });
    else if (card.action === "turf" && card.actionValue) goToTurf(card.actionValue);
    else if (card.action === "link" && card.actionValue) openBannerLink(card.actionValue);
    else if (card.action === "profile") router.push("/(tabs)/profile");
    else if (card.action === "toss") router.push("/(tabs)/toss");
  };

  const activeBanners = useMemo(() => banners.filter(b => b.active !== false), [banners]);

// ─── Split turfs from gyms and Ball Machine venues based on venueType ────
  // ALL venues live in `turfs` collection now; we filter by venueType here.
  // - actualTurfs        = anything that's NOT a gym or Ball Machine venue
  // - actualGyms         = only docs with venueType === "gym"
  // - actualBallMachines = only docs with venueType === "ball_machine"
  //   (previously these fell into actualTurfs and got the turf card + the
  //   /turf/[id] slot-booking route — but they have no slots/hourly price
  //   at all, so that showed ₹0/hr and opened the wrong booking flow.)
  const actualTurfs = useMemo(
    () => turfs.filter((t: any) => t.venueType !== "gym" && t.venueType !== "ball_machine"),
    [turfs]
  );

  const actualGyms = useMemo(
    () => turfs.filter((t: any) => t.venueType === "gym"),
    [turfs]
  );

  const actualBallMachines = useMemo(
    () => turfs.filter((t: any) => t.venueType === "ball_machine"),
    [turfs]
  );

  // ─── Sort turfs (excluding gyms) by distance ──────────────────────────
  const sortedTurfs = useMemo(() => {
    if (!userCoords) return actualTurfs;
    return [...actualTurfs].sort((a, b) => {
      const hasA = a.latitude != null && a.longitude != null;
      const hasB = b.latitude != null && b.longitude != null;
      if (!hasA && !hasB) return 0;
      if (!hasA) return 1;
      if (!hasB) return -1;
      return haversine(userCoords.lat, userCoords.lng, a.latitude, a.longitude) -
             haversine(userCoords.lat, userCoords.lng, b.latitude, b.longitude);
    });
  }, [actualTurfs, userCoords]);

  // ─── Sort gyms by distance ─────────────────────────────────────────────
  const sortedGyms = useMemo(() => {
    if (!userCoords) return actualGyms;
    return [...actualGyms].sort((a, b) => {
      const hasA = a.latitude != null && a.longitude != null;
      const hasB = b.latitude != null && b.longitude != null;
      if (!hasA && !hasB) return 0;
      if (!hasA) return 1;
      if (!hasB) return -1;
      return haversine(userCoords.lat, userCoords.lng, a.latitude, a.longitude) -
             haversine(userCoords.lat, userCoords.lng, b.latitude, b.longitude);
    });
  }, [actualGyms, userCoords]);

  // ─── Sort Ball Machine venues by distance ──────────────────────────────
  const sortedBallMachines = useMemo(() => {
    if (!userCoords) return actualBallMachines;
    return [...actualBallMachines].sort((a, b) => {
      const hasA = a.latitude != null && a.longitude != null;
      const hasB = b.latitude != null && b.longitude != null;
      if (!hasA && !hasB) return 0;
      if (!hasA) return 1;
      if (!hasB) return -1;
      return haversine(userCoords.lat, userCoords.lng, a.latitude, a.longitude) -
             haversine(userCoords.lat, userCoords.lng, b.latitude, b.longitude);
    });
  }, [actualBallMachines, userCoords]);

  // ─── Turfs with an offer running today (online-bookable only) ─────────
  const offerTurfs = useMemo(
    () => sortedTurfs.filter((t: any) => !!offersByTurf[t.id] && !isPhoneOnly(t)),
    [sortedTurfs, offersByTurf]
  );



const goToGym = (id: string) => {
  if (!auth.currentUser) {
    Alert.alert("Login required", "Please log in to view memberships.", [
      { text: "Cancel", style: "cancel" },
      { text: "Log In", onPress: () => router.push("/(auth)/login") },
    ]);
    return;
  }
  router.push(`/turf/gym-details/${id}`);
};

// ⚠️ Destination screen not built yet — this route will 404 until the Ball
// Machine booking screen (package picker → time grid → Razorpay) ships.
// Routing here now (instead of the turf slot-booking screen) at least stops
// Ball Machine venues from opening the wrong flow in the meantime.
const goToBallMachine = (id: string) => {
  router.push(`/turf/ball-machine-details/${id}`);
};

  if (loading) return (
    <SafeAreaView style={s.center}>
      <StatusBar barStyle="dark-content" backgroundColor="#F5F5F5" />
      <ActivityIndicator size="large" color={BRAND} />
      <Text style={s.loadTxt}>Loading Playon...</Text>
    </SafeAreaView>
  );

  return (
    <View style={s.root}>
      <StatusBar barStyle="dark-content" backgroundColor="#F5F5F5" />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={s.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={BRAND} />}
      >
        {/* ── Header ── */}
        <View style={s.fixedHeader}>
            <View style={[s.header, { paddingTop: insets.top + 12 }]}>
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
               <TouchableOpacity
                style={s.walletBtn}
                onPress={() => user ? router.push("/wallet" as any) : router.push("/(auth)/login")}
                activeOpacity={0.85}
              >
                <Text style={{ fontSize: 14 }}>🪙</Text>
                <Text style={s.walletBtnTxt}>
                  {walletBalance > 0 ? walletBalance : "0"}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* ── Banners ── */}
        {activeBanners.length > 0 && (
          <View style={s.bannerSection}>
            <Carousel
              width={SCREEN_W} height={190} autoPlay autoPlayInterval={2500}
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
                        <Text style={s.bannerBtnTxt}>View Now</Text>
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
     {sections.map(section => section.type === "offers" ? (
  // 🔥 "Offers today" row — admin turns it on/off and moves it in Home Control.
  // Hides itself automatically when no turf has an offer today.
  offerTurfs.length === 0 ? null : (
    <View key={section.id} style={s.section}>
      <View style={s.sectionRow}>
        <View style={s.sectionTitleWrap}>
          <Text style={s.sectionEmoji}>{section.icon || "🔥"}</Text>
          <View>
            <Text style={s.sectionTitle}>{section.title || "Offers today"}</Text>
            {section.subtitle ? <Text style={s.sectionSubtitle}>{section.subtitle}</Text> : null}
          </View>
        </View>
        <TouchableOpacity style={s.seeAllBtn} onPress={() => router.push({ pathname: "/(tabs)/explore", params: { sport: "Offers" } } as any)} activeOpacity={0.7}>
          <Text style={s.seeAllTxt}>See all</Text>
          <Ionicons name="arrow-forward" size={13} color={BRAND} />
        </TouchableOpacity>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingRight: 4 }}>
        {offerTurfs.slice(0, section.maxItems ?? 10).map((t: any) => (
          <OfferTodayCard key={t.id} item={t} offer={offersByTurf[t.id]} userCoords={userCoords} onPress={() => goToTurf(t.id)} />
        ))}
      </ScrollView>
    </View>
  )
) : (
  <FeaturedSectionRow
    key={section.id}
    section={section}
    allTurfs={actualTurfs}
    sortedTurfs={sortedTurfs}
    allGyms={actualGyms}            // ✅ NEW
    sortedGyms={sortedGyms}         // ✅ NEW
    allBallMachines={actualBallMachines}     // ✅ NEW
    sortedBallMachines={sortedBallMachines}  // ✅ NEW
    allHighlights={highlights}
    userCoords={userCoords}
    onTurf={goToTurf}
    onGym={goToGym}                 // ✅ NEW
    onBallMachine={goToBallMachine} // ✅ NEW
    onExplore={() => router.push("/(tabs)/explore")}
    onHighlight={onHighlightTap}
    offersByTurf={offersByTurf}
  />
))}

      {/** gym code */}

      {/* ── Ball Machine — not admin-section-driven yet, so shown here
           directly whenever any Ball Machine venues exist, the same way
           "Explore more" below is a static block rather than a Firestore
           section. Once there's a "ball_machine" featuredSections doc,
           this can be removed in favor of the admin-controlled one above. ── */}
      {actualBallMachines.length > 0 && (
        <View style={s.section}>
          <View style={s.sectionRow}>
            <View style={s.sectionTitleWrap}>
              <Text style={s.sectionEmoji}>🎯</Text>
              <View>
                <Text style={s.sectionTitle}>Ball Machine Practice</Text>
                <Text style={s.sectionSubtitle}>Pay per over — no slot booking needed</Text>
              </View>
            </View>
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 12, paddingRight: 4 }}
          >
            {sortedBallMachines.slice(0, 10).map((item: any) => (
              <BallMachineCard
                key={item.id}
                item={item}
                userCoords={userCoords}
                onPress={() => goToBallMachine(item.id)}
              />
            ))}
          </ScrollView>
        </View>
      )}

      {/* ── Explore more from PlayOn — Toss, Scorer, and future tools ── */}
      <OtherProductsSection router={router} />

      </ScrollView>
    </View>
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
  bannerOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(5,12,24,0.10)" },
  bannerContent: { position: "absolute", left: 16, right: 16, bottom: 16 },
  bannerBadge:   { alignSelf: "flex-start", backgroundColor: GREEN, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6, marginBottom: 6 },
  bannerBadgeTxt:{ fontSize: 10, fontWeight: "800", color: "#fff", letterSpacing: 0.8, textTransform: "uppercase" },
  bannerTitle:   { fontSize: 20, fontWeight: "900", color: "#fff", letterSpacing: -0.3, lineHeight: 26 },
  bannerSub:     { fontSize: 10, color: "rgba(255,255,255,0.75)", marginTop: 3 },
  bannerDateRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 5 },
  bannerDateTxt: { fontSize: 12, color: "rgba(255,255,255,0.8)", fontWeight: "500" },
  bannerBtn:     { position: "absolute", right: 5,bottom:2, flexDirection: "row", alignItems: "center", gap: 5, alignSelf: "flex-start", backgroundColor: GREEN, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10, marginTop: 10 },
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

  //wallet
  walletBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "#393b40",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 99,
    borderWidth: 1,
    borderColor: "#1E293B",
  },
  walletBtnTxt: {
    fontSize: 13,
    fontWeight: "800",
    color: "#fff",
  },
});
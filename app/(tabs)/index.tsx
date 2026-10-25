import {
  View, Text, TouchableOpacity, Image, StyleSheet,
  ScrollView, RefreshControl, StatusBar,        // ← remove SafeAreaView here
  ActivityIndicator, Dimensions, Linking, Alert, Platform,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
// ← add this line
import { useEffect, useMemo, useState, useCallback } from "react";
import { collection, getDocs, doc, getDoc, orderBy, query, where, setDoc, arrayUnion, arrayRemove, updateDoc, increment } from "firebase/firestore";
import { db, auth } from "../../firebaseConfig";
import { useRouter, useFocusEffect } from "expo-router";
import Carousel from "react-native-reanimated-carousel";
import { Ionicons } from "@expo/vector-icons";
import { onAuthStateChanged } from "firebase/auth";
import * as Location from "expo-location";
import * as WebBrowser from "expo-web-browser";
import { subscribeToNotifications } from "./../notification/usenotification";
import GymCard from "../../components/screen-gym/gym-card-horizontal";
import { DEFAULT_TURF_IMAGE, hasPrice } from "../../utils/turfDisplay";   // no photo / no price
import {
  City, fetchCities, getSavedCity, saveCityChoice, saveNotLiveCity, resolveCity,
  nearestCity, joinCityWaitlist, saveCoords, getSavedCoords,
} from "../../utils/cities";   // 🏙️ all-India (City Picker screen = app/city-picker.tsx, opened from Profile)

const { width: SCREEN_W } = Dimensions.get("window");

// Banner: fixed 2:1 ratio so designed images are never cropped.
// Upload banner images at 1200×600 (or any 2:1 size).
const BANNER_W = SCREEN_W - 24;
const BANNER_H = Math.round(BANNER_W / 2);
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
// MORE FROM PLAYON — compact 2×2 cards near the bottom of home.
// Purely client-side — add a new entry here when a new tool ships.
// "List Your Turf" is NOT here: it has its own owner strip at the very bottom.
// ─────────────────────────────────────────────────────────────────────────────
type OtherProduct = {
  id: string; title: string; subtitle: string;
  icon: keyof typeof Ionicons.glyphMap; color: string; bg: string;
  route: string; image?: any;
};
const OTHER_PRODUCTS: OtherProduct[] = [
  {
    id: "toss", title: "Toss", subtitle: "Flip a coin",
    icon: "disc-outline", color: "#B45309", bg: "#FEF3C7",
    route: "/(tabs)/toss",
    image: require("../../assets/images/toss-badge.png"),
  },
  {
    id: "scorer", title: "Scorer", subtitle: "Score your match",
    icon: "clipboard-outline", color: "#15803D", bg: "#DCFCE7",
    route: "/GullyScorer",
    image: require("../../assets/images/scroer.png"),
  },
  {
    id: "refer-and-earn", title: "Refer & Earn", subtitle: "Invite friends",
    icon: "gift-outline", color: "#6D28D9", bg: "#EDE9FE",
    route: "/refer-earn-user",
  },
  {
    id: "refer-venue", title: "Refer a Venue", subtitle: "Get 500 coins",
    icon: "business-outline", color: "#0369A1", bg: "#E0F2FE",
    route: "/refer-venue",
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
  (Array.isArray(item.images) && item.images.length > 0 ? item.images[0] : item.image) || DEFAULT_TURF_IMAGE;
const getNightPrice = (item: any): number => item.nightPrice || item.price || 0;
const getDayPrice   = (item: any): number => item.dayPrice   || item.price || 0;
const getRating = (item: any): string | null => {
  const r = parseFloat(item.rating);
  if (!isNaN(r) && r > 0) return r.toFixed(1);
  return null;
};
// Handles ["Cricket","Football"], "Cricket, Football" and "cricket" →
// clean Title Case, no duplicates. Same logic as Explore.
const getSport = (item: any): string[] => {
  const raw: string[] = Array.isArray(item?.sport)
    ? item.sport.flatMap((s: any) => String(s).split(","))
    : typeof item?.sport === "string" ? item.sport.split(",") : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of raw) {
    const t = r.trim();
    if (!t) continue;
    const name = t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
    if (seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
};

// ── Today's slots → "Next free: 6 PM" on featured cards ─────────────────────
// One read of today's bookings + blocked slots (same queries Explore uses),
// cached 5 min at module level so tab switches cost 0 reads.
const TODAY_STRING = new Date().toDateString();
const SLOTS_TTL = 5 * 60 * 1000;
let _slotsCache: { taken: Record<string, string[]>; fetchedAt: number } | null = null;

function pad2(n: number) { return String(n).padStart(2, "0"); }
function shortLabel(v: number): string {
  if (v >= 24) v -= 24;
  const h = Math.floor(v);
  const m = Math.round((v % 1) * 60);
  const suffix = h >= 12 ? "PM" : "AM";
  const hr = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${hr} ${suffix}` : `${hr}:${pad2(m)} ${suffix}`;
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
function parseSlotRange(s: string, open: number, late: boolean): { start: number; end: number } | null {
  try {
    const parts = s.split(" - ");
    if (parts.length < 2) return null;
    let start = parseTime(parts[0]);
    let end   = parseTime(parts[1]);
    if (late && start < open) start += 24;
    if (late && end   < open) end   += 24;
    if (end <= start) end = 24;
    return { start, end };
  } catch { return null; }
}
const turfOpen  = (t: any) => Number(t?.openingTime ?? 6);
const turfClose = (t: any) => (Number(t?.closingTime) === 0 ? 24 : Number(t?.closingTime ?? 24));

// undefined = slots not loaded yet · null = full today · string = "6 PM"
function nextFreeSlot(turf: any, taken: string[]): string | null {
  const open  = turfOpen(turf);
  const close = turfClose(turf);
  const late  = close > 24;
  const n     = new Date();
  let now     = n.getHours() + n.getMinutes() / 60;
  if (late && now < open && now + 24 < close) now += 24;       // 12:30 AM on a late turf
  const cutoff   = Number(turf?.lateCutoffHours || 0);
  const lateShut = late && cutoff > 0 && now >= 24 - cutoff;
  const ranges = taken
    .map(s => parseSlotRange(String(s).trim(), open, late))
    .filter(Boolean) as { start: number; end: number }[];

  for (let t = Math.max(open, Math.ceil(now * 2) / 2); t < close; t += 0.5) {
    if (t >= 24 && lateShut) break;
    const next = Math.min(t + 0.5, close);
    if (!ranges.some(r => t < r.end && r.start < next)) return shortLabel(t);
  }
  return null;
}

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
// TrendCard — compact featured card for horizontal turf sections
// ("Top in trends" and any admin section with style "horizontal").
// Photo: tag (top-left) · save star (top-right) · offer (bottom-left) · distance
// Body:  name + sport icons · area · price + next free slot · Book
// No rating shown until real reviews exist.
// ─────────────────────────────────────────────────────────────────────────────
function TrendCard({
  item, userCoords, onPress, label, offer, nextFree, isSaved, onToggleSave,
}: {
  item: any;
  userCoords: { lat: number; lng: number } | null;
  onPress: () => void;
  label?: string;
  offer?: OfferBadge;
  nextFree?: string | null;          // undefined = still loading
  isSaved?: boolean;
  onToggleSave?: () => void;
}) {
  const dist = userCoords && item.latitude != null
    ? haversine(userCoords.lat, userCoords.lng, item.latitude, item.longitude)
    : null;
  const sports    = getSport(item);
  const phoneOnly = isPhoneOnly(item);
  // Admin labels used to carry an emoji ("🔥 Popular") — the flame is an icon now.
  const tagText   = (label ?? "Popular").replace(/^[^A-Za-z0-9]+/, "").trim() || "Popular";

  return (
    <TouchableOpacity style={tc.card} onPress={onPress} activeOpacity={0.9}>
      <View style={tc.imgWrap}>
        <Image source={{ uri: getTurfImage(item) }} style={tc.img} resizeMode="cover" />

        <View style={tc.tag}>
          <Ionicons name="flame" size={11} color="#fff" />
          <Text style={tc.tagTxt} numberOfLines={1}>{tagText}</Text>
        </View>

        {!!onToggleSave && (
          <TouchableOpacity
            style={tc.saveBtn}
            onPress={onToggleSave}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityLabel={isSaved ? "Remove from saved" : "Save turf"}
          >
            <Ionicons name={isSaved ? "star" : "star-outline"} size={14} color={isSaved ? "#FACC15" : "#fff"} />
          </TouchableOpacity>
        )}

        <View style={tc.imgBottom}>
          {!!offer ? (
            <View style={tc.offer}><Text style={tc.offerTxt} numberOfLines={1}>{offer.badge}</Text></View>
          ) : <View />}
          {dist != null && (
            <View style={tc.dist}><Text style={tc.distTxt}>{fmtDist(dist)}</Text></View>
          )}
        </View>
      </View>

      <View style={tc.body}>
        {/* Name + sport icons on the right (saves a whole row) */}
        <View style={tc.nameRow}>
          <Text numberOfLines={1} style={tc.name}>{item.name}</Text>
          <View style={tc.sportIcons}>
            {sports.slice(0, 3).map(sp => {
              const cfg = SPORT_STYLE[sp] ?? SPORT_FALLBACK;
              return (
                <View key={sp} style={[tc.sportIcon, { backgroundColor: cfg.color + "1A" }]} accessibilityLabel={sp}>
                  <Ionicons name={cfg.icon} size={12} color={cfg.color} />
                </View>
              );
            })}
          </View>
        </View>

        <Text numberOfLines={1} style={tc.area}>{item.location || "—"}</Text>

        <View style={tc.footer}>
          <View style={{ flex: 1, minWidth: 0 }}>
            {hasPrice(getDayPrice(item))
              ? <Text style={tc.price}>₹{getDayPrice(item)}<Text style={tc.priceUnit}>/hr</Text></Text>
              : <Text style={[tc.price, { fontSize: 13 }]}>Price on call</Text>}
            {phoneOnly ? (
              <Text style={tc.hours} numberOfLines={1}>
                {item.hoursSet === false ? "Call to book" : `Open ${shortLabel(turfOpen(item))} – ${shortLabel(turfClose(item))}`}
              </Text>
            ) : nextFree === undefined ? null : nextFree === null ? (
              <Text style={[tc.free, { color: "#B91C1C" }]}>Full today</Text>
            ) : (
              <Text style={tc.free} numberOfLines={1}>Next free: {nextFree}</Text>
            )}
          </View>
          <TouchableOpacity style={tc.bookBtn} onPress={onPress} activeOpacity={0.85}>
            <Text style={tc.bookTxt}>Book</Text>
          </TouchableOpacity>
        </View>
      </View>
    </TouchableOpacity>
  );
}

const tc = StyleSheet.create({
  card:      { width: 258, backgroundColor: "#fff", borderRadius: 16, overflow: "hidden", shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.07, shadowRadius: 8, elevation: 3 },
  imgWrap:   { width: "100%", height: 128, position: "relative", backgroundColor: "#E5E7EB" },
  img:       { width: "100%", height: "100%" },
  tag:       { position: "absolute", top: 8, left: 8, maxWidth: 150, flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#EA580C", paddingHorizontal: 9, paddingVertical: 4, borderRadius: 12 },
  tagTxt:    { fontSize: 11, fontWeight: "800", color: "#fff", flexShrink: 1 },
  saveBtn:   { position: "absolute", top: 6, right: 6, width: 28, height: 28, borderRadius: 14, backgroundColor: "rgba(0,0,0,0.38)", alignItems: "center", justifyContent: "center" },
  imgBottom: { position: "absolute", left: 8, right: 8, bottom: 8, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 6 },
  offer:     { flexShrink: 1, backgroundColor: "#15803D", paddingHorizontal: 9, paddingVertical: 3, borderRadius: 8 },
  offerTxt:  { fontSize: 12, fontWeight: "900", color: "#fff" },
  dist:      { backgroundColor: BRAND, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12 },
  distTxt:   { fontSize: 10, fontWeight: "700", color: "#fff" },

  body:      { paddingHorizontal: 12, paddingTop: 10, paddingBottom: 12, gap: 4 },
  nameRow:   { flexDirection: "row", alignItems: "center", gap: 8 },
  name:      { flex: 1, minWidth: 0, fontSize: 16, fontWeight: "800", color: BRAND },
  sportIcons:{ flexDirection: "row", gap: 4, flexShrink: 0 },
  sportIcon: { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  area:      { fontSize: 12, color: "#4B5563" },
  footer:    { flexDirection: "row", alignItems: "center", gap: 8, borderTopWidth: 1, borderTopColor: "#F1F3F5", paddingTop: 8, marginTop: 4 },
  price:     { fontSize: 15, fontWeight: "900", color: BRAND },
  priceUnit: { fontSize: 11, fontWeight: "600", color: "#4B5563" },
  free:      { fontSize: 11, fontWeight: "700", color: "#15803D", marginTop: 1 },
  hours:     { fontSize: 11, fontWeight: "700", color: "#4B5563", marginTop: 1 },
  bookBtn:   { height: 32, justifyContent: "center", backgroundColor: "#15803D", paddingHorizontal: 14, borderRadius: 10 },
  bookTxt:   { fontSize: 12, fontWeight: "800", color: "#fff" },
});

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
          <Text style={fc.bottomPrice}>{hasPrice(getNightPrice(item)) ? `₹${getNightPrice(item)}/hr` : "On call"}</Text>
        </View>

        {/* Day price */}
        <View style={fc.priceCol}>
          <Text style={fc.bottomLabel}>Day</Text>
          <Text style={fc.dayPriceValue}>{hasPrice(getDayPrice(item)) ? `₹${getDayPrice(item)}/hr` : "On call"}</Text>
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

        {/* Book Now — same for every turf. Call-to-book is only revealed on the turf page. */}
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
  nextFreeByTurf = {},
  savedIds,
  onToggleSave,
}: {
  offersByTurf?: Record<string, OfferBadge>;
  nextFreeByTurf?: Record<string, string | null | undefined>;
  savedIds?: Set<string>;
  onToggleSave?: (id: string) => void;
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
      return allVenues.filter(t => getSport(t).some(s => s.toLowerCase() === sp));
    }
    if (section.type === "location") {
      const loc = section.filter?.location?.toLowerCase() || "";
      return allVenues.filter(t => (t.location || "").toLowerCase().includes(loc));
    }
    return [];
  }, [section, allVenues, sortedVenues, manualIds]);

  // ── Highlights ("Top Picks For You") — slim pills ──────────────────────
  // Works as a light divider between the horizontal and vertical turf
  // sections, so it stays small: icon + title + one short line.
  if (section.type === "highlights") {
    if (allHighlights.length === 0) return null;
    return (
      <View style={[s.section, { marginTop: 18 }]}>
        <Text style={s.pickHeading}>{section.title}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingRight: 4 }}>
          {allHighlights.map(card => (
            <TouchableOpacity
              key={card.id}
              style={[s.pickPill, { backgroundColor: card.color }]}
              activeOpacity={0.85}
              onPress={() => onHighlight(card)}
            >
              <View style={[s.pickPillIcon, { backgroundColor: card.iconBg }]}>
                <Text style={s.pickPillEmoji}>{card.icon}</Text>
              </View>
              <View style={{ maxWidth: 140 }}>
                <Text style={s.pickPillTitle} numberOfLines={1}>{card.title}</Text>
                {!!card.sub && <Text style={s.pickPillSub} numberOfLines={1}>{card.sub}</Text>}
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
        // ── Turf horizontal: TrendCard ──
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 12, paddingRight: 4, paddingBottom: 4 }}
        >
          {venuesToShow.map((item: any) => (
            <TrendCard
              key={item.id}
              item={item}
              userCoords={userCoords}
              onPress={() => onTap(item.id)}
              offer={isPhoneOnly(item) ? undefined : offersByTurf[item.id]}
              nextFree={nextFreeByTurf[item.id]}
              isSaved={savedIds?.has(item.id)}
              onToggleSave={onToggleSave ? () => onToggleSave(item.id) : undefined}
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
// ListYourTurfCard — the ONE "Add a Turf" entry → app/add-a-turf.tsx chooser
//   (owner → Grow with PlayOn plans · player → add a turf they know)
// ─────────────────────────────────────────────────────────────────────────────
// Slim strip, last thing on the home screen.
function ListYourTurfCard({ router }: { router: ReturnType<typeof useRouter> }) {
  return (
    <View style={[s.section, { marginTop: 22 }]}>
      <TouchableOpacity
        style={lt.strip}
        activeOpacity={0.9}
        onPress={() => router.push("/add-a-turf" as any)}
        accessibilityLabel="Add a Turf. Own a turf or know one? Put it on PlayOn"
      >
        <View style={lt.icon}>
          <Ionicons name="add" size={26} color="#fff" />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={lt.title} numberOfLines={1}>Add a Turf</Text>
          <Text style={lt.sub} numberOfLines={1}>Own a turf or know one? Put it on PlayOn</Text>
        </View>
        <Ionicons name="arrow-forward" size={20} color={GREEN} />
      </TouchableOpacity>
    </View>
  );
}

const lt = StyleSheet.create({
  strip: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: BRAND, borderRadius: 16, padding: 16 },
  icon:  { width: 44, height: 44, borderRadius: 12, backgroundColor: "#15803D", alignItems: "center", justifyContent: "center" },
  title: { fontSize: 15, fontWeight: "800", color: "#fff" },
  sub:   { fontSize: 12, color: "#CBD5E1", marginTop: 2 },
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
      <Text style={s.sectionTitle}>More from PlayOn</Text>

      <View style={pd.grid}>
        {OTHER_PRODUCTS.map((p) => (
          <TouchableOpacity
            key={p.id}
            style={pd.card}
            activeOpacity={0.9}
            onPress={() => router.push(p.route as any)}
            accessibilityLabel={`${p.title}, ${p.subtitle}`}
          >
            {p.image ? (
              <Image source={p.image} style={pd.iconImage} resizeMode="contain" />
            ) : (
              <View style={[pd.iconBadge, { backgroundColor: p.bg }]}>
                <Ionicons name={p.icon} size={21} color={p.color} />
              </View>
            )}
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={pd.title} numberOfLines={1}>{p.title}</Text>
              <Text style={pd.subtitle} numberOfLines={1}>{p.subtitle}</Text>
            </View>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

// Section has paddingHorizontal: 16 (32 total) and a 10px gutter between columns
const PRODUCT_CARD_W = (SCREEN_W - 32 - 10) / 2;

const pd = StyleSheet.create({
  grid:      { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 12 },
  card:      { width: PRODUCT_CARD_W, flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#fff", borderRadius: 14, padding: 10, borderWidth: 1, borderColor: "#E5E7EB" },
  iconBadge: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  iconImage: { width: 40, height: 40 },
  title:     { fontSize: 14, fontWeight: "800", color: BRAND },
  subtitle:  { fontSize: 11, color: "#4B5563", marginTop: 1 },
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
  const [takenByTurf,  setTakenByTurf]  = useState<Record<string, string[]> | null>(_slotsCache?.taken ?? null);
  const [savedIds,     setSavedIds]     = useState<Set<string>>(new Set());
  const [detecting,    setDetecting]    = useState(false);
  const [bannerPaused, setBannerPaused] = useState(false);
  const [bannerLoaded, setBannerLoaded] = useState<Record<string, boolean>>({});
  // 🏙️ City. cityId = Live PlayOn city whose turfs Home shows.
  // comingSoon = player is somewhere PlayOn isn't live → Home shows "coming soon".
  const [cityId,      setCityId]      = useState("");
  const [comingSoon,  setComingSoon]  = useState<{ name: string; nearest: { city: City; km: number } | null } | null>(null);
  const [waitlisted,  setWaitlisted]  = useState(false);
  const router = useRouter();

  const showLiveCity = (id: string, name: string) => {
    setCityId(id); setLocation(name); setComingSoon(null);
  };
  const showComingSoon = async (name: string, lat?: number | null, lng?: number | null) => {
    let nearest: { city: City; km: number } | null = null;
    try {
      const live = (await fetchCities()).filter(c => c.status === "live");
      if (lat != null && lng != null) nearest = nearestCity(lat, lng, live, false);
    } catch {}
    setCityId(""); setLocation(name); setWaitlisted(false);
    setComingSoon({ name, nearest });
  };

  // 🏙️ Every time Home is shown (incl. coming back from Profile → City Picker):
  // read the city + exact GPS point saved on this phone. Nothing saved yet →
  // the default city (set in Admin → Cities).
  useFocusEffect(
    useCallback(() => {
      (async () => {
        const [saved, coords] = await Promise.all([getSavedCity(), getSavedCoords()]);
        if (coords) setUserCoords(coords);
        if (saved?.id) showLiveCity(saved.id, saved.name);
        else if (saved?.name) showComingSoon(saved.name, coords?.lat, coords?.lng);
        else if (!auth.currentUser) {
          try {
            const def = (await fetchCities()).find(c => c.isDefault && c.status === "live");
            if (def) showLiveCity(def.id, def.name);
          } catch {}
        }
      })();
    }, [])
  );

  

  useEffect(() => {
    loadHome();
    const unsubAuth = onAuthStateChanged(auth, (u) => {
      setUser(u);
      if (u) fetchUser(u.uid);
      else { setUserInitial("U"); setUserAvatar(null); setUserCoords(null); setSavedIds(new Set()); }
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
      fetchSlots(forceRefresh);    // not awaited — "Next free" fills in when ready
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
    // Warm the image cache so banners don't flash in when the carousel slides
    data.forEach((b: any) => { if (b.image) Image.prefetch(b.image).catch(() => {}); });
  };

  // ─── fetchSlots — today's taken slots for "Next free: 6 PM" ──────────────
  // Same two queries Explore uses. Booked + blocked + offline are all "taken".
  // Cached 5 min; never blocks the screen, never shows an error.
  const fetchSlots = async (forceRefresh = false) => {
    if (!forceRefresh && _slotsCache && Date.now() - _slotsCache.fetchedAt < SLOTS_TTL) {
      setTakenByTurf(_slotsCache.taken);
      return;
    }
    try {
      const [bookSnap, blockSnap] = await Promise.all([
        getDocs(query(collection(db, "bookings"),     where("dateString", "==", TODAY_STRING))),
        getDocs(query(collection(db, "blockedSlots"), where("date",       "==", TODAY_STRING))),
      ]);
      const taken: Record<string, string[]> = {};
      const add = (tid: string, slots: string[]) => {
        if (!tid || slots.length === 0) return;
        if (!taken[tid]) taken[tid] = [];
        taken[tid].push(...slots);
      };
      bookSnap.docs.forEach(d => {
        const b = d.data();
        if (b.status === "cancelled") return;
        add(b.turfId, Array.isArray(b.selectedSlots) ? b.selectedSlots : []);
      });
      blockSnap.docs.forEach(d => {
        const b = d.data();
        const slots = Array.isArray(b.slots) && b.slots.length > 0 ? b.slots : b.slotTime ? [b.slotTime] : [];
        add(b.turfId, slots);
      });
      _slotsCache = { taken, fetchedAt: Date.now() };
      setTakenByTurf(taken);
    } catch (e) {
      console.error("Home fetchSlots error:", e);
    }
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
        // 🏙️ Phone's saved choice wins; else the user doc. Signed up where
        // PlayOn isn't live (cityId "") → Home shows "PlayOn is coming to <city>".
        const saved = await getSavedCity();
        if (saved?.id) showLiveCity(saved.id, saved.name);
        else if (saved?.name) showComingSoon(saved.name, d.latitude, d.longitude);
        else if (d.cityId) showLiveCity(d.cityId, d.cityName || d.city || "Amravati");
        else if (d.city) showComingSoon(d.city, d.latitude, d.longitude);
        else setLocation(d.location || "Amravati");
        if (d.photoURL) setUserAvatar(d.photoURL);
        if (d.latitude != null && d.longitude != null)
          setUserCoords({ lat: d.latitude, lng: d.longitude });
        if (Array.isArray(d.savedTurfs)) setSavedIds(new Set(d.savedTurfs as string[]));

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

  // ─── Location button in the header ───────────────────────────────────────
  // Tap → GPS → city name → saved on the user doc (same fields as signup and
  // Profile) → turfs re-sort by distance right away. Logged-out users still
  // get nearby sorting for this session, it's just not saved.
  const detectLocation = async () => {
    if (detecting) return;
    setDetecting(true);
    try {
      const servicesOn = await Location.hasServicesEnabledAsync();
      if (!servicesOn) {
        Alert.alert("Location is off", "Turn on location (GPS) on your phone to see turfs near you.", [
          { text: "Cancel", style: "cancel" },
          { text: "Open Settings", onPress: () => Linking.openSettings() },
        ]);
        return;
      }
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Location permission needed", "Allow location access so PlayOn can show turfs near you.", [
          { text: "Cancel", style: "cancel" },
          { text: "Open Settings", onPress: () => Linking.openSettings() },
        ]);
        return;
      }

      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const { latitude, longitude } = pos.coords;

      let city = "", area = "";
      try {
        const geo = await Location.reverseGeocodeAsync({ latitude, longitude });
        if (geo.length > 0) {
          const p = geo[0];
          city = p.city || p.subregion || p.region || "";
          area = p.district || p.subregion || p.street || p.name || "";
        }
      } catch { /* name is optional — coords are what matter */ }
      const full = [area, city].filter(Boolean).join(", ") || city || "Current location";

      setUserCoords({ lat: latitude, lng: longitude });   // → nearby turfs re-sort now
      saveCoords(latitude, longitude);

      const uid = auth.currentUser?.uid;
      if (uid) {
        await setDoc(doc(db, "users", uid), { location: full, city, area, latitude, longitude }, { merge: true });
      }

      // 🏙️ Which PlayOn city is this? Live → its turfs. Not live → "coming soon" on Home.
      try {
        const r = resolveCity(latitude, longitude, city, await fetchCities());
        if (r.live) {
          showLiveCity(r.live.id, r.live.name);
          saveCityChoice(r.live);
        } else {
          const name = city || "your city";
          saveNotLiveCity(name);
          setCityId(""); setLocation(name); setWaitlisted(false);
          setComingSoon({ name, nearest: r.nearest });
        }
      } catch {
        setLocation(city || full);
      }
      fetchSlots(true);   // fresh "Next free" times for the new list
    } catch (e) {
      console.error("detectLocation error:", e);
      Alert.alert("Couldn't get your location", "Please try again in a moment.");
    } finally {
      setDetecting(false);
    }
  };

  // ─── Save / unsave a turf (same Firestore field as Explore) ──────────────
  const toggleSave = async (id: string) => {
    const u = auth.currentUser;
    if (!u) {
      Alert.alert("Login required", "Please log in to save turfs.", [
        { text: "Cancel", style: "cancel" },
        { text: "Log In", onPress: () => router.push("/(auth)/login") },
      ]);
      return;
    }
    const wasSaved = savedIds.has(id);
    const flip = (save: boolean) => setSavedIds(prev => {
      const next = new Set(prev);
      save ? next.add(id) : next.delete(id);
      return next;
    });
    flip(!wasSaved);
    try {
      await setDoc(doc(db, "users", u.uid), { savedTurfs: wasSaved ? arrayRemove(id) : arrayUnion(id) }, { merge: true });
    } catch (e) {
      console.error("toggleSave error:", e);
      flip(wasSaved);
      Alert.alert("Couldn't update", "Please check your internet and try again.");
    }
  };

  // ─── Banner / highlight links ────────────────────────────────────────────
  //   "/refer-earn-user", "/turf/abc"   → opens that screen inside the app
  //   "https://…" or "example.com"      → opens in an in-app browser
  //   "tel:", "mailto:", "whatsapp:", "upi:" … → handed to the phone
  const openBannerLink = async (link?: string) => {
    const l = (link || "").trim();
    if (!l) return;
    try {
      if (l.startsWith("/")) {
        router.push(l as any);
        return;
      }
      if (/^[a-z][a-z0-9+.-]*:/i.test(l) && !/^https?:/i.test(l)) {
        await Linking.openURL(l);
        return;
      }
      const url = /^https?:\/\//i.test(l) ? l : `https://${l}`;
      await WebBrowser.openBrowserAsync(url);
    } catch {
      Alert.alert("Error", "Unable to open this link.");
    }
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

  // 🏙️ Banners for this player (same rule as Admin → Banners preview):
  //   on · started · not expired · All India, or this city, or "coming_soon"
  //   when PlayOn isn't live here. Sorted by the admin's order.
  const activeBanners = useMemo(() => {
    const now = Date.now();
    const ms = (v: any) => (v?.toMillis ? v.toMillis() : typeof v === "number" ? v : v ? new Date(v).getTime() : null);
    const place = comingSoon ? "coming_soon" : cityId;
    return banners
      .filter((b: any) => {
        if (b.active === false) return false;
        const start = ms(b.startAt), end = ms(b.endAt);
        if (start && start > now) return false;
        if (end && end <= now) return false;
        const ids: string[] = Array.isArray(b.cityIds) && b.cityIds.length ? b.cityIds : ["all"];
        return ids.includes("all") || (!!place && ids.includes(place));
      })
      .sort((a: any, b: any) =>
        (typeof a.order === "number" ? a.order : 9999) - (typeof b.order === "number" ? b.order : 9999) ||
        (ms(a.createdAt) || 0) - (ms(b.createdAt) || 0));
  }, [banners, cityId, comingSoon]);

  // 🏙️ Home sections + Top Pick cards for this player's city.
  // Admin → user home control "Show in": All India (or not set) · cities · "coming_soon".
  // Turfs INSIDE a section already follow the city (actualTurfs is city-only).
  const forPlace = (ids: any) => {
    if (!Array.isArray(ids) || ids.length === 0 || ids.includes("all")) return true;
    const place = comingSoon ? "coming_soon" : cityId;
    return !!place && ids.includes(place);
  };
  const citySections   = useMemo(() => sections.filter((x: any) => forPlace(x.cityIds)),   [sections, cityId, comingSoon]);
  const cityHighlights = useMemo(() => highlights.filter((x: any) => forPlace(x.cityIds)), [highlights, cityId, comingSoon]);

  // Tap count for Admin → Banners. Fire-and-forget, never blocks the tap.
  const onBannerTap = (item: any) => {
    if (item?.id) updateDoc(doc(db, "banners", item.id), { taps: increment(1) }).catch(() => {});
    openBannerLink(item?.link);
  };

// ─── Split turfs from gyms and Ball Machine venues based on venueType ────
  // ALL venues live in `turfs` collection now; we filter by venueType here.
  // - actualTurfs        = anything that's NOT a gym or Ball Machine venue
  // - actualGyms         = only docs with venueType === "gym"
  // - actualBallMachines = only docs with venueType === "ball_machine"
  //   (previously these fell into actualTurfs and got the turf card + the
  //   /turf/[id] slot-booking route — but they have no slots/hourly price
  //   at all, so that showed ₹0/hr and opened the wrong booking flow.)
  // 🏙️ Only the current city's venues. Coming soon → none. No city yet → all.
  const cityTurfs = useMemo(
    () => comingSoon ? [] : cityId ? turfs.filter((t: any) => t.cityId === cityId) : turfs,
    [turfs, cityId, comingSoon]
  );

  const actualTurfs = useMemo(
    () => cityTurfs.filter((t: any) => t.venueType !== "gym" && t.venueType !== "ball_machine"),
    [cityTurfs]
  );

  const actualGyms = useMemo(
    () => cityTurfs.filter((t: any) => t.venueType === "gym"),
    [cityTurfs]
  );

  const actualBallMachines = useMemo(
    () => cityTurfs.filter((t: any) => t.venueType === "ball_machine"),
    [cityTurfs]
  );

  // Live city but no venues listed yet (e.g. Nagpur just switched to Live)
  const emptyLiveCity = !!cityId && !comingSoon &&
    actualTurfs.length === 0 && actualGyms.length === 0 && actualBallMachines.length === 0;


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

  // ─── "Next free" per turf (undefined until today's slots load) ────────
  const nextFreeByTurf = useMemo(() => {
    const map: Record<string, string | null | undefined> = {};
    if (!takenByTurf) return map;
    actualTurfs.forEach((t: any) => {
      if (!isPhoneOnly(t)) map[t.id] = nextFreeSlot(t, takenByTurf[t.id] || []);
    });
    return map;
  }, [actualTurfs, takenByTurf]);

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
            {/* PlayOn logo — tap it to update to your current location
                (same as tapping the "Amravati" line). The "Playon" word
                itself is not a button. */}
            <TouchableOpacity
              onPress={detectLocation}
              disabled={detecting}
              activeOpacity={0.7}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              accessibilityRole="button"
              accessibilityLabel="PlayOn logo. Tap to update to your current location"
            >
              <Image
                source={require("../../assets/images/playon-receipt-logo.png")}
                style={[s.headerLogo, detecting && { opacity: 0.5 }]}
                resizeMode="contain"
              />
            </TouchableOpacity>
            <View style={s.headerTextBlock}>
              <Text style={s.appTitle}>Playon</Text>
              {/* 🏙️ Tap → detect current GPS location → that city's turfs
                  (or "PlayOn is coming to <city>" when it isn't live there) */}
              <TouchableOpacity
                style={s.locationBtn}
                activeOpacity={0.75}
                onPress={detectLocation}
                disabled={detecting}
                accessibilityLabel={`Location ${location}. Tap to update to your current location`}
              >
                {detecting
                  ? <ActivityIndicator size="small" color="#15803D" style={{ transform: [{ scale: 0.55 }], width: 12, height: 12 }} />
                  : <Ionicons name="locate" size={12} color="#15803D" />}
                <Text style={s.locationTxt} numberOfLines={1}>
                  {detecting ? "Detecting…" : location}
                </Text>
                {!detecting && <Ionicons name="refresh" size={11} color="#15803D" />}
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
        {/* Whole banner is the button (no "View Now"). Fixed 2:1 ratio, no
            parallax shrink, so the designed image shows complete. Text from
            admin fields only appears when those fields are filled, and the
            dark overlay only when there's text on top. */}
        {activeBanners.length > 0 && (
          <View
            style={s.bannerSection}
            onTouchStart={() => setBannerPaused(true)}
            onTouchEnd={() => setBannerPaused(false)}
            onTouchCancel={() => setBannerPaused(false)}
          >
            <Carousel
              width={SCREEN_W} height={BANNER_H}
              autoPlay={activeBanners.length > 1 && !bannerPaused}
              autoPlayInterval={4500}
              scrollAnimationDuration={600} data={activeBanners}
              onSnapToItem={i => setActiveDot(i)}
              pagingEnabled snapEnabled loop={activeBanners.length > 1} enabled={activeBanners.length > 1}
              style={{ width: SCREEN_W, alignSelf: "center" }}
              renderItem={({ item }) => {
                const hasText = !!(item.title || item.subtitle || item.badge || item.date);
                const loaded  = !!bannerLoaded[item.id];
                return (
                  <TouchableOpacity
                    style={s.bannerCard}
                    activeOpacity={0.92}
                    onPress={() => onBannerTap(item)}
                    disabled={!item.link}
                    accessibilityRole={item.link ? "link" : "image"}
                    accessibilityLabel={item.title || "Banner"}
                  >
                    {!loaded && <View style={s.bannerSkeleton} />}
                    <Image
                      source={{ uri: item.image }}
                      style={s.bannerImg}
                      resizeMode="cover"
                      onLoad={() => setBannerLoaded(prev => (prev[item.id] ? prev : { ...prev, [item.id]: true }))}
                    />
                    {hasText && (
                      <>
                        <View style={[s.bannerOverlay, !!item.title && s.bannerOverlayDark]} />
                        <View style={s.bannerContent}>
                          {!!item.badge    && <View style={s.bannerBadge}><Text style={s.bannerBadgeTxt}>{item.badge}</Text></View>}
                          {!!item.title    && <Text style={s.bannerTitle} numberOfLines={2}>{item.title}</Text>}
                          {!!item.subtitle && <Text style={s.bannerSub} numberOfLines={2}>{item.subtitle}</Text>}
                          {!!item.date && (
                            <View style={s.bannerDateRow}>
                              <Ionicons name="calendar-outline" size={13} color="rgba(255,255,255,0.85)" />
                              <Text style={s.bannerDateTxt}>{item.date}</Text>
                            </View>
                          )}
                        </View>
                      </>
                    )}
                  </TouchableOpacity>
                );
              }}
            />
            {activeBanners.length > 1 && (
              <View style={s.dotRow}>
                {activeBanners.map((_, i) => <View key={i} style={[s.dot, activeDot === i && s.dotActive]} />)}
              </View>
            )}
          </View>
        )}

        {/* ── 🏙️ Live city, no turfs listed yet ── */}
        {emptyLiveCity && (
          <View style={cs.card}>
            <View style={[cs.pill, { backgroundColor: "#DCFCE7" }]}>
              <Ionicons name="football-outline" size={13} color="#15803D" />
              <Text style={[cs.pillTxt, { color: "#15803D" }]}>PlayOn is live in {location}</Text>
            </View>
            <Text style={cs.title}>Turfs coming soon in {location}</Text>
            <Text style={cs.sub}>We're adding turfs here right now. Know one? Add it and players can book it.</Text>
            <TouchableOpacity style={cs.btn} activeOpacity={0.85} onPress={() => router.push("/add-a-turf" as any)}>
              <Ionicons name="add" size={18} color="#fff" />
              <Text style={cs.btnTxt}>Add a turf in {location}</Text>
            </TouchableOpacity>
            {waitlisted ? (
              <View style={[cs.row, { backgroundColor: "#F0FDF4", borderColor: "#BBF7D0" }]}>
                <Ionicons name="checkmark-circle" size={20} color="#15803D" />
                <Text style={[cs.rowTitle, { color: "#15803D" }]}>We'll tell you when turfs are added</Text>
              </View>
            ) : (
              <TouchableOpacity
                style={cs.row}
                activeOpacity={0.85}
                onPress={async () => {
                  const ok = await joinCityWaitlist(location, userCoords?.lat, userCoords?.lng);
                  if (ok) setWaitlisted(true);
                  else Alert.alert("Couldn't save", "Please check your internet and try again.");
                }}
              >
                <View style={cs.rowIcon}><Ionicons name="notifications-outline" size={20} color={BRAND} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={cs.rowTitle}>Notify me</Text>
                  <Text style={cs.rowSub}>Get a message when the first turfs go live</Text>
                </View>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* ── 🏙️ PlayOn isn't live here yet ── */}
        {comingSoon && (
          <View style={cs.card}>
            <View style={cs.pill}>
              <Ionicons name="time-outline" size={13} color="#92400E" />
              <Text style={cs.pillTxt}>Coming soon</Text>
            </View>
            <Text style={cs.title}>PlayOn is coming to {comingSoon.name}</Text>
            <Text style={cs.sub}>No turfs here yet. Get a message the day {comingSoon.name} goes live.</Text>
            {waitlisted ? (
              <View style={[cs.btn, { backgroundColor: "#DCFCE7" }]}>
                <Ionicons name="checkmark-circle" size={18} color="#15803D" />
                <Text style={[cs.btnTxt, { color: "#15803D" }]}>We'll tell you when it's live</Text>
              </View>
            ) : (
              <TouchableOpacity
                style={cs.btn}
                activeOpacity={0.85}
                onPress={async () => {
                  const ok = await joinCityWaitlist(comingSoon.name, userCoords?.lat, userCoords?.lng);
                  if (ok) setWaitlisted(true);
                  else Alert.alert("Couldn't save", "Please check your internet and try again.");
                }}
              >
                <Ionicons name="notifications-outline" size={18} color="#fff" />
                <Text style={cs.btnTxt}>Notify me</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={cs.row} activeOpacity={0.85} onPress={() => router.push("/add-a-turf" as any)}>
              <View style={[cs.rowIcon, { backgroundColor: BRAND }]}><Ionicons name="add" size={20} color="#fff" /></View>
              <View style={{ flex: 1 }}>
                <Text style={cs.rowTitle}>Know a turf in {comingSoon.name}?</Text>
                <Text style={cs.rowSub}>Add it and help bring PlayOn here</Text>
              </View>
            </TouchableOpacity>
            {comingSoon.nearest && (
              <TouchableOpacity
                style={cs.row}
                activeOpacity={0.85}
                onPress={() => {
                  const c = comingSoon.nearest!.city;
                  showLiveCity(c.id, c.name);
                  saveCityChoice(c);
                }}
              >
                <View style={cs.rowIcon}><Ionicons name="navigate-outline" size={20} color={BRAND} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={cs.rowTitle}>Browse {comingSoon.nearest.city.name}</Text>
                  <Text style={cs.rowSub}>Nearest live city · {Math.round(comingSoon.nearest.km)} km</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={BRAND} />
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* ── All sections — fully controlled by admin ── */}
     {!comingSoon && citySections.map(section => section.type === "offers" ? (
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
        <TouchableOpacity style={s.seeAllBtn} onPress={() => router.push("/(tabs)/explore")} activeOpacity={0.7}>
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
    allHighlights={cityHighlights}
    userCoords={userCoords}
    onTurf={goToTurf}
    onGym={goToGym}                 // ✅ NEW
    onBallMachine={goToBallMachine} // ✅ NEW
    onExplore={() => router.push("/(tabs)/explore")}
    onHighlight={onHighlightTap}
    offersByTurf={offersByTurf}
    nextFreeByTurf={nextFreeByTurf}
    savedIds={savedIds}
    onToggleSave={toggleSave}
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


      {/* ── More from PlayOn — Toss, Scorer, Refer & Earn, Refer a Venue ── */}
      <OtherProductsSection router={router} />

      {/* ── Turf owners — slim strip, last on the page ── */}
      <ListYourTurfCard router={router} />

      </ScrollView>
    </View>
  );
}

// ── 🏙️ "PlayOn is coming to <city>" card ───────────────────────────────────
const cs = StyleSheet.create({
  card:    { marginHorizontal: 16, marginTop: 20, padding: 18, borderRadius: 18, backgroundColor: "#fff", borderWidth: 1, borderColor: "#E5E7EB", gap: 12 },
  pill:    { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 99, backgroundColor: "#FEF3C7" },
  pillTxt: { fontSize: 12, fontWeight: "800", color: "#92400E" },
  title:   { fontSize: 22, fontWeight: "900", color: BRAND, letterSpacing: -0.3 },
  sub:     { fontSize: 14, color: "#4B5563", lineHeight: 20, marginTop: -4 },
  btn:     { height: 50, borderRadius: 14, backgroundColor: "#15803D", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  btnTxt:  { fontSize: 15, fontWeight: "800", color: "#fff" },
  row:     { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: "#E5E7EB" },
  rowIcon: { width: 38, height: 38, borderRadius: 11, backgroundColor: "#F3F4F6", alignItems: "center", justifyContent: "center" },
  rowTitle:{ fontSize: 14, fontWeight: "800", color: BRAND },
  rowSub:  { fontSize: 12, color: "#4B5563", marginTop: 2 },
});

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
  // Title + location together are exactly as tall as the 40px icon circles,
  // so the whole header sits on one line.
  // Everything in the header row is 40px tall so it all sits on one line.
  headerLogo:      { width: 40, height: 40, marginRight: 8 },
  headerTextBlock: { flex: 1, minWidth: 0, height: 40, justifyContent: "center", paddingRight: 6 },
  appTitle:        { fontSize: 20, lineHeight: 24, fontWeight: "900", color: BRAND, letterSpacing: -0.5 },
  locationBtn:     { flexDirection: "row", alignItems: "center", gap: 3, alignSelf: "flex-start", maxWidth: "100%", height: 16 },
  locationTxt:     { fontSize: 12, lineHeight: 16, color: "#15803D", fontWeight: "700", flexShrink: 1 },
  headerIcons:     { flexDirection: "row", alignItems: "center", gap: 8 },
  iconCircle:      { width: 40, height: 40, borderRadius: 20, backgroundColor: "#fff", borderWidth: 1, borderColor: "#E5E7EB", alignItems: "center", justifyContent: "center" },
  badge:           { position: "absolute", top: -3, right: -2, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: "#EF4444", alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "#F5F5F5" },
  badgeTxt:        { fontSize: 10, fontWeight: "900", color: "#fff" },
  avatarWrap:      { width: 42, height: 42, borderRadius: 21, overflow: "hidden", borderWidth: 2, borderColor: WHITE },
  avatarImg:       { width: "100%", height: "100%" },
  avatarFallback:  { width: "100%", height: "100%", backgroundColor: "#000", alignItems: "center", justifyContent: "center" },
  avatarTxt:       { color: "#fff", fontWeight: "800", fontSize: 15 },

  bannerSection: { marginTop: 12 },
  bannerCard:    { width: BANNER_W, height: BANNER_H, alignSelf: "center", borderRadius: 18, overflow: "hidden", backgroundColor: "#E5E7EB" },
  bannerImg:     { width: "100%", height: "100%" },
  bannerSkeleton:{ ...StyleSheet.absoluteFillObject, backgroundColor: "#E5E7EB" },
  bannerOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(5,12,24,0.10)" },
  bannerOverlayDark: { backgroundColor: "rgba(5,12,24,0.35)" },
  bannerContent: { position: "absolute", left: 16, right: 16, bottom: 16 },
  bannerBadge:   { alignSelf: "flex-start", backgroundColor: GREEN, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6, marginBottom: 6 },
  bannerBadgeTxt:{ fontSize: 10, fontWeight: "800", color: "#fff", letterSpacing: 0.8, textTransform: "uppercase" },
  bannerTitle:   { fontSize: 20, fontWeight: "900", color: "#fff", letterSpacing: -0.3, lineHeight: 26 },
  bannerSub:     { fontSize: 10, color: "rgba(255,255,255,0.75)", marginTop: 3 },
  bannerDateRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 5 },
  bannerDateTxt: { fontSize: 12, color: "rgba(255,255,255,0.8)", fontWeight: "500" },
  // Dots sit under the banner; the active one stretches into a pill
  dotRow:        { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 5, marginTop: 8 },
  dot:           { width: 6, height: 6, borderRadius: 3, backgroundColor: "#CBD5E1" },
  dotActive:     { width: 18, backgroundColor: BRAND },

  section:          { marginTop: 20, paddingHorizontal: 16 },
  sectionRow:       { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 },
  sectionTitleWrap: { flexDirection: "row", alignItems: "flex-start", gap: 8, flex: 1 },
  sectionEmoji:     { fontSize: 18, marginTop: 1 },
  sectionTitle:     { fontSize: 17, fontWeight: "800", color: BRAND, letterSpacing: -0.2 },
  sectionSubtitle:  { fontSize: 12, color: "#9CA3AF", marginTop: 2, fontWeight: "500" },
  seeAllBtn:        { flexDirection: "row", alignItems: "center", gap: 3, paddingTop: 2 },
  seeAllTxt:        { fontSize: 13, fontWeight: "600", color: "#6B7280" },
  turfCount:        { fontSize: 12, fontWeight: "600", color: "#9CA3AF", paddingTop: 2 },

  // Top Picks — slim pills
  pickHeading:   { fontSize: 15, fontWeight: "800", color: BRAND, marginBottom: 8 },
  pickPill:      { height: 52, flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 8, paddingRight: 14, borderRadius: 14, borderWidth: 1, borderColor: "rgba(0,0,0,0.05)" },
  pickPillIcon:  { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  pickPillEmoji: { fontSize: 18 },
  pickPillTitle: { fontSize: 13, fontWeight: "800", color: BRAND },
  pickPillSub:   { fontSize: 11, color: "#4B5563", marginTop: 1 },

  empty:      { backgroundColor: "#fff", borderRadius: 16, padding: 32, alignItems: "center", borderWidth: 1, borderColor: "#E5E7EB" },
  emptyTitle: { fontSize: 16, fontWeight: "800", color: BRAND, marginTop: 10 },
  emptySub:   { fontSize: 13, color: "#9CA3AF", marginTop: 6, textAlign: "center" },

  //wallet
  walletBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "#393b40",
    height: 40,
    paddingHorizontal: 12,
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
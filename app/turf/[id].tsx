import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  View,
  Text,
  StyleSheet,
  Image,
  TouchableOpacity,
  FlatList,
  Alert,
  ScrollView,
  Dimensions,
  ActivityIndicator,
  StatusBar,
  Platform,
  Linking,
  Animated,
  LayoutAnimation,
  UIManager,
  TextInput,
  RefreshControl,
  Modal,
  KeyboardAvoidingView,
  Keyboard,
  Switch,
  AccessibilityInfo,
  Easing,
} from "react-native";

import { useLocalSearchParams, Stack } from "expo-router";
import {
  doc,
  getDoc,
  collection,
  getDocs,
  addDoc,
  query,
  where,
  deleteDoc,
} from "firebase/firestore";
import Carousel from "react-native-reanimated-carousel";
import { SafeAreaView } from "react-native-safe-area-context";

const RazorpayCheckout = Platform.OS !== "web" && !__DEV__
  ? require("react-native-razorpay").default
  : { open: () => Promise.reject({ error: { description: "Razorpay not available in Expo Go" } }) };
import { Ionicons } from "@expo/vector-icons";
import { MaterialCommunityIcons } from "@expo/vector-icons";


import { db, auth } from "../../firebaseConfig";
import { onAuthStateChanged } from "firebase/auth";
import { useRouter } from "expo-router";
import { useFocusEffect } from "expo-router";
import { DEFAULT_TURF_IMAGE, hasPrice, priceOrCall } from "../../utils/turfDisplay";
// add to existing RN imports

type BookingType = "advance" | "full";
type BookingMode = "flexible" | "quick";
 
// ── Advance Pricing ──
type PriceSlab = { start: number; end: number; rate: number };
type DayType   = "weekday" | "weekend";

interface Turf {
  id: string;
  name: string;
  location: string;
  sport?: string | string[];
  images?: string[];
  image?: string;
  openingTime: number | string;
  closingTime: number | string;
  slotDuration?: number | string;
  slotInterval?: number | string;
  dayPrice?: number | string;
  nightPrice?: number | string;
  price?: number | string;
  bookingPrice?: number | string;
  mapLink?: string;
  ownerName?: string;
  facilities?: string[];
  // ── new fields ──
  rating?: number | string;
  status?: string;
  statusNote?: string;
  statusUpdatedAt?: string;
 venueType?: string;  // ← add this line
    latitude?: number;
  longitude?: number;
  // ── Advance Pricing (opt-in per turf) ──
    advancePricingEnabled?: boolean;
  priceSlabs?: { weekday?: PriceSlab[]; weekend?: PriceSlab[] };
  // ── Set by admin: "online" | "phone" | "both" ──
  bookingMode?: "online" | "phone" | "both";
  bookingPhone?: string;
  flexibleSlotsEnabled?: boolean;   // missing = ON
  quickSlotsEnabled?: boolean;      // missing = ON
    lateCutoffHours?: number;         // late-night booking closes N hrs before 12 AM (0 = no cutoff)
}

interface TimeRange {
  time: string;
  startValue: number;
  endValue: number;
}

interface SlotChip {
  value: number;
  label: string;
  status: "available" | "booked" | "locked" | "past" | "outside";
}

// No photo → default PlayOn photo · no price → "On call" (utils/turfDisplay.ts)
const FALLBACK_IMAGE = DEFAULT_TURF_IMAGE;

// 🌙 Booking number is hidden between these hours (24-hour clock, phone's time)
const CALL_QUIET_FROM = 22;   // 10 PM
const CALL_QUIET_TO   = 7;    // 7 AM

const MAX_BOOKING_HOURS = 3;        // ✅ Was 2, now 3
const MIN_BOOKING_HOURS = 1;
const ADVANCE_THRESHOLD_HOURS = 2;  // ✅ NEW: above this, advance jumps 50%
const ADVANCE_MULTIPLIER = 1.5;     // ✅ NEW: 50% extra for 3-hour bookings

// ── Turf status config ────────────────────────────────────────────────────────
const STATUS_CONFIG: Record<string, {
  label: string; emoji: string; color: string; textColor: string; border: string;
}> = {
  ready:       { label: "Field Ready",        emoji: "✅", color: "#F0FDF4", textColor: "#15803D", border: "#86EFAC" },
  wet:         { label: "Wet / Rain",          emoji: "🌧️", color: "#EFF6FF", textColor: "#1D4ED8", border: "#93C5FD" },
  maintenance: { label: "Under Maintenance",   emoji: "🔧", color: "#FFFBEB", textColor: "#B45309", border: "#FCD34D" },
  partial:     { label: "Partially Available", emoji: "⚠️", color: "#FFF7ED", textColor: "#C2410C", border: "#FDBA74" },
  closed:      { label: "Closed Today",        emoji: "❌", color: "#FFF1F2", textColor: "#BE123C", border: "#FDA4AF" },
  league:      { label: "League in Progress",  emoji: "🏆", color: "#F5F3FF", textColor: "#6D28D9", border: "#C4B5FD" },
};

// ── Quick slots grouped by part of the day ──
type DayPart = "morning" | "afternoon" | "evening" | "night";
const DAY_PARTS: { key: DayPart; label: string; icon: keyof typeof Ionicons.glyphMap; from: number; to: number }[] = [
  { key: "morning",   label: "Morning",   icon: "sunny-outline",        from: 0,  to: 12 },
  { key: "afternoon", label: "Afternoon", icon: "partly-sunny-outline", from: 12, to: 17 },
  { key: "evening",   label: "Evening",   icon: "cloudy-night-outline", from: 17, to: 21 },
    { key: "night",     label: "Night",     icon: "moon-outline",         from: 21, to: 28 },   // includes 12–4 AM
];
const SPORT_STYLE: Record<string, { bg: string; icon: keyof typeof Ionicons.glyphMap }> = {
  
  Cricket:    { bg: "#16A34A", icon: "baseball-outline" },
  Football:   { bg: "#0B1220", icon: "football-outline" },
  Basketball: { bg: "#EA580C", icon: "basketball-outline" },
  Tennis:     { bg: "#65A30D", icon: "tennisball-outline" },
  Badminton:  { bg: "#7C3AED", icon: "tennisball-outline" },
  Pickleball: { bg: "#0891B2", icon: "tennisball-outline" },
  Volleyball: { bg: "#0EA5E9", icon: "ellipse-outline" },
};

// ── Quick slots: short label "6 – 7 PM", "11 PM – 12 AM", "6:30 – 7:30 PM" ──
function quickLabel(fmt: (v: number) => string, start: number, end: number) {
  const a = fmt(start).replace(":00", "");
  const b = fmt(end).replace(":00", "");
  const [aNum, aSuf] = a.split(" ");
  const bSuf = b.split(" ")[1];
  // Thin dash with no spaces when AM/PM differs, so "11 PM–12 AM" fits at full size
  return aSuf === bSuf ? `${aNum} – ${b}` : `${a}–${b}`;
}

// ── Quick slot box (time only). Offer slots flip like a railway board:
//    time → ~₹1000~ ₹800 → time …  One shared `flip` value drives every box.
const FLIP_H = 18;
function QuickSlotBox({
  label, state, offerOld, offerNew, offerText, flip, last, onPress,
}: {
  label: string;
  state: "free" | "selected" | "booked";
  offerOld?: number | null;   // original price (percent offers)
  offerNew?: number | null;   // offer price   (percent offers)
  offerText?: string | null;  // e.g. "₹100 off" (flat offers)
  flip: Animated.Value;
  last: boolean;              // 3rd box in a row → no right margin
  onPress: () => void;
}) {
  const isOffer   = !!offerText || (offerNew != null && offerOld != null && offerNew < offerOld);
  const selected  = state === "selected";
  const booked    = state === "booked";
  const showFlip  = isOffer && !booked;

  const timeY  = flip.interpolate({ inputRange: [0, 1, 1.001, 2], outputRange: [0, -FLIP_H, FLIP_H, 0] });
  const timeOp = flip.interpolate({ inputRange: [0, 1, 1.001, 2], outputRange: [1, 0, 0, 1] });
  const offY   = flip.interpolate({ inputRange: [0, 1, 2], outputRange: [FLIP_H, 0, -FLIP_H] });
  const offOp  = flip.interpolate({ inputRange: [0, 1, 2], outputRange: [0, 1, 0] });

  const txtColor = booked ? "#9CA3AF" : selected ? "#FFFFFF" : isOffer ? "#15803D" : "#1A1D21";

  return (
    <TouchableOpacity
      disabled={booked}
      onPress={onPress}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityState={{ selected, disabled: booked }}
      accessibilityLabel={`${label}${booked ? ", booked" : ""}${isOffer && !booked ? ", offer price" : ""}`}
      style={[
        styles.qBox,
        !last && { marginRight: "2%" },
        isOffer && styles.qBoxOffer,
        selected && styles.qBoxSelected,
        booked && styles.qBoxBooked,
      ]}
    >
      {showFlip ? (
        <View style={styles.qFlipWrap}>
          <Animated.View style={[styles.qFlipRow, { opacity: timeOp, transform: [{ translateY: timeY }] }]}>
            <Text style={[styles.qTime, { color: txtColor }]} numberOfLines={1} adjustsFontSizeToFit>{label}</Text>
          </Animated.View>
          <Animated.View style={[styles.qFlipRow, { opacity: offOp, transform: [{ translateY: offY }] }]}>
            {offerText ? (
              <Text style={[styles.qTime, { color: selected ? "#FFFFFF" : "#EA580C" }]} numberOfLines={1}>{offerText}</Text>
            ) : (
              <Text numberOfLines={1}>
                <Text style={[styles.qOld, selected && { color: "#DCFCE7" }]}>₹{offerOld}</Text>
                <Text style={[styles.qTime, { color: txtColor }]}> ₹{offerNew}</Text>
              </Text>
            )}
          </Animated.View>
        </View>
      ) : (
        <Text
          style={[styles.qTime, { color: txtColor }, booked && { textDecorationLine: "line-through" }]}
          numberOfLines={1}
          adjustsFontSizeToFit
        >
          {label}
        </Text>
      )}
      {isOffer && !booked && (
        <View style={styles.qBadge}><Text style={styles.qBadgeTxt}>%</Text></View>
      )}
    </TouchableOpacity>
  );
}

function SportPill({ sport }: { sport: string }) {
  const cfg = SPORT_STYLE[sport] ?? { bg: "#111111", icon: "ellipse-outline" as const };
  return (
    <View style={[styles.sportPill, { backgroundColor: cfg.bg }]}>
      <View style={styles.sportIconCircle}>
        <Ionicons name={cfg.icon} size={11} color={cfg.bg} />
      </View>
      <Text style={styles.sportPillText}>{sport}</Text>
    </View>
  );
}

// ─── Slot Chip Component ──────────────────────────────────────────────────────
function SlotChip({
  chip, isSelected, isInRange, onPress,
}: {
  chip: SlotChip;
  isSelected: boolean;
  isInRange: boolean;
  onPress: () => void;
}) {
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const handlePress = useCallback(() => {
    Animated.sequence([
      Animated.timing(scaleAnim, { toValue: 0.93, duration: 80,  useNativeDriver: true }),
      Animated.timing(scaleAnim, { toValue: 1,    duration: 120, useNativeDriver: true }),
    ]).start();
    onPress();
  }, [onPress]);

  const disabled = chip.status !== "available";

  const chipStyle = [
    styles.slotChip,
    isSelected && styles.slotChipSelected,
    isInRange && !isSelected && styles.slotChipInRange,
    chip.status === "booked"  && styles.slotChipBooked,
    chip.status === "locked"  && styles.slotChipLocked,
    chip.status === "past"    && styles.slotChipPast,
    chip.status === "outside" && styles.slotChipPast,
  ];

  const textStyle = [
    styles.slotChipText,
    isSelected && styles.slotChipTextSelected,
    isInRange && !isSelected && styles.slotChipTextInRange,
    disabled && styles.slotChipTextDisabled,
  ];

  const statusText =
    chip.status === "booked"  ? "Booked"  :
    chip.status === "locked"  ? "Locked"  :
    chip.status === "past"    ? "Past"    :
    chip.status === "outside" ? "Closed"  :
    isSelected                ? "●"       : "";

  return (
    <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
      <TouchableOpacity
        style={chipStyle}
        onPress={handlePress}
        disabled={disabled}
        activeOpacity={0.75}
      >
        <Text style={textStyle}>{chip.label}</Text>
        {statusText ? (
          <Text style={[
            styles.slotChipStatus,
            isSelected && { color: "rgba(255,255,255,0.75)" },
            isInRange && !isSelected && { color: "#374151" },
            disabled && styles.slotChipStatusDisabled,
          ]}>
            {statusText}
          </Text>
        ) : null}
      </TouchableOpacity>
    </Animated.View>
  );
}

function PromoSuccessModal({ visible, promoApplied, advanceAmount, onContinue, onRemove }: {
  visible: boolean;
  promoApplied: { code: string; discount: number; description: string } | null;
  advanceAmount: number;
  onContinue: () => void;
  onRemove: () => void;
}) {
  const scaleAnim  = useRef(new Animated.Value(0)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(opacityAnim, { toValue: 1, duration: 250, useNativeDriver: true }),
        Animated.spring(scaleAnim,   { toValue: 1, friction: 6, tension: 100, useNativeDriver: true }),
      ]).start();
    } else {
      scaleAnim.setValue(0);
      opacityAnim.setValue(0);
    }
  }, [visible]);

  if (!visible || !promoApplied) return null;
  const finalAmount = Math.max(advanceAmount - promoApplied.discount, 0);

  return (
    <Animated.View style={[modalStyles.overlay, { opacity: opacityAnim }]}>
      <Animated.View style={[modalStyles.card, { transform: [{ scale: scaleAnim }] }]}>

        {/* Top dark header */}
        <View style={modalStyles.top}>
          
          <View style={modalStyles.badgeWrap}>
            <View style={modalStyles.tick}>
              <Text style={{ color:"#fff", fontSize:13, fontWeight:"900" }}>✓</Text>
            </View>
            <Text style={modalStyles.badgeCode}>{promoApplied.code}</Text>
          </View>
          <Text style={modalStyles.bigTitle}>Woohoo! You unlocked a deal 🎉</Text>
          <Text style={modalStyles.subTitle}>Congratulations</Text>
        </View>

        {/* Green savings strip */}
        <View style={modalStyles.savingStrip}>
          <Text style={modalStyles.savingTxt}>⭐ You're saving ₹{promoApplied.discount}!</Text>
        </View>

        {/* Body */}
        <View style={modalStyles.body}>
          <View style={modalStyles.breakdown}>
            <View style={modalStyles.bRow}>
              <Text style={modalStyles.bLabel}>Original amount</Text>
              <Text style={modalStyles.bVal}>₹{advanceAmount}</Text>
            </View>
            <View style={modalStyles.bRow}>
              <Text style={[modalStyles.bLabel, { color:"#DC2626" }]}>Discount</Text>
              <Text style={[modalStyles.bVal, { color:"#DC2626" }]}>- ₹{promoApplied.discount}</Text>
            </View>
            <View style={modalStyles.divider} />
            <View style={modalStyles.bRow}>
              <Text style={modalStyles.finalLabel}>Pay now</Text>
              <Text style={modalStyles.finalVal}>₹{finalAmount}</Text>
            </View>
          </View>

          <View style={modalStyles.descBox}>
            <Text style={modalStyles.descTxt}>
              {promoApplied.description} · Savings applied instantly to your booking.
            </Text>
          </View>

          <TouchableOpacity style={modalStyles.ctaBtn} onPress={onContinue}>
            <Text style={modalStyles.ctaTxt}>Continue to payment →</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onRemove} style={{ marginTop: 12, alignItems:"center" }}>
            <Text style={{ fontSize:12, color:"#9CA3AF", textDecorationLine:"underline" }}>
              Remove promo code
            </Text>
          </TouchableOpacity>
        </View>
      </Animated.View>
    </Animated.View>
  );
}

const modalStyles = StyleSheet.create({
  overlay:     { position:"absolute", top:0,left:0,right:0,bottom:0, backgroundColor:"rgba(0,0,0,0.6)", zIndex:999, justifyContent:"center", alignItems:"center", padding:24 },
  card:        { width:"100%", backgroundColor:"#fff", borderRadius:24, overflow:"hidden" },
  top:         { backgroundColor:"#111111", padding:24, alignItems:"center" },
  dotRow:      { flexDirection:"row", gap:6, marginBottom:14 },
  dot:         { width:9, height:9, borderRadius:99 },
  badgeWrap:   { flexDirection:"row", alignItems:"center", gap:8, backgroundColor:"rgba(255,255,255,0.12)", borderRadius:99, paddingHorizontal:16, paddingVertical:6, marginBottom:14 },
  tick:        { width:22, height:22, borderRadius:11, backgroundColor:"#22C55E", alignItems:"center", justifyContent:"center" },
  badgeCode:   { color:"#fff", fontSize:14, fontWeight:"800", letterSpacing:1 },
  bigTitle:    { color:"#fff", fontSize:18, fontWeight:"800", textAlign:"center", lineHeight:26, marginBottom:6 },
  subTitle:    { color:"rgba(255,255,255,0.6)", fontSize:13, fontWeight:"500" },
  savingStrip: { backgroundColor:"#22C55E", padding:10, alignItems:"center" },
  savingTxt:   { color:"#fff", fontSize:15, fontWeight:"800" },
  body:        { padding:20 },
  breakdown:   { backgroundColor:"#F9FAFB", borderRadius:14, padding:14, marginBottom:14 },
  bRow:        { flexDirection:"row", justifyContent:"space-between", paddingVertical:5 },
  bLabel:      { fontSize:13, color:"#6B7280", fontWeight:"600" },
  bVal:        { fontSize:13, color:"#111", fontWeight:"700" },
  divider:     { height:1, backgroundColor:"#E5E7EB", marginVertical:8 },
  finalLabel:  { fontSize:14, fontWeight:"800", color:"#15803D" },
  finalVal:    { fontSize:18, fontWeight:"900", color:"#15803D" },
  descBox:     { backgroundColor:"#F0FDF4", borderWidth:1, borderColor:"#BBF7D0", borderRadius:12, padding:12, marginBottom:16 },
  descTxt:     { fontSize:12, color:"#15803D", fontWeight:"600", lineHeight:18 },
  ctaBtn:      { backgroundColor:"#111", borderRadius:14, padding:16, alignItems:"center" },
  ctaTxt:      { color:"#fff", fontSize:15, fontWeight:"800" },
});

// ─── Main Component ───────────────────────────────────────────────────────────
export default function TurfDetails() {
  const { id } = useLocalSearchParams();

  useEffect(() => {
    if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
      UIManager.setLayoutAnimationEnabledExperimental(true);
    }
  }, []);

  const width  = Dimensions.get("window").width;
  const router = useRouter();

  const [activeImageDot, setActiveImageDot] = useState(0);

  const [turf,          setTurf]          = useState<Turf | null>(null);
  const [bookedSlots,   setBookedSlots]   = useState<string[]>([]);
  const [lockedSlots,   setLockedSlots]   = useState<string[]>([]);
  const [specialPrices, setSpecialPrices] = useState<any[]>([]);

  const [selectedDate, setSelectedDate] = useState(new Date());
  const [bookingMode,  setBookingMode]  = useState<BookingMode>("flexible");
  const [bookingType,  setBookingType]  = useState<BookingType>("advance");

  const [flexStart,   setFlexStart]   = useState<number | null>(null);
  const [flexEnd,     setFlexEnd]     = useState<number | null>(null);
  const [activePanel, setActivePanel] = useState<"from" | "to" | null>(null);

  const [selectedQuickSlots, setSelectedQuickSlots] = useState<TimeRange[]>([]);
    const [quickPart, setQuickPart] = useState<DayPart>("evening");
      const [fromPart,  setFromPart]  = useState<DayPart>("evening");

  const [loading,     setLoading]     = useState(false);
  const [pageLoading, setPageLoading] = useState(true);

  const currentLocksRef = useRef<any[]>([]);
  const abortRef = useRef<AbortController | null>(null);
const paymentCancelledRef = useRef(false);
  const scrollRef       = useRef<ScrollView>(null);
   const days            = useMemo(() => getNextDays(), [turf]);

  // After midnight on a late-night turf, "today" is still last night → select it
  useEffect(() => {
    if (!turf) return;
    const first = getNextDays()[0];
    if (first.toDateString() !== new Date().toDateString()) setSelectedDate(first);
  }, [turf]);

  const fromPanelAnim = useRef(new Animated.Value(0)).current;
  const toPanelAnim   = useRef(new Animated.Value(0)).current;
  const [refreshing, setRefreshing] = useState(false);

  const [pcoinBalance,  setPcoinBalance]  = useState<number>(0);
  const [vcoinBalance,  setVcoinBalance]  = useState<number>(0);
  const [vcoinEnabled,  setVcoinEnabled]  = useState<boolean>(false);
  const [vcoinRate,     setVcoinRate]     = useState<number>(0);

    const [usePcoins,     setUsePcoins]     = useState(false); // toggle
  const [useVcoins,     setUseVcoins]     = useState(false); // toggle
  const [pcoinToUse,    setPcoinToUse]    = useState(0);     // how many PCoin to use
  const [vcoinToUse,    setVcoinToUse]    = useState(0);     // how many VCoin to use

  const summaryCardYRef = useRef<number>(0); 
  const insets = useSafeAreaInsets();

  const [promoCode,       setPromoCode]       = useState("");
const [promoApplied,    setPromoApplied]    = useState<{
  promoId: string;
  code: string;
  discount: number;
  description: string;
  finalOnlineAmount: number;
} | null>(null);
const [promoLoading,    setPromoLoading]    = useState(false);
const [promoError,      setPromoError]      = useState("");
const [showPromoModal,  setShowPromoModal]  = useState(false);
const discountAmount = promoApplied?.discount ?? 0;  // ✅ this is fine as-is

// ── Auto-applied venue offer ────────────────────────────────────────────────
// The SERVER decides this (findBestOffer). We only display what it returns, so
// the badge on this screen and the amount Razorpay charges can never disagree.
const [offer, setOffer] = useState<{
  offerId: string;
  title: string;
  discount: number;
  description?: string;
} | null>(null);
const [offerLoading, setOfferLoading] = useState(false);
const offerDiscount = offer?.discount ?? 0;

// ── This turf's offers for the next 7 days (banner, date tags, slot tags) ──
// Display only — the server still decides the real discount at payment.
type TurfOffer = {
  offerId: string; title: string; tag?: string; type: "flat" | "percent"; value: number;
  maxDiscount?: number; minBookingAmount?: number; targetSlots?: string[]; runsOn?: string[];
  firstBookingOnly?: boolean;
};
const [turfOffers, setTurfOffers] = useState<TurfOffer[]>([]);
useEffect(() => {
  let alive = true;
  (async () => {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(`https://bookora-backend-95u4.onrender.com/active-offers?turfId=${encodeURIComponent(String(id))}&days=7`, { signal: controller.signal });
      clearTimeout(timer);
      const data = await res.json();
      if (alive) setTurfOffers(Array.isArray(data?.offers) ? data.offers : []);
    } catch { /* badges are optional */ }
  })();
  return () => { alive = false; };
}, [id]);

const [showBilling, setShowBilling] = useState(false);
 
// ── Price Details modal ──
const [showPriceInfo, setShowPriceInfo] = useState(false);
const [priceTab,      setPriceTab]      = useState<DayType>("weekday");

const [promoFocused, setPromoFocused] = useState(false);
const [kbHeight, setKbHeight] = useState(0);
const [userCoords, setUserCoords] = useState<{ lat: number; lng: number } | null>(null);
// ── Live login state: number is hidden until the user logs in ──
const [isLoggedIn, setIsLoggedIn] = useState<boolean>(!!auth.currentUser);
useEffect(() => {
  const unsub = onAuthStateChanged(auth, (u) => setIsLoggedIn(!!u));
  return unsub;
}, []);

// ── 🌙 Night quiet hours: booking number hidden 10 PM – 7 AM ──
// So turf owners don't get late-night calls. Re-checked every minute, so the
// number hides/shows by itself if the page stays open.
const [nowHour, setNowHour] = useState<number>(new Date().getHours());
useEffect(() => {
  const t = setInterval(() => setNowHour(new Date().getHours()), 60_000);
  return () => clearInterval(t);
}, []);
const callsQuiet = nowHour >= CALL_QUIET_FROM || nowHour < CALL_QUIET_TO;

useEffect(() => {
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  getDoc(doc(db, "users", uid)).then((snap) => {
    if (snap.exists()) {
      const d = snap.data();
      if (d.latitude != null && d.longitude != null) {
        setUserCoords({ lat: d.latitude, lng: d.longitude });
      }
    }
  }).catch(() => {});
}, []);

const distance = useMemo(() => {
  if (!userCoords || turf?.latitude == null || turf?.longitude == null) return null;
  return fmtDist(haversine(userCoords.lat, userCoords.lng, turf.latitude, turf.longitude));
}, [userCoords, turf]);




  function animatePanel(panel: "from" | "to", open: boolean) {
    const anim = panel === "from" ? fromPanelAnim : toPanelAnim;
    Animated.timing(anim, { toValue: open ? 1 : 0, duration: 250, useNativeDriver: false }).start();
  }

  useEffect(() => { loadPage(); }, [id]);
  useEffect(() => { if (id) refreshAvailability(); }, [id, selectedDate]);
  useEffect(() => { clearSelection(); }, [selectedDate, bookingMode]);
    // ── Owner-chosen booking styles: jump to whichever is allowed ──
  useEffect(() => {
    if (!turf) return;
    const flexOn  = turf.flexibleSlotsEnabled !== false;
    const quickOn = turf.quickSlotsEnabled !== false;
    if (!flexOn && bookingMode === "flexible") setBookingMode("quick");
    if (!quickOn && bookingMode === "quick")   setBookingMode("flexible");
  }, [turf]);
  useEffect(() => {
    return () => {
      if (currentLocksRef.current.length > 0) {
        unlockSlots(currentLocksRef.current);
        currentLocksRef.current = [];
      }
    };
  }, []);
  // ── Reload when screen comes back into focus ──────────────────────────────
useFocusEffect(
  useCallback(() => {
    refreshAvailability();
  }, [selectedDate, id])
);

// ── Auto-reload every 30s while screen is visible ────────────────────────


useEffect(() => {
  const showSub = Keyboard.addListener(
    Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow",
    (e) => setKbHeight(e.endCoordinates.height)
  );
  const hideSub = Keyboard.addListener(
    Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide",
    () => setKbHeight(0)
  );
  return () => { showSub.remove(); hideSub.remove(); };
}, []);

useEffect(() => {
  setPromoApplied(null);
  setPromoCode("");
  setPromoError("");
}, [bookingType]);

useEffect(() => {
  if (showBilling) return;            // don't poll while checking out
  const interval = setInterval(() => { refreshAvailability(); }, 30000);
  return () => clearInterval(interval);
}, [selectedDate, id, showBilling]);

 useEffect(() => {
    const fetchCoinData = async () => {
      const uid    = auth.currentUser?.uid;
      const turfId = String(id);
      if (!uid || !turfId) return;
 
      try {
        // 1. PCoin wallet balance
        const pcSnap = await getDoc(doc(db, "pcoinWallets", uid));
        if (pcSnap.exists()) {
          setPcoinBalance(Number(pcSnap.data().balance || 0));
        }
 
        // 2. VCoin wallet for THIS specific turf only
        const vcSnap = await getDoc(doc(db, "vcoinWallets", `${uid}_${turfId}`));
        if (vcSnap.exists()) {
          setVcoinBalance(Number(vcSnap.data().balance || 0));
        }
 
        // 3. VCoin config from turf doc (vcoinEnabled + vcoinRate)
        // Note: fetchTurf() already loads the turf doc into state,
        // but we need these fields separately for coin logic
        const turfSnap = await getDoc(doc(db, "turfs", turfId));
        if (turfSnap.exists()) {
          const td = turfSnap.data();
          setVcoinEnabled(!!td.vcoinEnabled);
          setVcoinRate(Number(td.vcoinRatePerHour || td.vcoinRate || 0));
        }
      } catch (e) {
        // fail silently — coin UI is optional, booking still works
        console.log("Coin fetch error:", e);
      }
    };
 
    fetchCoinData();
  }, [id]);


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

   // ── Helpers ───────────────────────────────────────────────────────────────────
  // ── Late-night helpers ──
  function turfClose(): number {                       // 24 = midnight, 26 = 2 AM next day
    if (turf?.closingTime === 0) return 24;
    return Number(turf?.closingTime ?? 24);
  }
  function turfOpen(): number { return Number(turf?.openingTime || 0); }

  // "1:00 AM" on a turf open 6 AM–2 AM means 25 (late night), not 1
  function toTurfHour(v: number): number {
    return turfClose() > 24 && v < turfOpen() ? v + 24 : v;
  }

  // Late-night (after 12 AM) booking closed for the selected day?
  function isLateClosed(): boolean {
    const cutoff = Number(turf?.lateCutoffHours || 0);
    if (!cutoff || turfClose() <= 24) return false;
    const deadline = new Date(selectedDate);
    deadline.setHours(24 - cutoff, 0, 0, 0);
    return Date.now() >= deadline.getTime();
  }

  function getNextDays(): Date[] {
    // Between 12 AM and late close, last night is still bookable → start from yesterday
    const now   = new Date();
    const cur   = now.getHours() + now.getMinutes() / 60;
    const start = turfClose() > 24 && cur < turfClose() - 24 ? -1 : 0;
    return Array.from({ length: 5 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() + start + i);
      return d;
    });
  }

  function formatTime(value: number): string {
    if (value >= 24) value -= 24;                      // 24.5 → "12:30 AM", 25 → "1:00 AM"
    if (value === 0) return "12:00 AM";
    const hour        = Math.floor(value);
    const minute      = Math.round((value % 1) * 60);
    const suffix      = hour >= 12 ? "PM" : "AM";
    const displayHour = hour % 12 === 0 ? 12 : hour % 12;
    return `${displayHour}:${minute === 0 ? "00" : String(minute).padStart(2, "0")} ${suffix}`;
  }

  function formatFullDate(date: Date) {
    return date.toLocaleDateString("en-US", {
      weekday: "long", day: "numeric", month: "long", year: "numeric",
    });
  }

  function isToday(date: Date) {
    return date.toDateString() === new Date().toDateString();
  }

  function getCurrentDecimalTime() {
    const now = new Date();
    return now.getHours() + now.getMinutes() / 60;
  }

   function isPastTime(startValue: number) {
    const now = new Date();
    const cur = now.getHours() + now.getMinutes() / 60;
    const sel = selectedDate.toDateString();
    if (sel === now.toDateString()) return startValue < cur;
    const y = new Date(now); y.setDate(now.getDate() - 1);
    if (sel === y.toDateString()) return startValue < cur + 24;   // last night, after 12 AM
    return false;                                                   // future date
  }

  function parseDisplayTime(time: string): number {
    const parts  = time.trim().split(" ");
    const [hourRaw, minuteRaw] = parts[0].split(":");
    let hour     = Number(hourRaw);
    const minute = Number(minuteRaw || 0);
    const period = (parts[1] || "").toUpperCase();
    if (period === "PM" && hour !== 12) hour += 12;
    if (period === "AM" && hour === 12) hour  = 0;
    return hour + minute / 60;
  }

   function parseSlotRange(slotTime: string): { start: number; end: number } {
    const parts = slotTime.split(" - ").map((v) => v.trim());
    if (parts.length < 2) return { start: 0, end: 0 };
    const startValue = toTurfHour(parseDisplayTime(parts[0]));
    let   endValue   = toTurfHour(parseDisplayTime(parts[1]));
    if (endValue <= startValue) endValue = 24;
    return { start: startValue, end: endValue };
  }

  function rangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number) {
    return aStart < bEnd && bStart < aEnd;
  }

  function buildTimeRange(start: number, end: number): string[] {
         const safeEnd = Math.min(end, turfClose());
    const ranges: string[] = [];
    for (let time = start; time < safeEnd; time += 0.5) {
      const next = Math.min(time + 0.5, safeEnd);
      ranges.push(`${formatTime(time)} - ${formatTime(next)}`);
    }
    return ranges;
  }

 // Mon–Fri = weekday, Sat/Sun = weekend (same rule as the server)
  function getDayTypeFor(date: Date): DayType {
    const d = date.getDay(); // 0 = Sun, 6 = Sat
    return d === 0 || d === 6 ? "weekend" : "weekday";
  }
 
  // Looks up the Advance Pricing slab for this time on this date.
  // Falls back to the normal Day/Night price when Advance Pricing is OFF,
  // or when no time block covers this hour — identical to the server.
  function getRateForTime(time: number, date: Date = selectedDate) {
    if (!turf) return 0;
    if (turf.advancePricingEnabled === true) {
      const slabs = turf.priceSlabs?.[getDayTypeFor(date)];
      if (Array.isArray(slabs) && slabs.length > 0) {
                const h   = time >= 24 ? time - 24 : time;                 // 1 AM next day → hour 1
        const hit = slabs.find((s) => h >= Number(s.start) && h < Number(s.end));
        if (hit) {
          const r = Number(hit.rate);
          if (!isNaN(r) && r >= 0) return r;
        }
      }
    }
    if (time >= 6 && time < 18) return Number(turf.dayPrice   || turf.price || 0);
    return                             Number(turf.nightPrice || turf.price || 0);
  }

  function getRangePrice(start: number, end: number): number {
    const safeEnd = Math.min(end, turfClose());
    if (safeEnd <= start) return 0;
    let total = 0;
    for (let time = start; time < safeEnd; time += 0.5) {
      const next     = Math.min(time + 0.5, safeEnd);
      const segLabel = `${formatTime(time)} - ${formatTime(next)}`;
      const special  = specialPrices.find((s) => String(s.slotTime).trim() === segLabel.trim());
      if (special) {
        total += Number(special.price);
      } else {
        total += getRateForTime(time) * (next - time);
      }
    }
    return Math.round(total);
  }

  function isRangeUnavailable(start: number, end: number) {
    if (end > 24 && isLateClosed()) return true;          // late-night booking window closed
    return [...bookedSlots, ...lockedSlots].some((slotTime) => {
      try {
        const parsed = parseSlotRange(slotTime);
        return rangesOverlap(start, end, parsed.start, parsed.end);
      } catch { return false; }
    });
  }

function getFacilityIcon(facility: string): keyof typeof MaterialCommunityIcons.glyphMap {
  const item = facility.toLowerCase();
  if (item.includes("parking"))                       return "parking";
  if (item.includes("car"))                           return "car";
  if (item.includes("bike"))                          return "motorbike";
  if (item.includes("washroom") || item.includes("toilet")) return "toilet";
  if (item.includes("cafe"))                          return "coffee";
  if (item.includes("food"))                          return "food";
  if (item.includes("drinking") || item.includes("water")) return "water";
  if (item.includes("seating"))                       return "seat";
  if (item.includes("locker"))                        return "locker";
  if (item.includes("wifi"))                          return "wifi";
  if (item.includes("light"))                         return "lightbulb-on";
  if (item.includes("changing"))                      return "tshirt-crew";
  if (item.includes("shower"))                        return "shower";
  if (item.includes("first") || item.includes("aid")) return "medical-bag";
  if (item.includes("cctv") || item.includes("security")) return "cctv";
  return "check-circle";
}

  // ── Computed ──────────────────────────────────────────────────────────────────
  const openingTime  = useMemo(() => Number(turf?.openingTime || 0), [turf]);
  const closingTime  = useMemo(() => {
    if (turf?.closingTime === 0) return 24;
    return Number(turf?.closingTime ?? 24);
  }, [turf]);
  const slotDuration = useMemo(() => Number(turf?.slotDuration || 60), [turf]);

  const STEP = 0.5;

  const allTimePoints = useMemo<SlotChip[]>(() => {
    if (!turf) return [];
    const chips: SlotChip[] = [];
    for (let t = openingTime; t < closingTime; t += STEP) {
      if (isPastTime(t)) continue;
      let status: SlotChip["status"] = "available";
      const isBooked = bookedSlots.some((s) => {
        if (s === `${formatTime(t)} - ${formatTime(Math.min(t + STEP, closingTime))}`) return true;
        try { const p = parseSlotRange(s); return rangesOverlap(t, t + STEP, p.start, p.end); }
        catch { return false; }
      });
      const isLocked = lockedSlots.some((s) => {
        try { const p = parseSlotRange(s); return rangesOverlap(t, t + STEP, p.start, p.end); }
        catch { return false; }
      });
            if (t >= 24 && isLateClosed()) status = "outside";   // shows "Closed"
      else if (isBooked)  status = "booked";
      else if (isLocked)  status = "locked";
      chips.push({ value: t, label: formatTime(t), status });
    }
    return chips;
  }, [turf, openingTime, closingTime, bookedSlots, lockedSlots, selectedDate]);

  const fromChips = useMemo<SlotChip[]>(() => allTimePoints, [allTimePoints]);

    // FROM chips split into Morning / Afternoon / Evening / Night (empty parts hidden)
  const fromGroups = useMemo(() =>
    DAY_PARTS.map((p) => {
      const chips = fromChips.filter((c) => c.value >= p.from && c.value < p.to);
      const free  = chips.filter((c) => c.status === "available").length;
      return { ...p, chips, free };
    }).filter((g) => g.chips.length > 0),
  [fromChips]);

  const visibleFromChips = useMemo(
    () => fromGroups.find((g) => g.key === fromPart)?.chips ?? [],
    [fromGroups, fromPart]
  );

  // Open on the part with the next free start time (re-checked on date change)
  useEffect(() => {
    if (fromGroups.length === 0) return;
    const firstFree = fromGroups.find((g) => g.free > 0) ?? fromGroups[0];
    if (!fromGroups.some((g) => g.key === fromPart && g.free > 0)) setFromPart(firstFree.key);
  }, [selectedDate, fromGroups.map((g) => `${g.key}:${g.free}`).join("|")]);
  const toChips = useMemo<SlotChip[]>(() => {
    if (flexStart === null) return [];
    const chips: SlotChip[] = [];
    const minEnd = flexStart + MIN_BOOKING_HOURS;
    const maxEnd = flexStart + MAX_BOOKING_HOURS;
    for (let t = minEnd; t <= closingTime && t <= maxEnd; t += STEP) {
      if (isRangeUnavailable(flexStart, t)) break;
      chips.push({ value: t, label: formatTime(t), status: "available" });
    }
    return chips;
  }, [flexStart, closingTime, bookedSlots, lockedSlots, selectedDate]);

  const selectedStartValue = useMemo(() => {
    if (bookingMode === "quick" && selectedQuickSlots.length > 0)
      return Math.min(...selectedQuickSlots.map((s) => s.startValue));
    return flexStart;
  }, [bookingMode, selectedQuickSlots, flexStart]);

  const selectedEndValue = useMemo(() => {
    if (bookingMode === "quick" && selectedQuickSlots.length > 0)
      return Math.max(...selectedQuickSlots.map((s) => s.endValue));
    return flexEnd;
  }, [bookingMode, selectedQuickSlots, flexEnd]);

  const durationMinutes = useMemo(() => {
    if (selectedStartValue === null || selectedEndValue === null ||
        selectedEndValue <= selectedStartValue || selectedEndValue > closingTime) return 0;
    return Math.round((selectedEndValue - selectedStartValue) * 60);
  }, [selectedStartValue, selectedEndValue]);

  const selectedSlots = useMemo(() => {
    if (selectedStartValue === null || selectedEndValue === null ||
        selectedEndValue <= selectedStartValue || selectedEndValue > closingTime ||
        durationMinutes > MAX_BOOKING_HOURS * 60) return [];
    return buildTimeRange(selectedStartValue, selectedEndValue);
  }, [selectedStartValue, selectedEndValue, durationMinutes]);

  const selectedTimeLabel = useMemo(() => {
    if (selectedStartValue === null || selectedEndValue === null ||
        selectedEndValue <= selectedStartValue || selectedEndValue > closingTime) return "";
    return `${formatTime(selectedStartValue)} → ${formatTime(selectedEndValue)}`;
  }, [selectedStartValue, selectedEndValue]);

  const durationLabel = useMemo(() => {
    const hours   = Math.floor(durationMinutes / 60);
    const minutes = durationMinutes % 60;
    if (!hours)   return `${minutes} min`;
    if (!minutes) return `${hours} ${hours === 1 ? "Hour" : "Hours"}`;
    return `${hours} hr ${minutes} min`;
  }, [durationMinutes]);

  const totalPrice = useMemo(() => {
    if (selectedStartValue === null || selectedEndValue === null ||
               selectedEndValue <= selectedStartValue || selectedEndValue > closingTime) return 0;
    return getRangePrice(selectedStartValue, selectedEndValue);
  }, [selectedStartValue, selectedEndValue, specialPrices, turf]);

// ✅ NEW: Always shows the advance price (ignores bookingType selection)
// Used in the payment selector card so user sees correct ₹750 even before tapping
const computedAdvanceAmount = useMemo(() => {
  const baseBookingPrice = Number(turf?.bookingPrice || 0);
  const selectedHours = durationMinutes / 60;

  if (selectedHours > ADVANCE_THRESHOLD_HOURS) {
    return Math.round(baseBookingPrice * ADVANCE_MULTIPLIER);
  }

  return baseBookingPrice;
}, [turf, durationMinutes]);

// Venue offer (Option A): comes off the TOTAL. The advance stays the same;
// the player pays less at the turf. (Same rule as the server's /create-order.)
const offerTotal = useMemo(() => Math.max(totalPrice - offerDiscount, 0), [totalPrice, offerDiscount]);

// Used for actual payment — depends on what the user selected
const advanceAmount = useMemo(() => {
  if (bookingType === "full") return offerTotal;
  return Math.min(computedAdvanceAmount, offerTotal);
}, [bookingType, offerTotal, computedAdvanceAmount]);

  

  const remainingAmount = useMemo(() => {
    if (bookingType === "full") return 0;
    return Math.max(offerTotal - advanceAmount, 0);
  }, [bookingType, offerTotal, advanceAmount]);

 const coinDiscountAmount = useMemo(() => {
    return (usePcoins ? pcoinToUse : 0) + (useVcoins ? vcoinToUse : 0);
  }, [usePcoins, useVcoins, pcoinToUse, vcoinToUse]);
 
    const finalAdvanceAmount = useMemo(() => {
    // Only one of discountAmount / offerDiscount is ever non-zero — an offer
    // blocks promo codes — but subtract both so the number can't drift if that
    // ever changes.
    // The offer is already inside advanceAmount/remainingAmount (Option A),
    // so only promo + coins come off the online payment here.
    return Math.max(advanceAmount - discountAmount - coinDiscountAmount, 1);
  }, [advanceAmount, discountAmount, coinDiscountAmount]);

  const quickSlots = useMemo<TimeRange[]>(() => {
    if (!turf) return [];
    const generated: TimeRange[] = [];
    const duration = slotDuration / 60;
    for (let time = openingTime; time + duration <= closingTime; time += duration) {
      if (isPastTime(time)) continue;
      generated.push({
        time:       `${formatTime(time)} - ${formatTime(time + duration)}`,
        startValue: time,
        endValue:   time + duration,
      });
    }
    return generated;
  }, [turf, openingTime, closingTime, slotDuration, selectedDate]);

    // Quick slots split into Morning / Afternoon / Evening / Night (empty parts hidden)
  const quickGroups = useMemo(() =>
    DAY_PARTS.map((p) => {
      const slots = quickSlots.filter((s) => s.startValue >= p.from && s.startValue < p.to);
      const free  = slots.filter((s) => !isRangeUnavailable(s.startValue, s.endValue)).length;
      return { ...p, slots, free };
    }).filter((g) => g.slots.length > 0),
  [quickSlots, bookedSlots, lockedSlots]);

  const visibleQuickSlots = useMemo(
    () => quickGroups.find((g) => g.key === quickPart)?.slots ?? [],
    [quickGroups, quickPart]
  );

  // Booking sheet: promo / coins rows start collapsed
  const [promoOpen, setPromoOpen] = useState(false);
  const [coinsOpen, setCoinsOpen] = useState(false);
  const sheetScrollRef = useRef<ScrollView>(null);
  const promoYRef      = useRef(0);

  // Railway-board flip for offer slots: time (3s) → offer price (2.2s) → time …
  const quickFlip = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (bookingMode !== "quick") return;
    let loop: Animated.CompositeAnimation | null = null;
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
      if (reduce || cancelled) return;
      quickFlip.setValue(0);
      loop = Animated.loop(
        Animated.sequence([
          Animated.delay(3000),
          Animated.timing(quickFlip, { toValue: 1, duration: 320, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
          Animated.delay(2200),
          Animated.timing(quickFlip, { toValue: 2, duration: 320, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
          Animated.timing(quickFlip, { toValue: 0, duration: 0, useNativeDriver: true }),
        ])
      );
      loop.start();
    }).catch(() => {});
    return () => { cancelled = true; loop?.stop(); quickFlip.setValue(0); };
  }, [bookingMode]);

  // Open on the part with the next free slot (re-checked on date change)
  useEffect(() => {
    if (quickGroups.length === 0) return;
    const firstFree = quickGroups.find((g) => g.free > 0) ?? quickGroups[0];
    if (!quickGroups.some((g) => g.key === quickPart && g.free > 0)) setQuickPart(firstFree.key);
  }, [selectedDate, quickGroups.map((g) => `${g.key}:${g.free}`).join("|")]);

  const hasValidSelection =
    selectedStartValue !== null &&
    selectedEndValue   !== null &&
    selectedEndValue <= closingTime &&
    selectedEndValue > selectedStartValue &&
    durationMinutes <= MAX_BOOKING_HOURS * 60 &&
    durationMinutes  > 0 &&
    !isPastTime(selectedStartValue) &&
    !isRangeUnavailable(selectedStartValue, selectedEndValue);

      // ── Ask the server whether an offer applies to this exact selection ───────
  // Debounced: slot chips fire fast and this is a network call.
  useEffect(() => {
    let alive = true;

    if (!hasValidSelection || totalPrice <= 0) {
      setOffer(null);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        setOfferLoading(true);
        const res = await fetch("https://bookora-backend-95u4.onrender.com/best-offer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            turfId:       String(id),
            dateString:   selectedDate.toDateString(),
            selectedSlots,
            onlineAmount: totalPrice,   // same base the server prices against
            userId:       auth.currentUser?.uid || null,   // per-player limits
          }),
        });
        const data = await res.json();
        if (!alive) return;

        setOffer(data?.offer || null);

        // An offer blocks promo codes — drop anything already applied.
        if (data?.offer) {
          setPromoApplied(null);
          setPromoCode("");
          setPromoError("");
          // …and coins: an offer can't be combined with PCoin / VCoin
          setUsePcoins(false);
          setUseVcoins(false);
          setPcoinToUse(0);
          setVcoinToUse(0);
        }
      } catch {
        // A failed offer lookup must NEVER stop someone booking.
        if (alive) setOffer(null);
      } finally {
        if (alive) setOfferLoading(false);
      }
    }, 300);

    return () => { alive = false; clearTimeout(timer); };
  }, [id, selectedDate, selectedSlots.join("|"), totalPrice, hasValidSelection]);

  // ── Turf images ───────────────────────────────────────────────────────────────
   // ── Advance Pricing helpers ───────────────────────────────────────────────────
  const advancePricingOn = useMemo(() =>
    turf?.advancePricingEnabled === true &&
    ((turf?.priceSlabs?.weekday?.length ?? 0) > 0 ||
     (turf?.priceSlabs?.weekend?.length ?? 0) > 0),
  [turf]);
 
  const sortedSlabs = useMemo(() => {
    const pick = (arr?: PriceSlab[]) =>
      Array.isArray(arr) ? [...arr].sort((a, b) => Number(a.start) - Number(b.start)) : [];
    return {
      weekday: pick(turf?.priceSlabs?.weekday),
      weekend: pick(turf?.priceSlabs?.weekend),
    };
  }, [turf]);
 
  const slabRange = useMemo(() => {
    const rng = (arr: PriceSlab[]) =>
      arr.length
        ? { min: Math.min(...arr.map((s) => Number(s.rate))),
            max: Math.max(...arr.map((s) => Number(s.rate))) }
        : null;
    return { weekday: rng(sortedSlabs.weekday), weekend: rng(sortedSlabs.weekend) };
  }, [sortedSlabs]);
 
  function openPriceInfo() {
    setPriceTab(getDayTypeFor(selectedDate));
    setShowPriceInfo(true);
  }
 
  // ── Turf images ───────────────────────────────────────────────────────────────
  const turfImages = useMemo(() => {
    if (Array.isArray(turf?.images) && turf!.images!.length > 0) return turf!.images!;
    if (turf?.image) return [turf.image];
    return [FALLBACK_IMAGE];
  }, [turf]);

  // ── Rating ────────────────────────────────────────────────────────────────────
  const ratingValue = useMemo(() => {
    if (!turf?.rating) return null;
    const r = parseFloat(String(turf.rating));
    return !isNaN(r) && r > 0 ? r.toFixed(1) : null;
  }, [turf]);

  // ── Data Fetching ─────────────────────────────────────────────────────────────
  async function loadPage() {
    try {
      setPageLoading(true);
      await Promise.all([fetchTurf(), refreshAvailability()]);
    } catch (e) { console.log("Page load error:", e); }
    finally { setPageLoading(false); }
  }

  async function fetchTurf() {
    const docSnap = await getDoc(doc(db, "turfs", String(id)));
    if (docSnap.exists()) setTurf({ id: docSnap.id, ...docSnap.data() } as Turf);
  }

  async function refreshAvailability() {
    await Promise.all([fetchBookings(), fetchSpecialPrices()]);
  }

  async function fetchBookings() {
    const dateStr = selectedDate.toDateString();
    const [bookingSnap, blockSnap, lockSnap] = await Promise.all([
      getDocs(query(collection(db, "bookings"),     where("turfId", "==", String(id)), where("dateString", "==", dateStr))),
      getDocs(query(collection(db, "blockedSlots"), where("turfId", "==", String(id)), where("date",       "==", dateStr))),
      getDocs(query(collection(db, "slotLocks"),    where("turfId", "==", String(id)), where("dateString", "==", dateStr))),
    ]);

    const booked = bookingSnap.docs
      .map((d) => d.data())
      .filter((b) => b.status !== "cancelled")
      .flatMap((b) => b.selectedSlots || []);

    const blocked = blockSnap.docs.flatMap((d) => {
      const raw = d.data();
      if (Array.isArray(raw.slots) && raw.slots.length > 0) return raw.slots;
      if (raw.slotTime) return [raw.slotTime];
      return [];
    });

    const now = new Date();
    const validLocks: string[] = [];
    const expiredRefs: any[]   = [];

    lockSnap.docs.forEach((docSnap) => {
      const data = docSnap.data();
      if (new Date(data.expiresAt) > now) validLocks.push(data.slotTime);
      else expiredRefs.push(docSnap.ref);
    });

    await Promise.all(expiredRefs.map((ref) => deleteDoc(ref)));
    setBookedSlots([...booked, ...blocked]);
    setLockedSlots(validLocks);
  }

  async function fetchSpecialPrices() {
    const snap = await getDocs(
      query(collection(db, "specialPrices"), where("turfId", "==", String(id)), where("date", "==", selectedDate.toDateString()))
    );
    setSpecialPrices(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  }

  // ── Flexible picker handlers ──────────────────────────────────────────────────
  function handleOpenFrom() {
    setActivePanel("from");
    animatePanel("from", true);
    animatePanel("to", false);
  }

  function handleOpenTo() {
    if (flexStart === null) { Alert.alert("Select Start Time", "Please select a FROM time first."); return; }
    setActivePanel("to");
    animatePanel("to", true);
    animatePanel("from", false);
  }

  function handleSelectFrom(chip: SlotChip) {
    if (chip.status !== "available") return;
    setFlexStart(chip.value);
    setFlexEnd(null);
    setActivePanel("to");
    animatePanel("from", false);
    animatePanel("to", true);
  }

  function handleSelectTo(chip: SlotChip) {
    if (chip.status !== "available") return;
    setFlexEnd(chip.value);
    setActivePanel(null);
    animatePanel("to", false);
  }

  function clearSelection() {
    setSelectedQuickSlots([]);
    setFlexStart(null);
    setFlexEnd(null);
    setActivePanel(null);
    animatePanel("from", false);
    animatePanel("to", false);
       setPromoApplied(null);
    setPromoCode("");
    setPromoError("");
    setOffer(null);
     setUsePcoins(false);
    setUseVcoins(false);
    setPcoinToUse(0);
    setVcoinToUse(0);   
  }

  function handleQuickSlotSelect(slot: TimeRange) {
    const exists = selectedQuickSlots.some((s) => s.time === slot.time);
    if (exists) {
      setSelectedQuickSlots(selectedQuickSlots.filter((s) => s.time !== slot.time).sort((a, b) => a.startValue - b.startValue));
      return;
    }
    if (selectedQuickSlots.length === 0) { setSelectedQuickSlots([slot]); return; }
    const sorted = [...selectedQuickSlots].sort((a, b) => a.startValue - b.startValue);
    const first  = sorted[0];
    const last   = sorted[sorted.length - 1];
    const EPS    = 0.01;
    const canAddBefore = Math.abs(slot.endValue   - first.startValue) < EPS;
    const canAddAfter  = Math.abs(slot.startValue - last.endValue)    < EPS;
    if (!canAddBefore && !canAddAfter) {
      Alert.alert("Continuous Slots Only", "You can only select the slot immediately before or after your current selection.");
      return;
    }
  if (selectedQuickSlots.length >= MAX_BOOKING_HOURS) {
  Alert.alert(
    "Maximum Limit", 
    `You can book maximum ${MAX_BOOKING_HOURS} slots at a time.`
  );
  return;
}
    setSelectedQuickSlots([...selectedQuickSlots, slot].sort((a, b) => a.startValue - b.startValue));
  }

  // ── Validation ────────────────────────────────────────────────────────────────
  function validateSelection(showAlert = true) {
    if (selectedStartValue === null) { if (showAlert) Alert.alert("Select Start Time", "Please select a start time first."); return false; }
    if (selectedEndValue === null)   { if (showAlert) Alert.alert("Select End Time", "Please select an end time."); return false; }
        if (selectedEndValue > closingTime) { if (showAlert) Alert.alert("Invalid Time", `Booking cannot go beyond ${formatTime(closingTime)}.`); return false; }
    if (selectedEndValue <= selectedStartValue) { if (showAlert) Alert.alert("Invalid Time Selection", "End time must be after start time."); return false; }
    if (durationMinutes > MAX_BOOKING_HOURS * 60) { if (showAlert) Alert.alert("Booking Limit Exceeded", `Maximum ${MAX_BOOKING_HOURS} hours allowed.`); return false; }
    if (selectedStartValue < openingTime || selectedEndValue > closingTime) { if (showAlert) Alert.alert("Outside Turf Hours", `Please select between ${formatTime(openingTime)} and ${formatTime(closingTime)}`); return false; }
    if (isPastTime(selectedStartValue)) { if (showAlert) Alert.alert("Time Over", "This slot has already passed."); return false; }
    if (isRangeUnavailable(selectedStartValue, selectedEndValue)) { if (showAlert) Alert.alert("Slot Unavailable", "This slot overlaps with an already booked slot."); return false; }
    return true;
  }

  // ── Promo code ───────────────────────────────────────────────────────────────
    const applyPromo = async () => {
    if (offer) {
      Alert.alert(
        "Offer already applied",
        `"${offer.title}" is already applied to this slot. Venue offers can't be combined with promo codes.`
      );
      return;
    }
    if (!promoCode.trim()) return;
    if (!auth.currentUser?.uid) return;
    if (!hasValidSelection) {
      Alert.alert("Select Slot First", "Please select a time slot before applying a promo code.");
      return;
    }
    setPromoLoading(true);
    setPromoError("");
    try {
      const res = await fetch("https://bookora-backend-95u4.onrender.com/validate-promo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
  code:          promoCode.trim().toUpperCase(),
  userId:        auth.currentUser.uid,
  turfId:        String(id),
  onlineAmount:  totalPrice,         // see note — was advanceAmount
  bookingType,
  dateString:    selectedDate.toDateString(),
  selectedSlots: selectedSlots,
}),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setPromoError(data.error || "Invalid promo code");
        setPromoApplied(null);
        return;
      }
      setPromoApplied({
        promoId:          data.promoId,
        code:             data.code,
        discount:         data.discount,
        description:      data.description,
        finalOnlineAmount: data.finalOnlineAmount,
      });
      setPromoError("");
        setShowPromoModal(true); 
    } catch {
      setPromoError("Could not validate. Try again.");
    } finally {
      setPromoLoading(false);
    }
  };

  const removePromo = () => {
    setPromoApplied(null);
    setPromoCode("");
    setPromoError("");
     setShowPromoModal(false); // ← ADD THIS
  };
  // ── Share ─────────────────────────────────────────────────────────────────────
 

  // ── Payment ───────────────────────────────────────────────────────────────────
  async function lockSlots(): Promise<any[]> {
    const dateStr   = selectedDate.toDateString();
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + 5);
    const locks: any[] = [];
    for (const time of selectedSlots) {
      const existingLock = await getDocs(
        query(collection(db, "slotLocks"),
          where("turfId",     "==", String(id)),
          where("dateString", "==", dateStr),
          where("slotTime",   "==", time)
        )
      );
      const alreadyLocked = existingLock.docs.some((d) => new Date(d.data().expiresAt) > new Date());
      if (alreadyLocked) throw new Error(`Slot ${time} is already locked`);
      const ref = await addDoc(collection(db, "slotLocks"), {
        turfId: String(id), slotTime: time, dateString: dateStr,
        userId: auth.currentUser?.uid, bookingType, bookingMode,
        expiresAt: expiresAt.toISOString(), createdAt: new Date(),
      });
      locks.push(ref);
    }
    return locks;
  }

  async function unlockSlots(locks: any[]) {
    await Promise.all(locks.map((ref) => deleteDoc(ref).catch((e) => console.log("Unlock error:", e))));
    await refreshAvailability();
  }

  async function handlePayment() {
    if (!auth.currentUser?.uid) return Alert.alert("Login required", "Please login to book a slot.");
    if (!validateSelection(true)) return;
    setLoading(true);
    let locks: any[] = [];

     try {
      locks = await lockSlots();
      currentLocksRef.current = locks;

      const controller = new AbortController();
      abortRef.current = controller;
      const timeout    = setTimeout(() => controller.abort(), 100000);

      const response = await fetch("https://bookora-backend-95u4.onrender.com/create-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
       body: JSON.stringify({
          turfId: String(id), turfName: turf!.name, location: turf!.location,
          ownerName: turf!.ownerName || "", mapLink: turf!.mapLink || "",
          slots: selectedSlots, dateString: selectedDate.toDateString(),
          selectedDate: selectedDate.toISOString(), totalAmount: totalPrice,
          advanceAmount: finalAdvanceAmount,  // ← use discounted amount
          remainingAmount, userId: auth.currentUser?.uid,
          bookingMode, bookingType,
          startTime: formatTime(selectedStartValue!),
          endTime:   formatTime(selectedEndValue!),
          promoId:   promoApplied?.promoId   || null,  // ← ADD
          promoCode: promoApplied?.code      || null,  // ← ADD
          discount:  promoApplied?.discount  || 0,    
           usePcoins:   usePcoins ? pcoinToUse : 0,
          useVcoins:   useVcoins ? vcoinToUse : 0, // ← ADD
        }),
      });

      clearTimeout(timeout);
      if (!response.ok) { const text = await response.text(); throw new Error(text || "Server error"); }

      const order = await response.json();
      if (!order?.orderId) throw new Error(order?.error || "Order creation failed");

       if (paymentCancelledRef.current) {
        await unlockSlots(currentLocksRef.current);
        currentLocksRef.current = [];
        setLoading(false);
        return;
      }

      const options = {
        description: `Booking - ${turf!.name}`,
        image:       turfImages[0] || FALLBACK_IMAGE,
        currency:    order.currency,
        key:         order.key,
        amount:      order.amount,
        name:        "Playon",
        order_id:    order.orderId,
        prefill:     { email: auth.currentUser?.email || "" },
        theme:       { color: "#111111" },
      };

      RazorpayCheckout.open(options)
        .then(async (data: any) => {
          try {
            const verifyRes = await fetch("https://bookora-backend-95u4.onrender.com/verify-payment", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                order_id:   data.razorpay_order_id,
                payment_id: data.razorpay_payment_id,
                signature:  data.razorpay_signature,
              }),
            });
            let verifyData;
            try { verifyData = await verifyRes.json(); }
            catch { throw new Error("Invalid verify response from server"); }

           if (verifyData.success) {
  await unlockSlots(currentLocksRef.current);
  currentLocksRef.current = [];
  clearSelection();
  await refreshAvailability();
  Alert.alert(
    "🎉 Booking Confirmed!",
    `Your slot at ${turf!.name} on ${selectedDate.toDateString()} is confirmed.`,
    [
      { text: "View Booking", onPress: () => {
    if (verifyData.bookingId) {
      router.push({ pathname: "/(tabs)/booking-users", params: { id: verifyData.bookingId } });
    } else {
      router.push("/(tabs)/booking-users");
    }
  }
},
    ]
  );
} else if (verifyData.autoRefunded === true) {
  // Slot was blocked/booked after user paid — server auto-refunded
  await unlockSlots(currentLocksRef.current);
  currentLocksRef.current = [];
  await refreshAvailability();
  Alert.alert(
    "Slot No Longer Available",
    "This slot was just blocked by the turf owner.\n\nYour payment of ₹" + 
    (verifyData.refundAmount || "the full amount") + 
    " has been refunded automatically.\n\nIt will reflect in 5–7 business days.",
    [{ text: "OK", onPress: () => router.back() }]
  );
} else if (verifyData.autoRefunded === false) {
  // Slot conflict but refund failed — needs manual support
  await unlockSlots(currentLocksRef.current);
  currentLocksRef.current = [];
  await refreshAvailability();
  Alert.alert(
    "Slot Unavailable",
    "This slot is no longer available.\n\nWe could not process your refund automatically. Please contact support with your payment ID:\n\n" + 
    data.razorpay_payment_id,
    [{ text: "OK" }]
  );
} else {
  throw new Error(verifyData.error || "Payment verification failed");
}

          } catch (verifyError: any) {
            await unlockSlots(currentLocksRef.current);
            currentLocksRef.current = [];
            const msg = verifyError?.message || "";
            if (msg.includes("Invalid verify")) {
              Alert.alert("Verification Failed", "Payment was received but could not be verified. Please contact support with your payment ID.", [{ text: "OK" }]);
            } else {
              Alert.alert("Payment Error", msg || "Something went wrong after payment.", [{ text: "OK" }]);
            }
          } finally {
            setLoading(false);
          }
        })
        .catch(async (error: any) => {
          setLoading(false);
          await unlockSlots(currentLocksRef.current);
          currentLocksRef.current = [];
          const razorpayError = error?.error || {};
          const code    = razorpayError.code        || error?.code        || "";
          const rawDesc = razorpayError.description || error?.description || "";
          const desc    = rawDesc && rawDesc !== "undefined" ? rawDesc : "Payment failed. Please try again.";
          const reason  = razorpayError.reason || "";
          if (code === "PAYMENT_CANCELLED" || desc.toLowerCase().includes("cancel")) {
            Alert.alert("Payment Cancelled", "You cancelled the payment."); return;
          }
          if (code === "NETWORK_ERROR" || desc.toLowerCase().includes("network") || desc.toLowerCase().includes("internet")) {
            Alert.alert("Network Error", "Please check your internet connection and try again."); return;
          }
          if (reason === "payment_error" || code === "BAD_REQUEST_ERROR") {
            Alert.alert("Payment Failed", desc || "Payment authentication failed. Try another payment method."); return;
          }
          Alert.alert("Payment Failed", desc);
        });

    } catch (error: any) {
      setLoading(false);
      await unlockSlots(locks);
      currentLocksRef.current = [];
      if (paymentCancelledRef.current) return; 
      const msg = error?.message || "";
      if (msg.includes("already locked") || msg.includes("already booked")) {
        Alert.alert("Slot Taken", "Someone just booked this slot while you were selecting. Please choose a different time.", [{ text: "OK" }]);
      } else if (msg.includes("abort") || msg.includes("timeout") || msg.includes("network") || msg.toLowerCase().includes("internet")) {
        Alert.alert("Network Error", "Could not reach the server. Please check your internet connection and try again.", [{ text: "OK" }]);
      } else if (msg.includes("Order creation failed") || msg.includes("Server error")) {
        Alert.alert("Server Error", "Could not create your booking order. Please try again in a moment.", [{ text: "OK" }]);
      } else {
        Alert.alert("Error", msg || "Something went wrong. Please try again.", [{ text: "OK" }]);
      }
    }
  }

  async function cancelPaymentInProgress() {
  paymentCancelledRef.current = true;
  abortRef.current?.abort();            // kills the in-flight /create-order fetch
  setLoading(false);
  if (currentLocksRef.current.length > 0) {
    await unlockSlots(currentLocksRef.current);
    currentLocksRef.current = [];
  }
  setShowBilling(false);
  removePromo();
}

function requestCloseBilling() {
  if (loading) {
    Alert.alert(
      "Cancel payment?",
      "Your booking is still being processed. Do you want to cancel it?",
      [
        { text: "Keep waiting", style: "cancel" },
        { text: "Cancel payment", style: "destructive", onPress: cancelPaymentInProgress },
      ]
    );
    return;
  }
  setShowBilling(false);
  removePromo();
}

  function openMap() {
    if (!turf?.mapLink) { Alert.alert("Map unavailable", "No map link available."); return; }
    Linking.openURL(turf.mapLink);
  }


  const onPullRefresh = useCallback(async () => {
  setRefreshing(true);
  try {
    await refreshAvailability();
  } finally {
    setRefreshing(false);
  }
}, [selectedDate, id]);
  // ── Render ────────────────────────────────────────────────────────────────────
  if (pageLoading || !turf) {
    return (
      <View style={styles.loaderWrap}>
        <ActivityIndicator size="large" color="#111111" />
        <Text style={styles.loaderText}>Loading turf...</Text>
      </View>
    );
  }

   const fromPanelHeight = fromPanelAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 280] });
  const toPanelHeight   = toPanelAnim.interpolate(  { inputRange: [0, 1], outputRange: [0, 220] });

  const statusCfg = turf.status ? STATUS_CONFIG[turf.status] : null;
    // ── Admin-set booking mode (missing = old turf = online) ──
  const turfMode   = turf.bookingMode ?? "online";
  const showCall   = turfMode !== "online" && !!turf.bookingPhone;
  const showOnline = turfMode !== "phone" || !showCall; // safety: no number → keep online

  // ── Offer display helpers (online turfs only) ──
  const p2 = (n: number) => String(n).padStart(2, "0");
  const keyOfDate = (d: Date) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
  const offersOn = (d: Date) => (showOnline ? turfOffers.filter((o) => (o.runsOn || []).includes(keyOfDate(d))) : []);
  const offerLabel = (o: TurfOffer) => (o.type === "flat" ? `₹${o.value} OFF` : `${o.value}% OFF`);
  const parseHM = (t: string) => {
    const m = String(t).trim().match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)/i);
    if (!m) return 0;
    let h = Number(m[1]) % 12;
    if (m[3].toUpperCase() === "PM") h += 12;
    return h + Number(m[2] || 0) / 60;
  };
  const inWindows = (o: TurfOffer, start: number, end: number) => {
    const wins = o.targetSlots || [];
    if (!wins.length) return true;
    return wins.some((w) => {
      const [a, b] = String(w).split("-");
      const ws = parseHM(a); let we = parseHM(b || "");
      if (we <= ws) we += 24;
      return (start >= ws && end <= we) || (start >= ws + 24 && end <= we + 24) || (start + 24 >= ws && end + 24 <= we);
    });
  };
  // Best offer covering a slot on the selected date (for the green slot tag)
  const slotOffer = (start: number, end: number) => {
    const list = offersOn(selectedDate).filter((o) => inWindows(o, start, end));
    if (!list.length) return null;
    const worth = (o: TurfOffer) => (o.type === "flat" ? o.value : Math.min(o.value * 10, Number(o.maxDiscount) > 0 ? Number(o.maxDiscount) : Infinity));
    return list.sort((a, b) => worth(b) - worth(a))[0];
  };
  const slotOfferPrice = (o: TurfOffer, price: number) => {
    if (o.type === "flat") return null;           // flat ₹ comes off the booking, not each slot
    const cut = Math.round(price * o.value / 100);
    return Math.max(price - Math.min(cut, Number(o.maxDiscount) > 0 ? Number(o.maxDiscount) : cut), 0);
  };
  const todayOffers = offersOn(selectedDate);
  const bannerOffer = todayOffers[0] || null;
  const upcomingOffer = !bannerOffer && showOnline
    ? turfOffers.find((o) => (o.runsOn || []).some((k) => k > keyOfDate(selectedDate))) || null
    : null;
  const windowsText = (o: TurfOffer) => (o.targetSlots?.length ? o.targetSlots.map((w) => w.replace(/:00/g, "").replace(" - ", "–")).join(", ") : "All day");
 
  // ── Option 1: must be logged in to call / WhatsApp ──
  const requireLogin = (): boolean => {
    if (auth.currentUser) return true;
    Alert.alert(
      "Login required",
      "Please log in to contact this turf.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Log in", onPress: () => router.push("/(auth)/login" as any) },
      ]
    );
    return false;
  };

  // ── Options 2 + 3: log lead + notify owner (fire-and-forget, never blocks the call) ──
  const logCallLead = async (channel: "call" | "whatsapp") => {
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) return;
      fetch("https://bookora-backend-95u4.onrender.com/call-lead", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ turfId: String(id), channel }),
      }).catch(() => {});
    } catch {}
  };

  const quietAlert = () =>
    Alert.alert("Calls open at 7 AM", "To respect the turf owner's rest, the booking number is hidden from 10 PM to 7 AM. Please call after 7 AM.");

  const callTurf = () => {
    if (!requireLogin()) return;
    if (callsQuiet) return quietAlert();
    logCallLead("call");
    Linking.openURL(`tel:${turf.bookingPhone}`);
  };

  const whatsappTurf = () => {
    if (!requireLogin()) return;
    if (callsQuiet) return quietAlert();
    logCallLead("whatsapp");
    const msg = encodeURIComponent(`Hi, I want to book ${turf.name} (found on PlayOn).`);
    Linking.openURL(`https://wa.me/91${turf.bookingPhone}?text=${msg}`).catch(() =>
      Alert.alert("WhatsApp not found", "Please call the number instead.")
    );
  };

  // "9876543210" → "98765 43210"
  // "9876543210" → "98765 43210"  (guests see "98XXX XXXXX")
  const prettyPhone = turf.bookingPhone
    ? isLoggedIn && !callsQuiet          // 🌙 night: masked even for logged-in players
      ? `${turf.bookingPhone.slice(0, 5)} ${turf.bookingPhone.slice(5)}`
      : `${turf.bookingPhone.slice(0, 2)}XXX XXXXX`
    : "";
  // "6:00 AM" → "6 AM"
  const shortTime = (v: number) => formatTime(v).replace(":00", "");

  

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: turf.name }} />
      <StatusBar barStyle="light-content" backgroundColor="#111111" />

      <ScrollView
  ref={scrollRef}
  contentContainerStyle={styles.scrollContent}
  showsVerticalScrollIndicator={false}
  refreshControl={
    <RefreshControl
      refreshing={refreshing}
      onRefresh={onPullRefresh}
      tintColor="#111111"
      colors={["#111111"]}
    />
  }
>

        {/* ── Hero Carousel + dots ── */}
        <View>
          <Carousel
            width={width} height={280}
            data={turfImages}
            onSnapToItem={i => setActiveImageDot(i)}
            renderItem={({ item }) => <Image source={{ uri: item }} style={styles.heroImage} />}
          />
          {turfImages.length > 1 && (
            <View style={styles.dotRow}>
              {turfImages.map((_, i) => (
                <View key={i} style={[styles.dot, activeImageDot === i && styles.dotActive]} />
              ))}
            </View>
          )}

          {/* ── Back Button (iOS safe area aware) ── */}
 <TouchableOpacity
  style={[styles.backBtn, { top: insets.top + 8 }]}
  onPress={() => router.back()}
  activeOpacity={0.85}
  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
>
  <Ionicons name="arrow-back" size={20} color="#fff" />
</TouchableOpacity>
        </View>

        {/* ── Header Card ── */}
        <View style={styles.headerCard}>

          {/* Name on ONE line · rating on the right */}
          <View style={tp.nameRow}>
            <Text style={tp.name} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>{turf.name}</Text>
            {ratingValue && (
              <View style={[styles.ratingBadge, { marginTop: 0 }]}>
                <Text style={styles.ratingStar}>★</Text>
                <Text style={styles.ratingValue}>{ratingValue}</Text>
              </View>
            )}
          </View>

          {/* Sports — own row under the name */}
          <View style={tp.sportRow}>
            {(Array.isArray(turf.sport) ? turf.sport : [turf.sport || "Sport"]).map((item, index) => (
              <SportPill key={index} sport={item as string} />
            ))}
          </View>

{/* Location + distance (left)  |  View Location pill (right) */}
<View style={styles.locationBlock}>
  <View style={{ flex: 1 }}>
    <View style={styles.locRow}>
      <Ionicons name="location" size={15} color="#16A34A" />
      <Text style={styles.location} numberOfLines={1}>{turf.location}</Text>
    </View>
    {distance && (
      <View style={styles.distRow}>
        <Ionicons name="navigate" size={12} color="#16A34A" />
        <Text style={styles.distTxt}>{distance} away</Text>
      </View>
    )}
  </View>

  <TouchableOpacity style={styles.locationBtn} onPress={openMap} activeOpacity={0.85}>
    <Ionicons name="map-outline" size={16} color="#16A34A" />
    <Text style={styles.locationBtnText}>View Location</Text>
    <Ionicons name="chevron-forward" size={15} color="#16A34A" />
  </TouchableOpacity>
</View>

           {/* Price cards — tap to open full price details */}
           {advancePricingOn ? (
  <TouchableOpacity style={styles.priceCardV2} onPress={openPriceInfo} activeOpacity={0.85}>
    <View style={styles.priceRowV2}>
      <View style={styles.priceRowLeft}>
        <View style={styles.priceDayDot} />
        <Text style={styles.priceRowLabel}>Mon – Fri</Text>
      </View>
      <Text style={styles.priceRowValue} numberOfLines={1} adjustsFontSizeToFit>
        {slabRange.weekday
          ? (slabRange.weekday.min === slabRange.weekday.max
              ? `₹${slabRange.weekday.min}`
              : `₹${slabRange.weekday.min} – ₹${slabRange.weekday.max}`)
          : `₹${turf.dayPrice || 0}`}
        <Text style={styles.priceRowUnit}> /hr</Text>
      </Text>
    </View>

    <View style={styles.priceDividerV2} />

    <View style={styles.priceRowV2}>
      <View style={styles.priceRowLeft}>
        <View style={[styles.priceDayDot, { backgroundColor: "#F59E0B" }]} />
        <Text style={styles.priceRowLabel}>Sat – Sun</Text>
      </View>
      <Text style={styles.priceRowValue} numberOfLines={1} adjustsFontSizeToFit>
        {slabRange.weekend
          ? (slabRange.weekend.min === slabRange.weekend.max
              ? `₹${slabRange.weekend.min}`
              : `₹${slabRange.weekend.min} – ₹${slabRange.weekend.max}`)
          : `₹${turf.dayPrice || 0}`}
        <Text style={styles.priceRowUnit}> /hr</Text>
      </Text>
    </View>

{showOnline && (
    <View style={styles.advanceStrip}>
      <View style={styles.priceRowLeft}>
        <Ionicons name="flash" size={13} color="#16A34A" />
        <Text style={styles.advanceStripLabel}>Book with advance</Text>
      </View>
      <Text style={styles.advanceStripValue}>₹{turf.bookingPrice || 0}</Text>
    </View>
      )}
  </TouchableOpacity>
) : (
  /* keep your existing non-advance-pricing block as is */
            <TouchableOpacity style={styles.priceRow} onPress={openPriceInfo} activeOpacity={0.85}>
                           {([["Day", turf.dayPrice], ["Night", turf.nightPrice], ["Advance", turf.bookingPrice]] as [string, any][])
                .filter(([label]) => showOnline || label !== "Advance")
                .map(([label, val]) => (

                <View key={label} style={styles.priceCard}>
                  <Text style={styles.priceLabel}>{label}</Text>
                  <Text style={styles.priceValue}>{priceOrCall(val)}</Text>
                </View>
              ))}
            </TouchableOpacity>
          )}
 
          <TouchableOpacity style={styles.priceHintRow} onPress={openPriceInfo} activeOpacity={0.8}>
            <Ionicons name="information-circle-outline" size={14} color="#16A34A" />
            <Text style={styles.priceHintTxt}>
              {advancePricingOn
                ? "Price changes by time & day — view full price chart"
                : "View full price details"}
            </Text>
            <Ionicons name="chevron-forward" size={14} color="#16A34A" />
          </TouchableOpacity>

          

          {/* VCoin cashback — slim, amount stays a surprise */}
          {showOnline && vcoinEnabled && (
            <View style={tp.vcoinRow}>
              <View style={tp.vcoinCoin}><Text style={tp.vcoinCoinTxt}>V</Text></View>
              <Text style={tp.vcoinTxt}>Earn VCoin cashback here 🎁</Text>
            </View>
          )}

          {/* Offer — coupon ticket (orange, same as the % on offer slots) */}
          {(bannerOffer || upcomingOffer) && (() => {
            const o = (bannerOffer || upcomingOffer)!;
            const isTodayOffer = !!bannerOffer;
            const nextDays = (o.runsOn || []).filter((k) => k > keyOfDate(selectedDate)).slice(0, 3)
              .map((k) => { const [y, m, d] = k.split("-").map(Number); return `${d} ${new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short" })}`; });
            const [big, small] = o.type === "flat" ? [`₹${o.value}`, "OFF"] : [`${o.value}%`, "OFF"];
            const detail = isTodayOffer
              ? `${windowsText(o)}${o.type === "percent" && Number(o.maxDiscount) > 0 ? ` · up to ₹${o.maxDiscount} off` : ""}`
              : `On ${nextDays.join(", ")} · book ahead`;
            return (
              <View style={tp.ticket}>
                <View style={tp.ticketStub}>
                  <Text style={tp.ticketBig} numberOfLines={1} adjustsFontSizeToFit>{big}</Text>
                  <Text style={tp.ticketSmall}>{small}</Text>
                </View>
                <View style={[tp.notch, { top: -8 }]} />
                <View style={[tp.notch, { bottom: -8 }]} />
                <View style={tp.ticketBody}>
                  <View style={tp.ticketTop}>
                    <Text style={tp.ticketKicker}>
                      {isTodayOffer ? (selectedDate.toDateString() === new Date().toDateString() ? "TODAY'S SPECIAL" : "OFFER ON THIS DAY") : "COMING SOON"}
                    </Text>
                    {isTodayOffer && <Text style={tp.ticketAuto}>✓ Auto-applied</Text>}
                  </View>
                  <Text style={tp.ticketName} numberOfLines={1}>
                    {o.tag || o.title}{todayOffers.length > 1 && isTodayOffer ? `  +${todayOffers.length - 1} more` : ""}
                  </Text>
                  <Text style={tp.ticketDetail} numberOfLines={2}>{detail}</Text>
                </View>
              </View>
            );
          })()}

          {turf.facilities && turf.facilities.length > 0 && (
            <View style={styles.facilitiesWrap}>
              <Text style={styles.facilitiesTitle}>Facilities</Text>
              <View style={styles.facilitiesContainer}>
               {turf.facilities.map((facility, index) => (
  <View key={index} style={styles.facilityChip}>
    <View style={styles.facilityIconWrap}>
      <MaterialCommunityIcons name={getFacilityIcon(facility)} size={14} color="#16A34A" />
    </View>
    <Text style={styles.facilityText}>{facility}</Text>
  </View>
))}
              </View>
            </View>
          )}
          
        </View>
                  {/* ── Book by phone (admin set Phone Only / Both) ── */}
        {showCall && (
          <View style={styles.callCard}>
            {/* Header */}
            <View style={styles.callHeader}>
              <View style={styles.callIconWrap}>
                <Ionicons name="call-outline" size={22} color="#15803D" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.callTitle}>
                  {showOnline ? "Prefer to book by call?" : "Book by phone"}
                </Text>
                <Text style={styles.callSub}>
                  {showOnline
                    ? "You can also book this turf over a call"
                    : "This turf takes bookings over a call"}
                </Text>
              </View>
            </View>

            {/* Number box */}
            <View style={styles.callNumberBox}>
              <View style={{ flex: 1 }}>
                <Text style={styles.callNumberLabel}>BOOKING NUMBER</Text>
                <Text style={styles.callNumber}>{prettyPhone}</Text>
              </View>
              <Text style={styles.callHours}>
                {(turf as any).hoursSet === false ? "" : `${shortTime(openingTime)} – ${shortTime(closingTime)}`}
              </Text>
            </View>

                        {/* Buttons — night: closed note | logged in: WhatsApp + Call | guest: Log in */}
            {callsQuiet ? (
              <View style={styles.quietBox}>
                <Ionicons name="moon" size={18} color="#4338CA" />
                <View style={{ flex: 1 }}>
                  <Text style={styles.quietTitle}>Calls closed for the night</Text>
                  <Text style={styles.quietSub}>The number shows again at 7:00 AM. Plan your game and call in the morning.</Text>
                </View>
              </View>
            ) : isLoggedIn ? (
              <>
                <View style={styles.callBtnRow}>
                  <TouchableOpacity style={styles.callOutlineBtn} onPress={whatsappTurf} activeOpacity={0.85}>
                    <Ionicons name="logo-whatsapp" size={18} color="#16A34A" />
                    <Text style={styles.callOutlineBtnText}>WhatsApp</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.callOutlineBtn} onPress={callTurf} activeOpacity={0.85}>
                    <Ionicons name="call" size={16} color="#111111" />
                    <Text style={styles.callOutlineBtnText}>Call now</Text>
                  </TouchableOpacity>
                </View>
                <Text style={styles.callPrivacy}>
                                    Mention PlayOn when you call — the turf will know you found them here.
                </Text>
              </>
            ) : (
              <TouchableOpacity
                style={styles.callLoginBtn}
                onPress={() => router.push("/(auth)/signup" as any)}
                activeOpacity={0.85}
              >
                <Ionicons name="lock-closed" size={16} color="#fff" />
                <Text style={styles.callLoginBtnText}>Create account to see number</Text>
              </TouchableOpacity>
            )}

          
            {!showOnline && (
              <View style={tp.soonPill}>
                <Ionicons name="time-outline" size={13} color="#1D4ED8" />
                <Text style={tp.soonTxt}>Online booking coming soon</Text>
              </View>
            )}
          </View>
        )}

        {/* ── Turf Status Banner ── */}
          
        {turf.status && (
          <View style={[
            styles.statusCard,
            statusCfg
              ? { backgroundColor: statusCfg.color, borderColor: statusCfg.border }
              : { backgroundColor: "#F9FAFB", borderColor: "#E5E7EB" },
          ]}>
            <View style={styles.statusTop}>
              <Text style={styles.statusEmoji}>{statusCfg?.emoji ?? "ℹ️"}</Text>
              <View style={{ flex: 1 }}>
                <Text style={[styles.statusLabel, { color: statusCfg?.textColor ?? "#374151" }]}>
                  {statusCfg?.label ?? turf.status}
                </Text>
                {turf.statusNote ? (
                  <Text style={styles.statusNote}>{turf.statusNote}</Text>
                ) : null}
              </View>
              {(turf.status === "closed" || turf.status === "league") && statusCfg && (
                <View style={[styles.statusChip, { backgroundColor: statusCfg.border }]}>
                  <Text style={[styles.statusChipTxt, { color: statusCfg.textColor }]}>
                    {turf.status === "closed" ? "Unavailable" : "Busy"}
                  </Text>
                </View>
              )}
            </View>
            {turf.statusUpdatedAt ? (
              <Text style={styles.statusTime}>
                Updated {new Date(turf.statusUpdatedAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
              </Text>
            ) : null}
          </View>
        )}

              {showOnline && (<>
        {/* ── ONE card: Book your slot = date + time ── */}
        <View style={styles.section}>
          <View style={tp.bookHead}>
            <Text style={styles.sectionTitle}>Book your slot</Text>
            <Text style={tp.monthTxt}>{selectedDate.toLocaleDateString("en-US", { month: "long" })}</Text>
          </View>
          <FlatList
            horizontal data={days} keyExtractor={(item) => item.toDateString()}
            showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dateList}
            renderItem={({ item }) => {
              const selected = item.toDateString() === selectedDate.toDateString();
              return (
                <TouchableOpacity
                  style={[styles.dateBox, selected && styles.dateBoxSelected]}
                  onPress={() => setSelectedDate(item)}
                >
                  <Text style={[styles.dateDay, selected && styles.dateTextSelected]}>
                    {item.toLocaleDateString("en-US", { weekday: "short" })}
                  </Text>
                  <Text style={[styles.dateNumber, selected && styles.dateTextSelected]}>
                    {item.getDate()}
                  </Text>
                  {offersOn(item).length > 0 && (
                    <Text style={[offerStyles.dateTag, selected && { color: "#DCFCE7" }]} numberOfLines={1}>
                      {offerLabel(offersOn(item)[0])}
                    </Text>
                  )}
                </TouchableOpacity>
              );
            }}
          />
          <View style={tp.stepDivider} />
                    {closingTime > 24 && (() => {
            const cutoff = Number(turf.lateCutoffHours || 0);
            const shut   = isLateClosed();
            return (
              <View style={[styles.lateBanner, shut && styles.lateBannerShut]}>
                <Ionicons name="moon" size={14} color={shut ? "#9CA3AF" : "#6D28D9"} />
                <Text style={[styles.lateBannerTxt, shut && { color: "#6B7280" }]}>
                  {shut
                    ? `Late-night booking closed for this day`
                    : `Late-night slots till ${formatTime(closingTime)}` +
                      (cutoff ? ` · booking closes at ${formatTime(24 - cutoff)}` : "")}
                </Text>
              </View>
            );
          })()}
          
                        {(() => {
            const allowedModes = (["flexible", "quick"] as BookingMode[]).filter((m) =>
              m === "flexible" ? turf.flexibleSlotsEnabled !== false : turf.quickSlotsEnabled !== false
            );
            if (allowedModes.length < 2) return null;   // only one style → no switcher
            return (
          <View style={styles.modeSwitcher}>
            {allowedModes.map((mode) => (
  <TouchableOpacity
    key={mode}
    style={[styles.modeButton, bookingMode === mode && styles.modeButtonActive]}
    onPress={() => { LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); setBookingMode(mode); }}
  >
    <Ionicons
      name={mode === "flexible" ? "time-outline" : "flash-outline"}
      size={15}
      color={bookingMode === mode ? "#16A34A" : "#9CA3AF"}
    />
    <Text style={[styles.modeButtonText, bookingMode === mode && styles.modeButtonTextActive]}>
      {mode === "flexible" ? "Flexible Time" : "Quick Slots"}
    </Text>
   </TouchableOpacity>
))}
          </View>
            );
          })()}

          {bookingMode === "flexible" ? (
            <View style={styles.flexContainer}>
              <View style={styles.flexHeader}>
                <View>
                  <Text style={styles.flexTitle}>Select Time</Text>
                  <Text style={styles.flexSubtitle}>Choose your booking duration</Text>
                </View>
                {(flexStart !== null || flexEnd !== null) && (
                  <TouchableOpacity style={styles.flexClearBtn} onPress={clearSelection}>
                    <Text style={styles.flexClearText}>Clear</Text>
                  </TouchableOpacity>
                )}
              </View>

              <View style={styles.timeBoxRow}>
                <TouchableOpacity
                  style={[styles.timeBox, activePanel === "from" && styles.timeBoxActive, flexStart !== null && activePanel !== "from" && styles.timeBoxFilled]}
                  onPress={handleOpenFrom} activeOpacity={0.8}
                >
                  <Text style={styles.timeBoxLabel}>FROM</Text>
                  <Text style={[styles.timeBoxValue, flexStart === null && styles.timeBoxPlaceholder]}>
                    {flexStart !== null ? formatTime(flexStart) : "HH:MM"}
                  </Text>
                  {flexStart !== null && <View style={styles.timeBoxDot} />}
                </TouchableOpacity>

                <View style={styles.timeBoxArrow}>
                  <Text style={styles.timeBoxArrowText}>→</Text>
                  {flexStart !== null && flexEnd !== null && (
                    <Text style={styles.durationBadge}>{durationLabel}</Text>
                  )}
                </View>

                <TouchableOpacity
                  style={[styles.timeBox, activePanel === "to" && styles.timeBoxActive, flexEnd !== null && activePanel !== "to" && styles.timeBoxFilled, flexStart === null && styles.timeBoxDisabled]}
                  onPress={handleOpenTo} activeOpacity={0.8}
                >
                  <Text style={styles.timeBoxLabel}>TO</Text>
                  <Text style={[styles.timeBoxValue, flexEnd === null && styles.timeBoxPlaceholder]}>
                    {flexEnd !== null ? formatTime(flexEnd) : "HH:MM"}
                  </Text>
                  {flexEnd !== null && <View style={styles.timeBoxDot} />}
                </TouchableOpacity>
              </View>

              {flexStart !== null && flexEnd !== null && hasValidSelection && (
                <View style={styles.pricePreviewStrip}>
                  <Text style={styles.pricePreviewLabel}>Estimated total</Text>
                  <Text style={styles.pricePreviewValue}>₹{totalPrice}</Text>
                </View>
              )}

              <Animated.View style={[styles.slotPanel, { maxHeight: fromPanelHeight, overflow: "hidden" }]}>
                <View style={styles.slotPanelInner}>
                                 <Text style={styles.slotPanelTitle}>Select start time</Text>

                  {/* Morning / Afternoon / Evening / Night */}
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.partRow, { paddingTop: 0, paddingBottom: 10 }]}>
                    {fromGroups.map((g) => {
                      const on = fromPart === g.key;
                      return (
                        <TouchableOpacity
                          key={g.key}
                          style={[styles.partChip, on && styles.partChipOn, { paddingVertical: 7 }]}
                          onPress={() => setFromPart(g.key)}
                          activeOpacity={0.8}
                        >
                          <Ionicons name={g.icon} size={13} color={on ? "#fff" : "#6B7280"} />
                          <Text style={[styles.partChipTxt, on && styles.partChipTxtOn, { fontSize: 12 }]}>{g.label}</Text>
                          <View style={[styles.partCount, on && styles.partCountOn]}>
                            <Text style={[styles.partCountTxt, on && { color: "#15803D" }]}>{g.free}</Text>
                          </View>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>

                  {visibleFromChips.length === 0 && (
                    <Text style={styles.noSlotsText}>No start times left here. Try another part of the day.</Text>
                  )}
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
                    {visibleFromChips.map((chip) => (
                      <SlotChip key={chip.value} chip={chip} isSelected={flexStart === chip.value} isInRange={false} onPress={() => handleSelectFrom(chip)} />
                    ))}
                  </ScrollView>
                  <View style={styles.slotLegend}>
                    {[["#111111","Selected"],["#E5E7EB","Available"],["#FEE2E2","Booked"],["#F3F4F6","Past"]].map(([color, label]) => (
                      <View key={label} style={styles.legendItem}>
                        <View style={[styles.legendDot, { backgroundColor: color, borderWidth: color === "#E5E7EB" ? 1 : 0, borderColor: "#D1D5DB" }]} />
                        <Text style={styles.legendText}>{label}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              </Animated.View>

              <Animated.View style={[styles.slotPanel, { maxHeight: toPanelHeight, overflow: "hidden" }]}>
                <View style={styles.slotPanelInner}>
                  <Text style={styles.slotPanelTitle}>
                    Select end time
                    {flexStart !== null && <Text style={styles.slotPanelSubtitle}> — from {formatTime(flexStart)}</Text>}
                  </Text>
                  {toChips.length === 0 ? (
                    <Text style={styles.noSlotsText}>No available slots after this time</Text>
                  ) : (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
                      {toChips.map((chip) => (
                        <SlotChip
                          key={chip.value} chip={chip}
                          isSelected={flexEnd === chip.value}
                          isInRange={flexStart !== null && flexEnd !== null && chip.value > flexStart && chip.value <= flexEnd}
                          onPress={() => handleSelectTo(chip)}
                        />
                      ))}
                    </ScrollView>
                  )}
                  <View>
  <Text style={styles.maxDurationNote}>
    Minimum 1 hour • Maximum {MAX_BOOKING_HOURS} hours
  </Text>
  
</View>
                </View>
              </Animated.View>

              {flexStart !== null && flexEnd !== null && !hasValidSelection && (
                <View style={styles.validationBox}>
                  <Text style={styles.validationText}>
                    {isRangeUnavailable(flexStart, flexEnd)
                      ? "This range overlaps a booked slot. Please pick a different time."
                      : durationMinutes > MAX_BOOKING_HOURS * 60
                        ? `Maximum ${MAX_BOOKING_HOURS} hours allowed.`
                        : "Invalid selection. Please try again."}
                  </Text>
                </View>
              )}
            </View>
                 ) : (
            <View>
              {/* Tell users this turf books in fixed slots */}
              {turf.flexibleSlotsEnabled === false && (
                <View style={styles.quickInfo}>
                  <Ionicons name="flash" size={14} color="#15803D" />
                  <Text style={styles.quickInfoTxt}>
                    Quick slot booking · fixed {slotDuration}-min slots
                  </Text>
                </View>
              )}

              {/* All slots in one list (no Morning/Evening tabs) — price shown once, offers flip */}
              {(() => {
                // Prices shown ONCE above the grid
                const rates = quickSlots.map((s) => Math.round(getRangePrice(s.startValue, s.endValue) / Math.max(s.endValue - s.startValue, 0.01)));
                const simpleDayNight = turf.advancePricingEnabled !== true && specialPrices.length === 0;
                const dayP   = Number(turf.dayPrice   || turf.price || 0);
                const nightP = Number(turf.nightPrice || turf.price || 0);
                const minR = rates.length ? Math.min(...rates) : 0;
                const maxR = rates.length ? Math.max(...rates) : 0;
                const priceText = simpleDayNight && dayP !== nightP
                  ? `Day ₹${dayP}/hr · Night ₹${nightP}/hr`
                  : minR === maxR ? `₹${minR}/hr` : `₹${minR} – ₹${maxR}/hr`;

                // Offer explained ONCE
                const firstOffer = quickSlots.map((s) => slotOffer(s.startValue, s.endValue)).find(Boolean) || null;
                const offerLine = firstOffer
                  ? `${firstOffer.tag || firstOffer.title} · ${firstOffer.type === "flat" ? `₹${firstOffer.value} off` : `${firstOffer.value}% off`} on ${windowsText(firstOffer)}`
                  : null;

                return (
                  <>
                    {quickSlots.length > 0 && (
                      <View style={styles.qPriceStrip}>
                        <Text style={styles.qPriceTxt}>{priceText}</Text>
                        <Text style={styles.qPriceSub}>{slotDuration >= 60 && slotDuration % 60 === 0 ? `${slotDuration / 60}-hr` : `${slotDuration}-min`} slots</Text>
                      </View>
                    )}
                    {offerLine && (
                      <View style={styles.qOfferStrip}>
                        <View style={styles.qOfferPill}><Text style={styles.qOfferPillTxt}>%</Text></View>
                        <Text style={styles.qOfferTxt} numberOfLines={2}>{offerLine}</Text>
                      </View>
                    )}

                    <View style={styles.qGrid}>
                      {quickSlots.length === 0 && (
                        <Text style={styles.noSlotsText}>No slots left today. Try another date.</Text>
                      )}
                      {quickSlots.map((slot, i) => {
                        const booked   = isRangeUnavailable(slot.startValue, slot.endValue) || isPastTime(slot.startValue);
                        const selected = selectedQuickSlots.some((s) => s.time === slot.time);
                        const price    = getRangePrice(slot.startValue, slot.endValue);
                        const so       = !booked ? slotOffer(slot.startValue, slot.endValue) : null;
                        const np       = so ? slotOfferPrice(so, price) : null;
                        return (
                          <QuickSlotBox
                            key={slot.time}
                            label={quickLabel(formatTime, slot.startValue, slot.endValue)}
                            state={booked ? "booked" : selected ? "selected" : "free"}
                            offerOld={np !== null && np < price ? price : null}
                            offerNew={np !== null && np < price ? np : null}
                            offerText={so && so.type === "flat" ? `₹${so.value} off` : null}
                            flip={quickFlip}
                            last={i % 3 === 2}
                            onPress={() => handleQuickSlotSelect(slot)}
                          />
                        );
                      })}
                    </View>

                    {/* Legend */}
                    {quickSlots.length > 0 && (
                      <View style={styles.qLegend}>
                        <View style={styles.qLegendItem}><View style={[styles.qLegendDot, { backgroundColor: "#FFFFFF", borderWidth: 1.5, borderColor: "#E5E7EB" }]} /><Text style={styles.qLegendTxt}>Available</Text></View>
                        <View style={styles.qLegendItem}><View style={[styles.qLegendDot, { backgroundColor: "#16A34A" }]} /><Text style={styles.qLegendTxt}>Selected</Text></View>
                        <View style={styles.qLegendItem}><View style={[styles.qLegendDot, { backgroundColor: "#F3F4F6", borderWidth: 1.5, borderColor: "#E5E7EB" }]} /><Text style={styles.qLegendTxt}>Booked</Text></View>
                        {offerLine && (
                          <View style={styles.qLegendItem}><View style={[styles.qLegendDot, { backgroundColor: "#F0FDF4", borderWidth: 1.5, borderColor: "#86EFAC" }]} /><Text style={styles.qLegendTxt}>Offer</Text></View>
                        )}
                      </View>
                    )}

                    {/* Selection summary — total + savings shown here, not on each slot */}
                    {selectedQuickSlots.length > 0 && selectedStartValue !== null && selectedEndValue !== null && (
                      <View style={styles.qSummary}>
                        <Text style={styles.qSummaryTxt} numberOfLines={1}>
                          {formatTime(selectedStartValue)} – {formatTime(selectedEndValue)} · {durationLabel}
                          {offerDiscount > 0 && <Text style={{ color: "#EA580C" }}>  · saved ₹{offerDiscount}</Text>}
                        </Text>
                        <Text style={styles.qSummaryAmt}>₹{offerTotal}</Text>
                      </View>
                    )}
                  </>
                );
              })()}
            </View>
          )}
        </View>

        {/* ── Booking Summary ── */}
                </>)}
        
        <View style={{ height: 130 }} />
      </ScrollView>

          {/* ── Bottom Bar: Phone Only (always visible) ── */}
      {!showOnline && showCall && (
        <View style={[styles.bottomWrapper, { paddingBottom: insets.bottom }]}>
          <View style={styles.bottomBar}>
            <View style={{ flex: 1 }}>
              <Text style={styles.bottomLabel}>Booking</Text>
              <Text style={[styles.bottomAmount, { fontSize: 17 }]}>By phone only</Text>
            </View>
            <TouchableOpacity style={[styles.bookBtn, { flexDirection: "row", gap: 8 }]} onPress={callTurf}>
              <Ionicons name="call" size={16} color="#fff" />
              <Text style={styles.bookBtnText}>Call to book</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* ── Bottom Bar: Online / Both (shows when slot selected) ── */}
      {showOnline && hasValidSelection && (
        <View style={[styles.bottomWrapper, { paddingBottom: insets.bottom }]}>
          <View style={styles.bottomBar}>
            <View style={{ flex: 1 }}>
              <Text style={styles.bottomLabel}>Advance booking amount</Text>
              <Text style={styles.bottomAmount}>₹{advanceAmount}</Text>
              <Text style={styles.bottomRemaining}>
                {selectedTimeLabel} · {durationLabel}
                {durationMinutes / 60 > ADVANCE_THRESHOLD_HOURS && " · Extended booking"}
              </Text>
            </View>
            {showCall && (
              <TouchableOpacity style={styles.callIconBtn} onPress={callTurf} activeOpacity={0.85}>
                <Ionicons name="call" size={20} color="#15803D" />
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={styles.bookBtn}
              onPress={() => { if (!validateSelection(true)) return; setShowBilling(true); }}
            >
              <Text style={styles.bookBtnText}>Book Now</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}





<Modal
  visible={showBilling}
  transparent
  animationType="slide"
   onRequestClose={requestCloseBilling}
  
>
  <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" }}>
    <View style={{ backgroundColor: "#fff", borderTopLeftRadius: 28, borderTopRightRadius: 28, maxHeight: "90%", paddingHorizontal: 20, paddingTop: 12, paddingBottom: kbHeight > 0 ? 12 + (Platform.OS === "ios" ? kbHeight : 0) : insets.bottom + 16 }}>
      <View style={{ width: 44, height: 4, borderRadius: 2, backgroundColor: "#E5E7EB", alignSelf: "center", marginBottom: 16 }} />
      <ScrollView
        ref={sheetScrollRef}
        style={{ flexShrink: 1 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >

        {/* 1 · Header */}
        <View style={bs.header}>
          <Text style={bs.title}>Confirm booking</Text>
          <TouchableOpacity style={bs.closeBtn} onPress={requestCloseBilling} accessibilityLabel="Close" hitSlop={8}>
            <Ionicons name="close" size={18} color="#4B5563" />
          </TouchableOpacity>
        </View>

        {/* 2 · One booking card */}
        <View style={bs.bookingCard}>
          <View style={bs.dateBlock}>
            <Text style={bs.dateDow}>{selectedDate.toLocaleDateString("en-US", { weekday: "short" }).toUpperCase()}</Text>
            <Text style={bs.dateDay}>{selectedDate.getDate()}</Text>
            <Text style={bs.dateMon}>{selectedDate.toLocaleDateString("en-US", { month: "short" }).toUpperCase()}</Text>
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={bs.turfName} numberOfLines={1}>{turf.name}</Text>
            {selectedStartValue !== null && selectedEndValue !== null && (
              <Text style={bs.timeTxt}>{formatTime(selectedStartValue)} – {formatTime(selectedEndValue)}</Text>
            )}
            <Text style={bs.metaTxt} numberOfLines={1}>{durationLabel}{turf.location ? ` · ${turf.location}` : ""}</Text>
          </View>
          <TouchableOpacity onPress={requestCloseBilling} hitSlop={8}>
            <Text style={bs.changeTxt}>Change</Text>
          </TouchableOpacity>
        </View>

        {/* 3 · Offer — one compact line */}
        {offer && (
          <View style={bs.offerRow}>
            <View style={bs.offerIcon}><Ionicons name="pricetag" size={14} color="#fff" /></View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={bs.offerTitle} numberOfLines={1}>{offer.title} applied · −₹{offer.discount}</Text>
              <Text style={bs.offerSub}>Can't be combined with promo code or coins</Text>
            </View>
            <Ionicons name="checkmark" size={18} color="#16A34A" />
          </View>
        )}

        {/* 4a · Promo — collapsed row, only when there is no offer */}
        {!offer && (
          promoApplied ? (
            <View style={[promoStyles.appliedBox, { marginTop: 10 }]}>
              <View style={promoStyles.appliedLeft}>
                <View style={promoStyles.appliedBadge}>
                  <Text style={promoStyles.appliedBadgeTxt}>🎟️ {promoApplied.code}</Text>
                </View>
                <Text style={promoStyles.appliedDesc} numberOfLines={1}>₹{promoApplied.discount} off applied</Text>
              </View>
              <TouchableOpacity style={promoStyles.removeBtn} onPress={removePromo}>
                <Text style={{ fontSize: 16, color: "#6B7280" }}>✕</Text>
              </TouchableOpacity>
            </View>
          ) : !promoOpen ? (
            <TouchableOpacity
              style={[bs.lineRow, coinDiscountAmount > 0 && { opacity: 0.5 }]}
              activeOpacity={0.8}
              onPress={() => {
                if (coinDiscountAmount > 0) { Alert.alert("Remove Coins First", "Deselect coins to use a promo code."); return; }
                LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                setPromoOpen(true);
              }}
            >
              <Text style={{ fontSize: 16 }}>🎟️</Text>
              <Text style={[bs.lineTitle, { flex: 1 }]}>Have a promo code?</Text>
              <Ionicons name="chevron-down" size={16} color="#9CA3AF" />
            </TouchableOpacity>
          ) : (
            <View style={{ marginTop: 10 }} onLayout={(e) => { promoYRef.current = e.nativeEvent.layout.y; }}>
              <View style={promoStyles.inputRow}>
                <TextInput
                  style={promoStyles.input}
                  placeholder="Enter code"
                  placeholderTextColor="#9CA3AF"
                  value={promoCode}
                  autoFocus
                  onFocus={() => setTimeout(() => sheetScrollRef.current?.scrollTo({ y: promoYRef.current - 12, animated: true }), 250)}
                  onChangeText={(v) => { setPromoCode(v.toUpperCase()); setPromoError(""); }}
                  autoCapitalize="characters"
                  returnKeyType="done"
                  onSubmitEditing={applyPromo}
                />
                <TouchableOpacity
                  style={[promoStyles.applyBtn, (!promoCode.trim() || promoLoading) && promoStyles.applyBtnDisabled]}
                  onPress={applyPromo}
                  disabled={!promoCode.trim() || promoLoading}
                >
                  {promoLoading ? <ActivityIndicator size="small" color="#fff" /> : <Text style={promoStyles.applyBtnTxt}>Apply</Text>}
                </TouchableOpacity>
              </View>
              {!!promoError && (
                <View style={promoStyles.errorBox}>
                  <Text style={promoStyles.errorTxt}>⚠ {promoError}</Text>
                </View>
              )}
            </View>
          )
        )}

        {/* 4b · Coins — one row; locked with an offer, expands otherwise */}
        {offer ? (
          <View style={[bs.lineRow, { opacity: 0.6 }]}>
            <Text style={{ fontSize: 16 }}>🪙</Text>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={bs.lineTitle}>Coins · {pcoinBalance} PCoin · {vcoinEnabled ? vcoinBalance : 0} VCoin</Text>
              <Text style={[bs.lineSub, { color: "#9A3412" }]} numberOfLines={1}>Locked with {offer.title} · stay saved for next time</Text>
            </View>
            <Ionicons name="lock-closed-outline" size={15} color="#9CA3AF" />
          </View>
        ) : (
          <>
            <TouchableOpacity
              style={[bs.lineRow, promoApplied && { opacity: 0.5 }]}
              activeOpacity={0.8}
              onPress={() => {
                if (promoApplied) { Alert.alert("Remove Promo First", "Remove the promo code to use coins."); return; }
                LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                setCoinsOpen(!coinsOpen);
              }}
            >
              <Text style={{ fontSize: 16 }}>🪙</Text>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={bs.lineTitle}>
                  {coinDiscountAmount > 0 ? `Coins applied · −₹${coinDiscountAmount}` : "Use your coins"}
                </Text>
                <Text style={bs.lineSub} numberOfLines={1}>
                  {pcoinBalance} PCoin · {vcoinEnabled ? `${vcoinBalance} VCoin` : "VCoin not available here"}
                </Text>
              </View>
              <Ionicons name={coinsOpen ? "chevron-up" : "chevron-down"} size={16} color="#9CA3AF" />
            </TouchableOpacity>
            {coinsOpen && !promoApplied && (
              <View style={{ marginTop: 8 }}>
  <View style={coinRedeemStyles.cardsRow}>
    {/* PCoin card */}
    <TouchableOpacity
      style={[coinRedeemStyles.coinCard, usePcoins && coinRedeemStyles.coinCardActive]}
      onPress={() => {
        if (promoApplied) {
          Alert.alert("Remove Promo First", "Remove the promo code to use coins.");
          return;
        }
        const val = !usePcoins;
        setUsePcoins(val);
                setPcoinToUse(val ? Math.max(Math.min(pcoinBalance, advanceAmount - (useVcoins ? vcoinToUse : 0) - 1), 0) : 0);
      }}
      activeOpacity={0.8}
    >
      <View style={coinRedeemStyles.cardTop}>
        <Text style={{ fontSize: 18 }}>🪙</Text>
        <View style={[coinRedeemStyles.checkbox, usePcoins && coinRedeemStyles.checkboxActive]}>
          {usePcoins && <Ionicons name="checkmark" size={11} color="#fff" />}
        </View>
      </View>
      <Text style={coinRedeemStyles.coinLabel}>PCoin</Text>
      <Text style={coinRedeemStyles.coinBalance}>
        {pcoinBalance > 0 ? `${pcoinBalance} available` : "Balance: 0"}
      </Text>
      <Text style={[coinRedeemStyles.coinOff, pcoinBalance === 0 && { color: "#9CA3AF" }]}>
        {pcoinBalance > 0 ? `₹${pcoinBalance} off · any turf` : "No PCoin yet"}
      </Text>
      {usePcoins && pcoinToUse > 0 && (
        <View style={coinRedeemStyles.usedBadge}>
          <Text style={coinRedeemStyles.usedBadgeTxt}>−₹{pcoinToUse}</Text>
        </View>
      )}
    </TouchableOpacity>

    {/* VCoin card */}
    <TouchableOpacity
      style={[
        coinRedeemStyles.coinCard,
        useVcoins && coinRedeemStyles.coinCardActiveAmber,
        !vcoinEnabled && coinRedeemStyles.coinCardDisabled,
      ]}
      onPress={() => {
        if (!vcoinEnabled) return;
        if (promoApplied) {
          Alert.alert("Remove Promo First", "Remove the promo code to use coins.");
          return;
        }
        const val = !useVcoins;
        setUseVcoins(val);
                setVcoinToUse(val ? Math.max(Math.min(vcoinBalance, advanceAmount - (usePcoins ? pcoinToUse : 0) - 1), 0) : 0);
      }}
      activeOpacity={vcoinEnabled ? 0.8 : 1}
    >
      <View style={coinRedeemStyles.cardTop}>
        <Text style={{ fontSize: 18 }}>🏟️</Text>
        <View style={[coinRedeemStyles.checkbox, useVcoins && coinRedeemStyles.checkboxAmber]}>
          {useVcoins && <Ionicons name="checkmark" size={11} color="#fff" />}
        </View>
      </View>
      <Text style={coinRedeemStyles.coinLabel}>VCoin</Text>
      <Text style={coinRedeemStyles.coinBalance}>
        {!vcoinEnabled ? "Not available" : vcoinBalance > 0 ? `${vcoinBalance} available` : "Balance: 0"}
      </Text>
      <Text style={[coinRedeemStyles.coinOff, (vcoinBalance === 0 || !vcoinEnabled) && { color: "#9CA3AF" }]}>
        {!vcoinEnabled ? "Turf disabled" : vcoinBalance > 0 ? `₹${vcoinBalance} off · this turf` : "No VCoin yet"}
      </Text>
      {useVcoins && vcoinToUse > 0 && (
        <View style={[coinRedeemStyles.usedBadge, { backgroundColor: "#FEF3C7", borderColor: "#FDE68A" }]}>
          <Text style={[coinRedeemStyles.usedBadgeTxt, { color: "#B45309" }]}>−₹{vcoinToUse}</Text>
        </View>
      )}
    </TouchableOpacity>
  </View>
              </View>
            )}
          </>
        )}

        {/* 5 · How do you want to pay? */}
        <Text style={bs.sec}>How do you want to pay?</Text>
        <View style={{ flexDirection: "row", gap: 8 }}>
          {(["advance", "full"] as BookingType[]).map((type) => {
            const active = bookingType === type;
            const amt = type === "advance" ? Math.min(computedAdvanceAmount, offerTotal) : offerTotal;
            return (
              <TouchableOpacity
                key={type}
                style={[bs.payOpt, active && bs.payOptOn]}
                onPress={() => setBookingType(type)}
                activeOpacity={0.85}
                accessibilityRole="radio"
                accessibilityState={{ selected: active }}
              >
                <View style={[bs.radio, active && bs.radioOn]} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={bs.payAmt}>₹{amt} now</Text>
                  <Text style={[bs.payNote, active && { color: "#15803D" }]} numberOfLines={1}>
                    {type === "advance" ? "Advance · rest at turf" : "Full · nothing at turf"}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* 6 · Bill details — the only place with numbers */}
        <Text style={bs.sec}>Bill details</Text>
        <View style={bs.bill}>
          <View style={bs.billRow}><Text style={bs.billKey}>Slot price ({durationLabel})</Text><Text style={bs.billVal}>₹{totalPrice}</Text></View>
          {offerDiscount > 0 && (
            <View style={bs.billRow}><Text style={[bs.billKey, { color: "#16A34A" }]} numberOfLines={1}>{offer?.title}</Text><Text style={[bs.billVal, { color: "#16A34A" }]}>− ₹{offerDiscount}</Text></View>
          )}
          <View style={bs.billLine} />
          <View style={bs.billRow}><Text style={[bs.billKey, { color: "#111", fontWeight: "800" }]}>Total</Text><Text style={[bs.billVal, { fontWeight: "900" }]}>₹{offerTotal}</Text></View>
          {discountAmount > 0 && (
            <View style={bs.billRow}><Text style={[bs.billKey, { color: "#16A34A" }]}>Promo ({promoApplied?.code})</Text><Text style={[bs.billVal, { color: "#16A34A" }]}>− ₹{discountAmount}</Text></View>
          )}
          {coinDiscountAmount > 0 && (
            <View style={bs.billRow}><Text style={[bs.billKey, { color: "#7C3AED" }]}>Coins</Text><Text style={[bs.billVal, { color: "#7C3AED" }]}>− ₹{coinDiscountAmount}</Text></View>
          )}
          <View style={bs.billRow}><Text style={bs.billKey}>Pay now{bookingType === "advance" ? " (advance)" : ""}</Text><Text style={bs.billVal}>₹{finalAdvanceAmount}</Text></View>
          <View style={bs.billRow}><Text style={bs.billKey}>Pay at turf</Text><Text style={bs.billVal}>₹{remainingAmount}</Text></View>
        </View>

        {(offerDiscount + discountAmount + coinDiscountAmount) > 0 && (
          <View style={bs.saveRibbon}>
            <Text style={bs.saveTxt}>🎉 You're saving ₹{offerDiscount + discountAmount + coinDiscountAmount} on this booking</Text>
          </View>
        )}
        <View style={{ height: 8 }} />
      </ScrollView>

      {/* 7 · Pay bar — always visible (hidden while typing a promo code to give it room) */}
      {kbHeight === 0 && (
      <View style={bs.payBar}>
        <View style={{ flex: 1 }}>
          <Text style={bs.payBarAmt}>₹{finalAdvanceAmount}</Text>
          <Text style={bs.payBarSub}>{remainingAmount > 0 ? `₹${remainingAmount} at turf` : "Nothing to pay at turf"}</Text>
        </View>
        <TouchableOpacity style={[bs.payBtn, loading && { opacity: 0.7 }]} onPress={handlePayment} disabled={loading} activeOpacity={0.85}>
          {loading ? <ActivityIndicator size="small" color="#fff" /> : (
            <>
              <Text style={bs.payBtnTxt}>Pay & Book</Text>
              <Ionicons name="arrow-forward" size={16} color="#fff" />
            </>
          )}
        </TouchableOpacity>
      </View>
      )}
    </View>
  </View>
</Modal>

<Modal
  visible={showPriceInfo}
  transparent
  animationType="slide"
  onRequestClose={() => setShowPriceInfo(false)}
>
  <View style={pi.backdrop}>
    <View style={[pi.sheet, { paddingBottom: insets.bottom + 20 }]}>
      <View style={pi.handle} />
 
      <View style={pi.header}>
        <View style={{ flex: 1 }}>
          <Text style={pi.title}>Price Details</Text>
          <Text style={pi.sub}>{turf.name}</Text>
        </View>
        <TouchableOpacity style={pi.closeBtn} onPress={() => setShowPriceInfo(false)}>
          <Ionicons name="close" size={18} color="#374151" />
        </TouchableOpacity>
      </View>
 
      <ScrollView showsVerticalScrollIndicator={false}>
        {advancePricingOn ? (
          <>
            {/* Mon–Fri / Sat–Sun tabs */}
            <View style={pi.tabRow}>
              {(["weekday", "weekend"] as DayType[]).map((tab) => (
                <TouchableOpacity
                  key={tab}
                  style={[pi.tab, priceTab === tab && pi.tabActive]}
                  onPress={() => setPriceTab(tab)}
                  activeOpacity={0.85}
                >
                  <Text style={[pi.tabTxt, priceTab === tab && pi.tabTxtActive]}>
                    {tab === "weekday" ? "Mon – Fri" : "Sat – Sun"}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
 
            {getDayTypeFor(selectedDate) === priceTab && (
              <View style={pi.todayNote}>
                <Text style={pi.todayNoteTxt}>✓ These rates apply to your selected date</Text>
              </View>
            )}
 
            {sortedSlabs[priceTab].length === 0 ? (
              <Text style={pi.emptyTxt}>
                No time blocks set for these days — standard Day/Night pricing applies.
              </Text>
            ) : (
              sortedSlabs[priceTab].map((slab, i) => {
                const nowDec = new Date().getHours() + new Date().getMinutes() / 60;
                const isNow =
                  getDayTypeFor(selectedDate) === priceTab &&
                  selectedDate.toDateString() === new Date().toDateString() &&
                  nowDec >= Number(slab.start) && nowDec < Number(slab.end);
                return (
                  <View key={i} style={[pi.slabRow, isNow && pi.slabRowNow]}>
                    <View style={{ flex: 1 }}>
                      <Text style={[pi.slabTime, isNow && { color: "#15803D" }]}>
                        {formatTime(Number(slab.start))} – {formatTime(Number(slab.end))}
                      </Text>
                      {isNow && <Text style={pi.slabNowTxt}>Playing now</Text>}
                    </View>
                    <Text style={[pi.slabRate, isNow && { color: "#15803D" }]}>
                      ₹{Number(slab.rate)}<Text style={pi.slabUnit}> /hr</Text>
                    </Text>
                  </View>
                );
              })
            )}
 
            <Text style={pi.footNote}>
              Any hour not listed above is charged at the standard rate
              (₹{Number(turf.dayPrice || 0)}/hr day, ₹{Number(turf.nightPrice || 0)}/hr night).
            </Text>
          </>
        ) : (
          <>
            <View style={pi.slabRow}>
              <View style={{ flex: 1 }}>
                <Text style={pi.slabTime}>6:00 AM – 6:00 PM</Text>
                <Text style={pi.slabNowTxt}>Day rate</Text>
              </View>
              <Text style={pi.slabRate}>
                {priceOrCall(turf.dayPrice)}{hasPrice(turf.dayPrice) && <Text style={pi.slabUnit}> /hr</Text>}
              </Text>
            </View>
            <View style={pi.slabRow}>
              <View style={{ flex: 1 }}>
                <Text style={pi.slabTime}>6:00 PM – 12:00 AM</Text>
                <Text style={pi.slabNowTxt}>Night rate</Text>
              </View>
              <Text style={pi.slabRate}>
                {priceOrCall(turf.nightPrice)}{hasPrice(turf.nightPrice) && <Text style={pi.slabUnit}> /hr</Text>}
              </Text>
            </View>
            <Text style={pi.footNote}>
              This turf uses the same rates on every day of the week.
            </Text>
          </>
        )}
 
        {specialPrices.length > 0 && (
          <View style={pi.specialWrap}>
            <Text style={pi.specialTitle}>⭐ Special price for {selectedDate.toDateString()}</Text>
            {specialPrices.map((sp, i) => (
              <View key={i} style={pi.specialRow}>
                <Text style={pi.specialSlot}>{sp.slotTime}</Text>
                <Text style={pi.specialVal}>₹{Number(sp.price)}</Text>
              </View>
            ))}
          </View>
        )}
 
           {showOnline && (
        <View style={pi.advanceBox}>
          <View style={{ flex: 1 }}>
            <Text style={pi.advanceLabel}>Advance to book</Text>
            <Text style={pi.advanceSub}>Pay the rest at the turf</Text>
          </View>
          <Text style={pi.advanceVal}>₹{turf.bookingPrice || 0}</Text>
        </View>
           )}
 
        <TouchableOpacity style={pi.gotItBtn} onPress={() => setShowPriceInfo(false)}>
          <Text style={pi.gotItTxt}>Got it</Text>
        </TouchableOpacity>
        <View style={{ height: 8 }} />
      </ScrollView>
    </View>
  </View>
</Modal>

<Modal visible={showPromoModal} transparent animationType="fade" statusBarTranslucent>
  <PromoSuccessModal
    visible={showPromoModal}
    promoApplied={promoApplied}
    advanceAmount={advanceAmount}
    onContinue={() => setShowPromoModal(false)}
    onRemove={removePromo}
  />
</Modal>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({


  // advance pricing details 
  priceCardV2: {
  marginTop: 18,
  backgroundColor: "#F9FAFB",
  borderRadius: 18,
  borderWidth: 1,
  borderColor: "#EEF0F4",
  paddingHorizontal: 14,
  paddingVertical: 4,
  overflow: "hidden",
},
priceRowV2: {
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
  paddingVertical: 12,
},
priceRowLeft: {
  flexDirection: "row",
  alignItems: "center",
  gap: 8,
},
priceDayDot: {
  width: 7,
  height: 7,
  borderRadius: 4,
  backgroundColor: "#16A34A",
},
priceRowLabel: {
  fontSize: 13,
  fontWeight: "700",
  color: "#6B7280",
},
priceRowValue: {
  fontSize: 15,
  fontWeight: "900",
  color: "#111111",
  flexShrink: 1,
  textAlign: "right",
},
priceRowUnit: {
  fontSize: 11,
  fontWeight: "700",
  color: "#9CA3AF",
},
priceDividerV2: {
  height: 1,
  backgroundColor: "#EEF0F4",
},
advanceStrip: {
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
  backgroundColor: "#F0FDF4",
  borderRadius: 12,
  paddingHorizontal: 12,
  paddingVertical: 10,
  marginTop: 4,
  marginBottom: 10,
  borderWidth: 1,
  borderColor: "#BBF7D0",
},
advanceStripLabel: {
  fontSize: 12.5,
  fontWeight: "800",
  color: "#15803D",
},
advanceStripValue: {
  fontSize: 16,
  fontWeight: "900",
  color: "#15803D",
},//
    //wallet
  breakdownRow: {
  flexDirection: "row",
  justifyContent: "space-between",
  alignItems: "center",
  paddingVertical: 6,
},
breakdownKey: {
  fontSize: 13,
  fontWeight: "600",
  color: "#6B7280",
},
breakdownVal: {
  fontSize: 13,
  fontWeight: "800",
  color: "#1A1D21",
},
  screen:         { flex: 1, backgroundColor: "#F4F6FA" },
    // call to book
  callCard:           { marginHorizontal: 16, marginTop: 12, backgroundColor: "#FFFFFF", borderRadius: 22, borderWidth: 1.5, borderColor: "#86EFAC", padding: 16, gap: 12 },
  callHeader:         { flexDirection: "row", alignItems: "center", gap: 12 },
  callIconWrap:       { width: 46, height: 46, borderRadius: 14, backgroundColor: "#DCFCE7", alignItems: "center", justifyContent: "center" },
  callTitle:          { fontSize: 16, fontWeight: "800", color: "#111111" },
  callSub:            { fontSize: 12, fontWeight: "600", color: "#4B5563", marginTop: 2 },
  callNumberBox:      { flexDirection: "row", alignItems: "center", backgroundColor: "#F7F8FA", borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12 },
  callNumberLabel:    { fontSize: 10, fontWeight: "700", color: "#6B7280", letterSpacing: 0.4 },
  callNumber:         { fontSize: 19, fontWeight: "900", color: "#111111", marginTop: 3, letterSpacing: 0.5 },
  callHours:          { fontSize: 12, fontWeight: "700", color: "#4B5563" },
  callBtnRow:         { flexDirection: "row", gap: 10 },
  callOutlineBtn:     { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, height: 48, borderRadius: 14, borderWidth: 1.5, borderColor: "#E5E7EB", backgroundColor: "#FFFFFF" },
  callOutlineBtnText: { fontSize: 14, fontWeight: "800", color: "#111111" },
  callNote:           { fontSize: 11.5, fontWeight: "600", color: "#4B5563", lineHeight: 17 },
  callIconBtn:      { width: 46, height: 46, borderRadius: 13, borderWidth: 1.5, borderColor: "#86EFAC", backgroundColor: "#F0FDF4", alignItems: "center", justifyContent: "center", marginRight: 10 },
  scrollContent:  { paddingBottom: 100 },
  loaderWrap:     { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#F4F6FA" },
  loaderText:     { marginTop: 12, fontSize: 15, color: "#5B6472", fontWeight: "600" },
  heroImage:      { width: "100%", height: 280, backgroundColor: "#E0E4EC" },
    callPrivacy:        { fontSize: 11, fontWeight: "600", color: "#6B7280", textAlign: "center", marginTop: -4 },
      callLoginBtn:       { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 48, borderRadius: 14, backgroundColor: "#16A34A" },
  callLoginBtnText:   { color: "#fff", fontSize: 14, fontWeight: "800" },
  // 🌙 night quiet hours
  quietBox:           { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#EEF2FF", borderRadius: 14, borderWidth: 1, borderColor: "#C7D2FE", padding: 12 },
  quietTitle:         { fontSize: 14, fontWeight: "800", color: "#312E81" },
  quietSub:           { fontSize: 12, fontWeight: "600", color: "#4338CA", marginTop: 2, lineHeight: 17 },

  //back 
 backBtn: {
  position: "absolute",
  left: 16,
  width: 40,
  height: 40,
  borderRadius: 20,
  backgroundColor: "rgba(0,0,0,0.4)",
  justifyContent: "center",
  alignItems: "center",
  zIndex: 10,
},



  // dots
  dotRow:   { position: "absolute", bottom: 30, left: 0, right: 0, flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 6 },
  dot:      { width: 10,  height: 6, borderRadius: 99, backgroundColor: "rgba(255,255,255,0.45)" },
  dotActive:{ width: 10, height: 6, borderRadius: 99, backgroundColor: "#fff" },

  // header card
  headerCard: { backgroundColor: "#FFFFFF", marginHorizontal: 16, marginTop: -20, borderRadius: 24, padding: 20, shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.08, shadowRadius: 12, elevation: 5 },
  titleRow:   { flexDirection: "row", alignItems: "flex-start" },
  nameLine:   { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  title:      { fontSize: 22, fontWeight: "800", color: "#111111" },
 

  // rating
  ratingBadge: { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: "#111111", paddingHorizontal: 9, paddingVertical: 4, borderRadius: 99, alignSelf: "flex-start", marginTop: 2 },
  ratingStar:  { fontSize: 11, color: "#FACC15" },
  ratingValue: { fontSize: 12, fontWeight: "900", color: "#fff" },

  // right column (sport + share stacked)
  
  sportWrap: { flexDirection: "row", flexWrap: "wrap", gap: 6, justifyContent: "flex-end" },
  sportPill:       { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 },
sportPillText:   { color: "#FFFFFF", fontWeight: "700", fontSize: 12 },
sportIconCircle: { width: 18, height: 18, borderRadius: 9, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" },
  // share button

  // price cards
  priceRow:  { flexDirection: "row", marginTop: 18, gap: 8 },
  priceCard: { flex: 1, backgroundColor: "#F7F8FA", borderRadius: 16, padding: 12 },
   priceLabel:{ color: "#9CA3AF", fontSize: 11, fontWeight: "700", textTransform: "uppercase" },
  priceValue:{ marginTop: 5, color: "#111111", fontSize: 15, fontWeight: "800" },
  priceHintRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8, backgroundColor: "#F0FDF4", borderWidth: 1, borderColor: "#BBF7D0", borderRadius: 12, paddingHorizontal: 10, paddingVertical: 8 },
  priceHintTxt: { flex: 1, fontSize: 11.5, fontWeight: "700", color: "#16A34A" },

location:        { color: "#111827", fontSize: 14, fontWeight: "700", flexShrink: 1 },
locationBlock:   { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 15, gap: 10 },
locRow:          { flexDirection: "row", alignItems: "center", gap: 4 },
distRow:         { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 },
distTxt:         { color: "#16A34A", fontSize: 12, fontWeight: "600" },
locationBtn:     { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#F0FDF4", borderWidth: 1.5, borderColor: "#86EFAC", paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999 },
locationBtnText: { color: "#16A34A", fontWeight: "800", fontSize: 13 },

  // facilities
  facilitiesWrap:      { marginTop: 18 },
  facilitiesTitle:     { fontSize: 13, fontWeight: "800", color: "#111111", marginBottom: 6 },
 facilitiesContainer: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
facilityChip: { width: "31%", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 1, backgroundColor: "#F7F8FA", borderWidth: 1, borderColor: "#E5E7EB", paddingHorizontal: 12, paddingVertical: 5, borderRadius: 12 },
facilityIconWrap: { width: 22, height: 22, borderRadius: 11, backgroundColor: "#F0FDF4", alignItems: "center", justifyContent: "center" },
facilityText:     { color: "#374151", fontSize: 13, fontWeight: "700" },

  // ── turf status banner ──
  statusCard:    { marginHorizontal: 16, marginTop: 12, borderRadius: 18, padding: 14, borderWidth: 1.5 },
  statusTop:     { flexDirection: "row", alignItems: "center", gap: 10 },
  statusEmoji:   { fontSize: 22 },
  statusLabel:   { fontSize: 14, fontWeight: "800" },
  statusNote:    { fontSize: 12, color: "#6B7280", fontWeight: "500", marginTop: 3, lineHeight: 17 },
  statusChip:    { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 99 },
  statusChipTxt: { fontSize: 11, fontWeight: "800" },
  statusTime:    { fontSize: 11, color: "#9CA3AF", fontWeight: "500", marginTop: 8, marginLeft: 32 },

  // section card
  section:      { marginTop: 16, marginHorizontal: 16, backgroundColor: "#FFFFFF", borderRadius: 24, padding: 16, shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 8, elevation: 2 },
  sectionTitle: { color: "#111111", fontSize: 18, fontWeight: "800" },

  // date picker
  dateList:          { paddingTop: 14, paddingBottom: 4 },
 dateBox:           { width: 55, paddingVertical: 10, borderRadius: 12, backgroundColor: "#FCFCFD", borderWidth: 1.5, borderColor: "#E5E7EB", alignItems: "center", marginRight: 10 },
dateBoxSelected:   { backgroundColor: "#16A34A", borderColor: "#16A34A" },
dateDay:           { color: "#6B7280", fontSize: 13, fontWeight: "700", textTransform: "uppercase" },
dateNumber:        { color: "#1A1D21", marginTop: 4, fontSize: 20, fontWeight: "800" },
dateTextSelected:  { color: "#FFFFFF" },
  selectedDateLabel: { marginTop: 12, color: "#9CA3AF", fontSize: 13, fontWeight: "600" },

  // mode switcher
  modeSwitcher:        { flexDirection: "row", backgroundColor: "#F3F4F6", padding: 4, borderRadius: 16, marginTop: 16 },
  modeButton:          { flex: 1, flexDirection: "row", gap: 6, paddingVertical: 12, borderRadius: 13, alignItems: "center", justifyContent: "center", borderWidth: 1.5, borderColor: "transparent" },
modeButtonActive:    { backgroundColor: "#FFFFFF", borderColor: "#86EFAC" },
modeButtonTextActive:{ color: "#16A34A" },

   modeButtonText:      { color: "#6B7280", fontSize: 13, fontWeight: "800" },

  // flexible picker
  flexContainer: { marginTop: 16 },
  flexHeader:    { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 },
  flexTitle:     { fontSize: 16, fontWeight: "800", color: "#111111" },
  flexSubtitle:  { fontSize: 12, color: "#9CA3AF", fontWeight: "500", marginTop: 2 },
  flexClearBtn:  { backgroundColor: "#FEE2E2", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 },
  flexClearText: { color: "#DC2626", fontSize: 12, fontWeight: "700" },

  timeBoxRow:         { flexDirection: "row", alignItems: "center" },
  timeBox:            { flex: 1, backgroundColor: "#F7F8FA", borderRadius: 18, padding: 12, borderWidth: 1.5, borderColor: "#E5E7EB", alignItems: "center" },
  timeBoxActive:      { borderColor: "#111111", backgroundColor: "#FFFFFF" },
  timeBoxFilled:      { borderColor: "#6B7280", backgroundColor: "#FFFFFF" },
  timeBoxDisabled:    { opacity: 0.45 },
  timeBoxLabel:       { fontSize: 10, fontWeight: "800", color: "#9CA3AF", textTransform: "uppercase", letterSpacing: 1 },
  timeBoxValue:       { fontSize: 18, fontWeight: "900", color: "#111111", marginTop: 4 },
  timeBoxPlaceholder: { color: "#D1D5DB", fontSize: 18, fontWeight: "700" },
  timeBoxDot:         { width: 6, height: 6, borderRadius: 3, backgroundColor: "#22C55E", marginTop: 6 },
  timeBoxArrow:       { alignItems: "center", paddingHorizontal: 8 },
  timeBoxArrowText:   { fontSize: 18, color: "#9CA3AF", fontWeight: "700" },
  durationBadge:      { marginTop: 4, fontSize: 9, fontWeight: "800", color: "#FFFFFF", backgroundColor: "#111111", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 999, textAlign: "center" },

  pricePreviewStrip: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: "#F0FDF4", borderRadius: 12, padding: 10, marginTop: 12, borderWidth: 1, borderColor: "#BBF7D0" },
  pricePreviewLabel: { fontSize: 12, color: "#166534", fontWeight: "600" },
  pricePreviewValue: { fontSize: 16, color: "#15803D", fontWeight: "900" },

  slotPanel:      { marginTop: 9 },
  slotPanelInner: { backgroundColor: "#FAFAFA", borderRadius: 18, padding: 14, borderWidth: 1, borderColor: "#EEF0F4" },
  slotPanelTitle: { fontSize: 13, fontWeight: "800", color: "#111111", marginBottom: 9 },
  slotPanelSubtitle: { fontSize: 13, fontWeight: "500", color: "#6B7280" },
  chipRow:        { paddingBottom: 4, gap: 8 },

    slotChip:             { paddingHorizontal: 15, paddingVertical: 11, borderRadius: 16, backgroundColor: "#FFFFFF", borderWidth: 1.5, borderColor: "#E5E7EB", alignItems: "center", justifyContent: "center", minWidth: 84, minHeight: 54 },
  slotChipSelected:     { backgroundColor: "#111111", borderColor: "#111111" },
  slotChipInRange:      { backgroundColor: "#F3F4F6", borderColor: "#9CA3AF" },
  slotChipBooked:       { backgroundColor: "#FEE2E2", borderColor: "#FECACA" },
  slotChipLocked:       { backgroundColor: "#FEF3C7", borderColor: "#FDE68A" },
  slotChipPast:         { backgroundColor: "#F3F4F6", borderColor: "#E5E7EB" },
   slotChipText:         { fontSize: 14, fontWeight: "800", color: "#111111" },
  slotChipTextSelected: { color: "#FFFFFF" },
  slotChipTextInRange:  { color: "#374151" },
  slotChipTextDisabled: { color: "#9CA3AF" },
  slotChipStatus:         { fontSize: 9, fontWeight: "700", color: "#6B7280", marginTop: 2},
  slotChipStatusDisabled: { color: "#9CA3AF" },

  slotLegend:      { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 8 },
  legendItem:      { flexDirection: "row", alignItems: "center", gap: 5 },
  legendDot:       { width: 10, height: 10, borderRadius: 3 },
  legendText:      { fontSize: 10, color: "#6B7280", fontWeight: "600" },
  maxDurationNote: { fontSize: 10, color: "#9CA3AF", fontWeight: "600", marginTop: 10, textAlign: "right" },
  noSlotsText:     { fontSize: 13, color: "#6B7280", fontWeight: "600", textAlign: "center", paddingVertical: 16 },
  validationBox:   { marginTop: 10, backgroundColor: "#FEF2F2", borderRadius: 12, padding: 10 },
  validationText:  { color: "#DC2626", fontSize: 12, fontWeight: "600", lineHeight: 17 },

  // quick slots
  qPriceStrip:   { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 14, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: "#F9FAFB", borderWidth: 1, borderColor: "#EEF0F4", borderRadius: 12 },
  qPriceTxt:     { flexShrink: 1, fontSize: 12.5, fontWeight: "800", color: "#1A1D21" },
  qPriceSub:     { fontSize: 11.5, fontWeight: "600", color: "#6B7280" },
  qOfferStrip:   { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8, paddingHorizontal: 12, paddingVertical: 9, backgroundColor: "#FFF7ED", borderWidth: 1, borderColor: "#FED7AA", borderRadius: 12 },
  qOfferPill:    { height: 18, paddingHorizontal: 6, borderRadius: 9, backgroundColor: "#EA580C", alignItems: "center", justifyContent: "center" },
  qOfferPillTxt: { color: "#FFFFFF", fontSize: 10.5, fontWeight: "900" },
  qOfferTxt:     { flex: 1, fontSize: 12.5, fontWeight: "700", color: "#9A3412" },
  qGrid:         { flexDirection: "row", flexWrap: "wrap", marginTop: 14 },
  qBox:          { width: "32%", height: 44, marginBottom: 8, borderRadius: 12, borderWidth: 1.5, borderColor: "#E5E7EB", backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center", paddingHorizontal: 2 },
  qBoxOffer:     { backgroundColor: "#F0FDF4", borderColor: "#86EFAC" },
  qBoxSelected:  { backgroundColor: "#16A34A", borderColor: "#16A34A" },
  qBoxBooked:    { backgroundColor: "#F3F4F6", borderColor: "#E5E7EB" },
  qTime:         { fontSize: 13, fontWeight: "800", color: "#1A1D21" },
  qOld:          { fontSize: 10.5, fontWeight: "700", color: "#9CA3AF", textDecorationLine: "line-through" },
  qFlipWrap:     { height: FLIP_H, width: "100%", overflow: "hidden" },
  qFlipRow:      { position: "absolute", left: 0, right: 0, top: 0, height: FLIP_H, alignItems: "center", justifyContent: "center" },
  qBadge:        { position: "absolute", top: -7, right: -5, height: 16, paddingHorizontal: 5, borderRadius: 8, backgroundColor: "#EA580C", alignItems: "center", justifyContent: "center" },
  qBadgeTxt:     { color: "#FFFFFF", fontSize: 9.5, fontWeight: "900" },
  qLegend:       { flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 4 },
  qLegendItem:   { flexDirection: "row", alignItems: "center", gap: 5 },
  qLegendDot:    { width: 12, height: 12, borderRadius: 3 },
  qLegendTxt:    { fontSize: 11, fontWeight: "600", color: "#4B5563" },
  qSummary:      { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 14, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: "#F0FDF4", borderWidth: 1, borderColor: "#BBF7D0", borderRadius: 12 },
  qSummaryTxt:   { flex: 1, fontSize: 12.5, fontWeight: "700", color: "#166534" },
  qSummaryAmt:   { fontSize: 16, fontWeight: "900", color: "#15803D" },

  quickInfo:     { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#F0FDF4", borderWidth: 1, borderColor: "#BBF7D0", borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9, marginTop: 14 },
  quickInfoTxt:  { fontSize: 12.5, fontWeight: "800", color: "#15803D" },
  partRow:       { gap: 8, paddingTop: 12, paddingBottom: 2 },
  partChip:      { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 999, backgroundColor: "#F3F4F6", borderWidth: 1, borderColor: "#E5E7EB" },
  partChipOn:    { backgroundColor: "#16A34A", borderColor: "#16A34A" },
  partChipTxt:   { fontSize: 12.5, fontWeight: "800", color: "#4B5563" },
  partChipTxtOn: { color: "#fff" },
  partCount:     { minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 5, backgroundColor: "#E5E7EB", alignItems: "center", justifyContent: "center" },
  partCountOn:   { backgroundColor: "#fff" },
  partCountTxt:  { fontSize: 11, fontWeight: "900", color: "#4B5563" },

  // summary
  summaryRow: {
  flexDirection: "row",
  justifyContent: "space-between",
  alignItems: "center",        // ← yeh zaroori hai vertical align ke liye
  paddingVertical: 5,
},
  summaryCard:    { marginTop: 16, marginHorizontal: 16, backgroundColor: "#FFFFFF", borderRadius: 24, padding: 16, shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 10, elevation: 3 , marginBottom:120,},
  summaryHeader:  { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" },
  summaryLabel:   { color: "#9CA3AF", fontSize: 11, fontWeight: "800", textTransform: "uppercase" },
summaryTime:    { marginTop: 3, color: "#1A1D21", fontSize: 17, fontWeight: "900" },
summaryDivider: { height: 1, backgroundColor: "#F3F4F6", marginVertical: 10 },
summaryKey:   { 
  color: "#6B7280", fontSize: 13, fontWeight: "700",
  width: 80,        // ← fixed width so all labels align
},
summaryValue: { 
  flex: 1, 
  textAlign: "right", 
  color: "#1A1D21", fontSize: 13, fontWeight: "800",
},
summaryTotal:   { color: "#1A1D21", fontSize: 17, fontWeight: "900" },

paymentTitle:             { marginTop: 4, marginBottom: 8, fontSize: 15, fontWeight: "900", color: "#1A1D21" },
paymentTypeRow:           { flexDirection: "row", gap: 12 },
paymentOption:            { flex: 1, borderWidth: 1.5, borderColor: "#E5E7EB", borderRadius: 18, padding: 11, backgroundColor: "#FCFCFD" },
paymentOptionActive:      { backgroundColor: "#F0FDF4", borderColor: "#16A34A", borderWidth: 2 },
paymentOptionLabel:       { fontSize: 13, fontWeight: "800", color: "#6B7280" },
paymentOptionLabelActive: { color: "#16A34A" },
paymentOptionAmount:      { marginTop: 6, fontSize: 17, fontWeight: "900", color: "#1A1D21" },
paymentOptionAmountActive:{ color: "#1A1D21" },
paymentOptionNote:        { marginTop: 4, fontSize: 11, fontWeight: "600", color: "#9CA3AF" },
paymentOptionNoteActive:  { color: "#16A34A" },
paymentOptionCheck:       { position: "absolute", top: 8, right: 8, width: 18, height: 18, borderRadius: 9, backgroundColor: "#16A34A", alignItems: "center", justifyContent: "center", zIndex: 2 },
paymentBreakdown:         { marginTop: 9, backgroundColor: "#F9FAFB", borderRadius: 14, padding: 12 },
clearBtn:       { backgroundColor: "#FEE2E2", paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999 },
  clearBtnText:   { color: "#DC2626", fontSize: 12, fontWeight: "800" },



  // bottom bar
bottomWrapper: {
  position: "absolute",
  bottom: 0,
  width: "100%",
  backgroundColor: "#FFFFFF",
  shadowColor: "#000",
  shadowOffset: { width: 0, height: -4 },
  shadowOpacity: 0.06,
  shadowRadius: 10,
  elevation: 8,
},
bottomBar: {
  flexDirection: "row",
  justifyContent: "space-between",
  alignItems: "center",
  paddingHorizontal: 20,
  paddingTop: 12,
  paddingBottom: 14,   // ← no platform check needed; insets.bottom handles it
  borderTopWidth: 1,
  borderTopColor: "#F0F0F0",
},
  bottomLabel:     { color: "#9CA3AF", fontSize: 10, fontWeight: "800", textTransform: "uppercase" },
  bottomAmount:    { marginTop: 3, color: "#111111", fontSize: 23, fontWeight: "900" },
  bottomRemaining: { marginTop: 2, fontSize: 8, color: "#9CA3AF", fontWeight: "600" },
  bookBtn:         { backgroundColor: "#16A34A", paddingHorizontal: 22, paddingVertical: 10.5, borderRadius: 13, minWidth: 100, alignItems: "center", justifyContent: "center", },
  bookBtnLoading:  { opacity: 0.7 },
  bookBtnText:     { color: "#FFFFFF", fontWeight: "900", fontSize: 15 },

  // mini billing strip
miniStrip: {
  flexDirection: "row",
  alignItems: "center",
  backgroundColor: "#F7F8FA",
  borderTopWidth: 1,
  borderTopColor: "#E5E7EB",
  paddingHorizontal: 20,
  paddingVertical: 10,
},
miniStripTime: {
  fontSize: 14,
  fontWeight: "800",
  color: "#111111",
},
miniStripDuration: {
  fontSize: 11,
  color: "#6B7280",
  fontWeight: "600",
  marginTop: 2,
},
miniStripRight: {
  flexDirection: "row",
  alignItems: "center",
  gap: 10,
},
miniStripTotal: {
  fontSize: 18,
  fontWeight: "900",
  color: "#111111",
},
scrollUpBtn: {
  width: 34,
  height: 34,
  borderRadius: 17,
  backgroundColor: "#111111",
  alignItems: "center",
  justifyContent: "center",
},
scrollUpArrow: {
  color: "#FFFFFF",
  fontSize: 16,
  fontWeight: "900",
  lineHeight: 18,


  // advance pricing 

    lateBanner:     { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#F5F3FF", borderWidth: 1, borderColor: "#DDD6FE", borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9, marginTop: 12 },
  lateBannerShut: { backgroundColor: "#F3F4F6", borderColor: "#E5E7EB" },
  lateBannerTxt:  { fontSize: 12.5, fontWeight: "800", color: "#6D28D9", flex: 1 },
  
},
});

const offerStyles = StyleSheet.create({
  banner:       { flexDirection: "row", alignItems: "center", gap: 12, marginHorizontal: 16, marginTop: 12, borderRadius: 18, padding: 14, backgroundColor: "#16A34A" },
  bannerIcon:   { width: 48, height: 48, borderRadius: 14, backgroundColor: "rgba(255,255,255,0.18)", alignItems: "center", justifyContent: "center" },
  bannerKicker: { fontSize: 10.5, fontWeight: "800", letterSpacing: 0.8, color: "#DCFCE7" },
  bannerTitle:  { fontSize: 16, fontWeight: "900", color: "#fff" },
  bannerSub:    { fontSize: 12, fontWeight: "700", color: "#DCFCE7", marginTop: 1 },
  dateTag:      { fontSize: 8.5, fontWeight: "900", color: "#16A34A", marginTop: 2 },
  oldPrice:     { fontSize: 12, fontWeight: "700", color: "#9CA3AF", textDecorationLine: "line-through" },
  slotTag:      { fontSize: 10.5, fontWeight: "800", color: "#15803D", marginTop: 2 },
});

// ── Turf page restart: name row, VCoin line, offer ticket, book-your-slot card ──
const tp = StyleSheet.create({
  nameRow:      { flexDirection: "row", alignItems: "center", gap: 10 },
  name:         { flex: 1, fontSize: 22, fontWeight: "800", color: "#111111" },
  sportRow:     { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 10 },

  vcoinRow:     { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 12, backgroundColor: "#FEF3C7", borderWidth: 1, borderColor: "#FCD34D" },
  vcoinCoin:    { width: 22, height: 22, borderRadius: 11, backgroundColor: "#F59E0B", borderWidth: 1.5, borderColor: "#FDE68A", alignItems: "center", justifyContent: "center" },
  vcoinCoinTxt: { color: "#7C2D12", fontSize: 11, fontWeight: "900" },
  vcoinTxt:     { flex: 1, fontSize: 12, fontWeight: "800", color: "#78350F" },

  ticket:       { flexDirection: "row", marginTop: 8, borderRadius: 14, overflow: "hidden", borderWidth: 1.5, borderStyle: "dashed", borderColor: "#FB923C", backgroundColor: "#FFF7ED" },
  ticketStub:   { width: 78, backgroundColor: "#EA580C", alignItems: "center", justifyContent: "center", paddingVertical: 10, paddingHorizontal: 6 },
  ticketBig:    { color: "#fff", fontSize: 22, fontWeight: "900", lineHeight: 24 },
  ticketSmall:  { color: "#fff", fontSize: 11, fontWeight: "900", letterSpacing: 1, marginTop: 2 },
  notch:        { position: "absolute", left: 70, width: 16, height: 16, borderRadius: 8, backgroundColor: "#FFFFFF" },
  ticketBody:   { flex: 1, minWidth: 0, paddingHorizontal: 12, paddingVertical: 9 },
  ticketTop:    { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 6 },
  ticketKicker: { fontSize: 9.5, fontWeight: "900", letterSpacing: 0.6, color: "#C2410C" },
  ticketAuto:   { fontSize: 10, fontWeight: "800", color: "#15803D" },
  ticketName:   { fontSize: 14, fontWeight: "900", color: "#7C2D12", marginTop: 1 },
  ticketDetail: { fontSize: 11, fontWeight: "700", color: "#9A3412", marginTop: 2 },

  soonPill:     { alignSelf: "center", flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#EFF6FF", borderWidth: 1, borderColor: "#BFDBFE", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 },
  soonTxt:      { fontSize: 12, fontWeight: "800", color: "#1D4ED8" },

  bookHead:     { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  monthTxt:     { fontSize: 12, fontWeight: "700", color: "#9CA3AF" },
  stepDivider:  { height: 1, backgroundColor: "#F1F3F6", marginTop: 14 },
});

// ── Booking sheet (Confirm booking) ──
const bs = StyleSheet.create({
  header:      { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title:       { fontSize: 18, fontWeight: "900", color: "#1A1D21" },
  closeBtn:    { width: 32, height: 32, borderRadius: 16, backgroundColor: "#F3F4F6", alignItems: "center", justifyContent: "center" },
  bookingCard: { marginTop: 12, flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderWidth: 1, borderColor: "#EEF0F4", borderRadius: 16, backgroundColor: "#F9FAFB" },
  dateBlock:   { width: 52, borderRadius: 12, backgroundColor: "#16A34A", paddingVertical: 6, alignItems: "center" },
  dateDow:     { fontSize: 10.5, fontWeight: "800", color: "#fff", letterSpacing: 0.5 },
  dateDay:     { fontSize: 20, fontWeight: "900", color: "#fff", lineHeight: 23 },
  dateMon:     { fontSize: 10, fontWeight: "700", color: "#DCFCE7" },
  turfName:    { fontSize: 14, fontWeight: "900", color: "#1A1D21" },
  timeTxt:     { fontSize: 13, fontWeight: "800", color: "#15803D", marginTop: 2 },
  metaTxt:     { fontSize: 11.5, fontWeight: "600", color: "#6B7280", marginTop: 2 },
  changeTxt:   { fontSize: 12, fontWeight: "800", color: "#16A34A" },
  offerRow:    { marginTop: 10, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: "#F0FDF4", borderWidth: 1, borderStyle: "dashed", borderColor: "#4ADE80", borderRadius: 14 },
  offerIcon:   { width: 28, height: 28, borderRadius: 8, backgroundColor: "#16A34A", alignItems: "center", justifyContent: "center" },
  offerTitle:  { fontSize: 13, fontWeight: "900", color: "#15803D" },
  offerSub:    { fontSize: 11, fontWeight: "600", color: "#16A34A", marginTop: 1 },
  lineRow:     { marginTop: 8, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: "#EEF0F4", borderRadius: 14, backgroundColor: "#fff" },
  lineTitle:   { fontSize: 12.5, fontWeight: "800", color: "#374151" },
  lineSub:     { fontSize: 11, fontWeight: "600", color: "#6B7280", marginTop: 1 },
  sec:         { fontSize: 11, fontWeight: "800", color: "#9CA3AF", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 16, marginBottom: 8 },
  payOpt:      { flex: 1, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 10, paddingVertical: 9, borderWidth: 1.5, borderColor: "#E5E7EB", borderRadius: 14, backgroundColor: "#fff" },
  payOptOn:    { borderWidth: 2, borderColor: "#16A34A", backgroundColor: "#F0FDF4" },
  radio:       { width: 16, height: 16, borderRadius: 8, borderWidth: 1.5, borderColor: "#D1D5DB", backgroundColor: "#fff" },
  radioOn:     { borderWidth: 5, borderColor: "#16A34A" },
  payAmt:      { fontSize: 13, fontWeight: "900", color: "#1A1D21" },
  payNote:     { fontSize: 10.5, fontWeight: "600", color: "#6B7280" },
  bill:        { backgroundColor: "#F9FAFB", borderRadius: 14, paddingHorizontal: 12, paddingVertical: 8 },
  billRow:     { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 5, gap: 10 },
  billKey:     { flexShrink: 1, fontSize: 13, fontWeight: "600", color: "#6B7280" },
  billVal:     { fontSize: 13, fontWeight: "800", color: "#1A1D21" },
  billLine:    { height: 1, backgroundColor: "#E5E7EB", marginVertical: 5 },
  saveRibbon:  { marginTop: 10, alignItems: "center", paddingVertical: 8, borderRadius: 10, backgroundColor: "#ECFDF5" },
  saveTxt:     { fontSize: 12.5, fontWeight: "800", color: "#15803D" },
  payBar:      { marginHorizontal: -20, marginTop: 8, paddingHorizontal: 20, paddingTop: 12, borderTopWidth: 1, borderTopColor: "#EEF0F4", backgroundColor: "#fff", flexDirection: "row", alignItems: "center", gap: 12 },
  payBarAmt:   { fontSize: 20, fontWeight: "900", color: "#1A1D21" },
  payBarSub:   { fontSize: 11, fontWeight: "600", color: "#6B7280" },
  payBtn:      { flex: 1.4, height: 50, borderRadius: 14, backgroundColor: "#16A34A", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  payBtnTxt:   { color: "#fff", fontSize: 15, fontWeight: "900" },
});

const promoStyles = StyleSheet.create({
  wrap:         { marginTop: 10, paddingTop: 16, borderTopWidth: 1, borderTopColor: "#F3F4F6" },
  sectionTitle: { fontSize: 12, fontWeight: "700", color: "#6B7280", marginBottom: 10, textTransform: "uppercase", letterSpacing: 0.4 },
 
  inputRow:     { flexDirection: "row", gap: 10 },
  input:        { flex: 1, backgroundColor: "#F9FAFB", borderWidth: 1.5, borderColor: "#E5E7EB", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: "#111111", fontWeight: "700", letterSpacing: 1 },
  applyBtn:     { backgroundColor: "#111111", paddingHorizontal: 20, paddingVertical: 12, borderRadius: 12, justifyContent: "center", alignItems: "center", minWidth: 70 },
  applyBtnDisabled:{ opacity: 0.45 },
  applyBtnTxt:  { color: "#fff", fontWeight: "800", fontSize: 14 },
 
appliedBox:     { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "#F0FDF4", borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: "#86EFAC" },
  appliedLeft:    { flexDirection: "row", alignItems: "center", flex: 1, gap: 8 },
  appliedBadge:   { backgroundColor: "#111111", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  appliedBadgeTxt:{ color: "#fff", fontWeight: "800", fontSize: 12, letterSpacing: 0.5 },
  appliedDesc:    { fontSize: 12, color: "#15803D", fontWeight: "600", flex: 1 },
  appliedSaving:  { display: "none" as const },
  removeBtn:      { padding: 4 },

  errorBox:     { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 6, backgroundColor: "#FEF2F2", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  errorTxt:     { fontSize: 12, color: "#DC2626", fontWeight: "600", flex: 1 },
 
});

const coinStyles = StyleSheet.create({
  // Strip — shown under header card, above status banner
  strip: {
    flexDirection:    "row",
    alignItems:       "center",
    backgroundColor:  "#F5F3FF",
    borderRadius:     16,
    borderWidth:      1,
    borderColor:      "#DDD6FE",
    paddingHorizontal: 14,
    paddingVertical:   11,
    marginHorizontal:  16,
    marginTop:         10,
  },
  iconCircle: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: "#EDE9FE",
    justifyContent: "center", alignItems: "center",
  },
  pillsRow: { flexDirection: "row", flexWrap: "wrap", gap: 5, marginBottom: 3 },
  pill: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 99,
  },
  pillDot: { width: 5, height: 5, borderRadius: 3 },
  pillTxt: { fontSize: 11, fontWeight: "800" },
  sub:     { fontSize: 11, color: "#6B7280", fontWeight: "600" },
 
  // Earn note — shown in billing modal above Pay button
  earnNote: {
    flexDirection:   "row",
    alignItems:      "flex-start",
    backgroundColor: "#FAFAF0",
    borderRadius:    12,
    borderWidth:     1,
    borderColor:     "#E9E9B8",
    padding:         12,
    marginBottom:    10,
  },
  earnTitle:     { fontSize: 12, fontWeight: "800", color: "#374151", marginBottom: 5 },
  earnPillsRow:  { flexDirection: "row", flexWrap: "wrap", gap: 5, marginBottom: 5 },
  earnPill:      { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 99 },
  earnPillTxt:   { fontSize: 11, fontWeight: "800" },
  earnSub:       { fontSize: 10, color: "#9CA3AF", fontWeight: "600", lineHeight: 15 },

  
});

const coinRedeemStyles = StyleSheet.create({
  wrap: {
    marginTop: 8,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: "#F3F4F6",
  },
  sectionTitle: {
    fontSize: 11, fontWeight: "700", color: "#6B7280",
    marginBottom: 7, textTransform: "uppercase", letterSpacing: 0.4,
  },
  cardsRow: {
    flexDirection: "row",
    gap: 6,
  },
coinCard: {
    flex: 1,
    backgroundColor: "#F9FAFB",
    borderRadius: 12,
    padding: 6,
    borderWidth: 1.5,
    borderColor: "#E5E7EB",
    marginBottom: 5,
    minHeight: 84,    // ← badge ke liye space
  },
  coinCardActive: {
    backgroundColor: "#F5F3FF",
    borderColor: "#7C3AED",
    borderWidth: 2,        // ← explicitly same
  },
  coinCardActiveAmber: {
    backgroundColor: "#FFFBEB",
    borderColor: "#D97706",
    borderWidth: 2,        // ← explicitly same
  },
  coinCardDisabled: {
    opacity: 0.45,
  },
  cardTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 5,
  },
  checkbox: {
    width: 18, height: 18, borderRadius: 9,
    borderWidth: 2, borderColor: "#D1D5DB",
    backgroundColor: "#fff",
    alignItems: "center", justifyContent: "center",
  },
 checkboxActive: {
    backgroundColor: "#7C3AED",
    borderColor: "#7C3AED",
    borderWidth: 0,
  },
  checkboxAmber: {
    backgroundColor: "#D97706",
    borderColor: "#D97706",
    borderWidth:0,
  },
  coinLabel: {
    fontSize: 12, fontWeight: "900", color: "#111111", marginBottom: 1,
  },
  coinBalance: {
    fontSize: 11, fontWeight: "700", color: "#374151", marginBottom: 1,
  },
  coinOff: {
    fontSize: 10, fontWeight: "600", color: "#6B7280",
  },
 usedBadge: {
    position: "absolute",
    bottom: 8,
    right: 8,
    backgroundColor: "#EDE9FE",
    borderRadius: 6,
    borderWidth: 1, borderColor: "#DDD6FE",
    paddingHorizontal: 6, paddingVertical: 3,
  },
  usedBadgeTxt: {
    fontSize: 11, fontWeight: "800", color: "#7C3AED",
  },
 
});

const pi = StyleSheet.create({
  backdrop:     { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet:        { backgroundColor: "#fff", borderTopLeftRadius: 28, borderTopRightRadius: 28, maxHeight: "85%", paddingHorizontal: 20, paddingTop: 12 },
  handle:       { width: 44, height: 4, borderRadius: 2, backgroundColor: "#E5E7EB", alignSelf: "center", marginBottom: 14 },
  header:       { flexDirection: "row", alignItems: "flex-start", marginBottom: 14 },
  title:        { fontSize: 20, fontWeight: "900", color: "#111111" },
  sub:          { fontSize: 13, color: "#6B7280", fontWeight: "600", marginTop: 2 },
  closeBtn:     { width: 34, height: 34, borderRadius: 17, backgroundColor: "#F3F4F6", alignItems: "center", justifyContent: "center" },
 
  tabRow:       { flexDirection: "row", backgroundColor: "#F3F4F6", padding: 4, borderRadius: 14, marginBottom: 12 },
  tab:          { flex: 1, paddingVertical: 9, borderRadius: 11, alignItems: "center" },
  tabActive:    { backgroundColor: "#16A34A" },
  tabTxt:       { fontSize: 13, fontWeight: "800", color: "#6B7280" },
  tabTxtActive: { color: "#fff" },
 
  todayNote:    { backgroundColor: "#F0FDF4", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7, marginBottom: 10, borderWidth: 1, borderColor: "#BBF7D0" },
  todayNoteTxt: { fontSize: 11.5, fontWeight: "700", color: "#15803D" },
 
  slabRow:      { flexDirection: "row", alignItems: "center", backgroundColor: "#F9FAFB", borderRadius: 14, borderWidth: 1.5, borderColor: "#F3F4F6", paddingHorizontal: 14, paddingVertical: 12, marginBottom: 8 },
  slabRowNow:   { backgroundColor: "#F0FDF4", borderColor: "#86EFAC" },
  slabTime:     { fontSize: 14, fontWeight: "800", color: "#111111" },
  slabNowTxt:   { fontSize: 10.5, fontWeight: "700", color: "#9CA3AF", marginTop: 2 },
  slabRate:     { fontSize: 17, fontWeight: "900", color: "#111111" },
  slabUnit:     { fontSize: 11, fontWeight: "700", color: "#9CA3AF" },
  emptyTxt:     { fontSize: 13, color: "#6B7280", fontWeight: "600", textAlign: "center", paddingVertical: 18 },
  footNote:     { fontSize: 11, color: "#9CA3AF", fontWeight: "600", lineHeight: 16, marginTop: 4 },
 
  specialWrap:  { marginTop: 14, backgroundColor: "#FFFBEB", borderRadius: 14, borderWidth: 1, borderColor: "#FDE68A", padding: 12 },
  specialTitle: { fontSize: 12, fontWeight: "800", color: "#B45309", marginBottom: 8 },
  specialRow:   { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 },
  specialSlot:  { fontSize: 12, fontWeight: "700", color: "#92400E" },
  specialVal:   { fontSize: 10, fontWeight: "900", color: "#92400E" },
 
  advanceBox:   { flexDirection: "row", alignItems: "center", backgroundColor: "#111111", borderRadius: 16, padding: 14, marginTop: 16 },
  advanceLabel: { fontSize: 13, fontWeight: "800", color: "#fff" },
  advanceSub:   { fontSize: 11, fontWeight: "600", color: "rgba(255,255,255,0.6)", marginTop: 2 },
  advanceVal:   { fontSize: 18, fontWeight: "900", color: "#fff" },
 
  gotItBtn:     { backgroundColor: "#16A34A", borderRadius: 14, paddingVertical: 14, alignItems: "center", marginTop: 14 },
  gotItTxt:     { color: "#fff", fontSize: 15, fontWeight: "900" },
});
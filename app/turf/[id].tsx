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
   Keyboard
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
import RazorpayCheckout from "react-native-razorpay";
import { Ionicons } from "@expo/vector-icons";
import { MaterialCommunityIcons } from "@expo/vector-icons";


import { db, auth } from "../../firebaseConfig";
import { useRouter } from "expo-router";
import { useFocusEffect } from "expo-router";
// add to existing RN imports

type BookingType = "advance" | "full";
type BookingMode = "flexible" | "quick";

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

const FALLBACK_IMAGE =
  "https://media.istockphoto.com/id/1405637348/photo/red-cricket-ball.jpg?s=612x612&w=0&k=20&c=DBkyp2Pp7AZOtqJrn9daux-NHl7ZwdDC5VnH8mCSZrE=";

const MAX_BOOKING_HOURS = 2;
const MIN_BOOKING_HOURS = 1;

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

const SPORT_STYLE: Record<string, { bg: string; icon: keyof typeof Ionicons.glyphMap }> = {
  Cricket:    { bg: "#16A34A", icon: "baseball-outline" },
  Football:   { bg: "#0B1220", icon: "football-outline" },
  Basketball: { bg: "#EA580C", icon: "basketball-outline" },
  Tennis:     { bg: "#65A30D", icon: "tennisball-outline" },
  Badminton:  { bg: "#7C3AED", icon: "tennisball-outline" },
  Pickleball: { bg: "#0891B2", icon: "tennisball-outline" },
  Volleyball: { bg: "#0EA5E9", icon: "ellipse-outline" },
};

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

  const [loading,     setLoading]     = useState(false);
  const [pageLoading, setPageLoading] = useState(true);

  const currentLocksRef = useRef<any[]>([]);
  const abortRef = useRef<AbortController | null>(null);
const paymentCancelledRef = useRef(false);
  const scrollRef       = useRef<ScrollView>(null);
  const days            = useMemo(() => getNextDays(), []);

  const fromPanelAnim = useRef(new Animated.Value(0)).current;
  const toPanelAnim   = useRef(new Animated.Value(0)).current;
  const [refreshing, setRefreshing] = useState(false);

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

const [showBilling, setShowBilling] = useState(false);

const [promoFocused, setPromoFocused] = useState(false);
const [kbHeight, setKbHeight] = useState(0);
const [userCoords, setUserCoords] = useState<{ lat: number; lng: number } | null>(null);

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
  function getNextDays(): Date[] {
    return Array.from({ length: 5 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() + i);
      return d;
    });
  }

  function formatTime(value: number): string {
    if (value === 0 || value === 24) return "12:00 AM";
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
    if (!isToday(selectedDate)) return false;
    return startValue < getCurrentDecimalTime();
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
    const startValue = parseDisplayTime(parts[0]);
    let   endValue   = parseDisplayTime(parts[1]);
    if (endValue <= startValue) endValue = 24;
    return { start: startValue, end: endValue };
  }

  function rangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number) {
    return aStart < bEnd && bStart < aEnd;
  }

  function buildTimeRange(start: number, end: number): string[] {
    const safeEnd = Math.min(end, 24);
    const ranges: string[] = [];
    for (let time = start; time < safeEnd; time += 0.5) {
      const next = Math.min(time + 0.5, safeEnd);
      ranges.push(`${formatTime(time)} - ${formatTime(next)}`);
    }
    return ranges;
  }

  function getRateForTime(time: number) {
    if (!turf) return 0;
    if (time >= 6 && time < 18) return Number(turf.dayPrice   || turf.price || 0);
    return                              Number(turf.nightPrice || turf.price || 0);
  }

  function getRangePrice(start: number, end: number): number {
    const safeEnd = Math.min(end, 24);
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
    for (let t = openingTime; t < closingTime && t < 24; t += STEP) {
      if (isPastTime(t)) continue;
      let status: SlotChip["status"] = "available";
      const isBooked = bookedSlots.some((s) => {
        if (s === `${formatTime(t)} - ${formatTime(Math.min(t + STEP, 24))}`) return true;
        try { const p = parseSlotRange(s); return rangesOverlap(t, t + STEP, p.start, p.end); }
        catch { return false; }
      });
      const isLocked = lockedSlots.some((s) => {
        try { const p = parseSlotRange(s); return rangesOverlap(t, t + STEP, p.start, p.end); }
        catch { return false; }
      });
      if (isBooked)      status = "booked";
      else if (isLocked) status = "locked";
      chips.push({ value: t, label: formatTime(t), status });
    }
    return chips;
  }, [turf, openingTime, closingTime, bookedSlots, lockedSlots, selectedDate]);

  const fromChips = useMemo<SlotChip[]>(() => allTimePoints, [allTimePoints]);

  const toChips = useMemo<SlotChip[]>(() => {
    if (flexStart === null) return [];
    const chips: SlotChip[] = [];
    const minEnd = flexStart + MIN_BOOKING_HOURS;
    const maxEnd = flexStart + MAX_BOOKING_HOURS;
    for (let t = minEnd; t <= closingTime && t <= 24 && t <= maxEnd; t += STEP) {
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
        selectedEndValue <= selectedStartValue || selectedEndValue > 24) return 0;
    return Math.round((selectedEndValue - selectedStartValue) * 60);
  }, [selectedStartValue, selectedEndValue]);

  const selectedSlots = useMemo(() => {
    if (selectedStartValue === null || selectedEndValue === null ||
        selectedEndValue <= selectedStartValue || selectedEndValue > 24 ||
        durationMinutes > MAX_BOOKING_HOURS * 60) return [];
    return buildTimeRange(selectedStartValue, selectedEndValue);
  }, [selectedStartValue, selectedEndValue, durationMinutes]);

  const selectedTimeLabel = useMemo(() => {
    if (selectedStartValue === null || selectedEndValue === null ||
        selectedEndValue <= selectedStartValue || selectedEndValue > 24) return "";
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
        selectedEndValue <= selectedStartValue || selectedEndValue > 24) return 0;
    return getRangePrice(selectedStartValue, selectedEndValue);
  }, [selectedStartValue, selectedEndValue, specialPrices, turf]);

  const advanceAmount = useMemo(() => {
    if (bookingType === "full") return totalPrice;
    return Number(turf?.bookingPrice || 0);
  }, [bookingType, totalPrice, turf]);

  

  const remainingAmount = useMemo(() => {
    if (bookingType === "full") return 0;
    return Math.max(totalPrice - advanceAmount, 0);
  }, [bookingType, totalPrice, advanceAmount]);

  const finalAdvanceAmount = useMemo(() => {
  return Math.max(advanceAmount - discountAmount, 0);
}, [advanceAmount, discountAmount]);

  const quickSlots = useMemo<TimeRange[]>(() => {
    if (!turf) return [];
    const generated: TimeRange[] = [];
    const duration = slotDuration / 60;
    for (let time = openingTime; time + duration <= closingTime && time + duration <= 24; time += duration) {
      if (isPastTime(time)) continue;
      generated.push({
        time:       `${formatTime(time)} - ${formatTime(time + duration)}`,
        startValue: time,
        endValue:   time + duration,
      });
    }
    return generated;
  }, [turf, openingTime, closingTime, slotDuration, selectedDate]);

  const hasValidSelection =
    selectedStartValue !== null &&
    selectedEndValue   !== null &&
    selectedEndValue <= 24 &&
    selectedEndValue > selectedStartValue &&
    durationMinutes <= MAX_BOOKING_HOURS * 60 &&
    durationMinutes  > 0 &&
    !isPastTime(selectedStartValue) &&
    !isRangeUnavailable(selectedStartValue, selectedEndValue);

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
     setPromoApplied(null);   // ← ADD
    setPromoCode("");         // ← ADD
    setPromoError("");   
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
    if (selectedQuickSlots.length >= 2) {
      Alert.alert("Maximum Limit", "You can book maximum 2 quick slots at a time.");
      return;
    }
    setSelectedQuickSlots([...selectedQuickSlots, slot].sort((a, b) => a.startValue - b.startValue));
  }

  // ── Validation ────────────────────────────────────────────────────────────────
  function validateSelection(showAlert = true) {
    if (selectedStartValue === null) { if (showAlert) Alert.alert("Select Start Time", "Please select a start time first."); return false; }
    if (selectedEndValue === null)   { if (showAlert) Alert.alert("Select End Time", "Please select an end time."); return false; }
    if (selectedEndValue > 24)       { if (showAlert) Alert.alert("Invalid Time", "Booking cannot go beyond 12:00 AM."); return false; }
    if (selectedEndValue <= selectedStartValue) { if (showAlert) Alert.alert("Invalid Time Selection", "End time must be after start time."); return false; }
    if (durationMinutes > MAX_BOOKING_HOURS * 60) { if (showAlert) Alert.alert("Booking Limit Exceeded", `Maximum ${MAX_BOOKING_HOURS} hours allowed.`); return false; }
    if (selectedStartValue < openingTime || selectedEndValue > closingTime) { if (showAlert) Alert.alert("Outside Turf Hours", `Please select between ${formatTime(openingTime)} and ${formatTime(closingTime)}`); return false; }
    if (isPastTime(selectedStartValue)) { if (showAlert) Alert.alert("Time Over", "This slot has already passed."); return false; }
    if (isRangeUnavailable(selectedStartValue, selectedEndValue)) { if (showAlert) Alert.alert("Slot Unavailable", "This slot overlaps with an already booked slot."); return false; }
    return true;
  }

  // ── Promo code ───────────────────────────────────────────────────────────────
  const applyPromo = async () => {
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
  onlineAmount:  advanceAmount,      // ← use this to totalprice advanceAmount
  bookingType,
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
          discount:  promoApplied?.discount  || 0,     // ← ADD
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
        description: "Turf Booking",
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

  const fromPanelHeight = fromPanelAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 220] });
  const toPanelHeight   = toPanelAnim.interpolate(  { inputRange: [0, 1], outputRange: [0, 220] });

  const statusCfg = turf.status ? STATUS_CONFIG[turf.status] : null;

  

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
        </View>

        {/* ── Header Card ── */}
        <View style={styles.headerCard}>

          {/* Name row + rating + share */}
         {/* Name + rating (left)  |  Sport pills (right) */}
<View style={styles.titleRow}>
  <View style={{ flex: 1, marginRight: 10 }}>
    <View style={styles.nameLine}>
      <Text style={[styles.title, { flex: 1 }]} numberOfLines={2}>{turf.name}</Text>
      {ratingValue && (
        <View style={styles.ratingBadge}>
          <Text style={styles.ratingStar}>★</Text>
          <Text style={styles.ratingValue}>{ratingValue}</Text>
        </View>
      )}
    </View>
  </View>

<View style={styles.sportWrap}>
  {(Array.isArray(turf.sport) ? turf.sport : [turf.sport || "Sport"]).map((item, index) => (
    <SportPill key={index} sport={item as string} />
  ))}
</View>
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

          {/* Price cards */}
          <View style={styles.priceRow}>
            {[["Day", turf.dayPrice], ["Night", turf.nightPrice], ["Advance", turf.bookingPrice]].map(([label, val]) => (
              <View key={label as string} style={styles.priceCard}>
                <Text style={styles.priceLabel}>{label as string}</Text>
                <Text style={styles.priceValue}>₹{val || 0}</Text>
              </View>
            ))}
          </View>

          

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

        {/* ── Date Picker ── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Choose Date</Text>
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
                </TouchableOpacity>
              );
            }}
          />
          <Text style={styles.selectedDateLabel}>{formatFullDate(selectedDate)}</Text>
        </View>

        {/* ── Booking Mode + Picker ── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Book Your Time</Text>

          <View style={styles.modeSwitcher}>
            {(["flexible", "quick"] as BookingMode[]).map((mode) => (
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
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
                    {fromChips.map((chip) => (
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
                  <Text style={styles.maxDurationNote}>Minimum 1 hour • Maximum {MAX_BOOKING_HOURS} hours</Text>
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
            <View style={styles.quickSlotGrid}>
            {quickSlots.map((slot) => {
  const past     = isPastTime(slot.startValue);
  const disabled = isRangeUnavailable(slot.startValue, slot.endValue) || past;
  const selected = selectedQuickSlots.some((s) => s.time === slot.time);
  return (
    <TouchableOpacity
      key={slot.time} disabled={disabled}
      style={[styles.quickSlotCard, selected && styles.quickSlotCardActive, disabled && styles.quickSlotCardDisabled]}
      onPress={() => handleQuickSlotSelect(slot)}
      activeOpacity={0.8}
    >
      {selected && (
        <View style={styles.quickSlotCheck}>
          <Ionicons name="checkmark" size={12} color="#FFFFFF" />
        </View>
      )}
      <Text style={[styles.quickSlotTime, selected && styles.quickSlotTimeActive, disabled && styles.quickSlotTextDisabled]}>{slot.time}</Text>
      <Text style={[styles.quickSlotPrice, disabled && styles.quickSlotTextDisabled]}>₹{getRangePrice(slot.startValue, slot.endValue)}</Text>
      <Text style={[styles.quickSlotStatus, selected && styles.quickSlotStatusActive, disabled && styles.quickSlotTextDisabled]}>
        {past ? "Time Over" : disabled ? "Unavailable" : selected ? "Selected" : "Available"}
      </Text>
    </TouchableOpacity>
  );
})}
            </View>
          )}
        </View>

        {/* ── Booking Summary ── */}
        
        
        <View style={{ height: 130 }} />
      </ScrollView>

      {/* ── Bottom Bar ── */}
     {/* ── Sticky Mini Billing Strip (shows when slot selected, above bottom bar) ── */}
{hasValidSelection && (
  <View style={[styles.bottomWrapper, { paddingBottom: insets.bottom }]}>
    <View style={styles.bottomBar}>
      <View style={{ flex: 1 }}>
        <Text style={styles.bottomLabel}>Advance booking amount</Text>
        <Text style={styles.bottomAmount}>₹{advanceAmount}</Text>
        <Text style={styles.bottomRemaining}>{selectedTimeLabel} · {durationLabel}</Text>
      </View>
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
    <View style={{ backgroundColor: "#fff", borderTopLeftRadius: 28, borderTopRightRadius: 28, maxHeight: "90%", paddingHorizontal: 20, paddingTop: 12, paddingBottom: insets.bottom + 16 + kbHeight }}>
      <View style={{ width: 44, height: 4, borderRadius: 2, backgroundColor: "#E5E7EB", alignSelf: "center", marginBottom: 16 }} />
      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

        <View style={styles.summaryHeader}>
          <View>
            <Text style={styles.summaryLabel}>Booking Summary</Text>
            <Text style={styles.summaryTime}>{selectedTimeLabel}</Text>
          </View>
         <TouchableOpacity style={styles.clearBtn} onPress={requestCloseBilling}>
  <Text style={styles.clearBtnText}>Close</Text>
</TouchableOpacity>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryRow}><Text style={styles.summaryKey}>Date</Text><Text style={styles.summaryValue}>{formatFullDate(selectedDate)}</Text></View>
        <View style={styles.summaryRow}><Text style={styles.summaryKey}>Duration</Text><Text style={styles.summaryValue}>{durationLabel}</Text></View>
        <View style={styles.summaryRow}><Text style={styles.summaryKey}>Total</Text><Text style={styles.summaryTotal}>₹{totalPrice}</Text></View>

        <Text style={styles.paymentTitle}>Payment Type</Text>
<View style={styles.paymentTypeRow}>
  {(["advance", "full"] as BookingType[]).map((type) => {
    const active = bookingType === type;
    return (
      <TouchableOpacity
        key={type}
        style={[styles.paymentOption, active && styles.paymentOptionActive]}
        onPress={() => setBookingType(type)}
        activeOpacity={0.85}
      >
        {active && (
          <View style={styles.paymentOptionCheck}>
            <Ionicons name="checkmark" size={11} color="#FFFFFF" />
          </View>
        )}
        <Text style={[styles.paymentOptionLabel, active && styles.paymentOptionLabelActive]}>{type === "advance" ? "Advance" : "Full Payment"}</Text>
        <Text style={[styles.paymentOptionAmount, active && styles.paymentOptionAmountActive]}>₹{type === "advance" ? (turf.bookingPrice || 0) : totalPrice}</Text>
        <Text style={[styles.paymentOptionNote, active && styles.paymentOptionNoteActive]}>{type === "advance" ? "Pay rest at turf" : "Paid online"}</Text>
      </TouchableOpacity>
    );
  })}
</View>

        <View style={promoStyles.wrap}>
          <Text style={promoStyles.sectionTitle}>Have a promo code?</Text>
          {promoApplied ? (
            <View style={promoStyles.appliedBox}>
              <View style={promoStyles.appliedLeft}>
                <View style={promoStyles.appliedBadge}><Text style={promoStyles.appliedBadgeTxt}>🎟️ {promoApplied.code}</Text></View>
                <Text style={promoStyles.appliedDesc} numberOfLines={1}>₹{promoApplied.discount} off applied</Text>
              </View>
              <TouchableOpacity style={promoStyles.removeBtn} onPress={removePromo}><Text style={{ fontSize: 16, color: "#6B7280" }}>✕</Text></TouchableOpacity>
            </View>
          ) : (
            <View style={promoStyles.inputRow}>
              <TextInput style={promoStyles.input} placeholder="Enter code" placeholderTextColor="#9CA3AF" value={promoCode} onChangeText={(v) => { setPromoCode(v.toUpperCase()); setPromoError(""); }} autoCapitalize="characters" returnKeyType="done" onSubmitEditing={applyPromo} />
              <TouchableOpacity style={[promoStyles.applyBtn, (!promoCode.trim() || promoLoading) && promoStyles.applyBtnDisabled]} onPress={applyPromo} disabled={!promoCode.trim() || promoLoading}>
                {promoLoading ? <ActivityIndicator size="small" color="#fff" /> : <Text style={promoStyles.applyBtnTxt}>Apply</Text>}
              </TouchableOpacity>
            </View>
          )}
          {!!promoError && <View style={promoStyles.errorBox}><Text style={promoStyles.errorTxt}>⚠ {promoError}</Text></View>}
        </View>

        <View style={styles.paymentBreakdown}>
          {discountAmount > 0 && (
            <View style={styles.summaryRow}><Text style={[styles.summaryKey, { color: "#16A34A" }]}>Promo ({promoApplied?.code})</Text><Text style={[styles.summaryValue, { color: "#16A34A" }]}>− ₹{discountAmount}</Text></View>
          )}
          <View style={styles.summaryRow}><Text style={styles.summaryKey}>Pay now</Text><Text style={[styles.summaryValue, discountAmount > 0 && { color: "#16A34A", fontWeight: "900" as const }]}>₹{finalAdvanceAmount}</Text></View>
          <View style={styles.summaryRow}><Text style={styles.summaryKey}>Remaining at turf</Text><Text style={styles.summaryValue}>₹{remainingAmount}</Text></View>
        </View>

        <TouchableOpacity style={[styles.bookBtn, { marginTop: 16 },{backgroundColor:"#16A34A"}, loading && styles.bookBtnLoading]} onPress={handlePayment} disabled={loading}>
          {loading ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.bookBtnText}>Pay ₹{finalAdvanceAmount} & Book</Text>}
        </TouchableOpacity>
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
  screen:         { flex: 1, backgroundColor: "#F4F6FA" },
  scrollContent:  { paddingBottom: 100 },
  loaderWrap:     { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#F4F6FA" },
  loaderText:     { marginTop: 12, fontSize: 15, color: "#5B6472", fontWeight: "600" },
  heroImage:      { width: "100%", height: 280, backgroundColor: "#E0E4EC" },

  // dots
  dotRow:   { position: "absolute", bottom: 40, left: 0, right: 0, flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 6 },
  dot:      { width: 10,  height: 6, borderRadius: 99, backgroundColor: "rgba(255,255,255,0.45)" },
  dotActive:{ width: 10, height: 6, borderRadius: 99, backgroundColor: "#fff" },

  // header card
  headerCard: { backgroundColor: "#FFFFFF", marginHorizontal: 16, marginTop: -32, borderRadius: 24, padding: 20, shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.08, shadowRadius: 12, elevation: 5 },
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
  priceValue:{ marginTop: 5, color: "#111111", fontSize: 17, fontWeight: "800" },

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

  slotChip:             { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 14, backgroundColor: "#FFFFFF", borderWidth: 1.5, borderColor: "#E5E7EB", alignItems: "center", minWidth: 72 },
  slotChipSelected:     { backgroundColor: "#111111", borderColor: "#111111" },
  slotChipInRange:      { backgroundColor: "#F3F4F6", borderColor: "#9CA3AF" },
  slotChipBooked:       { backgroundColor: "#FEE2E2", borderColor: "#FECACA" },
  slotChipLocked:       { backgroundColor: "#FEF3C7", borderColor: "#FDE68A" },
  slotChipPast:         { backgroundColor: "#F3F4F6", borderColor: "#E5E7EB" },
  slotChipText:         { fontSize: 13, fontWeight: "800", color: "#111111" },
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
 quickSlotCard:         { width: "48.5%", backgroundColor: "#FCFCFD", borderWidth: 1.5, borderColor: "#E5E7EB", borderRadius: 18, padding: 10, marginTop: 8, minHeight: 76 },
 quickSlotGrid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", marginTop: 10 },
quickSlotCardActive:   { backgroundColor: "#F0FDF4", borderColor: "#16A34A", borderWidth: 2 },
quickSlotCardDisabled: { backgroundColor: "#F3F4F6", opacity: 0.65 },
quickSlotTime:         { color: "#1A1D21", fontSize: 12, fontWeight: "800", lineHeight: 17 },
quickSlotTimeActive:   { color: "#16A34A" },
quickSlotPrice:        { marginTop: 8, color: "#1A1D21", fontSize: 14, fontWeight: "900" },
quickSlotStatus:       { marginTop: 3, color: "#6B7280", fontSize: 11, fontWeight: "700" },
quickSlotStatusActive: { color: "#16A34A" },
quickSlotTextDisabled: { color: "#9CA3AF" },
quickSlotCheck:        { position: "absolute", top: 8, right: 8, width: 20, height: 20, borderRadius: 10, backgroundColor: "#16A34A", alignItems: "center", justifyContent: "center", zIndex: 2 },

  // summary
  summaryCard:    { marginTop: 16, marginHorizontal: 16, backgroundColor: "#FFFFFF", borderRadius: 24, padding: 16, shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 10, elevation: 3 , marginBottom:120,},
  summaryHeader:  { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" },
  summaryLabel:   { color: "#9CA3AF", fontSize: 11, fontWeight: "800", textTransform: "uppercase" },
summaryTime:    { marginTop: 3, color: "#1A1D21", fontSize: 17, fontWeight: "900" },
summaryDivider: { height: 1, backgroundColor: "#F3F4F6", marginVertical: 10 },
summaryKey:     { color: "#6B7280", fontSize: 13, fontWeight: "700" },
summaryValue:   { flex: 1, textAlign: "right", color: "#1A1D21", fontSize: 13, fontWeight: "800" },
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
  bookBtn:         { backgroundColor: "#16A34A", paddingHorizontal: 22, paddingVertical: 10.5, borderRadius: 13, minWidth: 100, alignItems: "center", justifyContent: "center" },
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
},
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
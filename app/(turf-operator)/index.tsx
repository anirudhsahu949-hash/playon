import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  SafeAreaView,
  StatusBar,
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  Platform,
  Modal,
} from "react-native";
import { useEffect, useState, useMemo, useRef } from "react";
import { db, auth } from "../../firebaseConfig";
import {
  collection,
  query,
  where,
  getDocs,
  doc,
  getDoc,
  updateDoc,
} from "firebase/firestore";
import { signOut, onAuthStateChanged } from "firebase/auth";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";

const DARK   = "#081120";
const ACCENT = "#0EA5A4";

// ─────────────────────────────────────────────────────────────────────────────
// STATS RULES (read before editing stats useMemo)
// ─────────────────────────────────────────────────────────────────────────────
//
//  COLLECTED = cash physically at the venue (today only)
//    Offline: paidAmount (cash taken at walk-in)
//           + remainingAmount IF slot is past (auto-collected at close of play)
//    Online:  remainingAmount IF slot is past OR remainingCollected===true
//             (Razorpay advance is NEVER counted — goes to owner's account)
//
//  PENDING = cash still owed at venue (today only, slot NOT yet past)
//    Offline: remainingAmount (partial payment, slot still upcoming)
//    Online:  remainingAmount (not yet collected, slot still upcoming)
//
// ── Types ─────────────────────────────────────────────────────────────────────
type Booking = {
  id: string;
  userName?: string;
  userPhone?: string;
  userEmail?: string;
  turfName?: string;
  turfId?: string;
  selectedSlots?: string[];
  dateString?: string;
  date?: any;
  status?: string;
  paymentStatus?: string;
  totalAmount?: number;
  paidAmount?: number;
  advanceAmount?: number;
  remainingAmount?: number;
  bookingType?: string;
  arrived?: boolean;
  remainingCollected?: boolean;
  isOffline?: boolean;
  offlineDocId?: string;
  customerName?: string;
  customerPhone?: string;
  note?: string;
  offlineAmount?: string;
};

type OperatorProfile = {
  name?: string;
  email?: string;
  phone?: string;
  turfName?: string;
  turfId?: string;
  turfIds?: string[];
  ownerId?: string;
};

// ── Date helpers ──────────────────────────────────────────────────────────────
function getSafeDate(val: any): Date | null {
  if (!val) return null;
  if (val?.toDate) return val.toDate();
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
}

function toMidnight(d: Date): Date {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

function getBookingDateStr(b: Booking): string | null {
  const raw = b.dateString || b.date;
  if (!raw) return null;
  if (typeof raw === "string") return raw;
  const d = getSafeDate(raw);
  return d ? d.toDateString() : null;
}

function isTodayBooking(b: Booking): boolean {
  return getBookingDateStr(b) === new Date().toDateString();
}

// ── Time helpers ──────────────────────────────────────────────────────────────
// Slots are ranges: "9:00 AM - 9:30 AM"
function parseTimePart(t: string): number {
  const parts = t.trim().split(" ");
  const [hStr, mStr] = (parts[0] || "0:0").split(":");
  let h = Number(hStr);
  const m = Number(mStr || 0);
  const p = (parts[1] || "").toUpperCase();
  if (p === "PM" && h !== 12) h += 12;
  if (p === "AM" && h === 12) h = 0;
  return h * 60 + m;
}

function slotStartMinutes(slot: string): number {
  return parseTimePart(slot.includes(" - ") ? slot.split(" - ")[0] : slot);
}

function slotEndMinutes(slot: string): number {
  if (slot.includes(" - ")) return parseTimePart(slot.split(" - ")[1]);
  return slotStartMinutes(slot) + 30;
}

// End minute of the LAST slot in a booking
function bookingEndMinutes(slots: string[]): number {
  if (!slots.length) return 0;
  const sorted = [...slots].sort((a, b) => slotStartMinutes(a) - slotStartMinutes(b));
  return slotEndMinutes(sorted[sorted.length - 1]);
}

function nowMinutes(): number {
  const n = new Date();
  return n.getHours() * 60 + n.getMinutes();
}

// True when the booking's end time is in the past
function isSlotPast(b: Booking): boolean {
  const ds = getBookingDateStr(b);
  if (!ds) return false;
  const bookingDay = toMidnight(new Date(ds)).getTime();
  const todayDay   = toMidnight(new Date()).getTime();
  if (bookingDay < todayDay) return true;   // past date
  if (bookingDay > todayDay) return false;  // future date
  return nowMinutes() >= bookingEndMinutes(b.selectedSlots || []);
}

function isBookingCompleted(b: Booking): boolean {
  return isSlotPast(b);
}

function formatSlotRange(slots: string[]): string {
  if (!slots.length) return "";
  const sorted     = [...slots].sort((a, b) => slotStartMinutes(a) - slotStartMinutes(b));
  const firstStart = sorted[0].includes(" - ") ? sorted[0].split(" - ")[0].trim() : sorted[0].trim();
  const lastSlot   = sorted[sorted.length - 1];
  const lastEnd    = lastSlot.includes(" - ") ? lastSlot.split(" - ")[1].trim() : "";
  return lastEnd ? `${firstStart} - ${lastEnd}` : firstStart;
}

// ── Amount helpers ────────────────────────────────────────────────────────────
function getTotal(b: Booking): number {
  return Number(b.totalAmount ?? 0);
}
function getPaid(b: Booking): number {
  // paidAmount = what was paid online (advance) or at walk-in
  return Number(b.paidAmount ?? b.advanceAmount ?? 0);
}
function getAdvance(b: Booking): number {
  // For online bookings: the Razorpay advance (stored as advanceAmount)
  return Number(b.advanceAmount ?? b.paidAmount ?? 0);
}
function getRemaining(b: Booking): number {
  // Prefer stored value; fall back to derived
  if (b.remainingAmount !== undefined && b.remainingAmount !== null) {
    return Number(b.remainingAmount);
  }
  return Math.max(getTotal(b) - getPaid(b), 0);
}
function fmtAmount(n: number): string {
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

// ── Display helpers ───────────────────────────────────────────────────────────
function getDisplayName(b: Booking): string {
  return b.isOffline ? (b.customerName || "Walk-in") : (b.userName || "Online User");
}
function getAvatarLetter(b: Booking): string {
  return (getDisplayName(b)[0] || "?").toUpperCase();
}

function getPaymentLabel(b: Booking): { label: string; color: string; bg: string } {
  if (b.isOffline) return { label: "Cash", color: "#0F766E", bg: "#CCFBF1" };
  const ps = b.paymentStatus || "";
  if (ps === "fully_paid")   return { label: "Fully Paid",   color: "#15803D", bg: "#DCFCE7" };
  if (ps === "advance_paid") return { label: "Advance Paid", color: "#B45309", bg: "#FEF3C7" };
  if (ps === "pending")      return { label: "Pending",      color: "#6B7280", bg: "#F3F4F6" };
  return                            { label: ps || "Unknown", color: "#6B7280", bg: "#F3F4F6" };
}

function getStatusLabel(b: Booking): { label: string; color: string; bg: string } {
  if (b.status === "cancelled") return { label: "Cancelled", color: "#DC2626", bg: "#FEE2E2" };
  if (isBookingCompleted(b))    return { label: "Completed", color: "#374151", bg: "#F3F4F6" };
  return                               { label: "Confirmed", color: "#15803D", bg: "#DCFCE7" };
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function TurfOperatorScreen() {
  const router = useRouter();

  const [profile,       setProfile]       = useState<OperatorProfile>({});
  const [bookings,      setBookings]      = useState<Booking[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [refreshing,    setRefreshing]    = useState(false);
  const [selected,      setSelected]      = useState<Booking | null>(null);
  const [detailOpen,    setDetailOpen]    = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [activeTab,     setActiveTab]     = useState<"pending" | "completed" | "all">("pending");

  // Re-render every 60s so isSlotPast() recalculates with current clock
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    timerRef.current = setInterval(() => setBookings((p) => [...p]), 60_000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  // ── Auth ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) { router.replace("/(auth)/login"); return; }
      await fetchAll(user.uid);
    });
    return unsub;
  }, []);

  // ── Fetch ─────────────────────────────────────────────────────────────────
  const fetchAll = async (uid: string, isRefresh = false) => {
    isRefresh ? setRefreshing(true) : setLoading(true);
    try {
      const userSnap = await getDoc(doc(db, "users", uid));
      const userData = userSnap.exists() ? (userSnap.data() as any) : {};
      setProfile(userData as OperatorProfile);

      const opTurfIds: string[] =
        Array.isArray(userData.turfIds) && userData.turfIds.length > 0
          ? userData.turfIds
          : userData.turfId ? [userData.turfId] : [];

      const [newFmtSnap, legacySnap] = await Promise.all([
        getDocs(query(collection(db, "turfs"), where("operatorIds", "array-contains", uid))),
        getDocs(query(collection(db, "turfs"), where("operatorId",  "==",             uid))),
      ]);

      const allTurfIds = Array.from(new Set([
        ...opTurfIds,
        ...newFmtSnap.docs.map((d) => d.id),
        ...legacySnap.docs.map((d) => d.id),
      ]));

      const turfNameMap: Record<string, string> = {};
      [...newFmtSnap.docs, ...legacySnap.docs].forEach((d) => {
        turfNameMap[d.id] = d.data().name || "Turf";
      });

      setProfile((prev) => ({
        ...prev,
        turfName: allTurfIds.map((id) => turfNameMap[id] || id).join(", "),
        turfId:   allTurfIds[0] || prev.turfId || "",
        turfIds:  allTurfIds,
      }));

      if (allTurfIds.length === 0) { setBookings([]); return; }

      // Online bookings
      const bookingSnap = await getDocs(
        query(collection(db, "bookings"), where("turfId", "in", allTurfIds.slice(0, 30)))
      );
      const onlineBookings: Booking[] = bookingSnap.docs.map((d) => ({
        id: d.id, ...d.data(), isOffline: false,
      } as Booking));

      // Offline / walk-in
      const offlineSnap = await getDocs(
        query(
          collection(db, "blockedSlots"),
          where("turfId", "in", allTurfIds.slice(0, 30)),
          where("type",   "==", "offline")
        )
      );
      const offlineBookings: Booking[] = offlineSnap.docs.map((d) => {
        const raw           = d.data();
        const slots: string[] = Array.isArray(raw.slots)
          ? raw.slots : raw.slotTime ? [raw.slotTime] : [];
        const totalAmount     = Number(raw.amount || 0);
        const paidAmount      = Number(raw.paidAmount || raw.advanceAmount || 0);
        const remainingAmount = Number(
          raw.remainingAmount !== undefined ? raw.remainingAmount
            : Math.max(totalAmount - paidAmount, 0)
        );
        return {
          id:               `offline_${d.id}`,
          offlineDocId:     d.id,
          isOffline:        true,
          customerName:     raw.customerName  || "Walk-in",
          customerPhone:    raw.customerPhone || "",
          note:             raw.note          || "",
          offlineAmount:    String(raw.amount || "0"),
          turfName:         raw.turfName || turfNameMap[raw.turfId] || "Turf",
          turfId:           raw.turfId   || "",
          dateString:       raw.date     || "",
          date:             raw.date     || "",
          selectedSlots:    slots,
          status:           "confirmed",
          paymentStatus:    remainingAmount > 0 ? "advance_paid" : "fully_paid",
          totalAmount,
          paidAmount,
          remainingAmount,
          bookingType:      "offline",
          arrived:          raw.arrived          ?? false,
          remainingCollected: raw.remainingCollected ?? false,
        } as Booking;
      });

      const allBookings: Booking[] = [...onlineBookings, ...offlineBookings].sort((a, b) => {
        const dA = toMidnight(getSafeDate(a.date || a.dateString) || new Date(0)).getTime();
        const dB = toMidnight(getSafeDate(b.date || b.dateString) || new Date(0)).getTime();
        if (dA !== dB) return dA - dB;
        const aC = isSlotPast(a), bC = isSlotPast(b);
        if (aC && !bC) return 1;
        if (!aC && bC) return -1;
        return slotStartMinutes(a.selectedSlots?.[0] || "11:59 PM")
             - slotStartMinutes(b.selectedSlots?.[0] || "11:59 PM");
      });

      setBookings(allBookings);
    } catch (e) {
      console.error("Fetch error:", e);
      Alert.alert("Error", "Could not load bookings. Pull down to retry.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = () => {
    const uid = auth.currentUser?.uid;
    if (uid) fetchAll(uid, true);
  };

  // ── Filtered tabs ─────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const todayMs = toMidnight(new Date()).getTime();
    return bookings.filter((b) => {
      const ds = getBookingDateStr(b);
      if (!ds) return false;
      const dayMs     = toMidnight(new Date(ds)).getTime();
      const completed = isSlotPast(b) || b.status === "completed";
      const cancelled = b.status === "cancelled";
      if (activeTab === "pending")   return !completed && !cancelled && dayMs >= todayMs;
      if (activeTab === "completed") return dayMs === todayMs && (completed || cancelled);
      if (activeTab === "all")       return dayMs >= todayMs;
      return false;
    });
  }, [bookings, activeTab]);

  // ── Stats (TODAY only) ────────────────────────────────────────────────────
 // ── Stats (TODAY only) ────────────────────────────────────────────────────
const stats = useMemo(() => {
  const todayMs = toMidnight(new Date()).getTime();
  
  // rest of your stats code..

  const todayAll = bookings.filter((b) => {
    if (b.status === "cancelled") return false;
    const ds = getBookingDateStr(b);
    if (!ds) return false;
    // Compare midnight timestamps — same method used in filtered/sorting
    return toMidnight(new Date(ds)).getTime() === todayMs;
  });

  const todayActive = todayAll.filter((b) => !isSlotPast(b));

  let cashCollected = 0;
  let cashPending   = 0;

  for (const b of todayAll) {
    const slotDone  = isSlotPast(b);
    const remaining = getRemaining(b);
    const autoCollected = (slotDone && remaining > 0) || !!b.remainingCollected;

    if (b.isOffline) {
      cashCollected += getPaid(b);
      if (slotDone) {
        cashCollected += remaining;
      } else {
        cashPending += remaining;
      }
    } else {
      if (autoCollected) {
        cashCollected += remaining;
      } else if (remaining > 0) {
        cashPending += remaining;
      }
    }
  }

  return {
    todayCount: todayActive.length,
    arrived:    todayActive.filter((b) => b.arrived).length,
    collected:  cashCollected,
    pending:    cashPending,
  };
}, [bookings]);

  // ── Actions ───────────────────────────────────────────────────────────────
  const markArrived = async (b: Booking) => {
    if (b.arrived) return;
    setActionLoading(true);
    try {
      if (b.isOffline) {
        if (!b.offlineDocId) throw new Error("Missing offline doc ID");
        await updateDoc(doc(db, "blockedSlots", b.offlineDocId), { arrived: true });
      } else {
        await updateDoc(doc(db, "bookings", b.id), { arrived: true });
      }
      const updated = { ...b, arrived: true };
      setBookings((prev) => prev.map((x) => x.id === b.id ? updated : x));
      if (selected?.id === b.id) setSelected(updated);
      Alert.alert("✅ Marked", `${getDisplayName(b)} marked as arrived.`);
    } catch (e) {
      Alert.alert("Error", "Could not update.");
    } finally {
      setActionLoading(false);
    }
  };

  const collectRemaining = async (b: Booking) => {
    if (b.isOffline) return;
    const rem = getRemaining(b);
    if (rem <= 0) { Alert.alert("Already Paid", "No remaining amount due."); return; }
    Alert.alert(
      "Collect Remaining",
      `Collect ${fmtAmount(rem)} from ${getDisplayName(b)}?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Collected ✓",
          onPress: async () => {
            setActionLoading(true);
            try {
              await updateDoc(doc(db, "bookings", b.id), {
  remainingCollected: true,
  paymentStatus: "fully_paid",
});

const updated: Booking = {
  ...b,
  remainingCollected: true,
  paymentStatus: "fully_paid",
};
              setBookings((prev) => prev.map((x) => x.id === b.id ? updated : x));
              if (selected?.id === b.id) setSelected(updated);
              Alert.alert("✅ Collected", `${fmtAmount(rem)} marked as collected.`);
            } catch {
              Alert.alert("Error", "Could not update payment.");
            } finally {
              setActionLoading(false);
            }
          },
        },
      ]
    );
  };

  const handleLogout = () => {
    Alert.alert("Logout", "Are you sure?", [
      { text: "Cancel", style: "cancel" },
      { text: "Logout", style: "destructive", onPress: () => signOut(auth) },
    ]);
  };

  // ── Card ──────────────────────────────────────────────────────────────────
  const renderBooking = ({ item }: { item: Booking }) => {
    const pay       = getPaymentLabel(item);
    const st        = getStatusLabel(item);
    const rem       = getRemaining(item);
    const slots     = Array.isArray(item.selectedSlots) ? item.selectedSlots : [];
    const slotDone  = isSlotPast(item);
    // Auto-collected = slot is over AND there was/is a remaining balance
    const autoCollected =
  (slotDone && rem > 0) || item.remainingCollected;

    return (
      <TouchableOpacity
        style={styles.card}
        onPress={() => { setSelected(item); setDetailOpen(true); }}
        activeOpacity={0.82}
      >
        <View style={[
          styles.cardBar,
          { backgroundColor: item.arrived ? ACCENT : slotDone ? "#D1D5DB" : "#22C55E" },
        ]} />

        <View style={styles.cardInner}>
          {/* Top */}
          <View style={styles.cardTop}>
            <View style={styles.userAvatar}>
              <Text style={styles.userAvatarText}>{getAvatarLetter(item)}</Text>
            </View>
            <View style={{ flex: 1, marginLeft: 10 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Text style={styles.cardName} numberOfLines={1}>{getDisplayName(item)}</Text>
                {item.isOffline && (
                  <View style={styles.offlinePill}>
                    <Text style={styles.offlinePillText}>OFFLINE</Text>
                  </View>
                )}
              </View>
              <Text style={styles.cardSub}>
                {item.isOffline ? "Walk-in / Cash" : "Online Booking"}{"  ·  "}{item.dateString || ""}
              </Text>
            </View>
            <View style={[styles.pill, { backgroundColor: st.bg }]}>
              <Text style={[styles.pillText, { color: st.color }]}>{st.label}</Text>
            </View>
          </View>

          {/* Slot row */}
          {slots.length > 0 && (
            <View style={styles.slotRow}>
              <Ionicons name="time-outline" size={13} color="#9CA3AF" />
              <Text style={styles.slotText} numberOfLines={1}>{formatSlotRange(slots)}</Text>
              {slotDone && (
                <View style={styles.doneBadge}>
                  <Text style={styles.doneBadgeText}>Done</Text>
                </View>
              )}
            </View>
          )}

          {/* Amounts */}
          <View style={styles.payRow}>
            <View style={styles.payItem}>
              <Text style={styles.payLabel}>Total</Text>
              <Text style={styles.payValue}>{fmtAmount(getTotal(item))}</Text>
            </View>
            <View style={styles.payDivider} />
            <View style={styles.payItem}>
              <Text style={styles.payLabel}>{item.isOffline ? "Cash Paid" : "Online Paid"}</Text>
              <Text style={[styles.payValue, { color: "#15803D" }]}>{fmtAmount(getPaid(item))}</Text>
            </View>
            <View style={styles.payDivider} />
            <View style={styles.payItem}>
              <Text style={styles.payLabel}>Due at Turf</Text>
              <Text style={[
                styles.payValue,
                {
                  color: autoCollected || rem === 0 ? "#9CA3AF" : "#DC2626",
                  textDecorationLine: autoCollected ? "line-through" : "none",
                },
              ]}>
                {fmtAmount(rem)}
              </Text>
            </View>
            <View style={[styles.pill, { backgroundColor: pay.bg, marginLeft: "auto" }]}>
              <Text style={[styles.pillText, { color: pay.color }]}>{pay.label}</Text>
            </View>
          </View>

          {/* Auto-collected notice */}
          

          {/* Quick actions (active only) */}
          {item.status !== "cancelled" && !slotDone && (
            <View style={styles.quickActions}>
              <TouchableOpacity
                style={[styles.qBtn, item.arrived && styles.qBtnDone]}
                onPress={() => markArrived(item)}
                disabled={item.arrived}
              >
                <Ionicons
                  name={item.arrived ? "checkmark-circle" : "person-outline"}
                  size={14}
                  color={item.arrived ? "#15803D" : "#374151"}
                />
                <Text style={[styles.qBtnText, item.arrived && { color: "#15803D" }]}>
                  {item.arrived ? "Arrived ✓" : "Mark Arrived"}
                </Text>
              </TouchableOpacity>

              {!item.isOffline && rem > 0 && !item.remainingCollected && (
                <TouchableOpacity
                  style={[styles.qBtn, styles.qBtnCollect]}
                  onPress={() => collectRemaining(item)}
                >
                  <Ionicons name="cash-outline" size={14} color="#B45309" />
                  <Text style={[styles.qBtnText, { color: "#B45309" }]}>
                    Collect {fmtAmount(rem)}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  // ── Loading ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <SafeAreaView style={styles.loadWrap}>
        <StatusBar barStyle="light-content" backgroundColor={DARK} />
        <ActivityIndicator size="large" color={ACCENT} />
        <Text style={styles.loadText}>Loading bookings...</Text>
      </SafeAreaView>
    );
  }

  const hasTurf = !!(profile.turfId || (profile.turfIds && profile.turfIds.length > 0));

  // ── Main render ───────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={DARK} />

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        renderItem={renderBooking}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={ACCENT} />}
        ListHeaderComponent={
          <View>
            {/* Hero */}
            <View style={styles.hero}>
              <View style={styles.glow1} />
              <View style={styles.glow2} />
              <View style={styles.heroTop}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.heroTag}>TURF OPERATOR</Text>
                  <Text style={styles.heroName}>{profile.name || "Operator"}</Text>
                  <Text style={styles.heroTurf} numberOfLines={2}>
                    {"📍  "}{profile.turfName || "No turf assigned"}
                  </Text>
                </View>
                <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
                  <Ionicons name="log-out-outline" size={20} color="#fff" />
                </TouchableOpacity>
              </View>

              {/* Stats — CORRECT labels and values */}
              <View style={styles.statsRow}>
                {[
                  { label: "TODAY",     sub: "active",        value: String(stats.todayCount), color: "#60A5FA" },
                  { label: "ARRIVED",   sub: "players",       value: String(stats.arrived),    color: "#34D399" },
                  { label: "COLLECTED", sub: "cash at turf",  value: fmtAmount(stats.collected), color: "#34D399" },
                  { label: "PENDING",   sub: "yet to collect", value: fmtAmount(stats.pending),  color: stats.pending > 0 ? "#F87171" : "#6B7280" },
                ].map((s) => (
                  <View key={s.label} style={styles.statBox}>
                    <Text style={[styles.statValue, { color: s.color }]}>{s.value}</Text>
                    <Text style={styles.statLabel}>{s.label}</Text>
                    <Text style={styles.statSub}>{s.sub}</Text>
                  </View>
                ))}
              </View>

              {/* Turf Status Button */}
<TouchableOpacity
  style={{
    flexDirection: "row", alignItems: "center", gap: 10,
    backgroundColor: "rgba(255,255,255,0.08)", borderRadius: 14,
    paddingHorizontal: 16, paddingVertical: 12, marginTop: 16,
    borderWidth: 1, borderColor: "rgba(255,255,255,0.12)",
  }}
  onPress={() => router.push("/(turf-operator)/operator-turf-management")}
>
  <Ionicons name="cloud-outline" size={18} color={ACCENT} />
  <View style={{ flex: 1 }}>
    <Text style={{ color: "#fff", fontSize: 14, fontWeight: "800" }}>Update Field Status</Text>
    <Text style={{ color: "#9CA3AF", fontSize: 11, marginTop: 2 }}>Rain, maintenance, league in progress…</Text>
  </View>
  <Ionicons name="chevron-forward" size={16} color="#9CA3AF" />
</TouchableOpacity>
            </View>

            {!hasTurf && (
              <View style={styles.noTurfBox}>
                <Ionicons name="warning-outline" size={22} color="#D97706" />
                <Text style={styles.noTurfText}>
                  You haven't been assigned to a turf yet. Contact your owner or admin.
                </Text>
              </View>
            )}

            {/* Tabs */}
            <View style={styles.tabBar}>
              {(["pending", "completed", "all"] as const).map((t) => (
                <TouchableOpacity
                  key={t}
                  style={[styles.tab, activeTab === t && styles.tabActive]}
                  onPress={() => setActiveTab(t)}
                >
                  <Text style={[styles.tabText, activeTab === t && styles.tabTextActive]}>
                    {t === "pending" ? "Pending" : t === "completed" ? "Done Today" : "All"}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.countLabel}>
              {filtered.length} booking{filtered.length !== 1 ? "s" : ""}
            </Text>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="calendar-outline" size={44} color="#D1D5DB" />
            <Text style={styles.emptyTitle}>
              {activeTab === "pending"   ? "No pending bookings"
               : activeTab === "completed" ? "No completed bookings today"
               : "No upcoming bookings"}
            </Text>
            <Text style={styles.emptySub}>Pull down to refresh</Text>
          </View>
        }
      />

      {/* Detail modal */}
      <Modal visible={detailOpen} animationType="slide" transparent onRequestClose={() => setDetailOpen(false)}>
        <View style={styles.modalBackdrop}>
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => setDetailOpen(false)} />
          <View style={styles.modalSheet}>
            <View style={styles.sheetHandle} />
            {selected && (() => {
              const slotDone      = isSlotPast(selected);
              const rem           = getRemaining(selected);
             const autoCollected =
  (slotDone && rem > 0) || selected.remainingCollected;
              return (
                <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 32 }}>
                  {/* Header */}
                  <View style={styles.detailHeader}>
                    <View style={styles.detailAvatar}>
                      <Text style={styles.detailAvatarText}>{getAvatarLetter(selected)}</Text>
                    </View>
                    <View style={{ flex: 1, marginLeft: 12 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <Text style={styles.detailName}>{getDisplayName(selected)}</Text>
                        {selected.isOffline && (
                          <View style={styles.offlinePill}>
                            <Text style={styles.offlinePillText}>OFFLINE</Text>
                          </View>
                        )}
                      </View>
                      <Text style={styles.detailSub}>
                        {selected.isOffline ? "Walk-in / Cash booking" : "Online booking"}
                      </Text>
                      {selected.isOffline && selected.note
                        ? <Text style={styles.detailSub}>Note: {selected.note}</Text> : null}
                    </View>
                    {selected.arrived && (
                      <View style={styles.arrivedBadge}>
                        <Ionicons name="checkmark-circle" size={14} color="#15803D" />
                        <Text style={styles.arrivedText}>Arrived</Text>
                      </View>
                    )}
                  </View>

                  {/* Info */}
                  {[
                    { icon: "business-outline", label: "Turf",    value: selected.turfName  || "—" },
                    { icon: "calendar-outline", label: "Date",    value: selected.dateString || "—" },
                    { icon: "time-outline",     label: "Slots",   value: formatSlotRange(selected.selectedSlots || []) || "—" },
                    { icon: "card-outline",     label: "Booking", value: selected.bookingType === "full" ? "Full Payment" : selected.isOffline ? "Cash / Walk-in" : "Advance Payment" },
                  ].map((row) => (
                    <View key={row.label} style={styles.detailRow}>
                      <View style={styles.detailIconWrap}>
                        <Ionicons name={row.icon as any} size={16} color="#6B7280" />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.detailLabel}>{row.label}</Text>
                        <Text style={styles.detailValue}>{row.value}</Text>
                      </View>
                    </View>
                  ))}

                  {/* Payment breakdown */}
                  <View style={styles.payBreakdown}>
                    <Text style={styles.payBreakdownTitle}>Payment Breakdown</Text>
                    {[
                      { label: "Total Amount",                                          value: getTotal(selected),  color: "#111827",             strike: false },
                      { label: selected.isOffline ? "Cash Paid" : "Paid via Razorpay", value: getPaid(selected),   color: "#15803D",             strike: false },
                      { label: "Due at Turf",                                           value: rem,                 color: rem > 0 && !slotDone ? "#DC2626" : "#9CA3AF", strike: autoCollected },
                    ].map((row) => (
                      <View key={row.label} style={styles.payBreakRow}>
                        <Text style={styles.payBreakLabel}>{row.label}</Text>
                        <Text style={[styles.payBreakValue, { color: row.color, textDecorationLine: row.strike ? "line-through" : "none" }]}>
                          {fmtAmount(row.value)}
                        </Text>
                      </View>
                    ))}
                    <View style={[styles.payBreakRow, { borderBottomWidth: 0 }]}>
                      <Text style={styles.payBreakLabel}>Status</Text>
                      <View style={[styles.pill, { backgroundColor: getPaymentLabel(selected).bg }]}>
                        <Text style={[styles.pillText, { color: getPaymentLabel(selected).color }]}>
                          {getPaymentLabel(selected).label}
                        </Text>
                      </View>
                    </View>
                    {(autoCollected || selected.remainingCollected) && (
                      <View style={styles.autoCollectedBanner}>
                        <Ionicons name="checkmark-circle" size={13} color="#15803D" />
                        <Text style={styles.autoCollectedText}>
                        {selected.remainingCollected && !slotDone
  ? `${fmtAmount(rem)} collected at venue`
  : `${fmtAmount(rem)} auto-collected — slot completed`}
                        </Text>
                      </View>
                    )}
                  </View>

                  {/* Actions */}
                  {selected.status !== "cancelled" && !slotDone && (
                    <View style={{ gap: 10, marginTop: 16 }}>
                      {!selected.arrived && (
                        <TouchableOpacity
                          style={[styles.actionBtn, { backgroundColor: DARK }]}
                          onPress={() => markArrived(selected)}
                          disabled={actionLoading}
                        >
                          <Ionicons name="person-outline" size={18} color="#fff" />
                          <Text style={styles.actionBtnText}>Mark Player Arrived</Text>
                        </TouchableOpacity>
                      )}
                      {!selected.isOffline && rem > 0 && !selected.remainingCollected && (
                        <TouchableOpacity
                          style={[styles.actionBtn, { backgroundColor: "#0F766E" }]}
                          onPress={() => collectRemaining(selected)}
                          disabled={actionLoading}
                        >
                          <Ionicons name="cash-outline" size={18} color="#fff" />
                          <Text style={styles.actionBtnText}>
                            Collect {fmtAmount(rem)} at Venue
                          </Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  )}

                  <TouchableOpacity style={styles.closeBtn} onPress={() => setDetailOpen(false)}>
                    <Text style={styles.closeBtnText}>Close</Text>
                  </TouchableOpacity>
                </ScrollView>
              );
            })()}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  safe:     { flex: 1, backgroundColor: "#F0F4F8" },
  loadWrap: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: DARK },
  loadText: { color: "#9CA3AF", marginTop: 12, fontSize: 15, fontWeight: "600" },
  list:     { paddingBottom: 100 },

  hero:     { backgroundColor: DARK, paddingHorizontal: 20, paddingTop: Platform.OS === "android" ? (StatusBar.currentHeight || 0) + 14 : 18, paddingBottom: 24, overflow: "hidden" },
 // glow1:    { position: "absolute", top: -40,  right: -30, width: 180, height: 180, borderRadius: 90, backgroundColor: "rgba(14,165,164,0.15)" },//
  //glow2:    { position: "absolute", bottom: -60, left: -40, width: 160, height: 160, borderRadius: 80, backgroundColor: "rgba(255,255,255,0.06)" },//
  heroTop:  { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 },
  heroTag:  { color: ACCENT, fontSize: 10, fontWeight: "800", letterSpacing: 1.5 },
  heroName: { color: "#FFFFFF", fontSize: 24, fontWeight: "900", marginTop: 4 },
  heroTurf: { color: "#9CA3AF", fontSize: 12, marginTop: 4, fontWeight: "500", lineHeight: 18 },
  logoutBtn:{ width: 36, height: 36, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.1)", justifyContent: "center", alignItems: "center" },

  statsRow: { flexDirection: "row", gap: 6 },
  statBox:  { flex: 1, backgroundColor: "rgba(255,255,255,0.07)", borderRadius: 12, padding: 10, alignItems: "center", borderWidth: 1, borderColor: "rgba(255,255,255,0.08)" },
  statValue:{ fontSize: 15, fontWeight: "900" },
  statLabel:{ color: "#9CA3AF", fontSize: 8, fontWeight: "900", marginTop: 2, textTransform: "uppercase", letterSpacing: 0.5 },
  statSub:  { color: "#4B5563", fontSize: 7, marginTop: 1, textAlign: "center" },

  noTurfBox:  { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#FEF3C7", borderRadius: 14, margin: 16, padding: 14, borderWidth: 1, borderColor: "#FDE68A" },
  noTurfText: { fontSize: 13, color: "#92400E", fontWeight: "600", flex: 1, lineHeight: 19 },

  tabBar:        { flexDirection: "row", paddingHorizontal: 16, paddingTop: 14, gap: 8 },
  tab:           { flex: 1, paddingVertical: 10, borderRadius: 12, backgroundColor: "#FFFFFF", alignItems: "center", borderWidth: 1, borderColor: "#E5E7EB" },
  tabActive:     { backgroundColor: DARK, borderColor: DARK },
  tabText:       { fontSize: 12, fontWeight: "700", color: "#6B7280" },
  tabTextActive: { color: "#FFFFFF" },
  countLabel:    { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 4, fontSize: 11, color: "#9CA3AF", fontWeight: "700" },

  card:      { backgroundColor: "#FFFFFF", marginHorizontal: 16, marginBottom: 12, borderRadius: 18, flexDirection: "row", overflow: "hidden", borderWidth: 1, borderColor: "#E5E7EB", elevation: 2, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4 },
  cardBar:   { width: 4 },
  cardInner: { flex: 1, padding: 14 },
  cardTop:   { flexDirection: "row", alignItems: "center", marginBottom: 10 },

  userAvatar:     { width: 42, height: 42, borderRadius: 21, backgroundColor: DARK, justifyContent: "center", alignItems: "center" },
  userAvatarText: { color: "#fff", fontSize: 16, fontWeight: "900" },
  cardName:  { fontSize: 15, fontWeight: "800", color: "#111827", flex: 1 },
  cardSub:   { fontSize: 11, color: "#9CA3AF", marginTop: 2 },

  offlinePill:     { backgroundColor: "#CCFBF1", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  offlinePillText: { fontSize: 9, fontWeight: "800", color: "#0F766E" },

  slotRow:      { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 10 },
  slotText:     { fontSize: 12, color: "#374151", fontWeight: "600", flex: 1 },
  doneBadge:    { backgroundColor: "#F3F4F6", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  doneBadgeText:{ fontSize: 9, fontWeight: "800", color: "#6B7280" },

  payRow:     { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  payItem:    { alignItems: "center", minWidth: 56 },
  payLabel:   { fontSize: 8, color: "#9CA3AF", fontWeight: "700", textTransform: "uppercase" },
  payValue:   { fontSize: 13, fontWeight: "800", color: "#111827", marginTop: 2 },
  payDivider: { width: 1, height: 28, backgroundColor: "#F3F4F6" },

  pill:     { flexDirection: "row", alignItems: "center", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999 },
  pillText: { fontSize: 10, fontWeight: "800" },

  autoCollectedBanner: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#F0FDF4", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, marginTop: 8, borderWidth: 1, borderColor: "#BBF7D0" },
  autoCollectedText:   { fontSize: 11, color: "#15803D", fontWeight: "600", flex: 1 },

  quickActions: { flexDirection: "row", gap: 8, marginTop: 12, flexWrap: "wrap" },
  qBtn:         { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "#F3F4F6", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7 },
  qBtnDone:     { backgroundColor: "#DCFCE7" },
  qBtnCollect:  { backgroundColor: "#FEF3C7" },
  qBtnText:     { fontSize: 12, fontWeight: "700", color: "#374151" },

  empty:      { alignItems: "center", paddingVertical: 60 },
  emptyTitle: { fontSize: 17, fontWeight: "800", color: "#374151", marginTop: 14 },
  emptySub:   { fontSize: 13, color: "#9CA3AF", marginTop: 6 },

  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  modalSheet:    { backgroundColor: "#FFFFFF", borderTopLeftRadius: 28, borderTopRightRadius: 28, maxHeight: "92%", paddingHorizontal: 20, paddingTop: 12, paddingBottom: Platform.OS === "ios" ? 34 : 20 },
  sheetHandle:   { width: 40, height: 4, borderRadius: 2, backgroundColor: "#E5E7EB", alignSelf: "center", marginBottom: 20 },

  detailHeader:     { flexDirection: "row", alignItems: "flex-start", marginBottom: 20 },
  detailAvatar:     { width: 52, height: 52, borderRadius: 26, backgroundColor: DARK, justifyContent: "center", alignItems: "center" },
  detailAvatarText: { color: "#fff", fontSize: 20, fontWeight: "900" },
  detailName:       { fontSize: 18, fontWeight: "900", color: "#111827" },
  detailSub:        { fontSize: 12, color: "#6B7280", marginTop: 2 },

  arrivedBadge: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#DCFCE7", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 },
  arrivedText:  { fontSize: 12, fontWeight: "700", color: "#15803D" },

  detailRow:      { flexDirection: "row", alignItems: "flex-start", gap: 12, backgroundColor: "#F9FAFB", borderRadius: 12, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: "#F3F4F6" },
  detailIconWrap: { width: 32, height: 32, borderRadius: 10, backgroundColor: "#F3F4F6", justifyContent: "center", alignItems: "center" },
  detailLabel:    { fontSize: 10, color: "#9CA3AF", fontWeight: "700", textTransform: "uppercase" },
  detailValue:    { fontSize: 14, color: "#111827", fontWeight: "600", marginTop: 2 },

  payBreakdown:      { backgroundColor: "#F9FAFB", borderRadius: 14, padding: 14, marginTop: 12, borderWidth: 1, borderColor: "#E5E7EB" },
  payBreakdownTitle: { fontSize: 13, fontWeight: "800", color: "#111827", marginBottom: 12 },
  payBreakRow:       { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: "#F3F4F6" },
  payBreakLabel:     { fontSize: 13, color: "#6B7280", fontWeight: "600" },
  payBreakValue:     { fontSize: 14, fontWeight: "800" },

  actionBtn:     { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 14, borderRadius: 14 },
  actionBtnText: { color: "#fff", fontSize: 15, fontWeight: "800" },

  closeBtn:     { backgroundColor: "#F3F4F6", paddingVertical: 14, borderRadius: 14, alignItems: "center", marginTop: 12 },
  closeBtnText: { color: "#374151", fontWeight: "700", fontSize: 15 },
});
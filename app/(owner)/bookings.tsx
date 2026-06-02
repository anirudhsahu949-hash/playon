import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  SafeAreaView,
  StatusBar,
  RefreshControl,
  Alert,
  ScrollView,
  Platform,
} from "react-native";
import { useEffect, useMemo, useState } from "react";
import { db, auth } from "../../firebaseConfig";
import { collection, getDocs, query, where } from "firebase/firestore";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

// ─── Types ────────────────────────────────────────────────────────────────────
type TabKey = "today" | "upcoming" | "completed" | "cancelled";
type HistoryFilter = "today" | "15days" | "30days" | "all";

interface Booking {
  id: string;
  turfName?: string;
  turfLocation?: string;
  location?: string;
  turfId?: string;
  userName?: string;
  customerName?: string;
  date?: any;
  dateString?: string;
  slotTime?: string;
  slots?: string[];
  selectedSlots?: string[];
  status?: string;
  paymentStatus?: string;
  totalAmount?: number;
  advanceAmount?: number;
  remainingAmount?: number;
  amount?: number;
  price?: number;
  source?: "app" | "offline";
  customerPhone?: string;
  type?: string;
  isOffline?: boolean;
  bookingMode?: string;
  bookingType?: string;
  _derived?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getSafeDate(value: any): Date | null {
  if (!value) return null;
  if (typeof value?.toDate === "function") return value.toDate();
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

function formatDate(value: any): string {
  const d = getSafeDate(value);
  if (!d) return "—";
  const today    = new Date();
  const tomorrow = new Date(); tomorrow.setDate(today.getDate() + 1);
  if (d.toDateString() === today.toDateString())    return "Today";
  if (d.toDateString() === tomorrow.toDateString()) return "Tomorrow";
  return d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
}

function formatCreatedTime(value: any): string {
  const d = getSafeDate(value);
  if (!d) return "—";

  return d.toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function parseTimePart(t: string): number {
  const parts = t.trim().split(" ");
  const [hStr, mStr] = (parts[0] || "0:0").split(":");
  let h = Number(hStr), m = Number(mStr || 0);
  const p = (parts[1] || "").toUpperCase();
  if (p === "PM" && h !== 12) h += 12;
  if (p === "AM" && h === 12) h = 0;
  return h * 60 + m;
}

function fmtMinutes(mins: number): string {
  let h = Math.floor(mins / 60), m = mins % 60;
  const suf = h >= 12 ? "PM" : "AM";
  if (h > 12) h -= 12;
  if (h === 0) h = 12;
  return `${h}:${String(m).padStart(2, "0")} ${suf}`;
}

function getSlotDisplay(b: Booking): { range: string; duration: string } {
  const slots = b.selectedSlots;
  if (Array.isArray(slots) && slots.length > 0) {
    const parsed = slots
      .map((s) => {
        const p = s.split(" - ");
        if (p.length < 2) return null;
        return { start: parseTimePart(p[0]), end: parseTimePart(p[1]) };
      })
      .filter(Boolean) as { start: number; end: number }[];

    if (parsed.length > 0) {
      parsed.sort((a, b) => a.start - b.start);
      const first = parsed[0], last = parsed[parsed.length - 1];
      let end = last.end;
      if (end <= first.start) end += 1440;
      const dur = end - first.start;
      const durLabel =
        dur < 60 ? `${dur}m`
        : dur % 60 === 0 ? `${dur / 60}h`
        : `${Math.floor(dur / 60)}h ${dur % 60}m`;
      return { range: `${fmtMinutes(first.start)} – ${fmtMinutes(last.end)}`, duration: durLabel };
    }
  }
  return { range: b.slotTime || "—", duration: "" };
}

function getTotal(b: Booking): number {
  return Number(b.totalAmount ?? b.amount ?? b.price ?? 0);
}
function getPaid(b: Booking): number {
  return Number(b.advanceAmount ?? (b.paymentStatus === "paid" ? getTotal(b) : 0));
}
function getRemaining(b: Booking): number {
  return Number(b.remainingAmount ?? Math.max(getTotal(b) - getPaid(b), 0));
}

function getSlotEndTime(b: Booking): number | null {
  const slots = b.selectedSlots || [];
  if (!slots.length) return null;

  const parsed = slots
    .map((s: string) => {
      const p = s.split(" - ");
      if (p.length < 2) return null;
      return {
        start: parseTimePart(p[0]),
        end:   parseTimePart(p[1]),
      };
    })
    .filter(Boolean) as { start: number; end: number }[];

  if (!parsed.length) return null;
  parsed.sort((a, b) => a.start - b.start);

  const last = parsed[parsed.length - 1];

  // ✅ FIX: if end <= start, it means it crosses midnight (e.g. 11:00 PM → 12:00 AM)
  // 12:00 AM parses as 0, but the real end is 24*60 = 1440
  const endMins = last.end <= last.start ? last.end + 24 * 60 : last.end;

  return endMins;
}
 
function getDerivedStatus(b: Booking): "upcoming" | "completed" | "cancelled" {
  if (b.status === "cancelled") return "cancelled";

  const d = getSafeDate(b.date || b.dateString);
  if (!d) return "upcoming";

  const bookingDay = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const todayDay   = new Date();
  todayDay.setHours(0, 0, 0, 0);
  const todayMs = todayDay.getTime();

  if (bookingDay < todayMs) return "completed";
  if (bookingDay > todayMs) return "upcoming";

  const endMinutes = getSlotEndTime(b);
  if (endMinutes === null) return "upcoming";

  const nowMinutes = new Date().getHours() * 60 + new Date().getMinutes();

  // ✅ FIX: if endMinutes > 1440, booking crosses midnight into next day
  // e.g. 11 PM – 12 AM → endMinutes = 1440
  // At 11:30 PM, nowMinutes = 1410, 1410 >= 1440 is FALSE → correctly "upcoming"
  // At 12:01 AM next day, bookingDay < todayMs → "completed" via the day check above
  return nowMinutes >= endMinutes ? "completed" : "upcoming";
} 
 
// ─── Also fix isTodayBooking — use same day-only comparison ──────────────────
function isTodayBooking(b: Booking): boolean {
  const d = getSafeDate(b.date || b.dateString);
  if (!d) return false;
 
  const bookingDay = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const todayDay   = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()).getTime();
 
  return bookingDay === todayDay;
}



// ─── Component ────────────────────────────────────────────────────────────────
export default function OwnerBookings() {
  const router = useRouter();

  const [bookings, setBookings]         = useState<Booking[]>([]);
  const [loading, setLoading]           = useState(true);
  const [refreshing, setRefreshing]     = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>("today");
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>("today");

  useEffect(() => { fetchAll(); }, []);

  const fetchAll = async (isRefresh = false) => {
    const uid = auth.currentUser?.uid;
    if (!uid) { setLoading(false); return; }
    isRefresh ? setRefreshing(true) : setLoading(true);
    try {
      const appSnap = await getDocs(
        query(collection(db, "bookings"), where("ownerId", "==", uid))
      );
      const appBookings: Booking[] = appSnap.docs.map((d) => ({
        id: d.id, source: "app", ...d.data(),
      } as Booking));

      const offlineSnap = await getDocs(
        query(collection(db, "blockedSlots"), where("ownerId", "==", uid), where("type", "==", "offline"))
      );
      const offlineBookings: Booking[] = offlineSnap.docs.map((d) => {
        const raw = d.data();
        const normalizedSlots: string[] = Array.isArray(raw.slots)
          ? raw.slots : raw.slotTime ? [raw.slotTime] : [];
        return {
          id: d.id, source: "offline" as const, isOffline: true, type: "offline",
          turfName: raw.turfName || "", turfId: raw.turfId || "",
          customerName: raw.customerName || "Walk-in", customerPhone: raw.customerPhone || "",
          date: raw.date || raw.dateString || "", dateString: raw.date || raw.dateString || "",
          selectedSlots: normalizedSlots, totalAmount: Number(raw.amount || 0),
          status: "confirmed", paymentStatus: "fully_paid",
        };
      });

  const all = [...appBookings, ...offlineBookings].sort((a, b) => {

  // ── 1. Normalize BOTH dates to midnight only ──────────────────
  const getDay = (booking: Booking) => {
    const d = getSafeDate(booking.date || booking.dateString);
    if (!d) return 0;
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  };

  const dayA = getDay(a);
  const dayB = getDay(b);

  if (dayA !== dayB) return dayA - dayB; // earlier date first

  // ── 2. Sort by slot START TIME within same day ────────────────
  const getStartMinutes = (booking: Booking): number => {
    let slotString = "";

    if (Array.isArray(booking.selectedSlots) && booking.selectedSlots.length > 0) {
      slotString = booking.selectedSlots[0];
    } else if (Array.isArray(booking.slots) && booking.slots.length > 0) {
      slotString = booking.slots[0];
    } else if (booking.slotTime) {
      slotString = booking.slotTime;
    }

    if (!slotString) return 9999;

    const startPart = slotString.split(" - ")[0]?.trim();
    return parseTimePart(startPart);
  };

  const startA = getStartMinutes(a);
  const startB = getStartMinutes(b);

  if (startA !== startB) return startA - startB;

  // ── 3. Same time → newest created first ──────────────────────
  const createdA = getSafeDate((a as any).createdAt)?.getTime() ?? 0;
  const createdB = getSafeDate((b as any).createdAt)?.getTime() ?? 0;
  return createdB - createdA;
});
      setBookings(all);
    } catch (e) {
      Alert.alert("Error", "Unable to load bookings.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  // ─── Derive status ────────────────────────────────────────────────────────
  const prepared = useMemo(() =>
    bookings.map((b) => ({ ...b, _derived: getDerivedStatus(b) })),
    [bookings]
  );

  // ─── History cutoff date ──────────────────────────────────────────────────
  // ─── History cutoff date ──────────────────────────────────────────────────
const cutoffDate = useMemo(() => {
  const d = new Date();

  if (historyFilter === "today") {
    d.setHours(0, 0, 0, 0);
  } else if (historyFilter === "15days") {
    d.setDate(d.getDate() - 15);
    d.setHours(0, 0, 0, 0);
  } else if (historyFilter === "30days") {
    d.setDate(d.getDate() - 30);
    d.setHours(0, 0, 0, 0);
  } else {
    d.setFullYear(d.getFullYear() - 5);
    d.setHours(0, 0, 0, 0);
  }

  return d;
}, [historyFilter]);

  // ─── Filter by tab ────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
  return prepared.filter((b) => {
    const d = getSafeDate(b.date || b.dateString);
    if (!d) return false;

    if (activeTab === "today") {
      return isTodayBooking(b);
    }

    if (activeTab === "upcoming") {
      return b._derived === "upcoming";
    }

 if (activeTab === "completed") {
  if (b._derived !== "completed") return false;

  if (historyFilter === "today") {
    return isTodayBooking(b);
  }

  return d >= cutoffDate;
}

if (activeTab === "cancelled") {
  if (b._derived !== "cancelled") return false;

  if (historyFilter === "today") {
    return isTodayBooking(b);
  }

  return d >= cutoffDate;
}

    return false;
  });
}, [prepared, activeTab, cutoffDate]);

  // ─── Tab counts ───────────────────────────────────────────────────────────
 // ─── Tab counts ───────────────────────────────────────────────────────────
const tabCounts = useMemo(() => ({
  today: prepared.filter((b) => isTodayBooking(b)).length,

  upcoming: prepared.filter(
    (b) => b._derived === "upcoming"
  ).length,

  completed: prepared.filter((b) => {
    const d = getSafeDate(b.date || b.dateString);

    return (
      b._derived === "completed" &&
      d !== null &&
      d >= cutoffDate
    );
  }).length,

  cancelled: prepared.filter((b) => {
    const d = getSafeDate(b.date || b.dateString);

    return (
      b._derived === "cancelled" &&
      d !== null &&
      d >= cutoffDate
    );
  }).length,
}), [prepared, cutoffDate]);
  // ─── Render card ──────────────────────────────────────────────────────────
  const renderCard = ({ item }: { item: Booking & { _derived: string } }) => {
    const slot      = getSlotDisplay(item);
    const total     = getTotal(item);
    const paid      = getPaid(item);
    const remaining = getRemaining(item);
    const derived   = item._derived as "upcoming" | "completed" | "cancelled";
    const isOffline = item.isOffline || item.source === "offline";

    return (
      <TouchableOpacity
        style={[styles.card, derived === "cancelled" && styles.cardCancelled]}
        activeOpacity={0.88}
       onPress={() => {
  if (isOffline) {
    router.push({
      pathname: "../(owner)/booking-receipt/offline-receipt",
      params: { id: item.id },
    });
  } else {
    router.push({
      pathname: "../(owner)/booking-receipt/[id]",
      params: { id: item.id },
    });
  }
}}
      >
        {/* Left accent bar */}
        <View style={[
          styles.cardAccent,
          derived === "upcoming"  && styles.accentUpcoming,
          derived === "completed" && styles.accentCompleted,
          derived === "cancelled" && styles.accentCancelled,
        ]} />

        <View style={styles.cardBody}>
          {/* Top row */}
          <View style={styles.cardTopRow}>
            <View style={{ flex: 1, marginRight: 10 }}>
              <Text style={styles.turfName} numberOfLines={1}>
                {item.turfName || "Turf"}
              </Text>
              <Text style={styles.customerName} numberOfLines={1}>
                {item.userName || item.customerName || "Customer"}
                {item.customerPhone ? `  ·  ${item.customerPhone}` : ""}
              </Text>
            </View>

            {/* Status chip */}
            <View style={[
              styles.statusChip,
              derived === "upcoming"  && styles.chipUpcoming,
              derived === "completed" && styles.chipCompleted,
              derived === "cancelled" && styles.chipCancelled,
            ]}>
              <Ionicons
                name={
                  derived === "upcoming"  ? "time-outline" :
                  derived === "completed" ? "checkmark-circle-outline" :
                  "close-circle-outline"
                }
                size={11}
                color={
                  derived === "upcoming"  ? "#1D4ED8" :
                  derived === "completed" ? "#15803D" :
                  "#DC2626"
                }
              />
              <Text style={[
                styles.chipText,
                derived === "upcoming"  && { color: "#1D4ED8" },
                derived === "completed" && { color: "#15803D" },
                derived === "cancelled" && { color: "#DC2626" },
              ]}>
                {derived === "upcoming" ? "Upcoming" : derived === "completed" ? "Completed" : "Cancelled"}
              </Text>
            </View>
          </View>

          {/* Date + time row */}
          <View style={styles.metaRow}>

            <View style={styles.metaChip}>
              <Ionicons name="calendar-outline" size={12} color="#6B7280" />
              <Text style={styles.metaText}>{formatDate(item.date || item.dateString)}</Text>
            </View>
            <View style={styles.metaChip}>
              <Ionicons name="time-outline" size={12} color="#6B7280" />
              <Text style={styles.metaText} numberOfLines={1}>
                {slot.range}{slot.duration ? `  ·  ${slot.duration}` : ""}
              </Text>
            </View>
            {isOffline && (
              <View style={styles.metaChipOffline}>
                <Text style={styles.metaChipOfflineText}>Walk-in/offline-booking</Text>
              </View>
            )}
          </View>



       {/*   * Payment row */}
          {total > 0 && derived !== "cancelled" && (
            <View style={styles.payRow}>
              <View style={styles.payCol}>
                <Text style={styles.payLabel}>Total</Text>
                <Text style={styles.payValue}>₹{total}</Text>
              </View>
              <View style={styles.payDivider} />
              <View style={styles.payCol}>
                <Text style={styles.payLabel}>Paid</Text>
                <Text style={[styles.payValue, { color: "#15803D" }]}>₹{paid}</Text>
              </View>
              {remaining > 0 && (
                <>
                  <View style={styles.payDivider} />
                  <View style={styles.payCol}>
                    <Text style={styles.payLabel}>Due at Turf</Text>
                    <Text style={[styles.payValue, { color: derived === "completed" ? "#9CA3AF" : "#DC2626" }]}>
                      ₹{remaining}
                    </Text>
                  </View>
                </>
              )}
              {remaining === 0 && (
                <View style={styles.paidBadge}>
                  <Ionicons name="checkmark-circle" size={12} color="#15803D" />
                  <Text style={styles.paidBadgeText}>Fully paid</Text>
                </View>
              )}
            </View>
          )}

          <Text style={styles.createdAtText}>
   {formatCreatedTime((item as any).createdAt)}
</Text>

          {/* Footer */}
          {derived !== "cancelled" && (
  <TouchableOpacity
    style={styles.receiptBtn}
    onPress={() => {
      if (isOffline) {
        router.push({
          pathname: "/(owner)/booking-receipt/offline-receipt",
          params: { id: item.id },
        });
      } else {
        router.push({
          pathname: "../(owner)/booking-receipt/[id]",
          params: { id: item.id },
        });
      }
    }}
  >
    <Text style={styles.receiptBtnText}>View Receipt</Text>
    <Ionicons name="arrow-forward" size={13} color="#0A0F1E" />
  </TouchableOpacity>
)}
        </View>
      </TouchableOpacity>
    );
  };

  // ─── Loading ──────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <SafeAreaView style={styles.loaderWrap}>
        <StatusBar barStyle="dark-content" backgroundColor="#F0F4F8" />
        <ActivityIndicator size="large" color="#0A0F1E" />
        <Text style={styles.loaderText}>Loading...</Text>
      </SafeAreaView>
    );
  }

  // ─── Main render ──────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" backgroundColor="#F0F4F8" />

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        renderItem={renderCard}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor="#0A0F1E"
            onRefresh={() => fetchAll(true)}
          />
        }
        ListHeaderComponent={
          <View>
            {/* ── Compact header ── */}
            <View style={styles.header}>
              <View>
                <Text style={styles.headerTitle}>Bookings</Text>
                <Text style={styles.headerSub}>
                  {prepared.filter((b) => b._derived === "upcoming").length} upcoming
                </Text>
              </View>
            </View>

            {/* ── Tabs ── */}
            <View style={styles.tabsRow}>
              {(["today", "upcoming", "completed", "cancelled"] as TabKey[]).map((tab) => {
                const active = activeTab === tab;
                const count  = tabCounts[tab];
                return (
                  <TouchableOpacity
                    key={tab}
                    style={[styles.tab, active && styles.tabActive]}
                    onPress={() => setActiveTab(tab)}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.tabText, active && styles.tabTextActive]}>
  {tab === "today"
    ? `Today`
    : tab === "upcoming"
    ? `Upcoming `
    : tab === "completed"
    ? `Completed `
    : `Cancelled`}
</Text>
                   
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* ── History filter (only for completed/cancelled) ── */}
            {(activeTab === "completed" || activeTab === "cancelled") && (
              <View style={styles.filterRow}>
                <Text style={styles.filterLabel}>Show:</Text>
                {(["today", "15days", "30days", "all"] as HistoryFilter[]).map((f) => (
                  <TouchableOpacity
                    key={f}
                    style={[styles.filterChip, historyFilter === f && styles.filterChipActive]}
                    onPress={() => setHistoryFilter(f)}
                  >
                    <Text
  style={[
    styles.filterChipText,
    historyFilter === f && styles.filterChipTextActive,
  ]}
>
  {f === "today"
    ? "Today"
    : f === "15days"
    ? "15 days"
    : f === "30days"
    ? "30 days"
    : "All time"}
</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            <Text style={styles.resultCount}>
              {filtered.length} booking{filtered.length !== 1 ? "s" : ""}
            </Text>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.emptyCard}>
            <Ionicons
              name={
  activeTab === "today"
    ? "today-outline"
    : activeTab === "upcoming"
    ? "calendar-outline"
    : activeTab === "completed"
    ? "checkmark-circle-outline"
    : "close-circle-outline"
}
              size={40}
              color="#D1D5DB"
            />
            <Text style={styles.emptyTitle}>
              {
  activeTab === "today"
    ? "No bookings today"
    : activeTab === "upcoming"
    ? "No upcoming bookings"
    : activeTab === "completed"
    ? "No completed bookings"
    : "No cancelled bookings"
}
            </Text>
            <Text style={styles.emptyText}>
             {
  activeTab === "today"
    ? "Today's bookings will appear here."
    : activeTab === "upcoming"
    ? "New bookings will appear here."
    : "Try changing the history filter above."
}
            </Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: "#F0F4F8" },
  loaderWrap:  { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#F0F4F8" },
  loaderText:  { marginTop: 12, color: "#9CA3AF", fontSize: 15, fontWeight: "600" },
  listContent: { paddingBottom: 40 },

  // ── Header ─────────────────────────────────────────────
  header: {
    paddingHorizontal: 20,
    paddingTop: Platform.OS === "android" ? (StatusBar.currentHeight || 0) + 14 : 18,
    paddingBottom: 16,
    backgroundColor: "#F0F4F8",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
  },
  headerTitle: { fontSize: 28, fontWeight: "900", color: "#0A0F1E" },
  headerSub:   { fontSize: 13, color: "#9CA3AF", fontWeight: "600", marginTop: 2 },

  // ── Tabs ───────────────────────────────────────────────
 tabsRow: {
  flexDirection: "row",
  paddingHorizontal: 16,
  gap: 8,
  marginBottom: 4,
  flexWrap: "wrap",
},
  tab: {
     flexShrink: 1,
  paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  tabActive:     { backgroundColor: "#0A0F1E", borderColor: "#0A0F1E" },
  tabText:       { color: "#6B7280", fontSize: 12, fontWeight: "700" },
  tabTextActive: { color: "#FFFFFF" },
  tabBadge:          { backgroundColor: "#F3F4F6", borderRadius: 999, paddingHorizontal: 6, paddingVertical: 1 },
  tabBadgeActive:    { backgroundColor: "rgba(255,255,255,0.18)" },
  tabBadgeText:      { color: "#374151", fontSize: 10, fontWeight: "800" },
  tabBadgeTextActive:{ color: "#FFFFFF" },

  // ── History filter ─────────────────────────────────────
  filterRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 12,
    gap: 8,
  },
  filterLabel:         { fontSize: 12, color: "#9CA3AF", fontWeight: "700" },
  filterChip:          { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#E5E7EB" },
  filterChipActive:    { backgroundColor: "#0A0F1E", borderColor: "#0A0F1E" },
  filterChipText:      { fontSize: 12, fontWeight: "700", color: "#6B7280" },
  filterChipTextActive:{ color: "#FFFFFF" },

  resultCount: {
    paddingHorizontal: 20, paddingTop: 12, paddingBottom: 6,
    color: "#9CA3AF", fontSize: 12, fontWeight: "700",
  },

  // ── Card ───────────────────────────────────────────────
  card: {
    backgroundColor: "#FFFFFF",
    marginHorizontal: 16,
    marginBottom: 10,
    borderRadius: 18,
    flexDirection: "row",
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#E5E7EB",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },
  cardCancelled: { opacity: 0.72 },

  cardAccent:     { width: 4 },
  accentUpcoming: { backgroundColor: "#3B82F6" },
  accentCompleted:{ backgroundColor: "#22C55E" },
  accentCancelled:{ backgroundColor: "#EF4444" },

  cardBody: { flex: 1, padding: 14 },

  // Top row
  cardTopRow:   { flexDirection: "row", alignItems: "flex-start", marginBottom: 10 },
  turfName:     { fontSize: 16, fontWeight: "900", color: "#0A0F1E" },
  customerName: { marginTop: 3, color: "#9CA3AF", fontSize: 12, fontWeight: "600" },

  // Status chip
  statusChip: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 9, paddingVertical: 5, borderRadius: 999,
  },
  chipUpcoming:  { backgroundColor: "#EFF6FF" },
  chipCompleted: { backgroundColor: "#F0FDF4" },
  chipCancelled: { backgroundColor: "#FEF2F2" },
  chipText:      { fontSize: 11, fontWeight: "800" },

  // Meta chips
  metaRow:    { flexDirection: "row", gap: 6, flexWrap: "wrap", marginBottom: 10 },
  metaChip:   { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#F9FAFB", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5, borderWidth: 1, borderColor: "#F3F4F6" },
  metaText:   { fontSize: 12, color: "#374151", fontWeight: "600" },
  metaChipOffline:     { backgroundColor: "#CCFBF1", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5 },
  metaChipOfflineText: { fontSize: 11, fontWeight: "800", color: "#0F766E" },

  // Payment
  payRow:     { flexDirection: "row", alignItems: "center", gap: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: "#F3F4F6", marginBottom: 10, flexWrap: "wrap" },
  payCol:     { alignItems: "center", minWidth: 52 },
  payLabel:   { fontSize: 9, color: "#9CA3AF", fontWeight: "700", textTransform: "uppercase" },
  payValue:   { fontSize: 14, fontWeight: "900", color: "#0A0F1E", marginTop: 2 },
  payDivider: { width: 1, height: 30, backgroundColor: "#F3F4F6" },
  paidBadge:  { flexDirection: "row", alignItems: "center", gap: 4, marginLeft: "auto", backgroundColor: "#F0FDF4", paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  paidBadgeText: { fontSize: 11, fontWeight: "800", color: "#15803D" },

  // Receipt btn
  receiptBtn: {
    flexDirection: "row", alignItems: "center", gap: 4,
    alignSelf: "flex-start",
  },
  receiptBtnText: { fontSize: 12, fontWeight: "800", color: "#0A0F1E" },

  // Empty
  emptyCard: {
    backgroundColor: "#FFFFFF", marginHorizontal: 16, borderRadius: 18,
    padding: 32, borderWidth: 1, borderColor: "#E5E7EB", alignItems: "center", gap: 10,
  },
  emptyTitle: { color: "#0A0F1E", fontSize: 16, fontWeight: "800" },
  emptyText:  { color: "#9CA3AF", fontSize: 13, lineHeight: 20, textAlign: "center" },

  createdAtText: {
  fontSize: 11,
  color: "#9CA3AF",
  fontWeight: "600",
  marginBottom: 10,
},
});
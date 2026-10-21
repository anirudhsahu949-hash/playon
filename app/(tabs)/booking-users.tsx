import {
  View,
  Text,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  StatusBar,
  RefreshControl,
  Platform,
  
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

// import PagerView from "react-native-pager-view"; // ← REMOVED - not supported on web
import {
  collection,
  query,
  where,
  getDocs,
  orderBy,
} from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { db, auth } from "../../firebaseConfig";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useEffect, useMemo, useState, useRef, useCallback } from "react";

const PAGE_SIZE = 50;

// ─── Types ────────────────────────────────────────────────────────────────────
type Booking = {
  id: string;
  turfName?: string;
  turfLocation?: string;
  bookingDate: Date;
  selectedSlots?: string[];
  slot?: string;
  status?: string;
  derivedStatus: string;
  paymentStatus?: string;
  totalAmount?: number;
  advanceAmount?: number;
  remainingAmount?: number;
  createdAt?: any;
  bookingEndDate?: Date;
};

// ─── Date helpers ─────────────────────────────────────────────────────────────
function toDate(val: any): Date {
  if (!val) return new Date(NaN);
  if (typeof val.toDate === "function") return val.toDate();
  if (val instanceof Date) return isNaN(val.getTime()) ? new Date(NaN) : val;
  if (typeof val === "string" || typeof val === "number") {
    const d = new Date(val);
    return isNaN(d.getTime()) ? new Date(NaN) : d;
  }
  return new Date(NaN);
}

const isValidDate = (d: Date) => d instanceof Date && !isNaN(d.getTime());

const todayMidnight = () => {
  const d = new Date(); d.setHours(0, 0, 0, 0); return d;
};
const sevenDaysAgoMidnight = () => {
  const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - 7); return d;
};
const isToday      = (d: Date) => isValidDate(d) && d.toDateString() === new Date().toDateString();
const isUpcoming   = (d: Date) => { if (!isValidDate(d)) return false; const c = new Date(d); c.setHours(0,0,0,0); return c > todayMidnight(); };
const isWithinLast7Days = (d: Date) => { if (!isValidDate(d)) return false; const c = new Date(d); c.setHours(0,0,0,0); return c >= sevenDaysAgoMidnight() && c < todayMidnight(); };

// ─── Slot parsing ─────────────────────────────────────────────────────────────
// Returns decimal hours (0–24). Midnight END = 24 (not 0).
function parseTimeDecimal(s: string, isEnd = false): number {
  const parts = s.trim().split(" ");
  const [hStr, mStr] = parts[0].split(":");
  let h = Number(hStr);
  const m = Number(mStr || 0);
  const period = (parts[1] || "").toUpperCase();
  if (period === "PM" && h !== 12) h += 12;
  if (period === "AM" && h === 12) h = 0;
  const val = h + m / 60;
  // KEY FIX: if this is an END time and val === 0, it means 12:00 AM = midnight = 24h
  // e.g. "11:00 PM - 12:00 AM" → end should be 24, not 0
  if (isEnd && val === 0) return 24;
  return val;
}

function formatTime(v: number): string {
  v = ((v % 24) + 24) % 24; // wrap 24 → 0 for display
  const hour   = Math.floor(v);
  const minute = Math.round((v % 1) * 60);
  const suffix = hour >= 12 ? "PM" : "AM";
  const h      = hour % 12 === 0 ? 12 : hour % 12;
  return `${h}:${String(minute).padStart(2, "0")} ${suffix}`;
}

function formatDuration(hrs: number): string {
  if (hrs <= 0)  return "";
  if (hrs < 1)   return `${Math.round(hrs * 60)} min`;
  if (hrs === 1) return "1 hr";
  return `${hrs % 1 === 0 ? hrs : hrs.toFixed(1)} hrs`;
}

function mergeSlots(slots: string[]): string[] {
  if (!slots?.length) return [];
  const parsed = slots.map((s) => {
    const parts = s.split(" - ");
    if (parts.length < 2) return null;
    return { start: parseTimeDecimal(parts[0], false), end: parseTimeDecimal(parts[1], true) };
  }).filter(Boolean) as { start: number; end: number }[];
  parsed.sort((a, b) => a.start - b.start);
  const merged: { start: number; end: number }[] = [];
  for (const slot of parsed) {
    if (!merged.length) { merged.push({ ...slot }); continue; }
    const last = merged[merged.length - 1];
    if (Math.abs(slot.start - last.end) < 0.02) last.end = slot.end;
    else merged.push({ ...slot });
  }
  return merged.map(({ start, end }) => {
    const duration = end > start ? end - start : 24 - start + end;
    return `${formatTime(start)} – ${formatTime(end)}  ·  ${formatDuration(duration)}`;
  });
}

// ─── Derive booking end Date object from slots ────────────────────────────────
// This is the critical function — if slot ends at 12:00 AM, end = next day midnight
function getBookingEndDate(bookingDate: Date, slots: string[]): Date {
  const end = new Date(bookingDate);
  if (!slots.length) {
    // No slots: assume end of day
    end.setHours(23, 59, 59, 0);
    return end;
  }
  const lastSlot = slots[slots.length - 1];
  const parts    = lastSlot.split(" - ");
  if (parts.length < 2) {
    end.setHours(23, 59, 59, 0);
    return end;
  }
  const endDecimal = parseTimeDecimal(parts[1].trim(), true);
  // endDecimal === 24 means 12:00 AM = midnight = next day 00:00
  if (endDecimal === 24) {
    end.setDate(end.getDate() + 1);
    end.setHours(0, 0, 0, 0);
  } else {
    const h = Math.floor(endDecimal);
    const m = Math.round((endDecimal % 1) * 60);
    end.setHours(h, m, 0, 0);
  }
  return end;
}

// ─── Status config ────────────────────────────────────────────────────────────
const STATUS_CFG: Record<string, { color: string; bg: string; icon: any }> = {
  confirmed: { color: "#059669", bg: "#ECFDF5", icon: "checkmark-circle"          },
  cancelled: { color: "#DC2626", bg: "#FEF2F2", icon: "close-circle"              },
  completed: { color: "#6B7280", bg: "#F3F4F6", icon: "time"                      },
  pending:   { color: "#D97706", bg: "#FFFBEB", icon: "ellipsis-horizontal-circle"},
};
const getCfg = (s: string) => STATUS_CFG[s] ?? STATUS_CFG.pending;

const TABS = [
  { key: "today",     label: "Today"     },
  { key: "upcoming",  label: "Upcoming"  },
  { key: "past",      label: "Past"      },
  { key: "cancelled", label: "Cancelled" },
  { key: "all",       label: "All"       },
];
type TabKey = "today" | "upcoming" | "past" | "cancelled" | "all";

// ─── Booking Card ─────────────────────────────────────────────────────────────
const BookingCard = ({ item, router }: { item: Booking; router: any }) => {
  const cfg       = getCfg(item.derivedStatus);
  const remaining = Number(item.remainingAmount ?? 0);
  const rawSlots  = Array.isArray(item.selectedSlots)
    ? item.selectedSlots
    : item.slot ? [item.slot] : [];
  const slotRanges = mergeSlots(rawSlots);

  const dateStr = isValidDate(item.bookingDate)
    ? item.bookingDate.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" })
    : "Date unavailable";

  const bookedAtStr = item.createdAt && isValidDate(item.createdAt)
    ? item.createdAt.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })
    : null;

  return (
    <TouchableOpacity style={s.card} activeOpacity={0.92} onPress={() => router.push(`/paymentBooking/${item.id}`)}>
      <View style={s.cardTop}>
        <View style={{ flex: 1, marginRight: 10 }}>
          <Text numberOfLines={1} style={s.turfName}>{item.turfName ?? "Turf"}</Text>
          {!!item.turfLocation && (
            <Text numberOfLines={1} style={s.turfLoc}>
              <Ionicons name="location-outline" size={11} color="#9CA3AF" />{"  "}{item.turfLocation}
            </Text>
          )}
        </View>
        <View style={[s.statusBadge, { backgroundColor: cfg.bg }]}>
          <Ionicons name={cfg.icon} size={12} color={cfg.color} />
          <Text style={[s.statusTxt, { color: cfg.color }]}>
            {"  "}{item.derivedStatus.charAt(0).toUpperCase() + item.derivedStatus.slice(1)}
          </Text>
        </View>
      </View>

      <View style={s.divider} />

      <View style={s.infoRow}>
        <Ionicons name="calendar-outline" size={14} color="#9CA3AF" />
        <Text style={s.infoTxt}>{dateStr}</Text>
      </View>

      {slotRanges.length > 0 && (
        <View style={[s.infoRow, { marginTop: 5, alignItems: "flex-start" }]}>
          <Ionicons name="time-outline" size={14} color="#9CA3AF" style={{ marginTop: 2 }} />
          <View>
            {slotRanges.map((r, i) => <Text key={i} style={s.slotTxt}>{r}</Text>)}
          </View>
        </View>
      )}

      {bookedAtStr && (
        <View style={[s.infoRow, { marginTop: 5 }]}>
          <Ionicons name="receipt-outline" size={14} color="#9CA3AF" />
          <Text style={s.bookedAtTxt}>Booked on {bookedAtStr}</Text>
        </View>
      )}

      <View style={s.payRow}>
        <View>
          <Text style={s.amtLabel}>Total</Text>
          <Text style={s.amtVal}>₹{item.totalAmount ?? item.advanceAmount ?? 0}</Text>
        </View>
        <View style={{ alignItems: "center" }}>
          <Text style={s.amtLabel}>Paid</Text>
          <Text style={[s.amtVal, { color: "#059669" }]}>₹{item.advanceAmount ?? item.totalAmount ?? 0}</Text>
        </View>
        <View style={{ alignItems: "flex-end" }}>
          {remaining > 0 ? (
            <>
              <Text style={s.amtLabel}>Due at turf</Text>
              <Text style={[s.amtVal, { color: "#D97706" }]}>₹{remaining}</Text>
            </>
          ) : (
            <View style={s.paidTag}>
              <Ionicons name="checkmark" size={11} color="#059669" />
              <Text style={s.paidTagTxt}> Fully paid</Text>
            </View>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
};

// ─── Tab Page ─────────────────────────────────────────────────────────────────
const TabPage = ({ data, tabKey, refreshing, onRefresh, router }: {
  data: Booking[]; tabKey: TabKey; refreshing: boolean; onRefresh: () => void; router: any;
}) => {
  const isAllTab = tabKey === "all";
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  useEffect(() => { setVisibleCount(PAGE_SIZE); }, [data]);

  const visibleData = isAllTab ? data.slice(0, visibleCount) : data;
  const hasMore     = isAllTab && visibleCount < data.length;
  const loadMore    = useCallback(() => {
    setVisibleCount(prev => Math.min(prev + PAGE_SIZE, data.length + PAGE_SIZE));
  }, [data.length]);

  const emptyMsg = () => {
    if (tabKey === "today")     return "No bookings for today.& next day booking show in upcoming";
    if (tabKey === "upcoming")  return "You have no upcoming bookings.";
    if (tabKey === "past")      return "No bookings in the last 7 days.";
    if (tabKey === "cancelled") return "No cancelled bookings.";
    return "No bookings yet.";
  };

  const countLabel = useMemo(() => {
    let label = `${data.length} ${data.length === 1 ? "booking" : "bookings"}`;
    if (tabKey === "past") label += "  ·  last 7 days";
    if (isAllTab && data.length > PAGE_SIZE)
      label += `  ·  showing ${Math.min(visibleCount, data.length)} of ${data.length}`;
    return label;
  }, [data.length, tabKey, isAllTab, visibleCount]);

  return (
    <FlatList
      data={visibleData}
      keyExtractor={item => item.id}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={[s.listContent, visibleData.length === 0 && s.listContentEmpty]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#0B1220" />}
      ListHeaderComponent={<Text style={s.resultCount}>{countLabel}</Text>}
      ListEmptyComponent={
        <View style={s.empty}>
          <Ionicons name="calendar-outline" size={52} color="#D1D5DB" />
          <Text style={s.emptyTitle}>No bookings</Text>
          <Text style={s.emptySub}>{emptyMsg()}</Text>
        </View>
      }
      ListFooterComponent={
        hasMore ? (
          <TouchableOpacity style={s.loadMoreBtn} onPress={loadMore} activeOpacity={0.8}>
            <Ionicons name="chevron-down-circle-outline" size={18} color="#0B1220" />
            <Text style={s.loadMoreTxt}>{"  "}Load more  ·  {data.length - visibleCount} remaining</Text>
          </TouchableOpacity>
        ) : data.length > PAGE_SIZE ? (
          <View style={s.endTag}>
            <Ionicons name="checkmark-done-outline" size={15} color="#9CA3AF" />
            <Text style={s.endTagTxt}>{"  "}All {data.length} bookings loaded</Text>
          </View>
        ) : null
      }
      renderItem={({ item }) => <BookingCard item={item} router={router} />}
    />
  );
};

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function UserBookings() {
  const insets = useSafeAreaInsets();
  const [bookings,   setBookings]   = useState<Booking[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [activeTab,  setActiveTab]  = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  // const pagerRef = useRef<any>(null); // ← REMOVED - not needed without PagerView
  const router   = useRouter();

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (user) fetchBookings(user.uid);
      else      setLoading(false);
    });
    return unsub;
  }, []);

  const fetchBookings = async (uid: string) => {
    try {
      const q = query(
        collection(db, "bookings"),
        where("userId", "==", uid),
        orderBy("date", "desc")
      );
      const snap = await getDocs(q);
      const data: Booking[] = snap.docs.map(d => {
        const raw = d.data();
        return {
          id: d.id, ...raw,
          bookingDate: toDate(raw.date ?? raw.dateString),
          createdAt:   toDate(raw.createdAt),
        } as Booking;
      });
      setBookings(data);
    } catch (e) {
      console.error("Fetch bookings error:", e);
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = async () => {
    if (!auth.currentUser) return;
    setRefreshing(true);
    await fetchBookings(auth.currentUser.uid);
    setRefreshing(false);
  };

  // ── Derive status ──────────────────────────────────────────────────────────
  const prepared = useMemo<Booking[]>(() => {
    return bookings.map(b => {
      // Cancelled stays cancelled
      if (b.status === "cancelled") return { ...b, derivedStatus: "cancelled" };

      const slots = Array.isArray(b.selectedSlots)
        ? b.selectedSlots
        : b.slot ? [b.slot] : [];

      // ✅ Use fixed getBookingEndDate — handles 12:00 AM correctly
      const bookingEndDate = getBookingEndDate(b.bookingDate, slots);

      const now = new Date();
      // If current time is past the booking end → completed
      // Otherwise → confirmed (still upcoming or ongoing)
      const derivedStatus = now > bookingEndDate ? "completed" : "confirmed";

      return { ...b, derivedStatus, bookingEndDate };
    }).sort((a, b) =>
      (b.bookingEndDate ?? b.bookingDate).getTime() -
      (a.bookingEndDate ?? a.bookingDate).getTime()
    );
  }, [bookings]);

  // ── Per-tab data ──────────────────────────────────────────────────────────
  const tabData = useMemo<Record<TabKey, Booking[]>>(() => ({
    today: prepared.filter(b => isToday(b.bookingDate)),
    upcoming:  prepared.filter(b => isUpcoming(b.bookingDate) && b.derivedStatus !== "cancelled"),
    past:      prepared.filter(b => b.derivedStatus === "completed" && isWithinLast7Days(b.bookingDate)),
    cancelled: prepared.filter(b => b.derivedStatus === "cancelled"),
    all:       prepared,
  }), [prepared]);

  const stats = useMemo(() => ({
    today:    tabData.today.length,
    upcoming: tabData.upcoming.length,
  }), [tabData]);

  const goToTab = useCallback((index: number) => {
    setActiveTab(index);
    // pagerRef.current?.setPage(index); // ← REMOVED - not needed without PagerView
  }, []);

  const TAB_KEYS: TabKey[] = ["today", "upcoming", "past", "cancelled", "all"];

  if (loading) return (
    <SafeAreaView style={s.center}>
      <StatusBar barStyle="dark-content" backgroundColor="#fff" />
      <ActivityIndicator size="large" color="#0B1220" />
      <Text style={s.loadingText}>Loading bookings…</Text>
    </SafeAreaView>
  );

  return (
    <View style={s.root}>
      <StatusBar barStyle="dark-content" backgroundColor="#fff" />

      {/* Header */}
       <View style={[s.header, { paddingTop: insets.top + 14 }]}>
        <View style={{ flex: 1 }}>
          <Text style={s.headerTitle}>All Bookings</Text>
          <Text style={s.headerSub}>Your complete booking history</Text>
        </View>
        <View style={s.pillRow}>
          <View style={s.pill}>
            <Text style={s.pillNum}>{stats.today}</Text>
            <Text style={s.pillLabel}>Today</Text>
          </View>
          <View style={s.pill}>
            <Text style={s.pillNum}>{stats.upcoming}</Text>
            <Text style={s.pillLabel}>Soon</Text>
          </View>
        </View>
      </View>

      {/* Tab bar */}
      <View style={s.tabBar}>
        {TABS.map((tab, index) => {
          const active = activeTab === index;
          return (
            <TouchableOpacity key={tab.key} style={s.tabItem} onPress={() => goToTab(index)} activeOpacity={0.7}>
              <Text style={[s.tabTxt, active && s.tabTxtActive]}>{tab.label}</Text>
              {active && <View style={s.tabUnderline} />}
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Tab content - show only active tab (no swipe on web) */}
      <View style={{ flex: 1 }}>
        {TAB_KEYS.map((key, index) => (
          <View key={key} style={{ display: activeTab === index ? "flex" : "none", flex: 1 }}>
            <TabPage
              data={tabData[key]} tabKey={key}
              refreshing={refreshing && activeTab === index}
              onRefresh={onRefresh} router={router}
            />
          </View>
        ))}
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root:             { flex: 1, backgroundColor: "#F5F6FA" },
  center:           { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#fff" },
  loadingText:      { marginTop: 12, fontSize: 14, color: "#6B7280" },
  listContent:      { paddingBottom: 120, paddingTop: 4 },
  listContentEmpty: { flexGrow: 1 },

header: {
  flexDirection: "row", alignItems: "center", justifyContent: "space-between",
  backgroundColor: "#fff", paddingHorizontal: 20,
  
  paddingBottom: 14,
},

  headerTitle: { fontSize: 22, fontWeight: "800", color: "#0B1220", letterSpacing: -0.3 },
  headerSub:   { fontSize: 13, color: "#9CA3AF", marginTop: 2 },
  pillRow:     { flexDirection: "row", gap: 8 },
  pill:        { backgroundColor: "#F5F6FA", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7, alignItems: "center", minWidth: 52 },
  pillNum:     { fontSize: 16, fontWeight: "800", color: "#0B1220" },
  pillLabel:   { fontSize: 10, fontWeight: "600", color: "#9CA3AF", marginTop: 1 },
  tabBar:      { flexDirection: "row", backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#F0F0F0", paddingHorizontal: 4 },
  tabItem:     { flex: 1, alignItems: "center", paddingVertical: 12, position: "relative" },
  tabTxt:      { fontSize: 12, fontWeight: "600", color: "#9CA3AF" },
  tabTxtActive:{ color: "#0B1220", fontWeight: "800" },
  tabUnderline:{ position: "absolute", bottom: 0, left: "15%", right: "15%", height: 2.5, backgroundColor: "#0B1220", borderRadius: 99 },
  resultCount: { fontSize: 11, fontWeight: "600", color: "#9CA3AF", paddingHorizontal: 20, paddingTop: 12, paddingBottom: 6, textTransform: "uppercase", letterSpacing: 0.6 },
  card:        { backgroundColor: "#fff", borderRadius: 16, marginHorizontal: 16, marginBottom: 10, padding: 16, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 2 },
  cardTop:     { flexDirection: "row", alignItems: "flex-start" },
  turfName:    { fontSize: 16, fontWeight: "700", color: "#0B1220" },
  turfLoc:     { fontSize: 12, color: "#9CA3AF", marginTop: 3 },
  statusBadge: { flexDirection: "row", alignItems: "center", paddingHorizontal: 9, paddingVertical: 5, borderRadius: 20 },
  statusTxt:   { fontSize: 12, fontWeight: "700" },
  divider:     { height: 1, backgroundColor: "#F3F4F6", marginVertical: 12 },
  infoRow:     { flexDirection: "row", alignItems: "center", gap: 8 },
  infoTxt:     { fontSize: 13, color: "#4B5563", fontWeight: "500" },
  slotTxt:     { fontSize: 13, color: "#0B1220", fontWeight: "600", lineHeight: 21 },
  bookedAtTxt: { fontSize: 12, color: "#6B7280", fontWeight: "500" },
  payRow:      { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: "#F3F4F6" },
  amtLabel:    { fontSize: 11, color: "#9CA3AF", fontWeight: "500", marginBottom: 2 },
  amtVal:      { fontSize: 15, fontWeight: "800", color: "#0B1220" },
  paidTag:     { flexDirection: "row", alignItems: "center", backgroundColor: "#ECFDF5", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 20 },
  paidTagTxt:  { fontSize: 11, fontWeight: "700", color: "#059669" },
  loadMoreBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", marginHorizontal: 16, marginTop: 6, marginBottom: 16, paddingVertical: 14, borderRadius: 12, backgroundColor: "#fff", borderWidth: 1.5, borderColor: "#E5E7EB", shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 3, elevation: 1 },
  loadMoreTxt: { fontSize: 14, fontWeight: "700", color: "#0B1220" },
  endTag:      { flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 20, paddingBottom: 32 },
  endTagTxt:   { fontSize: 12, color: "#9CA3AF", fontWeight: "500" },
  empty:       { alignItems: "center", paddingTop: 80, paddingHorizontal: 40 },
  emptyTitle:  { fontSize: 18, fontWeight: "700", color: "#374151", marginTop: 16 },
  emptySub:    { fontSize: 14, color: "#9CA3AF", textAlign: "center", marginTop: 6, lineHeight: 21 },
});
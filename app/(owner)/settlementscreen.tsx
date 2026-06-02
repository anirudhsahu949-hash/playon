import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  StatusBar,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Platform,
  Modal,
  FlatList,
} from "react-native";
import { useEffect, useMemo, useState, useCallback } from "react";
import { useRouter } from "expo-router";
import { auth, db } from "../../firebaseConfig";
import { collection, getDocs, query, where } from "firebase/firestore";
import { Ionicons } from "@expo/vector-icons";

// ─────────────────────────────────────────────────────────────────────────────
// SETTLEMENT SCREEN
//
// Shows ONLY online payments (money that went through Razorpay) for a
// chosen date range. This is what the owner actually received in their
// bank account (before Razorpay's 2% fee).
//
// Online payment = paidAmount / advanceAmount (Razorpay advance)
// Cash at venue is NOT counted here — that's separate.
// ─────────────────────────────────────────────────────────────────────────────

const DARK  = "#0A0F1E";
const GREEN = "#22C55E";

type Booking = {
  id: string;
  turfId?: string;
  turfName?: string;
  date?: any;
  dateString?: string;
  status?: string;
  bookingType?: string;    // "full" | "advance"
  paymentStatus?: string;
  totalAmount?: number;
  paidAmount?: number;
  advanceAmount?: number;
  remainingAmount?: number;
  remainingCollected?: boolean;
  userName?: string;
  userPhone?: string;
  selectedSlots?: string[];
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function getSafeDate(val: any): Date | null {
  if (!val) return null;
  if (typeof val?.toDate === "function") return val.toDate();
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
}

function toMidnight(d: Date): Date {
  const c = new Date(d); c.setHours(0, 0, 0, 0); return c;
}

function fmtFull(n: number): string {
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

function fmtShort(n: number): string {
  if (n >= 100000) return `₹${(n / 100000).toFixed(1)}L`;
  if (n >= 1000)   return `₹${(n / 1000).toFixed(1)}K`;
  return `₹${Math.round(n)}`;
}

// Online paid = the Razorpay advance amount (what landed in owner's bank)
function getOnlinePaid(b: Booking): number {
  return Number(b.paidAmount ?? b.advanceAmount ?? 0);
}

function getTotal(b: Booking): number {
  return Number(b.totalAmount ?? 0);
}

function getRemaining(b: Booking): number {
  return Number(b.remainingAmount ?? Math.max(getTotal(b) - getOnlinePaid(b), 0));
}

// Net after Razorpay 2% fee


function fmtDateDisplay(d: Date): string {
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function fmtDateShort(d: Date): string {
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

// ── Calendar picker component ─────────────────────────────────────────────────
function CalendarPicker({
  visible,
  title,
  selectedDate,
  minDate,
  maxDate,
  onSelect,
  onClose,
}: {
  visible: boolean;
  title: string;
  selectedDate: Date;
  minDate?: Date;
  maxDate?: Date;
  onSelect: (d: Date) => void;
  onClose: () => void;
}) {
  const [viewMonth, setViewMonth] = useState(() => {
    const d = new Date(selectedDate);
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d;
  });

  const today = toMidnight(new Date());

  const daysInMonth = useMemo(() => {
    const year  = viewMonth.getFullYear();
    const month = viewMonth.getMonth();
    const first = new Date(year, month, 1).getDay(); // 0=Sun
    const total = new Date(year, month + 1, 0).getDate();
    const cells: (Date | null)[] = [];
    for (let i = 0; i < first; i++) cells.push(null);
    for (let d = 1; d <= total; d++) cells.push(new Date(year, month, d));
    return cells;
  }, [viewMonth]);

  const prevMonth = () => {
    const d = new Date(viewMonth);
    d.setMonth(d.getMonth() - 1);
    setViewMonth(d);
  };
  const nextMonth = () => {
    const d = new Date(viewMonth);
    d.setMonth(d.getMonth() + 1);
    setViewMonth(d);
  };

  const isDisabled = (d: Date) => {
    if (minDate && toMidnight(d) < toMidnight(minDate)) return true;
    if (maxDate && toMidnight(d) > toMidnight(maxDate)) return true;
    return false;
  };

  const isSelected = (d: Date) => toMidnight(d).getTime() === toMidnight(selectedDate).getTime();
  const isToday    = (d: Date) => toMidnight(d).getTime() === today.getTime();

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={cal.backdrop}>
        <TouchableOpacity style={{ flex: 1 }} onPress={onClose} activeOpacity={1} />
        <View style={cal.sheet}>
          <View style={cal.handle} />
          <Text style={cal.title}>{title}</Text>

          {/* Month nav */}
          <View style={cal.monthNav}>
            <TouchableOpacity style={cal.navBtn} onPress={prevMonth}>
              <Ionicons name="chevron-back" size={18} color="#374151" />
            </TouchableOpacity>
            <Text style={cal.monthLabel}>
              {viewMonth.toLocaleDateString("en-IN", { month: "long", year: "numeric" })}
            </Text>
            <TouchableOpacity style={cal.navBtn} onPress={nextMonth}>
              <Ionicons name="chevron-forward" size={18} color="#374151" />
            </TouchableOpacity>
          </View>

          {/* Day headers */}
          <View style={cal.weekRow}>
            {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((w) => (
              <Text key={w} style={cal.weekDay}>{w}</Text>
            ))}
          </View>

          {/* Days grid */}
          <View style={cal.grid}>
            {daysInMonth.map((d, i) => {
              if (!d) return <View key={`e-${i}`} style={cal.dayCell} />;
              const disabled = isDisabled(d);
              const selected = isSelected(d);
              const isT      = isToday(d);
              return (
                <TouchableOpacity
                  key={i}
                  style={[
                    cal.dayCell,
                    selected  && cal.dayCellSelected,
                    isT && !selected && cal.dayCellToday,
                  ]}
                  onPress={() => { if (!disabled) { onSelect(d); onClose(); } }}
                  disabled={disabled}
                >
                  <Text style={[
                    cal.dayText,
                    selected  && cal.dayTextSelected,
                    isT && !selected && cal.dayTextToday,
                    disabled  && cal.dayTextDisabled,
                  ]}>
                    {d.getDate()}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <TouchableOpacity style={cal.cancelBtn} onPress={onClose}>
            <Text style={cal.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const cal = StyleSheet.create({
  backdrop:  { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet:     { backgroundColor: "#FFFFFF", borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 20, paddingBottom: Platform.OS === "ios" ? 36 : 24 },
  handle:    { width: 40, height: 4, borderRadius: 2, backgroundColor: "#E5E7EB", alignSelf: "center", marginBottom: 20 },
  title:     { fontSize: 18, fontWeight: "900", color: "#0A0F1E", marginBottom: 20, textAlign: "center" },
  monthNav:  { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16 },
  navBtn:    { width: 36, height: 36, borderRadius: 10, backgroundColor: "#F3F4F6", justifyContent: "center", alignItems: "center" },
  monthLabel:{ fontSize: 15, fontWeight: "800", color: "#111827" },
  weekRow:   { flexDirection: "row", marginBottom: 8 },
  weekDay:   { flex: 1, textAlign: "center", fontSize: 11, fontWeight: "700", color: "#9CA3AF" },
  grid:      { flexDirection: "row", flexWrap: "wrap" },
  dayCell:   { width: "14.28%", aspectRatio: 1, justifyContent: "center", alignItems: "center", padding: 2 },
  dayCellSelected: { backgroundColor: DARK, borderRadius: 10 },
  dayCellToday:    { backgroundColor: "#F0FDF4", borderRadius: 10, borderWidth: 1.5, borderColor: GREEN },
  dayText:         { fontSize: 14, fontWeight: "600", color: "#374151" },
  dayTextSelected: { color: "#FFFFFF", fontWeight: "800" },
  dayTextToday:    { color: "#15803D", fontWeight: "800" },
  dayTextDisabled: { color: "#D1D5DB" },
  cancelBtn: { backgroundColor: "#F3F4F6", paddingVertical: 14, borderRadius: 16, alignItems: "center", marginTop: 16 },
  cancelText:{ color: "#374151", fontWeight: "700", fontSize: 15 },
});

// ── Quick range presets ───────────────────────────────────────────────────────
const PRESETS: { label: string; days: number }[] = [
  { label: "Last 7 days",  days: 7  },
  { label: "Last 15 days", days: 15 },
  { label: "Last 30 days", days: 30 },
  { label: "This month",   days: -1 }, // handled specially
];

// ── Main screen ───────────────────────────────────────────────────────────────
export default function SettlementScreen() {
  const router = useRouter();

  const [bookings, setBookings]     = useState<Booking[]>([]);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Date range state
  const [startDate, setStartDate] = useState<Date>(() => {
    const d = new Date(); d.setDate(d.getDate() - 6); d.setHours(0, 0, 0, 0); return d;
  });
  const [endDate, setEndDate] = useState<Date>(() => {
    const d = new Date(); d.setHours(23, 59, 59, 999); return d;
  });
  const [showStartPicker, setShowStartPicker] = useState(false);
  const [showEndPicker,   setShowEndPicker]   = useState(false);

  useEffect(() => { fetchBookings(); }, []);

  const fetchBookings = async (isRefresh = false) => {
    const uid = auth.currentUser?.uid;
    if (!uid) { setLoading(false); return; }
    isRefresh ? setRefreshing(true) : setLoading(true);
    try {
      const snap = await getDocs(
        query(collection(db, "bookings"), where("ownerId", "==", uid))
      );
      setBookings(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Booking)));
    } catch (e) { console.log(e); }
    finally { setLoading(false); setRefreshing(false); }
  };

  const applyPreset = (days: number) => {
    const end = new Date(); end.setHours(23, 59, 59, 999);
    let start: Date;
    if (days === -1) {
      // This month
      start = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
      start.setHours(0, 0, 0, 0);
    } else {
      start = new Date();
      start.setDate(start.getDate() - (days - 1));
      start.setHours(0, 0, 0, 0);
    }
    setStartDate(start);
    setEndDate(end);
  };

  // ── Filtered bookings: online only, within date range ─────────────────────
  // "Online" = not cancelled, has a paidAmount > 0 (went through Razorpay)
  const filtered = useMemo(() => {
    const start = toMidnight(startDate);
    const end   = new Date(endDate); end.setHours(23, 59, 59, 999);

    return bookings.filter((b) => {
      if (b.status === "cancelled") return false;
      const d = getSafeDate(b.date || b.dateString);
      if (!d) return false;
      if (d < start || d > end) return false;
      // Only include bookings where customer paid something online
      const onlinePaid = getOnlinePaid(b);
      return onlinePaid > 0;
    });
  }, [bookings, startDate, endDate]);

  // ── Stats ──────────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    let totalOnline    = 0;
    let fullPayOnline  = 0;   // full payment bookings — entire amount online
    let advanceOnline  = 0;   // advance bookings — only advance paid online
    let fullPayCount   = 0;
    let advanceCount   = 0;

    filtered.forEach((b) => {
      const online = getOnlinePaid(b);
      totalOnline += online;
      if (b.bookingType === "full") {
        fullPayOnline += online;
        fullPayCount++;
      } else {
        advanceOnline += online;
        advanceCount++;
      }
    });


    return {
      totalOnline,
      fullPayOnline, fullPayCount,
      advanceOnline, advanceCount,
      
      totalBookings: filtered.length,
      avgPerBooking: filtered.length > 0 ? Math.round(totalOnline / filtered.length) : 0,
    };
  }, [filtered]);

  // ── By turf breakdown ──────────────────────────────────────────────────────
 



  // ── Per-booking list (sorted newest first) ────────────────────────────────


  const dayCount = useMemo(() => {
    const diff = toMidnight(endDate).getTime() - toMidnight(startDate).getTime();
    return Math.round(diff / (1000 * 60 * 60 * 24)) + 1;
  }, [startDate, endDate]);

  if (loading) return (
    <SafeAreaView style={s.loadWrap}>
      <StatusBar barStyle="light-content" backgroundColor={DARK} />
      <ActivityIndicator size="large" color={GREEN} />
      <Text style={s.loadText}>Loading settlement data...</Text>
    </SafeAreaView>
  );

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="light-content" backgroundColor={DARK} />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={s.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => fetchBookings(true)} tintColor={GREEN} />}
      >
        {/* ── Hero ── */}
        <View style={s.hero}>
          <View style={s.glow1} /><View style={s.glow2} />

          <View style={s.heroTop}>
            <TouchableOpacity style={s.backBtn} onPress={() => router.back()}>
              <Ionicons name="arrow-back" size={20} color="#fff" />
            </TouchableOpacity>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={s.heroTag}>OWNER · SETTLEMENT</Text>
              <Text style={s.heroTitle}>Online Settlement</Text>
            </View>
          </View>

          {/* Info note */}
          

          {/* Total received */}
          <View style={s.totalWrap}>
            <Text style={s.totalLabel}>Online received · {dayCount} day{dayCount !== 1 ? "s" : ""}</Text>
            <Text style={s.totalValue}>{fmtFull(stats.totalOnline)}</Text>
            <Text style={s.totalSub}>
              {stats.totalBookings} bookings · avg {fmtShort(stats.avgPerBooking)}/booking
            </Text>
          </View>

          {/* Fee + net chips */}
          
        </View>

        {/* ── Date range picker ── */}
        <View style={s.card}>
          <Text style={s.cardTitle}>Select Date Range</Text>
          <Text style={s.cardSub}>Tap to change start or end date</Text>

          <View style={s.datePickerRow}>
            <TouchableOpacity style={s.datePill} onPress={() => setShowStartPicker(true)} activeOpacity={0.8}>
              <Ionicons name="calendar-outline" size={15} color="#0A0F1E" />
              <View>
                <Text style={s.datePillLabel}>From</Text>
                <Text style={s.datePillValue}>{fmtDateDisplay(startDate)}</Text>
              </View>
            </TouchableOpacity>

            <View style={s.dateArrow}>
              <Ionicons name="arrow-forward" size={16} color="#9CA3AF" />
            </View>

            <TouchableOpacity style={s.datePill} onPress={() => setShowEndPicker(true)} activeOpacity={0.8}>
              <Ionicons name="calendar-outline" size={15} color="#0A0F1E" />
              <View>
                <Text style={s.datePillLabel}>To</Text>
                <Text style={s.datePillValue}>{fmtDateDisplay(endDate)}</Text>
              </View>
            </TouchableOpacity>
          </View>

          {/* Quick presets */}
          <Text style={s.presetLabel}>Quick select</Text>
          <View style={s.presetRow}>
            {PRESETS.map((p) => (
              <TouchableOpacity
                key={p.label}
                style={s.presetChip}
                onPress={() => applyPreset(p.days)}
                activeOpacity={0.20}
              >
                <Text style={s.presetChipText}>{p.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* ── Summary breakdown ── */}
        <View style={s.card}>
          <Text style={s.cardTitle}>Payment Type Breakdown</Text>
          <Text style={s.cardSub}>{fmtDateDisplay(startDate)} → {fmtDateDisplay(endDate)}</Text>

          <View style={s.breakdownGrid}>
            {/* Full payment */}
            <View style={[s.breakdownBox, s.breakdownBoxFull]}>
              <View style={s.breakdownHeader}>
                <View style={[s.breakdownDot, { backgroundColor: "#7C3AED" }]} />
                <Text style={s.breakdownBoxTitle}>Full Payments</Text>
              </View>
              <Text style={s.breakdownAmount}>{fmtFull(stats.fullPayOnline)}</Text>
              <Text style={s.breakdownCount}>{stats.fullPayCount} bookings</Text>
              <Text style={s.breakdownNote}>Entire amount paid online</Text>
            </View>

            {/* Advance payment */}
            <View style={[s.breakdownBox, s.breakdownBoxAdv]}>
              <View style={s.breakdownHeader}>
                <View style={[s.breakdownDot, { backgroundColor: "#2563EB" }]} />
                <Text style={s.breakdownBoxTitle}>Advance Paid</Text>
              </View>
              <Text style={s.breakdownAmount}>{fmtFull(stats.advanceOnline)}</Text>
              <Text style={s.breakdownCount}>{stats.advanceCount} bookings</Text>
              <Text style={s.breakdownNote}>Deposit only, rest cash</Text>
            </View>
          </View>

          {/* Total bar */}
          <View style={s.totalBarWrap}>
            <View style={s.totalBarRow}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <View style={[s.breakdownDot, { backgroundColor: "#7C3AED" }]} />
                <Text style={s.totalBarLabel}>Full</Text>
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginLeft: 16 }}>
                <View style={[s.breakdownDot, { backgroundColor: "#2563EB" }]} />
                <Text style={s.totalBarLabel}>Advance</Text>
              </View>
              <Text style={[s.totalBarLabel, { marginLeft: "auto" }]}>{fmtFull(stats.totalOnline)}</Text>
            </View>
            <View style={s.totalBarTrack}>
              {stats.totalOnline > 0 && (
                <>
                  <View style={[s.totalBarSegment, {
                    flex: stats.fullPayOnline,
                    backgroundColor: "#7C3AED",
                  }]} />
                  <View style={[s.totalBarSegment, {
                    flex: stats.advanceOnline,
                    backgroundColor: "#2563EB",
                  }]} />
                </>
              )}
            </View>
          </View>
        </View>

        {/* ── Fee breakdown ── */}
        <View style={s.card}>
          <Text style={s.cardTitle}> Breakdown</Text>
          <Text style={s.cardSub}>Estimated  online payments</Text>

          <View style={s.feeTable}>
            {[
              { label: "Gross online collected",    value: fmtFull(stats.totalOnline),      color: "#111827", bold: false },
             
            ].map((row) => (
              <View key={row.label} style={s.feeTableRow}>
                <Text style={s.feeTableLabel}>{row.label}</Text>
                <Text style={[s.feeTableValue, { color: row.color, fontWeight: row.bold ? "900" : "700" }]}>
                  {row.value}
                </Text>
              </View>
            ))}
          </View>

          
        </View>

        {/* ── By turf ── */}
     

        {/* ── Booking list ── */}
       

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* ── Date pickers ── */}
      <CalendarPicker
        visible={showStartPicker}
        title="Select Start Date"
        selectedDate={startDate}
        maxDate={endDate}
        onSelect={(d) => { setStartDate(d); }}
        onClose={() => setShowStartPicker(false)}
      />
      <CalendarPicker
        visible={showEndPicker}
        title="Select End Date"
        selectedDate={endDate}
        minDate={startDate}
        maxDate={new Date()}
        onSelect={(d) => { const end = new Date(d); end.setHours(23, 59, 59, 999); setEndDate(end); }}
        onClose={() => setShowEndPicker(false)}
      />
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  safe:     { flex: 1, backgroundColor: "#F0F4F8" },
  scroll:   { paddingBottom: 24 },
  loadWrap: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: DARK },
  loadText: { color: "#9CA3AF", marginTop: 12, fontSize: 15, fontWeight: "600" },

  // Hero
  hero: {
    backgroundColor: DARK,
    paddingHorizontal: 20,
    paddingTop: Platform.OS === "android" ? (StatusBar.currentHeight || 0) + 14 : 20,
    paddingBottom: 28, overflow: "hidden",
  },
  glow1: { position: "absolute", top: -40, right: -30, width: 200, height: 200, borderRadius: 100, backgroundColor: "rgba(34,197,94,0.10)" },
  glow2: { position: "absolute", bottom: -80, left: -50, width: 220, height: 220, borderRadius: 110, backgroundColor: "rgba(99,102,241,0.08)" },

  heroTop:   { flexDirection: "row", alignItems: "center", marginBottom: 16 },
  backBtn:   { width: 36, height: 36, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.1)", justifyContent: "center", alignItems: "center" },
  heroTag:   { color: "#9CA3AF", fontSize: 10, fontWeight: "800", letterSpacing: 1.2 },
  heroTitle: { color: "#FFFFFF", fontSize: 24, fontWeight: "900", marginTop: 2 },

  infoNote: {
    flexDirection: "row", alignItems: "flex-start", gap: 6,
    backgroundColor: "rgba(96,165,250,0.1)", borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 8, marginBottom: 20,
    borderWidth: 1, borderColor: "rgba(96,165,250,0.2)",
  },
  infoNoteText: { color: "#93C5FD", fontSize: 12, fontWeight: "500", flex: 1, lineHeight: 17 },

  totalWrap:  { marginBottom: 20 },
  totalLabel: { color: "#9CA3AF", fontSize: 12, fontWeight: "600" },
  totalValue: { color: "#FFFFFF", fontSize: 36, fontWeight: "900", marginTop: 4, letterSpacing: -0.5 },
  totalSub:   { color: "#6B7280", fontSize: 13, marginTop: 6, fontWeight: "500" },

  feeRow: { flexDirection: "row", gap: 10 },
  feeBox: {
    flex: 1, backgroundColor: "rgba(255,255,255,0.07)",
    borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: "rgba(255,255,255,0.08)",
  },
  feeBoxGreen: { backgroundColor: "rgba(34,197,94,0.1)", borderColor: "rgba(34,197,94,0.2)" },
  feeLabel: { fontSize: 11, color: "#9CA3AF", fontWeight: "600", marginBottom: 6 },
  feeValue: { fontSize: 17, fontWeight: "900", color: "#FFFFFF" },

  // Card
  card: {
    backgroundColor: "#FFFFFF", marginHorizontal: 16, marginTop: 16,
    borderRadius: 20, padding: 18,
    borderWidth: 1, borderColor: "#E5E7EB",
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05, shadowRadius: 8, elevation: 2,
  },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 },
  cardTitle:  { fontSize: 16, fontWeight: "900", color: "#111827" },
  cardSub:    { fontSize: 12, color: "#9CA3AF", fontWeight: "500", marginTop: 2 },

  // Date picker
  datePickerRow: { flexDirection: "row", alignItems: "center", marginTop: 16, gap: 10 ,},
  datePill: {
    flex: 1, flexDirection: "row", alignItems: "center", gap: 10,
    backgroundColor: "#F9FAFB", borderRadius: 14, padding: 14,
    borderWidth: 1.5, borderColor: "#E5E7EB",
  },
  datePillLabel: { fontSize: 10, color: "#9CA3AF", fontWeight: "700", textTransform: "uppercase" },
  datePillValue: { fontSize: 14, color: "#111827", fontWeight: "800", marginTop: 2 },
  dateArrow:     { alignItems: "center", justifyContent: "center" },

  presetLabel: { fontSize: 11, color: "#9CA3AF", fontWeight: "700", textTransform: "uppercase", marginTop: 20, marginBottom: 10 },
  presetRow:   { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  presetChip:  { paddingHorizontal: 14, paddingVertical: 8, backgroundColor: DARK, borderRadius: 999 },
  presetChipText: { color: "#FFFFFF", fontSize: 12, fontWeight: "700" },

  // Breakdown grid
  breakdownGrid: { flexDirection: "row", gap: 10, marginTop: 16 },
  breakdownBox:  { flex: 1, borderRadius: 16, padding: 14, borderWidth: 1 },
  breakdownBoxFull: { backgroundColor: "#F5F3FF", borderColor: "#DDD6FE" },
  breakdownBoxAdv:  { backgroundColor: "#EFF6FF", borderColor: "#BFDBFE" },
  breakdownHeader:  { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 10 },
  breakdownDot:     { width: 8, height: 8, borderRadius: 4 },
  breakdownBoxTitle:{ fontSize: 12, fontWeight: "800", color: "#374151" },
  breakdownAmount:  { fontSize: 20, fontWeight: "900", color: "#111827" },
  breakdownCount:   { fontSize: 11, color: "#6B7280", fontWeight: "600", marginTop: 4 },
  breakdownNote:    { fontSize: 10, color: "#9CA3AF", fontWeight: "500", marginTop: 3 },

  // Total bar
  totalBarWrap:    { marginTop: 16, paddingTop: 16, borderTopWidth: 1, borderTopColor: "#F3F4F6" },
  totalBarRow:     { flexDirection: "row", alignItems: "center", marginBottom: 10 },
  totalBarLabel:   { fontSize: 12, fontWeight: "700", color: "#374151" },
  totalBarTrack:   { height: 10, borderRadius: 5, flexDirection: "row", overflow: "hidden", backgroundColor: "#F3F4F6" },
  totalBarSegment: { height: 10 },

  // Fee table
  feeTable:   { marginTop: 16, gap: 0 },
  feeTableRow:{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: "#F3F4F6" },
  feeTableLabel: { fontSize: 13, color: "#6B7280", fontWeight: "600" },
  feeTableValue: { fontSize: 15, fontWeight: "800" },

  feeNote: {
    flexDirection: "row", alignItems: "flex-start", gap: 7,
    backgroundColor: "#FFFBEB", borderRadius: 10, padding: 10, marginTop: 14,
    borderWidth: 1, borderColor: "#FDE68A",
  },
  feeNoteText: { fontSize: 11, color: "#92400E", fontWeight: "500", flex: 1, lineHeight: 17 },

  // Turf rows
  turfRow:     { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" },
  turfName:    { fontSize: 14, fontWeight: "800", color: "#111827" },
  turfMeta:    { fontSize: 11, color: "#9CA3AF", marginTop: 2, fontWeight: "500" },
  turfOnline:  { fontSize: 15, fontWeight: "900", color: "#111827" },
  turfNet:     { fontSize: 11, color: "#6B7280", fontWeight: "600", marginTop: 2 },
  turfBar:     { height: 6, borderRadius: 3, flexDirection: "row", overflow: "hidden", marginTop: 10 },
  turfBarFull: { backgroundColor: "#7C3AED" },
  turfBarAdv:  { backgroundColor: "#2563EB" },

  // Booking list rows
  txRow: {
    flexDirection: "row", alignItems: "flex-start",
    paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: "#F3F4F6",
    marginTop: 4,
  },
  txBar:      { width: 3, height: "100%", minHeight: 60, borderRadius: 2, marginTop: 2 },
  txTopRow:   { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  txMidRow:   { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 3 },
  txBottomRow:{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 },
  txName:     { fontSize: 14, fontWeight: "800", color: "#111827" },
  txAmount:   { fontSize: 15, fontWeight: "900", color: "#111827" },
  txMeta:     { fontSize: 11, color: "#9CA3AF", fontWeight: "500" },
  txNet:      { fontSize: 11, color: "#6B7280", fontWeight: "600" },
  txPill:     { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  txPillFull: { backgroundColor: "#F5F3FF" },
  txPillAdv:  { backgroundColor: "#EFF6FF" },
  txPillText: { fontSize: 10, fontWeight: "800" },
  txTotalNote:{ fontSize: 11, color: "#9CA3AF", fontWeight: "500" },

  // Empty
  empty:      { alignItems: "center", paddingVertical: 36, gap: 10 },
  emptyTitle: { fontSize: 15, fontWeight: "800", color: "#374151" },
  emptySub:   { fontSize: 13, color: "#9CA3AF", fontWeight: "500" },
});
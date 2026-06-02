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
  Dimensions,
} from "react-native";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "expo-router";
import { auth, db } from "../../firebaseConfig";
import { collection, getDocs, query, where } from "firebase/firestore";
import { Ionicons } from "@expo/vector-icons";

const DARK   = "#0A0F1E";
const GREEN  = "#22C55E";
const { width: SW } = Dimensions.get("window");

type Booking = {
  id: string;
  turfId?: string;
  turfName?: string;
  date?: any;
  dateString?: string;
  status?: string;
  bookingType?: string;
  paymentStatus?: string;
  totalAmount?: number;
  paidAmount?: number;
  advanceAmount?: number;
  remainingAmount?: number;
  remainingCollected?: boolean;
  userName?: string;
  selectedSlots?: string[];
  createdAt?: any;
};

type Range = "7d" | "15d" | "30d";

function getSafeDate(val: any): Date | null {
  if (!val) return null;
  if (typeof val?.toDate === "function") return val.toDate();
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
}

function fmtAmount(n: number): string {
  if (n >= 100000) return `₹${(n / 100000).toFixed(1)}L`;
  if (n >= 1000)   return `₹${(n / 1000).toFixed(1)}K`;
  return `₹${Math.round(n)}`;
}

function fmtFull(n: number): string {
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

function getPaid(b: Booking): number {
  return Number(b.paidAmount ?? b.advanceAmount ?? 0);
}

function getTotal(b: Booking): number {
  return Number(b.totalAmount ?? 0);
}

function getRemaining(b: Booking): number {
  return Number(b.remainingAmount ?? Math.max(getTotal(b) - getPaid(b), 0));
}

// ── Bar chart ─────────────────────────────────────────────────────────────────
function BarChart({ data }: { data: { label: string; value: number }[] }) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <View style={ch.wrap}>
      <View style={ch.bars}>
        {data.map((d, i) => {
          const h = Math.max((d.value / max) * 110, d.value > 0 ? 4 : 0);
          const showLabel = i % Math.ceil(data.length / 6) === 0;
          return (
            <View key={i} style={ch.barCol}>
              <View style={[ch.bar, { height: h, backgroundColor: d.value > 0 ? GREEN : "#E5E7EB" }]} />
              {showLabel && <Text style={ch.barLabel}>{d.label}</Text>}
            </View>
          );
        })}
      </View>
    </View>
  );
}

const ch = StyleSheet.create({
  wrap:     { marginTop: 8 },
  bars:     { flexDirection: "row", alignItems: "flex-end", height: 120, gap: 2 },
  barCol:   { flex: 1, alignItems: "center", justifyContent: "flex-end" },
  bar:      { width: "80%", borderRadius: 3, minHeight: 0 },
  barLabel: { fontSize: 8, color: "#9CA3AF", marginTop: 4, fontWeight: "600" },
});

// ── Main ──────────────────────────────────────────────────────────────────────
export default function RevenueScreen() {
  const router = useRouter();

  const [bookings, setBookings]     = useState<Booking[]>([]);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [range, setRange]           = useState<Range>("7d");

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

  const days = range === "7d" ? 7 : range === "15d" ? 15 : 30;

  const rangeStart = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - (days - 1));
    d.setHours(0, 0, 0, 0);
    return d;
  }, [days]);

  const filtered = useMemo(() =>
    bookings.filter((b) => {
      if (b.status === "cancelled") return false;
      const d = getSafeDate(b.date || b.dateString);
      return d && d >= rangeStart;
    }),
  [bookings, rangeStart]);

  const stats = useMemo(() => {
    let onlinePaid    = 0;
    let cashCollected = 0;
    let fullPayCount  = 0;
    let advanceCount  = 0;

    const cancelCount = bookings.filter((b) => {
      const d = getSafeDate(b.date || b.dateString);
      return b.status === "cancelled" && d && d >= rangeStart;
    }).length;

    filtered.forEach((b) => {
      onlinePaid    += getPaid(b);
      cashCollected += b.remainingCollected ? getRemaining(b) : 0;
      if (b.bookingType === "full") fullPayCount++;
      else advanceCount++;
    });

    const totalRevenue = onlinePaid + cashCollected;
    return {
      totalRevenue, onlinePaid, cashCollected,
      totalBookings: filtered.length,
      fullPayCount, advanceCount, cancelCount,
      avgPerBooking: filtered.length > 0 ? Math.round(totalRevenue / filtered.length) : 0,
    };
  }, [filtered, bookings, rangeStart]);

  const chartData = useMemo(() => {
    const map: Record<string, number> = {};
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      map[d.toDateString()] = 0;
    }
    filtered.forEach((b) => {
      const d = getSafeDate(b.date || b.dateString);
      if (!d) return;
      const key = d.toDateString();
      if (key in map) map[key] += getPaid(b);
    });
    return Object.entries(map).map(([dateStr, value]) => {
      const d = new Date(dateStr);
      return { label: d.toLocaleDateString("en-IN", { day: "numeric", month: "short" }), value };
    });
  }, [filtered, days]);

  const byTurf = useMemo(() => {
    const map: Record<string, { name: string; revenue: number; bookings: number }> = {};
    filtered.forEach((b) => {
      const key = b.turfId || "unknown";
      if (!map[key]) map[key] = { name: b.turfName || "Unknown Turf", revenue: 0, bookings: 0 };
      map[key].revenue  += getPaid(b);
      map[key].bookings += 1;
    });
    return Object.values(map).sort((a, b) => b.revenue - a.revenue);
  }, [filtered]);

  const maxTurfRev = Math.max(...byTurf.map((t) => t.revenue), 1);

  if (loading) return (
    <SafeAreaView style={s.loadWrap}>
      <StatusBar barStyle="light-content" backgroundColor={DARK} />
      <ActivityIndicator size="large" color={GREEN} />
      <Text style={s.loadText}>Loading revenue...</Text>
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
              <Text style={s.heroTag}>OWNER · REVENUE</Text>
              <Text style={s.heroTitle}>Revenue</Text>
            </View>
            {/* Settlement button */}
            <TouchableOpacity
              style={s.settlementBtn}
              onPress={() => router.push("/(owner)/settlementscreen")}
            >
              <Ionicons name="document-text-outline" size={15} color="#22C55E" />
              <Text style={s.settlementBtnText}>Settlement</Text>
            </TouchableOpacity>
          </View>

          {/* Range toggle */}
          <View style={s.rangeRow}>
            {(["7d", "15d", "30d"] as Range[]).map((r) => (
              <TouchableOpacity
                key={r}
                style={[s.rangeBtn, range === r && s.rangeBtnActive]}
                onPress={() => setRange(r)}
              >
                <Text style={[s.rangeBtnText, range === r && s.rangeBtnTextActive]}>
                  {r === "7d" ? "7 Days" : r === "15d" ? "15 Days" : "30 Days"}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Total */}
          <View style={s.totalWrap}>
            <Text style={s.totalLabel}>Total Revenue · Last {days} days</Text>
            <Text style={s.totalValue}>{fmtFull(stats.totalRevenue)}</Text>
            <Text style={s.totalSub}>
              {stats.totalBookings} bookings · avg {fmtAmount(stats.avgPerBooking)}/booking
            </Text>
          </View>

          {/* Chips */}
          <View style={s.chipRow}>
            {[
              { label: "Online Paid",    value: fmtAmount(stats.onlinePaid),     color: "#4ADE80" },
              { label: "Cash Collected", value: fmtAmount(stats.cashCollected),  color: "#60A5FA" },
              { label: "Full Pay",       value: stats.fullPayCount,              color: "#A78BFA" },
              { label: "Advance",        value: stats.advanceCount,              color: "#FB923C" },
            ].map((c) => (
              <View key={c.label} style={s.chip}>
                <Text style={[s.chipValue, { color: c.color }]}>{c.value}</Text>
                <Text style={s.chipLabel}>{c.label}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* ── Settlement CTA card ── */}
        <TouchableOpacity
          style={s.settlementCard}
          onPress={() => router.push("/(owner)/settlementscreen")}
          activeOpacity={0.88}
        >
          <View style={s.settlementCardLeft}>
            <View style={s.settlementIcon}>
              <Ionicons name="calculator-outline" size={22} color="#15803D" />
            </View>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={s.settlementCardTitle}>Settlement Calculator</Text>
              <Text style={s.settlementCardSub}>
                Pick any date range → see exact online amount received
              </Text>
            </View>
          </View>
          <Ionicons name="arrow-forward" size={18} color="#15803D" />
        </TouchableOpacity>

        {/* ── Daily chart ── */}
        <View style={s.card}>
          <View style={s.cardHeader}>
            <Text style={s.cardTitle}>Daily Revenue</Text>
            <Text style={s.cardSub}>Last {days} days</Text>
          </View>
          <BarChart data={chartData} />
          {chartData.length > 0 && (() => {
            const peak = chartData.reduce((p, c) => c.value > p.value ? c : p, chartData[0]);
            return (
              <View style={s.peakRow}>
                <Ionicons name="trending-up-outline" size={14} color={GREEN} />
                <Text style={s.peakText}>
                  Peak: {fmtAmount(peak.value)} on {peak.label}
                </Text>
              </View>
            );
          })()}
        </View>

        {/* ── Payment breakdown ── */}
        <View style={s.card}>
          <Text style={s.cardTitle}>Payment Breakdown</Text>
          <View style={{ marginTop: 14, gap: 14 }}>
            {[
              {
                label: "Full Payments",
                count: stats.fullPayCount,
                color: "#A78BFA",
                pct: stats.totalBookings > 0 ? stats.fullPayCount / stats.totalBookings : 0,
              },
              {
                label: "Advance Payments",
                count: stats.advanceCount,
                color: "#60A5FA",
                pct: stats.totalBookings > 0 ? stats.advanceCount / stats.totalBookings : 0,
              },
              {
                label: "Cancelled",
                count: stats.cancelCount,
                color: "#F87171",
                pct: stats.totalBookings + stats.cancelCount > 0
                  ? stats.cancelCount / (stats.totalBookings + stats.cancelCount) : 0,
              },
            ].map((row) => (
              <View key={row.label}>
                <View style={s.breakRow}>
                  <View style={[s.breakDot, { backgroundColor: row.color }]} />
                  <Text style={s.breakLabel}>{row.label}</Text>
                  <Text style={s.breakCount}>{row.count}</Text>
                  <Text style={s.breakPct}>{Math.round(row.pct * 100)}%</Text>
                </View>
                <View style={s.breakBar}>
                  <View style={[s.breakBarFill, { width: `${Math.round(row.pct * 100)}%`, backgroundColor: row.color }]} />
                </View>
              </View>
            ))}
          </View>
        </View>

        {/* ── Revenue by turf ── */}
        {byTurf.length > 0 && (
          <View style={s.card}>
            <Text style={s.cardTitle}>Revenue by Turf</Text>
            <View style={{ marginTop: 14, gap: 14 }}>
              {byTurf.map((t, i) => (
                <View key={i}>
                  <View style={s.turfRevRow}>
                    <View style={{ flex: 1, marginRight: 12 }}>
                      <Text style={s.turfRevName}>{t.name}</Text>
                      <Text style={s.turfRevMeta}>{t.bookings} bookings</Text>
                    </View>
                    <Text style={s.turfRevAmount}>{fmtFull(t.revenue)}</Text>
                  </View>
                  <View style={s.turfRevBar}>
                    <View style={[s.turfRevBarFill, { width: `${Math.round((t.revenue / maxTurfRev) * 100)}%` }]} />
                  </View>
                </View>
              ))}
            </View>
          </View>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:     { flex: 1, backgroundColor: "#F0F4F8" },
  scroll:   { paddingBottom: 24 },
  loadWrap: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: DARK },
  loadText: { color: "#9CA3AF", marginTop: 12, fontSize: 15, fontWeight: "600" },

  hero: {
    backgroundColor: DARK,
    paddingHorizontal: 20,
    paddingTop: Platform.OS === "android" ? (StatusBar.currentHeight || 0) + 14 : 20,
    paddingBottom: 28, overflow: "hidden",
  },
  glow1: { position: "absolute", top: -40, right: -30, width: 200, height: 200, borderRadius: 100, backgroundColor: "rgba(34,197,94,0.12)" },
  glow2: { position: "absolute", bottom: -80, left: -50, width: 220, height: 220, borderRadius: 110, backgroundColor: "rgba(99,102,241,0.08)" },

  heroTop:   { flexDirection: "row", alignItems: "center", marginBottom: 20 },
  backBtn:   { width: 36, height: 36, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.1)", justifyContent: "center", alignItems: "center" },
  heroTag:   { color: "#9CA3AF", fontSize: 10, fontWeight: "800", letterSpacing: 1.2 },
  heroTitle: { color: "#FFFFFF", fontSize: 24, fontWeight: "900", marginTop: 2 },

  settlementBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "rgba(34,197,94,0.12)",
    borderWidth: 1, borderColor: "rgba(34,197,94,0.3)",
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12,
  },
  settlementBtnText: { color: "#22C55E", fontSize: 12, fontWeight: "800" },

  rangeRow:           { flexDirection: "row", gap: 8, marginBottom: 24 },
  rangeBtn:           { flex: 1, paddingVertical: 9, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.08)", alignItems: "center" },
  rangeBtnActive:     { backgroundColor: GREEN },
  rangeBtnText:       { fontSize: 13, fontWeight: "700", color: "#9CA3AF" },
  rangeBtnTextActive: { color: "#fff" },

  totalWrap:  { marginBottom: 20 },
  totalLabel: { color: "#9CA3AF", fontSize: 12, fontWeight: "600" },
  totalValue: { color: "#FFFFFF", fontSize: 36, fontWeight: "900", marginTop: 4, letterSpacing: -0.5 },
  totalSub:   { color: "#6B7280", fontSize: 13, marginTop: 6, fontWeight: "500" },

  chipRow:   { flexDirection: "row", gap: 8 },
  chip:      { flex: 1, backgroundColor: "rgba(255,255,255,0.06)", borderRadius: 14, paddingVertical: 12, alignItems: "center", borderWidth: 1, borderColor: "rgba(255,255,255,0.08)" },
  chipValue: { fontSize: 14, fontWeight: "900" },
  chipLabel: { color: "#6B7280", fontSize: 8, fontWeight: "700", marginTop: 3, textTransform: "uppercase", textAlign: "center" },

  // Settlement CTA
  settlementCard: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    backgroundColor: "#F0FDF4", marginHorizontal: 16, marginTop: 16,
    borderRadius: 18, padding: 16,
    borderWidth: 1.5, borderColor: "#BBF7D0",
  },
  settlementCardLeft:  { flexDirection: "row", alignItems: "center", flex: 1 },
  settlementIcon:      { width: 44, height: 44, borderRadius: 14, backgroundColor: "#DCFCE7", justifyContent: "center", alignItems: "center" },
  settlementCardTitle: { fontSize: 15, fontWeight: "900", color: "#15803D" },
  settlementCardSub:   { fontSize: 12, color: "#4B7C59", marginTop: 2, fontWeight: "500" },

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

  peakRow:  { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: "#F3F4F6" },
  peakText: { fontSize: 12, color: "#374151", fontWeight: "600" },

  breakRow:    { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 },
  breakDot:    { width: 8, height: 8, borderRadius: 4 },
  breakLabel:  { flex: 1, fontSize: 13, color: "#374151", fontWeight: "600" },
  breakCount:  { fontSize: 13, fontWeight: "800", color: "#111827", minWidth: 28, textAlign: "right" },
  breakPct:    { fontSize: 12, color: "#9CA3AF", fontWeight: "600", minWidth: 36, textAlign: "right" },
  breakBar:    { height: 5, backgroundColor: "#F3F4F6", borderRadius: 3, overflow: "hidden", marginBottom: 4 },
  breakBarFill:{ height: 5, borderRadius: 3 },

  turfRevRow:     { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" },
  turfRevName:    { fontSize: 14, fontWeight: "800", color: "#111827" },
  turfRevMeta:    { fontSize: 11, color: "#9CA3AF", marginTop: 2, fontWeight: "500" },
  turfRevAmount:  { fontSize: 15, fontWeight: "900", color: "#111827" },
  turfRevBar:     { height: 5, backgroundColor: "#F3F4F6", borderRadius: 3, overflow: "hidden", marginTop: 8 },
  turfRevBarFill: { height: 5, borderRadius: 3, backgroundColor: GREEN },
});
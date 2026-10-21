/**
 * admin/area-analytics.tsx
 * Booking heatmap & area analytics screen
 * Shows which areas generate most bookings, revenue, and users
 */
import {
  View, Text, StyleSheet,  StatusBar,
  ScrollView, TouchableOpacity, ActivityIndicator,
  Platform, RefreshControl, Dimensions,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useEffect, useState, useMemo } from "react";
import { db } from "../../firebaseConfig";
import { collection, getDocs } from "firebase/firestore";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";

const DARK  = "#0A0F1E";
const ACCENT = "#0EA5A4";
const { width: SCREEN_W } = Dimensions.get("window");

// ── Types ──────────────────────────────────────────────────────────────────────
type AreaStat = {
  area:          string;
  city:          string;
  bookingCount:  number;
  totalRevenue:  number;
  uniqueUsers:   number;
  uniqueTurfs:   string[];
  avgBookingValue: number;
  lat:           number;
  lng:           number;
};

type TurfStat = {
  id:           string;
  name:         string;
  location:     string;
  bookingCount: number;
  totalRevenue: number;
  uniqueUsers:  number;
  lat:          number | null;
  lng:          number | null;
};

type DayStat = {
  date:         string;
  bookingCount: number;
  revenue:      number;
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R    = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a    = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Cluster lat/lng into ~2km grid cells to group nearby bookings
function getAreaKey(lat: number, lng: number): string {
  const precision = 2; // ~1.1km per 0.01 degree
  return `${lat.toFixed(precision)},${lng.toFixed(precision)}`;
}

function formatCurrency(n: number): string {
  if (n >= 100000) return `₹${(n / 100000).toFixed(1)}L`;
  if (n >= 1000)   return `₹${(n / 1000).toFixed(1)}K`;
  return `₹${n}`;
}

function getHeatColor(ratio: number): string {
  // ratio 0–1 where 1 = hottest area
  if (ratio > 0.8) return "#EF4444"; // red
  if (ratio > 0.6) return "#F97316"; // orange
  if (ratio > 0.4) return "#EAB308"; // yellow
  if (ratio > 0.2) return "#22C55E"; // green
  return "#0EA5A4";                   // teal = cold
}

function getHeatLabel(ratio: number): string {
  if (ratio > 0.8) return "🔥 Hot";
  if (ratio > 0.6) return "⚡ Active";
  if (ratio > 0.4) return "✅ Moderate";
  if (ratio > 0.2) return "🌱 Growing";
  return "💤 Low";
}

// ─────────────────────────────────────────────────────────────────────────────
export default function AreaAnalytics() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab,        setTab]        = useState<"areas" | "turfs" | "trend">("areas");

  const [bookings, setBookings] = useState<any[]>([]);
  const [users,    setUsers]    = useState<any[]>([]);
  const [turfs,    setTurfs]    = useState<any[]>([]);

  useEffect(() => { fetchAll(); }, []);

  const fetchAll = async (isRefresh = false) => {
    isRefresh ? setRefreshing(true) : setLoading(true);
    try {
      const [bSnap, uSnap, tSnap] = await Promise.all([
        getDocs(collection(db, "bookings")),
        getDocs(collection(db, "users")),
        getDocs(collection(db, "turfs")),
      ]);
      setBookings(bSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      setUsers(uSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      setTurfs(tSnap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (e) { console.error(e); }
    finally { setLoading(false); setRefreshing(false); }
  };

  // ── Area stats — cluster bookings by user's GPS location ─────────────────
  const areaStats = useMemo((): AreaStat[] => {
    const userMap: Record<string, any> = {};
    users.forEach(u => { userMap[u.id] = u; });

    const turfMap: Record<string, any> = {};
    turfs.forEach(t => { turfMap[t.id] = t; });

    const clusters: Record<string, {
      area: string; city: string; lat: number; lng: number;
      bookingCount: number; revenue: number;
      userIds: Set<string>; turfIds: Set<string>;
    }> = {};

    bookings
      .filter(b => b.status !== "cancelled")
      .forEach(b => {
        // Use turf location as the area anchor (more reliable than user location)
        const turf = turfMap[b.turfId];
        if (!turf?.latitude || !turf?.longitude) return;

        const key = getAreaKey(turf.latitude, turf.longitude);
        if (!clusters[key]) {
          clusters[key] = {
            area:  turf.location?.split(",")[0]?.trim() || "Unknown",
            city:  turf.location?.split(",").slice(-1)[0]?.trim() || "",
            lat:   turf.latitude,
            lng:   turf.longitude,
            bookingCount: 0,
            revenue:      0,
            userIds:  new Set(),
            turfIds:  new Set(),
          };
        }
        clusters[key].bookingCount += 1;
        clusters[key].revenue      += Number(b.totalAmount || b.advanceAmount || 0);
        if (b.userId)  clusters[key].userIds.add(b.userId);
        if (b.turfId)  clusters[key].turfIds.add(b.turfId);
      });

    return Object.values(clusters)
      .map(c => ({
        area:            c.area,
        city:            c.city,
        bookingCount:    c.bookingCount,
        totalRevenue:    c.revenue,
        uniqueUsers:     c.userIds.size,
        uniqueTurfs:     [...c.turfIds],
        avgBookingValue: c.bookingCount > 0 ? Math.round(c.revenue / c.bookingCount) : 0,
        lat:             c.lat,
        lng:             c.lng,
      }))
      .sort((a, b) => b.bookingCount - a.bookingCount);
  }, [bookings, users, turfs]);

  // ── Turf stats ────────────────────────────────────────────────────────────
  const turfStats = useMemo((): TurfStat[] => {
    const turfMap: Record<string, any> = {};
    turfs.forEach(t => { turfMap[t.id] = t; });

    const stats: Record<string, TurfStat> = {};
    bookings
      .filter(b => b.status !== "cancelled")
      .forEach(b => {
        if (!b.turfId) return;
        if (!stats[b.turfId]) {
          const t = turfMap[b.turfId];
          stats[b.turfId] = {
            id:           b.turfId,
            name:         t?.name     || "Unknown",
            location:     t?.location || "—",
            bookingCount: 0,
            totalRevenue: 0,
            uniqueUsers:  0,
            lat:          t?.latitude  ?? null,
            lng:          t?.longitude ?? null,
          };
        }
        stats[b.turfId].bookingCount += 1;
        stats[b.turfId].totalRevenue += Number(b.totalAmount || b.advanceAmount || 0);
      });

    // Count unique users per turf
    const turfUserMap: Record<string, Set<string>> = {};
    bookings
      .filter(b => b.status !== "cancelled" && b.turfId && b.userId)
      .forEach(b => {
        if (!turfUserMap[b.turfId]) turfUserMap[b.turfId] = new Set();
        turfUserMap[b.turfId].add(b.userId);
      });
    Object.entries(turfUserMap).forEach(([turfId, set]) => {
      if (stats[turfId]) stats[turfId].uniqueUsers = set.size;
    });

    return Object.values(stats).sort((a, b) => b.bookingCount - a.bookingCount);
  }, [bookings, turfs]);

  // ── 7-day trend ───────────────────────────────────────────────────────────
  const trendStats = useMemo((): DayStat[] => {
    const days: Record<string, { count: number; revenue: number }> = {};
    const today = new Date();

    // Init last 14 days
    for (let i = 13; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const key = d.toDateString();
      days[key] = { count: 0, revenue: 0 };
    }

    bookings
      .filter(b => b.status !== "cancelled")
      .forEach(b => {
        const key = b.dateString;
        if (days[key]) {
          days[key].count   += 1;
          days[key].revenue += Number(b.totalAmount || b.advanceAmount || 0);
        }
      });

    return Object.entries(days).map(([date, v]) => ({
      date,
      bookingCount: v.count,
      revenue:      v.revenue,
    }));
  }, [bookings]);

  // ── Summary numbers ───────────────────────────────────────────────────────
  const summary = useMemo(() => {
    const active = bookings.filter(b => b.status !== "cancelled");
    const revenue = active.reduce((sum, b) => sum + Number(b.totalAmount || b.advanceAmount || 0), 0);
    const uniqueUsers = new Set(active.map(b => b.userId).filter(Boolean)).size;
    return {
      total:       active.length,
      revenue,
      uniqueUsers,
      areas:       areaStats.length,
    };
  }, [bookings, areaStats]);

  const maxBookings = areaStats[0]?.bookingCount || 1;
  const maxTurfBookings = turfStats[0]?.bookingCount || 1;
  const maxDayCount = Math.max(...trendStats.map(d => d.bookingCount), 1);

  if (loading) return (
    <SafeAreaView style={s.loadWrap}>
      <ActivityIndicator size="large" color={ACCENT} />
      <Text style={s.loadTxt}>Analysing booking data...</Text>
    </SafeAreaView>
  );

  return (
    <View style={s.safe}>
      <StatusBar barStyle="light-content" backgroundColor={DARK} />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 60 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => fetchAll(true)} tintColor={ACCENT} />}
      >
        {/* ── Hero ── */}
         <View style={[s.hero, { paddingTop: insets.top + 12 }]}>
          <TouchableOpacity style={s.backBtn} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={20} color="#fff" />
          </TouchableOpacity>
          <Text style={s.heroTag}>Admin Analytics</Text>
          <Text style={s.heroTitle}>Booking Heatmap</Text>
          <Text style={s.heroSub}>See which areas & turfs drive the most bookings.</Text>

          {/* Summary pills */}
          <View style={s.summaryRow}>
            {[
              { label: "Bookings",  value: summary.total,       color: "#34D399" },
              { label: "Revenue",   value: formatCurrency(summary.revenue), color: "#60A5FA" },
              { label: "Users",     value: summary.uniqueUsers, color: "#F472B6" },
              { label: "Areas",     value: summary.areas,       color: "#FBBF24" },
            ].map(item => (
              <View key={item.label} style={s.summaryPill}>
                <Text style={[s.summaryVal, { color: item.color }]}>{item.value}</Text>
                <Text style={s.summaryLabel}>{item.label}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* ── Tabs ── */}
        <View style={s.tabRow}>
          {([
            { key: "areas",  label: "📍 By Area"  },
            { key: "turfs",  label: "🏟 By Turf"  },
            { key: "trend",  label: "📈 Trend"    },
          ] as const).map(t => (
            <TouchableOpacity
              key={t.key}
              style={[s.tabBtn, tab === t.key && s.tabBtnActive]}
              onPress={() => setTab(t.key)}
            >
              <Text style={[s.tabTxt, tab === t.key && s.tabTxtActive]}>{t.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* ── Areas Tab ── */}
        {tab === "areas" && (
          <View style={s.body}>
            {areaStats.length === 0 ? (
              <EmptyState icon="📍" title="No area data yet" sub="Bookings with turf GPS coordinates will appear here." />
            ) : (
              <>
                <Text style={s.sectionLabel}>TOP BOOKING AREAS · {areaStats.length} zones</Text>
                {areaStats.map((area, i) => {
                  const ratio = area.bookingCount / maxBookings;
                  const heat  = getHeatColor(ratio);
                  const barW  = Math.max((ratio * (SCREEN_W - 80)), 24);
                  return (
                    <View key={`${area.lat}-${area.lng}`} style={s.areaCard}>
                      <View style={s.areaRankWrap}>
                        <Text style={s.areaRank}>#{i + 1}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <View style={s.areaTopRow}>
                          <View style={{ flex: 1 }}>
                            <Text style={s.areaName}>{area.area}</Text>
                            {area.city ? <Text style={s.areaCity}>{area.city}</Text> : null}
                          </View>
                          <View style={[s.heatBadge, { backgroundColor: heat + "22", borderColor: heat + "55" }]}>
                            <Text style={[s.heatBadgeTxt, { color: heat }]}>{getHeatLabel(ratio)}</Text>
                          </View>
                        </View>

                        {/* Heat bar */}
                        <View style={s.barTrack}>
                          <View style={[s.barFill, { width: barW, backgroundColor: heat }]} />
                        </View>

                        {/* Stats row */}
                        <View style={s.areaStatRow}>
                          {[
                            { icon: "calendar-outline",  val: area.bookingCount,                 label: "bookings" },
                            { icon: "cash-outline",      val: formatCurrency(area.totalRevenue), label: "revenue"  },
                            { icon: "people-outline",    val: area.uniqueUsers,                  label: "users"    },
                            { icon: "football-outline",  val: area.uniqueTurfs.length,           label: "turfs"    },
                          ].map(stat => (
                            <View key={stat.label} style={s.statChip}>
                              <Ionicons name={stat.icon as any} size={11} color="#6B7280" />
                              <Text style={s.statChipVal}>{stat.val}</Text>
                              <Text style={s.statChipLabel}>{stat.label}</Text>
                            </View>
                          ))}
                        </View>

                        {/* Avg booking value */}
                        <Text style={s.avgVal}>
                          Avg booking value: <Text style={{ fontWeight: "800", color: DARK }}>
                            {formatCurrency(area.avgBookingValue)}
                          </Text>
                        </Text>
                      </View>
                    </View>
                  );
                })}
              </>
            )}
          </View>
        )}

        {/* ── Turfs Tab ── */}
        {tab === "turfs" && (
          <View style={s.body}>
            {turfStats.length === 0 ? (
              <EmptyState icon="🏟" title="No turf data yet" sub="Confirmed bookings will appear here." />
            ) : (
              <>
                <Text style={s.sectionLabel}>TOP PERFORMING TURFS · {turfStats.length} venues</Text>
                {turfStats.map((turf, i) => {
                  const ratio = turf.bookingCount / maxTurfBookings;
                  const heat  = getHeatColor(ratio);
                  const barW  = Math.max((ratio * (SCREEN_W - 80)), 24);
                  return (
                    <View key={turf.id} style={s.areaCard}>
                      <View style={[s.areaRankWrap, { backgroundColor: i < 3 ? "#FEF3C7" : "#F3F4F6" }]}>
                        <Text style={[s.areaRank, { color: i < 3 ? "#D97706" : "#6B7280" }]}>
                          {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `#${i + 1}`}
                        </Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <View style={s.areaTopRow}>
                          <View style={{ flex: 1 }}>
                            <Text style={s.areaName}>{turf.name}</Text>
                            <Text style={s.areaCity}>{turf.location}</Text>
                          </View>
                          <Text style={[s.heatBadgeTxt, { color: heat, fontWeight: "900", fontSize: 13 }]}>
                            {turf.bookingCount} bkgs
                          </Text>
                        </View>

                        <View style={s.barTrack}>
                          <View style={[s.barFill, { width: barW, backgroundColor: heat }]} />
                        </View>

                        <View style={s.areaStatRow}>
                          {[
                            { icon: "cash-outline",   val: formatCurrency(turf.totalRevenue), label: "revenue" },
                            { icon: "people-outline", val: turf.uniqueUsers,                  label: "users"   },
                            { icon: "location-outline", val: turf.lat != null ? "GPS ✓" : "No GPS", label: "" },
                          ].map(stat => (
                            <View key={stat.label + stat.val} style={s.statChip}>
                              <Ionicons name={stat.icon as any} size={11} color="#6B7280" />
                              <Text style={s.statChipVal}>{stat.val}</Text>
                              {stat.label ? <Text style={s.statChipLabel}>{stat.label}</Text> : null}
                            </View>
                          ))}
                        </View>
                      </View>
                    </View>
                  );
                })}
              </>
            )}
          </View>
        )}

        {/* ── Trend Tab ── */}
        {tab === "trend" && (
          <View style={s.body}>
            <Text style={s.sectionLabel}>LAST 14 DAYS</Text>
            {trendStats.every(d => d.bookingCount === 0) ? (
              <EmptyState icon="📈" title="No trend data yet" sub="Daily booking trends will appear here." />
            ) : (
              <View style={s.trendCard}>
                {/* Bar chart */}
                <View style={s.chartWrap}>
                  {trendStats.map((day, i) => {
                    const ratio = day.bookingCount / maxDayCount;
                    const barH  = Math.max(ratio * 120, day.bookingCount > 0 ? 8 : 2);
                    const d     = new Date(day.date);
                    const label = `${d.getDate()}/${d.getMonth() + 1}`;
                    const isToday = day.date === new Date().toDateString();
                    return (
                      <View key={day.date} style={s.chartCol}>
                        {day.bookingCount > 0 && (
                          <Text style={s.chartBarVal}>{day.bookingCount}</Text>
                        )}
                        <View style={[
                          s.chartBar,
                          { height: barH, backgroundColor: isToday ? "#EF4444" : ACCENT },
                        ]} />
                        <Text style={[s.chartLabel, isToday && { color: "#EF4444", fontWeight: "800" }]}>
                          {label}
                        </Text>
                      </View>
                    );
                  })}
                </View>

                {/* Revenue trend */}
                <View style={s.trendDivider} />
                <Text style={s.trendSectionLabel}>Revenue per day</Text>
                {trendStats.filter(d => d.bookingCount > 0).map(day => {
                  const d = new Date(day.date);
                  return (
                    <View key={day.date} style={s.trendRow}>
                      <Text style={s.trendDate}>
                        {d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })}
                      </Text>
                      <View style={s.trendBarWrap}>
                        <View style={[
                          s.trendBar,
                          { width: Math.max((day.revenue / Math.max(...trendStats.map(d => d.revenue), 1)) * 140, 8) }
                        ]} />
                      </View>
                      <Text style={s.trendRevenue}>{formatCurrency(day.revenue)}</Text>
                      <Text style={s.trendCount}>{day.bookingCount} bkgs</Text>
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────
function EmptyState({ icon, title, sub }: { icon: string; title: string; sub: string }) {
  return (
    <View style={s.empty}>
      <Text style={{ fontSize: 40 }}>{icon}</Text>
      <Text style={s.emptyTitle}>{title}</Text>
      <Text style={s.emptySub}>{sub}</Text>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: "#F0F4F8" },
  loadWrap:{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: DARK },
  loadTxt: { marginTop: 12, color: "#9CA3AF", fontSize: 15, fontWeight: "600" },

  hero: {
    backgroundColor: DARK,
    paddingHorizontal: 20,
    paddingBottom: 24,
    overflow: "hidden",
  },
  backBtn:  { width: 36, height: 36, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.1)", justifyContent: "center", alignItems: "center", marginBottom: 12 },
  heroTag:  { color: "#6EE7B7", fontSize: 11, fontWeight: "800", letterSpacing: 1.5, textTransform: "uppercase" },
  heroTitle:{ color: "#fff", fontSize: 26, fontWeight: "900", marginTop: 4 },
  heroSub:  { color: "#9CA3AF", fontSize: 13, lineHeight: 20, marginTop: 6 },

  summaryRow:   { flexDirection: "row", gap: 8, marginTop: 18, flexWrap: "wrap" },
  summaryPill:  { backgroundColor: "rgba(255,255,255,0.07)", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, alignItems: "center", minWidth: 70 },
  summaryVal:   { fontSize: 20, fontWeight: "900" },
  summaryLabel: { color: "#9CA3AF", fontSize: 10, fontWeight: "600", marginTop: 2, textTransform: "uppercase" },

  tabRow:      { flexDirection: "row", backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#F3F4F6" },
  tabBtn:      { flex: 1, paddingVertical: 13, alignItems: "center" },
  tabBtnActive:{ borderBottomWidth: 2, borderBottomColor: ACCENT },
  tabTxt:      { fontSize: 13, fontWeight: "600", color: "#9CA3AF" },
  tabTxtActive:{ color: ACCENT, fontWeight: "800" },

  body:         { padding: 16 },
  sectionLabel: { fontSize: 10, fontWeight: "800", color: "#9CA3AF", letterSpacing: 1.2, marginBottom: 12 },

  areaCard: {
    flexDirection: "row",
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    gap: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 2,
  },
  areaRankWrap: { width: 36, height: 36, borderRadius: 10, backgroundColor: "#F3F4F6", alignItems: "center", justifyContent: "center" },
  areaRank:     { fontSize: 13, fontWeight: "900", color: "#6B7280" },

  areaTopRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 8 },
  areaName:   { fontSize: 15, fontWeight: "800", color: "#111827" },
  areaCity:   { fontSize: 11, color: "#9CA3AF", marginTop: 2 },

  heatBadge:    { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 99, borderWidth: 1 },
  heatBadgeTxt: { fontSize: 11, fontWeight: "700" },

  barTrack: { height: 6, backgroundColor: "#F3F4F6", borderRadius: 3, marginBottom: 10, overflow: "hidden" },
  barFill:  { height: 6, borderRadius: 3 },

  areaStatRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 6 },
  statChip:    { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#F9FAFB", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, borderWidth: 1, borderColor: "#F3F4F6" },
  statChipVal: { fontSize: 12, fontWeight: "800", color: "#111827" },
  statChipLabel:{ fontSize: 10, color: "#9CA3AF", fontWeight: "600" },
  avgVal:      { fontSize: 11, color: "#9CA3AF", fontWeight: "500" },

  trendCard:   { backgroundColor: "#fff", borderRadius: 16, padding: 16, borderWidth: 1, borderColor: "#E5E7EB" },
  chartWrap:   { flexDirection: "row", alignItems: "flex-end", gap: 4, height: 160, paddingTop: 24 },
  chartCol:    { flex: 1, alignItems: "center", justifyContent: "flex-end", gap: 4 },
  chartBar:    { width: "100%", borderRadius: 4, minHeight: 2 },
  chartBarVal: { fontSize: 9, fontWeight: "800", color: DARK, position: "absolute", top: -14 },
  chartLabel:  { fontSize: 8, color: "#9CA3AF", fontWeight: "600", textAlign: "center" },

  trendDivider:     { height: 1, backgroundColor: "#F3F4F6", marginVertical: 16 },
  trendSectionLabel:{ fontSize: 11, fontWeight: "800", color: "#6B7280", marginBottom: 10, textTransform: "uppercase", letterSpacing: 0.5 },
  trendRow:    { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 },
  trendDate:   { fontSize: 11, color: "#374151", fontWeight: "600", width: 72 },
  trendBarWrap:{ flex: 1 },
  trendBar:    { height: 6, backgroundColor: ACCENT, borderRadius: 3 },
  trendRevenue:{ fontSize: 12, fontWeight: "800", color: "#111827", width: 52, textAlign: "right" },
  trendCount:  { fontSize: 10, color: "#9CA3AF", width: 40, textAlign: "right" },

  empty:      { alignItems: "center", paddingVertical: 48 },
  emptyTitle: { fontSize: 17, fontWeight: "800", color: "#374151", marginTop: 12 },
  emptySub:   { fontSize: 13, color: "#9CA3AF", textAlign: "center", marginTop: 6, lineHeight: 20 },
});
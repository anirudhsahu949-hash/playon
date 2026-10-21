import {
  View, Text, StyleSheet, StatusBar,
  ScrollView, TouchableOpacity, ActivityIndicator,
  RefreshControl, Alert, Platform, Image, Dimensions,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { useEffect, useState, useCallback } from "react";
import { db, auth } from "../../firebaseConfig";
import {
  collection, getDocs, query, where, doc, getDoc,
} from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import Svg, {
  Path, Circle, Line, Text as SvgText,
  Defs, LinearGradient, Stop, G,
} from "react-native-svg";
import AdminNavBar from "./adminavabar";
import { DrawerActions } from "@react-navigation/native";
import { useNavigation } from "expo-router";

const { width: SW } = Dimensions.get("window");
const DARK  = "#0A0F1E";
const DARK2 = "#111827";
const CARD  = "#FFFFFF";
const BG    = "#F4F6FA";

type Booking = {
  id: string;
  turfName?: string;
  turfId?: string;
  userName?: string;
  date?: any;
  dateString?: string;
  selectedSlots?: string[];
  slotTime?: string;
  totalAmount?: number;
  paidAmount?: number;
  price?: number;
  status?: string;
  images?: string[];
  image?: string;
};

type DayPoint    = { label: string; value: number };
type TurfRevenue = { name: string; amount: number; color: string };

function getSafeDate(v: any): Date | null {
  if (!v) return null;
  if (typeof v?.toDate === "function") return v.toDate();
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function fmtAmount(n: number): string {
  if (n >= 100000) return `₹${(n / 100000).toFixed(2)}L`;
  if (n >= 1000)   return `₹${(n / 1000).toFixed(1)}K`;
  return `₹${n}`;
}

function fmtDate(v: any): string {
  const d = getSafeDate(v);
  if (!d) return "—";
  return d.toLocaleDateString("en-IN", { month: "short", day: "numeric" });
}

function fmtSlot(b: Booking): string {
  if (Array.isArray(b.selectedSlots) && b.selectedSlots.length > 0)
    return b.selectedSlots[0] + (b.selectedSlots.length > 1 ? ` +${b.selectedSlots.length - 1}` : "");
  return b.slotTime || "—";
}

function getAmount(b: Booking): number {
  return Number(b.totalAmount ?? b.paidAmount ?? b.price ?? 0);
}

const TURF_COLORS = ["#6366F1","#22C55E","#F59E0B","#EF4444","#06B6D4","#8B5CF6"];

const STATUS_META: Record<string, { bg: string; color: string; label: string }> = {
  confirmed: { bg: "#DCFCE7", color: "#15803D", label: "Confirmed" },
  pending:   { bg: "#FEF3C7", color: "#B45309", label: "Pending"   },
  completed: { bg: "#F3F4F6", color: "#4B5563", label: "Completed" },
  cancelled: { bg: "#FEE2E2", color: "#DC2626", label: "Cancelled" },
};

// ─── Line Chart ───────────────────────────────────────────────────────────────
function LineChart({ data }: { data: DayPoint[] }) {
  if (!data.length) return null;
  const W = SW - 64;
  const H = 150;
  const PL = 28, PR = 8, PT = 12, PB = 28;
  const iW = W - PL - PR;
  const iH = H - PT - PB;
  const maxV = Math.max(...data.map((d) => d.value), 1);

  const pts = data.map((d, i) => ({
    x: PL + (i / Math.max(data.length - 1, 1)) * iW,
    y: PT + (1 - d.value / maxV) * iH,
    label: d.label,
    value: d.value,
  }));

  const pathD = pts.reduce((acc, pt, i) => {
    if (i === 0) return `M ${pt.x} ${pt.y}`;
    const prev = pts[i - 1];
    const cx = (prev.x + pt.x) / 2;
    return `${acc} C ${cx} ${prev.y} ${cx} ${pt.y} ${pt.x} ${pt.y}`;
  }, "");

  const fillD = `${pathD} L ${pts[pts.length - 1].x} ${PT + iH} L ${pts[0].x} ${PT + iH} Z`;

  return (
    <Svg width={W} height={H}>
      <Defs>
        <LinearGradient id="lg" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0%" stopColor="#3B82F6" stopOpacity="0.22" />
          <Stop offset="100%" stopColor="#3B82F6" stopOpacity="0" />
        </LinearGradient>
      </Defs>
      {[0, Math.round(maxV / 2), maxV].map((val, i) => {
        const y = PT + (1 - val / maxV) * iH;
        return (
          <G key={i}>
            <Line x1={PL} y1={y} x2={W - PR} y2={y} stroke="#F3F4F6" strokeWidth="1" />
            <SvgText x={PL - 4} y={y + 3} fontSize="8" fill="#9CA3AF" textAnchor="end">{val}</SvgText>
          </G>
        );
      })}
      <Path d={fillD} fill="url(#lg)" />
      <Path d={pathD} stroke="#3B82F6" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      {pts.map((pt, i) => (
        <G key={i}>
          <Circle cx={pt.x} cy={pt.y} r="3.5" fill="#FFFFFF" stroke="#3B82F6" strokeWidth="2" />
          <SvgText x={pt.x} y={H - 6} fontSize="8" fill="#9CA3AF" textAnchor="middle">{pt.label}</SvgText>
        </G>
      ))}
    </Svg>
  );
}

// ─── Donut Chart ──────────────────────────────────────────────────────────────
function DonutChart({ data }: { data: TurfRevenue[] }) {
  const SIZE = 130;
  const CX = SIZE / 2, CY = SIZE / 2;
  const R = 50, IR = 30;
  const total = data.reduce((s, d) => s + d.amount, 0);
  if (!total) return null;

  let angle = -Math.PI / 2;
  const slices = data.map((d) => {
    const sweep = (d.amount / total) * 2 * Math.PI;
    const sa = angle;
    angle += sweep;
    return { ...d, sa, ea: angle };
  });

  const arc = (sa: number, ea: number, r: number, ir: number) => {
    const x1 = CX + r * Math.cos(sa), y1 = CY + r * Math.sin(sa);
    const x2 = CX + r * Math.cos(ea), y2 = CY + r * Math.sin(ea);
    const ix1 = CX + ir * Math.cos(ea), iy1 = CY + ir * Math.sin(ea);
    const ix2 = CX + ir * Math.cos(sa), iy2 = CY + ir * Math.sin(sa);
    const lg = ea - sa > Math.PI ? 1 : 0;
    return `M ${x1} ${y1} A ${r} ${r} 0 ${lg} 1 ${x2} ${y2} L ${ix1} ${iy1} A ${ir} ${ir} 0 ${lg} 0 ${ix2} ${iy2} Z`;
  };

  return (
    <Svg width={SIZE} height={SIZE}>
      {slices.map((sl, i) => <Path key={i} d={arc(sl.sa, sl.ea, R, IR)} fill={sl.color} />)}
      <Circle cx={CX} cy={CY} r={IR - 1} fill={CARD} />
    </Svg>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function AdminDashboard() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [adminName, setAdminName]   = useState("Admin");
  const [adminPhoto, setAdminPhoto] = useState<string | null>(null);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [turfCount, setTurfCount]       = useState(0);
  const [ownerCount, setOwnerCount]     = useState(0);
  const [bookingCount, setBookingCount] = useState(0);
  const [revenueTotal, setRevenueTotal] = useState(0);
  const [notifCount, setNotifCount]     = useState(0);
  const [chartData, setChartData]       = useState<DayPoint[]>([]);
  const [recentBookings, setRecentBookings] = useState<Booking[]>([]);
  const [turfRevenue, setTurfRevenue]   = useState<TurfRevenue[]>([]);
  const navigation = useNavigation();

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) { router.replace("/login"); return; }
      try {
        const snap = await getDoc(doc(db, "users", user.uid));
        if (!snap.exists() || snap.data()?.role !== "admin") { router.replace("/"); return; }
        setAdminName(snap.data()?.name || "Admin");
        setAdminPhoto(snap.data()?.photo || null);
      } catch { router.replace("/login"); }
    });
    return () => unsub();
  }, []);

  const fetchAll = useCallback(async (isRefresh = false) => {
    isRefresh ? setRefreshing(true) : setLoading(true);
    try {
      const [turfSnap, ownerSnap, bookingSnap] = await Promise.all([
        getDocs(collection(db, "turfs")),
        getDocs(query(collection(db, "users"), where("role", "==", "owner"))),
        getDocs(collection(db, "bookings")),
      ]);

      const bookings = bookingSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Booking));
      setTurfCount(turfSnap.size);
      setOwnerCount(ownerSnap.size);
      setBookingCount(bookings.length);

      let rev = 0;
      for (const b of bookings) if (b.status !== "cancelled") rev += getAmount(b);
      setRevenueTotal(rev);
      setNotifCount(bookings.filter((b) => b.status === "pending").length);

      // 7-day chart
      const days: DayPoint[] = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date(); d.setDate(d.getDate() - i);
        const label = d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
        const count = bookings.filter((b) => getSafeDate(b.date || b.dateString)?.toDateString() === d.toDateString()).length;
        days.push({ label, value: count });
      }
      setChartData(days);

      // Recent 5
      const sorted = [...bookings].sort((a, b) =>
        (getSafeDate(b.date || b.dateString)?.getTime() ?? 0) - (getSafeDate(a.date || a.dateString)?.getTime() ?? 0)
      );
      setRecentBookings(sorted.slice(0, 5));

      // Revenue by turf
      const tMap: Record<string, { name: string; amount: number }> = {};
      for (const b of bookings) {
        if (b.status === "cancelled") continue;
        const key = b.turfId || b.turfName || "Unknown";
        if (!tMap[key]) tMap[key] = { name: b.turfName || "Unknown", amount: 0 };
        tMap[key].amount += getAmount(b);
      }
      const arr = Object.values(tMap).sort((a, b) => b.amount - a.amount).slice(0, 6)
        .map((t, i) => ({ ...t, color: TURF_COLORS[i % TURF_COLORS.length] }));
      setTurfRevenue(arr);

    } catch { Alert.alert("Error", "Could not load dashboard."); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { fetchAll(); }, []);

  const h = new Date().getHours();
  const greeting = h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  const totalDonut = turfRevenue.reduce((s, t) => s + t.amount, 0);

  if (loading) return (
    <View style={s.loadWrap}>
      <StatusBar barStyle="light-content" backgroundColor={DARK} />
      <ActivityIndicator size="large" color="#3B82F6" />
      <Text style={s.loadText}>Loading dashboard...</Text>
    </View>
  );

  return (
    <View style={s.safe}>
      <StatusBar barStyle="light-content" backgroundColor={DARK} />

      {/* Header */}
       <View style={[s.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity style={s.menuBtn} onPress={() =>
  navigation.dispatch(DrawerActions.openDrawer())
}>
          <Ionicons name="menu" size={24} color="#FFFFFF" />
        </TouchableOpacity>
        <View style={s.headerCenter}>
          <Text style={s.headerTitle}>Admin Dashboard</Text>
          <Text style={s.headerSub}>{greeting}, {adminName} 👋</Text>
        </View>
        <View style={s.headerRight}>
          <TouchableOpacity style={s.bellWrap} onPress={() => router.push("/admin/adminnotification" as any)}>
            <Ionicons name="notifications-outline" size={22} color="#FFFFFF" />
            {notifCount > 0 && (
              <View style={s.badge}>
                <Text style={s.badgeText}>{notifCount > 9 ? "9+" : notifCount}</Text>
              </View>
            )}
          </TouchableOpacity>
          {adminPhoto ? (
           

            <Image source={{ uri: adminPhoto }} style={s.avatar} />
          ) : (
             <TouchableOpacity onPress={ () => router.push("/admin/settings")}>
            <View style={[s.avatar, s.avatarFallback]}>
              <Text style={s.avatarInitial}>{adminName[0]?.toUpperCase()}</Text>
            </View>
            </TouchableOpacity>
          )}
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={s.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => fetchAll(true)} tintColor="#3B82F6" />}
      >
        {/* Stat cards */}
        <View style={s.statsCard}>
          {([
            { icon: "business",   color: "#6366F1", bg: "#EEF2FF", label: "TURFS",    value: String(turfCount),        trend: "+12%" },
            { icon: "people",     color: "#22C55E", bg: "#DCFCE7", label: "OWNERS",   value: String(ownerCount),       trend: "+8%"  },
            { icon: "calendar",   color: "#F59E0B", bg: "#FEF3C7", label: "BOOKINGS", value: String(bookingCount),     trend: "+18%" },
            { icon: "logo-usd",   color: "#3B82F6", bg: "#DBEAFE", label: "REVENUE",  value: fmtAmount(revenueTotal),  trend: "+22%" },
          ] as const).map((st, i) => (
            <View key={i} style={[s.statItem, i < 3 && s.statBorder]}>
              <View style={[s.statIcon, { backgroundColor: st.bg }]}>
                <Ionicons name={st.icon as any} size={20} color={st.color} />
              </View>
              <Text style={s.statLabel}>{st.label}</Text>
              <Text style={s.statValue}>{st.value}</Text>
              <View style={s.trendRow}>
                <Ionicons name="arrow-up" size={9} color="#22C55E" />
                <Text style={s.trendText}>{st.trend}</Text>
              </View>
              <Text style={s.trendSub}>vs last week</Text>
            </View>
          ))}
        </View>

        {/* Quick Actions */}
        <View style={s.section}>
          <View style={s.sectionRow}>
            <Text style={s.sectionTitle}>Quick Actions</Text>
            <TouchableOpacity onPress={() => router.push("/admin/turfs" as any)}>
              <Text style={s.sectionLink}>View All</Text>
            </TouchableOpacity>
          </View>
          <View style={s.quickGrid}>
            {([
              { icon: "business-outline",   label: "Add Turf",       route: "/admin/add-turf", color: "#6366F1", bg: "#EEF2FF" },
              { icon: "grid-outline",       label: "Manage\nTurfs",  route: "/admin/turfs",    color: "#22C55E", bg: "#DCFCE7" },
          //    { icon: "person-add-outline", label: "Create\nOwner",  route: "/admin/owners",   color: "#F59E0B", bg: "#FEF3C7" },
              { icon: "people-outline",     label: "Manage\nOwners", route: "/admin/owners",   color: "#3B82F6", bg: "#DBEAFE" },
              { icon: "image-outline",      label: "Banners",        route: "/admin/settings", color: "#8B5CF6", bg: "#EDE9FE" },
                { icon: "apps-outline",      label: "user home control",        route: "/admin/user-home-control", color: "#000000", bg: "#d6d6d6" },
            ] as const).map((q, i) => (
              <TouchableOpacity key={i} style={s.quickItem} onPress={() => router.push(q.route as any)} activeOpacity={0.75}>
                <View style={[s.quickIcon, { backgroundColor: q.bg }]}>
                  <Ionicons name={q.icon as any} size={24} color={q.color} />
                </View>
                <Text style={s.quickLabel}>{q.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Bookings Chart */}
        <View style={s.section}>
          <View style={s.chartCard}>
            <View style={s.sectionRow}>
              <Text style={s.sectionTitle}>Bookings Overview</Text>
              <View style={s.weekPill}>
                <Text style={s.weekPillText}>This Week</Text>
                <Ionicons name="chevron-down" size={12} color="#6B7280" />
              </View>
            </View>
            <View style={{ marginTop: 8 }}>
              <LineChart data={chartData} />
            </View>
          </View>
        </View>

        {/* Recent Bookings */}
        <View style={s.section}>
          <View style={s.sectionRow}>
            <Text style={s.sectionTitle}>Recent Bookings</Text>
            <TouchableOpacity onPress={() => router.push("/admin/bookings" as any)}>
              <Text style={s.sectionLink}>View All</Text>
            </TouchableOpacity>
          </View>
          <View style={s.listCard}>
            {recentBookings.length === 0 ? (
              <Text style={s.emptyText}>No bookings yet.</Text>
            ) : recentBookings.map((b, i) => {
              const meta = STATUS_META[b.status || "pending"] || STATUS_META.pending;
              const cover = Array.isArray(b.images) ? b.images[0] : b.image;
              return (
                <TouchableOpacity
                  key={b.id}
                  style={[s.listRow, i < recentBookings.length - 1 && s.listRowBorder]}
                  onPress={() => router.push("/admin/bookings" as any)}
                  activeOpacity={0.8}
                >
                  {cover ? (
                    <Image source={{ uri: cover }} style={s.thumb} />
                  ) : (
                    <View style={[s.thumb, s.thumbFallback]}>
                      <Ionicons name="location" size={16} color="#9CA3AF" />
                    </View>
                  )}
                  <View style={s.listInfo}>
                    <Text style={s.listTitle} numberOfLines={1}>{b.turfName || "Unknown Turf"}</Text>
                    <Text style={s.listSub}>{fmtDate(b.date || b.dateString)}, {fmtSlot(b)}</Text>
                  </View>
                  <View style={s.listRight}>
                    <View style={[s.statusBadge, { backgroundColor: meta.bg }]}>
                      <Text style={[s.statusText, { color: meta.color }]}>{meta.label}</Text>
                    </View>
                    <Text style={s.listAmount}>{fmtAmount(getAmount(b))}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={15} color="#D1D5DB" style={{ marginLeft: 2 }} />
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Revenue Donut */}
        {turfRevenue.length > 0 && (
          <View style={s.section}>
            <View style={s.sectionRow}>
              <Text style={s.sectionTitle}>Revenue Overview</Text>
              <View style={s.weekPill}>
                <Text style={s.weekPillText}>This Week</Text>
                <Ionicons name="chevron-down" size={12} color="#6B7280" />
              </View>
            </View>
            <View style={s.donutCard}>
              <DonutChart data={turfRevenue} />
              <View style={s.donutLegend}>
                {turfRevenue.map((t, i) => {
                  const pct = totalDonut > 0 ? Math.round((t.amount / totalDonut) * 100) : 0;
                  return (
                    <View key={i} style={s.legendRow}>
                      <View style={[s.legendDot, { backgroundColor: t.color }]} />
                      <View style={{ flex: 1 }}>
                        <Text style={s.legendName} numberOfLines={1}>{t.name}</Text>
                        <Text style={s.legendAmt}>{fmtAmount(t.amount)} ({pct}%)</Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            </View>
          </View>
        )}

        <View style={{ height: 20 }} />
      </ScrollView>

      <AdminNavBar />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BG },
  loadWrap: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: DARK },
  loadText: { marginTop: 12, color: "#9CA3AF", fontSize: 15, fontWeight: "600" },
  scrollContent: { paddingBottom: 16 },

  header: {
    backgroundColor: DARK, flexDirection: "row", alignItems: "center",
    paddingHorizontal: 16, gap: 10,
    
    paddingBottom: 16,
  },
  menuBtn: { width: 36, height: 36, justifyContent: "center", alignItems: "center" },
  headerCenter: { flex: 1 },
  headerTitle: { color: "#FFFFFF", fontSize: 17, fontWeight: "800" },
  headerSub: { color: "#9CA3AF", fontSize: 12, fontWeight: "500", marginTop: 1 },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 10 },
  bellWrap: { width: 36, height: 36, justifyContent: "center", alignItems: "center" },
  badge: {
    position: "absolute", top: 2, right: 2,
    backgroundColor: "#EF4444", borderRadius: 8,
    minWidth: 16, height: 16, justifyContent: "center", alignItems: "center", paddingHorizontal: 3,
  },
  badgeText: { color: "#FFFFFF", fontSize: 9, fontWeight: "900" },
  avatar: { width: 36, height: 36, borderRadius: 18 },
  avatarFallback: { backgroundColor: "#6366F1", justifyContent: "center", alignItems: "center" },
  avatarInitial: { color: "#FFFFFF", fontWeight: "800", fontSize: 14 },

  statsCard: {
    backgroundColor: CARD, marginHorizontal: 16, marginTop: 16,
    borderRadius: 20, flexDirection: "row", paddingVertical: 18,
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 10, elevation: 3,
  },
  statItem: { flex: 1, alignItems: "center", paddingHorizontal: 2 },
  statBorder: { borderRightWidth: 1, borderRightColor: "#F3F4F6" },
  statIcon: { width: 42, height: 42, borderRadius: 21, justifyContent: "center", alignItems: "center", marginBottom: 7 },
  statLabel: { fontSize: 8, fontWeight: "700", color: "#9CA3AF", textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 3 },
  statValue: { fontSize: 17, fontWeight: "900", color: DARK2 },
  trendRow: { flexDirection: "row", alignItems: "center", gap: 2, marginTop: 4 },
  trendText: { fontSize: 10, fontWeight: "700", color: "#22C55E" },
  trendSub: { fontSize: 8, color: "#9CA3AF", fontWeight: "500", marginTop: 1 },

  section: { marginHorizontal: 16, marginTop: 20 },
  sectionRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  sectionTitle: { fontSize: 17, fontWeight: "800", color: DARK2 },
  sectionLink: { fontSize: 13, fontWeight: "700", color: "#3B82F6" },

  quickGrid: {
    backgroundColor: CARD, borderRadius: 20,
    flexDirection: "row", paddingVertical: 14, paddingHorizontal: 4,
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.04, shadowRadius: 8, elevation: 2,
  },
  quickItem: { width: "20%", alignItems: "center", paddingVertical: 6 },
  quickIcon: { width: 50, height: 50, borderRadius: 14, justifyContent: "center", alignItems: "center", marginBottom: 6 },
  quickLabel: { fontSize: 9, fontWeight: "600", color: DARK2, textAlign: "center", lineHeight: 12 },

  chartCard: {
    backgroundColor: CARD, borderRadius: 20, padding: 16,
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.04, shadowRadius: 8, elevation: 2,
  },
  weekPill: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: "#F3F4F6", paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 10, borderWidth: 1, borderColor: "#E5E7EB",
  },
  weekPillText: { fontSize: 11, color: "#6B7280", fontWeight: "600" },

  listCard: {
    backgroundColor: CARD, borderRadius: 20, overflow: "hidden",
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.04, shadowRadius: 8, elevation: 2,
  },
  listRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 11, gap: 10 },
  listRowBorder: { borderBottomWidth: 1, borderBottomColor: "#F9FAFB" },
  thumb: { width: 42, height: 42, borderRadius: 10, backgroundColor: "#E5E7EB" },
  thumbFallback: { justifyContent: "center", alignItems: "center" },
  listInfo: { flex: 1 },
  listTitle: { fontSize: 13, fontWeight: "700", color: DARK2 },
  listSub: { fontSize: 11, color: "#9CA3AF", fontWeight: "500", marginTop: 2 },
  listRight: { alignItems: "flex-end", gap: 3 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  statusText: { fontSize: 10, fontWeight: "800" },
  listAmount: { fontSize: 13, fontWeight: "800", color: DARK2 },
  emptyText: { padding: 24, textAlign: "center", color: "#9CA3AF", fontSize: 14 },

  donutCard: {
    backgroundColor: CARD, borderRadius: 20, padding: 16,
    flexDirection: "row", alignItems: "center", gap: 16,
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.04, shadowRadius: 8, elevation: 2,
  },
  donutLegend: { flex: 1, gap: 8 },
  legendRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  legendDot: { width: 9, height: 9, borderRadius: 5, flexShrink: 0 },
  legendName: { fontSize: 12, fontWeight: "700", color: DARK2 },
  legendAmt: { fontSize: 10, color: "#9CA3AF", fontWeight: "500" },
});
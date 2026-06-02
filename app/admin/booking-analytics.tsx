import {
  View, Text, StyleSheet, SafeAreaView, StatusBar,
  ScrollView, TouchableOpacity, ActivityIndicator,
  RefreshControl, Platform, Alert, Dimensions,
} from "react-native";
import { useEffect, useMemo, useState } from "react";
import { db } from "../../firebaseConfig";
import { collection, getDocs, query, where, orderBy, limit, Timestamp } from "firebase/firestore"
import { Ionicons } from "@expo/vector-icons";
import Svg, { Rect, Text as ST, G, Circle, Path, Defs, LinearGradient, Stop } from "react-native-svg";
import AdminNavBar from "./adminavabar";

const { width: SW } = Dimensions.get("window");
const DARK  = "#0A0F1E";
const ACCENT = "#0EA5A4";
const COLORS = ["#6366F1","#22C55E","#F59E0B","#EF4444","#06B6D4","#8B5CF6","#EC4899","#14B8A6","#F97316","#84CC16"];

type Booking = {
  id: string; userId?: string; userName?: string; userPhone?: string;
  userEmail?: string; userLocation?: string; turfName?: string; turfId?: string;
  ownerId?: string; ownerName?: string; date?: any; dateString?: string;
  totalAmount?: number; paidAmount?: number; price?: number;
  status?: string; selectedSlots?: string[]; slotTime?: string;
};

type TimeFrame = "7d"|"1m"|"3m"|"6m"|"all";

function getSafeDate(v: any): Date | null {
  if (!v) return null;
  if (typeof v?.toDate === "function") return v.toDate();
  const d = new Date(v); return isNaN(d.getTime()) ? null : d;
}
function getAmount(b: Booking) { return Number(b.totalAmount ?? b.paidAmount ?? b.price ?? 0); }
function fmt(n: number)        { return n >= 100000 ? `₹${(n/100000).toFixed(1)}L` : n >= 1000 ? `₹${(n/1000).toFixed(1)}K` : `₹${n}`; }

const TF_OPTIONS: {key: TimeFrame; label: string}[] = [
  {key:"7d",label:"7 Days"},{key:"1m",label:"1 Month"},
  {key:"3m",label:"3 Months"},{key:"6m",label:"6 Months"},{key:"all",label:"6M All"},
];

// ─── Horizontal Bar Chart ─────────────────────────────────────────────────────
function BarChart({ rows, color, valuePrefix = "" }: { rows: {label: string; value: number}[]; color: string; valuePrefix?: string }) {
  if (!rows.length) return null;
  const max = Math.max(...rows.map((r) => r.value), 1);
  const BAR_H = 28;
  const GAP   = 10;
  const H     = rows.length * (BAR_H + GAP);
  const W     = SW - 80;
  const LABEL_W = 120;
  const BAR_W   = W - LABEL_W - 60;

  return (
    <Svg width={W} height={H}>
      {rows.map((row, i) => {
        const y    = i * (BAR_H + GAP);
        const barW = Math.max((row.value / max) * BAR_W, 4);
        return (
          <G key={i}>
            <ST x={0} y={y + BAR_H / 2 + 5} fontSize="11" fill="#374151" fontWeight="600"
              numberOfLines={1}>{row.label.length > 14 ? row.label.slice(0, 13) + "…" : row.label}</ST>
            <Rect x={LABEL_W} y={y + 4} width={barW} height={BAR_H - 8} rx="6" fill={color} opacity="0.85"/>
            <ST x={LABEL_W + barW + 6} y={y + BAR_H / 2 + 4} fontSize="11" fill="#374151" fontWeight="700">
              {valuePrefix}{row.value}
            </ST>
          </G>
        );
      })}
    </Svg>
  );
}

// ─── Donut Chart ──────────────────────────────────────────────────────────────
function DonutChart({ data }: { data: {name: string; amount: number; color: string}[] }) {
  const total = (data ?? []).reduce((s, d) => s + d.amount, 0);
  if (!total || !data?.length) return null;
  const SIZE = 120; const CX = SIZE/2; const CY = SIZE/2; const R = 46; const IR = 28;
  let angle = -Math.PI / 2;
  const slices = data.map((d) => {
    const sweep = (d.amount / total) * 2 * Math.PI;
    const sa = angle; angle += sweep;
    return {...d, sa, ea: angle};
  });
  const arc = (sa: number, ea: number) => {
    const x1=CX+R*Math.cos(sa),y1=CY+R*Math.sin(sa);
    const x2=CX+R*Math.cos(ea),y2=CY+R*Math.sin(ea);
    const ix1=CX+IR*Math.cos(ea),iy1=CY+IR*Math.sin(ea);
    const ix2=CX+IR*Math.cos(sa),iy2=CY+IR*Math.sin(sa);
    const lg = ea-sa>Math.PI?1:0;
    return `M ${x1} ${y1} A ${R} ${R} 0 ${lg} 1 ${x2} ${y2} L ${ix1} ${iy1} A ${IR} ${IR} 0 ${lg} 0 ${ix2} ${iy2} Z`;
  };
  return (
    <Svg width={SIZE} height={SIZE}>
      {slices.map((sl,i)=><Path key={i} d={arc(sl.sa,sl.ea)} fill={sl.color}/>)}
      <Circle cx={CX} cy={CY} r={IR-1} fill="#FFFFFF"/>
    </Svg>
  );
}

// ─── Sparkline (booking trend) ────────────────────────────────────────────────
function Sparkline({ data, color }: { data: number[]; color: string }) {
  if (!data?.length) return null;
  const W = SW - 64; const H = 60;
  const max = Math.max(...data, 1);
  const pts = data.map((v, i) => ({
    x: (i / Math.max(data.length - 1, 1)) * W,
    y: H - 8 - ((v / max) * (H - 16)),
  }));
  const pathD = pts.reduce((acc, pt, i) => {
    if (i === 0) return `M ${pt.x} ${pt.y}`;
    const prev = pts[i-1]; const cx = (prev.x + pt.x) / 2;
    return `${acc} C ${cx} ${prev.y} ${cx} ${pt.y} ${pt.x} ${pt.y}`;
  }, "");
  const fillD = `${pathD} L ${pts[pts.length-1].x} ${H} L 0 ${H} Z`;
  return (
    <Svg width={W} height={H}>
      <Defs>
        <LinearGradient id="sg" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0%" stopColor={color} stopOpacity="0.25"/>
          <Stop offset="100%" stopColor={color} stopOpacity="0"/>
        </LinearGradient>
      </Defs>
      <Path d={fillD} fill="url(#sg)"/>
      <Path d={pathD} stroke={color} strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
    </Svg>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function BookingAnalysis() {
  const [bookings, setBookings]     = useState<Booking[]>([]);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [timeFrame, setTimeFrame]   = useState<TimeFrame>("1m");

  useEffect(() => { fetchBookings(); }, []);

  const fetchBookings = async (isRefresh = false) => {
    isRefresh ? setRefreshing(true) : setLoading(true);
    try {
      // REPLACE with — limits to last 6 months + max 1000 docs
const sixMonthsAgo = new Date();
sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

const q = query(
  collection(db, "bookings"),
  where("date", ">=", Timestamp.fromDate(sixMonthsAgo)),
  orderBy("date", "desc"),
  limit(1000)
);
const snap = await getDocs(q);
setBookings((snap.docs ?? []).map((d) => ({id: d.id, ...d.data()} as Booking)));
    } catch (e) {
      console.error("BookingAnalysis fetch error:", e);
      setBookings([]); // ensure state is clean so empty states render correctly
      Alert.alert("Error", "Could not load analytics. Pull down to retry.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  // ── Apply time frame filter ──────────────────────────────────────────────────
  const filtered = useMemo(() => {
    if (timeFrame === "all") return bookings;
    const c = new Date();
    if (timeFrame === "7d") c.setDate(c.getDate() - 7);
    if (timeFrame === "1m") c.setMonth(c.getMonth() - 1);
    if (timeFrame === "3m") c.setMonth(c.getMonth() - 3);
    if (timeFrame === "6m") c.setMonth(c.getMonth() - 6);
    return bookings.filter((b) => { const d = getSafeDate(b.date||b.dateString); return d && d >= c; });
  }, [bookings, timeFrame]);

  // ── Analytics computations ───────────────────────────────────────────────────
  const analytics = useMemo(() => {
    const active   = filtered.filter((b) => b.status !== "cancelled");
    const cancelled = filtered.filter((b) => b.status === "cancelled");

    // Total revenue
    const totalRevenue = active.reduce((s, b) => s + getAmount(b), 0);
    const cancelledRevenue = cancelled.reduce((s, b) => s + getAmount(b), 0);

    // ── Top turfs by booking count ──
    const turfCount: Record<string, {name: string; count: number; revenue: number}> = {};
    for (const b of filtered) {
      const key = b.turfId || b.turfName || "Unknown";
      if (!turfCount[key]) turfCount[key] = {name: b.turfName||"Unknown", count: 0, revenue: 0};
      turfCount[key].count++;
      if (b.status !== "cancelled") turfCount[key].revenue += getAmount(b);
    }
    const topTurfsByCount = Object.values(turfCount).sort((a,b)=>b.count-a.count).slice(0,8);
    const topTurfsByRevenue = Object.values(turfCount).sort((a,b)=>b.revenue-a.revenue).slice(0,6)
      .map((t,i)=>({...t, color: COLORS[i%COLORS.length]}));

    // ── Top users by booking count ──
    const userCount: Record<string, {name: string; phone: string; count: number; revenue: number}> = {};
    for (const b of filtered) {
      const key = b.userId || b.userPhone || b.userName || "Unknown";
      if (!userCount[key]) userCount[key] = {name: b.userName||"Unknown", phone: b.userPhone||"—", count: 0, revenue: 0};
      userCount[key].count++;
      if (b.status !== "cancelled") userCount[key].revenue += getAmount(b);
    }
    const topUsers = Object.values(userCount).sort((a,b)=>b.count-a.count).slice(0,8);

    // ── Location analysis ──
    const locationCount: Record<string, number> = {};
    for (const b of filtered) {
      const loc = b.userLocation?.trim();
      if (loc && loc !== "Not available" && loc !== "—") {
        locationCount[loc] = (locationCount[loc] || 0) + 1;
      }
    }
    const topLocations = Object.entries(locationCount)
      .map(([loc, count]) => ({label: loc, value: count}))
      .sort((a,b)=>b.value-a.value).slice(0,8);

    // ── 7-day booking trend ──
    const trend7: number[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      trend7.push(filtered.filter((b) => getSafeDate(b.date||b.dateString)?.toDateString()===d.toDateString()).length);
    }

    // ── Day of week popularity ──
    const dowCount = Array(7).fill(0);
    for (const b of filtered) {
      const d = getSafeDate(b.date||b.dateString);
      if (d) dowCount[d.getDay()]++;
    }
    const DOW = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
    const dowData = DOW.map((label,i) => ({label, value: dowCount[i]})).sort((a,b)=>b.value-a.value);

    // ── Peak hour analysis ──
    const hourCount: Record<string,number> = {};
    for (const b of filtered) {
      const slots = Array.isArray(b.selectedSlots) && b.selectedSlots.length > 0
        ? b.selectedSlots
        : Array.isArray((b as any).slots) && (b as any).slots.length > 0
        ? (b as any).slots
        : b.slotTime ? [b.slotTime] : [];
      for (const sl of slots) {
        const hr = sl.split(":")[0] + ":00";
        if (hr && hr !== ":00") hourCount[hr] = (hourCount[hr]||0) + 1;
      }
    }
    const peakHours = Object.entries(hourCount)
      .map(([label, value]) => ({label, value}))
      .sort((a,b)=>b.value-a.value).slice(0,6);

    // ── Owner revenue breakdown ──
    const ownerRevenue: Record<string,{name:string;revenue:number;count:number}> = {};
    for (const b of active) {
      const key = b.ownerId || b.ownerName || "Unknown";
      if (!ownerRevenue[key]) ownerRevenue[key] = {name:b.ownerName||"Unknown",revenue:0,count:0};
      ownerRevenue[key].revenue += getAmount(b);
      ownerRevenue[key].count++;
    }
    const topOwners = Object.values(ownerRevenue).sort((a,b)=>b.revenue-a.revenue).slice(0,6)
      .map((o,i)=>({...o,color:COLORS[i%COLORS.length]}));

    // ── Cancellation rate ──
    const cancelRate = filtered.length > 0 ? Math.round((cancelled.length / filtered.length) * 100) : 0;

    // ── Repeat users ──
    const repeatUsers = Object.values(userCount).filter((u) => u.count > 1).length;

    return {
      totalRevenue, cancelledRevenue, cancelRate, repeatUsers,
      topTurfsByCount, topTurfsByRevenue, topUsers, topLocations,
      trend7, dowData, peakHours, topOwners,
      totalBookings: filtered.length,
      activeBookings: active.length,
    };
  }, [filtered]);

  if (loading) return (
    <SafeAreaView style={s.loadWrap}>
      <StatusBar barStyle="light-content" backgroundColor={DARK}/>
      <ActivityIndicator size="large" color={ACCENT}/>
      <Text style={s.loadText}>Loading analytics...</Text>
    </SafeAreaView>
  );

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="light-content" backgroundColor={DARK}/>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={s.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={()=>fetchBookings(true)} tintColor={ACCENT}/>}
      >
        {/* Hero */}
        <View style={s.hero}>
          <View style={s.glow1}/><View style={s.glow2}/>
          <Text style={s.heroTag}>Admin · Intelligence</Text>
          <Text style={s.heroTitle}>Booking Analytics</Text>
          <Text style={s.heroSub}>Which turfs people love, who books most, and where they come from.</Text>

          {/* Key metrics */}
          <View style={s.metricsRow}>
            {[
              {label:"Total Bookings",  value:String(analytics.totalBookings),  color:"#60A5FA"},
              {label:"Total Revenue",   value:fmt(analytics.totalRevenue),       color:"#34D399"},
              {label:"Cancel Rate",     value:`${analytics.cancelRate}%`,        color:"#F87171"},
              {label:"Repeat Users",    value:String(analytics.repeatUsers),     color:"#FBBF24"},
            ].map((m)=>(
              <View key={m.label} style={s.metricCard}>
                <Text style={[s.metricValue,{color:m.color}]}>{m.value}</Text>
                <Text style={s.metricLabel}>{m.label}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Time frame selector */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.tfRow}>
          {TF_OPTIONS.map((tf)=>{
            const active = timeFrame===tf.key;
            return (
              <TouchableOpacity key={tf.key} style={[s.tfChip,active&&s.tfActive]} onPress={()=>setTimeFrame(tf.key)}>
                <Text style={[s.tfText,active&&s.tfTextActive]}>{tf.label}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* ── Booking Trend ── */}
        <View style={s.card}>
          <View style={s.cardHeader}>
            <Ionicons name="trending-up" size={18} color="#3B82F6"/>
            <Text style={s.cardTitle}>Booking Trend (Last 7 Days)</Text>
          </View>
          <Text style={s.cardSub}>Daily booking volume over the past week.</Text>
          {analytics.trend7.every((v) => v === 0) ? (
            <View style={s.noDataBox}>
              <Ionicons name="trending-up-outline" size={28} color="#D1D5DB"/>
              <Text style={s.noDataTitle}>No bookings in the last 7 days</Text>
              <Text style={s.noDataSub}>The trend chart will appear once bookings are made.</Text>
            </View>
          ) : (
            <>
              <View style={{marginTop:12}}>
                <Sparkline data={analytics.trend7} color="#3B82F6"/>
              </View>
              <View style={s.trendLabels}>
                {["6d","5d","4d","3d","2d","1d","Today"].map((l,i)=>(
                  <Text key={i} style={s.trendLabel}>{l}</Text>
                ))}
              </View>
            </>
          )}
        </View>

        {/* ── Most Booked Turfs ── */}
        <View style={s.card}>
          <View style={s.cardHeader}>
            <Ionicons name="location" size={18} color="#6366F1"/>
            <Text style={s.cardTitle}>Most Booked Turfs</Text>
          </View>
          <Text style={s.cardSub}>Turfs ranked by number of bookings received.</Text>
          {analytics.topTurfsByCount.length === 0 ? (
            <View style={s.noDataBox}>
              <Ionicons name="location-outline" size={28} color="#D1D5DB"/>
              <Text style={s.noDataTitle}>No bookings yet</Text>
              <Text style={s.noDataSub}>Turf rankings appear once the first booking is made.</Text>
            </View>
          ) : (
            <View style={{marginTop:14}}>
              <BarChart rows={analytics.topTurfsByCount.map((t)=>({label:t.name,value:t.count}))} color="#6366F1"/>
            </View>
          )}
        </View>

        {/* ── Turf Revenue Breakdown ── */}
        <View style={s.card}>
          <View style={s.cardHeader}>
            <Ionicons name="pie-chart" size={18} color="#22C55E"/>
            <Text style={s.cardTitle}>Revenue by Turf</Text>
          </View>
          <Text style={s.cardSub}>Which turfs generate the most revenue for the platform.</Text>
          {analytics.topTurfsByRevenue.length === 0 ? (
            <View style={s.noDataBox}>
              <Ionicons name="pie-chart-outline" size={28} color="#D1D5DB"/>
              <Text style={s.noDataTitle}>No revenue yet</Text>
              <Text style={s.noDataSub}>Revenue breakdown appears once bookings are completed.</Text>
            </View>
          ) : (
            <View style={s.donutRow}>
              <DonutChart data={analytics.topTurfsByRevenue}/>
              <View style={s.legend}>
                {analytics.topTurfsByRevenue.map((t,i)=>{
                  const pct = analytics.totalRevenue>0?Math.round((t.revenue/analytics.totalRevenue)*100):0;
                  return (
                    <View key={i} style={s.legendRow}>
                      <View style={[s.legendDot,{backgroundColor:t.color}]}/>
                      <View style={{flex:1}}>
                        <Text style={s.legendName} numberOfLines={1}>{t.name}</Text>
                        <Text style={s.legendVal}>{fmt(t.revenue)} · {pct}%</Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            </View>
          )}
        </View>

        {/* ── Top Customers ── */}
        <View style={s.card}>
          <View style={s.cardHeader}>
            <Ionicons name="people" size={18} color="#F59E0B"/>
            <Text style={s.cardTitle}>Top Customers</Text>
          </View>
          <Text style={s.cardSub}>Users who book the most — your most loyal customers.</Text>
          {analytics.topUsers.map((user, i) => (
            <View key={i} style={s.userRow}>
              <View style={[s.userRank,{backgroundColor: i===0?"#FEF3C7":i===1?"#F3F4F6":i===2?"#FEE2E2":"#F9FAFB"}]}>
                <Text style={s.userRankText}>#{i+1}</Text>
              </View>
              <View style={{flex:1,marginLeft:10}}>
                <Text style={s.userName}>{user.name}</Text>
                <Text style={s.userPhone}>{user.phone}</Text>
              </View>
              <View style={{alignItems:"flex-end"}}>
                <Text style={s.userBookings}>{user.count} booking{user.count!==1?"s":""}</Text>
                <Text style={s.userRevenue}>{fmt(user.revenue)}</Text>
              </View>
            </View>
          ))}
          {analytics.topUsers.length === 0 && <Text style={s.noData}>No data available.</Text>}
        </View>

        {/* ── Location Analysis ── */}
        <View style={s.card}>
          <View style={s.cardHeader}>
            <Ionicons name="map" size={18} color="#EC4899"/>
            <Text style={s.cardTitle}>Where Users Come From</Text>
          </View>
          <Text style={s.cardSub}>
            Locations with the most bookings — helps you know where to market.
            {"\n"}Note: based on user-entered location at signup.
          </Text>
          {analytics.topLocations.length === 0 ? (
            <View style={s.noDataBox}>
              <Ionicons name="location-outline" size={28} color="#D1D5DB"/>
              <Text style={s.noDataTitle}>No location data yet</Text>
              <Text style={s.noDataSub}>Location data appears when users add their location in their profile.</Text>
            </View>
          ) : (
            <View style={{marginTop:14}}>
              <BarChart rows={analytics.topLocations} color="#EC4899"/>
            </View>
          )}
        </View>

        {/* ── Peak Day of Week ── */}
        <View style={s.card}>
          <View style={s.cardHeader}>
            <Ionicons name="calendar" size={18} color="#06B6D4"/>
            <Text style={s.cardTitle}>Peak Day of Week</Text>
          </View>
          <Text style={s.cardSub}>Which days users prefer to book turfs.</Text>
          {analytics.dowData.every((d) => d.value === 0) ? (
            <View style={s.noDataBox}>
              <Ionicons name="calendar-outline" size={28} color="#D1D5DB"/>
              <Text style={s.noDataTitle}>No bookings yet</Text>
              <Text style={s.noDataSub}>Day-of-week trends appear once bookings are made.</Text>
            </View>
          ) : (
            <View style={{marginTop:14}}>
              <BarChart rows={analytics.dowData.map((d)=>({label:d.label,value:d.value}))} color="#06B6D4"/>
            </View>
          )}
        </View>

        {/* ── Peak Hours ── */}
        {analytics.peakHours.length > 0 && (
          <View style={s.card}>
            <View style={s.cardHeader}>
              <Ionicons name="time" size={18} color="#8B5CF6"/>
              <Text style={s.cardTitle}>Peak Booking Hours</Text>
            </View>
            <Text style={s.cardSub}>Most popular time slots across all turfs.</Text>
            <View style={{marginTop:14}}>
              <BarChart rows={analytics.peakHours} color="#8B5CF6"/>
            </View>
          </View>
        )}

        {/* ── Owner Revenue ── */}
        <View style={s.card}>
          <View style={s.cardHeader}>
            <Ionicons name="business" size={18} color="#14B8A6"/>
            <Text style={s.cardTitle}>Revenue by Owner</Text>
          </View>
          <Text style={s.cardSub}>How much each owner's turfs have earned on the platform.</Text>
          {analytics.topOwners.length === 0 ? (
            <View style={s.noDataBox}>
              <Ionicons name="business-outline" size={28} color="#D1D5DB"/>
              <Text style={s.noDataTitle}>No revenue data yet</Text>
              <Text style={s.noDataSub}>Owner earnings appear once bookings are completed.</Text>
            </View>
          ) : (
            <View style={s.donutRow}>
              <DonutChart data={analytics.topOwners}/>
              <View style={s.legend}>
                {analytics.topOwners.map((o,i)=>{
                  const pct = analytics.totalRevenue>0?Math.round((o.revenue/analytics.totalRevenue)*100):0;
                  return (
                    <View key={i} style={s.legendRow}>
                      <View style={[s.legendDot,{backgroundColor:o.color}]}/>
                      <View style={{flex:1}}>
                        <Text style={s.legendName} numberOfLines={1}>{o.name}</Text>
                        <Text style={s.legendVal}>{fmt(o.revenue)} · {pct}%</Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            </View>
          )}
        </View>

        {/* ── Summary insight box ── */}
        <View style={s.insightBox}>
          <Ionicons name="bulb-outline" size={20} color="#D97706"/>
          <View style={{flex:1,marginLeft:10}}>
            <Text style={s.insightTitle}>Quick Insight</Text>
            <Text style={s.insightText}>
              {analytics.topTurfsByCount[0]
                ? `"${analytics.topTurfsByCount[0].name}" is your most booked turf with ${analytics.topTurfsByCount[0].count} bookings. `
                : ""}
              {analytics.topUsers[0]
                ? `${analytics.topUsers[0].name} is your most loyal customer with ${analytics.topUsers[0].count} bookings.`
                : ""}
              {analytics.cancelRate > 20
                ? ` ⚠️ Cancellation rate is ${analytics.cancelRate}% — consider a stricter advance payment policy.`
                : ""}
            </Text>
          </View>
        </View>

        <View style={{height:20}}/>
      </ScrollView>
      <AdminNavBar/>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:{flex:1,backgroundColor:"#F0F4F8"}, loadWrap:{flex:1,justifyContent:"center",alignItems:"center",backgroundColor:DARK},
  loadText:{marginTop:12,color:"#9CA3AF",fontSize:15,fontWeight:"600"}, scroll:{paddingBottom:16},
  hero:{backgroundColor:DARK,paddingHorizontal:20,paddingTop:Platform.OS==="android"?(StatusBar.currentHeight||0)+14:18,paddingBottom:24,overflow:"hidden"},
  glow1:{position:"absolute",top:-40,right:-40,width:200,height:200,borderRadius:100,backgroundColor:"rgba(14,165,164,0.13)"},
  glow2:{position:"absolute",bottom:-60,left:-40,width:180,height:180,borderRadius:90,backgroundColor:"rgba(124,58,237,0.10)"},
  heroTag:{color:"#C4B5FD",fontSize:11,fontWeight:"800",letterSpacing:1.5,textTransform:"uppercase"},
  heroTitle:{color:"#FFFFFF",fontSize:28,fontWeight:"900",marginTop:4}, heroSub:{color:"#9CA3AF",fontSize:13,lineHeight:20,marginTop:6},
  metricsRow:{flexDirection:"row",gap:8,marginTop:16,flexWrap:"wrap"},
  metricCard:{flex:1,minWidth:"45%",backgroundColor:"rgba(255,255,255,0.07)",borderRadius:14,paddingVertical:14,paddingHorizontal:12,borderWidth:1,borderColor:"rgba(255,255,255,0.08)"},
  metricValue:{fontSize:20,fontWeight:"900"}, metricLabel:{color:"#9CA3AF",fontSize:10,fontWeight:"700",marginTop:3},
  tfRow:{paddingHorizontal:16,paddingTop:16,paddingBottom:4,gap:8},
  tfChip:{paddingHorizontal:14,paddingVertical:7,borderRadius:999,backgroundColor:"#FFFFFF",borderWidth:1,borderColor:"#E5E7EB"},
  tfActive:{backgroundColor:DARK,borderColor:DARK}, tfText:{fontSize:12,fontWeight:"700",color:"#374151"}, tfTextActive:{color:"#FFFFFF"},
  card:{backgroundColor:"#FFFFFF",marginHorizontal:16,marginTop:16,borderRadius:20,padding:16,borderWidth:1,borderColor:"#E5E7EB",shadowColor:"#000",shadowOffset:{width:0,height:2},shadowOpacity:0.05,shadowRadius:8,elevation:2},
  cardHeader:{flexDirection:"row",alignItems:"center",gap:8,marginBottom:4},
  cardTitle:{fontSize:16,fontWeight:"800",color:"#111827"},
  cardSub:{fontSize:12,color:"#9CA3AF",fontWeight:"500",lineHeight:18},
  trendLabels:{flexDirection:"row",justifyContent:"space-between",paddingHorizontal:4,marginTop:6},
  trendLabel:{fontSize:9,color:"#9CA3AF",fontWeight:"600"},
  donutRow:{flexDirection:"row",alignItems:"center",gap:16,marginTop:14},
  legend:{flex:1,gap:8},
  legendRow:{flexDirection:"row",alignItems:"center",gap:8},
  legendDot:{width:9,height:9,borderRadius:5,flexShrink:0},
  legendName:{fontSize:11,fontWeight:"700",color:"#111827"},
  legendVal:{fontSize:10,color:"#9CA3AF",fontWeight:"500"},
  userRow:{flexDirection:"row",alignItems:"center",paddingVertical:10,borderBottomWidth:1,borderBottomColor:"#F9FAFB"},
  userRank:{width:32,height:32,borderRadius:10,justifyContent:"center",alignItems:"center"},
  userRankText:{fontSize:11,fontWeight:"800",color:"#374151"},
  userName:{fontSize:14,fontWeight:"700",color:"#111827"}, userPhone:{fontSize:11,color:"#9CA3AF",marginTop:1},
  userBookings:{fontSize:13,fontWeight:"800",color:"#111827"}, userRevenue:{fontSize:11,color:"#6B7280",marginTop:1},
  noData:{color:"#9CA3AF",fontSize:13,textAlign:"center",paddingVertical:16},
  noDataBox:{alignItems:"center",paddingVertical:24,gap:8},
  noDataTitle:{fontSize:15,fontWeight:"700",color:"#374151"}, noDataSub:{fontSize:12,color:"#9CA3AF",textAlign:"center",lineHeight:18},
  insightBox:{marginHorizontal:16,marginTop:16,backgroundColor:"#FFFBEB",borderRadius:16,padding:14,flexDirection:"row",alignItems:"flex-start",borderWidth:1,borderColor:"#FDE68A"},
  insightTitle:{fontSize:13,fontWeight:"800",color:"#B45309"}, insightText:{fontSize:12,color:"#92400E",lineHeight:18,marginTop:4},
});
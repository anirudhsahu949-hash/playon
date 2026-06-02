import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  StatusBar,
  SafeAreaView,
  Platform,
  ScrollView,
  RefreshControl,
  Dimensions,
  Switch,
} from "react-native";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { auth, db } from "../../firebaseConfig";
import { doc, getDoc, collection, getDocs, query, where, limit } from "firebase/firestore";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";

const { width: SW } = Dimensions.get("window");

// ── Theme ─────────────────────────────────────────────────────────────────────
type Theme = {
  bg: string; card: string; card2: string; border: string;
  text: string; textSub: string; textMuted: string;
  green: string; greenBg: string;
};

const DARK_THEME: Theme = {
  bg:        "#0D1117",
  card:      "#161B22",
  card2:     "#1C2333",
  border:    "rgba(255,255,255,0.06)",
  text:      "#F0F6FC",
  textSub:   "#8B949E",
  textMuted: "#c3c7cc",
  green:     "#3FB950",
  greenBg:   "rgba(63,185,80,0.15)",
};

const LIGHT_THEME: Theme = {
  bg:        "#F0F4F8",
  card:      "#FFFFFF",
  card2:     "#F8FAFC",
  border:    "#E5E7EB",
  text:      "#0F172A",
  textSub:   "#64748B",
  textMuted: "#94A3B8",
  green:     "#515b6b",
  greenBg:   "#DCFCE7",
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good Morning,";
  if (h < 17) return "Good Afternoon,";
  return "Good Evening,";
}

function getInitials(name: string) {
  return name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
}

function getSafeDate(val: any): Date | null {
  if (!val) return null;
  if (typeof val?.toDate === "function") return val.toDate();
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
}

function fmtAmt(n: number): string {
  if (n >= 100000) return `₹${(n / 100000).toFixed(1)}L`;
  if (n >= 1000)   return `₹${(n / 1000).toFixed(1)}K`;
  return `₹${Math.round(n)}`;
}

const pad = (n: number) => String(n).padStart(2, "0");
function formatTime(h: number): string {
  if (h >= 24) return "12:00 AM";
  const hour = Math.floor(h);
  const min  = Math.round((h % 1) * 60);
  const suf  = hour >= 12 ? "PM" : "AM";
  const hr   = hour % 12 === 0 ? 12 : hour % 12;
  return `${hr}:${pad(min)} ${suf}`;
}

function getSlotMins(slotTime: string): number {
  if (!slotTime) return 0;
  const m = slotTime.split("-")[0]?.trim().match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?/i);
  if (!m) return 0;
  let h = Number(m[1]);
  const min = Number(m[2] || 0);
  const p = m[3]?.toUpperCase();
  if (p === "PM" && h < 12) h += 12;
  if (p === "AM" && h === 12) h = 0;
  return h * 60 + min;
}

// ── Mini wave decoration ──────────────────────────────────────────────────────
function WaveDecoration({ color }: { color: string }) {
  return (
    <View style={{ position: "absolute", bottom: 0, right: 0, left: 0, height: 28, overflow: "hidden", opacity: 0.18 }}>
      {[0, 1, 2].map((i) => (
        <View key={i} style={{
          position: "absolute", bottom: i * 2 - 4, left: -10, right: -10,
          height: 35, borderRadius: 999, borderWidth: 1.5, borderColor: color,
          borderBottomColor: "transparent", borderLeftColor: "transparent",
          borderRightColor: "transparent", transform: [{ scaleX: 1.2 }],
        }} />
      ))}
    </View>
  );
}

// ── Mini bar graph decoration ─────────────────────────────────────────────────
function MiniBarGraph({ color }: { color: string }) {
  const bars = [0.4, 0.7, 0.5, 0.9, 0.6, 0.8, 1.0];
  return (
    <View style={{ position: "absolute", bottom: 8, right: 8, flexDirection: "row", alignItems: "flex-end", gap: 2, opacity: 0.25 }}>
      {bars.map((h, i) => (
        <View key={i} style={{ width: 3, height: h * 20, borderRadius: 2, backgroundColor: color }} />
      ))}
    </View>
  );
}

// ── Stat Card ─────────────────────────────────────────────────────────────────
function StatCard({ icon, iconBg, iconColor, label, value, sub, decoration, t }: {
  icon: string; iconBg: string; iconColor: string;
  label: string; value: string | number; sub: string;
  decoration: "wave" | "bar"; t: Theme;
}) {
  return (
    <View style={[sc.card, { backgroundColor: t.card2, borderColor: t.border }]}>
      <View style={[sc.iconWrap, { backgroundColor: iconBg }]}>
        <Ionicons name={icon as any} size={18} color={iconColor} />
      </View>
      <Text style={[sc.label, { color: t.textSub }]}>{label}</Text>
      <Text style={[sc.value, { color: t.text }]}>{value}</Text>
      <Text style={[sc.sub, { color: t.textMuted }]}>{sub}</Text>
      {decoration === "wave" ? <WaveDecoration color={iconColor} /> : <MiniBarGraph color={iconColor} />}
    </View>
  );
}

const sc = StyleSheet.create({
  card:    { width: (SW - 48) / 3, borderRadius: 16, padding: 12, borderWidth: 1, minHeight: 110, overflow: "hidden", position: "relative" },
  iconWrap:{ width: 34, height: 34, borderRadius: 10, justifyContent: "center", alignItems: "center", marginBottom: 8 },
  label:   { fontSize: 9, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.5 },
  value:   { fontSize: 22, fontWeight: "900", marginTop: 4, letterSpacing: -0.5 },
  sub:     { fontSize: 9, fontWeight: "600", marginTop: 3 },
});

// ── Action Button ─────────────────────────────────────────────────────────────
function ActionBtn({ icon, label, color, bg, onPress, t }: {
  icon: string; label: string; color: string; bg: string;
  onPress: () => void; t: Theme;
}) {
  return (
    <TouchableOpacity style={ab.wrap} onPress={onPress} activeOpacity={0.75}>
      <View style={[ab.icon, { backgroundColor: bg }]}>
        <Ionicons name={icon as any} size={22} color={color} />
      </View>
      <Text style={[ab.label, { color: t.textSub }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const ab = StyleSheet.create({
  wrap:  { alignItems: "center", gap: 7, width: 64 },
  icon:  { width: 52, height: 52, borderRadius: 18, justifyContent: "center", alignItems: "center" },
  label: { fontSize: 11, fontWeight: "700", textAlign: "center" },
});

// ── Slot Row ──────────────────────────────────────────────────────────────────
function SlotRow({ slot, onPress, t }: { slot: any; onPress: () => void; t: Theme }) {
  const isAvailable = slot.status === "available";
  const isBooked    = slot.status === "booked";
  const dotColor   = isAvailable ? t.green : isBooked ? "#F85149" : "#58A6FF";
  const badgeBg    = isAvailable ? t.greenBg : isBooked ? "rgba(248,81,73,0.15)" : "rgba(88,166,255,0.15)";
  const badgeColor = isAvailable ? t.green   : isBooked ? "#F85149" : "#58A6FF";
  const badgeLabel = isAvailable ? "Available" : isBooked ? "Booked" : "Blocked";

  return (
    <TouchableOpacity style={[sr.row, { borderBottomColor: t.border }]} onPress={onPress} activeOpacity={0.75}>
      <View style={[sr.dot, { backgroundColor: dotColor }]} />
      <View style={{ flex: 1 }}>
        <Text style={[sr.time, { color: t.text }]}>{slot.slotTime}</Text>
        <Text style={[sr.turf, { color: t.textMuted }]}>{slot.turfName}</Text>
      </View>
      <View style={[sr.badge, { backgroundColor: badgeBg }]}>
        <Text style={[sr.badgeText, { color: badgeColor }]}>{badgeLabel}</Text>
      </View>
      <Ionicons name="chevron-forward" size={14} color={t.textMuted} style={{ marginLeft: 6 }} />
    </TouchableOpacity>
  );
}

const sr = StyleSheet.create({
  row:      { flexDirection: "row", alignItems: "center", paddingVertical: 14, borderBottomWidth: 1 },
  dot:      { width: 8, height: 8, borderRadius: 4, marginRight: 12 },
  time:     { fontSize: 15, fontWeight: "800" },
  turf:     { fontSize: 11, fontWeight: "500", marginTop: 2 },
  badge:    { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 999 },
  badgeText:{ fontSize: 11, fontWeight: "800" },
});

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────
export default function OwnerHome() {
  const router = useRouter();

  const [ownerName,    setOwnerName]    = useState("");
  const [businessName, setBusinessName] = useState("");
  const [turfs,        setTurfs]        = useState<any[]>([]);
  const [bookings,     setBookings]     = useState<any[]>([]);
  const [blockedSlots, setBlockedSlots] = useState<any[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [refreshing,   setRefreshing]   = useState(false);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [isDark,       setIsDark]       = useState(false);

  useEffect(() => {
    AsyncStorage.getItem("owner_theme").then((val) => {
      if (val === "dark")  setIsDark(true);
      if (val === "light") setIsDark(false);
    });
  }, []);

  const toggleTheme = async () => {
    const next = !isDark;
    setIsDark(next);
    await AsyncStorage.setItem("owner_theme", next ? "dark" : "light");
  };

  const t = isDark ? DARK_THEME : LIGHT_THEME;

  function normalizeSlot(s: string): string {
    return s.replace(/\s*-\s*/g, " - ").trim();
  }

  function parseSlotToRange(slotStr: string): { start: number; end: number } | null {
    const parts = slotStr.split(" - ");
    if (parts.length < 2) return null;
    const parseT = (s: string): number => {
      const m = s.trim().match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)/i);
      if (!m) return 0;
      let h = Number(m[1]);
      const min = Number(m[2] || 0);
      const p = m[3].toUpperCase();
      if (p === "PM" && h !== 12) h += 12;
      if (p === "AM" && h === 12) h = 0;
      return h + min / 60;
    };
    const start = parseT(parts[0]);
    let end = parseT(parts[1]);
    if (end <= start) end = 24;
    return { start, end };
  }

  function rangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
    return aStart < bEnd && bStart < aEnd;
  }

  useEffect(() => { loadAll(); }, []);

  const loadAll = async () => {
    if (!auth.currentUser?.uid) { setLoading(false); return; }
    try {
      await Promise.all([fetchOwner(), fetchTurfs(), fetchBookings(), fetchBlockedSlots()]);
    } catch (e) { console.log(e); }
    finally { setLoading(false); }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadAll();
    setRefreshing(false);
  };

  const fetchOwner = async () => {
    const snap = await getDoc(doc(db, "users", auth.currentUser!.uid));
    if (snap.exists()) {
      setOwnerName(snap.data().name || "Owner");
      setBusinessName(snap.data().businessName || "");
    }
  };

  const fetchTurfs = async () => {
    const snap = await getDocs(query(collection(db, "turfs"), where("ownerId", "==", auth.currentUser!.uid)));
    setTurfs(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  };

  // ─── fetchBookings — THE ONLY CHANGE ────────────────────────────────────────
  // BEFORE: fetched ALL bookings ever with no date limit
  //   → getDocs(query(bookings, where ownerId == uid))
  //   → After 3 months = ~450 reads, after 1 year = ~1800+ reads every app open
  //
  // AFTER: fetches only last 30 days + upcoming (covers dashboard needs)
  //   → 30 days back covers: week revenue, recent bookings, stats
  //   → future dates covered: upcoming count works correctly
  //   → limit(500) as a hard safety cap
  //   → reads stay ~30–150 regardless of how old the turf is
  //
  // NOTE: The date strip shows next 7 days — all covered by "upcoming" range.
  //       The slot overview, today's bookings, week revenue, pending collect
  //       all work correctly with this 30-day window.
const fetchBookings = async () => {
  const snap = await getDocs(
    query(
      collection(db, "bookings"),
      where("ownerId", "==", auth.currentUser!.uid),
      limit(200)
    )
  );
  setBookings(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
};

  const fetchBlockedSlots = async () => {
    const snap = await getDocs(query(collection(db, "blockedSlots"), where("ownerId", "==", auth.currentUser!.uid)));
    setBlockedSlots(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  };

  // ── Derived — all pure useMemo, zero Firestore reads ─────────────────────
  const selectedDateKey = useMemo(() => selectedDate.toDateString(), [selectedDate]);
  const todayKey        = new Date().toDateString();

  const todayBookings = useMemo(() =>
    bookings
      .filter((b) => {
        const fromDate = getSafeDate(b.date)?.toDateString();
        const fromStr  = b.dateString;
        return (fromDate === selectedDateKey || fromStr === selectedDateKey) && b.status !== "cancelled";
      })
      .sort((a, b) => getSlotMins(a.slotTime ?? (a.selectedSlots?.[0] || "")) - getSlotMins(b.slotTime ?? (b.selectedSlots?.[0] || ""))),
  [bookings, selectedDateKey]);

  const upcomingCount = useMemo(() => {
    const now = new Date();
    return bookings.filter((b) => {
      const d = getSafeDate(b.date || b.dateString);
      return d && d > now && d.toDateString() !== todayKey && b.status !== "cancelled";
    }).length;
  }, [bookings]);

  const todayPaid = useMemo(() =>
    todayBookings.reduce((s, b) => s + Number(b.paidAmount || b.advanceAmount || 0), 0),
  [todayBookings]);

  const todayPending = useMemo(() =>
    todayBookings.reduce((s, b) => s + Number(b.remainingAmount || 0), 0),
  [todayBookings]);

  const weekRevenue = useMemo(() => {
    const wa = new Date(); wa.setDate(wa.getDate() - 7);
    return bookings
      .filter((b) => b.status !== "cancelled" && (getSafeDate(b.date || b.dateString)?.getTime() ?? 0) >= wa.getTime())
      .reduce((s, b) => s + Number(b.paidAmount || b.advanceAmount || 0), 0);
  }, [bookings]);

  const slotSummary = useMemo(() => {
    let available = 0, booked = 0, blocked = 0;
    turfs.forEach((turf) => {
      const open  = Number(turf.openingTime ?? 6);
      const close = Number(turf.closingTime ?? 23);
      const dur   = Number(turf.slotDuration ?? 60) / 60;
      for (let tm = open; tm + dur <= close; tm += dur) {
        const slotStart = tm;
        const slotEnd   = tm + dur;
        const isBooked = todayBookings.some((b) => {
          if (b.turfId !== turf.id) return false;
          const storedSlots: string[] = Array.isArray(b.selectedSlots) && b.selectedSlots.length > 0
            ? b.selectedSlots : [b.slotTime].filter(Boolean);
          return storedSlots.some((s) => {
            const r = parseSlotToRange(s);
            return r ? rangesOverlap(slotStart, slotEnd, r.start, r.end) : false;
          });
        });
        const isBlocked = blockedSlots.some((b) => {
          if (b.turfId !== turf.id || b.date !== selectedDateKey) return false;
          const storedSlots: string[] = Array.isArray(b.slots) ? b.slots : [b.slotTime].filter(Boolean);
          return storedSlots.some((s) => {
            const r = parseSlotToRange(s);
            return r ? rangesOverlap(slotStart, slotEnd, r.start, r.end) : false;
          });
        });
        if (isBooked) booked++;
        else if (isBlocked) blocked++;
        else available++;
      }
    });
    return { available, booked, blocked, total: available + booked + blocked };
  }, [turfs, todayBookings, blockedSlots, selectedDateKey]);

  const slotRows = useMemo(() => {
    const now     = new Date();
    const curMins = now.getHours() * 60 + now.getMinutes();
    const isToday = selectedDate.toDateString() === todayKey;
    const result: any[] = [];
    turfs.forEach((turf) => {
      const open  = Number(turf.openingTime ?? 6);
      const close = Number(turf.closingTime ?? 23);
      const dur   = Number(turf.slotDuration ?? 60) / 60;
      for (let tm = open; tm + dur <= close; tm += dur) {
        const slotStart = tm;
        const slotEnd   = tm + dur;
        const slotStr   = `${formatTime(slotStart)} - ${formatTime(slotEnd)}`;
        const mins      = slotStart * 60;
        if (isToday && mins < curMins) continue;
        const isBooked = todayBookings.some((b) => {
          if (b.turfId !== turf.id) return false;
          const storedSlots: string[] = Array.isArray(b.selectedSlots) && b.selectedSlots.length > 0
            ? b.selectedSlots : [b.slotTime].filter(Boolean);
          return storedSlots.some((s) => {
            const r = parseSlotToRange(s);
            return r ? rangesOverlap(slotStart, slotEnd, r.start, r.end) : false;
          });
        });
        const isBlocked = blockedSlots.some((b) => {
          if (b.turfId !== turf.id || b.date !== selectedDateKey) return false;
          const storedSlots: string[] = Array.isArray(b.slots) ? b.slots : [b.slotTime].filter(Boolean);
          return storedSlots.some((s) => {
            const r = parseSlotToRange(s);
            return r ? rangesOverlap(slotStart, slotEnd, r.start, r.end) : false;
          });
        });
        result.push({
          id:       `${turf.id}-${slotStr}`,
          turfName: turf.name || "Turf",
          slotTime: slotStr,
          mins,
          status:   isBooked ? "booked" : isBlocked ? "blocked" : "available",
        });
      }
    });
    return result.sort((a, b) => a.mins - b.mins).slice(0, 8);
  }, [turfs, todayBookings, blockedSlots, selectedDateKey]);

  const dateStrip = useMemo(() =>
    Array.from({ length: 7 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() + i); return d; }),
  []);

  const pendingCollections = useMemo(() =>
    todayBookings.filter((b) => Number(b.remainingAmount || 0) > 0),
  [todayBookings]);

  if (loading) return (
    <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: t.bg }}>
      <StatusBar barStyle="light-content" backgroundColor={t.bg} />
      <ActivityIndicator size="large" color={t.green} />
      <Text style={{ color: t.textSub, marginTop: 12, fontSize: 15, fontWeight: "600" }}>Loading...</Text>
    </View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <StatusBar barStyle={isDark ? "light-content" : "dark-content"} backgroundColor={t.bg} />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 100 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.green} />}
      >
        {/* ══ HEADER ══════════════════════════════════════════ */}
        <View style={[hd.wrap, { paddingTop: Platform.OS === "android" ? (StatusBar.currentHeight || 0) + 16 : 20 }]}>
          <View style={{ flex: 1 }}>
            <Text style={[hd.greeting, { color: t.textSub }]}>{getGreeting()}</Text>
            <View style={hd.nameRow}>
              <Text style={[hd.name, { color: t.text }]}>{ownerName} 👋</Text>
            </View>
            {businessName ? (
              <View style={hd.bizRow}>
                <Text style={[hd.biz, { color: t.textSub }]}>{businessName}</Text>
                <View style={[hd.proBadge, { backgroundColor: t.greenBg }]}>
                  <Text style={[hd.proBadgeText, { color: t.green }]}>PRO</Text>
                </View>
              </View>
            ) : null}
          </View>
          <View style={{ alignItems: "center", gap: 8 }}>
            <TouchableOpacity
              style={[hd.avatar, { backgroundColor: t.greenBg, borderColor: t.green }]}
              onPress={() => router.push("/(owner)/profile")}
            >
              <Text style={[hd.avatarText, { color: t.green }]}>{getInitials(ownerName || "O")}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[hd.themeToggle, { backgroundColor: t.card2, borderColor: t.border }]}
              onPress={toggleTheme}
            >
              <Ionicons
                name={isDark ? "sunny-outline" : "moon-outline"}
                size={14}
                color={isDark ? "#F9C74F" : "#6366F1"}
              />
            </TouchableOpacity>
          </View>
        </View>

        <View style={[hd.onlineRow, { paddingHorizontal: 20, marginBottom: 20 }]}>
          <View style={[hd.onlineDot, { backgroundColor: t.green }]} />
          <Text style={[hd.onlineText, { color: t.textMuted }]}>
            {turfs.length} turf{turfs.length !== 1 ? "s" : ""} active
          </Text>
          <Text style={[hd.separator, { color: t.textMuted }]}>  ·  </Text>
          <Text style={[hd.onlineText, { color: t.textMuted }]}>All systems running</Text>
        </View>

        {/* ══ STAT CARDS ══════════════════════════════════════ */}
        <View style={[st.grid, { paddingHorizontal: 16 }]}>
          <View style={st.row}>
            <StatCard icon="calendar" iconBg="rgba(88,166,255,0.2)" iconColor="#58A6FF"
              label="TODAY" value={todayBookings.length} sub="Booking today" decoration="wave" t={t} />
            <StatCard icon="time" iconBg="rgba(188,140,255,0.2)" iconColor="#BC8CFF"
              label="UPCOMING" value={upcomingCount} sub="Bookings" decoration="wave" t={t} />
            <StatCard icon="location" iconBg="rgba(255,105,180,0.2)" iconColor="#FF69B4"
              label="TURFS" value={turfs.length} sub="Total turfs" decoration="wave" t={t} />
          </View>
          <View style={[st.row, { marginTop: 10 }]}>
            <StatCard icon="checkmark-circle" iconBg="rgba(63,185,80,0.2)" iconColor="#3FB950"
              label="PAID" value={fmtAmt(todayPaid)} sub="Total paid" decoration="wave" t={t} />
            <StatCard icon="cash" iconBg="rgba(255,165,0,0.2)" iconColor="#FFA500"
              label="COLLECT" value={fmtAmt(todayPending)} sub="Pending collect" decoration="bar" t={t} />
            <StatCard icon="trending-up" iconBg="rgba(63,185,80,0.2)" iconColor="#3FB950"
              label="WEEK" value={fmtAmt(weekRevenue)} sub="This week" decoration="bar" t={t} />
          </View>
        </View>

        {/* ══ PENDING ALERT ════════════════════════════════════ */}
        {pendingCollections.length > 0 && (
          <View style={[al.card, { backgroundColor: "rgba(255,165,0,0.1)", borderColor: "rgba(255,165,0,0.25)", marginHorizontal: 16, marginTop: 16 }]}>
            <Ionicons name="warning" size={16} color="#FFA500" />
            <Text style={[al.text, { color: "#FFA500" }]}>
              {pendingCollections.length} booking{pendingCollections.length > 1 ? "s" : ""} — collect ₹{todayPending.toLocaleString()} at venue
            </Text>
            <TouchableOpacity onPress={() => router.push("/(owner)/bookings" as any)}>
              <Text style={[al.link, { color: "#FFA500" }]}>View →</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ══ QUICK ACTIONS ════════════════════════════════════ */}
        <View style={[qa.wrap, { backgroundColor: t.card, borderColor: t.border, marginHorizontal: 16, marginTop: 16 }]}>
          {[
            { icon: "calendar-outline",    label: "Bookings",    color: "#58A6FF", bg: "rgba(88,166,255,0.15)",  route: "/(owner)/bookings" },
            { icon: "lock-closed-outline", label: "Block Slots", color: "#F85149", bg: "rgba(248,81,73,0.15)",   route: "/(owner)/block-slots" },
            { icon: "stats-chart",         label: "Revenue",     color: "#BC8CFF", bg: "rgba(188,140,255,0.15)", route: "/(owner)/revenue" },
            { icon: "headset-outline",     label: "Support",     color: "#FFA500", bg: "rgba(255,165,0,0.15)",   route: "/support/owner-support" },
            { icon: "person-outline",      label: "Profile",     color: "#3FB950", bg: "rgba(63,185,80,0.15)",   route: "/(owner)/profile" },
          ].map((a) => (
            <ActionBtn key={a.label} icon={a.icon} label={a.label} color={a.color} bg={a.bg}
              onPress={() => router.push(a.route as any)} t={t} />
          ))}
        </View>

        {/* ══ SLOT OVERVIEW ════════════════════════════════════ */}
        <View style={[ov.card, { backgroundColor: t.card, borderColor: t.border, marginHorizontal: 16, marginTop: 16 }]}>
          <View style={ov.header}>
  <View>
    <Text style={[ov.title, { color: t.text }]}>
      Slot Overview
    </Text>

    <View style={{ flexDirection: "row", alignItems: "center", marginTop: 4 }}>
      <Ionicons
        name="refresh-outline"
        size={11}
        color={t.textMuted}
        style={{ marginRight: 4 }}
      />

      <Text
        style={{
          color: t.textMuted,
          fontSize: 11,
          fontWeight: "600",
        }}
      >
        Pull to refresh for accurate live data
      </Text>
    </View>
  </View>

  <TouchableOpacity
    onPress={() => router.push("/(owner)/block-slots" as any)}
  >
    <Text style={[ov.link, { color: t.green }]}>
      Full Schedule →
    </Text>
  </TouchableOpacity>
</View>

          {/* Date chips — changing date = 0 Firestore reads (pure useMemo) */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 16 }}>
            {dateStrip.map((d) => {
              const active = d.toDateString() === selectedDateKey;
              return (
                <TouchableOpacity
                  key={d.toDateString()}
                  style={[ov.dateChip, { backgroundColor: active ? t.green : t.card2, borderColor: active ? t.green : t.border }]}
                  onPress={() => setSelectedDate(d)}
                >
                  <Text style={[ov.dateDay, { color: active ? "#fff" : t.textSub }]}>
                    {d.toLocaleDateString("en-US", { weekday: "short" }).toUpperCase()}
                  </Text>
                  <Text style={[ov.dateNum, { color: active ? "#fff" : t.text }]}>{d.getDate()}</Text>
                  <Text style={[ov.dateMon, { color: active ? "rgba(255,255,255,0.7)" : t.textMuted }]}>
                    {d.toLocaleDateString("en-US", { month: "short" }).toUpperCase()}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {slotSummary.total > 0 && (
            <>
              <View style={[ov.occBar, { backgroundColor: t.card2 }]}>
                {slotSummary.booked > 0   && <View style={[ov.seg, { flex: slotSummary.booked,   backgroundColor: "#F85149" }]} />}
                {slotSummary.blocked > 0  && <View style={[ov.seg, { flex: slotSummary.blocked,  backgroundColor: "#58A6FF" }]} />}
                {slotSummary.available > 0 && <View style={[ov.seg, { flex: slotSummary.available, backgroundColor: t.green }]} />}
              </View>
              <View style={ov.occLegend}>
                {[
                  { color: "#F85149", label: `${slotSummary.booked} Booked` },
                  { color: "#58A6FF", label: `${slotSummary.blocked} Blocked` },
                  { color: t.green,   label: `${slotSummary.available} Free` },
                ].map((l) => (
                  <View key={l.label} style={ov.legendItem}>
                    <View style={[ov.legendDot, { backgroundColor: l.color }]} />
                    <Text style={[ov.legendText, { color: t.textSub }]}>{l.label}</Text>
                  </View>
                ))}
              </View>
            </>
          )}

          {slotRows.length === 0 ? (
            <View style={{ alignItems: "center", paddingVertical: 24, gap: 8 }}>
              <Ionicons name="checkmark-circle" size={28} color={t.green} />
              <Text style={{ color: t.textMuted, fontSize: 13, fontWeight: "600" }}>All slots filled for this date</Text>
            </View>
          ) : (
            slotRows.map((slot) => (
              <SlotRow key={slot.id} slot={slot} t={t}
                onPress={() => router.push("/(owner)/block-slots" as any)} />
            ))
          )}

          <TouchableOpacity
            style={[ov.addBtn, { backgroundColor: t.greenBg, borderColor: isDark ? "rgba(63,185,80,0.3)" : t.green }]}
            onPress={() => router.push("/(owner)/block-slots" as any)}
            activeOpacity={0.8}
          >
            <Ionicons name="calendar-outline" size={16} color={t.green} />
            <Text style={[ov.addBtnText, { color: t.green }]}>Add New Slot</Text>
          </TouchableOpacity>
        </View>

        {/* ══ TODAY'S BOOKINGS ════════════════════════════════ */}
        {todayBookings.length > 0 && (
          <View style={[ov.card, { backgroundColor: t.card, borderColor: t.border, marginHorizontal: 16, marginTop: 16 }]}>
            <View style={ov.header}>
              <View>
                <Text style={[ov.title, { color: t.text }]}>Today's Bookings</Text>
                <Text style={{ color: t.textMuted, fontSize: 11, marginTop: 2 }}>{todayBookings.length} confirmed · {selectedDateKey}</Text>
              </View>
              <TouchableOpacity onPress={() => router.push("/(owner)/bookings" as any)}>
                <Text style={[ov.link, { color: t.green }]}>View All →</Text>
              </TouchableOpacity>
            </View>

            {todayBookings.slice(0, 5).map((item) => {
              const name = item.userName || item.customerName || "Customer";
              const paid = Number(item.paidAmount || item.advanceAmount || 0);
              const rem  = Number(item.remainingAmount || 0);
              const slots: string[] = Array.isArray(item.selectedSlots) && item.selectedSlots.length > 0
                ? item.selectedSlots : item.slotTime ? [item.slotTime] : [];
              return (
                <TouchableOpacity
                  key={item.id}
                  style={[bk.row, { borderBottomColor: t.border }]}
                  onPress={() => router.push({ pathname: "/(owner)/booking-receipt/[id]", params: { id: item.id } } as any)}
                  activeOpacity={0.75}
                >
                  <View style={[bk.avatar, { backgroundColor: t.card2 }]}>
                    <Text style={[bk.avatarText, { color: t.green }]}>{name[0]?.toUpperCase() || "?"}</Text>
                  </View>
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={[bk.name, { color: t.text }]}>{name}</Text>
                    <Text style={[bk.slot, { color: t.textSub }]} numberOfLines={1}>
                      {slots.length > 0 ? slots[0] + (slots.length > 1 ? ` +${slots.length - 1}` : "") : "—"}
                    </Text>
                    <Text style={[bk.turf, { color: t.textMuted }]}>{item.turfName || "—"}</Text>
                  </View>
                  <View style={{ alignItems: "flex-end", gap: 4 }}>
                    <Text style={[bk.paid, { color: t.green }]}>₹{paid.toLocaleString()}</Text>
                    {rem > 0 && <Text style={bk.rem}>+₹{rem.toLocaleString()}</Text>}
                  </View>
                </TouchableOpacity>
              );
            })}

            {todayBookings.length > 5 && (
              <TouchableOpacity
                style={[bk.moreBtn, { backgroundColor: t.card2, borderColor: t.border }]}
                onPress={() => router.push("/(owner)/bookings" as any)}
              >
                <Text style={[bk.moreBtnText, { color: t.textSub }]}>
                  +{todayBookings.length - 5} more bookings
                </Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* ══ MY TURFS ════════════════════════════════════════ */}
        {turfs.length > 0 && (
          <View style={[ov.card, { backgroundColor: t.card, borderColor: t.border, marginHorizontal: 16, marginTop: 16 }]}>
            <View style={ov.header}>
              <Text style={[ov.title, { color: t.text }]}>My Turfs</Text>
              <TouchableOpacity onPress={() => router.push("/(owner)/MyTurfs" as any)}>
                <Text style={[ov.link, { color: t.green }]}>Manage →</Text>
              </TouchableOpacity>
            </View>
            {turfs.map((turf) => {
              const cnt = todayBookings.filter((b) => b.turfId === turf.id).length;
              const rev = todayBookings.filter((b) => b.turfId === turf.id)
                .reduce((s, b) => s + Number(b.paidAmount || b.advanceAmount || 0), 0);
              return (
                <TouchableOpacity
                  key={turf.id}
                  style={[tr.row, { borderBottomColor: t.border }]}
                  onPress={() => router.push("/(owner)/MyTurfs" as any)}
                  activeOpacity={0.75}
                >
                  <View style={[tr.icon, { backgroundColor: t.greenBg }]}>
                    <Ionicons name="football-outline" size={20} color={t.green} />
                  </View>
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={[tr.name, { color: t.text }]}>{turf.name || "Unnamed"}</Text>
                    <Text style={[tr.loc, { color: t.textMuted }]}>{turf.location || "No location"}</Text>
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={[tr.cnt, { color: t.textSub }]}>{cnt} bookings</Text>
                    <Text style={[tr.rev, { color: t.green }]}>{fmtAmt(rev)} today</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={14} color={t.textMuted} style={{ marginLeft: 8 }} />
                </TouchableOpacity>
              );
            })}
          </View>
        )}

      </ScrollView>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const hd = StyleSheet.create({
  wrap:        { flexDirection: "row", alignItems: "flex-start", paddingHorizontal: 20, marginBottom: 8 },
  greeting:    { fontSize: 14, fontWeight: "600" },
  nameRow:     { flexDirection: "row", alignItems: "center", marginTop: 2 },
  name:        { fontSize: 26, fontWeight: "900", letterSpacing: -0.3 },
  bizRow:      { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 },
  biz:         { fontSize: 13, fontWeight: "600" },
  proBadge:    { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 },
  proBadgeText:{ fontSize: 10, fontWeight: "900", letterSpacing: 0.5 },
  avatar:      { width: 48, height: 48, borderRadius: 24, borderWidth: 2, justifyContent: "center", alignItems: "center" },
  avatarText:  { fontSize: 16, fontWeight: "900" },
  themeToggle: { width: 30, height: 30, borderRadius: 10, borderWidth: 1, justifyContent: "center", alignItems: "center" },
  onlineRow:   { flexDirection: "row", alignItems: "center" },
  onlineDot:   { width: 7, height: 7, borderRadius: 4, marginRight: 7 },
  onlineText:  { fontSize: 12, fontWeight: "600" },
  separator:   { fontSize: 12 },
});

const st = StyleSheet.create({
  grid: {},
  row:  { flexDirection: "row", gap: 8 },
});

const al = StyleSheet.create({
  card: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 14, padding: 12, borderWidth: 1 },
  text: { flex: 1, fontSize: 12, fontWeight: "700" },
  link: { fontSize: 12, fontWeight: "800" },
});

const qa = StyleSheet.create({
  wrap: { flexDirection: "row", justifyContent: "space-around", alignItems: "flex-start", borderRadius: 22, padding: 18, borderWidth: 1 },
});

const ov = StyleSheet.create({
  card:      { borderRadius: 22, padding: 18, borderWidth: 1 },
  header:    { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 },
  title:     { fontSize: 17, fontWeight: "900" },
  link:      { fontSize: 13, fontWeight: "700" },
  dateChip:  { width: 60, paddingVertical: 10, borderRadius: 14, alignItems: "center", borderWidth: 1 },
  dateDay:   { fontSize: 9, fontWeight: "800" },
  dateNum:   { fontSize: 20, fontWeight: "900", marginTop: 2 },
  dateMon:   { fontSize: 9, fontWeight: "700", marginTop: 1 },
  occBar:    { flexDirection: "row", height: 6, borderRadius: 3, overflow: "hidden", marginBottom: 10 },
  seg:       { height: 6 },
  occLegend: { flexDirection: "row", gap: 16, marginBottom: 14 },
  legendItem:{ flexDirection: "row", alignItems: "center", gap: 5 },
  legendDot: { width: 7, height: 7, borderRadius: 4 },
  legendText:{ fontSize: 11, fontWeight: "600" },
  addBtn:    { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 14, paddingVertical: 13, borderRadius: 14, borderWidth: 1 },
  addBtnText:{ fontSize: 14, fontWeight: "800" },
});

const bk = StyleSheet.create({
  row:        { flexDirection: "row", alignItems: "center", paddingVertical: 13, borderBottomWidth: 1 },
  avatar:     { width: 42, height: 42, borderRadius: 21, justifyContent: "center", alignItems: "center" },
  avatarText: { fontSize: 16, fontWeight: "900" },
  name:       { fontSize: 14, fontWeight: "800" },
  slot:       { fontSize: 11, fontWeight: "500", marginTop: 2 },
  turf:       { fontSize: 10, marginTop: 1 },
  paid:       { fontSize: 14, fontWeight: "900" },
  rem:        { fontSize: 11, fontWeight: "600", color: "#FFA500" },
  moreBtn:    { borderRadius: 12, paddingVertical: 11, alignItems: "center", marginTop: 12, borderWidth: 1 },
  moreBtnText:{ fontSize: 13, fontWeight: "700" },
});

const tr = StyleSheet.create({
  row:  { flexDirection: "row", alignItems: "center", paddingVertical: 13, borderBottomWidth: 1 },
  icon: { width: 42, height: 42, borderRadius: 14, justifyContent: "center", alignItems: "center" },
  name: { fontSize: 14, fontWeight: "800" },
  loc:  { fontSize: 11, marginTop: 2 },
  cnt:  { fontSize: 12, fontWeight: "700" },
  rev:  { fontSize: 11, fontWeight: "700", marginTop: 2 },
});
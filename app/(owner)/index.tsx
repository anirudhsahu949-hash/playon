// app/(owner)/index.tsx  —  FULL FILE
//
// WHAT CHANGED (Slot Overview redesign — 21 Oct)
// ─────────────────────────────────────────────────────────────────────────────
// • Slot Overview is now a compact card:
//     - 7 small date chips in one row (no horizontal scroll)
//     - NEW turf filter chips: "All turfs" + one chip per turf
//       (hidden when the owner has only one turf — it's auto-selected)
//     - One turf selected  → 4-per-row tile grid of every slot of the day,
//       coloured Free / Booked / Blocked / Over (past).
//         · tap Free    → Block Slots screen (turfId, date, slot passed as params)
//         · tap Booked  → that booking's receipt
//         · tap Blocked → Block Slots screen
//     - All turfs selected → one compact row per turf: counts + a colour strip
//       of the whole day. Tap a row to filter to that turf.
//     - Counts row (Free / Booked / Blocked / Over) follows the filter.
//     - "Add New Slot" button → "Block Slots".
// • Removed the old one-slot-per-line SlotRow list (and its 8-slot cap).
// • Turfs that close after midnight (closingTime <= openingTime) now get their
//   late-night slots in the grid; formatTime handles hours past 24.
//
// Data fetching is untouched — same queries, same fallbacks, same reads.
// Everything in the Slot Overview is pure useMemo: changing date or turf
// filter = 0 Firestore reads.
// ─────────────────────────────────────────────────────────────────────────────

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
} from "react-native";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { auth, db } from "../../firebaseConfig";
import {
  doc,
  getDoc,
  collection,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  Timestamp,
} from "firebase/firestore";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";

const { width: SW } = Dimensions.get("window");

// How far back the dashboard needs history for (week revenue, today, stats).
const HISTORY_DAYS = 30;
// Hard safety cap on the bookings read.
const BOOKINGS_CAP = 500;

// Slot grid: card has 16px outer margin each side, 18px padding, 1px border.
// SLOT_COLS = tiles per row.
const SLOT_COLS = 4;
const GRID_GAP = 8;
const TILE_W = Math.floor((SW - 32 - 36 - 2 - GRID_GAP * (SLOT_COLS - 1)) / SLOT_COLS);

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

// ── Slot status colours (tiles + strips) ────────────────────────────────────
type SlotStatus = "free" | "booked" | "blocked" | "past";

type TileColors = { bg: string; border: string; label: string; strip: string };

function slotColors(status: SlotStatus, isDark: boolean, t: Theme): TileColors {
  if (isDark) {
    switch (status) {
      case "free":    return { bg: "rgba(63,185,80,0.12)",  border: "rgba(63,185,80,0.35)",  label: "#3FB950", strip: "#3FB950" };
      case "booked":  return { bg: "rgba(248,81,73,0.12)",  border: "rgba(248,81,73,0.35)",  label: "#F85149", strip: "#F85149" };
      case "blocked": return { bg: "rgba(88,166,255,0.12)", border: "rgba(88,166,255,0.35)", label: "#58A6FF", strip: "#58A6FF" };
      default:        return { bg: t.card2,                 border: "rgba(255,255,255,0.10)", label: t.textSub, strip: "#30363D" };
    }
  }
  switch (status) {
    case "free":    return { bg: "#F0FDF4", border: "#BBF7D0", label: "#15803D", strip: "#22C55E" };
    case "booked":  return { bg: "#FEF2F2", border: "#FECACA", label: "#B91C1C", strip: "#DC2626" };
    case "blocked": return { bg: "#EFF6FF", border: "#BFDBFE", label: "#1D4ED8", strip: "#2563EB" };
    default:        return { bg: "#F8FAFC", border: "#E2E8F0", label: "#64748B", strip: "#E2E8F0" };
  }
}

const STATUS_LABEL: Record<SlotStatus, string> = {
  free: "Free", booked: "Booked", blocked: "Blocked", past: "Over",
};

type GridSlot = {
  id: string;
  turfId: string;
  label: string;      // "6 AM", "6:30 PM"
  slotStr: string;    // "6:00 AM - 7:00 AM"
  start: number;      // hours, may be > 24 for after-midnight slots
  status: SlotStatus;
  bookingId?: string;
  wasBooked?: boolean; // past slot that was booked/blocked (shown dimmed)
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
  const hh   = ((h % 24) + 24) % 24;
  const hour = Math.floor(hh);
  const min  = Math.round((hh % 1) * 60);
  const suf  = hour >= 12 ? "PM" : "AM";
  const hr   = hour % 12 === 0 ? 12 : hour % 12;
  return `${hr}:${pad(min)} ${suf}`;
}

// Short tile label: "6 AM", "6:30 PM"
function shortTime(h: number): string {
  const hh   = ((h % 24) + 24) % 24;
  const hour = Math.floor(hh);
  const min  = Math.round((hh % 1) * 60);
  const suf  = hour >= 12 ? "PM" : "AM";
  const hr   = hour % 12 === 0 ? 12 : hour % 12;
  return min ? `${hr}:${pad(min)} ${suf}` : `${hr} ${suf}`;
}

// The 7 day-keys the date strip can show. blockedSlots.date is stored as a
// toDateString() string (see block-slots.tsx), so we match on exactly these.
function next7DayKeys(): string[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() + i);
    return d.toDateString();
  });
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

// ── Slot Tile (one-turf grid) ─────────────────────────────────────────────────
function SlotTile({ slot, isDark, t, onPress }: {
  slot: GridSlot; isDark: boolean; t: Theme; onPress: () => void;
}) {
  const c = slotColors(slot.status, isDark, t);
  const isPast = slot.status === "past";
  return (
    <TouchableOpacity
      style={[
        ov.tile,
        { backgroundColor: c.bg, borderColor: c.border, borderStyle: isPast ? "dashed" : "solid" },
      ]}
      onPress={onPress}
      disabled={isPast}
      activeOpacity={0.7}
    >
      <Text style={[ov.tileTime, { color: isPast ? c.label : t.text }]}>{slot.label}</Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
        {slot.status === "blocked" && <Ionicons name="lock-closed" size={9} color={c.label} />}
        <Text style={[ov.tileLabel, { color: c.label }]}>
          {isPast && slot.wasBooked ? "Played" : STATUS_LABEL[slot.status]}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

// ── Turf Strip Row (all-turfs view) ───────────────────────────────────────────
function TurfStripRow({ name, slots, isDark, t, onPress }: {
  name: string; slots: GridSlot[]; isDark: boolean; t: Theme; onPress: () => void;
}) {
  const free    = slots.filter((s) => s.status === "free").length;
  const booked  = slots.filter((s) => s.status === "booked").length;
  const blocked = slots.filter((s) => s.status === "blocked").length;

  const parts = [
    `${free} free`,
    booked  ? `${booked} booked`   : "",
    blocked ? `${blocked} blocked` : "",
  ].filter(Boolean).join(" · ");

  const first = slots[0];
  const mid   = slots[Math.floor(slots.length / 2)];
  const last  = slots[slots.length - 1];
  const stripGap = slots.length > 20 ? 1 : 3;

  return (
    <TouchableOpacity
      style={[ov.turfRow, { backgroundColor: t.card2, borderColor: t.border }]}
      onPress={onPress}
      activeOpacity={0.75}
    >
      <View style={ov.turfRowHead}>
        <Text style={[ov.turfRowName, { color: t.text }]} numberOfLines={1}>{name}</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
          <Text style={[ov.turfRowCounts, { color: t.textSub }]}>{slots.length ? parts : "No slots"}</Text>
          <Ionicons name="chevron-forward" size={13} color={t.textSub} />
        </View>
      </View>

      {slots.length > 0 && (
        <>
          <View style={[ov.strip, { gap: stripGap }]}>
            {slots.map((s) => (
              <View key={s.id} style={[ov.stripSeg, { backgroundColor: slotColors(s.status, isDark, t).strip }]} />
            ))}
          </View>
          <View style={ov.stripLabels}>
            <Text style={[ov.stripLabel, { color: t.textSub }]}>{first.label}</Text>
            <Text style={[ov.stripLabel, { color: t.textSub }]}>{mid.label}</Text>
            <Text style={[ov.stripLabel, { color: t.textSub }]}>{shortTime(last.start + (last.start - (slots[slots.length - 2]?.start ?? last.start - 1)))}</Text>
          </View>
        </>
      )}
    </TouchableOpacity>
  );
}

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
  const [selectedTurfId, setSelectedTurfId] = useState<string>("all");
  const [isDark,       setIsDark]       = useState(false);

  // Guards against setState after the screen goes away.
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => { aliveRef.current = false; };
  }, []);

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
  // Accent for the Slot Overview card (light theme's t.green is grey).
  const accent = isDark ? "#3FB950" : "#15803D";

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

  // allSettled, not all — one failing query must not wipe out the other three.
  const loadAll = async () => {
    if (!auth.currentUser?.uid) { setLoading(false); return; }
    try {
      const results = await Promise.allSettled([
        fetchOwner(),
        fetchTurfs(),
        fetchBookings(),
        fetchBlockedSlots(),
      ]);
      results.forEach((r, i) => {
        if (r.status === "rejected") {
          console.log(
            `Owner dashboard: ${["fetchOwner", "fetchTurfs", "fetchBookings", "fetchBlockedSlots"][i]} failed —`,
            r.reason
          );
        }
      });
    } catch (e) {
      console.log(e);
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadAll();
    if (aliveRef.current) setRefreshing(false);
  };

  const fetchOwner = async () => {
    const snap = await getDoc(doc(db, "users", auth.currentUser!.uid));
    if (snap.exists() && aliveRef.current) {
      setOwnerName(snap.data().name || "Owner");
      setBusinessName(snap.data().businessName || "");
    }
  };

  const fetchTurfs = async () => {
    const snap = await getDocs(
      query(collection(db, "turfs"), where("ownerId", "==", auth.currentUser!.uid))
    );
    if (aliveRef.current) setTurfs(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  };

  // ─── fetchBookings ──────────────────────────────────────────────────────────
  // Last HISTORY_DAYS days AND everything upcoming (the >= range is open-ended
  // upward), newest first, capped at BOOKINGS_CAP.
  //
  // Needs the composite index:  bookings → ownerId (ASC) + date (DESC)
  // First run without it logs a "create index" link from Firestore. Until then
  // the catch block falls back to the old unbounded read so the dashboard is
  // never blank — it just costs more reads.
  const fetchBookings = async () => {
    const uid  = auth.currentUser!.uid;
    const from = new Date();
    from.setDate(from.getDate() - HISTORY_DAYS);
    from.setHours(0, 0, 0, 0);

    let docs: any[];
    try {
      const snap = await getDocs(
        query(
          collection(db, "bookings"),
          where("ownerId", "==", uid),
          where("date", ">=", Timestamp.fromDate(from)),
          orderBy("date", "desc"),
          limit(BOOKINGS_CAP)
        )
      );
      docs = snap.docs;
    } catch (indexErr) {
      console.warn(
        "⚠️ Owner dashboard: bounded bookings query failed (most likely the missing " +
          "Firestore composite index on bookings: ownerId + date). Falling back to an " +
          "unbounded fetch. Check the Firestore console for the auto-generated " +
          "'create index' link — creating it will cut your reads a lot.",
        indexErr
      );
      const full = await getDocs(
        query(collection(db, "bookings"), where("ownerId", "==", uid))
      );
      docs = full.docs;
    }

    if (aliveRef.current) setBookings(docs.map((d) => ({ id: d.id, ...d.data() })));
  };

  // ─── fetchBlockedSlots ──────────────────────────────────────────────────────
  // Only the 7 days the date strip can actually show. blockedSlots.date is a
  // toDateString() STRING, so this is an "in" match, not a range.
  //
  // Needs the composite index:  blockedSlots → ownerId (ASC) + date (ASC)
  // Same fallback as above if it isn't there yet.
  const fetchBlockedSlots = async () => {
    const uid  = auth.currentUser!.uid;
    const keys = next7DayKeys();

    let docs: any[];
    try {
      const snap = await getDocs(
        query(
          collection(db, "blockedSlots"),
          where("ownerId", "==", uid),
          where("date", "in", keys)
        )
      );
      docs = snap.docs;
    } catch (indexErr) {
      console.warn(
        "⚠️ Owner dashboard: bounded blockedSlots query failed (likely a missing " +
          "composite index on blockedSlots: ownerId + date). Falling back to an " +
          "unbounded fetch.",
        indexErr
      );
      const full = await getDocs(
        query(collection(db, "blockedSlots"), where("ownerId", "==", uid))
      );
      docs = full.docs;
    }

    if (aliveRef.current) setBlockedSlots(docs.map((d) => ({ id: d.id, ...d.data() })));
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
      .sort((a, b) => {
        const am = parseSlotToRange(a.slotTime ?? (a.selectedSlots?.[0] || ""))?.start ?? 0;
        const bm = parseSlotToRange(b.slotTime ?? (b.selectedSlots?.[0] || ""))?.start ?? 0;
        return am - bm;
      }),
  [bookings, selectedDateKey]);

  const upcomingCount = useMemo(() => {
    const now = new Date();
    return bookings.filter((b) => {
      const d = getSafeDate(b.date || b.dateString);
      return d && d > now && d.toDateString() !== todayKey && b.status !== "cancelled";
    }).length;
  }, [bookings, todayKey]);

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

  // Every slot of the selected day, per turf, with its status.
  const slotsByTurf = useMemo(() => {
    const now     = new Date();
    const curH    = now.getHours() + now.getMinutes() / 60;
    const isToday = selectedDateKey === todayKey;
    const map: Record<string, GridSlot[]> = {};

    turfs.forEach((turf) => {
      const open = Number(turf.openingTime ?? 6);
      let close  = Number(turf.closingTime ?? 23);
      if (close <= open) close += 24;            // runs past midnight
      const dur  = Number(turf.slotDuration ?? 60) / 60;
      const list: GridSlot[] = [];
      map[turf.id] = list;
      if (!(dur > 0)) return;

      const turfBookings = todayBookings.filter((b) => b.turfId === turf.id);
      const turfBlocks   = blockedSlots.filter((b) => b.turfId === turf.id && b.date === selectedDateKey);

      for (let tm = open; tm + dur <= close + 1e-6; tm += dur) {
        const slotEnd = tm + dur;
        // Compare in 0–24 space (stored slot strings never go past 24).
        const cs = tm >= 24 ? tm - 24 : tm;
        const ce = tm >= 24 ? slotEnd - 24 : Math.min(slotEnd, 24);
        const hits = (stored: string[]) =>
          stored.some((s) => {
            const r = parseSlotToRange(s);
            return r ? rangesOverlap(cs, ce, r.start, r.end) : false;
          });

        const booking = turfBookings.find((b) =>
          hits(Array.isArray(b.selectedSlots) && b.selectedSlots.length > 0
            ? b.selectedSlots : [b.slotTime].filter(Boolean))
        );
        const isBlocked = !booking && turfBlocks.some((b) =>
          hits(Array.isArray(b.slots) ? b.slots : [b.slotTime].filter(Boolean))
        );
        const isPast = isToday && slotEnd <= curH;

        let status: SlotStatus = booking ? "booked" : isBlocked ? "blocked" : "free";
        const wasBooked = isPast && status !== "free";
        if (isPast) status = "past";

        list.push({
          id:        `${turf.id}-${tm}`,
          turfId:    turf.id,
          label:     shortTime(tm),
          slotStr:   `${formatTime(tm)} - ${formatTime(slotEnd)}`,
          start:     tm,
          status,
          bookingId: booking?.id,
          wasBooked,
        });
      }
    });
    return map;
  }, [turfs, todayBookings, blockedSlots, selectedDateKey, todayKey]);

  // One turf → always that turf. Selected turf removed → back to "all".
  const activeTurfId = useMemo(() => {
    if (turfs.length === 1) return turfs[0].id;
    if (selectedTurfId !== "all" && turfs.some((tf) => tf.id === selectedTurfId)) return selectedTurfId;
    return "all";
  }, [turfs, selectedTurfId]);

  const activeTurf = turfs.find((tf) => tf.id === activeTurfId);

  const slotSummary = useMemo(() => {
    const scope = activeTurfId === "all"
      ? Object.values(slotsByTurf).flat()
      : slotsByTurf[activeTurfId] || [];
    const count = (st: SlotStatus) => scope.filter((s) => s.status === st).length;
    return {
      free: count("free"), booked: count("booked"), blocked: count("blocked"),
      past: count("past"), total: scope.length,
    };
  }, [slotsByTurf, activeTurfId]);

  const dateStrip = useMemo(() =>
    Array.from({ length: 7 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() + i); return d; }),
  []);

  const pendingCollections = useMemo(() =>
    todayBookings.filter((b) => Number(b.remainingAmount || 0) > 0),
  [todayBookings]);

  const onSlotPress = (slot: GridSlot) => {
    if (slot.status === "booked" && slot.bookingId) {
      router.push({ pathname: "/(owner)/booking-receipt/[id]", params: { id: slot.bookingId } } as any);
      return;
    }
    router.push({
      pathname: "/(owner)/block-slots",
      params: { turfId: slot.turfId, date: selectedDateKey, slot: slot.slotStr },
    } as any);
  };

  if (loading) return (
    <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: t.bg }}>
      <StatusBar barStyle={isDark ? "light-content" : "dark-content"} backgroundColor={t.bg} />
      <ActivityIndicator size="large" color={t.green} />
      <Text style={{ color: t.textSub, marginTop: 12, fontSize: 15, fontWeight: "600" }}>Loading...</Text>
    </View>
  );

  const legend = [
    { color: slotColors("free",    isDark, t).strip, label: `${slotSummary.free} Free` },
    { color: slotColors("booked",  isDark, t).strip, label: `${slotSummary.booked} Booked` },
    { color: slotColors("blocked", isDark, t).strip, label: `${slotSummary.blocked} Blocked` },
    ...(slotSummary.past > 0
      ? [{ color: isDark ? "#484F58" : "#CBD5E1", label: `${slotSummary.past} Over` }]
      : []),
  ];

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
            // { icon: "stats-chart",      label: "Revenue",     color: "#BC8CFF", bg: "rgba(188,140,255,0.15)", route: "/(owner)/revenue" },
            { icon: "list",     label: "Schedule",     color: "#FFA500", bg: "rgba(255,165,0,0.15)",   route: "/(owner)/schedule" },
            { icon: "wallet-outline",      label: "Transection", color: "#3FB950", bg: "rgba(63,185,80,0.15)",   route: "/(owner)/settlementscreen" },
          ].map((a) => (
            <ActionBtn key={a.label} icon={a.icon} label={a.label} color={a.color} bg={a.bg}
              onPress={() => router.push(a.route as any)} t={t} />
          ))}
        </View>

        {/* ══ SLOT OVERVIEW ════════════════════════════════════ */}
        <View style={[ov.card, { backgroundColor: t.card, borderColor: t.border, marginHorizontal: 16, marginTop: 16 }]}>
          <View style={[ov.header, { alignItems: "center", marginBottom: 14 }]}>
            <View>
              <Text style={[ov.title, { color: t.text }]}>Slot Overview</Text>
              <Text style={[ov.subtitle, { color: t.textSub }]}>
                {selectedDate.toLocaleDateString("en-US", { weekday: "short", day: "numeric", month: "short" })} · pull down to refresh
              </Text>
            </View>
            <TouchableOpacity onPress={() => router.push("/(owner)/block-slots" as any)} hitSlop={8}>
              <Text style={[ov.link, { color: accent }]}>Full Schedule →</Text>
            </TouchableOpacity>
          </View>

          {/* Dates — wider chips, scroll sideways. Changing date = 0 Firestore reads. */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={ov.dateRow}>
            {dateStrip.map((d) => {
              const active = d.toDateString() === selectedDateKey;
              return (
                <TouchableOpacity
                  key={d.toDateString()}
                  style={[ov.dateChip, {
                    backgroundColor: active ? accent : t.card2,
                    borderColor: active ? accent : t.border,
                  }]}
                  onPress={() => setSelectedDate(d)}
                  activeOpacity={0.8}
                >
                  <Text style={[ov.dateDay, { color: active ? "#fff" : t.textSub }]}>
                    {d.toLocaleDateString("en-US", { weekday: "short" }).toUpperCase()}
                  </Text>
                  <Text style={[ov.dateNum, { color: active ? "#fff" : t.text }]}>{d.getDate()}</Text>
                  <Text style={[ov.dateMon, { color: active ? "rgba(255,255,255,0.8)" : t.textSub }]}>
                    {d.toLocaleDateString("en-US", { month: "short" }).toUpperCase()}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {/* Turf filter — hidden when there's only one turf */}
          {turfs.length > 1 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 8 }}
              style={{ marginTop: 14 }}
            >
              {[{ id: "all", name: "All turfs" }, ...turfs].map((tf: any) => {
                const active = tf.id === activeTurfId;
                return (
                  <TouchableOpacity
                    key={tf.id}
                    style={[ov.turfChip, {
                      backgroundColor: active ? t.text : t.card,
                      borderColor: active ? t.text : t.border,
                    }]}
                    onPress={() => setSelectedTurfId(tf.id)}
                    activeOpacity={0.8}
                  >
                    <Text style={[ov.turfChipText, { color: active ? t.bg : t.textSub }]} numberOfLines={1}>
                      {tf.name || "Turf"}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}

          {turfs.length === 0 ? (
            <View style={{ alignItems: "center", paddingVertical: 24, gap: 8 }}>
              <Ionicons name="football-outline" size={28} color={t.textSub} />
              <Text style={{ color: t.textSub, fontSize: 13, fontWeight: "600" }}>Add a turf to see its slots</Text>
            </View>
          ) : (
            <>
              {/* Occupancy bar (one turf) + counts */}
              <View style={{ marginTop: 14, gap: 8 }}>
                {activeTurfId !== "all" && slotSummary.total > 0 && (
                  <View style={ov.occBar}>
                    {slotSummary.booked  > 0 && <View style={{ flex: slotSummary.booked,  backgroundColor: slotColors("booked",  isDark, t).strip }} />}
                    {slotSummary.blocked > 0 && <View style={{ flex: slotSummary.blocked, backgroundColor: slotColors("blocked", isDark, t).strip }} />}
                    {slotSummary.free    > 0 && <View style={{ flex: slotSummary.free,    backgroundColor: slotColors("free",    isDark, t).strip }} />}
                    {slotSummary.past    > 0 && <View style={{ flex: slotSummary.past,    backgroundColor: slotColors("past",    isDark, t).strip }} />}
                  </View>
                )}
                <View style={ov.legend}>
                  {legend.map((l) => (
                    <View key={l.label} style={ov.legendItem}>
                      <View style={[ov.legendDot, { backgroundColor: l.color }]} />
                      <Text style={[ov.legendText, { color: t.textSub }]}>{l.label}</Text>
                    </View>
                  ))}
                </View>
              </View>

              {activeTurfId === "all" ? (
                /* ── All turfs: one strip row per turf ── */
                <View style={{ marginTop: 14, gap: 10 }}>
                  {turfs.map((tf) => (
                    <TurfStripRow
                      key={tf.id}
                      name={tf.name || "Turf"}
                      slots={slotsByTurf[tf.id] || []}
                      isDark={isDark}
                      t={t}
                      onPress={() => setSelectedTurfId(tf.id)}
                    />
                  ))}
                  <Text style={[ov.hint, { color: t.textSub }]}>Tap a turf to see its slots</Text>
                </View>
              ) : (
                /* ── One turf: tile grid ── */
                <View style={{ marginTop: 14 }}>
                  {(slotsByTurf[activeTurfId] || []).length === 0 ? (
                    <View style={{ alignItems: "center", paddingVertical: 20, gap: 6 }}>
                      <Ionicons name="time-outline" size={26} color={t.textSub} />
                      <Text style={{ color: t.textSub, fontSize: 13, fontWeight: "600" }}>
                        No slots for {activeTurf?.name || "this turf"} on this day
                      </Text>
                    </View>
                  ) : (
                    <>
                      <View style={ov.grid}>
                        {(slotsByTurf[activeTurfId] || []).map((slot) => (
                          <SlotTile key={slot.id} slot={slot} isDark={isDark} t={t} onPress={() => onSlotPress(slot)} />
                        ))}
                      </View>
                      <Text style={[ov.hint, { color: t.textSub, marginTop: 12 }]}>
                        Tap a free slot to block it · tap booked to see the booking
                      </Text>
                    </>
                  )}

                  <TouchableOpacity
                    style={[ov.addBtn, { backgroundColor: isDark ? "rgba(63,185,80,0.15)" : "#DCFCE7", borderColor: accent }]}
                    onPress={() => router.push({ pathname: "/(owner)/block-slots", params: { turfId: activeTurfId, date: selectedDateKey } } as any)}
                    activeOpacity={0.8}
                  >
                    <Ionicons name="lock-closed-outline" size={16} color={accent} />
                    <Text style={[ov.addBtnText, { color: accent }]}>Block Slots</Text>
                  </TouchableOpacity>
                </View>
              )}
            </>
          )}
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

        {/* ══ OWNER GUIDE ═════════════════════════════════════ */}
        <TouchableOpacity
          style={[ov.card, { backgroundColor: t.card, borderColor: t.border, marginHorizontal: 16, marginTop: 16, flexDirection: "row", alignItems: "center", gap: 14 }]}
          onPress={() => router.push("/(owner)/ownerguide" as any)}
          activeOpacity={0.8}
        >
          <View style={{ width: 46, height: 46, borderRadius: 14, backgroundColor: t.greenBg, justifyContent: "center", alignItems: "center" }}>
            <Ionicons name="book-outline" size={22} color={t.green} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: t.text, fontSize: 15, fontWeight: "800" }}>Owner Guide</Text>
            <Text style={{ color: t.textSub, fontSize: 11, fontWeight: "600", marginTop: 2 }}>
              Learn bookings, coins, block slots & settlements
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={t.textMuted} />
        </TouchableOpacity>
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
  subtitle:  { fontSize: 11, fontWeight: "600", marginTop: 2 },
  link:      { fontSize: 13, fontWeight: "800" },

  // dates
  dateRow:   { flexDirection: "row", gap: 8 },
  dateChip:  { width: 50, height: 64, borderRadius: 14, alignItems: "center", justifyContent: "center", borderWidth: 1 },
  dateDay:   { fontSize: 10, fontWeight: "800" },
  dateNum:   { fontSize: 19, fontWeight: "900", marginTop: 1 },
  dateMon:   { fontSize: 9, fontWeight: "700", marginTop: 1 },

  // turf filter
  turfChip:     { height: 34, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, justifyContent: "center", maxWidth: 160 },
  turfChipText: { fontSize: 12, fontWeight: "800" },

  // counts
  occBar:    { flexDirection: "row", height: 6, borderRadius: 3, overflow: "hidden", gap: 2 },
  legend:    { flexDirection: "row", flexWrap: "wrap", columnGap: 14, rowGap: 4 },
  legendItem:{ flexDirection: "row", alignItems: "center", gap: 5 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText:{ fontSize: 11, fontWeight: "700" },

  // one-turf grid
  grid:      { flexDirection: "row", flexWrap: "wrap", gap: GRID_GAP },
  tile:      { width: TILE_W, height: 54, borderRadius: 12, borderWidth: 1, alignItems: "center", justifyContent: "center", gap: 2 },
  tileTime:  { fontSize: 13, fontWeight: "800" },
  tileLabel: { fontSize: 10, fontWeight: "700" },

  // all-turfs rows
  turfRow:       { borderWidth: 1, borderRadius: 14, padding: 12, gap: 8 },
  turfRowHead:   { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  turfRowName:   { fontSize: 14, fontWeight: "800", flexShrink: 1 },
  turfRowCounts: { fontSize: 11, fontWeight: "700" },
  strip:         { flexDirection: "row" },
  stripSeg:      { flex: 1, height: 16, borderRadius: 4 },
  stripLabels:   { flexDirection: "row", justifyContent: "space-between" },
  stripLabel:    { fontSize: 9, fontWeight: "700" },

  hint:      { fontSize: 11, fontWeight: "600", textAlign: "center" },
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
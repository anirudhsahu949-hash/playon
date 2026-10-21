/**
 * schedule.tsx — Owner schedule (v2 design)
 * • Day view (default = today): step days with ‹ ›, open the month calendar
 *   with the calendar button. Each turf shows a "how full" label, a timeline
 *   bar, free times, and that day's bookings.
 * • Week view: 7 days × turfs as mini timelines. Tap a day to open it.
 * • List view: the old Today / 7 days / 60 days list, now with date headers.
 * • Tap any booking → details sheet (call, free slot, cancel series, receipt).
 * Data loading, free-slot and cancel-series logic are unchanged.
 */
import {
  View, Text, StyleSheet, SectionList, TouchableOpacity, Alert, ActivityIndicator,
  RefreshControl, StatusBar, ScrollView, Modal, Linking, LayoutAnimation, UIManager, Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { auth, db } from "../../firebaseConfig";
import { collection, getDocs, query, where, Timestamp, deleteDoc, doc, writeBatch } from "firebase/firestore";

// Route of your Block Slots screen — used by "Block or book a free time"
const BLOCK_SLOTS_ROUTE = "/(owner)/block-slots";

const DAYS_AHEAD = 60;
const DAY_MS = 86400000;

// ── Palette ─────────────────────────────────────────────────────────────────
const BRAND = "#15803D";
const ACCENT = "#16A34A";
const ACCENT_DARK = "#15803D";
const ACCENT_TINT = "#DCFCE7";
const ACCENT_BORDER = "#BBF7D0";
const ON_BRAND = "#DCFCE7";
const PAGE = "#F1F4F7";
const INK = "#0F172A";
const SLATE = "#475569";
const MUTED = "#64748B";
const FAINT = "#94A3B8";
const LINE = "#E5E7EB";
const FREE_BG = "#E8F5EC";

const KIND_STYLE = {
  online:  { label: "Online",  bar: "#3B82F6", tint: "#EFF6FF", text: "#1D4ED8", icon: "phone-portrait-outline" },
  offline: { label: "Offline", bar: "#6366F1", tint: "#EEF2FF", text: "#4338CA", icon: "people-outline" },
  blocked: { label: "Blocked", bar: "#EF4444", tint: "#FEF2F2", text: "#B91C1C", icon: "lock-closed-outline" },
} as const;

type Kind = keyof typeof KIND_STYLE;
type Filter = "all" | "online" | "offline" | "blocked" | "recurring";
type Range = "today" | "week" | "all";
type ViewMode = "day" | "week" | "list";

type Item = {
  id: string;
  kind: Kind;
  recurring: boolean;
  seriesId: string | null;
  seriesLabel: string;
  seriesIndex?: number;
  seriesTotal?: number;
  date: Date;
  turfId: string;
  turfName: string;
  startLabel: string;
  endLabel: string;
  mins: number;      // start, minutes (late slots +1440)
  endMins: number;   // end, minutes (late slots +1440)
  name: string;
  phone?: string;
  amount?: number;
  remaining?: number;
  note?: string;
};

// ── helpers ─────────────────────────────────────────────────────────────────
function toDate(v: any): Date | null {
  if (!v) return null;
  if (typeof v?.toDate === "function") return v.toDate();
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}
function dayStart(d: Date): number { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime(); }
function nowMinutes(): number { const n = new Date(); return n.getHours() * 60 + n.getMinutes(); }
function openOf(t: any): number { return Number(t?.openingTime ?? 6); }
function closeOf(t: any): number { const c = Number(t?.closingTime ?? 23); return c === 0 ? 24 : c; }
function partMins(s: string): number {
  const m = String(s || "").trim().match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)/i);
  if (!m) return 0;
  let h = Number(m[1]);
  const p = m[3].toUpperCase();
  if (p === "PM" && h !== 12) h += 12;
  if (p === "AM" && h === 12) h = 0;
  return h * 60 + Number(m[2] || 0);
}
function adjust(m: number, turf: any): number {
  if (!turf) return m;
  return closeOf(turf) > 24 && m < openOf(turf) * 60 ? m + 1440 : m;
}
function slotTimes(slots: string[], turf: any) {
  const first = String(slots[0] || "");
  const last = String(slots[slots.length - 1] || "");
  const startLabel = first.split(" - ")[0] || "—";
  const endLabel = last.split(" - ")[1] || "";
  const mins = adjust(partMins(startLabel), turf);
  let endMins = endLabel ? adjust(partMins(endLabel), turf) : mins + 60;
  if (endMins <= mins) endMins = 1440;
  return { startLabel, endLabel, mins, endMins };
}
function dayDiff(d: Date): number { return Math.round((dayStart(d) - dayStart(new Date())) / DAY_MS); }
function dayName(d: Date): string {
  const diff = dayDiff(d);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Last night";
  return d.toLocaleDateString("en-US", { weekday: "long" });
}
const fmtDay = (d: Date) => d.toLocaleDateString("en-US", { weekday: "short", day: "numeric", month: "short" });
/** minutes → "5", "5:30" (12-hour, no AM/PM) */
function hm(min: number): string {
  const x = ((min % 1440) + 1440) % 1440;
  const h = Math.floor(x / 60), m = x % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m ? `${h12}:${String(m).padStart(2, "0")}` : `${h12}`;
}
const per = (min: number) => ((((min % 1440) + 1440) % 1440) >= 720 ? "PM" : "AM");
const clockM = (min: number) => `${hm(min)} ${per(min)}`;
function rangeM(a: number, b: number): string {
  return `${hm(a)}${per(a) !== per(b) ? ` ${per(a)}` : ""}–${hm(b)} ${per(b)}`;
}
const hrsTxt = (mins: number) => {
  const h = Math.floor(mins / 60), m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
};
/** Merge overlapping [start,end) ranges */
function merge(r: [number, number][]): [number, number][] {
  const s = r.slice().sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  s.forEach(([a, b]) => {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b); else out.push([a, b]);
  });
  return out;
}
function loadLevel(f: number) {
  if (f <= 0) return { label: "Free all day", bg: ACCENT_TINT, fg: ACCENT_DARK, bar: "#22C55E" };
  if (f >= 0.75) return { label: "Almost full", bg: "#FEF2F2", fg: "#B91C1C", bar: "#EF4444" };
  if (f >= 0.4) return { label: "Busy", bg: "#FFFBEB", fg: "#B45309", bar: "#F59E0B" };
  return { label: "Mostly free", bg: "#F0FDF4", fg: ACCENT_DARK, bar: "#22C55E" };
}

// ─────────────────────────────────────────────────────────────────────────────
export default function OwnerSchedule() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [turfs, setTurfs] = useState<any[]>([]);
  const [bookings, setBookings] = useState<any[]>([]);
  const [blocks, setBlocks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);

  const [mode, setMode] = useState<ViewMode>("day");
  const [turfFilter, setTurfFilter] = useState<string>("all");
  const [selDay, setSelDay] = useState<number>(() => dayStart(new Date()));   // today by default
  const [calOpen, setCalOpen] = useState(false);                              // calendar hidden by default
  const [calMonth, setCalMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [weekStart, setWeekStart] = useState<number>(() => dayStart(new Date()));
  const [dayFilter, setDayFilter] = useState<"all" | Kind>("all");

  // list view
  const [range, setRange] = useState<Range>("today");
  const [filter, setFilter] = useState<Filter>("all");

  const [sheet, setSheet] = useState<Item | null>(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) UIManager.setLayoutAnimationEnabledExperimental(true);
  }, []);
  useEffect(() => { load(); }, []);
  useEffect(() => { const t = setInterval(() => setTick(x => x + 1), 60000); return () => clearInterval(t); }, []);

  const load = async (isRefresh = false) => {
    const uid = auth.currentUser?.uid;
    if (!uid) { setLoading(false); return; }
    isRefresh ? setRefreshing(true) : setLoading(true);
    try {
      const turfSnap = await getDocs(query(collection(db, "turfs"), where("ownerId", "==", uid)));
      const t = turfSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      setTurfs(t);
      if (t.length === 1) setTurfFilter(t[0].id);

      const from = new Date(); from.setDate(from.getDate() - 1); from.setHours(0, 0, 0, 0);
      let bookingDocs: any[] = [];
      try {
        const s = await getDocs(query(collection(db, "bookings"), where("ownerId", "==", uid), where("date", ">=", Timestamp.fromDate(from))));
        bookingDocs = s.docs.map(d => ({ id: d.id, ...d.data() }));
      } catch (e) {
        console.log("Schedule: create the Firestore index from this link ->", e);
        const s = await getDocs(query(collection(db, "bookings"), where("ownerId", "==", uid)));
        bookingDocs = s.docs.map(d => ({ id: d.id, ...d.data() }));
      }
      setBookings(bookingDocs);
      const blockSnap = await getDocs(query(collection(db, "blockedSlots"), where("ownerId", "==", uid)));
      setBlocks(blockSnap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch {
      Alert.alert("Error", "Could not load your schedule. Pull down to try again.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const turfMap = useMemo(() => { const m: Record<string, any> = {}; turfs.forEach(t => { m[t.id] = t; }); return m; }, [turfs]);

  // ── Day limits (yesterday only if a late-night turf is still open) ──
  const today = dayStart(new Date());
  const lateNow = turfs.some(t => closeOf(t) > 24 && nowMinutes() / 60 < closeOf(t) - 24);
  const minDay = lateNow ? today - DAY_MS : today;
  const maxDay = today + (DAYS_AHEAD - 1) * DAY_MS;

  // ── One list from bookings + blocks ──
  const items = useMemo<Item[]>(() => {
    const keep = (d: Date | null) => !!d && dayStart(d) >= minDay && dayStart(d) <= maxDay;
    const out: Item[] = [];
    bookings.forEach(b => {
      if (b.status === "cancelled") return;
      const d = toDate(b.dateString) ?? toDate(b.date);
      if (!keep(d)) return;
      const slots: string[] = Array.isArray(b.selectedSlots) && b.selectedSlots.length > 0 ? b.selectedSlots : [b.slotTime].filter(Boolean);
      out.push({
        id: b.id, kind: "online", recurring: false, seriesId: null, seriesLabel: "",
        date: d!, turfId: b.turfId, turfName: b.turfName || turfMap[b.turfId]?.name || "Turf",
        ...slotTimes(slots, turfMap[b.turfId]),
        name: b.userName || b.customerName || "Customer",
        phone: b.userPhone || b.phone || b.customerPhone || undefined,
        amount: Number(b.totalAmount ?? b.amount ?? b.totalPrice ?? NaN),
      });
    });
    blocks.forEach(x => {
      const d = toDate(x.date);
      if (!keep(d)) return;
      const slots: string[] = Array.isArray(x.slots) && x.slots.length > 0 ? x.slots : [x.slotTime].filter(Boolean);
      out.push({
        id: x.id, kind: x.type === "offline" ? "offline" : "blocked",
        recurring: !!x.isRecurring, seriesId: x.seriesId || null, seriesLabel: x.seriesLabel || "",
        seriesIndex: x.recurrenceIndex, seriesTotal: x.recurrenceTotal,
        date: d!, turfId: x.turfId, turfName: x.turfName || turfMap[x.turfId]?.name || "Turf",
        ...slotTimes(slots, turfMap[x.turfId]),
        name: x.customerName || x.reason || x.note || "",
        phone: x.customerPhone || undefined,
        amount: x.type === "offline" ? Number(x.amount ?? NaN) : undefined,
        remaining: x.type === "offline" ? Number(x.remainingAmount ?? NaN) : undefined,
        note: x.note || undefined,
      });
    });
    return out.sort((a, b) => dayStart(a.date) - dayStart(b.date) || a.mins - b.mins);
  }, [bookings, blocks, turfMap, minDay, maxDay]);

  const viewTurfs = useMemo(() => (turfFilter === "all" ? turfs : turfs.filter(t => t.id === turfFilter)), [turfs, turfFilter]);
  const byTurf = useMemo(() => items.filter(i => turfFilter === "all" || i.turfId === turfFilter), [items, turfFilter]);

  // Items by day for fast lookups
  const byDay = useMemo(() => {
    const m = new Map<number, Item[]>();
    byTurf.forEach(i => { const k = dayStart(i.date); if (!m.has(k)) m.set(k, []); m.get(k)!.push(i); });
    return m;
  }, [byTurf]);

  /** Booked minutes / open minutes for one turf on one day */
  function turfDay(turf: any, day: number) {
    const open = openOf(turf) * 60, close = closeOf(turf) * 60;
    const its = (byDay.get(day) || []).filter(i => i.turfId === turf.id);
    const busyR = merge(its.map(i => [Math.max(open, i.mins), Math.min(close, i.endMins)] as [number, number]).filter(r => r[1] > r[0]));
    const booked = busyR.reduce((a, r) => a + r[1] - r[0], 0);
    return { open, close, its, busyR, booked, total: Math.max(1, close - open) };
  }
  function dayLoad(day: number) {
    let b = 0, t = 0;
    viewTurfs.forEach(tf => { const x = turfDay(tf, day); b += x.booked; t += x.total; });
    return t ? b / t : 0;
  }

  function liveState(i: Item): "live" | "done" | null {
    const diff = dayDiff(i.date);
    if (diff > 0) return null;
    if (diff < -1) return "done";
    const now = nowMinutes() + (diff === -1 ? 1440 : 0);
    if (now >= i.endMins) return "done";
    if (now >= i.mins) return "live";
    return null;
  }

  // ── Actions ──
  const freeOne = (item: Item) => {
    const what = item.kind === "offline" ? "offline booking" : "block";
    Alert.alert(item.kind === "blocked" ? "Unblock this slot?" : "Free this slot?",
      `${item.startLabel} – ${item.endLabel} · ${dayName(item.date)}\nThis ${what} will be removed and the slot opens for booking.`, [
        { text: "Keep", style: "cancel" },
        {
          text: item.kind === "blocked" ? "Unblock" : "Free", style: "destructive", onPress: async () => {
            setBusy(true);
            try {
              await deleteDoc(doc(db, "blockedSlots", item.id));
              setBlocks(prev => prev.filter(x => x.id !== item.id));
              setSheet(null);
            } catch { Alert.alert("Error", "Could not free this slot."); }
            finally { setBusy(false); }
          },
        },
      ]);
  };

  const cancelSeries = (item: Item) => {
    if (!item.seriesId) return;
    const future = blocks.filter(x => { const d = toDate(x.date); return x.seriesId === item.seriesId && d && dayStart(d) >= today; });
    Alert.alert("Cancel recurring booking?",
      `${item.seriesLabel || item.name || "This series"}: all ${future.length} upcoming session${future.length !== 1 ? "s" : ""} will be freed. Past sessions stay in history.`, [
        { text: "Keep", style: "cancel" },
        {
          text: "Cancel series", style: "destructive", onPress: async () => {
            setBusy(true);
            try {
              const batch = writeBatch(db);
              future.forEach(x => batch.delete(doc(db, "blockedSlots", x.id)));
              await batch.commit();
              const ids = new Set(future.map(x => x.id));
              setBlocks(prev => prev.filter(x => !ids.has(x.id)));
              setSheet(null);
            } catch { Alert.alert("Error", "Could not cancel the series."); }
            finally { setBusy(false); }
          },
        },
      ]);
  };

  const openReceipt = (item: Item) => {
    setSheet(null);
    router.push({ pathname: "/(owner)/booking-receipt/[id]", params: { id: item.id } } as any);
  };
  const callPhone = (phone?: string) => {
    if (!phone) return;
    Linking.openURL(`tel:${phone}`).catch(() => Alert.alert("Can't call", "Your phone could not start the call."));
  };
  const openBlockSlots = (turfId: string, day: number) =>
    router.push({ pathname: BLOCK_SLOTS_ROUTE, params: { turfId, date: new Date(day).toDateString() } } as any);

  // ── Day navigation ──
  const goDay = (d: number) => {
    const c = Math.min(maxDay, Math.max(minDay, d));
    setSelDay(c);
    const dd = new Date(c);
    setCalMonth(new Date(dd.getFullYear(), dd.getMonth(), 1));
  };
  const toggleCal = () => { LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); setCalOpen(o => !o); };

  // ── Loading ──
  if (loading) {
    return (
      <View style={s.center}>
        <StatusBar barStyle="dark-content" />
        <ActivityIndicator size="large" color={ACCENT} />
        <Text style={s.loadTxt}>Loading schedule…</Text>
      </View>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Shared pieces
  // ═══════════════════════════════════════════════════════════════════════════
  const header = (
    <View style={[s.header, { paddingTop: insets.top + 10 }]}>
      <View style={s.headerRow}>
        <TouchableOpacity style={s.backBtn} onPress={() => router.back()} accessibilityLabel="Back">
          <Ionicons name="arrow-back" size={20} color="#fff" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={s.hKicker}>SLOT PANEL</Text>
          <Text style={s.hTitle}>Schedule</Text>
        </View>
        <TouchableOpacity style={[s.backBtn, { backgroundColor: "transparent" }]} onPress={() => load(true)} accessibilityLabel="Refresh">
          <Ionicons name="refresh" size={20} color={ON_BRAND} />
        </TouchableOpacity>
      </View>
      <View style={s.modeSeg}>
        {(["day", "week", "list"] as ViewMode[]).map(m => {
          const on = mode === m;
          return (
            <TouchableOpacity key={m} style={[s.modeBtn, on && s.modeBtnOn]} onPress={() => setMode(m)} accessibilityState={{ selected: on }}>
              <Text style={[s.modeTxt, on && { color: INK }]}>{m === "day" ? "Day" : m === "week" ? "Week" : "List"}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );

  const turfChips = turfs.length > 1 && (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
      {[...turfs, { id: "all", name: "All turfs" }].map((t: any) => {
        const on = turfFilter === t.id;
        return (
          <TouchableOpacity key={t.id} style={[s.turfChip, on && s.turfChipOn]} onPress={() => setTurfFilter(t.id)}>
            <Text style={[s.turfChipTxt, on && { color: "#fff" }]} numberOfLines={1}>{t.name || "Turf"}</Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );

  const bookingCard = (item: Item, showTurf: boolean) => {
    const k = KIND_STYLE[item.kind];
    const st = liveState(item);
    const title = item.seriesLabel || item.name || (item.kind === "blocked" ? "Blocked by you" : "Customer");
    return (
      <TouchableOpacity key={`${item.kind}-${item.id}`} activeOpacity={0.8} onPress={() => setSheet(item)}
        style={[s.card, st === "done" && { opacity: 0.55 }, st === "live" && s.cardLive]}>
        <View style={s.timeCol}>
          <Text style={s.timeStart}>{hm(item.mins)}</Text>
          <Text style={s.timeAmPm}>{per(item.mins)}</Text>
          <View style={[s.timeLine, { backgroundColor: k.bar }]} />
          <Text style={s.timeEnd}>– {clockM(item.endMins)}</Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={s.rowTop}>
            <Text style={s.cardTitle} numberOfLines={1}>{title}</Text>
            {st === "live" && <View style={s.livePill}><View style={s.liveDot} /><Text style={s.liveTxt}>LIVE</Text></View>}
            {st === "done" && <Text style={s.doneTxt}>Done</Text>}
          </View>
          <View style={s.pillRow}>
            <View style={[s.pill, { backgroundColor: k.tint }]}><Text style={[s.pillTxt, { color: k.text }]}>{k.label}</Text></View>
            {item.recurring && (
              <View style={[s.pill, { backgroundColor: "#ECFDF5" }]}>
                <Ionicons name="repeat" size={10} color="#047857" />
                <Text style={[s.pillTxt, { color: "#047857" }]}>Recurring</Text>
              </View>
            )}
            <View style={[s.pill, { backgroundColor: "#F1F5F9" }]}><Text style={[s.pillTxt, { color: SLATE }]}>{hrsTxt(item.endMins - item.mins)}</Text></View>
            {showTurf && <View style={[s.pill, { backgroundColor: "#F1F5F9" }]}><Text style={[s.pillTxt, { color: SLATE }]} numberOfLines={1}>{item.turfName}</Text></View>}
          </View>
        </View>
        <Ionicons name="chevron-forward" size={16} color={FAINT} style={{ alignSelf: "center" }} />
      </TouchableOpacity>
    );
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // DAY VIEW
  // ═══════════════════════════════════════════════════════════════════════════
  const renderDay = () => {
    const d = new Date(selDay);
    const dayItems = (byDay.get(selDay) || []);
    const shown = dayItems.filter(i => dayFilter === "all" || i.kind === dayFilter);
    const canPrev = selDay > minDay, canNext = selDay < maxDay;
    const isTodaySel = selDay === today;
    const isPastDay = selDay < today;
    const showTurfPill = viewTurfs.length > 1;

    // calendar
    const y = calMonth.getFullYear(), m = calMonth.getMonth();
    const lead = (new Date(y, m, 1).getDay() + 6) % 7;
    const total = new Date(y, m + 1, 0).getDate();
    const cells: (number | null)[] = Array(lead).fill(null);
    for (let n = 1; n <= total; n++) cells.push(new Date(y, m, n).getTime());
    while (cells.length % 7) cells.push(null);
    const calPrev = new Date(y, m, 0).getTime() >= minDay;
    const calNext = new Date(y, m + 1, 1).getTime() <= maxDay;

    return (
      <ScrollView contentContainerStyle={{ padding: 14, gap: 10, paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={ACCENT} colors={[ACCENT]} />}>
        {turfChips}

        {/* Date bar + calendar toggle */}
        <View style={s.card2}>
          <View style={s.rowCenter}>
            <TouchableOpacity style={[s.sqBtn, !canPrev && { opacity: 0.3 }]} disabled={!canPrev} onPress={() => goDay(selDay - DAY_MS)} accessibilityLabel="Previous day">
              <Ionicons name="chevron-back" size={18} color={INK} />
            </TouchableOpacity>
            <View style={{ flex: 1, alignItems: "center" }}>
              <Text style={s.dateTitle}>{fmtDay(d)}</Text>
              <Text style={s.dateSub}>{dayName(d)}</Text>
            </View>
            <TouchableOpacity style={[s.sqBtn, !canNext && { opacity: 0.3 }]} disabled={!canNext} onPress={() => goDay(selDay + DAY_MS)} accessibilityLabel="Next day">
              <Ionicons name="chevron-forward" size={18} color={INK} />
            </TouchableOpacity>
            <TouchableOpacity style={[s.sqBtn, calOpen && { backgroundColor: ACCENT_DARK, borderColor: ACCENT_DARK }]} onPress={toggleCal}
              accessibilityLabel={calOpen ? "Hide calendar" : "Open calendar"}>
              <Ionicons name="calendar-outline" size={18} color={calOpen ? "#fff" : ACCENT_DARK} />
            </TouchableOpacity>
          </View>
          {!isTodaySel && (
            <TouchableOpacity style={s.todayLink} onPress={() => goDay(today)}>
              <Ionicons name="return-up-back" size={14} color={ACCENT_DARK} />
              <Text style={s.todayLinkTxt}>Back to today</Text>
            </TouchableOpacity>
          )}

          {calOpen && (
            <View style={s.calWrap}>
              <View style={s.calHead}>
                <TouchableOpacity style={[s.sqBtn, !calPrev && { opacity: 0.3 }]} disabled={!calPrev} onPress={() => setCalMonth(new Date(y, m - 1, 1))} accessibilityLabel="Previous month">
                  <Ionicons name="chevron-back" size={18} color={INK} />
                </TouchableOpacity>
                <Text style={s.calTitle}>{calMonth.toLocaleDateString("en-US", { month: "long", year: "numeric" })}</Text>
                <TouchableOpacity style={[s.sqBtn, !calNext && { opacity: 0.3 }]} disabled={!calNext} onPress={() => setCalMonth(new Date(y, m + 1, 1))} accessibilityLabel="Next month">
                  <Ionicons name="chevron-forward" size={18} color={INK} />
                </TouchableOpacity>
              </View>
              <View style={s.calGrid}>
                {["M", "T", "W", "T", "F", "S", "S"].map((w, i) => <Text key={`w${i}`} style={s.calWeek}>{w}</Text>)}
              </View>
              <View style={s.calGrid}>
                {cells.map((t, i) => {
                  if (t === null) return <View key={`b${i}`} style={s.calCell} />;
                  const off = t < minDay || t > maxDay;
                  const sel = t === selDay;
                  const f = off ? 0 : dayLoad(t);
                  const lv = loadLevel(f);
                  return (
                    <TouchableOpacity key={t} style={s.calCell} disabled={off} onPress={() => { goDay(t); toggleCal(); }}
                      accessibilityLabel={`${fmtDay(new Date(t))}, ${Math.round(f * 100)}% booked`} accessibilityState={{ selected: sel, disabled: off }}>
                      <View style={[s.calDay, sel && s.calDaySel, off && { opacity: 0.35 }]}>
                        <View style={[s.calNum, t === today && { backgroundColor: ACCENT_DARK }]}>
                          <Text style={[s.calNumTxt, t === today && { color: "#fff" }]}>{new Date(t).getDate()}</Text>
                        </View>
                        <View style={s.meter}><View style={{ height: 4, width: `${Math.round(f * 100)}%`, backgroundColor: lv.bar }} /></View>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <View style={s.legendRow}>
                <LegendBar color="#22C55E" text="Mostly free" />
                <LegendBar color="#F59E0B" text="Busy" />
                <LegendBar color="#EF4444" text="Almost full" />
              </View>
            </View>
          )}
        </View>

        {/* One panel per turf in view */}
        {viewTurfs.map(tf => {
          const x = turfDay(tf, selDay);
          const f = x.booked / x.total;
          const lv = loadLevel(f);
          // timeline segments
          const segs: { flex: number; color: string }[] = [];
          let cur = x.open;
          x.its.slice().sort((a, b) => a.mins - b.mins).forEach(i => {
            const a = Math.max(x.open, i.mins), b = Math.min(x.close, i.endMins);
            if (b <= cur) return;
            if (a > cur) segs.push({ flex: a - cur, color: FREE_BG });
            segs.push({ flex: b - Math.max(a, cur), color: KIND_STYLE[i.kind].bar });
            cur = b;
          });
          if (cur < x.close) segs.push({ flex: x.close - cur, color: FREE_BG });
          // free gaps (from now on today)
          const startFrom = isTodaySel ? Math.max(x.open, Math.ceil(nowMinutes() / 30) * 30) : x.open;
          const gaps: [number, number][] = [];
          if (!isPastDay) {
            let g = startFrom;
            x.busyR.forEach(([a, b]) => { if (b <= g) return; if (a > g) gaps.push([g, a]); g = Math.max(g, b); });
            if (g < x.close) gaps.push([g, x.close]);
          }
          const freeMins = gaps.reduce((a, r) => a + r[1] - r[0], 0);
          const mid = Math.round((x.open + x.close) / 2 / 60) * 60;
          return (
            <View key={tf.id} style={s.card2}>
              <View style={s.rowCenter}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={s.panelTitle} numberOfLines={1}>{tf.name || "Turf"}</Text>
                  <Text style={s.panelSub}>Open {clockM(x.open)} – {clockM(x.close)}</Text>
                </View>
                <View style={[s.verdict, { backgroundColor: lv.bg }]}><Text style={[s.verdictTxt, { color: lv.fg }]}>{lv.label}</Text></View>
              </View>

              <View style={s.timeline}>
                {segs.map((g, i) => <View key={i} style={{ flex: g.flex, backgroundColor: g.color }} />)}
              </View>
              <View style={s.axisRow}>
                <Text style={s.axis}>{clockM(x.open)}</Text>
                <Text style={s.axis}>{clockM(mid)}</Text>
                <Text style={s.axis}>{clockM(x.close)}</Text>
              </View>

              <View style={s.statRow}>
                <MiniStat n={isPastDay ? "—" : hrsTxt(freeMins)} label={isTodaySel ? "free from now" : "free"} bg="#F0FDF4" fg={ACCENT_DARK} />
                <MiniStat n={String(x.its.filter(i => i.kind === "online").length)} label="online" bg={KIND_STYLE.online.tint} fg={KIND_STYLE.online.text} />
                <MiniStat n={String(x.its.filter(i => i.kind === "offline").length)} label="offline" bg={KIND_STYLE.offline.tint} fg={KIND_STYLE.offline.text} />
                <MiniStat n={String(x.its.filter(i => i.kind === "blocked").length)} label="blocked" bg={KIND_STYLE.blocked.tint} fg={KIND_STYLE.blocked.text} />
              </View>

              {!isPastDay && (
                <View style={{ marginTop: 12 }}>
                  <Text style={s.kicker}>FREE TIMES</Text>
                  {gaps.length === 0 ? (
                    <Text style={s.fullTxt}>No free time left on this day.</Text>
                  ) : (
                    <View style={s.gapWrap}>
                      {gaps.map(([a, b]) => (
                        <View key={a} style={s.gapChip}><Text style={s.gapTxt}>{rangeM(a, b)}</Text></View>
                      ))}
                    </View>
                  )}
                  {gaps.length > 0 && (
                    <TouchableOpacity style={s.blockBtn} onPress={() => openBlockSlots(tf.id, selDay)}>
                      <Text style={s.blockBtnTxt}>+ Block or book a free time</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}
            </View>
          );
        })}

        {/* Bookings */}
        <View style={[s.rowCenter, { marginTop: 6 }]}>
          <Text style={[s.sectionTitle, { flex: 1 }]}>BOOKINGS · {dayItems.length}</Text>
          {(["all", "online", "offline", "blocked"] as const).map(f => {
            const on = dayFilter === f;
            return (
              <TouchableOpacity key={f} style={[s.smallChip, on && s.smallChipOn]} onPress={() => setDayFilter(f)}>
                <Text style={[s.smallChipTxt, on && { color: "#fff" }]}>{f === "all" ? "All" : KIND_STYLE[f].label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        {shown.length === 0 ? (
          <View style={s.emptyCard}>
            <Text style={s.emptyTitle}>{dayItems.length === 0 ? "Turf is free all day" : "Nothing in this filter"}</Text>
            <Text style={s.emptySub}>{dayItems.length === 0 ? "No bookings or blocks on this date." : "Try another filter."}</Text>
          </View>
        ) : shown.map(i => bookingCard(i, showTurfPill))}
      </ScrollView>
    );
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // WEEK VIEW
  // ═══════════════════════════════════════════════════════════════════════════
  const renderWeek = () => {
    const days = Array.from({ length: 7 }, (_, i) => weekStart + i * DAY_MS).filter(d => d <= maxDay);
    const canPrev = weekStart > minDay;
    const canNext = weekStart + 7 * DAY_MS <= maxDay;
    let weekBooked = 0;
    days.forEach(d => viewTurfs.forEach(tf => { weekBooked += turfDay(tf, d).booked; }));
    const last = days[days.length - 1];
    return (
      <ScrollView contentContainerStyle={{ padding: 14, gap: 10, paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={ACCENT} colors={[ACCENT]} />}>
        {turfChips}
        <View style={[s.card2, s.rowCenter]}>
          <TouchableOpacity style={[s.sqBtn, !canPrev && { opacity: 0.3 }]} disabled={!canPrev}
            onPress={() => setWeekStart(Math.max(minDay, weekStart - 7 * DAY_MS))} accessibilityLabel="Previous week">
            <Ionicons name="chevron-back" size={18} color={INK} />
          </TouchableOpacity>
          <View style={{ flex: 1, alignItems: "center" }}>
            <Text style={s.dateTitle}>{fmtDay(new Date(days[0]))} – {fmtDay(new Date(last))}</Text>
            <Text style={s.dateSub}>{viewTurfs.length} turf{viewTurfs.length === 1 ? "" : "s"} · {hrsTxt(weekBooked)} booked</Text>
          </View>
          <TouchableOpacity style={[s.sqBtn, !canNext && { opacity: 0.3 }]} disabled={!canNext}
            onPress={() => setWeekStart(weekStart + 7 * DAY_MS)} accessibilityLabel="Next week">
            <Ionicons name="chevron-forward" size={18} color={INK} />
          </TouchableOpacity>
        </View>
        <View style={s.legendRow}>
          <LegendBox color={KIND_STYLE.online.bar} text="Online" />
          <LegendBox color={KIND_STYLE.offline.bar} text="Offline" />
          <LegendBox color={KIND_STYLE.blocked.bar} text="Blocked" />
          <LegendBox color={FREE_BG} text="Free" border />
        </View>
        {days.map(d => {
          const dd = new Date(d);
          const isT = d === today;
          return (
            <TouchableOpacity key={d} style={s.card2} activeOpacity={0.8} onPress={() => { goDay(d); setMode("day"); }}>
              <View style={[s.rowCenter, { alignItems: "flex-start" }]}>
                <View style={[s.weekBadge, isT && { backgroundColor: ACCENT_DARK }]}>
                  <Text style={[s.weekDow, isT && { color: "#fff" }]}>{dd.toLocaleDateString("en-US", { weekday: "short" }).toUpperCase()}</Text>
                  <Text style={[s.weekNum, isT && { color: "#fff" }]}>{dd.getDate()}</Text>
                </View>
                <View style={{ flex: 1, gap: 8 }}>
                  {viewTurfs.map(tf => {
                    const x = turfDay(tf, d);
                    let cur = x.open;
                    const segs: { flex: number; color: string }[] = [];
                    x.its.slice().sort((a, b) => a.mins - b.mins).forEach(i => {
                      const a = Math.max(x.open, i.mins), b = Math.min(x.close, i.endMins);
                      if (b <= cur) return;
                      if (a > cur) segs.push({ flex: a - cur, color: FREE_BG });
                      segs.push({ flex: b - Math.max(a, cur), color: KIND_STYLE[i.kind].bar });
                      cur = b;
                    });
                    if (cur < x.close) segs.push({ flex: x.close - cur, color: FREE_BG });
                    return (
                      <View key={tf.id}>
                        <View style={s.weekRowTop}>
                          <Text style={s.weekTurf} numberOfLines={1}>{tf.name || "Turf"}</Text>
                          <Text style={s.weekFree}>{x.booked === 0 ? "Free all day" : `${hrsTxt(x.total - x.booked)} free`}</Text>
                        </View>
                        <View style={s.weekBar}>{segs.map((g, i) => <View key={i} style={{ flex: g.flex, backgroundColor: g.color }} />)}</View>
                      </View>
                    );
                  })}
                </View>
              </View>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    );
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // LIST VIEW (old range list, now with date headers)
  // ═══════════════════════════════════════════════════════════════════════════
  const inRangeFn = (i: Item, r: Range) => {
    const diff = dayDiff(i.date);
    if (r === "today") return diff <= 0;
    if (r === "week") return diff <= 6;
    return true;
  };
  const renderList = () => {
    const rangeCounts = { today: byTurf.filter(i => inRangeFn(i, "today")).length, week: byTurf.filter(i => inRangeFn(i, "week")).length, all: byTurf.length };
    const inView = byTurf.filter(i => inRangeFn(i, range));
    const counts = {
      all: inView.length,
      online: inView.filter(i => i.kind === "online").length,
      offline: inView.filter(i => i.kind === "offline").length,
      blocked: inView.filter(i => i.kind === "blocked").length,
      recurring: inView.filter(i => i.recurring).length,
    };
    const visible = inView.filter(i => (filter === "all" ? true : filter === "recurring" ? i.recurring : i.kind === filter));
    const map = new Map<number, Item[]>();
    visible.forEach(i => { const k = dayStart(i.date); if (!map.has(k)) map.set(k, []); map.get(k)!.push(i); });
    const sections = Array.from(map.entries()).map(([k, data]) => ({ day: new Date(k), data }));
    const RANGES: { key: Range; label: string }[] = [{ key: "today", label: "Today" }, { key: "week", label: "7 days" }, { key: "all", label: `${DAYS_AHEAD} days` }];
    const FILTERS: { key: Filter; label: string; dot?: string }[] = [
      { key: "all", label: "All" },
      { key: "online", label: "Online", dot: KIND_STYLE.online.bar },
      { key: "offline", label: "Offline", dot: KIND_STYLE.offline.bar },
      { key: "blocked", label: "Blocked", dot: KIND_STYLE.blocked.bar },
      { key: "recurring", label: "Recurring", dot: "#059669" },
    ];
    return (
      <SectionList
        sections={sections}
        keyExtractor={i => `${i.kind}-${i.id}`}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={ACCENT} colors={[ACCENT]} />}
        ListHeaderComponent={
          <View style={{ padding: 14, paddingBottom: 4, gap: 10 }}>
            {turfChips}
            <View style={s.rangeSeg}>
              {RANGES.map(r => {
                const on = range === r.key;
                return (
                  <TouchableOpacity key={r.key} style={[s.rangeBtn, on && s.rangeBtnOn]} onPress={() => setRange(r.key)}>
                    <Text style={[s.rangeTxt, on && { color: "#fff" }]}>{r.label}</Text>
                    <View style={[s.rangeCount, on && { backgroundColor: "rgba(255,255,255,0.25)" }]}>
                      <Text style={[s.rangeCountTxt, on && { color: "#fff" }]}>{rangeCounts[r.key]}</Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {FILTERS.map(f => {
                const on = filter === f.key;
                return (
                  <TouchableOpacity key={f.key} style={[s.chip, on && s.chipOn]} onPress={() => setFilter(f.key)}>
                    {!!f.dot && <View style={[s.dot, { backgroundColor: on ? "#fff" : f.dot }]} />}
                    <Text style={[s.chipTxt, on && { color: "#fff" }]}>{f.label}</Text>
                    <Text style={[s.chipCount, on && { color: "rgba(255,255,255,0.85)" }]}>{counts[f.key]}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        }
        renderSectionHeader={({ section }) => {
          const d = section.day as Date;
          const isT = dayDiff(d) === 0;
          return (
            <View style={s.dayHead}>
              <View style={[s.weekBadge, isT && { backgroundColor: ACCENT_DARK }]}>
                <Text style={[s.weekDow, isT && { color: "#fff" }]}>{d.toLocaleDateString("en-US", { weekday: "short" }).toUpperCase()}</Text>
                <Text style={[s.weekNum, isT && { color: "#fff" }]}>{d.getDate()}</Text>
              </View>
              <View>
                <Text style={s.dayHeadName}>{dayName(d)}</Text>
                <Text style={s.dayHeadSub}>{d.toLocaleDateString("en-US", { day: "numeric", month: "long" })} · {section.data.length} item{section.data.length === 1 ? "" : "s"}</Text>
              </View>
            </View>
          );
        }}
        renderItem={({ item }) => <View style={{ paddingHorizontal: 14 }}>{bookingCard(item, turfs.length > 1)}</View>}
        ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
        ListEmptyComponent={
          <View style={s.empty}>
            <View style={s.emptyIcon}><Ionicons name={range === "today" ? "sunny-outline" : "calendar-outline"} size={28} color={ACCENT} /></View>
            <Text style={s.emptyTitle}>{range === "today" ? "Nothing booked today" : "Nothing scheduled"}</Text>
            <Text style={s.emptySub}>
              {range === "today" ? "Your turf is free all day. Check what's coming up next." : `Bookings and blocks for the next ${range === "week" ? 7 : DAYS_AHEAD} days show up here.`}
            </Text>
            {range !== "all" && (
              <TouchableOpacity style={s.emptyBtn} onPress={() => setRange(range === "today" ? "week" : "all")}>
                <Text style={s.emptyBtnTxt}>{range === "today" ? "See next 7 days" : `See next ${DAYS_AHEAD} days`}</Text>
              </TouchableOpacity>
            )}
          </View>
        }
      />
    );
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // BOOKING SHEET
  // ═══════════════════════════════════════════════════════════════════════════
  const renderSheet = () => {
    const it = sheet;
    if (!it) return null;
    const k = KIND_STYLE[it.kind];
    const st = liveState(it);
    const title = it.seriesLabel || it.name || (it.kind === "blocked" ? "Blocked by you" : "Customer");
    const hasAmt = typeof it.amount === "number" && !isNaN(it.amount);
    const hasRem = typeof it.remaining === "number" && !isNaN(it.remaining);
    return (
      <View style={[s.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}>
        <View style={s.grabber} />
        <View style={[s.rowCenter, { alignItems: "flex-start", gap: 12 }]}>
          <View style={[s.sheetIcon, { backgroundColor: k.tint }]}><Ionicons name={k.icon as any} size={22} color={k.text} /></View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={s.sheetTitle} numberOfLines={2}>{title}</Text>
            <Text style={s.sheetSub}>{rangeM(it.mins, it.endMins)} · {fmtDay(it.date)} · {it.turfName}</Text>
            <View style={s.pillRow}>
              <View style={[s.pill, { backgroundColor: k.tint }]}><Text style={[s.pillTxt, { color: k.text }]}>{k.label}</Text></View>
              {it.recurring && (
                <View style={[s.pill, { backgroundColor: "#ECFDF5" }]}>
                  <Ionicons name="repeat" size={10} color="#047857" />
                  <Text style={[s.pillTxt, { color: "#047857" }]}>{it.seriesIndex && it.seriesTotal ? `Session ${it.seriesIndex} of ${it.seriesTotal}` : "Recurring"}</Text>
                </View>
              )}
              <View style={[s.pill, { backgroundColor: "#F1F5F9" }]}><Text style={[s.pillTxt, { color: SLATE }]}>{hrsTxt(it.endMins - it.mins)}</Text></View>
              {st === "live" && <View style={[s.pill, { backgroundColor: ACCENT_TINT }]}><Text style={[s.pillTxt, { color: ACCENT_DARK }]}>● LIVE now</Text></View>}
            </View>
          </View>
        </View>

        {it.kind !== "blocked" && (
          <View style={s.infoBox}>
            <View style={{ flex: 1 }}>
              <Text style={s.kicker}>CUSTOMER</Text>
              <Text style={s.infoVal}>{it.name || "Customer"}{it.phone ? ` · ${it.phone}` : ""}</Text>
            </View>
            {!!it.phone && (
              <TouchableOpacity style={s.callBtn} onPress={() => callPhone(it.phone)}>
                <Ionicons name="call-outline" size={15} color={INK} />
                <Text style={s.callTxt}>Call</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {(hasAmt || hasRem) && (
          <View style={s.row2}>
            {hasAmt && (
              <View style={[s.infoBox, { flex: 1, flexDirection: "column", alignItems: "flex-start" }]}>
                <Text style={s.kicker}>AMOUNT</Text>
                <Text style={s.infoBig}>₹{it.amount!.toLocaleString("en-IN")}</Text>
              </View>
            )}
            {hasRem && (
              <View style={[s.infoBox, { flex: 1, flexDirection: "column", alignItems: "flex-start", backgroundColor: "#FFF7ED" }]}>
                <Text style={[s.kicker, { color: "#C2410C" }]}>TO COLLECT</Text>
                <Text style={[s.infoBig, { color: "#9A3412" }]}>₹{it.remaining!.toLocaleString("en-IN")}</Text>
              </View>
            )}
          </View>
        )}

        {!!it.note && it.kind !== "blocked" && <Text style={s.noteTxt}>“{it.note}”</Text>}

        {it.kind === "online" ? (
          <TouchableOpacity style={s.primaryBtn} onPress={() => openReceipt(it)}>
            <Ionicons name="receipt-outline" size={17} color="#fff" />
            <Text style={s.primaryTxt}>View receipt</Text>
          </TouchableOpacity>
        ) : st !== "done" ? (
          <View style={s.row2}>
            <TouchableOpacity style={[s.dangerBtn, { flex: 1 }]} onPress={() => freeOne(it)} disabled={busy}>
              <Text style={s.dangerTxt}>{it.kind === "blocked" ? "Unblock slot" : "Free this slot"}</Text>
            </TouchableOpacity>
            {it.recurring && it.seriesId && (
              <TouchableOpacity style={[s.ghostBtn, { flex: 1 }]} onPress={() => cancelSeries(it)} disabled={busy}>
                <Text style={s.ghostTxt}>Cancel series</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : null}

        <TouchableOpacity style={s.closeBtn} onPress={() => setSheet(null)}>
          <Text style={s.closeTxt}>Close</Text>
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <View style={s.root}>
      <StatusBar barStyle="light-content" backgroundColor={BRAND} />
      {header}
      {mode === "day" ? renderDay() : mode === "week" ? renderWeek() : renderList()}

      <Modal visible={!!sheet} transparent animationType="slide" onRequestClose={() => setSheet(null)} statusBarTranslucent>
        <View style={s.backdrop}>
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => setSheet(null)} />
          {renderSheet()}
        </View>
      </Modal>

      {busy && (
        <View style={s.busy}>
          <View style={s.busyCard}><ActivityIndicator color={ACCENT} /><Text style={s.busyTxt}>Updating…</Text></View>
        </View>
      )}
    </View>
  );
}

// ── Small components ────────────────────────────────────────────────────────
function MiniStat({ n, label, bg, fg }: { n: string; label: string; bg: string; fg: string }) {
  return (
    <View style={[s.miniStat, { backgroundColor: bg }]}>
      <Text style={[s.miniNum, { color: fg }]} numberOfLines={1} adjustsFontSizeToFit>{n}</Text>
      <Text style={s.miniLbl} numberOfLines={1}>{label}</Text>
    </View>
  );
}
function LegendBar({ color, text }: { color: string; text: string }) {
  return (
    <View style={s.legendItem}><View style={{ width: 14, height: 4, borderRadius: 2, backgroundColor: color }} /><Text style={s.legendTxt}>{text}</Text></View>
  );
}
function LegendBox({ color, text, border }: { color: string; text: string; border?: boolean }) {
  return (
    <View style={s.legendItem}>
      <View style={[{ width: 10, height: 10, borderRadius: 3, backgroundColor: color }, border && { borderWidth: 1, borderColor: ACCENT_BORDER }]} />
      <Text style={s.legendTxt}>{text}</Text>
    </View>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────
const shadow = { shadowColor: INK, shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 2 }, elevation: 2 };

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: PAGE },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: PAGE },
  loadTxt: { marginTop: 12, color: MUTED, fontSize: 15, fontWeight: "600" },

  header: { backgroundColor: BRAND, paddingHorizontal: 16, paddingBottom: 14, borderBottomLeftRadius: 22, borderBottomRightRadius: 22, gap: 12 },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  backBtn: { width: 44, height: 44, borderRadius: 13, backgroundColor: "rgba(255,255,255,0.14)", alignItems: "center", justifyContent: "center" },
  hKicker: { fontSize: 10, letterSpacing: 1.4, fontWeight: "800", color: ON_BRAND },
  hTitle: { fontSize: 20, fontWeight: "900", color: "#fff" },
  modeSeg: { flexDirection: "row", backgroundColor: "rgba(0,0,0,0.16)", borderRadius: 12, padding: 3 },
  modeBtn: { flex: 1, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  modeBtnOn: { backgroundColor: "#fff" },
  modeTxt: { fontSize: 13, fontWeight: "800", color: ON_BRAND },

  turfChip: { height: 38, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: LINE, backgroundColor: "#fff", justifyContent: "center", maxWidth: 180 },
  turfChipOn: { backgroundColor: ACCENT_DARK, borderColor: ACCENT_DARK },
  turfChipTxt: { fontSize: 13, fontWeight: "800", color: "#334155" },

  card2: { backgroundColor: "#fff", borderRadius: 18, padding: 14, ...shadow },
  rowCenter: { flexDirection: "row", alignItems: "center", gap: 8 },
  row2: { flexDirection: "row", gap: 8 },
  sqBtn: { width: 44, height: 44, borderRadius: 12, borderWidth: 1, borderColor: LINE, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" },
  dateTitle: { fontSize: 16, fontWeight: "900", color: INK },
  dateSub: { fontSize: 12, fontWeight: "700", color: MUTED, marginTop: 1 },
  todayLink: { flexDirection: "row", alignItems: "center", gap: 5, alignSelf: "center", marginTop: 10, paddingHorizontal: 12, height: 32, borderRadius: 999, backgroundColor: "#F0FDF4" },
  todayLinkTxt: { fontSize: 12.5, fontWeight: "800", color: ACCENT_DARK },

  calWrap: { borderTopWidth: 1, borderTopColor: "#EEF1F5", marginTop: 12, paddingTop: 12 },
  calHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 },
  calTitle: { fontSize: 15, fontWeight: "900", color: INK },
  calGrid: { flexDirection: "row", flexWrap: "wrap" },
  calWeek: { width: "14.2857%", textAlign: "center", fontSize: 11, fontWeight: "800", color: MUTED, paddingVertical: 4 },
  calCell: { width: "14.2857%", height: 52, alignItems: "center", justifyContent: "center" },
  calDay: { width: 44, height: 48, borderRadius: 12, alignItems: "center", justifyContent: "center", gap: 4 },
  calDaySel: { backgroundColor: "#F0FDF4", borderWidth: 1.5, borderColor: ACCENT },
  calNum: { minWidth: 26, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center", paddingHorizontal: 3 },
  calNumTxt: { fontSize: 14, fontWeight: "800", color: INK },
  meter: { width: 24, height: 4, borderRadius: 2, backgroundColor: "#E6EAF0", overflow: "hidden" },
  legendRow: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 8 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  legendTxt: { fontSize: 11, fontWeight: "700", color: SLATE },

  panelTitle: { fontSize: 16, fontWeight: "900", color: INK },
  panelSub: { fontSize: 12, fontWeight: "600", color: MUTED, marginTop: 1 },
  verdict: { height: 28, paddingHorizontal: 11, borderRadius: 999, justifyContent: "center" },
  verdictTxt: { fontSize: 12, fontWeight: "800" },
  timeline: { flexDirection: "row", height: 30, borderRadius: 9, overflow: "hidden", gap: 1, marginTop: 12 },
  axisRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 5 },
  axis: { fontSize: 10.5, fontWeight: "700", color: MUTED },
  statRow: { flexDirection: "row", gap: 6, marginTop: 12 },
  miniStat: { flex: 1, borderRadius: 11, paddingVertical: 8, paddingHorizontal: 4, alignItems: "center" },
  miniNum: { fontSize: 16, fontWeight: "900" },
  miniLbl: { fontSize: 10.5, fontWeight: "700", color: SLATE },
  kicker: { fontSize: 10.5, letterSpacing: 0.9, fontWeight: "800", color: MUTED, marginBottom: 6 },
  gapWrap: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  gapChip: { height: 32, paddingHorizontal: 11, borderRadius: 999, backgroundColor: "#F0FDF4", borderWidth: 1, borderColor: ACCENT_BORDER, justifyContent: "center" },
  gapTxt: { fontSize: 12, fontWeight: "800", color: ACCENT_DARK },
  fullTxt: { fontSize: 12.5, fontWeight: "700", color: "#B91C1C" },
  blockBtn: { marginTop: 10, height: 44, borderRadius: 13, borderWidth: 1.5, borderStyle: "dashed", borderColor: "#86EFAC", backgroundColor: "#F0FDF4", alignItems: "center", justifyContent: "center" },
  blockBtnTxt: { fontSize: 13.5, fontWeight: "800", color: ACCENT_DARK },

  sectionTitle: { fontSize: 12, fontWeight: "800", letterSpacing: 0.6, color: SLATE },
  smallChip: { height: 30, paddingHorizontal: 10, borderRadius: 999, borderWidth: 1, borderColor: LINE, backgroundColor: "#fff", justifyContent: "center" },
  smallChipOn: { backgroundColor: INK, borderColor: INK },
  smallChipTxt: { fontSize: 11.5, fontWeight: "800", color: "#334155" },

  card: { flexDirection: "row", gap: 12, backgroundColor: "#fff", borderRadius: 18, padding: 12, ...shadow },
  cardLive: { borderWidth: 1.5, borderColor: ACCENT },
  timeCol: { width: 56, alignItems: "center" },
  timeStart: { fontSize: 17, fontWeight: "900", color: INK, letterSpacing: -0.4 },
  timeAmPm: { fontSize: 10, fontWeight: "800", color: MUTED, marginTop: -2 },
  timeLine: { width: 3, height: 16, borderRadius: 2, marginVertical: 4 },
  timeEnd: { fontSize: 10.5, fontWeight: "700", color: MUTED, textAlign: "center" },
  rowTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  cardTitle: { flex: 1, fontSize: 15, fontWeight: "900", color: INK },
  livePill: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: ACCENT_TINT, borderWidth: 1, borderColor: ACCENT_BORDER, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 999 },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: ACCENT },
  liveTxt: { fontSize: 10, fontWeight: "900", color: ACCENT_DARK, letterSpacing: 0.5 },
  doneTxt: { fontSize: 11, fontWeight: "800", color: FAINT },
  pillRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 7 },
  pill: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, maxWidth: 170 },
  pillTxt: { fontSize: 10.5, fontWeight: "800" },

  emptyCard: { backgroundColor: "#fff", borderRadius: 18, padding: 24, alignItems: "center" },

  // week
  weekBadge: { width: 46, paddingVertical: 6, borderRadius: 12, backgroundColor: PAGE, alignItems: "center" },
  weekDow: { fontSize: 10, fontWeight: "800", color: MUTED },
  weekNum: { fontSize: 17, fontWeight: "900", color: INK },
  weekRowTop: { flexDirection: "row", justifyContent: "space-between", marginBottom: 3 },
  weekTurf: { fontSize: 11.5, fontWeight: "800", color: "#334155", flexShrink: 1 },
  weekFree: { fontSize: 11.5, fontWeight: "800", color: MUTED },
  weekBar: { flexDirection: "row", height: 12, borderRadius: 4, overflow: "hidden", gap: 1 },

  // list
  rangeSeg: { flexDirection: "row", backgroundColor: "#E6EAF0", borderRadius: 14, padding: 4 },
  rangeBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 9, borderRadius: 11 },
  rangeBtnOn: { backgroundColor: ACCENT_DARK },
  rangeTxt: { fontSize: 13, fontWeight: "800", color: "#374151" },
  rangeCount: { minWidth: 20, height: 18, paddingHorizontal: 5, borderRadius: 9, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" },
  rangeCountTxt: { fontSize: 10.5, fontWeight: "900", color: INK },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, height: 36, borderRadius: 999, backgroundColor: "#fff", borderWidth: 1, borderColor: LINE },
  chipOn: { backgroundColor: ACCENT_DARK, borderColor: ACCENT_DARK },
  dot: { width: 7, height: 7, borderRadius: 4 },
  chipTxt: { fontSize: 12.5, fontWeight: "700", color: "#374151" },
  chipCount: { fontSize: 12, fontWeight: "900", color: FAINT },
  dayHead: { flexDirection: "row", alignItems: "center", gap: 12, marginHorizontal: 14, marginTop: 14, marginBottom: 8 },
  dayHeadName: { fontSize: 15, fontWeight: "900", color: INK },
  dayHeadSub: { fontSize: 11.5, fontWeight: "700", color: MUTED, marginTop: 1 },

  empty: { alignItems: "center", paddingTop: 40, paddingHorizontal: 36 },
  emptyIcon: { width: 60, height: 60, borderRadius: 20, backgroundColor: ACCENT_TINT, alignItems: "center", justifyContent: "center" },
  emptyTitle: { fontSize: 15, fontWeight: "900", color: INK, marginTop: 10, textAlign: "center" },
  emptySub: { fontSize: 13, color: MUTED, textAlign: "center", marginTop: 4, lineHeight: 19, fontWeight: "600" },
  emptyBtn: { marginTop: 16, backgroundColor: ACCENT_DARK, paddingHorizontal: 20, height: 44, justifyContent: "center", borderRadius: 12 },
  emptyBtnTxt: { color: "#fff", fontSize: 13, fontWeight: "800" },

  // sheet
  backdrop: { flex: 1, backgroundColor: "rgba(11,18,32,0.55)" },
  sheet: { backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 16, paddingTop: 10, gap: 12 },
  grabber: { width: 40, height: 4, borderRadius: 2, backgroundColor: "#CBD5E1", alignSelf: "center" },
  sheetIcon: { width: 48, height: 48, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  sheetTitle: { fontSize: 18, fontWeight: "900", color: INK },
  sheetSub: { fontSize: 13, fontWeight: "700", color: SLATE, marginTop: 1 },
  infoBox: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#F5F7FA", borderRadius: 14, padding: 12 },
  infoVal: { fontSize: 14.5, fontWeight: "800", color: INK, marginTop: -2 },
  infoBig: { fontSize: 17, fontWeight: "900", color: INK, marginTop: -2 },
  callBtn: { height: 40, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1, borderColor: "#D7DDE5", backgroundColor: "#fff", flexDirection: "row", alignItems: "center", gap: 6 },
  callTxt: { fontSize: 13, fontWeight: "800", color: INK },
  noteTxt: { fontSize: 12.5, fontWeight: "600", color: SLATE, backgroundColor: "#F5F7FA", borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  primaryBtn: { height: 48, borderRadius: 13, backgroundColor: ACCENT_DARK, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 },
  primaryTxt: { fontSize: 14.5, fontWeight: "800", color: "#fff" },
  dangerBtn: { height: 48, borderRadius: 13, borderWidth: 1, borderColor: "#FECACA", backgroundColor: "#FEF2F2", alignItems: "center", justifyContent: "center" },
  dangerTxt: { fontSize: 13.5, fontWeight: "800", color: "#B91C1C" },
  ghostBtn: { height: 48, borderRadius: 13, borderWidth: 1, borderColor: "#E2E8F0", backgroundColor: "#fff", alignItems: "center", justifyContent: "center" },
  ghostTxt: { fontSize: 13.5, fontWeight: "800", color: "#334155" },
  closeBtn: { height: 48, borderRadius: 13, backgroundColor: INK, alignItems: "center", justifyContent: "center" },
  closeTxt: { fontSize: 14, fontWeight: "800", color: "#fff" },

  busy: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: "rgba(17,24,39,0.30)", alignItems: "center", justifyContent: "center" },
  busyCard: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#fff", paddingHorizontal: 18, paddingVertical: 14, borderRadius: 14 },
  busyTxt: { fontSize: 13, fontWeight: "800", color: INK },
});
/**
 * bookings.tsx — Owner bookings (v2 design)
 * • Green header with today / upcoming / to-collect numbers
 * • Tabs: Today · Upcoming · Done · Cancelled
 * • Filters: date (calendar sheet), type (All / Online / Walk-in), turf
 * • Bookings grouped by date; Done & Cancelled show newest first
 * • Cancel + Reschedule flows kept (same server endpoints), reschedule now
 *   has a calendar and supports late-night hours
 * Bug fixes: walk-in amounts, half-saved walk-ins hidden, late-night status,
 * reschedule duration, auto-refreshing status, safe areas on iPhone/Android.
 */
import {
  View, Text, SectionList, StyleSheet, TouchableOpacity, ActivityIndicator, StatusBar,
  RefreshControl, Alert, ScrollView, Modal,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useEffect, useMemo, useState } from "react";
import { db, auth } from "../../firebaseConfig";
import { collection, getDocs, query, where, deleteDoc, updateDoc, doc } from "firebase/firestore";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

const SERVER_URL = "https://bookora-backend-95u4.onrender.com";
const DAY_MS = 86400000;
const RESCHEDULE_DAYS = 60;

// ── Palette ─────────────────────────────────────────────────────────────────
const BRAND = "#15803D";
const ACCENT = "#16A34A";
const ON_BRAND = "#DCFCE7";
const PAGE = "#F1F4F7";
const INK = "#0F172A";
const SLATE = "#475569";
const MUTED = "#64748B";
const FAINT = "#94A3B8";
const LINE = "#E5E7EB";
const GREEN_TINT = "#F0FDF4";
const GREEN_BORDER = "#BBF7D0";

const KIND = {
  app:     { label: "Online",  bar: "#3B82F6", tint: "#EFF6FF", text: "#1D4ED8" },
  offline: { label: "Walk-in", bar: "#6366F1", tint: "#EEF2FF", text: "#4338CA" },
} as const;

// ── Types ───────────────────────────────────────────────────────────────────
type TabKey = "today" | "upcoming" | "completed" | "cancelled";
type SrcFilter = "all" | "app" | "offline";
type DateMode = "any" | "today" | "tomorrow" | "last7" | "next7" | "last30" | "day";
type Derived = "upcoming" | "completed" | "cancelled";

interface Booking {
  id: string;
  turfName?: string;
  turfId?: string;
  userName?: string;
  customerName?: string;
  date?: any;
  dateString?: string;
  slotTime?: string;
  slot?: string;
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
  isOffline?: boolean;
  paymentId?: string;
  rescheduled?: boolean;
  createdAt?: any;
}
interface Turf { id: string; name?: string; openingTime?: number; closingTime?: number; }
type Prepared = Booking & { _derived: Derived; _day: number; _start: number; _end: number };

const CANCEL_REASONS = [
  { key: "maintenance", label: "Turf under maintenance" },
  { key: "weather",     label: "Bad weather / ground not playable" },
  { key: "double",      label: "Double booking / slot error" },
  { key: "event",       label: "Private event at the venue" },
  { key: "customer",    label: "Customer requested cancellation" },
  { key: "other",       label: "Other reason" },
];

// ── Helpers ─────────────────────────────────────────────────────────────────
function getSafeDate(v: any): Date | null {
  if (!v) return null;
  if (typeof v?.toDate === "function") return v.toDate();
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}
function dayStart(d: Date | number): number { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime(); }
function todayStart(): number { return dayStart(new Date()); }
function bookingDay(b: Booking): number {
  const d = getSafeDate(b.dateString) ?? getSafeDate(b.date);
  return d ? dayStart(d) : 0;
}
function partMins(s: string): number {
  const m = String(s || "").trim().match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)/i);
  if (!m) return 0;
  let h = Number(m[1]);
  const p = m[3].toUpperCase();
  if (p === "PM" && h !== 12) h += 12;
  if (p === "AM" && h === 12) h = 0;
  return h * 60 + Number(m[2] || 0);
}
const openOf = (t?: Turf) => Number(t?.openingTime ?? 6);
const closeOf = (t?: Turf) => { const c = Number(t?.closingTime ?? 23); return c === 0 ? 24 : c; };
/** Late-night turfs (closing > 24): times before opening belong to the next morning */
function adj(m: number, t?: Turf): number {
  return t && closeOf(t) > 24 && m < openOf(t) * 60 ? m + 1440 : m;
}
function slotsOf(b: Booking): string[] {
  if (Array.isArray(b.selectedSlots) && b.selectedSlots.length) return b.selectedSlots;
  if (Array.isArray(b.slots) && b.slots.length) return b.slots;
  return [b.slotTime, b.slot].filter(Boolean) as string[];
}
/** Start / end in minutes from the booking day's midnight (late slots > 1440) */
function minsRange(b: Booking, t?: Turf): { start: number; end: number } {
  let start = Infinity, end = -Infinity;
  slotsOf(b).forEach(s => {
    const p = s.split(" - ");
    if (p.length < 2) return;
    const a = adj(partMins(p[0]), t);
    let e = adj(partMins(p[1]), t);
    if (e <= a) e += 1440;
    start = Math.min(start, a); end = Math.max(end, e);
  });
  if (!isFinite(start)) return { start: 0, end: 1440 };
  return { start, end };
}
function hm(min: number): string {
  const x = ((min % 1440) + 1440) % 1440;
  const h = Math.floor(x / 60), m = x % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m ? `${h12}:${String(m).padStart(2, "0")}` : `${h12}`;
}
const per = (min: number) => ((((min % 1440) + 1440) % 1440) >= 720 ? "PM" : "AM");
const clockM = (min: number) => `${hm(min)} ${per(min)}`;
const rangeM = (a: number, b: number) => `${hm(a)}${per(a) !== per(b) ? ` ${per(a)}` : ""}–${hm(b)} ${per(b)}`;
const hrsTxt = (mins: number) => {
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60), m = mins % 60;
  return m ? `${h}h ${m}m` : `${h} hr${h === 1 ? "" : "s"}`;
};
/** decimal hour → "6:30 PM" (wraps after midnight) — used to write slots */
function fmtDec(v: number): string {
  const x = ((v % 24) + 24) % 24;
  const hour = Math.floor(x), minute = Math.round((x % 1) * 60);
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h}:${String(minute).padStart(2, "0")} ${hour >= 12 ? "PM" : "AM"}`;
}
function buildTimeRange(start: number, end: number): string[] {
  const out: string[] = [];
  for (let t = start; t < end - 0.001; t += 0.5) out.push(`${fmtDec(t)} - ${fmtDec(Math.min(t + 0.5, end))}`);
  return out;
}
const rs = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
function dayLabel(day: number): string {
  const diff = Math.round((day - todayStart()) / DAY_MS);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  return new Date(day).toLocaleDateString("en-US", { weekday: "long" });
}
const shortDay = (day: number) => new Date(day).toLocaleDateString("en-US", { weekday: "short", day: "numeric", month: "short" });
function fmtCreated(v: any): string {
  const d = getSafeDate(v);
  if (!d) return "";
  return d.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true });
}

function getTotal(b: Booking) { return Number(b.totalAmount ?? b.amount ?? b.price ?? 0); }
function getPaid(b: Booking) { return Number(b.advanceAmount ?? (b.paymentStatus === "paid" ? getTotal(b) : 0)); }
function getRemaining(b: Booking) { return Number(b.remainingAmount ?? Math.max(getTotal(b) - getPaid(b), 0)); }

function passDate(day: number, mode: DateMode, pick: number | null): boolean {
  const t = todayStart();
  switch (mode) {
    case "any": return true;
    case "today": return day === t;
    case "tomorrow": return day === t + DAY_MS;
    case "last7": return day <= t && day > t - 7 * DAY_MS;
    case "last30": return day <= t && day > t - 30 * DAY_MS;
    case "next7": return day >= t && day < t + 7 * DAY_MS;
    case "day": return pick !== null && day === pick;
  }
}
function dateModeLabel(mode: DateMode, pick: number | null): string {
  switch (mode) {
    case "any": return "Any date";
    case "today": return `Today · ${shortDay(todayStart())}`;
    case "tomorrow": return `Tomorrow · ${shortDay(todayStart() + DAY_MS)}`;
    case "last7": return "Last 7 days";
    case "last30": return "Last 30 days";
    case "next7": return "Next 7 days";
    case "day": return pick ? shortDay(pick) : "Pick a date";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
export default function OwnerBookings() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [bookings, setBookings] = useState<Booking[]>([]);
  const [turfs, setTurfs] = useState<Turf[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tick, setTick] = useState(0);

  // filters
  const [activeTab, setActiveTab] = useState<TabKey>("today");
  const [turfFilter, setTurfFilter] = useState<string>("all");
  const [srcFilter, setSrcFilter] = useState<SrcFilter>("all");
  const [dateMode, setDateMode] = useState<DateMode>("any");
  const [datePick, setDatePick] = useState<number | null>(null);

  // date sheet (draft until "Show")
  const [dateOpen, setDateOpen] = useState(false);
  const [draftMode, setDraftMode] = useState<DateMode>("any");
  const [draftPick, setDraftPick] = useState<number | null>(null);
  const [draftMonth, setDraftMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });

  // cancel
  const [cancelTarget, setCancelTarget] = useState<Prepared | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelling, setCancelling] = useState(false);

  // reschedule
  const [resTarget, setResTarget] = useState<Prepared | null>(null);
  const [resDay, setResDay] = useState<number>(todayStart());
  const [resStart, setResStart] = useState<number | null>(null);
  const [resTaken, setResTaken] = useState<{ start: number; end: number }[]>([]);
  const [resLoadingSlots, setResLoadingSlots] = useState(false);
  const [resSaving, setResSaving] = useState(false);
  const [resCalOpen, setResCalOpen] = useState(false);
  const [resMonth, setResMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });

  useEffect(() => { fetchAll(); }, []);
  // keep Upcoming → Done moving as time passes
  useEffect(() => { const t = setInterval(() => setTick(x => x + 1), 60000); return () => clearInterval(t); }, []);

  const fetchAll = async (isRefresh = false) => {
    const uid = auth.currentUser?.uid;
    if (!uid) { setLoading(false); return; }
    isRefresh ? setRefreshing(true) : setLoading(true);
    try {
      const [appSnap, offlineSnap, turfSnap] = await Promise.all([
        getDocs(query(collection(db, "bookings"), where("ownerId", "==", uid))),
        getDocs(query(collection(db, "blockedSlots"), where("ownerId", "==", uid), where("type", "==", "offline"))),
        getDocs(query(collection(db, "turfs"), where("ownerId", "==", uid))),
      ]);
      const t = turfSnap.docs.map(d => ({ id: d.id, ...d.data() } as Turf));
      setTurfs(t);

      const app: Booking[] = appSnap.docs.map(d => ({ id: d.id, source: "app", ...d.data() } as Booking));

      const offline: Booking[] = [];
      offlineSnap.docs.forEach(d => {
        const raw: any = d.data();
        if (raw.pending === true) return; // FIX: half-saved walk-in (form not finished)
        const advance = Number(raw.amount || 0);
        const remaining = Number(raw.remainingAmount || 0);
        offline.push({
          id: d.id, source: "offline", isOffline: true,
          turfName: raw.turfName || "", turfId: raw.turfId || "",
          customerName: raw.customerName || "Walk-in", customerPhone: raw.customerPhone || "",
          date: raw.date || raw.dateString || "", dateString: raw.date || raw.dateString || "",
          selectedSlots: Array.isArray(raw.slots) ? raw.slots : raw.slotTime ? [raw.slotTime] : [],
          // FIX: amount = advance taken, remainingAmount = still to collect
          totalAmount: advance + remaining, advanceAmount: advance, remainingAmount: remaining,
          status: "confirmed", paymentStatus: remaining > 0 ? "partial" : "fully_paid",
          rescheduled: !!raw.rescheduled, createdAt: raw.createdAt,
        });
      });
      setBookings([...app, ...offline]);
    } catch {
      Alert.alert("Error", "Unable to load bookings.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const turfMap = useMemo(() => { const m: Record<string, Turf> = {}; turfs.forEach(t => { m[t.id] = t; }); return m; }, [turfs]);

  // ── Prepare: day, minutes, live status ──
  const prepared = useMemo<Prepared[]>(() => {
    const now = Date.now();
    return bookings.map(b => {
      const day = bookingDay(b);
      const { start, end } = minsRange(b, turfMap[b.turfId || ""]);
      let derived: Derived;
      if (b.status === "cancelled") derived = "cancelled";
      else if (!day) derived = "upcoming";
      else derived = day + end * 60000 <= now ? "completed" : "upcoming"; // FIX: late-night aware
      return { ...b, _derived: derived, _day: day, _start: start, _end: end };
    });
  }, [bookings, turfMap, tick]);

  const today = todayStart();
  const isTodayB = (b: Prepared) => b._day === today;

  const base = useMemo(() => prepared.filter(b =>
    (turfFilter === "all" || b.turfId === turfFilter) &&
    (srcFilter === "all" || (srcFilter === "offline" ? b.source === "offline" : b.source !== "offline"))
  ), [prepared, turfFilter, srcFilter]);

  const inTab = (b: Prepared, tab: TabKey) => tab === "today" ? isTodayB(b) : b._derived === tab;
  const passDateF = (b: Prepared, tab: TabKey) => tab === "today" ? true : passDate(b._day, dateMode, datePick);

  const tabCounts = useMemo(() => {
    const c = { today: 0, upcoming: 0, completed: 0, cancelled: 0 };
    (Object.keys(c) as TabKey[]).forEach(k => { c[k] = base.filter(b => inTab(b, k) && passDateF(b, k)).length; });
    return c;
  }, [base, dateMode, datePick, today]);

  const sections = useMemo(() => {
    const list = base.filter(b => b._day && inTab(b, activeTab) && passDateF(b, activeTab));
    const newest = activeTab === "completed" || activeTab === "cancelled";
    list.sort((a, b) => {
      const d = newest ? b._day - a._day : a._day - b._day;
      if (d) return d;
      return newest ? b._start - a._start : a._start - b._start;
    });
    const map = new Map<number, Prepared[]>();
    list.forEach(b => { if (!map.has(b._day)) map.set(b._day, []); map.get(b._day)!.push(b); });
    return Array.from(map.entries()).map(([day, data]) => ({ day, data }));
  }, [base, activeTab, dateMode, datePick, today]);
  const resultCount = sections.reduce((a, s) => a + s.data.length, 0);

  const stats = useMemo(() => {
    const active = prepared.filter(b => b._derived !== "cancelled");
    return {
      today: active.filter(isTodayB).length,
      upcoming: prepared.filter(b => b._derived === "upcoming").length,
      collect: prepared.filter(b => b._derived === "upcoming").reduce((a, b) => a + getRemaining(b), 0),
    };
  }, [prepared, today]);

  const hasFilters = turfFilter !== "all" || srcFilter !== "all" || (activeTab !== "today" && dateMode !== "any");
  const clearFilters = () => { setTurfFilter("all"); setSrcFilter("all"); setDateMode("any"); setDatePick(null); };

  // ── Date sheet ──
  const openDateSheet = () => {
    const m = activeTab === "today" ? "today" : dateMode;
    setDraftMode(m);
    setDraftPick(m === "day" ? datePick : m === "today" ? today : m === "tomorrow" ? today + DAY_MS : null);
    const base = new Date(m === "day" && datePick ? datePick : today);
    setDraftMonth(new Date(base.getFullYear(), base.getMonth(), 1));
    setDateOpen(true);
  };
  const draftCount = useMemo(() => base.filter(b => b._day && passDate(b._day, draftMode, draftPick)).length, [base, draftMode, draftPick, today]);
  const dayCounts = useMemo(() => {
    const m: Record<number, number> = {};
    base.forEach(b => { if (b._derived !== "cancelled" && b._day) m[b._day] = (m[b._day] || 0) + 1; });
    return m;
  }, [base]);
  const applyDate = () => {
    setDateOpen(false);
    if (draftMode === "today") { setActiveTab("today"); setDateMode("any"); setDatePick(null); return; }
    setDateMode(draftMode);
    setDatePick(draftMode === "day" ? draftPick : null);
    const past = draftMode === "last7" || draftMode === "last30" || (draftMode === "day" && draftPick !== null && draftPick < today);
    const future = draftMode === "tomorrow" || draftMode === "next7" || (draftMode === "day" && draftPick !== null && draftPick > today);
    if (activeTab === "today" || (activeTab === "upcoming" && past) || (activeTab === "completed" && future)) {
      setActiveTab(past ? "completed" : "upcoming");
    }
  };

  // ── Navigation ──
  const openReceipt = (b: Booking) => {
    if (b.source === "offline") router.push({ pathname: "/(owner)/booking-receipt/offline-receipt", params: { id: b.id } } as any);
    else router.push({ pathname: "/(owner)/booking-receipt/[id]", params: { id: b.id } } as any);
  };

  // ══════════════════════════════════════════════════════════════════════════
  // CANCEL
  // ══════════════════════════════════════════════════════════════════════════
  const openCancel = (b: Prepared) => { setCancelReason(""); setCancelTarget(b); };
  const performCancel = () => {
    if (!cancelTarget || !cancelReason) return;
    const b = cancelTarget;
    const reasonLabel = CANCEL_REASONS.find(r => r.key === cancelReason)?.label || cancelReason;
    const isOffline = b.source === "offline";
    const paid = getPaid(b);
    Alert.alert(
      "Confirm cancellation",
      `Cancel this booking at ${b.turfName || "your turf"} on ${shortDay(b._day)}?` +
        (!isOffline && paid > 0 && b.paymentId ? `\n\n${rs(paid)} will be refunded to the customer automatically.`
          : isOffline ? "\n\nThe slot will be freed and become available again." : ""),
      [
        { text: "Go back", style: "cancel" },
        {
          text: "Yes, cancel", style: "destructive", onPress: async () => {
            setCancelling(true);
            try {
              if (isOffline) {
                await deleteDoc(doc(db, "blockedSlots", b.id));
              } else {
                const token = await auth.currentUser?.getIdToken();
                if (!token) throw new Error("Not signed in");
                const res = await fetch(`${SERVER_URL}/owner-cancel-booking`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                  body: JSON.stringify({ bookingId: b.id, reason: reasonLabel }),
                });
                const data = await res.json();
                if (!res.ok || !data.success) throw new Error(data.error || "Failed to cancel");
              }
              setCancelTarget(null);
              await fetchAll(true);
              Alert.alert("Cancelled", isOffline
                ? "Walk-in booking cancelled. The slot is free again."
                : "Booking cancelled. The customer has been notified" + (paid > 0 && b.paymentId ? " and refunded." : "."));
            } catch (e: any) {
              Alert.alert("Error", e?.message || "Could not cancel booking.");
            } finally {
              setCancelling(false);
            }
          },
        },
      ]
    );
  };

  // ══════════════════════════════════════════════════════════════════════════
  // RESCHEDULE
  // ══════════════════════════════════════════════════════════════════════════
  const resTurf = resTarget ? turfMap[resTarget.turfId || ""] : undefined;
  const resOpening = openOf(resTurf);
  const resClosing = closeOf(resTurf);
  const resDuration = resTarget ? Math.max(0.5, (resTarget._end - resTarget._start) / 60) : 1; // FIX: real length
  const resDays = useMemo(() => Array.from({ length: 14 }, (_, i) => today + i * DAY_MS), [today]);
  const resMaxDay = today + (RESCHEDULE_DAYS - 1) * DAY_MS;

  const openReschedule = (b: Prepared) => {
    setResTarget(b);
    setResStart(null);
    const start = b._day >= today ? b._day : today;
    setResDay(start);
    const d = new Date(start);
    setResMonth(new Date(d.getFullYear(), d.getMonth(), 1));
    setResCalOpen(false);
  };

  useEffect(() => { if (resTarget?.turfId) loadTakenRanges(); }, [resTarget, resDay]);

  const loadTakenRanges = async () => {
    if (!resTarget?.turfId) return;
    setResLoadingSlots(true);
    setResStart(null);
    try {
      const dateKey = new Date(resDay).toDateString();
      const [bookedSnap, blockedSnap] = await Promise.all([
        getDocs(query(collection(db, "bookings"), where("turfId", "==", resTarget.turfId), where("dateString", "==", dateKey))),
        getDocs(query(collection(db, "blockedSlots"), where("turfId", "==", resTarget.turfId), where("date", "==", dateKey))),
      ]);
      const taken: { start: number; end: number }[] = [];
      const push = (s: string) => {
        const p = String(s).split(" - ");
        if (p.length < 2) return;
        const a = adj(partMins(p[0]), resTurf) / 60;
        let e = adj(partMins(p[1]), resTurf) / 60;
        if (e <= a) e += 24;
        taken.push({ start: a, end: e });
      };
      bookedSnap.docs.forEach(d => {
        if (d.id === resTarget.id) return;
        const data: any = d.data();
        if (data.status === "cancelled") return;
        (Array.isArray(data.selectedSlots) && data.selectedSlots.length ? data.selectedSlots : [data.slotTime, data.slot].filter(Boolean)).forEach(push);
      });
      blockedSnap.docs.forEach(d => {
        if (d.id === resTarget.id) return;
        const data: any = d.data();
        (Array.isArray(data.slots) ? data.slots : [data.slotTime].filter(Boolean)).forEach(push);
      });
      setResTaken(taken);
    } catch {
      Alert.alert("Error", "Could not load slot availability.");
    } finally {
      setResLoadingSlots(false);
    }
  };

  const resChips = useMemo(() => {
    if (!resTarget) return [];
    const isToday = resDay === today;
    const nowDec = new Date().getHours() + new Date().getMinutes() / 60;
    const chips: { value: number; available: boolean }[] = [];
    for (let t = resOpening; t + resDuration <= resClosing + 0.001; t += 0.5) {
      if (isToday && t < nowDec) continue;
      const conflict = resTaken.some(r => t < r.end && r.start < t + resDuration);
      chips.push({ value: t, available: !conflict });
    }
    return chips;
  }, [resTarget, resDay, resTaken, resOpening, resClosing, resDuration, today]);

  const chipGroups = useMemo(() => {
    const G = [
      { label: "MORNING", test: (t: number) => t < 12 },
      { label: "AFTERNOON", test: (t: number) => t >= 12 && t < 17 },
      { label: "EVENING", test: (t: number) => t >= 17 && t < 21 },
      { label: "NIGHT", test: (t: number) => t >= 21 && t < 24 },
      { label: "LATE NIGHT", test: (t: number) => t >= 24 },
    ];
    return G.map(g => ({ label: g.label, chips: resChips.filter(c => g.test(c.value)) })).filter(g => g.chips.length);
  }, [resChips]);

  const performReschedule = () => {
    if (!resTarget || resStart === null) return;
    const b = resTarget;
    const isOffline = b.source === "offline";
    const newDateKey = new Date(resDay).toDateString();
    const newSlots = buildTimeRange(resStart, resStart + resDuration);
    const label = `${shortDay(resDay)} · ${rangeM(resStart * 60, (resStart + resDuration) * 60)}`;
    Alert.alert("Confirm reschedule", `Move this booking to:\n\n${label}` + (!isOffline ? "\n\nThe customer will be notified of the new time." : ""), [
      { text: "Go back", style: "cancel" },
      {
        text: "Confirm", onPress: async () => {
          setResSaving(true);
          try {
            if (isOffline) {
              await updateDoc(doc(db, "blockedSlots", b.id), { slots: newSlots, date: newDateKey, rescheduled: true });
            } else {
              const token = await auth.currentUser?.getIdToken();
              if (!token) throw new Error("Not signed in");
              const res = await fetch(`${SERVER_URL}/owner-reschedule-booking`, {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                body: JSON.stringify({ bookingId: b.id, newDateString: newDateKey, newSlots }),
              });
              const data = await res.json();
              if (!res.ok || !data.success) throw new Error(data.error || "Failed to reschedule");
            }
            setResTarget(null);
            await fetchAll(true);
            Alert.alert("Rescheduled", isOffline ? "Walk-in booking moved to the new time." : "Booking rescheduled. The customer has been notified.");
          } catch (e: any) {
            Alert.alert("Error", e?.message || "Could not reschedule booking.");
            loadTakenRanges();
          } finally {
            setResSaving(false);
          }
        },
      },
    ]);
  };

  // ── Loading ──
  if (loading) {
    return (
      <View style={st.center}>
        <StatusBar barStyle="dark-content" />
        <ActivityIndicator size="large" color={ACCENT} />
        <Text style={st.loadTxt}>Loading bookings…</Text>
      </View>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // RENDER PIECES
  // ══════════════════════════════════════════════════════════════════════════
  const TABS: { key: TabKey; label: string }[] = [
    { key: "today", label: "Today" }, { key: "upcoming", label: "Upcoming" },
    { key: "completed", label: "Done" }, { key: "cancelled", label: "Cancelled" },
  ];
  const SRC: Record<SrcFilter, { label: string; dot: string }> = {
    all: { label: "All types", dot: FAINT }, app: { label: "Online", dot: KIND.app.bar }, offline: { label: "Walk-in", dot: KIND.offline.bar },
  };
  const nextSrc: Record<SrcFilter, SrcFilter> = { all: "app", app: "offline", offline: "all" };

  const listHeader = (
    <View style={{ paddingHorizontal: 14, paddingTop: 12, gap: 10 }}>
      <View style={st.tabs}>
        {TABS.map(t => {
          const on = activeTab === t.key;
          return (
            <TouchableOpacity key={t.key} style={[st.tab, on && st.tabOn]} onPress={() => setActiveTab(t.key)} accessibilityState={{ selected: on }}>
              <Text style={[st.tabTxt, on && { color: "#fff" }]} numberOfLines={1}>{t.label}</Text>
              <View style={[st.tabCount, on && { backgroundColor: "rgba(255,255,255,0.25)" }]}>
                <Text style={[st.tabCountTxt, on && { color: "#fff" }]}>{tabCounts[t.key]}</Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={st.filterCard}>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <TouchableOpacity style={st.dateBtn} onPress={openDateSheet} accessibilityLabel="Filter by date">
            <Ionicons name="calendar-outline" size={17} color={BRAND} />
            <Text style={st.dateBtnTxt} numberOfLines={1}>{activeTab === "today" ? dateModeLabel("today", null) : dateModeLabel(dateMode, datePick)}</Text>
            <Ionicons name="chevron-down" size={16} color={BRAND} />
          </TouchableOpacity>
          <TouchableOpacity style={st.srcBtn} onPress={() => setSrcFilter(nextSrc[srcFilter])} accessibilityLabel={`Type: ${SRC[srcFilter].label}. Tap to change`}>
            <View style={[st.dot, { backgroundColor: SRC[srcFilter].dot }]} />
            <Text style={st.srcTxt}>{SRC[srcFilter].label}</Text>
          </TouchableOpacity>
        </View>
        {turfs.length > 1 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {[{ id: "all", name: "All turfs" }, ...turfs].map(t => {
              const on = turfFilter === t.id;
              return (
                <TouchableOpacity key={t.id} style={[st.turfChip, on && st.turfChipOn]} onPress={() => setTurfFilter(t.id)} accessibilityState={{ selected: on }}>
                  <Text style={[st.turfChipTxt, on && { color: "#fff" }]} numberOfLines={1}>{t.name || "Turf"}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )}
      </View>

      <View style={st.resultRow}>
        <Text style={st.resultTxt}>{resultCount} BOOKING{resultCount === 1 ? "" : "S"}</Text>
        {hasFilters && (
          <TouchableOpacity onPress={clearFilters} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text style={st.clearTxt}>Clear filters</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );

  const renderCard = (b: Prepared) => {
    const k = b.source === "offline" ? KIND.offline : KIND.app;
    const d = b._derived;
    const nowM = (Date.now() - b._day) / 60000;
    const live = d === "upcoming" && nowM >= b._start && nowM < b._end;
    const total = getTotal(b), paid = getPaid(b), due = getRemaining(b);
    const name = b.userName || b.customerName || "Customer";
    const stateTxt = d === "cancelled" ? "Cancelled" : live ? "● LIVE" : d === "completed" ? "Done" : "Upcoming";
    const stateSty = d === "cancelled" ? { bg: "#FEF2F2", fg: "#B91C1C" } : live ? { bg: "#DCFCE7", fg: BRAND } : d === "completed" ? { bg: "#F1F5F9", fg: MUTED } : { bg: "#EFF6FF", fg: "#1D4ED8" };
    const created = fmtCreated(b.createdAt);
    return (
      <TouchableOpacity activeOpacity={0.85} onPress={() => openReceipt(b)}
        style={[st.card, d === "cancelled" && { opacity: 0.7 }, live && st.cardLive]}>
        <View style={{ flexDirection: "row", gap: 12 }}>
          <View style={st.timeCol}>
            <Text style={st.timeStart}>{hm(b._start)}</Text>
            <Text style={st.timeAp}>{per(b._start)}</Text>
            <View style={[st.timeLine, { backgroundColor: d === "cancelled" ? "#EF4444" : k.bar }]} />
            <Text style={st.timeEnd}>– {clockM(b._end)}</Text>
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={st.rowTop}>
              <Text style={st.cardName} numberOfLines={1}>{name}</Text>
              <View style={[st.statePill, { backgroundColor: stateSty.bg }]}><Text style={[st.stateTxt, { color: stateSty.fg }]}>{stateTxt}</Text></View>
            </View>
            <Text style={st.cardTurf} numberOfLines={1}>{b.turfName || "Turf"}{b.customerPhone ? ` · ${b.customerPhone}` : ""}</Text>
            <View style={st.pillRow}>
              <View style={[st.pill, { backgroundColor: k.tint }]}><Text style={[st.pillTxt, { color: k.text }]}>{k.label}</Text></View>
              <View style={[st.pill, { backgroundColor: "#F1F5F9" }]}><Text style={[st.pillTxt, { color: SLATE }]}>{hrsTxt(b._end - b._start)}</Text></View>
              {b.rescheduled && (
                <View style={[st.pill, { backgroundColor: "#F5F3FF" }]}>
                  <Ionicons name="swap-horizontal" size={10} color="#6D28D9" />
                  <Text style={[st.pillTxt, { color: "#6D28D9" }]}>Rescheduled</Text>
                </View>
              )}
            </View>
          </View>
        </View>

        {d !== "cancelled" && total > 0 && (
          <View style={st.moneyRow}>
            <View style={[st.moneyBox, { backgroundColor: "#F5F7FA" }]}>
              <Text style={st.moneyLbl}>TOTAL</Text>
              <Text style={st.moneyVal} numberOfLines={1} adjustsFontSizeToFit>{rs(total)}</Text>
            </View>
            <View style={[st.moneyBox, { backgroundColor: GREEN_TINT }]}>
              <Text style={[st.moneyLbl, { color: BRAND }]}>PAID</Text>
              <Text style={[st.moneyVal, { color: BRAND }]} numberOfLines={1} adjustsFontSizeToFit>{rs(paid)}</Text>
            </View>
            <View style={[st.moneyBox, { backgroundColor: due > 0 ? "#FFF7ED" : GREEN_TINT }]}>
              <Text style={[st.moneyLbl, { color: due > 0 ? "#C2410C" : BRAND }]} numberOfLines={1}>{due > 0 ? (d === "completed" ? "WAS DUE" : "DUE AT TURF") : "STATUS"}</Text>
              <Text style={[st.moneyVal, { color: due > 0 ? "#9A3412" : BRAND }]} numberOfLines={1} adjustsFontSizeToFit>{due > 0 ? rs(due) : "Fully paid"}</Text>
            </View>
          </View>
        )}

        <View style={st.actRow}>
          <TouchableOpacity style={st.actBtn} onPress={() => openReceipt(b)}>
            <Ionicons name="receipt-outline" size={14} color={INK} />
            <Text style={st.actTxt}>Receipt</Text>
          </TouchableOpacity>
          {d === "upcoming" && (
            <>
              <TouchableOpacity style={[st.actBtn, { backgroundColor: KIND.app.tint, borderColor: "#BFDBFE" }]} onPress={() => openReschedule(b)}>
                <Text style={[st.actTxt, { color: KIND.app.text }]}>Reschedule</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[st.actBtn, { backgroundColor: "#FEF2F2", borderColor: "#FECACA" }]} onPress={() => openCancel(b)}>
                <Text style={[st.actTxt, { color: "#B91C1C" }]}>Cancel</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
        {!!created && <Text style={st.created}>{b.source === "offline" ? "Added by you" : "Booked in app"} · {created}</Text>}
      </TouchableOpacity>
    );
  };

  const emptyText = activeTab === "today" ? ["No bookings today", "Today's bookings will show up here."]
    : activeTab === "upcoming" ? ["No upcoming bookings", hasFilters ? "Try another turf, date or type." : "New bookings will show up here."]
    : activeTab === "completed" ? ["No finished bookings", "Try another date or clear the filters."]
    : ["No cancelled bookings", "Try another date or clear the filters."];

  // ══════════════════════════════════════════════════════════════════════════
  return (
    <View style={st.root}>
      <StatusBar barStyle="light-content" backgroundColor={BRAND} />

      {/* Header */}
      <View style={[st.header, { paddingTop: insets.top + 10 }]}>
        <View style={st.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={st.hKicker}>OWNER</Text>
            <Text style={st.hTitle}>Bookings</Text>
          </View>
          <TouchableOpacity style={st.hBtn} onPress={() => fetchAll(true)} accessibilityLabel="Refresh">
            <Ionicons name="refresh" size={19} color="#fff" />
          </TouchableOpacity>
        </View>
        <View style={st.statRow}>
          <View style={st.stat}><Text style={st.statNum}>{stats.today}</Text><Text style={st.statLbl}>today</Text></View>
          <View style={st.stat}><Text style={st.statNum}>{stats.upcoming}</Text><Text style={st.statLbl}>upcoming</Text></View>
          <View style={st.stat}><Text style={[st.statNum, { color: "#FDBA74" }]} numberOfLines={1} adjustsFontSizeToFit>{rs(stats.collect)}</Text><Text style={st.statLbl}>to collect</Text></View>
        </View>
      </View>

      <SectionList
        sections={sections}
        keyExtractor={i => `${i.source}-${i.id}`}
        stickySectionHeadersEnabled={false}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => fetchAll(true)} tintColor={ACCENT} colors={[ACCENT]} />}
        ListHeaderComponent={listHeader}
        renderSectionHeader={({ section }) => {
          const isT = section.day === today;
          const d = new Date(section.day);
          return (
            <View style={st.dayHead}>
              <View style={[st.dayBadge, isT && { backgroundColor: BRAND }]}>
                <Text style={[st.dayDow, isT && { color: "#fff" }]}>{d.toLocaleDateString("en-US", { weekday: "short" }).toUpperCase()}</Text>
                <Text style={[st.dayNum, isT && { color: "#fff" }]}>{d.getDate()}</Text>
              </View>
              <View>
                <Text style={st.dayName}>{dayLabel(section.day)}</Text>
                <Text style={st.daySub}>{d.toLocaleDateString("en-US", { day: "numeric", month: "long" })} · {section.data.length} booking{section.data.length === 1 ? "" : "s"}</Text>
              </View>
            </View>
          );
        }}
        renderItem={({ item }) => <View style={{ paddingHorizontal: 14 }}>{renderCard(item)}</View>}
        ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
        ListEmptyComponent={
          <View style={st.empty}>
            <View style={st.emptyIcon}><Ionicons name="calendar-outline" size={26} color={ACCENT} /></View>
            <Text style={st.emptyTitle}>{emptyText[0]}</Text>
            <Text style={st.emptySub}>{emptyText[1]}</Text>
            {hasFilters && (
              <TouchableOpacity style={st.emptyBtn} onPress={clearFilters}><Text style={st.emptyBtnTxt}>Clear filters</Text></TouchableOpacity>
            )}
          </View>
        }
      />

      {/* ══ DATE FILTER SHEET ══ */}
      <Modal visible={dateOpen} transparent animationType="slide" onRequestClose={() => setDateOpen(false)} statusBarTranslucent>
        <View style={st.backdrop}>
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => setDateOpen(false)} />
          <View style={[st.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}>
            <View style={st.grabber} />
            <View style={st.sheetHead}>
              <Text style={st.sheetTitle}>Show bookings for</Text>
              <TouchableOpacity style={st.closeX} onPress={() => setDateOpen(false)} accessibilityLabel="Close"><Ionicons name="close" size={18} color={SLATE} /></TouchableOpacity>
            </View>
            <View style={st.quickWrap}>
              {([["any", "Any date"], ["today", "Today"], ["tomorrow", "Tomorrow"], ["last7", "Last 7 days"], ["next7", "Next 7 days"], ["last30", "Last 30 days"]] as [DateMode, string][]).map(([k, l]) => {
                const on = draftMode === k;
                return (
                  <TouchableOpacity key={k} style={[st.quick, on && st.quickOn]} onPress={() => {
                    setDraftMode(k);
                    setDraftPick(k === "today" ? today : k === "tomorrow" ? today + DAY_MS : null);
                  }}>
                    <Text style={[st.quickTxt, on && { color: "#fff" }]}>{l}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <View style={st.calBox}>
              <MonthCal
                month={draftMonth} onMonth={setDraftMonth} today={today}
                selected={draftPick}
                inRange={(day) => draftMode !== "day" && draftMode !== "any" && draftMode !== "today" && draftMode !== "tomorrow" && passDate(day, draftMode, null)}
                marks={dayCounts}
                onPick={(day) => {
                  setDraftPick(day);
                  setDraftMode(day === today ? "today" : day === today + DAY_MS ? "tomorrow" : "day");
                }}
              />
              <View style={st.legendRow}>
                <View style={st.legendItem}><View style={[st.dotSm, { backgroundColor: ACCENT }]} /><Text style={st.legendTxt}>Has bookings</Text></View>
                <View style={st.legendItem}><View style={[st.dotLg, { backgroundColor: BRAND }]} /><Text style={st.legendTxt}>Today</Text></View>
              </View>
            </View>
            <TouchableOpacity style={st.primaryBtn} onPress={applyDate}>
              <Text style={st.primaryTxt}>Show {draftCount} booking{draftCount === 1 ? "" : "s"}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ══ CANCEL SHEET ══ */}
      <Modal visible={!!cancelTarget} transparent animationType="slide" onRequestClose={() => !cancelling && setCancelTarget(null)} statusBarTranslucent>
        <View style={st.backdrop}>
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => !cancelling && setCancelTarget(null)} />
          <View style={[st.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 8, maxHeight: "88%" }]}>
            <View style={st.grabber} />
            <View style={st.sheetHead}>
              <Text style={st.sheetTitle}>Cancel booking</Text>
              <TouchableOpacity style={st.closeX} onPress={() => !cancelling && setCancelTarget(null)} accessibilityLabel="Close"><Ionicons name="close" size={18} color={SLATE} /></TouchableOpacity>
            </View>
            {cancelTarget && (
              <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                <View style={st.targetBox}>
                  <Text style={st.targetTitle}>{cancelTarget.userName || cancelTarget.customerName || "Customer"} · {cancelTarget.turfName || "Turf"}</Text>
                  <Text style={st.targetMeta}>{shortDay(cancelTarget._day)} · {rangeM(cancelTarget._start, cancelTarget._end)}</Text>
                  {cancelTarget.source === "offline" ? (
                    <Text style={st.targetNote}>Walk-in booking — the slot will be freed.</Text>
                  ) : getPaid(cancelTarget) > 0 && cancelTarget.paymentId ? (
                    <Text style={st.targetNote}>{rs(getPaid(cancelTarget))} will be refunded to the customer (5–7 business days).</Text>
                  ) : null}
                </View>
                <Text style={st.kicker}>WHY ARE YOU CANCELLING?</Text>
                {CANCEL_REASONS.map(r => {
                  const on = cancelReason === r.key;
                  return (
                    <TouchableOpacity key={r.key} style={[st.reason, on && st.reasonOn]} onPress={() => setCancelReason(r.key)} accessibilityState={{ selected: on }}>
                      <Text style={[st.reasonTxt, on && { color: BRAND }]}>{r.label}</Text>
                      <Ionicons name={on ? "radio-button-on" : "radio-button-off"} size={18} color={on ? BRAND : "#CBD5E1"} />
                    </TouchableOpacity>
                  );
                })}
                <View style={st.btnRow}>
                  <TouchableOpacity style={[st.ghostBtn, { flex: 1 }]} disabled={cancelling} onPress={() => setCancelTarget(null)}>
                    <Text style={st.ghostTxt}>Back</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[st.dangerBtn, { flex: 1.6 }, (!cancelReason || cancelling) && { opacity: 0.5 }]} disabled={!cancelReason || cancelling} onPress={performCancel}>
                    {cancelling ? <ActivityIndicator color="#fff" size="small" /> : <Text style={st.dangerTxt}>Cancel booking</Text>}
                  </TouchableOpacity>
                </View>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {/* ══ RESCHEDULE SHEET ══ */}
      <Modal visible={!!resTarget} transparent animationType="slide" onRequestClose={() => !resSaving && setResTarget(null)} statusBarTranslucent>
        <View style={st.backdrop}>
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => !resSaving && setResTarget(null)} />
          <View style={[st.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 8, maxHeight: "92%" }]}>
            <View style={st.grabber} />
            <View style={st.sheetHead}>
              <Text style={st.sheetTitle}>Reschedule</Text>
              <TouchableOpacity style={st.closeX} onPress={() => !resSaving && setResTarget(null)} accessibilityLabel="Close"><Ionicons name="close" size={18} color={SLATE} /></TouchableOpacity>
            </View>
            {resTarget && (
              <>
                <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingBottom: 4 }}>
                  <View style={st.targetBox}>
                    <Text style={st.targetTitle}>{resTarget.userName || resTarget.customerName || "Customer"} · {resTarget.turfName || "Turf"}</Text>
                    <Text style={st.targetMeta}>Now: {shortDay(resTarget._day)} · {rangeM(resTarget._start, resTarget._end)} · {hrsTxt(resTarget._end - resTarget._start)}</Text>
                    <Text style={st.targetNote}>Same {hrsTxt(resTarget._end - resTarget._start)} — pick a new date and start time.{resTarget.source !== "offline" ? " The customer gets a message." : ""}</Text>
                  </View>

                  <View>
                    <View style={st.secHead}>
                      <Text style={st.kicker}>NEW DATE</Text>
                      <TouchableOpacity style={[st.calToggle, resCalOpen && { backgroundColor: BRAND, borderColor: BRAND }]} onPress={() => setResCalOpen(o => !o)}>
                        <Ionicons name="calendar-outline" size={14} color={resCalOpen ? "#fff" : BRAND} />
                        <Text style={[st.calToggleTxt, resCalOpen && { color: "#fff" }]}>{resCalOpen ? "Hide calendar" : "Calendar"}</Text>
                      </TouchableOpacity>
                    </View>
                    {resCalOpen ? (
                      <View style={st.calBox}>
                        <MonthCal month={resMonth} onMonth={setResMonth} today={today} selected={resDay}
                          minDay={today} maxDay={resMaxDay}
                          onPick={(day) => { setResDay(day); setResCalOpen(false); }} />
                      </View>
                    ) : (
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                        {(resDays.includes(resDay) ? resDays : [resDay, ...resDays]).map(day => {
                          const on = day === resDay;
                          const d = new Date(day);
                          return (
                            <TouchableOpacity key={day} style={[st.dayChip, on && st.dayChipOn]} onPress={() => setResDay(day)} accessibilityState={{ selected: on }}>
                              <Text style={[st.dayChipDow, on && { color: ON_BRAND }]}>{d.toLocaleDateString("en-US", { weekday: "short" }).toUpperCase()}</Text>
                              <Text style={[st.dayChipNum, on && { color: "#fff" }]}>{d.getDate()}</Text>
                              <Text style={[st.dayChipMon, on && { color: ON_BRAND }]}>{d.toLocaleDateString("en-US", { month: "short" })}</Text>
                            </TouchableOpacity>
                          );
                        })}
                      </ScrollView>
                    )}
                  </View>

                  <View>
                    <Text style={st.kicker}>NEW START TIME</Text>
                    {resLoadingSlots ? (
                      <View style={{ paddingVertical: 24, alignItems: "center" }}><ActivityIndicator color={ACCENT} /></View>
                    ) : resChips.filter(c => c.available).length === 0 ? (
                      <Text style={st.noSlots}>No free time of this length on {shortDay(resDay)}. Try another date.</Text>
                    ) : (
                      chipGroups.map(g => (
                        <View key={g.label} style={{ marginBottom: 8 }}>
                          <Text style={st.groupLbl}>{g.label}</Text>
                          <View style={st.chipGrid}>
                            {g.chips.map(c => {
                              const on = resStart === c.value;
                              return (
                                <TouchableOpacity key={c.value} disabled={!c.available} onPress={() => setResStart(c.value)}
                                  style={[st.timeChip, on && st.timeChipOn, !c.available && st.timeChipOff]}
                                  accessibilityState={{ selected: on, disabled: !c.available }}>
                                  <Text style={[st.timeChipTxt, on && { color: "#fff" }, !c.available && { color: "#CBD5E1", textDecorationLine: "line-through" }]}>
                                    {clockM(c.value * 60)}
                                  </Text>
                                </TouchableOpacity>
                              );
                            })}
                          </View>
                        </View>
                      ))
                    )}
                  </View>
                </ScrollView>

                <View style={[st.preview, resStart === null && { opacity: 0.5 }]}>
                  <Text style={st.previewLbl}>New time</Text>
                  <Text style={st.previewVal} numberOfLines={1}>
                    {resStart === null ? "Pick a start time" : `${shortDay(resDay)} · ${rangeM(resStart * 60, (resStart + resDuration) * 60)}`}
                  </Text>
                </View>
                <View style={st.btnRow}>
                  <TouchableOpacity style={[st.ghostBtn, { flex: 1 }]} disabled={resSaving} onPress={() => setResTarget(null)}>
                    <Text style={st.ghostTxt}>Back</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[st.primaryBtn, { flex: 1.6, marginTop: 0 }, (resStart === null || resSaving) && { opacity: 0.5 }]} disabled={resStart === null || resSaving} onPress={performReschedule}>
                    {resSaving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={st.primaryTxt}>Confirm new time</Text>}
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ── Month calendar (Mon-first) ──────────────────────────────────────────────
function MonthCal({ month, onMonth, today, selected, onPick, marks, inRange, minDay, maxDay }: {
  month: Date; onMonth: (d: Date) => void; today: number; selected: number | null; onPick: (day: number) => void;
  marks?: Record<number, number>; inRange?: (day: number) => boolean; minDay?: number; maxDay?: number;
}) {
  const y = month.getFullYear(), m = month.getMonth();
  const lead = (new Date(y, m, 1).getDay() + 6) % 7;
  const total = new Date(y, m + 1, 0).getDate();
  const cells: (number | null)[] = Array(lead).fill(null);
  for (let n = 1; n <= total; n++) cells.push(new Date(y, m, n).getTime());
  while (cells.length % 7) cells.push(null);
  const canPrev = minDay === undefined || new Date(y, m, 0).getTime() >= minDay;
  const canNext = maxDay === undefined || new Date(y, m + 1, 1).getTime() <= maxDay;
  return (
    <View>
      <View style={st.calHead}>
        <TouchableOpacity style={[st.sqBtn, !canPrev && { opacity: 0.3 }]} disabled={!canPrev} onPress={() => onMonth(new Date(y, m - 1, 1))} accessibilityLabel="Previous month">
          <Ionicons name="chevron-back" size={18} color={INK} />
        </TouchableOpacity>
        <Text style={st.calTitle}>{month.toLocaleDateString("en-US", { month: "long", year: "numeric" })}</Text>
        <TouchableOpacity style={[st.sqBtn, !canNext && { opacity: 0.3 }]} disabled={!canNext} onPress={() => onMonth(new Date(y, m + 1, 1))} accessibilityLabel="Next month">
          <Ionicons name="chevron-forward" size={18} color={INK} />
        </TouchableOpacity>
      </View>
      <View style={st.calGrid}>
        {["M", "T", "W", "T", "F", "S", "S"].map((w, i) => <Text key={`w${i}`} style={st.calWeek}>{w}</Text>)}
      </View>
      <View style={st.calGrid}>
        {cells.map((t, i) => {
          if (t === null) return <View key={`b${i}`} style={st.calCell} />;
          const off = (minDay !== undefined && t < minDay) || (maxDay !== undefined && t > maxDay);
          const sel = t === selected;
          const rng = inRange?.(t);
          const n = marks?.[t] || 0;
          return (
            <TouchableOpacity key={t} style={st.calCell} disabled={off} onPress={() => onPick(t)}
              accessibilityLabel={`${new Date(t).toDateString()}${marks ? `, ${n} bookings` : ""}`} accessibilityState={{ selected: sel, disabled: off }}>
              <View style={[st.calDay, rng && { backgroundColor: GREEN_TINT }, sel && st.calDaySel, off && { opacity: 0.3 }]}>
                <View style={[st.calNum, t === today && { backgroundColor: BRAND }]}>
                  <Text style={[st.calNumTxt, t === today && { color: "#fff" }]}>{new Date(t).getDate()}</Text>
                </View>
                <View style={[st.dotSm, { backgroundColor: n ? ACCENT : "transparent" }]} />
              </View>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────
const shadow = { shadowColor: INK, shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 2 }, elevation: 2 };

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: PAGE },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: PAGE },
  loadTxt: { marginTop: 12, color: MUTED, fontSize: 15, fontWeight: "600" },

  header: { backgroundColor: BRAND, paddingHorizontal: 16, paddingBottom: 14, borderBottomLeftRadius: 22, borderBottomRightRadius: 22, gap: 12 },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  hKicker: { fontSize: 10, letterSpacing: 1.4, fontWeight: "800", color: ON_BRAND },
  hTitle: { fontSize: 20, fontWeight: "900", color: "#fff" },
  hBtn: { width: 44, height: 44, borderRadius: 13, backgroundColor: "rgba(255,255,255,0.14)", alignItems: "center", justifyContent: "center" },
  statRow: { flexDirection: "row", gap: 8 },
  stat: { flex: 1, backgroundColor: INK, borderRadius: 12, paddingVertical: 8, paddingHorizontal: 10 },
  statNum: { fontSize: 16, fontWeight: "900", color: "#fff" },
  statLbl: { fontSize: 10.5, fontWeight: "700", color: FAINT },

  tabs: { flexDirection: "row", backgroundColor: "#E6EAF0", borderRadius: 14, padding: 4, gap: 2 },
  tab: { flex: 1, height: 40, borderRadius: 11, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, paddingHorizontal: 2 },
  tabOn: { backgroundColor: BRAND },
  tabTxt: { fontSize: 12, fontWeight: "800", color: "#374151", flexShrink: 1 },
  tabCount: { minWidth: 18, height: 18, paddingHorizontal: 4, borderRadius: 9, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" },
  tabCountTxt: { fontSize: 10.5, fontWeight: "900", color: INK },

  filterCard: { backgroundColor: "#fff", borderRadius: 18, padding: 12, gap: 10, ...shadow },
  dateBtn: { flex: 1, height: 44, borderRadius: 12, borderWidth: 1, borderColor: GREEN_BORDER, backgroundColor: GREEN_TINT, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12 },
  dateBtnTxt: { flex: 1, fontSize: 13, fontWeight: "800", color: BRAND },
  srcBtn: { height: 44, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: LINE, backgroundColor: "#fff", flexDirection: "row", alignItems: "center", gap: 6 },
  srcTxt: { fontSize: 13, fontWeight: "800", color: "#334155" },
  dot: { width: 8, height: 8, borderRadius: 4 },
  turfChip: { height: 36, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: LINE, backgroundColor: "#fff", justifyContent: "center", maxWidth: 180 },
  turfChipOn: { backgroundColor: INK, borderColor: INK },
  turfChipTxt: { fontSize: 12.5, fontWeight: "800", color: "#334155" },
  resultRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 2 },
  resultTxt: { fontSize: 12, fontWeight: "800", letterSpacing: 0.6, color: SLATE },
  clearTxt: { fontSize: 12.5, fontWeight: "800", color: BRAND },

  dayHead: { flexDirection: "row", alignItems: "center", gap: 10, marginHorizontal: 14, marginTop: 14, marginBottom: 8 },
  dayBadge: { width: 44, paddingVertical: 5, borderRadius: 12, backgroundColor: "#fff", alignItems: "center", ...shadow },
  dayDow: { fontSize: 10, fontWeight: "800", color: MUTED },
  dayNum: { fontSize: 16, fontWeight: "900", color: INK },
  dayName: { fontSize: 14.5, fontWeight: "900", color: INK },
  daySub: { fontSize: 11.5, fontWeight: "700", color: MUTED },

  card: { backgroundColor: "#fff", borderRadius: 18, padding: 12, ...shadow },
  cardLive: { borderWidth: 1.5, borderColor: ACCENT },
  timeCol: { width: 56, alignItems: "center" },
  timeStart: { fontSize: 17, fontWeight: "900", color: INK, letterSpacing: -0.4 },
  timeAp: { fontSize: 10, fontWeight: "800", color: MUTED, marginTop: -2 },
  timeLine: { width: 3, height: 16, borderRadius: 2, marginVertical: 4 },
  timeEnd: { fontSize: 10.5, fontWeight: "700", color: MUTED, textAlign: "center" },
  rowTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  cardName: { flex: 1, fontSize: 15, fontWeight: "900", color: INK },
  cardTurf: { fontSize: 12, fontWeight: "600", color: MUTED, marginTop: 1 },
  statePill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  stateTxt: { fontSize: 10.5, fontWeight: "800" },
  pillRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 7 },
  pill: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  pillTxt: { fontSize: 10.5, fontWeight: "800" },
  moneyRow: { flexDirection: "row", gap: 6, marginTop: 12 },
  moneyBox: { flex: 1, borderRadius: 11, paddingVertical: 7, paddingHorizontal: 9 },
  moneyLbl: { fontSize: 9.5, fontWeight: "800", letterSpacing: 0.4, color: MUTED },
  moneyVal: { fontSize: 14, fontWeight: "900", color: INK },
  actRow: { flexDirection: "row", gap: 8, marginTop: 12 },
  actBtn: { flex: 1, height: 40, borderRadius: 11, borderWidth: 1, borderColor: "#E2E8F0", backgroundColor: "#fff", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5 },
  actTxt: { fontSize: 12.5, fontWeight: "800", color: INK },
  created: { fontSize: 10.5, fontWeight: "600", color: FAINT, marginTop: 8 },

  empty: { alignItems: "center", paddingTop: 40, paddingHorizontal: 36 },
  emptyIcon: { width: 60, height: 60, borderRadius: 20, backgroundColor: "#DCFCE7", alignItems: "center", justifyContent: "center" },
  emptyTitle: { fontSize: 15, fontWeight: "900", color: INK, marginTop: 10, textAlign: "center" },
  emptySub: { fontSize: 13, color: MUTED, textAlign: "center", marginTop: 4, lineHeight: 19, fontWeight: "600" },
  emptyBtn: { marginTop: 16, backgroundColor: BRAND, paddingHorizontal: 20, height: 44, justifyContent: "center", borderRadius: 12 },
  emptyBtnTxt: { color: "#fff", fontSize: 13, fontWeight: "800" },

  // sheets
  backdrop: { flex: 1, backgroundColor: "rgba(11,18,32,0.55)" },
  sheet: { backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 16, paddingTop: 10, gap: 12 },
  grabber: { width: 40, height: 4, borderRadius: 2, backgroundColor: "#CBD5E1", alignSelf: "center" },
  sheetHead: { flexDirection: "row", alignItems: "center" },
  sheetTitle: { flex: 1, fontSize: 18, fontWeight: "900", color: INK },
  closeX: { width: 36, height: 36, borderRadius: 18, backgroundColor: "#F1F5F9", alignItems: "center", justifyContent: "center" },
  kicker: { fontSize: 10.5, letterSpacing: 0.9, fontWeight: "800", color: MUTED, marginBottom: 8 },
  quickWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  quick: { height: 36, paddingHorizontal: 13, borderRadius: 999, borderWidth: 1, borderColor: LINE, backgroundColor: "#fff", justifyContent: "center" },
  quickOn: { backgroundColor: INK, borderColor: INK },
  quickTxt: { fontSize: 12.5, fontWeight: "800", color: "#334155" },
  calBox: { borderWidth: 1, borderColor: "#EEF1F5", borderRadius: 16, padding: 10 },
  calHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 },
  calTitle: { fontSize: 15, fontWeight: "900", color: INK },
  sqBtn: { width: 40, height: 40, borderRadius: 12, borderWidth: 1, borderColor: LINE, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" },
  calGrid: { flexDirection: "row", flexWrap: "wrap" },
  calWeek: { width: "14.2857%", textAlign: "center", fontSize: 11, fontWeight: "800", color: MUTED, paddingVertical: 4 },
  calCell: { width: "14.2857%", height: 46, alignItems: "center", justifyContent: "center" },
  calDay: { width: 42, height: 42, borderRadius: 12, alignItems: "center", justifyContent: "center", gap: 3 },
  calDaySel: { backgroundColor: GREEN_TINT, borderWidth: 1.5, borderColor: ACCENT },
  calNum: { minWidth: 26, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center", paddingHorizontal: 3 },
  calNumTxt: { fontSize: 14, fontWeight: "800", color: INK },
  dotSm: { width: 6, height: 6, borderRadius: 3 },
  dotLg: { width: 14, height: 14, borderRadius: 7 },
  legendRow: { flexDirection: "row", gap: 14, marginTop: 6 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  legendTxt: { fontSize: 11, fontWeight: "700", color: SLATE },

  primaryBtn: { height: 50, borderRadius: 14, backgroundColor: BRAND, alignItems: "center", justifyContent: "center" },
  primaryTxt: { fontSize: 15, fontWeight: "800", color: "#fff" },
  ghostBtn: { height: 50, borderRadius: 14, backgroundColor: "#F1F5F9", alignItems: "center", justifyContent: "center" },
  ghostTxt: { fontSize: 14, fontWeight: "800", color: "#334155" },
  dangerBtn: { height: 50, borderRadius: 14, backgroundColor: "#DC2626", alignItems: "center", justifyContent: "center" },
  dangerTxt: { fontSize: 14.5, fontWeight: "800", color: "#fff" },
  btnRow: { flexDirection: "row", gap: 8, marginTop: 4 },

  targetBox: { backgroundColor: "#F5F7FA", borderRadius: 14, padding: 12 },
  targetTitle: { fontSize: 14.5, fontWeight: "900", color: INK },
  targetMeta: { fontSize: 12.5, fontWeight: "700", color: MUTED, marginTop: 2 },
  targetNote: { fontSize: 11.5, fontWeight: "700", color: "#B45309", marginTop: 6 },
  reason: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 48, borderRadius: 13, borderWidth: 1, borderColor: "#EEF1F5", backgroundColor: "#F8FAFC", paddingHorizontal: 14 },
  reasonOn: { backgroundColor: GREEN_TINT, borderColor: GREEN_BORDER },
  reasonTxt: { flex: 1, fontSize: 13.5, fontWeight: "700", color: "#334155" },

  secHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 2 },
  calToggle: { height: 32, paddingHorizontal: 10, borderRadius: 10, borderWidth: 1, borderColor: GREEN_BORDER, backgroundColor: GREEN_TINT, flexDirection: "row", alignItems: "center", gap: 5, marginBottom: 8 },
  calToggleTxt: { fontSize: 12, fontWeight: "800", color: BRAND },
  dayChip: { width: 54, height: 64, borderRadius: 13, borderWidth: 1, borderColor: LINE, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" },
  dayChipOn: { backgroundColor: BRAND, borderColor: BRAND },
  dayChipDow: { fontSize: 10, fontWeight: "800", color: MUTED },
  dayChipNum: { fontSize: 18, fontWeight: "900", color: INK },
  dayChipMon: { fontSize: 9.5, fontWeight: "700", color: MUTED },
  groupLbl: { fontSize: 11, fontWeight: "800", color: FAINT, marginBottom: 6 },
  chipGrid: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  timeChip: { flexBasis: "23%", flexGrow: 1, maxWidth: "25%", height: 40, borderRadius: 10, borderWidth: 1, borderColor: LINE, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" },
  timeChipOn: { backgroundColor: BRAND, borderColor: BRAND },
  timeChipOff: { backgroundColor: "#F8FAFC", borderColor: "#F1F5F9" },
  timeChipTxt: { fontSize: 12, fontWeight: "800", color: INK },
  noSlots: { fontSize: 13, color: MUTED, fontWeight: "600", paddingVertical: 16, textAlign: "center" },
  preview: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8, borderRadius: 12, padding: 12, backgroundColor: GREEN_TINT, borderWidth: 1, borderColor: GREEN_BORDER },
  previewLbl: { fontSize: 12, fontWeight: "800", color: "#166534" },
  previewVal: { flexShrink: 1, fontSize: 14, fontWeight: "900", color: BRAND },
});
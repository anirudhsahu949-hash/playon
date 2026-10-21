// Block Slots — owner slot panel (single file, v2 design)
// • Main: compact 3-per-row slot grid grouped by time of day, flexible-time
//   tap grid, turf + date card, recurring row with active series.
// • Choose action: bottom sheet (Offline booking / Block only).
// • Offline booking + recurring details: keyboard-safe on iPhone & Android,
//   Save bar rides on top of the keyboard.
// • Recurring wizard: 4 steps with progress bar, start-date stepper + calendar.
// • NEW: after saving an offline booking, WhatsApp opens in the customer's
//   chat with the booking confirmation typed in (toggle in the form).
// • NEW: saved customers — recent chips, suggestions while typing, "All
//   customers" opens the Customers screen to pick one, and a "Save to my
//   customers" checkbox for new people (offline + recurring forms).
// All Firestore reads/writes are unchanged from the previous version.

import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, Alert, StatusBar, ActivityIndicator,
  RefreshControl, TextInput, ScrollView, Platform, LayoutAnimation, UIManager, BackHandler,
  Modal, KeyboardAvoidingView, Pressable,
} from "react-native";
import { useRouter, useFocusEffect, useNavigation, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useEffect, useMemo, useRef, useState, useCallback, ReactNode } from "react";
import { auth, db } from "../../firebaseConfig";
import {
  collection, getDocs, query, where, addDoc, deleteDoc, doc, serverTimestamp, updateDoc, writeBatch,
} from "firebase/firestore";
import { waNumber, buildBookingMessage, openWhatsApp } from "../../utils/whatsapp";
import {
  Customer, listCustomers, saveCustomer, recordCustomerBooking, findCustomer, searchCustomers,
  customerMeta, onCustomerPicked,
} from "../../utils/customers";

// ─── Palette ──────────────────────────────────────────────────────────────────
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
const WA_GREEN = "#25D366";

const TONE = {
  free:    { bg: "#FFFFFF", border: "#E5E7EB", fg: INK },
  sel:     { bg: ACCENT, border: ACCENT, fg: "#FFFFFF" },
  range:   { bg: ACCENT_TINT, border: ACCENT_BORDER, fg: ACCENT_DARK },
  app:     { bg: "#EFF6FF", border: "#BFDBFE", fg: "#1D4ED8" },
  offline: { bg: "#EEF2FF", border: "#C7D2FE", fg: "#4338CA" },
  blocked: { bg: "#FFF7ED", border: "#FED7AA", fg: "#C2410C" },
  taken:   { bg: "#E6EAF0", border: "#E6EAF0", fg: FAINT },
};

// ─── Types ────────────────────────────────────────────────────────────────────
type BookMode = "quick" | "flexible";
type Screen = "main" | "offline" | "recurring";
type RecurType = "block" | "offline";
type RecurStep = 1 | 2 | 3 | 4;
type TileStatus = "free" | "app" | "offline" | "blocked";

interface TimeChip { value: number; label: string; status: "available" | "booked" | "blocked" }
interface QuickSlot { time: string; startValue: number; endValue: number }
interface RecurPreviewDate { date: Date; dateKey: string; status: "available" | "conflict"; reason?: string; include: boolean }

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON_FIRST = [1, 2, 3, 4, 5, 6, 0];
const MAX_RECURRING_OCCURRENCES = 24;
const OWNER_DAYS_AHEAD = 60;
const MAX_BLOCK_SLOTS = 18;
const STEP = 0.5;

// ─── Helpers ──────────────────────────────────────────────────────────────────
const pad = (n: number) => String(n).padStart(2, "0");

function formatTime(v: number): string {
  if (v >= 24) v -= 24;
  const hour = Math.floor(v);
  const minute = Math.round((v % 1) * 60);
  const suffix = hour >= 12 ? "PM" : "AM";
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h}:${pad(minute)} ${suffix}`;
}
/** 17 → "5", 17.5 → "5:30" */
function compact(v: number): string {
  const x = ((v % 24) + 24) % 24;
  const hour = Math.floor(x), minute = Math.round((x % 1) * 60);
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return minute ? `${h}:${pad(minute)}` : `${h}`;
}
const period = (v: number) => ((((v % 24) + 24) % 24) >= 12 ? "PM" : "AM");
/** 8,9 → "8–9 AM"; 11,13 → "11 AM–1 PM" */
function rangeShort(a: number, b: number): string {
  const pa = period(a), pb = period(b);
  return `${compact(a)}${pa !== pb ? ` ${pa}` : ""}–${compact(b)} ${pb}`;
}
const clockShort = (v: number) => `${compact(v)} ${period(v)}`;

function parseTime(s: string): number {
  const parts = s.trim().split(" ");
  const [hStr, mStr] = parts[0].split(":");
  let h = Number(hStr);
  const m = Number(mStr || 0);
  const p = parts[1];
  if (p === "PM" && h !== 12) h += 12;
  if (p === "AM" && h === 12) h = 0;
  return h + m / 60;
}
function parseSlotRange(slotTime: string, open = 0, late = false): { start: number; end: number } {
  const parts = slotTime.split(" - ");
  let start = parseTime(parts[0].trim());
  let end = parseTime(parts[1].trim());
  if (late && start < open) start += 24;
  if (late && end < open) end += 24;
  if (end <= start) end = 24;
  return { start, end };
}
const rangesOverlap = (aS: number, aE: number, bS: number, bE: number) => aS < bE && bS < aE;
function buildTimeRange(start: number, end: number): string[] {
  const out: string[] = [];
  for (let t = start; t < end; t += 0.5) out.push(`${formatTime(t)} - ${formatTime(Math.min(t + 0.5, end))}`);
  return out;
}
function mergeSlotDisplay(slots: string[]) {
  if (!slots || slots.length === 0) return "";
  return `${slots[0].split(" - ")[0]} - ${slots[slots.length - 1].split(" - ")[1]}`;
}
const isToday = (d: Date) => d.toDateString() === new Date().toDateString();
const currentDecimal = () => { const n = new Date(); return n.getHours() + n.getMinutes() / 60; };
const dayStart = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime(); };
const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
const fmtDay = (d: Date) => d.toLocaleDateString("en-US", { weekday: "short", day: "numeric", month: "short" });
const slotsOfBooking = (b: any): string[] => b.selectedSlots || [b.slotTime, b.slot].filter(Boolean);
const slotsOfBlock = (b: any): string[] => (Array.isArray(b.slots) ? b.slots : [b.slotTime].filter(Boolean));

function computeRecurDates(startDate: Date, days: number[], count: number): Date[] {
  const result: Date[] = [];
  if (days.length === 0 || count <= 0) return result;
  const cursor = new Date(startDate); cursor.setHours(0, 0, 0, 0);
  let safety = 0;
  while (result.length < count && safety < 400) {
    if (days.includes(cursor.getDay())) result.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
    safety++;
  }
  return result;
}
function daysText(days: number[]): string {
  if (days.length === 7) return "Every day";
  const names = MON_FIRST.filter(d => days.includes(d)).map(d => DAY_NAMES[d]);
  if (!names.length) return "";
  if (names.length === 1) return `Every ${names[0]}`;
  return `Every ${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}`;
}
/** Time-of-day bucket for grouping slot grids */
function bucketOf(v: number): string {
  if (v >= 24) return "LATE NIGHT";
  if (v < 12) return "MORNING";
  if (v < 17) return "AFTERNOON";
  if (v < 21) return "EVENING";
  return "NIGHT";
}
function groupBy<T>(items: T[], key: (t: T) => string): { name: string; items: T[] }[] {
  const out: { name: string; items: T[] }[] = [];
  items.forEach(it => {
    const k = key(it);
    const last = out[out.length - 1];
    if (last && last.name === k) last.items.push(it); else out.push({ name: k, items: [it] });
  });
  return out;
}

// ═════════════════════════════════════════════════════════════════════════════
// MAIN
// ═════════════════════════════════════════════════════════════════════════════
export default function BlockSlots() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const navigation = useNavigation();
  // Opened from Schedule → "Block or book a free time" passes turfId + date
  const params = useLocalSearchParams<{ turfId?: string; date?: string }>();

  const [turfs, setTurfs] = useState<any[]>([]);
  const [selectedTurf, setSelectedTurf] = useState<any>(null);
  const [blockedDocs, setBlockedDocs] = useState<any[]>([]);
  const [bookedDocs, setBookedDocs] = useState<any[]>([]);
  const [selectedDate, setSelectedDate] = useState(new Date());

  const [pageLoading, setPageLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);

  const [screen, setScreen] = useState<Screen>("main");
  const [actionOpen, setActionOpen] = useState(false);

  const [bookMode, setBookMode] = useState<BookMode>("quick");
  const [selectedQuickSlots, setSelectedQuickSlots] = useState<QuickSlot[]>([]);
  const [flexStart, setFlexStart] = useState<number | null>(null);
  const [flexEnd, setFlexEnd] = useState<number | null>(null);
  const [activePanel, setActivePanel] = useState<"from" | "to" | null>("from");

  // offline form
  const [custName, setCustName] = useState("");
  const [custPhone, setCustPhone] = useState("");
  const [custNote, setCustNote] = useState("");
  const [custAmount, setCustAmount] = useState("");
  const [remainingAmount, setRemainingAmount] = useState("");
  const [sendWA, setSendWA] = useState(false);
  const [saveCust, setSaveCust] = useState(false);
  const [pendingDocId, setPendingDocId] = useState<string | null>(null);

  // saved customers
  const [customers, setCustomers] = useState<Customer[]>([]);
  const refreshCustomers = () => listCustomers().then(setCustomers).catch(() => {});
  const selectedDateKey = useMemo(() => selectedDate.toDateString(), [selectedDate]);

  const [showSeries, setShowSeries] = useState(false);

  // recurring wizard
  const [recurStep, setRecurStep] = useState<RecurStep>(1);
  const [recurMode, setRecurMode] = useState<BookMode>("quick");
  const [recurSelectedSlots, setRecurSelectedSlots] = useState<QuickSlot[]>([]);
  const [recurFlexStart, setRecurFlexStart] = useState<number | null>(null);
  const [recurFlexEnd, setRecurFlexEnd] = useState<number | null>(null);
  const [recurDays, setRecurDays] = useState<number[]>([]);
  const [recurStartDate, setRecurStartDate] = useState<Date>(new Date());
  const [recurCalOpen, setRecurCalOpen] = useState(true);
  const [recurCalMonth, setRecurCalMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [recurOccurrences, setRecurOccurrences] = useState(4);
  const [recurType, setRecurType] = useState<RecurType>("offline");
  const [recurCustName, setRecurCustName] = useState("");
  const [recurCustPhone, setRecurCustPhone] = useState("");
  const [recurAmountPerSession, setRecurAmountPerSession] = useState("");
  const [recurNote, setRecurNote] = useState("");
  const [recurSaveCust, setRecurSaveCust] = useState(false);
  const [recurSeriesLabel, setRecurSeriesLabel] = useState("");
  const [recurChecking, setRecurChecking] = useState(false);
  const [recurPreview, setRecurPreview] = useState<RecurPreviewDate[]>([]);
  const [recurSaving, setRecurSaving] = useState(false);
  const [seriesDocs, setSeriesDocs] = useState<any[]>([]);

  const formScroll = useRef<ScrollView>(null);
  const scrollFormToEnd = () => setTimeout(() => formScroll.current?.scrollToEnd({ animated: true }), 250);

  useEffect(() => {
    if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
      UIManager.setLayoutAnimationEnabledExperimental(true);
    }
  }, []);

  // iPhone swipe-back would leave the whole route — only allow it on the main screen
  useEffect(() => {
    (navigation as any).setOptions?.({ gestureEnabled: screen === "main" && !actionOpen });
  }, [navigation, screen, actionOpen]);

  // Android back: step back inside this screen.
  // Only while this screen is in front — otherwise Back on the Customers
  // screen (opened from the form) would cancel the booking underneath.
  useFocusEffect(useCallback(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (actionOpen) { setActionOpen(false); return true; }
      if (screen === "recurring") { recurBack(); return true; }
      if (screen === "offline") { cancelOfflineBooking(); return true; }
      return false;
    });
    return () => sub.remove();
  }, [screen, recurStep, pendingDocId, actionOpen]));

  // ─── Data ──────────────────────────────────────────────────────────────────
  useEffect(() => { loadTurfs(); fetchSeries(); }, []);
  // reload saved customers every time this screen comes back into view
  useFocusEffect(useCallback(() => { refreshCustomers(); }, []));

  // Apply turf/date sent from Schedule (also when the screen is already open)
  useEffect(() => {
    if (params.turfId && turfs.length) {
      const t = turfs.find(x => x.id === String(params.turfId));
      if (t) setSelectedTurf(t);
    }
    if (params.date) {
      const d = new Date(String(params.date));
      const today = new Date(); today.setHours(0, 0, 0, 0);
      if (!isNaN(d.getTime()) && d.getTime() >= today.getTime()) { setSelectedDate(d); setViewMonth(monthKey(d)); setCalMonth(new Date(d.getFullYear(), d.getMonth(), 1)); }
    }
  }, [params.turfId, params.date, turfs.length]);
  useFocusEffect(useCallback(() => { if (selectedTurf?.id) fetchDayData(); }, [selectedTurf, selectedDate]));
  useEffect(() => { clearSelection(); }, [selectedDate, bookMode, selectedTurf]);

  const loadTurfs = async () => {
    const uid = auth.currentUser?.uid;
    if (!uid) { setPageLoading(false); return; }
    try {
      const snap = await getDocs(query(collection(db, "turfs"), where("ownerId", "==", uid)));
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setTurfs(data);
      const wanted = params.turfId ? data.find(t => t.id === String(params.turfId)) : null;
      if (data.length > 0) setSelectedTurf(wanted || data[0]);
    } catch {
      Alert.alert("Error", "Unable to load turfs.");
    } finally {
      setPageLoading(false);
    }
  };

  const fetchDayData = async (isRefresh = false) => {
    if (!selectedTurf?.id) return;
    try {
      if (isRefresh) setRefreshing(true);
      const [blockedSnap, bookedSnap] = await Promise.all([
        getDocs(query(collection(db, "blockedSlots"), where("turfId", "==", selectedTurf.id), where("date", "==", selectedDateKey))),
        getDocs(query(collection(db, "bookings"), where("turfId", "==", selectedTurf.id), where("dateString", "==", selectedDateKey))),
      ]);
      setBlockedDocs(blockedSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      setBookedDocs(bookedSnap.docs.map(d => ({ id: d.id, ...d.data() } as any)).filter((b: any) => b.status !== "cancelled"));
    } catch {
      Alert.alert("Error", "Unable to load slots.");
    } finally {
      setRefreshing(false);
    }
  };

  // ─── Turf values ───────────────────────────────────────────────────────────
  const openingTime = useMemo(() => Number(selectedTurf?.openingTime ?? 6), [selectedTurf]);
  const closingTime = useMemo(() => { const c = Number(selectedTurf?.closingTime ?? 23); return c === 0 ? 24 : c; }, [selectedTurf]);
  const slotDuration = useMemo(() => Number(selectedTurf?.slotDuration ?? 60) / 60, [selectedTurf]);
  const parseRange = (s: string) => parseSlotRange(s, openingTime, closingTime > 24);
  const overlapsStr = (s: string, a: number, b: number) => {
    try { const p = parseRange(s); return rangesOverlap(a, b, p.start, p.end); } catch { return false; }
  };

  const allUnavailable = useMemo((): string[] => [
    ...bookedDocs.flatMap(slotsOfBooking), ...blockedDocs.flatMap(slotsOfBlock),
  ], [bookedDocs, blockedDocs]);

  function isPast(v: number) {
    const y = new Date(); y.setDate(y.getDate() - 1);
    if (selectedDate.toDateString() === y.toDateString()) return v < currentDecimal() + 24;
    return isToday(selectedDate) && v < currentDecimal();
  }
  const isRangeUnavailable = (start: number, end: number) => allUnavailable.some(s => overlapsStr(s, start, end));

  function chipStatus(start: number): TimeChip["status"] {
    const end = start + STEP;
    if (bookedDocs.some(b => slotsOfBooking(b).some(s => overlapsStr(s, start, end)))) return "booked";
    if (blockedDocs.some(b => slotsOfBlock(b).some((s: string) => overlapsStr(s, start, end)))) return "blocked";
    return "available";
  }

  const fromChips = useMemo<TimeChip[]>(() => {
    const chips: TimeChip[] = [];
    for (let t = openingTime; t < closingTime; t += STEP) {
      if (isPast(t)) continue;
      chips.push({ value: t, label: compact(t), status: chipStatus(t) });
    }
    return chips;
  }, [selectedTurf, selectedDate, allUnavailable, openingTime, closingTime]);

  const toChips = useMemo<TimeChip[]>(() => {
    if (flexStart === null) return [];
    const chips: TimeChip[] = [];
    for (let t = flexStart + STEP; t <= closingTime; t += STEP) {
      if (isRangeUnavailable(flexStart, t)) break;
      chips.push({ value: t, label: compact(t), status: "available" });
    }
    return chips;
  }, [flexStart, closingTime, allUnavailable, selectedDate]);

  const quickSlots = useMemo<QuickSlot[]>(() => {
    if (!selectedTurf) return [];
    const out: QuickSlot[] = [];
    for (let t = openingTime; t + slotDuration <= closingTime; t += slotDuration) {
      if (isPast(t)) continue;
      out.push({ time: `${formatTime(t)} - ${formatTime(t + slotDuration)}`, startValue: t, endValue: t + slotDuration });
    }
    return out;
  }, [selectedTurf, selectedDate, openingTime, closingTime, slotDuration]);

  // Status of every quick slot — drives the grid AND the header counts
  const quickTiles = useMemo(() => quickSlots.map(slot => {
    const app = bookedDocs.some(b => slotsOfBooking(b).some(s => overlapsStr(s, slot.startValue, slot.endValue)));
    const blockedDoc = app ? undefined : blockedDocs.find(b => slotsOfBlock(b).some((s: string) => overlapsStr(s, slot.startValue, slot.endValue)));
    const status: TileStatus = app ? "app" : blockedDoc ? (blockedDoc.type === "offline" ? "offline" : "blocked") : "free";
    return { slot, status, blockedDoc };
  }), [quickSlots, bookedDocs, blockedDocs]);

  const counts = useMemo(() => ({
    free: quickTiles.filter(t => t.status === "free").length,
    app: quickTiles.filter(t => t.status === "app").length,
    offline: quickTiles.filter(t => t.status === "offline").length,
    blocked: quickTiles.filter(t => t.status === "blocked").length,
  }), [quickTiles]);

  // ─── Derived selection ─────────────────────────────────────────────────────
  const selectedStart = useMemo(() => {
    if (bookMode === "quick" && selectedQuickSlots.length > 0)
      return [...selectedQuickSlots].sort((a, b) => a.startValue - b.startValue)[0].startValue;
    return bookMode === "flexible" ? flexStart : null;
  }, [bookMode, selectedQuickSlots, flexStart]);
  const selectedEnd = useMemo(() => {
    if (bookMode === "quick" && selectedQuickSlots.length > 0)
      return [...selectedQuickSlots].sort((a, b) => b.endValue - a.endValue)[0].endValue;
    return bookMode === "flexible" ? flexEnd : null;
  }, [bookMode, selectedQuickSlots, flexEnd]);
  const selectedSlots = useMemo(() =>
    selectedStart === null || selectedEnd === null || selectedEnd <= selectedStart ? [] : buildTimeRange(selectedStart, selectedEnd),
  [selectedStart, selectedEnd]);
  const durationMinutes = selectedStart === null || selectedEnd === null || selectedEnd <= selectedStart ? 0 : Math.round((selectedEnd - selectedStart) * 60);
  const durationLabel = (() => {
    const h = Math.floor(durationMinutes / 60), m = durationMinutes % 60;
    return !h ? `${m}m` : !m ? `${h}h` : `${h}h ${m}m`;
  })();
  const hasValidSelection = selectedStart !== null && selectedEnd !== null && selectedEnd > selectedStart &&
    selectedEnd <= closingTime && !isPast(selectedStart) && !isRangeUnavailable(selectedStart, selectedEnd);
  const timeLabel = hasValidSelection ? `${clockShort(selectedStart!)} → ${clockShort(selectedEnd!)}` : "";

  // ─── Selection handlers ────────────────────────────────────────────────────
  function handleQuickPress(slot: QuickSlot) {
    const exists = selectedQuickSlots.some(s => s.time === slot.time);
    if (exists) { setSelectedQuickSlots(selectedQuickSlots.filter(s => s.time !== slot.time)); return; }
    if (selectedQuickSlots.length === 0) { setSelectedQuickSlots([slot]); return; }
    const sorted = [...selectedQuickSlots].sort((a, b) => a.startValue - b.startValue);
    const first = sorted[0], last = sorted[sorted.length - 1];
    if (slot.endValue === first.startValue || slot.startValue === last.endValue) {
      if (selectedQuickSlots.length >= MAX_BLOCK_SLOTS) return Alert.alert("Limit reached", `You can select up to ${MAX_BLOCK_SLOTS} slots in a row.`);
      setSelectedQuickSlots([...selectedQuickSlots, slot]);
    } else {
      // Not next to the current selection: start a new selection from this slot
      setSelectedQuickSlots([slot]);
    }
  }
  function handleSelectFrom(chip: TimeChip) {
    if (chip.status !== "available") return;
    setFlexStart(chip.value); setFlexEnd(null); setActivePanel("to");
  }
  function handleSelectTo(chip: TimeChip) { setFlexEnd(chip.value); setActivePanel(null); }
  function clearSelection() {
    setSelectedQuickSlots([]); setFlexStart(null); setFlexEnd(null); setActivePanel("from");
  }
  function clearForm() {
    setCustName(""); setCustPhone(""); setCustNote(""); setCustAmount(""); setRemainingAmount(""); setSendWA(false); setSaveCust(false);
  }

  // ─── Saved customers ───────────────────────────────────────────────────────
  /** Opens the Customers screen in pick mode; the picked customer fills the form */
  function openCustomerPicker(target: "offline" | "recur") {
    onCustomerPicked(c => {
      if (target === "offline") { setCustName(c.name); setCustPhone(c.phone || ""); }
      else { setRecurCustName(c.name); setRecurCustPhone(c.phone || ""); }
      refreshCustomers();
    });
    const typed = target === "offline" ? custName : recurCustName;
    router.push({ pathname: "/(owner)/customers", params: { pick: "1", q: typed.trim() } } as any);
  }

  /** After a booking is saved: +1 for a saved customer, or save a new one if ticked */
  async function rememberCustomer(name: string, phone: string, wantSave: boolean) {
    try {
      const match = findCustomer(customers, name, phone);
      if (match) await recordCustomerBooking(match.id);
      else if (wantSave && name.trim()) await saveCustomer({ name, phone }, { countBooking: true });
      refreshCustomers();
    } catch { /* not critical — the booking itself is already saved */ }
  }

  // ─── Save actions ──────────────────────────────────────────────────────────
  async function saveBlock() {
    if (!hasValidSelection) return;
    setSaving(true);
    try {
      await addDoc(collection(db, "blockedSlots"), {
        turfId: selectedTurf.id, turfName: selectedTurf.name || "", slots: selectedSlots,
        date: selectedDateKey, ownerId: auth.currentUser?.uid, type: "block", createdAt: serverTimestamp(),
      });
      setActionOpen(false);
      clearSelection();
      await fetchDayData();
      Alert.alert("Done", "Slots blocked.");
    } catch {
      Alert.alert("Error", "Something went wrong.");
    } finally {
      setSaving(false);
    }
  }

  // Locks the slot first so nobody books it while the owner types details
  async function startOfflineBooking() {
    if (!hasValidSelection) return;
    setSaving(true);
    try {
      const ref = await addDoc(collection(db, "blockedSlots"), {
        turfId: selectedTurf.id, turfName: selectedTurf.name || "", slots: selectedSlots,
        date: selectedDateKey, ownerId: auth.currentUser?.uid, type: "block", pending: true, createdAt: serverTimestamp(),
      });
      setPendingDocId(ref.id);
      setActionOpen(false);
      setScreen("offline");
      await fetchDayData();
    } catch {
      Alert.alert("Error", "Could not lock the slot. Try again.");
    } finally {
      setSaving(false);
    }
  }

  async function unblockDoc(id: string) {
    setSaving(true);
    try { await deleteDoc(doc(db, "blockedSlots", id)); await fetchDayData(); }
    catch { Alert.alert("Error", "Could not free slot."); }
    finally { setSaving(false); }
  }

  async function saveOfflineBooking() {
    if (!pendingDocId) return;
    if (!custName.trim()) return Alert.alert("Name required", "Please enter the customer name.");

    const phone = custPhone.trim();
    if (phone && !waNumber(phone)) {
      return Alert.alert("Check phone number", "Enter a valid 10-digit mobile number, or leave it empty.");
    }

    const total = Number(custAmount.trim()) || 0;
    const due = Number(remainingAmount.trim()) || 0;
    const shouldSend = sendWA && !!phone;

    // Build the message now — the selection gets cleared after saving
    const waText = buildBookingMessage({
      name: custName.trim(),
      turfName: selectedTurf?.name,
      dateTxt: fmtDay(selectedDate),
      timeTxt: selectedStart !== null && selectedEnd !== null ? rangeShort(selectedStart, selectedEnd) : "",
      total, paid: Math.max(0, total - due), due,
    });

    setSaving(true);
    try {
      await updateDoc(doc(db, "blockedSlots", pendingDocId), {
        type: "offline", pending: false,
        customerName: custName.trim(), customerPhone: phone, note: custNote.trim(),
        amount: total, remainingAmount: due,
      });
      rememberCustomer(custName.trim(), phone, saveCust); // runs in the background
      const savedId = pendingDocId;
      setPendingDocId(null);
      clearForm(); clearSelection(); setScreen("main");
      await fetchDayData();

      // Open WhatsApp in the customer's chat with the confirmation typed in
      let opened = false;
      if (shouldSend) {
        opened = await openWhatsApp(phone, waText);
        if (opened) {
          updateDoc(doc(db, "blockedSlots", savedId), { whatsappSent: true, whatsappSentAt: serverTimestamp() }).catch(() => {});
        }
      }

      Alert.alert(
        "Booking done",
        !shouldSend ? "Offline booking saved."
          : opened ? "Offline booking saved. WhatsApp is open — just tap send."
          : "Booking saved, but WhatsApp couldn't open. You can resend it from Bookings.",
        [
          { text: "OK", style: "cancel" },
          {
            text: "View receipt",
            onPress: () => router.push({ pathname: "/(owner)/booking-receipt/offline-receipt", params: { id: savedId } } as any),
          },
        ]
      );
    } catch {
      Alert.alert("Error", "Something went wrong.");
    } finally {
      setSaving(false);
    }
  }

  async function cancelOfflineBooking() {
    const id = pendingDocId;
    setPendingDocId(null);
    clearForm(); clearSelection(); setScreen("main");
    if (id) {
      try { await deleteDoc(doc(db, "blockedSlots", id)); } catch {}
      await fetchDayData();
    }
    Alert.alert("Booking cancelled", "The slot was freed and is available again.");
  }

  // ─── Recurring ─────────────────────────────────────────────────────────────
  async function fetchSeries() {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    try {
      const snap = await getDocs(query(collection(db, "blockedSlots"), where("ownerId", "==", uid), where("isRecurring", "==", true)));
      setSeriesDocs(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch { /* non-critical */ }
  }

  const seriesGroups = useMemo(() => {
    const map: Record<string, any[]> = {};
    seriesDocs.forEach(d => { if (!d.seriesId) return; (map[d.seriesId] ||= []).push(d); });
    const today = new Date(); today.setHours(0, 0, 0, 0);
    return Object.entries(map).map(([seriesId, arr]) => {
      const sorted = [...arr].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      const future = sorted.filter(d => { const dd = new Date(d.date); dd.setHours(0, 0, 0, 0); return dd >= today; });
      const first = sorted[0];
      return {
        seriesId, label: first?.seriesLabel || first?.customerName || "Recurring booking",
        turfName: first?.turfName || "", type: first?.type,
        totalCount: sorted.length, remainingCount: future.length, nextDate: future[0]?.date || null,
        timeRange: Array.isArray(first?.slots) ? mergeSlotDisplay(first.slots) : "", docs: sorted,
      };
    }).filter(g => g.remainingCount > 0)
      .sort((a, b) => new Date(a.nextDate || 0).getTime() - new Date(b.nextDate || 0).getTime());
  }, [seriesDocs]);

  const recurQuickSlots = useMemo<QuickSlot[]>(() => {
    if (!selectedTurf) return [];
    const out: QuickSlot[] = [];
    for (let t = openingTime; t + slotDuration <= closingTime; t += slotDuration)
      out.push({ time: `${formatTime(t)} - ${formatTime(t + slotDuration)}`, startValue: t, endValue: t + slotDuration });
    return out;
  }, [selectedTurf, openingTime, closingTime, slotDuration]);

  function recurHandleQuickPress(slot: QuickSlot) {
    const exists = recurSelectedSlots.some(s => s.time === slot.time);
    if (exists) { setRecurSelectedSlots(recurSelectedSlots.filter(s => s.time !== slot.time)); return; }
    if (recurSelectedSlots.length === 0) { setRecurSelectedSlots([slot]); return; }
    const sorted = [...recurSelectedSlots].sort((a, b) => a.startValue - b.startValue);
    const first = sorted[0], last = sorted[sorted.length - 1];
    if (slot.endValue === first.startValue || slot.startValue === last.endValue) {
      if (recurSelectedSlots.length >= 8) return Alert.alert("Limit reached", "You can select up to 8 slots in a row for a recurring booking.");
      setRecurSelectedSlots([...recurSelectedSlots, slot]);
    } else setRecurSelectedSlots([slot]);
  }

  const recurRange = useMemo((): { start: number; end: number } | null => {
    if (recurMode === "quick") {
      if (recurSelectedSlots.length === 0) return null;
      const sorted = [...recurSelectedSlots].sort((a, b) => a.startValue - b.startValue);
      return { start: sorted[0].startValue, end: sorted[sorted.length - 1].endValue };
    }
    if (recurFlexStart !== null && recurFlexEnd !== null && recurFlexEnd > recurFlexStart) return { start: recurFlexStart, end: recurFlexEnd };
    return null;
  }, [recurMode, recurSelectedSlots, recurFlexStart, recurFlexEnd]);
  const recurTimeLabel = recurRange ? `${clockShort(recurRange.start)} → ${clockShort(recurRange.end)}` : "";
  const recurHours = recurRange ? recurRange.end - recurRange.start : 0;

  const recurFromOptions = useMemo(() => { const a: number[] = []; for (let t = openingTime; t < closingTime; t += 0.5) a.push(t); return a; }, [openingTime, closingTime]);
  const recurToOptions = useMemo(() => {
    if (recurFlexStart === null) return [];
    const a: number[] = []; for (let t = recurFlexStart + 0.5; t <= closingTime; t += 0.5) a.push(t); return a;
  }, [recurFlexStart, closingTime]);

  const recurEstimatedDates = useMemo(() => computeRecurDates(recurStartDate, recurDays, recurOccurrences), [recurStartDate, recurDays, recurOccurrences]);

  const todayStart = dayStart(new Date());
  const recurMax = (() => { const d = new Date(); d.setDate(d.getDate() + OWNER_DAYS_AHEAD - 1); return dayStart(d); })();
  function setRecurStart(d: Date) {
    const t = dayStart(d);
    if (t < todayStart || t > recurMax) return;
    const nd = new Date(t);
    setRecurStartDate(nd);
    setRecurCalMonth(new Date(nd.getFullYear(), nd.getMonth(), 1));
  }
  function shiftRecurStartDate(delta: number) { const d = new Date(recurStartDate); d.setDate(d.getDate() + delta); setRecurStart(d); }
  const shiftOccurrences = (delta: number) => setRecurOccurrences(o => Math.min(MAX_RECURRING_OCCURRENCES, Math.max(1, o + delta)));

  async function startRecurCheck() {
    if (!selectedTurf) return;
    if (!recurRange) return Alert.alert("Select time", "Pick a time slot first.");
    if (recurDays.length === 0) return Alert.alert("Select days", "Choose at least one day of the week.");
    setRecurChecking(true);
    try {
      const dates = computeRecurDates(recurStartDate, recurDays, recurOccurrences);
      const { start, end } = recurRange;
      const results: RecurPreviewDate[] = await Promise.all(dates.map(async d => {
        const dateKey = d.toDateString();
        try {
          const [bookedSnap, blockedSnap] = await Promise.all([
            getDocs(query(collection(db, "bookings"), where("turfId", "==", selectedTurf.id), where("dateString", "==", dateKey))),
            getDocs(query(collection(db, "blockedSlots"), where("turfId", "==", selectedTurf.id), where("date", "==", dateKey))),
          ]);
          const appBusy = bookedSnap.docs.map(x => x.data()).filter((b: any) => b.status !== "cancelled")
            .flatMap((b: any) => slotsOfBooking(b)).some((s: string) => overlapsStr(s, start, end));
          const blockBusy = blockedSnap.docs.flatMap(x => slotsOfBlock(x.data())).some((s: string) => overlapsStr(s, start, end));
          const conflict = appBusy || blockBusy;
          return {
            date: d, dateKey, status: conflict ? ("conflict" as const) : ("available" as const),
            reason: appBusy ? "Already booked in the app" : blockBusy ? "Already blocked or booked offline" : undefined,
            include: !conflict,
          };
        } catch {
          return { date: d, dateKey, status: "conflict" as const, reason: "Could not check — try again", include: false };
        }
      }));
      setRecurPreview(results);
      setRecurStep(3);
    } catch {
      Alert.alert("Error", "Could not check availability. Try again.");
    } finally {
      setRecurChecking(false);
    }
  }

  function resetRecurWizard() {
    setScreen("main"); setRecurStep(1); setRecurMode("quick"); setRecurSelectedSlots([]);
    setRecurFlexStart(null); setRecurFlexEnd(null); setRecurDays([]); setRecurStart(new Date());
    setRecurCalOpen(true); setRecurOccurrences(4); setRecurType("offline");
    setRecurCustName(""); setRecurCustPhone(""); setRecurAmountPerSession(""); setRecurNote(""); setRecurSeriesLabel("");
    setRecurPreview([]); setRecurSaveCust(false);
  }
  function recurBack() {
    if (recurStep > 1) { setRecurStep(s => (s - 1) as RecurStep); return; }
    resetRecurWizard();
  }

  async function confirmRecurringBooking() {
    if (!selectedTurf) return;
    const included = recurPreview.filter(p => p.include);
    if (included.length === 0) return Alert.alert("Nothing selected", "Select at least one date to book.");
    if (recurType === "offline" && !recurCustName.trim()) return Alert.alert("Name required", "Please enter the customer name.");
    if (!recurRange) return Alert.alert("Select time", "Pick a time slot first.");
    setRecurSaving(true);
    try {
      const { start, end } = recurRange;
      const slots = buildTimeRange(start, end);
      const seriesId = `series_${Date.now()}`;
      const perSessionAmount = Number(recurAmountPerSession.trim()) || 0;
      const batch = writeBatch(db);
      included.forEach((p, idx) => {
        const ref = doc(collection(db, "blockedSlots"));
        batch.set(ref, {
          turfId: selectedTurf.id, turfName: selectedTurf.name || "", slots, date: p.dateKey,
          ownerId: auth.currentUser?.uid, type: recurType, isRecurring: true, seriesId,
          seriesLabel: recurSeriesLabel.trim() || (recurType === "offline" ? recurCustName.trim() : "Recurring block"),
          recurrenceIndex: idx + 1, recurrenceTotal: included.length,
          ...(recurType === "offline" ? {
            customerName: recurCustName.trim(), customerPhone: recurCustPhone.trim(), note: recurNote.trim(),
            amount: perSessionAmount, remainingAmount: 0,
          } : {}),
          createdAt: serverTimestamp(),
        });
      });
      await batch.commit();
      if (recurType === "offline") rememberCustomer(recurCustName.trim(), recurCustPhone.trim(), recurSaveCust);
      const skipped = recurPreview.length - included.length;
      resetRecurWizard();
      await Promise.all([fetchDayData(), fetchSeries()]);
      Alert.alert("Recurring booking created",
        `${included.length} booking${included.length !== 1 ? "s" : ""} created.` +
        (skipped > 0 ? ` ${skipped} date${skipped !== 1 ? "s" : ""} skipped.` : ""));
    } catch {
      Alert.alert("Error", "Could not create the recurring booking. Try again.");
    } finally {
      setRecurSaving(false);
    }
  }

  function cancelSeriesFuture(seriesId: string) {
    const group = seriesGroups.find(g => g.seriesId === seriesId);
    if (!group) return;
    Alert.alert("Cancel recurring booking",
      `Cancel all ${group.remainingCount} upcoming session${group.remainingCount !== 1 ? "s" : ""}? Past sessions stay in your history.`, [
        { text: "Keep it", style: "cancel" },
        {
          text: "Cancel series", style: "destructive",
          onPress: async () => {
            setSaving(true);
            try {
              const today = new Date(); today.setHours(0, 0, 0, 0);
              const batch = writeBatch(db);
              group.docs.filter((d: any) => { const dd = new Date(d.date); dd.setHours(0, 0, 0, 0); return dd >= today; })
                .forEach((d: any) => batch.delete(doc(db, "blockedSlots", d.id)));
              await batch.commit();
              await Promise.all([fetchDayData(), fetchSeries()]);
              Alert.alert("Cancelled", "Upcoming sessions in this series were freed.");
            } catch {
              Alert.alert("Error", "Could not cancel the series.");
            } finally {
              setSaving(false);
            }
          },
        },
      ]);
  }

  // ─── Dates ─────────────────────────────────────────────────────────────────
  const days = useMemo(() => {
    const lateNow = closingTime > 24 && currentDecimal() < closingTime - 24;
    const first = lateNow ? -1 : 0;
    return Array.from({ length: OWNER_DAYS_AHEAD }, (_, i) => { const d = new Date(); d.setDate(d.getDate() + first + i); return d; });
  }, [closingTime]);
  const monthKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}`;
  const [viewMonth, setViewMonth] = useState(() => monthKey(new Date()));
  const monthTabs = useMemo(() => {
    const seen = new Set<string>(); const tabs: { key: string; label: string }[] = [];
    days.forEach(d => { const k = monthKey(d); if (!seen.has(k)) { seen.add(k); tabs.push({ key: k, label: d.toLocaleDateString("en-US", { month: "short" }) }); } });
    return tabs;
  }, [days]);
  const stripDays = useMemo(() => days.filter(d => monthKey(d) === viewMonth), [days, viewMonth]);

  const [calOpen, setCalOpen] = useState(false);
  const [calMonth, setCalMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const minDay = dayStart(days[0]);
  const maxDay = dayStart(days[days.length - 1]);
  const inRange = (d: Date) => dayStart(d) >= minDay && dayStart(d) <= maxDay;
  function openCalendar() { setCalMonth(new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1)); setCalOpen(true); }
  function pickCalDate(d: Date) { setSelectedDate(d); setViewMonth(monthKey(d)); setCalOpen(false); }

  const switchMode = (m: BookMode) => { LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); setBookMode(m); };
  const toggleSeries = () => { LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); setShowSeries(v => !v); };

  // ─── Loader ────────────────────────────────────────────────────────────────
  if (pageLoading) {
    return (
      <View style={s.loaderWrap}>
        <StatusBar barStyle="dark-content" />
        <ActivityIndicator size="large" color={ACCENT} />
        <Text style={s.loaderText}>Loading...</Text>
      </View>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // OFFLINE BOOKING FORM
  // ══════════════════════════════════════════════════════════════════════════
  if (screen === "offline") {
    const amt = Number(custAmount) || 0, rem = Number(remainingAmount) || 0;
    const paid = amt > 0 ? Math.max(0, amt - rem) : 0;
    const phoneTyped = !!custPhone.trim();
    const phoneValid = !!waNumber(custPhone);
    return (
      <KeyboardAvoidingView style={s.safe} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <StatusBar barStyle="light-content" backgroundColor={BRAND} />
        <Header insetTop={insets.top} onBack={cancelOfflineBooking} title="Offline booking"
          sub={`${selectedTurf?.name || ""} · ${fmtDay(selectedDate)} · ${timeLabel} · ${durationLabel}`} />

        <ScrollView ref={formScroll} style={{ flex: 1 }} contentContainerStyle={s.formBody}
          keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" showsVerticalScrollIndicator={false}>
          <View style={s.card}>
            <Text style={s.kicker}>CUSTOMER</Text>
            <View style={s.row2}>
              <Field label="Name *" value={custName} onChange={setCustName} placeholder="Customer name" autoCapitalize="words" />
              <Field label="Phone or whatsapp" value={custPhone} onChange={setCustPhone} placeholder="(optional)" keyboardType="phone-pad" />
            </View>
            <CustomerAssist customers={customers} name={custName} phone={custPhone}
              onPick={c => { setCustName(c.name); setCustPhone(c.phone || ""); }}
              onBrowse={() => openCustomerPicker("offline")}
              save={saveCust} onToggleSave={() => setSaveCust(v => !v)} />
            {phoneTyped && (
              <TouchableOpacity style={[s.waRow, !sendWA && { backgroundColor: "#F8FAFC", borderColor: LINE }]}
                onPress={() => setSendWA(v => !v)} activeOpacity={0.8}
                accessibilityRole="checkbox" accessibilityState={{ checked: sendWA }}>
                <Ionicons name="logo-whatsapp" size={18} color={WA_GREEN} />
                <View style={{ flex: 1 }}>
                  <Text style={s.waTxt}>Send confirmation on WhatsApp</Text>
                  {!phoneValid && <Text style={s.waWarn}>Enter a valid 10-digit mobile number</Text>}
                </View>
                <View style={[s.check, sendWA && s.waCheckOn]}>
                  {sendWA && <Ionicons name="checkmark" size={15} color="#fff" />}
                </View>
              </TouchableOpacity>
            )}
          </View>

          <View style={s.card}>
            <Text style={s.kicker}>PAYMENT</Text>
            <View style={s.row2}>
              <Field label="Total amount" value={custAmount} onChange={v => setCustAmount(v.replace(/[^0-9]/g, ""))}
                placeholder="0" keyboardType="number-pad" prefix="₹" onFocus={scrollFormToEnd} />
              <Field label="Still to collect" value={remainingAmount} onChange={v => setRemainingAmount(v.replace(/[^0-9]/g, ""))}
                placeholder="0" keyboardType="number-pad" prefix="₹" tone="due" onFocus={scrollFormToEnd} />
            </View>
            <View style={s.payRow}>
              <TouchableOpacity style={s.miniChip} onPress={() => setRemainingAmount("0")}><Text style={s.miniChipTxt}>Fully paid</Text></TouchableOpacity>
              <TouchableOpacity style={s.miniChip} onPress={() => setRemainingAmount(custAmount)}><Text style={s.miniChipTxt}>Nothing paid yet</Text></TouchableOpacity>
              {amt > 0 && <Text style={s.paidTxt}>₹{paid.toLocaleString("en-IN")} paid</Text>}
            </View>
          </View>

          <View style={s.card}>
            <Text style={s.fieldLabel}>Note (optional)</Text>
            <TextInput value={custNote} onChangeText={setCustNote} placeholder="Any extra info" placeholderTextColor={FAINT}
              style={[s.input, s.textArea]} multiline textAlignVertical="top" onFocus={scrollFormToEnd} />
          </View>
        </ScrollView>

        <View style={[s.formBar, { paddingBottom: Math.max(insets.bottom, 10) }]}>
          <TouchableOpacity style={[s.ghostBtn, { flex: 1 }]} onPress={cancelOfflineBooking} disabled={saving}>
            <Text style={s.ghostTxt}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.primaryBtn, { flex: 2 }, saving && { opacity: 0.6 }]} onPress={saveOfflineBooking} disabled={saving}>
            {saving ? <ActivityIndicator color="#fff" /> : (
              <>
                <Ionicons name={phoneTyped && sendWA ? "logo-whatsapp" : "checkmark"} size={18} color="#fff" />
                <Text style={s.primaryTxt}>{phoneTyped && sendWA ? "Save & send" : "Save booking"}</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // RECURRING WIZARD
  // ══════════════════════════════════════════════════════════════════════════
  if (screen === "recurring") {
    const included = recurPreview.filter(p => p.include).length;
    const clashes = recurPreview.filter(p => p.status === "conflict").length;
    const steps = [
      recurStep > 1 && recurRange ? `✓ ${rangeShort(recurRange.start, recurRange.end)}` : "Time",
      recurStep > 2 && recurDays.length ? `✓ ${MON_FIRST.filter(d => recurDays.includes(d)).map(d => DAY_NAMES[d]).join(", ")}` : "Days",
      "Review", "Details",
    ];
    const amountNum = Number(recurAmountPerSession) || 0;

    const stepBody = (() => {
      // STEP 1 — TIME
      if (recurStep === 1) return (
        <View style={s.card}>
          <Text style={s.cardTitle}>Which time repeats?</Text>
          <Text style={s.cardSub}>Tap one slot, then the next ones to make it longer.</Text>
          <Segment value={recurMode} onChange={m => {
            setRecurMode(m as BookMode);
            if (m === "quick") { setRecurFlexStart(null); setRecurFlexEnd(null); } else setRecurSelectedSlots([]);
          }} options={[["quick", "Quick slots"], ["flexible", "Flexible time"]]} />

          {recurMode === "quick" && (recurQuickSlots.length === 0 ? (
            <Text style={s.empty}>No slots set up for this turf.</Text>
          ) : groupBy(recurQuickSlots, q => bucketOf(q.startValue)).map(g => (
            <View key={g.name} style={{ marginTop: 12 }}>
              <Text style={s.groupLabel}>{g.name}</Text>
              <View style={s.grid3}>
                {g.items.map(slot => {
                  const on = recurSelectedSlots.some(x => x.time === slot.time);
                  return (
                    <Tile key={slot.time} label={rangeShort(slot.startValue, slot.endValue)} tone={on ? "sel" : "free"} height={42}
                      onPress={() => recurHandleQuickPress(slot)} />
                  );
                })}
              </View>
            </View>
          )))}

          {recurMode === "flexible" && (
            <>
              <FromTo from={recurFlexStart} to={recurFlexEnd} picking={recurFlexStart === null ? "from" : "to"}
                onFrom={() => { setRecurFlexStart(null); setRecurFlexEnd(null); }} onTo={() => setRecurFlexEnd(null)} />
              <Text style={s.pickHint}>{recurFlexStart === null ? "Tap the start time" : "Tap the end time"}</Text>
              {groupBy(recurFlexStart === null ? recurFromOptions : recurToOptions, t => bucketOf(recurFlexStart === null ? t : t - 0.01)).map(g => (
                <View key={g.name} style={{ marginTop: 10 }}>
                  <Text style={s.groupLabel}>{g.name}</Text>
                  <View style={s.grid4}>
                    {g.items.map(t => {
                      const isEdge = t === recurFlexStart || t === recurFlexEnd;
                      const inside = recurFlexStart !== null && recurFlexEnd !== null && t > recurFlexStart && t < recurFlexEnd;
                      return (
                        <Tile key={t} label={compact(t)} height={36} small tone={isEdge ? "sel" : inside ? "range" : "free"}
                          onPress={() => (recurFlexStart === null ? (setRecurFlexStart(t), setRecurFlexEnd(null)) : setRecurFlexEnd(t))} />
                      );
                    })}
                  </View>
                </View>
              ))}
            </>
          )}
          <Note text="Clashes are checked for every date in step 3 — busy dates get skipped, nothing is double-booked." />
        </View>
      );

      // STEP 2 — DAYS + START + SESSIONS
      if (recurStep === 2) return (
        <>
          <View style={s.card}>
            <Text style={s.cardTitle}>Which days?</Text>
            <View style={[s.grid7, { marginTop: 12 }]}>
              {MON_FIRST.map(d => {
                const on = recurDays.includes(d);
                return (
                  <TouchableOpacity key={d} style={[s.dayPill, on && s.dayPillOn]} onPress={() => setRecurDays(on ? recurDays.filter(x => x !== d) : [...recurDays, d])}
                    accessibilityState={{ selected: on }}>
                    <Text style={[s.dayPillTxt, on && { color: "#fff" }]}>{DAY_NAMES[d]}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <View style={s.chipRowWrap}>
              {([["Weekdays", [1, 2, 3, 4, 5]], ["Weekends", [6, 0]], ["Every day", [0, 1, 2, 3, 4, 5, 6]]] as [string, number[]][]).map(([l, v]) => (
                <TouchableOpacity key={l} style={s.miniChip} onPress={() => setRecurDays(v)}><Text style={s.miniChipTxt}>{l}</Text></TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={s.card}>
            <View style={s.rowCenter}>
              <View style={{ flex: 1 }}>
                <Text style={s.kicker}>START FROM</Text>
                <Text style={s.bigVal}>{fmtDay(recurStartDate)}</Text>
              </View>
              <SquareBtn icon="chevron-back" label="One day earlier" onPress={() => shiftRecurStartDate(-1)} />
              <SquareBtn icon="chevron-forward" label="One day later" onPress={() => shiftRecurStartDate(1)} />
              <SquareBtn icon="calendar-outline" label="Show calendar" active={recurCalOpen}
                onPress={() => { LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); setRecurCalOpen(o => !o); }} />
            </View>
            {recurCalOpen && (
              <View style={s.calInline}>
                <MonthCalendar month={recurCalMonth} onMonth={setRecurCalMonth}
                  minTime={todayStart} maxTime={recurMax}
                  isSelected={d => sameDay(d, recurStartDate)}
                  isMarked={d => recurEstimatedDates.some(x => sameDay(x, d))}
                  onPick={setRecurStart} />
                <View style={s.legendRow}>
                  <Legend color={ACCENT_DARK} round text="Start" />
                  <Legend color={ACCENT_TINT} round text="Session day" />
                  <Legend color="#fff" round ring text="Today" />
                </View>
              </View>
            )}
          </View>

          <View style={s.card}>
            <View style={s.rowCenter}>
              <View style={{ flex: 1 }}>
                <Text style={s.kicker}>HOW MANY SESSIONS</Text>
                <Text style={s.bigVal}>{recurOccurrences} sessions</Text>
              </View>
              <SquareBtn icon="remove" label="Fewer sessions" onPress={() => shiftOccurrences(-1)} />
              <SquareBtn icon="add" label="More sessions" onPress={() => shiftOccurrences(1)} />
            </View>
            <View style={[s.grid4, { marginTop: 10 }]}>
              {[4, 8, 12, 24].map(v => (
                <TouchableOpacity key={v} style={[s.presetChip, recurOccurrences === v && s.presetChipOn]} onPress={() => setRecurOccurrences(v)}>
                  <Text style={[s.presetTxt, recurOccurrences === v && { color: ACCENT_DARK }]}>{v === 24 ? "24 max" : v}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={s.darkCard}>
            <Text style={[s.kicker, { color: FAINT }]}>THIS WILL BOOK</Text>
            <Text style={s.darkTitle}>{recurDays.length ? `${daysText(recurDays)} · ${recurTimeLabel}` : "Pick at least one day"}</Text>
            {recurEstimatedDates.length > 0 && (
              <Text style={s.darkSub}>
                {recurEstimatedDates.length} sessions · {fmtDay(recurEstimatedDates[0])} → {fmtDay(recurEstimatedDates[recurEstimatedDates.length - 1])}
              </Text>
            )}
          </View>
        </>
      );

      // STEP 3 — REVIEW
      if (recurStep === 3) return (
        <>
          <View style={s.row2}>
            <View style={[s.countBox, { backgroundColor: "#F0FDF4" }]}>
              <Text style={[s.countNum, { color: ACCENT_DARK }]}>{recurPreview.filter(p => p.status === "available").length}</Text>
              <Text style={s.countLbl}>dates free</Text>
            </View>
            <View style={[s.countBox, { backgroundColor: "#FEF2F2" }]}>
              <Text style={[s.countNum, { color: "#B91C1C" }]}>{clashes}</Text>
              <Text style={s.countLbl}>clash{clashes === 1 ? "" : "es"} · skipped</Text>
            </View>
          </View>
          <View style={[s.card, { paddingVertical: 4 }]}>
            {recurPreview.map((p, idx) => {
              const clash = p.status === "conflict";
              return (
                <TouchableOpacity key={p.dateKey} activeOpacity={0.75}
                  style={[s.reviewRow, idx < recurPreview.length - 1 && s.reviewLine, !p.include && { opacity: 0.6 }]}
                  onPress={() => { const c = [...recurPreview]; c[idx] = { ...c[idx], include: !c[idx].include }; setRecurPreview(c); }}
                  accessibilityRole="checkbox" accessibilityState={{ checked: p.include }}>
                  <View style={{ width: 44, alignItems: "center" }}>
                    <Text style={s.reviewDow}>{DAY_NAMES[p.date.getDay()].toUpperCase()}</Text>
                    <Text style={s.reviewNum}>{p.date.getDate()}</Text>
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[s.reviewTitle, clash && { color: "#B91C1C" }]}>
                      {p.date.toLocaleDateString("en-US", { month: "short" })} · {clash ? "busy" : recurTimeLabel}
                    </Text>
                    <Text style={[s.reviewSub, { color: clash ? "#B91C1C" : ACCENT_DARK }]}>{clash ? p.reason : p.include ? "Free · will book" : "Free · skipped by you"}</Text>
                  </View>
                  <View style={[s.check, p.include && s.checkOn]}>
                    {p.include && <Ionicons name="checkmark" size={15} color="#fff" />}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
          <Text style={s.centerHint}>Tap a date to skip it or add it back.</Text>
        </>
      );

      // STEP 4 — DETAILS
      return (
        <>
          <Segment value={recurType} onChange={v => setRecurType(v as RecurType)} options={[["offline", "Regular customer"], ["block", "Block only"]]} light />
          <View style={s.card}>
            <Field label="Series name (optional)" value={recurSeriesLabel} onChange={setRecurSeriesLabel} placeholder="e.g. Monday Cricket Club" autoCapitalize="words" />
            {recurType === "offline" && (
              <>
                <View style={[s.row2, { marginTop: 10 }]}>
                  <Field label="Name *" value={recurCustName} onChange={setRecurCustName} placeholder="Customer name" autoCapitalize="words" />
                  <Field label="Phone" value={recurCustPhone} onChange={setRecurCustPhone} placeholder="Optional" keyboardType="phone-pad" />
                </View>
                <CustomerAssist customers={customers} name={recurCustName} phone={recurCustPhone}
                  onPick={c => { setRecurCustName(c.name); setRecurCustPhone(c.phone || ""); }}
                  onBrowse={() => openCustomerPicker("recur")}
                  save={recurSaveCust} onToggleSave={() => setRecurSaveCust(v => !v)} />
                <View style={[s.rowEnd, { marginTop: 10 }]}>
                  <View style={{ flex: 1 }}>
                    <Field label="Amount per session" value={recurAmountPerSession} onChange={v => setRecurAmountPerSession(v.replace(/[^0-9]/g, ""))}
                      placeholder="0" keyboardType="number-pad" prefix="₹" onFocus={scrollFormToEnd} />
                  </View>
                  <View style={s.totalBox}>
                    <Text style={s.totalLbl}>TOTAL · {included} DATES</Text>
                    <Text style={s.totalVal}>₹{(amountNum * included).toLocaleString("en-IN")}</Text>
                  </View>
                </View>
                <Text style={[s.fieldLabel, { marginTop: 10 }]}>Note (optional)</Text>
                <TextInput value={recurNote} onChangeText={setRecurNote} placeholder="Any extra info" placeholderTextColor={FAINT}
                  style={[s.input, s.textArea]} multiline textAlignVertical="top" onFocus={scrollFormToEnd} />
              </>
            )}
          </View>
          <View style={s.darkCard}>
            <Text style={[s.kicker, { color: FAINT }]}>SUMMARY</Text>
            <Text style={s.darkTitle}>{daysText(recurDays)} · {recurTimeLabel}</Text>
            <Text style={s.darkSub}>{included} session{included !== 1 ? "s" : ""} will be created{recurType === "block" ? " as blocks" : ""}</Text>
          </View>
        </>
      );
    })();

    // Bottom bar per step
    const bar = (() => {
      if (recurStep === 1) return (
        <>
          <View style={{ flex: 1 }}>
            <Text style={s.barLabel}>EVERY TIME</Text>
            <Text style={s.barValue} numberOfLines={1}>{recurRange ? `${recurTimeLabel} · ${recurHours}h` : "Pick a slot"}</Text>
          </View>
          <TouchableOpacity style={[s.primaryBtn, { paddingHorizontal: 18 }, !recurRange && { opacity: 0.45 }]} disabled={!recurRange} onPress={() => setRecurStep(2)}>
            <Text style={s.primaryTxt}>Next: days ›</Text>
          </TouchableOpacity>
        </>
      );
      if (recurStep === 2) return (
        <>
          <TouchableOpacity style={[s.ghostBtn, { flex: 1 }]} onPress={() => setRecurStep(1)}><Text style={s.ghostTxt}>Back</Text></TouchableOpacity>
          <TouchableOpacity style={[s.primaryBtn, { flex: 2 }, (recurDays.length === 0 || recurChecking) && { opacity: 0.45 }]}
            disabled={recurDays.length === 0 || recurChecking} onPress={startRecurCheck}>
            {recurChecking ? <ActivityIndicator color="#fff" /> : <Text style={s.primaryTxt}>Check availability</Text>}
          </TouchableOpacity>
        </>
      );
      if (recurStep === 3) return (
        <>
          <TouchableOpacity style={[s.ghostBtn, { flex: 1 }]} onPress={() => setRecurStep(2)}><Text style={s.ghostTxt}>Back</Text></TouchableOpacity>
          <TouchableOpacity style={[s.primaryBtn, { flex: 2 }, included === 0 && { opacity: 0.45 }]} disabled={included === 0} onPress={() => setRecurStep(4)}>
            <Text style={s.primaryTxt}>Next: details · {included} date{included === 1 ? "" : "s"}</Text>
          </TouchableOpacity>
        </>
      );
      return (
        <>
          <TouchableOpacity style={[s.ghostBtn, { flex: 1 }]} onPress={() => setRecurStep(3)} disabled={recurSaving}><Text style={s.ghostTxt}>Back</Text></TouchableOpacity>
          <TouchableOpacity style={[s.primaryBtn, { flex: 2 }, recurSaving && { opacity: 0.6 }]} disabled={recurSaving} onPress={confirmRecurringBooking}>
            {recurSaving ? <ActivityIndicator color="#fff" /> : (<><Ionicons name="checkmark" size={18} color="#fff" /><Text style={s.primaryTxt}>Create {included} booking{included === 1 ? "" : "s"}</Text></>)}
          </TouchableOpacity>
        </>
      );
    })();

    return (
      <KeyboardAvoidingView style={s.safe} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <StatusBar barStyle="light-content" backgroundColor={BRAND} />
        <View style={[s.header, { paddingTop: insets.top + 10 }]}>
          <View style={s.headerRow}>
            <TouchableOpacity style={s.backBtn} onPress={recurBack} accessibilityLabel="Back">
              <Ionicons name="arrow-back" size={20} color="#fff" />
            </TouchableOpacity>
            <View style={{ flex: 1 }}>
              <Text style={s.hKicker} numberOfLines={1}>{(selectedTurf?.name || "").toUpperCase()} · STEP {recurStep} OF 4</Text>
              <Text style={s.hTitle}>Recurring booking</Text>
            </View>
          </View>
          <View style={s.progressRow}>
            {steps.map((label, i) => (
              <View key={i} style={{ flex: 1 }}>
                <View style={[s.progressBar, i < recurStep && { backgroundColor: "#fff" }]} />
                <Text style={[s.progressTxt, i + 1 === recurStep && { color: "#fff", fontWeight: "800" }]} numberOfLines={1}>{label}</Text>
              </View>
            ))}
          </View>
        </View>

        <ScrollView ref={formScroll} style={{ flex: 1 }} contentContainerStyle={s.formBody}
          keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" showsVerticalScrollIndicator={false}>
          {stepBody}
        </ScrollView>

        <View style={[s.formBar, { paddingBottom: Math.max(insets.bottom, 10) }]}>{bar}</View>
      </KeyboardAvoidingView>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // MAIN SCREEN
  // ══════════════════════════════════════════════════════════════════════════
  const pickingTo = bookMode === "flexible" && flexStart !== null && activePanel !== "from";
  const flexChips = pickingTo ? toChips : fromChips;

  return (
    <View style={s.safe}>
      <StatusBar barStyle="light-content" backgroundColor={BRAND} />

      {/* Header */}
      <View style={[s.header, { paddingTop: insets.top + 10 }]}>
        <View style={s.headerRow}>
          <TouchableOpacity style={s.backBtn} onPress={() => router.back()} accessibilityLabel="Back">
            <Ionicons name="arrow-back" size={20} color="#fff" />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={s.hKicker}>SLOT PANEL</Text>
            <Text style={s.hTitle}>Block Slots</Text>
          </View>
          <TouchableOpacity style={s.hIconBtn} onPress={() => router.push("/(owner)/customers" as any)} activeOpacity={0.85} accessibilityLabel="Saved customers">
            <Ionicons name="people-outline" size={18} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity style={s.scheduleBtn} onPress={() => router.push("/(owner)/schedule" as any)} activeOpacity={0.85}>
            <Ionicons name="list" size={15} color="#fff" />
            <Text style={s.scheduleTxt}>Schedule</Text>
          </TouchableOpacity>
        </View>
        <View style={s.statRow}>
          <Stat n={counts.free} label="free" color="#4ADE80" />
          <Stat n={counts.app} label="app" color="#93C5FD" />
          <Stat n={counts.offline} label="offline" color="#A5B4FC" />
          <Stat n={counts.blocked} label="blocked" color="#FDBA74" />
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false}
        contentContainerStyle={{ padding: 14, gap: 10, paddingBottom: hasValidSelection ? 130 : 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} tintColor={ACCENT} onRefresh={() => fetchDayData(true)} />}>

        {/* Turf + date */}
        <View style={s.card}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {turfs.map(t => {
              const on = selectedTurf?.id === t.id;
              return (
                <TouchableOpacity key={t.id} style={[s.turfChip, on && s.turfChipOn]} onPress={() => setSelectedTurf(t)}>
                  <Text style={[s.turfChipTxt, on && { color: "#fff" }]}>{t.name}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
          <View style={[s.rowCenter, { marginTop: 12 }]}>
            <View style={{ flexDirection: "row", gap: 6, flex: 1 }}>
              {monthTabs.map(m => {
                const on = m.key === viewMonth;
                return (
                  <TouchableOpacity key={m.key} style={[s.monthChip, on && s.monthChipOn]} onPress={() => setViewMonth(m.key)}>
                    <Text style={[s.monthChipTxt, on && { color: "#fff" }]}>{m.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <TouchableOpacity style={s.calBtn} onPress={openCalendar} activeOpacity={0.8}>
              <Ionicons name="calendar-outline" size={14} color={ACCENT_DARK} />
              <Text style={s.calBtnTxt}>Pick date</Text>
            </TouchableOpacity>
          </View>
          <FlatList horizontal showsHorizontalScrollIndicator={false} data={stripDays} keyExtractor={d => d.toDateString()}
            style={{ marginTop: 10 }} contentContainerStyle={{ gap: 6 }}
            renderItem={({ item }) => {
              const on = sameDay(selectedDate, item);
              return (
                <TouchableOpacity style={[s.dateCard, on && s.dateCardOn]} onPress={() => setSelectedDate(item)}>
                  <Text style={[s.dateDow, on && { color: "#fff" }]}>{item.toLocaleDateString("en-US", { weekday: "short" }).toUpperCase()}</Text>
                  <Text style={[s.dateNum, on && { color: "#fff" }]}>{item.getDate()}</Text>
                </TouchableOpacity>
              );
            }} />
        </View>

        {/* Recurring row + active series */}
        {selectedTurf && (
          <View style={[s.card, { padding: 0 }]}>
            <TouchableOpacity style={s.recurRow} onPress={() => setScreen("recurring")} activeOpacity={0.8}>
              <View style={s.recurIcon}><Ionicons name="repeat" size={18} color="#059669" /></View>
              <View style={{ flex: 1 }}>
                <Text style={s.recurTitle}>Recurring / bulk booking</Text>
                <Text style={s.recurSub}>Same time on many dates</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={FAINT} />
            </TouchableOpacity>
            {seriesGroups.length > 0 && (
              <>
                <TouchableOpacity style={s.seriesToggle} onPress={toggleSeries}>
                  <Text style={s.seriesToggleTxt}>{seriesGroups.length} active series</Text>
                  <Ionicons name={showSeries ? "chevron-up" : "chevron-down"} size={15} color={MUTED} />
                </TouchableOpacity>
                {showSeries && seriesGroups.map(g => (
                  <View key={g.seriesId} style={s.seriesRow}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={s.seriesLabel} numberOfLines={1}>{g.label}</Text>
                      <Text style={s.seriesMeta} numberOfLines={1}>
                        {g.turfName} · {g.timeRange} · {g.remainingCount} left{g.nextDate ? ` · next ${fmtDay(new Date(g.nextDate))}` : ""}
                      </Text>
                    </View>
                    <TouchableOpacity style={s.seriesCancel} onPress={() => cancelSeriesFuture(g.seriesId)} disabled={saving}>
                      <Text style={s.seriesCancelTxt}>Cancel</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </>
            )}
          </View>
        )}

        {/* Slots */}
        <View style={s.card}>
          <View style={s.rowCenter}>
            <Text style={[s.cardTitle, { flex: 1 }]}>Book / block time</Text>
            <Text style={s.hoursTxt}>{clockShort(openingTime)} – {clockShort(closingTime)}</Text>
          </View>
          <Segment value={bookMode} onChange={m => switchMode(m as BookMode)} options={[["quick", "Quick slots"], ["flexible", "Flexible time"]]} />

          {bookMode === "quick" && (
            <>
              <View style={s.legendRow}>
                <Legend color="#fff" border text="Free" />
                <Legend color={TONE.app.border} text="App" />
                <Legend color={TONE.offline.border} text="Offline" />
                <Legend color={TONE.blocked.border} text="Blocked" />
              </View>
              {quickTiles.length === 0 ? (
                <Text style={s.empty}>No slots left for this date.</Text>
              ) : groupBy(quickTiles, t => bucketOf(t.slot.startValue)).map(g => (
                <View key={g.name} style={{ marginTop: 10 }}>
                  <Text style={s.groupLabel}>{g.name}</Text>
                  <View style={s.grid3}>
                    {g.items.map(({ slot, status, blockedDoc }) => {
                      const on = selectedQuickSlots.some(x => x.time === slot.time);
                      const sub = status === "app" ? "App booked"
                        : status === "offline" ? (blockedDoc?.customerName || "Offline")
                        : status === "blocked" ? (blockedDoc?.pending ? "Holding" : "Blocked")
                        : on ? "Selected" : undefined;
                      return (
                        <Tile key={slot.time} label={rangeShort(slot.startValue, slot.endValue)} sub={sub}
                          tone={on ? "sel" : status} height={50}
                          onPress={() => {
                            if (status === "app") return Alert.alert("App booking", "This slot was booked by a customer in the app.");
                            if (blockedDoc) {
                              return Alert.alert(status === "offline" ? "Offline booking" : "Blocked slot",
                                `${status === "offline" && blockedDoc.customerName ? `${blockedDoc.customerName}\n` : ""}Free ${slot.time}?`, [
                                  { text: "Keep", style: "cancel" },
                                  { text: "Free slot", style: "destructive", onPress: () => unblockDoc(blockedDoc.id) },
                                ]);
                            }
                            handleQuickPress(slot);
                          }} />
                      );
                    })}
                  </View>
                </View>
              ))}
            </>
          )}

          {bookMode === "flexible" && (
            <>
              <FromTo from={flexStart} to={flexEnd} picking={pickingTo ? "to" : "from"} duration={flexStart !== null && flexEnd !== null ? durationLabel : undefined}
                onFrom={() => setActivePanel("from")}
                onTo={() => { if (flexStart === null) return Alert.alert("Pick a start", "Choose the FROM time first."); setActivePanel("to"); }} />
              <Text style={s.pickHint}>{pickingTo ? "Tap the end time" : "Tap the start time"} <Text style={{ color: MUTED, fontWeight: "600" }}>· grey times are taken</Text></Text>
              {flexChips.length === 0 ? (
                <Text style={s.empty}>{pickingTo ? "No free end times after this point." : "No free times left today."}</Text>
              ) : groupBy(flexChips, c => bucketOf(pickingTo ? c.value - 0.01 : c.value)).map(g => (
                <View key={g.name} style={{ marginTop: 10 }}>
                  <Text style={s.groupLabel}>{g.name}</Text>
                  <View style={s.grid4}>
                    {g.items.map(c => {
                      const taken = c.status !== "available";
                      const isEdge = c.value === flexStart || c.value === flexEnd;
                      const inside = flexStart !== null && flexEnd !== null && c.value > flexStart && c.value < flexEnd;
                      return (
                        <Tile key={c.value} label={c.label} small height={36} disabled={taken}
                          tone={taken ? "taken" : isEdge ? "sel" : inside ? "range" : "free"}
                          onPress={() => (pickingTo ? handleSelectTo(c) : handleSelectFrom(c))} />
                      );
                    })}
                  </View>
                </View>
              ))}
              <Text style={s.flexNote}>Must end by {clockShort(closingTime)} (closing time)</Text>
            </>
          )}
        </View>
      </ScrollView>

      {/* Bottom bar */}
      {hasValidSelection && (
        <View style={[s.bottomBar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={s.barLabel}>SELECTED</Text>
            <Text style={s.barValue} numberOfLines={1}>{timeLabel} · {durationLabel}</Text>
          </View>
          <TouchableOpacity style={s.ghostBtn} onPress={clearSelection}><Text style={s.ghostTxt}>Clear</Text></TouchableOpacity>
          <TouchableOpacity style={[s.primaryBtn, { paddingHorizontal: 16 }]} onPress={() => setActionOpen(true)} disabled={saving}>
            <Text style={s.primaryTxt}>Choose action ›</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Choose action sheet */}
      <Modal visible={actionOpen} transparent animationType="slide" onRequestClose={() => setActionOpen(false)} statusBarTranslucent>
        <View style={s.backdrop}>
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => !saving && setActionOpen(false)} />
          <View style={[s.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}>
            <View style={s.grabber} />
            <View style={s.sheetSummary}>
              <View style={{ flex: 1 }}>
                <Text style={s.sheetTime}>{timeLabel}</Text>
                <Text style={s.sheetSub}>{selectedTurf?.name} · {fmtDay(selectedDate)}</Text>
              </View>
              <Text style={s.durPill}>{durationLabel}</Text>
            </View>
            <Text style={s.sheetAsk}>What do you want to do?</Text>
            <ActionOption icon="person-outline" title="Offline booking" sub="Walk-in or phone customer · name & payment"
              tone={TONE.offline} onPress={startOfflineBooking} disabled={saving} />
            <ActionOption icon="lock-closed-outline" title="Block only" sub="Maintenance or private use · no customer"
              tone={TONE.blocked} onPress={saveBlock} disabled={saving} right={saving ? <ActivityIndicator color={TONE.blocked.fg} /> : undefined} />
            <TouchableOpacity style={[s.ghostBtn, { height: 48 }]} onPress={() => setActionOpen(false)} disabled={saving}>
              <Text style={s.ghostTxt}>Keep choosing</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Date picker */}
      <Modal visible={calOpen} transparent animationType="fade" onRequestClose={() => setCalOpen(false)} statusBarTranslucent>
        <View style={s.calBackdrop}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setCalOpen(false)} />
          <View style={s.calCard}>
            <MonthCalendar month={calMonth} onMonth={setCalMonth} minTime={minDay} maxTime={maxDay}
              isSelected={d => sameDay(d, selectedDate)} onPick={d => inRange(d) && pickCalDate(d)} />
            <View style={[s.row2, { marginTop: 12 }]}>
              <TouchableOpacity style={s.calTodayBtn} onPress={() => pickCalDate(new Date())}><Text style={s.calTodayTxt}>Today</Text></TouchableOpacity>
              <TouchableOpacity style={[s.ghostBtn, { flex: 1, height: 44 }]} onPress={() => setCalOpen(false)}><Text style={s.ghostTxt}>Close</Text></TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// SMALL COMPONENTS
// ═════════════════════════════════════════════════════════════════════════════
function Header({ insetTop, onBack, title, sub }: { insetTop: number; onBack: () => void; title: string; sub?: string }) {
  return (
    <View style={[s.header, { paddingTop: insetTop + 10 }]}>
      <View style={s.headerRow}>
        <TouchableOpacity style={s.backBtn} onPress={onBack} accessibilityLabel="Back">
          <Ionicons name="arrow-back" size={20} color="#fff" />
        </TouchableOpacity>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={s.hTitle}>{title}</Text>
          {!!sub && <Text style={s.hSub} numberOfLines={1}>{sub}</Text>}
        </View>
      </View>
    </View>
  );
}

function Stat({ n, label, color }: { n: number; label: string; color: string }) {
  return (
    <View style={s.stat}>
      <Text style={[s.statNum, { color }]}>{n}</Text>
      <Text style={s.statLbl}>{label}</Text>
    </View>
  );
}

function Tile({ label, sub, tone, height, small, disabled, onPress }: {
  label: string; sub?: string; tone: keyof typeof TONE; height: number; small?: boolean; disabled?: boolean; onPress: () => void;
}) {
  // small tiles sit 4 per row, normal tiles 3 per row
  const size = small ? { flexBasis: "22%" as const, maxWidth: "25%" as const } : { flexBasis: "30%" as const, maxWidth: "33%" as const };
  const t = TONE[tone];
  return (
    <TouchableOpacity onPress={onPress} disabled={disabled} activeOpacity={0.75}
      accessibilityState={{ selected: tone === "sel", disabled }}
      style={[s.tile, size, { height, backgroundColor: t.bg, borderColor: t.border }]}>
      <Text style={[small ? s.tileSmall : s.tileLabel, { color: t.fg }, tone === "taken" && { textDecorationLine: "line-through" }]}
        numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>{label}</Text>
      {!!sub && <Text style={[s.tileSub, { color: t.fg }]} numberOfLines={1}>{sub}</Text>}
    </TouchableOpacity>
  );
}

function Segment({ value, onChange, options, light }: { value: string; onChange: (v: string) => void; options: [string, string][]; light?: boolean }) {
  return (
    <View style={[s.segment, light && { backgroundColor: "#E6EAF0", marginTop: 0 }]}>
      {options.map(([v, l]) => {
        const on = value === v;
        return (
          <TouchableOpacity key={v} style={[s.segBtn, on && (light ? s.segOnLight : s.segOn)]} onPress={() => onChange(v)} accessibilityState={{ selected: on }}>
            <Text style={[s.segTxt, on && { color: light ? INK : "#fff" }]}>{l}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function FromTo({ from, to, picking, duration, onFrom, onTo }: {
  from: number | null; to: number | null; picking: "from" | "to"; duration?: string; onFrom: () => void; onTo: () => void;
}) {
  return (
    <View style={s.fromToRow}>
      <TouchableOpacity style={[s.timeBox, picking === "from" && s.timeBoxOn]} onPress={onFrom}>
        <Text style={[s.timeBoxLbl, picking === "from" && { color: ACCENT_DARK }]}>FROM{picking === "from" ? " · PICKING" : ""}</Text>
        <Text style={[s.timeBoxVal, from === null && { color: "#CBD5E1" }]}>{from !== null ? clockShort(from) : "--"}</Text>
      </TouchableOpacity>
      {duration ? <Text style={s.durPill}>{duration}</Text> : <Ionicons name="arrow-forward" size={16} color={FAINT} />}
      <TouchableOpacity style={[s.timeBox, picking === "to" && s.timeBoxOn, from === null && { opacity: 0.5 }]} onPress={onTo}>
        <Text style={[s.timeBoxLbl, picking === "to" && { color: ACCENT_DARK }]}>TO{picking === "to" ? " · PICKING" : ""}</Text>
        <Text style={[s.timeBoxVal, to === null && { color: "#CBD5E1" }]}>{to !== null ? clockShort(to) : "--"}</Text>
      </TouchableOpacity>
    </View>
  );
}

function Field({ label, value, onChange, placeholder, keyboardType, prefix, tone, autoCapitalize, onFocus }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string;
  keyboardType?: "default" | "phone-pad" | "number-pad"; prefix?: string; tone?: "due";
  autoCapitalize?: "none" | "words" | "sentences"; onFocus?: () => void;
}) {
  const due = tone === "due";
  const inputRef = useRef<TextInput>(null);
  const [focused, setFocused] = useState(false);
  // Tapping anywhere on the label or box (not just the text line) opens the keyboard
  const focusInput = () => inputRef.current?.focus();
  return (
    <Pressable style={{ flex: 1, minWidth: 0 }} onPress={focusInput} accessible={false}>
      <Text style={s.fieldLabel}>{label}</Text>
      <View style={[s.inputWrap, due && { backgroundColor: "#FFF7ED", borderColor: "#FED7AA" }, focused && s.inputWrapOn]}>
        {!!prefix && <Text style={[s.prefix, due && { color: "#C2410C" }]} onPress={focusInput}>{prefix}</Text>}
        <TextInput ref={inputRef} value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={FAINT}
          keyboardType={keyboardType || "default"} autoCapitalize={autoCapitalize}
          onFocus={() => { setFocused(true); onFocus?.(); }} onBlur={() => setFocused(false)}
          returnKeyType="done" style={[s.inputInner, due && { color: "#9A3412" }]} />
      </View>
    </Pressable>
  );
}

/**
 * Saved-customer helper under the Name / Phone fields.
 * • Nothing typed     → recent customers as chips + "All customers"
 * • Matches a saved   → "✓ Saved customer · 6 bookings"
 * • Typing, new person → suggestions, "Find in saved customers", and the
 *                        "Save to my customers" checkbox (asked every time)
 */
function CustomerAssist({ customers, name, phone, onPick, onBrowse, save, onToggleSave }: {
  customers: Customer[]; name: string; phone: string;
  onPick: (c: Customer) => void; onBrowse: () => void; save: boolean; onToggleSave: () => void;
}) {
  const typedName = name.trim(), typedPhone = phone.trim();
  const match = findCustomer(customers, name, phone);

  // 1) Already a saved customer
  if (match) {
    return (
      <View style={s.custMatch}>
        <Ionicons name="checkmark-circle" size={17} color={ACCENT_DARK} />
        <Text style={s.custMatchTxt} numberOfLines={1}>Saved customer · {customerMeta(match)}</Text>
      </View>
    );
  }

  // 2) Nothing typed yet → recent chips
  if (!typedName && !typedPhone) {
    const recent = customers.slice(0, 5);
    return (
      <View style={{ marginTop: 10 }}>
        <Text style={s.custLbl}>{recent.length ? "RECENT CUSTOMERS" : "SAVED CUSTOMERS"}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 6 }}>
          {recent.map(c => (
            <TouchableOpacity key={c.id} style={s.custChip} onPress={() => onPick(c)} accessibilityLabel={`Use ${c.name}`}>
              <Ionicons name="person-circle-outline" size={16} color={ACCENT_DARK} />
              <Text style={s.custChipTxt} numberOfLines={1}>{c.name.split(" ")[0]}</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity style={[s.custChip, s.custChipAll]} onPress={onBrowse}>
            <Ionicons name="people-outline" size={15} color="#fff" />
            <Text style={[s.custChipTxt, { color: "#fff" }]}>{recent.length ? "All customers" : "Open customers"}</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    );
  }

  // 3) Typing someone new → suggestions + save checkbox
  const q = typedName.length >= 2 ? typedName : typedPhone;
  const suggestions = q.length >= 2 ? searchCustomers(customers, q, 4) : [];
  return (
    <View style={{ marginTop: 10, gap: 6 }}>
      {suggestions.map(c => (
        <TouchableOpacity key={c.id} style={s.custSug} onPress={() => onPick(c)} accessibilityLabel={`Use ${c.name}`}>
          <Ionicons name="person-circle-outline" size={20} color={ACCENT_DARK} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={s.custSugName} numberOfLines={1}>{c.name}</Text>
            <Text style={s.custSugMeta} numberOfLines={1}>{c.phone || "No phone"} · {customerMeta(c)}</Text>
          </View>
          <Text style={s.custUse}>Use</Text>
        </TouchableOpacity>
      ))}
      <TouchableOpacity style={s.custBrowse} onPress={onBrowse}>
        <Ionicons name="search" size={14} color={ACCENT_DARK} />
        <Text style={s.custBrowseTxt} numberOfLines={1}>
          {suggestions.length ? "Not them? Find in saved customers" : typedName ? `No saved "${typedName}" · Find in saved customers` : "Find in saved customers"}
        </Text>
        <Ionicons name="chevron-forward" size={14} color={ACCENT_DARK} />
      </TouchableOpacity>
      {!!typedName && (
        <TouchableOpacity style={[s.custSave, save && s.custSaveOn]} onPress={onToggleSave} activeOpacity={0.8}
          accessibilityRole="checkbox" accessibilityState={{ checked: save }}>
          <Ionicons name="person-add-outline" size={17} color={save ? ACCENT_DARK : MUTED} />
          <Text style={s.custSaveTxt} numberOfLines={1}>Save {typedName.split(" ")[0]} to my customers</Text>
          <View style={[s.check, save && s.checkOn]}>
            {save && <Ionicons name="checkmark" size={15} color="#fff" />}
          </View>
        </TouchableOpacity>
      )}
    </View>
  );
}

function SquareBtn({ icon, label, onPress, active }: { icon: any; label: string; onPress: () => void; active?: boolean }) {
  return (
    <TouchableOpacity style={[s.squareBtn, active && { backgroundColor: ACCENT_DARK, borderColor: ACCENT_DARK }]} onPress={onPress} accessibilityLabel={label}>
      <Ionicons name={icon} size={18} color={active ? "#fff" : INK} />
    </TouchableOpacity>
  );
}

function Legend({ color, text, border, round, ring }: { color: string; text: string; border?: boolean; round?: boolean; ring?: boolean }) {
  return (
    <View style={s.legendItem}>
      <View style={[s.legendDot, { backgroundColor: color }, round && { borderRadius: 6 },
        border && { borderWidth: 1, borderColor: "#CBD5E1" }, ring && { borderWidth: 1.5, borderColor: ACCENT }]} />
      <Text style={s.legendTxt}>{text}</Text>
    </View>
  );
}

function Note({ text }: { text: string }) {
  return (
    <View style={s.note}>
      <Ionicons name="information-circle-outline" size={16} color={ACCENT_DARK} />
      <Text style={s.noteTxt}>{text}</Text>
    </View>
  );
}

function ActionOption({ icon, title, sub, tone, onPress, disabled, right }: {
  icon: any; title: string; sub: string; tone: { bg: string; border: string; fg: string }; onPress: () => void; disabled?: boolean; right?: ReactNode;
}) {
  return (
    <TouchableOpacity style={[s.actionOpt, { backgroundColor: tone.bg, borderColor: tone.border }]} onPress={onPress} disabled={disabled} activeOpacity={0.8}>
      <View style={s.actionIcon}><Ionicons name={icon} size={20} color={tone.fg} /></View>
      <View style={{ flex: 1 }}>
        <Text style={[s.actionTitle, { color: tone.fg }]}>{title}</Text>
        <Text style={[s.actionSub, { color: tone.fg }]}>{sub}</Text>
      </View>
      {right || <Ionicons name="chevron-forward" size={16} color={tone.fg} />}
    </TouchableOpacity>
  );
}

/** Monday-first month grid. Disabled outside [minTime, maxTime]. */
function MonthCalendar({ month, onMonth, minTime, maxTime, isSelected, isMarked, onPick }: {
  month: Date; onMonth: (d: Date) => void; minTime: number; maxTime: number;
  isSelected: (d: Date) => boolean; isMarked?: (d: Date) => boolean; onPick: (d: Date) => void;
}) {
  const y = month.getFullYear(), m = month.getMonth();
  const lead = (new Date(y, m, 1).getDay() + 6) % 7;
  const total = new Date(y, m + 1, 0).getDate();
  const cells: (Date | null)[] = Array(lead).fill(null);
  for (let i = 1; i <= total; i++) cells.push(new Date(y, m, i));
  while (cells.length % 7) cells.push(null);
  const canPrev = new Date(y, m, 0).getTime() >= minTime;
  const canNext = new Date(y, m + 1, 1).getTime() <= maxTime;
  const today = new Date();
  return (
    <View>
      <View style={s.calHead}>
        <TouchableOpacity disabled={!canPrev} onPress={() => onMonth(new Date(y, m - 1, 1))} style={[s.squareBtn, !canPrev && { opacity: 0.3 }]} accessibilityLabel="Previous month">
          <Ionicons name="chevron-back" size={18} color={INK} />
        </TouchableOpacity>
        <Text style={s.calTitle}>{month.toLocaleDateString("en-US", { month: "long", year: "numeric" })}</Text>
        <TouchableOpacity disabled={!canNext} onPress={() => onMonth(new Date(y, m + 1, 1))} style={[s.squareBtn, !canNext && { opacity: 0.3 }]} accessibilityLabel="Next month">
          <Ionicons name="chevron-forward" size={18} color={INK} />
        </TouchableOpacity>
      </View>
      <View style={s.calGrid}>
        {["M", "T", "W", "T", "F", "S", "S"].map((w, i) => <Text key={`w${i}`} style={s.calWeek}>{w}</Text>)}
      </View>
      <View style={s.calGrid}>
        {cells.map((d, i) => {
          if (!d) return <View key={`b${i}`} style={s.calCell} />;
          const t = dayStart(d);
          const off = t < minTime || t > maxTime;
          const sel = isSelected(d);
          const mark = !sel && !!isMarked?.(d);
          const isTd = sameDay(d, today);
          return (
            <TouchableOpacity key={d.toDateString()} disabled={off} onPress={() => onPick(d)} style={s.calCell} activeOpacity={0.7}
              accessibilityLabel={fmtDay(d)} accessibilityState={{ selected: sel, disabled: off }}>
              <View style={[s.calDay, mark && { backgroundColor: ACCENT_TINT }, isTd && !sel && s.calDayToday, sel && { backgroundColor: ACCENT_DARK }]}>
                <Text style={[s.calDayTxt, off && { color: "#CBD5E1" }, mark && { color: ACCENT_DARK }, sel && { color: "#fff" }]}>{d.getDate()}</Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// STYLES
// ═════════════════════════════════════════════════════════════════════════════
const shadow = { shadowColor: INK, shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 2 }, elevation: 2 };

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: PAGE },
  loaderWrap: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: PAGE },
  loaderText: { marginTop: 12, color: MUTED, fontSize: 15, fontWeight: "600" },

  // header
  header: { backgroundColor: BRAND, paddingHorizontal: 16, paddingBottom: 14, borderBottomLeftRadius: 22, borderBottomRightRadius: 22, gap: 10 },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  backBtn: { width: 44, height: 44, borderRadius: 13, backgroundColor: "rgba(255,255,255,0.14)", alignItems: "center", justifyContent: "center" },
  hKicker: { fontSize: 10, letterSpacing: 1.4, fontWeight: "800", color: ON_BRAND },
  hTitle: { fontSize: 20, fontWeight: "900", color: "#fff" },
  hSub: { fontSize: 12, fontWeight: "600", color: ON_BRAND, marginTop: 1 },
  scheduleBtn: { height: 40, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: "rgba(255,255,255,0.4)" },
  scheduleTxt: { color: "#fff", fontSize: 13, fontWeight: "800" },
  statRow: { flexDirection: "row", gap: 6 },
  stat: { flex: 1, flexDirection: "row", alignItems: "baseline", justifyContent: "center", gap: 4, backgroundColor: INK, borderRadius: 10, paddingVertical: 7 },
  statNum: { fontSize: 15, fontWeight: "900" },
  statLbl: { fontSize: 11, fontWeight: "700", color: "#CBD5E1" },
  progressRow: { flexDirection: "row", gap: 6 },
  progressBar: { height: 4, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.3)" },
  progressTxt: { fontSize: 11, fontWeight: "700", color: "#BBF7D0", marginTop: 5 },

  // cards
  card: { backgroundColor: "#fff", borderRadius: 18, padding: 14, ...shadow },
  cardTitle: { fontSize: 15, fontWeight: "800", color: INK },
  cardSub: { fontSize: 12, fontWeight: "600", color: MUTED, marginTop: 2 },
  kicker: { fontSize: 10.5, letterSpacing: 0.9, fontWeight: "800", color: MUTED, marginBottom: 8 },
  bigVal: { fontSize: 16, fontWeight: "800", color: INK, marginTop: -4 },
  rowCenter: { flexDirection: "row", alignItems: "center", gap: 8 },
  rowEnd: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  row2: { flexDirection: "row", gap: 8 },
  empty: { fontSize: 13, color: MUTED, fontWeight: "600", paddingVertical: 14, textAlign: "center" },
  hoursTxt: { fontSize: 11.5, fontWeight: "700", color: MUTED },

  // turf / date
  turfChip: { height: 38, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: LINE, backgroundColor: "#fff", justifyContent: "center" },
  turfChipOn: { backgroundColor: ACCENT_DARK, borderColor: ACCENT_DARK },
  turfChipTxt: { fontSize: 13, fontWeight: "800", color: "#334155" },
  monthChip: { height: 32, paddingHorizontal: 12, borderRadius: 999, backgroundColor: "#F3F4F6", justifyContent: "center" },
  monthChipOn: { backgroundColor: INK },
  monthChipTxt: { fontSize: 12, fontWeight: "800", color: "#374151" },
  calBtn: { height: 34, flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 11, borderRadius: 999, borderWidth: 1, borderColor: ACCENT_BORDER, backgroundColor: "#F0FDF4" },
  calBtnTxt: { fontSize: 12, fontWeight: "800", color: ACCENT_DARK },
  dateCard: { width: 48,height:55, paddingVertical: 7, borderRadius: 12, borderWidth: 1, borderColor: LINE, alignItems: "center", backgroundColor: "#fff" },
  dateCardOn: { backgroundColor: ACCENT_DARK, borderColor: ACCENT_DARK },
  dateDow: { fontSize: 10, fontWeight: "800", color: MUTED },
  dateNum: { fontSize: 17, fontWeight: "900", color: INK, marginTop: 1 },

  // recurring row
  recurRow: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12 },
  recurIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: "#ECFDF5", alignItems: "center", justifyContent: "center" },
  recurTitle: { fontSize: 14, fontWeight: "800", color: INK },
  recurSub: { fontSize: 12, fontWeight: "600", color: MUTED },
  seriesToggle: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderTopWidth: 1, borderTopColor: "#EEF1F5", paddingHorizontal: 14, paddingVertical: 10 },
  seriesToggleTxt: { fontSize: 12.5, fontWeight: "800", color: ACCENT_DARK },
  seriesRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 10, borderTopWidth: 1, borderTopColor: "#F3F4F6" },
  seriesLabel: { fontSize: 13, fontWeight: "800", color: INK },
  seriesMeta: { fontSize: 11.5, fontWeight: "600", color: MUTED, marginTop: 1 },
  seriesCancel: { height: 34, paddingHorizontal: 12, borderRadius: 10, backgroundColor: "#FEE2E2", justifyContent: "center" },
  seriesCancelTxt: { fontSize: 12, fontWeight: "800", color: "#DC2626" },

  // segment
  segment: { flexDirection: "row", backgroundColor: PAGE, borderRadius: 12, padding: 3, marginTop: 12 },
  segBtn: { flex: 1, height: 38, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  segOn: { backgroundColor: ACCENT_DARK },
  segOnLight: { backgroundColor: "#fff" },
  segTxt: { fontSize: 13, fontWeight: "800", color: MUTED },

  // grids / tiles
  groupLabel: { fontSize: 10.5, letterSpacing: 0.9, fontWeight: "800", color: MUTED, marginBottom: 6 },
  grid3: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  grid4: { flexDirection: "row", flexWrap: "wrap", gap: 5 },
  grid7: { flexDirection: "row", gap: 5 },
  tile: { flexGrow: 1, borderRadius: 11, borderWidth: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
  tileLabel: { fontSize: 12.5, fontWeight: "800" },
  tileSmall: { fontSize: 12, fontWeight: "800" },
  tileSub: { fontSize: 10, fontWeight: "800", opacity: 0.85, marginTop: 1 },
  legendRow: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 10 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  legendDot: { width: 11, height: 11, borderRadius: 3 },
  legendTxt: { fontSize: 11, fontWeight: "700", color: SLATE },

  // flexible
  fromToRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 12 },
  timeBox: { flex: 1, height: 62, borderRadius: 14, borderWidth: 1.5, borderColor: "#CBD5E1", backgroundColor: "#fff", alignItems: "center", justifyContent: "center" },
  timeBoxOn: { borderColor: ACCENT, backgroundColor: "#F0FDF4" },
  timeBoxLbl: { fontSize: 10, letterSpacing: 0.9, fontWeight: "800", color: MUTED },
  timeBoxVal: { fontSize: 18, fontWeight: "900", color: INK, marginTop: 2 },
  durPill: { fontSize: 11.5, fontWeight: "800", color: "#fff", backgroundColor: ACCENT, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4, overflow: "hidden" },
  pickHint: { fontSize: 12.5, fontWeight: "800", color: INK, marginTop: 12 },
  flexNote: { fontSize: 11, color: MUTED, fontWeight: "600", textAlign: "right", marginTop: 10 },

  // bottom bars
  bottomBar: { position: "absolute", left: 0, right: 0, bottom: 0, flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#fff", paddingHorizontal: 16, paddingTop: 12, borderTopLeftRadius: 22, borderTopRightRadius: 22, shadowColor: INK, shadowOpacity: 0.12, shadowRadius: 20, shadowOffset: { width: 0, height: -4 }, elevation: 16 },
  formBar: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#fff", paddingHorizontal: 14, paddingTop: 10, borderTopWidth: 1, borderTopColor: "#E8ECF1" },
  barLabel: { fontSize: 10.5, letterSpacing: 0.8, fontWeight: "800", color: MUTED },
  barValue: { fontSize: 15, fontWeight: "900", color: INK, marginTop: 1 },
  ghostBtn: { height: 46, paddingHorizontal: 14, borderRadius: 13, borderWidth: 1, borderColor: "#E2E8F0", backgroundColor: "#fff", alignItems: "center", justifyContent: "center" },
  ghostTxt: { fontSize: 14, fontWeight: "800", color: "#334155" },
  primaryBtn: { height: 48, borderRadius: 13, backgroundColor: ACCENT_DARK, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 },
  primaryTxt: { fontSize: 15, fontWeight: "800", color: "#fff" },

  // forms
  formBody: { padding: 14, gap: 10, paddingBottom: 24 },
  fieldLabel: { fontSize: 12, fontWeight: "800", color: "#334155", marginBottom: 5 },
  inputWrap: { flexDirection: "row", alignItems: "stretch", height: 48, borderRadius: 12, borderWidth: 1, borderColor: LINE, backgroundColor: "#F8FAFC", paddingHorizontal: 12, gap: 4 },
  inputWrapOn: { borderColor: ACCENT, borderWidth: 1.5, backgroundColor: "#fff" },
  prefix: { fontSize: 15, fontWeight: "800", color: MUTED, alignSelf: "center" },
  // fills the whole box height so the full box is the tap area
  inputInner: { flex: 1, minWidth: 0, height: "100%", fontSize: 15, fontWeight: "700", color: INK, paddingVertical: 0, textAlignVertical: "center" },
  input: { borderRadius: 12, borderWidth: 1, borderColor: LINE, backgroundColor: "#F8FAFC", paddingHorizontal: 12, paddingVertical: 10, fontSize: 14.5, color: INK },
  textArea: { minHeight: 76 },
  payRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 10 },
  miniChip: { height: 34, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: "#D7DDE5", backgroundColor: "#fff", justifyContent: "center" },
  miniChipTxt: { fontSize: 12, fontWeight: "800", color: "#334155" },
  chipRowWrap: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 10 },
  paidTxt: { marginLeft: "auto", fontSize: 12, fontWeight: "800", color: ACCENT_DARK },
  totalBox: { height: 46, borderRadius: 12, backgroundColor: "#F0FDF4", paddingHorizontal: 12, justifyContent: "center" },
  totalLbl: { fontSize: 10, fontWeight: "800", color: ACCENT_DARK },
  totalVal: { fontSize: 15, fontWeight: "900", color: ACCENT_DARK },

  // saved customers
  hIconBtn: { width: 40, height: 40, borderRadius: 12, borderWidth: 1, borderColor: "rgba(255,255,255,0.4)", alignItems: "center", justifyContent: "center" },
  custLbl: { fontSize: 10.5, letterSpacing: 0.9, fontWeight: "800", color: MUTED, marginBottom: 6 },
  custChip: { height: 36, flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: ACCENT_BORDER, backgroundColor: "#F0FDF4", maxWidth: 150 },
  custChipAll: { backgroundColor: ACCENT_DARK, borderColor: ACCENT_DARK },
  custChipTxt: { fontSize: 12.5, fontWeight: "800", color: ACCENT_DARK, flexShrink: 1 },
  custMatch: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 10, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 11, backgroundColor: "#F0FDF4" },
  custMatchTxt: { flex: 1, fontSize: 12.5, fontWeight: "800", color: ACCENT_DARK },
  custSug: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 50, paddingHorizontal: 10, borderRadius: 12, borderWidth: 1, borderColor: LINE, backgroundColor: "#fff" },
  custSugName: { fontSize: 13.5, fontWeight: "900", color: INK },
  custSugMeta: { fontSize: 11, fontWeight: "600", color: MUTED },
  custUse: { fontSize: 12.5, fontWeight: "900", color: ACCENT_DARK, paddingHorizontal: 6 },
  custBrowse: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 40, paddingHorizontal: 10, borderRadius: 11, borderWidth: 1, borderStyle: "dashed", borderColor: ACCENT_BORDER },
  custBrowseTxt: { flex: 1, fontSize: 12.5, fontWeight: "800", color: ACCENT_DARK },
  custSave: { flexDirection: "row", alignItems: "center", gap: 10, padding: 10, borderRadius: 12, borderWidth: 1, borderColor: LINE, backgroundColor: "#F8FAFC" },
  custSaveOn: { backgroundColor: "#F0FDF4", borderColor: ACCENT_BORDER },
  custSaveTxt: { flex: 1, fontSize: 13, fontWeight: "800", color: INK },

  // whatsapp toggle
  waRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 12, padding: 10, borderRadius: 12, backgroundColor: "#F0FDF4", borderWidth: 1, borderColor: ACCENT_BORDER },
  waTxt: { fontSize: 13, fontWeight: "800", color: INK },
  waWarn: { fontSize: 11, fontWeight: "700", color: "#B91C1C", marginTop: 2 },
  waCheckOn: { backgroundColor: WA_GREEN, borderColor: WA_GREEN },

  // recurring
  dayPill: { flex: 1, height: 46, borderRadius: 12, borderWidth: 1, borderColor: LINE, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" },
  dayPillOn: { backgroundColor: ACCENT, borderColor: ACCENT },
  dayPillTxt: { fontSize: 12, fontWeight: "800", color: "#334155" },
  squareBtn: { width: 44, height: 44, borderRadius: 12, borderWidth: 1, borderColor: LINE, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" },
  calInline: { borderTopWidth: 1, borderTopColor: "#EEF1F5", marginTop: 12, paddingTop: 12 },
  presetChip: { flex: 1, height: 36, borderRadius: 999, borderWidth: 1, borderColor: "#D7DDE5", backgroundColor: "#fff", alignItems: "center", justifyContent: "center" },
  presetChipOn: { borderWidth: 1.5, borderColor: "#22C55E", backgroundColor: "#F0FDF4" },
  presetTxt: { fontSize: 12.5, fontWeight: "800", color: "#334155" },
  darkCard: { backgroundColor: INK, borderRadius: 18, padding: 14, gap: 2 },
  darkTitle: { fontSize: 16, fontWeight: "800", color: "#fff", marginTop: -4 },
  darkSub: { fontSize: 12.5, fontWeight: "600", color: "#CBD5E1" },
  countBox: { flex: 1, borderRadius: 14, padding: 12 },
  countNum: { fontSize: 22, fontWeight: "900" },
  countLbl: { fontSize: 12, fontWeight: "700", color: SLATE },
  reviewRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10 },
  reviewLine: { borderBottomWidth: 1, borderBottomColor: "#EEF1F5" },
  reviewDow: { fontSize: 10.5, fontWeight: "800", color: MUTED },
  reviewNum: { fontSize: 17, fontWeight: "900", color: INK },
  reviewTitle: { fontSize: 13.5, fontWeight: "800", color: INK },
  reviewSub: { fontSize: 11.5, fontWeight: "600", marginTop: 1 },
  check: { width: 26, height: 26, borderRadius: 8, borderWidth: 2, borderColor: "#CBD5E1", alignItems: "center", justifyContent: "center" },
  checkOn: { backgroundColor: ACCENT, borderColor: ACCENT },
  centerHint: { fontSize: 12, fontWeight: "600", color: MUTED, textAlign: "center" },
  note: { flexDirection: "row", gap: 9, backgroundColor: "#F0FDF4", borderRadius: 13, padding: 11, marginTop: 12, alignItems: "flex-start" },
  noteTxt: { flex: 1, fontSize: 12, fontWeight: "700", color: "#14532D", lineHeight: 17 },

  // action sheet
  backdrop: { flex: 1, backgroundColor: "rgba(11,18,32,0.55)" },
  sheet: { backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 16, paddingTop: 10, gap: 12 },
  grabber: { width: 40, height: 4, borderRadius: 2, backgroundColor: "#CBD5E1", alignSelf: "center" },
  sheetSummary: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#F0FDF4", borderWidth: 1, borderColor: ACCENT_BORDER, borderRadius: 14, padding: 12 },
  sheetTime: { fontSize: 18, fontWeight: "900", color: INK },
  sheetSub: { fontSize: 12.5, fontWeight: "600", color: SLATE },
  sheetAsk: { fontSize: 12.5, fontWeight: "800", color: SLATE },
  actionOpt: { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1.5, borderRadius: 16, padding: 14 },
  actionIcon: { width: 44, height: 44, borderRadius: 13, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" },
  actionTitle: { fontSize: 15, fontWeight: "800" },
  actionSub: { fontSize: 12, fontWeight: "600", opacity: 0.9, marginTop: 1 },

  // calendar
  calBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "center", padding: 20 },
  calCard: { backgroundColor: "#fff", borderRadius: 22, padding: 16 },
  calHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 },
  calTitle: { fontSize: 15, fontWeight: "900", color: INK },
  calGrid: { flexDirection: "row", flexWrap: "wrap" },
  calWeek: { width: "14.2857%", textAlign: "center", fontSize: 11, fontWeight: "800", color: MUTED, paddingVertical: 6 },
  calCell: { width: "14.2857%", height: 42, alignItems: "center", justifyContent: "center" },
  calDay: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  calDayToday: { borderWidth: 1.5, borderColor: ACCENT },
  calDayTxt: { fontSize: 14, fontWeight: "800", color: INK },
  calTodayBtn: { flex: 1, height: 44, borderRadius: 12, backgroundColor: ACCENT_TINT, alignItems: "center", justifyContent: "center" },
  calTodayTxt: { fontSize: 14, fontWeight: "800", color: ACCENT_DARK },
});
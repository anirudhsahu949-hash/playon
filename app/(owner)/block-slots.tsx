import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Alert,
  SafeAreaView,
  StatusBar,
  ActivityIndicator,
  RefreshControl,
  Modal,
  TextInput,
  ScrollView,
  Platform,
  Animated,
  LayoutAnimation,
  UIManager,
} from "react-native";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { auth, db } from "../../firebaseConfig";
import {
  collection,
  getDocs,
  query,
  where,
  addDoc,
  deleteDoc,
  doc,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";




// ─── Types ────────────────────────────────────────────────────────────────────
type BookMode = "quick" | "flexible";
type ActionType = "block" | "offline" | null;

interface TimeChip {
  value: number;
  label: string;
  status: "available" | "booked" | "blocked";
}

interface QuickSlot {
  time: string;
  startValue: number;
  endValue: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const pad = (n: number) => String(n).padStart(2, "0");

function formatTime(v: number): string {
  if (v >= 24) return "12:00 AM";
  const hour = Math.floor(v);
  const minute = Math.round((v % 1) * 60);
  const suffix = hour >= 12 ? "PM" : "AM";
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h}:${pad(minute)} ${suffix}`;
}

function parseTime(s: string): number {
  const parts = s.trim().split(" ");
  const [hStr, mStr] = parts[0].split(":");
  let h = Number(hStr);
  const m = Number(mStr || 0);
  const period = parts[1];
  if (period === "PM" && h !== 12) h += 12;
  if (period === "AM" && h === 12) h = 0;
  return h + m / 60;
}

function parseSlotRange(slotTime: string): { start: number; end: number } {
  const parts = slotTime.split(" - ");
  const start = parseTime(parts[0].trim());
  let end = parseTime(parts[1].trim());
  if (end <= start) end = 24;
  return { start, end };
}

function rangesOverlap(aS: number, aE: number, bS: number, bE: number) {
  return aS < bE && bS < aE;
}

function buildTimeRange(start: number, end: number): string[] {
  const ranges: string[] = [];
  for (let t = start; t < end; t += 0.5) {
    const next = Math.min(t + 0.5, end);
    ranges.push(`${formatTime(t)} - ${formatTime(next)}`);
  }
  return ranges;
}

function mergeSlotDisplay(slots: string[]) {
  if (!slots || slots.length === 0) return "";

  const first = slots[0];
  const last = slots[slots.length - 1];

  const start = first.split(" - ")[0];
  const end = last.split(" - ")[1];

  return `${start} - ${end}`;
}

function isToday(date: Date) {
  return date.toDateString() === new Date().toDateString();
}

function currentDecimal() {
  const n = new Date();
  return n.getHours() + n.getMinutes() / 60;
}

// ─── SlotChip — identical feel to TurfDetails ─────────────────────────────────
function SlotChip({
  chip,
  isSelected,
  isInRange,
  onPress,
}: {
  chip: TimeChip;
  isSelected: boolean;
  isInRange: boolean;
  onPress: () => void;
}) {
  const scale = useRef(new Animated.Value(1)).current;

  const handlePress = useCallback(() => {
    Animated.sequence([
      Animated.timing(scale, { toValue: 0.92, duration: 70, useNativeDriver: true }),
      Animated.timing(scale, { toValue: 1, duration: 110, useNativeDriver: true }),
    ]).start();
    onPress();
  }, [onPress]);

  const disabled = chip.status !== "available";

  const chipBg = isSelected
    ? "#0A0F1E"
    : isInRange
    ? "#F0F4F8"
    : chip.status === "booked"
    ? "#FEE2E2"
    : chip.status === "blocked"
    ? "#FEF3C7"
    : "#FFFFFF";

  const chipBorder = isSelected
    ? "#0A0F1E"
    : isInRange
    ? "#9CA3AF"
    : chip.status !== "available"
    ? "transparent"
    : "#E5E7EB";

  const textColor = isSelected
    ? "#FFFFFF"
    : isInRange
    ? "#374151"
    : disabled
    ? "#9CA3AF"
    : "#111827";

  const statusLabel =
    chip.status === "booked"
      ? "Booked"
      : chip.status === "blocked"
      ? "Locked"
      : isSelected
      ? "●"
      : "";

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <TouchableOpacity
        style={[styles.chip, { backgroundColor: chipBg, borderColor: chipBorder }]}
        onPress={handlePress}
        disabled={disabled}
        activeOpacity={0.75}
      >
        <Text style={[styles.chipTimeText, { color: textColor }]}>{chip.label}</Text>
        {!!statusLabel && (
          <Text style={[styles.chipStatusText, { color: isSelected ? "rgba(255,255,255,0.7)" : "#9CA3AF" }]}>
            {statusLabel}
          </Text>
        )}
      </TouchableOpacity>
    </Animated.View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function BlockSlots() {
  const [turfs, setTurfs] = useState<any[]>([]);
  const [selectedTurf, setSelectedTurf] = useState<any>(null);
  const [blockedDocs, setBlockedDocs] = useState<any[]>([]);
  const [bookedDocs, setBookedDocs] = useState<any[]>([]);
  const [selectedDate, setSelectedDate] = useState(new Date());

  const [pageLoading, setPageLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);

  const [bookMode, setBookMode] = useState<BookMode>("quick");
  const [selectedQuickSlots, setSelectedQuickSlots] = useState<QuickSlot[]>([]);

  // flexible picker
  const [flexStart, setFlexStart] = useState<number | null>(null);
  const [flexEnd, setFlexEnd] = useState<number | null>(null);
  const [activePanel, setActivePanel] = useState<"from" | "to" | null>(null);
  const fromAnim = useRef(new Animated.Value(0)).current;
  const toAnim = useRef(new Animated.Value(0)).current;

  // action flow
  const [showActionModal, setShowActionModal] = useState(false);
  const [pendingAction, setPendingAction] = useState<ActionType>(null);

  // offline form
  const [custName, setCustName] = useState("");
  const [custPhone, setCustPhone] = useState("");
  const [custNote, setCustNote] = useState("");
  const [custAmount, setCustAmount] = useState("");
  const [remainingAmount, setRemainingAmount] = useState("");
  const selectedDateKey = useMemo(() => selectedDate.toDateString(), [selectedDate]);

  const [pendingDocId, setPendingDocId] = useState<string | null>(null);
  const MAX_BLOCK_SLOTS = 18; // consecutive quick slots an owner can block/book at once

  useEffect(() => {
    if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
      UIManager.setLayoutAnimationEnabledExperimental(true);
    }
  }, []);

  // ─── Data ──────────────────────────────────────────────────────────────────
  useEffect(() => { loadTurfs(); }, []);
  useEffect(() => { if (selectedTurf?.id) fetchDayData(); }, [selectedTurf, selectedDate]);
  useEffect(() => { clearSelection(); }, [selectedDate, bookMode, selectedTurf]);

  const loadTurfs = async () => {
    const uid = auth.currentUser?.uid;
    if (!uid) { setPageLoading(false); return; }
    try {
      const snap = await getDocs(query(collection(db, "turfs"), where("ownerId", "==", uid)));
      const data = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setTurfs(data);
      if (data.length > 0) setSelectedTurf(data[0]);
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
        getDocs(query(
          collection(db, "blockedSlots"),
          where("turfId", "==", selectedTurf.id),
          where("date", "==", selectedDateKey)
        )),
        getDocs(query(
          collection(db, "bookings"),
          where("turfId", "==", selectedTurf.id),
          where("dateString", "==", selectedDateKey)
        )),
      ]);
      setBlockedDocs(blockedSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setBookedDocs(
        bookedSnap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((b) => b.status !== "cancelled")
      );
    } catch {
      Alert.alert("Error", "Unable to load slots.");
    } finally {
      setRefreshing(false);
    }
  };

  // ─── Turf values ───────────────────────────────────────────────────────────
  const openingTime = useMemo(() => Number(selectedTurf?.openingTime ?? 6), [selectedTurf]);
  const closingTime = useMemo(() => {
    const c = Number(selectedTurf?.closingTime ?? 23);
    return c === 0 ? 24 : c;
  }, [selectedTurf]);
  const slotDuration = useMemo(() => Number(selectedTurf?.slotDuration ?? 60) / 60, [selectedTurf]);
  const STEP = 0.5;

  // ─── Unavailable slots (booked + blocked combined) ─────────────────────────
 const allUnavailable = useMemo((): string[] => {
  const fromBookings = bookedDocs.flatMap((b) =>
    b.selectedSlots || [b.slotTime, b.slot].filter(Boolean)
  );
  const fromBlocked = blockedDocs.flatMap((b) =>
    Array.isArray(b.slots) ? b.slots : [b.slotTime].filter(Boolean) // ← handle both old and new
  );
  return [...fromBookings, ...fromBlocked];
}, [bookedDocs, blockedDocs]);

  function isPast(v: number) {
    return isToday(selectedDate) && v < currentDecimal();
  }

  function isRangeUnavailable(start: number, end: number): boolean {
    return allUnavailable.some((s) => {
      try { const p = parseSlotRange(s); return rangesOverlap(start, end, p.start, p.end); }
      catch { return false; }
    });
  }

 function slotStatus(start: number): TimeChip["status"] {
  const end = start + STEP;
  const isBooked = bookedDocs.some((b) => {
    const slots: string[] = b.selectedSlots || [b.slotTime, b.slot].filter(Boolean);
    return slots.some((s) => {
      try { const p = parseSlotRange(s); return rangesOverlap(start, end, p.start, p.end); }
      catch { return false; }
    });
  });
  if (isBooked) return "booked";

  const isBlocked = blockedDocs.some((b) => {
    const slotList = Array.isArray(b.slots) ? b.slots : [b.slotTime].filter(Boolean);
    return slotList.some((s: string) => {
      try { const p = parseSlotRange(s); return rangesOverlap(start, end, p.start, p.end); }
      catch { return false; }
    });
  });
  if (isBlocked) return "blocked";   // ← this was missing

  return "available";                // ← this was missing
}

  // ─── From chips (30-min chips for flexible) ────────────────────────────────
  const fromChips = useMemo<TimeChip[]>(() => {
    const chips: TimeChip[] = [];
    for (let t = openingTime; t < closingTime && t < 24; t += STEP) {
      if (isPast(t)) continue;
      chips.push({ value: t, label: formatTime(t), status: slotStatus(t) });
    }
    return chips;
  }, [selectedTurf, selectedDate, allUnavailable, openingTime, closingTime]);

  // ─── To chips (from flexStart+30min up to closing, stops at first block) ───
  const toChips = useMemo<TimeChip[]>(() => {
    if (flexStart === null) return [];
    const chips: TimeChip[] = [];
    for (let t = flexStart + STEP; t <= closingTime && t <= 24; t += STEP) {
      if (isRangeUnavailable(flexStart, t)) break;
      chips.push({ value: t, label: formatTime(t), status: "available" });
    }
    return chips;
  }, [flexStart, closingTime, allUnavailable, selectedDate]);

  // ─── Quick slots ───────────────────────────────────────────────────────────
  const quickSlots = useMemo<QuickSlot[]>(() => {
    if (!selectedTurf) return [];
    const result: QuickSlot[] = [];
    for (let t = openingTime; t + slotDuration <= closingTime && t + slotDuration <= 24; t += slotDuration) {
      if (isPast(t)) continue;
      result.push({
        time: `${formatTime(t)} - ${formatTime(t + slotDuration)}`,
        startValue: t,
        endValue: t + slotDuration,
      });
    }
    return result;
  }, [selectedTurf, selectedDate, openingTime, closingTime, slotDuration]);

  // ─── Derived selection ─────────────────────────────────────────────────────
  const selectedStart = useMemo(() => {
    if (bookMode === "quick" && selectedQuickSlots.length > 0)
      return [...selectedQuickSlots].sort((a, b) => a.startValue - b.startValue)[0].startValue;
    return flexStart;
  }, [bookMode, selectedQuickSlots, flexStart]);

  const selectedEnd = useMemo(() => {
    if (bookMode === "quick" && selectedQuickSlots.length > 0)
      return [...selectedQuickSlots].sort((a, b) => b.endValue - a.endValue)[0].endValue;
    return flexEnd;
  }, [bookMode, selectedQuickSlots, flexEnd]);

  const selectedSlots = useMemo(() => {
    if (selectedStart === null || selectedEnd === null || selectedEnd <= selectedStart) return [];
    return buildTimeRange(selectedStart, selectedEnd);
  }, [selectedStart, selectedEnd]);

  const durationMinutes = useMemo(() => {
    if (selectedStart === null || selectedEnd === null || selectedEnd <= selectedStart) return 0;
    return Math.round((selectedEnd - selectedStart) * 60);
  }, [selectedStart, selectedEnd]);

  const durationLabel = useMemo(() => {
    const h = Math.floor(durationMinutes / 60);
    const m = durationMinutes % 60;
    if (!h) return `${m}m`;
    if (!m) return `${h}h`;
    return `${h}h ${m}m`;
  }, [durationMinutes]);

  const hasValidSelection = useMemo(() =>
    selectedStart !== null &&
    selectedEnd !== null &&
    selectedEnd > selectedStart &&
    selectedEnd <= closingTime &&
    !isPast(selectedStart) &&
    !isRangeUnavailable(selectedStart, selectedEnd),
    [selectedStart, selectedEnd, closingTime, allUnavailable, selectedDate]
  );

  const timeLabel = useMemo(() => {
    if (!hasValidSelection) return "";
    return `${formatTime(selectedStart!)} → ${formatTime(selectedEnd!)}`;
  }, [hasValidSelection, selectedStart, selectedEnd]);

  // ─── Panel animations ──────────────────────────────────────────────────────
  function animPanel(panel: "from" | "to", open: boolean) {
    Animated.timing(panel === "from" ? fromAnim : toAnim, {
      toValue: open ? 1 : 0, duration: 240, useNativeDriver: false,
    }).start();
  }

  function openFromPanel() {
    setActivePanel("from");
    animPanel("from", true);
    animPanel("to", false);
  }

  function openToPanel() {
    if (flexStart === null) { Alert.alert("Select Start", "Pick a FROM time first."); return; }
    setActivePanel("to");
    animPanel("to", true);
    animPanel("from", false);
  }

  function handleSelectFrom(chip: TimeChip) {
    if (chip.status !== "available") return;
    setFlexStart(chip.value);
    setFlexEnd(null);
    setActivePanel("to");
    animPanel("from", false);
    animPanel("to", true);
  }

  function handleSelectTo(chip: TimeChip) {
    if (chip.status !== "available") return;
    setFlexEnd(chip.value);
    setActivePanel(null);
    animPanel("to", false);
  }

  // ─── Quick slot selection (continuous, max 3) ──────────────────────────────
  function handleQuickPress(slot: QuickSlot) {
    const exists = selectedQuickSlots.some((s) => s.time === slot.time);
    if (exists) { setSelectedQuickSlots(selectedQuickSlots.filter((s) => s.time !== slot.time)); return; }
    if (selectedQuickSlots.length === 0) { setSelectedQuickSlots([slot]); return; }
    const sorted = [...selectedQuickSlots].sort((a, b) => a.startValue - b.startValue);
    const first = sorted[0], last = sorted[sorted.length - 1];
    if (slot.endValue === first.startValue || slot.startValue === last.endValue) {
      if (selectedQuickSlots.length >= MAX_BLOCK_SLOTS) {
  Alert.alert("Limit Reached", `You can select up to ${MAX_BLOCK_SLOTS} consecutive slots at once.`);
  return;
}
      setSelectedQuickSlots([...selectedQuickSlots, slot]);
    } else {
      Alert.alert("Continuous Only", "Select adjacent slots only.");
    }
  }

  function clearSelection() {
    setSelectedQuickSlots([]);
    setFlexStart(null);
    setFlexEnd(null);
    setActivePanel(null);
    animPanel("from", false);
    animPanel("to", false);
  }

  function clearForm() {
    setCustName(""); setCustPhone(""); setCustNote(""); setCustAmount(""); setRemainingAmount("");
  }

  // ─── Save ──────────────────────────────────────────────────────────────────
  async function saveAction(type: "block" | "offline") {
  if (!hasValidSelection) return;
  if (type === "offline" && !custName.trim()) {
    Alert.alert("Name Required", "Please enter the customer name.");
    return;
  }
  setSaving(true);
  try {
    // ✅ ONE doc with all slots as array — not one doc per slot
    await addDoc(collection(db, "blockedSlots"), {
      turfId:    selectedTurf.id,
      turfName:  selectedTurf.name || "",
      slots:     selectedSlots,        // ← array e.g. ["6:00 AM - 6:30 AM", "6:30 AM - 7:00 AM"]
      date:      selectedDateKey,
      ownerId:   auth.currentUser?.uid,
      type,
      ...(type === "offline"
        ? {
            customerName:    custName.trim(),
            customerPhone:   custPhone.trim(),
            note:            custNote.trim(),
            amount:          Number(custAmount.trim()) || 0,
            remainingAmount: Number(remainingAmount.trim()) || 0,
          }
        : {}),
      createdAt: serverTimestamp(),
    });

    setPendingAction(null);
    clearForm();
    clearSelection();
    await fetchDayData();
    Alert.alert("✓ Done", type === "offline" ? "Offline booking saved." : "Slots blocked.");
  } catch {
    Alert.alert("Error", "Something went wrong.");
  } finally {
    setSaving(false);
  }
}

  async function unblockDoc(id: string) {
    setSaving(true);
    try {
      await deleteDoc(doc(db, "blockedSlots", id));
      await fetchDayData();
    } catch {
      Alert.alert("Error", "Could not free slot.");
    } finally {
      setSaving(false);
    }
  }

  async function saveOfflineBooking() {
  if (!pendingDocId) return;
  if (!custName.trim()) { Alert.alert("Name Required", "Please enter the customer name."); return; }
  setSaving(true);
  try {
    await updateDoc(doc(db, "blockedSlots", pendingDocId), {
      type: "offline",
      pending: false,
      customerName: custName.trim(),
      customerPhone: custPhone.trim(),
      note: custNote.trim(),
      amount: Number(custAmount.trim()) || 0,
      remainingAmount: Number(remainingAmount.trim()) || 0,
    });
    setPendingDocId(null);
    setPendingAction(null);
    clearForm();
    clearSelection();
    await fetchDayData();
    Alert.alert("✓ Done", "Offline booking saved.");
  } catch {
    Alert.alert("Error", "Something went wrong.");
  } finally {
    setSaving(false);
  }
}

async function cancelOfflineBooking() {
  const id = pendingDocId;
  setPendingDocId(null);
  setPendingAction(null);
  clearForm();
  clearSelection();
  if (id) {
    try { await deleteDoc(doc(db, "blockedSlots", id)); } catch {}
    await fetchDayData();
  }
  Alert.alert("Booking Cancelled", "The slot was freed and is available again.");
}

  // ─── Stats ─────────────────────────────────────────────────────────────────
  const summary = useMemo(() => {
    const appBooked = bookedDocs.length;
    const offline = blockedDocs.filter((b) => b.type === "offline").length;
    const blocked = blockedDocs.filter((b) => b.type !== "offline").length;
    const available = Math.max(quickSlots.length - appBooked - offline - blocked, 0);
    return { appBooked, offline, blocked, available };
  }, [bookedDocs, blockedDocs, quickSlots]);

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() + i); return d;
  }), []);

  const fromPanelH = fromAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 250] });
  const toPanelH = toAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 250] });

  // ─── Loader ────────────────────────────────────────────────────────────────
  if (pageLoading) {
    return (
      <SafeAreaView style={styles.loaderWrap}>
        <StatusBar barStyle="light-content" backgroundColor="#0A0F1E" />
        <ActivityIndicator size="large" color="#22C55E" />
        <Text style={styles.loaderText}>Loading...</Text>
      </SafeAreaView>
    );
  }

  // ─── Main render ──────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor="#0A0F1E" />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} tintColor="#22C55E" onRefresh={() => fetchDayData(true)} />
        }
      >
        {/* ── HERO ─────────────────────────────────────────── */}
        <View style={styles.hero}>
          <View style={styles.heroGlow1} />
          <View style={styles.heroGlow2} />
          <Text style={styles.heroTag}>slot Panel</Text>
          <Text style={styles.heroTitle}>Block Slots</Text>
          <Text style={styles.heroSub}>
            Block slot or make offline booking with customer details.
          </Text>
          <View style={styles.statsRow}>
            {[
              { label: "Available", value: summary.available, color: "#22C55E" },
              { label: "App Booked", value: summary.appBooked, color: "#60A5FA" },
              { label: "Offline", value: summary.offline, color: "#34D399" },
              { label: "Blocked", value: summary.blocked, color: "#F87171" },
            ].map((s) => (
              <View key={s.label} style={styles.statCard}>
                <Text style={[styles.statValue, { color: s.color }]}>{s.value}</Text>
                <Text style={styles.statLabel}>{s.label}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* ── TURF SELECT ──────────────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Select Turf</Text>
          <FlatList
            horizontal showsHorizontalScrollIndicator={false}
            data={turfs} keyExtractor={(i) => i.id}
            contentContainerStyle={{ paddingRight: 4 }}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={[styles.turfChip, selectedTurf?.id === item.id && styles.turfChipActive]}
                onPress={() => setSelectedTurf(item)}
              >
                <Text style={[styles.turfChipText, selectedTurf?.id === item.id && styles.turfChipTextActive]}>
                  {item.name}
                </Text>
              </TouchableOpacity>
            )}
          />
        </View>

        {/* ── DATE SELECT ──────────────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Date</Text>
          <FlatList
            horizontal showsHorizontalScrollIndicator={false}
            data={days} keyExtractor={(d) => d.toDateString()}
            contentContainerStyle={{ paddingRight: 4 }}
            renderItem={({ item }) => {
              const active = selectedDate.toDateString() === item.toDateString();
              return (
                <TouchableOpacity
                  style={[styles.dateCard, active && styles.dateCardActive]}
                  onPress={() => setSelectedDate(item)}
                >
                  <Text style={[styles.dateDayTxt, active && styles.dateActiveTxt]}>
                    {item.toLocaleDateString("en-US", { weekday: "short" })}
                  </Text>
                  <Text style={[styles.dateNumTxt, active && styles.dateActiveTxt]}>
                    {item.getDate()}
                  </Text>
                  <Text style={[styles.dateMonTxt, active && styles.dateActiveTxt]}>
                    {item.toLocaleDateString("en-US", { month: "short" })}
                  </Text>
                </TouchableOpacity>
              );
            }}
          />
        </View>

        {/* ── TURF HOURS BADGE ─────────────────────────────── */}
        {selectedTurf && (
          <View style={styles.hoursNote}>
            <Text style={styles.hoursNoteText}>
              🕐  Turf hours: {formatTime(openingTime)} – {formatTime(closingTime)}
            </Text>
          </View>
        )}

        {/* ── BOOKING SECTION ──────────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Book / Block Time</Text>

          {/* Mode toggle — same as TurfDetails */}
          <View style={styles.modeSwitcher}>
            {(["quick", "flexible"] as BookMode[]).map((m) => (
              <TouchableOpacity
                key={m}
                style={[styles.modeBtn, bookMode === m && styles.modeBtnActive]}
                onPress={() => {
                  LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                  setBookMode(m);
                }}
              >
                <Text style={[styles.modeBtnText, bookMode === m && styles.modeBtnTextActive]}>
                  {m === "quick" ? "Quick Slots" : "Flexible Time"}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* ── QUICK SLOTS ───── */}
          {bookMode === "quick" && (
            <View>
              {quickSlots.length === 0 ? (
                <Text style={styles.noSlotsText}>No slots available for this date.</Text>
              ) : (
                <View style={styles.quickGrid}>
                  {quickSlots.map((slot) => {
                    const isBookedByApp = bookedDocs.some((b) => {
                      const slots: string[] = b.selectedSlots || [b.slotTime, b.slot].filter(Boolean);
                      return slots.some((s) => { try { const p = parseSlotRange(s); return rangesOverlap(slot.startValue, slot.endValue, p.start, p.end); } catch { return false; } });
                    });
                    const blockedDoc = blockedDocs.find((b) => {
  const slotList = Array.isArray(b.slots) ? b.slots : [b.slotTime].filter(Boolean);
  return slotList.some((s: string) => {
    try { const p = parseSlotRange(s); return rangesOverlap(slot.startValue, slot.endValue, p.start, p.end); }
    catch { return false; }
  });
});
                    const isUnavail = isBookedByApp || !!blockedDoc;
                    const selected = selectedQuickSlots.some((s) => s.time === slot.time);

                    const cardBg = selected
                      ? "#0A0F1E"
                      : isBookedByApp
                      ? "#EFF6FF"
                      : blockedDoc?.type === "offline"
                      ? "#F0FDF4"
                      : blockedDoc
                      ? "#FFF7ED"
                      : "#FFFFFF";

                    const borderColor = selected
                      ? "#0A0F1E"
                      : isBookedByApp
                      ? "#BFDBFE"
                      : blockedDoc?.type === "offline"
                      ? "#BBF7D0"
                      : blockedDoc
                      ? "#FED7AA"
                      : "#E5E7EB";

                    const statusLabel = isBookedByApp
                      ? "App Booked"
                      : blockedDoc?.type === "offline"
                      ? "Offline"
                      : blockedDoc
                      ? "Blocked"
                      : selected
                      ? "Selected ✓"
                      : "Available";

                    const statusColor = isBookedByApp
                      ? "#2563EB"
                      : blockedDoc?.type === "offline"
                      ? "#059669"
                      : blockedDoc
                      ? "#D97706"
                      : selected
                      ? "#22C55E"
                      : "#9CA3AF";

                    return (
                      <TouchableOpacity
                        key={slot.time}
                        style={[styles.quickCard, { backgroundColor: cardBg, borderColor }]}
                        onPress={() => {
                          if (isBookedByApp) {
                            Alert.alert("App Booking", "This slot is booked by a customer via the app.");
                            return;
                          }
                          if (blockedDoc) {
                            Alert.alert(
                              "Free Slot",
                              `Remove block on ${slot.time}?`,
                              [
                                { text: "Cancel", style: "cancel" },
                                { text: "Remove", style: "destructive", onPress: () => unblockDoc(blockedDoc.id) },
                              ]
                            );
                            return;
                          }
                          handleQuickPress(slot);
                        }}
                      >
                        <Text style={[styles.quickCardTime, selected && { color: "#FFFFFF" }]}>
                          {slot.time}
                        </Text>
                        <Text style={[styles.quickCardStatus, { color: selected ? "#22C55E" : statusColor }]}>
                          {statusLabel}
                        </Text>
                        {blockedDoc?.customerName ? (
                          <Text style={styles.quickCardMeta}>{blockedDoc.customerName}</Text>
                        ) : null}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}
              {selectedQuickSlots.length > 0 && (
                <TouchableOpacity style={styles.inlineClearBtn} onPress={clearSelection}>
                  <Text style={styles.inlineClearText}>Clear Selection</Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          {/* ── FLEXIBLE PICKER — same FROM/TO panel pattern as TurfDetails ── */}
          {bookMode === "flexible" && (
            <View style={styles.flexContainer}>
              <View style={styles.flexHeader}>
                <View>
                  <Text style={styles.flexTitle}>Select Time Range</Text>
                  <Text style={styles.flexSub}>Any start/end within turf hours</Text>
                </View>
                {(flexStart !== null || flexEnd !== null) && (
                  <TouchableOpacity style={styles.clearPill} onPress={clearSelection}>
                    <Text style={styles.clearPillText}>Clear</Text>
                  </TouchableOpacity>
                )}
              </View>

              {/* FROM / TO boxes */}
              <View style={styles.timeBoxRow}>
                <TouchableOpacity
                  style={[
                    styles.timeBox,
                    activePanel === "from" && styles.timeBoxActive,
                    flexStart !== null && activePanel !== "from" && styles.timeBoxFilled,
                  ]}
                  onPress={openFromPanel}
                  activeOpacity={0.8}
                >
                  <Text style={styles.timeBoxLabel}>FROM</Text>
                  <Text style={[styles.timeBoxValue, flexStart === null && styles.timeBoxPlaceholder]}>
                    {flexStart !== null ? formatTime(flexStart) : "HH:MM"}
                  </Text>
                  {flexStart !== null && <View style={styles.timeBoxDot} />}
                </TouchableOpacity>

                <View style={styles.arrowWrap}>
                  <Text style={styles.arrowText}>→</Text>
                  {flexStart !== null && flexEnd !== null && (
                    <Text style={styles.durBadge}>{durationLabel}</Text>
                  )}
                </View>

                <TouchableOpacity
                  style={[
                    styles.timeBox,
                    activePanel === "to" && styles.timeBoxActive,
                    flexEnd !== null && activePanel !== "to" && styles.timeBoxFilled,
                    flexStart === null && styles.timeBoxDisabled,
                  ]}
                  onPress={openToPanel}
                  activeOpacity={0.8}
                >
                  <Text style={styles.timeBoxLabel}>TO</Text>
                  <Text style={[styles.timeBoxValue, flexEnd === null && styles.timeBoxPlaceholder]}>
                    {flexEnd !== null ? formatTime(flexEnd) : "HH:MM"}
                  </Text>
                  {flexEnd !== null && <View style={styles.timeBoxDot} />}
                </TouchableOpacity>
              </View>

              {/* Price preview when valid (owner sees duration only) */}
              {flexStart !== null && flexEnd !== null && hasValidSelection && (
                <View style={styles.selectionPreview}>
                  <Text style={styles.selectionPreviewLabel}>Selected duration</Text>
                  <Text style={styles.selectionPreviewValue}>{durationLabel}</Text>
                </View>
              )}

              {/* FROM panel */}
              <Animated.View style={{ maxHeight: fromPanelH, overflow: "hidden" }}>
                <View style={styles.chipPanel}>
                  <Text style={styles.chipPanelTitle}>Select start time</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
                    {fromChips.map((chip) => (
                      <SlotChip
                        key={chip.value}
                        chip={chip}
                        isSelected={flexStart === chip.value}
                        isInRange={false}
                        onPress={() => handleSelectFrom(chip)}
                      />
                    ))}
                  </ScrollView>
                  <View style={styles.legendRow}>
                    {[
                      { color: "#0A0F1E", label: "Selected", border: false },
                      { color: "#FFFFFF", label: "Available", border: true },
                      { color: "#FEE2E2", label: "App Booked", border: false },
                      { color: "#FEF3C7", label: "Blocked", border: false },
                    ].map((l) => (
                      <View key={l.label} style={styles.legendItem}>
                        <View style={[styles.legendDot, { backgroundColor: l.color, borderWidth: l.border ? 1 : 0, borderColor: "#D1D5DB" }]} />
                        <Text style={styles.legendText}>{l.label}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              </Animated.View>

              {/* TO panel */}
              <Animated.View style={{ maxHeight: toPanelH, overflow: "hidden" }}>
                <View style={styles.chipPanel}>
                  <Text style={styles.chipPanelTitle}>
                    Select end time{flexStart !== null ? ` — from ${formatTime(flexStart)}` : ""}
                  </Text>
                  {toChips.length === 0 ? (
                    <Text style={styles.noSlotsText}>No available end times after this point.</Text>
                  ) : (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
                      {toChips.map((chip) => (
                        <SlotChip
                          key={chip.value}
                          chip={chip}
                          isSelected={flexEnd === chip.value}
                          isInRange={
                            flexStart !== null && flexEnd !== null &&
                            chip.value > flexStart && chip.value <= flexEnd
                          }
                          onPress={() => handleSelectTo(chip)}
                        />
                      ))}
                    </ScrollView>
                  )}
                  <Text style={styles.flexNote}>
                    Slots must end by {formatTime(closingTime)} (closing time)
                  </Text>
                </View>
              </Animated.View>

              {/* Validation hint */}
              {flexStart !== null && flexEnd !== null && !hasValidSelection && (
                <View style={styles.validationBox}>
                  <Text style={styles.validationText}>
                    {flexEnd > closingTime
                      ? `Cannot exceed closing time (${formatTime(closingTime)}).`
                      : isRangeUnavailable(flexStart, flexEnd)
                      ? "This range overlaps a booked or blocked slot."
                      : "Invalid selection. Try again."}
                  </Text>
                </View>
              )}
            </View>
          )}
        </View>

        {/* ── BLOCKED / OFFLINE SLOTS LIST ─────────────────── */}
        {blockedDocs.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Current Blocked Slots</Text>
            {blockedDocs.map((b) => (
              <View key={b.id} style={styles.blockedRow}>
                <View style={[styles.blockedBar, { backgroundColor: b.type === "offline" ? "#22C55E" : "#F87171" }]} />
                <View style={{ flex: 1, paddingLeft: 12 }}>
   <Text style={styles.blockedTime}>
  {Array.isArray(b.slots)
    ? mergeSlotDisplay(b.slots)
    : b.slotTime}
</Text>
                  <Text style={styles.blockedType}>
                    {b.type === "offline" ? "Offline Booking" : "Blocked"}
                    {b.customerName ? ` · ${b.customerName}` : ""}
                    {b.remainingAmount ? ` · Due ₹${b.remainingAmount}` : ""}
                  </Text>
                </View>
                <TouchableOpacity
                  style={styles.freeBtn}
                  disabled={saving}
                  onPress={() =>
                    Alert.alert("Free Slot", `Remove this block?`, [
                      { text: "Cancel", style: "cancel" },
                      { text: "Remove", style: "destructive", onPress: () => unblockDoc(b.id) },
                    ])
                  }
                >
                  <Text style={styles.freeBtnText}>Free</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}

        <View style={{ height: hasValidSelection ? 140 : 40 }} />
      </ScrollView>

      {/* ── BOTTOM BAR (appears when selection is valid) ───── */}
      {hasValidSelection && (
        <View style={styles.bottomBar}>
          <View style={{ flex: 1 }}>
            <Text style={styles.bottomLabel}>Selected</Text>
            <Text style={styles.bottomTime}>{timeLabel}</Text>
            <Text style={styles.bottomDur}>{durationLabel} · {selectedSlots.length} segment{selectedSlots.length !== 1 ? "s" : ""}</Text>
          </View>
          <TouchableOpacity
            style={styles.chooseActionBtn}
            onPress={() => setShowActionModal(true)}
            disabled={saving}
          >
            <Text style={styles.chooseActionBtnText}>Choose Action ›</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ══ ACTION CHOICE MODAL ════════════════════════════ */}
      <Modal visible={showActionModal} transparent animationType="fade">
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>What to do?</Text>
            <Text style={styles.sheetSub}>{timeLabel} · {durationLabel}</Text>

            <TouchableOpacity
  style={styles.actionRow}
  onPress={() => { setShowActionModal(false); saveAction("block"); }}
>
              <View style={[styles.actionIcon, { backgroundColor: "#FEE2E230" }]}>
                <Text style={{ fontSize: 22 }}>🚫</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.actionTitle}>Block Only</Text>
                <Text style={styles.actionSub}>Mark as unavailable — no customer info needed</Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity
  style={styles.actionRow}
  onPress={async () => {
    setShowActionModal(false);
    setSaving(true);
    try {
      const ref = await addDoc(collection(db, "blockedSlots"), {
        turfId: selectedTurf.id,
        turfName: selectedTurf.name || "",
        slots: selectedSlots,
        date: selectedDateKey,
        ownerId: auth.currentUser?.uid,
        type: "block",        // temporary lock
        pending: true,
        createdAt: serverTimestamp(),
      });
      setPendingDocId(ref.id);
      setPendingAction("offline");
      await fetchDayData();
    } catch {
      Alert.alert("Error", "Could not lock the slot. Try again.");
    } finally {
      setSaving(false);
    }
  }}
>
  <View style={[styles.actionIcon, { backgroundColor: "#34D39930" }]}>
    <Text style={{ fontSize: 22 }}>📋</Text>
  </View>
  <View style={{ flex: 1 }}>
    <Text style={styles.actionTitle}>Offline Booking</Text>
    <Text style={styles.actionSub}>Save walk-in customer details</Text>
  </View>
</TouchableOpacity>

            <TouchableOpacity
              style={styles.cancelRow}
              onPress={() => { setShowActionModal(false); clearSelection(); }}
            >
              <Text style={styles.cancelRowText}>Cancel Selection</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ══ OFFLINE BOOKING FORM MODAL ═════════════════════ */}
      <Modal visible={pendingAction === "offline"} transparent animationType="slide" onRequestClose={cancelOfflineBooking}>
        <View style={styles.backdrop}>
          <View style={[styles.sheet, { maxHeight: "90%" }]}>
            <View style={styles.sheetHandle} />
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{
    ...styles.scrollContent,
    paddingBottom: 140,  // ✅ Space for the bottom bar
  }}>
              <Text style={styles.sheetTitle}>Offline Booking</Text>

              <View style={styles.slotBox}>
                <Text style={styles.slotBoxLabel}>Time Slot</Text>
                <Text style={styles.slotBoxValue}>{timeLabel}</Text>
                <Text style={styles.slotBoxSub}>
                  {selectedTurf?.name} · {selectedDateKey} · {durationLabel}
                </Text>
              </View>

              {[
                { label: "Customer Name *", val: custName, set: setCustName, kb: "default" as const, ph: "Enter name" },
                { label: "Phone Number", val: custPhone, set: setCustPhone, kb: "phone-pad" as const, ph: "Enter phone(optional)" },
                { label: "Amount (₹)", val: custAmount, set: setCustAmount, kb: "numeric" as const, ph: "Enter amount (booking amount)" },
                 {label: "Remaining Amount (₹)", val: remainingAmount,set: setRemainingAmount,kb: "numeric" as const,ph: "Enter remaining amount",},
              ].map((f) => (
                <View key={f.label}>
                  <Text style={styles.inputLabel}>{f.label}</Text>
                  <TextInput
                    value={f.val} onChangeText={f.set}
                    placeholder={f.ph} placeholderTextColor="#9CA3AF"
                    keyboardType={f.kb} style={styles.input}
                  />
                </View>
              ))}

              <Text style={styles.inputLabel}>Note (optional)</Text>
              <TextInput
                value={custNote} onChangeText={setCustNote}
                placeholder="Any additional info"
                placeholderTextColor="#9CA3AF"
                style={[styles.input, styles.textArea]}
                multiline numberOfLines={3} textAlignVertical="top"
              />

              <TouchableOpacity
                style={[styles.primaryBtn, saving && { opacity: 0.6 }]}
                onPress={saveOfflineBooking}
                disabled={saving}
              >
                <Text style={styles.primaryBtnText}>
                  {saving ? "Saving..." : "Save Offline Booking"}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.secondaryBtn}
                onPress={cancelOfflineBooking}
                disabled={saving}
              >
                <Text style={styles.secondaryBtnText}>Cancel</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#F0F4F8" },
  scrollContent: { paddingBottom: 20 },
  loaderWrap: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#0A0F1E" },
  loaderText: { marginTop: 12, color: "#9CA3AF", fontSize: 15, fontWeight: "600" },

  hero: {
    backgroundColor: "#0A0F1E",
    paddingHorizontal: 20,
    paddingTop: Platform.OS === "android" ? (StatusBar.currentHeight || 0) + 14 : 18,
    paddingBottom: 28,
    borderBottomLeftRadius: 32, borderBottomRightRadius: 32,
    overflow: "hidden",
  },
  heroGlow1: { position: "absolute", top: -40, right: -40, width: 200, height: 200, borderRadius: 100, backgroundColor: "rgba(34,197,94,0.15)" },
  heroGlow2: { position: "absolute", bottom: -60, left: -40, width: 180, height: 180, borderRadius: 90, backgroundColor: "rgba(96,165,250,0.10)" },
  heroTag: { color: "#6EE7B7", fontSize: 11, fontWeight: "800", letterSpacing: 1.5, textTransform: "uppercase" },
  heroTitle: { color: "#FFFFFF", fontSize: 30, fontWeight: "900", marginTop: 4 },
  heroSub: { color: "#9CA3AF", fontSize: 13, lineHeight: 20, marginTop: 8 },

  statsRow: { flexDirection: "row", marginTop: 10, gap: 8 },
  statCard: {
    flex: 1, backgroundColor: "rgba(255,255,255,0.07)",
    borderRadius: 16, paddingVertical: 14, alignItems: "center",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.08)",
  },
  statValue: { fontSize: 20, fontWeight: "900" },
  statLabel: { color: "#9CA3AF", fontSize: 10, fontWeight: "700", marginTop: 4, textAlign: "center" },

  section: {
    marginHorizontal: 16, marginTop: 10,
    backgroundColor: "#FFFFFF", borderRadius: 24, padding: 13,
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 8, elevation: 2,
  },
  sectionTitle: { color: "#111827", fontSize: 17, fontWeight: "900", marginBottom: 14 },

  turfChip: {
    paddingHorizontal: 16, paddingVertical: 10,
    backgroundColor: "#F3F4F6", borderRadius: 999, marginRight: 10,
    borderWidth: 1, borderColor: "#E5E7EB",
  },
  turfChipActive: { backgroundColor: "#0A0F1E", borderColor: "#0A0F1E" },
  turfChipText: { color: "#374151", fontSize: 13, fontWeight: "700" },
  turfChipTextActive: { color: "#FFFFFF" },

  dateCard: {
    width: 58, paddingVertical: 7, borderRadius: 13,
    backgroundColor: "#F3F4F6", alignItems: "center", marginRight: 10,
    borderWidth: 1, borderColor: "#E5E7EB",
  },
  dateCardActive: { backgroundColor: "#0A0F1E", borderColor: "#0A0F1E" },
  dateDayTxt: { color: "#9CA3AF", fontSize: 9, fontWeight: "700", textTransform: "uppercase" },
  dateNumTxt: { color: "#111827", fontSize: 20, fontWeight: "900", marginTop: 2 },
  dateMonTxt: { color: "#6B7280", fontSize: 8, fontWeight: "600", marginTop: 1 },
  dateActiveTxt: { color: "#FFFFFF" },

  hoursNote: {
    marginHorizontal: 16, marginTop: 10,
    backgroundColor: "#F0FDF4", borderRadius: 12, paddingVertical: 8, paddingHorizontal: 14,
    borderWidth: 1, borderColor: "#BBF7D0",
  },
  hoursNoteText: { color: "#166534", fontSize: 12, fontWeight: "700" },

  modeSwitcher: {
    flexDirection: "row", backgroundColor: "#F3F4F6",
    padding: 4, borderRadius: 16, marginBottom: 16,
  },
  modeBtn: { flex: 1, paddingVertical: 12, borderRadius: 13, alignItems: "center" },
  modeBtnActive: { backgroundColor: "#0A0F1E" },
  modeBtnText: { color: "#6B7280", fontSize: 13, fontWeight: "800" },
  modeBtnTextActive: { color: "#FFFFFF" },

  quickGrid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between" },
  quickCard: {
    width: "48.5%", borderRadius: 15, padding: 12, marginBottom: 8,
    borderWidth: 1.5, minHeight: 80,
  },
  quickCardTime: { color: "#374151", fontSize: 12, fontWeight: "800", lineHeight: 18 },
  quickCardStatus: { marginTop: 8, fontSize: 11, fontWeight: "800" },
  quickCardMeta: { marginTop: 4, fontSize: 10, color: "#6B7280" },

  inlineClearBtn: {
    marginTop: 4, alignSelf: "flex-end",
    backgroundColor: "#FEE2E2", paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999,
  },
  inlineClearText: { color: "#DC2626", fontSize: 12, fontWeight: "700" },

  flexContainer: { marginTop: 4 },
  flexHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 },
  flexTitle: { fontSize: 15, fontWeight: "800", color: "#111827" },
  flexSub: { fontSize: 12, color: "#9CA3AF", marginTop: 2 },
  clearPill: { backgroundColor: "#FEE2E2", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 },
  clearPillText: { color: "#DC2626", fontSize: 12, fontWeight: "700" },

  timeBoxRow: { flexDirection: "row", alignItems: "center" },
  timeBox: {
    flex: 1, backgroundColor: "#F7F8FA", borderRadius: 18,
    padding: 16, borderWidth: 1.5, borderColor: "#E5E7EB", alignItems: "center",
  },
  timeBoxActive: { borderColor: "#0A0F1E", backgroundColor: "#FFFFFF" },
  timeBoxFilled: { borderColor: "#6B7280", backgroundColor: "#FFFFFF" },
  timeBoxDisabled: { opacity: 0.4 },
  timeBoxLabel: { fontSize: 10, fontWeight: "800", color: "#9CA3AF", textTransform: "uppercase", letterSpacing: 1 },
  timeBoxValue: { fontSize: 20, fontWeight: "900", color: "#111827", marginTop: 6 },
  timeBoxPlaceholder: { color: "#D1D5DB", fontSize: 18, fontWeight: "700" },
  timeBoxDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#22C55E", marginTop: 6 },

  arrowWrap: { alignItems: "center", paddingHorizontal: 8 },
  arrowText: { fontSize: 18, color: "#9CA3AF", fontWeight: "700" },
  durBadge: {
    marginTop: 4, fontSize: 9, fontWeight: "800", color: "#FFFFFF",
    backgroundColor: "#0A0F1E", paddingHorizontal: 6, paddingVertical: 2,
    borderRadius: 999, textAlign: "center",
  },

  selectionPreview: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    backgroundColor: "#F0FDF4", borderRadius: 12, padding: 10, marginTop: 12,
    borderWidth: 1, borderColor: "#BBF7D0",
  },
  selectionPreviewLabel: { fontSize: 12, color: "#166534", fontWeight: "600" },
  selectionPreviewValue: { fontSize: 16, color: "#15803D", fontWeight: "900" },

  chipPanel: {
    marginTop: 12, backgroundColor: "#FAFAFA",
    borderRadius: 18, padding: 14, borderWidth: 1, borderColor: "#EEF0F4",
  },
  chipPanelTitle: { fontSize: 13, fontWeight: "800", color: "#111827", marginBottom: 12 },
  chipRow: { paddingBottom: 4, gap: 8 },

  chip: {
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 14,
    borderWidth: 1.5, alignItems: "center", minWidth: 72,
  },
  chipTimeText: { fontSize: 13, fontWeight: "800" },
  chipStatusText: { fontSize: 9, fontWeight: "700", marginTop: 3 },

  legendRow: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 10 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  legendDot: { width: 10, height: 10, borderRadius: 3 },
  legendText: { fontSize: 10, color: "#6B7280", fontWeight: "600" },

  flexNote: { marginTop: 10, fontSize: 10, color: "#9CA3AF", fontWeight: "600", textAlign: "right" },
  noSlotsText: { fontSize: 13, color: "#9CA3AF", fontWeight: "600", paddingVertical: 12, textAlign: "center" },

  validationBox: { marginTop: 10, backgroundColor: "#FEF2F2", borderRadius: 12, padding: 10 },
  validationText: { color: "#DC2626", fontSize: 12, fontWeight: "600" },

  blockedRow: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: "#F9FAFB", borderRadius: 16, marginBottom: 10,
    padding: 14, borderWidth: 1, borderColor: "#F3F4F6", overflow: "hidden",
  },
  blockedBar: { width: 4, position: "absolute", left: 0, top: 0, bottom: 0, borderRadius: 2 },
  blockedTime: { color: "#111827", fontSize: 14, fontWeight: "800" },
  blockedType: { color: "#6B7280", fontSize: 12, fontWeight: "600", marginTop: 3 },
  freeBtn: { backgroundColor: "#FEE2E2", paddingHorizontal: 14, paddingVertical: 8, borderRadius: 12 },
  freeBtnText: { color: "#DC2626", fontSize: 12, fontWeight: "800" },

bottomBar: {
  position: "absolute",
  bottom: 0,  // ✅ Fills to very bottom
  left: 0,
  right: 0,
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",  // ✅ Space between content & button
  backgroundColor: "#FFFFFF",
  paddingHorizontal: 20,
  paddingTop: 16,
  paddingBottom: Platform.OS === "android" ? 50 : 24,  // ✅ Account for home indicator
  borderTopWidth: 1,
  borderTopColor: "#E5E7EB",
  shadowColor: "#000",
  shadowOffset: { width: 0, height: -4 },
  shadowOpacity: 0.08,
  shadowRadius: 12,
  elevation: 12,
},
  bottomLabel: { color: "#9CA3AF", fontSize: 10, fontWeight: "800", textTransform: "uppercase" },
  bottomTime: { color: "#111827", fontSize: 17, fontWeight: "900", marginTop: 2 },
  bottomDur: { color: "#6B7280", fontSize: 11, fontWeight: "600", marginTop: 2 },
  chooseActionBtn: {
    backgroundColor: "#0A0F1E", paddingHorizontal: 20, paddingVertical: 14,
    borderRadius: 16, alignItems: "center",
  },
  chooseActionBtnText: { color: "#FFFFFF", fontWeight: "800", fontSize: 14 },

  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet: { backgroundColor: "#FFFFFF", borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 20, paddingBottom: 34 },
  sheetHandle: { width: 44, height: 4, borderRadius: 2, backgroundColor: "#E5E7EB", alignSelf: "center", marginBottom: 20 },
  sheetTitle: { fontSize: 20, fontWeight: "900", color: "#111827" },
  sheetSub: { fontSize: 13, color: "#6B7280", fontWeight: "600", marginTop: 4, marginBottom: 20 },

  actionRow: {
    flexDirection: "row", alignItems: "center", gap: 14,
    backgroundColor: "#F9FAFB", borderRadius: 18, padding: 16,
    marginBottom: 10, borderWidth: 1, borderColor: "#F3F4F6",
  },
  actionIcon: { width: 48, height: 48, borderRadius: 14, justifyContent: "center", alignItems: "center" },
  actionTitle: { fontSize: 16, fontWeight: "800", color: "#111827" },
  actionSub: { fontSize: 12, color: "#6B7280", marginTop: 2 },
  cancelRow: { backgroundColor: "#F3F4F6", borderRadius: 16, padding: 16, alignItems: "center", marginTop: 6 , marginBottom:12 },
  cancelRowText: { color: "#374151", fontWeight: "700", fontSize: 15 },

  slotBox: { backgroundColor: "#F9FAFB", borderRadius: 16, padding: 14, borderWidth: 1, borderColor: "#E5E7EB", marginBottom: 16 },
  slotBoxLabel: { color: "#9CA3AF", fontSize: 11, fontWeight: "700", textTransform: "uppercase" },
  slotBoxValue: { color: "#111827", fontSize: 17, fontWeight: "900", marginTop: 4 },
  slotBoxSub: { color: "#6B7280", fontSize: 12, marginTop: 4 },

  inputLabel: { color: "#374151", fontSize: 13, fontWeight: "700", marginBottom: 6, marginTop: 12 },
  input: {
    backgroundColor: "#F9FAFB", borderWidth: 1, borderColor: "#E5E7EB",
    borderRadius: 14, paddingHorizontal: 14, paddingVertical: 13, fontSize: 15, color: "#111827",
  },
  textArea: { minHeight: 90 },
  primaryBtn: { backgroundColor: "#0A0F1E", paddingVertical: 15, borderRadius: 16, alignItems: "center", marginTop: 20 },
  primaryBtnText: { color: "#FFFFFF", fontWeight: "800", fontSize: 15 },
  secondaryBtn: { backgroundColor: "#F3F4F6", paddingVertical: 15, borderRadius: 16, alignItems: "center", marginTop: 10, marginBottom:25, },
  secondaryBtnText: { color: "#374151", fontWeight: "700", fontSize: 15 },
});
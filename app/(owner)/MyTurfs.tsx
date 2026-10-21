// app/(owner)/MyTurfs.tsx  —  v4 (single file)
// Everything for the owner's turfs lives in this one file:
//   List  →  Turf hub  →  Pricing · Hours · Booking style · VCoin · Status · Operators
// Screens switch inside this file (no extra routes). Android back and the
// header back arrow step back one screen; unsaved edits ask before leaving.
// Every Save opens a "Confirm changes" sheet listing old → new first.
// Offers still opens the existing /(owner)/offer screen.

import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, RefreshControl, Alert, Switch, TextInput,
  Modal, ActivityIndicator, StatusBar, Platform, BackHandler, Linking,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { useFocusEffect, useNavigation, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { collection, doc, getDocs, query, updateDoc, where } from "firebase/firestore";
import { getIdToken } from "firebase/auth";
import { auth, db } from "../../firebaseConfig";

const SERVER_URL = "https://bookora-backend-95u4.onrender.com";

// ═════════════════════════════════════════════════════════════════════════════
// PALETTE · TYPES · HELPERS
// ═════════════════════════════════════════════════════════════════════════════
const C = {
  BRAND: "#15803D", PAGE: "#F1F4F7", CARD: "#FFFFFF", SOFT: "#F5F7FA", LINE: "#E8ECF1",
  INK: "#0F172A", SLATE: "#475569", MUTE: "#64748B", FAINT: "#94A3B8",
  GREEN: "#22C55E", GREEN_D: "#15803D", GREEN_L: "#F0FDF4", GREEN_M: "#DCFCE7", ON_BRAND: "#DCFCE7",
  PURPLE: "#6D28D9", PURPLE_D: "#4C1D95", PURPLE_L: "#F5F3FF", PURPLE_M: "#EDE9FE",
  AMBER: "#B45309", AMBER_D: "#92400E", AMBER_L: "#FFFBEB", AMBER_M: "#FEF3C7",
  RED: "#DC2626", RED_D: "#991B1B", RED_L: "#FEF2F2", BLUE: "#0369A1", BLUE_M: "#E0F2FE",
};

type PriceSlab = { start: number; end: number; rate: number };
type DayType = "weekday" | "weekend";
type Operator = {
  id: string; name?: string; email?: string; phone?: string; status?: string;
  turfIds?: string[]; turfId?: string; ownerId?: string;
};
type Turf = {
  id: string; name?: string; location?: string; ownerId?: string;
  operatorIds?: string[]; operatorId?: string; operatorName?: string; operatorEmail?: string;
  openingTime?: number; closingTime?: number; slotDuration?: number;
  dayPrice?: number; nightPrice?: number; bookingPrice?: number;
  sport?: string | string[]; active?: boolean;
  status?: string | null; statusNote?: string | null; statusUpdatedAt?: string | null;
  vcoinEnabled?: boolean; vcoinRatePerHour?: number;
  advancePricingEnabled?: boolean; priceSlabs?: { weekday?: PriceSlab[]; weekend?: PriceSlab[] };
  flexibleSlotsEnabled?: boolean;   // missing = ON
  quickSlotsEnabled?: boolean;      // missing = ON
  lateCutoffHours?: number;         // late-night booking closes N hrs before midnight
};

type Screen = "hub" | "pricing" | "hours" | "style" | "vcoin" | "status" | "operators";
type ViewEntry = { screen: Screen; turfId: string };

const STATUS_DEFS = [
  { key: "ready", label: "Field ready", hint: "Open and playable", dot: "#16A34A", blocks: false },
  { key: "wet", label: "Wet / rain", hint: "Soft, still bookable", dot: "#2563EB", blocks: false },
  { key: "partial", label: "Partial", hint: "Only half the pitch", dot: "#EA580C", blocks: false },
  { key: "league", label: "League day", hint: "Reserved fixtures", dot: "#7C3AED", blocks: false },
  { key: "maintenance", label: "Maintenance", hint: "Closed for work · no bookings", dot: "#D97706", blocks: true },
  { key: "closed", label: "Closed", hint: "No bookings today", dot: "#DC2626", blocks: true },
];
const statusDef = (key?: string | null) => STATUS_DEFS.find(d => d.key === key);
const isBlocking = (key?: string | null) => !!statusDef(key)?.blocks;

const initials = (n?: string) =>
  (n || "?").split(" ").filter(Boolean).map(w => w[0]).join("").toUpperCase().slice(0, 2) || "?";
const money = (n: number) => "₹" + Number(n || 0).toLocaleString("en-IN");
const numOnly = (v: string) => Number(String(v).replace(/[^0-9]/g, "")) || 0;
const toDate = (v: any): Date | null => (v?.toDate ? v.toDate() : v ? new Date(v) : null);
const todayIsWeekend = () => [0, 6].includes(new Date().getDay());
const MAX_CLOSE = 28;                     // latest close = 4 AM next day
const NIGHT_FROM = 18, DAY_FROM = 6;      // base rate switch-over
const clock = (h: number) => {           // 18 → "6 PM", 28 → "4 AM"
  const x = ((h % 24) + 24) % 24;
  return x === 0 ? "12 AM" : x === 12 ? "12 PM" : x < 12 ? `${x} AM` : `${x - 12} PM`;
};
const clockMin = (h: number) => {        // 17.5 → "5:30 PM"
  const whole = Math.floor(h), mins = Math.round((h - whole) * 60);
  return clock(whole).replace(" ", `:${String(mins).padStart(2, "0")} `);
};
const shortClock = (h: number) => {
  const x = ((h % 24) + 24) % 24;
  return x === 0 ? "12A" : x === 12 ? "12P" : x < 12 ? `${x}A` : `${x - 12}P`;
};
const sportsText = (t: Turf) => (Array.isArray(t.sport) ? t.sport.join(", ") : t.sport || "");
const hrsLabel = (n: number) => `${n} hr${n === 1 ? "" : "s"}`;
const durationLabel = (min: number) => (min < 60 ? `${min} min` : `${min / 60} hr`);

function getTurfOperatorIds(t: Turf): string[] {
  if (Array.isArray(t.operatorIds) && t.operatorIds.length) return t.operatorIds;
  if (t.operatorId) return [t.operatorId];
  return [];
}
function getOperatorTurfIds(o: Operator): string[] {
  if (Array.isArray(o.turfIds) && o.turfIds.length) return o.turfIds;
  if (o.turfId) return [o.turfId];
  return [];
}
/** Price at hour h (h may run past 24 for late-night turfs). */
function hourRate(
  t: Pick<Turf, "advancePricingEnabled" | "priceSlabs" | "dayPrice" | "nightPrice">, h: number, weekend: boolean,
): number {
  const hh = h % 24;
  if (t.advancePricingEnabled) {
    const list = (weekend ? t.priceSlabs?.weekend : t.priceSlabs?.weekday) || [];
    const hit = list.find(s => hh >= s.start && hh < s.end);
    if (hit) return hit.rate;
  }
  return hh >= NIGHT_FROM || hh < DAY_FROM ? Number(t.nightPrice) || 0 : Number(t.dayPrice) || 0;
}
function rateRange(t: Turf): string {
  const open = t.openingTime ?? 6, close = t.closingTime ?? 23;
  const vals: number[] = [];
  for (const wk of [false, true]) for (let h = open; h < close; h++) { const r = hourRate(t, h, wk); if (r > 0) vals.push(r); }
  if (!vals.length) return "—";
  const lo = Math.min(...vals), hi = Math.max(...vals);
  return lo === hi ? money(lo) : `${money(lo)}–${hi.toLocaleString("en-IN")}`;
}
const minRate = (t: Turf) => {
  const v = [t.dayPrice, t.nightPrice].map(Number).filter(n => n > 0);
  return v.length ? Math.min(...v) : 0;
};
function slabName(s: PriceSlab) {
  if (s.start < 12) return "Morning";
  if (s.start < 17) return "Afternoon";
  if (s.start < 21) return "Evening";
  return "Night";
}
function validateSlabs(slabs: PriceSlab[], label: string): string | null {
  if (slabs.length === 0) return `${label}: add at least one time slot, or turn peak-hour pricing off.`;
  for (const s of slabs) {
    if (s.end <= s.start) return `${label}: end time must be after start time.`;
    if (s.rate < 0) return `${label}: rate can't be negative.`;
  }
  const sorted = [...slabs].sort((a, b) => a.start - b.start);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].start < sorted[i - 1].end)
      return `${label}: ${clock(sorted[i - 1].start)}–${clock(sorted[i - 1].end)} overlaps ${clock(sorted[i].start)}–${clock(sorted[i].end)}.`;
  }
  return null;
}

// ── Change list for the confirm sheet ────────────────────────────────────────
type Change = { label: string; sub?: string; from?: string; to: string; tone?: "new" | "removed" | "down" };
function pushChange(list: Change[], label: string, from: any, to: any, fmt: (v: any) => string = String, sub?: string) {
  if (from === to) return;
  list.push({ label, sub, from: fmt(from), to: fmt(to) });
}

// ── Shared props every settings screen gets ──────────────────────────────────
type EditorProps = {
  turf: Turf;
  save: (patch: Partial<Turf>) => Promise<void>;
  onClose: () => void;
  registerBack: (fn: (() => void) | null) => void;
};

/** Back handling inside a settings screen: asks before dropping unsaved edits. */
function useLocalGuard(dirty: boolean, onClose: () => void, registerBack: EditorProps["registerBack"]) {
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const back = useCallback(() => {
    if (!dirtyRef.current) return onClose();
    Alert.alert("Discard changes?", "You have changes that are not saved yet.", [
      { text: "Keep editing", style: "cancel" },
      { text: "Discard", style: "destructive", onPress: onClose },
    ]);
  }, [onClose]);
  useEffect(() => { registerBack(back); return () => registerBack(null); }, [back, registerBack]);
  return { back, leave: onClose };
}

/** Validate → build change list → confirm sheet → commit. */
function useSaveFlow(opts: {
  buildChanges: () => Change[];
  validate?: () => string | null;
  commit: () => Promise<void>;
  onSaved: () => void;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [changes, setChanges] = useState<Change[]>([]);
  const requestSave = () => {
    const err = opts.validate?.();
    if (err) return Alert.alert("Check this first", err);
    const list = opts.buildChanges();
    if (!list.length) return Alert.alert("Nothing changed", "Make a change before saving.");
    setChanges(list);
    setConfirmOpen(true);
  };
  const confirm = async () => {
    setSaving(true);
    try {
      await opts.commit();
      setConfirmOpen(false);
      opts.onSaved();
    } catch (e: any) {
      Alert.alert("Could not save", e?.message || "Please try again.");
    } finally {
      setSaving(false);
    }
  };
  return { confirmOpen, setConfirmOpen, saving, changes, requestSave, confirm };
}

// ═════════════════════════════════════════════════════════════════════════════
// MAIN — data + screen switching
// ═════════════════════════════════════════════════════════════════════════════
export default function MyTurfs() {
  const router = useRouter();
  const navigation = useNavigation();

  const [turfs, setTurfs] = useState<Turf[]>([]);
  const [operators, setOperators] = useState<Operator[]>([]);
  const [liveOffers, setLiveOffers] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Screen stack inside this file. Empty = the turf list.
  const [stack, setStack] = useState<ViewEntry[]>([]);
  const current = stack[stack.length - 1] || null;
  const backRef = useRef<(() => void) | null>(null);

  const open = useCallback((screen: Screen, turfId: string) => setStack(s => [...s, { screen, turfId }]), []);
  const pop = useCallback(() => setStack(s => s.slice(0, -1)), []);
  const registerBack = useCallback((fn: (() => void) | null) => { backRef.current = fn; }, []);
  const goBack = useCallback(() => (backRef.current ? backRef.current() : pop()), [pop]);

  // Android back steps back one screen inside this file
  useEffect(() => {
    if (!current) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => { goBack(); return true; });
    return () => sub.remove();
  }, [current, goBack]);

  // iOS swipe-back would leave the whole route — only allow it on the list
  useEffect(() => { (navigation as any).setOptions?.({ gestureEnabled: !current }); }, [navigation, current]);

  const fetchAll = useCallback(async (isRefresh = false) => {
    const uid = auth.currentUser?.uid;
    if (!uid) { setLoading(false); return; }
    if (isRefresh) setRefreshing(true);
    try {
      const [turfSnap, opSnap, offerSnap] = await Promise.all([
        getDocs(query(collection(db, "turfs"), where("ownerId", "==", uid))),
        getDocs(query(collection(db, "users"), where("role", "==", "turf-operator"), where("ownerId", "==", uid))),
        // Offers only power the nudges — never let them break the screen
        getDocs(query(collection(db, "offers"), where("ownerId", "==", uid))).catch(() => null),
      ]);
      setTurfs(turfSnap.docs.map(d => ({ id: d.id, ...d.data() } as Turf)));
      setOperators(opSnap.docs.map(d => ({ id: d.id, ...d.data() } as Operator)));
      const counts: Record<string, number> = {};
      const now = new Date();
      offerSnap?.docs.forEach(d => {
        const o: any = d.data();
        const end = toDate(o.validTo);
        if (o.active && o.status === "approved" && (!end || end >= now) && o.turfId) counts[o.turfId] = (counts[o.turfId] || 0) + 1;
      });
      setLiveOffers(counts);
    } catch {
      Alert.alert("Error", "Unable to load turfs.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Reload whenever this route regains focus (e.g. back from Offers)
  useFocusEffect(useCallback(() => { fetchAll(); }, [fetchAll]));

  const saveTurf = useCallback(async (turfId: string, patch: Partial<Turf>) => {
    await updateDoc(doc(db, "turfs", turfId), patch as any);
    setTurfs(prev => prev.map(t => (t.id === turfId ? { ...t, ...patch } : t)));
  }, []);

  const openOffers = (t: Turf) =>
    router.push({ pathname: "/(owner)/offer", params: { turfId: t.id, turfName: t.name || "Turf" } } as any);

  const toggleOperatorStatus = (op: Operator) => {
    const next = op.status === "inactive" ? "active" : "inactive";
    const run = async () => {
      try {
        await updateDoc(doc(db, "users", op.id), { status: next });
        setOperators(prev => prev.map(o => (o.id === op.id ? { ...o, status: next } : o)));
      } catch { Alert.alert("Error", "Could not update status."); }
    };
    if (next === "inactive")
      Alert.alert(`Pause ${op.name || "operator"}?`, "They won't be able to log in or manage bookings on any of your turfs until you turn them back on.", [
        { text: "Cancel", style: "cancel" }, { text: "Pause", style: "destructive", onPress: run },
      ]);
    else run();
  };

  const deleteOperator = (op: Operator) => {
    Alert.alert("Remove operator", `Remove ${op.name || "this operator"}? Their login account will also be deleted.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove", style: "destructive",
        onPress: async () => {
          try {
            const token = await getIdToken(auth.currentUser!);
            const res = await fetch(`${SERVER_URL}/delete-owner/${op.id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Failed");
            const assigned = turfs.filter(t => getTurfOperatorIds(t).includes(op.id));
            await Promise.all(assigned.map(async t => {
              const newIds = getTurfOperatorIds(t).filter(id => id !== op.id);
              const nextOp = operators.find(o => newIds[0] === o.id);
              await updateDoc(doc(db, "turfs", t.id), {
                operatorIds: newIds, operatorId: newIds[0] || "", operatorName: nextOp?.name || "", operatorEmail: nextOp?.email || "",
              });
            }));
            await fetchAll(true);
          } catch (e: any) { Alert.alert("Error", e.message); }
        },
      },
    ]);
  };

  if (loading) return <Loading text="Loading your turfs..." />;

  // ── Screen switch ─────────────────────────────────────────────────────────
  if (current) {
    const turf = turfs.find(t => t.id === current.turfId);
    if (!turf) return <ErrorState message="This turf is no longer available." onBack={pop} />;
    const props: EditorProps = { turf, save: p => saveTurf(turf.id, p), onClose: pop, registerBack };
    // key = turf + screen so each screen starts fresh from saved values
    const key = `${current.screen}-${turf.id}-${stack.length}`;
    switch (current.screen) {
      case "hub":
        return <HubView key={key} turf={turf} operators={operators} offerCount={liveOffers[turf.id] || 0}
          onBack={pop} onOpen={s => open(s, turf.id)} onOffers={() => openOffers(turf)}
          refreshing={refreshing} onRefresh={() => fetchAll(true)} />;
      case "pricing": return <PricingEditor key={key} {...props} />;
      case "hours": return <HoursEditor key={key} {...props} />;
      case "style": return <StyleEditor key={key} {...props} />;
      case "vcoin": return <VCoinEditor key={key} {...props} />;
      case "status": return <StatusEditor key={key} {...props} />;
      case "operators":
        return <OperatorsEditor key={key} {...props} team={operators} allTurfs={turfs}
          onTeamChanged={() => fetchAll(true)} onToggleActive={toggleOperatorStatus} />;
    }
  }

  return (
    <ListView turfs={turfs} operators={operators} liveOffers={liveOffers} refreshing={refreshing}
      onRefresh={() => fetchAll(true)} onBack={() => router.back()} onOpen={open} onOffers={openOffers}
      onToggleOperator={toggleOperatorStatus} onDeleteOperator={deleteOperator} />
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// SHARED UI
// ═════════════════════════════════════════════════════════════════════════════
function ScreenHeader({ kicker, title, sub, onBack }: { kicker?: string; title: string; sub?: string; onBack: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[k.header, { paddingTop: insets.top + 12 }]}>
      <StatusBar barStyle="light-content" backgroundColor={C.BRAND} />
      <TouchableOpacity style={k.backBtn} onPress={onBack} accessibilityLabel="Back">
        <Ionicons name="arrow-back" size={20} color="#fff" />
      </TouchableOpacity>
      <View style={{ flex: 1, minWidth: 0 }}>
        {!!kicker && <Text style={k.kicker} numberOfLines={1}>{kicker.toUpperCase()}</Text>}
        <Text style={k.title} numberOfLines={1}>{title}</Text>
        {!!sub && <Text style={k.sub} numberOfLines={1}>{sub}</Text>}
      </View>
    </View>
  );
}

function Loading({ text = "Loading..." }: { text?: string }) {
  return (
    <View style={k.center}>
      <StatusBar barStyle="light-content" backgroundColor={C.BRAND} />
      <ActivityIndicator size="large" color={C.GREEN_D} />
      <Text style={k.loadText}>{text}</Text>
    </View>
  );
}

function ErrorState({ message, onBack }: { message: string; onBack: () => void }) {
  return (
    <View style={k.center}>
      <Ionicons name="alert-circle-outline" size={40} color={C.FAINT} />
      <Text style={[k.loadText, { textAlign: "center", paddingHorizontal: 30 }]}>{message}</Text>
      <TouchableOpacity onPress={onBack} style={[k.ghostBtn, { marginTop: 16 }]}><Text style={k.ghostText}>Go back</Text></TouchableOpacity>
    </View>
  );
}

function Card({ children, style }: { children: ReactNode; style?: any }) {
  return <View style={[k.card, style]}>{children}</View>;
}

function CardHead({ icon, iconBg, iconColor, title, sub, right }: {
  icon?: any; iconBg?: string; iconColor?: string; title: string; sub?: string; right?: ReactNode;
}) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
      {icon && (
        <View style={[k.iconBox, { backgroundColor: iconBg || C.GREEN_M }]}>
          <Ionicons name={icon} size={18} color={iconColor || C.GREEN_D} />
        </View>
      )}
      <View style={{ flex: 1 }}>
        <Text style={k.cardTitle}>{title}</Text>
        {!!sub && <Text style={k.cardSub}>{sub}</Text>}
      </View>
      {right}
    </View>
  );
}

function Label({ children, color }: { children: string; color?: string }) {
  return <Text style={[k.tinyLabel, color ? { color } : null]}>{children.toUpperCase()}</Text>;
}

function Choice({ label, on, onPress, style }: { label: string; on: boolean; onPress: () => void; style?: any }) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.8} style={[k.choice, on ? k.choiceOn : null, style]} accessibilityState={{ selected: on }}>
      <Text style={[k.choiceText, { color: on ? C.GREEN_D : C.SLATE }]}>{label}</Text>
    </TouchableOpacity>
  );
}

function Note({ text, tone = "grey" }: { text: string; tone?: "grey" | "green" | "amber" | "purple" | "red" }) {
  const map = {
    grey: { bg: C.SOFT, fg: "#334155", ic: C.SLATE },
    green: { bg: C.GREEN_L, fg: "#14532D", ic: C.GREEN_D },
    amber: { bg: C.AMBER_L, fg: C.AMBER_D, ic: C.AMBER },
    purple: { bg: C.PURPLE_L, fg: C.PURPLE_D, ic: C.PURPLE },
    red: { bg: C.RED_L, fg: C.RED_D, ic: C.RED },
  }[tone];
  return (
    <View style={[k.note, { backgroundColor: map.bg }]}>
      <Ionicons name="information-circle-outline" size={17} color={map.ic} />
      <Text style={[k.noteText, { color: map.fg }]}>{text}</Text>
    </View>
  );
}

function SaveBar({ dirty, summary, onDiscard, onSave, saving }: {
  dirty: boolean; summary: string; onDiscard: () => void; onSave: () => void; saving?: boolean;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[k.saveBar, { paddingBottom: insets.bottom + 14 }]}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[k.saveState, { color: dirty ? C.AMBER : C.MUTE }]}>{dirty ? "Unsaved changes" : "All changes saved"}</Text>
        <Text style={k.saveSummary} numberOfLines={1}>{summary}</Text>
      </View>
      <TouchableOpacity style={[k.ghostBtn, !dirty && { opacity: 0.5 }]} onPress={onDiscard} disabled={!dirty || saving}>
        <Text style={k.ghostText}>Discard</Text>
      </TouchableOpacity>
      <TouchableOpacity style={[k.saveBtn, (!dirty || saving) && { opacity: 0.5 }]} onPress={onSave} disabled={!dirty || saving}>
        {saving ? <ActivityIndicator color="#fff" /> : <Text style={k.saveText}>Save</Text>}
      </TouchableOpacity>
    </View>
  );
}

function ConfirmSheet({ visible, icon, iconBg, iconColor, subtitle, changes, note, saving, onCancel, onConfirm }: {
  visible: boolean; icon: any; iconBg?: string; iconColor?: string; subtitle: string; changes: Change[];
  note?: string; saving?: boolean; onCancel: () => void; onConfirm: () => void;
}) {
  const insets = useSafeAreaInsets();
  const n = changes.length;
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <View style={k.backdrop}>
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={saving ? undefined : onCancel} />
        <View style={[k.sheet, { paddingBottom: insets.bottom + (Platform.OS === "ios" ? 10 : 18) }]}>
          <View style={k.grabber} />
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <View style={[k.iconBox, { width: 44, height: 44, borderRadius: 14, backgroundColor: iconBg || C.GREEN_M }]}>
              <Ionicons name={icon} size={20} color={iconColor || C.GREEN_D} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={k.sheetTitle}>Confirm {n} change{n === 1 ? "" : "s"}</Text>
              <Text style={k.cardSub}>{subtitle}</Text>
            </View>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" automaticallyAdjustKeyboardInsets style={{ maxHeight: 320 }} contentContainerStyle={k.changeList} showsVerticalScrollIndicator={false}>
            {changes.map((c, i) => (
              <View key={i} style={[k.changeRow, i < n - 1 && k.changeRowLine]}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={k.changeLabel}>{c.label}</Text>
                  {!!c.sub && <Text style={k.changeSub}>{c.sub}</Text>}
                </View>
                {c.tone === "new" && <Text style={k.newTag}>NEW</Text>}
                {c.tone === "removed" && <Text style={k.removedTag}>REMOVED</Text>}
                {c.from !== undefined && c.tone !== "removed" && (
                  <>
                    <Text style={k.fromText} numberOfLines={1}>{c.from}</Text>
                    <Ionicons name="arrow-forward" size={14} color={C.MUTE} />
                  </>
                )}
                <Text style={[k.toText, c.tone === "removed" && { color: C.MUTE, textDecorationLine: "line-through" }, c.tone === "down" && { color: C.AMBER }]}
                  numberOfLines={2}>{c.to}</Text>
              </View>
            ))}
          </ScrollView>
          {!!note && <Note text={note} tone="amber" />}
          <View style={{ flexDirection: "row", gap: 10 }}>
            <TouchableOpacity style={[k.ghostBtn, { flex: 1, height: 50 }]} onPress={onCancel} disabled={saving}>
              <Text style={k.ghostText}>Edit again</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[k.saveBtn, { flex: 1.4, height: 50, flexDirection: "row", gap: 8 }]} onPress={onConfirm} disabled={saving}>
              {saving ? <ActivityIndicator color="#fff" /> : (<><Ionicons name="checkmark" size={18} color="#fff" /><Text style={k.saveText}>Confirm & save</Text></>)}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// 1 · LIST
// ═════════════════════════════════════════════════════════════════════════════
function ListView({ turfs, operators, liveOffers, refreshing, onRefresh, onBack, onOpen, onOffers, onToggleOperator, onDeleteOperator }: {
  turfs: Turf[]; operators: Operator[]; liveOffers: Record<string, number>; refreshing: boolean;
  onRefresh: () => void; onBack: () => void; onOpen: (s: Screen, id: string) => void; onOffers: (t: Turf) => void;
  onToggleOperator: (o: Operator) => void; onDeleteOperator: (o: Operator) => void;
}) {
  const insets = useSafeAreaInsets();

  type Nudge = { tone: "warn" | "tip"; text: string; cta: string; onPress: () => void };
  const nudgeFor = (t: Turf): Nudge | null => {
    if (getTurfOperatorIds(t).length === 0)
      return { tone: "warn", text: "No operator assigned — nobody can manage bookings on site.", cta: "Assign", onPress: () => onOpen("operators", t.id) };
    if (isBlocking(t.status))
      return { tone: "warn", text: `Marked "${statusDef(t.status)?.label}" — players can't book right now.`, cta: "Change", onPress: () => onOpen("status", t.id) };
    if (!liveOffers[t.id])
      return {
        tone: "tip", cta: "Add", onPress: () => onOffers(t),
        text: (t.closingTime ?? 23) > 24 ? "No offer running — late-night slots fill faster with one." : "No offer running — an offer helps fill quiet hours.",
      };
    return null;
  };

  const liveCount = turfs.filter(t => !isBlocking(t.status)).length;
  const activeOps = operators.filter(o => o.status !== "inactive").length;
  const alerts = turfs.filter(t => nudgeFor(t)?.tone === "warn").length;
  const turfsFor = (o: Operator) => turfs.filter(t => getTurfOperatorIds(t).includes(o.id));

  return (
    <View style={k.screen}>
      <StatusBar barStyle="light-content" backgroundColor={C.BRAND} />
      <View style={[ls.header, { paddingTop: insets.top + 10 }]}>
        <View style={ls.headerRow}>
          <TouchableOpacity style={k.backBtn} onPress={onBack} accessibilityLabel="Back">
            <Ionicons name="arrow-back" size={20} color="#fff" />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={ls.kicker}>OWNER</Text>
            <Text style={ls.title}>My Turfs</Text>
          </View>
          <TouchableOpacity style={[k.backBtn, { backgroundColor: "transparent" }]} onPress={onRefresh} accessibilityLabel="Refresh">
            <Ionicons name="refresh-outline" size={20} color={C.ON_BRAND} />
          </TouchableOpacity>
        </View>
        <View style={ls.chipRow}>
          <StatChip value={liveCount} label="live" />
          <StatChip value={activeOps} label={activeOps === 1 ? "operator" : "operators"} />
          <StatChip value={alerts} label={alerts === 1 ? "alert" : "alerts"} color={alerts ? "#FCA5A5" : "#4ADE80"} />
        </View>
      </View>

      <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" automaticallyAdjustKeyboardInsets showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.GREEN_D} />}>
        <View style={ls.sectionRow}>
          <Text style={k.sectionTitle}>YOUR TURFS</Text>
          {turfs.length > 0 && <Text style={ls.hint}>Tap a card to open</Text>}
        </View>

        {turfs.length === 0 ? (
          <View style={ls.empty}>
            <Ionicons name="football-outline" size={40} color="#D1D5DB" />
            <Text style={ls.emptyTitle}>No turfs yet</Text>
            <Text style={ls.emptySub}>Your turfs will appear here once added by admin.</Text>
          </View>
        ) : turfs.map(turf => {
          const st = statusDef(turf.status);
          const late = (turf.closingTime ?? 23) > 24;
          const sports = sportsText(turf);
          const nudge = nudgeFor(turf);
          return (
            <View key={turf.id} style={ls.card}>
              <TouchableOpacity style={ls.cardTop} onPress={() => onOpen("hub", turf.id)} activeOpacity={0.75}>
                <View style={ls.avatar}><Text style={ls.avatarText}>{initials(turf.name)}</Text></View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={ls.nameRow}>
                    <Text style={ls.name} numberOfLines={1}>{turf.name || "Unnamed Turf"}</Text>
                    <View style={[ls.pill, { backgroundColor: st ? C.GREEN_L : "#F1F5F9" }]}>
                      <View style={[ls.dot, { backgroundColor: st?.dot || C.FAINT }]} />
                      <Text style={[ls.pillText, { color: st ? C.GREEN_D : C.MUTE }]} numberOfLines={1}>{st?.label || "No status"}</Text>
                    </View>
                  </View>
                  <Text style={ls.meta} numberOfLines={1}>{turf.location || "No location"}{sports ? ` · ${sports}` : ""}</Text>
                </View>
              </TouchableOpacity>

              <View style={ls.factRow}>
                <Fact label={late ? "HOURS · LATE" : "HOURS"} late={late} value={`${shortClock(turf.openingTime ?? 6)} – ${shortClock(turf.closingTime ?? 23)}`} />
                <Fact label="RATE / HR" value={rateRange(turf)} />
                <Fact label="VCOIN" value={turf.vcoinEnabled ? `${turf.vcoinRatePerHour || 0} / hr` : "Off"} />
              </View>

              {nudge && (
                <TouchableOpacity onPress={nudge.onPress} activeOpacity={0.8} style={[ls.nudge, nudge.tone === "warn" ? ls.nudgeWarn : ls.nudgeTip]}>
                  <Ionicons name={nudge.tone === "warn" ? "alert-circle-outline" : "flash-outline"} size={16} color={nudge.tone === "warn" ? C.RED : C.AMBER} />
                  <Text style={[ls.nudgeText, { color: nudge.tone === "warn" ? C.RED_D : C.AMBER_D }]}>{nudge.text}</Text>
                  <Text style={[ls.nudgeCta, { color: nudge.tone === "warn" ? C.RED_D : C.AMBER_D }]}>{nudge.cta}</Text>
                </TouchableOpacity>
              )}

              <View style={ls.actionBar}>
                <ActionBtn first icon="pricetag-outline" label="Pricing" color={C.GREEN_D} onPress={() => onOpen("pricing", turf.id)} />
                <ActionBtn icon="time-outline" label="Hours" onPress={() => onOpen("hours", turf.id)} />
                <ActionBtn icon="pulse-outline" label="Status" onPress={() => onOpen("status", turf.id)} />
                <ActionBtn icon="options-outline" label="Manage" color={C.INK} onPress={() => onOpen("hub", turf.id)} />
                <ActionBtn icon="gift-outline" label="Offers" color={C.AMBER} onPress={() => onOffers(turf)} />
              </View>
            </View>
          );
        })}

        <View style={[ls.sectionRow, { marginTop: 10 }]}>
          <Text style={k.sectionTitle}>YOUR TEAM</Text>
          <Text style={ls.hint}>{operators.length} operator{operators.length === 1 ? "" : "s"}</Text>
        </View>
        {operators.length === 0 ? (
          <View style={ls.empty}>
            <Ionicons name="people-outline" size={40} color="#D1D5DB" />
            <Text style={ls.emptyTitle}>No operators yet</Text>
            <Text style={ls.emptySub}>Open a turf → Operators to assign someone.</Text>
          </View>
        ) : operators.map(op => {
          const runs = turfsFor(op);
          const active = op.status !== "inactive";
          return (
            <View key={op.id} style={ls.teamRow}>
              <View style={[ls.teamAvatar, { backgroundColor: active ? C.GREEN_M : "#EEF1F5" }]}>
                <Text style={[ls.teamAvatarText, { color: active ? C.GREEN_D : C.MUTE }]}>{initials(op.name)}</Text>
              </View>
              <View style={{ flex: 1, minWidth: 0, marginLeft: 12 }}>
                <Text style={ls.teamName}>{op.name || "Unnamed"}</Text>
                <Text style={ls.teamSub} numberOfLines={1}>{runs.length ? `Runs ${runs.map(t => t.name).join(", ")}` : "Not assigned to any turf"}</Text>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={[ls.teamState, { color: active ? C.GREEN_D : C.MUTE }]}>{active ? "Active" : "Paused"}</Text>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                  <Switch value={active} onValueChange={() => onToggleOperator(op)} trackColor={{ false: "#E5E7EB", true: C.GREEN }} thumbColor="#fff"
                    style={{ transform: [{ scaleX: 0.8 }, { scaleY: 0.8 }] }} />
                  <TouchableOpacity onPress={() => onDeleteOperator(op)} style={ls.teamDelete} accessibilityLabel={`Remove ${op.name}`}>
                    <Ionicons name="trash-outline" size={15} color={C.RED} />
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const StatChip = ({ value, label, color = "#fff" }: { value: number; label: string; color?: string }) => (
  <View style={ls.chip}>
    <Text style={[ls.chipNum, { color }]}>{value}</Text>
    <Text style={ls.chipLabel}>{label}</Text>
  </View>
);
const Fact = ({ label, value, late }: { label: string; value: string; late?: boolean }) => (
  <View style={[ls.fact, late && { backgroundColor: C.PURPLE_L }]}>
    <Text style={[ls.factLabel, late && { color: C.PURPLE }]}>{label}</Text>
    <Text style={[ls.factValue, late && { color: C.PURPLE_D }]} numberOfLines={1}>{value}</Text>
  </View>
);
const ActionBtn = ({ icon, label, onPress, color = "#334155", first }: any) => (
  <TouchableOpacity onPress={onPress} activeOpacity={0.6} accessibilityRole="button"
    style={[ls.actionBtn, !first && { borderLeftWidth: 1, borderLeftColor: "#EEF1F5" }]}>
    <Ionicons name={icon} size={19} color={color} />
    <Text style={[ls.actionText, { color }]}>{label}</Text>
  </TouchableOpacity>
);

// ═════════════════════════════════════════════════════════════════════════════
// 2 · TURF HUB
// ═════════════════════════════════════════════════════════════════════════════
function HubView({ turf: t, operators, offerCount, onBack, onOpen, onOffers, refreshing, onRefresh }: {
  turf: Turf; operators: Operator[]; offerCount: number; onBack: () => void; onOpen: (s: Screen) => void;
  onOffers: () => void; refreshing: boolean; onRefresh: () => void;
}) {
  const open = t.openingTime ?? 6, close = t.closingTime ?? 23;
  const late = close > 24;
  const weekend = todayIsWeekend();
  const assigned = operators.filter(o => getTurfOperatorIds(t).includes(o.id));
  const st = statusDef(t.status);
  const flex = t.flexibleSlotsEnabled !== false, quick = t.quickSlotsEnabled !== false;
  const slabCount = (weekend ? t.priceSlabs?.weekend : t.priceSlabs?.weekday)?.length || 0;

  type Seg = { hrs: number; rate: number; late: boolean };
  const segs: Seg[] = [];
  for (let h = open; h < close; h++) {
    const rate = hourRate(t, h, weekend), isLate = h >= 24;
    const last = segs[segs.length - 1];
    if (last && last.rate === rate && last.late === isLate) last.hrs++;
    else segs.push({ hrs: 1, rate, late: isLate });
  }
  const peak = Math.max(1, ...segs.map(x => x.rate));
  const mid = Math.round((open + close) / 2);

  return (
    <View style={k.screen}>
      <ScreenHeader title={t.name || "Turf"} sub={`${t.location || "No location"}${sportsText(t) ? ` · ${sportsText(t)}` : ""}`} onBack={onBack} />
      <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" automaticallyAdjustKeyboardInsets contentContainerStyle={[k.body, { paddingBottom: 40 }]} showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.GREEN_D} />}>

        <TouchableOpacity style={k.card} activeOpacity={0.85} onPress={() => onOpen("pricing")}>
          <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" }}>
            <Text style={k.cardTitle}>Today's prices</Text>
            <Text style={hs.hint}>{new Date().toLocaleDateString("en-IN", { weekday: "short" })} · {weekend ? "weekend" : "weekday"}</Text>
          </View>
          <View style={hs.strip}>
            {segs.map((g, i) => {
              const strength = 0.4 + 0.6 * (g.rate / peak);
              const bg = g.late ? "#7C3AED" : g.rate === 0 ? "#E6EAF0" : `rgba(22,163,74,${strength.toFixed(2)})`;
              const fg = g.late || strength > 0.65 ? "#fff" : "#14532D";
              return (
                <View key={i} style={{ flex: g.hrs, backgroundColor: bg, alignItems: "center", justifyContent: "center" }}>
                  {g.hrs >= 2 && g.rate > 0 && (
                    <Text style={{ fontSize: 10.5, fontWeight: "800", color: fg }} numberOfLines={1}>{g.late && g.hrs < 3 ? "Late" : money(g.rate)}</Text>
                  )}
                </View>
              );
            })}
          </View>
          <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 6 }}>
            {[open, mid, close].map((h, i) => <Text key={i} style={hs.axis}>{shortClock(h)}</Text>)}
          </View>
        </TouchableOpacity>

        <Text style={[k.sectionTitle, { marginTop: 4 }]}>MANAGE THIS TURF</Text>

        <View style={hs.grid}>
          <Tile icon="pricetag-outline" bg={C.GREEN_M} color={C.GREEN_D} title="Pricing" onPress={() => onOpen("pricing")}
            value={`${money(t.dayPrice || 0)} day · ${money(t.nightPrice || 0)} night${t.advancePricingEnabled ? ` · ${slabCount} time slot${slabCount === 1 ? "" : "s"}` : ""}`} />
          <Tile icon="time-outline" bg={C.PURPLE_M} color={C.PURPLE} title="Hours" onPress={() => onOpen("hours")}
            value={`${clock(open)} – ${clock(close)}${late && t.lateCutoffHours ? ` · late booking closes ${clock(24 - t.lateCutoffHours)}` : ""}`} />
          <Tile icon="flash-outline" bg={C.BLUE_M} color={C.BLUE} title="Booking style" onPress={() => onOpen("style")}
            value={`${flex && quick ? "Flexible + Quick slots" : flex ? "Flexible time only" : "Quick slots only"} · ${durationLabel(t.slotDuration ?? 60)}`} />
          <Tile icon="star-outline" bg={C.AMBER_M} color={C.AMBER} title="VCoin rewards" onPress={() => onOpen("vcoin")}
            value={t.vcoinEnabled ? `On · ${t.vcoinRatePerHour || 0} coins per hour` : "Off · tap to turn on"} />
          <Tile icon="people-outline" bg="#F1F5F9" color="#334155" title="Operators" onPress={() => onOpen("operators")} warn={!assigned.length}
            value={assigned.length ? assigned.map(o => `${o.name || "Unnamed"}${o.status === "inactive" ? " (paused)" : ""}`).join(", ") : "None assigned · tap to add"} />
          <Tile icon="gift-outline" bg={C.AMBER_M} color={C.AMBER} title="Offers" onPress={onOffers} dashed={!offerCount}
            value={offerCount ? `${offerCount} live offer${offerCount === 1 ? "" : "s"}` : "None running · tap to add"} />
        </View>

        <TouchableOpacity style={[k.card, hs.statusRow]} activeOpacity={0.85} onPress={() => onOpen("status")}>
          <View style={[hs.statusDot, { backgroundColor: st?.dot || C.FAINT }]} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={k.cardTitle}>Field status & note</Text>
            <Text style={hs.tileValue} numberOfLines={2}>{st?.label || "No status set"} · {t.statusNote ? `“${t.statusNote}”` : "no note for players"}</Text>
          </View>
          <Text style={hs.link}>Change</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const Tile = ({ icon, bg, color, title, value, onPress, warn, dashed }: any) => (
  <TouchableOpacity onPress={onPress} activeOpacity={0.8} style={[hs.tile, dashed && hs.tileDashed, warn && hs.tileWarn]}>
    <View style={[k.iconBox, { width: 38, height: 38, backgroundColor: bg }]}><Ionicons name={icon} size={18} color={color} /></View>
    <View>
      <Text style={[hs.tileTitle, dashed && { color: C.AMBER_D }, warn && { color: C.RED_D }]}>{title}</Text>
      <Text style={[hs.tileValue, dashed && { color: C.AMBER_D, fontWeight: "700" }, warn && { color: C.RED_D, fontWeight: "700" }]} numberOfLines={3}>{value}</Text>
    </View>
  </TouchableOpacity>
);

// ═════════════════════════════════════════════════════════════════════════════
// 3 · PRICING
// ═════════════════════════════════════════════════════════════════════════════
const PRESETS: [number, number][] = [[6, 12], [12, 17], [17, 21], [21, 24]];
const DAY_LABEL: Record<DayType, string> = { weekday: "Mon – Fri", weekend: "Sat – Sun" };
const sortSlabs = (l: PriceSlab[]) => [...l].sort((a, b) => a.start - b.start);

function pricingInitial(t: Turf) {
  const fallback: PriceSlab[] = [{ start: 6, end: 18, rate: Number(t.dayPrice) || 0 }];
  return {
    day: String(t.dayPrice ?? 0), night: String(t.nightPrice ?? 0), fee: String(t.bookingPrice ?? 0),
    adv: !!t.advancePricingEnabled,
    weekday: sortSlabs(t.priceSlabs?.weekday?.length ? t.priceSlabs.weekday : fallback),
    weekend: sortSlabs(t.priceSlabs?.weekend?.length ? t.priceSlabs.weekend : fallback),
  };
}

function PricingEditor({ turf, save, onClose, registerBack }: EditorProps) {
  const [base, setBase] = useState(() => pricingInitial(turf));
  const [day, setDay] = useState(base.day);
  const [night, setNight] = useState(base.night);
  const [fee, setFee] = useState(base.fee);
  const [adv, setAdv] = useState(base.adv);
  const [lists, setLists] = useState<Record<DayType, PriceSlab[]>>({ weekday: base.weekday, weekend: base.weekend });
  const [tab, setTab] = useState<DayType>("weekday");
  const [openSlab, setOpenSlab] = useState(-1);

  const norm = (v: string) => String(numOnly(v));
  const dirty = JSON.stringify({ d: norm(day), n: norm(night), f: norm(fee), adv, wk: sortSlabs(lists.weekday), we: sortSlabs(lists.weekend) })
    !== JSON.stringify({ d: norm(base.day), n: norm(base.night), f: norm(base.fee), adv: base.adv, wk: base.weekday, we: base.weekend });
  const guard = useLocalGuard(dirty, onClose, registerBack);

  const slabs = lists[tab];
  const setSlabs = (l: PriceSlab[]) => setLists(p => ({ ...p, [tab]: l }));
  const stepSlab = (i: number, field: "start" | "end", d: number) =>
    setSlabs(slabs.map((s, j) => j !== i ? s : field === "start"
      ? { ...s, start: Math.max(0, Math.min(s.end - 1, s.start + d)) }
      : { ...s, end: Math.max(s.start + 1, Math.min(24, s.end + d)) }));
  const setRate = (i: number, r: number) => setSlabs(slabs.map((s, j) => (j === i ? { ...s, rate: Math.max(0, r) } : s)));
  const removeSlab = (i: number) => { setSlabs(slabs.filter((_, j) => j !== i)); setOpenSlab(-1); };
  const addSlot = () => {
    const free = PRESETS.find(([a, b]) => !slabs.some(s => a < s.end && s.start < b));
    let a: number, b: number;
    if (free) [a, b] = free;
    else {
      const lastEnd = slabs.length ? Math.max(...slabs.map(s => s.end)) : 6;
      if (lastEnd >= 24) return Alert.alert("Day is full", "Every hour already has a slot. Shorten one to make room.");
      a = lastEnd; b = Math.min(24, lastEnd + 2);
    }
    const next = sortSlabs([...slabs, { start: a, end: b, rate: numOnly(day) }]);
    setSlabs(next);
    setOpenSlab(next.findIndex(s => s.start === a && s.end === b));
  };
  const other: DayType = tab === "weekday" ? "weekend" : "weekday";
  const copyToOther = () =>
    Alert.alert(`Copy to ${DAY_LABEL[other]}?`, `${DAY_LABEL[other]} time slots will be replaced with the ${DAY_LABEL[tab]} ones.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Copy", onPress: () => setLists(p => ({ ...p, [other]: slabs.map(s => ({ ...s })) })) },
    ]);

  const open = turf.openingTime ?? 6, close = turf.closingTime ?? 23;
  const edited = { advancePricingEnabled: adv, priceSlabs: { weekday: lists.weekday, weekend: lists.weekend }, dayPrice: numOnly(day), nightPrice: numOnly(night) };
  let take = 0, peak = 0;
  for (let h = open; h < close; h++) { const r = hourRate(edited, h, tab === "weekend"); take += r; peak = Math.max(peak, r); }
  const maxSlab = Math.max(1, ...slabs.map(s => s.rate));
  let uncovered = 0;
  for (let h = open; h < Math.min(close, 24); h++) if (!slabs.some(s => h >= s.start && h < s.end)) uncovered++;

  type Block = { flex: number; bg: string; fg: string; label: string; index: number };
  const blocks: Block[] = [];
  {
    let cursor = 0;
    const gap = (to: number) => { if (to > cursor) blocks.push({ flex: to - cursor, bg: "#E6EAF0", fg: C.MUTE, label: to - cursor >= 3 ? "base" : "", index: -1 }); };
    slabs.map((s, i) => ({ s, i })).filter(x => x.s.end > x.s.start).sort((a, b) => a.s.start - b.s.start).forEach(({ s, i }) => {
      gap(s.start);
      const strength = 0.4 + 0.6 * (s.rate / maxSlab);
      const from = Math.max(cursor, s.start);
      if (s.end > from) blocks.push({ flex: s.end - from, bg: `rgba(22,163,74,${strength.toFixed(2)})`, fg: strength > 0.65 ? "#fff" : "#14532D", label: s.end - s.start >= 3 ? money(s.rate) : "", index: i });
      cursor = Math.max(cursor, s.end);
    });
    gap(24);
  }

  const flow = useSaveFlow({
    validate: () => (adv ? validateSlabs(lists.weekday, "Mon – Fri") || validateSlabs(lists.weekend, "Sat – Sun") : null),
    buildChanges: () => {
      const ch: Change[] = [];
      pushChange(ch, "Day rate", numOnly(base.day), numOnly(day), money, `${clock(DAY_FROM)} – ${clock(NIGHT_FROM)}`);
      pushChange(ch, "Night rate", numOnly(base.night), numOnly(night), money, `${clock(NIGHT_FROM)} – ${clock(DAY_FROM)}`);
      pushChange(ch, "Advance to confirm", numOnly(base.fee), numOnly(fee), money, "Paid online by player");
      pushChange(ch, "Peak-hour pricing", base.adv, adv, v => (v ? "On" : "Off"));
      if (adv) (["weekday", "weekend"] as DayType[]).forEach(dt => {
        const before = base[dt], after = sortSlabs(lists[dt]);
        const key = (s: PriceSlab) => `${s.start}-${s.end}`;
        after.forEach(s => {
          const old = before.find(o => key(o) === key(s));
          const sub = `${DAY_LABEL[dt]} · ${clock(s.start)} – ${clock(s.end)}`;
          if (!old) ch.push({ label: `${slabName(s)} slot added`, sub, to: money(s.rate), tone: "new" });
          else if (old.rate !== s.rate) ch.push({ label: `${slabName(s)} rate`, sub, from: money(old.rate), to: money(s.rate), tone: s.rate < old.rate ? "down" : undefined });
        });
        before.forEach(o => {
          if (!after.some(s => key(s) === key(o)))
            ch.push({ label: `${slabName(o)} slot removed`, sub: `${DAY_LABEL[dt]} · ${clock(o.start)} – ${clock(o.end)}`, to: money(o.rate), tone: "removed" });
        });
      });
      return ch;
    },
    commit: async () => {
      const wk = sortSlabs(lists.weekday), we = sortSlabs(lists.weekend);
      await save({ dayPrice: numOnly(day), nightPrice: numOnly(night), bookingPrice: numOnly(fee), advancePricingEnabled: adv, priceSlabs: { weekday: wk, weekend: we } });
      setBase({ day, night, fee, adv, weekday: wk, weekend: we });
    },
    onSaved: guard.leave,
  });

  const discard = () => {
    setDay(base.day); setNight(base.night); setFee(base.fee); setAdv(base.adv);
    setLists({ weekday: base.weekday, weekend: base.weekend }); setOpenSlab(-1);
  };

  return (
    <View style={k.screen}>
      <ScreenHeader kicker={turf.name} title="Pricing" onBack={guard.back} />
      <ScrollView keyboardDismissMode="interactive" automaticallyAdjustKeyboardInsets contentContainerStyle={[k.body, { paddingBottom: 140 }]} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <Card>
          <Text style={k.cardTitle}>Base rate per hour</Text>
          <Text style={k.cardSub}>{adv ? "Used for any hour without a time slot below" : "What players pay per hour"}</Text>
          <View style={{ flexDirection: "row", gap: 10, marginTop: 14 }}>
            <RateBox icon="sunny-outline" tint={C.AMBER_D} bg={C.AMBER_L} label={`DAY · ${clock(DAY_FROM)} – ${clock(NIGHT_FROM)}`} value={day} onChange={setDay} />
            <RateBox icon="moon-outline" tint={C.PURPLE} bg={C.PURPLE_L} label={`NIGHT · ${clock(NIGHT_FROM)} – ${clock(DAY_FROM)}`} value={night} onChange={setNight} />
          </View>
          <View style={ps.feeRow}>
            <View style={{ flex: 1 }}>
              <Text style={ps.feeTitle}>Advance to confirm booking</Text>
              <Text style={k.cardSub}>Player pays this online, rest at the turf</Text>
            </View>
            <View style={ps.feeInputWrap}>
              <Text style={ps.rupee}>₹</Text>
              <TextInput style={ps.feeInput} keyboardType="number-pad" maxLength={5} value={fee} onChangeText={v => setFee(v.replace(/[^0-9]/g, ""))} accessibilityLabel="Advance amount" />
            </View>
          </View>
        </Card>

        <Card style={{ gap: 14 }}>
          <CardHead icon="trending-up-outline" title="Peak-hour pricing" sub="Set a different rate for each part of the day"
            right={<Switch value={adv} onValueChange={setAdv} trackColor={{ false: "#DDE3EA", true: C.GREEN }} thumbColor="#fff" />} />
          {adv && (
            <>
              <View style={ps.seg}>
                {(["weekday", "weekend"] as DayType[]).map(dt => (
                  <TouchableOpacity key={dt} onPress={() => { setTab(dt); setOpenSlab(-1); }} style={[ps.segBtn, tab === dt && ps.segOn]}>
                    <Text style={[ps.segText, { color: tab === dt ? C.INK : C.MUTE }]}>{DAY_LABEL[dt]}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <View>
                <View style={ps.timeline}>
                  {blocks.map((b, i) => (
                    <TouchableOpacity key={i} activeOpacity={b.index >= 0 ? 0.7 : 1} onPress={() => b.index >= 0 && setOpenSlab(openSlab === b.index ? -1 : b.index)}
                      style={{ flex: b.flex, backgroundColor: b.bg, alignItems: "center", justifyContent: "center", borderWidth: openSlab === b.index && b.index >= 0 ? 2 : 0, borderColor: C.INK }}>
                      {!!b.label && <Text style={{ fontSize: 10.5, fontWeight: "800", color: b.fg }} numberOfLines={1}>{b.label}</Text>}
                    </TouchableOpacity>
                  ))}
                </View>
                <View style={ps.axisRow}>{["12A", "6A", "12P", "6P", "12A"].map((x, i) => <Text key={i} style={ps.axis}>{x}</Text>)}</View>
                <Text style={[ps.coverage, { color: uncovered ? C.AMBER : C.GREEN_D }]}>
                  {uncovered ? `${hrsLabel(uncovered)} still use the base rate` : "✓ Every open hour has a price"}
                  {close > 24 ? " · after 12 AM uses night rate" : ""}
                </Text>
              </View>

              <View style={{ gap: 8 }}>
                {slabs.map((slab, i) => {
                  const overlap = slabs.some((o, j) => j !== i && slab.start < o.end && o.start < slab.end);
                  const bad = overlap || slab.end <= slab.start;
                  const isOpen = openSlab === i;
                  const strength = 0.4 + 0.6 * (slab.rate / maxSlab);
                  return (
                    <View key={i} style={[ps.slot, { borderColor: bad ? "#FCA5A5" : isOpen ? C.GREEN : C.LINE, backgroundColor: isOpen ? "#F7FBF8" : "#fff" }]}>
                      <TouchableOpacity onPress={() => setOpenSlab(isOpen ? -1 : i)} activeOpacity={0.7} style={ps.slotHead}>
                        <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: `rgba(22,163,74,${strength.toFixed(2)})` }} />
                        <View style={{ flex: 1 }}>
                          <Text style={ps.slotTitle}>{slabName(slab)} · {clock(slab.start)} → {clock(slab.end)}</Text>
                          <Text style={k.cardSub}>{hrsLabel(Math.max(0, slab.end - slab.start))}{slab.rate === maxSlab && slabs.length > 1 ? " · peak" : ""}</Text>
                        </View>
                        <Text style={ps.slotRate}>{money(slab.rate)}</Text>
                        <Ionicons name={isOpen ? "chevron-up" : "chevron-down"} size={16} color={C.FAINT} />
                      </TouchableOpacity>
                      {isOpen && (
                        <View style={{ paddingHorizontal: 13, paddingBottom: 13, gap: 12 }}>
                          <View style={{ flexDirection: "row", gap: 10 }}>
                            <Stepper label="STARTS" value={clockMin(slab.start)} onMinus={() => stepSlab(i, "start", -1)} onPlus={() => stepSlab(i, "start", 1)} />
                            <Stepper label="ENDS" value={clockMin(slab.end)} onMinus={() => stepSlab(i, "end", -1)} onPlus={() => stepSlab(i, "end", 1)} />
                          </View>
                          <View>
                            <Label>Rate per hour</Label>
                            <View style={{ flexDirection: "row", gap: 8 }}>
                              <View style={ps.rateWrap}>
                                <Text style={ps.rupee}>₹</Text>
                                <TextInput style={ps.rateInput} keyboardType="number-pad" maxLength={5} value={String(slab.rate)} onChangeText={v => setRate(i, numOnly(v))} accessibilityLabel="Slot rate" />
                              </View>
                              <TouchableOpacity onPress={() => removeSlab(i)} style={ps.delBtn} accessibilityLabel="Delete this time slot">
                                <Ionicons name="trash-outline" size={17} color={C.RED} />
                              </TouchableOpacity>
                            </View>
                            <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
                              {[-100, -50, 50, 100].map(d => (
                                <TouchableOpacity key={d} onPress={() => setRate(i, slab.rate + d)} style={ps.bump}>
                                  <Text style={ps.bumpText}>{d > 0 ? "+" : "−"}{Math.abs(d)}</Text>
                                </TouchableOpacity>
                              ))}
                            </View>
                          </View>
                          {bad && (
                            <View style={ps.err}><Text style={ps.errText}>{slab.end <= slab.start ? "End time must be after the start time." : "This overlaps another time slot."}</Text></View>
                          )}
                        </View>
                      )}
                    </View>
                  );
                })}
              </View>

              <View style={{ flexDirection: "row", gap: 8 }}>
                <TouchableOpacity onPress={addSlot} style={ps.addBtn}><Text style={ps.addText}>+ Add time slot</Text></TouchableOpacity>
                <TouchableOpacity onPress={copyToOther} style={ps.copyBtn}>
                  <Ionicons name="copy-outline" size={15} color="#334155" />
                  <Text style={ps.copyText}>Copy to {DAY_LABEL[other].replace(/ /g, "")}</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </Card>

        <View style={{ flexDirection: "row", gap: 10 }}>
          <View style={[ps.stat, { backgroundColor: "#fff" }]}>
            <Label>Peak rate</Label>
            <Text style={ps.statValue}>{money(peak)}/hr</Text>
          </View>
          <View style={[ps.stat, { backgroundColor: C.GREEN_L }]}>
            <Label color={C.GREEN_D}>{`Full day, if sold out${adv ? ` · ${DAY_LABEL[tab]}` : ""}`}</Label>
            <Text style={[ps.statValue, { color: C.GREEN_D }]}>{money(take)}</Text>
          </View>
        </View>
        <Text style={ps.foot}>Open {shortClock(open)} – {shortClock(close)}. Change hours in the Hours screen.</Text>
      </ScrollView>

      <SaveBar dirty={dirty} saving={flow.saving} onDiscard={discard} onSave={flow.requestSave}
        summary={`${money(numOnly(day))} day · ${money(numOnly(night))} night · ${adv ? `${slabs.length} slots` : "flat rate"}`} />
      <ConfirmSheet visible={flow.confirmOpen} icon="pricetag-outline" subtitle={`${turf.name || "Turf"} · Pricing`} changes={flow.changes} saving={flow.saving}
        note="New prices apply to bookings made from now. Bookings already made are not changed."
        onCancel={() => flow.setConfirmOpen(false)} onConfirm={flow.confirm} />
    </View>
  );
}

const RateBox = ({ icon, tint, bg, label, value, onChange }: any) => (
  <View style={[ps.rateBox, { backgroundColor: bg }]}>
    <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
      <Ionicons name={icon} size={13} color={tint} />
      <Text style={[ps.rateLabel, { color: tint }]} numberOfLines={1}>{label}</Text>
    </View>
    <View style={{ flexDirection: "row", alignItems: "center", gap: 3, marginTop: 6 }}>
      <Text style={[ps.rupee, { fontSize: 18 }]}>₹</Text>
      <TextInput style={ps.bigInput} keyboardType="number-pad" maxLength={6} value={value} onChangeText={(v: string) => onChange(v.replace(/[^0-9]/g, ""))} accessibilityLabel={label} />
    </View>
  </View>
);

const Stepper = ({ label, value, onMinus, onPlus }: any) => (
  <View style={{ flex: 1 }}>
    <Label>{label}</Label>
    <View style={ps.stepper}>
      <TouchableOpacity onPress={onMinus} style={ps.stepBtn} accessibilityLabel={`${label} earlier`}><Text style={ps.stepText}>−</Text></TouchableOpacity>
      <Text style={ps.stepValue} numberOfLines={1}>{value}</Text>
      <TouchableOpacity onPress={onPlus} style={ps.stepBtn} accessibilityLabel={`${label} later`}><Text style={ps.stepText}>+</Text></TouchableOpacity>
    </View>
  </View>
);

// ═════════════════════════════════════════════════════════════════════════════
// 4 · HOURS
// ═════════════════════════════════════════════════════════════════════════════
const CUTOFFS = [0, 2, 3, 4, 5, 6];                         // hours before midnight
const cutoffText = (h: number) => (h === 0 ? "Any time" : clock(24 - h));

function HoursEditor({ turf, save, onClose, registerBack }: EditorProps) {
  const [base, setBase] = useState({ open: turf.openingTime ?? 6, close: turf.closingTime ?? 23, cutoff: turf.lateCutoffHours ?? 0 });
  const [open, setOpen] = useState(base.open);
  const [close, setClose] = useState(base.close);
  const [cutoff, setCutoff] = useState(base.cutoff);

  const dirty = open !== base.open || close !== base.close || cutoff !== base.cutoff;
  const guard = useLocalGuard(dirty, onClose, registerBack);

  const late = close > 24;
  const lateEnd = close - 24;
  const openHrs = Math.max(0, close - open);
  const slotMin = turf.slotDuration ?? 60;
  const slots = Math.floor((openHrs * 60) / slotMin);
  const closeLabel = (h: number) => `${clockMin(h)}${h > 24 ? " (next day)" : ""}`;

  const flow = useSaveFlow({
    validate: () => {
      if (close <= open) return "Closing time must be after opening time.";
      if (late && open < lateEnd) return `If you close at ${clock(close)}, you must open at ${clock(lateEnd)} or later.`;
      return null;
    },
    buildChanges: () => {
      const ch: Change[] = [];
      pushChange(ch, "Opens at", base.open, open, clockMin);
      pushChange(ch, "Closes at", base.close, close, closeLabel);
      if (late || base.close > 24)
        pushChange(ch, "Late-night booking stops", base.cutoff, cutoff, cutoffText, `For 12 AM – ${clock(Math.max(close, base.close))} slots`);
      return ch;
    },
    commit: async () => {
      await save({ openingTime: open, closingTime: close, lateCutoffHours: cutoff });
      setBase({ open, close, cutoff });
    },
    onSaved: guard.leave,
  });

  const discard = () => { setOpen(base.open); setClose(base.close); setCutoff(base.cutoff); };

  return (
    <View style={k.screen}>
      <ScreenHeader kicker={turf.name} title="Hours" onBack={guard.back} />
      <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" automaticallyAdjustKeyboardInsets contentContainerStyle={[k.body, { paddingBottom: 140 }]} showsVerticalScrollIndicator={false}>
        <Card>
          <Text style={k.cardTitle}>When is the turf open?</Text>
          <View style={{ flexDirection: "row", gap: 10, marginTop: 14 }}>
            <TimeBox label="OPENS" value={clock(open)} onMinus={() => setOpen(Math.max(0, open - 1))} onPlus={() => setOpen(Math.min(close - 1, open + 1))} />
            <TimeBox label="CLOSES" value={clock(close)} nextDay={late} onMinus={() => setClose(Math.max(open + 1, close - 1))} onPlus={() => setClose(Math.min(MAX_CLOSE, close + 1))} />
          </View>
          <View style={hr.dayBar}>
            {Array.from({ length: 24 }, (_, h) => (
              <View key={h} style={{ flex: 1, backgroundColor: h >= open && h < close ? C.INK : h < lateEnd ? "#7C3AED" : "#DDE3EA" }} />
            ))}
          </View>
          <View style={ps.axisRow}>{["12A", "6A", "12P", "6P", "12A"].map((x, i) => <Text key={i} style={ps.axis}>{x}</Text>)}</View>
          <View style={hr.legend}>
            <Legend color={C.INK} text="Open" />
            {late && <Legend color="#7C3AED" text="After midnight" />}
            <Legend color="#DDE3EA" text="Closed" />
          </View>
          <View style={{ flexDirection: "row", gap: 10, marginTop: 14 }}>
            <View style={hr.sum}><Text style={hr.sumNum}>{openHrs} hrs</Text><Text style={hr.sumLabel}>open every day</Text></View>
            <View style={hr.sum}><Text style={hr.sumNum}>{slots} slots</Text><Text style={hr.sumLabel}>of {durationLabel(slotMin)} a day</Text></View>
          </View>
        </Card>

        <Card>
          <CardHead icon="moon-outline" iconBg={late ? C.PURPLE_M : "#EEF1F5"} iconColor={late ? C.PURPLE : C.FAINT} title="Late-night bookings"
            sub={late ? `For slots between 12 AM and ${clock(close)}` : "Tap + on CLOSES past 12 AM to stay open late"} />
          {late && (
            <>
              <View style={{ marginTop: 16 }}><Label>Stop taking these bookings at</Label></View>
              <View style={hr.cutGrid}>
                {CUTOFFS.map(h => <Choice key={h} label={cutoffText(h)} on={cutoff === h} onPress={() => setCutoff(h)} style={hr.cutChoice} />)}
              </View>
              <View style={{ marginTop: 12 }}>
                <Note tone="purple" text={cutoff === 0
                  ? `Players can book 12 AM – ${clock(close)} slots at any time.`
                  : `Players can book 12 AM – ${clock(close)} slots only until ${cutoffText(cutoff)} the evening before, so your staff know who's coming.`} />
              </View>
            </>
          )}
        </Card>
      </ScrollView>

      <SaveBar dirty={dirty} saving={flow.saving} onDiscard={discard} onSave={flow.requestSave} summary={`${clock(open)} – ${clock(close)}${late ? " next day" : ""}`} />
      <ConfirmSheet visible={flow.confirmOpen} icon="time-outline" iconBg={C.PURPLE_M} iconColor={C.PURPLE} subtitle={`${turf.name || "Turf"} · Hours`}
        changes={flow.changes} saving={flow.saving}
        note="New hours apply right away. Bookings already made are not cancelled — check them if you closed earlier."
        onCancel={() => flow.setConfirmOpen(false)} onConfirm={flow.confirm} />
    </View>
  );
}

const TimeBox = ({ label, value, nextDay, onMinus, onPlus }: any) => {
  const [time, ampm] = String(value).split(" ");
  return (
    <View style={[hr.timeBox, nextDay && { backgroundColor: C.PURPLE_L }]}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Text style={[hr.timeLabel, nextDay && { color: C.PURPLE }]}>{label}</Text>
        {nextDay && <Text style={hr.nextDay}>NEXT DAY</Text>}
      </View>
      <Text style={[hr.timeValue, nextDay && { color: C.PURPLE_D }]}>{time}:00</Text>
      <Text style={[hr.ampm, nextDay && { color: C.PURPLE }]}>{ampm}</Text>
      <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
        <TouchableOpacity style={hr.roundBtn} onPress={onMinus} accessibilityLabel={`${label} earlier`}><Text style={hr.roundText}>−</Text></TouchableOpacity>
        <TouchableOpacity style={hr.roundBtn} onPress={onPlus} accessibilityLabel={`${label} later`}><Text style={hr.roundText}>+</Text></TouchableOpacity>
      </View>
    </View>
  );
};

const Legend = ({ color, text }: { color: string; text: string }) => (
  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
    <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: color }} />
    <Text style={hr.legendText}>{text}</Text>
  </View>
);

// ═════════════════════════════════════════════════════════════════════════════
// 5 · BOOKING STYLE
// ═════════════════════════════════════════════════════════════════════════════
const LENGTHS = [30, 60, 90, 120];

function StyleEditor({ turf, save, onClose, registerBack }: EditorProps) {
  const [base, setBase] = useState({ flex: turf.flexibleSlotsEnabled !== false, quick: turf.quickSlotsEnabled !== false, len: turf.slotDuration ?? 60 });
  const [flex, setFlex] = useState(base.flex);
  const [quick, setQuick] = useState(base.quick);
  const [len, setLen] = useState(base.len);

  const dirty = flex !== base.flex || quick !== base.quick || len !== base.len;
  const guard = useLocalGuard(dirty, onClose, registerBack);

  const toggle = (which: "flex" | "quick", v: boolean) => {
    const other = which === "flex" ? quick : flex;
    if (!v && !other) return Alert.alert("Keep one on", "Players need at least one way to book.");
    which === "flex" ? setFlex(v) : setQuick(v);
  };

  const open = turf.openingTime ?? 6;
  const flexTimes = [0, 0.5, 1, 1.5, 2].map(x => clockMin(open + x).replace(/ (AM|PM)/, ""));
  const quickSlots = [0, 1, 2].map(i => {
    const a = open + (i * len) / 60, b = a + len / 60;
    return `${clockMin(a).replace(/:00/, "")} – ${clockMin(b).replace(/:00/, "")}`;
  });
  const styleText = (f: boolean, q: boolean) => (f && q ? "Flexible + Quick" : f ? "Flexible only" : "Quick slots only");

  const flow = useSaveFlow({
    validate: () => (!flex && !quick ? "Keep at least one booking style on." : null),
    buildChanges: () => {
      const ch: Change[] = [];
      pushChange(ch, "Flexible time", base.flex, flex, v => (v ? "On" : "Off"));
      pushChange(ch, "Quick slots", base.quick, quick, v => (v ? "On" : "Off"));
      pushChange(ch, "Slot length", base.len, len, durationLabel);
      return ch;
    },
    commit: async () => {
      await save({ flexibleSlotsEnabled: flex, quickSlotsEnabled: quick, slotDuration: len });
      setBase({ flex, quick, len });
    },
    onSaved: guard.leave,
  });

  const discard = () => { setFlex(base.flex); setQuick(base.quick); setLen(base.len); };

  return (
    <View style={k.screen}>
      <ScreenHeader kicker={turf.name} title="Booking style" onBack={guard.back} />
      <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" automaticallyAdjustKeyboardInsets contentContainerStyle={[k.body, { paddingBottom: 140 }]} showsVerticalScrollIndicator={false}>
        <Text style={bs.intro}>Choose how players pick their time. You can keep both on.</Text>

        <Card style={[flex && bs.onCard]}>
          <CardHead icon="time-outline" iconBg={flex ? C.GREEN_M : "#EEF1F5"} iconColor={flex ? C.GREEN_D : C.FAINT}
            title="Flexible time" sub="Start at any half hour, play as long as they want"
            right={<Switch value={flex} onValueChange={v => toggle("flex", v)} trackColor={{ false: "#DDE3EA", true: C.GREEN }} thumbColor="#fff" />} />
          <View style={bs.preview}>
            <Label>Players see</Label>
            <View style={bs.chips}>{flexTimes.map((t, i) => <Text key={i} style={[bs.chip, i === 1 && bs.chipOn]}>{t}</Text>)}</View>
            <Text style={bs.previewFoot}>then: 1 hr · 1.5 hr · 2 hr</Text>
          </View>
        </Card>

        <Card style={[quick && bs.onCard]}>
          <CardHead icon="flash-outline" iconBg={quick ? C.BLUE_M : "#EEF1F5"} iconColor={quick ? C.BLUE : C.FAINT}
            title="Quick slots" sub={`Fixed ${durationLabel(len)} blocks from ${clock(open)}, one tap to book`}
            right={<Switch value={quick} onValueChange={v => toggle("quick", v)} trackColor={{ false: "#DDE3EA", true: C.GREEN }} thumbColor="#fff" />} />
          <View style={bs.preview}>
            <Label>Players see</Label>
            <View style={{ flexDirection: "row", gap: 6 }}>
              {quickSlots.map((t, i) => <Text key={i} style={[bs.slotChip, i === 1 && bs.slotTaken]} numberOfLines={1}>{t}</Text>)}
            </View>
          </View>
        </Card>

        <Card>
          <Text style={k.cardTitle}>Slot length</Text>
          <Text style={k.cardSub}>Size of each quick slot</Text>
          <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
            {LENGTHS.map(v => <Choice key={v} label={durationLabel(v)} on={len === v} onPress={() => setLen(v)} />)}
          </View>
        </Card>

        <Note tone="green" text="Tip: turn Flexible time off to stop awkward 30-min gaps. Every booking then starts on your slot grid." />
      </ScrollView>

      <SaveBar dirty={dirty} saving={flow.saving} onDiscard={discard} onSave={flow.requestSave} summary={`${styleText(flex, quick)} · ${durationLabel(len)}`} />
      <ConfirmSheet visible={flow.confirmOpen} icon="flash-outline" iconBg={C.BLUE_M} iconColor={C.BLUE} subtitle={`${turf.name || "Turf"} · Booking style`}
        changes={flow.changes} saving={flow.saving} note="Players see the new booking style the next time they open this turf."
        onCancel={() => flow.setConfirmOpen(false)} onConfirm={flow.confirm} />
    </View>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// 6 · VCOIN
// ═════════════════════════════════════════════════════════════════════════════
const COIN_VALUE = 0.5;          // ₹ per coin when a player redeems
const COIN_PRESETS = [10, 25, 50, 100];

function VCoinEditor({ turf, save, onClose, registerBack }: EditorProps) {
  const [base, setBase] = useState({ on: !!turf.vcoinEnabled, rate: Number(turf.vcoinRatePerHour) || 0 });
  const [on, setOn] = useState(base.on);
  const [rateText, setRateText] = useState(String(base.rate));
  const rate = numOnly(rateText);
  const setRate = (v: number) => setRateText(String(Math.max(0, v)));

  const dirty = on !== base.on || rate !== base.rate;
  const guard = useLocalGuard(dirty, onClose, registerBack);

  const flow = useSaveFlow({
    validate: () => (on && rate <= 0 ? "Set how many coins a player earns per hour, or turn rewards off." : null),
    buildChanges: () => {
      const ch: Change[] = [];
      pushChange(ch, "VCoin rewards", base.on, on, v => (v ? "On" : "Off"));
      if (on) pushChange(ch, "Coins per hour", base.rate, rate, v => `${v} coins`, `≈ ${money(rate * COIN_VALUE)} off per hour booked`);
      return ch;
    },
    commit: async () => {
      await save({ vcoinEnabled: on, vcoinRatePerHour: rate });
      setBase({ on, rate });
    },
    onSaved: guard.leave,
  });

  const discard = () => { setOn(base.on); setRateText(String(base.rate)); };

  return (
    <View style={k.screen}>
      <ScreenHeader kicker={turf.name} title="VCoin rewards" onBack={guard.back} />
      <ScrollView keyboardDismissMode="interactive" automaticallyAdjustKeyboardInsets contentContainerStyle={[k.body, { paddingBottom: 140 }]} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <Card>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
            <View style={vs.coin}><Text style={vs.coinText}>V</Text></View>
            <View style={{ flex: 1 }}>
              <Text style={k.cardTitle}>Reward regular players</Text>
              <Text style={k.cardSub}>They earn coins for every hour booked and spend them only at {turf.name || "this turf"}</Text>
            </View>
          </View>
          <View style={[vs.toggleRow, { backgroundColor: on ? C.GREEN_L : C.SOFT }]}>
            <Text style={[vs.toggleText, { color: on ? C.GREEN_D : C.SLATE }]}>{on ? "Rewards are on" : "Rewards are off"}</Text>
            <Switch value={on} onValueChange={setOn} trackColor={{ false: "#DDE3EA", true: C.GREEN }} thumbColor="#fff" />
          </View>
        </Card>

        {on && (
          <>
            <Card>
              <Text style={k.cardTitle}>Coins per hour booked</Text>
              <View style={vs.stepper}>
                <TouchableOpacity style={vs.stepBtn} onPress={() => setRate(rate - 5)} accessibilityLabel="Fewer coins"><Text style={vs.stepText}>−</Text></TouchableOpacity>
                <View style={{ flex: 1, alignItems: "center" }}>
                  <TextInput style={vs.bigInput} keyboardType="number-pad" maxLength={4} value={rateText} onChangeText={v => setRateText(v.replace(/[^0-9]/g, ""))} accessibilityLabel="Coins per hour" />
                  <Text style={vs.unit}>coins / hour</Text>
                </View>
                <TouchableOpacity style={vs.stepBtn} onPress={() => setRate(rate + 5)} accessibilityLabel="More coins"><Text style={vs.stepText}>+</Text></TouchableOpacity>
              </View>
              <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
                {COIN_PRESETS.map(v => <Choice key={v} label={String(v)} on={rate === v} onPress={() => setRate(v)} style={{ height: 40, borderRadius: 999 }} />)}
              </View>
            </Card>

            <Card>
              <Text style={k.cardTitle}>What a player earns</Text>
              <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
                {[1, 2, 3].map(h => (
                  <View key={h} style={vs.earn}>
                    <Text style={vs.earnHrs}>{h} hr</Text>
                    <Text style={vs.earnCoins}>{rate * h}</Text>
                    <Text style={vs.earnWorth}>≈ {money(rate * h * COIN_VALUE)} off</Text>
                  </View>
                ))}
              </View>
              <View style={{ marginTop: 12 }}>
                <Note text={`Costs you about ${money(rate * COIN_VALUE)} per hour booked, paid back when the player returns.`} />
              </View>
            </Card>
          </>
        )}
      </ScrollView>

      <SaveBar dirty={dirty} saving={flow.saving} onDiscard={discard} onSave={flow.requestSave} summary={on ? `${rate} coins / hr` : "Rewards off"} />
      <ConfirmSheet visible={flow.confirmOpen} icon="star-outline" iconBg={C.AMBER_M} iconColor={C.AMBER} subtitle={`${turf.name || "Turf"} · VCoin rewards`}
        changes={flow.changes} saving={flow.saving} note="Applies to new bookings. Coins players already earned stay in their wallet."
        onCancel={() => flow.setConfirmOpen(false)} onConfirm={flow.confirm} />
    </View>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// 7 · FIELD STATUS
// ═════════════════════════════════════════════════════════════════════════════
const NOTE_IDEAS = ["Pitch is soft after rain", "Floodlights under repair", "Only half the pitch available", "Parking full — use back gate"];

function StatusEditor({ turf, save, onClose, registerBack }: EditorProps) {
  const [base, setBase] = useState({ status: turf.status || "", note: turf.statusNote || "" });
  const [status, setStatus] = useState(base.status);
  const [note, setNote] = useState(base.note);

  const dirty = status !== base.status || note.trim() !== base.note.trim();
  const guard = useLocalGuard(dirty, onClose, registerBack);

  const cur = statusDef(status);
  const updatedAt = turf.statusUpdatedAt ? new Date(turf.statusUpdatedAt) : null;
  const label = (key: string) => statusDef(key)?.label || "No status";

  const flow = useSaveFlow({
    buildChanges: () => {
      const ch: Change[] = [];
      pushChange(ch, "Field status", base.status, status, label, cur?.blocks ? "Booking pauses while this is on" : undefined);
      const a = base.note.trim(), b = note.trim();
      if (a !== b) ch.push(b
        ? { label: "Note for players", from: a ? `“${a}”` : undefined, to: `“${b}”`, tone: a ? undefined : "new" }
        : { label: "Note for players", to: `“${a}”`, tone: "removed" });
      return ch;
    },
    commit: async () => {
      await save({ status: status || null, statusNote: note.trim() || null, statusUpdatedAt: status ? new Date().toISOString() : null });
      setBase({ status, note: note.trim() });
    },
    onSaved: guard.leave,
  });

  const discard = () => { setStatus(base.status); setNote(base.note); };

  return (
    <View style={k.screen}>
      <ScreenHeader kicker={turf.name} title="Field status" onBack={guard.back} />
      <ScrollView keyboardDismissMode="interactive" automaticallyAdjustKeyboardInsets contentContainerStyle={[k.body, { paddingBottom: 140 }]} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View>
          <Text style={[k.sectionTitle, { marginBottom: 8 }]}>WHAT PLAYERS SEE</Text>
          <View style={ss.preview}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={ss.pvName} numberOfLines={1}>{turf.name || "Turf"}</Text>
                <Text style={ss.pvMeta} numberOfLines={1}>{turf.location || ""}{minRate(turf) ? ` · from ${money(minRate(turf))}/hr` : ""}</Text>
              </View>
              <View style={ss.pvPill}>
                <View style={[ss.dot, { backgroundColor: cur?.dot || C.FAINT }]} />
                <Text style={ss.pvPillText}>{cur?.label || "No status"}</Text>
              </View>
            </View>
            {!!note.trim() && <Text style={ss.pvNote}>“{note.trim()}”</Text>}
            {cur?.blocks && <Text style={ss.pvBlocked}>Booking is paused while this status is on</Text>}
          </View>
        </View>

        <View style={[k.card, { padding: 8 }]}>
          {STATUS_DEFS.map(d => {
            const on = status === d.key;
            return (
              <TouchableOpacity key={d.key} onPress={() => setStatus(on ? "" : d.key)} activeOpacity={0.8}
                style={[ss.option, on && { backgroundColor: C.GREEN_L }]} accessibilityState={{ selected: on }}>
                <View style={[ss.optDot, { backgroundColor: d.dot }]} />
                <View style={{ flex: 1 }}>
                  <Text style={ss.optLabel}>{d.label}</Text>
                  <Text style={[ss.optHint, d.blocks && { color: C.RED_D }]}>{d.hint}</Text>
                </View>
                <View style={[ss.radio, on && ss.radioOn]} />
              </TouchableOpacity>
            );
          })}
        </View>

        <Card>
          <Text style={k.cardTitle}>Note for players</Text>
          <Text style={k.cardSub}>Optional — shown under the status</Text>
          <TextInput style={ss.textarea} multiline maxLength={140} value={note} onChangeText={setNote}
            placeholder="e.g. North half is soft after last night's rain" placeholderTextColor={C.FAINT} />
          <View style={ss.ideas}>
            {NOTE_IDEAS.map(n => (
              <TouchableOpacity key={n} onPress={() => setNote(n)} style={ss.idea}><Text style={ss.ideaText}>+ {n}</Text></TouchableOpacity>
            ))}
            {!!note && (
              <TouchableOpacity onPress={() => setNote("")} style={[ss.idea, { borderColor: "#FECACA" }]}><Text style={[ss.ideaText, { color: C.RED_D }]}>Clear note</Text></TouchableOpacity>
            )}
          </View>
        </Card>
      </ScrollView>

      <SaveBar dirty={dirty} saving={flow.saving} onDiscard={discard} onSave={flow.requestSave}
        summary={updatedAt ? `Updated ${updatedAt.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}` : "Not set yet"} />
      <ConfirmSheet visible={flow.confirmOpen} icon="pulse-outline" subtitle={`${turf.name || "Turf"} · Field status`} changes={flow.changes} saving={flow.saving}
        note={cur?.blocks ? "Players won't be able to book this turf until you change the status back." : "Players see this right away."}
        onCancel={() => flow.setConfirmOpen(false)} onConfirm={flow.confirm} />
    </View>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// 8 · OPERATORS
// ═════════════════════════════════════════════════════════════════════════════
function OperatorsEditor({ turf, save, onClose, registerBack, team, allTurfs, onTeamChanged, onToggleActive }: EditorProps & {
  team: Operator[]; allTurfs: Turf[]; onTeamChanged: () => void; onToggleActive: (o: Operator) => void;
}) {
  const [base, setBase] = useState<string[]>(getTurfOperatorIds(turf));
  const [picked, setPicked] = useState<string[]>(base);

  const dirty = [...picked].sort().join() !== [...base].sort().join();
  const guard = useLocalGuard(dirty, onClose, registerBack);

  const byId = (id: string) => team.find(o => o.id === id);
  const nameOf = (id: string) => byId(id)?.name || "Unnamed";
  const otherTurfs = (o: Operator) => allTurfs.filter(t => t.id !== turf.id && getTurfOperatorIds(t).includes(o.id)).map(t => t.name).filter(Boolean);
  const onTurf = picked.map(byId).filter(Boolean) as Operator[];
  const available = team.filter(o => !picked.includes(o.id));

  const call = (op: Operator) => {
    if (!op.phone) return Alert.alert("No phone number", `${op.name || "This operator"} has no phone number saved.`);
    Linking.openURL(`tel:${op.phone}`).catch(() => Alert.alert("Can't call", "Your phone could not start the call."));
  };

  const flow = useSaveFlow({
    buildChanges: () => {
      const ch: Change[] = [];
      picked.filter(id => !base.includes(id)).forEach(id => ch.push({ label: nameOf(id), sub: "Can manage bookings here", to: "Added", tone: "new" }));
      base.filter(id => !picked.includes(id)).forEach(id => ch.push({ label: nameOf(id), sub: "Login and other turfs stay", to: "Off this turf", tone: "removed" }));
      return ch;
    },
    commit: async () => {
      const added = picked.filter(id => !base.includes(id));
      const removed = base.filter(id => !picked.includes(id));
      const first = byId(picked[0]);
      await save({ operatorIds: picked, operatorId: picked[0] || "", operatorName: first?.name || "", operatorEmail: first?.email || "" });

      const turfName = (tid: string) => (tid === turf.id ? turf.name : allTurfs.find(t => t.id === tid)?.name) || "";
      await Promise.all(added.map(async id => {
        const op = byId(id); if (!op) return;
        const existing = getOperatorTurfIds(op);
        if (existing.includes(turf.id)) return;
        const merged = [...existing, turf.id];
        await updateDoc(doc(db, "users", id), { turfIds: merged, turfId: merged[0], turfName: turfName(merged[0]) });
      }));
      await Promise.all(removed.map(async id => {
        const op = byId(id); if (!op) return;
        const rest = getOperatorTurfIds(op).filter(tid => tid !== turf.id);
        await updateDoc(doc(db, "users", id), { turfIds: rest, turfId: rest[0] || "", turfName: rest.length ? turfName(rest[0]) : "" });
      }));
      setBase(picked);
      onTeamChanged();
    },
    onSaved: guard.leave,
  });

  return (
    <View style={k.screen}>
      <ScreenHeader kicker={turf.name} title="Operators" onBack={guard.back} />
      <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" automaticallyAdjustKeyboardInsets contentContainerStyle={[k.body, { paddingBottom: 140 }]} showsVerticalScrollIndicator={false}>
        <View style={os.sectionRow}>
          <Text style={k.sectionTitle}>RUNNING THIS TURF</Text>
          <Text style={os.hint}>{onTurf.length} operator{onTurf.length === 1 ? "" : "s"}</Text>
        </View>

        {onTurf.length === 0 && (
          <View style={os.empty}>
            <Ionicons name="person-add-outline" size={28} color={C.RED} />
            <Text style={os.emptyText}>Nobody is assigned. Add someone from your team below.</Text>
          </View>
        )}

        {onTurf.map(op => {
          const active = op.status !== "inactive";
          const others = otherTurfs(op);
          const isNew = !base.includes(op.id);
          return (
            <Card key={op.id}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                <View style={[os.avatar, { backgroundColor: active ? C.GREEN_M : "#EEF1F5" }]}>
                  <Text style={[os.avatarText, { color: active ? C.GREEN_D : C.MUTE }]}>{initials(op.name)}</Text>
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Text style={os.name} numberOfLines={1}>{op.name || "Unnamed"}</Text>
                    {isNew && <Text style={os.newTag}>NEW</Text>}
                  </View>
                  <Text style={os.sub} numberOfLines={1}>{op.phone || op.email || "No contact saved"}</Text>
                  {others.length > 0 && <Text style={os.also} numberOfLines={1}>Also runs {others.join(", ")}</Text>}
                </View>
              </View>
              <View style={[os.activeRow, { backgroundColor: active ? C.GREEN_L : C.SOFT }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[os.activeTitle, { color: active ? C.GREEN_D : C.SLATE }]}>{active ? "Active" : "Paused"}</Text>
                  <Text style={os.activeSub}>{active ? "Can log in and manage bookings" : "Can't log in right now"}</Text>
                </View>
                <Switch value={active} onValueChange={() => onToggleActive(op)} trackColor={{ false: "#DDE3EA", true: C.GREEN }} thumbColor="#fff" />
              </View>
              <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
                <TouchableOpacity style={os.callBtn} onPress={() => call(op)}>
                  <Ionicons name="call-outline" size={16} color={C.INK} />
                  <Text style={os.callText}>Call</Text>
                </TouchableOpacity>
                <TouchableOpacity style={os.removeBtn} onPress={() => setPicked(p => p.filter(x => x !== op.id))}>
                  <Text style={os.removeText}>Remove from turf</Text>
                </TouchableOpacity>
              </View>
            </Card>
          );
        })}

        <Text style={[k.sectionTitle, { marginTop: 8 }]}>ADD FROM YOUR TEAM</Text>
        {available.length === 0 ? (
          <Text style={os.hint}>{team.length ? "Everyone in your team is already on this turf." : "You have no operators yet."}</Text>
        ) : available.map(op => {
          const others = otherTurfs(op);
          return (
            <View key={op.id} style={os.addRow}>
              <View style={[os.avatar, { width: 44, height: 44, backgroundColor: "#EEF1F5" }]}>
                <Text style={[os.avatarText, { color: C.SLATE, fontSize: 15 }]}>{initials(op.name)}</Text>
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[os.name, { fontSize: 14.5 }]} numberOfLines={1}>{op.name || "Unnamed"}</Text>
                <Text style={os.sub} numberOfLines={1}>{others.length ? `Runs ${others.join(", ")}` : "Not on any turf"}{op.status === "inactive" ? " · paused" : ""}</Text>
              </View>
              <TouchableOpacity style={os.addBtn} onPress={() => setPicked(p => [...p, op.id])}>
                <Text style={os.addText}>+ Add</Text>
              </TouchableOpacity>
            </View>
          );
        })}

        <Note text={`Removing someone here only takes them off ${turf.name || "this turf"}. Their other turfs and login stay as they are. To delete an operator's account, use Your team on the My Turfs list.`} />
      </ScrollView>

      <SaveBar dirty={dirty} saving={flow.saving} onDiscard={() => setPicked(base)} onSave={flow.requestSave} summary={`${picked.length} on this turf`} />
      <ConfirmSheet visible={flow.confirmOpen} icon="people-outline" iconBg="#F1F5F9" iconColor="#334155" subtitle={`${turf.name || "Turf"} · Operators`}
        changes={flow.changes} saving={flow.saving} note={picked.length === 0 ? "No one will be assigned to this turf after saving." : undefined}
        onCancel={() => flow.setConfirmOpen(false)} onConfirm={flow.confirm} />
    </View>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// STYLES
// ═════════════════════════════════════════════════════════════════════════════
const shadow = { shadowColor: C.INK, shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 2 }, elevation: 2 };
const lift = { shadowColor: C.INK, shadowOpacity: 0.1, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 1 };

// shared
const k = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.PAGE },
  body: { padding: 16, gap: 14 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: C.PAGE },
  loadText: { marginTop: 12, fontSize: 14.5, color: C.SLATE, fontWeight: "600" },
  header: { backgroundColor: C.BRAND, paddingHorizontal: 16, paddingBottom: 16, borderBottomLeftRadius: 22, borderBottomRightRadius: 22, flexDirection: "row", alignItems: "center", gap: 12 },
  backBtn: { width: 44, height: 44, borderRadius: 13, backgroundColor: "rgba(255,255,255,0.14)", alignItems: "center", justifyContent: "center" },
  kicker: { fontSize: 10.5, letterSpacing: 1.3, fontWeight: "800", color: C.ON_BRAND },
  title: { fontSize: 21, fontWeight: "900", color: "#fff" },
  sub: { fontSize: 12.5, fontWeight: "600", color: C.ON_BRAND, marginTop: 1 },
  card: { backgroundColor: C.CARD, borderRadius: 20, padding: 16, ...shadow },
  cardTitle: { fontSize: 15, fontWeight: "800", color: C.INK },
  cardSub: { fontSize: 12, fontWeight: "600", color: C.MUTE, marginTop: 2 },
  iconBox: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  tinyLabel: { fontSize: 10.5, letterSpacing: 0.8, fontWeight: "800", color: C.MUTE, marginBottom: 7 },
  sectionTitle: { fontSize: 12, fontWeight: "800", letterSpacing: 0.6, color: C.SLATE },
  choice: { flex: 1, height: 46, borderRadius: 13, borderWidth: 1, borderColor: C.LINE, backgroundColor: "#fff", alignItems: "center", justifyContent: "center", paddingHorizontal: 8 },
  choiceOn: { borderWidth: 1.5, borderColor: C.GREEN, backgroundColor: C.GREEN_L },
  choiceText: { fontSize: 13, fontWeight: "800" },
  note: { flexDirection: "row", gap: 9, borderRadius: 13, padding: 12, alignItems: "flex-start" },
  noteText: { flex: 1, fontSize: 12, fontWeight: "700", lineHeight: 17 },
  saveBar: { position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: "#fff", borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 16, paddingTop: 14, flexDirection: "row", alignItems: "center", gap: 10, shadowColor: C.INK, shadowOpacity: 0.12, shadowRadius: 20, shadowOffset: { width: 0, height: -4 }, elevation: 16 },
  saveState: { fontSize: 12, fontWeight: "800" },
  saveSummary: { fontSize: 11.5, fontWeight: "600", color: C.MUTE, marginTop: 1 },
  ghostBtn: { height: 48, paddingHorizontal: 16, borderRadius: 14, borderWidth: 1, borderColor: "#E2E8F0", backgroundColor: "#fff", alignItems: "center", justifyContent: "center" },
  ghostText: { fontSize: 14, fontWeight: "800", color: "#334155" },
  saveBtn: { height: 48, paddingHorizontal: 24, borderRadius: 14, backgroundColor: C.GREEN_D, alignItems: "center", justifyContent: "center" },
  saveText: { fontSize: 15, fontWeight: "800", color: "#fff" },
  backdrop: { flex: 1, backgroundColor: "rgba(11,18,32,0.55)" },
  sheet: { backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 16, paddingTop: 12, gap: 14 },
  grabber: { width: 40, height: 4, borderRadius: 2, backgroundColor: "#CBD5E1", alignSelf: "center" },
  sheetTitle: { fontSize: 18, fontWeight: "900", color: C.INK },
  changeList: { backgroundColor: C.SOFT, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 2 },
  changeRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 12 },
  changeRowLine: { borderBottomWidth: 1, borderBottomColor: C.LINE },
  changeLabel: { fontSize: 13.5, fontWeight: "800", color: C.INK },
  changeSub: { fontSize: 11.5, fontWeight: "600", color: C.MUTE, marginTop: 1 },
  fromText: { fontSize: 13, fontWeight: "700", color: C.MUTE, textDecorationLine: "line-through", maxWidth: 110 },
  toText: { fontSize: 14, fontWeight: "800", color: C.GREEN_D, maxWidth: 140, textAlign: "right" },
  newTag: { fontSize: 10.5, fontWeight: "800", color: C.GREEN_D, backgroundColor: C.GREEN_M, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, overflow: "hidden" },
  removedTag: { fontSize: 10.5, fontWeight: "800", color: C.RED_D, backgroundColor: C.RED_L, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, overflow: "hidden" },
});

// list
const ls = StyleSheet.create({
  header: { backgroundColor: C.BRAND, paddingHorizontal: 16, paddingBottom: 14, borderBottomLeftRadius: 22, borderBottomRightRadius: 22, gap: 10 },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  kicker: { fontSize: 10, letterSpacing: 1.4, fontWeight: "800", color: C.ON_BRAND },
  title: { fontSize: 20, fontWeight: "900", color: "#fff" },
  chipRow: { flexDirection: "row", gap: 6 },
  chip: { flex: 1, flexDirection: "row", alignItems: "baseline", justifyContent: "center", gap: 5, backgroundColor: C.INK, borderRadius: 10, paddingVertical: 7 },
  chipNum: { fontSize: 15, fontWeight: "900" },
  chipLabel: { fontSize: 11, fontWeight: "700", color: "#CBD5E1" },
  sectionRow: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", marginBottom: 12 },
  hint: { fontSize: 12, fontWeight: "700", color: C.MUTE },
  empty: { backgroundColor: C.CARD, borderRadius: 18, padding: 30, alignItems: "center", marginBottom: 14 },
  emptyTitle: { fontSize: 16, fontWeight: "800", color: "#374151", marginTop: 12 },
  emptySub: { fontSize: 13, color: C.MUTE, textAlign: "center", marginTop: 6, lineHeight: 19 },
  card: { backgroundColor: C.CARD, borderRadius: 20, marginBottom: 14, overflow: "hidden", ...shadow },
  cardTop: { flexDirection: "row", gap: 12, padding: 16, paddingBottom: 12 },
  avatar: { width: 48, height: 48, borderRadius: 15, backgroundColor: C.GREEN_L, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 17, fontWeight: "900", color: C.GREEN_D },
  nameRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  name: { fontSize: 17, fontWeight: "900", color: C.INK, flexShrink: 1 },
  meta: { fontSize: 12.5, fontWeight: "600", color: C.MUTE, marginTop: 3 },
  pill: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, maxWidth: 130 },
  pillText: { fontSize: 11, fontWeight: "800" },
  dot: { width: 7, height: 7, borderRadius: 4 },
  factRow: { flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingBottom: 12 },
  fact: { flex: 1, backgroundColor: C.SOFT, borderRadius: 12, paddingVertical: 9, paddingHorizontal: 10 },
  factLabel: { fontSize: 10, fontWeight: "800", color: C.MUTE, letterSpacing: 0.3 },
  factValue: { fontSize: 13, fontWeight: "800", color: C.INK, marginTop: 2 },
  nudge: { flexDirection: "row", alignItems: "center", gap: 10, marginHorizontal: 16, marginBottom: 14, borderRadius: 12, borderWidth: 1, paddingVertical: 10, paddingHorizontal: 12 },
  nudgeTip: { backgroundColor: C.AMBER_L, borderColor: "#FDE68A" },
  nudgeWarn: { backgroundColor: C.RED_L, borderColor: "#FECACA" },
  nudgeText: { flex: 1, fontSize: 12, fontWeight: "700", lineHeight: 16 },
  nudgeCta: { fontSize: 12.5, fontWeight: "900", textDecorationLine: "underline" },
  actionBar: { flexDirection: "row", borderTopWidth: 1, borderTopColor: "#EEF1F5" },
  actionBtn: { flex: 1, minHeight: 60, alignItems: "center", justifyContent: "center", gap: 5, paddingVertical: 10 },
  actionText: { fontSize: 11.5, fontWeight: "800" },
  teamRow: { flexDirection: "row", alignItems: "center", backgroundColor: C.CARD, borderRadius: 18, padding: 14, marginBottom: 10, ...shadow },
  teamAvatar: { width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  teamAvatarText: { fontSize: 15, fontWeight: "900" },
  teamName: { fontSize: 14.5, fontWeight: "800", color: C.INK },
  teamSub: { fontSize: 12, fontWeight: "600", color: C.MUTE, marginTop: 2 },
  teamState: { fontSize: 11, fontWeight: "800", marginRight: 4 },
  teamDelete: { width: 34, height: 34, borderRadius: 10, backgroundColor: C.RED_L, alignItems: "center", justifyContent: "center" },
});

// hub
const hs = StyleSheet.create({
  hint: { fontSize: 12, fontWeight: "700", color: C.MUTE },
  strip: { flexDirection: "row", height: 40, borderRadius: 11, overflow: "hidden", marginTop: 12, gap: 2 },
  axis: { fontSize: 10.5, fontWeight: "700", color: C.MUTE },
  grid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: 10 },
  tile: { width: "48.5%", minHeight: 122, backgroundColor: C.CARD, borderRadius: 18, padding: 14, gap: 10, ...shadow },
  tileDashed: { backgroundColor: C.AMBER_L, borderWidth: 1.5, borderStyle: "dashed", borderColor: "#FCD34D", shadowOpacity: 0, elevation: 0 },
  tileWarn: { backgroundColor: C.RED_L, borderWidth: 1.5, borderColor: "#FECACA", shadowOpacity: 0, elevation: 0 },
  tileTitle: { fontSize: 14.5, fontWeight: "800", color: C.INK },
  tileValue: { fontSize: 12, fontWeight: "600", color: C.MUTE, marginTop: 2, lineHeight: 16 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14 },
  statusDot: { width: 12, height: 12, borderRadius: 6 },
  link: { fontSize: 13, fontWeight: "800", color: C.GREEN_D },
});

// pricing
const ps = StyleSheet.create({
  rateBox: { flex: 1, borderRadius: 14, padding: 12 },
  rateLabel: { fontSize: 10.5, fontWeight: "800", flexShrink: 1 },
  bigInput: { flex: 1, fontSize: 26, fontWeight: "800", color: C.INK, padding: 0 },
  rupee: { fontWeight: "800", color: C.MUTE, fontSize: 15 },
  feeRow: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 12, backgroundColor: C.SOFT, borderRadius: 14, padding: 12 },
  feeTitle: { fontSize: 13, fontWeight: "800", color: C.INK },
  feeInputWrap: { flexDirection: "row", alignItems: "center", gap: 2, backgroundColor: "#fff", borderRadius: 11, paddingHorizontal: 12, height: 44, width: 96, ...lift },
  feeInput: { flex: 1, fontSize: 17, fontWeight: "800", color: C.INK, padding: 0 },
  seg: { flexDirection: "row", backgroundColor: C.PAGE, borderRadius: 13, padding: 4 },
  segBtn: { flex: 1, height: 40, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  segOn: { backgroundColor: "#fff", shadowColor: C.INK, shadowOpacity: 0.12, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 2 },
  segText: { fontSize: 13, fontWeight: "800" },
  timeline: { flexDirection: "row", height: 46, borderRadius: 12, overflow: "hidden", gap: 2 },
  axisRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 5 },
  axis: { fontSize: 10.5, fontWeight: "700", color: C.MUTE },
  coverage: { fontSize: 12, fontWeight: "800", marginTop: 8 },
  slot: { borderRadius: 14, borderWidth: 1.5, overflow: "hidden" },
  slotHead: { flexDirection: "row", alignItems: "center", gap: 10, padding: 13 },
  slotTitle: { fontSize: 13.5, fontWeight: "800", color: C.INK },
  slotRate: { fontSize: 15, fontWeight: "800", color: C.GREEN_D },
  stepper: { flexDirection: "row", alignItems: "center", backgroundColor: "#fff", borderRadius: 11, ...lift },
  stepBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  stepText: { fontSize: 18, color: C.GREEN_D },
  stepValue: { flex: 1, textAlign: "center", fontSize: 13, fontWeight: "800", color: C.INK },
  rateWrap: { flex: 1, flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#fff", borderRadius: 11, paddingHorizontal: 12, height: 46, ...lift },
  rateInput: { flex: 1, fontSize: 18, fontWeight: "800", color: C.INK, padding: 0 },
  delBtn: { width: 46, height: 46, borderRadius: 11, backgroundColor: "#FEE2E2", alignItems: "center", justifyContent: "center" },
  bump: { flex: 1, height: 36, borderRadius: 999, borderWidth: 1, borderColor: "#D7DDE5", backgroundColor: "#fff", alignItems: "center", justifyContent: "center" },
  bumpText: { fontSize: 12.5, fontWeight: "800", color: "#334155" },
  err: { backgroundColor: "#FEE2E2", borderRadius: 10, padding: 10 },
  errText: { fontSize: 12, fontWeight: "700", color: "#B91C1C" },
  addBtn: { flex: 1, height: 44, borderRadius: 999, borderWidth: 1.5, borderStyle: "dashed", borderColor: "#86EFAC", backgroundColor: C.GREEN_L, alignItems: "center", justifyContent: "center" },
  addText: { fontSize: 13, fontWeight: "800", color: C.GREEN_D },
  copyBtn: { flex: 1, height: 44, borderRadius: 999, borderWidth: 1, borderColor: "#D7DDE5", backgroundColor: "#fff", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  copyText: { fontSize: 13, fontWeight: "800", color: "#334155" },
  stat: { flex: 1, borderRadius: 16, padding: 14 },
  statValue: { fontSize: 20, fontWeight: "800", color: C.INK, marginTop: 1 },
  foot: { fontSize: 12, fontWeight: "600", color: C.MUTE, textAlign: "center" },
});

// hours
const hr = StyleSheet.create({
  timeBox: { flex: 1, backgroundColor: C.SOFT, borderRadius: 16, padding: 14 },
  timeLabel: { fontSize: 10.5, letterSpacing: 0.9, fontWeight: "800", color: C.MUTE },
  nextDay: { fontSize: 9.5, fontWeight: "800", color: "#fff", backgroundColor: C.PURPLE, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 3, overflow: "hidden" },
  timeValue: { fontSize: 26, fontWeight: "800", color: C.INK, marginTop: 4 },
  ampm: { fontSize: 13, fontWeight: "800", color: C.SLATE },
  roundBtn: { flex: 1, height: 44, borderRadius: 11, backgroundColor: "#fff", alignItems: "center", justifyContent: "center", ...lift },
  roundText: { fontSize: 20, color: C.INK },
  dayBar: { flexDirection: "row", height: 28, borderRadius: 8, overflow: "hidden", gap: 1, marginTop: 16 },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: 14, marginTop: 10 },
  legendText: { fontSize: 11.5, fontWeight: "700", color: C.SLATE },
  sum: { flex: 1, backgroundColor: C.GREEN_L, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12 },
  sumNum: { fontSize: 18, fontWeight: "800", color: C.GREEN_D },
  sumLabel: { fontSize: 11.5, fontWeight: "700", color: C.SLATE },
  cutGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  cutChoice: { flexGrow: 1, flexBasis: "30%" },
});

// booking style
const bs = StyleSheet.create({
  intro: { fontSize: 13, fontWeight: "600", color: C.SLATE, paddingHorizontal: 2 },
  onCard: { borderWidth: 1.5, borderColor: C.GREEN },
  preview: { backgroundColor: C.SOFT, borderRadius: 14, padding: 12, marginTop: 14 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { paddingHorizontal: 11, paddingVertical: 7, borderRadius: 9, backgroundColor: "#fff", borderWidth: 1, borderColor: C.LINE, fontSize: 12, fontWeight: "800", color: "#334155", overflow: "hidden" },
  chipOn: { backgroundColor: C.GREEN_D, borderColor: C.GREEN_D, color: "#fff" },
  previewFoot: { fontSize: 11.5, fontWeight: "700", color: C.SLATE, marginTop: 8 },
  slotChip: { flex: 1, textAlign: "center", paddingVertical: 9, borderRadius: 9, backgroundColor: "#fff", borderWidth: 1, borderColor: C.LINE, fontSize: 11.5, fontWeight: "800", color: "#334155", overflow: "hidden" },
  slotTaken: { backgroundColor: "#E6EAF0", borderColor: "#E6EAF0", color: C.MUTE, textDecorationLine: "line-through" },
});

// vcoin
const vs = StyleSheet.create({
  coin: { width: 56, height: 56, borderRadius: 28, backgroundColor: "#FDE68A", borderWidth: 3, borderColor: "#F59E0B", alignItems: "center", justifyContent: "center" },
  coinText: { fontSize: 22, fontWeight: "900", color: C.AMBER_D },
  toggleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 14, borderRadius: 13, paddingHorizontal: 12, paddingVertical: 8 },
  toggleText: { fontSize: 13.5, fontWeight: "800" },
  stepper: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: C.SOFT, borderRadius: 16, padding: 6, marginTop: 12 },
  stepBtn: { width: 56, height: 56, borderRadius: 12, backgroundColor: "#fff", alignItems: "center", justifyContent: "center", ...lift },
  stepText: { fontSize: 24, color: C.INK },
  bigInput: { fontSize: 32, fontWeight: "800", color: C.INK, textAlign: "center", padding: 0, minWidth: 80 },
  unit: { fontSize: 11.5, fontWeight: "700", color: C.MUTE },
  earn: { flex: 1, backgroundColor: C.AMBER_L, borderRadius: 14, padding: 12 },
  earnHrs: { fontSize: 11.5, fontWeight: "800", color: C.AMBER_D },
  earnCoins: { fontSize: 22, fontWeight: "800", color: C.INK, marginTop: 2 },
  earnWorth: { fontSize: 11, fontWeight: "700", color: C.MUTE },
});

// status
const ss = StyleSheet.create({
  preview: { backgroundColor: C.INK, borderRadius: 18, padding: 14, gap: 10 },
  pvName: { fontSize: 15, fontWeight: "800", color: "#fff" },
  pvMeta: { fontSize: 11.5, fontWeight: "600", color: "#CBD5E1", marginTop: 1 },
  pvPill: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#fff", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  pvPillText: { fontSize: 11.5, fontWeight: "800", color: C.INK },
  pvNote: { fontSize: 12, fontWeight: "600", color: "#E2E8F0", backgroundColor: "rgba(255,255,255,0.08)", borderRadius: 10, padding: 10, overflow: "hidden" },
  pvBlocked: { fontSize: 12, fontWeight: "800", color: "#FCA5A5" },
  dot: { width: 8, height: 8, borderRadius: 4 },
  option: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 60, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 14 },
  optDot: { width: 12, height: 12, borderRadius: 6 },
  optLabel: { fontSize: 14, fontWeight: "800", color: C.INK },
  optHint: { fontSize: 12, fontWeight: "600", color: C.MUTE, marginTop: 1 },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: "#CBD5E1" },
  radioOn: { borderWidth: 7, borderColor: C.GREEN_D },
  textarea: { backgroundColor: C.SOFT, borderRadius: 13, padding: 12, minHeight: 80, textAlignVertical: "top", fontSize: 14, color: C.INK, marginTop: 10 },
  ideas: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 10 },
  idea: { paddingHorizontal: 12, height: 36, justifyContent: "center", borderRadius: 999, borderWidth: 1, borderColor: "#D7DDE5", backgroundColor: "#fff" },
  ideaText: { fontSize: 12, fontWeight: "800", color: "#334155" },
});

// operators
const os = StyleSheet.create({
  sectionRow: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" },
  hint: { fontSize: 12.5, fontWeight: "700", color: C.MUTE },
  empty: { backgroundColor: C.RED_L, borderRadius: 16, padding: 16, alignItems: "center", gap: 8 },
  emptyText: { fontSize: 13, fontWeight: "700", color: C.RED_D, textAlign: "center" },
  avatar: { width: 50, height: 50, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 18, fontWeight: "900" },
  name: { fontSize: 16, fontWeight: "800", color: C.INK, flexShrink: 1 },
  sub: { fontSize: 12, fontWeight: "600", color: C.MUTE, marginTop: 1 },
  also: { fontSize: 11.5, fontWeight: "800", color: C.GREEN_D, marginTop: 2 },
  newTag: { fontSize: 10, fontWeight: "800", color: C.GREEN_D, backgroundColor: C.GREEN_M, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2, overflow: "hidden" },
  activeRow: { flexDirection: "row", alignItems: "center", marginTop: 14, borderRadius: 13, paddingHorizontal: 12, paddingVertical: 8 },
  activeTitle: { fontSize: 13.5, fontWeight: "800" },
  activeSub: { fontSize: 11.5, fontWeight: "600", color: C.SLATE },
  callBtn: { flex: 1, height: 46, borderRadius: 13, borderWidth: 1, borderColor: "#D7DDE5", backgroundColor: "#fff", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 },
  callText: { fontSize: 13, fontWeight: "800", color: C.INK },
  removeBtn: { flex: 1, height: 46, borderRadius: 13, backgroundColor: C.RED_L, alignItems: "center", justifyContent: "center" },
  removeText: { fontSize: 13, fontWeight: "800", color: "#B91C1C" },
  addRow: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: C.CARD, borderRadius: 18, padding: 14, ...shadow },
  addBtn: { height: 40, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1.5, borderColor: C.GREEN, backgroundColor: C.GREEN_L, justifyContent: "center" },
  addText: { fontSize: 13, fontWeight: "800", color: C.GREEN_D },
});
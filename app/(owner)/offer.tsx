/**
 * app/(owner)/offer.tsx — Owner Offers (v2)
 * • One screen for all turfs (optional ?turfId= pre-selects the filter)
 * • Create / edit in 2 steps: the deal + turfs → when it runs
 *   - special dates (calendar) or every week (days + start/end from calendar)
 *   - time windows incl. late night (11 PM – 3 AM)
 *   - limits: total uses, minimum booking, 1 per player / first booking only
 * • Everything is saved through the server (/create-offer, /update-offer,
 *   /delete-offer) — the server decides if an offer needs admin approval.
 * • Discount rule (Option A): comes off the TOTAL; player pays the normal
 *   advance online and pays less at the turf.
 */
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, ScrollView, StatusBar, RefreshControl,
  Alert, TextInput, Platform, KeyboardAvoidingView, BackHandler, Switch, Modal,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useLocalSearchParams, useNavigation } from "expo-router";
import { auth, db } from "../../firebaseConfig";
import { collection, getDocs, query, where } from "firebase/firestore";
import { Ionicons } from "@expo/vector-icons";

const SERVER_URL = "https://bookora-backend-95u4.onrender.com";
const SELF_SERVE_MAX_PERCENT = 25;
const SELF_SERVE_MAX_RUPEES = 300;

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
const SOFT = "#F5F7FA";
const GREEN_TINT = "#F0FDF4";
const GREEN_BORDER = "#BBF7D0";

const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON_FIRST = [1, 2, 3, 4, 5, 6, 0];
const NAME_IDEAS = ["Morning Rush", "Weekend Deal", "Late Night Deal", "Festival Special"];

// ── Types ───────────────────────────────────────────────────────────────────
type Offer = {
  id: string;
  title?: string; tag?: string;
  type?: "flat" | "percent"; value?: number; maxDiscount?: number; minBookingAmount?: number;
  turfIds?: string[]; turfId?: string; turfNames?: string[]; turfName?: string;
  scheduleType?: "weekly" | "dates"; specialDates?: string[]; allowedDays?: number[];
  validFromKey?: string; validToKey?: string; validFrom?: any; validTo?: any;
  targetSlots?: string[];
  totalUses?: number; perUserLimit?: number; firstBookingOnly?: boolean;
  usedCount?: number; discountGiven?: number;
  active?: boolean; status?: "approved" | "pending" | "rejected"; rejectionReason?: string;
  createdAt?: any;
};
type Turf = { id: string; name?: string; openingTime?: number; closingTime?: number; active?: boolean };
type Screen = "list" | "deal" | "when";
type Tab = "live" | "review" | "ended";
type Who = "all" | "one" | "first";
type Form = {
  title: string; tag: string;
  type: "percent" | "flat"; value: string; maxDiscount: string; minBooking: string; totalUses: string;
  who: Who; turfIds: string[];
  mode: "dates" | "weekly"; dates: string[]; days: number[]; from: string; to: string;
  windows: string[];
};

// ── Date helpers (keys are "YYYY-MM-DD", local = India) ─────────────────────
const p2 = (n: number) => String(n).padStart(2, "0");
const keyOf = (d: Date) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
const dateOfKey = (k: string) => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); };
const todayKey = () => keyOf(new Date());
const addDays = (k: string, n: number) => { const d = dateOfKey(k); d.setDate(d.getDate() + n); return keyOf(d); };
const shortKey = (k: string) => { const d = dateOfKey(k); return `${DAY_SHORT[d.getDay()]} ${d.getDate()} ${d.toLocaleDateString("en-US", { month: "short" })}`; };
const tinyKey = (k: string) => { const d = dateOfKey(k); return `${d.getDate()} ${d.toLocaleDateString("en-US", { month: "short" })}`; };
function tsKey(v: any): string | null {
  const d = v?.toDate ? v.toDate() : v ? new Date(v) : null;
  return d && !isNaN(d.getTime()) ? keyOf(d) : null;
}
const fromKeyOf = (o: Offer) => o.validFromKey || tsKey(o.validFrom) || "0000-00-00";
const toKeyOf = (o: Offer) => o.validToKey || tsKey(o.validTo) || "9999-12-31";

// ── Time helpers ────────────────────────────────────────────────────────────
function hLabel(h: number): string {
  const x = ((h % 24) + 24) % 24;
  const hr = Math.floor(x), m = Math.round((x % 1) * 60);
  return `${hr % 12 === 0 ? 12 : hr % 12}:${p2(m)} ${hr >= 12 ? "PM" : "AM"}`;
}
const windowStr = (a: number, b: number) => `${hLabel(a)} - ${hLabel(b)}`;
const niceWindow = (w: string) => w.replace(/:00/g, "").replace(" - ", " – ");
const PRESETS = [
  { key: "morning", label: "Morning", from: 6, to: 10 },
  { key: "afternoon", label: "Afternoon", from: 12, to: 16 },
  { key: "evening", label: "Evening", from: 17, to: 21 },
  { key: "late", label: "Late night", from: 23, to: 27 },
];

const rs = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const discLabel = (o: { type?: string; value?: number }) => (o.type === "flat" ? `₹${o.value ?? 0} OFF` : `${o.value ?? 0}% OFF`);
function withinSelfServe(type: string, value: number, cap: number) {
  if (type === "flat") return value <= SELF_SERVE_MAX_RUPEES;
  return value <= SELF_SERVE_MAX_PERCENT && cap > 0 && cap <= SELF_SERVE_MAX_RUPEES;
}

function offerState(o: Offer): Tab {
  if (o.status === "pending" || o.status === "rejected") return "review";
  const today = todayKey();
  if (o.scheduleType === "dates") {
    const dates = o.specialDates || [];
    return dates.some((d) => d >= today) ? "live" : "ended";
  }
  return toKeyOf(o) >= today ? "live" : "ended";
}
function whenText(o: Offer): string {
  if (o.scheduleType === "dates") {
    const d = (o.specialDates || []).slice().sort();
    if (!d.length) return "No dates";
    return d.length <= 3 ? `🎉 ${d.map(tinyKey).join(", ")}` : `🎉 ${tinyKey(d[0])} +${d.length - 1} dates`;
  }
  const days = o.allowedDays || [];
  const dayTxt = days.length === 0 || days.length === 7 ? "Every day" : MON_FIRST.filter((d) => days.includes(d)).map((d) => DAY_SHORT[d]).join(", ");
  return `${dayTxt} · till ${tinyKey(toKeyOf(o))}`;
}

const emptyForm = (turfIds: string[]): Form => ({
  title: "", tag: "", type: "percent", value: "20", maxDiscount: "", minBooking: "", totalUses: "",
  who: "all", turfIds, mode: "dates", dates: [], days: [], from: todayKey(), to: addDays(todayKey(), 30), windows: [],
});

// ═════════════════════════════════════════════════════════════════════════════
export default function OwnerOffers() {
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ turfId?: string }>();

  const [turfs, setTurfs] = useState<Turf[]>([]);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);

  const [screen, setScreen] = useState<Screen>("list");
  const [turfFilter, setTurfFilter] = useState<string>(params.turfId ? String(params.turfId) : "all");
  const [tab, setTab] = useState<Tab>("live");

  const [editing, setEditing] = useState<Offer | null>(null);
  const [form, setForm] = useState<Form>(emptyForm([]));
  const [calMonth, setCalMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [rangePick, setRangePick] = useState<"from" | "to" | null>(null);
  const [customFrom, setCustomFrom] = useState<number | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  // iPhone swipe-back only on the list; Android back steps inside the screen
  useEffect(() => { (navigation as any).setOptions?.({ gestureEnabled: screen === "list" }); }, [navigation, screen]);
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (rangePick) { setRangePick(null); return true; }
      if (screen === "when") { setScreen("deal"); return true; }
      if (screen === "deal") { confirmLeave(); return true; }
      return false;
    });
    return () => sub.remove();
  }, [screen, rangePick]);

  useEffect(() => { load(); }, []);

  const load = async (isRefresh = false) => {
    const uid = auth.currentUser?.uid;
    if (!uid) { setLoading(false); return; }
    isRefresh ? setRefreshing(true) : setLoading(true);
    try {
      const [tSnap, oSnap] = await Promise.all([
        getDocs(query(collection(db, "turfs"), where("ownerId", "==", uid))),
        getDocs(query(collection(db, "offers"), where("ownerId", "==", uid))),
      ]);
      setTurfs(tSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Turf)));
      const list = oSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Offer));
      list.sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
      setOffers(list);
    } catch {
      Alert.alert("Error", "Could not load offers. Pull down to try again.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const turfName = (id: string) => turfs.find((t) => t.id === id)?.name || "Turf";
  const offerTurfs = (o: Offer) => (o.turfIds && o.turfIds.length ? o.turfIds : o.turfId ? [o.turfId] : []);

  // ── Server calls ──
  const api = async (path: string, method: "POST" | "DELETE", body?: any) => {
    const token = await auth.currentUser?.getIdToken();
    if (!token) throw new Error("You are signed out. Please log in again.");
    const res = await fetch(`${SERVER_URL}${path}`, {
      method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: body ? JSON.stringify(body) : undefined,
    });
    let data: any = {};
    try { data = await res.json(); } catch {}
    if (!res.ok || !data.success) throw new Error(data.error || "Something went wrong. Please try again.");
    return data;
  };

  // ── List data ──
  const byTurf = useMemo(() => offers.filter((o) => turfFilter === "all" || offerTurfs(o).includes(turfFilter)), [offers, turfFilter]);
  const counts = useMemo(() => ({
    live: byTurf.filter((o) => offerState(o) === "live").length,
    review: byTurf.filter((o) => offerState(o) === "review").length,
    ended: byTurf.filter((o) => offerState(o) === "ended").length,
  }), [byTurf]);
  const shown = byTurf.filter((o) => offerState(o) === tab);
  const stats = useMemo(() => ({
    live: offers.filter((o) => offerState(o) === "live" && o.active !== false).length,
    used: offers.reduce((a, o) => a + Number(o.usedCount || 0), 0),
    given: offers.reduce((a, o) => a + Number(o.discountGiven || 0), 0),
  }), [offers]);

  // ── Open create / edit ──
  const openCreate = () => {
    const start = turfFilter !== "all" ? [turfFilter] : turfs.length === 1 ? [turfs[0].id] : [];
    setEditing(null);
    setForm(emptyForm(start));
    const d = new Date();
    setCalMonth(new Date(d.getFullYear(), d.getMonth(), 1));
    setCustomFrom(null);
    setScreen("deal");
  };
  const openEdit = (o: Offer) => {
    setEditing(o);
    const who: Who = o.firstBookingOnly ? "first" : Number(o.perUserLimit || 0) === 1 ? "one" : "all";
    const mode = o.scheduleType === "dates" ? "dates" : "weekly";
    setForm({
      title: o.title || "", tag: o.tag || "", type: (o.type as any) || "percent",
      value: String(o.value ?? ""), maxDiscount: o.type === "percent" && o.maxDiscount ? String(o.maxDiscount) : "",
      minBooking: o.minBookingAmount ? String(o.minBookingAmount) : "", totalUses: o.totalUses ? String(o.totalUses) : "",
      who, turfIds: offerTurfs(o),
      mode, dates: (o.specialDates || []).slice().sort(), days: o.allowedDays || [],
      from: mode === "weekly" ? fromKeyOf(o) : todayKey(), to: mode === "weekly" ? toKeyOf(o) : addDays(todayKey(), 30),
      windows: o.targetSlots || [],
    });
    const first = mode === "dates" && o.specialDates?.length ? dateOfKey(o.specialDates.slice().sort()[0]) : new Date();
    setCalMonth(new Date(first.getFullYear(), first.getMonth(), 1));
    setCustomFrom(null);
    setScreen("deal");
  };
  const confirmLeave = () => {
    Alert.alert(editing ? "Discard changes?" : "Discard this offer?", "Nothing will be saved.", [
      { text: "Keep editing", style: "cancel" },
      { text: "Discard", style: "destructive", onPress: () => setScreen("list") },
    ]);
  };

  // ── Toggle / delete ──
  const toggleActive = async (o: Offer) => {
    if (o.status !== "approved") return Alert.alert("Not live yet", "This offer can be switched on after it's approved.");
    const next = o.active === false;
    setOffers((prev) => prev.map((x) => (x.id === o.id ? { ...x, active: next } : x)));
    try { await api(`/update-offer/${o.id}`, "POST", { active: next }); }
    catch (e: any) {
      setOffers((prev) => prev.map((x) => (x.id === o.id ? { ...x, active: !next } : x)));
      Alert.alert("Error", e.message);
    }
  };
  const deleteOffer = (o: Offer) => {
    Alert.alert("Delete offer?", `"${o.title || "This offer"}" will stop applying right away. This can't be undone.`, [
      { text: "Keep", style: "cancel" },
      {
        text: "Delete", style: "destructive", onPress: async () => {
          setBusy(true);
          try { await api(`/delete-offer/${o.id}`, "DELETE"); setOffers((prev) => prev.filter((x) => x.id !== o.id)); }
          catch (e: any) { Alert.alert("Error", e.message); }
          finally { setBusy(false); }
        },
      },
    ]);
  };

  // ── Form helpers ──
  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));
  const valueNum = Number(form.value) || 0;
  const capNum = form.type === "percent" ? Number(form.maxDiscount) || SELF_SERVE_MAX_RUPEES : 0;
  const selfServe = valueNum > 0 && withinSelfServe(form.type, valueNum, capNum);
  const exampleSave = form.type === "percent" ? Math.min(Math.round(1600 * valueNum / 100), capNum || Infinity) : Math.min(valueNum, 1599);
  const discountText = form.type === "percent" ? `${valueNum || 0}% off` : `₹${valueNum || 0} off`;

  const validateDeal = (): string | null => {
    if (!form.title.trim()) return "Give the offer a name players will see.";
    if (form.title.trim().length > 60) return "Offer name must be 60 characters or less.";
    if (!valueNum || valueNum <= 0) return "Enter the discount.";
    if (form.type === "percent" && valueNum > 100) return "Percentage can't be more than 100.";
    if (!form.turfIds.length) return "Pick at least one turf.";
    return null;
  };
  const validateWhen = (): string | null => {
    if (form.mode === "dates" && !form.dates.length) return "Tap at least one date on the calendar.";
    if (form.mode === "weekly" && form.to < form.from) return "End date must be on or after the start date.";
    if (customFrom !== null) return "Finish your custom time (pick an end time) or tap Clear.";
    return null;
  };

  const goWhen = () => {
    const err = validateDeal();
    if (err) return Alert.alert("Not quite", err);
    setScreen("when");
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  };

  const publish = () => {
    const err = validateWhen();
    if (err) return Alert.alert("Not quite", err);
    const lines = [
      `${discountText}${form.type === "percent" ? ` (max ${rs(capNum)})` : ""}`,
      `Turfs: ${form.turfIds.map(turfName).join(", ")}`,
      form.mode === "dates" ? `Dates: ${form.dates.map(tinyKey).join(", ")}` : `Every ${form.days.length ? MON_FIRST.filter((d) => form.days.includes(d)).map((d) => DAY_SHORT[d]).join(", ") : "day"} · ${shortKey(form.from)} – ${shortKey(form.to)}`,
      `Time: ${form.windows.length ? form.windows.map(niceWindow).join(", ") : "All day"}`,
      selfServe ? "Goes live as soon as you save." : `Above ${SELF_SERVE_MAX_PERCENT}% / ₹${SELF_SERVE_MAX_RUPEES} — our team approves it first.`,
    ];
    Alert.alert(editing ? "Save changes?" : "Publish this offer?", lines.join("\n"), [
      { text: "Back", style: "cancel" },
      { text: editing ? "Save" : "Publish", onPress: save },
    ]);
  };

  const save = async () => {
    const body: any = {
      title: form.title.trim(), tag: form.tag.trim(),
      type: form.type, value: valueNum, maxDiscount: form.type === "percent" ? capNum : 0,
      minBookingAmount: Number(form.minBooking) || 0, totalUses: Number(form.totalUses) || 0,
      perUserLimit: form.who === "one" ? 1 : 0, firstBookingOnly: form.who === "first",
      turfIds: form.turfIds,
      scheduleType: form.mode,
      specialDates: form.mode === "dates" ? form.dates : [],
      allowedDays: form.mode === "weekly" ? form.days : [],
      validFrom: form.mode === "weekly" ? form.from : undefined,
      validTo: form.mode === "weekly" ? form.to : undefined,
      targetSlots: form.windows,
    };
    setBusy(true);
    try {
      const data = editing ? await api(`/update-offer/${editing.id}`, "POST", body) : await api("/create-offer", "POST", body);
      await load(true);
      setScreen("list");
      setTab(data.status === "approved" ? "live" : "review");
      Alert.alert(
        data.status === "approved" ? "Offer is live ✓" : "Sent for approval",
        data.status === "approved"
          ? `"${body.title}" now applies automatically on matching bookings.`
          : `"${body.title}" is above the self-serve limit, so our team checks it first. You'll get a notification when it's approved.`,
      );
    } catch (e: any) {
      Alert.alert("Couldn't save", e.message);
    } finally {
      setBusy(false);
    }
  };

  // ── Loading ──
  if (loading) {
    return (
      <View style={s.center}>
        <StatusBar barStyle="dark-content" />
        <ActivityIndicator size="large" color={ACCENT} />
        <Text style={s.loadTxt}>Loading offers…</Text>
      </View>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // LIST
  // ═══════════════════════════════════════════════════════════════════════════
  if (screen === "list") {
    return (
      <View style={s.root}>
        <StatusBar barStyle="light-content" backgroundColor={BRAND} />
        <View style={[s.header, { paddingTop: insets.top + 10 }]}>
          <View style={s.headerRow}>
            <TouchableOpacity style={s.hBtn} onPress={() => router.back()} accessibilityLabel="Back">
              <Ionicons name="arrow-back" size={20} color="#fff" />
            </TouchableOpacity>
            <View style={{ flex: 1 }}>
              <Text style={s.hKicker}>ALL YOUR TURFS</Text>
              <Text style={s.hTitle}>Offers</Text>
            </View>
          </View>
          <View style={s.statRow}>
            <View style={s.stat}><Text style={s.statNum}>{stats.live}</Text><Text style={s.statLbl}>live now</Text></View>
            <View style={s.stat}><Text style={s.statNum}>{stats.used}</Text><Text style={s.statLbl}>times used</Text></View>
            <View style={s.stat}><Text style={[s.statNum, { color: "#FDBA74" }]} numberOfLines={1} adjustsFontSizeToFit>{rs(stats.given)}</Text><Text style={s.statLbl}>players saved</Text></View>
          </View>
        </View>

        <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" automaticallyAdjustKeyboardInsets contentContainerStyle={{ padding: 14, gap: 10, paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={ACCENT} colors={[ACCENT]} />}>
          <TouchableOpacity style={s.newBtn} onPress={openCreate} activeOpacity={0.85} disabled={!turfs.length}>
            <Ionicons name="add-circle" size={20} color="#fff" />
            <Text style={s.newBtnTxt}>Create an offer</Text>
          </TouchableOpacity>

          {turfs.length > 1 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {[{ id: "all", name: "All turfs" }, ...turfs].map((t) => {
                const on = turfFilter === t.id;
                return (
                  <TouchableOpacity key={t.id} style={[s.chip, on && s.chipOn]} onPress={() => setTurfFilter(t.id)}>
                    <Text style={[s.chipTxt, on && { color: "#fff" }]} numberOfLines={1}>{t.name || "Turf"}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}

          <View style={s.tabs}>
            {([["live", "Live"], ["review", "Approval"], ["ended", "Ended"]] as [Tab, string][]).map(([k, l]) => {
              const on = tab === k;
              return (
                <TouchableOpacity key={k} style={[s.tab, on && s.tabOn]} onPress={() => setTab(k)} accessibilityState={{ selected: on }}>
                  <Text style={[s.tabTxt, on && { color: "#fff" }]}>{l}</Text>
                  <View style={[s.tabCount, on && { backgroundColor: "rgba(255,255,255,0.25)" }]}><Text style={[s.tabCountTxt, on && { color: "#fff" }]}>{counts[k]}</Text></View>
                </TouchableOpacity>
              );
            })}
          </View>

          {shown.length === 0 ? (
            <View style={s.empty}>
              <View style={s.emptyIcon}><Ionicons name="pricetag-outline" size={26} color={BRAND} /></View>
              <Text style={s.emptyTitle}>{tab === "live" ? "No live offers" : tab === "review" ? "Nothing waiting" : "No ended offers"}</Text>
              <Text style={s.emptySub}>{tab === "live" ? "Empty weekday mornings? Try 20% off 6–10 AM, Mon–Thu. Or a festival special on chosen dates." : "Offers show up here when they need approval or finish."}</Text>
            </View>
          ) : shown.map((o) => {
            const state = offerState(o);
            const live = state === "live" && o.active !== false && o.status === "approved";
            const st = o.status === "rejected" ? { l: "Not approved", bg: "#FEF2F2", fg: "#B91C1C" }
              : o.status === "pending" ? { l: "Awaiting approval", bg: "#FFFBEB", fg: "#B45309" }
              : state === "ended" ? { l: "Ended", bg: "#F1F5F9", fg: MUTED }
              : o.active === false ? { l: "Paused", bg: "#F1F5F9", fg: SLATE }
              : { l: "Live", bg: GREEN_TINT, fg: BRAND };
            const tIds = offerTurfs(o);
            const used = Number(o.usedCount || 0);
            return (
              <View key={o.id} style={[s.card, live && s.cardLive]}>
                <View style={s.rowC}>
                  <View style={[s.discBadge, { backgroundColor: live ? ACCENT : "#F1F5F9" }]}>
                    <Text style={[s.discTxt, { color: live ? "#fff" : SLATE }]}>{discLabel(o)}</Text>
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={s.cardTitle} numberOfLines={1}>{o.title || "Offer"}</Text>
                    <View style={[s.statePill, { backgroundColor: st.bg }]}><Text style={[s.statePillTxt, { color: st.fg }]}>{st.l}</Text></View>
                  </View>
                  {o.status === "approved" && state !== "ended" && (
                    <Switch value={o.active !== false} onValueChange={() => toggleActive(o)} trackColor={{ false: "#E5E7EB", true: "#22C55E" }} thumbColor="#fff" />
                  )}
                </View>
                {o.status === "rejected" && !!o.rejectionReason && (
                  <View style={s.reason}><Ionicons name="alert-circle-outline" size={14} color="#B91C1C" /><Text style={s.reasonTxt}>{o.rejectionReason}</Text></View>
                )}
                <View style={s.metaWrap}>
                  <Meta icon="business-outline" text={tIds.length > 1 ? `${tIds.length} turfs` : turfName(tIds[0] || "")} />
                  <Meta icon="calendar-outline" text={whenText(o)} />
                  <Meta icon="time-outline" text={o.targetSlots?.length ? o.targetSlots.map(niceWindow).join(", ") : "All day"} />
                  {o.type === "percent" && Number(o.maxDiscount) > 0 && <Meta icon="trending-down-outline" text={`Max ₹${o.maxDiscount}`} />}
                  {Number(o.minBookingAmount) > 0 && <Meta icon="wallet-outline" text={`Min ₹${o.minBookingAmount}`} />}
                  {o.firstBookingOnly && <Meta icon="sparkles-outline" text="First booking" />}
                  {Number(o.perUserLimit) === 1 && <Meta icon="person-outline" text="1 per player" />}
                </View>
                <View style={s.cardFoot}>
                  <Text style={s.usedTxt} numberOfLines={1}>
                    {used}{Number(o.totalUses) > 0 ? ` / ${o.totalUses}` : ""} used{Number(o.discountGiven) > 0 ? ` · ${rs(Number(o.discountGiven))} saved` : ""}
                  </Text>
                  <TouchableOpacity onPress={() => openEdit(o)} hitSlop={8} style={s.footBtn}><Text style={s.editTxt}>Edit</Text></TouchableOpacity>
                  <TouchableOpacity onPress={() => deleteOffer(o)} hitSlop={8} style={s.footBtn}><Text style={s.delTxt}>Delete</Text></TouchableOpacity>
                </View>
              </View>
            );
          })}
        </ScrollView>
        {busy && <Busy />}
      </View>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CREATE / EDIT (2 steps)
  // ═══════════════════════════════════════════════════════════════════════════
  const step = screen === "deal" ? 1 : 2;
  const today = todayKey();

  // calendar cells for dates mode / range picking
  const y = calMonth.getFullYear(), m = calMonth.getMonth();
  const lead = (new Date(y, m, 1).getDay() + 6) % 7;
  const total = new Date(y, m + 1, 0).getDate();
  const cells: (string | null)[] = Array(lead).fill(null);
  for (let n = 1; n <= total; n++) cells.push(keyOf(new Date(y, m, n)));
  while (cells.length % 7) cells.push(null);
  const canPrevMonth = keyOf(new Date(y, m, 0)) >= today;

  const toggleDate = (k: string) => set({ dates: form.dates.includes(k) ? form.dates.filter((x) => x !== k) : [...form.dates, k].sort() });
  const toggleWindow = (w: string) => set({ windows: form.windows.includes(w) ? form.windows.filter((x) => x !== w) : [...form.windows, w] });

  const summary = form.mode === "dates"
    ? `${form.dates.length ? form.dates.map(tinyKey).join(", ") : "No dates yet"}`
    : `Every ${form.days.length ? MON_FIRST.filter((d) => form.days.includes(d)).map((d) => DAY_SHORT[d]).join(", ") : "day"} · ${shortKey(form.from)} – ${shortKey(form.to)}`;

  return (
    <KeyboardAvoidingView style={s.root} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <StatusBar barStyle="light-content" backgroundColor={BRAND} />
      <View style={[s.header, { paddingTop: insets.top + 10 }]}>
        <View style={s.headerRow}>
          <TouchableOpacity style={s.hBtn} onPress={() => (step === 1 ? confirmLeave() : setScreen("deal"))} accessibilityLabel={step === 1 ? "Close" : "Back"}>
            <Ionicons name={step === 1 ? "close" : "arrow-back"} size={20} color="#fff" />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={s.hKicker}>{editing ? "EDIT OFFER" : "NEW OFFER"} · STEP {step} OF 2</Text>
            <Text style={s.hTitle}>{step === 1 ? "What's the deal?" : "When does it run?"}</Text>
          </View>
        </View>
        <View style={s.progress}>
          <View style={[s.progBar, { backgroundColor: "#fff" }]} />
          <View style={[s.progBar, { backgroundColor: step === 2 ? "#fff" : "rgba(255,255,255,0.3)" }]} />
        </View>
      </View>

      <ScrollView keyboardDismissMode="interactive" ref={scrollRef} contentContainerStyle={{ padding: 14, gap: 10, paddingBottom: 30 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {step === 1 ? (
          <>
            {/* Preview */}
            <Text style={s.kicker}>PLAYERS WILL SEE</Text>
            <View style={s.preview}>
              <View style={s.previewIcon}><Text style={{ fontSize: 22 }}>🎉</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={s.previewKicker}>{form.tag.trim() ? form.tag.trim().toUpperCase() : "TODAY'S SPECIAL"}</Text>
                <Text style={s.previewTitle} numberOfLines={1}>{form.title.trim() || "Your offer name"}</Text>
                <Text style={s.previewSub} numberOfLines={1}>{discountText} · {form.turfIds.length > 1 ? `${form.turfIds.length} turfs` : form.turfIds[0] ? turfName(form.turfIds[0]) : "pick a turf"} · applied automatically</Text>
              </View>
            </View>

            <View style={s.box}>
              <Text style={s.lbl}>Offer name</Text>
              <TextInput style={s.input} value={form.title} onChangeText={(v) => set({ title: v })} placeholder="e.g. Diwali Special" placeholderTextColor={FAINT} maxLength={60} />
              <View style={s.wrap}>
                {NAME_IDEAS.map((n) => (
                  <TouchableOpacity key={n} style={s.ideaChip} onPress={() => set({ title: n })}><Text style={s.ideaTxt}>{n}</Text></TouchableOpacity>
                ))}
              </View>
              <Text style={[s.lbl, { marginTop: 12 }]}>Small tag <Text style={s.optional}>(optional)</Text></Text>
              <TextInput style={s.input} value={form.tag} onChangeText={(v) => set({ tag: v })} placeholder="e.g. Diwali, Opening week" placeholderTextColor={FAINT} maxLength={24} />
            </View>

            <View style={s.box}>
              <Text style={s.lbl}>Discount</Text>
              <View style={s.row2}>
                {(["percent", "flat"] as const).map((tp) => {
                  const on = form.type === tp;
                  return (
                    <TouchableOpacity key={tp} style={[s.seg, on && s.segOn]} onPress={() => set({ type: tp, value: tp === "percent" ? "20" : "150" })}>
                      <Text style={[s.segTxt, on && { color: "#fff" }]}>{tp === "percent" ? "% Percentage" : "₹ Flat amount"}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <View style={[s.row2, { marginTop: 10 }]}>
                {(form.type === "percent" ? [10, 15, 20, 25, 30] : [50, 100, 150, 200, 300]).map((v) => {
                  const on = valueNum === v;
                  return (
                    <TouchableOpacity key={v} style={[s.valChip, on && s.valChipOn]} onPress={() => set({ value: String(v) })}>
                      <Text style={[s.valTxt, on && { color: "#fff" }]}>{form.type === "percent" ? `${v}%` : `₹${v}`}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <View style={s.inlineRow}>
                <Text style={s.inlineLbl}>{form.type === "percent" ? "Or type %" : "Or type ₹"}</Text>
                <TextInput style={s.smallInput} value={form.value} onChangeText={(v) => set({ value: v.replace(/[^0-9]/g, "") })} keyboardType="number-pad" maxLength={form.type === "percent" ? 3 : 5} />
              </View>
              {form.type === "percent" && (
                <View style={s.inlineRow}>
                  <Text style={s.inlineLbl}>Max discount per booking (₹)</Text>
                  <TextInput style={s.smallInput} value={form.maxDiscount} onChangeText={(v) => set({ maxDiscount: v.replace(/[^0-9]/g, "") })} placeholder={String(SELF_SERVE_MAX_RUPEES)} placeholderTextColor={FAINT} keyboardType="number-pad" maxLength={5} />
                </View>
              )}
              {valueNum > 0 && (
                <View style={[s.gate, selfServe ? s.gateOk : s.gateWarn]}>
                  <Ionicons name={selfServe ? "checkmark-circle" : "time-outline"} size={16} color={selfServe ? BRAND : "#B45309"} />
                  <Text style={[s.gateTxt, { color: selfServe ? BRAND : "#B45309" }]}>
                    {selfServe ? "Within your limit — goes live as soon as you save." : `Above ${SELF_SERVE_MAX_PERCENT}% / ₹${SELF_SERVE_MAX_RUPEES} — our team approves it first.`}
                  </Text>
                </View>
              )}
              {valueNum > 0 && (
                <Text style={s.example}>
                  Example: on a ₹1,600 booking the player saves <Text style={{ color: BRAND, fontWeight: "900" }}>{rs(exampleSave)}</Text>. They still pay the normal advance online and pay {rs(exampleSave)} less at the turf.
                </Text>
              )}
            </View>

            <View style={s.box}>
              <View style={s.rowC}>
                <Text style={[s.lbl, { flex: 1, marginBottom: 0 }]}>Which turfs?</Text>
                {turfs.length > 1 && (
                  <TouchableOpacity onPress={() => set({ turfIds: form.turfIds.length === turfs.length ? [] : turfs.map((t) => t.id) })} hitSlop={8}>
                    <Text style={s.link}>{form.turfIds.length === turfs.length ? "Clear" : "Select all"}</Text>
                  </TouchableOpacity>
                )}
              </View>
              {turfs.map((t) => {
                const on = form.turfIds.includes(t.id);
                const close = Number(t.closingTime ?? 23) || 24;
                return (
                  <TouchableOpacity key={t.id} style={[s.turfRow, on && s.turfRowOn]} onPress={() => set({ turfIds: on ? form.turfIds.filter((x) => x !== t.id) : [...form.turfIds, t.id] })} accessibilityState={{ checked: on }}>
                    <View style={[s.check, on && s.checkOn]}>{on && <Ionicons name="checkmark" size={15} color="#fff" />}</View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.turfName} numberOfLines={1}>{t.name || "Turf"}</Text>
                      <Text style={s.turfSub}>{t.active === false ? "Paused" : `${hLabel(Number(t.openingTime ?? 6))} – ${hLabel(close)}`}</Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={s.box}>
              <Text style={s.lbl}>Limits <Text style={s.optional}>(optional)</Text></Text>
              <View style={s.inlineRow}>
                <Text style={s.inlineLbl}>Total uses</Text>
                <TextInput style={s.smallInput} value={form.totalUses} onChangeText={(v) => set({ totalUses: v.replace(/[^0-9]/g, "") })} placeholder="Unlimited" placeholderTextColor={FAINT} keyboardType="number-pad" maxLength={5} onFocus={() => setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 250)} />
              </View>
              <View style={s.inlineRow}>
                <Text style={s.inlineLbl}>Minimum booking (₹)</Text>
                <TextInput style={s.smallInput} value={form.minBooking} onChangeText={(v) => set({ minBooking: v.replace(/[^0-9]/g, "") })} placeholder="None" placeholderTextColor={FAINT} keyboardType="number-pad" maxLength={6} onFocus={() => setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 250)} />
              </View>
              <View style={[s.row2, { marginTop: 10 }]}>
                {([["all", "Every booking"], ["one", "1 per player"], ["first", "First booking"]] as [Who, string][]).map(([k, l]) => {
                  const on = form.who === k;
                  return (
                    <TouchableOpacity key={k} style={[s.whoChip, on && s.segOn]} onPress={() => set({ who: k })}>
                      <Text style={[s.whoTxt, on && { color: "#fff" }]}>{l}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          </>
        ) : (
          <>
            <View style={s.row2}>
              {([["dates", "🎉", "Special dates", "Festivals, events"], ["weekly", "🔁", "Every week", "e.g. Mon–Thu mornings"]] as const).map(([k, ic, l, sub]) => {
                const on = form.mode === k;
                return (
                  <TouchableOpacity key={k} style={[s.modeCard, on && s.modeCardOn]} onPress={() => set({ mode: k })} accessibilityState={{ selected: on }}>
                    <Text style={{ fontSize: 20 }}>{ic}</Text>
                    <Text style={s.modeTitle}>{l}</Text>
                    <Text style={[s.modeSub, on && { color: BRAND }]}>{sub}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {form.mode === "dates" ? (
              <View style={s.box}>
                <MonthHead month={calMonth} onMonth={setCalMonth} canPrev={canPrevMonth} hint="Tap dates to add or remove" />
                <Grid cells={cells} render={(k) => {
                  const past = k < today;
                  const on = form.dates.includes(k);
                  return (
                    <TouchableOpacity disabled={past} onPress={() => toggleDate(k)} style={[s.dayCell, on && s.dayCellOn, past && { opacity: 0.3 }]}
                      accessibilityLabel={`${shortKey(k)}${on ? ", selected" : ""}`} accessibilityState={{ selected: on, disabled: past }}>
                      <Text style={[s.dayNum, on && { color: "#fff" }, k === today && !on && { color: BRAND }]}>{dateOfKey(k).getDate()}</Text>
                    </TouchableOpacity>
                  );
                }} />
                {form.dates.length > 0 && (
                  <View style={[s.wrap, { marginTop: 10 }]}>
                    {form.dates.map((k) => (
                      <TouchableOpacity key={k} style={s.datePill} onPress={() => toggleDate(k)} accessibilityLabel={`Remove ${shortKey(k)}`}>
                        <Text style={s.datePillTxt}>{shortKey(k)}</Text>
                        <Ionicons name="close" size={13} color={BRAND} />
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>
            ) : (
              <View style={s.box}>
                <Text style={s.lbl}>Days of the week <Text style={s.optional}>(none = every day)</Text></Text>
                <View style={s.row2}>
                  {MON_FIRST.map((d) => {
                    const on = form.days.includes(d);
                    return (
                      <TouchableOpacity key={d} style={[s.dayPill, on && s.dayPillOn]} onPress={() => set({ days: on ? form.days.filter((x) => x !== d) : [...form.days, d] })} accessibilityState={{ selected: on }}>
                        <Text style={[s.dayPillTxt, on && { color: "#fff" }]}>{DAY_SHORT[d].slice(0, 2)}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                <View style={[s.row2, { marginTop: 12 }]}>
                  {(["from", "to"] as const).map((k) => (
                    <TouchableOpacity key={k} style={s.rangeBtn} onPress={() => { const d = dateOfKey(form[k]); setCalMonth(new Date(d.getFullYear(), d.getMonth(), 1)); setRangePick(k); }}>
                      <Text style={s.rangeLbl}>{k === "from" ? "STARTS" : "ENDS"}</Text>
                      <View style={s.rowC}>
                        <Text style={s.rangeVal}>{shortKey(form[k])}</Text>
                        <Ionicons name="calendar-outline" size={15} color={BRAND} />
                      </View>
                    </TouchableOpacity>
                  ))}
                </View>
                <View style={[s.wrap, { marginTop: 8 }]}>
                  {([["1 week", 6], ["1 month", 29], ["3 months", 89]] as [string, number][]).map(([l, n]) => {
                    const on = form.to === addDays(form.from, n);
                    return (
                      <TouchableOpacity key={l} style={[s.ideaChip, on && { backgroundColor: INK, borderColor: INK }]} onPress={() => set({ to: addDays(form.from, n) })}>
                        <Text style={[s.ideaTxt, on && { color: "#fff" }]}>{l}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            )}

            <View style={s.box}>
              <Text style={s.lbl}>Time of day</Text>
              <View style={s.winGrid}>
                <TouchableOpacity style={[s.winCard, form.windows.length === 0 && s.winCardOn]} onPress={() => set({ windows: [] })}>
                  <Text style={[s.winTitle, form.windows.length === 0 && { color: BRAND }]}>All day</Text>
                  <Text style={s.winSub}>Whole opening hours</Text>
                </TouchableOpacity>
                {PRESETS.map((p) => {
                  const w = windowStr(p.from, p.to);
                  const on = form.windows.includes(w);
                  return (
                    <TouchableOpacity key={p.key} style={[s.winCard, on && s.winCardOn]} onPress={() => toggleWindow(w)} accessibilityState={{ selected: on }}>
                      <Text style={[s.winTitle, on && { color: BRAND }]}>{p.label}</Text>
                      <Text style={s.winSub}>{niceWindow(w)}</Text>
                    </TouchableOpacity>
                  );
                })}
                <TouchableOpacity style={[s.winCard, customFrom !== null && s.winCardOn]} onPress={() => setCustomFrom(customFrom === null ? 6 : null)}>
                  <Text style={[s.winTitle, customFrom !== null && { color: BRAND }]}>+ Custom</Text>
                  <Text style={s.winSub}>Pick from / to</Text>
                </TouchableOpacity>
              </View>

              {customFrom !== null && (
                <View style={s.customBox}>
                  <Text style={s.miniLbl}>From</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                    {Array.from({ length: 24 }, (_, h) => h).map((h) => (
                      <TouchableOpacity key={h} style={[s.hourChip, customFrom === h && s.hourChipOn]} onPress={() => setCustomFrom(h)}>
                        <Text style={[s.hourTxt, customFrom === h && { color: "#fff" }]}>{hLabel(h).replace(":00", "")}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                  <Text style={[s.miniLbl, { marginTop: 10 }]}>To</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                    {Array.from({ length: 12 }, (_, i) => customFrom + i + 1).map((h) => (
                      <TouchableOpacity key={h} style={s.hourChip} onPress={() => { toggleWindow(windowStr(customFrom, h)); setCustomFrom(null); }}>
                        <Text style={s.hourTxt}>{hLabel(h).replace(":00", "")}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                  <TouchableOpacity onPress={() => setCustomFrom(null)} style={{ alignSelf: "flex-start", marginTop: 8 }} hitSlop={8}>
                    <Text style={s.link}>Clear</Text>
                  </TouchableOpacity>
                </View>
              )}

              {form.windows.filter((w) => !PRESETS.some((p) => windowStr(p.from, p.to) === w)).length > 0 && (
                <View style={[s.wrap, { marginTop: 10 }]}>
                  {form.windows.filter((w) => !PRESETS.some((p) => windowStr(p.from, p.to) === w)).map((w) => (
                    <TouchableOpacity key={w} style={s.datePill} onPress={() => toggleWindow(w)} accessibilityLabel={`Remove ${w}`}>
                      <Text style={s.datePillTxt}>{niceWindow(w)}</Text>
                      <Ionicons name="close" size={13} color={BRAND} />
                    </TouchableOpacity>
                  ))}
                </View>
              )}
              <Text style={s.example}>Only the part of a booking inside these hours gets the discount. A 9–11 AM booking on a 6–10 AM offer gets it on 1 hour.</Text>
            </View>

            <View style={s.summary}>
              <Text style={[s.kicker, { color: FAINT }]}>SUMMARY</Text>
              <Text style={s.sumTitle} numberOfLines={2}>{form.title.trim() || "Offer"} · {discountText}{form.type === "percent" ? ` (max ${rs(capNum)})` : ""}</Text>
              <Text style={s.sumTxt}>{summary}</Text>
              <Text style={s.sumTxt}>{form.windows.length ? form.windows.map(niceWindow).join(", ") : "All day"} · {form.turfIds.map(turfName).join(", ")}</Text>
            </View>
          </>
        )}
      </ScrollView>

      {/* Bottom bar — outside the scroll so the keyboard never hides it */}
      <View style={[s.bar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        <TouchableOpacity style={s.ghostBtn} onPress={() => (step === 1 ? confirmLeave() : setScreen("deal"))}>
          <Text style={s.ghostTxt}>{step === 1 ? "Cancel" : "Back"}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[s.primaryBtn, busy && { opacity: 0.6 }]} disabled={busy} onPress={step === 1 ? goWhen : publish}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.primaryTxt}>{step === 1 ? "Next: when it runs →" : editing ? "Save changes" : "Publish offer"}</Text>}
        </TouchableOpacity>
      </View>

      {/* Start / end date picker */}
      <Modal visible={!!rangePick} transparent animationType="slide" onRequestClose={() => setRangePick(null)} statusBarTranslucent>
        <View style={s.backdrop}>
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => setRangePick(null)} />
          <View style={[s.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}>
            <View style={s.grabber} />
            <Text style={s.sheetTitle}>{rangePick === "from" ? "Offer starts on" : "Offer ends on"}</Text>
            <MonthHead month={calMonth} onMonth={setCalMonth} canPrev={rangePick === "to" ? keyOf(new Date(y, m, 0)) >= form.from : canPrevMonth} />
            <Grid cells={cells} render={(k) => {
              const min = rangePick === "to" ? form.from : today;
              const off = k < min;
              const sel = rangePick ? form[rangePick] === k : false;
              const inRange = k >= form.from && k <= form.to;
              return (
                <TouchableOpacity disabled={off} style={[s.dayCell, inRange && { backgroundColor: GREEN_TINT }, sel && s.dayCellOn, off && { opacity: 0.3 }]}
                  onPress={() => {
                    if (rangePick === "from") set({ from: k, to: form.to < k ? addDays(k, 29) : form.to });
                    else set({ to: k });
                    setRangePick(null);
                  }}>
                  <Text style={[s.dayNum, sel && { color: "#fff" }]}>{dateOfKey(k).getDate()}</Text>
                </TouchableOpacity>
              );
            }} />
          </View>
        </View>
      </Modal>
      {busy && <Busy />}
    </KeyboardAvoidingView>
  );
}

// ── Small pieces ────────────────────────────────────────────────────────────
function Meta({ icon, text }: { icon: string; text: string }) {
  return (
    <View style={s.meta}>
      <Ionicons name={icon as any} size={12} color={SLATE} />
      <Text style={s.metaTxt} numberOfLines={1}>{text}</Text>
    </View>
  );
}
function MonthHead({ month, onMonth, canPrev, hint }: { month: Date; onMonth: (d: Date) => void; canPrev: boolean; hint?: string }) {
  const y = month.getFullYear(), m = month.getMonth();
  return (
    <View style={s.calHead}>
      <TouchableOpacity style={[s.sqBtn, !canPrev && { opacity: 0.3 }]} disabled={!canPrev} onPress={() => onMonth(new Date(y, m - 1, 1))} accessibilityLabel="Previous month">
        <Ionicons name="chevron-back" size={18} color={INK} />
      </TouchableOpacity>
      <View style={{ alignItems: "center" }}>
        <Text style={s.calTitle}>{month.toLocaleDateString("en-US", { month: "long", year: "numeric" })}</Text>
        {!!hint && <Text style={s.calHint}>{hint}</Text>}
      </View>
      <TouchableOpacity style={s.sqBtn} onPress={() => onMonth(new Date(y, m + 1, 1))} accessibilityLabel="Next month">
        <Ionicons name="chevron-forward" size={18} color={INK} />
      </TouchableOpacity>
    </View>
  );
}
function Grid({ cells, render }: { cells: (string | null)[]; render: (k: string) => any }) {
  return (
    <View>
      <View style={s.grid}>{["M", "T", "W", "T", "F", "S", "S"].map((w, i) => <Text key={i} style={s.week}>{w}</Text>)}</View>
      <View style={s.grid}>
        {cells.map((k, i) => <View key={k || `b${i}`} style={s.cell}>{k ? render(k) : null}</View>)}
      </View>
    </View>
  );
}
function Busy() {
  return (
    <View style={s.busy}><View style={s.busyCard}><ActivityIndicator color={ACCENT} /><Text style={s.busyTxt}>Saving…</Text></View></View>
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
  hBtn: { width: 44, height: 44, borderRadius: 13, backgroundColor: "rgba(255,255,255,0.14)", alignItems: "center", justifyContent: "center" },
  hKicker: { fontSize: 10, letterSpacing: 1.4, fontWeight: "800", color: ON_BRAND },
  hTitle: { fontSize: 20, fontWeight: "900", color: "#fff" },
  statRow: { flexDirection: "row", gap: 8 },
  stat: { flex: 1, backgroundColor: INK, borderRadius: 12, paddingVertical: 8, paddingHorizontal: 10 },
  statNum: { fontSize: 16, fontWeight: "900", color: "#fff" },
  statLbl: { fontSize: 10.5, fontWeight: "700", color: FAINT },
  progress: { flexDirection: "row", gap: 6 },
  progBar: { flex: 1, height: 5, borderRadius: 3 },

  newBtn: { height: 52, borderRadius: 15, backgroundColor: BRAND, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  newBtnTxt: { color: "#fff", fontSize: 15, fontWeight: "800" },
  chip: { height: 36, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: LINE, backgroundColor: "#fff", justifyContent: "center", maxWidth: 180 },
  chipOn: { backgroundColor: INK, borderColor: INK },
  chipTxt: { fontSize: 12.5, fontWeight: "800", color: "#334155" },
  tabs: { flexDirection: "row", backgroundColor: "#E6EAF0", borderRadius: 14, padding: 4, gap: 2 },
  tab: { flex: 1, height: 40, borderRadius: 11, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5 },
  tabOn: { backgroundColor: BRAND },
  tabTxt: { fontSize: 12.5, fontWeight: "800", color: "#374151" },
  tabCount: { minWidth: 18, height: 18, paddingHorizontal: 4, borderRadius: 9, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" },
  tabCountTxt: { fontSize: 10.5, fontWeight: "900", color: INK },

  card: { backgroundColor: "#fff", borderRadius: 18, padding: 14, ...shadow },
  cardLive: { borderWidth: 1.5, borderColor: "#22C55E" },
  rowC: { flexDirection: "row", alignItems: "center", gap: 12 },
  discBadge: { paddingHorizontal: 11, paddingVertical: 9, borderRadius: 12 },
  discTxt: { fontSize: 13, fontWeight: "900" },
  cardTitle: { fontSize: 15, fontWeight: "900", color: INK },
  statePill: { alignSelf: "flex-start", marginTop: 4, paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999 },
  statePillTxt: { fontSize: 10.5, fontWeight: "800" },
  reason: { flexDirection: "row", gap: 6, backgroundColor: "#FEF2F2", borderRadius: 10, padding: 10, marginTop: 10 },
  reasonTxt: { flex: 1, color: "#B91C1C", fontSize: 12, fontWeight: "600" },
  metaWrap: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 12 },
  meta: { flexDirection: "row", alignItems: "center", gap: 5, height: 26, paddingHorizontal: 9, borderRadius: 8, backgroundColor: SOFT, borderWidth: 1, borderColor: "#E8ECF1", maxWidth: "100%" },
  metaTxt: { fontSize: 11, fontWeight: "700", color: SLATE, flexShrink: 1 },
  cardFoot: { flexDirection: "row", alignItems: "center", marginTop: 12, paddingTop: 8, borderTopWidth: 1, borderTopColor: "#EEF1F5" },
  usedTxt: { flex: 1, fontSize: 12, fontWeight: "700", color: MUTED },
  footBtn: { paddingHorizontal: 8, paddingVertical: 8 },
  editTxt: { fontSize: 13, fontWeight: "800", color: BRAND },
  delTxt: { fontSize: 13, fontWeight: "800", color: "#DC2626" },

  empty: { backgroundColor: "#fff", borderRadius: 18, padding: 28, alignItems: "center", gap: 8 },
  emptyIcon: { width: 56, height: 56, borderRadius: 18, backgroundColor: GREEN_TINT, alignItems: "center", justifyContent: "center" },
  emptyTitle: { fontSize: 15, fontWeight: "900", color: INK },
  emptySub: { fontSize: 13, color: MUTED, textAlign: "center", lineHeight: 19, fontWeight: "600" },

  kicker: { fontSize: 10.5, letterSpacing: 0.9, fontWeight: "800", color: MUTED, marginLeft: 2 },
  preview: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: ACCENT, borderRadius: 18, padding: 14 },
  previewIcon: { width: 50, height: 50, borderRadius: 14, backgroundColor: "rgba(255,255,255,0.18)", alignItems: "center", justifyContent: "center" },
  previewKicker: { fontSize: 10.5, fontWeight: "800", letterSpacing: 0.8, color: ON_BRAND },
  previewTitle: { fontSize: 17, fontWeight: "900", color: "#fff" },
  previewSub: { fontSize: 12, fontWeight: "700", color: ON_BRAND },

  box: { backgroundColor: "#fff", borderRadius: 18, padding: 14, ...shadow },
  lbl: { fontSize: 12.5, fontWeight: "800", color: INK, marginBottom: 6 },
  optional: { color: FAINT, fontWeight: "700" },
  input: { height: 48, borderRadius: 12, backgroundColor: SOFT, borderWidth: 1, borderColor: "#E8ECF1", paddingHorizontal: 14, fontSize: 15, fontWeight: "700", color: INK },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
  ideaChip: { height: 32, paddingHorizontal: 11, borderRadius: 999, borderWidth: 1, borderColor: LINE, backgroundColor: "#fff", justifyContent: "center" },
  ideaTxt: { fontSize: 11.5, fontWeight: "800", color: "#334155" },
  row2: { flexDirection: "row", gap: 8 },
  seg: { flex: 1, height: 44, borderRadius: 12, borderWidth: 1, borderColor: "#E8ECF1", backgroundColor: SOFT, alignItems: "center", justifyContent: "center" },
  segOn: { backgroundColor: INK, borderColor: INK },
  segTxt: { fontSize: 13, fontWeight: "800", color: SLATE },
  valChip: { flex: 1, height: 44, borderRadius: 12, borderWidth: 1, borderColor: "#E8ECF1", backgroundColor: "#fff", alignItems: "center", justifyContent: "center" },
  valChipOn: { backgroundColor: ACCENT, borderColor: ACCENT },
  valTxt: { fontSize: 14, fontWeight: "900", color: INK },
  inlineRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 12 },
  inlineLbl: { flex: 1, fontSize: 13, fontWeight: "700", color: "#334155" },
  smallInput: { width: 116, height: 42, borderRadius: 11, backgroundColor: SOFT, borderWidth: 1, borderColor: "#E8ECF1", textAlign: "center", fontSize: 14, fontWeight: "800", color: INK },
  gate: { flexDirection: "row", gap: 8, alignItems: "flex-start", borderRadius: 12, padding: 11, marginTop: 12, borderWidth: 1 },
  gateOk: { backgroundColor: GREEN_TINT, borderColor: GREEN_BORDER },
  gateWarn: { backgroundColor: "#FFFBEB", borderColor: "#FDE68A" },
  gateTxt: { flex: 1, fontSize: 12, fontWeight: "700", lineHeight: 17 },
  example: { marginTop: 10, backgroundColor: SOFT, borderRadius: 12, padding: 11, fontSize: 12, fontWeight: "600", color: SLATE, lineHeight: 18 },
  link: { fontSize: 12.5, fontWeight: "800", color: BRAND },
  turfRow: { flexDirection: "row", alignItems: "center", gap: 12, padding: 11, borderRadius: 13, borderWidth: 1, borderColor: "#E8ECF1", marginTop: 8 },
  turfRowOn: { borderColor: ACCENT, borderWidth: 1.5, backgroundColor: GREEN_TINT },
  check: { width: 24, height: 24, borderRadius: 7, borderWidth: 1.5, borderColor: "#CBD5E1", alignItems: "center", justifyContent: "center", backgroundColor: "#fff" },
  checkOn: { backgroundColor: ACCENT, borderColor: ACCENT },
  turfName: { fontSize: 14, fontWeight: "900", color: INK },
  turfSub: { fontSize: 11.5, fontWeight: "600", color: MUTED },
  whoChip: { flex: 1, height: 40, borderRadius: 11, borderWidth: 1, borderColor: "#E8ECF1", backgroundColor: "#fff", alignItems: "center", justifyContent: "center" },
  whoTxt: { fontSize: 11.5, fontWeight: "800", color: SLATE },

  modeCard: { flex: 1, minHeight: 92, borderRadius: 16, borderWidth: 1, borderColor: LINE, backgroundColor: "#fff", padding: 12, justifyContent: "center" },
  modeCardOn: { borderWidth: 2, borderColor: ACCENT, backgroundColor: GREEN_TINT },
  modeTitle: { fontSize: 14, fontWeight: "900", color: INK, marginTop: 4 },
  modeSub: { fontSize: 11.5, fontWeight: "700", color: MUTED },
  calHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 },
  calTitle: { fontSize: 15, fontWeight: "900", color: INK },
  calHint: { fontSize: 11.5, fontWeight: "700", color: MUTED },
  sqBtn: { width: 40, height: 40, borderRadius: 12, borderWidth: 1, borderColor: LINE, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  week: { width: "14.2857%", textAlign: "center", fontSize: 11, fontWeight: "800", color: MUTED, paddingVertical: 4 },
  cell: { width: "14.2857%", height: 46, alignItems: "center", justifyContent: "center" },
  dayCell: { width: 42, height: 42, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  dayCellOn: { backgroundColor: ACCENT },
  dayNum: { fontSize: 14, fontWeight: "800", color: INK },
  datePill: { flexDirection: "row", alignItems: "center", gap: 6, height: 32, paddingHorizontal: 10, borderRadius: 999, backgroundColor: GREEN_TINT, borderWidth: 1, borderColor: GREEN_BORDER },
  datePillTxt: { fontSize: 12, fontWeight: "800", color: BRAND },
  dayPill: { flex: 1, height: 42, borderRadius: 11, borderWidth: 1, borderColor: LINE, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" },
  dayPillOn: { backgroundColor: ACCENT, borderColor: ACCENT },
  dayPillTxt: { fontSize: 12.5, fontWeight: "800", color: "#334155" },
  rangeBtn: { flex: 1, height: 60, borderRadius: 13, borderWidth: 1, borderColor: GREEN_BORDER, backgroundColor: GREEN_TINT, paddingHorizontal: 12, justifyContent: "center" },
  rangeLbl: { fontSize: 10.5, fontWeight: "800", color: BRAND, letterSpacing: 0.6 },
  rangeVal: { flex: 1, fontSize: 14, fontWeight: "900", color: INK },
  winGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  winCard: { width: "48%", flexGrow: 1, minHeight: 56, borderRadius: 13, borderWidth: 1, borderColor: LINE, backgroundColor: "#fff", paddingHorizontal: 12, justifyContent: "center" },
  winCardOn: { borderWidth: 1.5, borderColor: ACCENT, backgroundColor: GREEN_TINT },
  winTitle: { fontSize: 13, fontWeight: "800", color: INK },
  winSub: { fontSize: 11, fontWeight: "700", color: MUTED },
  customBox: { marginTop: 10, backgroundColor: SOFT, borderRadius: 13, padding: 11 },
  miniLbl: { fontSize: 11, fontWeight: "800", color: SLATE, marginBottom: 6 },
  hourChip: { height: 36, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: LINE, backgroundColor: "#fff", justifyContent: "center" },
  hourChipOn: { backgroundColor: INK, borderColor: INK },
  hourTxt: { fontSize: 12, fontWeight: "800", color: "#334155" },
  summary: { backgroundColor: INK, borderRadius: 18, padding: 14, gap: 3 },
  sumTitle: { fontSize: 15, fontWeight: "900", color: "#fff" },
  sumTxt: { fontSize: 12.5, fontWeight: "600", color: "#CBD5E1", lineHeight: 18 },

  bar: { flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingTop: 12, backgroundColor: "#fff", borderTopWidth: 1, borderTopColor: "#E8ECF1" },
  ghostBtn: { flex: 1, height: 50, borderRadius: 14, backgroundColor: "#F1F5F9", alignItems: "center", justifyContent: "center" },
  ghostTxt: { fontSize: 14, fontWeight: "800", color: "#334155" },
  primaryBtn: { flex: 1.6, height: 50, borderRadius: 14, backgroundColor: BRAND, alignItems: "center", justifyContent: "center" },
  primaryTxt: { fontSize: 14.5, fontWeight: "800", color: "#fff" },

  backdrop: { flex: 1, backgroundColor: "rgba(11,18,32,0.55)" },
  sheet: { backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 16, paddingTop: 10, gap: 10 },
  grabber: { width: 40, height: 4, borderRadius: 2, backgroundColor: "#CBD5E1", alignSelf: "center" },
  sheetTitle: { fontSize: 17, fontWeight: "900", color: INK },

  busy: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: "rgba(17,24,39,0.30)", alignItems: "center", justifyContent: "center" },
  busyCard: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#fff", paddingHorizontal: 18, paddingVertical: 14, borderRadius: 14 },
  busyTxt: { fontSize: 13, fontWeight: "800", color: INK },
});
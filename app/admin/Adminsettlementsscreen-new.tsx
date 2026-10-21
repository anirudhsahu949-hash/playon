import {
  View,
  Text,
  StyleSheet,
  StatusBar,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Modal,
  TextInput,
  Platform,
  KeyboardAvoidingView,
  Alert,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "expo-router";
import { auth, db } from "../../firebaseConfig"; // adjust path to match your project structure
import { Ionicons } from "@expo/vector-icons";
import {
  DailySettlement,
  Turf,
  fetchTurfs,
  fetchBookingsFor,
  fetchSettlementRecords,
  buildDailySettlements,
  markSettlementPaid,
  fmtFull,
   fmtAmountWithVcoin, 
  fmtDateDisplay,
  fmtTurfHours,
  dateKeyOf,   // NEW — used to isolate "today"'s turf-days for the snapshot card
  toMidnight,  // NEW — used for the date-range filter chips
} from "../../Settlementhelpers"; // adjust path to wherever you place settlementHelpers.ts

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN · SETTLEMENTS
//
// This is where YOU (the platform admin) see every turf's daily online
// collections across ALL owners, and mark a day as "Paid" once you've
// transferred that turf's money to the owner's bank account.
//
// ── Admin access check ────────────────────────────────────────────────────
// This assumes an `admins` Firestore collection, doc id = the admin's uid,
// e.g. admins/{uid} = { role: "admin" }. Adjust `checkIsAdmin` below to match
// however you actually gate admin access (custom claims, a `role` field on
// the user doc, a hardcoded email allowlist, etc).
//
// FIX — PCoin vs VCoin payout split:
// `item.amount` / `selected.amount` is the raw online charge — it already
// has BOTH PCoin and VCoin subtracted, because that's literally what hit
// Razorpay. VCoin is the owner's own reward program, so that's correctly
// their cost. PCoin is supposed to be funded by the PLATFORM, not the owner
// — so the owner needs that amount added back before you pay them, or every
// PCoin booking quietly short-changes them. `selected.payoutAmount` (from
// Settlementhelpers.ts) is `amount + pcoinUsed` — THIS is what actually gets
// sent to /mark-settlement-paid below, and what's shown as the headline
// figure everywhere in this screen. `amount` is still shown in the modal
// breakdown for transparency, just no longer used as the number you pay.
// ─────────────────────────────────────────────────────────────────────────────

const DARK  = "#0A0F1E";
const GREEN = "#22C55E";
const AMBER = "#F59E0B";

// NOTE: No admin check needed here — app/(admin)/_layout.tsx already gates
// every screen in this Drawer. By the time this component renders, the
// user's role has already been confirmed to be admin (not owner/turf-operator/user).

type FilterTab = "pending" | "paid" | "all";

// ── Date range presets for the settlement list below ────────────────────────
// days: -1 = "All time" (no restriction — keeps the original screen behavior
// as the default so nothing that already relied on seeing all pending
// payouts silently disappears).
const DATE_PRESETS: { label: string; days: number }[] = [
  { label: "Today",        days: 1  },
  { label: "Last 7 days",  days: 7  },
  { label: "Last 30 days", days: 30 },
  { label: "All time",     days: -1 },
];

export default function AdminSettlementsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [turfs, setTurfs]     = useState<Turf[]>([]);
  const [history, setHistory] = useState<DailySettlement[]>([]);

  const [tab, setTab] = useState<FilterTab>("pending");
  const [selected, setSelected] = useState<DailySettlement | null>(null);
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // NEW — date range + turf filters for the settlement list below.
  // "All time" keeps the original unrestricted view as the default.
  const [datePreset, setDatePreset] = useState<string>("All time");
  const [turfFilter, setTurfFilter] = useState<string>("all"); // turfId, or "all"
  const [turfPickerOpen, setTurfPickerOpen] = useState(false);
  const [turfSearch, setTurfSearch] = useState("");

  useEffect(() => {
    fetchAll();
  }, []);

  const fetchAll = async (isRefresh = false) => {
    isRefresh ? setRefreshing(true) : setLoading(true);
    try {
      // No ownerId filter here — admin sees every turf across every owner.
      const [turfList, bookings, paidRecords] = await Promise.all([
        fetchTurfs(),
        fetchBookingsFor(),
        fetchSettlementRecords(),
      ]);
      setTurfs(turfList);
      setHistory(buildDailySettlements(bookings, turfList, paidRecords));
    } catch (e) {
      console.log(e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  // NEW — "Today" snapshot: always Today's numbers, regardless of whatever
  // date/turf filters are active below. This is what answers "how much
  // PCoin did the platform give away today" and "what did today collect" at
  // a glance, without needing to touch any filter first.
  const todayStats = useMemo(() => {
    const todayKey = dateKeyOf(new Date());
    const todays = history.filter((h) => h.dateKey === todayKey);
    return {
      onlineCollected: todays.reduce((s, h) => s + h.amount, 0),
      pcoinUsed:        todays.reduce((s, h) => s + h.pcoinUsed, 0),
      vcoinUsed:        todays.reduce((s, h) => s + h.vcoinUsed, 0),
      payoutDue:        todays.reduce((s, h) => s + h.payoutAmount, 0),
      turfDayCount:     todays.length,
    };
  }, [history]);

  // NEW — turf list to show in the filter picker, limited to turfs that
  // actually have settlement history (no point listing a turf with zero
  // bookings ever). Falls back to every turf if none have history yet.
  const turfsWithHistory = useMemo(() => {
    const idsWithHistory = new Set(history.map((h) => h.turfId));
    const withHistory = turfs.filter((t) => idsWithHistory.has(t.id));
    return withHistory.length > 0 ? withHistory : turfs;
  }, [turfs, history]);

  // NEW — history scoped by the active date-range preset + turf filter,
  // BEFORE the status tab (Pending/Paid/All) is applied. Both the list and
  // the headline totals below derive from this, so the numbers on screen
  // always match what's actually shown in the list.
  const dateFilteredHistory = useMemo(() => {
    let scoped = history;

    if (turfFilter !== "all") {
      scoped = scoped.filter((h) => h.turfId === turfFilter);
    }

    const preset = DATE_PRESETS.find((p) => p.label === datePreset);
    if (preset && preset.days > 0) {
      const end = new Date(); end.setHours(23, 59, 59, 999);
      const start = new Date();
      start.setDate(start.getDate() - (preset.days - 1));
      start.setHours(0, 0, 0, 0);
      scoped = scoped.filter((h) => h.date >= toMidnight(start) && h.date <= end);
    }
    // preset.days === -1 ("All time") → no date restriction at all.

    return scoped;
  }, [history, turfFilter, datePreset]);

  const filteredList = useMemo(() => {
    if (tab === "all") return dateFilteredHistory;
    return dateFilteredHistory.filter((h) => h.status === tab);
  }, [dateFilteredHistory, tab]);

  const totals = useMemo(() => {
    // Sum payoutAmount (what owners actually receive), not the raw
    // online-collected amount, so these headline totals match what you'll
    // actually transfer/have transferred. Scoped to the active date +
    // turf filters (NOT the status tab, since these two numbers ARE the
    // pending/paid split).
    const pending = dateFilteredHistory.filter((h) => h.status === "pending").reduce((s, h) => s + h.payoutAmount, 0);
    const paid    = dateFilteredHistory.filter((h) => h.status === "paid").reduce((s, h) => s + h.payoutAmount, 0);
    const pendingCount = dateFilteredHistory.filter((h) => h.status === "pending").length;
    return { pending, paid, pendingCount };
  }, [dateFilteredHistory]);

  const openMarkPaid = (item: DailySettlement) => {
    setSelected(item);
    setReference("");
    setNote("");
  };

  const confirmMarkPaid = async () => {
    if (!selected) return;
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    setSubmitting(true);
    try {
      await markSettlementPaid({
        key: selected.key,
        turfId: selected.turfId,
        turfName: selected.turfName,
        ownerId: selected.ownerId,
        dateKey: selected.dateKey,
        date: selected.date,
        // 🔒 FIX: was `selected.amount` — that's the raw online charge, which
        // under-pays owners by the PCoin amount on any booking that used it.
        // `payoutAmount` = amount + pcoinUsed (platform-funded top-up).
        amount: selected.payoutAmount,
        bookingIds: selected.bookingIds,
        paidBy: uid,
        reference: reference.trim() || undefined,
        note: note.trim() || undefined,
      });
      setSelected(null);
      await fetchAll(true);
    } catch (e) {
      console.log(e);
      Alert.alert("Failed to mark as paid", "Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={s.loadWrap}>
        <StatusBar barStyle="light-content" backgroundColor={DARK} />
        <ActivityIndicator size="large" color={GREEN} />
        <Text style={s.loadText}>Loading settlements...</Text>
      </SafeAreaView>
    );
  }

  return (
    <View style={s.safe}>
      <StatusBar barStyle="light-content" backgroundColor={DARK} />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={s.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => fetchAll(true)} tintColor={GREEN} />}
      >
        {/* ── Hero ── */}
        <View style={[s.hero, { paddingTop: insets.top + 12 }]}>
          <View style={s.glow1} /><View style={s.glow2} />
          <View style={s.heroTop}>
            <TouchableOpacity style={s.backBtn} onPress={() => router.back()}>
              <Ionicons name="arrow-back" size={20} color="#fff" />
            </TouchableOpacity>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={s.heroTag}>ADMIN · PAYOUTS</Text>
              <Text style={s.heroTitle}>Owner Settlements</Text>
            </View>
          </View>

          {/* ── Today snapshot — always Today, regardless of filters below ── */}
          <View style={s.todayCard}>
            <View style={s.todayCardHeader}>
              <Ionicons name="today-outline" size={13} color="#D1D5DB" />
              <Text style={s.todayCardTitle}>TODAY ACROSS ALL TURFS</Text>
            </View>
            <View style={s.todayStatsRow}>
              <View style={s.todayStat}>
                <Text style={s.todayStatValue}>{fmtFull(todayStats.onlineCollected)}</Text>
                <Text style={s.todayStatLabel}>Online collected</Text>
              </View>
              <View style={s.todayStatDivider} />
              <View style={s.todayStat}>
                <Text style={[s.todayStatValue, { color: "#C4B5FD" }]}>🪙 {todayStats.pcoinUsed}</Text>
                <Text style={s.todayStatLabel}>PCoin used (platform cost)</Text>
              </View>
              <View style={s.todayStatDivider} />
              <View style={s.todayStat}>
                <Text style={s.todayStatValue}>{fmtFull(todayStats.payoutDue)}</Text>
                <Text style={s.todayStatLabel}>Owed for today's bookings</Text>
              </View>
            </View>
            {todayStats.turfDayCount > 0 && (
              <Text style={s.todayCardSub}>
                {todayStats.turfDayCount} turf-day{todayStats.turfDayCount !== 1 ? "s" : ""} active today
                {todayStats.vcoinUsed > 0 ? ` · 🪙 ${todayStats.vcoinUsed} VCoin used (owners' cost)` : ""}
              </Text>
            )}
          </View>

          <View style={s.feeRow}>
            <View style={[s.feeBox, { backgroundColor: "rgba(245,158,11,0.14)", borderColor: "rgba(245,158,11,0.3)" }]}>
              <Text style={s.feeLabel}>Awaiting Payout {datePreset !== "All time" || turfFilter !== "all" ? "(filtered)" : ""}</Text>
              <Text style={[s.feeValue, { color: AMBER }]}>{fmtFull(totals.pending)}</Text>
              <Text style={s.feeSub}>{totals.pendingCount} turf-day{totals.pendingCount !== 1 ? "s" : ""}</Text>
            </View>
            <View style={[s.feeBox, s.feeBoxGreen]}>
              <Text style={s.feeLabel}>Already Paid {datePreset !== "All time" || turfFilter !== "all" ? "(filtered)" : ""}</Text>
              <Text style={[s.feeValue, { color: GREEN }]}>{fmtFull(totals.paid)}</Text>
            </View>
          </View>
        </View>

        {/* ── Date range + turf filters ── */}
        <View style={s.filterSection}>
          <View style={s.filterChipRow}>
            {DATE_PRESETS.map((p) => {
              const active = datePreset === p.label;
              return (
                <TouchableOpacity
                  key={p.label}
                  style={[s.filterChip, active && s.filterChipActive]}
                  onPress={() => setDatePreset(p.label)}
                  activeOpacity={0.85}
                >
                  <Text style={[s.filterChipText, active && s.filterChipTextActive]}>{p.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <TouchableOpacity
            style={s.turfFilterBtn}
            onPress={() => { setTurfSearch(""); setTurfPickerOpen(true); }}
            activeOpacity={0.85}
          >
            <Ionicons name="location-outline" size={14} color="#374151" />
            <Text style={s.turfFilterBtnText} numberOfLines={1}>
              {turfFilter === "all"
                ? "All Turfs"
                : (turfsWithHistory.find((t) => t.id === turfFilter)?.name || "Selected Turf")}
            </Text>
            <Ionicons name="chevron-down" size={14} color="#9CA3AF" />
          </TouchableOpacity>

          {(datePreset !== "All time" || turfFilter !== "all") && (
            <TouchableOpacity
              style={s.resetFiltersBtn}
              onPress={() => { setDatePreset("All time"); setTurfFilter("all"); }}
            >
              <Ionicons name="close-circle" size={13} color="#9CA3AF" />
              <Text style={s.resetFiltersText}>Reset filters</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* ── Tabs ── */}
        <View style={s.tabRow}>
          {([
            { key: "pending", label: "Pending" },
            { key: "paid",    label: "Paid" },
            { key: "all",     label: "All" },
          ] as { key: FilterTab; label: string }[]).map((t) => (
            <TouchableOpacity
              key={t.key}
              style={[s.tabBtn, tab === t.key && s.tabBtnActive]}
              onPress={() => setTab(t.key)}
            >
              <Text style={[s.tabBtnText, tab === t.key && s.tabBtnTextActive]}>{t.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* ── List ── */}
        <View style={s.card}>
          {filteredList.length === 0 ? (
            <View style={s.empty}>
              <Ionicons name="checkmark-done-circle-outline" size={32} color="#D1D5DB" />
              <Text style={s.emptyTitle}>Nothing here</Text>
              <Text style={s.emptySub}>
                {tab === "pending" ? "No payouts waiting right now" : "No records in this view"}
              </Text>
            </View>
          ) : (
            filteredList.map((item) => {
              const turf = turfs.find((t) => t.id === item.turfId);
              return (
                <View key={item.key} style={row.wrap}>
                  <View style={row.top}>
                    <View style={{ flex: 1 }}>
                      <Text style={row.date}>{fmtDateDisplay(item.date)}</Text>
                      <Text style={row.turf} numberOfLines={1}>
                        {item.turfName}{turf ? `  ·  ${fmtTurfHours(turf)}` : ""}
                      </Text>
                      <Text style={row.owner}>Owner ID: {item.ownerId || "—"}</Text>
                    </View>
                    <View style={{ alignItems: "flex-end" }}>
                      {/* Headline = actual payout owed (online + PCoin top-up) */}
                      <Text style={row.amount}>{fmtFull(item.payoutAmount)}</Text>
                      {item.pcoinUsed > 0 && (
                        <Text style={row.pcoinNote}>incl. 🪙 {item.pcoinUsed} PCoin top-up</Text>
                      )}
                      {item.vcoinUsed > 0 && (
                        <Text style={row.vcoinNote}>🪙 {item.vcoinUsed} VCoin (owner's cost)</Text>
                      )}
                    </View>
                  </View>

                  <View style={row.bottom}>
                    {item.status === "paid" ? (
                      <View style={row.paidBadge}>
                        <Ionicons name="checkmark-circle" size={13} color="#15803D" />
                        <Text style={row.paidBadgeText}>
                          Paid {item.paidAt ? `on ${fmtDateDisplay(item.paidAt)}` : ""}
                        </Text>
                      </View>
                    ) : item.status === "pending" ? (
                      <TouchableOpacity style={row.payBtn} onPress={() => openMarkPaid(item)}>
                        <Ionicons name="cash-outline" size={14} color="#fff" />
                        <Text style={row.payBtnText}>Mark as Paid</Text>
                      </TouchableOpacity>
                    ) : (
                      <View style={row.todayBadge}>
                        <Ionicons name="time-outline" size={13} color="#2563EB" />
                        <Text style={row.todayBadgeText}>Still collecting today</Text>
                      </View>
                    )}
                  </View>
                </View>
              );
            })
          )}
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* ── Mark as Paid modal ── */}
      <Modal visible={!!selected} animationType="slide" transparent onRequestClose={() => setSelected(null)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={m.backdrop}
        >
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => setSelected(null)} />
          <View style={m.sheet}>
            <View style={m.handle} />
            <Text style={m.title}>Confirm Payout</Text>

            {selected && (
              <>
              <View style={m.summaryBox}>
  <Text style={m.summaryTurf}>{selected.turfName}</Text>
  <Text style={m.summaryDate}>{fmtDateDisplay(selected.date)}</Text>
  {/* Headline = the actual amount that will be sent to /mark-settlement-paid */}
  <Text style={m.summaryAmount}>{fmtFull(selected.payoutAmount)}</Text>
  {(selected.pcoinUsed > 0 || selected.vcoinUsed > 0) && (
    <Text style={m.summaryMeta}>
      {fmtFull(selected.amount)} online collected
      {selected.pcoinUsed > 0 ? ` + 🪙 ${selected.pcoinUsed} PCoin top-up` : ""}
    </Text>
  )}
  <Text style={m.summaryMeta}>{selected.bookingCount} bookings · Owner ID: {selected.ownerId}</Text>
  {selected.pcoinUsed > 0 && (
    <Text style={[m.summaryMeta, { color: "#7C3AED", marginTop: 4 }]}>
      🪙 {selected.pcoinUsed} PCoin used — platform-funded, added on top so the owner isn't short-changed
    </Text>
  )}
  {selected.vcoinUsed > 0 && (
    <Text style={[m.summaryMeta, { color: "#B45309", marginTop: 4 }]}>
      🪙 {selected.vcoinUsed} VCoin redeemed against this payout — this is the owner's own reward cost
    </Text>
  )}
</View>

                <Text style={m.label}>Reference / UTR number (optional)</Text>
                <TextInput
                  style={m.input}
                  placeholder="e.g. UTR1234567890"
                  placeholderTextColor="#9CA3AF"
                  value={reference}
                  onChangeText={setReference}
                />

                <Text style={m.label}>Note (optional)</Text>
                <TextInput
                  style={[m.input, { height: 70, textAlignVertical: "top" }]}
                  placeholder="Any note for your own records"
                  placeholderTextColor="#9CA3AF"
                  value={note}
                  onChangeText={setNote}
                  multiline
                />

                <TouchableOpacity
                  style={[m.confirmBtn, submitting && { opacity: 0.6 }]}
                  onPress={confirmMarkPaid}
                  disabled={submitting}
                >
                  {submitting ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <>
                      <Ionicons name="checkmark-circle" size={18} color="#fff" />
                      <Text style={m.confirmBtnText}>Confirm Paid</Text>
                    </>
                  )}
                </TouchableOpacity>

                <TouchableOpacity style={m.cancelBtn} onPress={() => setSelected(null)} disabled={submitting}>
                  <Text style={m.cancelBtnText}>Cancel</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── Turf filter picker ── */}
      <Modal visible={turfPickerOpen} animationType="slide" transparent onRequestClose={() => setTurfPickerOpen(false)}>
        <View style={tm.backdrop}>
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => setTurfPickerOpen(false)} />
          <View style={tm.sheet}>
            <View style={tm.handle} />
            <Text style={tm.title}>Filter by Turf</Text>

            <TextInput
              style={tm.search}
              placeholder="Search turf name..."
              placeholderTextColor="#9CA3AF"
              value={turfSearch}
              onChangeText={setTurfSearch}
              autoFocus
            />

            <ScrollView style={tm.list} keyboardShouldPersistTaps="handled">
              <TouchableOpacity
                style={[tm.row, turfFilter === "all" && tm.rowActive]}
                onPress={() => { setTurfFilter("all"); setTurfPickerOpen(false); }}
              >
                <Text style={[tm.rowText, turfFilter === "all" && tm.rowTextActive]}>All Turfs</Text>
                {turfFilter === "all" && <Ionicons name="checkmark" size={18} color={GREEN} />}
              </TouchableOpacity>

              {turfsWithHistory
                .filter((t) => (t.name || "").toLowerCase().includes(turfSearch.trim().toLowerCase()))
                .map((t) => (
                  <TouchableOpacity
                    key={t.id}
                    style={[tm.row, turfFilter === t.id && tm.rowActive]}
                    onPress={() => { setTurfFilter(t.id); setTurfPickerOpen(false); }}
                  >
                    <Text style={[tm.rowText, turfFilter === t.id && tm.rowTextActive]} numberOfLines={1}>
                      {t.name || "Unnamed turf"}
                    </Text>
                    {turfFilter === t.id && <Ionicons name="checkmark" size={18} color={GREEN} />}
                  </TouchableOpacity>
                ))}

              {turfsWithHistory.filter((t) => (t.name || "").toLowerCase().includes(turfSearch.trim().toLowerCase())).length === 0 && (
                <Text style={tm.noResults}>No turfs match "{turfSearch}"</Text>
              )}
            </ScrollView>

            <TouchableOpacity style={tm.closeBtn} onPress={() => setTurfPickerOpen(false)}>
              <Text style={tm.closeBtnText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ── Row styles ────────────────────────────────────────────────────────────
const row = StyleSheet.create({
  wrap: { paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: "#F3F4F6" },
  top:  { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  date: { fontSize: 14, fontWeight: "800", color: "#111827" },
  turf: { fontSize: 12, color: "#374151", fontWeight: "600", marginTop: 2 },
  owner:{ fontSize: 10, color: "#9CA3AF", fontWeight: "500", marginTop: 2 },
  amount:{ fontSize: 16, fontWeight: "900", color: "#111827" },
  pcoinNote: { fontSize: 10, color: "#7C3AED", fontWeight: "700", marginTop: 2 },
  vcoinNote: { fontSize: 10, color: "#B45309", fontWeight: "700", marginTop: 2 },

  bottom: { marginTop: 10, flexDirection: "row" },

  payBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: DARK, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 12,
  },
  payBtnText: { color: "#fff", fontSize: 12, fontWeight: "800" },

  paidBadge: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "#DCFCE7", paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999,
  },
  paidBadgeText: { color: "#15803D", fontSize: 12, fontWeight: "700" },

  todayBadge: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "#EFF6FF", paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999,
  },
  todayBadgeText: { color: "#2563EB", fontSize: 12, fontWeight: "700" },
});

// ── Modal styles ──────────────────────────────────────────────────────────
const m = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet:    { backgroundColor: "#fff", borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 20, paddingBottom: Platform.OS === "ios" ? 36 : 24 },
  handle:   { width: 40, height: 4, borderRadius: 2, backgroundColor: "#E5E7EB", alignSelf: "center", marginBottom: 16 },
  title:    { fontSize: 18, fontWeight: "900", color: "#0A0F1E", marginBottom: 16, textAlign: "center" },

  summaryBox: { backgroundColor: "#F9FAFB", borderRadius: 16, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: "#E5E7EB" },
  summaryTurf:  { fontSize: 15, fontWeight: "900", color: "#111827" },
  summaryDate:  { fontSize: 12, color: "#6B7280", fontWeight: "600", marginTop: 2 },
  summaryAmount:{ fontSize: 26, fontWeight: "900", color: "#15803D", marginTop: 8 },
  summaryMeta:  { fontSize: 11, color: "#9CA3AF", fontWeight: "500", marginTop: 4 },

  label: { fontSize: 12, fontWeight: "700", color: "#374151", marginBottom: 6, marginTop: 4 },
  input: {
    backgroundColor: "#F9FAFB", borderRadius: 12, borderWidth: 1.5, borderColor: "#E5E7EB",
    paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: "#111827", marginBottom: 14,
  },

  confirmBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: GREEN, borderRadius: 14, paddingVertical: 15, marginTop: 4,
  },
  confirmBtnText: { color: "#fff", fontSize: 15, fontWeight: "800" },

  cancelBtn: { alignItems: "center", paddingVertical: 14, marginTop: 4 },
  cancelBtnText: { color: "#6B7280", fontSize: 14, fontWeight: "700" },
});

// ── Screen styles ─────────────────────────────────────────────────────────
const s = StyleSheet.create({
  safe:     { flex: 1, backgroundColor: "#F0F4F8" },
  scroll:   { paddingBottom: 24 },
  loadWrap: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: DARK, paddingHorizontal: 24 },
  loadText: { color: "#9CA3AF", fontSize: 15, fontWeight: "600", textAlign: "center" },
  backLink: { marginTop: 16 },
  backLinkText: { color: GREEN, fontSize: 14, fontWeight: "700" },

  hero: { backgroundColor: DARK, paddingHorizontal: 20, paddingBottom: 28, overflow: "hidden" },
  glow1:{ position: "absolute", top: -40, right: -30, width: 200, height: 200, borderRadius: 100, backgroundColor: "rgba(34,197,94,0.10)" },
  glow2:{ position: "absolute", bottom: -80, left: -50, width: 220, height: 220, borderRadius: 110, backgroundColor: "rgba(99,102,241,0.08)" },

  heroTop:   { flexDirection: "row", alignItems: "center", marginBottom: 20 },
  backBtn:   { width: 36, height: 36, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.1)", justifyContent: "center", alignItems: "center" },
  heroTag:   { color: "#9CA3AF", fontSize: 10, fontWeight: "800", letterSpacing: 1.2 },
  heroTitle: { color: "#FFFFFF", fontSize: 24, fontWeight: "900", marginTop: 2 },

  feeRow: { flexDirection: "row", gap: 10 },
  feeBox: { flex: 1, backgroundColor: "rgba(255,255,255,0.07)", borderRadius: 14, padding: 14, borderWidth: 1, borderColor: "rgba(255,255,255,0.08)" },
  feeBoxGreen: { backgroundColor: "rgba(34,197,94,0.1)", borderColor: "rgba(34,197,94,0.2)" },
  feeLabel: { fontSize: 11, color: "#9CA3AF", fontWeight: "600", marginBottom: 6 },
  feeValue: { fontSize: 17, fontWeight: "900", color: "#FFFFFF" },
  feeSub:   { fontSize: 10, color: "#9CA3AF", fontWeight: "600", marginTop: 3 },

  // NEW — Today snapshot card (fixed, always shows today regardless of filters)
  todayCard: {
    backgroundColor: "rgba(124,58,237,0.12)", borderRadius: 16, padding: 14,
    borderWidth: 1, borderColor: "rgba(124,58,237,0.3)", marginBottom: 14,
  },
  todayCardHeader: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 10 },
  todayCardTitle:  { color: "#D1D5DB", fontSize: 10, fontWeight: "800", letterSpacing: 1 },
  todayStatsRow:   { flexDirection: "row", alignItems: "center" },
  todayStat:       { flex: 1, alignItems: "center" },
  todayStatValue:  { color: "#FFFFFF", fontSize: 15, fontWeight: "900" },
  todayStatLabel:  { color: "#9CA3AF", fontSize: 9, fontWeight: "600", marginTop: 4, textAlign: "center" },
  todayStatDivider:{ width: 1, height: 30, backgroundColor: "rgba(255,255,255,0.12)" },
  todayCardSub:    { color: "#9CA3AF", fontSize: 10, fontWeight: "500", marginTop: 10, textAlign: "center" },

  // NEW — date-range + turf filter row
  filterSection: { paddingHorizontal: 16, marginTop: 16, gap: 10 },
  filterChipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  filterChip: {
    paddingHorizontal: 13, paddingVertical: 8, borderRadius: 999,
    backgroundColor: "#fff", borderWidth: 1, borderColor: "#E5E7EB",
  },
  filterChipActive: { backgroundColor: DARK, borderColor: DARK },
  filterChipText: { fontSize: 12, fontWeight: "700", color: "#6B7280" },
  filterChipTextActive: { color: "#fff" },

  turfFilterBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "#fff", borderWidth: 1, borderColor: "#E5E7EB",
    borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, alignSelf: "flex-start",
  },
  turfFilterBtnText: { fontSize: 13, fontWeight: "700", color: "#111827", maxWidth: 200 },

  resetFiltersBtn: { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start" },
  resetFiltersText: { fontSize: 12, fontWeight: "600", color: "#9CA3AF" },

  tabRow: { flexDirection: "row", gap: 8, paddingHorizontal: 16, marginTop: 16 },
  tabBtn: { flex: 1, paddingVertical: 10, borderRadius: 12, backgroundColor: "#fff", borderWidth: 1, borderColor: "#E5E7EB", alignItems: "center" },
  tabBtnActive: { backgroundColor: DARK, borderColor: DARK },
  tabBtnText: { fontSize: 12, fontWeight: "700", color: "#6B7280" },
  tabBtnTextActive: { color: "#fff" },

  card: {
    backgroundColor: "#FFFFFF", marginHorizontal: 16, marginTop: 16,
    borderRadius: 20, padding: 18,
    borderWidth: 1, borderColor: "#E5E7EB",
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05, shadowRadius: 8, elevation: 2,
  },

  empty:      { alignItems: "center", paddingVertical: 36, gap: 10 },
  emptyTitle: { fontSize: 15, fontWeight: "800", color: "#374151" },
  emptySub:   { fontSize: 13, color: "#9CA3AF", fontWeight: "500", textAlign: "center" },
});

// ── Turf filter modal styles ─────────────────────────────────────────────
const tm = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet:    { backgroundColor: "#fff", borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 20, paddingBottom: Platform.OS === "ios" ? 36 : 24, maxHeight: "75%" },
  handle:   { width: 40, height: 4, borderRadius: 2, backgroundColor: "#E5E7EB", alignSelf: "center", marginBottom: 16 },
  title:    { fontSize: 18, fontWeight: "900", color: "#0A0F1E", marginBottom: 14, textAlign: "center" },

  search: {
    backgroundColor: "#F9FAFB", borderRadius: 12, borderWidth: 1.5, borderColor: "#E5E7EB",
    paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: "#111827", marginBottom: 12,
  },

  list: { maxHeight: 340 },
  row: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingVertical: 14, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: "#F3F4F6",
  },
  rowActive: { backgroundColor: "#F0FDF4" },
  rowText: { fontSize: 14, fontWeight: "600", color: "#374151", flex: 1 },
  rowTextActive: { fontWeight: "800", color: "#111827" },
  noResults: { textAlign: "center", color: "#9CA3AF", fontSize: 13, fontWeight: "500", paddingVertical: 24 },

  closeBtn: { backgroundColor: "#F3F4F6", paddingVertical: 14, borderRadius: 16, alignItems: "center", marginTop: 14 },
  closeBtnText: { color: "#374151", fontWeight: "700", fontSize: 15 },
});
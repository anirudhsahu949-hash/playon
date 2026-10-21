/**
 * (owner)/settlementscreen.tsx — Online money history (like PhonePe history)
 * • Top: Today (collecting) and Yesterday cards
 * • Turf chips → history of the last 15 days, "Show 15 more days" loads older
 * • Tap a day → day receipt: you receive, bookings, PCoin, VCoin, offers, booking list
 * Removed: payment type breakdown, fee table, custom range.
 * Needs the fixed Settlementhelpers.ts (turf hours, late-night day end, offers).
 */
import {
  View, Text, StyleSheet, StatusBar, ScrollView, TouchableOpacity, ActivityIndicator,
  RefreshControl, BackHandler, Alert,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigation, useRouter } from "expo-router";
import { auth, db } from "../../firebaseConfig";
import { collection, getDocs, query, where, Timestamp, orderBy } from "firebase/firestore";
import { Ionicons } from "@expo/vector-icons";
import * as Sharing from "expo-sharing";
import ViewShot from "react-native-view-shot";
import {
  Turf, Booking, DailySettlement, fetchTurfs, fetchSettlementRecords, buildDailySettlements,
  fmtTurfHours, toMidnight, bookingDay, slotRange, fmtSlotRange, getOnlinePaid, getPcoinUsed,
  getVcoinUsed, getOfferDiscount, turfHours,
} from "../../Settlementhelpers";

// ── Palette (same as other owner screens) ───────────────────────────────────
const BRAND = "#15803D";
const STRIPE = "#138A3F";
const ON_BRAND = "#DCFCE7";
const PAGE = "#F1F4F7";
const INK = "#0F172A";
const SLATE = "#475569";
const MUTED = "#64748B";
const FAINT = "#94A3B8";
const LINE = "#E2E8F0";

const PAGE_DAYS = 15;
const DAY = 86400000;

const rs = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const hrs = (mins: number) => {
  if (mins <= 0) return "—";
  const h = Math.floor(mins / 60), m = mins % 60;
  return m ? `${h}h ${m}m` : `${h} hr${h === 1 ? "" : "s"}`;
};
const shortDate = (d: Date) => d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
function dayName(d: Date): string {
  const today = toMidnight(new Date()).getTime();
  const t = d.getTime();
  if (t === today) return "Today";
  if (t === today - DAY) return "Yesterday";
  return d.toLocaleDateString("en-IN", { weekday: "long" });
}

const PILL = {
  paid:     { label: "✓ Paid",       bg: "#DCFCE7", fg: BRAND },
  pending:  { label: "⏱ Pending",    bg: "#FEF3C7", fg: "#B45309" },
  today:    { label: "● Collecting", bg: "#DBEAFE", fg: "#1D4ED8" },
  upcoming: { label: "Upcoming",     bg: "#F1F5F9", fg: SLATE },
};

// ─────────────────────────────────────────────────────────────────────────────
export default function SettlementScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const navigation = useNavigation();

  const [bookings, setBookings] = useState<Booking[]>([]);
  const [turfs, setTurfs] = useState<Turf[]>([]);
  const [paidRecords, setPaidRecords] = useState<Record<string, any>>({});
  const [days, setDays] = useState(PAGE_DAYS);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [turfFilter, setTurfFilter] = useState<string>("all");
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [, setTick] = useState(0);

  // ── Load ──
  const fetchBookings = useCallback(async (numDays: number) => {
    const uid = auth.currentUser?.uid;
    if (!uid) return [];
    const start = toMidnight(new Date(Date.now() - (numDays - 1) * DAY));
    const end = new Date(); end.setHours(23, 59, 59, 999);
    const inRange = (b: Booking) => {
      const d = bookingDay(b);
      return !!d && d >= start && d <= end;
    };
    try {
      const snap = await getDocs(query(
        collection(db, "bookings"),
        where("ownerId", "==", uid),
        where("date", ">=", Timestamp.fromDate(start)),
        where("date", "<=", Timestamp.fromDate(end)),
        orderBy("date", "desc"),
      ));
      return snap.docs.map(d => ({ id: d.id, ...(d.data() as any) } as Booking)).filter(inRange);
    } catch (e) {
      // Composite index (ownerId + date) missing → same result, just slower
      console.warn("settlement: bounded query failed, using fallback", e);
      const snap = await getDocs(query(collection(db, "bookings"), where("ownerId", "==", uid)));
      return snap.docs.map(d => ({ id: d.id, ...(d.data() as any) } as Booking)).filter(inRange);
    }
  }, []);

  const loadAll = useCallback(async (numDays: number) => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    const [b, t, p] = await Promise.all([
      fetchBookings(numDays),
      fetchTurfs(uid).catch(() => [] as Turf[]),
      fetchSettlementRecords(uid).catch(() => ({})),
    ]);
    setBookings(b); setTurfs(t); setPaidRecords(p);
  }, [fetchBookings]);

  useEffect(() => {
    (async () => {
      try { await loadAll(PAGE_DAYS); } catch (e) { console.log(e); }
      finally { setLoading(false); }
    })();
  }, [loadAll]);

  // status changes (Collecting → Pending) when a turf closes
  useEffect(() => { const t = setInterval(() => setTick(x => x + 1), 60000); return () => clearInterval(t); }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    try { await loadAll(days); } catch (e) { console.log(e); }
    finally { setRefreshing(false); }
  };

  const showMore = async () => {
    const next = days + PAGE_DAYS;
    setLoadingMore(true);
    try { setBookings(await fetchBookings(next)); setDays(next); }
    catch { Alert.alert("Error", "Could not load older days."); }
    finally { setLoadingMore(false); }
  };

  // ── Day receipt open: Back closes it (Android) and swipe-back is off (iPhone) ──
  useEffect(() => {
    navigation.setOptions?.({ gestureEnabled: !openKey } as any);
    if (!openKey) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => { setOpenKey(null); return true; });
    return () => sub.remove();
  }, [openKey, navigation]);

  // ── Derived ──
  const all = useMemo(
    () => buildDailySettlements(bookings, turfs, paidRecords).filter(d => d.status !== "upcoming"),
    [bookings, turfs, paidRecords, /* tick */ Math.floor(Date.now() / 60000)] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const list = useMemo(() => (turfFilter === "all" ? all : all.filter(d => d.turfId === turfFilter)), [all, turfFilter]);

  const todayMs = toMidnight(new Date()).getTime();
  const sumDay = (ms: number) => {
    const items = list.filter(d => d.date.getTime() === ms);
    return {
      amount: items.reduce((a, d) => a + d.payoutAmount, 0),
      count: items.reduce((a, d) => a + d.bookingCount, 0),
      allPaid: items.length > 0 && items.every(d => d.status === "paid"),
      collecting: items.some(d => d.status === "today"),
    };
  };
  const today = sumDay(todayMs);
  const yesterday = sumDay(todayMs - DAY);

  const rangeStart = new Date(todayMs - (days - 1) * DAY);
  const turfChips = turfs.length > 1 ? [{ id: "all", name: "All turfs" }, ...turfs.map(t => ({ id: t.id, name: t.name || "Turf" }))] : [];
  const opened = openKey ? all.find(d => d.key === openKey) ?? null : null;

  if (loading) {
    return (
      <View style={s.center}>
        <StatusBar barStyle="dark-content" />
        <ActivityIndicator size="large" color={BRAND} />
        <Text style={s.loadTxt}>Loading settlements…</Text>
      </View>
    );
  }

  if (opened) {
    const turf = turfs.find(t => t.id === opened.turfId);
    return <DayReceipt item={opened} turf={turf} onClose={() => setOpenKey(null)}
      onOpenBooking={(id) => router.push(`/(owner)/booking-receipt/${id}` as any)} />;
  }

  return (
    <View style={s.root}>
      <StatusBar barStyle="light-content" backgroundColor={BRAND} />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={BRAND} />}
      >
        {/* ── Header ── */}
        <View style={[s.header, { paddingTop: insets.top + 10 }]}>
          <View style={s.headRow}>
            <TouchableOpacity style={s.hBtn} onPress={() => router.back()} accessibilityLabel="Back">
              <Ionicons name="arrow-back" size={20} color="#fff" />
            </TouchableOpacity>
            <View style={{ flex: 1 }}>
              <Text style={s.kicker}>OWNER · ONLINE MONEY</Text>
              <Text style={s.title}>Settlement</Text>
            </View>
          </View>

          <View style={s.dayCards}>
            <View style={[s.dayCard, { backgroundColor: "#fff" }]}>
              <Text style={[s.dcLbl, { color: "#1D4ED8" }]}>● TODAY</Text>
              <Text style={s.dcAmt} numberOfLines={1} adjustsFontSizeToFit>{rs(today.amount)}</Text>
              <Text style={s.dcSub}>{today.count} booking{today.count === 1 ? "" : "s"}{today.count ? " · collecting" : ""}</Text>
            </View>
            <View style={[s.dayCard, { backgroundColor: "rgba(255,255,255,0.14)" }]}>
              <Text style={[s.dcLbl, { color: ON_BRAND }]}>YESTERDAY</Text>
              <Text style={[s.dcAmt, { color: "#fff" }]} numberOfLines={1} adjustsFontSizeToFit>{rs(yesterday.amount)}</Text>
              <Text style={[s.dcSub, { color: yesterday.allPaid ? "#BBF7D0" : "#FDE68A" }]}>
                {yesterday.count === 0 ? "No online bookings" : yesterday.allPaid ? "✓ Paid to your bank" : yesterday.collecting ? "● Still open" : "⏱ Payout pending"}
              </Text>
            </View>
          </View>

          {turfChips.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chipRow}>
              {turfChips.map(c => {
                const on = turfFilter === c.id;
                return (
                  <TouchableOpacity key={c.id} style={[s.chip, on && s.chipOn]} onPress={() => setTurfFilter(c.id)}>
                    <Text style={[s.chipTxt, on && s.chipTxtOn]} numberOfLines={1}>{c.name}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}
        </View>

        {/* ── History ── */}
        <Text style={s.section}>LAST {days} DAYS · {shortDate(rangeStart)} – {shortDate(new Date())}</Text>

        {list.length === 0 ? (
          <View style={s.empty}>
            <Ionicons name="wallet-outline" size={34} color={FAINT} />
            <Text style={s.emptyTitle}>No online money in these days</Text>
            <Text style={s.emptySub}>Days with app bookings show up here.</Text>
          </View>
        ) : (
          <View style={s.list}>
            {list.map(item => {
              const p = PILL[item.status];
              return (
                <TouchableOpacity key={item.key} style={s.row} activeOpacity={0.7} onPress={() => setOpenKey(item.key)}
                  accessibilityLabel={`${dayName(item.date)} ${item.turfName} ${rs(item.payoutAmount)} ${p.label}`}>
                  <View style={s.dateBox}>
                    <Text style={s.dateNum}>{item.date.getDate()}</Text>
                    <Text style={s.dateMon}>{item.date.toLocaleDateString("en-IN", { month: "short" }).toUpperCase()}</Text>
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={s.rowTitle}>{dayName(item.date)}</Text>
                    <Text style={s.rowSub} numberOfLines={1}>{item.turfName} · {item.bookingCount} booking{item.bookingCount === 1 ? "" : "s"}</Text>
                  </View>
                  <View style={{ alignItems: "flex-end", gap: 4 }}>
                    <Text style={s.rowAmt}>{rs(item.payoutAmount)}</Text>
                    <View style={[s.pill, { backgroundColor: p.bg }]}><Text style={[s.pillTxt, { color: p.fg }]}>{p.label}</Text></View>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color="#CBD5E1" />
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        <TouchableOpacity style={[s.moreBtn, loadingMore && { opacity: 0.6 }]} onPress={showMore} disabled={loadingMore}>
          {loadingMore ? <ActivityIndicator color={SLATE} size="small" /> : (
            <Text style={s.moreTxt}>
              Show {PAGE_DAYS} more days · {shortDate(new Date(rangeStart.getTime() - PAGE_DAYS * DAY))} – {shortDate(new Date(rangeStart.getTime() - DAY))}
            </Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Day receipt
// ─────────────────────────────────────────────────────────────────────────────
function DayReceipt({ item, turf, onClose, onOpenBooking }: {
  item: DailySettlement; turf?: Turf; onClose: () => void; onOpenBooking: (id: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const shotRef = useRef<any>(null);
  const [sharing, setSharing] = useState(false);
  const p = PILL[item.status];
  const hours = fmtTurfHours(turf);
  const late = turfHours(turf).close > 24;

  const share = async () => {
    try {
      setSharing(true);
      await new Promise(r => setTimeout(r, 250));
      const uri = await shotRef.current?.capture?.();
      if (!uri) throw new Error("capture failed");
      await Sharing.shareAsync(uri, { mimeType: "image/png", dialogTitle: "Share day settlement", UTI: "public.png" });
    } catch { Alert.alert("Error", "Unable to share. Please try again."); }
    finally { setSharing(false); }
  };

  const statusLine =
    item.status === "paid" ? "✓ Paid to your bank" :
    item.status === "pending" ? "⏱ Pending · PlayOn will send it soon" :
    late ? `● Collecting · day ends ${item.closesAt?.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}` : "● Collecting · day not finished";

  return (
    <View style={s.root}>
      <StatusBar barStyle="light-content" backgroundColor={BRAND} />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: insets.bottom + 30 }}>
        <View style={r.turf}>
          <Stripes />
          <View style={[s.headRow, { paddingTop: insets.top + 10, paddingHorizontal: 16 }]}>
            <TouchableOpacity style={s.hBtn} onPress={onClose} accessibilityLabel="Back">
              <Ionicons name="arrow-back" size={20} color="#fff" />
            </TouchableOpacity>
            <View style={{ flex: 1 }}>
              <Text style={s.kicker}>DAY SETTLEMENT</Text>
              <Text style={s.title}>{item.date.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })}</Text>
            </View>
            <TouchableOpacity style={s.hBtn} onPress={share} disabled={sharing} accessibilityLabel="Share">
              {sharing ? <ActivityIndicator color="#fff" size="small" /> : <Ionicons name="share-outline" size={19} color="#fff" />}
            </TouchableOpacity>
          </View>

          <ViewShot ref={shotRef} options={{ format: "png", quality: 1 }} style={r.shot}>
            <Stripes />
            <View style={r.ticketWrap}>
              <View style={r.top}>
                <Text style={r.turfLine} numberOfLines={2}>{item.turfName.toUpperCase()}{hours ? ` · ${hours}` : ""}</Text>
                <Text style={r.receiveLbl}>You receive</Text>
                <Text style={r.receive} numberOfLines={1} adjustsFontSizeToFit>{rs(item.payoutAmount)}</Text>
                <View style={[r.stamp, { backgroundColor: p.bg }]}><Text style={[r.stampTxt, { color: p.fg }]}>{statusLine}</Text></View>
                <View style={r.boxes}>
                  <View style={r.box}><Text style={r.boxLbl}>BOOKINGS</Text><Text style={r.boxVal}>{item.bookingCount}</Text></View>
                  <View style={r.box}><Text style={r.boxLbl}>HOURS BOOKED</Text><Text style={r.boxVal}>{hrs(item.minutesBooked)}</Text></View>
                </View>
              </View>

              <TearLine />

              <View style={r.bottom}>
                <Text style={r.kick}>ONLINE MONEY</Text>
                <Row label="Players paid in the app" sub="Advance + full payments" value={rs(item.amount)} />
                {item.pcoinUsed > 0 && <Row label="🪙 PCoin used" sub="PlayOn pays this to you" value={`+ ${rs(item.pcoinUsed)}`} color="#7C3AED" />}
                <View style={r.line} />
                <Row label="You receive" value={rs(item.payoutAmount)} big />

                {(item.vcoinUsed > 0 || item.offerGiven > 0) && (
                  <>
                    <Text style={[r.kick, { marginTop: 14 }]}>DISCOUNTS THIS DAY</Text>
                    {item.vcoinUsed > 0 && <Row label="🏟️ VCoin used by players" sub="Your reward · already taken off" value={`🪙 ${item.vcoinUsed}`} color="#B45309" />}
                    {item.offers.map(o => (
                      <Row key={o.title} label={`🎉 ${o.title}`} sub={`${o.count} booking${o.count === 1 ? "" : "s"} · taken off at the turf`} value={rs(o.discount)} color="#C2410C" />
                    ))}
                    {item.offerGiven > 0 && (
                      <View style={r.note}><Text style={r.noteTxt}>Offers lower what players pay at the turf. Your online payout is not cut.</Text></View>
                    )}
                  </>
                )}

                {item.status === "paid" && (
                  <>
                    <Text style={[r.kick, { marginTop: 14 }]}>PAYMENT</Text>
                    {item.paidAt && <Row label="Paid on" value={item.paidAt.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })} />}
                    {!!item.reference && <Row label="UTR / reference" value={String(item.reference)} />}
                    {!!item.note && <Row label="Note" value={String(item.note)} />}
                  </>
                )}

                <Text style={[r.kick, { marginTop: 14 }]}>BOOKINGS ({item.bookingCount})</Text>
                {item.bookings.map(b => <BookingLine key={b.id} b={b} turf={turf} onPress={() => onOpenBooking(b.id)} />)}
              </View>
              <ZigZag />
            </View>
            <Text style={r.foot}>Playon · Turf & Sport Booking App</Text>
          </ViewShot>
        </View>
        {item.status !== "paid" && <Text style={r.after}>When PlayOn pays, the date and UTR number show here.</Text>}
      </ScrollView>
    </View>
  );
}

function BookingLine({ b, turf, onPress }: { b: Booking; turf?: Turf; onPress: () => void }) {
  const paid = getOnlinePaid(b);
  const full = b.bookingType === "full" || b.paymentMode === "full_payment";
  const tags: string[] = [];
  if (getOfferDiscount(b) > 0) tags.push("🎉 offer");
  if (getVcoinUsed(b) > 0) tags.push(`🪙 ${getVcoinUsed(b)} VCoin`);
  if (getPcoinUsed(b) > 0) tags.push(`🪙 ${getPcoinUsed(b)} PCoin`);
  return (
    <TouchableOpacity style={r.bk} onPress={onPress} activeOpacity={0.7}>
      <View style={[r.bkBar, { backgroundColor: full ? "#8B5CF6" : "#22C55E" }]} />
      <View style={{ flex: 1 }}>
        <Text style={r.bkTime}>{fmtSlotRange(slotRange(b.selectedSlots, turf))}</Text>
        <Text style={r.bkSub} numberOfLines={1}>
          {b.userName || "Player"} · {full ? "Full" : "Advance"} {rs(paid)}{tags.length ? ` · ${tags.join(" · ")}` : ""}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color="#CBD5E1" />
    </TouchableOpacity>
  );
}

function Row({ label, value, sub, color, big }: { label: string; value: string; sub?: string; color?: string; big?: boolean }) {
  return (
    <View style={r.row}>
      <View style={{ flex: 1 }}>
        <Text style={[r.rowLbl, big && { color: INK, fontWeight: "900", fontSize: 15 }]}>{label}</Text>
        {!!sub && <Text style={r.rowSub}>{sub}</Text>}
      </View>
      <Text style={[r.rowVal, big && { fontSize: 18 }, color ? { color } : null]}>{value}</Text>
    </View>
  );
}
function Stripes() {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <View style={{ flex: 1, flexDirection: "row", backgroundColor: BRAND }}>
        {Array.from({ length: 16 }).map((_, i) => <View key={i} style={{ width: 40, backgroundColor: i % 2 ? STRIPE : BRAND }} />)}
      </View>
    </View>
  );
}
function TearLine() {
  return (
    <View style={r.tear}>
      <View style={[r.notch, { left: -13 }]} />
      <View style={[r.notch, { right: -13 }]} />
      <View style={r.tearDash} />
    </View>
  );
}
function ZigZag() {
  return (
    <View style={r.zigWrap}>
      {Array.from({ length: 40 }).map((_, i) => <View key={i} style={[r.zigTooth, { left: i * 12 - 3 }]} />)}
    </View>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: PAGE },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: PAGE },
  loadTxt: { marginTop: 10, color: MUTED, fontSize: 15, fontWeight: "600" },

  header: { backgroundColor: BRAND, borderBottomLeftRadius: 22, borderBottomRightRadius: 22, paddingHorizontal: 16, paddingBottom: 16 },
  headRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  hBtn: { width: 44, height: 44, borderRadius: 13, backgroundColor: "rgba(255,255,255,0.16)", alignItems: "center", justifyContent: "center" },
  kicker: { fontSize: 10, letterSpacing: 1.4, fontWeight: "800", color: ON_BRAND },
  title: { fontSize: 21, fontWeight: "900", color: "#fff" },

  dayCards: { flexDirection: "row", gap: 8, marginTop: 14 },
  dayCard: { flex: 1, borderRadius: 16, padding: 12 },
  dcLbl: { fontSize: 11, fontWeight: "900", letterSpacing: 0.4 },
  dcAmt: { fontSize: 24, fontWeight: "900", color: INK, marginTop: 2 },
  dcSub: { fontSize: 11, fontWeight: "700", color: MUTED, marginTop: 1 },

  chipRow: { gap: 7, marginTop: 14, paddingRight: 8 },
  chip: { height: 34, paddingHorizontal: 13, borderRadius: 999, backgroundColor: "rgba(255,255,255,0.14)", justifyContent: "center", maxWidth: 180 },
  chipOn: { backgroundColor: "#fff" },
  chipTxt: { fontSize: 12.5, fontWeight: "800", color: ON_BRAND },
  chipTxtOn: { color: BRAND },

  section: { fontSize: 11.5, fontWeight: "800", color: MUTED, letterSpacing: 0.6, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
  list: { backgroundColor: "#fff", borderTopWidth: 1, borderBottomWidth: 1, borderColor: LINE },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "#F1F5F9", minHeight: 68 },
  dateBox: { width: 46, height: 46, borderRadius: 12, backgroundColor: "#F5F7FA", alignItems: "center", justifyContent: "center" },
  dateNum: { fontSize: 16, fontWeight: "900", color: INK, lineHeight: 18 },
  dateMon: { fontSize: 9.5, fontWeight: "800", color: MUTED },
  rowTitle: { fontSize: 14, fontWeight: "900", color: INK },
  rowSub: { fontSize: 11.5, fontWeight: "600", color: FAINT, marginTop: 1 },
  rowAmt: { fontSize: 15.5, fontWeight: "900", color: INK },
  pill: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  pillTxt: { fontSize: 10.5, fontWeight: "800" },

  empty: { alignItems: "center", paddingVertical: 40, gap: 6 },
  emptyTitle: { fontSize: 15, fontWeight: "800", color: SLATE },
  emptySub: { fontSize: 12.5, fontWeight: "600", color: FAINT },

  moreBtn: { marginHorizontal: 16, marginTop: 14, height: 48, borderRadius: 13, borderWidth: 1, borderColor: LINE, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" },
  moreTxt: { fontSize: 13.5, fontWeight: "800", color: "#334155" },
});

const r = StyleSheet.create({
  turf: { backgroundColor: BRAND, borderBottomLeftRadius: 28, borderBottomRightRadius: 28, overflow: "hidden", paddingBottom: 16 },
  shot: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 6, overflow: "hidden" },
  ticketWrap: { shadowColor: INK, shadowOpacity: 0.22, shadowRadius: 18, shadowOffset: { width: 0, height: 10 }, elevation: 8 },
  top: { backgroundColor: "#fff", borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 18, paddingBottom: 8, alignItems: "center" },
  turfLine: { fontSize: 12, fontWeight: "800", color: MUTED, letterSpacing: 0.6, textAlign: "center" },
  receiveLbl: { fontSize: 12.5, fontWeight: "700", color: SLATE, marginTop: 10 },
  receive: { fontSize: 38, fontWeight: "900", color: INK, letterSpacing: -1 },
  stamp: { marginTop: 6, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 5 },
  stampTxt: { fontSize: 12, fontWeight: "800" },
  boxes: { flexDirection: "row", gap: 8, marginTop: 16, alignSelf: "stretch" },
  box: { flex: 1, backgroundColor: "#F5F7FA", borderRadius: 13, padding: 10 },
  boxLbl: { fontSize: 10, fontWeight: "800", color: MUTED, letterSpacing: 0.4 },
  boxVal: { fontSize: 18, fontWeight: "900", color: INK, marginTop: 1 },

  tear: { height: 26, backgroundColor: "#fff", justifyContent: "center" },
  notch: { position: "absolute", top: 0, width: 26, height: 26, borderRadius: 13, backgroundColor: BRAND },
  tearDash: { marginHorizontal: 20, borderTopWidth: 2, borderStyle: "dashed", borderColor: LINE },

  bottom: { backgroundColor: "#fff", paddingHorizontal: 18, paddingTop: 4, paddingBottom: 14 },
  kick: { fontSize: 10.5, letterSpacing: 0.9, fontWeight: "800", color: MUTED, marginBottom: 2 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 7 },
  rowLbl: { fontSize: 13.5, fontWeight: "700", color: SLATE },
  rowSub: { fontSize: 11, fontWeight: "600", color: FAINT, marginTop: 1 },
  rowVal: { fontSize: 14, fontWeight: "900", color: INK, maxWidth: 170, textAlign: "right" },
  line: { borderTopWidth: 1, borderColor: "#EEF1F5", marginVertical: 4 },
  note: { marginTop: 6, backgroundColor: "#F0FDF4", borderRadius: 10, padding: 9 },
  noteTxt: { fontSize: 11.5, fontWeight: "700", color: "#166534" },

  bk: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 9, borderBottomWidth: 1, borderStyle: "dashed", borderColor: LINE },
  bkBar: { width: 5, height: 30, borderRadius: 3 },
  bkTime: { fontSize: 13, fontWeight: "900", color: INK },
  bkSub: { fontSize: 11, fontWeight: "600", color: FAINT, marginTop: 1 },

  zigWrap: { height: 8, overflow: "hidden" },
  zigTooth: { position: "absolute", top: -6, width: 12, height: 12, backgroundColor: "#fff", transform: [{ rotate: "45deg" }] },
  foot: { textAlign: "center", color: ON_BRAND, fontSize: 12, fontWeight: "800", marginTop: 12, marginBottom: 6 },
  after: { textAlign: "center", color: FAINT, fontSize: 12, fontWeight: "700", marginTop: 12, paddingHorizontal: 24 },
});
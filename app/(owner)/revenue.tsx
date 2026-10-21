/**
 * (owner)/revenue.tsx — Revenue
 * Total earned = online advance + PCoin top-up + collected at turf + walk-ins
 * • Range: 7 / 15 / 30 days / This month, with "vs last period"
 * • Daily chart split into online / at turf / walk-in (tap a bar)
 * • Where the money came from + still to collect at turf
 * • 🎉 Offers: bookings, discount given, per offer
 * • By turf, booking mix
 * FIXES: future bookings counted as earned · cash at turf always ₹0 ·
 *        walk-ins missing · PCoin left out · loaded every booking ever.
 */
import {
  View, Text, StyleSheet, StatusBar, ScrollView, TouchableOpacity, ActivityIndicator, RefreshControl,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "expo-router";
import { auth, db } from "../../firebaseConfig";
import { collection, getDocs, query, where, Timestamp } from "firebase/firestore";
import { Ionicons } from "@expo/vector-icons";
import {
  Turf, Booking, fetchTurfs, bookingDay, slotRange, toMidnight, getOnlinePaid, getPcoinUsed,
  getOfferDiscount,
} from "../../Settlementhelpers";

const BRAND = "#15803D";
const ON_BRAND = "#DCFCE7";
const PAGE = "#F1F4F7";
const INK = "#0F172A";
const SLATE = "#475569";
const MUTED = "#64748B";
const FAINT = "#94A3B8";
const C_ONLINE = "#22C55E";
const C_TURF = "#FDBA74";
const C_WALK = "#A5B4FC";
const DAY = 86400000;

type RangeKey = "7" | "15" | "30" | "month";
const RANGES: { key: RangeKey; label: string }[] = [
  { key: "7", label: "7 days" }, { key: "15", label: "15 days" },
  { key: "30", label: "30 days" }, { key: "month", label: "This month" },
];

type WalkIn = { id: string; turfId: string; turfName: string; day: Date | null; amount: number };

const rs = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const short = (n: number) => (n >= 100000 ? `₹${(n / 100000).toFixed(1)}L` : n >= 1000 ? `₹${(n / 1000).toFixed(1)}K` : `₹${Math.round(n)}`);

function getSafeDate(v: any): Date | null {
  if (!v) return null;
  if (typeof v?.toDate === "function") return v.toDate();
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

// ─────────────────────────────────────────────────────────────────────────────
export default function RevenueScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [bookings, setBookings] = useState<Booking[]>([]);
  const [walkins, setWalkins] = useState<WalkIn[]>([]);
  const [turfs, setTurfs] = useState<Turf[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [range, setRange] = useState<RangeKey>("7");
  const [pickedDay, setPickedDay] = useState<number | null>(null);

  // ── Range math ──
  const { start, prevStart, days } = useMemo(() => {
    const today = toMidnight(new Date());
    if (range === "month") {
      const st = new Date(today.getFullYear(), today.getMonth(), 1);
      const n = Math.round((today.getTime() - st.getTime()) / DAY) + 1;
      return { start: st, prevStart: new Date(st.getTime() - n * DAY), days: n };
    }
    const n = Number(range);
    const st = new Date(today.getTime() - (n - 1) * DAY);
    return { start: st, prevStart: new Date(st.getTime() - n * DAY), days: n };
  }, [range]);

  // Always load 60 days back (covers "30 days" + the period before it) and all upcoming
  const load = useCallback(async () => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    const from = toMidnight(new Date(Date.now() - 62 * DAY));
    const bookingsP = (async () => {
      try {
        const snap = await getDocs(query(collection(db, "bookings"), where("ownerId", "==", uid), where("date", ">=", Timestamp.fromDate(from))));
        return snap.docs.map(d => ({ id: d.id, ...(d.data() as any) } as Booking));
      } catch (e) {
        console.warn("revenue: bounded query failed (index?), using fallback", e);
        const snap = await getDocs(query(collection(db, "bookings"), where("ownerId", "==", uid)));
        return snap.docs.map(d => ({ id: d.id, ...(d.data() as any) } as Booking))
          .filter(b => { const d = bookingDay(b); return !!d && d >= from; });
      }
    })();
    const walkP = getDocs(query(collection(db, "blockedSlots"), where("ownerId", "==", uid), where("type", "==", "offline")))
      .then(snap => snap.docs.map(d => {
        const raw: any = d.data();
        if (raw.pending === true) return null;
        const day = getSafeDate(raw.date || raw.dateString);
        return {
          id: d.id, turfId: raw.turfId || "", turfName: raw.turfName || "",
          day: day ? toMidnight(day) : null,
          amount: (Number(raw.amount) || 0) + (Number(raw.remainingAmount) || 0),
        } as WalkIn;
      }).filter(Boolean) as WalkIn[])
      .catch(() => [] as WalkIn[]);
    const [b, w, t] = await Promise.all([bookingsP, walkP, fetchTurfs(uid).catch(() => [] as Turf[])]);
    setBookings(b); setWalkins(w); setTurfs(t);
  }, []);

  useEffect(() => { (async () => { try { await load(); } catch (e) { console.log(e); } finally { setLoading(false); } })(); }, [load]);
  useEffect(() => { setPickedDay(null); }, [range]);

  const onRefresh = async () => { setRefreshing(true); try { await load(); } finally { setRefreshing(false); } };

  // ── Money model ──
  const data = useMemo(() => {
    const now = Date.now();
    const todayMs = toMidnight(new Date()).getTime();
    const turfMap: Record<string, Turf> = {};
    turfs.forEach(t => { turfMap[t.id] = t; });

    const ended = (b: Booking, dayMs: number) => {
      const r = slotRange(b.selectedSlots, turfMap[b.turfId || ""]);
      return now >= dayMs + (r ? r.end : 1440) * 60000;
    };

    const perDay: Record<number, { online: number; turf: number; walk: number }> = {};
    for (let i = 0; i < days; i++) perDay[start.getTime() + i * DAY] = { online: 0, turf: 0, walk: 0 };

    let online = 0, pcoin = 0, atTurf = 0, walk = 0, walkCount = 0;
    let toCollect = 0, toCollectCount = 0;
    let fullCount = 0, advCount = 0, cancelCount = 0, count = 0;
    let prevTotal = 0;
    const byTurf: Record<string, { name: string; amount: number; count: number }> = {};
    const offers: Record<string, { title: string; count: number; discount: number; earned: number }> = {};
    let offerCount = 0, offerGiven = 0;

    const addTurf = (id: string, name: string, amt: number, c: number) => {
      const k = id || "unknown";
      if (!byTurf[k]) byTurf[k] = { name: name || turfMap[k]?.name || "Turf", amount: 0, count: 0 };
      byTurf[k].amount += amt; byTurf[k].count += c;
    };

    bookings.forEach(b => {
      const day = bookingDay(b);
      if (!day) return;
      const ms = day.getTime();
      const cancelled = b.status === "cancelled";
      const on = getOnlinePaid(b);
      const pc = getPcoinUsed(b);
      const rem = Math.max(Number(b.remainingAmount ?? 0) || 0, 0);
      const done = ended(b, ms);

      // Upcoming at-turf money (any future date)
      if (!cancelled && !done && rem > 0) { toCollect += rem; toCollectCount += 1; }

      // Previous period (for the % change)
      if (!cancelled && ms >= prevStart.getTime() && ms < start.getTime()) {
        prevTotal += on + pc + (done ? rem : 0);
      }

      // FIX: only days inside the range, never future days
      if (ms < start.getTime() || ms > todayMs) return;
      if (cancelled) { cancelCount += 1; return; }

      count += 1;
      if (b.bookingType === "full" || b.paymentMode === "full_payment") fullCount += 1; else advCount += 1;
      online += on; pcoin += pc;
      const turfPart = done ? rem : 0; // at-turf money counts once the slot has ended
      atTurf += turfPart;
      if (perDay[ms]) { perDay[ms].online += on + pc; perDay[ms].turf += turfPart; }
      addTurf(b.turfId || "", b.turfName || "", on + pc + turfPart, 1);

      const od = getOfferDiscount(b);
      if (od > 0) {
        offerCount += 1; offerGiven += od;
        const title = b.offerTitle || "Venue offer";
        if (!offers[title]) offers[title] = { title, count: 0, discount: 0, earned: 0 };
        offers[title].count += 1; offers[title].discount += od; offers[title].earned += Number(b.totalAmount || 0);
      }
    });

    walkins.forEach(w => {
      if (!w.day) return;
      const ms = w.day.getTime();
      if (ms >= prevStart.getTime() && ms < start.getTime()) prevTotal += w.amount;
      if (ms < start.getTime() || ms > todayMs) return;
      walk += w.amount; walkCount += 1;
      if (perDay[ms]) perDay[ms].walk += w.amount;
      addTurf(w.turfId, w.turfName, w.amount, 1);
    });

    const total = online + pcoin + atTurf + walk;
    const allCount = count + walkCount;
    const chart = Object.entries(perDay).map(([k, v]) => ({ ms: Number(k), ...v, total: v.online + v.turf + v.walk }));
    const best = chart.reduce((a, c) => (c.total > (a?.total ?? -1) ? c : a), chart[0]);
    const change = prevTotal > 0 ? Math.round(((total - prevTotal) / prevTotal) * 100) : null;

    return {
      total, online, pcoin, atTurf, walk, walkCount, toCollect, toCollectCount,
      fullCount, advCount, cancelCount, allCount, avg: allCount ? Math.round(total / allCount) : 0,
      change, chart, best,
      byTurf: Object.values(byTurf).sort((a, b) => b.amount - a.amount),
      offers: Object.values(offers).sort((a, b) => b.discount - a.discount),
      offerCount, offerGiven,
    };
  }, [bookings, walkins, turfs, start, prevStart, days]);

  if (loading) {
    return (
      <View style={s.center}>
        <StatusBar barStyle="dark-content" />
        <ActivityIndicator size="large" color={BRAND} />
        <Text style={s.loadTxt}>Loading revenue…</Text>
      </View>
    );
  }

  const rangeLabel = range === "month" ? "this month" : `last ${range} days`;
  const maxBar = Math.max(...data.chart.map(c => c.total), 1);
  const picked = pickedDay !== null ? data.chart.find(c => c.ms === pickedDay) : null;
  const maxTurf = Math.max(...data.byTurf.map(t => t.amount), 1);
  const mixTotal = data.fullCount + data.advCount + data.walkCount + data.cancelCount;
  const labelEvery = Math.ceil(data.chart.length / 7);
  const dayLbl = (ms: number) => {
    const d = new Date(ms);
    return data.chart.length <= 7 ? d.toLocaleDateString("en-IN", { weekday: "short" }) : String(d.getDate());
  };

  return (
    <View style={s.root}>
      <StatusBar barStyle="light-content" backgroundColor={BRAND} />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: insets.bottom + 28 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={BRAND} />}>

        {/* ── Header ── */}
        <View style={[s.header, { paddingTop: insets.top + 10 }]}>
          <View style={s.headRow}>
            <TouchableOpacity style={s.hBtn} onPress={() => router.back()} accessibilityLabel="Back">
              <Ionicons name="arrow-back" size={20} color="#fff" />
            </TouchableOpacity>
            <View style={{ flex: 1 }}>
              <Text style={s.kicker}>OWNER · REVENUE</Text>
              <Text style={s.title}>Revenue</Text>
            </View>
            <TouchableOpacity style={s.payBtn} onPress={() => router.push("/(owner)/settlementscreen" as any)}>
              <Text style={s.payTxt}>Payouts</Text>
              <Ionicons name="arrow-forward" size={14} color={BRAND} />
            </TouchableOpacity>
          </View>

          <View style={s.chipRow}>
            {RANGES.map(r => (
              <TouchableOpacity key={r.key} style={[s.chip, range === r.key && s.chipOn]} onPress={() => setRange(r.key)}>
                <Text style={[s.chipTxt, range === r.key && s.chipTxtOn]}>{r.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={s.totLbl}>Total earned · {rangeLabel}</Text>
          <View style={s.totRow}>
            <Text style={s.tot} numberOfLines={1} adjustsFontSizeToFit>{rs(data.total)}</Text>
            {data.change !== null && (
              <View style={s.chg}><Text style={s.chgTxt}>{data.change >= 0 ? "▲" : "▼"} {Math.abs(data.change)}% vs before</Text></View>
            )}
          </View>
          <Text style={s.totSub}>{data.allCount} bookings · avg {rs(data.avg)} per booking</Text>

          <View style={s.stats}>
            <Stat v={short(data.online + data.pcoin)} l="ONLINE" c="#4ADE80" />
            <Stat v={short(data.atTurf)} l="AT TURF" c="#FDBA74" />
            <Stat v={short(data.walk)} l="WALK-IN" c="#A5B4FC" />
            <Stat v={String(data.allCount)} l="BOOKINGS" c="#fff" />
          </View>
        </View>

        {/* ── Daily chart ── */}
        <Card>
          <CardTitle t="Daily earnings" sub="tap a bar" />
          <View style={s.bars}>
            {data.chart.map((c, i) => {
              const h = (v: number) => (v / maxBar) * 120;
              const on = pickedDay === c.ms;
              return (
                <TouchableOpacity key={c.ms} style={s.barCol} activeOpacity={0.7} onPress={() => setPickedDay(on ? null : c.ms)}
                  accessibilityLabel={`${new Date(c.ms).toDateString()} ${rs(c.total)}`}>
                  <View style={[s.barStack, pickedDay !== null && !on && { opacity: 0.35 }]}>
                    {c.walk > 0 && <View style={{ height: h(c.walk), backgroundColor: C_WALK }} />}
                    {c.turf > 0 && <View style={{ height: h(c.turf), backgroundColor: C_TURF }} />}
                    {c.online > 0 && <View style={{ height: h(c.online), backgroundColor: C_ONLINE }} />}
                    {c.total === 0 && <View style={{ height: 3, backgroundColor: "#E2E8F0" }} />}
                  </View>
                  <Text style={[s.barLbl, on && { color: BRAND }]} numberOfLines={1}>{i % labelEvery === 0 || on ? dayLbl(c.ms) : ""}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <View style={s.legend}>
            <Legend c={C_ONLINE} l="Online" /><Legend c={C_TURF} l="At turf" /><Legend c={C_WALK} l="Walk-in" />
          </View>
          <View style={s.cardFoot}>
            {picked ? (
              <Text style={s.footTxt}>
                {new Date(picked.ms).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })} · {rs(picked.total)}
                {"  "}(online {rs(picked.online)} · turf {rs(picked.turf)} · walk-in {rs(picked.walk)})
              </Text>
            ) : data.best && data.best.total > 0 ? (
              <Text style={s.footTxt}>📈 Best day: {new Date(data.best.ms).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })} · {rs(data.best.total)}</Text>
            ) : <Text style={s.footTxt}>No earnings in these days yet</Text>}
          </View>
        </Card>

        {/* ── Where the money came from ── */}
        <Card>
          <CardTitle t="Where the money came from" />
          <MoneyRow dot={C_ONLINE} l="Online advance" sub="Paid by players in the app" v={rs(data.online)} />
          {data.pcoin > 0 && <MoneyRow dot="#7C3AED" l="PCoin top-up" sub="PlayOn pays this for players' coins" v={`+ ${rs(data.pcoin)}`} c="#7C3AED" />}
          <MoneyRow dot={C_TURF} l="Collected at turf" sub="Rest of the bill, after the game" v={rs(data.atTurf)} />
          <MoneyRow dot={C_WALK} l="Walk-in bookings" sub={`${data.walkCount} booking${data.walkCount === 1 ? "" : "s"} you added`} v={rs(data.walk)} />
          <MoneyRow l="Total earned" v={rs(data.total)} bold last />
          {data.toCollect > 0 && (
            <View style={s.collect}>
              <View style={{ flex: 1 }}>
                <Text style={s.collectT}>Still to collect at turf</Text>
                <Text style={s.collectS}>{data.toCollectCount} upcoming booking{data.toCollectCount === 1 ? "" : "s"}</Text>
              </View>
              <Text style={s.collectV}>{rs(data.toCollect)}</Text>
            </View>
          )}
          <Text style={s.hint}>At-turf money is counted once the game time is over.</Text>
        </Card>

        {/* ── Offers ── */}
        <Card>
          <CardTitle t="🎉 Offers" sub={rangeLabel} />
          {data.offerCount === 0 ? (
            <Text style={[s.hint, { marginTop: 8 }]}>No booking used an offer in these days. Offers bring more players on slow days.</Text>
          ) : (
            <>
              <View style={s.offBoxes}>
                <View style={[s.offBox, { backgroundColor: "#F0FDF4" }]}>
                  <Text style={[s.offNum, { color: BRAND }]}>{data.offerCount}</Text>
                  <Text style={[s.offLbl, { color: "#166534" }]}>bookings used an offer</Text>
                </View>
                <View style={[s.offBox, { backgroundColor: "#FFF7ED" }]}>
                  <Text style={[s.offNum, { color: "#C2410C" }]}>{rs(data.offerGiven)}</Text>
                  <Text style={[s.offLbl, { color: "#9A3412" }]}>discount you gave</Text>
                </View>
              </View>
              {data.offers.map((o, i) => (
                <MoneyRow key={o.title} l={o.title} sub={`${o.count} booking${o.count === 1 ? "" : "s"} · ${rs(o.earned)} earned`}
                  v={`${rs(o.discount)} off`} c="#C2410C" last={i === data.offers.length - 1} />
              ))}
              <Text style={s.hint}>Offers come off what players pay at the turf. Your online payout is not changed.</Text>
            </>
          )}
          <TouchableOpacity style={s.offBtn} onPress={() => router.push("/(owner)/offer" as any)}>
            <Text style={s.offBtnTxt}>Manage offers</Text>
          </TouchableOpacity>
        </Card>

        {/* ── By turf ── */}
        {data.byTurf.length > 0 && (
          <Card>
            <CardTitle t="By turf" />
            {data.byTurf.map(t => (
              <View key={t.name} style={{ paddingVertical: 8 }}>
                <View style={s.turfRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.turfName} numberOfLines={1}>{t.name}</Text>
                    <Text style={s.turfSub}>{t.count} booking{t.count === 1 ? "" : "s"}</Text>
                  </View>
                  <Text style={s.turfAmt}>{rs(t.amount)}</Text>
                </View>
                <View style={s.track}><View style={[s.fill, { width: `${Math.round((t.amount / maxTurf) * 100)}%` }]} /></View>
              </View>
            ))}
          </Card>
        )}

        {/* ── Booking mix ── */}
        {mixTotal > 0 && (
          <Card>
            <CardTitle t="Booking mix" />
            <View style={s.mixBar}>
              {data.fullCount > 0 && <View style={{ flex: data.fullCount, backgroundColor: "#8B5CF6" }} />}
              {data.advCount > 0 && <View style={{ flex: data.advCount, backgroundColor: "#3B82F6" }} />}
              {data.walkCount > 0 && <View style={{ flex: data.walkCount, backgroundColor: C_WALK }} />}
              {data.cancelCount > 0 && <View style={{ flex: data.cancelCount, backgroundColor: "#F87171" }} />}
            </View>
            <Mix c="#8B5CF6" l="Full payment" n={data.fullCount} t={mixTotal} />
            <Mix c="#3B82F6" l="Advance" n={data.advCount} t={mixTotal} />
            <Mix c={C_WALK} l="Walk-in" n={data.walkCount} t={mixTotal} />
            <Mix c="#F87171" l="Cancelled" n={data.cancelCount} t={mixTotal} />
          </Card>
        )}
      </ScrollView>
    </View>
  );
}

// ── Pieces ──────────────────────────────────────────────────────────────────
function Stat({ v, l, c }: { v: string; l: string; c: string }) {
  return (
    <View style={s.stat}>
      <Text style={[s.statV, { color: c }]} numberOfLines={1} adjustsFontSizeToFit>{v}</Text>
      <Text style={s.statL}>{l}</Text>
    </View>
  );
}
function Card({ children }: { children: React.ReactNode }) { return <View style={s.card}>{children}</View>; }
function CardTitle({ t, sub }: { t: string; sub?: string }) {
  return (
    <View style={s.cardHead}>
      <Text style={s.cardTitle}>{t}</Text>
      {!!sub && <Text style={s.cardSub}>{sub}</Text>}
    </View>
  );
}
function Legend({ c, l }: { c: string; l: string }) {
  return <View style={s.legItem}><View style={[s.sq, { backgroundColor: c }]} /><Text style={s.legTxt}>{l}</Text></View>;
}
function MoneyRow({ l, v, sub, c, dot, bold, last }: { l: string; v: string; sub?: string; c?: string; dot?: string; bold?: boolean; last?: boolean }) {
  return (
    <View style={[s.mRow, last && { borderBottomWidth: 0 }]}>
      {!!dot && <View style={[s.sq, { backgroundColor: dot, marginTop: 4 }]} />}
      <View style={{ flex: 1 }}>
        <Text style={[s.mLbl, bold && { color: INK, fontWeight: "900" }]} numberOfLines={1}>{l}</Text>
        {!!sub && <Text style={s.mSub}>{sub}</Text>}
      </View>
      <Text style={[s.mVal, bold && { fontSize: 17 }, c ? { color: c } : null]}>{v}</Text>
    </View>
  );
}
function Mix({ c, l, n, t }: { c: string; l: string; n: number; t: number }) {
  return (
    <View style={s.mixRow}>
      <View style={[s.sq, { backgroundColor: c }]} />
      <Text style={s.mixL}>{l}</Text>
      <Text style={s.mixN}>{n}</Text>
      <Text style={s.mixP}>{t ? Math.round((n / t) * 100) : 0}%</Text>
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
  payBtn: { flexDirection: "row", alignItems: "center", gap: 4, height: 40, paddingHorizontal: 12, borderRadius: 12, backgroundColor: "#fff" },
  payTxt: { fontSize: 12.5, fontWeight: "800", color: BRAND },

  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 14 },
  chip: { height: 34, paddingHorizontal: 13, borderRadius: 999, backgroundColor: "rgba(255,255,255,0.14)", justifyContent: "center" },
  chipOn: { backgroundColor: "#fff" },
  chipTxt: { fontSize: 12.5, fontWeight: "800", color: ON_BRAND },
  chipTxtOn: { color: BRAND },

  totLbl: { fontSize: 12, fontWeight: "700", color: ON_BRAND, marginTop: 16 },
  totRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  tot: { fontSize: 36, fontWeight: "900", color: "#fff", letterSpacing: -1, maxWidth: "65%" },
  chg: { backgroundColor: "rgba(255,255,255,0.18)", borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  chgTxt: { fontSize: 11.5, fontWeight: "800", color: "#fff" },
  totSub: { fontSize: 12, fontWeight: "600", color: ON_BRAND },
  stats: { flexDirection: "row", gap: 6, marginTop: 12 },
  stat: { flex: 1, backgroundColor: INK, borderRadius: 14, paddingVertical: 10, paddingHorizontal: 6, alignItems: "center" },
  statV: { fontSize: 15, fontWeight: "900" },
  statL: { fontSize: 9.5, fontWeight: "800", color: FAINT, letterSpacing: 0.4, marginTop: 2 },

  card: { backgroundColor: "#fff", borderRadius: 18, marginHorizontal: 16, marginTop: 12, padding: 16, shadowColor: INK, shadowOpacity: 0.05, shadowRadius: 10, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  cardHead: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" },
  cardTitle: { fontSize: 15, fontWeight: "900", color: INK },
  cardSub: { fontSize: 11.5, fontWeight: "700", color: FAINT },
  cardFoot: { marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: "#F1F5F9" },
  footTxt: { fontSize: 12, fontWeight: "700", color: "#334155" },
  hint: { fontSize: 11.5, fontWeight: "600", color: MUTED, marginTop: 8 },

  bars: { flexDirection: "row", alignItems: "flex-end", height: 140, gap: 3, marginTop: 12 },
  barCol: { flex: 1, alignItems: "center", justifyContent: "flex-end", height: 140 },
  barStack: { width: "72%", borderRadius: 4, overflow: "hidden", justifyContent: "flex-end" },
  barLbl: { fontSize: 9.5, fontWeight: "700", color: FAINT, marginTop: 4, height: 13 },
  legend: { flexDirection: "row", gap: 12, marginTop: 10 },
  legItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  legTxt: { fontSize: 11, fontWeight: "700", color: SLATE },
  sq: { width: 9, height: 9, borderRadius: 3 },

  mRow: { flexDirection: "row", alignItems: "flex-start", gap: 8, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: "#F1F5F9" },
  mLbl: { fontSize: 13.5, fontWeight: "700", color: "#334155" },
  mSub: { fontSize: 11, fontWeight: "600", color: FAINT, marginTop: 1 },
  mVal: { fontSize: 14, fontWeight: "900", color: INK },

  collect: { marginTop: 10, flexDirection: "row", alignItems: "center", backgroundColor: "#FFF7ED", borderWidth: 1, borderColor: "#FED7AA", borderRadius: 12, padding: 12 },
  collectT: { fontSize: 12.5, fontWeight: "800", color: "#9A3412" },
  collectS: { fontSize: 11, fontWeight: "600", color: "#C2410C" },
  collectV: { fontSize: 17, fontWeight: "900", color: "#9A3412" },

  offBoxes: { flexDirection: "row", gap: 8, marginTop: 10, marginBottom: 4 },
  offBox: { flex: 1, borderRadius: 12, padding: 10 },
  offNum: { fontSize: 18, fontWeight: "900" },
  offLbl: { fontSize: 11, fontWeight: "700" },
  offBtn: { marginTop: 12, height: 44, borderRadius: 12, borderWidth: 1, borderColor: "#BBF7D0", backgroundColor: "#F0FDF4", alignItems: "center", justifyContent: "center" },
  offBtnTxt: { fontSize: 13, fontWeight: "800", color: BRAND },

  turfRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  turfName: { fontSize: 13.5, fontWeight: "900", color: INK },
  turfSub: { fontSize: 11, fontWeight: "600", color: FAINT },
  turfAmt: { fontSize: 14, fontWeight: "900", color: INK },
  track: { height: 6, borderRadius: 3, backgroundColor: "#F1F5F9", marginTop: 6, overflow: "hidden" },
  fill: { height: 6, borderRadius: 3, backgroundColor: C_ONLINE },

  mixBar: { flexDirection: "row", height: 10, borderRadius: 5, overflow: "hidden", marginTop: 12, marginBottom: 6, backgroundColor: "#F1F5F9" },
  mixRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6 },
  mixL: { flex: 1, fontSize: 13, fontWeight: "700", color: "#334155" },
  mixN: { fontSize: 13, fontWeight: "900", color: INK },
  mixP: { width: 40, textAlign: "right", fontSize: 12, fontWeight: "700", color: FAINT },
});
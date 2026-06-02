/**
 * admin/owner-payouts.tsx
 * 
 * Full owner payout management screen.
 * - See every owner with their personal details + banking
 * - Pick any date range → see exactly how much Razorpay collected per owner
 * - Mark a date range as "paid" with a checkmark + notes
 * - Full history of past settlements
 */
import {
  View, Text, StyleSheet, SafeAreaView, StatusBar, FlatList,
  TouchableOpacity, TextInput, Alert, ActivityIndicator,
  RefreshControl, Modal, ScrollView, Switch, Platform,
} from "react-native";
import { useEffect, useMemo, useState } from "react";
import { db, auth } from "../../firebaseConfig";
import {
  collection, getDocs, query, where, doc,
  addDoc, updateDoc, serverTimestamp, orderBy,
} from "firebase/firestore";
import { Ionicons } from "@expo/vector-icons";

// ── Constants ─────────────────────────────────────────────────────────────────
const DARK       = "#0A0F1E";
const ACCENT     = "#0EA5A4";
const GREEN      = "#22C55E";
const COMMISSION = 0.05; // 5%
const RZP_FEE    = 0.02; // 2%

// ── Types ─────────────────────────────────────────────────────────────────────
type Banking = { accountNo?: string; ifsc?: string; name?: string; upi?: string | null; verified?: boolean; };
type Owner   = { id: string; name?: string; email?: string; phone?: string; businessName?: string; location?: string; status?: string; banking?: Banking; };
type Turf    = { id: string; name?: string; ownerId?: string; };
type Booking = { id: string; turfId?: string; turfName?: string; ownerId?: string; date?: any; dateString?: string; status?: string; bookingType?: string; paidAmount?: number; advanceAmount?: number; totalAmount?: number; remainingAmount?: number; userName?: string; };
type Settlement = { id: string; ownerId: string; ownerName?: string; startDate: string; endDate: string; onlineCollected: number; commission: number; rzpFee: number; ownerPayable: number; bookingCount: number; paidAt?: any; notes?: string; paidBy?: string; };

// ── Helpers ───────────────────────────────────────────────────────────────────
function getSafeDate(val: any): Date | null {
  if (!val) return null;
  if (typeof val?.toDate === "function") return val.toDate();
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
}
function toMid(d: Date) { const c = new Date(d); c.setHours(0,0,0,0); return c; }
function fmtMoney(n: number) { return `₹${Math.round(n).toLocaleString("en-IN")}`; }
function fmtDate(d: Date) { return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }); }
function fmtDateShort(d: Date) { return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" }); }
function initials(name: string) { return (name||"?").split(" ").map(w=>w[0]).join("").toUpperCase().slice(0,2); }
function avatarColor(name: string) {
  const c = ["#0F766E","#0369A1","#7C3AED","#B45309","#BE185D","#15803D"];
  let h=0; for(const ch of name) h+=ch.charCodeAt(0);
  return c[h%c.length];
}
function getOnlinePaid(b: Booking) { return Number(b.paidAmount ?? b.advanceAmount ?? 0); }

// ── Calendar picker (simple inline) ──────────────────────────────────────────
function DatePicker({ label, value, onChange }: { label: string; value: Date; onChange: (d: Date) => void }) {
  const [show, setShow] = useState(false);
  const [year,  setYear]  = useState(value.getFullYear());
  const [month, setMonth] = useState(value.getMonth());

  const days = useMemo(() => {
    const first = new Date(year, month, 1).getDay();
    const total = new Date(year, month+1, 0).getDate();
    const arr: (number|null)[] = Array(first).fill(null);
    for (let d=1; d<=total; d++) arr.push(d);
    return arr;
  }, [year, month]);

  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

  return (
    <View>
      <Text style={dp.lbl}>{label}</Text>
      <TouchableOpacity style={dp.btn} onPress={() => setShow(v=>!v)}>
        <Ionicons name="calendar-outline" size={15} color={ACCENT} />
        <Text style={dp.btnTxt}>{fmtDate(value)}</Text>
        <Ionicons name={show ? "chevron-up" : "chevron-down"} size={13} color="#9CA3AF" />
      </TouchableOpacity>
      {show && (
        <View style={dp.cal}>
          <View style={dp.calNav}>
            <TouchableOpacity onPress={() => { if(month===0){setMonth(11);setYear(y=>y-1);}else setMonth(m=>m-1); }}>
              <Ionicons name="chevron-back" size={18} color={DARK} />
            </TouchableOpacity>
            <Text style={dp.calMonth}>{MONTHS[month]} {year}</Text>
            <TouchableOpacity onPress={() => { if(month===11){setMonth(0);setYear(y=>y+1);}else setMonth(m=>m+1); }}>
              <Ionicons name="chevron-forward" size={18} color={DARK} />
            </TouchableOpacity>
          </View>
          <View style={dp.calGrid}>
            {["Su","Mo","Tu","We","Th","Fr","Sa"].map(d => <Text key={d} style={dp.calDayHdr}>{d}</Text>)}
            {days.map((d, i) => {
              if (!d) return <View key={`e${i}`} style={dp.calCell} />;
              const selected = d === value.getDate() && month === value.getMonth() && year === value.getFullYear();
              return (
                <TouchableOpacity key={d} style={[dp.calCell, selected && dp.calCellSel]}
                  onPress={() => { onChange(new Date(year, month, d)); setShow(false); }}>
                  <Text style={[dp.calDayTxt, selected && dp.calDayTxtSel]}>{d}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      )}
    </View>
  );
}

// ── Main Screen ───────────────────────────────────────────────────────────────
export default function AdminOwnerPayouts() {
  const [owners,      setOwners]      = useState<Owner[]>([]);
  const [turfs,       setTurfs]       = useState<Turf[]>([]);
  const [bookings,    setBookings]    = useState<Booking[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [refreshing,  setRefreshing]  = useState(false);
  const [search,      setSearch]      = useState("");

  // Selected owner detail
  const [selOwner,    setSelOwner]    = useState<Owner | null>(null);
  const [detailModal, setDetailModal] = useState(false);

  // Date range for this owner's payout
  const [startDate, setStartDate] = useState<Date>(() => {
    const d = new Date(); d.setDate(d.getDate() - 6); d.setHours(0,0,0,0); return d;
  });
  const [endDate, setEndDate] = useState<Date>(() => {
    const d = new Date(); d.setHours(23,59,59,999); return d;
  });

  // Mark paid modal
  const [payModal,  setPayModal]  = useState(false);
  const [payNotes,  setPayNotes]  = useState("");
  const [payMethod, setPayMethod] = useState("Bank Transfer");
  const [paying,    setPaying]    = useState(false);

  useEffect(() => { fetchAll(); }, []);

  const fetchAll = async (isRefresh = false) => {
    isRefresh ? setRefreshing(true) : setLoading(true);
    try {
      const [ownerSnap, turfSnap, bookSnap, settlSnap] = await Promise.all([
        getDocs(query(collection(db, "users"), where("role", "==", "owner"))),
        getDocs(collection(db, "turfs")),
        getDocs(collection(db, "bookings")),
        getDocs(collection(db, "ownerSettlements")),
      ]);
      setOwners(ownerSnap.docs.map(d => ({ id: d.id, ...d.data() } as Owner)));
      setTurfs(turfSnap.docs.map(d => ({ id: d.id, ...d.data() } as Turf)));
      setBookings(bookSnap.docs.map(d => ({ id: d.id, ...d.data() } as Booking)));
      setSettlements(settlSnap.docs.map(d => ({ id: d.id, ...d.data() } as Settlement)));
    } catch { Alert.alert("Error", "Could not load data."); }
    finally { setLoading(false); setRefreshing(false); }
  };

  // ── Per-owner turf names ──────────────────────────────────────────────────
  const ownerTurfs = useMemo(() => {
    const map: Record<string, Turf[]> = {};
    turfs.forEach(t => { if (t.ownerId) { if (!map[t.ownerId]) map[t.ownerId] = []; map[t.ownerId].push(t); } });
    return map;
  }, [turfs]);

  // ── Earnings for the selected owner in the chosen date range ─────────────
  const earnings = useMemo(() => {
    if (!selOwner) return null;
    const start = toMid(startDate);
    const end   = new Date(endDate); end.setHours(23,59,59,999);

    const relevant = bookings.filter(b => {
      if (b.ownerId !== selOwner.id) return false;
      if (b.status === "cancelled")  return false;
      const d = getSafeDate(b.date || b.dateString);
      if (!d) return false;
      return d >= start && d <= end;
    });

    const online = relevant.reduce((sum, b) => sum + getOnlinePaid(b), 0);
    const comm   = Math.round(online * COMMISSION);
    const rzp    = Math.round(online * RZP_FEE);
    const payable = Math.max(online - comm - rzp, 0);

    // Per turf breakdown
    const turfMap: Record<string, { name: string; online: number; count: number }> = {};
    relevant.forEach(b => {
      const tid = b.turfId || "unknown";
      if (!turfMap[tid]) turfMap[tid] = { name: b.turfName || "Unknown", online: 0, count: 0 };
      turfMap[tid].online += getOnlinePaid(b);
      turfMap[tid].count++;
    });

    return { online, comm, rzp, payable, count: relevant.length, turfBreakdown: Object.values(turfMap), bookings: relevant };
  }, [selOwner, bookings, startDate, endDate]);

  // ── Settlements for selected owner ───────────────────────────────────────
  const ownerSettlements = useMemo(() =>
    settlements
      .filter(s => s.ownerId === selOwner?.id)
      .sort((a, b) => {
        const da = getSafeDate(a.paidAt)?.getTime() || 0;
        const db_ = getSafeDate(b.paidAt)?.getTime() || 0;
        return db_ - da;
      }),
    [settlements, selOwner]
  );

  // ── Mark as paid ─────────────────────────────────────────────────────────
  const markPaid = async () => {
    if (!selOwner || !earnings) return;
    setPaying(true);
    try {
      const adminUser = auth.currentUser;
      await addDoc(collection(db, "ownerSettlements"), {
        ownerId:         selOwner.id,
        ownerName:       selOwner.name || "",
        ownerEmail:      selOwner.email || "",
        startDate:       fmtDate(startDate),
        endDate:         fmtDate(endDate),
        startDateISO:    startDate.toISOString(),
        endDateISO:      endDate.toISOString(),
        onlineCollected: earnings.online,
        commission:      earnings.comm,
        rzpFee:          earnings.rzp,
        ownerPayable:    earnings.payable,
        bookingCount:    earnings.count,
        paymentMethod:   payMethod,
        notes:           payNotes.trim(),
        paidBy:          adminUser?.email || "admin",
        paidAt:          serverTimestamp(),
        banking: {
          accountNo: selOwner.banking?.accountNo || "",
          ifsc:      selOwner.banking?.ifsc      || "",
          name:      selOwner.banking?.name      || "",
          upi:       selOwner.banking?.upi       || null,
        },
      });
      setPayModal(false);
      setPayNotes("");
      await fetchAll(true);
      Alert.alert("Payment Recorded ✓", `₹${Math.round(earnings.payable).toLocaleString("en-IN")} marked as paid to ${selOwner.name}.`);
    } catch (e: any) {
      Alert.alert("Error", e.message || "Could not save.");
    } finally { setPaying(false); }
  };

  // ── Filtered owner list ───────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return owners;
    return owners.filter(o =>
      [o.name, o.email, o.phone, o.businessName, o.location]
        .some(f => f?.toLowerCase().includes(q))
    );
  }, [owners, search]);

  const openDetail = (o: Owner) => {
    setSelOwner(o);
    const end = new Date(); end.setHours(23,59,59,999);
    const start = new Date(); start.setDate(start.getDate() - 6); start.setHours(0,0,0,0);
    setStartDate(start); setEndDate(end);
    setDetailModal(true);
  };

  // ── Render owner card ─────────────────────────────────────────────────────
  const renderOwner = ({ item }: { item: Owner }) => {
    const color    = avatarColor(item.name || "?");
    const isActive = item.status === "active";
    const ownTurfs = ownerTurfs[item.id] || [];
    const hasBanking = !!item.banking?.accountNo;
    const lastSettlement = settlements
      .filter(s => s.ownerId === item.id)
      .sort((a, b) => (getSafeDate(b.paidAt)?.getTime()||0) - (getSafeDate(a.paidAt)?.getTime()||0))[0];

    return (
      <TouchableOpacity style={s.card} onPress={() => openDetail(item)} activeOpacity={0.85}>
        <View style={[s.cardAccent, { backgroundColor: isActive ? ACCENT : "#9CA3AF" }]} />
        <View style={s.cardBody}>
          <View style={s.cardTop}>
            <View style={[s.avatar, { backgroundColor: color }]}>
              <Text style={s.avatarTxt}>{initials(item.name||"?")}</Text>
            </View>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={s.ownerName}>{item.name || "—"}</Text>
              <Text style={s.ownerBiz}>{item.businessName || item.email}</Text>
              <Text style={s.ownerPhone}>{item.phone || "No phone"}</Text>
            </View>
            <View style={s.cardRight}>
              {/* Bank status */}
              <View style={[s.bankPill, hasBanking ? (item.banking?.verified ? s.bankOk : s.bankWarn) : s.bankMissing]}>
                <Ionicons name={hasBanking ? (item.banking?.verified ? "shield-checkmark" : "shield-outline") : "card-outline"} size={10}
                  color={hasBanking ? (item.banking?.verified ? "#15803D" : "#B45309") : "#9CA3AF"} />
                <Text style={[s.bankPillTxt, { color: hasBanking ? (item.banking?.verified ? "#15803D" : "#B45309") : "#9CA3AF" }]}>
                  {hasBanking ? (item.banking?.verified ? "Verified" : "Unverified") : "No Bank"}
                </Text>
              </View>
              {/* Turfs count */}
              <Text style={s.turfCount}>{ownTurfs.length} turf{ownTurfs.length !== 1 ? "s" : ""}</Text>
            </View>
          </View>

          {/* Turf chips */}
          {ownTurfs.length > 0 && (
            <View style={s.turfRow}>
              {ownTurfs.slice(0, 3).map(t => (
                <View key={t.id} style={s.turfChip}>
                  <Text style={s.turfChipTxt}>{t.name}</Text>
                </View>
              ))}
              {ownTurfs.length > 3 && <Text style={s.turfMore}>+{ownTurfs.length - 3}</Text>}
            </View>
          )}

          {/* Last settlement */}
          {lastSettlement ? (
            <View style={s.lastSettleRow}>
              <Ionicons name="checkmark-circle" size={13} color={GREEN} />
              <Text style={s.lastSettleTxt}>
                Last paid {fmtMoney(lastSettlement.ownerPayable)} · {lastSettlement.endDate}
              </Text>
            </View>
          ) : (
            <View style={s.lastSettleRow}>
              <Ionicons name="time-outline" size={13} color="#9CA3AF" />
              <Text style={[s.lastSettleTxt, { color: "#9CA3AF" }]}>No settlements yet</Text>
            </View>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  // ── Aggregate stats for hero — MUST be before any early return ──────────
  const heroStats = useMemo(() => {
    const thisWeekStart = new Date(); thisWeekStart.setDate(thisWeekStart.getDate()-6); thisWeekStart.setHours(0,0,0,0);
    const thisWeekEnd   = new Date(); thisWeekEnd.setHours(23,59,59,999);
    let weeklyOnline = 0;
    bookings.forEach(b => {
      if (b.status === "cancelled") return;
      const d = getSafeDate(b.date || b.dateString);
      if (d && d >= thisWeekStart && d <= thisWeekEnd) weeklyOnline += getOnlinePaid(b);
    });
    const totalPayable = Math.round(weeklyOnline * (1 - COMMISSION - RZP_FEE));
    const noBank = owners.filter(o => !o.banking?.accountNo).length;
    const unverified = owners.filter(o => o.banking?.accountNo && !o.banking?.verified).length;
    return { weeklyOnline, totalPayable, noBank, unverified };
  }, [bookings, owners]);

  if (loading) return (
    <SafeAreaView style={s.loadWrap}>
      <StatusBar barStyle="light-content" backgroundColor={DARK} />
      <ActivityIndicator size="large" color={ACCENT} />
      <Text style={s.loadTxt}>Loading owner data...</Text>
    </SafeAreaView>
  );

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="light-content" backgroundColor={DARK} />

      <FlatList
        data={filtered}
        keyExtractor={i => i.id}
        renderItem={renderOwner}
        contentContainerStyle={s.list}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => fetchAll(true)} tintColor={ACCENT} />}
        ListHeaderComponent={
          <View>
            {/* Hero */}
            <View style={s.hero}>
              <View style={s.heroGlow1} /><View style={s.heroGlow2} />
              <Text style={s.heroTag}>Admin · Payouts</Text>
              <Text style={s.heroTitle}>Owner Payouts</Text>
              <Text style={s.heroSub}>Manage settlements, view banking details, and track payment history.</Text>
              <View style={s.heroStats}>
                {[
                  { label: "This week online", value: fmtMoney(heroStats.weeklyOnline), color: "#60A5FA" },
                  { label: "Payable to owners", value: fmtMoney(heroStats.totalPayable), color: GREEN },
                  { label: "No bank details",  value: String(heroStats.noBank), color: "#FBBF24" },
                  { label: "Bank unverified",  value: String(heroStats.unverified), color: "#F87171" },
                ].map(st => (
                  <View key={st.label} style={s.heroStat}>
                    <Text style={[s.heroStatVal, { color: st.color }]}>{st.value}</Text>
                    <Text style={s.heroStatLbl}>{st.label}</Text>
                  </View>
                ))}
              </View>
            </View>

            {/* Search */}
            <View style={s.toolbar}>
              <View style={s.searchWrap}>
                <Ionicons name="search-outline" size={15} color="#9CA3AF" style={{ marginRight: 8 }} />
                <TextInput style={s.searchInput} placeholder="Search owner, business, phone..."
                  placeholderTextColor="#9CA3AF" value={search} onChangeText={setSearch} />
              </View>
            </View>
            <Text style={s.subHeader}>{filtered.length} owner{filtered.length!==1?"s":""} · tap to manage payout</Text>
          </View>
        }
        ListEmptyComponent={
          <View style={s.empty}>
            <Ionicons name="people-outline" size={40} color="#D1D5DB" />
            <Text style={s.emptyTitle}>No owners found</Text>
          </View>
        }
      />

      {/* ══ OWNER DETAIL + PAYOUT MODAL ═══════════════════════════════════════ */}
      <Modal visible={detailModal} animationType="slide" onRequestClose={() => setDetailModal(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: "#F0F4F8" }}>
          <StatusBar barStyle="dark-content" backgroundColor="#F0F4F8" />
          {selOwner && (
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>

              {/* Header */}
              <View style={dm.header}>
                <TouchableOpacity style={dm.backBtn} onPress={() => setDetailModal(false)}>
                  <Ionicons name="arrow-back" size={20} color={DARK} />
                </TouchableOpacity>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={dm.headerTitle}>{selOwner.name}</Text>
                  <Text style={dm.headerSub}>{selOwner.businessName || selOwner.email}</Text>
                </View>
                <View style={[dm.statusPill, selOwner.status === "active" ? dm.pillActive : dm.pillInactive]}>
                  <Text style={[dm.statusTxt, { color: selOwner.status === "active" ? "#15803D" : "#DC2626" }]}>
                    {selOwner.status === "active" ? "Active" : "Disabled"}
                  </Text>
                </View>
              </View>

              {/* ── Owner Personal Details ── */}
              <View style={dm.card}>
                <Text style={dm.cardTitle}>👤 Owner Details</Text>
                {[
                  { icon: "mail-outline",    label: "Email",    value: selOwner.email    || "—" },
                  { icon: "call-outline",    label: "Phone",    value: selOwner.phone    || "Not added" },
                  { icon: "location-outline",label: "Location", value: selOwner.location || "Not added" },
                ].map(row => (
                  <View key={row.label} style={dm.infoRow}>
                    <View style={dm.infoIcon}><Ionicons name={row.icon as any} size={15} color="#6B7280" /></View>
                    <View style={{ flex: 1 }}>
                      <Text style={dm.infoLbl}>{row.label}</Text>
                      <Text style={dm.infoVal}>{row.value}</Text>
                    </View>
                  </View>
                ))}
              </View>

              {/* ── Banking Details ── */}
              <View style={dm.card}>
                <View style={dm.cardTitleRow}>
                  <Text style={dm.cardTitle}>🏦 Banking Details</Text>
                  {selOwner.banking?.accountNo ? (
                    <View style={[dm.bankBadge, selOwner.banking?.verified ? dm.bankBadgeOk : dm.bankBadgeWarn]}>
                      <Text style={[dm.bankBadgeTxt, { color: selOwner.banking?.verified ? "#15803D" : "#B45309" }]}>
                        {selOwner.banking?.verified ? "Verified ✓" : "Unverified"}
                      </Text>
                    </View>
                  ) : (
                    <View style={dm.bankBadgeMissing}><Text style={dm.bankBadgeMissingTxt}>Not Added</Text></View>
                  )}
                </View>

                {selOwner.banking?.accountNo ? (
                  <>
                    {[
                      { label: "Account Holder", value: selOwner.banking?.name || "—" },
                      { label: "Account Number", value: `••••${selOwner.banking?.accountNo?.slice(-4) || "??"}` },
                      { label: "IFSC Code",      value: selOwner.banking?.ifsc || "—" },
                      { label: "UPI ID",         value: selOwner.banking?.upi  || "Not added" },
                    ].map(row => (
                      <View key={row.label} style={dm.bankRow}>
                        <Text style={dm.bankLbl}>{row.label}</Text>
                        <Text style={dm.bankVal}>{row.value}</Text>
                      </View>
                    ))}
                  </>
                ) : (
                  <View style={dm.bankMissing}>
                    <Ionicons name="alert-circle-outline" size={18} color="#D97706" />
                    <Text style={dm.bankMissingTxt}>No banking details on file. Edit this owner to add them.</Text>
                  </View>
                )}
              </View>

              {/* ── Turfs ── */}
              {(ownerTurfs[selOwner.id] || []).length > 0 && (
                <View style={dm.card}>
                  <Text style={dm.cardTitle}>⚽ Turfs ({(ownerTurfs[selOwner.id]||[]).length})</Text>
                  {(ownerTurfs[selOwner.id]||[]).map(t => (
                    <View key={t.id} style={dm.turfRow}>
                      <View style={dm.turfDot} />
                      <Text style={dm.turfName}>{t.name}</Text>
                    </View>
                  ))}
                </View>
              )}

              {/* ── Payout Calculator ── */}
              <View style={[dm.card, { borderColor: ACCENT + "44", borderWidth: 1.5 }]}>
                <Text style={dm.cardTitle}>💰 Calculate Payout</Text>
                <Text style={dm.cardSub}>Choose a date range to see Razorpay collections</Text>

                <DatePicker label="From" value={startDate} onChange={setStartDate} />
                <View style={{ height: 10 }} />
                <DatePicker label="To"   value={endDate}   onChange={setEndDate} />

                {/* Quick presets */}
                <View style={dm.presetsRow}>
                  {[
                    { label: "This week", days: 6 },
                    { label: "Last 7d",   days: 7 },
                    { label: "Last 14d",  days: 14 },
                    { label: "This month",days: -1 },
                  ].map(p => (
                    <TouchableOpacity key={p.label} style={dm.presetChip}
                      onPress={() => {
                        const end = new Date(); end.setHours(23,59,59,999);
                        let start: Date;
                        if (p.days === -1) { start = new Date(new Date().getFullYear(), new Date().getMonth(), 1); }
                        else { start = new Date(); start.setDate(start.getDate() - p.days); }
                        start.setHours(0,0,0,0);
                        setStartDate(start); setEndDate(end);
                      }}>
                      <Text style={dm.presetChipTxt}>{p.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {earnings && earnings.count > 0 ? (
                  <View style={dm.earningsBox}>
                    <Text style={dm.earningsTitle}>
                      {earnings.count} booking{earnings.count!==1?"s":""} · {fmtDateShort(startDate)} – {fmtDateShort(endDate)}
                    </Text>

                    {/* Per-turf breakdown */}
                    {earnings.turfBreakdown.map(t => (
                      <View key={t.name} style={dm.turfEarnRow}>
                        <Ionicons name="football-outline" size={12} color="#6B7280" />
                        <Text style={dm.turfEarnName}>{t.name}</Text>
                        <Text style={dm.turfEarnCount}>{t.count} bookings</Text>
                        <Text style={dm.turfEarnAmt}>{fmtMoney(Math.round(t.online))}</Text>
                      </View>
                    ))}

                    <View style={dm.divider} />

                    {/* Calculation */}
                    {[
                      { label: "Online collected (Razorpay)", value: fmtMoney(earnings.online), color: "#2563EB", bold: false },
                      { label: `− Razorpay fee (2%)`,          value: `− ${fmtMoney(earnings.rzp)}`,  color: "#DC2626", bold: false },
                      { label: `− Platform commission (5%)`,   value: `− ${fmtMoney(earnings.comm)}`, color: "#7C3AED", bold: false },
                    ].map(row => (
                      <View key={row.label} style={dm.calcRow}>
                        <Text style={dm.calcLbl}>{row.label}</Text>
                        <Text style={[dm.calcVal, { color: row.color }]}>{row.value}</Text>
                      </View>
                    ))}

                    <View style={dm.payableBox}>
                      <Text style={dm.payableLbl}>Transfer to {selOwner.name}</Text>
                      <Text style={dm.payableAmt}>{fmtMoney(earnings.payable)}</Text>
                    </View>

                    {selOwner.banking?.accountNo && (
                      <View style={dm.bankHint}>
                        <Ionicons name="information-circle-outline" size={14} color={ACCENT} />
                        <Text style={dm.bankHintTxt}>
                          {selOwner.banking.upi
                            ? `Pay via UPI: ${selOwner.banking.upi}`
                            : `Bank: ${selOwner.banking.ifsc} · ••••${selOwner.banking.accountNo.slice(-4)}`}
                        </Text>
                      </View>
                    )}

                    <TouchableOpacity style={dm.markPaidBtn} onPress={() => setPayModal(true)}>
                      <Ionicons name="checkmark-circle-outline" size={18} color="#fff" />
                      <Text style={dm.markPaidTxt}>Mark as Paid</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <View style={dm.noEarnings}>
                    <Ionicons name="receipt-outline" size={28} color="#D1D5DB" />
                    <Text style={dm.noEarningsTxt}>No online bookings in this period</Text>
                  </View>
                )}
              </View>

              {/* ── Settlement History ── */}
              <View style={dm.card}>
                <Text style={dm.cardTitle}>📋 Payment History ({ownerSettlements.length})</Text>
                {ownerSettlements.length === 0 ? (
                  <Text style={dm.noHistoryTxt}>No settlements recorded yet.</Text>
                ) : (
                  ownerSettlements.map((st, i) => {
                    const paidDate = getSafeDate(st.paidAt);
                    return (
                      <View key={st.id} style={[dm.histRow, i===ownerSettlements.length-1 && { borderBottomWidth: 0 }]}>
                        <View style={dm.histDone}>
                          <Ionicons name="checkmark-circle" size={18} color={GREEN} />
                        </View>
                        <View style={{ flex: 1, marginLeft: 10 }}>
                          <Text style={dm.histPeriod}>{st.startDate} → {st.endDate}</Text>
                          <Text style={dm.histMeta}>
                            {st.bookingCount} bookings · {st.paymentMethod || "Bank Transfer"}
                            {st.notes ? ` · "${st.notes}"` : ""}
                          </Text>
                          {paidDate && <Text style={dm.histDate}>Paid on {fmtDate(paidDate)} by {st.paidBy || "admin"}</Text>}
                        </View>
                        <Text style={dm.histAmt}>{fmtMoney(st.ownerPayable)}</Text>
                      </View>
                    );
                  })
                )}
              </View>
            </ScrollView>
          )}
        </SafeAreaView>
      </Modal>

      {/* ══ MARK PAID MODAL ════════════════════════════════════════════════════ */}
      <Modal visible={payModal} animationType="slide" transparent onRequestClose={() => setPayModal(false)}>
        <View style={pm.backdrop}>
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => setPayModal(false)} />
          <View style={pm.sheet}>
            <View style={pm.handle} />
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <Text style={pm.title}>Record Payment</Text>
              {earnings && selOwner && (
                <View style={pm.summaryBox}>
                  <Text style={pm.summaryOwner}>{selOwner.name}</Text>
                  <Text style={pm.summaryPeriod}>{fmtDateShort(startDate)} → {fmtDateShort(endDate)}</Text>
                  <Text style={pm.summaryAmt}>{fmtMoney(earnings.payable)}</Text>
                </View>
              )}

              <Text style={pm.lbl}>Payment Method</Text>
              <View style={pm.methodRow}>
                {["Bank Transfer", "UPI", "Cash", "Cheque"].map(m => (
                  <TouchableOpacity key={m} style={[pm.methodChip, payMethod===m && pm.methodChipActive]}
                    onPress={() => setPayMethod(m)}>
                    <Text style={[pm.methodTxt, payMethod===m && pm.methodTxtActive]}>{m}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={pm.lbl}>Notes (Optional)</Text>
              <TextInput
                style={pm.input}
                placeholder="e.g. NEFT ref: TXN123456, UTR: 445566..."
                placeholderTextColor="#9CA3AF"
                value={payNotes}
                onChangeText={setPayNotes}
                multiline
              />

              {selOwner?.banking?.accountNo && (
                <View style={pm.bankInfo}>
                  <Ionicons name="card-outline" size={14} color={ACCENT} />
                  <Text style={pm.bankInfoTxt}>
                    {selOwner.banking.upi
                      ? `UPI: ${selOwner.banking.upi}`
                      : `${selOwner.banking.ifsc} · A/C ••••${selOwner.banking.accountNo.slice(-4)} (${selOwner.banking.name})`}
                  </Text>
                </View>
              )}

              <TouchableOpacity style={[pm.confirmBtn, paying && { opacity: 0.6 }]}
                onPress={markPaid} disabled={paying}>
                {paying ? <ActivityIndicator color="#fff" /> : (
                  <>
                    <Ionicons name="checkmark-circle" size={18} color="#fff" />
                    <Text style={pm.confirmTxt}>Confirm Payment Done</Text>
                  </>
                )}
              </TouchableOpacity>
              <TouchableOpacity style={pm.cancelBtn} onPress={() => setPayModal(false)} disabled={paying}>
                <Text style={pm.cancelTxt}>Cancel</Text>
              </TouchableOpacity>
              <View style={{ height: 16 }} />
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  safe:     { flex: 1, backgroundColor: "#F0F4F8" },
  loadWrap: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: DARK },
  loadTxt:  { color: "#9CA3AF", marginTop: 12, fontSize: 15, fontWeight: "600" },
  list:     { paddingBottom: 100 },
  hero:     { backgroundColor: DARK, paddingHorizontal: 20, paddingTop: Platform.OS === "android" ? (StatusBar.currentHeight||0)+14 : 18, paddingBottom: 28, overflow: "hidden" },
  heroGlow1:{ position: "absolute", top: -40, right: -40, width: 200, height: 200, borderRadius: 100, backgroundColor: "rgba(14,165,164,0.15)" },
  heroGlow2:{ position: "absolute", bottom: -60, left: -40, width: 180, height: 180, borderRadius: 90, backgroundColor: "rgba(124,58,237,0.12)" },
  heroTag:  { color: "#6EE7B7", fontSize: 11, fontWeight: "800", letterSpacing: 1.5, textTransform: "uppercase" },
  heroTitle:{ color: "#fff", fontSize: 28, fontWeight: "900", marginTop: 4 },
  heroSub:  { color: "#9CA3AF", fontSize: 13, lineHeight: 20, marginTop: 6 },
  heroStats:{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 18 },
  heroStat: { backgroundColor: "rgba(255,255,255,0.07)", borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, alignItems: "center", borderWidth: 1, borderColor: "rgba(255,255,255,0.08)" },
  heroStatVal:{ fontSize: 16, fontWeight: "900" },
  heroStatLbl:{ color: "#9CA3AF", fontSize: 10, fontWeight: "600", marginTop: 2, textAlign: "center" },
  toolbar:   { flexDirection: "row", paddingHorizontal: 16, paddingTop: 16, paddingBottom: 4 },
  searchWrap:{ flex: 1, flexDirection: "row", alignItems: "center", backgroundColor: "#fff", borderRadius: 14, paddingHorizontal: 14, borderWidth: 1, borderColor: "#E5E7EB" },
  searchInput:{ flex: 1, paddingVertical: 12, fontSize: 14, color: "#111827" },
  subHeader: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4, fontSize: 12, color: "#9CA3AF", fontWeight: "600" },
  card:      { backgroundColor: "#fff", marginHorizontal: 16, marginBottom: 12, borderRadius: 18, flexDirection: "row", overflow: "hidden", borderWidth: 1, borderColor: "#E5E7EB", shadowColor: "#000", shadowOffset:{width:0,height:2}, shadowOpacity: 0.05, shadowRadius: 6, elevation: 2 },
  cardAccent:{ width: 4 },
  cardBody:  { flex: 1, padding: 14 },
  cardTop:   { flexDirection: "row", alignItems: "flex-start" },
  avatar:    { width: 44, height: 44, borderRadius: 22, justifyContent: "center", alignItems: "center" },
  avatarTxt: { color: "#fff", fontSize: 16, fontWeight: "800" },
  ownerName: { fontSize: 15, fontWeight: "800", color: "#111827" },
  ownerBiz:  { fontSize: 12, color: "#6B7280", marginTop: 2 },
  ownerPhone:{ fontSize: 11, color: "#9CA3AF", marginTop: 1 },
  cardRight: { alignItems: "flex-end", gap: 4 },
  bankPill:  { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  bankOk:    { backgroundColor: "#DCFCE7" },
  bankWarn:  { backgroundColor: "#FEF9C3" },
  bankMissing:{ backgroundColor: "#F3F4F6" },
  bankPillTxt:{ fontSize: 10, fontWeight: "700" },
  turfCount: { fontSize: 11, color: "#9CA3AF", fontWeight: "600" },
  turfRow:   { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 10 },
  turfChip:  { backgroundColor: "#EFF6FF", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  turfChipTxt:{ fontSize: 11, color: "#1E40AF", fontWeight: "700" },
  turfMore:  { fontSize: 11, color: "#9CA3AF", fontWeight: "600", alignSelf: "center" },
  lastSettleRow:{ flexDirection: "row", alignItems: "center", gap: 5, marginTop: 8 },
  lastSettleTxt:{ fontSize: 11, color: "#15803D", fontWeight: "600" },
  empty:     { margin: 16, backgroundColor: "#fff", borderRadius: 20, padding: 32, alignItems: "center" },
  emptyTitle:{ fontSize: 16, fontWeight: "800", color: "#374151", marginTop: 12 },
});

const dm = StyleSheet.create({
  header:     { flexDirection: "row", alignItems: "center", backgroundColor: "#fff", paddingHorizontal: 20, paddingTop: Platform.OS === "android" ? (StatusBar.currentHeight||0)+14 : 18, paddingBottom: 18, borderBottomWidth: 1, borderBottomColor: "#F3F4F6" },
  backBtn:    { width: 38, height: 38, borderRadius: 12, backgroundColor: "#F3F4F6", justifyContent: "center", alignItems: "center" },
  headerTitle:{ fontSize: 18, fontWeight: "900", color: "#111827" },
  headerSub:  { fontSize: 12, color: "#9CA3AF", marginTop: 2 },
  statusPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  pillActive: { backgroundColor: "#DCFCE7" },
  pillInactive:{ backgroundColor: "#FEE2E2" },
  statusTxt:  { fontSize: 11, fontWeight: "800" },
  card:       { backgroundColor: "#fff", marginHorizontal: 16, marginTop: 14, borderRadius: 20, padding: 16, borderWidth: 1, borderColor: "#E5E7EB", shadowColor: "#000", shadowOffset:{width:0,height:2}, shadowOpacity:0.05, shadowRadius:8, elevation:2 },
  cardTitle:  { fontSize: 15, fontWeight: "900", color: "#111827", marginBottom: 12 },
  cardTitleRow:{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  cardSub:    { fontSize: 12, color: "#9CA3AF", marginTop: -8, marginBottom: 12 },
  infoRow:    { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#F9FAFB" },
  infoIcon:   { width: 30, height: 30, borderRadius: 8, backgroundColor: "#F3F4F6", justifyContent: "center", alignItems: "center" },
  infoLbl:    { fontSize: 10, color: "#9CA3AF", fontWeight: "700", textTransform: "uppercase" },
  infoVal:    { fontSize: 14, color: "#111827", fontWeight: "600", marginTop: 1 },
  bankBadge:  { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  bankBadgeOk:{ backgroundColor: "#DCFCE7" },
  bankBadgeWarn:{ backgroundColor: "#FEF9C3" },
  bankBadgeMissing:{ backgroundColor: "#F3F4F6", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  bankBadgeTxt:{ fontSize: 11, fontWeight: "800" },
  bankBadgeMissingTxt:{ fontSize: 11, fontWeight: "700", color: "#9CA3AF" },
  bankRow:    { flexDirection: "row", justifyContent: "space-between", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#F9FAFB" },
  bankLbl:    { fontSize: 12, color: "#9CA3AF", fontWeight: "700" },
  bankVal:    { fontSize: 13, color: "#111827", fontWeight: "700" },
  bankMissing:{ flexDirection: "row", alignItems: "flex-start", gap: 8, backgroundColor: "#FFFBEB", borderRadius: 10, padding: 12 },
  bankMissingTxt:{ fontSize: 12, color: "#92400E", fontWeight: "600", flex: 1 },
  turfRow:    { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#F9FAFB" },
  turfDot:    { width: 8, height: 8, borderRadius: 4, backgroundColor: ACCENT },
  turfName:   { fontSize: 14, fontWeight: "700", color: "#111827" },
  presetsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10, marginBottom: 4 },
  presetChip: { paddingHorizontal: 12, paddingVertical: 6, backgroundColor: "#F3F4F6", borderRadius: 999, borderWidth: 1, borderColor: "#E5E7EB" },
  presetChipTxt:{ fontSize: 12, fontWeight: "700", color: "#374151" },
  earningsBox:{ backgroundColor: "#F0FDF4", borderRadius: 14, padding: 14, marginTop: 12, borderWidth: 1, borderColor: "#BBF7D0" },
  earningsTitle:{ fontSize: 13, fontWeight: "800", color: "#15803D", marginBottom: 10 },
  turfEarnRow:{ flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 5 },
  turfEarnName:{ flex: 1, fontSize: 12, fontWeight: "700", color: "#374151" },
  turfEarnCount:{ fontSize: 11, color: "#9CA3AF" },
  turfEarnAmt:{ fontSize: 13, fontWeight: "800", color: "#111827" },
  divider:    { height: 1, backgroundColor: "#D1FAE5", marginVertical: 10 },
  calcRow:    { flexDirection: "row", justifyContent: "space-between", paddingVertical: 5 },
  calcLbl:    { fontSize: 12, color: "#374151", fontWeight: "600" },
  calcVal:    { fontSize: 13, fontWeight: "800" },
  payableBox: { backgroundColor: "#fff", borderRadius: 12, padding: 12, marginTop: 10, flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderWidth: 1, borderColor: "#D1FAE5" },
  payableLbl: { fontSize: 13, fontWeight: "700", color: "#15803D" },
  payableAmt: { fontSize: 24, fontWeight: "900", color: "#15803D" },
  bankHint:   { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 10, backgroundColor: "#F0FDFA", borderRadius: 8, padding: 10 },
  bankHintTxt:{ fontSize: 11, color: ACCENT, fontWeight: "600", flex: 1 },
  markPaidBtn:{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: DARK, paddingVertical: 14, borderRadius: 14, marginTop: 14 },
  markPaidTxt:{ color: "#fff", fontWeight: "800", fontSize: 14 },
  noEarnings: { alignItems: "center", paddingVertical: 24, gap: 8 },
  noEarningsTxt:{ fontSize: 13, color: "#9CA3AF", fontWeight: "600" },
  histRow:    { flexDirection: "row", alignItems: "flex-start", paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "#F3F4F6" },
  histDone:   { width: 30, alignItems: "center", marginTop: 2 },
  histPeriod: { fontSize: 13, fontWeight: "800", color: "#111827" },
  histMeta:   { fontSize: 11, color: "#6B7280", marginTop: 2 },
  histDate:   { fontSize: 10, color: "#9CA3AF", marginTop: 2 },
  histAmt:    { fontSize: 14, fontWeight: "900", color: "#15803D", alignSelf: "center" },
  noHistoryTxt:{ fontSize: 13, color: "#9CA3AF", fontWeight: "500" },
});

const pm = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet:    { backgroundColor: "#fff", borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 20, paddingTop: 12, paddingBottom: Platform.OS === "ios" ? 34 : 20, maxHeight: "80%" },
  handle:   { width: 40, height: 4, borderRadius: 2, backgroundColor: "#E5E7EB", alignSelf: "center", marginBottom: 16 },
  title:    { fontSize: 20, fontWeight: "900", color: "#111827", marginBottom: 14 },
  summaryBox:{ backgroundColor: "#F0FDF4", borderRadius: 14, padding: 14, marginBottom: 14, borderWidth: 1, borderColor: "#BBF7D0", alignItems: "center" },
  summaryOwner:{ fontSize: 14, fontWeight: "800", color: "#15803D" },
  summaryPeriod:{ fontSize: 12, color: "#6B7280", marginTop: 2 },
  summaryAmt:{ fontSize: 28, fontWeight: "900", color: "#15803D", marginTop: 6 },
  lbl:      { fontSize: 11, fontWeight: "800", color: "#6B7280", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 8, marginTop: 14 },
  methodRow:{ flexDirection: "row", flexWrap: "wrap", gap: 8 },
  methodChip:{ paddingHorizontal: 14, paddingVertical: 8, backgroundColor: "#F3F4F6", borderRadius: 999, borderWidth: 1, borderColor: "#E5E7EB" },
  methodChipActive:{ backgroundColor: DARK, borderColor: DARK },
  methodTxt:{ fontSize: 13, fontWeight: "600", color: "#374151" },
  methodTxtActive:{ color: "#fff" },
  input:    { backgroundColor: "#F9FAFB", borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: "#111827", minHeight: 70, textAlignVertical: "top" },
  bankInfo: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#F0FDFA", borderRadius: 10, padding: 10, marginTop: 10 },
  bankInfoTxt:{ fontSize: 12, color: ACCENT, fontWeight: "600", flex: 1 },
  confirmBtn:{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "#15803D", paddingVertical: 15, borderRadius: 16, marginTop: 16 },
  confirmTxt:{ color: "#fff", fontWeight: "800", fontSize: 15 },
  cancelBtn: { backgroundColor: "#F3F4F6", paddingVertical: 14, borderRadius: 16, alignItems: "center", marginTop: 10 },
  cancelTxt: { color: "#374151", fontWeight: "700", fontSize: 15 },
});

const dp = StyleSheet.create({
  lbl:    { fontSize: 11, fontWeight: "800", color: "#6B7280", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 6 },
  btn:    { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#F9FAFB", borderRadius: 12, padding: 12, borderWidth: 1, borderColor: "#E5E7EB" },
  btnTxt: { flex: 1, fontSize: 14, fontWeight: "700", color: "#111827" },
  cal:    { backgroundColor: "#fff", borderRadius: 16, padding: 14, borderWidth: 1, borderColor: "#E5E7EB", marginTop: 8, shadowColor: "#000", shadowOffset:{width:0,height:4}, shadowOpacity:0.08, shadowRadius:12, elevation:4 },
  calNav: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  calMonth:{ fontSize: 14, fontWeight: "800", color: "#111827" },
  calGrid:{ flexDirection: "row", flexWrap: "wrap" },
  calDayHdr:{ width: "14.28%", textAlign: "center", fontSize: 11, fontWeight: "700", color: "#9CA3AF", paddingVertical: 4 },
  calCell:{ width: "14.28%", aspectRatio: 1, justifyContent: "center", alignItems: "center" },
  calCellSel:{ backgroundColor: DARK, borderRadius: 999 },
  calDayTxt:{ fontSize: 13, fontWeight: "600", color: "#374151" },
  calDayTxtSel:{ color: "#fff", fontWeight: "900" },
});
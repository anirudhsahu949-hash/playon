import {
  View, Text, StyleSheet, StatusBar,
  ScrollView, TouchableOpacity, ActivityIndicator,
  RefreshControl, Platform, Modal, Alert, FlatList,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useEffect, useMemo, useState } from "react";
import { db } from "../../firebaseConfig";
import { collection, getDocs, query, where } from "firebase/firestore";
import { Ionicons } from "@expo/vector-icons";
import AdminNavBar from "./adminavabar";

// ─── Tokens ───────────────────────────────────────────────────────────────────
const DARK     = "#0B1220";
const WHITE    = "#FFFFFF";
const GREEN    = "#4DB408";
const GREEN_LT = "#EBF9E0";
const PURPLE   = "#7C3AED";
const BODY_BG  = "#F5F6FA";
const GRAY1    = "#F3F4F6";
const GRAY2    = "#E5E7EB";
const GRAY3    = "#9CA3AF";
const GRAY4    = "#6B7280";
const GRAY5    = "#4B5563";

const COMMISSION_RATE = 0.05; // 5% admin commission
const RAZORPAY_RATE   = 0.02; // 2% Razorpay fee on online amount only

// ─── Types ────────────────────────────────────────────────────────────────────
type Booking = {
  id: string;
  turfId?: string;   turfName?: string;
  ownerId?: string;  ownerName?: string;
  date?: any;        dateString?: string;
  status?: string;   bookingType?: string; paymentStatus?: string;
  totalAmount?: number; paidAmount?: number; advanceAmount?: number;
  remainingAmount?: number; remainingCollected?: boolean;
  userName?: string; userPhone?: string;
  selectedSlots?: string[]; slotTime?: string;
  createdAt?: any;
};

type Owner = { id: string; name?: string; email?: string; phone?: string; };

type TurfSettlement = {
  turfId: string; turfName: string;
  ownerId: string; ownerName: string;
  bookings: Booking[];
  // Money collected ONLINE (Razorpay) — this is in YOUR account
  onlineCollected: number;
  // Total booking value (online + cash remaining)
  totalBookingValue: number;
  // Cash remaining to be collected by owner at turf
  cashAtTurf: number;
  // Your 5% commission (on online collected only — what's in your account)
  adminCommission: number;
  // Razorpay fee (2% of online collected)
  razorpayFee: number;
  // What you need to PAY the owner = onlineCollected - adminCommission - razorpayFee
  ownerPayable: number;
  // Counts
  totalBookings: number;
  fullPayCount: number;
  advanceCount: number;
  pendingCashCount: number;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getSafeDate(val: any): Date | null {
  if (!val) return null;
  if (typeof val?.toDate === "function") return val.toDate();
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
}

function toMidnight(d: Date): Date {
  const c = new Date(d); c.setHours(0,0,0,0); return c;
}

function fmtFull(n: number): string {
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

function fmtShort(n: number): string {
  if (n >= 100000) return `₹${(n/100000).toFixed(1)}L`;
  if (n >= 1000)   return `₹${(n/1000).toFixed(1)}K`;
  return `₹${Math.round(n)}`;
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function fmtDateShort(d: Date): string {
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

// Online amount = what Razorpay actually collected = paidAmount or advanceAmount
function getOnlinePaid(b: Booking): number {
  return Number(b.paidAmount ?? b.advanceAmount ?? 0);
}

// Total booking value
function getTotal(b: Booking): number {
  return Number(b.totalAmount ?? 0);
}

// Cash remaining to be paid at turf by customer
function getCashAtTurf(b: Booking): number {
  return Number(b.remainingAmount ?? Math.max(getTotal(b) - getOnlinePaid(b), 0));
}

// ─── Calendar Picker ──────────────────────────────────────────────────────────
function CalendarPicker({ visible, title, selectedDate, minDate, maxDate, onSelect, onClose }: {
  visible: boolean; title: string; selectedDate: Date;
  minDate?: Date; maxDate?: Date;
  onSelect: (d: Date) => void; onClose: () => void;
}) {
  const [viewMonth, setViewMonth] = useState(() => {
    const d = new Date(selectedDate); d.setDate(1); d.setHours(0,0,0,0); return d;
  });
  const today = toMidnight(new Date());
  const cells = useMemo(() => {
    const yr = viewMonth.getFullYear(), mo = viewMonth.getMonth();
    const first = new Date(yr, mo, 1).getDay(), total = new Date(yr, mo+1, 0).getDate();
    const arr: (Date|null)[] = [];
    for (let i = 0; i < first; i++) arr.push(null);
    for (let d = 1; d <= total; d++) arr.push(new Date(yr, mo, d));
    return arr;
  }, [viewMonth]);
  const isDisabled = (d: Date) => {
    if (minDate && toMidnight(d) < toMidnight(minDate)) return true;
    if (maxDate && toMidnight(d) > toMidnight(maxDate)) return true;
    return false;
  };
  const isSelected = (d: Date) => toMidnight(d).getTime() === toMidnight(selectedDate).getTime();
  const isToday    = (d: Date) => toMidnight(d).getTime() === today.getTime();

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={cal.backdrop}>
        <TouchableOpacity style={{ flex: 1 }} onPress={onClose} activeOpacity={1} />
        <View style={cal.sheet}>
          <View style={cal.handle} />
          <Text style={cal.title}>{title}</Text>
          <View style={cal.nav}>
            <TouchableOpacity style={cal.navBtn} onPress={() => { const d = new Date(viewMonth); d.setMonth(d.getMonth()-1); setViewMonth(d); }}>
              <Ionicons name="chevron-back" size={18} color={GRAY5} />
            </TouchableOpacity>
            <Text style={cal.monthLbl}>{viewMonth.toLocaleDateString("en-IN", { month: "long", year: "numeric" })}</Text>
            <TouchableOpacity style={cal.navBtn} onPress={() => { const d = new Date(viewMonth); d.setMonth(d.getMonth()+1); setViewMonth(d); }}>
              <Ionicons name="chevron-forward" size={18} color={GRAY5} />
            </TouchableOpacity>
          </View>
          <View style={cal.weekRow}>
            {["Su","Mo","Tu","We","Th","Fr","Sa"].map(w => <Text key={w} style={cal.weekDay}>{w}</Text>)}
          </View>
          <View style={cal.grid}>
            {cells.map((d, i) => {
              if (!d) return <View key={`e${i}`} style={cal.cell} />;
              const dis = isDisabled(d), sel = isSelected(d), tod = isToday(d);
              return (
                <TouchableOpacity key={i} style={[cal.cell, sel && cal.cellSel, tod && !sel && cal.cellTod]}
                  onPress={() => { if (!dis) { onSelect(d); onClose(); } }} disabled={dis}>
                  <Text style={[cal.dayTxt, sel && cal.dayTxtSel, tod && !sel && cal.dayTxtTod, dis && cal.dayTxtDis]}>
                    {d.getDate()}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <TouchableOpacity style={cal.cancelBtn} onPress={onClose}>
            <Text style={cal.cancelTxt}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// ─── Turf Detail Modal ────────────────────────────────────────────────────────
function TurfDetailModal({ visible, data, onClose }: {
  visible: boolean; data: TurfSettlement | null; onClose: () => void;
}) {
  if (!data) return null;
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={dm.backdrop}>
        <TouchableOpacity style={{ flex: 1 }} onPress={onClose} activeOpacity={1} />
        <View style={dm.sheet}>
          <View style={dm.handle} />
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>

            {/* Header */}
            <View style={dm.header}>
              <View style={dm.turfIcon}>
                <Ionicons name="football" size={20} color={GREEN} />
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={dm.turfName}>{data.turfName}</Text>
                <Text style={dm.ownerName}>Owner: {data.ownerName}</Text>
              </View>
            </View>

            {/* ── What you collected online ── */}
            <View style={dm.section}>
              <Text style={dm.sectionTitle}>💳 Online Collections (Your Account)</Text>
              <View style={dm.row}>
                <Text style={dm.rowLbl}>Online collected (Razorpay)</Text>
                <Text style={[dm.rowVal, { color: "#2563EB", fontWeight: "900" }]}>{fmtFull(data.onlineCollected)}</Text>
              </View>
              <View style={dm.row}>
                <Text style={dm.rowLbl}>Razorpay fee (2%)</Text>
                <Text style={[dm.rowVal, { color: "#DC2626" }]}>− {fmtFull(data.razorpayFee)}</Text>
              </View>
              <View style={dm.row}>
                <Text style={dm.rowLbl}>Your commission (5%)</Text>
                <Text style={[dm.rowVal, { color: PURPLE }]}>− {fmtFull(data.adminCommission)}</Text>
              </View>
            </View>

            {/* ── What owner gets ── */}
            <View style={[dm.section, { backgroundColor: GREEN_LT, borderColor: GREEN + "44" }]}>
              <Text style={[dm.sectionTitle, { color: "#15803D" }]}>✅ Pay Owner</Text>
              <View style={dm.row}>
                <Text style={[dm.rowLbl, { color: "#15803D" }]}>Online collected</Text>
                <Text style={dm.rowVal}>{fmtFull(data.onlineCollected)}</Text>
              </View>
              <View style={dm.row}>
                <Text style={[dm.rowLbl, { color: "#15803D" }]}>− Razorpay (2%)</Text>
                <Text style={[dm.rowVal, { color: "#DC2626" }]}>− {fmtFull(data.razorpayFee)}</Text>
              </View>
              <View style={dm.row}>
                <Text style={[dm.rowLbl, { color: "#15803D" }]}>− Your commission (5%)</Text>
                <Text style={[dm.rowVal, { color: PURPLE }]}>− {fmtFull(data.adminCommission)}</Text>
              </View>
              <View style={[dm.row, { borderBottomWidth: 0, marginTop: 6 }]}>
                <Text style={[dm.rowLbl, { fontSize: 14, fontWeight: "900", color: "#15803D" }]}>Transfer to owner</Text>
                <Text style={[dm.rowVal, { fontSize: 22, color: "#15803D", fontWeight: "900" }]}>{fmtFull(data.ownerPayable)}</Text>
              </View>
            </View>

            {/* ── Cash at turf (owner's problem) ── */}
            <View style={[dm.section, { backgroundColor: "#FFFBEB", borderColor: "#FDE68A" }]}>
              <Text style={[dm.sectionTitle, { color: "#B45309" }]}>💵 Cash at Turf (Owner Collects)</Text>
              <Text style={dm.cashNote}>
                These are advance bookings where the customer pays remaining cash directly at the turf.
                This money goes directly to the owner — NOT through you.
              </Text>
              <View style={dm.row}>
                <Text style={[dm.rowLbl, { color: "#B45309" }]}>Cash to be collected</Text>
                <Text style={[dm.rowVal, { color: "#B45309", fontWeight: "900" }]}>{fmtFull(data.cashAtTurf)}</Text>
              </View>
              <View style={[dm.row, { borderBottomWidth: 0 }]}>
                <Text style={[dm.rowLbl, { color: "#B45309" }]}>Advance bookings</Text>
                <Text style={dm.rowVal}>{data.advanceCount}</Text>
              </View>
            </View>

            {/* ── Stats ── */}
            <View style={dm.section}>
              <Text style={dm.sectionTitle}>📊 Booking Stats</Text>
              {[
                { lbl: "Total bookings",       val: String(data.totalBookings) },
                { lbl: "Full payment bookings", val: String(data.fullPayCount) },
                { lbl: "Advance bookings",      val: String(data.advanceCount) },
                { lbl: "Cash pending at turf",  val: String(data.pendingCashCount) },
                { lbl: "Total booking value",   val: fmtFull(data.totalBookingValue) },
              ].map((r, i) => (
                <View key={i} style={[dm.row, i === 4 && { borderBottomWidth: 0 }]}>
                  <Text style={dm.rowLbl}>{r.lbl}</Text>
                  <Text style={dm.rowVal}>{r.val}</Text>
                </View>
              ))}
            </View>

            {/* ── Per booking list ── */}
            <Text style={dm.listTitle}>All Bookings ({data.bookings.length})</Text>
            {data.bookings.map((b, i) => {
              const online  = getOnlinePaid(b);
              const cash    = getCashAtTurf(b);
              const comm    = online * COMMISSION_RATE;
              const rzp     = online * RAZORPAY_RATE;
              const ownerGets = online - comm - rzp;
              const d = getSafeDate(b.date || b.dateString);
              const isFull = b.bookingType === "full";
              return (
                <View key={b.id} style={[dm.bRow, i === data.bookings.length-1 && { borderBottomWidth: 0 }]}>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <Text style={dm.bName}>{b.userName || "Customer"}</Text>
                      <View style={[dm.bPill, { backgroundColor: isFull ? "#EDE9FE" : "#DBEAFE" }]}>
                        <Text style={[dm.bPillTxt, { color: isFull ? PURPLE : "#2563EB" }]}>
                          {isFull ? "Full" : "Advance"}
                        </Text>
                      </View>
                    </View>
                    <Text style={dm.bMeta}>{d ? fmtDateShort(d) : "—"}</Text>
                    <Text style={dm.bBreak}>
                      Online: {fmtFull(online)}  ·  Cash: {fmtFull(cash)}
                    </Text>
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={dm.bOwner}>Owner gets {fmtFull(ownerGets)}</Text>
                    <Text style={dm.bComm}>Comm {fmtFull(comm)}</Text>
                    <Text style={dm.bRzp}>Rzp {fmtFull(rzp)}</Text>
                  </View>
                </View>
              );
            })}

            <TouchableOpacity style={dm.closeBtn} onPress={onClose}>
              <Text style={dm.closeTxt}>Close</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function AdminSettlementScreen() {
  const insets = useSafeAreaInsets();
  const [bookings,   setBookings]   = useState<Booking[]>([]);
  const [owners,     setOwners]     = useState<Owner[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Date range — default: last 7 days
  const [startDate, setStartDate] = useState<Date>(() => {
    const d = new Date(); d.setDate(d.getDate() - 6); d.setHours(0,0,0,0); return d;
  });
  const [endDate, setEndDate] = useState<Date>(() => {
    const d = new Date(); d.setHours(23,59,59,999); return d;
  });
  const [showStart, setShowStart] = useState(false);
  const [showEnd,   setShowEnd]   = useState(false);

  const [selectedOwner,   setSelectedOwner]   = useState("all");
  const [showOwnerFilter, setShowOwnerFilter] = useState(false);
  const [detailTurf,      setDetailTurf]      = useState<TurfSettlement | null>(null);
  const [showDetail,      setShowDetail]      = useState(false);

  useEffect(() => { fetchAll(); }, []);

  const fetchAll = async (isRefresh = false) => {
    isRefresh ? setRefreshing(true) : setLoading(true);
    try {
      const [bookSnap, ownerSnap] = await Promise.all([
        getDocs(collection(db, "bookings")),
        getDocs(query(collection(db, "users"), where("role", "==", "owner"))),
      ]);
      setBookings(bookSnap.docs.map(d => ({ id: d.id, ...d.data() } as Booking)));
      setOwners(ownerSnap.docs.map(d => ({ id: d.id, ...d.data() } as Owner)));
    } catch {
      Alert.alert("Error", "Could not load data.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const applyPreset = (days: number) => {
    const end = new Date(); end.setHours(23,59,59,999);
    let start: Date;
    if (days === 0) {
      // This month
      start = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    } else {
      start = new Date(); start.setDate(start.getDate() - (days - 1));
    }
    start.setHours(0,0,0,0);
    setStartDate(start); setEndDate(end);
  };

  // ── Filter bookings by date range + owner ─────────────────────────────────
  const filteredBookings = useMemo(() => {
    const start = toMidnight(startDate);
    const end   = new Date(endDate); end.setHours(23,59,59,999);
    return bookings.filter(b => {
      if (b.status === "cancelled") return false;
      const d = getSafeDate(b.date || b.dateString);
      if (!d || d < start || d > end) return false;
      if (selectedOwner !== "all" && b.ownerId !== selectedOwner) return false;
      return true;
    });
  }, [bookings, startDate, endDate, selectedOwner]);

  // ── Build per-turf settlement ─────────────────────────────────────────────
  const settlements = useMemo<TurfSettlement[]>(() => {
    const map: Record<string, TurfSettlement> = {};

    filteredBookings.forEach(b => {
      const key = b.turfId || "unknown";
      if (!map[key]) {
        const owner = owners.find(o => o.id === b.ownerId);
        map[key] = {
          turfId: key, turfName: b.turfName || "Unknown Turf",
          ownerId: b.ownerId || "",
          ownerName: owner?.name || b.ownerName || "Unknown Owner",
          bookings: [],
          onlineCollected: 0, totalBookingValue: 0, cashAtTurf: 0,
          adminCommission: 0, razorpayFee: 0, ownerPayable: 0,
          totalBookings: 0, fullPayCount: 0, advanceCount: 0, pendingCashCount: 0,
        };
      }

      const t = map[key];
      t.bookings.push(b);
      t.totalBookings++;

      const online = getOnlinePaid(b);
      const total  = getTotal(b);
      const cash   = getCashAtTurf(b);

      t.onlineCollected   += online;
      t.totalBookingValue += total;
      t.cashAtTurf        += cash;

      // Commission and Razorpay fee are on ONLINE amount only
      t.adminCommission   += online * COMMISSION_RATE;
      t.razorpayFee       += online * RAZORPAY_RATE;

      if (b.bookingType === "full") t.fullPayCount++;
      else t.advanceCount++;
      if (cash > 0 && !b.remainingCollected) t.pendingCashCount++;
    });

    // Round and calculate owner payable
    Object.values(map).forEach(t => {
      t.adminCommission = Math.round(t.adminCommission);
      t.razorpayFee     = Math.round(t.razorpayFee);
      t.ownerPayable    = Math.max(
        Math.round(t.onlineCollected - t.adminCommission - t.razorpayFee), 0
      );
    });

    return Object.values(map).sort((a, b) => b.onlineCollected - a.onlineCollected);
  }, [filteredBookings, owners]);

  // ── Grand totals ──────────────────────────────────────────────────────────
  const grand = useMemo(() => {
    const g = {
      onlineCollected: 0, totalBookingValue: 0, cashAtTurf: 0,
      adminCommission: 0, razorpayFee: 0, ownerPayable: 0,
      totalBookings: 0,
    };
    settlements.forEach(t => {
      g.onlineCollected   += t.onlineCollected;
      g.totalBookingValue += t.totalBookingValue;
      g.cashAtTurf        += t.cashAtTurf;
      g.adminCommission   += t.adminCommission;
      g.razorpayFee       += t.razorpayFee;
      g.ownerPayable      += t.ownerPayable;
      g.totalBookings     += t.totalBookings;
    });
    g.adminCommission = Math.round(g.adminCommission);
    g.razorpayFee     = Math.round(g.razorpayFee);
    g.ownerPayable    = Math.round(g.ownerPayable);
    // Net admin earning = commission - razorpay fee
    return { ...g, netAdminEarning: g.adminCommission - g.razorpayFee };
  }, [settlements]);

  const dayCount = useMemo(() =>
    Math.round((toMidnight(endDate).getTime() - toMidnight(startDate).getTime()) / 86400000) + 1,
  [startDate, endDate]);

  if (loading) return (
    <SafeAreaView style={s.loadWrap}>
      <StatusBar barStyle="light-content" backgroundColor={DARK} />
      <ActivityIndicator size="large" color={GREEN} />
      <Text style={s.loadTxt}>Loading settlement data…</Text>
    </SafeAreaView>
  );

  return (
    <View style={s.root}>
      <StatusBar barStyle="light-content" backgroundColor={DARK} />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={s.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => fetchAll(true)} tintColor={GREEN} />}
      >
        {/* ── Dark header ── */}
        {/* ── Hero ── */}
<View style={[s.header, { paddingTop: insets.top + 14 }]}>
          <View>
            <Text style={s.headerTag}>Admin · Settlement</Text>
            <Text style={s.headerTitle}>Settlement Hub</Text>
            <Text style={s.headerSub}>{dayCount} day period · {grand.totalBookings} bookings</Text>
          </View>
        </View>

        {/* ── Key metrics strip ── */}
        <View style={s.metricsStrip}>
          {[
            { label: "Online\nCollected",  value: fmtShort(grand.onlineCollected),  color: "#60A5FA" },
            { label: "Your\nCommission",   value: fmtShort(grand.adminCommission),  color: "#C084FC" },
            { label: "Razorpay\nFee",      value: fmtShort(grand.razorpayFee),      color: "#F87171" },
            { label: "Net to\nYou",        value: fmtShort(grand.netAdminEarning),  color: "#4ADE80" },
            { label: "Pay\nOwners",        value: fmtShort(grand.ownerPayable),     color: "#FDE68A" },
          ].map((m, i) => (
            <View key={i} style={[s.metricItem, i > 0 && s.metricBorder]}>
              <Text style={[s.metricVal, { color: m.color }]}>{m.value}</Text>
              <Text style={s.metricLbl}>{m.label}</Text>
            </View>
          ))}
        </View>

        {/* ── Date range card ── */}
        <View style={s.card}>
          <Text style={s.cardTitle}>Select Period</Text>

          <View style={s.dateRow}>
            <TouchableOpacity style={s.datePill} onPress={() => setShowStart(true)} activeOpacity={0.8}>
              <Ionicons name="calendar-outline" size={14} color={DARK} />
              <View>
                <Text style={s.datePillLbl}>FROM</Text>
                <Text style={s.datePillVal}>{fmtDate(startDate)}</Text>
              </View>
            </TouchableOpacity>
            <Ionicons name="arrow-forward" size={16} color={GRAY3} />
            <TouchableOpacity style={s.datePill} onPress={() => setShowEnd(true)} activeOpacity={0.8}>
              <Ionicons name="calendar-outline" size={14} color={DARK} />
              <View>
                <Text style={s.datePillLbl}>TO</Text>
                <Text style={s.datePillVal}>{fmtDate(endDate)}</Text>
              </View>
            </TouchableOpacity>
          </View>

          {/* Quick presets */}
          <View style={s.presetRow}>
            {[
              { label: "Today",   days: 1  },
              { label: "7 Days",  days: 7  },
              { label: "15 Days", days: 15 },
              { label: "30 Days", days: 30 },
              { label: "Month",   days: 0  },
            ].map(p => (
              <TouchableOpacity key={p.label} style={s.presetChip} onPress={() => applyPreset(p.days)}>
                <Text style={s.presetTxt}>{p.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Owner filter */}
          <TouchableOpacity style={s.ownerBtn} onPress={() => setShowOwnerFilter(true)} activeOpacity={0.8}>
            <Ionicons name="people-outline" size={15} color={DARK} />
            <Text style={s.ownerBtnTxt}>
              {selectedOwner === "all" ? "All Owners" : owners.find(o => o.id === selectedOwner)?.name || "Owner"}
            </Text>
            <Ionicons name="chevron-down" size={14} color={GRAY3} style={{ marginLeft: "auto" as any }} />
          </TouchableOpacity>
        </View>

        {/* ── Grand summary ── */}
        <View style={s.card}>
          <Text style={s.cardTitle}>Summary</Text>
          <Text style={s.cardSub}>{fmtDate(startDate)} → {fmtDate(endDate)}</Text>

          {/* Online money flow */}
          <Text style={s.groupLabel}>💳 Online Money (Your Razorpay Account)</Text>
          {[
            { lbl: "Total online collected",  val: fmtFull(grand.onlineCollected),  color: "#2563EB",  bold: false },
            { lbl: "− Razorpay fee (2%)",     val: `− ${fmtFull(grand.razorpayFee)}`, color: "#DC2626", bold: false },
            { lbl: "− Your commission (5%)",  val: `− ${fmtFull(grand.adminCommission)}`, color: PURPLE, bold: false },
            { lbl: "= Transfer to owners",    val: fmtFull(grand.ownerPayable),     color: "#15803D",  bold: true  },
          ].map((r, i) => (
            <View key={i} style={[s.summaryRow, r.bold && s.summaryRowHL]}>
              <Text style={[s.summaryLbl, r.bold && { color: r.color, fontWeight: "800" }]}>{r.lbl}</Text>
              <Text style={[s.summaryVal, { color: r.color }, r.bold && { fontSize: 17 }]}>{r.val}</Text>
            </View>
          ))}

          <View style={s.divider} />

          {/* Your net earning */}
          <Text style={s.groupLabel}>🏦 Your Earnings</Text>
          {[
            { lbl: "Commission earned (5%)",   val: fmtFull(grand.adminCommission),  color: PURPLE   },
            { lbl: "− Razorpay fee (2%)",       val: `− ${fmtFull(grand.razorpayFee)}`, color: "#DC2626" },
            { lbl: "= Net to you",              val: fmtFull(grand.netAdminEarning),  color: GREEN,   },
          ].map((r, i) => (
            <View key={i} style={[s.summaryRow, i === 2 && s.summaryRowHL]}>
              <Text style={[s.summaryLbl, i === 2 && { color: GREEN, fontWeight: "800" }]}>{r.lbl}</Text>
              <Text style={[s.summaryVal, { color: r.color }, i === 2 && { fontSize: 17 }]}>{r.val}</Text>
            </View>
          ))}

          <View style={s.divider} />

          {/* Cash at turf — NOT your money */}
          <Text style={s.groupLabel}>💵 Cash at Turf (Not Your Money)</Text>
          <View style={[s.cashNote, { marginTop: 0 }]}>
            <Ionicons name="information-circle-outline" size={15} color="#B45309" />
            <Text style={s.cashNoteText}>
              Advance bookings where customer pays remaining cash at the turf.
              Owner collects this directly — it does NOT come through your account.
            </Text>
          </View>
          <View style={s.summaryRow}>
            <Text style={s.summaryLbl}>Total cash at turf</Text>
            <Text style={[s.summaryVal, { color: "#B45309", fontWeight: "900" }]}>{fmtFull(grand.cashAtTurf)}</Text>
          </View>
          <View style={[s.summaryRow, { borderBottomWidth: 0 }]}>
            <Text style={s.summaryLbl}>Total booking value (online + cash)</Text>
            <Text style={s.summaryVal}>{fmtFull(grand.totalBookingValue)}</Text>
          </View>
        </View>

        {/* ── How it works ── */}
        <View style={[s.card, { backgroundColor: "#F5F3FF", borderColor: "#DDD6FE" }]}>
          <Text style={[s.cardTitle, { color: PURPLE }]}>How Commission Works</Text>
          <Text style={s.formulaTxt}>
            {"1. Customer pays online → goes to YOUR Razorpay account\n"}
            {"2. Admin commission = 5% of online amount\n"}
            {"3. Razorpay fee = 2% of online amount (Razorpay deducts automatically)\n"}
            {"4. Transfer to owner = Online collected − 5% − 2%\n"}
            {"5. Cash bookings = Customer pays remaining at turf → owner's money, not yours"}
          </Text>
        </View>

        {/* ── Per-turf cards ── */}
        <Text style={s.sectionHeader}>
          {settlements.length} Turf{settlements.length !== 1 ? "s" : ""} · Tap for full breakdown
        </Text>

        {settlements.length === 0 ? (
          <View style={s.emptyCard}>
            <Ionicons name="receipt-outline" size={40} color={GRAY2} />
            <Text style={s.emptyTitle}>No bookings found</Text>
            <Text style={s.emptySub}>Try changing the date range or owner filter.</Text>
          </View>
        ) : (
          settlements.map(t => (
            <TouchableOpacity
              key={t.turfId}
              style={s.turfCard}
              activeOpacity={0.88}
              onPress={() => { setDetailTurf(t); setShowDetail(true); }}
            >
              {/* Left bar */}
              <View style={s.turfBar} />

              <View style={s.turfBody}>
                {/* Top row */}
                <View style={s.turfTop}>
                  <View style={s.turfIconWrap}>
                    <Ionicons name="football" size={17} color={GREEN} />
                  </View>
                  <View style={{ flex: 1, marginLeft: 10 }}>
                    <Text style={s.turfName}>{t.turfName}</Text>
                    <Text style={s.turfOwner}>{t.ownerName}</Text>
                  </View>
                  <View style={s.bookingsBadge}>
                    <Text style={s.bookingsBadgeTxt}>{t.totalBookings} bookings</Text>
                  </View>
                </View>

                {/* 3 key numbers */}
                <View style={s.turfNums}>
                  <View style={s.turfNumItem}>
                    <Text style={s.turfNumLbl}>Online collected</Text>
                    <Text style={[s.turfNumVal, { color: "#2563EB" }]}>{fmtFull(t.onlineCollected)}</Text>
                  </View>
                  <View style={s.turfNumDivider} />
                  <View style={s.turfNumItem}>
                    <Text style={s.turfNumLbl}>Your cut (5%)</Text>
                    <Text style={[s.turfNumVal, { color: PURPLE }]}>{fmtFull(t.adminCommission)}</Text>
                  </View>
                  <View style={s.turfNumDivider} />
                  <View style={s.turfNumItem}>
                    <Text style={s.turfNumLbl}>Pay owner</Text>
                    <Text style={[s.turfNumVal, { color: "#15803D", fontWeight: "900" }]}>{fmtFull(t.ownerPayable)}</Text>
                  </View>
                </View>

                {/* Chips */}
                <View style={s.turfChips}>
                  {t.cashAtTurf > 0 && (
                    <View style={[s.chip, { backgroundColor: "#FFFBEB", borderColor: "#FDE68A" }]}>
                      <Text style={[s.chipTxt, { color: "#B45309" }]}>💵 Cash {fmtShort(t.cashAtTurf)}</Text>
                    </View>
                  )}
                  {t.fullPayCount > 0 && (
                    <View style={[s.chip, { backgroundColor: "#EDE9FE", borderColor: "#DDD6FE" }]}>
                      <Text style={[s.chipTxt, { color: PURPLE }]}>{t.fullPayCount} full pay</Text>
                    </View>
                  )}
                  {t.advanceCount > 0 && (
                    <View style={[s.chip, { backgroundColor: "#DBEAFE", borderColor: "#BFDBFE" }]}>
                      <Text style={[s.chipTxt, { color: "#2563EB" }]}>{t.advanceCount} advance</Text>
                    </View>
                  )}
                  {t.pendingCashCount > 0 && (
                    <View style={[s.chip, { backgroundColor: "#FEF3C7", borderColor: "#FDE68A" }]}>
                      <Text style={[s.chipTxt, { color: "#B45309" }]}>{t.pendingCashCount} cash pending</Text>
                    </View>
                  )}
                </View>

                {/* Share bar */}
                <View style={s.shareBar}>
                  {t.onlineCollected > 0 && <>
                    <View style={[s.shareSeg, { flex: t.ownerPayable,    backgroundColor: "#22C55E" }]} />
                    <View style={[s.shareSeg, { flex: t.adminCommission, backgroundColor: PURPLE      }]} />
                    <View style={[s.shareSeg, { flex: t.razorpayFee,     backgroundColor: "#EF4444"  }]} />
                  </>}
                </View>
                <View style={s.shareLegend}>
                  <Text style={[s.shareLegendTxt, { color: "#22C55E" }]}>■ Owner</Text>
                  <Text style={[s.shareLegendTxt, { color: PURPLE    }]}>■ Admin 5%</Text>
                  <Text style={[s.shareLegendTxt, { color: "#EF4444" }]}>■ Razorpay</Text>
                  <Text style={[s.shareLegendTxt, { color: GRAY3, marginLeft: "auto" as any }]}>Tap for details →</Text>
                </View>
              </View>
            </TouchableOpacity>
          ))
        )}

        <View style={{ height: 100 }} />
      </ScrollView>

      {/* Calendars */}
      <CalendarPicker
        visible={showStart} title="Select Start Date"
        selectedDate={startDate} maxDate={endDate}
        onSelect={setStartDate} onClose={() => setShowStart(false)}
      />
      <CalendarPicker
        visible={showEnd} title="Select End Date"
        selectedDate={endDate} minDate={startDate} maxDate={new Date()}
        onSelect={d => { const e = new Date(d); e.setHours(23,59,59,999); setEndDate(e); }}
        onClose={() => setShowEnd(false)}
      />

      {/* Owner filter */}
      <Modal visible={showOwnerFilter} animationType="slide" transparent onRequestClose={() => setShowOwnerFilter(false)}>
        <View style={of.backdrop}>
          <TouchableOpacity style={{ flex: 1 }} onPress={() => setShowOwnerFilter(false)} activeOpacity={1} />
          <View style={of.sheet}>
            <View style={of.handle} />
            <Text style={of.title}>Filter by Owner</Text>
            <ScrollView showsVerticalScrollIndicator={false}>
              {[{ id: "all", name: "All Owners" }, ...owners].map(o => (
                <TouchableOpacity key={o.id} style={of.option} onPress={() => { setSelectedOwner(o.id); setShowOwnerFilter(false); }}>
                  <Text style={[of.optionTxt, selectedOwner === o.id && { color: GREEN, fontWeight: "800" }]}>
                    {o.name}
                  </Text>
                  {selectedOwner === o.id && <Ionicons name="checkmark" size={18} color={GREEN} />}
                </TouchableOpacity>
              ))}
              <View style={{ height: 20 }} />
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Turf detail */}
      <TurfDetailModal visible={showDetail} data={detailTurf} onClose={() => setShowDetail(false)} />

      <AdminNavBar />
    </View>
  );
}

// ─── Calendar styles ──────────────────────────────────────────────────────────
const cal = StyleSheet.create({
  backdrop:  { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet:     { backgroundColor: WHITE, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 20, paddingBottom: Platform.OS === "ios" ? 36 : 24 },
  handle:    { width: 40, height: 4, borderRadius: 2, backgroundColor: GRAY2, alignSelf: "center", marginBottom: 20 },
  title:     { fontSize: 18, fontWeight: "900", color: DARK, marginBottom: 20, textAlign: "center" },
  nav:       { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16 },
  navBtn:    { width: 36, height: 36, borderRadius: 10, backgroundColor: GRAY1, justifyContent: "center", alignItems: "center" },
  monthLbl:  { fontSize: 15, fontWeight: "800", color: DARK },
  weekRow:   { flexDirection: "row", marginBottom: 8 },
  weekDay:   { flex: 1, textAlign: "center", fontSize: 11, fontWeight: "700", color: GRAY3 },
  grid:      { flexDirection: "row", flexWrap: "wrap" },
  cell:      { width: "14.28%", aspectRatio: 1, justifyContent: "center", alignItems: "center", padding: 2 },
  cellSel:   { backgroundColor: DARK, borderRadius: 10 },
  cellTod:   { backgroundColor: GREEN_LT, borderRadius: 10, borderWidth: 1.5, borderColor: GREEN },
  dayTxt:    { fontSize: 14, fontWeight: "600", color: GRAY5 },
  dayTxtSel: { color: WHITE, fontWeight: "800" },
  dayTxtTod: { color: "#15803D", fontWeight: "800" },
  dayTxtDis: { color: GRAY2 },
  cancelBtn: { backgroundColor: GRAY1, paddingVertical: 14, borderRadius: 16, alignItems: "center", marginTop: 16 },
  cancelTxt: { color: GRAY5, fontWeight: "700", fontSize: 15 },
});

// ─── Detail modal styles ──────────────────────────────────────────────────────
const dm = StyleSheet.create({
  backdrop:  { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet:     { backgroundColor: WHITE, borderTopLeftRadius: 28, borderTopRightRadius: 28, maxHeight: "94%", paddingHorizontal: 20, paddingTop: 12 },
  handle:    { width: 40, height: 4, borderRadius: 2, backgroundColor: GRAY2, alignSelf: "center", marginBottom: 20 },
  header:    { flexDirection: "row", alignItems: "center", marginBottom: 20 },
  turfIcon:  { width: 46, height: 46, borderRadius: 14, backgroundColor: GREEN_LT, justifyContent: "center", alignItems: "center" },
  turfName:  { fontSize: 17, fontWeight: "900", color: DARK },
  ownerName: { fontSize: 12, color: GRAY4, fontWeight: "600", marginTop: 2 },
  section:   { backgroundColor: GRAY1, borderRadius: 14, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: GRAY2 },
  sectionTitle: { fontSize: 12, fontWeight: "800", color: GRAY5, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 12 },
  row:       { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: GRAY2 },
  rowLbl:    { fontSize: 13, color: GRAY4, fontWeight: "600", flex: 1 },
  rowVal:    { fontSize: 13, color: DARK, fontWeight: "800" },
  cashNote:  { fontSize: 12, color: "#B45309", lineHeight: 18, marginBottom: 10 },
  listTitle: { fontSize: 13, fontWeight: "800", color: GRAY5, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10, marginTop: 4 },
  bRow:      { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: GRAY1 },
  bName:     { fontSize: 13, fontWeight: "800", color: DARK },
  bMeta:     { fontSize: 11, color: GRAY3, marginTop: 2 },
  bBreak:    { fontSize: 11, color: GRAY4, marginTop: 2, fontWeight: "500" },
  bOwner:    { fontSize: 12, fontWeight: "800", color: "#15803D" },
  bComm:     { fontSize: 11, fontWeight: "700", color: PURPLE, marginTop: 2 },
  bRzp:      { fontSize: 11, fontWeight: "600", color: "#DC2626", marginTop: 1 },
  bPill:     { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 20 },
  bPillTxt:  { fontSize: 9, fontWeight: "800" },
  closeBtn:  { backgroundColor: GRAY1, paddingVertical: 14, borderRadius: 14, alignItems: "center", marginTop: 16 },
  closeTxt:  { color: GRAY5, fontWeight: "700", fontSize: 15 },
});

// ─── Owner filter styles ──────────────────────────────────────────────────────
const of = StyleSheet.create({
  backdrop:  { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheet:     { backgroundColor: WHITE, borderTopLeftRadius: 28, borderTopRightRadius: 28, maxHeight: "70%", paddingHorizontal: 20, paddingTop: 12, paddingBottom: Platform.OS === "ios" ? 34 : 20 },
  handle:    { width: 40, height: 4, borderRadius: 2, backgroundColor: GRAY2, alignSelf: "center", marginBottom: 20 },
  title:     { fontSize: 18, fontWeight: "900", color: DARK, marginBottom: 16 },
  option:    { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: GRAY1 },
  optionTxt: { fontSize: 15, color: GRAY5, fontWeight: "600" },
});

// ─── Screen styles ────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root:    { flex: 1, backgroundColor: BODY_BG },
  scroll:  { paddingBottom: 24 },
  loadWrap:{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: DARK },
  loadTxt: { color: GRAY3, marginTop: 12, fontSize: 14, fontWeight: "600" },

  header: {
    backgroundColor: DARK,
    paddingHorizontal: 20,
    paddingTop: Platform.OS === "android" ? (StatusBar.currentHeight || 0) + 14 : 20,
    paddingBottom: 16,
  },
  headerTag:  { color: GREEN, fontSize: 11, fontWeight: "800", letterSpacing: 1.5, textTransform: "uppercase" },
  headerTitle:{ color: WHITE, fontSize: 26, fontWeight: "900", marginTop: 2, letterSpacing: -0.5 },
  headerSub:  { color: GRAY4, fontSize: 12, marginTop: 4, fontWeight: "500" },

  metricsStrip: { flexDirection: "row", backgroundColor: DARK, paddingHorizontal: 8, paddingBottom: 20 },
  metricItem:   { flex: 1, alignItems: "center", paddingVertical: 8 },
  metricBorder: { borderLeftWidth: 1, borderLeftColor: "rgba(255,255,255,0.08)" },
  metricVal:    { fontSize: 13, fontWeight: "900" },
  metricLbl:    { fontSize: 8, color: "#64748B", marginTop: 3, textAlign: "center", fontWeight: "600" },

  card: {
    backgroundColor: WHITE, marginHorizontal: 16, marginTop: 16,
    borderRadius: 18, padding: 16, borderWidth: 1, borderColor: GRAY2,
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05, shadowRadius: 6, elevation: 2,
  },
  cardTitle: { fontSize: 16, fontWeight: "900", color: DARK },
  cardSub:   { fontSize: 12, color: GRAY3, fontWeight: "500", marginTop: 2, marginBottom: 8 },

  dateRow:    { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 14 },
  datePill:   { flex: 1, flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: GRAY1, borderRadius: 13, padding: 12, borderWidth: 1.5, borderColor: GRAY2 },
  datePillLbl:{ fontSize: 9, color: GRAY3, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.5 },
  datePillVal:{ fontSize: 13, color: DARK, fontWeight: "800", marginTop: 2 },

  presetRow:  { flexDirection: "row", gap: 7, marginTop: 14 },
  presetChip: { flex: 1, alignItems: "center", paddingVertical: 8, backgroundColor: DARK, borderRadius: 9 },
  presetTxt:  { color: WHITE, fontSize: 11, fontWeight: "700" },

  ownerBtn: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: GRAY1, borderRadius: 13, padding: 13, borderWidth: 1, borderColor: GRAY2, marginTop: 12 },
  ownerBtnTxt: { fontSize: 14, fontWeight: "700", color: DARK, flex: 1 },

  groupLabel:  { fontSize: 11, fontWeight: "800", color: GRAY3, textTransform: "uppercase", letterSpacing: 0.6, marginTop: 14, marginBottom: 8 },
  summaryRow:  { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: GRAY1 },
  summaryRowHL:{ backgroundColor: GRAY1, borderRadius: 8, paddingHorizontal: 8, marginHorizontal: -8 },
  summaryLbl:  { fontSize: 13, color: GRAY4, fontWeight: "600", flex: 1 },
  summaryVal:  { fontSize: 14, fontWeight: "800" },
  divider:     { height: 1, backgroundColor: GRAY2, marginVertical: 6 },

  cashNote:    { flexDirection: "row", alignItems: "flex-start", gap: 8, backgroundColor: "#FFFBEB", borderRadius: 10, padding: 10, marginBottom: 10, borderWidth: 1, borderColor: "#FDE68A" },
  cashNoteText:{ flex: 1, fontSize: 12, color: "#B45309", lineHeight: 18, fontWeight: "500" },

  formulaTxt:  { fontSize: 12, color: "#6D28D9", lineHeight: 20, marginTop: 8, fontWeight: "500" },

  sectionHeader: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 8, fontSize: 12, fontWeight: "800", color: GRAY3, textTransform: "uppercase", letterSpacing: 0.5 },

  turfCard: {
    backgroundColor: WHITE, marginHorizontal: 16, marginBottom: 12,
    borderRadius: 18, flexDirection: "row", overflow: "hidden",
    borderWidth: 1, borderColor: GRAY2,
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05, shadowRadius: 6, elevation: 2,
  },
  turfBar:        { width: 4, backgroundColor: GREEN },
  turfBody:       { flex: 1, padding: 14 },
  turfTop:        { flexDirection: "row", alignItems: "center", marginBottom: 12 },
  turfIconWrap:   { width: 36, height: 36, borderRadius: 10, backgroundColor: GREEN_LT, justifyContent: "center", alignItems: "center" },
  turfName:       { fontSize: 14, fontWeight: "900", color: DARK },
  turfOwner:      { fontSize: 11, color: GRAY3, marginTop: 2, fontWeight: "500" },
  bookingsBadge:  { backgroundColor: GRAY1, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  bookingsBadgeTxt:{ fontSize: 11, fontWeight: "700", color: GRAY5 },

  turfNums:       { flexDirection: "row", backgroundColor: GRAY1, borderRadius: 12, padding: 10, marginBottom: 10 },
  turfNumItem:    { flex: 1, alignItems: "center" },
  turfNumLbl:     { fontSize: 9, color: GRAY3, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.3 },
  turfNumVal:     { fontSize: 14, fontWeight: "800", marginTop: 3 },
  turfNumDivider: { width: 1, backgroundColor: GRAY2 },

  turfChips:      { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 10 },
  chip:           { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1 },
  chipTxt:        { fontSize: 10, fontWeight: "700" },

  shareBar:       { height: 5, borderRadius: 3, flexDirection: "row", overflow: "hidden", marginBottom: 5 },
  shareSeg:       { height: 5 },
  shareLegend:    { flexDirection: "row", gap: 10, alignItems: "center" },
  shareLegendTxt: { fontSize: 9, fontWeight: "700" },

  emptyCard:  { backgroundColor: WHITE, marginHorizontal: 16, borderRadius: 18, padding: 40, alignItems: "center", borderWidth: 1, borderColor: GRAY2, gap: 10 },
  emptyTitle: { fontSize: 16, fontWeight: "800", color: DARK },
  emptySub:   { fontSize: 13, color: GRAY3, textAlign: "center" },
});
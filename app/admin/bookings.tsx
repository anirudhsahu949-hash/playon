import {
  View, Text, StyleSheet, SafeAreaView, StatusBar, FlatList,
  TouchableOpacity, Alert, ActivityIndicator, TextInput,
  RefreshControl, Modal, ScrollView, Platform,
} from "react-native";
import { useEffect, useMemo, useState } from "react";
import { db } from "../../firebaseConfig";
import { collection, query, where, orderBy, limit, getDocs } from "firebase/firestore";
import { Ionicons } from "@expo/vector-icons";
import AdminNavBar from "./adminavabar";
import { auth } from "../../firebaseConfig";

// ─── Tokens ───────────────────────────────────────────────────────────────────
const DARK    = "#0B1220";
const WHITE   = "#FFFFFF";
const GREEN   = "#4DB408";
const GREEN_LT= "#EBF9E0";
const BODY_BG = "#F5F6FA";
const GRAY1   = "#F3F4F6";
const GRAY2   = "#E5E7EB";
const GRAY3   = "#9CA3AF";
const GRAY4   = "#6B7280";
const GRAY5   = "#4B5563";
const PAGE_SIZE = 50;

// ─── Types ────────────────────────────────────────────────────────────────────
type Booking = {
  id: string;
  userId?: string; userName?: string; userEmail?: string; userPhone?: string;
  turfName?: string; ownerId?: string; ownerName?: string;
  date?: any; dateString?: string; createdAt?: any;
  selectedSlots?: string[]; slotTime?: string;
  totalAmount?: number; paidAmount?: number; advanceAmount?: number;
  remainingAmount?: number; bookingType?: string; paymentStatus?: string;
  status?: string; refundStatus?: string; refundAmount?: number;
};

type FilterTab = "today" | "confirmed" | "cancelled" | "upcoming" | "all";

// ─── Date helpers ─────────────────────────────────────────────────────────────
function getSafeDate(v: any): Date | null {
  if (!v) return null;
  if (typeof v?.toDate === "function") return v.toDate();
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function toMidnight(d: Date): Date {
  const c = new Date(d); c.setHours(0, 0, 0, 0); return c;
}

function fmtDate(v: any): string {
  const d = getSafeDate(v);
  if (!d) return "—";
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function fmtDateTime(v: any): string {
  const d = getSafeDate(v);
  if (!d) return "—";
  return d.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

// ── Slot merge: ["9:00 AM - 9:30 AM","9:30 AM - 10:00 AM"] → "9:00 AM – 10:00 AM"
function parseTimeVal(s: string): number {
  const parts = s.trim().split(" ");
  const [hStr, mStr] = parts[0].split(":");
  let h = Number(hStr);
  const m = Number(mStr || 0);
  const p = (parts[1] || "").toUpperCase();
  if (p === "PM" && h !== 12) h += 12;
  if (p === "AM" && h === 12) h = 0;
  return h * 60 + m;
}

function formatMins(mins: number): string {
  let h = Math.floor(mins / 60);
  const m = mins % 60;
  const suffix = h >= 12 ? "PM" : "AM";
  if (h > 12) h -= 12;
  if (h === 0) h = 12;
  return `${h}:${String(m).padStart(2, "0")} ${suffix}`;
}

function mergeSlotRange(slots: string[]): string {
  if (!slots || slots.length === 0) return "—";
  const parsed = slots.map((s) => {
    const parts = s.split(" - ");
    if (parts.length < 2) return null;
    return { start: parseTimeVal(parts[0]), end: parseTimeVal(parts[1]) };
  }).filter(Boolean) as { start: number; end: number }[];
  if (!parsed.length) return slots[0] || "—";
  parsed.sort((a, b) => a.start - b.start);
  const merged: { start: number; end: number }[] = [];
  for (const slot of parsed) {
    if (!merged.length) { merged.push({ ...slot }); continue; }
    const last = merged[merged.length - 1];
    if (Math.abs(slot.start - last.end) < 2) last.end = slot.end;
    else merged.push({ ...slot });
  }
  return merged.map(({ start, end }) => `${formatMins(start)} – ${formatMins(end)}`).join(", ");
}

function getSlotDisplay(b: Booking): string {
  if (Array.isArray(b.selectedSlots) && b.selectedSlots.length > 0)
    return mergeSlotRange(b.selectedSlots);
  return b.slotTime || "—";
}

function getTotal(b: Booking)     { return Number(b.totalAmount ?? b.paidAmount ?? 0); }
function getPaid(b: Booking)      { return Number(b.paidAmount ?? b.advanceAmount ?? 0); }
function getRemaining(b: Booking) { return Number(b.remainingAmount ?? Math.max(getTotal(b) - getPaid(b), 0)); }
function fmt(n: number)           { return n >= 1000 ? `₹${(n / 1000).toFixed(1)}K` : `₹${n}`; }

const STATUS_CFG: Record<string, { bg: string; color: string; icon: string }> = {
  confirmed: { bg: "#DCFCE7", color: "#15803D", icon: "checkmark-circle" },
  pending:   { bg: "#FEF3C7", color: "#B45309", icon: "ellipsis-horizontal-circle" },
  completed: { bg: GRAY1,     color: GRAY5,     icon: "time" },
  cancelled: { bg: "#FEE2E2", color: "#DC2626", icon: "close-circle" },
};
const getSC = (s: string) => STATUS_CFG[s] ?? STATUS_CFG.pending;

const TABS: { key: FilterTab; label: string; icon: string }[] = [
  { key: "today",     label: "Today",     icon: "today-outline"     },
  { key: "upcoming",  label: "Upcoming",  icon: "calendar-outline"  },
  { key: "confirmed", label: "Confirmed", icon: "checkmark-circle-outline" },
  { key: "cancelled", label: "Cancelled", icon: "close-circle-outline" },
  { key: "all",       label: "All",       icon: "list-outline"      },
];

const SERVER_URL = "https://bookora-backend-95u4.onrender.com";

const CANCEL_REASONS = [
  { key: "rain",       label: "🌧️ Heavy Rain / Waterlogged Pitch"   },
  { key: "maintenance",label: "🔧 Pitch Under Maintenance"           },
  { key: "safety",     label: "⚠️ Safety / Hazard on Ground"        },
  { key: "overbooked", label: "📋 Scheduling / Overbooking Error"   },
  { key: "user_asked", label: "🙏 User Requested (via Support)"     },
  { key: "other",      label: "➕ Other Reason"                      },
];

// ─── Inline Calendar ──────────────────────────────────────────────────────────
function InlineCalendar({ selectedDate, minDate, onSelect }: {
  selectedDate: Date; minDate?: Date; onSelect: (d: Date) => void;
}) {
  const [viewMonth, setViewMonth] = useState(() => {
    const d = new Date(selectedDate); d.setDate(1); d.setHours(0, 0, 0, 0); return d;
  });
  const today = toMidnight(new Date());
  const cells = useMemo(() => {
    const yr = viewMonth.getFullYear(), mo = viewMonth.getMonth();
    const first = new Date(yr, mo, 1).getDay(), total = new Date(yr, mo + 1, 0).getDate();
    const arr: (Date | null)[] = [];
    for (let i = 0; i < first; i++) arr.push(null);
    for (let d = 1; d <= total; d++) arr.push(new Date(yr, mo, d));
    return arr;
  }, [viewMonth]);
  const isDisabled = (d: Date) => minDate ? toMidnight(d) < toMidnight(minDate) : false;
  const isSelected = (d: Date) => toMidnight(d).getTime() === toMidnight(selectedDate).getTime();
  const isToday    = (d: Date) => toMidnight(d).getTime() === today.getTime();
  return (
    <View style={ic.wrap}>
      <View style={ic.nav}>
        <TouchableOpacity style={ic.navBtn} onPress={() => { const d = new Date(viewMonth); d.setMonth(d.getMonth()-1); setViewMonth(d); }}>
          <Ionicons name="chevron-back" size={16} color={GRAY5} />
        </TouchableOpacity>
        <Text style={ic.month}>{viewMonth.toLocaleDateString("en-IN", { month: "long", year: "numeric" })}</Text>
        <TouchableOpacity style={ic.navBtn} onPress={() => { const d = new Date(viewMonth); d.setMonth(d.getMonth()+1); setViewMonth(d); }}>
          <Ionicons name="chevron-forward" size={16} color={GRAY5} />
        </TouchableOpacity>
      </View>
      <View style={ic.weekRow}>
        {["S","M","T","W","T","F","S"].map((w, i) => <Text key={i} style={ic.weekDay}>{w}</Text>)}
      </View>
      <View style={ic.grid}>
        {cells.map((d, i) => {
          if (!d) return <View key={`e${i}`} style={ic.cell} />;
          const dis = isDisabled(d), sel = isSelected(d), tod = isToday(d);
          return (
            <TouchableOpacity key={i} style={[ic.cell, sel && ic.cellSel, tod && !sel && ic.cellTod]} onPress={() => !dis && onSelect(d)} disabled={dis} activeOpacity={0.7}>
              <Text style={[ic.dayTxt, sel && ic.dayTxtSel, tod && !sel && ic.dayTxtTod, dis && ic.dayTxtDis]}>{d.getDate()}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

// ─── Booking Card ─────────────────────────────────────────────────────────────
function BookingCard({ item, onPress }: { item: Booking; onPress: () => void }) {
  const sc = getSC(item.status || "pending");
  const remaining = getRemaining(item);
  const slotRange = getSlotDisplay(item);
  return (
    <TouchableOpacity style={s.card} activeOpacity={0.88} onPress={onPress}>
      {/* Status left bar */}
      <View style={[s.cardBar, { backgroundColor: sc.color }]} />

      <View style={s.cardInner}>
        {/* Top row */}
        <View style={s.cardTop}>
          <View style={{ flex: 1 }}>
            <Text style={s.cardName} numberOfLines={1}>{item.userName || "Unknown User"}</Text>
            <Text style={s.cardTurf} numberOfLines={1}>{item.turfName || "Unknown Turf"}</Text>
          </View>
          <View style={[s.statusBadge, { backgroundColor: sc.bg }]}>
            <Ionicons name={sc.icon as any} size={11} color={sc.color} />
            <Text style={[s.statusTxt, { color: sc.color }]}>
              {" "}{(item.status || "pending").charAt(0).toUpperCase() + (item.status || "pending").slice(1)}
            </Text>
          </View>
        </View>

        {/* Info chips */}
        <View style={s.chipRow}>
          <View style={s.chip}>
            <Ionicons name="calendar-outline" size={11} color={GRAY3} />
            <Text style={s.chipTxt}>{fmtDate(item.date || item.dateString)}</Text>
          </View>
          <View style={s.chip}>
            <Ionicons name="time-outline" size={11} color={GRAY3} />
            <Text style={s.chipTxt}>{slotRange}</Text>
          </View>
          {!!item.userPhone && (
            <View style={s.chip}>
              <Ionicons name="call-outline" size={11} color={GRAY3} />
              <Text style={s.chipTxt}>{item.userPhone}</Text>
            </View>
          )}
          {item.createdAt && (
            <View style={s.chip}>
              <Ionicons name="receipt-outline" size={11} color={GRAY3} />
              <Text style={s.chipTxt}>Booked {fmtDateTime(item.createdAt)}</Text>
            </View>
          )}
        </View>

        {/* Payment row */}
        <View style={s.payRow}>
          <View style={s.payLeft}>
            <Text style={s.payTotal}>{fmt(getTotal(item))}</Text>
            <Text style={s.paySub}>
              Paid {fmt(getPaid(item))}
              {remaining > 0 ? <Text style={{ color: "#D97706" }}> · Due {fmt(remaining)}</Text> : <Text style={{ color: GREEN }}> · Cleared</Text>}
            </Text>
          </View>
          <View style={[s.typePill, item.bookingType === "full" ? s.typeFull : s.typeAdv]}>
            <Text style={[s.typeTxt, item.bookingType === "full" ? { color: "#15803D" } : { color: "#B45309" }]}>
              {item.bookingType === "full" ? "Full" : "Advance"}
            </Text>
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function AdminBookings() {
  const [bookings,   setBookings]   = useState<Booking[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search,     setSearch]     = useState("");
  const [activeTab,  setActiveTab]  = useState<FilterTab>("today");
  const [detail,     setDetail]     = useState<Booking | null>(null);

  const [fromDate,      setFromDate]      = useState<Date>(new Date());
  const [toDate,        setToDate]        = useState<Date>(new Date());
  const [dateActive,    setDateActive]    = useState(false);
  const [dateModalOpen, setDateModalOpen] = useState(false);
  const [showFromCal,   setShowFromCal]   = useState(false);
  const [showToCal,     setShowToCal]     = useState(false);

  const [cancelModal,  setCancelModal]  = useState(false);
const [cancelReason, setCancelReason] = useState("");
const [cancelling,   setCancelling]   = useState(false);

  // ── Fetch ──────────────────────────────────────────────────────────────────
  const fetchBookings = async (isRefresh = false) => {
    isRefresh ? setRefreshing(true) : setLoading(true);
    try {
      let q;
      if (dateActive) {
        q = query(collection(db, "bookings"), orderBy("dateString"), limit(500));
      } else if (activeTab === "upcoming") {
        q = query(collection(db, "bookings"), where("status", "==", "confirmed"), limit(200));
      } else if (activeTab === "all") {
        q = query(collection(db, "bookings"), orderBy("createdAt", "desc"), limit(PAGE_SIZE));
      } else if (activeTab === "today") {
        const todayStr = new Date().toDateString();
        q = query(collection(db, "bookings"), where("dateString", "==", todayStr), limit(PAGE_SIZE));
      } else {
        const todayStr = new Date().toDateString();
        q = query(collection(db, "bookings"), where("dateString", "==", todayStr), where("status", "==", activeTab), limit(PAGE_SIZE));
      }
      const snap = await getDocs(q);
      setBookings(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Booking)));
    } catch {
      Alert.alert("Error", "Could not load bookings.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { fetchBookings(); }, [activeTab, dateActive]);

  // ── Filter ─────────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let data = [...bookings];
    if (dateActive) {
      const from = toMidnight(fromDate);
      const to   = toMidnight(toDate); to.setHours(23, 59, 59);
      data = data.filter((b) => {
        const d = getSafeDate(b.date || b.dateString);
        return d && d >= from && d <= to;
      });
    }
    if (activeTab === "upcoming" && !dateActive) {
      // Show ALL future confirmed bookings from today onwards
      const today = toMidnight(new Date());
      data = data.filter((b) => {
        const d = getSafeDate(b.date || b.dateString);
        return d && d >= today;
      });
      // Sort by date ascending (nearest first)
      return data.sort((a, b) =>
        (getSafeDate(a.date || a.dateString)?.getTime() ?? 0) -
        (getSafeDate(b.date || b.dateString)?.getTime() ?? 0)
      );
    }
    const q = search.trim().toLowerCase();
    if (q) {
      data = data.filter((b) =>
        [b.userName, b.userPhone, b.turfName, b.ownerName, b.userEmail, b.status, b.id]
          .some((f) => f?.toLowerCase().includes(q))
      );
    }
    return data.sort((a, b) =>
      (getSafeDate(b.date || b.dateString)?.getTime() ?? 0) -
      (getSafeDate(a.date || a.dateString)?.getTime() ?? 0)
    );
  }, [bookings, search, dateActive, fromDate, toDate, activeTab]);

  // ── Stats ──────────────────────────────────────────────────────────────────
  const stats = useMemo(() => ({
    total:     filtered.length,
    confirmed: filtered.filter((b) => b.status === "confirmed").length,
    cancelled: filtered.filter((b) => b.status === "cancelled").length,
    revenue:   filtered.reduce((sum, b) => sum + getPaid(b), 0),
  }), [filtered]);

  if (loading) return (
    <SafeAreaView style={s.loadWrap}>
      <StatusBar barStyle="light-content" backgroundColor={DARK} />
      <ActivityIndicator size="large" color={GREEN} />
      <Text style={s.loadTxt}>Loading bookings…</Text>
    </SafeAreaView>
  );

  const handleAdminCancel = async () => {
  if (!detail || !cancelReason) return;
  const paid = getPaid(detail);

  Alert.alert(
    "Confirm Cancellation",
    `Cancel this booking at ${detail.turfName} on ${fmtDate(detail.date || detail.dateString)}?` +
    (paid > 0 ? `\n\n₹${paid} will be refunded to the user automatically.` : ""),
    [
      { text: "Go Back", style: "cancel" },
      {
        text: "Yes, Cancel",
        style: "destructive",
        onPress: async () => {
          setCancelling(true);
          try {
            const token = await auth.currentUser?.getIdToken();
            if (!token) throw new Error("Not authenticated");

            const res = await fetch(`${SERVER_URL}/admin-cancel-booking`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${token}`,
              },
              body: JSON.stringify({
                bookingId: detail.id,
                reason:    CANCEL_REASONS.find(r => r.key === cancelReason)?.label || cancelReason,
              }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Failed to cancel");

            setCancelModal(false);
            setDetail(null);
            await fetchBookings(true);

            Alert.alert(
              "Cancelled ✓",
              data.message || "Booking cancelled successfully.",
            );
          } catch (e: any) {
            Alert.alert("Error", e.message || "Could not cancel booking.");
          } finally {
            setCancelling(false);
          }
        },
      },
    ]
  );
};

  return (
    <SafeAreaView style={s.root}>
      <StatusBar barStyle="light-content" backgroundColor={DARK} />

      <FlatList
        data={filtered}
        keyExtractor={(i) => i.id}
        renderItem={({ item }) => <BookingCard item={item} onPress={() => setDetail(item)} />}
        contentContainerStyle={s.list}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => fetchBookings(true)} tintColor={GREEN} />}

        ListHeaderComponent={
          <View>
            {/* ── Dark header ── */}
            <View style={s.header}>
              <View>
                <Text style={s.headerTag}>Admin · Bookings</Text>
                <Text style={s.headerTitle}>Bookings</Text>
              </View>
              <TouchableOpacity
                style={[s.dateRangeBtn, dateActive && s.dateRangeBtnActive]}
                onPress={() => setDateModalOpen(true)}
                activeOpacity={0.8}
              >
                <Ionicons name="calendar-outline" size={14} color={dateActive ? WHITE : GREEN} />
                <Text style={[s.dateRangeTxt, dateActive && { color: WHITE }]}>
                  {dateActive
                    ? `${fromDate.toLocaleDateString("en-IN",{day:"numeric",month:"short"})} → ${toDate.toLocaleDateString("en-IN",{day:"numeric",month:"short"})}`
                    : "Date Range"}
                </Text>
                {dateActive && (
                  <TouchableOpacity onPress={(e) => { e.stopPropagation(); setDateActive(false); }}>
                    <Ionicons name="close-circle" size={14} color="rgba(255,255,255,0.8)" />
                  </TouchableOpacity>
                )}
              </TouchableOpacity>
            </View>

            {/* ── Stats row ── */}
            <View style={s.statsRow}>
              {[
                { label: "Total",     value: stats.total,     color: DARK,      bg: WHITE        },
                { label: "Confirmed", value: stats.confirmed, color: "#15803D", bg: "#DCFCE7"    },
                { label: "Cancelled", value: stats.cancelled, color: "#DC2626", bg: "#FEE2E2"    },
                { label: "Revenue",   value: fmt(stats.revenue), color: GREEN,  bg: GREEN_LT     },
              ].map((st) => (
                <View key={st.label} style={[s.statCard, { backgroundColor: st.bg }]}>
                  <Text style={[s.statVal, { color: st.color }]}>{st.value}</Text>
                  <Text style={[s.statLbl, { color: st.color + "99" }]}>{st.label}</Text>
                </View>
              ))}
            </View>

            {/* ── Search ── */}
            <View style={s.searchWrap}>
              <Ionicons name="search-outline" size={16} color={GRAY3} />
              <TextInput
                style={s.searchInput}
                placeholder="Search name, phone, turf, status…"
                placeholderTextColor={GRAY3}
                value={search}
                onChangeText={setSearch}
              />
              {search.length > 0 && (
                <TouchableOpacity onPress={() => setSearch("")}>
                  <Ionicons name="close-circle" size={16} color={GRAY3} />
                </TouchableOpacity>
              )}
            </View>

            {/* ── Tabs ── */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.tabsRow}>
              {TABS.map((tab) => {
                const active = activeTab === tab.key && !dateActive;
                return (
                  <TouchableOpacity
                    key={tab.key}
                    style={[s.tab, active && s.tabActive]}
                    onPress={() => { setActiveTab(tab.key); setDateActive(false); }}
                    activeOpacity={0.75}
                  >
                    <Ionicons name={tab.icon as any} size={12} color={active ? WHITE : GRAY4} />
                    <Text style={[s.tabTxt, active && s.tabTxtActive]}>{tab.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <Text style={s.resultCount}>
              {filtered.length} booking{filtered.length !== 1 ? "s" : ""}
            </Text>
          </View>
        }

        ListEmptyComponent={
          <View style={s.empty}>
            <Ionicons name="calendar-outline" size={44} color={GRAY2} />
            <Text style={s.emptyTitle}>No bookings found</Text>
            <Text style={s.emptySub}>Try a different filter or date range.</Text>
          </View>
        }
      />

      {/* ── Detail Modal ── */}
      <Modal visible={!!detail} animationType="slide" transparent onRequestClose={() => setDetail(null)}>
        <View style={s.modalBg}>
          <View style={s.sheet}>
            <View style={s.sheetHandle} />
            {detail && (() => {
              const sc = getSC(detail.status || "pending");
              const slotRange = getSlotDisplay(detail);
              return (
                <ScrollView showsVerticalScrollIndicator={false}>
                  {/* Header */}
                 {/* Header — title + small X button only */}
<View style={s.detailHeader}>
  <Text style={s.detailTitle}>Booking Detail</Text>
  <TouchableOpacity style={s.closeBtn} onPress={() => setDetail(null)}>
    <Ionicons name="close" size={18} color={GRAY5} />
  </TouchableOpacity>
</View>

{/* Cancel button — sits below header, only for confirmed bookings */}
{detail.status === "confirmed" && (
  <TouchableOpacity
    style={s.adminCancelBtn}
    onPress={() => { setCancelReason(""); setCancelModal(true); }}
    activeOpacity={0.85}
  >
    <Ionicons name="close-circle-outline" size={16} color="#DC2626" />
    <Text style={s.adminCancelBtnTxt}>Cancel This Booking</Text>
  </TouchableOpacity>
)}

                  {/* Status banner */}
                  <View style={[s.statusBanner, { backgroundColor: sc.bg }]}>
                    <View style={s.statusBannerLeft}>
                      <Ionicons name={sc.icon as any} size={18} color={sc.color} />
                      <Text style={[s.statusBannerTxt, { color: sc.color }]}>
                        {(detail.status || "pending").toUpperCase()}
                      </Text>
                    </View>
                    <Text style={s.bookingIdTxt}>#{detail.id.slice(0, 12)}</Text>
                  </View>

                  {/* Section: Customer */}
                  <Text style={s.sectionLabel}>Customer</Text>
                  <View style={s.detailBlock}>
                    <DetailRow icon="person-outline"   label="Name"  value={detail.userName  || "—"} />
                    <DetailRow icon="call-outline"     label="Phone" value={detail.userPhone || "—"} />
                    <DetailRow icon="mail-outline"     label="Email" value={detail.userEmail || "—"} last />
                  </View>

                  {/* Section: Booking */}
                  <Text style={s.sectionLabel}>Booking</Text>
                  <View style={s.detailBlock}>
                    <DetailRow icon="location-outline"  label="Turf"       value={detail.turfName  || "—"} />
                    <DetailRow icon="people-outline"    label="Owner"      value={detail.ownerName || "—"} />
                    <DetailRow icon="calendar-outline"  label="Date"       value={fmtDate(detail.date || detail.dateString)} />
                    <DetailRow icon="time-outline"      label="Slots"      value={slotRange} />
                    <DetailRow icon="receipt-outline"   label="Booked on"  value={fmtDateTime(detail.createdAt)} last />
                  </View>

                  {/* Section: Payment */}
                  <Text style={s.sectionLabel}>Payment</Text>
                  <View style={s.detailBlock}>
                    <DetailRow icon="cash-outline"              label="Total"          value={`₹${getTotal(detail)}`} />
                    <DetailRow icon="checkmark-circle-outline"  label="Paid"           value={`₹${getPaid(detail)}`} valueColor={GREEN} />
                    <DetailRow icon="alert-circle-outline"      label="Remaining"      value={getRemaining(detail) > 0 ? `₹${getRemaining(detail)}` : "Fully paid"} valueColor={getRemaining(detail) > 0 ? "#D97706" : GREEN} />
                    <DetailRow icon="card-outline"              label="Booking type"   value={detail.bookingType === "full" ? "Full Payment" : "Advance"} />
                    <DetailRow icon="shield-checkmark-outline"  label="Payment status" value={detail.paymentStatus || "—"} last />
                  </View>

                  {/* Refund (if cancelled) */}
                  {detail.status === "cancelled" && detail.refundStatus && (
                    <>
                      <Text style={s.sectionLabel}>Refund</Text>
                      <View style={[s.detailBlock, { backgroundColor: "#F5F3FF", borderColor: "#DDD6FE" }]}>
                        <DetailRow icon="refresh-circle-outline" label="Refund status" value={detail.refundStatus} valueColor="#7C3AED" />
                        {!!detail.refundAmount && (
                          <DetailRow icon="cash-outline" label="Refund amount" value={`₹${detail.refundAmount}`} valueColor="#7C3AED" last />
                        )}
                      </View>
                    </>
                  )}

                  <TouchableOpacity style={s.closeFullBtn} onPress={() => setDetail(null)}>
                    <Text style={s.closeFullBtnTxt}>Close</Text>
                  </TouchableOpacity>
                  <View style={{ height: 32 }} />
                </ScrollView>
              );
            })()}
          </View>
        </View>
      </Modal>

      {/* ── Admin Cancel Reason Modal ── */}
<Modal visible={cancelModal} animationType="slide" transparent onRequestClose={() => setCancelModal(false)}>
  <View style={s.modalBg}>
    <View style={[s.sheet, { maxHeight: "75%" }]}>
      <View style={s.sheetHandle} />

      <View style={s.detailHeader}>
        <Text style={s.detailTitle}>Cancel Reason</Text>
        <TouchableOpacity style={s.closeBtn} onPress={() => setCancelModal(false)}>
          <Ionicons name="close" size={18} color={GRAY5} />
        </TouchableOpacity>
      </View>

      <Text style={{ fontSize: 12, color: GRAY3, marginBottom: 14 }}>
        Select why this booking is being cancelled. The user will be notified and refunded automatically.
      </Text>

      {CANCEL_REASONS.map((r) => (
        <TouchableOpacity
          key={r.key}
          style={[s.reasonRow, cancelReason === r.key && s.reasonRowActive]}
          onPress={() => setCancelReason(r.key)}
          activeOpacity={0.8}
        >
          <Text style={[s.reasonTxt, cancelReason === r.key && s.reasonTxtActive]}>{r.label}</Text>
          {cancelReason === r.key && (
            <Ionicons name="checkmark-circle" size={18} color="#15803D" />
          )}
        </TouchableOpacity>
      ))}

      <TouchableOpacity
        style={[s.applyBtn, { marginTop: 16, opacity: (!cancelReason || cancelling) ? 0.5 : 1 }]}
        onPress={handleAdminCancel}
        disabled={!cancelReason || cancelling}
      >
        {cancelling
          ? <ActivityIndicator color="#fff" />
          : <Text style={s.applyBtnTxt}>Confirm Cancellation</Text>
        }
      </TouchableOpacity>

      <TouchableOpacity style={s.cancelBtn} onPress={() => setCancelModal(false)} disabled={cancelling}>
        <Text style={s.cancelBtnTxt}>Go Back</Text>
      </TouchableOpacity>
      <View style={{ height: 20 }} />
    </View>
  </View>
</Modal>

      {/* ── Date Range Modal ── */}
      <Modal visible={dateModalOpen} animationType="slide" transparent onRequestClose={() => setDateModalOpen(false)}>
        <View style={s.modalBg}>
          <View style={[s.sheet, { maxHeight: "80%" }]}>
            <View style={s.sheetHandle} />
            <Text style={s.detailTitle}>Date Range</Text>
            <Text style={s.dateHint}>Select a start and end date to filter bookings.</Text>

            {/* From / To pills */}
            <View style={s.datePillRow}>
              <TouchableOpacity
                style={[s.datePill, showFromCal && s.datePillActive]}
                onPress={() => { setShowFromCal(true); setShowToCal(false); }}
                activeOpacity={0.8}
              >
                <Ionicons name="calendar-outline" size={14} color={showFromCal ? WHITE : DARK} />
                <View>
                  <Text style={[s.datePillLabel, showFromCal && { color: "rgba(255,255,255,0.7)" }]}>FROM</Text>
                  <Text style={[s.datePillValue, showFromCal && { color: WHITE }]}>
                    {fromDate.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                  </Text>
                </View>
              </TouchableOpacity>

              <Ionicons name="arrow-forward" size={16} color={GRAY3} />

              <TouchableOpacity
                style={[s.datePill, showToCal && s.datePillActive]}
                onPress={() => { setShowToCal(true); setShowFromCal(false); }}
                activeOpacity={0.8}
              >
                <Ionicons name="calendar-outline" size={14} color={showToCal ? WHITE : DARK} />
                <View>
                  <Text style={[s.datePillLabel, showToCal && { color: "rgba(255,255,255,0.7)" }]}>TO</Text>
                  <Text style={[s.datePillValue, showToCal && { color: WHITE }]}>
                    {toDate.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                  </Text>
                </View>
              </TouchableOpacity>
            </View>

            {(showFromCal || showToCal) && (
              <InlineCalendar
                selectedDate={showFromCal ? fromDate : toDate}
                minDate={showToCal ? fromDate : undefined}
                onSelect={(d) => {
                  if (showFromCal) {
                    setFromDate(d);
                    if (d > toDate) setToDate(d);
                    setShowFromCal(false);
                    setShowToCal(true);
                  } else {
                    setToDate(d);
                    setShowToCal(false);
                  }
                }}
              />
            )}

            <TouchableOpacity
              style={[s.applyBtn, { marginTop: 16 }]}
              onPress={() => {
                if (toDate < fromDate) { Alert.alert("Invalid Range", "End date must be after start date."); return; }
                setDateActive(true);
                setDateModalOpen(false);
                setShowFromCal(false);
                setShowToCal(false);
              }}
            >
              <Text style={s.applyBtnTxt}>Apply Range</Text>
            </TouchableOpacity>

            {dateActive && (
              <TouchableOpacity style={s.clearBtn} onPress={() => { setDateActive(false); setDateModalOpen(false); }}>
                <Text style={s.clearBtnTxt}>Clear filter</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity style={s.cancelBtn} onPress={() => setDateModalOpen(false)}>
              <Text style={s.cancelBtnTxt}>Cancel</Text>
            </TouchableOpacity>
            <View style={{ height: 20 }} />
          </View>
        </View>
      </Modal>

      <AdminNavBar />
    </SafeAreaView>
  );
}

// ─── Detail row component ─────────────────────────────────────────────────────
function DetailRow({ icon, label, value, valueColor, last }: {
  icon: string; label: string; value: string; valueColor?: string; last?: boolean;
}) {
  return (
    <View style={[dr.row, !last && dr.rowBorder]}>
      <View style={dr.iconWrap}>
        <Ionicons name={icon as any} size={14} color={GRAY4} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={dr.label}>{label}</Text>
        <Text style={[dr.value, valueColor ? { color: valueColor } : {}]}>{value}</Text>
      </View>
    </View>
  );
}

const dr = StyleSheet.create({
  row:       { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 11, paddingHorizontal: 14 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: GRAY2 },
  iconWrap:  { width: 28, height: 28, borderRadius: 8, backgroundColor: GRAY1, alignItems: "center", justifyContent: "center" },
  label:     { fontSize: 10, color: GRAY3, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.4 },
  value:     { fontSize: 14, color: DARK, fontWeight: "600", marginTop: 2 },
});

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root:    { flex: 1, backgroundColor: BODY_BG },
  loadWrap:{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: DARK },
  loadTxt: { marginTop: 12, color: GRAY3, fontSize: 14, fontWeight: "600" },
  list:    { paddingBottom: 100 },

  // Header
  header: {
    backgroundColor: DARK,
    paddingHorizontal: 20,
    paddingTop: Platform.OS === "android" ? (StatusBar.currentHeight || 0) + 14 : 18,
    paddingBottom: 20,
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
  },
  headerTag:   { color: GREEN, fontSize: 11, fontWeight: "800", letterSpacing: 1.5, textTransform: "uppercase" },
  headerTitle: { color: WHITE, fontSize: 28, fontWeight: "900", marginTop: 2, letterSpacing: -0.5 },

  dateRangeBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: GREEN + "18", borderWidth: 1, borderColor: GREEN + "44",
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10,
  },
  dateRangeBtnActive: { backgroundColor: DARK, borderColor: GREEN },
  dateRangeTxt: { fontSize: 11, fontWeight: "700", color: GREEN },

  // Stats
  statsRow: { flexDirection: "row", paddingHorizontal: 16, paddingTop: 14, gap: 8 },
  statCard: { flex: 1, borderRadius: 12, padding: 11, alignItems: "center", gap: 3, borderWidth: 1, borderColor: GRAY2, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 3, elevation: 1 },
  statVal:  { fontSize: 16, fontWeight: "900" },
  statLbl:  { fontSize: 9, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.4 },

  // Search
  searchWrap: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: WHITE, borderRadius: 13,
    paddingHorizontal: 14, marginHorizontal: 16, marginTop: 14,
    borderWidth: 1, borderColor: GRAY2, height: 46,
    shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 3, elevation: 1,
  },
  searchInput: { flex: 1, fontSize: 14, color: DARK, fontWeight: "500" },

  // Tabs
  tabsRow: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4, gap: 7 },
  tab: {
    flexDirection: "row", alignItems: "center", gap: 5,
    paddingHorizontal: 13, paddingVertical: 8, borderRadius: 20,
    backgroundColor: WHITE, borderWidth: 1, borderColor: GRAY2,
  },
  tabActive:   { backgroundColor: DARK, borderColor: DARK },
  tabTxt:      { fontSize: 12, fontWeight: "700", color: GRAY4 },
  tabTxtActive:{ color: WHITE },

  resultCount: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 6, fontSize: 11, color: GRAY3, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 },

  // Card
  card: {
    flexDirection: "row",
    backgroundColor: WHITE, marginHorizontal: 16, marginBottom: 10,
    borderRadius: 16, borderWidth: 1, borderColor: GRAY2,
    overflow: "hidden",
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 5, elevation: 2,
  },
  cardBar:   { width: 4, flexShrink: 0 },
  cardInner: { flex: 1, padding: 13 },
  cardTop:   { flexDirection: "row", alignItems: "flex-start", marginBottom: 9 },
  cardName:  { fontSize: 15, fontWeight: "800", color: DARK },
  cardTurf:  { fontSize: 12, color: GRAY4, marginTop: 2, fontWeight: "500" },
  statusBadge: { flexDirection: "row", alignItems: "center", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 20 },
  statusTxt:   { fontSize: 10, fontWeight: "800" },

  chipRow: { flexDirection: "row", gap: 6, flexWrap: "wrap", marginBottom: 10 },
  chip: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: GRAY1, borderRadius: 7,
    paddingHorizontal: 8, paddingVertical: 4,
    borderWidth: 1, borderColor: GRAY2,
  },
  chipTxt: { fontSize: 10, color: GRAY5, fontWeight: "600" },

  payRow:   { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingTop: 10, borderTopWidth: 1, borderTopColor: GRAY1 },
  payLeft:  {},
  payTotal: { fontSize: 16, fontWeight: "900", color: DARK },
  paySub:   { fontSize: 11, color: GRAY3, marginTop: 2 },
  typePill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  typeFull: { backgroundColor: "#DCFCE7" },
  typeAdv:  { backgroundColor: "#FEF3C7" },
  typeTxt:  { fontSize: 10, fontWeight: "800" },

  empty:      { margin: 16, backgroundColor: WHITE, borderRadius: 18, padding: 40, alignItems: "center", borderWidth: 1, borderColor: GRAY2 },
  emptyTitle: { fontSize: 17, fontWeight: "800", color: DARK, marginTop: 14 },
  emptySub:   { fontSize: 13, color: GRAY3, marginTop: 6, textAlign: "center" },

  // Modal
  modalBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: WHITE,
    borderTopLeftRadius: 26, borderTopRightRadius: 26,
    paddingHorizontal: 20, paddingTop: 12,
    paddingBottom: Platform.OS === "ios" ? 34 : 20, maxHeight: "94%",
  },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: GRAY2, alignSelf: "center", marginBottom: 18 },

  // Detail
  detailHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
  detailTitle:  { fontSize: 20, fontWeight: "900", color: DARK },
  closeBtn:     { width: 34, height: 34, borderRadius: 10, backgroundColor: GRAY1, justifyContent: "center", alignItems: "center" },
  statusBanner: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    borderRadius: 12, padding: 12, marginBottom: 16,
  },
  statusBannerLeft: { flexDirection: "row", alignItems: "center", gap: 7 },
  statusBannerTxt:  { fontSize: 13, fontWeight: "800" },
  bookingIdTxt:     { fontSize: 11, color: GRAY3, fontWeight: "600" },
  sectionLabel: { fontSize: 11, fontWeight: "800", color: GRAY3, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 6, marginTop: 4 },
  detailBlock:  { backgroundColor: WHITE, borderRadius: 14, borderWidth: 1, borderColor: GRAY2, marginBottom: 14, overflow: "hidden" },
  closeFullBtn:    { backgroundColor: GRAY1, paddingVertical: 15, borderRadius: 14, alignItems: "center", marginTop: 4 },
  closeFullBtnTxt: { color: GRAY5, fontWeight: "700", fontSize: 15 },

  // Date range
  dateHint:    { fontSize: 12, color: GRAY3, marginTop: 4, marginBottom: 14 },
  datePillRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 14 },
  datePill: {
    flex: 1, flexDirection: "row", alignItems: "center", gap: 10,
    backgroundColor: GRAY1, borderRadius: 13, padding: 13,
    borderWidth: 1.5, borderColor: GRAY2,
  },
  datePillActive: { backgroundColor: DARK, borderColor: DARK },
  datePillLabel:  { fontSize: 9, fontWeight: "800", color: GRAY3, textTransform: "uppercase", letterSpacing: 0.5 },
  datePillValue:  { fontSize: 14, fontWeight: "800", color: DARK, marginTop: 2 },
  applyBtn:    { backgroundColor: DARK, paddingVertical: 14, borderRadius: 13, alignItems: "center" },
  applyBtnTxt: { color: WHITE, fontWeight: "800", fontSize: 15 },
  clearBtn:    { backgroundColor: "#FEE2E2", paddingVertical: 14, borderRadius: 13, alignItems: "center", marginTop: 10, borderWidth: 1, borderColor: "#FECACA" },
  clearBtnTxt: { color: "#DC2626", fontWeight: "700", fontSize: 15 },
  cancelBtn:   { backgroundColor: GRAY1, paddingVertical: 14, borderRadius: 13, alignItems: "center", marginTop: 10 },
  cancelBtnTxt:{ color: GRAY5, fontWeight: "700", fontSize: 15 },

  adminCancelBtn:    { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "#FEE2E2", paddingVertical: 14, borderRadius: 14, marginBottom: 10, borderWidth: 1, borderColor: "#FECACA" },
adminCancelBtnTxt: { color: "#DC2626", fontWeight: "800", fontSize: 15 },
reasonRow:         { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 13, paddingHorizontal: 14, borderRadius: 12, backgroundColor: GRAY1, borderWidth: 1, borderColor: GRAY2, marginBottom: 8 },
reasonRowActive:   { backgroundColor: "#DCFCE7", borderColor: "#86EFAC" },
reasonTxt:         { fontSize: 14, fontWeight: "600", color: DARK, flex: 1 },
reasonTxtActive:   { color: "#15803D", fontWeight: "700" },
});

// ─── InlineCalendar styles ────────────────────────────────────────────────────
const ic = StyleSheet.create({
  wrap:    { backgroundColor: GRAY1, borderRadius: 14, padding: 12, borderWidth: 1, borderColor: GRAY2, marginBottom: 4 },
  nav:     { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  navBtn:  { width: 32, height: 32, borderRadius: 9, backgroundColor: WHITE, justifyContent: "center", alignItems: "center", borderWidth: 1, borderColor: GRAY2 },
  month:   { fontSize: 14, fontWeight: "800", color: DARK },
  weekRow: { flexDirection: "row", marginBottom: 6 },
  weekDay: { flex: 1, textAlign: "center", fontSize: 10, fontWeight: "700", color: GRAY3 },
  grid:    { flexDirection: "row", flexWrap: "wrap" },
  cell:    { width: "14.28%", aspectRatio: 1, justifyContent: "center", alignItems: "center", padding: 2 },
  cellSel: { backgroundColor: DARK, borderRadius: 9 },
  cellTod: { backgroundColor: GREEN_LT, borderRadius: 9, borderWidth: 1.5, borderColor: GREEN },
  dayTxt:    { fontSize: 13, fontWeight: "600", color: GRAY5 },
  dayTxtSel: { color: WHITE, fontWeight: "800" },
  dayTxtTod: { color: GREEN,   fontWeight: "800" },
  dayTxtDis: { color: GRAY2 },
});
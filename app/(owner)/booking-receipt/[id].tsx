import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
  StatusBar,
  ActivityIndicator,
  Platform,
} from "react-native";

import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../../../firebaseConfig";
import { Ionicons } from "@expo/vector-icons";

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getInitials(name: string): string {
  return name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
}

function toSafeDate(val: any): Date {
  if (!val) return new Date(NaN);
  if (typeof val.toDate === "function") return val.toDate();
  if (val instanceof Date) return val;
  return new Date(val);
}

function formatDate(value: any): string {
  if (!value) return "Not available";
  const d = toSafeDate(value);
  if (isNaN(d.getTime())) return "Not available";
  return d.toLocaleDateString("en-IN", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });
}

function bookingAmount(item: any): number {
  return Number(item?.totalAmount ?? item?.amount ?? item?.totalPrice ?? item?.price ?? 0) || 0;
}

// ─── Time parsing ─────────────────────────────────────────────────────────────
function parseTimePart(t: string): number {
  const parts = t.trim().split(" ");
  const [hStr, mStr] = (parts[0] || "0:0").split(":");
  let h = Number(hStr), m = Number(mStr || 0);
  const p = (parts[1] || "").toUpperCase();
  if (p === "PM" && h !== 12) h += 12;
  if (p === "AM" && h === 12) h = 0;
  return h * 60 + m;
}

function fmtMinutes(mins: number): string {
  let h = Math.floor(mins / 60), m = mins % 60;
  const suf = h >= 12 ? "PM" : "AM";
  h = h % 12; if (h === 0) h = 12;
  return `${h}:${String(m).padStart(2, "0")} ${suf}`;
}

// Returns { startMins, endMins, display } for the booking's slots
function parseSlots(booking: any): { startMins: number; endMins: number; display: string } {
  const slots = booking?.selectedSlots;
  const EMPTY = { startMins: -1, endMins: -1, display: booking?.slotTime || "Not available" };

  if (!Array.isArray(slots) || slots.length === 0) return EMPTY;

  const parsed = slots
    .map((s: string) => {
      const p = s.split(" - ");
      if (p.length < 2) return null;
      return { start: parseTimePart(p[0]), end: parseTimePart(p[1]) };
    })
    .filter(Boolean) as { start: number; end: number }[];

  if (parsed.length === 0) return EMPTY;

  parsed.sort((a, b) => a.start - b.start);
  const first = parsed[0];
  const last  = parsed[parsed.length - 1];
  let end = last.end;
  if (end <= first.start) end += 1440; // midnight wrap

  const dur = end - first.start;
  const durLabel =
    dur < 60 ? `${dur}m`
    : dur % 60 === 0 ? `${dur / 60}h`
    : `${Math.floor(dur / 60)}h ${dur % 60}m`;

  return {
    startMins: first.start,
    endMins:   end,
    display:   `${fmtMinutes(first.start)} – ${fmtMinutes(last.end)}  ·  ${durLabel}`,
  };
}

// ─── Derived status — checks SLOT END TIME, not just date ────────────────────
// This is the core fix: a booking is "completed" only after its slot has ended.
function getDerivedStatus(booking: any): "confirmed" | "pending" | "cancelled" | "completed" {
  const status = booking?.status || "pending";
  if (status === "cancelled") return "cancelled";

  const bookingDate = toSafeDate(booking?.date ?? booking?.dateString);
  if (isNaN(bookingDate.getTime())) return status as any;

  const bookingDay = new Date(bookingDate); bookingDay.setHours(0, 0, 0, 0);
  const todayDay   = new Date();            todayDay.setHours(0, 0, 0, 0);

  // Past date → always completed
  if (bookingDay < todayDay) return "completed";
  // Future date → use raw status
  if (bookingDay > todayDay) return status as any;

  // Same day → check if the slot end time has passed
  const { endMins } = parseSlots(booking);
  if (endMins !== -1) {
    const nowMins = new Date().getHours() * 60 + new Date().getMinutes();
    if (nowMins >= endMins) return "completed";
  }

  return status as any;
}

// ─── Payment type — aware of completion ──────────────────────────────────────
// Fix: completed bookings should NEVER show "Awaiting Payment"
function getPaymentType(booking: any, derived: string): "paid" | "advance" | "cash" | "completed_pending" {
  // If booking is completed or confirmed and fully paid
  if (booking?.paymentStatus === "paid" || booking?.paymentStatus === "fully_paid") return "paid";
  if (booking?.isOffline || booking?.source === "offline" || booking?.type === "offline") return "cash";

  const advance   = Number(booking?.advanceAmount ?? 0);
  const remaining = Number(booking?.remainingAmount ?? 0);

  if (advance > 0 && remaining > 0) return "advance";
  if (advance > 0 && remaining === 0) return "paid";

  // Completed bookings that had pending payment → show as "completed" not "awaiting"
  if (derived === "completed") return "completed_pending";

  return "advance"; // fallback for confirmed with some payment
}

// ─── Phone visibility — show 2 hours before slot start ───────────────────────
function isPhoneVisible(booking: any): { visible: boolean; minutesLeft: number } {
  const bookingDate = toSafeDate(booking?.date ?? booking?.dateString);
  if (isNaN(bookingDate.getTime())) return { visible: false, minutesLeft: 999 };

  const bookingDay = new Date(bookingDate); bookingDay.setHours(0, 0, 0, 0);
  const todayDay   = new Date();            todayDay.setHours(0, 0, 0, 0);

  // Past date → always visible
  if (bookingDay < todayDay) return { visible: true, minutesLeft: 0 };
  // Future date (not today) → not yet visible
  if (bookingDay > todayDay) {
    // Calculate hours until tomorrow's slot roughly
    const diffMs   = bookingDate.getTime() - Date.now();
    const diffMins = Math.ceil(diffMs / 60000);
    return { visible: false, minutesLeft: diffMins - 120 };
  }

  // Same day → check if within 2 hours (120 min) of slot start
  const { startMins } = parseSlots(booking);
  if (startMins === -1) return { visible: false, minutesLeft: 999 };

  const nowMins     = new Date().getHours() * 60 + new Date().getMinutes();
  const minsToStart = startMins - nowMins;

  return {
    visible:    minsToStart <= 120, // within 2 hours
    minutesLeft: Math.max(minsToStart - 120, 0),
  };
}

function formatMinutesLeft(mins: number): string {
  if (mins <= 0) return "";
  const h = Math.floor(mins / 60), m = mins % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

// ─── Status metadata ──────────────────────────────────────────────────────────
const STATUS_META = {
  confirmed:  { label: "CONFIRMED",  bg: "#DCFCE7", color: "#15803D", icon: "checkmark-circle-outline"  as const, desc: "Booking confirmed — see you at the turf!" },
  pending:    { label: "PENDING",    bg: "#FEF3C7", color: "#B45309", icon: "time-outline"               as const, desc: "Awaiting confirmation from venue" },
  cancelled:  { label: "CANCELLED",  bg: "#FEE2E2", color: "#DC2626", icon: "close-circle-outline"       as const, desc: "This booking was cancelled" },
  completed:  { label: "COMPLETED",  bg: "#F3F4F6", color: "#374151", icon: "checkmark-done-outline"     as const, desc: "Booking completed successfully" },
};

const PAYMENT_META = {
  paid: {
    label: "FULLY PAID", bg: "#DCFCE7", color: "#15803D",
    icon: "checkmark-circle-outline" as const, sub: "Full amount settled · No dues",
  },
  advance: {
    label: "ADVANCE PAID", bg: "#FEF3C7", color: "#B45309",
    icon: "time-outline" as const, sub: "Remaining amount due at venue",
  },
  cash: {
    label: "CASH / OFFLINE", bg: "#CCFBF1", color: "#0F766E",
    icon: "cash-outline" as const, sub: "Walk-in cash booking",
  },
  completed_pending: {
    label: "PAYMENT INCOMPLETE", bg: "#FEE2E2", color: "#DC2626",
    icon: "alert-circle-outline" as const, sub: "Payment was not completed for this booking",
  },
};

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function BookingReceiptScreen() {
  const { id }    = useLocalSearchParams();
  const router    = useRouter();

  const [booking, setBooking] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadBooking(); }, []);

  const loadBooking = async () => {
    try {
      const snap = await getDoc(doc(db, "bookings", String(id)));
      if (snap.exists()) setBooking({ id: snap.id, ...snap.data() });
    } catch (e) { console.log(e); }
    finally { setLoading(false); }
  };

  if (loading) {
    return (
      <View style={styles.loadingWrap}>
        <ActivityIndicator size="large" color="#0A0F1E" />
      </View>
    );
  }

  if (!booking) {
    return (
      <View style={styles.loadingWrap}>
        <Ionicons name="alert-circle-outline" size={40} color="#9CA3AF" />
        <Text style={styles.notFoundText}>Booking not found</Text>
      </View>
    );
  }

  const derived      = getDerivedStatus(booking);
  const statusMeta   = STATUS_META[derived] ?? STATUS_META.pending;
  const payType      = getPaymentType(booking, derived);
  const payMeta      = PAYMENT_META[payType];
  const totalAmt     = bookingAmount(booking);
  const advanceAmt   = Number(booking?.advanceAmount ?? 0);
  const remainingAmt = Number(booking?.remainingAmount ?? 0);
  const slotInfo     = parseSlots(booking);
  const phoneInfo    = isPhoneVisible(booking);
  const phone        = booking?.phone || booking?.userPhone || booking?.customerPhone || "";

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0A0F1E" />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 50 }}>

        {/* ── Hero ── */}
        <View style={styles.hero}>
          <View style={styles.heroGlow} />

          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.8}>
            <Ionicons name="arrow-back" size={16} color="#fff" />
            <Text style={styles.backBtnText}>Back</Text>
          </TouchableOpacity>

          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {getInitials(booking?.userName || booking?.customerName || "CU")}
            </Text>
          </View>

          <Text style={styles.customerName}>
            {booking?.userName || booking?.customerName || "Customer"}
          </Text>

          {/* ── Phone reveal logic ── */}
          {phone ? (
            phoneInfo.visible ? (
              <View style={styles.phoneRevealRow}>
                <Ionicons name="call-outline" size={14} color="#6EE7B7" />
                <Text style={styles.phoneVisible}>{phone}</Text>
              </View>
            ) : (
              <View style={styles.phoneHiddenRow}>
                <Ionicons name="lock-closed-outline" size={12} color="#6B7280" />
                <Text style={styles.phoneHidden}>
                  Phone visible {formatMinutesLeft(phoneInfo.minutesLeft)} before slot
                </Text>
              </View>
            )
          ) : null}

          {/* Status badge */}
          <View style={[styles.statusBadge, { backgroundColor: statusMeta.bg }]}>
            <Ionicons name={statusMeta.icon} size={13} color={statusMeta.color} />
            <Text style={[styles.statusBadgeText, { color: statusMeta.color }]}>
              {statusMeta.label}
            </Text>
          </View>
        </View>

        {/* ── Payment banner — overlapping hero ── */}
        <View style={[styles.payBanner, { backgroundColor: payMeta.bg, borderColor: `${payMeta.color}22` }]}>
          <View style={[styles.payBannerIcon, { backgroundColor: payMeta.color }]}>
            <Ionicons name={payMeta.icon} size={18} color="#fff" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.payBannerLabel, { color: payMeta.color }]}>{payMeta.label}</Text>
            <Text style={styles.payBannerSub}>{payMeta.sub}</Text>
          </View>
          <Text style={[styles.payBannerAmount, { color: payMeta.color }]}>₹{totalAmt}</Text>
        </View>

        {/* ── Booking status card ── */}
        <View style={[styles.card, styles.statusCard, { borderLeftColor: statusMeta.color }]}>
          <View style={[styles.statusIcon, { backgroundColor: statusMeta.bg }]}>
            <Ionicons name={statusMeta.icon} size={20} color={statusMeta.color} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.statusCardTitle, { color: statusMeta.color }]}>
              Booking {statusMeta.label}
            </Text>
            <Text style={styles.statusCardDesc}>{statusMeta.desc}</Text>
          </View>
        </View>

        {/* ── Receipt details ── */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Booking Receipt</Text>

          {[
            { label: "Booking ID",      value: booking?.id,                          mono: true },
            { label: "Turf",            value: booking?.turfName || "—"              },
            { label: "Location",        value: booking?.location || booking?.turfLocation || "—" },
            { label: "Date",            value: formatDate(booking?.date || booking?.dateString) },
            { label: "Slot Time",       value: slotInfo.display                      },
            { label: "Booking Type",    value: booking?.bookingType === "full" ? "Full Payment" : booking?.isOffline ? "Walk-in / Cash" : "Advance" },
          ].map((row) => (
            <View key={row.label} style={styles.row}>
              <Text style={styles.rowLabel}>{row.label}</Text>
              <Text style={[styles.rowValue, row.mono && styles.monoText]} numberOfLines={row.mono ? 1 : 2}>
                {row.value || "—"}
              </Text>
            </View>
          ))}

          {/* Inline status */}
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Status</Text>
            <View style={[styles.inlineChip, { backgroundColor: statusMeta.bg }]}>
              <Text style={[styles.inlineChipText, { color: statusMeta.color }]}>{statusMeta.label}</Text>
            </View>
          </View>
        </View>

        {/* ── Payment breakdown ── */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Payment Breakdown</Text>

          <View style={styles.row}>
            <Text style={styles.rowLabel}>Total Amount</Text>
            <Text style={[styles.rowValue, { color: "#0A0F1E" }]}>₹{totalAmt}</Text>
          </View>

          {advanceAmt > 0 && (
            <View style={styles.row}>
              <Text style={styles.rowLabel}>
                {payType === "cash" ? "Cash Paid" : "Paid Online"}
              </Text>
              <Text style={[styles.rowValue, { color: "#15803D" }]}>₹{advanceAmt}</Text>
            </View>
          )}

          {payType === "paid" && advanceAmt === 0 && (
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Amount Paid</Text>
              <Text style={[styles.rowValue, { color: "#15803D" }]}>₹{totalAmt}</Text>
            </View>
          )}

          {remainingAmt > 0 && (
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Due at Turf</Text>
              <Text style={[styles.rowValue, {
                // ✅ Fix: completed bookings show gray "due", not alarming orange
                color: derived === "completed" ? "#9CA3AF" : "#D97706",
              }]}>
                ₹{remainingAmt}
                {derived === "completed" ? " (session ended)" : ""}
              </Text>
            </View>
          )}

          {/* Payment mode pill */}
          <View style={[styles.payModePill, { backgroundColor: `${payMeta.color}15` }]}>
            <View style={[styles.payModeDot, { backgroundColor: payMeta.color }]} />
            <Text style={[styles.payModeText, { color: payMeta.color }]}>
              {payType === "paid"              ? "Online · Fully Paid"
               : payType === "advance"         ? "Online · Advance Paid — Pay rest at turf"
               : payType === "cash"            ? "Cash / Walk-in"
               : "Payment incomplete"}
            </Text>
          </View>
        </View>

        {/* ── Customer info ── */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Customer Information</Text>

          <View style={styles.row}>
            <Text style={styles.rowLabel}>Full Name</Text>
            <Text style={styles.rowValue}>
              {booking?.userName || booking?.customerName || "—"}
            </Text>
          </View>

          {/* ── Phone with reveal logic ── */}
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Phone</Text>
            {phone ? (
              phoneInfo.visible ? (
                <View style={styles.phoneChip}>
                  <Ionicons name="call-outline" size={13} color="#0F766E" />
                  <Text style={styles.phoneChipText}>{phone}</Text>
                </View>
              ) : (
                <View style={styles.phoneLockedChip}>
                  <Ionicons name="lock-closed-outline" size={12} color="#9CA3AF" />
                  <Text style={styles.phoneLockedText}>
                    Reveals {formatMinutesLeft(phoneInfo.minutesLeft)} before slot
                  </Text>
                </View>
              )
            ) : (
              <Text style={styles.rowValue}>—</Text>
            )}
          </View>

          {/* ── Email removed as requested ── */}
        </View>

        {/* ── Note ── */}
        {booking?.note ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Note</Text>
            <Text style={styles.noteText}>{booking.note}</Text>
          </View>
        ) : null}

      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container:    { flex: 1, backgroundColor: "#F0F4F8" },
  loadingWrap:  { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#F0F4F8", gap: 12 },
  notFoundText: { fontSize: 16, color: "#9CA3AF", fontWeight: "600" },

  // Hero
  hero: {
    backgroundColor: "#0A0F1E",
    paddingTop: Platform.OS === "android" ? (StatusBar.currentHeight || 0) + 18 : 24,
    paddingBottom: 36,
    borderBottomLeftRadius: 36,
    borderBottomRightRadius: 36,
    alignItems: "center",
    overflow: "hidden",
  },
  heroGlow: {
    position: "absolute", width: 260, height: 260, borderRadius: 130,
    backgroundColor: "rgba(34,197,94,0.10)", top: -90, right: -80,
  },
  backBtn: {
    position: "absolute",
    left: 20,
    top: Platform.OS === "android" ? (StatusBar.currentHeight || 0) + 18 : 24,
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "rgba(255,255,255,0.09)", paddingHorizontal: 14, paddingVertical: 9, borderRadius: 14,
  },
  backBtnText: { color: "#FFFFFF", fontWeight: "700", fontSize: 14 },

  avatar: {
    width: 88, height: 88, borderRadius: 44,
    backgroundColor: "rgba(255,255,255,0.1)",
    justifyContent: "center", alignItems: "center",
    marginTop: 28, borderWidth: 2, borderColor: "rgba(255,255,255,0.15)",
  },
  avatarText:    { fontSize: 28, fontWeight: "900", color: "#FFFFFF" },
  customerName:  { marginTop: 14, fontSize: 24, fontWeight: "900", color: "#FFFFFF" },

  // Phone in hero
  phoneRevealRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6 },
  phoneVisible:   { color: "#6EE7B7", fontSize: 15, fontWeight: "700" },
  phoneHiddenRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 6 },
  phoneHidden:    { color: "#6B7280", fontSize: 12, fontWeight: "600" },

  statusBadge: {
    flexDirection: "row", alignItems: "center", gap: 6,
    marginTop: 16, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 999,
  },
  statusBadgeText: { fontSize: 12, fontWeight: "800" },

  // Payment banner
  payBanner: {
    flexDirection: "row", alignItems: "center",
    marginHorizontal: 18, marginTop: -18,
    borderRadius: 20, padding: 16, gap: 12,
    borderWidth: 1,
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07, shadowRadius: 8, elevation: 4,
  },
  payBannerIcon:   { width: 42, height: 42, borderRadius: 21, justifyContent: "center", alignItems: "center" },
  payBannerLabel:  { fontSize: 13, fontWeight: "900" },
  payBannerSub:    { marginTop: 2, fontSize: 12, color: "#6B7280", fontWeight: "600" },
  payBannerAmount: { fontSize: 20, fontWeight: "900" },

  // Cards
  card: {
    backgroundColor: "#FFFFFF", marginHorizontal: 18, marginTop: 14,
    borderRadius: 22, padding: 20, borderWidth: 1, borderColor: "#E5E7EB",
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04, shadowRadius: 8, elevation: 2,
  },
  cardTitle: { fontSize: 17, fontWeight: "900", color: "#0A0F1E", marginBottom: 16 },

  // Status card
  statusCard: { flexDirection: "row", alignItems: "center", gap: 12, borderLeftWidth: 4 },
  statusIcon: { width: 44, height: 44, borderRadius: 22, justifyContent: "center", alignItems: "center" },
  statusCardTitle: { fontSize: 14, fontWeight: "900" },
  statusCardDesc:  { marginTop: 3, fontSize: 12, color: "#6B7280", fontWeight: "600" },

  // Rows
  row: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: "#F3F4F6",
  },
  rowLabel: { fontSize: 13, fontWeight: "700", color: "#6B7280", flex: 1 },
  rowValue: {
    flex: 1.5, textAlign: "right", marginLeft: 12,
    fontSize: 13, fontWeight: "800", color: "#0A0F1E",
  },
  monoText: { fontSize: 11, color: "#9CA3AF" },

  inlineChip:     { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  inlineChipText: { fontSize: 11, fontWeight: "800" },

  // Payment mode
  payModePill: {
    flexDirection: "row", alignItems: "center", gap: 7,
    marginTop: 14, alignSelf: "flex-start",
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999,
  },
  payModeDot:  { width: 7, height: 7, borderRadius: 4 },
  payModeText: { fontSize: 12, fontWeight: "800" },

  // Phone chips
  phoneChip: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "#CCFBF1", paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10,
  },
  phoneChipText: { fontSize: 13, fontWeight: "800", color: "#0F766E" },

  phoneLockedChip: {
    flexDirection: "row", alignItems: "center", gap: 5,
    backgroundColor: "#F3F4F6", paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10,
  },
  phoneLockedText: { fontSize: 12, fontWeight: "700", color: "#9CA3AF" },

  noteText: { fontSize: 14, lineHeight: 22, color: "#374151", fontWeight: "500" },
});
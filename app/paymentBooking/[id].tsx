import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  ScrollView,
  SafeAreaView,
  StatusBar,
  Alert,
  Platform,
} from "react-native";
import { useEffect, useMemo, useState, useRef, useCallback } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { doc, getDoc } from "firebase/firestore";
import { db, auth } from "../../firebaseConfig";
import Animated, { FadeInDown } from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import * as Sharing from "expo-sharing";
import ViewShot from "react-native-view-shot";

const SERVER_URL = "https://bookora-backend-95u4.onrender.com";

// ─── Types ────────────────────────────────────────────────────────────────────
type Booking = {
  id: string;
  turfName?: string;
  turfLocation?: string;
  dateString?: string;
  date?: any;
  bookingDate?: Date;
  selectedSlots?: string[];
  slotTime?: string;
  slot?: string;
  startTime?: string;
  endTime?: string;
  status?: string;
  paymentStatus?: string;
  totalAmount?: number;
  advanceAmount?: number;
  paidAmount?: number;
  remainingAmount?: number;
  bookingType?: string;
  paymentId?: string;
  orderId?: string;
  userId?: string;
  userName?: string;
  refundStatus?: string;
  refundAmount?: number;
  refundId?: string;
  cancelledAt?: any;
  cancellationReason?: string;
};

// ─── Refund status config ─────────────────────────────────────────────────────
const REFUND_CFG: Record<string, {
  label: string; sublabel: string; color: string;
  bg: string; icon: string; step: number;
}> = {
  not_applicable: {
    label:    "No Refund",
    sublabel: "Advance booking — remaining was to be paid at turf.",
    color:    "#6B7280",
    bg:       "#F3F4F6",
    icon:     "remove-circle-outline",
    step:     0,
  },
  pending: {
    label:    "Refund Pending",
    sublabel: "Your refund request has been received and is being processed.",
    color:    "#D97706",
    bg:       "#FEF3C7",
    icon:     "hourglass-outline",
    step:     1,
  },
  initiated: {
    label:    "Refund Initiated",
    sublabel: "Razorpay has initiated your refund. Allow 5–7 business days.",
    color:    "#2563EB",
    bg:       "#DBEAFE",
    icon:     "reload-circle-outline",
    step:     2,
  },
  processed: {
    label:    "Refund Completed",
    sublabel: "Refund has been successfully processed. Amount usually reflects in your bank within 4–5 business days.",
    color:    "#059669",
    bg:       "#D1FAE5",
    icon:     "checkmark-circle",
    step:     3,
  },
  settlement_pending: {
    label:    "Bank Transfer Pending",
    sublabel: "Razorpay has processed your refund. Waiting for bank settlement.",
    color:    "#2563EB",
    bg:       "#DBEAFE",
    icon:     "swap-horizontal-outline",
    step:     3,
  },
  failed: {
    label:    "Refund Failed",
    sublabel: "There was an issue processing your refund. Please contact support.",
    color:    "#DC2626",
    bg:       "#FEE2E2",
    icon:     "close-circle",
    step:     -1,
  },
};

const REFUND_STEPS = [
  { key: "pending",   label: "Received"  },
  { key: "initiated", label: "Initiated" },
  { key: "processed", label: "Processed" },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function parseTime(s: string, isEnd = false): number {
  const parts = s.trim().split(" ");
  const [hStr, mStr] = parts[0].split(":");
  let h = Number(hStr);
  const m = Number(mStr || 0);
  const period = (parts[1] || "").toUpperCase();
  if (period === "PM" && h !== 12) h += 12;
  if (period === "AM" && h === 12) h = 0;
  const val = h + m / 60;
  if (isEnd && val === 0) return 24;
  return val;
}

function formatTime(v: number): string {
  v = ((v % 24) + 24) % 24;
  const hour = Math.floor(v);
  const minute = Math.round((v % 1) * 60);
  const suffix = hour >= 12 ? "PM" : "AM";
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h}:${String(minute).padStart(2, "0")} ${suffix}`;
}

function formatDuration(hrs: number): string {
  if (hrs <= 0) return "";
  if (hrs < 1)  return `${Math.round(hrs * 60)} min`;
  if (hrs === 1) return "1 hr";
  return `${hrs % 1 === 0 ? hrs : hrs.toFixed(1)} hrs`;
}

function formatSlotRange(slots: string[] = []): string {
  if (!Array.isArray(slots) || !slots.length) return "Slot not available";
  const parsed = slots.map((s) => {
    const parts = s.split(" - ");
    if (parts.length < 2) return null;
    return {
      start: parseTime(parts[0].trim(), false),
      end:   parseTime(parts[1].trim(), true),
    };
  }).filter(Boolean) as { start: number; end: number }[];

  parsed.sort((a, b) => a.start - b.start);

  const merged: { start: number; end: number }[] = [];
  for (const slot of parsed) {
    if (!merged.length) { merged.push({ ...slot }); continue; }
    const last = merged[merged.length - 1];
    if (Math.abs(slot.start - last.end) < 0.02) last.end = slot.end;
    else merged.push({ ...slot });
  }

  return merged.map(({ start, end }) => {
    let duration = end - start;
    if (duration <= 0) duration += 24;
    return `${formatTime(start)} – ${formatTime(end)} · ${formatDuration(duration)}`;
  }).join("\n");
}

function formatDate(date: Date | null | undefined): string {
  if (!date || !(date instanceof Date) || isNaN(date.getTime())) {
    return "Date not available";
  }
  return date.toLocaleDateString("en-US", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });
}

// ─── Refund Tracker Component ─────────────────────────────────────────────────
function RefundTracker({
  booking,
  onRefresh,
}: {
  booking: Booking;
  onRefresh: () => void;
}) {
  const [liveRefund,  setLiveRefund]  = useState<any>(null);
  const [checking,    setChecking]    = useState(false);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);

  // Reset live state whenever booking ID changes
  useEffect(() => {
    setLiveRefund(null);
    setLastChecked(null);
    setChecking(false);
  }, [booking?.id]);

  // Use live data if available, otherwise fall back to booking data
  const refundStatus = liveRefund?.refundStatus ?? booking.refundStatus ?? "not_applicable";
  const refundAmount = liveRefund?.refundAmount ?? booking.refundAmount ?? 0;
  const cfg = REFUND_CFG[refundStatus] ?? REFUND_CFG.not_applicable;

  // FIX: correct statusMap — pending stays pending, don't wrongly map to initiated
  const checkRefundStatus = useCallback(async () => {
    if (!booking?.id || !auth.currentUser?.uid) return;
    setChecking(true);
    try {
      const res = await fetch(
        `${SERVER_URL}/refund-status/${booking.id}?userId=${auth.currentUser.uid}`
      );
      const data = await res.json();
      if (data.success) {
        // Razorpay statuses: pending | processed | failed
        // Our REFUND_CFG keys: pending | initiated | processed | failed
        const statusMap: Record<string, string> = {
          pending:    "pending",
          initiated:  "initiated",
          processed:  "processed",
          failed:     "failed",
        };
        const normalizedStatus = statusMap[data.refundStatus] ?? data.refundStatus;
        setLiveRefund({ ...data, refundStatus: normalizedStatus });
        setLastChecked(new Date());
      }
    } catch (e) {
      console.log("Refund check error:", e);
    } finally {
      setChecking(false);
    }
  }, [booking?.id]);

  // FIX: auto-check only on booking ID change + only for online payments
  // Removed refundStatus from deps to prevent infinite loop
  useEffect(() => {
    if (
      booking?.status === "cancelled" &&
      booking?.paymentId  // only online bookings have paymentId
    ) {
      checkRefundStatus();
    }
  }, [booking?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (booking?.status !== "cancelled") return null;

  return (
    <Animated.View entering={FadeInDown.delay(150).duration(300)} style={rt.wrap}>
      {/* Header */}
      <View style={rt.header}>
        <Ionicons name="refresh-circle-outline" size={20} color="#7C3AED" />
        <Text style={rt.headerTitle}>Refund Status</Text>
        <TouchableOpacity
          style={rt.refreshBtn}
          onPress={checkRefundStatus}
          disabled={checking}
        >
          {checking
            ? <ActivityIndicator size="small" color="#7C3AED" />
            : <Ionicons name="refresh-outline" size={16} color="#7C3AED" />
          }
        </TouchableOpacity>
      </View>

      {/* Status banner */}
      <View style={[rt.banner, { backgroundColor: cfg.bg }]}>
        <View style={[rt.iconCircle, { backgroundColor: cfg.color + "20" }]}>
          <Ionicons name={cfg.icon as any} size={28} color={cfg.color} />
        </View>
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={[rt.bannerTitle, { color: cfg.color }]}>{cfg.label}</Text>
          <Text style={[rt.bannerSub, { color: cfg.color + "BB" }]}>{cfg.sublabel}</Text>
          {refundAmount > 0 && (
            <Text style={[rt.refundAmt, { color: cfg.color }]}>₹{refundAmount}</Text>
          )}
        </View>
      </View>

      {/* Progress steps — only for online refunds */}
      {refundStatus !== "not_applicable" && refundStatus !== "failed" && (
        <View style={rt.stepsWrap}>
          {REFUND_STEPS.map((step, i) => {
            const done    = cfg.step > i + 1;
            const current = cfg.step === i + 1;
            return (
              <View key={step.key} style={rt.stepRow}>
                <View style={rt.stepLeft}>
                  <View style={[
                    rt.stepDot,
                    done    && rt.stepDotDone,
                    current && rt.stepDotCurrent,
                  ]}>
                    {done
                      ? <Ionicons name="checkmark" size={11} color="#fff" />
                      : <Text style={[rt.stepDotNum, current && { color: "#fff" }]}>{i + 1}</Text>
                    }
                  </View>
                  {i < REFUND_STEPS.length - 1 && (
                    <View style={[rt.stepLine, done && rt.stepLineDone]} />
                  )}
                </View>
                <Text style={[rt.stepLabel, (done || current) && rt.stepLabelActive]}>
                  {step.label}
                  {current && " ⟵ Now"}
                </Text>
              </View>
            );
          })}
        </View>
      )}

      {/* Info rows */}
      <View style={rt.infoBlock}>
        {booking.cancelledAt && (
          <View style={rt.infoRow}>
            <Text style={rt.infoLabel}>Cancelled on</Text>
            <Text style={rt.infoVal}>
              {(() => {
                const d = booking.cancelledAt?.toDate?.()
                  ?? new Date(booking.cancelledAt);
                return isNaN(d.getTime())
                  ? "—"
                  : d.toLocaleDateString("en-IN", {
                      day: "numeric", month: "short", year: "numeric",
                    });
              })()}
            </Text>
          </View>
        )}
        {booking.cancellationReason && (
          <View style={rt.infoRow}>
            <Text style={rt.infoLabel}>Reason</Text>
            <Text style={rt.infoVal}>{booking.cancellationReason}</Text>
          </View>
        )}
        {refundStatus !== "not_applicable" && (
          <View style={rt.infoRow}>
            <Text style={rt.infoLabel}>Refund amount</Text>
            <Text style={[rt.infoVal, { color: "#059669", fontWeight: "800" }]}>
              {refundAmount > 0 ? `₹${refundAmount}` : "—"}
            </Text>
          </View>
        )}
        {liveRefund?.processedAt && (
          <View style={rt.infoRow}>
            <Text style={rt.infoLabel}>Processed at</Text>
            <Text style={rt.infoVal}>
              {new Date(liveRefund.processedAt * 1000).toLocaleDateString("en-IN", {
                day: "numeric", month: "short",
              })}
            </Text>
          </View>
        )}
        {lastChecked && (
          <View style={[rt.infoRow, { borderBottomWidth: 0 }]}>
            <Text style={rt.infoLabel}>Last checked</Text>
            <Text style={rt.infoVal}>
              {lastChecked.toLocaleTimeString("en-IN", {
                hour: "numeric", minute: "2-digit",
              })}
            </Text>
          </View>
        )}
      </View>

      {/* Failed refund — contact support */}
      {refundStatus === "failed" && (
        <View style={rt.failBox}>
          <Ionicons name="alert-circle-outline" size={16} color="#DC2626" />
          <Text style={rt.failTxt}>
            Refund failed. Please contact support with your Booking ID:{" "}
            {booking.id?.slice(0, 14)}
          </Text>
        </View>
      )}

      {/* Not applicable explanation */}
      {refundStatus === "not_applicable" && (
        <View style={rt.naBox}>
          <Ionicons name="information-circle-outline" size={16} color="#6B7280" />
          <Text style={rt.naTxt}>
            You paid ₹{booking.advanceAmount || 0} online as advance. The remaining ₹
            {booking.remainingAmount || 0} was to be paid at the turf. Since the
            booking was cancelled, no online refund is applicable.
          </Text>
        </View>
      )}
    </Animated.View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function BookingDetails() {
  const { id }     = useLocalSearchParams();
  const router     = useRouter();
  const receiptRef = useRef<any>(null);

  const [booking,    setBooking]    = useState<Booking | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [cancelling, setCancelling] = useState(false);
  const [cancelWindowHours, setCancelWindowHours] = useState<number>(2); // default 2

  useEffect(() => {
  fetchBooking();
  fetchCancelWindow();
}, []);

const fetchCancelWindow = async () => {
  try {
    const snap = await getDoc(doc(db, "appConfig", "booking"));
    if (snap.exists()) {
      const hours = Number(snap.data()?.cancellationWindowHours);
      if (!isNaN(hours) && hours >= 0 && hours <= 24) {
        setCancelWindowHours(hours);
      }
    }
  } catch (e) {
    console.log("fetchCancelWindow error:", e);
    // Falls back to default 2
  }
};

  const fetchBooking = async () => {
    try {
      setLoading(true);
      const snap = await getDoc(doc(db, "bookings", String(id)));
      if (snap.exists()) {
        const data = snap.data();
        // Convert Firestore Timestamp to JS Date
        const bookingDate = data.date?.toDate
          ? data.date.toDate()
          : data.date
          ? new Date(data.date)
          : null;
        setBooking({ id: snap.id, ...data, bookingDate } as Booking);
      } else {
        setBooking(null);
      }
    } catch (e) {
      console.log("fetchBooking error:", e);
      setBooking(null);
    } finally {
      setLoading(false);
    }
  };

  // FIX: canCancelBooking — use auth.currentUser check + correct 2hr window
  const canCancelBooking = useMemo(() => {
    if (!booking?.bookingDate || booking.status === "cancelled") return false;
    if (!auth.currentUser?.uid) return false;

    const slots = booking.selectedSlots || [];
    const firstSlot = slots[0] || booking.slotTime || booking.slot || "";
    if (!firstSlot) return false;

    const startPart = firstSlot.includes(" - ")
      ? firstSlot.split(" - ")[0].trim()
      : firstSlot.trim();

    const timeMatch = startPart.match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)/i);
    if (!timeMatch) return false;

    let hour = parseInt(timeMatch[1]);
    const minute = parseInt(timeMatch[2] || "0");
    const meridiem = timeMatch[3].toUpperCase();
    if (meridiem === "PM" && hour < 12) hour += 12;
    if (meridiem === "AM" && hour === 12) hour = 0;

    const bookingDateTime = new Date(booking.bookingDate);
    bookingDateTime.setHours(hour, minute, 0, 0);

  const hoursLeft = (bookingDateTime.getTime() - Date.now()) / (1000 * 60 * 60);
return hoursLeft >= cancelWindowHours;  // ✅ Dynamic now
}, [booking, cancelWindowHours]);

  const cancelBooking = async () => {
  if (!canCancelBooking) {
    return Alert.alert(
      "Cancellation Closed",
      `Bookings can only be cancelled at least ${cancelWindowHours} hours before the slot.`
    );
  }
    Alert.alert(
      "Cancel Booking",
      "Are you sure you want to cancel? Refund will be processed according to cancellation policy.",
      [
        { text: "Keep Booking", style: "cancel" },
        {
          text: "Cancel Booking",
          style: "destructive",
          onPress: async () => {
            try {
              setCancelling(true);
              // FIX: use auth.currentUser.uid — never trust client-sent userId
              const uid = auth.currentUser?.uid;
              if (!uid) throw new Error("Not logged in");

              const response = await fetch(`${SERVER_URL}/cancel-booking`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  bookingId: booking!.id,
                  userId:    uid,           // ← always from auth, never from booking doc
                  reason:    "User cancelled booking",
                }),
              });
              const data = await response.json();
              if (!response.ok || !data.success) {
                throw new Error(data.error || "Cancellation failed");
              }
              await fetchBooking();
              Alert.alert("Booking Cancelled", data.message || "Your booking has been cancelled.");
            } catch (e: any) {
              Alert.alert("Error", e.message || "Unable to cancel booking.");
            } finally {
              setCancelling(false);
            }
          },
        },
      ]
    );
  };

  const shareReceipt = async () => {
    try {
      // Small delay to ensure ViewShot renders fully
      await new Promise(resolve => setTimeout(resolve, 300));
      const uri = await receiptRef.current.capture();
      // FIX: add mimeType for Android share sheet
      await Sharing.shareAsync(uri, {
        mimeType:    "image/png",
        dialogTitle: "Share Booking Receipt",
        UTI:         "public.png",
      });
    } catch (e) {
      Alert.alert("Error", "Unable to share receipt. Please try again.");
    }
  };

  // FIX: bookingStatus — slot <2hrs away should NOT show as completed
  const bookingStatus = useMemo(() => {
    const rawStatus = booking?.status || "pending";
    if (rawStatus === "cancelled") return "cancelled";
    if (rawStatus === "completed") return "completed";

    // Only mark completed if the booking date is fully in the past (end of that day)
    if (booking?.bookingDate) {
      const bookingDay = new Date(booking.bookingDate);
      bookingDay.setHours(23, 59, 59, 999);
      if (bookingDay < new Date()) return "completed";
    }

    return rawStatus; // "confirmed" for future/today bookings
  }, [booking]);

  const statusConfig = useMemo(() => {
    if (bookingStatus === "confirmed") return { color: "#0A7D57", bg: "#E7F8F0", label: "CONFIRMED" };
    if (bookingStatus === "cancelled") return { color: "#D92D20", bg: "#FDECEC", label: "CANCELLED" };
    if (bookingStatus === "completed") return { color: "#555555", bg: "#EEEEEE", label: "COMPLETED" };
    return { color: "#B76E00", bg: "#FFF3E0", label: "PENDING" };
  }, [bookingStatus]);

  // ─── Loading ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <SafeAreaView style={styles.center}>
        <StatusBar barStyle="dark-content" backgroundColor="#F3F4F6" />
        <ActivityIndicator size="large" color="#111111" />
        <Text style={styles.loaderText}>Loading booking details...</Text>
      </SafeAreaView>
    );
  }

  // ─── Not found ──────────────────────────────────────────────────────────────
  if (!booking) {
    return (
      <SafeAreaView style={styles.center}>
        <StatusBar barStyle="dark-content" backgroundColor="#F3F4F6" />
        <Ionicons name="alert-circle-outline" size={52} color="#D1D5DB" />
        <Text style={styles.emptyTitle}>Booking not found</Text>
        <Text style={[styles.loaderText, { textAlign: "center", marginTop: 8 }]}>
          This booking may have been removed or the link is invalid.
        </Text>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Text style={styles.backButtonText}>Go Back</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" backgroundColor="#F3F4F6" />
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >

        {/* ── Top bar ── */}
        <Animated.View entering={FadeInDown.duration(150)} style={styles.topBar}>
          <TouchableOpacity style={styles.iconBtn} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={20} color="#111111" />
          </TouchableOpacity>
          <Text style={styles.topBarTitle}>Booking Receipt</Text>
          <View style={styles.iconBtnPlaceholder} />
        </Animated.View>

        {/* ── Receipt (captured by ViewShot for sharing) ── */}
        <ViewShot
          ref={receiptRef}
          options={{ format: "png", quality: 1 }}
          style={{ backgroundColor: "#FFFFFF", padding: 16 }}
        >
          <Animated.View entering={FadeInDown.delay(100).duration(300)} style={styles.receiptCard}>

            {/* Header */}
            <View style={styles.receiptHeader}>
              <View>
                <Text style={styles.receiptTitle}>PLAYON</Text>
                <Text style={styles.receiptSub}>Booking Confirmed</Text>
              </View>
              <Ionicons name="checkmark-circle" size={34} color="#16A34A" />
            </View>

            <View style={styles.dashedLine} />

            {/* Details */}
            <View style={styles.receiptRow}>
              <Text style={styles.receiptLabel}>Venue</Text>
              <Text style={styles.receiptValue}>{booking.turfName || "N/A"}</Text>
            </View>

            <View style={styles.receiptRow}>
              <Text style={styles.receiptLabel}>Date</Text>
              <Text style={styles.receiptValue}>
                {formatDate(booking.bookingDate ?? null)}
              </Text>
            </View>

            <View style={styles.receiptRow}>
              <Text style={styles.receiptLabel}>Slot</Text>
              <Text style={[styles.receiptValue, styles.slotValue]}>
                {booking.startTime && booking.endTime
                  ? `${booking.startTime} - ${booking.endTime}`
                  : Array.isArray(booking.selectedSlots) && booking.selectedSlots.length > 0
                  ? formatSlotRange(booking.selectedSlots)
                  : booking.slotTime || "Slot not available"}
              </Text>
            </View>

            <View style={styles.receiptRow}>
              <Text style={styles.receiptLabel}>Booking ID</Text>
              <Text style={[styles.receiptValue, { maxWidth: "58%", textAlign: "right" }]}>
                {booking.id}
              </Text>
            </View>

            <View style={styles.receiptRow}>
              <Text style={styles.receiptLabel}>Payment Status</Text>
              <Text style={styles.receiptValue}>
                {booking.paymentStatus
                  ? booking.paymentStatus.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())
                  : "Paid"}
              </Text>
            </View>

            <View style={styles.receiptRow}>
              <Text style={styles.receiptLabel}>Booking Status</Text>
              <Text style={[styles.receiptValue, { color: statusConfig.color }]}>
                {statusConfig.label}
              </Text>
            </View>

            <View style={styles.dashedLine} />

            {/* Amounts */}
            <View style={styles.receiptRow}>
              <Text style={styles.receiptLabel}>Advance Paid</Text>
              <Text style={styles.receiptValue}>₹{booking.advanceAmount || booking.paidAmount || 0}</Text>
            </View>

            <View style={styles.receiptRow}>
              <Text style={styles.receiptLabel}>Remaining Amount</Text>
              <Text style={styles.receiptValue}>₹{booking.remainingAmount || 0}</Text>
            </View>

            <View style={styles.receiptRow}>
              <Text style={[styles.receiptLabel, { fontWeight: "800", color: "#111111" }]}>
                Total Amount
              </Text>
              <Text style={[styles.receiptValue, { fontSize: 18 }]}>
                ₹{booking.totalAmount || 0}
              </Text>
            </View>

            <View style={styles.dashedLine} />
            <Text style={styles.receiptFooter}>Thank you for booking with Playon </Text>
          </Animated.View>
        </ViewShot>

        {/* ── Refund tracker (only shows when cancelled) ── */}
        <RefundTracker
          key={booking?.id}
          booking={booking}
          onRefresh={fetchBooking}
        />

        {/* ── Action buttons ── */}
        <Animated.View
          entering={FadeInDown.delay(100).duration(300)}
          style={styles.receiptCard}
        >
          {bookingStatus === "confirmed" && (
            <TouchableOpacity
              style={[styles.cancelBtn, cancelling && { opacity: 0.6 }]}
              onPress={cancelBooking}
              disabled={cancelling}
            >
              {cancelling
                ? <ActivityIndicator size="small" color="#fff" />
                : <Text style={styles.btnText}>Cancel Booking</Text>
              }
            </TouchableOpacity>
          )}

          <TouchableOpacity style={styles.shareBtn} onPress={shareReceipt}>
            <Ionicons name="share-social-outline" size={18} color="#111111" />
            <Text style={styles.shareBtnText}>Share Receipt</Text>
          </TouchableOpacity>
        </Animated.View>

      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Refund tracker styles ────────────────────────────────────────────────────
const rt = StyleSheet.create({
  wrap: {
    backgroundColor: "#FFFFFF",
    marginHorizontal: 16,
    marginTop: 16,
    borderRadius: 24,
    padding: 18,
    borderWidth: 1,
    borderColor: "#DDD6FE",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 14,
    gap: 8,
  },
  headerTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: "800",
    color: "#111827",
  },
  refreshBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: "#F5F3FF",
    alignItems: "center",
    justifyContent: "center",
  },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 16,
    padding: 14,
    marginBottom: 16,
  },
  iconCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  bannerTitle: {
    fontSize: 15,
    fontWeight: "900",
    marginBottom: 4,
  },
  bannerSub: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "500",
  },
  refundAmt: {
    fontSize: 20,
    fontWeight: "900",
    marginTop: 6,
  },
  stepsWrap: {
    marginBottom: 16,
    paddingHorizontal: 4,
  },
  stepRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    marginBottom: 0,
  },
  stepLeft: {
    alignItems: "center",
    width: 24,
  },
  stepDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "#E5E7EB",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#D1D5DB",
  },
  stepDotDone:    { backgroundColor: "#059669", borderColor: "#059669" },
  stepDotCurrent: { backgroundColor: "#7C3AED", borderColor: "#7C3AED" },
  stepDotNum:     { fontSize: 10, fontWeight: "800", color: "#9CA3AF" },
  stepLine:       { width: 2, height: 20, backgroundColor: "#E5E7EB", marginTop: 2 },
  stepLineDone:   { backgroundColor: "#059669" },
  stepLabel:      { fontSize: 13, color: "#9CA3AF", fontWeight: "600", paddingTop: 4, paddingBottom: 20 },
  stepLabelActive:{ color: "#111827", fontWeight: "700" },

  infoBlock: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    overflow: "hidden",
    marginBottom: 10,
  },
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#F3F4F6",
    backgroundColor: "#FFFFFF",
  },
  infoLabel: { fontSize: 12, color: "#9CA3AF", fontWeight: "600" },
  infoVal:   { fontSize: 13, color: "#111827", fontWeight: "700" },

  failBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    backgroundColor: "#FEE2E2",
    borderRadius: 12,
    padding: 12,
    marginTop: 4,
  },
  failTxt: { flex: 1, fontSize: 12, color: "#DC2626", lineHeight: 18, fontWeight: "500" },

  naBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    backgroundColor: "#F9FAFB",
    borderRadius: 12,
    padding: 12,
    marginTop: 4,
  },
  naTxt: { flex: 1, fontSize: 12, color: "#6B7280", lineHeight: 18, fontWeight: "500" },
});

// ─── Main styles ──────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  safeArea:  { flex: 1, backgroundColor: "#F3F4F6" },
  container: { flex: 1, backgroundColor: "#FFFFFF", paddingTop: 20 },
  content:   { paddingBottom: 40 },
  center:    {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#F3F4F6",
    paddingHorizontal: 24,
  },
  loaderText: { marginTop: 12, color: "#4B5563", fontSize: 15, fontWeight: "600" },
  emptyTitle: { fontSize: 22, fontWeight: "800", color: "#111111", marginTop: 12 },

  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: Platform.OS === "android" ? 12 : 8,
    paddingBottom: 3,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#FFFFFF",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  iconBtnPlaceholder: { width: 40, height: 40 },
  topBarTitle: { fontSize: 18, fontWeight: "800", color: "#111111" },

  cancelBtn: {
    backgroundColor: "#111111",
    paddingVertical: 12,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
    flexDirection: "row",
    gap: 8,
  },
  btnText: { color: "#FFFFFF", fontWeight: "700", fontSize: 14 },

  backButton: {
    marginTop: 16,
    backgroundColor: "#111111",
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 12,
  },
  backButtonText: { color: "#FFFFFF", fontWeight: "700" },

  receiptCard: {
    backgroundColor: "#FFFFFF",
    marginHorizontal: 16,
    marginTop: 16,
    borderRadius: 24,
    padding: 18,
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  receiptHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  receiptTitle: { fontSize: 18, fontWeight: "800", color: "#111111", letterSpacing: 1 },
  receiptSub:   { fontSize: 13, color: "#6B7280", marginTop: 3 },

  dashedLine: {
    borderStyle: "dashed",
    borderWidth: 1,
    borderColor: "#D1D5DB",
    marginVertical: 16,
  },
  receiptRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 12,
  },
  receiptLabel: { color: "#6B7280", fontSize: 14 },
  receiptValue: { color: "#111111", fontSize: 14, fontWeight: "800" },
  receiptFooter: {
    textAlign: "center",
    color: "#6B7280",
    fontSize: 13,
    fontWeight: "600",
  },

  shareBtn: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E5E7EB",
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    marginBottom: 4,
  },
  shareBtnText: { marginLeft: 8, color: "#111111", fontWeight: "700", fontSize: 14 },

  slotValue: {
    maxWidth: "68%",
    textAlign: "right",
    lineHeight: 22,
  },
});
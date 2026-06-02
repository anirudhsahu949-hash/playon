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
import { useEffect, useMemo, useState, useRef } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../../../firebaseConfig";
import Animated, { FadeInDown } from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import * as Sharing from "expo-sharing";
import ViewShot from "react-native-view-shot";

// ─────────────────────────────────────────────────────────────────────────────
// OFFLINE BOOKING RECEIPT
// Fetches from "blockedSlots" collection using the offlineDocId param
// Usage: router.push(`/offline-receipt?id=${offlineDocId}`)
// ─────────────────────────────────────────────────────────────────────────────

type OfflineBooking = {
  id: string;
  customerName?: string;
  customerPhone?: string;
  note?: string;
  turfName?: string;
  turfId?: string;
  date?: string;           // stored as string e.g. "Mon May 16 2026"
  slots?: string[];
  slotTime?: string;
  amount?: number;
  totalAmount?: number;
  paidAmount?: number;
  advanceAmount?: number;
  remainingAmount?: number;
  remainingCollected?: boolean;
  arrived?: boolean;
  type?: string;
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function parseTime(s: string): number {
  const parts = s.trim().split(" ");
  const [hStr, mStr] = parts[0].split(":");
  let h = Number(hStr);
  const m = Number(mStr || 0);
  const period = (parts[1] || "").toUpperCase();
  if (period === "PM" && h !== 12) h += 12;
  if (period === "AM" && h === 12) h = 0;
  return h + m / 60;
}

function formatTime(v: number): string {
  if (v >= 24) v = 0;
  const hour = Math.floor(v);
  const minute = Math.round((v % 1) * 60);
  const suffix = hour >= 12 ? "PM" : "AM";
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h}:${String(minute).padStart(2, "0")} ${suffix}`;
}

function formatDuration(hrs: number): string {
  if (hrs < 1) return `${Math.round(hrs * 60)} min`;
  if (hrs === 1) return "1 hr";
  return `${hrs % 1 === 0 ? hrs : hrs.toFixed(1)} hrs`;
}

function formatSlotRange(slots: string[]): string {
  if (!Array.isArray(slots) || slots.length === 0) return "Slot not available";

  const parsed = slots
    .map((s) => {
      const parts = s.split(" - ");
      if (parts.length < 2) return null;
      return { start: parseTime(parts[0]), end: parseTime(parts[1]) };
    })
    .filter(Boolean) as { start: number; end: number }[];

  parsed.sort((a, b) => a.start - b.start);

  const merged: { start: number; end: number }[] = [];
  for (const slot of parsed) {
    if (merged.length === 0) {
      merged.push({ ...slot });
    } else {
      const last = merged[merged.length - 1];
      if (Math.abs(slot.start - last.end) < 0.02) {
        last.end = slot.end;
      } else {
        merged.push({ ...slot });
      }
    }
  }

  return merged
    .map(({ start, end }) => {
      let duration = end - start;
      if (duration <= 0) duration += 24;
      return `${formatTime(start)} – ${formatTime(end)} · ${formatDuration(duration)}`;
    })
    .join("\n");
}

function formatDate(raw: string | undefined): string {
  if (!raw) return "Date not available";
  const d = new Date(raw);
  if (isNaN(d.getTime())) return raw; // fallback: show raw string
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function fmtAmount(n: number): string {
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

// ── Screen ────────────────────────────────────────────────────────────────────
export default function OfflineBookingReceipt() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const receiptRef = useRef<ViewShot>(null);

  const [booking, setBooking] = useState<OfflineBooking | null>(null);
  const [loading, setLoading]   = useState(true);

  useEffect(() => { fetchBooking(); }, []);

  const fetchBooking = async () => {
    try {
      setLoading(true);
      const snap = await getDoc(doc(db, "blockedSlots", String(id)));
      if (snap.exists()) {
        setBooking({ id: snap.id, ...snap.data() } as OfflineBooking);
      } else {
        setBooking(null);
      }
    } catch (e) {
      console.log(e);
      setBooking(null);
    } finally {
      setLoading(false);
    }
  };

  const shareReceipt = async () => {
    try {
      await new Promise((resolve) => setTimeout(resolve, 300));
      const uri = await (receiptRef.current as any).capture();
      await Sharing.shareAsync(uri);
    } catch (e) {
      console.log(e);
      Alert.alert("Error", "Unable to share receipt.");
    }
  };

  // ── Derived values ─────────────────────────────────────────────────────────
  const totalAmount     = Number(booking?.totalAmount ?? booking?.amount ?? 0);
  const paidAmount      = Number(booking?.paidAmount  ?? booking?.advanceAmount ?? 0);
  const remainingAmount = Number(
    booking?.remainingAmount !== undefined
      ? booking.remainingAmount
      : Math.max(totalAmount - paidAmount, 0)
  );

  const slots = Array.isArray(booking?.slots)
    ? booking!.slots
    : booking?.slotTime
    ? [booking!.slotTime]
    : [];

  const paymentLabel = useMemo(() => {
    if (remainingAmount <= 0 || booking?.remainingCollected) return "Fully Paid (Cash)";
    if (paidAmount > 0) return "Partial (Advance Paid)";
    return "Pending";
  }, [booking, paidAmount, remainingAmount]);

  const paymentColor = useMemo(() => {
    if (remainingAmount <= 0 || booking?.remainingCollected) return "#0A7D57";
    if (paidAmount > 0) return "#B76E00";
    return "#D92D20";
  }, [booking, paidAmount, remainingAmount]);

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <SafeAreaView style={styles.center}>
        <StatusBar barStyle="dark-content" backgroundColor="#F3F4F6" />
        <ActivityIndicator size="large" color="#111111" />
        <Text style={styles.loaderText}>Loading receipt...</Text>
      </SafeAreaView>
    );
  }

  if (!booking) {
    return (
      <SafeAreaView style={styles.center}>
        <StatusBar barStyle="dark-content" backgroundColor="#F3F4F6" />
        <Text style={styles.emptyTitle}>Booking not found</Text>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Text style={styles.backButtonText}>Go Back</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" backgroundColor="#F3F4F6" />

      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* TOP BAR */}
        <Animated.View entering={FadeInDown.duration(150)} style={styles.topBar}>
          <TouchableOpacity style={styles.iconBtn} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={20} color="#111111" />
          </TouchableOpacity>
          <Text style={styles.topBarTitle}>Walk-in Receipt</Text>
          <View style={styles.iconBtnPlaceholder} />
        </Animated.View>

        {/* OFFLINE BADGE */}
        <Animated.View entering={FadeInDown.delay(80).duration(200)} style={styles.offlineBadgeWrap}>
          <View style={styles.offlineBadge}>
            <Ionicons name="person-outline" size={13} color="#0F766E" />
            <Text style={styles.offlineBadgeText}>WALK-IN / CASH BOOKING</Text>
          </View>
        </Animated.View>

        {/* RECEIPT CARD (captured for share) */}
        <ViewShot
          ref={receiptRef}
          options={{ format: "png", quality: 1 }}
          style={{ backgroundColor: "#FFFFFF", padding: 16 }}
        >
          <Animated.View
            entering={FadeInDown.delay(100).duration(300)}
            style={styles.receiptCard}
          >
            {/* Header */}
            <View style={styles.receiptHeader}>
              <View>
                <Text style={styles.receiptTitle}>PLAYON </Text>
                
              </View>
              <Ionicons name="person-circle-outline" size={34} color="#0F766E" />
            </View>

            <View style={styles.dashedLine} />

            {/* Customer info */}
            <View style={styles.receiptRow}>
              <Text style={styles.receiptLabel}>Customer</Text>
              <Text style={styles.receiptValue}>{booking.customerName || "Walk-in"}</Text>
            </View>

          {/*  {booking.customerPhone ? (
              <View style={styles.receiptRow}>
                <Text style={styles.receiptLabel}>Phone</Text>
                <Text style={styles.receiptValue}>{booking.customerPhone}</Text>
              </View>
            ) : null} */}

       {/*     {booking.note ? (
              <View style={styles.receiptRow}>
                <Text style={styles.receiptLabel}>Note</Text>
                <Text style={[styles.receiptValue, styles.noteValue]}>{booking.note}</Text>
              </View>
            ) : null} */}

            <View style={styles.dashedLine} />

            {/* Booking details */}
            <View style={styles.receiptRow}>
              <Text style={styles.receiptLabel}>Venue</Text>
              <Text style={styles.receiptValue}>{booking.turfName || "N/A"}</Text>
            </View>

            <View style={styles.receiptRow}>
              <Text style={styles.receiptLabel}>Date</Text>
              <Text style={styles.receiptValue}>{formatDate(booking.date)}</Text>
            </View>

            <View style={styles.receiptRow}>
              <Text style={styles.receiptLabel}>Slot</Text>
              <Text style={[styles.receiptValue, styles.slotValue]}>
                {slots.length > 0 ? formatSlotRange(slots) : "Slot not available"}
              </Text>
            </View>

            <View style={styles.receiptRow}>
              <Text style={styles.receiptLabel}>Booking ID</Text>
              <Text style={[styles.receiptValue, { maxWidth: "58%", textAlign: "right" }]}>
                {booking.id}
              </Text>
            </View>

            <View style={styles.receiptRow}>
              <Text style={styles.receiptLabel}>Booking Type</Text>
              <Text style={styles.receiptValue}>Offline / Cash</Text>
            </View>

           {/* <View style={styles.receiptRow}>
              <Text style={styles.receiptLabel}>Arrived</Text>
              <Text style={[styles.receiptValue, { color: booking.arrived ? "#0A7D57" : "#6B7280" }]}>
                {booking.arrived ? "Yes ✓" : "Not yet"}
              </Text>
            </View>*/}

            <View style={styles.dashedLine} />

            {/* Payment breakdown 
            <View style={styles.receiptRow}>
              <Text style={styles.receiptLabel}>Cash Paid</Text>
              <Text style={[styles.receiptValue, { color: "#0A7D57" }]}>
                {fmtAmount(paidAmount)}
              </Text>
            </View>*/}

            <View style={styles.receiptRow}>
              <Text style={styles.receiptLabel}>Remaining</Text>
              <Text style={[
                styles.receiptValue,
                {
                  color: remainingAmount > 0 && !booking.remainingCollected ? "#D92D20" : "#9CA3AF",
                  textDecorationLine: booking.remainingCollected ? "line-through" : "none",
                },
              ]}>
                {fmtAmount(remainingAmount)}
              </Text>
            </View>

            <View style={styles.receiptRow}>
              <Text style={[styles.receiptLabel, { fontWeight: "800", color: "#111111" }]}>
                advance
              </Text>
              <Text style={[styles.receiptValue, { fontSize: 18 }]}>
                {fmtAmount(totalAmount)}
              </Text>
            </View>

            <View style={styles.receiptRow}>
              <Text style={styles.receiptLabel}>Payment Status</Text>
              <Text style={[styles.receiptValue, { color: paymentColor }]}>{paymentLabel}</Text>
            </View>

            {booking.remainingCollected && (
              <View style={styles.collectedBanner}>
                <Ionicons name="checkmark-circle" size={14} color="#0A7D57" />
                <Text style={styles.collectedBannerText}>
                  Full amount collected at venue
                </Text>
              </View>
            )}

            <View style={styles.dashedLine} />

            <Text style={styles.receiptFooter}>Thank you for booking with Playon</Text>
          </Animated.View>
        </ViewShot>

        {/* ACTION BUTTONS */}
        <Animated.View
          entering={FadeInDown.delay(200).duration(300)}
          style={styles.receiptCard}
        >
          <TouchableOpacity style={styles.shareBtn} onPress={shareReceipt}>
            <Ionicons name="share-social-outline" size={18} color="#111111" />
            <Text style={styles.shareBtnText}>Share Receipt</Text>
          </TouchableOpacity>
        </Animated.View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  safeArea:  { flex: 1, backgroundColor: "#F3F4F6" },
  container: { flex: 1, backgroundColor: "#FFFFFF", paddingTop: 20 },
  content:   { paddingBottom: 30 },

  center: {
    flex: 1, justifyContent: "center", alignItems: "center",
    backgroundColor: "#F3F4F6", paddingHorizontal: 24,
  },
  loaderText: { marginTop: 12, color: "#4B5563", fontSize: 15, fontWeight: "600" },
  emptyTitle: { fontSize: 22, fontWeight: "800", color: "#111111" },

  topBar: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: Platform.OS === "android" ? 12 : 8,
    paddingBottom: 3,
  },
  iconBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: "#FFFFFF", justifyContent: "center", alignItems: "center",
    borderWidth: 1, borderColor: "#E5E7EB",
  },
  iconBtnPlaceholder: { width: 40, height: 40 },
  topBarTitle: { fontSize: 18, fontWeight: "800", color: "#111111" },

  offlineBadgeWrap: { alignItems: "center", marginTop: 12 },
  offlineBadge: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "#CCFBF1", borderRadius: 999,
    paddingHorizontal: 14, paddingVertical: 6,
    borderWidth: 1, borderColor: "#99F6E4",
  },
  offlineBadgeText: { fontSize: 11, fontWeight: "800", color: "#0F766E", letterSpacing: 0.8 },

  receiptCard: {
    backgroundColor: "#FFFFFF",
    marginHorizontal: 16, marginTop: 16,
    borderRadius: 24, padding: 18,
    borderWidth: 1, borderColor: "#E5E7EB",
  },

  receiptHeader: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
  },
  receiptTitle: { fontSize: 18, fontWeight: "800", color: "#111111", letterSpacing: 1 },
  receiptSub:   { fontSize: 13, color: "#6B7280", marginTop: 2, fontWeight: "500" },

  dashedLine: {
    borderStyle: "dashed", borderWidth: 1,
    borderColor: "#D1D5DB", marginVertical: 16,
  },

  receiptRow: {
    flexDirection: "row", justifyContent: "space-between",
    alignItems: "flex-start", marginBottom: 12,
  },
  receiptLabel: { color: "#6B7280", fontSize: 14 },
  receiptValue: { color: "#111111", fontSize: 14, fontWeight: "800" },

  slotValue: {
    maxWidth: "68%", textAlign: "right", lineHeight: 22, flexWrap: "wrap",
  },
  noteValue: {
    maxWidth: "60%", textAlign: "right", lineHeight: 20,
    fontWeight: "600", color: "#374151",
  },

  collectedBanner: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "#F0FDF4", borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 8,
    marginTop: 4, marginBottom: 4,
    borderWidth: 1, borderColor: "#BBF7D0",
  },
  collectedBannerText: { fontSize: 12, color: "#0A7D57", fontWeight: "600", flex: 1 },

  receiptFooter: {
    textAlign: "center", color: "#6B7280", fontSize: 13, fontWeight: "600",
  },

  shareBtn: {
    backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#E5E7EB",
    paddingVertical: 14, borderRadius: 14,
    alignItems: "center", justifyContent: "center",
    flexDirection: "row",
  },
  shareBtnText: { marginLeft: 8, color: "#111111", fontWeight: "700", fontSize: 14 },

  backButton: {
    marginTop: 16, backgroundColor: "#111111",
    paddingHorizontal: 18, paddingVertical: 12, borderRadius: 12,
  },
  backButtonText: { color: "#FFFFFF", fontWeight: "700" },
});
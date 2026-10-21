/**
 * Player booking receipt — bill style (matches the owner receipt)
 * • Green turf-stripe backdrop + paper "bill" ticket (shared as an image)
 * • Shows the venue offer: slot price, 🎉 offer, you saved, pay-at-turf with old amount crossed
 * • Coins (pending / credited / cancelled), reschedule notice, refund tracker
 * • Cancel booking with the real deadline, Directions, Book again
 * Fixes: "Confirmed" header on cancelled bookings, late-night cancel deadline,
 *        status = completed when the slot ends (not at midnight), coins/paid amounts.
 */
import {
  View, Text, StyleSheet, ActivityIndicator, TouchableOpacity, ScrollView, StatusBar,
  Alert, Platform, Image, Linking,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { doc, getDoc } from "firebase/firestore";
import { db, auth } from "../../firebaseConfig";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import * as Sharing from "expo-sharing";
import ViewShot from "react-native-view-shot";

const SERVER_URL = "https://bookora-backend-95u4.onrender.com";
// Same logo as the owner receipt — file is in assets/images/
const PLAYON_LOGO = require("../../assets/images/playon-receipt-logo.png");

// ── Palette (same as owner screens) ─────────────────────────────────────────
const BRAND = "#15803D";
const STRIPE = "#138A3F";
const ON_BRAND = "#DCFCE7";
const PAGE = "#F1F4F7";
const INK = "#0F172A";
const SLATE = "#475569";
const MUTED = "#64748B";
const FAINT = "#94A3B8";
const LINE = "#E2E8F0";

// ── Helpers ─────────────────────────────────────────────────────────────────
function toDate(v: any): Date | null {
  if (!v) return null;
  if (typeof v?.toDate === "function") return v.toDate();
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}
function dayStart(d: Date): number { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime(); }
function partMins(s: string): number {
  const m = String(s || "").trim().match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)/i);
  if (!m) return 0;
  let h = Number(m[1]);
  const p = m[3].toUpperCase();
  if (p === "PM" && h !== 12) h += 12;
  if (p === "AM" && h === 12) h = 0;
  return h * 60 + Number(m[2] || 0);
}
/** Start/end minutes from the booking day's midnight; late-night slots go past 1440 */
function minsRange(slots: string[], turf: any): { start: number; end: number } | null {
  const open = Number(turf?.openingTime ?? 6);
  const close = Number(turf?.closingTime ?? 23) || 24;
  const adj = (m: number) => (close > 24 && m < open * 60 ? m + 1440 : m);
  let start = Infinity, end = -Infinity;
  slots.forEach(s => {
    const p = String(s).split(" - ");
    if (p.length < 2) return;
    const a = adj(partMins(p[0]));
    let e = adj(partMins(p[1]));
    if (e <= a) e += 1440;
    start = Math.min(start, a); end = Math.max(end, e);
  });
  return isFinite(start) ? { start, end } : null;
}
function hm(min: number): string {
  const x = ((min % 1440) + 1440) % 1440;
  const h = Math.floor(x / 60), m = x % 60;
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")}`;
}
const per = (min: number) => ((((min % 1440) + 1440) % 1440) >= 720 ? "PM" : "AM");
const rangeTxt = (a: number, b: number) => `${hm(a)}${per(a) !== per(b) ? ` ${per(a)}` : ""} – ${hm(b)} ${per(b)}`;
const hrsTxt = (mins: number) => {
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60), m = mins % 60;
  return m ? `${h}h ${m}m` : `${h} hr${h === 1 ? "" : "s"}`;
};
const rs = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
function whenTxt(ms: number): string {
  const d = new Date(ms);
  const t = d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true });
  const today = dayStart(new Date());
  const day = dayStart(d);
  if (day === today) return `${t} today`;
  if (day === today + 86400000) return `${t} tomorrow`;
  return `${t}, ${d.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`;
}
function shortSlots(slots?: string[], turf?: any): string {
  if (!slots?.length) return "";
  const r = minsRange(slots, turf);
  return r ? rangeTxt(r.start, r.end) : slots[0];
}

const STATUS = {
  confirmed: { label: "CONFIRMED", bg: "#DCFCE7", fg: BRAND },
  pending:   { label: "PENDING",   bg: "#FEF3C7", fg: "#B45309" },
  cancelled: { label: "CANCELLED", bg: "#FEE2E2", fg: "#DC2626" },
  completed: { label: "COMPLETED", bg: "#F1F5F9", fg: SLATE },
};
type StatusKey = keyof typeof STATUS;

const REFUND_CFG: Record<string, { label: string; sub: string; fg: string; bg: string; step: number }> = {
  not_applicable:     { label: "No refund",            sub: "",                                                fg: SLATE,     bg: "#F1F5F9", step: 0 },
  pending:            { label: "Refund received",      sub: "We got your request and are processing it.",      fg: "#B45309", bg: "#FEF3C7", step: 1 },
  initiated:          { label: "Refund on the way",    sub: "Back to your bank in 5–7 working days.",          fg: "#1D4ED8", bg: "#DBEAFE", step: 2 },
  settlement_pending: { label: "Refund on the way",    sub: "Processed — waiting for your bank.",              fg: "#1D4ED8", bg: "#DBEAFE", step: 2 },
  processed:          { label: "Refund completed",     sub: "Usually shows in your bank within 4–5 working days.", fg: "#047857", bg: "#D1FAE5", step: 3 },
  failed:             { label: "Refund failed",        sub: "Please contact support with your booking ID.",   fg: "#DC2626", bg: "#FEE2E2", step: -1 },
};
const REFUND_STEPS = ["Received", "Sent by Razorpay", "In your bank"];

// ─────────────────────────────────────────────────────────────────────────────
export default function BookingDetails() {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const shotRef = useRef<any>(null);

  const [booking, setBooking] = useState<any>(null);
  const [turf, setTurf] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [cancelWindowHours, setCancelWindowHours] = useState(2);
  const [, setTick] = useState(0);

  useEffect(() => { fetchBooking(); fetchCancelWindow(); }, []);
  useEffect(() => { const t = setInterval(() => setTick(x => x + 1), 60000); return () => clearInterval(t); }, []);

  const fetchCancelWindow = async () => {
    try {
      const snap = await getDoc(doc(db, "appConfig", "booking"));
      const h = Number(snap.data()?.cancellationWindowHours);
      if (snap.exists() && !isNaN(h) && h >= 0 && h <= 24) setCancelWindowHours(h);
    } catch (e) { console.log("fetchCancelWindow error:", e); }
  };

  const fetchBooking = async () => {
    try {
      const snap = await getDoc(doc(db, "bookings", String(id)));
      if (!snap.exists()) { setBooking(null); return; }
      const b: any = { id: snap.id, ...snap.data() };
      setBooking(b);
      if (b.turfId && !turf) {
        try { const t = await getDoc(doc(db, "turfs", b.turfId)); if (t.exists()) setTurf(t.data()); } catch {}
      }
    } catch (e) {
      console.log("fetchBooking error:", e);
      setBooking(null);
    } finally {
      setLoading(false);
    }
  };

  const goBack = () => (router.canGoBack() ? router.back() : router.replace("/(tabs)" as any));

  const share = async () => {
    try {
      setSharing(true);
      await new Promise(r => setTimeout(r, 250));
      const uri = await shotRef.current?.capture?.();
      if (!uri) throw new Error("capture failed");
      await Sharing.shareAsync(uri, { mimeType: "image/png", dialogTitle: "Share booking receipt", UTI: "public.png" });
    } catch (e) {
      console.log(e);
      Alert.alert("Error", "Unable to share the receipt. Please try again.");
    } finally {
      setSharing(false);
    }
  };

  // ── Loading / not found ──
  if (loading) {
    return (
      <View style={s.center}>
        <StatusBar barStyle="dark-content" />
        <ActivityIndicator size="large" color={BRAND} />
        <Text style={s.loadTxt}>Loading your booking…</Text>
      </View>
    );
  }
  if (!booking) {
    return (
      <View style={[s.center, { paddingHorizontal: 32 }]}>
        <StatusBar barStyle="dark-content" />
        <Ionicons name="alert-circle-outline" size={44} color={FAINT} />
        <Text style={s.nfTitle}>Booking not found</Text>
        <Text style={s.nfSub}>This booking may have been removed or the link is invalid.</Text>
        <TouchableOpacity style={s.nfBtn} onPress={goBack}><Text style={s.nfBtnTxt}>Go back</Text></TouchableOpacity>
      </View>
    );
  }

  // ── Time + status ──
  const slots: string[] = Array.isArray(booking.selectedSlots) && booking.selectedSlots.length
    ? booking.selectedSlots : [booking.slotTime, booking.slot].filter(Boolean);
  const range = minsRange(slots, turf);
  const day = toDate(booking.dateString) ?? toDate(booking.date);
  const dayMs = day ? dayStart(day) : null;
  const now = Date.now();
  const startAbs = dayMs !== null && range ? dayMs + range.start * 60000 : null;
  const endAbs = dayMs !== null ? dayMs + (range ? range.end : 1440) * 60000 : null;

  let status: StatusKey = booking.status === "cancelled" ? "cancelled"
    : booking.status === "completed" ? "completed"
    : booking.status === "pending" ? "pending" : "confirmed";
  // FIX: completed when the slot actually ends (late-night aware), not at midnight
  if ((status === "confirmed" || status === "pending") && endAbs !== null && now >= endAbs) status = "completed";
  const st = STATUS[status];
  const isCancelled = status === "cancelled";
  const isUpcoming = status === "confirmed" || status === "pending";

  // FIX: cancel deadline uses the real (late-night aware) start time
  const cancelBy = startAbs !== null ? startAbs - cancelWindowHours * 3600000 : null;
  const canCancel = isUpcoming && !!auth.currentUser?.uid && cancelBy !== null && now < cancelBy;

  // ── Money ──
  const total = Number(booking.totalAmount ?? 0) || 0;
  const offerDiscount = Number(booking.offerDiscount || 0);
  const originalAmount = Number(booking.originalAmount || 0) || total + offerDiscount;
  const promo = Number(booking.discount || 0);
  const pcoins = Number(booking.pcoinsRedeemed || 0);
  const vcoins = Number(booking.vcoinsRedeemed || 0);
  const paidOnline = Number(booking.paidAmount ?? booking.advanceAmount ?? 0) || 0;
  const atTurf = Math.max(Number(booking.remainingAmount ?? total - paidOnline - promo - pcoins - vcoins), 0);
  const fullPaid = booking.bookingType === "full" || booking.paymentMode === "full_payment" || atTurf === 0;
  const saved = offerDiscount + promo;
  // Option A: offer comes off what you pay at the turf → show the old amount crossed
  const oldAtTurf = offerDiscount > 0 && !fullPaid ? atTurf + offerDiscount : 0;

  const turfName = booking.turfName || turf?.name || "the turf";
  const location = booking.turfLocation || turf?.location || turf?.address || "";
  const dateTitle = day
    ? day.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "long", year: "numeric" }).toUpperCase()
    : "DATE NOT AVAILABLE";

  const openDirections = () => {
    const lat = turf?.latitude, lng = turf?.longitude;
    const url = booking.mapLink || turf?.mapLink
      || (lat != null && lng != null
        ? Platform.select({ ios: `maps://?daddr=${lat},${lng}`, default: `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}` })
        : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${turfName} ${location}`)}`);
    Linking.openURL(String(url)).catch(() => Alert.alert("Can't open maps", "Please try again."));
  };

  const bookAgain = () => {
    if (booking.turfId) router.push(`/turf/${booking.turfId}` as any);
  };

  const cancelBooking = () => {
    if (!canCancel) {
      return Alert.alert("Cancellation closed", `Bookings can only be cancelled at least ${cancelWindowHours} hours before the slot.`);
    }
    Alert.alert(
      "Cancel booking?",
      paidOnline > 0
        ? `${turfName} · ${dateTitle.toLowerCase()}\nRefund follows the cancellation policy.`
        : "Are you sure you want to cancel this booking?",
      [
        { text: "Keep booking", style: "cancel" },
        {
          text: "Cancel booking", style: "destructive",
          onPress: async () => {
            try {
              setCancelling(true);
              const user = auth.currentUser;
              if (!user) throw new Error("Please log in again.");
              const token = await user.getIdToken().catch(() => "");
              const res = await fetch(`${SERVER_URL}/cancel-booking`, {
                method: "POST",
                headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
                body: JSON.stringify({ bookingId: booking.id, userId: user.uid, reason: "User cancelled booking" }),
              });
              const data = await res.json().catch(() => ({}));
              if (!res.ok || !data.success) throw new Error(data.error || "Cancellation failed");
              await fetchBooking();
              Alert.alert("Booking cancelled", data.message || "Your booking has been cancelled.");
            } catch (e: any) {
              Alert.alert("Error", e?.message || "Unable to cancel booking.");
            } finally {
              setCancelling(false);
            }
          },
        },
      ]
    );
  };

  const payPill = isCancelled ? null : fullPaid ? "Full paid" : "Advance paid";

  return (
    <View style={s.root}>
      <StatusBar barStyle="light-content" backgroundColor={BRAND} />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: insets.bottom + 30 }}>
        {/* ── Green turf area (header + ticket; ticket is shared as image) ── */}
        <View style={s.turf}>
          <Stripes />
          <View style={[s.headerRow, { paddingTop: insets.top + 10 }]}>
            <TouchableOpacity style={s.hBtn} onPress={goBack} accessibilityLabel="Back">
              <Ionicons name="arrow-back" size={20} color="#fff" />
            </TouchableOpacity>
            <View style={{ flex: 1 }}>
              <Text style={s.hKicker}>BOOKING RECEIPT</Text>
              <Text style={s.hTitle}>My booking</Text>
            </View>
            <TouchableOpacity style={s.hBtn} onPress={share} disabled={sharing} accessibilityLabel="Share receipt">
              {sharing ? <ActivityIndicator color="#fff" size="small" /> : <Ionicons name="share-outline" size={19} color="#fff" />}
            </TouchableOpacity>
          </View>

          {booking.rescheduled && <RescheduleNotice booking={booking} turf={turf} />}

          <ViewShot ref={shotRef} options={{ format: "png", quality: 1 }} style={s.shot}>
            <Stripes />
            <View style={s.ticketWrap}>
              <View style={s.ticketTop}>
                <View style={s.brandRow}>
                  <Image source={PLAYON_LOGO} style={s.logo} resizeMode="contain" accessibilityLabel="Playon logo" />
                  <View style={{ flex: 1 }}>
                    <Text style={s.brand}>Playon</Text>
                    <Text style={s.brandSub} numberOfLines={1}>Turf & Sport Booking App</Text>
                  </View>
                  <View style={[s.stamp, { backgroundColor: st.bg }]}><Text style={[s.stampTxt, { color: st.fg }]}>● {st.label}</Text></View>
                </View>

                <Text style={s.dateTitle}>{dateTitle}</Text>
                <Text style={[s.bigTime, isCancelled && { textDecorationLine: "line-through", color: FAINT }]} adjustsFontSizeToFit numberOfLines={1}>
                  {range ? rangeTxt(range.start, range.end) : booking.slotTime || "Time not available"}
                </Text>
                <View style={s.pillRow}>
                  {range && <Pill text={hrsTxt(range.end - range.start)} bg="#F1F5F9" fg={SLATE} />}
                  {payPill && <Pill text={payPill} bg="#EFF6FF" fg="#1D4ED8" />}
                  {offerDiscount > 0 && <Pill text="🎉 Offer" bg="#DCFCE7" fg={BRAND} />}
                  {booking.rescheduled && <Pill text="⟳ Rescheduled" bg="#F5F3FF" fg="#6D28D9" />}
                </View>

                <View style={s.turfBox}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.infoLbl}>TURF</Text>
                    <Text style={s.infoVal} numberOfLines={2}>{turfName}</Text>
                    {!!location && <Text style={s.infoSub} numberOfLines={2}>{location}</Text>}
                  </View>
                  {!isCancelled && (
                    <TouchableOpacity style={s.dirBtn} onPress={openDirections} accessibilityLabel="Directions to turf">
                      <Ionicons name="navigate-outline" size={14} color={BRAND} />
                      <Text style={s.dirTxt}>Directions</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>

              <TearLine />

              <View style={s.ticketBottom}>
                <Text style={s.kicker}>BILL</Text>
                {offerDiscount > 0 && <BillRow label={`Slot price${range ? ` · ${hrsTxt(range.end - range.start)}` : ""}`} value={rs(originalAmount)} />}
                {offerDiscount > 0 && <BillRow label={`🎉 ${booking.offerTitle || "Venue offer"}`} value={`− ${rs(offerDiscount)}`} color={BRAND} />}
                {offerDiscount > 0 && <View style={s.billLine} />}
                <BillRow label="Total" value={rs(total)} strong />
                {promo > 0 && <BillRow label={`Promo${booking.promoCode ? ` · ${booking.promoCode}` : ""}`} value={`− ${rs(promo)}`} color={BRAND} />}
                {pcoins > 0 && <BillRow label={`🪙 PCoin used · ${pcoins}`} value={`− ${rs(pcoins)}`} color="#7C3AED" />}
                {vcoins > 0 && <BillRow label={`🏟️ VCoin used · ${vcoins}`} value={`− ${rs(vcoins)}`} color="#B45309" />}
                <BillRow label={fullPaid ? "Paid online (full)" : "Paid online"} value={rs(paidOnline)} color={BRAND} />

                {isCancelled ? (
                  <View style={[s.dueBox, { backgroundColor: "#FEF2F2", borderColor: "#FECACA" }]}>
                    <Ionicons name="close-circle" size={22} color="#DC2626" />
                    <View style={{ flex: 1 }}>
                      <Text style={[s.dueLbl, { color: "#B91C1C" }]}>BOOKING CANCELLED</Text>
                      <Text style={[s.dueSub, { color: "#991B1B" }]}>See the refund status below</Text>
                    </View>
                  </View>
                ) : atTurf > 0 ? (
                  <View style={s.dueBox}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.dueLbl}>{status === "completed" ? "PAID AT TURF" : "PAY AT TURF"}</Text>
                      <Text style={s.dueSub}>{status === "completed" ? "Game finished" : "Cash or UPI before the game"}</Text>
                    </View>
                    {oldAtTurf > 0 && <Text style={s.dueOld}>{rs(oldAtTurf)}</Text>}
                    <Text style={s.dueAmt} numberOfLines={1} adjustsFontSizeToFit>{rs(atTurf)}</Text>
                  </View>
                ) : (
                  <View style={[s.dueBox, { backgroundColor: "#F0FDF4", borderColor: "#BBF7D0" }]}>
                    <Ionicons name="checkmark-circle" size={22} color={BRAND} />
                    <View style={{ flex: 1 }}>
                      <Text style={[s.dueLbl, { color: BRAND }]}>FULLY PAID</Text>
                      <Text style={[s.dueSub, { color: "#166534" }]}>Nothing to pay at the turf</Text>
                    </View>
                  </View>
                )}

                {saved > 0 && !isCancelled && (
                  <View style={s.saveBox}><Text style={s.saveTxt}>🎉 You saved {rs(saved)} on this booking</Text></View>
                )}

                <View style={s.idRow}>
                  <View style={s.idHead}>
                    <Text style={s.idLbl}>BOOKING ID</Text>
                    <Text style={s.idHint}>Show this at the turf</Text>
                  </View>
                  <Text style={s.idVal} selectable>{booking.id}</Text>
                </View>
              </View>
              <ZigZag />
            </View>
            <Text style={s.shotFoot}>Thank you for playing at {turfName}</Text>
          </ViewShot>
        </View>

        {/* ── Refund (cancelled only) ── */}
        {isCancelled && <RefundTracker booking={booking} paidOnline={paidOnline} atTurf={atTurf} />}

        {/* ── Coins ── */}
        <CoinsCard booking={booking} cancelled={isCancelled} turfName={turfName} />

        {/* ── Actions ── */}
        {isUpcoming && cancelBy !== null && (
          <View style={s.deadline}>
            <Ionicons name="time-outline" size={14} color={canCancel ? MUTED : "#B45309"} />
            <Text style={[s.deadlineTxt, !canCancel && { color: "#B45309" }]}>
              {canCancel
                ? `Free cancel till ${whenTxt(cancelBy)} · ${cancelWindowHours} hrs before slot`
                : `Cancellation closed · less than ${cancelWindowHours} hrs to the game`}
            </Text>
          </View>
        )}
        <View style={s.actRow}>
          {isUpcoming ? (
            <TouchableOpacity style={[s.dangerBtn, (!canCancel || cancelling) && { opacity: 0.5 }]} onPress={cancelBooking} disabled={cancelling}>
              {cancelling ? <ActivityIndicator color="#DC2626" size="small" /> : <Text style={s.dangerTxt}>Cancel booking</Text>}
            </TouchableOpacity>
          ) : booking.turfId ? (
            <TouchableOpacity style={s.ghostBtn} onPress={bookAgain}>
              <Ionicons name="refresh" size={16} color={INK} />
              <Text style={s.ghostTxt}>Book again</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity style={s.primaryBtn} onPress={share} disabled={sharing}>
            {sharing ? <ActivityIndicator color="#fff" size="small" /> : <Ionicons name="share-outline" size={16} color="#fff" />}
            <Text style={s.primaryTxt}>Share receipt</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

// ── Reschedule notice ───────────────────────────────────────────────────────
function RescheduleNotice({ booking, turf }: { booking: any; turf: any }) {
  const history = booking.rescheduleHistory || [];
  const last = history.length ? history[history.length - 1] : null;
  if (!last) return null;
  const was = [last.fromDate, shortSlots(last.fromSlots, turf)].filter(Boolean).join(" · ");
  const nowTxt = [last.toDate || booking.dateString, shortSlots(last.toSlots, turf)].filter(Boolean).join(" · ");
  return (
    <View style={rsS.wrap}>
      <View style={rsS.head}>
        <View style={rsS.icon}><Ionicons name="repeat" size={17} color="#7C3AED" /></View>
        <View style={{ flex: 1 }}>
          <Text style={rsS.title}>Moved by the venue</Text>
          <Text style={rsS.sub} numberOfLines={2}>
            {last.reason ? `“${last.reason}”`
              : booking.rescheduleCount > 1 ? `Moved ${booking.rescheduleCount} times — latest change shown` : "The venue changed your date/time"}
          </Text>
        </View>
      </View>
      <View style={rsS.row}>
        <View style={{ flex: 1 }}>
          <Text style={rsS.lbl}>WAS</Text>
          <Text style={rsS.old} numberOfLines={2}>{was || "—"}</Text>
        </View>
        <Ionicons name="arrow-forward" size={15} color="#C4B5FD" />
        <View style={{ flex: 1 }}>
          <Text style={[rsS.lbl, { color: "#7C3AED" }]}>NOW</Text>
          <Text style={rsS.new} numberOfLines={2}>{nowTxt || "—"}</Text>
        </View>
      </View>
    </View>
  );
}

// ── Refund tracker ──────────────────────────────────────────────────────────
function RefundTracker({ booking, paidOnline, atTurf }: { booking: any; paidOnline: number; atTurf: number }) {
  const [live, setLive] = useState<any>(null);
  const [checking, setChecking] = useState(false);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);

  const check = useCallback(async () => {
    const uid = auth.currentUser?.uid;
    if (!booking?.id || !uid) return;
    setChecking(true);
    try {
      const res = await fetch(`${SERVER_URL}/refund-status/${booking.id}?userId=${uid}`);
      const data = await res.json();
      if (data.success) { setLive(data); setLastChecked(new Date()); }
    } catch (e) { console.log("Refund check error:", e); }
    finally { setChecking(false); }
  }, [booking?.id]);

  useEffect(() => { if (booking?.paymentId) check(); }, [booking?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const key = live?.refundStatus ?? booking.refundStatus ?? "not_applicable";
  const cfg = REFUND_CFG[key] ?? REFUND_CFG.not_applicable;
  const amount = Number(live?.refundAmount ?? booking.refundAmount ?? 0);
  const cancelledAt = toDate(booking.cancelledAt);

  return (
    <View style={s.card}>
      <View style={s.cardHead}>
        <Text style={s.cardTitle}>Refund</Text>
        <TouchableOpacity style={s.smallBtn} onPress={check} disabled={checking} accessibilityLabel="Check refund status">
          {checking ? <ActivityIndicator size="small" color={SLATE} /> : <Ionicons name="refresh" size={14} color={SLATE} />}
          <Text style={s.smallBtnTxt}>Check</Text>
        </TouchableOpacity>
      </View>

      <View style={[rf.banner, { backgroundColor: cfg.bg }]}>
        <View style={{ flex: 1 }}>
          <Text style={[rf.bTitle, { color: cfg.fg }]}>{cfg.label}</Text>
          {key === "not_applicable" ? (
            <Text style={[rf.bSub, { color: cfg.fg }]}>
              {paidOnline > 0
                ? `You paid ${rs(paidOnline)} online as advance${atTurf > 0 ? ` and ${rs(atTurf)} was due at the turf` : ""}. As per the cancellation policy, no online refund applies.`
                : "Nothing was paid online for this booking."}
            </Text>
          ) : (
            <Text style={[rf.bSub, { color: cfg.fg }]}>{cfg.sub}</Text>
          )}
        </View>
        {amount > 0 && <Text style={[rf.amt, { color: cfg.fg }]}>{rs(amount)}</Text>}
      </View>

      {cfg.step > 0 && (
        <View style={{ marginTop: 10 }}>
          {REFUND_STEPS.map((label, i) => {
            const n = i + 1;
            const done = cfg.step > n || cfg.step === 3;
            const cur = cfg.step === n && cfg.step !== 3;
            return (
              <View key={label} style={rf.step}>
                <View style={[rf.dot, done && { backgroundColor: "#059669" }, cur && { backgroundColor: "#2563EB" }]}>
                  {done ? <Ionicons name="checkmark" size={12} color="#fff" /> : <Text style={[rf.dotTxt, cur && { color: "#fff" }]}>{n}</Text>}
                </View>
                <Text style={[rf.stepTxt, (done || cur) && { color: INK, fontWeight: "800" }]}>{label}</Text>
              </View>
            );
          })}
        </View>
      )}

      <View style={rf.foot}>
        <Text style={rf.footTxt}>
          {cancelledAt ? `Cancelled on ${cancelledAt.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}` : "Cancelled"}
          {booking.cancellationReason ? ` · “${booking.cancellationReason}”` : ""}
        </Text>
        {lastChecked && <Text style={rf.footTxt}>Checked {lastChecked.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}</Text>}
      </View>
    </View>
  );
}

// ── Coins card ──────────────────────────────────────────────────────────────
function CoinsCard({ booking, cancelled, turfName }: { booking: any; cancelled: boolean; turfName: string }) {
  const pPend = Number(booking.pcoinPending || 0);
  const vPend = Number(booking.vcoinPending || 0);
  const pEarn = Number(booking.pcoinEarned || 0);
  const vEarn = Number(booking.vcoinEarned || 0);
  if (!pPend && !vPend && !pEarn && !vEarn) return null;

  if (cancelled) {
    return (
      <View style={[s.card, cc.row, { backgroundColor: "#FEF2F2", borderColor: "#FECACA" }]}>
        <View style={[cc.icon, { backgroundColor: "#FEE2E2" }]}><Ionicons name="close-circle-outline" size={20} color="#DC2626" /></View>
        <View style={{ flex: 1 }}>
          <Text style={[cc.title, { color: "#DC2626" }]}>No coins for this booking</Text>
          <Text style={cc.sub}>Booking cancelled — coins you used are back in your wallet</Text>
        </View>
      </View>
    );
  }

  if (booking.coinStatus === "credited" || pEarn > 0 || vEarn > 0) {
    return (
      <LinearGradient colors={["#0F5132", "#146C43", "#0B3D26"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={cc.credit}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <View style={cc.live} />
          <Text style={cc.eyebrow}>COINS CREDITED</Text>
        </View>
        <Text style={cc.cTitle}>🎉 Added straight to your wallet</Text>
        <View style={cc.tiles}>
          {pEarn > 0 && (
            <View style={cc.tile}>
              <Text style={cc.tLbl}>🪙 PCOIN</Text>
              <Text style={cc.tVal}>+{pEarn}</Text>
              <Text style={cc.tSub}>₹{pEarn} · any turf</Text>
            </View>
          )}
          {vEarn > 0 && (
            <View style={cc.tile}>
              <Text style={cc.tLbl}>🏟️ VCOIN</Text>
              <Text style={cc.tVal}>+{vEarn}</Text>
              <Text style={cc.tSub} numberOfLines={1}>{turfName} only</Text>
            </View>
          )}
        </View>
      </LinearGradient>
    );
  }

  return (
    <View style={[s.card, cc.row, { backgroundColor: "#FFFBEB", borderColor: "#FDE68A" }]}>
      <View style={[cc.icon, { backgroundColor: "#FEF3C7" }]}><Text style={{ fontSize: 18 }}>🪙</Text></View>
      <View style={{ flex: 1 }}>
        <Text style={[cc.title, { color: "#B45309" }]}>Coins on the way</Text>
        <Text style={cc.sub}>Added to your wallet after the game</Text>
      </View>
      <View style={{ gap: 4, alignItems: "flex-end" }}>
        {pPend > 0 && <View style={[cc.pill, { backgroundColor: "#EDE9FE" }]}><Text style={[cc.pillTxt, { color: "#7C3AED" }]}>+{pPend} PCoin</Text></View>}
        {vPend > 0 && <View style={[cc.pill, { backgroundColor: "#FEF3C7" }]}><Text style={[cc.pillTxt, { color: "#B45309" }]}>+{vPend} VCoin</Text></View>}
      </View>
    </View>
  );
}

// ── Small pieces ────────────────────────────────────────────────────────────
function Pill({ text, bg, fg }: { text: string; bg: string; fg: string }) {
  return <View style={[s.pill, { backgroundColor: bg }]}><Text style={[s.pillTxt, { color: fg }]}>{text}</Text></View>;
}
function Stripes() {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <View style={{ flex: 1, flexDirection: "row", backgroundColor: BRAND }}>
        {Array.from({ length: 16 }).map((_, i) => <View key={i} style={{ width: 40, backgroundColor: i % 2 ? STRIPE : BRAND }} />)}
      </View>
      <View style={s.pitchCircle} />
    </View>
  );
}
function TearLine() {
  return (
    <View style={s.tear}>
      <View style={[s.notch, { left: -13 }]} />
      <View style={[s.notch, { right: -13 }]} />
      <View style={s.tearDash} />
    </View>
  );
}
function ZigZag() {
  return (
    <View style={s.zigWrap}>
      {Array.from({ length: 40 }).map((_, i) => <View key={i} style={[s.zigTooth, { left: i * 12 - 3 }]} />)}
    </View>
  );
}
function BillRow({ label, value, color, strong }: { label: string; value: string; color?: string; strong?: boolean }) {
  return (
    <View style={s.billRow}>
      <Text style={[s.billLbl, strong && { color: INK, fontWeight: "900", fontSize: 15 }]} numberOfLines={1}>{label}</Text>
      <Text style={[s.billVal, strong && { fontSize: 15 }, color ? { color } : null]}>{value}</Text>
    </View>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: PAGE },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: PAGE, gap: 8 },
  loadTxt: { marginTop: 6, color: MUTED, fontSize: 15, fontWeight: "600" },
  nfTitle: { fontSize: 18, fontWeight: "900", color: INK, marginTop: 6 },
  nfSub: { fontSize: 13, fontWeight: "600", color: MUTED, textAlign: "center" },
  nfBtn: { marginTop: 10, backgroundColor: BRAND, paddingHorizontal: 22, height: 46, borderRadius: 13, justifyContent: "center" },
  nfBtnTxt: { color: "#fff", fontSize: 14, fontWeight: "800" },

  turf: { backgroundColor: BRAND, borderBottomLeftRadius: 28, borderBottomRightRadius: 28, overflow: "hidden", paddingBottom: 18 },
  pitchCircle: { position: "absolute", alignSelf: "center", top: 230, width: 190, height: 190, borderRadius: 95, borderWidth: 2, borderColor: "rgba(255,255,255,0.12)" },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16 },
  hBtn: { width: 44, height: 44, borderRadius: 13, backgroundColor: "rgba(255,255,255,0.16)", alignItems: "center", justifyContent: "center" },
  hKicker: { fontSize: 10, letterSpacing: 1.4, fontWeight: "800", color: ON_BRAND },
  hTitle: { fontSize: 20, fontWeight: "900", color: "#fff" },

  shot: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 6, overflow: "hidden" },
  ticketWrap: { shadowColor: INK, shadowOpacity: 0.22, shadowRadius: 18, shadowOffset: { width: 0, height: 10 }, elevation: 8 },
  ticketTop: { backgroundColor: "#fff", borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 18, paddingTop: 18, paddingBottom: 8 },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  logo: { width: 44, height: 44 },
  brand: { fontSize: 18, fontWeight: "900", letterSpacing: -0.2, color: INK },
  brandSub: { fontSize: 11, fontWeight: "700", color: MUTED },
  stamp: { height: 28, paddingHorizontal: 10, borderRadius: 999, justifyContent: "center" },
  stampTxt: { fontSize: 11, fontWeight: "900", letterSpacing: 0.4 },
  dateTitle: { textAlign: "center", fontSize: 12, fontWeight: "800", color: MUTED, letterSpacing: 0.8, marginTop: 18 },
  bigTime: { textAlign: "center", fontSize: 30, fontWeight: "900", color: INK, letterSpacing: -0.6, marginTop: 4 },
  pillRow: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 6, marginTop: 8 },
  pill: { height: 24, paddingHorizontal: 9, borderRadius: 999, justifyContent: "center" },
  pillTxt: { fontSize: 11, fontWeight: "800" },
  turfBox: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#F5F7FA", borderRadius: 13, paddingHorizontal: 12, paddingVertical: 10, marginTop: 16 },
  infoLbl: { fontSize: 10, fontWeight: "800", color: MUTED, letterSpacing: 0.6 },
  infoVal: { fontSize: 14, fontWeight: "900", color: INK, marginTop: 2 },
  infoSub: { fontSize: 11, fontWeight: "600", color: MUTED },
  dirBtn: { flexDirection: "row", alignItems: "center", gap: 4, height: 36, paddingHorizontal: 11, borderRadius: 10, borderWidth: 1, borderColor: "#BBF7D0", backgroundColor: "#F0FDF4" },
  dirTxt: { fontSize: 12, fontWeight: "800", color: BRAND },

  tear: { height: 26, backgroundColor: "#fff", justifyContent: "center" },
  notch: { position: "absolute", top: 0, width: 26, height: 26, borderRadius: 13, backgroundColor: BRAND },
  tearDash: { marginHorizontal: 20, borderTopWidth: 2, borderStyle: "dashed", borderColor: LINE },

  ticketBottom: { backgroundColor: "#fff", paddingHorizontal: 18, paddingTop: 6, paddingBottom: 14 },
  kicker: { fontSize: 10.5, letterSpacing: 0.9, fontWeight: "800", color: MUTED, marginBottom: 6 },
  billRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 6, gap: 10 },
  billLbl: { flex: 1, fontSize: 13.5, fontWeight: "700", color: SLATE },
  billVal: { fontSize: 13.5, fontWeight: "900", color: INK },
  billLine: { borderTopWidth: 1, borderColor: "#EEF1F5", marginVertical: 4 },
  dueBox: { marginTop: 10, flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#FFF7ED", borderWidth: 1, borderColor: "#FED7AA", borderRadius: 14, padding: 12 },
  dueLbl: { fontSize: 10.5, fontWeight: "900", color: "#C2410C", letterSpacing: 0.6 },
  dueSub: { fontSize: 11.5, fontWeight: "600", color: "#9A3412", marginTop: 1 },
  dueOld: { fontSize: 13, fontWeight: "700", color: "#C2410C", opacity: 0.6, textDecorationLine: "line-through" },
  dueAmt: { fontSize: 24, fontWeight: "900", color: "#9A3412", maxWidth: 130 },
  saveBox: { marginTop: 10, backgroundColor: "#F0FDF4", borderWidth: 1, borderStyle: "dashed", borderColor: "#86EFAC", borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12 },
  saveTxt: { textAlign: "center", fontSize: 13, fontWeight: "800", color: BRAND },
  idHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  idRow: { gap: 3, marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderStyle: "dashed", borderColor: LINE },
  idLbl: { fontSize: 10, fontWeight: "800", color: FAINT, letterSpacing: 0.6 },
  idVal: { fontSize: 12.5, lineHeight: 18, fontWeight: "700", color: "#334155", letterSpacing: 0.3, fontFamily: Platform.OS === "ios" ? "Courier" : "monospace" },
  idHint: { fontSize: 10.5, fontWeight: "700", color: FAINT },
  zigWrap: { height: 8, overflow: "hidden" },
  zigTooth: { position: "absolute", top: -6, width: 12, height: 12, backgroundColor: "#fff", transform: [{ rotate: "45deg" }] },
  shotFoot: { textAlign: "center", color: ON_BRAND, fontSize: 12, fontWeight: "800", marginTop: 12, marginBottom: 6 },

  card: { backgroundColor: "#fff", borderRadius: 18, marginHorizontal: 16, marginTop: 14, padding: 14, borderWidth: 1, borderColor: LINE },
  cardHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  cardTitle: { fontSize: 16, fontWeight: "900", color: INK },
  smallBtn: { flexDirection: "row", alignItems: "center", gap: 5, height: 34, paddingHorizontal: 10, borderRadius: 10, borderWidth: 1, borderColor: LINE, backgroundColor: "#fff" },
  smallBtnTxt: { fontSize: 12, fontWeight: "800", color: SLATE },

  deadline: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 14, marginHorizontal: 16 },
  deadlineTxt: { fontSize: 12, fontWeight: "700", color: MUTED },
  actRow: { flexDirection: "row", gap: 8, marginHorizontal: 16, marginTop: 10 },
  dangerBtn: { flex: 1, height: 50, borderRadius: 14, borderWidth: 1, borderColor: "#FECACA", backgroundColor: "#fff", alignItems: "center", justifyContent: "center" },
  dangerTxt: { fontSize: 14, fontWeight: "800", color: "#DC2626" },
  ghostBtn: { flex: 1, height: 50, borderRadius: 14, borderWidth: 1, borderColor: LINE, backgroundColor: "#fff", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  ghostTxt: { fontSize: 14, fontWeight: "800", color: INK },
  primaryBtn: { flex: 1, height: 50, borderRadius: 14, backgroundColor: BRAND, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  primaryTxt: { fontSize: 14, fontWeight: "800", color: "#fff" },
});

const rsS = StyleSheet.create({
  wrap: { backgroundColor: "#fff", borderRadius: 18, marginHorizontal: 16, marginTop: 14, padding: 12, shadowColor: INK, shadowOpacity: 0.12, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 4 },
  head: { flexDirection: "row", alignItems: "center", gap: 10 },
  icon: { width: 34, height: 34, borderRadius: 10, backgroundColor: "#F5F3FF", alignItems: "center", justifyContent: "center" },
  title: { fontSize: 13.5, fontWeight: "900", color: INK },
  sub: { fontSize: 11, fontWeight: "600", color: MUTED, marginTop: 1 },
  row: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10, backgroundColor: "#F8FAFC", borderRadius: 12, padding: 10 },
  lbl: { fontSize: 9.5, fontWeight: "900", color: FAINT, letterSpacing: 0.5 },
  old: { fontSize: 12, fontWeight: "700", color: FAINT, textDecorationLine: "line-through", marginTop: 1 },
  new: { fontSize: 12, fontWeight: "900", color: INK, marginTop: 1 },
});

const rf = StyleSheet.create({
  banner: { marginTop: 10, borderRadius: 14, padding: 12, flexDirection: "row", alignItems: "center", gap: 10 },
  bTitle: { fontSize: 14, fontWeight: "900" },
  bSub: { fontSize: 11.5, fontWeight: "600", marginTop: 2, lineHeight: 16, opacity: 0.9 },
  amt: { fontSize: 22, fontWeight: "900" },
  step: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 5 },
  dot: { width: 24, height: 24, borderRadius: 12, backgroundColor: "#E2E8F0", alignItems: "center", justifyContent: "center" },
  dotTxt: { fontSize: 11, fontWeight: "900", color: FAINT },
  stepTxt: { fontSize: 13, fontWeight: "600", color: FAINT },
  foot: { marginTop: 8, borderTopWidth: 1, borderColor: "#EEF1F5", paddingTop: 8, gap: 2 },
  footTxt: { fontSize: 12, fontWeight: "600", color: MUTED },
});

const cc = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  icon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 14, fontWeight: "900" },
  sub: { fontSize: 11.5, fontWeight: "600", color: "#78716C", marginTop: 1 },
  pill: { height: 26, paddingHorizontal: 9, borderRadius: 999, justifyContent: "center" },
  pillTxt: { fontSize: 12, fontWeight: "800" },
  credit: { marginHorizontal: 16, marginTop: 14, borderRadius: 20, padding: 16, overflow: "hidden" },
  live: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#4ADE80" },
  eyebrow: { color: "rgba(255,255,255,0.8)", fontSize: 11, fontWeight: "800", letterSpacing: 0.6 },
  cTitle: { color: "#fff", fontSize: 16, fontWeight: "900", marginTop: 6 },
  tiles: { flexDirection: "row", gap: 8, marginTop: 12 },
  tile: { flex: 1, backgroundColor: "rgba(255,255,255,0.12)", borderRadius: 14, padding: 11 },
  tLbl: { color: "rgba(255,255,255,0.7)", fontSize: 10, fontWeight: "800", letterSpacing: 0.4 },
  tVal: { color: "#fff", fontSize: 24, fontWeight: "900", marginTop: 2 },
  tSub: { color: "rgba(255,255,255,0.65)", fontSize: 10.5, fontWeight: "600" },
});
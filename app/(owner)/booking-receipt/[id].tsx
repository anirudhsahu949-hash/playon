/**
 * booking-receipt/[id].tsx — Online booking receipt (bill style)
 * • Green turf-stripe backdrop with a paper "bill" ticket on top
 * • Share receipt → sends the ticket as an image (ViewShot + expo-sharing)
 * • Customer phone stays locked until 2 hours before the game
 * Fixes: late-night status, phone unlock time, dateString first, Back on "not found".
 */
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, StatusBar, ActivityIndicator, Alert, Linking, Platform, Image,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../../../firebaseConfig";
import { Ionicons } from "@expo/vector-icons";
import * as Sharing from "expo-sharing";
import ViewShot from "react-native-view-shot";

// Logo file: put playon-receipt-logo.png in assets/images/
const PLAYON_LOGO = require("../../../assets/images/playon-receipt-logo.png");

// ── Palette ─────────────────────────────────────────────────────────────────
const BRAND = "#15803D";
const STRIPE = "#138A3F";
const ON_BRAND = "#DCFCE7";
const PAGE = "#F1F4F7";
const INK = "#0F172A";
const SLATE = "#475569";
const MUTED = "#64748B";
const FAINT = "#94A3B8";

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
const leftTxt = (mins: number) => {
  const h = Math.floor(mins / 60), m = mins % 60;
  return h === 0 ? `${m}m` : m === 0 ? `${h}h` : `${h}h ${m}m`;
};
const rs = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
function fmtCreated(v: any): string {
  const d = toDate(v);
  return d ? d.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true }) : "";
}

const STATUS = {
  confirmed: { label: "CONFIRMED", bg: "#DCFCE7", fg: BRAND },
  pending:   { label: "PENDING",   bg: "#FEF3C7", fg: "#B45309" },
  cancelled: { label: "CANCELLED", bg: "#FEE2E2", fg: "#DC2626" },
  completed: { label: "DONE",      bg: "#F1F5F9", fg: SLATE },
};
type StatusKey = keyof typeof STATUS;

// ─────────────────────────────────────────────────────────────────────────────
export default function BookingReceiptScreen() {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const shotRef = useRef<any>(null);

  const [booking, setBooking] = useState<any>(null);
  const [turf, setTurf] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [sharing, setSharing] = useState(false);
  const [, setTick] = useState(0);

  useEffect(() => { load(); }, []);
  useEffect(() => { const t = setInterval(() => setTick(x => x + 1), 60000); return () => clearInterval(t); }, []);

  const load = async () => {
    try {
      const snap = await getDoc(doc(db, "bookings", String(id)));
      if (snap.exists()) {
        const b: any = { id: snap.id, ...snap.data() };
        setBooking(b);
        if (b.turfId) {
          try { const t = await getDoc(doc(db, "turfs", b.turfId)); if (t.exists()) setTurf(t.data()); } catch {}
        }
      }
    } catch (e) { console.log(e); }
    finally { setLoading(false); }
  };

  const share = async () => {
    try {
      setSharing(true);
      await new Promise(r => setTimeout(r, 250));
      const uri = await (shotRef.current as any)?.capture?.();
      if (!uri) throw new Error("capture failed");
      await Sharing.shareAsync(uri, { mimeType: "image/png", dialogTitle: "Share receipt" });
    } catch (e) {
      console.log(e);
      Alert.alert("Error", "Unable to share the receipt.");
    } finally {
      setSharing(false);
    }
  };

  if (loading) {
    return (
      <View style={s.center}>
        <StatusBar barStyle="dark-content" />
        <ActivityIndicator size="large" color={BRAND} />
        <Text style={s.loadTxt}>Loading receipt…</Text>
      </View>
    );
  }
  if (!booking) {
    return (
      <View style={[s.center, { paddingHorizontal: 32 }]}>
        <StatusBar barStyle="dark-content" />
        <Ionicons name="alert-circle-outline" size={40} color={FAINT} />
        <Text style={s.nfTitle}>Booking not found</Text>
        <Text style={s.nfSub}>It may have been removed.</Text>
        <TouchableOpacity style={s.nfBtn} onPress={() => router.back()}><Text style={s.nfBtnTxt}>Go back</Text></TouchableOpacity>
      </View>
    );
  }

  // ── Derived ──
  const slots: string[] = Array.isArray(booking.selectedSlots) && booking.selectedSlots.length
    ? booking.selectedSlots : [booking.slotTime, booking.slot].filter(Boolean);
  const range = minsRange(slots, turf);
  const day = toDate(booking.dateString) ?? toDate(booking.date);
  const dayMs = day ? dayStart(day) : null;
  const now = Date.now();
  const startAbs = dayMs !== null && range ? dayMs + range.start * 60000 : null;
  const endAbs = dayMs !== null ? dayMs + (range ? range.end : 1440) * 60000 : null;

  let status: StatusKey = booking.status === "cancelled" ? "cancelled" : booking.status === "pending" ? "pending" : "confirmed";
  if (status !== "cancelled" && endAbs !== null && now >= endAbs) status = "completed";
  const st = STATUS[status];

  const total = Number(booking.totalAmount ?? booking.amount ?? booking.totalPrice ?? booking.price ?? 0) || 0;
  const fullyPaid = booking.paymentStatus === "paid" || booking.paymentStatus === "fully_paid";
  const advance = Number(booking.advanceAmount ?? 0);
  const paid = advance > 0 ? advance : fullyPaid ? total : 0;
  const due = Number(booking.remainingAmount ?? Math.max(total - paid, 0));
  const offerDiscount = Number(booking.offerDiscount || 0);
  const originalAmount = Number(booking.originalAmount || 0) || total + offerDiscount;
  const pcoins = Number(booking.pcoinsRedeemed || 0);
  const vcoins = Number(booking.vcoinsRedeemed || 0);
  const payLabel = due <= 0 && paid > 0 ? "Online · Fully paid" : paid > 0 ? "Online · Advance" : "Online";

  const phone: string = booking.phone || booking.userPhone || booking.customerPhone || "";
  // FIX: unlock 2 hours before the real start time
  const unlockAt = startAbs !== null ? startAbs - 120 * 60000 : null;
  const phoneOpen = !!phone && (unlockAt === null || now >= unlockAt);
  const minsToUnlock = unlockAt !== null ? Math.max(0, Math.ceil((unlockAt - now) / 60000)) : 0;

  const name = booking.userName || booking.customerName || "Customer";
  const dateTitle = day ? day.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "long", year: "numeric" }).toUpperCase() : "DATE NOT AVAILABLE";
  const location = booking.location || booking.turfLocation || turf?.location || turf?.address || "";
  const created = fmtCreated(booking.createdAt);
  const isCancelled = status === "cancelled";

  return (
    <View style={s.root}>
      <StatusBar barStyle="light-content" backgroundColor={BRAND} />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: insets.bottom + 30 }}>
        {/* Green turf area: header + ticket (this part is shared as image) */}
        <View style={s.turf}>
          <Stripes />
          <View style={[s.headerRow, { paddingTop: insets.top + 10 }]}>
            <TouchableOpacity style={s.hBtn} onPress={() => router.back()} accessibilityLabel="Back">
              <Ionicons name="arrow-back" size={20} color="#fff" />
            </TouchableOpacity>
            <View style={{ flex: 1 }}>
              <Text style={s.hKicker}>ONLINE BOOKING</Text>
              <Text style={s.hTitle}>Receipt</Text>
            </View>
            <TouchableOpacity style={s.hBtn} onPress={share} disabled={sharing} accessibilityLabel="Share receipt">
              {sharing ? <ActivityIndicator color="#fff" size="small" /> : <Ionicons name="share-outline" size={19} color="#fff" />}
            </TouchableOpacity>
          </View>

          <ViewShot ref={shotRef} options={{ format: "png", quality: 1 }} style={s.shot}>
            <Stripes />
            <View style={s.ticketWrap}>
              {/* Top part */}
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
                <Text style={[s.bigTime, isCancelled && { textDecorationLine: "line-through", color: FAINT }]}>
                  {range ? rangeTxt(range.start, range.end) : booking.slotTime || "Time not available"}
                </Text>
                <View style={s.pillRow}>
                  {range && <View style={[s.pill, { backgroundColor: "#F1F5F9" }]}><Text style={[s.pillTxt, { color: SLATE }]}>{hrsTxt(range.end - range.start)}</Text></View>}
                  <View style={[s.pill, { backgroundColor: "#EFF6FF" }]}><Text style={[s.pillTxt, { color: "#1D4ED8" }]}>{payLabel}</Text></View>
                  {booking.rescheduled && <View style={[s.pill, { backgroundColor: "#F5F3FF" }]}><Text style={[s.pillTxt, { color: "#6D28D9" }]}>Rescheduled</Text></View>}
                </View>

                <View style={s.infoRow}>
                  <View style={s.infoBox}>
                    <Text style={s.infoLbl}>TURF</Text>
                    <Text style={s.infoVal} numberOfLines={2}>{booking.turfName || turf?.name || "—"}</Text>
                    {!!location && <Text style={s.infoSub} numberOfLines={2}>{location}</Text>}
                  </View>
                  <View style={s.infoBox}>
                    <Text style={s.infoLbl}>CUSTOMER</Text>
                    <Text style={s.infoVal} numberOfLines={2}>{name}</Text>
                    <Text style={s.infoSub}>Booked in app</Text>
                  </View>
                </View>
              </View>

              <TearLine />

              {/* Bill */}
              <View style={s.ticketBottom}>
                <Text style={s.kicker}>BILL</Text>
                {offerDiscount > 0 && <BillRow label="Slot price" value={rs(originalAmount)} />}
                {offerDiscount > 0 && <BillRow label={`🎉 ${booking.offerTitle || "Venue offer"}`} value={`− ${rs(offerDiscount)}`} color={BRAND} />}
                <BillRow label="Total amount" value={rs(total)} strong />
                {pcoins > 0 && <BillRow label={`PCoin used · ${pcoins}`} value={`− ${rs(pcoins)}`} color="#7C3AED" />}
                {vcoins > 0 && <BillRow label={`VCoin used · ${vcoins}`} value={`− ${rs(vcoins)}`} color="#B45309" />}
                <BillRow label="Paid online" value={rs(paid)} color={BRAND} />

                {isCancelled ? (
                  <View style={[s.dueBox, { backgroundColor: "#FEF2F2", borderColor: "#FECACA" }]}>
                    <View style={{ flex: 1 }}>
                      <Text style={[s.dueLbl, { color: "#B91C1C" }]}>BOOKING CANCELLED</Text>
                      <Text style={[s.dueSub, { color: "#991B1B" }]}>{paid > 0 && booking.paymentId ? "Paid amount is refunded to the customer" : "No game for this slot"}</Text>
                    </View>
                  </View>
                ) : due > 0 ? (
                  <View style={s.dueBox}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.dueLbl}>{status === "completed" ? "WAS DUE AT TURF" : "COLLECT AT TURF"}</Text>
                      <Text style={s.dueSub}>{status === "completed" ? "Session has ended" : "Cash or UPI before the game"}</Text>
                    </View>
                    <Text style={s.dueAmt} numberOfLines={1} adjustsFontSizeToFit>{rs(due)}</Text>
                  </View>
                ) : (
                  <View style={[s.dueBox, { backgroundColor: "#F0FDF4", borderColor: "#BBF7D0" }]}>
                    <Ionicons name="checkmark-circle" size={22} color={BRAND} />
                    <View style={{ flex: 1 }}>
                      <Text style={[s.dueLbl, { color: BRAND }]}>FULLY PAID</Text>
                      <Text style={[s.dueSub, { color: "#166534" }]}>Nothing to collect at the turf</Text>
                    </View>
                  </View>
                )}

                <View style={s.idRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.idLbl}>BOOKING ID</Text>
                    <Text style={s.idVal} selectable numberOfLines={1}>{booking.id}</Text>
                  </View>
                  <Text style={s.idHint}>Show this at the turf</Text>
                </View>
                {!!created && <Text style={s.created}>Booked in app · {created}</Text>}
              </View>
              <ZigZag />
            </View>
            <Text style={s.shotFoot}>Thank you for playing at {booking.turfName || turf?.name || "our turf"}</Text>
          </ViewShot>
        </View>

        {/* Owner-only details (not in the shared image) */}
        <View style={s.ownerCard}>
          <Text style={s.kicker}>ONLY YOU SEE THIS</Text>
          <View style={s.ownerRow}>
            <View style={s.ownerIcon}><Ionicons name={phoneOpen ? "call-outline" : "lock-closed-outline"} size={17} color={phoneOpen ? BRAND : FAINT} /></View>
            <View style={{ flex: 1 }}>
              <Text style={s.ownerLbl}>Customer phone</Text>
              <Text style={[s.ownerVal, !phoneOpen && { color: FAINT }]}>
                {!phone ? "Not shared" : phoneOpen ? phone : `Unlocks in ${leftTxt(minsToUnlock)} (2 hrs before the game)`}
              </Text>
            </View>
          </View>
          {!!booking.note && (
            <View style={s.noteBox}><Text style={s.noteTxt}>“{booking.note}”</Text></View>
          )}
        </View>

        {/* Actions */}
        <View style={s.actRow}>
          <TouchableOpacity style={[s.ghostBtn, !phoneOpen && { opacity: 0.6 }]} disabled={!phoneOpen}
            onPress={() => Linking.openURL(`tel:${phone}`).catch(() => Alert.alert("Can't call", "Your phone could not start the call."))}>
            <Ionicons name={phoneOpen ? "call-outline" : "lock-closed-outline"} size={16} color={phoneOpen ? INK : FAINT} />
            <Text style={[s.ghostTxt, !phoneOpen && { color: FAINT }]}>{phoneOpen ? "Call customer" : "Call later"}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.primaryBtn} onPress={share} disabled={sharing}>
            {sharing ? <ActivityIndicator color="#fff" size="small" /> : <Ionicons name="share-outline" size={16} color="#fff" />}
            <Text style={s.primaryTxt}>Share receipt</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

// ── Pieces ──────────────────────────────────────────────────────────────────
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
      <Text style={[s.billLbl, strong && { color: INK, fontWeight: "900", fontSize: 15 }]}>{label}</Text>
      <Text style={[s.billVal, strong && { fontSize: 15 }, color ? { color } : null]}>{value}</Text>
    </View>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: PAGE },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: PAGE, gap: 8 },
  loadTxt: { marginTop: 6, color: MUTED, fontSize: 15, fontWeight: "600" },
  nfTitle: { fontSize: 17, fontWeight: "900", color: INK },
  nfSub: { fontSize: 13, fontWeight: "600", color: MUTED },
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
  infoRow: { flexDirection: "row", gap: 8, marginTop: 16 },
  infoBox: { flex: 1, backgroundColor: "#F5F7FA", borderRadius: 13, paddingHorizontal: 12, paddingVertical: 10 },
  infoLbl: { fontSize: 10, fontWeight: "800", color: MUTED, letterSpacing: 0.6 },
  infoVal: { fontSize: 14, fontWeight: "900", color: INK, marginTop: 2 },
  infoSub: { fontSize: 11, fontWeight: "600", color: MUTED },

  tear: { height: 26, backgroundColor: "#fff", justifyContent: "center" },
  notch: { position: "absolute", top: 0, width: 26, height: 26, borderRadius: 13, backgroundColor: BRAND },
  tearDash: { marginHorizontal: 20, borderTopWidth: 2, borderStyle: "dashed", borderColor: "#E2E8F0" },

  ticketBottom: { backgroundColor: "#fff", paddingHorizontal: 18, paddingTop: 6, paddingBottom: 14 },
  kicker: { fontSize: 10.5, letterSpacing: 0.9, fontWeight: "800", color: MUTED, marginBottom: 6 },
  billRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 6, gap: 10 },
  billLbl: { flex: 1, fontSize: 13.5, fontWeight: "700", color: SLATE },
  billVal: { fontSize: 13.5, fontWeight: "900", color: INK },
  dueBox: { marginTop: 10, flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#FFF7ED", borderWidth: 1, borderColor: "#FED7AA", borderRadius: 14, padding: 12 },
  dueLbl: { fontSize: 10.5, fontWeight: "900", color: "#C2410C", letterSpacing: 0.6 },
  dueSub: { fontSize: 11.5, fontWeight: "600", color: "#9A3412", marginTop: 1 },
  dueAmt: { fontSize: 24, fontWeight: "900", color: "#9A3412", maxWidth: 140 },
  idRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderStyle: "dashed", borderColor: "#E2E8F0" },
  idLbl: { fontSize: 10, fontWeight: "800", color: FAINT, letterSpacing: 0.6 },
  idVal: { fontSize: 12, fontWeight: "700", color: "#334155", fontFamily: Platform.OS === "ios" ? "Courier" : "monospace" },
  idHint: { fontSize: 10.5, fontWeight: "700", color: FAINT },
  created: { fontSize: 10.5, fontWeight: "600", color: FAINT, marginTop: 8 },
  zigWrap: { height: 8, overflow: "hidden" },
  zigTooth: { position: "absolute", top: -6, width: 12, height: 12, backgroundColor: "#fff", transform: [{ rotate: "45deg" }] },
  shotFoot: { textAlign: "center", color: ON_BRAND, fontSize: 12, fontWeight: "800", marginTop: 12, marginBottom: 6 },

  ownerCard: { backgroundColor: "#fff", borderRadius: 18, marginHorizontal: 16, marginTop: 16, padding: 14, shadowColor: INK, shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  ownerRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  ownerIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: "#F1F5F9", alignItems: "center", justifyContent: "center" },
  ownerLbl: { fontSize: 11.5, fontWeight: "700", color: MUTED },
  ownerVal: { fontSize: 14.5, fontWeight: "900", color: INK },
  noteBox: { marginTop: 10, backgroundColor: "#F5F7FA", borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  noteTxt: { fontSize: 12.5, fontWeight: "600", color: SLATE },

  actRow: { flexDirection: "row", gap: 8, marginHorizontal: 16, marginTop: 14 },
  ghostBtn: { flex: 1, height: 50, borderRadius: 14, borderWidth: 1, borderColor: "#E2E8F0", backgroundColor: "#fff", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  ghostTxt: { fontSize: 14, fontWeight: "800", color: INK },
  primaryBtn: { flex: 1, height: 50, borderRadius: 14, backgroundColor: BRAND, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  primaryTxt: { fontSize: 14, fontWeight: "800", color: "#fff" },
});
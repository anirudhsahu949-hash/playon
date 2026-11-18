/**
 * app/admin/apl-player/[id].tsx — one player, everything about them.
 *
 * Details · contact · payment · auction result · refund.
 *
 * The refund button calls the server (/refund-apl-registration), which is the
 * only place a refund can start. Pressing it twice is safe: the server holds
 * a lock and asks Razorpay whether this payment was already refunded.
 */
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, TextInput,
  ActivityIndicator, StatusBar, Alert, Linking, Modal,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useEffect, useState } from "react";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { doc, onSnapshot, updateDoc } from "firebase/firestore";

import { auth, db } from "../../../firebaseConfig";
import { cldThumb } from "../../../utils/cloudinary";

const SERVER_URL = "https://bookora-backend-95u4.onrender.com";

const GREEN   = "#16A34A";
const GREEN_D = "#15803D";
const DARK    = "#0B1220";
const RED     = "#B91C1C";
const BG      = "#F3F4F6";
const BORDER  = "#E5E7EB";
const MUTED   = "#6B7280";
const INSTA   = "#C13584";

function fmtWhen(v: any): string {
  if (!v) return "—";
  const d = typeof v?.toDate === "function" ? v.toDate() : new Date(v);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true });
}

export default function AdminAplPlayer() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [reg, setReg]         = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy]       = useState(false);

  const [teamOpen, setTeamOpen]   = useState(false);
  const [teamName, setTeamName]   = useState("");
  const [soldPrice, setSoldPrice] = useState("");

  useEffect(() => {
    if (!id) return;
    const unsub = onSnapshot(
      doc(db, "aplRegistrations", String(id)),
      (snap) => {
        setReg(snap.exists() ? { id: snap.id, ...(snap.data() as any) } : null);
        setLoading(false);
      },
      () => setLoading(false),
    );
    return unsub;
  }, [id]);

  const call = () => reg?.mobile && Linking.openURL(`tel:+91${reg.mobile}`).catch(() => {});
  const whatsapp = () => {
    if (!reg?.mobile) return;
    const t = encodeURIComponent(`Hi ${reg.name || ""}, about your ${reg.leagueName || "APL"} registration (${reg.regNo || ""}) —`);
    Linking.openURL(`https://wa.me/91${reg.mobile}?text=${t}`).catch(() => {});
  };
  const insta = () => {
    const h = String(reg?.instagram || "").replace(/^@/, "").trim();
    if (!h) return;
    Linking.openURL(`https://instagram.com/${h}`).catch(() => {});
  };

  // ── auction result ───────────────────────────────────────────────────────
  const saveTeam = async () => {
    const name = teamName.trim();
    if (!name) return Alert.alert("Team name", "Type the team that picked this player.");
    try {
      setBusy(true);
      await updateDoc(doc(db, "aplRegistrations", String(id)), {
        status:    "sold",
        teamName:  name,
        soldPrice: soldPrice.trim() ? Number(soldPrice.replace(/\D/g, "")) : null,
      });
      setTeamOpen(false);
      setTeamName(""); setSoldPrice("");
    } catch (e: any) {
      Alert.alert("Could not save", e?.message || "Try again.");
    } finally { setBusy(false); }
  };

  const markUnsold = () => {
    Alert.alert("Mark as unsold?", "The player's screen will show that a refund is coming.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Mark unsold",
        onPress: async () => {
          try {
            setBusy(true);
            await updateDoc(doc(db, "aplRegistrations", String(id)), { status: "unsold", teamName: null, soldPrice: null });
          } catch (e: any) {
            Alert.alert("Could not save", e?.message || "Try again.");
          } finally { setBusy(false); }
        },
      },
    ]);
  };

  // ── refund ───────────────────────────────────────────────────────────────
  const refund = () => {
    const amount = Number(reg?.fee || 0);
    Alert.alert(
      `Refund ₹${amount}?`,
      `${reg?.name} gets ₹${amount} back in the account they paid from. This cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: `Refund ₹${amount}`, style: "destructive", onPress: doRefund },
      ],
    );
  };

  const doRefund = async () => {
    if (!auth.currentUser) return Alert.alert("Session expired", "Please log in again.");
    try {
      setBusy(true);
      const token = await auth.currentUser.getIdToken();
      const res = await fetch(`${SERVER_URL}/refund-apl-registration`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ registrationId: String(id), reason: "Not picked in the auction" }),
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        if (data?.lowBalance) {
          Alert.alert(
            "Razorpay balance is short",
            "Nothing was sent. Add funds in the Razorpay dashboard, then press Refund again.",
          );
        } else {
          Alert.alert("Refund did not start", data?.error || "Please try again.");
        }
        return;
      }

      Alert.alert(
        data.alreadyRefunded ? "Already refunded" : "Refund started",
        data.message || `₹${data.refundAmount} is on its way to the player.`,
      );
    } catch (e: any) {
      Alert.alert("Network problem", "Could not reach the server. Check your internet and try again — nothing was sent.");
    } finally { setBusy(false); }
  };

  if (loading) {
    return <View style={[s.center, { backgroundColor: BG }]}><ActivityIndicator size="large" color={GREEN} /></View>;
  }
  if (!reg) {
    return (
      <SafeAreaView style={[s.center, { backgroundColor: BG, padding: 28 }]}>
        <Text style={{ color: MUTED }}>This registration was not found.</Text>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}><Text style={s.backTxt}>Go back</Text></TouchableOpacity>
      </SafeAreaView>
    );
  }

  const paid     = reg.paymentStatus === "paid";
  const refundSt = reg.refundStatus || "none";
  const refundDone = ["processing", "initiated", "processed"].includes(refundSt);

  const pill = !paid
    ? { txt: "NOT PAID", fg: RED, bg: "#FEF2F2", bd: "#FECACA" }
    : refundSt === "processed" ? { txt: "REFUNDED", fg: "#374151", bg: "#F3F4F6", bd: BORDER }
    : refundDone ? { txt: "REFUND ON THE WAY", fg: "#1D4ED8", bg: "#EFF6FF", bd: "#BFDBFE" }
    : reg.status === "sold" ? { txt: "SOLD", fg: "#1D4ED8", bg: "#EFF6FF", bd: "#BFDBFE" }
    : reg.status === "unsold" ? { txt: "UNSOLD", fg: "#B45309", bg: "#FFFBEB", bd: "#FDE68A" }
    : { txt: "IN AUCTION POOL", fg: GREEN_D, bg: "#F0FDF4", bd: "#BBF7D0" };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: BG }} edges={["top"]}>
      <StatusBar barStyle="light-content" backgroundColor={DARK} />

      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10} style={s.hBtn}>
          <Ionicons name="chevron-back" size={20} color="#E5E7EB" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={s.hTitle} numberOfLines={1}>{reg.name}</Text>
          <Text style={s.hSub} numberOfLines={1}>{reg.regNo || "—"} · registered {fmtWhen(reg.paidAt || reg.createdAt)}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 24 }} showsVerticalScrollIndicator={false}>

        {/* top card */}
        <View style={[s.card, { flexDirection: "row", gap: 14, alignItems: "center" }]}>
          {reg.photoUrl
            ? <Image source={{ uri: cldThumb(reg.photoUrl, 300) }} style={s.photo} />
            : <View style={[s.photo, s.center]}><Ionicons name="person" size={30} color="#9CA3AF" /></View>}
          <View style={{ flex: 1, gap: 6 }}>
            <Text style={s.bigName}>{reg.name}</Text>
            <Text style={s.hint}>{[reg.role, reg.age ? `Age ${reg.age}` : "", reg.area].filter(Boolean).join(" · ")}</Text>
            <View style={[s.pill, { backgroundColor: pill.bg, borderColor: pill.bd }]}>
              <Text style={[s.pillTxt, { color: pill.fg }]}>{pill.txt}</Text>
            </View>
          </View>
        </View>

        <Text style={s.section}>PLAYER DETAILS</Text>
        <View style={s.card}>
          <Row label="Age" value={String(reg.age || "—")} />
          <Row label="Area" value={reg.area || "—"} />
          <Row label="Role" value={reg.role || "—"} />
          <Row label="Batting" value={reg.battingHand || "—"} />
          <Row label="Bowling" value={reg.bowlingStyle || "—"} />
          <Row label="Jersey" value={[reg.jerseySize, reg.jerseyName, reg.jerseyNo].filter(Boolean).join(" · ") || "—"} />
          <Row label="Experience" value={reg.experience || "—"} last />
        </View>

        <Text style={s.section}>CONTACT</Text>
        <View style={s.card}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <View>
              <Text style={s.hint}>Mobile (WhatsApp)</Text>
              <Text style={s.phone}>+91 {reg.mobile || "—"}</Text>
            </View>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <TouchableOpacity onPress={call} style={s.iconBtn}><Ionicons name="call-outline" size={17} color="#374151" /></TouchableOpacity>
              <TouchableOpacity onPress={whatsapp} style={[s.iconBtn, { borderColor: GREEN }]}><Ionicons name="logo-whatsapp" size={17} color={GREEN_D} /></TouchableOpacity>
              {!!reg.instagram && (
                <TouchableOpacity onPress={insta} style={[s.iconBtn, { borderColor: INSTA }]}><Ionicons name="logo-instagram" size={17} color={INSTA} /></TouchableOpacity>
              )}
            </View>
          </View>
          <View style={s.hr} />
          <Row label="Instagram" value={reg.instagram || "—"} />
          <Row label="Emergency contact" value={reg.emergencyContact ? `+91 ${reg.emergencyContact}` : "—"} last />
        </View>

        <Text style={s.section}>PAYMENT</Text>
        <View style={s.card}>
          <Row label="Status" value={paid ? "Paid" : "Not paid"} strong={paid ? GREEN_D : RED} />
          <Row label="Paid by player" value={`₹${reg.amountPaid ?? 0}`} />
          <Row label="Registration fee" value={`₹${reg.fee ?? 0}`} />
          <Row label="Gateway charge" value={`₹${reg.gatewayCharge ?? 0}`} />
          <Row label="Method" value={(reg.paymentMethod || "—").toString().toUpperCase()} />
          <Row label="Paid at" value={fmtWhen(reg.paidAt)} />
          <Row label="Payment ID" value={reg.paymentId || "—"} small />
          <Row label="Order ID" value={reg.orderId || "—"} small last />
        </View>

        <Text style={s.section}>AUCTION</Text>
        <View style={s.card}>
          <Row label="Pool status" value={reg.status === "pool" ? "In pool" : (reg.status || "—")} />
          <Row label="Team" value={reg.teamName || "Not assigned"} />
          <Row label="Sold price" value={reg.soldPrice ? `₹${reg.soldPrice}` : "—"} last />

          <View style={{ flexDirection: "row", gap: 10, marginTop: 14 }}>
            <TouchableOpacity
              style={[s.smallBtn, { backgroundColor: GREEN }]}
              activeOpacity={0.9}
              disabled={busy || !paid}
              onPress={() => { setTeamName(reg.teamName || ""); setSoldPrice(reg.soldPrice ? String(reg.soldPrice) : ""); setTeamOpen(true); }}
            >
              <Ionicons name="people-outline" size={16} color="#FFFFFF" />
              <Text style={s.smallBtnTxt}>{reg.status === "sold" ? "Change team" : "Assign to team"}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[s.smallBtnOutline, { borderColor: "#FDE68A" }]}
              activeOpacity={0.9}
              disabled={busy || !paid}
              onPress={markUnsold}
            >
              <Text style={[s.smallBtnOutlineTxt, { color: "#B45309" }]}>Mark unsold</Text>
            </TouchableOpacity>
          </View>
        </View>

        <Text style={s.section}>REFUND</Text>
        <View style={s.card}>
          <Row label="Refund status" value={
            refundSt === "none" ? "Not started"
            : refundSt === "processing" ? "Starting…"
            : refundSt === "initiated" ? "On the way (5–7 working days)"
            : refundSt === "processed" ? "Completed"
            : "Failed"
          } strong={refundSt === "failed" ? RED : undefined} />
          <Row label="Refund amount" value={reg.refundAmount ? `₹${reg.refundAmount}` : "—"} />
          <Row label="Refund ID" value={reg.refundId || "—"} small />
          {!!reg.refundError && <Row label="Last error" value={String(reg.refundError)} small last />}

          <Text style={s.note}>
            Only ₹{reg.fee ?? 0} goes back — Razorpay never returns the ₹{reg.gatewayCharge ?? 0} gateway charge.
            Make sure your Razorpay balance has enough money before refunding a batch of players.
          </Text>
        </View>
      </ScrollView>

      {/* sticky refund */}
      <View style={[s.bottom, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        <TouchableOpacity
          style={[s.refundBtn, (busy || !paid || refundDone) && { opacity: 0.45 }]}
          activeOpacity={0.9}
          disabled={busy || !paid || refundDone}
          onPress={refund}
        >
          {busy
            ? <ActivityIndicator color={RED} />
            : <>
                <Ionicons name="refresh" size={17} color={RED} />
                <Text style={s.refundTxt}>
                  {refundSt === "processed" ? "Already refunded" : refundDone ? "Refund in progress" : `Refund ₹${reg.fee ?? 0}`}
                </Text>
              </>}
        </TouchableOpacity>
      </View>

      {/* assign team */}
      <Modal visible={teamOpen} transparent animationType="slide" onRequestClose={() => !busy && setTeamOpen(false)}>
        <View style={s.backdrop}>
          <View style={[s.sheet, { paddingBottom: Math.max(insets.bottom, 18) }]}>
            <View style={s.handle} />
            <Text style={s.sheetTitle}>Which team picked {String(reg.name || "").split(" ")[0]}?</Text>

            <Text style={[s.hint, { marginTop: 14 }]}>Team name</Text>
            <TextInput style={s.input} value={teamName} onChangeText={setTeamName}
              placeholder="e.g. Thunder XI" placeholderTextColor="#9CA3AF" autoCapitalize="words" />

            <Text style={[s.hint, { marginTop: 12 }]}>Sold price (optional)</Text>
            <TextInput style={s.input} value={soldPrice} onChangeText={(v) => setSoldPrice(v.replace(/\D/g, ""))}
              placeholder="2400" placeholderTextColor="#9CA3AF" keyboardType="number-pad" />

            <View style={{ flexDirection: "row", gap: 10, marginTop: 18 }}>
              <TouchableOpacity style={s.cancelBtn} onPress={() => !busy && setTeamOpen(false)}>
                <Text style={s.cancelTxt}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.saveBtn, busy && { opacity: 0.6 }]} disabled={busy} onPress={saveTeam}>
                {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={s.saveTxt}>Save</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function Row({ label, value, last, small, strong }: any) {
  return (
    <View style={[s.row, last && { borderBottomWidth: 0 }]}>
      <Text style={s.rowLabel}>{label}</Text>
      <Text style={[s.rowValue, small && { fontSize: 12 }, strong && { color: strong }]} numberOfLines={2}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  center: { alignItems: "center", justifyContent: "center", flex: 1 },

  header: { backgroundColor: DARK, paddingHorizontal: 16, paddingVertical: 12, flexDirection: "row", alignItems: "center", gap: 12 },
  hBtn: { width: 34, height: 34, borderRadius: 10, borderWidth: 1, borderColor: "#263349", backgroundColor: "#141E31", alignItems: "center", justifyContent: "center" },
  hTitle: { fontSize: 15.5, fontWeight: "700", color: "#FFFFFF" },
  hSub: { fontSize: 11.5, color: "#9CA3AF", marginTop: 2 },
  backBtn: { marginTop: 16, backgroundColor: DARK, borderRadius: 10, paddingHorizontal: 20, paddingVertical: 12 },
  backTxt: { color: "#FFFFFF", fontWeight: "700" },

  card: { backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: BORDER, borderRadius: 14, padding: 14 },
  section: { fontSize: 11.5, fontWeight: "800", color: MUTED, letterSpacing: 0.7, marginTop: 16, marginBottom: 8 },
  photo: { width: 76, height: 76, borderRadius: 12, backgroundColor: BG, borderWidth: 1, borderColor: BORDER },
  bigName: { fontSize: 16, fontWeight: "700", color: "#111827" },
  hint: { fontSize: 11.5, color: MUTED },
  pill: { alignSelf: "flex-start", borderWidth: 1, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3 },
  pillTxt: { fontSize: 10.5, fontWeight: "700" },

  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 16, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: "#F3F4F6" },
  rowLabel: { fontSize: 12.5, color: MUTED, flexShrink: 0 },
  rowValue: { fontSize: 13, fontWeight: "600", color: "#111827", flexShrink: 1, textAlign: "right" },
  hr: { height: 1, backgroundColor: "#F3F4F6", marginVertical: 4 },
  phone: { fontSize: 14, fontWeight: "700", color: "#111827", marginTop: 2 },
  iconBtn: { width: 40, height: 40, borderRadius: 10, borderWidth: 1.5, borderColor: BORDER, alignItems: "center", justifyContent: "center", backgroundColor: "#FFFFFF" },

  smallBtn: { flex: 2, height: 46, borderRadius: 11, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 },
  smallBtnTxt: { color: "#FFFFFF", fontSize: 13, fontWeight: "700" },
  smallBtnOutline: { flex: 1, height: 46, borderRadius: 11, borderWidth: 1.5, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center" },
  smallBtnOutlineTxt: { fontSize: 13, fontWeight: "700" },

  note: { fontSize: 11.5, color: MUTED, lineHeight: 18, marginTop: 12 },

  bottom: { backgroundColor: "#FFFFFF", borderTopWidth: 1, borderTopColor: BORDER, paddingHorizontal: 16, paddingTop: 12 },
  refundBtn: { height: 52, borderRadius: 12, borderWidth: 1.5, borderColor: "#FECACA", backgroundColor: "#FFFFFF", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  refundTxt: { color: RED, fontSize: 14.5, fontWeight: "700" },

  backdrop: { flex: 1, backgroundColor: "rgba(11,18,32,0.55)", justifyContent: "flex-end" },
  sheet: { backgroundColor: "#FFFFFF", borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 18, paddingTop: 10 },
  handle: { alignSelf: "center", width: 42, height: 4, borderRadius: 999, backgroundColor: "#D1D5DB", marginBottom: 14 },
  sheetTitle: { fontSize: 16.5, fontWeight: "700", color: "#111827" },
  input: { height: 46, marginTop: 6, paddingHorizontal: 13, borderWidth: 1.5, borderColor: BORDER, borderRadius: 10, fontSize: 14, color: "#111827" },
  cancelBtn: { flex: 1, height: 48, borderRadius: 11, backgroundColor: "#F3F4F6", alignItems: "center", justifyContent: "center" },
  cancelTxt: { color: "#374151", fontWeight: "700", fontSize: 14 },
  saveBtn: { flex: 2, height: 48, borderRadius: 11, backgroundColor: GREEN, alignItems: "center", justifyContent: "center" },
  saveTxt: { color: "#FFFFFF", fontWeight: "700", fontSize: 14 },
});

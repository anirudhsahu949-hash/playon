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
  Alert,
} from "react-native";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../../firebaseConfig";
import { Ionicons } from "@expo/vector-icons";
import * as Sharing from "expo-sharing";
import ViewShot from "react-native-view-shot";

// ─────────────────────────────────────────────────────────────────────────────
// MEMBERSHIP RECEIPT (simple, no QR)
// Reads from "gymMemberships" using the doc id.
// Usage: router.push(`/membership-receipt?id=${membershipId}`)
// ─────────────────────────────────────────────────────────────────────────────

const DARK   = "#0B1220";
const GYM    = "#7C3AED";
const MUTED  = "#9CA3AF";
const INK    = "#1A1D21";
const GREEN  = "#16A34A";

// ── date helpers ──
const toDate = (v: any): Date | null => {
  if (!v) return null;
  if (typeof v.toDate === "function") return v.toDate();
  if (v instanceof Date) return v;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
};
const fmtDate = (v: any): string => {
  const d = toDate(v);
  if (!d) return "—";
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
};

export default function MembershipReceipt() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const [m, setM] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const receiptRef = useRef<ViewShot>(null);

  useEffect(() => { load(); }, []);

  const load = async () => {
    try {
      const snap = await getDoc(doc(db, "gymMemberships", String(id)));
      if (snap.exists()) setM({ id: snap.id, ...snap.data() });
    } catch (e) { console.log(e); }
    finally { setLoading(false); }
  };

  const isActive = useMemo(() => {
    if (!m) return false;
    const d = toDate(m.validUntil);
    return d ? d.getTime() >= Date.now() : false;
  }, [m]);

  const shareReceipt = async () => {
    try {
      await new Promise((r) => setTimeout(r, 300));
      const uri = await (receiptRef.current as any).capture();
      await Sharing.shareAsync(uri);
    } catch (e) {
      console.log(e);
      Alert.alert("Error", "Unable to share receipt.");
    }
  };

  if (loading) {
    return (
      <View style={styles.loaderWrap}>
        <ActivityIndicator size="large" color={GYM} />
        <Text style={styles.loaderText}>Loading receipt…</Text>
      </View>
    );
  }

  if (!m) {
    return (
      <View style={styles.loaderWrap}>
        <Ionicons name="alert-circle-outline" size={40} color={MUTED} />
        <Text style={styles.loaderText}>Receipt not found</Text>
        <TouchableOpacity onPress={() => router.back()} style={{ marginTop: 8 }}>
          <Text style={styles.backLink}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const amount   = Number(m.amountPaid ?? m.amount ?? 0);
  const discount = Number(m.discount ?? 0);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={DARK} />

      {/* top bar */}
      <View style={styles.topBar}>
        <TouchableOpacity style={styles.topBtn} onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.topTitle}>Membership Receipt</Text>
        <TouchableOpacity style={styles.topBtn} onPress={shareReceipt} hitSlop={10}>
          <Ionicons name="share-outline" size={20} color="#fff" />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        {/* success banner */}
        <View style={styles.successBanner}>
          <View style={styles.successIcon}>
            <Ionicons name="checkmark" size={26} color="#fff" />
          </View>
          <Text style={styles.successTitle}>Payment Successful</Text>
          <Text style={styles.successSub}>Your gym membership is confirmed</Text>
        </View>

        {/* RECEIPT CARD (captured for share) */}
        <ViewShot ref={receiptRef} options={{ format: "png", quality: 1 }} style={{ backgroundColor: "#fff", borderRadius: 18 }}>
          <View style={styles.card}>
            {/* header */}
            <View style={styles.cardHead}>
              <View style={styles.brandRow}>
                <View style={styles.brandIcon}>
                  <Ionicons name="barbell" size={16} color="#fff" />
                </View>
                <Text style={styles.brandName}>{m.gymName || "Gym"}</Text>
              </View>
              <View style={[styles.statusPill, { backgroundColor: isActive ? "#DCFCE7" : "#FEE2E2" }]}>
                <Text style={[styles.statusTxt, { color: isActive ? GREEN : "#DC2626" }]}>
                  {isActive ? "ACTIVE" : "EXPIRED"}
                </Text>
              </View>
            </View>

            <View style={styles.dashedLine} />

            {/* member */}
            <View style={styles.row}>
              <Text style={styles.label}>Member</Text>
              <Text style={styles.value}>{m.customerName || "Member"}</Text>
            </View>
            {!!m.phone && (
              <View style={styles.row}>
                <Text style={styles.label}>Phone</Text>
                <Text style={styles.value}>{m.phone}</Text>
              </View>
            )}
            <View style={styles.row}>
              <Text style={styles.label}>Plan</Text>
              <Text style={styles.value}>{m.planLabel || "—"}</Text>
            </View>
            {!!m.batch && (
              <View style={styles.row}>
                <Text style={styles.label}>Timing / Batch</Text>
                <Text style={styles.value}>{m.batch}</Text>
              </View>
            )}

            <View style={styles.dashedLine} />

            {/* validity */}
            <View style={styles.row}>
              <Text style={styles.label}>Start date</Text>
              <Text style={styles.value}>{fmtDate(m.validFrom)}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.label}>End date</Text>
              <Text style={[styles.value, { color: isActive ? INK : "#DC2626" }]}>{fmtDate(m.validUntil)}</Text>
            </View>

            <View style={styles.dashedLine} />

            {/* payment */}
            {discount > 0 && (
              <>
                <View style={styles.row}>
                  <Text style={styles.label}>Plan price</Text>
                  <Text style={styles.value}>₹{amount + discount}</Text>
                </View>
                <View style={styles.row}>
                  <Text style={[styles.label, { color: GREEN }]}>
                    Promo {m.promoCode ? `(${m.promoCode})` : ""}
                  </Text>
                  <Text style={[styles.value, { color: GREEN }]}>− ₹{discount}</Text>
                </View>
              </>
            )}
            <View style={styles.row}>
              <Text style={[styles.label, { fontWeight: "800", color: INK }]}>Amount Paid</Text>
              <Text style={styles.totalValue}>₹{amount}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.label}>Payment Status</Text>
              <Text style={[styles.value, { color: GREEN }]}>Paid Online</Text>
            </View>

            <View style={styles.dashedLine} />

            {/* ids */}
            <View style={styles.row}>
              <Text style={styles.labelSmall}>Payment ID</Text>
              <Text style={styles.valueSmall} numberOfLines={1}>{m.paymentId || "—"}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.labelSmall}>Booking ID</Text>
              <Text style={styles.valueSmall} numberOfLines={1}>{m.id}</Text>
            </View>

            <Text style={styles.footerNote}>Show this receipt at the gym if asked.</Text>
          </View>
        </ViewShot>

        {/* share button (outside captured card) */}
        <TouchableOpacity style={styles.shareBtn} onPress={shareReceipt} activeOpacity={0.9}>
          <Ionicons name="download-outline" size={18} color="#fff" />
          <Text style={styles.shareTxt}>Save / Share Receipt</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.doneBtn} onPress={() => router.replace("/(tabs)")} activeOpacity={0.9}>
          <Text style={styles.doneTxt}>Done</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F5F5F7" },
  loaderWrap: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#F5F5F7", gap: 12 },
  loaderText: { fontSize: 14, color: MUTED, fontWeight: "600" },
  backLink: { color: GYM, fontWeight: "800", fontSize: 14 },

  topBar: {
    backgroundColor: DARK, flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingBottom: 14,
    paddingTop: Platform.OS === "android" ? (StatusBar.currentHeight || 0) + 12 : 12,
  },
  topBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: "rgba(255,255,255,0.12)", justifyContent: "center", alignItems: "center" },
  topTitle: { color: "#fff", fontSize: 16, fontWeight: "800" },

  successBanner: { alignItems: "center", paddingVertical: 18, marginBottom: 6 },
  successIcon: { width: 56, height: 56, borderRadius: 28, backgroundColor: GREEN, justifyContent: "center", alignItems: "center", marginBottom: 10 },
  successTitle: { fontSize: 19, fontWeight: "900", color: INK },
  successSub: { fontSize: 13, color: MUTED, fontWeight: "600", marginTop: 2 },

  card: { backgroundColor: "#fff", borderRadius: 18, padding: 18 },
  cardHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 9 },
  brandIcon: { width: 32, height: 32, borderRadius: 10, backgroundColor: GYM, justifyContent: "center", alignItems: "center" },
  brandName: { fontSize: 17, fontWeight: "900", color: INK, letterSpacing: -0.3 },
  statusPill: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 99 },
  statusTxt: { fontSize: 11, fontWeight: "900", letterSpacing: 0.5 },

  dashedLine: { height: 1, borderWidth: 1, borderColor: "#E5E7EB", borderStyle: "dashed", marginVertical: 14 },

  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginVertical: 6 },
  label: { fontSize: 13, color: MUTED, fontWeight: "600" },
  value: { fontSize: 14, color: INK, fontWeight: "700", maxWidth: "60%", textAlign: "right" },
  totalValue: { fontSize: 19, color: INK, fontWeight: "900" },
  labelSmall: { fontSize: 11, color: MUTED, fontWeight: "600" },
  valueSmall: { fontSize: 11, color: "#6B7280", fontWeight: "600", maxWidth: "62%", textAlign: "right" },
  footerNote: { fontSize: 11, color: MUTED, fontWeight: "500", textAlign: "center", marginTop: 16 },

  shareBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: GYM, borderRadius: 15, paddingVertical: 16, marginTop: 18 },
  shareTxt: { color: "#fff", fontSize: 15, fontWeight: "800" },
  doneBtn: { alignItems: "center", paddingVertical: 14, marginTop: 4 },
  doneTxt: { color: MUTED, fontSize: 14, fontWeight: "800" },
});
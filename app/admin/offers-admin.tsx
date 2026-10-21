/**
 * app/admin/offers-admin.tsx — Approve / reject owner offers that are above
 * the self-serve limit (25% or ₹300). Uses the server's /update-offer route,
 * which notifies the owner of the decision.
 */
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, ScrollView, StatusBar, RefreshControl,
  Alert, Modal, TextInput, KeyboardAvoidingView, Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useEffect, useState } from "react";
import { useRouter } from "expo-router";
import { auth, db } from "../../firebaseConfig";
import { collection, getDocs, query, where } from "firebase/firestore";
import { Ionicons } from "@expo/vector-icons";

const SERVER_URL = "https://bookora-backend-95u4.onrender.com";
const NAVY = "#0B1220";
const INK = "#0F172A";
const SLATE = "#475569";
const MUTED = "#64748B";
const PAGE = "#F1F4F7";
const BRAND = "#15803D";
const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const REASONS = ["Discount is too high", "Dates look wrong", "Please add a max discount", "Duplicate offer"];

type Offer = any;

const tiny = (k: string) => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d).toLocaleDateString("en-IN", { day: "numeric", month: "short" }); };
function whenTxt(o: Offer) {
  if (o.scheduleType === "dates") return (o.specialDates || []).map(tiny).join(", ") || "No dates";
  const days = o.allowedDays || [];
  return `${days.length ? days.map((d: number) => DAY[d]).join(", ") : "Every day"} · ${o.validFromKey ? tiny(o.validFromKey) : "?"} – ${o.validToKey ? tiny(o.validToKey) : "?"}`;
}
function whyTxt(o: Offer) {
  const out: string[] = [];
  if (o.type === "flat" && o.value > 300) out.push(`₹${o.value} flat (limit ₹300)`);
  if (o.type === "percent" && o.value > 25) out.push(`${o.value}% (limit 25%)`);
  if (o.type === "percent" && (o.maxDiscount || 0) > 300) out.push(`max ₹${o.maxDiscount} (limit ₹300)`);
  return out.length ? `Above self-serve limit: ${out.join(", ")}` : "Needs a check";
}

export default function OffersAdmin() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [list, setList] = useState<Offer[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<Offer | null>(null);
  const [reason, setReason] = useState("");

  useEffect(() => { load(); }, []);
  const load = async (isRefresh = false) => {
    isRefresh ? setRefreshing(true) : setLoading(true);
    try {
      const snap = await getDocs(query(collection(db, "offers"), where("status", "==", "pending")));
      const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      rows.sort((a: any, b: any) => (a.createdAt?.toMillis?.() ?? 0) - (b.createdAt?.toMillis?.() ?? 0));
      setList(rows);
    } catch {
      Alert.alert("Error", "Could not load offers.");
    } finally { setLoading(false); setRefreshing(false); }
  };

  const decide = async (o: Offer, status: "approved" | "rejected", rejectionReason?: string) => {
    setBusyId(o.id);
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch(`${SERVER_URL}/update-offer/${o.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(status === "rejected" ? { status, rejectionReason: rejectionReason || "" } : { status }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error || "Could not update.");
      setList((prev) => prev.filter((x) => x.id !== o.id));
    } catch (e: any) {
      Alert.alert("Error", e.message);
    } finally { setBusyId(null); }
  };

  const approve = (o: Offer) => Alert.alert("Approve offer?", `"${o.title}" goes live for players right away.`, [
    { text: "Back", style: "cancel" }, { text: "Approve", onPress: () => decide(o, "approved") },
  ]);

  return (
    <View style={s.root}>
      <StatusBar barStyle="light-content" backgroundColor={NAVY} />
      <View style={[s.header, { paddingTop: insets.top + 10 }]}>
        <TouchableOpacity style={s.hBtn} onPress={() => router.back()} accessibilityLabel="Back"><Ionicons name="arrow-back" size={20} color="#fff" /></TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={s.kicker}>ADMIN</Text>
          <Text style={s.title}>Offers to approve</Text>
        </View>
        <View style={s.count}><Text style={s.countTxt}>{list.length}</Text></View>
      </View>

      {loading ? (
        <View style={s.center}><ActivityIndicator color={BRAND} size="large" /></View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 14, gap: 10, paddingBottom: insets.bottom + 30 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={BRAND} />}>
          {list.length === 0 ? (
            <View style={s.empty}>
              <Text style={s.emptyTitle}>All caught up ✓</Text>
              <Text style={s.emptySub}>The owner gets a notification for each decision.</Text>
            </View>
          ) : list.map((o) => (
            <View key={o.id} style={s.card}>
              <View style={s.rowC}>
                <View style={s.disc}><Text style={s.discTxt}>{o.type === "flat" ? `₹${o.value} OFF` : `${o.value}% OFF`}</Text></View>
                <View style={{ flex: 1 }}>
                  <Text style={s.cardTitle} numberOfLines={1}>{o.title}</Text>
                  <Text style={s.cardSub} numberOfLines={2}>{(o.turfNames && o.turfNames.length ? o.turfNames : [o.turfName]).filter(Boolean).join(", ")}</Text>
                </View>
              </View>
              <Text style={s.detail}>
                {whenTxt(o)} · {o.targetSlots?.length ? o.targetSlots.join(", ") : "all day"}
                {o.type === "percent" && o.maxDiscount ? ` · max ₹${o.maxDiscount}` : ""}
                {o.totalUses ? ` · ${o.totalUses} uses` : " · unlimited uses"}
                {o.firstBookingOnly ? " · first booking only" : ""}
                {o.perUserLimit === 1 ? " · 1 per player" : ""}
              </Text>
              <Text style={s.why}>{whyTxt(o)}</Text>
              <View style={s.btnRow}>
                <TouchableOpacity style={s.reject} disabled={busyId === o.id} onPress={() => { setReason(""); setRejecting(o); }}>
                  <Text style={s.rejectTxt}>Reject…</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.approve} disabled={busyId === o.id} onPress={() => approve(o)}>
                  {busyId === o.id ? <ActivityIndicator color="#fff" /> : <Text style={s.approveTxt}>Approve</Text>}
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </ScrollView>
      )}

      <Modal visible={!!rejecting} transparent animationType="slide" onRequestClose={() => setRejecting(null)} statusBarTranslucent>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={s.backdrop}>
            <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => setRejecting(null)} />
            <View style={[s.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}>
              <Text style={s.sheetTitle}>Why not approved?</Text>
              <Text style={s.cardSub}>The owner sees this and can edit the offer.</Text>
              <View style={s.wrap}>
                {REASONS.map((r) => (
                  <TouchableOpacity key={r} style={[s.reasonChip, reason === r && { backgroundColor: INK, borderColor: INK }]} onPress={() => setReason(r)}>
                    <Text style={[s.reasonTxt, reason === r && { color: "#fff" }]}>{r}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TextInput style={s.input} value={reason} onChangeText={setReason} placeholder="Or write a reason" placeholderTextColor="#94A3B8" maxLength={300} multiline />
              <View style={s.btnRow}>
                <TouchableOpacity style={s.ghost} onPress={() => setRejecting(null)}><Text style={s.ghostTxt}>Back</Text></TouchableOpacity>
                <TouchableOpacity style={[s.rejectSolid, !reason.trim() && { opacity: 0.5 }]} disabled={!reason.trim()}
                  onPress={() => { const o = rejecting; setRejecting(null); decide(o, "rejected", reason.trim()); }}>
                  <Text style={s.approveTxt}>Reject offer</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: PAGE },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: { backgroundColor: NAVY, paddingHorizontal: 16, paddingBottom: 16, borderBottomLeftRadius: 22, borderBottomRightRadius: 22, flexDirection: "row", alignItems: "center", gap: 12 },
  hBtn: { width: 44, height: 44, borderRadius: 13, backgroundColor: "rgba(255,255,255,0.1)", alignItems: "center", justifyContent: "center" },
  kicker: { fontSize: 10, letterSpacing: 1.4, fontWeight: "800", color: "#64748B" },
  title: { fontSize: 20, fontWeight: "900", color: "#fff" },
  count: { minWidth: 30, height: 30, borderRadius: 15, backgroundColor: "#F59E0B", alignItems: "center", justifyContent: "center", paddingHorizontal: 8 },
  countTxt: { fontSize: 13, fontWeight: "900", color: NAVY },
  card: { backgroundColor: "#fff", borderRadius: 18, padding: 14, shadowColor: INK, shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  rowC: { flexDirection: "row", alignItems: "center", gap: 10 },
  disc: { backgroundColor: "#FFFBEB", paddingHorizontal: 10, paddingVertical: 8, borderRadius: 12 },
  discTxt: { fontSize: 13, fontWeight: "900", color: "#B45309" },
  cardTitle: { fontSize: 15, fontWeight: "900", color: INK },
  cardSub: { fontSize: 12, fontWeight: "600", color: MUTED },
  detail: { fontSize: 12.5, fontWeight: "600", color: SLATE, marginTop: 10, lineHeight: 18 },
  why: { backgroundColor: "#FFF7ED", borderRadius: 10, padding: 9, marginTop: 8, fontSize: 11.5, fontWeight: "700", color: "#9A3412" },
  btnRow: { flexDirection: "row", gap: 8, marginTop: 12 },
  reject: { flex: 1, height: 46, borderRadius: 12, borderWidth: 1, borderColor: "#FECACA", backgroundColor: "#FEF2F2", alignItems: "center", justifyContent: "center" },
  rejectTxt: { fontSize: 13.5, fontWeight: "800", color: "#B91C1C" },
  approve: { flex: 1, height: 46, borderRadius: 12, backgroundColor: BRAND, alignItems: "center", justifyContent: "center" },
  approveTxt: { fontSize: 13.5, fontWeight: "800", color: "#fff" },
  empty: { backgroundColor: "#fff", borderRadius: 18, padding: 28, alignItems: "center", gap: 4 },
  emptyTitle: { fontSize: 15, fontWeight: "900", color: INK },
  emptySub: { fontSize: 12.5, fontWeight: "600", color: MUTED, textAlign: "center" },
  backdrop: { flex: 1, backgroundColor: "rgba(11,18,32,0.55)" },
  sheet: { backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 16, gap: 10 },
  sheetTitle: { fontSize: 17, fontWeight: "900", color: INK },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  reasonChip: { height: 32, paddingHorizontal: 11, borderRadius: 999, borderWidth: 1, borderColor: "#E5E7EB", justifyContent: "center" },
  reasonTxt: { fontSize: 12, fontWeight: "800", color: "#334155" },
  input: { minHeight: 70, borderRadius: 12, backgroundColor: "#F5F7FA", borderWidth: 1, borderColor: "#E8ECF1", padding: 12, fontSize: 14, color: INK, textAlignVertical: "top" },
  ghost: { flex: 1, height: 48, borderRadius: 13, backgroundColor: "#F1F5F9", alignItems: "center", justifyContent: "center" },
  ghostTxt: { fontSize: 14, fontWeight: "800", color: "#334155" },
  rejectSolid: { flex: 1.4, height: 48, borderRadius: 13, backgroundColor: "#DC2626", alignItems: "center", justifyContent: "center" },
});

// =======================================================
// 🤝 REFERRAL CONTROL — Admin Screen
// Place next to p-coin.tsx (same admin folder), and add a
// link to it from your admin navbar / admin-link screen.
//
// Lets admin set the reward amount (50, 100, anything)
// and pause/resume the whole program.
// Saves to settings/referralConfig via /admin/referral-config
// =======================================================
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  ScrollView,
  StatusBar,
  Alert,
  Switch,
} from "react-native";
import { useEffect, useState } from "react";
import { auth, db } from "../../firebaseConfig";
import { doc, getDoc, collection, getDocs, query, limit } from "firebase/firestore";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const SERVER_URL = "https://bookora-backend-95u4.onrender.com";
const DARK   = "#0B1220";
const ACCENT = "#7C3AED";
const GREEN  = "#059669";
const GOLD   = "#D97706";
const GRAY1  = "#F5F6FA";
const GRAY2  = "#E5E7EB";
const GRAY3  = "#9CA3AF";

type ReferralRow = {
  id: string;
  referrerUid?: string;
  referredName?: string;
  code?: string;
  status?: string;
  rewardCoins?: number;
  createdAt?: any;
};

const fmtDate = (ts: any): string => {
  if (!ts) return "—";
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
};

export default function ReferralAdminScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(false);

  // Config
  const [rewardCoins, setRewardCoins] = useState<string>("50");
  const [enabled,     setEnabled]     = useState<boolean>(true);
  const [lastUpdated, setLastUpdated] = useState<string>("");

  // Stats
  const [totalRefs,   setTotalRefs]   = useState(0);
  const [pendingRefs, setPendingRefs] = useState(0);
  const [doneRefs,    setDoneRefs]    = useState(0);
  const [coinsGiven,  setCoinsGiven]  = useState(0);
  const [recent,      setRecent]      = useState<ReferralRow[]>([]);

  useEffect(() => { fetchAll(); }, []);

  const fetchAll = async () => {
    setLoading(true);
    try {
      // 1. Current config
      const cfgSnap = await getDoc(doc(db, "settings", "referralConfig"));
      if (cfgSnap.exists()) {
        const d = cfgSnap.data();
        setRewardCoins(String(d.rewardCoins ?? 50));
        setEnabled(d.enabled !== false);
        if (d.updatedAt?.toDate) {
          setLastUpdated(d.updatedAt.toDate().toLocaleString("en-IN", {
            day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
          }));
        }
      }

      // 2. Referral stats (no orderBy → no composite index; sort client-side)
      const refSnap = await getDocs(query(collection(db, "referrals"), limit(500)));
      const rows: ReferralRow[] = refSnap.docs.map(d => ({ id: d.id, ...d.data() } as ReferralRow));
      rows.sort((a, b) => {
        const ta = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : 0;
        const tb = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : 0;
        return tb - ta;
      });

      setTotalRefs(rows.length);
      setPendingRefs(rows.filter(r => r.status === "pending").length);
      const done = rows.filter(r => r.status === "completed");
      setDoneRefs(done.length);
      setCoinsGiven(done.reduce((sum, r) => sum + Number(r.rewardCoins || 0), 0));
      setRecent(rows.slice(0, 20));
    } catch (e) {
      console.error("referral admin fetch error:", e);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    const coins = Number(rewardCoins);
    if (isNaN(coins) || coins < 0) {
      return Alert.alert("Invalid amount", "Reward must be a number of 0 or more PCoins.");
    }
    setSaving(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error("Not logged in — please log in again.");

      const res  = await fetch(`${SERVER_URL}/admin/referral-config`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
        },
        body: JSON.stringify({ rewardCoins: coins, enabled }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "Failed to save.");

      Alert.alert(
        "Saved ✓",
        enabled
          ? `Referrers now earn ${coins} PCoins per completed referral.`
          : "Referral program is paused — no new rewards will be given."
      );
      await fetchAll();
    } catch (e: any) {
      Alert.alert("Error", e.message || "Could not save.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <View style={[s.safe, s.loader]}>
        <StatusBar barStyle="light-content" backgroundColor={DARK} />
        <ActivityIndicator size="large" color={ACCENT} />
      </View>
    );
  }

  const coins = Number(rewardCoins) || 0;

  return (
    <View style={[s.safe, { backgroundColor: GRAY1 }]}>
      <StatusBar barStyle="light-content" backgroundColor={DARK} />

      {/* ── Header ── */}
      <View style={[s.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn} hitSlop={10}>
          <Ionicons name="chevron-back" size={22} color="#fff" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={s.headerTitle}>Referral Control</Text>
          <Text style={s.headerSub}>Admin · Refer & Earn Settings</Text>
        </View>
        <View style={s.headerIcon}>
          <Text style={{ fontSize: 24 }}>🤝</Text>
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.scroll}>

        {/* ── Status card ── */}
        <View style={[s.statusCard, { borderColor: enabled ? GREEN + "40" : GRAY2 }]}>
          <View style={s.statusLeft}>
            <View style={[s.statusDot, { backgroundColor: enabled ? GREEN : GRAY3 }]} />
            <View style={{ flex: 1 }}>
              <Text style={s.statusTitle}>
                Refer & Earn is {enabled ? "Active" : "Paused"}
              </Text>
              <Text style={s.statusSub}>
                {enabled
                  ? `Referrers earn ${coins} PCoin${coins !== 1 ? "s" : ""} after friend's first completed booking`
                  : "No referral rewards are being given"}
              </Text>
              {!!lastUpdated && <Text style={s.statusTime}>Last updated: {lastUpdated}</Text>}
            </View>
          </View>
          <Switch
            value={enabled}
            onValueChange={setEnabled}
            trackColor={{ false: GRAY2, true: GREEN + "80" }}
            thumbColor={enabled ? GREEN : "#fff"}
          />
        </View>

        {/* ── Reward config ── */}
        <View style={s.card}>
          <Text style={s.cardTitle}>Reward Amount</Text>
          <Text style={s.cardSub}>
            PCoins credited to the referrer when their friend's first booking completes.
            Change it anytime (e.g. 50 normally, 100 during offers).
          </Text>

          <View style={s.inputRow}>
            <TextInput
              style={s.input}
              value={rewardCoins}
              onChangeText={setRewardCoins}
              keyboardType="numeric"
              placeholder="50"
              placeholderTextColor={GRAY3}
            />
            <Text style={s.inputSuffix}>PCoins / referral</Text>
          </View>

          {/* Quick presets */}
          <View style={s.presetRow}>
            {[25, 50, 75, 100].map(p => (
              <TouchableOpacity
                key={p}
                style={[s.presetChip, coins === p && s.presetChipActive]}
                onPress={() => setRewardCoins(String(p))}
              >
                <Text style={[s.presetTxt, coins === p && s.presetTxtActive]}>{p}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <TouchableOpacity
            style={[s.saveBtn, saving && { opacity: 0.6 }]}
            onPress={handleSave}
            disabled={saving}
            activeOpacity={0.85}
          >
            {saving
              ? <ActivityIndicator size="small" color="#fff" />
              : <Text style={s.saveBtnTxt}>Save Settings</Text>}
          </TouchableOpacity>
        </View>

        {/* ── Stats ── */}
        <View style={s.statsRow}>
          <View style={s.statBox}>
            <Text style={s.statNum}>{totalRefs}</Text>
            <Text style={s.statLabel}>Total</Text>
          </View>
          <View style={s.statBox}>
            <Text style={[s.statNum, { color: GOLD }]}>{pendingRefs}</Text>
            <Text style={s.statLabel}>Pending</Text>
          </View>
          <View style={s.statBox}>
            <Text style={[s.statNum, { color: GREEN }]}>{doneRefs}</Text>
            <Text style={s.statLabel}>Completed</Text>
          </View>
          <View style={s.statBox}>
            <Text style={[s.statNum, { color: ACCENT }]}>{coinsGiven}</Text>
            <Text style={s.statLabel}>Coins Given</Text>
          </View>
        </View>

        {/* ── Recent referrals ── */}
        <Text style={s.sectionTitle}>Recent Referrals</Text>
        {recent.length === 0 ? (
          <View style={s.emptyCard}>
            <Ionicons name="people-outline" size={30} color="#D1D5DB" />
            <Text style={s.emptyTxt}>No referrals yet</Text>
          </View>
        ) : (
          <View style={s.list}>
            {recent.map((r, i) => {
              const done = r.status === "completed";
              return (
                <View
                  key={r.id}
                  style={[s.row, i > 0 && { borderTopWidth: 1, borderTopColor: "#F3F4F6" }]}
                >
                  <View style={[s.rowDot, { backgroundColor: done ? GREEN : GOLD }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={s.rowName} numberOfLines={1}>
                      {r.referredName || "New user"}
                      <Text style={s.rowCode}>  · {r.code || ""}</Text>
                    </Text>
                    <Text style={s.rowMeta}>{fmtDate(r.createdAt)}</Text>
                  </View>
                  <Text style={[s.rowStatus, { color: done ? GREEN : GOLD }]}>
                    {done ? `+${r.rewardCoins || 0} 🪙` : "Pending"}
                  </Text>
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: DARK },
  loader: { justifyContent: "center", alignItems: "center", backgroundColor: GRAY1 },
  scroll: { padding: 16, paddingBottom: 40 },

  header:      { backgroundColor: DARK, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingBottom: 16 },
  backBtn:     { width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(255,255,255,0.1)", alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 18, fontWeight: "800", color: "#fff" },
  headerSub:   { fontSize: 12, color: "#94A3B8", marginTop: 2 },
  headerIcon:  { width: 44, height: 44, borderRadius: 22, backgroundColor: "rgba(255,255,255,0.08)", alignItems: "center", justifyContent: "center" },

  statusCard: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "#fff", borderRadius: 16, borderWidth: 1.5, padding: 14, gap: 10 },
  statusLeft: { flexDirection: "row", alignItems: "flex-start", gap: 10, flex: 1 },
  statusDot:  { width: 10, height: 10, borderRadius: 5, marginTop: 5 },
  statusTitle:{ fontSize: 15, fontWeight: "800", color: DARK },
  statusSub:  { fontSize: 12, color: "#6B7280", marginTop: 3, lineHeight: 17 },
  statusTime: { fontSize: 11, color: GRAY3, marginTop: 4 },

  card:      { backgroundColor: "#fff", borderRadius: 16, borderWidth: 1, borderColor: GRAY2, padding: 16, marginTop: 14 },
  cardTitle: { fontSize: 15, fontWeight: "800", color: DARK },
  cardSub:   { fontSize: 12, color: "#6B7280", marginTop: 4, lineHeight: 17 },

  inputRow:    { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 14 },
  input:       { flex: 0, minWidth: 90, backgroundColor: GRAY1, borderWidth: 1.5, borderColor: GRAY2, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, fontSize: 18, fontWeight: "800", color: DARK, textAlign: "center" },
  inputSuffix: { fontSize: 13, color: "#6B7280", fontWeight: "600" },

  presetRow:       { flexDirection: "row", gap: 8, marginTop: 12 },
  presetChip:      { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 99, backgroundColor: GRAY1, borderWidth: 1, borderColor: GRAY2 },
  presetChipActive:{ backgroundColor: DARK, borderColor: DARK },
  presetTxt:       { fontSize: 13, fontWeight: "700", color: "#6B7280" },
  presetTxtActive: { color: "#fff" },

  saveBtn:    { backgroundColor: DARK, borderRadius: 12, paddingVertical: 13, alignItems: "center", marginTop: 16 },
  saveBtnTxt: { color: "#fff", fontWeight: "800", fontSize: 14 },

  statsRow: { flexDirection: "row", gap: 8, marginTop: 14 },
  statBox:  { flex: 1, backgroundColor: "#fff", borderRadius: 14, borderWidth: 1, borderColor: GRAY2, paddingVertical: 12, alignItems: "center" },
  statNum:  { fontSize: 18, fontWeight: "800", color: DARK },
  statLabel:{ fontSize: 10, color: GRAY3, fontWeight: "700", marginTop: 2 },

  sectionTitle: { fontSize: 15, fontWeight: "800", color: DARK, marginTop: 22, marginBottom: 10 },

  emptyCard: { backgroundColor: "#fff", borderRadius: 16, borderWidth: 1, borderColor: GRAY2, alignItems: "center", paddingVertical: 26 },
  emptyTxt:  { fontSize: 13, color: GRAY3, marginTop: 8, fontWeight: "600" },

  list:     { backgroundColor: "#fff", borderRadius: 16, borderWidth: 1, borderColor: GRAY2, overflow: "hidden" },
  row:      { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 12 },
  rowDot:   { width: 8, height: 8, borderRadius: 4 },
  rowName:  { fontSize: 13, fontWeight: "700", color: DARK },
  rowCode:  { fontSize: 11, fontWeight: "600", color: GRAY3 },
  rowMeta:  { fontSize: 11, color: GRAY3, marginTop: 2 },
  rowStatus:{ fontSize: 13, fontWeight: "800" },
});
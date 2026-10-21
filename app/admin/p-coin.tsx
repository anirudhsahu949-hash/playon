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
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useEffect, useState } from "react";
import { auth, db } from "../../firebaseConfig";
import { doc, getDoc, collection, query, orderBy, limit, getDocs } from "firebase/firestore";
import { getIdToken } from "firebase/auth";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

// ── Config ────────────────────────────────────────────────────────────────────
const SERVER_URL = "https://bookora-backend-95u4.onrender.com";
const DARK   = "#0B1220";
const ACCENT = "#7C3AED"; // purple — PCoin brand color
const ACCENT_LT = "#EDE9FE";
const GREEN  = "#16A34A";
const RED    = "#DC2626";
const GRAY1  = "#F9FAFB";
const GRAY2  = "#E5E7EB";
const GRAY3  = "#9CA3AF";

// ── Types ─────────────────────────────────────────────────────────────────────
type LedgerEntry = {
  id: string;
  uid: string;
  type: string;
  coins: number;
  turfName?: string;
  bookingId?: string;
  createdAt?: any;
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtDate(ts: any): string {
  if (!ts) return "—";
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function ledgerLabel(type: string): { label: string; color: string; sign: string } {
  switch (type) {
    case "pcoin_earn":          return { label: "Earned",   color: GREEN,  sign: "+" };
    case "pcoin_earn_pending":  return { label: "Pending",  color: "#B45309", sign: "+" };
    case "pcoin_earn_reversed": return { label: "Reversed", color: RED,    sign: "-" };
    case "pcoin_redeem":        return { label: "Used",     color: RED,    sign: "-" };
    case "pcoin_redeem_reversed": return { label: "Refunded (booking cancelled)", color: GREEN, sign: "+" };
    default:                    return { label: type,       color: GRAY3,  sign: "·" };
  }
}

// ── Main Screen ───────────────────────────────────────────────────────────────
export default function PcoinAdminScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [loading,    setLoading]    = useState(true);
  const [saving,     setSaving]     = useState(false);

  // Current config
  const [ratePerHour, setRatePerHour] = useState<string>("");
  const [enabled,     setEnabled]     = useState<boolean>(true);
  const [lastUpdated, setLastUpdated] = useState<string>("");

  // Stats
  const [totalPending,  setTotalPending]  = useState<number>(0);
  const [totalCredited, setTotalCredited] = useState<number>(0);
  const [totalRedeemed, setTotalRedeemed] = useState<number>(0);

  // Recent ledger
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);

  // ── Fetch current config + stats ──────────────────────────────────────────
  useEffect(() => { fetchAll(); }, []);

  const fetchAll = async () => {
    setLoading(true);
    try {
      // 1. PCoin config
      const configSnap = await getDoc(doc(db, "settings", "pcoinConfig"));
      if (configSnap.exists()) {
        const d = configSnap.data();
        setRatePerHour(String(d.ratePerHour || 0));
        setEnabled(d.enabled !== false);
        if (d.updatedAt?.toDate) {
          setLastUpdated(d.updatedAt.toDate().toLocaleString("en-IN", {
            day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
          }));
        }
      } else {
        setRatePerHour("10");
        setEnabled(true);
      }

      // 2. Recent ledger entries
      const ledgerSnap = await getDocs(
        query(collection(db, "pcoinLedger"), orderBy("createdAt", "desc"), limit(20))
      );
      const entries = ledgerSnap.docs.map(d => ({ id: d.id, ...d.data() } as LedgerEntry));
      setLedger(entries);

      // 3. Stats — aggregate from ledger
      let pending  = 0;
      let credited = 0;
      let redeemed = 0;
      entries.forEach(e => {
        if (e.type === "pcoin_earn_pending")  pending  += e.coins;
        if (e.type === "pcoin_earn")          credited += e.coins;
        if (e.type === "pcoin_redeem")        redeemed += e.coins;
      });
      setTotalPending(pending);
      setTotalCredited(credited);
      setTotalRedeemed(redeemed);

    } catch (e) {
      Alert.alert("Error", "Could not load PCoin config.");
    } finally {
      setLoading(false);
    }
  };

  // ── Save config ───────────────────────────────────────────────────────────
  const handleSave = async () => {
    const rate = Number(ratePerHour);
    if (isNaN(rate) || rate < 0) {
      Alert.alert("Invalid", "Rate must be 0 or more.");
      return;
    }
    if (rate > 1000) {
      Alert.alert("Too High", "Rate cannot exceed 1000 coins per hour.");
      return;
    }

    setSaving(true);
    try {
      const user  = auth.currentUser;
      if (!user) throw new Error("Not logged in.");
      const token = await getIdToken(user);

      const res = await fetch(`${SERVER_URL}/admin/pcoin-config`, {
        method:  "POST",
        headers: {
          "Content-Type":  "application/json",
          "Authorization": `Bearer ${token}`,
        },
        body: JSON.stringify({ ratePerHour: rate, enabled }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "Save failed");

      Alert.alert(
        "Saved ✓",
        enabled
          ? `PCoin rate: ${rate} coins per hour${rate === 0 ? " (no coins will be earned)" : ""}`
          : "PCoin disabled — users will not earn coins"
      );
      await fetchAll();
    } catch (e: any) {
      Alert.alert("Error", e.message || "Could not save.");
    } finally {
      setSaving(false);
    }
  };

  // ── Loading ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <SafeAreaView style={s.safe}>
        <StatusBar barStyle="light-content" backgroundColor={DARK} />
        <View style={s.loader}>
          <ActivityIndicator size="large" color={ACCENT} />
        </View>
      </SafeAreaView>
    );
  }

  const rate = Number(ratePerHour) || 0;

  return (
         <View style={[s.safe, { backgroundColor: GRAY1 }]}>
  <StatusBar barStyle="light-content" backgroundColor={DARK} />

  {/* ── HEADER ── */}
  <View style={[s.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn} hitSlop={10}>
          <Ionicons name="chevron-back" size={22} color="#fff" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={s.headerTitle}>PCoin Control</Text>
          <Text style={s.headerSub}>Admin · Playon Coin Settings</Text>
        </View>
        <View style={s.headerIcon}>
          <Text style={{ fontSize: 24 }}>🪙</Text>
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.scroll}>

        {/* ── STATUS CARD ── */}
        <View style={[s.statusCard, { borderColor: enabled ? ACCENT + "40" : GRAY2 }]}>
          <View style={s.statusLeft}>
            <View style={[s.statusDot, { backgroundColor: enabled ? ACCENT : GRAY3 }]} />
            <View>
              <Text style={s.statusTitle}>
                PCoin is {enabled ? "Active" : "Disabled"}
              </Text>
              <Text style={s.statusSub}>
                {enabled
                  ? `Users earn ${rate} coin${rate !== 1 ? "s" : ""} per hour booked`
                  : "No coins are being earned by users"
                }
              </Text>
              {!!lastUpdated && (
                <Text style={s.statusTime}>Last updated: {lastUpdated}</Text>
              )}
            </View>
          </View>
          <Switch
            value={enabled}
            onValueChange={setEnabled}
            trackColor={{ false: GRAY2, true: ACCENT + "80" }}
            thumbColor={enabled ? ACCENT : "#fff"}
          />
        </View>

        {/* ── STATS ROW ── */}
        <View style={s.statsRow}>
          {[
            { label: "Pending",  value: totalPending,  color: "#B45309", bg: "#FEF3C7" },
            { label: "Credited", value: totalCredited, color: GREEN,     bg: "#DCFCE7" },
            { label: "Redeemed", value: totalRedeemed, color: RED,       bg: "#FEE2E2" },
          ].map(st => (
            <View key={st.label} style={[s.statCard, { borderColor: st.bg }]}>
              <View style={[s.statBg, { backgroundColor: st.bg }]}>
                <Text style={[s.statVal, { color: st.color }]}>{st.value}</Text>
              </View>
              <Text style={s.statLbl}>{st.label}</Text>
            </View>
          ))}
        </View>

        {/* ── RATE SETTING ── */}
        <View style={s.card}>
          <Text style={s.cardTitle}>Coin Rate</Text>
          <Text style={s.cardSub}>
            How many PCoin a user earns per hour of booking
          </Text>

          {/* Rate input */}
          <View style={s.rateRow}>
            <View style={s.rateInputWrap}>
              <Text style={s.ratePrefix}>🪙</Text>
              <TextInput
                style={s.rateInput}
                value={ratePerHour}
                onChangeText={v => setRatePerHour(v.replace(/[^0-9]/g, ""))}
                keyboardType="number-pad"
                placeholder="10"
                placeholderTextColor={GRAY3}
                maxLength={4}
              />
            </View>
            <View style={s.rateLabel}>
              <Text style={s.rateLabelTxt}>coins</Text>
              <Text style={s.rateLabelSub}>per hour</Text>
            </View>
          </View>

          {/* Live preview */}
          {rate > 0 && enabled && (
            <View style={s.previewBox}>
              <Text style={s.previewTitle}>Preview — what users will earn</Text>
              <View style={s.previewGrid}>
                {[1, 2, 3].map(hrs => (
                  <View key={hrs} style={s.previewItem}>
                    <Text style={s.previewHrs}>{hrs} hr</Text>
                    <Text style={s.previewCoins}>
                      {rate * hrs} 🪙
                    </Text>
                    <Text style={s.previewWorth}>= ₹{rate * hrs} off</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {rate === 0 && enabled && (
            <View style={s.warningBox}>
              <Ionicons name="warning-outline" size={16} color="#B45309" />
              <Text style={s.warningTxt}>
                Rate is 0 — users will not earn any coins even though PCoin is enabled
              </Text>
            </View>
          )}

          {!enabled && (
            <View style={[s.warningBox, { backgroundColor: "#FEF2F2", borderColor: "#FECACA" }]}>
              <Ionicons name="close-circle-outline" size={16} color={RED} />
              <Text style={[s.warningTxt, { color: RED }]}>
                PCoin is disabled — toggle ON above to start earning
              </Text>
            </View>
          )}

          {/* Save button */}
          <TouchableOpacity
            style={[s.saveBtn, saving && { opacity: 0.6 }]}
            onPress={handleSave}
            disabled={saving}
            activeOpacity={0.85}
          >
            {saving
              ? <ActivityIndicator color="#fff" size="small" />
              : <>
                  <Ionicons name="save-outline" size={16} color="#fff" />
                  <Text style={s.saveBtnTxt}>Save Changes</Text>
                </>
            }
          </TouchableOpacity>
        </View>

        {/* ── HOW IT WORKS ── */}
        <View style={s.card}>
          <Text style={s.cardTitle}>How PCoin Works</Text>
          <View style={s.howRow}>
            <View style={s.howStep}>
              <Text style={s.howNum}>1</Text>
              <Text style={s.howTxt}>User books any turf</Text>
            </View>
            <Ionicons name="arrow-forward" size={14} color={GRAY3} />
            <View style={s.howStep}>
              <Text style={s.howNum}>2</Text>
              <Text style={s.howTxt}>Coins go pending</Text>
            </View>
            <Ionicons name="arrow-forward" size={14} color={GRAY3} />
            <View style={s.howStep}>
              <Text style={s.howNum}>3</Text>
              <Text style={s.howTxt}>Slot ends → credited</Text>
            </View>
            <Ionicons name="arrow-forward" size={14} color={GRAY3} />
            <View style={s.howStep}>
              <Text style={s.howNum}>4</Text>
              <Text style={s.howTxt}>Use on next booking</Text>
            </View>
          </View>
          <View style={[s.warningBox, { backgroundColor: ACCENT_LT, borderColor: ACCENT + "40", marginTop: 12 }]}>
            <Ionicons name="information-circle-outline" size={15} color={ACCENT} />
            <Text style={[s.warningTxt, { color: ACCENT }]}>
              1 PCoin = ₹1 discount on any turf · Cancelled bookings earn no coins
            </Text>
          </View>
        </View>

        {/* ── RECENT LEDGER ── */}
        <View style={s.card}>
          <View style={s.cardHeaderRow}>
            <Text style={s.cardTitle}>Recent Transactions</Text>
            <TouchableOpacity onPress={fetchAll}>
              <Ionicons name="refresh-outline" size={18} color={GRAY3} />
            </TouchableOpacity>
          </View>

          {ledger.length === 0 ? (
            <View style={s.emptyLedger}>
              <Text style={{ fontSize: 28, marginBottom: 6 }}>🪙</Text>
              <Text style={s.emptyTxt}>No transactions yet</Text>
              <Text style={s.emptySub}>Coin activity will appear here after bookings</Text>
            </View>
          ) : (
            ledger.map((entry, idx) => {
              const meta = ledgerLabel(entry.type);
              return (
                <View key={entry.id}>
                  <View style={s.ledgerRow}>
                    <View style={[s.ledgerDot, {
                      backgroundColor: meta.color === GREEN ? "#DCFCE7"
                        : meta.color === RED ? "#FEE2E2" : "#FEF3C7"
                    }]}>
                      <Ionicons
                        name={meta.sign === "+" ? "arrow-down-outline" : "arrow-up-outline"}
                        size={13}
                        color={meta.color}
                      />
                    </View>
                    <View style={{ flex: 1, marginLeft: 10 }}>
                      <View style={s.ledgerTop}>
                        <Text style={s.ledgerLabel}>{meta.label}</Text>
                        <Text style={[s.ledgerCoins, { color: meta.color }]}>
                          {meta.sign}{entry.coins} 🪙
                        </Text>
                      </View>
                      {!!entry.turfName && (
                        <Text style={s.ledgerTurf}>🏟 {entry.turfName}</Text>
                      )}
                      <Text style={s.ledgerTime}>{fmtDate(entry.createdAt)}</Text>
                    </View>
                  </View>
                  {idx < ledger.length - 1 && <View style={s.divider} />}
                </View>
              );
            })
          )}
        </View>

        <View style={{ height: 32 }} />
      </ScrollView>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: "#F5F6FA" },
  loader: { flex: 1, justifyContent: "center", alignItems: "center" },
  scroll: { paddingHorizontal: 16, paddingBottom: 24 },

  // Header
 header: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: DARK,
    paddingHorizontal: 16,
    paddingBottom: 18,
    marginTop: 0,
  },
  safe: { flex: 1, backgroundColor: "#F5F6FA" },
  backBtn:    { width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(255,255,255,0.1)", justifyContent: "center", alignItems: "center" },
  headerTitle:{ color: "#fff", fontSize: 20, fontWeight: "900" },
  headerSub:  { color: "#9DB3C3", fontSize: 12, fontWeight: "600", marginTop: 2 },
  headerIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: ACCENT_LT, justifyContent: "center", alignItems: "center" },

  // Status card
  statusCard: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    backgroundColor: "#fff", borderRadius: 16, borderWidth: 1.5,
    padding: 16, marginTop: 16,
    shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  statusLeft:  { flexDirection: "row", alignItems: "flex-start", gap: 12, flex: 1 },
  statusDot:   { width: 10, height: 10, borderRadius: 5, marginTop: 4 },
  statusTitle: { fontSize: 15, fontWeight: "800", color: DARK },
  statusSub:   { fontSize: 12, color: "#6B7280", marginTop: 3, lineHeight: 17 },
  statusTime:  { fontSize: 10, color: "#9CA3AF", marginTop: 4, fontWeight: "600" },

  // Stats
  statsRow: { flexDirection: "row", gap: 10, marginTop: 12 },
  statCard: {
    flex: 1, borderRadius: 14, borderWidth: 1.5,
    overflow: "hidden", alignItems: "center",
    backgroundColor: "#fff",
  },
  statBg:  { width: "100%", alignItems: "center", paddingVertical: 10 },
  statVal: { fontSize: 22, fontWeight: "900" },
  statLbl: { fontSize: 10, color: GRAY3, fontWeight: "700", textTransform: "uppercase", paddingVertical: 6 },

  // Card
  card: {
    backgroundColor: "#fff", borderRadius: 18, borderWidth: 1, borderColor: GRAY2,
    padding: 18, marginTop: 14,
    shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  cardTitle:     { fontSize: 16, fontWeight: "900", color: DARK, marginBottom: 4 },
  cardSub:       { fontSize: 12, color: GRAY3, fontWeight: "600", marginBottom: 16 },
  cardHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 },

  // Rate input
  rateRow:      { flexDirection: "row", alignItems: "center", gap: 16, marginBottom: 16 },
  rateInputWrap:{ flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: GRAY1, borderRadius: 14, borderWidth: 1.5, borderColor: GRAY2, paddingHorizontal: 14, paddingVertical: 12, flex: 1 },
  ratePrefix:   { fontSize: 20 },
  rateInput:    { fontSize: 28, fontWeight: "900", color: DARK, flex: 1, padding: 0 },
  rateLabel:    { alignItems: "center" },
  rateLabelTxt: { fontSize: 16, fontWeight: "800", color: DARK },
  rateLabelSub: { fontSize: 12, color: GRAY3, fontWeight: "600" },

  // Preview
  previewBox:   { backgroundColor: ACCENT_LT, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: ACCENT + "30", marginBottom: 16 },
  previewTitle: { fontSize: 11, fontWeight: "800", color: ACCENT, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 12 },
  previewGrid:  { flexDirection: "row", justifyContent: "space-around" },
  previewItem:  { alignItems: "center", gap: 4 },
  previewHrs:   { fontSize: 12, color: "#6B7280", fontWeight: "700" },
  previewCoins: { fontSize: 18, fontWeight: "900", color: ACCENT },
  previewWorth: { fontSize: 10, color: "#6B7280", fontWeight: "600" },

  // Warning
  warningBox: {
    flexDirection: "row", alignItems: "flex-start", gap: 8,
    backgroundColor: "#FFFBEB", borderRadius: 10, borderWidth: 1, borderColor: "#FDE68A",
    padding: 10, marginBottom: 16,
  },
  warningTxt: { fontSize: 12, color: "#B45309", fontWeight: "600", flex: 1, lineHeight: 17 },

  // Save button
  saveBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: ACCENT, borderRadius: 14, paddingVertical: 14,
  },
  saveBtnTxt: { color: "#fff", fontWeight: "800", fontSize: 15 },

  // How it works
  howRow:  { flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 4 },
  howStep: { alignItems: "center", gap: 4 },
  howNum:  { width: 24, height: 24, borderRadius: 12, backgroundColor: ACCENT_LT, textAlign: "center", lineHeight: 24, fontSize: 12, fontWeight: "900", color: ACCENT, overflow: "hidden" },
  howTxt:  { fontSize: 9, color: GRAY3, fontWeight: "700", textAlign: "center", maxWidth: 56 },

  // Ledger
  ledgerRow:   { flexDirection: "row", alignItems: "center", paddingVertical: 10 },
  ledgerDot:   { width: 32, height: 32, borderRadius: 10, justifyContent: "center", alignItems: "center" },
  ledgerTop:   { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  ledgerLabel: { fontSize: 13, fontWeight: "700", color: DARK },
  ledgerCoins: { fontSize: 14, fontWeight: "900" },
  ledgerTurf:  { fontSize: 11, color: "#6B7280", marginTop: 2 },
  ledgerTime:  { fontSize: 10, color: GRAY3, marginTop: 2 },
  divider:     { height: 1, backgroundColor: "#F3F4F6" },

  emptyLedger: { alignItems: "center", paddingVertical: 24 },
  emptyTxt:    { fontSize: 14, fontWeight: "700", color: DARK },
  emptySub:    { fontSize: 12, color: GRAY3, marginTop: 4, textAlign: "center" },
});
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  Alert,
  ActivityIndicator,
  Platform,
  ScrollView,
  Switch,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { useEffect, useState } from "react";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { db, auth } from "../../firebaseConfig";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";

// =======================================================
// 🛡️ ADMIN — PLAYER PROFILE CONFIG
// Controls the Playon ID creation fee & feature toggle.
//
// Writes to:  appConfig/playerProfile
//   { fee, enabled, updatedAt, updatedBy }
//
// fee = 0  → free creation (no Razorpay, direct Firestore write)
// fee > 0  → Razorpay payment gate
// enabled  → false hides the entire Playon Pro card for users
// =======================================================

const DARK  = "#0A0F1E";
const GREEN = "#16A34A";

export default function PlayerProfileConfig() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [loading,     setLoading]     = useState(true);
  const [saving,      setSaving]      = useState(false);
  const [fee,         setFee]         = useState("0");
  const [enabled,     setEnabled]     = useState(true);
  const [currentFee,  setCurrentFee]  = useState(0);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  useEffect(() => { loadConfig(); }, []);

  const loadConfig = async () => {
    try {
      setLoading(true);
      const snap = await getDoc(doc(db, "appConfig", "playerProfile"));
      if (snap.exists()) {
        const d = snap.data();
        const f = Number(d?.fee ?? 0);
        setFee(String(f));
        setCurrentFee(f);
        setEnabled(d?.enabled !== false);
        if (d?.updatedAt?.toDate) setLastUpdated(d.updatedAt.toDate());
      }
    } catch {
      Alert.alert("Error", "Could not load current settings.");
    } finally {
      setLoading(false);
    }
  };

  const saveConfig = async () => {
    const feeVal = parseInt(fee, 10);
    if (isNaN(feeVal) || feeVal < 0) {
      Alert.alert("Invalid fee", "Enter 0 for free, or a positive number for paid."); return;
    }

    const feeLabel  = feeVal === 0 ? "free" : `₹${feeVal.toLocaleString("en-IN")} (paid via Razorpay)`;
    const gateLabel = enabled ? "visible" : "hidden";

    Alert.alert(
      "Confirm Change",
      `Set Playon ID creation to:\n• Fee: ${feeLabel}\n• Feature: ${gateLabel}\n\nApplies immediately for all users.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Save",
          onPress: async () => {
            try {
              setSaving(true);
              await setDoc(doc(db, "appConfig", "playerProfile"), {
                fee:       feeVal,
                enabled,
                updatedAt: serverTimestamp(),
                updatedBy: auth.currentUser?.uid || "admin",
              }, { merge: true });

              setCurrentFee(feeVal);
              setLastUpdated(new Date());
              Alert.alert(
                "✅ Saved",
                feeVal === 0
                  ? "Playon ID creation is now free."
                  : `Playon ID creation now costs ₹${feeVal.toLocaleString("en-IN")}.`
              );
            } catch (e: any) {
              Alert.alert("Error", e.message || "Could not save. Try again.");
            } finally {
              setSaving(false);
            }
          },
        },
      ]
    );
  };

  // ── Quick presets ─────────────────────────────────────────────────────────
  const PRESETS = [
    { label: "Free", value: "0" },
    { label: "₹29",  value: "29"  },
    { label: "₹49",  value: "49"  },
    { label: "₹99",  value: "99"  },
    { label: "₹199", value: "199" },
  ];

  if (loading) {
    return (
      <SafeAreaView style={s.safe}>
        <StatusBar barStyle="light-content" backgroundColor={DARK} />
        <View style={s.center}>
          <ActivityIndicator size="large" color={GREEN} />
          <Text style={s.loadTxt}>Loading config…</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <View style={s.safe}>
      <StatusBar barStyle="light-content" backgroundColor={DARK} />

      {/* Header */}
       <View style={[s.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity style={s.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={20} color="#fff" />
        </TouchableOpacity>
        <View>
          <Text style={s.headerTitle}>Player Profile Config</Text>
          <Text style={s.headerSub}>Playon ID creation fee &amp; settings</Text>
        </View>
        <View style={s.headerIcon}>
          <Ionicons name="id-card-outline" size={28} color={GREEN} />
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ padding: 16, paddingBottom: 48 }}
      >
        {/* Current state banner */}
        <View style={s.statBanner}>
          <View style={s.statBox}>
            <Text style={[s.statVal, { color: currentFee === 0 ? GREEN : "#F59E0B" }]}>
              {currentFee === 0 ? "FREE" : `₹${currentFee.toLocaleString("en-IN")}`}
            </Text>
            <Text style={s.statLbl}>Current fee</Text>
          </View>
          <View style={s.statDivider} />
          <View style={s.statBox}>
            <Text style={[s.statVal, { color: enabled ? GREEN : "#EF4444" }]}>
              {enabled ? "ON" : "OFF"}
            </Text>
            <Text style={s.statLbl}>Feature status</Text>
          </View>
          {lastUpdated && (
            <>
              <View style={s.statDivider} />
              <View style={s.statBox}>
                <Text style={[s.statVal, { fontSize: 11, color: "#9CA3AF" }]}>
                  {lastUpdated.toLocaleDateString("en-IN")}
                </Text>
                <Text style={s.statLbl}>Last updated</Text>
              </View>
            </>
          )}
        </View>

        {/* Feature toggle */}
        <View style={s.card}>
          <View style={s.cardRow}>
            <View>
              <Text style={s.cardTitle}>Show Playon Pro Card</Text>
              <Text style={s.cardSub}>
                When off, the entire "Create Playon ID" section is hidden from users.
              </Text>
            </View>
            <Switch
              value={enabled}
              onValueChange={setEnabled}
              trackColor={{ false: "#E5E7EB", true: "#BBF7D0" }}
              thumbColor={enabled ? GREEN : "#9CA3AF"}
            />
          </View>
        </View>

        {/* Fee input */}
        <View style={s.card}>
          <Text style={s.cardTitle}>Creation Fee (₹)</Text>
          <Text style={s.cardSub}>
            Set to 0 for free creation. Any amount above 0 will trigger a Razorpay payment before the profile is created.
          </Text>

          {/* Quick presets */}
          <View style={s.presetRow}>
            {PRESETS.map((p) => (
              <TouchableOpacity
                key={p.value}
                style={[s.presetBtn, fee === p.value && s.presetBtnActive]}
                onPress={() => setFee(p.value)}
              >
                <Text style={[s.presetTxt, fee === p.value && s.presetTxtActive]}>
                  {p.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={s.inputRow}>
            <Text style={s.rupeeSign}>₹</Text>
            <TextInput
              style={s.input}
              value={fee}
              onChangeText={(v) => setFee(v.replace(/[^0-9]/g, ""))}
              keyboardType="numeric"
              placeholder="0"
              placeholderTextColor="#9CA3AF"
            />
          </View>

          {/* Explanation */}
          <View style={[
            s.explainBox,
            parseInt(fee, 10) === 0
              ? { backgroundColor: "#F0FDF4", borderColor: "#BBF7D0" }
              : { backgroundColor: "#FFFBEB", borderColor: "#FDE68A" }
          ]}>
            <Ionicons
              name={parseInt(fee, 10) === 0 ? "checkmark-circle-outline" : "card-outline"}
              size={16}
              color={parseInt(fee, 10) === 0 ? GREEN : "#D97706"}
            />
            <Text style={[
              s.explainTxt,
              { color: parseInt(fee, 10) === 0 ? "#15803D" : "#92400E" }
            ]}>
              {parseInt(fee, 10) === 0
                ? "Users can create their Playon ID for free. No Razorpay involved."
                : `Users will pay ₹${parseInt(fee, 10).toLocaleString("en-IN")} via Razorpay before their profile is created. Payment is non-refundable.`
              }
            </Text>
          </View>
        </View>

        {/* How it works */}
        <View style={s.card}>
          <Text style={s.cardTitle}>How it works</Text>
          {[
            { icon: "person-add-outline",    text: "User opens their Profile tab" },
            { icon: "flash-outline",         text: "Sees the Playon Pro unlock card" },
            { icon: "card-outline",          text: "Pays the fee (or creates free if ₹0)" },
            { icon: "id-card-outline",       text: "Gets a unique @PlayonID" },
            { icon: "trophy-outline",        text: "League stats + history tracked automatically" },
          ].map((row, i) => (
            <View key={i} style={s.howRow}>
              <View style={s.howNum}>
                <Text style={s.howNumTxt}>{i + 1}</Text>
              </View>
              <Ionicons name={row.icon as any} size={16} color={GREEN} style={{ marginRight: 8 }} />
              <Text style={s.howTxt}>{row.text}</Text>
            </View>
          ))}
        </View>

        {/* Save button */}
        <TouchableOpacity
          style={[s.saveBtn, saving && { opacity: 0.6 }]}
          onPress={saveConfig}
          disabled={saving}
          activeOpacity={0.85}
        >
          {saving
            ? <ActivityIndicator color="#fff" />
            : <>
                <Ionicons name="save-outline" size={18} color="#fff" />
                <Text style={s.saveTxt}>Save Config</Text>
              </>
          }
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: DARK },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  loadTxt: { color: "#9CA3AF", marginTop: 10 },

  header: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingBottom: 16, paddingHorizontal: 16,
    backgroundColor: DARK,
  },
  backBtn: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: "rgba(255,255,255,0.08)",
    alignItems: "center", justifyContent: "center",
  },
  headerTitle: { fontSize: 17, fontWeight: "800", color: "#fff" },
  headerSub:   { fontSize: 12, color: "#9CA3AF", marginTop: 1 },
  headerIcon:  { marginLeft: "auto" },

  statBanner: {
    flexDirection: "row", backgroundColor: "#fff",
    borderRadius: 14, padding: 16, marginBottom: 14,
    alignItems: "center",
  },
  statBox:     { flex: 1, alignItems: "center" },
  statVal:     { fontSize: 18, fontWeight: "900", color: DARK },
  statLbl:     { fontSize: 11, color: "#9CA3AF", marginTop: 2 },
  statDivider: { width: 1, height: 32, backgroundColor: "#F3F4F6" },

  card: {
    backgroundColor: "#fff", borderRadius: 14,
    padding: 16, marginBottom: 14,
  },
  cardRow:   { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  cardTitle: { fontSize: 14, fontWeight: "800", color: DARK, marginBottom: 4 },
  cardSub:   { fontSize: 12, color: "#6B7280", lineHeight: 17, flex: 1, marginRight: 12 },

  presetRow: { flexDirection: "row", gap: 8, flexWrap: "wrap", marginTop: 12, marginBottom: 12 },
  presetBtn: {
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: 20, borderWidth: 1.5, borderColor: "#E5E7EB",
    backgroundColor: "#F9FAFB",
  },
  presetBtnActive: { backgroundColor: "#DCFCE7", borderColor: GREEN },
  presetTxt:       { fontSize: 13, fontWeight: "600", color: "#6B7280" },
  presetTxtActive: { color: "#15803D", fontWeight: "800" },

  inputRow: {
    flexDirection: "row", alignItems: "center", gap: 8,
    marginBottom: 12,
  },
  rupeeSign: { fontSize: 20, fontWeight: "700", color: DARK },
  input: {
    flex: 1, height: 52, backgroundColor: "#F9FAFB",
    borderColor: "#E5E7EB", borderWidth: 1.5, borderRadius: 12,
    paddingHorizontal: 16, fontSize: 24, fontWeight: "800", color: DARK,
  },

  explainBox: {
    flexDirection: "row", alignItems: "flex-start", gap: 8,
    borderWidth: 1, borderRadius: 10, padding: 10,
  },
  explainTxt: { flex: 1, fontSize: 12, lineHeight: 18, fontWeight: "500" },

  howRow:   { flexDirection: "row", alignItems: "center", paddingVertical: 7 },
  howNum:   {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: "#F0FDF4", alignItems: "center", justifyContent: "center",
    marginRight: 8,
  },
  howNumTxt: { fontSize: 11, fontWeight: "800", color: GREEN },
  howTxt:    { fontSize: 13, color: "#374151" },

  saveBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, backgroundColor: GREEN, borderRadius: 14,
    paddingVertical: 16, marginTop: 4,
  },
  saveTxt: { fontSize: 15, fontWeight: "800", color: "#fff" },
});
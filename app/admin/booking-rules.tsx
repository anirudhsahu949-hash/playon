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
} from "react-native";
import { useEffect, useState } from "react";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { db, auth } from "../../firebaseConfig";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";

const BRAND = "#0B1220";
const GREEN = "#16A34A";

export default function BookingRulesAdmin() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [cancelHours, setCancelHours] = useState("2");
  const [currentValue, setCurrentValue] = useState(2);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    try {
      setLoading(true);
      const snap = await getDoc(doc(db, "appConfig", "booking"));
      if (snap.exists()) {
        const data = snap.data();
        const hours = Number(data?.cancellationWindowHours ?? 2);
        setCancelHours(String(hours));
        setCurrentValue(hours);
        if (data?.updatedAt?.toDate) {
          setLastUpdated(data.updatedAt.toDate());
        }
      }
    } catch (e) {
      Alert.alert("Error", "Could not load current settings.");
    } finally {
      setLoading(false);
    }
  };

  const saveConfig = async () => {
    const value = parseFloat(cancelHours);

    // Validation
    if (isNaN(value)) {
      Alert.alert("Invalid Value", "Please enter a valid number.");
      return;
    }
    if (value < 0 || value > 24) {
      Alert.alert(
        "Out of Range",
        "Cancellation window must be between 0 and 24 hours.\n\n0 = No cancellation allowed\n24 = Must cancel 1 day before"
      );
      return;
    }

    Alert.alert(
      "Confirm Change",
      `Set cancellation window to ${value} ${value === 1 ? "hour" : "hours"}?\n\nThis affects ALL turfs and applies immediately.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Save",
          onPress: async () => {
            try {
              setSaving(true);
              await setDoc(doc(db, "appConfig", "booking"), {
                cancellationWindowHours: value,
                updatedAt: serverTimestamp(),
                updatedBy: auth.currentUser?.uid || "admin",
              }, { merge: true });

              setCurrentValue(value);
              setLastUpdated(new Date());
              Alert.alert("✅ Saved", `Cancellation window is now ${value} hours.`);
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

  // Quick preset buttons for common scenarios
  const applyPreset = (hours: number) => {
    setCancelHours(String(hours));
  };

  if (loading) {
    return (
      <SafeAreaView style={s.center}>
        <ActivityIndicator size="large" color={BRAND} />
        <Text style={s.loadingTxt}>Loading settings...</Text>
      </SafeAreaView>
    );
  }

  const hasChanges = parseFloat(cancelHours) !== currentValue;

  return (
    <View style={s.root}>
      <StatusBar barStyle="dark-content" backgroundColor="#fff" />

      {/* Top bar */}
       <View style={[s.topBar, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity style={s.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={20} color={BRAND} />
        </TouchableOpacity>
        <Text style={s.topTitle}>Booking Rules</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>

        {/* Current value card */}
        <View style={s.currentCard}>
          <View style={s.currentRow}>
            <View>
              <Text style={s.currentLabel}>Currently Active</Text>
              <Text style={s.currentValue}>{currentValue} hours</Text>
            </View>
            <View style={s.currentIcon}>
              <Ionicons name="time-outline" size={28} color={GREEN} />
            </View>
          </View>
          {lastUpdated && (
            <Text style={s.lastUpdated}>
              Last updated: {lastUpdated.toLocaleString("en-IN", {
                day: "numeric", month: "short", year: "numeric",
                hour: "numeric", minute: "2-digit"
              })}
            </Text>
          )}
        </View>

        {/* Explanation */}
        <View style={s.infoBox}>
          <Ionicons name="information-circle-outline" size={16} color="#6B7280" />
          <Text style={s.infoTxt}>
            Users can cancel a booking only if their slot is more than this many hours away. Changes apply <Text style={{ fontWeight: "800" }}>instantly</Text> across all turfs.
          </Text>
        </View>

        {/* Input section */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>Set Cancellation Window</Text>
          
          <View style={s.inputRow}>
            <TextInput
              style={s.input}
              value={cancelHours}
              onChangeText={setCancelHours}
              keyboardType="numeric"
              placeholder="2"
              placeholderTextColor="#9CA3AF"
              maxLength={4}
            />
            <Text style={s.inputUnit}>hours</Text>
          </View>

          <Text style={s.helperText}>
            • <Text style={{ fontWeight: "700" }}>0</Text> = No cancellation allowed{"\n"}
            • <Text style={{ fontWeight: "700" }}>2</Text> = Default (minimum 2 hours before slot){"\n"}
            • <Text style={{ fontWeight: "700" }}>24</Text> = Must cancel 1 day before
          </Text>
        </View>

        {/* Quick presets */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>Quick Presets</Text>
          <View style={s.presetRow}>
            <TouchableOpacity 
              style={[s.presetBtn, cancelHours === "2" && s.presetBtnActive]} 
              onPress={() => applyPreset(2)}
            >
              <Text style={[s.presetTxt, cancelHours === "2" && s.presetTxtActive]}>
                ☀️ Normal
              </Text>
              <Text style={[s.presetSub, cancelHours === "2" && s.presetSubActive]}>
                2 hours
              </Text>
            </TouchableOpacity>

            <TouchableOpacity 
              style={[s.presetBtn, cancelHours === "3" && s.presetBtnActive]} 
              onPress={() => applyPreset(3)}
            >
              <Text style={[s.presetTxt, cancelHours === "3" && s.presetTxtActive]}>
                🌧️ Rainy
              </Text>
              <Text style={[s.presetSub, cancelHours === "3" && s.presetSubActive]}>
                3 hours
              </Text>
            </TouchableOpacity>

            <TouchableOpacity 
              style={[s.presetBtn, cancelHours === "6" && s.presetBtnActive]} 
              onPress={() => applyPreset(6)}
            >
              <Text style={[s.presetTxt, cancelHours === "6" && s.presetTxtActive]}>
                🌪️ Storm
              </Text>
              <Text style={[s.presetSub, cancelHours === "6" && s.presetSubActive]}>
                6 hours
              </Text>
            </TouchableOpacity>

            <TouchableOpacity 
              style={[s.presetBtn, cancelHours === "24" && s.presetBtnActive]} 
              onPress={() => applyPreset(24)}
            >
              <Text style={[s.presetTxt, cancelHours === "24" && s.presetTxtActive]}>
                🎉 Event
              </Text>
              <Text style={[s.presetSub, cancelHours === "24" && s.presetSubActive]}>
                1 day
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Warning if changed */}
        {hasChanges && (
          <View style={s.warningBox}>
            <Ionicons name="warning-outline" size={16} color="#B45309" />
            <Text style={s.warningTxt}>
              Unsaved change: {currentValue}h → {cancelHours}h
            </Text>
          </View>
        )}

        {/* Save button */}
        <TouchableOpacity
          style={[s.saveBtn, (!hasChanges || saving) && s.saveBtnDisabled]}
          onPress={saveConfig}
          disabled={!hasChanges || saving}
        >
          {saving ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <>
              <Ionicons name="checkmark-circle" size={18} color="#fff" />
              <Text style={s.saveBtnTxt}>Save Changes</Text>
            </>
          )}
        </TouchableOpacity>

      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root:       { flex: 1, backgroundColor: "#F4F6FA" },
  center:     { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#F4F6FA" },
  loadingTxt: { marginTop: 12, color: "#6B7280", fontSize: 14 },

  topBar: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, 
    paddingBottom: 12, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#F3F4F6",
  },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: "#F3F4F6", alignItems: "center", justifyContent: "center" },
  topTitle: { fontSize: 17, fontWeight: "800", color: BRAND },

  content: { padding: 16, paddingBottom: 40 },

  // Current value card
  currentCard: {
    backgroundColor: "#fff", borderRadius: 20, padding: 18, marginBottom: 14,
    borderWidth: 1, borderColor: "#E5E7EB",
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 8, elevation: 2,
  },
  currentRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  currentLabel: { fontSize: 11, color: "#9CA3AF", fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 },
  currentValue: { fontSize: 28, fontWeight: "900", color: BRAND, marginTop: 4, letterSpacing: -0.5 },
  currentIcon: { width: 50, height: 50, borderRadius: 25, backgroundColor: "#F0FDF4", alignItems: "center", justifyContent: "center" },
  lastUpdated: { fontSize: 11, color: "#9CA3AF", marginTop: 12, fontWeight: "500" },

  // Info box
  infoBox: { flexDirection: "row", alignItems: "flex-start", gap: 8, backgroundColor: "#F9FAFB", borderRadius: 12, padding: 12, marginBottom: 16 },
  infoTxt: { flex: 1, fontSize: 12, color: "#6B7280", lineHeight: 17, fontWeight: "500" },

  // Section
  section: { backgroundColor: "#fff", borderRadius: 18, padding: 16, marginBottom: 14, borderWidth: 1, borderColor: "#E5E7EB" },
  sectionTitle: { fontSize: 14, fontWeight: "800", color: BRAND, marginBottom: 12 },

  // Input
  inputRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  input: {
    flex: 1, backgroundColor: "#F9FAFB", borderWidth: 1.5, borderColor: "#E5E7EB",
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 22, fontWeight: "900", color: BRAND, textAlign: "center",
  },
  inputUnit: { fontSize: 14, fontWeight: "700", color: "#6B7280", minWidth: 50 },
  helperText: { fontSize: 12, color: "#6B7280", marginTop: 10, lineHeight: 18 },

  // Presets
  presetRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  presetBtn: {
    flex: 1, minWidth: "47%", backgroundColor: "#F9FAFB",
    borderRadius: 12, padding: 12, alignItems: "center",
    borderWidth: 1.5, borderColor: "#E5E7EB",
  },
  presetBtnActive: { backgroundColor: "#F0FDF4", borderColor: GREEN },
  presetTxt: { fontSize: 13, fontWeight: "800", color: BRAND },
  presetTxtActive: { color: GREEN },
  presetSub: { fontSize: 11, color: "#9CA3AF", marginTop: 3, fontWeight: "600" },
  presetSubActive: { color: GREEN },

  // Warning
  warningBox: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#FEF3C7", borderRadius: 12, padding: 12, marginBottom: 14, borderWidth: 1, borderColor: "#FCD34D" },
  warningTxt: { flex: 1, fontSize: 12, color: "#B45309", fontWeight: "700" },

  // Save
  saveBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: GREEN, paddingVertical: 14, borderRadius: 14,
    shadowColor: GREEN, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 8, elevation: 4,
  },
  saveBtnDisabled: { backgroundColor: "#D1D5DB", shadowOpacity: 0 },
  saveBtnTxt: { fontSize: 15, fontWeight: "800", color: "#fff" },
});
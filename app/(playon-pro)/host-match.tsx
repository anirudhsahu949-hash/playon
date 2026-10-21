import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  StatusBar,
  Platform,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { auth } from "../../firebaseConfig";
import { getIdToken } from "firebase/auth";
import { TeamBadgePicker } from "../../components/Teamavatar";

// =============================================================================
// ⚡ PLAYON — HOST A QUICK MATCH
// A standalone one-off match with no league attached — just two teams,
// a sport, and a time. Calls the /create-quick-match endpoint.
// =============================================================================

const SERVER_URL = "https://bookora-backend-95u4.onrender.com";

const GREEN   = "#16A34A";
const DARK    = "#0B1220";
const PAGE_BG = "#F0F1F5";
const GRAY    = "#9AA3B2";

const SPORTS = ["Cricket", "Football", "Basketball", "Badminton", "Volleyball"];

async function getAuthToken(): Promise<string | null> {
  try {
    const user = auth.currentUser;
    if (!user) return null;
    return await getIdToken(user);
  } catch {
    return null;
  }
}

export default function HostMatch() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [teamAName, setTeamAName] = useState("");
  const [teamBName, setTeamBName] = useState("");
  const [teamAIcon, setTeamAIcon]   = useState<string | null>(null);
  const [teamAColor, setTeamAColor] = useState<string | null>(null);
  const [teamBIcon, setTeamBIcon]   = useState<string | null>(null);
  const [teamBColor, setTeamBColor] = useState<string | null>(null);

  const [sport, setSport]         = useState<string | null>(null);
  const [date, setDate]           = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime]     = useState("");
  const [venue, setVenue]         = useState("");

  const [saving, setSaving] = useState(false);

  const handleCreate = useCallback(async () => {
    const nameA = teamAName.trim();
    const nameB = teamBName.trim();

    if (!nameA || !nameB) return Alert.alert("Both team names required", "Give each side a name.");
    if (nameA.toLowerCase() === nameB.toLowerCase()) {
      return Alert.alert("Pick different names", "A team can't play itself.");
    }
    if (!sport) return Alert.alert("Pick a sport", "Choose the sport for this match.");
    if (!date.trim()) return Alert.alert("Date required", "e.g. 30 Aug 2026");

    setSaving(true);
    try {
      const token = await getAuthToken();
      if (!token) {
        setSaving(false);
        return Alert.alert("Not signed in", "Please log in again to host a match.");
      }

      const res = await fetch(`${SERVER_URL}/create-quick-match`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          teamAName: nameA,
          teamBName: nameB,
          teamAIconName: teamAIcon,
          teamAIconColor: teamAColor,
          teamBIconName: teamBIcon,
          teamBIconColor: teamBColor,
          sport,
          date: date.trim(),
          startTime: startTime.trim(),
          endTime: endTime.trim(),
          venue: venue.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Could not create the match.");
      }

      Alert.alert("Match created! ⚡", `${nameA} vs ${nameB} is on the schedule.`, [
        {
          text: "Manage match",
          onPress: () => router.replace({ pathname: "/(playon-pro)/manage-match", params: { id: data.matchId } } as any),
        },
      ]);
    } catch (e: any) {
      Alert.alert("Couldn't create match", e.message || "Something went wrong. Try again.");
    } finally {
      setSaving(false);
    }
  }, [teamAName, teamBName, teamAIcon, teamAColor, teamBIcon, teamBColor, sport, date, startTime, endTime, venue, router]);

  return (
    <SafeAreaView style={s.safe} edges={["top"]}>
      <StatusBar barStyle="dark-content" backgroundColor={PAGE_BG} />

      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn} hitSlop={10}>
          <Ionicons name="chevron-back" size={22} color={DARK} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={s.headerTitle}>Host a Quick Match</Text>
          <Text style={s.headerSub}>No league needed — just two teams and a time</Text>
        </View>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ padding: 16, paddingBottom: 40 + insets.bottom }}
        >
          {/* Team A */}
          <Text style={s.sectionLabel}>Team A</Text>
          <Field label="Team name *">
            <TextInput
              value={teamAName}
              onChangeText={setTeamAName}
              placeholder="e.g. Warriors"
              placeholderTextColor={GRAY}
              style={s.input}
              maxLength={40}
            />
          </Field>
          <TeamBadgePicker
            iconName={teamAIcon}
            iconColor={teamAColor}
            onChange={(icon, color) => { setTeamAIcon(icon); setTeamAColor(color); }}
            previewName={teamAName || "Team A"}
          />

          {/* VS divider */}
          <View style={s.vsRow}>
            <View style={s.vsLine} />
            <Text style={s.vsTxt}>VS</Text>
            <View style={s.vsLine} />
          </View>

          {/* Team B */}
          <Text style={s.sectionLabel}>Team B</Text>
          <Field label="Team name *">
            <TextInput
              value={teamBName}
              onChangeText={setTeamBName}
              placeholder="e.g. Strikers"
              placeholderTextColor={GRAY}
              style={s.input}
              maxLength={40}
            />
          </Field>
          <TeamBadgePicker
            iconName={teamBIcon}
            iconColor={teamBColor}
            onChange={(icon, color) => { setTeamBIcon(icon); setTeamBColor(color); }}
            previewName={teamBName || "Team B"}
          />

          {/* Match details */}
          <Text style={[s.sectionLabel, { marginTop: 22 }]}>Match details</Text>

          <Text style={s.label}>Sport *</Text>
          <View style={s.chipRow}>
            {SPORTS.map((sp) => {
              const active = sp === sport;
              return (
                <TouchableOpacity
                  key={sp}
                  style={[s.chip, active && s.chipActive]}
                  onPress={() => setSport(sp)}
                  activeOpacity={0.8}
                >
                  <Text style={[s.chipTxt, active && s.chipTxtActive]}>{sp}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Field label="Date *">
            <TextInput
              value={date}
              onChangeText={setDate}
              placeholder="e.g. 30 Aug 2026"
              placeholderTextColor={GRAY}
              style={s.input}
              maxLength={30}
            />
          </Field>

          <View style={{ flexDirection: "row", gap: 12 }}>
            <View style={{ flex: 1 }}>
              <Field label="Start time">
                <TextInput
                  value={startTime}
                  onChangeText={setStartTime}
                  placeholder="4:00 PM"
                  placeholderTextColor={GRAY}
                  style={s.input}
                  maxLength={12}
                />
              </Field>
            </View>
            <View style={{ flex: 1 }}>
              <Field label="End time">
                <TextInput
                  value={endTime}
                  onChangeText={setEndTime}
                  placeholder="6:00 PM"
                  placeholderTextColor={GRAY}
                  style={s.input}
                  maxLength={12}
                />
              </Field>
            </View>
          </View>

          <Field label="Venue (optional)">
            <TextInput
              value={venue}
              onChangeText={setVenue}
              placeholder="e.g. Camp Ground"
              placeholderTextColor={GRAY}
              style={s.input}
              maxLength={60}
            />
          </Field>

          {/* Submit */}
          <TouchableOpacity
            style={[s.submitBtn, saving && { opacity: 0.7 }]}
            onPress={handleCreate}
            disabled={saving}
            activeOpacity={0.85}
          >
            {saving ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Ionicons name="flash" size={18} color="#fff" />
                <Text style={s.submitTxt}>Create Match</Text>
              </>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ── Small field wrapper ──────────────────────────────────────────────────────
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={s.label}>{label}</Text>
      {children}
    </View>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: PAGE_BG },

  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: Platform.OS === "android" ? (StatusBar.currentHeight ?? 0) + 12 : 8,
    paddingBottom: 12,
    backgroundColor: PAGE_BG,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: "center", justifyContent: "center",
    backgroundColor: "#fff",
  },
  headerTitle: { fontSize: 20, fontWeight: "800", color: DARK },
  headerSub:   { fontSize: 13, color: GRAY, marginTop: 1 },

  sectionLabel: { fontSize: 13, fontWeight: "800", color: GREEN, marginBottom: 10, letterSpacing: 0.3, textTransform: "uppercase" },

  label: { fontSize: 13, fontWeight: "700", color: DARK, marginBottom: 8 },

  input: {
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: DARK,
  },

  vsRow: { flexDirection: "row", alignItems: "center", gap: 10, marginVertical: 18 },
  vsLine: { flex: 1, height: 1, backgroundColor: "#E5E7EB" },
  vsTxt: { fontSize: 12, fontWeight: "800", color: GRAY, letterSpacing: 1 },

  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 16 },
  chip: {
    paddingHorizontal: 14, paddingVertical: 9,
    borderRadius: 20,
    backgroundColor: "#fff",
    borderWidth: 1, borderColor: "#E5E7EB",
  },
  chipActive: { backgroundColor: GREEN, borderColor: GREEN },
  chipTxt: { fontSize: 13, fontWeight: "700", color: "#6B7280" },
  chipTxtActive: { color: "#fff" },

  submitBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: GREEN,
    borderRadius: 14,
    paddingVertical: 15,
    marginTop: 8,
  },
  submitTxt: { fontSize: 15.5, fontWeight: "800", color: "#fff" },
});
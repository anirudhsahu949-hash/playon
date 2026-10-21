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

// =============================================================================
// 🏆 PLAYON — HOST A LEAGUE
// Any signed-in user can host. No admin, no league-owner account needed.
// Entry is free for every league right now — no entry-fee field is shown.
// Calls the existing /create-league endpoint (already open to role "user").
// =============================================================================

const SERVER_URL = "https://bookora-backend-95u4.onrender.com";

const GREEN   = "#16A34A";
const DARK    = "#0B1220";
const PAGE_BG = "#F0F1F5";
const GRAY    = "#9AA3B2";

const SPORTS = ["Cricket", "Football", "Basketball", "Badminton", "Volleyball"];

const FORMATS: { value: "round_robin" | "knockout" | "groups_knockout"; label: string; desc: string }[] = [
  { value: "round_robin",     label: "Round Robin",       desc: "Every team plays every other team" },
  { value: "knockout",        label: "Knockout",          desc: "Lose once, you're out" },
  { value: "groups_knockout", label: "Groups + Knockout", desc: "Group stage, then knockouts" },
];

async function getAuthToken(): Promise<string | null> {
  try {
    const user = auth.currentUser;
    if (!user) return null;
    return await getIdToken(user);
  } catch {
    return null;
  }
}

export default function HostLeague() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [name, setName]               = useState("");
  const [sport, setSport]              = useState<string | null>(null);
  const [format, setFormat]            = useState<typeof FORMATS[number]["value"] | null>(null);
  const [city, setCity]                = useState("");
  const [venue, setVenue]              = useState("");
  const [description, setDescription]  = useState("");
  const [startDate, setStartDate]      = useState("");

  // hostType: "managed" = you add all teams yourself. "open" = anyone can register.
  const [hostType, setHostType]              = useState<"managed" | "open">("managed");
  const [maxTeams, setMaxTeams]              = useState("");
  const [registrationDeadline, setRegistrationDeadline] = useState("");

  const [saving, setSaving] = useState(false);

  const handleCreate = useCallback(async () => {
    const cleanName = name.trim();
    const cleanCity = city.trim();

    if (!cleanName) return Alert.alert("League name required", "Give your league a name.");
    if (!sport) return Alert.alert("Pick a sport", "Choose which sport this league is for.");
    if (!format) return Alert.alert("Pick a format", "Choose how the league will be structured.");
    if (!cleanCity) return Alert.alert("City required", "Tell players which city this league is in.");
    if (!startDate.trim()) return Alert.alert("Start date required", "e.g. 30 Aug 2026");

    let teamsNum = 0;
    if (hostType === "open") {
      teamsNum = Number(maxTeams);
      if (!maxTeams.trim() || isNaN(teamsNum) || teamsNum < 2) {
        return Alert.alert("Max teams required", "Open leagues need at least 2 team slots.");
      }
    }

    setSaving(true);
    try {
      const token = await getAuthToken();
      if (!token) {
        setSaving(false);
        return Alert.alert("Not signed in", "Please log in again to host a league.");
      }

      const res = await fetch(`${SERVER_URL}/create-league`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          name: cleanName,
          sport,
          format,
          city: cleanCity,
          venue: venue.trim(),
          description: description.trim(),
          startDate: startDate.trim(),
          hostType,
          entryFee: 0,              // free for every league right now
          maxTeams: hostType === "open" ? teamsNum : 0,
          registrationDeadline: hostType === "open" ? registrationDeadline.trim() : "",
          prizePoolPercent: 0,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Could not create the league.");
      }

      Alert.alert("League created! 🏆", `${cleanName} is live. Add teams and fixtures next.`, [
        {
          text: "Go to league",
          onPress: () => router.replace(`/(playon-pro)/league-card/${data.leagueId}` as any),
        },
      ]);
    } catch (e: any) {
      Alert.alert("Couldn't create league", e.message || "Something went wrong. Try again.");
    } finally {
      setSaving(false);
    }
  }, [name, sport, format, city, venue, description, startDate, hostType, maxTeams, registrationDeadline, router]);

  return (
    <SafeAreaView style={s.safe} edges={["top"]}>
      <StatusBar barStyle="dark-content" backgroundColor={PAGE_BG} />

      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn} hitSlop={10}>
          <Ionicons name="chevron-back" size={22} color={DARK} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={s.headerTitle}>Host a League</Text>
          <Text style={s.headerSub}>Free to start. You're in charge.</Text>
        </View>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ padding: 16, paddingBottom: 40 + insets.bottom }}
        >
          {/* League name */}
          <Field label="League name *">
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="e.g. Amravati Premier League"
              placeholderTextColor={GRAY}
              style={s.input}
              maxLength={60}
            />
          </Field>

          {/* Sport */}
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

          {/* Format */}
          <Text style={s.label}>Format *</Text>
          <View style={{ gap: 8, marginBottom: 6 }}>
            {FORMATS.map((f) => {
              const active = f.value === format;
              return (
                <TouchableOpacity
                  key={f.value}
                  style={[s.formatCard, active && s.formatCardActive]}
                  onPress={() => setFormat(f.value)}
                  activeOpacity={0.8}
                >
                  <View style={[s.radio, active && s.radioActive]}>
                    {active && <View style={s.radioDot} />}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[s.formatLabel, active && { color: GREEN }]}>{f.label}</Text>
                    <Text style={s.formatDesc}>{f.desc}</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* City + Venue */}
          <Field label="City *">
            <TextInput
              value={city}
              onChangeText={setCity}
              placeholder="e.g. Amravati"
              placeholderTextColor={GRAY}
              style={s.input}
              maxLength={40}
            />
          </Field>

          <Field label="Venue (optional)">
            <TextInput
              value={venue}
              onChangeText={setVenue}
              placeholder="e.g. Shivaji Stadium"
              placeholderTextColor={GRAY}
              style={s.input}
              maxLength={60}
            />
          </Field>

          <Field label="Start date *">
            <TextInput
              value={startDate}
              onChangeText={setStartDate}
              placeholder="e.g. 30 Aug 2026"
              placeholderTextColor={GRAY}
              style={s.input}
              maxLength={30}
            />
          </Field>

          <Field label="Description (optional)">
            <TextInput
              value={description}
              onChangeText={setDescription}
              placeholder="Tell players what this league is about"
              placeholderTextColor={GRAY}
              style={[s.input, { height: 80, textAlignVertical: "top" }]}
              multiline
              maxLength={200}
            />
          </Field>

          {/* Host type */}
          <Text style={s.label}>Who adds the teams?</Text>
          <View style={{ gap: 8, marginBottom: 6 }}>
            <TouchableOpacity
              style={[s.formatCard, hostType === "managed" && s.formatCardActive]}
              onPress={() => setHostType("managed")}
              activeOpacity={0.8}
            >
              <View style={[s.radio, hostType === "managed" && s.radioActive]}>
                {hostType === "managed" && <View style={s.radioDot} />}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[s.formatLabel, hostType === "managed" && { color: GREEN }]}>
                  I'll add teams myself
                </Text>
                <Text style={s.formatDesc}>You control who plays — add teams and fixtures after creating</Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              style={[s.formatCard, hostType === "open" && s.formatCardActive]}
              onPress={() => setHostType("open")}
              activeOpacity={0.8}
            >
              <View style={[s.radio, hostType === "open" && s.radioActive]}>
                {hostType === "open" && <View style={s.radioDot} />}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[s.formatLabel, hostType === "open" && { color: GREEN }]}>
                  Anyone can register their team
                </Text>
                <Text style={s.formatDesc}>Open registration until your deadline or team limit</Text>
              </View>
            </TouchableOpacity>
          </View>

          {hostType === "open" && (
            <>
              <Field label="Max teams *">
                <TextInput
                  value={maxTeams}
                  onChangeText={(v) => setMaxTeams(v.replace(/[^0-9]/g, ""))}
                  placeholder="e.g. 8"
                  placeholderTextColor={GRAY}
                  style={s.input}
                  keyboardType="number-pad"
                  maxLength={3}
                />
              </Field>
              <Field label="Registration deadline (optional)">
                <TextInput
                  value={registrationDeadline}
                  onChangeText={setRegistrationDeadline}
                  placeholder="e.g. 25 Aug 2026"
                  placeholderTextColor={GRAY}
                  style={s.input}
                  maxLength={30}
                />
              </Field>
            </>
          )}

          {/* Free notice */}
          <View style={s.freeNotice}>
            <Ionicons name="pricetag-outline" size={16} color={GREEN} />
            <Text style={s.freeNoticeTxt}>
              Hosting is free right now — no entry fees. Paid entry may come later.
            </Text>
          </View>

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
                <Ionicons name="trophy" size={18} color="#fff" />
                <Text style={s.submitTxt}>Create League</Text>
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

  formatCard: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: "#fff",
    borderRadius: 14,
    borderWidth: 1.5, borderColor: "#E5E7EB",
    padding: 14,
  },
  formatCardActive: { borderColor: GREEN, backgroundColor: "#F0FDF4" },
  formatLabel: { fontSize: 14.5, fontWeight: "700", color: DARK },
  formatDesc:  { fontSize: 12, color: GRAY, marginTop: 2 },

  radio: {
    width: 20, height: 20, borderRadius: 10,
    borderWidth: 2, borderColor: "#D1D5DB",
    alignItems: "center", justifyContent: "center",
  },
  radioActive: { borderColor: GREEN },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: GREEN },

  freeNotice: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "#F0FDF4",
    borderRadius: 12,
    padding: 12,
    marginTop: 8,
    marginBottom: 20,
  },
  freeNoticeTxt: { flex: 1, fontSize: 12.5, color: "#15803D", fontWeight: "600" },

  submitBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: GREEN,
    borderRadius: 14,
    paddingVertical: 15,
  },
  submitTxt: { fontSize: 15.5, fontWeight: "800", color: "#fff" },
});
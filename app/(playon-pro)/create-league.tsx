import {
  View, Text, TextInput, StyleSheet, ScrollView, TouchableOpacity,
  SafeAreaView, StatusBar, Platform, ActivityIndicator, Alert,
  useWindowDimensions,
} from "react-native";
import { useEffect, useState } from "react";
import { auth, db } from "../../firebaseConfig";
import { doc, getDoc } from "firebase/firestore";
import { getIdToken } from "firebase/auth";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

// =======================================================
// 🏆 CREATE LEAGUE
// hostType: "managed" (owner adds teams, free) | "open" (teams register + pay in app)
// "open" stays locked to verified league-owner/admin accounts until
// self-serve users have a banking/KYC step — see profile.tsx entry points.
// =======================================================
const SERVER_URL = "https://bookora-backend-95u4.onrender.com";
const MAX_W = 760;

const PRIMARY    = "#5B4FE5";
const PRIMARY_BG = "#F0EEFF";
const DARK       = "#1B2050";
const MUTED      = "#8A8FA8";
const BORDER     = "#EEF0F7";
const BG         = "#F7F8FC";

const SPORTS = ["Football", "Cricket", "Badminton", "Basketball", "Pickleball", "Volleyball"];

const FORMATS: { key: string; label: string; hint: string }[] = [
  { key: "round_robin", label: "Round Robin", hint: "Everyone plays everyone" },
  { key: "knockout", label: "Knockout", hint: "Single elimination bracket" },
  { key: "groups_knockout", label: "Groups + Knockout", hint: "Group stage, then bracket" },
];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

async function getAuthToken(): Promise<string | null> {
  try {
    const user = auth.currentUser;
    if (!user) return null;
    return await getIdToken(user);
  } catch {
    return null;
  }
}

export default function CreateLeague() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isWide = width >= 900;
  const halfW = isWide ? "48%" : "100%";
  const params = useLocalSearchParams<{ hostType?: string }>();

  // ── Who's creating this — decides whether "open + entry fee" is available ──
  const [callerRole, setCallerRole] = useState<string | null>(null);
  const canHostOpen = true;

  useEffect(() => {
    (async () => {
      try {
        const u = auth.currentUser;
        if (!u) return;
        const snap = await getDoc(doc(db, "users", u.uid));
        setCallerRole(snap.exists() ? (snap.data().role || "user") : "user");
      } catch {
        setCallerRole("user");
      }
    })();
  }, []);

  const [hostType, setHostType] = useState<"managed" | "open">(
    params.hostType === "open" ? "open" : "managed"
  );

  // If their role doesn't allow paid leagues, force back to managed
  useEffect(() => {
    if (callerRole !== null && !canHostOpen && hostType === "open") {
      setHostType("managed");
    }
  }, [callerRole, canHostOpen]);

  const [name, setName] = useState("");
  const [season, setSeason] = useState("");
  const [sport, setSport] = useState("");
  const [format, setFormat] = useState("round_robin");
  const [city, setCity] = useState("");
  const [venue, setVenue] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [regDeadline, setRegDeadline] = useState("");
  const [entryFee, setEntryFee] = useState("");
  const [maxTeams, setMaxTeams] = useState("");
  const [prizePool, setPrizePool] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  const isOpen = hostType === "open";

  const handleCreate = async () => {
    if (!name.trim()) return Alert.alert("Missing name", "Enter a league name.");
    if (!sport) return Alert.alert("Missing sport", "Pick a sport.");
    if (!city.trim()) return Alert.alert("Missing city", "Enter the city.");

    if (isOpen) {
      if (!canHostOpen) return Alert.alert("Not available yet", "Paid registration leagues aren't open to self-serve accounts yet.");
      const fee = Number(entryFee);
      if (entryFee.trim() === "" || isNaN(fee) || fee < 0)
        return Alert.alert("Entry fee", "Enter a valid entry fee (0 or more).");
      const teams = Number(maxTeams);
      if (isNaN(teams) || teams < 2)
        return Alert.alert("Max teams", "Max teams must be at least 2.");
      if (regDeadline && !DATE_RE.test(regDeadline))
        return Alert.alert("Registration deadline", "Use the format YYYY-MM-DD.");
    }
    if (startDate && !DATE_RE.test(startDate))
      return Alert.alert("Start date", "Use the format YYYY-MM-DD.");
    if (endDate && !DATE_RE.test(endDate))
      return Alert.alert("End date", "Use the format YYYY-MM-DD.");
    if (startDate && endDate && DATE_RE.test(startDate) && DATE_RE.test(endDate) && endDate < startDate)
      return Alert.alert("End date", "End date can't be before the start date.");

    setSaving(true);
    try {
      const token = await getAuthToken();
      if (!token) {
        setSaving(false);
        return Alert.alert("Session expired", "Please log in again.");
      }

      const res = await fetch(`${SERVER_URL}/create-league`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          hostType,
          name: name.trim(),
          season: season.trim(),
          sport,
          format,
          city: city.trim(),
          venue: venue.trim(),
          startDate: startDate.trim(),
          endDate: endDate.trim(),
          registrationDeadline: isOpen ? regDeadline.trim() : "",
          entryFee: isOpen ? Number(entryFee) : 0,
          maxTeams: isOpen ? Number(maxTeams) : 0,
          prizePoolPercent: isOpen ? Number(prizePool || 0) : 0,
          description: description.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "Failed to create league.");

      Alert.alert(
        "League created",
        isOpen ? "It's now open for team registrations." : "Now add your teams to get started."
      );
      // Straight into management — no separate "owner section" detour
      router.replace({ pathname: "/(playon-pro)/league-manage", params: { id: data.leagueId } } as any);
    } catch (e: any) {
      Alert.alert("Error", e.message || "Something went wrong.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="dark-content" backgroundColor="#fff" />

      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10} style={s.backBtn}>
          <Ionicons name="chevron-back" size={22} color={DARK} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Create League</Text>
      </View>

      <ScrollView keyboardDismissMode="interactive" automaticallyAdjustKeyboardInsets
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 48, alignItems: "center" }}
      >
        <View style={[s.container, { width: isWide ? MAX_W : "100%" }]}>

          {/* ── Card: Hosting type ── */}
          <View style={s.card}>
            <Text style={s.cardTitle}>How will teams be added?</Text>
            <View style={{ gap: 10, marginTop: 4 }}>
              <TypeCard
                active={hostType === "managed"}
                onPress={() => setHostType("managed")}
                icon="clipboard-outline"
                title="Host my own league"
                sub="I'll add the teams myself. No app sign-up or entry fee (e.g. an existing local league)."
              />
              <TypeCard
                active={hostType === "open"}
                onPress={() => canHostOpen ? setHostType("open") : Alert.alert(
                  "Not available yet",
                  "Paid registration leagues need a verified payout account. Contact us to get upgraded."
                )}
                icon={canHostOpen ? "people-outline" : "lock-closed-outline"}
                title="Open for registration"
                sub={canHostOpen
                  ? "Teams register and pay the entry fee through the app."
                  : "Teams register and pay through the app — needs a verified payout account first."}
                disabled={!canHostOpen}
              />
            </View>
          </View>

          {/* ── Card: League details ── */}
          <View style={s.card}>
            <Text style={s.cardTitle}>League details</Text>

            <Label>League name *</Label>
            <TextInput style={s.input} value={name} onChangeText={setName} placeholder="e.g. SSPL — Saturday Sunday Premier League" placeholderTextColor="#9CA3AF" />

            <Label>Season</Label>
            <TextInput style={s.input} value={season} onChangeText={setSeason} placeholder="e.g. Season 1 (shown on your dashboard)" placeholderTextColor="#9CA3AF" />

            <Label>Sport *</Label>
            <View style={s.chips}>
              {SPORTS.map((sp) => {
                const active = sport === sp;
                return (
                  <TouchableOpacity key={sp} style={[s.chip, active && s.chipActive]} onPress={() => setSport(sp)}>
                    <Text style={[s.chipTxt, active && s.chipTxtActive]}>{sp}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Label>Format *</Label>
            <View style={{ gap: 10 }}>
              {FORMATS.map((f) => {
                const active = format === f.key;
                return (
                  <TouchableOpacity key={f.key} style={[s.formatRow, active && s.formatRowActive]} onPress={() => setFormat(f.key)}>
                    <Ionicons name={active ? "radio-button-on" : "radio-button-off"} size={20} color={active ? PRIMARY : "#9CA3AF"} />
                    <View style={{ marginLeft: 10 }}>
                      <Text style={[s.formatLabel, active && { color: PRIMARY }]}>{f.label}</Text>
                      <Text style={s.formatHint}>{f.hint}</Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* ── Card: Schedule & location ── */}
          <View style={s.card}>
            <Text style={s.cardTitle}>Schedule & location</Text>
            <View style={s.rowWrap}>
              <View style={{ width: halfW }}>
                <Label>City *</Label>
                <TextInput style={s.input} value={city} onChangeText={setCity} placeholder="e.g. Amravati" placeholderTextColor="#9CA3AF" />
              </View>
              <View style={{ width: halfW }}>
                <Label>Venue / area</Label>
                <TextInput style={s.input} value={venue} onChangeText={setVenue} placeholder="Optional" placeholderTextColor="#9CA3AF" />
              </View>
              <View style={{ width: halfW }}>
                <Label>Start date</Label>
                <TextInput style={s.input} value={startDate} onChangeText={setStartDate} placeholder="YYYY-MM-DD" placeholderTextColor="#9CA3AF" />
              </View>
              <View style={{ width: halfW }}>
                <Label>End date</Label>
                <TextInput style={s.input} value={endDate} onChangeText={setEndDate} placeholder="YYYY-MM-DD" placeholderTextColor="#9CA3AF" />
              </View>
              {isOpen && (
                <View style={{ width: halfW }}>
                  <Label>Registration deadline</Label>
                  <TextInput style={s.input} value={regDeadline} onChangeText={setRegDeadline} placeholder="YYYY-MM-DD" placeholderTextColor="#9CA3AF" />
                </View>
              )}
            </View>
          </View>

          {/* ── Card: Registration & prize (open leagues only) ── */}
          {isOpen && (
            <View style={s.card}>
              <Text style={s.cardTitle}>Registration & prize</Text>
              <View style={s.rowWrap}>
                <View style={{ width: halfW }}>
                  <Label>Entry fee per team (₹) *</Label>
                  <TextInput style={s.input} value={entryFee} onChangeText={setEntryFee} placeholder="e.g. 1500" placeholderTextColor="#9CA3AF" keyboardType="number-pad" />
                </View>
                <View style={{ width: halfW }}>
                  <Label>Max teams *</Label>
                  <TextInput style={s.input} value={maxTeams} onChangeText={setMaxTeams} placeholder="e.g. 16" placeholderTextColor="#9CA3AF" keyboardType="number-pad" />
                </View>
                <View style={{ width: halfW }}>
                  <Label>Prize pool (% of fees)</Label>
                  <TextInput style={s.input} value={prizePool} onChangeText={setPrizePool} placeholder="Optional, e.g. 70" placeholderTextColor="#9CA3AF" keyboardType="number-pad" />
                </View>
              </View>
            </View>
          )}

          {/* ── Card: Description ── */}
          <View style={s.card}>
            <Text style={s.cardTitle}>Description</Text>
            <TextInput
              style={[s.input, s.textarea]}
              value={description}
              onChangeText={setDescription}
              placeholder="Rules, format details, contact info…"
              placeholderTextColor="#9CA3AF"
              multiline
            />
          </View>

          <TouchableOpacity style={[s.submit, saving && { opacity: 0.6 }]} onPress={handleCreate} disabled={saving}>
            {saving ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Ionicons name="checkmark-circle-outline" size={20} color="#fff" />
                <Text style={s.submitTxt}>Create League</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Label({ children }: { children: string }) {
  return <Text style={s.label}>{children}</Text>;
}

function TypeCard({
  active, onPress, icon, title, sub, disabled,
}: {
  active: boolean;
  onPress: () => void;
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  sub: string;
  disabled?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[s.typeCard, active && s.typeCardActive, disabled && s.typeCardDisabled]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      <Ionicons name={active ? "radio-button-on" : "radio-button-off"} size={20} color={active ? PRIMARY : "#9CA3AF"} />
      <View style={{ marginLeft: 10, flex: 1 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Ionicons name={icon} size={16} color={active ? PRIMARY : "#6B7280"} />
          <Text style={[s.typeTitle, active && { color: PRIMARY }]}>{title}</Text>
        </View>
        <Text style={s.typeSub}>{sub}</Text>
      </View>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BG },
  header: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "#fff",
    paddingHorizontal: 12,
    paddingTop: Platform.OS === "android" ? (StatusBar.currentHeight || 0) + 8 : 6,
    paddingBottom: 10, borderBottomColor: BORDER, borderBottomWidth: 1,
  },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 18, fontWeight: "800", color: DARK },

  container: { paddingHorizontal: 16, paddingTop: 16 },

  card:      { backgroundColor: "#fff", borderRadius: 16, borderWidth: 1, borderColor: BORDER, padding: 16, marginBottom: 14 },
  cardTitle: { fontSize: 14.5, fontWeight: "800", color: DARK, marginBottom: 4 },

  label: { fontSize: 13, fontWeight: "600", color: "#374151", marginBottom: 6, marginTop: 16 },
  input: {
    borderColor: "#E5E7EB", borderWidth: 1, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: Platform.OS === "android" ? 9 : 12,
    fontSize: 14, color: "#111827", backgroundColor: "#fff",
  },
  textarea: { minHeight: 90, textAlignVertical: "top", paddingTop: 10 },

  typeCard: {
    flexDirection: "row", alignItems: "flex-start", padding: 14,
    borderRadius: 12, borderColor: "#E5E7EB", borderWidth: 1, backgroundColor: "#fff",
  },
  typeCardActive: { borderColor: PRIMARY, backgroundColor: PRIMARY_BG },
  typeCardDisabled: { opacity: 0.55 },
  typeTitle: { fontSize: 14, fontWeight: "700", color: "#111827" },
  typeSub: { fontSize: 12, color: "#6B7280", marginTop: 3, lineHeight: 17 },

  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20, backgroundColor: "#F3F4F6", borderColor: "#E5E7EB", borderWidth: 1 },
  chipActive: { backgroundColor: PRIMARY, borderColor: PRIMARY },
  chipTxt: { fontSize: 13, fontWeight: "600", color: "#374151" },
  chipTxtActive: { color: "#fff" },

  formatRow: { flexDirection: "row", alignItems: "center", padding: 12, borderRadius: 12, borderColor: "#E5E7EB", borderWidth: 1, backgroundColor: "#fff" },
  formatRowActive: { borderColor: PRIMARY, backgroundColor: PRIMARY_BG },
  formatLabel: { fontSize: 14, fontWeight: "700", color: "#111827" },
  formatHint: { fontSize: 12, color: "#6B7280", marginTop: 2 },

  rowWrap: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between" },

  submit: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: PRIMARY, paddingVertical: 15, borderRadius: 12, marginTop: 4 },
  submitTxt: { color: "#fff", fontSize: 15, fontWeight: "700" },
});
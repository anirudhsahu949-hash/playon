import {
  View,
  Text,
  TextInput,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
  StatusBar,
  Platform,
  ActivityIndicator,
  Alert,
  Switch,
  Keyboard,
} from "react-native";
import { useEffect, useState, useCallback } from "react";
import { db, auth } from "../../firebaseConfig";
import { doc, getDoc, updateDoc, serverTimestamp } from "firebase/firestore";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

// =======================================================
// ✏️ EDIT PLAYER PROFILE  (app/(playon-pro)/edit-player-profile.tsx)
//
// Edits playerProfiles/{uid} — all league identity fields.
// Also syncs displayName back to users/{uid} so both docs
// stay in sync.
//
// Fields:
//   Display name   → playerProfiles + users
//   Bio            → playerProfiles
//   Age            → playerProfiles
//   Sports (chips) → playerProfiles  (first = primary)
//   Player role    → playerProfiles  (sport-specific)
//   Batting hand   → playerProfiles  (cricket only)
//   Bowling style  → playerProfiles  (cricket only)
//   Public profile → playerProfiles  (isPublic toggle)
//
// Locked (cannot change here):
//   @PlayonID      → set once at creation, permanent
// =======================================================

const GREEN  = "#16A34A";
const PURPLE = "#7C3AED";
const DARK   = "#0B1220";

// ── Sport / role config ───────────────────────────────────────────────────────
const SPORTS_LIST = [
  "Cricket", "Football", "Badminton",
  "Basketball", "Volleyball", "Pickleball",
  "Tennis", "Table Tennis",
];

const SPORT_ROLES: Record<string, { label: string; value: string }[]> = {
  Cricket:    [
    { label: "Batsman",       value: "batsman"    },
    { label: "Bowler",        value: "bowler"     },
    { label: "All-Rounder",   value: "allrounder" },
    { label: "Wicket Keeper", value: "keeper"     },
  ],
  Football:   [
    { label: "Goalkeeper",  value: "goalkeeper"  },
    { label: "Defender",    value: "defender"    },
    { label: "Midfielder",  value: "midfielder"  },
    { label: "Forward",     value: "forward"     },
  ],
  Badminton:  [
    { label: "Singles", value: "singles" },
    { label: "Doubles", value: "doubles" },
    { label: "Mixed",   value: "mixed"   },
  ],
  Basketball: [
    { label: "Point Guard",    value: "pg" },
    { label: "Shooting Guard", value: "sg" },
    { label: "Small Forward",  value: "sf" },
    { label: "Power Forward",  value: "pf" },
    { label: "Center",         value: "c"  },
  ],
  Volleyball: [
    { label: "Setter",  value: "setter"  },
    { label: "Libero",  value: "libero"  },
    { label: "Spiker",  value: "spiker"  },
    { label: "Blocker", value: "blocker" },
  ],
};

const BATTING_HANDS  = ["Right Hand", "Left Hand"];
const BOWLING_STYLES = [
  "Right Arm Fast", "Right Arm Medium", "Right Arm Spin",
  "Left Arm Fast",  "Left Arm Medium",  "Left Arm Spin",
  "Does Not Bowl",
];

function initials(name: string) {
  return (name || "?").trim().split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function EditPlayerProfile() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(false);

  // Profile fields
  const [playonId,      setPlayonId]      = useState("");   // read-only display
  const [displayName,   setDisplayName]   = useState("");
  const [bio,           setBio]           = useState("");
  const [age,           setAge]           = useState("");
  const [selectedSports,setSelectedSports]= useState<string[]>([]);
  const [playerRole,    setPlayerRole]    = useState("");
  const [battingHand,   setBattingHand]   = useState("");
  const [bowlingStyle,  setBowlingStyle]  = useState("");
  const [isPublic,      setIsPublic]      = useState(true);

  const primary   = selectedSports[0] || "";
  const isCricket = primary === "Cricket";
  const roles     = SPORT_ROLES[primary] || [];

  // ── Load ──────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    const uid = auth.currentUser?.uid;
    if (!uid) { setLoading(false); return; }
    try {
      const snap = await getDoc(doc(db, "playerProfiles", uid));
      if (!snap.exists()) {
        Alert.alert("No profile", "Create a Playon ID first.");
        router.back();
        return;
      }
      const d = snap.data();
      setPlayonId(d.playonId     || "");
      setDisplayName(d.displayName || "");
      setBio(d.bio               || "");
      setAge(d.age ? String(d.age) : "");
      setSelectedSports(Array.isArray(d.sports) ? d.sports : []);
      setPlayerRole(d.playerRole  || "");
      setBattingHand(d.battingHand || "");
      setBowlingStyle(d.bowlingStyle || "");
      setIsPublic(d.isPublic !== false); // default public
    } catch (e) {
      console.error("load profile", e);
      Alert.alert("Error", "Could not load your profile.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── Sport toggle ──────────────────────────────────────────────────────────
  const toggleSport = (sp: string) => {
    setSelectedSports((prev) => {
      const next = prev.includes(sp)
        ? prev.filter((x) => x !== sp)
        : [...prev, sp];
      // reset role when primary sport changes
      if (next[0] !== prev[0]) setPlayerRole("");
      return next;
    });
  };

  // ── Validate ──────────────────────────────────────────────────────────────
  const validate = (): boolean => {
    if (!displayName.trim()) {
      Alert.alert("Name required", "Enter your display name."); return false;
    }
    if (selectedSports.length === 0) {
      Alert.alert("Sport required", "Select at least one sport."); return false;
    }
    if (age && (isNaN(Number(age)) || Number(age) < 5 || Number(age) > 80)) {
      Alert.alert("Invalid age", "Age must be between 5 and 80."); return false;
    }
    return true;
  };

  // ── Save ──────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!validate()) return;
    Keyboard.dismiss();
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    setSaving(true);
    try {
      const cleanName = displayName.trim();

      // Update playerProfiles/{uid}
      await updateDoc(doc(db, "playerProfiles", uid), {
        displayName:      cleanName,
        displayNameLower: cleanName.toLowerCase(),
        bio:              bio.trim(),
        age:              age ? Number(age) : null,
        sports:           selectedSports,
        playerRole:       playerRole  || null,
        battingHand:      battingHand || null,
        bowlingStyle:     bowlingStyle || null,
        isPublic,
        updatedAt:        serverTimestamp(),
      });

      // Sync displayName back to users/{uid} so the main app stays in sync
      await updateDoc(doc(db, "users", uid), {
        name: cleanName,
      });

      Alert.alert("Saved ✅", "Your player profile has been updated.", [
        { text: "OK", onPress: () => router.back() },
      ]);
    } catch (e: any) {
      console.error("save profile", e);
      Alert.alert("Error", e.message || "Could not save. Try again.");
    } finally {
      setSaving(false);
    }
  };

  // ── Loading ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <SafeAreaView style={[s.root, s.center]}>
        <StatusBar barStyle="dark-content" backgroundColor="#F8F9FB" />
        <ActivityIndicator color={GREEN} size="large" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.root}>
      <StatusBar barStyle="dark-content" backgroundColor="#F8F9FB" />

      {/* ── Top bar ── */}
      <View style={s.topBar}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn} hitSlop={10}>
          <Ionicons name="chevron-back" size={22} color={DARK} />
        </TouchableOpacity>
        <Text style={s.topTitle}>Edit Profile</Text>
        {/* Save shortcut in header */}
        <TouchableOpacity
          onPress={handleSave}
          disabled={saving}
          style={[s.headerSaveBtn, saving && { opacity: 0.5 }]}
        >
          {saving
            ? <ActivityIndicator size="small" color={GREEN} />
            : <Text style={s.headerSaveTxt}>Save</Text>
          }
        </TouchableOpacity>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: 60 }}
      >
        {/* ── Avatar preview ── */}
        <View style={s.avatarSection}>
          <View style={s.avatar}>
            <Text style={s.avatarTxt}>{initials(displayName || "?")}</Text>
          </View>
          <View style={s.playonIdBadge}>
            <Text style={s.playonIdAt}>@</Text>
            <Text style={s.playonIdTxt}>{playonId}</Text>
            <Ionicons name="lock-closed" size={11} color="#9CA3AF" />
          </View>
          <Text style={s.lockedHint}>@PlayonID cannot be changed</Text>
        </View>

        {/* ════════════════════════════════ */}
        {/* SECTION 1 — Identity            */}
        {/* ════════════════════════════════ */}
        <SectionLabel label="Identity" />

        <View style={s.card}>
          {/* Display name */}
          <FieldRow
            label="Display name"
            icon="person-outline"
            required
          >
            <TextInput
              style={s.fieldInput}
              value={displayName}
              onChangeText={setDisplayName}
              placeholder="Your full name"
              placeholderTextColor="#9CA3AF"
              maxLength={40}
            />
          </FieldRow>

          <Divider />

          {/* Bio */}
          <FieldRow label="Bio" icon="document-text-outline">
            <TextInput
              style={[s.fieldInput, s.fieldInputMulti]}
              value={bio}
              onChangeText={setBio}
              placeholder="e.g. Right arm fast · Amravati · 5 yrs playing"
              placeholderTextColor="#9CA3AF"
              multiline
              maxLength={120}
              textAlignVertical="top"
            />
            <Text style={s.charCount}>{bio.length}/120</Text>
          </FieldRow>

          <Divider />

          {/* Age */}
          <FieldRow label="Age" icon="calendar-outline">
            <TextInput
              style={[s.fieldInput, { width: 80 }]}
              value={age}
              onChangeText={(v) => setAge(v.replace(/[^0-9]/g, ""))}
              placeholder="e.g. 22"
              placeholderTextColor="#9CA3AF"
              keyboardType="numeric"
              maxLength={2}
            />
          </FieldRow>
        </View>

        {/* ════════════════════════════════ */}
        {/* SECTION 2 — Sports              */}
        {/* ════════════════════════════════ */}
        <SectionLabel label="Sports you play" hint="First selected = primary sport" />

        <View style={s.card}>
          <View style={s.chipsWrap}>
            {SPORTS_LIST.map((sp) => {
              const active    = selectedSports.includes(sp);
              const isPrimary = selectedSports[0] === sp;
              return (
                <TouchableOpacity
                  key={sp}
                  style={[s.chip, active && s.chipActive]}
                  onPress={() => toggleSport(sp)}
                  activeOpacity={0.75}
                >
                  {isPrimary && <Ionicons name="star" size={11} color="#15803D" />}
                  <Text style={[s.chipTxt, active && s.chipTxtActive]}>
                    {sp}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          {selectedSports.length > 0 && (
            <Text style={s.primaryHint}>
              Primary sport: <Text style={{ color: GREEN, fontWeight: "700" }}>{primary}</Text>
              {" — stats and role are based on this"}
            </Text>
          )}
        </View>

        {/* ════════════════════════════════ */}
        {/* SECTION 3 — Role                */}
        {/* ════════════════════════════════ */}
        {roles.length > 0 && (
          <>
            <SectionLabel label={`Your role in ${primary}`} />
            <View style={s.card}>
              <View style={s.chipsWrap}>
                {roles.map((r) => {
                  const active = playerRole === r.value;
                  return (
                    <TouchableOpacity
                      key={r.value}
                      style={[s.chip, active && s.chipActive]}
                      onPress={() => setPlayerRole(active ? "" : r.value)}
                      activeOpacity={0.75}
                    >
                      <Text style={[s.chipTxt, active && s.chipTxtActive]}>{r.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          </>
        )}

        {/* ════════════════════════════════ */}
        {/* SECTION 4 — Cricket sub-fields  */}
        {/* ════════════════════════════════ */}
        {isCricket && (
          <>
            <SectionLabel label="Batting hand" />
            <View style={s.card}>
              <View style={s.chipsWrap}>
                {BATTING_HANDS.map((h) => {
                  const active = battingHand === h;
                  return (
                    <TouchableOpacity
                      key={h}
                      style={[s.chip, active && s.chipActive]}
                      onPress={() => setBattingHand(active ? "" : h)}
                      activeOpacity={0.75}
                    >
                      <Text style={[s.chipTxt, active && s.chipTxtActive]}>{h}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            <SectionLabel label="Bowling style" />
            <View style={s.card}>
              <View style={s.chipsWrap}>
                {BOWLING_STYLES.map((bs) => {
                  const active = bowlingStyle === bs;
                  return (
                    <TouchableOpacity
                      key={bs}
                      style={[s.chip, active && s.chipActive]}
                      onPress={() => setBowlingStyle(active ? "" : bs)}
                      activeOpacity={0.75}
                    >
                      <Text style={[s.chipTxt, active && s.chipTxtActive]}>{bs}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          </>
        )}

        {/* ════════════════════════════════ */}
        {/* SECTION 5 — Privacy             */}
        {/* ════════════════════════════════ */}
        <SectionLabel label="Privacy" />

        <View style={s.card}>
          <View style={s.switchRow}>
            <View style={{ flex: 1 }}>
              <Text style={s.switchLabel}>Public profile</Text>
              <Text style={s.switchSub}>
                {isPublic
                  ? "Anyone can view your stats and profile on the Stats screen"
                  : "Your profile is hidden from the Stats leaderboard and search"
                }
              </Text>
            </View>
            <Switch
              value={isPublic}
              onValueChange={setIsPublic}
              trackColor={{ false: "#E5E7EB", true: "#BBF7D0" }}
              thumbColor={isPublic ? GREEN : "#9CA3AF"}
            />
          </View>
        </View>

        {/* ════════════════════════════════ */}
        {/* Save button                      */}
        {/* ════════════════════════════════ */}
        <View style={s.btnWrap}>
          <TouchableOpacity
            style={[s.saveBtn, saving && { opacity: 0.6 }]}
            onPress={handleSave}
            disabled={saving}
            activeOpacity={0.85}
          >
            {saving
              ? <ActivityIndicator color="#fff" />
              : <>
                  <Ionicons name="checkmark-circle-outline" size={18} color="#fff" />
                  <Text style={s.saveBtnTxt}>Save Changes</Text>
                </>
            }
          </TouchableOpacity>

          <TouchableOpacity
            style={s.cancelBtn}
            onPress={() => router.back()}
            disabled={saving}
          >
            <Text style={s.cancelBtnTxt}>Cancel</Text>
          </TouchableOpacity>
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function SectionLabel({ label, hint }: { label: string; hint?: string }) {
  return (
    <View style={s.sectionLabelWrap}>
      <Text style={s.sectionLabel}>{label.toUpperCase()}</Text>
      {!!hint && <Text style={s.sectionHint}>{hint}</Text>}
    </View>
  );
}

function FieldRow({
  label, icon, required, children,
}: {
  label: string; icon: keyof typeof Ionicons.glyphMap;
  required?: boolean; children: React.ReactNode;
}) {
  return (
    <View style={s.fieldRow}>
      <View style={s.fieldRowLeft}>
        <Ionicons name={icon} size={16} color="#9CA3AF" />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={s.fieldLabel}>
          {label}
          {required && <Text style={{ color: GREEN }}> *</Text>}
        </Text>
        {children}
      </View>
    </View>
  );
}

function Divider() {
  return <View style={s.divider} />;
}

// ── Styles ─────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root:   { flex: 1, backgroundColor: "#F9FAFB" },
  center: { alignItems: "center", justifyContent: "center" },

  // Top bar
  topBar: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: Platform.OS === "android" ? (StatusBar.currentHeight ?? 0) + 8 : 8,
    paddingBottom: 12,
    backgroundColor: "#F9FAFB",
  },
  backBtn:      { width: 36, height: 36, borderRadius: 18, backgroundColor: "#fff", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "#E5E7EB" },
  topTitle:     { fontSize: 17, fontWeight: "800", color: DARK },
  headerSaveBtn:{ paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: "#F0FDF4", borderWidth: 1, borderColor: "#BBF7D0" },
  headerSaveTxt:{ fontSize: 14, fontWeight: "800", color: GREEN },

  // Avatar
  avatarSection: { alignItems: "center", paddingVertical: 20 },
  avatar: {
    width: 80, height: 80, borderRadius: 40, backgroundColor: PURPLE,
    alignItems: "center", justifyContent: "center",
    borderWidth: 3, borderColor: "#EDE9FE", marginBottom: 10,
  },
  avatarTxt: { color: "#fff", fontWeight: "900", fontSize: 26 },
  playonIdBadge: {
    flexDirection: "row", alignItems: "center", gap: 3,
    backgroundColor: "#F3F4F6", borderRadius: 20,
    paddingHorizontal: 12, paddingVertical: 5,
  },
  playonIdAt:  { fontSize: 13, fontWeight: "700", color: "#9CA3AF" },
  playonIdTxt: { fontSize: 13, fontWeight: "700", color: "#6B7280" },
  lockedHint:  { fontSize: 11, color: "#9CA3AF", marginTop: 4 },

  // Section label
  sectionLabelWrap: { paddingHorizontal: 16, paddingTop: 20, paddingBottom: 6 },
  sectionLabel:     { fontSize: 11, fontWeight: "700", color: "#9CA3AF", letterSpacing: 0.6 },
  sectionHint:      { fontSize: 11, color: "#9CA3AF", marginTop: 2 },

  // Card
  card: {
    marginHorizontal: 16,
    backgroundColor: "#fff",
    borderRadius: 16,
    borderWidth: 1, borderColor: "#F3F4F6",
    paddingHorizontal: 16, paddingVertical: 12,
  },

  // Field row inside card
  fieldRow: {
    flexDirection: "row", alignItems: "flex-start", gap: 12,
    paddingVertical: 10,
  },
  fieldRowLeft: { width: 22, paddingTop: 2 },
  fieldLabel:   { fontSize: 11, fontWeight: "700", color: "#9CA3AF", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 4 },
  fieldInput:   { fontSize: 15, color: DARK, fontWeight: "500", paddingVertical: 0, paddingHorizontal: 0 },
  fieldInputMulti: { minHeight: 64, lineHeight: 22 },
  charCount:    { fontSize: 11, color: "#9CA3AF", textAlign: "right", marginTop: 4 },

  divider: { height: 1, backgroundColor: "#F3F4F6", marginVertical: 2 },

  // Chips
  chipsWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingVertical: 6 },
  chip: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: 20, borderWidth: 1,
    borderColor: "#E5E7EB", backgroundColor: "#F9FAFB",
  },
  chipActive:    { backgroundColor: "#DCFCE7", borderColor: GREEN },
  chipTxt:       { fontSize: 13, fontWeight: "600", color: "#6B7280" },
  chipTxtActive: { color: "#15803D" },
  primaryHint:   { fontSize: 12, color: "#9CA3AF", marginTop: 8, lineHeight: 17 },

  // Privacy switch
  switchRow:  { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 6 },
  switchLabel:{ fontSize: 15, fontWeight: "700", color: DARK, marginBottom: 3 },
  switchSub:  { fontSize: 12, color: "#6B7280", lineHeight: 17 },

  // Buttons
  btnWrap: { marginHorizontal: 16, marginTop: 28, gap: 10 },
  saveBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: GREEN, borderRadius: 14, paddingVertical: 15,
  },
  saveBtnTxt: { fontSize: 15, fontWeight: "800", color: "#fff" },
  cancelBtn: {
    alignItems: "center", justifyContent: "center",
    paddingVertical: 13, borderRadius: 14,
    borderWidth: 1, borderColor: "#E5E7EB", backgroundColor: "#fff",
  },
  cancelBtnTxt: { fontSize: 15, fontWeight: "600", color: "#6B7280" },
});
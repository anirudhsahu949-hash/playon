import {
  View,
  Text,
  TextInput,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  StatusBar,
  Platform,
  ActivityIndicator,
  Alert,
  Switch,
  Keyboard,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { useState } from "react";
import { db } from "../../firebaseConfig";
import {
  collection, query, where, getDocs,
  doc, setDoc, serverTimestamp, limit,
} from "firebase/firestore";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

// =======================================================
// 🛡️ ADMIN — IMPORT PLAYER PROFILE
// app/admin/import-player.tsx
//
// Creates a playerProfiles doc for players who come from
// other league apps and have no Playon account yet.
//
// Admin fills:
//   - Display name (required)
//   - Playon ID (@id)  — admin-chosen, must be unique
//   - Sport + role
//   - Cricket sub-fields (batting hand / bowling style)
//   - Past stats (runs, wickets, etc.)
//   - Phone number (optional) — used later for claim flow
//     so the player can link their account when they sign up
//
// The doc is created with:
//   uid = auto-generated Firestore doc ID  (no Firebase Auth uid)
//   isImported: true
//   claimedBy: null  (set when player signs up and claims)
//   isExpired: false  (imported profiles never expire)
//
// Claim flow (future — not built here):
//   When player signs up, backend checks if a playerProfile
//   exists with matching phone + isImported:true + claimedBy:null
//   → links it to their Auth uid.
// =======================================================

const DARK  = "#0A0F1E";
const GREEN = "#16A34A";

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
export default function ImportPlayer() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  // Identity
  const [displayName,    setDisplayName]    = useState("");
  const [playonId,       setPlayonId]       = useState("");
  const [phone,          setPhone]          = useState("");
  const [bio,            setBio]            = useState("");
  const [age,            setAge]            = useState("");

  // Sport
  const [selectedSport,  setSelectedSport]  = useState("");
  const [playerRole,     setPlayerRole]     = useState("");
  const [battingHand,    setBattingHand]    = useState("");
  const [bowlingStyle,   setBowlingStyle]   = useState("");

  // Stats
  const [stMatches,  setStMatches]  = useState("0");
  const [stWins,     setStWins]     = useState("0");
  const [stLosses,   setStLosses]   = useState("0");
  const [stDraws,    setStDraws]    = useState("0");
  const [stRuns,     setStRuns]     = useState("0");
  const [stWickets,  setStWickets]  = useState("0");
  const [stFifties,  setStFifties]  = useState("0");
  const [stHundreds, setStHundreds] = useState("0");
  const [stGoals,    setStGoals]    = useState("0");
  const [stAssists,  setStAssists]  = useState("0");

  // Playon ID availability
  const [idChecking, setIdChecking] = useState(false);
  const [idAvailable, setIdAvailable] = useState<boolean | null>(null);

  const isCricket  = selectedSport === "Cricket";
  const isFootball = selectedSport === "Football";
  const roles      = SPORT_ROLES[selectedSport] || [];

  // ── Playon ID check ───────────────────────────────────────────────────────
  const checkId = async (raw: string) => {
    const clean = raw.trim().toLowerCase();
    setPlayonId(clean);
    setIdAvailable(null);
    if (clean.length < 3) return;
    setIdChecking(true);
    try {
      const snap = await getDocs(
        query(
          collection(db, "playerProfiles"),
          where("playonId", "==", clean),
          limit(1)
        )
      );
      setIdAvailable(snap.empty);
    } catch { /* silent */ }
    finally { setIdChecking(false); }
  };

  // ── num helper ────────────────────────────────────────────────────────────
  const n = (v: string) => Math.max(0, Number(v) || 0);

  // ── Validate ──────────────────────────────────────────────────────────────
  const validate = (): boolean => {
    if (!displayName.trim()) {
      Alert.alert("Name required", "Enter the player's display name."); return false;
    }
    const cleanId = playonId.trim();
    if (cleanId.length < 3) {
      Alert.alert("Playon ID too short", "Minimum 3 characters."); return false;
    }
    if (!/^[a-z0-9_]+$/.test(cleanId)) {
      Alert.alert("Invalid ID", "Only lowercase letters, numbers and underscore."); return false;
    }
    if (idAvailable === false) {
      Alert.alert("ID taken", "This Playon ID is already in use. Choose another."); return false;
    }
    if (!selectedSport) {
      Alert.alert("Sport required", "Select the player's primary sport."); return false;
    }
    if (age && (isNaN(Number(age)) || n(age) < 5 || n(age) > 80)) {
      Alert.alert("Invalid age", "Age must be between 5 and 80."); return false;
    }
    return true;
  };

  // ── Save ──────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!validate()) return;
    Keyboard.dismiss();
    setSaving(true);
    try {
      const cleanName = displayName.trim();
      const cleanId   = playonId.trim();

      // Double-check ID uniqueness right before save (race condition guard)
      const idSnap = await getDocs(
        query(collection(db, "playerProfiles"), where("playonId", "==", cleanId), limit(1))
      );
      if (!idSnap.empty) {
        Alert.alert("ID taken", "This Playon ID was just claimed by someone else. Choose another.");
        setSaving(false);
        return;
      }

      // Use an auto-generated doc ID (no Firebase Auth uid for imported players)
      const profileRef = doc(collection(db, "playerProfiles"));

      await setDoc(profileRef, {
        // Identity
        displayName:      cleanName,
        displayNameLower: cleanName.toLowerCase(),
        playonId:         cleanId,
        bio:              bio.trim(),
        age:              age ? n(age) : null,
        sports:           [selectedSport],          // single primary sport for imports
        playerRole:       playerRole  || null,
        battingHand:      isCricket ? (battingHand  || null) : null,
        bowlingStyle:     isCricket ? (bowlingStyle || null) : null,

        // Import metadata
        isImported:       true,
        importedPhone:    phone.trim() || null,     // for claim matching later
        claimedBy:        null,                     // set when player signs up
        claimedAt:        null,

        // Stats pre-filled from player's verbal history
        stats: {
          matches:  n(stMatches),
          wins:     n(stWins),
          losses:   n(stLosses),
          draws:    n(stDraws),
          runs:     n(stRuns),
          wickets:  n(stWickets),
          fifties:  n(stFifties),
          hundreds: n(stHundreds),
          goals:    n(stGoals),
          assists:  n(stAssists),
          points:   0,
        },

        // Defaults
        rating:      0,
        isProPlayer: false,
        isPublic:    true,
        isExpired:   false,       // imported profiles don't expire
        expiresAt:   null,

        createdAt:        serverTimestamp(),
        importedByAdmin:  true,
      });

      Alert.alert(
        "Profile created ✅",
        `@${cleanId} is now live on the Stats screen.\n\nWhen ${cleanName} signs up on Playon, they can claim this profile using their phone number.`,
        [{ text: "Create another", onPress: resetForm },
         { text: "Done", onPress: () => router.back() }]
      );
    } catch (e: any) {
      console.error("import player", e);
      Alert.alert("Error", e.message || "Could not create profile. Try again.");
    } finally { setSaving(false); }
  };

  const resetForm = () => {
    setDisplayName(""); setPlayonId(""); setPhone(""); setBio(""); setAge("");
    setSelectedSport(""); setPlayerRole(""); setBattingHand(""); setBowlingStyle("");
    setStMatches("0"); setStWins("0"); setStLosses("0"); setStDraws("0");
    setStRuns("0"); setStWickets("0"); setStFifties("0"); setStHundreds("0");
    setStGoals("0"); setStAssists("0");
    setIdAvailable(null);
  };

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <View style={s.safe}>
      <StatusBar barStyle="light-content" backgroundColor={DARK} />

      {/* ── Header ── */}
       <View style={[s.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity style={s.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={20} color="#fff" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={s.headerTitle}>Import Player</Text>
          <Text style={s.headerSub}>Create a profile for outside players</Text>
        </View>
      </View>

      <ScrollView
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 60 }}
      >
        {/* ── Info banner ── */}
        <View style={s.infoBanner}>
          <Ionicons name="information-circle-outline" size={18} color="#1D4ED8" />
          <Text style={s.infoBannerTxt}>
            This creates a public Playon profile for players from other league apps.
            They can claim it later by signing up with their phone number.
          </Text>
        </View>

        {/* ══════════════════════════════ */}
        {/* IDENTITY                       */}
        {/* ══════════════════════════════ */}
        <SectionHeader icon="person-outline" label="Identity" color="#7C3AED" />
        <View style={s.card}>

          {/* Avatar preview */}
          <View style={s.avatarPreview}>
            <View style={s.avatarCircle}>
              <Text style={s.avatarInitials}>{initials(displayName || "?")}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.avatarName}>{displayName.trim() || "Player name"}</Text>
              <Text style={s.avatarId}>
                {playonId ? `@${playonId}` : "@playonid"}
              </Text>
            </View>
            {/* Imported badge */}
            <View style={s.importedBadge}>
              <Ionicons name="download-outline" size={11} color="#1D4ED8" />
              <Text style={s.importedBadgeTxt}>Imported</Text>
            </View>
          </View>

          <View style={s.divider} />

          <FieldRow label="Display name *" icon="person-outline">
            <TextInput
              style={s.fieldInput}
              value={displayName}
              onChangeText={setDisplayName}
              placeholder="Player's full name"
              placeholderTextColor="#9CA3AF"
              maxLength={40}
            />
          </FieldRow>

          <View style={s.divider} />

          {/* Playon ID with availability check */}
          <FieldRow label="Playon ID *" icon="at-outline">
            <View style={s.idRow}>
              <Text style={s.atSign}>@</Text>
              <TextInput
                style={[s.fieldInput, { flex: 1 }]}
                value={playonId}
                onChangeText={checkId}
                placeholder="unique_id"
                placeholderTextColor="#9CA3AF"
                autoCapitalize="none"
                autoCorrect={false}
                maxLength={24}
              />
              {idChecking && <ActivityIndicator size="small" color="#9CA3AF" />}
              {!idChecking && idAvailable === true  && <Ionicons name="checkmark-circle" size={18} color={GREEN} />}
              {!idChecking && idAvailable === false && <Ionicons name="close-circle"     size={18} color="#EF4444" />}
            </View>
            {idAvailable === false && (
              <Text style={s.idError}>This ID is already taken.</Text>
            )}
            <Text style={s.idHint}>Lowercase letters, numbers, underscore only. Cannot change later.</Text>
          </FieldRow>

          <View style={s.divider} />

          <FieldRow label="Phone number" icon="call-outline">
            <TextInput
              style={s.fieldInput}
              value={phone}
              onChangeText={setPhone}
              placeholder="+91 98765 43210 (for claim matching)"
              placeholderTextColor="#9CA3AF"
              keyboardType="phone-pad"
              maxLength={15}
            />
          </FieldRow>

          <View style={s.divider} />

          <FieldRow label="Bio" icon="document-text-outline">
            <TextInput
              style={[s.fieldInput, s.fieldInputMulti]}
              value={bio}
              onChangeText={setBio}
              placeholder="e.g. Right arm fast · Amravati"
              placeholderTextColor="#9CA3AF"
              multiline maxLength={120}
              textAlignVertical="top"
            />
          </FieldRow>

          <View style={s.divider} />

          <FieldRow label="Age" icon="calendar-outline">
            <TextInput
              style={[s.fieldInput, { width: 80 }]}
              value={age}
              onChangeText={(v) => setAge(v.replace(/[^0-9]/g, ""))}
              placeholder="—"
              placeholderTextColor="#9CA3AF"
              keyboardType="numeric"
              maxLength={2}
            />
          </FieldRow>
        </View>

        {/* ══════════════════════════════ */}
        {/* SPORT                          */}
        {/* ══════════════════════════════ */}
        <SectionHeader icon="trophy-outline" label="Primary sport *" color="#2563EB" />
        <View style={s.card}>
          <View style={s.chipsWrap}>
            {SPORTS_LIST.map((sp) => (
              <TouchableOpacity
                key={sp}
                style={[s.chip, selectedSport === sp && s.chipActive]}
                onPress={() => { setSelectedSport(sp); setPlayerRole(""); }}
                activeOpacity={0.75}
              >
                <Text style={[s.chipTxt, selectedSport === sp && s.chipTxtActive]}>{sp}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* ══════════════════════════════ */}
        {/* ROLE                           */}
        {/* ══════════════════════════════ */}
        {roles.length > 0 && (
          <>
            <SectionHeader icon="shield-outline" label={`Role in ${selectedSport}`} color="#059669" />
            <View style={s.card}>
              <View style={s.chipsWrap}>
                {roles.map((r) => (
                  <TouchableOpacity
                    key={r.value}
                    style={[s.chip, playerRole === r.value && s.chipActive]}
                    onPress={() => setPlayerRole(playerRole === r.value ? "" : r.value)}
                    activeOpacity={0.75}
                  >
                    <Text style={[s.chipTxt, playerRole === r.value && s.chipTxtActive]}>
                      {r.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </>
        )}

        {/* ══════════════════════════════ */}
        {/* CRICKET SUB-FIELDS             */}
        {/* ══════════════════════════════ */}
        {isCricket && (
          <>
            <SectionHeader icon="baseball-outline" label="Playing style" color="#7C3AED" />
            <View style={s.card}>
              <Text style={s.chipGroupLabel}>Batting hand</Text>
              <View style={s.chipsWrap}>
                {BATTING_HANDS.map((h) => (
                  <TouchableOpacity
                    key={h}
                    style={[s.chip, battingHand === h && s.chipActive]}
                    onPress={() => setBattingHand(battingHand === h ? "" : h)}
                    activeOpacity={0.75}
                  >
                    <Text style={[s.chipTxt, battingHand === h && s.chipTxtActive]}>{h}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <View style={s.divider} />
              <Text style={[s.chipGroupLabel, { marginTop: 12 }]}>Bowling style</Text>
              <View style={s.chipsWrap}>
                {BOWLING_STYLES.map((bs) => (
                  <TouchableOpacity
                    key={bs}
                    style={[s.chip, bowlingStyle === bs && s.chipActive]}
                    onPress={() => setBowlingStyle(bowlingStyle === bs ? "" : bs)}
                    activeOpacity={0.75}
                  >
                    <Text style={[s.chipTxt, bowlingStyle === bs && s.chipTxtActive]}>{bs}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </>
        )}

        {/* ══════════════════════════════ */}
        {/* PAST STATS                     */}
        {/* ══════════════════════════════ */}
        <SectionHeader
          icon="stats-chart-outline"
          label={selectedSport ? `${selectedSport} past stats` : "Past stats"}
          color="#EA580C"
          hint="Enter what the player tells you"
        />
        <View style={s.card}>

          {/* Common */}
          <Text style={s.statsSubLabel}>General</Text>
          <View style={s.statsGrid}>
            <StatInput label="Matches" value={stMatches} onChange={setStMatches} />
            <StatInput label="Wins"    value={stWins}    onChange={setStWins}    />
            <StatInput label="Losses"  value={stLosses}  onChange={setStLosses}  />
            <StatInput label="Draws"   value={stDraws}   onChange={setStDraws}   />
          </View>

          {/* Cricket */}
          {isCricket && (
            <>
              <View style={s.divider} />
              <Text style={s.statsSubLabel}>Batting</Text>
              <View style={s.statsGrid}>
                <StatInput label="Runs"    value={stRuns}     onChange={setStRuns}     accent="#7C3AED" />
                <StatInput label="50s"     value={stFifties}  onChange={setStFifties}  accent="#7C3AED" />
                <StatInput label="100s"    value={stHundreds} onChange={setStHundreds} accent="#7C3AED" />
              </View>
              <View style={[s.divider, { marginTop: 12 }]} />
              <Text style={s.statsSubLabel}>Bowling</Text>
              <View style={s.statsGrid}>
                <StatInput label="Wickets" value={stWickets}  onChange={setStWickets}  accent="#059669" />
              </View>
            </>
          )}

          {/* Football */}
          {isFootball && (
            <>
              <View style={s.divider} />
              <Text style={s.statsSubLabel}>Attacking</Text>
              <View style={s.statsGrid}>
                <StatInput label="Goals"   value={stGoals}   onChange={setStGoals}   accent="#2563EB" />
                <StatInput label="Assists" value={stAssists} onChange={setStAssists} accent="#2563EB" />
              </View>
            </>
          )}
        </View>

        {/* ══════════════════════════════ */}
        {/* CLAIM INFO BOX                 */}
        {/* ══════════════════════════════ */}
        <View style={s.claimBox}>
          <Ionicons name="link-outline" size={18} color="#059669" />
          <View style={{ flex: 1 }}>
            <Text style={s.claimTitle}>How the player claims this profile</Text>
            <Text style={s.claimSub}>
              When they sign up on Playon and create a Playon ID, they can claim this
              imported profile if their phone number matches. All stats carry over automatically.
            </Text>
          </View>
        </View>

        {/* ══════════════════════════════ */}
        {/* SAVE BUTTON                    */}
        {/* ══════════════════════════════ */}
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
                  <Ionicons name="person-add-outline" size={18} color="#fff" />
                  <Text style={s.saveBtnTxt}>
                    Create Profile{displayName.trim() ? ` for ${displayName.trim().split(" ")[0]}` : ""}
                  </Text>
                </>
            }
          </TouchableOpacity>

          <TouchableOpacity style={s.cancelBtn} onPress={() => router.back()} disabled={saving}>
            <Text style={s.cancelBtnTxt}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function SectionHeader({
  icon, label, color, hint,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string; color: string; hint?: string;
}) {
  return (
    <View style={s.sectionHeader}>
      <View style={[s.sectionIconWrap, { backgroundColor: color + "18" }]}>
        <Ionicons name={icon} size={15} color={color} />
      </View>
      <Text style={s.sectionLabel}>{label}</Text>
      {!!hint && <Text style={s.sectionHint}> · {hint}</Text>}
    </View>
  );
}

function FieldRow({
  label, icon, children,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  children: React.ReactNode;
}) {
  return (
    <View style={s.fieldRow}>
      <Ionicons name={icon} size={16} color="#9CA3AF" style={{ marginTop: 2 }} />
      <View style={{ flex: 1 }}>
        <Text style={s.fieldLabel}>{label}</Text>
        {children}
      </View>
    </View>
  );
}

function StatInput({
  label, value, onChange, accent,
}: {
  label: string; value: string;
  onChange: (v: string) => void;
  accent?: string;
}) {
  return (
    <View style={s.statBox}>
      <Text style={[s.statBoxLabel, accent && { color: accent }]}>{label}</Text>
      <TextInput
        style={[s.statBoxInput, accent && { borderColor: accent + "44", color: accent }]}
        value={value}
        onChangeText={(v) => onChange(v.replace(/[^0-9]/g, ""))}
        keyboardType="numeric"
        selectTextOnFocus
        maxLength={6}
      />
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#F0F4F8" },

  header: {
    backgroundColor: DARK, flexDirection: "row", alignItems: "center", gap: 14,
    paddingHorizontal: 16,
    paddingBottom: 18,
  },
  backBtn:     { width: 38, height: 38, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.08)", justifyContent: "center", alignItems: "center" },
  headerTitle: { color: "#fff", fontSize: 18, fontWeight: "900" },
  headerSub:   { color: "#9CA3AF", fontSize: 12, marginTop: 2 },

  infoBanner: {
    flexDirection: "row", alignItems: "flex-start", gap: 10,
    backgroundColor: "#EFF6FF", borderRadius: 14, padding: 14,
    margin: 16, borderWidth: 1, borderColor: "#BFDBFE",
  },
  infoBannerTxt: { fontSize: 13, color: "#1D4ED8", fontWeight: "500", flex: 1, lineHeight: 19 },

  sectionHeader:   { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingTop: 18, paddingBottom: 8 },
  sectionIconWrap: { width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  sectionLabel:    { fontSize: 13, fontWeight: "800", color: DARK },
  sectionHint:     { fontSize: 12, color: "#9CA3AF" },

  card: {
    marginHorizontal: 16, backgroundColor: "#fff",
    borderRadius: 16, borderWidth: 1, borderColor: "#E5E7EB",
    paddingHorizontal: 16, paddingVertical: 14,
  },

  // Avatar preview
  avatarPreview:   { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 12 },
  avatarCircle:    { width: 48, height: 48, borderRadius: 24, backgroundColor: "#7C3AED", alignItems: "center", justifyContent: "center" },
  avatarInitials:  { color: "#fff", fontWeight: "900", fontSize: 18 },
  avatarName:      { fontSize: 15, fontWeight: "800", color: DARK },
  avatarId:        { fontSize: 12, color: "#6B7280", marginTop: 2 },
  importedBadge:   { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#EFF6FF", borderRadius: 10, paddingHorizontal: 8, paddingVertical: 4 },
  importedBadgeTxt:{ fontSize: 11, fontWeight: "700", color: "#1D4ED8" },

  fieldRow:         { paddingVertical: 10, flexDirection: "row", gap: 12, alignItems: "flex-start" },
  fieldLabel:       { fontSize: 11, fontWeight: "700", color: "#9CA3AF", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 5 },
  fieldInput:       { fontSize: 15, color: DARK, fontWeight: "500", paddingVertical: 0 },
  fieldInputMulti:  { minHeight: 56, lineHeight: 22 },
  divider:          { height: 1, backgroundColor: "#F3F4F6", marginVertical: 4 },

  idRow:    { flexDirection: "row", alignItems: "center", gap: 4 },
  atSign:   { fontSize: 15, fontWeight: "700", color: "#9CA3AF" },
  idError:  { fontSize: 12, color: "#EF4444", marginTop: 4 },
  idHint:   { fontSize: 11, color: "#9CA3AF", marginTop: 3, lineHeight: 16 },

  chipsWrap:      { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingVertical: 6 },
  chip:           { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1, borderColor: "#E5E7EB", backgroundColor: "#F9FAFB" },
  chipActive:     { backgroundColor: "#DCFCE7", borderColor: GREEN },
  chipTxt:        { fontSize: 13, fontWeight: "600", color: "#6B7280" },
  chipTxtActive:  { color: "#15803D" },
  chipGroupLabel: { fontSize: 11, fontWeight: "700", color: "#9CA3AF", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 8 },

  statsGrid:     { flexDirection: "row", flexWrap: "wrap", gap: 12, paddingVertical: 8 },
  statsSubLabel: { fontSize: 11, fontWeight: "700", color: "#9CA3AF", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 4 },
  statBox:       { alignItems: "center", minWidth: 72 },
  statBoxLabel:  { fontSize: 11, fontWeight: "700", color: "#6B7280", textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 6 },
  statBoxInput: {
    fontSize: 22, fontWeight: "900", color: DARK, textAlign: "center",
    width: 80, borderWidth: 1.5, borderColor: "#E5E7EB",
    borderRadius: 12, paddingVertical: 8, paddingHorizontal: 4,
    backgroundColor: "#F9FAFB",
  },

  claimBox: {
    flexDirection: "row", alignItems: "flex-start", gap: 10,
    backgroundColor: "#F0FDF4", borderRadius: 14, padding: 14,
    marginHorizontal: 16, marginTop: 20,
    borderWidth: 1, borderColor: "#BBF7D0",
  },
  claimTitle: { fontSize: 13, fontWeight: "800", color: "#15803D", marginBottom: 4 },
  claimSub:   { fontSize: 12, color: "#15803D", lineHeight: 18, opacity: 0.85 },

  btnWrap: { marginHorizontal: 16, marginTop: 24, gap: 10 },
  saveBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: GREEN, borderRadius: 14, paddingVertical: 15,
  },
  saveBtnTxt: { fontSize: 15, fontWeight: "800", color: "#fff" },
  cancelBtn:  { alignItems: "center", paddingVertical: 13, borderRadius: 14, borderWidth: 1, borderColor: "#E5E7EB", backgroundColor: "#fff" },
  cancelBtnTxt: { fontSize: 15, fontWeight: "600", color: "#6B7280" },
});
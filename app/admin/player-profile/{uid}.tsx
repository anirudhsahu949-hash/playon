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

import { useState, useRef, useCallback } from "react";
import { db } from "../../../firebaseConfig";
import {
  collection, query, where, getDocs,
  doc, getDoc, updateDoc, serverTimestamp, limit,
} from "firebase/firestore";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

// =======================================================
// 🛡️ ADMIN — PLAYER PROFILES MANAGER
// app/admin/admin-player-profiles.tsx
//
// Flow:
//  1. Admin types a name / @playonid → prefix search → dropdown
//  2. Tap a player → their full profile loads below
//  3. Admin edits:
//     - Identity: displayName, bio, age, sports, role
//     - Stats (sport-aware):
//         Cricket  → runs, wickets, fifties, hundreds, matches, wins, losses
//         Football → goals, assists, matches, wins, losses
//         Others   → matches, wins, losses, draws
//     - Privacy toggle (isPublic)
//  4. Save → updateDoc on playerProfiles/{uid}
// =======================================================

const DARK    = "#0A0F1E";
const GREEN   = "#16A34A";
const PURPLE  = "#7C3AED";
const SEARCH_LIMIT = 8;

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

// ── Helpers ───────────────────────────────────────────────────────────────────
function initials(name: string) {
  return (name || "?").trim().split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
}
function primarySport(sports: string[]) {
  return sports?.[0] || "";
}

type PlayerHit = {
  uid:         string;
  displayName: string;
  playonId:    string;
  sport:       string;
};

// ── Main ─────────────────────────────────────────────────────────────────────
export default function AdminPlayerProfiles() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  // ── Search state ──────────────────────────────────────────────────────────
  const [searchText,    setSearchText]    = useState("");
  const [searching,     setSearching]     = useState(false);
  const [suggestions,   setSuggestions]   = useState<PlayerHit[]>([]);
  const [showDrop,      setShowDrop]      = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Selected player state ─────────────────────────────────────────────────
  const [selectedUid,   setSelectedUid]   = useState<string | null>(null);
  const [loadingPlayer, setLoadingPlayer] = useState(false);
  const [saving,        setSaving]        = useState(false);

  // Identity fields
  const [displayName,    setDisplayName]    = useState("");
  const [bio,            setBio]            = useState("");
  const [age,            setAge]            = useState("");
  const [selectedSports, setSelectedSports] = useState<string[]>([]);
  const [playerRole,     setPlayerRole]     = useState("");
  const [battingHand,    setBattingHand]    = useState("");
  const [bowlingStyle,   setBowlingStyle]   = useState("");
  const [isPublic,       setIsPublic]       = useState(true);
  const [playonId,       setPlayonId]       = useState(""); // display only

  // Stat fields (strings so TextInput works cleanly)
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
  const [stPoints,   setStPoints]   = useState("0");

  const primary    = primarySport(selectedSports);
  const isCricket  = primary === "Cricket";
  const isFootball = primary === "Football";
  const roles      = SPORT_ROLES[primary] || [];

  // ── Search ────────────────────────────────────────────────────────────────
  const onSearchChange = (text: string) => {
    setSearchText(text);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!text.trim()) { setSuggestions([]); setShowDrop(false); return; }
    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const term = text.trim().toLowerCase().replace(/^@/, "");
        if (term.length < 2) { setSearching(false); return; }
        const end  = term.slice(0, -1) + String.fromCharCode(term.charCodeAt(term.length - 1) + 1);
        const [byName, byId] = await Promise.all([
          getDocs(query(collection(db, "playerProfiles"),
            where("displayNameLower", ">=", term), where("displayNameLower", "<", end), limit(SEARCH_LIMIT))),
          getDocs(query(collection(db, "playerProfiles"),
            where("playonId", ">=", term), where("playonId", "<", end), limit(SEARCH_LIMIT))),
        ]);
        const seen = new Set<string>();
        const hits: PlayerHit[] = [];
        for (const snap of [...byName.docs, ...byId.docs]) {
          if (seen.has(snap.id)) continue;
          seen.add(snap.id);
          const d = snap.data();
          hits.push({
            uid:         snap.id,
            displayName: d.displayName || d.playonId || "Unknown",
            playonId:    d.playonId    || "",
            sport:       primarySport(d.sports || []),
          });
        }
        setSuggestions(hits);
        setShowDrop(true);
      } catch (e) { console.error("search", e); }
      finally { setSearching(false); }
    }, 400);
  };

  // ── Load selected player ──────────────────────────────────────────────────
  const selectPlayer = async (hit: PlayerHit) => {
    Keyboard.dismiss();
    setShowDrop(false);
    setSearchText(hit.displayName);
    setSelectedUid(hit.uid);
    setLoadingPlayer(true);
    try {
      const snap = await getDoc(doc(db, "playerProfiles", hit.uid));
      if (!snap.exists()) { Alert.alert("Not found", "Profile missing."); return; }
      const d  = snap.data();
      const st = d.stats || {};
      // Identity
      setPlayonId(d.playonId        || "");
      setDisplayName(d.displayName  || "");
      setBio(d.bio                  || "");
      setAge(d.age ? String(d.age)  : "");
      setSelectedSports(Array.isArray(d.sports) ? d.sports : []);
      setPlayerRole(d.playerRole    || "");
      setBattingHand(d.battingHand  || "");
      setBowlingStyle(d.bowlingStyle || "");
      setIsPublic(d.isPublic !== false);
      // Stats
      setStMatches(String(st.matches   || 0));
      setStWins(String(st.wins         || 0));
      setStLosses(String(st.losses     || 0));
      setStDraws(String(st.draws       || 0));
      setStRuns(String(st.runs         || 0));
      setStWickets(String(st.wickets   || 0));
      setStFifties(String(st.fifties   || 0));
      setStHundreds(String(st.hundreds || 0));
      setStGoals(String(st.goals       || 0));
      setStAssists(String(st.assists   || 0));
      setStPoints(String(st.points     || 0));
    } catch (e) {
      console.error("load player", e);
      Alert.alert("Error", "Could not load player profile.");
    } finally { setLoadingPlayer(false); }
  };

  const clearPlayer = () => {
    setSelectedUid(null);
    setSearchText("");
    setSuggestions([]);
    setShowDrop(false);
  };

  // ── Sport toggle ──────────────────────────────────────────────────────────
  const toggleSport = (sp: string) => {
    setSelectedSports((prev) => {
      const next = prev.includes(sp) ? prev.filter((x) => x !== sp) : [...prev, sp];
      if (next[0] !== prev[0]) setPlayerRole("");
      return next;
    });
  };

  // ── num helper ────────────────────────────────────────────────────────────
  const n = (v: string) => Math.max(0, Number(v) || 0);

  // ── Save ──────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!selectedUid) return;
    if (!displayName.trim()) { Alert.alert("Name required"); return; }
    if (selectedSports.length === 0) { Alert.alert("Sport required"); return; }
    if (age && (isNaN(Number(age)) || n(age) < 5 || n(age) > 80)) {
      Alert.alert("Invalid age", "Must be 5–80."); return;
    }
    Keyboard.dismiss();
    setSaving(true);
    try {
      const cleanName = displayName.trim();
      await updateDoc(doc(db, "playerProfiles", selectedUid), {
        // Identity
        displayName:      cleanName,
        displayNameLower: cleanName.toLowerCase(),
        bio:              bio.trim(),
        age:              age ? n(age) : null,
        sports:           selectedSports,
        playerRole:       playerRole  || null,
        battingHand:      battingHand || null,
        bowlingStyle:     bowlingStyle || null,
        isPublic,
        // Stats — always write all fields so nothing is orphaned
        "stats.matches":  n(stMatches),
        "stats.wins":     n(stWins),
        "stats.losses":   n(stLosses),
        "stats.draws":    n(stDraws),
        "stats.runs":     n(stRuns),
        "stats.wickets":  n(stWickets),
        "stats.fifties":  n(stFifties),
        "stats.hundreds": n(stHundreds),
        "stats.goals":    n(stGoals),
        "stats.assists":  n(stAssists),
        "stats.points":   n(stPoints),
        updatedAt:        serverTimestamp(),
        updatedByAdmin:   true,
      });
      Alert.alert("Saved ✅", `${cleanName}'s profile updated.`);
    } catch (e: any) {
      console.error("save", e);
      Alert.alert("Error", e.message || "Could not save.");
    } finally { setSaving(false); }
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
          <Text style={s.headerTitle}>Player Profiles</Text>
          <Text style={s.headerSub}>Search · select · update stats</Text>
        </View>
      </View>

      <ScrollView
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 60 }}
        onScrollBeginDrag={() => setShowDrop(false)}
      >

        {/* ══════════════════════════════════════════ */}
        {/* SEARCH                                     */}
        {/* ══════════════════════════════════════════ */}
        <View style={s.searchSection}>
          <Text style={s.searchLabel}>Search player</Text>
          <View style={s.searchBar}>
            <Ionicons name="search-outline" size={17} color="#9CA3AF" />
            <TextInput
              style={s.searchInput}
              value={searchText}
              onChangeText={onSearchChange}
              placeholder="Name or @playonid"
              placeholderTextColor="#9CA3AF"
              autoCapitalize="none"
              autoCorrect={false}
            />
            {searching && <ActivityIndicator size="small" color="#9CA3AF" />}
            {searchText.length > 0 && !searching && (
              <TouchableOpacity onPress={clearPlayer} hitSlop={8}>
                <Ionicons name="close-circle" size={18} color="#D1D5DB" />
              </TouchableOpacity>
            )}
          </View>

          {/* Dropdown */}
          {showDrop && suggestions.length > 0 && (
            <View style={s.dropdown}>
              {suggestions.map((hit, i) => (
                <TouchableOpacity
                  key={hit.uid}
                  style={[s.dropItem, i < suggestions.length - 1 && s.dropItemBorder]}
                  onPress={() => selectPlayer(hit)}
                  activeOpacity={0.7}
                >
                  <View style={s.dropAvatar}>
                    <Text style={s.dropAvatarTxt}>{initials(hit.displayName)}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.dropName}>{hit.displayName}</Text>
                    <Text style={s.dropSub}>
                      {hit.playonId ? `@${hit.playonId}` : ""}
                      {hit.playonId && hit.sport ? " · " : ""}
                      {hit.sport}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color="#D1D5DB" />
                </TouchableOpacity>
              ))}
            </View>
          )}

          {showDrop && !searching && searchText.trim().length >= 2 && suggestions.length === 0 && (
            <View style={s.dropEmpty}>
              <Text style={s.dropEmptyTxt}>No players found for "{searchText}"</Text>
            </View>
          )}
        </View>

        {/* ══════════════════════════════════════════ */}
        {/* PLAYER EDITOR (shown after selection)      */}
        {/* ══════════════════════════════════════════ */}
        {selectedUid && (
          loadingPlayer ? (
            <View style={s.loadingWrap}>
              <ActivityIndicator color={GREEN} size="large" />
              <Text style={s.loadingTxt}>Loading profile…</Text>
            </View>
          ) : (
            <>
              {/* Player header card */}
              <View style={s.playerCard}>
                <View style={s.playerAvatar}>
                  <Text style={s.playerAvatarTxt}>{initials(displayName)}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.playerCardName}>{displayName}</Text>
                  <Text style={s.playerCardId}>@{playonId}</Text>
                  <Text style={s.playerCardSport}>{primary || "No sport set"}</Text>
                </View>
                <TouchableOpacity onPress={clearPlayer} hitSlop={8}>
                  <Ionicons name="close-circle" size={22} color="#9CA3AF" />
                </TouchableOpacity>
              </View>

              {/* ══════════════════════════ */}
              {/* IDENTITY                   */}
              {/* ══════════════════════════ */}
              <SectionHeader icon="person-outline" label="Identity" color="#7C3AED" />
              <View style={s.card}>

                <View style={s.fieldBlock}>
                  <Text style={s.fieldLbl}>Display name</Text>
                  <TextInput
                    style={s.fieldInput}
                    value={displayName}
                    onChangeText={setDisplayName}
                    placeholder="Full name"
                    placeholderTextColor="#9CA3AF"
                    maxLength={40}
                  />
                </View>

                <Divider />

                <View style={s.fieldBlock}>
                  <Text style={s.fieldLbl}>Bio</Text>
                  <TextInput
                    style={[s.fieldInput, s.fieldInputMulti]}
                    value={bio}
                    onChangeText={setBio}
                    placeholder="Short bio…"
                    placeholderTextColor="#9CA3AF"
                    multiline
                    maxLength={120}
                    textAlignVertical="top"
                  />
                </View>

                <Divider />

                <View style={s.fieldBlock}>
                  <Text style={s.fieldLbl}>Age</Text>
                  <TextInput
                    style={[s.fieldInput, { width: 80 }]}
                    value={age}
                    onChangeText={(v) => setAge(v.replace(/[^0-9]/g, ""))}
                    placeholder="—"
                    placeholderTextColor="#9CA3AF"
                    keyboardType="numeric"
                    maxLength={2}
                  />
                </View>

              </View>

              {/* Sports */}
              <SectionHeader icon="trophy-outline" label="Sports" color="#2563EB" hint="First = primary sport" />
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
                        {isPrimary && <Ionicons name="star" size={10} color="#15803D" />}
                        <Text style={[s.chipTxt, active && s.chipTxtActive]}>{sp}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              {/* Role */}
              {roles.length > 0 && (
                <>
                  <SectionHeader icon="shield-outline" label={`Role in ${primary}`} color="#059669" />
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

              {/* Cricket sub-fields */}
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

              {/* ══════════════════════════════════════ */}
              {/* STATS — sport-aware                    */}
              {/* ══════════════════════════════════════ */}
              <SectionHeader
                icon="stats-chart-outline"
                label={`${primary || "General"} stats`}
                color="#EA580C"
              />
              <View style={s.card}>

                {/* Common: Matches / Wins / Losses / Draws */}
                <View style={s.statsGrid}>
                  <StatInput label="Matches" value={stMatches} onChange={setStMatches} />
                  <StatInput label="Wins"    value={stWins}    onChange={setStWins}    />
                  <StatInput label="Losses"  value={stLosses}  onChange={setStLosses}  />
                  <StatInput label="Draws"   value={stDraws}   onChange={setStDraws}   />
                </View>

                {/* Cricket specific */}
                {isCricket && (
                  <>
                    <View style={s.divider} />
                    <Text style={s.statsSubLabel}>Batting</Text>
                    <View style={s.statsGrid}>
                      <StatInput label="Runs"     value={stRuns}     onChange={setStRuns}     accent="#7C3AED" />
                      <StatInput label="50s"      value={stFifties}  onChange={setStFifties}  accent="#7C3AED" />
                      <StatInput label="100s"     value={stHundreds} onChange={setStHundreds} accent="#7C3AED" />
                    </View>
                    <View style={[s.divider, { marginTop: 12 }]} />
                    <Text style={s.statsSubLabel}>Bowling</Text>
                    <View style={s.statsGrid}>
                      <StatInput label="Wickets"  value={stWickets}  onChange={setStWickets}  accent="#059669" />
                    </View>
                  </>
                )}

                {/* Football specific */}
                {isFootball && (
                  <>
                    <View style={s.divider} />
                    <Text style={s.statsSubLabel}>Attacking</Text>
                    <View style={s.statsGrid}>
                      <StatInput label="Goals"    value={stGoals}    onChange={setStGoals}    accent="#2563EB" />
                      <StatInput label="Assists"  value={stAssists}  onChange={setStAssists}  accent="#2563EB" />
                    </View>
                  </>
                )}

                {/* Other sports: points */}
                {!isCricket && !isFootball && (
                  <>
                    <View style={s.divider} />
                    <View style={s.statsGrid}>
                      <StatInput label="Points"   value={stPoints}   onChange={setStPoints}   />
                    </View>
                  </>
                )}

              </View>

              {/* ══════════════════════════ */}
              {/* PRIVACY                   */}
              {/* ══════════════════════════ */}
              <SectionHeader icon="eye-outline" label="Visibility" color="#6B7280" />
              <View style={s.card}>
                <View style={s.switchRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.switchLabel}>Public profile</Text>
                    <Text style={s.switchSub}>
                      {isPublic
                        ? "Visible in Stats leaderboard and search"
                        : "Hidden from leaderboard and public search"
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

              {/* ══════════════════════════ */}
              {/* SAVE BUTTON               */}
              {/* ══════════════════════════ */}
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
                        <Text style={s.saveBtnTxt}>Save {displayName}'s Profile</Text>
                      </>
                  }
                </TouchableOpacity>

                <TouchableOpacity style={s.cancelBtn} onPress={clearPlayer} disabled={saving}>
                  <Text style={s.cancelBtnTxt}>Clear selection</Text>
                </TouchableOpacity>
              </View>
            </>
          )
        )}

        {/* Empty state */}
        {!selectedUid && !showDrop && (
          <View style={s.emptyState}>
            <View style={s.emptyIcon}>
              <Ionicons name="person-circle-outline" size={36} color={GREEN} />
            </View>
            <Text style={s.emptyTitle}>Search for a player</Text>
            <Text style={s.emptySub}>
              Type their name or @playonid above.{"\n"}
              Select them to update their stats, role, and profile details.
            </Text>
          </View>
        )}

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
      {!!hint && <Text style={s.sectionHint}>{hint}</Text>}
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

function Divider() {
  return <View style={s.divider} />;
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

  // Search
  searchSection: { padding: 16, paddingBottom: 0 },
  searchLabel:   { fontSize: 11, fontWeight: "700", color: "#6B7280", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 },
  searchBar: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "#fff", borderRadius: 14,
    borderWidth: 1, borderColor: "#E5E7EB",
    paddingHorizontal: 14, paddingVertical: Platform.OS === "android" ? 9 : 13,
  },
  searchInput: { flex: 1, fontSize: 15, color: DARK, paddingVertical: 0 },

  // Dropdown
  dropdown: {
    backgroundColor: "#fff", borderRadius: 14, borderWidth: 1, borderColor: "#E5E7EB",
    marginTop: 4, overflow: "hidden",
    shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.1, shadowRadius: 12, elevation: 6,
  },
  dropItem:       { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 13 },
  dropItemBorder: { borderBottomColor: "#F3F4F6", borderBottomWidth: 1 },
  dropAvatar:     { width: 38, height: 38, borderRadius: 19, backgroundColor: DARK, alignItems: "center", justifyContent: "center" },
  dropAvatarTxt:  { color: "#fff", fontWeight: "800", fontSize: 14 },
  dropName:       { fontSize: 14, fontWeight: "700", color: DARK },
  dropSub:        { fontSize: 12, color: "#6B7280", marginTop: 2 },
  dropEmpty:      { backgroundColor: "#fff", borderRadius: 12, padding: 14, marginTop: 4, alignItems: "center" },
  dropEmptyTxt:   { fontSize: 13, color: "#9CA3AF" },

  // Loading
  loadingWrap: { alignItems: "center", paddingTop: 60, gap: 12 },
  loadingTxt:  { fontSize: 13, color: "#6B7280" },

  // Player card
  playerCard: {
    flexDirection: "row", alignItems: "center", gap: 12,
    marginHorizontal: 16, marginTop: 16,
    backgroundColor: "#fff", borderRadius: 16, padding: 14,
    borderWidth: 1.5, borderColor: "#BBF7D0",
  },
  playerAvatar:    { width: 48, height: 48, borderRadius: 24, backgroundColor: PURPLE, alignItems: "center", justifyContent: "center" },
  playerAvatarTxt: { color: "#fff", fontWeight: "900", fontSize: 18 },
  playerCardName:  { fontSize: 16, fontWeight: "800", color: DARK },
  playerCardId:    { fontSize: 12, color: "#6B7280", marginTop: 1 },
  playerCardSport: { fontSize: 12, color: GREEN, fontWeight: "600", marginTop: 2 },

  // Section header
  sectionHeader:   { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingTop: 20, paddingBottom: 8 },
  sectionIconWrap: { width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  sectionLabel:    { fontSize: 13, fontWeight: "800", color: DARK },
  sectionHint:     { fontSize: 11, color: "#9CA3AF", marginLeft: 4 },

  // Card
  card: {
    marginHorizontal: 16, backgroundColor: "#fff",
    borderRadius: 16, borderWidth: 1, borderColor: "#E5E7EB",
    paddingHorizontal: 16, paddingVertical: 14,
  },

  // Field
  fieldBlock:      { paddingVertical: 8 },
  fieldLbl:        { fontSize: 11, fontWeight: "700", color: "#9CA3AF", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 6 },
  fieldInput:      { fontSize: 15, color: DARK, fontWeight: "500", paddingVertical: 0 },
  fieldInputMulti: { minHeight: 60, lineHeight: 22 },
  divider:         { height: 1, backgroundColor: "#F3F4F6", marginVertical: 6 },

  // Chips
  chipsWrap:      { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingVertical: 6 },
  chip:           { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1, borderColor: "#E5E7EB", backgroundColor: "#F9FAFB", flexDirection: "row", alignItems: "center", gap: 4 },
  chipActive:     { backgroundColor: "#DCFCE7", borderColor: GREEN },
  chipTxt:        { fontSize: 13, fontWeight: "600", color: "#6B7280" },
  chipTxtActive:  { color: "#15803D" },
  chipGroupLabel: { fontSize: 11, fontWeight: "700", color: "#9CA3AF", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 8 },

  // Stats grid
  statsGrid:     { flexDirection: "row", flexWrap: "wrap", gap: 12, paddingVertical: 8 },
  statsSubLabel: { fontSize: 11, fontWeight: "700", color: "#9CA3AF", textTransform: "uppercase", letterSpacing: 0.4, marginTop: 12, marginBottom: 4 },
  statBox:       { alignItems: "center", minWidth: 72 },
  statBoxLabel:  { fontSize: 11, fontWeight: "700", color: "#6B7280", textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 6 },
  statBoxInput: {
    fontSize: 22, fontWeight: "900", color: DARK, textAlign: "center",
    width: 80, borderWidth: 1.5, borderColor: "#E5E7EB",
    borderRadius: 12, paddingVertical: 8, paddingHorizontal: 4,
    backgroundColor: "#F9FAFB",
  },

  // Privacy switch
  switchRow:  { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 4 },
  switchLabel:{ fontSize: 15, fontWeight: "700", color: DARK, marginBottom: 3 },
  switchSub:  { fontSize: 12, color: "#6B7280", lineHeight: 17 },

  // Buttons
  btnWrap: { marginHorizontal: 16, marginTop: 24, gap: 10, marginBottom: 20 },
  saveBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: GREEN, borderRadius: 14, paddingVertical: 15,
  },
  saveBtnTxt: { fontSize: 15, fontWeight: "800", color: "#fff" },
  cancelBtn:  { alignItems: "center", paddingVertical: 13, borderRadius: 14, borderWidth: 1, borderColor: "#E5E7EB", backgroundColor: "#fff" },
  cancelBtnTxt: { fontSize: 15, fontWeight: "600", color: "#6B7280" },

  // Empty
  emptyState: { alignItems: "center", paddingTop: 60, paddingHorizontal: 40 },
  emptyIcon:  { width: 72, height: 72, borderRadius: 36, backgroundColor: "#F0FDF4", alignItems: "center", justifyContent: "center", marginBottom: 14 },
  emptyTitle: { fontSize: 18, fontWeight: "800", color: DARK, textAlign: "center" },
  emptySub:   { fontSize: 13, color: "#6B7280", textAlign: "center", marginTop: 8, lineHeight: 20 },
});
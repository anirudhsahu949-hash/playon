import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  SafeAreaView,
  StatusBar,
  Platform,
  ActivityIndicator,
  RefreshControl,
  Alert,
  KeyboardAvoidingView,
} from "react-native";
import { db, auth } from "../../../firebaseConfig";
import { doc, getDoc, collection, query, where, getDocs } from "firebase/firestore";
import { getIdToken } from "firebase/auth";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import TeamAvatar, { TeamBadgePicker } from "../../../components/Teamavatar";

// =============================================================================
// 🛠️ MANAGE LEAGUE — organizer-only control screen
// Reachable by whoever created the league (league.organizerId === current uid).
// Three tabs: Overview, Teams, Matches. Fresh build — replaces the old
// (league-owner)/LeagueTeams.tsx + LeagueMatches.tsx, which were never
// actually wired up to a working screen.
// =============================================================================

const SERVER_URL = "https://bookora-backend-95u4.onrender.com";

const GREEN   = "#16A34A";
const GREEN_D = "#15803D";
const DARK    = "#0B1220";
const PAGE_BG = "#F0F1F5";
const GRAY    = "#9AA3B2";

const FORMAT_LABEL: Record<string, string> = {
  round_robin: "Round Robin",
  knockout: "Knockout",
  groups_knockout: "Groups + Knockout",
};

const STATUS_CFG: Record<string, { label: string; color: string; bg: string }> = {
  registration_open: { label: "REGISTRATION OPEN", color: "#2563EB", bg: "#EFF6FF" },
  ongoing:           { label: "ONGOING",            color: GREEN,    bg: "#F0FDF4" },
  completed:         { label: "COMPLETED",          color: GRAY,     bg: "#F3F4F6" },
};

type Tab = "overview" | "teams" | "matches";

type League = {
  name: string; sport: string; format: string; city: string; venue: string;
  description: string; startDate: string; status: string; hostType: string;
  entryFee: number; maxTeams: number; teamCount: number; organizerId: string;
};

type PlayerRow = { name: string };
type Team = {
  id: string; name: string; captainName: string;
  iconName?: string | null; iconColor?: string | null;
  players: { name: string }[]; playerCount: number;
};

type Match = {
  id: string; teamAId: string; teamAName: string; teamBId: string; teamBName: string;
  date: string; startTime: string; endTime: string; venue: string;
  status: string; scoreA: number; scoreB: number;
};

async function getAuthToken(): Promise<string | null> {
  try {
    const user = auth.currentUser;
    if (!user) return null;
    return await getIdToken(user);
  } catch {
    return null;
  }
}

export default function ManageLeague() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab]               = useState<Tab>("overview");
  const [league, setLeague]         = useState<League | null>(null);
  const [teams, setTeams]           = useState<Team[]>([]);
  const [matches, setMatches]       = useState<Match[]>([]);
  const [notOwner, setNotOwner]     = useState(false);

  const uid = auth.currentUser?.uid || null;

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const leagueSnap = await getDoc(doc(db, "leagues", id));
      if (!leagueSnap.exists()) { setLoading(false); return; }
      const l = leagueSnap.data() as League;

      if (uid !== l.organizerId) {
        setLeague(l);
        setNotOwner(true);
        setLoading(false);
        return;
      }
      setNotOwner(false);
      setLeague(l);

      const [teamSnap, matchSnap] = await Promise.all([
        getDocs(query(collection(db, "leagueTeams"), where("leagueId", "==", id))),
        getDocs(query(collection(db, "leagueMatches"), where("leagueId", "==", id))),
      ]);

      const teamList: Team[] = teamSnap.docs.map((d) => {
        const t = d.data();
        return {
          id: d.id,
          name: t.name || "Team",
          captainName: t.captainName || "",
          iconName: t.iconName ?? null,
          iconColor: t.iconColor ?? null,
          players: Array.isArray(t.players) ? t.players : [],
          playerCount: Number(t.playerCount || (Array.isArray(t.players) ? t.players.length : 0)),
        };
      });
      teamList.sort((a, b) => a.name.localeCompare(b.name));

      const matchList: Match[] = matchSnap.docs.map((d) => {
        const m = d.data();
        return {
          id: d.id,
          teamAId: m.teamAId || "", teamAName: m.teamAName || "Team A",
          teamBId: m.teamBId || "", teamBName: m.teamBName || "Team B",
          date: m.date || "", startTime: m.startTime || "", endTime: m.endTime || "",
          venue: m.venue || "", status: m.status || "scheduled",
          scoreA: Number(m.scoreA || 0), scoreB: Number(m.scoreB || 0),
        };
      });
      const rank: Record<string, number> = { live: 0, scheduled: 1, completed: 2, finished: 2 };
      matchList.sort((a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9) || a.date.localeCompare(b.date));

      setTeams(teamList);
      setMatches(matchList);
    } catch (e) {
      console.error("manage-league load:", e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [id, uid]);

  useFocusEffect(useCallback(() => { setLoading(true); load(); }, [load]));
  const onRefresh = () => { setRefreshing(true); load(); };

  if (loading) {
    return (
      <SafeAreaView style={s.safe}>
        <StatusBar barStyle="dark-content" backgroundColor={PAGE_BG} />
        <View style={s.center}><ActivityIndicator color={GREEN} size="large" /></View>
      </SafeAreaView>
    );
  }

  if (!league) {
    return (
      <SafeAreaView style={s.safe}>
        <StatusBar barStyle="dark-content" backgroundColor={PAGE_BG} />
        <View style={s.center}>
          <Ionicons name="trophy-outline" size={36} color={GRAY} />
          <Text style={s.notFoundTxt}>League not found</Text>
          <TouchableOpacity onPress={() => router.back()} style={{ marginTop: 12 }}>
            <Text style={{ color: GREEN, fontWeight: "700" }}>Go back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (notOwner) {
    return (
      <SafeAreaView style={s.safe}>
        <StatusBar barStyle="dark-content" backgroundColor={PAGE_BG} />
        <View style={s.center}>
          <Ionicons name="lock-closed-outline" size={36} color={GRAY} />
          <Text style={s.notFoundTxt}>You don't manage this league</Text>
          <Text style={s.notFoundSub}>Only {league.name}'s organizer can access these controls.</Text>
          <TouchableOpacity onPress={() => router.back()} style={{ marginTop: 12 }}>
            <Text style={{ color: GREEN, fontWeight: "700" }}>Go back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const statusCfg = STATUS_CFG[league.status] || STATUS_CFG.registration_open;

  return (
    <SafeAreaView style={s.safe} edges={["top"]}>
      <StatusBar barStyle="dark-content" backgroundColor={PAGE_BG} />

      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn} hitSlop={10}>
          <Ionicons name="chevron-back" size={22} color={DARK} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={s.headerTitle} numberOfLines={1}>{league.name}</Text>
          <Text style={s.headerSub}>Manage league</Text>
        </View>
        <View style={[s.statusPill, { backgroundColor: statusCfg.bg }]}>
          <Text style={[s.statusTxt, { color: statusCfg.color }]}>{statusCfg.label}</Text>
        </View>
      </View>

      {/* Tabs */}
      <View style={s.tabBar}>
        {([
          { key: "overview", label: "Overview", icon: "information-circle-outline" },
          { key: "teams",    label: "Teams",    icon: "people-outline" },
          { key: "matches",  label: "Matches",  icon: "calendar-outline" },
        ] as { key: Tab; label: string; icon: keyof typeof Ionicons.glyphMap }[]).map((t) => {
          const active = tab === t.key;
          return (
            <TouchableOpacity key={t.key} style={s.tabBtn} onPress={() => setTab(t.key)} activeOpacity={0.8}>
              <Ionicons name={t.icon} size={16} color={active ? GREEN : GRAY} />
              <Text style={[s.tabTxt, active && s.tabTxtActive]}>{t.label}</Text>
              <View style={[s.tabUnder, active && s.tabUnderActive]} />
            </TouchableOpacity>
          );
        })}
      </View>

      {tab === "overview" && (
        <OverviewTab league={league} teams={teams} matches={matches} refreshing={refreshing} onRefresh={onRefresh} />
      )}
      {tab === "teams" && (
        <TeamsTab
          leagueId={id!}
          teams={teams}
          refreshing={refreshing}
          onRefresh={onRefresh}
          onTeamAdded={load}
        />
      )}
      {tab === "matches" && (
        <MatchesTab
          leagueId={id!}
          teams={teams}
          matches={matches}
          refreshing={refreshing}
          onRefresh={onRefresh}
          onMatchAdded={load}
          router={router}
        />
      )}
    </SafeAreaView>
  );
}

// ── OVERVIEW TAB ──────────────────────────────────────────────────────────────
function OverviewTab({
  league, teams, matches, refreshing, onRefresh,
}: {
  league: League; teams: Team[]; matches: Match[]; refreshing: boolean; onRefresh: () => void;
}) {
  const liveCount = matches.filter((m) => m.status === "live").length;
  const upcomingCount = matches.filter((m) => m.status === "scheduled").length;
  const completedCount = matches.filter((m) => m.status === "completed" || m.status === "finished").length;

  return (
    <ScrollView
      contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={GREEN} />}
    >
      {/* Stat row */}
      <View style={ov.statRow}>
        <View style={ov.statCard}>
          <Text style={ov.statVal}>{teams.length}</Text>
          <Text style={ov.statLabel}>Teams</Text>
        </View>
        <View style={ov.statCard}>
          <Text style={ov.statVal}>{upcomingCount}</Text>
          <Text style={ov.statLabel}>Upcoming</Text>
        </View>
        <View style={ov.statCard}>
          <Text style={[ov.statVal, liveCount > 0 && { color: "#E11D2A" }]}>{liveCount}</Text>
          <Text style={ov.statLabel}>Live</Text>
        </View>
        <View style={ov.statCard}>
          <Text style={ov.statVal}>{completedCount}</Text>
          <Text style={ov.statLabel}>Completed</Text>
        </View>
      </View>

      {/* Details card */}
      <View style={ov.card}>
        <DetailRow icon="baseball-outline" label="Sport" value={league.sport} />
        <DetailRow icon="albums-outline" label="Format" value={FORMAT_LABEL[league.format] || league.format} />
        <DetailRow icon="location-outline" label="City" value={league.city} />
        {!!league.venue && <DetailRow icon="pin-outline" label="Venue" value={league.venue} />}
        {!!league.startDate && <DetailRow icon="calendar-outline" label="Start date" value={league.startDate} />}
        <DetailRow
          icon="people-outline"
          label="Hosting type"
          value={league.hostType === "open" ? `Open registration (${league.teamCount}/${league.maxTeams} teams)` : "Managed by you"}
        />
        <DetailRow icon="pricetag-outline" label="Entry fee" value="Free" />
      </View>

      {!!league.description && (
        <View style={ov.descCard}>
          <Text style={ov.descLabel}>DESCRIPTION</Text>
          <Text style={ov.descTxt}>{league.description}</Text>
        </View>
      )}

      {teams.length === 0 && (
        <View style={ov.nudge}>
          <Ionicons name="people-outline" size={18} color={GREEN_D} />
          <Text style={ov.nudgeTxt}>Add at least 2 teams in the Teams tab before scheduling matches.</Text>
        </View>
      )}
    </ScrollView>
  );
}

function DetailRow({ icon, label, value }: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string }) {
  return (
    <View style={ov.detailRow}>
      <Ionicons name={icon} size={16} color={GRAY} style={{ width: 22 }} />
      <Text style={ov.detailLabel}>{label}</Text>
      <Text style={ov.detailValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}

const ov = StyleSheet.create({
  statRow: { flexDirection: "row", gap: 10, marginBottom: 16 },
  statCard: {
    flex: 1, backgroundColor: "#fff", borderRadius: 14, paddingVertical: 14,
    alignItems: "center", shadowColor: DARK, shadowOpacity: 0.04, shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 }, elevation: 1,
  },
  statVal: { fontSize: 20, fontWeight: "900", color: DARK },
  statLabel: { fontSize: 10.5, color: GRAY, fontWeight: "600", marginTop: 3 },

  card: { backgroundColor: "#fff", borderRadius: 16, padding: 14, marginBottom: 14 },
  detailRow: { flexDirection: "row", alignItems: "center", paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: "#F3F4F6" },
  detailLabel: { flex: 1, fontSize: 13, color: GRAY, fontWeight: "600" },
  detailValue: { flex: 1.4, fontSize: 13.5, color: DARK, fontWeight: "700", textAlign: "right" },

  descCard: { backgroundColor: "#fff", borderRadius: 16, padding: 14, marginBottom: 14 },
  descLabel: { fontSize: 10.5, fontWeight: "700", color: GRAY, letterSpacing: 0.5, marginBottom: 6 },
  descTxt: { fontSize: 13.5, color: "#374151", lineHeight: 20 },

  nudge: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "#F0FDF4", borderRadius: 12, padding: 12,
  },
  nudgeTxt: { flex: 1, fontSize: 12.5, color: GREEN_D, fontWeight: "600" },
});

// ── TEAMS TAB ─────────────────────────────────────────────────────────────────
function TeamsTab({
  leagueId, teams, refreshing, onRefresh, onTeamAdded,
}: {
  leagueId: string; teams: Team[]; refreshing: boolean; onRefresh: () => void; onTeamAdded: () => void;
}) {
  const [showForm, setShowForm] = useState(false);
  const [teamName, setTeamName] = useState("");
  const [captainName, setCaptainName] = useState("");
  const [playerRows, setPlayerRows] = useState<PlayerRow[]>([{ name: "" }]);
  const [iconName, setIconName] = useState<string | null>(null);
  const [iconColor, setIconColor] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const resetForm = () => {
    setTeamName(""); setCaptainName(""); setPlayerRows([{ name: "" }]);
    setIconName(null); setIconColor(null); setShowForm(false);
  };

  const updatePlayerName = (i: number, v: string) => {
    setPlayerRows((prev) => prev.map((p, idx) => (idx === i ? { name: v } : p)));
  };
  const addPlayerRow = () => setPlayerRows((prev) => [...prev, { name: "" }]);
  const removePlayerRow = (i: number) => setPlayerRows((prev) => prev.filter((_, idx) => idx !== i));

  const saveTeam = async () => {
    if (!teamName.trim()) return Alert.alert("Team name required", "Give the team a name.");
    setSaving(true);
    try {
      const token = await getAuthToken();
      if (!token) { setSaving(false); return Alert.alert("Not signed in", "Please log in again."); }

      const cleanPlayers = playerRows.filter((p) => p.name.trim()).map((p) => ({ name: p.name.trim() }));

      const res = await fetch(`${SERVER_URL}/add-team`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          leagueId, name: teamName.trim(), captainName: captainName.trim(),
          players: cleanPlayers, iconName, iconColor,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "Failed to add team.");

      resetForm();
      onTeamAdded();
    } catch (e: any) {
      Alert.alert("Error", e.message || "Something went wrong.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={GREEN} />}
      >
        <View style={tt.headRow}>
          <Text style={tt.sectionTitle}>Teams ({teams.length})</Text>
          {!showForm && (
            <TouchableOpacity style={tt.addBtn} onPress={() => setShowForm(true)} activeOpacity={0.85}>
              <Ionicons name="add" size={17} color="#fff" />
              <Text style={tt.addBtnTxt}>Add Team</Text>
            </TouchableOpacity>
          )}
        </View>

        {showForm && (
          <View style={tt.formCard}>
            <Text style={tt.formTitle}>New team</Text>

            <Text style={tt.label}>Team name *</Text>
            <TextInput style={tt.input} value={teamName} onChangeText={setTeamName} placeholder="e.g. Warriors" placeholderTextColor={GRAY} maxLength={40} />

            <Text style={tt.label}>Captain (optional)</Text>
            <TextInput style={tt.input} value={captainName} onChangeText={setCaptainName} placeholder="e.g. Rohit" placeholderTextColor={GRAY} maxLength={40} />

            <Text style={tt.label}>Players</Text>
            {playerRows.map((p, i) => (
              <View key={i} style={tt.playerRow}>
                <TextInput
                  style={[tt.input, { flex: 1 }]}
                  value={p.name}
                  onChangeText={(v) => updatePlayerName(i, v)}
                  placeholder={`Player ${i + 1} name`}
                  placeholderTextColor={GRAY}
                  maxLength={40}
                />
                {playerRows.length > 1 && (
                  <TouchableOpacity onPress={() => removePlayerRow(i)} style={tt.removeBtn} hitSlop={8}>
                    <Ionicons name="close-circle" size={20} color="#DC2626" />
                  </TouchableOpacity>
                )}
              </View>
            ))}
            <TouchableOpacity onPress={addPlayerRow} style={tt.addPlayerBtn} activeOpacity={0.8}>
              <Ionicons name="add-circle-outline" size={16} color={GREEN_D} />
              <Text style={tt.addPlayerTxt}>Add another player</Text>
            </TouchableOpacity>

            <View style={{ marginTop: 12 }}>
              <TeamBadgePicker
                iconName={iconName}
                iconColor={iconColor}
                onChange={(icon, color) => { setIconName(icon); setIconColor(color); }}
                previewName={teamName || "Team"}
              />
            </View>

            <View style={tt.formActions}>
              <TouchableOpacity style={tt.cancelBtn} onPress={resetForm} activeOpacity={0.8}>
                <Text style={tt.cancelTxt}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[tt.saveBtn, saving && { opacity: 0.7 }]}
                onPress={saveTeam}
                disabled={saving}
                activeOpacity={0.85}
              >
                {saving ? <ActivityIndicator color="#fff" /> : <Text style={tt.saveTxt}>Save Team</Text>}
              </TouchableOpacity>
            </View>
          </View>
        )}

        {teams.length === 0 && !showForm ? (
          <View style={tt.empty}>
            <Ionicons name="people-outline" size={26} color={GREEN} />
            <Text style={tt.emptyTitle}>No teams yet</Text>
            <Text style={tt.emptySub}>Add your first team to get started.</Text>
          </View>
        ) : (
          teams.map((team) => (
            <View key={team.id} style={tt.teamCard}>
              <TeamAvatar name={team.name} iconName={team.iconName} iconColor={team.iconColor} size={44} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={tt.teamName} numberOfLines={1}>{team.name}</Text>
                <Text style={tt.teamMeta}>
                  {team.playerCount} player{team.playerCount === 1 ? "" : "s"}
                  {team.captainName ? ` · Capt. ${team.captainName}` : ""}
                </Text>
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const tt = StyleSheet.create({
  headRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 14 },
  sectionTitle: { fontSize: 17, fontWeight: "800", color: DARK },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: GREEN, paddingHorizontal: 13, paddingVertical: 9, borderRadius: 12 },
  addBtnTxt: { color: "#fff", fontWeight: "700", fontSize: 13 },

  formCard: { backgroundColor: "#fff", borderRadius: 16, padding: 16, marginBottom: 16 },
  formTitle: { fontSize: 15, fontWeight: "800", color: DARK, marginBottom: 12 },
  label: { fontSize: 12.5, fontWeight: "700", color: DARK, marginBottom: 6, marginTop: 10 },
  input: {
    backgroundColor: "#F9FAFB", borderRadius: 10, borderWidth: 1, borderColor: "#E5E7EB",
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: DARK,
  },
  playerRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 },
  removeBtn: { padding: 2 },
  addPlayerBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 10 },
  addPlayerTxt: { color: GREEN_D, fontWeight: "700", fontSize: 13 },

  formActions: { flexDirection: "row", gap: 10, marginTop: 16 },
  cancelBtn: { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 13, borderRadius: 12, backgroundColor: "#F3F4F6" },
  cancelTxt: { color: "#374151", fontWeight: "700", fontSize: 14 },
  saveBtn: { flex: 2, alignItems: "center", justifyContent: "center", paddingVertical: 13, borderRadius: 12, backgroundColor: GREEN },
  saveTxt: { color: "#fff", fontWeight: "700", fontSize: 14 },

  teamCard: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: "#fff", borderRadius: 14, padding: 12, marginBottom: 10,
  },
  teamName: { fontSize: 14.5, fontWeight: "700", color: DARK },
  teamMeta: { fontSize: 12, color: GRAY, marginTop: 2 },

  empty: { alignItems: "center", paddingVertical: 40, gap: 8 },
  emptyTitle: { fontSize: 15, fontWeight: "700", color: DARK },
  emptySub: { fontSize: 13, color: GRAY, textAlign: "center" },
});

// ── MATCHES TAB ───────────────────────────────────────────────────────────────
function MatchesTab({
  leagueId, teams, matches, refreshing, onRefresh, onMatchAdded, router,
}: {
  leagueId: string; teams: Team[]; matches: Match[]; refreshing: boolean;
  onRefresh: () => void; onMatchAdded: () => void; router: ReturnType<typeof useRouter>;
}) {
  const [showForm, setShowForm] = useState(false);
  const [teamAId, setTeamAId] = useState<string | null>(null);
  const [teamBId, setTeamBId] = useState<string | null>(null);
  const [date, setDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [venue, setVenue] = useState("");
  const [saving, setSaving] = useState(false);

  const resetForm = () => {
    setTeamAId(null); setTeamBId(null); setDate(""); setStartTime(""); setEndTime(""); setVenue(""); setShowForm(false);
  };

  const saveMatch = async () => {
    if (!teamAId || !teamBId) return Alert.alert("Pick both teams", "Select Team A and Team B.");
    if (teamAId === teamBId) return Alert.alert("Pick different teams", "A team can't play itself.");
    if (!date.trim()) return Alert.alert("Date required", "e.g. 30 Aug 2026");

    setSaving(true);
    try {
      const token = await getAuthToken();
      if (!token) { setSaving(false); return Alert.alert("Not signed in", "Please log in again."); }

      const res = await fetch(`${SERVER_URL}/add-match`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          leagueId, teamAId, teamBId,
          date: date.trim(), startTime: startTime.trim(), endTime: endTime.trim(), venue: venue.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "Failed to add match.");

      resetForm();
      onMatchAdded();
    } catch (e: any) {
      Alert.alert("Error", e.message || "Something went wrong.");
    } finally {
      setSaving(false);
    }
  };

  const openAddForm = () => {
    if (teams.length < 2) {
      Alert.alert("Add teams first", "You need at least 2 teams to schedule a match.");
      return;
    }
    setShowForm(true);
  };

  return (
    <ScrollView
      contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={GREEN} />}
    >
      <View style={tt.headRow}>
        <Text style={tt.sectionTitle}>Matches ({matches.length})</Text>
        {!showForm && (
          <TouchableOpacity style={tt.addBtn} onPress={openAddForm} activeOpacity={0.85}>
            <Ionicons name="add" size={17} color="#fff" />
            <Text style={tt.addBtnTxt}>Add Match</Text>
          </TouchableOpacity>
        )}
      </View>

      {showForm && (
        <View style={tt.formCard}>
          <Text style={tt.formTitle}>New match</Text>

          <Text style={tt.label}>Team A</Text>
          <View style={mt.chips}>
            {teams.map((t) => {
              const active = teamAId === t.id; const disabled = teamBId === t.id;
              return (
                <TouchableOpacity key={t.id} disabled={disabled} style={[mt.chip, active && mt.chipActive, disabled && { opacity: 0.35 }]} onPress={() => setTeamAId(t.id)}>
                  <Text style={[mt.chipTxt, active && mt.chipTxtActive]}>{t.name}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={tt.label}>Team B</Text>
          <View style={mt.chips}>
            {teams.map((t) => {
              const active = teamBId === t.id; const disabled = teamAId === t.id;
              return (
                <TouchableOpacity key={t.id} disabled={disabled} style={[mt.chip, active && mt.chipActive, disabled && { opacity: 0.35 }]} onPress={() => setTeamBId(t.id)}>
                  <Text style={[mt.chipTxt, active && mt.chipTxtActive]}>{t.name}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={tt.label}>Date *</Text>
          <TextInput style={tt.input} value={date} onChangeText={setDate} placeholder="e.g. 30 Aug 2026" placeholderTextColor={GRAY} maxLength={30} />

          <View style={{ flexDirection: "row", gap: 12 }}>
            <View style={{ flex: 1 }}>
              <Text style={tt.label}>Start time</Text>
              <TextInput style={tt.input} value={startTime} onChangeText={setStartTime} placeholder="4:00 PM" placeholderTextColor={GRAY} maxLength={12} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={tt.label}>End time</Text>
              <TextInput style={tt.input} value={endTime} onChangeText={setEndTime} placeholder="6:00 PM" placeholderTextColor={GRAY} maxLength={12} />
            </View>
          </View>

          <Text style={tt.label}>Venue (optional)</Text>
          <TextInput style={tt.input} value={venue} onChangeText={setVenue} placeholder="e.g. Camp Ground" placeholderTextColor={GRAY} maxLength={60} />

          <View style={tt.formActions}>
            <TouchableOpacity style={tt.cancelBtn} onPress={resetForm} activeOpacity={0.8}>
              <Text style={tt.cancelTxt}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[tt.saveBtn, saving && { opacity: 0.7 }]} onPress={saveMatch} disabled={saving} activeOpacity={0.85}>
              {saving ? <ActivityIndicator color="#fff" /> : <Text style={tt.saveTxt}>Save Match</Text>}
            </TouchableOpacity>
          </View>
        </View>
      )}

      {matches.length === 0 && !showForm ? (
        <View style={tt.empty}>
          <Ionicons name="calendar-outline" size={26} color={GREEN} />
          <Text style={tt.emptyTitle}>No matches yet</Text>
          <Text style={tt.emptySub}>Schedule your first fixture above.</Text>
        </View>
      ) : (
        matches.map((m) => (
          <TouchableOpacity
            key={m.id}
            style={mt.matchCard}
            activeOpacity={0.85}
            onPress={() => router.push(`/(playon-pro)/match/${m.id}` as any)}
          >
            <View style={mt.matchTop}>
              <View style={[mt.statusPill, { backgroundColor: (STATUS_CFG[m.status] || STATUS_CFG.registration_open).bg }]}>
                <Text style={[mt.statusTxt, { color: (STATUS_CFG[m.status] || STATUS_CFG.registration_open).color }]}>
                  {m.status.toUpperCase()}
                </Text>
              </View>
              <Text style={mt.matchDate} numberOfLines={1}>{m.date}{m.startTime ? ` · ${m.startTime}` : ""}</Text>
            </View>
            <Text style={mt.matchTeams} numberOfLines={1}>
              {m.teamAName} <Text style={{ color: GRAY }}>vs</Text> {m.teamBName}
            </Text>
            {(m.status === "completed" || m.status === "finished" || m.status === "live") && (
              <Text style={mt.matchScore}>{m.scoreA} – {m.scoreB}</Text>
            )}
            {!!m.venue && <Text style={mt.matchVenue}>{m.venue}</Text>}
          </TouchableOpacity>
        ))
      )}
    </ScrollView>
  );
}

const mt = StyleSheet.create({
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 4 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 18, backgroundColor: "#F9FAFB", borderWidth: 1, borderColor: "#E5E7EB" },
  chipActive: { backgroundColor: GREEN, borderColor: GREEN },
  chipTxt: { fontSize: 12.5, fontWeight: "700", color: "#6B7280" },
  chipTxtActive: { color: "#fff" },

  matchCard: { backgroundColor: "#fff", borderRadius: 14, padding: 13, marginBottom: 10 },
  matchTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  statusPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  statusTxt: { fontSize: 9.5, fontWeight: "800", letterSpacing: 0.3 },
  matchDate: { fontSize: 11, color: GRAY, fontWeight: "600", flexShrink: 1 },
  matchTeams: { fontSize: 14, fontWeight: "700", color: DARK },
  matchScore: { fontSize: 13, fontWeight: "800", color: GREEN_D, marginTop: 3 },
  matchVenue: { fontSize: 11.5, color: GRAY, marginTop: 3 },
});

// ── Shared screen styles ──────────────────────────────────────────────────────
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: PAGE_BG },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 6 },
  notFoundTxt: { fontSize: 15, fontWeight: "700", color: DARK, marginTop: 8, textAlign: "center" },
  notFoundSub: { fontSize: 13, color: GRAY, textAlign: "center" },

  header: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingHorizontal: 16,
    paddingTop: Platform.OS === "android" ? (StatusBar.currentHeight ?? 0) + 12 : 8,
    paddingBottom: 12, backgroundColor: PAGE_BG,
  },
  backBtn: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: "#fff" },
  headerTitle: { fontSize: 17, fontWeight: "800", color: DARK },
  headerSub: { fontSize: 12, color: GRAY, marginTop: 1 },
  statusPill: { paddingHorizontal: 9, paddingVertical: 5, borderRadius: 8 },
  statusTxt: { fontSize: 9.5, fontWeight: "800", letterSpacing: 0.3 },

  tabBar: { flexDirection: "row", backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#EAEBEE" },
  tabBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 13 },
  tabTxt: { fontSize: 13, fontWeight: "600", color: GRAY },
  tabTxtActive: { color: GREEN, fontWeight: "800" },
  tabUnder: { position: "absolute", bottom: -1, left: 12, right: 12, height: 2, backgroundColor: "transparent", borderRadius: 2 },
  tabUnderActive: { backgroundColor: GREEN },
});
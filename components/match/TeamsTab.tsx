import {
  View, Text, StyleSheet, ScrollView,
  TouchableOpacity, ActivityIndicator, RefreshControl,
} from "react-native";
import { useState, useCallback } from "react";
import { db } from "../../firebaseConfig";
import { collection, query, where, getDocs } from "firebase/firestore";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";

// =============================================================================
// 👥 TEAMS TAB — redesigned v2
//
// Changes from v1:
//   • Removed summary row (teams / players / with captain)
//   • Each team card has a unique colored gradient header
//   • Captain + player count shown in the header — no separate chips
//   • Player rows compact (8px padding, 30px avatar)
//   • Captain highlighted with amber "CAPTAIN" badge
//   • Pro chip shown inline next to name
// =============================================================================

const BG    = "#EAECF5";
const DARK  = "#1B2050";
const MUTED = "#8A8FA8";
const GREEN = "#16A34A";

type Player = { name: string; uid?: string; playonId?: string };
type Team = {
  id: string; name: string; captainName: string;
  players: Player[]; playerCount: number;
};
type TeamsTabProps = { leagueId: string };

// Gradient pairs per team index — vivid but not garish
const TEAM_GRADIENTS: [string, string][] = [
  ["#1B2050", "#2E3C8C"],  // Navy
  ["#44330A", "#92400E"],  // Amber/Brown
  ["#14532D", "#15803D"],  // Green
  ["#3B0764", "#6D28D9"],  // Purple
  ["#0C4A6E", "#0369A1"],  // Sky
  ["#7F1D1D", "#B91C1C"],  // Red
  ["#134E4A", "#0F766E"],  // Teal
  ["#1E1B4B", "#4338CA"],  // Indigo
];

function playerInitials(name: string): string {
  return (name || "?").split(" ").map(w => w[0] || "").join("").toUpperCase().slice(0, 2);
}

function teamInitials(name: string): string {
  return (name || "?").split(" ").map(w => w[0] || "").join("").toUpperCase().slice(0, 2);
}

export default function TeamsTab({ leagueId }: TeamsTabProps) {
  const [teams,      setTeams]      = useState<Team[]>([]);
  const [expanded,   setExpanded]   = useState<Set<string>>(new Set());
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!leagueId) { setLoading(false); return; }
    try {
      const snap = await getDocs(
        query(collection(db, "leagueTeams"), where("leagueId", "==", leagueId))
      );
      const list: Team[] = snap.docs.map(d => {
        const t = d.data();
        return {
          id:          d.id,
          name:        t.name        || "Team",
          captainName: t.captainName || "",
          players:     Array.isArray(t.players) ? t.players : [],
          playerCount: Number(t.playerCount || (Array.isArray(t.players) ? t.players.length : 0)),
        };
      });
      list.sort((a, b) => a.name.localeCompare(b.name));
      setTeams(list);
      // Auto-expand first team
      if (list.length > 0) setExpanded(new Set([list[0].id]));
    } catch (e) { console.error("TeamsTab:", e); }
    finally { setLoading(false); setRefreshing(false); }
  }, [leagueId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  const onRefresh = () => { setRefreshing(true); load(); };

  const toggle = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  if (loading) return (
    <View style={s.center}><ActivityIndicator color={GREEN} size="large" /></View>
  );

  if (teams.length === 0) return (
    <View style={s.center}>
      <View style={s.emptyIcon}>
        <Ionicons name="people-outline" size={28} color={GREEN} />
      </View>
      <Text style={s.emptyTitle}>No teams yet</Text>
      <Text style={s.emptySub}>Teams appear once the league owner adds them.</Text>
    </View>
  );

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: BG }}
      contentContainerStyle={{ paddingBottom: 100, paddingTop: 12 }}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={GREEN} />}
    >
      {teams.map((team, ti) => {
        const grad  = TEAM_GRADIENTS[ti % TEAM_GRADIENTS.length];
        const open  = expanded.has(team.id);

        return (
          <View key={team.id} style={s.card}>

            {/* ── Gradient header ── */}
            <TouchableOpacity activeOpacity={0.85} onPress={() => toggle(team.id)}>
              <LinearGradient
                colors={grad}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={s.gradHeader}
              >
                {/* Decorative circle */}
                <View style={s.deco} />

                <View style={s.headerRow}>
                  {/* Team crest */}
                  <View style={s.crest}>
                    <Text style={s.crestTxt}>{teamInitials(team.name)}</Text>
                  </View>

                  {/* Name + meta */}
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={s.teamName} numberOfLines={1}>{team.name}</Text>
                    <View style={s.headerMeta}>
                      <Text style={s.metaTxt}>{team.players.length} players</Text>
                      {!!team.captainName && (
                        <>
                          <Text style={s.metaDot}>·</Text>
                          <Text style={s.metaStar}>★</Text>
                          <Text style={s.metaCap} numberOfLines={1}>{team.captainName}</Text>
                        </>
                      )}
                    </View>
                  </View>

                  <Ionicons
                    name={open ? "chevron-up" : "chevron-down"}
                    size={18}
                    color="rgba(255,255,255,0.45)"
                  />
                </View>
              </LinearGradient>
            </TouchableOpacity>

            {/* ── Player roster ── */}
            {open && (
              <View style={s.roster}>
                {team.players.length === 0 ? (
                  <Text style={s.noPlayers}>No players added yet.</Text>
                ) : (
                  team.players.map((player, pi) => {
                    const isCaptain   = player.name === team.captainName;
                    const hasPlayonId = !!player.playonId;
                    const isLast      = pi === team.players.length - 1;

                    return (
                      <View
                        key={pi}
                        style={[
                          s.playerRow,
                          isCaptain && s.playerRowCaptain,
                          isLast && { borderBottomWidth: 0 },
                        ]}
                      >
                        {/* Number */}
                        <Text style={s.playerNum}>{pi + 1}</Text>

                        {/* Avatar */}
                        <View style={[s.avatar, { backgroundColor: grad[0] + "18", borderColor: grad[0] + "40" }]}>
                          <Text style={[s.avatarTxt, { color: grad[1] }]}>
                            {playerInitials(player.name)}
                          </Text>
                        </View>

                        {/* Name + id */}
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={s.playerName} numberOfLines={1}>{player.name}</Text>
                          {hasPlayonId && (
                            <Text style={s.playonId}>@{player.playonId}</Text>
                          )}
                        </View>

                        {/* Badges */}
                        <View style={s.badgeRow}>
                          {isCaptain && (
                            <View style={s.captainBadge}>
                              <Text style={s.captainTxt}>CAPTAIN</Text>
                            </View>
                          )}
                          {hasPlayonId && !isCaptain && (
                            <View style={s.proBadge}>
                              <Ionicons name="shield-checkmark-outline" size={9} color={GREEN} />
                              <Text style={s.proTxt}>Pro</Text>
                            </View>
                          )}
                        </View>
                      </View>
                    );
                  })
                )}
              </View>
            )}
          </View>
        );
      })}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  center:     { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, backgroundColor: BG },
  emptyIcon:  { width: 64, height: 64, borderRadius: 32, backgroundColor: GREEN + "14", alignItems: "center", justifyContent: "center" },
  emptyTitle: { fontSize: 16, fontWeight: "700", color: DARK },
  emptySub:   { fontSize: 13, color: MUTED, textAlign: "center", paddingHorizontal: 32, lineHeight: 19 },

  // Card wrapper
  card: {
    marginHorizontal: 10,
    marginBottom: 9,
    borderRadius: 14,
    overflow: "hidden",
    shadowColor: DARK,
    shadowOpacity: 0.16,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },

  // Gradient header
  gradHeader: { padding: 12, paddingVertical: 11, position: "relative", overflow: "hidden" },
  deco: {
    position: "absolute", top: -22, right: -22,
    width: 88, height: 88, borderRadius: 44,
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 11 },
  crest: {
    width: 46, height: 46, borderRadius: 12, flexShrink: 0,
    backgroundColor: "rgba(255,255,255,0.16)",
    borderWidth: 1.5, borderColor: "rgba(255,255,255,0.28)",
    alignItems: "center", justifyContent: "center",
  },
  crestTxt:  { fontSize: 15, fontWeight: "900", color: "#fff" },
  teamName:  { fontSize: 14.5, fontWeight: "800", color: "#fff" },
  headerMeta: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 3, flexWrap: "wrap" },
  metaTxt:   { fontSize: 10, color: "rgba(255,255,255,0.5)", fontWeight: "500" },
  metaDot:   { fontSize: 10, color: "rgba(255,255,255,0.25)" },
  metaStar:  { fontSize: 10, color: "#FCD34D" },
  metaCap:   { fontSize: 10, color: "rgba(255,255,255,0.65)", fontWeight: "600", flexShrink: 1 },

  // Roster
  roster:    { backgroundColor: "#fff" },
  noPlayers: { fontSize: 13, color: MUTED, padding: 16, textAlign: "center" },

  playerRow: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: 12, paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: "#F4F5FA",
  },
  playerRowCaptain: { backgroundColor: "#FFFDF5" },

  playerNum:  { width: 16, fontSize: 10, color: MUTED, fontWeight: "700", textAlign: "center", flexShrink: 0 },

  avatar: {
    width: 30, height: 30, borderRadius: 15, flexShrink: 0,
    borderWidth: 1.5, alignItems: "center", justifyContent: "center",
  },
  avatarTxt:  { fontSize: 9, fontWeight: "800" },

  playerName: { fontSize: 12.5, fontWeight: "700", color: DARK },
  playonId:   { fontSize: 10, color: MUTED, marginTop: 1 },

  badgeRow:     { flexDirection: "row", alignItems: "center", gap: 5 },
  captainBadge: { backgroundColor: "#FEF3C7", borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2 },
  captainTxt:   { fontSize: 8, fontWeight: "800", color: "#92400E" },
  proBadge:     { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: "#F0FDF4", borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2 },
  proTxt:       { fontSize: 9, fontWeight: "700", color: GREEN },
});

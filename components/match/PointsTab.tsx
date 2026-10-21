import {
  View, Text, StyleSheet, ScrollView,
  ActivityIndicator, RefreshControl,
} from "react-native";
import { useState, useCallback } from "react";
import { db } from "../../firebaseConfig";
import { collection, query, where, getDocs } from "firebase/firestore";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";

// =============================================================================
// 🏆 POINTS TABLE TAB — redesigned v2
//
// Changes from v1:
//   • Dark gradient header (consistent with score card)
//   • Columns tightened: P/W/L = 24px, NRR = 38px, Pts = 32px (removed D/drawn)
//   • Qualification zone (top 2): green left border + "QUALIFICATION ZONE" banner
//   • Elimination zone: dashed red divider
//   • Points shown in a dark navy pill (qualifiers) / gray pill (eliminated)
//   • W column green, L column red, NRR colored by sign
//   • Form pills: 14×14px, W=solid green, L=solid red, D=gray
//   • Team name gets 50px more horizontal room
// =============================================================================

const BG     = "#EEF0F7";
const DARK   = "#1E2340";
const MEDIUM = "#4B5270";
const MUTED  = "#8A8FA8";
const BORDER = "#E2E5F0";
const GREEN  = "#16A34A";
const RED    = "#E11D2A";

type TeamRow = {
  id: string; name: string;
  played: number; won: number; lost: number; drawn: number;
  nrr: number; points: number;
  form: ("W" | "L" | "D")[];
};
type PointsTabProps = { leagueId: string; sport: string };

const TEAM_COLORS = [
  { bg: "#EEF0F7", color: "#1D4ED8", ac: "#BFDBFE" },
  { bg: "#FEF3C7", color: "#92400E", ac: "#FDE68A" },
  { bg: "#F0FDF4", color: "#15803D", ac: "#BBF7D0" },
  { bg: "#FDF2F8", color: "#9D174D", ac: "#FBCFE8" },
  { bg: "#FFF7ED", color: "#9A3412", ac: "#FED7AA" },
  { bg: "#F5F3FF", color: "#5B21B6", ac: "#DDD6FE" },
  { bg: "#F0F9FF", color: "#075985", ac: "#BAE6FD" },
  { bg: "#FFF1F2", color: "#9F1239", ac: "#FECDD3" },
];

// Compact form pill — 14×14px solid color
function FormPill({ result }: { result: "W" | "L" | "D" }) {
  const cfg = {
    W: { bg: GREEN,   c: "#fff" },
    L: { bg: RED,     c: "#fff" },
    D: { bg: "#D1D5DB", c: MUTED },
  }[result];
  return (
    <View style={{ width: 14, height: 14, borderRadius: 3, backgroundColor: cfg.bg, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ fontSize: 7.5, fontWeight: "800", color: cfg.c }}>{result}</Text>
    </View>
  );
}

// Medal or rank badge
function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) return <Text style={s.medal}>🥇</Text>;
  if (rank === 2) return <Text style={s.medal}>🥈</Text>;
  if (rank === 3) return <Text style={s.medal}>🥉</Text>;
  return (
    <View style={s.rankNum}>
      <Text style={s.rankNumTxt}>{rank}</Text>
    </View>
  );
}

export default function PointsTab({ leagueId, sport }: PointsTabProps) {
  const [rows, setRows]           = useState<TeamRow[]>([]);
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!leagueId) { setLoading(false); return; }
    try {
      const teamSnap = await getDocs(query(collection(db, "leagueTeams"), where("leagueId", "==", leagueId)));
      const teamMap: Record<string, TeamRow> = {};
      teamSnap.docs.forEach(d => {
        teamMap[d.id] = { id: d.id, name: d.data().name || "Team", played: 0, won: 0, lost: 0, drawn: 0, nrr: 0, points: 0, form: [] };
      });

      const matchSnap = await getDocs(query(
        collection(db, "leagueMatches"),
        where("leagueId", "==", leagueId),
        where("status", "==", "completed"),
      ));

      matchSnap.docs.forEach(d => {
        const m = d.data(), aId = m.teamAId || "", bId = m.teamBId || "";
        const sA = Number(m.scoreA || 0), sB = Number(m.scoreB || 0);
        if (!teamMap[aId] || !teamMap[bId]) return;
        teamMap[aId].played++; teamMap[bId].played++;
        if (sA > sB) {
          teamMap[aId].won++; teamMap[aId].points += 2; teamMap[bId].lost++;
          teamMap[aId].form.unshift("W"); teamMap[bId].form.unshift("L");
        } else if (sB > sA) {
          teamMap[bId].won++; teamMap[bId].points += 2; teamMap[aId].lost++;
          teamMap[bId].form.unshift("W"); teamMap[aId].form.unshift("L");
        } else {
          teamMap[aId].drawn++; teamMap[aId].points += 1;
          teamMap[bId].drawn++; teamMap[bId].points += 1;
          teamMap[aId].form.unshift("D"); teamMap[bId].form.unshift("D");
        }
        teamMap[aId].nrr += (sA - sB);
        teamMap[bId].nrr += (sB - sA);
      });

      setRows(
        Object.values(teamMap).sort((a, b) =>
          b.points !== a.points ? b.points - a.points :
          b.nrr    !== a.nrr    ? b.nrr - a.nrr :
          a.name.localeCompare(b.name)
        )
      );
    } catch (e) {
      console.error("PointsTab:", e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [leagueId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  const onRefresh = () => { setRefreshing(true); load(); };

  if (loading) return <View style={s.center}><ActivityIndicator color={GREEN} size="large" /></View>;

  if (rows.length === 0) return (
    <View style={s.center}>
      <View style={s.emptyIcon}><Ionicons name="trophy-outline" size={28} color={GREEN} /></View>
      <Text style={s.emptyTitle}>No standings yet</Text>
      <Text style={s.emptySub}>Points table appears once matches are completed.</Text>
    </View>
  );

  const hasCompleted  = rows.some(r => r.played > 0);
  const qualifyCount  = 2; // top 2 qualify

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: BG }}
      contentContainerStyle={{ paddingBottom: 32, paddingTop: 12 }}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={GREEN} />}
    >
      {/* ── Main card ── */}
      <View style={s.card}>

        {/* Dark gradient header with title + column headers */}
        <LinearGradient
          colors={["#1B2050", "#2E3C8C"]}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
          style={s.gradHeader}
        >
          {/* Title row */}
          <View style={s.titleRow}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Ionicons name="trophy" size={15} color="#FCD34D" />
              <Text style={s.tableTitle}>Points Table</Text>
            </View>
            <Text style={s.tableSubtitle}>Group Stage</Text>
          </View>

          {/* Column headers */}
          <View style={s.colHead}>
            <Text style={[s.colH, s.colTeamH]}>TEAM</Text>
            <Text style={s.colH}>P</Text>
            <Text style={s.colH}>W</Text>
            <Text style={s.colH}>L</Text>
            <Text style={[s.colH, { width: 40 }]}>NRR</Text>
            <Text style={[s.colH, s.colPtsH]}>PTS</Text>
          </View>
        </LinearGradient>

        {/* Qualification zone banner */}
        {hasCompleted && (
          <View style={s.zoneBannerGreen}>
            <View style={s.zoneDot} />
            <Text style={s.zoneLabelGreen}>QUALIFICATION ZONE · TOP {qualifyCount}</Text>
          </View>
        )}

        {rows.map((team, i) => {
          const tc        = TEAM_COLORS[i % TEAM_COLORS.length];
          const qualifies = i < qualifyCount && hasCompleted;
          const isElimBoundary = i === qualifyCount && hasCompleted;
          const nrrStr    = `${team.nrr >= 0 ? "+" : ""}${team.nrr.toFixed(2)}`;

          return (
            <View key={team.id}>
              {/* Elimination divider */}
              {isElimBoundary && (
                <View style={s.zoneBannerRed}>
                  <View style={s.zoneDotRed} />
                  <Text style={s.zoneLabelRed}>ELIMINATION ZONE</Text>
                </View>
              )}

              <View style={[
                s.row,
                i === rows.length - 1 && { borderBottomWidth: 0 },
                { borderLeftWidth: 3.5, borderLeftColor: qualifies ? GREEN : "#E5E7EB" },
              ]}>

                {/* Team cell */}
                <View style={s.cellTeam}>
                  {/* Rank */}
                  <View style={s.rankWrap}>
                    <RankBadge rank={i + 1} />
                  </View>

                  {/* Crest */}
                  <View style={[s.crest, { backgroundColor: tc.bg, borderColor: tc.ac }]}>
                    <Text style={[s.crestTxt, { color: tc.color }]}>
                      {team.name.slice(0, 2).toUpperCase()}
                    </Text>
                  </View>

                  {/* Name + form */}
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={s.teamName} numberOfLines={1}>{team.name}</Text>
                    {team.form.length > 0 && (
                      <View style={s.formRow}>
                        {team.form.slice(0, 5).map((f, fi) => <FormPill key={fi} result={f} />)}
                      </View>
                    )}
                  </View>
                </View>

                {/* Stats */}
                <Text style={s.td}>{team.played}</Text>
                <Text style={[s.td, { color: team.won > 0 ? GREEN : MEDIUM, fontWeight: team.won > 0 ? "700" : "600" }]}>{team.won}</Text>
                <Text style={[s.td, { color: team.lost > 0 ? RED : MEDIUM,  fontWeight: team.lost > 0 ? "700" : "600" }]}>{team.lost}</Text>
                <Text style={[s.td, { width: 40, color: team.nrr >= 0 ? GREEN : RED, fontWeight: "700", fontSize: 10.5 }]}>{nrrStr}</Text>

                {/* Points pill */}
                <View style={{ width: 32, alignItems: "center" }}>
                  <View style={[s.ptsPill, qualifies ? s.ptsPillActive : s.ptsPillInactive]}>
                    <Text style={[s.ptsTxt, qualifies ? s.ptsTxtActive : s.ptsTxtInactive]}>{team.points}</Text>
                  </View>
                </View>
              </View>
            </View>
          );
        })}
      </View>

      {/* Legend */}
      <View style={s.legend}>
        <View style={s.legendItem}>
          <View style={[s.legendDot, { backgroundColor: GREEN }]} />
          <Text style={s.legendTxt}>Qualification zone (Top {qualifyCount})</Text>
        </View>
        <Text style={s.legendMeta}>P=Played · W=Won · L=Lost · NRR=Net Run Rate · PTS=Points (W=2, D=1)</Text>
      </View>

      {/* Qualify banner */}
      {rows.length >= 2 && hasCompleted && (
        <View style={s.qualCard}>
          <Ionicons name="information-circle-outline" size={16} color="#2563EB" />
          <Text style={s.qualTxt}>Top {qualifyCount} teams qualify for the next round.</Text>
        </View>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  center:     { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, backgroundColor: BG },
  emptyIcon:  { width: 64, height: 64, borderRadius: 32, backgroundColor: GREEN + "14", alignItems: "center", justifyContent: "center" },
  emptyTitle: { fontSize: 16, fontWeight: "700", color: DARK },
  emptySub:   { fontSize: 13, color: MUTED, textAlign: "center", paddingHorizontal: 32, lineHeight: 19 },

  // Main card
  card: { marginHorizontal: 14, backgroundColor: "#fff", borderRadius: 16, overflow: "hidden", shadowColor: DARK, shadowOpacity: 0.1, shadowRadius: 16, shadowOffset: { width: 0, height: 4 }, elevation: 4 },

  // Gradient header
  gradHeader: { padding: 12, paddingBottom: 10 },
  titleRow:   { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
  tableTitle: { fontSize: 14, fontWeight: "800", color: "#fff" },
  tableSubtitle: { fontSize: 10, color: "rgba(255,255,255,0.45)", fontWeight: "500" },

  // Column headers (on gradient)
  colHead:  { flexDirection: "row", alignItems: "center" },
  colH:     { width: 24, textAlign: "center", fontSize: 8.5, fontWeight: "700", color: "rgba(255,255,255,0.45)", letterSpacing: 0.3 },
  colTeamH: { flex: 1, textAlign: "left", paddingLeft: 2 },
  colPtsH:  { width: 32, fontWeight: "800", color: "rgba(255,255,255,0.7)" },

  // Zone banners
  zoneBannerGreen: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#F0FDF4", paddingVertical: 5, paddingHorizontal: 12, borderTopWidth: 2, borderTopColor: GREEN },
  zoneDot:         { width: 10, height: 10, borderRadius: 2, backgroundColor: GREEN },
  zoneLabelGreen:  { fontSize: 9, fontWeight: "700", color: GREEN, letterSpacing: 0.4 },

  zoneBannerRed:  { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#FFF7F7", paddingVertical: 5, paddingHorizontal: 12, borderTopWidth: 1.5, borderTopColor: "#FECACA", borderTopStyle: "dashed" },
  zoneDotRed:     { width: 10, height: 10, borderRadius: 2, backgroundColor: "#FCA5A5" },
  zoneLabelRed:   { fontSize: 9, fontWeight: "700", color: "#EF4444", letterSpacing: 0.4 },

  // Team rows
  row:      { flexDirection: "row", alignItems: "center", paddingVertical: 15, paddingRight: 10, borderBottomWidth: 1, borderBottomColor: "#F4F6FB", backgroundColor: "#fff" },
  cellTeam: { flex: 1, flexDirection: "row", alignItems: "center", gap: 7, paddingLeft: 8, minWidth: 0 },

  // Rank
  rankWrap: { width: 22, alignItems: "center", flexShrink: 0 },
  medal:    { fontSize: 14 },
  rankNum:  { width: 18, height: 18, borderRadius: 5, backgroundColor: "#F1F3F9", alignItems: "center", justifyContent: "center" },
  rankNumTxt: { fontSize: 10, fontWeight: "800", color: MUTED },

  // Crest
  crest:    { width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center", borderWidth: 1.5, flexShrink: 0 },
  crestTxt: { fontSize: 9, fontWeight: "800" },

  // Name + form
  teamName: { fontSize: 12, fontWeight: "700", color: DARK },
  formRow:  { flexDirection: "row", gap: 2, marginTop: 2 },

  // Stat cells
  td: { width: 24, textAlign: "center", fontSize: 11, color: MEDIUM, fontWeight: "600" },

  // Points pill
  ptsPill:        { borderRadius: 7, paddingHorizontal: 7, paddingVertical: 3, minWidth: 28, alignItems: "center" },
  ptsPillActive:  { backgroundColor: DARK },
  ptsPillInactive:{ backgroundColor: "#F1F3F9" },
  ptsTxt:         { fontSize: 13, fontWeight: "900" },
  ptsTxtActive:   { color: "#fff" },
  ptsTxtInactive: { color: MEDIUM },

  // Footer
  legend:     { marginHorizontal: 14, marginTop: 10, gap: 5 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  legendDot:  { width: 10, height: 10, borderRadius: 2 },
  legendTxt:  { fontSize: 11, color: MUTED, fontWeight: "600" },
  legendMeta: { fontSize: 10, color: MUTED },

  qualCard: { flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: 14, marginTop: 10, backgroundColor: "#EFF6FF", borderRadius: 12, padding: 12, borderWidth: 1, borderColor: "#BFDBFE" },
  qualTxt:  { fontSize: 12, fontWeight: "600", color: "#1D4ED8", flex: 1 },
});

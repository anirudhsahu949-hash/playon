import {
  View, Text, StyleSheet, ScrollView,
  TouchableOpacity,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

// =======================================================
// 📊 STATS TAB — batting/bowling leaders + highlights
// Props: sc, teamA, teamB
// =======================================================

const fixed2   = (n: number) => (isFinite(n) && n > 0 ? n.toFixed(2) : "-");
const oversStr = (b: number) => `${Math.floor((b || 0) / 6)}.${(b || 0) % 6}`;
const oversDec = (b: number) => (b || 0) / 6;

type StatSubTab = "overview" | "batting" | "bowling" | "allrounder" | "fielding";

const STAT_SUB_TABS: { key: StatSubTab; label: string }[] = [
  { key: "overview",    label: "Overview"    },
  { key: "batting",     label: "Batting"     },
  { key: "bowling",     label: "Bowling"     },
  { key: "allrounder",  label: "All Rounder" },
  { key: "fielding",    label: "Fielding"    },
];

const OTHER_STATS = [
  { icon: "flash-outline",         label: "Most Sixes",       color: "#7C3AED", bg: "#F5F3FF" },
  { icon: "baseball-outline",      label: "Most Fours",       color: "#EA580C", bg: "#FFF7ED" },
  { icon: "speedometer-outline",   label: "Best Strike Rate", color: "#059669", bg: "#F0FDF4" },
  { icon: "trending-down-outline", label: "Best Economy",     color: "#2563EB", bg: "#EFF6FF" },
  { icon: "hand-left-outline",     label: "Most Catches",     color: "#D97706", bg: "#FFFBEB" },
  { icon: "ribbon-outline",        label: "Best Fielding %",  color: "#DB2777", bg: "#FDF2F8" },
];

function Avatar({ name, size = 36, color = "#6B7280" }: { name: string; size?: number; color?: string }) {
  const initials = (name || "?").split(" ").map((w: string) => w[0]).slice(0, 2).join("").toUpperCase();
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color + "22", borderWidth: 1.5, borderColor: color + "55", alignItems: "center", justifyContent: "center" }}>
      <Text style={{ fontSize: size * 0.3, fontWeight: "700", color }}>{initials}</Text>
    </View>
  );
}

function HighlightRow({ icon, color, label, value, name, team, last = false }: {
  icon: string; color: string; label: string; value: string; name: string; team: string; last?: boolean;
}) {
  return (
    <View style={[s.hlRow, last && { borderBottomWidth: 0 }]}>
      <View style={[s.hlIcon, { backgroundColor: color + "18" }]}>
        <Ionicons name={icon as any} size={18} color={color} />
      </View>
      <View style={{ flex: 1, marginLeft: 10 }}>
        <Text style={s.hlLabel}>{label}</Text>
        <Text style={s.hlName} numberOfLines={1}>{name} · {team}</Text>
      </View>
      <Text style={[s.hlValue, { color }]}>{value}</Text>
    </View>
  );
}

function buildBattingStats(card: any[], teamName: string) {
  return card
    .filter((b: any) => b.balls > 0)
    .map((b: any) => ({
      name: b.name, team: teamName, balls: b.balls, runs: b.runs,
      fours: b.fours || 0, sixes: b.sixes || 0,
      sr: b.balls > 0 ? +((b.runs / b.balls) * 100).toFixed(2) : 0,
    }))
    .sort((a: any, b: any) => b.runs - a.runs);
}

function buildBowlingStats(card: any[], teamName: string) {
  return card
    .filter((b: any) => b.balls > 0)
    .map((b: any) => ({
      name: b.name, team: teamName, overs: oversStr(b.balls), balls: b.balls,
      maidens: b.maidens || 0, runs: b.runs, wickets: b.wickets || 0,
      econ: b.balls > 0 ? +(b.runs / oversDec(b.balls)).toFixed(2) : 0,
      bbi: `${b.wickets || 0}/${b.runs}`,
    }))
    .sort((a: any, b: any) => b.wickets - a.wickets || a.econ - b.econ);
}

type StatsTabProps = {
  sc: any;
  teamA: string;
  teamB: string;
  statSubTab: StatSubTab;
  setStatSubTab: (t: StatSubTab) => void;
};

export default function StatsTab({ sc, teamA, teamB, statSubTab, setStatSubTab }: StatsTabProps) {

  const innA = sc?.innings1?.teamName === teamA ? sc.innings1 : (sc?.battingTeamName === teamA ? sc : null);
  const innB = sc?.innings1?.teamName === teamB ? sc.innings1 : (sc?.battingTeamName === teamB ? sc : null);

  const allBatting = [
    ...buildBattingStats(innA?.battingCard || [], teamA),
    ...buildBattingStats(innB?.battingCard || [], teamB),
  ].sort((a: any, b: any) => b.runs - a.runs);

  const allBowling = [
    ...buildBowlingStats(innA?.bowlingCard || [], teamB),
    ...buildBowlingStats(innB?.bowlingCard || [], teamA),
  ].sort((a: any, b: any) => b.wickets - a.wickets || a.econ - b.econ);

  const topBatter     = allBatting[0];
  const topBowler     = allBowling[0];
  const topAllrounder = allBatting.find((b) => allBowling.find((w) => w.name === b.name));
  const topSixes  = [...allBatting].sort((a, b) => b.sixes - a.sixes)[0];
  const topFours  = [...allBatting].sort((a, b) => b.fours - a.fours)[0];
  const topSR     = [...allBatting].filter((b) => b.balls >= 6).sort((a, b) => b.sr - a.sr)[0];
  const bestEcon  = [...allBowling].filter((b) => b.balls >= 6).sort((a, b) => a.econ - b.econ)[0];

  return (
    <View style={{ flex: 1, backgroundColor: "#F8FAFC" }}>
      {/* Sub-tab bar */}
      <View style={s.statCatBar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.statCatScroll}>
          {STAT_SUB_TABS.map((t) => {
            const active = statSubTab === t.key;
            return (
              <TouchableOpacity
                key={t.key}
                style={[s.statCatTab, active && s.statCatTabActive]}
                onPress={() => setStatSubTab(t.key)}
                activeOpacity={0.75}
              >
                <Text style={[s.statCatTxt, active && s.statCatTxtActive]}>{t.label}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 100 }} showsVerticalScrollIndicator={false}>
        {!sc ? (
          <View style={s.stub}>
            <Ionicons name="stats-chart-outline" size={28} color="#9CA3AF" />
            <Text style={s.stubTxt}>Stats appear once the match begins.</Text>
          </View>
        ) : (
          <>
            {/* Top Performers */}
            <View style={s.statsRow}>
              <Text style={s.statsSectionTitle}>Top Performers</Text>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.perfRow}>
              {topBatter && (
                <View style={[s.perfCard, { backgroundColor: "#FFF7ED", borderColor: "#FED7AA" }]}>
                  <View style={s.perfCardTop}>
                    <Text style={[s.perfAward, { color: "#EA580C" }]}>🧢 Orange Cap</Text>
                    <Text style={s.perfDesc}>Most Runs</Text>
                  </View>
                  <View style={s.perfAvatarWrap}>
                    <Avatar name={topBatter.name} size={58} color="#EA580C" />
                  </View>
                  <Text style={s.perfName} numberOfLines={1}>{topBatter.name}</Text>
                  <Text style={s.perfTeam}>{topBatter.team}</Text>
                  <Text style={s.perfStat}>{topBatter.runs}</Text>
                  <Text style={s.perfStatLabel}>Runs</Text>
                </View>
              )}
              {topBowler && (
                <View style={[s.perfCard, { backgroundColor: "#F5F3FF", borderColor: "#DDD6FE" }]}>
                  <View style={s.perfCardTop}>
                    <Text style={[s.perfAward, { color: "#7C3AED" }]}>🧢 Purple Cap</Text>
                    <Text style={s.perfDesc}>Most Wickets</Text>
                  </View>
                  <View style={s.perfAvatarWrap}>
                    <Avatar name={topBowler.name} size={58} color="#7C3AED" />
                  </View>
                  <Text style={s.perfName} numberOfLines={1}>{topBowler.name}</Text>
                  <Text style={s.perfTeam}>{topBowler.team}</Text>
                  <Text style={s.perfStat}>{topBowler.wickets}</Text>
                  <Text style={s.perfStatLabel}>Wickets</Text>
                </View>
              )}
              {topAllrounder && (
                <View style={[s.perfCard, { backgroundColor: "#FFFBEB", borderColor: "#FDE68A" }]}>
                  <View style={s.perfCardTop}>
                    <Text style={[s.perfAward, { color: "#D97706" }]}>⭐ MVP</Text>
                    <Text style={s.perfDesc}>Most Valuable</Text>
                  </View>
                  <View style={s.perfAvatarWrap}>
                    <Avatar name={topAllrounder.name} size={58} color="#D97706" />
                  </View>
                  <Text style={s.perfName} numberOfLines={1}>{topAllrounder.name}</Text>
                  <Text style={s.perfTeam}>{topAllrounder.team}</Text>
                  <Text style={s.perfStat}>{topAllrounder.runs}</Text>
                  <Text style={s.perfStatLabel}>Runs</Text>
                </View>
              )}
            </ScrollView>

            {/* Batting Leaders */}
            <View style={s.tableCard}>
              <View style={s.tableHead}>
                <Text style={s.tableSectionTitle}>Batting Leaders</Text>
              </View>
              <View style={s.colHead}>
                <Text style={[s.colH, { width: 24 }]}>#</Text>
                <Text style={[s.colH, { flex: 1, textAlign: "left" }]}>Player</Text>
                <Text style={s.colH}>R</Text>
                <Text style={s.colH}>B</Text>
                <Text style={s.colH}>4s</Text>
                <Text style={s.colH}>6s</Text>
                <Text style={[s.colH, { width: 52 }]}>SR</Text>
              </View>
              {allBatting.length === 0
                ? <Text style={s.noData}>No batting data yet.</Text>
                : allBatting.map((b, i) => (
                  <View key={i} style={[s.statRow, i === allBatting.length - 1 && { borderBottomWidth: 0 }]}>
                    <Text style={[s.rankTxt, { width: 24 }]}>{i + 1}</Text>
                    <View style={s.playerCell}>
                      <Avatar name={b.name} size={34} color="#374151" />
                      <View style={{ marginLeft: 8, flex: 1 }}>
                        <Text style={s.playerName} numberOfLines={1}>{b.name}</Text>
                        <Text style={s.playerTeamTxt}>{b.team}</Text>
                      </View>
                    </View>
                    <Text style={[s.tdNum, s.tdBold]}>{b.runs}</Text>
                    <Text style={s.tdNum}>{b.balls}</Text>
                    <Text style={s.tdNum}>{b.fours}</Text>
                    <Text style={s.tdNum}>{b.sixes}</Text>
                    <Text style={[s.tdNum, { width: 52 }]}>{fixed2(b.sr)}</Text>
                  </View>
                ))}
            </View>

            {/* Bowling Leaders */}
            <View style={s.tableCard}>
              <View style={s.tableHead}>
                <Text style={s.tableSectionTitle}>Bowling Leaders</Text>
              </View>
              <View style={s.colHead}>
                <Text style={[s.colH, { width: 24 }]}>#</Text>
                <Text style={[s.colH, { flex: 1, textAlign: "left" }]}>Player</Text>
                <Text style={s.colH}>O</Text>
                <Text style={s.colH}>R</Text>
                <Text style={s.colH}>W</Text>
                <Text style={s.colH}>Econ</Text>
                <Text style={[s.colH, { width: 52 }]}>BBI</Text>
              </View>
              {allBowling.length === 0
                ? <Text style={s.noData}>No bowling data yet.</Text>
                : allBowling.map((b, i) => (
                  <View key={i} style={[s.statRow, i === allBowling.length - 1 && { borderBottomWidth: 0 }]}>
                    <Text style={[s.rankTxt, { width: 24 }]}>{i + 1}</Text>
                    <View style={s.playerCell}>
                      <Avatar name={b.name} size={34} color="#374151" />
                      <View style={{ marginLeft: 8, flex: 1 }}>
                        <Text style={s.playerName} numberOfLines={1}>{b.name}</Text>
                        <Text style={s.playerTeamTxt}>{b.team}</Text>
                      </View>
                    </View>
                    <Text style={s.tdNum}>{b.overs}</Text>
                    <Text style={s.tdNum}>{b.runs}</Text>
                    <Text style={[s.tdNum, s.tdBold]}>{b.wickets}</Text>
                    <Text style={s.tdNum}>{fixed2(b.econ)}</Text>
                    <Text style={[s.tdNum, { width: 52 }]}>{b.bbi}</Text>
                  </View>
                ))}
            </View>

            {/* Other Stats grid */}
            <View style={s.otherCard}>
              <Text style={s.tableSectionTitle}>Other Stats</Text>
              <View style={s.otherGrid}>
                {OTHER_STATS.map((o, i) => (
                  <TouchableOpacity key={i} style={s.otherItem} activeOpacity={0.75}>
                    <View style={[s.otherIcon, { backgroundColor: o.bg }]}>
                      <Ionicons name={o.icon as any} size={22} color={o.color} />
                    </View>
                    <Text style={s.otherLabel}>{o.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* Match Highlights */}
            {(topSixes || topFours || topSR || bestEcon) && (
              <View style={s.tableCard}>
                <View style={s.tableHead}>
                  <Text style={s.tableSectionTitle}>Match Highlights</Text>
                </View>
                {topSixes  && <HighlightRow icon="flash-outline"         color="#7C3AED" label="Most Sixes"       value={`${topSixes.sixes} sixes`} name={topSixes.name}  team={topSixes.team}  />}
                {topFours  && <HighlightRow icon="baseball-outline"      color="#EA580C" label="Most Fours"       value={`${topFours.fours} fours`} name={topFours.name}  team={topFours.team}  />}
                {topSR     && <HighlightRow icon="speedometer-outline"   color="#059669" label="Best Strike Rate" value={fixed2(topSR.sr)}          name={topSR.name}     team={topSR.team}     />}
                {bestEcon  && <HighlightRow icon="trending-down-outline" color="#2563EB" label="Best Economy"     value={fixed2(bestEcon.econ)}      name={bestEcon.name}  team={bestEcon.team}  last />}
              </View>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  statCatBar:    { backgroundColor: "#fff", borderBottomColor: "#F3F4F6", borderBottomWidth: 1, paddingBottom: 10 },
  statCatScroll: { paddingHorizontal: 14, paddingTop: 10, gap: 8 },
  statCatTab:    { paddingHorizontal: 16, paddingVertical: 7, borderRadius: 20, backgroundColor: "#F3F4F6" },
  statCatTabActive: { backgroundColor: "#EEF2FF" },
  statCatTxt:    { fontSize: 13, fontWeight: "600", color: "#6B7280" },
  statCatTxtActive: { color: "#4F46E5", fontWeight: "700" },

  statsRow:      { paddingHorizontal: 14, paddingTop: 16, paddingBottom: 10 },
  statsSectionTitle: { fontSize: 17, fontWeight: "800", color: "#111827" },
  perfRow:       { paddingHorizontal: 14, gap: 10, paddingBottom: 6 },
  perfCard:      { width: 142, borderRadius: 16, borderWidth: 1.5, padding: 14, alignItems: "center" },
  perfCardTop:   { width: "100%", marginBottom: 12 },
  perfAward:     { fontSize: 12, fontWeight: "800" },
  perfDesc:      { fontSize: 9, color: "#9CA3AF", marginTop: 1 },
  perfAvatarWrap:{ marginBottom: 10 },
  perfName:      { fontSize: 13, fontWeight: "700", color: "#111827", textAlign: "center" },
  perfTeam:      { fontSize: 11, color: "#9CA3AF", marginTop: 2 },
  perfStat:      { fontSize: 26, fontWeight: "800", color: "#111827", marginTop: 10 },
  perfStatLabel: { fontSize: 11, color: "#9CA3AF", marginTop: 1 },

  tableCard:     { marginHorizontal: 12, marginBottom: 10, backgroundColor: "#fff", borderRadius: 16, borderColor: "#E5E7EB", borderWidth: 1, overflow: "hidden" },
  tableHead:     { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingVertical: 14, borderBottomColor: "#F3F4F6", borderBottomWidth: 1 },
  tableSectionTitle: { fontSize: 15, fontWeight: "800", color: "#111827" },
  colHead:       { flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 8, backgroundColor: "#F9FAFB", borderBottomColor: "#F3F4F6", borderBottomWidth: 1 },
  colH:          { width: 38, textAlign: "center", fontSize: 10, fontWeight: "700", color: "#9CA3AF", letterSpacing: 0.3 },
  statRow:       { flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 11, borderBottomColor: "#F9FAFB", borderBottomWidth: 1 },
  rankTxt:       { fontSize: 12, fontWeight: "700", color: "#9CA3AF", textAlign: "center" },
  playerCell:    { flex: 1, flexDirection: "row", alignItems: "center", paddingRight: 6, minWidth: 0 },
  playerName:    { fontSize: 13, fontWeight: "700", color: "#111827" },
  playerTeamTxt: { fontSize: 10, color: "#9CA3AF", marginTop: 1 },
  tdNum:         { width: 38, textAlign: "center", fontSize: 12, color: "#374151" },
  tdBold:        { fontWeight: "800", color: "#111827" },
  noData:        { fontSize: 13, color: "#9CA3AF", paddingVertical: 20, textAlign: "center", paddingHorizontal: 14 },

  otherCard:  { marginHorizontal: 12, marginBottom: 10, backgroundColor: "#fff", borderRadius: 16, borderColor: "#E5E7EB", borderWidth: 1, padding: 14 },
  otherGrid:  { flexDirection: "row", flexWrap: "wrap", marginTop: 14 },
  otherItem:  { width: "33.33%", alignItems: "center", paddingVertical: 10, gap: 8 },
  otherIcon:  { width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center" },
  otherLabel: { fontSize: 11, fontWeight: "600", color: "#374151", textAlign: "center" },

  hlRow:   { flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 12, borderBottomColor: "#F9FAFB", borderBottomWidth: 1 },
  hlIcon:  { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  hlLabel: { fontSize: 12, fontWeight: "700", color: "#111827" },
  hlName:  { fontSize: 11, color: "#9CA3AF", marginTop: 1 },
  hlValue: { fontSize: 16, fontWeight: "800" },

  stub:    { alignItems: "center", gap: 8, paddingVertical: 40, backgroundColor: "#fff", borderRadius: 14, margin: 12, borderColor: "#F3F4F6", borderWidth: 1 },
  stubTxt: { fontSize: 13, color: "#9CA3AF" },
});
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from "react-native";
import { useEffect, useState } from "react";
import { db } from "../../firebaseConfig";
import { doc, onSnapshot } from "firebase/firestore";
import { Ionicons } from "@expo/vector-icons";

const PRIMARY = "#5B4FE5";
const DARK    = "#1B2050";
const MUTED   = "#8A8FA8";
const GREEN   = "#16A34A";
const BORDER  = "#EEF0F7";
const BG      = "#F7F8FC";

const oversStr = (b: number) => `${Math.floor((b || 0) / 6)}.${(b || 0) % 6}`;

function scoreFor(sc: any, teamName: string) {
  if (!sc) return null;
  if (sc.battingTeamName === teamName) {
    return { score: `${sc.runs ?? 0}/${sc.wickets ?? 0}`, overs: `${oversStr(sc.balls)} Ov` };
  }
  if (sc.innings1?.teamName === teamName) {
    const i = sc.innings1;
    return { score: `${i.runs ?? 0}/${i.wickets ?? 0}`, overs: `${oversStr(i.balls)} Ov` };
  }
  return null;
}

export default function LeagueScores({ matches, router }: { league: any; matches: any[]; router: any }) {
  const liveMatches = matches.filter((m) => m.status === "live");
  const completedMatches = matches
    .filter((m) => m.status === "completed")
    .sort((a, b) => `${b.date}${b.startTime}`.localeCompare(`${a.date}${a.startTime}`))
    .slice(0, 5);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: BG }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
      <Text style={s.sectionTitle}>Live Now</Text>
      {liveMatches.length === 0 ? (
        <View style={s.empty}>
          <Ionicons name="flash-outline" size={26} color={PRIMARY} />
          <Text style={s.emptyTitle}>No matches live right now</Text>
          <Text style={s.emptySub}>Start scoring a match from the Matches tab to see it here.</Text>
        </View>
      ) : (
        liveMatches.map((m) => <LiveMatchScoreCard key={m.id} match={m} router={router} />)
      )}

      <Text style={[s.sectionTitle, { marginTop: 8 }]}>Recently Completed</Text>
      {completedMatches.length === 0 ? (
        <View style={s.emptySmall}>
          <Text style={s.emptySmallTxt}>No completed matches yet.</Text>
        </View>
      ) : (
        completedMatches.map((m) => (
          <View key={m.id} style={s.completedCard}>
            <View style={{ flex: 1 }}>
              <Text style={s.completedTeams} numberOfLines={1}>{m.teamAName} vs {m.teamBName}</Text>
              {!!m.liveSummary && <Text style={s.completedResult} numberOfLines={1}>{m.liveSummary}</Text>}
              <Text style={s.completedDate}>{m.date || "—"}</Text>
            </View>
            <TouchableOpacity style={s.viewBtn} onPress={() => router.push(`/(playon-pro)/score/${m.id}`)} activeOpacity={0.85}>
              <Text style={s.viewBtnTxt}>View</Text>
            </TouchableOpacity>
          </View>
        ))
      )}
    </ScrollView>
  );
}

function LiveMatchScoreCard({ match, router }: { match: any; router: any }) {
  const [sc, setSc] = useState<any>(null);

  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, "matchScoring", match.id),
      (snap) => { if (snap.exists()) setSc(snap.data()); },
      (e) => console.error("matchScoring listener", e)
    );
    return unsub;
  }, [match.id]);

  const scoreA = scoreFor(sc, match.teamAName);
  const scoreB = scoreFor(sc, match.teamBName);
  const isBattingA = sc?.battingTeamName === match.teamAName;
  const isBattingB = sc?.battingTeamName === match.teamBName;

  const ballsLeft = sc ? (sc.oversLimit ?? 0) * 6 - (sc.balls ?? 0) : 0;
  const chaseLine = sc?.innings === 2 && sc?.target != null
    ? `${sc.battingTeamName} need ${sc.target - sc.runs} runs in ${ballsLeft} balls`
    : null;

  return (
    <View style={s.liveCard}>
      <View style={s.liveTopRow}>
        <View style={s.liveTag}>
          <View style={s.liveDot} />
          <Text style={s.liveTagTxt}>LIVE</Text>
        </View>
        {!!match.venue && <Text style={s.liveVenue} numberOfLines={1}>{match.venue}</Text>}
      </View>

      <View style={s.liveTeamsRow}>
        <View style={s.liveTeamSide}>
          <Text style={[s.liveTeamName, { opacity: isBattingA ? 1 : 0.55 }]} numberOfLines={1}>{match.teamAName}</Text>
          <Text style={[s.liveScore, { opacity: isBattingA ? 1 : 0.55 }]}>{scoreA?.score ?? "–"}</Text>
          {!!scoreA?.overs && <Text style={s.liveOvers}>{scoreA.overs}</Text>}
        </View>
        <Text style={s.liveVs}>VS</Text>
        <View style={[s.liveTeamSide, { alignItems: "flex-end" }]}>
          <Text style={[s.liveTeamName, { opacity: isBattingB ? 1 : 0.55, textAlign: "right" }]} numberOfLines={1}>{match.teamBName}</Text>
          <Text style={[s.liveScore, { opacity: isBattingB ? 1 : 0.55 }]}>{scoreB?.score ?? "–"}</Text>
          {!!scoreB?.overs && <Text style={s.liveOvers}>{scoreB.overs}</Text>}
        </View>
      </View>

      {!!chaseLine && <Text style={s.liveChase} numberOfLines={1}>{chaseLine}</Text>}

      <TouchableOpacity
        style={s.continueBtn}
        onPress={() => router.push(`/(playon-pro)/score/${match.id}`)}
        activeOpacity={0.85}
      >
        <Ionicons name="stats-chart-outline" size={15} color="#fff" />
        <Text style={s.continueBtnTxt}>Continue Scoring</Text>
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  sectionTitle: { fontSize: 16, fontWeight: "800", color: DARK, marginBottom: 12 },

  empty: { alignItems: "center", paddingVertical: 32, paddingHorizontal: 24, backgroundColor: "#fff", borderRadius: 16, borderColor: BORDER, borderWidth: 1, gap: 8, marginBottom: 24 },
  emptyTitle: { fontSize: 15, fontWeight: "700", color: DARK, textAlign: "center" },
  emptySub: { fontSize: 12.5, color: MUTED, textAlign: "center", lineHeight: 18 },

  emptySmall: { backgroundColor: "#fff", borderRadius: 14, borderColor: BORDER, borderWidth: 1, padding: 20, alignItems: "center" },
  emptySmallTxt: { fontSize: 13, color: MUTED },

  liveCard: {
    backgroundColor: "#fff", borderRadius: 16, borderColor: PRIMARY, borderWidth: 1.5,
    padding: 16, marginBottom: 14,
    shadowColor: PRIMARY, shadowOpacity: 0.1, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 2,
  },
  liveTopRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  liveTag: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "#FEF2F2", borderWidth: 1, borderColor: "#FCA5A5", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#DC2626" },
  liveTagTxt: { fontSize: 9.5, fontWeight: "800", color: "#DC2626", letterSpacing: 0.4 },
  liveVenue: { fontSize: 11.5, color: MUTED, flex: 1, textAlign: "right", marginLeft: 8 },

  liveTeamsRow: { flexDirection: "row", alignItems: "flex-start" },
  liveTeamSide: { flex: 1, gap: 3 },
  liveTeamName: { fontSize: 12.5, fontWeight: "700", color: DARK },
  liveScore: { fontSize: 22, fontWeight: "900", color: DARK, letterSpacing: -0.5, marginTop: 2 },
  liveOvers: { fontSize: 11, color: MUTED },
  liveVs: { fontSize: 11, fontWeight: "800", color: MUTED, paddingTop: 6, paddingHorizontal: 10 },

  liveChase: { fontSize: 12, color: PRIMARY, fontWeight: "700", marginTop: 10 },

  continueBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, backgroundColor: PRIMARY, paddingVertical: 11, borderRadius: 10, marginTop: 14 },
  continueBtnTxt: { color: "#fff", fontWeight: "700", fontSize: 13 },

  completedCard: { flexDirection: "row", alignItems: "center", backgroundColor: "#fff", borderRadius: 12, padding: 13, marginBottom: 10, borderColor: BORDER, borderWidth: 1 },
  completedTeams: { fontSize: 13.5, fontWeight: "700", color: DARK },
  completedResult: { fontSize: 12, color: GREEN, fontWeight: "600", marginTop: 3 },
  completedDate: { fontSize: 11, color: MUTED, marginTop: 3 },
  viewBtn: { backgroundColor: "#F3F4F6", paddingHorizontal: 14, paddingVertical: 8, borderRadius: 9 },
  viewBtnTxt: { color: DARK, fontWeight: "700", fontSize: 12 },
});
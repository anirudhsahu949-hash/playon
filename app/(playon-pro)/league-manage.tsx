import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from "react-native";
import { useEffect, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { db } from "../../firebaseConfig";
import { doc, onSnapshot, collection, query, where } from "firebase/firestore";

import LeagueOverview from "../../components/league-owner-manage/LeagueOverview";
import LeagueTeams    from "../../components/league-owner-manage/LeagueTeams";
import LeagueMatches  from "../../components/league-owner-manage/LeagueMatches";
import LeagueScores  from "../../components/league-owner-manage/LeagueScores";


const PRIMARY = "#5B4FE5";
const DARK    = "#1B2050";
const MUTED   = "#8A8FA8";
const BORDER  = "#EEF0F7";
const BG      = "#F7F8FC";

const FORMAT_LABEL: Record<string, string> = {
  round_robin: "Round Robin", knockout: "Knockout", groups_knockout: "Groups + Knockout",
};

type Tab = "overview" | "teams" | "matches" | "scores";
const TABS: { key: Tab; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: "overview", label: "Overview",    icon: "information-circle-outline" },
  { key: "teams",    label: "Teams",       icon: "people-outline" },
  { key: "matches",  label: "Matches",     icon: "calendar-outline" },
  { key: "scores",   label: "Live Scores", icon: "flash-outline" },
];

export default function LeagueManage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const [tab, setTab]         = useState<Tab>("overview");
  const [league, setLeague]   = useState<any>(null);
  const [teams, setTeams]     = useState<any[]>([]);
  const [matches, setMatches] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    let l = false, t = false, m = false;
    const check = () => { if (l && t && m) setLoading(false); };

    const unsubL = onSnapshot(doc(db, "leagues", id), (snap) => {
      if (snap.exists()) setLeague({ id: snap.id, ...snap.data() });
      l = true; check();
    }, (e) => { console.error("league listener", e); l = true; check(); });

    const unsubT = onSnapshot(
      query(collection(db, "leagueTeams"), where("leagueId", "==", id)),
      (snap) => {
        setTeams(snap.docs.map((d) => {
          const t = d.data();
          return {
            id: d.id, leagueId: t.leagueId, name: t.name || "", captainName: t.captainName || "",
            players: Array.isArray(t.players) ? t.players : [],
            playerCount: Number(t.playerCount || (Array.isArray(t.players) ? t.players.length : 0)),
          };
        }));
        t = true; check();
      },
      (e) => { console.error("teams listener", e); t = true; check(); }
    );

    const unsubM = onSnapshot(
      query(collection(db, "leagueMatches"), where("leagueId", "==", id)),
      (snap) => {
        setMatches(snap.docs.map((d) => {
          const m = d.data();
          return {
            id: d.id, leagueId: m.leagueId, teamAName: m.teamAName || "Team A", teamBName: m.teamBName || "Team B",
            date: m.date || "", startTime: m.startTime || "", endTime: m.endTime || "",
            venue: m.venue || "", status: m.status || "scheduled", liveSummary: m.liveSummary || "",
          };
        }));
        m = true; check();
      },
      (e) => { console.error("matches listener", e); m = true; check(); }
    );

    return () => { unsubL(); unsubT(); unsubM(); };
  }, [id]);

  if (loading) {
    return (
      <View style={s.center}>
        <ActivityIndicator color={PRIMARY} size="large" />
      </View>
    );
  }

  if (!league) {
    return (
      <View style={s.center}>
        <Text style={{ color: MUTED }}>League not found.</Text>
        <TouchableOpacity onPress={() => router.back()} style={{ marginTop: 12 }}>
          <Text style={{ color: PRIMARY, fontWeight: "700" }}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: BG }}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10} style={s.backBtn}>
          <Ionicons name="chevron-back" size={22} color={DARK} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={s.headerTitle} numberOfLines={1}>{league.name}</Text>
          <Text style={s.headerSub}>
            {league.sport} · {FORMAT_LABEL[league.format] || league.format} ·{" "}
            {league.hostType === "open" ? "Registration" : "Self-hosted"}
          </Text>
        </View>
      </View>

      <View style={s.tabBar}>
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <TouchableOpacity key={t.key} style={s.tabBtn} onPress={() => setTab(t.key)}>
              <Ionicons name={t.icon} size={17} color={active ? PRIMARY : MUTED} />
              <Text style={[s.tabTxt, active && s.tabTxtActive]}>{t.label}</Text>
              <View style={[s.tabUnderline, active && s.tabUnderlineActive]} />
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={{ flex: 1 }}>
        {tab === "overview" && <LeagueOverview league={league} teams={teams} matches={matches} />}
        {tab === "teams"    && <LeagueTeams    leagueId={id} league={league} teams={teams} />}
        {tab === "matches"  && <LeagueMatches  leagueId={id} league={league} teams={teams} matches={matches} router={router} />}
        {tab === "scores" && <LeagueScores league={league} matches={matches} router={router} />}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: BG, padding: 24, gap: 8 },
  header: {
    flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#fff",
    paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  backBtn:     { padding: 4 },
  headerTitle: { fontSize: 16, fontWeight: "800", color: DARK },
  headerSub:   { fontSize: 12, color: MUTED, marginTop: 1 },
  tabBar:             { flexDirection: "row", backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: BORDER, paddingHorizontal: 8 },
  tabBtn:             { flex: 1, alignItems: "center", gap: 3, paddingTop: 10, paddingBottom: 4 },
  tabTxt:             { fontSize: 11, fontWeight: "600", color: MUTED },
  tabTxtActive:       { color: PRIMARY },
  tabUnderline:       { height: 2, width: "70%", backgroundColor: "transparent", marginTop: 6, borderRadius: 2 },
  tabUnderlineActive: { backgroundColor: PRIMARY },
});
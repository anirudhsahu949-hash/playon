import {
  View, Text, StyleSheet, ScrollView,
  TouchableOpacity, SafeAreaView, StatusBar,
  Platform, ActivityIndicator,
} from "react-native";
import { useEffect, useState } from "react";
import { db } from "../../../firebaseConfig";
import { doc, getDoc, onSnapshot } from "firebase/firestore";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import LiveTab    from "../../../components/match/LiveTab";
import StatsTab   from "../../../components/match/stats";
import MatchesTab from "../../../components/match/MatchesTabs";
import PointsTab  from "../../../components/match/PointsTab";
import TeamsTab   from "../../../components/match/TeamsTab";

import useMatchViewers from "../../../hooks/useMatchViewers";
import ViewerBadge from "../../../components/match-tools/ViewerBadge";
import { shareMatch } from "../../../components/match-tools/Shareinvite";
import AdBanner from "../../../components/match-tools/Addbanner";

// =============================================================================
// 🏆 MATCH VIEWER SHELL — spectator screen
// NEW IN THIS VERSION:
//   👁 Live viewer count ("12 watching") — every spectator is counted via a
//      Firestore presence heartbeat (hooks/useMatchViewers.ts).
//   📤 Share button in the header (replaces the notification bell that did
//      nothing) — shares the live score + app link to WhatsApp etc.
//   💰 Ad banner at the bottom of the shell (sponsor slot wins over AdMob).
// =============================================================================

const BG     = "#EEF0F7";
const DARK   = "#1E2340";
const MUTED  = "#8A8FA8";
const BORDER = "#E2E5F0";
const GREEN  = "#16A34A";

type NavTab       = "live" | "matches" | "points" | "teams" | "stats";
type ScorecardTab = "batting" | "bowling" | "partnership" | "fow";
type StatSubTab   = "overview" | "batting" | "bowling" | "allrounder" | "fielding";

const NAV_TABS: { key: NavTab; label: string }[] = [
  { key: "live",    label: "Live"         },
  { key: "matches", label: "Matches"      },
  { key: "points",  label: "Points Table" },
  { key: "teams",   label: "Teams"        },
  { key: "stats",   label: "Stats"        },
];

export default function MatchViewer() {
  const params  = useLocalSearchParams();
  const matchId = (params.matchId ?? params.matchid) as string;
  const router  = useRouter();

  const [match,      setMatch]      = useState<any>(null);
  const [sc,         setSc]         = useState<any>(null);
  const [leagueName, setLeagueName] = useState("");
  const [loading,    setLoading]    = useState(true);

  const [navTab,       setNavTab]       = useState<NavTab>("live");
  const [scorecardTab, setScorecardTab] = useState<ScorecardTab>("batting");
  const [statSubTab,   setStatSubTab]   = useState<StatSubTab>("overview");
  const [selTeam,      setSelTeam]      = useState<string | null>(null);

  // 👁 Every person on this screen is counted as a live viewer.
  const viewerCount = useMatchViewers(matchId, !loading);

  useEffect(() => {
    if (!matchId) { setLoading(false); return; }
    let unsub: (() => void) | undefined;

    (async () => {
      try {
        const mSnap = await getDoc(doc(db, "leagueMatches", matchId));
        if (mSnap.exists()) {
          const mData = { id: mSnap.id, ...mSnap.data() } as any;
          setMatch(mData);
          if (mData.leagueId) {
            try {
              const lgSnap = await getDoc(doc(db, "leagues", mData.leagueId));
              if (lgSnap.exists()) setLeagueName(lgSnap.data().name || "");
            } catch { /* silent */ }
          }
        }
      } catch (e) { console.error("match load:", e); }

      unsub = onSnapshot(
        doc(db, "matchScoring", matchId),
        (snap) => { setSc(snap.exists() ? snap.data() : null); setLoading(false); },
        (err)  => { console.error("scoring sub:", err); setLoading(false); },
      );
    })();

    return () => { if (unsub) unsub(); };
  }, [matchId]);

  const teamA    = match?.teamAName || "Team A";
  const teamB    = match?.teamBName || "Team B";
  const selected = selTeam || sc?.battingTeamName || teamA;

  const onShare = () => {
    shareMatch({
      teamAName: teamA,
      teamBName: teamB,
      scoreA: match?.scoreA,
      scoreB: match?.scoreB,
      leagueName: leagueName || match?.leagueName,
      status: match?.status,
      liveSummary: match?.liveSummary || sc?.summary,
    });
  };

  if (loading) {
    return (
      <SafeAreaView style={[s.safe, s.center]}>
        <StatusBar barStyle="dark-content" backgroundColor={BG} />
        <ActivityIndicator color={GREEN} size="large" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="dark-content" backgroundColor="#fff" />

      {/* ── Header ── */}
      <View style={s.header}>
        <TouchableOpacity style={s.headerBtn} onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="chevron-back" size={20} color={DARK} />
        </TouchableOpacity>

        <View style={s.headerCenter}>
          <Text style={s.headerTitle} numberOfLines={1}>
            {leagueName || match?.leagueName || match?.sport || "Match"}
          </Text>
          {/* 👁 live viewer count under the title */}
          <ViewerBadge count={viewerCount} compact />
        </View>

        {/* 📤 Share (used to be a dead notification bell) */}
        <TouchableOpacity style={s.headerBtn} onPress={onShare} hitSlop={12}>
          <Ionicons name="share-social-outline" size={19} color={DARK} />
        </TouchableOpacity>
      </View>

      {/* ── Nav tabs ── */}
      <View style={s.navBar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.navScroll}>
          {NAV_TABS.map((n) => {
            const active = n.key === navTab;
            return (
              <TouchableOpacity key={n.key} style={s.navItem} onPress={() => setNavTab(n.key)} activeOpacity={0.7}>
                <Text style={[s.navTxt, active && s.navTxtActive]}>{n.label}</Text>
                {active && <View style={s.navUnderline} />}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* ── Tab content ── */}
      <View style={{ flex: 1 }}>
        {navTab === "live" && (
          <LiveTab
            sc={sc} match={match}
            teamA={teamA} teamB={teamB}
            selected={selected} setSelected={setSelTeam}
            scorecardTab={scorecardTab} setScorecardTab={setScorecardTab}
          />
        )}
        {navTab === "stats" && (
          <StatsTab sc={sc} teamA={teamA} teamB={teamB} statSubTab={statSubTab} setStatSubTab={setStatSubTab} />
        )}
        {navTab === "matches" && (
          <MatchesTab leagueId={match?.leagueId || ""} currentMatchId={matchId} />
        )}
        {navTab === "points" && (
          <PointsTab leagueId={match?.leagueId || ""} sport={match?.sport || ""} />
        )}
        {navTab === "teams" && (
          <TeamsTab leagueId={match?.leagueId || ""} />
        )}
      </View>

      {/* 💰 Ad / sponsor slot pinned under the content */}
      <AdBanner placement="match-viewer" />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: BG },
  center: { alignItems: "center", justifyContent: "center" },

  header: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: "#fff",
    paddingHorizontal: 12,
    paddingTop: Platform.OS === "android" ? (StatusBar.currentHeight || 0) + 6 : 4,
    paddingBottom: 10,
    borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  headerBtn: {
    width: 36, height: 36, borderRadius: 11,
    backgroundColor: BG, alignItems: "center", justifyContent: "center",
  },
  headerCenter: { flex: 1, alignItems: "center", justifyContent: "center", gap: 3 },
  headerTitle:  { fontSize: 15, fontWeight: "800", color: DARK },

  navBar:    { backgroundColor: "#fff", borderBottomColor: BORDER, borderBottomWidth: 1 },
  navScroll: { paddingHorizontal: 14, gap: 2 },
  navItem:   { paddingHorizontal: 12, paddingVertical: 10, alignItems: "center", position: "relative" },
  navTxt:      { fontSize: 13.5, fontWeight: "600", color: MUTED },
  navTxtActive:{ fontWeight: "800", color: DARK },
  navUnderline:{ position: "absolute", bottom: 0, left: 6, right: 6, height: 2.5, backgroundColor: GREEN, borderRadius: 2 },
});
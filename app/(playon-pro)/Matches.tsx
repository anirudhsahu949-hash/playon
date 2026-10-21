import React, { useState, useCallback } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  SafeAreaView, StatusBar, Platform, ActivityIndicator, RefreshControl,
} from "react-native";
import { db, auth } from "../../firebaseConfig";
import { collection, query, where, getDocs, limit } from "firebase/firestore";
import { useRouter, useFocusEffect, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import TeamAvatar from "../../components/Teamavatar";
import AdBanner from "../../components/match-tools/Addbanner";
import { shareMatch } from "../../components/match-tools/Shareinvite";

// =============================================================================
// 📅 ALL MATCHES — the screen the Home "View All" button was pointing at
// but which NEVER EXISTED (dead route bug — now fixed).
// Tabs: Live / Upcoming / Finished, full vertical lists, share on every row.
// Open with an initial tab:  router.push("/(playon-pro)/matches?tab=upcoming")
// =============================================================================

const GREEN   = "#16A34A";
const RED     = "#E11D2A";
const DARK    = "#0B1220";
const PAGE_BG = "#F0F1F5";
const GRAY    = "#9AA3B2";

type Match = {
  id: string;
  leagueId: string | null;
  leagueName: string;
  teamAName: string;
  teamBName: string;
  teamAIconName?: string | null;
  teamAIconColor?: string | null;
  teamBIconName?: string | null;
  teamBIconColor?: string | null;
  sport: string;
  scoreA: number;
  scoreB: number;
  date: string;
  startTime: string;
  venue: string;
  status: string;
  liveSummary: string;
  organizerId: string | null;
};

type TabKey = "live" | "upcoming" | "finished";

function initials(n: string) {
  return (n || "?").trim().split(/\s+/).map((w) => w[0]).join("").toUpperCase().slice(0, 2);
}

function matchDestination(m: Match, myUid: string | null): string {
  const isMine = !!myUid && !!m.organizerId && m.organizerId === myUid;
  if (!isMine) return `/(playon-pro)/match/${m.id}`;
  return m.leagueId
    ? `/(playon-pro)/league-manage?id=${m.leagueId}`
    : `/(playon-pro)/manage-match?id=${m.id}`;
}

export default function AllMatches() {
  const router = useRouter();
  const { tab: tabParam } = useLocalSearchParams<{ tab?: string }>();

  const [tab, setTab] = useState<TabKey>(
    tabParam === "upcoming" || tabParam === "finished" ? tabParam : "live"
  );
  const [live, setLive]         = useState<Match[]>([]);
  const [upcoming, setUpcoming] = useState<Match[]>([]);
  const [finished, setFinished] = useState<Match[]>([]);
  const [loading, setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const myUid = auth.currentUser?.uid ?? null;

  const toMatch = (d: any): Match => {
    const m = d.data();
    return {
      id: d.id,
      leagueId: m.leagueId || null,
      leagueName: m.leagueName || "",
      teamAName: m.teamAName || "Team A",
      teamBName: m.teamBName || "Team B",
      teamAIconName: m.teamAIconName || null,
      teamAIconColor: m.teamAIconColor || null,
      teamBIconName: m.teamBIconName || null,
      teamBIconColor: m.teamBIconColor || null,
      sport: m.sport || "",
      scoreA: Number(m.scoreA ?? 0),
      scoreB: Number(m.scoreB ?? 0),
      date: m.date || "",
      startTime: m.startTime || "",
      venue: m.venue || "",
      status: m.status || "scheduled",
      liveSummary: m.liveSummary || "",
      organizerId: m.organizerId || null,
    };
  };

  const loadAll = useCallback(async () => {
    try {
      const col = collection(db, "leagueMatches");
      const [liveSnap, upSnap, finSnap] = await Promise.all([
        getDocs(query(col, where("status", "==", "live"),      limit(50))),
        getDocs(query(col, where("status", "==", "scheduled"), limit(50))),
        getDocs(query(col, where("status", "==", "finished"),  limit(50))),
      ]);
      setLive(liveSnap.docs.map(toMatch));
      setUpcoming(upSnap.docs.map(toMatch));
      setFinished(finSnap.docs.map(toMatch));
    } catch (e) {
      console.error("AllMatches loadAll:", e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { loadAll(); }, [loadAll]));
  const onRefresh = () => { setRefreshing(true); loadAll(); };

  const list = tab === "live" ? live : tab === "upcoming" ? upcoming : finished;

  const TABS: { key: TabKey; label: string; count: number }[] = [
    { key: "live",     label: "Live",     count: live.length },
    { key: "upcoming", label: "Upcoming", count: upcoming.length },
    { key: "finished", label: "Finished", count: finished.length },
  ];

  return (
    <SafeAreaView style={st.root}>
      <StatusBar barStyle="dark-content" backgroundColor="#fff" />

      {/* Header */}
      <View style={st.header}>
        <TouchableOpacity onPress={() => router.back()} style={st.backBtn} hitSlop={10}>
          <Ionicons name="chevron-back" size={22} color={DARK} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={st.headerTitle}>All Matches</Text>
          <Text style={st.headerSub}>Every match on Playon</Text>
        </View>
      </View>

      {/* Tabs */}
      <View style={st.tabsRow}>
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <TouchableOpacity
              key={t.key}
              style={[st.tabPill, active && st.tabPillActive]}
              onPress={() => setTab(t.key)}
              activeOpacity={0.85}
            >
              {t.key === "live" && active && <View style={st.liveDot} />}
              <Text style={[st.tabTxt, active && st.tabTxtActive]}>
                {t.label} ({t.count})
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {loading ? (
        <View style={st.center}><ActivityIndicator color={GREEN} size="large" /></View>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={GREEN} />}
          contentContainerStyle={{ padding: 16, paddingBottom: 120 }}
        >
          {list.length === 0 ? (
            <View style={st.empty}>
              <View style={st.emptyIcon}>
                <Ionicons
                  name={tab === "live" ? "flash-outline" : tab === "upcoming" ? "calendar-outline" : "checkmark-circle-outline"}
                  size={26} color={GRAY}
                />
              </View>
              <Text style={st.emptyTitle}>
                {tab === "live" ? "No live matches" : tab === "upcoming" ? "No upcoming matches" : "No finished matches"}
              </Text>
              <Text style={st.emptySub}>Pull down to refresh</Text>
            </View>
          ) : (
            list.map((m, i) => (
              <React.Fragment key={m.id}>
                <MatchRow m={m} tab={tab} router={router} myUid={myUid} />
                {/* Ad after every 6 rows — money without annoying users */}
                {(i + 1) % 6 === 0 && <AdBanner placement="matches-list" />}
              </React.Fragment>
            ))
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

// ── Match row card ───────────────────────────────────────────────────────────
function MatchRow({
  m, tab, router, myUid,
}: {
  m: Match; tab: TabKey; router: ReturnType<typeof useRouter>; myUid: string | null;
}) {
  const isMine = !!myUid && m.organizerId === myUid;

  return (
    <TouchableOpacity
      style={st.card}
      activeOpacity={0.88}
      onPress={() => router.push(matchDestination(m, myUid) as any)}
    >
      {/* Top row: league + status badge */}
      <View style={st.cardTop}>
        <Text style={st.leagueName} numberOfLines={1}>
          {m.leagueName || m.sport || "Quick Match"}
        </Text>
        {tab === "live" && (
          <View style={st.liveBadge}>
            <View style={st.liveDotSm} />
            <Text style={st.liveBadgeTxt}>LIVE</Text>
          </View>
        )}
        {isMine && (
          <View style={st.mineBadge}>
            <Ionicons name="settings-outline" size={10} color={GREEN} />
            <Text style={st.mineBadgeTxt}>YOURS</Text>
          </View>
        )}
      </View>

      {/* Teams + score */}
      <View style={st.teamsRow}>
        <View style={st.teamSide}>
          <TeamAvatar
            name={m.teamAName}
            iconName={m.teamAIconName}
            iconColor={m.teamAIconColor}
            size={38}
          />
          <Text style={st.teamName} numberOfLines={1}>{m.teamAName}</Text>
        </View>

        <View style={st.centerCol}>
          {tab === "upcoming" ? (
            <>
              <Text style={st.vsTxt}>VS</Text>
              <Text style={st.timeTxt}>{m.date}</Text>
              {!!m.startTime && <Text style={st.timeTxt}>{m.startTime}</Text>}
            </>
          ) : (
            <Text style={st.scoreTxt}>{m.scoreA} – {m.scoreB}</Text>
          )}
        </View>

        <View style={st.teamSide}>
          <TeamAvatar
            name={m.teamBName}
            iconName={m.teamBIconName}
            iconColor={m.teamBIconColor}
            size={38}
          />
          <Text style={st.teamName} numberOfLines={1}>{m.teamBName}</Text>
        </View>
      </View>

      {/* Bottom row: summary / venue + share */}
      <View style={st.cardBottom}>
        <Text style={st.summaryTxt} numberOfLines={1}>
          {tab === "live" && m.liveSummary ? m.liveSummary : m.venue || m.sport}
        </Text>
        <TouchableOpacity
          onPress={() => shareMatch(m)}
          hitSlop={10}
          style={st.shareBtn}
        >
          <Ionicons name="share-social-outline" size={15} color={GREEN} />
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────
const st = StyleSheet.create({
  root:   { flex: 1, backgroundColor: PAGE_BG },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },

  header: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingHorizontal: 16,
    paddingTop: Platform.OS === "android" ? (StatusBar.currentHeight ?? 0) + 12 : 8,
    paddingBottom: 12,
    backgroundColor: "#fff",
    borderBottomWidth: 1, borderBottomColor: "#F3F4F6",
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: "#F5F6F8", alignItems: "center", justifyContent: "center",
  },
  headerTitle: { fontSize: 18, fontWeight: "800", color: DARK },
  headerSub:   { fontSize: 11, color: GRAY, fontWeight: "500", marginTop: 1 },

  tabsRow: {
    flexDirection: "row", gap: 8,
    paddingHorizontal: 16, paddingVertical: 10,
    backgroundColor: "#fff",
    borderBottomWidth: 1, borderBottomColor: "#F3F4F6",
  },
  tabPill: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    paddingVertical: 10, borderRadius: 12, backgroundColor: "#F0F1F4",
  },
  tabPillActive: { backgroundColor: GREEN },
  tabTxt:        { fontSize: 11.5, fontWeight: "800", color: "#6B7280" },
  tabTxtActive:  { color: "#fff" },
  liveDot:       { width: 6, height: 6, borderRadius: 3, backgroundColor: "#fff" },

  card: {
    backgroundColor: "#fff", borderRadius: 16,
    padding: 14, marginBottom: 12,
    borderWidth: 1, borderColor: "#EDEEF2",
  },
  cardTop: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 },
  leagueName: { flex: 1, fontSize: 11.5, fontWeight: "700", color: GRAY, textTransform: "uppercase", letterSpacing: 0.3 },
  liveBadge: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: "#FEF2F2", borderRadius: 6,
    paddingHorizontal: 7, paddingVertical: 3,
  },
  liveDotSm:    { width: 5, height: 5, borderRadius: 3, backgroundColor: RED },
  liveBadgeTxt: { fontSize: 9, fontWeight: "800", color: RED, letterSpacing: 0.5 },
  mineBadge: {
    flexDirection: "row", alignItems: "center", gap: 3,
    backgroundColor: "#DCFCE7", borderRadius: 6,
    paddingHorizontal: 6, paddingVertical: 3,
  },
  mineBadgeTxt: { fontSize: 8.5, fontWeight: "800", color: GREEN, letterSpacing: 0.4 },

  teamsRow: { flexDirection: "row", alignItems: "center" },
  teamSide: { flex: 1, alignItems: "center", gap: 6 },
  teamName: { fontSize: 12.5, fontWeight: "700", color: DARK, maxWidth: 100, textAlign: "center" },
  centerCol:{ width: 90, alignItems: "center", gap: 2 },
  scoreTxt: { fontSize: 20, fontWeight: "900", color: DARK },
  vsTxt:    { fontSize: 12, fontWeight: "800", color: GRAY, letterSpacing: 1 },
  timeTxt:  { fontSize: 10.5, fontWeight: "600", color: GRAY },

  cardBottom: {
    flexDirection: "row", alignItems: "center",
    marginTop: 10, paddingTop: 10,
    borderTopWidth: 1, borderTopColor: "#F3F4F6",
  },
  summaryTxt: { flex: 1, fontSize: 11.5, color: GRAY, fontWeight: "600" },
  shareBtn: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: "#DCFCE7", alignItems: "center", justifyContent: "center",
  },

  empty:      { alignItems: "center", paddingTop: 70, gap: 8 },
  emptyIcon:  {
    width: 60, height: 60, borderRadius: 30,
    backgroundColor: "#E9EBF0", alignItems: "center", justifyContent: "center", marginBottom: 4,
  },
  emptyTitle: { fontSize: 15, fontWeight: "800", color: DARK },
  emptySub:   { fontSize: 12, color: GRAY },
});
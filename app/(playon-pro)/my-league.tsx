import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
  StatusBar,
  Platform,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { useState, useCallback } from "react";
import { db, auth } from "../../firebaseConfig";
import {
  collection, query, where, getDocs,
  doc, getDoc,
} from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

// =======================================================
// 📋 MY LEAGUES  (app/(playon-pro)/my-league.tsx)
//
// Shows leagues the logged-in player is part of.
// Query chain:
//   leagueTeams where playerUids array-contains uid
//   → unique leagueIds
//   → fetch each league doc
//   → fetch leagueMatches for each league
//
// Active tab  — ongoing / registration_open leagues
//               + upcoming fixtures for user's team
// Past tab    — completed leagues
//               + results with win/loss badge
// =======================================================

const GREEN = "#16A34A";
const DARK  = "#0B1220";

type Tab = "active" | "past" | "hosting";

// ── Sport helpers ─────────────────────────────────────────────────────────────
const SPORT_COLOR: Record<string, string> = {
  Cricket:    "#7C3AED",
  Football:   "#2563EB",
  Badminton:  "#059669",
  Basketball: "#EA580C",
  Volleyball: "#0EA5E9",
  default:    "#6B7280",
};
const SPORT_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  Cricket:    "baseball-outline",
  Football:   "football-outline",
  Badminton:  "tennisball-outline",
  Basketball: "basketball-outline",
  Volleyball: "ellipse-outline",
  default:    "trophy-outline",
};
function sportColor(s: string) { return SPORT_COLOR[s] || SPORT_COLOR.default; }
function sportIcon(s: string): keyof typeof Ionicons.glyphMap {
  return SPORT_ICON[s] || SPORT_ICON.default;
}
function initials(name: string) {
  return (name || "?").trim().split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
}

// ── Types ─────────────────────────────────────────────────────────────────────
type LeagueEntry = {
  leagueId:    string;
  leagueName:  string;
  sport:       string;
  format:      string;
  city:        string;
  status:      string;           // ongoing | registration_open | completed
  teamId:      string;
  teamName:    string;
  matches:     MatchEntry[];
};

type MatchEntry = {
  matchId:     string;
  teamAId:     string;
  teamAName:   string;
  teamBId:     string;
  teamBName:   string;
  date:        string;
  startTime:   string;
  venue:       string;
  status:      string;           // scheduled | live | completed
  scoreA:      number;
  scoreB:      number;
  winnerId:    string | null;
};

// A league the current user organizes — separate from leagues they merely play in.
type HostedLeague = {
  leagueId:  string;
  name:      string;
  sport:     string;
  format:    string;
  city:      string;
  status:    string;   // registration_open | ongoing | completed
  hostType:  string;   // managed | open
  teamCount: number;
  maxTeams:  number;
};

// A standalone quick match the user hosts — no league attached.
type HostedMatch = {
  matchId:   string;
  teamAName: string;
  teamBName: string;
  sport:     string;
  date:      string;
  status:    string;   // scheduled | live | completed
  scoreA:    number;
  scoreB:    number;
};

// ── Format helpers ────────────────────────────────────────────────────────────
const FORMAT_LABEL: Record<string, string> = {
  round_robin:     "Round Robin",
  knockout:        "Knockout",
  groups_knockout: "Groups + KO",
};

function formatDate(dateStr: string) {
  if (!dateStr) return "TBD";
  try {
    const d   = new Date(dateStr);
    const now = new Date();
    const tom = new Date(); tom.setDate(now.getDate() + 1);
    if (d.toDateString() === now.toDateString()) return "Today";
    if (d.toDateString() === tom.toDateString()) return "Tomorrow";
    return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  } catch { return dateStr; }
}

// ── Main component ────────────────────────────────────────────────────────────
export default function MyLeagues() {
  const router = useRouter();
  const [tab,        setTab]        = useState<Tab>("active");
  const [leagues,    setLeagues]    = useState<LeagueEntry[]>([]);
  const [hostedLeagues, setHostedLeagues] = useState<HostedLeague[]>([]);
  const [hostedMatches, setHostedMatches] = useState<HostedMatch[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [uid,        setUid]        = useState<string | null>(null);

  // ── Data loader ──────────────────────────────────────────────────────────
  const loadMyLeagues = useCallback(async (currentUid: string) => {
    try {
      // Step 1 — find all teams this player is linked to
      const teamSnap = await getDocs(
        query(
          collection(db, "leagueTeams"),
          where("playerUids", "array-contains", currentUid)
        )
      );

      if (teamSnap.empty) {
        setLeagues([]);
        return;
      }

      // Step 2 — collect unique leagueId → teamId + teamName
      const leagueMap = new Map<string, { teamId: string; teamName: string }>();
      teamSnap.docs.forEach((d) => {
        const data = d.data();
        if (data.leagueId && !leagueMap.has(data.leagueId)) {
          leagueMap.set(data.leagueId, {
            teamId:   d.id,
            teamName: data.name || "My Team",
          });
        }
      });

      // Step 3 — fetch each league doc + its matches in parallel
      const entries: LeagueEntry[] = [];

      await Promise.all(
        Array.from(leagueMap.entries()).map(async ([leagueId, teamInfo]) => {
          try {
            // Fetch league
            const leagueDoc = await getDoc(doc(db, "leagues", leagueId));
            if (!leagueDoc.exists()) return;
            const league = leagueDoc.data();

            // Fetch matches for this league
            const matchSnap = await getDocs(
              query(
                collection(db, "leagueMatches"),
                where("leagueId", "==", leagueId)
              )
            );

            // Only include matches involving the user's team
            const matches: MatchEntry[] = matchSnap.docs
              .map((md) => {
                const m = md.data();
                // only matches where user's team plays
                if (m.teamAId !== teamInfo.teamId && m.teamBId !== teamInfo.teamId) {
                  return null;
                }
                return {
                  matchId:   md.id,
                  teamAId:   m.teamAId   || "",
                  teamAName: m.teamAName || "Team A",
                  teamBId:   m.teamBId   || "",
                  teamBName: m.teamBName || "Team B",
                  date:      m.date      || "",
                  startTime: m.startTime || "",
                  venue:     m.venue     || "",
                  status:    m.status    || "scheduled",
                  scoreA:    Number(m.scoreA || 0),
                  scoreB:    Number(m.scoreB || 0),
                  winnerId:  m.winnerId  || null,
                } as MatchEntry;
              })
              .filter((m): m is MatchEntry => m !== null)
              .sort((a, b) => (a.date || "").localeCompare(b.date || ""));

            entries.push({
              leagueId,
              leagueName: league.name   || "League",
              sport:      league.sport  || "",
              format:     league.format || "",
              city:       league.city   || "",
              status:     league.status || "ongoing",
              teamId:     teamInfo.teamId,
              teamName:   teamInfo.teamName,
              matches,
            });
          } catch (e) {
            console.error("load league entry", leagueId, e);
          }
        })
      );

      // Sort: active first, completed last
      entries.sort((a, b) => {
        const aActive = a.status !== "completed" ? 0 : 1;
        const bActive = b.status !== "completed" ? 0 : 1;
        return aActive - bActive || a.leagueName.localeCompare(b.leagueName);
      });

      setLeagues(entries);
    } catch (e) {
      console.error("loadMyLeagues", e);
    }
  }, []);

  // ── Hosted leagues loader — leagues this user organizes ─────────────────
  const loadHostedLeagues = useCallback(async (currentUid: string) => {
    try {
      const snap = await getDocs(
        query(collection(db, "leagues"), where("organizerId", "==", currentUid))
      );
      const list: HostedLeague[] = snap.docs.map((d) => {
        const l = d.data();
        return {
          leagueId:  d.id,
          name:      l.name   || "Untitled league",
          sport:     l.sport  || "",
          format:    l.format || "",
          city:      l.city   || "",
          status:    l.status || "registration_open",
          hostType:  l.hostType || "managed",
          teamCount: Number(l.teamCount || 0),
          maxTeams:  Number(l.maxTeams  || 0),
        };
      });
      const order: Record<string, number> = { ongoing: 0, registration_open: 1, completed: 2 };
      list.sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9) || a.name.localeCompare(b.name));
      setHostedLeagues(list);
    } catch (e) {
      console.error("loadHostedLeagues", e);
    }
  }, []);

  // ── Hosted quick matches loader — standalone matches this user hosts ─────
  const loadHostedMatches = useCallback(async (currentUid: string) => {
    try {
      const snap = await getDocs(
        query(
          collection(db, "leagueMatches"),
          where("organizerId", "==", currentUid),
          where("leagueId", "==", null)
        )
      );
      const list: HostedMatch[] = snap.docs.map((d) => {
        const m = d.data();
        return {
          matchId:   d.id,
          teamAName: m.teamAName || "Team A",
          teamBName: m.teamBName || "Team B",
          sport:     m.sport     || "",
          date:      m.date      || "",
          status:    m.status    || "scheduled",
          scoreA:    Number(m.scoreA || 0),
          scoreB:    Number(m.scoreB || 0),
        };
      });
      const order: Record<string, number> = { live: 0, scheduled: 1, completed: 2, finished: 2 };
      list.sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9) || a.date.localeCompare(b.date));
      setHostedMatches(list);
    } catch (e) {
      console.error("loadHostedMatches", e);
    }
  }, []);

  // ── Focus refresh ─────────────────────────────────────────────────────────
  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      // Get uid then load
      const user = auth.currentUser;
      if (user) {
        setUid(user.uid);
        Promise.all([loadMyLeagues(user.uid), loadHostedLeagues(user.uid), loadHostedMatches(user.uid)])
          .finally(() => setLoading(false));
      } else {
        // Wait for auth state
        const unsub = onAuthStateChanged(auth, (u) => {
          if (u) {
            setUid(u.uid);
            Promise.all([loadMyLeagues(u.uid), loadHostedLeagues(u.uid), loadHostedMatches(u.uid)])
              .finally(() => setLoading(false));
          } else {
            setLoading(false);
          }
        });
        return unsub;
      }
    }, [loadMyLeagues, loadHostedLeagues, loadHostedMatches])
  );

  const onRefresh = async () => {
    if (!uid) return;
    setRefreshing(true);
    await Promise.all([loadMyLeagues(uid), loadHostedLeagues(uid), loadHostedMatches(uid)]);
    setRefreshing(false);
  };

  // ── Split active vs past ──────────────────────────────────────────────────
  const activeLeagues = leagues.filter((l) => l.status !== "completed");
  const pastLeagues   = leagues.filter((l) => l.status === "completed");
  const shown         = tab === "active" ? activeLeagues : pastLeagues;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={s.root}>
      <StatusBar barStyle="dark-content" backgroundColor="#fff" />

      {/* Header */}
      <View style={s.header}>
        <Text style={s.title}>My Leagues</Text>
        {leagues.length > 0 && (
          <View style={s.countBadge}>
            <Text style={s.countTxt}>{leagues.length}</Text>
          </View>
        )}
      </View>

      {/* Tabs */}
      <View style={s.tabs}>
        {(["active", "past", "hosting"] as Tab[]).map((t) => {
          const active = t === tab;
          const count  = t === "active" ? activeLeagues.length : t === "past" ? pastLeagues.length : hostedLeagues.length + hostedMatches.length;
          return (
            <TouchableOpacity
              key={t}
              style={s.tab}
              onPress={() => setTab(t)}
              activeOpacity={0.8}
            >
              <View style={s.tabInner}>
                <Text style={[s.tabTxt, active && s.tabTxtActive]}>
                  {t === "active" ? "Active" : t === "past" ? "Past" : "Hosting"}
                </Text>
                {count > 0 && (
                  <View style={[s.tabCount, active && s.tabCountActive]}>
                    <Text style={[s.tabCountTxt, active && s.tabCountTxtActive]}>
                      {count}
                    </Text>
                  </View>
                )}
              </View>
              <View style={[s.tabUnderline, active && s.tabUnderlineActive]} />
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Content */}
      {loading ? (
        <View style={s.center}>
          <ActivityIndicator color={GREEN} size="large" />
        </View>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 40, flexGrow: 1 }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={GREEN} />
          }
        >
          {tab === "hosting" ? (
            hostedLeagues.length === 0 && hostedMatches.length === 0 ? (
              <HostingEmptyState
                onHostLeague={() => router.push("/(playon-pro)/create-league" as any)}
                onHostMatch={() => router.push("/(playon-pro)/host-match" as any)}
              />
            ) : (
              <View style={{ paddingTop: 12 }}>
                {hostedLeagues.length > 0 && (
                  <>
                    {hostedMatches.length > 0 && <Text style={s.hostingGroupLabel}>LEAGUES</Text>}
                    {hostedLeagues.map((hl) => (
                      <HostedLeagueCard
                        key={hl.leagueId}
                        league={hl}
                        onPress={() =>
                          router.push({ pathname: "/(playon-pro)/league-manage", params: { id: hl.leagueId } } as any)
                        }
                      />
                    ))}
                  </>
                )}
                {hostedMatches.length > 0 && (
                  <>
                    {hostedLeagues.length > 0 && <Text style={s.hostingGroupLabel}>QUICK MATCHES</Text>}
                    {hostedMatches.map((hm) => (
                      <HostedMatchCard
                        key={hm.matchId}
                        match={hm}
                        onPress={() =>
                          router.push({ pathname: "/(playon-pro)/manage-match", params: { id: hm.matchId } } as any)
                        }
                      />
                    ))}
                  </>
                )}
              </View>
            )
          ) : shown.length === 0 ? (
            <EmptyState tab={tab} onFindLeague={() => router.push("/(playon-pro)" as any)} />
          ) : (
            <View style={{ paddingTop: 12 }}>
              {shown.map((league) => (
                <LeagueCard
                  key={league.leagueId}
                  league={league}
                  uid={uid || ""}
                  onPress={() =>
                    router.push(`/(playon-pro)/league-card/${league.leagueId}` as any)
                  }
                  onMatchPress={(matchId) =>
                    router.push(`/(playon-pro)/match/${matchId}` as any)
                  }
                />
              ))}
            </View>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// LeagueCard — one card per league showing team info + fixture rows
// ══════════════════════════════════════════════════════════════════════════════
function LeagueCard({
  league, uid, onPress, onMatchPress,
}: {
  league:       LeagueEntry;
  uid:          string;
  onPress:      () => void;
  onMatchPress: (matchId: string) => void;
}) {
  const sc          = sportColor(league.sport);
  const icon        = sportIcon(league.sport);
  const isCompleted = league.status === "completed";

  // Upcoming = scheduled or live; results = completed
  const upcoming  = league.matches.filter((m) => m.status !== "completed").slice(0, 3);
  const completed = league.matches.filter((m) => m.status === "completed");

  // Compute team record (wins / losses / draws)
  let wins = 0, losses = 0, draws = 0;
  completed.forEach((m) => {
    if (!m.winnerId) draws++;
    else if (m.winnerId === league.teamId) wins++;
    else losses++;
  });

  return (
    <TouchableOpacity
      style={s.leagueCard}
      onPress={onPress}
      activeOpacity={0.85}
    >
      {/* Sport stripe at top */}
      <View style={[s.leagueStripe, { backgroundColor: sc }]} />

      {/* League header */}
      <View style={s.leagueHeader}>
        <View style={[s.leagueIconWrap, { backgroundColor: sc + "18" }]}>
          <Ionicons name={icon} size={20} color={sc} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.leagueName} numberOfLines={1}>{league.leagueName}</Text>
          <Text style={s.leagueMeta}>
            {league.city}
            {league.format ? ` · ${FORMAT_LABEL[league.format] || league.format}` : ""}
          </Text>
        </View>
        {/* Status chip */}
        <View style={[
          s.statusChip,
          isCompleted
            ? { backgroundColor: "#F3F4F6" }
            : league.status === "registration_open"
            ? { backgroundColor: "#EFF6FF" }
            : { backgroundColor: "#F0FDF4" },
        ]}>
          <Text style={[
            s.statusChipTxt,
            isCompleted
              ? { color: "#6B7280" }
              : league.status === "registration_open"
              ? { color: "#2563EB" }
              : { color: "#15803D" },
          ]}>
            {isCompleted
              ? "Completed"
              : league.status === "registration_open"
              ? "Registering"
              : "Ongoing"}
          </Text>
        </View>
      </View>

      {/* My team row */}
      <View style={s.teamRow}>
        <View style={[s.teamAvatar, { backgroundColor: sc }]}>
          <Text style={s.teamAvatarTxt}>{initials(league.teamName)}</Text>
        </View>
        <Text style={s.teamName}>{league.teamName}</Text>
        {/* Record badge */}
        {completed.length > 0 && (
          <View style={s.recordBadge}>
            <Text style={s.recordTxt}>
              <Text style={{ color: "#15803D" }}>{wins}W</Text>
              {" · "}
              <Text style={{ color: "#DC2626" }}>{losses}L</Text>
              {draws > 0 ? ` · ${draws}D` : ""}
            </Text>
          </View>
        )}
      </View>

      {/* Divider */}
      <View style={s.divider} />

      {/* Fixture rows */}
      {!isCompleted && upcoming.length > 0 && (
        <View>
          <Text style={s.fixtureLabel}>
            {upcoming.some((m) => m.status === "live") ? "Live now" : "Upcoming fixtures"}
          </Text>
          {upcoming.map((match) => (
            <MatchRow
              key={match.matchId}
              match={match}
              myTeamId={league.teamId}
              onPress={() => onMatchPress(match.matchId)}
            />
          ))}
        </View>
      )}

      {/* Past results (show last 3) */}
      {(isCompleted || upcoming.length === 0) && completed.length > 0 && (
        <View>
          <Text style={s.fixtureLabel}>Results</Text>
          {completed.slice(-3).reverse().map((match) => (
            <MatchRow
              key={match.matchId}
              match={match}
              myTeamId={league.teamId}
              onPress={() => onMatchPress(match.matchId)}
            />
          ))}
        </View>
      )}

      {/* No matches yet */}
      {upcoming.length === 0 && completed.length === 0 && (
        <View style={s.noFixtures}>
          <Text style={s.noFixturesTxt}>No fixtures scheduled yet</Text>
        </View>
      )}

      {/* View league arrow */}
      <View style={s.viewLeagueRow}>
        <Text style={[s.viewLeagueTxt, { color: sc }]}>View full league</Text>
        <Ionicons name="arrow-forward" size={14} color={sc} />
      </View>
    </TouchableOpacity>
  );
}

// ── Single match row inside a league card ─────────────────────────────────────
function MatchRow({
  match, myTeamId, onPress,
}: {
  match:    MatchEntry;
  myTeamId: string;
  onPress:  () => void;
}) {
  const isLive      = match.status === "live";
  const isCompleted = match.status === "completed";
  const myTeamIsA   = match.teamAId === myTeamId;
  const myScore     = myTeamIsA ? match.scoreA : match.scoreB;
  const oppScore    = myTeamIsA ? match.scoreB : match.scoreA;
  const oppName     = myTeamIsA ? match.teamBName : match.teamAName;

  // Result for completed matches
  const result = isCompleted
    ? !match.winnerId
      ? "draw"
      : match.winnerId === myTeamId
      ? "win"
      : "loss"
    : null;

  return (
    <TouchableOpacity style={s.matchRow} onPress={onPress} activeOpacity={0.75}>
      {/* Date / Live */}
      <View style={s.matchDateWrap}>
        {isLive ? (
          <View style={s.liveDot} />
        ) : (
          <Ionicons name="calendar-outline" size={13} color="#9CA3AF" />
        )}
        <Text style={[s.matchDate, isLive && { color: "#DC2626", fontWeight: "700" }]}>
          {isLive ? "Live" : formatDate(match.date)}
        </Text>
      </View>

      {/* Opponent */}
      <Text style={s.matchOpp} numberOfLines={1}>vs {oppName}</Text>

      {/* Score or time */}
      <View style={s.matchRight}>
        {isCompleted ? (
          <>
            <Text style={s.matchScore}>{myScore} – {oppScore}</Text>
            <View style={[
              s.resultBadge,
              result === "win"  && s.resultWin,
              result === "loss" && s.resultLoss,
              result === "draw" && s.resultDraw,
            ]}>
              <Text style={[
                s.resultTxt,
                result === "win"  && { color: "#15803D" },
                result === "loss" && { color: "#DC2626" },
                result === "draw" && { color: "#6B7280" },
              ]}>
                {result === "win" ? "W" : result === "loss" ? "L" : "D"}
              </Text>
            </View>
          </>
        ) : (
          <Text style={s.matchTime}>{match.startTime || "TBD"}</Text>
        )}
      </View>
    </TouchableOpacity>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// HostedLeagueCard — one card per league the user organizes (not just plays in)
// ══════════════════════════════════════════════════════════════════════════════
const HOST_STATUS_CFG: Record<string, { label: string; color: string; bg: string }> = {
  registration_open: { label: "Registering", color: "#2563EB", bg: "#EFF6FF" },
  ongoing:           { label: "Ongoing",     color: "#15803D", bg: "#F0FDF4" },
  completed:         { label: "Completed",   color: "#6B7280", bg: "#F3F4F6" },
};

function HostedLeagueCard({ league, onPress }: { league: HostedLeague; onPress: () => void }) {
  const sc     = sportColor(league.sport);
  const icon   = sportIcon(league.sport);
  const status = HOST_STATUS_CFG[league.status] || HOST_STATUS_CFG.registration_open;

  return (
    <TouchableOpacity style={s.leagueCard} onPress={onPress} activeOpacity={0.85}>
      <View style={[s.leagueStripe, { backgroundColor: sc }]} />
      <View style={s.leagueHeader}>
        <View style={[s.leagueIconWrap, { backgroundColor: sc + "18" }]}>
          <Ionicons name={icon} size={20} color={sc} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.leagueName} numberOfLines={1}>{league.name}</Text>
          <Text style={s.leagueMeta}>
            {league.city}
            {league.format ? ` · ${FORMAT_LABEL[league.format] || league.format}` : ""}
            {league.hostType === "open" ? ` · ${league.teamCount}/${league.maxTeams || "–"} teams` : ""}
          </Text>
        </View>
        <View style={[s.statusChip, { backgroundColor: status.bg }]}>
          <Text style={[s.statusChipTxt, { color: status.color }]}>{status.label}</Text>
        </View>
      </View>
      <View style={hc.manageRow}>
        <Ionicons name="settings-outline" size={14} color="#6B7280" />
        <Text style={hc.manageTxt}>Manage teams, matches & scoring</Text>
        <Ionicons name="chevron-forward" size={16} color="#9CA3AF" />
      </View>
    </TouchableOpacity>
  );
}

const hc = StyleSheet.create({
  manageRow: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 16, paddingVertical: 12,
    borderTopWidth: 1, borderTopColor: "#F3F4F6",
  },
  manageTxt: { flex: 1, fontSize: 12.5, color: "#6B7280", fontWeight: "600" },
});

// ══════════════════════════════════════════════════════════════════════════════
// HostedMatchCard — one card per standalone quick match the user hosts
// ══════════════════════════════════════════════════════════════════════════════
const MATCH_STATUS_CFG: Record<string, { label: string; color: string; bg: string }> = {
  scheduled: { label: "Scheduled", color: "#2563EB", bg: "#EFF6FF" },
  live:      { label: "Live",      color: "#DC2626", bg: "#FEF2F2" },
  completed: { label: "Completed", color: "#6B7280", bg: "#F3F4F6" },
  finished:  { label: "Completed", color: "#6B7280", bg: "#F3F4F6" },
};

function HostedMatchCard({ match, onPress }: { match: HostedMatch; onPress: () => void }) {
  const sc     = sportColor(match.sport);
  const icon   = sportIcon(match.sport);
  const status = MATCH_STATUS_CFG[match.status] || MATCH_STATUS_CFG.scheduled;
  const showScore = match.status === "live" || match.status === "completed" || match.status === "finished";

  return (
    <TouchableOpacity style={s.leagueCard} onPress={onPress} activeOpacity={0.85}>
      <View style={[s.leagueStripe, { backgroundColor: sc }]} />
      <View style={s.leagueHeader}>
        <View style={[s.leagueIconWrap, { backgroundColor: sc + "18" }]}>
          <Ionicons name={icon} size={20} color={sc} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.leagueName} numberOfLines={1}>{match.teamAName} vs {match.teamBName}</Text>
          <Text style={s.leagueMeta}>
            {match.sport}{match.date ? ` · ${formatDate(match.date)}` : ""}
            {showScore ? ` · ${match.scoreA} – ${match.scoreB}` : ""}
          </Text>
        </View>
        <View style={[s.statusChip, { backgroundColor: status.bg }]}>
          <Text style={[s.statusChipTxt, { color: status.color }]}>{status.label}</Text>
        </View>
      </View>
      <View style={hc.manageRow}>
        <Ionicons name="stats-chart-outline" size={14} color="#6B7280" />
        <Text style={hc.manageTxt}>
          {match.status === "scheduled" ? "Start scoring" : match.status === "live" ? "Continue scoring" : "View result"}
        </Text>
        <Ionicons name="chevron-forward" size={16} color="#9CA3AF" />
      </View>
    </TouchableOpacity>
  );
}

// ── Hosting empty state ─────────────────────────────────────────────────────
function HostingEmptyState({ onHostLeague, onHostMatch }: { onHostLeague: () => void; onHostMatch: () => void }) {
  return (
    <View style={s.empty}>
      <View style={s.emptyIcon}>
        <Ionicons name="trophy-outline" size={30} color={GREEN} />
      </View>
      <Text style={s.emptyTitle}>You're not hosting anything yet</Text>
      <Text style={s.emptySub}>
        Run a full league, or host a quick one-off match — both free to start.
      </Text>
      <View style={{ flexDirection: "row", gap: 10, marginTop: 14 }}>
        <TouchableOpacity style={[s.cta, { flex: 1 }]} onPress={onHostLeague}>
          <Text style={s.ctaTxt}>Host a League</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[s.ctaSecondary, { flex: 1 }]} onPress={onHostMatch}>
          <Text style={s.ctaSecondaryTxt}>Host a Match</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────
function EmptyState({ tab, onFindLeague }: { tab: Tab; onFindLeague: () => void }) {
  return (
    <View style={s.empty}>
      <View style={s.emptyIcon}>
        <Ionicons
          name={tab === "active" ? "people-outline" : "time-outline"}
          size={30}
          color={GREEN}
        />
      </View>
      <Text style={s.emptyTitle}>
        {tab === "active" ? "No active leagues" : "No past leagues"}
      </Text>
      <Text style={s.emptySub}>
        {tab === "active"
          ? "When someone adds you to a team using your Playon ID, the league will appear here with your fixtures."
          : "Leagues you've finished will be archived here with your results."}
      </Text>
      {tab === "active" && (
        <TouchableOpacity style={s.cta} onPress={onFindLeague}>
          <Text style={s.ctaTxt}>Browse leagues</Text>
          <Ionicons name="arrow-forward" size={16} color="#fff" />
        </TouchableOpacity>
      )}
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root:   { flex: 1, backgroundColor: "#F9FAFB" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },

  header: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingHorizontal: 16,
    paddingTop:    Platform.OS === "android" ? (StatusBar.currentHeight ?? 0) + 12 : 8,
    paddingBottom: 8,
    backgroundColor: "#F9FAFB",
  },
  title: { fontSize: 26, fontWeight: "800", color: DARK, letterSpacing: -0.5 },
  countBadge: {
    backgroundColor: GREEN, borderRadius: 12,
    paddingHorizontal: 8, paddingVertical: 2,
  },
  countTxt: { fontSize: 12, fontWeight: "800", color: "#fff" },

  tabs: {
    flexDirection: "row", paddingHorizontal: 16,
    borderBottomColor: "#F3F4F6", borderBottomWidth: 1,
    backgroundColor: "#F9FAFB",
  },
  tab:      { marginRight: 24, alignItems: "center" },
  tabInner: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 10 },
  tabTxt:   { fontSize: 15, fontWeight: "600", color: "#9CA3AF" },
  tabTxtActive: { color: "#15803D" },
  tabCount: {
    minWidth: 20, height: 20, borderRadius: 10,
    backgroundColor: "#F3F4F6",
    alignItems: "center", justifyContent: "center",
    paddingHorizontal: 5,
  },
  tabCountActive:  { backgroundColor: "#DCFCE7" },
  tabCountTxt:     { fontSize: 11, fontWeight: "700", color: "#9CA3AF" },
  tabCountTxtActive:{ color: "#15803D" },
  tabUnderline:    { height: 2, width: "100%", backgroundColor: "transparent", borderRadius: 2 },
  tabUnderlineActive: { backgroundColor: GREEN },

  // League card
  leagueCard: {
    marginHorizontal: 16, marginBottom: 14,
    backgroundColor: "#fff", borderRadius: 18,
    borderWidth: 1, borderColor: "#F3F4F6",
    overflow: "hidden",
    shadowColor: "#000", shadowOpacity: 0.04,
    shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  leagueStripe: { height: 4 },
  leagueHeader: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingHorizontal: 14, paddingTop: 12, paddingBottom: 8,
  },
  leagueIconWrap: {
    width: 38, height: 38, borderRadius: 10,
    alignItems: "center", justifyContent: "center",
  },
  leagueName: { fontSize: 15, fontWeight: "800", color: DARK },
  leagueMeta: { fontSize: 12, color: "#6B7280", marginTop: 1 },
  statusChip: {
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20,
    alignSelf: "flex-start",
  },
  statusChipTxt: { fontSize: 11, fontWeight: "700" },

  // My team row
  teamRow: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: 14, paddingBottom: 10,
  },
  teamAvatar: {
    width: 26, height: 26, borderRadius: 13,
    alignItems: "center", justifyContent: "center",
  },
  teamAvatarTxt: { fontSize: 10, fontWeight: "800", color: "#fff" },
  teamName:      { fontSize: 13, fontWeight: "700", color: "#374151", flex: 1 },
  recordBadge:   { paddingHorizontal: 8, paddingVertical: 3, backgroundColor: "#F9FAFB", borderRadius: 8, borderWidth: 1, borderColor: "#F3F4F6" },
  recordTxt:     { fontSize: 12, fontWeight: "700", color: "#374151" },

  divider: { height: 1, backgroundColor: "#F9FAFB", marginHorizontal: 14 },

  fixtureLabel: {
    fontSize: 11, fontWeight: "700", color: "#9CA3AF",
    textTransform: "uppercase", letterSpacing: 0.5,
    paddingHorizontal: 14, paddingTop: 10, paddingBottom: 4,
  },

  // Match row
  matchRow: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 14, paddingVertical: 10,
    borderTopWidth: 1, borderTopColor: "#F9FAFB",
  },
  matchDateWrap: { flexDirection: "row", alignItems: "center", gap: 4, width: 72 },
  liveDot:       { width: 6, height: 6, borderRadius: 3, backgroundColor: "#DC2626" },
  matchDate:     { fontSize: 12, color: "#6B7280", fontWeight: "600" },
  matchOpp:      { flex: 1, fontSize: 13, fontWeight: "600", color: DARK, paddingHorizontal: 6 },
  matchRight:    { flexDirection: "row", alignItems: "center", gap: 6 },
  matchScore:    { fontSize: 13, fontWeight: "800", color: DARK },
  matchTime:     { fontSize: 12, color: "#6B7280", fontWeight: "600" },

  resultBadge:   { width: 22, height: 22, borderRadius: 6, alignItems: "center", justifyContent: "center" },
  resultWin:     { backgroundColor: "#F0FDF4" },
  resultLoss:    { backgroundColor: "#FEF2F2" },
  resultDraw:    { backgroundColor: "#F3F4F6" },
  resultTxt:     { fontSize: 11, fontWeight: "800" },

  noFixtures:    { paddingHorizontal: 14, paddingVertical: 12 },
  noFixturesTxt: { fontSize: 12, color: "#9CA3AF" },

  viewLeagueRow: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 14, paddingVertical: 12,
    borderTopWidth: 1, borderTopColor: "#F3F4F6",
  },
  viewLeagueTxt: { fontSize: 13, fontWeight: "700" },

  // Empty state
  empty: {
    alignItems: "center", paddingTop: 80,
    paddingHorizontal: 40, flexGrow: 1,
  },
  emptyIcon: {
    width: 68, height: 68, borderRadius: 34, backgroundColor: "#F0FDF4",
    alignItems: "center", justifyContent: "center", marginBottom: 16,
  },
  emptyTitle: { fontSize: 17, fontWeight: "700", color: DARK, textAlign: "center" },
  emptySub: {
    fontSize: 13, color: "#6B7280",
    textAlign: "center", marginTop: 8, lineHeight: 20,
  },
  cta: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 20,
    backgroundColor: GREEN, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 12,
  },
  ctaTxt: { color: "#fff", fontWeight: "700", fontSize: 14 },
  ctaSecondary: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    backgroundColor: "#F0FDF4", borderWidth: 1, borderColor: "#BBF7D0",
    paddingHorizontal: 20, paddingVertical: 12, borderRadius: 12,
  },
  ctaSecondaryTxt: { color: "#15803D", fontWeight: "700", fontSize: 14 },
  hostingGroupLabel: {
    fontSize: 11, fontWeight: "700", color: "#9CA3AF",
    letterSpacing: 0.5, marginHorizontal: 16, marginTop: 14, marginBottom: 8,
  },
});
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
import { useEffect, useState, useCallback } from "react";
import { db, auth } from "../../../firebaseConfig";
import {
  doc, getDoc,
  collection, query, where, getDocs,
} from "firebase/firestore";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

// =======================================================
// 🏆 LEAGUE DETAIL PAGE  (app/(playon-pro)/league/[id].tsx)
//
// Opened from:
//   • Home screen  — tap any league card
//   • Stats screen — More Leagues cell
//   • My Leagues   — "View full league" tap
//   • Any match card — league name tap
//
// Personalised by uid:
//   • If user is IN the league → their team highlighted,
//     next fixture floats to top, W/L badge on results
//   • If browsing → neutral view, Register button for open leagues
//
// 3 tabs: Fixtures · Standings · Teams
// =======================================================

const GREEN  = "#16A34A";
const DARK   = "#0B1220";

// ── Sport helpers ─────────────────────────────────────────────────────────────
const SPORT_COLOR: Record<string, string> = {
  Cricket: "#7C3AED", Football: "#2563EB", Badminton: "#059669",
  Basketball: "#EA580C", Volleyball: "#0EA5E9", default: "#6B7280",
};
const SPORT_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  Cricket: "baseball-outline", Football: "football-outline",
  Badminton: "tennisball-outline", Basketball: "basketball-outline",
  Volleyball: "ellipse-outline", default: "trophy-outline",
};
const FORMAT_LABEL: Record<string, string> = {
  round_robin: "Round Robin", knockout: "Knockout",
  groups_knockout: "Groups + KO",
};

function sc(sport: string) { return SPORT_COLOR[sport] || SPORT_COLOR.default; }
function si(sport: string): keyof typeof Ionicons.glyphMap {
  return SPORT_ICON[sport] || SPORT_ICON.default;
}
function initials(n: string) {
  return (n || "?").trim().split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
}
function fmtDate(d: string) {
  if (!d) return "TBD";
  try {
    const dt  = new Date(d);
    const now = new Date();
    const tom = new Date(); tom.setDate(now.getDate() + 1);
    if (dt.toDateString() === now.toDateString()) return "Today";
    if (dt.toDateString() === tom.toDateString()) return "Tomorrow";
    return dt.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  } catch { return d; }
}

// ── Types ─────────────────────────────────────────────────────────────────────
type League = {
  name: string; sport: string; format: string; city: string;
  venue: string; startDate: string; status: string;
  hostType: string; entryFee: number; teamCount: number;
  maxTeams: number; description: string; organizerId: string;
};

type Team = {
  id: string; name: string; captainName: string;
  players: { name: string; uid?: string; playonId?: string }[];
  playerCount: number;
  // Computed standings
  played: number; wins: number; losses: number;
  draws: number; points: number;
};

type Match = {
  id: string; teamAId: string; teamAName: string;
  teamBId: string; teamBName: string;
  date: string; startTime: string; venue: string;
  status: string; scoreA: number; scoreB: number;
  winnerId: string | null; liveSummary: string;
};

type Tab = "fixtures" | "standings" | "teams";

// ── Component ─────────────────────────────────────────────────────────────────
export default function LeagueDetail() {
  const { id }  = useLocalSearchParams<{ id: string }>();
  const router  = useRouter();

  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab,        setTab]        = useState<Tab>("fixtures");

  const [league,  setLeague]  = useState<League | null>(null);
  const [teams,   setTeams]   = useState<Team[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);

  // Current user's team in this league (if any)
  const [myTeamId, setMyTeamId] = useState<string | null>(null);
  const uid = auth.currentUser?.uid || null;

  // ── Loader ──────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    if (!id) return;
    try {
      // 1. League doc
      const leagueSnap = await getDoc(doc(db, "leagues", id));
      if (!leagueSnap.exists()) { setLoading(false); return; }
      const l = leagueSnap.data() as League;
      setLeague(l);

      // 2. Teams + matches in parallel
      const [teamSnap, matchSnap] = await Promise.all([
        getDocs(query(collection(db, "leagueTeams"),  where("leagueId", "==", id))),
        getDocs(query(collection(db, "leagueMatches"), where("leagueId", "==", id))),
      ]);

      const rawTeams: Team[] = teamSnap.docs.map((d) => {
        const t = d.data();
        return {
          id:          d.id,
          name:        t.name        || "Team",
          captainName: t.captainName || "",
          players:     Array.isArray(t.players) ? t.players : [],
          playerCount: Number(t.playerCount || 0),
          played: 0, wins: 0, losses: 0, draws: 0, points: 0,
        };
      });

      const rawMatches: Match[] = matchSnap.docs.map((d) => {
        const m = d.data();
        return {
          id:          d.id,
          teamAId:     m.teamAId     || "",
          teamAName:   m.teamAName   || "Team A",
          teamBId:     m.teamBId     || "",
          teamBName:   m.teamBName   || "Team B",
          date:        m.date        || "",
          startTime:   m.startTime   || "",
          venue:       m.venue       || "",
          status:      m.status      || "scheduled",
          scoreA:      Number(m.scoreA || 0),
          scoreB:      Number(m.scoreB || 0),
          winnerId:    m.winnerId    || null,
          liveSummary: m.liveSummary || "",
        };
      });

      // 3. Compute standings from completed matches
      const standingsMap = new Map<string, Team>();
      rawTeams.forEach((t) => standingsMap.set(t.id, { ...t }));

      rawMatches.forEach((m) => {
        if (m.status !== "completed") return;
        const a = standingsMap.get(m.teamAId);
        const b = standingsMap.get(m.teamBId);
        if (a) { a.played++; }
        if (b) { b.played++; }
        if (!m.winnerId) {
          // Draw
          if (a) { a.draws++; a.points += 1; }
          if (b) { b.draws++; b.points += 1; }
        } else if (m.winnerId === m.teamAId) {
          if (a) { a.wins++;   a.points += 2; }
          if (b) { b.losses++; }
        } else {
          if (b) { b.wins++;   b.points += 2; }
          if (a) { a.losses++; }
        }
      });

      const teamsWithStandings = Array.from(standingsMap.values())
        .sort((a, b) => b.points - a.points || b.wins - a.wins || a.name.localeCompare(b.name));

      // 4. Sort matches: live first, then upcoming by date, then completed
      const sorted = [...rawMatches].sort((a, b) => {
        const rank = (m: Match) =>
          m.status === "live" ? 0 : m.status === "scheduled" ? 1 : 2;
        if (rank(a) !== rank(b)) return rank(a) - rank(b);
        return (a.date || "").localeCompare(b.date || "");
      });

      // 5. Find current user's team
      if (uid) {
        const myTeam = rawTeams.find((t) =>
          t.players.some((p) => p.uid === uid)
        );
        setMyTeamId(myTeam?.id || null);
      }

      setTeams(teamsWithStandings);
      setMatches(sorted);
    } catch (e) {
      console.error("league detail load", e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [id, uid]);

  useEffect(() => { load(); }, [load]);

  const onRefresh = () => { setRefreshing(true); load(); };

  // ── Guards ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <SafeAreaView style={[s.root, s.center]}>
        <StatusBar barStyle="dark-content" backgroundColor="#F9FAFB" />
        <ActivityIndicator color={GREEN} size="large" />
      </SafeAreaView>
    );
  }
  if (!league) {
    return (
      <SafeAreaView style={[s.root, s.center]}>
        <StatusBar barStyle="dark-content" backgroundColor="#F9FAFB" />
        <Ionicons name="trophy-outline" size={40} color="#D1D5DB" />
        <Text style={s.notFoundTxt}>League not found</Text>
        <TouchableOpacity onPress={() => router.back()} style={{ marginTop: 14 }}>
          <Text style={{ color: GREEN, fontWeight: "700" }}>Go back</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  const color  = sc(league.sport);
  const isOpen = league.hostType === "open";
  const isMember = !!myTeamId;

  // My team object (for fixtures personalisation)
  const myTeam = teams.find((t) => t.id === myTeamId);

  // Fixtures: if user is in the league, float their next match to top
  const fixturesSorted = (() => {
    if (!myTeamId) return matches;
    const myNext = matches.find(
      (m) => m.status !== "completed" &&
             (m.teamAId === myTeamId || m.teamBId === myTeamId)
    );
    if (!myNext) return matches;
    return [myNext, ...matches.filter((m) => m.id !== myNext.id)];
  })();

  return (
    <SafeAreaView style={s.root}>
      <StatusBar barStyle="dark-content" backgroundColor="#F9FAFB" />

      {/* ── Back header ── */}
      <View style={s.topBar}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn} hitSlop={10}>
          <Ionicons name="chevron-back" size={22} color={DARK} />
        </TouchableOpacity>
        <Text style={s.topBarTitle} numberOfLines={1}>{league.name}</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 48 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={GREEN} />
        }
      >
        {/* ══════════════════════════════════════════════ */}
        {/* HERO CARD                                      */}
        {/* ══════════════════════════════════════════════ */}
        <View style={[s.heroCard, { borderTopColor: color }]}>
          <View style={s.heroTop}>
            <View style={[s.heroIcon, { backgroundColor: color + "18" }]}>
              <Ionicons name={si(league.sport)} size={28} color={color} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.heroName}>{league.name}</Text>
              <Text style={s.heroMeta}>
                {league.sport}
                {league.format ? ` · ${FORMAT_LABEL[league.format] || league.format}` : ""}
              </Text>
            </View>
            {/* Status chip */}
            <View style={[
              s.statusChip,
              league.status === "completed"
                ? { backgroundColor: "#F3F4F6" }
                : league.status === "registration_open"
                ? { backgroundColor: "#EFF6FF" }
                : { backgroundColor: "#F0FDF4" },
            ]}>
              <Text style={[
                s.statusChipTxt,
                league.status === "completed"
                  ? { color: "#6B7280" }
                  : league.status === "registration_open"
                  ? { color: "#2563EB" }
                  : { color: "#15803D" },
              ]}>
                {league.status === "completed"  ? "Completed"
                 : league.status === "registration_open" ? "Registering"
                 : "Ongoing"}
              </Text>
            </View>
          </View>

          {/* Info rows */}
          <View style={s.heroInfo}>
            {!!league.city && (
              <View style={s.heroInfoRow}>
                <Ionicons name="location-outline" size={13} color="#9CA3AF" />
                <Text style={s.heroInfoTxt}>{league.city}{league.venue ? ` · ${league.venue}` : ""}</Text>
              </View>
            )}
            {!!league.startDate && (
              <View style={s.heroInfoRow}>
                <Ionicons name="calendar-outline" size={13} color="#9CA3AF" />
                <Text style={s.heroInfoTxt}>Started {league.startDate}</Text>
              </View>
            )}
            <View style={s.heroInfoRow}>
              <Ionicons name="people-outline" size={13} color="#9CA3AF" />
              <Text style={s.heroInfoTxt}>
                {league.teamCount || teams.length} team{(league.teamCount || teams.length) === 1 ? "" : "s"}
                {league.maxTeams > 0 ? ` · max ${league.maxTeams}` : ""}
              </Text>
            </View>
            {isOpen && league.entryFee > 0 && (
              <View style={s.heroInfoRow}>
                <Ionicons name="cash-outline" size={13} color="#9CA3AF" />
                <Text style={s.heroInfoTxt}>Entry fee ₹{league.entryFee.toLocaleString("en-IN")} per team</Text>
              </View>
            )}
          </View>

          {/* My team banner */}
          {isMember && myTeam && (
            <View style={[s.myTeamBanner, { borderColor: color + "44", backgroundColor: color + "10" }]}>
              <View style={[s.myTeamAvatar, { backgroundColor: color }]}>
                <Text style={s.myTeamAvatarTxt}>{initials(myTeam.name)}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[s.myTeamLabel, { color }]}>My Team</Text>
                <Text style={s.myTeamName}>{myTeam.name}</Text>
              </View>
              <View style={s.myTeamRecord}>
                <Text style={s.myTeamRecordTxt}>
                  <Text style={{ color: GREEN }}>{myTeam.wins}W</Text>
                  {" · "}
                  <Text style={{ color: "#DC2626" }}>{myTeam.losses}L</Text>
                  {myTeam.draws > 0 ? ` · ${myTeam.draws}D` : ""}
                </Text>
              </View>
            </View>
          )}

          {/* Register button for open leagues (non-members) */}
          {isOpen && !isMember && league.status === "registration_open" && (
            <TouchableOpacity
              style={[s.registerBtn, { backgroundColor: color }]}
              activeOpacity={0.85}
              onPress={() => {
                // Future: open registration flow
                // For now, handled by open league join endpoint
              }}
            >
              <Ionicons name="add-circle-outline" size={18} color="#fff" />
              <Text style={s.registerBtnTxt}>Register Your Team</Text>
            </TouchableOpacity>
          )}

          {/* Description */}
          {!!league.description && (
            <Text style={s.heroDesc}>{league.description}</Text>
          )}
        </View>

        {/* ══════════════════════════════════════════════ */}
        {/* TAB BAR                                        */}
        {/* ══════════════════════════════════════════════ */}
        <View style={s.tabBar}>
          {(["fixtures", "standings", "teams"] as Tab[]).map((t) => {
            const active = t === tab;
            const labels: Record<Tab, string> = {
              fixtures:  "Fixtures",
              standings: "Standings",
              teams:     "Teams",
            };
            const icons: Record<Tab, keyof typeof Ionicons.glyphMap> = {
              fixtures:  "calendar-outline",
              standings: "podium-outline",
              teams:     "people-outline",
            };
            return (
              <TouchableOpacity
                key={t}
                style={s.tabBtn}
                onPress={() => setTab(t)}
                activeOpacity={0.8}
              >
                <Ionicons name={icons[t]} size={16} color={active ? GREEN : "#9CA3AF"} />
                <Text style={[s.tabTxt, active && s.tabTxtActive]}>{labels[t]}</Text>
                <View style={[s.tabUnder, active && s.tabUnderActive]} />
              </TouchableOpacity>
            );
          })}
        </View>

        {/* ══════════════════════════════════════════════ */}
        {/* TAB: FIXTURES                                  */}
        {/* ══════════════════════════════════════════════ */}
        {tab === "fixtures" && (
          <View style={s.tabContent}>
            {fixturesSorted.length === 0 ? (
              <EmptyTab icon="calendar-outline" title="No fixtures yet"
                sub="Matches will appear here once the league owner schedules them." />
            ) : (
              fixturesSorted.map((match, index) => {
                const isMyMatch =
                  match.teamAId === myTeamId || match.teamBId === myTeamId;
                const isFirst = index === 0 && isMyMatch && match.status !== "completed";
                return (
                  <FixtureRow
                    key={match.id}
                    match={match}
                    myTeamId={myTeamId}
                    highlight={isFirst}
                    color={color}
                    onPress={() => router.push(`/(playon-pro)/match/${match.id}` as any)}
                  />
                );
              })
            )}
          </View>
        )}

        {/* ══════════════════════════════════════════════ */}
        {/* TAB: STANDINGS                                 */}
        {/* ══════════════════════════════════════════════ */}
        {tab === "standings" && (
          <View style={s.tabContent}>
            {teams.length === 0 ? (
              <EmptyTab icon="podium-outline" title="No standings yet"
                sub="Standings update automatically as matches are completed." />
            ) : (
              <View style={s.standingsCard}>
                {/* Header row */}
                <View style={[s.standingsRow, s.standingsHeader]}>
                  <Text style={[s.standingsCell, s.standingsRank]}>#</Text>
                  <Text style={[s.standingsCell, { flex: 1 }]}>Team</Text>
                  <Text style={s.standingsCell}>P</Text>
                  <Text style={s.standingsCell}>W</Text>
                  <Text style={s.standingsCell}>L</Text>
                  <Text style={s.standingsCell}>D</Text>
                  <Text style={[s.standingsCell, s.standingsPts]}>Pts</Text>
                </View>
                {/* Team rows */}
                {teams.map((team, i) => {
                  const isMe = team.id === myTeamId;
                  return (
                    <View
                      key={team.id}
                      style={[
                        s.standingsRow,
                        i < teams.length - 1 && s.standingsRowBorder,
                        isMe && { backgroundColor: GREEN + "0D" },
                      ]}
                    >
                      {/* Rank with medal for top 3 */}
                      <Text style={[s.standingsCell, s.standingsRank]}>
                        {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : String(i + 1)}
                      </Text>
                      <View style={[s.standingsCell, { flex: 1, flexDirection: "row", alignItems: "center", gap: 6 }]}>
                        <View style={[s.standingsAvatar, { backgroundColor: isMe ? color : "#E5E7EB" }]}>
                          <Text style={[s.standingsAvatarTxt, { color: isMe ? "#fff" : "#6B7280" }]}>
                            {initials(team.name)}
                          </Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={[s.standingsTeamName, isMe && { color }]} numberOfLines={1}>
                            {team.name}
                          </Text>
                          {isMe && <Text style={[s.standingsMyBadge, { color }]}>My Team</Text>}
                        </View>
                      </View>
                      <Text style={s.standingsCell}>{team.played}</Text>
                      <Text style={[s.standingsCell, { color: team.wins > 0 ? GREEN : undefined }]}>
                        {team.wins}
                      </Text>
                      <Text style={[s.standingsCell, { color: team.losses > 0 ? "#DC2626" : undefined }]}>
                        {team.losses}
                      </Text>
                      <Text style={s.standingsCell}>{team.draws}</Text>
                      <Text style={[s.standingsCell, s.standingsPts, { fontWeight: "800" }]}>
                        {team.points}
                      </Text>
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        )}

        {/* ══════════════════════════════════════════════ */}
        {/* TAB: TEAMS                                     */}
        {/* ══════════════════════════════════════════════ */}
        {tab === "teams" && (
          <View style={s.tabContent}>
            {teams.length === 0 ? (
              <EmptyTab icon="people-outline" title="No teams yet"
                sub="Teams will appear here once the league owner adds them." />
            ) : (
              teams.map((team) => {
                const isMe = team.id === myTeamId;
                return (
                  <View
                    key={team.id}
                    style={[s.teamCard, isMe && { borderColor: color + "55", borderWidth: 1.5 }]}
                  >
                    {/* Team header */}
                    <View style={s.teamCardHeader}>
                      <View style={[s.teamCardAvatar, { backgroundColor: isMe ? color : "#E5E7EB" }]}>
                        <Text style={[s.teamCardAvatarTxt, { color: isMe ? "#fff" : "#6B7280" }]}>
                          {initials(team.name)}
                        </Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                          <Text style={s.teamCardName}>{team.name}</Text>
                          {isMe && (
                            <View style={[s.myTeamPill, { backgroundColor: color }]}>
                              <Text style={s.myTeamPillTxt}>My Team</Text>
                            </View>
                          )}
                        </View>
                        {!!team.captainName && (
                          <Text style={s.teamCardCaptain}>
                            Captain: {team.captainName}
                          </Text>
                        )}
                        <Text style={s.teamCardCount}>
                          {team.playerCount || team.players.length} player{(team.playerCount || team.players.length) === 1 ? "" : "s"}
                        </Text>
                      </View>
                      {/* Record chip */}
                      {team.played > 0 && (
                        <View style={s.teamRecordChip}>
                          <Text style={s.teamRecordTxt}>{team.wins}W · {team.losses}L</Text>
                        </View>
                      )}
                    </View>

                    {/* Player roster */}
                    {team.players.length > 0 && (
                      <View style={s.rosterWrap}>
                        {team.players.map((player, pi) => (
                          <TouchableOpacity
                            key={pi}
                            style={s.playerRow}
                            disabled={!player.uid}
                            onPress={() =>
                              player.uid &&
                              router.push(`/(playon-pro)/player/${player.uid}` as any)
                            }
                            activeOpacity={0.7}
                          >
                            <View style={s.playerAvatar}>
                              <Text style={s.playerAvatarTxt}>{initials(player.name)}</Text>
                            </View>
                            <Text style={s.playerName}>{player.name}</Text>
                            {player.playonId && (
                              <Text style={s.playerPlayonId}>@{player.playonId}</Text>
                            )}
                            {player.uid && (
                              <Ionicons name="chevron-forward" size={14} color="#D1D5DB" />
                            )}
                          </TouchableOpacity>
                        ))}
                      </View>
                    )}
                  </View>
                );
              })
            )}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// FixtureRow — single match row in the Fixtures tab
// ══════════════════════════════════════════════════════════════════════════════
function FixtureRow({
  match, myTeamId, highlight, color, onPress,
}: {
  match: Match; myTeamId: string | null;
  highlight: boolean; color: string; onPress: () => void;
}) {
  const isLive      = match.status === "live";
  const isCompleted = match.status === "completed";
  const myTeamIsA   = match.teamAId === myTeamId;
  const myTeamIsB   = match.teamBId === myTeamId;
  const isMine      = myTeamIsA || myTeamIsB;

  // Result badge for completed matches involving my team
  const result = isCompleted && isMine
    ? !match.winnerId
      ? "draw"
      : match.winnerId === myTeamId
      ? "win"
      : "loss"
    : null;

  return (
    <TouchableOpacity
      style={[
        s.fixtureCard,
        highlight && { borderColor: color + "55", borderWidth: 1.5, backgroundColor: color + "06" },
        isLive && { borderColor: "#DC262633", borderWidth: 1.5 },
      ]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      {/* Top: date + status */}
      <View style={s.fixtureTop}>
        {isLive ? (
          <View style={s.livePill}>
            <View style={s.liveDot} />
            <Text style={s.livePillTxt}>LIVE</Text>
          </View>
        ) : (
          <View style={s.datePill}>
            <Ionicons name="calendar-outline" size={12} color="#9CA3AF" />
            <Text style={s.datePillTxt}>{fmtDate(match.date)}</Text>
            {!!match.startTime && <Text style={s.datePillTxt}>{match.startTime}</Text>}
          </View>
        )}
        {!!match.venue && (
          <View style={s.venuePill}>
            <Ionicons name="location-outline" size={12} color="#9CA3AF" />
            <Text style={s.venueTxt} numberOfLines={1}>{match.venue}</Text>
          </View>
        )}
        {result && (
          <View style={[
            s.resultPill,
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
              {result === "win" ? "Won" : result === "loss" ? "Lost" : "Draw"}
            </Text>
          </View>
        )}
      </View>

      {/* Teams + score */}
      <View style={s.fixtureTeams}>
        {/* Team A */}
        <View style={s.fixtureTeamBlock}>
          <View style={[
            s.fixtureCrest,
            { backgroundColor: myTeamIsA ? color : "#E5E7EB" },
          ]}>
            <Text style={[
              s.fixtureCrestTxt,
              { color: myTeamIsA ? "#fff" : "#6B7280" },
            ]}>
              {initials(match.teamAName)}
            </Text>
          </View>
          <Text style={[
            s.fixtureTeamName,
            myTeamIsA && { color, fontWeight: "800" },
          ]} numberOfLines={2}>
            {match.teamAName}
          </Text>
        </View>

        {/* Score / VS */}
        <View style={s.fixtureScoreBlock}>
          {isCompleted || isLive ? (
            <Text style={s.fixtureScore}>{match.scoreA} – {match.scoreB}</Text>
          ) : (
            <Text style={s.fixtureVs}>vs</Text>
          )}
          {!!match.liveSummary && (
            <Text style={s.fixtureSummary} numberOfLines={1}>{match.liveSummary}</Text>
          )}
        </View>

        {/* Team B */}
        <View style={[s.fixtureTeamBlock, { alignItems: "flex-end" }]}>
          <View style={[
            s.fixtureCrest,
            { backgroundColor: myTeamIsB ? color : "#E5E7EB" },
          ]}>
            <Text style={[
              s.fixtureCrestTxt,
              { color: myTeamIsB ? "#fff" : "#6B7280" },
            ]}>
              {initials(match.teamBName)}
            </Text>
          </View>
          <Text style={[
            s.fixtureTeamName,
            { textAlign: "right" },
            myTeamIsB && { color, fontWeight: "800" },
          ]} numberOfLines={2}>
            {match.teamBName}
          </Text>
        </View>
      </View>

      {/* "Next fixture" label for highlighted upcoming match */}
      {highlight && !isLive && (
        <View style={[s.nextFixtureLabel, { borderTopColor: color + "22" }]}>
          <Ionicons name="time-outline" size={12} color={color} />
          <Text style={[s.nextFixtureTxt, { color }]}>Next fixture</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

// ── Empty tab placeholder ─────────────────────────────────────────────────────
function EmptyTab({
  icon, title, sub,
}: {
  icon: keyof typeof Ionicons.glyphMap; title: string; sub: string;
}) {
  return (
    <View style={s.emptyTab}>
      <View style={s.emptyTabIcon}>
        <Ionicons name={icon} size={28} color={GREEN} />
      </View>
      <Text style={s.emptyTabTitle}>{title}</Text>
      <Text style={s.emptyTabSub}>{sub}</Text>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root:   { flex: 1, backgroundColor: "#F9FAFB" },
  center: { alignItems: "center", justifyContent: "center" },
  notFoundTxt: { fontSize: 15, color: "#6B7280", marginTop: 12 },

  topBar: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingTop: Platform.OS === "android" ? (StatusBar.currentHeight ?? 0) + 8 : 8,
    paddingBottom: 10, backgroundColor: "#F9FAFB",
  },
  backBtn:     { width: 36, height: 36, borderRadius: 18, backgroundColor: "#fff", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "#E5E7EB" },
  topBarTitle: { fontSize: 16, fontWeight: "800", color: DARK, flex: 1, textAlign: "center" },

  // Hero card
  heroCard: {
    marginHorizontal: 16, marginBottom: 8,
    backgroundColor: "#fff", borderRadius: 18,
    borderWidth: 1, borderColor: "#F3F4F6",
    borderTopWidth: 4,
    padding: 14,
    shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  heroTop:      { flexDirection: "row", alignItems: "flex-start", gap: 12, marginBottom: 12 },
  heroIcon:     { width: 48, height: 48, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  heroName:     { fontSize: 17, fontWeight: "800", color: DARK },
  heroMeta:     { fontSize: 12, color: "#6B7280", marginTop: 2 },
  statusChip:   { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  statusChipTxt:{ fontSize: 11, fontWeight: "700" },
  heroInfo:     { gap: 6, marginBottom: 10 },
  heroInfoRow:  { flexDirection: "row", alignItems: "center", gap: 6 },
  heroInfoTxt:  { fontSize: 12, color: "#6B7280" },
  heroDesc:     { fontSize: 13, color: "#4B5563", lineHeight: 19, marginTop: 8 },

  // My team banner
  myTeamBanner: {
    flexDirection: "row", alignItems: "center", gap: 10,
    borderWidth: 1, borderRadius: 12, padding: 10, marginTop: 8,
  },
  myTeamAvatar:    { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  myTeamAvatarTxt: { color: "#fff", fontWeight: "800", fontSize: 12 },
  myTeamLabel:     { fontSize: 10, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.5 },
  myTeamName:      { fontSize: 14, fontWeight: "700", color: DARK },
  myTeamRecord:    { alignItems: "flex-end" },
  myTeamRecordTxt: { fontSize: 13, fontWeight: "700" },

  // Register button
  registerBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    borderRadius: 12, paddingVertical: 12, marginTop: 12,
  },
  registerBtnTxt: { color: "#fff", fontWeight: "800", fontSize: 14 },

  // Tab bar
  tabBar: {
    flexDirection: "row", backgroundColor: "#fff",
    borderBottomColor: "#F3F4F6", borderBottomWidth: 1,
    marginBottom: 12,
  },
  tabBtn:       { flex: 1, alignItems: "center", paddingTop: 10 },
  tabTxt:       { fontSize: 12, fontWeight: "600", color: "#9CA3AF", marginTop: 3 },
  tabTxtActive: { color: GREEN },
  tabUnder:     { height: 2, width: "70%", backgroundColor: "transparent", marginTop: 8, borderRadius: 2 },
  tabUnderActive: { backgroundColor: GREEN },

  tabContent: { paddingHorizontal: 16 },

  // Fixture card
  fixtureCard: {
    backgroundColor: "#fff", borderRadius: 16,
    borderWidth: 1, borderColor: "#F3F4F6",
    padding: 14, marginBottom: 10,
  },
  fixtureTop:  { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 },
  livePill:    { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#FEF2F2", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  liveDot:     { width: 6, height: 6, borderRadius: 3, backgroundColor: "#DC2626" },
  livePillTxt: { fontSize: 11, fontWeight: "800", color: "#DC2626" },
  datePill:    { flexDirection: "row", alignItems: "center", gap: 4 },
  datePillTxt: { fontSize: 12, color: "#6B7280", fontWeight: "600" },
  venuePill:   { flexDirection: "row", alignItems: "center", gap: 3, flex: 1 },
  venueTxt:    { fontSize: 11, color: "#9CA3AF", flex: 1 },

  resultPill:  { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  resultWin:   { backgroundColor: "#F0FDF4" },
  resultLoss:  { backgroundColor: "#FEF2F2" },
  resultDraw:  { backgroundColor: "#F3F4F6" },
  resultTxt:   { fontSize: 11, fontWeight: "800" },

  fixtureTeams:     { flexDirection: "row", alignItems: "center" },
  fixtureTeamBlock: { flex: 1, alignItems: "center", gap: 6 },
  fixtureCrest:     { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  fixtureCrestTxt:  { fontSize: 15, fontWeight: "800" },
  fixtureTeamName:  { fontSize: 13, fontWeight: "600", color: DARK, textAlign: "center" },
  fixtureScoreBlock:{ alignItems: "center", paddingHorizontal: 12 },
  fixtureScore:     { fontSize: 22, fontWeight: "900", color: DARK },
  fixtureVs:        { fontSize: 15, fontWeight: "700", color: "#9CA3AF" },
  fixtureSummary:   { fontSize: 11, color: "#6B7280", marginTop: 4, textAlign: "center" },

  nextFixtureLabel: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 12, paddingTop: 10, borderTopWidth: 1 },
  nextFixtureTxt:   { fontSize: 11, fontWeight: "700" },

  // Standings
  standingsCard: {
    backgroundColor: "#fff", borderRadius: 16,
    borderWidth: 1, borderColor: "#F3F4F6", overflow: "hidden",
  },
  standingsRow:       { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 12 },
  standingsHeader:    { backgroundColor: "#F9FAFB" },
  standingsRowBorder: { borderBottomWidth: 1, borderBottomColor: "#F9FAFB" },
  standingsCell:      { width: 28, textAlign: "center", fontSize: 13, color: "#374151" },
  standingsRank:      { width: 32, textAlign: "center" },
  standingsPts:       { width: 36, textAlign: "center", color: GREEN },
  standingsAvatar:    { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  standingsAvatarTxt: { fontSize: 10, fontWeight: "800" },
  standingsTeamName:  { fontSize: 13, fontWeight: "700", color: DARK },
  standingsMyBadge:   { fontSize: 10, fontWeight: "700" },

  // Teams tab
  teamCard: {
    backgroundColor: "#fff", borderRadius: 16,
    borderWidth: 1, borderColor: "#F3F4F6", marginBottom: 10, overflow: "hidden",
  },
  teamCardHeader:    { flexDirection: "row", alignItems: "center", gap: 10, padding: 14 },
  teamCardAvatar:    { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center" },
  teamCardAvatarTxt: { fontSize: 15, fontWeight: "800" },
  teamCardName:      { fontSize: 15, fontWeight: "800", color: DARK },
  teamCardCaptain:   { fontSize: 12, color: "#6B7280", marginTop: 1 },
  teamCardCount:     { fontSize: 12, color: "#9CA3AF", marginTop: 1 },
  myTeamPill:        { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 10 },
  myTeamPillTxt:     { fontSize: 10, fontWeight: "800", color: "#fff" },
  teamRecordChip:    { paddingHorizontal: 8, paddingVertical: 4, backgroundColor: "#F9FAFB", borderRadius: 8, borderWidth: 1, borderColor: "#F3F4F6" },
  teamRecordTxt:     { fontSize: 12, fontWeight: "700", color: "#374151" },

  rosterWrap: { borderTopWidth: 1, borderTopColor: "#F9FAFB" },
  playerRow: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingHorizontal: 14, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: "#F9FAFB",
  },
  playerAvatar:    { width: 30, height: 30, borderRadius: 15, backgroundColor: "#F3F4F6", alignItems: "center", justifyContent: "center" },
  playerAvatarTxt: { fontSize: 11, fontWeight: "700", color: "#6B7280" },
  playerName:      { fontSize: 13, fontWeight: "600", color: DARK, flex: 1 },
  playerPlayonId:  { fontSize: 11, color: GREEN, fontWeight: "600" },

  // Empty tab
  emptyTab:     { alignItems: "center", paddingTop: 48, paddingHorizontal: 40 },
  emptyTabIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: "#F0FDF4", alignItems: "center", justifyContent: "center", marginBottom: 12 },
  emptyTabTitle:{ fontSize: 16, fontWeight: "700", color: DARK, textAlign: "center" },
  emptyTabSub:  { fontSize: 13, color: "#6B7280", textAlign: "center", marginTop: 6, lineHeight: 19 },
});
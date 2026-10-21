import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator,
  useWindowDimensions, SafeAreaView, StatusBar, Platform,
} from "react-native";
import { useState, useCallback, useEffect } from "react";
import { db, auth } from "../../firebaseConfig";
import { collection, query, where, onSnapshot } from "firebase/firestore";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { signOut } from "firebase/auth";

// =============================================================================
// 🏆 LEAGUE-OWNER DASHBOARD — content only (sidebar/header live in _layout.tsx)
// =============================================================================

const PRIMARY    = "#5B4FE5";
const PRIMARY_BG = "#F0EEFF";
const DARK       = "#1B2050";
const MUTED      = "#8A8FA8";
const GREEN      = "#16A34A";
const BORDER     = "#EEF0F7";
const BG         = "#F7F8FC";
const MAX_W      = 1140;


const STATUS_CFG: Record<string, { label: string; color: string; bg: string }> = {
  registration_open: { label: "UPCOMING",  color: "#2563EB", bg: "#EFF6FF" },
  ongoing:           { label: "LIVE",      color: GREEN,     bg: "#F0FDF4" },
  completed:         { label: "COMPLETED", color: MUTED,     bg: "#F3F4F6" },
};

const CREST_COLORS = ["#7C3AED", "#2563EB", "#16A34A", "#DC2626", "#D97706", "#0EA5E9"];
function crestColor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return CREST_COLORS[Math.abs(hash) % CREST_COLORS.length];
}
function initials(name: string) {
  return (name || "?").split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
}
function fmtMoney(n: number) {
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

type League = {
  id: string; name: string; season?: string; sport: string;
  status: string; teamCount: number; maxTeams: number;
  startDate: string; entryFee: number; prizePoolPercent: number;
};
type TeamLite = { id: string; leagueId: string; playerCount: number };
type MatchLite = {
  id: string; leagueId: string; teamAName: string; teamBName: string;
  date: string; startTime: string; status: string;
};

const LEAGUE_FILTERS = ["all", "ongoing", "registration_open", "completed"] as const;
type LeagueFilter = typeof LEAGUE_FILTERS[number];
const FILTER_LABEL: Record<LeagueFilter, string> = {
  all: "All", ongoing: "Live", registration_open: "Upcoming", completed: "Completed",
};

export default function LeagueOwnerDashboard() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isWide = width >= 900;

  const [ownerName, setOwnerName]   = useState("");
  const [leagues,   setLeagues]     = useState<League[]>([]);
  const [teams,     setTeams]       = useState<TeamLite[]>([]);
  const [matches,   setMatches]     = useState<MatchLite[]>([]);
  const [loading,   setLoading]     = useState(true);
  const [filter,    setFilter]      = useState<LeagueFilter>("all");
  const topPad = Platform.OS === "android"
  ? (StatusBar.currentHeight ?? 0) + (isWide ? 24 : 14)
  : (isWide ? 24 : 14);

  // ── Live leagues listener ───────────────────────────────────────────────
  useFocusEffect(
    useCallback(() => {
      const user = auth.currentUser;
      if (!user) { router.replace("/(auth)/login"); return; }
      setOwnerName(user.displayName || "");

      const unsub = onSnapshot(
        query(collection(db, "leagues"), where("organizerId", "==", user.uid)),
        (snap) => {
          const list: League[] = snap.docs.map((d) => {
            const l = d.data();
            return {
              id: d.id, name: l.name || "Untitled league", season: l.season || undefined,
              sport: l.sport || "", status: l.status || "registration_open",
              teamCount: Number(l.teamCount || 0), maxTeams: Number(l.maxTeams || 0),
              startDate: l.startDate || "", entryFee: Number(l.entryFee || 0),
              prizePoolPercent: Number(l.prizePoolPercent || 0),
            };
          });
          const order: Record<string, number> = { ongoing: 0, registration_open: 1, completed: 2 };
          list.sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));
          setLeagues(list);
          setLoading(false);
        },
        (e) => { console.error("leagues listener", e); setLoading(false); }
      );
      return unsub;
    }, [router])
  );

  // ── Live teams + matches across the owner's leagues (for aggregate stats) ──
  useEffect(() => {
    if (leagues.length === 0) { setTeams([]); setMatches([]); return; }
    const leagueIds = leagues.slice(0, 10).map((l) => l.id); // Firestore 'in' caps at 10

    const unsubTeams = onSnapshot(
      query(collection(db, "leagueTeams"), where("leagueId", "in", leagueIds)),
      (snap) => setTeams(snap.docs.map((d) => {
        const t = d.data();
        return {
          id: d.id, leagueId: t.leagueId,
          playerCount: Number(t.playerCount || (Array.isArray(t.players) ? t.players.length : 0)),
        };
      })),
      (e) => console.error("teams listener", e)
    );

    const unsubMatches = onSnapshot(
      query(collection(db, "leagueMatches"), where("leagueId", "in", leagueIds)),
      (snap) => setMatches(snap.docs.map((d) => {
        const m = d.data();
        return {
          id: d.id, leagueId: m.leagueId,
          teamAName: m.teamAName || "Team A", teamBName: m.teamBName || "Team B",
          date: m.date || "", startTime: m.startTime || "", status: m.status || "scheduled",
        };
      })),
      (e) => console.error("matches listener", e)
    );

    return () => { unsubTeams(); unsubMatches(); };
  }, [leagues.map((l) => l.id).join(",")]);

  // ── Derived stats ────────────────────────────────────────────────────────
  const ongoingCount   = leagues.filter((l) => l.status === "ongoing").length;
  const totalTeams     = leagues.reduce((sum, l) => sum + l.teamCount, 0);
  const totalPlayers   = teams.reduce((sum, t) => sum + t.playerCount, 0);
  const totalPrizePool = leagues.reduce(
    (sum, l) => sum + l.entryFee * l.teamCount * (l.prizePoolPercent / 100), 0
  );

  const leagueNameById = Object.fromEntries(leagues.map((l) => [l.id, l.name]));
  const upcomingMatches = matches
    .filter((m) => m.status !== "completed" && m.status !== "live")
    .sort((a, b) => `${a.date}${a.startTime}`.localeCompare(`${b.date}${b.startTime}`))
    .slice(0, 3)
    .map((m) => ({ ...m, leagueName: leagueNameById[m.leagueId] || "" }));

  const filteredLeagues = filter === "all" ? leagues : leagues.filter((l) => l.status === filter);

  const goCreate   = () => router.push("/(league-owner)/create-league");
  const goManage = (id: string) => router.push({ pathname: "/(league-owner)/league-manage", params: { id } } as any);
  const goTeams    = () => router.push("/(league-owner)/teams" as any);
  const goPlayers  = () => router.push("/(league-owner)/players" as any);
  const goSettings = () => router.push("/(league-owner)/settings" as any);
  const handleLogout = async () => {
  try {
    await signOut(auth);
    router.replace("/(auth)/login");
  } catch (error) {
    console.error("Logout failed:", error);
  }
};

if (loading) {
return (
  <SafeAreaView style={s.safe}>
    <ScrollView
      style={s.root}
      contentContainerStyle={{
        paddingHorizontal: isWide ? 24 : 14,
        paddingTop: topPad,
        paddingBottom: 40,
        alignItems: "center",
      }}
      showsVerticalScrollIndicator={false}
    >
      <View style={{ width: "100%", maxWidth: isWide ? MAX_W : undefined }}>
        {/* ...everything else stays exactly as you have it... */}
      </View>
    </ScrollView>
  </SafeAreaView>
);
}

 return (
    <ScrollView
      style={s.root}
      contentContainerStyle={{
        paddingHorizontal: isWide ? 24 : 14,
        paddingTop: topPad + 5,   // increase top space here
        paddingBottom: 40,
        alignItems: "center",
      }}
      showsVerticalScrollIndicator={false}
    >
      <View style={{ width: "100%", maxWidth: isWide ? MAX_W : undefined }}>

        {/* ── Header / hero ── */}
        {isWide ? (
          <View style={s.topBar}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12,}}>
              <View style={s.crownBox}><Ionicons name="trophy" size={20} color={PRIMARY} /></View>
              <View>
                <Text style={s.pageTitle}>League Dashboard</Text>
                <Text style={s.greeting}>Welcome back{ownerName ? `, ${ownerName}` : ""}</Text>
              </View>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
              <TouchableOpacity style={s.iconBtn}>
                <Ionicons name="notifications-outline" size={20} color={DARK} />
                <View style={s.bellBadge}><Text style={s.bellBadgeTxt}>3</Text></View>
              </TouchableOpacity>
              <TouchableOpacity style={s.profilePill} onPress={goSettings} activeOpacity={0.8}>
                <View style={s.profileAvatar}><Text style={s.profileAvatarTxt}>LO</Text></View>
                <View>
                  <Text style={s.profileName}>League Owner</Text>
                  <Text style={s.profileSub}>Owner</Text>
                </View>
                <Ionicons name="chevron-down" size={14} color={MUTED} />
              </TouchableOpacity>
              <TouchableOpacity style={s.createBtn} onPress={goCreate} activeOpacity={0.85}>
                <Text style={s.createBtnTxt}>Create League</Text>
                <TouchableOpacity
  style={[s.logoutBtn, { marginTop: 10 }]}
  onPress={handleLogout}
  activeOpacity={0.85}
>
  <Ionicons name="log-out-outline" size={18} color="#fff" />
  <Text style={s.logoutBtnTxt}>Logout</Text>
</TouchableOpacity>

                <Ionicons name="add" size={18} color="#fff" />
              </TouchableOpacity>

              <TouchableOpacity
  style={s.logoutBtn}
  onPress={handleLogout}
  activeOpacity={0.85}
>
  <Ionicons name="log-out-outline" size={18} color="#fff" />
  <Text style={s.logoutBtnTxt}>Logout</Text>
</TouchableOpacity>
            </View>
          </View>
        ) : (
          <View style={s.heroCard}>
            <View style={{ flexDirection: "row", gap: 12, flex: 1 }}>
              <View style={s.crownBox}><Ionicons name="trophy" size={20} color={PRIMARY} /></View>
              <View style={{ flex: 1 }}>
                <Text style={s.heroTitle}>League Owner Dashboard</Text>
                <Text style={s.heroSub}>
                  Welcome back{ownerName ? `, ${ownerName}` : ""}! Manage your leagues, teams and keep track of everything.
                </Text>
              </View>
            </View>
            <TouchableOpacity style={s.createBtn} onPress={goCreate} activeOpacity={0.85}>
              <Text style={s.createBtnTxt}>Create League</Text>
              <Ionicons name="add" size={16} color="#fff" />
            </TouchableOpacity>
          </View>
        )}

        {/* ── Stat cards ── */}
        <View style={[s.statsGrid, !isWide && { flexWrap: "wrap" }]}>
          <StatCard icon="albums-outline" iconBg="#F0EEFF" iconColor={PRIMARY}
            label="Total Leagues" value={String(leagues.length)} sub={`${ongoingCount} active · ${leagues.length - ongoingCount} other`} wide={isWide} />
          <StatCard icon="people-outline" iconBg="#EFF6FF" iconColor="#2563EB"
            label="Total Teams" value={String(totalTeams)} sub="Across all leagues" wide={isWide} />
          <StatCard icon="person-outline" iconBg="#F0FDF4" iconColor={GREEN}
            label="Total Players" value={String(totalPlayers)} sub="Registered players" wide={isWide} />
         
        </View>

        {/* ── Main grid: My Leagues + Quick Actions  |  Upcoming Matches ── */}
        <View style={isWide ? s.mainGrid : undefined}>
          <View style={isWide ? { flex: 2 } : undefined}>

            {/* My Leagues */}
            <View style={s.card}>
              <View style={s.cardHeadRow}>
                <Text style={s.cardTitle}>My Leagues</Text>
                
              </View>

              {!isWide && (
                <View style={s.filterRow}>
                  {LEAGUE_FILTERS.map((f) => {
                    const count = f === "all" ? leagues.length : leagues.filter((l) => l.status === f).length;
                    const active = filter === f;
                    return (
                      <TouchableOpacity key={f} onPress={() => setFilter(f)} style={s.filterTab}>
                        <Text style={[s.filterTxt, active && s.filterTxtActive]}>
                          {FILTER_LABEL[f]} ({count})
                        </Text>
                        {active && <View style={s.filterUnderline} />}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}

              {isWide && filteredLeagues.length > 0 && (
                <View style={s.tHead}>
                  <Text style={[s.tHeadTxt, { flex: 2.2 }]}>LEAGUE NAME</Text>
                  <Text style={[s.tHeadTxt, { flex: 1 }]}>STATUS</Text>
                  <Text style={[s.tHeadTxt, { flex: 0.8 }]}>TEAMS</Text>
                  <Text style={[s.tHeadTxt, { flex: 1 }]}>PRIZE POOL</Text>
                  <Text style={[s.tHeadTxt, { flex: 1.2 }]}>START DATE</Text>
                  <Text style={[s.tHeadTxt, { flex: 1.1, textAlign: "right" }]}>ACTION</Text>
                </View>
              )}

              {filteredLeagues.length === 0 ? (
                <View style={s.empty}>
                  <Ionicons name="trophy-outline" size={26} color={PRIMARY} />
                  <Text style={s.emptyTitle}>No leagues here</Text>
                  <Text style={s.emptySub}>Create your first league to get started.</Text>
                </View>
              ) : (
                filteredLeagues.map((l) =>
                  isWide
                    ? <LeagueTableRow key={l.id} league={l} onPress={() => goManage(l.id)} />
                    : <LeagueListCard key={l.id} league={l} onPress={() => goManage(l.id)} />
                )
              )}

           
            </View>

            {/* Quick Actions 
            <View style={s.card}>
              <Text style={[s.cardTitle, { marginBottom: 12 }]}>Quick Actions</Text>
              <View style={s.qaGrid}>
                <QuickAction icon="trophy-outline" iconBg="#F0EEFF" iconColor={PRIMARY}
                  title="Create League" sub="Set up a new league and invite teams" onPress={goCreate} />
                <QuickAction icon="shield-checkmark-outline" iconBg="#EFF6FF" iconColor="#2563EB"
                  title="Manage Teams" sub="Create and manage league teams" onPress={goTeams} />
                <QuickAction icon="person-add-outline" iconBg="#F0FDF4" iconColor={GREEN}
                  title="Add Players" sub="Add players to teams and manage roster" onPress={goPlayers} />
                <QuickAction icon="settings-outline" iconBg="#FFF7ED" iconColor="#D97706"
                  title="League Settings" sub="Configure league rules, scoring and more" onPress={goSettings} />
              </View>
            </View>
            */}

            {/* Recent Activity — honest empty state until an activity-log collection exists */}
            <View style={s.card}>
              <View style={s.cardHeadRow}>
                <Text style={s.cardTitle}>Recent Activity</Text>
              </View>
              <View style={s.activityEmpty}>
                <Ionicons name="time-outline" size={20} color={MUTED} />
                <Text style={s.activityEmptyTxt}>Activity will show up here once teams join, matches start, and more.</Text>
              </View>
            </View>
          </View>

          {/* Upcoming Matches */}
          <View style={isWide ? { flex: 1 } : undefined}>
            <View style={s.card}>
              <View style={s.cardHeadRow}>
                <Text style={s.cardTitle}>Upcoming Matches</Text>
              
              </View>

              {upcomingMatches.length === 0 ? (
                <View style={s.empty}>
                  <Ionicons name="calendar-outline" size={24} color={PRIMARY} />
                  <Text style={s.emptyTitle}>No upcoming matches</Text>
                  <Text style={s.emptySub}>Schedule fixtures from a league's Matches tab.</Text>
                </View>
              ) : (
                upcomingMatches.map((m) => <MatchRow key={m.id} match={m} />)
              )}

              <TouchableOpacity
                style={s.scheduleBtn}
                onPress={() => router.push("/(league-owner)/matches" as any)}
                activeOpacity={0.8}
              >
                <Ionicons name="calendar-outline" size={16} color={DARK} />
                <Text style={s.scheduleBtnTxt}>View Full Schedule</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </View>
    </ScrollView>
  );
}

// ── Stat card ──────────────────────────────────────────────────────────────
function StatCard({
  icon, iconBg, iconColor, label, value, sub, wide,
}: {
  icon: keyof typeof Ionicons.glyphMap; iconBg: string; iconColor: string;
  label: string; value: string; sub: string; wide: boolean;
}) {
  return (
    <View style={[st.card, !wide && { width: "48%" }]}>
      <View style={[st.iconWrap, { backgroundColor: iconBg }]}>
        <Ionicons name={icon} size={18} color={iconColor} />
      </View>
      <Text style={st.label}>{label}</Text>
      <Text style={st.value}>{value}</Text>
      <Text style={st.sub}>{sub}</Text>
    </View>
  );
}
const st = StyleSheet.create({
  card:    { flex: 1, backgroundColor: "#fff", borderRadius: 14, padding: 14, borderWidth: 1, borderColor: BORDER, marginBottom: 12 },
  iconWrap:{ width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center", marginBottom: 10 },
  label:   { fontSize: 11, color: MUTED, marginBottom: 4 },
  value:   { fontSize: 22, fontWeight: "900", color: DARK, letterSpacing: -0.5 },
  sub:     { fontSize: 10.5, color: MUTED, marginTop: 4 },
  logoutBtn: {
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  backgroundColor: "#DC2626",
  paddingHorizontal: 16,
  paddingVertical: 11,
  borderRadius: 11,
},

logoutBtnTxt: {
  color: "#fff",
  fontSize: 13,
  fontWeight: "700",
},
});

// ── League row (laptop table) ─────────────────────────────────────────────
function LeagueTableRow({ league, onPress }: { league: League; onPress: () => void }) {
  const st_ = STATUS_CFG[league.status] || STATUS_CFG.registration_open;
  const isDone = league.status === "completed";
  const prizePool = league.entryFee * league.teamCount * (league.prizePoolPercent / 100);
  return (
    <View style={tr.row}>
      <View style={[tr.cell, { flex: 2.2, flexDirection: "row", alignItems: "center", gap: 10 }]}>
        <View style={[tr.crest, { backgroundColor: crestColor(league.name) }]}>
          <Ionicons name="shield" size={16} color="#fff" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={tr.name} numberOfLines={1}>{league.name}</Text>
          {!!league.season && <Text style={tr.season}>{league.season}</Text>}
        </View>
      </View>
      <View style={[tr.cell, { flex: 1 }]}>
        <View style={[tr.statusPill, { backgroundColor: st_.bg }]}>
          <Text style={[tr.statusTxt, { color: st_.color }]}>{st_.label}</Text>
        </View>
      </View>
      <Text style={[tr.cell, tr.plainTxt, { flex: 0.8 }]}>{league.teamCount}/{league.maxTeams || "–"}</Text>
      <Text style={[tr.cell, tr.prizeTxt, { flex: 1 }]}>{prizePool > 0 ? fmtMoney(prizePool) : "–"}</Text>
      <Text style={[tr.cell, tr.plainTxt, { flex: 1.2 }]}>{league.startDate || "TBD"}</Text>
      <View style={[tr.cell, { flex: 1.1, alignItems: "flex-end" }]}>
        <TouchableOpacity style={tr.actionBtn} onPress={onPress} activeOpacity={0.85}>
          <Text style={tr.actionBtnTxt}>{isDone ? "View Report" : "Manage"}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
const tr = StyleSheet.create({
  row:        { flexDirection: "row", alignItems: "center", paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: BORDER },
  cell:       { justifyContent: "center" },
  crest:      { width: 34, height: 34, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  name:       { fontSize: 13.5, fontWeight: "700", color: DARK },
  season:     { fontSize: 11, color: MUTED, marginTop: 1 },
  statusPill: { alignSelf: "flex-start", paddingHorizontal: 9, paddingVertical: 3, borderRadius: 6 },
  statusTxt:  { fontSize: 10, fontWeight: "800", letterSpacing: 0.3 },
  plainTxt:   { fontSize: 12.5, color: DARK, fontWeight: "600" },
  prizeTxt:   { fontSize: 12.5, color: GREEN, fontWeight: "800" },
  actionBtn:    { backgroundColor: DARK, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 9 },
  actionBtnTxt: { color: "#fff", fontWeight: "700", fontSize: 12 },
});

// ── League card (mobile) ──────────────────────────────────────────────────
function LeagueListCard({ league, onPress }: { league: League; onPress: () => void }) {
  const st_ = STATUS_CFG[league.status] || STATUS_CFG.registration_open;
  const isDone = league.status === "completed";
  const prizePool = league.entryFee * league.teamCount * (league.prizePoolPercent / 100);
  return (
    <TouchableOpacity style={lcm.wrap} onPress={onPress} activeOpacity={0.85}>
      <View style={[lcm.crest, { backgroundColor: crestColor(league.name) }]}>
        <Ionicons name="shield" size={18} color="#fff" />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={lcm.name} numberOfLines={1}>{league.name}</Text>
        {!!league.season && <Text style={lcm.season}>{league.season}</Text>}
        <View style={[lcm.statusPill, { backgroundColor: st_.bg, marginTop: 4 }]}>
          <Text style={[lcm.statusTxt, { color: st_.color }]}>{st_.label}</Text>
        </View>
        <View style={lcm.metaRow}>
          <Text style={lcm.metaTxt}>{league.teamCount}/{league.maxTeams || "–"} Teams</Text>
          <Text style={lcm.metaDot}>·</Text>
          <Text style={[lcm.metaTxt, { color: GREEN, fontWeight: "700" }]}>{prizePool > 0 ? fmtMoney(prizePool) : "–"}</Text>
        </View>
        {!!league.startDate && (
          <View style={lcm.metaRow}>
            <Ionicons name="calendar-outline" size={11} color={MUTED} />
            <Text style={lcm.metaTxt}>{league.startDate}</Text>
          </View>
        )}
      </View>
      <View style={lcm.actionBtn}>
        <Text style={lcm.actionBtnTxt}>{isDone ? "View" : "Manage"}</Text>
      </View>
    </TouchableOpacity>
  );
}
const lcm = StyleSheet.create({
  wrap:       { flexDirection: "row", gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: BORDER, alignItems: "flex-start" },
  crest:      { width: 40, height: 40, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  name:       { fontSize: 14, fontWeight: "700", color: DARK },
  season:     { fontSize: 11, color: MUTED, marginTop: 1 },
  statusPill: { alignSelf: "flex-start", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 5 },
  statusTxt:  { fontSize: 9, fontWeight: "800" },
  metaRow:    { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 5 },
  metaTxt:    { fontSize: 11, color: MUTED },
  metaDot:    { fontSize: 11, color: MUTED },
  actionBtn:    { backgroundColor: DARK, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, alignSelf: "center" },
  actionBtnTxt: { color: "#fff", fontWeight: "700", fontSize: 11 },
});

// ── Match row (Upcoming Matches) ──────────────────────────────────────────
function MatchRow({ match }: { match: { teamAName: string; teamBName: string; date: string; startTime: string; leagueName: string } }) {
  return (
    <View style={mr.wrap}>
      <View style={mr.topRow}>
        <View style={mr.tag}><Text style={mr.tagTxt}>UPCOMING</Text></View>
        <Text style={mr.dateTxt}>{match.date}{match.startTime ? ` · ${match.startTime}` : ""}</Text>
      </View>
      <View style={mr.teamsRow}>
        <Text style={mr.teamTxt} numberOfLines={1}>{match.teamAName}</Text>
        <View style={[mr.crestMini, { backgroundColor: crestColor(match.teamAName) }]}>
          <Text style={mr.crestMiniTxt}>{initials(match.teamAName)}</Text>
        </View>
        <Text style={mr.vsTxt}>VS</Text>
        <View style={[mr.crestMini, { backgroundColor: crestColor(match.teamBName) }]}>
          <Text style={mr.crestMiniTxt}>{initials(match.teamBName)}</Text>
        </View>
        <Text style={[mr.teamTxt, { textAlign: "right" }]} numberOfLines={1}>{match.teamBName}</Text>
      </View>
      {!!match.leagueName && <Text style={mr.leagueTxt} numberOfLines={1}>{match.leagueName}</Text>}
    </View>
  );
}
const mr = StyleSheet.create({
  wrap:    { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: BORDER },
  topRow:  { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  tag:     { backgroundColor: PRIMARY_BG, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 5 },
  tagTxt:  { fontSize: 9, fontWeight: "800", color: PRIMARY },
  dateTxt: { fontSize: 10.5, color: MUTED },
  teamsRow:{ flexDirection: "row", alignItems: "center", gap: 8 },
  teamTxt: { flex: 1, fontSize: 12.5, fontWeight: "700", color: DARK },
  crestMini:   { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  crestMiniTxt:{ fontSize: 9, fontWeight: "800", color: "#fff" },
  vsTxt:   { fontSize: 10, fontWeight: "800", color: MUTED },
  leagueTxt:{ fontSize: 10.5, color: MUTED, marginTop: 6, textAlign: "center" },
});

// ── Quick action card ──────────────────────────────────────────────────────
function QuickAction({
  icon, iconBg, iconColor, title, sub, onPress,
}: { icon: keyof typeof Ionicons.glyphMap; iconBg: string; iconColor: string; title: string; sub: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={qa.card} onPress={onPress} activeOpacity={0.85}>
      <View style={[qa.iconWrap, { backgroundColor: iconBg }]}>
        <Ionicons name={icon} size={18} color={iconColor} />
      </View>
      <Text style={qa.title}>{title}</Text>
      <Text style={qa.sub}>{sub}</Text>
      <Ionicons name="arrow-forward" size={14} color={MUTED} style={{ marginTop: 8 }} />
    </TouchableOpacity>
  );
}
const qa = StyleSheet.create({
  card:    { width: "48%", backgroundColor: BG, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: BORDER, marginBottom: 12 },
  iconWrap:{ width: 32, height: 32, borderRadius: 9, alignItems: "center", justifyContent: "center", marginBottom: 10 },
  title:   { fontSize: 13, fontWeight: "700", color: DARK },
  sub:     { fontSize: 11, color: MUTED, marginTop: 3, lineHeight: 15 },
});

// ── Styles ────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
    safe: { flex: 1, backgroundColor: BG },
  root: { flex: 1, backgroundColor: BG },


  topBar:   { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 20 },
  crownBox: { width: 44, height: 44, borderRadius: 12, backgroundColor: PRIMARY_BG, alignItems: "center", justifyContent: "center" },
  pageTitle:{ fontSize: 22, fontWeight: "900", color: DARK, letterSpacing: -0.3 },
  greeting: { fontSize: 12.5, color: MUTED, marginTop: 2 },

  iconBtn:    { width: 38, height: 38, borderRadius: 10, backgroundColor: "#fff", borderWidth: 1, borderColor: BORDER, alignItems: "center", justifyContent: "center" },
  bellBadge:  { position: "absolute", top: -3, right: -3, width: 14, height: 14, borderRadius: 7, backgroundColor: "#DC2626", alignItems: "center", justifyContent: "center" },
  bellBadgeTxt:{ fontSize: 8, fontWeight: "800", color: "#fff" },

  profilePill:    { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#fff", borderWidth: 1, borderColor: BORDER, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 6 },
  profileAvatar:  { width: 30, height: 30, borderRadius: 15, backgroundColor: DARK, alignItems: "center", justifyContent: "center" },
  profileAvatarTxt:{ fontSize: 11, fontWeight: "800", color: "#fff" },
  profileName:    { fontSize: 12, fontWeight: "700", color: DARK },
  profileSub:     { fontSize: 10, color: MUTED },

  createBtn:    { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: PRIMARY, paddingHorizontal: 16, paddingVertical: 11, borderRadius: 11 },
  createBtnTxt: { color: "#fff", fontWeight: "700", fontSize: 13.5 },

  heroCard: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", backgroundColor: "#fff", borderRadius: 16, borderWidth: 1, borderColor: BORDER, padding: 14, marginBottom: 16, gap: 12 },
  heroTitle:{ fontSize: 16, fontWeight: "900", color: DARK },
  heroSub:  { fontSize: 12, color: MUTED, marginTop: 3, lineHeight: 17 },

  statsGrid: { flexDirection: "row", gap: 12, marginBottom: 16, justifyContent: "space-between" },

  mainGrid: { flexDirection: "row", gap: 16, alignItems: "flex-start" },

  card:        { backgroundColor: "#fff", borderRadius: 16, borderWidth: 1, borderColor: BORDER, padding: 16, marginBottom: 16 },
  cardHeadRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  cardTitle:   { fontSize: 15.5, fontWeight: "800", color: DARK },
  linkTxt:     { fontSize: 12.5, fontWeight: "700", color: PRIMARY },

  filterRow:      { flexDirection: "row", gap: 16, marginBottom: 10, borderBottomWidth: 1, borderBottomColor: BORDER },
  filterTab:      { paddingBottom: 8 },
  filterTxt:      { fontSize: 12.5, fontWeight: "600", color: MUTED },
  filterTxtActive:{ color: PRIMARY, fontWeight: "800" },
  filterUnderline:{ height: 2, backgroundColor: PRIMARY, borderRadius: 2, marginTop: 6 },

  tHead:    { flexDirection: "row", paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: BORDER },
  tHeadTxt: { fontSize: 10, fontWeight: "700", color: MUTED, letterSpacing: 0.4 },

  empty:      { alignItems: "center", paddingVertical: 28, gap: 6 },
  emptyTitle: { fontSize: 14, fontWeight: "700", color: DARK },
  emptySub:   { fontSize: 12, color: MUTED, textAlign: "center" },



  qaGrid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between" },

  activityEmpty:    { flexDirection: "row", alignItems: "center", gap: 10, padding: 14, backgroundColor: BG, borderRadius: 12 },
  activityEmptyTxt: { flex: 1, fontSize: 12, color: MUTED, lineHeight: 17 },

  scheduleBtn:    { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderWidth: 1, borderColor: BORDER, borderRadius: 11, paddingVertical: 11, marginTop: 6 },
  scheduleBtnTxt: { fontSize: 12.5, fontWeight: "700", color: DARK },
});
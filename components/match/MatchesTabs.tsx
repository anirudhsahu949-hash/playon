import {
  View, Text, StyleSheet, ScrollView,
  TouchableOpacity, ActivityIndicator, RefreshControl,
} from "react-native";
import { useState, useCallback } from "react";
import { db } from "../../firebaseConfig";
import { collection, query, where, getDocs } from "firebase/firestore";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import LiveMatchCard from "../../components/match/LiveMatchCard";

// =============================================================================
// 📅 MATCHES TAB — redesigned v2
//
// • Live matches   → LiveMatchCard (dark gradient, reusable component)
// • Upcoming       → compact single-row card with blue left border (~65px)
// • Completed      → inline score card with result pill, no CTA row
// =============================================================================

const BG     = "#EEF0F7";
const DARK   = "#1E2340";
const MEDIUM = "#4B5270";
const MUTED  = "#8A8FA8";
const BORDER = "#E2E5F0";
const GREEN  = "#16A34A";
const RED    = "#E11D2A";

type MatchItem = {
  id: string; teamAName: string; teamBName: string;
  date: string; startTime: string; venue: string;
  status: string; scoreA: number; scoreB: number;
  oversA: string; oversB: string;
  liveSummary: string; result: string;
  matchNumber?: number;
};
type MatchesTabProps = { leagueId: string; currentMatchId: string };
const STATUS_ORDER: Record<string, number> = { live: 0, scheduled: 1, completed: 2 };

function formatDate(date: string, time: string) {
  if (!date) return time || "TBD";
  try {
    const d = new Date(date), now = new Date(), tom = new Date();
    tom.setDate(now.getDate() + 1);
    const tag =
      d.toDateString() === now.toDateString() ? "Today" :
      d.toDateString() === tom.toDateString() ? "Tomorrow" :
      d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
    return time ? `${tag} · ${time}` : tag;
  } catch { return date; }
}

// Small team crest badge
function Crest({ name, bg = "#EEF0F7", color = DARK }: { name: string; bg?: string; color?: string }) {
  const txt = (name || "?").split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);
  return (
    <View style={[cs.crest, { backgroundColor: bg, borderColor: color + "28" }]}>
      <Text style={[cs.crestTxt, { color }]}>{txt}</Text>
    </View>
  );
}

const cs = StyleSheet.create({
  crest:    { width: 28, height: 28, borderRadius: 7, alignItems: "center", justifyContent: "center", borderWidth: 1, flexShrink: 0 },
  crestTxt: { fontSize: 9, fontWeight: "800" },
});

// Section header
function SectionLabel({ dot, title, color, count }: { dot: string; title: string; color: string; count: number }) {
  return (
    <View style={s.sectionRow}>
      <View style={[s.sectionDot, { backgroundColor: color }]} />
      <Text style={[s.sectionTitle, { color }]}>{title}</Text>
      <View style={[s.sectionBadge, { backgroundColor: color + "18" }]}>
        <Text style={[s.sectionCount, { color }]}>{count}</Text>
      </View>
    </View>
  );
}

export default function MatchesTab({ leagueId, currentMatchId }: MatchesTabProps) {
  const router = useRouter();
  const [matches, setMatches]       = useState<MatchItem[]>([]);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!leagueId) { setLoading(false); return; }
    try {
      const snap = await getDocs(query(collection(db, "leagueMatches"), where("leagueId", "==", leagueId)));
      const list: MatchItem[] = snap.docs.map(d => {
        const m = d.data();
        return {
          id: d.id,
          teamAName:   m.teamAName   || "Team A",
          teamBName:   m.teamBName   || "Team B",
          date:        m.date        || "",
          startTime:   m.startTime   || "",
          venue:       m.venue       || "",
          status:      m.status      || "scheduled",
          scoreA:      Number(m.scoreA  || 0),
          scoreB:      Number(m.scoreB  || 0),
          oversA:      m.oversA      || "",
          oversB:      m.oversB      || "",
          liveSummary: m.liveSummary || "",
          result:      m.result      || "",
          matchNumber: m.matchNumber ?? undefined,
        };
      });
      list.sort((a, b) => {
        const so = (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9);
        return so !== 0 ? so : (a.date || "").localeCompare(b.date || "");
      });
      setMatches(list);
    } catch (e) { console.error("MatchesTab:", e); }
    finally { setLoading(false); setRefreshing(false); }
  }, [leagueId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  const onRefresh = () => { setRefreshing(true); load(); };

  if (loading) return <View style={s.center}><ActivityIndicator color={GREEN} size="large" /></View>;

  if (matches.length === 0) return (
    <View style={s.center}>
      <View style={s.emptyIcon}><Ionicons name="calendar-outline" size={28} color={GREEN} /></View>
      <Text style={s.emptyTitle}>No fixtures yet</Text>
      <Text style={s.emptySub}>Matches appear once the league owner adds them.</Text>
    </View>
  );

  const live      = matches.filter(m => m.status === "live");
  const upcoming  = matches.filter(m => m.status === "scheduled");
  const completed = matches.filter(m => m.status === "completed");

  // ── Upcoming card ─────────────────────────────────────────────────────────
  const renderUpcoming = (m: MatchItem) => (
    <TouchableOpacity
      key={m.id}
      style={s.upcomingCard}
      activeOpacity={0.8}
      onPress={() => router.push(`/(playon-pro)/match/${m.id}` as any)}
    >
      {/* Date + badge + venue */}
      <View style={s.upcomingTop}>
        <View style={s.upcomingBadge}>
          <Text style={s.upcomingBadgeTxt}>Upcoming</Text>
        </View>
        <Text style={s.upcomingDate}>{formatDate(m.date, m.startTime)}</Text>
        {!!m.venue && <Text style={s.upcomingVenue} numberOfLines={1}>{m.venue}</Text>}
      </View>

      {/* Teams: single row */}
      <View style={s.upcomingTeams}>
        <View style={s.upcomingTeamLeft}>
          <Crest name={m.teamAName} />
          <Text style={s.upcomingTeamName} numberOfLines={1}>{m.teamAName}</Text>
        </View>
        <Text style={s.upcomingVS}>VS</Text>
        <View style={s.upcomingTeamRight}>
          <Text style={[s.upcomingTeamName, { textAlign: "right" }]} numberOfLines={1}>{m.teamBName}</Text>
          <Crest name={m.teamBName} bg="#FEF3C7" color="#92400E" />
        </View>
      </View>
    </TouchableOpacity>
  );

  // ── Completed card ────────────────────────────────────────────────────────
  const renderCompleted = (m: MatchItem) => {
    const aWon = m.scoreA > m.scoreB;
    const bWon = m.scoreB > m.scoreA;
    return (
      <TouchableOpacity
        key={m.id}
        style={s.completedCard}
        activeOpacity={0.8}
        onPress={() => router.push(`/(playon-pro)/match/${m.id}` as any)}
      >
        {/* Top: Final badge + date */}
        <View style={s.completedTop}>
          <View style={s.finalBadge}><Text style={s.finalBadgeTxt}>Final</Text></View>
          <Text style={s.completedDate}>{formatDate(m.date, "")}</Text>
        </View>

        {/* Score row */}
        <View style={s.completedScoreRow}>
          {/* Team A */}
          <View style={s.completedTeamLeft}>
            <Crest name={m.teamAName} />
            <View style={{ minWidth: 0 }}>
              <Text style={[s.completedName, !aWon && { opacity: 0.5 }]} numberOfLines={1}>{m.teamAName}</Text>
              <Text style={[s.completedScore, !aWon && { opacity: 0.5 }]}>{m.scoreA}{m.oversA ? `  (${m.oversA})` : ""}</Text>
            </View>
          </View>

          <Text style={s.completedDash}>–</Text>

          {/* Team B */}
          <View style={s.completedTeamRight}>
            <View style={{ alignItems: "flex-end", minWidth: 0 }}>
              <Text style={[s.completedName, { textAlign: "right" }, !bWon && { opacity: 0.5 }]} numberOfLines={1}>{m.teamBName}</Text>
              <Text style={[s.completedScore, { textAlign: "right" }, !bWon && { opacity: 0.5 }]}>{m.scoreB}{m.oversB ? `  (${m.oversB})` : ""}</Text>
            </View>
            <Crest name={m.teamBName} bg="#FEF3C7" color="#92400E" />
          </View>
        </View>

        {/* Result pill */}
        {!!m.result && (
          <View style={s.resultPill}>
            <Text style={s.resultEmoji}>🏆</Text>
            <Text style={s.resultTxt} numberOfLines={1}>{m.result}</Text>
          </View>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: BG }}
      contentContainerStyle={{ paddingBottom: 32, paddingTop: 12 }}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={GREEN} />}
    >
      {/* ── Live ── */}
      {live.length > 0 && (
        <>
          <SectionLabel dot="" title="LIVE NOW" color={RED} count={live.length} />
          {live.map(m => (
            <LiveMatchCard
              key={m.id}
              matchId={m.id}
              teamAName={m.teamAName}
              teamAScore={String(m.scoreA)}
              teamAOvers={m.oversA}
              teamBName={m.teamBName}
              teamBScore={String(m.scoreB)}
              teamBOvers={m.oversB}
              summary={m.liveSummary}
              venue={m.venue}
              matchNumber={m.matchNumber}
              isCurrentMatch={m.id === currentMatchId}
              style={{ marginHorizontal: 10, marginBottom: 8 }}
            />
          ))}
        </>
      )}

      {/* ── Upcoming ── */}
      {upcoming.length > 0 && (
        <>
          <SectionLabel dot="" title="UPCOMING" color="#2563EB" count={upcoming.length} />
          {upcoming.map(renderUpcoming)}
        </>
      )}

      {/* ── Completed ── */}
      {completed.length > 0 && (
        <>
          <SectionLabel dot="" title="COMPLETED" color={MUTED} count={completed.length} />
          {completed.map(renderCompleted)}
        </>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  center:     { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, backgroundColor: BG },
  emptyIcon:  { width: 64, height: 64, borderRadius: 32, backgroundColor: GREEN + "14", alignItems: "center", justifyContent: "center" },
  emptyTitle: { fontSize: 16, fontWeight: "700", color: DARK },
  emptySub:   { fontSize: 13, color: MUTED, textAlign: "center", paddingHorizontal: 32, lineHeight: 19 },

  // Section label
  sectionRow:   { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, marginBottom: 7, marginTop: 4 },
  sectionDot:   { width: 7, height: 7, borderRadius: 4 },
  sectionTitle: { fontSize: 12, fontWeight: "800" },
  sectionBadge: { paddingHorizontal: 7, paddingVertical: 1, borderRadius: 8 },
  sectionCount: { fontSize: 10, fontWeight: "800" },

  // ── Upcoming card ──
  upcomingCard: {
    marginHorizontal: 10, marginBottom: 7,
    backgroundColor: "#fff",
    borderRadius: 12,
    borderLeftWidth: 3.5, borderLeftColor: "#2563EB",
    overflow: "hidden",
    shadowColor: DARK, shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  upcomingTop: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 12, paddingTop: 9, paddingBottom: 7,
  },
  upcomingBadge: {
    backgroundColor: "#EFF6FF", borderWidth: 1, borderColor: "#BFDBFE",
    paddingHorizontal: 7, paddingVertical: 2, borderRadius: 5,
  },
  upcomingBadgeTxt: { fontSize: 8.5, fontWeight: "800", color: "#2563EB" },
  upcomingDate:     { fontSize: 10, color: MUTED, fontWeight: "500", flex: 1 },
  upcomingVenue:    { fontSize: 9.5, color: MUTED },

  upcomingTeams: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 12, paddingBottom: 10,
  },
  upcomingTeamLeft:  { flex: 1, flexDirection: "row", alignItems: "center", gap: 7 },
  upcomingTeamRight: { flex: 1, flexDirection: "row", alignItems: "center", gap: 7, justifyContent: "flex-end" },
  upcomingTeamName:  { flex: 1, fontSize: 12, fontWeight: "700", color: DARK },
  upcomingVS:        { fontSize: 11, fontWeight: "900", color: "#D1D5DB", paddingHorizontal: 8 },

  // ── Completed card ──
  completedCard: {
    marginHorizontal: 10, marginBottom: 7,
    backgroundColor: "#fff",
    borderRadius: 12,
    borderLeftWidth: 3.5, borderLeftColor: BORDER,
    overflow: "hidden",
    shadowColor: DARK, shadowOpacity: 0.05, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 1,
  },
  completedTop: {
    flexDirection: "row", alignItems: "center", gap: 7,
    paddingHorizontal: 12, paddingTop: 9, paddingBottom: 7,
  },
  finalBadge:    { backgroundColor: "#F4F6FB", borderWidth: 1, borderColor: BORDER, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 5 },
  finalBadgeTxt: { fontSize: 8.5, fontWeight: "700", color: MUTED },
  completedDate: { fontSize: 10, color: MUTED, fontWeight: "500" },

  completedScoreRow: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 12, paddingBottom: 9, gap: 8,
  },
  completedTeamLeft:  { flex: 1, flexDirection: "row", alignItems: "center", gap: 8, minWidth: 0 },
  completedTeamRight: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8, justifyContent: "flex-end", minWidth: 0 },
  completedName:  { fontSize: 11.5, fontWeight: "700", color: DARK },
  completedScore: { fontSize: 15, fontWeight: "900", color: DARK, letterSpacing: -0.3 },
  completedDash:  { fontSize: 14, color: "#D1D5DB", fontWeight: "300" },

  resultPill: {
    flexDirection: "row", alignItems: "center", gap: 5,
    marginHorizontal: 12, marginBottom: 9,
    backgroundColor: "#F0FDF4", borderRadius: 8, padding: 6,
  },
  resultEmoji: { fontSize: 11 },
  resultTxt:   { fontSize: 11, fontWeight: "700", color: "#15803D", flex: 1 },
});

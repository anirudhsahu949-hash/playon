import React, { useState, useCallback, useRef, useEffect, useMemo } from "react";
import {
  View,
  Text,
  Image,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
  StatusBar,
  Platform,
  ActivityIndicator,
  RefreshControl,
  TextInput,
} from "react-native";
import { db, auth } from "../../firebaseConfig";
import { collection, query, where, getDocs, limit } from "firebase/firestore";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import TeamAvatar from "../../components/Teamavatar";

// =============================================================================
// 🏆 PLAYON — LEAGUES HOME  (app/(playon-pro)/index.tsx)
//
// Redesign: no brand colour anywhere. Warm neutral paper + two signal colours
// only — RED for live, AMBER for match status lines. Team crests keep their
// own colours (Cloudinary logo if uploaded, TeamAvatar fallback otherwise).
//
// Sections, all vertical:  Live  ·  Upcoming  ·  Finished
// =============================================================================

// ── Theme ────────────────────────────────────────────────────────────────────
const PAGE_BG   = "#F4F2EF"; // warm paper, not grey
const CARD      = "#FFFFFF";
const INK       = "#141414";
const STRONG    = "#2E2A26";
const SECONDARY = "#4A443E";
const MUTED     = "#7A736C"; // 4.9:1 on white — safe for 11px labels
const LINE      = "#EDE8E0";
const DIVIDER   = "#F1ECE4";
const FILL      = "#F2EEE7";
const FILL_SOFT = "#F6F3ED";
const RED       = "#D32F2F"; // live only
const AMBER     = "#8A6514"; // status lines
const TAN       = "#A0761B"; // bat icon, upcoming marker
const TAN_SOFT  = "#F9F3E7";
const TAN_LINE  = "#C8A260";
const GREY_BAR  = "#CFC7BB";

// ── Types ────────────────────────────────────────────────────────────────────
type Match = {
  id: string;
  leagueId: string | null;
  leagueName: string;
  sport: string;
  format: string;               // "T20" | "T10" | ...
  venue: string;
  date: string;
  startTime: string;
  status: string;               // live | scheduled | finished | completed
  liveSummary: string;
  organizerId: string | null;

  teamAName: string;
  teamBName: string;
  teamAIconName?: string | null;
  teamAIconColor?: string | null;
  teamBIconName?: string | null;
  teamBIconColor?: string | null;
  teamALogoUrl?: string | null; // Cloudinary
  teamBLogoUrl?: string | null;

  scoreA: number;
  scoreB: number;
  wicketsA: number | null;
  wicketsB: number | null;
  oversA: string;               // "20.0"
  oversB: string;
  battingTeam: "A" | "B" | null;
  inningsStarted: { a: boolean; b: boolean };
};

type SectionKey = "live" | "upcoming" | "finished";

// ── Helpers ──────────────────────────────────────────────────────────────────
function toMatch(d: any): Match {
  const m = d.data();
  const hasA = m.inningsAStarted ?? (Number(m.scoreA ?? 0) > 0 || !!m.oversA);
  const hasB = m.inningsBStarted ?? (Number(m.scoreB ?? 0) > 0 || !!m.oversB);
  return {
    id: d.id,
    leagueId: m.leagueId ?? null,
    leagueName: m.leagueName || "",
    sport: m.sport || "",
    format: m.format || "",
    venue: m.venue || "",
    date: m.date || "",
    startTime: m.startTime || "",
    status: m.status || "",
    liveSummary: m.liveSummary || "",
    organizerId: m.organizerId ?? null,

    teamAName: m.teamAName || "Team A",
    teamBName: m.teamBName || "Team B",
    teamAIconName: m.teamAIconName ?? null,
    teamAIconColor: m.teamAIconColor ?? null,
    teamBIconName: m.teamBIconName ?? null,
    teamBIconColor: m.teamBIconColor ?? null,
    teamALogoUrl: m.teamALogoUrl ?? null,
    teamBLogoUrl: m.teamBLogoUrl ?? null,

    scoreA: Number(m.scoreA ?? 0),
    scoreB: Number(m.scoreB ?? 0),
    wicketsA: m.wicketsA === undefined || m.wicketsA === null ? null : Number(m.wicketsA),
    wicketsB: m.wicketsB === undefined || m.wicketsB === null ? null : Number(m.wicketsB),
    oversA: m.oversA || "",
    oversB: m.oversB || "",
    battingTeam: m.battingTeam === "A" || m.battingTeam === "B" ? m.battingTeam : null,
    inningsStarted: { a: !!hasA, b: !!hasB },
  };
}

const isLive     = (m: Match) => m.status === "live";
const isFinished = (m: Match) => m.status === "finished" || m.status === "completed";

/** "142-7" when wickets are tracked, otherwise just the runs. */
function scoreText(runs: number, wickets: number | null) {
  return wickets === null ? String(runs) : `${runs}-${wickets}`;
}

/** The line under the score. Falls back to whatever the organizer typed. */
function statusLine(m: Match): string {
  if (isFinished(m)) {
    if (m.scoreA === m.scoreB) return "Match tied";
    const aWon = m.scoreA > m.scoreB;
    const margin = Math.abs(m.scoreA - m.scoreB);
    return `${aWon ? m.teamAName : m.teamBName} won by ${margin} run${margin === 1 ? "" : "s"}`;
  }

  if (isLive(m)) {
    // Second innings → the line Anirudh asked for: needs N runs to win.
    if (m.battingTeam && m.inningsStarted.a && m.inningsStarted.b) {
      const chasing = m.battingTeam === "B";
      const target  = (chasing ? m.scoreA : m.scoreB) + 1;
      const made    = chasing ? m.scoreB : m.scoreA;
      const name    = chasing ? m.teamBName : m.teamAName;
      const need    = target - made;
      if (need > 0) return `${name} need ${need} run${need === 1 ? "" : "s"} to win`;
    }
    return m.liveSummary || "First innings in progress";
  }

  return m.startTime ? `Starts ${m.startTime}` : "Time to be announced";
}

/** Organizer lands on the management screen, everyone else on the viewer. */
function matchDestination(m: Match, myUid: string | null): string {
  const isMine = !!myUid && !!m.organizerId && m.organizerId === myUid;
  if (!isMine) return `/(playon-pro)/match/${m.id}`;
  return m.leagueId
    ? `/(playon-pro)/league-manage?id=${m.leagueId}`
    : `/(playon-pro)/manage-match?id=${m.id}`;
}

/** Today / Tomorrow / 16 Nov — for the upcoming badge. */
function dateBadge(dateStr: string): { label: string; today: boolean } {
  if (!dateStr) return { label: "TBA", today: false };
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return { label: dateStr.toUpperCase(), today: false };
  const now = new Date();
  const tom = new Date(); tom.setDate(now.getDate() + 1);
  if (d.toDateString() === now.toDateString()) return { label: "TODAY", today: true };
  if (d.toDateString() === tom.toDateString()) return { label: "TOMORROW", today: false };
  return {
    label: d.toLocaleDateString("en-IN", { day: "numeric", month: "short" }).toUpperCase(),
    today: false,
  };
}

// ── Team crest — Cloudinary logo, else the existing TeamAvatar ───────────────
function TeamCrest({
  url, name, iconName, iconColor, size, dim,
}: {
  url?: string | null;
  name: string;
  iconName?: string | null;
  iconColor?: string | null;
  size: number;
  dim?: boolean;
}) {
  if (url) {
    return (
      <Image
        source={{ uri: url }}
        style={{ width: size, height: size, borderRadius: size / 2, opacity: dim ? 0.5 : 1 }}
      />
    );
  }
  return (
    <View style={{ opacity: dim ? 0.5 : 1 }}>
      <TeamAvatar name={name} iconName={iconName} iconColor={iconColor} size={size} />
    </View>
  );
}

// ── One team row inside a card ───────────────────────────────────────────────
function TeamRow({
  name, logoUrl, iconName, iconColor,
  score, overs, batting, muted, showScore,
}: {
  name: string;
  logoUrl?: string | null;
  iconName?: string | null;
  iconColor?: string | null;
  score: string;
  overs: string;
  batting: boolean;
  muted: boolean;
  showScore: boolean;
}) {
  return (
    <View style={c.teamRow}>
      <TeamCrest url={logoUrl} name={name} iconName={iconName} iconColor={iconColor} size={32} dim={muted} />

      <Text style={[c.teamName, muted ? c.teamNameMuted : batting ? c.teamNameBatting : null]} numberOfLines={1}>
        {name}
      </Text>

      {/* the bat slot is always reserved so scores stay in one column */}
      {batting ? (
        <Ionicons name="tennisball" size={14} color={TAN} style={c.batIcon} />
      ) : (
        <View style={c.batSpacer} />
      )}

      {showScore ? (
        <>
          <Text style={[c.score, muted && c.scoreMuted, batting && c.scoreBatting]}>{score}</Text>
          <Text style={[c.overs, muted && c.oversMuted]}>{overs}</Text>
        </>
      ) : (
        <Text style={c.yetToBat}>Yet to bat</Text>
      )}
    </View>
  );
}

// ── Match card — one shape for all three sections ────────────────────────────
function MatchCard({ m, onPress }: { m: Match; onPress: () => void }) {
  const live     = isLive(m);
  const finished = isFinished(m);
  const upcoming = !live && !finished;

  const aBatting = live && m.battingTeam === "A";
  const bBatting = live && m.battingTeam === "B";
  const aWon     = finished && m.scoreA > m.scoreB;
  const bWon     = finished && m.scoreB > m.scoreA;

  const badge = dateBadge(m.date);
  const meta  = [m.format || m.sport, m.venue].filter(Boolean).join(" · ");

  return (
    <TouchableOpacity style={c.card} activeOpacity={0.85} onPress={onPress}>
      {/* context line + status badge */}
      <View style={c.cardTop}>
        <View style={c.cardTopText}>
          <Text style={c.leagueName} numberOfLines={1}>
            {m.leagueName || "Quick match"}
          </Text>
          {!!meta && <Text style={c.metaLine} numberOfLines={1}>{meta}</Text>}
        </View>

        {live && (
          <View style={c.liveBadge}>
            <View style={c.liveDot} />
            <Text style={c.liveBadgeTxt}>LIVE</Text>
          </View>
        )}
        {upcoming && (
          <View style={badge.today ? c.todayBadge : c.dateBadge}>
            <Text style={badge.today ? c.todayBadgeTxt : c.dateBadgeTxt}>{badge.label}</Text>
          </View>
        )}
        {finished && (
          <View style={c.doneBadge}>
            <Text style={c.doneBadgeTxt}>DONE</Text>
          </View>
        )}
      </View>

      {/* teams */}
      <View style={c.teams}>
        <TeamRow
          name={m.teamAName}
          logoUrl={m.teamALogoUrl}
          iconName={m.teamAIconName}
          iconColor={m.teamAIconColor}
          score={scoreText(m.scoreA, m.wicketsA)}
          overs={m.oversA}
          batting={aBatting}
          muted={(live && !aBatting) || (finished && !aWon)}
          showScore={!upcoming && m.inningsStarted.a}
        />
        <TeamRow
          name={m.teamBName}
          logoUrl={m.teamBLogoUrl}
          iconName={m.teamBIconName}
          iconColor={m.teamBIconColor}
          score={scoreText(m.scoreB, m.wicketsB)}
          overs={m.oversB}
          batting={bBatting}
          muted={(live && !bBatting) || (finished && !bWon)}
          showScore={!upcoming && m.inningsStarted.b}
        />
      </View>

      {/* status line */}
      <View style={c.cardBottom}>
        <Text style={upcoming ? c.statusNeutral : c.statusAmber} numberOfLines={2}>
          {statusLine(m)}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

// ── Section heading ──────────────────────────────────────────────────────────
function SectionHeader({ title, count, barColor }: { title: string; count: number; barColor: string }) {
  return (
    <View style={c.sectionHeader}>
      <View style={[c.sectionBar, { backgroundColor: barColor }]} />
      <Text style={c.sectionTitle}>{title}</Text>
      <Text style={c.sectionCount}>
        {count} {count === 1 ? "match" : "matches"}
      </Text>
    </View>
  );
}

// ── Search overlay ───────────────────────────────────────────────────────────
function SearchOverlay({
  visible, onClose, all, router, myUid,
}: {
  visible: boolean;
  onClose: () => void;
  all: Match[];
  router: ReturnType<typeof useRouter>;
  myUid: string | null;
}) {
  const [q, setQ] = useState("");
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (visible) {
      setQ("");
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [visible]);

  const results = useMemo(() => {
    const t = q.toLowerCase().trim();
    if (!t) return [];
    return all.filter(
      (m) =>
        m.teamAName.toLowerCase().includes(t) ||
        m.teamBName.toLowerCase().includes(t) ||
        m.leagueName.toLowerCase().includes(t) ||
        m.sport.toLowerCase().includes(t)
    );
  }, [q, all]);

  if (!visible) return null;

  return (
    <View style={so.wrap}>
      <View style={so.header}>
        <TouchableOpacity onPress={onClose} style={so.back} hitSlop={8}>
          <Ionicons name="arrow-back" size={20} color={INK} />
        </TouchableOpacity>
        <View style={so.input}>
          <Ionicons name="search-outline" size={17} color={MUTED} />
          <TextInput
            ref={inputRef}
            value={q}
            onChangeText={setQ}
            placeholder="Search teams, players"
            placeholderTextColor={MUTED}
            style={so.field}
            returnKeyType="search"
          />
          {!!q && (
            <TouchableOpacity onPress={() => setQ("")} hitSlop={8}>
              <Ionicons name="close-circle" size={17} color={MUTED} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, paddingTop: 12 }}>
        {!q.trim() && <Text style={so.hint}>Search by team, league or sport</Text>}
        {!!q.trim() && results.length === 0 && <Text style={so.hint}>No matches found</Text>}
        {results.map((m) => (
          <MatchCard key={m.id} m={m} onPress={() => { onClose(); router.push(matchDestination(m, myUid) as any); }} />
        ))}
      </ScrollView>
    </View>
  );
}

// =============================================================================
// SCREEN
// =============================================================================
export default function LeagueHome() {
  const router = useRouter();
  const myUid = auth.currentUser?.uid || null;

  const [live, setLive]         = useState<Match[]>([]);
  const [upcoming, setUpcoming] = useState<Match[]>([]);
  const [finished, setFinished] = useState<Match[]>([]);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [unread] = useState(0); // wire to your notifications collection

  const loadAll = useCallback(async () => {
    try {
      const col = collection(db, "leagueMatches");
      const [liveSnap, upSnap, finSnap] = await Promise.all([
        getDocs(query(col, where("status", "==", "live"), limit(20))),
        getDocs(query(col, where("status", "==", "scheduled"), limit(20))),
        getDocs(query(col, where("status", "in", ["finished", "completed"]), limit(20))),
      ]);
      setLive(liveSnap.docs.map(toMatch));
      setUpcoming(upSnap.docs.map(toMatch));
      setFinished(finSnap.docs.map(toMatch));
    } catch (e) {
      console.error("LeagueHome loadAll:", e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { setLoading(true); loadAll(); }, [loadAll]));
  const onRefresh = () => { setRefreshing(true); loadAll(); };

  const open = (m: Match) => router.push(matchDestination(m, myUid) as any);

  if (loading) {
    return (
      <SafeAreaView style={s.root}>
        <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />
        <View style={s.center}><ActivityIndicator color={INK} size="large" /></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.root}>
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />

      <SearchOverlay
        visible={searchOpen}
        onClose={() => setSearchOpen(false)}
        all={[...live, ...upcoming, ...finished]}
        router={router}
        myUid={myUid}
      />

      {/* ── HEADER ─────────────────────────────────────────────────────── */}
      <View style={s.header}>
        <View style={s.logoWrap}>
          <Image
            source={require("../../assets/images/playon-icon-v15.png")}
            style={s.logoMark}
          />
          <Text style={s.wordmark}>
            <Text style={{ color: INK }}>Play</Text>
            <Text style={{ color: RED }}>On</Text>
          </Text>
        </View>

        <TouchableOpacity style={s.searchBar} activeOpacity={0.8} onPress={() => setSearchOpen(true)}>
          <Ionicons name="search-outline" size={17} color="#5F5951" />
          <Text style={s.searchTxt} numberOfLines={1}>Search teams, players</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={s.bellBtn}
          onPress={() => router.push("/notification/user-notification")}
        >
          <Ionicons name="notifications-outline" size={19} color={INK} />
          {unread > 0 && (
            <View style={s.bellBadge}>
              <Text style={s.bellBadgeTxt}>{unread > 9 ? "9+" : unread}</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      {/* ── CONTENT ────────────────────────────────────────────────────── */}
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 28 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={MUTED} />}
      >
        <SectionHeader title="Live" count={live.length} barColor={RED} />
        <View style={s.list}>
          {live.length === 0
            ? <Text style={s.empty}>No live matches right now</Text>
            : live.map((m) => <MatchCard key={m.id} m={m} onPress={() => open(m)} />)}
        </View>

        <SectionHeader title="Upcoming" count={upcoming.length} barColor={TAN} />
        <View style={s.list}>
          {upcoming.length === 0
            ? <Text style={s.empty}>Nothing scheduled yet</Text>
            : upcoming.map((m) => <MatchCard key={m.id} m={m} onPress={() => open(m)} />)}
        </View>

        <SectionHeader title="Finished" count={finished.length} barColor={GREY_BAR} />
        <View style={s.list}>
          {finished.length === 0
            ? <Text style={s.empty}>No results yet</Text>
            : finished.map((m) => <MatchCard key={m.id} m={m} onPress={() => open(m)} />)}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Screen styles ────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root:   { flex: 1, backgroundColor: PAGE_BG },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },

  header: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingHorizontal: 16,
    paddingTop: Platform.OS === "android" ? (StatusBar.currentHeight ?? 0) + 12 : 10,
    paddingBottom: 14,
    backgroundColor: CARD,
    borderBottomWidth: 1, borderBottomColor: LINE,
  },
  logoWrap: { flexDirection: "row", alignItems: "center", gap: 9, flexShrink: 0 },
  logoMark: { width: 60, height: 60 },
  wordmark: { fontSize: 20, fontWeight: "900", letterSpacing: -0.7 },

  searchBar: {
    flex: 1, minWidth: 0,
    flexDirection: "row", alignItems: "center", gap: 8,
    height: 38, borderRadius: 19,
    borderWidth: 1, borderColor: "#E5DFD6", backgroundColor: FILL_SOFT,
    paddingHorizontal: 14,
  },
  searchTxt: { flex: 1, fontSize: 13, fontWeight: "500", color: MUTED },

  bellBtn: {
    width: 38, height: 38, borderRadius: 19,
    borderWidth: 1, borderColor: "#E5DFD6", backgroundColor: CARD,
    alignItems: "center", justifyContent: "center", flexShrink: 0,
  },
  bellBadge: {
    position: "absolute", top: -3, right: -3,
    minWidth: 18, height: 18, borderRadius: 9,
    backgroundColor: RED, borderWidth: 2, borderColor: CARD,
    alignItems: "center", justifyContent: "center", paddingHorizontal: 4,
  },
  bellBadgeTxt: { fontSize: 9.5, fontWeight: "800", color: "#FFFFFF" },

  list:  { paddingHorizontal: 16, gap: 12 },
  empty: { fontSize: 13, color: MUTED, paddingVertical: 10 },
});

// ── Section + card styles ────────────────────────────────────────────────────
const c = StyleSheet.create({
  sectionHeader: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: 16, paddingTop: 20, paddingBottom: 12,
  },
  sectionBar:   { width: 3, height: 15, borderRadius: 2 },
  sectionTitle: { fontSize: 16, fontWeight: "800", color: INK, letterSpacing: -0.3 },
  sectionCount: { fontSize: 12, fontWeight: "600", color: MUTED },

  card: {
    backgroundColor: CARD, borderRadius: 16,
    paddingHorizontal: 14, paddingTop: 14, paddingBottom: 15,
    shadowColor: "#3E3222", shadowOpacity: 0.07, shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 }, elevation: 2,
  },
  cardTop:     { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  cardTopText: { flex: 1, minWidth: 0 },
  leagueName:  { fontSize: 12.5, fontWeight: "700", color: STRONG },
  metaLine:    { fontSize: 11, fontWeight: "500", color: MUTED, marginTop: 2 },

  liveBadge: {
    flexDirection: "row", alignItems: "center", gap: 5,
    backgroundColor: RED, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 7,
  },
  liveDot:      { width: 6, height: 6, borderRadius: 3, backgroundColor: "#FFFFFF" },
  liveBadgeTxt: { fontSize: 10, fontWeight: "800", color: "#FFFFFF", letterSpacing: 0.6 },

  todayBadge: {
    borderWidth: 1, borderColor: TAN_LINE, backgroundColor: TAN_SOFT,
    paddingHorizontal: 9, paddingVertical: 4, borderRadius: 7,
  },
  todayBadgeTxt: { fontSize: 10, fontWeight: "800", color: AMBER, letterSpacing: 0.6 },
  dateBadge:     { backgroundColor: FILL, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 7 },
  dateBadgeTxt:  { fontSize: 10, fontWeight: "800", color: SECONDARY, letterSpacing: 0.6 },
  doneBadge:     { backgroundColor: FILL, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 7 },
  doneBadgeTxt:  { fontSize: 10, fontWeight: "800", color: MUTED, letterSpacing: 0.6 },

  teams: { marginTop: 14, gap: 11 },

  teamRow:  { flexDirection: "row", alignItems: "center", gap: 10 },
  teamName: { flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: "700", color: STRONG },
  teamNameBatting: { fontWeight: "800", color: INK },
  teamNameMuted:   { fontWeight: "600", color: MUTED },

  batIcon:   { width: 14 },
  batSpacer: { width: 14 },

  score:        { fontSize: 18, fontWeight: "800", color: INK, letterSpacing: -0.4 },
  scoreBatting: { fontSize: 21, fontWeight: "900", letterSpacing: -0.6 },
  scoreMuted:   { color: MUTED },
  overs:        { width: 28, textAlign: "right", fontSize: 11, fontWeight: "600", color: SECONDARY },
  oversMuted:   { color: MUTED },
  yetToBat:     { fontSize: 12.5, fontWeight: "600", color: MUTED },

  cardBottom: { marginTop: 13, paddingTop: 11, borderTopWidth: 1, borderTopColor: DIVIDER },
  statusAmber:   { fontSize: 12.5, fontWeight: "700", color: AMBER, lineHeight: 18 },
  statusNeutral: { fontSize: 12.5, fontWeight: "600", color: SECONDARY, lineHeight: 18 },
});

// ── Search overlay styles ────────────────────────────────────────────────────
const so = StyleSheet.create({
  wrap: {
    position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: PAGE_BG, zIndex: 100,
  },
  header: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingHorizontal: 16,
    paddingTop: Platform.OS === "android" ? (StatusBar.currentHeight ?? 0) + 12 : 10,
    paddingBottom: 14,
    backgroundColor: CARD,
    borderBottomWidth: 1, borderBottomColor: LINE,
  },
  back: {
    width: 38, height: 38, borderRadius: 19, backgroundColor: FILL_SOFT,
    alignItems: "center", justifyContent: "center",
  },
  input: {
    flex: 1, flexDirection: "row", alignItems: "center", gap: 8,
    height: 38, borderRadius: 19,
    borderWidth: 1, borderColor: "#E5DFD6", backgroundColor: FILL_SOFT,
    paddingHorizontal: 14,
  },
  field: { flex: 1, fontSize: 13, fontWeight: "500", color: INK, padding: 0 },
  hint:  { fontSize: 13, color: MUTED, textAlign: "center", paddingVertical: 40 },
});
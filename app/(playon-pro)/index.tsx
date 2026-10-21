import React, {
  useState,
  useCallback,
  useRef,
  useEffect,
  useMemo,
} from "react";
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
  Dimensions,
  Animated,
  TextInput,
} from "react-native";
import { db, auth } from "../../firebaseConfig";
import {
  collection,
  query,
  where,
  getDocs,
  limit,
} from "firebase/firestore";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import TeamAvatar from "../../components/Teamavatar";

import AdBanner from "../../components/match-tools/ViewerBadge";
import HelpGuideSheet from "../../components/match-tools/HelperGuide";
import { inviteFriend } from "../../components/match-tools/Shareinvite";

// =============================================================================
// 🏆 PLAYON — LEAGUES HOME
// Hero live carousel + Upcoming strip + Finished list, matching the app's
// green identity. Team crests use TeamAvatar (icon badge or colored initials)
// instead of mascot images — no image hosting needed anywhere.
//
// PATCH: every card now knows whether the signed-in user organizes that
// match (m.organizerId === current uid). Cards you host route into the real
// management screens (league-manage / manage-match) instead of always
// dropping everyone into the read-only spectator viewer.
// =============================================================================

const { width: SW } = Dimensions.get("window");

const GREEN   = "#16A34A";
const GREEN_D = "#15803D";
const RED     = "#E11D2A";
const DARK    = "#0B1220";
const PAGE_BG = "#F0F1F5";
const GRAY    = "#9AA3B2";

// ── Types ─────────────────────────────────────────────────────────────────────
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

type MatchWithType = Match & { _type: "live" | "upcoming" | "finished" };

function initials(n: string) {
  return (n || "?").trim().split(/\s+/).map(w => w[0]).join("").toUpperCase().slice(0, 2);
}

// Where a card should go when tapped: the organizer gets the real
// management screen; everyone else gets the read-only spectator viewer.
function matchDestination(m: Match, myUid: string | null): string {
  const isMine = !!myUid && !!m.organizerId && m.organizerId === myUid;
  if (!isMine) return `/(playon-pro)/match/${m.id}`;
  return m.leagueId
    ? `/(playon-pro)/league-manage?id=${m.leagueId}`
    : `/(playon-pro)/manage-match?id=${m.id}`;
}

// ── PulseDot ──────────────────────────────────────────────────────────────────
function PulseDot({ color = RED, size = 8 }: { color?: string; size?: number }) {
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.15, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1,    duration: 700, useNativeDriver: true }),
      ])
    ).start();
  }, []);
  return (
    <Animated.View
      style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color, opacity }}
    />
  );
}

// ── SearchOverlay ─────────────────────────────────────────────────────────────
function SearchOverlay({
  visible,
  onClose,
  liveMatches,
  upcomingMatches,
  finishedMatches,
  router,
  myUid,
}: {
  visible: boolean;
  onClose: () => void;
  liveMatches: Match[];
  upcomingMatches: Match[];
  finishedMatches: Match[];
  router: ReturnType<typeof useRouter>;
  myUid: string | null;
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (visible) {
      setSearchQuery("");
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [visible]);

  const results: MatchWithType[] = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return [];
    const all: MatchWithType[] = [
      ...liveMatches.map(m     => ({ ...m, _type: "live"     as const })),
      ...upcomingMatches.map(m => ({ ...m, _type: "upcoming" as const })),
      ...finishedMatches.map(m => ({ ...m, _type: "finished" as const })),
    ];
    return all.filter(m =>
      m.teamAName.toLowerCase().includes(q) ||
      m.teamBName.toLowerCase().includes(q) ||
      m.leagueName.toLowerCase().includes(q) ||
      m.sport.toLowerCase().includes(q)
    );
  }, [searchQuery, liveMatches, upcomingMatches, finishedMatches]);

  if (!visible) return null;

  const badgeFor = (type: MatchWithType["_type"]) => {
    if (type === "live")     return { label: "LIVE",     bg: "#FEF2F2", color: RED };
    if (type === "upcoming") return { label: "UPCOMING", bg: "#DCFCE7", color: GREEN };
    return                          { label: "FINISHED", bg: "#F3F4F6", color: GRAY };
  };

  return (
    <View style={so.container}>
      <View style={so.header}>
        <TouchableOpacity onPress={onClose} style={so.backBtn} hitSlop={8}>
          <Ionicons name="arrow-back" size={20} color={DARK} />
        </TouchableOpacity>
        <View style={so.inputWrap}>
          <Ionicons name="search-outline" size={16} color={GRAY} />
          <TextInput
            ref={inputRef}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Teams, leagues, sports..."
            placeholderTextColor={GRAY}
            style={so.input}
            returnKeyType="search"
          />
          {!!searchQuery && (
            <TouchableOpacity onPress={() => setSearchQuery("")} hitSlop={8}>
              <Ionicons name="close-circle" size={17} color={GRAY} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {!searchQuery.trim() && (
          <View style={so.emptyState}>
            <View style={so.emptyIcon}><Ionicons name="search-outline" size={24} color={GRAY} /></View>
            <Text style={so.emptyTitle}>Search matches</Text>
            <Text style={so.emptySub}>Search by team, league or sport{"\n"}across Live, Upcoming & Finished</Text>
          </View>
        )}

        {searchQuery.trim() !== "" && results.length === 0 && (
          <View style={so.emptyState}>
            <View style={[so.emptyIcon, { backgroundColor: "#FEF2F2" }]}><Ionicons name="search-outline" size={24} color={RED} /></View>
            <Text style={so.emptyTitle}>No results found</Text>
            <Text style={so.emptySub}>Try a different team, league or sport</Text>
          </View>
        )}

        {results.length > 0 && (
          <Text style={so.countLabel}>{results.length} {results.length === 1 ? "match" : "matches"}</Text>
        )}

        {results.map(m => {
          const b = badgeFor(m._type);
          const info = m._type === "upcoming" ? `${m.date}  ${m.startTime}` : `${m.scoreA} – ${m.scoreB}`;
          return (
            <TouchableOpacity
              key={m.id + m._type}
              style={so.card}
              activeOpacity={0.75}
              onPress={() => { onClose(); router.push(matchDestination(m, myUid) as any); }}
            >
              <TeamAvatar name={m.teamAName} iconName={m.teamAIconName} iconColor={m.teamAIconColor} size={44} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={so.cardLeague} numberOfLines={1}>{m.leagueName || m.sport}</Text>
                <Text style={so.cardTeams} numberOfLines={1}>
                  {m.teamAName} <Text style={{ color: GRAY, fontWeight: "500" }}>vs</Text> {m.teamBName}
                </Text>
              </View>
              <View style={{ alignItems: "flex-end", gap: 5, flexShrink: 0 }}>
                <View style={[so.badge, { backgroundColor: b.bg }]}><Text style={[so.badgeTxt, { color: b.color }]}>{b.label}</Text></View>
                <Text style={so.cardInfo}>{info}</Text>
              </View>
            </TouchableOpacity>
          );
        })}
        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

const so = StyleSheet.create({
  container: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "#fff", zIndex: 100 },
  header: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingTop: Platform.OS === "android" ? (StatusBar.currentHeight ?? 0) + 12 : 54,
    paddingHorizontal: 16, paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: "#F3F4F6",
  },
  backBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: "#F5F6F8", alignItems: "center", justifyContent: "center", flexShrink: 0 },
  inputWrap: { flex: 1, flexDirection: "row", alignItems: "center", gap: 9, backgroundColor: "#F5F6F8", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10 },
  input: { flex: 1, fontSize: 14, fontWeight: "500", color: DARK, padding: 0 },
  emptyState: { alignItems: "center", gap: 10, paddingVertical: 52, paddingHorizontal: 24 },
  emptyIcon: { width: 54, height: 54, borderRadius: 27, backgroundColor: "#F5F6F8", alignItems: "center", justifyContent: "center" },
  emptyTitle: { fontSize: 15, fontWeight: "700", color: "#6B7280" },
  emptySub: { fontSize: 13, color: GRAY, textAlign: "center", lineHeight: 20 },
  countLabel: { fontSize: 11, fontWeight: "700", color: GRAY, textTransform: "uppercase", letterSpacing: 0.5, marginHorizontal: 16, marginTop: 14, marginBottom: 8 },
  card: { flexDirection: "row", alignItems: "center", gap: 12, marginHorizontal: 14, marginBottom: 10, backgroundColor: "#F8F9FB", borderRadius: 14, padding: 13 },
  cardLeague: { fontSize: 10, fontWeight: "700", color: GRAY, textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 3 },
  cardTeams: { fontSize: 13.5, fontWeight: "700", color: DARK },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  badgeTxt: { fontSize: 9, fontWeight: "800", letterSpacing: 0.5 },
  cardInfo: { fontSize: 12, fontWeight: "700", color: "#374151" },
});

// ── LiveHeroCard ──────────────────────────────────────────────────────────────
function LiveHeroCard({ match: m, router, myUid }: { match: Match; router: ReturnType<typeof useRouter>; myUid: string | null }) {
  const isMine = !!myUid && !!m.organizerId && m.organizerId === myUid;

  return (
    <View style={hero.card}>
      {/* Top row */}
      <View style={hero.topRow}>
        <View style={hero.liveBadge}>
          <PulseDot color="#fff" size={6} />
          <Text style={hero.liveBadgeTxt}>LIVE</Text>
        </View>
        <View style={hero.leaguePill}>
          <Ionicons name="trophy" size={11} color={GREEN_D} />
          <Text style={hero.leaguePillTxt} numberOfLines={1}>{m.leagueName || m.sport}</Text>
        </View>
        {isMine ? (
          <View style={hero.hostingPill}>
            <Ionicons name="person" size={10} color="#D97706" />
            <Text style={hero.hostingPillTxt}>HOSTING</Text>
          </View>
        ) : (
          <Text style={hero.sportTxt}>{m.sport}</Text>
        )}
      </View>

      {/* Score */}
      <View style={hero.scoreRow}>
        <View style={hero.teamBlock}>
          <TeamAvatar name={m.teamAName} iconName={m.teamAIconName} iconColor={m.teamAIconColor} size={56} />
          <Text style={hero.teamName} numberOfLines={1}>{m.teamAName}</Text>
          <Text style={hero.score}>{m.scoreA}</Text>
        </View>

        <View style={hero.vsBlock}>
          <Text style={hero.vsTxt}>VS</Text>
        </View>

        <View style={hero.teamBlock}>
          <TeamAvatar name={m.teamBName} iconName={m.teamBIconName} iconColor={m.teamBIconColor} size={56} />
          <Text style={hero.teamName} numberOfLines={1}>{m.teamBName}</Text>
          <Text style={hero.score}>{m.scoreB}</Text>
        </View>
      </View>

      {/* Live summary banner */}
      {!!m.liveSummary && (
        <View style={hero.summaryBanner}>
          <Text style={hero.summaryTxt} numberOfLines={2}>{m.liveSummary}</Text>
        </View>
      )}

      {/* Actions */}
      <View style={hero.actionsRow}>
        {isMine ? (
          <TouchableOpacity
            style={hero.primaryBtn}
            activeOpacity={0.85}
            onPress={() => router.push(matchDestination(m, myUid) as any)}
          >
            <Ionicons name="stats-chart" size={15} color="#fff" />
            <Text style={hero.primaryBtnTxt}>{m.leagueId ? "Manage League" : "Update Score"}</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={hero.primaryBtn}
            activeOpacity={0.85}
            onPress={() => router.push(`/(playon-pro)/match/${m.id}` as any)}
          >
            <Ionicons name="stats-chart" size={15} color="#fff" />
            <Text style={hero.primaryBtnTxt}>Scorecard</Text>
          </TouchableOpacity>
        )}

        {!isMine && !!m.leagueId && (
          <TouchableOpacity
            style={hero.secondaryBtn}
            activeOpacity={0.85}
            onPress={() => router.push(`/(playon-pro)/league-card/${m.leagueId}` as any)}
          >
            <Ionicons name="list-outline" size={15} color={GREEN_D} />
            <Text style={hero.secondaryBtnTxt}>League</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const hero = StyleSheet.create({
  card: {
    width: SW - 32,
    backgroundColor: "#fff",
    borderRadius: 20,
    padding: 16,
    shadowColor: DARK, shadowOpacity: 0.08, shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 }, elevation: 4,
  },
  topRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 16 },
  liveBadge: {
    flexDirection: "row", alignItems: "center", gap: 5,
    backgroundColor: RED, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 8,
  },
  liveBadgeTxt: { fontSize: 10, fontWeight: "800", color: "#fff", letterSpacing: 0.5 },
  leaguePill: {
    flex: 1, flexDirection: "row", alignItems: "center", gap: 5,
    backgroundColor: "#F0FDF4", paddingHorizontal: 9, paddingVertical: 4, borderRadius: 8,
  },
  leaguePillTxt: { fontSize: 11, fontWeight: "700", color: GREEN_D, flexShrink: 1 },
  sportTxt: { fontSize: 10.5, fontWeight: "700", color: GRAY, textTransform: "uppercase" },
  hostingPill: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: "#FEF3C7", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8,
  },
  hostingPillTxt: { fontSize: 9, fontWeight: "800", color: "#D97706", letterSpacing: 0.3 },

  scoreRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" },
  teamBlock: { flex: 1, alignItems: "center", gap: 8 },
  teamName: { fontSize: 13, fontWeight: "700", color: DARK, textAlign: "center" },
  score: { fontSize: 24, fontWeight: "900", color: DARK, letterSpacing: -0.5 },
  vsBlock: { paddingHorizontal: 6, paddingTop: 20 },
  vsTxt: { fontSize: 12, fontWeight: "800", color: GRAY, letterSpacing: 1 },

  summaryBanner: {
    backgroundColor: "#F5F6F8", borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 9,
    marginTop: 14,
  },
  summaryTxt: { fontSize: 12.5, fontWeight: "600", color: "#374151", textAlign: "center" },

  actionsRow: { flexDirection: "row", gap: 10, marginTop: 14 },
  primaryBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    backgroundColor: GREEN, borderRadius: 12, paddingVertical: 12,
  },
  primaryBtnTxt: { fontSize: 13.5, fontWeight: "800", color: "#fff" },
  secondaryBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    backgroundColor: "#F0FDF4", borderRadius: 12, paddingVertical: 12,
    borderWidth: 1, borderColor: "#BBF7D0",
  },
  secondaryBtnTxt: { fontSize: 13.5, fontWeight: "800", color: GREEN_D },
});

// ── UpcomingMiniCard ──────────────────────────────────────────────────────────
function UpcomingMiniCard({ match: m, router, myUid }: { match: Match; router: ReturnType<typeof useRouter>; myUid: string | null }) {
  const isMine = !!myUid && !!m.organizerId && m.organizerId === myUid;

  return (
    <TouchableOpacity
      style={um.card}
      activeOpacity={0.85}
      onPress={() => router.push(matchDestination(m, myUid) as any)}
    >
      <View style={um.dateRow}>
        <Ionicons name="calendar-outline" size={12} color={GRAY} />
        <Text style={um.dateTxt} numberOfLines={1}>{m.date} · {m.startTime}</Text>
        {isMine && (
          <View style={um.hostingDot}>
            <Ionicons name="person" size={8} color="#D97706" />
          </View>
        )}
      </View>

      <View style={um.teamRow}>
        <TeamAvatar name={m.teamAName} iconName={m.teamAIconName} iconColor={m.teamAIconColor} size={34} />
        <Text style={um.vsTxt}>vs</Text>
        <TeamAvatar name={m.teamBName} iconName={m.teamBIconName} iconColor={m.teamBIconColor} size={34} />
      </View>

      <Text style={um.teamsTxt} numberOfLines={1}>{m.teamAName} vs {m.teamBName}</Text>

      {!!m.venue && (
        <View style={um.venueRow}>
          <Ionicons name="location-outline" size={11} color={GRAY} />
          <Text style={um.venueTxt} numberOfLines={1}>{m.venue}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const um = StyleSheet.create({
  card: {
    width: 168,
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 13,
    shadowColor: DARK, shadowOpacity: 0.05, shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 }, elevation: 2,
  },
  dateRow: { flexDirection: "row", alignItems: "center", gap: 5, marginBottom: 10 },
  dateTxt: { fontSize: 10.5, fontWeight: "700", color: GRAY, flexShrink: 1 },
  hostingDot: {
    width: 16, height: 16, borderRadius: 8, backgroundColor: "#FEF3C7",
    alignItems: "center", justifyContent: "center", marginLeft: "auto",
  },
  teamRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, marginBottom: 8 },
  vsTxt: { fontSize: 10, fontWeight: "800", color: GRAY },
  teamsTxt: { fontSize: 12, fontWeight: "700", color: DARK, textAlign: "center", marginBottom: 6 },
  venueRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4 },
  venueTxt: { fontSize: 10, color: GRAY, fontWeight: "600", flexShrink: 1 },
});

// ── FinishedRow ───────────────────────────────────────────────────────────────
function FinishedRow({ match: m, router, myUid }: { match: Match; router: ReturnType<typeof useRouter>; myUid: string | null }) {
  const winA = m.scoreA > m.scoreB;
  const winB = m.scoreB > m.scoreA;
  const resultTxt = winA ? `${m.teamAName} won` : winB ? `${m.teamBName} won` : "Draw";
  const isMine = !!myUid && !!m.organizerId && m.organizerId === myUid;

  return (
    <TouchableOpacity
      style={fr.card}
      activeOpacity={0.85}
      onPress={() => router.push(matchDestination(m, myUid) as any)}
    >
      <View style={fr.topRow}>
        <Ionicons name="calendar-outline" size={11} color={GRAY} />
        <Text style={fr.dateTxt} numberOfLines={1}>{m.date} · {m.leagueName || m.sport}</Text>
        {isMine && (
          <View style={fr.hostingPill}>
            <Text style={fr.hostingPillTxt}>HOSTED</Text>
          </View>
        )}
      </View>

      <View style={fr.row}>
        <View style={fr.side}>
          <TeamAvatar name={m.teamAName} iconName={m.teamAIconName} iconColor={m.teamAIconColor} size={40} />
          <Text style={[fr.teamName, { color: winA ? DARK : GRAY }]} numberOfLines={1}>{m.teamAName}</Text>
          <Text style={[fr.score, { color: winA ? DARK : GRAY }]}>{m.scoreA}</Text>
        </View>

        <View style={fr.middle}>
          <View style={fr.completedPill}>
            <Text style={fr.completedTxt}>COMPLETED</Text>
          </View>
          <Text style={fr.resultTxt} numberOfLines={1}>{resultTxt}</Text>
        </View>

        <View style={fr.side}>
          <TeamAvatar name={m.teamBName} iconName={m.teamBIconName} iconColor={m.teamBIconColor} size={40} />
          <Text style={[fr.teamName, { color: winB ? DARK : GRAY }]} numberOfLines={1}>{m.teamBName}</Text>
          <Text style={[fr.score, { color: winB ? DARK : GRAY }]}>{m.scoreB}</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

const fr = StyleSheet.create({
  card: {
    backgroundColor: "#fff", borderRadius: 16,
    padding: 14, marginHorizontal: 16, marginBottom: 10,
    shadowColor: DARK, shadowOpacity: 0.04, shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 }, elevation: 1,
  },
  topRow: { flexDirection: "row", alignItems: "center", gap: 5, marginBottom: 12 },
  dateTxt: { fontSize: 10.5, fontWeight: "700", color: GRAY, flexShrink: 1 },
  hostingPill: {
    marginLeft: "auto", backgroundColor: "#FEF3C7",
    paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6,
  },
  hostingPillTxt: { fontSize: 8.5, fontWeight: "800", color: "#D97706", letterSpacing: 0.3 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  side: { flex: 1, alignItems: "center", gap: 6 },
  teamName: { fontSize: 11.5, fontWeight: "700", textAlign: "center" },
  score: { fontSize: 20, fontWeight: "900" },
  middle: { alignItems: "center", gap: 6, paddingHorizontal: 8, flexShrink: 0 },
  completedPill: { backgroundColor: "#F0FDF4", paddingHorizontal: 9, paddingVertical: 3, borderRadius: 20 },
  completedTxt: { fontSize: 8.5, fontWeight: "800", color: GREEN_D, letterSpacing: 0.5 },
  resultTxt: { fontSize: 10.5, fontWeight: "700", color: "#374151", maxWidth: 100, textAlign: "center" },
});

// ── EmptySection ──────────────────────────────────────────────────────────────
function EmptySection({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) {
  return (
    <View style={{ alignItems: "center", gap: 10, paddingVertical: 28, marginHorizontal: 16 }}>
      <View style={{ width: 46, height: 46, borderRadius: 23, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" }}>
        <Ionicons name={icon} size={20} color={GRAY} />
      </View>
      <Text style={{ fontSize: 13, fontWeight: "600", color: GRAY }}>{text}</Text>
    </View>
  );
}

// ── HostFab ───────────────────────────────────────────────────────────────────
function HostFab({ router }: { router: ReturnType<typeof useRouter> }) {
  const [open, setOpen] = useState(false);
  const anim = useRef(new Animated.Value(0)).current;

  const toggle = () => {
    const next = !open;
    setOpen(next);
    Animated.spring(anim, { toValue: next ? 1 : 0, useNativeDriver: true, tension: 260, friction: 20 }).start();
  };
  const close = () => {
    setOpen(false);
    Animated.spring(anim, { toValue: 0, useNativeDriver: true, tension: 260, friction: 20 }).start();
  };
  const goTo = (path: string) => { close(); router.push(path as any); };

  const menuStyle = {
    opacity: anim,
    transform: [
      { scale: anim.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) },
      { translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) },
    ],
  };
  const rotate = anim.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "45deg"] });

  return (
    <>
      {open && <TouchableOpacity style={fab.backdrop} activeOpacity={1} onPress={close} />}
      <View style={fab.wrap} pointerEvents="box-none">
        <Animated.View style={[fab.menu, menuStyle]} pointerEvents={open ? "auto" : "none"}>
          <TouchableOpacity style={fab.menuItem} activeOpacity={0.85} onPress={() => goTo("/(playon-pro)/create-league")}>
            <View style={[fab.menuIcon, { backgroundColor: "#DCFCE7" }]}><Ionicons name="trophy" size={17} color={GREEN} /></View>
            <View style={{ flex: 1 }}>
              <Text style={fab.menuTitle}>Host a League</Text>
              <Text style={fab.menuSub}>Full tournament, your rules</Text>
            </View>
          </TouchableOpacity>
          <View style={fab.menuDivider} />
          <TouchableOpacity style={fab.menuItem} activeOpacity={0.85} onPress={() => goTo("/(playon-pro)/host-match")}>
            <View style={[fab.menuIcon, { backgroundColor: "#FEF3C7" }]}><Ionicons name="flash" size={17} color="#D97706" /></View>
            <View style={{ flex: 1 }}>
              <Text style={fab.menuTitle}>Host a Quick Match</Text>
              <Text style={fab.menuSub}>No league — just two teams</Text>
            </View>
          </TouchableOpacity>
        </Animated.View>

        <TouchableOpacity style={fab.button} activeOpacity={0.9} onPress={toggle}>
          <Animated.View style={{ transform: [{ rotate }] }}>
            <Ionicons name="add" size={28} color="#fff" />
          </Animated.View>
        </TouchableOpacity>
      </View>
    </>
  );
}

const fab = StyleSheet.create({
  backdrop: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 40 },
  wrap: { position: "absolute", right: 18, bottom: 22, alignItems: "flex-end", zIndex: 50 },
  button: {
    width: 58, height: 58, borderRadius: 29, backgroundColor: GREEN,
    alignItems: "center", justifyContent: "center",
    shadowColor: GREEN, shadowOpacity: 0.35, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 6,
  },
  menu: {
    marginBottom: 12, width: 220, backgroundColor: "#fff", borderRadius: 16, paddingVertical: 6,
    shadowColor: DARK, shadowOpacity: 0.15, shadowRadius: 20, shadowOffset: { width: 0, height: 8 }, elevation: 8,
  },
  menuItem: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 11 },
  menuIcon: { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  menuTitle: { fontSize: 13.5, fontWeight: "700", color: DARK },
  menuSub: { fontSize: 11, color: GRAY, marginTop: 1 },
  menuDivider: { height: 1, backgroundColor: "#F3F4F6", marginHorizontal: 12 },
});

// =============================================================================
// MAIN SCREEN
// =============================================================================
export default function LeagueHome() {
  const router = useRouter();
  const myUid = auth.currentUser?.uid || null;

  const [liveMatches,     setLiveMatches]     = useState<Match[]>([]);
  const [upcomingMatches, setUpcomingMatches] = useState<Match[]>([]);
  const [finishedMatches, setFinishedMatches] = useState<Match[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchActive, setSearchActive] = useState(false);

  const [helpOpen, setHelpOpen] = useState(false);

  // Active quick-jump tab (visual only — taps scroll to the section)
  const [activeTab, setActiveTab] = useState<0 | 1 | 2>(0);

  const scrollRef = useRef<ScrollView>(null);
  const sectionY = useRef({ live: 0, upcoming: 0, finished: 0 });

  const loadAll = useCallback(async () => {
    try {
      const toMatch = (d: any): Match => {
        const m = d.data();
        return {
          id: d.id,
          leagueId: m.leagueId ?? null,
          leagueName: m.leagueName || "",
          teamAName: m.teamAName || "Team A",
          teamBName: m.teamBName || "Team B",
          teamAIconName: m.teamAIconName ?? null,
          teamAIconColor: m.teamAIconColor ?? null,
          teamBIconName: m.teamBIconName ?? null,
          teamBIconColor: m.teamBIconColor ?? null,
          sport: m.sport || "",
          scoreA: Number(m.scoreA ?? 0),
          scoreB: Number(m.scoreB ?? 0),
          date: m.date || "",
          startTime: m.startTime || "",
          venue: m.venue || "",
          status: m.status || "",
          liveSummary: m.liveSummary || "",
          organizerId: m.organizerId ?? null,
        };
      };

      const [liveSnap, upSnap, finSnap] = await Promise.all([
        getDocs(query(collection(db, "leagueMatches"), where("status", "==", "live"),      limit(10))),
        getDocs(query(collection(db, "leagueMatches"), where("status", "==", "scheduled"), limit(10))),
        getDocs(query(collection(db, "leagueMatches"), where("status", "in", ["finished", "completed"]), limit(10))),
      ]);

      setLiveMatches(liveSnap.docs.map(toMatch));
      setUpcomingMatches(upSnap.docs.map(toMatch));
      setFinishedMatches(finSnap.docs.map(toMatch));
    } catch (e) {
      console.error("LeagueHome loadAll:", e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { setLoading(true); loadAll(); }, [loadAll]));
  const onRefresh = () => { setRefreshing(true); loadAll(); };

  const jumpTo = (tab: 0 | 1 | 2) => {
    setActiveTab(tab);
    const y = tab === 0 ? sectionY.current.live : tab === 1 ? sectionY.current.upcoming : sectionY.current.finished;
    scrollRef.current?.scrollTo({ y: Math.max(y - 8, 0), animated: true });
  };

  if (loading) {
    return (
      <SafeAreaView style={s.root}>
        <StatusBar barStyle="dark-content" backgroundColor={PAGE_BG} />
        <View style={s.center}><ActivityIndicator color={GREEN} size="large" /></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.root}>
      <StatusBar barStyle="dark-content" backgroundColor="#fff" />

      <SearchOverlay
        visible={searchActive}
        onClose={() => setSearchActive(false)}
        liveMatches={liveMatches}
        upcomingMatches={upcomingMatches}
        finishedMatches={finishedMatches}
        router={router}
        myUid={myUid}
      />

      <HelpGuideSheet visible={helpOpen} onClose={() => setHelpOpen(false)} />

      {/* ── HEADER ────────────────────────────────────────────────────────── */}
      <View style={s.header}>
        <TouchableOpacity style={s.menuBtn} hitSlop={8} onPress={() => setHelpOpen(true)}>
  <Ionicons name="help-circle-outline" size={24} color={DARK} />
</TouchableOpacity>
        <View style={s.titleWrap}>
          <View style={s.trophyBadge}>
            <Ionicons name="trophy" size={16} color="#fff" />
          </View>
          <View>
            <Text style={s.appName}>Leagues</Text>
            <Text style={s.appSub}>Live · Upcoming · Finished</Text>
          </View>
        </View>
        <View style={s.headerIcons}>
          <TouchableOpacity style={s.iconBtn} onPress={() => setSearchActive(true)}>
            <Ionicons name="search-outline" size={20} color={DARK} />
          </TouchableOpacity>
          <TouchableOpacity style={s.iconBtn} onPress={() => router.push("/notification/user-notification")}>
            <Ionicons name="notifications-outline" size={20} color={DARK} />
            <View style={s.notifDot} />
          </TouchableOpacity>
        </View>
      </View>

      {/* ── QUICK-JUMP TABS ───────────────────────────────────────────────── */}
      <View style={s.tabsRow}>
        {[
          { label: "LIVE",      count: liveMatches.length },
          { label: "UPCOMING",  count: upcomingMatches.length },
          { label: "FINISHED",  count: finishedMatches.length },
        ].map((t, i) => {
          const active = activeTab === i;
          return (
            <TouchableOpacity
              key={t.label}
              style={[s.tabPill, active && s.tabPillActive]}
              activeOpacity={0.85}
              onPress={() => jumpTo(i as 0 | 1 | 2)}
            >
              {i === 0 && active && <PulseDot color="#fff" size={6} />}
              <Text style={[s.tabPillTxt, active && s.tabPillTxtActive]}>
                {t.label} ({t.count})
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* ── CONTENT ───────────────────────────────────────────────────────── */}
      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={GREEN} />}
        contentContainerStyle={{ paddingBottom: 110 }}
      >
        {/* LIVE — hero carousel */}
        <View onLayout={(e) => { sectionY.current.live = e.nativeEvent.layout.y; }} style={{ paddingTop: 16 }}>
          {liveMatches.length === 0 ? (
            <EmptySection icon="flash-outline" text="No live matches right now" />
          ) : (
            <ScrollView
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
              snapToInterval={SW - 20}
              decelerationRate="fast"
            >
              {liveMatches.map(m => <LiveHeroCard key={m.id} match={m} router={router} myUid={myUid} />)}
            </ScrollView>
          )}
        </View>

        {/* UPCOMING */}
        <View onLayout={(e) => { sectionY.current.upcoming = e.nativeEvent.layout.y; }} style={{ marginTop: 24 }}>
          <View style={s.sectionHeader}>
            <Text style={s.sectionTitle}>Upcoming Matches</Text>
            <TouchableOpacity onPress={() => router.push("/(playon-pro)/matches?tab=upcoming" as any)}>
              <Text style={s.viewAll}>View All</Text>
            </TouchableOpacity>
          </View>
          {upcomingMatches.length === 0 ? (
            <EmptySection icon="calendar-outline" text="No upcoming matches" />
          ) : (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 16, gap: 10 }}
            >
              {upcomingMatches.map(m => <UpcomingMiniCard key={m.id} match={m} router={router} myUid={myUid} />)}
            </ScrollView>
          )}
        </View>

        {/* 💰 Ad / sponsor slot */}
<AdBanner placement="home" />
 
{/* 🤝 Invite friends card */}
<TouchableOpacity
  activeOpacity={0.9}
  onPress={inviteFriend}
  style={{
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: "#16A34A", borderRadius: 16,
    marginHorizontal: 16, marginTop: 20, padding: 16,
  }}
>
  <View style={{
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: "rgba(255,255,255,0.2)",
    alignItems: "center", justifyContent: "center",
  }}>
    <Ionicons name="gift" size={20} color="#fff" />
  </View>
  <View style={{ flex: 1 }}>
    <Text style={{ fontSize: 14.5, fontWeight: "800", color: "#fff" }}>
      Invite your friends
    </Text>
    <Text style={{ fontSize: 11.5, color: "rgba(255,255,255,0.85)", marginTop: 2 }}>
      More friends = more live viewers on your matches
    </Text>
  </View>
  <Ionicons name="chevron-forward" size={18} color="#fff" />
</TouchableOpacity>

        {/* FINISHED */}
        <View onLayout={(e) => { sectionY.current.finished = e.nativeEvent.layout.y; }} style={{ marginTop: 24 }}>
          <View style={s.sectionHeader}>
            <Text style={s.sectionTitle}>Finished Matches</Text>
            <TouchableOpacity onPress={() => router.push("/(playon-pro)/matches?tab=finished" as any)}>
              <Text style={s.viewAll}>View All</Text>
            </TouchableOpacity>
          </View>
          {finishedMatches.length === 0 ? (
            <EmptySection icon="checkmark-circle-outline" text="No finished matches yet" />
          ) : (
            finishedMatches.map(m => <FinishedRow key={m.id} match={m} router={router} myUid={myUid} />)
          )}
        </View>
      </ScrollView>

      {/* ── HOST FAB ──────────────────────────────────────────────────────── */}
      <HostFab router={router} />
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: PAGE_BG },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },

  header: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingHorizontal: 16,
    paddingTop: Platform.OS === "android" ? (StatusBar.currentHeight ?? 0) + 12 : 8,
    paddingBottom: 12,
    backgroundColor: "#fff",
    borderBottomWidth: 1, borderBottomColor: "#F3F4F6",
  },
  menuBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  titleWrap: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10 },
  trophyBadge: {
    width: 34, height: 34, borderRadius: 10,
    backgroundColor: GREEN, alignItems: "center", justifyContent: "center",
  },
  appName: { fontSize: 18, fontWeight: "800", color: DARK },
  appSub: { fontSize: 11, color: GRAY, fontWeight: "500", marginTop: 1 },
  headerIcons: { flexDirection: "row", gap: 8 },
  iconBtn: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: "#F5F6F8", alignItems: "center", justifyContent: "center",
    position: "relative",
  },
  notifDot: {
    position: "absolute", top: 8, right: 8,
    width: 7, height: 7, borderRadius: 4,
    backgroundColor: GREEN, borderWidth: 2, borderColor: "#F5F6F8",
  },

  tabsRow: {
    flexDirection: "row", gap: 8,
    paddingHorizontal: 16, paddingVertical: 10,
    backgroundColor: "#fff",
    borderBottomWidth: 1, borderBottomColor: "#F3F4F6",
  },
  tabPill: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    paddingVertical: 10, borderRadius: 12,
    backgroundColor: "#F0F1F4",
  },
  tabPillActive: { backgroundColor: GREEN },
  tabPillTxt: { fontSize: 11.5, fontWeight: "800", color: "#6B7280" },
  tabPillTxtActive: { color: "#fff" },

  sectionHeader: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, marginBottom: 12,
  },
  sectionTitle: { fontSize: 17, fontWeight: "800", color: DARK },
  viewAll: { fontSize: 13, fontWeight: "700", color: GREEN_D },
});
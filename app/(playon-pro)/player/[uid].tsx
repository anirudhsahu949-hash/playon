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
} from "react-native";
import { useEffect, useState } from "react";
import { db } from "../../../firebaseConfig";
import { doc, getDoc } from "firebase/firestore";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

// =======================================================
// 👤 PUBLIC PLAYER PROFILE  (app/(playon-pro)/player/[uid].tsx)
//
// Read-only Instagram-style view of anyone's playerProfile.
// Opened from the Stats leaderboard when any player row is tapped.
// Uses the exact same visual layout as LiveProfile in the user
// profile tab — but with NO edit button, NO renewal, NO settings.
// =======================================================

const GREEN  = "#16A34A";
const PURPLE = "#7C3AED";
const DARK   = "#0F172A";

// ── Sport role labels ─────────────────────────────────────────────────────────
const SPORT_ROLES: Record<string, { label: string; value: string }[]> = {
  Cricket:    [
    { label: "Batsman",       value: "batsman"    },
    { label: "Bowler",        value: "bowler"     },
    { label: "All-Rounder",   value: "allrounder" },
    { label: "Wicket Keeper", value: "keeper"     },
  ],
  Football:   [
    { label: "Goalkeeper",  value: "goalkeeper"  },
    { label: "Defender",    value: "defender"    },
    { label: "Midfielder",  value: "midfielder"  },
    { label: "Forward",     value: "forward"     },
  ],
  Badminton:  [
    { label: "Singles", value: "singles" },
    { label: "Doubles", value: "doubles" },
    { label: "Mixed",   value: "mixed"   },
  ],
  Basketball: [
    { label: "Point Guard",    value: "pg" },
    { label: "Shooting Guard", value: "sg" },
    { label: "Small Forward",  value: "sf" },
    { label: "Power Forward",  value: "pf" },
    { label: "Center",         value: "c"  },
  ],
  Volleyball: [
    { label: "Setter",  value: "setter"  },
    { label: "Libero",  value: "libero"  },
    { label: "Spiker",  value: "spiker"  },
    { label: "Blocker", value: "blocker" },
  ],
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function initials(name: string) {
  return (name || "?").trim().split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
}
function primarySport(sports: string[]) {
  return sports?.[0] || "";
}
function mvpPoints(stats: any, sport: string): number {
  if (sport === "Cricket")
    return Math.round((stats.runs || 0) * 1.5 + (stats.wickets || 0) * 25);
  if (sport === "Football")
    return (stats.goals || 0) * 3 + (stats.assists || 0);
  return (stats.wins || 0) * 10 + (stats.matches || 0);
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function PublicPlayerProfile() {
  const { uid }  = useLocalSearchParams<{ uid: string }>();
  const router   = useRouter();
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!uid) { setLoading(false); return; }
    (async () => {
      try {
        const snap = await getDoc(doc(db, "playerProfiles", uid));
        if (snap.exists()) setProfile(snap.data());
      } catch (e) { console.error("public profile load", e); }
      finally { setLoading(false); }
    })();
  }, [uid]);

  if (loading) {
    return (
      <SafeAreaView style={[p.root, p.center]}>
        <StatusBar barStyle="dark-content" backgroundColor="#F8F9FB" />
        <ActivityIndicator color={GREEN} size="large" />
      </SafeAreaView>
    );
  }

  if (!profile) {
    return (
      <SafeAreaView style={[p.root, p.center]}>
        <StatusBar barStyle="dark-content" backgroundColor="#F8F9FB" />
        <Ionicons name="person-outline" size={40} color="#9CA3AF" />
        <Text style={p.notFoundTxt}>Player not found</Text>
        <TouchableOpacity onPress={() => router.back()} style={{ marginTop: 14 }}>
          <Text style={{ color: GREEN, fontWeight: "700" }}>Go back</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  const stats    = profile.stats || {};
  const sport    = primarySport(profile.sports || []);
  const isCricket  = sport === "Cricket";
  const isFootball = sport === "Football";
  const matches  = Number(stats.matches || 0);
  const wins     = Number(stats.wins    || 0);
  const winRate  = matches > 0 ? Math.round((wins / matches) * 100) : 0;
  const points   = mvpPoints(stats, sport);

  const roleLabel = (() => {
    const roles = SPORT_ROLES[sport] || [];
    return roles.find((r) => r.value === profile.playerRole)?.label || null;
  })();

  // ── 4 headline stats (sport-aware) ───────────────────────────────────────
  const headlineStats = (() => {
    if (isCricket) return [
      { icon: "baseball-outline"    as const, color: "#7C3AED", bg: "#EDE9FE", label: "Matches", value: String(matches) },
      { icon: "trending-up-outline" as const, color: "#F59E0B", bg: "#FEF3C7", label: "Runs",    value: String(stats.runs || 0) },
      { icon: "ellipse-outline"     as const, color: "#10B981", bg: "#D1FAE5", label: "Wickets", value: String(stats.wickets || 0) },
      { icon: "star-outline"        as const, color: "#6366F1", bg: "#EEF2FF", label: "Points",  value: String(points) },
    ];
    if (isFootball) return [
      { icon: "football-outline"    as const, color: "#7C3AED", bg: "#EDE9FE", label: "Matches", value: String(matches) },
      { icon: "trending-up-outline" as const, color: "#F59E0B", bg: "#FEF3C7", label: "Goals",   value: String(stats.goals || 0) },
      { icon: "git-branch-outline"  as const, color: "#10B981", bg: "#D1FAE5", label: "Assists", value: String(stats.assists || 0) },
      { icon: "star-outline"        as const, color: "#6366F1", bg: "#EEF2FF", label: "Points",  value: String(points) },
    ];
    return [
      { icon: "trophy-outline"             as const, color: "#7C3AED", bg: "#EDE9FE", label: "Matches", value: String(matches) },
      { icon: "checkmark-circle-outline"   as const, color: "#F59E0B", bg: "#FEF3C7", label: "Won",     value: String(wins) },
      { icon: "close-circle-outline"       as const, color: "#10B981", bg: "#D1FAE5", label: "Lost",    value: String(stats.losses || 0) },
      { icon: "star-outline"               as const, color: "#6366F1", bg: "#EEF2FF", label: "Win%",    value: winRate > 0 ? `${winRate}%` : "—" },
    ];
  })();

  // ── Performance grid ──────────────────────────────────────────────────────
  const perfMetrics = (() => {
    if (isCricket) return [
      { label: "Batting Avg",  value: matches > 0 ? ((stats.runs || 0) / matches).toFixed(2) : "—" },
      { label: "Strike Rate",  value: "—" },
      { label: "Best Score",   value: stats.hundreds > 0 ? "100+" : stats.fifties > 0 ? "50+" : "—" },
      { label: "50s / 100s",   value: `${stats.fifties || 0} / ${stats.hundreds || 0}` },
    ];
    if (isFootball) return [
      { label: "Goals/Game",   value: matches > 0 ? ((stats.goals   || 0) / matches).toFixed(2) : "—" },
      { label: "Assists/Game", value: matches > 0 ? ((stats.assists || 0) / matches).toFixed(2) : "—" },
      { label: "Win Rate",     value: winRate > 0 ? `${winRate}%` : "—" },
      { label: "Clean Sheets", value: "—" },
    ];
    return [
      { label: "Matches",  value: String(matches) },
      { label: "Win Rate", value: winRate > 0 ? `${winRate}%` : "—" },
      { label: "Won",      value: String(wins) },
      { label: "Lost",     value: String(stats.losses || 0) },
    ];
  })();

  // ── Achievements ──────────────────────────────────────────────────────────
  const achievements = (() => {
    if (isCricket) return [
      { icon: "medal-outline"      as const, iconColor: "#7C3AED", bg: "#EDE9FE", title: "Runs",        sub: "Career total",    value: String(stats.runs    || 0) },
      { icon: "ellipse-outline"    as const, iconColor: "#F59E0B", bg: "#FEF3C7", title: "Wickets",     sub: "Career total",    value: String(stats.wickets || 0) },
      { icon: "tennisball-outline" as const, iconColor: "#10B981", bg: "#D1FAE5", title: "50s",         sub: "Half-centuries",  value: String(stats.fifties || 0) },
      { icon: "ribbon-outline"     as const, iconColor: "#3B82F6", bg: "#DBEAFE", title: "100s",        sub: "Centuries",       value: String(stats.hundreds|| 0) },
    ];
    if (isFootball) return [
      { icon: "football-outline"   as const, iconColor: "#7C3AED", bg: "#EDE9FE", title: "Goals",       sub: "Career total",    value: String(stats.goals   || 0) },
      { icon: "git-branch-outline" as const, iconColor: "#F59E0B", bg: "#FEF3C7", title: "Assists",     sub: "Career total",    value: String(stats.assists || 0) },
      { icon: "trophy-outline"     as const, iconColor: "#10B981", bg: "#D1FAE5", title: "Wins",        sub: "Matches won",     value: String(wins) },
      { icon: "ribbon-outline"     as const, iconColor: "#3B82F6", bg: "#DBEAFE", title: "Win Rate",    sub: "Overall",         value: winRate > 0 ? `${winRate}%` : "—" },
    ];
    return [
      { icon: "trophy-outline"           as const, iconColor: "#7C3AED", bg: "#EDE9FE", title: "Matches",  sub: "Played",       value: String(matches) },
      { icon: "checkmark-circle-outline" as const, iconColor: "#F59E0B", bg: "#FEF3C7", title: "Wins",     sub: "Total",        value: String(wins) },
      { icon: "star-outline"             as const, iconColor: "#10B981", bg: "#D1FAE5", title: "Win Rate",  sub: "Overall",      value: winRate > 0 ? `${winRate}%` : "—" },
      { icon: "ribbon-outline"           as const, iconColor: "#3B82F6", bg: "#DBEAFE", title: "Points",   sub: "MVP score",     value: String(points) },
    ];
  })();

  return (
    <SafeAreaView style={p.root}>
      <StatusBar barStyle="dark-content" backgroundColor="#F8F9FB" />

      {/* ── Back header ── */}
      <View style={p.topBar}>
        <TouchableOpacity onPress={() => router.back()} style={p.backBtn} hitSlop={10}>
          <Ionicons name="chevron-back" size={22} color={DARK} />
        </TouchableOpacity>
        <Text style={p.topBarTitle} numberOfLines={1}>
          {profile.displayName || profile.playonId || "Player"}
        </Text>
        {/* Placeholder right button — could add share later */}
        <View style={{ width: 36 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 48 }}>

        {/* ── Profile card ── */}
        <View style={p.profileCard}>
          {/* Avatar */}
          <View style={p.avatarWrap}>
            <View style={p.avatar}>
              <Text style={p.avatarTxt}>{initials(profile.displayName || "?")}</Text>
            </View>
          </View>

          {/* Name + handle + role */}
          <View style={p.profileMeta}>
            <View style={p.nameRow}>
              <Text style={p.profileName} numberOfLines={1}>
                {profile.displayName || profile.playonId}
              </Text>
              {/* Verified badge */}
              <Ionicons name="checkmark-circle" size={18} color={PURPLE} />
            </View>
            {!!profile.playonId && (
              <Text style={p.profileHandle}>@{profile.playonId}</Text>
            )}
            {(!!roleLabel || !!sport) && (
              <View style={p.profileLocation}>
                <Ionicons name="location-outline" size={12} color="#6B7280" />
                <Text style={p.profileLocationTxt}>
                  {roleLabel || sport}{profile.age ? `, Age ${profile.age}` : ""}
                </Text>
              </View>
            )}
          </View>
        </View>

        {/* ── Bio ── */}
        {!!profile.bio && (
          <View style={p.bioBox}>
            <Text style={p.bioTxt}>{profile.bio}</Text>
          </View>
        )}

        {/* ── Sport pills ── */}
        {Array.isArray(profile.sports) && profile.sports.length > 0 && (
          <View style={p.sportPills}>
            {profile.sports.map((sp: string) => (
              <View key={sp} style={p.sportPill}>
                <Text style={p.sportPillTxt}>{sp}</Text>
              </View>
            ))}
          </View>
        )}

        {/* ── 4-stat bar ── */}
        <View style={p.statBar}>
          {headlineStats.map((st, i) => (
            <View key={st.label} style={[p.statCell, i < 3 && p.statCellBorder]}>
              <View style={[p.statIconWrap, { backgroundColor: st.bg }]}>
                <Ionicons name={st.icon} size={16} color={st.color} />
              </View>
              <Text style={p.statCellLabel}>{st.label}</Text>
              <Text style={p.statCellValue}>{st.value}</Text>
            </View>
          ))}
        </View>

        {/* ── Performance overview ── */}
        <View style={p.section}>
          <Text style={p.sectionTitle}>Performance overview</Text>
          <View style={p.perfGrid}>
            {perfMetrics.map((m, i) => (
              <View key={m.label} style={[
                p.perfCell,
                i % 2 === 0 && p.perfCellRight,
                i < 2 && p.perfCellBottom,
              ]}>
                <Text style={p.perfLabel}>{m.label}</Text>
                <Text style={p.perfValue}>{m.value}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* ── Achievements ── */}
        <View style={p.section}>
          <Text style={p.sectionTitle}>Career highlights</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 12, paddingBottom: 4, paddingTop: 2 }}
          >
            {achievements.map((ach) => (
              <View key={ach.title} style={p.achCard}>
                <View style={[p.achIconWrap, { backgroundColor: ach.bg }]}>
                  <Ionicons name={ach.icon} size={28} color={ach.iconColor} />
                </View>
                <Text style={p.achTitle}>{ach.title}</Text>
                <Text style={p.achSub}>{ach.sub}</Text>
                <Text style={[p.achValue, { color: ach.iconColor }]}>{ach.value}</Text>
              </View>
            ))}
          </ScrollView>
        </View>

        {/* ── Playing style (cricket) ── */}
        {isCricket && (profile.battingHand || profile.bowlingStyle) && (
          <View style={p.section}>
            <Text style={p.sectionTitle}>Playing style</Text>
            <View style={p.styleRow}>
              {!!profile.battingHand && (
                <View style={p.stylePill}>
                  <Ionicons name="hand-left-outline" size={14} color={PURPLE} />
                  <Text style={p.stylePillTxt}>{profile.battingHand} Bat</Text>
                </View>
              )}
              {!!profile.bowlingStyle && profile.bowlingStyle !== "Does Not Bowl" && (
                <View style={p.stylePill}>
                  <Ionicons name="baseball-outline" size={14} color={PURPLE} />
                  <Text style={p.stylePillTxt}>{profile.bowlingStyle}</Text>
                </View>
              )}
            </View>
          </View>
        )}

        {/* ── League history placeholder ── */}
        <View style={p.section}>
          <Text style={p.sectionTitle}>League history</Text>
          <View style={p.historyEmpty}>
            <Ionicons name="trophy-outline" size={22} color="#D1D5DB" />
            <Text style={p.historyEmptyTxt}>No leagues played yet</Text>
          </View>
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────
const p = StyleSheet.create({
  root:    { flex: 1, backgroundColor: "#F8F9FB" },
  center:  { alignItems: "center", justifyContent: "center" },
  notFoundTxt: { fontSize: 15, color: "#6B7280", marginTop: 12 },

  topBar: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingTop: Platform.OS === "android" ? (StatusBar.currentHeight ?? 0) + 8 : 8,
    paddingBottom: 10,
    backgroundColor: "#F8F9FB",
  },
  backBtn:     { width: 36, height: 36, borderRadius: 18, backgroundColor: "#fff", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "#E5E7EB" },
  topBarTitle: { fontSize: 16, fontWeight: "800", color: DARK, flex: 1, textAlign: "center" },

  profileCard: {
    flexDirection: "row", alignItems: "center",
    marginHorizontal: 16, marginBottom: 10, marginTop: 6,
    backgroundColor: "#fff", borderRadius: 18,
    padding: 14, gap: 12,
    borderWidth: 1, borderColor: "#F3F4F6",
    shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  avatarWrap: { flexShrink: 0 },
  avatar: {
    width: 72, height: 72, borderRadius: 36, backgroundColor: PURPLE,
    alignItems: "center", justifyContent: "center",
    borderWidth: 3, borderColor: "#EDE9FE",
  },
  avatarTxt:  { color: "#fff", fontWeight: "900", fontSize: 24 },

  profileMeta: { flex: 1, gap: 2 },
  nameRow:     { flexDirection: "row", alignItems: "center", gap: 6 },
  profileName: { fontSize: 17, fontWeight: "800", color: DARK, flex: 1 },
  profileHandle: { fontSize: 13, color: "#6B7280", fontWeight: "500" },
  profileLocation: { flexDirection: "row", alignItems: "center", gap: 3, marginTop: 2 },
  profileLocationTxt: { fontSize: 12, color: "#6B7280" },

  bioBox:  { marginHorizontal: 16, marginBottom: 8 },
  bioTxt:  { fontSize: 13, color: "#4B5563", lineHeight: 20 },

  sportPills: { flexDirection: "row", flexWrap: "wrap", gap: 6, paddingHorizontal: 16, marginBottom: 12 },
  sportPill:  {
    backgroundColor: "#EDE9FE", borderColor: "#C4B5FD", borderWidth: 1,
    borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4,
  },
  sportPillTxt: { fontSize: 12, fontWeight: "600", color: "#5B21B6" },

  statBar: {
    flexDirection: "row",
    marginHorizontal: 16, marginBottom: 14,
    backgroundColor: "#fff", borderRadius: 16,
    borderWidth: 1, borderColor: "#F3F4F6", overflow: "hidden",
    shadowColor: "#000", shadowOpacity: 0.03, shadowRadius: 6, shadowOffset: { width: 0, height: 1 }, elevation: 1,
  },
  statCell:       { flex: 1, alignItems: "center", paddingVertical: 16, gap: 5 },
  statCellBorder: { borderRightWidth: 1, borderRightColor: "#F3F4F6" },
  statIconWrap:   { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  statCellLabel:  { fontSize: 11, color: "#6B7280", fontWeight: "500" },
  statCellValue:  { fontSize: 20, fontWeight: "900", color: DARK },

  section:       { marginHorizontal: 16, marginBottom: 16 },
  sectionTitle:  { fontSize: 16, fontWeight: "800", color: DARK, marginBottom: 12 },

  perfGrid: {
    flexDirection: "row", flexWrap: "wrap",
    backgroundColor: "#fff", borderRadius: 16,
    borderWidth: 1, borderColor: "#F3F4F6", overflow: "hidden",
    shadowColor: "#000", shadowOpacity: 0.03, shadowRadius: 6, shadowOffset: { width: 0, height: 1 }, elevation: 1,
  },
  perfCell:       { width: "50%", paddingVertical: 18, paddingHorizontal: 20 },
  perfCellRight:  { borderRightWidth: 1, borderRightColor: "#F3F4F6" },
  perfCellBottom: { borderBottomWidth: 1, borderBottomColor: "#F3F4F6" },
  perfLabel:      { fontSize: 12, color: "#9CA3AF", fontWeight: "500", marginBottom: 6 },
  perfValue:      { fontSize: 22, fontWeight: "800", color: DARK },

  achCard: {
    width: 148, backgroundColor: "#fff", borderRadius: 16,
    padding: 14, gap: 6, borderWidth: 1, borderColor: "#F3F4F6",
    shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 6, shadowOffset: { width: 0, height: 1 }, elevation: 1,
  },
  achIconWrap: { width: 52, height: 52, borderRadius: 14, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  achTitle:    { fontSize: 14, fontWeight: "700", color: DARK },
  achSub:      { fontSize: 12, color: "#9CA3AF" },
  achValue:    { fontSize: 16, fontWeight: "800", marginTop: 2 },

  styleRow:    { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  stylePill: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "#F3F4F6", borderColor: "#E5E7EB", borderWidth: 1,
    borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6,
  },
  stylePillTxt: { fontSize: 13, fontWeight: "600", color: "#374151" },

  historyEmpty: {
    alignItems: "center", paddingVertical: 32,
    backgroundColor: "#fff", borderRadius: 16,
    borderWidth: 1, borderColor: "#F3F4F6", gap: 8,
  },
  historyEmptyTxt: { fontSize: 13, color: "#9CA3AF" },
});
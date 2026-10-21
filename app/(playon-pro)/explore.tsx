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
  TextInput,
} from "react-native";
import { useState, useCallback, useEffect, useRef } from "react";
import { db, auth } from "../../firebaseConfig";
import {
  collection, query, where, getDocs,
  orderBy, limit,
} from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

// =======================================================
// 📊 STATS SCREEN  (app/(playon-pro)/stats.tsx)
// Replaces the old "Explore" tab.
// Shows leaderboards from playerProfiles collection.
//
// Sport filter → category tabs → ranked player list
// Tap any player row → navigate to player/[uid] public profile
// =======================================================

const GREEN  = "#16A34A";
const PURPLE = "#7C3AED";
const DARK   = "#0B1220";
const LIMIT  = 15;

// ── Sport config ─────────────────────────────────────────────────────────────
const SPORTS = [
  { name: "All",        icon: "trophy-outline"      as const, color: "#6B7280" },
  { name: "Cricket",    icon: "baseball-outline"    as const, color: "#7C3AED" },
  { name: "Football",   icon: "football-outline"    as const, color: "#2563EB" },
  { name: "Badminton",  icon: "tennisball-outline"  as const, color: "#059669" },
  { name: "Basketball", icon: "basketball-outline"  as const, color: "#EA580C" },
  { name: "Volleyball", icon: "ellipse-outline"     as const, color: "#0EA5E9" },
];

// ── Category tabs per sport ───────────────────────────────────────────────────
type Category = {
  key:    string;
  label:  string;
  icon:   keyof typeof Ionicons.glyphMap;
  field:  string;   // playerProfiles stats field to sort by
  unit:   string;   // label on the right side of each row
  sport?: string;   // if set, filter by this primary sport
};

const CATEGORIES_CRICKET: Category[] = [
  { key: "runs",    label: "Batting",  icon: "trending-up-outline",   field: "stats.runs",    unit: "runs",    sport: "Cricket" },
  { key: "wickets", label: "Bowling",  icon: "ellipse-outline",        field: "stats.wickets", unit: "wkts",    sport: "Cricket" },
  { key: "matches", label: "Matches",  icon: "calendar-outline",       field: "stats.matches", unit: "matches", sport: "Cricket" },
  { key: "points",  label: "MVP",      icon: "star-outline",           field: "stats.runs",    unit: "pts",     sport: "Cricket" },
];
const CATEGORIES_FOOTBALL: Category[] = [
  { key: "goals",   label: "Goals",    icon: "football-outline",       field: "stats.goals",   unit: "goals",   sport: "Football" },
  { key: "assists", label: "Assists",  icon: "git-branch-outline",     field: "stats.assists", unit: "assists", sport: "Football" },
  { key: "matches", label: "Matches",  icon: "calendar-outline",       field: "stats.matches", unit: "matches", sport: "Football" },
];
const CATEGORIES_ALL: Category[] = [
  { key: "matches", label: "Matches",  icon: "calendar-outline",       field: "stats.matches", unit: "matches" },
  { key: "wins",    label: "Most Wins",icon: "trophy-outline",         field: "stats.wins",    unit: "wins"    },
];

function getCategoriesForSport(sport: string): Category[] {
  if (sport === "Cricket")  return CATEGORIES_CRICKET;
  if (sport === "Football") return CATEGORIES_FOOTBALL;
  return CATEGORIES_ALL;
}

// ── Types ─────────────────────────────────────────────────────────────────────
type PlayerRow = {
  uid:         string;
  displayName: string;
  playonId:    string;
  sports:      string[];
  playerRole:  string;
  stats:       Record<string, number>;
  // computed display value
  displayValue: number;
  displayUnit:  string;
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function initials(name: string) {
  return (name || "?").trim().split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
}

function primarySport(sports: string[]) {
  return sports?.[0] || "";
}

function sportColor(sport: string) {
  return SPORTS.find((s) => s.name === sport)?.color || "#6B7280";
}

function mvpPoints(stats: Record<string, number>, sport: string): number {
  if (sport === "Cricket")
    return Math.round((stats.runs || 0) * 1.5 + (stats.wickets || 0) * 25);
  if (sport === "Football")
    return (stats.goals || 0) * 3 + (stats.assists || 0);
  return (stats.wins || 0) * 10 + (stats.matches || 0);
}

// ── Main component ────────────────────────────────────────────────────────────
export default function StatsScreen() {
  const router = useRouter();

  const [activeSport, setActiveSport] = useState("All");
  const [categories,  setCategories]  = useState<Category[]>(CATEGORIES_ALL);
  const [activeCategory, setActiveCategory] = useState<Category>(CATEGORIES_ALL[0]);

  const [players,    setPlayers]    = useState<PlayerRow[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [myUid,      setMyUid]      = useState<string | null>(null);

  // Search
  const [search, setSearch]     = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [searchResults, setSearchResults] = useState<PlayerRow[] | null>(null);
  const [searching,     setSearching]     = useState(false);

  // Auth — to highlight the current user in the leaderboard
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setMyUid(u?.uid || null));
    return unsub;
  }, []);

  // When sport changes, update category list and reset to first category
  useEffect(() => {
    const cats = getCategoriesForSport(activeSport);
    setCategories(cats);
    setActiveCategory(cats[0]);
  }, [activeSport]);

  // Load leaderboard whenever category changes
  const loadLeaderboard = useCallback(async () => {
    setLoading(true);
    try {
      const cat = activeCategory;
      let q = query(
        collection(db, "playerProfiles"),
        where("isExpired", "==", false),
        limit(LIMIT * 3) // over-fetch since we filter + sort client-side
      );

      const snap = await getDocs(q);

      let rows: PlayerRow[] = snap.docs
        .map((d) => {
          const data = d.data();
          const stats = data.stats || {};
          const sport = primarySport(data.sports || []);

          // Filter by sport if category requires it
          if (cat.sport && sport !== cat.sport) return null;
          if (activeSport !== "All" && sport !== activeSport) return null;

          // Compute display value
          let displayValue = 0;
          if (cat.key === "points") {
            displayValue = mvpPoints(stats, sport);
          } else {
            // Walk the dotted field path e.g. "stats.runs"
            const parts = cat.field.split(".");
            let val: any = data;
            for (const p of parts) val = val?.[p];
            displayValue = Number(val || 0);
          }

          return {
            uid:          d.id,
            displayName:  data.displayName || data.playonId || "Unknown",
            playonId:     data.playonId    || "",
            sports:       data.sports      || [],
            playerRole:   data.playerRole  || "",
            stats,
            displayValue,
            displayUnit:  cat.unit,
          } as PlayerRow;
        })
        .filter((r): r is PlayerRow => r !== null && r.displayValue > 0);

      // Sort descending by displayValue
      rows.sort((a, b) => b.displayValue - a.displayValue);
      rows = rows.slice(0, LIMIT);

      setPlayers(rows);
    } catch (e) {
      console.error("stats load failed", e);
    } finally {
      setLoading(false);
    }
  }, [activeCategory, activeSport]);

  useFocusEffect(useCallback(() => { loadLeaderboard(); }, [loadLeaderboard]));

  const onRefresh = async () => {
    setRefreshing(true);
    await loadLeaderboard();
    setRefreshing(false);
  };

  // ── Search ────────────────────────────────────────────────────────────────
  const onSearchChange = (text: string) => {
    setSearch(text);
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!text.trim()) {
      setSearchResults(null);
      setSearching(false);
      return;
    }

    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const term = text.trim().toLowerCase().replace(/^@/, "");
        const end  = term.slice(0, -1) + String.fromCharCode(term.charCodeAt(term.length - 1) + 1);

        const [byName, byId] = await Promise.all([
          getDocs(query(
            collection(db, "playerProfiles"),
            where("displayNameLower", ">=", term),
            where("displayNameLower", "<",  end),
            limit(10)
          )),
          getDocs(query(
            collection(db, "playerProfiles"),
            where("playonId", ">=", term),
            where("playonId", "<",  end),
            limit(10)
          )),
        ]);

        const seen = new Set<string>();
        const results: PlayerRow[] = [];
        for (const snap of [...byName.docs, ...byId.docs]) {
          if (seen.has(snap.id)) continue;
          seen.add(snap.id);
          const data  = snap.data();
          const stats = data.stats || {};
          const sport = primarySport(data.sports || []);
          results.push({
            uid:          snap.id,
            displayName:  data.displayName || data.playonId || "Unknown",
            playonId:     data.playonId    || "",
            sports:       data.sports      || [],
            playerRole:   data.playerRole  || "",
            stats,
            displayValue: mvpPoints(stats, sport),
            displayUnit:  "pts",
          });
        }
        setSearchResults(results);
      } catch (e) {
        console.error("search failed", e);
      } finally {
        setSearching(false);
      }
    }, 400);
  };

  const clearSearch = () => {
    setSearch("");
    setSearchResults(null);
    setSearching(false);
    if (debounceRef.current) clearTimeout(debounceRef.current);
  };

  // ── Navigate to public player profile ─────────────────────────────────────
  const openPlayer = (uid: string) => {
    router.push(`/(playon-pro)/player/${uid}` as any);
  };

  // What to show in the list
  const listData = searchResults !== null ? searchResults : players;
  const isSearchMode = searchResults !== null;

  return (
    <SafeAreaView style={s.root}>
      <StatusBar barStyle="dark-content" backgroundColor="#fff" />

      {/* ── Header ── */}
      <View style={s.header}>
        <Text style={s.title}>Stats</Text>

        {/* Search bar */}
        <View style={s.searchBar}>
          <Ionicons name="search-outline" size={17} color="#9CA3AF" />
          <TextInput
            style={s.searchInput}
            value={search}
            onChangeText={onSearchChange}
            placeholder="Search player by name or @id"
            placeholderTextColor="#9CA3AF"
            autoCapitalize="none"
            autoCorrect={false}
          />
          {searching && <ActivityIndicator size="small" color="#9CA3AF" />}
          {search.length > 0 && !searching && (
            <TouchableOpacity onPress={clearSearch} hitSlop={8}>
              <Ionicons name="close-circle" size={18} color="#D1D5DB" />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* ── Sport filter pills ── */}
      {!isSearchMode && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.sportPills}
        >
          {SPORTS.map((sp) => {
            const active = activeSport === sp.name;
            return (
              <TouchableOpacity
                key={sp.name}
                style={[s.pill, active && { backgroundColor: sp.color, borderColor: sp.color }]}
                onPress={() => setActiveSport(sp.name)}
                activeOpacity={0.8}
              >
                <Ionicons name={sp.icon} size={13} color={active ? "#fff" : sp.color} />
                <Text style={[s.pillTxt, active && { color: "#fff" }]}>{sp.name}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}

      {/* ── Category tabs ── */}
      {!isSearchMode && (
        <View style={s.catBar}>
          {categories.map((cat) => {
            const active = cat.key === activeCategory.key;
            return (
              <TouchableOpacity
                key={cat.key}
                style={s.catBtn}
                onPress={() => setActiveCategory(cat)}
              >
                <Ionicons name={cat.icon} size={16} color={active ? GREEN : "#9CA3AF"} />
                <Text style={[s.catTxt, active && s.catTxtActive]}>{cat.label}</Text>
                <View style={[s.catUnder, active && s.catUnderActive]} />
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {/* ── Leaderboard ── */}
      <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" automaticallyAdjustKeyboardInsets
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 40 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={GREEN} />
        }
      >
        {/* Section label */}
        <View style={s.sectionRow}>
          <Text style={s.sectionLabel}>
            {isSearchMode
              ? `${listData.length} result${listData.length === 1 ? "" : "s"} for "${search}"`
              : `${activeCategory.label} leaderboard${activeSport !== "All" ? ` · ${activeSport}` : ""}`
            }
          </Text>
        </View>

        {loading && !refreshing ? (
          <View style={s.center}>
            <ActivityIndicator color={GREEN} size="large" />
          </View>
        ) : listData.length === 0 ? (
          <View style={s.empty}>
            <View style={s.emptyIcon}>
              <Ionicons
                name={isSearchMode ? "search-outline" : "stats-chart-outline"}
                size={28} color={GREEN}
              />
            </View>
            <Text style={s.emptyTitle}>
              {isSearchMode ? "No players found" : "No data yet"}
            </Text>
            <Text style={s.emptySub}>
              {isSearchMode
                ? "Try a different name or Playon ID"
                : "Players will appear here once they've played matches in this league."
              }
            </Text>
          </View>
        ) : (
          <View style={s.list}>
            {listData.map((player, index) => {
              const isMe  = player.uid === myUid;
              const sport = primarySport(player.sports);
              const sColor = sportColor(sport);
              const rank  = index + 1;

              return (
                <TouchableOpacity
                  key={player.uid}
                  style={[s.playerRow, isMe && s.playerRowMe]}
                  onPress={() => openPlayer(player.uid)}
                  activeOpacity={0.75}
                >
                  {/* Rank */}
                  <View style={[
                    s.rankWrap,
                    rank === 1 && s.rankGold,
                    rank === 2 && s.rankSilver,
                    rank === 3 && s.rankBronze,
                  ]}>
                    <Text style={[
                      s.rankTxt,
                      (rank <= 3) && { color: "#fff" },
                    ]}>
                      {rank <= 3
                        ? rank === 1 ? "🥇" : rank === 2 ? "🥈" : "🥉"
                        : String(rank)
                      }
                    </Text>
                  </View>

                  {/* Avatar */}
                  <View style={[s.avatar, { backgroundColor: sColor + "22", borderColor: sColor + "55" }]}>
                    <Text style={[s.avatarTxt, { color: sColor }]}>
                      {initials(player.displayName)}
                    </Text>
                  </View>

                  {/* Name + details */}
                  <View style={s.playerInfo}>
                    <View style={s.nameRow}>
                      <Text style={s.playerName} numberOfLines={1}>
                        {player.displayName}
                      </Text>
                      {isMe && (
                        <View style={s.meBadge}>
                          <Text style={s.meBadgeTxt}>You</Text>
                        </View>
                      )}
                    </View>
                    <Text style={s.playerSub} numberOfLines={1}>
                      {player.playonId ? `@${player.playonId}` : ""}
                      {player.playonId && sport ? " · " : ""}
                      {sport}
                    </Text>
                  </View>

                  {/* Stat value */}
                  <View style={s.statWrap}>
                    <Text style={s.statValue}>{player.displayValue}</Text>
                    <Text style={s.statUnit}>{player.displayUnit}</Text>
                  </View>

                  <Ionicons name="chevron-forward" size={16} color="#D1D5DB" />
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#F9FAFB" },

  header: {
    paddingHorizontal: 16,
    paddingTop: Platform.OS === "android" ? (StatusBar.currentHeight ?? 0) + 10 : 8,
    paddingBottom: 10,
    backgroundColor: "#fff",
  },
  title: { fontSize: 26, fontWeight: "800", color: DARK, letterSpacing: -0.5, marginBottom: 10 },

  searchBar: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "#F3F4F6", borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === "android" ? 7 : 11,
  },
  searchInput: { flex: 1, fontSize: 14, color: DARK, paddingVertical: 0 },

  sportPills: {
    paddingHorizontal: 16, paddingVertical: 10, gap: 8, flexDirection: "row",
  },
  pill: {
    flexDirection: "row", alignItems: "center", gap: 5,
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20,
    backgroundColor: "#fff", borderWidth: 1, borderColor: "#E5E7EB",
  },
  pillTxt: { fontSize: 12, fontWeight: "700", color: "#374151" },

  catBar: {
    flexDirection: "row", backgroundColor: "#fff",
    borderBottomColor: "#F3F4F6", borderBottomWidth: 1,
    paddingHorizontal: 8,
  },
  catBtn:       { flex: 1, alignItems: "center", paddingTop: 10 },
  catTxt:       { fontSize: 11, fontWeight: "600", color: "#9CA3AF", marginTop: 3 },
  catTxtActive: { color: GREEN },
  catUnder:     { height: 2, width: "70%", backgroundColor: "transparent", marginTop: 8, borderRadius: 2 },
  catUnderActive: { backgroundColor: GREEN },

  sectionRow:  { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6 },
  sectionLabel: { fontSize: 12, fontWeight: "700", color: "#9CA3AF", textTransform: "uppercase", letterSpacing: 0.5 },

  center: { paddingTop: 80, alignItems: "center" },
  empty:  { alignItems: "center", paddingTop: 60, paddingHorizontal: 40 },
  emptyIcon: {
    width: 64, height: 64, borderRadius: 32, backgroundColor: "#F0FDF4",
    alignItems: "center", justifyContent: "center", marginBottom: 12,
  },
  emptyTitle: { fontSize: 16, fontWeight: "700", color: DARK, textAlign: "center" },
  emptySub:   { fontSize: 13, color: "#6B7280", textAlign: "center", marginTop: 6, lineHeight: 19 },

  list: { paddingHorizontal: 12 },

  playerRow: {
    flexDirection: "row", alignItems: "center", gap: 10,
    backgroundColor: "#fff", borderRadius: 14, padding: 12,
    marginBottom: 8, borderWidth: 1, borderColor: "#F3F4F6",
  },
  playerRowMe: {
    borderColor: GREEN + "55", backgroundColor: "#F0FDF4",
  },

  rankWrap: {
    width: 32, height: 32, borderRadius: 10,
    backgroundColor: "#F3F4F6",
    alignItems: "center", justifyContent: "center",
    flexShrink: 0,
  },
  rankGold:   { backgroundColor: "#F59E0B" },
  rankSilver: { backgroundColor: "#9CA3AF" },
  rankBronze: { backgroundColor: "#CD7C4E" },
  rankTxt:    { fontSize: 13, fontWeight: "800", color: "#6B7280" },

  avatar: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: "center", justifyContent: "center",
    borderWidth: 1.5, flexShrink: 0,
  },
  avatarTxt: { fontSize: 14, fontWeight: "800" },

  playerInfo: { flex: 1 },
  nameRow:    { flexDirection: "row", alignItems: "center", gap: 6 },
  playerName: { fontSize: 14, fontWeight: "700", color: DARK, flex: 1 },
  playerSub:  { fontSize: 12, color: "#6B7280", marginTop: 2 },

  meBadge: {
    backgroundColor: GREEN, borderRadius: 6,
    paddingHorizontal: 6, paddingVertical: 1,
  },
  meBadgeTxt: { fontSize: 10, fontWeight: "800", color: "#fff" },

  statWrap:  { alignItems: "flex-end", flexShrink: 0 },
  statValue: { fontSize: 18, fontWeight: "900", color: DARK },
  statUnit:  { fontSize: 11, color: "#9CA3AF", fontWeight: "600" },
});
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";

// =============================================================================
// 🏏 LiveMatchCard — reusable live match card component
//
// Use anywhere: Home screen, Matches tab, League/Booking screen, etc.
//
// Usage:
//   <LiveMatchCard
//     matchId="abc123"
//     teamAName="Mumbai Indians"  teamAScore="141/3"  teamAOvers="6.4"
//     teamBName="Chennai SK"      teamBScore="52/0"   teamBOvers="2.1"
//     summary="Need 90 runs in 35 balls"
//     venue="SSPL Ground"
//     matchNumber={3}
//     isCurrentMatch={true}
//   />
// =============================================================================

type LiveMatchCardProps = {
  matchId:       string;
  teamAName:     string;
  teamAScore?:   string;
  teamAOvers?:   string;
  teamBName:     string;
  teamBScore?:   string;
  teamBOvers?:   string;
  /** Bottom bar text e.g. "Need 90 runs in 35 balls" or live summary */
  summary?:      string;
  venue?:        string;
  matchNumber?:  number;
  /** Show a small "This match" green badge */
  isCurrentMatch?: boolean;
  /** Extra styles applied to the outer container */
  style?:        object;
};

// Derive up to 2-letter initials from a team name
function initials(name: string): string {
  return (name || "?")
    .split(" ")
    .map((w) => w[0] || "")
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export default function LiveMatchCard({
  matchId,
  teamAName,  teamAScore, teamAOvers,
  teamBName,  teamBScore, teamBOvers,
  summary,
  venue,
  matchNumber,
  isCurrentMatch = false,
  style,
}: LiveMatchCardProps) {
  const router = useRouter();

  const subtitle = [
    matchNumber ? `Match ${matchNumber}` : null,
    venue || null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <TouchableOpacity
      activeOpacity={0.88}
      onPress={() => router.push(`/(playon-pro)/match/${matchId}` as any)}
      style={[lc.wrapper, style]}
    >
      {/* ── Gradient body ── */}
      <LinearGradient
        colors={["#1B2050", "#2E3C8C"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={lc.gradient}
      >
        {/* Decorative circle */}
        <View style={lc.deco} />

        {/* Top row: LIVE pill · subtitle · optional "This match" badge */}
        <View style={lc.topRow}>
          <View style={lc.livePill}>
            <View style={lc.liveDot} />
            <Text style={lc.liveTxt}>LIVE</Text>
          </View>

          {!!subtitle && (
            <Text style={lc.subtitle} numberOfLines={1}>{subtitle}</Text>
          )}

          {isCurrentMatch && (
            <View style={lc.thisBadge}>
              <Text style={lc.thisBadgeTxt}>This match</Text>
            </View>
          )}
        </View>

        {/* Teams + scores */}
        <View style={lc.teamsRow}>

          {/* Team A — batting (full brightness) */}
          <View style={lc.teamSide}>
            <View style={[lc.crest, lc.crestActive]}>
              <Text style={lc.crestTxt}>{initials(teamAName)}</Text>
            </View>
            <Text style={lc.teamName} numberOfLines={1}>{teamAName}</Text>
            <Text style={lc.score}>{teamAScore ?? "–"}</Text>
            {!!teamAOvers && <Text style={lc.overs}>{teamAOvers} Ov</Text>}
          </View>

          {/* VS divider */}
          <View style={lc.vsBlock}>
            <Text style={lc.vsTxt}>VS</Text>
            <View style={lc.vsDivider} />
          </View>

          {/* Team B — bowling / chasing (dimmed) */}
          <View style={[lc.teamSide, { alignItems: "flex-end" }]}>
            <View style={[lc.crest, lc.crestDim]}>
              <Text style={lc.crestTxt}>{initials(teamBName)}</Text>
            </View>
            <Text style={[lc.teamName, { textAlign: "right", opacity: 0.55 }]} numberOfLines={1}>
              {teamBName}
            </Text>
            <Text style={[lc.score, { opacity: 0.55 }]}>{teamBScore ?? "–"}</Text>
            {!!teamBOvers && <Text style={[lc.overs, { opacity: 0.35 }]}>{teamBOvers} Ov</Text>}
          </View>
        </View>
      </LinearGradient>

      {/* ── Bottom bar: summary + CTA ── */}
      <View style={lc.bottomBar}>
        <Text style={lc.summaryTxt} numberOfLines={1}>
          {summary || "Live match in progress"}
        </Text>
        <View style={lc.cta}>
          <Text style={lc.ctaTxt}>Watch live</Text>
          <Text style={lc.ctaArrow}>→</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

const lc = StyleSheet.create({
  wrapper: {
    borderRadius: 14,
    overflow: "hidden",
    shadowColor: "#1B2050",
    shadowOpacity: 0.22,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
    elevation: 5,
  },

  // Gradient section
  gradient: {
    padding: 11,
    paddingBottom: 13,
    position: "relative",
    overflow: "hidden",
  },
  deco: {
    position: "absolute",
    top: -20,
    right: -20,
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: "rgba(255,255,255,0.05)",
  },

  // Top row
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    marginBottom: 10,
  },
  livePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(225,29,42,0.20)",
    borderWidth: 1,
    borderColor: "rgba(225,29,42,0.42)",
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 5,
  },
  liveDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: "#ff4d4d",
  },
  liveTxt: {
    fontSize: 8,
    fontWeight: "800",
    color: "#ff8080",
    letterSpacing: 0.5,
  },
  subtitle: {
    flex: 1,
    fontSize: 10,
    color: "rgba(255,255,255,0.42)",
    fontWeight: "500",
  },
  thisBadge: {
    backgroundColor: "rgba(22,163,74,0.25)",
    borderWidth: 1,
    borderColor: "rgba(22,163,74,0.42)",
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 5,
  },
  thisBadgeTxt: {
    fontSize: 8,
    fontWeight: "700",
    color: "#4ade80",
  },

  // Teams row
  teamsRow: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  teamSide: {
    flex: 1,
    gap: 3,
  },
  crest: {
    width: 32,
    height: 32,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
  },
  crestActive: {
    backgroundColor: "rgba(255,255,255,0.15)",
    borderColor: "rgba(255,255,255,0.25)",
  },
  crestDim: {
    backgroundColor: "rgba(255,255,255,0.07)",
    borderColor: "rgba(255,255,255,0.13)",
  },
  crestTxt: {
    fontSize: 10,
    fontWeight: "800",
    color: "#fff",
  },
  teamName: {
    fontSize: 10,
    fontWeight: "700",
    color: "rgba(255,255,255,0.82)",
  },
  score: {
    fontSize: 18,
    fontWeight: "900",
    color: "#fff",
    letterSpacing: -0.5,
    lineHeight: 22,
  },
  overs: {
    fontSize: 9,
    color: "rgba(255,255,255,0.42)",
    fontWeight: "500",
  },

  // VS block
  vsBlock: {
    width: 38,
    alignItems: "center",
    gap: 4,
    paddingTop: 10,
  },
  vsTxt: {
    fontSize: 9,
    fontWeight: "800",
    color: "rgba(255,255,255,0.22)",
  },
  vsDivider: {
    width: 16,
    height: 1,
    backgroundColor: "rgba(255,255,255,0.12)",
  },

  // Bottom bar
  bottomBar: {
    backgroundColor: "#fff",
    paddingVertical: 8,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  summaryTxt: {
    flex: 1,
    fontSize: 10.5,
    color: "#4B5270",
    fontWeight: "500",
    paddingRight: 8,
  },
  cta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  ctaTxt: {
    fontSize: 10.5,
    fontWeight: "700",
    color: "#16A34A",
  },
  ctaArrow: {
    fontSize: 11,
    color: "#16A34A",
  },
});

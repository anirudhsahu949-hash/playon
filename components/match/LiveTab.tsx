import {
  View, Text, StyleSheet, ScrollView,
  TouchableOpacity, Animated, Easing,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useEffect, useRef, useState, useCallback } from "react";

// =============================================================================
// 🏏 LIVE TAB v3 — redesigned
//
// Changes from v2:
//   • Ball-event popup moved INSIDE the score card (below VS), not full-screen
//   • Popup colors are soft/light on the dark gradient bg:
//       SIX    → soft green  (#4ade80)
//       FOUR   → soft blue   (#60a5fa)
//       WICKET → soft red    (#fca5a5) + horizontal shake
//       NO BALL / WIDE → soft amber / sky  (compact inline pill)
//   • Team display is now DYNAMIC:
//       Currently batting team → green crest border + "BAT" badge, full opacity
//       Completed innings team → dimmed (0.6) — score still visible
//       Yet-to-bat team        → very dimmed (0.4) + "Yet to bat"
// =============================================================================

const BG     = "#EEF0F7";
const DARK   = "#1E2340";
const MEDIUM = "#4B5270";
const MUTED  = "#8A8FA8";
const BORDER = "#E2E5F0";
const GREEN  = "#16A34A";
const RED    = "#E11D2A";

const oversStr = (b: number) => `${Math.floor((b||0)/6)}.${(b||0)%6}`;
const oversDec = (b: number) => (b||0)/6;
const fixed2   = (n: number) => (isFinite(n) && n > 0 ? n.toFixed(2) : "–");

function groupedTimeline(timeline: any[]): { overNum: number; balls: any[] }[] {
  const groups: { overNum: number; balls: any[] }[] = [];
  let legal = 0, overNum = 1, cur: any[] = [];
  for (const b of timeline||[]) {
    cur.push(b);
    if (b.label!=="Wd"&&b.label!=="Nb"&&!String(b.label).startsWith("Nb+")&&!String(b.label).startsWith("Wd+")) legal++;
    if (legal===6) { groups.push({overNum,balls:[...cur]}); overNum++; legal=0; cur=[]; }
  }
  if (cur.length>0) groups.push({overNum,balls:cur});
  return groups;
}

function perOverRuns(timeline: any[]) {
  const overs: {over:number;runs:number}[]=[];
  let cur=0,legal=0,num=1;
  for (const b of timeline||[]) {
    cur+=b.runs||0;
    if (b.label!=="Wd"&&b.label!=="Nb"&&!String(b.label).startsWith("Nb+")&&!String(b.label).startsWith("Wd+")) legal++;
    if (legal===6) { overs.push({over:num,runs:cur}); num++; cur=0; legal=0; }
  }
  if (legal>0||cur>0) overs.push({over:num,runs:cur});
  return overs;
}

// ── Event detector ────────────────────────────────────────────────────────────
type BallEvent = "six" | "four" | "wicket" | "noball" | "wide" | "dot" | "run";

function detectEvent(ball: any): BallEvent {
  if (!ball) return "dot";
  const label = String(ball.label || "");
  if (ball.w) return "wicket";
  if (ball.runs === 6 && ball.boundary) return "six";
  if (ball.runs === 4 && ball.boundary) return "four";
  if (label === "Wd" || label.startsWith("Wd+")) return "wide";
  if (label === "Nb" || label.startsWith("Nb+")) return "noball";
  if (ball.runs === 0) return "dot";
  return "run";
}

// ── Inline ball event popup (inside score card, below VS) ─────────────────────
// Soft, light colors designed for the dark navy gradient background.
// SIX=green  FOUR=blue  WICKET=red(shake)  NOBALL=amber  WIDE=sky
function BallEventInlinePopup({ event, onDone }: { event: BallEvent | null; onDone: () => void }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const scale   = useRef(new Animated.Value(0.82)).current;
  const shakeX  = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!event || event === "dot" || event === "run") return;

    // Reset before each animation
    opacity.setValue(0);
    scale.setValue(0.82);
    shakeX.setValue(0);

    const shakeSeq = Animated.sequence([
      Animated.timing(shakeX, { toValue:  9, duration: 55, useNativeDriver: true }),
      Animated.timing(shakeX, { toValue: -9, duration: 55, useNativeDriver: true }),
      Animated.timing(shakeX, { toValue:  6, duration: 55, useNativeDriver: true }),
      Animated.timing(shakeX, { toValue: -6, duration: 55, useNativeDriver: true }),
      Animated.timing(shakeX, { toValue:  0, duration: 55, useNativeDriver: true }),
    ]);

    const hold = event === "wicket" ? 1700 : 1450;

    Animated.sequence([
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: 190, useNativeDriver: true }),
        Animated.spring(scale, { toValue: 1, friction: 5, tension: 150, useNativeDriver: true }),
        ...(event === "wicket" ? [shakeSeq] : []),
      ]),
      Animated.delay(hold),
      Animated.timing(opacity, { toValue: 0, duration: 280, useNativeDriver: true }),
    ]).start(onDone);
  }, [event]);

  if (!event || event === "dot" || event === "run") return null;

  type PopCfg = { emoji: string; text: string; sub: string; bg: string; border: string; color: string };
  const cfgMap: Record<string, PopCfg> = {
    six:    { emoji: "🏏", text: "SIX!",     sub: "Boundary",      bg: "rgba(74,222,128,0.14)",  border: "rgba(74,222,128,0.38)",  color: "#4ade80" },
    four:   { emoji: "⚡",  text: "FOUR!",   sub: "Boundary",      bg: "rgba(96,165,250,0.14)",  border: "rgba(96,165,250,0.38)",  color: "#60a5fa" },
    wicket: { emoji: "🎯", text: "OUT!",     sub: "Wicket fallen", bg: "rgba(252,165,165,0.14)", border: "rgba(252,165,165,0.38)", color: "#fca5a5" },
    noball: { emoji: "⚠",  text: "NO BALL", sub: "+1 extra",      bg: "rgba(252,211,77,0.14)",  border: "rgba(252,211,77,0.38)",  color: "#ff0000" },
    wide:   { emoji: "↔",  text: "WIDE",    sub: "+1 run",        bg: "rgba(125,211,252,0.14)", border: "rgba(125,211,252,0.38)", color: "#7dd3fc" },
  };

  const c = cfgMap[event];
  if (!c) return null;
return (
    <Animated.View
      pointerEvents="none"
      style={[
        s.eventPopupWrap,
        {
          opacity,
          transform: [
            { scale },
            { translateX: event === "wicket" ? shakeX : 0 },
          ],
        },
      ]}
    >
      <View style={[s.eventPopupBox, { backgroundColor: c.bg, borderColor: c.border }]}>
        <Text style={s.eventPopupEmoji}>{c.emoji}</Text>
        <View style={{ alignItems: "center" }}>
          <Text style={[s.eventPopupTxt, { color: c.color }]}>{c.text}</Text>
          <Text style={[s.eventPopupSub, { color: c.color }]}>{c.sub}</Text>
        </View>
      </View>
    </Animated.View>
  );
}

// ── Score ball dot (coloured) in the live header ──────────────────────────────
function BallDot({ ball, animate, size = 30 }: { ball: any; animate?: boolean; size?: number }) {
  const scale = useRef(new Animated.Value(animate ? 0.1 : 1)).current;
  useEffect(() => {
    if (!animate) return;
    Animated.spring(scale, { toValue: 1, friction: 4, tension: 100, useNativeDriver: true }).start();
  }, []);

  const label = String(ball?.label || "");
  const isW    = !!ball?.w;
  const isSix  = ball?.runs === 6 && ball?.boundary;
  const isFour = ball?.runs === 4 && ball?.boundary;
  const isWd   = label === "Wd" || label.startsWith("Wd+");
  const isNb   = label === "Nb" || label.startsWith("Nb+");
  const isLight = !isW && !isSix && !isFour && !isWd && !isNb &&
    (ball?.runs === 0 || ball?.runs === 1 || ball?.runs === 2 || ball?.runs === 3);

  const bg = isW ? "#DC2626"
    : isSix ? "#0ba006"
    : isFour ? "#1f9fde"
    : isNb ? RED
    : isWd ? "#0EA5E9"
    : isLight ? "#E5E7EB"
    : "#16A34A";

  const tc = isLight ? "#6B7280" : "#fff";
  const display = isW ? "W" : isSix ? "6" : isFour ? "4" : isNb ? "nb" : isWd ? "wd" : label;

  return (
  <Animated.View
    style={[
      bd.dot,
      {
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: bg,
        borderWidth: 0.3,
        borderColor: "#000",
        transform: [{ scale }],
      },
    ]}
  >
    <Text style={[bd.txt, { color: tc, fontSize: size <= 24 ? 9 : 11 }]}>{display}</Text>
  </Animated.View>
);
}

const bd = StyleSheet.create({
  dot: { alignItems: "center", justifyContent: "center" },
  txt: { fontWeight: "800" },
});

// ── Live divider shimmer — white streak sweeps right → left across the VS line ──
function LiveDividerShimmer({ trackWidth = 28, shimmerWidth = 14 }: { trackWidth?: number; shimmerWidth?: number }) {
  const translateX = useRef(new Animated.Value(trackWidth)).current;

  useEffect(() => {
    translateX.setValue(trackWidth);
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(translateX, {
          toValue: -shimmerWidth,
          duration: 1500,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
        Animated.delay(450),
        Animated.timing(translateX, { toValue: trackWidth, duration: 0, useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, []);

  return (
    <View style={[s.vsDividerTrack, { width: trackWidth }]}>
      <Animated.View style={[s.vsDividerShimmer, { width: shimmerWidth, transform: [{ translateX }] }]}>
        <LinearGradient
          colors={["transparent", "#fff", "transparent"]}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
          style={{ flex: 1, height: "100%" }}
        />
      </Animated.View>
    </View>
  );
}

type ScorecardTab = "current" | "batting" | "bowling" | "partnership";
type LiveTabProps = {
  sc: any; match: any; teamA: string; teamB: string;
  selected: string; setSelected: (t: string) => void;
  scorecardTab: ScorecardTab; setScorecardTab: (t: ScorecardTab) => void;
};

export default function LiveTab({ sc, match, teamA, teamB, selected, setSelected, scorecardTab, setScorecardTab }: LiveTabProps) {

  // ── Ball event detection ──────────────────────────────────────────────────
  const [currentEvent, setCurrentEvent] = useState<BallEvent | null>(null);
  const prevTimelineLen = useRef<number>(0);

  useEffect(() => {
    const timeline = sc?.timeline || [];
    const newLen   = timeline.length;
    if (newLen > prevTimelineLen.current && prevTimelineLen.current >= 0 && newLen > 0) {
      const lastBall = timeline[newLen - 1];
      const event    = detectEvent(lastBall);
      if (event !== "dot") setCurrentEvent(event);
    }
    prevTimelineLen.current = newLen;
  }, [sc?.timeline?.length]);

  const clearEvent = useCallback(() => setCurrentEvent(null), []);

  const inningsFor = (teamName: string) => {
    if (!sc) return null;
    if (sc.battingTeamName === teamName) return {
      battingCard: sc.battingCard || [], bowlingCard: sc.bowlingCard || [],
      timeline: sc.timeline || [], runs: sc.runs || 0, wickets: sc.wickets || 0,
      balls: sc.balls || 0, extras: sc.extras || {},
      strikerCardIdx: sc.strikerCardIdx, nonStrikerCardIdx: sc.nonStrikerCardIdx,
      live: sc.status !== "completed",
    };
    if (sc.innings1?.teamName === teamName) {
      const i = sc.innings1;
      return {
        battingCard: i.battingCard || [], bowlingCard: i.bowlingCard || [],
        timeline: i.timeline || [], runs: i.runs || 0, wickets: i.wickets || 0,
        balls: i.balls || 0, extras: i.extras || {},
        strikerCardIdx: -1, nonStrikerCardIdx: -1, live: false,
      };
    }
    return null;
  };

  const scoreLine = (t: string) => {
    const inn = inningsFor(t);
    return inn ? { score: `${inn.runs}/${inn.wickets}`, overs: `${oversStr(inn.balls)} Ov` } : null;
  };

  const scoreA    = scoreLine(teamA);
  const scoreB    = scoreLine(teamB);
  const innSel    = inningsFor(selected);
  const live      = sc?.status === "live";
  const completed = sc?.status === "completed";
  const crr       = sc && sc.balls > 0 ? (sc.runs * 6) / sc.balls : 0;
  const ballsLeft = sc ? sc.oversLimit * 6 - sc.balls : 0;
  const rrr       = sc && sc.innings === 2 && sc.target != null && ballsLeft > 0
    ? ((sc.target - sc.runs) * 6) / ballsLeft : null;
  


  const last5     = perOverRuns(sc?.timeline || []).slice(-5);
  const grouped   = groupedTimeline(sc?.timeline || []).reverse();

  // ── At the crease ──────────────────────────────────────────────────────────
  const striker      = sc?.battingCard?.[sc?.strikerCardIdx];
  const nonStriker    = sc?.battingCard?.[sc?.nonStrikerCardIdx];

  const currentBowler = (() => {
    if (!sc?.bowlingCard?.length) return null;
    if (typeof sc.currentBowlerIdx === "number" && sc.bowlingCard[sc.currentBowlerIdx]) {
      return sc.bowlingCard[sc.currentBowlerIdx];
    }
    const lastBall  = (sc.timeline || [])[(sc.timeline || []).length - 1];
    const bowlerKey = lastBall?.bowler || lastBall?.bowlerName || lastBall?.bowlerId;
    if (bowlerKey) {
      const match = sc.bowlingCard.find((b: any) => b.name === bowlerKey || b.id === bowlerKey);
      if (match) return match;
    }
    return sc.bowlingCard[sc.bowlingCard.length - 1];
  })();

  // ── Batting team awareness ────────────────────────────────────────────────
  // isBattingA/B: currently hitting live balls
  // doneA/B:      has a scorecard but NOT currently batting (completed innings)
  const isBattingA = sc?.battingTeamName === teamA;
  const isBattingB = sc?.battingTeamName === teamB;
  const doneA      = !!scoreA && !isBattingA && !!sc;
  const doneB      = !!scoreB && !isBattingB && !!sc;

  // Current over balls (for the animated dots strip)
  const currentOverBalls = (() => {
    if (!sc || !sc.timeline) return [];
    const tl  = sc.timeline;
    let legal = 0, start = tl.length;
    for (let i = tl.length - 1; i >= 0; i--) {
      const b = tl[i];
      const isLegal = b.label !== "Wd" && b.label !== "Nb" && !String(b.label).startsWith("Wd+") && !String(b.label).startsWith("Nb+");
      if (isLegal) legal++;
      if (legal === 6) { start = i + 1; break; }
      if (i === 0) start = 0;
    }
    return tl.slice(start);
  })();

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        style={s.root}
        contentContainerStyle={{ paddingBottom: 32 }}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Not started ── */}
        {!sc && (
          <View style={s.notStarted}>
            <View style={s.notStartedIcon}><Ionicons name="time-outline" size={28} color={GREEN} /></View>
            <Text style={s.nsTitle}>Match hasn't started yet</Text>
            <Text style={s.nsSub}>
              {match?.date
                ? `Scheduled for ${match.date}${match?.startTime ? " · " + match.startTime : ""}`
                : "Scores appear here once it begins."}
            </Text>
          </View>
        )}

        {/* ── Score card (gradient) ── */}
        {sc && (
          <View style={s.scoreCard}>
            <LinearGradient
              colors={["#242B52", "#3A458A"]}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
              style={s.scoreGrad}
            >
              

              {/* Top row */}
              <View style={s.scoreTop}>
                <View style={s.livePill}>
                  <View style={s.liveDotAnim} />
                  <Text style={s.livePillTxt}>LIVE</Text>
                </View>
                <Text style={s.scoreMeta} numberOfLines={1}>
                  {sc.matchNumber ? `Match ${sc.matchNumber} · ` : ""}{match?.venue || ""}
                </Text>
                {live && <Ionicons name="radio-outline" size={16} color="rgba(255,255,255,.5)" />}
              </View>

              {/* ── Teams row: dynamic batting state ── */}
              <View style={s.teamsRow}>

                {/* Team A */}
              <View style={s.teamSide}>
  <View style={[s.crestBox, { opacity: isBattingA ? 1 : doneA ? 0.6 : 0.4 }]}>
    <Text style={s.crestBoxTxt}>
      {(teamA[0] || "A").toUpperCase()}{(teamA.split(" ")[1]?.[0] || "").toUpperCase()}
    </Text>
  </View>
  <Text style={[s.teamLabel, { opacity: isBattingA ? 0.9 : doneA ? 0.6 : 0.45 }]} numberOfLines={1}>
    {teamA}
  </Text>
  {scoreA
    ? <>
        <Text style={[s.bigScore, { opacity: isBattingA ? 1 : 0.55 }]}>{scoreA.score}</Text>
        <Text style={[s.ovLabel, { opacity: isBattingA ? 0.55 : 0.32 }]}>{scoreA.overs}</Text>
      </>
    : <Text style={[s.ytb, { opacity: 0.4 }]}>Yet to bat</Text>}
</View>

               <View style={s.vsBlock}>
  <Text style={s.vsTxt}>VS</Text>
  {live ? <LiveDividerShimmer /> : <View style={s.vsDivider} />}
</View>

                {/* Team B */}
              <View style={[s.teamSide, { alignItems: "flex-end" }]}>
  <View style={[s.crestBox, { opacity: isBattingB ? 1 : doneB ? 0.6 : 0.4 }]}>
    <Text style={s.crestBoxTxt}>
      {(teamB[0] || "B").toUpperCase()}{(teamB.split(" ")[1]?.[0] || "").toUpperCase()}
    </Text>
  </View>
  <Text style={[s.teamLabel, { textAlign: "right", opacity: isBattingB ? 0.9 : doneB ? 0.6 : 0.45 }]} numberOfLines={1}>
    {teamB}
  </Text>
  {scoreB
    ? <>
        <Text style={[s.bigScore, { opacity: isBattingB ? 1 : 0.55 }]}>{scoreB.score}</Text>
        <Text style={[s.ovLabel, { opacity: isBattingB ? 0.55 : 0.32 }]}>{scoreB.overs}</Text>
      </>
    : <Text style={[s.ytb, { opacity: isBattingB ? 0.9 : 0.4 }]}>Yet to bat</Text>}
</View>
              </View>

              {/* ── Inline ball event popup: below VS, inside card ── */}
              <BallEventInlinePopup event={currentEvent} onDone={clearEvent} />

            </LinearGradient>

            {/* ── This over ball dots ── */}
        

            {/* ── Info bar ── */}
            <View style={s.infoBar}>
              {!!sc.toss && <Text style={s.tossLabel} numberOfLines={1}>{sc.toss}</Text>}
              {completed && !!sc.result && (
                <View style={s.resultBanner}><Text style={s.resultTxt}>{sc.result}</Text></View>
              )}
              {!completed && sc.innings === 2 && sc.target != null && (
                <View style={s.targetRow}>
                  <Text style={s.targetDesc} numberOfLines={1}>
                    {sc.battingTeamName} need {sc.target - sc.runs} runs in {ballsLeft} balls
                  </Text>
                </View>
              )}
            </View>
          </View>
        )}

        {/* ── Live overview strip ── */}
      {sc && !completed && (
  <View style={s.overviewCard}>
    {grouped.length > 0 && (
      <View style={s.oversWrap}>
        <Text style={s.oversWrapTitle}>OVERS</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.oversScrollContent}
        >
          {grouped.map((g, idx) => {
            const overTotal = g.balls.reduce((sum: number, b: any) => sum + (b.runs || 0), 0);
            return (
              <View key={g.overNum} style={[s.overChip, idx === 0 && live && s.overChipCurrent]}>
                <View style={s.overChipHeader}>
                  <Text style={s.overChipNum}>Ov {g.overNum}</Text>
                  <Text style={s.overChipTotal}>{overTotal}</Text>
                </View>
                <View style={s.overChipBalls}>
                  {g.balls.map((b: any, i: number) => (
                    <BallDot key={i} ball={b} size={22} />
                  ))}
                </View>
              </View>
            );
          })}
        </ScrollView>
      </View>
    )}

    <View style={s.ovRow}>
      <View style={s.ovStat}>
        <Text style={s.ovLbl}>CRR</Text>
        <Text style={s.ovVal}>{fixed2(crr)}</Text>
      </View>
      <View style={s.ovDiv} />
      <View style={s.ovStat}>
        <Text style={s.ovLbl}>RRR</Text>
        <Text style={[s.ovVal, { color: RED }]}>{rrr != null ? fixed2(rrr) : "–"}</Text>
      </View>
      <View style={s.ovDiv} />
      <View style={s.ovStat}>
        <Text style={s.ovLbl}>TARGET</Text>
        <Text style={s.ovVal}>{sc.innings === 2 && sc.target != null ? String(sc.target) : "–"}</Text>
      </View>
    </View>
  </View>
)}



        {/* ── Team toggle ── */}
        {sc && (
          <View style={s.toggle}>
            {[teamA, teamB].map((t) => {
              const active  = selected === t;
              const hasInn  = !!inningsFor(t);
              const isBat   = sc?.battingTeamName === t;
              return (
                <TouchableOpacity
                  key={t} style={[s.toggleBtn, active && s.toggleActive]}
                  onPress={() => setSelected(t)} disabled={!hasInn} activeOpacity={0.8}
                >
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                    <Text style={[s.toggleTxt, active && s.toggleTxtActive, !hasInn && { opacity: .4 }]} numberOfLines={1}>
                      {t}
                    </Text>
                    {isBat && live && (
                      <View style={[s.batIndicator, active && { backgroundColor: GREEN }]}>
                        <Text style={[s.batIndicatorTxt, active && { color: "#fff" }]}>BAT</Text>
                      </View>
                    )}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {/* ── Scorecard ── */}
        {sc && innSel && (
          <>
            <View style={s.scorecardCard}>
              <View style={s.subTabBar}>
               {(["current", "batting", "bowling", "partnership"] as ScorecardTab[]).map((k) => {
  const labels: Record<ScorecardTab, string> = {
    current: "Current", batting: "Batting", bowling: "Bowling",
    partnership: "Partnership",
  };
  const active = scorecardTab === k;
  return (
    <TouchableOpacity key={k} style={s.subTabItem} onPress={() => setScorecardTab(k)} activeOpacity={0.7}>
      <Text style={[s.subTabTxt, active && s.subTabTxtActive]}>{labels[k]}</Text>
      {active && <View style={s.subTabLine} />}
    </TouchableOpacity>
  );
})}
              </View>



              {scorecardTab === "current" && (
  <View>
    {/* Batting section */}
    <View style={s.thead}>
      <Text style={s.thName}>BATTING</Text>
      <Text style={s.th}>R</Text><Text style={s.th}>B</Text>
      <Text style={s.th}>4s</Text><Text style={s.th}>6s</Text>
      <Text style={[s.th, { width: 48 }]}>SR</Text>
    </View>

    {[striker, nonStriker].filter(Boolean).length === 0 ? (
      <Text style={s.noData}>No batters at the crease yet.</Text>
    ) : (
      [striker, nonStriker].filter(Boolean).map((b: any, i: number) => {
        const isStriker = b === striker;
        const srVal = b.balls > 0 ? (b.runs / b.balls) * 100 : 0;
        return (
          <View key={i} style={[s.trow, isStriker && s.trowActive]}>
            <View style={s.batLeft}>
              <View style={[s.batAv, isStriker && s.batAvActive]}>
                <Text style={[s.batAvTxt, isStriker && { color: "#fff" }]}>
                  {(b.name || "?").split(" ").map((w: string) => w[0]).slice(0, 2).join("").toUpperCase()}
                </Text>
              </View>
              <View style={{ marginLeft: 10, flex: 1 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                  <Text style={s.batName} numberOfLines={1}>{b.name}</Text>
                  {isStriker && <Text style={s.strikerStar}>★</Text>}
                </View>
                <Text style={s.batOut} numberOfLines={1}>not out</Text>
              </View>
            </View>
            <Text style={[s.td, s.tdBold, isStriker && { color: "#1E2340" }]}>{b.runs}</Text>
            <Text style={s.td}>{b.balls}</Text>
            <Text style={[s.td, b.fours > 0 && { color: "#2563EB", fontWeight: "700" }]}>{b.fours}</Text>
            <Text style={[s.td, b.sixes > 0 && { color: "#7C3AED", fontWeight: "700" }]}>{b.sixes}</Text>
            <Text style={[s.td, { width: 48 }]}>{b.balls > 0 ? fixed2(srVal) : "–"}</Text>
          </View>
        );
      })
    )}

    {/* Bowling section */}
    <View style={[s.thead, { marginTop: 6 }]}>
      <Text style={s.thName}>BOWLING</Text>
      <Text style={s.th}>O</Text><Text style={s.th}>M</Text>
      <Text style={s.th}>R</Text><Text style={s.th}>W</Text>
      <Text style={[s.th, { width: 48 }]}>ECON</Text>
    </View>

    {currentBowler ? (
      <View style={s.trow}>
        <View style={s.batLeft}>
          <View style={s.batAv}>
            <Text style={s.batAvTxt}>
              {(currentBowler.name || "?").split(" ").map((w: string) => w[0]).slice(0, 2).join("").toUpperCase()}
            </Text>
          </View>
          <Text style={[s.batName, { marginLeft: 10, flex: 1 }]} numberOfLines={1}>{currentBowler.name}</Text>
        </View>
        <Text style={s.td}>{oversStr(currentBowler.balls)}</Text>
        <Text style={s.td}>{currentBowler.maidens || 0}</Text>
        <Text style={s.td}>{currentBowler.runs}</Text>
        <Text style={[s.td, s.tdBold, currentBowler.wickets > 0 && { color: RED }]}>{currentBowler.wickets}</Text>
        <Text style={[s.td, { width: 48 }]}>
          {currentBowler.balls > 0 ? fixed2(currentBowler.runs / oversDec(currentBowler.balls)) : "–"}
        </Text>
      </View>
    ) : (
      <Text style={s.noData}>No bowler yet.</Text>
    )}
  </View>
)}

              {/* Batting */}
              {scorecardTab === "batting" && (
                <View>
                  <View style={s.thead}>
                    <Text style={s.thName}>BATTER</Text>
                    <Text style={s.th}>R</Text><Text style={s.th}>B</Text>
                    <Text style={s.th}>4s</Text><Text style={s.th}>6s</Text>
                    <Text style={[s.th, { width: 48 }]}>SR</Text>
                  </View>
                  {innSel.battingCard.length === 0
                    ? <Text style={s.noData}>No batting data yet.</Text>
                    : innSel.battingCard.map((b: any, i: number) => {
                      const star     = innSel.live && i === innSel.strikerCardIdx;
                      const atCrease = innSel.live && (i === innSel.strikerCardIdx || i === innSel.nonStrikerCardIdx);
                      const srVal    = b.balls > 0 ? (b.runs / b.balls) * 100 : 0;
                      return (
                        <View key={i} style={[s.trow, star && s.trowActive]}>
                          <View style={s.batLeft}>
                            <View style={[s.batAv, star && s.batAvActive]}>
                              <Text style={[s.batAvTxt, star && { color: "#fff" }]}>
                                {(b.name || "?").split(" ").map((w: string) => w[0]).slice(0, 2).join("").toUpperCase()}
                              </Text>
                            </View>
                            <View style={{ marginLeft: 10, flex: 1 }}>
                              <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                                <Text style={s.batName} numberOfLines={1}>{b.name}</Text>
                                {star && <Text style={s.strikerStar}>★</Text>}
                              
                              </View>
                              <Text style={s.batOut} numberOfLines={1}>
                                {b.out ? b.dismissal || "out" : atCrease ? "not out" : "did not bat"}
                              </Text>
                            </View>
                          </View>
                          <Text style={[s.td, s.tdBold, star && { color: "#1E2340" }]}>{b.runs}</Text>
                          <Text style={s.td}>{b.balls}</Text>
                          <Text style={[s.td, b.fours > 0 && { color: "#2563EB", fontWeight: "700" }]}>{b.fours}</Text>
                          <Text style={[s.td, b.sixes > 0 && { color: "#7C3AED", fontWeight: "700" }]}>{b.sixes}</Text>
                          <Text style={[s.td, { width: 48 }]}>{b.balls > 0 ? fixed2(srVal) : "–"}</Text>
                        </View>
                      );
                    })}
                  <View style={s.extrasRow}>
                    <Text style={s.extrasLbl}>Extras</Text>
                    <Text style={s.extrasVal}>
                      {(innSel.extras.byes || 0) + (innSel.extras.legbyes || 0) + (innSel.extras.wides || 0) + (innSel.extras.noballs || 0)}
                      {"  "}(b {innSel.extras.byes || 0}, lb {innSel.extras.legbyes || 0}, w {innSel.extras.wides || 0}, nb {innSel.extras.noballs || 0})
                    </Text>
                  </View>
                  <View style={s.totalRow}>
                    <Text style={s.totalLbl}>Total</Text>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
                      <Text style={s.totalScore}>{innSel.runs}/{innSel.wickets} ({oversStr(innSel.balls)})</Text>
                      {innSel.live && <Text style={s.totalCrr}>CRR {fixed2(crr)}</Text>}
                    </View>
                  </View>
                </View>
              )}

              {/* Bowling */}
              {scorecardTab === "bowling" && (
                <View>
                  <View style={s.thead}>
                    <Text style={s.thName}>BOWLER</Text>
                    <Text style={s.th}>O</Text><Text style={s.th}>M</Text>
                    <Text style={s.th}>R</Text><Text style={s.th}>W</Text>
                    <Text style={[s.th, { width: 48 }]}>ECON</Text>
                  </View>
                  {innSel.bowlingCard.length === 0
                    ? <Text style={s.noData}>No bowling data yet.</Text>
                    : innSel.bowlingCard.map((b: any, i: number) => {
                      const econ = b.balls > 0 ? b.runs / oversDec(b.balls) : 0;
                      return (
                        <View key={i} style={s.trow}>
                          <View style={s.batLeft}>
                            <View style={s.batAv}>
                              <Text style={s.batAvTxt}>
                                {(b.name || "?").split(" ").map((w: string) => w[0]).slice(0, 2).join("").toUpperCase()}
                              </Text>
                            </View>
                            <Text style={[s.batName, { marginLeft: 10, flex: 1 }]} numberOfLines={1}>{b.name}</Text>
                          </View>
                          <Text style={s.td}>{oversStr(b.balls)}</Text>
                          <Text style={s.td}>{b.maidens || 0}</Text>
                          <Text style={s.td}>{b.runs}</Text>
                          <Text style={[s.td, s.tdBold, b.wickets > 0 && { color: RED }]}>{b.wickets}</Text>
                          <Text style={[s.td, { width: 48 }]}>{b.balls > 0 ? fixed2(econ) : "–"}</Text>
                        </View>
                      );
                    })}
                </View>
              )}

            {scorecardTab === "partnership" && (
  <View style={s.stub}>
    <Ionicons name="construct-outline" size={22} color={MUTED} />
    <Text style={s.stubTxt}>Partnerships coming soon.</Text>
  </View>
)}
            </View>

            {/* Recent overs */}
           
          </>
        )}

        {sc && !innSel && (
          <View style={s.stub}>
            <Ionicons name="hourglass-outline" size={22} color={MUTED} />
            <Text style={s.stubTxt}>{selected} hasn't batted yet.</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },

  notStarted:     { alignItems: "center", margin: 14, padding: 32, backgroundColor: "#fff", borderRadius: 20, borderColor: BORDER, borderWidth: 1, gap: 10 },
  notStartedIcon: { width: 60, height: 60, borderRadius: 30, backgroundColor: GREEN + "14", alignItems: "center", justifyContent: "center" },
  nsTitle:        { fontSize: 16, fontWeight: "700", color: DARK },
  nsSub:          { fontSize: 13, color: MUTED, textAlign: "center", lineHeight: 20 },

  scoreCard: { margin: 14, marginBottom: 10, borderRadius: 20, overflow: "hidden", shadowColor: DARK, shadowOpacity: .18, shadowRadius: 20, shadowOffset: { width: 0, height: 8 }, elevation: 5 },
  scoreGrad: { padding: 15, paddingBottom: 14, position: "relative", overflow: "hidden" },
  

  scoreTop:    { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 16, position: "relative" },
  livePill:    { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "rgba(225,29,42,.22)", borderWidth: 1, borderColor: "rgba(225,29,42,.5)", paddingHorizontal: 9, paddingVertical: 3, borderRadius: 7 },
  liveDotAnim: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#ff4d4d" },
  livePillTxt: { fontSize: 9, fontWeight: "800", color: "#ff8080", letterSpacing: .6 },
  scoreMeta:   { flex: 1, fontSize: 11.5, color: "rgba(255,255,255,.55)", fontWeight: "500" },

  teamsRow: { flexDirection: "row", alignItems: "flex-start" },
  teamSide: { flex: 1, gap: 7 },

  // Crest box — border color controlled inline per batting state
 crestBox: {
  width: 50, height: 50, borderRadius: 14,
  borderWidth: 1.5, borderColor: "rgba(255,255,255,.16)",
  backgroundColor: "rgba(255,255,255,.09)",
  alignItems: "center", justifyContent: "center",
},
  crestBoxTxt: { fontSize: 15, fontWeight: "800", color: "#fff" },

  // BAT badge below the crest (currently batting indicator)
  batBadge:    { backgroundColor: GREEN, borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2, alignSelf: "flex-start" },
  batBadgeTxt: { fontSize: 8, fontWeight: "800", color: "#fff", letterSpacing: 0.4 },

  teamLabel: { fontSize: 12, fontWeight: "700", color: "rgba(255,255,255,.8)" },
  bigScore:  { fontSize: 24, fontWeight: "900", color: "#fff", letterSpacing: -.5 },
  ovLabel:   { fontSize: 11, color: "rgba(255,255,255,.5)", fontWeight: "500" },
  ytb:       { fontSize: 13, fontWeight: "600", color: "rgba(255,255,255,.45)" },
  vsBlock:   { width: 52, alignItems: "center", gap: 6, paddingTop: 14 },
  vsTxt:     { fontSize: 12, fontWeight: "800", color: "rgba(255,255,255,.35)" },
  vsDivider: { width: 28, height: 1.5, backgroundColor: "rgba(255,255,255,.15)" },

  // This over dots bar
  overDotsBar:   { backgroundColor: "rgba(255,255,255,0.06)", paddingHorizontal: 15, paddingVertical: 10 },
  overDots:      { flexDirection: "row", gap: 6, marginTop: 6 },
  overDotsLabel: { fontSize: 10, fontWeight: "700", color: "rgba(255,255,255,0.4)", letterSpacing: 0.5 },
  emptyDot:      { width: 30, height: 30, borderRadius: 15, backgroundColor: "rgba(255,255,255,0.08)", borderWidth: 1, borderColor: "rgba(255,255,255,0.12)" },

  infoBar:      { backgroundColor: "#fff", padding: 12, paddingHorizontal: 16 },
  tossLabel:    { fontSize: 12, color: MUTED, fontWeight: "500" },
  resultBanner: { backgroundColor: "#F0FDF4", borderRadius: 10, padding: 10, alignItems: "center" },
  resultTxt:    { fontSize: 13, fontWeight: "700", color: "#15803D" },
  targetRow:    { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  targetDesc:   { flex: 1, fontSize: 12, color: MEDIUM, fontWeight: "500" },

  overviewCard: { marginHorizontal: 14, marginBottom: 10, backgroundColor: "#fff", borderRadius: 16, borderColor: BORDER, borderWidth: 1, padding: 14 },
  ovRow:  { flexDirection: "row", alignItems: "flex-start" },
  ovStat: { flex: 1, alignItems: "center", gap: 4 },
  ovLbl:  { fontSize: 9.5, color: MUTED, fontWeight: "700", letterSpacing: .3 },
  ovVal:  { fontSize: 20, fontWeight: "800", color: DARK },
  ovDiv:  { width: 1, backgroundColor: BORDER, alignSelf: "stretch", marginHorizontal: 6, marginTop: 4 },
  last5Row:  { flexDirection: "row", gap: 4, marginTop: 4, flexWrap: "wrap", justifyContent: "center" },
  last5Pill: { width: 28, height: 28, borderRadius: 14, backgroundColor: BG, alignItems: "center", justifyContent: "center" },
  last5Txt:  { fontSize: 11, fontWeight: "700", color: MEDIUM },

  // Team toggle — pill style, now with inline BAT indicator
  toggle:        { flexDirection: "row", backgroundColor: "#DDE0EC", borderRadius: 14, padding: 4, marginHorizontal: 14, marginTop: 4, marginBottom: 10 },
  toggleBtn:     { flex: 1, paddingVertical: 11, borderRadius: 10, alignItems: "center" },
  toggleActive:  { backgroundColor: "#fff", shadowColor: DARK, shadowOpacity: .1, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  toggleTxt:     { fontSize: 13, fontWeight: "700", color: MUTED },
  toggleTxtActive: { color: DARK, fontWeight: "800" },
  batIndicator:    { backgroundColor: "rgba(22,163,74,0.15)", borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 },
  batIndicatorTxt: { fontSize: 8, fontWeight: "800", color: GREEN },

  scorecardCard: { marginHorizontal: 14, marginBottom: 0, backgroundColor: "#fff", borderRadius: 16, borderColor: BORDER, borderWidth: 1, overflow: "hidden" },
  subTabBar:     { flexDirection: "row", borderBottomColor: "#F0F2F8", borderBottomWidth: 1 },
  subTabItem:    { flex: 1, alignItems: "center", paddingTop: 13, position: "relative" },
  subTabTxt:     { fontSize: 11.5, fontWeight: "600", color: MUTED, marginBottom: 10 },
  subTabTxtActive: { fontWeight: "800", color: DARK },
  subTabLine:    { position: "absolute", bottom: 0, left: 4, right: 4, height: 2, backgroundColor: GREEN, borderRadius: 2 },

  thead:  { flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 9, backgroundColor: "#F7F8FC", borderBottomColor: "#F0F2F8", borderBottomWidth: 1 },
  thName: { flex: 1, fontSize: 9.5, fontWeight: "700", color: MUTED, letterSpacing: .4 },
  th:     { width: 36, textAlign: "center", fontSize: 9.5, fontWeight: "700", color: MUTED, letterSpacing: .4 },
  trow:   { flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 12, borderBottomColor: "#F7F8FC", borderBottomWidth: 1 },
  trowActive:  { backgroundColor: "#F0FDF4" },
  batLeft:     { flex: 1, flexDirection: "row", alignItems: "center", paddingRight: 8, minWidth: 0 },
  batAv:       { width: 34, height: 34, borderRadius: 17, backgroundColor: BG, borderWidth: 1.5, borderColor: BORDER, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  batAvActive: { backgroundColor: "#242B52", borderColor: "#3A458A" },
  batAvTxt:    { fontSize: 10, fontWeight: "700", color: MUTED },
  batName:     { fontSize: 13, fontWeight: "700", color: DARK },
  batOut:      { fontSize: 10.5, color: MUTED, marginTop: 2 },
  strikerStar: { fontSize: 12, color: GREEN, fontWeight: "800" },
  sixBadge:    { fontSize: 10, fontWeight: "800", color: "#fff", backgroundColor: "#7C3AED", borderRadius: 6, paddingHorizontal: 5, paddingVertical: 1 },
  fourBadge:   { fontSize: 10, fontWeight: "800", color: "#fff", backgroundColor: "#2563EB", borderRadius: 6, paddingHorizontal: 5, paddingVertical: 1 },
  td:     { width: 36, textAlign: "center", fontSize: 12.5, color: MEDIUM },
  tdBold: { fontWeight: "800", color: DARK },
  noData: { fontSize: 13, color: MUTED, paddingVertical: 20, textAlign: "center" },

  extrasRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 14, paddingVertical: 12, borderTopColor: "#F0F2F8", borderTopWidth: 1 },
  extrasLbl: { fontSize: 12.5, color: MEDIUM, fontWeight: "600" },
  extrasVal: { fontSize: 11, color: MUTED },
  totalRow:  { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 14, paddingVertical: 13, backgroundColor: "#F4F6FB" },
  totalLbl:  { fontSize: 15, fontWeight: "800", color: DARK },
  totalScore:{ fontSize: 15, fontWeight: "800", color: DARK },
  totalCrr:  { fontSize: 12, fontWeight: "600", color: MUTED },

  recentCard: { marginHorizontal: 14, marginTop: 10, marginBottom: 0, backgroundColor: "#fff", borderRadius: 16, borderColor: BORDER, borderWidth: 1, padding: 14 },
  cardTitle:  { fontSize: 14, fontWeight: "800", color: DARK, marginBottom: 12 },
  overRow:    { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 },
  overNum:    { width: 30, fontSize: 11, fontWeight: "700", color: MUTED },
  ballsRow:   { flex: 1, flexDirection: "row", gap: 5, flexWrap: "wrap" },
  overTotal:  { width: 22, fontSize: 12, fontWeight: "800", color: MEDIUM, textAlign: "right" },

  stub:    { alignItems: "center", gap: 8, paddingVertical: 40, backgroundColor: "#fff", borderRadius: 16, margin: 14, borderColor: BORDER, borderWidth: 1 },
  stubTxt: { fontSize: 13, color: MUTED },

  eventPopupWrap: {
  position: "absolute",
  top: 95,        // sits right under the VS divider — nudge a few px if it's slightly off on your device
  left: 0,
  right: 0,
  alignItems: "center",
  zIndex: 20,
  elevation: 20,
},
eventPopupBox: {
  flexDirection: "row",
  alignItems: "center",
  gap: 8,
  maxWidth: 180,
  borderWidth: 1,
  borderRadius: 12,
  paddingVertical: 10,
  paddingHorizontal: 12,
},
eventPopupEmoji: { fontSize: 16 },
eventPopupTxt:   { fontSize: 15, fontWeight: "900", letterSpacing: -0.3 },
eventPopupSub:   { fontSize: 9, fontWeight: "600", opacity: 0.85, marginTop: 1 },

vsDividerTrack: {
  height: 1.9,
  borderRadius: 1,
  backgroundColor: "rgba(255,255,255,.15)",
  overflow: "hidden",
},
vsDividerShimmer: {
  position: "absolute",
  top: 0,
  left: 0,
  height: "100%",
},
oversWrap: {
  marginBottom: 14,
  paddingBottom: 14,
  borderBottomWidth: 1,
  borderBottomColor: BORDER,
},
oversWrapTitle: {
  fontSize: 9.5,
  fontWeight: "700",
  color: MUTED,
  letterSpacing: 0.3,
  marginBottom: 10,
},
oversScrollContent: {
  gap: 10,
  paddingRight: 4,
},
overChip: {
  backgroundColor: BG,
  borderRadius: 12,
  borderWidth: 1,
  borderColor: BORDER,
  padding: 10,
  minWidth: 118,
},
overChipCurrent: {
  borderColor: GREEN,
  backgroundColor: "#F0FDF4",
},
overChipHeader: {
  flexDirection: "row",
  justifyContent: "space-between",
  alignItems: "center",
  marginBottom: 8,
},
overChipNum: {
  fontSize: 11,
  fontWeight: "800",
  color: MEDIUM,
},
overChipTotal: {
  fontSize: 13,
  fontWeight: "900",
  color: DARK,
},
overChipBalls: {
  flexDirection: "row",
  gap: 4,
  flexWrap: "wrap",
},


});

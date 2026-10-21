import {
  View, Text, TextInput, StyleSheet, ScrollView,
  TouchableOpacity, SafeAreaView, StatusBar, Platform,
  ActivityIndicator, Alert, useWindowDimensions,
} from "react-native";
import { useEffect, useRef, useState, useCallback } from "react";
import { db } from "../../../firebaseConfig";
import { doc, getDoc, setDoc, updateDoc, serverTimestamp } from "firebase/firestore";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";

// =============================================================================
// 🏏 LIVE CRICKET SCORER  v3 — redesigned
//
// Design changes from v2:
//   • Full dark theme throughout (bg #0F1526) — easier in sunlight
//   • Scoreboard: CRR / RRR / Target inline; ball dots inside scoreboard
//   • Run pad: 56px tall buttons, color-coded (0=dim, 1/2/3=blue, 4=navy, 6=purple)
//   • WICKET: big red full-width button
//   • Laptop: left info panel + right scoring pad layout
//   • Setup: dark card sections with quick-pick player chips
//
// PATCH (quick-match support): quick matches (hosted via "Host a Match") have
// teamAId/teamBId = null — there's no leagueTeams doc to fetch a roster from.
// This scorer now falls back to safe placeholder ids ("teamA"/"teamB") so the
// team-picker, player-suggestion lookups, and score persistence all keep
// working identically whether the match belongs to a league or is standalone.
// =============================================================================

const MAX_W   = 760;
const BG      = "#0F1526";
const CARD_BG = "#141d35";
const SURFACE = "#1C2740";
const GREEN   = "#16A34A";
const RED     = "#DC2626";
const AMBER   = "#D97706";
const BORDER  = "rgba(255,255,255,0.08)";

// ── Types (unchanged) ─────────────────────────────────────────────────────────
type BatCard  = { name: string; runs: number; balls: number; fours: number; sixes: number; out: boolean; dismissal: string };
type BowlCard = { name: string; balls: number; runs: number; wickets: number; maidens: number };
type Ball     = { label: string; runs: number; w: boolean; boundary: boolean };
type InningsSnap = { teamName: string; runs: number; wickets: number; balls: number; extras: any; battingCard: BatCard[]; bowlingCard: BowlCard[]; timeline: Ball[] };

type ScoreState = {
  oversLimit: number;
  status: "setup" | "live" | "innings_break" | "completed";
  innings: 1 | 2;
  battingTeamId: string;  battingTeamName: string;
  bowlingTeamId: string;  bowlingTeamName: string;
  runs: number; wickets: number; balls: number;
  extras: { wides: number; noballs: number; byes: number; legbyes: number };
  battingCard: BatCard[];
  bowlingCard: BowlCard[];
  strikerCardIdx: number; nonStrikerCardIdx: number;
  currentBowlerIdx: number; bowlerOverConceded: number;
  timeline: Ball[];
  toss: string;
  target: number | null;
  innings1: InningsSnap | null;
  result: string | null;
  maxWickets: number;
  pendingBatsman: boolean; pendingBowler: boolean;
};

// ── Helpers ───────────────────────────────────────────────────────────────────
const clone    = <T,>(o: T): T => JSON.parse(JSON.stringify(o, (_, v) => v === undefined ? null : v));
const oversStr = (b: number)  => `${Math.floor((b || 0) / 6)}.${(b || 0) % 6}`;
const srFmt    = (r: number, b: number) => b === 0 ? "—" : ((r / b) * 100).toFixed(1);
const econFmt  = (r: number, b: number) => b === 0 ? "—" : ((r / b) * 6).toFixed(1);
const crrFmt   = (r: number, b: number) => b === 0 ? "—" : ((r * 6) / b).toFixed(2);
const newBat   = (n: string): BatCard  => ({ name: n, runs: 0, balls: 0, fours: 0, sixes: 0, out: false, dismissal: "" });
const newBowl  = (n: string): BowlCard => ({ name: n, balls: 0, runs: 0, wickets: 0, maidens: 0 });

// ── Ball dot ──────────────────────────────────────────────────────────────────
function BallDot({ ball, size = 22 }: { ball: Ball; size?: number }) {
  const isW   = ball.w;
  const isSix = ball.runs === 6 && ball.boundary;
  const isFour= ball.runs === 4 && ball.boundary;
  const isWd  = ball.label === "Wd" || ball.label.startsWith("Wd+");
  const isNb  = ball.label === "Nb" || ball.label.startsWith("Nb+");
  const bg = isW ? RED : isSix ? "#7C3AED" : isFour ? "#2563EB" : isWd || isNb ? "#D97706" : ball.runs === 0 ? SURFACE : GREEN;
  const tc = ball.runs === 0 && !isW ? "rgba(255,255,255,0.4)" : "#fff";
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: BORDER }}>
      <Text style={{ fontSize: size * 0.42, fontWeight: "800", color: tc }}>{isW ? "W" : isSix ? "6" : isFour ? "4" : isNb ? "nb" : isWd ? "wd" : ball.label}</Text>
    </View>
  );
}

// ── Over timeline ─────────────────────────────────────────────────────────────
function OverTimeline({ timeline }: { timeline: Ball[] }) {
  if (!timeline?.length) return null;
  const overs: Ball[][] = [];
  let cur: Ball[] = [], legal = 0;
  for (const b of timeline) {
    cur.push(b);
    const isLegal = b.label !== "Wd" && b.label !== "Nb" && !b.label.startsWith("Wd+") && !b.label.startsWith("Nb+");
    if (isLegal) { legal++; if (legal % 6 === 0) { overs.push(cur); cur = []; } }
  }
  if (cur.length) overs.push(cur);
  const shown = overs.slice(-3);
  return (
    <View style={tl.wrap}>
      {shown.map((over, oi) => (
        <View key={oi} style={tl.row}>
          <Text style={tl.label}>{overs.length - shown.length + oi + 1 === overs.length ? "This" : `Ov ${overs.length - shown.length + oi}`}</Text>
          <View style={tl.balls}>{over.map((b, bi) => <BallDot key={bi} ball={b} size={22} />)}</View>
        </View>
      ))}
    </View>
  );
}
const tl = StyleSheet.create({
  wrap:  { paddingHorizontal: 12, paddingVertical: 8 },
  row:   { flexDirection: "row", alignItems: "center", gap: 7, marginBottom: 6 },
  label: { fontSize: 10, fontWeight: "700", color: "rgba(255,255,255,0.3)", width: 36, textAlign: "right" },
  balls: { flexDirection: "row", gap: 4, flexWrap: "wrap" },
});

// ── PendingPrompt ─────────────────────────────────────────────────────────────
function PendingPrompt({ title, icon, iconColor, players, value, onChange, onSubmit, cta, onUndo }: {
  title: string; icon: keyof typeof Ionicons.glyphMap; iconColor: string;
  players: string[]; value: string; onChange: (v: string) => void;
  onSubmit: () => void; cta: string; onUndo: () => void;
}) {
  return (
    <View style={pp.card}>
      <View style={pp.titleRow}>
        <View style={[pp.iconWrap, { backgroundColor: iconColor + "22" }]}>
          <Ionicons name={icon} size={18} color={iconColor} />
        </View>
        <Text style={[pp.title, { color: iconColor }]}>{title}</Text>
        <TouchableOpacity onPress={onUndo} style={pp.undoBtn}>
          <Ionicons name="arrow-undo" size={16} color="rgba(255,255,255,0.5)" />
          <Text style={pp.undoTxt}>Undo</Text>
        </TouchableOpacity>
      </View>
      <TextInput
        style={pp.input} value={value} onChangeText={onChange}
        placeholder="Type or pick below" placeholderTextColor="rgba(255,255,255,0.25)"
        autoFocus autoCapitalize="words"
      />
      {players.length > 0 && (
        <View style={pp.chips}>
          {players.map(p => (
            <TouchableOpacity key={p} style={[pp.chip, value === p && pp.chipActive]} onPress={() => onChange(p)} activeOpacity={0.75}>
              <Text style={[pp.chipTxt, value === p && pp.chipTxtActive]}>{p}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
      <TouchableOpacity style={pp.submitBtn} onPress={onSubmit}>
        <Ionicons name="checkmark-circle-outline" size={18} color="#fff" />
        <Text style={pp.submitTxt}>{cta}</Text>
      </TouchableOpacity>
    </View>
  );
}
const pp = StyleSheet.create({
  card:         { backgroundColor: CARD_BG, borderRadius: 16, borderWidth: 1, borderColor: BORDER, padding: 14, marginHorizontal: 12, marginBottom: 10 },
  titleRow:     { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 },
  iconWrap:     { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  title:        { fontSize: 14, fontWeight: "800", flex: 1 },
  undoBtn:      { flexDirection: "row", alignItems: "center", gap: 4, padding: 6 },
  undoTxt:      { fontSize: 11, fontWeight: "700", color: "rgba(255,255,255,0.5)" },
  input:        { backgroundColor: SURFACE, borderColor: BORDER, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: Platform.OS === "android" ? 9 : 12, fontSize: 14, color: "#fff" },
  chips:        { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
  chip:         { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 18, backgroundColor: SURFACE, borderColor: BORDER, borderWidth: 1 },
  chipActive:   { backgroundColor: GREEN, borderColor: GREEN },
  chipTxt:      { fontSize: 12, fontWeight: "600", color: "rgba(255,255,255,0.6)" },
  chipTxtActive:{ color: "#fff" },
  submitBtn:    { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: GREEN, borderRadius: 12, paddingVertical: 13, marginTop: 12 },
  submitTxt:    { color: "#fff", fontSize: 14, fontWeight: "800" },
});

// ── BattingCard / BowlingCard tables ──────────────────────────────────────────
function BattingCard({ card, title }: { card: BatCard[]; title: string }) {
  if (!card?.length) return null;
  return (
    <View style={sc2.wrap}>
      <Text style={sc2.title}>{title}</Text>
      <View style={sc2.card}>
        <View style={[sc2.row, sc2.header]}><Text style={[sc2.cell, sc2.name, sc2.hTxt]}>Batsman</Text><Text style={[sc2.cell, sc2.hTxt]}>R</Text><Text style={[sc2.cell, sc2.hTxt]}>B</Text><Text style={[sc2.cell, sc2.hTxt]}>4s</Text><Text style={[sc2.cell, sc2.hTxt]}>6s</Text><Text style={[sc2.cell, sc2.hTxt]}>SR</Text></View>
        {card.map((b, i) => (
          <View key={i} style={[sc2.row, i < card.length - 1 && sc2.rowBorder]}>
            <View style={[sc2.cell, sc2.name]}><Text style={sc2.pName} numberOfLines={1}>{b.name}</Text><Text style={[sc2.dismiss, !b.out && { color: "#4ade80" }]}>{b.out ? b.dismissal || "out" : "not out"}</Text></View>
            <Text style={[sc2.cell, { fontWeight: "800", color: "#fff" }]}>{b.runs}</Text>
            <Text style={sc2.cell}>{b.balls}</Text>
            <Text style={[sc2.cell, b.fours > 0 && { color: "#60a5fa", fontWeight: "700" }]}>{b.fours}</Text>
            <Text style={[sc2.cell, b.sixes > 0 && { color: "#a78bfa", fontWeight: "700" }]}>{b.sixes}</Text>
            <Text style={sc2.cell}>{srFmt(b.runs, b.balls)}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function BowlingCard({ card, title }: { card: BowlCard[]; title: string }) {
  if (!card?.length) return null;
  return (
    <View style={sc2.wrap}>
      <Text style={sc2.title}>{title}</Text>
      <View style={sc2.card}>
        <View style={[sc2.row, sc2.header]}><Text style={[sc2.cell, sc2.name, sc2.hTxt]}>Bowler</Text><Text style={[sc2.cell, sc2.hTxt]}>O</Text><Text style={[sc2.cell, sc2.hTxt]}>M</Text><Text style={[sc2.cell, sc2.hTxt]}>R</Text><Text style={[sc2.cell, sc2.hTxt]}>W</Text><Text style={[sc2.cell, sc2.hTxt]}>Econ</Text></View>
        {card.map((b, i) => (
          <View key={i} style={[sc2.row, i < card.length - 1 && sc2.rowBorder]}>
            <Text style={[sc2.cell, sc2.name, sc2.pName]} numberOfLines={1}>{b.name}</Text>
            <Text style={sc2.cell}>{oversStr(b.balls)}</Text>
            <Text style={sc2.cell}>{b.maidens}</Text>
            <Text style={sc2.cell}>{b.runs}</Text>
            <Text style={[sc2.cell, b.wickets > 0 && { color: "#f87171", fontWeight: "800" }]}>{b.wickets}</Text>
            <Text style={sc2.cell}>{econFmt(b.runs, b.balls)}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}
const sc2 = StyleSheet.create({
  wrap:     { marginHorizontal: 12, marginBottom: 10 },
  title:    { fontSize: 10, fontWeight: "700", color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 },
  card:     { backgroundColor: CARD_BG, borderRadius: 12, borderWidth: 1, borderColor: BORDER, overflow: "hidden" },
  row:      { flexDirection: "row", alignItems: "center", paddingHorizontal: 10, paddingVertical: 9 },
  header:   { backgroundColor: SURFACE },
  rowBorder:{ borderBottomWidth: 1, borderBottomColor: BORDER },
  cell:     { width: 36, textAlign: "center", fontSize: 12, color: "rgba(255,255,255,0.6)" },
  name:     { flex: 1, textAlign: "left" },
  hTxt:     { fontSize: 10, fontWeight: "700", color: "rgba(255,255,255,0.35)" },
  pName:    { fontSize: 13, fontWeight: "700", color: "#fff" },
  dismiss:  { fontSize: 10, color: "rgba(255,255,255,0.4)", marginTop: 1 },
});

// ── NamePick input + chips ────────────────────────────────────────────────────
function NamePick({ label, value, onChange, players }: { label: string; value: string; onChange: (v: string) => void; players: string[] }) {
  return (
    <View style={sp.section}>
      <Text style={sp.secLabel}>{label.toUpperCase()}</Text>
      <TextInput style={sp.input} value={value} onChangeText={onChange} placeholder="Type or pick" placeholderTextColor="rgba(255,255,255,0.25)" autoCapitalize="words" />
      {players.length > 0 && (
        <View style={sp.chips}>
          {players.map(p => (
            <TouchableOpacity key={p} style={[sp.chip, value === p && sp.chipActive]} onPress={() => onChange(p)} activeOpacity={0.75}>
              <Text style={[sp.chipTxt, value === p && { color: "#fff" }]}>{p}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}
const sp = StyleSheet.create({
  section:     { backgroundColor: "rgba(255,255,255,0.04)", borderRadius: 12, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: BORDER },
  secLabel:    { fontSize: 9.5, fontWeight: "700", color: "rgba(255,255,255,0.35)", letterSpacing: 0.4, marginBottom: 8 },
  input:       { backgroundColor: SURFACE, borderColor: BORDER, borderWidth: 1, borderRadius: 9, paddingHorizontal: 12, paddingVertical: Platform.OS === "android" ? 9 : 11, fontSize: 14, color: "#fff" },
  chips:       { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
  chip:        { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 16, backgroundColor: SURFACE, borderColor: BORDER, borderWidth: 1 },
  chipActive:  { backgroundColor: GREEN, borderColor: GREEN },
  chipTxt:     { fontSize: 11, fontWeight: "600", color: "rgba(255,255,255,0.55)" },
});

// ── Main Component ────────────────────────────────────────────────────────────
export default function CricketScorer() {
  const params  = useLocalSearchParams();
  const matchId = (params.matchId ?? params.matchid) as string;
  const router  = useRouter();
  const { width } = useWindowDimensions();
  const isWide  = width >= 900;

  const [loading,     setLoading]     = useState(true);
  const [match,       setMatch]       = useState<any>(null);
  const [teamPlayers, setTeamPlayers] = useState<Record<string, string[]>>({});
  const [sc,          setSc]          = useState<ScoreState | null>(null);

  const historyRef = useRef<string[]>([]);

  const [overs,      setOvers]      = useState("");
  const [firstBatId, setFirstBatId] = useState("");
  const [striker,    setStriker]    = useState("");
  const [nonStriker, setNonStriker] = useState("");
  const [bowlerName, setBowlerName] = useState("");
  const [promptName, setPromptName] = useState("");
  const [showCard,   setShowCard]   = useState(false);
  const [pendingExtra, setPendingExtra] = useState<"noball" | "wide" | null>(null);

  // ── Load ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      if (!matchId) { setLoading(false); return; }
      try {
        const mSnap = await getDoc(doc(db, "leagueMatches", matchId));
        if (!mSnap.exists()) { setLoading(false); return; }
        const m = { id: mSnap.id, ...mSnap.data() } as any;
        setMatch(m);

        // ── Quick-match safe fallback ────────────────────────────────────
        // League matches have real leagueTeams doc ids in teamAId/teamBId.
        // Quick matches (hosted via "Host a Match") have teamAId/teamBId
        // = null, since there's no roster doc to fetch — only fetch rosters
        // when both ids are real, otherwise leave teamPlayers empty so the
        // NamePick inputs just fall back to free typing (no suggestion chips).
        if (m.teamAId && m.teamBId) {
          const [aSnap, bSnap] = await Promise.all([
            getDoc(doc(db, "leagueTeams", m.teamAId)),
            getDoc(doc(db, "leagueTeams", m.teamBId)),
          ]);
          const names = (snap: any) =>
            snap.exists() && Array.isArray(snap.data().players)
              ? snap.data().players.map((p: any) => p.name).filter(Boolean)
              : [];
          setTeamPlayers({ [m.teamAId]: names(aSnap), [m.teamBId]: names(bSnap) });
        } else {
          setTeamPlayers({});
        }

        const sSnap = await getDoc(doc(db, "matchScoring", matchId));
        if (sSnap.exists() && sSnap.data().status && sSnap.data().status !== "setup") {
          setSc(JSON.parse(JSON.stringify(sSnap.data(), (_, v) => v === undefined ? null : v)) as ScoreState);
        }

        // Always resolve to a non-null id so the team-picker below can tell
        // the two teams apart even when this is a quick match.
        setFirstBatId(m.teamAId || "teamA");
      } catch (e) { console.error("scorer load", e); }
      finally { setLoading(false); }
    })();
  }, [matchId]);

  // ── Persist ───────────────────────────────────────────────────────────────
  const persist = useCallback(async (next: ScoreState) => {
    setSc(next);
    if (!matchId || !match) return;
    try {
      await setDoc(doc(db, "matchScoring", matchId), { ...next, leagueId: match.leagueId, matchId, updatedAt: serverTimestamp() }, { merge: true });
      const summary = next.status === "completed" ? next.result || "" : `${next.battingTeamName} ${next.runs}/${next.wickets} (${oversStr(next.balls)})`;
      await updateDoc(doc(db, "leagueMatches", matchId), {
        status: next.status === "completed" ? "completed" : "live",
        liveSummary: summary,
        ...(next.status === "completed" ? { result: next.result } : {}),
      });
    } catch (e) { console.error("persist score", e); }
  }, [matchId, match]);

  const commit = (next: ScoreState) => { if (sc) historyRef.current.push(JSON.stringify(sc)); persist(next); };
  const undo   = () => { const prev = historyRef.current.pop(); if (!prev) { Alert.alert("Nothing to undo"); return; } persist(JSON.parse(prev)); setPromptName(""); setPendingExtra(null); };

  // ── Core helpers ──────────────────────────────────────────────────────────
  const swapIdx = (n: ScoreState) => { const t = n.strikerCardIdx; n.strikerCardIdx = n.nonStrikerCardIdx; n.nonStrikerCardIdx = t; };

  const endInnings = (next: ScoreState) => {
    if (next.innings === 1) {
      next.innings1 = { teamName: next.battingTeamName, runs: next.runs, wickets: next.wickets, balls: next.balls, extras: clone(next.extras), battingCard: clone(next.battingCard), bowlingCard: clone(next.bowlingCard), timeline: clone(next.timeline) };
      next.target = next.runs + 1; next.status = "innings_break";
    } else {
      next.status = "completed";
      if (next.target != null && next.runs >= next.target) { const left = next.maxWickets - next.wickets; next.result = `${next.battingTeamName} won by ${left} wicket${left === 1 ? "" : "s"}`; }
      else if (next.target != null && next.runs === next.target - 1) { next.result = "Match tied"; }
      else { const by = (next.target ?? 1) - 1 - next.runs; next.result = `${next.bowlingTeamName} won by ${by} run${by === 1 ? "" : "s"}`; }
    }
  };

  const overEndChecks = (next: ScoreState, doSwap: boolean) => {
    if (next.balls % 6 === 0 && next.balls > 0) {
      if (next.bowlerOverConceded === 0) next.bowlingCard[next.currentBowlerIdx].maidens += 1;
      next.bowlerOverConceded = 0;
      if (doSwap) swapIdx(next);
      next.pendingBowler = true;
    }
  };

  const afterLegalBall = (next: ScoreState) => {
    if (next.balls >= next.oversLimit * 6 || next.wickets >= next.maxWickets) { endInnings(next); return; }
    overEndChecks(next, true);
  };

  const blocked = () => !sc || sc.status !== "live" || sc.pendingBatsman || sc.pendingBowler;

  // ── Scoring actions ───────────────────────────────────────────────────────
  const addRuns = (n: number) => {
    if (blocked() || !sc) return;
    const next = clone(sc);
    const bat  = next.battingCard[next.strikerCardIdx];
    bat.runs += n; bat.balls += 1;
    if (n === 4) bat.fours += 1;
    if (n === 6) bat.sixes += 1;
    const bowl = next.bowlingCard[next.currentBowlerIdx];
    bowl.runs += n; bowl.balls += 1;
    next.runs += n; next.balls += 1; next.bowlerOverConceded += n;
    next.timeline.push({ label: String(n), runs: n, w: false, boundary: n >= 4 });
    if (n % 2 === 1) swapIdx(next);
    afterLegalBall(next);
    commit(next);
  };

  const noBallRuns = (batRuns: number) => {
    if (!sc) return;
    const next = clone(sc);
    const total = batRuns + 1;
    const bat  = next.battingCard[next.strikerCardIdx];
    bat.runs += batRuns;
    if (batRuns === 4) bat.fours += 1;
    if (batRuns === 6) bat.sixes += 1;
    const bowl = next.bowlingCard[next.currentBowlerIdx];
    bowl.runs += total;
    next.runs += total; next.extras.noballs += 1; next.bowlerOverConceded += total;
    next.timeline.push({ label: batRuns === 0 ? "Nb" : `Nb+${batRuns}`, runs: total, w: false, boundary: batRuns >= 4 });
    if (batRuns % 2 === 1) swapIdx(next);
    commit(next);
  };

  const wideRuns = (overthrows: number) => {
    if (!sc) return;
    const next = clone(sc);
    const total = overthrows + 1;
    const bowl = next.bowlingCard[next.currentBowlerIdx];
    bowl.runs += total;
    next.runs += total; next.extras.wides += 1; next.bowlerOverConceded += total;
    next.timeline.push({ label: overthrows === 0 ? "Wd" : `Wd+${overthrows}`, runs: total, w: false, boundary: false });
    if (overthrows % 2 === 1) swapIdx(next);
    commit(next);
  };

  const extraBye = (kind: "bye" | "legbye") => {
    if (blocked() || !sc) return;
    const next = clone(sc);
    next.runs += 1; next.balls += 1;
    next.battingCard[next.strikerCardIdx].balls += 1;
    next.bowlingCard[next.currentBowlerIdx].balls += 1;
    if (kind === "bye") next.extras.byes += 1; else next.extras.legbyes += 1;
    next.timeline.push({ label: kind === "bye" ? "B" : "Lb", runs: 1, w: false, boundary: false });
    swapIdx(next);
    afterLegalBall(next);
    commit(next);
  };

  const wicket = () => {
    if (blocked() || !sc) return;
    setPendingExtra(null);
    const next = clone(sc);
    const bowl = next.bowlingCard[next.currentBowlerIdx];
    bowl.balls += 1; bowl.wickets += 1;
    const bat = next.battingCard[next.strikerCardIdx];
    bat.balls += 1; bat.out = true; bat.dismissal = `b ${bowl.name}`;
    next.wickets += 1; next.balls += 1;
    next.timeline.push({ label: "W", runs: 0, w: true, boundary: false });
    if (next.balls >= next.oversLimit * 6 || next.wickets >= next.maxWickets) { endInnings(next); commit(next); return; }
    overEndChecks(next, true);
    next.pendingBatsman = true;
    commit(next);
  };

  const swapStrike = () => { if (!sc || sc.status !== "live") return; const next = clone(sc); swapIdx(next); commit(next); };

  const submitNewBatsman = () => {
    if (!promptName.trim() || !sc) { Alert.alert("Name", "Enter the new batsman's name."); return; }
    const next = clone(sc);
    next.battingCard.push(newBat(promptName.trim()));
    next.strikerCardIdx = next.battingCard.length - 1;
    next.pendingBatsman = false;
    setPromptName(""); commit(next);
  };

  const submitNewBowler = () => {
    if (!promptName.trim() || !sc) { Alert.alert("Name", "Enter the next bowler's name."); return; }
    const next = clone(sc);
    const idx = next.bowlingCard.findIndex(b => b.name === promptName.trim());
    if (idx >= 0) next.currentBowlerIdx = idx;
    else { next.bowlingCard.push(newBowl(promptName.trim())); next.currentBowlerIdx = next.bowlingCard.length - 1; }
    next.pendingBowler = false;
    setPromptName(""); commit(next);
  };

  // ── Setup ─────────────────────────────────────────────────────────────────
  // Safe, always-non-null team ids — real leagueTeams doc ids for league
  // matches, or "teamA"/"teamB" placeholders for quick matches. Everything
  // below (picker, name lookup, opposing-team lookup) is built on these
  // instead of the raw match.teamAId/teamBId, which can be null.
  const teamAId = match ? (match.teamAId || "teamA") : "teamA";
  const teamBId = match ? (match.teamBId || "teamB") : "teamB";
  const teamName    = (id: string) => (id === teamAId ? match?.teamAName : match?.teamBName) || "Team";
  const otherTeamId = (id: string) => (!id || !match) ? "" : id === teamAId ? teamBId : teamAId;
  const clearSetup  = () => { setOvers(""); setStriker(""); setNonStriker(""); setBowlerName(""); };

  const startInnings1 = () => {
    const ov = Number(overs);
    if (!ov || ov < 1)                               return Alert.alert("Overs",   "Enter overs per side.");
    if (!firstBatId)                                 return Alert.alert("Team",    "Pick which team bats first.");
    if (!striker.trim() || !nonStriker.trim())       return Alert.alert("Batsmen", "Enter both opening batsmen.");
    if (striker.trim() === nonStriker.trim())        return Alert.alert("Batsmen", "The two batsmen must be different.");
    if (!bowlerName.trim())                          return Alert.alert("Bowler",  "Enter the opening bowler.");
    const bowlId = otherTeamId(firstBatId);
    const maxW   = Math.max(1, (teamPlayers[firstBatId]?.length || 11) - 1);
    const next: ScoreState = {
      oversLimit: ov, status: "live", innings: 1,
      battingTeamId: firstBatId, battingTeamName: teamName(firstBatId),
      bowlingTeamId: bowlId,     bowlingTeamName: teamName(bowlId),
      runs: 0, wickets: 0, balls: 0,
      extras: { wides: 0, noballs: 0, byes: 0, legbyes: 0 },
      battingCard: [newBat(striker.trim()), newBat(nonStriker.trim())],
      bowlingCard: [newBowl(bowlerName.trim())],
      strikerCardIdx: 0, nonStrikerCardIdx: 1, currentBowlerIdx: 0,
      bowlerOverConceded: 0, timeline: [],
      toss: `${teamName(firstBatId)} elected to bat`,
      target: null, innings1: null, result: null, maxWickets: maxW,
      pendingBatsman: false, pendingBowler: false,
    };
    clearSetup(); historyRef.current = []; commit(next);
  };

  const startInnings2 = () => {
    if (!sc) return;
    if (!striker.trim() || !nonStriker.trim())  return Alert.alert("Batsmen", "Enter both opening batsmen.");
    if (striker.trim() === nonStriker.trim())   return Alert.alert("Batsmen", "The two batsmen must be different.");
    if (!bowlerName.trim())                     return Alert.alert("Bowler",  "Enter the opening bowler.");
    const next = clone(sc);
    next.innings = 2; next.status = "live";
    next.battingTeamId   = sc.bowlingTeamId; next.battingTeamName  = sc.bowlingTeamName;
    next.bowlingTeamId   = sc.battingTeamId; next.bowlingTeamName  = sc.battingTeamName;
    next.runs = 0; next.wickets = 0; next.balls = 0;
    next.extras = { wides: 0, noballs: 0, byes: 0, legbyes: 0 };
    next.battingCard = [newBat(striker.trim()), newBat(nonStriker.trim())];
    next.bowlingCard = [newBowl(bowlerName.trim())];
    next.strikerCardIdx = 0; next.nonStrikerCardIdx = 1; next.currentBowlerIdx = 0;
    next.bowlerOverConceded = 0; next.timeline = [];
    next.maxWickets = Math.max(1, (teamPlayers[sc.bowlingTeamId]?.length || 11) - 1);
    next.pendingBatsman = false; next.pendingBowler = false;
    clearSetup(); historyRef.current = []; commit(next);
  };

  // ── Guards ────────────────────────────────────────────────────────────────
  if (loading) return <SafeAreaView style={[s.safe, s.center]}><StatusBar barStyle="light-content" backgroundColor={BG} /><ActivityIndicator color={GREEN} size="large" /></SafeAreaView>;
  if (!match)  return <SafeAreaView style={[s.safe, s.center]}><StatusBar barStyle="light-content" backgroundColor={BG} /><Text style={s.notFound}>Match not found.</Text><TouchableOpacity onPress={() => router.back()} style={{ marginTop: 12 }}><Text style={{ color: GREEN, fontWeight: "700" }}>Go back</Text></TouchableOpacity></SafeAreaView>;

  const stk  = sc ? sc.battingCard[sc.strikerCardIdx]    : null;
  const nstk = sc ? sc.battingCard[sc.nonStrikerCardIdx] : null;
  const blr  = sc ? sc.bowlingCard[sc.currentBowlerIdx]  : null;
  const crr  = sc && sc.balls > 0 ? crrFmt(sc.runs, sc.balls) : "0.00";
  const ballsLeft = sc ? sc.oversLimit * 6 - sc.balls : 0;
  const rrr  = sc && sc.innings === 2 && sc.target != null && ballsLeft > 0
    ? crrFmt((sc.target - sc.runs), ballsLeft) : null;

  // ── Scoring pad (shared between mobile/laptop) ────────────────────────────
  const ScoringPad = ({ wide = false }: { wide?: boolean }) => (
    <View style={wide ? { flex: 1, flexDirection: "column" } : {}}>
      {/* Extra mode banner */}
      {pendingExtra && (
        <View style={[s.extraBanner, pendingExtra === "noball" ? s.extraBannerNb : s.extraBannerWd]}>
          <Ionicons name="alert-circle-outline" size={15} color={pendingExtra === "noball" ? AMBER : "#60a5fa"} />
          <Text style={[s.extraBannerTxt, { color: pendingExtra === "noball" ? "#FCD34D" : "#93C5FD" }]}>
            {pendingExtra === "noball" ? "No Ball — pick runs off bat" : "Wide — any overthrow runs?"}
          </Text>
          <TouchableOpacity onPress={() => setPendingExtra(null)} hitSlop={10}>
            <Ionicons name="close" size={18} color="rgba(255,255,255,0.4)" />
          </TouchableOpacity>
        </View>
      )}

      {/* Run buttons 3×2 grid */}
      <View style={wide ? s.runGridWide : s.runGrid}>
        {[0, 1, 2, 3, 4, 6].map(n => {
          const isNb = pendingExtra === "noball";
          const isWd = pendingExtra === "wide";
          const isBnd = n === 4 || n === 6;
          let bg = SURFACE, tc = n === 0 ? "rgba(255,255,255,0.35)" : "#60a5fa";
          if (n === 4 && !pendingExtra) { bg = "#1D3A8A"; tc = "#60a5fa"; }
          if (n === 6 && !pendingExtra) { bg = "#3B1D8A"; tc = "#a78bfa"; }
          if (isNb)  { bg = "rgba(254,243,199,0.12)"; tc = "#FCD34D"; }
          if (isNb && isBnd) { bg = "#92400E"; tc = "#fff"; }
          if (isWd)  { bg = "rgba(96,165,250,0.12)"; tc = "#93C5FD"; }
          if (isWd && isBnd) { bg = "#1D3A8A"; tc = "#fff"; }
          return (
            <TouchableOpacity
              key={n}
              style={[wide ? s.runBtnWide : s.runBtn, { backgroundColor: bg }]}
              onPress={() => {
                if (pendingExtra === "noball") { noBallRuns(n); setPendingExtra(null); }
                else if (pendingExtra === "wide") { wideRuns(n); setPendingExtra(null); }
                else addRuns(n);
              }}
              activeOpacity={0.65}
            >
              <Text style={[wide ? s.runBtnTxtWide : s.runBtnTxt, { color: tc }]}>{n}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Extras row */}
      <View style={s.extrasRow}>
        <TouchableOpacity style={[s.extraBtn, pendingExtra === "wide" && s.extraBtnWdActive]} onPress={() => setPendingExtra(p => p === "wide" ? null : "wide")} activeOpacity={0.75}>
          <Text style={[s.extraBtnTxt, pendingExtra === "wide" && { color: "#93C5FD" }]}>Wide</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[s.extraBtn, pendingExtra === "noball" && s.extraBtnNbActive]} onPress={() => setPendingExtra(p => p === "noball" ? null : "noball")} activeOpacity={0.75}>
          <Text style={[s.extraBtnTxt, pendingExtra === "noball" && { color: "#FCD34D" }]}>No Ball</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.extraBtn} onPress={() => { setPendingExtra(null); extraBye("bye"); }} activeOpacity={0.75}>
          <Text style={s.extraBtnTxt}>Bye</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.extraBtn} onPress={() => { setPendingExtra(null); extraBye("legbye"); }} activeOpacity={0.75}>
          <Text style={s.extraBtnTxt}>Leg Bye</Text>
        </TouchableOpacity>
      </View>

      {/* Action row */}
      <View style={s.actionRow}>
        <TouchableOpacity style={[s.actionBtn, s.actionWicket]} onPress={wicket} activeOpacity={0.8}>
          <Text style={{ fontSize: 16 }}>🎯</Text>
          <Text style={[s.actionTxt, { color: "#fff" }]}>WICKET</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[s.actionBtn, s.actionSec]} onPress={swapStrike} activeOpacity={0.8}>
          <Ionicons name="swap-horizontal" size={17} color="rgba(255,255,255,0.7)" />
          <Text style={s.actionTxt}>Swap</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[s.actionBtn, s.actionSec]} onPress={undo} activeOpacity={0.8}>
          <Ionicons name="arrow-undo" size={17} color="rgba(255,255,255,0.7)" />
          <Text style={s.actionTxt}>Undo</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  // ── Info panel (left panel on laptop) ────────────────────────────────────
  const InfoPanel = () => (
    <View style={[s.infoPanel, !isWide && { width: "100%" }]}>
      {/* Scoreboard */}
      <LinearGradient colors={["#1B2050", "#0F1526"]} style={s.board}>
        <View style={s.boardDecoCircle} />
        <Text style={s.boardInnings}>{sc!.battingTeamName} · {sc!.innings === 1 ? "1st" : "2nd"} innings</Text>
        <View style={s.boardScoreRow}>
          <Text style={s.boardRuns}>{sc!.runs}</Text>
          <Text style={s.boardWickets}>/{sc!.wickets}</Text>
        </View>
        <Text style={s.boardOvers}>{oversStr(sc!.balls)} / {sc!.oversLimit} overs</Text>
        {sc!.innings === 2 && sc!.target != null && (
          <View style={s.boardNeedRow}>
            <Text style={s.boardNeed}>Need {Math.max(0, sc!.target - sc!.runs)} in {ballsLeft} balls</Text>
          </View>
        )}
        {/* CRR / RRR / TARGET */}
        <View style={s.boardStats}>
          <View style={s.boardStat}><Text style={s.boardStatLbl}>CRR</Text><Text style={[s.boardStatVal, { color: "#4ade80" }]}>{crr}</Text></View>
          {rrr && <><View style={s.boardStatDiv} /><View style={s.boardStat}><Text style={s.boardStatLbl}>RRR</Text><Text style={[s.boardStatVal, { color: "#f87171" }]}>{rrr}</Text></View></>}
          {sc!.innings === 2 && sc!.target != null && <><View style={s.boardStatDiv} /><View style={s.boardStat}><Text style={s.boardStatLbl}>TARGET</Text><Text style={[s.boardStatVal, { color: "#fff" }]}>{sc!.target}</Text></View></>}
        </View>
        {/* This over ball dots */}
        <OverTimeline timeline={sc!.timeline} />
      </LinearGradient>

      {/* Batting + Bowling mini */}
      <View style={s.miniWrap}>
        <View style={s.miniCol}>
          <Text style={s.miniHdr}>BATTING</Text>
          <View style={s.miniRow}><Text style={[s.miniName, { color: "#fff" }]} numberOfLines={1}>{(stk?.name || "—")} ★</Text><Text style={s.miniVal}>{stk?.runs ?? 0} ({stk?.balls ?? 0})</Text></View>
          <View style={s.miniRow}><Text style={s.miniName} numberOfLines={1}>{nstk?.name || "—"}</Text><Text style={s.miniVal}>{nstk?.runs ?? 0} ({nstk?.balls ?? 0})</Text></View>
        </View>
        <View style={s.miniDivider} />
        <View style={s.miniCol}>
          <Text style={s.miniHdr}>BOWLING</Text>
          <View style={s.miniRow}><Text style={[s.miniName, { color: "#fff" }]} numberOfLines={1}>{blr?.name || "—"}</Text><Text style={s.miniVal}>{blr?.wickets ?? 0}/{blr?.runs ?? 0}</Text></View>
          <Text style={s.miniExtras}>Wd {sc!.extras.wides}  Nb {sc!.extras.noballs}  B {sc!.extras.byes}  Lb {sc!.extras.legbyes}</Text>
        </View>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="light-content" backgroundColor={BG} />

      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10} style={s.backBtn}>
          <Ionicons name="chevron-back" size={20} color="rgba(255,255,255,0.7)" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={s.headerTitle} numberOfLines={1}>{match.teamAName} vs {match.teamBName}</Text>
          <Text style={s.headerSub}>Live scoring</Text>
        </View>
        {sc?.status === "live" && (
          <TouchableOpacity style={s.cardToggle} onPress={() => setShowCard(v => !v)}>
            <Ionicons name={showCard ? "list" : "reader-outline"} size={16} color="#4ade80" />
            <Text style={s.cardToggleTxt}>{showCard ? "Pad" : "Scorecard"}</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* On laptop live mode: fixed layout, no scroll */}
      <ScrollView keyboardDismissMode="interactive" automaticallyAdjustKeyboardInsets
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={isWide && sc?.status === "live" ? { flex: 1 } : { paddingBottom: 40 }}
        scrollEnabled={!(isWide && sc?.status === "live")}
      >

        {/* ── SETUP ── */}
        {(!sc || sc.status === "setup") && (
          <View style={s.setupWrap}>
            <Text style={s.setupTitle}>Match Setup</Text>
            <Text style={s.setupSub}>{match.teamAName} vs {match.teamBName}</Text>

            {/* Overs */}
            <View style={sp.section}>
              <Text style={sp.secLabel}>OVERS PER SIDE</Text>
              <TextInput style={sp.input} value={overs} onChangeText={setOvers} placeholder="e.g. 10" placeholderTextColor="rgba(255,255,255,0.25)" keyboardType="number-pad" />
            </View>

            {/* Team bats first */}
            <View style={sp.section}>
              <Text style={sp.secLabel}>BATS FIRST</Text>
              <View style={{ flexDirection: "row", gap: 8 }}>
                {[teamAId, teamBId].map(tid => (
                  <TouchableOpacity key={tid} style={[s.teamPick, firstBatId === tid && s.teamPickActive]} onPress={() => setFirstBatId(tid)} activeOpacity={0.8}>
                    <Text style={[s.teamPickTxt, firstBatId === tid && { color: "#fff" }]}>{teamName(tid)}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <NamePick label="Striker (opener)"      value={striker}    onChange={setStriker}    players={teamPlayers[firstBatId] || []} />
            <NamePick label="Non-striker (opener)"   value={nonStriker} onChange={setNonStriker} players={teamPlayers[firstBatId] || []} />
            <NamePick label="Opening bowler"         value={bowlerName} onChange={setBowlerName} players={firstBatId ? (teamPlayers[otherTeamId(firstBatId)] || []) : []} />

            <TouchableOpacity style={s.primaryBtn} onPress={startInnings1}>
              <Ionicons name="play" size={18} color="#fff" />
              <Text style={s.primaryBtnTxt}>Start 1st Innings</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── INNINGS BREAK ── */}
        {sc?.status === "innings_break" && (
          <View style={s.setupWrap}>
            <LinearGradient colors={["#1B2050", "#0F1526"]} style={s.breakCard}>
              <Text style={s.breakLabel}>Innings Break</Text>
              <Text style={s.breakScore}>{sc.innings1?.teamName}: {sc.innings1?.runs}/{sc.innings1?.wickets} ({oversStr(sc.innings1?.balls || 0)})</Text>
              <View style={s.targetBadge}><Text style={s.targetBadgeTxt}>Target: {sc.target}</Text></View>
            </LinearGradient>
            <Text style={s.setupTitle}>{sc.bowlingTeamName} to chase</Text>
            <NamePick label="Striker"        value={striker}    onChange={setStriker}    players={teamPlayers[sc.bowlingTeamId] || []} />
            <NamePick label="Non-striker"    value={nonStriker} onChange={setNonStriker} players={teamPlayers[sc.bowlingTeamId] || []} />
            <NamePick label="Opening bowler" value={bowlerName} onChange={setBowlerName} players={teamPlayers[sc.battingTeamId] || []} />
            <TouchableOpacity style={s.primaryBtn} onPress={startInnings2}>
              <Ionicons name="play" size={18} color="#fff" />
              <Text style={s.primaryBtnTxt}>Start 2nd Innings</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── RESULT ── */}
        {sc?.status === "completed" && (
          <View style={s.setupWrap}>
            <View style={s.resultCard}>
              <View style={s.trophyWrap}><Ionicons name="trophy" size={36} color="#FCD34D" /></View>
              <Text style={s.resultHeading}>{sc.result}</Text>
              {sc.innings1 && <Text style={s.resultLine}>{sc.innings1.teamName}: {sc.innings1.runs}/{sc.innings1.wickets} ({oversStr(sc.innings1.balls)})</Text>}
              <Text style={s.resultLine}>{sc.battingTeamName}: {sc.runs}/{sc.wickets} ({oversStr(sc.balls)})</Text>
            </View>
            {sc.innings1 && <BattingCard card={sc.innings1.battingCard} title={`${sc.innings1.teamName} — batting`} />}
            {sc.innings1 && <BowlingCard card={sc.innings1.bowlingCard} title="Bowling — 1st innings" />}
            <BattingCard card={sc.battingCard} title={`${sc.battingTeamName} — batting`} />
            <BowlingCard card={sc.bowlingCard} title={`${sc.bowlingTeamName} — bowling`} />
            <TouchableOpacity style={[s.primaryBtn, { marginHorizontal: 12 }]} onPress={() => router.back()}>
              <Text style={s.primaryBtnTxt}>Done</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── LIVE ── */}
        {sc?.status === "live" && (
          isWide ? (
            // LAPTOP: fixed full-height side-by-side — NO inner scroll
            <View style={{ flexDirection: "row", flex: 1 }}>
              <InfoPanel />
              <View style={{ flex: 1, flexDirection: "column", padding: 16, gap: 10 }}>
                {sc.pendingBatsman && <PendingPrompt title="Wicket! New batsman" icon="person-add-outline" iconColor={RED} players={teamPlayers[sc.battingTeamId] || []} value={promptName} onChange={setPromptName} onSubmit={submitNewBatsman} cta="Send batsman in" onUndo={undo} />}
                {sc.pendingBowler && !sc.pendingBatsman && <PendingPrompt title="Over complete — next bowler" icon="swap-horizontal-outline" iconColor={AMBER} players={teamPlayers[sc.bowlingTeamId] || []} value={promptName} onChange={setPromptName} onSubmit={submitNewBowler} cta="Set bowler" onUndo={undo} />}
                {!sc.pendingBatsman && !sc.pendingBowler && (
                  <View style={{ flex: 1, flexDirection: "column", gap: 10 }}>
                    {showCard ? (
                      <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" automaticallyAdjustKeyboardInsets showsVerticalScrollIndicator={false}>
                        <BattingCard card={sc.battingCard} title="Batting" />
                        <BowlingCard card={sc.bowlingCard} title="Bowling" />
                      </ScrollView>
                    ) : <ScoringPad wide />}
                  </View>
                )}
              </View>
            </View>
          ) : (
            // MOBILE: stacked
            <View>
              <InfoPanel />
              {sc.pendingBatsman && <PendingPrompt title="Wicket! New batsman" icon="person-add-outline" iconColor={RED} players={teamPlayers[sc.battingTeamId] || []} value={promptName} onChange={setPromptName} onSubmit={submitNewBatsman} cta="Send batsman in" onUndo={undo} />}
              {sc.pendingBowler && !sc.pendingBatsman && <PendingPrompt title="Over complete — next bowler" icon="swap-horizontal-outline" iconColor={AMBER} players={teamPlayers[sc.bowlingTeamId] || []} value={promptName} onChange={setPromptName} onSubmit={submitNewBowler} cta="Set bowler" onUndo={undo} />}
              {!sc.pendingBatsman && !sc.pendingBowler && (
                showCard
                  ? <><BattingCard card={sc.battingCard} title="Batting" /><BowlingCard card={sc.bowlingCard} title="Bowling" /></>
                  : <View style={{ padding: 12 }}><ScoringPad /></View>
              )}
            </View>
          )
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: BG },
  center: { alignItems: "center", justifyContent: "center" },
  notFound:{ fontSize: 14, color: "rgba(255,255,255,0.5)" },

  // Header
  header:       { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: CARD_BG, paddingHorizontal: 12, paddingTop: Platform.OS === "android" ? (StatusBar.currentHeight || 0) + 8 : 6, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: BORDER },
  backBtn:      { width: 34, height: 34, borderRadius: 9, backgroundColor: SURFACE, alignItems: "center", justifyContent: "center" },
  headerTitle:  { fontSize: 14, fontWeight: "800", color: "#fff" },
  headerSub:    { fontSize: 11, color: "rgba(255,255,255,0.4)", marginTop: 1 },
  cardToggle:   { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: "rgba(22,163,74,0.15)", borderRadius: 18, borderWidth: 1, borderColor: "rgba(74,222,128,0.25)" },
  cardToggleTxt:{ fontSize: 11, fontWeight: "700", color: "#4ade80" },

  // Setup
  setupWrap:    { padding: 12 },
  setupTitle:   { fontSize: 20, fontWeight: "900", color: "#fff", marginBottom: 4, letterSpacing: -0.5 },
  setupSub:     { fontSize: 12, color: "rgba(255,255,255,0.4)", marginBottom: 14 },
  teamPick:     { flex: 1, alignItems: "center", paddingVertical: 12, borderRadius: 10, borderColor: BORDER, borderWidth: 1, backgroundColor: SURFACE },
  teamPickActive:{ borderColor: GREEN, backgroundColor: GREEN },
  teamPickTxt:  { fontSize: 13, fontWeight: "700", color: "rgba(255,255,255,0.5)" },
  primaryBtn:   { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: GREEN, paddingVertical: 14, borderRadius: 12, marginTop: 12 },
  primaryBtnTxt:{ color: "#fff", fontSize: 15, fontWeight: "700" },

  // Innings break
  breakCard:    { borderRadius: 16, padding: 20, alignItems: "center", marginBottom: 14, overflow: "hidden" },
  breakLabel:   { fontSize: 11, fontWeight: "700", color: "rgba(255,255,255,0.45)", textTransform: "uppercase", letterSpacing: 1 },
  breakScore:   { fontSize: 20, fontWeight: "800", color: "#fff", marginTop: 6 },
  targetBadge:  { backgroundColor: GREEN, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 5, marginTop: 10 },
  targetBadgeTxt:{ color: "#fff", fontWeight: "800", fontSize: 14 },

  // Result
  resultCard:   { backgroundColor: CARD_BG, borderRadius: 18, borderWidth: 1, borderColor: BORDER, padding: 24, alignItems: "center", gap: 8, marginBottom: 14 },
  trophyWrap:   { width: 64, height: 64, borderRadius: 32, backgroundColor: "rgba(252,211,77,0.12)", alignItems: "center", justifyContent: "center", marginBottom: 4 },
  resultHeading:{ fontSize: 18, fontWeight: "800", color: "#FCD34D", textAlign: "center" },
  resultLine:   { fontSize: 13, color: "rgba(255,255,255,0.6)" },

  // Info panel (scoreboard)
  infoPanel:    { width: 310, backgroundColor: CARD_BG, borderRightWidth: 1, borderRightColor: BORDER, flexShrink: 0 },
  board:        { padding: 14, paddingBottom: 8, position: "relative", overflow: "hidden" },
  boardDecoCircle:{ position: "absolute", top: -30, right: -30, width: 110, height: 110, borderRadius: 55, backgroundColor: "rgba(255,255,255,0.04)" },
  boardInnings: { fontSize: 9.5, fontWeight: "700", color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 6 },
  boardScoreRow:{ flexDirection: "row", alignItems: "baseline", gap: 3 },
  boardRuns:    { fontSize: 52, fontWeight: "900", color: "#fff", letterSpacing: -2, lineHeight: 56 },
  boardWickets: { fontSize: 26, fontWeight: "700", color: "rgba(255,255,255,0.4)" },
  boardOvers:   { fontSize: 13, color: "rgba(255,255,255,0.5)", marginTop: 2, marginBottom: 6 },
  boardNeedRow: { backgroundColor: "rgba(22,163,74,0.15)", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, marginBottom: 8, alignSelf: "flex-start" },
  boardNeed:    { fontSize: 11, fontWeight: "700", color: "#4ade80" },
  boardStats:   { flexDirection: "row", backgroundColor: "rgba(0,0,0,0.2)", borderRadius: 10, padding: 8, marginBottom: 6, gap: 0 },
  boardStat:    { flex: 1, alignItems: "center" },
  boardStatLbl: { fontSize: 8, color: "rgba(255,255,255,0.35)", fontWeight: "700", marginBottom: 2 },
  boardStatVal: { fontSize: 13, fontWeight: "800" },
  boardStatDiv: { width: 1, backgroundColor: BORDER, marginHorizontal: 4, alignSelf: "stretch" },

  // Mini batting/bowling
  miniWrap:     { flexDirection: "row", borderTopWidth: 1, borderTopColor: BORDER },
  miniCol:      { flex: 1, padding: 10 },
  miniDivider:  { width: 1, backgroundColor: BORDER },
  miniHdr:      { fontSize: 8.5, fontWeight: "700", color: "rgba(255,255,255,0.35)", letterSpacing: 0.4, marginBottom: 7 },
  miniRow:      { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 5 },
  miniName:     { fontSize: 12, color: "rgba(255,255,255,0.55)", flex: 1, marginRight: 6 },
  miniVal:      { fontSize: 12, fontWeight: "700", color: "#fff" },
  miniExtras:   { fontSize: 9.5, color: "rgba(255,255,255,0.3)", marginTop: 2 },

  // Run pad
  runGrid:      { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 8 },
  runGridWide:  { flex: 1, flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 10 },
  runBtn:       { width: "30.5%", height: 56, borderRadius: 13, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: BORDER },
  runBtnWide:   { flexBasis: "30.5%", flexGrow: 1, minHeight: 90, borderRadius: 16, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: BORDER },
  runBtnTxt:    { fontSize: 28, fontWeight: "900" },
  runBtnTxtWide:{ fontSize: 40, fontWeight: "600" },

  // Extras
  extrasRow:    { flexDirection: "row", gap: 6, marginBottom: 8 },
  extraBtn:     { flex: 1, paddingVertical: 9, borderRadius: 10, backgroundColor: SURFACE, borderWidth: 1, borderColor: BORDER, alignItems: "center" },
  extraBtnWdActive:{ backgroundColor: "rgba(96,165,250,0.12)", borderColor: "rgba(96,165,250,0.3)" },
  extraBtnNbActive:{ backgroundColor: "rgba(254,243,199,0.1)", borderColor: "rgba(252,211,77,0.3)" },
  extraBtnTxt:  { fontSize: 11.5, fontWeight: "700", color: "rgba(255,255,255,0.55)" },

  // Extra mode banner
  extraBanner:  { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 10, padding: 10, marginBottom: 8, borderWidth: 1 },
  extraBannerNb:{ backgroundColor: "rgba(254,243,199,0.08)", borderColor: "rgba(252,211,77,0.25)" },
  extraBannerWd:{ backgroundColor: "rgba(96,165,250,0.08)", borderColor: "rgba(96,165,250,0.25)" },
  extraBannerTxt:{ flex: 1, fontSize: 12, fontWeight: "600" },

  // Action row
  actionRow:    { flexDirection: "row", gap: 8 },
  actionBtn:    { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 14, borderRadius: 12, minHeight: 56 },
  actionWicket: { flex: 2, backgroundColor: RED },
  actionSec:    { backgroundColor: SURFACE, borderWidth: 1, borderColor: BORDER },
  actionTxt:    { fontSize: 13, fontWeight: "700", color: "rgba(255,255,255,0.7)" },
});
import {
  View, Text, TextInput, StyleSheet, ScrollView,
  TouchableOpacity, SafeAreaView, StatusBar, Platform, KeyboardAvoidingView,
  Alert, Modal, Share,
} from "react-native";
import { useEffect, useRef, useState, useCallback, type ReactNode } from "react";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";

// =============================================================================
// 🏏 GULLY SCORER — Local cricket scoreboard (100% offline)
//
//   • No Firestore, no login — everything saved in phone local storage only
//   • Auto-deletes all data 10 hours after the last update
//   • Team names, overs, players-per-team (steppers + quick chips)
//   • Player names OPTIONAL — auto "Batsman 1/2/3…" when not tracking names
//   • Full 2-innings flow: target, chase, result, share, rematch
//   • Undo any ball · Wide / No-ball / Bye / Leg-bye · strike rotation
//   • UI: PlayOn green header, dark score card, Scoring / Scorecard / Overs tabs
//
//   Requires: npx expo install @react-native-async-storage/async-storage
// =============================================================================

const STORE_KEY   = "localScoreboard:active";
const HISTORY_KEY = "localScoreboard:history";
const TTL_MS      = 10 * 60 * 60 * 1000; // 10 hours

// ── Theme ─────────────────────────────────────────────────────────────────────
const BRAND        = "#0E6B37";   // PlayOn header green
const PAGE_BG      = "#F2F5F3";
const CARD_BG      = "#FFFFFF";
const CARD_BORDER  = "#E4EAE6";
const DIVIDER      = "#EEF1EF";
const INPUT_BG     = "#F3F5F4";
const CTRL_BORDER  = "#D9E0DC";
const TEXT_DARK    = "#101828";
const TEXT_MID     = "#475467";
const TEXT_GRAY    = "#667085";
const TXT_FAINT    = "#98A2B3";
const HEADER_SUB   = "#CDE8D6";
const GREEN        = "#16A34A";
const GREEN_BAR    = "#22C55E";
const GREEN_TINT   = "#F0FAF3";
const GREEN_SOFT   = "#E3F2E7";
const RED          = "#DC2626";
const AMBER_DARK   = "#92400E";
const AMBER_SOFT   = "#FFFBEB";
const AMBER_LINE   = "#F5D9A8";
const GOLD         = "#FDE68A";
const BLUE         = "#2563EB";
const PURPLE       = "#7C3AED";
const SCORE_BG     = "#101828";   // dark score card
const ON_DARK_SURF = "rgba(255,255,255,0.14)";
const ON_DARK_DIM  = "#D0D5DD";
const HEADER_BTN   = "rgba(255,255,255,0.14)";

// ── Types ─────────────────────────────────────────────────────────────────────
type BatCard  = { name: string; runs: number; balls: number; fours: number; sixes: number; out: boolean; dismissal: string };
type BowlCard = { name: string; balls: number; runs: number; wickets: number };
type Ball     = { label: string; runs: number; w: boolean; bowler?: string };
type InningsSnap = {
  teamName: string; runs: number; wickets: number; balls: number;
  extras: Extras; battingCard: BatCard[]; bowlingCard: BowlCard[]; timeline: Ball[];
};
type Extras = { wides: number; noballs: number; byes: number; legbyes: number };

type MatchState = {
  createdAt: number;
  teamAName: string; teamBName: string;
  oversLimit: number;
  playersA: number; playersB: number;       // can differ (6 vs 7 etc.)
  trackNames: boolean;                       // optional player names
  status: "live" | "innings_break" | "completed";
  innings: 1 | 2;
  battingTeamName: string; bowlingTeamName: string;
  runs: number; wickets: number; balls: number;
  extras: Extras;
  battingCard: BatCard[];
  bowlingCard: BowlCard[];
  strikerIdx: number; nonStrikerIdx: number; bowlerIdx: number;
  timeline: Ball[];
  target: number | null;
  innings1: InningsSnap | null;
  result: string | null;
  maxWickets: number;                        // players batting − 1
};

type HistoryItem = { savedAt: number; summary: string; result: string; teams: string };
type MatchCfg = { a: string; b: string; overs: number; pA: number; pB: number; batFirst: "A" | "B"; names: boolean };
type LiveTab = "score" | "card" | "overs";

// ── Helpers ───────────────────────────────────────────────────────────────────
const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));
const oversStr = (b: number) => `${Math.floor(b / 6)}.${b % 6}`;
const newBat  = (name: string): BatCard  => ({ name, runs: 0, balls: 0, fours: 0, sixes: 0, out: false, dismissal: "" });
const newBowl = (name: string): BowlCard => ({ name, balls: 0, runs: 0, wickets: 0 });
const clampInt = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(n)));
const initial = (name: string) => (name.trim()[0] || "?").toUpperCase();

type OverGroup = { overNum: number; balls: Ball[]; runs: number; wkts: number; bowler: string; live: boolean };
const isLegalBall = (b: Ball) => !String(b.label).startsWith("Wd") && !String(b.label).startsWith("Nb");
const buildOverGroup = (balls: Ball[], overNum: number, live: boolean): OverGroup => ({
  overNum, balls,
  runs: balls.reduce((sum, b) => sum + b.runs, 0),
  wkts: balls.filter((b) => b.w).length,
  bowler: balls.find((b) => b.bowler)?.bowler || "",
  live,
});
const groupOvers = (timeline: Ball[]): OverGroup[] => {
  const overs: OverGroup[] = [];
  let cur: Ball[] = [];
  let overNum = 1;
  for (const b of timeline) {
    cur.push(b);
    if (isLegalBall(b) && cur.filter(isLegalBall).length === 6) {
      overs.push(buildOverGroup(cur, overNum, false));
      cur = []; overNum++;
    }
  }
  if (cur.length > 0) overs.push(buildOverGroup(cur, overNum, true));
  return overs;
};

// ── Small UI pieces ───────────────────────────────────────────────────────────
function SectionLabel({ label }: { label: string }) {
  return <Text style={s.secLabel}>{label}</Text>;
}

function Switch({ value, onToggle, label }: { value: boolean; onToggle: () => void; label: string }) {
  return (
    <TouchableOpacity activeOpacity={0.85} onPress={onToggle} accessibilityRole="switch"
      accessibilityState={{ checked: value }} accessibilityLabel={label}
      style={[s.switchTrack, value && s.switchTrackOn]}>
      <View style={[s.switchThumb, value && s.switchThumbOn]} />
    </TouchableOpacity>
  );
}

function Stepper({ value, onChange, min, max, label, big }: {
  value: number; onChange: (n: number) => void; min: number; max: number; label: string; big?: boolean;
}) {
  return (
    <View style={big ? s.stepBig : s.stepSmall}>
      <TouchableOpacity style={big ? s.stepBigBtn : s.stepSmallBtn} onPress={() => onChange(Math.max(min, value - 1))}
        accessibilityLabel={`Decrease ${label}`} hitSlop={6}>
        <Text style={s.stepMinus}>−</Text>
      </TouchableOpacity>
      <Text style={big ? s.stepBigVal : s.stepSmallVal}>{value}</Text>
      <TouchableOpacity style={big ? s.stepBigBtn : s.stepSmallBtn} onPress={() => onChange(Math.min(max, value + 1))}
        accessibilityLabel={`Increase ${label}`} hitSlop={6}>
        <Text style={s.stepPlus}>+</Text>
      </TouchableOpacity>
    </View>
  );
}

function TeamDot({ letter, color, size = 30 }: { letter: string; color: string; size?: number }) {
  return (
    <View style={[s.teamDot, { width: size, height: size, borderRadius: size / 2, backgroundColor: color }]}>
      <Text style={[s.teamDotTxt, { fontSize: size * 0.42 }]}>{letter}</Text>
    </View>
  );
}

// Ball chip styling shared by "this over" and over-by-over lists
function ballChipStyle(b: Ball, onDark: boolean) {
  const lbl = String(b.label);
  if (b.w) return { bg: RED, fg: "#FFFFFF" };
  if (lbl.startsWith("Wd") || lbl.startsWith("Nb")) return { bg: GOLD, fg: "#78350F" };
  if (b.runs === 4 && !lbl.startsWith("B") && !lbl.startsWith("L")) return { bg: BLUE, fg: "#FFFFFF" };
  if (b.runs === 6 && !lbl.startsWith("B") && !lbl.startsWith("L")) return { bg: PURPLE, fg: "#FFFFFF" };
  return onDark ? { bg: ON_DARK_SURF, fg: "#FFFFFF" } : { bg: INPUT_BG, fg: TEXT_DARK };
}

// ── Over-by-over list ─────────────────────────────────────────────────────────
function OversList({ timeline, showBowler }: { timeline: Ball[]; showBowler?: boolean }) {
  const overs = groupOvers(timeline).slice().reverse(); // most recent first
  if (overs.length === 0) return <Text style={s.emptyTxt}>No balls bowled yet.</Text>;
  return (
    <>
      {overs.map((o, idx) => (
        <View key={o.overNum} style={[s.overRow, idx === 0 && { borderTopWidth: 0 }]}>
          <View style={s.overLeftCol}>
            <Text style={s.overNumTxt}>Over {o.overNum}{o.live ? " •" : ""}</Text>
            {showBowler && !!o.bowler && <Text style={s.overBowlerTxt} numberOfLines={1}>{o.bowler}</Text>}
          </View>
          <View style={s.overBallsRow}>
            {o.balls.map((b, i) => {
              const c = ballChipStyle(b, false);
              return (
                <View key={i} style={[s.overBallChip, { backgroundColor: c.bg }]}>
                  <Text style={[s.overBallChipTxt, { color: c.fg }]}>{b.label}</Text>
                </View>
              );
            })}
          </View>
          <Text style={s.overRunsTxt}>{o.runs}{o.wkts ? `-${o.wkts}` : ""}</Text>
        </View>
      ))}
    </>
  );
}

// =============================================================================
export default function LocalScoreboard() {
  const router = useRouter();

  const [loaded, setLoaded]   = useState(false);
  const [sc, setSc]           = useState<MatchState | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const historyRef            = useRef<string[]>([]); // undo stack (in-memory)

  // setup form
  const [teamA, setTeamA]       = useState("Team A");
  const [teamB, setTeamB]       = useState("Team B");
  const [overs, setOvers]       = useState(6);
  const [playersA, setPlayersA] = useState(6);
  const [playersB, setPlayersB] = useState(6);
  const [batFirst, setBatFirst] = useState<"A" | "B">("A");
  const [trackNames, setTrackNames] = useState(false);

  // prompts / view
  const [namePrompt, setNamePrompt] = useState<null | { kind: "batsman" | "bowler"; title: string }>(null);
  const [promptTxt, setPromptTxt]   = useState("");
  const pendingAfterName            = useRef<((name: string) => void) | null>(null);
  const [pendingExtra, setPendingExtra] = useState<null | "Wd" | "Nb" | "B" | "Lb">(null);
  const [tab, setTab]               = useState<LiveTab>("score");
  const [openCard, setOpenCard]     = useState<string | null>(null);

  // ── Load + 10-hour auto-expiry ──────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const now = Date.now();
        const raw = await AsyncStorage.getItem(STORE_KEY);
        if (raw) {
          const saved = JSON.parse(raw);
          if (saved?.savedAt && now - saved.savedAt < TTL_MS && saved.state) {
            setSc(saved.state);
          } else {
            await AsyncStorage.removeItem(STORE_KEY); // expired → delete
          }
        }
        const hRaw = await AsyncStorage.getItem(HISTORY_KEY);
        if (hRaw) {
          const list: HistoryItem[] = JSON.parse(hRaw);
          const fresh = list.filter((h) => now - h.savedAt < TTL_MS);
          setHistory(fresh);
          if (fresh.length !== list.length) {
            if (fresh.length) await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(fresh));
            else await AsyncStorage.removeItem(HISTORY_KEY);
          }
        }
      } catch (e) { console.warn("local scoreboard load", e); }
      setLoaded(true);
    })();
  }, []);

  // ── Persist locally on every change ─────────────────────────────────────────
  const persist = useCallback(async (next: MatchState | null) => {
    setSc(next);
    try {
      if (next) await AsyncStorage.setItem(STORE_KEY, JSON.stringify({ savedAt: Date.now(), state: next }));
      else await AsyncStorage.removeItem(STORE_KEY);
    } catch (e) { console.warn("local scoreboard save", e); }
  }, []);

  const commit = (next: MatchState) => { if (sc) historyRef.current.push(JSON.stringify(sc)); persist(next); };
  const undo   = () => {
    const prev = historyRef.current.pop();
    if (!prev) { Alert.alert("Undo", "Nothing to undo."); return; }
    persist(JSON.parse(prev)); setPendingExtra(null); setNamePrompt(null);
  };

  const saveToHistory = async (st: MatchState) => {
    try {
      const item: HistoryItem = {
        savedAt: Date.now(),
        teams: `${st.teamAName} vs ${st.teamBName}`,
        result: st.result || "",
        summary: st.innings1
          ? `${st.innings1.teamName} ${st.innings1.runs}/${st.innings1.wickets} (${oversStr(st.innings1.balls)})  ·  ${st.battingTeamName} ${st.runs}/${st.wickets} (${oversStr(st.balls)})`
          : `${st.battingTeamName} ${st.runs}/${st.wickets} (${oversStr(st.balls)})`,
      };
      const list = [item, ...history].slice(0, 10);
      setHistory(list);
      await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(list));
    } catch (e) { console.warn("history save", e); }
  };

  // ── Auto player names ───────────────────────────────────────────────────────
  const nextAutoBat  = (st: MatchState) => `Batsman ${st.battingCard.length + 1}`;
  const nextAutoBowl = (st: MatchState) => `Bowler ${st.bowlingCard.length + 1}`;

  const askName = (kind: "batsman" | "bowler", title: string, cb: (name: string) => void) => {
    pendingAfterName.current = cb;
    setPromptTxt("");
    setNamePrompt({ kind, title });
  };
  const submitName = (skip: boolean) => {
    const cb = pendingAfterName.current;
    pendingAfterName.current = null;
    const txt = promptTxt.trim();
    setNamePrompt(null); setPromptTxt("");
    if (cb) cb(skip || !txt ? "" : txt);
  };

  // ── Start match (used by Start, New match and Rematch) ───────────────────────
  const startWith = (cfg: MatchCfg) => {
    const batName  = cfg.batFirst === "A" ? cfg.a : cfg.b;
    const bowlName = cfg.batFirst === "A" ? cfg.b : cfg.a;
    const batPlayers = cfg.batFirst === "A" ? cfg.pA : cfg.pB;

    const base: MatchState = {
      createdAt: Date.now(),
      teamAName: cfg.a, teamBName: cfg.b,
      oversLimit: cfg.overs, playersA: cfg.pA, playersB: cfg.pB, trackNames: cfg.names,
      status: "live", innings: 1,
      battingTeamName: batName, bowlingTeamName: bowlName,
      runs: 0, wickets: 0, balls: 0,
      extras: { wides: 0, noballs: 0, byes: 0, legbyes: 0 },
      battingCard: [], bowlingCard: [],
      strikerIdx: 0, nonStrikerIdx: 1, bowlerIdx: 0,
      timeline: [],
      target: null, innings1: null, result: null,
      maxWickets: Math.max(1, batPlayers - 1),
    };

    const begin = (s1: string, s2: string, bw: string) => {
      base.battingCard = [newBat(s1 || "Batsman 1"), newBat(s2 || "Batsman 2")];
      base.bowlingCard = [newBowl(bw || "Bowler 1")];
      historyRef.current = [];
      setTab("score"); setOpenCard(null);
      persist(base);
    };

    if (!cfg.names) { begin("", "", ""); return; }
    askName("batsman", "Opening batsman (striker)", (n1) =>
      askName("batsman", "Opening batsman (non-striker)", (n2) =>
        askName("bowler", "Opening bowler", (bw) => begin(n1, n2, bw))));
  };

  const startMatch = () => {
    if (!overs || overs < 1 || overs > 50) return Alert.alert("Overs", "Overs per innings must be 1–50.");
    startWith({
      a: teamA.trim() || "Team A", b: teamB.trim() || "Team B",
      overs, pA: playersA, pB: playersB, batFirst, names: trackNames,
    });
  };

  const rematch = () => {
    if (!sc) return;
    const firstBat: "A" | "B" = sc.innings1?.teamName === sc.teamBName ? "B" : "A";
    startWith({
      a: sc.teamAName, b: sc.teamBName, overs: sc.oversLimit,
      pA: sc.playersA, pB: sc.playersB, batFirst: firstBat, names: sc.trackNames,
    });
  };

  // ── Innings / result ────────────────────────────────────────────────────────
  const endInnings = (next: MatchState) => {
    if (next.innings === 1) {
      next.innings1 = {
        teamName: next.battingTeamName, runs: next.runs, wickets: next.wickets, balls: next.balls,
        extras: clone(next.extras), battingCard: clone(next.battingCard),
        bowlingCard: clone(next.bowlingCard), timeline: clone(next.timeline),
      };
      next.target = next.runs + 1;
      next.status = "innings_break";
    } else {
      next.status = "completed";
      if (next.target != null && next.runs >= next.target) {
        const left = next.maxWickets - next.wickets;
        next.result = `${next.battingTeamName} won by ${left} wicket${left === 1 ? "" : "s"}`;
      } else if (next.target != null && next.runs === next.target - 1) {
        next.result = "Match tied";
      } else {
        const by = (next.target ?? 1) - 1 - next.runs;
        next.result = `${next.bowlingTeamName} won by ${by} run${by === 1 ? "" : "s"}`;
      }
      saveToHistory(next);
    }
  };

  const startInnings2 = () => {
    if (!sc) return;
    const next = clone(sc);
    const batName  = next.innings1!.teamName === next.teamAName ? next.teamBName : next.teamAName;
    const bowlName = next.innings1!.teamName;
    const batPlayers = batName === next.teamAName ? next.playersA : next.playersB;

    const begin = (s1: string, s2: string, bw: string) => {
      next.innings = 2; next.status = "live";
      next.battingTeamName = batName; next.bowlingTeamName = bowlName;
      next.runs = 0; next.wickets = 0; next.balls = 0;
      next.extras = { wides: 0, noballs: 0, byes: 0, legbyes: 0 };
      next.battingCard = [newBat(s1 || "Batsman 1"), newBat(s2 || "Batsman 2")];
      next.bowlingCard = [newBowl(bw || "Bowler 1")];
      next.strikerIdx = 0; next.nonStrikerIdx = 1; next.bowlerIdx = 0;
      next.timeline = [];
      next.maxWickets = Math.max(1, batPlayers - 1);
      setTab("score");
      commit(next);
    };

    if (!sc.trackNames) { begin("", "", ""); return; }
    askName("batsman", "Opening batsman (striker)", (n1) =>
      askName("batsman", "Opening batsman (non-striker)", (n2) =>
        askName("bowler", "Opening bowler", (bw) => begin(n1, n2, bw))));
  };

  // ── Ball engine (unchanged) ─────────────────────────────────────────────────
  const swapStrike = (n: MatchState) => { const t = n.strikerIdx; n.strikerIdx = n.nonStrikerIdx; n.nonStrikerIdx = t; };

  const afterLegalBall = (next: MatchState) => {
    if (next.balls % 6 === 0 && next.status === "live") {
      swapStrike(next);
      if (next.trackNames) {
        commit(next);
        askName("bowler", `Over ${next.balls / 6 + 1} — bowler`, (bw) => {
          const n2 = clone(next);
          const nm = bw || nextAutoBowl(n2);
          const existing = n2.bowlingCard.findIndex((b) => b.name.toLowerCase() === nm.toLowerCase());
          if (existing >= 0) n2.bowlerIdx = existing;
          else { n2.bowlingCard.push(newBowl(nm)); n2.bowlerIdx = n2.bowlingCard.length - 1; }
          persist(n2); // don't push undo twice for the same delivery
        });
        return true; // already committed
      } else {
        next.bowlingCard.push(newBowl(nextAutoBowl(next)));
        next.bowlerIdx = next.bowlingCard.length - 1;
      }
    }
    return false;
  };

  const checkFinish = (next: MatchState) => {
    const allOut    = next.wickets >= next.maxWickets;
    const oversDone = next.balls >= next.oversLimit * 6;
    const chased    = next.innings === 2 && next.target != null && next.runs >= next.target;
    if (allOut || oversDone || chased) endInnings(next);
  };

  const scoreRuns = (r: number) => {
    if (!sc || sc.status !== "live") return;
    if (pendingExtra) { applyExtra(pendingExtra, r); return; }

    const next = clone(sc);
    const bat  = next.battingCard[next.strikerIdx];
    const bwl  = next.bowlingCard[next.bowlerIdx];
    next.runs += r; bat.runs += r; bat.balls += 1;
    if (r === 4) bat.fours += 1;
    if (r === 6) bat.sixes += 1;
    bwl.runs += r; bwl.balls += 1;
    next.balls += 1;
    next.timeline.push({ label: r === 0 ? "•" : String(r), runs: r, w: false, bowler: bwl.name });
    if (r % 2 === 1) swapStrike(next);
    checkFinish(next);
    if (next.status === "live") { if (afterLegalBall(next)) return; }
    commit(next);
  };

  const applyExtra = (kind: "Wd" | "Nb" | "B" | "Lb", extraRuns: number) => {
    if (!sc || sc.status !== "live") return;
    const next = clone(sc);
    const bwl  = next.bowlingCard[next.bowlerIdx];
    const bat  = next.battingCard[next.strikerIdx];
    setPendingExtra(null);

    if (kind === "Wd") {
      next.runs += 1 + extraRuns; next.extras.wides += 1 + extraRuns;
      bwl.runs += 1 + extraRuns;
      next.timeline.push({ label: extraRuns ? `Wd+${extraRuns}` : "Wd", runs: 1 + extraRuns, w: false, bowler: bwl.name });
      if (extraRuns % 2 === 1) swapStrike(next);
    } else if (kind === "Nb") {
      next.runs += 1 + extraRuns; next.extras.noballs += 1;
      bwl.runs += 1 + extraRuns;
      bat.runs += extraRuns; bat.balls += 1; // batsman gets the runs off a no-ball
      if (extraRuns === 4) bat.fours += 1;
      if (extraRuns === 6) bat.sixes += 1;
      next.timeline.push({ label: extraRuns ? `Nb+${extraRuns}` : "Nb", runs: 1 + extraRuns, w: false, bowler: bwl.name });
      if (extraRuns % 2 === 1) swapStrike(next);
    } else {
      // Bye / Leg-bye — legal delivery, runs to extras
      const runs = Math.max(1, extraRuns);
      next.runs += runs;
      if (kind === "B") next.extras.byes += runs; else next.extras.legbyes += runs;
      bat.balls += 1; bwl.balls += 1;
      next.balls += 1;
      next.timeline.push({ label: `${kind}${runs}`, runs, w: false, bowler: bwl.name });
      if (runs % 2 === 1) swapStrike(next);
      checkFinish(next);
      if (next.status === "live") { if (afterLegalBall(next)) return; }
    }
    checkFinish(next);
    commit(next);
  };

  const takeWicket = () => {
    if (!sc || sc.status !== "live") return;
    setPendingExtra(null);
    const next = clone(sc);
    const bat  = next.battingCard[next.strikerIdx];
    const bwl  = next.bowlingCard[next.bowlerIdx];
    bat.out = true; bat.dismissal = "out"; bat.balls += 1;
    bwl.wickets += 1; bwl.balls += 1;
    next.wickets += 1; next.balls += 1;
    next.timeline.push({ label: "W", runs: 0, w: true, bowler: bwl.name });

    checkFinish(next);
    if (next.status !== "live") { commit(next); return; }

    const bringIn = (nm: string) => {
      const n2 = clone(next);
      n2.battingCard.push(newBat(nm || nextAutoBat(n2)));
      n2.strikerIdx = n2.battingCard.length - 1;
      if (afterLegalBall(n2)) return;
      persist(n2);
    };

    if (next.trackNames) {
      commit(next);
      askName("batsman", "New batsman", (nm) => bringIn(nm));
    } else {
      next.battingCard.push(newBat(nextAutoBat(next)));
      next.strikerIdx = next.battingCard.length - 1;
      if (afterLegalBall(next)) return;
      commit(next);
    }
  };

  const resetAll = () => {
    Alert.alert("New match", "Clear the current match and start fresh?", [
      { text: "Cancel", style: "cancel" },
      { text: "Clear", style: "destructive", onPress: () => { historyRef.current = []; persist(null); } },
    ]);
  };

  const showInfo = () => {
    Alert.alert(
      "Gully Scorer",
      "Everything you score here stays only on this phone — nothing is uploaded. The match (and your recent match history) is deleted automatically 10 hours after the last update."
    );
  };

  const shareResult = async () => {
    if (!sc || !sc.innings1) return;
    const i1 = sc.innings1;
    const msg = [
      `🏏 ${sc.teamAName} vs ${sc.teamBName} (${sc.oversLimit} overs)`,
      `${i1.teamName}: ${i1.runs}/${i1.wickets} (${oversStr(i1.balls)})`,
      `${sc.battingTeamName}: ${sc.runs}/${sc.wickets} (${oversStr(sc.balls)})`,
      ``,
      `🏆 ${sc.result}`,
      ``,
      `Scored on PlayOn Gully Scorer`,
      `https://play.google.com/store/apps/details?id=com.playonnew.app`,
    ].join("\n");
    try { await Share.share({ message: msg }); } catch {}
  };

  // ── Derived ─────────────────────────────────────────────────────────────────
  const teamColor = (name: string) => (sc && name === sc.teamBName ? BLUE : BRAND);
  const teamLetter = (name: string) => (sc && name === sc.teamBName ? "B" : sc && name === sc.teamAName ? "A" : initial(name));

  const striker  = sc?.battingCard[sc.strikerIdx];
  const nonStrk  = sc?.battingCard[sc.nonStrikerIdx];
  const bowler   = sc?.bowlingCard[sc.bowlerIdx];
  const crr      = sc && sc.balls > 0 ? ((sc.runs * 6) / sc.balls).toFixed(2) : "0.00";
  const ballsLeft = sc ? sc.oversLimit * 6 - sc.balls : 0;
  const rrr      = sc && sc.innings === 2 && sc.target != null && ballsLeft > 0
    ? (((sc.target - sc.runs) * 6) / ballsLeft).toFixed(2) : null;
  const chaseProgress = sc && sc.innings === 2 && sc.target
    ? Math.max(0, Math.min(1, sc.runs / sc.target)) : 0;

  const currentOverBalls = (() => {
    if (!sc) return [];
    const tl = sc.timeline; let legal = 0, start = tl.length;
    for (let i = tl.length - 1; i >= 0; i--) {
      const lbl = String(tl[i].label);
      const isLegal = !lbl.startsWith("Wd") && !lbl.startsWith("Nb");
      if (isLegal) legal++;
      if (legal === 6) { start = i + 1; break; }
      if (i === 0) start = 0;
    }
    // a just-finished over shows as a fresh, empty over
    const slice = tl.slice(start);
    return slice.filter(isLegalBall).length === 6 ? [] : slice;
  })();
  const legalInOver = currentOverBalls.filter(isLegalBall).length;

  // Result screen data
  const resultInfo = (() => {
    if (!sc || sc.status !== "completed" || sc.target == null) return null;
    if (sc.runs >= sc.target) {
      const left = sc.maxWickets - sc.wickets;
      const bl = sc.oversLimit * 6 - sc.balls;
      return { winner: sc.battingTeamName, line: `by ${left} wicket${left === 1 ? "" : "s"}${bl > 0 ? ` · ${bl} ball${bl === 1 ? "" : "s"} left` : ""}` };
    }
    if (sc.runs === sc.target - 1) return { winner: null as string | null, line: "Scores level" };
    const by = sc.target - 1 - sc.runs;
    return { winner: sc.bowlingTeamName, line: `by ${by} run${by === 1 ? "" : "s"}` };
  })();

  const topPerformers = (() => {
    if (!sc || sc.status !== "completed" || !sc.innings1) return null;
    const bats = [...sc.innings1.battingCard, ...sc.battingCard];
    const bowls = [...sc.innings1.bowlingCard, ...sc.bowlingCard];
    const bestBat = bats.slice().sort((a, b) => b.runs - a.runs || a.balls - b.balls)[0];
    const bestBowl = bowls.filter((b) => b.balls > 0).sort((a, b) => b.wickets - a.wickets || a.runs - b.runs)[0];
    return { bestBat, bestBowl };
  })();

  if (!loaded) return <SafeAreaView style={s.safe} />;

  // ── Header (green, used on every screen) ─────────────────────────────────────
  const Header = ({ title, sub, right }: { title: string; sub?: string; right?: ReactNode }) => (
    <View style={s.header}>
      <TouchableOpacity onPress={() => router.back()} style={s.headerBtn} accessibilityLabel="Back">
        <Ionicons name="chevron-back" size={20} color="#FFFFFF" />
      </TouchableOpacity>
      <View style={{ flex: 1 }}>
        <Text style={s.headerTitle} numberOfLines={1}>{title}</Text>
        {!!sub && <Text style={s.headerSub} numberOfLines={1}>{sub}</Text>}
      </View>
      {right}
    </View>
  );

  // ══════════════════════════════════════════════════════════════════════════
  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="light-content" backgroundColor={BRAND} />

      {/* ════════ SETUP ════════ */}
      {!sc && (
        <>
          <Header
            title="Gully Scorer"
            sub="Offline · saved on this phone · clears after 10 hrs"
            right={
              <TouchableOpacity style={s.headerBtn} onPress={showInfo} accessibilityLabel="How it works">
                <Ionicons name="information-circle-outline" size={21} color="#FFFFFF" />
              </TouchableOpacity>
            }
          />
          <ScrollView keyboardDismissMode="interactive" automaticallyAdjustKeyboardInsets keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false} contentContainerStyle={s.page}>

            {/* Teams */}
            <View style={s.card}>
              <SectionLabel label="TEAMS" />
              <View style={s.teamsRow}>
                <View style={s.teamInputWrap}>
                  <TeamDot letter="A" color={BRAND} />
                  <TextInput style={s.teamInput} value={teamA} onChangeText={setTeamA}
                    placeholder="Team A" placeholderTextColor={TXT_FAINT} maxLength={20} accessibilityLabel="Team A name" />
                </View>
                <View style={s.vsBadge}><Text style={s.vsTxt}>VS</Text></View>
                <View style={s.teamInputWrap}>
                  <TeamDot letter="B" color={BLUE} />
                  <TextInput style={s.teamInput} value={teamB} onChangeText={setTeamB}
                    placeholder="Team B" placeholderTextColor={TXT_FAINT} maxLength={20} accessibilityLabel="Team B name" />
                </View>
              </View>
            </View>

            {/* Match format */}
            <View style={s.card}>
              <SectionLabel label="MATCH FORMAT" />
              <View style={s.formatRow}>
                <View style={{ flex: 1 }}>
                  <Text style={s.rowTitle}>Overs per innings</Text>
                  <Text style={s.rowSub}>Same for both teams</Text>
                </View>
                <Stepper big value={overs} min={1} max={50} label="overs" onChange={setOvers} />
              </View>
              <View style={s.overChips}>
                {[2, 4, 5, 6, 8, 10, 12].map((o) => (
                  <TouchableOpacity key={o} style={[s.overChip, overs === o && s.overChipOn]} onPress={() => setOvers(o)}>
                    <Text style={[s.overChipTxt, overs === o && s.overChipTxtOn]}>{o}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <View style={s.divider} />

              <Text style={s.rowTitle}>Players per team</Text>
              <View style={s.playersGrid}>
                <View style={s.playerBox}>
                  <Text style={s.playerBoxLbl} numberOfLines={1}>{teamA.trim() || "Team A"}</Text>
                  <Stepper value={playersA} min={2} max={30} label={`players ${teamA}`} onChange={(n) => setPlayersA(clampInt(n, 2, 30))} />
                </View>
                <View style={s.playerBox}>
                  <Text style={s.playerBoxLbl} numberOfLines={1}>{teamB.trim() || "Team B"}</Text>
                  <Stepper value={playersB} min={2} max={30} label={`players ${teamB}`} onChange={(n) => setPlayersB(clampInt(n, 2, 30))} />
                </View>
              </View>
            </View>

            {/* Bat first + names */}
            <View style={s.card}>
              <SectionLabel label="WHO BATS FIRST?" />
              <View style={s.segment}>
                <TouchableOpacity style={[s.segBtn, batFirst === "A" && s.segBtnOn]} onPress={() => setBatFirst("A")}>
                  <Text style={[s.segTxt, batFirst === "A" && s.segTxtOn]} numberOfLines={1}>{teamA.trim() || "Team A"}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[s.segBtn, batFirst === "B" && s.segBtnOn]} onPress={() => setBatFirst("B")}>
                  <Text style={[s.segTxt, batFirst === "B" && s.segTxtOn]} numberOfLines={1}>{teamB.trim() || "Team B"}</Text>
                </TouchableOpacity>
              </View>

              <View style={s.divider} />

              <SectionLabel label="PLAYER NAMES" />
              <View style={s.formatRow}>
                <View style={{ flex: 1 }}>
                  <Text style={s.rowTitle}>Add player names</Text>
                  <Text style={s.rowSubLong}>
                    Type each batsman's and bowler's name when they come in. Their runs and wickets show under their name in the scorecard.
                  </Text>
                </View>
                <Switch value={trackNames} onToggle={() => setTrackNames((v) => !v)} label="Add player names" />
              </View>
            </View>

            <TouchableOpacity style={s.primaryBtn} onPress={startMatch} activeOpacity={0.9}>
              <Ionicons name="play" size={18} color="#FFFFFF" />
              <Text style={s.primaryBtnTxt}>Start Match</Text>
            </TouchableOpacity>

            {/* Recent local matches */}
            {history.length > 0 && (
              <View style={s.card}>
                <SectionLabel label="RECENT MATCHES" />
                {history.map((h, i) => (
                  <View key={i} style={[s.histRow, i === 0 && { borderTopWidth: 0, paddingTop: 0 }]}>
                    <View style={s.histIcon}><Ionicons name="trophy-outline" size={17} color={AMBER_DARK} /></View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={s.histTeams} numberOfLines={1}>{h.teams}</Text>
                      <Text style={s.histSummary} numberOfLines={1}>{h.summary}</Text>
                      {!!h.result && <Text style={s.histResult} numberOfLines={1}>{h.result.replace(/[🏆🤝]/g, "").trim()}</Text>}
                    </View>
                  </View>
                ))}
              </View>
            )}
          </ScrollView>
        </>
      )}

      {/* ════════ INNINGS BREAK ════════ */}
      {sc?.status === "innings_break" && (
        <>
          <View style={[s.header, s.heroHeader]}>
            <View style={s.headerTopRow}>
              <TouchableOpacity onPress={() => router.back()} style={s.headerBtn} accessibilityLabel="Back">
                <Ionicons name="chevron-back" size={20} color="#FFFFFF" />
              </TouchableOpacity>
              <Text style={[s.headerTitle, { flex: 1 }]}>Innings break</Text>
              <TouchableOpacity style={s.headerBtn} onPress={resetAll} accessibilityLabel="New match">
                <Ionicons name="refresh" size={18} color="#FFFFFF" />
              </TouchableOpacity>
            </View>
            <View style={s.heroCenter}>
              <TeamDot letter={teamLetter(sc.innings1!.teamName)} color={teamColor(sc.innings1!.teamName)} size={44} />
              <Text style={s.heroBig}>{sc.innings1!.teamName} {sc.innings1!.runs}/{sc.innings1!.wickets}</Text>
              <Text style={s.heroSub}>{oversStr(sc.innings1!.balls)} overs</Text>
              <View style={s.targetPill}>
                <Text style={s.targetPillTxt}>
                  {sc.innings1!.teamName === sc.teamAName ? sc.teamBName : sc.teamAName} need {sc.target} to win
                </Text>
              </View>
            </View>
          </View>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.page}>
            <TouchableOpacity style={s.primaryBtn} onPress={startInnings2} activeOpacity={0.9}>
              <Ionicons name="play" size={18} color="#FFFFFF" />
              <Text style={s.primaryBtnTxt}>Start 2nd Innings</Text>
            </TouchableOpacity>
            {renderScorecard(sc.innings1!, "1st innings", true)}
          </ScrollView>
        </>
      )}

      {/* ════════ LIVE ════════ */}
      {sc?.status === "live" && (
        <>
          <View style={[s.header, { paddingBottom: 70 }]}>
            <TouchableOpacity onPress={() => router.back()} style={s.headerBtn} accessibilityLabel="Back">
              <Ionicons name="chevron-back" size={20} color="#FFFFFF" />
            </TouchableOpacity>
            <View style={{ flex: 1 }}>
              <Text style={s.headerTitle} numberOfLines={1}>{sc.teamAName} vs {sc.teamBName}</Text>
              <Text style={s.headerSub}>{sc.oversLimit} overs · {sc.innings === 1 ? "1st" : "2nd"} innings</Text>
            </View>
            <TouchableOpacity style={s.headerBtn} onPress={resetAll} accessibilityLabel="New match">
              <Ionicons name="refresh" size={18} color="#FFFFFF" />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[s.page, { paddingTop: 0 }]} style={{ marginTop: -60 }}>
            {/* Score card */}
            <View style={s.board}>
              <View style={s.boardTopRow}>
                <View style={s.boardTeamRow}>
                  <TeamDot letter={teamLetter(sc.battingTeamName)} color={teamColor(sc.battingTeamName)} size={24} />
                  <Text style={s.boardTeam} numberOfLines={1}>{sc.battingTeamName} batting</Text>
                </View>
                <View style={s.innBadge}>
                  <Text style={s.innBadgeTxt}>{sc.innings === 2 && sc.target != null ? `Target ${sc.target}` : "1st Inn"}</Text>
                </View>
              </View>
              <View style={s.boardScoreRow}>
                <Text style={s.boardScore}>{sc.runs}/{sc.wickets}</Text>
                <Text style={s.boardOvers}>{oversStr(sc.balls)} / {sc.oversLimit} ov</Text>
              </View>

              {sc.innings === 2 && sc.target != null ? (
                <View style={{ gap: 6 }}>
                  <View style={s.progressTrack}>
                    <View style={[s.progressFill, { width: `${Math.round(chaseProgress * 100)}%` }]} />
                  </View>
                  <View style={s.boardStatRow}>
                    <Text style={[s.boardStat, { color: GOLD }]}>
                      Need {Math.max(0, sc.target - sc.runs)} from {ballsLeft} ball{ballsLeft === 1 ? "" : "s"}
                    </Text>
                    <Text style={s.boardStat}>CRR {crr}{rrr ? ` · RRR ${rrr}` : ""}</Text>
                  </View>
                </View>
              ) : (
                <View style={s.boardStatRow}>
                  <Text style={s.boardStat}>CRR {crr}</Text>
                  <Text style={s.boardStat}>Extras {sc.extras.wides + sc.extras.noballs + sc.extras.byes + sc.extras.legbyes}</Text>
                </View>
              )}

              <View style={s.thisOverRow}>
                <Text style={s.thisOverLbl}>This over</Text>
                <View style={s.ballDotsRow}>
                  {currentOverBalls.map((b, i) => {
                    const c = ballChipStyle(b, true);
                    return (
                      <View key={i} style={[s.ballDot, { backgroundColor: c.bg }]}>
                        <Text style={[s.ballDotTxt, { color: c.fg }]}>{b.label}</Text>
                      </View>
                    );
                  })}
                  {Array.from({ length: Math.max(0, 6 - legalInOver) }).map((_, i) => (
                    <View key={`e${i}`} style={s.ballDotEmpty} />
                  ))}
                </View>
              </View>
            </View>

            {/* Batting + bowling */}
            <View style={s.card}>
              <View style={s.tblHead}>
                <Text style={[s.tblHeadTxt, { flex: 1 }]}>BATTING</Text>
                <Text style={[s.tblHeadTxt, s.colRB]}>R (B)</Text>
                <Text style={[s.tblHeadTxt, s.colN]}>4s</Text>
                <Text style={[s.tblHeadTxt, s.colN]}>6s</Text>
              </View>
              <View style={s.tblRow}>
                <View style={s.strikerName}>
                  <View style={s.strikeDot} />
                  <Text style={s.batNameOn} numberOfLines={1}>{striker?.name}</Text>
                </View>
                <Text style={[s.batRB, s.colRB]}>{striker?.runs} ({striker?.balls})</Text>
                <Text style={[s.batN, s.colN]}>{striker?.fours}</Text>
                <Text style={[s.batN, s.colN]}>{striker?.sixes}</Text>
              </View>
              <View style={s.tblRow}>
                <Text style={s.batNameOff} numberOfLines={1}>{nonStrk?.name}</Text>
                <Text style={[s.batRB, s.colRB]}>{nonStrk?.runs} ({nonStrk?.balls})</Text>
                <Text style={[s.batN, s.colN]}>{nonStrk?.fours}</Text>
                <Text style={[s.batN, s.colN]}>{nonStrk?.sixes}</Text>
              </View>
              <View style={[s.divider, { marginVertical: 10 }]} />
              <View style={s.bowlRow}>
                <View style={{ flex: 1 }}>
                  <Text style={s.tblHeadTxt}>BOWLING</Text>
                  <Text style={s.bowlName} numberOfLines={1}>{bowler?.name}</Text>
                </View>
                <Text style={s.bowlFig}>{oversStr(bowler?.balls || 0)} ov · {bowler?.runs} r · {bowler?.wickets} w</Text>
              </View>
            </View>

            {/* Tabs */}
            <View style={s.tabs}>
              {([["score", "Scoring"], ["card", "Scorecard"], ["overs", "Overs"]] as const).map(([k, lbl]) => (
                <TouchableOpacity key={k} style={[s.tabBtn, tab === k && s.tabBtnOn]} onPress={() => setTab(k)}>
                  <Text style={[s.tabTxt, tab === k && s.tabTxtOn]}>{lbl}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {tab === "score" && (
              <>
                {pendingExtra && (
                  <View style={s.pendingBar}>
                    <Text style={s.pendingTxt}>
                      {pendingExtra === "Wd" ? "Wide" : pendingExtra === "Nb" ? "No-ball" : pendingExtra === "B" ? "Byes" : "Leg-byes"} — now tap the runs (0 if none)
                    </Text>
                    <TouchableOpacity onPress={() => setPendingExtra(null)} hitSlop={8}><Text style={s.pendingCancel}>Cancel</Text></TouchableOpacity>
                  </View>
                )}

                <View style={s.padRow4}>
                  {[0, 1, 2, 3].map((r) => (
                    <TouchableOpacity key={r} style={[s.runBtn, r === 0 && s.runBtn0]} onPress={() => scoreRuns(r)} activeOpacity={0.85}>
                      <Text style={s.runBtnTxt}>{r}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <View style={s.padRow2}>
                  <TouchableOpacity style={[s.bigRun, { backgroundColor: BLUE }]} onPress={() => scoreRuns(4)} activeOpacity={0.85}>
                    <Text style={s.bigRunNum}>4</Text><Text style={s.bigRunLbl}>FOUR</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[s.bigRun, { backgroundColor: PURPLE }]} onPress={() => scoreRuns(6)} activeOpacity={0.85}>
                    <Text style={s.bigRunNum}>6</Text><Text style={s.bigRunLbl}>SIX</Text>
                  </TouchableOpacity>
                </View>
                <View style={s.padRow4}>
                  {([["Wd", "Wide"], ["Nb", "No-ball"], ["B", "Bye"], ["Lb", "Leg-bye"]] as const).map(([k, lbl]) => (
                    <TouchableOpacity key={k} style={[s.extraBtn, pendingExtra === k && s.extraBtnOn]}
                      onPress={() => setPendingExtra(pendingExtra === k ? null : k)} activeOpacity={0.85}>
                      <Text style={[s.extraBtnTxt, pendingExtra === k && { color: "#FFFFFF" }]}>{lbl}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <View style={s.padBottom}>
                  <TouchableOpacity style={s.undoBtn} onPress={undo} activeOpacity={0.85}>
                    <Ionicons name="arrow-undo" size={16} color={TEXT_DARK} />
                    <Text style={s.undoBtnTxt}>Undo</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={s.wktBtn} onPress={takeWicket} activeOpacity={0.9}>
                    <Text style={s.wktBtnTxt}>WICKET</Text>
                  </TouchableOpacity>
                </View>
                <Text style={s.tipTxt}>Tip: tap Wide / No-ball / Bye first, then the runs</Text>
              </>
            )}

            {tab === "card" && (
              <>
                {renderScorecard({
                  teamName: sc.battingTeamName, runs: sc.runs, wickets: sc.wickets, balls: sc.balls,
                  extras: sc.extras, battingCard: sc.battingCard, bowlingCard: sc.bowlingCard, timeline: sc.timeline,
                }, sc.innings === 1 ? "1st innings" : "2nd innings", true)}
                {sc.innings1 && renderScorecard(sc.innings1, "1st innings", true)}
              </>
            )}

            {tab === "overs" && (
              <View style={s.card}>
                <SectionLabel label="OVER BY OVER" />
                <OversList timeline={sc.timeline} showBowler />
              </View>
            )}
          </ScrollView>
        </>
      )}

      {/* ════════ COMPLETED ════════ */}
      {sc?.status === "completed" && sc.innings1 && (
        <>
          <View style={[s.header, s.heroHeader]}>
            <View style={s.headerTopRow}>
              <TouchableOpacity onPress={() => router.back()} style={s.headerBtn} accessibilityLabel="Back">
                <Ionicons name="chevron-back" size={20} color="#FFFFFF" />
              </TouchableOpacity>
              <Text style={[s.headerTitle, { flex: 1 }]}>Match result</Text>
            </View>
            <View style={s.heroCenter}>
              <View style={s.trophy}><Ionicons name="trophy" size={30} color={AMBER_DARK} /></View>
              <Text style={s.heroBig}>{resultInfo?.winner ? `${resultInfo.winner} won!` : "Match tied!"}</Text>
              <Text style={s.heroSub}>{resultInfo?.line}</Text>
            </View>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.page}>
            {/* Both scores */}
            <View style={[s.card, { padding: 0, overflow: "hidden" }]}>
              {[
                { name: sc.innings1.teamName, runs: sc.innings1.runs, wkts: sc.innings1.wickets, balls: sc.innings1.balls },
                { name: sc.battingTeamName, runs: sc.runs, wkts: sc.wickets, balls: sc.balls },
              ].map((t, i) => {
                const won = resultInfo?.winner === t.name;
                return (
                  <View key={i} style={[s.resRow, i === 1 && { borderTopWidth: 1, borderTopColor: DIVIDER }, won && { backgroundColor: GREEN_TINT }]}>
                    <TeamDot letter={teamLetter(t.name)} color={teamColor(t.name)} size={32} />
                    <View style={s.resNameWrap}>
                      <Text style={[s.resName, won && { color: TEXT_DARK, fontWeight: "800" }]} numberOfLines={1}>{t.name}</Text>
                      {won && <View style={s.wonPill}><Text style={s.wonPillTxt}>WON</Text></View>}
                    </View>
                    <Text style={[s.resScore, won && { color: TEXT_DARK }]}>{t.runs}/{t.wkts}</Text>
                    <Text style={s.resOvers}>({oversStr(t.balls)} ov)</Text>
                  </View>
                );
              })}
            </View>

            {/* Top performers */}
            {topPerformers && (
              <View style={s.card}>
                <SectionLabel label="TOP PERFORMERS" />
                <View style={s.playersGrid}>
                  {topPerformers.bestBat && (
                    <View style={s.perfBox}>
                      <Text style={s.perfLbl}>Best batting</Text>
                      <Text style={s.perfName} numberOfLines={1}>{topPerformers.bestBat.name}</Text>
                      <Text style={s.perfVal}>{topPerformers.bestBat.runs} ({topPerformers.bestBat.balls})</Text>
                    </View>
                  )}
                  {topPerformers.bestBowl && (
                    <View style={s.perfBox}>
                      <Text style={s.perfLbl}>Best bowling</Text>
                      <Text style={s.perfName} numberOfLines={1}>{topPerformers.bestBowl.name}</Text>
                      <Text style={s.perfVal}>{topPerformers.bestBowl.wickets} / {topPerformers.bestBowl.runs}</Text>
                    </View>
                  )}
                </View>
              </View>
            )}

            {/* Scorecards (tap to open) */}
            <View style={[s.card, { paddingVertical: 4 }]}>
              {[
                { key: "2", title: `${sc.battingTeamName} scorecard`, inn: {
                  teamName: sc.battingTeamName, runs: sc.runs, wickets: sc.wickets, balls: sc.balls,
                  extras: sc.extras, battingCard: sc.battingCard, bowlingCard: sc.bowlingCard, timeline: sc.timeline,
                } as InningsSnap },
                { key: "1", title: `${sc.innings1.teamName} scorecard`, inn: sc.innings1 },
              ].map((c, i) => (
                <View key={c.key} style={i === 1 && { borderTopWidth: 1, borderTopColor: DIVIDER }}>
                  <TouchableOpacity style={s.accHead} onPress={() => setOpenCard(openCard === c.key ? null : c.key)}>
                    <Text style={s.accTitle} numberOfLines={1}>{c.title}</Text>
                    <Ionicons name={openCard === c.key ? "chevron-up" : "chevron-down"} size={18} color={TEXT_GRAY} />
                  </TouchableOpacity>
                  {openCard === c.key && <View style={{ paddingBottom: 12 }}>{renderScorecard(c.inn, "", false)}</View>}
                </View>
              ))}
            </View>

            <View style={s.resBtns}>
              <TouchableOpacity style={s.shareBtn} onPress={shareResult} activeOpacity={0.85}>
                <Ionicons name="share-social-outline" size={17} color="#137A3C" />
                <Text style={s.shareTxt}>Share result</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.primaryBtn, { flex: 1, marginTop: 0 }]}
                onPress={() => { historyRef.current = []; setOpenCard(null); persist(null); }} activeOpacity={0.9}>
                <Ionicons name="add" size={18} color="#FFFFFF" />
                <Text style={s.primaryBtnTxt}>New match</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity style={s.linkBtn} onPress={rematch}>
              <Text style={s.linkBtnTxt}>Rematch — same teams & overs</Text>
            </TouchableOpacity>
          </ScrollView>
        </>
      )}

      {/* ── Name prompt modal (skippable — names are optional) ── */}
      <Modal visible={!!namePrompt} transparent animationType="fade" onRequestClose={() => submitName(true)}>
        <KeyboardAvoidingView style={s.modalBack} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={s.modalCard}>
            <Text style={s.modalTitle}>{namePrompt?.title}</Text>
            <TextInput
              style={s.modalInput} value={promptTxt} onChangeText={setPromptTxt}
              placeholder="Name (optional)" placeholderTextColor={TXT_FAINT}
              autoFocus maxLength={24} onSubmitEditing={() => submitName(false)}
            />
            <View style={s.modalRow}>
              <TouchableOpacity style={s.modalSkip} onPress={() => submitName(true)}>
                <Text style={s.modalSkipTxt}>Skip</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.modalOk} onPress={() => submitName(false)}>
                <Text style={s.modalOkTxt}>OK</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

// ── Scorecard renderer ────────────────────────────────────────────────────────
// title "" = no header (used inside the result screen's open/close rows)
function renderScorecard(inn: InningsSnap, title: string, asCard: boolean) {
  const extras = inn.extras;
  const extraTotal = (extras?.wides || 0) + (extras?.noballs || 0) + (extras?.byes || 0) + (extras?.legbyes || 0);
  return (
    <View style={asCard ? s.card : undefined} key={`${title}-${inn.teamName}`}>
      {!!title && (
        <View style={s.scHead}>
          <Text style={s.scTitle} numberOfLines={1}>{title} — {inn.teamName}</Text>
          <Text style={s.scScore}>{inn.runs}/{inn.wickets} ({oversStr(inn.balls)})</Text>
        </View>
      )}
      <View style={s.tblHead}>
        <Text style={[s.tblHeadTxt, { flex: 1 }]}>BATTING</Text>
        <Text style={[s.tblHeadTxt, s.colRB]}>R (B)</Text>
        <Text style={[s.tblHeadTxt, s.colN]}>4s</Text>
        <Text style={[s.tblHeadTxt, s.colN]}>6s</Text>
      </View>
      {inn.battingCard.map((b, i) => (
        <View key={i} style={s.tblRow}>
          <Text style={[s.scName, b.out && { color: TXT_FAINT }]} numberOfLines={1}>
            {b.name}{b.out ? "  (out)" : "  *"}
          </Text>
          <Text style={[s.batRB, s.colRB]}>{b.runs} ({b.balls})</Text>
          <Text style={[s.batN, s.colN]}>{b.fours}</Text>
          <Text style={[s.batN, s.colN]}>{b.sixes}</Text>
        </View>
      ))}
      <View style={[s.tblHead, { marginTop: 12 }]}>
        <Text style={[s.tblHeadTxt, { flex: 1 }]}>BOWLING</Text>
        <Text style={[s.tblHeadTxt, s.colN]}>O</Text>
        <Text style={[s.tblHeadTxt, s.colN]}>R</Text>
        <Text style={[s.tblHeadTxt, s.colN]}>W</Text>
      </View>
      {inn.bowlingCard.map((b, i) => (
        <View key={i} style={s.tblRow}>
          <Text style={s.scName} numberOfLines={1}>{b.name}</Text>
          <Text style={[s.batN, s.colN]}>{oversStr(b.balls)}</Text>
          <Text style={[s.batN, s.colN]}>{b.runs}</Text>
          <Text style={[s.batN, s.colN, { color: TEXT_DARK, fontWeight: "800" }]}>{b.wickets}</Text>
        </View>
      ))}
      <Text style={s.scExtras}>
        Extras {extraTotal} (Wd {extras?.wides || 0}, Nb {extras?.noballs || 0}, B {extras?.byes || 0}, Lb {extras?.legbyes || 0})
      </Text>
      {(inn.timeline || []).length > 0 && (
        <>
          <Text style={[s.tblHeadTxt, { marginTop: 14, marginBottom: 4 }]}>OVER BY OVER</Text>
          <OversList timeline={inn.timeline} />
        </>
      )}
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: PAGE_BG },
  page: { padding: 14, gap: 12, paddingBottom: 40 },

  // header
  header: {
    backgroundColor: BRAND, flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: 12, paddingTop: Platform.OS === "android" ? 40 : 12, paddingBottom: 16,
  },
  heroHeader: { flexDirection: "column", alignItems: "stretch", gap: 14, paddingBottom: 24 },
  headerTopRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  headerBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: HEADER_BTN, alignItems: "center", justifyContent: "center" },
  headerTitle: { color: "#FFFFFF", fontSize: 17, fontWeight: "800" },
  headerSub: { color: HEADER_SUB, fontSize: 11, marginTop: 2 },
  heroCenter: { alignItems: "center", gap: 6 },
  heroBig: { color: "#FFFFFF", fontSize: 24, fontWeight: "900", textAlign: "center", marginTop: 4 },
  heroSub: { color: HEADER_SUB, fontSize: 14, fontWeight: "600" },
  trophy: { width: 64, height: 64, borderRadius: 32, backgroundColor: GOLD, alignItems: "center", justifyContent: "center" },
  targetPill: { backgroundColor: GOLD, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 7, marginTop: 8 },
  targetPillTxt: { color: AMBER_DARK, fontWeight: "800", fontSize: 14 },

  // cards
  card: {
    backgroundColor: CARD_BG, borderRadius: 18, borderWidth: 1, borderColor: CARD_BORDER, padding: 16,
    shadowColor: "#0F2C20", shadowOpacity: 0.04, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 1,
  },
  secLabel: { color: BRAND, fontSize: 11, fontWeight: "800", letterSpacing: 0.6, marginBottom: 12 },
  divider: { height: 1, backgroundColor: DIVIDER, marginVertical: 14 },
  emptyTxt: { color: TEXT_GRAY, fontSize: 13 },

  // setup
  teamsRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  teamInputWrap: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: INPUT_BG, borderRadius: 12, paddingHorizontal: 10, height: 52 },
  teamInput: { flex: 1, color: TEXT_DARK, fontSize: 15, fontWeight: "700", paddingVertical: 0 },
  teamDot: { alignItems: "center", justifyContent: "center" },
  teamDotTxt: { color: "#FFFFFF", fontWeight: "800" },
  vsBadge: { width: 32, height: 32, borderRadius: 16, backgroundColor: TEXT_DARK, alignItems: "center", justifyContent: "center" },
  vsTxt: { color: "#FFFFFF", fontSize: 11, fontWeight: "900" },

  formatRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  rowTitle: { color: TEXT_DARK, fontSize: 15, fontWeight: "800" },
  rowSub: { color: TEXT_GRAY, fontSize: 12, marginTop: 2 },
  rowSubLong: { color: TEXT_MID, fontSize: 12, lineHeight: 17, marginTop: 3 },

  stepBig: { flexDirection: "row", alignItems: "center", backgroundColor: INPUT_BG, borderRadius: 12 },
  stepBigBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  stepBigVal: { minWidth: 34, textAlign: "center", fontSize: 20, fontWeight: "900", color: TEXT_DARK },
  stepSmall: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  stepSmallBtn: { width: 38, height: 38, borderRadius: 10, borderWidth: 1, borderColor: CTRL_BORDER, backgroundColor: CARD_BG, alignItems: "center", justifyContent: "center" },
  stepSmallVal: { fontSize: 20, fontWeight: "900", color: TEXT_DARK },
  stepMinus: { fontSize: 22, fontWeight: "700", color: TEXT_DARK, lineHeight: 24 },
  stepPlus: { fontSize: 22, fontWeight: "700", color: BRAND, lineHeight: 24 },

  overChips: { flexDirection: "row", gap: 6, marginTop: 12 },
  overChip: { flex: 1, height: 38, borderRadius: 10, borderWidth: 1, borderColor: CTRL_BORDER, backgroundColor: CARD_BG, alignItems: "center", justifyContent: "center" },
  overChipOn: { backgroundColor: GREEN_SOFT, borderColor: BRAND, borderWidth: 1.5 },
  overChipTxt: { color: "#344054", fontWeight: "800", fontSize: 13 },
  overChipTxtOn: { color: BRAND },

  playersGrid: { flexDirection: "row", gap: 10, marginTop: 10 },
  playerBox: { flex: 1, backgroundColor: INPUT_BG, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, gap: 6 },
  playerBoxLbl: { color: TEXT_MID, fontSize: 12, fontWeight: "700" },

  segment: { flexDirection: "row", backgroundColor: INPUT_BG, borderRadius: 12, padding: 4, gap: 4 },
  segBtn: { flex: 1, height: 44, borderRadius: 10, alignItems: "center", justifyContent: "center", paddingHorizontal: 8 },
  segBtnOn: { backgroundColor: BRAND },
  segTxt: { color: TEXT_MID, fontWeight: "800", fontSize: 14 },
  segTxtOn: { color: "#FFFFFF" },

  switchTrack: { width: 52, height: 30, borderRadius: 15, backgroundColor: "#D0D5DD", padding: 3, justifyContent: "center" },
  switchTrackOn: { backgroundColor: GREEN },
  switchThumb: { width: 24, height: 24, borderRadius: 12, backgroundColor: "#FFFFFF", alignSelf: "flex-start" },
  switchThumbOn: { alignSelf: "flex-end" },

  primaryBtn: { flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center", backgroundColor: BRAND, borderRadius: 14, height: 56 },
  primaryBtnTxt: { color: "#FFFFFF", fontWeight: "900", fontSize: 16 },

  histRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, borderTopWidth: 1, borderTopColor: DIVIDER },
  histIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: "#FEF3C7", alignItems: "center", justifyContent: "center" },
  histTeams: { color: TEXT_DARK, fontWeight: "800", fontSize: 13 },
  histSummary: { color: TEXT_GRAY, fontSize: 11, marginTop: 2 },
  histResult: { color: BRAND, fontSize: 11, marginTop: 2, fontWeight: "800" },

  // live — score card
  board: {
    backgroundColor: SCORE_BG, borderRadius: 20, padding: 16, gap: 10,
    shadowColor: "#101828", shadowOpacity: 0.18, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 6,
  },
  boardTopRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  boardTeamRow: { flexDirection: "row", alignItems: "center", gap: 8, flex: 1 },
  boardTeam: { color: "#FFFFFF", fontWeight: "800", fontSize: 14, flex: 1 },
  innBadge: { backgroundColor: ON_DARK_SURF, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  innBadgeTxt: { color: "#FFFFFF", fontSize: 11, fontWeight: "800" },
  boardScoreRow: { flexDirection: "row", alignItems: "flex-end", gap: 10 },
  boardScore: { color: "#FFFFFF", fontSize: 48, fontWeight: "900", lineHeight: 52 },
  boardOvers: { color: ON_DARK_DIM, fontSize: 14, marginBottom: 8 },
  boardStatRow: { flexDirection: "row", justifyContent: "space-between", flexWrap: "wrap", gap: 6 },
  boardStat: { color: ON_DARK_DIM, fontSize: 12, fontWeight: "700" },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: ON_DARK_SURF, overflow: "hidden" },
  progressFill: { height: "100%", backgroundColor: GREEN_BAR, borderRadius: 3 },
  thisOverRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingTop: 10, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.12)" },
  thisOverLbl: { color: ON_DARK_DIM, fontSize: 11, fontWeight: "700" },
  ballDotsRow: { flex: 1, flexDirection: "row", flexWrap: "wrap", gap: 6 },
  ballDot: { minWidth: 30, height: 30, borderRadius: 15, paddingHorizontal: 6, alignItems: "center", justifyContent: "center" },
  ballDotEmpty: { width: 30, height: 30, borderRadius: 15, borderWidth: 1.5, borderStyle: "dashed", borderColor: "rgba(255,255,255,0.3)" },
  ballDotTxt: { fontSize: 11, fontWeight: "800" },

  // tables
  tblHead: { flexDirection: "row", alignItems: "center", marginBottom: 6 },
  tblHeadTxt: { color: TEXT_GRAY, fontSize: 10, fontWeight: "800", letterSpacing: 0.6 },
  tblRow: { flexDirection: "row", alignItems: "center", paddingVertical: 4 },
  colRB: { width: 64, textAlign: "right" },
  colN: { width: 34, textAlign: "right" },
  strikerName: { flex: 1, flexDirection: "row", alignItems: "center", gap: 6 },
  strikeDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: GREEN },
  batNameOn: { color: TEXT_DARK, fontSize: 14, fontWeight: "800", flex: 1 },
  batNameOff: { color: TEXT_MID, fontSize: 14, fontWeight: "600", flex: 1, paddingLeft: 14 },
  batRB: { color: TEXT_DARK, fontSize: 14, fontWeight: "900" },
  batN: { color: TEXT_MID, fontSize: 14 },
  bowlRow: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  bowlName: { color: TEXT_DARK, fontSize: 14, fontWeight: "800", marginTop: 2 },
  bowlFig: { color: TEXT_DARK, fontSize: 14, fontWeight: "800" },

  // tabs
  tabs: { flexDirection: "row", backgroundColor: CARD_BORDER, borderRadius: 12, padding: 4, gap: 4 },
  tabBtn: { flex: 1, height: 40, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  tabBtnOn: { backgroundColor: CARD_BG, shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 2, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  tabTxt: { color: TEXT_MID, fontSize: 13, fontWeight: "700" },
  tabTxtOn: { color: BRAND, fontWeight: "800" },

  // scoring pad
  pendingBar: { flexDirection: "row", alignItems: "center", backgroundColor: AMBER_SOFT, borderRadius: 12, borderWidth: 1, borderColor: AMBER_LINE, paddingHorizontal: 12, paddingVertical: 10, gap: 8 },
  pendingTxt: { color: AMBER_DARK, fontSize: 12.5, fontWeight: "700", flex: 1 },
  pendingCancel: { color: AMBER_DARK, fontSize: 12, fontWeight: "900" },
  padRow4: { flexDirection: "row", gap: 8 },
  padRow2: { flexDirection: "row", gap: 8 },
  runBtn: { flex: 1, height: 60, borderRadius: 14, borderWidth: 1, borderColor: CTRL_BORDER, backgroundColor: CARD_BG, alignItems: "center", justifyContent: "center" },
  runBtn0: { backgroundColor: INPUT_BG },
  runBtnTxt: { color: TEXT_DARK, fontSize: 24, fontWeight: "900" },
  bigRun: { flex: 1, height: 64, borderRadius: 14, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  bigRunNum: { color: "#FFFFFF", fontSize: 26, fontWeight: "900" },
  bigRunLbl: { color: "rgba(255,255,255,0.92)", fontSize: 12, fontWeight: "800" },
  extraBtn: { flex: 1, height: 46, borderRadius: 12, borderWidth: 1, borderColor: AMBER_LINE, backgroundColor: AMBER_SOFT, alignItems: "center", justifyContent: "center" },
  extraBtnOn: { backgroundColor: "#D97706", borderColor: "#D97706" },
  extraBtnTxt: { color: AMBER_DARK, fontWeight: "800", fontSize: 13 },
  padBottom: { flexDirection: "row", gap: 8 },
  undoBtn: { flex: 1, flexDirection: "row", gap: 6, height: 56, borderRadius: 14, borderWidth: 1, borderColor: CTRL_BORDER, backgroundColor: CARD_BG, alignItems: "center", justifyContent: "center" },
  undoBtnTxt: { color: TEXT_DARK, fontWeight: "800", fontSize: 14 },
  wktBtn: { flex: 2.4, height: 56, borderRadius: 14, backgroundColor: RED, alignItems: "center", justifyContent: "center" },
  wktBtnTxt: { color: "#FFFFFF", fontWeight: "900", fontSize: 17, letterSpacing: 2 },
  tipTxt: { textAlign: "center", color: TEXT_GRAY, fontSize: 11 },

  // over-by-over
  overRow: { flexDirection: "row", alignItems: "center", paddingVertical: 9, borderTopWidth: 1, borderTopColor: DIVIDER, gap: 8 },
  overLeftCol: { width: 70 },
  overNumTxt: { color: TEXT_DARK, fontWeight: "800", fontSize: 12.5 },
  overBowlerTxt: { color: TEXT_GRAY, fontSize: 10.5, marginTop: 1 },
  overBallsRow: { flex: 1, flexDirection: "row", flexWrap: "wrap", gap: 4 },
  overBallChip: { minWidth: 24, height: 24, borderRadius: 12, paddingHorizontal: 5, alignItems: "center", justifyContent: "center" },
  overBallChipTxt: { fontSize: 10.5, fontWeight: "800" },
  overRunsTxt: { color: BRAND, fontWeight: "900", fontSize: 13, minWidth: 34, textAlign: "right" },

  // scorecard
  scHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12, gap: 8 },
  scTitle: { color: TEXT_DARK, fontWeight: "800", fontSize: 14, flex: 1 },
  scScore: { color: BRAND, fontWeight: "900", fontSize: 14 },
  scName: { color: TEXT_DARK, fontSize: 13.5, fontWeight: "600", flex: 1 },
  scExtras: { color: TEXT_GRAY, fontSize: 12, marginTop: 10 },

  // result
  resRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 14 },
  resNameWrap: { flex: 1, flexDirection: "row", alignItems: "center", gap: 6, minWidth: 0 },
  resName: { color: TEXT_MID, fontSize: 15, fontWeight: "700", flexShrink: 1 },
  wonPill: { backgroundColor: BRAND, borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2 },
  wonPillTxt: { color: "#FFFFFF", fontSize: 10, fontWeight: "800" },
  resScore: { color: TEXT_MID, fontSize: 18, fontWeight: "900" },
  resOvers: { color: TEXT_GRAY, fontSize: 12, width: 58, textAlign: "right" },
  perfBox: { flex: 1, backgroundColor: INPUT_BG, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, gap: 2 },
  perfLbl: { color: TEXT_GRAY, fontSize: 11, fontWeight: "700" },
  perfName: { color: TEXT_DARK, fontSize: 14, fontWeight: "800" },
  perfVal: { color: BRAND, fontSize: 13, fontWeight: "900" },
  accHead: { height: 52, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  accTitle: { color: TEXT_DARK, fontSize: 14, fontWeight: "800", flex: 1 },
  resBtns: { flexDirection: "row", gap: 8, marginTop: 4 },
  shareBtn: { flex: 1, height: 56, borderRadius: 14, borderWidth: 1.5, borderColor: "#1FA855", backgroundColor: CARD_BG, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  shareTxt: { color: "#137A3C", fontSize: 14, fontWeight: "800" },
  linkBtn: { height: 46, alignItems: "center", justifyContent: "center" },
  linkBtnTxt: { color: BRAND, fontSize: 13, fontWeight: "800" },

  // modal
  modalBack: { flex: 1, backgroundColor: "rgba(16,24,40,0.55)", alignItems: "center", justifyContent: "center", padding: 24 },
  modalCard: { width: "100%", maxWidth: 360, backgroundColor: CARD_BG, borderRadius: 18, borderWidth: 1, borderColor: CARD_BORDER, padding: 18 },
  modalTitle: { color: TEXT_DARK, fontWeight: "800", fontSize: 15, marginBottom: 12 },
  modalInput: { backgroundColor: INPUT_BG, borderRadius: 10, color: TEXT_DARK, paddingHorizontal: 12, paddingVertical: 11, fontSize: 14 },
  modalRow: { flexDirection: "row", gap: 10, marginTop: 14 },
  modalSkip: { flex: 1, paddingVertical: 12, borderRadius: 10, backgroundColor: INPUT_BG, alignItems: "center" },
  modalSkipTxt: { color: TEXT_GRAY, fontWeight: "800" },
  modalOk: { flex: 1, paddingVertical: 12, borderRadius: 10, backgroundColor: BRAND, alignItems: "center" },
  modalOkTxt: { color: "#FFFFFF", fontWeight: "900" },
});
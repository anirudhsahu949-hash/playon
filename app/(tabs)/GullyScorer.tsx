import {
  View, Text, TextInput, StyleSheet, ScrollView,
  TouchableOpacity, SafeAreaView, StatusBar, Platform, KeyboardAvoidingView,
  Alert, Modal,
} from "react-native";
import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";

// =============================================================================
// 🏏 LOCAL SCOREBOARD — Gully Cricket Scorer (100% offline)
//
//   • No Firestore, no login — everything saved in phone local storage only
//   • Auto-deletes all data 10 hours after the last update
//   • Team names, overs, players-per-team (quick chips, or type any number)
//   • Player names OPTIONAL — auto "Batsman 1/2/3…" when not tracking names
//   • Full 2-innings flow: target, chase, result, then "New Match"
//   • Undo any ball · Wide / No-ball / Bye / Leg-bye · strike rotation
//   • Light stadium theme — white cards, green accents, floodlight banner
//
//   Requires: npx expo install @react-native-async-storage/async-storage
// =============================================================================

const STORE_KEY   = "localScoreboard:active";
const HISTORY_KEY = "localScoreboard:history";
const TTL_MS      = 10 * 60 * 60 * 1000; // 10 hours

// ── Theme (light stadium — white cards, green accents) ─────────────────────────
const PAGE_BG      = "#F5FAF6";
const CARD_BG      = "#FFFFFF";
const CARD_BORDER  = "#E7EEE9";
const INPUT_BG     = "#F3F4F6";
const TEXT_DARK    = "#101828";
const TEXT_GRAY    = "#667085";
const TXT_FAINT    = "#98A2B3";
const GREEN_DARK   = "#15803D";
const GREEN        = "#16A34A";
const GREEN_SOFT   = "#DCFCE7";
const BANNER_1     = "#EAF8EF";
const BANNER_2     = "#CFEEDA";
const BANNER_ICON  = "#7BC79A";
const RED          = "#DC2626";
const RED_SOFT     = "#FEE2E2";
const AMBER        = "#D97706";
const AMBER_DARK   = "#92400E";
const AMBER_SOFT   = "#FEF3C7";
const BLUE         = "#2563EB";
const PURPLE       = "#7C3AED";
// tokens for content sitting on the dark-green hero score card
const ON_DARK_SURF = "rgba(255,255,255,0.16)";
const ON_DARK_DIM  = "rgba(255,255,255,0.78)";

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

// ── Helpers ───────────────────────────────────────────────────────────────────
const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));
const oversStr = (b: number) => `${Math.floor(b / 6)}.${b % 6}`;
const newBat  = (name: string): BatCard  => ({ name, runs: 0, balls: 0, fours: 0, sixes: 0, out: false, dismissal: "" });
const newBowl = (name: string): BowlCard => ({ name, balls: 0, runs: 0, wickets: 0 });

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

// ── Section label — small green icon badge + uppercase green text ─────────────
function SectionLabel({ icon, label, square }: { icon: keyof typeof Ionicons.glyphMap; label: string; square?: boolean }) {
  return (
    <View style={s.secRow}>
      <View style={square ? s.secBadgeSquare : s.secBadge}>
        <Ionicons name={icon} size={13} color={square ? "#FFFFFF" : GREEN_DARK} />
      </View>
      <Text style={s.secLabel}>{label}</Text>
    </View>
  );
}

// ── iOS-style toggle switch ─────────────────────────────────────────────────────
function Switch({ value, onToggle }: { value: boolean; onToggle: () => void }) {
  return (
    <TouchableOpacity activeOpacity={0.85} onPress={onToggle} style={[s.switchTrack, value && s.switchTrackOn]}>
      <View style={[s.switchThumb, value && s.switchThumbOn]} />
    </TouchableOpacity>
  );
}

// ── Over-by-over history — every over stays visible after it ends ─────────────
function OversSummary({ timeline }: { timeline: Ball[] }) {
  const overs = groupOvers(timeline).slice().reverse(); // most recent first
  if (overs.length === 0) return null;
  return (
    <View style={s.card}>
      <SectionLabel icon="list-outline" label="OVER BY OVER" />
      {overs.map((o) => (
        <View key={o.overNum} style={s.overRow}>
          <View style={s.overLeftCol}>
            <Text style={s.overNumTxt}>Ov {o.overNum}{o.live ? " •" : ""}</Text>
            {!!o.bowler && <Text style={s.overBowlerTxt} numberOfLines={1}>{o.bowler}</Text>}
          </View>
          <View style={s.overBallsRow}>
            {o.balls.map((b, i) => (
              <View key={i} style={[
                s.overBallChip,
                b.w && s.overBallChipW,
                !b.w && b.runs === 4 && s.overBallChip4,
                !b.w && b.runs === 6 && s.overBallChip6,
              ]}>
                <Text style={[s.overBallChipTxt, (b.w || b.runs === 4 || b.runs === 6) && { color: "#fff" }]}>{b.label}</Text>
              </View>
            ))}
          </View>
          <Text style={s.overRunsTxt}>{o.runs}{o.wkts ? `-${o.wkts}` : ""}</Text>
        </View>
      ))}
    </View>
  );
}

// ── Decorative stadium banner — floodlights, stumps, curved field horizon ──────
function Floodlight() {
  return (
    <View style={fb.floodWrap}>
      <View style={fb.floodHead}>
        {Array.from({ length: 8 }).map((_, i) => <View key={i} style={fb.floodBulb} />)}
      </View>
      <View style={fb.floodPole} />
    </View>
  );
}

function FieldBanner() {
  return (
    <View style={fb.wrap}>
      <View style={fb.curve} />
      <View style={fb.row}>
        <Floodlight />
        <View style={fb.stumpGroup}>
          <View style={fb.stump} /><View style={fb.stump} /><View style={fb.stump} />
        </View>
        <View style={fb.dotsRow}>
          {[0, 1, 2, 3, 4].map((i) => <View key={i} style={[fb.dot, i === 0 && fb.dotOn]} />)}
        </View>
        <View style={fb.stumpGroup}>
          <View style={fb.stump} /><View style={fb.stump} /><View style={fb.stump} />
        </View>
        <Floodlight />
      </View>
    </View>
  );
}

const fb = StyleSheet.create({
  wrap: {
    height: 140, marginHorizontal: 14, marginTop: 6, marginBottom: 4,
    borderRadius: 20, overflow: "hidden", backgroundColor: BANNER_1,
  },
  curve: {
    position: "absolute", left: "-25%", right: "-25%", bottom: -34, height: 92,
    backgroundColor: BANNER_2, borderTopLeftRadius: 300, borderTopRightRadius: 300,
  },
  row: {
    flex: 1, flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between",
    paddingHorizontal: 18, paddingBottom: 24,
  },
  floodWrap: { alignItems: "center" },
  floodHead: { width: 32, flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 3, marginBottom: 2 },
  floodBulb: { width: 6, height: 6, borderRadius: 3, backgroundColor: BANNER_ICON },
  floodPole: { width: 2.5, height: 38, backgroundColor: BANNER_ICON },
  stumpGroup: { flexDirection: "row", gap: 3, marginBottom: 10 },
  stump: { width: 3, height: 26, backgroundColor: BANNER_ICON, borderRadius: 2 },
  dotsRow: { flexDirection: "row", gap: 6, marginBottom: 14 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#B9DFC4" },
  dotOn: { backgroundColor: GREEN_DARK, width: 8, height: 8, borderRadius: 4 },
});

// =============================================================================
export default function LocalScoreboard() {
  const router = useRouter();

  const [loaded, setLoaded]   = useState(false);
  const [sc, setSc]           = useState<MatchState | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const historyRef            = useRef<string[]>([]); // undo stack (in-memory)

  // setup form
  const [teamA, setTeamA]         = useState("Team A");
  const [teamB, setTeamB]         = useState("Team B");
  const [oversTxt, setOversTxt]   = useState("6");
  const [playersATxt, setPlayersATxt] = useState("6");
  const [playersBTxt, setPlayersBTxt] = useState("6");
  const playersA = Math.max(2, Math.min(30, parseInt(playersATxt, 10) || 0));
  const playersB = Math.max(2, Math.min(30, parseInt(playersBTxt, 10) || 0));
  const [batFirst, setBatFirst]   = useState<"A" | "B">("A");
  const [trackNames, setTrackNames] = useState(false);

  // prompts
  const [namePrompt, setNamePrompt] = useState<null | { kind: "batsman" | "bowler"; title: string }>(null);
  const [promptTxt, setPromptTxt]   = useState("");
  const pendingAfterName            = useRef<((name: string) => void) | null>(null);
  const [pendingExtra, setPendingExtra] = useState<null | "Wd" | "Nb" | "B" | "Lb">(null);
  const [showCard, setShowCard]     = useState(false);

  // ── Load + 10-hour auto-expiry ──────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const now = Date.now();
        // active match
        const raw = await AsyncStorage.getItem(STORE_KEY);
        if (raw) {
          const saved = JSON.parse(raw);
          if (saved?.savedAt && now - saved.savedAt < TTL_MS && saved.state) {
            setSc(saved.state);
          } else {
            await AsyncStorage.removeItem(STORE_KEY); // expired → delete
          }
        }
        // history (each entry expires individually)
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

  // ── Start match ─────────────────────────────────────────────────────────────
  const startMatch = () => {
    const ov = Number(oversTxt);
    if (!ov || ov < 1 || ov > 50) return Alert.alert("Overs", "Enter overs per innings (1–50).");
    const a = teamA.trim() || "Team A";
    const b = teamB.trim() || "Team B";
    const batName  = batFirst === "A" ? a : b;
    const bowlName = batFirst === "A" ? b : a;
    const batPlayers = batFirst === "A" ? playersA : playersB;

    const base: MatchState = {
      createdAt: Date.now(),
      teamAName: a, teamBName: b,
      oversLimit: ov, playersA, playersB, trackNames,
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
      commit(base);
    };

    if (!trackNames) { begin("", "", ""); return; }
    // named mode: 3 quick prompts, each skippable
    askName("batsman", "Opening batsman (striker)", (n1) =>
      askName("batsman", "Opening batsman (non-striker)", (n2) =>
        askName("bowler", "Opening bowler", (bw) => begin(n1, n2, bw))));
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
        next.result = `${next.battingTeamName} won by ${left} wicket${left === 1 ? "" : "s"} 🏆`;
      } else if (next.target != null && next.runs === next.target - 1) {
        next.result = "Match tied 🤝";
      } else {
        const by = (next.target ?? 1) - 1 - next.runs;
        next.result = `${next.bowlingTeamName} won by ${by} run${by === 1 ? "" : "s"} 🏆`;
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
      commit(next);
    };

    if (!sc.trackNames) { begin("", "", ""); return; }
    askName("batsman", "Opening batsman (striker)", (n1) =>
      askName("batsman", "Opening batsman (non-striker)", (n2) =>
        askName("bowler", "Opening bowler", (bw) => begin(n1, n2, bw))));
  };

  // ── Ball engine ─────────────────────────────────────────────────────────────
  const swapStrike = (n: MatchState) => { const t = n.strikerIdx; n.strikerIdx = n.nonStrikerIdx; n.nonStrikerIdx = t; };

  const afterLegalBall = (next: MatchState) => {
    // over complete?
    if (next.balls % 6 === 0 && next.status === "live") {
      swapStrike(next);
      // new bowler each over
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
    const allOut   = next.wickets >= next.maxWickets;
    const oversDone = next.balls >= next.oversLimit * 6;
    const chased   = next.innings === 2 && next.target != null && next.runs >= next.target;
    if (allOut || oversDone || chased) endInnings(next);
  };

  const scoreRuns = (r: number) => {
    if (!sc || sc.status !== "live") return;

    // extras pending → this tap is "runs with the extra"
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
      // not a legal ball
    } else if (kind === "Nb") {
      next.runs += 1 + extraRuns; next.extras.noballs += 1;
      bwl.runs += 1 + extraRuns;
      bat.runs += extraRuns; bat.balls += 1; // batsman gets the runs off a no-ball
      if (extraRuns === 4) bat.fours += 1;
      if (extraRuns === 6) bat.sixes += 1;
      next.timeline.push({ label: extraRuns ? `Nb+${extraRuns}` : "Nb", runs: 1 + extraRuns, w: false, bowler: bwl.name });
      if (extraRuns % 2 === 1) swapStrike(next);
      // not a legal ball
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

    // new batsman needed
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
      "Local Scoreboard",
      "Everything you score here stays only on this phone — nothing is uploaded. The match (and your recent match history) is deleted automatically 10 hours after the last update."
    );
  };

  // ── Derived ─────────────────────────────────────────────────────────────────
  const striker  = sc?.battingCard[sc.strikerIdx];
  const nonStrk  = sc?.battingCard[sc.nonStrikerIdx];
  const bowler   = sc?.bowlingCard[sc.bowlerIdx];
  const crr      = sc && sc.balls > 0 ? ((sc.runs * 6) / sc.balls).toFixed(2) : "0.00";
  const ballsLeft = sc ? sc.oversLimit * 6 - sc.balls : 0;
  const rrr      = sc && sc.innings === 2 && sc.target != null && ballsLeft > 0
    ? (((sc.target - sc.runs) * 6) / ballsLeft).toFixed(2) : null;

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
    return tl.slice(start);
  })();

  if (!loaded) return <SafeAreaView style={s.safe} />;

  // ══════════════════════════════════════════════════════════════════════════
  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="dark-content" backgroundColor={PAGE_BG} />

      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10} style={s.iconBtn}>
          <Ionicons name="chevron-back" size={20} color={TEXT_DARK} />
        </TouchableOpacity>
        <View style={s.headerIconBadge}>
          <Text style={{ fontSize: 20 }}>🏏</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.headerTitle}>Local Scoreboard</Text>
          <Text style={s.headerSub}>Offline  ·  Saved on this phone  ·  Auto-deletes in 10 hrs</Text>
        </View>
        {sc && (
          <TouchableOpacity style={s.resetBtn} onPress={resetAll}>
            <Ionicons name="refresh" size={16} color={RED} />
          </TouchableOpacity>
        )}
        <TouchableOpacity style={s.iconBtn} onPress={showInfo}>
          <Ionicons name="settings-outline" size={19} color={TEXT_DARK} />
        </TouchableOpacity>
      </View>

      <ScrollView keyboardDismissMode="interactive" automaticallyAdjustKeyboardInsets keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>

        {/* ════════ SETUP ════════ */}
        {!sc && (
          <View style={s.wrap}>
            <FieldBanner />
            <View style={s.card}>
              <SectionLabel icon="people" label="TEAMS" />
              <View style={s.row2}>
                <TextInput style={[s.input, { flex: 1 }]} value={teamA} onChangeText={setTeamA}
                  placeholder="Team A" placeholderTextColor={TXT_FAINT} maxLength={20} />
                <Text style={s.vsTxt}>vs</Text>
                <TextInput style={[s.input, { flex: 1 }]} value={teamB} onChangeText={setTeamB}
                  placeholder="Team B" placeholderTextColor={TXT_FAINT} maxLength={20} />
              </View>

              <View style={{ marginTop: 18 }}><SectionLabel icon="timer-outline" label="OVERS PER INNINGS" /></View>
              <View style={s.chipRow}>
                {[2, 4, 5, 6, 8, 10, 12].map((o) => (
                  <TouchableOpacity key={o} style={[s.chip, oversTxt === String(o) && s.chipOn]} onPress={() => setOversTxt(String(o))}>
                    <Text style={[s.chipTxt, oversTxt === String(o) && s.chipTxtOn]}>{o}</Text>
                  </TouchableOpacity>
                ))}
                <TextInput style={[s.input, s.chipInput]} value={oversTxt} onChangeText={setOversTxt}
                  placeholder="#" placeholderTextColor={TXT_FAINT} keyboardType="number-pad" maxLength={2} />
              </View>

              <View style={{ marginTop: 18 }}><SectionLabel icon="person" label={`PLAYERS — ${teamA.trim() || "TEAM A"}`} /></View>
              <View style={s.chipRow}>
                {[5, 6, 7, 8, 9, 10, 11, 12].map((n) => (
                  <TouchableOpacity key={n} style={[s.chip, playersA === n && s.chipOn]} onPress={() => setPlayersATxt(String(n))}>
                    <Text style={[s.chipTxt, playersA === n && s.chipTxtOn]}>{n}</Text>
                  </TouchableOpacity>
                ))}
                <TextInput style={[s.input, s.chipInput]} value={playersATxt} onChangeText={setPlayersATxt}
                  placeholder="#" placeholderTextColor={TXT_FAINT} keyboardType="number-pad" maxLength={2} />
              </View>

              <View style={{ marginTop: 14 }}><SectionLabel icon="person" label={`PLAYERS — ${teamB.trim() || "TEAM B"}`} /></View>
              <View style={s.chipRow}>
                {[5, 6, 7, 8, 9, 10, 11, 12].map((n) => (
                  <TouchableOpacity key={n} style={[s.chip, playersB === n && s.chipOn]} onPress={() => setPlayersBTxt(String(n))}>
                    <Text style={[s.chipTxt, playersB === n && s.chipTxtOn]}>{n}</Text>
                  </TouchableOpacity>
                ))}
                <TextInput style={[s.input, s.chipInput]} value={playersBTxt} onChangeText={setPlayersBTxt}
                  placeholder="#" placeholderTextColor={TXT_FAINT} keyboardType="number-pad" maxLength={2} />
              </View>

              <View style={{ marginTop: 18 }}><SectionLabel icon="flag-outline" label="BATTING FIRST" /></View>
              <View style={s.row2}>
                <TouchableOpacity style={[s.batFirstBtn, batFirst === "A" && s.batFirstOn]} onPress={() => setBatFirst("A")}>
                  <Text style={[s.batFirstTxt, batFirst === "A" && s.batFirstTxtOn]} numberOfLines={1}>{teamA.trim() || "Team A"}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[s.batFirstBtn, batFirst === "B" && s.batFirstOn]} onPress={() => setBatFirst("B")}>
                  <Text style={[s.batFirstTxt, batFirst === "B" && s.batFirstTxtOn]} numberOfLines={1}>{teamB.trim() || "Team B"}</Text>
                </TouchableOpacity>
              </View>

              <View style={s.toggleRow}>
                <View style={s.secBadgeSquare}><Ionicons name="people" size={14} color="#FFFFFF" /></View>
                <View style={{ flex: 1 }}>
                  <Text style={s.toggleTitle}>Track player names (optional)</Text>
                  <Text style={s.toggleSub}>Off = auto names like "Batsman 1", "Bowler 2"</Text>
                </View>
                <Switch value={trackNames} onToggle={() => setTrackNames((v) => !v)} />
              </View>

              <TouchableOpacity style={s.startBtn} onPress={startMatch} activeOpacity={0.9}>
                <Ionicons name="play" size={18} color="#FFFFFF" />
                <Text style={s.startBtnTxt}>Start Match</Text>
              </TouchableOpacity>
            </View>

            {/* Recent local matches */}
            {history.length > 0 && (
              <View style={[s.card, { marginTop: 14 }]}>
                <SectionLabel icon="time-outline" label="RECENT MATCHES (LAST 10 HRS)" />
                {history.map((h, i) => (
                  <View key={i} style={s.histRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.histTeams} numberOfLines={1}>{h.teams}</Text>
                      <Text style={s.histSummary} numberOfLines={1}>{h.summary}</Text>
                      {!!h.result && <Text style={s.histResult} numberOfLines={1}>{h.result}</Text>}
                    </View>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}

        {/* ════════ INNINGS BREAK ════════ */}
        {sc?.status === "innings_break" && (
          <View style={s.wrap}>
            <View style={[s.card, { alignItems: "center", paddingVertical: 28 }]}>
              <Text style={s.breakTitle}>INNINGS BREAK</Text>
              <Text style={s.breakScore}>{sc.innings1!.teamName}  {sc.innings1!.runs}/{sc.innings1!.wickets}</Text>
              <Text style={s.breakOvers}>({oversStr(sc.innings1!.balls)} overs)</Text>
              <View style={s.targetPill}>
                <Text style={s.targetPillTxt}>Target: {sc.target} runs</Text>
              </View>
              <TouchableOpacity style={[s.startBtn, { alignSelf: "stretch", marginTop: 22 }]} onPress={startInnings2} activeOpacity={0.9}>
                <Ionicons name="play" size={18} color="#FFFFFF" />
                <Text style={s.startBtnTxt}>Start 2nd Innings</Text>
              </TouchableOpacity>
            </View>
            {renderScorecard(sc.innings1!, "1st Innings")}
          </View>
        )}

        {/* ════════ LIVE ════════ */}
        {sc?.status === "live" && (
          <View style={s.wrap}>
            {/* Scoreboard hero card */}
            <View style={s.board}>
              <View style={s.boardTopRow}>
                <Text style={s.boardTeam} numberOfLines={1}>{sc.battingTeamName}</Text>
                <View style={s.innBadge}><Text style={s.innBadgeTxt}>{sc.innings === 1 ? "1st Inn" : "2nd Inn"}</Text></View>
              </View>
              <View style={s.boardScoreRow}>
                <Text style={s.boardScore}>{sc.runs}/{sc.wickets}</Text>
                <Text style={s.boardOvers}>({oversStr(sc.balls)} / {sc.oversLimit} ov)</Text>
              </View>
              <View style={s.boardStatRow}>
                <Text style={s.boardStat}>CRR {crr}</Text>
                {rrr && <Text style={s.boardStat}>RRR {rrr}</Text>}
                {sc.innings === 2 && sc.target != null && (
                  <Text style={[s.boardStat, { color: "#FDE68A" }]}>
                    Need {Math.max(0, sc.target - sc.runs)} in {ballsLeft} balls
                  </Text>
                )}
              </View>
              {/* this over */}
              <View style={s.ballDotsRow}>
                {currentOverBalls.length === 0 && <Text style={s.ballDotsEmpty}>New over</Text>}
                {currentOverBalls.map((b, i) => (
                  <View key={i} style={[s.ballDot, b.w ? s.ballDotW : b.runs >= 4 ? s.ballDotB : null]}>
                    <Text style={[s.ballDotTxt, b.w && { color: "#fff" }, !b.w && b.runs >= 4 && { color: GREEN_DARK }]}>{b.label}</Text>
                  </View>
                ))}
              </View>
            </View>

            {/* Batsmen + bowler mini card */}
            <View style={s.miniCard}>
              <View style={{ flex: 1 }}>
                <Text style={s.miniHdr}>BATTING</Text>
                <View style={s.miniRow}>
                  <Text style={[s.miniName, { color: TEXT_DARK }]} numberOfLines={1}>{striker?.name} *</Text>
                  <Text style={s.miniVal}>{striker?.runs} ({striker?.balls})</Text>
                </View>
                <View style={s.miniRow}>
                  <Text style={s.miniName} numberOfLines={1}>{nonStrk?.name}</Text>
                  <Text style={s.miniVal}>{nonStrk?.runs} ({nonStrk?.balls})</Text>
                </View>
              </View>
              <View style={s.miniDiv} />
              <View style={{ flex: 1 }}>
                <Text style={s.miniHdr}>BOWLING</Text>
                <View style={s.miniRow}>
                  <Text style={[s.miniName, { color: TEXT_DARK }]} numberOfLines={1}>{bowler?.name}</Text>
                  <Text style={s.miniVal}>{bowler?.wickets}/{bowler?.runs}</Text>
                </View>
                <Text style={s.miniExtras}>Wd {sc.extras.wides} · Nb {sc.extras.noballs} · B {sc.extras.byes} · Lb {sc.extras.legbyes}</Text>
              </View>
            </View>

            {/* Toggle scorecard */}
            <TouchableOpacity style={s.cardToggle} onPress={() => setShowCard((v) => !v)}>
              <Ionicons name={showCard ? "keypad-outline" : "reader-outline"} size={15} color={GREEN_DARK} />
              <Text style={s.cardToggleTxt}>{showCard ? "Back to scoring pad" : "Full scorecard"}</Text>
            </TouchableOpacity>

            {showCard ? (
              <>
                {renderScorecard({
                  teamName: sc.battingTeamName, runs: sc.runs, wickets: sc.wickets, balls: sc.balls,
                  extras: sc.extras, battingCard: sc.battingCard, bowlingCard: sc.bowlingCard, timeline: sc.timeline,
                }, sc.innings === 1 ? "1st Innings" : "2nd Innings")}
                {sc.innings1 && renderScorecard(sc.innings1, "1st Innings")}
              </>
            ) : (
              <>
                {/* pending extra hint */}
                {pendingExtra && (
                  <View style={s.pendingBar}>
                    <Text style={s.pendingTxt}>
                      {pendingExtra === "Wd" ? "Wide" : pendingExtra === "Nb" ? "No-ball" : pendingExtra === "B" ? "Byes" : "Leg-byes"} — now tap the runs (0 if none)
                    </Text>
                    <TouchableOpacity onPress={() => setPendingExtra(null)}><Text style={s.pendingCancel}>Cancel</Text></TouchableOpacity>
                  </View>
                )}

                {/* Run pad */}
                <View style={s.padGrid}>
                  {[0, 1, 2, 3, 4, 6].map((r) => (
                    <TouchableOpacity key={r} style={[s.runBtn, r === 4 && s.runBtn4, r === 6 && s.runBtn6, r === 0 && s.runBtn0]}
                      onPress={() => scoreRuns(r)} activeOpacity={0.85}>
                      <Text style={[s.runBtnTxt, (r === 4 || r === 6) && { color: "#fff" }]}>{r}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {/* Extras */}
                <View style={s.extraRow}>
                  {(["Wd", "Nb", "B", "Lb"] as const).map((k) => (
                    <TouchableOpacity key={k} style={[s.extraBtn, pendingExtra === k && s.extraBtnOn]}
                      onPress={() => setPendingExtra(pendingExtra === k ? null : k)} activeOpacity={0.85}>
                      <Text style={[s.extraBtnTxt, pendingExtra === k && { color: "#fff" }]}>{k}</Text>
                    </TouchableOpacity>
                  ))}
                  <TouchableOpacity style={s.undoBtn} onPress={undo} activeOpacity={0.85}>
                    <Ionicons name="arrow-undo" size={16} color={TEXT_DARK} />
                    <Text style={s.undoBtnTxt}>Undo</Text>
                  </TouchableOpacity>
                </View>

                {/* Wicket */}
                <TouchableOpacity style={s.wktBtn} onPress={takeWicket} activeOpacity={0.9}>
                  <Text style={s.wktBtnTxt}>WICKET</Text>
                </TouchableOpacity>

                {/* Over-by-over — every completed over stays visible */}
                <OversSummary timeline={sc.timeline} />
              </>
            )}
          </View>
        )}

        {/* ════════ COMPLETED ════════ */}
        {sc?.status === "completed" && (
          <View style={s.wrap}>
            <View style={[s.card, { alignItems: "center", paddingVertical: 26 }]}>
              <Ionicons name="trophy" size={34} color={AMBER} />
              <Text style={s.resultTxt}>{sc.result}</Text>
              <Text style={s.resultLine}>
                {sc.innings1!.teamName} {sc.innings1!.runs}/{sc.innings1!.wickets} ({oversStr(sc.innings1!.balls)})
              </Text>
              <Text style={s.resultLine}>
                {sc.battingTeamName} {sc.runs}/{sc.wickets} ({oversStr(sc.balls)})
              </Text>
              <TouchableOpacity style={[s.startBtn, { alignSelf: "stretch", marginTop: 20 }]}
                onPress={() => { historyRef.current = []; persist(null); }} activeOpacity={0.9}>
                <Ionicons name="add" size={18} color="#FFFFFF" />
                <Text style={s.startBtnTxt}>New Match</Text>
              </TouchableOpacity>
            </View>
            {renderScorecard({
              teamName: sc.battingTeamName, runs: sc.runs, wickets: sc.wickets, balls: sc.balls,
              extras: sc.extras, battingCard: sc.battingCard, bowlingCard: sc.bowlingCard, timeline: sc.timeline,
            }, "2nd Innings")}
            {renderScorecard(sc.innings1!, "1st Innings")}
          </View>
        )}
      </ScrollView>

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
function renderScorecard(inn: InningsSnap, title: string) {
  const extras = inn.extras;
  const extraTotal = (extras?.wides || 0) + (extras?.noballs || 0) + (extras?.byes || 0) + (extras?.legbyes || 0);
  return (
    <View style={s.card} key={title}>
      <View style={s.scHead}>
        <Text style={s.scTitle}>{title} — {inn.teamName}</Text>
        <Text style={s.scScore}>{inn.runs}/{inn.wickets} ({oversStr(inn.balls)})</Text>
      </View>
      <Text style={s.scColHdr}>Batting</Text>
      {inn.battingCard.map((b, i) => (
        <View key={i} style={s.scRow}>
          <Text style={[s.scName, b.out && { color: TXT_FAINT }]} numberOfLines={1}>
            {b.name}{b.out ? "  (out)" : ""}
          </Text>
          <Text style={s.scVal}>{b.runs} ({b.balls})  4s:{b.fours} 6s:{b.sixes}</Text>
        </View>
      ))}
      <Text style={[s.scColHdr, { marginTop: 10 }]}>Bowling</Text>
      {inn.bowlingCard.map((b, i) => (
        <View key={i} style={s.scRow}>
          <Text style={s.scName} numberOfLines={1}>{b.name}</Text>
          <Text style={s.scVal}>{oversStr(b.balls)} ov · {b.runs} r · {b.wickets} w</Text>
        </View>
      ))}
      <Text style={s.scExtras}>Extras {extraTotal} (Wd {extras?.wides || 0}, Nb {extras?.noballs || 0}, B {extras?.byes || 0}, Lb {extras?.legbyes || 0})</Text>

      {(() => {
        const overs = groupOvers(inn.timeline || []);
        if (overs.length === 0) return null;
        return (
          <>
            <Text style={[s.scColHdr, { marginTop: 10 }]}>Over by over</Text>
            {overs.slice().reverse().map((o) => (
              <View key={o.overNum} style={s.overRow}>
                <View style={s.overLeftCol}><Text style={s.overNumTxt}>Ov {o.overNum}</Text></View>
                <View style={s.overBallsRow}>
                  {o.balls.map((b, i) => (
                    <View key={i} style={[
                      s.overBallChip,
                      b.w && s.overBallChipW,
                      !b.w && b.runs === 4 && s.overBallChip4,
                      !b.w && b.runs === 6 && s.overBallChip6,
                    ]}>
                      <Text style={[s.overBallChipTxt, (b.w || b.runs === 4 || b.runs === 6) && { color: "#fff" }]}>{b.label}</Text>
                    </View>
                  ))}
                </View>
                <Text style={s.overRunsTxt}>{o.runs}{o.wkts ? `-${o.wkts}` : ""}</Text>
              </View>
            ))}
          </>
        );
      })()}
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: PAGE_BG, paddingTop: Platform.OS === "android" ? 30 : 0 },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 10, gap: 10 },
  iconBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: CARD_BG, borderWidth: 1, borderColor: CARD_BORDER, alignItems: "center", justifyContent: "center" },
  headerIconBadge: { width: 44, height: 44, borderRadius: 22, backgroundColor: GREEN_SOFT, alignItems: "center", justifyContent: "center" },
  headerTitle: { color: TEXT_DARK, fontSize: 18, fontWeight: "800" },
  headerSub: { color: TEXT_GRAY, fontSize: 11, marginTop: 2 },
  resetBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: RED_SOFT, alignItems: "center", justifyContent: "center" },

  wrap: { paddingHorizontal: 14, gap: 12 },
  card: {
    backgroundColor: CARD_BG, borderRadius: 20, borderWidth: 1, borderColor: CARD_BORDER, padding: 18,
    shadowColor: "#0F2C20", shadowOpacity: 0.05, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 1,
  },

  secRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 },
  secBadge: { width: 24, height: 24, borderRadius: 12, backgroundColor: GREEN_SOFT, alignItems: "center", justifyContent: "center" },
  secBadgeSquare: { width: 26, height: 26, borderRadius: 8, backgroundColor: GREEN, alignItems: "center", justifyContent: "center" },
  secLabel: { color: GREEN_DARK, fontSize: 11, fontWeight: "800", letterSpacing: 0.6 },

  row2: { flexDirection: "row", alignItems: "center", gap: 10 },
  vsTxt: { color: TXT_FAINT, fontWeight: "700" },
  input: { backgroundColor: INPUT_BG, borderRadius: 10, borderWidth: 1, borderColor: "transparent", color: TEXT_DARK, paddingHorizontal: 12, paddingVertical: 11, fontSize: 14, fontWeight: "700" },

  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" },
  chip: { minWidth: 42, paddingVertical: 9, paddingHorizontal: 12, borderRadius: 10, backgroundColor: CARD_BG, borderWidth: 1.5, borderColor: CARD_BORDER, alignItems: "center" },
  chipOn: { backgroundColor: "#FFFFFF", borderColor: GREEN_DARK },
  chipTxt: { color: TEXT_DARK, fontWeight: "700", fontSize: 14 },
  chipTxtOn: { color: GREEN_DARK },
  chipInput: { width: 56, textAlign: "center", paddingVertical: 8, backgroundColor: INPUT_BG },

  batFirstBtn: { flex: 1, paddingVertical: 12, borderRadius: 10, backgroundColor: CARD_BG, borderWidth: 1.5, borderColor: GREEN_DARK, alignItems: "center" },
  batFirstOn: { backgroundColor: GREEN_DARK, borderColor: GREEN_DARK },
  batFirstTxt: { color: GREEN_DARK, fontWeight: "700" },
  batFirstTxtOn: { color: "#FFFFFF" },

  toggleRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 18 },
  toggleTitle: { color: TEXT_DARK, fontWeight: "700", fontSize: 13 },
  toggleSub: { color: TEXT_GRAY, fontSize: 11, marginTop: 1 },
  switchTrack: { width: 46, height: 26, borderRadius: 13, backgroundColor: "#E5E7EB", padding: 3, justifyContent: "center" },
  switchTrackOn: { backgroundColor: GREEN },
  switchThumb: { width: 20, height: 20, borderRadius: 10, backgroundColor: "#FFFFFF", alignSelf: "flex-start" },
  switchThumbOn: { alignSelf: "flex-end" },

  startBtn: { flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center", backgroundColor: GREEN_DARK, borderRadius: 12, paddingVertical: 15, marginTop: 20 },
  startBtnTxt: { color: "#FFFFFF", fontWeight: "900", fontSize: 15 },

  histRow: { flexDirection: "row", alignItems: "center", paddingVertical: 8, borderTopWidth: 1, borderTopColor: CARD_BORDER },
  histTeams: { color: TEXT_DARK, fontWeight: "700", fontSize: 13 },
  histSummary: { color: TEXT_GRAY, fontSize: 11, marginTop: 2 },
  histResult: { color: GREEN_DARK, fontSize: 11, marginTop: 2, fontWeight: "700" },

  // scoreboard hero card (dark green, sits on the light page)
  board: { backgroundColor: GREEN_DARK, borderRadius: 20, padding: 18 },
  boardTopRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  boardTeam: { color: "#FFFFFF", fontWeight: "800", fontSize: 16, flex: 1 },
  innBadge: { backgroundColor: ON_DARK_SURF, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  innBadgeTxt: { color: "#FFFFFF", fontSize: 11, fontWeight: "800" },
  boardScoreRow: { flexDirection: "row", alignItems: "flex-end", gap: 10, marginTop: 8 },
  boardScore: { color: "#FFFFFF", fontSize: 44, fontWeight: "900", letterSpacing: 1 },
  boardOvers: { color: ON_DARK_DIM, fontSize: 14, marginBottom: 8 },
  boardStatRow: { flexDirection: "row", gap: 16, marginTop: 6, flexWrap: "wrap" },
  boardStat: { color: ON_DARK_DIM, fontSize: 12, fontWeight: "700" },
  ballDotsRow: { flexDirection: "row", gap: 6, marginTop: 12, flexWrap: "wrap", minHeight: 30, alignItems: "center" },
  ballDotsEmpty: { color: ON_DARK_DIM, fontSize: 12 },
  ballDot: { minWidth: 30, height: 30, borderRadius: 15, paddingHorizontal: 6, backgroundColor: ON_DARK_SURF, alignItems: "center", justifyContent: "center" },
  ballDotW: { backgroundColor: RED },
  ballDotB: { backgroundColor: "#FFFFFF" },
  ballDotTxt: { color: "#FFFFFF", fontSize: 11, fontWeight: "800" },

  miniCard: { flexDirection: "row", backgroundColor: CARD_BG, borderRadius: 16, borderWidth: 1, borderColor: CARD_BORDER, padding: 14, gap: 12 },
  miniHdr: { color: GREEN_DARK, fontSize: 10, fontWeight: "800", letterSpacing: 1, marginBottom: 6 },
  miniRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 4, gap: 6 },
  miniName: { color: TEXT_GRAY, fontSize: 12.5, fontWeight: "600", flex: 1 },
  miniVal: { color: TEXT_DARK, fontSize: 12.5, fontWeight: "800" },
  miniDiv: { width: 1, backgroundColor: CARD_BORDER },
  miniExtras: { color: TXT_FAINT, fontSize: 10.5, marginTop: 4 },

  cardToggle: { flexDirection: "row", alignSelf: "center", alignItems: "center", gap: 6, paddingVertical: 7, paddingHorizontal: 16, borderRadius: 20, backgroundColor: GREEN_SOFT },
  cardToggleTxt: { color: GREEN_DARK, fontSize: 12, fontWeight: "700" },

  pendingBar: { flexDirection: "row", alignItems: "center", backgroundColor: AMBER_SOFT, borderRadius: 10, borderWidth: 1, borderColor: "#FDE68A", paddingHorizontal: 12, paddingVertical: 9, gap: 8 },
  pendingTxt: { color: AMBER_DARK, fontSize: 12.5, fontWeight: "700", flex: 1 },
  pendingCancel: { color: AMBER_DARK, fontSize: 12, fontWeight: "800" },

  padGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  runBtn: { width: "31%", flexGrow: 1, height: 58, borderRadius: 14, backgroundColor: CARD_BG, borderWidth: 1.5, borderColor: CARD_BORDER, alignItems: "center", justifyContent: "center" },
  runBtn0: { backgroundColor: INPUT_BG },
  runBtn4: { backgroundColor: BLUE, borderColor: BLUE },
  runBtn6: { backgroundColor: PURPLE, borderColor: PURPLE },
  runBtnTxt: { color: TEXT_DARK, fontSize: 22, fontWeight: "900" },

  extraRow: { flexDirection: "row", gap: 8 },
  extraBtn: { flex: 1, paddingVertical: 12, borderRadius: 12, backgroundColor: CARD_BG, borderWidth: 1.5, borderColor: CARD_BORDER, alignItems: "center" },
  extraBtnOn: { backgroundColor: AMBER, borderColor: AMBER },
  extraBtnTxt: { color: TEXT_DARK, fontWeight: "800", fontSize: 13 },
  undoBtn: { flexDirection: "row", gap: 5, flex: 1.2, paddingVertical: 12, borderRadius: 12, backgroundColor: INPUT_BG, alignItems: "center", justifyContent: "center" },
  undoBtnTxt: { color: TEXT_DARK, fontWeight: "800", fontSize: 13 },

  wktBtn: { backgroundColor: RED, borderRadius: 14, paddingVertical: 16, alignItems: "center" },
  wktBtnTxt: { color: "#FFFFFF", fontWeight: "900", fontSize: 17, letterSpacing: 2 },

  breakTitle: { color: GREEN_DARK, fontWeight: "900", fontSize: 13, letterSpacing: 2 },
  breakScore: { color: TEXT_DARK, fontSize: 28, fontWeight: "900", marginTop: 10 },
  breakOvers: { color: TEXT_GRAY, fontSize: 13, marginTop: 2 },
  targetPill: { backgroundColor: AMBER_SOFT, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 7, marginTop: 14, borderWidth: 1, borderColor: "#FDE68A" },
  targetPillTxt: { color: AMBER_DARK, fontWeight: "800", fontSize: 14 },

  resultTxt: { color: TEXT_DARK, fontSize: 19, fontWeight: "900", marginTop: 12, textAlign: "center" },
  resultLine: { color: TEXT_GRAY, fontSize: 13.5, marginTop: 6, fontWeight: "600" },

  scHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10, gap: 8 },
  scTitle: { color: TEXT_DARK, fontWeight: "800", fontSize: 13.5, flex: 1 },
  scScore: { color: GREEN_DARK, fontWeight: "900", fontSize: 13.5 },
  scColHdr: { color: TEXT_GRAY, fontSize: 11, fontWeight: "800", letterSpacing: 1, marginBottom: 6, textTransform: "uppercase" },
  scRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4, gap: 8 },
  scName: { color: TEXT_DARK, fontSize: 12.5, fontWeight: "600", flex: 1 },
  scVal: { color: TEXT_GRAY, fontSize: 12, fontWeight: "600" },
  scExtras: { color: TXT_FAINT, fontSize: 11.5, marginTop: 10 },

  overRow: { flexDirection: "row", alignItems: "center", paddingVertical: 8, borderTopWidth: 1, borderTopColor: CARD_BORDER, gap: 8 },
  overLeftCol: { width: 62 },
  overNumTxt: { color: TEXT_DARK, fontWeight: "800", fontSize: 12 },
  overBowlerTxt: { color: TEXT_GRAY, fontSize: 9.5, marginTop: 1 },
  overBallsRow: { flex: 1, flexDirection: "row", flexWrap: "wrap", gap: 4 },
  overBallChip: { minWidth: 21, height: 21, borderRadius: 10.5, paddingHorizontal: 4, backgroundColor: INPUT_BG, alignItems: "center", justifyContent: "center" },
  overBallChipW: { backgroundColor: RED },
  overBallChip4: { backgroundColor: BLUE },
  overBallChip6: { backgroundColor: PURPLE },
  overBallChipTxt: { color: TEXT_DARK, fontSize: 9.5, fontWeight: "800" },
  overRunsTxt: { color: GREEN_DARK, fontWeight: "900", fontSize: 13, minWidth: 32, textAlign: "right" },

  modalBack: { flex: 1, backgroundColor: "rgba(16,24,40,0.55)", alignItems: "center", justifyContent: "center", padding: 24 },
  modalCard: { width: "100%", maxWidth: 360, backgroundColor: CARD_BG, borderRadius: 18, borderWidth: 1, borderColor: CARD_BORDER, padding: 18 },
  modalTitle: { color: TEXT_DARK, fontWeight: "800", fontSize: 15, marginBottom: 12 },
  modalInput: { backgroundColor: INPUT_BG, borderRadius: 10, borderWidth: 1, borderColor: "transparent", color: TEXT_DARK, paddingHorizontal: 12, paddingVertical: 11, fontSize: 14 },
  modalRow: { flexDirection: "row", gap: 10, marginTop: 14 },
  modalSkip: { flex: 1, paddingVertical: 12, borderRadius: 10, backgroundColor: INPUT_BG, alignItems: "center" },
  modalSkipTxt: { color: TEXT_GRAY, fontWeight: "800" },
  modalOk: { flex: 1, paddingVertical: 12, borderRadius: 10, backgroundColor: GREEN_DARK, alignItems: "center" },
  modalOkTxt: { color: "#FFFFFF", fontWeight: "900" },
});
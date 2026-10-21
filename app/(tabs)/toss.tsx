// ─────────────────────────────────────────────────────────────────────────────
// TOSS SCREEN  —  app/toss/index.tsx   (Expo Router)
//
// Quick, real-feel coin toss for match starts.
// • Compact: open → tap FLIP → result. Nothing else required.
// • Coins: ₹1, ₹5, ₹10 (default), $1 — small selector on top.
// • Coin is ₹10-real-world size on screen (~150px), not oversized.
// • Optional "call" row: caller taps Heads/Tails, flipper flips, verdict shows.
// • Sound + vibration on flip and landing (sound is optional, see SOUND below).
// • Changeable sport backgrounds (cricket / football / badminton / night court).
//
// REAL COIN PHOTOS — works out of the box:
//   Real photos of ₹1 / ₹5 / ₹10 / $1 coins load automatically from
//   Wikimedia Commons (free-to-use images). If a photo fails to load
//   (no internet / URL changed), the screen falls back to a clean
//   code-drawn metallic coin — the toss never breaks.
//
//   FOR PRODUCTION (recommended): download those same images once, put them
//   in assets/coins/, and switch each coin's headsImg/tailsImg to
//   require("../../assets/coins/r10-heads.png") — instant load, works offline.
//
// SOUND — already wired and live:
//   Files expected at:
//     assets/sound/flick.wav   — thumb flicks the coin up
//     assets/sound/spin.mp3    — soft whirr while airborne
//     assets/sound/land.wav    — metallic clink landing
//   Rename your files to match exactly (case-sensitive), including the
//   correct extension — a file named "x.mp3" that is actually WAV data
//   will fail to decode on some devices. If you rename, also update the
//   three require(...) paths below to match.
//   Run `npx expo install expo-av` if you haven't already.
// ─────────────────────────────────────────────────────────────────────────────

import { useRef, useState, useEffect } from "react";
import {
  View, Text, TouchableOpacity, StyleSheet, Animated, Easing,
  StatusBar, Vibration, Image, Dimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Audio } from "expo-av";

const { width: SCREEN_W } = Dimensions.get("window");
const GREEN = "#22C55E";

// ── Coin definitions ─────────────────────────────────────────────────────────
type CoinDef = {
  id: string;
  label: string;
  ring: string;       // outer metal
  center: string;     // inner metal (bimetallic coins)
  text: string;       // engraving color
  face: string;       // big denomination text
  country: string;
  motto: string;
  headsImg?: any;     // real photo — heads
  tailsImg?: any;     // real photo — tails
};

// Real coin photos served by Wikimedia Commons (Special:FilePath always
// resolves the current file; ?width=400 returns a phone-sized version).
const WIKI = "https://commons.wikimedia.org/wiki/Special:FilePath/";
const wiki = (file: string) => ({ uri: `${WIKI}${encodeURIComponent(file)}?width=400` });

const COINS: CoinDef[] = [
  {
    id: "r1", label: "₹1", ring: "#D7DBE0", center: "#D7DBE0",
    text: "#5B6068", face: "1", country: "भारत  INDIA", motto: "सत्यमेव जयते",
    headsImg: wiki("Indian 1 Rupee Coin Obverse or Heads.jpg"),
    tailsImg: wiki("Indian 1 Rupee Coin Reverse or Tails.jpg"),
    // production: headsImg: require("../../assets/coins/r1-heads.png"), ...
  },
  {
    id: "r5", label: "₹5", ring: "#D9C177", center: "#D9C177",
    text: "#6B5B2A", face: "5", country: "भारत  INDIA", motto: "सत्यमेव जयते",
    headsImg: wiki("Indian Rs 5 coin 2009version obverse.png"),
    tailsImg: wiki("Indian Rs 5 coin 2009version reverse.png"),
  },
  {
    id: "r10", label: "₹10", ring: "#C8CDD4", center: "#D8B25C",
    text: "#5B4A1E", face: "10", country: "भारत  INDIA", motto: "सत्यमेव जयते",
    headsImg: wiki("Rupees 10 Grain Series coin Obverse.png"),
    tailsImg: wiki("Rupees 10 Grain Series coin reverse released in 2019.png"),
  },
  {
    // US $1 — Susan B. Anthony dollar (US Mint design, freely usable)
    id: "d1", label: "$1", ring: "#C9C9CE", center: "#C9C9CE",
    text: "#5F5F66", face: "$1", country: "UNITED STATES", motto: "LIBERTY",
    headsImg: wiki("1999 SBA Obv P.png"),
    tailsImg: wiki("1999 SBA Rev P.png"),
  },
];

// ── Sport backgrounds ────────────────────────────────────────────────────────
const BACKGROUNDS = [
  { id: "cricket",   name: "Cricket",   top: "#0E3B21", bottom: "#124D2B", accent: "#CBAF6E" }, // night turf + pitch
  { id: "football",  name: "Football",  top: "#0B4A22", bottom: "#0E5F2C", accent: "#FFFFFF" },
  { id: "badminton", name: "Badminton", top: "#0C2F52", bottom: "#124173", accent: "#7FB3E8" },
  { id: "night",     name: "Stadium",   top: "#0B1220", bottom: "#131C30", accent: "#334155" },
];

const COIN_SIZE = 150; // ≈ real ₹10 coin feel on a phone — small on purpose

// ─────────────────────────────────────────────────────────────────────────────
export default function Toss() {
  const router = useRouter();

  const [coinIdx, setCoinIdx] = useState(2);           // default ₹10
  const [bgIdx, setBgIdx]     = useState(0);
  const [flipping, setFlipping] = useState(false);
  const [result, setResult]   = useState<null | "heads" | "tails">(null);
  const [call, setCall]       = useState<null | "heads" | "tails">(null);
  const [count, setCount]     = useState({ heads: 0, tails: 0 });

  const coin = COINS[coinIdx];
  const bg   = BACKGROUNDS[bgIdx];

  // Animation refs
  const rot       = useRef(new Animated.Value(0)).current;  // tumble (rotateX) in degrees
  const lastRot   = useRef(0);                              // where the coin rests
  const lift      = useRef(new Animated.Value(0)).current;  // vertical throw arc
  const wobble    = useRef(new Animated.Value(0)).current;  // slight off-axis tilt (rotateZ)
  const scale     = useRef(new Animated.Value(1)).current;  // depth — bigger near, smaller far
  const resultPop = useRef(new Animated.Value(0)).current;

  // Preload both faces of the selected coin so the real photo is
  // already cached before the first flip (no blank face mid-spin).
  useEffect(() => {
    const c = COINS[coinIdx];
    if (c.headsImg?.uri) Image.prefetch(c.headsImg.uri).catch(() => {});
    if (c.tailsImg?.uri) Image.prefetch(c.tailsImg.uri).catch(() => {});
  }, [coinIdx]);

  // 🔊 Sound — three cues synced to flick / airborne spin / landing
  const flickSnd = useRef<Audio.Sound | null>(null);
  const spinSnd  = useRef<Audio.Sound | null>(null);
  const landSnd  = useRef<Audio.Sound | null>(null);
  useEffect(() => {
    (async () => {
      await Audio.setAudioModeAsync({ playsInSilentModeIOS: true });
      flickSnd.current = (await Audio.Sound.createAsync(require("../../assets/sound/coin.wav"))).sound;
    })().catch((e) => console.warn("Toss sound load failed:", e));
    return () => {
      flickSnd.current?.unloadAsync();
      spinSnd.current?.unloadAsync();
      landSnd.current?.unloadAsync();
    };
  }, []);
  const playFlick = async () => { try { await flickSnd.current?.replayAsync(); } catch {} };
  

  const flip = () => {
    if (flipping) return;
    setFlipping(true);
    setResult(null);
    resultPop.setValue(0);
    wobble.setValue(0);

    const isHeads = Math.random() < 0.5;

    // Tumble at least 5 full rotations from wherever the coin is resting,
    // landing exactly on the correct face.
    let target = lastRot.current + 1080;
    const landsHeads = target % 360 === 0;
    if (landsHeads !== isHeads) target += 180;

    // Real-feel toss: a small random wobble angle + a slightly randomized
    // throw height so no two flips move identically.
    const throwHeight = -100 - Math.random() * 30;   // -100 to -130
    const wobbleAngle = (Math.random() < 0.5 ? -1 : 1) * (4 + Math.random() * 5); // ±4–9°
    const airTime = 650 + Math.random() * 250;        // rise duration varies slightly

    playFlick();
    Vibration.vibrate(20); // the flick off the thumb

    // Spin sound kicks in once the coin is airborne
    

    Animated.parallel([
      // Tumble — end over end
      Animated.timing(rot, {
        toValue: target,
        duration: airTime + 1000,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      // Vertical arc — up fast, down with gravity + bounce
      Animated.sequence([
        Animated.timing(lift, {
          toValue: throwHeight, duration: airTime,
          easing: Easing.out(Easing.quad), useNativeDriver: true,
        }),
        Animated.timing(lift, {
          toValue: 0, duration: 1100,
          easing: Easing.bounce, useNativeDriver: true,
        }),
      ]),
      // Depth — shrinks slightly as it rises away from the eye, grows back
      Animated.sequence([
        Animated.timing(scale, {
          toValue: 0.88, duration: airTime,
          easing: Easing.out(Easing.quad), useNativeDriver: true,
        }),
        Animated.timing(scale, {
          toValue: 1, duration: 1100,
          easing: Easing.bounce, useNativeDriver: true,
        }),
      ]),
      // Wobble — coin doesn't spin perfectly true, settles flat at the end
      Animated.sequence([
        Animated.timing(wobble, {
          toValue: wobbleAngle, duration: airTime * 0.6,
          easing: Easing.inOut(Easing.quad), useNativeDriver: true,
        }),
        Animated.timing(wobble, {
          toValue: 0, duration: airTime + 1000 - airTime * 0.6,
          easing: Easing.out(Easing.quad), useNativeDriver: true,
        }),
      ]),
    ]).start(() => {
      
      lastRot.current = target;
      
      Vibration.vibrate([0, 30, 60, 30]); // landing clink-clink-clink
      setResult(isHeads ? "heads" : "tails");
      setCount(c => isHeads
        ? { ...c, heads: c.heads + 1 }
        : { ...c, tails: c.tails + 1 });
      Animated.spring(resultPop, {
        toValue: 1, friction: 5, tension: 120, useNativeDriver: true,
      }).start();
      setFlipping(false);
    });
  };

  const rotateX = rot.interpolate({
    inputRange: [0, 360],
    outputRange: ["0deg", "360deg"],
  });
  const rotateXBack = rot.interpolate({
    inputRange: [0, 360],
    outputRange: ["180deg", "540deg"],
  });
  const rotateZ = wobble.interpolate({
    inputRange: [-9, 9],
    outputRange: ["-9deg", "9deg"],
  });

  const callVerdict =
    result && call ? (result === call ? "won" : "lost") : null;

  return (
    <View style={[s.root, { backgroundColor: bg.bottom }]}>
      <StatusBar barStyle="light-content" backgroundColor={bg.top} />

      {/* background layers */}
      <View style={[s.bgTop, { backgroundColor: bg.top }]} />
      <FieldMarkings bgId={bg.id} accent={bg.accent} />

      <SafeAreaView style={s.safe}>
        {/* ── header ── */}
        <View style={s.header}>
          <TouchableOpacity style={s.hBtn} onPress={() => router.back()} activeOpacity={0.8}>
            <Ionicons name="chevron-back" size={20} color="#fff" />
          </TouchableOpacity>
          <Text style={s.title}>Toss</Text>
          <TouchableOpacity
            style={s.hBtn}
            onPress={() => setBgIdx((bgIdx + 1) % BACKGROUNDS.length)}
            activeOpacity={0.8}
          >
            <Ionicons name="color-palette-outline" size={19} color="#fff" />
          </TouchableOpacity>
        </View>

        {/* ── coin selector ── */}
        <View style={s.coinRow}>
          {COINS.map((c, i) => (
            <TouchableOpacity
              key={c.id}
              style={[s.coinChip, i === coinIdx && s.coinChipOn]}
              onPress={() => !flipping && setCoinIdx(i)}
              activeOpacity={0.8}
            >
              <Text style={[s.coinChipTxt, i === coinIdx && s.coinChipTxtOn]}>{c.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* ── the coin ── */}
        <View style={s.stage}>
          <TouchableOpacity activeOpacity={0.9} onPress={flip} disabled={flipping}>
            <Animated.View style={{ transform: [{ translateY: lift }, { scale }, { rotateZ }] }}>
              {/* shadow on the ground */}
              <Animated.View
                style={[s.shadow, {
                  transform: [{ scaleX: lift.interpolate({
                    inputRange: [-130, 0], outputRange: [0.5, 1],
                  }) }],
                  opacity: lift.interpolate({
                    inputRange: [-130, 0], outputRange: [0.12, 0.35],
                  }),
                }]}
              />
              <View style={{ width: COIN_SIZE, height: COIN_SIZE }}>
                {/* HEADS face */}
                <Animated.View
                  style={[s.face, { transform: [{ perspective: 900 }, { rotateX }] }]}
                >
                  <CoinFace coin={coin} side="heads" />
                </Animated.View>
                {/* TAILS face */}
                <Animated.View
                  style={[s.face, { transform: [{ perspective: 900 }, { rotateX: rotateXBack }] }]}
                >
                  <CoinFace coin={coin} side="tails" />
                </Animated.View>
              </View>
            </Animated.View>
          </TouchableOpacity>

          {/* result */}
          <View style={s.resultBox}>
            {result ? (
              <Animated.View style={{ transform: [{ scale: resultPop }], alignItems: "center" }}>
                <Text style={s.resultTxt}>{result === "heads" ? "HEADS" : "TAILS"}</Text>
                {callVerdict && (
                  <View style={[s.verdict, callVerdict === "won" ? s.verdictWin : s.verdictLose]}>
                    <Ionicons
                      name={callVerdict === "won" ? "checkmark-circle" : "close-circle"}
                      size={14} color="#fff"
                    />
                    <Text style={s.verdictTxt}>
                      {call === "heads" ? "Heads" : "Tails"} call {callVerdict}
                    </Text>
                  </View>
                )}
              </Animated.View>
            ) : (
              <Text style={s.hint}>{flipping ? "" : "Tap the coin or FLIP"}</Text>
            )}
          </View>
        </View>

        {/* ── optional call ── */}
        <View style={s.callRow}>
          <Text style={s.callLabel}>Call (optional)</Text>
          {(["heads", "tails"] as const).map(cSide => (
            <TouchableOpacity
              key={cSide}
              style={[s.callChip, call === cSide && s.callChipOn]}
              onPress={() => !flipping && setCall(call === cSide ? null : cSide)}
              activeOpacity={0.8}
            >
              <Text style={[s.callChipTxt, call === cSide && s.callChipTxtOn]}>
                {cSide === "heads" ? "Heads" : "Tails"}
              </Text>
            </TouchableOpacity>
          ))}
          <Text style={s.countTxt}>H {count.heads} · T {count.tails}</Text>
        </View>

        {/* ── flip button ── */}
        <TouchableOpacity
          style={[s.flipBtn, flipping && { opacity: 0.6 }]}
          onPress={flip}
          disabled={flipping}
          activeOpacity={0.88}
        >
          <Ionicons name="sync-outline" size={18} color="#fff" />
          <Text style={s.flipBtnTxt}>{flipping ? "Flipping…" : "FLIP"}</Text>
        </TouchableOpacity>
      </SafeAreaView>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Coin face — real photo if provided, otherwise a clean metallic render
// ─────────────────────────────────────────────────────────────────────────────
function CoinFace({ coin, side }: { coin: CoinDef; side: "heads" | "tails" }) {
  const img = side === "heads" ? coin.headsImg : coin.tailsImg;
  const [failed, setFailed] = useState(false);

  // reset when the user switches coins
  useEffect(() => { setFailed(false); }, [coin.id]);

  if (img && !failed) {
    return (
      <View style={[cf.wrap, cf.photoWrap]}>
        <Image
          source={img}
          style={cf.photo}
          resizeMode="cover"
          onError={() => setFailed(true)}   // no internet → drawn coin fallback
        />
        <View style={cf.shine} pointerEvents="none" />
      </View>
    );
  }

  const bimetal = coin.ring !== coin.center;

  return (
    <View style={[cf.wrap, { backgroundColor: coin.ring, borderColor: darken(coin.ring) }]}>
      {/* reeded edge illusion */}
      <View style={[cf.rim, { borderColor: darken(coin.ring) }]} />

      {/* bimetal inner disc (₹10) */}
      <View
        style={[
          cf.inner,
          bimetal
            ? { backgroundColor: coin.center, borderColor: darken(coin.center) }
            : { backgroundColor: "transparent", borderColor: "transparent" },
        ]}
      >
        {side === "heads" ? (
          <>
            <Text style={[cf.small, { color: coin.text }]}>{coin.motto}</Text>
            <Text style={[cf.big, { color: coin.text }]}>{coin.face}</Text>
            <Text style={[cf.tiny, { color: coin.text }]}>
              {coin.id.startsWith("r") ? "रुपये  RUPEES" : "ONE DOLLAR"}
            </Text>
          </>
        ) : (
          <>
            <Text style={[cf.small, { color: coin.text }]}>{coin.country}</Text>
            {/* simple pillar emblem */}
            <View style={cf.emblem}>
              <View style={[cf.emblemCap, { backgroundColor: coin.text }]} />
              <View style={[cf.emblemCol, { backgroundColor: coin.text }]} />
              <View style={[cf.emblemBase, { backgroundColor: coin.text }]} />
            </View>
            <Text style={[cf.tiny, { color: coin.text }]}>2026</Text>
          </>
        )}
      </View>

      {/* light catch */}
      <View style={cf.shine} pointerEvents="none" />
    </View>
  );
}

function darken(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.max(0, Math.floor(v * 0.65));
  const r = f((n >> 16) & 255), g = f((n >> 8) & 255), b = f(n & 255);
  return `rgb(${r},${g},${b})`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Background field markings per sport
// ─────────────────────────────────────────────────────────────────────────────
function FieldMarkings({ bgId, accent }: { bgId: string; accent: string }) {
  if (bgId === "cricket") {
    return (
      <View style={fm.fill} pointerEvents="none">
        <View style={[fm.pitch, { backgroundColor: accent + "22", borderColor: accent + "33" }]} />
      </View>
    );
  }
  if (bgId === "football") {
    return (
      <View style={fm.fill} pointerEvents="none">
        <View style={[fm.centerCircle, { borderColor: accent + "26" }]} />
        <View style={[fm.midLine, { backgroundColor: accent + "1F" }]} />
      </View>
    );
  }
  if (bgId === "badminton") {
    return (
      <View style={fm.fill} pointerEvents="none">
        <View style={[fm.court, { borderColor: accent + "2E" }]} />
      </View>
    );
  }
  return null; // plain stadium night
}

const fm = StyleSheet.create({
  fill: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" },
  pitch: {
    width: 90, height: "62%", borderRadius: 10, borderWidth: 1,
  },
  centerCircle: {
    width: SCREEN_W * 0.85, height: SCREEN_W * 0.85,
    borderRadius: SCREEN_W, borderWidth: 2, position: "absolute",
  },
  midLine: { position: "absolute", width: "100%", height: 2 },
  court: {
    width: "72%", height: "58%", borderWidth: 2, borderRadius: 4,
  },
});

// ─────────────────────────────────────────────────────────────────────────────
const cf = StyleSheet.create({
  wrap: {
    width: COIN_SIZE, height: COIN_SIZE, borderRadius: COIN_SIZE / 2,
    borderWidth: 3, alignItems: "center", justifyContent: "center",
    overflow: "hidden",
  },
  photoWrap: { backgroundColor: "#EDEDEF", borderColor: "#9AA0A8", borderWidth: 2 },
  photo: { width: "100%", height: "100%", borderRadius: COIN_SIZE / 2 },
  rim: {
    position: "absolute", top: 5, left: 5, right: 5, bottom: 5,
    borderRadius: COIN_SIZE / 2, borderWidth: 1.5, opacity: 0.5,
    borderStyle: "dotted",
  },
  inner: {
    width: COIN_SIZE * 0.66, height: COIN_SIZE * 0.66,
    borderRadius: COIN_SIZE * 0.33, borderWidth: 1.5,
    alignItems: "center", justifyContent: "center",
  },
  big:   { fontSize: 40, fontWeight: "900", letterSpacing: -1, marginVertical: 1 },
  small: { fontSize: 8.5, fontWeight: "800", letterSpacing: 0.4 },
  tiny:  { fontSize: 7.5, fontWeight: "700", letterSpacing: 0.6 },
  emblem: { alignItems: "center", marginVertical: 4 },
  emblemCap:  { width: 26, height: 6, borderRadius: 2 },
  emblemCol:  { width: 12, height: 22, borderRadius: 3, marginTop: 1 },
  emblemBase: { width: 30, height: 5, borderRadius: 2, marginTop: 1 },
  shine: {
    position: "absolute", top: -COIN_SIZE * 0.25, left: -COIN_SIZE * 0.15,
    width: COIN_SIZE * 0.9, height: COIN_SIZE * 0.55,
    borderRadius: COIN_SIZE, backgroundColor: "rgba(255,255,255,0.28)",
    transform: [{ rotate: "-18deg" }],
  },
});

const s = StyleSheet.create({
  root: { flex: 1 },
  bgTop: { position: "absolute", top: 0, left: 0, right: 0, height: "45%" },
  safe: { flex: 1, paddingHorizontal: 16 },

  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingTop: 6 },
  hBtn: {
    width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.12)", borderWidth: 1, borderColor: "rgba(255,255,255,0.15)",
  },
  title: { fontSize: 17, fontWeight: "900", color: "#fff", letterSpacing: 0.3 },

  coinRow: { flexDirection: "row", justifyContent: "center", gap: 8, marginTop: 14 },
  coinChip: {
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: 99,
    backgroundColor: "rgba(255,255,255,0.10)", borderWidth: 1, borderColor: "rgba(255,255,255,0.18)",
  },
  coinChipOn: { backgroundColor: "#fff" },
  coinChipTxt: { fontSize: 13, fontWeight: "800", color: "rgba(255,255,255,0.85)" },
  coinChipTxtOn: { color: "#0B1220" },

  stage: { flex: 1, alignItems: "center", justifyContent: "center" },
  face: { ...StyleSheet.absoluteFillObject, backfaceVisibility: "hidden" },
  shadow: {
    position: "absolute", bottom: -22, alignSelf: "center",
    width: COIN_SIZE * 0.8, height: 14, borderRadius: 99, backgroundColor: "#000",
  },

  resultBox: { height: 74, marginTop: 26, alignItems: "center", justifyContent: "center" },
  resultTxt: { fontSize: 34, fontWeight: "900", color: "#fff", letterSpacing: 3 },
  hint: { fontSize: 13, color: "rgba(255,255,255,0.55)", fontWeight: "600" },
  verdict: {
    flexDirection: "row", alignItems: "center", gap: 4, marginTop: 6,
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 99,
  },
  verdictWin:  { backgroundColor: GREEN },
  verdictLose: { backgroundColor: "#EF4444" },
  verdictTxt: { fontSize: 12, fontWeight: "800", color: "#fff" },

  callRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 },
  callLabel: { fontSize: 11, fontWeight: "700", color: "rgba(255,255,255,0.5)" },
  callChip: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 99,
    backgroundColor: "rgba(255,255,255,0.10)", borderWidth: 1, borderColor: "rgba(255,255,255,0.18)",
  },
  callChipOn: { backgroundColor: GREEN, borderColor: GREEN },
  callChipTxt: { fontSize: 12, fontWeight: "800", color: "rgba(255,255,255,0.8)" },
  callChipTxtOn: { color: "#fff" },
  countTxt: { marginLeft: "auto", fontSize: 12, fontWeight: "800", color: "rgba(255,255,255,0.6)" },

  flipBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: "#178c42", paddingVertical: 15, borderRadius: 14, marginBottom: 14,
  },
  flipBtnTxt: { fontSize: 15, fontWeight: "900", color: "#fff", letterSpacing: 1.5 },
});
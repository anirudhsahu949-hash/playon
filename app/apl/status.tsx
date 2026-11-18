/**
 * app/apl/status.tsx — the player's APL pass + live status tracker.
 *
 * Opens after payment, and any time from the APL home screen.
 * Listens to the registration doc, so when you assign a team or start a
 * refund from the admin screen, this screen changes on the player's phone
 * by itself — no "sir mera paisa kab aayega" calls.
 *
 * Fields it reads from appConfig/{leagueId}, all set in admin → League Setup:
 *   logoUrl       small logo in the pass header
 *   passBgUrl     the picture behind the pass (already the card's own colour)
 *   whatsappLink  group invite
 *   instagramUrl  the league's Instagram
 *   auctionDate / leagueDates / venue
 */
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, ActivityIndicator,
  Alert, StatusBar, Linking, RefreshControl,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useEffect, useRef, useState } from "react";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { doc, getDoc, onSnapshot } from "firebase/firestore";
import * as Sharing from "expo-sharing";
import ViewShot from "react-native-view-shot";

import { auth, db } from "../../firebaseConfig";
import { cldThumb } from "../../utils/cloudinary";

const SERVER_URL = "https://bookora-backend-95u4.onrender.com";

const GREEN   = "#16A34A";
const GREEN_D = "#15803D";
const DARK    = "#0B1220";
const GOLD    = "#FCD34D";
const BG      = "#F3F4F6";
const BORDER  = "#E5E7EB";
const MUTED   = "#6B7280";
const INSTA   = "#C13584";

type Step = {
  title: string;
  sub: string;
  // "missed" = a step that will never happen for this player (not picked)
  state: "done" | "current" | "upcoming" | "missed";
};

function fmtDate(v: any): string {
  if (!v) return "";
  const d = typeof v?.toDate === "function" ? v.toDate() : new Date(v);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export default function AplStatus() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ leagueId?: string; fresh?: string }>();
  const leagueId = (params.leagueId as string) || "apl-2026";

  const [reg, setReg]         = useState<any>(null);
  const [cfg, setCfg]         = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [sharing, setSharing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const shotRef = useRef<any>(null);

  // config
  const loadCfg = async () => {
    try {
      const snap = await getDoc(doc(db, "appConfig", leagueId));
      if (snap.exists()) setCfg(snap.data());
    } catch {}
  };

  useEffect(() => { loadCfg(); }, [leagueId]);

  // registration — live
  useEffect(() => {
    if (!auth.currentUser) {
      setLoading(false);
      return;
    }
    const ref = doc(db, "aplRegistrations", `${leagueId}_${auth.currentUser.uid}`);
    const unsub = onSnapshot(
      ref,
      (snap) => {
        setReg(snap.exists() ? { id: snap.id, ...snap.data() } : null);
        setLoading(false);
      },
      () => setLoading(false),
    );
    return unsub;
  }, [leagueId]);

  // ask the server for the live refund status (Razorpay is the truth)
  const syncRefund = async () => {
    if (!reg?.refundId || !auth.currentUser) return;
    try {
      await fetch(`${SERVER_URL}/apl-refund-status/${reg.id}?uid=${auth.currentUser.uid}`);
      // the server writes the new status to Firestore → the listener updates us
    } catch {}
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([syncRefund(), loadCfg()]);   // links and dates come down too
    setTimeout(() => setRefreshing(false), 400);
  };

  useEffect(() => { syncRefund(); }, [reg?.refundId]);

  const share = async () => {
    try {
      setSharing(true);
      await new Promise((r) => setTimeout(r, 250));
      const uri = await shotRef.current?.capture?.();
      if (!uri) throw new Error("capture failed");
      await Sharing.shareAsync(uri, { mimeType: "image/png", dialogTitle: "Share my player pass" });
    } catch {
      Alert.alert("Could not share", "Please try again.");
    } finally {
      setSharing(false);
    }
  };

  const open = (url?: string, missing?: string) => {
    if (!url) return Alert.alert("Not available", missing || "This link is not set yet.");
    Linking.openURL(url).catch(() => Alert.alert("Could not open", "Please try again."));
  };

  if (loading) {
    return <View style={[s.center, { backgroundColor: BG }]}><ActivityIndicator size="large" color={GREEN} /></View>;
  }

  // not registered yet
  if (!reg) {
    return (
      <SafeAreaView style={[s.center, { backgroundColor: BG, padding: 28 }]}>
        <Ionicons name="clipboard-outline" size={42} color={MUTED} />
        <Text style={s.emptyTitle}>You are not registered yet</Text>
        <Text style={s.emptySub}>Register as a player to get into the auction pool.</Text>
        <TouchableOpacity
          style={s.emptyBtn}
          onPress={() => router.replace({ pathname: "/apl/register", params: { leagueId } } as any)}
        >
          <Text style={s.emptyBtnTxt}>Register now</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  const st       = reg.status || "pool";
  const refundSt = reg.refundStatus || "none";
  const fee      = Number(reg.fee || 0);
  const sold     = st === "sold";
  const unsold   = st === "unsold" || st === "refunded";
  const auctionDone = sold || unsold;

  const refundLine =
    refundSt === "processed" ? `₹${reg.refundAmount || fee} is back in your account.`
    : refundSt === "initiated" || refundSt === "processing" ? `₹${reg.refundAmount || fee} refund is on the way — it reaches your account in 5–7 working days.`
    : refundSt === "failed" ? "The refund did not go through. We are on it — you will get your money."
    : `If no team picks you, ₹${fee} goes back to the same account within 7 working days — automatic, you do not have to ask anyone.`;

  const steps: Step[] = [
    {
      title: "Registered & paid",
      sub: `₹${reg.amountPaid || fee} received${reg.paidAt ? ` · ${fmtDate(reg.paidAt)}` : ""}`,
      state: "done",
    },
    {
      title: "In the auction pool",
      sub: "Team owners can see your profile.",
      state: st === "pool" ? "current" : "done",
    },
    {
      title: `Auction day${cfg?.auctionDate ? ` — ${cfg.auctionDate}` : ""}`,
      sub: auctionDone
        ? "The auction is over."
        : cfg?.auctionDate ? "Watch it live in the app." : "The date will show here as soon as it is fixed.",
      state: auctionDone ? "done" : "upcoming",
    },
    sold
      ? {
          title: `Picked by ${reg.teamName || "a team"}`,
          sub: `${reg.soldPrice ? `Sold for ₹${reg.soldPrice}. ` : ""}The owner will call you.${cfg?.leagueDates ? ` Matches on ${cfg.leagueDates}${cfg?.venue ? ` at ${cfg.venue}` : ""}.` : ""}`,
          state: "done",
        }
      : unsold
        ? {
            title: "Not picked in the auction",
            sub: "No team picked you this time. Your money is coming back — see below.",
            state: "missed",
          }
        : {
            title: "Picked by a team",
            sub: "The owner calls you, and your team name appears on this pass.",
            state: "upcoming",
          },
  ];

  // A sold player has nothing to be refunded, so that step is simply not shown.
  if (!sold || refundSt !== "none") {
    steps.push({
      title: unsold || refundSt !== "none" ? "Refund" : "Not picked? Refund",
      sub: refundLine,
      state: refundSt === "processed" ? "done" : (refundSt === "initiated" || refundSt === "processing") ? "current" : "upcoming",
    });
  }

  // Whatever you type in admin → League Setup → Sponsor line shows on the pass.
  // Type just the brand ("Unity Construction") and "Sponsored by" is added for you.
  const rawSponsor  = String(cfg?.sponsorText ?? "Sponsored by PlayOn").trim();
  const sponsorLine = rawSponsor
    ? (/sponsor/i.test(rawSponsor) ? rawSponsor : `Sponsored by ${rawSponsor}`).toUpperCase()
    : "";

  const statusPill = sold
    ? { txt: reg.teamName ? reg.teamName.toUpperCase() : "SOLD", bg: "#0C2A4A", bd: "#1D4ED8", fg: "#93C5FD" }
    : unsold
      ? { txt: "REFUND", bg: "#2A1A05", bd: "#92400E", fg: "#FCD34D" }
      : { txt: "IN AUCTION POOL", bg: "#112B1C", bd: "#1B5E35", fg: "#86EFAC" };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: BG }} edges={["top"]}>
      <StatusBar barStyle="light-content" backgroundColor={GREEN} />

      <ScrollView
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 20) + 10 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={GREEN} />}
      >
        {/* confirmed banner */}
        <View style={s.hero}>
          <View style={s.tick}><Ionicons name="checkmark" size={28} color={GREEN} /></View>
          <Text style={s.heroTitle}>
            {sold ? "You are in a team!" : unsold ? "Auction is done" : "You are in the auction"}
          </Text>
          <Text style={s.heroSub}>
            {sold ? `${reg.teamName || "Your team"} picked you` : `₹${reg.amountPaid || fee} received · ${reg.regNo || "Registered"}`}
          </Text>
        </View>

        <View style={{ padding: 16, gap: 14 }}>

          {/* ── PLAYER PASS (this is what gets shared) ── */}
          <ViewShot ref={shotRef} options={{ format: "png", quality: 1 }} style={{ borderRadius: 18 }}>
            <View style={s.pass}>

              {/* The picture already carries the card's colour and the faded
                  logo, so it goes in at full strength — nothing to tint here. */}
              {!!cfg?.passBgUrl && (
                <Image source={{ uri: cfg.passBgUrl }} style={s.passBg} resizeMode="cover" />
              )}

              <View style={s.passHead}>
                {/* flex + minWidth let the long league name shrink instead of
                    pushing PLAYON off the edge of the card */}
                <View style={s.passHeadLeft}>
                  {!!cfg?.logoUrl && <Image source={{ uri: cfg.logoUrl }} style={s.passLogo} resizeMode="cover" />}
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={s.passKicker}>PLAYER PASS</Text>
                    <Text style={s.passLeague} numberOfLines={1}>
                      {(cfg?.leagueName || "LEAGUE").toUpperCase()}
                    </Text>
                  </View>
                </View>
              </View>

              <View style={s.passLine} />

              <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
                {reg.photoUrl
                  ? <Image source={{ uri: cldThumb(reg.photoUrl, 300) }} style={s.passPhoto} />
                  : <View style={[s.passPhoto, { alignItems: "center", justifyContent: "center" }]}>
                      <Ionicons name="person" size={30} color="#9CA3AF" />
                    </View>}
                <View style={{ flex: 1, gap: 5 }}>
                  <Text style={s.passName} numberOfLines={2}>{reg.name}</Text>
                  <Text style={s.passMeta}>{reg.area}{reg.age ? ` · Age ${reg.age}` : ""}</Text>
                  <View style={[s.passPill, { backgroundColor: statusPill.bg, borderColor: statusPill.bd }]}>
                    <Text style={[s.passPillTxt, { color: statusPill.fg }]}>{statusPill.txt}</Text>
                  </View>
                </View>
              </View>

              <View style={s.passLine} />

              <View style={{ flexDirection: "row" }}>
                <PassCell label="PLAYER ID" value={reg.regNo || "—"} />
                <PassCell label="ROLE" value={reg.role || "—"} />
                <PassCell label="JERSEY" value={reg.jerseyNo || reg.jerseySize || "—"} />
              </View>
              <View style={{ flexDirection: "row", marginTop: 12 }}>
                <PassCell label="BATTING" value={reg.battingHand || "—"} />
                <PassCell label="BOWLING" value={reg.bowlingStyle || "—"} />
              </View>

              {(!!cfg?.leagueDates || !!cfg?.venue || !!sponsorLine) && (
                <>
                  <View style={s.passLine} />
                  {(!!cfg?.leagueDates || !!cfg?.venue) && (
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                      <Text style={s.passDates} numberOfLines={1}>{(cfg?.leagueDates || "").toUpperCase()}</Text>
                      <Text style={s.passVenue} numberOfLines={1}>{(cfg?.venue || "").toUpperCase()}</Text>
                    </View>
                  )}
                  {/* A full line of its own, so a long sponsor name can never
                      push the league name off the card. */}
                  {!!sponsorLine && (
                    <Text style={s.passSponsor} numberOfLines={2}>{sponsorLine}</Text>
                  )}
                </>
              )}
            </View>
          </ViewShot>

          {/* actions */}
          <View style={{ flexDirection: "row", gap: 8 }}>
            <TouchableOpacity style={s.actDark} activeOpacity={0.9} onPress={share} disabled={sharing}>
              {sharing ? <ActivityIndicator color="#FFFFFF" size="small" />
                : <><Ionicons name="share-outline" size={17} color="#FFFFFF" /><Text style={s.actDarkTxt}>Share</Text></>}
            </TouchableOpacity>

            <TouchableOpacity
              style={[s.actOutline, { borderColor: INSTA }]}
              activeOpacity={0.9}
              onPress={() => open(cfg?.instagramUrl, "The league's Instagram is not added yet.")}
            >
              <Ionicons name="logo-instagram" size={17} color={INSTA} />
              <Text style={[s.actOutlineTxt, { color: INSTA }]}>Instagram</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[s.actOutline, { borderColor: GREEN }]}
              activeOpacity={0.9}
              onPress={() => open(cfg?.whatsappLink, "The group link is not added yet.")}
            >
              <Ionicons name="logo-whatsapp" size={17} color={GREEN_D} />
              <Text style={[s.actOutlineTxt, { color: GREEN_D }]}>Group</Text>
            </TouchableOpacity>
          </View>

          {/* ── STATUS TRACKER ── */}
          <View style={s.card}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <Text style={s.cardTitle}>Your league status</Text>
              <View style={s.livePill}><Text style={s.livePillTxt}>UPDATES HERE</Text></View>
            </View>

            <View style={{ marginTop: 14 }}>
              {steps.map((step, i) => {
                const last = i === steps.length - 1;
                const doneLine = step.state === "done" || step.state === "missed";
                return (
                  <View key={i} style={{ flexDirection: "row", gap: 12 }}>
                    <View style={{ width: 22, alignItems: "center" }}>
                      {step.state === "done" ? (
                        <View style={s.dotDone}><Ionicons name="checkmark" size={12} color="#FFFFFF" /></View>
                      ) : step.state === "current" ? (
                        <View style={s.dotCurrent} />
                      ) : step.state === "missed" ? (
                        <View style={s.dotMissed}><Ionicons name="close" size={12} color="#6B7280" /></View>
                      ) : (
                        <View style={s.dotUpcoming} />
                      )}
                      {!last && <View style={[s.rail, doneLine && { backgroundColor: GREEN }]} />}
                    </View>
                    <View style={{ flex: 1, paddingBottom: last ? 0 : 16 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
                        <Text style={s.stepTitle}>{step.title}</Text>
                        {step.state === "current" && <View style={s.nowPill}><Text style={s.nowTxt}>NOW</Text></View>}
                      </View>
                      <Text style={s.stepSub}>{step.sub}</Text>
                    </View>
                  </View>
                );
              })}
            </View>
          </View>

          <Text style={s.foot}>Pull down to refresh your status.</Text>

          <TouchableOpacity onPress={() => router.replace("/(tabs)" as any)} style={{ alignItems: "center", paddingVertical: 8 }}>
            <Text style={s.backHome}>Back to PlayOn home</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function PassCell({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={s.cellLabel}>{label}</Text>
      <Text style={s.cellValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },

  emptyTitle: { fontSize: 17, fontWeight: "700", color: "#111827", marginTop: 14 },
  emptySub: { fontSize: 13.5, color: MUTED, textAlign: "center", marginTop: 6, lineHeight: 20 },
  emptyBtn: { marginTop: 18, backgroundColor: GREEN, borderRadius: 12, paddingHorizontal: 22, paddingVertical: 13 },
  emptyBtnTxt: { color: "#FFFFFF", fontWeight: "700", fontSize: 14.5 },

  hero: { backgroundColor: GREEN, paddingHorizontal: 20, paddingTop: 22, paddingBottom: 24, alignItems: "center", gap: 10 },
  tick: { width: 56, height: 56, borderRadius: 999, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center" },
  heroTitle: { fontSize: 22, fontWeight: "800", color: "#FFFFFF", textAlign: "center" },
  heroSub: { fontSize: 13, color: "#DCFCE7", textAlign: "center" },

  pass: { backgroundColor: DARK, borderRadius: 18, borderWidth: 1, borderColor: "rgba(245,158,11,0.38)", padding: 18, overflow: "hidden" },
  passBg: { position: "absolute", left: 0, top: 0, width: "100%", height: "100%" },
  passHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  passHeadLeft: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 9 },
  passLogo: { width: 38, height: 38, borderRadius: 9 },
  passKicker: { fontSize: 10.5, fontWeight: "800", color: GOLD, letterSpacing: 1.4 },
  passLeague: { fontSize: 10, fontWeight: "700", color: "#D1D5DB", letterSpacing: 0.6, marginTop: 2 },
  passSponsor: { marginTop: 12, fontSize: 9.5, fontWeight: "700", color: "#9CA3AF", letterSpacing: 1.2, textAlign: "center", lineHeight: 14 },
  passLine: { height: 1, backgroundColor: "rgba(255,255,255,0.12)", marginVertical: 14 },
  passPhoto: { width: 76, height: 76, borderRadius: 14, backgroundColor: "#1F2937", borderWidth: 1.5, borderColor: "rgba(245,158,11,0.45)" },
  passName: { fontSize: 21, fontWeight: "800", color: "#FFFFFF", lineHeight: 24 },
  passMeta: { fontSize: 12, color: "#D1D5DB" },
  passPill: { alignSelf: "flex-start", borderWidth: 1, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4 },
  passPillTxt: { fontSize: 11, fontWeight: "700" },
  passDates: { fontSize: 11, fontWeight: "800", color: GOLD, letterSpacing: 0.8, flexShrink: 1 },
  passVenue: { fontSize: 11, fontWeight: "700", color: "#E5E7EB", letterSpacing: 0.5, flexShrink: 1, textAlign: "right" },
  cellLabel: { fontSize: 10.5, color: "#CBD5E1", fontWeight: "700", letterSpacing: 0.5 },
  cellValue: { fontSize: 13, fontWeight: "700", color: "#FFFFFF", marginTop: 3 },

  actDark: { flex: 1, height: 48, borderRadius: 12, backgroundColor: DARK, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  actDarkTxt: { color: "#FFFFFF", fontSize: 12.5, fontWeight: "700" },
  actOutline: { flex: 1, height: 48, borderRadius: 12, borderWidth: 1.5, backgroundColor: "#FFFFFF", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  actOutlineTxt: { fontSize: 12.5, fontWeight: "700" },

  card: { backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: BORDER, borderRadius: 14, padding: 16 },
  cardTitle: { fontSize: 14, fontWeight: "700", color: "#111827" },
  livePill: { backgroundColor: "#F0FDF4", borderWidth: 1, borderColor: "#BBF7D0", borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4 },
  livePillTxt: { fontSize: 10.5, fontWeight: "700", color: GREEN_D },

  dotDone: { width: 22, height: 22, borderRadius: 999, backgroundColor: GREEN, alignItems: "center", justifyContent: "center" },
  dotCurrent: { width: 22, height: 22, borderRadius: 999, backgroundColor: "#FFFFFF", borderWidth: 3, borderColor: GREEN },
  dotUpcoming: { width: 22, height: 22, borderRadius: 999, backgroundColor: "#FFFFFF", borderWidth: 2, borderColor: "#D1D5DB" },
  dotMissed: { width: 22, height: 22, borderRadius: 999, backgroundColor: "#F3F4F6", borderWidth: 2, borderColor: "#D1D5DB", alignItems: "center", justifyContent: "center" },
  rail: { flex: 1, width: 2, backgroundColor: BORDER, marginTop: 3 },
  stepTitle: { fontSize: 13, fontWeight: "700", color: "#111827", flexShrink: 1 },
  stepSub: { fontSize: 12, color: MUTED, lineHeight: 18, marginTop: 2 },
  nowPill: { backgroundColor: "#DCFCE7", borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2 },
  nowTxt: { fontSize: 10, fontWeight: "800", color: "#166534", letterSpacing: 0.5 },

  foot: { fontSize: 11.5, color: MUTED, textAlign: "center" },
  backHome: { fontSize: 13.5, fontWeight: "700", color: GREEN_D },
});
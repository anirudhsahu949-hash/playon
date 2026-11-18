/**
 * app/apl/index.tsx — the league's home screen inside PlayOn.
 *
 * This is where the home-screen banner (and the Instagram crowd) lands.
 * Everything on it comes from appConfig/{leagueId}, so one more league later
 * = one more config doc, not new code.
 *
 * Config fields used here:
 *   leagueName, season, fee, gatewayCharge, registrationOpen, lastDate,
 *   leagueDates, venue, logoUrl, teamFee, ownerWhatsapp
 */
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Image,
  ActivityIndicator, StatusBar, Linking, Alert, RefreshControl,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useCallback, useEffect, useState } from "react";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { doc, getDoc } from "firebase/firestore";

import { auth, db } from "../../firebaseConfig";

const SERVER_URL = "https://bookora-backend-95u4.onrender.com";

const GREEN    = "#16A34A";
const GREEN_D  = "#15803D";
const HERO     = "#166534";
const DARK     = "#0B1220";
const GOLD     = "#F59E0B";
const BG       = "#F3F4F6";
const BORDER   = "#E5E7EB";
const MUTED    = "#6B7280";

function fmtLastDate(v?: string): string {
  if (!v) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v).trim());
  if (!m) return String(v);
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (isNaN(d.getTime())) return String(v);
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

export default function AplHome() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ leagueId?: string }>();
  const leagueId = (params.leagueId as string) || "apl-2026";

  const [cfg, setCfg]             = useState<any>(null);
  const [registered, setRegistered] = useState(false);
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const snap = await getDoc(doc(db, "appConfig", leagueId));
      setCfg(snap.exists() ? snap.data() : null);

      if (auth.currentUser) {
        const reg = await getDoc(doc(db, "aplRegistrations", `${leagueId}_${auth.currentUser.uid}`));
        setRegistered(reg.exists() && reg.data()?.paymentStatus === "paid");
      } else {
        setRegistered(false);
      }
    } catch {
      /* keep whatever we had */
    } finally {
      setLoading(false);
    }
  }, [leagueId]);

  useEffect(() => {
    fetch(`${SERVER_URL}/`).catch(() => {});   // wake the server while they read
    load();
  }, [load]);

  // coming back from the form / status → refresh the button
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const startRegister = () => {
    if (registered) {
      router.push({ pathname: "/apl/status", params: { leagueId } } as any);
      return;
    }
    if (!auth.currentUser) {
      Alert.alert("Login required", "Log in to register as a player. It takes a minute.", [
        { text: "Cancel", style: "cancel" },
        { text: "Log in", onPress: () => router.push("/(auth)/login") },
      ]);
      return;
    }
    router.push({ pathname: "/apl/register", params: { leagueId } } as any);
  };

  const chatOwner = () => {
    const num = String(cfg?.ownerWhatsapp || "").replace(/\D/g, "");
    if (!num) return Alert.alert("Not available", "The contact number is not added yet.");
    const text = encodeURIComponent(`Hi, I want to own a team in ${cfg?.leagueName || "the league"}.`);
    Linking.openURL(`https://wa.me/${num}?text=${text}`).catch(() =>
      Alert.alert("Could not open WhatsApp", "Please try again."));
  };

  if (loading) {
    return <View style={[s.center, { backgroundColor: BG }]}><ActivityIndicator size="large" color={GREEN} /></View>;
  }

  if (!cfg) {
    return (
      <SafeAreaView style={[s.center, { backgroundColor: BG, padding: 28 }]}>
        <Ionicons name="trophy-outline" size={42} color={MUTED} />
        <Text style={s.closedTitle}>Nothing here yet</Text>
        <Text style={s.closedSub}>This league is not open yet. Check back soon.</Text>
        <TouchableOpacity onPress={() => router.back()} style={s.closedBtn}>
          <Text style={s.closedBtnTxt}>Go back</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  const fee     = Number(cfg.fee || 0);
  const charge  = Number(cfg.gatewayCharge || 0);
  const total   = fee + charge;
  const open    = cfg.registrationOpen !== false;
  const lastDay = fmtLastDate(cfg.lastDate);
  // Set in admin → League Setup. Empty on purpose = no badge at all.
  // Type just the brand ("Unity Construction") and "Sponsored by" is added for you.
  const rawSponsor  = String(cfg.sponsorText ?? "Sponsored by PlayOn").trim();
  const sponsorLine = rawSponsor
    ? (/sponsor/i.test(rawSponsor) ? rawSponsor : `Sponsored by ${rawSponsor}`).toUpperCase()
    : "";

  return (
    <View style={{ flex: 1, backgroundColor: BG }}>
      <StatusBar barStyle="light-content" backgroundColor={HERO} />

      <ScrollView
        contentContainerStyle={{ paddingBottom: 24 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={GREEN} />}
      >
        {/* ── HERO ── */}
        <View style={[s.hero, { paddingTop: insets.top + 12 }]}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <TouchableOpacity onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)" as any))}
              hitSlop={10} style={s.backBtn}>
              <Ionicons name="chevron-back" size={22} color="#E5E7EB" />
            </TouchableOpacity>
            {!!sponsorLine && (
              <View style={s.sponsorPill}>
                <View style={s.sponsorDot} />
                <Text style={s.sponsorTxt} numberOfLines={1}>{sponsorLine}</Text>
              </View>
            )}
          </View>

          <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginTop: 14 }}>
            <View style={{ flex: 1, gap: 7 }}>
              {!!cfg.season && <Text style={s.season}>{String(cfg.season).toUpperCase()}</Text>}
              <Text style={s.heroTitle}>Player{"\n"}Registration</Text>
              <Text style={s.heroSub}>
                {cfg.leagueDates ? `Turf cricket · ${cfg.leagueDates}` : cfg.leagueName}
                {cfg.venue ? `\n${cfg.venue}` : ""}
              </Text>
            </View>
            {!!cfg.logoUrl && <Image source={{ uri: cfg.logoUrl }} style={s.logo} resizeMode="contain" />}
          </View>

          <View style={[s.statusPill, !open && { backgroundColor: "#FEE2E2" }]}>
            <Ionicons name={open ? "time-outline" : "lock-closed-outline"} size={14} color={open ? "#451A03" : "#7F1D1D"} />
            <Text style={[s.statusTxt, !open && { color: "#7F1D1D" }]}>
              {open ? "PLAYER REGISTRATION OPEN" : "REGISTRATION CLOSED"}
            </Text>
          </View>
        </View>

        <View style={{ padding: 16, gap: 12 }}>

          {/* ── FACTS ── */}
          <View style={{ flexDirection: "row", gap: 10 }}>
            <Fact value={`₹${fee}`} label="Entry fee" />
            {!!lastDay && <Fact value={lastDay} label="Last date" />}
            <Fact value="Auction" label="Selection" />
          </View>

          {/* ── HOW IT WORKS ── */}
          <View style={s.card}>
            <Text style={s.cardTitle}>How you get into a team</Text>

            <Step n="1" title="Fill your player details"
              sub="Photo, your role, batting and bowling style." />
            <Step n="2" title={`Pay ₹${fee} registration`}
              sub="UPI, card or netbanking. Takes a minute." />
            <Step n="3" title={`Your name goes into the ${cfg.leagueName || "league"} auction`}
              sub="Team owners pick their players from the pool." green />
          </View>

          {/* ── REFUND ── */}
          <View style={s.refundBox}>
            <Ionicons name="refresh" size={18} color={GREEN_D} style={{ marginTop: 1 }} />
            <Text style={s.refundTxt}>
              No team picks you in the auction? Your <Text style={{ fontWeight: "800" }}>₹{fee} is refunded in full</Text>.
            </Text>
          </View>

          {/* ── TEAM OWNER ── */}
          <View style={s.ownerCard}>
            <View style={{ flex: 1 }}>
              <Text style={s.ownerTitle}>Want to own a team?</Text>
              <Text style={s.ownerSub}>
                {cfg.teamFee ? `₹${Number(cfg.teamFee).toLocaleString("en-IN")} per team · talk to us` : "Talk to us"}
              </Text>
            </View>
            <TouchableOpacity style={s.waBtn} activeOpacity={0.9} onPress={chatOwner}>
              <Ionicons name="logo-whatsapp" size={15} color="#FFFFFF" />
              <Text style={s.waTxt}>WhatsApp</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>

      {/* ── STICKY CTA ── */}
      <View style={[s.bottom, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        <TouchableOpacity
          style={[s.cta, !open && !registered && { backgroundColor: "#9CA3AF" }]}
          activeOpacity={0.9}
          disabled={!open && !registered}
          onPress={startRegister}
        >
          <Text style={s.ctaTxt}>
            {registered ? "View my player pass" : open ? "Register as a Player" : "Registration closed"}
          </Text>
          <Ionicons name="chevron-forward" size={18} color="#FFFFFF" />
        </TouchableOpacity>
        {!registered && open && (
          <Text style={s.ctaNote}>
            ₹{fee} registration{charge > 0 ? ` + ₹${charge} payment charge` : ""} · Secured by Razorpay
          </Text>
        )}
      </View>
    </View>
  );
}

function Fact({ value, label }: { value: string; label: string }) {
  return (
    <View style={s.fact}>
      <Text style={s.factValue} numberOfLines={1}>{value}</Text>
      <Text style={s.factLabel}>{label}</Text>
    </View>
  );
}

function Step({ n, title, sub, green }: { n: string; title: string; sub: string; green?: boolean }) {
  return (
    <View style={{ flexDirection: "row", gap: 12, marginTop: 14 }}>
      <View style={[s.stepNum, green && { backgroundColor: GREEN }]}>
        <Text style={s.stepNumTxt}>{n}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={s.stepTitle}>{title}</Text>
        <Text style={s.stepSub}>{sub}</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },

  closedTitle: { fontSize: 17, fontWeight: "700", color: "#111827", marginTop: 14 },
  closedSub: { fontSize: 13.5, color: MUTED, textAlign: "center", marginTop: 6 },
  closedBtn: { marginTop: 18, backgroundColor: DARK, borderRadius: 10, paddingHorizontal: 20, paddingVertical: 12 },
  closedBtnTxt: { color: "#FFFFFF", fontWeight: "700", fontSize: 14 },

  hero: { backgroundColor: HERO, paddingHorizontal: 20, paddingBottom: 22 },
  backBtn: { width: 36, height: 36, borderRadius: 10, borderWidth: 1, borderColor: "#263349", backgroundColor: "#141E31", alignItems: "center", justifyContent: "center" },
  sponsorPill: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#112B1C", borderWidth: 1, borderColor: "#1B5E35", borderRadius: 999, paddingHorizontal: 11, paddingVertical: 6 },
  sponsorDot: { width: 7, height: 7, borderRadius: 999, backgroundColor: "#22C55E" },
  sponsorTxt: { color: "#86EFAC", fontSize: 11, fontWeight: "700", letterSpacing: 0.3 },
  season: { fontSize: 12, fontWeight: "700", color: "#FCD34D", letterSpacing: 1.8 },
  heroTitle: { fontSize: 27, fontWeight: "800", color: "#FFFFFF", lineHeight: 30 },
  heroSub: { fontSize: 12.5, color: "#D1FAE5", lineHeight: 18 },
  logo: { width: 132, height: 132 },
  statusPill: { alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 7, backgroundColor: GOLD, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7, marginTop: 14 },
  statusTxt: { fontSize: 12, fontWeight: "800", color: "#451A03", letterSpacing: 0.4 },

  fact: { flex: 1, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: BORDER, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 10 },
  factValue: { fontSize: 18, fontWeight: "800", color: "#111827" },
  factLabel: { fontSize: 11, color: MUTED, fontWeight: "600", marginTop: 3 },

  card: { backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: BORDER, borderRadius: 14, padding: 16 },
  cardTitle: { fontSize: 14, fontWeight: "700", color: "#111827" },
  stepNum: { width: 26, height: 26, borderRadius: 999, backgroundColor: DARK, alignItems: "center", justifyContent: "center" },
  stepNumTxt: { color: "#FFFFFF", fontSize: 12, fontWeight: "700" },
  stepTitle: { fontSize: 13, fontWeight: "700", color: "#111827" },
  stepSub: { fontSize: 12, color: MUTED, lineHeight: 17, marginTop: 2 },

  refundBox: { flexDirection: "row", gap: 10, backgroundColor: "#F0FDF4", borderWidth: 1, borderColor: "#BBF7D0", borderRadius: 12, padding: 12 },
  refundTxt: { flex: 1, fontSize: 12.5, color: "#14532D", lineHeight: 19 },

  ownerCard: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: DARK, borderRadius: 14, padding: 14 },
  ownerTitle: { fontSize: 13, fontWeight: "700", color: "#FFFFFF" },
  ownerSub: { fontSize: 12, color: "#9CA3AF", marginTop: 3 },
  waBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: GREEN, borderRadius: 10, paddingHorizontal: 13, paddingVertical: 10 },
  waTxt: { color: "#FFFFFF", fontSize: 12.5, fontWeight: "700" },

  bottom: { backgroundColor: "#FFFFFF", borderTopWidth: 1, borderTopColor: BORDER, paddingHorizontal: 16, paddingTop: 12, gap: 7 },
  cta: { height: 52, borderRadius: 12, backgroundColor: GREEN, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  ctaTxt: { color: "#FFFFFF", fontSize: 15, fontWeight: "700" },
  ctaNote: { fontSize: 11, color: MUTED, textAlign: "center" },
});
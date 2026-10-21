// =======================================================
// 🤝 REFER & EARN — User Screen
// Place at: app/refer-and-earn.tsx
// (adjust firebaseConfig import path if you nest it deeper)
//
// Flow:
//  1. User shares their referral code
//  2. Friend enters code at signup
//  3. After friend's FIRST booking completes → referrer
//     earns PCoins (amount set by admin in Referral Control)
//
// Requires: npx expo install expo-clipboard
// =======================================================
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  StatusBar,
  Alert,
  Share,
  RefreshControl,
} from "react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import { auth, db } from "../../firebaseConfig";
import {
  doc,
  getDoc,
  setDoc,
  collection,
  query,
  where,
  getDocs,
} from "firebase/firestore";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const SERVER_URL = "https://bookora-backend-95u4.onrender.com";
const BRAND = "#0B1220";
const GOLD  = "#D97706";
const GREEN = "#059669";

type Referral = {
  id: string;
  referredName?: string;
  status: "pending" | "completed" | string;
  rewardCoins?: number;
  createdAt?: any;
  completedAt?: any;
};

// Deterministic code from uid — same user always gets the same code
const generateCode = (uid: string) => {
  const clean = uid.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  return "PLAY" + (clean.slice(0, 3) + clean.slice(-3)).slice(0, 6);
};

const fmtDate = (ts: any): string => {
  if (!ts) return "";
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
};

export default function ReferAndEarn() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [loading,     setLoading]     = useState(true);
  const [refreshing,  setRefreshing]  = useState(false);
  const [myCode,      setMyCode]      = useState("");
  const [rewardCoins, setRewardCoins] = useState(50);
  const [enabled,     setEnabled]     = useState(true);
  const [referrals,   setReferrals]   = useState<Referral[]>([]);
  const [shareLink,   setShareLink]   = useState("https://playon.app");
  const [copied,      setCopied]      = useState(false);

  const fetchAll = useCallback(async () => {
    const user = auth.currentUser;
    if (!user) { setLoading(false); return; }

    try {
      // 1. My referral code — generate + save if missing (older accounts)
      const userSnap = await getDoc(doc(db, "users", user.uid));
      let code = userSnap.exists() ? userSnap.data()?.referralCode : "";
      if (!code) {
        code = generateCode(user.uid);
        await setDoc(doc(db, "users", user.uid), { referralCode: code }, { merge: true });
      }
      setMyCode(code);

      // 2. Program config (reward amount is admin-controlled)
      try {
        const res  = await fetch(`${SERVER_URL}/referral-config`);
        const data = await res.json();
        if (data?.success) {
          setRewardCoins(Number(data.rewardCoins || 0));
          setEnabled(data.enabled !== false);
        }
      } catch (e) { console.log("referral-config fetch failed", e); }

      // 3. App share link
      try {
        const cfgSnap = await getDoc(doc(db, "appConfig", "general"));
        if (cfgSnap.exists()) {
          const raw = cfgSnap.data()?.shareLink || "";
          if (raw) setShareLink(raw.startsWith("http") ? raw : `https://${raw}`);
        }
      } catch {}

      // 4. My referrals (no orderBy → no composite index needed; sort client-side)
      const refSnap = await getDocs(
        query(collection(db, "referrals"), where("referrerUid", "==", user.uid))
      );
      const list: Referral[] = refSnap.docs.map(d => ({ id: d.id, ...d.data() } as Referral));
      list.sort((a, b) => {
        const ta = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : 0;
        const tb = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : 0;
        return tb - ta;
      });
      setReferrals(list);
    } catch (e) {
      console.error("refer-and-earn fetch error:", e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const onRefresh = () => { setRefreshing(true); fetchAll(); };

  const totalEarned = useMemo(
    () => referrals
      .filter(r => r.status === "completed")
      .reduce((sum, r) => sum + Number(r.rewardCoins || 0), 0),
    [referrals]
  );
  const pendingCount   = referrals.filter(r => r.status === "pending").length;
  const completedCount = referrals.filter(r => r.status === "completed").length;

  const handleCopy = async () => {
    try {
      await Clipboard.setStringAsync(myCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      Alert.alert("Your code", myCode);
    }
  };

  const handleShare = async () => {
    const message =
      `*PlayOn — Book Sports Venues!*\n\n` +
      `Sign up with my referral code *${myCode}* and book your first game! 🏏⚽\n\n` +
      `Download now: ${shareLink}`;
    try {
      await Share.share({ message, title: "PlayOn — Refer & Earn" });
    } catch {
      Alert.alert("Error", "Unable to share right now.");
    }
  };

  if (loading) {
    return (
      <View style={s.center}>
        <StatusBar barStyle="light-content" backgroundColor={BRAND} />
        <ActivityIndicator size="large" color={BRAND} />
      </View>
    );
  }

  return (
    <View style={s.root}>
      <StatusBar barStyle="light-content" backgroundColor={BRAND} />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* ── Hero ── */}
        <View style={[s.hero, { paddingTop: insets.top + 12 }]}>
          <View style={s.heroTop}>
            <TouchableOpacity onPress={() => router.back()} style={s.backBtn} hitSlop={10}>
              <Ionicons name="chevron-back" size={22} color="#fff" />
            </TouchableOpacity>
            <Text style={s.heroLabel}>Refer & Earn</Text>
            <View style={{ width: 36 }} />
          </View>

          <Text style={{ fontSize: 44, textAlign: "center", marginTop: 6 }}>🎁</Text>
          <Text style={s.heroTitle}>
            {enabled && rewardCoins > 0
              ? `Earn ${rewardCoins} PCoins`
              : "Refer your friends"}
          </Text>
          <Text style={s.heroSub}>
            {enabled && rewardCoins > 0
              ? `for every friend who joins with your code and completes their first booking`
              : `The referral program is paused right now — check back soon!`}
          </Text>
        </View>

        {/* ── Code card ── */}
        <View style={s.codeCard}>
          <Text style={s.codeLabel}>YOUR REFERRAL CODE</Text>
          <View style={s.codeRow}>
            <Text style={s.codeTxt}>{myCode}</Text>
            <TouchableOpacity style={s.copyBtn} onPress={handleCopy} activeOpacity={0.8}>
              <Ionicons
                name={copied ? "checkmark" : "copy-outline"}
                size={16}
                color={copied ? GREEN : BRAND}
              />
              <Text style={[s.copyBtnTxt, copied && { color: GREEN }]}>
                {copied ? "Copied" : "Copy"}
              </Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={s.shareBtn} onPress={handleShare} activeOpacity={0.85}>
            <Ionicons name="share-social-outline" size={18} color="#fff" />
            <Text style={s.shareBtnTxt}>Share with Friends</Text>
          </TouchableOpacity>
        </View>

        {/* ── Stats row ── */}
        <View style={s.statsRow}>
          <View style={s.statBox}>
            <Text style={s.statNum}>{referrals.length}</Text>
            <Text style={s.statLabel}>Invited</Text>
          </View>
          <View style={s.statBox}>
            <Text style={[s.statNum, { color: GOLD }]}>{pendingCount}</Text>
            <Text style={s.statLabel}>Pending</Text>
          </View>
          <View style={s.statBox}>
            <Text style={[s.statNum, { color: GREEN }]}>{totalEarned}</Text>
            <Text style={s.statLabel}>PCoins Earned</Text>
          </View>
        </View>

        {/* ── How it works ── */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>How it works</Text>
          <View style={s.stepsCard}>
            {[
              { icon: "share-social-outline", title: "Share your code",
                sub: "Send your referral code to friends & family" },
              { icon: "person-add-outline", title: "Friend signs up",
                sub: "They enter your code while creating their account" },
              { icon: "calendar-outline", title: "First booking completes",
                sub: "Once their first booking is played, you get rewarded" },
              { icon: "wallet-outline", title: "PCoins in your wallet",
                sub: `Coins land in your wallet automatically — use them on any booking` },
            ].map((step, i, arr) => (
              <View key={step.title} style={s.stepRow}>
                <View style={s.stepLeft}>
                  <View style={s.stepIcon}>
                    <Ionicons name={step.icon as any} size={17} color={BRAND} />
                  </View>
                  {i < arr.length - 1 && <View style={s.stepLine} />}
                </View>
                <View style={s.stepText}>
                  <Text style={s.stepTitle}>{step.title}</Text>
                  <Text style={s.stepSub}>{step.sub}</Text>
                </View>
              </View>
            ))}
          </View>
        </View>

        {/* ── My referrals ── */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>
            My Referrals{referrals.length > 0 ? ` (${referrals.length})` : ""}
          </Text>

          {referrals.length === 0 ? (
            <View style={s.emptyCard}>
              <Ionicons name="people-outline" size={34} color="#D1D5DB" />
              <Text style={s.emptyTitle}>No referrals yet</Text>
              <Text style={s.emptySub}>
                Share your code above — your friends will show up here.
              </Text>
            </View>
          ) : (
            <View style={s.refList}>
              {referrals.map((r, i) => {
                const done = r.status === "completed";
                return (
                  <View
                    key={r.id}
                    style={[s.refRow, i > 0 && { borderTopWidth: 1, borderTopColor: "#F3F4F6" }]}
                  >
                    <View style={[s.refAvatar, done && { backgroundColor: "#ECFDF5" }]}>
                      <Ionicons
                        name={done ? "checkmark-circle" : "hourglass-outline"}
                        size={18}
                        color={done ? GREEN : GOLD}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.refName} numberOfLines={1}>
                        {r.referredName || "Your friend"}
                      </Text>
                      <Text style={s.refMeta}>
                        {done
                          ? `Completed${r.completedAt ? " · " + fmtDate(r.completedAt) : ""}`
                          : "Waiting for their first booking"}
                      </Text>
                    </View>
                    {done ? (
                      <Text style={s.refReward}>+{r.rewardCoins || 0} 🪙</Text>
                    ) : (
                      <View style={s.pendingChip}>
                        <Text style={s.pendingChipTxt}>Pending</Text>
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          )}
        </View>

        {/* ── Fine print ── */}
        <Text style={s.finePrint}>
          Reward is credited only after your friend's first booking is completed
          (not cancelled). PlayOn may change the reward amount at any time.
        </Text>
      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root:   { flex: 1, backgroundColor: "#F5F6FA" },
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#fff" },

  hero:      { backgroundColor: BRAND, paddingHorizontal: 20, paddingBottom: 26, borderBottomLeftRadius: 24, borderBottomRightRadius: 24 },
  heroTop:   { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  backBtn:   { width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(255,255,255,0.1)", alignItems: "center", justifyContent: "center" },
  heroLabel: { fontSize: 15, fontWeight: "800", color: "#fff" },
  heroTitle: { fontSize: 26, fontWeight: "800", color: "#fff", textAlign: "center", marginTop: 8, letterSpacing: -0.4 },
  heroSub:   { fontSize: 13, color: "#94A3B8", textAlign: "center", marginTop: 6, lineHeight: 19, paddingHorizontal: 12 },

  codeCard:  { marginHorizontal: 16, marginTop: -14, backgroundColor: "#fff", borderRadius: 16, borderWidth: 1, borderColor: "#E5E7EB", padding: 16, shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 3 },
  codeLabel: { fontSize: 11, fontWeight: "800", color: "#9CA3AF", letterSpacing: 1 },
  codeRow:   { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 8, backgroundColor: "#F5F6FA", borderRadius: 12, borderWidth: 1.5, borderColor: "#E5E7EB", borderStyle: "dashed", paddingHorizontal: 14, paddingVertical: 12 },
  codeTxt:   { fontSize: 20, fontWeight: "800", color: BRAND, letterSpacing: 2 },
  copyBtn:   { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "#fff", borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 99, paddingHorizontal: 12, paddingVertical: 6 },
  copyBtnTxt:{ fontSize: 12, fontWeight: "800", color: BRAND },
  shareBtn:  { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: BRAND, borderRadius: 12, paddingVertical: 13, marginTop: 12 },
  shareBtnTxt:{ color: "#fff", fontWeight: "800", fontSize: 14 },

  statsRow: { flexDirection: "row", gap: 10, marginHorizontal: 16, marginTop: 14 },
  statBox:  { flex: 1, backgroundColor: "#fff", borderRadius: 14, borderWidth: 1, borderColor: "#E5E7EB", paddingVertical: 14, alignItems: "center" },
  statNum:  { fontSize: 20, fontWeight: "800", color: BRAND },
  statLabel:{ fontSize: 11, color: "#9CA3AF", fontWeight: "600", marginTop: 3 },

  section:      { marginTop: 22, paddingHorizontal: 16 },
  sectionTitle: { fontSize: 16, fontWeight: "800", color: BRAND, marginBottom: 10 },

  stepsCard: { backgroundColor: "#fff", borderRadius: 16, borderWidth: 1, borderColor: "#E5E7EB", padding: 16 },
  stepRow:   { flexDirection: "row", gap: 12 },
  stepLeft:  { alignItems: "center" },
  stepIcon:  { width: 36, height: 36, borderRadius: 18, backgroundColor: "#F5F6FA", borderWidth: 1, borderColor: "#E5E7EB", alignItems: "center", justifyContent: "center" },
  stepLine:  { width: 2, flex: 1, backgroundColor: "#E5E7EB", marginVertical: 4, minHeight: 18 },
  stepText:  { flex: 1, paddingBottom: 18 },
  stepTitle: { fontSize: 14, fontWeight: "700", color: BRAND },
  stepSub:   { fontSize: 12, color: "#9CA3AF", marginTop: 2, lineHeight: 17 },

  emptyCard:  { backgroundColor: "#fff", borderRadius: 16, borderWidth: 1, borderColor: "#E5E7EB", alignItems: "center", paddingVertical: 30, paddingHorizontal: 20 },
  emptyTitle: { fontSize: 14, fontWeight: "700", color: BRAND, marginTop: 10 },
  emptySub:   { fontSize: 12, color: "#9CA3AF", textAlign: "center", marginTop: 4, lineHeight: 18 },

  refList:   { backgroundColor: "#fff", borderRadius: 16, borderWidth: 1, borderColor: "#E5E7EB", overflow: "hidden" },
  refRow:    { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 13 },
  refAvatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: "#FFFBEB", alignItems: "center", justifyContent: "center" },
  refName:   { fontSize: 14, fontWeight: "700", color: BRAND },
  refMeta:   { fontSize: 12, color: "#9CA3AF", marginTop: 2 },
  refReward: { fontSize: 14, fontWeight: "800", color: GREEN },
  pendingChip:    { backgroundColor: "#FFFBEB", borderWidth: 1, borderColor: "#FDE68A", borderRadius: 99, paddingHorizontal: 10, paddingVertical: 4 },
  pendingChipTxt: { fontSize: 11, fontWeight: "700", color: GOLD },

  finePrint: { fontSize: 11, color: "#B0B5BD", textAlign: "center", marginTop: 22, marginHorizontal: 32, lineHeight: 16 },
});
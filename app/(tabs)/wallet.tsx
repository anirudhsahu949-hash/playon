import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  StatusBar,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { useEffect, useState, useCallback } from "react";
import { auth, db } from "../../firebaseConfig";
import {
  doc, getDoc,
  collection, query, where, getDocs, orderBy, limit,
} from "firebase/firestore";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

// ── Design tokens ──────────────────────────────────────────────────────────────
const DARK    = "#0B1220";
// PCoin + VCoin now share the same "real money" green family
const PCOIN_GRADIENT: [string, string, string] = ["#0F5132", "#146C43", "#0B3D26"];
const VCOIN_GRADIENT: [string, string] = ["#1B7A4F", "#0F5132"];
const COIN_TEXT_MUTED = "rgba(255,255,255,0.65)";
const COIN_TEXT_FAINT = "rgba(255,255,255,0.55)";
const GRAY1   = "#F9FAFB";
const GRAY2   = "#E5E7EB";
const GRAY3   = "#9CA3AF";
const GRAY4   = "#6B7280";
const GRAY5   = "#374151";
const WHITE   = "#FFFFFF";
const GREEN   = "#16A34A";
const PENDING_C = "#FDE68A";

// ── Types ─────────────────────────────────────────────────────────────────────
type VCoinEntry = {
  walletKey: string; // uid_turfId
  turfId:    string;
  turfName:  string;
  balance:   number;
  totalEarned:   number;
  totalRedeemed: number;
};

type LedgerEntry = {
  id:        string;
  type:      "pcoin_earn" | "pcoin_redeem" | "pcoin_earn_pending" | "pcoin_earn_reversed" | "pcoin_redeem_reversed"
           | "vcoin_earn" | "vcoin_redeem" | "vcoin_earn_pending" | "vcoin_earn_reversed" | "vcoin_redeem_reversed";
  coins:     number;
  turfName?: string;
  turfId?:   string;
  bookingId?: string;
  createdAt:  any;
  note?:      string;
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtDate(ts: any): string {
  if (!ts) return "";
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  if (isNaN(d.getTime())) return "";
  const now  = new Date();
  const diff = Math.floor((now.getTime() - d.getTime()) / 1000);
  if (diff < 60)   return "Just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400)return `${Math.floor(diff / 3600)}h ago`;
  const days = Math.floor(diff / 86400);
  if (days < 7)    return `${days}d ago`;
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

function ledgerMeta(type: LedgerEntry["type"]): {
  label: string; icon: keyof typeof Ionicons.glyphMap;
  color: string; bg: string; sign: "+" | "-";
} {
  switch (type) {
    case "pcoin_earn":
      return { label: "PCoin Earned",    icon: "star",                  color: GREEN, bg: "#DCFCE7", sign: "+" };
    case "pcoin_earn_pending":
      return { label: "PCoin Pending",   icon: "time-outline",          color: "#B45309", bg: "#FEF3C7", sign: "+" };
    case "pcoin_redeem":
      return { label: "PCoin Used",      icon: "arrow-up-circle",       color: "#DC2626", bg: "#FEE2E2", sign: "-" };
    case "pcoin_earn_reversed":
      return { label: "PCoin Reversed",  icon: "close-circle",          color: GRAY3, bg: GRAY1, sign: "-" };
    case "pcoin_redeem_reversed":
      return { label: "PCoin Refunded",  icon: "arrow-undo-circle",     color: GREEN, bg: "#DCFCE7", sign: "+" };
    case "vcoin_earn":
      return { label: "VCoin Earned",    icon: "star",                  color: GREEN, bg: "#DCFCE7", sign: "+" };
    case "vcoin_earn_pending":
      return { label: "VCoin Pending",   icon: "time-outline",          color: "#B45309", bg: "#FEF3C7", sign: "+" };
    case "vcoin_redeem":
      return { label: "VCoin Used",      icon: "arrow-up-circle",       color: "#DC2626", bg: "#FEE2E2", sign: "-" };
    case "vcoin_earn_reversed":
      return { label: "VCoin Reversed",  icon: "close-circle",          color: GRAY3, bg: GRAY1, sign: "-" };
    case "vcoin_redeem_reversed":
      return { label: "VCoin Refunded",  icon: "arrow-undo-circle",     color: GREEN, bg: "#DCFCE7", sign: "+" };
    default:
      return { label: "Transaction",     icon: "swap-horizontal",       color: GRAY4, bg: GRAY1, sign: "+" };
  }
}

// ── Main Screen ───────────────────────────────────────────────────────────────
export default function WalletScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // PCoin
  const [pcoinBalance,   setPcoinBalance]   = useState(0);
  const [pcoinEarned,    setPcoinEarned]    = useState(0);
  const [pcoinRedeemed,  setPcoinRedeemed]  = useState(0);
  const [pcoinPending,   setPcoinPending]   = useState(0);

  // VCoin per turf
  const [vcoins, setVcoins] = useState<VCoinEntry[]>([]);

  // Ledger
  const [ledger,  setLedger]  = useState<LedgerEntry[]>([]);

  const uid = auth.currentUser?.uid;

  // ── Fetch ─────────────────────────────────────────────────────────────────
  const fetchAll = useCallback(async (isRefresh = false) => {
    if (!uid) return;
    isRefresh ? setRefreshing(true) : setLoading(true);

    try {
      // 1. PCoin wallet
      try {
        const pcSnap = await getDoc(doc(db, "pcoinWallets", uid));
        if (pcSnap.exists()) {
          const d = pcSnap.data();
          setPcoinBalance(Number(d.balance   || 0));
          setPcoinEarned( Number(d.totalEarned   || 0));
          setPcoinRedeemed(Number(d.totalRedeemed || 0));
          setPcoinPending( Number(d.pendingBalance || 0));
        }
      } catch {}

      // 2. VCoin wallets — query all wallets belonging to this user
      try {
        const vcSnap = await getDocs(
          query(collection(db, "vcoinWallets"), where("uid", "==", uid))
        );
        const entries: VCoinEntry[] = vcSnap.docs
          .map(d => ({ walletKey: d.id, ...d.data() } as VCoinEntry))
          .filter(e => e.balance > 0 || e.totalEarned > 0) // only show turfs with activity
          .sort((a, b) => b.balance - a.balance);           // highest balance first
        setVcoins(entries);
      } catch {}

      // 3. Combined ledger — latest 30 entries
      try {
        const [pcLedger, vcLedger] = await Promise.all([
          getDocs(query(
            collection(db, "pcoinLedger"),
            where("uid", "==", uid),
            orderBy("createdAt", "desc"),
            limit(30),
          )),
          getDocs(query(
            collection(db, "vcoinLedger"),
            where("uid", "==", uid),
            orderBy("createdAt", "desc"),
            limit(30),
          )),
        ]);

        const combined: LedgerEntry[] = [
          ...pcLedger.docs.map(d => ({ id: d.id, ...d.data() } as LedgerEntry)),
          ...vcLedger.docs.map(d => ({ id: d.id, ...d.data() } as LedgerEntry)),
        ].sort((a, b) => {
          const ta = a.createdAt?.toDate?.().getTime() || 0;
          const tb = b.createdAt?.toDate?.().getTime() || 0;
          return tb - ta;
        }).slice(0, 40);

        setLedger(combined);
      } catch {}

    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [uid]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // ── Total VCoin across all turfs ──────────────────────────────────────────
  const totalVcoin = vcoins.reduce((s, v) => s + v.balance, 0);

  // ── Render ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <SafeAreaView style={s.safe}>
        <StatusBar barStyle="light-content" backgroundColor={DARK} />
        <View style={s.loader}>
          <ActivityIndicator size="large" color={PCOIN_GRADIENT[1]} />
        </View>
      </SafeAreaView>
    );
  }

  return (
   <SafeAreaView style={s.safe} edges={["left", "right", "bottom"]}>
  <StatusBar barStyle="light-content" backgroundColor={DARK} />

  {/* ── HEADER */}

      {/* ── HEADER ─────────────────────────────────────────────────────── */}
      <View style={[s.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn} hitSlop={10}>
          <Ionicons name="chevron-back" size={22} color="#fff" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={s.headerTitle}>My Wallet</Text>
          <Text style={s.headerSub}>Coins & rewards</Text>
        </View>
        {/* Total summary pill */}
        <View style={s.totalPill}>
          <Text style={s.totalPillTxt}>
            {pcoinBalance + totalVcoin} 🪙
          </Text>
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={s.scroll}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => fetchAll(true)} tintColor={PCOIN_GRADIENT[1]} />
        }
      >

        {/* ══════════════════════════════════════════════════════════════
            SECTION 1 — PLAYON COIN (PCoin) — premium green "real money" card
        ══════════════════════════════════════════════════════════════ */}
        <View style={s.sectionLabel}>
          <View style={[s.sectionDot, { backgroundColor: PCOIN_GRADIENT[1] }]} />
          <Text style={s.sectionLabelTxt}>Playon Coin  ·  PCoin</Text>
        </View>

        <LinearGradient colors={PCOIN_GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.coinCard}>
          {/* Balance */}
          <View style={s.balanceBlock}>
            <View style={s.coinIconCircle}>
              <Text style={s.coinEmoji}>🪙</Text>
            </View>
            <View style={{ flex: 1, marginLeft: 14 }}>
              <Text style={s.coinBalanceNum}>{pcoinBalance}</Text>
              <Text style={s.coinBalanceLbl}>Available PCoin</Text>
            </View>
            <View style={s.worthPill}>
              <Text style={s.worthTxt}>₹{pcoinBalance} worth</Text>
            </View>
          </View>

          {/* Info note */}
          <View style={s.infoNote}>
            <Ionicons name="information-circle-outline" size={14} color="#fff" />
            <Text style={s.infoNoteTxt}>
              Use on any turf  ·  1 PCoin = ₹1 off
            </Text>
          </View>

          {/* Pending banner */}
          {pcoinPending > 0 && (
            <View style={s.pendingBanner}>
              <Ionicons name="time-outline" size={14} color={PENDING_C} />
              <Text style={s.pendingBannerTxt}>
                {pcoinPending} PCoin pending — credited after your slot is completed
              </Text>
            </View>
          )}

          {/* Stats row */}
          <View style={s.statsRow}>
            <View style={s.statItem}>
              <Text style={s.statVal}>{pcoinEarned}</Text>
              <Text style={s.statLbl}>Total Earned</Text>
            </View>
            <View style={s.statDivider} />
            <View style={s.statItem}>
              <Text style={s.statVal}>{pcoinRedeemed}</Text>
              <Text style={s.statLbl}>Total Used</Text>
            </View>
            <View style={s.statDivider} />
            <View style={s.statItem}>
              <Text style={s.statVal}>{pcoinPending}</Text>
              <Text style={s.statLbl}>Pending</Text>
            </View>
          </View>
        </LinearGradient>

        {/* ══════════════════════════════════════════════════════════════
            SECTION 2 — VENUE COIN (VCoin) — same green family, per turf
        ══════════════════════════════════════════════════════════════ */}
        <View style={[s.sectionLabel, { marginTop: 24 }]}>
          <View style={[s.sectionDot, { backgroundColor: VCOIN_GRADIENT[0] }]} />
          <Text style={s.sectionLabelTxt}>Venue Coin  ·  VCoin</Text>
        </View>

        {vcoins.length === 0 ? (
          <View style={s.emptyVcoin}>
            <Text style={{ fontSize: 32, marginBottom: 8 }}>🏟️</Text>
            <Text style={s.emptyTitle}>No VCoin yet</Text>
            <Text style={s.emptySub}>Book a turf to earn venue-specific coins</Text>
          </View>
        ) : (
          <>
            {/* VCoin info note */}
            <View style={s.vcoinInfoNote}>
              <Ionicons name="information-circle-outline" size={14} color="#166B41" />
              <Text style={s.vcoinInfoNoteTxt}>
                VCoin can only be used at the turf it was earned from
              </Text>
            </View>

            {/* Per-turf VCoin cards */}
            {vcoins.map((vc) => (
              <LinearGradient
                key={vc.walletKey}
                colors={VCOIN_GRADIENT}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={s.vcoinCard}
              >
                {/* Turf name row */}
                <View style={s.vcoinTurfRow}>
                  <View style={s.vcoinTurfIcon}>
                    <Ionicons name="football-outline" size={16} color="#fff" />
                  </View>
                  <Text style={s.vcoinTurfName} numberOfLines={1}>{vc.turfName}</Text>
                  <View style={s.worthPillSm}>
                    <Text style={s.worthTxtSm}>₹{vc.balance} worth</Text>
                  </View>
                </View>

                {/* Balance + usage note */}
                <View style={s.vcoinBalRow}>
                  <View>
                    <Text style={s.vcoinBal}>{vc.balance}</Text>
                    <Text style={s.vcoinBalLbl}>Available VCoin</Text>
                  </View>
                  <View style={s.onlyHerePill}>
                    <Ionicons name="lock-closed-outline" size={11} color="#fff" />
                    <Text style={s.onlyHereTxt}>Only here</Text>
                  </View>
                </View>

                {/* Stats */}
                <View style={[s.statsRow, { marginTop: 10 }]}>
                  <View style={s.statItem}>
                    <Text style={[s.statVal, { fontSize: 13 }]}>{vc.totalEarned}</Text>
                    <Text style={s.statLbl}>Earned</Text>
                  </View>
                  <View style={s.statDivider} />
                  <View style={s.statItem}>
                    <Text style={[s.statVal, { fontSize: 13 }]}>{vc.totalRedeemed}</Text>
                    <Text style={s.statLbl}>Used</Text>
                  </View>
                  <View style={s.statDivider} />
                  <View style={s.statItem}>
                    <Text style={[s.statVal, { fontSize: 13 }]}>{vc.balance}</Text>
                    <Text style={s.statLbl}>Balance</Text>
                  </View>
                </View>
              </LinearGradient>
            ))}
          </>
        )}

        {/* ══════════════════════════════════════════════════════════════
            SECTION 3 — TRANSACTION LEDGER
        ══════════════════════════════════════════════════════════════ */}
        <View style={[s.sectionLabel, { marginTop: 28 }]}>
          <View style={[s.sectionDot, { backgroundColor: DARK }]} />
          <Text style={s.sectionLabelTxt}>Recent Transactions</Text>
        </View>

        {ledger.length === 0 ? (
          <View style={s.emptyVcoin}>
            <Ionicons name="receipt-outline" size={36} color={GRAY2} />
            <Text style={s.emptyTitle}>No transactions yet</Text>
            <Text style={s.emptySub}>Your coin history will appear here</Text>
          </View>
        ) : (
          <View style={s.ledgerCard}>
            {ledger.map((entry, idx) => {
              const meta = ledgerMeta(entry.type);
              const isPending = entry.type.includes("pending");
              return (
                <View key={entry.id}>
                  <View style={s.ledgerRow}>
                    {/* Icon */}
                    <View style={[s.ledgerIcon, { backgroundColor: meta.bg }]}>
                      <Ionicons name={meta.icon} size={16} color={meta.color} />
                    </View>

                    {/* Label + turf */}
                    <View style={{ flex: 1, marginLeft: 12 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        <Text style={s.ledgerLabel}>{meta.label}</Text>
                        {isPending && (
                          <View style={s.pendingPill}>
                            <Text style={s.pendingPillTxt}>Pending</Text>
                          </View>
                        )}
                      </View>
                      {!!entry.turfName && (
                        <Text style={s.ledgerTurf} numberOfLines={1}>
                          🏟 {entry.turfName}
                        </Text>
                      )}
                      <Text style={s.ledgerTime}>{fmtDate(entry.createdAt)}</Text>
                    </View>

                    {/* Coins */}
                    <Text style={[
                      s.ledgerCoins,
                      { color: meta.sign === "+" ? (isPending ? "#B45309" : GREEN) : "#DC2626" },
                    ]}>
                      {meta.sign}{entry.coins} 🪙
                    </Text>
                  </View>
                  {idx < ledger.length - 1 && <View style={s.ledgerDivider} />}
                </View>
              );
            })}
          </View>
        )}

        {/* ── Coin rules note ──────────────────────────────────────────── */}
        <View style={s.rulesBox}>
          <Text style={s.rulesTitle}>How coins work</Text>
          <View style={s.ruleRow}>
            <Text style={s.ruleDot}>🪙</Text>
            <Text style={s.ruleTxt}>Coins are <Text style={{ fontWeight: "800" }}>pending</Text> after booking — credited only after your slot is completed</Text>
          </View>
          <View style={s.ruleRow}>
            <Text style={s.ruleDot}>❌</Text>
            <Text style={s.ruleTxt}>Cancelled bookings do <Text style={{ fontWeight: "800" }}>not</Text> earn coins — pending coins are reversed</Text>
          </View>
          <View style={s.ruleRow}>
            <Text style={s.ruleDot}>↩️</Text>
            <Text style={s.ruleTxt}>If you used coins as a discount and the booking is cancelled, those coins are <Text style={{ fontWeight: "800" }}>refunded</Text> back to your wallet</Text>
          </View>
          <View style={s.ruleRow}>
            <Text style={s.ruleDot}>🌐</Text>
            <Text style={s.ruleTxt}>PCoin works on <Text style={{ fontWeight: "800" }}>any turf</Text> · VCoin works only at <Text style={{ fontWeight: "800" }}>the turf it was earned from</Text></Text>
          </View>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: "#F5F6FA" },
  loader: { flex: 1, justifyContent: "center", alignItems: "center" },
  scroll: { paddingHorizontal: 16, paddingBottom: 8 },

  // Header
  header: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: DARK, paddingHorizontal: 16, paddingBottom: 18,
  },
  backBtn:    { width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(255,255,255,0.1)", justifyContent: "center", alignItems: "center" },
  headerTitle:{ color: "#fff", fontSize: 20, fontWeight: "900" },
  headerSub:  { color: "#9DB3C3", fontSize: 12, fontWeight: "600", marginTop: 2 },
  totalPill:  { backgroundColor: "rgba(255,255,255,0.12)", borderRadius: 20, paddingHorizontal: 14, paddingVertical: 7 },
  totalPillTxt:{ color: "#fff", fontSize: 14, fontWeight: "800" },

  // Section label
  sectionLabel:    { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 20, marginBottom: 12 },
  sectionDot:      { width: 8, height: 8, borderRadius: 4 },
  sectionLabelTxt: { fontSize: 13, fontWeight: "800", color: GRAY4, textTransform: "uppercase", letterSpacing: 0.6 },

  // PCoin card — premium green gradient, "real money" feel
  coinCard: {
    borderRadius: 20, padding: 18, overflow: "hidden",
    shadowColor: "#0B3D26", shadowOpacity: 0.35, shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 }, elevation: 6,
  },
  balanceBlock: { flexDirection: "row", alignItems: "center", marginBottom: 14 },
  coinIconCircle:{ width: 52, height: 52, borderRadius: 26, justifyContent: "center", alignItems: "center", backgroundColor: "rgba(255,255,255,0.16)" },
  coinEmoji:    { fontSize: 26 },
  coinBalanceNum:{ fontSize: 34, fontWeight: "900", color: "#fff" },
  coinBalanceLbl:{ fontSize: 12, color: COIN_TEXT_MUTED, fontWeight: "600", marginTop: 2 },
  worthPill:    { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 99, backgroundColor: "rgba(255,255,255,0.18)" },
  worthTxt:     { fontSize: 12, fontWeight: "800", color: "#fff" },

  infoNote: {
    flexDirection: "row", alignItems: "center", gap: 7,
    paddingHorizontal: 12, paddingVertical: 9,
    borderRadius: 10, marginBottom: 12,
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  infoNoteTxt: { fontSize: 12, fontWeight: "600", flex: 1, color: "#fff" },

  pendingBanner: {
    flexDirection: "row", alignItems: "center", gap: 7,
    backgroundColor: "rgba(252,211,77,0.16)", paddingHorizontal: 12, paddingVertical: 9,
    borderRadius: 10, borderWidth: 1, borderColor: "rgba(252,211,77,0.35)", marginBottom: 12,
  },
  pendingBannerTxt: { fontSize: 12, fontWeight: "600", color: PENDING_C, flex: 1 },

  statsRow: {
    flexDirection: "row", backgroundColor: "rgba(0,0,0,0.16)",
    borderRadius: 12, padding: 12,
  },
  statItem:    { flex: 1, alignItems: "center" },
  statVal:     { fontSize: 16, fontWeight: "900", color: "#fff" },
  statLbl:     { fontSize: 10, color: COIN_TEXT_FAINT, fontWeight: "700", marginTop: 3, textTransform: "uppercase" },
  statDivider: { width: 1, backgroundColor: "rgba(255,255,255,0.15)" },

  // VCoin cards — same green family
  vcoinCard: {
    borderRadius: 18, padding: 16, marginBottom: 10, overflow: "hidden",
    shadowColor: "#0F5132", shadowOpacity: 0.3, shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 }, elevation: 4,
  },
  vcoinInfoNote: {
    flexDirection: "row", alignItems: "center", gap: 7,
    backgroundColor: "rgba(23,120,73,0.08)", borderWidth: 1, borderColor: "rgba(23,120,73,0.25)",
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, marginBottom: 10,
  },
  vcoinInfoNoteTxt: { fontSize: 12, fontWeight: "600", color: "#166B41", flex: 1 },
  vcoinTurfRow:    { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 12 },
  vcoinTurfIcon:   { width: 34, height: 34, borderRadius: 10, justifyContent: "center", alignItems: "center", backgroundColor: "rgba(255,255,255,0.16)" },
  vcoinTurfName:   { flex: 1, fontSize: 14, fontWeight: "800", color: "#fff" },
  worthPillSm:     { paddingHorizontal: 9, paddingVertical: 5, borderRadius: 99, backgroundColor: "rgba(255,255,255,0.18)" },
  worthTxtSm:      { fontSize: 11, fontWeight: "800", color: "#fff" },
  vcoinBalRow:     { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 },
  vcoinBal:        { fontSize: 26, fontWeight: "900", color: "#fff" },
  vcoinBalLbl:     { fontSize: 11, color: COIN_TEXT_MUTED, fontWeight: "600", marginTop: 2 },
  onlyHerePill:    { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 99, backgroundColor: "rgba(255,255,255,0.16)" },
  onlyHereTxt:     { fontSize: 11, fontWeight: "800", color: "#fff" },

  // Empty states
  emptyVcoin: { backgroundColor: WHITE, borderRadius: 18, padding: 32, alignItems: "center", borderWidth: 1, borderColor: GRAY2 },
  emptyTitle: { fontSize: 15, fontWeight: "800", color: GRAY5, marginTop: 6 },
  emptySub:   { fontSize: 12, color: GRAY3, marginTop: 4, textAlign: "center" },

  // Ledger
  ledgerCard: {
    backgroundColor: WHITE, borderRadius: 18, borderWidth: 1, borderColor: GRAY2,
    overflow: "hidden",
    shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 6,
    shadowOffset: { width: 0, height: 1 }, elevation: 2,
  },
  ledgerRow:     { flexDirection: "row", alignItems: "center", padding: 14 },
  ledgerIcon:    { width: 38, height: 38, borderRadius: 12, justifyContent: "center", alignItems: "center" },
  ledgerLabel:   { fontSize: 13, fontWeight: "700", color: DARK },
  ledgerTurf:    { fontSize: 11, color: GRAY4, marginTop: 2 },
  ledgerTime:    { fontSize: 10, color: GRAY3, marginTop: 3 },
  ledgerCoins:   { fontSize: 14, fontWeight: "900", minWidth: 60, textAlign: "right" },
  ledgerDivider: { height: 1, backgroundColor: "#F3F4F6", marginHorizontal: 14 },
  pendingPill:   { backgroundColor: "#FEF3C7", paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  pendingPillTxt:{ fontSize: 9, fontWeight: "800", color: "#B45309" },

  // Rules box
  rulesBox: {
    backgroundColor: WHITE, borderRadius: 16, borderWidth: 1, borderColor: GRAY2,
    padding: 16, marginTop: 16,
  },
  rulesTitle: { fontSize: 13, fontWeight: "800", color: DARK, marginBottom: 12 },
  ruleRow:    { flexDirection: "row", gap: 10, marginBottom: 10, alignItems: "flex-start" },
  ruleDot:    { fontSize: 14 },
  ruleTxt:    { fontSize: 12, color: GRAY4, lineHeight: 18, flex: 1 },
});
/**
 * app/(tabs)/wallet.tsx — PlayOn Wallet (redesign, Nov 2026)
 *
 * Layout (top → bottom):
 *   • Green header: back · "Wallet" · ? (help sheet)
 *       Coin balance (PCoin + all VCoins) · shine line · PlayOn Coin card
 *   • Venue Coins — one row per turf, tap → that turf's page
 *   • Transactions — filter chips + compact rows grouped by day
 *   • Help sheet (? button) — how coins work + terms
 *
 * Images (put both in assets/images/):
 *   playon-pcoin.png · playon-vcoin.png
 * Needs expo-linear-gradient (already used in the app).
 */
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  StatusBar,
  ActivityIndicator,
  RefreshControl,
  Image,
  Modal,
  Pressable,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useEffect, useState, useCallback, useMemo } from "react";
import { auth, db } from "../../firebaseConfig";
import {
  doc, getDoc,
  collection, query, where, getDocs, orderBy, limit,
} from "firebase/firestore";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";

const PCOIN_IMG = require("../../assets/images/playon-pcoin.png");
const VCOIN_IMG = require("../../assets/images/playon-vcoin.png");

// ── Design tokens ──────────────────────────────────────────────────────────────
const HEADER_GREEN = "#0E6B37";   // header background
const CARD_GREEN   = "#0E3B27";   // PlayOn Coin card
const GREEN        = "#0E6B3F";   // positive amounts / links
const INK          = "#0B1220";   // main text
const GROUND       = "#F2F4F1";   // screen background
const MINT         = "#DDF5E7";
const GOLD         = "#F5C451";
const AMBER        = "#B45309";
const AMBER_BG     = "#FEF3C7";
const RED          = "#B91C1C";
const RED_BG       = "#FEE2E2";
const MUTED        = "#4B5563";   // secondary text (passes 4.5:1 on white)
const BORDER       = "#E1E7E2";
const DIVIDER      = "#EEF1EF";
const WHITE        = "#FFFFFF";
const BLUE_INK     = "#1E3A8A";
const BLUE_BG      = "#E4EEFB";

// ── Types ─────────────────────────────────────────────────────────────────────
type VCoinEntry = {
  walletKey: string; // uid_turfId
  turfId:    string;
  turfName:  string;
  balance:   number;
  totalEarned:   number;
  totalRedeemed: number;
};

type LedgerType =
  | "pcoin_earn" | "pcoin_redeem" | "pcoin_earn_pending" | "pcoin_earn_reversed" | "pcoin_redeem_reversed"
  | "vcoin_earn" | "vcoin_redeem" | "vcoin_earn_pending" | "vcoin_earn_reversed" | "vcoin_redeem_reversed";

type LedgerEntry = {
  id:        string;
  type:      LedgerType;
  coins:     number;
  turfName?: string;
  turfId?:   string;
  bookingId?: string;
  createdAt:  any;
  note?:      string;
};

type Filter = "all" | "earned" | "used" | "pending";

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmtNum = (n: number) => Number(n || 0).toLocaleString("en-IN");

function toDate(ts: any): Date | null {
  if (!ts) return null;
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  return isNaN(d.getTime()) ? null : d;
}

function fmtTime(ts: any): string {
  const d = toDate(ts);
  if (!d) return "";
  return d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true }).toUpperCase();
}

function dayLabel(ts: any): string {
  const d = toDate(ts);
  if (!d) return "EARLIER";
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((start(new Date()) - start(d)) / 86400000);
  if (diffDays === 0) return "TODAY";
  if (diffDays === 1) return "YESTERDAY";
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" }).toUpperCase();
}

function matchesFilter(type: LedgerType, f: Filter): boolean {
  if (f === "all") return true;
  if (f === "pending") return type.endsWith("_earn_pending");
  if (f === "used") return type.endsWith("_redeem");
  // earned = credited coins + refunds of used coins
  return type.endsWith("_earn") || type.endsWith("_redeem_reversed");
}

type Meta = {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  iconColor: string;
  iconBg: string;
  amountColor: string;
  sign: "+" | "−" | "";
  strike?: boolean;
  sub: (coins: number) => string;
};

function ledgerMeta(type: LedgerType): Meta {
  const kind = type.replace(/^(pcoin|vcoin)_/, "");
  switch (kind) {
    case "earn":
      return { label: "Coins earned",    icon: "arrow-down",           iconColor: GREEN, iconBg: "#DCFCE7", amountColor: GREEN, sign: "+", sub: () => "Added" };
    case "earn_pending":
      return { label: "Coins pending",   icon: "time-outline",         iconColor: AMBER, iconBg: AMBER_BG,  amountColor: AMBER, sign: "+", sub: () => "Pending" };
    case "redeem":
      return { label: "Used on booking", icon: "arrow-up",             iconColor: RED,   iconBg: RED_BG,    amountColor: RED,   sign: "−", sub: (c) => `₹${fmtNum(c)} saved` };
    case "earn_reversed":
      return { label: "Pending removed", icon: "close-circle-outline", iconColor: MUTED, iconBg: "#F1F3F2", amountColor: MUTED, sign: "",  strike: true, sub: () => "Removed" };
    case "redeem_reversed":
      return { label: "Coins refunded",  icon: "arrow-undo-outline",   iconColor: GREEN, iconBg: "#DCFCE7", amountColor: GREEN, sign: "+", sub: () => "Returned" };
    default:
      return { label: "Transaction",     icon: "swap-horizontal",      iconColor: MUTED, iconBg: "#F1F3F2", amountColor: MUTED, sign: "",  sub: () => "" };
  }
}

// ── Small pieces (kept in this file) ─────────────────────────────────────────
function CoinTag({ type }: { type: LedgerType }) {
  const isP = type.startsWith("pcoin");
  return (
    <View style={[s.coinTag, { backgroundColor: isP ? MINT : BLUE_BG }]}>
      <Text style={[s.coinTagTxt, { color: isP ? CARD_GREEN : BLUE_INK }]}>{isP ? "PCoin" : "VCoin"}</Text>
    </View>
  );
}

// ── Main Screen ───────────────────────────────────────────────────────────────
export default function WalletScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showHelp,   setShowHelp]   = useState(false);

  // PCoin
  const [pcoinBalance,  setPcoinBalance]  = useState(0);
  const [pcoinEarned,   setPcoinEarned]   = useState(0);
  const [pcoinRedeemed, setPcoinRedeemed] = useState(0);
  const [pcoinPending,  setPcoinPending]  = useState(0);

  // VCoin per turf
  const [vcoins, setVcoins] = useState<VCoinEntry[]>([]);

  // Ledger
  const [ledger,  setLedger]  = useState<LedgerEntry[]>([]);
  const [filter,  setFilter]  = useState<Filter>("all");
  const [showAll, setShowAll] = useState(false);

  const uid = auth.currentUser?.uid;

  // ── Fetch ─────────────────────────────────────────────────────────────────
  const fetchAll = useCallback(async (isRefresh = false) => {
    if (!uid) { setLoading(false); return; }
    isRefresh ? setRefreshing(true) : setLoading(true);

    try {
      // 1. PCoin wallet
      try {
        const pcSnap = await getDoc(doc(db, "pcoinWallets", uid));
        if (pcSnap.exists()) {
          const d = pcSnap.data();
          setPcoinBalance( Number(d.balance        || 0));
          setPcoinEarned(  Number(d.totalEarned    || 0));
          setPcoinRedeemed(Number(d.totalRedeemed  || 0));
          setPcoinPending( Number(d.pendingBalance || 0));
        }
      } catch {}

      // 2. VCoin wallets — all wallets belonging to this user
      try {
        const vcSnap = await getDocs(
          query(collection(db, "vcoinWallets"), where("uid", "==", uid))
        );
        const entries: VCoinEntry[] = vcSnap.docs
          .map(d => ({ walletKey: d.id, ...d.data() } as VCoinEntry))
          .filter(e => e.balance > 0 || e.totalEarned > 0)   // only turfs with activity
          .sort((a, b) => b.balance - a.balance);             // highest balance first
        setVcoins(entries);
      } catch {}

      // 3. Combined ledger — latest entries from both
      // FIX: "uid ==" + "orderBy createdAt" needs a Firestore composite index.
      // Without it the query fails, and the old code hid the error, so
      // Transactions was always empty. Now each ledger loads on its own:
      // indexed query first, and if that fails, a plain "uid ==" query
      // sorted here on the phone. The warning in the log has a link that
      // creates the index in one click.
      const loadLedger = async (col: "pcoinLedger" | "vcoinLedger"): Promise<LedgerEntry[]> => {
        try {
          const snap = await getDocs(query(
            collection(db, col),
            where("uid", "==", uid),
            orderBy("createdAt", "desc"),
            limit(30),
          ));
          return snap.docs.map(d => ({ id: d.id, ...d.data() } as LedgerEntry));
        } catch (e: any) {
          console.warn(`[wallet] ${col} indexed query failed, using fallback:`, e?.message);
          try {
            const snap = await getDocs(query(collection(db, col), where("uid", "==", uid), limit(200)));
            return snap.docs.map(d => ({ id: d.id, ...d.data() } as LedgerEntry));
          } catch (e2: any) {
            console.warn(`[wallet] ${col} could not load:`, e2?.message);
            return [];
          }
        }
      };

      const [pcList, vcList] = await Promise.all([loadLedger("pcoinLedger"), loadLedger("vcoinLedger")]);
      const combined: LedgerEntry[] = [...pcList, ...vcList]
        .sort((a, b) => {
          const ta = toDate(a.createdAt)?.getTime() || 0;
          const tb = toDate(b.createdAt)?.getTime() || 0;
          return tb - ta;
        })
        .slice(0, 40);
      setLedger(combined);

    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [uid]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // ── Derived ───────────────────────────────────────────────────────────────
  const totalVcoin  = vcoins.reduce((sum, v) => sum + Number(v.balance || 0), 0);
  const coinBalance = pcoinBalance + totalVcoin;   // 1 coin = ₹1

  const filtered = useMemo(() => ledger.filter(e => matchesFilter(e.type, filter)), [ledger, filter]);
  const visible  = showAll ? filtered : filtered.slice(0, 8);

  // Group visible rows by day (TODAY / YESTERDAY / 12 OCT)
  const groups = useMemo(() => {
    const out: { label: string; items: LedgerEntry[] }[] = [];
    visible.forEach(e => {
      const label = dayLabel(e.createdAt);
      const last = out[out.length - 1];
      if (last && last.label === label) last.items.push(e);
      else out.push({ label, items: [e] });
    });
    return out;
  }, [visible]);

  const isBrandNew = coinBalance === 0 && pcoinPending === 0 && ledger.length === 0 && vcoins.length === 0;

  // ── Navigation ────────────────────────────────────────────────────────────
  const goExplore = () => router.push("/(tabs)/explore" as any);
  const goTurf    = (turfId: string) => router.push(`/turf/${turfId}` as any);

  // ── Render ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <SafeAreaView style={s.safe}>
        <StatusBar barStyle="light-content" backgroundColor={HEADER_GREEN} />
        <View style={s.loader}>
          <ActivityIndicator size="large" color={HEADER_GREEN} />
          <Text style={s.loaderTxt}>Loading your wallet…</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe} edges={["left", "right", "bottom"]}>
      <StatusBar barStyle="light-content" backgroundColor={HEADER_GREEN} />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 40 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => fetchAll(true)} tintColor={WHITE} colors={[HEADER_GREEN]} />
        }
      >
        {/* ══════════════ GREEN HEADER ══════════════ */}
        <View style={[s.header, { paddingTop: insets.top + 12 }]}>
          <View style={s.headerRow}>
            <TouchableOpacity
              onPress={() => router.back()}
              style={s.iconBtn}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Go back"
            >
              <Ionicons name="chevron-back" size={22} color={WHITE} />
            </TouchableOpacity>
            <Text style={s.headerTitle}>Wallet</Text>
            <TouchableOpacity
              onPress={() => setShowHelp(true)}
              style={[s.iconBtn, { borderRadius: 20 }]}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="How coins work and terms"
            >
              <Ionicons name="help-circle-outline" size={24} color={WHITE} />
            </TouchableOpacity>
          </View>

          {/* Coin balance (PlayOn + all Venue coins) */}
          <View style={s.balanceWrap}>
            <Text style={s.balanceLbl}>Coin balance</Text>
            <Text style={s.balanceVal}>{fmtNum(coinBalance)}</Text>
          </View>

          {/* Shine line — full width, edge to edge */}
          <LinearGradient
            colors={["rgba(255,255,255,0.4)", "rgba(255,255,255,0.8)", "rgba(255,255,255,0.4)"]}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={s.shine}
          />

          {/* ── PlayOn Coin card ── */}
          <View style={s.pCard}>
            <View style={s.pTopRow}>
              <Image source={PCOIN_IMG} style={s.pCoinImg} resizeMode="contain" />
              <View style={{ flex: 1 }}>
                <Text style={s.pName}>PlayOn Coin</Text>
                <Text style={s.pNameSub}>Use at any turf</Text>
              </View>
            </View>

            <View style={s.pBalRow}>
              <View style={{ flexDirection: "row", alignItems: "baseline", gap: 6 }}>
                <Text style={s.pBal}>{fmtNum(pcoinBalance)}</Text>
                <Text style={s.pBalUnit}>coins</Text>
              </View>
              <Text style={s.pWorth}>= ₹{fmtNum(pcoinBalance)} off</Text>
            </View>

            <View style={s.statsRow}>
              <View style={s.statItem}>
                <Text style={s.statVal}>{fmtNum(pcoinEarned)}</Text>
                <Text style={s.statLbl}>Earned</Text>
              </View>
              <View style={s.statItem}>
                <Text style={s.statVal}>{fmtNum(pcoinRedeemed)}</Text>
                <Text style={s.statLbl}>Used</Text>
              </View>
              <View style={s.statItem}>
                <Text style={[s.statVal, { color: GOLD }]}>{fmtNum(pcoinPending)}</Text>
                <Text style={s.statLbl}>Pending</Text>
              </View>
            </View>

            <TouchableOpacity style={s.whiteBtn} onPress={goExplore} activeOpacity={0.85} accessibilityRole="button">
              <Text style={s.whiteBtnTxt}>{isBrandNew ? "Find a turf near you" : "Book a turf & use coins"}</Text>
              <Ionicons name="arrow-forward" size={16} color={CARD_GREEN} />
            </TouchableOpacity>
          </View>
        </View>

        <View style={s.body}>
          {/* ══════════════ VENUE COINS ══════════════ */}
          <View style={s.sectionTitleRow}>
            <Text style={s.h2}>Venue Coins</Text>
            {vcoins.length > 0 && <Text style={s.sectionTotal}>{fmtNum(totalVcoin)} coins</Text>}
          </View>
          <View style={s.lockNote}>
            <Ionicons name="lock-closed-outline" size={13} color={MUTED} />
            <Text style={s.lockNoteTxt}>Use only at the turf where you earned them</Text>
          </View>

          {vcoins.length === 0 ? (
            <View style={s.emptyCard}>
              <Image source={VCOIN_IMG} style={{ width: 44, height: 44 }} resizeMode="contain" />
              <Text style={s.emptyTitle}>No venue coins yet</Text>
              <Text style={s.emptySub}>Book at a turf that gives Venue Coins and they'll show up here</Text>
            </View>
          ) : (
            <View style={s.listCard}>
              {vcoins.map((vc, i) => (
                // Tap a row → that turf's page, so the player can book and use the coins
                <TouchableOpacity
                  key={vc.walletKey}
                  style={[s.vRow, i < vcoins.length - 1 && s.rowDivider]}
                  onPress={() => vc.turfId && goTurf(vc.turfId)}
                  disabled={!vc.turfId}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel={`${vc.turfName || "Turf"}, ${fmtNum(vc.balance)} venue coins. Open turf`}
                >
                  <Image source={VCOIN_IMG} style={s.vCoinImg} resizeMode="contain" />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={s.vName} numberOfLines={1}>{vc.turfName || "Turf"}</Text>
                    <Text style={s.vMeta}>Venue Coin balance</Text>
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={s.vBal}>{fmtNum(vc.balance)}</Text>
                    <Text style={s.vWorth}>= ₹{fmtNum(vc.balance)}</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* ══════════════ TRANSACTIONS ══════════════ */}
          {!isBrandNew && (
            <>
              <View style={[s.sectionTitleRow, { marginTop: 26 }]}>
                <Text style={s.h2}>Transactions</Text>
                {filtered.length > 8 && (
                  <TouchableOpacity onPress={() => setShowAll(v => !v)} hitSlop={12} accessibilityRole="button">
                    <Text style={s.seeAll}>{showAll ? "Show less" : "See all"}</Text>
                  </TouchableOpacity>
                )}
              </View>

              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chipsRow}>
                {([
                  { k: "all",     l: "All" },
                  { k: "earned",  l: "Earned" },
                  { k: "used",    l: "Used" },
                  { k: "pending", l: "Pending" },
                ] as { k: Filter; l: string }[]).map(c => {
                  const on = filter === c.k;
                  return (
                    <TouchableOpacity
                      key={c.k}
                      onPress={() => { setFilter(c.k); setShowAll(false); }}
                      style={[s.chip, on && s.chipOn]}
                      activeOpacity={0.85}
                      accessibilityRole="button"
                      accessibilityState={{ selected: on }}
                    >
                      <Text style={[s.chipTxt, on && s.chipTxtOn]}>{c.l}</Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              {filtered.length === 0 ? (
                <View style={s.emptyCard}>
                  <Ionicons name="receipt-outline" size={32} color="#9CA3AF" />
                  <Text style={s.emptyTitle}>
                    {filter === "all" ? "No transactions yet" : `No ${filter} coins yet`}
                  </Text>
                  <Text style={s.emptySub}>Your coin history will appear here</Text>
                </View>
              ) : (
                <View style={s.listCard}>
                  {groups.map((g, gi) => (
                    <View key={g.label + gi}>
                      <Text style={s.groupLbl}>{g.label}</Text>
                      {g.items.map((entry, idx) => {
                        const meta = ledgerMeta(entry.type);
                        const lastInGroup = idx === g.items.length - 1;
                        const lastOverall = gi === groups.length - 1 && lastInGroup;
                        const time  = fmtTime(entry.createdAt);
                        const place = entry.turfName || "PlayOn";
                        const metaLine = entry.type.endsWith("_reversed")
                          ? `Booking cancelled · ${place}`
                          : `${place}${time ? ` · ${time}` : ""}`;
                        return (
                          <View key={entry.id} style={[s.txRow, !lastOverall && s.rowDivider]}>
                            <View style={[s.txIcon, { backgroundColor: meta.iconBg }]}>
                              <Ionicons name={meta.icon} size={17} color={meta.iconColor} />
                            </View>
                            <View style={{ flex: 1, minWidth: 0, marginLeft: 12 }}>
                              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                                <Text style={s.txTitle} numberOfLines={1}>{meta.label}</Text>
                                <CoinTag type={entry.type} />
                              </View>
                              <Text style={s.txMeta} numberOfLines={1}>{metaLine}</Text>
                            </View>
                            <View style={{ alignItems: "flex-end", marginLeft: 8 }}>
                              <Text style={[s.txAmt, { color: meta.amountColor }, meta.strike && { textDecorationLine: "line-through" }]}>
                                {meta.sign}{fmtNum(entry.coins)}
                              </Text>
                              <Text style={[s.txSub, entry.type.endsWith("_earn_pending") && { color: AMBER, fontWeight: "700" }]}>
                                {meta.sub(entry.coins)}
                              </Text>
                            </View>
                          </View>
                        );
                      })}
                    </View>
                  ))}
                </View>
              )}
            </>
          )}
        </View>
      </ScrollView>

      {/* ══════════════ HELP SHEET (? button) ══════════════ */}
      <Modal visible={showHelp} transparent animationType="slide" onRequestClose={() => setShowHelp(false)}>
        <Pressable style={s.sheetBackdrop} onPress={() => setShowHelp(false)} accessibilityLabel="Close help" />
        <View style={[s.sheet, { paddingBottom: insets.bottom + 20 }]}>
          <View style={s.sheetHandle} />

          <View style={s.sheetHead}>
            <Text style={s.sheetTitle}>How coins work</Text>
            <TouchableOpacity
              onPress={() => setShowHelp(false)}
              style={s.sheetClose}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <Ionicons name="close" size={18} color={INK} />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false}>
            {/* Two coins */}
            <View style={s.kindRow}>
              <View style={s.kindCard}>
                <Image source={PCOIN_IMG} style={s.kindImg} resizeMode="contain" />
                <Text style={s.kindTitle}>PlayOn Coin</Text>
                <Text style={s.kindSub}>Use at any turf on PlayOn</Text>
              </View>
              <View style={s.kindCard}>
                <Image source={VCOIN_IMG} style={s.kindImg} resizeMode="contain" />
                <Text style={s.kindTitle}>Venue Coin</Text>
                <Text style={s.kindSub}>Use only at the turf where you earned it</Text>
              </View>
            </View>

            {/* Steps */}
            <View style={{ marginTop: 18, gap: 12 }}>
              {[
                { n: "1", t: "Book a slot",   d: "Coins you earn show as pending", gold: false },
                { n: "2", t: "Play your game", d: "Your slot gets completed",       gold: false },
                { n: "3", t: "Coins added",   d: "Use them on your next booking",  gold: true  },
              ].map(st => (
                <View key={st.n} style={s.stepRow}>
                  <View style={[s.stepNum, st.gold && { backgroundColor: GOLD }]}>
                    <Text style={[s.stepNumTxt, st.gold && { color: "#5A3D00" }]}>{st.n}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.stepTitle}>{st.t}</Text>
                    <Text style={s.stepSub}>{st.d}</Text>
                  </View>
                </View>
              ))}
            </View>

            {/* Terms — edit these lines to match your rules */}
            <View style={s.termsBox}>
              <Text style={s.termsTitle}>Terms</Text>
              {[
                "1 coin = ₹1 off your booking",
                "If a booking is cancelled, its pending coins are removed",
                "Coins you used on a cancelled booking come back to your wallet",
                "Venue Coins work only at the turf that gave them",
                "Coins can't be withdrawn or exchanged for cash",
              ].map(t => (
                <View key={t} style={s.termRow}>
                  <Text style={s.termDot}>•</Text>
                  <Text style={s.termTxt}>{t}</Text>
                </View>
              ))}
            </View>
          </ScrollView>

          <TouchableOpacity style={s.gotItBtn} onPress={() => setShowHelp(false)} activeOpacity={0.85} accessibilityRole="button">
            <Text style={s.gotItTxt}>Got it</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  safe:      { flex: 1, backgroundColor: GROUND },
  loader:    { flex: 1, justifyContent: "center", alignItems: "center", gap: 12 },
  loaderTxt: { fontSize: 14, fontWeight: "600", color: MUTED },

  // Green header
  header: {
    backgroundColor: HEADER_GREEN, paddingHorizontal: 16, paddingBottom: 20,
    borderBottomLeftRadius: 24, borderBottomRightRadius: 24, gap: 16,
  },
  headerRow:   { flexDirection: "row", alignItems: "center", gap: 10 },
  iconBtn:     { width: 40, height: 40, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.12)", justifyContent: "center", alignItems: "center" },
  headerTitle: { flex: 1, color: WHITE, fontSize: 17, fontWeight: "800" },

  balanceWrap: { alignItems: "center", paddingTop: 4, paddingBottom: 8 },
  balanceLbl:  { fontSize: 13, fontWeight: "600", color: "#CDEBD9" },
  balanceVal:  { fontSize: 40, fontWeight: "800", color: WHITE, letterSpacing: -1, marginTop: 2 },

  shine: {
    height: 1, marginHorizontal: -16,
    shadowColor: WHITE, shadowOpacity: 0.3, shadowRadius: 5, shadowOffset: { width: 0, height: 0 },
  },

  // PlayOn Coin card
  pCard: {
    backgroundColor: CARD_GREEN, borderRadius: 20, padding: 16, gap: 14,
    shadowColor: "#000", shadowOpacity: 0.18, shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 }, elevation: 6,
  },
  pTopRow:  { flexDirection: "row", alignItems: "center", gap: 10 },
  pCoinImg: { width: 42, height: 42 },
  pName:    { fontSize: 15, fontWeight: "700", color: WHITE },
  pNameSub: { fontSize: 12, color: "#BFE3CF", marginTop: 1 },
  pBalRow:  { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" },
  pBal:     { fontSize: 30, fontWeight: "800", color: WHITE, letterSpacing: -0.6 },
  pBalUnit: { fontSize: 13, fontWeight: "600", color: "#BFE3CF" },
  pWorth:   { fontSize: 13, fontWeight: "700", color: GOLD },

  statsRow: { flexDirection: "row", borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.12)", paddingTop: 12 },
  statItem: { flex: 1 },
  statVal:  { fontSize: 15, fontWeight: "800", color: WHITE },
  statLbl:  { fontSize: 11, fontWeight: "600", color: "#A9D3BC", marginTop: 2 },

  whiteBtn:    { height: 44, borderRadius: 12, backgroundColor: WHITE, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  whiteBtnTxt: { fontSize: 14, fontWeight: "700", color: CARD_GREEN },

  // Body
  body: { paddingHorizontal: 16, paddingTop: 24 },

  sectionTitleRow: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", paddingHorizontal: 2 },
  h2:              { fontSize: 16, fontWeight: "800", color: INK },
  sectionTotal:    { fontSize: 13, fontWeight: "700", color: GREEN },
  lockNote:        { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4, marginBottom: 12, paddingHorizontal: 2 },
  lockNoteTxt:     { flex: 1, fontSize: 12, color: MUTED },

  listCard:   { backgroundColor: WHITE, borderRadius: 16, borderWidth: 1, borderColor: BORDER, paddingHorizontal: 14 },
  rowDivider: { borderBottomWidth: 1, borderBottomColor: DIVIDER },

  // Venue coin rows
  vRow:     { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12 },
  vCoinImg: { width: 40, height: 40 },
  vName:    { fontSize: 14, fontWeight: "700", color: INK },
  vMeta:    { fontSize: 12, color: MUTED, marginTop: 2 },
  vBal:     { fontSize: 17, fontWeight: "800", color: INK },
  vWorth:   { fontSize: 11, fontWeight: "600", color: GREEN, marginTop: 1 },

  // Transactions
  seeAll:    { fontSize: 13, fontWeight: "700", color: GREEN },
  chipsRow:  { gap: 6, paddingTop: 10, paddingBottom: 12 },
  chip:      { height: 32, paddingHorizontal: 14, borderRadius: 99, borderWidth: 1, borderColor: "#D5DCD7", backgroundColor: WHITE, justifyContent: "center" },
  chipOn:    { backgroundColor: INK, borderColor: INK },
  chipTxt:   { fontSize: 12, fontWeight: "600", color: INK },
  chipTxtOn: { color: WHITE, fontWeight: "700" },

  groupLbl:   { fontSize: 11, fontWeight: "700", letterSpacing: 0.6, color: MUTED, paddingTop: 12, paddingBottom: 2 },
  txRow:      { flexDirection: "row", alignItems: "center", paddingVertical: 10 },
  txIcon:     { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  txTitle:    { fontSize: 14, fontWeight: "700", color: INK, flexShrink: 1 },
  txMeta:     { fontSize: 12, color: MUTED, marginTop: 2 },
  txAmt:      { fontSize: 15, fontWeight: "800" },
  txSub:      { fontSize: 11, color: MUTED, marginTop: 1 },
  coinTag:    { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5 },
  coinTagTxt: { fontSize: 10, fontWeight: "800" },

  // Empty states
  emptyCard:  { backgroundColor: WHITE, borderRadius: 16, borderWidth: 1, borderColor: BORDER, padding: 22, alignItems: "center", gap: 4 },
  emptyTitle: { fontSize: 14, fontWeight: "800", color: INK, marginTop: 6 },
  emptySub:   { fontSize: 12, color: MUTED, textAlign: "center", lineHeight: 17 },

  // Help sheet
  sheetBackdrop: { flex: 1, backgroundColor: "rgba(11,18,32,0.55)" },
  sheet: {
    position: "absolute", left: 0, right: 0, bottom: 0, maxHeight: "88%",
    backgroundColor: WHITE, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 20, paddingTop: 10,
  },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: "#D5DCD7", alignSelf: "center" },
  sheetHead:   { flexDirection: "row", alignItems: "center", marginTop: 14, marginBottom: 16 },
  sheetTitle:  { flex: 1, fontSize: 18, fontWeight: "800", color: INK },
  sheetClose:  { width: 36, height: 36, borderRadius: 18, backgroundColor: GROUND, alignItems: "center", justifyContent: "center" },

  kindRow:   { flexDirection: "row", gap: 10 },
  kindCard:  { flex: 1, borderWidth: 1, borderColor: BORDER, borderRadius: 14, padding: 12, gap: 6 },
  kindImg:   { width: 34, height: 34 },
  kindTitle: { fontSize: 13, fontWeight: "800", color: INK },
  kindSub:   { fontSize: 12, color: MUTED, lineHeight: 16 },

  stepRow:    { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  stepNum:    { width: 24, height: 24, borderRadius: 8, backgroundColor: HEADER_GREEN, alignItems: "center", justifyContent: "center" },
  stepNumTxt: { fontSize: 12, fontWeight: "800", color: WHITE },
  stepTitle:  { fontSize: 13, fontWeight: "700", color: INK },
  stepSub:    { fontSize: 12, color: MUTED, marginTop: 2 },

  termsBox:   { marginTop: 18, backgroundColor: "#F7F9F7", borderRadius: 14, padding: 14 },
  termsTitle: { fontSize: 13, fontWeight: "800", color: INK, marginBottom: 6 },
  termRow:    { flexDirection: "row", gap: 6, marginTop: 4 },
  termDot:    { fontSize: 12, color: "#374151", lineHeight: 19 },
  termTxt:    { flex: 1, fontSize: 12, color: "#374151", lineHeight: 19 },

  gotItBtn: { marginTop: 18, height: 46, borderRadius: 12, backgroundColor: HEADER_GREEN, alignItems: "center", justifyContent: "center" },
  gotItTxt: { fontSize: 14, fontWeight: "700", color: WHITE },
});
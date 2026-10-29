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
import { useEffect, useState, useCallback, useMemo } from "react";
import { auth, db } from "../../firebaseConfig";
import {
  doc, getDoc,
  collection, query, where, getDocs, orderBy, limit,
} from "firebase/firestore";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

// ── Design tokens ──────────────────────────────────────────────────────────────
const INK        = "#0B1220";   // header + main text
const GROUND     = "#F2F4F1";   // screen background
const CARD_GREEN = "#0E3B27";   // PlayOn Coin card
const GREEN      = "#0E6B3F";   // positive amounts / links
const MINT       = "#DDF5E7";
const MINT_SOFT  = "#EAF4EE";
const GOLD       = "#F5C451";
const GOLD_DARK  = "#C99422";
const GOLD_INK   = "#7A5300";
const AMBER      = "#B45309";
const AMBER_BG   = "#FEF3C7";
const RED        = "#B91C1C";
const RED_BG     = "#FEE2E2";
const MUTED      = "#4B5563";   // secondary text (passes 4.5:1 on white)
const BORDER     = "#E1E7E2";
const DIVIDER    = "#EEF1EF";
const WHITE      = "#FFFFFF";
const BLUE_INK   = "#1E3A8A";
const BLUE_BG    = "#E4EEFB";

// Avatar colours cycled across venue cards
const AVATARS = [
  { bg: MINT,      fg: "#0E4D31" },
  { bg: BLUE_BG,   fg: BLUE_INK },
  { bg: "#FDEBDD", fg: "#9A3412" },
  { bg: "#EDE9FE", fg: "#5B21B6" },
];

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
  // Optional — if your ledger stores the slot date, the pending note shows it
  slotDate?:  any;
  date?:      any;
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

function fmtSlotDay(ts: any): string {
  const d = toDate(ts);
  if (!d) return "";
  return d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
}

function initials(name: string): string {
  const parts = (name || "T").trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || "T") + (parts[1]?.[0] || "")).toUpperCase();
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
      return { label: "Coins earned",    icon: "arrow-down",        iconColor: GREEN, iconBg: "#DCFCE7", amountColor: GREEN, sign: "+", sub: () => "Added" };
    case "earn_pending":
      return { label: "Coins pending",   icon: "time-outline",      iconColor: AMBER, iconBg: AMBER_BG,  amountColor: AMBER, sign: "+", sub: () => "Pending" };
    case "redeem":
      return { label: "Used on booking", icon: "arrow-up",          iconColor: RED,   iconBg: RED_BG,    amountColor: RED,   sign: "−", sub: (c) => `₹${fmtNum(c)} saved` };
    case "earn_reversed":
      return { label: "Pending removed", icon: "close-circle-outline", iconColor: MUTED, iconBg: "#F1F3F2", amountColor: MUTED, sign: "", strike: true, sub: () => "Removed" };
    case "redeem_reversed":
      return { label: "Coins refunded",  icon: "arrow-undo-outline", iconColor: GREEN, iconBg: "#DCFCE7", amountColor: GREEN, sign: "+", sub: () => "Returned" };
    default:
      return { label: "Transaction",     icon: "swap-horizontal",   iconColor: MUTED, iconBg: "#F1F3F2", amountColor: MUTED, sign: "",  sub: () => "" };
  }
}

// ── Small pieces (kept in this file) ─────────────────────────────────────────
function GoldCoin({ size = 46 }: { size?: number }) {
  const inner = size * 0.76;
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: GOLD, alignItems: "center", justifyContent: "center" }}>
      <View style={{ width: inner, height: inner, borderRadius: inner / 2, borderWidth: 2, borderColor: GOLD_DARK, alignItems: "center", justifyContent: "center" }}>
        <Text style={{ fontSize: size * 0.42, fontWeight: "900", color: GOLD_INK, marginTop: -1 }}>P</Text>
      </View>
    </View>
  );
}

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
          setPcoinBalance(Number(d.balance        || 0));
          setPcoinEarned( Number(d.totalEarned    || 0));
          setPcoinRedeemed(Number(d.totalRedeemed || 0));
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
          const ta = toDate(a.createdAt)?.getTime() || 0;
          const tb = toDate(b.createdAt)?.getTime() || 0;
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

  // ── Derived ───────────────────────────────────────────────────────────────
  const totalVcoin = vcoins.reduce((sum, v) => sum + Number(v.balance || 0), 0);
  const totalValue = pcoinBalance + totalVcoin;
  const totalCoins = totalValue; // 1 coin = ₹1

  // Soonest pending PCoin entry → used for the "+X coins on the way" date
  const pendingSlotDay = useMemo(() => {
    const p = ledger.find(e => e.type === "pcoin_earn_pending");
    return p ? fmtSlotDay(p.slotDate || p.date) : "";
  }, [ledger]);

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

  const isBrandNew = totalValue === 0 && pcoinPending === 0 && ledger.length === 0 && vcoins.length === 0;

  // ── Navigation ────────────────────────────────────────────────────────────
  const goExplore = () => router.push("/(tabs)/explore" as any);
  const goTurf    = (turfId: string) => router.push(`/turf/${turfId}` as any);

  // ── Render ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <SafeAreaView style={s.safe}>
        <StatusBar barStyle="light-content" backgroundColor={INK} />
        <View style={s.loader}>
          <ActivityIndicator size="large" color={CARD_GREEN} />
          <Text style={s.loaderTxt}>Loading your wallet…</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe} edges={["left", "right", "bottom"]}>
      <StatusBar barStyle="light-content" backgroundColor={INK} />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 40 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => fetchAll(true)} tintColor={WHITE} />
        }
      >
        {/* ══════════════ HEADER ══════════════ */}
        <View style={[s.header, { paddingTop: insets.top + 12 }]}>
          <View style={s.headerRow}>
            <TouchableOpacity
              onPress={() => router.back()}
              style={s.iconBtn}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Go back"
            >
              <Ionicons name="chevron-back" size={24} color={WHITE} />
            </TouchableOpacity>
            <Text style={s.headerTitle}>My Wallet</Text>
          </View>

          <Text style={s.totalLbl}>TOTAL WALLET VALUE</Text>
          <Text style={s.totalVal}>₹{fmtNum(totalValue)}</Text>
          {isBrandNew ? (
            <Text style={s.totalSub}>Book your first slot to start earning</Text>
          ) : (
            <Text style={s.totalSub}>
              {fmtNum(totalCoins)} coins  ·  <Text style={s.totalSubGold}>1 coin = ₹1 off</Text>
            </Text>
          )}
        </View>

        <View style={s.body}>
          {isBrandNew ? (
            /* ══════════════ EMPTY STATE ══════════════ */
            <>
              <View style={[s.pCard, { alignItems: "center" }]}>
                <GoldCoin size={84} />
                <Text style={s.emptyHeroTitle}>Earn coins every time you play</Text>
                <Text style={s.emptyHeroSub}>
                  Every booking gives you coins. <Text style={{ color: GOLD, fontWeight: "900" }}>1 coin = ₹1 off</Text> your next game.
                </Text>
                <TouchableOpacity style={[s.whiteBtn, { alignSelf: "stretch" }]} onPress={goExplore} activeOpacity={0.85} accessibilityRole="button">
                  <Text style={s.whiteBtnTxt}>Find a turf near you</Text>
                  <Ionicons name="arrow-forward" size={20} color={CARD_GREEN} />
                </TouchableOpacity>
              </View>

              <Text style={[s.h2, { marginTop: 28, marginBottom: 12 }]}>Two kinds of coins</Text>
              <View style={s.kindCard}>
                <View style={[s.kindIcon, { backgroundColor: MINT }]}>
                  <Ionicons name="globe-outline" size={24} color="#0E4D31" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.kindTitle}>PlayOn Coin</Text>
                  <Text style={s.kindSub}>Use at any turf on PlayOn</Text>
                </View>
              </View>
              <View style={s.kindCard}>
                <View style={[s.kindIcon, { backgroundColor: BLUE_BG }]}>
                  <Ionicons name="lock-closed-outline" size={22} color={BLUE_INK} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.kindTitle}>Venue Coin</Text>
                  <Text style={s.kindSub}>Use only at the turf where you earned it</Text>
                </View>
              </View>
            </>
          ) : (
            <>
              {/* ══════════════ PLAYON COIN CARD ══════════════ */}
              <View style={s.pCard}>
                {/* decorative rings */}
                <View pointerEvents="none" style={[s.ring, { width: 216, height: 216, right: -70, top: -70 }]} />
                <View pointerEvents="none" style={[s.ring, { width: 160, height: 160, right: -42, top: -42 }]} />
                <View pointerEvents="none" style={[s.ring, { width: 104, height: 104, right: -14, top: -14, borderColor: "rgba(245,196,81,0.2)" }]} />

                <View style={s.pTopRow}>
                  <GoldCoin />
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={s.pName}>PlayOn Coin</Text>
                    <Text style={s.pNameSub}>Use at every turf on PlayOn</Text>
                  </View>
                  <View style={s.anyTurfPill}>
                    <Text style={s.anyTurfTxt}>ANY TURF</Text>
                  </View>
                </View>

                <View style={s.pBalRow}>
                  <Text style={s.pBal}>{fmtNum(pcoinBalance)}</Text>
                  <Text style={s.pBalUnit}>coins</Text>
                </View>
                <Text style={s.pWorth}>Worth ₹{fmtNum(pcoinBalance)} off your bookings</Text>

                {pcoinPending > 0 && (
                  <View style={s.pendingBox}>
                    <Ionicons name="time-outline" size={22} color={GOLD} style={{ marginTop: 1 }} />
                    <View style={{ flex: 1 }}>
                      <Text style={s.pendingTitle}>+{fmtNum(pcoinPending)} coins on the way</Text>
                      <Text style={s.pendingSub}>
                        Added to your balance after you play your slot{pendingSlotDay ? ` on ${pendingSlotDay}` : ""}
                      </Text>
                    </View>
                  </View>
                )}

                <View style={s.statsRow}>
                  <View style={s.statItem}>
                    <Text style={s.statVal}>{fmtNum(pcoinEarned)}</Text>
                    <Text style={s.statLbl}>EARNED</Text>
                  </View>
                  <View style={[s.statItem, s.statMid]}>
                    <Text style={s.statVal}>{fmtNum(pcoinRedeemed)}</Text>
                    <Text style={s.statLbl}>USED</Text>
                  </View>
                  <View style={s.statItem}>
                    <Text style={[s.statVal, { color: GOLD }]}>{fmtNum(pcoinPending)}</Text>
                    <Text style={s.statLbl}>PENDING</Text>
                  </View>
                </View>

                <TouchableOpacity style={s.whiteBtn} onPress={goExplore} activeOpacity={0.85} accessibilityRole="button">
                  <Text style={s.whiteBtnTxt}>Book a turf & use coins</Text>
                  <Ionicons name="arrow-forward" size={20} color={CARD_GREEN} />
                </TouchableOpacity>
              </View>

              {/* ══════════════ VENUE COINS ══════════════ */}
              <View style={s.sectionHead}>
                <View style={s.sectionTitleRow}>
                  <Text style={s.h2}>Venue Coins</Text>
                  {vcoins.length > 0 && <Text style={s.sectionTotal}>{fmtNum(totalVcoin)} coins</Text>}
                </View>
                <View style={s.lockNote}>
                  <Ionicons name="lock-closed-outline" size={16} color={MUTED} />
                  <Text style={s.lockNoteTxt}>Only usable at the turf where you earned them</Text>
                </View>
              </View>

              {vcoins.length === 0 ? (
                <View style={s.emptyCard}>
                  <View style={[s.kindIcon, { backgroundColor: BLUE_BG }]}>
                    <Ionicons name="football-outline" size={24} color={BLUE_INK} />
                  </View>
                  <Text style={s.emptyTitle}>No venue coins yet</Text>
                  <Text style={s.emptySub}>Book at a turf that gives Venue Coins and they'll show up here</Text>
                </View>
              ) : (
                vcoins.map((vc, i) => {
                  const av = AVATARS[i % AVATARS.length];
                  const primary = i === 0 && vc.balance > 0;
                  return (
                    <View key={vc.walletKey} style={s.vCard}>
                      <View style={s.vTopRow}>
                        <View style={[s.avatar, { backgroundColor: av.bg }]}>
                          <Text style={[s.avatarTxt, { color: av.fg }]}>{initials(vc.turfName)}</Text>
                        </View>
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={s.vName} numberOfLines={1}>{vc.turfName || "Turf"}</Text>
                          <Text style={s.vMeta}>
                            Earned {fmtNum(vc.totalEarned)}  ·  Used {fmtNum(vc.totalRedeemed)}
                          </Text>
                        </View>
                        <View style={{ alignItems: "flex-end" }}>
                          <Text style={s.vBal}>{fmtNum(vc.balance)}</Text>
                          <Text style={s.vWorth}>= ₹{fmtNum(vc.balance)}</Text>
                        </View>
                      </View>

                      <TouchableOpacity
                        style={[s.vBtn, primary ? { backgroundColor: CARD_GREEN } : { backgroundColor: MINT_SOFT }]}
                        onPress={() => vc.turfId && goTurf(vc.turfId)}
                        activeOpacity={0.85}
                        accessibilityRole="button"
                      >
                        <Text style={[s.vBtnTxt, { color: primary ? WHITE : CARD_GREEN }]}>
                          {vc.balance > 0 ? `Book here & use ${fmtNum(vc.balance)} coins` : "Book here again"}
                        </Text>
                        <Ionicons name="arrow-forward" size={18} color={primary ? WHITE : CARD_GREEN} />
                      </TouchableOpacity>
                    </View>
                  );
                })
              )}
            </>
          )}

          {/* ══════════════ HOW COINS WORK ══════════════ */}
          <View style={[s.howCard, { marginTop: 28 }]}>
            <Text style={s.howTitle}>How coins work</Text>
            <View style={s.stepsRow}>
              {[
                { n: "1", t: "Book a slot", d: "Coins show as pending", gold: false },
                { n: "2", t: "Play",        d: "Your slot gets completed", gold: false },
                { n: "3", t: "Coins added", d: "Use them on your next booking", gold: true },
              ].map(st => (
                <View key={st.n} style={s.step}>
                  <View style={[s.stepNum, st.gold && { backgroundColor: GOLD }]}>
                    <Text style={[s.stepNumTxt, st.gold && { color: "#5A3D00" }]}>{st.n}</Text>
                  </View>
                  <Text style={s.stepTitle}>{st.t}</Text>
                  <Text style={s.stepSub}>{st.d}</Text>
                </View>
              ))}
            </View>
            <View style={s.howDivider} />
            <View style={s.ruleRow}>
              <Ionicons name="close-circle-outline" size={22} color={RED} />
              <Text style={s.ruleTxt}>
                <Text style={s.ruleStrong}>Booking cancelled? </Text>Pending coins are removed.
              </Text>
            </View>
            <View style={s.ruleRow}>
              <Ionicons name="arrow-undo-outline" size={22} color={GREEN} />
              <Text style={s.ruleTxt}>
                <Text style={s.ruleStrong}>Used coins on it? </Text>They come back to your wallet.
              </Text>
            </View>
          </View>

          {/* ══════════════ TRANSACTIONS ══════════════ */}
          {!isBrandNew && (
            <>
              <View style={[s.sectionTitleRow, { marginTop: 28, marginBottom: 12, paddingHorizontal: 4 }]}>
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
                  <Ionicons name="receipt-outline" size={36} color="#9CA3AF" />
                  <Text style={s.emptyTitle}>
                    {filter === "all" ? "No transactions yet" : `No ${filter} coins yet`}
                  </Text>
                  <Text style={s.emptySub}>Your coin history will appear here</Text>
                </View>
              ) : (
                <View style={s.ledgerCard}>
                  {groups.map((g, gi) => (
                    <View key={g.label + gi}>
                      <Text style={[s.groupLbl, gi === 0 && { paddingTop: 14 }]}>{g.label}</Text>
                      {g.items.map((entry, idx) => {
                        const meta = ledgerMeta(entry.type);
                        const lastInGroup = idx === g.items.length - 1;
                        const lastOverall = gi === groups.length - 1 && lastInGroup;
                        const time = fmtTime(entry.createdAt);
                        const place = entry.turfName || "PlayOn";
                        const metaLine = entry.type.endsWith("_reversed")
                          ? `Booking cancelled · ${place}`
                          : `${place}${time ? ` · ${time}` : ""}`;
                        return (
                          <View key={entry.id} style={[s.txRow, !lastOverall && s.txDivider]}>
                            <View style={[s.txIcon, { backgroundColor: meta.iconBg }]}>
                              <Ionicons name={meta.icon} size={22} color={meta.iconColor} />
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
                              <Text style={[s.txSub, entry.type.endsWith("_earn_pending") && { color: AMBER, fontWeight: "800" }]}>
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
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  safe:      { flex: 1, backgroundColor: GROUND },
  loader:    { flex: 1, justifyContent: "center", alignItems: "center", gap: 12 },
  loaderTxt: { fontSize: 15, fontWeight: "700", color: MUTED },

  // Header
  header:      { backgroundColor: INK, paddingHorizontal: 20, paddingBottom: 84 },
  headerRow:   { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 22 },
  iconBtn:     { width: 44, height: 44, borderRadius: 14, backgroundColor: "rgba(255,255,255,0.08)", justifyContent: "center", alignItems: "center" },
  headerTitle: { flex: 1, color: WHITE, fontSize: 24, fontWeight: "900", letterSpacing: -0.2 },
  totalLbl:    { fontSize: 13, fontWeight: "800", letterSpacing: 1.3, color: "#A9B6C4" },
  totalVal:    { fontSize: 48, fontWeight: "900", color: WHITE, letterSpacing: -1, marginTop: 6 },
  totalSub:    { fontSize: 15, fontWeight: "600", color: "#C9D3DD", marginTop: 6 },
  totalSubGold:{ color: GOLD, fontWeight: "900" },

  body: { paddingHorizontal: 16, marginTop: -64 },

  // PlayOn Coin card
  pCard: {
    backgroundColor: CARD_GREEN, borderRadius: 26, padding: 20, paddingTop: 22, overflow: "hidden",
    shadowColor: "#0B3D26", shadowOpacity: 0.3, shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 }, elevation: 8,
  },
  ring:       { position: "absolute", borderRadius: 999, borderWidth: 2, borderColor: "rgba(255,255,255,0.07)" },
  pTopRow:    { flexDirection: "row", alignItems: "center" },
  pName:      { fontSize: 19, fontWeight: "900", color: WHITE },
  pNameSub:   { fontSize: 14, fontWeight: "600", color: "#BFE3CF", marginTop: 2 },
  anyTurfPill:{ backgroundColor: "#BFF0D3", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 99 },
  anyTurfTxt: { fontSize: 12, fontWeight: "900", letterSpacing: 0.7, color: CARD_GREEN },
  pBalRow:    { flexDirection: "row", alignItems: "baseline", gap: 8, marginTop: 18 },
  pBal:       { fontSize: 56, fontWeight: "900", color: WHITE, letterSpacing: -1.5 },
  pBalUnit:   { fontSize: 19, fontWeight: "800", color: "#BFE3CF" },
  pWorth:     { fontSize: 16, fontWeight: "800", color: GOLD, marginTop: 2 },

  pendingBox: {
    flexDirection: "row", gap: 12, alignItems: "flex-start", marginTop: 18,
    backgroundColor: "rgba(245,196,81,0.13)", borderWidth: 1, borderColor: "rgba(245,196,81,0.42)",
    borderRadius: 16, padding: 14,
  },
  pendingTitle: { fontSize: 16, fontWeight: "900", color: GOLD },
  pendingSub:   { fontSize: 14, fontWeight: "600", color: "#F2E6C4", lineHeight: 20, marginTop: 3 },

  statsRow: { flexDirection: "row", backgroundColor: "rgba(0,0,0,0.22)", borderRadius: 16, paddingVertical: 14, marginTop: 18 },
  statItem: { flex: 1, alignItems: "center" },
  statMid:  { borderLeftWidth: 1, borderRightWidth: 1, borderColor: "rgba(255,255,255,0.14)" },
  statVal:  { fontSize: 21, fontWeight: "900", color: WHITE },
  statLbl:  { fontSize: 12, fontWeight: "800", letterSpacing: 0.7, color: "#A9D3BC", marginTop: 4 },

  whiteBtn:    { height: 54, borderRadius: 16, backgroundColor: WHITE, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 18 },
  whiteBtnTxt: { fontSize: 17, fontWeight: "900", color: CARD_GREEN },

  // Sections
  sectionHead:     { marginTop: 32, marginBottom: 14, paddingHorizontal: 4 },
  sectionTitleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  h2:              { fontSize: 24, fontWeight: "900", color: INK, letterSpacing: -0.2 },
  sectionTotal:    { fontSize: 17, fontWeight: "900", color: GREEN },
  lockNote:        { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 },
  lockNoteTxt:     { flex: 1, fontSize: 15, fontWeight: "700", color: MUTED },

  // Venue cards
  vCard:     { backgroundColor: WHITE, borderRadius: 22, borderWidth: 1, borderColor: BORDER, padding: 16, marginBottom: 12 },
  vTopRow:   { flexDirection: "row", alignItems: "center", gap: 14 },
  avatar:    { width: 52, height: 52, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  avatarTxt: { fontSize: 18, fontWeight: "900" },
  vName:     { fontSize: 18, fontWeight: "900", color: INK },
  vMeta:     { fontSize: 14, fontWeight: "600", color: MUTED, marginTop: 3 },
  vBal:      { fontSize: 28, fontWeight: "900", color: INK },
  vWorth:    { fontSize: 13, fontWeight: "800", color: GREEN, marginTop: 1 },
  vBtn:      { height: 48, borderRadius: 14, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 14 },
  vBtnTxt:   { fontSize: 16, fontWeight: "900" },

  // How coins work
  howCard:    { backgroundColor: WHITE, borderRadius: 22, borderWidth: 1, borderColor: BORDER, paddingVertical: 20, paddingHorizontal: 18 },
  howTitle:   { fontSize: 22, fontWeight: "900", color: INK, marginBottom: 18 },
  stepsRow:   { flexDirection: "row", gap: 10 },
  step:       { flex: 1 },
  stepNum:    { width: 36, height: 36, borderRadius: 12, backgroundColor: CARD_GREEN, alignItems: "center", justifyContent: "center", marginBottom: 8 },
  stepNumTxt: { fontSize: 17, fontWeight: "900", color: WHITE },
  stepTitle:  { fontSize: 16, fontWeight: "900", color: INK },
  stepSub:    { fontSize: 13, fontWeight: "600", color: MUTED, lineHeight: 18, marginTop: 4 },
  howDivider: { height: 1, backgroundColor: "#EBEFEC", marginVertical: 18 },
  ruleRow:    { flexDirection: "row", gap: 12, alignItems: "flex-start", marginBottom: 12 },
  ruleTxt:    { flex: 1, fontSize: 15, fontWeight: "600", color: "#374151", lineHeight: 22 },
  ruleStrong: { fontWeight: "900", color: INK },

  // Transactions
  seeAll:    { fontSize: 15, fontWeight: "900", color: GREEN },
  chipsRow:  { gap: 8, paddingBottom: 14 },
  chip:      { height: 44, paddingHorizontal: 18, borderRadius: 99, borderWidth: 1, borderColor: "#D5DCD7", backgroundColor: WHITE, justifyContent: "center" },
  chipOn:    { backgroundColor: INK, borderColor: INK },
  chipTxt:   { fontSize: 15, fontWeight: "800", color: INK },
  chipTxtOn: { color: WHITE },

  ledgerCard: { backgroundColor: WHITE, borderRadius: 22, borderWidth: 1, borderColor: BORDER, paddingHorizontal: 16, paddingBottom: 4 },
  groupLbl:   { fontSize: 13, fontWeight: "900", letterSpacing: 1, color: MUTED, paddingTop: 16, paddingBottom: 4 },
  txRow:      { flexDirection: "row", alignItems: "center", paddingVertical: 12 },
  txDivider:  { borderBottomWidth: 1, borderBottomColor: DIVIDER },
  txIcon:     { width: 46, height: 46, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  txTitle:    { fontSize: 16, fontWeight: "900", color: INK, flexShrink: 1 },
  txMeta:     { fontSize: 14, fontWeight: "600", color: MUTED, marginTop: 3 },
  txAmt:      { fontSize: 19, fontWeight: "900" },
  txSub:      { fontSize: 12, fontWeight: "700", color: MUTED, marginTop: 2 },
  coinTag:    { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6 },
  coinTagTxt: { fontSize: 11, fontWeight: "900" },

  // Empty states
  emptyCard:      { backgroundColor: WHITE, borderRadius: 22, borderWidth: 1, borderColor: BORDER, padding: 28, alignItems: "center", gap: 6 },
  emptyTitle:     { fontSize: 17, fontWeight: "900", color: INK, marginTop: 6 },
  emptySub:       { fontSize: 14, fontWeight: "600", color: MUTED, textAlign: "center", lineHeight: 20 },
  emptyHeroTitle: { fontSize: 26, fontWeight: "900", color: WHITE, textAlign: "center", marginTop: 16, letterSpacing: -0.3 },
  emptyHeroSub:   { fontSize: 16, fontWeight: "600", color: "#CDE9D9", textAlign: "center", lineHeight: 23, marginTop: 8 },
  kindCard:       { backgroundColor: WHITE, borderRadius: 20, borderWidth: 1, borderColor: BORDER, padding: 16, flexDirection: "row", alignItems: "center", gap: 14, marginBottom: 12 },
  kindIcon:       { width: 48, height: 48, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  kindTitle:      { fontSize: 17, fontWeight: "900", color: INK },
  kindSub:        { fontSize: 14, fontWeight: "600", color: MUTED, marginTop: 3 },
});
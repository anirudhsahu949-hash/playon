// app/(owner)/owner-guide.tsx
// ─────────────────────────────────────────────────────────────────────────────
// OWNER GUIDE — "How PlayOn Works" handbook for turf owners
// Short, scannable, diagram-first. No Firestore reads.
// Follows the same dark/light theme (AsyncStorage "owner_theme") as owner home.
//
// Route: /(owner)/owner-guide
// ─────────────────────────────────────────────────────────────────────────────

import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  StatusBar,
  Platform,
  LayoutAnimation,
  UIManager,
  Linking,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useEffect, useState, Fragment } from "react";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";

if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// ── Theme ─────────────────────────────────────────────────────────────────────
type Theme = {
  bg: string; card: string; card2: string; border: string;
  text: string; textSub: string; textMuted: string;
  green: string; greenBg: string;
};

const DARK_THEME: Theme = {
  bg: "#0D1117", card: "#161B22", card2: "#1C2333",
  border: "rgba(255,255,255,0.06)",
  text: "#F0F6FC", textSub: "#8B949E", textMuted: "#c3c7cc",
  green: "#3FB950", greenBg: "rgba(63,185,80,0.15)",
};

const LIGHT_THEME: Theme = {
  bg: "#F0F4F8", card: "#FFFFFF", card2: "#F8FAFC",
  border: "#E5E7EB",
  text: "#0F172A", textSub: "#64748B", textMuted: "#94A3B8",
  green: "#16A34A", greenBg: "#DCFCE7",
};

// WhatsApp deep link — same owner support line used in owner-support.tsx
const OWNER_WHATSAPP_URL =
  "https://wa.me/918055955805?text=Hi%20Playon%2C%20I%20have%20an%20empty%20slot%20I%27d%20like%20to%20offer%20a%20discount%20on";

// ── Small diagram building block: icon → icon → icon ────────────────────────
type FlowStep = { icon: string; label: string };

function FlowDiagram({ steps, color, bg, t }: { steps: FlowStep[]; color: string; bg: string; t: Theme }) {
  return (
    <View style={f.row}>
      {steps.map((st, i) => (
        <Fragment key={i}>
          <View style={f.step}>
            <View style={[f.circle, { backgroundColor: bg }]}>
              <Ionicons name={st.icon as any} size={17} color={color} />
            </View>
            <Text style={[f.label, { color: t.textSub }]} numberOfLines={2}>{st.label}</Text>
          </View>
          {i < steps.length - 1 && (
            <Ionicons name="chevron-forward" size={14} color={t.textMuted} style={{ marginTop: 16 }} />
          )}
        </Fragment>
      ))}
    </View>
  );
}

function FlowCaption({ text, t }: { text: string; t: Theme }) {
  return <Text style={[f.caption, { color: t.textMuted }]}>{text}</Text>;
}

function FlowLabel({ text, color }: { text: string; color: string }) {
  return <Text style={[f.flowLabel, { color }]}>{text}</Text>;
}

// ── PCoin vs VCoin compare cards ─────────────────────────────────────────────
function CoinCompare({ t }: { t: Theme }) {
  const rows = [
    {
      title: "PCoin", icon: "planet-outline", color: "#58A6FF", bg: "rgba(88,166,255,0.15)",
      lines: ["Works at any turf", "Platform sets rate", "Platform pays discount"],
    },
    {
      title: "VCoin", icon: "storefront-outline", color: "#F9C74F", bg: "rgba(249,199,79,0.15)",
      lines: ["Only your turf", "You set the rate", "You pay discount"],
    },
  ];
  return (
    <View style={cc.row}>
      {rows.map((r) => (
        <View key={r.title} style={[cc.card, { backgroundColor: t.card2, borderColor: t.border }]}>
          <View style={[cc.icon, { backgroundColor: r.bg }]}>
            <Ionicons name={r.icon as any} size={17} color={r.color} />
          </View>
          <Text style={[cc.title, { color: t.text }]}>{r.title}</Text>
          {r.lines.map((l) => (
            <View key={l} style={cc.lineRow}>
              <View style={[cc.dot, { backgroundColor: r.color }]} />
              <Text style={[cc.lineText, { color: t.textSub }]}>{l}</Text>
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

// ── Notification event rows ──────────────────────────────────────────────────
type NotifyEvent = { icon: string; event: string; to: "owner" | "customer"; note: string };

function NotifyRow({ ev, color, t }: { ev: NotifyEvent; color: string; t: Theme }) {
  const badgeColor = ev.to === "owner" ? "#3FB950" : "#58A6FF";
  const badgeBg    = ev.to === "owner" ? "rgba(63,185,80,0.15)" : "rgba(88,166,255,0.15)";
  const badgeLabel = ev.to === "owner" ? "You" : "Customer";
  return (
    <View style={nf.row}>
      <View style={[nf.icon, { backgroundColor: color + "22" }]}>
        <Ionicons name={ev.icon as any} size={15} color={color} />
      </View>
      <View style={{ flex: 1 }}>
        <View style={nf.titleRow}>
          <Text style={[nf.title, { color: t.text }]}>{ev.event}</Text>
          <View style={[nf.badge, { backgroundColor: badgeBg }]}>
            <Text style={[nf.badgeText, { color: badgeColor }]}>→ {badgeLabel}</Text>
          </View>
        </View>
        <Text style={[nf.note, { color: t.textSub }]}>{ev.note}</Text>
      </View>
    </View>
  );
}

const NOTIFY_EVENTS: NotifyEvent[] = [
  { icon: "calendar-outline", event: "New booking placed", to: "owner", note: "You get a push the moment a customer books." },
  { icon: "close-circle-outline", event: "Customer cancels", to: "owner", note: "You're notified instantly; their refund starts automatically." },
  { icon: "close-circle-outline", event: "You cancel a booking", to: "customer", note: "They get the reason and refund status right away." },
  { icon: "swap-horizontal-outline", event: "You reschedule a booking", to: "customer", note: "They see the new date and time automatically." },
  { icon: "alarm-outline", event: "Reminder — 1 day before", to: "customer", note: "A nudge is sent so fewer people forget to show up." },
  { icon: "disc-outline", event: "Reward coins credited", to: "customer", note: "Sent once their slot ends and coins move from pending." },
  { icon: "wallet-outline", event: "Settlement paid", to: "owner", note: "You're notified the moment a payout hits your bank." },
];

// ── Guide content ────────────────────────────────────────────────────────────
type Section = {
  id: string;
  icon: string;
  color: string;
  bg: string;
  title: string;
  subtitle: string;
  intro?: string;
  bullets: string[];
  tip?: string;
  route?: string;
  routeLabel?: string;
};

const SECTIONS: Section[] = [
  {
    id: "dashboard",
    icon: "home-outline",
    color: "#58A6FF",
    bg: "rgba(88,166,255,0.15)",
    title: "Dashboard",
    subtitle: "What the home screen shows",
    bullets: [
      "TODAY / UPCOMING — bookings count",
      "PAID / COLLECT — money in hand vs pending",
      "Slot dots: green = free, red = booked, blue = blocked",
      "Pull down to refresh anytime",
    ],
  },
  {
    id: "bookings",
    icon: "calendar-outline",
    color: "#58A6FF",
    bg: "rgba(88,166,255,0.15)",
    title: "Bookings",
    subtitle: "Cancel & reschedule",
    intro: "Tap any booking to open its receipt.",
    bullets: [
      "Advance paid online? Collect the remaining amount at the venue.",
    ],
    tip: "Cancel only when needed — it refunds the customer automatically.",
    route: "/(owner)/bookings",
    routeLabel: "Open Bookings",
  },
  {
    id: "blockslots",
    icon: "lock-closed-outline",
    color: "#F85149",
    bg: "rgba(248,81,73,0.15)",
    title: "Block Slots",
    subtitle: "Walk-ins, bulk blocks & closures",
    intro: "Use this for walk-in customers or to close slots for maintenance.",
    bullets: [
      "Tap several slots together = one bulk booking, e.g. a full evening or a tournament",
      "Tap a blocked/walk-in slot again to free it instantly",
    ],
    tip: "No auto-repeat yet — for a weekly regular customer, repeat the same block or walk-in entry each week.",
    route: "/(owner)/block-slots",
    routeLabel: "Open Block Slots",
  },
  {
    id: "coins",
    icon: "server-outline",
    color: "#F9C74F",
    bg: "rgba(249,199,79,0.15)",
    title: "PCoin & VCoin",
    subtitle: "Reward coins, side by side",
    bullets: [
      "Change your VCoin rate: My Turfs → your turf → VCoin settings",
      "Coins stay pending until the slot ends, reversed if cancelled",
    ],
    tip: "A steady rate (5–10 coins/hr) builds more trust than switching it on and off.",
  },
  {
    id: "promo",
    icon: "pricetag-outline",
    color: "#F97316",
    bg: "rgba(249,115,22,0.15)",
    title: "Promo Codes & Special Offers",
    subtitle: "Filling empty slots with a discount",
    intro: "Promo codes are created by the PlayOn team, not from your dashboard — but you can request one anytime.",
    bullets: [
      "New customers are often given a first-booking discount (e.g. ₹50 or ₹100 off) to get them to try your turf",
      "Codes are checked automatically at checkout — you never have to verify or approve one",
    ],
    tip: "Have an empty slot tonight? WhatsApp us the turf, date, time and discount you want — we'll create the code and notify nearby users.",
  },
  {
    id: "notifications",
    icon: "notifications-outline",
    color: "#BC8CFF",
    bg: "rgba(188,140,255,0.15)",
    title: "Notifications",
    subtitle: "Who gets told, and when",
    intro: "Every key event sends a push automatically — nobody needs a phone call.",
    bullets: [],
    tip: "Every push is also saved in your Notification Center (bell icon) so you can scroll back anytime.",
  },
  {
    id: "money",
    icon: "wallet-outline",
    color: "#3FB950",
    bg: "rgba(63,185,80,0.15)",
    title: "Transactions & Settlement",
    subtitle: "How your money reaches you",
    bullets: [
      "Online payments settle to your bank, minus platform fee",
      "Offline cash/UPI is yours directly — still shown in your records",
      "Cancelled bookings: auto-refunded and removed from settlement",
      "Keep your bank details verified for payouts",
    ],
    tip: "Settlement looks off? Open that booking's receipt — it shows the full breakdown.",
    route: "/(owner)/settlementscreen",
    routeLabel: "Open Transactions",
  },
  {
    id: "turfs",
    icon: "football-outline",
    color: "#FF69B4",
    bg: "rgba(255,105,180,0.15)",
    title: "My Turfs",
    subtitle: "Hours, pricing & photos",
    bullets: [
      "Opening hours & slot duration control every booking screen",
      "Keep photos, pricing & description updated",
    ],
    route: "/(owner)/MyTurfs",
    routeLabel: "Open My Turfs",
  },
  {
    id: "help",
    icon: "headset-outline",
    color: "#FFA500",
    bg: "rgba(255,165,0,0.15)",
    title: "Need Help?",
    subtitle: "Support is one tap away",
    bullets: [
      "FAQs cover settlements, bookings & turf management",
      "For anything else, contact us with your turf name & booking ID",
    ],
    route: "/support/owner-support",
    routeLabel: "Open Support",
  },
];

const QUICK_START = [
  "Set opening hours & slot duration",
  "Add photos & pricing",
  "Turn on VCoin for repeat customers",
  "Log every walk-in",
];

// ─────────────────────────────────────────────────────────────────────────────
export default function OwnerGuide() {
  const router = useRouter();
  const [isDark, setIsDark] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    AsyncStorage.getItem("owner_theme").then((val) => {
      if (val === "dark") setIsDark(true);
      if (val === "light") setIsDark(false);
    });
  }, []);

  const t = isDark ? DARK_THEME : LIGHT_THEME;

  const toggle = (id: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setOpenId((cur) => (cur === id ? null : id));
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={["top"]}>
      <StatusBar barStyle={isDark ? "light-content" : "dark-content"} backgroundColor={t.bg} />

      {/* ── Header ── */}
      <View style={[s.header, { borderBottomColor: t.border }]}>
        <TouchableOpacity
          style={[s.backBtn, { backgroundColor: t.card2, borderColor: t.border }]}
          onPress={() => router.back()}
        >
          <Ionicons name="arrow-back" size={19} color={t.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={[s.headerTitle, { color: t.text }]}>Owner Guide</Text>
          <Text style={[s.headerSub, { color: t.textSub }]}>Tap a topic to expand</Text>
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 16, paddingBottom: 50 }}>

        {/* ── Quick start ── */}
        <View style={[s.card, { backgroundColor: t.card, borderColor: t.border }]}>
          <View style={s.cardHead}>
            <View style={[s.iconWrap, { backgroundColor: t.greenBg }]}>
              <Ionicons name="rocket-outline" size={19} color={t.green} />
            </View>
            <Text style={[s.cardTitle, { color: t.text }]}>Quick Start</Text>
          </View>
          <View style={{ marginTop: 10 }}>
            {QUICK_START.map((q, i) => (
              <View key={i} style={s.checkRow}>
                <View style={[s.checkNum, { backgroundColor: t.card2, borderColor: t.border }]}>
                  <Text style={{ color: t.green, fontSize: 11, fontWeight: "900" }}>{i + 1}</Text>
                </View>
                <Text style={[s.checkText, { color: t.textSub }]}>{q}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* ── Sections ── */}
        {SECTIONS.map((sec) => {
          const open = openId === sec.id;
          return (
            <View
              key={sec.id}
              style={[s.card, { backgroundColor: t.card, borderColor: open ? sec.color + "55" : t.border, marginTop: 12 }]}
            >
              <TouchableOpacity style={s.cardHead} onPress={() => toggle(sec.id)} activeOpacity={0.75}>
                <View style={[s.iconWrap, { backgroundColor: sec.bg }]}>
                  <Ionicons name={sec.icon as any} size={19} color={sec.color} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[s.cardTitle, { color: t.text }]}>{sec.title}</Text>
                  <Text style={[s.cardSub, { color: t.textSub }]}>{sec.subtitle}</Text>
                </View>
                <Ionicons name={open ? "chevron-up" : "chevron-down"} size={18} color={t.textMuted} />
              </TouchableOpacity>

              {open && (
                <View style={{ marginTop: 14 }}>
                  {sec.intro ? (
                    <Text style={[s.intro, { color: t.textSub, borderLeftColor: sec.color }]}>{sec.intro}</Text>
                  ) : null}

                  {/* ── Diagram: Bookings (cancel + reschedule) ── */}
                  {sec.id === "bookings" && (
                    <>
                      <FlowLabel text="CANCEL" color={sec.color} />
                      <FlowDiagram
                        t={t} color={sec.color} bg={sec.bg}
                        steps={[
                          { icon: "reader-outline", label: "Open" },
                          { icon: "close-circle-outline", label: "Cancel" },
                          { icon: "list-outline", label: "Reason" },
                          { icon: "return-down-back-outline", label: "Refund" },
                        ]}
                      />
                      <FlowCaption t={t} text="Online refund via Razorpay in 5–7 days. Coins reversed automatically." />

                      <FlowLabel text="RESCHEDULE" color={sec.color} />
                      <FlowDiagram
                        t={t} color={sec.color} bg={sec.bg}
                        steps={[
                          { icon: "reader-outline", label: "Open" },
                          { icon: "swap-horizontal-outline", label: "Reschedule" },
                          { icon: "calendar-outline", label: "New date" },
                          { icon: "time-outline", label: "New slot" },
                        ]}
                      />
                      <FlowCaption t={t} text="Only free slots are shown — no double booking. Customer is notified." />
                    </>
                  )}

                  {/* ── Diagram: Block Slots ── */}
                  {sec.id === "blockslots" && (
                    <>
                      <FlowDiagram
                        t={t} color={sec.color} bg={sec.bg}
                        steps={[
                          { icon: "football-outline", label: "Turf" },
                          { icon: "calendar-outline", label: "Date" },
                          { icon: "hand-left-outline", label: "Tap slots" },
                        ]}
                      />
                      <FlowCaption t={t} text="Tap multiple slots at once — they save as ONE bulk entry, not one-by-one." />
                      <View style={f.branchWrap}>
                        <View style={[f.branchCard, { backgroundColor: t.card2, borderColor: t.border }]}>
                          <FlowDiagram
                            t={t} color={sec.color} bg={sec.bg}
                            steps={[
                              { icon: "lock-closed-outline", label: "Block only" },
                              { icon: "checkmark-circle-outline", label: "Done" },
                            ]}
                          />
                          <FlowCaption t={t} text="Hides slot from app. No details needed." />
                        </View>
                        <View style={[f.branchCard, { backgroundColor: t.card2, borderColor: t.border }]}>
                          <FlowDiagram
                            t={t} color={sec.color} bg={sec.bg}
                            steps={[
                              { icon: "person-add-outline", label: "Walk-in" },
                              { icon: "cash-outline", label: "Name+amt" },
                              { icon: "checkmark-circle-outline", label: "Done" },
                            ]}
                          />
                          <FlowCaption t={t} text="Counts as your revenue." />
                        </View>
                      </View>
                    </>
                  )}

                  {/* ── Diagram: Coins ── */}
                  {sec.id === "coins" && <CoinCompare t={t} />}

                  {/* ── Diagram: Promo / Special Slot Offer ── */}
                  {sec.id === "promo" && (
                    <>
                      <FlowLabel text="EXAMPLE: SLOT EMPTY TONIGHT" color={sec.color} />
                      <FlowDiagram
                        t={t} color={sec.color} bg={sec.bg}
                        steps={[
                          { icon: "time-outline", label: "Slot empty" },
                          { icon: "logo-whatsapp", label: "Message us" },
                          { icon: "pricetag-outline", label: "Code made" },
                          { icon: "notifications-outline", label: "Users pinged" },
                          { icon: "checkmark-circle-outline", label: "Booked" },
                        ]}
                      />
                      <FlowCaption
                        t={t}
                        text={'e.g. "7–8 PM at Titan Turf empty tonight, ₹100 off" — we build the code and push it to nearby users.'}
                      />
                      <TouchableOpacity
                        style={[s.openBtn, { backgroundColor: sec.bg, marginTop: 2, marginBottom: 12 }]}
                        onPress={() => Linking.openURL(OWNER_WHATSAPP_URL)}
                        activeOpacity={0.8}
                      >
                        <Ionicons name="logo-whatsapp" size={15} color={sec.color} />
                        <Text style={[s.openBtnText, { color: sec.color }]}>Message Us on WhatsApp</Text>
                      </TouchableOpacity>
                    </>
                  )}

                  {/* ── Notification event list ── */}
                  {sec.id === "notifications" && (
                    <View style={{ marginTop: 2 }}>
                      {NOTIFY_EVENTS.map((ev, i) => (
                        <NotifyRow key={i} ev={ev} color={sec.color} t={t} />
                      ))}
                    </View>
                  )}

                  {/* ── Bullets (all sections) ── */}
                  {sec.bullets.length > 0 && (
                    <View style={{ marginTop: 10 }}>
                      {sec.bullets.map((b, i) => (
                        <View key={i} style={s.bulletRow}>
                          <Ionicons name="checkmark-circle" size={15} color={sec.color} style={{ marginTop: 1 }} />
                          <Text style={[s.bulletText, { color: t.textSub }]}>{b}</Text>
                        </View>
                      ))}
                    </View>
                  )}

                  {sec.tip ? (
                    <View style={[s.tipBox, { backgroundColor: t.card2, borderColor: t.border }]}>
                      <Ionicons name="bulb-outline" size={14} color="#F9C74F" style={{ marginTop: 1 }} />
                      <Text style={[s.tipText, { color: t.textSub }]}>{sec.tip}</Text>
                    </View>
                  ) : null}

                  {sec.route ? (
                    <TouchableOpacity
                      style={[s.openBtn, { backgroundColor: sec.bg }]}
                      onPress={() => router.push(sec.route as any)}
                      activeOpacity={0.8}
                    >
                      <Text style={[s.openBtnText, { color: sec.color }]}>{sec.routeLabel || "Open"}</Text>
                      <Ionicons name="arrow-forward" size={14} color={sec.color} />
                    </TouchableOpacity>
                  ) : null}
                </View>
              )}
            </View>
          );
        })}

        <View style={{ alignItems: "center", marginTop: 22 }}>
          <Text style={{ color: t.textMuted, fontSize: 12, fontWeight: "600" }}>
            Still stuck? Open Support from your dashboard.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  header: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1,
  },
  backBtn: {
    width: 40, height: 40, borderRadius: 12, borderWidth: 1,
    justifyContent: "center", alignItems: "center",
  },
  headerTitle: { fontSize: 19, fontWeight: "900", letterSpacing: -0.3 },
  headerSub:   { fontSize: 12.5, fontWeight: "600", marginTop: 1 },

  card: { borderRadius: 18, borderWidth: 1, padding: 16 },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 11 },
  iconWrap: { width: 38, height: 38, borderRadius: 12, justifyContent: "center", alignItems: "center" },
  cardTitle: { fontSize: 15.5, fontWeight: "800" },
  cardSub:   { fontSize: 12.5, fontWeight: "600", marginTop: 1 },

  checkRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 6 },
  checkNum: { width: 21, height: 21, borderRadius: 8, borderWidth: 1, justifyContent: "center", alignItems: "center" },
  checkText:{ flex: 1, fontSize: 13.5, fontWeight: "600" },

  intro: { fontSize: 13, fontWeight: "600", lineHeight: 18.5, borderLeftWidth: 3, paddingLeft: 10, marginBottom: 12 },

  bulletRow: { flexDirection: "row", alignItems: "flex-start", gap: 8, paddingVertical: 5 },
  bulletText: { flex: 1, fontSize: 13.5, fontWeight: "600", lineHeight: 18.5 },

  tipBox: { flexDirection: "row", gap: 8, borderRadius: 12, borderWidth: 1, padding: 11, marginTop: 10 },
  tipText:{ flex: 1, fontSize: 12.5, fontWeight: "600", lineHeight: 17.5 },

  openBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderRadius: 12, paddingVertical: 12, marginTop: 12 },
  openBtnText: { fontSize: 13.5, fontWeight: "800" },
});

// ── Flow diagram styles ──────────────────────────────────────────────────────
const f = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "flex-start", flexWrap: "wrap", marginBottom: 6 },
  step: { alignItems: "center", width: 64 },
  circle: { width: 36, height: 36, borderRadius: 12, justifyContent: "center", alignItems: "center" },
  label: { fontSize: 10.5, fontWeight: "700", textAlign: "center", marginTop: 5, lineHeight: 13 },
  caption: { fontSize: 12, fontWeight: "500", lineHeight: 16.5, marginBottom: 12 },
  flowLabel: { fontSize: 11, fontWeight: "900", letterSpacing: 0.6, marginBottom: 8, marginTop: 2 },
  branchWrap: { flexDirection: "row", gap: 10, marginTop: 4, marginBottom: 4 },
  branchCard: { flex: 1, borderRadius: 13, borderWidth: 1, padding: 11 },
});

// ── Coin compare styles ──────────────────────────────────────────────────────
const cc = StyleSheet.create({
  row: { flexDirection: "row", gap: 11, marginBottom: 6 },
  card: { flex: 1, borderRadius: 15, borderWidth: 1, padding: 13 },
  icon: { width: 32, height: 32, borderRadius: 11, justifyContent: "center", alignItems: "center", marginBottom: 9 },
  title: { fontSize: 14.5, fontWeight: "800", marginBottom: 7 },
  lineRow: { flexDirection: "row", alignItems: "center", gap: 7, paddingVertical: 2.5 },
  dot: { width: 5, height: 5, borderRadius: 3 },
  lineText: { fontSize: 12, fontWeight: "600" },
});

// ── Notification row styles ──────────────────────────────────────────────────
const nf = StyleSheet.create({
  row: { flexDirection: "row", gap: 10, paddingVertical: 8 },
  icon: { width: 30, height: 30, borderRadius: 10, justifyContent: "center", alignItems: "center", marginTop: 1 },
  titleRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6 },
  title: { fontSize: 13.5, fontWeight: "800" },
  badge: { paddingHorizontal: 8, paddingVertical: 2.5, borderRadius: 999 },
  badgeText: { fontSize: 10, fontWeight: "800" },
  note: { fontSize: 12, fontWeight: "500", lineHeight: 16.5, marginTop: 2 },
});
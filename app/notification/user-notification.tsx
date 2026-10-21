import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  Platform,
  Animated,
  Dimensions,
} from "react-native";
import { useEffect, useState, useRef } from "react";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import {
  getNotifications,
  markAllRead,
  clearAllNotifications,
  subscribeToNotifications,
} from "./usenotification";

// ── Design tokens ─────────────────────────────────────────────────────────────
const HEADER_BG  = "#0B1220";   // dark navy header
const BODY_BG    = "#F5F6FA";   // light gray body
const WHITE      = "#FFFFFF";
const GREEN      = "#4DB408";
const GREEN_LT   = "#EBF9E0";
const BRAND      = "#0B1220";
const GRAY1      = "#F3F4F6";
const GRAY2      = "#E5E7EB";
const GRAY3      = "#9CA3AF";
const GRAY4      = "#6B7280";
const GRAY5      = "#4B5563";

// ── Notification type config ──────────────────────────────────────────────────
function getNotifMeta(title: string) {
  const t = title.toLowerCase();
  if (t.includes("confirm") || (t.includes("booking") && !t.includes("cancel") && !t.includes("new")))
    return { icon: "checkmark-circle", bg: "#D1FAE5", color: "#059669", label: "Booking",   barColor: "#059669" };
  if (t.includes("cancel"))
    return { icon: "close-circle",     bg: "#FEE2E2", color: "#DC2626", label: "Cancelled", barColor: "#DC2626" };
  if (t.includes("reminder") || t.includes("tomorrow"))
    return { icon: "alarm",            bg: "#FEF3C7", color: "#D97706", label: "Reminder",  barColor: "#D97706" };
  if (t.includes("refund"))
    return { icon: "card",             bg: "#EDE9FE", color: "#7C3AED", label: "Refund",    barColor: "#7C3AED" };
  if (t.includes("new booking") || t.includes("📅"))
    return { icon: "calendar",         bg: "#DBEAFE", color: "#2563EB", label: "New",       barColor: "#2563EB" };
  if (t.includes("flash") || t.includes("sale") || t.includes("⚡"))
    return { icon: "flash",            bg: GREEN_LT,  color: GREEN,     label: "Offer",     barColor: GREEN     };
  return { icon: "notifications",      bg: "#F3F4F6", color: GRAY4,     label: "Update",    barColor: GRAY3     };
}

function timeAgo(date: number) {
  const diff = Math.floor((Date.now() - date) / 1000);
  if (diff < 60)     return "Just now";
  if (diff < 3600)   return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400)  return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(date).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

// ── Notification card ─────────────────────────────────────────────────────────
function NotifCard({ item, index }: { item: any; index: number }) {
  const fade  = useRef(new Animated.Value(0)).current;
  const slide = useRef(new Animated.Value(16)).current;
  const meta  = getNotifMeta(item.title);
  const isUnread = !item.read;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fade,  { toValue: 1, duration: 300, delay: index * 50, useNativeDriver: true }),
      Animated.timing(slide, { toValue: 0, duration: 300, delay: index * 50, useNativeDriver: true }),
    ]).start();
  }, []);

  return (
    <Animated.View style={{ opacity: fade, transform: [{ translateY: slide }] }}>
      <View style={[s.card, isUnread && s.cardUnread]}>

        {/* Left color bar */}
        <View style={[s.leftBar, { backgroundColor: isUnread ? meta.barColor : "transparent" }]} />

        {/* Icon */}
        <View style={[s.iconCircle, { backgroundColor: meta.bg }]}>
          <Ionicons name={meta.icon as any} size={22} color={meta.color} />
        </View>

        {/* Content */}
        <View style={s.cardContent}>
          {/* Top row */}
          <View style={s.cardTopRow}>
            <View style={[s.labelPill, { backgroundColor: meta.bg }]}>
              <Text style={[s.labelTxt, { color: meta.color }]}>{meta.label}</Text>
            </View>
            <Text style={s.timeTxt}>{timeAgo(item.date)}</Text>
          </View>

          {/* Title */}
          <Text style={[s.cardTitle, isUnread && s.cardTitleUnread]} numberOfLines={1}>
            {item.title}
          </Text>

          {/* Body */}
          <Text style={s.cardBodyTxt} numberOfLines={2}>
  {item.body || item.message || item.description || ""}
</Text>
        </View>

        {/* Unread dot */}
        {isUnread && (
          <View style={[s.unreadDot, { backgroundColor: meta.barColor }]} />
        )}
      </View>
    </Animated.View>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────
function EmptyState() {
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.07, duration: 950, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1,    duration: 950, useNativeDriver: true }),
      ])
    ).start();
  }, []);

  return (
    <View style={s.emptyWrap}>
      <Animated.View style={[s.emptyCircle, { transform: [{ scale: pulse }] }]}>
        <Ionicons name="notifications-off-outline" size={38} color={GREEN} />
      </Animated.View>
      <Text style={s.emptyTitle}>All caught up!</Text>
      <Text style={s.emptySub}>
        Booking confirmations, reminders,{"\n"}and updates will appear here.
      </Text>
    </View>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────
export default function NotificationsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [notifs, setNotifs] = useState(getNotifications());
  const headerFade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // ✅ Do NOT call markAllRead on mount — let user see unread state
    Animated.timing(headerFade, { toValue: 1, duration: 400, useNativeDriver: true }).start();
    const unsub = subscribeToNotifications((updated) => setNotifs([...updated]));
    return unsub;
  }, []);

  const unreadCount = notifs.filter((n) => !n.read).length;

  return (
    <View style={s.root}>
      <StatusBar barStyle="light-content" backgroundColor={HEADER_BG} />

      {/* ── Dark header ── */}
      <Animated.View style={[s.header, { opacity: headerFade ,paddingTop: insets.top + 12 }]}>
        {/* Back */}
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn} activeOpacity={0.7}>
          <Ionicons name="arrow-back" size={18} color={WHITE} />
        </TouchableOpacity>

        {/* Title + subtitle */}
        <View style={s.headerCenter}>
          <Text style={s.heading}>Notifications</Text>
          <Text style={s.headingSub}>
            {notifs.length === 0
              ? "Nothing here yet"
              : unreadCount > 0
              ? `${unreadCount} unread message${unreadCount > 1 ? "s" : ""}`
              : "All caught up ✓"}
          </Text>
        </View>

        {/* Unread badge */}
        {unreadCount > 0 && (
          <View style={s.unreadBadge}>
            <Text style={s.unreadBadgeTxt}>{unreadCount}</Text>
          </View>
        )}
      </Animated.View>

      {/* ── Action bar (only when notifications exist) ── */}
      {notifs.length > 0 && (
        <View style={s.actionBar}>
          <Text style={s.actionBarLabel}>
            {notifs.length} notification{notifs.length !== 1 ? "s" : ""}
          </Text>
          <View style={s.actionBtns}>
            {unreadCount > 0 && (
              <TouchableOpacity style={s.readAllBtn} onPress={markAllRead} activeOpacity={0.7}>
                <Ionicons name="checkmark-done" size={13} color={GREEN} />
                <Text style={s.readAllTxt}>Read all</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={s.clearBtn} onPress={clearAllNotifications} activeOpacity={0.7}>
              <Ionicons name="trash-outline" size={13} color="#DC2626" />
              <Text style={s.clearTxt}>Clear all</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* ── Body ── */}
      {notifs.length === 0 ? (
        <EmptyState />
      ) : (
        <FlatList
          data={notifs}
          keyExtractor={(item) => item.id ?? Math.random().toString()}
          contentContainerStyle={s.listContent}
          showsVerticalScrollIndicator={false}
          renderItem={({ item, index }) => (
            <NotifCard item={item} index={index} />
          )}
          ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
          ListHeaderComponent={
            <Text style={s.sectionLabel}>
              {unreadCount > 0 ? `${unreadCount} UNREAD` : "ALL NOTIFICATIONS"}
            </Text>
          }
          ListFooterComponent={<View style={{ height: 40 }} />}
        />
      )}
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: BODY_BG },

  // ── Dark header ────────────────────────────────────────────────────────────
  header: {
    flexDirection:    "row",
    alignItems:       "center",
    backgroundColor:  HEADER_BG,
    paddingHorizontal: 16,
    paddingBottom:    18,
    gap: 12,
  },
  backBtn: {
    width:           38,
    height:          38,
    borderRadius:    12,
    backgroundColor: "#FFFFFF18",
    borderWidth:     1,
    borderColor:     "#FFFFFF22",
    alignItems:      "center",
    justifyContent:  "center",
  },
  headerCenter: { flex: 1 },
  heading: {
    fontSize:    22,
    fontWeight:  "900",
    color:       WHITE,
    letterSpacing: -0.4,
  },
  headingSub: {
    fontSize:   12,
    color:      "#FFFFFF88",
    fontWeight: "500",
    marginTop:  2,
  },
  unreadBadge: {
    minWidth:        26,
    height:          26,
    borderRadius:    13,
    backgroundColor: GREEN,
    alignItems:      "center",
    justifyContent:  "center",
    paddingHorizontal: 6,
  },
  unreadBadgeTxt: {
    fontSize:   12,
    fontWeight: "900",
    color:      WHITE,
  },

  // ── Action bar ─────────────────────────────────────────────────────────────
  actionBar: {
    flexDirection:    "row",
    alignItems:       "center",
    justifyContent:   "space-between",
    backgroundColor:  WHITE,
    paddingHorizontal: 16,
    paddingVertical:  10,
    borderBottomWidth: 1,
    borderBottomColor: GRAY2,
  },
  actionBarLabel: {
    fontSize:   12,
    fontWeight: "700",
    color:      GRAY4,
  },
  actionBtns: {
    flexDirection: "row",
    gap:           8,
  },
  readAllBtn: {
    flexDirection:   "row",
    alignItems:      "center",
    gap:             5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: GREEN_LT,
    borderRadius:    8,
    borderWidth:     1,
    borderColor:     GREEN + "44",
  },
  readAllTxt: {
    fontSize:   11,
    fontWeight: "700",
    color:      GREEN,
  },
  clearBtn: {
    flexDirection:   "row",
    alignItems:      "center",
    gap:             5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: "#FEE2E2",
    borderRadius:    8,
    borderWidth:     1,
    borderColor:     "#FECACA",
  },
  clearTxt: {
    fontSize:   11,
    fontWeight: "700",
    color:      "#DC2626",
  },

  // ── List ───────────────────────────────────────────────────────────────────
  listContent: {
    paddingHorizontal: 16,
    paddingTop:        14,
  },
  sectionLabel: {
    fontSize:      10,
    fontWeight:    "800",
    color:         GRAY3,
    letterSpacing: 1.3,
    marginBottom:  10,
    marginLeft:    2,
  },

  // ── Card ───────────────────────────────────────────────────────────────────
  card: {
    flexDirection:   "row",
    alignItems:      "center",
    backgroundColor: WHITE,
    borderRadius:    16,
    paddingVertical: 13,
    paddingRight:    14,
    gap:             12,
    borderWidth:     1,
    borderColor:     GRAY2,
    shadowColor:     "#000",
    shadowOffset:    { width: 0, height: 1 },
    shadowOpacity:   0.05,
    shadowRadius:    4,
    elevation:       2,
    overflow:        "hidden",
  },
  cardUnread: {
    backgroundColor: "#FAFFFE",
    borderColor:     "#C7F5E8",
    shadowOpacity:   0.08,
  },
  leftBar: {
    width:                3,
    alignSelf:            "stretch",
    borderTopRightRadius: 3,
    borderBottomRightRadius: 3,
    marginLeft:           -1,
    minHeight:            50,
  },
  iconCircle: {
    width:          46,
    height:         46,
    borderRadius:   14,
    alignItems:     "center",
    justifyContent: "center",
    flexShrink:     0,
  },
  cardContent: { flex: 1 },
  cardTopRow: {
    flexDirection:  "row",
    alignItems:     "center",
    justifyContent: "space-between",
    marginBottom:   5,
  },
  labelPill: {
    paddingHorizontal: 8,
    paddingVertical:   3,
    borderRadius:      6,
  },
  labelTxt: {
    fontSize:      10,
    fontWeight:    "800",
    letterSpacing: 0.3,
    textTransform: "uppercase",
  },
  timeTxt: {
    fontSize:   11,
    color:      GRAY3,
    fontWeight: "500",
  },
  cardTitle: {
    fontSize:      14,
    fontWeight:    "700",
    color:         GRAY5,
    marginBottom:  3,
    letterSpacing: -0.1,
  },
  cardTitleUnread: {
    fontWeight: "900",
    color:      BRAND,
  },
  cardBodyTxt: {
    fontSize:   12.5,
    color:      GRAY4,
    lineHeight: 18,
  },
  unreadDot: {
    width:       8,
    height:      8,
    borderRadius: 4,
    alignSelf:   "flex-start",
    marginTop:   4,
    flexShrink:  0,
  },

  // ── Empty ──────────────────────────────────────────────────────────────────
  emptyWrap: {
    flex:           1,
    alignItems:     "center",
    justifyContent: "center",
    padding:        40,
  },
  emptyCircle: {
    width:          88,
    height:         88,
    borderRadius:   24,
    backgroundColor: GREEN_LT,
    borderWidth:    2,
    borderColor:    GREEN + "44",
    alignItems:     "center",
    justifyContent: "center",
    marginBottom:   22,
  },
  emptyTitle: {
    fontSize:      20,
    fontWeight:    "900",
    color:         BRAND,
    marginBottom:  8,
    letterSpacing: -0.3,
  },
  emptySub: {
    fontSize:   14,
    color:      GRAY3,
    textAlign:  "center",
    lineHeight: 22,
    fontWeight: "500",
  },
});
import { Stack, usePathname, useRouter } from "expo-router";
import {
  View, Text, TouchableOpacity, StyleSheet,
  useWindowDimensions, Animated, Pressable, Platform, StatusBar,
} from "react-native";
import { useEffect, useRef, useState } from "react";
import { Ionicons } from "@expo/vector-icons";

// =============================================================================
// 🏆 LEAGUE-OWNER SHELL — responsive navigation layout
// ≥900px: persistent left sidebar, full nav
// <900px: header (hamburger+logo+bell+avatar) + bottom tabs + slide-in drawer
//
// Only screens marked built:true below actually exist. Flip a flag to true
// the moment that screen ships — nothing else in this file needs to change.
// =============================================================================

const PRIMARY    = "#5B4FE5";
const PRIMARY_BG = "#F0EEFF";
const DARK       = "#1B2050";
const MUTED      = "#8A8FA8";
const BG         = "#F7F8FC";
const BORDER     = "#EEF0F7";

type NavItem = {
  key: string; label: string; icon: keyof typeof Ionicons.glyphMap;
  path: string; route: string; built: boolean;
};

const NAV_ITEMS: NavItem[] = [
  { key: "dashboard",    label: "Dashboard",    icon: "grid-outline",            path: "/",            route: "/(league-owner)",              built: true  },
  { key: "leagues",      label: "Leagues",      icon: "trophy-outline",          path: "/leagues",      route: "/(league-owner)/leagues",      built: false },
  { key: "teams",        label: "Teams",        icon: "people-outline",          path: "/teams",        route: "/(league-owner)/teams",        built: false },
  { key: "players",      label: "Players",      icon: "person-outline",          path: "/players",      route: "/(league-owner)/players",      built: false },
  { key: "matches",      label: "Matches",      icon: "calendar-outline",        path: "/matches",      route: "/(league-owner)/matches",      built: false },
  { key: "standings",    label: "Standings",    icon: "bar-chart-outline",       path: "/standings",    route: "/(league-owner)/standings",    built: false },
  { key: "transactions", label: "Transactions", icon: "swap-horizontal-outline", path: "/transactions", route: "/(league-owner)/transactions", built: false },
  { key: "payouts",      label: "Payouts",      icon: "card-outline",            path: "/payouts",      route: "/(league-owner)/payouts",      built: false },
  { key: "settings",     label: "Settings",     icon: "settings-outline",        path: "/settings",     route: "/(league-owner)/settings",     built: false },
  { key: "invites",      label: "Invites",      icon: "person-add-outline",      path: "/invites",      route: "/(league-owner)/invites",      built: false },
];

// What actually renders — everything else stays defined above for later,
// but never shows up as a tappable link until it's real.
const VISIBLE_NAV_ITEMS = NAV_ITEMS.filter((n) => n.built);

const TAB_KEYS = ["dashboard", "leagues", "teams", "matches"];

function isActivePath(pathname: string, itemPath: string) {
  if (itemPath === "/") return pathname === "/" || pathname === "/(league-owner)";
  return pathname === itemPath || pathname.startsWith(itemPath + "/");
}

export default function LeagueOwnerLayout() {
  const { width } = useWindowDimensions();
  const isWide = width >= 900;
  const pathname = usePathname();
  const router = useRouter();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const go = (route: string) => {
    setDrawerOpen(false);
    router.push(route as any);
  };

  const isDashboard = pathname === "/" || pathname === "/(league-owner)";

  // Every screen except the dashboard renders full-screen, no shell chrome
  if (!isDashboard) {
    return <Stack screenOptions={{ headerShown: false }} />;
  }

  // Only one screen exists right now — a sidebar/tab bar pointing at a
  // single "you are here" item adds nothing, so skip the chrome entirely
  // until there's a second built screen to navigate between.
  const showNav = VISIBLE_NAV_ITEMS.length > 1;

  if (!showNav) {
    return <Stack screenOptions={{ headerShown: false }} />;
  }

  if (isWide) {
    return (
      <View style={l.wideRoot}>
        <Sidebar pathname={pathname} onNavigate={go} />
        <View style={{ flex: 1 }}>
          <Stack screenOptions={{ headerShown: false }} />
        </View>
      </View>
    );
  }

  return (
    <View style={l.mobileRoot}>
      <MobileHeader onMenuPress={() => setDrawerOpen(true)} />
      <View style={{ flex: 1 }}>
        <Stack screenOptions={{ headerShown: false }} />
      </View>
      <BottomTabBar pathname={pathname} onNavigate={go} onMorePress={() => setDrawerOpen(true)} />
      <MobileDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} pathname={pathname} onNavigate={go} />
    </View>
  );
}

// ── Sidebar (laptop) ──────────────────────────────────────────────────────────
function Sidebar({ pathname, onNavigate }: { pathname: string; onNavigate: (r: string) => void }) {
  return (
    <View style={sb.wrap}>
      <View style={sb.logoRow}>
        <View style={sb.logoIcon}><Ionicons name="trophy" size={18} color={PRIMARY} /></View>
        <View>
          <Text style={sb.logoTitle}>PLAYON</Text>
          <Text style={sb.logoSub}>LEAGUES</Text>
        </View>
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        {VISIBLE_NAV_ITEMS.map((item) => {
          const active = isActivePath(pathname, item.path);
          return (
            <TouchableOpacity
              key={item.key}
              style={[sb.item, active && sb.itemActive]}
              onPress={() => onNavigate(item.route)}
              activeOpacity={0.75}
            >
              <Ionicons name={item.icon} size={17} color={active ? PRIMARY : MUTED} />
              <Text style={[sb.label, active && sb.labelActive]}>{item.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const sb = StyleSheet.create({
  wrap:      { width: 230, backgroundColor: "#fff", borderRightWidth: 1, borderRightColor: BORDER, padding: 16 },
  logoRow:   { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 24, paddingHorizontal: 4 },
  logoIcon:  { width: 34, height: 34, borderRadius: 10, backgroundColor: PRIMARY_BG, alignItems: "center", justifyContent: "center" },
  logoTitle: { fontSize: 13, fontWeight: "900", color: DARK, letterSpacing: 0.5 },
  logoSub:   { fontSize: 9, fontWeight: "700", color: MUTED, letterSpacing: 1 },
  item:        { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10 },
  itemActive:  { backgroundColor: PRIMARY_BG },
  label:       { fontSize: 13.5, fontWeight: "600", color: MUTED },
  labelActive: { color: PRIMARY, fontWeight: "800" },
});

// ── Mobile header ─────────────────────────────────────────────────────────────
function MobileHeader({ onMenuPress }: { onMenuPress: () => void }) {
  return (
    <View style={mh.wrap}>
      <TouchableOpacity onPress={onMenuPress} hitSlop={10} style={mh.iconBtn}>
        <Ionicons name="menu-outline" size={24} color={DARK} />
      </TouchableOpacity>
      <View style={mh.logoRow}>
        <View style={mh.logoIcon}><Ionicons name="trophy" size={16} color={PRIMARY} /></View>
        <View>
          <Text style={mh.logoTitle}>PLAYON</Text>
          <Text style={mh.logoSub}>LEAGUES</Text>
        </View>
      </View>
      <View style={{ flex: 1 }} />
      <TouchableOpacity style={mh.iconBtn} hitSlop={10}>
        <Ionicons name="notifications-outline" size={20} color={DARK} />
        <View style={mh.badge}><Text style={mh.badgeTxt}>3</Text></View>
      </TouchableOpacity>
      <View style={mh.avatar}><Text style={mh.avatarTxt}>LO</Text></View>
    </View>
  );
}

const mh = StyleSheet.create({
  wrap: {
    flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#fff",
    paddingHorizontal: 14,
    paddingTop: Platform.OS === "android" ? (StatusBar.currentHeight || 0) + 54 : 66,
    paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  iconBtn:   { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center", position: "relative" },
  logoRow:   { flexDirection: "row", alignItems: "center", gap: 8 },
  logoIcon:  { width: 30, height: 30, borderRadius: 9, backgroundColor: PRIMARY_BG, alignItems: "center", justifyContent: "center" },
  logoTitle: { fontSize: 12, fontWeight: "900", color: DARK, letterSpacing: 0.4 },
  logoSub:   { fontSize: 8, fontWeight: "700", color: MUTED, letterSpacing: 1 },
  badge:     { position: "absolute", top: -2, right: -2, width: 14, height: 14, borderRadius: 7, backgroundColor: "#DC2626", alignItems: "center", justifyContent: "center" },
  badgeTxt:  { fontSize: 8, fontWeight: "800", color: "#fff" },
  avatar:    { width: 34, height: 34, borderRadius: 17, backgroundColor: DARK, alignItems: "center", justifyContent: "center" },
  avatarTxt: { fontSize: 12, fontWeight: "800", color: "#fff" },
});

// ── Bottom tab bar ─────────────────────────────────────────────────────────────
function BottomTabBar({
  pathname, onNavigate, onMorePress,
}: { pathname: string; onNavigate: (r: string) => void; onMorePress: () => void }) {
  const tabItems = VISIBLE_NAV_ITEMS.filter((n) => TAB_KEYS.includes(n.key));
  const hasMore = VISIBLE_NAV_ITEMS.length > tabItems.length;
  return (
    <View style={bt.wrap}>
      {tabItems.map((item) => {
        const active = isActivePath(pathname, item.path);
        return (
          <TouchableOpacity key={item.key} style={bt.btn} onPress={() => onNavigate(item.route)} activeOpacity={0.75}>
            <Ionicons name={item.icon} size={20} color={active ? PRIMARY : MUTED} />
            <Text style={[bt.label, active && bt.labelActive]}>{item.label}</Text>
          </TouchableOpacity>
        );
      })}
      {hasMore && (
        <TouchableOpacity style={bt.btn} onPress={onMorePress} activeOpacity={0.75}>
          <Ionicons name="ellipsis-horizontal-circle-outline" size={20} color={MUTED} />
          <Text style={bt.label}>More</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const bt = StyleSheet.create({
  wrap: {
    flexDirection: "row", backgroundColor: "#fff",
    borderTopWidth: 1, borderTopColor: BORDER,
    paddingTop: 8, paddingBottom: Platform.OS === "ios" ? 32 : 60,
  },
  btn:         { flex: 1, alignItems: "center", gap: 3 },
  label:       { fontSize: 10, fontWeight: "600", color: MUTED },
  labelActive: { color: PRIMARY, fontWeight: "800" },
});

// ── Slide-in drawer (full nav, opened by hamburger or "More") ─────────────────
function MobileDrawer({
  open, onClose, pathname, onNavigate,
}: { open: boolean; onClose: () => void; pathname: string; onNavigate: (r: string) => void }) {
  const translateX = useRef(new Animated.Value(-280)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const [mounted, setMounted] = useState(open);

  useEffect(() => {
    if (open) {
      setMounted(true);
      Animated.parallel([
        Animated.timing(translateX, { toValue: 0, duration: 220, useNativeDriver: true }),
        Animated.timing(backdropOpacity, { toValue: 1, duration: 220, useNativeDriver: true }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(translateX, { toValue: -280, duration: 200, useNativeDriver: true }),
        Animated.timing(backdropOpacity, { toValue: 0, duration: 200, useNativeDriver: true }),
      ]).start(() => setMounted(false));
    }
  }, [open]);

  if (!mounted) return null;

  return (
    <View style={dr.overlay} pointerEvents="box-none">
      <Animated.View style={[dr.backdrop, { opacity: backdropOpacity }]}>
        <Pressable style={{ flex: 1 }} onPress={onClose} />
      </Animated.View>

      <Animated.View style={[dr.panel, { transform: [{ translateX }] }]}>
        <View style={dr.panelHeader}>
          <View style={dr.logoIcon}><Ionicons name="trophy" size={18} color={PRIMARY} /></View>
          <View>
            <Text style={dr.logoTitle}>PLAYON</Text>
            <Text style={dr.logoSub}>LEAGUES</Text>
          </View>
          <TouchableOpacity onPress={onClose} hitSlop={10} style={{ marginLeft: "auto" }}>
            <Ionicons name="close" size={22} color={MUTED} />
          </TouchableOpacity>
        </View>

        <View style={{ paddingTop: 8 }}>
          {VISIBLE_NAV_ITEMS.map((item) => {
            const active = isActivePath(pathname, item.path);
            return (
              <TouchableOpacity
                key={item.key}
                style={[dr.item, active && dr.itemActive]}
                onPress={() => onNavigate(item.route)}
                activeOpacity={0.75}
              >
                <Ionicons name={item.icon} size={18} color={active ? PRIMARY : MUTED} />
                <Text style={[dr.label, active && dr.labelActive]}>{item.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </Animated.View>
    </View>
  );
}

const dr = StyleSheet.create({
  overlay:  { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, flexDirection: "row", zIndex: 50 },
  backdrop: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(11,18,32,0.45)" },
  panel: {
    width: 270, height: "100%", backgroundColor: "#fff",
    paddingTop: Platform.OS === "android" ? (StatusBar.currentHeight || 0) + 16 : 50,
    paddingHorizontal: 14, paddingBottom: 24,
    shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 16, shadowOffset: { width: 4, height: 0 }, elevation: 12,
  },
  panelHeader: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 6, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: BORDER, marginBottom: 6 },
  logoIcon:    { width: 32, height: 32, borderRadius: 10, backgroundColor: PRIMARY_BG, alignItems: "center", justifyContent: "center" },
  logoTitle:   { fontSize: 13, fontWeight: "900", color: DARK, letterSpacing: 0.4 },
  logoSub:     { fontSize: 9, fontWeight: "700", color: MUTED, letterSpacing: 1 },
  item:        { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 11, paddingHorizontal: 10, borderRadius: 10 },
  itemActive:  { backgroundColor: PRIMARY_BG },
  label:       { fontSize: 14, fontWeight: "600", color: MUTED },
  labelActive: { color: PRIMARY, fontWeight: "800" },
});

const l = StyleSheet.create({
  wideRoot:   { flex: 1, flexDirection: "row", backgroundColor: BG },
  mobileRoot: { flex: 1, backgroundColor: BG },
});
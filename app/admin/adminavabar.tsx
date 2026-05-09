import { View, Text, TouchableOpacity, StyleSheet, Platform } from "react-native";
import { useRouter, usePathname } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

const ACCENT = "#0EA5A4";

const TABS = [
  { label: "Dashboard", icon: "grid-outline" as const,     activeIcon: "grid" as const,          route: "/admin" },
  //{ label: "Turfs",     icon: "location-outline" as const, activeIcon: "location" as const,       route: "/admin/turfs" },==
  { label: "Owners",    icon: "people-outline" as const,   activeIcon: "people" as const,         route: "/admin/owners" },
  { label: "Bookings",  icon: "calendar-outline" as const, activeIcon: "calendar" as const,       route: "/admin/bookings" },
  //{ label: "Settings",  icon: "settings-outline" as const, activeIcon: "settings" as const,       route: "/admin/settings" },
  { label: "Support", icon: "chatbubbles-outline", activeIcon: "chatbubbles", route: "/admin/support-solve" },
  { label: "Users", icon: "people-outline", activeIcon: "people", route: "/admin/user-monitor" }
];

export default function AdminNavBar() {
  const router = useRouter();
  const pathname = usePathname();

  return (
    <View style={s.bar}>
      {TABS.map((tab) => {
        const active = pathname === tab.route || (tab.route !== "/admin" && pathname.startsWith(tab.route));
        return (
          <TouchableOpacity
            key={tab.route}
            style={s.tab}
            onPress={() => router.push(tab.route as any)}
            activeOpacity={0.7}
          >
            <View style={[s.iconWrap, active && s.iconWrapActive]}>
              <Ionicons
                name={active ? tab.activeIcon : tab.icon}
                size={21}
                color={active ? ACCENT : "#9CA3AF"}
              />
            </View>
            <Text style={[s.label, active && s.labelActive]}>{tab.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  bar: {
    flexDirection: "row",
    backgroundColor: "#FFFFFF",
    borderTopWidth: 1,
    borderTopColor: "#F0F0F0",
    paddingBottom: Platform.OS === "ios" ? 40 : 58,
    paddingTop: 8,
    paddingHorizontal: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 16,
  },
  tab: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
  },
  iconWrap: {
    width: 40,
    height: 32,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
  },
  iconWrapActive: {
    backgroundColor: "#F0FDFA",
  },
  label: {
    fontSize: 10,
    fontWeight: "600",
    color: "#9CA3AF",
  },
  labelActive: {
    color: ACCENT,
    fontWeight: "800",
  },
});
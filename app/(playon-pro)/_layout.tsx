import { Tabs, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Platform } from "react-native";

// =======================================================
// 🏆 PLAYON LEAGUES — bottom navigation for the league world
// This is a SEPARATE tab navigator from the main (tabs) app.
// The user enters here via the center "Leagues" button on the
// main Playon bottom bar (router.push("/playon-pro")).
//
// IMPORTANT: every .tsx file in this folder becomes a VISIBLE
// tab automatically unless it's listed here with href: null.
//
// ✅ CHANGES IN THIS VERSION:
//   • Registered the NEW "matches" screen (All Matches list) —
//     this fixes the dead "View All" route on Home.
// =======================================================
export default function PlayonProLayout() {
  const router = useRouter();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: "#16A34A",
        tabBarInactiveTintColor: "#9CA3AF",
        tabBarStyle: {
          backgroundColor: "#fff",
          borderTopColor: "#F3F4F6",
          borderTopWidth: 1,
          height: Platform.OS === "android" ? 90 : 110,
          paddingBottom: Platform.OS === "android" ? 24 : 8,
          paddingTop: 6,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: "600" },
      }}
    >
      {/* ── Visible tabs ─────────────────────────────────── */}
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="trophy-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="explore"
        options={{
          title: "Explore",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="search-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="my-league"
        options={{
          title: "My Leagues",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="list-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="person-outline" size={size} color={color} />
          ),
        }}
      />

      {/* Bookings — exits the league world back to the main app. */}
      <Tabs.Screen
        name="(tabs)"
        options={{
          title: "Bookings",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="calendar-outline" size={size} color={color} />
          ),
        }}
        listeners={{
          tabPress: (e) => {
            e.preventDefault();
            router.replace("/(tabs)" as any);
          },
        }}
      />

      {/* ── Hidden routes (reachable by navigation only) ──── */}
      <Tabs.Screen name="matches"              options={{ href: null }} />{/* ✅ NEW — All Matches */}
      <Tabs.Screen name="match/[matchid]"      options={{ href: null }} />
      <Tabs.Screen name="player/[uid]"         options={{ href: null }} />
      <Tabs.Screen name="edit-player-profile"  options={{ href: null }} />
      <Tabs.Screen name="league-card/[id]"     options={{ href: null }} />
      <Tabs.Screen name="create-league"        options={{ href: null }} />
      <Tabs.Screen name="league-manage"        options={{ href: null }} />
      <Tabs.Screen name="manage-match"         options={{ href: null }} />
      <Tabs.Screen name="score/[matchid]"      options={{ href: null }} />
      <Tabs.Screen name="host-match"           options={{ href: null }} />

      {/* ⚠️ DEAD FILES — DELETE host-league.tsx and the whole
          manege-league folder from (playon-pro), then remove
          these two lines. They are not used anywhere. */}
      <Tabs.Screen name="host-league"          options={{ href: null }} />
      <Tabs.Screen name="manege-league/[id]"   options={{ href: null }} />
    </Tabs>
  );
}
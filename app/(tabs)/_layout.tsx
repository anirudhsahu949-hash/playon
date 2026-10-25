import { Tabs, Redirect, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, View, Platform, TouchableOpacity, Text, StyleSheet } from "react-native";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "../../firebaseConfig";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";





// ─── Brand colours ────────────────────────────────────────────────────────────
const BRAND = "#0B1220";     // active tab icon / label
const INACTIVE = "#9CA3AF";  // inactive tab icon / label
const TAB_BG = "#FFFFFF";    // tab bar background
const BORDER = "#E5E7EB";    // top border

// ─── Center "Leagues" button → enters the league world ──────────────────────
function LeagueTabButton() {
  const router = useRouter();
  return (
    <TouchableOpacity
      style={ctr.wrap}
      activeOpacity={0.85}
      onPress={() => router.push("/(playon-pro)")}
    >
      <View style={ctr.circle}>
        <Ionicons name="trophy" size={22} color="#fff" />
      </View>
      <Text style={ctr.label}>Leagues</Text>
    </TouchableOpacity>
  );
}

const ctr = StyleSheet.create({
  wrap: { flex: 1, alignItems: "center", justifyContent: "center", paddingBottom:30 },
  circle: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: "#16A34A",
    alignItems: "center", justifyContent: "center",
    shadowColor: "#16A34A", shadowOpacity: 0.3, shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 }, elevation: 4,
  },
  label: { fontSize: 11, fontWeight: "600", color: "#15803D", marginTop: 2 },
});

// ─── Splash / loading screen while Firebase resolves ─────────────────────────
function LoadingScreen() {
  return (
    <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#fff" }}>
      <ActivityIndicator size="large" color={BRAND} />
    </View>
  );
}





// ─── Main layout ──────────────────────────────────────────────────────────────
export default function UserTabLayout() {
  // undefined  → still waiting for Firebase
  // null       → no user logged in
  // object     → user logged in
   
  // Real space the phone needs at the bottom (gesture bar / buttons) — differs per phone
  const insets = useSafeAreaInsets();
  const bottomPad = Math.max(insets.bottom, 8) + 6;   // +6 = a little breathing room under the labels

  const [user, setUser] = useState<any>(undefined);
  const [role, setRole] = useState<string | null>(null);
  const [roleLoading, setRoleLoading] = useState(true);

  // Step 1 — listen for Firebase auth state
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);

      if (firebaseUser) {
        // Step 2 — fetch the role from Firestore
        try {
          const snap = await getDoc(doc(db, "users", firebaseUser.uid));
          if (snap.exists()) {
            setRole(snap.data().role ?? "user");
          } else {
            setRole("user"); // fallback if doc missing
          }
        } catch (e) {
          console.error("Role fetch error:", e);
          setRole("user");
        }
      } else {
        setRole(null);
      }

      setRoleLoading(false);
    });

    return unsubscribe;
  }, []);

  // ── Still loading auth / role ──────────────────────────────────────────────
  if (user === undefined || roleLoading) {
    return <LoadingScreen />;
  }

  // ── Not logged in → go to login ───────────────────────────────────────────
 

  // ── Wrong role → redirect to their correct app section ────────────────────
  if (role === "admin") {
    return <Redirect href="/admin" />;
  }
  if (role === "owner") {
    return <Redirect href="/(owner)" />;
  }
  if (role === "turf-operator") {
    return <Redirect href="/(turf-operator)" />;
  }
 if (role === "league-owner") {
  return <Redirect href="/(league-owner)" />;
}

  // ── Correct role (user) → show the tab bar ────────────────────────────────
  return (
    <Tabs
      screenOptions={{
        headerShown: false,

        // ── Active / inactive colours ────────────────────────────────────────
        tabBarActiveTintColor: BRAND,
        tabBarInactiveTintColor: INACTIVE,

        // ── Tab bar container style ──────────────────────────────────────────
        tabBarStyle: {
          backgroundColor: TAB_BG,
          borderTopWidth: 0.5,
          borderTopColor: BORDER,
          // 56 = icons + labels; then only the space THIS phone needs below them
          // (was a fixed 110 on Android → big empty gap on gesture-bar phones like OnePlus)
          height: 56 + bottomPad,
          paddingBottom: bottomPad,
          paddingTop: 6,
          elevation: 0,         // remove Android shadow
          shadowOpacity: 0,     // remove iOS shadow
        },

        // ── Label style ──────────────────────────────────────────────────────
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: "500",
          marginTop: 2,
        },
      }}
    >
      {/* ── Home ─────────────────────────────────────────────────────────── */}
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? "home" : "home-outline"}
              size={24}
              color={color}
            />
          ),
        }}
      />

      {/* ── Explore ──────────────────────────────────────────────────────── */}
      <Tabs.Screen
        name="explore"
        options={{
          title: "Explore",
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? "search" : "search-outline"}
              size={24}
              color={color}
            />
          ),
        }}
      />

      {/* ── Leagues (center action — navigates to the league world) ───────── */}
<Tabs.Screen
  name="leagues"
  options={{
    href: null,
    headerShown: false,
    tabBarStyle: { display: "none" },
    tabBarItemStyle: { display: "none" },
    
  }}
/>

<Tabs.Screen
  name="ai"
  options={{
    href: null,
    headerShown: false,
    tabBarStyle: { display: "none" },
    tabBarItemStyle: { display: "none" },
    
  }}
/>

<Tabs.Screen
  name="refer-venue"
  options={{
    href: null,
    headerShown: false,
    tabBarStyle: { display: "none" },
    tabBarItemStyle: { display: "none" },
    
  }}
/>

<Tabs.Screen name="refer-earn-user" options={{ href: null }} />

      {/* ── My Bookings ──────────────────────────────────────────────────── */}
      <Tabs.Screen
        name="booking-users"
        options={{
          title: "Bookings",
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? "calendar" : "calendar-outline"}
              size={24}
              color={color}
            />
          ),
        }}
      />

      {/* ── Profile ──────────────────────────────────────────────────────── */}
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? "person" : "person-outline"}
              size={24}
              color={color}
            />
          ),
        }}
      />

      <Tabs.Screen
  name="wallet"
  options={{
    href: null,
    headerShown: false,
    tabBarStyle: { display: "none" },
    tabBarItemStyle: { display: "none" },
  }}
/>

<Tabs.Screen
  name="toss"
  options={{
    href: null,
    headerShown: false,
    tabBarStyle: { display: "none" },
    tabBarItemStyle: { display: "none" },
  }}
/>

<Tabs.Screen
  name="GullyScorer"
  options={{
    href: null,
    headerShown: false,
    tabBarStyle: { display: "none" },
    tabBarItemStyle: { display: "none" },
  }}
/>

<Tabs.Screen
  name="list-turf"
  options={{
    href: null,
    headerShown: false,
    tabBarStyle: { display: "none" },
    tabBarItemStyle: { display: "none" },
    
  }}
/>
<Tabs.Screen
  name="grow-with-playon"
  options={{
    href: null,
    headerShown: false,
    tabBarStyle: { display: "none" },
    tabBarItemStyle: { display: "none" },
    
  }}
/>
<Tabs.Screen
  name="add-a-turf"
  options={{
    href: null,
    headerShown: false,
    tabBarStyle: { display: "none" },
    tabBarItemStyle: { display: "none" },
  }}
/>
    </Tabs>
  );
}
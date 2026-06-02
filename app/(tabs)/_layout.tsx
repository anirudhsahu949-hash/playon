import { Tabs, Redirect } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, View, Platform } from "react-native";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "../../firebaseConfig";
import { Ionicons } from "@expo/vector-icons";



// ─── Brand colours ────────────────────────────────────────────────────────────
const BRAND = "#0B1220";     // active tab icon / label
const INACTIVE = "#9CA3AF";  // inactive tab icon / label
const TAB_BG = "#FFFFFF";    // tab bar background
const BORDER = "#E5E7EB";    // top border

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
  if (!user) {
    return <Redirect href="/(auth)/login" />;
  }

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
          height: Platform.OS === "ios" ? 80 : 110,
          paddingBottom: Platform.OS === "ios" ? 24 : 8,
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
    </Tabs>
  );
}


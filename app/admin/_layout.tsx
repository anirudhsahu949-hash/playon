import { useEffect, useState } from "react";
import { ActivityIndicator, View, StyleSheet } from "react-native";

import { useRouter } from "expo-router";
import { Drawer } from "expo-router/drawer";

import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";

import { auth, db } from "../../firebaseConfig";

import { Ionicons } from "@expo/vector-icons";

export default function AdminLayout() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      try {
        if (!user) {
          router.replace("/(auth)/login");
          return;
        }

        const snap = await getDoc(doc(db, "users", user.uid));

        if (!snap.exists()) {
          router.replace("/(auth)/login");
          return;
        }

        const role = snap.data()?.role;

        if (role === "owner") {
          router.replace("/(owner)");
          return;
        }

        if (role === "turf-operator") {
          router.replace("/(turf-operator)");
          return;
        }

        if (role === "user") {
          router.replace("/(tabs)");
          return;
        }

        // ADMIN ALLOWED
        setChecking(false);

      } catch (err) {
        console.log(err);
        router.replace("/(auth)/login");
      }
    });

    return unsubscribe;
  }, []);

  if (checking) {
    return (
      <View style={s.center}>
        <ActivityIndicator size="large" color="#0EA5A4" />
      </View>
    );
  }

  return (
    <Drawer
      screenOptions={{
        headerShown: false,

        drawerStyle: {
          backgroundColor: "#0A0F1E",
          width: 280,
        },

        drawerActiveTintColor: "#6366F1",
        drawerInactiveTintColor: "#9CA3AF",

        sceneStyle: {
          backgroundColor: "#F4F6FA",
        },
      }}
    >
      <Drawer.Screen
        name="index"
        options={{
          drawerLabel: "Dashboard",
          drawerIcon: ({ color, size }) => (
            <Ionicons name="grid-outline" size={size} color={color} />
          ),
        }}
      />

      <Drawer.Screen
        name="bookings"
        options={{
          drawerLabel: "Bookings",
          drawerIcon: ({ color, size }) => (
            <Ionicons name="calendar-outline" size={size} color={color} />
          ),
        }}
      />

      <Drawer.Screen
        name="owners"
        options={{
          drawerLabel: "Owners",
          drawerIcon: ({ color, size }) => (
            <Ionicons name="people-outline" size={size} color={color} />
          ),
        }}
      />

      <Drawer.Screen
        name="turfs"
        options={{
          drawerLabel: "Turfs",
          drawerIcon: ({ color, size }) => (
            <Ionicons name="business-outline" size={size} color={color} />
          ),
        }}
      />

      <Drawer.Screen
        name="settings"
        options={{
          drawerLabel: "Settings",
          drawerIcon: ({ color, size }) => (
            <Ionicons name="settings-outline" size={size} color={color} />
          ),
        }}
      />
    </Drawer>
  );
}

const s = StyleSheet.create({
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#F0F4F8",
  },
});
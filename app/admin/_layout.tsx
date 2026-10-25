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
        name="add-listing"
        options={{
          drawerLabel: "Quick Add Turf",
          drawerIcon: ({ color, size }) => (
            <Ionicons name="flash-outline" size={size} color={color} />
          ),
        }}
      />

      <Drawer.Screen
        name="cities"
        options={{
          drawerLabel: "Cities",
          drawerIcon: ({ color, size }) => (
            <Ionicons name="map-outline" size={size} color={color} />
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

       <Drawer.Screen
        name="add-turf"
        options={{
          drawerLabel: "add turfs",
          drawerIcon: ({ color, size }) => (
            <Ionicons name="add" size={size} color={color} />
          ),
        }}
      />

       



<Drawer.Screen
  name="user-monitor"
  options={{
    title: "Users",
    drawerIcon: ({ color, size }) => (
      <Ionicons name="eye-outline" size={size} color={color} />
    ),
  }}
/>

<Drawer.Screen
  name="booking-analysis"
  options={{
    title: "Analytics",
    drawerIcon: ({ color, size }) => (
      <Ionicons name="stats-chart-outline" size={size} color={color} />
    ),
  }}
/>
   <Drawer.Screen
        name="adminavabar"
        options={{
          drawerItemStyle: { display: "none" },
        }}
      />

       <Drawer.Screen
       name="notification-center"
       options={{
       title: "notification managament",
       drawerIcon: ({ color, size }) => (
       <Ionicons name="notifications-outline" size={size} color={color} />
       ),
      }}
     />

     
       <Drawer.Screen
       name="Adminsettlementscreen"
       options={{
       title: "settlement",
       drawerIcon: ({ color, size }) => (
       <Ionicons name="calculator-outline" size={size} color={color} />
       ),
      }}
     />

            <Drawer.Screen
  name="support-solve"
  options={{
    title: "Support",
    drawerIcon: ({ color, size }) => (
      <Ionicons name="chatbubbles-outline" size={size} color={color} />
    ),
  }}
/>

  <Drawer.Screen
  name="user-home-control"
  options={{
    title: "user-home-control",
    drawerIcon: ({ color, size }) => (
      <Ionicons name="apps-outline" size={size} color={color} />
    ),
  }}
/>
  <Drawer.Screen
  name="admin-link"
  options={{
    title: "user-share-link-update",
    drawerIcon: ({ color, size }) => (
      <Ionicons name="share-outline" size={size} color={color} />
    ),
  }}
/>

<Drawer.Screen
  name="area-analysis"
  options={{
    title: "user-location-filter",
    drawerIcon: ({ color, size }) => (
      <Ionicons name="location-outline" size={size} color={color} />
    ),
  }}
/>

<Drawer.Screen
  name="adminnotification"
  options={{
    title: "notification",
    drawerIcon: ({ color, size }) => (
      <Ionicons name="notifications-outline" size={size} color={color} />
    ),
  }}
/>

<Drawer.Screen
  name="booking-analytics"
  options={{
    title: "booking-analysis",
    drawerIcon: ({ color, size }) => (
      <Ionicons name="analytics-outline" size={size} color={color} />
    ),
  }}
/>

<Drawer.Screen
  name="admin-owner-details-banking-online"
  options={{
    title: "owners-baninkg-details",
    drawerIcon: ({ color, size }) => (
      <Ionicons name="wallet-outline" size={size} color={color} />
    ),
  }}
/>
<Drawer.Screen
  name="promo-code-admin"
  options={{
    title: "promo code for users",
    drawerIcon: ({ color, size }) => (
      <Ionicons name="code-outline" size={size} color={color} />
    ),
  }}
/>

<Drawer.Screen
  name="booking-rules"
  options={{
    title: "booking-rule",
    drawerIcon: ({ color, size }) => (
      <Ionicons name="build-outline" size={size} color={color} />
    ),
  }}
/>

<Drawer.Screen
  name="Add-gym"
  options={{
    title: "add-gyms",
    drawerIcon: ({ color, size }) => (
      <Ionicons name="barbell-outline" size={size} color={color} />
    ),
  }}
/>

<Drawer.Screen
  name="admin-bank-verification"
  options={{
    title: "bank verification",
    drawerIcon: ({ color, size }) => (
      <Ionicons name="wallet-outline" size={size} color={color} />
    ),
  }}
/>

<Drawer.Screen
  name="admin payout"
  options={{
    title: "payout owner turf",
    drawerIcon: ({ color, size }) => (
      <Ionicons name="cash-outline" size={size} color={color} />
    ),
  }}
/>


<Drawer.Screen
  name="import-player"
  options={{
    title: "update-league-profile",
    drawerIcon: ({ color, size }) => (
      <Ionicons name="person-outline" size={size} color={color} />
    ),
  }}
/>

<Drawer.Screen
  name="create-league-owner"
  options={{
    title: "create-league-owner",
    drawerIcon: ({ color, size }) => (
      <Ionicons name="person-outline" size={size} color={color} />
    ),
  }}
/>

<Drawer.Screen
  name="player-profile/{uid}"
  options={{
    title: "player-search",
    drawerIcon: ({ color, size }) => (
      <Ionicons name="person-outline" size={size} color={color} />
    ),
  }}
/>

<Drawer.Screen
  name="league-users-profile-update"
  options={{
    title: "leage-user-profile-update",
    drawerIcon: ({ color, size }) => (
      <Ionicons name="person-outline" size={size} color={color} />
    ),
  }}
/>

<Drawer.Screen
  name="p-coin"
  options={{
    drawerLabel: "PCoin Settings",
    drawerIcon: ({ color, size }) => (
      <Ionicons name="wallet-outline" size={size} color={color} />
    ),
  }}
/>

<Drawer.Screen
  name="Adminsettlementsscreen-new"
  options={{
    drawerLabel: "new-settlement-screen",
    drawerIcon: ({ color, size }) => (
      <Ionicons name="wallet-outline" size={size} color={color} />
    ),
  }}
/>

<Drawer.Screen
  name="refferl-admin_user"
  options={{
    drawerLabel: "refferl-admin-user",
    drawerIcon: ({ color, size }) => (
      <Ionicons name="wallet-outline" size={size} color={color} />
    ),
  }}
/>

<Drawer.Screen
  name="banners"
  options={{
    drawerLabel: "Banners",
    drawerIcon: ({ color, size }) => <Ionicons name="image-outline" size={size} color={color} />,
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
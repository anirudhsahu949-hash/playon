import { usePushNotifications } from "../app/notification/usenotification";
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View, Text, TouchableOpacity, Linking } from 'react-native';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { auth, db } from '../firebaseConfig';
import { doc, getDoc } from 'firebase/firestore';
import type { DocumentSnapshot } from 'firebase/firestore';
import Constants from "expo-constants";
import { AppThemeProvider } from "../theme/themeprovider";

export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const router     = useRouter();
  const segments   = useSegments();

  const [loading,        setLoading]        = useState(true);
  const [updateRequired, setUpdateRequired] = useState(false);
  const [updateMessage,  setUpdateMessage]  = useState("");

  usePushNotifications();

  // ── Version check ── runs once on mount, OUTSIDE auth effect
  useEffect(() => {
    const checkVersion = async () => {
      try {
        const configDoc = await getDoc(doc(db, "appConfig", "versioning"));
        if (!configDoc.exists()) return;
        const { minVersion, forceUpdate, updateMessage } = configDoc.data();
        const installedVersion = Constants.expoConfig?.android?.versionCode ?? 1;
        if (forceUpdate && installedVersion < minVersion) {
          setUpdateMessage(updateMessage);
          setUpdateRequired(true);
        }
      } catch (e) {
        // silent fail — never block user if Firestore check fails
      }
    };
    checkVersion();
  }, []);

  // ── Auth + role routing ──
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      console.log("USER:", user?.uid);
      try {
        if (!user) {
          // Guest mode: only block role-restricted sections.
          // Everyone else (tabs, playon-pro, auth screens) is allowed through.
          const protectedSections = ['admin', '(owner)', '(turf-operator)', '(league-owner)'];
          if (protectedSections.includes(segments[0] as string)) {
            router.replace('/(auth)/login');
          }
          return;
        }

        // Timeout protection — prevents freeze if Firestore is slow
        const timeout = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Timeout')), 5000)
        );

        const snap = await Promise.race([
          getDoc(doc(db, 'users', user.uid)),
          timeout,
        ]) as DocumentSnapshot;

        if (!snap.exists()) {
          router.replace('/(auth)/login');
          return;
        }

        const role   = snap.data().role;
        const status = snap.data().status;

        if (status === "blocked") {
          await signOut(auth);
          router.replace("/(auth)/login");
          return;
        }

        console.log("ROLE:", role);

        if (role === 'admin' && segments[0] !== 'admin') {
          router.replace('/admin');
        } else if (role === 'owner' && segments[0] !== '(owner)') {
          router.replace('/(owner)');
        } else if ((role === 'turf-operator' || role === 'operator') && segments[0] !== '(turf-operator)') {
          router.replace('/(turf-operator)');
        } else if (role === 'league-owner' && segments[0] !== '(league-owner)') {
          router.replace('/(league-owner)');
        } else if (role === 'user' && segments[0] !== '(tabs)' && segments[0] !== '(playon-pro)') {
          router.replace('/(tabs)');
        }

      } catch (err) {
        console.log('Auth error:', err);
        // don't force login on error either — just stop loading, let them stay as guest
      } finally {
        setLoading(false);
      }
    });

    return unsubscribe;
  }, []);

  // ── Update required screen ──
  if (updateRequired) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center",
                     padding: 32, backgroundColor: "#0A0F1E" }}>
        <Text style={{ fontSize: 40, marginBottom: 16 }}>🏟️</Text>
        <Text style={{ fontSize: 24, fontWeight: "900", color: "#fff", textAlign: "center" }}>
          Update Required
        </Text>
        <Text style={{ fontSize: 14, color: "#9CA3AF", textAlign: "center",
                       marginTop: 12, lineHeight: 22 }}>
          {updateMessage}
        </Text>
        <TouchableOpacity
          style={{ backgroundColor: "#22C55E", paddingHorizontal: 32,
                   paddingVertical: 16, borderRadius: 14, marginTop: 32 }}
          onPress={() => Linking.openURL(
            "https://play.google.com/store/apps/details?id=com.playonnew.app"
          )}
        >
          <Text style={{ color: "#fff", fontWeight: "800", fontSize: 16 }}>
            Update on Play Store
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── Loading screen ──
  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  // ── App navigation ──
  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AppThemeProvider>
        <Stack screenOptions={{ headerShown: false }}>
         
          <Stack.Screen name="(tabs)" />
           <Stack.Screen name="(auth)" />
          <Stack.Screen name="(owner)" />
          <Stack.Screen name="admin" />
          <Stack.Screen name="(turf-operator)" />
          <Stack.Screen name="modal" options={{ presentation: 'modal' }} />
        </Stack>
        <StatusBar style={colorScheme === "dark" ? "light" : "dark"} />
      </AppThemeProvider>
    </ThemeProvider>
  );
}
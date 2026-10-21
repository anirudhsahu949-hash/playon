import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Linking, Image } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { db } from "../../firebaseConfig";
import { collection, query, where, limit, getDocs } from "firebase/firestore";

// =============================================================================
// 💰 AdBanner — Google AdMob banner with a SPONSOR fallback.
//
// HOW MONEY WORKS HERE:
//   1. GOOGLE ADS  → shown automatically once you set your real Ad Unit IDs
//      below and build with EAS (ads do NOT work inside Expo Go — the
//      component detects that and shows the sponsor slot instead, so nothing
//      ever crashes).
//   2. SPONSORS    → you sell banner slots to local turfs / shops / academies.
//      Just add a doc to the Firestore collection `sponsors`:
//        { name: "XYZ Sports Shop", tagline: "20% off cricket kits",
//          imageUrl: "https://...", link: "https://wa.me/91XXXXXXXXXX",
//          active: true, priority: 1 }
//      A sponsor (if any is active) ALWAYS wins over Google ads — sponsors
//      pay you directly, which earns more than AdMob per impression.
//
// SETUP (one time):
//   npx expo install react-native-google-mobile-ads
//   → then follow the AdMob section of the setup guide I gave you
//     (app.json plugin + your AdMob App ID + EAS build).
// =============================================================================

// ⚠️ REPLACE with your real AdMob banner unit id before release.
// This is Google's official TEST id — safe while developing.
const BANNER_AD_UNIT_ID = "ca-app-pub-3940256099942544/6300978111";

// Try to load the native ads module. In Expo Go it doesn't exist → null.
let BannerAd: any = null;
let BannerAdSize: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const ads = require("react-native-google-mobile-ads");
  BannerAd = ads.BannerAd;
  BannerAdSize = ads.BannerAdSize;
} catch {
  /* Expo Go / module not installed — sponsor fallback will render */
}

type Sponsor = {
  id: string;
  name: string;
  tagline?: string;
  imageUrl?: string;
  link?: string;
};

export default function AdBanner({ placement = "home" }: { placement?: string }) {
  const [sponsor, setSponsor] = useState<Sponsor | null>(null);
  const [adFailed, setAdFailed] = useState(false);
  const [checked, setChecked] = useState(false);

  // Look for an active sponsor once per mount.
  useEffect(() => {
    (async () => {
      try {
        const snap = await getDocs(
          query(collection(db, "sponsors"), where("active", "==", true), limit(5))
        );
        if (!snap.empty) {
          // Pick the highest-priority sponsor (lowest number wins)
          const list = snap.docs
            .map((d) => ({ id: d.id, ...(d.data() as any) }))
            .sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99));
          setSponsor(list[0]);
        }
      } catch { /* no sponsors collection yet — fine */ }
      setChecked(true);
    })();
  }, []);

  if (!checked) return null;

  // 1️⃣ Paid sponsor always wins
  if (sponsor) {
    return (
      <TouchableOpacity
        style={st.sponsorCard}
        activeOpacity={0.9}
        onPress={() => sponsor.link && Linking.openURL(sponsor.link).catch(() => {})}
      >
        {sponsor.imageUrl ? (
          <Image source={{ uri: sponsor.imageUrl }} style={st.sponsorImg} />
        ) : (
          <View style={st.sponsorIcon}>
            <Ionicons name="megaphone" size={18} color="#fff" />
          </View>
        )}
        <View style={{ flex: 1 }}>
          <Text style={st.sponsorName} numberOfLines={1}>{sponsor.name}</Text>
          {!!sponsor.tagline && (
            <Text style={st.sponsorTag} numberOfLines={1}>{sponsor.tagline}</Text>
          )}
        </View>
        <View style={st.sponsorBadge}><Text style={st.sponsorBadgeTxt}>SPONSORED</Text></View>
      </TouchableOpacity>
    );
  }

  // 2️⃣ Google AdMob banner (real builds only)
  if (BannerAd && !adFailed) {
    return (
      <View style={st.adWrap}>
        <BannerAd
          unitId={BANNER_AD_UNIT_ID}
          size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
          requestOptions={{ requestNonPersonalizedAdsOnly: true }}
          onAdFailedToLoad={() => setAdFailed(true)}
        />
      </View>
    );
  }

  // 3️⃣ Nothing to show (Expo Go with no sponsor) → render nothing, no crash.
  return null;
}

const st = StyleSheet.create({
  adWrap: { alignItems: "center", marginVertical: 8 },

  sponsorCard: {
    flexDirection: "row", alignItems: "center", gap: 10,
    backgroundColor: "#fff",
    marginHorizontal: 16, marginVertical: 8,
    padding: 12, borderRadius: 14,
    borderWidth: 1, borderColor: "#E5E7EB",
  },
  sponsorImg:  { width: 40, height: 40, borderRadius: 10, backgroundColor: "#F3F4F6" },
  sponsorIcon: {
    width: 40, height: 40, borderRadius: 10,
    backgroundColor: "#16A34A", alignItems: "center", justifyContent: "center",
  },
  sponsorName: { fontSize: 13.5, fontWeight: "800", color: "#0B1220" },
  sponsorTag:  { fontSize: 11.5, color: "#6B7280", marginTop: 1 },
  sponsorBadge: {
    backgroundColor: "#F3F4F6", borderRadius: 6,
    paddingHorizontal: 6, paddingVertical: 3,
  },
  sponsorBadgeTxt: { fontSize: 8.5, fontWeight: "800", color: "#9CA3AF", letterSpacing: 0.5 },
});
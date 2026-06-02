import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  ScrollView,
  SafeAreaView,
  StatusBar,
  Alert,
  Platform,
} from "react-native";
import { useEffect, useMemo, useState } from "react";
import { auth, db } from "../../firebaseConfig";
import {
  doc,
  getDoc,
  collection,
  query,
  where,
  getDocs,
  setDoc,
} from "firebase/firestore";
import { signOut, onAuthStateChanged } from "firebase/auth";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import { Share } from "react-native";

// ─── Helpers ──────────────────────────────────────────────────────────────────
const isToday    = (d: Date) => d?.toDateString() === new Date().toDateString();
const isUpcoming = (d: Date) => !!d && d > new Date() && !isToday(d);
const isPast     = (d: Date) => !!d && d < new Date() && !isToday(d);

const getAmount = (item: any) =>
  item.totalAmount ?? item.advanceAmount ?? item.price ?? 0;

const getSlotDisplay = (item: any): string => {
  if (Array.isArray(item.selectedSlots) && item.selectedSlots.length > 0) {
    return item.selectedSlots[0] +
      (item.selectedSlots.length > 1 ? ` +${item.selectedSlots.length - 1}` : "");
  }
  return item.slotTime || item.slot || "—";
};

const STATUS_CFG: Record<string, { color: string; bg: string }> = {
  confirmed: { color: "#059669", bg: "#ECFDF5" },
  cancelled: { color: "#DC2626", bg: "#FEF2F2" },
  completed: { color: "#6B7280", bg: "#F3F4F6" },
  pending:   { color: "#D97706", bg: "#FFFBEB" },
};
const getStatusCfg = (s: string) => STATUS_CFG[s] ?? STATUS_CFG.pending;

const initials = (name: string) =>
  name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);

const MENU_ITEMS = [
  { icon: "person-outline",      label: "Edit Profile",   sub: "Name, location and preferences",        route: "/settings/editProfile",  tab: false },
  { icon: "calendar-outline",    label: "My Bookings",    sub: "View all your bookings",                 route: "/(tabs)/booking-users",  tab: true  },
  { icon: "search-outline",      label: "Explore Venues", sub: "Find sports venues near you",            route: "/(tabs)/explore",        tab: true  },
  { icon: "help-circle-outline", label: "Help & Support", sub: "Contact us or get help & add Your-turf", route: "/support/user-support",  tab: false },
];

export default function Profile() {
  const [user,              setUser]              = useState<any>(null);
  const [userData,          setUserData]          = useState<any>(null);
  const [bookings,          setBookings]          = useState<any[]>([]);
  const [loading,           setLoading]           = useState(true);
  const [detectingLocation, setDetectingLocation] = useState(false);
  const [activityTab,       setActivityTab]       = useState<"today" | "upcoming" | "all">("today");

  const [shareLink, setShareLink] = useState<string>("");
  

  const router = useRouter();

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
  await Promise.all([fetchUser(u.uid), fetchBookings(u.uid), fetchAppConfig()]);
}
      setLoading(false);
    });
    return unsub;
  }, []);

  const fetchUser = async (uid: string) => {
    try {
      const snap = await getDoc(doc(db, "users", uid));
      if (snap.exists()) setUserData(snap.data());
    } catch (e) { console.error(e); }
  };

  const fetchBookings = async (uid: string) => {
    try {
      const q    = query(collection(db, "bookings"), where("userId", "==", uid));
      const snap = await getDocs(q);
      const data = snap.docs.map(d => {
        const raw = d.data();
        const bookingDate = raw.date?.toDate ? raw.date.toDate() : new Date(raw.date);
        return { id: d.id, ...raw, bookingDate };
      });
      setBookings(data);
    } catch (e) { console.error(e); }
  };

  const fetchAppConfig = async () => {
  try {
    const snap = await getDoc(doc(db, "appConfig", "general"));
    if (snap.exists()) {
      const rawLink = snap.data()?.shareLink || "";
      console.log("shareLink from Firestore:", rawLink); // ← add this
      setShareLink(rawLink.startsWith("http") ? rawLink : `https://${rawLink}`);
    } else {
      console.log("appConfig doc does not exist"); // ← add this
    }
  } catch (e) {
    console.error("fetchAppConfig error:", e); // ← add this
  }
};

const handleShare = async () => {
  const rawLink = shareLink || "https://playon.app";
  const link = rawLink.startsWith("http") ? rawLink : `https://${rawLink}`;

  const message = `*PlayOn — Book Sports Venues!*\n\nFind and book turfs, courts & more near you instantly.\n\n  Download now: ${link}`;

  try {
    await Share.share({
      message,
      title: "Play On — Book Sports Venues",
    });
  } catch (e) {
    Alert.alert("Error", "Unable to share right now.");
  }
};

  // ── Location detect ──────────────────────────────────────────────────────────
  const getLocation = async () => {
    if (!user) return;
    setDetectingLocation(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Permission denied", "Location permission was denied.");
        return;
      }
      const loc = await Location.getCurrentPositionAsync({});
      const geo = await Location.reverseGeocodeAsync({
        latitude:  loc.coords.latitude,
        longitude: loc.coords.longitude,
      });
      if (geo.length > 0) {
        const p    = geo[0];
        const city = p.city || p.subregion || p.region || "";
        const area = p.district || p.subregion || p.street || p.name || "";
        const full = [area, city].filter(Boolean).join(", ") || city || "Unknown";

        // ✅ FIX: save lat/lng so home screen can sort turfs by real distance
        await setDoc(doc(db, "users", user.uid), {
          location:  full,
          city,
          area,
          latitude:  loc.coords.latitude,
          longitude: loc.coords.longitude,
        }, { merge: true });

        setUserData((prev: any) => ({
          ...prev,
          location:  full,
          city,
          area,
          latitude:  loc.coords.latitude,
          longitude: loc.coords.longitude,
        }));
      }
    } catch (e) {
      Alert.alert("Error", "Unable to detect location.");
    } finally {
      setDetectingLocation(false);
    }
  };

  // ── Logout ───────────────────────────────────────────────────────────────────
  const handleLogout = () => {
    Alert.alert("Log out", "Are you sure you want to log out?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Log Out",
        style: "destructive",
        onPress: async () => {
          try {
            await signOut(auth);
            router.replace("/(auth)/login");
          } catch {
            Alert.alert("Error", "Unable to log out. Try again.");
          }
        },
      },
    ]);
  };

  const favoriteSport = useMemo(() => {
    if (userData?.favoriteSport) return userData.favoriteSport;
    const counts: Record<string, number> = {};
    bookings.forEach(b => {
      const s = b.sport || b.turfSport;
      if (s) counts[s] = (counts[s] || 0) + 1;
    });
    return Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] || "—";
  }, [bookings, userData]);

  const filteredActivity = useMemo(() => {
    const sorted = [...bookings].sort((a, b) => b.bookingDate - a.bookingDate);
    return sorted
      .map(b => {
        let derivedStatus = b.status ?? "pending";
        if (derivedStatus !== "cancelled" && isPast(b.bookingDate)) derivedStatus = "completed";
        return { ...b, derivedStatus };
      })
      .filter(b => {
        if (activityTab === "today")    return isToday(b.bookingDate)    && b.derivedStatus !== "cancelled";
        if (activityTab === "upcoming") return isUpcoming(b.bookingDate) && b.derivedStatus !== "cancelled";
        return true;
      });
  }, [bookings, activityTab]);

  if (loading) {
    return (
      <SafeAreaView style={s.center}>
        <StatusBar barStyle="light-content" backgroundColor="#0B1220" />
        <ActivityIndicator size="large" color="#0B1220" />
      </SafeAreaView>
    );
  }

  if (!user) {
    return (
      <SafeAreaView style={s.notLoggedIn}>
        <StatusBar barStyle="dark-content" backgroundColor="#F5F6FA" />
        <Ionicons name="person-circle-outline" size={72} color="#D1D5DB" />
        <Text style={s.notLoggedInTitle}>You're not logged in</Text>
        <Text style={s.notLoggedInSub}>Log in to view your profile and bookings.</Text>
        <TouchableOpacity style={s.loginBtn} onPress={() => router.replace("/(auth)/login")}>
          <Text style={s.loginBtnTxt}>Log In</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  const displayName     = userData?.name     || user.displayName || "User";
  const displayEmail    = userData?.email    || user.email       || "";
  const displayPhone    = userData?.phone    || "";
  const displayLocation = userData?.location ||
    [userData?.area, userData?.city].filter(Boolean).join(", ") ||
    "Add your location";

  const hasPhoto = !!userData?.photo;

  return (
    <SafeAreaView style={s.root}>
      <StatusBar barStyle="light-content" backgroundColor="#0B1220" />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.scroll}>

        {/* ── Hero ── */}
        <View style={s.hero}>
          <View style={s.heroTop}>
            <Text style={s.heroLabel}>Profile</Text>
            <TouchableOpacity
              style={s.editBtn}
              onPress={() => router.push("/settings/editProfile")}
              activeOpacity={0.8}
            >
              <Ionicons name="pencil-outline" size={14} color="#fff" />
              <Text style={s.editBtnTxt}>Edit</Text>
            </TouchableOpacity>
          </View>

          <View style={s.profileRow}>
            {hasPhoto ? (
              <Image source={{ uri: userData.photo }} style={s.avatar} />
            ) : (
              <View style={s.avatarFallback}>
                <Text style={s.avatarInitials}>{initials(displayName)}</Text>
              </View>
            )}

            <View style={s.profileInfo}>
              <Text style={s.name} numberOfLines={1}>{displayName}</Text>

              {!!displayEmail && (
                <View style={s.heroInfoRow}>
                  <Ionicons name="mail-outline" size={13} color="#94A3B8" />
                  <Text style={s.heroInfoTxt} numberOfLines={1}>{displayEmail}</Text>
                </View>
              )}

              {!!displayPhone && (
                <View style={s.heroInfoRow}>
                  <Ionicons name="call-outline" size={13} color="#94A3B8" />
                  <Text style={s.heroInfoTxt}>{displayPhone}</Text>
                </View>
              )}

              {/* ✅ Location pill — tap to re-detect and update coords */}
              <TouchableOpacity
                style={s.locPill}
                onPress={getLocation}
                disabled={detectingLocation}
                activeOpacity={0.8}
              >
                <Ionicons
                  name={detectingLocation ? "sync-outline" : "location-outline"}
                  size={13}
                  color="#94A3B8"
                />
                <Text style={s.locPillTxt} numberOfLines={1}>
                  {detectingLocation ? "Detecting…" : displayLocation}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {favoriteSport !== "—" && (
          <View style={s.sportRow}>
            <Ionicons name="trophy-outline" size={14} color="#D97706" />
            <Text style={s.sportTxt}>Favourite sport: <Text style={{ fontWeight: "700", color: "#0B1220" }}>{favoriteSport}</Text></Text>
          </View>
        )}

        {/* ── Quick Actions ── */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>Account</Text>
          <View style={s.menuList}>
            {MENU_ITEMS.map((item, i) => (
              <TouchableOpacity
                key={item.label}
                style={[
                  s.menuRow,
                  i === 0                      && s.menuRowFirst,
                  i === MENU_ITEMS.length - 1  && s.menuRowLast,
                ]}
                onPress={() => item.tab ? router.replace(item.route as any) : router.push(item.route as any)}
                activeOpacity={0.7}
              >
                <View style={s.menuIcon}>
                  <Ionicons name={item.icon as any} size={18} color="#0B1220" />
                </View>
                <View style={s.menuText}>
                  <Text style={s.menuLabel}>{item.label}</Text>
                  <Text style={s.menuSub}>{item.sub}</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color="#D1D5DB" />
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* ── Bookings shortcut ── */}
        <View style={s.bookingShortcut}>
          <View>
            <Text style={s.bookingShortcutTitle}>Your Bookings</Text>
            <Text style={s.bookingShortcutSub}>View upcoming and past bookings</Text>
          </View>
          <TouchableOpacity
            style={s.bookingShortcutBtn}
            onPress={() => router.replace("/(tabs)/booking-users")}
          >
            <Text style={s.bookingShortcutBtnTxt}>Open</Text>
          </TouchableOpacity>
        </View>

        {/* ── Share App ── */}
<TouchableOpacity
  style={s.shareBtn}
  onPress={handleShare}
  activeOpacity={0.8}
>
  <View style={s.shareBtnLeft}>
    <View style={s.shareIconWrap}>
      <Ionicons name="share-social-outline" size={20} color="#0B1220" />
    </View>
    <View>
      <Text style={s.shareBtnTitle}>Share Playon & Earn commission</Text>
      <Text style={s.shareBtnSub}>Invite friends to book sports venues</Text>
    </View>
  </View>
  <Ionicons name="chevron-forward" size={16} color="#D1D5DB" />
</TouchableOpacity>

        {/* ── Logout ── */}
        <TouchableOpacity style={s.logoutBtn} onPress={handleLogout} activeOpacity={0.8}>
          <Ionicons name="log-out-outline" size={18} color="#DC2626" />
          <Text style={s.logoutTxt}>Log Out</Text>
        </TouchableOpacity>

        <Text style={s.versionTxt}>Playon v1.0.1</Text>

      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const BRAND = "#0B1220";

const s = StyleSheet.create({
  root:   { flex: 1, backgroundColor: "#F5F6FA" },
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#fff" },
  scroll: { paddingBottom: 40 },

  notLoggedIn:      { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#F5F6FA", paddingHorizontal: 32 },
  notLoggedInTitle: { fontSize: 20, fontWeight: "800", color: BRAND, marginTop: 16 },
  notLoggedInSub:   { fontSize: 14, color: "#9CA3AF", textAlign: "center", marginTop: 6, lineHeight: 21 },
  loginBtn:         { marginTop: 24, backgroundColor: BRAND, paddingHorizontal: 32, paddingVertical: 13, borderRadius: 14 },
  loginBtnTxt:      { color: "#fff", fontWeight: "700", fontSize: 15 },

  hero: {
    backgroundColor: BRAND,
    paddingHorizontal: 20,
    paddingTop: Platform.OS === "android" ? (StatusBar.currentHeight ?? 0) + 14 : 16,
    paddingBottom: 28,
  },
  heroTop:    { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 20 },
  heroLabel:  { fontSize: 13, fontWeight: "700", color: "#94A3B8", textTransform: "uppercase", letterSpacing: 0.8 },
  editBtn:    { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "rgba(255,255,255,0.1)", borderWidth: 1, borderColor: "rgba(255,255,255,0.15)", paddingHorizontal: 14, paddingVertical: 7, borderRadius: 99 },
  editBtnTxt: { fontSize: 13, fontWeight: "700", color: "#fff" },

  profileRow:     { flexDirection: "row", alignItems: "flex-start", gap: 16 },
  avatar:         { width: 76, height: 76, borderRadius: 38, backgroundColor: "#1E293B", borderWidth: 2, borderColor: "rgba(255,255,255,0.15)" },
  avatarFallback: { width: 76, height: 76, borderRadius: 38, backgroundColor: "#1E3A5F", borderWidth: 2, borderColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" },
  avatarInitials: { fontSize: 24, fontWeight: "800", color: "#fff" },

  profileInfo: { flex: 1, paddingTop: 4 },
  name:        { fontSize: 22, fontWeight: "800", color: "#fff", letterSpacing: -0.3 },
  heroInfoRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 5 },
  heroInfoTxt: { fontSize: 13, color: "#94A3B8", flex: 1 },

  locPill:    { flexDirection: "row", alignItems: "center", gap: 5, alignSelf: "flex-start", marginTop: 10, backgroundColor: "rgba(255,255,255,0.08)", borderWidth: 1, borderColor: "rgba(255,255,255,0.1)", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 99 },
  locPillTxt: { fontSize: 12, color: "#94A3B8", fontWeight: "500", maxWidth: 160 },

  sportRow: { flexDirection: "row", alignItems: "center", gap: 6, marginHorizontal: 16, marginTop: 10, backgroundColor: "#FFFBEB", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: "#FDE68A" },
  sportTxt:  { fontSize: 13, color: "#92400E" },

  section:      { marginTop: 20, paddingHorizontal: 16 },
  sectionTitle: { fontSize: 16, fontWeight: "800", color: BRAND, marginBottom: 10 },

  menuList:     { backgroundColor: "#fff", borderRadius: 14, borderWidth: 1, borderColor: "#E5E7EB", overflow: "hidden" },
  menuRow:      { flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 13, borderTopWidth: 1, borderTopColor: "#F3F4F6", gap: 12 },
  menuRowFirst: { borderTopWidth: 0 },
  menuRowLast:  {},
  menuIcon:     { width: 36, height: 36, borderRadius: 10, backgroundColor: "#F5F6FA", alignItems: "center", justifyContent: "center" },
  menuText:     { flex: 1 },
  menuLabel:    { fontSize: 14, fontWeight: "700", color: BRAND },
  menuSub:      { fontSize: 12, color: "#9CA3AF", marginTop: 1 },

  activityHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  activityPills:  { flexDirection: "row", gap: 6 },
  pill:           { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 99, backgroundColor: "#F3F4F6" },
  pillActive:     { backgroundColor: BRAND },
  pillTxt:        { fontSize: 11, fontWeight: "700", color: "#6B7280" },
  pillTxtActive:  { color: "#fff" },

  activityCard:  { flexDirection: "row", alignItems: "center", backgroundColor: "#fff", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 8, borderWidth: 1, borderColor: "#F3F4F6" },
  activityName:  { fontSize: 14, fontWeight: "700", color: BRAND },
  activityMeta:  { fontSize: 12, color: "#9CA3AF", marginTop: 3 },
  statusBadge:   { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 99 },
  statusTxt:     { fontSize: 11, fontWeight: "700" },
  activityPrice: { fontSize: 14, fontWeight: "800", color: BRAND },

  emptyActivity:    { alignItems: "center", paddingVertical: 32 },
  emptyActivityTxt: { fontSize: 14, color: "#9CA3AF", marginTop: 10 },

  seeAll:    { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingVertical: 12 },
  seeAllTxt: { fontSize: 13, fontWeight: "700", color: BRAND },

  logoutBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginHorizontal: 16, marginTop: 24, paddingVertical: 13, borderRadius: 14, borderWidth: 1.5, borderColor: "#FECACA", backgroundColor: "#FEF2F2" },
  logoutTxt: { fontSize: 15, fontWeight: "700", color: "#DC2626" },

  versionTxt: { textAlign: "center", fontSize: 12, color: "#D1D5DB", marginTop: 16 },

  bookingShortcut:       { marginTop: 20, marginHorizontal: 16, backgroundColor: "#fff", borderRadius: 16, padding: 16, flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderWidth: 1, borderColor: "#E5E7EB" },
  bookingShortcutTitle:  { fontSize: 15, fontWeight: "800", color: BRAND },
  bookingShortcutSub:    { fontSize: 12, color: "#9CA3AF", marginTop: 4 },
  bookingShortcutBtn:    { backgroundColor: BRAND, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 10 },
  bookingShortcutBtnTxt: { color: "#fff", fontWeight: "700", fontSize: 13 },

  shareBtn: {
  marginTop: 16,
  marginHorizontal: 16,
  backgroundColor: "#fff",
  borderRadius: 16,
  padding: 14,
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
  borderWidth: 1,
  borderColor: "#E5E7EB",
},
shareBtnLeft: {
  flexDirection: "row",
  alignItems: "center",
  gap: 12,
  flex: 1,
},
shareIconWrap: {
  width: 42,
  height: 42,
  borderRadius: 12,
  backgroundColor: "#F0FDF4",
  borderWidth: 1,
  borderColor: "#BBF7D0",
  alignItems: "center",
  justifyContent: "center",
},
shareBtnTitle: {
  fontSize: 14,
  fontWeight: "800",
  color: "#0B1220",
},
shareBtnSub: {
  fontSize: 12,
  color: "#9CA3AF",
  marginTop: 2,
},
});
import {
  View, Text, StyleSheet, StatusBar, ScrollView,
  TouchableOpacity, TextInput, Alert, ActivityIndicator,
  RefreshControl, Image, Switch, Modal, FlatList, Platform,
  Linking,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { useEffect, useState } from "react";
import { db, auth } from "../../firebaseConfig";
import {
  collection, getDocs, deleteDoc, doc, addDoc, updateDoc, serverTimestamp,
} from "firebase/firestore";
import { signOut } from "firebase/auth";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

const DARK = "#0A0F1E";
const ACCENT = "#0EA5A4";

type Banner = {
  id: string;
  title?: string;
  subtitle?: string;
  image?: string;
  link?: string;
  active?: boolean;
};

export default function AdminSettings() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [banners, setBanners] = useState<Banner[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);

  const [title, setTitle] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [image, setImage] = useState("");
  const [link, setLink] = useState("");
  const [addMode, setAddMode] = useState(false);

  useEffect(() => { fetchBanners(); }, []);

  const fetchBanners = async (isRefresh = false) => {
    isRefresh ? setRefreshing(true) : setLoading(true);
    try {
      const snap = await getDocs(collection(db, "banners"));
      setBanners(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Banner)));
    } catch { Alert.alert("Error", "Could not load banners."); }
    finally { setLoading(false); setRefreshing(false); }
  };

  const handleAddBanner = async () => {
    if (!title.trim() || !image.trim()) return Alert.alert("Required", "Title and image URL are required.");
    setSaving(true);
    try {
      const ref = await addDoc(collection(db, "banners"), {
        title: title.trim(), subtitle: subtitle.trim(),
        image: image.trim(), link: link.trim(),
        active: true, createdAt: serverTimestamp(),
      });
      setBanners((prev) => [{ id: ref.id, title: title.trim(), subtitle: subtitle.trim(), image: image.trim(), link: link.trim(), active: true }, ...prev]);
      setTitle(""); setSubtitle(""); setImage(""); setLink("");
      setAddMode(false);
      Alert.alert("Banner Added", "The banner is now live in the app.");
    } catch { Alert.alert("Error", "Could not add banner."); }
    finally { setSaving(false); }
  };

  const toggleBanner = async (b: Banner) => {
    const next = !b.active;
    try {
      await updateDoc(doc(db, "banners", b.id), { active: next });
      setBanners((prev) => prev.map((x) => x.id === b.id ? { ...x, active: next } : x));
    } catch { Alert.alert("Error", "Could not update banner."); }
  };

  const deleteBanner = (b: Banner) => {
    Alert.alert("Delete Banner", `Delete "${b.title}"?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete", style: "destructive",
        onPress: async () => {
          try {
            await deleteDoc(doc(db, "banners", b.id));
            setBanners((prev) => prev.filter((x) => x.id !== b.id));
          } catch { Alert.alert("Error", "Could not delete banner."); }
        },
      },
    ]);
  };

  const handleLogout = () => {
    Alert.alert("Logout", "Are you sure?", [
      { text: "Cancel", style: "cancel" },
      { text: "Logout", style: "destructive", onPress: async () => { await signOut(auth); router.replace("/login"); } },
    ]);
  };

  return (
    <View style={s.safe}>
      <StatusBar barStyle="light-content" backgroundColor={DARK} />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={s.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => fetchBanners(true)} tintColor={ACCENT} />}
      >
        {/* Hero */}
         <View style={[s.hero, { paddingTop: insets.top + 12 }]}>
          <View style={s.heroGlow1} /><View style={s.heroGlow2} />
          <Text style={s.heroTag}>Admin Controls</Text>
          <Text style={s.heroTitle}>Settings</Text>
          <Text style={s.heroSub}>Manage banners, platform controls, and admin account.</Text>
        </View>

        {/* ── Banner Management ── */}
        <View style={s.section}>
          <View style={s.sectionHeader}>
            <View>
              <Text style={s.sectionTitle}>App Banners</Text>
              <Text style={s.sectionSub}>Banners shown on the explore screen to all users.</Text>
            </View>
            <TouchableOpacity style={s.sectionBtn} onPress={() => setAddMode((p) => !p)}>
              <Ionicons name={addMode ? "close" : "add"} size={18} color="#FFFFFF" />
              <Text style={s.sectionBtnText}>{addMode ? "Cancel" : "Add"}</Text>
            </TouchableOpacity>
          </View>

          {/* Add form */}
          {addMode && (
            <View style={s.formCard}>
              <Text style={s.formTitle}>New Banner</Text>
              {[
                { label: "Title *", value: title, setter: setTitle, placeholder: "e.g. Book Now — 20% Off" },
                { label: "Subtitle", value: subtitle, setter: setSubtitle, placeholder: "Short description" },
                { label: "Image URL *", value: image, setter: setImage, placeholder: "https://..." },
                { label: "Link (optional)", value: link, setter: setLink, placeholder: "https://..." },
              ].map(({ label, value, setter, placeholder }) => (
                <View key={label}>
                  <Text style={s.fieldLabel}>{label}</Text>
                  <TextInput style={s.input} placeholder={placeholder} placeholderTextColor="#9CA3AF" value={value} onChangeText={setter} autoCapitalize="none" />
                </View>
              ))}
              {image.trim() ? (
                <Image source={{ uri: image }} style={s.previewImage} resizeMode="cover" />
              ) : null}
              <TouchableOpacity style={[s.saveBtn, saving && { opacity: 0.6 }]} onPress={handleAddBanner} disabled={saving}>
                {saving ? <ActivityIndicator color="#FFFFFF" size="small" /> : (
                  <><Ionicons name="image-outline" size={18} color="#FFFFFF" /><Text style={s.saveBtnText}>Publish Banner</Text></>
                )}
              </TouchableOpacity>
            </View>
          )}

          {/* Banner list */}
          {loading ? (
            <View style={s.innerLoader}><ActivityIndicator color={ACCENT} /></View>
          ) : banners.length === 0 ? (
            <View style={s.emptyCard}>
              <Ionicons name="image-outline" size={32} color="#D1D5DB" />
              <Text style={s.emptyTitle}>No banners yet</Text>
              <Text style={s.emptySub}>Tap Add to create your first banner.</Text>
            </View>
          ) : banners.map((b) => (
            <View key={b.id} style={s.bannerCard}>
              {b.image ? <Image source={{ uri: b.image }} style={s.bannerImage} /> : null}
              <View style={s.bannerBody}>
                <View style={s.bannerTop}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.bannerTitle}>{b.title || "Untitled"}</Text>
                    {b.subtitle ? <Text style={s.bannerSub}>{b.subtitle}</Text> : null}
                    {b.link ? (
                      <TouchableOpacity onPress={() => Linking.openURL(b.link!.startsWith("http") ? b.link! : `https://${b.link}`)}>
                        <Text style={s.bannerLink} numberOfLines={1}>{b.link}</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                  <View style={[s.activePill, b.active ? s.pillOn : s.pillOff]}>
                    <Text style={[s.pillText, { color: b.active ? "#15803D" : "#6B7280" }]}>{b.active ? "Live" : "Off"}</Text>
                  </View>
                </View>
                <View style={s.bannerActions}>
                  <View style={s.bannerToggleRow}>
                    <Text style={s.bannerToggleLabel}>Show in app</Text>
                    <Switch value={b.active !== false} onValueChange={() => toggleBanner(b)} trackColor={{ false: "#E5E7EB", true: ACCENT }} thumbColor="#FFFFFF" />
                  </View>
                  <TouchableOpacity style={s.deleteBtn} onPress={() => deleteBanner(b)}>
                    <Ionicons name="trash-outline" size={15} color="#DC2626" />
                    <Text style={s.deleteBtnText}>Delete</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          ))}
        </View>

        {/* ── Platform quick links ── */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>Platform</Text>
          <Text style={s.sectionSub}>Quick access to management screens.</Text>
          {[
            { icon: "location-outline", title: "Add New Turf", desc: "Publish a new venue to the platform", route: "/admin/add-turf", color: ACCENT },
            { icon: "person-add-outline", title: "Create Owner Account", desc: "Onboard a new turf owner", route: "/admin/owners", color: "#7C3AED" },
            { icon: "receipt-outline", title: "All Bookings", desc: "Full booking history platform-wide", route: "/admin/bookings", color: "#0369A1" },
          ].map(({ icon, title, desc, route, color }) => (
            <TouchableOpacity key={title} style={s.linkCard} onPress={() => router.push(route as any)} activeOpacity={0.82}>
              <View style={[s.linkIcon, { backgroundColor: color + "15" }]}>
                <Ionicons name={icon as any} size={20} color={color} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.linkTitle}>{title}</Text>
                <Text style={s.linkDesc}>{desc}</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color="#9CA3AF" />
            </TouchableOpacity>
          ))}
        </View>

        {/* ── Danger zone ── */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>Account</Text>
          <TouchableOpacity style={s.logoutBtn} onPress={handleLogout} activeOpacity={0.85}>
            <Ionicons name="log-out-outline" size={18} color="#DC2626" />
            <Text style={s.logoutBtnText}>Logout from Admin</Text>
          </TouchableOpacity>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#F0F4F8" },
  scroll: { paddingBottom: 20 },

  hero: { backgroundColor: DARK, paddingHorizontal: 20, paddingBottom: 28, overflow: "hidden" },
  heroGlow1: { position: "absolute", top: -40, right: -40, width: 200, height: 200, borderRadius: 100, backgroundColor: "rgba(14,165,164,0.13)" },
  heroGlow2: { position: "absolute", bottom: -60, left: -40, width: 180, height: 180, borderRadius: 90, backgroundColor: "rgba(124,58,237,0.10)" },
  heroTag: { color: "#6EE7B7", fontSize: 11, fontWeight: "800", letterSpacing: 1.5, textTransform: "uppercase" },
  heroTitle: { color: "#FFFFFF", fontSize: 28, fontWeight: "900", marginTop: 4 },
  heroSub: { color: "#9CA3AF", fontSize: 13, lineHeight: 20, marginTop: 6 },

  section: { paddingHorizontal: 16, paddingTop: 24 },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 },
  sectionTitle: { fontSize: 18, fontWeight: "800", color: "#111827" },
  sectionSub: { fontSize: 13, color: "#9CA3AF", marginTop: 3, fontWeight: "500" },
  sectionBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: DARK, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 12 },
  sectionBtnText: { color: "#FFFFFF", fontSize: 13, fontWeight: "700" },

  formCard: { backgroundColor: "#FFFFFF", borderRadius: 18, padding: 16, marginBottom: 14, borderWidth: 1, borderColor: "#E5E7EB" },
  formTitle: { fontSize: 17, fontWeight: "800", color: "#111827", marginBottom: 4 },
  fieldLabel: { fontSize: 12, fontWeight: "700", color: "#374151", marginBottom: 6, marginTop: 12, textTransform: "uppercase", letterSpacing: 0.4 },
  input: { backgroundColor: "#F9FAFB", borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: "#111827" },
  previewImage: { width: "100%", height: 160, borderRadius: 12, marginTop: 12, backgroundColor: "#E5E7EB" },
  saveBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: DARK, paddingVertical: 14, borderRadius: 14, marginTop: 16 },
  saveBtnText: { color: "#FFFFFF", fontWeight: "800", fontSize: 14 },

  innerLoader: { paddingVertical: 32, alignItems: "center" },
  emptyCard: { backgroundColor: "#FFFFFF", borderRadius: 16, padding: 28, alignItems: "center", borderWidth: 1, borderColor: "#E5E7EB", marginBottom: 8 },
  emptyTitle: { fontSize: 16, fontWeight: "800", color: "#111827", marginTop: 10 },
  emptySub: { fontSize: 13, color: "#9CA3AF", marginTop: 4, textAlign: "center" },

  bannerCard: { backgroundColor: "#FFFFFF", borderRadius: 16, overflow: "hidden", marginBottom: 12, borderWidth: 1, borderColor: "#E5E7EB" },
  bannerImage: { width: "100%", height: 140, backgroundColor: "#E5E7EB" },
  bannerBody: { padding: 14 },
  bannerTop: { flexDirection: "row", alignItems: "flex-start", gap: 12, marginBottom: 12 },
  bannerTitle: { fontSize: 15, fontWeight: "800", color: "#111827" },
  bannerSub: { fontSize: 12, color: "#6B7280", marginTop: 3 },
  bannerLink: { fontSize: 11, color: "#2563EB", marginTop: 4, textDecorationLine: "underline" },
  activePill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  pillOn: { backgroundColor: "#DCFCE7" },
  pillOff: { backgroundColor: "#F3F4F6" },
  pillText: { fontSize: 11, fontWeight: "800" },
  bannerActions: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingTop: 12, borderTopWidth: 1, borderTopColor: "#F3F4F6" },
  bannerToggleRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  bannerToggleLabel: { fontSize: 13, color: "#374151", fontWeight: "600" },
  deleteBtn: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "#FEF2F2", paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10, borderWidth: 1, borderColor: "#FECACA" },
  deleteBtnText: { fontSize: 12, color: "#DC2626", fontWeight: "700" },

  linkCard: { backgroundColor: "#FFFFFF", borderRadius: 14, padding: 14, flexDirection: "row", alignItems: "center", gap: 14, marginBottom: 10, borderWidth: 1, borderColor: "#F3F4F6" },
  linkIcon: { width: 44, height: 44, borderRadius: 12, justifyContent: "center", alignItems: "center" },
  linkTitle: { fontSize: 14, fontWeight: "800", color: "#111827" },
  linkDesc: { fontSize: 12, color: "#6B7280", marginTop: 2, fontWeight: "500" },

  logoutBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, backgroundColor: "#FEF2F2", paddingVertical: 15, borderRadius: 16, borderWidth: 1, borderColor: "#FECACA" },
  logoutBtnText: { color: "#DC2626", fontWeight: "800", fontSize: 15 },
});
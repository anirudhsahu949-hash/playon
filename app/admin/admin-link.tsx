import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, Alert, ActivityIndicator,
   StatusBar, Platform,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useState, useEffect } from "react";
import { db } from "../../firebaseConfig";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";

const DARK  = "#0A0F1E";
const ACCENT = "#0EA5A4";

export default function AppConfig() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [shareLink, setShareLink] = useState("");
  const [loading,   setLoading]   = useState(true);
  const [saving,    setSaving]    = useState(false);
  const [shareImage, setShareImage] = useState("");

  useEffect(() => {
    const fetch = async () => {
      try {
        const snap = await getDoc(doc(db, "appConfig", "general"));
       if (snap.exists()) {
  setShareLink(snap.data()?.shareLink   || "");
  setShareImage(snap.data()?.shareImage || "");
}
      } catch (e) {
        Alert.alert("Error", "Could not load config.");
      } finally {
        setLoading(false);
      }
    };
    fetch();
  }, []);

  const handleSave = async () => {
    if (!shareLink.trim()) {
      Alert.alert("Required", "Please enter a share link.");
      return;
    }
    setSaving(true);
    try {
     await setDoc(doc(db, "appConfig", "general"), {
  shareLink:  shareLink.trim(),
  shareImage: shareImage.trim(),
  updatedAt:  new Date().toISOString(),
}, { merge: true });
      Alert.alert("Saved ✓", "Share link updated successfully.");
    } catch (e) {
      Alert.alert("Error", "Could not save config.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={s.safe}>
      <StatusBar barStyle="light-content" backgroundColor={DARK} />

      {/* Header */}
       <View style={[s.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity style={s.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={20} color="#fff" />
        </TouchableOpacity>
        <View>
          <Text style={s.headerTitle}>App Config</Text>
          <Text style={s.headerSub}>Manage app-wide settings</Text>
        </View>
      </View>

      {loading ? (
        <View style={s.center}>
          <ActivityIndicator size="large" color={ACCENT} />
        </View>
      ) : (
        <View style={s.body}>
          <View style={s.card}>
            <View style={s.cardHeader}>
              <View style={s.cardIconWrap}>
                <Ionicons name="share-social-outline" size={20} color={ACCENT} />
              </View>
              <View>
                <Text style={s.cardTitle}>Share Link</Text>
                <Text style={s.cardSub}>
                  Shown in the profile screen share button
                </Text>
              </View>
            </View>

            <Text style={s.fieldLabel}>App / Play Store Link</Text>
            <TextInput
              style={s.input}
              placeholder="https://play.google.com/store/apps/details?id=..."
              placeholderTextColor="#9CA3AF"
              value={shareLink}
              onChangeText={setShareLink}
              autoCapitalize="none"
              keyboardType="url"
              multiline
            />
            <Text style={s.hint}>
              Paste your Play Store, App Store, or website link here.
              Users will share this link when they tap "Share Playon" on the profile screen.
            </Text>

            {/* Preview */}
            {shareLink.trim().length > 0 && (
              <View style={s.preview}>
                <Ionicons name="eye-outline" size={14} color="#15803D" />
                <Text style={s.previewTxt} numberOfLines={2}>
                  {shareLink.trim()}
                </Text>
              </View>
            )}

            <Text style={[s.fieldLabel, { marginTop: 16 }]}>Share Image URL (optional)</Text>
<TextInput
  style={s.input}
  placeholder="https://your-image.com/banner.jpg"
  placeholderTextColor="#9CA3AF"
  value={shareImage}
  onChangeText={setShareImage}
  autoCapitalize="none"
  keyboardType="url"
/>
<Text style={s.hint}>
  WhatsApp will auto-preview this image when users share the app link.
  Use a public image URL (min 400×400px).
</Text>

            <TouchableOpacity
              style={[s.saveBtn, saving && { opacity: 0.6 }]}
              onPress={handleSave}
              disabled={saving}
            >
              {saving
                ? <ActivityIndicator color="#fff" />
                : <>
                    <Ionicons name="checkmark-circle-outline" size={18} color="#fff" />
                    <Text style={s.saveBtnTxt}>Save Link</Text>
                  </>
              }
            </TouchableOpacity>
          </View>

          {/* Info card */}
          <View style={s.infoCard}>
            <Ionicons name="information-circle-outline" size={16} color="#1D4ED8" />
            <Text style={s.infoTxt}>
              Until you publish on Play Store / App Store, you can use a website link,
              a WhatsApp group link, or any other URL. Update it anytime after publishing.
            </Text>
          </View>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: "#F0F4F8" },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  header: {
    backgroundColor: DARK,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingHorizontal: 16,
    
    paddingBottom: 18,
  },
  backBtn:    { width: 38, height: 38, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.08)", justifyContent: "center", alignItems: "center" },
  headerTitle:{ color: "#fff", fontSize: 18, fontWeight: "900" },
  headerSub:  { color: "#9CA3AF", fontSize: 12, marginTop: 2 },
  body:       { padding: 16 },
  card:       { backgroundColor: "#fff", borderRadius: 20, padding: 18, borderWidth: 1, borderColor: "#E5E7EB" },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 16 },
  cardIconWrap:{ width: 42, height: 42, borderRadius: 12, backgroundColor: "#F0FDFA", borderWidth: 1, borderColor: "#99F6E4", justifyContent: "center", alignItems: "center" },
  cardTitle:  { fontSize: 16, fontWeight: "800", color: "#111827" },
  cardSub:    { fontSize: 12, color: "#9CA3AF", marginTop: 2 },
  fieldLabel: { fontSize: 11, fontWeight: "800", color: "#374151", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 7 },
  input:      { backgroundColor: "#F9FAFB", borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: "#111827", minHeight: 52 },
  hint:       { fontSize: 11, color: "#9CA3AF", marginTop: 6, lineHeight: 17 },
  preview:    { flexDirection: "row", alignItems: "flex-start", gap: 6, backgroundColor: "#F0FDF4", borderRadius: 10, padding: 10, marginTop: 10, borderWidth: 1, borderColor: "#86EFAC" },
  previewTxt: { fontSize: 12, color: "#15803D", fontWeight: "600", flex: 1 },
  saveBtn:    { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: DARK, paddingVertical: 14, borderRadius: 14, marginTop: 16 },
  saveBtnTxt: { color: "#fff", fontWeight: "800", fontSize: 15 },
  infoCard:   { flexDirection: "row", alignItems: "flex-start", gap: 10, backgroundColor: "#EFF6FF", borderRadius: 14, padding: 14, marginTop: 14, borderWidth: 1, borderColor: "#BFDBFE" },
  infoTxt:    { fontSize: 12, color: "#1D4ED8", fontWeight: "600", flex: 1, lineHeight: 18 },
});
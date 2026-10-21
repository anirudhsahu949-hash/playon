import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  ScrollView,
  ActivityIndicator,
  Alert,
  Platform,
  KeyboardAvoidingView,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { useEffect, useRef, useState } from "react";
import { auth, db } from "../../firebaseConfig";
import { doc, getDoc, updateDoc } from "firebase/firestore";
import { getIdToken, signOut } from "firebase/auth";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

// ─── Brand ────────────────────────────────────────────────────────────────────
const BRAND = "#0B1220";

// ─── Backend ──────────────────────────────────────────────────────────────────
const SERVER_URL = "https://bookora-backend-95u4.onrender.com";

// ─── Avatar initials ──────────────────────────────────────────────────────────
const getInitials = (name: string) =>
  name
    .trim()
    .split(" ")
    .map(w => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2) || "?";

// ─── Field row component ──────────────────────────────────────────────────────
function Field({
  label,
  icon,
  value,
  onChangeText,
  placeholder,
  keyboardType = "default",
  autoCapitalize = "words",
  editable = true,
  multiline = false,
  hint,
}: {
  label: string;
  icon: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder: string;
  keyboardType?: any;
  autoCapitalize?: any;
  editable?: boolean;
  multiline?: boolean;
  hint?: string;
}) {
  const [focused, setFocused] = useState(false);
  const ref = useRef<TextInput>(null);

  return (
    <TouchableOpacity
      activeOpacity={editable ? 0.9 : 1}
      onPress={() => editable && ref.current?.focus()}
      style={[s.fieldWrap, focused && s.fieldWrapFocused, !editable && s.fieldWrapDisabled]}
    >
      <View style={s.fieldLeft}>
        <View style={s.fieldIconWrap}>
          <Ionicons name={icon as any} size={16} color={focused ? BRAND : "#9CA3AF"} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.fieldLabel}>{label}</Text>
          <TextInput
            ref={ref}
            value={value}
            onChangeText={onChangeText}
            placeholder={placeholder}
            placeholderTextColor="#C4C9D4"
            style={[s.fieldInput, multiline && s.fieldInputMulti]}
            keyboardType={keyboardType}
            autoCapitalize={autoCapitalize}
            editable={editable}
            multiline={multiline}
            numberOfLines={multiline ? 3 : 1}
            textAlignVertical={multiline ? "top" : "center"}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
          />
          {!!hint && <Text style={s.fieldHint}>{hint}</Text>}
        </View>
      </View>
      {!editable && (
        <Ionicons name="lock-closed-outline" size={14} color="#D1D5DB" />
      )}
    </TouchableOpacity>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────
export default function EditProfile() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [loading,  setLoading]  = useState(true);
  const [saving,   setSaving]   = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [name,     setName]     = useState("");
  const [phone,    setPhone]    = useState("");
  const [location, setLocation] = useState("");
  const [sport,    setSport]    = useState("");
  const [email,    setEmail]    = useState(""); // read-only — from Firebase Auth

  useEffect(() => { fetchUser(); }, []);

  const fetchUser = async () => {
    try {
      const user = auth.currentUser;
      if (!user) { setLoading(false); return; }

      // Pre-fill email from Auth (always accurate)
      setEmail(user.email ?? "");

      const snap = await getDoc(doc(db, "users", user.uid));
      if (snap.exists()) {
        const d = snap.data();
        setName(d.name         || "");
        setPhone(d.phone        || "");
        setLocation(d.location  || "");
        setSport(d.favoriteSport || "");
      }
    } catch (e) {
      console.error(e);
      Alert.alert("Error", "Could not load your profile.");
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    // ── Validation ────────────────────────────────────────────────────────────
    if (!name.trim()) {
      Alert.alert("Name required", "Please enter your full name.");
      return;
    }
    if (phone.trim() && !/^\+?[\d\s\-]{7,15}$/.test(phone.trim())) {
      Alert.alert("Invalid phone", "Please enter a valid phone number.");
      return;
    }

    const uid = auth.currentUser?.uid;
    if (!uid) { Alert.alert("Error", "Not logged in."); return; }

    try {
      setSaving(true);
      await updateDoc(doc(db, "users", uid), {
        name:          name.trim(),
        phone:         phone.trim(),
        location:      location.trim(),
        favoriteSport: sport.trim(),
      });

      Alert.alert("Saved ✅", "Your profile has been updated.", [
        { text: "OK", onPress: () => router.back() },
      ]);
    } catch (e) {
      console.error(e);
      Alert.alert("Error", "Failed to save. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  // ── Delete Account (Apple Guideline 5.1.1(v)) ──────────────────────────────
  const handleDeleteAccount = () => {
    Alert.alert(
      "Delete Account?",
      "This will permanently delete your account and profile. Your past booking records are kept for venue accounting.\n\nThis cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Delete My Account", style: "destructive", onPress: confirmDeleteAccount },
      ]
    );
  };

  const confirmDeleteAccount = async () => {
    try {
      const user = auth.currentUser;
      if (!user) { Alert.alert("Error", "Not logged in."); return; }

      setDeleting(true);

      // Get the token BEFORE deletion (account won't exist afterwards)
      const token = await getIdToken(user);

      const res = await fetch(`${SERVER_URL}/delete-my-account`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });

      let data: any = {};
      try { data = await res.json(); } catch {}

      if (!res.ok || !data.success) {
        throw new Error(data.error || "Could not delete account. Please try again.");
      }

      // Auth account is gone on the server — local signOut may throw, ignore it
      await signOut(auth).catch(() => {});

      Alert.alert("Account Deleted", "Your account has been permanently deleted.", [
        { text: "OK", onPress: () => router.replace("/(auth)/login") },
      ]);
    } catch (e: any) {
      Alert.alert("Error", e?.message || "Something went wrong. Please try again.");
    } finally {
      setDeleting(false);
    }
  };

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <SafeAreaView style={s.center}>
        <StatusBar barStyle="light-content" backgroundColor={BRAND} />
        <ActivityIndicator size="large" color={BRAND} />
      </SafeAreaView>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <View style={s.root}>
      <StatusBar barStyle="light-content" backgroundColor={BRAND} />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView keyboardDismissMode="interactive"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={s.scroll}
          keyboardShouldPersistTaps="handled"
        >
          {/* ── Header ──────────────────────────────────────────────────── */}
           <View style={[s.header, { paddingTop: insets.top + 12 }]}>
            {/* Back button */}
            <TouchableOpacity
              style={s.backBtn}
              onPress={() => router.back()}
              activeOpacity={0.7}
            >
              <Ionicons name="arrow-back" size={20} color="#fff" />
            </TouchableOpacity>

            <Text style={s.headerTitle}>Edit Profile</Text>
            <Text style={s.headerSub}>Update your personal details</Text>

            {/* Avatar preview */}
            <View style={s.avatarWrap}>
              <View style={s.avatar}>
                <Text style={s.avatarInitials}>{getInitials(name || "U")}</Text>
              </View>
              <View style={s.avatarBadge}>
                <Ionicons name="person" size={12} color="#fff" />
              </View>
            </View>

            {/* Live name preview under avatar */}
            <Text style={s.avatarName}>{name.trim() || "Your Name"}</Text>
            {!!email && <Text style={s.avatarEmail}>{email}</Text>}
          </View>

          {/* ── Form ────────────────────────────────────────────────────── */}
          <View style={s.formBlock}>
            <Text style={s.groupLabel}>Personal Info</Text>

            <Field
              label="Full Name"
              icon="person-outline"
              value={name}
              onChangeText={setName}
              placeholder="e.g. Rahul Sharma"
            />

            <Field
              label="Email"
              icon="mail-outline"
              value={email}
              onChangeText={() => {}}
              placeholder="—"
              keyboardType="email-address"
              autoCapitalize="none"
              editable={false}
              hint="Email cannot be changed here"
            />

            <Field
              label="Phone Number"
              icon="call-outline"
              value={phone}
              onChangeText={setPhone}
              placeholder="e.g. +91 98765 43210"
              keyboardType="phone-pad"
              autoCapitalize="none"
            />
          </View>

          <View style={s.formBlock}>
            <Text style={s.groupLabel}>Preferences</Text>

            <Field
              label="City / Location"
              icon="location-outline"
              value={location}
              onChangeText={setLocation}
              placeholder="e.g. Pune, Maharashtra"
            />

            <Field
              label="Favourite Sport"
              icon="trophy-outline"
              value={sport}
              onChangeText={setSport}
              placeholder="e.g. Cricket, Football…"
            />
          </View>

          {/* ── Buttons ─────────────────────────────────────────────────── */}
          <View style={s.btnGroup}>
            <TouchableOpacity
              style={[s.saveBtn, saving && s.saveBtnDisabled]}
              onPress={handleSave}
              disabled={saving}
              activeOpacity={0.85}
            >
              {saving ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <Ionicons name="checkmark-circle-outline" size={18} color="#fff" />
                  <Text style={s.saveBtnTxt}>Save Changes</Text>
                </>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={s.cancelBtn}
              onPress={() => router.back()}
              disabled={saving}
              activeOpacity={0.7}
            >
              <Text style={s.cancelBtnTxt}>Cancel</Text>
            </TouchableOpacity>
          </View>

          {/* ── Danger Zone ─────────────────────────────────────────────── */}
          <View style={s.dangerBlock}>
            <Text style={s.groupLabel}>Danger Zone</Text>

            <TouchableOpacity
              style={[s.deleteBtn, deleting && s.saveBtnDisabled]}
              onPress={handleDeleteAccount}
              disabled={deleting || saving}
              activeOpacity={0.85}
            >
              {deleting ? (
                <ActivityIndicator size="small" color="#DC2626" />
              ) : (
                <>
                  <Ionicons name="trash-outline" size={16} color="#DC2626" />
                  <Text style={s.deleteBtnTxt}>Delete Account</Text>
                </>
              )}
            </TouchableOpacity>

            <Text style={s.deleteHint}>
              Permanently deletes your account and profile. Booking history is kept for venue records.
            </Text>
          </View>

        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root:   { flex: 1, backgroundColor: "#F5F6FA" },
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#F5F6FA" },
  scroll: { paddingBottom: 48 },

  // Header
  header: {
    backgroundColor: BRAND,
    paddingHorizontal: 20,
    
    paddingBottom: 32,
    alignItems: "center",
  },
  backBtn: {
    position: "absolute",
    top: Platform.OS === "android" ? (StatusBar.currentHeight ?? 0) + 20 : 25,
    left: 16,
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "rgba(255,255,255,0.1)",
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: { fontSize: 18, fontWeight: "800", color: "#fff", marginTop: 6 },
  headerSub:   { fontSize: 13, color: "#94A3B8", marginTop: 3, marginBottom: 20 },

  // Avatar in header
  avatarWrap: { position: "relative" },
  avatar:     {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: "#1E3A5F",
    borderWidth: 3, borderColor: "rgba(255,255,255,0.2)",
    alignItems: "center", justifyContent: "center",
  },
  avatarInitials: { fontSize: 28, fontWeight: "800", color: "#fff" },
  avatarBadge: {
    position: "absolute", bottom: 0, right: 0,
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: "#3B82F6",
    alignItems: "center", justifyContent: "center",
    borderWidth: 2, borderColor: BRAND,
  },
  avatarName:  { fontSize: 18, fontWeight: "800", color: "#fff", marginTop: 10 },
  avatarEmail: { fontSize: 13, color: "#64748B", marginTop: 3 },

  // Form groups
  formBlock: {
    marginHorizontal: 16,
    marginTop: 20,
  },
  groupLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: "#9CA3AF",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 8,
    marginLeft: 4,
  },

  // Field
  fieldWrap: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 8,
  },
  fieldWrapFocused:  { borderColor: BRAND, borderWidth: 1.5 },
  fieldWrapDisabled: { backgroundColor: "#F9FAFB", opacity: 0.75 },
  fieldLeft:     { flex: 1, flexDirection: "row", alignItems: "flex-start", gap: 12 },
  fieldIconWrap: { width: 22, paddingTop: 2 },
  fieldLabel:    { fontSize: 11, fontWeight: "700", color: "#9CA3AF", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 },
  fieldInput:    { fontSize: 15, color: BRAND, fontWeight: "500", padding: 0 },
  fieldInputMulti: { minHeight: 72, lineHeight: 22 },
  fieldHint:     { fontSize: 11, color: "#9CA3AF", marginTop: 3 },

  // Buttons
  btnGroup: { marginHorizontal: 16, marginTop: 28, gap: 10 },
  saveBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: BRAND,
    paddingVertical: 15, borderRadius: 14,
  },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnTxt:      { fontSize: 15, fontWeight: "800", color: "#fff" },

  cancelBtn: {
    alignItems: "center", justifyContent: "center",
    paddingVertical: 13, borderRadius: 14,
    borderWidth: 1, borderColor: "#E5E7EB",
    backgroundColor: "#fff",
  },
  cancelBtnTxt: { fontSize: 15, fontWeight: "600", color: "#6B7280" },

  // Danger zone
  dangerBlock: { marginHorizontal: 16, marginTop: 32 },
  deleteBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    paddingVertical: 14, borderRadius: 14,
    borderWidth: 1, borderColor: "#FECACA",
    backgroundColor: "#FEF2F2",
  },
  deleteBtnTxt: { fontSize: 15, fontWeight: "700", color: "#DC2626" },
  deleteHint: {
    fontSize: 11, color: "#9CA3AF",
    textAlign: "center", marginTop: 8, lineHeight: 16, paddingHorizontal: 12,
  },
});
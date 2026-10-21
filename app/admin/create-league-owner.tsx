import {
  View,
  Text,
  TextInput,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  StatusBar,
  Platform,
  ActivityIndicator,
  Alert,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { useEffect, useState, useCallback } from "react";
import { db, auth } from "../../firebaseConfig";
import { collection, query, where, getDocs } from "firebase/firestore";
import { getIdToken } from "firebase/auth";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

// =======================================================
// 🏆 ADMIN — CREATE LEAGUE OWNER
// Admin-only screen. Creates a "league-owner" account via the
// /create-league-owner backend endpoint and lists existing ones.
// =======================================================
const SERVER_URL = "https://bookora-backend-95u4.onrender.com";
const DARK = "#0B1220";

type LeagueOwner = {
  id: string;
  name: string;
  email: string;
  phone?: string;
  city?: string;
  organizationName?: string;
};

const EMPTY_FORM = {
  name: "",
  email: "",
  phone: "",
  password: "",
  city: "",
  organizationName: "",
  // optional banking
  bankAccountNo: "",
  bankIfsc: "",
  bankName: "",
  bankUpi: "",
};

async function getAuthToken(): Promise<string | null> {
  try {
    const user = auth.currentUser;
    if (!user) return null;
    return await getIdToken(user);
  } catch {
    return null;
  }
}

function getInitials(name: string): string {
  if (!name) return "L";
  return name.trim().split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
}

export default function CreateLeagueOwner() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [form, setForm] = useState(EMPTY_FORM);
  const [showPassword, setShowPassword] = useState(false);
  const [showBank, setShowBank] = useState(false);
  const [saving, setSaving] = useState(false);

  const [owners, setOwners] = useState<LeagueOwner[]>([]);
  const [loadingList, setLoadingList] = useState(true);

  const setField = (key: keyof typeof EMPTY_FORM, value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  // ── Fetch existing league owners ──────────────────────────────────────────
  const fetchOwners = useCallback(async () => {
    try {
      const snap = await getDocs(
        query(collection(db, "users"), where("role", "==", "league-owner"))
      );
      const list: LeagueOwner[] = snap.docs.map((d) => {
        const u = d.data();
        return {
          id: d.id,
          name: u.name || "Unnamed",
          email: u.email || "",
          phone: u.phone || "",
          city: u.city || "",
          organizationName: u.organizationName || "",
        };
      });
      // newest-ish first by name fallback (no orderBy → no composite index needed)
      list.sort((a, b) => a.name.localeCompare(b.name));
      setOwners(list);
    } catch (e) {
      console.error("fetch league owners failed", e);
    } finally {
      setLoadingList(false);
    }
  }, []);

  useEffect(() => {
    fetchOwners();
  }, [fetchOwners]);

  // ── Submit ──────────────────────────────────────────────────────────────────
  const handleCreate = async () => {
    const name = form.name.trim();
    const email = form.email.trim();
    const city = form.city.trim();

    if (!name) return Alert.alert("Missing name", "Please enter the league owner's name.");
    if (!email) return Alert.alert("Missing email", "Please enter an email address.");
    if (form.password.length < 6)
      return Alert.alert("Weak password", "Password must be at least 6 characters.");
    if (!city) return Alert.alert("Missing city", "Please enter the city they'll host leagues in.");

    setSaving(true);
    try {
      const token = await getAuthToken();
      if (!token) {
        setSaving(false);
        return Alert.alert("Not signed in", "Your admin session expired. Please log in again.");
      }

      const res = await fetch(`${SERVER_URL}/create-league-owner`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name,
          email,
          phone: form.phone.trim(),
          password: form.password,
          city,
          organizationName: form.organizationName.trim(),
          // banking only if filled in
          bankAccountNo: form.bankAccountNo.trim() || undefined,
          bankIfsc: form.bankIfsc.trim() || undefined,
          bankName: form.bankName.trim() || undefined,
          bankUpi: form.bankUpi.trim() || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to create league owner.");
      }

      Alert.alert("League owner created", `${name} can now log in and host leagues.`);
      setForm(EMPTY_FORM);
      setShowBank(false);
      fetchOwners();
    } catch (e: any) {
      Alert.alert("Error", e.message || "Something went wrong.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={s.safe}>
      <StatusBar barStyle="light-content" backgroundColor={DARK} />

      {/* Hero */}
       <View style={[s.hero, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn} hitSlop={10}>
          <Ionicons name="chevron-back" size={22} color="#fff" />
        </TouchableOpacity>
        <Text style={s.heroTitle}>Create League Owner</Text>
        <Text style={s.heroSub}>
          A league owner can host and run leagues in their city — fixtures, teams, results.
        </Text>
      </View>

      <ScrollView
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 40 }}
      >
        {/* ── Form ── */}
        <View style={s.card}>
          <Field label="Full name *" value={form.name} onChange={(v) => setField("name", v)} placeholder="e.g. Rohan Patil" />
          <Field label="Email *" value={form.email} onChange={(v) => setField("email", v)} placeholder="owner@email.com" keyboardType="email-address" autoCapitalize="none" />
          <Field label="Phone" value={form.phone} onChange={(v) => setField("phone", v)} placeholder="10-digit number" keyboardType="phone-pad" />

          {/* Password with toggle */}
          <Text style={s.label}>Password *</Text>
          <View style={s.passRow}>
            <TextInput
              style={s.passInput}
              value={form.password}
              onChangeText={(v) => setField("password", v)}
              placeholder="At least 6 characters"
              placeholderTextColor="#9CA3AF"
              secureTextEntry={!showPassword}
              autoCapitalize="none"
            />
            <TouchableOpacity onPress={() => setShowPassword((p) => !p)} hitSlop={8}>
              <Ionicons name={showPassword ? "eye-off-outline" : "eye-outline"} size={20} color="#6B7280" />
            </TouchableOpacity>
          </View>

          <Field label="City *" value={form.city} onChange={(v) => setField("city", v)} placeholder="e.g. Amravati" />
          <Field label="Organization name" value={form.organizationName} onChange={(v) => setField("organizationName", v)} placeholder="Optional — e.g. City Sports Club" />
        </View>

        {/* ── Optional banking ── */}
        <TouchableOpacity style={s.bankToggle} onPress={() => setShowBank((b) => !b)} activeOpacity={0.7}>
          <Ionicons name="card-outline" size={18} color="#15803D" />
          <Text style={s.bankToggleTxt}>Bank details (optional — for entry-fee payouts later)</Text>
          <Ionicons name={showBank ? "chevron-up" : "chevron-down"} size={18} color="#6B7280" />
        </TouchableOpacity>

        {showBank && (
          <View style={s.card}>
            <Field label="Account number" value={form.bankAccountNo} onChange={(v) => setField("bankAccountNo", v)} placeholder="Bank account number" keyboardType="number-pad" />
            <Field label="IFSC" value={form.bankIfsc} onChange={(v) => setField("bankIfsc", v)} placeholder="e.g. SBIN0001234" autoCapitalize="characters" />
            <Field label="Account holder name" value={form.bankName} onChange={(v) => setField("bankName", v)} placeholder="As per bank records" />
            <Field label="UPI ID" value={form.bankUpi} onChange={(v) => setField("bankUpi", v)} placeholder="Optional — name@upi" autoCapitalize="none" />
          </View>
        )}

        {/* Create button */}
        <TouchableOpacity style={[s.createBtn, saving && { opacity: 0.6 }]} onPress={handleCreate} disabled={saving}>
          {saving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Ionicons name="add-circle-outline" size={20} color="#fff" />
              <Text style={s.createBtnTxt}>Create League Owner</Text>
            </>
          )}
        </TouchableOpacity>

        {/* ── Existing league owners ── */}
        <Text style={s.listHeading}>League owners ({owners.length})</Text>
        {loadingList ? (
          <ActivityIndicator color="#16A34A" style={{ marginTop: 16 }} />
        ) : owners.length === 0 ? (
          <Text style={s.listEmpty}>No league owners yet. Create the first one above.</Text>
        ) : (
          owners.map((o) => (
            <View key={o.id} style={s.ownerRow}>
              <View style={s.ownerAvatar}>
                <Text style={s.ownerAvatarTxt}>{getInitials(o.name)}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.ownerName}>{o.name}</Text>
                <Text style={s.ownerMeta} numberOfLines={1}>
                  {o.city ? `${o.city} · ` : ""}{o.email}
                </Text>
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

// ── Reusable labeled input ──────────────────────────────────────────────────
function Field({
  label, value, onChange, placeholder, keyboardType, autoCapitalize,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  keyboardType?: any;
  autoCapitalize?: any;
}) {
  return (
    <>
      <Text style={s.label}>{label}</Text>
      <TextInput
        style={s.input}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor="#9CA3AF"
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
      />
    </>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#F9FAFB" },
  hero: {
    backgroundColor: DARK,
    paddingHorizontal: 20,
    paddingBottom: 22,
  },
  backBtn: { marginBottom: 8, alignSelf: "flex-start" },
  heroTitle: { color: "#fff", fontSize: 22, fontWeight: "800" },
  heroSub: { color: "#9CA3AF", fontSize: 13, marginTop: 4, lineHeight: 18 },

  card: {
    backgroundColor: "#fff", marginHorizontal: 16, marginTop: 14,
    borderRadius: 14, padding: 16, borderColor: "#F3F4F6", borderWidth: 1,
  },
  label: { fontSize: 13, fontWeight: "600", color: "#374151", marginBottom: 6, marginTop: 12 },
  input: {
    borderColor: "#E5E7EB", borderWidth: 1, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: Platform.OS === "android" ? 8 : 12,
    fontSize: 14, color: "#111827", backgroundColor: "#fff",
  },
  passRow: {
    flexDirection: "row", alignItems: "center",
    borderColor: "#E5E7EB", borderWidth: 1, borderRadius: 10,
    paddingHorizontal: 12, backgroundColor: "#fff",
  },
  passInput: { flex: 1, fontSize: 14, color: "#111827", paddingVertical: Platform.OS === "android" ? 8 : 12 },

  bankToggle: {
    flexDirection: "row", alignItems: "center", gap: 8,
    marginHorizontal: 16, marginTop: 14, padding: 14,
    backgroundColor: "#F0FDF4", borderColor: "#BBF7D0", borderWidth: 1, borderRadius: 12,
  },
  bankToggleTxt: { flex: 1, fontSize: 13, fontWeight: "600", color: "#15803D" },

  createBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: "#16A34A", marginHorizontal: 16, marginTop: 18,
    paddingVertical: 15, borderRadius: 12,
  },
  createBtnTxt: { color: "#fff", fontSize: 15, fontWeight: "700" },

  listHeading: { fontSize: 15, fontWeight: "800", color: "#0B1220", marginHorizontal: 16, marginTop: 28, marginBottom: 8 },
  listEmpty: { fontSize: 13, color: "#9CA3AF", marginHorizontal: 16, marginTop: 4 },
  ownerRow: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: "#fff", marginHorizontal: 16, marginTop: 8,
    borderRadius: 12, padding: 12, borderColor: "#F3F4F6", borderWidth: 1,
  },
  ownerAvatar: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: "#16A34A",
    alignItems: "center", justifyContent: "center",
  },
  ownerAvatarTxt: { color: "#fff", fontWeight: "800", fontSize: 14 },
  ownerName: { fontSize: 14, fontWeight: "700", color: "#111827" },
  ownerMeta: { fontSize: 12, color: "#6B7280", marginTop: 2 },
});
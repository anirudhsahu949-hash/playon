import {
  View, Text, StyleSheet, SafeAreaView, StatusBar, FlatList,
  TouchableOpacity, TextInput, Alert, ActivityIndicator,
  RefreshControl, Modal, ScrollView, Switch, Platform,
  KeyboardAvoidingView,
} from "react-native";
import { useEffect, useMemo, useState } from "react";
import { db } from "../../firebaseConfig";
import {
  collection, getDocs, deleteDoc, doc, updateDoc,
  query, where,
} from "firebase/firestore";
import { Ionicons } from "@expo/vector-icons";

const DARK = "#0A0F1E";
const ACCENT = "#0EA5A4";
const SERVER_URL = "https://bookora-backend-95u4.onrender.com"; // ← update this

type Owner = {
  id: string;
  name?: string;
  email?: string;
  phone?: string;
  businessName?: string;
  location?: string;
  description?: string;
  status?: "active" | "inactive";
  role?: string;
};

const EMPTY_FORM = {
  name: "", email: "", phone: "", businessName: "",
  location: "", description: "", password: "",
  status: "active" as "active" | "inactive",
};

function avatarColor(name: string) {
  const colors = ["#0F766E", "#0369A1", "#7C3AED", "#B45309", "#BE185D", "#15803D"];
  let h = 0; for (const c of name) h += c.charCodeAt(0);
  return colors[h % colors.length];
}
function initials(name: string) {
  return name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
}

export default function AdminOwners() {
  const [owners, setOwners] = useState<Owner[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [modalVisible, setModalVisible] = useState(false);
  const [editing, setEditing] = useState<Owner | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [showPassword, setShowPassword] = useState(false);
  const [detailOwner, setDetailOwner] = useState<Owner | null>(null);

  useEffect(() => { fetchOwners(); }, []);

  const fetchOwners = async (isRefresh = false) => {
    isRefresh ? setRefreshing(true) : setLoading(true);
    try {
      const snap = await getDocs(query(collection(db, "users"), where("role", "==", "owner")));
      const data = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Owner))
        .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
      setOwners(data);
    } catch { Alert.alert("Error", "Could not load owners."); }
    finally { setLoading(false); setRefreshing(false); }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return owners;
    return owners.filter((o) =>
      [o.name, o.email, o.phone, o.businessName, o.location].some((f) => f?.toLowerCase().includes(q))
    );
  }, [owners, search]);

  const openCreate = () => { setEditing(null); setForm(EMPTY_FORM); setShowPassword(false); setModalVisible(true); };
  const openEdit = (o: Owner) => {
    setEditing(o);
    setForm({ name: o.name || "", email: o.email || "", phone: o.phone || "", businessName: o.businessName || "", location: o.location || "", description: o.description || "", password: "", status: o.status || "active" });
    setShowPassword(false);
    setModalVisible(true);
  };

  const validate = (): string | null => {
    if (!form.name.trim()) return "Name is required.";
    if (!form.email.trim() || !form.email.includes("@")) return "Valid email required.";
    if (!form.phone.trim() || form.phone.length < 10) return "Valid phone required.";
    if (!form.businessName.trim()) return "Business name required.";
    if (!editing && form.password.length < 6) return "Password must be 6+ characters.";
    return null;
  };

  const handleSave = async () => {
    const err = validate();
    if (err) return Alert.alert("Incomplete", err);
    setSaving(true);
    try {
      if (editing) {
        await updateDoc(doc(db, "users", editing.id), {
          name: form.name.trim(), phone: form.phone.trim(),
          businessName: form.businessName.trim(), location: form.location.trim(),
          description: form.description.trim(), status: form.status,
        });
        setOwners((prev) => prev.map((o) => o.id === editing.id ? { ...o, ...form } : o));
        Alert.alert("Updated", `${form.name} has been updated.`);
      } else {
        // Create via backend — creates Firebase Auth + Firestore doc
        const res = await fetch(`${SERVER_URL}/create-owner`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: form.name.trim(),
            email: form.email.trim().toLowerCase(),
            phone: form.phone.trim(),
            password: form.password,
            businessName: form.businessName.trim(),
            location: form.location.trim(),
            description: form.description.trim(),
            role: "owner",
            status: "active",
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to create owner");
        Alert.alert("Owner Created ✓", `${form.name} can now log in with:\n\nEmail: ${form.email}\nPassword: ${form.password}`);
        fetchOwners();
      }
      setModalVisible(false);
    } catch (e: any) {
      Alert.alert("Error", e.message || "Something went wrong.");
    } finally { setSaving(false); }
  };

  const toggleStatus = async (o: Owner) => {
    const next = o.status === "active" ? "inactive" : "active";
    try {
      await updateDoc(doc(db, "users", o.id), { status: next });
      setOwners((prev) => prev.map((x) => x.id === o.id ? { ...x, status: next } : x));
      if (detailOwner?.id === o.id) setDetailOwner((d) => d ? { ...d, status: next } : null);
    } catch { Alert.alert("Error", "Could not update status."); }
  };

const handleDelete = (o: Owner) => {
  Alert.alert("Delete Owner", `Delete ${o.name}? This cannot be undone.`, [
    { text: "Cancel", style: "cancel" },
    {
      text: "Delete", style: "destructive",
      onPress: async () => {
        try {
          const res = await fetch(`${SERVER_URL}/delete-owner/${o.id}`, {
            method: "DELETE",
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "Failed");
          setOwners((prev) => prev.filter((x) => x.id !== o.id));
          if (detailOwner?.id === o.id) setDetailOwner(null);
        } catch (e: any) {
          Alert.alert("Error", e.message);
        }
      },
    },
  ]);
};

  const renderOwner = ({ item }: { item: Owner }) => {
    const color = avatarColor(item.name || "?");
    const isActive = item.status !== "inactive";
    return (
      <TouchableOpacity style={s.card} onPress={() => setDetailOwner(item)} activeOpacity={0.85}>
        <View style={[s.cardBar, { backgroundColor: isActive ? ACCENT : "#9CA3AF" }]} />
        <View style={s.cardInner}>
          <View style={s.cardTop}>
            <View style={[s.avatar, { backgroundColor: color }]}>
              <Text style={s.avatarText}>{initials(item.name || "?")}</Text>
            </View>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <View style={s.nameRow}>
                <Text style={s.ownerName} numberOfLines={1}>{item.name || "No name"}</Text>
                <View style={[s.statusPill, isActive ? s.pillActive : s.pillInactive]}>
                  <View style={[s.statusDot, { backgroundColor: isActive ? "#22C55E" : "#9CA3AF" }]} />
                  <Text style={[s.statusText, { color: isActive ? "#15803D" : "#6B7280" }]}>
                    {isActive ? "Active" : "Inactive"}
                  </Text>
                </View>
              </View>
              <Text style={s.businessName}>{item.businessName || "No business name"}</Text>
              <Text style={s.emailText} numberOfLines={1}>{item.email}</Text>
            </View>
          </View>
          <View style={s.chipRow}>
            <View style={s.infoChip}><Ionicons name="call-outline" size={11} color="#6B7280" /><Text style={s.chipText}>{item.phone || "No phone"}</Text></View>
            {item.location ? <View style={s.infoChip}><Ionicons name="location-outline" size={11} color="#6B7280" /><Text style={s.chipText}>{item.location}</Text></View> : null}
          </View>
          <View style={s.cardActions}>
            <TouchableOpacity style={s.actionBtn} onPress={() => openEdit(item)}>
              <Ionicons name="pencil-outline" size={13} color="#374151" /><Text style={s.actionBtnText}>Edit</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.actionBtn, isActive ? s.actionDeactivate : s.actionActivate]} onPress={() => toggleStatus(item)}>
              <Ionicons name={isActive ? "pause-circle-outline" : "play-circle-outline"} size={13} color={isActive ? "#B45309" : "#0F766E"} />
              <Text style={[s.actionBtnText, { color: isActive ? "#B45309" : "#0F766E" }]}>{isActive ? "Disable" : "Enable"}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.actionBtn, s.actionDelete]} onPress={() => handleDelete(item)}>
              <Ionicons name="trash-outline" size={13} color="#DC2626" /><Text style={[s.actionBtnText, { color: "#DC2626" }]}>Delete</Text>
            </TouchableOpacity>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  if (loading) return (
    <SafeAreaView style={s.loadWrap}>
      <StatusBar barStyle="light-content" backgroundColor={DARK} />
      <ActivityIndicator size="large" color={ACCENT} />
      <Text style={s.loadText}>Loading owners...</Text>
    </SafeAreaView>
  );

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="light-content" backgroundColor={DARK} />
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        renderItem={renderOwner}
        contentContainerStyle={s.list}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => fetchOwners(true)} tintColor={ACCENT} />}
        ListHeaderComponent={
          <View>
            <View style={s.hero}>
              <View style={s.heroGlow1} /><View style={s.heroGlow2} />
              <Text style={s.heroTag}>Owner Management</Text>
              <Text style={s.heroTitle}>Owners</Text>
              <Text style={s.heroSub}>Create and manage all turf owner accounts on the platform.</Text>
              <View style={s.heroStats}>
                {[
                  { label: "Total", value: owners.length, color: "#60A5FA" },
                  { label: "Active", value: owners.filter((o) => o.status !== "inactive").length, color: "#34D399" },
                  { label: "Inactive", value: owners.filter((o) => o.status === "inactive").length, color: "#9CA3AF" },
                ].map((st) => (
                  <View key={st.label} style={s.heroStat}>
                    <Text style={[s.heroStatValue, { color: st.color }]}>{st.value}</Text>
                    <Text style={s.heroStatLabel}>{st.label}</Text>
                  </View>
                ))}
              </View>
            </View>
            <View style={s.toolbar}>
              <View style={s.searchWrap}>
                <Ionicons name="search-outline" size={16} color="#9CA3AF" style={{ marginRight: 8 }} />
                <TextInput style={s.searchInput} placeholder="Search owners..." placeholderTextColor="#9CA3AF" value={search} onChangeText={setSearch} />
              </View>
              <TouchableOpacity style={s.addBtn} onPress={openCreate}>
                <Ionicons name="add" size={20} color="#FFFFFF" />
              </TouchableOpacity>
            </View>
            <Text style={s.sectionLabel}>{filtered.length} owner{filtered.length !== 1 ? "s" : ""}</Text>
          </View>
        }
        ListEmptyComponent={
          <View style={s.empty}>
            <Ionicons name="people-outline" size={40} color="#D1D5DB" />
            <Text style={s.emptyTitle}>No owners yet</Text>
            <Text style={s.emptySub}>Create your first turf owner account.</Text>
            <TouchableOpacity style={s.emptyBtn} onPress={openCreate}>
              <Text style={s.emptyBtnText}>Create Owner</Text>
            </TouchableOpacity>
          </View>
        }
      />

      <TouchableOpacity style={s.fab} onPress={openCreate}>
        <Ionicons name="add" size={26} color="#FFFFFF" />
      </TouchableOpacity>

      {/* Create / Edit Modal */}
      <Modal visible={modalVisible} animationType="slide" transparent>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={s.modalBackdrop}>
            <View style={s.modalSheet}>
              <View style={s.sheetHandle} />
              <ScrollView showsVerticalScrollIndicator={false}>
                <View style={s.modalHeader}>
                  <View>
                    <Text style={s.modalTitle}>{editing ? "Edit Owner" : "Create Owner"}</Text>
                    <Text style={s.modalSub}>{editing ? "Update owner details." : "A login account will be created automatically."}</Text>
                  </View>
                  <TouchableOpacity style={s.closeBtn} onPress={() => setModalVisible(false)}>
                    <Ionicons name="close" size={20} color="#374151" />
                  </TouchableOpacity>
                </View>

                {[
                  { label: "Full Name *", key: "name", placeholder: "Owner's full name" },
                  { label: "Business Name *", key: "businessName", placeholder: "e.g. Sports Arena Pvt Ltd" },
                  { label: "Email *", key: "email", placeholder: "owner@email.com", caps: false, disabled: !!editing },
                  { label: "Phone *", key: "phone", placeholder: "10-digit mobile", numeric: true },
                  { label: "Location", key: "location", placeholder: "City or area" },
                  { label: "Business Description", key: "description", placeholder: "Brief about the turf business" },
                ].map(({ label, key, placeholder, caps, numeric, disabled }) => (
                  <View key={key}>
                    <Text style={s.fieldLabel}>{label}</Text>
                    <TextInput
                      style={[s.input, disabled && s.inputDisabled]}
                      placeholder={placeholder} placeholderTextColor="#9CA3AF"
                      value={(form as any)[key]}
                      onChangeText={(v) => setForm((f) => ({ ...f, [key]: v }))}
                      autoCapitalize={caps === false ? "none" : "words"}
                      keyboardType={numeric ? "phone-pad" : "default"}
                      editable={!disabled}
                    />
                    {disabled && <Text style={s.disabledHint}>Email cannot be changed after creation.</Text>}
                  </View>
                ))}

                {!editing && (
                  <>
                    <Text style={s.fieldLabel}>Temporary Password *</Text>
                    <View style={s.pwRow}>
                      <TextInput
                        style={[s.input, { flex: 1 }]} placeholder="Min. 6 characters"
                        placeholderTextColor="#9CA3AF" value={form.password}
                        onChangeText={(v) => setForm((f) => ({ ...f, password: v }))}
                        secureTextEntry={!showPassword} autoCapitalize="none"
                      />
                      <TouchableOpacity style={s.eyeBtn} onPress={() => setShowPassword((p) => !p)}>
                        <Ionicons name={showPassword ? "eye-off-outline" : "eye-outline"} size={18} color="#6B7280" />
                      </TouchableOpacity>
                    </View>
                    <Text style={s.disabledHint}>Share this password with the owner after creation.</Text>
                  </>
                )}

                {editing && (
                  <View style={s.toggleRow}>
                    <View>
                      <Text style={s.toggleLabel}>Account active</Text>
                      <Text style={s.toggleSub}>{form.status === "active" ? "Owner can log in." : "Owner login is blocked."}</Text>
                    </View>
                    <Switch
                      value={form.status === "active"}
                      onValueChange={(v) => setForm((f) => ({ ...f, status: v ? "active" : "inactive" }))}
                      trackColor={{ false: "#E5E7EB", true: ACCENT }}
                      thumbColor="#FFFFFF"
                    />
                  </View>
                )}

                <TouchableOpacity style={[s.saveBtn, saving && { opacity: 0.6 }]} onPress={handleSave} disabled={saving}>
                  {saving ? <ActivityIndicator color="#FFFFFF" /> : (
                    <>
                      <Ionicons name={editing ? "checkmark-circle-outline" : "person-add-outline"} size={18} color="#FFFFFF" />
                      <Text style={s.saveBtnText}>{editing ? "Save Changes" : "Create Owner"}</Text>
                    </>
                  )}
                </TouchableOpacity>
                <TouchableOpacity style={s.cancelBtn} onPress={() => setModalVisible(false)} disabled={saving}>
                  <Text style={s.cancelBtnText}>Cancel</Text>
                </TouchableOpacity>
                <View style={{ height: 24 }} />
              </ScrollView>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Detail Sheet */}
      <Modal visible={!!detailOwner} animationType="slide" transparent>
        <View style={s.modalBackdrop}>
          <View style={s.modalSheet}>
            <View style={s.sheetHandle} />
            {detailOwner && (
              <ScrollView showsVerticalScrollIndicator={false}>
                <View style={s.detailHeader}>
                  <View style={[s.detailAvatar, { backgroundColor: avatarColor(detailOwner.name || "?") }]}>
                    <Text style={s.detailAvatarText}>{initials(detailOwner.name || "?")}</Text>
                  </View>
                  <View style={{ marginLeft: 14, flex: 1 }}>
                    <Text style={s.detailName}>{detailOwner.name}</Text>
                    <Text style={s.detailBusiness}>{detailOwner.businessName}</Text>
                    <View style={[s.statusPill, detailOwner.status !== "inactive" ? s.pillActive : s.pillInactive, { alignSelf: "flex-start", marginTop: 6 }]}>
                      <View style={[s.statusDot, { backgroundColor: detailOwner.status !== "inactive" ? "#22C55E" : "#9CA3AF" }]} />
                      <Text style={[s.statusText, { color: detailOwner.status !== "inactive" ? "#15803D" : "#6B7280" }]}>
                        {detailOwner.status !== "inactive" ? "Active" : "Inactive"}
                      </Text>
                    </View>
                  </View>
                </View>
                {[
                  { icon: "mail-outline", label: "Email", value: detailOwner.email },
                  { icon: "call-outline", label: "Phone", value: detailOwner.phone || "Not added" },
                  { icon: "location-outline", label: "Location", value: detailOwner.location || "Not added" },
                  { icon: "document-text-outline", label: "Description", value: detailOwner.description || "Not added" },
                ].map((row) => (
                  <View key={row.label} style={s.detailRow}>
                    <View style={s.detailIconWrap}><Ionicons name={row.icon as any} size={16} color="#6B7280" /></View>
                    <View><Text style={s.detailLabel}>{row.label}</Text><Text style={s.detailValue}>{row.value}</Text></View>
                  </View>
                ))}
                <TouchableOpacity style={s.saveBtn} onPress={() => { setDetailOwner(null); openEdit(detailOwner); }}>
                  <Ionicons name="pencil-outline" size={18} color="#FFFFFF" />
                  <Text style={s.saveBtnText}>Edit Owner</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[s.cancelBtn, { marginTop: 10 }]} onPress={() => toggleStatus(detailOwner)}>
                  <Text style={[s.cancelBtnText, { color: "#B45309" }]}>
                    {detailOwner.status !== "inactive" ? "Disable Account" : "Enable Account"}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity style={[s.cancelBtn, { marginTop: 10, backgroundColor: "#FEF2F2" }]} onPress={() => { setDetailOwner(null); handleDelete(detailOwner); }}>
                  <Text style={[s.cancelBtnText, { color: "#DC2626" }]}>Delete Owner</Text>
                </TouchableOpacity>
                <View style={{ height: 24 }} />
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#F0F4F8" },
  loadWrap: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: DARK },
  loadText: { marginTop: 12, color: "#9CA3AF", fontSize: 15, fontWeight: "600" },
  list: { paddingBottom: 100 },

  hero: { backgroundColor: DARK, paddingHorizontal: 20, paddingTop: Platform.OS === "android" ? (StatusBar.currentHeight || 0) + 14 : 18, paddingBottom: 24, overflow: "hidden" },
  heroGlow1: { position: "absolute", top: -40, right: -40, width: 200, height: 200, borderRadius: 100, backgroundColor: "rgba(124,58,237,0.14)" },
  heroGlow2: { position: "absolute", bottom: -60, left: -40, width: 180, height: 180, borderRadius: 90, backgroundColor: "rgba(14,165,164,0.10)" },
  heroTag: { color: "#C4B5FD", fontSize: 11, fontWeight: "800", letterSpacing: 1.5, textTransform: "uppercase" },
  heroTitle: { color: "#FFFFFF", fontSize: 28, fontWeight: "900", marginTop: 4 },
  heroSub: { color: "#9CA3AF", fontSize: 13, lineHeight: 20, marginTop: 6 },
  heroStats: { flexDirection: "row", gap: 10, marginTop: 18 },
  heroStat: { backgroundColor: "rgba(255,255,255,0.07)", borderRadius: 14, paddingHorizontal: 18, paddingVertical: 12, alignItems: "center", borderWidth: 1, borderColor: "rgba(255,255,255,0.08)" },
  heroStatValue: { fontSize: 20, fontWeight: "900" },
  heroStatLabel: { color: "#9CA3AF", fontSize: 11, fontWeight: "600", marginTop: 2 },

  toolbar: { flexDirection: "row", gap: 10, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 4 },
  searchWrap: { flex: 1, flexDirection: "row", alignItems: "center", backgroundColor: "#FFFFFF", borderRadius: 14, paddingHorizontal: 14, borderWidth: 1, borderColor: "#E5E7EB" },
  searchInput: { flex: 1, paddingVertical: 12, fontSize: 14, color: "#111827" },
  addBtn: { backgroundColor: DARK, width: 46, height: 46, borderRadius: 14, justifyContent: "center", alignItems: "center" },
  sectionLabel: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8, fontSize: 13, color: "#9CA3AF", fontWeight: "700" },

  card: { backgroundColor: "#FFFFFF", marginHorizontal: 16, marginBottom: 12, borderRadius: 18, flexDirection: "row", overflow: "hidden", borderWidth: 1, borderColor: "#E5E7EB", shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 6, elevation: 2 },
  cardBar: { width: 4 },
  cardInner: { flex: 1, padding: 14 },
  cardTop: { flexDirection: "row", alignItems: "center" },
  avatar: { width: 44, height: 44, borderRadius: 22, justifyContent: "center", alignItems: "center" },
  avatarText: { color: "#FFFFFF", fontSize: 16, fontWeight: "800" },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  ownerName: { fontSize: 16, fontWeight: "800", color: "#111827", flex: 1 },
  businessName: { fontSize: 12, color: "#6B7280", marginTop: 2, fontWeight: "600" },
  emailText: { fontSize: 11, color: "#9CA3AF", marginTop: 2 },
  statusPill: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  pillActive: { backgroundColor: "#DCFCE7" },
  pillInactive: { backgroundColor: "#F3F4F6" },
  statusDot: { width: 5, height: 5, borderRadius: 3 },
  statusText: { fontSize: 10, fontWeight: "800" },
  chipRow: { flexDirection: "row", gap: 8, marginTop: 10, flexWrap: "wrap" },
  infoChip: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#F9FAFB", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5, borderWidth: 1, borderColor: "#F3F4F6" },
  chipText: { fontSize: 11, color: "#374151", fontWeight: "600" },
  cardActions: { flexDirection: "row", gap: 8, marginTop: 12 },
  actionBtn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#F3F4F6", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7 },
  actionBtnText: { fontSize: 11, fontWeight: "700", color: "#374151" },
  actionDeactivate: { backgroundColor: "#FFFBEB" },
  actionActivate: { backgroundColor: "#F0FDFA" },
  actionDelete: { backgroundColor: "#FEF2F2" },

  fab: { position: "absolute", bottom: 32, right: 20, backgroundColor: DARK, width: 56, height: 56, borderRadius: 28, justifyContent: "center", alignItems: "center", shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 12, elevation: 8 },

  empty: { margin: 16, backgroundColor: "#FFFFFF", borderRadius: 20, padding: 32, alignItems: "center", borderWidth: 1, borderColor: "#E5E7EB" },
  emptyTitle: { fontSize: 18, fontWeight: "800", color: "#111827", marginTop: 12 },
  emptySub: { fontSize: 13, color: "#9CA3AF", marginTop: 6, textAlign: "center" },
  emptyBtn: { marginTop: 16, backgroundColor: DARK, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12 },
  emptyBtnText: { color: "#FFFFFF", fontWeight: "700", fontSize: 14 },

  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  modalSheet: { backgroundColor: "#FFFFFF", borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 20, paddingTop: 12, paddingBottom: Platform.OS === "ios" ? 34 : 20, maxHeight: "94%" },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: "#E5E7EB", alignSelf: "center", marginBottom: 16 },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 },
  modalTitle: { fontSize: 22, fontWeight: "900", color: "#111827" },
  modalSub: { fontSize: 13, color: "#6B7280", marginTop: 4 },
  closeBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: "#F3F4F6", justifyContent: "center", alignItems: "center" },
  fieldLabel: { fontSize: 12, fontWeight: "700", color: "#374151", marginBottom: 6, marginTop: 14, textTransform: "uppercase", letterSpacing: 0.4 },
  input: { backgroundColor: "#F9FAFB", borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: "#111827" },
  inputDisabled: { backgroundColor: "#F3F4F6", opacity: 0.7 },
  disabledHint: { fontSize: 11, color: "#9CA3AF", marginTop: 5 },
  pwRow: { flexDirection: "row", gap: 10, alignItems: "center" },
  eyeBtn: { padding: 6 },
  toggleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: "#F9FAFB", borderRadius: 14, padding: 14, marginTop: 16, borderWidth: 1, borderColor: "#E5E7EB" },
  toggleLabel: { fontSize: 15, fontWeight: "700", color: "#111827" },
  toggleSub: { fontSize: 12, color: "#9CA3AF", marginTop: 2 },
  saveBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: DARK, paddingVertical: 15, borderRadius: 16, marginTop: 24 },
  saveBtnText: { color: "#FFFFFF", fontWeight: "800", fontSize: 15 },
  cancelBtn: { backgroundColor: "#F3F4F6", paddingVertical: 15, borderRadius: 16, alignItems: "center", marginTop: 10 },
  cancelBtnText: { color: "#374151", fontWeight: "700", fontSize: 15 },

  detailHeader: { flexDirection: "row", alignItems: "center", marginBottom: 20 },
  detailAvatar: { width: 60, height: 60, borderRadius: 30, justifyContent: "center", alignItems: "center" },
  detailAvatarText: { color: "#FFFFFF", fontSize: 22, fontWeight: "900" },
  detailName: { fontSize: 20, fontWeight: "900", color: "#111827" },
  detailBusiness: { fontSize: 13, color: "#6B7280", marginTop: 2 },
  detailRow: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#F9FAFB", borderRadius: 12, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: "#F3F4F6" },
  detailIconWrap: { width: 34, height: 34, borderRadius: 10, backgroundColor: "#F3F4F6", justifyContent: "center", alignItems: "center" },
  detailLabel: { fontSize: 10, color: "#9CA3AF", fontWeight: "700", textTransform: "uppercase" },
  detailValue: { fontSize: 14, color: "#111827", fontWeight: "600", marginTop: 2 },
});
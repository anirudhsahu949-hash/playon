import {
  View, Text, StyleSheet, SafeAreaView, StatusBar, FlatList,
  TouchableOpacity, TextInput, Alert, ActivityIndicator,
  RefreshControl, Modal, ScrollView, Image, Switch, Platform,
  KeyboardAvoidingView,
} from "react-native";
import { useEffect, useMemo, useState } from "react";
import { db } from "../../firebaseConfig";
import {
  collection, getDocs, deleteDoc, doc, updateDoc,
  addDoc, query, where, serverTimestamp,
} from "firebase/firestore";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

const DARK = "#0A0F1E";
const ACCENT = "#0EA5A4";

type Turf = {
  id: string;
  name?: string;
  location?: string;
  sport?: string;
  ownerName?: string;
  ownerId?: string;
  ownerEmail?: string;
  dayPrice?: number;
  nightPrice?: number;
  bookingPrice?: number;
  openingTime?: number;
  closingTime?: number;
  slotDuration?: number;
  images?: string[];
  image?: string;
  mapLink?: string;
  active?: boolean;
  operatorEmail?: string;
};

type Owner = { id: string; name?: string; email?: string };

const SERVER_URL = "https://your-server.com"; // ← update

export default function AdminTurfs() {
  const router = useRouter();
  const [turfs, setTurfs] = useState<Turf[]>([]);
  const [owners, setOwners] = useState<Owner[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");

  // Edit modal
  const [editModal, setEditModal] = useState(false);
  const [editTurf, setEditTurf] = useState<Turf | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: "", location: "", sport: "", mapLink: "",
    dayPrice: "", nightPrice: "", bookingPrice: "",
    openingTime: "6", closingTime: "24", slotDuration: "30",
    operatorEmail: "", ownerId: "", ownerName: "",
    images: [] as string[], imageInput: "", active: true,
  });

  useEffect(() => { fetchAll(); }, []);

  const fetchAll = async (isRefresh = false) => {
    isRefresh ? setRefreshing(true) : setLoading(true);
    try {
      const [turfSnap, ownerSnap] = await Promise.all([
        getDocs(collection(db, "turfs")),
        getDocs(query(collection(db, "users"), where("role", "==", "owner"))),
      ]);
      setTurfs(turfSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Turf)));
      setOwners(ownerSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Owner)));
    } catch { Alert.alert("Error", "Could not load turfs."); }
    finally { setLoading(false); setRefreshing(false); }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return turfs;
    return turfs.filter((t) =>
      [t.name, t.location, t.sport, t.ownerName].some((f) => f?.toLowerCase().includes(q))
    );
  }, [turfs, search]);

  const openEdit = (turf: Turf) => {
    setEditTurf(turf);
    setForm({
      name: turf.name || "",
      location: turf.location || "",
      sport: turf.sport || "",
      mapLink: turf.mapLink || "",
      dayPrice: String(turf.dayPrice || ""),
      nightPrice: String(turf.nightPrice || ""),
      bookingPrice: String(turf.bookingPrice || ""),
      openingTime: String(turf.openingTime ?? "6"),
      closingTime: String(turf.closingTime ?? "24"),
      slotDuration: String(turf.slotDuration ?? "30"),
      operatorEmail: turf.operatorEmail || "",
      ownerId: turf.ownerId || "",
      ownerName: turf.ownerName || "",
      images: turf.images || (turf.image ? [turf.image] : []),
      imageInput: "",
      active: turf.active !== false,
    });
    setEditModal(true);
  };

  const handleSaveEdit = async () => {
    if (!editTurf) return;
    if (!form.name.trim() || !form.location.trim()) {
      return Alert.alert("Required", "Name and location are required.");
    }
    setSaving(true);
    try {
      const selectedOwner = owners.find((o) => o.id === form.ownerId);
      await updateDoc(doc(db, "turfs", editTurf.id), {
        name: form.name.trim(),
        location: form.location.trim(),
        sport: form.sport.trim(),
        mapLink: form.mapLink.trim(),
        dayPrice: Number(form.dayPrice) || 0,
        nightPrice: Number(form.nightPrice) || 0,
        bookingPrice: Number(form.bookingPrice) || 0,
        openingTime: Number(form.openingTime),
        closingTime: Number(form.closingTime),
        slotDuration: Number(form.slotDuration),
        operatorEmail: form.operatorEmail.trim(),
        ownerId: form.ownerId || editTurf.ownerId,
        ownerName: selectedOwner?.name || form.ownerName,
        ownerEmail: selectedOwner?.email || "",
        images: form.images,
        image: form.images[0] || "",
        active: form.active,
        updatedAt: serverTimestamp(),
      });
     
      setEditModal(false);
      Alert.alert("Saved", "Turf updated successfully.");
    } catch { Alert.alert("Error", "Could not save changes."); }
    finally { setSaving(false); }
  };

  const confirmDelete = (turf: Turf) => {
    Alert.alert(
      "Delete Turf",
      `Delete "${turf.name}"? This will also remove all associated data.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete", style: "destructive",
          onPress: async () => {
            try {
              await deleteDoc(doc(db, "turfs", turf.id));
              setTurfs((prev) => prev.filter((t) => t.id !== turf.id));
            } catch { Alert.alert("Error", "Could not delete turf."); }
          },
        },
      ]
    );
  };

  const toggleActive = async (turf: Turf) => {
    const next = turf.active !== false ? false : true;
    try {
      await updateDoc(doc(db, "turfs", turf.id), { active: next });
      setTurfs((prev) => prev.map((t) => t.id === turf.id ? { ...t, active: next } : t));
    } catch { Alert.alert("Error", "Could not update status."); }
  };

  const renderTurf = ({ item }: { item: Turf }) => {
    const cover = item.images?.[0] || item.image;
    const isActive = item.active !== false;
    return (
      <View style={s.card}>
        {/* Image strip + status */}
        <View style={s.cardImageWrap}>
          {cover ? (
            <Image source={{ uri: cover }} style={s.cardImage} />
          ) : (
            <View style={[s.cardImage, s.cardImagePlaceholder]}>
              <Ionicons name="image-outline" size={28} color="#9CA3AF" />
            </View>
          )}
          <View style={[s.activePill, isActive ? s.activePillOn : s.activePillOff]}>
            <View style={[s.activeDot, { backgroundColor: isActive ? "#22C55E" : "#9CA3AF" }]} />
            <Text style={[s.activePillText, { color: isActive ? "#15803D" : "#6B7280" }]}>
              {isActive ? "Live" : "Paused"}
            </Text>
          </View>
        </View>

        <View style={s.cardBody}>
          <View style={s.cardTopRow}>
            <View style={{ flex: 1 }}>
              <Text style={s.turfName}>{item.name || "Unnamed"}</Text>
              <View style={s.metaRow}>
                <Ionicons name="location-outline" size={12} color="#6B7280" />
                <Text style={s.metaText}>{item.location || "No location"}</Text>
              </View>
            </View>
            <View style={s.sportBadge}>
              <Text style={s.sportText}>{item.sport || "Sport"}</Text>
            </View>
          </View>

          <View style={s.priceRow}>
            <View style={s.priceChip}>
              <Text style={s.priceChipLabel}>Day</Text>
              <Text style={s.priceChipValue}>₹{item.dayPrice || 0}</Text>
            </View>
            <View style={s.priceChip}>
              <Text style={s.priceChipLabel}>Night</Text>
              <Text style={s.priceChipValue}>₹{item.nightPrice || 0}</Text>
            </View>
            <View style={s.priceChip}>
              <Text style={s.priceChipLabel}>Advance</Text>
              <Text style={s.priceChipValue}>₹{item.bookingPrice || 0}</Text>
            </View>
          </View>

          <View style={s.ownerRow}>
            <Ionicons name="person-outline" size={13} color="#6B7280" />
            <Text style={s.ownerText}>{item.ownerName || "No owner"}</Text>
            {item.operatorEmail ? (
              <>
                <Text style={s.ownerDot}>·</Text>
                <Ionicons name="mail-outline" size={13} color="#6B7280" />
                <Text style={s.ownerText}>{item.operatorEmail}</Text>
              </>
            ) : null}
          </View>

          <View style={s.cardActions}>
            <TouchableOpacity style={s.editBtn} onPress={() => openEdit(item)}>
              <Ionicons name="pencil-outline" size={14} color="#FFFFFF" />
              <Text style={s.editBtnText}>Edit</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.toggleBtn, isActive ? s.toggleBtnPause : s.toggleBtnLive]}
              onPress={() => toggleActive(item)}
            >
              <Ionicons name={isActive ? "pause-circle-outline" : "play-circle-outline"} size={14} color={isActive ? "#B45309" : "#0F766E"} />
              <Text style={[s.toggleBtnText, { color: isActive ? "#B45309" : "#0F766E" }]}>
                {isActive ? "Pause" : "Go Live"}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.deleteBtn} onPress={() => confirmDelete(item)}>
              <Ionicons name="trash-outline" size={14} color="#DC2626" />
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={s.loadWrap}>
        <StatusBar barStyle="light-content" backgroundColor={DARK} />
        <ActivityIndicator size="large" color={ACCENT} />
        <Text style={s.loadText}>Loading turfs...</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="light-content" backgroundColor={DARK} />
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        renderItem={renderTurf}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={s.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => fetchAll(true)} tintColor={ACCENT} />}
        ListHeaderComponent={
          <View>
            <View style={s.hero}>
              <View style={s.heroGlow1} /><View style={s.heroGlow2} />
              <View style={s.heroTop}>
                <View>
                  <Text style={s.heroTag}>Turf Management</Text>
                  <Text style={s.heroTitle}>All Turfs</Text>
                  <Text style={s.heroSub}>Edit details, pricing, operators, and go live status.</Text>
                </View>
                <View style={s.countBadge}>
                  <Text style={s.countText}>{turfs.length}</Text>
                  <Text style={s.countLabel}>total</Text>
                </View>
              </View>
              <View style={s.heroStats}>
                {[
                  { label: "Live", value: turfs.filter((t) => t.active !== false).length, color: "#34D399" },
                  { label: "Paused", value: turfs.filter((t) => t.active === false).length, color: "#9CA3AF" },
                ].map((st) => (
                  <View key={st.label} style={s.heroStat}>
                    <Text style={[s.heroStatValue, { color: st.color }]}>{st.value}</Text>
                    <Text style={s.heroStatLabel}>{st.label}</Text>
                  </View>
                ))}
              </View>
            </View>

            {/* Search + Add */}
            <View style={s.toolbar}>
              <View style={s.searchWrap}>
                <Ionicons name="search-outline" size={16} color="#9CA3AF" style={{ marginRight: 8 }} />
                <TextInput
                  style={s.searchInput}
                  placeholder="Search turf, location, sport..."
                  placeholderTextColor="#9CA3AF"
                  value={search}
                  onChangeText={setSearch}
                />
              </View>
              <TouchableOpacity style={s.addBtn} onPress={() => router.push("/admin/add-turf")}>
                <Ionicons name="add" size={20} color="#FFFFFF" />
              </TouchableOpacity>
            </View>

            <Text style={s.sectionLabel}>{filtered.length} venue{filtered.length !== 1 ? "s" : ""}</Text>
          </View>
        }
        ListEmptyComponent={
          <View style={s.empty}>
            <Ionicons name="location-outline" size={40} color="#D1D5DB" />
            <Text style={s.emptyTitle}>No turfs found</Text>
            <Text style={s.emptySub}>Try a different search or add your first turf.</Text>
            <TouchableOpacity style={s.emptyBtn} onPress={() => router.push("/admin/add-turf")}>
              <Text style={s.emptyBtnText}>Add Turf</Text>
            </TouchableOpacity>
          </View>
        }
      />

      {/* Edit Modal */}
      <Modal visible={editModal} animationType="slide" transparent>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={s.modalBackdrop}>
            <View style={s.modalSheet}>
              <View style={s.sheetHandle} />
              <View style={s.modalHeader}>
                <View>
                  <Text style={s.modalTitle}>Edit Turf</Text>
                  <Text style={s.modalSub}>{editTurf?.name}</Text>
                </View>
                <TouchableOpacity style={s.closeBtn} onPress={() => setEditModal(false)}>
                  <Ionicons name="close" size={20} color="#374151" />
                </TouchableOpacity>
              </View>
              <ScrollView showsVerticalScrollIndicator={false}>
                {[
                  { label: "Turf Name *", key: "name", placeholder: "e.g. Green Field Arena" },
                  { label: "Location *", key: "location", placeholder: "Area, City" },
                  { label: "Sport", key: "sport", placeholder: "Football, Cricket..." },
                  { label: "Google Maps Link", key: "mapLink", placeholder: "https://maps.google.com/..." },
                  { label: "Day Price (₹/hr)", key: "dayPrice", placeholder: "6 AM – 6 PM", numeric: true },
                  { label: "Night Price (₹/hr)", key: "nightPrice", placeholder: "6 PM – 6 AM", numeric: true },
                  { label: "Advance Booking Amount (₹)", key: "bookingPrice", placeholder: "Amount to lock slot", numeric: true },
                  { label: "Opening Time (24hr)", key: "openingTime", placeholder: "6", numeric: true },
                  { label: "Closing Time (24hr)", key: "closingTime", placeholder: "24", numeric: true },
                  { label: "Slot Duration (mins)", key: "slotDuration", placeholder: "30 or 60", numeric: true },
                  { label: "Operator Email", key: "operatorEmail", placeholder: "turf@playon.app" },
                ].map(({ label, key, placeholder, numeric }) => (
                  <View key={key}>
                    <Text style={s.fieldLabel}>{label}</Text>
                    <TextInput
                      style={s.input}
                      placeholder={placeholder}
                      placeholderTextColor="#9CA3AF"
                      value={(form as any)[key]}
                      onChangeText={(v) => setForm((f) => ({ ...f, [key]: v }))}
                      keyboardType={numeric ? "numeric" : "default"}
                      autoCapitalize="none"
                    />
                  </View>
                ))}

                {/* Owner picker */}
                <Text style={s.fieldLabel}>Assign Owner</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }}>
                  {owners.map((o) => (
                    <TouchableOpacity
                      key={o.id}
                      style={[s.ownerChip, form.ownerId === o.id && s.ownerChipActive]}
                      onPress={() => setForm((f) => ({ ...f, ownerId: o.id, ownerName: o.name || "" }))}
                    >
                      <Text style={[s.ownerChipText, form.ownerId === o.id && s.ownerChipTextActive]}>
                        {o.name}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>

                {/* Image URLs */}
                <Text style={s.fieldLabel}>Images (URLs)</Text>
                <View style={s.imageInputRow}>
                  <TextInput
                    style={[s.input, { flex: 1 }]}
                    placeholder="Paste image URL and tap +"
                    placeholderTextColor="#9CA3AF"
                    value={form.imageInput}
                    onChangeText={(v) => setForm((f) => ({ ...f, imageInput: v }))}
                    autoCapitalize="none"
                  />
                  <TouchableOpacity
                    style={s.imageAddBtn}
                    onPress={() => {
                      if (!form.imageInput.trim()) return;
                      setForm((f) => ({ ...f, images: [...f.images, f.imageInput.trim()], imageInput: "" }));
                    }}
                  >
                    <Ionicons name="add" size={20} color="#FFFFFF" />
                  </TouchableOpacity>
                </View>
                {form.images.map((img, i) => (
                  <View key={i} style={s.imageRow}>
                    <Text style={s.imageRowText} numberOfLines={1}>{img}</Text>
                    <TouchableOpacity onPress={() => setForm((f) => ({ ...f, images: f.images.filter((_, j) => j !== i) }))}>
                      <Ionicons name="close-circle" size={18} color="#DC2626" />
                    </TouchableOpacity>
                  </View>
                ))}

                {/* Active toggle */}
                <View style={s.toggleRow}>
                  <View>
                    <Text style={s.toggleLabel}>Turf is live</Text>
                    <Text style={s.toggleSub}>{form.active ? "Users can see and book this turf." : "Turf is hidden from users."}</Text>
                  </View>
                  <Switch
                    value={form.active}
                    onValueChange={(v) => setForm((f) => ({ ...f, active: v }))}
                    trackColor={{ false: "#E5E7EB", true: ACCENT }}
                    thumbColor="#FFFFFF"
                  />
                </View>

                <TouchableOpacity style={[s.saveBtn, saving && { opacity: 0.6 }]} onPress={handleSaveEdit} disabled={saving}>
                  {saving ? <ActivityIndicator color="#FFFFFF" /> : (
                    <>
                      <Ionicons name="checkmark-circle-outline" size={18} color="#FFFFFF" />
                      <Text style={s.saveBtnText}>Save Changes</Text>
                    </>
                  )}
                </TouchableOpacity>
                <TouchableOpacity style={s.cancelBtn} onPress={() => setEditModal(false)} disabled={saving}>
                  <Text style={s.cancelBtnText}>Cancel</Text>
                </TouchableOpacity>
                <View style={{ height: 24 }} />
              </ScrollView>
            </View>
          </View>
        </KeyboardAvoidingView>
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
  heroGlow1: { position: "absolute", top: -40, right: -40, width: 200, height: 200, borderRadius: 100, backgroundColor: "rgba(14,165,164,0.14)" },
  heroGlow2: { position: "absolute", bottom: -60, left: -40, width: 180, height: 180, borderRadius: 90, backgroundColor: "rgba(96,165,250,0.10)" },
  heroTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  heroTag: { color: "#6EE7B7", fontSize: 11, fontWeight: "800", letterSpacing: 1.5, textTransform: "uppercase" },
  heroTitle: { color: "#FFFFFF", fontSize: 28, fontWeight: "900", marginTop: 4 },
  heroSub: { color: "#9CA3AF", fontSize: 13, lineHeight: 20, marginTop: 6 },
  countBadge: { backgroundColor: "rgba(255,255,255,0.08)", borderRadius: 14, padding: 12, alignItems: "center", minWidth: 60 },
  countText: { color: "#FFFFFF", fontSize: 24, fontWeight: "900" },
  countLabel: { color: "#9CA3AF", fontSize: 11, fontWeight: "600" },
  heroStats: { flexDirection: "row", gap: 12, marginTop: 18 },
  heroStat: { backgroundColor: "rgba(255,255,255,0.07)", borderRadius: 12, paddingHorizontal: 18, paddingVertical: 10, alignItems: "center" },
  heroStatValue: { fontSize: 20, fontWeight: "900" },
  heroStatLabel: { color: "#9CA3AF", fontSize: 11, fontWeight: "600", marginTop: 2 },

  toolbar: { flexDirection: "row", gap: 10, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 4 },
  searchWrap: { flex: 1, flexDirection: "row", alignItems: "center", backgroundColor: "#FFFFFF", borderRadius: 14, paddingHorizontal: 14, borderWidth: 1, borderColor: "#E5E7EB" },
  searchInput: { flex: 1, paddingVertical: 12, fontSize: 14, color: "#111827" },
  addBtn: { backgroundColor: DARK, width: 46, height: 46, borderRadius: 14, justifyContent: "center", alignItems: "center" },
  sectionLabel: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8, fontSize: 13, color: "#9CA3AF", fontWeight: "700" },

  card: { backgroundColor: "#FFFFFF", marginHorizontal: 16, marginBottom: 14, borderRadius: 20, overflow: "hidden", borderWidth: 1, borderColor: "#E5E7EB", shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  cardImageWrap: { position: "relative" },
  cardImage: { width: "100%", height: 140, backgroundColor: "#E5E7EB" },
  cardImagePlaceholder: { justifyContent: "center", alignItems: "center" },
  activePill: { position: "absolute", top: 10, right: 10, flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  activePillOn: { backgroundColor: "#DCFCE7" },
  activePillOff: { backgroundColor: "#F3F4F6" },
  activeDot: { width: 6, height: 6, borderRadius: 3 },
  activePillText: { fontSize: 11, fontWeight: "800" },

  cardBody: { padding: 14 },
  cardTopRow: { flexDirection: "row", alignItems: "flex-start", marginBottom: 10 },
  turfName: { fontSize: 18, fontWeight: "900", color: "#111827" },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 },
  metaText: { fontSize: 12, color: "#6B7280", fontWeight: "500" },
  sportBadge: { backgroundColor: "#EFF6FF", paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  sportText: { fontSize: 11, color: "#1E40AF", fontWeight: "800" },

  priceRow: { flexDirection: "row", gap: 8, marginBottom: 10 },
  priceChip: { flex: 1, backgroundColor: "#F9FAFB", borderRadius: 10, paddingVertical: 8, alignItems: "center", borderWidth: 1, borderColor: "#F3F4F6" },
  priceChipLabel: { fontSize: 9, color: "#9CA3AF", fontWeight: "700", textTransform: "uppercase" },
  priceChipValue: { fontSize: 14, color: "#111827", fontWeight: "800", marginTop: 2 },

  ownerRow: { flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 12, flexWrap: "wrap" },
  ownerText: { fontSize: 12, color: "#6B7280", fontWeight: "500" },
  ownerDot: { color: "#D1D5DB", fontSize: 14 },

  cardActions: { flexDirection: "row", gap: 8 },
  editBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: DARK, paddingVertical: 10, borderRadius: 12 },
  editBtnText: { color: "#FFFFFF", fontSize: 13, fontWeight: "700" },
  toggleBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, borderRadius: 12, borderWidth: 1 },
  toggleBtnPause: { backgroundColor: "#FFFBEB", borderColor: "#FDE68A" },
  toggleBtnLive: { backgroundColor: "#F0FDFA", borderColor: "#99F6E4" },
  toggleBtnText: { fontSize: 13, fontWeight: "700" },
  deleteBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: "#FEF2F2", justifyContent: "center", alignItems: "center", borderWidth: 1, borderColor: "#FECACA" },

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
  imageInputRow: { flexDirection: "row", gap: 10 },
  imageAddBtn: { width: 46, height: 46, backgroundColor: DARK, borderRadius: 12, justifyContent: "center", alignItems: "center" },
  imageRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "#F9FAFB", borderRadius: 10, padding: 10, marginTop: 6, borderWidth: 1, borderColor: "#E5E7EB" },
  imageRowText: { flex: 1, fontSize: 12, color: "#6B7280", marginRight: 8 },
  ownerChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: "#F3F4F6", marginRight: 8, borderWidth: 1, borderColor: "#E5E7EB" },
  ownerChipActive: { backgroundColor: DARK, borderColor: DARK },
  ownerChipText: { fontSize: 13, fontWeight: "600", color: "#374151" },
  ownerChipTextActive: { color: "#FFFFFF" },
  toggleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: "#F9FAFB", borderRadius: 14, padding: 14, marginTop: 16, borderWidth: 1, borderColor: "#E5E7EB" },
  toggleLabel: { fontSize: 15, fontWeight: "700", color: "#111827" },
  toggleSub: { fontSize: 12, color: "#9CA3AF", marginTop: 2 },
  saveBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: DARK, paddingVertical: 15, borderRadius: 16, marginTop: 24 },
  saveBtnText: { color: "#FFFFFF", fontWeight: "800", fontSize: 15 },
  cancelBtn: { backgroundColor: "#F3F4F6", paddingVertical: 15, borderRadius: 16, alignItems: "center", marginTop: 10 },
  cancelBtnText: { color: "#374151", fontWeight: "700", fontSize: 15 },
});
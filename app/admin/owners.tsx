import {
  View, Text, StyleSheet, StatusBar, FlatList,
  TouchableOpacity, TextInput, Alert, ActivityIndicator,
  RefreshControl, Modal, ScrollView, Switch, Platform,
  KeyboardAvoidingView,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { useEffect, useMemo, useState } from "react";
import { db, auth } from "../../firebaseConfig";
import {
  collection, getDocs, doc, updateDoc,
  query, where,
} from "firebase/firestore";
import { getIdToken } from "firebase/auth";
import { Ionicons } from "@expo/vector-icons";

const DARK   = "#0A0F1E";
const ACCENT = "#0EA5A4";
const SERVER_URL = "https://bookora-backend-95u4.onrender.com";

// ── Types ─────────────────────────────────────────────────────────────────────
type Banking = {
  accountNo?: string;
  ifsc?:      string;
  name?:      string;
  upi?:       string | null;
  verified?:  boolean;
};

type Owner = {
  id: string;
  name?: string;
  email?: string;
  phone?: string;
  businessName?: string;
  location?: string;
  description?: string;
  status?: "active" | "inactive" | "blocked";
  role?: string;
  banking?: Banking;
  turfNames?: string[];
  turfCount?: number;
};

type Operator = {
  id: string;
  name?: string;
  email?: string;
  phone?: string;
  status?: string;
  turfId?: string;
  turfName?: string;
  ownerId?: string;
};

type Turf = {
  id: string;
  name?: string;
  ownerId?: string;
  ownerIds?: string[];
  status?: string;
};

const EMPTY_FORM = {
  name: "", email: "", phone: "", businessName: "",
  location: "", description: "", password: "",
  status: "active" as "active" | "inactive" | "blocked",
  // ✅ banking
  bankAccountNo: "", bankIfsc: "", bankName: "", bankUpi: "",
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function avatarColor(name: string) {
  const colors = ["#0F766E", "#0369A1", "#7C3AED", "#B45309", "#BE185D", "#15803D"];
  let h = 0; for (const c of name) h += c.charCodeAt(0);
  return colors[h % colors.length];
}
function initials(name: string) {
  return name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
}

// ✅ Get Firebase ID token for admin-protected endpoints
async function getAuthToken(): Promise<string | null> {
  try {
    const user = auth.currentUser;
    if (!user) return null;
    return await getIdToken(user);
  } catch { return null; }
}

export default function AdminOwners() {
  const insets = useSafeAreaInsets();

  const [owners,       setOwners]       = useState<Owner[]>([]);
  const [turfs,        setTurfs]        = useState<Turf[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [refreshing,   setRefreshing]   = useState(false);
  const [saving,       setSaving]       = useState(false);
  const [search,       setSearch]       = useState("");
  const [modalVisible, setModalVisible] = useState(false);
  const [editing,      setEditing]      = useState<Owner | null>(null);
  const [form,         setForm]         = useState(EMPTY_FORM);
  const [showPassword, setShowPassword] = useState(false);
  const [detailOwner,  setDetailOwner]  = useState<Owner | null>(null);
  const [showBankingInDetail, setShowBankingInDetail] = useState(false);

  // ── Operator state ────────────────────────────────────────────────────────
  const [operators,   setOperators]   = useState<Operator[]>([]);
  const [opModal,     setOpModal]     = useState(false);
  const [opForOwner,  setOpForOwner]  = useState<Owner | null>(null);
  const [opTurfId,    setOpTurfId]    = useState("");
  const [opSaving,    setOpSaving]    = useState(false);
  const [showOpPw,    setShowOpPw]    = useState(false);
  const [opForm,      setOpForm]      = useState({ name: "", email: "", phone: "", password: "" });

  useEffect(() => { fetchAll(); }, []);

  const fetchAll = async (isRefresh = false) => {
    isRefresh ? setRefreshing(true) : setLoading(true);
    try {
      const [ownerSnap, turfSnap, opSnap] = await Promise.all([
        getDocs(query(collection(db, "users"), where("role", "==", "owner"))),
        getDocs(collection(db, "turfs")),
        getDocs(query(collection(db, "users"), where("role", "==", "turf-operator"))),
      ]);

      const allTurfs: Turf[] = turfSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Turf));
      setTurfs(allTurfs);
      setOperators(opSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Operator)));

      const rawOwners: Owner[] = ownerSnap.docs
        .map((d) => ({ id: d.id, ...d.data() } as Owner))
        .sort((a, b) => (a.name || "").localeCompare(b.name || ""));

      const enriched = rawOwners.map((o) => {
        const ownerTurfs = allTurfs.filter((t) =>
          t.ownerId === o.id || (Array.isArray(t.ownerIds) && t.ownerIds.includes(o.id))
        );
        return { ...o, turfNames: ownerTurfs.map((t) => t.name || "Unnamed Turf"), turfCount: ownerTurfs.length };
      });

      setOwners(enriched);
    } catch {
      Alert.alert("Error", "Could not load data.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return owners;
    return owners.filter((o) =>
      [o.name, o.email, o.phone, o.businessName, o.location, ...(o.turfNames || [])]
        .some((f) => f?.toLowerCase().includes(q))
    );
  }, [owners, search]);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setShowPassword(false);
    setModalVisible(true);
  };

  const openEdit = (o: Owner) => {
    setEditing(o);
    setForm({
      name:         o.name         || "",
      email:        o.email        || "",
      phone:        o.phone        || "",
      businessName: o.businessName || "",
      location:     o.location     || "",
      description:  o.description  || "",
      password:     "",
      status:       o.status       || "active",
      // ✅ pre-fill banking from existing owner doc
      bankAccountNo: o.banking?.accountNo || "",
      bankIfsc:      o.banking?.ifsc      || "",
      bankName:      o.banking?.name      || "",
      bankUpi:       o.banking?.upi       || "",
    });
    setShowPassword(false);
    setModalVisible(true);
  };

  const validate = (): string | null => {
    if (!form.name.trim())                               return "Name is required.";
    if (!form.email.trim() || !form.email.includes("@")) return "Valid email required.";
    if (!form.phone.trim() || form.phone.length < 10)    return "Valid phone required.";
    if (!form.businessName.trim())                       return "Business name required.";
    if (!editing && form.password.length < 6)            return "Password must be 6+ characters.";
    // ✅ banking validation (required for create, optional update)
    if (!editing) {
      if (!form.bankName.trim())        return "Account holder name is required.";
      if (!form.bankAccountNo.trim() || form.bankAccountNo.trim().length < 9)
        return "Valid bank account number is required (min 9 digits).";
      const ifsc = form.bankIfsc.trim().toUpperCase();
      if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) return "Enter a valid IFSC code (e.g. SBIN0001234).";
    }
    return null;
  };

  const handleSave = async () => {
    const err = validate();
    if (err) return Alert.alert("Incomplete", err);
    setSaving(true);
    try {
      if (editing) {
        // ✅ Build banking update object — only include if fields are filled
        const bankingUpdate: any = {};
        if (form.bankName.trim())        bankingUpdate["banking.name"]      = form.bankName.trim();
        if (form.bankAccountNo.trim())   bankingUpdate["banking.accountNo"] = form.bankAccountNo.trim();
        if (form.bankIfsc.trim())        bankingUpdate["banking.ifsc"]      = form.bankIfsc.trim().toUpperCase();
        if (form.bankUpi !== undefined)  bankingUpdate["banking.upi"]       = form.bankUpi.trim() || null;

        const updates = {
          name:         form.name.trim(),
          phone:        form.phone.trim(),
          businessName: form.businessName.trim(),
          location:     form.location.trim(),
          description:  form.description.trim(),
          status:       form.status,
          ...bankingUpdate,
        };
        await updateDoc(doc(db, "users", editing.id), updates);

        // ✅ Rebuild banking object for local state
        const updatedBanking: Banking = {
          ...editing.banking,
          ...(form.bankName.trim()      && { name:      form.bankName.trim() }),
          ...(form.bankAccountNo.trim() && { accountNo: form.bankAccountNo.trim() }),
          ...(form.bankIfsc.trim()      && { ifsc:      form.bankIfsc.trim().toUpperCase() }),
          upi: form.bankUpi.trim() || null,
        };

        setOwners((prev) =>
          prev.map((o) => o.id === editing.id ? { ...o, ...updates, banking: updatedBanking } : o)
        );
        setDetailOwner((d) =>
          d && d.id === editing.id ? { ...d, ...updates, banking: updatedBanking } : d
        );
        Alert.alert("Updated ✓", `${form.name} has been updated.`);
      } else {
        // ✅ Get Firebase ID token for requireAdminSecret middleware
        const token = await getAuthToken();
        if (!token) {
          Alert.alert("Auth Error", "Could not verify admin identity. Please log in again.");
          return;
        }

        const res = await fetch(`${SERVER_URL}/create-owner`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`,  // ✅ required by requireAdminSecret
          },
          body: JSON.stringify({
            name:         form.name.trim(),
            email:        form.email.trim().toLowerCase(),
            phone:        form.phone.trim(),
            password:     form.password,
            businessName: form.businessName.trim(),
            location:     form.location.trim(),
            description:  form.description.trim(),
            role:         "owner",
            status:       "active",
            // ✅ banking details
            bankAccountNo: form.bankAccountNo.trim(),
            bankIfsc:      form.bankIfsc.trim().toUpperCase(),
            bankName:      form.bankName.trim(),
            bankUpi:       form.bankUpi.trim() || null,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to create owner");
        Alert.alert(
          "Owner Created ✓",
          `${form.name} can now log in with:\n\nEmail: ${form.email}\nPassword: ${form.password}`
        );
        fetchAll();
      }
      setModalVisible(false);
    } catch (e: any) {
      Alert.alert("Error", e.message || "Something went wrong.");
    } finally {
      setSaving(false);
    }
  };

  const toggleStatus = async (o: Owner) => {
    const isCurrentlyActive = o.status === "active";
    const next = isCurrentlyActive ? "blocked" : "active";
    const actionLabel = isCurrentlyActive ? "Disable" : "Enable";
    const message = isCurrentlyActive
      ? `Disable ${o.name}?\n\nThey will be immediately logged out and unable to log back in.`
      : `Enable ${o.name}?\n\nThey will be able to log in again.`;

    Alert.alert(actionLabel + " Account", message, [
      { text: "Cancel", style: "cancel" },
      {
        text: actionLabel, style: isCurrentlyActive ? "destructive" : "default",
        onPress: async () => {
          try {
            await updateDoc(doc(db, "users", o.id), { status: next });
            setOwners((prev) => prev.map((x) => x.id === o.id ? { ...x, status: next as any } : x));
            setDetailOwner((d) => d && d.id === o.id ? { ...d, status: next as any } : d);
            Alert.alert(
              actionLabel + "d ✓",
              isCurrentlyActive
                ? `${o.name}'s account has been disabled. They can no longer log in.`
                : `${o.name}'s account is active again.`
            );
          } catch {
            Alert.alert("Error", "Could not update status.");
          }
        },
      },
    ]);
  };

  // ✅ Toggle banking verified flag
  const toggleBankingVerified = async (o: Owner) => {
    const next = !o.banking?.verified;
    try {
      await updateDoc(doc(db, "users", o.id), { "banking.verified": next });
      const updatedBanking = { ...o.banking, verified: next };
      setOwners((prev) => prev.map((x) => x.id === o.id ? { ...x, banking: updatedBanking } : x));
      setDetailOwner((d) => d && d.id === o.id ? { ...d, banking: updatedBanking } : d);
    } catch {
      Alert.alert("Error", "Could not update banking verification.");
    }
  };

  const handleDelete = (o: Owner) => {
    Alert.alert(
      "Delete Owner",
      `Delete ${o.name}?\n\nThis will remove their account and deactivate all associated turfs. This cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete", style: "destructive",
          onPress: async () => {
            try {
              const token = await getAuthToken();
              const res = await fetch(`${SERVER_URL}/delete-owner/${o.id}`, {
                method: "DELETE",
                headers: token ? { "Authorization": `Bearer ${token}` } : {},
              });
              const data = await res.json();
              if (!res.ok) throw new Error(data.error || "Failed");
              setOwners((prev) => prev.filter((x) => x.id !== o.id));
              setDetailOwner(null);
              const turfMsg = data.turfsDeactivated > 0 ? `\n${data.turfsDeactivated} turf(s) deactivated.` : "";
              const opMsg   = data.operatorsUnlinked > 0 ? `\n${data.operatorsUnlinked} operator(s) unlinked.` : "";
              Alert.alert("Owner Deleted", `${o.name} has been removed.${turfMsg}${opMsg}`);
            } catch (e: any) {
              Alert.alert("Error", e.message);
            }
          },
        },
      ]
    );
  };

  // ── Create operator under an owner ───────────────────────────────────────
  const openOpModal = (owner: Owner) => {
    setOpForOwner(owner);
    setOpTurfId("");
    setOpForm({ name: "", email: "", phone: "", password: "" });
    setShowOpPw(false);
    setOpModal(true);
  };

  const createOperator = async () => {
    if (!opForOwner) return;
    if (!opForm.name.trim())  return Alert.alert("Required", "Operator name is required.");
    if (!opForm.email.trim() || !opForm.email.includes("@")) return Alert.alert("Required", "Valid email is required.");
    if (!opForm.phone.trim()) return Alert.alert("Required", "Phone number is required.");
    if (opForm.password.length < 6) return Alert.alert("Required", "Password must be at least 6 characters.");

    setOpSaving(true);
    try {
      const token = await getAuthToken();
      if (!token) { Alert.alert("Auth Error", "Please log in again."); return; }

      const res = await fetch(`${SERVER_URL}/create-operator`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({
          name:    opForm.name.trim(),
          email:   opForm.email.trim().toLowerCase(),
          phone:   opForm.phone.trim(),
          password: opForm.password,
          ownerId: opForOwner.id,
          turfId:  opTurfId || null,
          turfName: opTurfId ? (turfs.find(t => t.id === opTurfId)?.name || "") : "",
          role:    "turf-operator",
          status:  "active",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create operator");

      // If a turf was selected, update that turf's operatorId
      if (opTurfId) {
        await updateDoc(doc(db, "turfs", opTurfId), {
          operatorId:    data.uid,
          operatorName:  opForm.name.trim(),
          operatorEmail: opForm.email.trim().toLowerCase(),
        });
      }

      Alert.alert(
        "Operator Created ✓",
        `${opForm.name} can now log in:\n\nEmail: ${opForm.email}\nPassword: ${opForm.password}`
      );
      setOpModal(false);
      await fetchAll(true);
    } catch (e: any) {
      Alert.alert("Error", e.message || "Something went wrong.");
    } finally {
      setOpSaving(false);
    }
  };

  const getTurfsForOwner = (ownerId: string): Turf[] =>
    turfs.filter((t) =>
      t.ownerId === ownerId || (Array.isArray(t.ownerIds) && t.ownerIds.includes(ownerId))
    );

  const renderOwner = ({ item }: { item: Owner }) => {
    const color    = avatarColor(item.name || "?");
    const isActive = item.status === "active";
    const ownerTurfs = item.turfNames || [];
    const hasBanking = !!item.banking?.accountNo;

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
            <View style={s.infoChip}>
              <Ionicons name="call-outline" size={11} color="#6B7280" />
              <Text style={s.chipText}>{item.phone || "No phone"}</Text>
            </View>
            {item.location ? (
              <View style={s.infoChip}>
                <Ionicons name="location-outline" size={11} color="#6B7280" />
                <Text style={s.chipText}>{item.location}</Text>
              </View>
            ) : null}
            {/* ✅ Banking verified badge */}
            <View style={[s.infoChip, hasBanking ? (item.banking?.verified ? s.bankVerified : s.bankUnverified) : s.bankMissing]}>
              <Ionicons
                name={hasBanking ? (item.banking?.verified ? "shield-checkmark" : "shield-outline") : "card-outline"}
                size={11}
                color={hasBanking ? (item.banking?.verified ? "#15803D" : "#B45309") : "#9CA3AF"}
              />
              <Text style={[s.chipText, {
                color: hasBanking ? (item.banking?.verified ? "#15803D" : "#B45309") : "#9CA3AF"
              }]}>
                {hasBanking ? (item.banking?.verified ? "Bank ✓" : "Bank Unverified") : "No Bank"}
              </Text>
            </View>
          </View>

          <View style={s.turfSection}>
            <View style={s.turfHeaderRow}>
              <Ionicons name="football-outline" size={12} color="#6B7280" />
              <Text style={s.turfHeaderText}>
                {ownerTurfs.length === 0 ? "No turfs assigned" : `${ownerTurfs.length} turf${ownerTurfs.length > 1 ? "s" : ""}`}
              </Text>
            </View>
            {ownerTurfs.length > 0 && (
              <View style={s.turfChipsRow}>
                {ownerTurfs.map((name, i) => (
                  <View key={i} style={s.turfChip}>
                    <Text style={s.turfChipText}>{name}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>

          <View style={s.cardActions}>
            <TouchableOpacity style={s.actionBtn} onPress={() => openEdit(item)}>
              <Ionicons name="pencil-outline" size={13} color="#374151" />
              <Text style={s.actionBtnText}>Edit</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.actionBtn, isActive ? s.actionDeactivate : s.actionActivate]}
              onPress={() => toggleStatus(item)}
            >
              <Ionicons name={isActive ? "pause-circle-outline" : "play-circle-outline"} size={13} color={isActive ? "#B45309" : "#0F766E"} />
              <Text style={[s.actionBtnText, { color: isActive ? "#B45309" : "#0F766E" }]}>
                {isActive ? "Disable" : "Enable"}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.actionBtn, s.actionDelete]} onPress={() => handleDelete(item)}>
              <Ionicons name="trash-outline" size={13} color="#DC2626" />
              <Text style={[s.actionBtnText, { color: "#DC2626" }]}>Delete</Text>
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
    <View style={s.safe}>
      <StatusBar barStyle="light-content" backgroundColor={DARK} />

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        renderItem={renderOwner}
        contentContainerStyle={s.list}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => fetchAll(true)} tintColor={ACCENT} />}
        ListHeaderComponent={
          <View>
             <View style={[s.hero, { paddingTop: insets.top + 12 }]}>
              <View style={s.heroGlow1} /><View style={s.heroGlow2} />
              <Text style={s.heroTag}>Owner Management</Text>
              <Text style={s.heroTitle}>Owners</Text>
              <Text style={s.heroSub}>Create and manage all turf owner accounts.</Text>
              <View style={s.heroStats}>
                {[
                  { label: "Total",      value: owners.length,                                                            color: "#60A5FA" },
                  { label: "Active",     value: owners.filter((o) => o.status === "active").length,                      color: "#34D399" },
                  { label: "Disabled",   value: owners.filter((o) => o.status === "blocked" || o.status === "inactive").length, color: "#9CA3AF" },
                  { label: "No Bank",    value: owners.filter((o) => !o.banking?.accountNo).length,                      color: "#FBBF24" },
                  { label: "Unverified", value: owners.filter((o) => o.banking?.accountNo && !o.banking?.verified).length, color: "#F87171" },
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
                <TextInput
                  style={s.searchInput}
                  placeholder="Search owners or turfs..."
                  placeholderTextColor="#9CA3AF"
                  value={search}
                  onChangeText={setSearch}
                />
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

      {/* ── Create / Edit Modal ── */}
      <Modal visible={modalVisible} animationType="slide" transparent>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={s.modalBackdrop}>
            <View style={s.modalSheet}>
              <View style={s.sheetHandle} />
              <ScrollView showsVerticalScrollIndicator={false}>
                <View style={s.modalHeader}>
                  <View>
                    <Text style={s.modalTitle}>{editing ? "Edit Owner" : "Create Owner"}</Text>
                    <Text style={s.modalSub}>
                      {editing ? "Update owner details and banking." : "A login account will be created automatically."}
                    </Text>
                  </View>
                  <TouchableOpacity style={s.closeBtn} onPress={() => setModalVisible(false)}>
                    <Ionicons name="close" size={20} color="#374151" />
                  </TouchableOpacity>
                </View>

                {/* ── Basic details ── */}
                {[
                  { label: "Full Name *",         key: "name",         placeholder: "Owner's full name" },
                  { label: "Business Name *",      key: "businessName", placeholder: "e.g. Sports Arena Pvt Ltd" },
                  { label: "Email *",              key: "email",        placeholder: "owner@email.com", caps: false, disabled: !!editing },
                  { label: "Phone *",              key: "phone",        placeholder: "10-digit mobile", numeric: true },
                  { label: "Location",             key: "location",     placeholder: "City or area" },
                  { label: "Business Description", key: "description",  placeholder: "Brief about the turf business" },
                ].map(({ label, key, placeholder, caps, numeric, disabled }) => (
                  <View key={key}>
                    <Text style={s.fieldLabel}>{label}</Text>
                    <TextInput
                      style={[s.input, disabled && s.inputDisabled]}
                      placeholder={placeholder}
                      placeholderTextColor="#9CA3AF"
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
                        style={[s.input, { flex: 1 }]}
                        placeholder="Min. 6 characters"
                        placeholderTextColor="#9CA3AF"
                        value={form.password}
                        onChangeText={(v) => setForm((f) => ({ ...f, password: v }))}
                        secureTextEntry={!showPassword}
                        autoCapitalize="none"
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
                      onValueChange={(v) => setForm((f) => ({ ...f, status: v ? "active" : "blocked" }))}
                      trackColor={{ false: "#E5E7EB", true: ACCENT }}
                      thumbColor="#FFFFFF"
                    />
                  </View>
                )}

                {/* ✅ Banking details section */}
                <View style={s.bankSection}>
                  <View style={s.bankSectionHeader}>
                    <Ionicons name="card-outline" size={16} color={ACCENT} />
                    <Text style={s.bankSectionTitle}>Banking Details</Text>
                    {editing && <Text style={s.bankSectionOpt}>(update if changed)</Text>}
                    {!editing && <Text style={s.bankSectionRequired}>Required *</Text>}
                  </View>
                  <Text style={s.bankSectionSub}>For processing settlement payouts to this owner.</Text>

                  <Text style={s.fieldLabel}>Account Holder Name {!editing && "*"}</Text>
                  <TextInput
                    style={s.input} placeholder="Name as on bank account"
                    placeholderTextColor="#9CA3AF" value={form.bankName}
                    onChangeText={(v) => setForm((f) => ({ ...f, bankName: v }))}
                    autoCapitalize="words"
                  />

                  <Text style={s.fieldLabel}>Bank Account Number {!editing && "*"}</Text>
                  <TextInput
                    style={s.input} placeholder="e.g. 123456789012"
                    placeholderTextColor="#9CA3AF" value={form.bankAccountNo}
                    onChangeText={(v) => setForm((f) => ({ ...f, bankAccountNo: v }))}
                    keyboardType="numeric"
                  />

                  <Text style={s.fieldLabel}>IFSC Code {!editing && "*"}</Text>
                  <TextInput
                    style={s.input} placeholder="e.g. SBIN0001234"
                    placeholderTextColor="#9CA3AF" value={form.bankIfsc}
                    onChangeText={(v) => setForm((f) => ({ ...f, bankIfsc: v.toUpperCase() }))}
                    autoCapitalize="characters"
                    maxLength={11}
                  />
                  <Text style={s.disabledHint}>11-character code — find on your cheque or bank app.</Text>

                  <Text style={s.fieldLabel}>UPI ID (Optional)</Text>
                  <TextInput
                    style={s.input} placeholder="e.g. owner@upi or 9876543210@ybl"
                    placeholderTextColor="#9CA3AF" value={form.bankUpi}
                    onChangeText={(v) => setForm((f) => ({ ...f, bankUpi: v }))}
                    autoCapitalize="none" keyboardType="email-address"
                  />
                  <Text style={s.disabledHint}>Faster payouts via UPI. Leave blank to use bank account only.</Text>
                </View>

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

      {/* ── Detail Sheet ── */}
      <Modal visible={!!detailOwner} animationType="slide" transparent onRequestClose={() => setDetailOwner(null)}>
        <View style={s.modalBackdrop}>
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => setDetailOwner(null)} />
          <View style={s.modalSheet}>
            <View style={s.sheetHandle} />
            {detailOwner && (() => {
              const ownerTurfs  = getTurfsForOwner(detailOwner.id);
              const isActive    = detailOwner.status === "active";
              const detailColor = avatarColor(detailOwner.name || "?");
              const banking     = detailOwner.banking;
              const hasBanking  = !!banking?.accountNo;

              return (
                <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 32 }}>
                  {/* Header */}
                  <View style={s.detailHeader}>
                    <View style={[s.detailAvatar, { backgroundColor: detailColor }]}>
                      <Text style={s.detailAvatarText}>{initials(detailOwner.name || "?")}</Text>
                    </View>
                    <View style={{ marginLeft: 14, flex: 1 }}>
                      <Text style={s.detailName}>{detailOwner.name}</Text>
                      <Text style={s.detailBusiness}>{detailOwner.businessName}</Text>
                      <View style={[s.statusPill, isActive ? s.pillActive : s.pillInactive, { alignSelf: "flex-start", marginTop: 6 }]}>
                        <View style={[s.statusDot, { backgroundColor: isActive ? "#22C55E" : "#9CA3AF" }]} />
                        <Text style={[s.statusText, { color: isActive ? "#15803D" : "#6B7280" }]}>
                          {isActive ? "Active" : "Inactive"}
                        </Text>
                      </View>
                    </View>
                  </View>

                  {/* Info rows */}
                  {[
                    { icon: "mail-outline",         label: "Email",       value: detailOwner.email       || "—" },
                    { icon: "call-outline",          label: "Phone",       value: detailOwner.phone       || "Not added" },
                    { icon: "location-outline",      label: "Location",    value: detailOwner.location    || "Not added" },
                    { icon: "document-text-outline", label: "Description", value: detailOwner.description || "Not added" },
                  ].map((row) => (
                    <View key={row.label} style={s.detailRow}>
                      <View style={s.detailIconWrap}>
                        <Ionicons name={row.icon as any} size={16} color="#6B7280" />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={s.detailLabel}>{row.label}</Text>
                        <Text style={s.detailValue}>{row.value}</Text>
                      </View>
                    </View>
                  ))}

                  {/* ✅ Banking section in detail sheet */}
                  <TouchableOpacity
                    style={s.bankDetailHeader}
                    onPress={() => setShowBankingInDetail((v) => !v)}
                    activeOpacity={0.8}
                  >
                    <View style={s.bankDetailHeaderLeft}>
                      <Ionicons name="card-outline" size={15} color="#374151" />
                      <Text style={s.bankDetailTitle}>Banking Details</Text>
                      {hasBanking ? (
                        <View style={[s.bankVerifiedPill, banking?.verified ? s.bankVerifiedOn : s.bankVerifiedOff]}>
                          <Text style={[s.bankVerifiedText, { color: banking?.verified ? "#15803D" : "#B45309" }]}>
                            {banking?.verified ? "Verified" : "Unverified"}
                          </Text>
                        </View>
                      ) : (
                        <View style={s.bankMissingPill}>
                          <Text style={s.bankMissingText}>Not added</Text>
                        </View>
                      )}
                    </View>
                    <Ionicons name={showBankingInDetail ? "chevron-up" : "chevron-down"} size={16} color="#9CA3AF" />
                  </TouchableOpacity>

                  {showBankingInDetail && (
                    <View style={s.bankDetailBody}>
                      {hasBanking ? (
                        <>
                          {[
                            { label: "Account Holder", value: banking?.name       || "—" },
                            { label: "Account No.",    value: banking?.accountNo  ? `••••${banking.accountNo.slice(-4)}` : "—" },
                            { label: "IFSC Code",      value: banking?.ifsc       || "—" },
                            { label: "UPI ID",         value: banking?.upi        || "Not added" },
                          ].map((row) => (
                            <View key={row.label} style={s.bankDetailRow}>
                              <Text style={s.bankDetailLabel}>{row.label}</Text>
                              <Text style={s.bankDetailValue}>{row.value}</Text>
                            </View>
                          ))}

                          {/* ✅ Verify / Unverify toggle */}
                          <TouchableOpacity
                            style={[s.bankVerifyBtn, banking?.verified ? s.bankVerifyBtnOff : s.bankVerifyBtnOn]}
                            onPress={() => toggleBankingVerified(detailOwner)}
                            activeOpacity={0.8}
                          >
                            <Ionicons
                              name={banking?.verified ? "shield-outline" : "shield-checkmark-outline"}
                              size={15}
                              color={banking?.verified ? "#B45309" : "#15803D"}
                            />
                            <Text style={[s.bankVerifyBtnText, { color: banking?.verified ? "#B45309" : "#15803D" }]}>
                              {banking?.verified ? "Mark as Unverified" : "Mark as Verified"}
                            </Text>
                          </TouchableOpacity>
                        </>
                      ) : (
                        <View style={s.bankMissingBox}>
                          <Ionicons name="alert-circle-outline" size={20} color="#D97706" />
                          <Text style={s.bankMissingBoxText}>
                            No banking details on file. Edit this owner to add them.
                          </Text>
                        </View>
                      )}
                    </View>
                  )}

                  {/* Turfs section */}
                  <View style={s.detailTurfSection}>
                    <View style={s.detailTurfHeader}>
                      <Ionicons name="football-outline" size={15} color="#374151" />
                      <Text style={s.detailTurfTitle}>Turfs ({ownerTurfs.length})</Text>
                    </View>
                    {ownerTurfs.length === 0 ? (
                      <Text style={s.detailTurfEmpty}>No turfs assigned to this owner yet.</Text>
                    ) : (
                      ownerTurfs.map((t) => (
                        <View key={t.id} style={s.detailTurfRow}>
                          <View style={s.detailTurfDot} />
                          <View style={{ flex: 1 }}>
                            <Text style={s.detailTurfName}>{t.name || "Unnamed Turf"}</Text>
                            <Text style={s.detailTurfId}>ID: {t.id}</Text>
                          </View>
                          <View style={[s.turfStatusPill, { backgroundColor: t.status === "inactive" ? "#FEF2F2" : "#F0FDF4" }]}>
                            <Text style={[s.turfStatusText, { color: t.status === "inactive" ? "#DC2626" : "#15803D" }]}>
                              {t.status === "inactive" ? "Inactive" : "Active"}
                            </Text>
                          </View>
                        </View>
                      ))
                    )}
                  </View>

                  {/* Operators section */}
                  {(() => {
                    const ownerOps = operators.filter(op => op.ownerId === detailOwner.id);
                    return (
                      <View style={s.detailTurfSection}>
                        <View style={s.detailTurfHeader}>
                          <Ionicons name="people-outline" size={15} color="#374151" />
                          <Text style={s.detailTurfTitle}>Operators ({ownerOps.length})</Text>
                        </View>
                        {ownerOps.length === 0 ? (
                          <Text style={s.detailTurfEmpty}>No operators yet for this owner.</Text>
                        ) : (
                          ownerOps.map((op) => (
                            <View key={op.id} style={s.detailTurfRow}>
                              <View style={[s.detailTurfDot, { backgroundColor: op.status === "active" ? ACCENT : "#9CA3AF" }]} />
                              <View style={{ flex: 1 }}>
                                <Text style={s.detailTurfName}>{op.name || "Unnamed"}</Text>
                                <Text style={s.detailTurfId}>{op.email} · {op.turfName || "No turf"}</Text>
                              </View>
                              <View style={[s.turfStatusPill, { backgroundColor: op.status === "active" ? "#F0FDF4" : "#FEF2F2" }]}>
                                <Text style={[s.turfStatusText, { color: op.status === "active" ? "#15803D" : "#DC2626" }]}>
                                  {op.status === "active" ? "Active" : "Inactive"}
                                </Text>
                              </View>
                            </View>
                          ))
                        )}
                        <TouchableOpacity
                          style={[s.cancelBtn, { marginTop: 10, backgroundColor: "#F0FDF4" }]}
                          onPress={() => {
                            const owner = detailOwner;
                            setDetailOwner(null);
                            setTimeout(() => openOpModal(owner), 300);
                          }}
                        >
                          <Ionicons name="person-add-outline" size={15} color="#0F766E" />
                          <Text style={[s.cancelBtnText, { color: "#0F766E" }]}>Create Operator for this Owner</Text>
                        </TouchableOpacity>
                      </View>
                    );
                  })()}

                  {/* Action buttons */}
                  <TouchableOpacity
                    style={s.saveBtn}
                    onPress={() => {
                      const ownerToEdit = detailOwner;
                      setDetailOwner(null);
                      setTimeout(() => openEdit(ownerToEdit), 300);
                    }}
                  >
                    <Ionicons name="pencil-outline" size={18} color="#FFFFFF" />
                    <Text style={s.saveBtnText}>Edit Owner</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[s.cancelBtn, { marginTop: 10 }]}
                    onPress={() => toggleStatus(detailOwner)}
                  >
                    <Ionicons name={isActive ? "pause-circle-outline" : "play-circle-outline"} size={16} color={isActive ? "#B45309" : "#0F766E"} />
                    <Text style={[s.cancelBtnText, { color: isActive ? "#B45309" : "#0F766E" }]}>
                      {isActive ? "Disable Account" : "Enable Account"}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[s.cancelBtn, { marginTop: 10, backgroundColor: "#FEF2F2" }]}
                    onPress={() => {
                      const ownerToDelete = detailOwner;
                      setDetailOwner(null);
                      setTimeout(() => handleDelete(ownerToDelete), 300);
                    }}
                  >
                    <Ionicons name="trash-outline" size={16} color="#DC2626" />
                    <Text style={[s.cancelBtnText, { color: "#DC2626" }]}>Delete Owner</Text>
                  </TouchableOpacity>
                </ScrollView>
              );
            })()}
          </View>
        </View>
      </Modal>

      {/* ── Create Operator Modal ── */}
      <Modal visible={opModal} animationType="slide" transparent onRequestClose={() => setOpModal(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={s.modalBackdrop}>
            <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => setOpModal(false)} />
            <View style={s.modalSheet}>
              <View style={s.sheetHandle} />
              <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                <View style={s.modalHeader}>
                  <View>
                    <Text style={s.modalTitle}>Create Operator</Text>
                    <Text style={s.modalSub}>For {opForOwner?.name} — a login account will be created.</Text>
                  </View>
                  <TouchableOpacity style={s.closeBtn} onPress={() => setOpModal(false)}>
                    <Ionicons name="close" size={20} color="#374151" />
                  </TouchableOpacity>
                </View>

                {/* Basic fields */}
                {[
                  { label: "Full Name *",  key: "name",  placeholder: "Operator's full name",   caps: true  },
                  { label: "Email *",      key: "email", placeholder: "operator@email.com",      caps: false },
                  { label: "Phone *",      key: "phone", placeholder: "10-digit mobile number",  numeric: true },
                ].map(({ label, key, placeholder, caps, numeric }) => (
                  <View key={key}>
                    <Text style={s.fieldLabel}>{label}</Text>
                    <TextInput
                      style={s.input}
                      placeholder={placeholder}
                      placeholderTextColor="#9CA3AF"
                      value={(opForm as any)[key]}
                      onChangeText={(v) => setOpForm((f) => ({ ...f, [key]: v }))}
                      autoCapitalize={caps ? "words" : "none"}
                      keyboardType={numeric ? "phone-pad" : "default"}
                    />
                  </View>
                ))}

                <Text style={s.fieldLabel}>Temporary Password *</Text>
                <View style={s.pwRow}>
                  <TextInput
                    style={[s.input, { flex: 1 }]}
                    placeholder="Min. 6 characters"
                    placeholderTextColor="#9CA3AF"
                    value={opForm.password}
                    onChangeText={(v) => setOpForm((f) => ({ ...f, password: v }))}
                    secureTextEntry={!showOpPw}
                    autoCapitalize="none"
                  />
                  <TouchableOpacity style={s.eyeBtn} onPress={() => setShowOpPw(p => !p)}>
                    <Ionicons name={showOpPw ? "eye-off-outline" : "eye-outline"} size={18} color="#6B7280" />
                  </TouchableOpacity>
                </View>
                <Text style={s.disabledHint}>Share these credentials with the operator after creation.</Text>

                {/* Assign to turf (optional) */}
                {(() => {
                  const ownerTurfs = turfs.filter(t => t.ownerId === opForOwner?.id);
                  if (ownerTurfs.length === 0) return null;
                  return (
                    <View>
                      <Text style={s.fieldLabel}>Assign to Turf (Optional)</Text>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }}>
                        <View style={{ flexDirection: "row", gap: 8 }}>
                          <TouchableOpacity
                            style={[s.ownerChip, opTurfId === "" && s.ownerChipActive]}
                            onPress={() => setOpTurfId("")}
                          >
                            <Text style={[s.ownerChipText, opTurfId === "" && s.ownerChipTextActive]}>None</Text>
                          </TouchableOpacity>
                          {ownerTurfs.map(t => (
                            <TouchableOpacity
                              key={t.id}
                              style={[s.ownerChip, opTurfId === t.id && s.ownerChipActive]}
                              onPress={() => setOpTurfId(t.id)}
                            >
                              <Text style={[s.ownerChipText, opTurfId === t.id && s.ownerChipTextActive]}>
                                {t.name || "Unnamed"}
                              </Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                      </ScrollView>
                    </View>
                  );
                })()}

                <TouchableOpacity
                  style={[s.saveBtn, opSaving && { opacity: 0.6 }]}
                  onPress={createOperator}
                  disabled={opSaving}
                >
                  {opSaving
                    ? <ActivityIndicator color="#FFFFFF" />
                    : <><Ionicons name="person-add-outline" size={18} color="#FFFFFF" /><Text style={s.saveBtnText}>Create Operator</Text></>
                  }
                </TouchableOpacity>
                <TouchableOpacity style={s.cancelBtn} onPress={() => setOpModal(false)} disabled={opSaving}>
                  <Text style={s.cancelBtnText}>Cancel</Text>
                </TouchableOpacity>
                <View style={{ height: 24 }} />
              </ScrollView>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  safe:     { flex: 1, backgroundColor: "#F0F4F8" },
  loadWrap: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: DARK },
  loadText: { marginTop: 12, color: "#9CA3AF", fontSize: 15, fontWeight: "600" },
  list:     { paddingBottom: 100 },

  hero: { backgroundColor: DARK, paddingHorizontal: 20, paddingBottom: 24, overflow: "hidden" },
  heroGlow1:     { position: "absolute", top: -40, right: -40, width: 200, height: 200, borderRadius: 100, backgroundColor: "rgba(124,58,237,0.14)" },
  heroGlow2:     { position: "absolute", bottom: -60, left: -40, width: 180, height: 180, borderRadius: 90, backgroundColor: "rgba(14,165,164,0.10)" },
  heroTag:       { color: "#C4B5FD", fontSize: 11, fontWeight: "800", letterSpacing: 1.5, textTransform: "uppercase" },
  heroTitle:     { color: "#FFFFFF", fontSize: 28, fontWeight: "900", marginTop: 4 },
  heroSub:       { color: "#9CA3AF", fontSize: 13, lineHeight: 20, marginTop: 6 },
  heroStats:     { flexDirection: "row", gap: 8, marginTop: 18, flexWrap: "wrap" },
  heroStat:      { backgroundColor: "rgba(255,255,255,0.07)", borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, alignItems: "center", borderWidth: 1, borderColor: "rgba(255,255,255,0.08)" },
  heroStatValue: { fontSize: 20, fontWeight: "900" },
  heroStatLabel: { color: "#9CA3AF", fontSize: 11, fontWeight: "600", marginTop: 2 },

  toolbar:     { flexDirection: "row", gap: 10, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 4 },
  searchWrap:  { flex: 1, flexDirection: "row", alignItems: "center", backgroundColor: "#FFFFFF", borderRadius: 14, paddingHorizontal: 14, borderWidth: 1, borderColor: "#E5E7EB" },
  searchInput: { flex: 1, paddingVertical: 12, fontSize: 14, color: "#111827" },
  addBtn:      { backgroundColor: DARK, width: 46, height: 46, borderRadius: 14, justifyContent: "center", alignItems: "center" },
  sectionLabel:{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8, fontSize: 13, color: "#9CA3AF", fontWeight: "700" },

  card:      { backgroundColor: "#FFFFFF", marginHorizontal: 16, marginBottom: 12, borderRadius: 18, flexDirection: "row", overflow: "hidden", borderWidth: 1, borderColor: "#E5E7EB", shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 6, elevation: 2 },
  cardBar:   { width: 4 },
  cardInner: { flex: 1, padding: 14 },
  cardTop:   { flexDirection: "row", alignItems: "center" },

  avatar:       { width: 44, height: 44, borderRadius: 22, justifyContent: "center", alignItems: "center" },
  avatarText:   { color: "#FFFFFF", fontSize: 16, fontWeight: "800" },
  nameRow:      { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  ownerName:    { fontSize: 16, fontWeight: "800", color: "#111827", flex: 1 },
  businessName: { fontSize: 12, color: "#6B7280", marginTop: 2, fontWeight: "600" },
  emailText:    { fontSize: 11, color: "#9CA3AF", marginTop: 2 },

  statusPill:   { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  pillActive:   { backgroundColor: "#DCFCE7" },
  pillInactive: { backgroundColor: "#F3F4F6" },
  statusDot:    { width: 5, height: 5, borderRadius: 3 },
  statusText:   { fontSize: 10, fontWeight: "800" },

  chipRow:     { flexDirection: "row", gap: 8, marginTop: 10, flexWrap: "wrap" },
  infoChip:    { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#F9FAFB", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5, borderWidth: 1, borderColor: "#F3F4F6" },
  chipText:    { fontSize: 11, color: "#374151", fontWeight: "600" },
  bankVerified:  { backgroundColor: "#DCFCE7", borderColor: "#86EFAC" },
  bankUnverified:{ backgroundColor: "#FEF9C3", borderColor: "#FDE68A" },
  bankMissing:   { backgroundColor: "#F9FAFB", borderColor: "#E5E7EB" },

  turfSection:    { marginTop: 10, backgroundColor: "#F9FAFB", borderRadius: 10, padding: 10, borderWidth: 1, borderColor: "#F3F4F6" },
  turfHeaderRow:  { flexDirection: "row", alignItems: "center", gap: 5, marginBottom: 6 },
  turfHeaderText: { fontSize: 11, fontWeight: "700", color: "#6B7280" },
  turfChipsRow:   { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  turfChip:       { backgroundColor: "#E0F2FE", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  turfChipText:   { fontSize: 11, fontWeight: "700", color: "#0369A1" },

  cardActions:      { flexDirection: "row", gap: 8, marginTop: 12 },
  actionBtn:        { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#F3F4F6", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7 },
  actionBtnText:    { fontSize: 11, fontWeight: "700", color: "#374151" },
  actionDeactivate: { backgroundColor: "#FFFBEB" },
  actionActivate:   { backgroundColor: "#F0FDFA" },
  actionDelete:     { backgroundColor: "#FEF2F2" },

  fab: { position: "absolute", bottom: 32, right: 20, backgroundColor: DARK, width: 56, height: 56, borderRadius: 28, justifyContent: "center", alignItems: "center", shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 12, elevation: 8 },

  empty:       { margin: 16, backgroundColor: "#FFFFFF", borderRadius: 20, padding: 32, alignItems: "center", borderWidth: 1, borderColor: "#E5E7EB" },
  emptyTitle:  { fontSize: 18, fontWeight: "800", color: "#111827", marginTop: 12 },
  emptySub:    { fontSize: 13, color: "#9CA3AF", marginTop: 6, textAlign: "center" },
  emptyBtn:    { marginTop: 16, backgroundColor: DARK, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12 },
  emptyBtnText:{ color: "#FFFFFF", fontWeight: "700", fontSize: 14 },

  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  modalSheet:    { backgroundColor: "#FFFFFF", borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 20, paddingTop: 12, paddingBottom: Platform.OS === "ios" ? 34 : 20, maxHeight: "94%" },
  sheetHandle:   { width: 40, height: 4, borderRadius: 2, backgroundColor: "#E5E7EB", alignSelf: "center", marginBottom: 16 },
  modalHeader:   { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 },
  modalTitle:    { fontSize: 22, fontWeight: "900", color: "#111827" },
  modalSub:      { fontSize: 13, color: "#6B7280", marginTop: 4 },
  closeBtn:      { width: 36, height: 36, borderRadius: 18, backgroundColor: "#F3F4F6", justifyContent: "center", alignItems: "center" },

  fieldLabel:    { fontSize: 12, fontWeight: "700", color: "#374151", marginBottom: 6, marginTop: 14, textTransform: "uppercase", letterSpacing: 0.4 },
  input:         { backgroundColor: "#F9FAFB", borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: "#111827" },
  inputDisabled: { backgroundColor: "#F3F4F6", opacity: 0.7 },
  disabledHint:  { fontSize: 11, color: "#9CA3AF", marginTop: 5 },
  pwRow:         { flexDirection: "row", gap: 10, alignItems: "center" },
  eyeBtn:        { padding: 6 },

  toggleRow:    { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: "#F9FAFB", borderRadius: 14, padding: 14, marginTop: 16, borderWidth: 1, borderColor: "#E5E7EB" },
  toggleLabel:  { fontSize: 15, fontWeight: "700", color: "#111827" },
  toggleSub:    { fontSize: 12, color: "#9CA3AF", marginTop: 2 },

  // ✅ Banking section in modal
  bankSection:        { backgroundColor: "#F0FDFA", borderRadius: 14, padding: 14, marginTop: 20, borderWidth: 1, borderColor: "#99F6E4" },
  bankSectionHeader:  { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 },
  bankSectionTitle:   { fontSize: 14, fontWeight: "800", color: "#0F766E", flex: 1 },
  bankSectionOpt:     { fontSize: 11, color: "#9CA3AF", fontWeight: "600" },
  bankSectionRequired:{ fontSize: 11, color: "#DC2626", fontWeight: "700" },
  bankSectionSub:     { fontSize: 12, color: "#0F766E", lineHeight: 17, marginBottom: 4 },

  saveBtn:      { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: DARK, paddingVertical: 15, borderRadius: 16, marginTop: 24 },
  saveBtnText:  { color: "#FFFFFF", fontWeight: "800", fontSize: 15 },
  cancelBtn:    { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: "#F3F4F6", paddingVertical: 15, borderRadius: 16, marginTop: 10 },
  cancelBtnText:{ color: "#374151", fontWeight: "700", fontSize: 15 },

  // Detail sheet
  detailHeader:     { flexDirection: "row", alignItems: "center", marginBottom: 20 },
  detailAvatar:     { width: 60, height: 60, borderRadius: 30, justifyContent: "center", alignItems: "center" },
  detailAvatarText: { color: "#FFFFFF", fontSize: 22, fontWeight: "900" },
  detailName:       { fontSize: 20, fontWeight: "900", color: "#111827" },
  detailBusiness:   { fontSize: 13, color: "#6B7280", marginTop: 2 },
  detailRow:        { flexDirection: "row", alignItems: "flex-start", gap: 12, backgroundColor: "#F9FAFB", borderRadius: 12, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: "#F3F4F6" },
  detailIconWrap:   { width: 34, height: 34, borderRadius: 10, backgroundColor: "#F3F4F6", justifyContent: "center", alignItems: "center" },
  detailLabel:      { fontSize: 10, color: "#9CA3AF", fontWeight: "700", textTransform: "uppercase" },
  detailValue:      { fontSize: 14, color: "#111827", fontWeight: "600", marginTop: 2 },

  // ✅ Banking in detail sheet
  bankDetailHeader:     { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "#F9FAFB", borderRadius: 12, padding: 14, marginBottom: 4, borderWidth: 1, borderColor: "#E5E7EB", marginTop: 4 },
  bankDetailHeaderLeft: { flexDirection: "row", alignItems: "center", gap: 8 },
  bankDetailTitle:      { fontSize: 14, fontWeight: "800", color: "#111827" },
  bankVerifiedPill:     { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  bankVerifiedOn:       { backgroundColor: "#DCFCE7" },
  bankVerifiedOff:      { backgroundColor: "#FEF9C3" },
  bankVerifiedText:     { fontSize: 10, fontWeight: "800" },
  bankMissingPill:      { backgroundColor: "#F3F4F6", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  bankMissingText:      { fontSize: 10, fontWeight: "700", color: "#9CA3AF" },

  bankDetailBody:   { backgroundColor: "#F9FAFB", borderRadius: 12, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: "#E5E7EB" },
  bankDetailRow:    { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#F3F4F6" },
  bankDetailLabel:  { fontSize: 12, color: "#9CA3AF", fontWeight: "700" },
  bankDetailValue:  { fontSize: 13, color: "#111827", fontWeight: "700" },

  bankVerifyBtn:     { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, borderRadius: 10, marginTop: 12, borderWidth: 1.5 },
  bankVerifyBtnOn:   { backgroundColor: "#F0FDF4", borderColor: "#86EFAC" },
  bankVerifyBtnOff:  { backgroundColor: "#FFFBEB", borderColor: "#FDE68A" },
  bankVerifyBtnText: { fontSize: 13, fontWeight: "700" },

  bankMissingBox:     { flexDirection: "row", alignItems: "flex-start", gap: 10, backgroundColor: "#FFFBEB", borderRadius: 10, padding: 12 },
  bankMissingBoxText: { fontSize: 12, color: "#92400E", fontWeight: "600", flex: 1, lineHeight: 18 },

  detailTurfSection: { backgroundColor: "#F9FAFB", borderRadius: 14, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: "#E5E7EB", marginTop: 4 },
  detailTurfHeader:  { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 12 },
  detailTurfTitle:   { fontSize: 14, fontWeight: "800", color: "#111827" },
  detailTurfEmpty:   { fontSize: 13, color: "#9CA3AF", fontWeight: "500" },
  detailTurfRow:     { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#F3F4F6" },
  detailTurfDot:     { width: 8, height: 8, borderRadius: 4, backgroundColor: ACCENT },
  detailTurfName:    { fontSize: 14, fontWeight: "700", color: "#111827" },
  detailTurfId:      { fontSize: 10, color: "#9CA3AF", marginTop: 2 },
  turfStatusPill:    { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  turfStatusText:    { fontSize: 10, fontWeight: "800" },

  ownerChip:          { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: "#F3F4F6", marginRight: 8, borderWidth: 1, borderColor: "#E5E7EB" },
  ownerChipActive:    { backgroundColor: DARK, borderColor: DARK },
  ownerChipText:      { fontSize: 13, fontWeight: "600", color: "#374151" },
  ownerChipTextActive:{ color: "#FFFFFF" },


  
});
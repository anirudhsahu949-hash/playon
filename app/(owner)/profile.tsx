import {
  View,
  Text,
  StyleSheet,
  Image,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  
  StatusBar,
  RefreshControl,
  Alert,
  Modal,
  TextInput,
  Platform,
  Switch,
  KeyboardAvoidingView,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useEffect, useState } from "react";
import { auth, db } from "../../firebaseConfig";
import {
  doc,
  getDoc,
  collection,
  getDocs,
  query,
  where,
  updateDoc,
  deleteDoc,
} from "firebase/firestore";
import { signOut } from "firebase/auth";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

const SERVER_URL = "https://bookora-backend-95u4.onrender.com"; // ← your actual server URL

// ── Types ─────────────────────────────────────────────────────────────────────
type OwnerUser = {
  name?: string;
  email?: string;
  photo?: string;
  phone?: string;
  businessName?: string;
  location?: string;
  description?: string;
  banking?: {                    // ← ADD THIS
    accountNo?: string;
    ifsc?: string;
    name?: string;
    upi?: string | null;
    verified?: boolean;
    updatedAt?: any;
  };
};

type Operator = {
  id: string;
  name?: string;
  email?: string;
  phone?: string;
  status?: string;
  turfId?: string;
  turfName?: string;
};

type Turf = {
  id: string;
  name?: string;
  operatorId?: string;
  operatorName?: string;
  operatorEmail?: string;
};

// ── Initials helper ───────────────────────────────────────────────────────────
function initials(name: string) {
  return (name || "?").split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function OwnerProfile() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [user, setUser]             = useState<OwnerUser | null>(null);
  const [turfs, setTurfs]           = useState<Turf[]>([]);
  const [operators, setOperators]   = useState<Operator[]>([]);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Operator modal
  const [opModal, setOpModal]         = useState(false);
  const [opName, setOpName]           = useState("");
  const [opEmail, setOpEmail]         = useState("");
  const [opPhone, setOpPhone]         = useState("");
  const [opPassword, setOpPassword]   = useState("");
  const [opTurfId, setOpTurfId]       = useState("");
  const [showOpPw, setShowOpPw]       = useState(false);
  const [opSaving, setOpSaving]       = useState(false);

  // ── Banking Details Modal
const [showBankModal, setShowBankModal] = useState(false);
const [bankAccount, setBankAccount] = useState("");
const [bankIfsc, setBankIfsc] = useState("");
const [bankName, setBankName] = useState("");
const [bankUpi, setBankUpi] = useState("");
const [bankSaving, setBankSaving] = useState(false);

  

  useEffect(() => { fetchAll(); }, []);

  const fetchAll = async (isRefresh = false) => {
    const uid = auth.currentUser?.uid;
    if (!uid) { setLoading(false); return; }
    isRefresh ? setRefreshing(true) : setLoading(true);
    try {
      const [userSnap, turfSnap, bookingSnap, opSnap] = await Promise.all([
        getDoc(doc(db, "users", uid)),
        getDocs(query(collection(db, "turfs"), where("ownerId", "==", uid))),
        getDocs(query(collection(db, "bookings"), where("ownerId", "==", uid))),
        getDocs(query(collection(db, "users"), where("role", "==", "turf-operator"), where("ownerId", "==", uid))),
      ]);

      if (userSnap.exists()) setUser(userSnap.data() as OwnerUser);

      const turfData = turfSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Turf));
      setTurfs(turfData);

      const opData = opSnap.docs.map((d) => {
        const raw = d.data();
        // Find which turf this operator is assigned to
        const assignedTurf = turfData.find((t) => t.operatorId === d.id);
        return {
          id: d.id,
          ...raw,
          turfId:   assignedTurf?.id   || raw.turfId   || "",
          turfName: assignedTurf?.name || raw.turfName || "",
        } as Operator;
      });
      setOperators(opData);

      let earnings = 0;
      bookingSnap.forEach((d) => {
        const b = d.data();
        if (b.status !== "cancelled") earnings += Number(b.paidAmount || b.advanceAmount || 0);
      });
    

    } catch (e) {
      console.log(e);
      Alert.alert("Error", "Unable to load profile.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  // ── Create operator via server ────────────────────────────────────────────
  const createOperator = async () => {
    if (!opName.trim())  return Alert.alert("Required", "Operator name is required.");
    if (!opEmail.trim() || !opEmail.includes("@")) return Alert.alert("Required", "Valid email is required.");
    if (opPassword.length < 6) return Alert.alert("Required", "Password must be at least 6 characters.");
    if (!opPhone.trim()) return Alert.alert("Required", "Phone number is required.");

    setOpSaving(true);
    try {
      const uid = auth.currentUser!.uid;
      const res = await fetch(`${SERVER_URL}/create-operator`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name:     opName.trim(),
          email:    opEmail.trim().toLowerCase(),
          password: opPassword,
          phone:    opPhone.trim(),
          ownerId:  uid,
          role:     "turf-operator",
          status:   "active",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create operator");

      // If a turf was selected, assign operator to it
      if (opTurfId) {
        await updateDoc(doc(db, "turfs", opTurfId), {
          operatorId:    data.uid,
          operatorName:  opName.trim(),
          operatorEmail: opEmail.trim().toLowerCase(),
        });
      }

      Alert.alert(
        "Operator Created ✓",
        `${opName} can now log in:\n\nEmail: ${opEmail}\nPassword: ${opPassword}`
      );

      setOpModal(false);
      setOpName(""); setOpEmail(""); setOpPassword(""); setOpPhone(""); setOpTurfId("");
      await fetchAll(true);
    } catch (e: any) {
      Alert.alert("Error", e.message || "Something went wrong.");
    } finally {
      setOpSaving(false);
    }
  };


  // ── Validate Bank Details ─────────────────────────────────────────────
const validateBankDetails = (): string | null => {
  const accountNo = bankAccount.trim();
  const ifsc = bankIfsc.trim().toUpperCase();
  const name = bankName.trim();

  if (!accountNo || accountNo.length < 9) {
    return "Account number must be at least 9 digits";
  }

  if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) {
    return "Invalid IFSC code (e.g., SBIN0001234)";
  }

  if (!name || name.length < 3) {
    return "Account holder name required";
  }

  return null;
};

// ── Save Bank Details ─────────────────────────────────────────────────
const handleSaveBankDetails = async () => {
  const error = validateBankDetails();
  if (error) {
    return Alert.alert("Validation Error", error);
  }

  setBankSaving(true);
  try {
    const uid = auth.currentUser?.uid;
    if (!uid) throw new Error("Not authenticated");

    await updateDoc(doc(db, "users", uid), {
      banking: {
        accountNo: bankAccount.trim(),
        ifsc: bankIfsc.trim().toUpperCase(),
        name: bankName.trim(),
        upi: bankUpi.trim() || null,
        verified: false,
        updatedAt: new Date(),
      },
    });

    setShowBankModal(false);
    await fetchAll(true);
    Alert.alert("✅ Saved", "Bank details saved. Admin will verify soon.");
  } catch (err: any) {
    Alert.alert("Error", err.message || "Could not save");
  } finally {
    setBankSaving(false);
  }
};

// ── Open Bank Modal (populate if exists) ───────────────────────────────
const openBankModal = () => {
  if (user?.banking) {
    setBankAccount(user.banking.accountNo || "");
    setBankIfsc(user.banking.ifsc || "");
    setBankName(user.banking.name || "");
    setBankUpi(user.banking.upi || "");
  } else {
    setBankAccount("");
    setBankIfsc("");
    setBankName("");
    setBankUpi("");
  }
  setShowBankModal(true);
};

  // ── Toggle operator status ────────────────────────────────────────────────
  const toggleOperatorStatus = async (op: Operator) => {
    const next = op.status === "active" ? "inactive" : "active";
    try {
      await updateDoc(doc(db, "users", op.id), { status: next });
      setOperators((prev) => prev.map((o) => o.id === op.id ? { ...o, status: next } : o));
    } catch {
      Alert.alert("Error", "Could not update status.");
    }
  };

  // ── Delete operator ───────────────────────────────────────────────────────
  const deleteOperator = (op: Operator) => {
    Alert.alert(
      "Remove Operator",
      `Remove ${op.name}? Their login account will also be deleted.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove", style: "destructive",
          onPress: async () => {
            try {
              const res = await fetch(`${SERVER_URL}/delete-owner/${op.id}`, { method: "DELETE" });
              const data = await res.json();
              if (!res.ok) throw new Error(data.error || "Failed");

              // Unassign from turf if assigned
              if (op.turfId) {
                await updateDoc(doc(db, "turfs", op.turfId), {
                  operatorId: "", operatorName: "", operatorEmail: "",
                });
              }

              setOperators((prev) => prev.filter((o) => o.id !== op.id));
            } catch (e: any) {
              Alert.alert("Error", e.message);
            }
          },
        },
      ]
    );
  };

const handleLogout = async () => {
  // On web, Alert.alert doesn't work - just logout directly
  if (Platform.OS === 'web') {
    try {
      await signOut(auth);
      router.replace("/login");
    } catch (err: any) {
      Alert.alert("Error", err.message || "Logout failed");
    }
    return;
  }

  // On native, show confirmation
  Alert.alert("Logout", "Are you sure?", [
    { text: "Cancel", style: "cancel" },
    { text: "Logout", style: "destructive", onPress: () => signOut(auth).then(() => router.replace("/login")) },
  ]);
};



  // ── Loading ───────────────────────────────────────────────────────────────
  if (loading) return (
    <SafeAreaView style={s.center}>
      <StatusBar barStyle="light-content" backgroundColor="#081120" />
      <ActivityIndicator size="large" color="#0F766E" />
      <Text style={s.loadText}>Loading profile...</Text>
    </SafeAreaView>
  );

  return (
    <View style={s.safe}>
      <StatusBar barStyle="light-content" backgroundColor="#081120" />

      <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" automaticallyAdjustKeyboardInsets
        showsVerticalScrollIndicator={false}
        contentContainerStyle={s.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => fetchAll(true)} />}
      >
        {/* ── Hero ── */}
         <View style={[s.hero, { paddingTop: insets.top + 12 }]}>
          <View style={s.glow1} /><View style={s.glow2} />

          <View style={s.heroTop}>
            <Text style={s.heroTag}>Owner Profile</Text>
            <TouchableOpacity style={s.editBtn} onPress={() => router.push("/(owner)/edit-profile")}>
              <Ionicons name="pencil-outline" size={14} color="#fff" />
              <Text style={s.editBtnText}>Edit</Text>
            </TouchableOpacity>
          </View>

          <Image
            source={{ uri: user?.photo || "https://cdn-icons-png.flaticon.com/512/149/149071.png" }}
            style={s.avatar}
          />
          <Text style={s.name}>{user?.name || "Owner"}</Text>
          <Text style={s.email}>{user?.email || "No email"}</Text>
          <View style={s.badge}>
            <Ionicons name="business-outline" size={12} color="#E7F6F4" style={{ marginRight: 5 }} />
            <Text style={s.badgeText}>Business Account</Text>
          </View>
        </View>

        {/* ── Stats row ── */}
       

        {/* ── Business info ── */}
        <View style={s.card}>
          <Text style={s.cardTitle}>Business Information</Text>
          {[
            { label: "Business Name", value: user?.businessName },
            { label: "Location",      value: user?.location },
            { label: "Phone",         value: user?.phone },
          ].map((row) => (
            <View key={row.label}>
              <View style={s.infoRow}>
                <Text style={s.infoLabel}>{row.label}</Text>
                <Text style={s.infoValue}>{row.value || "Not added yet"}</Text>
              </View>
              <View style={s.divider} />
            </View>
          ))}
          {user?.description ? (
            <View style={s.infoRow}>
              <Text style={s.infoLabel}>Description</Text>
              <Text style={s.infoDesc}>{user.description}</Text>
            </View>
          ) : null}
        </View>

        {/* ── BANK DETAILS CARD ── */}
        <View style={s.card}>
          <View style={s.bankCardHeader}>
            <Text style={s.cardTitle}>Bank Details for Payouts</Text>
            {user?.banking?.verified && (
              <View style={s.verifiedBadge}>
                <Text style={s.verifiedBadgeText}>✓ Verified</Text>
              </View>
            )}
          </View>

          {user?.banking ? (
            // ── EXISTING BANK DETAILS ──
            <View style={s.bankDetailsDisplay}>
              <View style={s.bankInfoRow}>
                <Text style={s.infoLabel}>Account Holder</Text>
                <Text style={s.infoValue}>{user.banking.name}</Text>
              </View>
              <View style={s.divider} />

              <View style={s.bankInfoRow}>
                <Text style={s.infoLabel}>Account Number</Text>
                <Text style={s.infoValue}>****{user.banking.accountNo?.slice(-4)}</Text>
              </View>
              <View style={s.divider} />

              <View style={s.bankInfoRow}>
                <Text style={s.infoLabel}>IFSC Code</Text>
                <Text style={s.infoValue}>{user.banking.ifsc}</Text>
              </View>

              {user.banking.upi && (
                <>
                  <View style={s.divider} />
                  <View style={s.bankInfoRow}>
                    <Text style={s.infoLabel}>UPI</Text>
                    <Text style={s.infoValue}>{user.banking.upi}</Text>
                  </View>
                </>
              )}

              {!user.banking.verified && (
                <View style={s.pendingNote}>
                  <Ionicons name="information-circle-outline" size={16} color="#F59E0B" />
                  <Text style={s.pendingNoteText}>
                    ⏳ Admin is verifying your details. You'll be notified when approved.
                  </Text>
                </View>
              )}

              <TouchableOpacity
                style={s.editBankBtn}
                onPress={openBankModal}
              >
                <Ionicons name="pencil-outline" size={14} color="#fff" />
                <Text style={s.editBankBtnText}>Edit Bank Details</Text>
              </TouchableOpacity>
            </View>
          ) : (
            // ── NO BANK DETAILS YET ──
            <View style={s.bankEmpty}>
              <Ionicons name="card-outline" size={40} color="#D1D5DB" />
              <Text style={s.bankEmptyTitle}>No Bank Details Added</Text>
              <Text style={s.bankEmptySub}>
                Add your bank account to receive settlement payouts from bookings.
              </Text>
              <TouchableOpacity
                style={s.addBankBtn}
                onPress={openBankModal}
              >
                <Ionicons name="add-outline" size={16} color="#fff" />
                <Text style={s.addBankBtnText}>Add Bank Details</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* ── My Turfs (quick list) ── */}
        {turfs.length > 0 && (
          <View style={s.card}>
            <View style={s.cardHeader}>
              <Text style={s.cardTitle}>My Turfs</Text>
              <TouchableOpacity onPress={() => router.push("/(owner)/MyTurfs" as any)}>
                <Text style={s.cardLink}>Manage →</Text>
              </TouchableOpacity>
            </View>
            {turfs.map((turf) => (
              <View key={turf.id} style={s.turfRow}>
                <View style={s.turfIcon}>
                  <Ionicons name="football-outline" size={18} color="#22C55E" />
                </View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={s.turfName}>{turf.name || "Unnamed"}</Text>
                  {turf.operatorName
                    ? <Text style={s.turfOp}>👤 {turf.operatorName}</Text>
                    : <Text style={s.turfOpEmpty}>No operator assigned</Text>}
                </View>
                <View style={[s.turfStatusPill, { backgroundColor: turf.operatorId ? "#DCFCE7" : "#F3F4F6" }]}>
                  <Text style={[s.turfStatusText, { color: turf.operatorId ? "#15803D" : "#9CA3AF" }]}>
                    {turf.operatorId ? "Assigned" : "Unassigned"}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        )}

        {/* ── Operators section ── */}
        

        {/* ── Quick actions ── */}
        <View style={s.card}>
          <Text style={s.cardTitle}>Account</Text>
          <TouchableOpacity style={s.primaryBtn} onPress={() => router.push("/(owner)/edit-profile")}>
            <Ionicons name="pencil-outline" size={16} color="#fff" style={{ marginRight: 8 }} />
            <Text style={s.primaryBtnText}>Edit Profile</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.dangerBtn} onPress={handleLogout}>
            <Ionicons name="log-out-outline" size={16} color="#B42318" style={{ marginRight: 8 }} />
            <Text style={s.dangerBtnText}>Logout</Text>
          </TouchableOpacity>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* ══ ADD OPERATOR MODAL ══════════════════════════════ */}
      <Modal visible={opModal} animationType="slide" transparent onRequestClose={() => setOpModal(false)}>
        <KeyboardAvoidingView style={m.backdrop} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => setOpModal(false)} />
          <View style={m.sheet}>
            <View style={m.handle} />

            <Text style={m.title}>Add Operator</Text>
            <Text style={m.sub}>A login account will be created for the operator.</Text>

            <ScrollView keyboardDismissMode="interactive" showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              {/* Info banner */}
              <View style={m.banner}>
                <Ionicons name="information-circle-outline" size={16} color="#3B82F6" />
                <Text style={m.bannerText}>
                  The operator will be able to log in with these credentials and see today's bookings.
                </Text>
              </View>

              {[
                { label: "Full Name *",  val: opName,  set: setOpName,  ph: "Operator's full name",   kb: "default" as const },
                { label: "Email *",      val: opEmail, set: setOpEmail, ph: "operator@email.com",     kb: "email-address" as const },
                { label: "Phone *",      val: opPhone, set: setOpPhone, ph: "10-digit mobile number", kb: "phone-pad" as const },
              ].map((f) => (
                <View key={f.label}>
                  <Text style={m.fieldLabel}>{f.label}</Text>
                  <TextInput
                    style={m.input} placeholder={f.ph} placeholderTextColor="#9CA3AF"
                    value={f.val} onChangeText={f.set}
                    keyboardType={f.kb}
                    autoCapitalize={f.kb === "email-address" ? "none" : "words"}
                  />
                </View>
              ))}

              <Text style={m.fieldLabel}>Temporary Password *</Text>
              <View style={m.pwRow}>
                <TextInput
                  style={[m.input, { flex: 1 }]} placeholder="Min. 6 characters"
                  placeholderTextColor="#9CA3AF" value={opPassword} onChangeText={setOpPassword}
                  secureTextEntry={!showOpPw} autoCapitalize="none"
                />
                <TouchableOpacity style={m.eyeBtn} onPress={() => setShowOpPw((p) => !p)}>
                  <Ionicons name={showOpPw ? "eye-off-outline" : "eye-outline"} size={18} color="#9CA3AF" />
                </TouchableOpacity>
              </View>
              <Text style={m.hint}>Share this with the operator after creation.</Text>

              {/* Assign to turf */}
              {turfs.length > 0 && (
                <>
                  <Text style={m.fieldLabel}>Assign to Turf (optional)</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 4 }}>
                    <TouchableOpacity
                      style={[m.turfChip, !opTurfId && m.turfChipActive]}
                      onPress={() => setOpTurfId("")}
                    >
                      <Text style={[m.turfChipText, !opTurfId && m.turfChipTextActive]}>None</Text>
                    </TouchableOpacity>
                    {turfs.map((turf) => (
                      <TouchableOpacity
                        key={turf.id}
                        style={[m.turfChip, opTurfId === turf.id && m.turfChipActive]}
                        onPress={() => setOpTurfId(turf.id)}
                      >
                        <Text style={[m.turfChipText, opTurfId === turf.id && m.turfChipTextActive]}>
                          {turf.name || "Unnamed"}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </>
              )}

              <TouchableOpacity
                style={[m.saveBtn, opSaving && { opacity: 0.6 }]}
                onPress={createOperator}
                disabled={opSaving}
              >
                {opSaving
                  ? <ActivityIndicator color="#fff" />
                  : <>
                      <Ionicons name="person-add-outline" size={16} color="#fff" style={{ marginRight: 8 }} />
                      <Text style={m.saveBtnText}>Create Operator</Text>
                    </>
                }
              </TouchableOpacity>

              <TouchableOpacity style={m.cancelBtn} onPress={() => setOpModal(false)} disabled={opSaving}>
                <Text style={m.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>

              <View style={{ height: 24 }} />
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ══ BANK DETAILS MODAL ════════════════════════════════ */}
      <Modal visible={showBankModal} transparent animationType="slide" onRequestClose={() => setShowBankModal(false)}>
        <KeyboardAvoidingView style={m.backdrop} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => setShowBankModal(false)} />
          <View style={m.sheet}>
            <View style={m.handle} />

            <Text style={m.title}>Bank Account Details</Text>
            <Text style={m.sub}>Enter your bank account for receiving payouts</Text>

            <ScrollView keyboardDismissMode="interactive" showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              {/* Account Holder Name */}
              <Text style={m.fieldLabel}>Account Holder Name *</Text>
              <TextInput
                style={m.input}
                placeholder="Your name as per bank records"
                placeholderTextColor="#9CA3AF"
                value={bankName}
                onChangeText={setBankName}
                autoCapitalize="words"
              />

              {/* Account Number */}
              <Text style={m.fieldLabel}>Account Number *</Text>
              <TextInput
                style={m.input}
                placeholder="123456789012"
                placeholderTextColor="#9CA3AF"
                value={bankAccount}
                onChangeText={setBankAccount}
                keyboardType="number-pad"
              />
              <Text style={m.hint}>9-18 digits without spaces</Text>

              {/* IFSC Code */}
              <Text style={m.fieldLabel}>IFSC Code *</Text>
              <TextInput
                style={m.input}
                placeholder="SBIN0001234"
                placeholderTextColor="#9CA3AF"
                value={bankIfsc}
                onChangeText={(v) => setBankIfsc(v.toUpperCase())}
                autoCapitalize="characters"
                maxLength={11}
              />
              <Text style={m.hint}>Format: 4 letters + 0 + 6 alphanumeric</Text>

              {/* UPI (Optional) */}
              <Text style={m.fieldLabel}>UPI Address (Optional)</Text>
              <TextInput
                style={m.input}
                placeholder="yourname@bankname"
                placeholderTextColor="#9CA3AF"
                value={bankUpi}
                onChangeText={setBankUpi}
                autoCapitalize="none"
              />

              {/* Save Button */}
              <TouchableOpacity
                style={[m.saveBtn, bankSaving && { opacity: 0.6 }]}
                onPress={handleSaveBankDetails}
                disabled={bankSaving}
              >
                <Text style={m.saveBtnText}>
                  {bankSaving ? "Saving..." : "Save Bank Details"}
                </Text>
              </TouchableOpacity>

              {/* Cancel Button */}
              <TouchableOpacity
                style={m.cancelBtn}
                onPress={() => setShowBankModal(false)}
                disabled={bankSaving}
              >
                <Text style={m.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>

              {/* Important Note */}
              <View style={m.bankNoteBox}>
                <Ionicons name="shield-checkmark-outline" size={16} color="#059669" />
                <Text style={m.bankNoteText}>
                  Your bank details are secure and will be used only for settlements. Admin will verify before processing payouts.
                </Text>
              </View>

              <View style={{ height: 20 }} />
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const DARK = "#081120";
const GREEN = "#22C55E";

const s = StyleSheet.create({
  safe:     { flex: 1, backgroundColor: "#EEF4F7" },
  scroll:   { paddingBottom: 24 },
  center:   { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#EEF4F7" },
  loadText: { marginTop: 12, fontSize: 15, color: "#4B6575", fontWeight: "600" },

  // Hero
  hero: {
    backgroundColor: DARK,
    paddingHorizontal: 20,
  
    paddingBottom: 36,
    borderBottomLeftRadius: 28, borderBottomRightRadius: 28,
    alignItems: "center", overflow: "hidden",
  },
  glow1: { position: "absolute", top: -20, right: -30, width: 160, height: 160, borderRadius: 80, backgroundColor: "rgba(15,118,110,0.22)" },
  glow2: { position: "absolute", bottom: -60, left: -40, width: 180, height: 180, borderRadius: 90, backgroundColor: "rgba(56,189,248,0.08)" },
  heroTop:     { width: "100%", flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 24 },
  heroTag:     { color: "#9DB3C3", fontSize: 13, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.8 },
  editBtn:     { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: "rgba(255,255,255,0.1)", borderWidth: 1, borderColor: "rgba(255,255,255,0.12)" },
  editBtnText: { color: "#fff", fontSize: 13, fontWeight: "700" },
  avatar:      { width: 96, height: 96, borderRadius: 48, borderWidth: 3, borderColor: "rgba(255,255,255,0.18)", backgroundColor: "#D6E3EA" },
  name:        { color: "#fff", fontSize: 22, fontWeight: "900", marginTop: 14 },
  email:       { color: "#A8BFCE", fontSize: 13, marginTop: 5 },
  badge:       { flexDirection: "row", alignItems: "center", marginTop: 12, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, backgroundColor: "rgba(255,255,255,0.08)", borderWidth: 1, borderColor: "rgba(255,255,255,0.1)" },
  badgeText:   { color: "#E7F6F4", fontSize: 12, fontWeight: "700" },

  // Stats


  // Card
  card:       { backgroundColor: "#fff", marginHorizontal: 16, marginTop: 16, borderRadius: 22, padding: 18, borderWidth: 1, borderColor: "#E5E7EB", shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 6, elevation: 2 },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 },
  cardTitle:  { fontSize: 17, fontWeight: "900", color: "#0F172A", marginBottom: 14 },
  cardSub:    { fontSize: 12, color: "#9CA3AF", marginTop: 2 },
  cardLink:   { fontSize: 13, fontWeight: "700", color: "#16A34A" },

  // Info rows
  infoRow:   { paddingVertical: 4 },
  infoLabel: { color: "#6A7E8B", fontSize: 11, fontWeight: "700", marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.4 },
  infoValue: { color: "#0F172A", fontSize: 14, fontWeight: "600" },
  infoDesc:  { color: "#4D6475", fontSize: 14, lineHeight: 22, fontWeight: "500" },
  divider:   { height: 1, backgroundColor: "#F3F4F6", marginVertical: 12 },

  // Turf rows in profile
  turfRow:         { flexDirection: "row", alignItems: "center", paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "#F3F4F6" },
  turfIcon:        { width: 40, height: 40, borderRadius: 12, backgroundColor: "#F0FDF4", justifyContent: "center", alignItems: "center" },
  turfName:        { fontSize: 14, fontWeight: "800", color: "#0F172A" },
  turfOp:          { fontSize: 12, color: "#6B7280", marginTop: 2 },
  turfOpEmpty:     { fontSize: 12, color: "#D1D5DB", marginTop: 2 },
  turfStatusPill:  { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  turfStatusText:  { fontSize: 11, fontWeight: "700" },

  // Operator cards
  addOpBtn:     { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: DARK, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 12 },
  addOpBtnText: { color: "#fff", fontSize: 13, fontWeight: "700" },

  opEmpty:      { alignItems: "center", paddingVertical: 28, gap: 8 },
  opEmptyTitle: { fontSize: 16, fontWeight: "800", color: "#374151" },
  opEmptySub:   { fontSize: 13, color: "#9CA3AF", textAlign: "center" },
  opEmptyBtn:   { marginTop: 8, backgroundColor: DARK, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 12 },
  opEmptyBtnText:{ color: "#fff", fontWeight: "700", fontSize: 13 },

  opCard:        { flexDirection: "row", alignItems: "center", paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: "#F3F4F6", overflow: "hidden" },
  opBar:         { width: 3, height: "100%", position: "absolute", left: 0, borderRadius: 2 },
  opAvatar:      { width: 44, height: 44, borderRadius: 22, justifyContent: "center", alignItems: "center", marginLeft: 10 },
  opAvatarText:  { fontSize: 15, fontWeight: "900" },
  opName:        { fontSize: 14, fontWeight: "800", color: "#0F172A" },
  opEmail:       { fontSize: 12, color: "#9CA3AF", marginTop: 2 },
  opPhone:       { fontSize: 12, color: "#6B7280", marginTop: 1 },
  opTurf:        { fontSize: 11, color: "#16A34A", marginTop: 3, fontWeight: "600" },
  opTurfEmpty:   { fontSize: 11, color: "#D1D5DB", marginTop: 3 },
  opActions:     { alignItems: "center", gap: 6 },
  opDeleteBtn:   { width: 32, height: 32, borderRadius: 10, backgroundColor: "#FEF2F2", justifyContent: "center", alignItems: "center" },

  // Buttons
  primaryBtn:     { flexDirection: "row", alignItems: "center", justifyContent: "center", backgroundColor: DARK, paddingVertical: 14, borderRadius: 14, marginTop: 4 },
  primaryBtnText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  dangerBtn:      { flexDirection: "row", alignItems: "center", justifyContent: "center", backgroundColor: "#FEF2F2", paddingVertical: 14, borderRadius: 14, marginTop: 10, borderWidth: 1, borderColor: "#FECACA" },
  dangerBtnText:  { color: "#B42318", fontWeight: "700", fontSize: 15 },

  // Bank Details
  bankCardHeader:      { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 14 },
  verifiedBadge:       { backgroundColor: "#D1FAE5", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  verifiedBadgeText:   { color: "#059669", fontSize: 11, fontWeight: "700" },
  
  bankDetailsDisplay:  { borderTopWidth: 1, borderTopColor: "#F3F4F6", paddingTop: 12 },
  bankInfoRow:         { paddingVertical: 10 },
  
  bankEmpty:           { alignItems: "center", paddingVertical: 30, gap: 12 },
  bankEmptyTitle:      { fontSize: 15, fontWeight: "800", color: "#111827" },
  bankEmptySub:        { fontSize: 12, color: "#9CA3AF", textAlign: "center", lineHeight: 18 },
  
  addBankBtn:          { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: DARK, borderRadius: 12, paddingVertical: 12, marginTop: 12 },
  addBankBtnText:      { color: "#FFFFFF", fontWeight: "800", fontSize: 13 },
  
  editBankBtn:         { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: "#F3F4F6", borderRadius: 12, padding: 12, marginTop: 12 },
  editBankBtnText:     { fontSize: 13, fontWeight: "700", color: "#0A0F1E" },
  
  pendingNote:         { flexDirection: "row", alignItems: "flex-start", gap: 8, backgroundColor: "#FFFBEB", borderRadius: 10, padding: 10, marginTop: 12, marginBottom: 12 },
  pendingNoteText:     { flex: 1, fontSize: 11, color: "#92400E", fontWeight: "600", lineHeight: 16 },
});

// ── Modal styles ──────────────────────────────────────────────────────────────
const m = StyleSheet.create({
  backdrop:    { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheet:       { backgroundColor: "#fff", borderTopLeftRadius: 28, borderTopRightRadius: 28, maxHeight: "92%", paddingHorizontal: 20, paddingTop: 12, paddingBottom: Platform.OS === "ios" ? 34 : 20 },
  handle:      { width: 40, height: 4, borderRadius: 2, backgroundColor: "#E5E7EB", alignSelf: "center", marginBottom: 20 },
  title:       { fontSize: 22, fontWeight: "900", color: "#0F172A" },
  sub:         { fontSize: 13, color: "#9CA3AF", marginTop: 4, marginBottom: 16 },
  banner:      { flexDirection: "row", alignItems: "flex-start", gap: 8, backgroundColor: "#EFF6FF", borderRadius: 12, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: "#BFDBFE" },
  bannerText:  { fontSize: 12, color: "#1D4ED8", fontWeight: "600", flex: 1, lineHeight: 18 },
  fieldLabel:  { fontSize: 11, fontWeight: "800", color: "#6B7280", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 7, marginTop: 14 },
  input:       { backgroundColor: "#F9FAFB", borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13, fontSize: 14, color: "#0F172A" },
  hint:        { fontSize: 11, color: "#9CA3AF", marginTop: 5 },
  pwRow:       { flexDirection: "row", alignItems: "center", gap: 8 },
  eyeBtn:      { padding: 8 },
  turfChip:    { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20, backgroundColor: "#F3F4F6", borderWidth: 1, borderColor: "#E5E7EB" },
  turfChipActive:    { backgroundColor: DARK, borderColor: DARK },
  turfChipText:      { fontSize: 13, fontWeight: "700", color: "#6B7280" },
  turfChipTextActive:{ color: "#fff" },
  saveBtn:     { flexDirection: "row", alignItems: "center", justifyContent: "center", backgroundColor: DARK, paddingVertical: 15, borderRadius: 16, marginTop: 24 },
  saveBtnText: { color: "#fff", fontWeight: "800", fontSize: 15 },
  cancelBtn:   { backgroundColor: "#F3F4F6", paddingVertical: 14, borderRadius: 16, alignItems: "center", marginTop: 10 },
  cancelBtnText:{ color: "#374151", fontWeight: "700", fontSize: 15 },
  bankNoteBox:        { flexDirection: "row", alignItems: "flex-start", gap: 8, backgroundColor: "#F0FDF4", borderRadius: 12, padding: 12, marginTop: 16, gap: 8 },
  bankNoteText:       { flex: 1, fontSize: 11, color: "#166534", fontWeight: "600", lineHeight: 16 },
});
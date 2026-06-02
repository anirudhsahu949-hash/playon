import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  SafeAreaView,
  StatusBar,
  RefreshControl,
  Alert,
  Modal,
  TextInput,
  Platform,
  Switch,
} from "react-native";
import { useEffect, useState } from "react";
import { auth, db } from "../../firebaseConfig";
import {
  doc,
  collection,
  getDocs,
  query,
  where,
  updateDoc,
} from "firebase/firestore";
import { getIdToken } from "firebase/auth";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

const SERVER_URL = "https://bookora-backend-95u4.onrender.com";

// ── Types ─────────────────────────────────────────────────────────────────────
// ✅ MULTI-TURF: operator.turfIds is now string[] not a single string
type Operator = {
  id: string;
  name?: string;
  email?: string;
  phone?: string;
  status?: string;
  turfIds?: string[];   // ← NEW: array of assigned turf IDs
  turfId?: string;      // ← LEGACY: kept for backwards compat read
  ownerId?: string;
};

// ✅ MULTI-TURF: turf.operatorIds is now string[] not a single string
type Turf = {
  id: string;
  name?: string;
  location?: string;
  operatorIds?: string[];   // ← NEW: array of assigned operator IDs
  operatorId?: string;      // ← LEGACY: kept for backwards compat read
  operatorName?: string;
  operatorEmail?: string;
  openingTime?: number;
  closingTime?: number;
  slotDuration?: number;
  dayPrice?: number;
  nightPrice?: number;
  bookingPrice?: number;
  sport?: string | string[];
  active?: boolean;
    status?: string;
  statusNote?: string;
  statusUpdatedAt?: string;
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function initials(name: string) {
  return (name || "?").split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
}

function fmtHour(h: number): string {
  if (h === 0 || h === 24) return "12:00 AM";
  if (h === 12) return "12:00 PM";
  return h < 12 ? `${h}:00 AM` : `${h - 12}:00 PM`;
}

// Get canonical operatorIds[] for a turf — handles both new array + legacy single string
function getTurfOperatorIds(turf: Turf): string[] {
  if (Array.isArray(turf.operatorIds) && turf.operatorIds.length > 0) return turf.operatorIds;
  if (turf.operatorId) return [turf.operatorId];
  return [];
}

// Get canonical turfIds[] for an operator — handles both new array + legacy single string
function getOperatorTurfIds(op: Operator): string[] {
  if (Array.isArray(op.turfIds) && op.turfIds.length > 0) return op.turfIds;
  if (op.turfId) return [op.turfId];
  return [];
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function MyTurfs() {
  const router = useRouter();

  const [turfs,        setTurfs]        = useState<Turf[]>([]);
  const [operators,    setOperators]    = useState<Operator[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [refreshing,   setRefreshing]   = useState(false);
  const [expandedTurf, setExpandedTurf] = useState<string | null>(null);

  // ── Edit Turf Modal ──
  const [editModal,        setEditModal]        = useState(false);
  const [editTurf,         setEditTurf]         = useState<Turf | null>(null);
  const [editName,         setEditName]         = useState("");
  const [editLocation,     setEditLocation]     = useState("");
  const [editOpening,      setEditOpening]      = useState("");
  const [editClosing,      setEditClosing]      = useState("");
  const [editSlotDur,      setEditSlotDur]      = useState("");
  const [editDayPrice,     setEditDayPrice]     = useState("");
  const [editNightPrice,   setEditNightPrice]   = useState("");
  const [editBookingPrice, setEditBookingPrice] = useState("");
  const [editSaving,       setEditSaving]       = useState(false);

  // ── Manage Operators Modal (checklist, multi-assign) ──
  const [manageModal,  setManageModal]  = useState(false);
  const [manageTurf,   setManageTurf]   = useState<Turf | null>(null);
  const [checkedOpIds, setCheckedOpIds] = useState<string[]>([]);
  const [manageSaving, setManageSaving] = useState(false);

  const [editStatus,     setEditStatus]     = useState("");
const [editStatusNote, setEditStatusNote] = useState("");

  useEffect(() => { fetchAll(); }, []);

  const fetchAll = async (isRefresh = false) => {
    const uid = auth.currentUser?.uid;
    if (!uid) { setLoading(false); return; }
    isRefresh ? setRefreshing(true) : setLoading(true);
    try {
      const [turfSnap, opSnap] = await Promise.all([
        getDocs(query(collection(db, "turfs"), where("ownerId", "==", uid))),
        getDocs(query(collection(db, "users"), where("role", "==", "turf-operator"), where("ownerId", "==", uid))),
      ]);
      setTurfs(turfSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Turf)));
      setOperators(opSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Operator)));
    } catch (e) {
      Alert.alert("Error", "Unable to load turfs.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  // ── Derived helpers ───────────────────────────────────────────────────────
  const getOperatorsForTurf  = (turf: Turf)    => operators.filter((o) => getTurfOperatorIds(turf).includes(o.id));
  const getTurfsForOperator  = (op: Operator)  => turfs.filter((t) => getTurfOperatorIds(t).includes(op.id));

  // ── Open Edit Turf ────────────────────────────────────────────────────────
  const openEdit = (turf: Turf) => {
    setEditTurf(turf);
    setEditName(turf.name || "");
    setEditLocation(turf.location || "");
    setEditOpening(String(turf.openingTime ?? 6));
    setEditClosing(String(turf.closingTime ?? 23));
    setEditSlotDur(String(turf.slotDuration ?? 60));
    setEditDayPrice(String(turf.dayPrice ?? ""));
    setEditNightPrice(String(turf.nightPrice ?? ""));
    setEditBookingPrice(String(turf.bookingPrice ?? ""));
    setEditStatus(turf.status || "");
    setEditStatusNote(turf.statusNote || "");
    setEditModal(true);
  };

  const saveTurfEdit = async () => {
  if (!editTurf) return;
  const opening = Number(editOpening), closing = Number(editClosing);
  if (isNaN(opening) || opening < 0 || opening > 23) return Alert.alert("Invalid", "Opening time must be 0–23.");
  if (isNaN(closing) || closing < 1  || closing > 24) return Alert.alert("Invalid", "Closing time must be 1–24.");
  if (closing <= opening) return Alert.alert("Invalid", "Closing time must be after opening time.");
  setEditSaving(true);
  try {
    await updateDoc(doc(db, "turfs", editTurf.id), {
  openingTime:       opening,
  closingTime:       closing,
  dayPrice:          Number(editDayPrice)     || 0,
  nightPrice:        Number(editNightPrice)   || 0,
  bookingPrice:      Number(editBookingPrice) || 0,
  status:            editStatus || null,
  statusNote:        editStatusNote.trim() || null,
  statusUpdatedAt:   editStatus ? new Date().toISOString() : null,
});
    setTurfs((prev) => prev.map((t) => t.id === editTurf.id
      ? { ...t, openingTime: opening, closingTime: closing, dayPrice: Number(editDayPrice) || 0, nightPrice: Number(editNightPrice) || 0, bookingPrice: Number(editBookingPrice) || 0 }
      : t));
    setEditModal(false);
    Alert.alert("Updated ✓", "Turf settings have been updated.");
  } catch (e: any) {
    Alert.alert("Error", e.message || "Could not update turf.");
  } finally {
    setEditSaving(false);
  }
};

  // ── Open Manage Operators checklist ──────────────────────────────────────
  const openManage = (turf: Turf) => {
    setManageTurf(turf);
    setCheckedOpIds(getTurfOperatorIds(turf)); // pre-tick currently assigned
    setManageModal(true);
  };

  const toggleCheckedOp = (opId: string) =>
    setCheckedOpIds((prev) => prev.includes(opId) ? prev.filter((id) => id !== opId) : [...prev, opId]);

  // ✅ CORE FIX — saves operatorIds[] to turf and turfIds[] to each operator
  // Adding a turf to an operator does NOT remove their other turfs.
  // Removing a turf from an operator does NOT remove their other turfs either.
  const saveManageAssignments = async () => {
    if (!manageTurf) return;
    setManageSaving(true);
    try {
      const prevIds = getTurfOperatorIds(manageTurf);
      const newIds  = checkedOpIds;
      const added   = newIds.filter((id) => !prevIds.includes(id));
      const removed = prevIds.filter((id) => !newIds.includes(id));

      // 1. Update the turf document
      const firstOp = operators.find((o) => o.id === newIds[0]);
      await updateDoc(doc(db, "turfs", manageTurf.id), {
        operatorIds:   newIds,
        // Legacy single-field — keep first operator for screens that haven't migrated
        operatorId:    newIds[0]          || "",
        operatorName:  firstOp?.name      || "",
        operatorEmail: firstOp?.email     || "",
      });

      // 2. Add this turf to newly assigned operators' turfIds[] (don't wipe existing)
      await Promise.all(added.map(async (opId) => {
        const op = operators.find((o) => o.id === opId);
        if (!op) return;
        const existing = getOperatorTurfIds(op);
        if (existing.includes(manageTurf.id)) return; // already there
        const merged = [...existing, manageTurf.id];
        await updateDoc(doc(db, "users", opId), {
          turfIds: merged,
          turfId:  merged[0],
          turfName: turfs.find((t) => t.id === merged[0])?.name || "",
        });
      }));

      // 3. Remove only THIS turf from unassigned operators' turfIds[]
      //    Their other turfs are untouched
      await Promise.all(removed.map(async (opId) => {
        const op = operators.find((o) => o.id === opId);
        if (!op) return;
        const existing    = getOperatorTurfIds(op);
        const withoutThis = existing.filter((tid) => tid !== manageTurf.id);
        await updateDoc(doc(db, "users", opId), {
          turfIds: withoutThis,
          turfId:  withoutThis[0] || "",
          turfName: withoutThis.length > 0 ? (turfs.find((t) => t.id === withoutThis[0])?.name || "") : "",
        });
      }));

      setManageModal(false);
      await fetchAll(true);
      Alert.alert("Saved ✓", "Operator assignments updated.");
    } catch (e: any) {
      Alert.alert("Error", e.message || "Could not save assignments.");
    } finally {
      setManageSaving(false);
    }
  };

  // ── Toggle operator active/inactive ──────────────────────────────────────
  const toggleOperatorStatus = async (op: Operator) => {
    const next = op.status === "active" ? "inactive" : "active";
    try {
      await updateDoc(doc(db, "users", op.id), { status: next });
      setOperators((prev) => prev.map((o) => o.id === op.id ? { ...o, status: next } : o));
    } catch { Alert.alert("Error", "Could not update status."); }
  };

  // ── Delete operator ───────────────────────────────────────────────────────
  const deleteOperator = (op: Operator) => {
    Alert.alert("Remove Operator", `Remove ${op.name}? Their login account will also be deleted.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove", style: "destructive",
        onPress: async () => {
          try {
            const token = await getIdToken(auth.currentUser!);
            const res = await fetch(`${SERVER_URL}/delete-owner/${op.id}`, {
              method: "DELETE",
              headers: { "Authorization": `Bearer ${token}` },
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Failed");

            // Remove from all assigned turfs in Firestore
            const assignedTurfs = turfs.filter((t) => getTurfOperatorIds(t).includes(op.id));
            await Promise.all(assignedTurfs.map(async (t) => {
              const newIds = getTurfOperatorIds(t).filter((id) => id !== op.id);
              const nextOp = operators.find((o) => newIds[0] === o.id);
              await updateDoc(doc(db, "turfs", t.id), {
                operatorIds: newIds, operatorId: newIds[0] || "",
                operatorName: nextOp?.name || "", operatorEmail: nextOp?.email || "",
              });
            }));

            setOperators((prev) => prev.filter((o) => o.id !== op.id));
            setTurfs((prev) => prev.map((t) => {
              const newIds = getTurfOperatorIds(t).filter((id) => id !== op.id);
              const nextOp = operators.find((o) => newIds[0] === o.id);
              return { ...t, operatorIds: newIds, operatorId: newIds[0] || "", operatorName: nextOp?.name || "", operatorEmail: nextOp?.email || "" };
            }));
          } catch (e: any) { Alert.alert("Error", e.message); }
        },
      },
    ]);
  };

  const toggleExpand = (id: string) => setExpandedTurf((prev) => (prev === id ? null : id));

  if (loading)
    return (
      <SafeAreaView style={s.center}>
        <StatusBar barStyle="light-content" backgroundColor="#081120" />
        <ActivityIndicator size="large" color="#22C55E" />
        <Text style={s.loadText}>Loading your turfs...</Text>
      </SafeAreaView>
    );

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="light-content" backgroundColor="#081120" />

      <View style={s.header}>
        <TouchableOpacity style={s.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={20} color="#fff" />
        </TouchableOpacity>
        <View>
          <Text style={s.headerTitle}>My Turfs</Text>
          <Text style={s.headerSub}>{turfs.length} turf{turfs.length !== 1 ? "s" : ""} · {operators.length} operator{operators.length !== 1 ? "s" : ""}</Text>
        </View>
        <TouchableOpacity style={s.refreshBtn} onPress={() => fetchAll(true)}>
          <Ionicons name="refresh-outline" size={20} color="#9DB3C3" />
        </TouchableOpacity>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={s.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => fetchAll(true)} tintColor="#22C55E" />}
      >
        {/* Summary */}
        <View style={s.summaryStrip}>
          {[
            { label: "Total Turfs",  value: turfs.length,                                             color: "#0F172A" },
            { label: "Assigned",     value: turfs.filter((t) => getTurfOperatorIds(t).length > 0).length, color: "#0F172A" },
            { label: "Unassigned",   value: turfs.filter((t) => getTurfOperatorIds(t).length === 0).length, color: "#F59E0B" },
            { label: "Operators",    value: operators.length,                                          color: "#0F172A" },
          ].map((item, i, arr) => (
            <View key={item.label} style={{ flexDirection: "row", flex: 1 }}>
              <View style={s.summaryItem}>
                <Text style={[s.summaryNum, { color: item.color }]}>{item.value}</Text>
                <Text style={s.summaryLabel}>{item.label}</Text>
              </View>
              {i < arr.length - 1 && <View style={s.summaryDivider} />}
            </View>
          ))}
        </View>

        {/* Turfs */}
        <Text style={s.sectionTitle}>Turfs & Operators</Text>

        {turfs.length === 0 ? (
          <View style={s.emptyBox}>
            <Ionicons name="football-outline" size={40} color="#D1D5DB" />
            <Text style={s.emptyTitle}>No turfs yet</Text>
            <Text style={s.emptySub}>Your turfs will appear here once added by admin.</Text>
          </View>
        ) : (
          turfs.map((turf) => {
            const assignedOps = getOperatorsForTurf(turf);
            const isExpanded  = expandedTurf === turf.id;
            const sports      = Array.isArray(turf.sport) ? turf.sport.join(", ") : turf.sport || "";

            return (
              <View key={turf.id} style={s.turfCard}>
                <TouchableOpacity style={s.turfCardHeader} onPress={() => toggleExpand(turf.id)} activeOpacity={0.8}>
                  <View style={s.turfIconWrap}>
                    <Ionicons name="football" size={20} color="#22C55E" />
                  </View>
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={s.turfCardName}>{turf.name || "Unnamed Turf"}</Text>
                    <Text style={s.turfCardLocation}>
                      <Ionicons name="location-outline" size={11} color="#9CA3AF" /> {turf.location || "No location"}
                    </Text>
                  </View>
                  <View style={s.turfCardRight}>
                    <View style={[s.turfStatusBadge, { backgroundColor: assignedOps.length > 0 ? "#DCFCE7" : "#FEF9C3" }]}>
                      <Text style={[s.turfStatusText, { color: assignedOps.length > 0 ? "#15803D" : "#92400E" }]}>
                        {assignedOps.length > 0 ? `✓ ${assignedOps.length} Op${assignedOps.length > 1 ? "s" : ""}` : "⚠ Unassigned"}
                      </Text>
                    </View>
                    <Ionicons name={isExpanded ? "chevron-up" : "chevron-down"} size={16} color="#9CA3AF" style={{ marginTop: 6 }} />
                  </View>
                </TouchableOpacity>

                {/* Quick strip */}
                <View style={s.turfQuickStrip}>
                  {turf.openingTime !== undefined && (
                    <View style={s.quickItem}>
                      <Ionicons name="time-outline" size={12} color="#6B7280" />
                      <Text style={s.quickText}>{fmtHour(turf.openingTime)} – {fmtHour(turf.closingTime ?? 23)}</Text>
                    </View>
                  )}
                  {turf.dayPrice !== undefined && (
                    <View style={s.quickItem}>
                      <Ionicons name="sunny-outline" size={12} color="#F59E0B" />
                      <Text style={s.quickText}>₹{turf.dayPrice}/slot</Text>
                    </View>
                  )}
                  {turf.nightPrice !== undefined && (
                    <View style={s.quickItem}>
                      <Ionicons name="moon-outline" size={12} color="#818CF8" />
                      <Text style={s.quickText}>₹{turf.nightPrice}/slot</Text>
                    </View>
                  )}
                  {sports ? (
                    <View style={s.quickItem}>
                      <Ionicons name="trophy-outline" size={12} color="#22C55E" />
                      <Text style={s.quickText}>{sports}</Text>
                    </View>
                  ) : null}
                </View>

                {/* Expanded */}
                {isExpanded && (
                  <View style={s.expanded}>
                    <Text style={s.expandSectionTitle}>Assigned Operators</Text>

                    {assignedOps.length === 0 ? (
                      <View style={s.noOpBox}>
                        <Text style={s.noOpText}>No operator assigned to this turf</Text>
                        <TouchableOpacity style={s.assignOpBtn} onPress={() => openManage(turf)}>
                          <Ionicons name="person-add-outline" size={14} color="#fff" />
                          <Text style={s.assignOpBtnText}>Assign Operator</Text>
                        </TouchableOpacity>
                      </View>
                    ) : (
                      assignedOps.map((op) => {
                        const isActive    = op.status !== "inactive";
                        const opTurfCount = getTurfsForOperator(op).length;
                        return (
                          <View key={op.id} style={s.opDetailCard}>
                            <View style={[s.opDetailAvatar, { backgroundColor: isActive ? "#DCFCE7" : "#F3F4F6" }]}>
                              <Text style={[s.opDetailAvatarText, { color: isActive ? "#15803D" : "#9CA3AF" }]}>
                                {initials(op.name || "?")}
                              </Text>
                            </View>
                            <View style={{ flex: 1, marginLeft: 12 }}>
                              <Text style={s.opDetailName}>{op.name || "Unnamed"}</Text>
                              <Text style={s.opDetailEmail}>{op.email || ""}</Text>
                              {op.phone ? <Text style={s.opDetailPhone}>{op.phone}</Text> : null}
                              {opTurfCount > 1 && (
                                <Text style={s.opTurfCount}>Managing {opTurfCount} turfs</Text>
                              )}
                            </View>
                            <View style={s.opDetailActions}>
                              <View style={s.opToggleRow}>
                                <Text style={s.opToggleLabel}>{isActive ? "Active" : "Off"}</Text>
                                <Switch value={isActive} onValueChange={() => toggleOperatorStatus(op)} trackColor={{ false: "#E5E7EB", true: "#22C55E" }} thumbColor="#fff" style={{ transform: [{ scaleX: 0.75 }, { scaleY: 0.75 }] }} />
                              </View>
                              <TouchableOpacity style={[s.opSmallBtn, { backgroundColor: "#FEF2F2" }]} onPress={() => deleteOperator(op)}>
                                <Ionicons name="trash-outline" size={13} color="#DC2626" />
                                <Text style={[s.opSmallBtnText, { color: "#DC2626" }]}>Remove</Text>
                              </TouchableOpacity>
                            </View>
                          </View>
                        );
                      })
                    )}

                    <View style={s.expandActions}>
                      <TouchableOpacity style={s.editTurfBtn} onPress={() => openEdit(turf)}>
                        <Ionicons name="pencil-outline" size={15} color="#fff" />
                        <Text style={s.editTurfBtnText}>Edit Turf</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={s.changeOpBtn} onPress={() => openManage(turf)}>
                        <Ionicons name="people-outline" size={15} color="#0F172A" />
                        <Text style={s.changeOpBtnText}>Manage Operators</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
              </View>
            );
          })
        )}

        {/* All Operators */}
        <Text style={s.sectionTitle}>All Operators</Text>
        {operators.length === 0 ? (
          <View style={s.emptyBox}>
            <Ionicons name="people-outline" size={40} color="#D1D5DB" />
            <Text style={s.emptyTitle}>No operators yet</Text>
            <Text style={s.emptySub}>Expand a turf above and tap "Create New Operator".</Text>
          </View>
        ) : (
          operators.map((op) => {
            const assignedTurfs = getTurfsForOperator(op);
            const isActive      = op.status !== "inactive";
            return (
              <View key={op.id} style={s.opListCard}>
                <View style={[s.opListBar, { backgroundColor: isActive ? "#22C55E" : "#E5E7EB" }]} />
                <View style={[s.opListAvatar, { backgroundColor: isActive ? "#DCFCE7" : "#F3F4F6" }]}>
                  <Text style={[s.opListAvatarText, { color: isActive ? "#15803D" : "#9CA3AF" }]}>{initials(op.name || "?")}</Text>
                </View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={s.opListName}>{op.name || "Unnamed"}</Text>
                  <Text style={s.opListEmail}>{op.email || ""}</Text>
                  {op.phone ? <Text style={s.opListPhone}>{op.phone}</Text> : null}
                  {/* ✅ Shows ALL turfs, not just one */}
                  {assignedTurfs.length > 0 ? (
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
                      {assignedTurfs.map((t) => (
                        <View key={t.id} style={s.opListTurfBadge}>
                          <Ionicons name="football-outline" size={10} color="#15803D" />
                          <Text style={s.opListTurfText}>{t.name}</Text>
                        </View>
                      ))}
                    </View>
                  ) : (
                    <Text style={s.opListUnassigned}>Not assigned to any turf</Text>
                  )}
                </View>
                <View style={s.opListActions}>
                  <Switch value={isActive} onValueChange={() => toggleOperatorStatus(op)} trackColor={{ false: "#E5E7EB", true: "#22C55E" }} thumbColor="#fff" style={{ transform: [{ scaleX: 0.75 }, { scaleY: 0.75 }] }} />
                  <TouchableOpacity onPress={() => deleteOperator(op)} style={s.opListDeleteBtn}>
                    <Ionicons name="trash-outline" size={15} color="#DC2626" />
                  </TouchableOpacity>
                </View>
              </View>
            );
          })
        )}
        <View style={{ height: 40 }} />
      </ScrollView>

      {/* ══ EDIT TURF MODAL ══════════════════════════════════════════════════ */}
   {/* ══ EDIT TURF MODAL ══════════════════════════════════════════════════ */}
<Modal visible={editModal} animationType="slide" transparent onRequestClose={() => setEditModal(false)}>
  <View style={m.backdrop}>
    <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => setEditModal(false)} />
    <View style={m.sheet}>
      <View style={m.handle} />
      <Text style={m.title}>Turf Settings</Text>
      <Text style={m.sub}>{editTurf?.name}</Text>

      {/* Read-only info strip */}
      <View style={{
        backgroundColor: "#F9FAFB", borderRadius: 14, padding: 14,
        borderWidth: 1, borderColor: "#E5E7EB", marginBottom: 4,
      }}>
        <Text style={{ fontSize: 10, fontWeight: "800", color: "#9CA3AF", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 }}>
          Turf Info (view only)
        </Text>
        {[
          { label: "Name",     value: editTurf?.name     || "—" },
          { label: "Location", value: editTurf?.location  || "—" },
          { label: "Slot",     value: `${editTurf?.slotDuration ?? 60} min` },
        ].map((row) => (
          <View key={row.label} style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: "#F3F4F6" }}>
            <Text style={{ fontSize: 13, color: "#9CA3AF", fontWeight: "600" }}>{row.label}</Text>
            <Text style={{ fontSize: 13, color: "#374151", fontWeight: "700" }}>{row.value}</Text>
          </View>
        ))}
      </View>

      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {/* Editable fields only */}
        <Text style={m.label}>Opening & Closing Time (0–24 hour)</Text>
        <View style={m.row}>
          <View style={{ flex: 1 }}>
            <Text style={m.sublabel}>Opens at (h)</Text>
            <TextInput
              style={m.input} value={editOpening} onChangeText={setEditOpening}
              keyboardType="number-pad" placeholder="6" placeholderTextColor="#9CA3AF"
            />
          </View>
          <View style={{ width: 12 }} />
          <View style={{ flex: 1 }}>
            <Text style={m.sublabel}>Closes at (h)</Text>
            <TextInput
              style={m.input} value={editClosing} onChangeText={setEditClosing}
              keyboardType="number-pad" placeholder="23" placeholderTextColor="#9CA3AF"
            />
          </View>
        </View>

        <Text style={m.label}>Pricing (₹ per hour)</Text>
        <View style={m.row}>
          <View style={{ flex: 1 }}>
            <Text style={m.sublabel}>Day Price</Text>
            <TextInput
              style={m.input} value={editDayPrice} onChangeText={setEditDayPrice}
              keyboardType="number-pad" placeholder="0" placeholderTextColor="#9CA3AF"
            />
          </View>
          <View style={{ width: 12 }} />
          <View style={{ flex: 1 }}>
            <Text style={m.sublabel}>Night Price</Text>
            <TextInput
              style={m.input} value={editNightPrice} onChangeText={setEditNightPrice}
              keyboardType="number-pad" placeholder="0" placeholderTextColor="#9CA3AF"
            />
          </View>
        </View>

        <Text style={m.label}>Advance Booking Price (₹)</Text>
        <TextInput
          style={m.input} value={editBookingPrice} onChangeText={setEditBookingPrice}
          keyboardType="number-pad" placeholder="0" placeholderTextColor="#9CA3AF"
        />
        {/* ── Turf Status ── */}
<Text style={m.label}>Field Status</Text>
<ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }}>
  <View style={{ flexDirection: "row", gap: 8 }}>
    {[
      { key: "",            label: "None",        emoji: "—",  bg: "#F3F4F6", border: "#E5E7EB",  text: "#6B7280" },
      { key: "ready",       label: "Field Ready", emoji: "✅", bg: "#F0FDF4", border: "#86EFAC",  text: "#15803D" },
      { key: "wet",         label: "Wet / Rain",  emoji: "🌧️", bg: "#EFF6FF", border: "#93C5FD",  text: "#1D4ED8" },
      { key: "maintenance", label: "Maintenance", emoji: "🔧", bg: "#FFFBEB", border: "#FCD34D",  text: "#B45309" },
      { key: "partial",     label: "Partial",     emoji: "⚠️", bg: "#FFF7ED", border: "#FDBA74",  text: "#C2410C" },
      { key: "closed",      label: "Closed",      emoji: "❌", bg: "#FFF1F2", border: "#FDA4AF",  text: "#BE123C" },
      { key: "league",      label: "League",      emoji: "🏆", bg: "#F5F3FF", border: "#C4B5FD",  text: "#6D28D9" },
    ].map((opt) => (
      <TouchableOpacity
        key={opt.key}
        onPress={() => setEditStatus(opt.key)}
        style={{
          paddingHorizontal: 12, paddingVertical: 9, borderRadius: 12,
          borderWidth: 1.5,
          backgroundColor: editStatus === opt.key ? opt.bg : "#F9FAFB",
          borderColor:     editStatus === opt.key ? opt.border : "#E5E7EB",
        }}
      >
        <Text style={{ fontSize: 16, textAlign: "center" }}>{opt.emoji}</Text>
        <Text style={{
          fontSize: 11, fontWeight: "700", marginTop: 4,
          color: editStatus === opt.key ? opt.text : "#9CA3AF",
        }}>
          {opt.label}
        </Text>
      </TouchableOpacity>
    ))}
  </View>
</ScrollView>

{editStatus && editStatus !== "" && (
  <>
    <Text style={m.label}>Status Note (optional)</Text>
    <TextInput
      style={[m.input, { minHeight: 70, textAlignVertical: "top" , marginBottom:200,}]}
      placeholder="e.g. Heavy rain last night, pitch is soft today"
      placeholderTextColor="#9CA3AF"
      value={editStatusNote}
      onChangeText={setEditStatusNote}
      multiline
    />
  </>
)}

        <TouchableOpacity
          style={[m.saveBtn, editSaving && { opacity: 0.6 }]}
          onPress={saveTurfEdit} disabled={editSaving}
        >
          {editSaving
            ? <ActivityIndicator color="#fff" />
            : <><Ionicons name="checkmark-circle-outline" size={16} color="#fff" style={{ marginRight: 8 }} /><Text style={m.saveBtnText}>Save Changes</Text></>
          }
        </TouchableOpacity>
        <TouchableOpacity style={m.cancelBtn} onPress={() => setEditModal(false)} disabled={editSaving}>
          <Text style={m.cancelBtnText}>Cancel</Text>
        </TouchableOpacity>
        <View style={{ height: 24 }} />
      </ScrollView>
    </View>
  </View>
</Modal>

      {/* ══ MANAGE OPERATORS MODAL — checklist, supports multi-assign ════════ */}
      <Modal visible={manageModal} animationType="slide" transparent onRequestClose={() => setManageModal(false)}>
        <View style={m.backdrop}>
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => setManageModal(false)} />
          <View style={[m.sheet, { maxHeight: "82%" }]}>
            <View style={m.handle} />
            <Text style={m.title}>Manage Operators</Text>
            <Text style={m.sub}>{manageTurf?.name} — tick all operators who should manage this turf</Text>
            <View style={m.infoBanner}>
              <Ionicons name="information-circle-outline" size={15} color="#3B82F6" />
              <Text style={m.infoBannerText}>
                One operator can manage multiple turfs. Ticking/unticking only changes THIS turf — other turf assignments stay untouched.
              </Text>
            </View>
            <ScrollView showsVerticalScrollIndicator={false}>
              {operators.length === 0 ? (
                <View style={m.emptyOp}>
                  <Text style={m.emptyOpText}>No operators yet. Create one first.</Text>
                  <TouchableOpacity style={[m.saveBtn, { marginTop: 12 }]} onPress={() => { setManageModal(false); if (manageTurf) openOpModal(manageTurf); }}>
                    <Text style={m.saveBtnText}>Create Operator</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                operators.map((op) => {
                  const checked    = checkedOpIds.includes(op.id);
                  const isActive   = op.status !== "inactive";
                  const otherTurfs = getTurfsForOperator(op).filter((t) => t.id !== manageTurf?.id);
                  return (
                    <TouchableOpacity
                      key={op.id}
                      style={[m.opChoice, checked && m.opChoiceActive]}
                      onPress={() => toggleCheckedOp(op.id)}
                    >
                      <View style={[m.opChoiceAvatar, { backgroundColor: checked ? "#DCFCE7" : "#E5E7EB" }]}>
                        <Text style={[m.opChoiceAvatarText, { color: checked ? "#15803D" : "#374151" }]}>{initials(op.name || "?")}</Text>
                      </View>
                      <View style={{ flex: 1, marginLeft: 10 }}>
                        <Text style={m.opChoiceName}>{op.name || "Unnamed"}</Text>
                        <Text style={m.opChoiceEmail}>{op.email || ""}</Text>
                        {otherTurfs.length > 0 && (
                          <Text style={m.opChoiceInfo}>Also manages: {otherTurfs.map((t) => t.name).join(", ")}</Text>
                        )}
                        {!isActive && <Text style={[m.opChoiceInfo, { color: "#DC2626" }]}>⚠ Currently inactive</Text>}
                      </View>
                      <View style={[m.checkbox, checked && m.checkboxChecked]}>
                        {checked && <Ionicons name="checkmark" size={14} color="#fff" />}
                      </View>
                    </TouchableOpacity>
                  );
                })
              )}
              {operators.length > 0 && (
                <TouchableOpacity style={[m.saveBtn, manageSaving && { opacity: 0.6 }]} onPress={saveManageAssignments} disabled={manageSaving}>
                  {manageSaving ? <ActivityIndicator color="#fff" /> : <Text style={m.saveBtnText}>Save Assignments</Text>}
                </TouchableOpacity>
              )}
              <TouchableOpacity style={m.cancelBtn} onPress={() => setManageModal(false)} disabled={manageSaving}>
                <Text style={m.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <View style={{ height: 24 }} />
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const DARK  = "#081120";
const GREEN = "#22C55E";

const s = StyleSheet.create({
  safe:     { flex: 1, backgroundColor: "#F0F4F8" },
  center:   { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#F0F4F8" },
  loadText: { marginTop: 12, fontSize: 15, color: "#4B6575", fontWeight: "600" },
  scroll:   { paddingHorizontal: 16, paddingBottom: 24 },
  header:   { backgroundColor: DARK, paddingHorizontal: 20, paddingTop: Platform.OS === "android" ? (StatusBar.currentHeight || 0) + 14 : 14, paddingBottom: 18, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  backBtn:  { width: 38, height: 38, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.08)", justifyContent: "center", alignItems: "center" },
  refreshBtn:{ width: 38, height: 38, borderRadius: 12, justifyContent: "center", alignItems: "center" },
  headerTitle:{ color: "#fff", fontSize: 18, fontWeight: "900" },
  headerSub:{ color: "#9DB3C3", fontSize: 12, marginTop: 2 },
  summaryStrip: { flexDirection: "row", backgroundColor: "#fff", borderRadius: 20, marginTop: 16, padding: 16, borderWidth: 1, borderColor: "#E5E7EB", shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 6, elevation: 2 },
  summaryItem:  { flex: 1, alignItems: "center" },
  summaryNum:   { fontSize: 20, fontWeight: "900" },
  summaryLabel: { fontSize: 9, color: "#9CA3AF", fontWeight: "700", marginTop: 3, textTransform: "uppercase" },
  summaryDivider:{ width: 1, backgroundColor: "#F3F4F6" },
  sectionTitle: { fontSize: 13, fontWeight: "800", color: "#6B7280", textTransform: "uppercase", letterSpacing: 0.6, marginTop: 24, marginBottom: 10 },
  emptyBox:  { backgroundColor: "#fff", borderRadius: 20, padding: 32, alignItems: "center", borderWidth: 1, borderColor: "#E5E7EB" },
  emptyTitle:{ fontSize: 16, fontWeight: "800", color: "#374151", marginTop: 12 },
  emptySub:  { fontSize: 13, color: "#9CA3AF", textAlign: "center", marginTop: 6, lineHeight: 19 },
  turfCard:        { backgroundColor: "#fff", borderRadius: 20, marginBottom: 12, borderWidth: 1, borderColor: "#E5E7EB", overflow: "hidden", shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 6, elevation: 2 },
  turfCardHeader:  { flexDirection: "row", alignItems: "center", padding: 16 },
  turfIconWrap:    { width: 44, height: 44, borderRadius: 14, backgroundColor: "#F0FDF4", justifyContent: "center", alignItems: "center" },
  turfCardName:    { fontSize: 15, fontWeight: "900", color: "#0F172A" },
  turfCardLocation:{ fontSize: 12, color: "#9CA3AF", marginTop: 3 },
  turfCardRight:   { alignItems: "flex-end", gap: 2 },
  turfStatusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  turfStatusText:  { fontSize: 11, fontWeight: "800" },
  turfQuickStrip:  { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingHorizontal: 16, paddingBottom: 14 },
  quickItem:       { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#F9FAFB", paddingHorizontal: 9, paddingVertical: 5, borderRadius: 8, borderWidth: 1, borderColor: "#E5E7EB" },
  quickText:       { fontSize: 11, color: "#374151", fontWeight: "600" },
  expanded:           { borderTopWidth: 1, borderTopColor: "#F3F4F6", padding: 16, gap: 12 },
  expandSectionTitle: { fontSize: 11, fontWeight: "800", color: "#9CA3AF", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 },
  opDetailCard:      { flexDirection: "row", alignItems: "flex-start", backgroundColor: "#F9FAFB", borderRadius: 14, padding: 12, borderWidth: 1, borderColor: "#E5E7EB", marginBottom: 8 },
  opDetailAvatar:    { width: 44, height: 44, borderRadius: 22, justifyContent: "center", alignItems: "center" },
  opDetailAvatarText:{ fontSize: 15, fontWeight: "900" },
  opDetailName:      { fontSize: 14, fontWeight: "800", color: "#0F172A" },
  opDetailEmail:     { fontSize: 12, color: "#9CA3AF", marginTop: 2 },
  opDetailPhone:     { fontSize: 12, color: "#6B7280", marginTop: 1 },
  opTurfCount:       { fontSize: 11, color: "#3B82F6", marginTop: 3, fontWeight: "700" },
  opDetailActions:   { gap: 6, alignItems: "flex-end" },
  opToggleRow:       { flexDirection: "row", alignItems: "center", gap: 4 },
  opToggleLabel:     { fontSize: 10, color: "#6B7280", fontWeight: "700" },
  opSmallBtn:        { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#EFF6FF", paddingHorizontal: 9, paddingVertical: 5, borderRadius: 8 },
  opSmallBtnText:    { fontSize: 11, fontWeight: "700" },
  noOpBox:           { backgroundColor: "#FFFBEB", borderRadius: 14, padding: 14, alignItems: "center", borderWidth: 1, borderColor: "#FDE68A", gap: 10 },
  noOpText:          { fontSize: 13, color: "#92400E", fontWeight: "600", textAlign: "center" },
  assignOpBtn:       { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: DARK, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10 },
  assignOpBtnText:   { color: "#fff", fontSize: 13, fontWeight: "700" },
  expandActions:     { flexDirection: "row", gap: 10 },
  editTurfBtn:       { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, backgroundColor: DARK, paddingVertical: 12, borderRadius: 12 },
  editTurfBtnText:   { color: "#fff", fontWeight: "700", fontSize: 13 },
  changeOpBtn:       { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, backgroundColor: "#F0FDF4", paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: "#BBF7D0" },
  changeOpBtnText:   { color: "#15803D", fontWeight: "700", fontSize: 13 },
  opListCard:       { flexDirection: "row", alignItems: "center", backgroundColor: "#fff", borderRadius: 16, marginBottom: 10, borderWidth: 1, borderColor: "#E5E7EB", padding: 14, overflow: "hidden" },
  opListBar:        { width: 3, height: "100%", position: "absolute", left: 0, top: 0, borderRadius: 2 },
  opListAvatar:     { width: 44, height: 44, borderRadius: 22, justifyContent: "center", alignItems: "center", marginLeft: 6 },
  opListAvatarText: { fontSize: 15, fontWeight: "900" },
  opListName:       { fontSize: 14, fontWeight: "800", color: "#0F172A" },
  opListEmail:      { fontSize: 12, color: "#9CA3AF", marginTop: 2 },
  opListPhone:      { fontSize: 12, color: "#6B7280", marginTop: 1 },
  opListTurfBadge:  { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#F0FDF4", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  opListTurfText:   { fontSize: 11, color: "#15803D", fontWeight: "700" },
  opListUnassigned: { fontSize: 11, color: "#D1D5DB", marginTop: 4 },
  opListActions:    { alignItems: "center", gap: 8 },
  opListDeleteBtn:  { width: 32, height: 32, borderRadius: 10, backgroundColor: "#FEF2F2", justifyContent: "center", alignItems: "center" },
});

const m = StyleSheet.create({
  backdrop:   { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheet:      { backgroundColor: "#fff", borderTopLeftRadius: 28, borderTopRightRadius: 28, maxHeight: "92%", paddingHorizontal: 20, paddingTop: 12, paddingBottom: Platform.OS === "ios" ? 34 : 20 },
  handle:     { width: 40, height: 4, borderRadius: 2, backgroundColor: "#E5E7EB", alignSelf: "center", marginBottom: 20 },
  title:      { fontSize: 22, fontWeight: "900", color: "#0F172A" },
  sub:        { fontSize: 13, color: "#9CA3AF", marginTop: 4, marginBottom: 12 },
  label:      { fontSize: 11, fontWeight: "800", color: "#6B7280", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 7, marginTop: 14 },
  sublabel:   { fontSize: 11, color: "#9CA3AF", fontWeight: "600", marginBottom: 5 },
  input:      { backgroundColor: "#F9FAFB", borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13, fontSize: 14, color: "#0F172A" },
  hint:       { fontSize: 11, color: "#9CA3AF", marginTop: 5 },
  row:        { flexDirection: "row" },
  pwRow:      { flexDirection: "row", alignItems: "center", gap: 8 },
  eyeBtn:     { padding: 8 },
  infoBanner: { flexDirection: "row", alignItems: "flex-start", gap: 8, backgroundColor: "#EFF6FF", borderRadius: 12, padding: 12, marginBottom: 12, borderWidth: 1, borderColor: "#BFDBFE" },
  infoBannerText:     { fontSize: 12, color: "#1D4ED8", fontWeight: "600", flex: 1, lineHeight: 17 },
  opChoice:           { flexDirection: "row", alignItems: "center", backgroundColor: "#F9FAFB", borderRadius: 14, padding: 12, borderWidth: 1, borderColor: "#E5E7EB", marginBottom: 8 },
  opChoiceActive:     { borderColor: GREEN, backgroundColor: "#F0FDF4" },
  opChoiceAvatar:     { width: 40, height: 40, borderRadius: 20, justifyContent: "center", alignItems: "center" },
  opChoiceAvatarText: { fontSize: 13, fontWeight: "900" },
  opChoiceName:       { fontSize: 14, fontWeight: "800", color: "#0F172A" },
  opChoiceEmail:      { fontSize: 12, color: "#9CA3AF", marginTop: 1 },
  opChoiceInfo:       { fontSize: 11, color: "#3B82F6", marginTop: 3, fontWeight: "600" },
  checkbox:           { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: "#E5E7EB", backgroundColor: "#fff", justifyContent: "center", alignItems: "center" },
  checkboxChecked:    { backgroundColor: GREEN, borderColor: GREEN },
  emptyOp:     { padding: 20, alignItems: "center" },
  emptyOpText: { fontSize: 13, color: "#9CA3AF", textAlign: "center", lineHeight: 20 },
  saveBtn:      { flexDirection: "row", alignItems: "center", justifyContent: "center", backgroundColor: DARK, paddingVertical: 15, borderRadius: 16, marginTop: 16 },
  saveBtnText:  { color: "#fff", fontWeight: "800", fontSize: 15 },
  cancelBtn:    { backgroundColor: "#F3F4F6", paddingVertical: 14, borderRadius: 16, alignItems: "center", marginTop: 10 },
  cancelBtnText:{ color: "#374151", fontWeight: "700", fontSize: 15 },
});
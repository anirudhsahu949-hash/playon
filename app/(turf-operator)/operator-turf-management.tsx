/**
 * operator/turf-status.tsx
 * Operator screen to update turf field status in real time.
 * Reads turfIds[] from the operator's user doc and lets them
 * pick a status + write a note for each assigned turf.
 */
import {
  View, Text, StyleSheet, StatusBar,
  ScrollView, TouchableOpacity, TextInput, Alert,
  ActivityIndicator, Platform, RefreshControl,
} from "react-native";
import { useEffect, useState } from "react";
import { auth, db } from "../../firebaseConfig";
import {
  doc, getDoc, getDocs, collection,
  query, where, updateDoc,
} from "firebase/firestore";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";


const DARK   = "#081120";
const ACCENT = "#0EA5A4";

// ── Status options ─────────────────────────────────────────────────────────
const STATUS_OPTIONS = [
  { key: "",            label: "Clear Status", emoji: "—",  bg: "#F3F4F6", border: "#E5E7EB", text: "#6B7280" },
  { key: "ready",       label: "Field Ready",  emoji: "✅", bg: "#F0FDF4", border: "#86EFAC", text: "#15803D" },
  { key: "wet",         label: "Wet / Rain",   emoji: "🌧️", bg: "#EFF6FF", border: "#93C5FD", text: "#1D4ED8" },
  { key: "maintenance", label: "Maintenance",  emoji: "🔧", bg: "#FFFBEB", border: "#FCD34D", text: "#B45309" },
  { key: "partial",     label: "Partially Available", emoji: "⚠️", bg: "#FFF7ED", border: "#FDBA74", text: "#C2410C" },
  { key: "closed",      label: "Closed Today", emoji: "❌", bg: "#FFF1F2", border: "#FDA4AF", text: "#BE123C" },
  { key: "league",      label: "League in Progress", emoji: "🏆", bg: "#F5F3FF", border: "#C4B5FD", text: "#6D28D9" },
];

type TurfInfo = {
  id: string;
  name?: string;
  location?: string;
  status?: string;
  statusNote?: string;
  statusUpdatedAt?: string;
};

// ── Main ──────────────────────────────────────────────────────────────────────
export default function OperatorTurfStatus() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [turfs,      setTurfs]      = useState<TurfInfo[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Per-turf form state: { [turfId]: { status, note, saving } }
  const [forms, setForms] = useState<Record<string, {
    status: string; note: string; saving: boolean;
  }>>({});

  useEffect(() => { fetchTurfs(); }, []);

  const fetchTurfs = async (isRefresh = false) => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    isRefresh ? setRefreshing(true) : setLoading(true);
    try {
      const userSnap = await getDoc(doc(db, "users", uid));
      const userData = userSnap.exists() ? userSnap.data() : {};

      const turfIds: string[] =
        Array.isArray(userData.turfIds) && userData.turfIds.length > 0
          ? userData.turfIds
          : userData.turfId ? [userData.turfId] : [];

      // Also pick up turfs via operatorIds array
      const [newFmt, legacy] = await Promise.all([
        getDocs(query(collection(db, "turfs"), where("operatorIds", "array-contains", uid))),
        getDocs(query(collection(db, "turfs"), where("operatorId",  "==",             uid))),
      ]);

      const allIds = Array.from(new Set([
        ...turfIds,
        ...newFmt.docs.map(d => d.id),
        ...legacy.docs.map(d => d.id),
      ]));

      const turfDocs: TurfInfo[] = [];
      const initForms: typeof forms = {};

      for (const id of allIds) {
        const snap = await getDoc(doc(db, "turfs", id));
        if (!snap.exists()) continue;
        const d = snap.data();
        const t: TurfInfo = {
          id,
          name:             d.name     || "Unnamed Turf",
          location:         d.location || "",
          status:           d.status   || "",
          statusNote:       d.statusNote || "",
          statusUpdatedAt:  d.statusUpdatedAt || "",
        };
        turfDocs.push(t);
        initForms[id] = { status: t.status || "", note: t.statusNote || "", saving: false };
      }

      setTurfs(turfDocs);
      setForms(initForms);
    } catch (e) {
      Alert.alert("Error", "Could not load turfs.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const setTurfForm = (turfId: string, patch: Partial<{ status: string; note: string; saving: boolean }>) =>
    setForms(prev => ({ ...prev, [turfId]: { ...prev[turfId], ...patch } }));

  const saveStatus = async (turf: TurfInfo) => {
    const form = forms[turf.id];
    if (!form) return;
    setTurfForm(turf.id, { saving: true });
    try {
      const now = new Date().toISOString();
      await updateDoc(doc(db, "turfs", turf.id), {
        status:          form.status || null,
        statusNote:      form.note.trim() || null,
        statusUpdatedAt: form.status ? now : null,
      });
      // Update local turf so the "last updated" line refreshes
      setTurfs(prev => prev.map(t =>
        t.id === turf.id
          ? { ...t, status: form.status, statusNote: form.note.trim(), statusUpdatedAt: form.status ? now : "" }
          : t
      ));
      Alert.alert("Updated ✓", form.status
        ? `Status set to "${STATUS_OPTIONS.find(o => o.key === form.status)?.label}" for ${turf.name}.`
        : `Status cleared for ${turf.name}.`
      );
    } catch {
      Alert.alert("Error", "Could not save status.");
    } finally {
      setTurfForm(turf.id, { saving: false });
    }
  };

  // ── Loading ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <SafeAreaView style={s.loadWrap}>
        <StatusBar barStyle="light-content" backgroundColor={DARK} />
        <ActivityIndicator size="large" color={ACCENT} />
        <Text style={s.loadText}>Loading turfs...</Text>
      </SafeAreaView>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <View style={s.safe}>
      <StatusBar barStyle="light-content" backgroundColor={DARK} />

      {/* Header */}
       <View style={[s.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity style={s.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={20} color="#fff" />
        </TouchableOpacity>
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={s.headerTitle}>Turf Status</Text>
          <Text style={s.headerSub}>Update field conditions for your customers</Text>
        </View>
      </View>

      <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" automaticallyAdjustKeyboardInsets
        showsVerticalScrollIndicator={false}
        contentContainerStyle={s.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => fetchTurfs(true)} tintColor={ACCENT} />}
      >
        {/* Info banner */}
        <View style={s.infoBanner}>
          <Ionicons name="information-circle-outline" size={18} color="#1D4ED8" />
          <Text style={s.infoBannerText}>
            Status updates are shown to users before they book. Keep it current — especially after rain or maintenance.
          </Text>
        </View>

        {turfs.length === 0 ? (
          <View style={s.empty}>
            <Ionicons name="football-outline" size={44} color="#D1D5DB" />
            <Text style={s.emptyTitle}>No turfs assigned</Text>
            <Text style={s.emptySub}>Contact your owner or admin to be assigned to a turf.</Text>
          </View>
        ) : (
          turfs.map((turf) => {
            const form    = forms[turf.id] || { status: "", note: "", saving: false };
            const current = STATUS_OPTIONS.find(o => o.key === form.status);
            const savedAt = turf.statusUpdatedAt
              ? new Date(turf.statusUpdatedAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
              : null;
            const hasChange =
              form.status !== (turf.status || "") ||
              form.note   !== (turf.statusNote || "");

            return (
              <View key={turf.id} style={s.card}>
                {/* Card header */}
                <View style={s.cardHeader}>
                  <View style={s.turfIconWrap}>
                    <Ionicons name="football" size={20} color={ACCENT} />
                  </View>
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={s.turfName}>{turf.name}</Text>
                    {turf.location ? (
                      <View style={s.locRow}>
                        <Ionicons name="location-outline" size={11} color="#9CA3AF" />
                        <Text style={s.locText}>{turf.location}</Text>
                      </View>
                    ) : null}
                  </View>
                  {/* Current status pill */}
                  {turf.status && (
                    <View style={[s.currentPill, {
                      backgroundColor: STATUS_OPTIONS.find(o => o.key === turf.status)?.bg ?? "#F3F4F6",
                      borderColor:     STATUS_OPTIONS.find(o => o.key === turf.status)?.border ?? "#E5E7EB",
                    }]}>
                      <Text style={{ fontSize: 14 }}>
                        {STATUS_OPTIONS.find(o => o.key === turf.status)?.emoji ?? "ℹ️"}
                      </Text>
                      <Text style={[s.currentPillText, {
                        color: STATUS_OPTIONS.find(o => o.key === turf.status)?.text ?? "#374151",
                      }]}>
                        {STATUS_OPTIONS.find(o => o.key === turf.status)?.label ?? turf.status}
                      </Text>
                    </View>
                  )}
                </View>

                {savedAt && turf.status && (
                  <Text style={s.lastUpdated}>Last updated at {savedAt}</Text>
                )}

                {/* Status picker */}
                <Text style={s.fieldLabel}>Set Status</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 4 }}>
                  <View style={{ flexDirection: "row", gap: 8, paddingBottom: 4 }}>
                    {STATUS_OPTIONS.map(opt => {
                      const isSelected = form.status === opt.key;
                      return (
                        <TouchableOpacity
                          key={opt.key}
                          onPress={() => setTurfForm(turf.id, { status: opt.key })}
                          style={[s.statusChip, {
                            backgroundColor: isSelected ? opt.bg    : "#F9FAFB",
                            borderColor:     isSelected ? opt.border : "#E5E7EB",
                          }]}
                        >
                          <Text style={s.statusChipEmoji}>{opt.emoji}</Text>
                          <Text style={[s.statusChipLabel, {
                            color: isSelected ? opt.text : "#9CA3AF",
                          }]}>
                            {opt.label}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </ScrollView>

                {/* Note — only show when a real status is selected */}
                {form.status !== "" && (
                  <>
                    <Text style={s.fieldLabel}>Note (optional)</Text>
                    <TextInput
                      style={s.noteInput}
                      placeholder="e.g. Heavy rain last night, pitch is soft near goal posts"
                      placeholderTextColor="#9CA3AF"
                      value={form.note}
                      onChangeText={v => setTurfForm(turf.id, { note: v })}
                      multiline
                      numberOfLines={3}
                      textAlignVertical="top"
                    />
                  </>
                )}

                {/* Save button */}
                <TouchableOpacity
                  style={[
                    s.saveBtn,
                    !hasChange && s.saveBtnDisabled,
                    form.saving && { opacity: 0.6 },
                  ]}
                  onPress={() => saveStatus(turf)}
                  disabled={form.saving || !hasChange}
                >
                  {form.saving ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <>
                      <Ionicons name="checkmark-circle-outline" size={16} color="#fff" />
                      <Text style={s.saveBtnText}>
                        {hasChange ? "Save Status" : "No Changes"}
                      </Text>
                    </>
                  )}
                </TouchableOpacity>

                {/* Preview — what users will see */}
                {form.status !== "" && current && (
                  <View style={[s.preview, { backgroundColor: current.bg, borderColor: current.border }]}>
                    <Text style={s.previewLabel}>Preview — what users see</Text>
                    <View style={s.previewRow}>
                      <Text style={{ fontSize: 20 }}>{current.emoji}</Text>
                      <View style={{ flex: 1, marginLeft: 10 }}>
                        <Text style={[s.previewTitle, { color: current.text }]}>{current.label}</Text>
                        {form.note.trim() ? (
                          <Text style={s.previewNote}>{form.note.trim()}</Text>
                        ) : null}
                      </View>
                    </View>
                  </View>
                )}
              </View>
            );
          })
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  safe:     { flex: 1, backgroundColor: "#F0F4F8" },
  loadWrap: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: DARK },
  loadText: { color: "#9CA3AF", marginTop: 12, fontSize: 15, fontWeight: "600" },
  scroll:   { padding: 16, paddingBottom: 40 },

  header:      { backgroundColor: DARK, flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingBottom: 18 },
  backBtn:     { width: 38, height: 38, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.08)", justifyContent: "center", alignItems: "center" },
  headerTitle: { color: "#fff", fontSize: 18, fontWeight: "900" },
  headerSub:   { color: "#9CA3AF", fontSize: 12, marginTop: 2 },

  infoBanner:     { flexDirection: "row", alignItems: "flex-start", gap: 10, backgroundColor: "#EFF6FF", borderRadius: 14, padding: 14, marginBottom: 16, borderWidth: 1, borderColor: "#BFDBFE" },
  infoBannerText: { fontSize: 13, color: "#1D4ED8", fontWeight: "600", flex: 1, lineHeight: 19 },

  empty:      { alignItems: "center", paddingVertical: 60 },
  emptyTitle: { fontSize: 17, fontWeight: "800", color: "#374151", marginTop: 14 },
  emptySub:   { fontSize: 13, color: "#9CA3AF", marginTop: 6, textAlign: "center" },

  card:       { backgroundColor: "#fff", borderRadius: 20, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: "#E5E7EB", shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 8, elevation: 2 },
  cardHeader: { flexDirection: "row", alignItems: "center", marginBottom: 12 },

  turfIconWrap: { width: 44, height: 44, borderRadius: 14, backgroundColor: "#F0FDF9", justifyContent: "center", alignItems: "center" },
  turfName:     { fontSize: 16, fontWeight: "900", color: "#0F172A" },
  locRow:       { flexDirection: "row", alignItems: "center", gap: 3, marginTop: 3 },
  locText:      { fontSize: 11, color: "#9CA3AF", fontWeight: "500" },

  currentPill:     { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 99, borderWidth: 1.5 },
  currentPillText: { fontSize: 11, fontWeight: "800" },

  lastUpdated: { fontSize: 11, color: "#9CA3AF", fontWeight: "500", marginBottom: 12, marginLeft: 2 },

  fieldLabel: { fontSize: 11, fontWeight: "800", color: "#6B7280", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 8, marginTop: 4 },

  statusChip:      { alignItems: "center", paddingHorizontal: 12, paddingVertical: 10, borderRadius: 14, borderWidth: 1.5, minWidth: 80 },
  statusChipEmoji: { fontSize: 18, textAlign: "center" },
  statusChipLabel: { fontSize: 10, fontWeight: "700", marginTop: 5, textAlign: "center" },

  noteInput: { backgroundColor: "#F9FAFB", borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: "#111827", minHeight: 80, marginBottom: 4 },

  saveBtn:         { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: DARK, paddingVertical: 14, borderRadius: 14, marginTop: 14 },
  saveBtnDisabled: { backgroundColor: "#E5E7EB" },
  saveBtnText:     { color: "#fff", fontWeight: "800", fontSize: 15 },

  preview:      { borderRadius: 14, padding: 14, marginTop: 14, borderWidth: 1.5 },
  previewLabel: { fontSize: 10, fontWeight: "800", color: "#9CA3AF", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 10 },
  previewRow:   { flexDirection: "row", alignItems: "center" },
  previewTitle: { fontSize: 14, fontWeight: "800" },
  previewNote:  { fontSize: 12, color: "#6B7280", fontWeight: "500", marginTop: 3, lineHeight: 17 },
});
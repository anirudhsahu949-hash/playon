/**
 * app/(owner)/customers.tsx — Owner's saved customers
 * • Search by name or phone, newest-booked first
 * • Add / edit / delete a customer (name, phone, note)
 * • Call or WhatsApp from the list
 * • Pick mode: opened from Block Slots with { pick: "1", q?: "typed name" }
 *   → tap a customer (or add a new one) and it fills the booking form
 */
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, StatusBar, ActivityIndicator, Alert, TextInput,
  Modal, KeyboardAvoidingView, Platform, Pressable, Linking, RefreshControl,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import {
  Customer, listCustomers, saveCustomer, deleteCustomer, searchCustomers, customerMeta,
  emitCustomerPicked, cancelCustomerPick, phone10,
} from "../../utils/customers";
import { openWhatsApp } from "../../utils/whatsapp";

// ── Palette ─────────────────────────────────────────────────────────────────
const BRAND = "#15803D";
const ACCENT = "#16A34A";
const ON_BRAND = "#DCFCE7";
const PAGE = "#F1F4F7";
const INK = "#0F172A";
const SLATE = "#475569";
const MUTED = "#64748B";
const FAINT = "#94A3B8";
const LINE = "#E5E7EB";
const WA_GREEN = "#25D366";

const AVATAR = ["#DCFCE7", "#DBEAFE", "#EDE9FE", "#FEF3C7", "#FCE7F3", "#E0F2FE"];
const AVATAR_FG = ["#15803D", "#1D4ED8", "#6D28D9", "#B45309", "#BE185D", "#0369A1"];
const avatarIdx = (name: string) => (name.charCodeAt(0) || 0) % AVATAR.length;
const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() || "").join("") || "?";
const fmtPhone = (p: string) => (p.length === 10 ? `${p.slice(0, 5)} ${p.slice(5)}` : p);

export default function CustomersScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ pick?: string; q?: string }>();
  const pickMode = params.pick === "1";

  const [list, setList] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState(String(params.q || ""));

  // add / edit sheet
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [fName, setFName] = useState("");
  const [fPhone, setFPhone] = useState("");
  const [fNote, setFNote] = useState("");
  const [saving, setSaving] = useState(false);

  const picked = useRef(false);
  // Leaving pick mode without choosing anyone → clear the handoff
  useEffect(() => () => { if (pickMode && !picked.current) cancelCustomerPick(); }, [pickMode]);

  const load = async (isRefresh = false) => {
    isRefresh ? setRefreshing(true) : null;
    try { setList(await listCustomers()); }
    catch { Alert.alert("Error", "Unable to load customers."); }
    finally { setLoading(false); setRefreshing(false); }
  };
  useFocusEffect(useCallback(() => { load(); }, []));

  const shown = useMemo(() => searchCustomers(list, search, 500), [list, search]);

  // ── Actions ──
  const pick = (c: Customer) => {
    picked.current = true;
    emitCustomerPicked(c);
    router.back();
  };

  const openAdd = () => {
    setEditing(null);
    const typed = search.trim();
    const digits = typed.replace(/\D/g, "");
    // Pre-fill from the search box: digits → phone, words → name
    if (digits.length >= 10 && digits.length === typed.replace(/[\s+-]/g, "").length) { setFName(""); setFPhone(typed); }
    else { setFName(typed); setFPhone(""); }
    setFNote("");
    setSheetOpen(true);
  };
  const openEdit = (c: Customer) => {
    setEditing(c);
    setFName(c.name); setFPhone(c.phone || ""); setFNote(c.note || "");
    setSheetOpen(true);
  };

  const submit = async () => {
    if (!fName.trim()) return Alert.alert("Name required", "Please enter the customer's name.");
    if (fPhone.trim() && !phone10(fPhone)) return Alert.alert("Check phone number", "Enter a valid 10-digit mobile number, or leave it empty.");
    // Warn before creating a second customer with the same phone
    const p = phone10(fPhone);
    const clash = p ? list.find(c => c.phone === p && c.id !== editing?.id) : null;
    if (clash && !editing) {
      return Alert.alert("Already saved", `${fPhone.trim()} is saved as "${clash.name}".`, [
        { text: "OK", style: "cancel" },
        ...(pickMode ? [{ text: `Use ${clash.name.split(" ")[0]}`, onPress: () => { setSheetOpen(false); pick(clash); } }] : []),
      ]);
    }
    setSaving(true);
    try {
      const id = await saveCustomer({ name: fName, phone: fPhone, note: fNote }, { replaceId: editing?.id });
      setSheetOpen(false);
      if (pickMode && !editing) {
        pick({ id, ownerId: "", name: fName.trim(), phone: p, note: fNote.trim(), bookingsCount: 0 });
        return;
      }
      await load();
    } catch (e: any) {
      Alert.alert("Error", e?.message || "Could not save the customer.");
    } finally {
      setSaving(false);
    }
  };

  const remove = (c: Customer) => {
    Alert.alert("Delete customer", `Remove ${c.name} from your saved customers? Their past bookings stay as they are.`, [
      { text: "Keep", style: "cancel" },
      {
        text: "Delete", style: "destructive", onPress: async () => {
          try { await deleteCustomer(c.id); setSheetOpen(false); await load(); }
          catch { Alert.alert("Error", "Could not delete the customer."); }
        },
      },
    ]);
  };

  const call = (c: Customer) => Linking.openURL(`tel:${c.phone}`).catch(() => Alert.alert("Can't call", "Your phone could not start the call."));
  const whatsapp = async (c: Customer) => {
    const ok = await openWhatsApp(c.phone, `Hi ${c.name.split(" ")[0]} 👋`);
    if (!ok) Alert.alert("Couldn't open WhatsApp", "Please check that WhatsApp is installed on this phone.");
  };

  // ── Render ──
  if (loading) {
    return (
      <View style={s.center}>
        <StatusBar barStyle="dark-content" />
        <ActivityIndicator size="large" color={ACCENT} />
        <Text style={s.loadTxt}>Loading customers…</Text>
      </View>
    );
  }

  const renderItem = ({ item: c }: { item: Customer }) => {
    const i = avatarIdx(c.name);
    return (
      <TouchableOpacity style={s.card} activeOpacity={0.8} onPress={() => (pickMode ? pick(c) : openEdit(c))}
        accessibilityLabel={pickMode ? `Use ${c.name}` : `Edit ${c.name}`}>
        <View style={[s.avatar, { backgroundColor: AVATAR[i] }]}><Text style={[s.avatarTxt, { color: AVATAR_FG[i] }]}>{initials(c.name)}</Text></View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={s.name} numberOfLines={1}>{c.name}</Text>
          <Text style={s.phone} numberOfLines={1}>{c.phone ? fmtPhone(c.phone) : "No phone"}</Text>
          <Text style={s.meta} numberOfLines={1}>{customerMeta(c)}</Text>
        </View>
        {pickMode ? (
          <View style={s.useBtn}><Text style={s.useTxt}>Use</Text></View>
        ) : !!c.phone && (
          <View style={{ flexDirection: "row", gap: 6 }}>
            <TouchableOpacity style={s.iconBtn} onPress={() => call(c)} accessibilityLabel={`Call ${c.name}`}>
              <Ionicons name="call-outline" size={17} color={INK} />
            </TouchableOpacity>
            <TouchableOpacity style={[s.iconBtn, { backgroundColor: WA_GREEN, borderColor: WA_GREEN }]} onPress={() => whatsapp(c)} accessibilityLabel={`WhatsApp ${c.name}`}>
              <Ionicons name="logo-whatsapp" size={17} color="#fff" />
            </TouchableOpacity>
          </View>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <View style={s.root}>
      <StatusBar barStyle="light-content" backgroundColor={BRAND} />

      {/* Header */}
      <View style={[s.header, { paddingTop: insets.top + 10 }]}>
        <View style={s.headerRow}>
          <TouchableOpacity style={s.hBtn} onPress={() => router.back()} accessibilityLabel="Back">
            <Ionicons name="arrow-back" size={20} color="#fff" />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={s.hKicker}>{pickMode ? "PICK A CUSTOMER" : "OWNER"}</Text>
            <Text style={s.hTitle}>Customers</Text>
          </View>
          <TouchableOpacity style={s.addBtn} onPress={openAdd} accessibilityLabel="Add customer">
            <Ionicons name="person-add-outline" size={16} color={BRAND} />
            <Text style={s.addTxt}>Add</Text>
          </TouchableOpacity>
        </View>
        <View style={s.searchWrap}>
          <Ionicons name="search" size={17} color={MUTED} />
          <TextInput value={search} onChangeText={setSearch} placeholder="Search name or phone" placeholderTextColor={FAINT}
            style={s.searchInput} autoCapitalize="words" returnKeyType="search" autoFocus={pickMode && !!params.q} />
          {!!search && (
            <TouchableOpacity onPress={() => setSearch("")} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} accessibilityLabel="Clear search">
              <Ionicons name="close-circle" size={18} color={FAINT} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {pickMode && (
        <View style={s.pickNote}>
          <Ionicons name="information-circle-outline" size={16} color={BRAND} />
          <Text style={s.pickNoteTxt}>Tap a customer to use them for this booking.</Text>
        </View>
      )}

      <FlatList
        data={shown}
        keyExtractor={c => c.id}
        renderItem={renderItem}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 14, gap: 8, paddingBottom: insets.bottom + 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={ACCENT} colors={[ACCENT]} />}
        ListHeaderComponent={list.length > 0 ? (
          <Text style={s.count}>{shown.length} of {list.length} CUSTOMER{list.length === 1 ? "" : "S"}</Text>
        ) : null}
        ListEmptyComponent={
          <View style={s.empty}>
            <View style={s.emptyIcon}><Ionicons name="people-outline" size={26} color={ACCENT} /></View>
            <Text style={s.emptyTitle}>{list.length === 0 ? "No saved customers yet" : `No match for “${search.trim()}”`}</Text>
            <Text style={s.emptySub}>
              {list.length === 0 ? "Add your regular customers here, or tick “Save to my customers” when you make an offline booking."
                : "Add them as a new customer."}
            </Text>
            <TouchableOpacity style={s.emptyBtn} onPress={openAdd}>
              <Ionicons name="person-add-outline" size={16} color="#fff" />
              <Text style={s.emptyBtnTxt}>{list.length > 0 && search.trim() ? `Add “${search.trim()}”` : "Add customer"}</Text>
            </TouchableOpacity>
          </View>
        }
      />

      {/* ══ ADD / EDIT SHEET ══ */}
      <Modal visible={sheetOpen} transparent animationType="slide" onRequestClose={() => !saving && setSheetOpen(false)} statusBarTranslucent>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
          <View style={s.backdrop}>
            <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => !saving && setSheetOpen(false)} />
            <View style={[s.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}>
              <View style={s.grabber} />
              <View style={s.sheetHead}>
                <Text style={s.sheetTitle}>{editing ? "Edit customer" : "New customer"}</Text>
                <TouchableOpacity style={s.closeX} onPress={() => !saving && setSheetOpen(false)} accessibilityLabel="Close">
                  <Ionicons name="close" size={18} color={SLATE} />
                </TouchableOpacity>
              </View>

              <Field label="Name *" value={fName} onChange={setFName} placeholder="Customer name" autoCapitalize="words" autoFocus={!editing && !fName} />
              <Field label="Phone or WhatsApp" value={fPhone} onChange={setFPhone} placeholder="10-digit mobile (optional)" keyboardType="phone-pad" />
              <Field label="Note" value={fNote} onChange={setFNote} placeholder="e.g. Sunday cricket team captain" />

              {editing && <Text style={s.sheetMeta}>{customerMeta(editing)}</Text>}

              <View style={s.btnRow}>
                {editing ? (
                  <TouchableOpacity style={[s.dangerGhost, { flex: 1 }]} onPress={() => remove(editing)} disabled={saving}>
                    <Ionicons name="trash-outline" size={16} color="#DC2626" />
                    <Text style={s.dangerGhostTxt}>Delete</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity style={[s.ghostBtn, { flex: 1 }]} onPress={() => setSheetOpen(false)} disabled={saving}>
                    <Text style={s.ghostTxt}>Cancel</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity style={[s.primaryBtn, { flex: 1.6 }, saving && { opacity: 0.6 }]} onPress={submit} disabled={saving}>
                  {saving ? <ActivityIndicator color="#fff" /> : (
                    <>
                      <Ionicons name="checkmark" size={18} color="#fff" />
                      <Text style={s.primaryTxt}>{editing ? "Save changes" : pickMode ? "Save & use" : "Save customer"}</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

// ── Tap-anywhere input field ────────────────────────────────────────────────
function Field({ label, value, onChange, placeholder, keyboardType, autoCapitalize, autoFocus }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string;
  keyboardType?: "default" | "phone-pad"; autoCapitalize?: "none" | "words" | "sentences"; autoFocus?: boolean;
}) {
  const ref = useRef<TextInput>(null);
  const [focused, setFocused] = useState(false);
  return (
    <Pressable onPress={() => ref.current?.focus()} accessible={false}>
      <Text style={s.fieldLabel}>{label}</Text>
      <View style={[s.inputWrap, focused && s.inputWrapOn]}>
        <TextInput ref={ref} value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={FAINT}
          keyboardType={keyboardType || "default"} autoCapitalize={autoCapitalize} autoFocus={autoFocus}
          onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} returnKeyType="done" style={s.input} />
      </View>
    </Pressable>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────
const shadow = { shadowColor: INK, shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 2 }, elevation: 2 };

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: PAGE },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: PAGE },
  loadTxt: { marginTop: 12, color: MUTED, fontSize: 15, fontWeight: "600" },

  header: { backgroundColor: BRAND, paddingHorizontal: 16, paddingBottom: 14, borderBottomLeftRadius: 22, borderBottomRightRadius: 22, gap: 12 },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  hBtn: { width: 44, height: 44, borderRadius: 13, backgroundColor: "rgba(255,255,255,0.14)", alignItems: "center", justifyContent: "center" },
  hKicker: { fontSize: 10, letterSpacing: 1.4, fontWeight: "800", color: ON_BRAND },
  hTitle: { fontSize: 20, fontWeight: "900", color: "#fff" },
  addBtn: { height: 40, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, borderRadius: 12, backgroundColor: "#fff" },
  addTxt: { fontSize: 13.5, fontWeight: "900", color: BRAND },
  searchWrap: { flexDirection: "row", alignItems: "center", gap: 8, height: 46, borderRadius: 13, backgroundColor: "#fff", paddingHorizontal: 12 },
  searchInput: { flex: 1, height: "100%", fontSize: 15, fontWeight: "700", color: INK, paddingVertical: 0 },

  pickNote: { flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: 14, marginTop: 12, padding: 10, borderRadius: 12, backgroundColor: "#F0FDF4", borderWidth: 1, borderColor: "#BBF7D0" },
  pickNoteTxt: { flex: 1, fontSize: 12.5, fontWeight: "700", color: "#14532D" },

  count: { fontSize: 12, fontWeight: "800", letterSpacing: 0.6, color: SLATE, marginBottom: 2, paddingHorizontal: 2 },
  card: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#fff", borderRadius: 16, padding: 12, ...shadow },
  avatar: { width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  avatarTxt: { fontSize: 15, fontWeight: "900" },
  name: { fontSize: 15, fontWeight: "900", color: INK },
  phone: { fontSize: 12.5, fontWeight: "700", color: SLATE, marginTop: 1 },
  meta: { fontSize: 11, fontWeight: "600", color: FAINT, marginTop: 2 },
  iconBtn: { width: 40, height: 40, borderRadius: 12, borderWidth: 1, borderColor: LINE, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" },
  useBtn: { height: 36, paddingHorizontal: 16, borderRadius: 11, backgroundColor: BRAND, justifyContent: "center" },
  useTxt: { fontSize: 13, fontWeight: "900", color: "#fff" },

  empty: { alignItems: "center", paddingTop: 40, paddingHorizontal: 30 },
  emptyIcon: { width: 60, height: 60, borderRadius: 20, backgroundColor: "#DCFCE7", alignItems: "center", justifyContent: "center" },
  emptyTitle: { fontSize: 15, fontWeight: "900", color: INK, marginTop: 10, textAlign: "center" },
  emptySub: { fontSize: 13, color: MUTED, textAlign: "center", marginTop: 4, lineHeight: 19, fontWeight: "600" },
  emptyBtn: { marginTop: 16, flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: BRAND, paddingHorizontal: 18, height: 46, borderRadius: 13 },
  emptyBtnTxt: { color: "#fff", fontSize: 14, fontWeight: "800" },

  backdrop: { flex: 1, backgroundColor: "rgba(11,18,32,0.55)" },
  sheet: { backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 16, paddingTop: 10, gap: 12 },
  grabber: { width: 40, height: 4, borderRadius: 2, backgroundColor: "#CBD5E1", alignSelf: "center" },
  sheetHead: { flexDirection: "row", alignItems: "center" },
  sheetTitle: { flex: 1, fontSize: 18, fontWeight: "900", color: INK },
  closeX: { width: 36, height: 36, borderRadius: 18, backgroundColor: "#F1F5F9", alignItems: "center", justifyContent: "center" },
  sheetMeta: { fontSize: 12, fontWeight: "700", color: MUTED },
  fieldLabel: { fontSize: 12, fontWeight: "800", color: "#334155", marginBottom: 5 },
  inputWrap: { height: 48, borderRadius: 12, borderWidth: 1, borderColor: LINE, backgroundColor: "#F8FAFC", paddingHorizontal: 12, justifyContent: "center" },
  inputWrapOn: { borderColor: ACCENT, borderWidth: 1.5, backgroundColor: "#fff" },
  input: { height: "100%", fontSize: 15, fontWeight: "700", color: INK, paddingVertical: 0 },
  btnRow: { flexDirection: "row", gap: 8, marginTop: 4 },
  ghostBtn: { height: 50, borderRadius: 14, backgroundColor: "#F1F5F9", alignItems: "center", justifyContent: "center" },
  ghostTxt: { fontSize: 14, fontWeight: "800", color: "#334155" },
  dangerGhost: { height: 50, borderRadius: 14, backgroundColor: "#FEF2F2", borderWidth: 1, borderColor: "#FECACA", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  dangerGhostTxt: { fontSize: 14, fontWeight: "800", color: "#DC2626" },
  primaryBtn: { height: 50, borderRadius: 14, backgroundColor: BRAND, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  primaryTxt: { fontSize: 15, fontWeight: "800", color: "#fff" },
});

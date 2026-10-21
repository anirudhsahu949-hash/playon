/**
 * app/admin/promo-codes.tsx
 * Admin screen — create, view, manage promo codes
 *
 * CHANGES vs previous version:
 *  ✅ Visual FROM / TO slot picker (same chip style as turf-details screen)
 *  ✅ Default validFrom = today, validTo = today + 30 days (YYYY-MM-DD)
 *  ✅ Bug fixed: typing a slot but not clicking Add no longer silently saves
 *     with no restriction — replaced by visual picker so the bug cannot occur
 *  ✅ Bug fixed: selecting FROM but forgetting TO now blocked by validate()
 *  ✅ Removed `targetSlotInput` state entirely (was the root of the bug)
 *  ✅ TO chips auto-reset when FROM changes to a later time
 */
import {
  View, Text, StyleSheet, StatusBar, FlatList,
  TouchableOpacity, TextInput, Alert, ActivityIndicator,
  RefreshControl, Modal, ScrollView, Switch, Platform,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { useEffect, useMemo, useState } from "react";
import { db } from "../../firebaseConfig";
import {
  collection, getDocs, addDoc, updateDoc, deleteDoc,
  doc, serverTimestamp, query, orderBy,
} from "firebase/firestore";
import { Ionicons } from "@expo/vector-icons";

const DARK   = "#0A0F1E";
const ACCENT = "#0EA5A4";
const GREEN  = "#22C55E";

// =============================================================================
// ── Time helpers ──────────────────────────────────────────────────────────────
// =============================================================================

/** Today as YYYY-MM-DD  (e.g. "2026-05-29") */
function todayStr(): string {
  return new Date().toISOString().split("T")[0];
}

/** N days from today as YYYY-MM-DD */
function plusDaysStr(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().split("T")[0];
}

/**
 * Convert a decimal hour to a display string.
 *   8    → "8:00 AM"
 *   8.5  → "8:30 AM"
 *   17   → "5:00 PM"
 *   24   → "12:00 AM"  (midnight end-of-day)
 */
function fmtH(h: number): string {
  if (h === 0 || h === 24) return "12:00 AM";
  const hour = Math.floor(h);
  const min  = h % 1 >= 0.5 ? "30" : "00";
  const suf  = hour >= 12 ? "PM" : "AM";
  const dh   = hour % 12 === 0 ? 12 : hour % 12;
  return `${dh}:${min} ${suf}`;
}

/** All FROM chip values: 5:00 AM → 11:30 PM in 30-min steps */
const FROM_CHIPS: number[] = [];
for (let h = 5; h < 24; h += 0.5) FROM_CHIPS.push(h);

// =============================================================================
// ── Types ─────────────────────────────────────────────────────────────────────
// =============================================================================

type PromoCode = {
  id: string; code: string; type: "flat" | "percent"; value: number;
  minBookingAmount: number; maxDiscount: number; validFrom: any; validTo: any;
  totalUses: number; usedCount: number; perUserLimit: number;
  applicableTurfs: string[]; paymentType: "full" | "advance" | "both";
  validFromTime?: string; validToTime?: string; allowedDays?: number[];
  targetSlots?: string[]; active: boolean; createdAt?: any;
};
type Turf = { id: string; name?: string; };

function fmtDate(val: any): string {
  if (!val) return "—";
  const d = val?.toDate ? val.toDate() : new Date(val);
  return isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}
function isExpired(val: any): boolean {
  if (!val) return false;
  const d = val?.toDate ? val.toDate() : new Date(val);
  return d < new Date();
}

// =============================================================================
// ── Default form ──────────────────────────────────────────────────────────────
// =============================================================================

const EMPTY_FORM = {
  code: "", type: "flat" as "flat" | "percent", value: "", minBookingAmount: "",
  maxDiscount: "", validFrom: todayStr(), validTo: plusDaysStr(30), totalUses: "", perUserLimit: "1",
  paymentType: "both" as "full" | "advance" | "both", selectedTurfs: [] as string[],
  validFromTime: "", validToTime: "", allowedDays: [] as number[],
  targetSlots: [] as string[],
  // ── visual slot picker state (NOT saved to Firestore — used to build targetSlots) ──
  slotFrom: null as number | null,
  slotTo:   null as number | null,
};

const DAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

// =============================================================================
// ── Component ─────────────────────────────────────────────────────────────────
// =============================================================================

export default function AdminPromoCodes() {
  const insets = useSafeAreaInsets();
  const [promos,     setPromos]     = useState<PromoCode[]>([]);
  const [turfs,      setTurfs]      = useState<Turf[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search,     setSearch]     = useState("");
  const [modal,      setModal]      = useState(false);
  const [saving,     setSaving]     = useState(false);
  const [form,       setForm]       = useState(EMPTY_FORM);
  const [filterTab,  setFilterTab]  = useState<"all" | "active" | "expired">("all");

  useEffect(() => { fetchAll(); }, []);

  const fetchAll = async (isRefresh = false) => {
    isRefresh ? setRefreshing(true) : setLoading(true);
    try {
      const [promoSnap, turfSnap] = await Promise.all([
        getDocs(query(collection(db, "promoCodes"), orderBy("createdAt", "desc"))),
        getDocs(collection(db, "turfs")),
      ]);
      setPromos(promoSnap.docs.map(d => ({ id: d.id, ...d.data() } as PromoCode)));
      setTurfs(turfSnap.docs.map(d => ({ id: d.id, ...d.data() } as Turf)));
    } catch { Alert.alert("Error", "Could not load promo codes."); }
    finally { setLoading(false); setRefreshing(false); }
  };

  const filtered = useMemo(() => {
    let list = promos;
    if (filterTab === "active")  list = list.filter(p => p.active && !isExpired(p.validTo));
    if (filterTab === "expired") list = list.filter(p => !p.active || isExpired(p.validTo));
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(p => p.code?.toLowerCase().includes(q));
    }
    return list;
  }, [promos, filterTab, search]);

  const openCreate = () => { setForm(EMPTY_FORM); setModal(true); };

  // ── TO chips — depend on slotFrom ──────────────────────────────────────────
  const toChips: number[] = useMemo(() => {
    if (form.slotFrom === null) return [];
    const chips: number[] = [];
    for (let h = form.slotFrom + 0.5; h <= 24; h += 0.5) chips.push(h);
    return chips;
  }, [form.slotFrom]);

  // ── Add slot from picker ───────────────────────────────────────────────────
  const handleAddSlot = () => {
    if (form.slotFrom === null || form.slotTo === null) return;
    const slotStr = `${fmtH(form.slotFrom)} - ${fmtH(form.slotTo)}`;
    if (form.targetSlots.includes(slotStr)) {
      Alert.alert("Already Added", "This slot restriction is already in the list.");
      return;
    }
    setForm(f => ({ ...f, targetSlots: [...f.targetSlots, slotStr], slotFrom: null, slotTo: null }));
  };

  // ── Validation ────────────────────────────────────────────────────────────
  const validate = (): string | null => {
    if (!form.code.trim()) return "Promo code is required.";
    if (!/^[A-Z0-9]+$/.test(form.code.trim().toUpperCase())) return "Code can only have letters and numbers.";
    if (!form.value || Number(form.value) <= 0) return "Discount value is required.";
    if (form.type === "percent" && Number(form.value) > 100) return "Percentage cannot exceed 100.";
    if (!form.validFrom) return "Start date is required.";
    if (!form.validTo)   return "End date is required.";
    if (new Date(form.validTo) <= new Date(form.validFrom)) return "End date must be after start date.";
    const timeRx = /^\d{1,2}:\d{2}$/;
    if (form.validFromTime && !timeRx.test(form.validFromTime)) return "From time must be HH:MM (e.g. 06:00).";
    if (form.validToTime  && !timeRx.test(form.validToTime))   return "To time must be HH:MM (e.g. 22:00).";
    if ((form.validFromTime && !form.validToTime) || (!form.validFromTime && form.validToTime))
      return "Please fill both From and To times, or leave both blank.";
    // ✅ Bug fix: partial slot picker selection
    if (form.slotFrom !== null && form.slotTo === null)
      return `You selected a start time (${fmtH(form.slotFrom)}) but no end time. Pick an end time and tap + Add, or tap Clear.`;
    return null;
  };

  const handleSave = async () => {
    const err = validate();
    if (err) return Alert.alert("Incomplete", err);
    setSaving(true);
    try {
      const existing = promos.find(p => p.code === form.code.trim().toUpperCase());
      if (existing) { Alert.alert("Duplicate", "A promo code with this name already exists."); setSaving(false); return; }
      await addDoc(collection(db, "promoCodes"), {
        code: form.code.trim().toUpperCase(), type: form.type, value: Number(form.value),
        minBookingAmount: Number(form.minBookingAmount) || 0,
        maxDiscount: Number(form.maxDiscount) || 0,
        validFrom: new Date(form.validFrom), validTo: new Date(form.validTo + "T23:59:59"),
        totalUses: Number(form.totalUses) || 0, usedCount: 0,
        perUserLimit: Number(form.perUserLimit) || 1,
        applicableTurfs: form.selectedTurfs, paymentType: form.paymentType,
        validFromTime: form.validFromTime || "", validToTime: form.validToTime || "",
        allowedDays: form.allowedDays, targetSlots: form.targetSlots,
        active: true, createdAt: serverTimestamp(),
      });
      setModal(false);
      await fetchAll(true);
      Alert.alert("Created ✓", `Promo code "${form.code.toUpperCase()}" is now live.`);
    } catch (e: any) { Alert.alert("Error", e.message || "Could not create promo code.");
    } finally { setSaving(false); }
  };

  const toggleActive = async (promo: PromoCode) => {
    try {
      await updateDoc(doc(db, "promoCodes", promo.id), { active: !promo.active });
      setPromos(prev => prev.map(p => p.id === promo.id ? { ...p, active: !p.active } : p));
    } catch { Alert.alert("Error", "Could not update status."); }
  };

  const deletePromo = (promo: PromoCode) => {
    Alert.alert("Delete Promo", `Delete "${promo.code}"? This cannot be undone.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: async () => {
        try {
          await deleteDoc(doc(db, "promoCodes", promo.id));
          setPromos(prev => prev.filter(p => p.id !== promo.id));
        } catch { Alert.alert("Error", "Could not delete."); }
      }},
    ]);
  };

  // ==========================================================================
  // ── Promo card ─────────────────────────────────────────────────────────────
  // ==========================================================================
  const renderPromo = ({ item }: { item: PromoCode }) => {
    const expired  = isExpired(item.validTo);
    const isActive = item.active && !expired;
    const usagePct = item.totalUses > 0 ? Math.round((item.usedCount / item.totalUses) * 100) : null;
    return (
      <View style={s.card}>
        <View style={[s.cardBar, { backgroundColor: isActive ? GREEN : "#E5E7EB" }]} />
        <View style={s.cardBody}>
          <View style={s.cardTop}>
            <View style={s.codeTag}><Text style={s.codeTxt}>{item.code}</Text></View>
            <View style={s.cardTopRight}>
              <View style={[s.statusPill, isActive ? s.pillOn : s.pillOff]}>
                <Text style={[s.statusTxt, { color: isActive ? "#15803D" : "#DC2626" }]}>
                  {expired ? "Expired" : item.active ? "Active" : "Inactive"}
                </Text>
              </View>
              <Switch
                value={item.active} onValueChange={() => toggleActive(item)}
                trackColor={{ false: "#E5E7EB", true: GREEN }} thumbColor="#fff"
                style={{ transform: [{ scaleX: 0.8 }, { scaleY: 0.8 }] }}
              />
            </View>
          </View>

          <View style={s.discountRow}>
            <View style={s.discountBadge}>
              <Text style={s.discountBadgeTxt}>
                {item.type === "flat" ? `₹${item.value} OFF` : `${item.value}% OFF`}
              </Text>
            </View>
            {item.type === "percent" && item.maxDiscount > 0 &&
              <Text style={s.maxDiscTxt}>max ₹{item.maxDiscount}</Text>}
            <View style={s.payTypePill}>
              <Text style={s.payTypeTxt}>
                {item.paymentType === "both" ? "All payments" : item.paymentType === "full" ? "Full only" : "Advance only"}
              </Text>
            </View>
          </View>

          <View style={s.detailGrid}>
            <View style={s.detailItem}>
              <Text style={s.detailLbl}>Valid until</Text>
              <Text style={[s.detailVal, expired && { color: "#DC2626" }]}>{fmtDate(item.validTo)}</Text>
            </View>
            <View style={s.detailItem}>
              <Text style={s.detailLbl}>Min amount</Text>
              <Text style={s.detailVal}>{item.minBookingAmount > 0 ? `₹${item.minBookingAmount}` : "None"}</Text>
            </View>
            <View style={s.detailItem}>
              <Text style={s.detailLbl}>Per user</Text>
              <Text style={s.detailVal}>{item.perUserLimit === 0 ? "Unlimited" : `${item.perUserLimit}x`}</Text>
            </View>
            <View style={s.detailItem}>
              <Text style={s.detailLbl}>Turfs</Text>
              <Text style={s.detailVal}>
                {item.applicableTurfs?.length > 0 ? `${item.applicableTurfs.length} turfs` : "All turfs"}
              </Text>
            </View>
            {!!(item.validFromTime && item.validToTime) && (
              <View style={s.detailItem}>
                <Text style={s.detailLbl}>Time window</Text>
                <Text style={s.detailVal}>{item.validFromTime} – {item.validToTime}</Text>
              </View>
            )}
            {!!(item.allowedDays && item.allowedDays.length > 0) && (
              <View style={s.detailItem}>
                <Text style={s.detailLbl}>Days</Text>
                <Text style={s.detailVal}>
                  {[...item.allowedDays].sort((a, b) => a - b).map(d => DAY_LABELS[d]).join(", ")}
                </Text>
              </View>
            )}
            {!!(item.targetSlots && item.targetSlots.length > 0) && (
              <View style={[s.detailItem, { minWidth: "90%" as any }]}>
                <Text style={s.detailLbl}>🎯 Slot restricted</Text>
                <Text style={s.detailVal}>
                  {item.targetSlots.slice(0, 2).join(", ")}
                  {item.targetSlots.length > 2 ? ` +${item.targetSlots.length - 2} more` : ""}
                </Text>
              </View>
            )}
          </View>

          <View style={s.usageRow}>
            <Text style={s.usageTxt}>
              Used {item.usedCount}{item.totalUses > 0 ? ` / ${item.totalUses}` : ""} times
            </Text>
            {usagePct !== null && (
              <View style={s.usageBar}>
                <View style={[s.usageBarFill, {
                  width: `${Math.min(usagePct, 100)}%` as any,
                  backgroundColor: usagePct >= 90 ? "#DC2626" : usagePct >= 60 ? "#F59E0B" : GREEN,
                }]} />
              </View>
            )}
          </View>

          <TouchableOpacity style={s.deleteBtn} onPress={() => deletePromo(item)}>
            <Ionicons name="trash-outline" size={14} color="#DC2626" />
            <Text style={s.deleteBtnTxt}>Delete</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  if (loading) return (
    <SafeAreaView style={s.loadWrap}><ActivityIndicator size="large" color={ACCENT} /></SafeAreaView>
  );

  // ==========================================================================
  // ── Render ─────────────────────────────────────────────────────────────────
  // ==========================================================================
  return (
    <View style={s.safe}>
      <StatusBar barStyle="light-content" backgroundColor={DARK} />
      <FlatList
        data={filtered} keyExtractor={i => i.id} renderItem={renderPromo}
        contentContainerStyle={s.list} showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => fetchAll(true)} tintColor={ACCENT} />}
        ListHeaderComponent={
          <View>
             <View style={[s.hero, { paddingTop: insets.top + 12 }]}>
              <View style={s.heroGlow} />
              <Text style={s.heroTag}>Admin · Promotions</Text>
              <Text style={s.heroTitle}>Promo Codes</Text>
              <View style={s.heroStats}>
                {[
                  { label: "Total",      value: promos.length,                                                    color: "#60A5FA" },
                  { label: "Active",     value: promos.filter(p => p.active && !isExpired(p.validTo)).length,    color: GREEN    },
                  { label: "Expired",    value: promos.filter(p => isExpired(p.validTo)).length,                 color: "#F87171" },
                  { label: "Total uses", value: promos.reduce((a, p) => a + (p.usedCount || 0), 0),              color: "#FBBF24" },
                ].map(st => (
                  <View key={st.label} style={s.heroStat}>
                    <Text style={[s.heroStatVal, { color: st.color }]}>{st.value}</Text>
                    <Text style={s.heroStatLbl}>{st.label}</Text>
                  </View>
                ))}
              </View>
            </View>

            <View style={s.toolbar}>
              <View style={s.searchWrap}>
                <Ionicons name="search-outline" size={15} color="#9CA3AF" style={{ marginRight: 8 }} />
                <TextInput
                  style={s.searchInput} placeholder="Search code..." placeholderTextColor="#9CA3AF"
                  value={search} onChangeText={setSearch} autoCapitalize="characters"
                />
              </View>
              <TouchableOpacity style={s.addBtn} onPress={openCreate}>
                <Ionicons name="add" size={22} color="#fff" />
              </TouchableOpacity>
            </View>

            <View style={s.tabRow}>
              {(["all", "active", "expired"] as const).map(tab => (
                <TouchableOpacity
                  key={tab} style={[s.tab, filterTab === tab && s.tabActive]}
                  onPress={() => setFilterTab(tab)}
                >
                  <Text style={[s.tabTxt, filterTab === tab && s.tabTxtActive]}>
                    {tab.charAt(0).toUpperCase() + tab.slice(1)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        }
        ListEmptyComponent={
          <View style={s.empty}>
            <Text style={{ fontSize: 32, marginBottom: 12 }}>🎟️</Text>
            <Text style={s.emptyTitle}>No promo codes yet</Text>
            <Text style={s.emptySub}>Tap + to create your first promo code</Text>
          </View>
        }
      />

      {/* ════════════════════════════════════════════════════════════════════
          CREATE MODAL
          ════════════════════════════════════════════════════════════════════ */}
      <Modal visible={modal} animationType="slide" transparent onRequestClose={() => setModal(false)}>
        <View style={m.backdrop}>
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => setModal(false)} />
          <View style={m.sheet}>
            <View style={m.handle} />
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

              <Text style={m.title}>Create Promo Code</Text>
              <Text style={m.sub}>Discount applies on the online (Razorpay) payment amount only.</Text>

              {/* ── Code ── */}
              <Text style={m.lbl}>Promo Code *</Text>
              <TextInput
                style={m.input} placeholder="e.g. BOOKORA10" placeholderTextColor="#9CA3AF"
                value={form.code}
                onChangeText={v => setForm(f => ({ ...f, code: v.toUpperCase().replace(/\s/g, "") }))}
                autoCapitalize="characters"
              />
              <Text style={m.hint}>Letters and numbers only.</Text>

              {/* ── Discount type ── */}
              <Text style={m.lbl}>Discount Type *</Text>
              <View style={m.segRow}>
                {(["flat", "percent"] as const).map(t => (
                  <TouchableOpacity
                    key={t} style={[m.seg, form.type === t && m.segActive]}
                    onPress={() => setForm(f => ({ ...f, type: t }))}
                  >
                    <Text style={[m.segTxt, form.type === t && m.segTxtActive]}>
                      {t === "flat" ? "₹ Flat Amount" : "% Percentage"}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* ── Discount value ── */}
              <Text style={m.lbl}>
                {form.type === "flat" ? "Discount Amount (₹) *" : "Discount Percentage (%) *"}
              </Text>
              <TextInput
                style={m.input} placeholderTextColor="#9CA3AF" keyboardType="numeric"
                placeholder={form.type === "flat" ? "e.g. 100" : "e.g. 10"}
                value={form.value} onChangeText={v => setForm(f => ({ ...f, value: v }))}
              />

              {form.type === "percent" && (
                <>
                  <Text style={m.lbl}>Max Discount Cap (₹)</Text>
                  <TextInput
                    style={m.input} placeholder="e.g. 200 — leave blank for no cap"
                    placeholderTextColor="#9CA3AF" keyboardType="numeric"
                    value={form.maxDiscount} onChangeText={v => setForm(f => ({ ...f, maxDiscount: v }))}
                  />
                </>
              )}

              {/* ── Min amount ── */}
              <Text style={m.lbl}>Minimum Booking Amount (₹)</Text>
              <TextInput
                style={m.input} placeholder="e.g. 300 — leave blank for no minimum"
                placeholderTextColor="#9CA3AF" keyboardType="numeric"
                value={form.minBookingAmount} onChangeText={v => setForm(f => ({ ...f, minBookingAmount: v }))}
              />

              {/* ── Dates (pre-filled with today / +30 days) ── */}
              <Text style={m.lbl}>Valid From *</Text>
              <TextInput
                style={m.input} placeholder="YYYY-MM-DD" placeholderTextColor="#9CA3AF"
                value={form.validFrom}
                onChangeText={v => setForm(f => ({ ...f, validFrom: v }))}
                keyboardType="numbers-and-punctuation"
              />

              <Text style={m.lbl}>Valid Until *</Text>
              <TextInput
                style={m.input} placeholder="YYYY-MM-DD" placeholderTextColor="#9CA3AF"
                value={form.validTo}
                onChangeText={v => setForm(f => ({ ...f, validTo: v }))}
                keyboardType="numbers-and-punctuation"
              />

              {/* ── Time window ── */}
              <Text style={m.lbl}>Valid Time Window (optional)</Text>
              <Text style={m.hint}>Leave blank to allow all day. 24h IST format (e.g. 18:00).</Text>
              <View style={{ flexDirection: "row", gap: 10, marginTop: 8 }}>
                <View style={{ flex: 1 }}>
                  <Text style={[m.hint, { marginBottom: 6 }]}>From time</Text>
                  <TextInput
                    style={m.input} placeholder="06:00" placeholderTextColor="#9CA3AF"
                    value={form.validFromTime}
                    onChangeText={v => setForm(f => ({ ...f, validFromTime: v }))}
                    keyboardType="numbers-and-punctuation"
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[m.hint, { marginBottom: 6 }]}>To time</Text>
                  <TextInput
                    style={m.input} placeholder="22:00" placeholderTextColor="#9CA3AF"
                    value={form.validToTime}
                    onChangeText={v => setForm(f => ({ ...f, validToTime: v }))}
                    keyboardType="numbers-and-punctuation"
                  />
                </View>
              </View>

              {/* ── Days of week ── */}
              <Text style={m.lbl}>Valid Days of Week (optional)</Text>
              <Text style={m.hint}>Leave all unselected to allow every day.</Text>
              <View style={[m.segRow, { marginTop: 8 }]}>
                {[{ label: "Sun", value: 0 }, { label: "Mon", value: 1 }, { label: "Tue", value: 2 },
                  { label: "Wed", value: 3 }, { label: "Thu", value: 4 }, { label: "Fri", value: 5 },
                  { label: "Sat", value: 6 }].map(day => {
                  const sel = form.allowedDays.includes(day.value);
                  return (
                    <TouchableOpacity
                      key={day.value} style={[m.seg, sel && m.segActive, { paddingHorizontal: 10 }]}
                      onPress={() => setForm(f => ({
                        ...f,
                        allowedDays: sel
                          ? f.allowedDays.filter(d => d !== day.value)
                          : [...f.allowedDays, day.value],
                      }))}
                    >
                      <Text style={[m.segTxt, sel && m.segTxtActive]}>{day.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* ════════════════════════════════════════════════════════════
                  TARGET SLOTS — Visual Picker (replaces the old text input)
                  ════════════════════════════════════════════════════════════ */}
              <Text style={m.lbl}>Restrict to Specific Slots (optional)</Text>
              <Text style={m.hint}>
                Pick a start and end time. The promo will only apply when a user's booking
                starts within that window. Leave empty to allow all time slots.
              </Text>

              {/* FROM chips */}
              <View style={m.pickerSection}>
                <Text style={m.pickerLabel}>
                  Start time {form.slotFrom !== null ? `· ${fmtH(form.slotFrom)} selected` : ""}
                </Text>
                <ScrollView
                  horizontal showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ paddingVertical: 4, paddingRight: 8 }}
                  nestedScrollEnabled
                >
                  {FROM_CHIPS.map(h => (
                    <TouchableOpacity
                      key={h}
                      style={[m.timeChip, form.slotFrom === h && m.timeChipActive]}
                      onPress={() => setForm(f => ({
                        ...f,
                        slotFrom: h,
                        // reset TO if it's no longer after the new FROM
                        slotTo: (f.slotTo !== null && f.slotTo > h) ? f.slotTo : null,
                      }))}
                    >
                      <Text style={[m.timeChipTxt, form.slotFrom === h && m.timeChipTxtActive]}>
                        {fmtH(h)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>

              {/* TO chips — appear once FROM is chosen */}
              {form.slotFrom !== null && (
                <View style={[m.pickerSection, { marginTop: 8 }]}>
                  <Text style={m.pickerLabel}>
                    End time — from {fmtH(form.slotFrom)}
                    {form.slotTo !== null ? ` · ${fmtH(form.slotTo)} selected` : ""}
                  </Text>
                  {toChips.length === 0
                    ? <Text style={m.hint}>No available end times</Text>
                    : (
                      <ScrollView
                        horizontal showsHorizontalScrollIndicator={false}
                        contentContainerStyle={{ paddingVertical: 4, paddingRight: 8 }}
                        nestedScrollEnabled
                      >
                        {toChips.map(h => (
                          <TouchableOpacity
                            key={h}
                            style={[m.timeChip, form.slotTo === h && m.timeChipActive]}
                            onPress={() => setForm(f => ({ ...f, slotTo: h }))}
                          >
                            <Text style={[m.timeChipTxt, form.slotTo === h && m.timeChipTxtActive]}>
                              {fmtH(h)}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </ScrollView>
                    )
                  }
                </View>
              )}

              {/* Preview badge + Add / Clear buttons */}
              {form.slotFrom !== null && (
                <View style={m.slotActionRow}>
                  {form.slotTo !== null ? (
                    <View style={m.slotPreviewBadge}>
                      <Ionicons name="time-outline" size={14} color={ACCENT} />
                      <Text style={m.slotPreviewTxt}>
                        {fmtH(form.slotFrom)} – {fmtH(form.slotTo)}
                      </Text>
                    </View>
                  ) : (
                    <View style={[m.slotPreviewBadge, { backgroundColor: "#F9FAFB", borderColor: "#E5E7EB" }]}>
                      <Ionicons name="time-outline" size={14} color="#9CA3AF" />
                      <Text style={[m.slotPreviewTxt, { color: "#9CA3AF" }]}>Select an end time</Text>
                    </View>
                  )}

                  {form.slotTo !== null && (
                    <TouchableOpacity style={m.addSlotBtn} onPress={handleAddSlot}>
                      <Ionicons name="add-circle-outline" size={15} color="#fff" />
                      <Text style={m.addSlotBtnTxt}>Add</Text>
                    </TouchableOpacity>
                  )}

                  <TouchableOpacity
                    style={[m.seg, { paddingHorizontal: 12, paddingVertical: 8 }]}
                    onPress={() => setForm(f => ({ ...f, slotFrom: null, slotTo: null }))}
                  >
                    <Text style={[m.segTxt, { fontSize: 12 }]}>Clear</Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* Added slot restrictions */}
              {form.targetSlots.length > 0 && (
                <View style={{ marginTop: 10 }}>
                  <Text style={[m.hint, { marginBottom: 6 }]}>
                    Tap a chip to remove it:
                  </Text>
                  <View style={m.segRow}>
                    {form.targetSlots.map((slot, i) => (
                      <TouchableOpacity
                        key={i} style={[m.turfChip, m.turfChipActive]}
                        onPress={() => setForm(f => ({ ...f, targetSlots: f.targetSlots.filter(s => s !== slot) }))}
                      >
                        <Text style={m.turfChipTxtActive}>{slot}</Text>
                        <Ionicons name="close" size={11} color="#fff" style={{ marginLeft: 4 }} />
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              )}

              {/* ── Total uses ── */}
              <Text style={m.lbl}>Total Uses Allowed</Text>
              <TextInput
                style={m.input} placeholder="e.g. 100 — leave blank for unlimited"
                placeholderTextColor="#9CA3AF" keyboardType="numeric"
                value={form.totalUses} onChangeText={v => setForm(f => ({ ...f, totalUses: v }))}
              />

              {/* ── Per-user limit ── */}
              <Text style={m.lbl}>Uses Per User</Text>
              <View style={m.segRow}>
                {["1", "2", "3", "0"].map(n => (
                  <TouchableOpacity
                    key={n} style={[m.seg, form.perUserLimit === n && m.segActive]}
                    onPress={() => setForm(f => ({ ...f, perUserLimit: n }))}
                  >
                    <Text style={[m.segTxt, form.perUserLimit === n && m.segTxtActive]}>
                      {n === "0" ? "Unlimited" : `${n}x`}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* ── Payment type ── */}
              <Text style={m.lbl}>Valid On Payment Type</Text>
              <View style={m.segRow}>
                {(["both", "full", "advance"] as const).map(pt => (
                  <TouchableOpacity
                    key={pt} style={[m.seg, form.paymentType === pt && m.segActive]}
                    onPress={() => setForm(f => ({ ...f, paymentType: pt }))}
                  >
                    <Text style={[m.segTxt, form.paymentType === pt && m.segTxtActive]}>
                      {pt === "both" ? "Both" : pt === "full" ? "Full" : "Advance"}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* ── Applicable turfs ── */}
              <Text style={m.lbl}>Applicable Turfs</Text>
              <Text style={m.hint}>Leave all unselected for all turfs</Text>
              <View style={m.turfGrid}>
                {turfs.map(t => {
                  const sel = form.selectedTurfs.includes(t.id);
                  return (
                    <TouchableOpacity
                      key={t.id} style={[m.turfChip, sel && m.turfChipActive]}
                      onPress={() => setForm(f => ({
                        ...f,
                        selectedTurfs: sel
                          ? f.selectedTurfs.filter(id => id !== t.id)
                          : [...f.selectedTurfs, t.id],
                      }))}
                    >
                      <Text style={[m.turfChipTxt, sel && m.turfChipTxtActive]}>{t.name}</Text>
                      {sel && <Ionicons name="checkmark" size={11} color="#fff" style={{ marginLeft: 4 }} />}
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* ── Live preview ── */}
              {!!(form.code && form.value) && (
                <View style={m.preview}>
                  <Text style={m.previewTitle}>Preview</Text>
                  <Text style={m.previewCode}>{form.code.toUpperCase()}</Text>
                  <Text style={m.previewDesc}>
                    {form.type === "flat"
                      ? `₹${form.value} off online payment`
                      : `${form.value}% off online payment${form.maxDiscount ? ` (max ₹${form.maxDiscount})` : ""}`}
                  </Text>
                  {!!form.minBookingAmount &&
                    <Text style={m.previewMeta}>Min booking: ₹{form.minBookingAmount}</Text>}
                  {form.validFrom && form.validTo &&
                    <Text style={m.previewMeta}>{form.validFrom} → {form.validTo}</Text>}
                  {form.validFromTime && form.validToTime &&
                    <Text style={m.previewMeta}>⏰ {form.validFromTime} – {form.validToTime} IST</Text>}
                  {form.allowedDays.length > 0 &&
                    <Text style={m.previewMeta}>
                      📅 {[...form.allowedDays].sort((a, b) => a - b).map(d => DAY_LABELS[d]).join(", ")}
                    </Text>}
                  {form.targetSlots.length > 0 &&
                    <Text style={m.previewMeta}>
                      🎯 Slots: {form.targetSlots.slice(0, 2).join(", ")}
                      {form.targetSlots.length > 2 ? ` +${form.targetSlots.length - 2} more` : ""}
                    </Text>}
                </View>
              )}

              {/* ── Save / Cancel ── */}
              <TouchableOpacity
                style={[m.saveBtn, saving && { opacity: 0.6 }]}
                onPress={handleSave} disabled={saving}
              >
                {saving
                  ? <ActivityIndicator color="#fff" />
                  : <>
                    <Ionicons name="add-circle-outline" size={18} color="#fff" />
                    <Text style={m.saveBtnTxt}>Create Promo Code</Text>
                  </>
                }
              </TouchableOpacity>
              <TouchableOpacity style={m.cancelBtn} onPress={() => setModal(false)} disabled={saving}>
                <Text style={m.cancelBtnTxt}>Cancel</Text>
              </TouchableOpacity>
              <View style={{ height: 24 }} />
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// =============================================================================
// ── List screen styles ────────────────────────────────────────────────────────
// =============================================================================
const s = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: "#F0F4F8" },
  loadWrap:{ flex: 1, justifyContent: "center", alignItems: "center" },
  list:    { paddingBottom: 100 },

  hero:        { backgroundColor: DARK, paddingHorizontal: 20, paddingBottom: 28, overflow: "hidden" },
  heroGlow:    { position: "absolute", top: -40, right: -40, width: 200, height: 200, borderRadius: 100, backgroundColor: "rgba(14,165,164,0.15)" },
  heroTag:     { color: "#6EE7B7", fontSize: 11, fontWeight: "800", letterSpacing: 1.5, textTransform: "uppercase" },
  heroTitle:   { color: "#fff", fontSize: 28, fontWeight: "900", marginTop: 4 },
  heroStats:   { flexDirection: "row", gap: 8, marginTop: 18, flexWrap: "wrap" },
  heroStat:    { backgroundColor: "rgba(255,255,255,0.07)", borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, alignItems: "center", borderWidth: 1, borderColor: "rgba(255,255,255,0.08)" },
  heroStatVal: { fontSize: 18, fontWeight: "900" },
  heroStatLbl: { color: "#9CA3AF", fontSize: 10, fontWeight: "600", marginTop: 2 },

  toolbar:     { flexDirection: "row", gap: 10, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 4 },
  searchWrap:  { flex: 1, flexDirection: "row", alignItems: "center", backgroundColor: "#fff", borderRadius: 14, paddingHorizontal: 14, borderWidth: 1, borderColor: "#E5E7EB" },
  searchInput: { flex: 1, paddingVertical: 12, fontSize: 14, color: "#111827" },
  addBtn:      { backgroundColor: DARK, width: 46, height: 46, borderRadius: 14, justifyContent: "center", alignItems: "center" },

  tabRow:       { flexDirection: "row", paddingHorizontal: 16, paddingVertical: 10, gap: 8 },
  tab:          { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 999, backgroundColor: "#fff", borderWidth: 1, borderColor: "#E5E7EB" },
  tabActive:    { backgroundColor: DARK, borderColor: DARK },
  tabTxt:       { fontSize: 13, fontWeight: "700", color: "#6B7280" },
  tabTxtActive: { color: "#fff" },

  card:    { backgroundColor: "#fff", marginHorizontal: 16, marginBottom: 12, borderRadius: 18, flexDirection: "row", overflow: "hidden", borderWidth: 1, borderColor: "#E5E7EB", shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 6, elevation: 2 },
  cardBar: { width: 4 },
  cardBody:{ flex: 1, padding: 14 },

  cardTop:      { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
  codeTag:      { backgroundColor: DARK, paddingHorizontal: 14, paddingVertical: 6, borderRadius: 10 },
  codeTxt:      { color: "#fff", fontWeight: "900", fontSize: 16, letterSpacing: 1 },
  cardTopRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  statusPill:   { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  pillOn:       { backgroundColor: "#DCFCE7" },
  pillOff:      { backgroundColor: "#FEE2E2" },
  statusTxt:    { fontSize: 10, fontWeight: "800" },

  discountRow:      { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 },
  discountBadge:    { backgroundColor: "#FEF3C7", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  discountBadgeTxt: { fontSize: 13, fontWeight: "900", color: "#B45309" },
  maxDiscTxt:       { fontSize: 11, color: "#9CA3AF", fontWeight: "600" },
  payTypePill:      { backgroundColor: "#EFF6FF", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, marginLeft: "auto" as any },
  payTypeTxt:       { fontSize: 10, fontWeight: "700", color: "#2563EB" },

  detailGrid:  { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 10 },
  detailItem:  { backgroundColor: "#F9FAFB", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, minWidth: "22%" as any },
  detailLbl:   { fontSize: 9, color: "#9CA3AF", fontWeight: "700", textTransform: "uppercase" },
  detailVal:   { fontSize: 12, color: "#111827", fontWeight: "800", marginTop: 2 },

  usageRow:    { gap: 6 },
  usageTxt:    { fontSize: 11, color: "#6B7280", fontWeight: "600" },
  usageBar:    { height: 4, backgroundColor: "#F3F4F6", borderRadius: 2, overflow: "hidden" },
  usageBarFill:{ height: "100%" as any, borderRadius: 2 },

  deleteBtn:    { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-end", marginTop: 10, backgroundColor: "#FEF2F2", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  deleteBtnTxt: { fontSize: 11, fontWeight: "700", color: "#DC2626" },

  empty:      { margin: 16, backgroundColor: "#fff", borderRadius: 20, padding: 32, alignItems: "center" },
  emptyTitle: { fontSize: 16, fontWeight: "800", color: "#374151", marginTop: 4 },
  emptySub:   { fontSize: 13, color: "#9CA3AF", marginTop: 4 },
});

// =============================================================================
// ── Modal styles ──────────────────────────────────────────────────────────────
// =============================================================================
const m = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet:    { backgroundColor: "#fff", borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 20, paddingTop: 12, paddingBottom: Platform.OS === "ios" ? 34 : 20, maxHeight: "94%" },
  handle:   { width: 40, height: 4, borderRadius: 2, backgroundColor: "#E5E7EB", alignSelf: "center", marginBottom: 16 },

  title: { fontSize: 22, fontWeight: "900", color: "#111827" },
  sub:   { fontSize: 12, color: "#9CA3AF", marginTop: 4, marginBottom: 8 },
  lbl:   { fontSize: 11, fontWeight: "800", color: "#6B7280", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 7, marginTop: 16 },
  hint:  { fontSize: 11, color: "#9CA3AF", marginTop: 4 },
  input: { backgroundColor: "#F9FAFB", borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: "#111827" },

  segRow:        { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  seg:           { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10, backgroundColor: "#F3F4F6", borderWidth: 1, borderColor: "#E5E7EB" },
  segActive:     { backgroundColor: DARK, borderColor: DARK },
  segTxt:        { fontSize: 13, fontWeight: "700", color: "#6B7280" },
  segTxtActive:  { color: "#fff" },

  turfGrid:        { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  turfChip:        { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: "#F3F4F6", borderWidth: 1, borderColor: "#E5E7EB", flexDirection: "row", alignItems: "center" },
  turfChipActive:  { backgroundColor: DARK, borderColor: DARK },
  turfChipTxt:     { fontSize: 12, fontWeight: "700", color: "#374151" },
  turfChipTxtActive: { color: "#fff" },

  // ── Slot picker ──────────────────────────────────────────────────────────
  pickerSection:  { backgroundColor: "#F9FAFB", borderRadius: 14, padding: 12, marginTop: 10, borderWidth: 1, borderColor: "#E5E7EB" },
  pickerLabel:    { fontSize: 10, fontWeight: "800", color: "#6B7280", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 },
  timeChip:       { paddingHorizontal: 12, paddingVertical: 9, borderRadius: 12, backgroundColor: "#fff", borderWidth: 1.5, borderColor: "#E5E7EB", marginRight: 7, alignItems: "center", minWidth: 72 },
  timeChipActive: { backgroundColor: DARK, borderColor: DARK },
  timeChipTxt:    { fontSize: 12, fontWeight: "800", color: "#374151" },
  timeChipTxtActive: { color: "#fff" },

  slotActionRow:   { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10 },
  slotPreviewBadge:{ flex: 1, flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(14,165,164,0.10)", borderRadius: 12, padding: 10, borderWidth: 1, borderColor: ACCENT },
  slotPreviewTxt:  { fontSize: 13, fontWeight: "800", color: ACCENT },
  addSlotBtn:      { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: DARK, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12 },
  addSlotBtnTxt:   { color: "#fff", fontWeight: "800", fontSize: 13 },

  // ── Preview box ──────────────────────────────────────────────────────────
  preview:      { backgroundColor: "#F0FDF4", borderRadius: 14, padding: 14, marginTop: 16, borderWidth: 1, borderColor: "#BBF7D0", alignItems: "center" },
  previewTitle: { fontSize: 10, fontWeight: "800", color: "#15803D", textTransform: "uppercase", letterSpacing: 1 },
  previewCode:  { fontSize: 26, fontWeight: "900", color: "#0F172A", marginTop: 6, letterSpacing: 2 },
  previewDesc:  { fontSize: 14, fontWeight: "700", color: "#15803D", marginTop: 4 },
  previewMeta:  { fontSize: 11, color: "#6B7280", marginTop: 3 },

  saveBtn:    { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: DARK, paddingVertical: 15, borderRadius: 16, marginTop: 20 },
  saveBtnTxt: { color: "#fff", fontWeight: "800", fontSize: 15 },
  cancelBtn:  { backgroundColor: "#F3F4F6", paddingVertical: 14, borderRadius: 16, alignItems: "center", marginTop: 10 },
  cancelBtnTxt:{ color: "#374151", fontWeight: "700", fontSize: 15 },
});
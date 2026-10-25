import {
  View, Text, StyleSheet, StatusBar, ScrollView,
  TouchableOpacity, TextInput, Alert, ActivityIndicator,
  Switch, Modal, FlatList, Platform, RefreshControl,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useEffect, useState } from "react";
import { db } from "../../firebaseConfig";
import {
  collection, getDocs, addDoc, updateDoc, deleteDoc,
  doc, orderBy, query, serverTimestamp, writeBatch,
} from "firebase/firestore";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { City, fetchCities } from "../../utils/cities";
import DraggableFlatList, {
  RenderItemParams,
  ScaleDecorator,
} from "react-native-draggable-flatlist";

const DARK  = "#0A0F1E";
const ACCENT = "#0EA5A4";

// ── Types ──────────────────────────────────────────────────────────────────────
type SectionType = "manual" | "sport" | "location" | "nearby" | "all" | "highlights" | "offers";

type FeaturedSection = {
  id: string;
  title: string;
  subtitle?: string;
  icon: string;
  venueType: "turf" | "gym";        // ✅ NEW — which venue type this section shows
  type: SectionType;
  turfIds: string[];                  // for turfs (when venueType === "turf")
  gymIds?: string[];                  // ✅ NEW — for gyms (when venueType === "gym")
  filter?: { sport?: string; location?: string };
  maxItems?: number;
  highlightIds?: string[];
  active: boolean;
  order: number;
  style: "horizontal" | "grid";
  cityIds?: string[];                 // 🏙️ ["all"] | city ids | "coming_soon" (missing = All India)
};

type HighlightCard = {
  id: string;
  title: string;
  sub: string;
  icon: string;
  color: string;
  iconBg: string;
  action: "explore" | "sport" | "turf" | "link" | "profile" | "toss"; 
  actionValue: string;
  active: boolean;
  order: number;
  cityIds?: string[];                 // 🏙️ same as sections
};

type Turf = { id: string; name?: string; sport?: string; location?: string; rating?: number | string; cityId?: string; cityName?: string };

// ── 🏙️ "Show in" chips — All India / cities / coming-soon places ─────────────
const isAllIndia = (ids?: string[]) => !ids || ids.length === 0 || ids.includes("all");

function CityChips({ value, cities, onChange }: { value?: string[]; cities: City[]; onChange: (ids: string[]) => void }) {
  const all = isAllIndia(value);
  const ids = all ? [] : (value || []);
  const toggle = (id: string) => {
    const next = ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id];
    onChange(next.length ? next : ["all"]);
  };
  const chip = (key: string, label: string, on: boolean, onPress: () => void) => (
    <TouchableOpacity key={key} style={[s.typeBtn, on && s.typeBtnActive]} onPress={onPress}>
      <Text style={[s.typeTxt, on && s.typeTxtActive]}>{label}</Text>
    </TouchableOpacity>
  );
  return (
    <View>
      <Text style={s.fieldLabel}>Show in</Text>
      <View style={s.typeRow}>
        {chip("all", "All India", all, () => onChange(["all"]))}
        {cities.filter(c => c.status !== "hidden").map(c =>
          chip(c.id, c.name + (c.status !== "live" ? " · soon" : ""), !all && ids.includes(c.id), () => toggle(c.id)))}
        {chip("coming_soon", "Coming soon cities", !all && ids.includes("coming_soon"), () => toggle("coming_soon"))}
      </View>
      <Text style={s.hint}>
        Turfs inside a section always follow the player's city automatically. Use this only for a section meant for some cities.
      </Text>
    </View>
  );
}

const ICON_OPTS = [ "","🏏","⚽","🏓","🏸","🏀","🎾","🏐","🤼","🏑","🔥","⭐","🎁","🛡️","📅","🏆","🆕","💡","📍","🎯","📢","📞","🏊","✅", "☀️","🌙","🌧️","⛅","🔔","⚡","🔒","🔓","👀",];
const COLOR_OPTS = ["#FFF7ED","#F0FDF4","#EFF6FF","#F5F3FF","#FEF9C3","#FFF1F2","#F0FDFA","#FAFAFA"];
const ICON_BG_OPTS = ["#FB923C","#22C55E","#3B82F6","#8B5CF6","#EAB308","#EC4899","#0EA5A4","#374151"];
const SPORT_OPTS = ["Football","Cricket","Badminton","Basketball","Tennis","Volleyball","Kabaddi","Hockey"];

// ── SECTION EMPTY FORM ─────────────────────────────────────────────────────────
const EMPTY_SECTION = (): Omit<FeaturedSection,"id"> => ({
  title: "", subtitle: "", icon: "🔥",
  venueType: "turf",              // ✅ NEW — default to turf
  type: "manual",
  turfIds: [],
  gymIds: [],                     // ✅ NEW
  filter: {}, 
  maxItems: 6,
  highlightIds: [],
  active: true, order: 0, style: "horizontal",
  cityIds: ["all"],
});

const EMPTY_CARD = (): Omit<HighlightCard,"id"> => ({
  title: "", sub: "", icon: "📅",
  color: "#FFF7ED", iconBg: "#FB923C",
  action: "explore", actionValue: "",
  active: true, order: 0,
  cityIds: ["all"],
});

// ─────────────────────────────────────────────────────────────────────────────
export default function AdminHomeControl() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [tab, setTab] = useState<"sections"|"highlights">("sections");

const [sections,   setSections]   = useState<FeaturedSection[]>([]);
const [highlights, setHighlights] = useState<HighlightCard[]>([]);
const [turfs,      setTurfs]      = useState<Turf[]>([]);
const [gyms,       setGyms]       = useState<Turf[]>([]);  // ✅ NEW
const [cities,     setCities]     = useState<City[]>([]);  // 🏙️
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving,     setSaving]     = useState(false);

  // Modals
  const [sectionModal,   setSectionModal]   = useState(false);
  const [highlightModal, setHighlightModal] = useState(false);
  const [turfPickModal,  setTurfPickModal]  = useState(false);
  const [editingSection, setEditingSection] = useState<FeaturedSection | null>(null);
  const [editingCard,    setEditingCard]    = useState<HighlightCard | null>(null);
  const [sectionForm,    setSectionForm]    = useState(EMPTY_SECTION());
  const [cardForm,       setCardForm]       = useState(EMPTY_CARD());
  const [turfSearch,     setTurfSearch]     = useState("");

  useEffect(() => { fetchAll(); }, []);
  useEffect(() => { fetchCities(true).then(setCities).catch(() => {}); }, []);
  const cityLabel = (ids?: string[]) => isAllIndia(ids)
    ? "All India"
    : (ids || []).map(id => id === "coming_soon" ? "Coming soon" : cities.find(c => c.id === id)?.name || id).join(", ");

const fetchAll = async (isRefresh = false) => {
  isRefresh ? setRefreshing(true) : setLoading(true);
  try {
    const [secSnap, hlSnap, venueSnap] = await Promise.all([
      getDocs(query(collection(db, "featuredSections"), orderBy("order"))),
      getDocs(query(collection(db, "featuredHighlights"), orderBy("order"))),
      getDocs(collection(db, "turfs")),  // ✅ all venues live here now
    ]);
    setSections(secSnap.docs.map(d => ({ id: d.id, ...d.data() } as FeaturedSection)));
    setHighlights(hlSnap.docs.map(d => ({ id: d.id, ...d.data() } as HighlightCard)));

    // ✅ Split venues by venueType
    const allVenues = venueSnap.docs.map(d => ({ id: d.id, ...d.data() } as Turf & { venueType?: string }));
    setTurfs(allVenues.filter(v => v.venueType !== "gym"));
    setGyms(allVenues.filter(v => v.venueType === "gym"));
  } catch { Alert.alert("Error", "Could not load data."); }
  finally { setLoading(false); setRefreshing(false); }
};

  // ── SECTIONS ─────────────────────────────────────────────────────────────────
  const openCreateSection = () => {
    setEditingSection(null);
    setSectionForm(EMPTY_SECTION());
    setSectionModal(true);
  };

 const openEditSection = (s: FeaturedSection) => {
  setEditingSection(s);
  setSectionForm({
    title:    s.title,
    subtitle: s.subtitle || "",
    icon:     s.icon,
    venueType: s.venueType || "turf",       // ✅ NEW — default to turf for old sections
    type:     s.type,
    turfIds:  [...(s.turfIds || [])],
    gymIds:   [...(s.gymIds || [])],         // ✅ NEW
    filter:   { ...s.filter },
    maxItems:     s.maxItems ?? 6,
    highlightIds: s.highlightIds ? [...s.highlightIds] : [],
    active:       s.active,
    order:    s.order,
    style:    s.style,
    cityIds:  isAllIndia(s.cityIds) ? ["all"] : [...(s.cityIds || [])],
  });
  setSectionModal(true);
};

 const saveSection = async () => {
  if (!sectionForm.title.trim()) return Alert.alert("Required", "Title is required.");
  if (sectionForm.type === "manual" && getVenueIds().length === 0) {
    return Alert.alert(
      "Required", 
      `Add at least one ${sectionForm.venueType === "gym" ? "gym" : "turf"} for manual sections.`
    );
  }
  
    setSaving(true);
    try {
      if (editingSection) {
        await updateDoc(doc(db, "featuredSections", editingSection.id), { ...sectionForm, updatedAt: serverTimestamp() });
        setSections(prev => prev.map(s => s.id === editingSection.id ? { ...s, ...sectionForm } : s));
      } else {
        const order = sections.length;
        const ref = await addDoc(collection(db, "featuredSections"), { ...sectionForm, order, createdAt: serverTimestamp() });
        setSections(prev => [...prev, { id: ref.id, ...sectionForm, order }]);
      }
      setSectionModal(false);
    } catch (e: any) { Alert.alert("Error", e.message); }
    finally { setSaving(false); }
  };

  const deleteSection = (s: FeaturedSection) => {
    Alert.alert("Delete Section", `Delete "${s.title}"?`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: async () => {
        await deleteDoc(doc(db, "featuredSections", s.id));
        setSections(prev => prev.filter(x => x.id !== s.id));
      }},
    ]);
  };

  const toggleSection = async (s: FeaturedSection) => {
    const next = !s.active;
    await updateDoc(doc(db, "featuredSections", s.id), { active: next });
    setSections(prev => prev.map(x => x.id === s.id ? { ...x, active: next } : x));
  };

  // ── 🔥 Offers Today row — one tap to add it ───────────────────────────────
  const hasOffersRow = sections.some(x => x.type === "offers");
  const addOffersRow = async () => {
    setSaving(true);
    try {
      const data: Omit<FeaturedSection, "id"> = {
        ...EMPTY_SECTION(),
        title: "Offers today",
        subtitle: "Discount applied automatically when you book",
        icon: "🔥",
        type: "offers",
        maxItems: 10,
        order: 0,
      };
      // put it at the top, push the others down by one
      const batch = writeBatch(db);
      sections.forEach((x, i) => batch.update(doc(db, "featuredSections", x.id), { order: i + 1 }));
      await batch.commit();
      const ref = await addDoc(collection(db, "featuredSections"), { ...data, createdAt: serverTimestamp() });
      setSections(prev => [{ id: ref.id, ...data }, ...prev.map((x, i) => ({ ...x, order: i + 1 }))]);
    } catch (e: any) { Alert.alert("Error", e.message); }
    finally { setSaving(false); }
  };

  // ── Reorder sections via drag ─────────────────────────────────────────────
  const onSectionReorder = async (data: FeaturedSection[]) => {
    setSections(data);
    const batch = writeBatch(db);
    data.forEach((s, i) => batch.update(doc(db, "featuredSections", s.id), { order: i }));
    await batch.commit();
  };

  // ── Turf order within a section ───────────────────────────────────────────
 // ✅ Use the right ID array based on venueType
const getVenueIds = () => sectionForm.venueType === "gym" 
  ? (sectionForm.gymIds || []) 
  : sectionForm.turfIds;

const setVenueIds = (ids: string[]) => {
  setSectionForm(f => sectionForm.venueType === "gym"
    ? { ...f, gymIds: ids }
    : { ...f, turfIds: ids }
  );
};

const moveTurf = (index: number, dir: "up" | "down") => {
  const ids = [...getVenueIds()];
  const swap = dir === "up" ? index - 1 : index + 1;
  if (swap < 0 || swap >= ids.length) return;
  [ids[index], ids[swap]] = [ids[swap], ids[index]];
  setVenueIds(ids);
};

const removeTurfFromSection = (id: string) =>
  setVenueIds(getVenueIds().filter(x => x !== id));

const addTurfToSection = (id: string) => {
  if (getVenueIds().includes(id)) return;
  setVenueIds([...getVenueIds(), id]);
};

  // ── HIGHLIGHTS ────────────────────────────────────────────────────────────
  const openCreateCard = () => {
    setEditingCard(null);
    setCardForm(EMPTY_CARD());
    setHighlightModal(true);
  };

  const openEditCard = (c: HighlightCard) => {
    setEditingCard(c);
    setCardForm({ title: c.title, sub: c.sub, icon: c.icon, color: c.color, iconBg: c.iconBg, action: c.action, actionValue: c.actionValue, active: c.active, order: c.order, cityIds: isAllIndia(c.cityIds) ? ["all"] : [...(c.cityIds || [])] });
    setHighlightModal(true);
  };

  const saveCard = async () => {
    if (!cardForm.title.trim()) return Alert.alert("Required", "Title is required.");
    setSaving(true);
    try {
      if (editingCard) {
        await updateDoc(doc(db, "featuredHighlights", editingCard.id), { ...cardForm, updatedAt: serverTimestamp() });
        setHighlights(prev => prev.map(c => c.id === editingCard.id ? { ...c, ...cardForm } : c));
      } else {
        const order = highlights.length;
        const ref = await addDoc(collection(db, "featuredHighlights"), { ...cardForm, order, createdAt: serverTimestamp() });
        setHighlights(prev => [...prev, { id: ref.id, ...cardForm, order }]);
      }
      setHighlightModal(false);
    } catch (e: any) { Alert.alert("Error", e.message); }
    finally { setSaving(false); }
  };

  const deleteCard = (c: HighlightCard) => {
    Alert.alert("Delete Card", `Delete "${c.title}"?`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: async () => {
        await deleteDoc(doc(db, "featuredHighlights", c.id));
        setHighlights(prev => prev.filter(x => x.id !== c.id));
      }},
    ]);
  };

  const toggleCard = async (c: HighlightCard) => {
    const next = !c.active;
    await updateDoc(doc(db, "featuredHighlights", c.id), { active: next });
    setHighlights(prev => prev.map(x => x.id === c.id ? { ...x, active: next } : x));
  };

  const onCardReorder = async (data: HighlightCard[]) => {
    setHighlights(data);
    const batch = writeBatch(db);
    data.forEach((c, i) => batch.update(doc(db, "featuredHighlights", c.id), { order: i }));
    await batch.commit();
  };

  // ── Turf name lookup ───────────────────────────────────────────────────────
  const turfName = (id: string) => turfs.find(t => t.id === id)?.name || id.slice(0, 8) + "…";
  const filteredTurfs = turfs.filter(t =>
    !turfSearch.trim() ||
    (t.name || "").toLowerCase().includes(turfSearch.toLowerCase()) ||
    (t.sport || "").toLowerCase().includes(turfSearch.toLowerCase()) ||
    (t.location || "").toLowerCase().includes(turfSearch.toLowerCase())
  );

  if (loading) return (
    <SafeAreaView style={s.loadWrap}>
      <ActivityIndicator size="large" color={ACCENT} />
      <Text style={s.loadText}>Loading...</Text>
    </SafeAreaView>
  );

  // ── Shared header rendered above either list ─────────────────────────────
  const ListHeader = (
    <View>
      {/* ── Hero ── */}
<View style={[s.hero, { paddingTop: insets.top + 14 }]}>
        <TouchableOpacity style={s.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={20} color="#fff" />
        </TouchableOpacity>
        <Text style={s.heroTag}>Home Screen Control</Text>
        <Text style={s.heroTitle}>Featured Sections</Text>
        <Text style={s.heroSub}>Control what users see on the home screen. Long-press a card to drag & reorder.</Text>
      </View>
      <View style={s.tabRow}>
        {(["sections","highlights"] as const).map(t => (
          <TouchableOpacity key={t} style={[s.tabBtn, tab === t && s.tabBtnActive]} onPress={() => setTab(t)}>
            <Text style={[s.tabTxt, tab === t && s.tabTxtActive]}>
              {t === "sections" ? `📋 Sections (${sections.length})` : `🎁 Highlight Cards (${highlights.length})`}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      {tab === "sections" && !hasOffersRow && (
        <View style={s.offerRowBox}>
          <Text style={{ fontSize: 24 }}>🔥</Text>
          <View style={{ flex: 1 }}>
            <Text style={s.offerRowTitle}>"Offers today" row is OFF</Text>
            <Text style={s.offerRowSub}>Players won't see the row of turfs giving a discount today. Add it to show it on the home screen.</Text>
          </View>
          <TouchableOpacity style={[s.offerRowBtn, saving && { opacity: 0.6 }]} onPress={addOffersRow} disabled={saving}>
            <Text style={s.offerRowBtnTxt}>Add</Text>
          </TouchableOpacity>
        </View>
      )}
      <View style={[s.listHeader, { paddingHorizontal: 16, paddingTop: 16 }]}>
        <Text style={s.listHeaderTxt}>
          {tab === "sections" ? "Long-press to drag & reorder" : "Long-press to drag & reorder"}
        </Text>
        <TouchableOpacity style={s.addBtn} onPress={tab === "sections" ? openCreateSection : openCreateCard}>
          <Ionicons name="add" size={18} color="#fff" />
          <Text style={s.addBtnTxt}>{tab === "sections" ? "Add Section" : "Add Card"}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <View style={s.safe}>
      <StatusBar barStyle="light-content" backgroundColor={DARK} />

        {tab === "sections" ? (
          // ✅ DraggableFlatList IS the scroll root — no outer ScrollView
          sections.length === 0 ? (
            <View style={{ flex: 1 }}>
              {ListHeader}
              <View style={s.empty}>
                <Text style={s.emptyIcon}>📋</Text>
                <Text style={s.emptyTitle}>No sections yet</Text>
                <Text style={s.emptySub}>Create your first featured section to control what users see on the home screen.</Text>
              </View>
            </View>
          ) : (
            <DraggableFlatList
              data={sections}
              keyExtractor={item => item.id}
              onDragEnd={({ data }) => onSectionReorder(data)}
              contentContainerStyle={{ paddingBottom: 120 }}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => fetchAll(true)} tintColor={ACCENT} />}
              ListHeaderComponent={ListHeader}
                renderItem={({ item, drag, isActive }: RenderItemParams<FeaturedSection>) => (
                  <ScaleDecorator>
                    <View style={[s.sectionCard, { marginHorizontal: 16 }, isActive && { opacity: 0.8, shadowOpacity: 0.2 }]}>
                      <TouchableOpacity onLongPress={drag} style={s.dragHandle} activeOpacity={0.6}>
                        <Ionicons name="reorder-three-outline" size={22} color="#9CA3AF" />
                      </TouchableOpacity>

                      <View style={{ flex: 1 }}>
                        <View style={s.sectionCardTop}>
                          <Text style={s.sectionIcon}>{item.icon}</Text>
                          <View style={{ flex: 1 }}>
                            <Text style={s.sectionTitle}>{item.title}</Text>
                            {item.subtitle ? <Text style={s.sectionSub}>{item.subtitle}</Text> : null}
                          </View>
                          <Switch
                            value={item.active}
                            onValueChange={() => toggleSection(item)}
                            trackColor={{ false: "#E5E7EB", true: ACCENT }}
                            thumbColor="#fff"
                            style={{ transform: [{ scaleX: 0.8 }, { scaleY: 0.8 }] }}
                          />
                        </View>

                        <View style={s.sectionMeta}>
  {/* ✅ NEW: Venue type badge */}
  <View style={[
    s.metaChip,
    (item.venueType || "turf") === "gym" ? { backgroundColor: "#FAE8FF" } : { backgroundColor: "#DBEAFE" }
  ]}>
    <Text style={[
      s.metaChipTxt,
      { color: (item.venueType || "turf") === "gym" ? "#86198F" : "#0369A1" }
    ]}>
      {(item.venueType || "turf") === "gym" ? "🏋️ Gym" : "🏏 Turf"}
    </Text>
  </View>

  {/* Existing type chip below — keep as is */}
  <View style={[s.metaChip,
    

                        
                      
                            item.type === "offers" ? { backgroundColor: "#FFEDD5" } :
                            item.type === "nearby" ? s.metaNearby :
                            item.type === "all"    ? s.metaAll    : {}
                          ]}>
                            <Text style={[s.metaChipTxt,
                              item.type === "offers" ? { color: "#C2410C" } :
                              item.type === "nearby" ? { color: "#0369A1" } :
                              item.type === "all"    ? { color: "#7C3AED" } : {}
                            ]}>
                              {item.type === "offers"   ? "🔥 Offers Today" :
                               item.type === "nearby"   ? "📍 Near You" :
                               item.type === "all"      ? "🏟 All Venues" :
                               item.type === "manual"   ? "✋ Manual" :
                               item.type === "sport"    ? "⚽ By Sport" :
                               item.type === "highlights" ? "🎁 Top Picks" :
                               "📌 By Location"}
                            </Text>
                          </View>
                          <View style={s.metaChip}>
                            <Text style={s.metaChipTxt}>{item.style === "horizontal" ? "↔ Scroll" : "⊞ Grid"}</Text>
                          </View>
                          <View style={[s.metaChip, { backgroundColor: "#EFF6FF" }]}>
                            <Text style={[s.metaChipTxt, { color: "#1D4ED8" }]}>🏙️ {cityLabel(item.cityIds)}</Text>
                          </View>
                          {item.type === "manual" && (
                            <View style={s.metaChip}>
                              <Text style={s.metaChipTxt}>{item.turfIds.length} turfs</Text>
                            </View>
                          )}
                          {(item.type === "nearby" || item.type === "all" || item.type === "offers") && (
                            <View style={s.metaChip}>
                              <Text style={s.metaChipTxt}>Max {item.maxItems ?? 6}</Text>
                            </View>
                          )}
                          {item.filter?.sport && (
                            <View style={s.metaChip}>
                              <Text style={s.metaChipTxt}>⚽ {item.filter.sport}</Text>
                            </View>
                          )}
                          {item.filter?.location && (
                            <View style={s.metaChip}>
                              <Text style={s.metaChipTxt}>📌 {item.filter.location}</Text>
                            </View>
                          )}
                          <View style={[s.metaChip, item.active ? s.metaActive : s.metaInactive]}>
                            <Text style={[s.metaChipTxt, { color: item.active ? "#15803D" : "#9CA3AF" }]}>
                              {item.active ? "Live" : "Hidden"}
                            </Text>
                          </View>
                        </View>

                        {/* Turf order preview for manual sections */}
                        {item.type === "manual" && item.turfIds.length > 0 && (
                          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }}>
                            <View style={{ flexDirection: "row", gap: 6 }}>
                              {item.turfIds.slice(0, 5).map((id, i) => {
                                const t = turfs.find(x => x.id === id);
                                return (
                                  <View key={id} style={s.turfOrderChip}>
                                    <Text style={s.turfOrderNum}>{i + 1}</Text>
                                    <Text style={s.turfOrderName} numberOfLines={1}>{turfName(id)}</Text>
                                    {t?.rating ? <Text style={s.turfOrderChipRating}>⭐{t.rating}</Text> : null}
                                  </View>
                                );
                              })}
                              {item.turfIds.length > 5 && (
                                <View style={s.turfOrderChip}>
                                  <Text style={s.turfOrderName}>+{item.turfIds.length - 5} more</Text>
                                </View>
                              )}
                            </View>
                          </ScrollView>
                        )}

                        {/* Preview for highlights */}
                        {item.type === "highlights" && (
                          <View style={s.systemSectionPreview}>
                            <Ionicons name="color-palette-outline" size={13} color="#6B7280" />
                            <Text style={s.systemSectionPreviewTxt}>
                              Shows the coloured Top Pick cards. Manage card content in the Highlights tab.
                            </Text>
                          </View>
                        )}

                        {/* Preview for offers row */}
                        {item.type === "offers" && (
                          <View style={s.systemSectionPreview}>
                            <Ionicons name="pricetag-outline" size={13} color="#6B7280" />
                            <Text style={s.systemSectionPreviewTxt}>
                              {item.active
                                ? `Shows up to ${item.maxItems ?? 10} turfs giving a discount today. Hides itself on days with no offers.`
                                : "Switched off — players don't see the Offers today row."}
                            </Text>
                          </View>
                        )}

                        {/* Preview for nearby/all */}
                        {(item.type === "nearby" || item.type === "all") && (
                          <View style={s.systemSectionPreview}>
                            <Ionicons
                              name={item.type === "nearby" ? "navigate-outline" : "grid-outline"}
                              size={13} color="#6B7280"
                            />
                            <Text style={s.systemSectionPreviewTxt}>
                              {item.type === "nearby"
                                ? `Shows ${item.maxItems ?? 6} nearest turfs based on user's GPS location`
                                : `Shows all ${item.maxItems ?? 6} turfs sorted by distance`}
                            </Text>
                          </View>
                        )}

                        <View style={s.cardActions}>
                          <TouchableOpacity style={s.actionBtn} onPress={() => openEditSection(item)}>
                            <Ionicons name="pencil-outline" size={13} color="#374151" />
                            <Text style={s.actionTxt}>Edit</Text>
                          </TouchableOpacity>
                          <TouchableOpacity style={[s.actionBtn, s.actionDelete]} onPress={() => deleteSection(item)}>
                            <Ionicons name="trash-outline" size={13} color="#DC2626" />
                            <Text style={[s.actionTxt, { color: "#DC2626" }]}>Delete</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    </View>
                  </ScaleDecorator>
                )}
              />
          )
        ) : (
          // ✅ Highlights tab — also DraggableFlatList as root
          highlights.length === 0 ? (
            <View style={{ flex: 1 }}>
              {ListHeader}
              <View style={s.empty}>
                <Text style={s.emptyIcon}>🎁</Text>
                <Text style={s.emptyTitle}>No highlight cards yet</Text>
                <Text style={s.emptySub}>Add cards to show in the "Top Picks" row on the home screen.</Text>
              </View>
            </View>
          ) : (
            <DraggableFlatList
              data={highlights}
              keyExtractor={item => item.id}
              onDragEnd={({ data }) => onCardReorder(data)}
              contentContainerStyle={{ paddingBottom: 120 }}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => fetchAll(true)} tintColor={ACCENT} />}
              ListHeaderComponent={ListHeader}
                renderItem={({ item, drag, isActive }: RenderItemParams<HighlightCard>) => (
                  <ScaleDecorator>
                    <View style={[s.cardCard, { backgroundColor: item.color, marginHorizontal: 16 }, isActive && { opacity: 0.8 }]}>
                      <TouchableOpacity onLongPress={drag} style={s.dragHandle} activeOpacity={0.6}>
                        <Ionicons name="reorder-three-outline" size={22} color="#9CA3AF" />
                      </TouchableOpacity>
                      <View style={{ flex: 1 }}>
                        <View style={s.sectionCardTop}>
                          <View style={[s.cardIconWrap, { backgroundColor: item.iconBg }]}>
                            <Text style={{ fontSize: 18 }}>{item.icon}</Text>
                          </View>
                          <View style={{ flex: 1, marginLeft: 10 }}>
                            <Text style={s.sectionTitle}>{item.title}</Text>
                            <Text style={s.sectionSub}>{item.sub}</Text>
                          </View>
                          <Switch
                            value={item.active}
                            onValueChange={() => toggleCard(item)}
                            trackColor={{ false: "#E5E7EB", true: ACCENT }}
                            thumbColor="#fff"
                            style={{ transform: [{ scaleX: 0.8 }, { scaleY: 0.8 }] }}
                          />
                        </View>
                        <View style={s.sectionMeta}>
                          <View style={s.metaChip}><Text style={s.metaChipTxt}>→ {item.action}{item.actionValue ? `: ${item.actionValue}` : ""}</Text></View>
                          <View style={[s.metaChip, { backgroundColor: "#EFF6FF" }]}><Text style={[s.metaChipTxt, { color: "#1D4ED8" }]}>🏙️ {cityLabel(item.cityIds)}</Text></View>
                          <View style={[s.metaChip, item.active ? s.metaActive : s.metaInactive]}>
                            <Text style={[s.metaChipTxt, { color: item.active ? "#15803D" : "#9CA3AF" }]}>{item.active ? "Live" : "Hidden"}</Text>
                          </View>
                        </View>
                        <View style={s.cardActions}>
                          <TouchableOpacity style={s.actionBtn} onPress={() => openEditCard(item)}>
                            <Ionicons name="pencil-outline" size={13} color="#374151" />
                            <Text style={s.actionTxt}>Edit</Text>
                          </TouchableOpacity>
                          <TouchableOpacity style={[s.actionBtn, s.actionDelete]} onPress={() => deleteCard(item)}>
                            <Ionicons name="trash-outline" size={13} color="#DC2626" />
                            <Text style={[s.actionTxt, { color: "#DC2626" }]}>Delete</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    </View>
                  </ScaleDecorator>
                )}
              />
          )
        )}

      {/* ── Section Edit Modal ─────────────────────────────────────────────── */}
      <Modal visible={sectionModal} animationType="slide" transparent>
        <View style={s.modalBackdrop}>
          <View style={s.modalSheet}>
            <View style={s.sheetHandle} />
            <ScrollView showsVerticalScrollIndicator={false}>
              <View style={s.modalHeader}>
                <Text style={s.modalTitle}>{editingSection ? "Edit Section" : "New Section"}</Text>
                <TouchableOpacity style={s.closeBtn} onPress={() => setSectionModal(false)}>
                  <Ionicons name="close" size={20} color="#374151" />
                </TouchableOpacity>
              </View>

              {/* ✅ NEW: Venue type picker — Turf vs Gym */}
<Text style={s.fieldLabel}>Venue Type</Text>
<View style={s.typeRow}>
  {([
    { key: "turf", label: "🏏 Turfs", desc: "Show turfs, courts, pools" },
    { key: "gym",  label: "🏋️ Gyms",  desc: "Show gym listings" },
  ] as const).map(({ key, label }) => (
    <TouchableOpacity
      key={key}
      style={[s.typeBtn, sectionForm.venueType === key && s.typeBtnActive]}
      onPress={() => setSectionForm(f => ({
        ...f,
        venueType: key,
        // Reset incompatible types when switching to gym (no "sport" filter for gyms)
        type: key === "gym" && f.type === "sport" ? "manual" : f.type,
      }))}
    >
      <Text style={[s.typeTxt, sectionForm.venueType === key && s.typeTxtActive]}>
        {label}
      </Text>
    </TouchableOpacity>
  ))}
</View>
<View style={s.typDescBox}>
  <Ionicons name="information-circle-outline" size={14} color={ACCENT} />
  <Text style={s.typeDescTxt}>
    {sectionForm.venueType === "gym"
      ? "This section will show gym listings only."
      : "This section will show turfs and courts (not gyms)."}
  </Text>
</View>

              {/* Title */}
              <Text style={s.fieldLabel}>Section Title *</Text>
              <TextInput style={s.input} placeholder="e.g. Cricket Turfs This Week" placeholderTextColor="#9CA3AF"
                value={sectionForm.title} onChangeText={v => setSectionForm(f => ({ ...f, title: v }))} />

              <Text style={s.fieldLabel}>Subtitle (optional)</Text>
              <TextInput style={s.input} placeholder="e.g. Best venues for cricket" placeholderTextColor="#9CA3AF"
                value={sectionForm.subtitle} onChangeText={v => setSectionForm(f => ({ ...f, subtitle: v }))} />

              {/* Icon picker */}
              <Text style={s.fieldLabel}>Section Icon</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }}>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  {ICON_OPTS.map(ic => (
                    <TouchableOpacity key={ic} style={[s.iconOpt, sectionForm.icon === ic && s.iconOptActive]}
                      onPress={() => setSectionForm(f => ({ ...f, icon: ic }))}>
                      <Text style={{ fontSize: 22 }}>{ic}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>

              {/* Type */}
              <Text style={s.fieldLabel}>Section Type</Text>
              <View style={s.typeRow}>
                {([
  { key: "nearby",   label: "📍 Near You",    desc: "GPS-sorted, nearest first" },
  { key: "all",      label: "🏟 All Venues",  desc: "Every venue, distance sorted" },
  { key: "manual",   label: "✋ Manual",      desc: "You pick & order venues" },
  { key: "sport",    label: "⚽ By Sport",    desc: "Auto-filter by sport" },
  { key: "location", label: "📌 By Location", desc: "Auto-filter by city" },
  { key: "highlights", label: "🎁 Top Picks", desc: "Show highlight cards" },
  { key: "offers",   label: "🔥 Offers Today", desc: "Turfs with a discount today" },
] as const)
  .filter(({ key }) => !(sectionForm.venueType === "gym" && (key === "sport" || key === "offers")))  // ✅ Hide sport for gyms
  .map(({ key, label, desc }) => (
  <TouchableOpacity
    key={key}
    
                    style={[s.typeBtn, sectionForm.type === key && s.typeBtnActive]}
                    onPress={() => setSectionForm(f => key === "offers"
                      ? { ...f, type: "offers", venueType: "turf", style: "horizontal",
                          title: f.title || "Offers today",
                          subtitle: f.subtitle || "Discount applied automatically when you book",
                          icon: f.icon || "🔥", maxItems: f.maxItems ?? 10 }
                      : { ...f, type: key as SectionType })}
                  >
                    <Text style={[s.typeTxt, sectionForm.type === key && s.typeTxtActive]}>{label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <View style={s.typDescBox}>
                <Ionicons name="information-circle-outline" size={14} color={ACCENT} />
                <Text style={s.typeDescTxt}>
                  {sectionForm.type === "nearby"
                    ? "Shows turfs sorted by GPS distance from the user. Nearest turf is always first. Respects the Max Items limit."
                    : sectionForm.type === "all"
                    ? "Shows every turf on the platform, sorted by distance. Great as a full browse section. Respects Max Items."
                    : sectionForm.type === "manual"
                    ? "You handpick exact turfs and control their position with ↑ ↓ arrows. Position 1 = shown first."
                    : sectionForm.type === "sport"
                    ? "Auto-shows all turfs matching the sport you pick below. Updates automatically when new turfs are added."
                    : sectionForm.type === "offers"
                    ? "Shows turfs that have a live offer today (e.g. 20% OFF). Fills itself automatically from owners' approved offers and hides itself on days with no offers. Turn it off to hide it completely."
                    : sectionForm.type === "highlights"
                    ? "Shows the Top Pick highlight cards — the colourful mini-cards users can tap to explore. Manage the cards in the Highlights tab."
                    : "Auto-shows turfs whose location text contains your keyword. e.g. 'Amravati' shows all Amravati turfs."}
                </Text>
              </View>

              {/* maxItems — only for nearby and all */}
              {(sectionForm.type === "nearby" || sectionForm.type === "all" || sectionForm.type === "offers") && (
                <View>
                  <Text style={s.fieldLabel}>Max Turfs to Show</Text>
                  <View style={s.typeRow}>
                    {[3, 4, 5, 6, 8, 10, 20, 50].map(n => (
                      <TouchableOpacity
                        key={n}
                        style={[s.typeBtn, (sectionForm.maxItems ?? 6) === n && s.typeBtnActive]}
                        onPress={() => setSectionForm(f => ({ ...f, maxItems: n }))}
                      >
                        <Text style={[s.typeTxt, (sectionForm.maxItems ?? 6) === n && s.typeTxtActive]}>{n}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <Text style={s.hint}>
                    {sectionForm.type === "offers"
                      ? `Show up to ${sectionForm.maxItems ?? 6} turfs with offers, nearest first.`
                      : sectionForm.type === "nearby"
                      ? `Show the ${sectionForm.maxItems ?? 6} closest turfs to the user.`
                      : `Show ${sectionForm.maxItems ?? 6} turfs from the full list.`}
                  </Text>
                </View>
              )}

              {/* Style */}
              {sectionForm.type !== "offers" && (<>
              <Text style={s.fieldLabel}>Display Style</Text>
              <View style={s.typeRow}>
                {(["horizontal","grid"] as const).map(t => (
                  <TouchableOpacity key={t} style={[s.typeBtn, sectionForm.style === t && s.typeBtnActive]}
                    onPress={() => setSectionForm(f => ({ ...f, style: t }))}>
                    <Text style={[s.typeTxt, sectionForm.style === t && s.typeTxtActive]}>
                      {t === "horizontal" ? "↔ Horizontal scroll" : "⊞ Grid"}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              </>)}

              {/* Manual turf picker — only for manual */}
              {sectionForm.type === "manual" && (
  <View>
    <View style={s.turfPickHeader}>
      <Text style={s.fieldLabel}>
        {sectionForm.venueType === "gym" ? "Gyms" : "Turfs"} in this section ({getVenueIds().length})
      </Text>
      <TouchableOpacity style={s.pickMoreBtn} onPress={() => setTurfPickModal(true)}>
        <Ionicons name="add-circle-outline" size={16} color={ACCENT} />
        <Text style={s.pickMoreTxt}>Add {sectionForm.venueType === "gym" ? "Gym" : "Turf"}</Text>
      </TouchableOpacity>
    </View>
    <Text style={s.hint}>Use ↑ ↓ arrows to set the order users see them.</Text>

    {getVenueIds().length === 0 ? (
      <TouchableOpacity style={s.emptyTurfPick} onPress={() => setTurfPickModal(true)}>
        <Ionicons name="add-circle-outline" size={24} color={ACCENT} />
        <Text style={s.emptyTurfPickTxt}>
          Tap to pick {sectionForm.venueType === "gym" ? "gyms" : "turfs"}
        </Text>
      </TouchableOpacity>
    ) : (
      getVenueIds().map((id, i) => {
        // ✅ Look up from gyms or turfs based on venueType
        const venueObj = sectionForm.venueType === "gym"
          ? gyms.find(g => g.id === id)
          : turfs.find(t => t.id === id);
        const rating = venueObj?.rating ? `⭐ ${venueObj.rating}` : null;
        return (
          <View key={id} style={s.turfOrderRow}>
            <View style={s.turfOrderNumBadge}>
              <Text style={s.turfOrderNumTxt}>{i + 1}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.turfOrderRowName} numberOfLines={1}>
                {venueObj?.name || id.slice(0, 8) + "…"}
              </Text>
              {rating && <Text style={s.turfOrderRating}>{rating}</Text>}
            </View>
            <View style={s.turfOrderBtns}>
              <TouchableOpacity onPress={() => moveTurf(i, "up")} disabled={i === 0} style={[s.orderBtn, i === 0 && { opacity: 0.3 }]}>
                <Ionicons name="chevron-up" size={16} color={DARK} />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => moveTurf(i, "down")} disabled={i === getVenueIds().length - 1} style={[s.orderBtn, i === getVenueIds().length - 1 && { opacity: 0.3 }]}>
                <Ionicons name="chevron-down" size={16} color={DARK} />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => removeTurfFromSection(id)} style={[s.orderBtn, { backgroundColor: "#FEF2F2" }]}>
                <Ionicons name="close" size={14} color="#DC2626" />
              </TouchableOpacity>
            </View>
          </View>
        );
      })
    )}
  </View>
)}

              {/* Sport filter */}
              {sectionForm.type === "sport" && (
                <View>
                  <Text style={s.fieldLabel}>Sport to filter by</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }}>
                    <View style={{ flexDirection: "row", gap: 8 }}>
                      {SPORT_OPTS.map(sp => (
                        <TouchableOpacity key={sp}
                          style={[s.typeBtn, sectionForm.filter?.sport === sp && s.typeBtnActive]}
                          onPress={() => setSectionForm(f => ({ ...f, filter: { sport: sp } }))}>
                          <Text style={[s.typeTxt, sectionForm.filter?.sport === sp && s.typeTxtActive]}>{sp}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </ScrollView>
                </View>
              )}

              {/* Location filter */}
              {sectionForm.type === "location" && (
                <View>
                  <Text style={s.fieldLabel}>Location keyword</Text>
                  <TextInput style={s.input} placeholder="e.g. Amravati" placeholderTextColor="#9CA3AF"
                    value={sectionForm.filter?.location || ""}
                    onChangeText={v => setSectionForm(f => ({ ...f, filter: { location: v } }))} />
                  <Text style={s.hint}>Turfs whose location contains this text will appear in this section.</Text>
                </View>
              )}

              {/* 🏙️ Which cities see this section */}
              <CityChips value={sectionForm.cityIds} cities={cities} onChange={ids => setSectionForm(f => ({ ...f, cityIds: ids }))} />

              {/* Active toggle */}
              <View style={s.toggleRow}>
                <View>
                  <Text style={s.toggleLabel}>Show on home screen</Text>
                  <Text style={s.toggleSub}>{sectionForm.active ? "Visible to users." : "Hidden from users."}</Text>
                </View>
                <Switch value={sectionForm.active} onValueChange={v => setSectionForm(f => ({ ...f, active: v }))}
                  trackColor={{ false: "#E5E7EB", true: ACCENT }} thumbColor="#fff" />
              </View>

              <TouchableOpacity style={[s.saveBtn, saving && { opacity: 0.6 }]} onPress={saveSection} disabled={saving}>
                {saving ? <ActivityIndicator color="#fff" /> : (
                  <><Ionicons name="checkmark-circle-outline" size={18} color="#fff" />
                  <Text style={s.saveBtnTxt}>{editingSection ? "Save Changes" : "Create Section"}</Text></>
                )}
              </TouchableOpacity>
              <TouchableOpacity style={s.cancelBtn} onPress={() => setSectionModal(false)}>
                <Text style={s.cancelBtnTxt}>Cancel</Text>
              </TouchableOpacity>
              <View style={{ height: 32 }} />
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ── Turf Picker Modal ─────────────────────────────────────────────── */}
      <Modal visible={turfPickModal} animationType="slide" transparent>
        <View style={s.modalBackdrop}>
          <View style={s.modalSheet}>
            <View style={s.sheetHandle} />
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>Pick Turfs</Text>
              <TouchableOpacity style={s.closeBtn} onPress={() => setTurfPickModal(false)}>
                <Ionicons name="close" size={20} color="#374151" />
              </TouchableOpacity>
            </View>
           <TextInput 
  style={[s.input, { marginBottom: 10 }]} 
  placeholder={`Search ${sectionForm.venueType === "gym" ? "gyms" : "turfs"}...`}
  placeholderTextColor="#9CA3AF"
  value={turfSearch} 
  onChangeText={setTurfSearch} 
/>
<FlatList
  data={
    (sectionForm.venueType === "gym" ? gyms : turfs).filter(t =>
      !turfSearch.trim() ||
      (t.name || "").toLowerCase().includes(turfSearch.toLowerCase()) ||
      (t.location || "").toLowerCase().includes(turfSearch.toLowerCase())
    )
  }
  
              keyExtractor={t => t.id}
              style={{ maxHeight: 400 }}
              renderItem={({ item }) => {
  const already = getVenueIds().includes(item.id);  // ✅ Use helper
  return (
    <TouchableOpacity 
      style={[s.turfPickRow, already && s.turfPickRowAdded]}
      onPress={() => already ? removeTurfFromSection(item.id) : addTurfToSection(item.id)}
    >
      <View style={{ flex: 1 }}>
        <Text style={s.turfPickName}>{item.name || "Unnamed"}</Text>
        <Text style={s.turfPickMeta}>
          {sectionForm.venueType === "gym" 
            ? `${item.location || "—"}${item.rating ? ` · ⭐ ${item.rating}` : ""}`
            : `${item.sport} · ${item.cityName || item.location}${item.rating ? ` · ⭐ ${item.rating}` : " · No rating"}`
          }
        </Text>
      </View>
      <Ionicons name={already ? "checkmark-circle" : "add-circle-outline"} size={22} color={already ? ACCENT : "#9CA3AF"} />
    </TouchableOpacity>
  );
}}
            />
           <TouchableOpacity style={[s.saveBtn, { marginTop: 12 }]} onPress={() => setTurfPickModal(false)}>
  <Text style={s.saveBtnTxt}>Done ({getVenueIds().length} selected)</Text>
</TouchableOpacity>
            <View style={{ height: 24 }} />
          </View>
        </View>
      </Modal>

      {/* ── Highlight Card Edit Modal ─────────────────────────────────────── */}
      <Modal visible={highlightModal} animationType="slide" transparent>
        <View style={s.modalBackdrop}>
          <View style={s.modalSheet}>
            <View style={s.sheetHandle} />
            <ScrollView showsVerticalScrollIndicator={false}>
              <View style={s.modalHeader}>
                <Text style={s.modalTitle}>{editingCard ? "Edit Card" : "New Highlight Card"}</Text>
                <TouchableOpacity style={s.closeBtn} onPress={() => setHighlightModal(false)}>
                  <Ionicons name="close" size={20} color="#374151" />
                </TouchableOpacity>
              </View>

              <Text style={s.fieldLabel}>Card Title *</Text>
              <TextInput style={s.input} placeholder="e.g. Best Offers" placeholderTextColor="#9CA3AF"
                value={cardForm.title} onChangeText={v => setCardForm(f => ({ ...f, title: v }))} />

              <Text style={s.fieldLabel}>Subtitle</Text>
              <TextInput style={s.input} placeholder="e.g. Up to 30% off" placeholderTextColor="#9CA3AF"
                value={cardForm.sub} onChangeText={v => setCardForm(f => ({ ...f, sub: v }))} />

              <Text style={s.fieldLabel}>Card Icon</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }}>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  {ICON_OPTS.map(ic => (
                    <TouchableOpacity key={ic} style={[s.iconOpt, cardForm.icon === ic && s.iconOptActive]}
                      onPress={() => setCardForm(f => ({ ...f, icon: ic }))}>
                      <Text style={{ fontSize: 22 }}>{ic}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>

              <Text style={s.fieldLabel}>Card Background Color</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }}>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  {COLOR_OPTS.map(c => (
                    <TouchableOpacity key={c} style={[s.colorOpt, { backgroundColor: c }, cardForm.color === c && s.colorOptActive]}
                      onPress={() => setCardForm(f => ({ ...f, color: c }))} />
                  ))}
                </View>
              </ScrollView>

              <Text style={s.fieldLabel}>Icon Background Color</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }}>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  {ICON_BG_OPTS.map(c => (
                    <TouchableOpacity key={c} style={[s.colorOpt, { backgroundColor: c }, cardForm.iconBg === c && s.colorOptActive]}
                      onPress={() => setCardForm(f => ({ ...f, iconBg: c }))} />
                  ))}
                </View>
              </ScrollView>

              <Text style={s.fieldLabel}>Tap Action</Text>
              <View style={s.typeRow}>
                {(["explore","sport","turf","link","profile","toss"] as const).map(a => (
                  <TouchableOpacity key={a} style={[s.typeBtn, cardForm.action === a && s.typeBtnActive]}
                    onPress={() => setCardForm(f => ({ ...f, action: a, actionValue: "" }))}>
                    <Text style={[s.typeTxt, cardForm.action === a && s.typeTxtActive]}>{a}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              {cardForm.action === "sport" && (
                <>
                  <Text style={s.fieldLabel}>Sport name</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    <View style={{ flexDirection: "row", gap: 8, marginBottom: 8 }}>
                      {SPORT_OPTS.map(sp => (
                        <TouchableOpacity key={sp} style={[s.typeBtn, cardForm.actionValue === sp && s.typeBtnActive]}
                          onPress={() => setCardForm(f => ({ ...f, actionValue: sp }))}>
                          <Text style={[s.typeTxt, cardForm.actionValue === sp && s.typeTxtActive]}>{sp}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </ScrollView>
                </>
              )}
              {cardForm.action === "turf" && (
                <>
                  <Text style={s.fieldLabel}>Turf ID</Text>
                  <TextInput style={s.input} placeholder="Paste turf document ID" placeholderTextColor="#9CA3AF"
                    value={cardForm.actionValue} onChangeText={v => setCardForm(f => ({ ...f, actionValue: v }))} autoCapitalize="none" />
                </>
              )}
              {cardForm.action === "link" && (
                <>
                  <Text style={s.fieldLabel}>URL</Text>
                  <TextInput style={s.input} placeholder="https://..." placeholderTextColor="#9CA3AF"
                    value={cardForm.actionValue} onChangeText={v => setCardForm(f => ({ ...f, actionValue: v }))} autoCapitalize="none" />
                </>
              )}

              {/* Live preview */}
              <Text style={s.fieldLabel}>Preview</Text>
              <View style={[s.cardPreview, { backgroundColor: cardForm.color }]}>
                <Text style={s.cardPreviewTitle}>{cardForm.title || "Title"}</Text>
                <Text style={s.cardPreviewSub}>{cardForm.sub || "Subtitle"}</Text>
                <View style={[s.cardPreviewIcon, { backgroundColor: cardForm.iconBg }]}>
                  <Text style={{ fontSize: 20 }}>{cardForm.icon}</Text>
                </View>
              </View>

              {/* 🏙️ Which cities see this card */}
              <CityChips value={cardForm.cityIds} cities={cities} onChange={ids => setCardForm(f => ({ ...f, cityIds: ids }))} />

              <View style={s.toggleRow}>
                <View>
                  <Text style={s.toggleLabel}>Show on home screen</Text>
                  <Text style={s.toggleSub}>{cardForm.active ? "Visible to users." : "Hidden."}</Text>
                </View>
                <Switch value={cardForm.active} onValueChange={v => setCardForm(f => ({ ...f, active: v }))}
                  trackColor={{ false: "#E5E7EB", true: ACCENT }} thumbColor="#fff" />
              </View>

              <TouchableOpacity style={[s.saveBtn, saving && { opacity: 0.6 }]} onPress={saveCard} disabled={saving}>
                {saving ? <ActivityIndicator color="#fff" /> : (
                  <><Ionicons name="checkmark-circle-outline" size={18} color="#fff" />
                  <Text style={s.saveBtnTxt}>{editingCard ? "Save Changes" : "Create Card"}</Text></>
                )}
              </TouchableOpacity>
              <TouchableOpacity style={s.cancelBtn} onPress={() => setHighlightModal(false)}>
                <Text style={s.cancelBtnTxt}>Cancel</Text>
              </TouchableOpacity>
              <View style={{ height: 32 }} />
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: "#F0F4F8" },
  loadWrap:{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: DARK },
  loadText:{ marginTop: 12, color: "#9CA3AF", fontSize: 15, fontWeight: "600" },

  hero: { backgroundColor: DARK, paddingHorizontal: 20,paddingBottom: 20, overflow: "hidden" },
  backBtn:  { width: 36, height: 36, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.1)", justifyContent: "center", alignItems: "center", marginBottom: 12 },
  heroTag:  { color: "#6EE7B7", fontSize: 11, fontWeight: "800", letterSpacing: 1.5, textTransform: "uppercase" },
  heroTitle:{ color: "#fff", fontSize: 26, fontWeight: "900", marginTop: 4 },
  heroSub:  { color: "#9CA3AF", fontSize: 13, lineHeight: 20, marginTop: 6 },

  tabRow:      { flexDirection: "row", backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#F3F4F6" },
  tabBtn:      { flex: 1, paddingVertical: 12, alignItems: "center" },
  tabBtnActive:{ borderBottomWidth: 2, borderBottomColor: ACCENT },
  tabTxt:      { fontSize: 13, fontWeight: "600", color: "#9CA3AF" },
  tabTxtActive:{ color: ACCENT, fontWeight: "800" },

  listWrap:      { padding: 16 },
  listHeader:    { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  listHeaderTxt: { fontSize: 12, color: "#9CA3AF", fontWeight: "600", flex: 1 },
  addBtn:        { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: DARK, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10 },
  addBtnTxt:     { color: "#fff", fontSize: 13, fontWeight: "700" },

  sectionCard: { backgroundColor: "#fff", borderRadius: 16, marginBottom: 12, flexDirection: "row", borderWidth: 1, borderColor: "#E5E7EB", shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 2, padding: 14 },
  dragHandle:  { width: 32, justifyContent: "center", alignItems: "center", marginRight: 8 },

  sectionCardTop: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 },
  sectionIcon:    { fontSize: 22 },
  sectionTitle:   { fontSize: 15, fontWeight: "800", color: "#111827" },
  sectionSub:     { fontSize: 12, color: "#9CA3AF", marginTop: 2 },

  sectionMeta: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 8 },
  metaChip:    { backgroundColor: "#F3F4F6", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  metaChipTxt: { fontSize: 11, fontWeight: "600", color: "#6B7280" },
  metaActive:  { backgroundColor: "#DCFCE7" },
  metaInactive:{ backgroundColor: "#F3F4F6" },
  metaNearby:  { backgroundColor: "#DBEAFE" },
  metaAll:     { backgroundColor: "#EDE9FE" },

  systemSectionPreview:    { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#F9FAFB", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7, marginTop: 8, borderWidth: 1, borderColor: "#F3F4F6" },
  systemSectionPreviewTxt: { fontSize: 11, color: "#6B7280", fontWeight: "500", flex: 1 },

  typDescBox:  { flexDirection: "row", alignItems: "flex-start", gap: 6, backgroundColor: "#F0FDFA", borderRadius: 10, padding: 10, marginTop: 6, marginBottom: 4, borderWidth: 1, borderColor: "#99F6E4" },
  typeDescTxt: { fontSize: 12, color: "#0F766E", fontWeight: "500", flex: 1, lineHeight: 18 },

  turfOrderChip:  { backgroundColor: "#F0FDF4", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderColor: "#86EFAC" },
  turfOrderNum:   { fontSize: 10, fontWeight: "900", color: "#fff", backgroundColor: ACCENT, width: 16, height: 16, borderRadius: 8, textAlign: "center", lineHeight: 16 },
  turfOrderChipRating: { fontSize: 10, color: "#D97706", fontWeight: "700" },
  turfOrderName:  { fontSize: 11, fontWeight: "600", color: "#374151" },

  cardActions:  { flexDirection: "row", gap: 8, marginTop: 8 },
  actionBtn:    { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#F3F4F6", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  actionTxt:    { fontSize: 11, fontWeight: "700", color: "#374151" },
  actionDelete: { backgroundColor: "#FEF2F2" },

  cardCard:     { borderRadius: 16, marginBottom: 12, flexDirection: "row", borderWidth: 1, borderColor: "rgba(0,0,0,0.06)", shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4, elevation: 1, padding: 14 },
  cardIconWrap: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },

  empty:      { alignItems: "center", paddingVertical: 48 },
  emptyIcon:  { fontSize: 40 },
  emptyTitle: { fontSize: 17, fontWeight: "800", color: "#374151", marginTop: 12 },
  emptySub:   { fontSize: 13, color: "#9CA3AF", textAlign: "center", marginTop: 6, lineHeight: 20, paddingHorizontal: 20 },

  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  modalSheet:    { backgroundColor: "#fff", borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 20, paddingTop: 12, paddingBottom: Platform.OS === "ios" ? 34 : 20, maxHeight: "95%" },
  sheetHandle:   { width: 40, height: 4, borderRadius: 2, backgroundColor: "#E5E7EB", alignSelf: "center", marginBottom: 16 },
  modalHeader:   { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
  modalTitle:    { fontSize: 20, fontWeight: "900", color: "#111827" },
  closeBtn:      { width: 34, height: 34, borderRadius: 17, backgroundColor: "#F3F4F6", justifyContent: "center", alignItems: "center" },

  fieldLabel: { fontSize: 11, fontWeight: "800", color: "#6B7280", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 7, marginTop: 14 },
  input:      { backgroundColor: "#F9FAFB", borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: "#111827" },
  hint:       { fontSize: 11, color: "#9CA3AF", marginTop: 5, fontWeight: "500" },

  typeRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 4 },
  typeBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: "#F3F4F6", borderWidth: 1, borderColor: "#E5E7EB" },
  typeBtnActive: { backgroundColor: DARK, borderColor: DARK },
  typeTxt:       { fontSize: 13, fontWeight: "700", color: "#6B7280" },
  typeTxtActive: { color: "#fff" },

  iconOpt:      { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: "#F9FAFB", borderWidth: 1, borderColor: "#E5E7EB" },
  iconOptActive:{ borderColor: ACCENT, borderWidth: 2, backgroundColor: "#F0FDFA" },
  colorOpt:     { width: 36, height: 36, borderRadius: 8, borderWidth: 2, borderColor: "transparent" },
  colorOptActive:{ borderColor: DARK, borderWidth: 2 },

  turfPickHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  pickMoreBtn:    { flexDirection: "row", alignItems: "center", gap: 4 },
  pickMoreTxt:    { fontSize: 13, color: ACCENT, fontWeight: "700" },

  emptyTurfPick:    { flexDirection: "row", alignItems: "center", gap: 8, justifyContent: "center", backgroundColor: "#F0FDFA", borderRadius: 12, padding: 16, borderWidth: 1.5, borderColor: ACCENT, borderStyle: "dashed", marginTop: 8 },
  emptyTurfPickTxt: { fontSize: 14, color: ACCENT, fontWeight: "700" },

  turfOrderRow:    { flexDirection: "row", alignItems: "center", backgroundColor: "#F9FAFB", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, marginBottom: 6, borderWidth: 1, borderColor: "#E5E7EB", gap: 10 },
  turfOrderNumBadge:{ width: 24, height: 24, borderRadius: 12, backgroundColor: DARK, alignItems: "center", justifyContent: "center" },
  turfOrderNumTxt:  { fontSize: 11, fontWeight: "900", color: "#fff" },
  turfOrderRowName:  { fontSize: 13, fontWeight: "600", color: "#111827" },
  turfOrderRating:   { fontSize: 10, color: "#D97706", fontWeight: "700", marginTop: 1 },
  turfOrderBtns:    { flexDirection: "row", gap: 4 },
  orderBtn:         { width: 28, height: 28, borderRadius: 8, backgroundColor: "#F3F4F6", alignItems: "center", justifyContent: "center" },

  turfPickRow:      { flexDirection: "row", alignItems: "center", paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "#F3F4F6", gap: 10 },
  turfPickRowAdded: { backgroundColor: "#F0FDFA" },
  turfPickName:     { fontSize: 14, fontWeight: "700", color: "#111827" },
  turfPickMeta:     { fontSize: 11, color: "#9CA3AF", marginTop: 2 },

  cardPreview:     { borderRadius: 16, padding: 14, minHeight: 130, marginBottom: 4, borderWidth: 1, borderColor: "rgba(0,0,0,0.04)" },
  cardPreviewTitle:{ fontSize: 13, fontWeight: "800", color: "#111827" },
  cardPreviewSub:  { fontSize: 11, color: "#6B7280", marginTop: 3 },
  cardPreviewIcon: { width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center", marginTop: 14 },

  offerRowBox:    { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#FFF7ED", borderWidth: 1, borderColor: "#FED7AA", borderRadius: 16, padding: 12, marginHorizontal: 16, marginTop: 14 },
  offerRowTitle:  { fontSize: 14, fontWeight: "800", color: "#9A3412" },
  offerRowSub:    { fontSize: 11, color: "#C2410C", marginTop: 2, lineHeight: 16 },
  offerRowBtn:    { backgroundColor: "#EA580C", paddingHorizontal: 16, paddingVertical: 9, borderRadius: 10 },
  offerRowBtnTxt: { color: "#fff", fontWeight: "800", fontSize: 13 },

  toggleRow:   { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: "#F9FAFB", borderRadius: 14, padding: 14, marginTop: 16, borderWidth: 1, borderColor: "#E5E7EB" },
  toggleLabel: { fontSize: 15, fontWeight: "700", color: "#111827" },
  toggleSub:   { fontSize: 12, color: "#9CA3AF", marginTop: 2 },

  saveBtn:    { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: DARK, paddingVertical: 15, borderRadius: 16, marginTop: 20 },
  saveBtnTxt: { color: "#fff", fontWeight: "800", fontSize: 15 },
  cancelBtn:  { backgroundColor: "#F3F4F6", paddingVertical: 15, borderRadius: 16, alignItems: "center", marginTop: 10 },
  cancelBtnTxt:{ color: "#374151", fontWeight: "700", fontSize: 15 },
});
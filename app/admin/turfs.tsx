/**
 * turfs.tsx — Admin turf management
 * Changes from previous version:
 *  ✅ "Pick on Map" button opens MapPickerModal
 *  ✅ Dropping a pin fills latitude, longitude AND location text
 *  ✅ Manual lat/lng fields still editable as fallback
 *  ✅ GPS badge on every card shows coords status
 */
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
  query, where, serverTimestamp,
} from "firebase/firestore";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import MapPickerModal from "../../components/Mappickermodal"; // ✅ adjust path as needed

const DARK  = "#0A0F1E";
const ACCENT = "#0EA5A4";

const VENUE_TYPES = [
  { key: "turf",     label: "Turf",  emoji: "⚽,🏏" },
  { key: "court",    label: "Indoor Court",  emoji: "🏸" },
  { key: "gym",      label: "Gym / Fitness", emoji: "🏋️" },
  { key: "swimming", label: "Swimming Pool", emoji: "🏊" },
  { key: "club",     label: "Club / Arena",  emoji: "🏟️" },
  { key: "other",    label: "Other",         emoji: "➕" },
];

type Turf = {
  id: string;
  name?: string;
  location?: string;
  sport?: string | string[];
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
  latitude?: number | null;
  longitude?: number | null;
  rating?: number | string;
    venueType?: string;
  
};

type Owner = { id: string; name?: string; email?: string };

export default function AdminTurfs() {
  const router = useRouter();
  const [turfs,      setTurfs]      = useState<Turf[]>([]);
  const [owners,     setOwners]     = useState<Owner[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search,     setSearch]     = useState("");

  const [editModal,  setEditModal]  = useState(false);
  const [editTurf,   setEditTurf]   = useState<Turf | null>(null);
  const [saving,     setSaving]     = useState(false);
  const [geocoding,  setGeocoding]  = useState(false);
  const [showMap,    setShowMap]    = useState(false); // ✅ map picker visibility
  

  const [form, setForm] = useState({
    name: "", location: "", sport: "", mapLink: "",
    dayPrice: "", nightPrice: "", bookingPrice: "",
    openingTime: "6", closingTime: "24", slotDuration: "60",
    operatorEmail: "", ownerId: "", ownerName: "",
    images: [] as string[], imageInput: "", active: true,
    latitude: "", longitude: "", rating: "", venueType: "turf",
  customVenueType: "",
  });

  useEffect(() => { fetchAll(); }, []);

  const fetchAll = async (isRefresh = false) => {
    isRefresh ? setRefreshing(true) : setLoading(true);
    const [turfResult, ownerResult] = await Promise.allSettled([
      getDocs(collection(db, "turfs")),
      getDocs(query(collection(db, "users"), where("role", "==", "owner"))),
    ]);
    if (turfResult.status === "fulfilled") {
      setTurfs(turfResult.value.docs.map((d) => {
        const data = d.data() || {};
        return {
          id: d.id,
          name: data.name || "",
          location: data.location || "",
          sport: data.sport || "",
          ownerName: data.ownerName || "",
          operatorEmail: data.operatorEmail || "",
          dayPrice: Number(data.dayPrice || 0),
          nightPrice: Number(data.nightPrice || 0),
          bookingPrice: Number(data.bookingPrice || 0),
          images: Array.isArray(data.images) ? data.images : [],
          image: data.image || "",
          active: data.active !== false,
          latitude: data.latitude ?? null,
          longitude: data.longitude ?? null,
          ...data,
        } as Turf;
      }));
    } else {
      Alert.alert("Error", "Could not load turfs.");
    }
    if (ownerResult.status === "fulfilled") {
      setOwners(ownerResult.value.docs.map((d) => ({ id: d.id, ...d.data() } as Owner)));
    }
    setLoading(false);
    setRefreshing(false);
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return turfs;
    return turfs.filter((t) =>
      [t.name, t.location, t.sport, t.ownerName, t.operatorEmail]
        .some((f) => String(f || "").toLowerCase().includes(q))
    );
  }, [turfs, search]);

  const openEdit = (turf: Turf) => {
    setEditTurf(turf);
    setForm({
      name:          turf.name || "",
      location:      turf.location || "",
      sport: Array.isArray(turf.sport)
  ? turf.sport.join(", ")
  : turf.sport || "",
      mapLink:       turf.mapLink || "",
      dayPrice:      String(turf.dayPrice || ""),
      nightPrice:    String(turf.nightPrice || ""),
      bookingPrice:  String(turf.bookingPrice || ""),
      openingTime:   String(turf.openingTime ?? "6"),
      closingTime:   String(turf.closingTime ?? "23"),
      slotDuration:  String(turf.slotDuration ?? "60"),
      operatorEmail: turf.operatorEmail || "",
      ownerId:       turf.ownerId || "",
      ownerName:     turf.ownerName || "",
      images:        turf.images || (turf.image ? [turf.image] : []),
      imageInput:    "",
      active:        turf.active !== false,
      latitude:      turf.latitude  != null ? String(turf.latitude)  : "",
      longitude:     turf.longitude != null ? String(turf.longitude) : "",
       rating: turf.rating != null ? String(turf.rating) : "",

    venueType:       turf.venueType || "turf",
    customVenueType: "", // always reset custom input on open
    });
    setEditModal(true);
  };

  // ✅ Called when user confirms a pin on the map
  const onMapConfirm = (lat: number, lng: number, address: string) => {
    setForm((f) => ({
      ...f,
      latitude:  String(lat),
      longitude: String(lng),
      // Also update location text if it was empty, or ask
      location: f.location.trim() || address,
    }));
    setShowMap(false);
    Alert.alert(
      "Location Set ✓",
      `Coordinates: ${lat.toFixed(5)}, ${lng.toFixed(5)}\n\nAddress: ${address}`,
      [{ text: "OK" }]
    );
  };

  // Manual geocode fallback
  const geocodeLocation = async () => {
    if (!form.location.trim()) { Alert.alert("Required", "Enter a location first."); return; }
    setGeocoding(true);
    try {
      const results = await Location.geocodeAsync(form.location.trim());
      if (results.length > 0) {
        const { latitude, longitude } = results[0];
        setForm((f) => ({ ...f, latitude: String(latitude), longitude: String(longitude) }));
        Alert.alert("Done", `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`);
      } else {
        Alert.alert("Not found", "Try a more specific address or use the map.");
      }
    } catch { Alert.alert("Error", "Geocoding failed."); }
    finally { setGeocoding(false); }
  };

const handleSaveEdit = async () => {
  if (!editTurf) return;
  if (!form.name.trim() || !form.location.trim()) {
    return Alert.alert("Required", "Name and location are required.");
  }

  let latitude:  number | null = null;
  let longitude: number | null = null;
  const parsedLat = parseFloat(form.latitude);
  const parsedLng = parseFloat(form.longitude);

  if (!isNaN(parsedLat) && !isNaN(parsedLng)) {
    latitude  = parsedLat;
    longitude = parsedLng;
  } else {
    try {
      const geo = await Location.geocodeAsync(form.location.trim());
      if (geo.length > 0) { latitude = geo[0].latitude; longitude = geo[0].longitude; }
    } catch { /* non-fatal */ }
  }

  setSaving(true);
  try {
    const selectedOwner = owners.find((o) => o.id === form.ownerId);
    await updateDoc(doc(db, "turfs", editTurf.id), {
      name:          form.name.trim(),
      location:      form.location.trim(),
      latitude,
      longitude,
      sport: form.sport.trim()
  ? form.sport.trim().split(",").map((s) => s.trim()).filter(Boolean)
  : [],
      mapLink:       form.mapLink.trim(),
      dayPrice:      Number(form.dayPrice) || 0,
      nightPrice:    Number(form.nightPrice) || 0,
      bookingPrice:  Number(form.bookingPrice) || 0,
      openingTime:   Number(form.openingTime),
      closingTime:   Number(form.closingTime),
      slotDuration:  Number(form.slotDuration),
      operatorEmail: form.operatorEmail.trim(),
      ownerId:       form.ownerId || editTurf.ownerId,
      ownerName:     selectedOwner?.name || form.ownerName,
      ownerEmail:    selectedOwner?.email || "",
      images:        form.images,
      image:         form.images[0] || "",
      active:        form.active,
      rating:        form.rating.trim() ? parseFloat(form.rating) : null,
       venueType:  form.venueType === "other"
    ? form.customVenueType.trim() || "other"
    : form.venueType,
      updatedAt:     serverTimestamp(),
      
    });
    setTurfs((prev) =>
      prev.map((t) => t.id === editTurf.id ? { ...t, ...form, latitude, longitude } : t)
    );
    setEditModal(false);
    Alert.alert("Saved ✓", latitude ? `Coords: ${latitude.toFixed(4)}, ${longitude?.toFixed(4)}` : "Turf updated.");
  } catch { Alert.alert("Error", "Could not save changes."); }
  finally { setSaving(false); }
};

  const confirmDelete = (turf: Turf) => {
    Alert.alert("Delete Turf", `Delete "${turf.name}"?`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: async () => {
        try {
          await deleteDoc(doc(db, "turfs", turf.id));
          setTurfs((prev) => prev.filter((t) => t.id !== turf.id));
        } catch { Alert.alert("Error", "Could not delete turf."); }
      }},
    ]);
  };

  const toggleActive = async (turf: Turf) => {
    const next = turf.active !== false ? false : true;
    try {
      await updateDoc(doc(db, "turfs", turf.id), { active: next });
      setTurfs((prev) => prev.map((t) => t.id === turf.id ? { ...t, active: next } : t));
    } catch { Alert.alert("Error", "Could not update status."); }
  };

  const renderTurf = ({ item }: { item: Turf }) => {
    const cover    = item.images?.[0] || item.image;
    const isActive = item.active !== false;
    const hasCoords = item.latitude != null && item.longitude != null;
    return (
      <View style={s.card}>
        <View style={s.cardImageWrap}>
          {cover
            ? <Image source={{ uri: cover }} style={s.cardImage} />
            : <View style={[s.cardImage, s.cardImagePlaceholder]}><Ionicons name="image-outline" size={28} color="#9CA3AF" /></View>
          }
          <View style={[s.activePill, isActive ? s.activePillOn : s.activePillOff]}>
            <View style={[s.activeDot, { backgroundColor: isActive ? "#22C55E" : "#9CA3AF" }]} />
            <Text style={[s.activePillText, { color: isActive ? "#15803D" : "#6B7280" }]}>
              {isActive ? "Live" : "Paused"}
            </Text>
          </View>
          <View style={[s.coordsBadge, hasCoords ? s.coordsBadgeOk : s.coordsBadgeMissing]}>
            <Ionicons name={hasCoords ? "location" : "location-outline"} size={11} color={hasCoords ? "#15803D" : "#B45309"} />
            <Text style={[s.coordsBadgeText, { color: hasCoords ? "#15803D" : "#B45309" }]}>
              {hasCoords ? "GPS ✓" : "No GPS"}
            </Text>
          </View>
        </View>

        <View style={s.cardBody}>
          <View style={s.cardTopRow}>
            <View style={{ flex: 1 }}>
              <Text style={s.turfName}>{item.name || "Unnamed"}</Text>
              {item.rating != null && parseFloat(String(item.rating)) > 0 && (
  <View style={s.ratingBadge}>
    <Text style={s.ratingBadgeText}>★ {parseFloat(String(item.rating)).toFixed(1)}</Text>
  </View>
)}
              <View style={s.metaRow}>
                <Ionicons name="location-outline" size={12} color="#6B7280" />
                <Text style={s.metaText}>{item.location || "No location"}</Text>
              </View>
              {hasCoords && (
                <Text style={s.coordsText}>{item.latitude!.toFixed(5)}, {item.longitude!.toFixed(5)}</Text>
              )}
            </View>
            <View style={s.sportBadge}>
              <Text style={s.sportText}>
  {Array.isArray(item.sport)
    ? item.sport.join(", ")
    : item.sport || "Sport"}
</Text>
            </View>

            {/* Venue type badge */}
{item.venueType && item.venueType !== "turf" && (
  <View style={[s.sportBadge, { backgroundColor: "#F5F3FF", marginTop: 4 }]}>
    <Text style={[s.sportText, { color: "#6D28D9" }]}>
      {VENUE_TYPES.find(v => v.key === item.venueType)?.emoji ?? "🏟️"}{" "}
      {item.venueType}
    </Text>
  </View>
)}
          </View>

          <View style={s.priceRow}>
            {[
              { label: "Day",     value: item.dayPrice },
              { label: "Night",   value: item.nightPrice },
              { label: "Advance", value: item.bookingPrice },
            ].map((p) => (
              <View key={p.label} style={s.priceChip}>
                <Text style={s.priceChipLabel}>{p.label}</Text>
                <Text style={s.priceChipValue}>₹{p.value || 0}</Text>
              </View>
            ))}
          </View>

          <View style={s.ownerRow}>
            <Ionicons name="person-outline" size={13} color="#6B7280" />
            <Text style={s.ownerText}>{item.ownerName || "No owner"}</Text>
            {item.operatorEmail ? (
              <><Text style={s.ownerDot}>·</Text><Ionicons name="mail-outline" size={13} color="#6B7280" /><Text style={s.ownerText}>{item.operatorEmail}</Text></>
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

  // ── Parsed coords for map initial center ───────────────────────────────────
  const parsedLat = parseFloat(form.latitude);
  const parsedLng = parseFloat(form.longitude);

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
                  { label: "Live",   value: turfs.filter((t) => t.active !== false).length, color: "#34D399" },
                  { label: "Paused", value: turfs.filter((t) => t.active === false).length,  color: "#9CA3AF" },
                  { label: "No GPS", value: turfs.filter((t) => t.latitude == null).length,  color: "#FBBF24" },
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
                  style={s.searchInput} placeholder="Search turf, location, sport..."
                  placeholderTextColor="#9CA3AF" value={search} onChangeText={setSearch}
                  autoCorrect={false} autoCapitalize="none"
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

      {/* ── Edit Modal ── */}
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

  {/* Venue Type */}
  <Text style={s.fieldLabel}>Venue Type</Text>
  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 4 }}>
    <View style={{ flexDirection: "row", gap: 8 }}>
      {VENUE_TYPES.map(v => (
        <TouchableOpacity
          key={v.key}
          style={[s.venueChip, form.venueType === v.key && s.venueChipActive]}
          onPress={() => setForm(f => ({
            ...f,
            venueType: v.key,
            customVenueType: v.key !== "other" ? "" : f.customVenueType,
          }))}
        >
          <Text style={s.venueChipEmoji}>{v.emoji}</Text>
          <Text style={[s.venueChipLabel, form.venueType === v.key && s.venueChipLabelActive]}>
            {v.label}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  </ScrollView>

  {form.venueType === "other" && (
    <View style={{ marginBottom: 8 }}>
      <TextInput
        style={s.input}
        placeholder="e.g. Skating Rink, Golf Course, Archery Range"
        placeholderTextColor="#9CA3AF"
        value={form.customVenueType}
        onChangeText={v => setForm(f => ({ ...f, customVenueType: v }))}
        autoCapitalize="words"
      />
      {form.customVenueType.trim().length > 0 && (
        <View style={s.venuePreview}>
          <Text style={s.venuePreviewText}>
            Will save as: "{form.customVenueType.trim()}"
          </Text>
        </View>
      )}
    </View>
  )}

  {/* All text fields */}
  {[
    { label: "Turf Name *",         key: "name",          placeholder: "e.g. Green Field Arena" },
    { label: "Location *",           key: "location",      placeholder: "Area, City" },
    { label: "Sport",                key: "sport",         placeholder: "Football, Cricket..." },
    { label: "Google Maps Link",     key: "mapLink",       placeholder: "https://maps.google.com/..." },
    { label: "Day Price (₹/hr)",     key: "dayPrice",      placeholder: "6 AM – 6 PM",        numeric: true },
    { label: "Night Price (₹/hr)",   key: "nightPrice",    placeholder: "6 PM – 6 AM",        numeric: true },
    { label: "Advance Booking (₹)",  key: "bookingPrice",  placeholder: "Amount to lock slot", numeric: true },
    { label: "Opening Time (24hr)",  key: "openingTime",   placeholder: "6",                  numeric: true },
    { label: "Closing Time (24hr)",  key: "closingTime",   placeholder: "24",                 numeric: true },
    { label: "Slot Duration (mins)", key: "slotDuration",  placeholder: "30 or 60",           numeric: true },
    { label: "Operator Email",       key: "operatorEmail", placeholder: "turf@playon.app" },
  ].map(({ label, key, placeholder, numeric }) => (
    <View key={key}>
      <Text style={s.fieldLabel}>{label}</Text>
      <TextInput
        style={s.input} placeholder={placeholder} placeholderTextColor="#9CA3AF"
        value={(form as any)[key]}
        onChangeText={(v) => setForm((f) => ({ ...f, [key]: v }))}
        keyboardType={numeric ? "numeric" : "default"}
        autoCapitalize="none"
      />
    </View>
  ))}

  {/* Rating */}
  <Text style={s.fieldLabel}>Rating (0.0 – 5.0)</Text>
  <TextInput
    style={s.input}
    placeholder="e.g. 4.5"
    placeholderTextColor="#9CA3AF"
    value={form.rating}
    onChangeText={(v) => setForm((f) => ({ ...f, rating: v }))}
    keyboardType="decimal-pad"
  />

  {/* GPS Coordinates */}
  <View style={s.coordsSection}>
    <View style={s.coordsSectionHeader}>
      <Ionicons name="navigate-outline" size={16} color={ACCENT} />
      <Text style={s.coordsSectionTitle}>GPS Coordinates</Text>
    </View>
    <Text style={s.coordsSectionSub}>
      Needed for "Near You" sorting. Pick on map for best accuracy.
    </Text>
    <TouchableOpacity
      style={s.mapPickerBtn}
      onPress={() => setShowMap(true)}
      activeOpacity={0.85}
    >
      <Ionicons name="map-outline" size={18} color="#fff" />
      <Text style={s.mapPickerBtnText}>Open Map & Drop Pin</Text>
      {form.latitude ? (
        <View style={s.coordsPill}>
          <Text style={s.coordsPillText}>
            {parseFloat(form.latitude).toFixed(4)}, {parseFloat(form.longitude).toFixed(4)}
          </Text>
        </View>
      ) : null}
    </TouchableOpacity>
    <TouchableOpacity
      style={[s.geocodeBtn, geocoding && { opacity: 0.6 }]}
      onPress={geocodeLocation}
      disabled={geocoding}
      activeOpacity={0.8}
    >
      {geocoding
        ? <ActivityIndicator size="small" color={ACCENT} />
        : <Ionicons name="locate-outline" size={15} color={ACCENT} />
      }
      <Text style={s.geocodeBtnText}>
        {geocoding ? "Detecting…" : "Auto-detect from Location text"}
      </Text>
    </TouchableOpacity>
    <View style={s.latLngRow}>
      <View style={{ flex: 1 }}>
        <Text style={s.fieldLabel}>Latitude</Text>
        <TextInput
          style={s.input} placeholder="e.g. 20.9374" placeholderTextColor="#9CA3AF"
          value={form.latitude}
          onChangeText={(v) => setForm((f) => ({ ...f, latitude: v }))}
          keyboardType="decimal-pad"
        />
      </View>
      <View style={{ width: 10 }} />
      <View style={{ flex: 1 }}>
        <Text style={s.fieldLabel}>Longitude</Text>
        <TextInput
          style={s.input} placeholder="e.g. 77.7796" placeholderTextColor="#9CA3AF"
          value={form.longitude}
          onChangeText={(v) => setForm((f) => ({ ...f, longitude: v }))}
          keyboardType="decimal-pad"
        />
      </View>
    </View>
  </View>

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

  {/* Images */}
  <Text style={s.fieldLabel}>Images (URLs)</Text>
  <View style={s.imageInputRow}>
    <TextInput
      style={[s.input, { flex: 1 }]} placeholder="Paste image URL and tap +"
      placeholderTextColor="#9CA3AF" value={form.imageInput}
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
      <Text style={s.toggleSub}>{form.active ? "Visible to users." : "Hidden from users."}</Text>
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
      <><Ionicons name="checkmark-circle-outline" size={18} color="#FFFFFF" /><Text style={s.saveBtnText}>Save Changes</Text></>
    )}
  </TouchableOpacity>
  <TouchableOpacity style={s.cancelBtn} onPress={() => setEditModal(false)} disabled={saving}>
    <Text style={s.cancelBtnText}>Cancel</Text>
  </TouchableOpacity>
  <View style={{ height: 24 }} />

</ScrollView>
   {/* ← single closing ScrollView */}
</View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ✅ Map Picker — opens full screen on top of edit modal */}
      <MapPickerModal
        visible={showMap}
        initialLocation={form.location}
        initialLat={!isNaN(parsedLat) ? parsedLat : undefined}
        initialLng={!isNaN(parsedLng) ? parsedLng : undefined}
        onConfirm={onMapConfirm}
        onClose={() => setShowMap(false)}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:     { flex: 1, backgroundColor: "#F0F4F8" },
  loadWrap: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: DARK },
  loadText: { marginTop: 12, color: "#9CA3AF", fontSize: 15, fontWeight: "600" },
  list:     { paddingBottom: 100 },

  hero:      { backgroundColor: DARK, paddingHorizontal: 20, paddingTop: Platform.OS === "android" ? (StatusBar.currentHeight || 0) + 14 : 18, paddingBottom: 24, overflow: "hidden" },
  heroGlow1: { position: "absolute", top: -40, right: -40, width: 200, height: 200, borderRadius: 100, backgroundColor: "rgba(14,165,164,0.14)" },
  heroGlow2: { position: "absolute", bottom: -60, left: -40, width: 180, height: 180, borderRadius: 90, backgroundColor: "rgba(96,165,250,0.10)" },
  heroTop:   { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  heroTag:   { color: "#6EE7B7", fontSize: 11, fontWeight: "800", letterSpacing: 1.5, textTransform: "uppercase" },
  heroTitle: { color: "#FFFFFF", fontSize: 28, fontWeight: "900", marginTop: 4 },
  heroSub:   { color: "#9CA3AF", fontSize: 13, lineHeight: 20, marginTop: 6 },
  countBadge:  { backgroundColor: "rgba(255,255,255,0.08)", borderRadius: 14, padding: 12, alignItems: "center", minWidth: 60 },
  countText:   { color: "#FFFFFF", fontSize: 24, fontWeight: "900" },
  countLabel:  { color: "#9CA3AF", fontSize: 11, fontWeight: "600" },
  heroStats:     { flexDirection: "row", gap: 12, marginTop: 18 },
  heroStat:      { backgroundColor: "rgba(255,255,255,0.07)", borderRadius: 12, paddingHorizontal: 18, paddingVertical: 10, alignItems: "center" },
  heroStatValue: { fontSize: 20, fontWeight: "900" },
  heroStatLabel: { color: "#9CA3AF", fontSize: 11, fontWeight: "600", marginTop: 2 },

  toolbar:     { flexDirection: "row", gap: 10, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 4 },
  searchWrap:  { flex: 1, flexDirection: "row", alignItems: "center", backgroundColor: "#FFFFFF", borderRadius: 14, paddingHorizontal: 14, borderWidth: 1, borderColor: "#E5E7EB" },
  searchInput: { flex: 1, paddingVertical: 12, fontSize: 14, color: "#111827" },
  addBtn:      { backgroundColor: DARK, width: 46, height: 46, borderRadius: 14, justifyContent: "center", alignItems: "center" },
  sectionLabel:{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8, fontSize: 13, color: "#9CA3AF", fontWeight: "700" },

  card:                 { backgroundColor: "#FFFFFF", marginHorizontal: 16, marginBottom: 14, borderRadius: 20, overflow: "hidden", borderWidth: 1, borderColor: "#E5E7EB", shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  cardImageWrap:        { position: "relative" },
  cardImage:            { width: "100%", height: 140, backgroundColor: "#E5E7EB" },
  cardImagePlaceholder: { justifyContent: "center", alignItems: "center" },
  activePill:     { position: "absolute", top: 10, right: 10, flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  activePillOn:   { backgroundColor: "#DCFCE7" },
  activePillOff:  { backgroundColor: "#F3F4F6" },
  activeDot:      { width: 6, height: 6, borderRadius: 3 },
  activePillText: { fontSize: 11, fontWeight: "800" },
  coordsBadge:        { position: "absolute", bottom: 10, left: 10, flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999 },
  coordsBadgeOk:      { backgroundColor: "#DCFCE7" },
  coordsBadgeMissing: { backgroundColor: "#FEF9C3" },
  coordsBadgeText:    { fontSize: 10, fontWeight: "800" },
  coordsText:         { fontSize: 10, color: "#9CA3AF", marginTop: 2 },

  cardBody:    { padding: 14 },
  cardTopRow:  { flexDirection: "row", alignItems: "flex-start", marginBottom: 10 },
  turfName:    { fontSize: 18, fontWeight: "900", color: "#111827" },
  metaRow:     { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 },
  metaText:    { fontSize: 12, color: "#6B7280", fontWeight: "500" },
  sportBadge:  { backgroundColor: "#EFF6FF", paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  sportText:   { fontSize: 11, color: "#1E40AF", fontWeight: "800" },

  priceRow:       { flexDirection: "row", gap: 8, marginBottom: 10 },
  priceChip:      { flex: 1, backgroundColor: "#F9FAFB", borderRadius: 10, paddingVertical: 8, alignItems: "center", borderWidth: 1, borderColor: "#F3F4F6" },
  priceChipLabel: { fontSize: 9, color: "#9CA3AF", fontWeight: "700", textTransform: "uppercase" },
  priceChipValue: { fontSize: 14, color: "#111827", fontWeight: "800", marginTop: 2 },

  ownerRow:  { flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 12, flexWrap: "wrap" },
  ownerText: { fontSize: 12, color: "#6B7280", fontWeight: "500" },
  ownerDot:  { color: "#D1D5DB", fontSize: 14 },

  cardActions:    { flexDirection: "row", gap: 8 },
  editBtn:        { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: DARK, paddingVertical: 10, borderRadius: 12 },
  editBtnText:    { color: "#FFFFFF", fontSize: 13, fontWeight: "700" },
  toggleBtn:      { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, borderRadius: 12, borderWidth: 1 },
  toggleBtnPause: { backgroundColor: "#FFFBEB", borderColor: "#FDE68A" },
  toggleBtnLive:  { backgroundColor: "#F0FDFA", borderColor: "#99F6E4" },
  toggleBtnText:  { fontSize: 13, fontWeight: "700" },
  deleteBtn:      { width: 40, height: 40, borderRadius: 12, backgroundColor: "#FEF2F2", justifyContent: "center", alignItems: "center", borderWidth: 1, borderColor: "#FECACA" },

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
  imageInputRow: { flexDirection: "row", gap: 10 },
  imageAddBtn:   { width: 46, height: 46, backgroundColor: DARK, borderRadius: 12, justifyContent: "center", alignItems: "center" },
  imageRow:      { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "#F9FAFB", borderRadius: 10, padding: 10, marginTop: 6, borderWidth: 1, borderColor: "#E5E7EB" },
  imageRowText:  { flex: 1, fontSize: 12, color: "#6B7280", marginRight: 8 },
  ownerChip:          { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: "#F3F4F6", marginRight: 8, borderWidth: 1, borderColor: "#E5E7EB" },
  ownerChipActive:    { backgroundColor: DARK, borderColor: DARK },
  ownerChipText:      { fontSize: 13, fontWeight: "600", color: "#374151" },
  ownerChipTextActive:{ color: "#FFFFFF" },
  toggleRow:    { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: "#F9FAFB", borderRadius: 14, padding: 14, marginTop: 16, borderWidth: 1, borderColor: "#E5E7EB" },
  toggleLabel:  { fontSize: 15, fontWeight: "700", color: "#111827" },
  toggleSub:    { fontSize: 12, color: "#9CA3AF", marginTop: 2 },
  saveBtn:      { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: DARK, paddingVertical: 15, borderRadius: 16, marginTop: 24 },
  saveBtnText:  { color: "#FFFFFF", fontWeight: "800", fontSize: 15 },
  cancelBtn:    { backgroundColor: "#F3F4F6", paddingVertical: 15, borderRadius: 16, alignItems: "center", marginTop: 10 },
  cancelBtnText:{ color: "#374151", fontWeight: "700", fontSize: 15 },

  // ✅ GPS coords section
  coordsSection:       { backgroundColor: "#F0FDF4", borderRadius: 14, padding: 14, marginTop: 16, borderWidth: 1, borderColor: "#BBF7D0" },
  coordsSectionHeader: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 },
  coordsSectionTitle:  { fontSize: 14, fontWeight: "800", color: "#15803D" },
  coordsSectionSub:    { fontSize: 12, color: "#166534", lineHeight: 18, marginBottom: 12 },

  // ✅ Primary map picker button — big, teal, prominent
  mapPickerBtn:     { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: ACCENT, paddingVertical: 14, paddingHorizontal: 16, borderRadius: 12, marginBottom: 10 },
  mapPickerBtnText: { color: "#fff", fontWeight: "800", fontSize: 14, flex: 1 },
  coordsPill:       { backgroundColor: "rgba(255,255,255,0.25)", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  coordsPillText:   { fontSize: 10, color: "#fff", fontWeight: "700" },

  // Secondary auto-geocode button — outline style
  geocodeBtn:     { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1.5, borderColor: ACCENT, paddingVertical: 11, paddingHorizontal: 14, borderRadius: 10, marginBottom: 10 },
  geocodeBtnText: { color: ACCENT, fontWeight: "700", fontSize: 13, flex: 1 },

  latLngRow: { flexDirection: "row" },

  // new rating
  ratingBadge:     { alignSelf: "flex-start", backgroundColor: "#111111", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 99, marginTop: 4 },
ratingBadgeText: { fontSize: 11, fontWeight: "800", color: "#FACC15" },
venueChip:          { alignItems: "center", paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, backgroundColor: "#F3F4F6", borderWidth: 1.5, borderColor: "#E5E7EB", minWidth: 80 },
venueChipActive:    { backgroundColor: DARK, borderColor: DARK },
venueChipEmoji:     { fontSize: 18, textAlign: "center" },
venueChipLabel:     { fontSize: 10, fontWeight: "700", color: "#6B7280", marginTop: 4, textAlign: "center" },
venueChipLabelActive:{ color: "#fff" },
venuePreview:       { backgroundColor: "#F0FDF4", borderRadius: 8, padding: 8, marginTop: 6, borderWidth: 1, borderColor: "#86EFAC" },
venuePreviewText:   { fontSize: 12, color: "#15803D", fontWeight: "700" },
});
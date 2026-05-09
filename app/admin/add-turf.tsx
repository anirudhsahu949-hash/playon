import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  FlatList,
  ScrollView,
  SafeAreaView,
  StatusBar,
  ActivityIndicator,
  Platform,
  Switch,
} from "react-native";
import { useState, useEffect } from "react";
import { db } from "../../firebaseConfig";
import {
  collection,
  addDoc,
  getDocs,
  query,
  where,
  serverTimestamp,
} from "firebase/firestore";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";

// ── Config ────────────────────────────────────────────────────────────────────
const SERVER_URL = "https://your-server.com"; // ← your actual server URL
const DARK = "#081120";
const ACCENT = "#0EA5A4";

// ── Facilities list ───────────────────────────────────────────────────────────
const ALL_FACILITIES = [
  { label: "Parking",          icon: "🅿️" },
  { label: "Bike Parking",     icon: "🏍️" },
  { label: "Washroom",         icon: "🚻" },
  { label: "Changing Room",    icon: "👕" },
  { label: "Flood Lights",     icon: "💡" },
  { label: "Drinking Water",   icon: "💧" },
  { label: "Cafeteria",        icon: "☕" },
  { label: "First Aid",        icon: "🏥" },
  { label: "Locker Room",      icon: "🔐" },
  { label: "Seating Area",     icon: "🪑" },
  { label: "WiFi",             icon: "📶" },
  { label: "CCTV",             icon: "📹" },
  { label: "Spectator Stand",  icon: "🏟️" },
  { label: "Equipment Rental", icon: "🎽" },
];

// ── Sport list ────────────────────────────────────────────────────────────────
const SPORTS = ["Football", "Cricket", "Badminton", "Basketball", "Tennis", "Volleyball", "Kabaddi", "Hockey", "Other"];

// ── Types ─────────────────────────────────────────────────────────────────────
type Owner = { id: string; name?: string; email?: string; businessName?: string; phone?: string };

// ── Section header component ──────────────────────────────────────────────────
function SectionHeader({ number, title, subtitle }: { number: string; title: string; subtitle: string }) {
  return (
    <View style={styles.sectionHeader}>
      <View style={styles.sectionNum}>
        <Text style={styles.sectionNumText}>{number}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.sectionTitle}>{title}</Text>
        <Text style={styles.sectionSub}>{subtitle}</Text>
      </View>
    </View>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function AddTurf() {
  const router = useRouter();

  // Loading states
  const [loadingOwners, setLoadingOwners] = useState(true);
  const [loadingOperators, setLoadingOperators] = useState(false);
  const [saving, setSaving] = useState(false);

  // ── Section 1: Turf details ─────────────────────────────────────────────────
  const [name, setName]               = useState("");
  const [location, setLocation]       = useState("");
  const [sports, setSports] = useState<string[]>([]);
  
  const [mapLink, setMapLink]         = useState("");
  const [dayPrice, setDayPrice]       = useState("");
  const [nightPrice, setNightPrice]   = useState("");
  const [bookingPrice, setBookingPrice] = useState("");
  const [openingTime, setOpeningTime] = useState("6");
  const [closingTime, setClosingTime] = useState("23");
  const [slotDuration, setSlotDuration] = useState("60");

  // ── Section 2: Facilities ───────────────────────────────────────────────────
  const [selectedFacilities, setSelectedFacilities] = useState<string[]>([]);

  // ── Section 3: Images ───────────────────────────────────────────────────────
  const [imageInput, setImageInput]   = useState("");
  const [images, setImages]           = useState<string[]>([]);
  const [coverImage, setCoverImage]   = useState("");

  // ── Section 4: Owner ────────────────────────────────────────────────────────
  const [owners, setOwners]               = useState<Owner[]>([]);
  const [selectedOwner, setSelectedOwner] = useState<Owner | null>(null);
  const [ownerMode, setOwnerMode]         = useState<"existing" | "new">("existing");
  const [ownerSearch, setOwnerSearch]     = useState("");

  // New owner fields
  const [ownerName, setOwnerName]             = useState("");
  const [ownerEmail, setOwnerEmail]           = useState("");
  const [ownerPassword, setOwnerPassword]     = useState("");
  const [ownerPhone, setOwnerPhone]           = useState("");
  const [ownerLocation, setOwnerLocation]     = useState("");
  const [ownerBusiness, setOwnerBusiness]     = useState("");
  const [showPassword, setShowPassword]       = useState(false);

  // ── Section 5: Operator ─────────────────────────────────────────────────────
  const [addOperator, setAddOperator]         = useState(false);
  const [operators, setOperators]             = useState<Owner[]>([]);
  const [selectedOperator, setSelectedOperator] = useState<Owner | null>(null);
  const [operatorMode, setOperatorMode]       = useState<"existing" | "new">("existing");
  const [operatorSearch, setOperatorSearch]   = useState("");

  // New operator fields
  const [opName, setOpName]           = useState("");
  const [opEmail, setOpEmail]         = useState("");
  const [opPassword, setOpPassword]   = useState("");
  const [opPhone, setOpPhone]         = useState("");
  const [showOpPassword, setShowOpPassword] = useState(false);

  // ── Fetch on mount ──────────────────────────────────────────────────────────
  useEffect(() => { fetchOwners(); }, []);

  useEffect(() => {
    if (addOperator) fetchOperators();
  }, [addOperator]);

  const fetchOwners = async () => {
    try {
      setLoadingOwners(true);
      const snap = await getDocs(query(collection(db, "users"), where("role", "==", "owner")));
      setOwners(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Owner)));
    } catch {
      Alert.alert("Error", "Unable to load owners.");
    } finally {
      setLoadingOwners(false);
    }
  };

  const fetchOperators = async () => {
    try {
      setLoadingOperators(true);
      const snap = await getDocs(query(collection(db, "users"), where("role", "==", "turf-operator")));
      setOperators(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Owner)));
    } catch {
      Alert.alert("Error", "Unable to load operators.");
    } finally {
      setLoadingOperators(false);
    }
  };

  // ── Helpers ─────────────────────────────────────────────────────────────────
  const toggleFacility = (label: string) => {
    setSelectedFacilities((prev) =>
      prev.includes(label) ? prev.filter((f) => f !== label) : [...prev, label]
    );
  };

  const addImage = () => {
    if (!imageInput.trim()) return;
    setImages((prev) => [...prev, imageInput.trim()]);
    setImageInput("");
  };

  const removeImage = (index: number) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
  };

  const filteredOwners = owners.filter((o) => {
    const q = ownerSearch.toLowerCase();
    return !q || (o.name || "").toLowerCase().includes(q) || (o.email || "").toLowerCase().includes(q);
  });

  const filteredOperators = operators.filter((o) => {
    const q = operatorSearch.toLowerCase();
    return !q || (o.name || "").toLowerCase().includes(q) || (o.email || "").toLowerCase().includes(q);
  });

  // ── Reset ────────────────────────────────────────────────────────────────────
  const resetForm = () => {
    setName(""); setLocation(""); setSports([]); setMapLink("");
    setDayPrice(""); setNightPrice(""); setBookingPrice("");
    setOpeningTime("6"); setClosingTime("23"); setSlotDuration("60");
    setSelectedFacilities([]);
    setImageInput(""); setImages([]); setCoverImage("");
    setSelectedOwner(null); setOwnerMode("existing"); setOwnerSearch("");
    setOwnerName(""); setOwnerEmail(""); setOwnerPassword(""); setOwnerPhone(""); setOwnerLocation(""); setOwnerBusiness("");
    setAddOperator(false); setSelectedOperator(null); setOperatorMode("existing"); setOperatorSearch("");
    setOpName(""); setOpEmail(""); setOpPassword(""); setOpPhone("");
  };

  // ── Validate ─────────────────────────────────────────────────────────────────
  const validate = (): string | null => {
    if (!name.trim())     return "Turf name is required.";
    if (!location.trim()) return "Location is required.";
    if (sports.length === 0)
  return "Select at least one sport.";
    if (!dayPrice.trim() || Number(dayPrice) <= 0)   return "Enter a valid day price.";
    if (!nightPrice.trim() || Number(nightPrice) <= 0) return "Enter a valid night price.";
    if (!bookingPrice.trim() || Number(bookingPrice) <= 0) return "Enter a valid advance booking price.";
    if (Number(bookingPrice) > Number(dayPrice) && Number(bookingPrice) > Number(nightPrice))
      return "Advance booking price cannot exceed the slot price.";
    if (Number(openingTime) < 0 || Number(openingTime) > 23) return "Opening time must be 0–23.";
    if (Number(closingTime) < 1 || Number(closingTime) > 24) return "Closing time must be 1–24.";
    if (Number(closingTime) <= Number(openingTime)) return "Closing time must be after opening time.";
    if (Number(slotDuration) <= 0) return "Enter a valid slot duration.";

    if (ownerMode === "existing" && !selectedOwner) return "Please select an owner.";
    if (ownerMode === "new") {
      if (!ownerName.trim())     return "Owner name is required.";
      if (!ownerEmail.trim() || !ownerEmail.includes("@")) return "Valid owner email is required.";
      if (ownerPassword.length < 6) return "Owner password must be at least 6 characters.";
      if (!ownerPhone.trim())    return "Owner phone is required.";
      if (!ownerBusiness.trim()) return "Business name is required.";
    }

    if (addOperator) {
      if (operatorMode === "existing" && !selectedOperator) return "Please select an operator or turn off the operator toggle.";
      if (operatorMode === "new") {
        if (!opName.trim())  return "Operator name is required.";
        if (!opEmail.trim() || !opEmail.includes("@")) return "Valid operator email is required.";
        if (opPassword.length < 6) return "Operator password must be at least 6 characters.";
        if (!opPhone.trim()) return "Operator phone is required.";
      }
    }

    return null;
  };
  // new function sport multiple//
  const toggleSport = (selectedSport: string) => {
  setSports((prev) =>
    prev.includes(selectedSport)
      ? prev.filter((s) => s !== selectedSport)
      : [...prev, selectedSport]
  );
};

  // ── Create owner via server (Firebase Auth + Firestore) ───────────────────
  const createOwnerViaServer = async (): Promise<Owner> => {
    const res = await fetch(`${SERVER_URL}/create-owner`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: ownerName.trim(),
        email: ownerEmail.trim().toLowerCase(),
        password: ownerPassword,
        phone: ownerPhone.trim(),
        businessName: ownerBusiness.trim(),
        location: ownerLocation.trim(),
        role: "owner",
        status: "active",
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to create owner account");
    return { id: data.uid, name: ownerName.trim(), email: ownerEmail.trim().toLowerCase() };
  };

  // ── Create operator via server ─────────────────────────────────────────────
  const createOperatorViaServer = async (ownerId: string): Promise<Owner> => {
    const res = await fetch(`${SERVER_URL}/create-operator`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: opName.trim(),
        email: opEmail.trim().toLowerCase(),
        password: opPassword,
        phone: opPhone.trim(),
        role: "turf-operator",
        ownerId,
        status: "active",
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to create operator account");
    return { id: data.uid, name: opName.trim(), email: opEmail.trim().toLowerCase() };
  };

  // ── Submit ────────────────────────────────────────────────────────────────
  const handleAdd = async () => {
    const err = validate();
    if (err) return Alert.alert("Incomplete", err);

    try {
      setSaving(true);

      // 1. Resolve owner
      let owner: Owner;
      if (ownerMode === "new") {
        owner = await createOwnerViaServer();
        Alert.alert(
          "Owner Account Created ✓",
          `${ownerName} can now log in:\n\nEmail: ${ownerEmail}\nPassword: ${ownerPassword}`,
        );
      } else {
        owner = selectedOwner!;
      }

      // 2. Resolve operator (optional)
      let operatorId = "";
      let operatorName = "";
      let operatorEmail = "";

      if (addOperator) {
        let op: Owner;
        if (operatorMode === "new") {
          op = await createOperatorViaServer(owner.id);
          Alert.alert(
            "Operator Account Created ✓",
            `${opName} can now log in:\n\nEmail: ${opEmail}\nPassword: ${opPassword}`,
          );
        } else {
          op = selectedOperator!;
        }
        operatorId    = op.id;
        operatorName  = op.name || "";
        operatorEmail = op.email || "";
      }

      // 3. Create turf
      await addDoc(collection(db, "turfs"), {
        name:          name.trim(),
        location:      location.trim(),
        sports,
        mapLink:       mapLink.trim(),
        dayPrice:      Number(dayPrice),
        nightPrice:    Number(nightPrice),
        bookingPrice:  Number(bookingPrice),
        price:         Number(dayPrice),
        openingTime:   Number(openingTime),
        closingTime:   Number(closingTime),
        slotDuration:  Number(slotDuration),
        image:         coverImage.trim() || images[0] || "",
        images,
        facilities:    selectedFacilities,
        ownerId:       owner.id,
        ownerName:     owner.name || "",
        ownerEmail:    owner.email || "",
        operatorId,
        operatorName,
        operatorEmail,
        active:        true,
        createdAt:     serverTimestamp(),
      });

      Alert.alert("Turf Added ✓", `"${name}" has been published on the platform.`);
      await fetchOwners();
      resetForm();
    } catch (e: any) {
      Alert.alert("Error", e.message || "Unable to add turf. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={DARK} />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── Hero ── */}
        <View style={styles.hero}>
          <View style={styles.glow1} />
          <View style={styles.glow2} />
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={20} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.heroTag}>Admin · Add Turf</Text>
          <Text style={styles.heroTitle}>New Turf</Text>
          <Text style={styles.heroSub}>Fill in turf details, assign an owner, optionally assign an operator, and go live.</Text>
        </View>

        {/* ════════════════════════════════════════════════════════
            SECTION 1 — TURF DETAILS
        ════════════════════════════════════════════════════════ */}
        <View style={styles.card}>
          <SectionHeader number="1" title="Turf Details" subtitle="Basic info about the turf" />

          <Field label="Turf Name *">
            <TextInput style={styles.input} placeholder="e.g. Green Arena" placeholderTextColor="#9CA3AF"
              value={name} onChangeText={setName} />
          </Field>

          <Field label="Location *">
            <TextInput style={styles.input} placeholder="Area, City" placeholderTextColor="#9CA3AF"
              value={location} onChangeText={setLocation} />
          </Field>

          {/* Sport chips */}
          <Field label="Sport *">
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
              {SPORTS.map((s) => {
  const active = sports.includes(s);

  return (
    <TouchableOpacity
      key={s}
      style={[styles.chip, active && styles.chipActive]}
      onPress={() => toggleSport(s)}
    >
      <Text
        style={[
          styles.chipText,
          active && styles.chipTextActive,
        ]}
      >
        {s}
      </Text>
    </TouchableOpacity>
  );
})}
            </ScrollView>
            {/* Fallback text input if "Other" */}
           {/* Custom sport input if "Other" selected */}
{sports.includes("Other") && (
  <TextInput
    style={[styles.input, { marginTop: 10 }]}
    placeholder="Enter custom sport name"
    placeholderTextColor="#9CA3AF"
    value=""
    onChangeText={(text) => {
      if (text.trim().length > 0) {
        setSports((prev) => {
          const filtered = prev.filter((s) => s !== "Other");
          return [...filtered, text];
        });
      }
    }}
  />
)}
          </Field>

          <Field label="Google Maps Link">
            <TextInput style={styles.input} placeholder="https://maps.google.com/..." placeholderTextColor="#9CA3AF"
              value={mapLink} onChangeText={setMapLink} autoCapitalize="none" />
          </Field>

          {/* Pricing row */}
          <Field label="Pricing *">
            <View style={styles.priceRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.priceLabel}>Day (6AM–6PM)</Text>
                <TextInput style={styles.input} placeholder="₹/hr" placeholderTextColor="#9CA3AF"
                  keyboardType="numeric" value={dayPrice} onChangeText={setDayPrice} />
              </View>
              <View style={{ width: 12 }} />
              <View style={{ flex: 1 }}>
                <Text style={styles.priceLabel}>Night (6PM–6AM)</Text>
                <TextInput style={styles.input} placeholder="₹/hr" placeholderTextColor="#9CA3AF"
                  keyboardType="numeric" value={nightPrice} onChangeText={setNightPrice} />
              </View>
            </View>
            <Text style={styles.priceLabel}>Advance Booking Amount</Text>
            <TextInput style={styles.input} placeholder="Amount user pays online to lock the slot"
              placeholderTextColor="#9CA3AF" keyboardType="numeric"
              value={bookingPrice} onChangeText={setBookingPrice} />
            <Text style={styles.hint}>This is the advance the user pays via Razorpay. Rest is collected at venue.</Text>
          </Field>

          {/* Timings row */}
          <Field label="Timings *">
            <View style={styles.priceRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.priceLabel}>Opening Hour (0–23)</Text>
                <TextInput style={styles.input} placeholder="6" placeholderTextColor="#9CA3AF"
                  keyboardType="numeric" value={openingTime} onChangeText={setOpeningTime} />
              </View>
              <View style={{ width: 12 }} />
              <View style={{ flex: 1 }}>
                <Text style={styles.priceLabel}>Closing Hour (1–24)</Text>
                <TextInput style={styles.input} placeholder="23" placeholderTextColor="#9CA3AF"
                  keyboardType="numeric" value={closingTime} onChangeText={setClosingTime} />
              </View>
            </View>
            <Text style={styles.priceLabel}>Slot Duration (minutes)</Text>
            <View style={styles.chipRow}>
              {["30", "60", "90", "120"].map((d) => (
                <TouchableOpacity key={d}
                  style={[styles.chip, slotDuration === d && styles.chipActive]}
                  onPress={() => setSlotDuration(d)}>
                  <Text style={[styles.chipText, slotDuration === d && styles.chipTextActive]}>{d} min</Text>
                </TouchableOpacity>
              ))}
            </View>
          </Field>
        </View>

        {/* ════════════════════════════════════════════════════════
            SECTION 2 — FACILITIES
        ════════════════════════════════════════════════════════ */}
        <View style={styles.card}>
          <SectionHeader number="2" title="Facilities" subtitle="Tap to select what's available at this turf" />
          {selectedFacilities.length > 0 && (
            <View style={styles.selectedFacRow}>
              <Text style={styles.selectedFacText}>{selectedFacilities.length} selected</Text>
              <TouchableOpacity onPress={() => setSelectedFacilities([])}>
                <Text style={styles.clearText}>Clear all</Text>
              </TouchableOpacity>
            </View>
          )}
          <View style={styles.facilityGrid}>
            {ALL_FACILITIES.map((f) => {
              const active = selectedFacilities.includes(f.label);
              return (
                <TouchableOpacity
                  key={f.label}
                  style={[styles.facilityBtn, active && styles.facilityBtnActive]}
                  onPress={() => toggleFacility(f.label)}
                  activeOpacity={0.75}
                >
                  <Text style={styles.facilityIcon}>{f.icon}</Text>
                  <Text style={[styles.facilityLabel, active && styles.facilityLabelActive]}>{f.label}</Text>
                  {active && (
                    <View style={styles.facilityCheck}>
                      <Ionicons name="checkmark" size={10} color="#fff" />
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* ════════════════════════════════════════════════════════
            SECTION 3 — IMAGES
        ════════════════════════════════════════════════════════ */}
        <View style={styles.card}>
          <SectionHeader number="3" title="Images" subtitle="Cover image + gallery" />

          <Field label="Cover Image URL">
            <TextInput style={styles.input} placeholder="Main image URL (shown on card)"
              placeholderTextColor="#9CA3AF" value={coverImage} onChangeText={setCoverImage} autoCapitalize="none" />
          </Field>

          <Field label="Gallery Images">
            <View style={styles.imageRow}>
              <TextInput style={[styles.input, { flex: 1 }]} placeholder="Paste image URL"
                placeholderTextColor="#9CA3AF" value={imageInput} onChangeText={setImageInput} autoCapitalize="none" />
              <TouchableOpacity style={styles.addImgBtn} onPress={addImage}>
                <Ionicons name="add" size={22} color="#fff" />
              </TouchableOpacity>
            </View>
            {images.length > 0 && (
              <View style={{ marginTop: 12, gap: 8 }}>
                {images.map((img, i) => (
                  <View key={i} style={styles.imageTag}>
                    <Text style={styles.imageTagText} numberOfLines={1}>📷 Image {i + 1}</Text>
                    <TouchableOpacity onPress={() => removeImage(i)}>
                      <Ionicons name="close-circle" size={18} color="#DC2626" />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}
          </Field>
        </View>

        {/* ════════════════════════════════════════════════════════
            SECTION 4 — OWNER
        ════════════════════════════════════════════════════════ */}
        <View style={styles.card}>
          <SectionHeader number="4" title="Owner" subtitle="Assign turf to an existing owner or create a new one" />

          {/* Mode toggle */}
          <View style={styles.modeRow}>
            {(["existing", "new"] as const).map((m) => (
              <TouchableOpacity key={m}
                style={[styles.modeBtn, ownerMode === m && styles.modeBtnActive]}
                onPress={() => setOwnerMode(m)}>
                <Ionicons
                  name={m === "existing" ? "people-outline" : "person-add-outline"}
                  size={14} color={ownerMode === m ? "#fff" : "#6B7280"}
                  style={{ marginRight: 6 }} />
                <Text style={[styles.modeBtnText, ownerMode === m && styles.modeBtnTextActive]}>
                  {m === "existing" ? "Existing Owner" : "Create New Owner"}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {ownerMode === "existing" ? (
            <>
              <TextInput style={[styles.input, { marginBottom: 10 }]} placeholder="🔍  Search by name or email"
                placeholderTextColor="#9CA3AF" value={ownerSearch} onChangeText={setOwnerSearch} />
              {loadingOwners ? (
                <View style={styles.loaderRow}><ActivityIndicator color={ACCENT} /><Text style={styles.loaderText}>Loading owners...</Text></View>
              ) : filteredOwners.length === 0 ? (
                <View style={styles.emptyBox}>
                  <Ionicons name="people-outline" size={28} color="#D1D5DB" />
                  <Text style={styles.emptyText}>No owners found. Create one instead.</Text>
                </View>
              ) : (
                <View style={styles.ownerList}>
                  {filteredOwners.map((o) => {
                    const selected = selectedOwner?.id === o.id;
                    return (
                      <TouchableOpacity key={o.id}
                        style={[styles.ownerCard, selected && styles.ownerCardSelected]}
                        onPress={() => setSelectedOwner(o)} activeOpacity={0.8}>
                        <View style={[styles.ownerAvatar, selected && { backgroundColor: "#fff" }]}>
                          <Text style={[styles.ownerAvatarText, selected && { color: DARK }]}>
                            {(o.name || "?")[0].toUpperCase()}
                          </Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.ownerName, selected && styles.ownerNameSelected]}>{o.name || "No name"}</Text>
                          <Text style={[styles.ownerMeta, selected && styles.ownerMetaSelected]}>{o.email}</Text>
                          {o.phone ? <Text style={[styles.ownerMeta, selected && styles.ownerMetaSelected]}>{o.phone}</Text> : null}
                        </View>
                        {selected && <Ionicons name="checkmark-circle" size={20} color="#4ADE80" />}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}
            </>
          ) : (
            <>
              <View style={styles.newOwnerBanner}>
                <Ionicons name="information-circle-outline" size={16} color="#3B82F6" />
                <Text style={styles.newOwnerBannerText}>
                  A Firebase login account will be created. Share the credentials with the owner.
                </Text>
              </View>

              <Field label="Full Name *">
                <TextInput style={styles.input} placeholder="Owner's full name" placeholderTextColor="#9CA3AF"
                  value={ownerName} onChangeText={setOwnerName} />
              </Field>
              <Field label="Business Name *">
                <TextInput style={styles.input} placeholder="e.g. Sports Arena Pvt Ltd" placeholderTextColor="#9CA3AF"
                  value={ownerBusiness} onChangeText={setOwnerBusiness} />
              </Field>
              <Field label="Email *">
                <TextInput style={styles.input} placeholder="owner@email.com" placeholderTextColor="#9CA3AF"
                  value={ownerEmail} onChangeText={setOwnerEmail} keyboardType="email-address" autoCapitalize="none" />
              </Field>
              <Field label="Temporary Password *">
                <View style={styles.pwRow}>
                  <TextInput style={[styles.input, { flex: 1 }]} placeholder="Min. 6 characters"
                    placeholderTextColor="#9CA3AF" value={ownerPassword} onChangeText={setOwnerPassword}
                    secureTextEntry={!showPassword} autoCapitalize="none" />
                  <TouchableOpacity style={styles.eyeBtn} onPress={() => setShowPassword((p) => !p)}>
                    <Ionicons name={showPassword ? "eye-off-outline" : "eye-outline"} size={18} color="#6B7280" />
                  </TouchableOpacity>
                </View>
                <Text style={styles.hint}>Share this with the owner so they can log in and change it.</Text>
              </Field>
              <Field label="Phone *">
                <TextInput style={styles.input} placeholder="10-digit mobile number" placeholderTextColor="#9CA3AF"
                  value={ownerPhone} onChangeText={setOwnerPhone} keyboardType="phone-pad" />
              </Field>
              <Field label="Location">
                <TextInput style={styles.input} placeholder="City or area" placeholderTextColor="#9CA3AF"
                  value={ownerLocation} onChangeText={setOwnerLocation} />
              </Field>
            </>
          )}
        </View>

        {/* ════════════════════════════════════════════════════════
            SECTION 5 — OPERATOR (optional)
        ════════════════════════════════════════════════════════ */}
        <View style={styles.card}>
          <View style={styles.operatorToggleRow}>
            <View style={{ flex: 1 }}>
              <SectionHeader number="5" title="Turf Operator" subtitle="Person present at turf to manage daily ops" />
            </View>
            <Switch
              value={addOperator}
              onValueChange={setAddOperator}
              trackColor={{ false: "#E5E7EB", true: ACCENT }}
              thumbColor="#fff"
            />
          </View>

          {addOperator && (
            <>
              <View style={styles.modeRow}>
                {(["existing", "new"] as const).map((m) => (
                  <TouchableOpacity key={m}
                    style={[styles.modeBtn, operatorMode === m && styles.modeBtnActive]}
                    onPress={() => setOperatorMode(m)}>
                    <Ionicons
                      name={m === "existing" ? "people-outline" : "person-add-outline"}
                      size={14} color={operatorMode === m ? "#fff" : "#6B7280"}
                      style={{ marginRight: 6 }} />
                    <Text style={[styles.modeBtnText, operatorMode === m && styles.modeBtnTextActive]}>
                      {m === "existing" ? "Existing Operator" : "Create New Operator"}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {operatorMode === "existing" ? (
                <>
                  <TextInput style={[styles.input, { marginBottom: 10 }]} placeholder="🔍  Search operators"
                    placeholderTextColor="#9CA3AF" value={operatorSearch} onChangeText={setOperatorSearch} />
                  {loadingOperators ? (
                    <View style={styles.loaderRow}><ActivityIndicator color={ACCENT} /><Text style={styles.loaderText}>Loading operators...</Text></View>
                  ) : filteredOperators.length === 0 ? (
                    <View style={styles.emptyBox}>
                      <Ionicons name="person-outline" size={28} color="#D1D5DB" />
                      <Text style={styles.emptyText}>No operators found. Create one.</Text>
                    </View>
                  ) : (
                    <View style={styles.ownerList}>
                      {filteredOperators.map((o) => {
                        const sel = selectedOperator?.id === o.id;
                        return (
                          <TouchableOpacity key={o.id}
                            style={[styles.ownerCard, sel && styles.ownerCardSelected]}
                            onPress={() => setSelectedOperator(o)} activeOpacity={0.8}>
                            <View style={[styles.ownerAvatar, sel && { backgroundColor: "#fff" }]}>
                              <Text style={[styles.ownerAvatarText, sel && { color: DARK }]}>
                                {(o.name || "?")[0].toUpperCase()}
                              </Text>
                            </View>
                            <View style={{ flex: 1 }}>
                              <Text style={[styles.ownerName, sel && styles.ownerNameSelected]}>{o.name}</Text>
                              <Text style={[styles.ownerMeta, sel && styles.ownerMetaSelected]}>{o.email}</Text>
                            </View>
                            {sel && <Ionicons name="checkmark-circle" size={20} color="#4ADE80" />}
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  )}
                </>
              ) : (
                <>
                  <View style={styles.newOwnerBanner}>
                    <Ionicons name="information-circle-outline" size={16} color="#3B82F6" />
                    <Text style={styles.newOwnerBannerText}>
                      A login account will be created for the operator.
                    </Text>
                  </View>
                  <Field label="Operator Name *">
                    <TextInput style={styles.input} placeholder="Operator's full name" placeholderTextColor="#9CA3AF"
                      value={opName} onChangeText={setOpName} />
                  </Field>
                  <Field label="Email *">
                    <TextInput style={styles.input} placeholder="operator@email.com" placeholderTextColor="#9CA3AF"
                      value={opEmail} onChangeText={setOpEmail} keyboardType="email-address" autoCapitalize="none" />
                  </Field>
                  <Field label="Temporary Password *">
                    <View style={styles.pwRow}>
                      <TextInput style={[styles.input, { flex: 1 }]} placeholder="Min. 6 characters"
                        placeholderTextColor="#9CA3AF" value={opPassword} onChangeText={setOpPassword}
                        secureTextEntry={!showOpPassword} autoCapitalize="none" />
                      <TouchableOpacity style={styles.eyeBtn} onPress={() => setShowOpPassword((p) => !p)}>
                        <Ionicons name={showOpPassword ? "eye-off-outline" : "eye-outline"} size={18} color="#6B7280" />
                      </TouchableOpacity>
                    </View>
                  </Field>
                  <Field label="Phone *">
                    <TextInput style={styles.input} placeholder="10-digit mobile number" placeholderTextColor="#9CA3AF"
                      value={opPhone} onChangeText={setOpPhone} keyboardType="phone-pad" />
                  </Field>
                </>
              )}
            </>
          )}

          {!addOperator && (
            <View style={styles.operatorOffBox}>
              <Ionicons name="person-remove-outline" size={20} color="#9CA3AF" />
              <Text style={styles.operatorOffText}>No operator assigned. You can add one later from the turf settings.</Text>
            </View>
          )}
        </View>

        {/* ── Submit ── */}
        <TouchableOpacity style={[styles.submitBtn, saving && { opacity: 0.65 }]} onPress={handleAdd} disabled={saving} activeOpacity={0.85}>
          {saving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Ionicons name="add-circle-outline" size={20} color="#fff" style={{ marginRight: 8 }} />
              <Text style={styles.submitText}>Add Turf</Text>
            </>
          )}
        </TouchableOpacity>

        <View style={{ height: 48 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Small helper component ────────────────────────────────────────────────────
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ marginTop: 14 }}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: "#F0F4F8" },
  scroll: { paddingBottom: 24 },

  // Hero
  hero: {
    backgroundColor: DARK,
    paddingHorizontal: 20,
    paddingTop: Platform.OS === "android" ? (StatusBar.currentHeight || 0) + 14 : 20,
    paddingBottom: 28,
    overflow: "hidden",
  },
  glow1: { position: "absolute", top: -40, right: -30, width: 180, height: 180, borderRadius: 90, backgroundColor: "rgba(14,165,164,0.15)" },
  glow2: { position: "absolute", bottom: -60, left: -40, width: 160, height: 160, borderRadius: 80, backgroundColor: "rgba(99,102,241,0.12)" },
  backBtn: { width: 36, height: 36, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.1)", justifyContent: "center", alignItems: "center", marginBottom: 14 },
  heroTag:   { color: "#9CA3AF", fontSize: 11, fontWeight: "800", letterSpacing: 1.2, textTransform: "uppercase" },
  heroTitle: { color: "#FFFFFF", fontSize: 28, fontWeight: "900", marginTop: 4 },
  heroSub:   { color: "#9CA3AF", fontSize: 13, lineHeight: 20, marginTop: 6 },

  // Card
  card: {
    backgroundColor: "#FFFFFF",
    marginHorizontal: 16, marginTop: 16,
    borderRadius: 20, padding: 18,
    borderWidth: 1, borderColor: "#E5E7EB",
    shadowColor: "#000", shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04, shadowRadius: 6, elevation: 2,
  },

  // Section header
  sectionHeader: { flexDirection: "row", alignItems: "flex-start", marginBottom: 16 },
  sectionNum: { width: 28, height: 28, borderRadius: 8, backgroundColor: DARK, justifyContent: "center", alignItems: "center", marginRight: 12, marginTop: 2 },
  sectionNumText: { color: "#fff", fontSize: 13, fontWeight: "900" },
  sectionTitle: { fontSize: 17, fontWeight: "900", color: "#111827" },
  sectionSub:   { fontSize: 12, color: "#9CA3AF", marginTop: 2, fontWeight: "500" },

  // Fields
  fieldLabel: { fontSize: 11, fontWeight: "800", color: "#6B7280", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 7 },
  input: { backgroundColor: "#F9FAFB", borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13, fontSize: 14, color: "#111827" },
  hint:  { fontSize: 11, color: "#9CA3AF", marginTop: 5, fontWeight: "500" },

  // Chips (sport / slot duration)
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingVertical: 4 },
  chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20, backgroundColor: "#F3F4F6", borderWidth: 1, borderColor: "#E5E7EB" },
  chipActive: { backgroundColor: DARK, borderColor: DARK },
  chipText: { fontSize: 13, fontWeight: "700", color: "#6B7280" },
  chipTextActive: { color: "#fff" },

  // Pricing
  priceRow:  { flexDirection: "row", marginBottom: 12 },
  priceLabel: { fontSize: 11, fontWeight: "700", color: "#9CA3AF", marginBottom: 6 },

  // Images
  imageRow:   { flexDirection: "row", gap: 10, alignItems: "center" },
  addImgBtn:  { backgroundColor: DARK, width: 46, height: 46, borderRadius: 12, justifyContent: "center", alignItems: "center" },
  imageTag:   { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "#F3F4F6", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
  imageTagText: { fontSize: 13, color: "#374151", fontWeight: "600", flex: 1, marginRight: 8 },

  // Facilities
  selectedFacRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  selectedFacText: { fontSize: 13, fontWeight: "700", color: ACCENT },
  clearText: { fontSize: 12, color: "#DC2626", fontWeight: "700" },
  facilityGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  facilityBtn: {
    width: "30%", alignItems: "center", paddingVertical: 14,
    backgroundColor: "#F9FAFB", borderRadius: 14, borderWidth: 1.5, borderColor: "#E5E7EB",
    position: "relative",
  },
  facilityBtnActive: { backgroundColor: "#F0FDF4", borderColor: ACCENT },
  facilityIcon:  { fontSize: 22, marginBottom: 6 },
  facilityLabel: { fontSize: 11, fontWeight: "700", color: "#6B7280", textAlign: "center" },
  facilityLabelActive: { color: "#0F766E" },
  facilityCheck: {
    position: "absolute", top: 6, right: 6,
    width: 16, height: 16, borderRadius: 8,
    backgroundColor: ACCENT, justifyContent: "center", alignItems: "center",
  },

  // Mode toggle
  modeRow: { flexDirection: "row", gap: 10, marginBottom: 16 },
  modeBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 12, borderRadius: 12, backgroundColor: "#F3F4F6", borderWidth: 1, borderColor: "#E5E7EB" },
  modeBtnActive: { backgroundColor: DARK, borderColor: DARK },
  modeBtnText: { fontSize: 13, fontWeight: "700", color: "#6B7280" },
  modeBtnTextActive: { color: "#fff" },

  // Owner list
  ownerList: { gap: 10 },
  ownerCard: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#F9FAFB", borderRadius: 14, padding: 14, borderWidth: 1.5, borderColor: "#E5E7EB" },
  ownerCardSelected: { backgroundColor: DARK, borderColor: DARK },
  ownerAvatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.15)", justifyContent: "center", alignItems: "center" },
  ownerAvatarText: { fontSize: 16, fontWeight: "900", color: "#fff" },
  ownerName: { fontSize: 15, fontWeight: "800", color: "#111827" },
  ownerNameSelected: { color: "#fff" },
  ownerMeta: { fontSize: 12, color: "#9CA3AF", marginTop: 2 },
  ownerMetaSelected: { color: "rgba(255,255,255,0.7)" },

  // New owner banner
  newOwnerBanner: { flexDirection: "row", alignItems: "flex-start", gap: 8, backgroundColor: "#EFF6FF", borderRadius: 12, padding: 12, marginBottom: 4, borderWidth: 1, borderColor: "#BFDBFE" },
  newOwnerBannerText: { fontSize: 12, color: "#1D4ED8", fontWeight: "600", flex: 1, lineHeight: 18 },

  // Password
  pwRow:  { flexDirection: "row", alignItems: "center", gap: 8 },
  eyeBtn: { padding: 8 },

  // Operator toggle
  operatorToggleRow: { flexDirection: "row", alignItems: "flex-start" },
  operatorOffBox: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#F9FAFB", borderRadius: 12, padding: 14, borderWidth: 1, borderColor: "#F3F4F6" },
  operatorOffText: { fontSize: 13, color: "#9CA3AF", flex: 1, fontWeight: "500" },

  // Loader / empty
  loaderRow:  { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 16 },
  loaderText: { fontSize: 14, color: "#9CA3AF", fontWeight: "600" },
  emptyBox:   { alignItems: "center", paddingVertical: 24, gap: 8 },
  emptyText:  { fontSize: 13, color: "#9CA3AF", textAlign: "center", fontWeight: "500" },

  // Submit
  submitBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    backgroundColor: DARK, marginHorizontal: 16, marginTop: 20,
    paddingVertical: 17, borderRadius: 18,
    shadowColor: "#000", shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2, shadowRadius: 10, elevation: 6,
  },
  submitText: { color: "#fff", fontSize: 16, fontWeight: "900" },
});
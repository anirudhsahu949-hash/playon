import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
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
const DARK = "#081120";
const ACCENT = "#0EA5A4";

// ── Gym amenities ───────────────────────────────────────────────────────────────
// ── Gym amenities (expanded) ────────────────────────────────────────────────
const GYM_AMENITIES = [
  // Core workout zones
  { label: "Cardio Zone",         icon: "🏃" },
  { label: "Free Weights",        icon: "🏋️" },
  { label: "Weight Machines",     icon: "⚙️" },
  { label: "Cross-Fit Zone",      icon: "💪" },
  { label: "Boxing Area",         icon: "🥊" },
  { label: "Spin / Cycling",      icon: "🚴" },
  { label: "Functional Training", icon: "🤸" },
  { label: "Stretching Area",     icon: "🧘‍♂️" },

  // Classes & training
  { label: "Personal Trainer",    icon: "🧑‍🏫" },
  { label: "Group Classes",       icon: "👥" },
  { label: "Yoga / Zumba",        icon: "🧘" },
  { label: "Nutrition Counsel",   icon: "🥗" },

  // Wellness & recovery
  { label: "Steam / Sauna",       icon: "♨️" },
  { label: "Swimming Pool",       icon: "🏊" },
  { label: "Massage Therapy",     icon: "💆" },

  // Facilities
  { label: "Locker Room",         icon: "🔐" },
  { label: "Showers",             icon: "🚿" },
  { label: "Changing Room",       icon: "👕" },
  { label: "Towel Service",       icon: "🧖" },
  { label: "Juice Bar / Cafe",    icon: "🥤" },

  // Comfort & security
  { label: "Drinking Water",      icon: "💧" },
  { label: "Air Conditioned",     icon: "❄️" },
  { label: "WiFi",                icon: "📶" },
  { label: "Music System",        icon: "🎵" },
  { label: "Parking",             icon: "🅿️" },
  { label: "Bike Parking",        icon: "🏍️" },
  { label: "CCTV Security",       icon: "📹" },
  { label: "First Aid",           icon: "🏥" },
];

// ── Membership plan presets (tap to add a pre-filled row) ───────────────────────
const PLAN_PRESETS = [
  { label: "Monthly",     months: 1 },
  { label: "Quarterly",   months: 3 },
  { label: "Half-Yearly", months: 6 },
  { label: "Yearly",      months: 12 },
];

// ── Types ─────────────────────────────────────────────────────────────────────
type Owner = {
  id: string;
  name?: string;
  email?: string;
  businessName?: string;
  phone?: string;
};

// editable plan row in local state (kept as strings while typing)
type DraftPlan = {
  key: string; // local-only react key
  label: string;
  months: string;
  price: string;
  strikePrice: string;
};

let _planKey = 0;
const newPlan = (label = "", months = ""): DraftPlan => ({
  key: `p${_planKey++}`,
  label,
  months,
  price: "",
  strikePrice: "",
});

// ── Section header ──────────────────────────────────────────────────────────────
function SectionHeader({
  number, title, subtitle,
}: {
  number: string; title: string; subtitle: string;
}) {
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

// ── Field wrapper ─────────────────────────────────────────────────────────────
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ marginTop: 14 }}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
    </View>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function AddGym() {
  const router = useRouter();

  // Section 1 — basics
  const [name,        setName]        = useState("");
  const [location,    setLocation]    = useState("");
  const [mapLink,     setMapLink]     = useState("");
  const [rating,      setRating]      = useState("");
// Split sessions toggle — many gyms have morning + evening sessions
  const [splitSessions, setSplitSessions] = useState(true);

  // Morning session
  const [morningOpen,  setMorningOpen]  = useState("5");
  const [morningClose, setMorningClose] = useState("11");

  // Evening session
  const [eveningOpen,  setEveningOpen]  = useState("16");
  const [eveningClose, setEveningClose] = useState("22");

  // Continuous timing (when not split)
  const [openingTime, setOpeningTime] = useState("6");
  const [closingTime, setClosingTime] = useState("22");

  // ── Gym contact details (for enquiries) ────────────────────────────────
  const [gymPhone,    setGymPhone]    = useState("");
  const [gymWhatsapp, setGymWhatsapp] = useState("");
  const [gymEmail,    setGymEmail]    = useState("");

  // Section 2 — membership plans
  const [plans, setPlans] = useState<DraftPlan[]>([newPlan("Monthly", "1")]);

  // Section 3 — amenities
  const [amenities, setAmenities] = useState<string[]>([]);

  // Section 4 — images
  const [imageInput, setImageInput] = useState("");
  const [images,     setImages]     = useState<string[]>([]);
  const [coverImage, setCoverImage] = useState("");

  // Section 5 — owner
  const [owners,        setOwners]        = useState<Owner[]>([]);
  const [selectedOwner, setSelectedOwner] = useState<Owner | null>(null);
  const [ownerSearch,   setOwnerSearch]   = useState("");
  const [loadingOwners, setLoadingOwners] = useState(true);
  

  const [saving, setSaving] = useState(false);

  // ── Load owners (same pool as turfs) ──────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const snap = await getDocs(
          query(collection(db, "users"), where("role", "==", "owner"))
        );
        setOwners(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
      } catch (e) {
        console.error(e);
      } finally {
        setLoadingOwners(false);
      }
    })();
  }, []);

  // ── Amenities ─────────────────────────────────────────────────────────────
  const toggleAmenity = (label: string) =>
    setAmenities((prev) =>
      prev.includes(label) ? prev.filter((a) => a !== label) : [...prev, label]
    );

  // ── Images ────────────────────────────────────────────────────────────────
  const addImage = () => {
    if (!imageInput.trim()) return;
    setImages((prev) => [...prev, imageInput.trim()]);
    setImageInput("");
  };
  const removeImage = (i: number) =>
    setImages((prev) => prev.filter((_, idx) => idx !== i));

  // ── Plans ─────────────────────────────────────────────────────────────────
  const addPreset = (label: string, months: number) =>
    setPlans((prev) => [...prev, newPlan(label, String(months))]);
  const addCustomPlan = () => setPlans((prev) => [...prev, newPlan()]);
  const removePlan = (key: string) =>
    setPlans((prev) => prev.filter((p) => p.key !== key));
  const updatePlan = (key: string, field: keyof DraftPlan, value: string) =>
    setPlans((prev) =>
      prev.map((p) => (p.key === key ? { ...p, [field]: value } : p))
    );

  const filteredOwners = owners.filter((o) => {
    const q = ownerSearch.trim().toLowerCase();
    if (!q) return true;
    return (
      (o.name || "").toLowerCase().includes(q) ||
      (o.email || "").toLowerCase().includes(q)
    );
  });

  // ── Validation ────────────────────────────────────────────────────────────
  const validate = (): string | null => {
    if (!name.trim()) return "Gym name is required.";
    if (!location.trim()) return "Location is required.";

    // Contact validation
    if (!gymPhone.trim()) return "Gym contact phone is required.";
    if (gymPhone.trim().length < 10) return "Enter a valid phone number.";

    // Timing validation
    if (splitSessions) {
      if (Number(morningOpen) >= Number(morningClose))
        return "Morning closing must be after opening.";
      if (Number(eveningOpen) >= Number(eveningClose))
        return "Evening closing must be after opening.";
      if (Number(morningClose) > Number(eveningOpen))
        return "Morning session must end before evening session starts.";
    } else {
      if (Number(openingTime) >= Number(closingTime))
        return "Closing time must be after opening time.";
    }

    // Plan validation
    const validPlans = plans.filter(
      (p) => p.label.trim() && Number(p.months) > 0 && Number(p.price) > 0
    );
    if (validPlans.length === 0)
      return "Add at least one membership plan with a duration and price.";

    if (!selectedOwner) return "Please assign an owner.";
    return null;
  };

  // ── Save ──────────────────────────────────────────────────────────────────
const handleSave = async () => {
    const err = validate();
    if (err) return Alert.alert("Incomplete", err);

    try {
      setSaving(true);

      const finalPlans = plans
        .filter((p) => p.label.trim() && Number(p.months) > 0 && Number(p.price) > 0)
        .map((p) => ({
          id: `plan_${Number(p.months)}m`,
          label: p.label.trim(),
          months: Number(p.months),
          price: Number(p.price),
          ...(Number(p.strikePrice) > 0 ? { strikePrice: Number(p.strikePrice) } : {}),
        }))
        .sort((a, b) => a.months - b.months);

      // Build timing object based on split or continuous
      const timingData = splitSessions
        ? {
            splitSessions: true,
            morningOpen:  Number(morningOpen),
            morningClose: Number(morningClose),
            eveningOpen:  Number(eveningOpen),
            eveningClose: Number(eveningClose),
            // Legacy fields for compatibility (overall day range)
            openingTime:  Number(morningOpen),
            closingTime:  Number(eveningClose),
          }
        : {
            splitSessions: false,
            openingTime:   Number(openingTime),
            closingTime:   Number(closingTime),
          };

      // ✅ CHANGED: Save to "turfs" collection with venueType: "gym"
      await addDoc(collection(db, "turfs"), {
        name:        name.trim(),
        location:    location.trim(),
        mapLink:     mapLink.trim(),
        rating:      Number(rating) || 0,

        // Timing (split or continuous)
        ...timingData,

        // Contact details
        gymPhone:    gymPhone.trim(),
        gymWhatsapp: gymWhatsapp.trim() || gymPhone.trim(), // fallback to phone
        gymEmail:    gymEmail.trim(),

        // Gym specific
        amenities,
        plans:       finalPlans,
        image:       coverImage.trim() || images[0] || "",
        images,

        // Owner
        ownerId:     selectedOwner!.id,
        ownerName:   selectedOwner!.name  || "",
        ownerEmail:  selectedOwner!.email || "",

        // Meta
        active:      true,
        venueType:   "gym",   // ✅ This is what makes it a gym in turfs collection
        createdAt:   serverTimestamp(),
      });

      Alert.alert("Gym Added ✓", `${name.trim()} is now live.`, [
        { text: "OK", onPress: () => router.back() },
      ]);
    } catch (e: any) {
      console.error(e);
      Alert.alert("Error", e?.message || "Could not add gym. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  // ── UI ────────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={DARK} />
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {/* ── Hero ── */}
        <View style={styles.hero}>
          <View style={styles.glow1} />
          <View style={styles.glow2} />
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={20} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.heroTag}>Admin · New Venue</Text>
          <Text style={styles.heroTitle}>Add a Gym</Text>
          <Text style={styles.heroSub}>
            Create a gym with membership plans. Members subscribe for a period
            instead of booking hourly slots.
          </Text>
        </View>

        {/* ── 1. Basics ── */}
        <View style={styles.card}>
          <SectionHeader number="1" title="Gym details" subtitle="Name, location & timings" />
          <Field label="Gym Name *">
            <TextInput
              style={styles.input} placeholder="e.g. Iron Fitness Club"
              placeholderTextColor="#9CA3AF" value={name} onChangeText={setName}
            />
          </Field>
          <Field label="Location *">
            <TextInput
              style={styles.input} placeholder="Area, City"
              placeholderTextColor="#9CA3AF" value={location} onChangeText={setLocation}
            />
          </Field>
          <Field label="Google Maps Link">
            <TextInput
              style={styles.input} placeholder="https://maps.google.com/..."
              placeholderTextColor="#9CA3AF" value={mapLink} onChangeText={setMapLink}
              autoCapitalize="none"
            />
          </Field>
          {/* Rating */}
<Field label="Rating (Optional)">
  <TextInput
    style={styles.input}
    keyboardType="decimal-pad"
    placeholder="4.5"
    placeholderTextColor="#9CA3AF"
    value={rating}
    onChangeText={setRating}
  />
</Field>

{/* Split sessions toggle */}
<View style={styles.toggleRow}>
  <View style={{ flex: 1 }}>
    <Text style={styles.toggleLabel}>Split Sessions</Text>
    <Text style={styles.toggleHint}>
      Most Indian gyms run morning + evening sessions
    </Text>
  </View>
  <Switch
    value={splitSessions}
    onValueChange={setSplitSessions}
    trackColor={{ false: "#E5E7EB", true: ACCENT }}
    thumbColor="#fff"
  />
</View>

{splitSessions ? (
  <>
    {/* Morning Session */}
    <Text style={styles.sessionLabel}>🌅 Morning Session</Text>
    <View style={{ flexDirection: "row", gap: 12 }}>
      <View style={{ flex: 1 }}>
        <Field label="Opens (hr)">
          <TextInput
            style={styles.input} keyboardType="number-pad"
            placeholder="5" placeholderTextColor="#9CA3AF"
            value={morningOpen} onChangeText={setMorningOpen}
          />
        </Field>
      </View>
      <View style={{ flex: 1 }}>
        <Field label="Closes (hr)">
          <TextInput
            style={styles.input} keyboardType="number-pad"
            placeholder="11" placeholderTextColor="#9CA3AF"
            value={morningClose} onChangeText={setMorningClose}
          />
        </Field>
      </View>
    </View>

    {/* Evening Session */}
    <Text style={styles.sessionLabel}>🌆 Evening Session</Text>
    <View style={{ flexDirection: "row", gap: 12 }}>
      <View style={{ flex: 1 }}>
        <Field label="Opens (hr)">
          <TextInput
            style={styles.input} keyboardType="number-pad"
            placeholder="16" placeholderTextColor="#9CA3AF"
            value={eveningOpen} onChangeText={setEveningOpen}
          />
        </Field>
      </View>
      <View style={{ flex: 1 }}>
        <Field label="Closes (hr)">
          <TextInput
            style={styles.input} keyboardType="number-pad"
            placeholder="22" placeholderTextColor="#9CA3AF"
            value={eveningClose} onChangeText={setEveningClose}
          />
        </Field>
      </View>
    </View>
  </>
) : (
  <>
    {/* Continuous timing */}
    <Text style={styles.sessionLabel}>🕒 Open Hours</Text>
    <View style={{ flexDirection: "row", gap: 12 }}>
      <View style={{ flex: 1 }}>
        <Field label="Opens (hr)">
          <TextInput
            style={styles.input} keyboardType="number-pad"
            value={openingTime} onChangeText={setOpeningTime}
          />
        </Field>
      </View>
      <View style={{ flex: 1 }}>
        <Field label="Closes (hr)">
          <TextInput
            style={styles.input} keyboardType="number-pad"
            value={closingTime} onChangeText={setClosingTime}
          />
        </Field>
      </View>
    </View>
  </>
)}
        </View>

        {/* ── 1b. Gym Contact (for enquiries) ── */}
        <View style={styles.card}>
          <SectionHeader
            number="1b"
            title="Contact Details"
            subtitle="Users will call/message here for gym tour & enquiries"
          />

          <Field label="Phone Number *">
            <TextInput
              style={styles.input}
              placeholder="e.g. +91 98908 44206"
              placeholderTextColor="#9CA3AF"
              value={gymPhone}
              onChangeText={setGymPhone}
              keyboardType="phone-pad"
            />
          </Field>

          <Field label="WhatsApp Number (Optional)">
            <TextInput
              style={styles.input}
              placeholder="If different from phone"
              placeholderTextColor="#9CA3AF"
              value={gymWhatsapp}
              onChangeText={setGymWhatsapp}
              keyboardType="phone-pad"
            />
          </Field>

          <Field label="Email (Optional)">
            <TextInput
              style={styles.input}
              placeholder="gym@example.com"
              placeholderTextColor="#9CA3AF"
              value={gymEmail}
              onChangeText={setGymEmail}
              keyboardType="email-address"
              autoCapitalize="none"
            />
          </Field>
        </View>

        {/* ── 2. Membership plans ── */}
        <View style={styles.card}>
          <SectionHeader
            number="2"
            title="Membership plans"
            subtitle="What members pay — this is what makes a gym different from a turf"
          />

          <Text style={styles.fieldLabel}>Quick add</Text>
          <View style={styles.chipRow}>
            {PLAN_PRESETS.map((p) => (
              <TouchableOpacity key={p.label} style={styles.chip} onPress={() => addPreset(p.label, p.months)}>
                <Text style={styles.chipText}>+ {p.label}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={[styles.chip, { borderStyle: "dashed", borderColor: ACCENT }]} onPress={addCustomPlan}>
              <Text style={[styles.chipText, { color: ACCENT }]}>+ Custom</Text>
            </TouchableOpacity>
          </View>

          {plans.length === 0 && (
            <View style={styles.emptyBox}>
              <Ionicons name="pricetags-outline" size={26} color="#9CA3AF" />
              <Text style={styles.emptyText}>No plans yet — tap a quick-add above.</Text>
            </View>
          )}

          {plans.map((p) => (
            <View key={p.key} style={styles.planCard}>
              <View style={styles.planTopRow}>
                <TextInput
                  style={[styles.input, { flex: 1, paddingVertical: 9 }]}
                  placeholder="Plan name (e.g. Monthly)"
                  placeholderTextColor="#9CA3AF"
                  value={p.label}
                  onChangeText={(t) => updatePlan(p.key, "label", t)}
                />
                <TouchableOpacity style={styles.removePlanBtn} onPress={() => removePlan(p.key)}>
                  <Ionicons name="trash-outline" size={18} color="#DC2626" />
                </TouchableOpacity>
              </View>
              <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.planMini}>Duration (months)</Text>
                  <TextInput style={styles.input} keyboardType="number-pad" placeholder="1" placeholderTextColor="#9CA3AF" value={p.months} onChangeText={(t) => updatePlan(p.key, "months", t)} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.planMini}>Price ₹</Text>
                  <TextInput style={styles.input} keyboardType="number-pad" placeholder="1500" placeholderTextColor="#9CA3AF" value={p.price} onChangeText={(t) => updatePlan(p.key, "price", t)} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.planMini}>Strike ₹ (opt)</Text>
                  <TextInput style={styles.input} keyboardType="number-pad" placeholder="2000" placeholderTextColor="#9CA3AF" value={p.strikePrice} onChangeText={(t) => updatePlan(p.key, "strikePrice", t)} />
                </View>
              </View>
            </View>
          ))}
        </View>

        {/* ── 3. Amenities ── */}
        <View style={styles.card}>
          <SectionHeader number="3" title="Amenities" subtitle="What the gym offers" />
          <View style={styles.facilityGrid}>
            {GYM_AMENITIES.map((a) => {
              const on = amenities.includes(a.label);
              return (
                <TouchableOpacity
                  key={a.label}
                  style={[styles.facilityBtn, on && styles.facilityBtnActive]}
                  onPress={() => toggleAmenity(a.label)}
                >
                  {on && (
                    <View style={styles.facilityCheck}>
                      <Ionicons name="checkmark" size={11} color="#fff" />
                    </View>
                  )}
                  <Text style={styles.facilityIcon}>{a.icon}</Text>
                  <Text style={[styles.facilityLabel, on && styles.facilityLabelActive]}>{a.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* ── 4. Photos ── */}
        <View style={styles.card}>
          <SectionHeader number="4" title="Photos" subtitle="Paste image URLs" />
          <Field label="Cover image URL">
            <TextInput style={styles.input} placeholder="https://..." placeholderTextColor="#9CA3AF" value={coverImage} onChangeText={setCoverImage} autoCapitalize="none" />
          </Field>
          <Field label="Gallery images">
            <View style={styles.imageRow}>
              <TextInput style={[styles.input, { flex: 1 }]} placeholder="https://..." placeholderTextColor="#9CA3AF" value={imageInput} onChangeText={setImageInput} autoCapitalize="none" />
              <TouchableOpacity style={styles.addImgBtn} onPress={addImage}>
                <Ionicons name="add" size={24} color="#fff" />
              </TouchableOpacity>
            </View>
          </Field>
          {images.map((img, i) => (
            <View key={i} style={[styles.imageTag, { marginTop: 8 }]}>
              <Text style={styles.imageTagText} numberOfLines={1}>{img}</Text>
              <TouchableOpacity onPress={() => removeImage(i)}>
                <Ionicons name="close-circle" size={20} color="#DC2626" />
              </TouchableOpacity>
            </View>
          ))}
        </View>

        {/* ── 5. Owner ── */}
        <View style={styles.card}>
          <SectionHeader number="5" title="Assign owner" subtitle="Who manages this gym" />
          {loadingOwners ? (
            <View style={styles.loaderRow}>
              <ActivityIndicator color={ACCENT} />
              <Text style={styles.loaderText}>Loading owners…</Text>
            </View>
          ) : owners.length === 0 ? (
            <View style={styles.emptyBox}>
              <Ionicons name="people-outline" size={26} color="#9CA3AF" />
              <Text style={styles.emptyText}>No owners found. Create one from the Add Turf screen first.</Text>
            </View>
          ) : (
            <>
              <TextInput
                style={styles.input}
                placeholder="Search owner by name or email"
                placeholderTextColor="#9CA3AF"
                value={ownerSearch}
                onChangeText={setOwnerSearch}
              />
              <View style={[styles.ownerList, { marginTop: 12 }]}>
                {filteredOwners.map((o) => {
                  const sel = selectedOwner?.id === o.id;
                  return (
                    <TouchableOpacity
                      key={o.id}
                      style={[styles.ownerCard, sel && styles.ownerCardSelected]}
                      onPress={() => setSelectedOwner(o)}
                    >
                      <View style={styles.ownerAvatar}>
                        <Text style={styles.ownerAvatarText}>{(o.name || "?").charAt(0).toUpperCase()}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.ownerName, sel && styles.ownerNameSelected]}>{o.name || "Unnamed"}</Text>
                        <Text style={[styles.ownerMeta, sel && styles.ownerMetaSelected]}>{o.email || o.phone || "—"}</Text>
                      </View>
                      {sel && <Ionicons name="checkmark-circle" size={22} color="#fff" />}
                    </TouchableOpacity>
                  );
                })}
              </View>
            </>
          )}
        </View>

        {/* ── Submit ── */}
        <TouchableOpacity
          style={[styles.submitBtn, saving && { opacity: 0.65 }]}
          onPress={handleSave}
          disabled={saving}
          activeOpacity={0.85}
        >
          {saving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Ionicons name="barbell-outline" size={20} color="#fff" style={{ marginRight: 8 }} />
              <Text style={styles.submitText}>Add Gym</Text>
            </>
          )}
        </TouchableOpacity>

        <View style={{ height: 48 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Styles (mirrors add-turf.tsx + plan-editor additions) ───────────────────────
const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: "#F0F4F8" },
  scroll: { paddingBottom: 24 },

  hero: {
    backgroundColor: DARK,
    paddingHorizontal: 20,
    paddingTop: Platform.OS === "android" ? (StatusBar.currentHeight || 0) + 14 : 20,
    paddingBottom: 28,
    overflow: "hidden",
  },
  glow1:     { position: "absolute", top: -40, right: -30, width: 180, height: 180, borderRadius: 90, backgroundColor: "rgba(14,165,164,0.15)" },
  glow2:     { position: "absolute", bottom: -60, left: -40, width: 160, height: 160, borderRadius: 80, backgroundColor: "rgba(99,102,241,0.12)" },
  backBtn:   { width: 36, height: 36, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.1)", justifyContent: "center", alignItems: "center", marginBottom: 14 },
  heroTag:   { color: "#9CA3AF", fontSize: 11, fontWeight: "800", letterSpacing: 1.2, textTransform: "uppercase" },
  heroTitle: { color: "#FFFFFF", fontSize: 28, fontWeight: "900", marginTop: 4 },
  heroSub:   { color: "#9CA3AF", fontSize: 13, lineHeight: 20, marginTop: 6 },

  card: {
    backgroundColor: "#FFFFFF",
    marginHorizontal: 16, marginTop: 16,
    borderRadius: 20, padding: 18,
    borderWidth: 1, borderColor: "#E5E7EB",
    shadowColor: "#000", shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04, shadowRadius: 6, elevation: 2,
  },

  sectionHeader:  { flexDirection: "row", alignItems: "flex-start", marginBottom: 16 },
  sectionNum:     { width: 28, height: 28, borderRadius: 8, backgroundColor: DARK, justifyContent: "center", alignItems: "center", marginRight: 12, marginTop: 2 },
  sectionNumText: { color: "#fff", fontSize: 13, fontWeight: "900" },
  sectionTitle:   { fontSize: 17, fontWeight: "900", color: "#111827" },
  sectionSub:     { fontSize: 12, color: "#9CA3AF", marginTop: 2, fontWeight: "500" },

  fieldLabel: { fontSize: 11, fontWeight: "800", color: "#6B7280", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 7 },
  input:      { backgroundColor: "#F9FAFB", borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13, fontSize: 14, color: "#111827" },

  chipRow:   { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingVertical: 4, marginBottom: 8 },
  chip:      { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20, backgroundColor: "#F3F4F6", borderWidth: 1, borderColor: "#E5E7EB" },
  chipText:  { fontSize: 13, fontWeight: "700", color: "#6B7280" },

  // plan editor
  planCard:      { backgroundColor: "#F9FAFB", borderRadius: 14, borderWidth: 1, borderColor: "#E5E7EB", padding: 12, marginTop: 10 },
  planTopRow:    { flexDirection: "row", alignItems: "center", gap: 8 },
  removePlanBtn: { width: 40, height: 40, borderRadius: 10, backgroundColor: "#FEF2F2", justifyContent: "center", alignItems: "center" },
  planMini:      { fontSize: 10, fontWeight: "700", color: "#9CA3AF", textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 5 },

  imageRow:     { flexDirection: "row", gap: 10, alignItems: "center" },
  addImgBtn:    { backgroundColor: DARK, width: 46, height: 46, borderRadius: 12, justifyContent: "center", alignItems: "center" },
  imageTag:     { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "#F3F4F6", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
  imageTagText: { fontSize: 13, color: "#374151", fontWeight: "600", flex: 1, marginRight: 8 },

  facilityGrid:       { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  facilityBtn:        { width: "30%", alignItems: "center", paddingVertical: 14, backgroundColor: "#F9FAFB", borderRadius: 14, borderWidth: 1.5, borderColor: "#E5E7EB", position: "relative" },
  facilityBtnActive:  { backgroundColor: "#F0FDF4", borderColor: ACCENT },
  facilityIcon:       { fontSize: 22, marginBottom: 6 },
  facilityLabel:      { fontSize: 11, fontWeight: "700", color: "#6B7280", textAlign: "center" },
  facilityLabelActive:{ color: "#0F766E" },
  facilityCheck:      { position: "absolute", top: 6, right: 6, width: 16, height: 16, borderRadius: 8, backgroundColor: ACCENT, justifyContent: "center", alignItems: "center" },

  ownerList:         { gap: 10 },
  ownerCard:         { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#F9FAFB", borderRadius: 14, padding: 14, borderWidth: 1.5, borderColor: "#E5E7EB" },
  ownerCardSelected: { backgroundColor: DARK, borderColor: DARK },
  ownerAvatar:       { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.15)", justifyContent: "center", alignItems: "center" },
  ownerAvatarText:   { fontSize: 16, fontWeight: "900", color: "#fff" },
  ownerName:         { fontSize: 15, fontWeight: "800", color: "#111827" },
  ownerNameSelected: { color: "#fff" },
  ownerMeta:         { fontSize: 12, color: "#9CA3AF", marginTop: 2 },
  ownerMetaSelected: { color: "rgba(255,255,255,0.7)" },

  loaderRow:  { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 16 },
  loaderText: { fontSize: 14, color: "#9CA3AF", fontWeight: "600" },
  emptyBox:   { alignItems: "center", paddingVertical: 24, gap: 8 },
  emptyText:  { fontSize: 13, color: "#9CA3AF", textAlign: "center", fontWeight: "500" },

  submitBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    backgroundColor: DARK, marginHorizontal: 16, marginTop: 20,
    paddingVertical: 17, borderRadius: 18,
    shadowColor: "#000", shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2, shadowRadius: 10, elevation: 6,
  },
  submitText: { color: "#fff", fontSize: 16, fontWeight: "900" },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F9FAFB",
    borderRadius: 12,
    padding: 14,
    marginTop: 14,
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  toggleLabel: {
    fontSize: 14,
    fontWeight: "800",
    color: "#111827",
  },
  toggleHint: {
    fontSize: 11,
    color: "#9CA3AF",
    marginTop: 2,
    fontWeight: "500",
  },
  sessionLabel: {
    fontSize: 13,
    fontWeight: "800",
    color: "#374151",
    marginTop: 16,
    marginBottom: 4,
  },
});
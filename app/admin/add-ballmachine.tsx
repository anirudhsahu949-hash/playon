import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ScrollView,
  StatusBar,
  ActivityIndicator,
  Platform,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

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

// ── Facilities (subset of add-turf.tsx's list — the ones relevant to a
// standalone practice-net venue rather than a full turf) ────────────────────
const BM_FACILITIES = [
  { label: "Parking",          icon: "🅿️" },
  { label: "Bike Parking",     icon: "🏍️" },
  { label: "Washroom",         icon: "🚻" },
  { label: "Changing Room",    icon: "👕" },
  { label: "Flood Lights",     icon: "💡" },
  { label: "Drinking Water",   icon: "💧" },
  { label: "Seating Area",     icon: "🪑" },
  { label: "CCTV",             icon: "📹" },
  { label: "Equipment Rental", icon: "🎽" },
  { label: "Coach on Site",    icon: "🧑‍🏫" },
];

// ── Sport list (same list used app-wide, so this venue shows up in the
// same sport filters as regular turfs) ──────────────────────────────────────
const SPORTS = [
  "Cricket", "Tennis", "Badminton", "Football",
  "Basketball", "Volleyball", "Kabaddi", "Hockey", "Other",
];

// ── Package presets (tap to add a pre-filled row) ───────────────────────────
const PACKAGE_PRESETS = [
  { label: "6 Overs",  overs: 6,  durationMinutes: 15 },
  { label: "12 Overs", overs: 12, durationMinutes: 30 },
  { label: "18 Overs", overs: 18, durationMinutes: 45 },
];

// ── Types ─────────────────────────────────────────────────────────────────────
type Owner = {
  id: string;
  name?: string;
  email?: string;
  businessName?: string;
  phone?: string;
};

// editable package row in local state (kept as strings while typing)
type DraftPackage = {
  key: string; // local-only react key
  overs: string;
  durationMinutes: string;
  price: string;
};

let _pkgKey = 0;
const newPackage = (overs = "", durationMinutes = ""): DraftPackage => ({
  key: `pk${_pkgKey++}`,
  overs,
  durationMinutes,
  price: "",
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
export default function AddBallMachine() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  // Section 1 — basics
  const [name,        setName]        = useState("");
  const [location,    setLocation]    = useState("");
  const [mapLink,     setMapLink]     = useState("");
  const [rating,      setRating]      = useState("");

  const [openingTime, setOpeningTime] = useState("6");
  const [closingTime, setClosingTime] = useState("23");

  // ── Sport — defaults to Cricket since that's what a bowling-machine venue
  // almost always is, but stays editable/multi-select so a venue running,
  // say, a tennis ball machine too still shows up in the right filters.
  const [sports,      setSports]      = useState<string[]>(["Cricket"]);
  const [customSport, setCustomSport] = useState("");

  // ── Contact details (for enquiries) ──────────────────────────────────────
  const [venuePhone,    setVenuePhone]    = useState("");
  const [venueWhatsapp, setVenueWhatsapp] = useState("");
  const [venueEmail,    setVenueEmail]    = useState("");

  // Section 2 — machines & packages
  const [machineCount, setMachineCount] = useState("1");
  const [packages, setPackages] = useState<DraftPackage[]>([newPackage("6", "15")]);

  // Section 3 — facilities
  const [selectedFacilities, setSelectedFacilities] = useState<string[]>([]);

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

  // ── Load owners (same pool as turfs/gyms) ──────────────────────────────────
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

  // ── Facilities ────────────────────────────────────────────────────────────
  const toggleFacility = (label: string) =>
    setSelectedFacilities((prev) =>
      prev.includes(label) ? prev.filter((f) => f !== label) : [...prev, label]
    );

  // ── Sport ─────────────────────────────────────────────────────────────────
  const toggleSport = (selectedSport: string) => {
    setSports((prev) =>
      prev.includes(selectedSport)
        ? prev.filter((s) => s !== selectedSport)
        : [...prev, selectedSport]
    );
    if (selectedSport === "Other") setCustomSport("");
  };

  // ── Images ────────────────────────────────────────────────────────────────
  const addImage = () => {
    if (!imageInput.trim()) return;
    setImages((prev) => [...prev, imageInput.trim()]);
    setImageInput("");
  };
  const removeImage = (i: number) =>
    setImages((prev) => prev.filter((_, idx) => idx !== i));

  // ── Packages ──────────────────────────────────────────────────────────────
  const addPreset = (overs: number, durationMinutes: number) =>
    setPackages((prev) => [...prev, newPackage(String(overs), String(durationMinutes))]);
  const addCustomPackage = () => setPackages((prev) => [...prev, newPackage()]);
  const removePackage = (key: string) =>
    setPackages((prev) => prev.filter((p) => p.key !== key));
  const updatePackage = (key: string, field: keyof DraftPackage, value: string) =>
    setPackages((prev) =>
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
    if (!name.trim()) return "Venue name is required.";
    if (!location.trim()) return "Location is required.";

    const finalSports = sports.filter((s) => s !== "Other");
    if (finalSports.length === 0) return "Select at least one sport.";

    if (!machineCount.trim() || Number(machineCount) < 1)
      return "Enter how many Ball Machines this venue has (at least 1).";

    if (Number(openingTime) < 0 || Number(openingTime) > 23)
      return "Opening hour must be 0–23.";
    if (Number(closingTime) < 1 || Number(closingTime) > 24)
      return "Closing hour must be 1–24.";
    if (Number(closingTime) <= Number(openingTime))
      return "Closing hour must be after opening hour.";

    if (!venuePhone.trim()) return "Contact phone is required.";
    if (venuePhone.trim().length < 10) return "Enter a valid phone number.";

    const validPackages = packages.filter(
      (p) => Number(p.overs) > 0 && Number(p.durationMinutes) > 0 && Number(p.price) > 0
    );
    if (validPackages.length === 0)
      return "Add at least one package (e.g. 6 Overs, 15 min — ₹150).";

    if (!selectedOwner) return "Please assign an owner.";
    return null;
  };

  // ── Save ──────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    const err = validate();
    if (err) return Alert.alert("Incomplete", err);

    try {
      setSaving(true);

      const finalSports = sports.filter((s) => s !== "Other");

      const finalPackages = packages
        .filter((p) => Number(p.overs) > 0 && Number(p.durationMinutes) > 0 && Number(p.price) > 0)
        .map((p) => ({
          id:              `pkg_${Number(p.overs)}ov_${Number(p.durationMinutes)}m`,
          label:           `${Number(p.overs)} Overs`,
          overs:           Number(p.overs),
          durationMinutes: Number(p.durationMinutes),
          price:           Number(p.price),
        }))
        .sort((a, b) => a.overs - b.overs);

      // ✅ Same "turfs" collection + venueType pattern as Add-gym.tsx, so all
      // the existing admin turf-list / settlement / booking-rules screens
      // that query `collection(db, "turfs")` pick this up automatically.
      await addDoc(collection(db, "turfs"), {
        name:     name.trim(),
        location: location.trim(),
        mapLink:  mapLink.trim(),
        rating:   Number(rating) || 0,

        openingTime: Number(openingTime),
        closingTime: Number(closingTime),

        // Contact details
        venuePhone:    venuePhone.trim(),
        venueWhatsapp: venueWhatsapp.trim() || venuePhone.trim(),
        venueEmail:    venueEmail.trim(),

        facilities: selectedFacilities,
        image:      coverImage.trim() || images[0] || "",
        images,

        // ── Ball Machine — this venue's entire offering ──────────────────
        ballMachineEnabled:     true,
        ballMachineCount:       Number(machineCount),
        ballMachineOpeningTime: Number(openingTime),
        ballMachineClosingTime: Number(closingTime),
        ballMachinePackages:    finalPackages,

        // ── No regular turf-slot booking at this venue ───────────────────
        // Same zeroed/flagged fields as the "Ball Machine Only" path in
        // add-turf.tsx, so any screen reading these gets safe values and
        // knows to skip the slot-picker flow entirely.
        sport:              finalSports,
        dayPrice:           0,
        nightPrice:         0,
        bookingPrice:       0,
        price:              0,
        slotDuration:       0,
        slotBookingEnabled: false,

        // Owner
        ownerId:    selectedOwner!.id,
        ownerName:  selectedOwner!.name  || "",
        ownerEmail: selectedOwner!.email || "",

        // Meta
        active:     true,
        venueType:  "ball_machine",   // ✅ This is what makes it a Ball Machine venue in the turfs collection
        createdAt:  serverTimestamp(),
      });

      Alert.alert("Ball Machine Venue Added ✓", `${name.trim()} is now live.`, [
        { text: "OK", onPress: () => router.back() },
      ]);
    } catch (e: any) {
      console.error(e);
      Alert.alert("Error", e?.message || "Could not add venue. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  // ── UI ────────────────────────────────────────────────────────────────────
  return (
    <View style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={DARK} />
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {/* ── Hero ── */}
        <View style={[styles.hero, { paddingTop: insets.top + 12 }]}>
          <View style={styles.glow1} />
          <View style={styles.glow2} />
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={20} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.heroTag}>Admin · New Venue</Text>
          <Text style={styles.heroTitle}>Add Ball Machine</Text>
          <Text style={styles.heroSub}>
            Create a standalone Ball Machine venue. Players book a package by
            overs instead of an hourly turf slot.
          </Text>
        </View>

        {/* ── 1. Basics ── */}
        <View style={styles.card}>
          <SectionHeader number="1" title="Venue details" subtitle="Name, location & hours" />
          <Field label="Venue Name *">
            <TextInput
              style={styles.input} placeholder="e.g. CrickPro Practice Nets"
              placeholderTextColor="#9CA3AF" value={name} onChangeText={setName}
            />
          </Field>
          <Field label="Location *">
            <TextInput
              style={styles.input} placeholder="Area, City"
              placeholderTextColor="#9CA3AF" value={location} onChangeText={setLocation}
            />
          </Field>

          <Field label="Sport *">
            {sports.filter((s) => s !== "Other").length > 0 && (
              <View style={styles.selectedSportRow}>
                <Text style={styles.selectedSportText}>
                  Selected: {sports.filter((s) => s !== "Other").join(", ")}
                </Text>
              </View>
            )}
            <View style={styles.chipRow}>
              {SPORTS.map((s) => {
                const active = sports.includes(s);
                return (
                  <TouchableOpacity
                    key={s}
                    style={[styles.chip, active && styles.chipActive]}
                    onPress={() => toggleSport(s)}
                  >
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>{s}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {sports.includes("Other") && (
              <View style={{ marginTop: 10 }}>
                <TextInput
                  style={styles.input}
                  placeholder="Enter custom sport name"
                  placeholderTextColor="#9CA3AF"
                  value={customSport}
                  onChangeText={setCustomSport}
                  returnKeyType="done"
                  onBlur={() => {
                    const trimmed = customSport.trim();
                    if (trimmed.length > 0) {
                      setSports((prev) => [...prev.filter((s) => s !== "Other"), trimmed]);
                      setCustomSport("");
                    } else {
                      setSports((prev) => prev.filter((s) => s !== "Other"));
                    }
                  }}
                  onSubmitEditing={() => {
                    const trimmed = customSport.trim();
                    if (trimmed.length > 0) {
                      setSports((prev) => [...prev.filter((s) => s !== "Other"), trimmed]);
                      setCustomSport("");
                    } else {
                      setSports((prev) => prev.filter((s) => s !== "Other"));
                    }
                  }}
                />
                <Text style={styles.hint}>Press Done or tap away to add your custom sport.</Text>
              </View>
            )}
            <Text style={styles.hint}>
              Defaults to Cricket — most Ball Machine venues are cricket practice nets. Select more if this venue also runs a tennis/badminton ball machine.
            </Text>
          </Field>

          <Field label="Google Maps Link">
            <TextInput
              style={styles.input} placeholder="https://maps.google.com/..."
              placeholderTextColor="#9CA3AF" value={mapLink} onChangeText={setMapLink}
              autoCapitalize="none"
            />
          </Field>
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

          <Text style={styles.sessionLabel}>🕒 Open Hours</Text>
          <View style={{ flexDirection: "row", gap: 12 }}>
            <View style={{ flex: 1 }}>
              <Field label="Opens (hr)">
                <TextInput
                  style={styles.input} keyboardType="number-pad"
                  placeholder="6" placeholderTextColor="#9CA3AF"
                  value={openingTime} onChangeText={setOpeningTime}
                />
              </Field>
            </View>
            <View style={{ flex: 1 }}>
              <Field label="Closes (hr)">
                <TextInput
                  style={styles.input} keyboardType="number-pad"
                  placeholder="23" placeholderTextColor="#9CA3AF"
                  value={closingTime} onChangeText={setClosingTime}
                />
              </Field>
            </View>
          </View>
        </View>

        {/* ── 1b. Contact (for enquiries) ── */}
        <View style={styles.card}>
          <SectionHeader
            number="1b"
            title="Contact Details"
            subtitle="Users will call/message here for enquiries"
          />

          <Field label="Phone Number *">
            <TextInput
              style={styles.input}
              placeholder="e.g. +91 98908 44206"
              placeholderTextColor="#9CA3AF"
              value={venuePhone}
              onChangeText={setVenuePhone}
              keyboardType="phone-pad"
            />
          </Field>

          <Field label="WhatsApp Number (Optional)">
            <TextInput
              style={styles.input}
              placeholder="If different from phone"
              placeholderTextColor="#9CA3AF"
              value={venueWhatsapp}
              onChangeText={setVenueWhatsapp}
              keyboardType="phone-pad"
            />
          </Field>

          <Field label="Email (Optional)">
            <TextInput
              style={styles.input}
              placeholder="venue@example.com"
              placeholderTextColor="#9CA3AF"
              value={venueEmail}
              onChangeText={setVenueEmail}
              keyboardType="email-address"
              autoCapitalize="none"
            />
          </Field>
        </View>

        {/* ── 2. Machines & packages ── */}
        <View style={styles.card}>
          <SectionHeader
            number="2"
            title="Machines & packages"
            subtitle="How many machines, and what players pay per over"
          />

          <Field label="Number of Machines *">
            <TextInput
              style={styles.input} placeholder="e.g. 1"
              placeholderTextColor="#9CA3AF" keyboardType="number-pad"
              value={machineCount} onChangeText={setMachineCount}
            />
            <Text style={styles.hint}>How many bays/machines can run bookings in parallel.</Text>
          </Field>

          <Text style={[styles.fieldLabel, { marginTop: 18 }]}>Quick add</Text>
          <View style={styles.chipRow}>
            {PACKAGE_PRESETS.map((p) => (
              <TouchableOpacity key={p.label} style={styles.chip} onPress={() => addPreset(p.overs, p.durationMinutes)}>
                <Text style={styles.chipText}>+ {p.label}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={[styles.chip, { borderStyle: "dashed", borderColor: ACCENT }]} onPress={addCustomPackage}>
              <Text style={[styles.chipText, { color: ACCENT }]}>+ Custom</Text>
            </TouchableOpacity>
          </View>

          {packages.length === 0 && (
            <View style={styles.emptyBox}>
              <Ionicons name="pricetags-outline" size={26} color="#9CA3AF" />
              <Text style={styles.emptyText}>No packages yet — tap a quick-add above.</Text>
            </View>
          )}

          {packages.map((p) => (
            <View key={p.key} style={styles.pkgCard}>
              <View style={styles.pkgTopRow}>
                <Text style={styles.pkgTitle}>
                  {Number(p.overs) > 0 ? `${Number(p.overs)} Overs` : "New Package"}
                </Text>
                <TouchableOpacity style={styles.removePkgBtn} onPress={() => removePackage(p.key)}>
                  <Ionicons name="trash-outline" size={18} color="#DC2626" />
                </TouchableOpacity>
              </View>
              <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.pkgMini}>Overs</Text>
                  <TextInput style={styles.input} keyboardType="number-pad" placeholder="6" placeholderTextColor="#9CA3AF" value={p.overs} onChangeText={(t) => updatePackage(p.key, "overs", t)} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.pkgMini}>Duration (min)</Text>
                  <TextInput style={styles.input} keyboardType="number-pad" placeholder="15" placeholderTextColor="#9CA3AF" value={p.durationMinutes} onChangeText={(t) => updatePackage(p.key, "durationMinutes", t)} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.pkgMini}>Price ₹</Text>
                  <TextInput style={styles.input} keyboardType="number-pad" placeholder="150" placeholderTextColor="#9CA3AF" value={p.price} onChangeText={(t) => updatePackage(p.key, "price", t)} />
                </View>
              </View>
            </View>
          ))}
          <Text style={styles.hint}>
            e.g. 6 overs / 15 min / ₹150, and 12 overs / 30 min / ₹300. Add as many tiers as this venue offers.
          </Text>
        </View>

        {/* ── 3. Facilities ── */}
        <View style={styles.card}>
          <SectionHeader number="3" title="Facilities" subtitle="What's available on site (optional)" />
          <View style={styles.facilityGrid}>
            {BM_FACILITIES.map((f) => {
              const on = selectedFacilities.includes(f.label);
              return (
                <TouchableOpacity
                  key={f.label}
                  style={[styles.facilityBtn, on && styles.facilityBtnActive]}
                  onPress={() => toggleFacility(f.label)}
                >
                  {on && (
                    <View style={styles.facilityCheck}>
                      <Ionicons name="checkmark" size={11} color="#fff" />
                    </View>
                  )}
                  <Text style={styles.facilityIcon}>{f.icon}</Text>
                  <Text style={[styles.facilityLabel, on && styles.facilityLabelActive]}>{f.label}</Text>
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
          <SectionHeader number="5" title="Assign owner" subtitle="Who manages this venue" />
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
              <Ionicons name="baseball-outline" size={20} color="#fff" style={{ marginRight: 8 }} />
              <Text style={styles.submitText}>Add Ball Machine Venue</Text>
            </>
          )}
        </TouchableOpacity>

        <View style={{ height: 48 }} />
      </ScrollView>
    </View>
  );
}

// ── Styles (mirrors Add-gym.tsx + package-editor renames) ───────────────────────
const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: "#F0F4F8" },
  scroll: { paddingBottom: 24 },

  hero: {
    backgroundColor: DARK,
    paddingHorizontal: 20,
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
  hint:       { fontSize: 11, color: "#9CA3AF", marginTop: 5, fontWeight: "500" },

  chipRow:   { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingVertical: 4, marginBottom: 8 },
  chip:      { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20, backgroundColor: "#F3F4F6", borderWidth: 1, borderColor: "#E5E7EB" },
  chipActive:     { backgroundColor: DARK, borderColor: DARK },
  chipText:  { fontSize: 13, fontWeight: "700", color: "#6B7280" },
  chipTextActive: { color: "#fff" },

  selectedSportRow:  { marginBottom: 10 },
  selectedSportText: { fontSize: 12, fontWeight: "700", color: ACCENT },

  // package editor
  pkgCard:      { backgroundColor: "#F9FAFB", borderRadius: 14, borderWidth: 1, borderColor: "#E5E7EB", padding: 12, marginTop: 10 },
  pkgTopRow:    { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  pkgTitle:     { fontSize: 14, fontWeight: "800", color: "#111827" },
  removePkgBtn: { width: 40, height: 40, borderRadius: 10, backgroundColor: "#FEF2F2", justifyContent: "center", alignItems: "center" },
  pkgMini:      { fontSize: 10, fontWeight: "700", color: "#9CA3AF", textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 5 },

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

  sessionLabel: {
    fontSize: 13,
    fontWeight: "800",
    color: "#374151",
    marginTop: 16,
    marginBottom: 4,
  },
});
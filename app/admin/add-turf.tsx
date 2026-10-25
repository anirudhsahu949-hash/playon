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
  Switch,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useState, useEffect } from "react";
import { db,auth } from "../../firebaseConfig";
import {
  collection,
  addDoc,
  getDocs,
  query,
  where,
  updateDoc,   // ✅ BUG FIX #3: needed to write turfId back to operator's user doc
  doc,         // ✅ BUG FIX #3: needed for updateDoc reference
  serverTimestamp,
  
} from "firebase/firestore";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import MapPickerModal from "../../components/Mappickermodal";
import { City, CITY_STATUS_META, fetchCities, guessCity } from "../../utils/cities";

// ── Config ────────────────────────────────────────────────────────────────────
const SERVER_URL = "https://bookora-backend-95u4.onrender.com";
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
const SPORTS = [
  "Football", "Cricket", "Badminton", "Basketball",
  "Tennis", "Volleyball", "Kabaddi", "Hockey", "Other",
];

const VENUE_TYPES = [
  { key: "turf",         label: "Turf",  emoji: "🏏,⚽" },
  { key: "court",        label: "Indoor Court",  emoji: "🏸" },
  { key: "gym",          label: "Gym / Fitness", emoji: "🏋️" },
  { key: "swimming",     label: "Swimming Pool", emoji: "🏊" },
  { key: "club",         label: "Club / Arena",  emoji: "🏟️" },
  { key: "ball_machine", label: "Ball Machine Only", emoji: "🎯" },
    { key: "other",    label: "Other",         emoji: "➕" },
];

// ── Booking modes (admin-only control) ───────────────────────────────────────
const BOOKING_MODES = [
  { key: "online", label: "Online",     icon: "phone-portrait-outline" },
  { key: "phone",  label: "Phone Only", icon: "call-outline" },
  { key: "both",   label: "Both",       icon: "swap-horizontal-outline" },
] as const;
type BookingMode = "online" | "phone" | "both";

// ── Types ─────────────────────────────────────────────────────────────────────
type Owner = {
  id: string;
  name?: string;
  email?: string;
  businessName?: string;
  phone?: string;
  turfId?: string; // ✅ BUG FIX #3: operators can have a turfId already
};

// ── Section header ────────────────────────────────────────────────────────────
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
export default function AddTurf() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [venueType, setVenueType] = useState("turf");
  const [customVenueType, setCustomVenueType] = useState("");

  const [loadingOwners,    setLoadingOwners]    = useState(true);
  const [loadingOperators, setLoadingOperators] = useState(false);
  const [saving,           setSaving]           = useState(false);

  // ── Section 1: Turf details ──────────────────────────────────────────────
  const [name,         setName]         = useState("");
  const [location,     setLocation]     = useState("");

  // ── City (all-India) — every turf belongs to one city ───────────────────
  const [cities,       setCities]       = useState<City[]>([]);
  const [cityId,       setCityId]       = useState("");
  const [locality,     setLocality]     = useState("");
  const [pinLat,       setPinLat]       = useState<number | null>(null);
  const [pinLng,       setPinLng]       = useState<number | null>(null);
  const [showMap,      setShowMap]      = useState(false);
  const selectedCity = cities.find((c) => c.id === cityId) || null;
  const [sports,       setSports]       = useState<string[]>([]);
  const [customSport,  setCustomSport]  = useState("");
  const [mapLink,      setMapLink]      = useState("");
  const [dayPrice,     setDayPrice]     = useState("");
  const [nightPrice,   setNightPrice]   = useState("");
  const [bookingPrice, setBookingPrice] = useState("");
  const [openingTime,  setOpeningTime]  = useState("6");
  const [closingTime,  setClosingTime]  = useState("23");
  const [slotDuration, setSlotDuration] = useState("60");

    // ── Booking mode (admin decides; owner cannot change) ───────────────────
  const [bookingMode,  setBookingMode]  = useState<BookingMode>("online");
  const [bookingPhone, setBookingPhone] = useState("");

  const needsAdvance = bookingMode !== "phone"; // phone-only = no online payment

  // ── Section 2: Ball Machine (optional add-on or standalone venue) ────────
  type BallMachinePackage = {
    id: string;
    label: string;
    overs: number;
    durationMinutes: number;
    price: number;
  };
  const [ballMachineEnabled,      setBallMachineEnabled]      = useState(false);
  const [ballMachineCount,        setBallMachineCount]        = useState("1");
  const [ballMachineOpeningTime,  setBallMachineOpeningTime]  = useState("");
  const [ballMachineClosingTime,  setBallMachineClosingTime]  = useState("");
  const [ballMachinePackages,     setBallMachinePackages]     = useState<BallMachinePackage[]>([]);
  const [pkgOvers,                setPkgOvers]                = useState("");
  const [pkgDurationMinutes,      setPkgDurationMinutes]      = useState("");
  const [pkgPrice,                setPkgPrice]                = useState("");

  // ── Section 3: Facilities ────────────────────────────────────────────────
  const [selectedFacilities, setSelectedFacilities] = useState<string[]>([]);

  // ── Section 3: Images ────────────────────────────────────────────────────
  const [imageInput,  setImageInput]  = useState("");
  const [images,      setImages]      = useState<string[]>([]);
  const [coverImage,  setCoverImage]  = useState("");

  // ── Section 4: Owner ─────────────────────────────────────────────────────
  const [owners,         setOwners]         = useState<Owner[]>([]);
  const [selectedOwner,  setSelectedOwner]  = useState<Owner | null>(null);
  const [ownerMode,      setOwnerMode]      = useState<"existing" | "new">("existing");
  const [ownerSearch,    setOwnerSearch]    = useState("");
  const [ownerName,      setOwnerName]      = useState("");
  const [ownerEmail,     setOwnerEmail]     = useState("");
  const [ownerPassword,  setOwnerPassword]  = useState("");
  const [ownerPhone,     setOwnerPhone]     = useState("");
  const [ownerLocation,  setOwnerLocation]  = useState("");
  const [ownerBusiness,  setOwnerBusiness]  = useState("");
  const [showPassword,   setShowPassword]   = useState(false);

  // ── Section 4b: Owner banking details ────────────────────────────────────
  const [bankAccountNo,  setBankAccountNo]  = useState("");
  const [bankIfsc,       setBankIfsc]       = useState("");
  const [bankName,       setBankName]       = useState(""); // account holder name
  const [bankUpi,        setBankUpi]        = useState(""); // optional

  // ── Section 5: Operator ──────────────────────────────────────────────────
  const [addOperator,      setAddOperator]      = useState(false);
  const [operators,        setOperators]        = useState<Owner[]>([]);
  const [selectedOperator, setSelectedOperator] = useState<Owner | null>(null);
  const [operatorMode,     setOperatorMode]     = useState<"existing" | "new">("existing");
  const [operatorSearch,   setOperatorSearch]   = useState("");
  const [opName,           setOpName]           = useState("");
  const [opEmail,          setOpEmail]          = useState("");
  const [opPassword,       setOpPassword]       = useState("");
  const [opPhone,          setOpPhone]          = useState("");
  const [showOpPassword,   setShowOpPassword]   = useState(false);

  // ── Ball Machine Only venue: no regular slot booking at all, so sport,
  // day/night pricing, advance price, and slot duration don't apply — Ball
  // Machine packages ARE the venue's entire offering, not an add-on.
  const isBallMachineOnly = venueType === "ball_machine";

  // ── Fetch on mount ───────────────────────────────────────────────────────
  useEffect(() => { fetchOwners(); }, []);
  useEffect(() => {
    fetchCities(true)
      .then((list) => {
        setCities(list);
        // Pre-select the default city so the common case is one tap less
        const def = list.find((c) => c.isDefault) || (list.length === 1 ? list[0] : null);
        if (def) setCityId((cur) => cur || def.id);
      })
      .catch(() => Alert.alert("Error", "Unable to load cities."));
  }, []);

  // Map pin → coords, fill location text, and auto-pick the city it falls in
  const onMapConfirm = (lat: number, lng: number, address: string) => {
    setPinLat(lat); setPinLng(lng);
    if (!mapLink.trim()) setMapLink(`https://maps.google.com/?q=${lat},${lng}`);
    const hit = guessCity({ lat, lng, text: address }, cities);
    if (hit) setCityId(hit.id);
    if (!location.trim()) setLocation(address);
    setShowMap(false);
    if (!hit) {
      Alert.alert("Pin is outside your cities", "This pin isn't inside any city's radius. Pick the city by hand, or add the city first in Admin → Cities.");
    }
  };
  useEffect(() => { if (addOperator) fetchOperators(); }, [addOperator]);
  useEffect(() => {
    if (isBallMachineOnly) setBallMachineEnabled(true);
  }, [isBallMachineOnly]);

  const fetchOwners = async () => {
    try {
      setLoadingOwners(true);
      const snap = await getDocs(
        query(collection(db, "users"), where("role", "==", "owner"))
      );
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
      const snap = await getDocs(
        query(collection(db, "users"), where("role", "==", "turf-operator"))
      );
      setOperators(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Owner)));
    } catch {
      Alert.alert("Error", "Unable to load operators.");
    } finally {
      setLoadingOperators(false);
    }
  };

  // ── Helpers ──────────────────────────────────────────────────────────────
  const toggleFacility = (label: string) =>
    setSelectedFacilities((prev) =>
      prev.includes(label) ? prev.filter((f) => f !== label) : [...prev, label]
    );

  const addImage = () => {
    if (!imageInput.trim()) return;
    setImages((prev) => [...prev, imageInput.trim()]);
    setImageInput("");
  };

  const removeImage = (index: number) =>
    setImages((prev) => prev.filter((_, i) => i !== index));

  // ✅ BUG FIX #1 — "Other" sport chip: toggleSport was defined AFTER validate()
  // which is fine for JS hoisting but confusing. Moved here. Also the "Other"
  // chip never got removed from sports[] when the user typed a custom name and
  // blurred — if customSport was empty at that point "Other" just disappeared
  // silently leaving no sport, which would fail validation. Fixed below in
  // onBlur/onSubmitEditing by only removing "Other" if trimmed is non-empty.
  const toggleSport = (selectedSport: string) => {
    setSports((prev) =>
      prev.includes(selectedSport)
        ? prev.filter((s) => s !== selectedSport)
        : [...prev, selectedSport]
    );
    // ✅ BUG FIX #1b — when user deselects "Other", clear the custom input too
    if (selectedSport === "Other") setCustomSport("");
  };

  // ── Ball Machine package helpers ────────────────────────────────────────
  const addBallMachinePackage = () => {
    const overs    = Number(pkgOvers);
    const duration = Number(pkgDurationMinutes);
    const price    = Number(pkgPrice);

    if (!overs || overs <= 0)    return Alert.alert("Invalid Package", "Enter a valid number of overs.");
    if (!duration || duration <= 0) return Alert.alert("Invalid Package", "Enter a valid session duration in minutes.");
    if (!price || price <= 0)    return Alert.alert("Invalid Package", "Enter a valid price.");

    const newPkg: BallMachinePackage = {
      id: `pkg_${Date.now()}`,
      label: `${overs} Overs`,
      overs,
      durationMinutes: duration,
      price,
    };
    setBallMachinePackages((prev) => [...prev, newPkg]);
    setPkgOvers(""); setPkgDurationMinutes(""); setPkgPrice("");
  };

  const removeBallMachinePackage = (id: string) =>
    setBallMachinePackages((prev) => prev.filter((p) => p.id !== id));

  const filteredOwners = owners.filter((o) => {
    const q = ownerSearch.toLowerCase();
    return !q || (o.name || "").toLowerCase().includes(q) || (o.email || "").toLowerCase().includes(q);
  });

  const filteredOperators = operators.filter((o) => {
    const q = operatorSearch.toLowerCase();
    return !q || (o.name || "").toLowerCase().includes(q) || (o.email || "").toLowerCase().includes(q);
  });

  // ── Reset ─────────────────────────────────────────────────────────────────
  const resetForm = () => {
    setName(""); setLocation(""); setLocality(""); setPinLat(null); setPinLng(null); setSports([]); setCustomSport(""); setMapLink("");
    setDayPrice(""); setNightPrice(""); setBookingPrice("");
    setOpeningTime("6"); setClosingTime("23"); setSlotDuration("60");
    setBallMachineEnabled(false); setBallMachineCount("1");
    setBallMachineOpeningTime(""); setBallMachineClosingTime("");
    setBallMachinePackages([]); setPkgOvers(""); setPkgDurationMinutes(""); setPkgPrice("");
    setSelectedFacilities([]);
    setImageInput(""); setImages([]); setCoverImage("");
    setSelectedOwner(null); setOwnerMode("existing"); setOwnerSearch("");
    setOwnerName(""); setOwnerEmail(""); setOwnerPassword(""); setOwnerPhone("");
    setOwnerLocation(""); setOwnerBusiness(""); setShowPassword(false);
    setBankAccountNo(""); setBankIfsc(""); setBankName(""); setBankUpi("");
    setAddOperator(false); setSelectedOperator(null); setOperatorMode("existing");
    setOperatorSearch(""); setOpName(""); setOpEmail(""); setOpPassword("");
    setOpPhone(""); setShowOpPassword(false);setVenueType("turf");setCustomVenueType("");
        setBookingMode("online"); setBookingPhone("");
  };

  // ── Validate ──────────────────────────────────────────────────────────────
  const validate = (): string | null => {
    if (!name.trim())     return "Turf name is required.";
    if (!cityId)          return cities.length === 0
      ? "No cities set up yet. Go to Admin → Cities and set up a city first."
      : "Pick the city this turf is in.";
    if (!locality.trim()) return "Area / locality is required (e.g. Rajapeth, Camp).";
    if (!location.trim()) return "Location is required.";

    if (venueType === "other" && !customVenueType.trim())
  return "Please enter a custom venue type.";

    // ✅ BUG FIX #2 — sports[] can contain "Other" if user toggled it but
    // never typed a custom name. Filter it out before checking length.
    const finalSports = sports.filter((s) => s !== "Other");
    if (!isBallMachineOnly && finalSports.length === 0) return "Select at least one sport.";

    if (!isBallMachineOnly) {
      if (!dayPrice.trim()     || Number(dayPrice)     <= 0) return "Enter a valid day price.";
      if (!nightPrice.trim()   || Number(nightPrice)   <= 0) return "Enter a valid night price.";
        if (needsAdvance) {
        if (!bookingPrice.trim() || Number(bookingPrice) <= 0) return "Enter a valid advance booking price.";
        if (
          Number(bookingPrice) > Number(dayPrice) ||
          Number(bookingPrice) > Number(nightPrice)
        ) return "Advance booking price cannot exceed the slot price.";
      }
    }

    if (Number(openingTime) < 0  || Number(openingTime) > 23)
      return "Opening time must be 0–23.";
        if (Number(closingTime) < 1  || Number(closingTime) > 28)
      return "Closing time must be 1–28 (25 = 1 AM, 26 = 2 AM, 27 = 3 AM, 28 = 4 AM next day).";
    if (Number(closingTime) <= Number(openingTime))
      return "Closing time must be after opening time.";
    if (Number(closingTime) > 24 && Number(openingTime) < Number(closingTime) - 24)
      return `Late-night turfs must open at ${Number(closingTime) - 24} AM or later (so night slots don't overlap the next morning).`;
    if (!isBallMachineOnly && Number(slotDuration) <= 0) return "Enter a valid slot duration.";

    if (ballMachineEnabled) {
      if (!ballMachineCount.trim() || Number(ballMachineCount) < 1)
        return "Enter how many Ball Machines this venue has (at least 1).";
      if (ballMachinePackages.length === 0)
        return "Add at least one Ball Machine package (e.g. 6 Overs — ₹150).";
      if (ballMachineOpeningTime.trim()) {
        if (Number(ballMachineOpeningTime) < 0 || Number(ballMachineOpeningTime) > 23)
          return "Ball Machine opening hour must be 0–23.";
      }
      if (ballMachineClosingTime.trim()) {
        if (Number(ballMachineClosingTime) < 1 || Number(ballMachineClosingTime) > 24)
          return "Ball Machine closing hour must be 1–24.";
      }
      if (
        ballMachineOpeningTime.trim() && ballMachineClosingTime.trim() &&
        Number(ballMachineClosingTime) <= Number(ballMachineOpeningTime)
      ) return "Ball Machine closing hour must be after its opening hour.";
    }

    if (ownerMode === "existing" && !selectedOwner) return "Please select an owner.";
    if (ownerMode === "new") {
      if (!ownerName.trim())    return "Owner name is required.";
      if (!ownerEmail.trim() || !ownerEmail.includes("@"))
        return "Valid owner email is required.";
      if (ownerPassword.length < 6) return "Owner password must be at least 6 characters.";
      if (!ownerPhone.trim())   return "Owner phone is required.";
      if (!ownerBusiness.trim()) return "Business name is required.";
      // ✅ banking validation
      if (!bankAccountNo.trim()) return "Bank account number is required.";
      if (bankAccountNo.trim().length < 9) return "Enter a valid account number (min 9 digits).";
      if (!bankIfsc.trim()) return "IFSC code is required.";
      if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(bankIfsc.trim().toUpperCase())) return "Enter a valid IFSC code (e.g. SBIN0001234).";
      if (!bankName.trim()) return "Account holder name is required.";
    }

    if (addOperator) {
      if (operatorMode === "existing" && !selectedOperator)
        return "Please select an operator or turn off the operator toggle.";
      if (operatorMode === "new") {
        if (!opName.trim())  return "Operator name is required.";
        if (!opEmail.trim() || !opEmail.includes("@"))
          return "Valid operator email is required.";
        if (opPassword.length < 6) return "Operator password must be at least 6 characters.";
        if (!opPhone.trim()) return "Operator phone is required.";
      }
    }

    
      if (bookingMode !== "online") {
      const digits = bookingPhone.replace(/\D/g, "").slice(-10);
      if (!/^[6-9]\d{9}$/.test(digits))
        return "Enter a valid 10-digit booking phone number.";
    }
    return null;
  };

   const getToken = async (): Promise<string> => {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error("Not logged in — please log in again.");
  return token;
};  

  // ── Create owner via server ───────────────────────────────────────────────
 const createOwnerViaServer = async (): Promise<Owner> => {
  const token = await getToken();                              // ← ADD
  const res = await fetch(`${SERVER_URL}/create-owner`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,                     // ← ADD
    },
    body: JSON.stringify({
        name:         ownerName.trim(),
        email:        ownerEmail.trim().toLowerCase(),
        password:     ownerPassword,
        phone:        ownerPhone.trim(),
        businessName: ownerBusiness.trim(),
        location:     ownerLocation.trim(),
        role:         "owner",
        status:       "active",
        // ✅ banking details
        bankAccountNo: bankAccountNo.trim(),
        bankIfsc:      bankIfsc.trim().toUpperCase(),
        bankName:      bankName.trim(),
        bankUpi:       bankUpi.trim() || null,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to create owner account");
    return { id: data.uid, name: ownerName.trim(), email: ownerEmail.trim().toLowerCase() };
  };

  // ── Create operator via server ────────────────────────────────────────────
 const createOperatorViaServer = async (ownerId: string): Promise<Owner> => {
  const token = await getToken();                              // ← ADD
  const res = await fetch(`${SERVER_URL}/create-operator`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,                     // ← ADD
    },
    body: JSON.stringify({
        name:    opName.trim(),
        email:   opEmail.trim().toLowerCase(),
        password: opPassword,
        phone:   opPhone.trim(),
        role:    "turf-operator",
        ownerId,
        status:  "active",
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

      // ✅ BUG FIX #2 — filter "Other" out before saving to Firestore
      const finalSports = sports.filter((s) => s !== "Other");

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
      let operatorId    = "";
      let operatorName  = "";
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

          // ✅ BUG FIX #3 — if this existing operator is already assigned to
          // another turf, clear that old turf's operatorId first so no turf
          // ends up with a stale operatorId pointing at this person.
          if (op.turfId) {
            try {
              await updateDoc(doc(db, "turfs", op.turfId), {
                operatorId:    "",
                operatorName:  "",
                operatorEmail: "",
              });
            } catch {
              // non-fatal: old turf cleanup failure should not block turf creation
              console.warn("Could not clear operator from old turf:", op.turfId);
            }
          }
        }

        operatorId    = op.id;
        operatorName  = op.name  || "";
        operatorEmail = op.email || "";
      }

      // 3. Create turf document
      const turfRef = await addDoc(collection(db, "turfs"), {
        name:         name.trim(),
        location:     location.trim(),
        // ✅ All-India: city + area. Home/Explore filter turfs by cityId.
        cityId,
        cityName:     selectedCity?.name || "",
        locality:     locality.trim(),
        ...(pinLat != null && pinLng != null ? { latitude: pinLat, longitude: pinLng } : {}),
        // Ball Machine Only venues are cricket practice by definition — no
        // sport picker is shown for them, so don't rely on finalSports (empty).
        sport:        isBallMachineOnly ? ["Cricket"] : finalSports,     // ✅ BUG FIX #2: no stray "Other" string
        mapLink:      mapLink.trim(),
        // Regular slot pricing doesn't apply when this venue has no slot
        // booking at all — stored as 0 rather than left undefined, so any
        // screen reading these fields gets a safe number instead of NaN.
        dayPrice:     isBallMachineOnly ? 0 : Number(dayPrice),
        nightPrice:   isBallMachineOnly ? 0 : Number(nightPrice),
       
        price:        isBallMachineOnly ? 0 : Number(dayPrice), // legacy field kept for backwards compat
        openingTime:  Number(openingTime),
        closingTime:  Number(closingTime),
        slotDuration: isBallMachineOnly ? 0 : Number(slotDuration),
        // ✅ Lets any customer/admin screen know this venue has no regular
        // turf-slot booking flow at all — Ball Machine is its only offering.
        slotBookingEnabled: !isBallMachineOnly,
        image:        coverImage.trim() || images[0] || "",
        images,
        facilities:   selectedFacilities,
        ownerId:      owner.id,
        ownerName:    owner.name  || "",
        ownerEmail:   owner.email || "",
        operatorId,
        operatorName,
        operatorEmail,
        active:       true,
        createdAt:    serverTimestamp(),
                     bookingPrice: isBallMachineOnly || !needsAdvance ? 0 : Number(bookingPrice),

        // ✅ Offline/phone booking — set by admin only
        bookingMode,
        bookingPhone: bookingMode === "online"
          ? ""
          : bookingPhone.replace(/\D/g, "").slice(-10),

        venueType: venueType === "other"
  ? customVenueType.trim() || "other"
  : venueType,

        // ✅ Ball Machine — optional add-on (or the venue's whole offering)
        ballMachineEnabled,
        ...(ballMachineEnabled ? {
          ballMachineCount: Number(ballMachineCount),
          ...(ballMachineOpeningTime.trim() ? { ballMachineOpeningTime: Number(ballMachineOpeningTime) } : {}),
          ...(ballMachineClosingTime.trim() ? { ballMachineClosingTime: Number(ballMachineClosingTime) } : {}),
          ballMachinePackages,
        } : {}),
      });

      // ✅ BUG FIX #3 — write turfId + turfName back to operator's user doc
      // so operator's own fetchAll can find their turf without relying solely
      // on querying turfs where("operatorId","==", uid) and taking docs[0].
      if (addOperator && operatorId) {
        try {
          await updateDoc(doc(db, "users", operatorId), {
            turfId:   turfRef.id,
            turfName: name.trim(),
          });
        } catch {
          console.warn("Could not write turfId to operator user doc.");
        }
      }

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
    <View style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={DARK} />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── Hero ── */}
        {/* ── Hero ── */}
<View style={[styles.hero, { paddingTop: insets.top + 14 }]}>
          <View style={styles.glow1} />
          <View style={styles.glow2} />
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={20} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.heroTag}>Admin · Add Turf</Text>
          <Text style={styles.heroTitle}>New Turf</Text>
          <Text style={styles.heroSub}>
            Fill in turf details, assign an owner, optionally assign an operator, and go live.
          </Text>
        </View>

        {/* ══════════════════════════════════════════
            SECTION 1 — TURF DETAILS
        ══════════════════════════════════════════ */}
        <View style={styles.card}>
          <SectionHeader number="1" title="Turf Details" subtitle="Basic info about the turf" />

        <Field label="Venue Type *">
  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
    <View style={{ flexDirection: "row", gap: 8, paddingVertical: 4 }}>
      {VENUE_TYPES.map(v => (
        <TouchableOpacity
          key={v.key}
          style={[
            styles.venueChip,
            venueType === v.key && styles.venueChipActive,
          ]}
          onPress={() => {
            setVenueType(v.key);
            if (v.key !== "other") setCustomVenueType("");
          }}
        >
          <Text style={styles.venueChipEmoji}>{v.emoji}</Text>
          <Text style={[
            styles.venueChipLabel,
            venueType === v.key && styles.venueChipLabelActive,
          ]}>
            {v.label}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  </ScrollView>

  {/* Custom venue type input — only when Other is selected */}
  {venueType === "other" && (
    <View style={{ marginTop: 10 }}>
      <TextInput
        style={styles.input}
        placeholder="e.g. Skating Rink, Archery Range, Golf Course"
        placeholderTextColor="#9CA3AF"
        value={customVenueType}
        onChangeText={setCustomVenueType}
        autoCapitalize="words"
        returnKeyType="done"
      />
      <Text style={styles.hint}>
        This will be saved as the venue type for this listing.
      </Text>
      {/* Live preview */}
      {customVenueType.trim().length > 0 && (
        <View style={{
          flexDirection: "row", alignItems: "center", gap: 8,
          backgroundColor: "#F0FDF4", borderRadius: 10, padding: 10,
          marginTop: 8, borderWidth: 1, borderColor: "#86EFAC",
        }}>
          <Text style={{ fontSize: 13, color: "#15803D", fontWeight: "700" }}>
            Will be saved as:
          </Text>
          <Text style={{ fontSize: 13, color: "#15803D", fontWeight: "900" }}>
            "{customVenueType.trim()}"
          </Text>
        </View>
      )}
    </View>
  )}

  {/* Show currently selected type as a confirmation */}
  {venueType !== "other" && (
    <Text style={[styles.hint, { marginTop: 6 }]}>
      Selected: {VENUE_TYPES.find(v => v.key === venueType)?.emoji}{" "}
      {VENUE_TYPES.find(v => v.key === venueType)?.label}
    </Text>
  )}
</Field>

          <Field label="Turf Name *">
            <TextInput
              style={styles.input} placeholder="e.g. Green Arena"
              placeholderTextColor="#9CA3AF" value={name} onChangeText={setName}
            />
          </Field>

          {/* ── City (required) ── */}
          <Field label="City *">
            {cities.length === 0 ? (
              <TouchableOpacity style={styles.newOwnerBanner} onPress={() => router.push("/admin/cities" as any)}>
                <Ionicons name="alert-circle-outline" size={16} color="#1D4ED8" />
                <Text style={styles.newOwnerBannerText}>No cities yet — tap to set up your first city.</Text>
              </TouchableOpacity>
            ) : (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
                {cities.map((c) => {
                  const active = cityId === c.id;
                  return (
                    <TouchableOpacity key={c.id} style={[styles.chip, active && styles.chipActive]} onPress={() => setCityId(c.id)}>
                      <Text style={[styles.chipText, active && styles.chipTextActive]}>
                        {c.name}{c.status !== "live" ? ` · ${CITY_STATUS_META[c.status].label}` : ""}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            )}
            {selectedCity && selectedCity.status !== "live" && (
              <Text style={[styles.hint, { color: "#B45309" }]}>
                {selectedCity.name} is {CITY_STATUS_META[selectedCity.status].label.toLowerCase()} — players won't see this turf until the city is Live.
              </Text>
            )}
          </Field>

          <Field label="Area / Locality *">
            <TextInput
              style={styles.input} placeholder="e.g. Rajapeth, Camp, Badnera"
              placeholderTextColor="#9CA3AF" value={locality}
              onChangeText={(v) => {
                setLocality(v);
                // keep the display line in step while it's still auto-made
                const auto = [locality.trim(), selectedCity?.name].filter(Boolean).join(", ");
                if (!location.trim() || location.trim() === auto) {
                  setLocation([v.trim(), selectedCity?.name].filter(Boolean).join(", "));
                }
              }}
              autoCapitalize="words"
            />
            <Text style={styles.hint}>Used for the area filter inside a city.</Text>
          </Field>

          <Field label="Location (shown on cards) *">
            <TextInput
              style={styles.input} placeholder="Area, City"
              placeholderTextColor="#9CA3AF" value={location} onChangeText={setLocation}
            />
          </Field>

          <Field label="Map Pin">
            <TouchableOpacity style={styles.mapPinBtn} onPress={() => setShowMap(true)} activeOpacity={0.85}>
              <Ionicons name="map-outline" size={18} color="#fff" />
              <Text style={styles.mapPinBtnText}>{pinLat != null ? "Change pin" : "Open map & drop pin"}</Text>
              {pinLat != null && pinLng != null && (
                <View style={styles.mapPinPill}>
                  <Text style={styles.mapPinPillText}>{pinLat.toFixed(4)}, {pinLng!.toFixed(4)}</Text>
                </View>
              )}
            </TouchableOpacity>
            <Text style={styles.hint}>
              {pinLat != null ? "✓ Pin set — distance and \"Near you\" will work for this turf." : "Recommended: without a pin, players can't see how far this turf is."}
            </Text>
          </Field>

          {/* Sport chips — not shown for Ball Machine Only venues (always Cricket) */}
          {!isBallMachineOnly && (
          <Field label="Sport *">
            {/* ✅ BUG FIX #1 — sport chips now show a "selected" summary so
                the user can see what they picked even before scrolling */}
            {sports.filter((s) => s !== "Other").length > 0 && (
              <View style={styles.selectedFacRow}>
                <Text style={styles.selectedFacText}>
                  Selected: {sports.filter((s) => s !== "Other").join(", ")}
                </Text>
              </View>
            )}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chipRow}
            >
              {SPORTS.map((s) => {
                // ✅ BUG FIX #1 — a custom sport that replaced "Other" is now
                // stored as its actual name, so SPORTS chips won't falsely
                // highlight "Other" after the user typed a custom sport.
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
            </ScrollView>

            {/* Custom sport input — only shown while "Other" is in sports[] */}
            {sports.includes("Other") && (
              <View style={{ marginTop: 10 }}>
                <TextInput
                  style={styles.input}
                  placeholder="Enter custom sport name (e.g. Handball)"
                  placeholderTextColor="#9CA3AF"
                  value={customSport}
                  onChangeText={setCustomSport}
                  returnKeyType="done"
                  onBlur={() => {
                    const trimmed = customSport.trim();
                    if (trimmed.length > 0) {
                      // Replace "Other" with the actual sport name
                      setSports((prev) => [
                        ...prev.filter((s) => s !== "Other"),
                        trimmed,
                      ]);
                      setCustomSport("");
                    }
                    // ✅ BUG FIX #1c — if user blurred with empty input, remove
                    // "Other" from sports[] so validate() doesn't see it
                    // (old code left "Other" in the array on empty blur)
                    else {
                      setSports((prev) => prev.filter((s) => s !== "Other"));
                    }
                  }}
                  onSubmitEditing={() => {
                    const trimmed = customSport.trim();
                    if (trimmed.length > 0) {
                      setSports((prev) => [
                        ...prev.filter((s) => s !== "Other"),
                        trimmed,
                      ]);
                      setCustomSport("");
                    } else {
                      setSports((prev) => prev.filter((s) => s !== "Other"));
                    }
                  }}
                />
                <Text style={[styles.hint, { marginTop: 5 }]}>
                  Press Done or tap away to add your custom sport.
                </Text>
              </View>
            )}
          </Field>
          )}

          {isBallMachineOnly && (
            <View style={[styles.newOwnerBanner, { marginTop: 14 }]}>
              <Ionicons name="information-circle-outline" size={16} color="#1D4ED8" />
              <Text style={styles.newOwnerBannerText}>
                Ball Machine Only venues are cricket practice by default — no sport selection needed.
              </Text>
            </View>
          )}

          <Field label="Google Maps Link">
            <TextInput
              style={styles.input} placeholder="https://maps.google.com/..."
              placeholderTextColor="#9CA3AF" value={mapLink} onChangeText={setMapLink}
              autoCapitalize="none"
            />
          </Field>

          {/* Pricing — not applicable when there's no regular slot booking */}
          {!isBallMachineOnly && (
          <Field label="Pricing *">
            <View style={styles.priceRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.priceLabel}>Day (6AM–6PM)</Text>
                <TextInput
                  style={styles.input} placeholder="₹/slot"
                  placeholderTextColor="#9CA3AF" keyboardType="numeric"
                  value={dayPrice} onChangeText={setDayPrice}
                />
              </View>
              <View style={{ width: 12 }} />
              <View style={{ flex: 1 }}>
                <Text style={styles.priceLabel}>Night (6PM–6AM)</Text>
                <TextInput
                  style={styles.input} placeholder="₹/slot"
                  placeholderTextColor="#9CA3AF" keyboardType="numeric"
                  value={nightPrice} onChangeText={setNightPrice}
                />
              </View>
            </View>
                        {needsAdvance && (
              <>
                <Text style={styles.priceLabel}>Advance Booking Amount</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Amount user pays online to lock the slot"
                  placeholderTextColor="#9CA3AF" keyboardType="numeric"
                  value={bookingPrice} onChangeText={setBookingPrice}
                />
                <Text style={styles.hint}>
                  This is the advance the user pays via Razorpay. Rest is collected at venue.
                </Text>
              </>
            )}
          </Field>
          )}

                    {/* ── Booking Mode (admin only) ── */}
          <Field label="Booking Mode *">
            <View style={styles.modeRow}>
              {BOOKING_MODES.map((m) => {
                const active = bookingMode === m.key;
                return (
                  <TouchableOpacity
                    key={m.key}
                    style={[styles.modeBtn, active && styles.modeBtnActive]}
                    onPress={() => setBookingMode(m.key)}
                  >
                    <Ionicons
                      name={m.icon as any} size={14}
                      color={active ? "#fff" : "#6B7280"}
                      style={{ marginRight: 6 }}
                    />
                    <Text style={[styles.modeBtnText, active && styles.modeBtnTextActive]}>
                      {m.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={styles.hint}>
              {bookingMode === "online" && "Users book and pay the advance in the app."}
              {bookingMode === "phone"  && "No online booking. Users see facilities and call this number to book."}
              {bookingMode === "both"   && "Users can book online or call this number."}
            </Text>

            {bookingMode !== "online" && (
              <View style={{ marginTop: 10 }}>
                <TextInput
                  style={styles.input}
                  placeholder="Turf booking number (10 digits)"
                  placeholderTextColor="#9CA3AF"
                  keyboardType="phone-pad"
                  maxLength={13}
                  value={bookingPhone}
                  onChangeText={setBookingPhone}
                />
                {(selectedOwner?.phone || ownerPhone) ? (
                  <TouchableOpacity
                    onPress={() => setBookingPhone(selectedOwner?.phone || ownerPhone)}
                  >
                    <Text style={[styles.hint, { color: ACCENT, fontWeight: "700" }]}>
                      Use owner's number ({selectedOwner?.phone || ownerPhone})
                    </Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            )}
          </Field>

          {/* Timings — opening/closing hour always required (general venue
              hours, and the default source for Ball Machine's own hours);
              Slot Duration only applies when there's regular slot booking. */}
          <Field label={isBallMachineOnly ? "Venue Hours *" : "Timings *"}>
            <View style={styles.priceRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.priceLabel}>Opening Hour (0–23)</Text>
                <TextInput
                  style={styles.input} placeholder="6"
                  placeholderTextColor="#9CA3AF" keyboardType="numeric"
                  value={openingTime} onChangeText={setOpeningTime}
                />
              </View>
              <View style={{ width: 12 }} />
              <View style={{ flex: 1 }}>
                <Text style={styles.priceLabel}>Closing Hour (1–28)</Text>
                <TextInput
                  style={styles.input} placeholder="23"
                  placeholderTextColor="#9CA3AF" keyboardType="numeric"
                  value={closingTime} onChangeText={setClosingTime}
                />
              </View>
            </View>
            {Number(closingTime) > 24 && (
              <Text style={styles.hint}>
                🌙 Closes at {Number(closingTime) - 24}:00 AM next day. Owner can set the late-night booking cutoff in My Turfs.
              </Text>
            )}
            {!isBallMachineOnly && (
              <>
                <Text style={styles.priceLabel}>Slot Duration (minutes)</Text>
                <View style={styles.chipRow}>
                  {["30", "60", "90", "120"].map((d) => (
                    <TouchableOpacity
                      key={d}
                      style={[styles.chip, slotDuration === d && styles.chipActive]}
                      onPress={() => setSlotDuration(d)}
                    >
                      <Text style={[styles.chipText, slotDuration === d && styles.chipTextActive]}>
                        {d} min
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            )}
            {isBallMachineOnly && (
              <Text style={styles.hint}>
                Used as this venue's default Ball Machine hours below (unless overridden there).
              </Text>
            )}
          </Field>
        </View>

        {/* ══════════════════════════════════════════
            SECTION 2 — BALL MACHINE (optional)
        ══════════════════════════════════════════ */}
        <View style={styles.card}>
          <SectionHeader
            number="2" title="Ball Machine"
            subtitle={isBallMachineOnly
              ? "This venue's only offering — required"
              : "Optional — pay-per-over bowling machine practice"}
          />

          {isBallMachineOnly ? (
            <View style={styles.bmToggleRow}>
              <Ionicons name="lock-closed" size={16} color={ACCENT} style={{ marginRight: 10 }} />
              <Text style={[styles.hint, { flex: 1 }]}>
                Ball Machine is always on for a "Ball Machine Only" venue — set its details below.
              </Text>
            </View>
          ) : (
            <View style={styles.bmToggleRow}>
              <View style={{ flex: 1, marginRight: 12 }}>
                <Text style={styles.bmToggleTitle}>Offer Ball Machine at this venue</Text>
                <Text style={styles.hint}>
                  Short, pre-booked practice sessions (e.g. 6 overs / ₹150) — separate from regular slot bookings above.
                </Text>
              </View>
              <Switch
                value={ballMachineEnabled}
                onValueChange={setBallMachineEnabled}
                trackColor={{ false: "#E5E7EB", true: ACCENT }}
                thumbColor="#fff"
              />
            </View>
          )}

          {ballMachineEnabled && (
            <>
              <Field label="Number of Machines *">
                <TextInput
                  style={styles.input} placeholder="e.g. 1"
                  placeholderTextColor="#9CA3AF" keyboardType="numeric"
                  value={ballMachineCount} onChangeText={setBallMachineCount}
                />
                <Text style={styles.hint}>How many bays/machines can run bookings in parallel.</Text>
              </Field>

              <Field label="Operating Hours (optional)">
                <View style={styles.priceRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.priceLabel}>Opening Hour (0–23)</Text>
                    <TextInput
                      style={styles.input} placeholder={`Default: ${openingTime || "6"}`}
                      placeholderTextColor="#9CA3AF" keyboardType="numeric"
                      value={ballMachineOpeningTime} onChangeText={setBallMachineOpeningTime}
                    />
                  </View>
                  <View style={{ width: 12 }} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.priceLabel}>Closing Hour (1–24)</Text>
                    <TextInput
                      style={styles.input} placeholder={`Default: ${closingTime || "23"}`}
                      placeholderTextColor="#9CA3AF" keyboardType="numeric"
                      value={ballMachineClosingTime} onChangeText={setBallMachineClosingTime}
                    />
                  </View>
                </View>
                <Text style={styles.hint}>Leave blank to use the turf's regular timings above.</Text>
              </Field>

              <Field label="Packages *">
                {ballMachinePackages.length > 0 && (
                  <View style={{ gap: 8, marginBottom: 12 }}>
                    {ballMachinePackages.map((p) => (
                      <View key={p.id} style={styles.bmPkgRow}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.bmPkgLabel}>{p.label}</Text>
                          <Text style={styles.bmPkgMeta}>{p.durationMinutes} min · ₹{p.price}</Text>
                        </View>
                        <TouchableOpacity onPress={() => removeBallMachinePackage(p.id)}>
                          <Ionicons name="close-circle" size={20} color="#DC2626" />
                        </TouchableOpacity>
                      </View>
                    ))}
                  </View>
                )}

                <View style={styles.bmPkgForm}>
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.priceLabel}>Overs</Text>
                      <TextInput
                        style={styles.input} placeholder="6"
                        placeholderTextColor="#9CA3AF" keyboardType="numeric"
                        value={pkgOvers} onChangeText={setPkgOvers}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.priceLabel}>Duration (min)</Text>
                      <TextInput
                        style={styles.input} placeholder="15"
                        placeholderTextColor="#9CA3AF" keyboardType="numeric"
                        value={pkgDurationMinutes} onChangeText={setPkgDurationMinutes}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.priceLabel}>Price (₹)</Text>
                      <TextInput
                        style={styles.input} placeholder="150"
                        placeholderTextColor="#9CA3AF" keyboardType="numeric"
                        value={pkgPrice} onChangeText={setPkgPrice}
                      />
                    </View>
                  </View>
                  <TouchableOpacity style={styles.bmAddPkgBtn} onPress={addBallMachinePackage} activeOpacity={0.85}>
                    <Ionicons name="add" size={16} color="#fff" />
                    <Text style={styles.bmAddPkgText}>Add Package</Text>
                  </TouchableOpacity>
                </View>
                <Text style={styles.hint}>
                  e.g. 6 overs / 15 min / ₹150, and 12 overs / 30 min / ₹300. Add as many tiers as this venue offers.
                </Text>
              </Field>
            </>
          )}
        </View>

        {/* ══════════════════════════════════════════
            SECTION 3 — FACILITIES
        ══════════════════════════════════════════ */}
        <View style={styles.card}>
          <SectionHeader number="3" title="Facilities" subtitle="Tap to select what's available" />
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
                  <Text style={[styles.facilityLabel, active && styles.facilityLabelActive]}>
                    {f.label}
                  </Text>
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

        {/* ══════════════════════════════════════════
            SECTION 3 — IMAGES
        ══════════════════════════════════════════ */}
        <View style={styles.card}>
          <SectionHeader number="4" title="Images" subtitle="Cover image + gallery" />

          <Field label="Cover Image URL">
            <TextInput
              style={styles.input} placeholder="Main image URL (shown on card)"
              placeholderTextColor="#9CA3AF" value={coverImage} onChangeText={setCoverImage}
              autoCapitalize="none"
            />
          </Field>

          <Field label="Gallery Images">
            <View style={styles.imageRow}>
              <TextInput
                style={[styles.input, { flex: 1 }]} placeholder="Paste image URL"
                placeholderTextColor="#9CA3AF" value={imageInput} onChangeText={setImageInput}
                autoCapitalize="none"
              />
              <TouchableOpacity style={styles.addImgBtn} onPress={addImage}>
                <Ionicons name="add" size={22} color="#fff" />
              </TouchableOpacity>
            </View>
            {images.length > 0 && (
              <View style={{ marginTop: 12, gap: 8 }}>
                {images.map((img, i) => (
                  <View key={i} style={styles.imageTag}>
                    <Text style={styles.imageTagText} numberOfLines={1}>
                      📷 Image {i + 1} — {img}
                    </Text>
                    <TouchableOpacity onPress={() => removeImage(i)}>
                      <Ionicons name="close-circle" size={18} color="#DC2626" />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}
          </Field>
        </View>

        {/* ══════════════════════════════════════════
            SECTION 4 — OWNER
        ══════════════════════════════════════════ */}
        <View style={styles.card}>
          <SectionHeader
            number="5" title="Owner"
            subtitle="Assign to an existing owner or create a new one"
          />

          <View style={styles.modeRow}>
            {(["existing", "new"] as const).map((m) => (
              <TouchableOpacity
                key={m}
                style={[styles.modeBtn, ownerMode === m && styles.modeBtnActive]}
                onPress={() => {
                  setOwnerMode(m);
                  setSelectedOwner(null); // ✅ BUG FIX #4: clear previous selection on mode switch
                }}
              >
                <Ionicons
                  name={m === "existing" ? "people-outline" : "person-add-outline"}
                  size={14} color={ownerMode === m ? "#fff" : "#6B7280"}
                  style={{ marginRight: 6 }}
                />
                <Text style={[styles.modeBtnText, ownerMode === m && styles.modeBtnTextActive]}>
                  {m === "existing" ? "Existing Owner" : "Create New Owner"}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {ownerMode === "existing" ? (
            <>
              <TextInput
                style={[styles.input, { marginBottom: 10 }]}
                placeholder="🔍  Search by name or email"
                placeholderTextColor="#9CA3AF"
                value={ownerSearch} onChangeText={setOwnerSearch}
              />
              {loadingOwners ? (
                <View style={styles.loaderRow}>
                  <ActivityIndicator color={ACCENT} />
                  <Text style={styles.loaderText}>Loading owners...</Text>
                </View>
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
                      <TouchableOpacity
                        key={o.id}
                        style={[styles.ownerCard, selected && styles.ownerCardSelected]}
                        onPress={() => setSelectedOwner(o)}
                        activeOpacity={0.8}
                      >
                        <View style={[styles.ownerAvatar, selected && { backgroundColor: "#fff" }]}>
                          <Text style={[styles.ownerAvatarText, selected && { color: DARK }]}>
                            {(o.name || "?")[0].toUpperCase()}
                          </Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.ownerName, selected && styles.ownerNameSelected]}>
                            {o.name || "No name"}
                          </Text>
                          <Text style={[styles.ownerMeta, selected && styles.ownerMetaSelected]}>
                            {o.email}
                          </Text>
                          {o.phone ? (
                            <Text style={[styles.ownerMeta, selected && styles.ownerMetaSelected]}>
                              {o.phone}
                            </Text>
                          ) : null}
                        </View>
                        {selected && (
                          <Ionicons name="checkmark-circle" size={20} color="#4ADE80" />
                        )}
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
                <TextInput
                  style={styles.input} placeholder="Owner's full name"
                  placeholderTextColor="#9CA3AF" value={ownerName} onChangeText={setOwnerName}
                />
              </Field>
              <Field label="Business Name *">
                <TextInput
                  style={styles.input} placeholder="e.g. Sports Arena Pvt Ltd"
                  placeholderTextColor="#9CA3AF" value={ownerBusiness} onChangeText={setOwnerBusiness}
                />
              </Field>
              <Field label="Email *">
                <TextInput
                  style={styles.input} placeholder="owner@email.com"
                  placeholderTextColor="#9CA3AF" value={ownerEmail} onChangeText={setOwnerEmail}
                  keyboardType="email-address" autoCapitalize="none"
                />
              </Field>
              <Field label="Temporary Password *">
                <View style={styles.pwRow}>
                  <TextInput
                    style={[styles.input, { flex: 1 }]} placeholder="Min. 6 characters"
                    placeholderTextColor="#9CA3AF" value={ownerPassword}
                    onChangeText={setOwnerPassword} secureTextEntry={!showPassword}
                    autoCapitalize="none"
                  />
                  <TouchableOpacity style={styles.eyeBtn} onPress={() => setShowPassword((p) => !p)}>
                    <Ionicons
                      name={showPassword ? "eye-off-outline" : "eye-outline"}
                      size={18} color="#6B7280"
                    />
                  </TouchableOpacity>
                </View>
                <Text style={styles.hint}>Share this with the owner so they can log in and change it.</Text>
              </Field>
              <Field label="Phone *">
                <TextInput
                  style={styles.input} placeholder="10-digit mobile number"
                  placeholderTextColor="#9CA3AF" value={ownerPhone} onChangeText={setOwnerPhone}
                  keyboardType="phone-pad"
                />
              </Field>
              <Field label="Location">
                <TextInput
                  style={styles.input} placeholder="City or area"
                  placeholderTextColor="#9CA3AF" value={ownerLocation} onChangeText={setOwnerLocation}
                />
              </Field>
            </>
          )}
        </View>

        {/* ══════════════════════════════════════════
            SECTION 4b — BANKING DETAILS
            Only shown when creating a NEW owner
        ══════════════════════════════════════════ */}
        {ownerMode === "new" && (
          <View style={styles.card}>
            <SectionHeader
              number="5b"
              title="Banking Details"
              subtitle="For settlements and payouts to the owner"
            />

            <View style={styles.bankBanner}>
              <Ionicons name="shield-checkmark-outline" size={16} color="#0EA5A4" />
              <Text style={styles.bankBannerText}>
                These details are used for processing payouts. Stored securely.
              </Text>
            </View>

            <Field label="Account Holder Name *">
              <TextInput
                style={styles.input}
                placeholder="Name as on bank account"
                placeholderTextColor="#9CA3AF"
                value={bankName}
                onChangeText={setBankName}
                autoCapitalize="words"
              />
            </Field>

            <Field label="Bank Account Number *">
              <TextInput
                style={styles.input}
                placeholder="e.g. 123456789012"
                placeholderTextColor="#9CA3AF"
                value={bankAccountNo}
                onChangeText={setBankAccountNo}
                keyboardType="numeric"
                secureTextEntry={false}
              />
            </Field>

            <Field label="IFSC Code *">
              <TextInput
                style={styles.input}
                placeholder="e.g. SBIN0001234"
                placeholderTextColor="#9CA3AF"
                value={bankIfsc}
                onChangeText={(v) => setBankIfsc(v.toUpperCase())}
                autoCapitalize="characters"
                maxLength={11}
              />
              <Text style={styles.hint}>11-character code — find it on your cheque or bank app.</Text>
            </Field>

            <Field label="UPI ID (Optional)">
              <TextInput
                style={styles.input}
                placeholder="e.g. owner@upi or 9876543210@ybl"
                placeholderTextColor="#9CA3AF"
                value={bankUpi}
                onChangeText={setBankUpi}
                autoCapitalize="none"
                keyboardType="email-address"
              />
              <Text style={styles.hint}>Faster payouts via UPI. Leave blank to use bank account only.</Text>
            </Field>
          </View>
        )}

        {/* ══════════════════════════════════════════
            SECTION 5 — OPERATOR (optional)
        ══════════════════════════════════════════ */}
        <View style={styles.card}>
          <View style={styles.operatorToggleRow}>
            <View style={{ flex: 1 }}>
              <SectionHeader
                number="6" title="Turf Operator"
                subtitle="Person present at turf to manage daily ops"
              />
            </View>
            <Switch
              value={addOperator}
              onValueChange={(val) => {
                setAddOperator(val);
                // ✅ BUG FIX #4: reset operator selection when toggled off
                if (!val) {
                  setSelectedOperator(null);
                  setOperatorMode("existing");
                  setOperatorSearch("");
                }
              }}
              trackColor={{ false: "#E5E7EB", true: ACCENT }}
              thumbColor="#fff"
            />
          </View>

          {addOperator && (
            <>
              <View style={styles.modeRow}>
                {(["existing", "new"] as const).map((m) => (
                  <TouchableOpacity
                    key={m}
                    style={[styles.modeBtn, operatorMode === m && styles.modeBtnActive]}
                    onPress={() => {
                      setOperatorMode(m);
                      setSelectedOperator(null); // ✅ BUG FIX #4: clear on mode switch
                    }}
                  >
                    <Ionicons
                      name={m === "existing" ? "people-outline" : "person-add-outline"}
                      size={14} color={operatorMode === m ? "#fff" : "#6B7280"}
                      style={{ marginRight: 6 }}
                    />
                    <Text style={[styles.modeBtnText, operatorMode === m && styles.modeBtnTextActive]}>
                      {m === "existing" ? "Existing Operator" : "Create New Operator"}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {operatorMode === "existing" ? (
                <>
                  <TextInput
                    style={[styles.input, { marginBottom: 10 }]}
                    placeholder="🔍  Search operators"
                    placeholderTextColor="#9CA3AF"
                    value={operatorSearch} onChangeText={setOperatorSearch}
                  />
                  {loadingOperators ? (
                    <View style={styles.loaderRow}>
                      <ActivityIndicator color={ACCENT} />
                      <Text style={styles.loaderText}>Loading operators...</Text>
                    </View>
                  ) : filteredOperators.length === 0 ? (
                    <View style={styles.emptyBox}>
                      <Ionicons name="person-outline" size={28} color="#D1D5DB" />
                      <Text style={styles.emptyText}>No operators found. Create one.</Text>
                    </View>
                  ) : (
                    <View style={styles.ownerList}>
                      {filteredOperators.map((o) => {
                        const sel = selectedOperator?.id === o.id;
                        // ✅ BUG FIX #3: show warning if this operator is
                        // already assigned to another turf
                        const alreadyAssigned = !!o.turfId;
                        return (
                          <TouchableOpacity
                            key={o.id}
                            style={[styles.ownerCard, sel && styles.ownerCardSelected]}
                            onPress={() => setSelectedOperator(o)}
                            activeOpacity={0.8}
                          >
                            <View style={[styles.ownerAvatar, sel && { backgroundColor: "#fff" }]}>
                              <Text style={[styles.ownerAvatarText, sel && { color: DARK }]}>
                                {(o.name || "?")[0].toUpperCase()}
                              </Text>
                            </View>
                            <View style={{ flex: 1 }}>
                              <Text style={[styles.ownerName, sel && styles.ownerNameSelected]}>
                                {o.name}
                              </Text>
                              <Text style={[styles.ownerMeta, sel && styles.ownerMetaSelected]}>
                                {o.email}
                              </Text>
                              {/* ✅ BUG FIX #3: warn admin this op will be moved */}
                              {alreadyAssigned && (
                                <Text style={styles.opWarning}>
                                  ⚠ Already assigned to another turf — will be moved
                                </Text>
                              )}
                            </View>
                            {sel && (
                              <Ionicons name="checkmark-circle" size={20} color="#4ADE80" />
                            )}
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
                    <TextInput
                      style={styles.input} placeholder="Operator's full name"
                      placeholderTextColor="#9CA3AF" value={opName} onChangeText={setOpName}
                    />
                  </Field>
                  <Field label="Email *">
                    <TextInput
                      style={styles.input} placeholder="operator@email.com"
                      placeholderTextColor="#9CA3AF" value={opEmail} onChangeText={setOpEmail}
                      keyboardType="email-address" autoCapitalize="none"
                    />
                  </Field>
                  <Field label="Temporary Password *">
                    <View style={styles.pwRow}>
                      <TextInput
                        style={[styles.input, { flex: 1 }]} placeholder="Min. 6 characters"
                        placeholderTextColor="#9CA3AF" value={opPassword}
                        onChangeText={setOpPassword} secureTextEntry={!showOpPassword}
                        autoCapitalize="none"
                      />
                      <TouchableOpacity
                        style={styles.eyeBtn}
                        onPress={() => setShowOpPassword((p) => !p)}
                      >
                        <Ionicons
                          name={showOpPassword ? "eye-off-outline" : "eye-outline"}
                          size={18} color="#6B7280"
                        />
                      </TouchableOpacity>
                    </View>
                  </Field>
                  <Field label="Phone *">
                    <TextInput
                      style={styles.input} placeholder="10-digit mobile number"
                      placeholderTextColor="#9CA3AF" value={opPhone} onChangeText={setOpPhone}
                      keyboardType="phone-pad"
                    />
                  </Field>
                </>
              )}
            </>
          )}

          {!addOperator && (
            <View style={styles.operatorOffBox}>
              <Ionicons name="person-remove-outline" size={20} color="#9CA3AF" />
              <Text style={styles.operatorOffText}>
                No operator assigned. You can add one later from the turf settings.
              </Text>
            </View>
          )}
        </View>

        {/* ── Submit ── */}
        <TouchableOpacity
          style={[styles.submitBtn, saving && { opacity: 0.65 }]}
          onPress={handleAdd}
          disabled={saving}
          activeOpacity={0.85}
        >
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

      <MapPickerModal
        visible={showMap}
        initialLocation={[locality, selectedCity?.name].filter(Boolean).join(", ") || selectedCity?.name || "India"}
        initialLat={pinLat ?? selectedCity?.lat ?? undefined}
        initialLng={pinLng ?? selectedCity?.lng ?? undefined}
        onConfirm={onMapConfirm}
        onClose={() => setShowMap(false)}
      />
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: "#F0F4F8" },
  scroll: { paddingBottom: 24 },

  hero: {
    backgroundColor: DARK,
    paddingHorizontal: 20,
   
    paddingBottom: 28,
    overflow: "hidden",
  },
  glow1:    { position: "absolute", top: -40, right: -30, width: 180, height: 180, borderRadius: 90, backgroundColor: "rgba(14,165,164,0.15)" },
  glow2:    { position: "absolute", bottom: -60, left: -40, width: 160, height: 160, borderRadius: 80, backgroundColor: "rgba(99,102,241,0.12)" },
  backBtn:  { width: 36, height: 36, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.1)", justifyContent: "center", alignItems: "center", marginBottom: 14 },
  heroTag:  { color: "#9CA3AF", fontSize: 11, fontWeight: "800", letterSpacing: 1.2, textTransform: "uppercase" },
  heroTitle:{ color: "#FFFFFF", fontSize: 28, fontWeight: "900", marginTop: 4 },
  heroSub:  { color: "#9CA3AF", fontSize: 13, lineHeight: 20, marginTop: 6 },

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

  chipRow:        { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingVertical: 4 },
  chip:           { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20, backgroundColor: "#F3F4F6", borderWidth: 1, borderColor: "#E5E7EB" },
  chipActive:     { backgroundColor: DARK, borderColor: DARK },
  chipText:       { fontSize: 13, fontWeight: "700", color: "#6B7280" },
  chipTextActive: { color: "#fff" },

  priceRow:   { flexDirection: "row", marginBottom: 12 },
  priceLabel: { fontSize: 11, fontWeight: "700", color: "#9CA3AF", marginBottom: 6 },

  imageRow:    { flexDirection: "row", gap: 10, alignItems: "center" },
  addImgBtn:   { backgroundColor: DARK, width: 46, height: 46, borderRadius: 12, justifyContent: "center", alignItems: "center" },
  imageTag:    { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "#F3F4F6", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
  imageTagText:{ fontSize: 13, color: "#374151", fontWeight: "600", flex: 1, marginRight: 8 },

  selectedFacRow:    { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  selectedFacText:   { fontSize: 12, fontWeight: "700", color: ACCENT, flex: 1, flexWrap: "wrap" },
  clearText:         { fontSize: 12, color: "#DC2626", fontWeight: "700" },
  facilityGrid:      { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  facilityBtn:       { width: "30%", alignItems: "center", paddingVertical: 14, backgroundColor: "#F9FAFB", borderRadius: 14, borderWidth: 1.5, borderColor: "#E5E7EB", position: "relative" },
  facilityBtnActive: { backgroundColor: "#F0FDF4", borderColor: ACCENT },
  facilityIcon:      { fontSize: 22, marginBottom: 6 },
  facilityLabel:     { fontSize: 11, fontWeight: "700", color: "#6B7280", textAlign: "center" },
  facilityLabelActive:{ color: "#0F766E" },
  facilityCheck:     { position: "absolute", top: 6, right: 6, width: 16, height: 16, borderRadius: 8, backgroundColor: ACCENT, justifyContent: "center", alignItems: "center" },

  modeRow:          { flexDirection: "row", gap: 10, marginBottom: 16 },
  modeBtn:          { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 12, borderRadius: 12, backgroundColor: "#F3F4F6", borderWidth: 1, borderColor: "#E5E7EB" },
  modeBtnActive:    { backgroundColor: DARK, borderColor: DARK },
  modeBtnText:      { fontSize: 13, fontWeight: "700", color: "#6B7280" },
  modeBtnTextActive:{ color: "#fff" },

  ownerList:          { gap: 10 },
  ownerCard:          { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#F9FAFB", borderRadius: 14, padding: 14, borderWidth: 1.5, borderColor: "#E5E7EB" },
  ownerCardSelected:  { backgroundColor: DARK, borderColor: DARK },
  ownerAvatar:        { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.15)", justifyContent: "center", alignItems: "center" },
  ownerAvatarText:    { fontSize: 16, fontWeight: "900", color: "#fff" },
  ownerName:          { fontSize: 15, fontWeight: "800", color: "#111827" },
  ownerNameSelected:  { color: "#fff" },
  ownerMeta:          { fontSize: 12, color: "#9CA3AF", marginTop: 2 },
  ownerMetaSelected:  { color: "rgba(255,255,255,0.7)" },
  opWarning:          { fontSize: 11, color: "#D97706", marginTop: 3, fontWeight: "600" },

  newOwnerBanner:     { flexDirection: "row", alignItems: "flex-start", gap: 8, backgroundColor: "#EFF6FF", borderRadius: 12, padding: 12, marginBottom: 4, borderWidth: 1, borderColor: "#BFDBFE" },
  newOwnerBannerText: { fontSize: 12, color: "#1D4ED8", fontWeight: "600", flex: 1, lineHeight: 18 },

  pwRow:  { flexDirection: "row", alignItems: "center", gap: 8 },
  eyeBtn: { padding: 8 },

  operatorToggleRow: { flexDirection: "row", alignItems: "flex-start" },
  operatorOffBox:    { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#F9FAFB", borderRadius: 12, padding: 14, borderWidth: 1, borderColor: "#F3F4F6" },
  operatorOffText:   { fontSize: 13, color: "#9CA3AF", flex: 1, fontWeight: "500" },

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

  // ✅ Map pin
  mapPinBtn:      { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: ACCENT, paddingVertical: 13, paddingHorizontal: 14, borderRadius: 12 },
  mapPinBtnText:  { color: "#fff", fontWeight: "800", fontSize: 14, flex: 1 },
  mapPinPill:     { backgroundColor: "rgba(255,255,255,0.25)", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  mapPinPillText: { fontSize: 10, color: "#fff", fontWeight: "700" },

  // ✅ Banking section
  bankBanner:     { flexDirection: "row", alignItems: "flex-start", gap: 8, backgroundColor: "#F0FDFA", borderRadius: 12, padding: 12, marginBottom: 4, borderWidth: 1, borderColor: "#99F6E4" },
  bankBannerText: { fontSize: 12, color: "#0F766E", fontWeight: "600", flex: 1, lineHeight: 18 },

  // ✅ Ball Machine section
  bmToggleRow:   { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 4 },
  bmToggleTitle: { fontSize: 14, fontWeight: "800", color: "#111827", marginBottom: 4 },
  bmPkgRow:      { flexDirection: "row", alignItems: "center", backgroundColor: "#F9FAFB", borderRadius: 12, padding: 12, borderWidth: 1, borderColor: "#E5E7EB" },
  bmPkgLabel:    { fontSize: 14, fontWeight: "800", color: "#111827" },
  bmPkgMeta:     { fontSize: 12, color: "#6B7280", marginTop: 2, fontWeight: "600" },
  bmPkgForm:     { backgroundColor: "#F9FAFB", borderRadius: 14, padding: 12, borderWidth: 1, borderColor: "#E5E7EB" },
  bmAddPkgBtn:   { flexDirection: "row", alignItems: "center", justifyContent: "center", backgroundColor: DARK, borderRadius: 10, paddingVertical: 10, marginTop: 10, gap: 6 },
  bmAddPkgText:  { color: "#fff", fontSize: 13, fontWeight: "800" },

  venueChip:          { alignItems: "center", paddingHorizontal: 14, paddingVertical: 10, borderRadius: 14, backgroundColor: "#F3F4F6", borderWidth: 1.5, borderColor: "#E5E7EB", minWidth: 90 },
venueChipActive:    { backgroundColor: DARK, borderColor: DARK },
venueChipEmoji:     { fontSize: 20, textAlign: "center" },
venueChipLabel:     { fontSize: 11, fontWeight: "700", color: "#6B7280", marginTop: 5, textAlign: "center" },
venueChipLabelActive:{ color: "#fff" },
});
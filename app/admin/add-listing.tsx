/**
 * admin/add-listing.tsx — Quick Add Turf (call to book)
 *
 * For turfs you add yourself without waiting for the owner:
 *   required: name · city · area · booking phone
 *   optional: sports · latitude/longitude (or paste a Google Maps link) ·
 *             day/night price · Advance Pricing · hours · photos · facilities · owner name
 *
 * Saved exactly like an approved Turf Request (call-to-book listing):
 *   bookingMode "phone", ownerId "", listingType "listing", addedBy "admin".
 *   No photo → default PlayOn photo · no price → "Price on call" (utils/turfDisplay.ts).
 * Later: Admin → Turfs → Edit to add an owner or switch to online booking.
 */
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ScrollView,
  StatusBar, ActivityIndicator, Switch, Image, KeyboardAvoidingView, Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { collection, addDoc, serverTimestamp } from "firebase/firestore";
import { db, auth } from "../../firebaseConfig";
import { City, CITY_STATUS_META, fetchCities, guessCity, haversineKm } from "../../utils/cities";
import { pickPhotos, uploadPhoto } from "../../utils/cloudinary";
import { DEFAULT_TURF_IMAGE } from "../../utils/turfDisplay";

const DARK = "#0A0F1E";
const ACCENT = "#0EA5A4";
const PURPLE = "#7C3AED";

const SPORTS = ["Cricket", "Football", "Pickleball", "Badminton", "Basketball", "Tennis", "Volleyball", "Kabaddi", "Hockey"];
const FACILITIES = [
  "Parking", "Bike Parking", "Washroom", "Changing Room", "Flood Lights", "Drinking Water",
  "Cafeteria", "First Aid", "Locker Room", "Seating Area", "WiFi", "CCTV", "Spectator Stand", "Equipment Rental",
];
const MAX_PHOTOS = 6;

// ── Advance Pricing (same shape as Admin → Turfs → Edit) ─────────────────────
type PriceSlab = { start: number; end: number; rate: number };
type DayType = "weekday" | "weekend";

function fmtHour(h: number): string {
  if (h === 0 || h === 24) return "12 AM";
  if (h === 12) return "12 PM";
  return h < 12 ? `${h} AM` : `${h - 12} PM`;
}
function validateSlabs(slabs: PriceSlab[], label: string): string | null {
  if (slabs.length === 0) return `Add at least one ${label} time slot (or switch Advance Pricing off).`;
  for (const s of slabs) {
    if (isNaN(s.start) || s.start < 0 || s.start > 23) return `${label}: start hour must be 0–23.`;
    if (isNaN(s.end) || s.end < 1 || s.end > 24) return `${label}: end hour must be 1–24.`;
    if (s.end <= s.start) return `${label}: end time must be after start time.`;
    if (isNaN(s.rate) || s.rate <= 0) return `${label}: enter a rate for every time slot.`;
  }
  const sorted = [...slabs].sort((a, b) => a.start - b.start);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].start < sorted[i - 1].end) {
      return `${label}: time slots overlap (${fmtHour(sorted[i - 1].start)}–${fmtHour(sorted[i - 1].end)} and ${fmtHour(sorted[i].start)}–${fmtHour(sorted[i].end)}).`;
    }
  }
  return null;
}

// ── Coordinates from a Google Maps link or "20.93, 77.77" ────────────────────
function coordsFromText(text: string): { lat: number; lng: number } | null {
  const t = decodeURIComponent((text || "").trim());
  const patterns = [
    /@(-?\d{1,2}\.\d+),\s*(-?\d{1,3}\.\d+)/,                 // …/@20.93,77.77,17z
    /!3d(-?\d{1,2}\.\d+)!4d(-?\d{1,3}\.\d+)/,                // …!3d20.93!4d77.77
    /[?&](?:q|ll|query|destination|center)=(-?\d{1,2}\.\d+),\s*(-?\d{1,3}\.\d+)/, // ?q=20.93,77.77
    /^(-?\d{1,2}\.\d+)\s*[, ]\s*(-?\d{1,3}\.\d+)$/,          // 20.93, 77.77
  ];
  for (const p of patterns) {
    const m = t.match(p);
    if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };
  }
  return null;
}
const inIndia = (lat: number, lng: number) => lat >= 6 && lat <= 37 && lng >= 68 && lng <= 98;

type Form = {
  name: string; cityId: string; locality: string; phone: string; sports: string[];
  lat: string; lng: string;
  dayPrice: string; nightPrice: string;
  advanceOn: boolean; slabsWeekday: PriceSlab[]; slabsWeekend: PriceSlab[];
  openingTime: string; closingTime: string;
  images: string[]; facilities: string[]; ownerName: string;
  active: boolean;
};
const EMPTY = (cityId = ""): Form => ({
  name: "", cityId, locality: "", phone: "", sports: [],
  lat: "", lng: "",
  dayPrice: "", nightPrice: "",
  advanceOn: false,
  slabsWeekday: [{ start: 6, end: 18, rate: 0 }, { start: 18, end: 24, rate: 0 }],
  slabsWeekend: [{ start: 6, end: 18, rate: 0 }, { start: 18, end: 24, rate: 0 }],
  openingTime: "", closingTime: "",
  images: [], facilities: [], ownerName: "",
  active: true,
});

export default function AddListing() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const scrollRef = useRef<ScrollView>(null);

  const [cities, setCities] = useState<City[]>([]);
  const [form, setForm] = useState<Form>(EMPTY());
  const [mapsText, setMapsText] = useState("");
  const [photoLink, setPhotoLink] = useState("");
  const [slabTab, setSlabTab] = useState<DayType>("weekday");
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [addedCount, setAddedCount] = useState(0);

  useEffect(() => {
    fetchCities(true)
      .then((list) => {
        setCities(list);
        const def = list.find((c) => c.isDefault) || list.find((c) => c.status === "live") || list[0];
        if (def) setForm((f) => ({ ...f, cityId: f.cityId || def.id }));
      })
      .catch(() => Alert.alert("Error", "Unable to load cities."));
  }, []);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const city = cities.find((c) => c.id === form.cityId) || null;

  // ── Location ──────────────────────────────────────────────────────────────
  const lat = parseFloat(form.lat), lng = parseFloat(form.lng);
  const hasPin = !isNaN(lat) && !isNaN(lng);
  const pinInfo = (() => {
    if (!form.lat.trim() && !form.lng.trim()) return null;
    if (!hasPin) return { ok: false, text: "Enter both latitude and longitude as numbers." };
    if (!inIndia(lat, lng)) return { ok: false, text: "This point is outside India — check the numbers (latitude first)." };
    if (city?.lat != null && city?.lng != null) {
      const km = haversineKm(lat, lng, city.lat, city.lng);
      return km <= city.radiusKm
        ? { ok: true, text: `Inside ${city.name} · ${km < 10 ? km.toFixed(1) : Math.round(km)} km from centre` }
        : { ok: false, text: `${Math.round(km)} km from ${city.name} centre — outside its ${city.radiusKm} km area. Check the city or the numbers.` };
    }
    return { ok: true, text: "Location set" };
  })();

  const onMapsText = (v: string) => {
    setMapsText(v);
    const c = coordsFromText(v);
    if (c) {
      setForm((f) => ({
        ...f, lat: c.lat.toFixed(6), lng: c.lng.toFixed(6),
        // pin inside another city's area → switch to that city
        cityId: guessCity({ lat: c.lat, lng: c.lng }, cities)?.id || f.cityId,
      }));
    }
  };
  const mapsTextUnreadable = !!mapsText.trim() && !coordsFromText(mapsText);

  // ── Photos ────────────────────────────────────────────────────────────────
  const uploadPhotos = async () => {
    const room = MAX_PHOTOS - form.images.length;
    if (room <= 0) return Alert.alert("Photos", `Up to ${MAX_PHOTOS} photos.`);
    try {
      const picked = await pickPhotos(room);
      if (!picked.length) return;
      setUploading(true);
      const urls: string[] = [];
      for (const uri of picked) {
        try { urls.push(await uploadPhoto(uri, "admin-listing")); } catch { /* skip a failed one */ }
      }
      if (urls.length < picked.length) Alert.alert("Some photos failed", `${picked.length - urls.length} photo(s) could not upload. Try again for those.`);
      setForm((f) => ({ ...f, images: [...f.images, ...urls].slice(0, MAX_PHOTOS) }));
    } catch (e: any) {
      if (e?.message === "PERMISSION") Alert.alert("Permission needed", "Allow photo access to upload turf photos.");
      else Alert.alert("Upload failed", e?.message || "Please check your internet and try again.");
    } finally { setUploading(false); }
  };
  const addPhotoLink = () => {
    const u = photoLink.trim();
    if (!/^https?:\/\//i.test(u)) return Alert.alert("Photo link", "Paste a full image link (https://…).");
    if (form.images.length >= MAX_PHOTOS) return Alert.alert("Photos", `Up to ${MAX_PHOTOS} photos.`);
    setForm((f) => ({ ...f, images: [...f.images, u] }));
    setPhotoLink("");
  };
  const removePhoto = (i: number) => setForm((f) => ({ ...f, images: f.images.filter((_, j) => j !== i) }));
  const makeCover = (i: number) => setForm((f) => {
    const imgs = [...f.images];
    const [x] = imgs.splice(i, 1);
    return { ...f, images: [x, ...imgs] };
  });

  // ── Advance Pricing rows ──────────────────────────────────────────────────
  const slabKey = slabTab === "weekday" ? "slabsWeekday" : "slabsWeekend";
  const slabs = form[slabKey];
  const updateSlab = (i: number, k: keyof PriceSlab, v: string) => {
    const n = v === "" ? 0 : Number(v.replace(/[^0-9]/g, ""));
    setForm((f) => ({ ...f, [slabKey]: f[slabKey].map((s, j) => (j === i ? { ...s, [k]: n } : s)) }));
  };
  const addSlab = () => setForm((f) => {
    const cur = f[slabKey];
    const lastEnd = cur.length ? cur[cur.length - 1].end : 6;
    return { ...f, [slabKey]: [...cur, { start: Math.min(lastEnd, 23), end: Math.min(lastEnd + 1, 24), rate: 0 }] };
  });
  const removeSlab = (i: number) => setForm((f) => ({ ...f, [slabKey]: f[slabKey].filter((_, j) => j !== i) }));
  const copyWeekdayToWeekend = () => setForm((f) => ({ ...f, slabsWeekend: f.slabsWeekday.map((s) => ({ ...s })) }));

  // ── Validate + save ───────────────────────────────────────────────────────
  const validate = (): string | null => {
    if (!form.name.trim()) return "Enter the turf name.";
    if (!form.cityId) return cities.length ? "Pick the city." : "No cities yet — set one up in Admin → Cities first.";
    if (!form.locality.trim()) return "Enter the area / locality (e.g. Rajapeth).";
    const digits = form.phone.replace(/\D/g, "").slice(-10);
    if (!/^[6-9]\d{9}$/.test(digits)) return "Enter a valid 10-digit booking phone number.";
    if (form.lat.trim() || form.lng.trim()) {
      if (!hasPin) return "Enter both latitude and longitude, or leave both empty.";
      if (!inIndia(lat, lng)) return "The location is outside India — check latitude and longitude.";
    }
    if (form.dayPrice.trim() && !(Number(form.dayPrice) > 0)) return "Day price must be a number (or leave it empty).";
    if (form.nightPrice.trim() && !(Number(form.nightPrice) > 0)) return "Night price must be a number (or leave it empty).";
    if (form.advanceOn) {
      const a = validateSlabs(form.slabsWeekday, "Mon–Fri"); if (a) return a;
      const b = validateSlabs(form.slabsWeekend, "Sat–Sun"); if (b) return b;
    }
    const o = form.openingTime.trim(), c = form.closingTime.trim();
    if (o || c) {
      if (!o || !c) return "Enter both opening and closing hour, or leave both empty.";
      const oh = Number(o), ch = Number(c);
      if (isNaN(oh) || oh < 0 || oh > 23) return "Opening hour must be 0–23.";
      if (isNaN(ch) || ch < 1 || ch > 28) return "Closing hour must be 1–28 (25 = 1 AM … 28 = 4 AM).";
      if (ch <= oh) return "Closing hour must be after opening hour.";
    }
    return null;
  };

  const confirmSave = (another: boolean) => {
    const err = validate();
    if (err) return Alert.alert("Check this", err);
    const day = Number(form.dayPrice) || 0;
    const night = Number(form.nightPrice) || day;
    const lines = [
      `${form.name.trim()} · ${form.locality.trim()}, ${city?.name}`,
      `Call to book: ${form.phone.replace(/\D/g, "").slice(-10)}`,
      `Sports: ${form.sports.length ? form.sports.join(", ") : "not set"}`,
      `Location: ${hasPin ? `${lat.toFixed(5)}, ${lng.toFixed(5)}` : "not set (no distance shown)"}`,
      `Price: ${form.advanceOn ? "Advance Pricing" : day ? `Day ₹${day} · Night ₹${night}` : "Price on call"}`,
      `Hours: ${form.openingTime.trim() ? `${fmtHour(Number(form.openingTime))} – ${fmtHour(Number(form.closingTime) % 24)}` : "not set"}`,
      `Photos: ${form.images.length || "default PlayOn photo"}`,
      `Status: ${form.active ? "Live now" : "Hidden (saved)"}`,
    ];
    Alert.alert("Add this turf?", lines.map((l) => `• ${l}`).join("\n"), [
      { text: "Cancel", style: "cancel" },
      { text: "Add", onPress: () => save(another) },
    ]);
  };

  const save = async (another: boolean) => {
    if (!city) return;
    setSaving(true);
    try {
      const phone = form.phone.replace(/\D/g, "").slice(-10);
      const day = Number(form.dayPrice) || 0;
      const night = Number(form.nightPrice) || day;
      const locality = form.locality.trim();
      const hoursSet = !!form.openingTime.trim();
      await addDoc(collection(db, "turfs"), {
        name: form.name.trim(),
        location: `${locality}, ${city.name}`,
        area: locality,
        city: city.name,
        state: city.state,
        cityId: city.id,
        cityName: city.name,
        locality,
        sport: form.sports,
        mapLink: hasPin ? `https://maps.google.com/?q=${lat},${lng}` : "",
        ...(hasPin ? { latitude: Number(lat.toFixed(6)), longitude: Number(lng.toFixed(6)) } : {}),
        dayPrice: day,
        nightPrice: night,
        price: day,
        priceOnCall: !day && !form.advanceOn,          // cards show "Price on call"
        advancePricingEnabled: form.advanceOn,
        ...(form.advanceOn ? { priceSlabs: { weekday: form.slabsWeekday, weekend: form.slabsWeekend } } : {}),
        ...(hoursSet ? { openingTime: Number(form.openingTime), closingTime: Number(form.closingTime) } : {}),
        hoursSet,
        slotDuration: 60,
        slotBookingEnabled: true,
        image: form.images[0] || "",                     // "" → default PlayOn photo in the app
        images: form.images,
        facilities: form.facilities,
        ownerId: "",
        ownerName: form.ownerName.trim(),
        ownerEmail: "",
        ownerPhone: phone,
        operatorId: "", operatorName: "", operatorEmail: "",
        addedBy: "admin",
        addedByUid: auth.currentUser?.uid ?? null,
        active: form.active,
        bookingPrice: 0,
        bookingMode: "phone",
        bookingPhone: phone,
        venueType: "turf",
        ballMachineEnabled: false,
        listingType: "listing",
        createdAt: serverTimestamp(),
      });
      setAddedCount((n) => n + 1);
      if (another) {
        // keep the city (and sports, usually the same) for the next turf
        setForm((f) => ({ ...EMPTY(f.cityId), sports: f.sports }));
        setMapsText(""); setPhotoLink(""); setSlabTab("weekday");
        scrollRef.current?.scrollTo({ y: 0, animated: true });
        Alert.alert("Turf added ✓", "Form cleared for the next turf.");
      } else {
        Alert.alert("Turf added ✓", `"${form.name.trim()}" is ${form.active ? "live" : "saved (hidden)"} in ${city.name}.`, [
          { text: "OK", onPress: () => router.back() },
        ]);
      }
    } catch (e: any) {
      Alert.alert("Error", e?.message || "Could not add the turf.");
    } finally { setSaving(false); }
  };

  // ── UI helpers ────────────────────────────────────────────────────────────
  const Chip = ({ on, label, onPress, color = DARK }: { on: boolean; label: string; onPress: () => void; color?: string }) => (
    <TouchableOpacity style={[s.chip, on && { backgroundColor: color, borderColor: color }]} onPress={onPress} activeOpacity={0.8}>
      <Text style={[s.chipTxt, on && s.chipTxtOn]}>{label}</Text>
    </TouchableOpacity>
  );
  const toggleIn = (k: "sports" | "facilities", v: string) =>
    setForm((f) => ({ ...f, [k]: f[k].includes(v) ? f[k].filter((x) => x !== v) : [...f[k], v] }));

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={s.safe}>
        <StatusBar barStyle="light-content" backgroundColor={DARK} />
        <ScrollView ref={scrollRef} contentContainerStyle={{ paddingBottom: 60 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {/* Hero */}
          <View style={[s.hero, { paddingTop: insets.top + 12 }]}>
            <TouchableOpacity style={s.backBtn} onPress={() => router.back()} accessibilityLabel="Back">
              <Ionicons name="arrow-back" size={20} color="#fff" />
            </TouchableOpacity>
            <Text style={s.heroTag}>Admin · Call to book</Text>
            <Text style={s.heroTitle}>Quick Add Turf</Text>
            <Text style={s.heroSub}>Add a turf in 1 minute. No owner, bank or price needed — players call to book.</Text>
            {addedCount > 0 && (
              <View style={s.countPill}><Ionicons name="checkmark-circle" size={14} color="#34D399" /><Text style={s.countTxt}>{addedCount} added this session</Text></View>
            )}
          </View>

          {/* 1 · Turf */}
          <View style={s.card}>
            <Text style={s.cardTitle}>1 · Turf <Text style={{ color: "#DC2626", fontSize: 12 }}>required</Text></Text>

            <Text style={s.label}>Turf name *</Text>
            <TextInput style={s.input} placeholder="e.g. Green Arena" placeholderTextColor="#9CA3AF"
              value={form.name} onChangeText={(v) => set("name", v)} autoCapitalize="words" />

            <Text style={s.label}>City *</Text>
            {cities.length === 0 ? (
              <TouchableOpacity onPress={() => router.push("/admin/cities" as any)}>
                <Text style={[s.hint, { color: ACCENT, fontWeight: "800" }]}>No cities yet — tap to set up your first city.</Text>
              </TouchableOpacity>
            ) : (
              <View style={s.wrap}>
                {cities.filter((c) => c.status !== "hidden" || c.id === form.cityId).map((c) => (
                  <Chip key={c.id} on={form.cityId === c.id} onPress={() => set("cityId", c.id)}
                    label={c.name + (c.status !== "live" ? ` · ${CITY_STATUS_META[c.status].label.toLowerCase()}` : "")} />
                ))}
              </View>
            )}
            {city && city.status !== "live" && (
              <Text style={[s.hint, { color: "#B45309" }]}>{city.name} is {CITY_STATUS_META[city.status].label.toLowerCase()} — players won't see this turf until the city is Live.</Text>
            )}

            <Text style={s.label}>Area / Locality *</Text>
            <TextInput style={s.input} placeholder="e.g. Rajapeth" placeholderTextColor="#9CA3AF"
              value={form.locality} onChangeText={(v) => set("locality", v)} autoCapitalize="words" />

            <Text style={s.label}>Booking phone (players call this) *</Text>
            <TextInput style={s.input} placeholder="10-digit mobile number" placeholderTextColor="#9CA3AF"
              value={form.phone} onChangeText={(v) => set("phone", v)} keyboardType="phone-pad" maxLength={13} />

            <Text style={s.label}>Sports</Text>
            <View style={s.wrap}>
              {SPORTS.map((sp) => <Chip key={sp} on={form.sports.includes(sp)} label={sp} onPress={() => toggleIn("sports", sp)} />)}
            </View>
          </View>

          {/* 2 · Location */}
          <View style={s.card}>
            <Text style={s.cardTitle}>2 · Location <Text style={s.cardTitleSub}>recommended</Text></Text>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Text style={s.label}>Latitude</Text>
                <TextInput style={s.input} placeholder="20.93740" placeholderTextColor="#9CA3AF"
                  value={form.lat} onChangeText={(v) => set("lat", v.replace(/[^0-9.\-]/g, ""))} keyboardType="decimal-pad" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.label}>Longitude</Text>
                <TextInput style={s.input} placeholder="77.77960" placeholderTextColor="#9CA3AF"
                  value={form.lng} onChangeText={(v) => set("lng", v.replace(/[^0-9.\-]/g, ""))} keyboardType="decimal-pad" />
              </View>
            </View>
            <Text style={[s.hint, { textAlign: "center", marginTop: 10 }]}>— or —</Text>
            <Text style={s.label}>Paste Google Maps link</Text>
            <TextInput style={s.input} placeholder="https://maps.google.com/… or 20.9374, 77.7796" placeholderTextColor="#9CA3AF"
              value={mapsText} onChangeText={onMapsText} autoCapitalize="none" autoCorrect={false} />
            {mapsTextUnreadable ? (
              <Text style={[s.hint, { color: "#B45309" }]}>
                Couldn't read numbers from this. Short links (maps.app.goo.gl) don't include them — open the link in Google Maps, long-press the pin and copy the numbers.
              </Text>
            ) : (
              <Text style={s.hint}>Latitude &amp; longitude fill in by themselves.</Text>
            )}
            {pinInfo && (
              <View style={[s.pinBox, pinInfo.ok ? s.pinOk : s.pinWarn]}>
                <Ionicons name={pinInfo.ok ? "checkmark-circle" : "warning-outline"} size={15} color={pinInfo.ok ? "#15803D" : "#C2410C"} />
                <Text style={[s.pinTxt, { color: pinInfo.ok ? "#15803D" : "#C2410C" }]}>{pinInfo.text}</Text>
              </View>
            )}
          </View>

          {/* 3 · Extra details */}
          <View style={s.card}>
            <Text style={s.cardTitle}>3 · Extra details <Text style={s.cardTitleSub}>optional — skip anything</Text></Text>

            <View style={{ flexDirection: "row", gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Text style={s.label}>Day price ₹/hr</Text>
                <TextInput style={s.input} placeholder="Empty = on call" placeholderTextColor="#9CA3AF"
                  value={form.dayPrice} onChangeText={(v) => set("dayPrice", v.replace(/[^0-9]/g, ""))} keyboardType="number-pad" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.label}>Night price ₹/hr</Text>
                <TextInput style={s.input} placeholder="Same as day" placeholderTextColor="#9CA3AF"
                  value={form.nightPrice} onChangeText={(v) => set("nightPrice", v.replace(/[^0-9]/g, ""))} keyboardType="number-pad" />
              </View>
            </View>
            {!form.dayPrice && !form.advanceOn && <Text style={s.hint}>No price → players see "Price on call".</Text>}

            {/* Advance Pricing */}
            <View style={[s.advBox, form.advanceOn && s.advBoxOn]}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Text style={s.advTitle}>Advance Pricing</Text>
                  <Text style={s.advSub}>Different rates by time + weekday/weekend</Text>
                </View>
                <Switch value={form.advanceOn} onValueChange={(v) => set("advanceOn", v)}
                  trackColor={{ false: "#E5E7EB", true: "#DDD6FE" }} thumbColor={form.advanceOn ? PURPLE : "#fff"} />
              </View>
              {form.advanceOn && (
                <>
                  <View style={s.tabs}>
                    {(["weekday", "weekend"] as DayType[]).map((t) => (
                      <TouchableOpacity key={t} style={[s.tab, slabTab === t && s.tabOn]} onPress={() => setSlabTab(t)}>
                        <Text style={[s.tabTxt, slabTab === t && { color: "#fff" }]}>{t === "weekday" ? "Mon – Fri" : "Sat – Sun"}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  {slabs.map((sl, i) => (
                    <View key={i} style={s.slabRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={s.slabLbl}>FROM (h)</Text>
                        <TextInput style={s.slabInput} value={String(sl.start)} keyboardType="number-pad" maxLength={2} onChangeText={(v) => updateSlab(i, "start", v)} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={s.slabLbl}>TO (h)</Text>
                        <TextInput style={s.slabInput} value={String(sl.end)} keyboardType="number-pad" maxLength={2} onChangeText={(v) => updateSlab(i, "end", v)} />
                      </View>
                      <View style={{ flex: 1.3 }}>
                        <Text style={s.slabLbl}>₹ / HOUR</Text>
                        <TextInput style={s.slabInput} value={sl.rate ? String(sl.rate) : ""} placeholder="0" placeholderTextColor="#9CA3AF" keyboardType="number-pad" maxLength={5} onChangeText={(v) => updateSlab(i, "rate", v)} />
                      </View>
                      <TouchableOpacity style={s.slabDel} onPress={() => removeSlab(i)} accessibilityLabel="Remove time slot">
                        <Ionicons name="trash-outline" size={14} color="#DC2626" />
                      </TouchableOpacity>
                    </View>
                  ))}
                  <TouchableOpacity style={s.slabAdd} onPress={addSlab}>
                    <Ionicons name="add" size={16} color={PURPLE} /><Text style={s.slabAddTxt}>Add time slot</Text>
                  </TouchableOpacity>
                  {slabTab === "weekend" && (
                    <TouchableOpacity onPress={copyWeekdayToWeekend}><Text style={[s.hint, { color: PURPLE, fontWeight: "800" }]}>Copy Mon–Fri rates here</Text></TouchableOpacity>
                  )}
                  <Text style={s.hint}>24-hour format (6 = 6 AM, 18 = 6 PM). Hours not covered use the Day/Night price.</Text>
                </>
              )}
            </View>

            <View style={{ flexDirection: "row", gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Text style={s.label}>Opens (0–23)</Text>
                <TextInput style={s.input} placeholder="6" placeholderTextColor="#9CA3AF"
                  value={form.openingTime} onChangeText={(v) => set("openingTime", v.replace(/[^0-9]/g, ""))} keyboardType="number-pad" maxLength={2} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.label}>Closes (1–28)</Text>
                <TextInput style={s.input} placeholder="23" placeholderTextColor="#9CA3AF"
                  value={form.closingTime} onChangeText={(v) => set("closingTime", v.replace(/[^0-9]/g, ""))} keyboardType="number-pad" maxLength={2} />
              </View>
            </View>
            {Number(form.closingTime) > 24 && <Text style={s.hint}>🌙 Closes at {Number(form.closingTime) - 24} AM next day.</Text>}

            <Text style={s.label}>Photos</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {form.images.length === 0 && (
                <View style={s.photo}>
                  <Image source={{ uri: DEFAULT_TURF_IMAGE }} style={s.photoImg} />
                  <View style={s.photoTag}><Text style={s.photoTagTxt}>Default</Text></View>
                </View>
              )}
              {form.images.map((u, i) => (
                <View key={u + i} style={s.photo}>
                  <Image source={{ uri: u }} style={s.photoImg} />
                  {i === 0 ? (
                    <View style={s.photoTag}><Text style={s.photoTagTxt}>Cover</Text></View>
                  ) : (
                    <TouchableOpacity style={[s.photoTag, { backgroundColor: "rgba(0,0,0,0.55)" }]} onPress={() => makeCover(i)}>
                      <Text style={s.photoTagTxt}>Make cover</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity style={s.photoX} onPress={() => removePhoto(i)} accessibilityLabel="Remove photo">
                    <Ionicons name="close" size={12} color="#fff" />
                  </TouchableOpacity>
                </View>
              ))}
              {form.images.length < MAX_PHOTOS && (
                <TouchableOpacity style={[s.photo, s.photoAdd]} onPress={uploadPhotos} disabled={uploading} accessibilityLabel="Upload photos">
                  {uploading ? <ActivityIndicator color={ACCENT} /> : (<><Ionicons name="add" size={22} color={ACCENT} /><Text style={s.photoAddTxt}>Upload</Text></>)}
                </TouchableOpacity>
              )}
            </ScrollView>
            <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
              <TextInput style={[s.input, { flex: 1 }]} placeholder="…or paste a photo link" placeholderTextColor="#9CA3AF"
                value={photoLink} onChangeText={setPhotoLink} autoCapitalize="none" autoCorrect={false} />
              <TouchableOpacity style={s.useBtn} onPress={addPhotoLink}><Text style={s.useTxt}>Add</Text></TouchableOpacity>
            </View>
            <Text style={s.hint}>No photo? Players see the default PlayOn turf photo.</Text>

            <Text style={s.label}>Facilities</Text>
            <View style={s.wrap}>
              {FACILITIES.map((f) => <Chip key={f} on={form.facilities.includes(f)} label={f} color={ACCENT} onPress={() => toggleIn("facilities", f)} />)}
            </View>

            <Text style={s.label}>Owner name (just for your note)</Text>
            <TextInput style={s.input} placeholder="Optional — no login is created" placeholderTextColor="#9CA3AF"
              value={form.ownerName} onChangeText={(v) => set("ownerName", v)} autoCapitalize="words" />
          </View>

          {/* Save */}
          <View style={{ marginHorizontal: 16, marginTop: 16, gap: 10 }}>
            <View style={s.toggleRow}>
              <View style={{ flex: 1 }}>
                <Text style={s.toggleLabel}>Go live now</Text>
                <Text style={s.toggleSub}>{form.active ? "Players can see it right away" : "Saved, hidden from players"}</Text>
              </View>
              <Switch value={form.active} onValueChange={(v) => set("active", v)} trackColor={{ false: "#E5E7EB", true: ACCENT }} thumbColor="#fff" />
            </View>
            <TouchableOpacity style={[s.primaryBtn, saving && { opacity: 0.6 }]} onPress={() => confirmSave(false)} disabled={saving}>
              {saving ? <ActivityIndicator color="#fff" /> : <Text style={s.primaryTxt}>Add Turf</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={[s.secondaryBtn, saving && { opacity: 0.6 }]} onPress={() => confirmSave(true)} disabled={saving}>
              <Text style={s.secondaryTxt}>Add &amp; start next turf</Text>
            </TouchableOpacity>
            <Text style={[s.hint, { textAlign: "center" }]}>Saved as Call to Book. Later: Admin → Turfs → Edit to add an owner or switch to online booking.</Text>
          </View>
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#F0F4F8" },
  hero: { backgroundColor: DARK, paddingHorizontal: 20, paddingBottom: 20 },
  backBtn: { width: 36, height: 36, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.1)", justifyContent: "center", alignItems: "center", marginBottom: 12 },
  heroTag: { color: "#6EE7B7", fontSize: 11, fontWeight: "800", letterSpacing: 1.5, textTransform: "uppercase" },
  heroTitle: { color: "#fff", fontSize: 26, fontWeight: "900", marginTop: 4 },
  heroSub: { color: "#9CA3AF", fontSize: 13, lineHeight: 19, marginTop: 6 },
  countPill: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", marginTop: 12, backgroundColor: "rgba(52,211,153,0.12)", paddingHorizontal: 10, paddingVertical: 5, borderRadius: 99 },
  countTxt: { color: "#34D399", fontSize: 12, fontWeight: "800" },

  card: { backgroundColor: "#fff", marginHorizontal: 16, marginTop: 14, borderRadius: 18, padding: 16, borderWidth: 1, borderColor: "#E5E7EB" },
  cardTitle: { fontSize: 16, fontWeight: "900", color: "#111827" },
  cardTitleSub: { fontSize: 12, color: "#6B7280", fontWeight: "700" },
  label: { fontSize: 11, fontWeight: "800", color: "#6B7280", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 14, marginBottom: 6 },
  input: { backgroundColor: "#F9FAFB", borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: "#111827" },
  hint: { fontSize: 11, color: "#6B7280", marginTop: 6, lineHeight: 16 },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingHorizontal: 13, paddingVertical: 8, borderRadius: 20, backgroundColor: "#F3F4F6", borderWidth: 1, borderColor: "#E5E7EB" },
  chipTxt: { fontSize: 13, fontWeight: "700", color: "#4B5563" },
  chipTxtOn: { color: "#fff", fontWeight: "800" },

  pinBox: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 10, borderWidth: 1, borderRadius: 10, padding: 9 },
  pinOk: { backgroundColor: "#F0FDF4", borderColor: "#BBF7D0" },
  pinWarn: { backgroundColor: "#FFF7ED", borderColor: "#FED7AA" },
  pinTxt: { flex: 1, fontSize: 12, fontWeight: "700" },

  advBox: { marginTop: 14, borderRadius: 14, borderWidth: 1.5, borderColor: "#E5E7EB", backgroundColor: "#F9FAFB", padding: 12, gap: 8 },
  advBoxOn: { backgroundColor: "#F5F3FF", borderColor: "#DDD6FE" },
  advTitle: { fontSize: 14, fontWeight: "800", color: "#111827" },
  advSub: { fontSize: 11, color: "#6B7280", marginTop: 2 },
  tabs: { flexDirection: "row", backgroundColor: "#fff", borderRadius: 10, padding: 3, borderWidth: 1, borderColor: "#DDD6FE" },
  tab: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: "center" },
  tabOn: { backgroundColor: PURPLE },
  tabTxt: { fontSize: 12, fontWeight: "800", color: "#6B7280" },
  slabRow: { flexDirection: "row", alignItems: "flex-end", gap: 8, backgroundColor: "#fff", borderRadius: 10, borderWidth: 1, borderColor: "#DDD6FE", padding: 10 },
  slabLbl: { fontSize: 9, color: "#6B7280", fontWeight: "800", marginBottom: 3 },
  slabInput: { backgroundColor: "#F9FAFB", borderRadius: 8, borderWidth: 1, borderColor: "#E5E7EB", paddingHorizontal: 8, paddingVertical: 8, fontSize: 13, fontWeight: "700", color: "#111827" },
  slabDel: { width: 32, height: 34, borderRadius: 8, backgroundColor: "#FEF2F2", alignItems: "center", justifyContent: "center" },
  slabAdd: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: "#fff", borderWidth: 1.5, borderColor: "#DDD6FE", borderStyle: "dashed", borderRadius: 10, paddingVertical: 10 },
  slabAddTxt: { fontSize: 12, fontWeight: "800", color: PURPLE },

  photo: { width: 84, height: 84, borderRadius: 12, overflow: "hidden", backgroundColor: "#E5E7EB" },
  photoImg: { width: "100%", height: "100%" },
  photoTag: { position: "absolute", left: 4, bottom: 4, backgroundColor: "rgba(21,128,61,0.9)", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  photoTagTxt: { color: "#fff", fontSize: 9, fontWeight: "800" },
  photoX: { position: "absolute", top: 4, right: 4, width: 20, height: 20, borderRadius: 10, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center" },
  photoAdd: { backgroundColor: "#fff", borderWidth: 1.5, borderStyle: "dashed", borderColor: ACCENT, alignItems: "center", justifyContent: "center" },
  photoAddTxt: { fontSize: 11, fontWeight: "800", color: "#0F766E", marginTop: 2 },
  useBtn: { backgroundColor: DARK, borderRadius: 12, paddingHorizontal: 16, alignItems: "center", justifyContent: "center" },
  useTxt: { color: "#fff", fontWeight: "800", fontSize: 13 },

  toggleRow: { flexDirection: "row", alignItems: "center", backgroundColor: "#fff", borderRadius: 14, padding: 14, borderWidth: 1, borderColor: "#E5E7EB" },
  toggleLabel: { fontSize: 15, fontWeight: "800", color: "#111827" },
  toggleSub: { fontSize: 12, color: "#6B7280", marginTop: 2 },
  primaryBtn: { backgroundColor: DARK, paddingVertical: 16, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  primaryTxt: { color: "#fff", fontWeight: "900", fontSize: 15 },
  secondaryBtn: { backgroundColor: "#fff", borderWidth: 1.5, borderColor: DARK, paddingVertical: 14, borderRadius: 16, alignItems: "center" },
  secondaryTxt: { color: DARK, fontWeight: "800", fontSize: 14 },
});
